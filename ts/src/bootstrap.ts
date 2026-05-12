import { pathToFileURL } from 'node:url'

import type { CompilerOptions } from 'typescript'

import { getAllTsFiles, type GetAllTsFilesOptions } from './ast/get-all-ts-files.js'
import type { ExpandTypeOptions } from './ast/type-expand.js'
import { mergeASTIntoRegistry } from './ast/merge-ast.js'
import { runASTScanner, type RunAstScannerOptions } from './ast/run-ast-scanner.js'
import {
	analyzeRelationships,
	buildTree,
	resolveRelationships,
} from './graph/relationships.js'
import type { Logger } from './logger.js'
import { createLogger } from './logger.js'
import { Registry } from './registry-state.js'
import type { FetchFileUrlOptions } from './upload/fetch-file-url.js'
import type { QaFileWireMode, QaMediaUploadTarget, RegistryEntry } from './types.js'
import {
	startInspectorWebSocket,
	type InspectorWebSocketHandle,
} from './transport/ws-server.js'
import { configureInvokeRateLimit } from './invoke-policy.js'
import { setInvokeTimeoutMs } from './invoke-runtime-config.js'
import {
	resetRpcSerializationConfig,
	setRpcSerializationConfig,
	type RpcSerializationOptions,
} from './serialize-rpc-result.js'

/** Host-provided object storage wiring (secrets read inside adapter from env / vault). */
export interface StorageAdapter {
	createPresignedPut(input: {
		key: string
		contentType?: string
		sizeBytes?: number
	}): Promise<{ uploadUrl: string; objectKey: string; expiresAt?: string }>
}

export interface BootstrapStorageOptions {
	adapter?: StorageAdapter
	/** When set and positive, `adapter` is required (fail-fast `QA_STORAGE_NOT_CONFIGURED`). */
	artifactThresholdBytes?: number
}

export function validateBootstrapStorage(storage: BootstrapStorageOptions | undefined): void {
	if (!storage) return
	const t = storage.artifactThresholdBytes
	if (t !== undefined && t > 0 && !storage.adapter) {
		throw new Error(
			'QA_STORAGE_NOT_CONFIGURED: artifactThresholdBytes requires bootstrap.storage.adapter',
		)
	}
}

/** S3-compatible store (e.g. Minio). Never serialize to BOOTSTRAP / catalog JSON. */
export interface HostMinioOptions {
	endpoint: string
	region?: string
	accessKeyId: string
	secretAccessKey: string
	bucket: string
	forcePathStyle?: boolean
}

export function validateBootstrapFileWire(options: {
	qaFileWire?: { mode?: QaFileWireMode }
	fileUrl?: FetchFileUrlOptions | null
}): void {
	const mode: QaFileWireMode = options.qaFileWire?.mode ?? 'ref'
	if (mode === 'url') {
		const hosts = options.fileUrl?.allowedHosts
		if (!hosts || hosts.length === 0) {
			throw new Error('bootstrap: qaFileWire.mode "url" requires fileUrl.allowedHosts (non-empty)')
		}
	}
}

export interface BootstrapOptions {
	/** Directories scanned for `.ts` sources (AST + optional discovery) */
	scanRoots: string[]
	/** WebSocket listen port */
	wsPort: number
	wsHost?: string
	/** Start embedded WebSocket server (default true) */
	enableWebSocket?: boolean
	authToken?: string
	/** Absolute file URLs or paths dynamically imported before AST (compiled `.js` or ESM entry) */
	importEntryUrls?: string[]
	getAllTsFilesOptions?: GetAllTsFilesOptions
	compilerOptions?: CompilerOptions
	expandParamTypes?: boolean
	expandParamTypesOptions?: ExpandTypeOptions
	logLevel?: 'debug' | 'info' | 'warn' | 'error'
	logger?: Logger
	/** Install SIGINT / SIGTERM handlers that close the WebSocket server */
	registerSignalHandlers?: boolean
	/** Redact `RegistryEntry.body` from returned/transported registry (GDPR-safe). Default: true. */
	redactBodies?: boolean
	/** Optional post-invoke JSON normalization for `executeRPC` `result` (BigInt, Date, plain objects, size cap). */
	rpcSerialization?: RpcSerializationOptions
	/** Optional large-payload / presign wiring; validated with `artifactThresholdBytes`. */
	storage?: BootstrapStorageOptions
	/** When embedded WebSocket is enabled, token bucket per connection id. */
	invokeRateLimit?: { maxInvokesPerWindow: number; windowMs: number }
	/** When set, `executeRPC` rejects handler hangs after this many ms (best-effort; handler may still run). */
	invokeTimeoutMs?: number
	/** Wire mode for file RPC params. Default `ref`. */
	qaFileWire?: { mode?: QaFileWireMode }
	/** Catalog hint: where tenant web uploads before `__qaFileUrl` (no secrets). */
	qaMediaUpload?: { target: QaMediaUploadTarget }
	/** Invoke-time URL fetch policy for `__qaFileUrl`. Required when `qaFileWire.mode` is `url`. */
	fileUrl?: FetchFileUrlOptions
	/** HTTPS URL for host-only upload route (no credentials). */
	qaMediaUploadHostUploadUrl?: string
	/**
	 * Host-held Minio/S3 credentials (process memory only). Never sent on BOOTSTRAP.
	 * Used by host HTTP upload routes implemented outside this package.
	 */
	hostMinio?: HostMinioOptions
	/** In-memory QA uploads for `__qaFileRef`; enable when `qaFileWire.mode` is `ref` or alongside URL mode. */
	upload?: {
		enabled?: boolean
		maxSizeBytes?: number
		idleTimeoutMs?: number
	}
}

export interface BootstrapResult {
	registry: Record<string, RegistryEntry>
	tree: object[]
	ws: InspectorWebSocketHandle | undefined
	shutdown: () => Promise<void>
}

function toRegistryRecord(): Record<string, RegistryEntry> {
	return Object.fromEntries(Registry)
}

function redactRegistryBodies(
	registry: Record<string, RegistryEntry>,
): Record<string, RegistryEntry> {
	return Object.fromEntries(
		Object.entries(registry).map(([k, v]) => [k, { ...v, body: '' }]),
	)
}

export async function bootstrap(options: BootstrapOptions): Promise<BootstrapResult> {
	const log = options.logger ?? createLogger(options.logLevel ?? 'info')
	const enableWs = options.enableWebSocket ?? true
	const redactBodies = options.redactBodies ?? true

	validateBootstrapStorage(options.storage)
	validateBootstrapFileWire(options)

	for (const entry of options.importEntryUrls ?? []) {
		const href = entry.startsWith('file:')
			? entry
			: pathToFileURL(entry).href
		log.info('dynamic import', href)
		await import(href)
	}

	const roots = options.scanRoots
	if (roots.length === 0) {
		throw new Error('bootstrap: scanRoots must include at least one directory')
	}

	const scanRoot = roots[0]!
	const files = [...new Set(roots.flatMap((r) => getAllTsFiles(r, options.getAllTsFilesOptions)))]

	const runOpts: RunAstScannerOptions = {
		files,
		getAllTsFilesOptions: options.getAllTsFilesOptions,
		compilerOptions: options.compilerOptions,
		expandParamTypes: options.expandParamTypes,
		expandParamTypesOptions: options.expandParamTypesOptions,
	}

	log.info('AST scan', files.length, 'files')
	const ast = runASTScanner(scanRoot, runOpts)
	mergeASTIntoRegistry(ast)

	await new Promise<void>((resolve) => {
		setImmediate(() => {
			resolveRelationships()
			resolve()
		})
	})

	const { roots: rootKeys } = analyzeRelationships()
	const tree = rootKeys.map((k) => buildTree(k))
	const registryRaw = toRegistryRecord()
	const registry = redactBodies ? redactRegistryBodies(registryRaw) : registryRaw

	log.info('registry size', Registry.size, 'roots', rootKeys.length)

	let ws: InspectorWebSocketHandle | undefined

	async function shutdown(): Promise<void> {
		if (ws) await ws.close()
	}

	if (options.rpcSerialization !== undefined) {
		if (options.rpcSerialization.enabled) {
			setRpcSerializationConfig(options.rpcSerialization)
		} else {
			resetRpcSerializationConfig()
		}
	}

	setInvokeTimeoutMs(options.invokeTimeoutMs)

	if (enableWs) {
		configureInvokeRateLimit(options.invokeRateLimit ?? null)
		ws = await startInspectorWebSocket(registry, tree, {
			port: options.wsPort,
			host: options.wsHost,
			authToken: options.authToken,
			scanRoots: options.scanRoots,
			rpcSerialization: options.rpcSerialization,
			invokeRateLimit: options.invokeRateLimit,
			invokeTimeoutMs: options.invokeTimeoutMs,
			upload: options.upload,
			qaFileWire: options.qaFileWire,
			qaMediaUpload: options.qaMediaUpload,
			fileUrl: options.fileUrl,
			qaMediaUploadHostUploadUrl: options.qaMediaUploadHostUploadUrl,
		})
		log.info('WebSocket listening', `${options.wsHost ?? '127.0.0.1'}:${ws.port}`)
	}

	if (options.registerSignalHandlers && enableWs && ws) {
		const onSignal = (): void => {
			void shutdown()
				.then(() => process.exit(0))
				.catch((err: unknown) => {
					log.error('shutdown error', err)
					process.exit(1)
				})
		}
		process.once('SIGINT', onSignal)
		process.once('SIGTERM', onSignal)
	}

	return { registry, tree, ws, shutdown }
}
