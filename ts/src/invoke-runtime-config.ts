/** Optional max duration for a single RPC handler `await` (host-wide). */
let invokeTimeoutMs: number | undefined

export function getInvokeTimeoutMs(): number | undefined {
	return invokeTimeoutMs
}

export function setInvokeTimeoutMs(ms: number | undefined): void {
	if (ms !== undefined && (!Number.isFinite(ms) || ms <= 0)) {
		throw new Error('invokeTimeoutMs must be a positive finite number when set')
	}
	invokeTimeoutMs = ms
}

export function resetInvokeTimeoutMs(): void {
	invokeTimeoutMs = undefined
}
