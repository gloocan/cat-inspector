import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

import type { Server, Socket } from 'socket.io'

import { bootstrap, type BootstrapOptions } from '../bootstrap.js'
import { computeCoverageReport } from '../coverage/compute-coverage.js'
import {
	createExpressPlaygroundMocks,
	type ExpressPlaygroundPayload,
} from '../express-playground-mocks.js'
import {
	validateBootstrapStorage,
	type BootstrapStorageOptions,
} from '../bootstrap.js'
import { extractArtifactsFromResult } from '../artifact-helpers.js'
import { setInvokeTimeoutMs } from '../invoke-runtime-config.js'
import type { RpcSerializationOptions } from '../serialize-rpc-result.js'
import { executeRPC } from '../rpc.js'
import {
	configureInvokeRateLimit,
	invokeAudit,
	invokeRateLimitAllow,
	invokeRateLimitRetryAfterMs,
	registerPreInvoke,
	runPreInvokes,
} from '../invoke-policy.js'
import {
	ActiveContext,
	ApiContext,
	broadcast,
	clearBroadcastSink,
	clearExpressApiInvokeCapture,
	ErrorCapture,
	getInspectorBroadcastStore,
	InstanceRegistry,
	LabelCapture,
	Registry,
	readExpressApiInvokeCapture,
	runWithInspectorBroadcastTarget,
	setBroadcastSink,
} from '../registry-state.js'
import { getShape, getType } from '../return.js'
import { maybeSerializeRpcResult } from '../serialize-rpc-result.js'
import { sessionCreate, sessionStep } from '../session-store.js'
import {
	PROTOCOL_VERSION,
	type QaFileWireMode,
	type QaMediaUploadTarget,
	type RegistryEntry,
	type RpcErrorDetail,
	type RpcResponse,
} from '../types.js'
import { putBufferAndPresignGetUrl } from '../upload/host-minio-client.js'
import { InMemoryUploadStore } from '../upload/upload-store.js'
import type { FetchFileUrlOptions } from '../upload/fetch-file-url.js'
import {
	buildCatalogWireExtras,
	enrichRegistryParamsWithWireHints,
	materializeExpressPayloadForInvoke,
	materializeServiceArgsForInvoke,
	normalizeExpressPayloadFilesForPlayground,
} from '../upload/materialize.js'
import { computeCatalogFingerprint } from '../catalog-fingerprint.js'
import { createCatalogBootstrapCache } from '../catalog-bootstrap-cache.js'

export const INSPECTOR_BROADCAST_EVENT = 'inspector:broadcast'

export { INSPECTOR_SOCKET_ID_HEADER } from '../registry-state.js'

type BootstrapPayload = {
	event: 'BOOTSTRAP'
	protocolVersion: number
	catalogHash: string
	registry: Record<string, unknown>
	tree: object[]
	/** Optional plaintext tenant API key from host env (SaaS verifies from tenant web). */
	secretApiKey?: string | null
	qaFileWire?: { mode: QaFileWireMode }
	qaMediaUpload?: { target: QaMediaUploadTarget }
	fileUrl?: FetchFileUrlOptions
	qaMediaUploadHostUploadUrl?: string
	/** v10+: host can accept bytes over Socket.IO for URL+host Minio upload (no HTTP host URL required). */
	qaHostMediaUploadViaSocket?: boolean
}

export type AttachCatRPCOptions = {
	scanRoots: string[]
	bootstrap?: Partial<
		Pick<
			BootstrapOptions,
			| 'importEntryUrls'
			| 'getAllTsFilesOptions'
			| 'compilerOptions'
			| 'logLevel'
			| 'redactBodies'
			| 'expandParamTypes'
			| 'expandParamTypesOptions'
			| 'rpcSerialization'
			| 'storage'
			| 'invokeTimeoutMs'
			| 'qaFileWire'
			| 'qaMediaUpload'
			| 'fileUrl'
			| 'qaMediaUploadHostUploadUrl'
			| 'hostMinio'
			| 'upload'
		>
	>
	/** Merged into `bootstrap({ ... })` for catalog build; validated with `artifactThresholdBytes`. */
	storage?: BootstrapStorageOptions
	/** Token bucket per Socket.IO `socket.id`. */
	invokeRateLimit?: { maxInvokesPerWindow: number; windowMs: number }
	/** Applied with catalog `bootstrap()` merge (same as `bootstrap.rpcSerialization`). */
	rpcSerialization?: RpcSerializationOptions
	/** Same as `bootstrap.invokeTimeoutMs` when using embedded catalog bootstrap. */
	invokeTimeoutMs?: number
	serverId?: string
	/** When false, HTTP-sourced inspector never reaches Socket.IO */
	isDevelopment?: boolean
	forwardBroadcast?: boolean
	emitUnscopedBroadcasts?: boolean
	createExpressMocks?: typeof createExpressPlaygroundMocks
	hooks?: AttachCatRPCHooks
	upload?: {
		enabled?: boolean
		maxSizeBytes?: number
		idleTimeoutMs?: number
	}
	/**
	 * When set and `isDevelopment` is false, RPC invokes require Socket.IO
	 * `auth.token` to match this string (see protocol-client / cat-demo web profiles).
	 */
	rpcAuth?: { token: string }
	/**
	 * When set, merged into each emitted `catalog:bootstrap` (not part of AST fingerprint cache).
	 * Host should pass from env; never read env inside the SDK.
	 */
	secretApiKey?: string
	/** Overrides / supplements `bootstrap` for catalog + RPC materialize (same semantics as embedded WS). */
	qaFileWire?: { mode?: QaFileWireMode }
	qaMediaUpload?: { target: QaMediaUploadTarget }
	fileUrl?: FetchFileUrlOptions
	qaMediaUploadHostUploadUrl?: string
}

export type AttachCatRPCHooks = {
	onConnection?: (socket: Socket) => void | Promise<void>
	onBeforeRpc?: (socket: Socket, raw: unknown) => Promise<RpcResponse | undefined>
	onAfterRpc?: (socket: Socket, requestId: string, response: RpcResponse) => void
	onCatalogError?: (socket: Socket, error: unknown) => void
}

export type AttachCatRPCHandle = {
	detach: () => void
}

function rpcValidationError(
	requestId: string,
	fnKey: string,
	label: string,
	message: string,
	start: number,
): RpcResponse {
	return {
		type: 'RPC_RESPONSE',
		requestId,
		fnKey,
		status: 'error',
		result: null,
		returnType: 'error',
		returnShape: null,
		label,
		duration: `${(performance.now() - start).toFixed(2)}ms`,
		error: { message, stack: null, layer: 'validation', code: label },
	}
}

function readSocketAuthToken(socket: Socket): string | undefined {
	const a = socket.handshake.auth as Record<string, unknown> | undefined
	return typeof a?.token === 'string' ? a.token : undefined
}

function rpcThrownError(
	requestId: string,
	fnKey: string,
	label: string,
	message: string,
	start: number,
	layer: RpcErrorDetail['layer'],
	stack: string | null,
): RpcResponse {
	return {
		type: 'RPC_RESPONSE',
		requestId,
		fnKey,
		status: 'error',
		result: null,
		returnType: 'error',
		returnShape: null,
		label,
		duration: `${(performance.now() - start).toFixed(2)}ms`,
		error: {
			message,
			stack,
			layer,
			code: layer === 'unexpected' ? 'UNEXPECTED_ERROR' : label,
		},
	}
}

export async function invokeExpressPlayground(
	requestId: string,
	fnKey: string,
	expressPayload: ExpressPlaygroundPayload,
	createMocks: typeof createExpressPlaygroundMocks,
): Promise<RpcResponse> {
	const start = performance.now()
	if (!fnKey.includes('.')) {
		return rpcValidationError(
			requestId,
			fnKey,
			'INVALID_FN_KEY',
			'must be ClassName.methodName',
			start,
		)
	}
	const entry = Registry.get(fnKey)
	if (!entry) {
		return rpcValidationError(requestId, fnKey, 'FN_NOT_FOUND', 'Not found', start)
	}
	if (entry.mode !== 'api_candidate' && entry.mode !== 'api') {
		return rpcValidationError(
			requestId,
			fnKey,
			'NOT_EXPRESS',
			`fnKey is not an Express handler (mode=${entry.mode})`,
			start,
		)
	}
	const resolved = resolveExpressCallableForInvoke(requestId, fnKey, entry, start)
	if ('error' in resolved) return resolved.error
	const { callable, callThis } = resolved

	clearExpressApiInvokeCapture()
	normalizeExpressPayloadFilesForPlayground(expressPayload)
	const { req, res, next, getCapture } = createMocks(expressPayload)
	LabelCapture.clear()
	ErrorCapture.clear()
	try {
		if (entry.mode === 'api') ApiContext.set(fnKey)
		else ActiveContext.push(fnKey)

		const paramCount = entry.params.length
		let returnValue: unknown
		if (paramCount >= 3) {
			returnValue = await callable.call(callThis, req, res, next)
		} else {
			returnValue = await callable.call(callThis, req, res)
		}
		const capture = getCapture()
		const apiCapture = readExpressApiInvokeCapture(fnKey)
		const rawResult = {
			express: {
				...capture,
				handlerReturn: returnValue,
			},
		}
		const ser = maybeSerializeRpcResult(rawResult)
		if (!ser.ok) {
			const duration = `${(performance.now() - start).toFixed(2)}ms`
			broadcast({
				event: 'RPC_EXECUTED',
				requestId,
				fnKey,
				label: 'RESULT_NOT_SERIALIZABLE',
				status: 'error',
				duration,
			})
			return rpcValidationError(
				requestId,
				fnKey,
				'RESULT_NOT_SERIALIZABLE',
				ser.message,
				start,
			)
		}
		const result = ser.value
		const duration = `${(performance.now() - start).toFixed(2)}ms`

		const rpcLabel =
			entry.mode === 'api' && apiCapture?.label ? apiCapture.label : LabelCapture.read()

		const bodyForType =
			entry.mode === 'api' && apiCapture && capture.body !== undefined && capture.body !== null
				? capture.body
				: undefined
		const rpcReturnType =
			entry.mode === 'api' && bodyForType !== undefined ? getType(bodyForType) : getType(returnValue)
		const rpcReturnShape =
			entry.mode === 'api' && bodyForType !== undefined ? getShape(bodyForType) : getShape(result)

		broadcast({
			event: 'RPC_EXECUTED',
			requestId,
			fnKey,
			label: rpcLabel,
			status: 'ok',
			duration,
		})

		const artifacts = extractArtifactsFromResult(result)
		return {
			type: 'RPC_RESPONSE',
			requestId,
			fnKey,
			status: 'ok',
			result,
			returnType: rpcReturnType,
			returnShape: rpcReturnShape,
			label: rpcLabel,
			duration,
			error: null,
			...(artifacts ? { artifacts } : {}),
		}
	} catch (err: unknown) {
		const duration = `${(performance.now() - start).toFixed(2)}ms`
		const message = err instanceof Error ? err.message : 'error'
		const stack = err instanceof Error ? (err.stack ?? null) : null
		const captured = ErrorCapture.read()
		const label = captured?.label ?? 'UNEXPECTED_ERROR'
		const layer: RpcErrorDetail['layer'] = captured ? 'expected' : 'unexpected'
		broadcast({
			event: 'RPC_EXECUTED',
			requestId,
			fnKey,
			label,
			status: 'error',
			duration,
		})
		return rpcThrownError(requestId, fnKey, label, message, start, layer, stack)
	} finally {
		ApiContext.clear()
		ActiveContext.pop()
		clearExpressApiInvokeCapture()
	}
}

export function resolveExpressCallableForInvoke(
	requestId: string,
	fnKey: string,
	entry: RegistryEntry,
	start: number,
):
	| { callable: (...args: unknown[]) => unknown; callThis: unknown }
	| { error: RpcResponse } {
	const [className, methodName] = fnKey.split('.') as [string, string]
	if (entry.style === 'function') {
		const callable =
			typeof entry.originalFn === 'function'
				? (entry.originalFn as (...args: unknown[]) => unknown)
				: null
		if (!callable) {
			return {
				error: rpcValidationError(
					requestId,
					fnKey,
					'NOT_A_FUNCTION',
					`${fnKey} not callable`,
					start,
				),
			}
		}
		return { callable, callThis: undefined }
	}

	const instance = InstanceRegistry.get(className)
	if (!instance) {
		return {
			error: rpcValidationError(
				requestId,
				fnKey,
				'NO_INSTANCE',
				`No instance for ${className}`,
				start,
			),
		}
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const maybeFn = (instance as any)[methodName]
	if (typeof maybeFn !== 'function') {
		return {
			error: rpcValidationError(
				requestId,
				fnKey,
				'NOT_A_FUNCTION',
				`${methodName} not callable`,
				start,
			),
		}
	}
	return { callable: maybeFn as (...args: unknown[]) => unknown, callThis: instance }
}

/**
 * Register Socket.IO catalog + RPC playground handlers and optional broadcast bridge.
 */
export function attachCatRPC(io: Server, options: AttachCatRPCOptions): AttachCatRPCHandle {
	validateBootstrapStorage(options.storage ?? options.bootstrap?.storage)
	configureInvokeRateLimit(options.invokeRateLimit ?? null)
	setInvokeTimeoutMs(options.invokeTimeoutMs ?? options.bootstrap?.invokeTimeoutMs)

	const hostMinioResolved = options.bootstrap?.hostMinio
	const mergedQaFileWireMode: QaFileWireMode =
		options.qaFileWire?.mode ?? options.bootstrap?.qaFileWire?.mode ?? 'ref'
	const mergedQaMediaUploadTarget: QaMediaUploadTarget =
		options.qaMediaUpload?.target ?? options.bootstrap?.qaMediaUpload?.target ?? 'admin'
	const qaHostMediaUploadViaSocket =
		mergedQaFileWireMode === 'url' &&
		mergedQaMediaUploadTarget === 'host' &&
		Boolean(hostMinioResolved)
	const hostMediaUploadStore = qaHostMediaUploadViaSocket
		? new InMemoryUploadStore({
				maxSizeBytes: options.upload?.maxSizeBytes ?? 50 * 1024 * 1024,
				idleTimeoutMs: options.upload?.idleTimeoutMs ?? 60_000,
			})
		: null

	const isDevelopment = options.isDevelopment ?? process.env.NODE_ENV !== 'production'
	const rpcAuthSecret = options.rpcAuth?.token
	let unregisterRpcAuth: (() => void) | undefined
	if (rpcAuthSecret && !isDevelopment) {
		unregisterRpcAuth = registerPreInvoke((ctx) => {
			if (ctx.authToken !== rpcAuthSecret) {
				const rid = ctx.requestId ?? 'unknown'
				return rpcValidationError(
					rid,
					ctx.fnKey,
					'UNAUTHENTICATED',
					'missing or invalid auth.token for RPC',
					performance.now(),
				)
			}
			return undefined
		})
	}
	const forwardBroadcast = options.forwardBroadcast !== false
	const emitUnscoped = options.emitUnscopedBroadcasts === true
	const serverId = options.serverId ?? 'cat-inspector'
	const createMocks = options.createExpressMocks ?? createExpressPlaygroundMocks
	const hooks = options.hooks ?? {}
	const uploadEnabled = options.upload?.enabled === true
	const uploadStore = uploadEnabled
		? new InMemoryUploadStore({
				maxSizeBytes: options.upload?.maxSizeBytes ?? 50 * 1024 * 1024,
				idleTimeoutMs: options.upload?.idleTimeoutMs ?? 60_000,
			})
		: null

	let httpInspectorBroadcastEnabled = false

	function computeFingerprint(): string {
		return computeCatalogFingerprint({
			scanRoots: options.scanRoots,
			getAllTsFilesOptions: options.bootstrap?.getAllTsFilesOptions,
			compilerOptions: options.bootstrap?.compilerOptions,
			expandParamTypes: options.bootstrap?.expandParamTypes,
			expandParamTypesOptions: options.bootstrap?.expandParamTypesOptions,
			redactBodies: options.bootstrap?.redactBodies,
			protocolVersion: Number(PROTOCOL_VERSION),
		})
	}

	async function computeBootstrapPayload(catalogHash: string): Promise<BootstrapPayload> {
		const inner = { ...options.bootstrap } as Partial<BootstrapOptions> | undefined
		if (inner && 'hostMinio' in inner) {
			delete (inner as { hostMinio?: unknown }).hostMinio
		}
		const boot = await bootstrap({
			scanRoots: options.scanRoots,
			wsPort: 0,
			enableWebSocket: false,
			registerSignalHandlers: false,
			logLevel: 'error',
			...inner,
			storage: options.storage ?? options.bootstrap?.storage,
			rpcSerialization: options.rpcSerialization ?? options.bootstrap?.rpcSerialization,
			invokeTimeoutMs: options.invokeTimeoutMs ?? options.bootstrap?.invokeTimeoutMs,
			qaFileWire: options.qaFileWire ?? options.bootstrap?.qaFileWire,
			qaMediaUpload: options.qaMediaUpload ?? options.bootstrap?.qaMediaUpload,
			fileUrl: options.fileUrl ?? options.bootstrap?.fileUrl,
			qaMediaUploadHostUploadUrl:
				options.qaMediaUploadHostUploadUrl ?? options.bootstrap?.qaMediaUploadHostUploadUrl,
		})
		await boot.shutdown()
		const wireExtras = buildCatalogWireExtras({
			qaFileWire: options.qaFileWire ?? options.bootstrap?.qaFileWire,
			qaMediaUpload: options.qaMediaUpload ?? options.bootstrap?.qaMediaUpload,
			fileUrl: options.fileUrl ?? options.bootstrap?.fileUrl,
			qaMediaUploadHostUploadUrl:
				options.qaMediaUploadHostUploadUrl ?? options.bootstrap?.qaMediaUploadHostUploadUrl,
		})
		const registryForWire = enrichRegistryParamsWithWireHints(
			boot.registry as Record<string, RegistryEntry>,
			wireExtras,
		)
		return {
			event: 'BOOTSTRAP',
			protocolVersion: Number(PROTOCOL_VERSION),
			catalogHash,
			registry: registryForWire as Record<string, unknown>,
			tree: boot.tree,
			qaFileWire: wireExtras.qaFileWire,
			...(wireExtras.qaMediaUpload ? { qaMediaUpload: wireExtras.qaMediaUpload } : {}),
			...(wireExtras.fileUrl ? { fileUrl: wireExtras.fileUrl } : {}),
			...(wireExtras.qaMediaUploadHostUploadUrl
				? { qaMediaUploadHostUploadUrl: wireExtras.qaMediaUploadHostUploadUrl }
				: {}),
			...(qaHostMediaUploadViaSocket ? { qaHostMediaUploadViaSocket: true as const } : {}),
		}
	}

	const catalogCache = createCatalogBootstrapCache({
		computeFingerprint,
		computePayload: computeBootstrapPayload,
	})

	function withSecretBootstrapPayload(
		payload: Omit<BootstrapPayload, 'secretApiKey'>,
	): BootstrapPayload {
		const t = options.secretApiKey?.trim()
		return t ? { ...payload, secretApiKey: t } : payload
	}

	const sinkRegistered = forwardBroadcast
	if (sinkRegistered) {
		setBroadcastSink((data: object) => {
			const store = getInspectorBroadcastStore()
			if (!store) {
				if (emitUnscoped) {
					io.emit(INSPECTOR_BROADCAST_EVENT, data)
				}
				return
			}
			const { socketId, source } = store
			if (!forwardBroadcast) return
			if (source === 'http') {
				if (!isDevelopment || !httpInspectorBroadcastEnabled) return
			}
			io.to(socketId).emit(INSPECTOR_BROADCAST_EVENT, data)
		})
	}

	function emitHttpInspectorState() {
		io.emit('playground:httpInspector:state', {
			supported: isDevelopment,
			enabled: httpInspectorBroadcastEnabled,
		})
	}

	function onConnection(socket: Socket) {
		void (async () => {
			socket.emit('status', {
				connectedAt: new Date().toISOString(),
				server: serverId,
				socketId: socket.id,
				httpInspector: {
					supported: isDevelopment,
					enabled: httpInspectorBroadcastEnabled,
				},
			})

			try {
				await hooks.onConnection?.(socket)
			} catch {
				/* optional hook */
			}

			try {
				socket.emit('catalog:bootstrap', withSecretBootstrapPayload(await catalogCache.get()))
			} catch (e: unknown) {
				const msg = e instanceof Error ? e.message : 'error'
				socket.emit('catalog:error', { message: msg })
				try {
					hooks.onCatalogError?.(socket, e)
				} catch {
					/* */
				}
			}

			socket.on('catalog:refresh', async () => {
				try {
					socket.emit('catalog:bootstrap', withSecretBootstrapPayload(await catalogCache.refresh()))
				} catch (e: unknown) {
					const msg = e instanceof Error ? e.message : 'error'
					socket.emit('catalog:error', { message: msg })
					try {
						hooks.onCatalogError?.(socket, e)
					} catch {
						/* */
					}
				}
			})

			socket.on('playground:session:create', (raw: unknown, ack: (r: unknown) => void) => {
				try {
					const sessionKey =
						raw && typeof raw === 'object' && 'sessionKey' in raw
							? String((raw as { sessionKey?: unknown }).sessionKey ?? '')
							: undefined
					const requestId = randomUUID()
					const { sessionId } = sessionCreate(sessionKey || undefined)
					ack?.({
						ok: true,
						requestId,
						sessionId,
						protocolVersion: Number(PROTOCOL_VERSION),
					})
				} catch (e: unknown) {
					const msg = e instanceof Error ? e.message : 'error'
					ack?.({ ok: false, message: msg })
				}
			})

			socket.on('playground:session:step', (raw: unknown, ack: (r: unknown) => void) => {
				try {
					if (!raw || typeof raw !== 'object') {
						ack?.({ ok: false, message: 'expected object' })
						return
					}
					const o = raw as Record<string, unknown>
					const sessionId = typeof o.sessionId === 'string' ? o.sessionId : ''
					const step = typeof o.step === 'string' ? o.step : ''
					if (!sessionId || !step) {
						ack?.({ ok: false, message: 'sessionId and step required' })
						return
					}
					const { data } = sessionStep(sessionId, step, o.payload)
					ack?.({
						ok: true,
						protocolVersion: Number(PROTOCOL_VERSION),
						sessionId,
						data,
					})
				} catch (e: unknown) {
					const msg = e instanceof Error ? e.message : 'error'
					ack?.({ ok: false, message: msg })
				}
			})

			socket.on('coverage:request', async () => {
				try {
					const boot = await catalogCache.get()
					const { report } = computeCoverageReport({
						scanRoots: options.scanRoots,
						registrySnapshot: boot.registry as Record<string, RegistryEntry>,
					})
					socket.emit('coverage:report', {
						...report,
						meta: { ...report.meta, protocolVersion: Number(PROTOCOL_VERSION) },
					})
				} catch (e: unknown) {
					const msg = e instanceof Error ? e.message : 'error'
					socket.emit('coverage:error', { message: msg })
				}
			})

			socket.on('playground:setHttpInspector', (raw: unknown) => {
				let enabled = false
				if (raw && typeof raw === 'object' && 'enabled' in raw) {
					enabled = Boolean((raw as { enabled?: unknown }).enabled)
				}
				if (!isDevelopment) {
					socket.emit('playground:httpInspector:ack', {
						enabled,
						applied: false,
						reason: 'not_development',
					})
					return
				}
				httpInspectorBroadcastEnabled = enabled
				socket.emit('playground:httpInspector:ack', {
					enabled: httpInspectorBroadcastEnabled,
					applied: true,
				})
				emitHttpInspectorState()
			})

			socket.on('rpc:call', async (raw: unknown) => {
				const start = performance.now()
				const rid = randomUUID()
				await runWithInspectorBroadcastTarget(
					socket.id,
					async () => {
						try {
							const early = await hooks.onBeforeRpc?.(socket, raw)
							if (early) {
								socket.emit('rpc:response', early)
								await hooks.onAfterRpc?.(socket, early.requestId, early)
								return
							}

							if (!raw || typeof raw !== 'object') {
								socket.emit(
									'rpc:response',
									rpcValidationError(rid, '', 'INVALID_PAYLOAD', 'expected object', start),
								)
								return
							}
							const p = raw as Record<string, unknown>
							const requestId = typeof p.requestId === 'string' ? p.requestId : ''
							const fnKey = typeof p.fnKey === 'string' ? p.fnKey : ''
							if (!requestId || !fnKey) {
								socket.emit(
									'rpc:response',
									rpcValidationError(
										requestId || rid,
										fnKey,
										'INVALID_PAYLOAD',
										'requestId and fnKey are required',
										start,
									),
								)
								return
							}

							const kind = p.kind
							let resp: RpcResponse
							if (kind === 'service') {
								if (!Array.isArray(p.args)) {
									resp = rpcValidationError(
										requestId,
										fnKey,
										'INVALID_PAYLOAD',
										'args must be an array',
										start,
									)
									socket.emit('rpc:response', resp)
									await hooks.onAfterRpc?.(socket, requestId, resp)
									return
								}
								const entry = Registry.get(fnKey)
								if (entry && entry.mode !== 'service') {
									resp = rpcValidationError(
										requestId,
										fnKey,
										'KIND_MISMATCH',
										'use kind: express for this fnKey',
										start,
									)
									socket.emit('rpc:response', resp)
									await hooks.onAfterRpc?.(socket, requestId, resp)
									return
								}
								let nextArgs = p.args as unknown[]
								const mergedFileUrl = options.fileUrl ?? options.bootstrap?.fileUrl
								const mergedQaFileWire = options.qaFileWire ?? options.bootstrap?.qaFileWire
								const canMatRefs = Boolean(uploadEnabled && uploadStore && entry)
								const canMatUrls = Boolean(
									entry && mergedFileUrl?.allowedHosts && mergedFileUrl.allowedHosts.length > 0,
								)
								if (entry && (canMatRefs || canMatUrls)) {
									try {
										const wantsFile = entry.params.some((pp) => {
											const t = String(pp.type ?? '')
											return /\bFile\b|\bBlob\b/.test(t)
										})
										nextArgs = await materializeServiceArgsForInvoke({
											entry,
											args: nextArgs,
											socketId: socket.id,
											uploadStore: uploadStore ?? null,
											fileUrl: mergedFileUrl ?? null,
											qaFileWire: mergedQaFileWire,
											materializeAs: wantsFile ? 'file' : 'buffer',
										})
									} catch (err: unknown) {
										const message = err instanceof Error ? err.message : 'error'
										resp = rpcValidationError(
											requestId,
											fnKey,
											'UPLOAD_MATERIALIZE_FAILED',
											message,
											start,
										)
										socket.emit('rpc:response', resp)
										await hooks.onAfterRpc?.(socket, requestId, resp)
										return
									}
								}
								const tRpc = performance.now()
								const pre = await runPreInvokes({
									fnKey,
									args: nextArgs,
									socketId: socket.id,
									transport: 'socket.io',
									requestId,
									authToken: readSocketAuthToken(socket),
								})
								if (pre) {
									socket.emit('rpc:response', pre)
									await hooks.onAfterRpc?.(socket, pre.requestId, pre)
									await invokeAudit({
										fnKey,
										requestId: pre.requestId,
										status: pre.status,
										transport: 'socket.io',
										socketId: socket.id,
										durationMs: performance.now() - tRpc,
									})
									return
								}
								if (!invokeRateLimitAllow(socket.id)) {
									resp = rpcValidationError(
										requestId,
										fnKey,
										'RATE_LIMITED',
										`retry after ${invokeRateLimitRetryAfterMs(socket.id)}ms`,
										start,
									)
									socket.emit('rpc:response', resp)
									await hooks.onAfterRpc?.(socket, requestId, resp)
									await invokeAudit({
										fnKey,
										requestId,
										status: 'error',
										transport: 'socket.io',
										socketId: socket.id,
										durationMs: performance.now() - tRpc,
									})
									return
								}
								resp = await executeRPC({ requestId, fnKey, args: nextArgs })
								socket.emit('rpc:response', resp)
								await hooks.onAfterRpc?.(socket, requestId, resp)
								await invokeAudit({
									fnKey,
									requestId,
									status: resp.status,
									transport: 'socket.io',
									socketId: socket.id,
									durationMs: performance.now() - tRpc,
								})
								return
							}

							if (kind === 'express') {
								const ex = p.express
								if (ex !== undefined && ex !== null && typeof ex !== 'object') {
									resp = rpcValidationError(
										requestId,
										fnKey,
										'INVALID_PAYLOAD',
										'express must be an object',
										start,
									)
									socket.emit('rpc:response', resp)
									await hooks.onAfterRpc?.(socket, requestId, resp)
									return
								}
								const entry = Registry.get(fnKey)
								if (entry && entry.mode === 'service') {
									resp = rpcValidationError(
										requestId,
										fnKey,
										'KIND_MISMATCH',
										'use kind: service for this fnKey',
										start,
									)
									socket.emit('rpc:response', resp)
									await hooks.onAfterRpc?.(socket, requestId, resp)
									return
								}
								let expressPayload = (ex ?? {}) as ExpressPlaygroundPayload & {
									files?: Array<{ fieldName: string; ref: { __qaFileRef: string } }>
									filesMany?: Array<
										| { fieldName: string; refs: Array<{ __qaFileRef: string }> }
										| { fieldName: string; refs: { __qaFileRefs: string[] } }
									>
								}
								const mergedFileUrlEx = options.fileUrl ?? options.bootstrap?.fileUrl
								const mergedQaFileWireEx = options.qaFileWire ?? options.bootstrap?.qaFileWire
								if (
									(uploadEnabled && uploadStore) ||
									(mergedFileUrlEx?.allowedHosts && mergedFileUrlEx.allowedHosts.length > 0)
								) {
									try {
										expressPayload = (await materializeExpressPayloadForInvoke({
											socketId: socket.id,
											uploadStore: uploadStore ?? null,
											fileUrl: mergedFileUrlEx ?? null,
											qaFileWire: mergedQaFileWireEx,
											expressPayload,
										})) as any
									} catch (err: unknown) {
										const message = err instanceof Error ? err.message : 'error'
										resp = rpcValidationError(
											requestId,
											fnKey,
											'UPLOAD_MATERIALIZE_FAILED',
											message,
											start,
										)
										socket.emit('rpc:response', resp)
										await hooks.onAfterRpc?.(socket, requestId, resp)
										return
									}
								}
								const tEx = performance.now()
								const preEx = await runPreInvokes({
									fnKey,
									args: [expressPayload],
									socketId: socket.id,
									transport: 'socket.io',
									requestId,
									authToken: readSocketAuthToken(socket),
								})
								if (preEx) {
									socket.emit('rpc:response', preEx)
									await hooks.onAfterRpc?.(socket, preEx.requestId, preEx)
									await invokeAudit({
										fnKey,
										requestId: preEx.requestId,
										status: preEx.status,
										transport: 'socket.io',
										socketId: socket.id,
										durationMs: performance.now() - tEx,
									})
									return
								}
								if (!invokeRateLimitAllow(socket.id)) {
									resp = rpcValidationError(
										requestId,
										fnKey,
										'RATE_LIMITED',
										`retry after ${invokeRateLimitRetryAfterMs(socket.id)}ms`,
										start,
									)
									socket.emit('rpc:response', resp)
									await hooks.onAfterRpc?.(socket, requestId, resp)
									await invokeAudit({
										fnKey,
										requestId,
										status: 'error',
										transport: 'socket.io',
										socketId: socket.id,
										durationMs: performance.now() - tEx,
									})
									return
								}
								resp = await invokeExpressPlayground(
									requestId,
									fnKey,
									expressPayload,
									createMocks,
								)
								socket.emit('rpc:response', resp)
								await hooks.onAfterRpc?.(socket, requestId, resp)
								await invokeAudit({
									fnKey,
									requestId,
									status: resp.status,
									transport: 'socket.io',
									socketId: socket.id,
									durationMs: performance.now() - tEx,
								})
								return
							}

							resp = rpcValidationError(
								requestId,
								fnKey,
								'INVALID_PAYLOAD',
								'kind must be service or express',
								start,
							)
							socket.emit('rpc:response', resp)
							await hooks.onAfterRpc?.(socket, requestId, resp)
						} catch (e: unknown) {
							const msg = e instanceof Error ? e.message : 'error'
							const resp = rpcThrownError(
								rid,
								'',
								'UNEXPECTED_ERROR',
								msg,
								start,
								'unexpected',
								null,
							)
							socket.emit('rpc:response', resp)
							await hooks.onAfterRpc?.(socket, resp.requestId, resp)
						}
					},
					{ source: 'rpc' },
				)
			})

			// --- Binary upload (non-JSON) ---
			if (uploadEnabled && uploadStore) {
				socket.on('qa:upload:start', (raw: unknown) => {
					try {
						if (!raw || typeof raw !== 'object') {
							socket.emit('qa:upload:error', { code: 'INVALID_PAYLOAD', message: 'expected object' })
							return
						}
						const p = raw as Record<string, unknown>
						const filename = typeof p.filename === 'string' ? p.filename : 'upload.bin'
						const contentType = typeof p.contentType === 'string' ? p.contentType : 'application/octet-stream'
						const sizeBytes = typeof p.sizeBytes === 'number' ? p.sizeBytes : NaN
						const uploadId = typeof p.uploadId === 'string' ? p.uploadId : undefined
						if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
							socket.emit('qa:upload:error', {
								uploadId: uploadId ?? null,
								code: 'INVALID_PAYLOAD',
								message: 'sizeBytes must be a number',
							})
							return
						}
						const meta = uploadStore.start(socket.id, { uploadId, filename, contentType, sizeBytes })
						socket.emit('qa:upload:ack', { uploadId: meta.uploadId, accepted: true })
					} catch (err: unknown) {
						const message = err instanceof Error ? err.message : 'error'
						socket.emit('qa:upload:error', { code: 'UPLOAD_START_FAILED', message })
					}
				})

				socket.on('qa:upload:chunk', (chunk: unknown) => {
					try {
						const buf = Buffer.isBuffer(chunk)
							? chunk
							: chunk instanceof ArrayBuffer
								? Buffer.from(chunk)
								: null
						if (!buf) {
							socket.emit('qa:upload:error', { code: 'INVALID_CHUNK', message: 'expected Buffer/ArrayBuffer' })
							return
						}
						const { uploadId, receivedBytes } = uploadStore.writeChunk(socket.id, buf)
						socket.emit('qa:upload:progress', { uploadId, receivedBytes })
					} catch (err: unknown) {
						const message = err instanceof Error ? err.message : 'error'
						socket.emit('qa:upload:error', { code: 'UPLOAD_CHUNK_FAILED', message })
					}
				})

				socket.on('qa:upload:finish', (raw: unknown) => {
					try {
						if (!raw || typeof raw !== 'object') {
							socket.emit('qa:upload:error', { code: 'INVALID_PAYLOAD', message: 'expected object' })
							return
						}
						const p = raw as Record<string, unknown>
						const uploadId = typeof p.uploadId === 'string' ? p.uploadId : ''
						if (!uploadId) {
							socket.emit('qa:upload:error', { code: 'INVALID_PAYLOAD', message: 'uploadId required' })
							return
						}
						const done = uploadStore.finish(socket.id, uploadId)
						socket.emit('qa:upload:complete', {
							uploadId: done.uploadId,
							sizeBytes: done.sizeBytes,
							filename: done.filename,
							contentType: done.contentType,
						})
					} catch (err: unknown) {
						const message = err instanceof Error ? err.message : 'error'
						socket.emit('qa:upload:error', { code: 'UPLOAD_FINISH_FAILED', message })
					}
				})

				socket.on('qa:upload:abort', () => {
					try {
						uploadStore.abort(socket.id)
						socket.emit('qa:upload:ack', { aborted: true })
					} catch (err: unknown) {
						const message = err instanceof Error ? err.message : 'error'
						socket.emit('qa:upload:error', { code: 'UPLOAD_ABORT_FAILED', message })
					}
				})

				socket.on('disconnect', () => {
					try {
						uploadStore.abort(socket.id)
					} catch {
						// ignore
					}
				})
			}

			// --- Host Minio media over Socket (URL wire + host target + bootstrap.hostMinio) ---
			if (qaHostMediaUploadViaSocket && hostMediaUploadStore && hostMinioResolved) {
				const hm = hostMinioResolved
				socket.on('qa:hostMedia:start', (raw: unknown) => {
					try {
						if (!raw || typeof raw !== 'object') {
							socket.emit('qa:hostMedia:error', { code: 'INVALID_PAYLOAD', message: 'expected object' })
							return
						}
						const p = raw as Record<string, unknown>
						const filename = typeof p.filename === 'string' ? p.filename : 'upload.bin'
						const contentType = typeof p.contentType === 'string' ? p.contentType : 'application/octet-stream'
						const sizeBytes = typeof p.sizeBytes === 'number' ? p.sizeBytes : NaN
						const uploadId = typeof p.uploadId === 'string' ? p.uploadId : undefined
						if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
							socket.emit('qa:hostMedia:error', {
								uploadId: uploadId ?? null,
								code: 'INVALID_PAYLOAD',
								message: 'sizeBytes must be a number',
							})
							return
						}
						const meta = hostMediaUploadStore.start(socket.id, { uploadId, filename, contentType, sizeBytes })
						socket.emit('qa:hostMedia:ack', { uploadId: meta.uploadId, accepted: true })
					} catch (err: unknown) {
						const message = err instanceof Error ? err.message : 'error'
						socket.emit('qa:hostMedia:error', { code: 'HOST_MEDIA_START_FAILED', message })
					}
				})

				socket.on('qa:hostMedia:chunk', (chunk: unknown) => {
					try {
						const buf = Buffer.isBuffer(chunk)
							? chunk
							: chunk instanceof ArrayBuffer
								? Buffer.from(chunk)
								: null
						if (!buf) {
							socket.emit('qa:hostMedia:error', { code: 'INVALID_CHUNK', message: 'expected Buffer/ArrayBuffer' })
							return
						}
						const { uploadId, receivedBytes } = hostMediaUploadStore.writeChunk(socket.id, buf)
						socket.emit('qa:hostMedia:progress', { uploadId, receivedBytes })
					} catch (err: unknown) {
						const message = err instanceof Error ? err.message : 'error'
						socket.emit('qa:hostMedia:error', { code: 'HOST_MEDIA_CHUNK_FAILED', message })
					}
				})

				socket.on('qa:hostMedia:finish', async (raw: unknown) => {
					let finishUploadId = ''
					try {
						if (!raw || typeof raw !== 'object') {
							socket.emit('qa:hostMedia:error', { code: 'INVALID_PAYLOAD', message: 'expected object' })
							return
						}
						const p = raw as Record<string, unknown>
						finishUploadId = typeof p.uploadId === 'string' ? p.uploadId : ''
						if (!finishUploadId) {
							socket.emit('qa:hostMedia:error', { code: 'INVALID_PAYLOAD', message: 'uploadId required' })
							return
						}
						const done = hostMediaUploadStore.finish(socket.id, finishUploadId)
						const objectKey = `qa-host-media/${Date.now()}-${randomUUID()}`
						const { getUrl } = await putBufferAndPresignGetUrl(hm, {
							objectKey,
							buffer: done.buffer,
							contentType: done.contentType || 'application/octet-stream',
						})
						socket.emit('qa:hostMedia:complete', { uploadId: done.uploadId, getUrl })
					} catch (err: unknown) {
						const message = err instanceof Error ? err.message : 'error'
						socket.emit('qa:hostMedia:error', {
							code: 'HOST_MEDIA_FINISH_FAILED',
							message,
							uploadId: finishUploadId || null,
						})
					}
				})

				socket.on('qa:hostMedia:abort', () => {
					try {
						hostMediaUploadStore.abort(socket.id)
						socket.emit('qa:hostMedia:ack', { aborted: true })
					} catch (err: unknown) {
						const message = err instanceof Error ? err.message : 'error'
						socket.emit('qa:hostMedia:error', { code: 'HOST_MEDIA_ABORT_FAILED', message })
					}
				})

				socket.on('disconnect', () => {
					try {
						hostMediaUploadStore.abort(socket.id)
					} catch {
						// ignore
					}
				})
			}
		})()
	}

	io.on('connection', onConnection)

	return {
		detach: () => {
			unregisterRpcAuth?.()
			configureInvokeRateLimit(null)
			io.off('connection', onConnection)
			if (sinkRegistered) {
				clearBroadcastSink()
			}
		},
	}
}
