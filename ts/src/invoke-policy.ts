import type { RpcResponse } from './types.js'

export type InvokeTransport = 'socket.io' | 'websocket'

export type PreInvokeContext = {
	fnKey: string
	args: unknown[]
	socketId: string | undefined
	transport: InvokeTransport
	/** Present for Socket.IO `rpc:call` and embedded ws `RPC_CALL` when the client supplied a token. */
	requestId?: string
	/** Socket.IO: `handshake.auth.token`. WebSocket: `?token=` query when present. */
	authToken?: string | undefined
}

export type PreInvokeHook = (
	ctx: PreInvokeContext,
) => void | RpcResponse | Promise<void | RpcResponse>

export type InvokeAuditEvent = {
	fnKey: string
	requestId: string
	status: 'ok' | 'error'
	transport: InvokeTransport
	socketId: string | undefined
	durationMs: number
}

export type InvokeAuditHook = (evt: InvokeAuditEvent) => void | Promise<void>

const preHooks: PreInvokeHook[] = []
const auditHooks: InvokeAuditHook[] = []

type Bucket = { count: number; resetAt: number }
const rateBuckets = new Map<string, Bucket>()
let rateOpts: { maxInvokesPerWindow: number; windowMs: number } | null = null

export function registerPreInvoke(hook: PreInvokeHook): () => void {
	preHooks.push(hook)
	return () => {
		const i = preHooks.indexOf(hook)
		if (i >= 0) preHooks.splice(i, 1)
	}
}

export function registerInvokeAudit(hook: InvokeAuditHook): () => void {
	auditHooks.push(hook)
	return () => {
		const i = auditHooks.indexOf(hook)
		if (i >= 0) auditHooks.splice(i, 1)
	}
}

export function configureInvokeRateLimit(
	opts: { maxInvokesPerWindow: number; windowMs: number } | null,
): void {
	rateOpts = opts
	rateBuckets.clear()
}

export function resetInvokePolicy(): void {
	preHooks.length = 0
	auditHooks.length = 0
	rateOpts = null
	rateBuckets.clear()
}

export async function runPreInvokes(ctx: PreInvokeContext): Promise<RpcResponse | undefined> {
	for (const h of preHooks) {
		const r = await h(ctx)
		if (r && typeof r === 'object' && (r as RpcResponse).type === 'RPC_RESPONSE') {
			return r as RpcResponse
		}
	}
	return undefined
}

export function invokeRateLimitAllow(key: string): boolean {
	if (!rateOpts) return true
	const now = Date.now()
	let b = rateBuckets.get(key)
	if (!b || now >= b.resetAt) {
		b = { count: 0, resetAt: now + rateOpts.windowMs }
		rateBuckets.set(key, b)
	}
	if (b.count >= rateOpts.maxInvokesPerWindow) return false
	b.count++
	return true
}

export function invokeRateLimitRetryAfterMs(key: string): number {
	if (!rateOpts) return 0
	const b = rateBuckets.get(key)
	if (!b) return 0
	return Math.max(0, b.resetAt - Date.now())
}

export async function invokeAudit(evt: InvokeAuditEvent): Promise<void> {
	for (const h of auditHooks) {
		try {
			await h(evt)
		} catch {
			/* audit must not break invoke */
		}
	}
}
