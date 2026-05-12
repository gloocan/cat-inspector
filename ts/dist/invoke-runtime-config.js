/** Optional max duration for a single RPC handler `await` (host-wide). */
let invokeTimeoutMs;
export function getInvokeTimeoutMs() {
    return invokeTimeoutMs;
}
export function setInvokeTimeoutMs(ms) {
    if (ms !== undefined && (!Number.isFinite(ms) || ms <= 0)) {
        throw new Error('invokeTimeoutMs must be a positive finite number when set');
    }
    invokeTimeoutMs = ms;
}
export function resetInvokeTimeoutMs() {
    invokeTimeoutMs = undefined;
}
//# sourceMappingURL=invoke-runtime-config.js.map