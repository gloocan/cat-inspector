const textEncoder = new TextEncoder()

export class SerializeRpcResultError extends Error {
	readonly code = 'RESULT_NOT_SERIALIZABLE' as const
	constructor(message: string) {
		super(message)
		this.name = 'SerializeRpcResultError'
	}
}

export interface RpcSerializationOptions {
	/** When true, `serializeRpcResult` runs; when false, callers should skip and pass raw values. */
	enabled: boolean
	/** Max UTF-8 size of `JSON.stringify(serialized)`; default 4 MiB when enabled. */
	maxUtf8Bytes?: number
	/**
	 * When true (and `enabled`), after serialization validate `result` against `RegistryEntry.returnJsonSchema` if present.
	 */
	validateReturnJsonSchema?: boolean
	/**
	 * When true, before invoke validate `args` against `RegistryEntry.paramsJsonSchema` if present (does not require `enabled`).
	 */
	validateParamsJsonSchema?: boolean
}

let globalSerialization: RpcSerializationOptions = { enabled: false }

export function getRpcSerializationConfig(): Readonly<RpcSerializationOptions> {
	return { ...globalSerialization }
}

export function setRpcSerializationConfig(next: Partial<RpcSerializationOptions>): void {
	globalSerialization = {
		...globalSerialization,
		...next,
	}
	if (globalSerialization.enabled) {
		if (globalSerialization.maxUtf8Bytes === undefined) {
			globalSerialization.maxUtf8Bytes = 4 * 1024 * 1024
		}
	} else {
		globalSerialization.maxUtf8Bytes = undefined
	}
}

export function resetRpcSerializationConfig(): void {
	globalSerialization = {
		enabled: false,
		maxUtf8Bytes: undefined,
		validateReturnJsonSchema: false,
		validateParamsJsonSchema: false,
	}
}

function isPlainObject(value: object): boolean {
	if (Array.isArray(value)) return false
	const proto = Object.getPrototypeOf(value)
	return proto === null || proto === Object.prototype
}

/**
 * Deep-clone a value into JSON-safe plain data: `null`, number, string, boolean,
 * arrays of the same, and plain objects with string keys.
 * - `bigint` → decimal string
 * - `Date` → ISO string
 * - `undefined` (nested) omitted in objects; root `undefined` → `null`
 * Rejects: functions, symbols, `Map`/`Set`/class instances, cycles.
 */
export function maybeSerializeRpcResult(
	raw: unknown,
): { ok: true; value: unknown } | { ok: false; message: string } {
	if (!globalSerialization.enabled) return { ok: true, value: raw }
	try {
		return { ok: true, value: serializeRpcResult(raw) }
	} catch (e) {
		return {
			ok: false,
			message: e instanceof SerializeRpcResultError ? e.message : String(e),
		}
	}
}

export function serializeRpcResult(value: unknown): unknown {
	if (value === undefined) return null
	const seen = new WeakSet<object>()
	const out = walk(value, seen)
	const max = globalSerialization.maxUtf8Bytes ?? 4 * 1024 * 1024
	let encoded: string
	try {
		encoded = JSON.stringify(out)
	} catch (e) {
		throw new SerializeRpcResultError(
			e instanceof Error ? e.message : 'JSON.stringify failed after normalization',
		)
	}
	const bytes = textEncoder.encode(encoded).length
	if (bytes > max) {
		throw new SerializeRpcResultError(
			`serialized RPC result exceeds maxUtf8Bytes (${bytes} > ${max})`,
		)
	}
	return out
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
	if (value === null) return null
	if (value === undefined) return null
	const t = typeof value
	if (t === 'bigint') return String(value)
	if (t === 'number' || t === 'boolean' || t === 'string') return value
	if (t === 'function' || t === 'symbol') {
		throw new SerializeRpcResultError(`unsupported type for JSON RPC result: ${t}`)
	}
	if (value instanceof Date) return value.toISOString()
	if (Array.isArray(value)) {
		if (seen.has(value)) throw new SerializeRpcResultError('circular reference in RPC result')
		seen.add(value)
		try {
			return value.map((item) => walk(item, seen))
		} finally {
			seen.delete(value)
		}
	}
	if (typeof value === 'object') {
		if (!isPlainObject(value)) {
			const ctor = (value as { constructor?: { name?: string } }).constructor?.name
			throw new SerializeRpcResultError(
				`non-plain object in RPC result${ctor ? ` (${ctor})` : ''}; return a DTO or plain object`,
			)
		}
		if (seen.has(value)) throw new SerializeRpcResultError('circular reference in RPC result')
		seen.add(value)
		try {
			const obj = value as Record<string, unknown>
			const out: Record<string, unknown> = {}
			for (const k of Object.keys(obj)) {
				const v = obj[k]
				if (v === undefined) continue
				out[k] = walk(v, seen)
			}
			return out
		} finally {
			seen.delete(value)
		}
	}
	throw new SerializeRpcResultError(`unsupported value for JSON RPC result: ${t}`)
}
