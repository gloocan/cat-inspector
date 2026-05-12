import 'reflect-metadata'

import {
	ActiveContext,
	ApiContext,
	ErrorCapture,
	Registry,
	registerClassConstructor,
	broadcastErrorThrown,
} from '../registry-state.js'
import {
	extractParamNames,
	extractApiReturnLabels,
	getFunctionBody,
	extractReturnLabels,
	extractThrowLabels,
} from '../source-utils.js'

export function Cat(
	target: object,
	key: string,
	descriptor: PropertyDescriptor,
): PropertyDescriptor {
	const fn = descriptor.value as Function
	const ctor = (target as { constructor: new (...args: any[]) => any }).constructor
	const className = (ctor as { name?: string }).name ?? ''
	const fnKey = `${className}.${key}`
	if (className) registerClassConstructor(className, ctor)
	const body = getFunctionBody(fn)
	const paramMeta: unknown[] =
		Reflect.getMetadata('design:paramtypes', target, key) ?? []
	const returnMeta: { name?: string } | undefined = Reflect.getMetadata(
		'design:returntype',
		target,
		key,
	)

	const staticLabels = extractReturnLabels(body)
	const staticThrowLabels = extractThrowLabels(body)
	const staticApiReturnLabels = extractApiReturnLabels(body)

	const paramTypeNames = paramMeta.map(
		(t) => (t as { name?: string } | undefined)?.name ?? 'unknown',
	)
	const isApiCandidate =
		paramTypeNames.includes('Request') && paramTypeNames.includes('Response')

	Registry.set(fnKey, {
		mode: isApiCandidate ? 'api_candidate' : 'service',
		className,
		method: key,
		style: 'class',
		body,
		params: extractParamNames(fn).map((name, i) => ({
			name,
			type: (paramMeta[i] as { name?: string } | undefined)?.name ?? 'unknown',
		})),
		declaredReturn: returnMeta?.name ?? 'void',
		returns: staticLabels.map((label) => ({
			label,
			type: null,
			status: 'pending' as const,
		})),
		errors: staticThrowLabels.map((label) => ({
			label,
			type: null,
			message: null,
			status: 'pending' as const,
		})),
		children: [],
		parents: [],
		route: null,
		httpMethod: null,
		apiResponses: staticApiReturnLabels.map((label) => ({
			label,
			statusCode: null,
			bodyShape: null,
			status: 'pending' as const,
		})),
		serviceLinks: [],
		pipelineId: null,
		pipelineIndex: null,
		originalFn: fn,
	})

	const original = fn
	const isThenable = (v: unknown): v is PromiseLike<unknown> =>
		Boolean(v && typeof (v as PromiseLike<unknown>).then === 'function')
	const wrapped = function (this: unknown, ...args: unknown[]) {
		const entry = Registry.get(fnKey)
		const isApi = entry?.mode === 'api'
		const clearContext = () => {
			if (isApi) ApiContext.clear()
			else ActiveContext.pop()
		}
		if (isApi) ApiContext.set(fnKey)
		else ActiveContext.push(fnKey)
		let out: unknown
		try {
			out = original.apply(this, args) as unknown
		} catch (err: unknown) {
			if (err instanceof Error && !ErrorCapture.hasCurrent()) {
				ErrorCapture.capture('UNEXPECTED_ERROR', err)
				broadcastErrorThrown({
					event: 'ERROR_THROWN',
					fnKey,
					label: 'UNEXPECTED_ERROR',
					layer: 'unexpected',
					message: err.message,
					stack: err.stack ?? null,
				})
			}
			clearContext()
			throw err
		}
		if (isThenable(out)) {
			return Promise.resolve(out).finally(clearContext)
		}
		clearContext()
		return out
	}
	descriptor.value = wrapped
	const entry = Registry.get(fnKey)
	if (entry) entry.originalFn = wrapped

	return descriptor
}
