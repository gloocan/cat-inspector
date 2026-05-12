import { invokeExpressSynthetic } from './express.js';
import { Registry } from './registry-state.js';
const bridges = new Map();
/**
 * Map a catalogued `fnKey` to an in-process HTTP call (Pattern B). Requires an existing `Registry` entry.
 * Side effect: sets `entry.invokeKind = 'http_synthetic'`.
 */
export function registerHttpBridgeRoute(app, spec) {
    const e = Registry.get(spec.fnKey);
    if (!e) {
        throw new Error(`registerHttpBridgeRoute: unknown fnKey "${spec.fnKey}"`);
    }
    if (bridges.has(spec.fnKey)) {
        throw new Error(`registerHttpBridgeRoute: duplicate registration for "${spec.fnKey}"`);
    }
    e.invokeKind = 'http_synthetic';
    bridges.set(spec.fnKey, {
        app,
        method: spec.method,
        path: spec.path,
        mapArgsToBody: spec.mapArgsToBody,
    });
}
export function getHttpBridgeSpec(fnKey) {
    return bridges.get(fnKey);
}
export function clearHttpBridgeRegistry() {
    bridges.clear();
}
export async function runHttpBridgeInvoke(spec, args) {
    const body = spec.mapArgsToBody(args);
    const out = await invokeExpressSynthetic(spec.app, {
        method: spec.method,
        path: spec.path,
        body,
    });
    return { statusCode: out.statusCode, headers: out.headers, body: out.bodyJson };
}
//# sourceMappingURL=http-bridge-registry.js.map