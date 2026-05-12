import {
	ActiveContext,
	ApiContext,
	ErrorCapture,
	Registry,
	broadcastApiResponse,
	broadcastErrorThrown,
	broadcastReturnResolved,
	LabelCapture,
	recordExpressApiInvokeCapture,
} from './registry-state.js'

export function getType(value: unknown): string {
	if (value === null) return 'null'
	if (value === undefined) return 'undefined'
	if (Array.isArray(value)) {
		if (value.length === 0) return 'Array<unknown>'
		const types = [...new Set(value.map(getType))]
		return `Array<${types.join(' | ')}>`
	}
	const t = typeof value
	if (t === 'number') return Number.isInteger(value) ? 'int' : 'float'
	if (t !== 'object') return t
	if (value instanceof Date) return 'Date'
	const name = (value as { constructor?: { name?: string } }).constructor?.name
	if (name && name !== 'Object') return name
	return 'object'
}

export function getShape(value: unknown, depth = 0): string {
	if (Array.isArray(value)) {
		if (value.length === 0) return 'Array<unknown>'
		// Prefer showing element *shape* (not just element type).
		// If there are multiple different element shapes, show a union.
		const shapes = [...new Set(value.map((v) => getShape(v, depth)))]
		return `Array<${shapes.join(' | ')}>`
	}
	const type = getType(value)
	if (type !== 'object') return type

	const indent = '  '.repeat(depth)
	const entries = Object.entries(value as Record<string, unknown>)
	const fields = entries
		.map(([k, v]) => `${indent}  ${k}: ${getShape(v, depth + 1)}`)
		.join('\n')

	return `{\n${fields}\n${indent}}`
}

export type Labeled<L extends string, T> = T & { readonly __brand?: L }

/** Runtime behavior unchanged; inferred return type is `T` so catalog `declaredReturn` matches `getType`. */
export function Return<L extends string, T>(label: L, value: T): T {
	const parentFn = ActiveContext.get()

	if (parentFn && Registry.has(parentFn)) {
		const meta = Registry.get(parentFn)!
		const entry = meta.returns.find((r) => r.label === label)

		if (entry) {
			entry.status = 'resolved'
			entry.type = getShape(value)
			LabelCapture.capture(label)

			broadcastReturnResolved({
				event: 'RETURN_RESOLVED',
				fnKey: parentFn,
				label,
				type: entry.type,
			})
		}
	}

	return value as T
}

export function Throw<L extends string>(label: L, error: Error): never {
	const parentFn = ActiveContext.get()
	if (parentFn && Registry.has(parentFn)) {
		const meta = Registry.get(parentFn)!
		const entry = meta.errors.find((e) => e.label === label)
		if (entry) {
			entry.status = 'resolved'
			entry.message = error.message
		}
		ErrorCapture.capture(label, error)
		broadcastErrorThrown({
			event: 'ERROR_THROWN',
			fnKey: parentFn,
			label,
			layer: 'expected',
			message: error.message,
			stack: error.stack ?? null,
		})
	}
	throw error
}

export interface ApiPayload<T> {
	statusCode: number
	body: T
}

export function ApiReturn<L extends string, T>(
	label: L,
	statusCode: number,
	body: T,
): ApiPayload<T> {
	const endpointKey = ApiContext.get()
	if (endpointKey && Registry.has(endpointKey)) {
		const meta = Registry.get(endpointKey)!
		const entry = meta.apiResponses.find((r) => r.label === label)
		if (entry) {
			entry.status = 'resolved'
			entry.statusCode = statusCode
			entry.bodyShape = getShape(body)
		}
		broadcastApiResponse({
			event: 'API_RESPONSE',
			endpointKey,
			label,
			statusCode,
			bodyShape: getShape(body),
			body,
		})
		recordExpressApiInvokeCapture(endpointKey, { label, statusCode, body })
	}
	return { statusCode, body }
}
