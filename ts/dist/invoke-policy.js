const preHooks = [];
const auditHooks = [];
const rateBuckets = new Map();
let rateOpts = null;
export function registerPreInvoke(hook) {
    preHooks.push(hook);
    return () => {
        const i = preHooks.indexOf(hook);
        if (i >= 0)
            preHooks.splice(i, 1);
    };
}
export function registerInvokeAudit(hook) {
    auditHooks.push(hook);
    return () => {
        const i = auditHooks.indexOf(hook);
        if (i >= 0)
            auditHooks.splice(i, 1);
    };
}
export function configureInvokeRateLimit(opts) {
    rateOpts = opts;
    rateBuckets.clear();
}
export function resetInvokePolicy() {
    preHooks.length = 0;
    auditHooks.length = 0;
    rateOpts = null;
    rateBuckets.clear();
}
export async function runPreInvokes(ctx) {
    for (const h of preHooks) {
        const r = await h(ctx);
        if (r && typeof r === 'object' && r.type === 'RPC_RESPONSE') {
            return r;
        }
    }
    return undefined;
}
export function invokeRateLimitAllow(key) {
    if (!rateOpts)
        return true;
    const now = Date.now();
    let b = rateBuckets.get(key);
    if (!b || now >= b.resetAt) {
        b = { count: 0, resetAt: now + rateOpts.windowMs };
        rateBuckets.set(key, b);
    }
    if (b.count >= rateOpts.maxInvokesPerWindow)
        return false;
    b.count++;
    return true;
}
export function invokeRateLimitRetryAfterMs(key) {
    if (!rateOpts)
        return 0;
    const b = rateBuckets.get(key);
    if (!b)
        return 0;
    return Math.max(0, b.resetAt - Date.now());
}
export async function invokeAudit(evt) {
    for (const h of auditHooks) {
        try {
            await h(evt);
        }
        catch {
            /* audit must not break invoke */
        }
    }
}
//# sourceMappingURL=invoke-policy.js.map