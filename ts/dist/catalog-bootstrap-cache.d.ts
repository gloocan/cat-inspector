export type CatalogBootstrapPayload = {
    event: 'BOOTSTRAP';
    protocolVersion: number;
    catalogHash: string;
    registry: Record<string, unknown>;
    tree: object[];
};
export type CatalogBootstrapCache = {
    get: () => Promise<CatalogBootstrapPayload>;
    refresh: () => Promise<CatalogBootstrapPayload>;
};
/**
 * Small in-memory cache for catalog bootstrap payloads, gated by a fingerprint.
 *
 * - `get()` computes and caches on first call.
 * - `refresh()` recomputes the fingerprint and only rebuilds when it changed.
 * - concurrent callers share a single in-flight promise.
 */
export declare function createCatalogBootstrapCache(input: {
    computeFingerprint: () => string;
    computePayload: (catalogHash: string) => Promise<CatalogBootstrapPayload>;
}): CatalogBootstrapCache;
//# sourceMappingURL=catalog-bootstrap-cache.d.ts.map