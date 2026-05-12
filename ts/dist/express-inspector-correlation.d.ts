import type { RequestHandler } from 'express';
import type { InspectorBroadcastSource } from './registry-state.js';
/**
 * Non-enumerable request metadata so HTTP inspector broadcasts stay correlated when
 * middleware defers `next()` (multipart parsers, microtasks, etc.) and AsyncLocalStorage
 * from an outer scope is no longer active.
 */
export declare const INSPECTOR_HTTP_META: unique symbol;
export type InspectorHttpRequestMeta = {
    socketId: string;
    correlationId: string;
    source: Extract<InspectorBroadcastSource, 'http'>;
};
export declare function attachInspectorHttpMeta(req: object, meta: InspectorHttpRequestMeta): void;
/** Read metadata attached by {@link createInspectorCorrelationMiddleware}. */
export declare function readInspectorHttpMeta(req: unknown): InspectorHttpRequestMeta | undefined;
/**
 * When `X-Socket-Id` is present, attaches per-request inspector metadata on `req` so
 * {@link registerCatPipeline} can re-enter `runWithInspectorBroadcastTarget` for each
 * wrapped handler (survives deferred `next()` and async gaps). Does not wrap `next()` in ALS.
 */
export declare function createInspectorCorrelationMiddleware(): RequestHandler;
//# sourceMappingURL=express-inspector-correlation.d.ts.map