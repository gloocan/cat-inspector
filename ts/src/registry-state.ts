import { AsyncLocalStorage } from 'node:async_hooks'
import type { IncomingHttpHeaders } from 'node:http'

import WebSocket from 'ws'

import { resetInvokePolicy } from './invoke-policy.js'
import { resetInvokeTimeoutMs } from './invoke-runtime-config.js'
import { clearHttpBridgeRegistry } from './http-bridge-registry.js'
import { resetParamsJsonSchemaValidators } from './validate-params-json-schema.js'
import { resetReturnJsonSchemaValidators } from './validate-return-json-schema.js'
import { resetRpcSerializationConfig } from './serialize-rpc-result.js'
import { resetSessionStore } from './session-store.js'
import type {
	ApiResponseEvent,
	ErrorThrownEvent,
	JobProgressWireEvent,
	MiddlewareNextEvent,
	ReturnResolvedEvent,
} from './types.js'
import { PROTOCOL_VERSION } from './types.js'

export const Registry = new Map<string, import('./types.js').RegistryEntry>()

/** Live instances for RPC calls */
export const InstanceRegistry = new Map<string, unknown>()

/**
 * Instances resolved implicitly (via resolver or constructor fallback).
 * Kept separate from `InstanceRegistry` so explicit registrations remain visible/distinct.
 */
export const AutoInstanceRegistry = new Map<string, unknown>()

export const ClassConstructorRegistry = new Map<string, new (...args: any[]) => any>()

export function registerClassConstructor(
	className: string,
	ctor: new (...args: any[]) => any,
): void {
	if (!className) return
	const existing = ClassConstructorRegistry.get(className)
	if (existing) {
		// Idempotent: allow repeated registration of the same constructor.
		if (existing === ctor) return
		throw new Error(`registerClassConstructor: duplicate className "${className}"`)
	}
	ClassConstructorRegistry.set(className, ctor)
}

export function resolveInstanceForClassName(className: string): unknown | null {
	const explicit = InstanceRegistry.get(className)
	if (explicit) return explicit

	const cached = AutoInstanceRegistry.get(className)
	if (cached) return cached

	const ctor = ClassConstructorRegistry.get(className)
	if (ctor) {
		const created = new ctor()
		AutoInstanceRegistry.set(className, created)
		return created
	}

	return null
}

export const ActiveContext = {
	stack: [] as string[],
	push(key: string) {
		this.stack.push(key)
	},
	pop(): string | null {
		const v = this.stack.pop()
		return v ?? null
	},
	set(key: string) {
		// Back-compat alias (prefer push/pop).
		this.push(key)
	},
	get(): string | null {
		const v = this.stack[this.stack.length - 1]
		return v ?? null
	},
	clear() {
		// Back-compat: clear entire stack (reset state).
		this.stack = []
	},
}

export const ApiContext = {
	currentEndpoint: null as string | null,
	set(key: string) {
		this.currentEndpoint = key
	},
	get(): string | null {
		return this.currentEndpoint
	},
	clear() {
		this.currentEndpoint = null
	},
}

export const LabelCapture = {
	current: null as string | null,
	capture(label: string) {
		this.current = label
	},
	read(): string | null {
		return this.current
	},
	clear() {
		this.current = null
	},
}

export const ErrorCapture = {
	current: null as { label: string; error: Error } | null,
	capture(label: string, error: Error) {
		this.current = { label, error }
	},
	read(): { label: string; error: Error } | null {
		return this.current
	},
	hasCurrent(): boolean {
		return this.current !== null
	},
	clear() {
		this.current = null
	},
}

/**
 * Last `ApiReturn` payload per endpoint `fnKey`, for correlating express playground RPC
 * with controller-level API semantics. Cleared per express invoke and on inspector reset.
 */
const expressApiInvokeCaptureByEndpoint = new Map<
	string,
	{ label: string; statusCode: number; body: unknown }
>()

export function clearExpressApiInvokeCapture(): void {
	expressApiInvokeCaptureByEndpoint.clear()
}

export function recordExpressApiInvokeCapture(
	endpointKey: string,
	payload: { label: string; statusCode: number; body: unknown },
): void {
	expressApiInvokeCaptureByEndpoint.set(endpointKey, payload)
}

export function readExpressApiInvokeCapture(
	endpointKey: string,
): { label: string; statusCode: number; body: unknown } | undefined {
	return expressApiInvokeCaptureByEndpoint.get(endpointKey)
}

export const wsClients = new Set<WebSocket>()

export type InspectorBroadcastSource = 'rpc' | 'http'

export type InspectorBroadcastStore = {
	socketId: string
	source: InspectorBroadcastSource
	/**
	 * Optional per-request correlation id.
	 * Used by HTTP inspector to group events belonging to a single inbound request.
	 */
	correlationId?: string
	/**
	 * Optional: which pipeline handler is currently executing (middleware or endpoint).
	 * Used to tag API responses so the UI can attribute early responses to the correct middleware.
	 */
	producerFnKey?: string | null
}

const inspectorBroadcastAls = new AsyncLocalStorage<InspectorBroadcastStore>()

/** Optional second fan-out (e.g. Socket.IO); receives same object as native ws broadcast */
let broadcastSink: ((data: object) => void) | null = null

export function setBroadcastSink(fn: ((data: object) => void) | null): void {
	broadcastSink = fn
}

export function clearBroadcastSink(): void {
	broadcastSink = null
}

export function getInspectorBroadcastStore(): InspectorBroadcastStore | undefined {
	return inspectorBroadcastAls.getStore()
}

/**
 * Correlate subsequent `broadcast()` calls with a Socket.IO tab (or other sink).
 * Default source `rpc` (not gated by HTTP inspector toggle). Use `http` from REST middleware.
 */
export function runWithInspectorBroadcastTarget<T>(
	socketId: string,
	fn: () => T,
	options?: { source?: InspectorBroadcastSource; correlationId?: string },
): T {
	const source = options?.source ?? 'rpc'
	return inspectorBroadcastAls.run(
		{ socketId, source, correlationId: options?.correlationId },
		fn,
	)
}

/**
 * Run within the current inspector broadcast store but with an updated producer fnKey.
 * No-op if there is no active inspector store (i.e. no X-Socket-Id correlation).
 */
export function runWithProducerFnKey<T>(producerFnKey: string | null, fn: () => T): T {
	const store = getInspectorBroadcastStore()
	if (!store) return fn()
	return inspectorBroadcastAls.run({ ...store, producerFnKey }, fn)
}

export const INSPECTOR_SOCKET_ID_HEADER = 'x-socket-id'

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
	if (value === undefined) return undefined
	const s = Array.isArray(value) ? value[0] : value
	const t = typeof s === 'string' ? s.trim() : ''
	return t.length > 0 ? t : undefined
}

/** Read Socket.IO correlation id from Express / Node request headers */
export function readInspectorSocketIdFromHeaders(headers: IncomingHttpHeaders): string | undefined {
	return firstHeaderValue(headers[INSPECTOR_SOCKET_ID_HEADER])
}

export function broadcast(data: object): void {
	const msg = JSON.stringify(data)
	for (const client of wsClients) {
		if (client.readyState === WebSocket.OPEN) {
			client.send(msg)
		}
	}
	if (broadcastSink) {
		try {
			broadcastSink(data)
		} catch {
			/* sink errors must not break native ws path */
		}
	}
}

export function broadcastReturnResolved(
	payload: Omit<ReturnResolvedEvent, 'protocolVersion' | 'timestamp'>,
): void {
	const store = getInspectorBroadcastStore()
	const correlationId = payload.correlationId ?? store?.correlationId
	broadcast({
		...payload,
		...(correlationId ? { correlationId } : {}),
		protocolVersion: PROTOCOL_VERSION,
		timestamp: new Date().toISOString(),
	} satisfies ReturnResolvedEvent)
}

export function broadcastErrorThrown(
	payload: Omit<ErrorThrownEvent, 'protocolVersion' | 'timestamp'>,
): void {
	const store = getInspectorBroadcastStore()
	const correlationId = payload.correlationId ?? store?.correlationId
	broadcast({
		...payload,
		...(correlationId ? { correlationId } : {}),
		protocolVersion: PROTOCOL_VERSION,
		timestamp: new Date().toISOString(),
	} satisfies ErrorThrownEvent)
}

export function broadcastApiResponse(
	payload: Omit<ApiResponseEvent, 'protocolVersion' | 'timestamp'>,
): void {
	const store = getInspectorBroadcastStore()
	const correlationId = payload.correlationId ?? store?.correlationId
	const producerFnKey =
		'producerFnKey' in payload
			? (payload as { producerFnKey?: string | null }).producerFnKey
			: (store?.producerFnKey ?? undefined)

	let safeBody: unknown = undefined
	if ('body' in payload) {
		// Best-effort, size-limited JSON clone for inspector display.
		// Prevents huge payloads from spamming the live inspector feed.
		try {
			const asJson = JSON.stringify((payload as { body?: unknown }).body)
			if (asJson.length <= 10_000) {
				safeBody = JSON.parse(asJson) as unknown
			} else {
				safeBody = { __omitted: 'body_too_large', bytes: asJson.length }
			}
		} catch {
			safeBody = { __omitted: 'body_unserializable' }
		}
	}

	const out: ApiResponseEvent = {
		...(payload as Omit<ApiResponseEvent, 'protocolVersion' | 'timestamp'>),
		...(correlationId ? { correlationId } : {}),
		...(producerFnKey !== undefined ? { producerFnKey } : {}),
		...(safeBody !== undefined ? { body: safeBody } : {}),
		protocolVersion: PROTOCOL_VERSION,
		timestamp: new Date().toISOString(),
	}
	broadcast(out)
}

export function broadcastMiddlewareNext(
	payload: Omit<MiddlewareNextEvent, 'protocolVersion' | 'timestamp'>,
): void {
	const store = getInspectorBroadcastStore()
	const correlationId = payload.correlationId ?? store?.correlationId
	broadcast({
		...payload,
		...(correlationId ? { correlationId } : {}),
		protocolVersion: PROTOCOL_VERSION,
		timestamp: new Date().toISOString(),
	} satisfies MiddlewareNextEvent)
}

export function broadcastJobProgress(
	payload: Omit<JobProgressWireEvent, 'event' | 'protocolVersion' | 'timestamp'>,
): void {
	broadcast({
		event: 'JOB_PROGRESS',
		protocolVersion: PROTOCOL_VERSION,
		timestamp: new Date().toISOString(),
		...payload,
	} satisfies JobProgressWireEvent)
}

/** Attach or clear a JSON Schema used by QA to validate RPC `result` for this `fnKey`. */
export function registerReturnJsonSchema(
	fnKey: string,
	schema: Record<string, unknown> | null,
): void {
	const entry = Registry.get(fnKey)
	if (!entry) {
		throw new Error(`registerReturnJsonSchema: unknown fnKey "${fnKey}"`)
	}
	entry.returnJsonSchema = schema
}

/** Attach or clear a JSON Schema used to validate RPC `args` (whole tuple) for this `fnKey`. */
export function registerParamsJsonSchema(
	fnKey: string,
	schema: Record<string, unknown> | null,
): void {
	const entry = Registry.get(fnKey)
	if (!entry) {
		throw new Error(`registerParamsJsonSchema: unknown fnKey "${fnKey}"`)
	}
	entry.paramsJsonSchema = schema
}

export function registerInstance(instance: unknown): void {
	if (typeof instance !== 'object' && typeof instance !== 'function') return
	const name =
		typeof instance === 'object'
			? (instance as { constructor?: { name?: string } }).constructor?.name
			: (instance as { name?: string }).name
	if (!name) return
	if (InstanceRegistry.has(name)) {
		throw new Error(
			`registerInstance: duplicate instance name "${name}" (already registered). Use unique class names or register only once.`,
		)
	}
	InstanceRegistry.set(name, instance)
}

/** Test-only: reset in-memory state */
export function resetInspectorState(): void {
	clearHttpBridgeRegistry()
	resetReturnJsonSchemaValidators()
	resetParamsJsonSchemaValidators()
	Registry.clear()
	InstanceRegistry.clear()
	AutoInstanceRegistry.clear()
	ClassConstructorRegistry.clear()
	ActiveContext.clear()
	ApiContext.clear()
	LabelCapture.clear()
	ErrorCapture.clear()
	clearExpressApiInvokeCapture()
	wsClients.clear()
	clearBroadcastSink()
	resetRpcSerializationConfig()
	resetInvokePolicy()
	resetInvokeTimeoutMs()
	resetSessionStore()
}
