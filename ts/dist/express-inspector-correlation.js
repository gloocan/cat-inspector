import { randomUUID } from 'node:crypto';
import { readInspectorSocketIdFromHeaders } from './registry-state.js';
/**
 * Non-enumerable request metadata so HTTP inspector broadcasts stay correlated when
 * middleware defers `next()` (multipart parsers, microtasks, etc.) and AsyncLocalStorage
 * from an outer scope is no longer active.
 */
export const INSPECTOR_HTTP_META = Symbol.for('@gloocan/cat-inspector-http');
export function attachInspectorHttpMeta(req, meta) {
    Object.defineProperty(req, INSPECTOR_HTTP_META, {
        value: meta,
        enumerable: false,
        writable: true,
        configurable: true,
    });
}
/** Read metadata attached by {@link createInspectorCorrelationMiddleware}. */
export function readInspectorHttpMeta(req) {
    if (!req || typeof req !== 'object')
        return undefined;
    const v = req[INSPECTOR_HTTP_META];
    if (!v || typeof v !== 'object')
        return undefined;
    const o = v;
    const socketId = typeof o.socketId === 'string' ? o.socketId : '';
    const correlationId = typeof o.correlationId === 'string' ? o.correlationId : '';
    if (!socketId.trim() || !correlationId.trim())
        return undefined;
    if (o.source !== 'http')
        return undefined;
    return { socketId, correlationId, source: 'http' };
}
/**
 * When `X-Socket-Id` is present, attaches per-request inspector metadata on `req` so
 * {@link registerCatPipeline} can re-enter `runWithInspectorBroadcastTarget` for each
 * wrapped handler (survives deferred `next()` and async gaps). Does not wrap `next()` in ALS.
 */
export function createInspectorCorrelationMiddleware() {
    return (req, _res, next) => {
        const id = readInspectorSocketIdFromHeaders(req.headers);
        if (!id) {
            next();
            return;
        }
        const correlationId = randomUUID();
        attachInspectorHttpMeta(req, { socketId: id, correlationId, source: 'http' });
        next();
    };
}
//# sourceMappingURL=express-inspector-correlation.js.map