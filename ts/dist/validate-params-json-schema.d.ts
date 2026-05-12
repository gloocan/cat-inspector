/**
 * Validate the positional `args` array (after arity and file materialization) against
 * a single JSON Schema for the whole tuple (draft-07 subset).
 */
export declare function validateArgsAgainstParamsJsonSchema(fnKey: string, schema: Record<string, unknown>, args: unknown[]): {
    ok: true;
} | {
    ok: false;
    message: string;
};
/** Test-only: drop compiled schema cache */
export declare function resetParamsJsonSchemaValidators(): void;
//# sourceMappingURL=validate-params-json-schema.d.ts.map