import { Ajv, type ValidateFunction } from 'ajv'

const ajv = new Ajv({ allErrors: true, strict: false })
const compiled = new Map<string, ValidateFunction>()

function keyFor(schema: Record<string, unknown>): string {
	return JSON.stringify(schema)
}

/**
 * Validate the positional `args` array (after arity and file materialization) against
 * a single JSON Schema for the whole tuple (draft-07 subset).
 */
export function validateArgsAgainstParamsJsonSchema(
	fnKey: string,
	schema: Record<string, unknown>,
	args: unknown[],
): { ok: true } | { ok: false; message: string } {
	const k = keyFor(schema)
	let validate = compiled.get(k)
	if (validate === undefined) {
		try {
			const compiledFn = ajv.compile(schema)
			compiled.set(k, compiledFn)
			validate = compiledFn
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'invalid schema'
			return { ok: false, message: `paramsJsonSchema compile failed for ${fnKey}: ${msg}` }
		}
	}
	if (validate(args)) return { ok: true }
	const errs = validate.errors?.map((x) => `${x.instancePath || '/'} ${x.message}`).join('; ')
	return {
		ok: false,
		message: `paramsJsonSchema validation failed for ${fnKey}${errs ? `: ${errs}` : ''}`,
	}
}

/** Test-only: drop compiled schema cache */
export function resetParamsJsonSchemaValidators(): void {
	compiled.clear()
}
