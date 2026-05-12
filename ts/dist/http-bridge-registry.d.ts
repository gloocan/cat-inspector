import type { Express } from 'express';
import type { HttpMethod } from './express.js';
export type HttpBridgeSpec = {
    app: Express;
    method: HttpMethod;
    path: string;
    mapArgsToBody: (args: unknown[]) => unknown;
};
/**
 * Map a catalogued `fnKey` to an in-process HTTP call (Pattern B). Requires an existing `Registry` entry.
 * Side effect: sets `entry.invokeKind = 'http_synthetic'`.
 */
export declare function registerHttpBridgeRoute(app: Express, spec: {
    fnKey: string;
    method: HttpMethod;
    path: string;
    mapArgsToBody: (args: unknown[]) => unknown;
}): void;
export declare function getHttpBridgeSpec(fnKey: string): HttpBridgeSpec | undefined;
export declare function clearHttpBridgeRegistry(): void;
export declare function runHttpBridgeInvoke(spec: HttpBridgeSpec, args: unknown[]): Promise<{
    statusCode: number;
    headers: Record<string, string>;
    body: unknown;
}>;
//# sourceMappingURL=http-bridge-registry.d.ts.map