import { Ajv } from 'ajv';
const ajv = new Ajv({ allErrors: true, strict: false });
const compiled = new Map();
function keyFor(schema) {
    return JSON.stringify(schema);
}
export function validateResultAgainstReturnJsonSchema(fnKey, schema, data) {
    const k = keyFor(schema);
    let validate = compiled.get(k);
    if (validate === undefined) {
        try {
            const compiledFn = ajv.compile(schema);
            compiled.set(k, compiledFn);
            validate = compiledFn;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'invalid schema';
            return { ok: false, message: `returnJsonSchema compile failed for ${fnKey}: ${msg}` };
        }
    }
    if (validate(data))
        return { ok: true };
    const errs = validate.errors?.map((x) => `${x.instancePath || '/'} ${x.message}`).join('; ');
    return {
        ok: false,
        message: `returnJsonSchema validation failed for ${fnKey}${errs ? `: ${errs}` : ''}`,
    };
}
/** Test-only: drop compiled schema cache */
export function resetReturnJsonSchemaValidators() {
    compiled.clear();
}
//# sourceMappingURL=validate-return-json-schema.js.map