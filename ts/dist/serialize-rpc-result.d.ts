export declare class SerializeRpcResultError extends Error {
    readonly code: "RESULT_NOT_SERIALIZABLE";
    constructor(message: string);
}
export interface RpcSerializationOptions {
    /** When true, `serializeRpcResult` runs; when false, callers should skip and pass raw values. */
    enabled: boolean;
    /** Max UTF-8 size of `JSON.stringify(serialized)`; default 4 MiB when enabled. */
    maxUtf8Bytes?: number;
    /**
     * When true (and `enabled`), after serialization validate `result` against `RegistryEntry.returnJsonSchema` if present.
     */
    validateReturnJsonSchema?: boolean;
    /**
     * When true, before invoke validate `args` against `RegistryEntry.paramsJsonSchema` if present (does not require `enabled`).
     */
    validateParamsJsonSchema?: boolean;
}
export declare function getRpcSerializationConfig(): Readonly<RpcSerializationOptions>;
export declare function setRpcSerializationConfig(next: Partial<RpcSerializationOptions>): void;
export declare function resetRpcSerializationConfig(): void;
/**
 * Deep-clone a value into JSON-safe plain data: `null`, number, string, boolean,
 * arrays of the same, and plain objects with string keys.
 * - `bigint` → decimal string
 * - `Date` → ISO string
 * - `undefined` (nested) omitted in objects; root `undefined` → `null`
 * Rejects: functions, symbols, `Map`/`Set`/class instances, cycles.
 */
export declare function maybeSerializeRpcResult(raw: unknown): {
    ok: true;
    value: unknown;
} | {
    ok: false;
    message: string;
};
export declare function serializeRpcResult(value: unknown): unknown;
//# sourceMappingURL=serialize-rpc-result.d.ts.map