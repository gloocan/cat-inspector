export declare function validateResultAgainstReturnJsonSchema(fnKey: string, schema: Record<string, unknown>, data: unknown): {
    ok: true;
} | {
    ok: false;
    message: string;
};
/** Test-only: drop compiled schema cache */
export declare function resetReturnJsonSchemaValidators(): void;
//# sourceMappingURL=validate-return-json-schema.d.ts.map