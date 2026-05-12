import type { RegistryEntry } from '../types.js';
/**
 * Build a minimal OpenAPI 3.1 document from a registry snapshot.
 * - Express-backed entries (`route` + `httpMethod`) become real paths.
 * - Every `fnKey` also gets a documented `POST /qa/rpc/{fnKey}` placeholder (not mounted by the SDK).
 */
export declare function exportRegistryOpenApi(registry: Record<string, RegistryEntry>, opts?: {
    title?: string;
    version?: string;
}): Record<string, unknown>;
//# sourceMappingURL=registry-to-openapi.d.ts.map