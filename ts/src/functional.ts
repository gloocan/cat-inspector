import {
	ActiveContext,
	ApiContext,
	ErrorCapture,
	Registry,
	broadcastErrorThrown,
	broadcastMiddlewareNext,
} from './registry-state.js'
import {
	extractApiReturnLabels,
	extractParamNames,
	extractReturnLabels,
	extractThrowLabels,
	getFunctionBody,
} from './source-utils.js'
import type { CatMode, RegistryEntry } from './types.js'

export interface CatFunctionOptions {
	method?: string
	route?: string
	/**
	 * Optional manual type hints (fallback when AST scan isn't run).
	 * If provided, overrides default 'unknown' registration types.
	 */
	params?: import('./types.js').RegistryParam[]
	declaredReturn?: string
	/** Optional JSON Schema (draft-07 subset) for the entire positional args array when `validateParamsJsonSchema` is enabled. */
	paramsJsonSchema?: Record<string, unknown>
}

function detectModeForFunction(paramNames: string[], options?: CatFunctionOptions): CatMode {
	const looksLikeExpress = paramNames.includes('req') && paramNames.includes('res')
	const hasRoute = options?.route !== undefined
	if (!looksLikeExpress && !hasRoute) return 'service'
	return hasRoute ? 'api' : 'api_candidate'
}

function registerFunction(
	fnKey: string,
	fn: Function,
	mode: CatMode,
	params: import('./types.js').RegistryParam[],
	declaredReturn: string,
	paramsJsonSchema?: Record<string, unknown> | null,
): void {
	if (Registry.has(fnKey)) {
		throw new Error(
			`cat: duplicate fnKey "${fnKey}". Each instrumented function must use a unique key.`,
		)
	}
	const body = getFunctionBody(fn)
	Registry.set(fnKey, {
		mode,
		className: fnKey.split('.')[0] ?? fnKey,
		method: fnKey.split('.')[1] ?? fnKey,
		style: 'function',
		body,
		params,
		declaredReturn,
		returns: extractReturnLabels(body).map((label) => ({
			label,
			type: null,
			status: 'pending' as const,
		})),
		errors: extractThrowLabels(body).map((label) => ({
			label,
			type: null,
			message: null,
			status: 'pending' as const,
		})),
		children: [],
		parents: [],
		route: null,
		httpMethod: null,
		apiResponses: extractApiReturnLabels(body).map((label) => ({
			label,
			statusCode: null,
			bodyShape: null,
			status: 'pending' as const,
		})),
		serviceLinks: [],
		pipelineId: null,
		pipelineIndex: null,
		...(paramsJsonSchema !== undefined && paramsJsonSchema !== null
			? { paramsJsonSchema }
			: {}),
		originalFn: fn,
	} satisfies RegistryEntry)
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
	return Boolean(v && typeof (v as PromiseLike<unknown>).then === 'function')
}

function buildWrapper(fnKey: string, original: Function): Function {
	return function (this: unknown, ...args: unknown[]) {
		const entry = Registry.get(fnKey)
		const isApi = entry?.mode === 'api'
		const isMiddleware = entry?.mode === 'api_candidate'

		const clearContext = () => {
			if (isApi) ApiContext.clear()
			else ActiveContext.pop()
		}

		// Express middleware: wrap next() so successful middleware steps emit an inspector event.
		// This avoids leaving expected middleware nodes stuck at "pending" when they only call next().
		if (isMiddleware && typeof args[2] === 'function') {
			const realNext = args[2] as (...nextArgs: unknown[]) => unknown
			let emitted = false
			args[2] = (...nextArgs: unknown[]) => {
				if (!emitted) {
					emitted = true
					const err = nextArgs[0]
					if (err) {
						const message =
							err instanceof Error ? err.message : typeof err === 'string' ? err : 'next(err)'
						broadcastErrorThrown({
							event: 'ERROR_THROWN',
							fnKey,
							label: 'NEXT_ERROR',
							layer: 'expected',
							message,
							stack: err instanceof Error ? err.stack ?? null : null,
						})
					} else {
						broadcastMiddlewareNext({
							event: 'MIDDLEWARE_NEXT',
							fnKey,
							label: 'NEXT',
						})
					}
				}
				return realNext(...nextArgs)
			}
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
}

export function cat<T extends (...args: any[]) => any>(
	fnKey: string,
	fn: T,
	options?: CatFunctionOptions,
): T {
	const paramNames = extractParamNames(fn)
	const mode = detectModeForFunction(paramNames, options)

	const hintedParams =
		options?.params ??
		paramNames.map((name) => ({ name, type: 'unknown' }))
	const hintedReturn = options?.declaredReturn ?? 'unknown'

	registerFunction(
		fnKey,
		fn,
		mode,
		hintedParams,
		hintedReturn,
		options?.paramsJsonSchema ?? null,
	)

	if (options?.route) {
		const entry = Registry.get(fnKey)!
		entry.route = options.route
		entry.httpMethod = options.method ?? 'GET'
		entry.mode = 'api'
	}

	const wrapped = buildWrapper(fnKey, fn) as T
	const entry = Registry.get(fnKey)
	if (entry) entry.originalFn = wrapped
	return wrapped
}

export function catModule<T extends Record<string, (...args: any[]) => any>>(
	moduleName: string,
	fns: T,
	options?: Record<
		string,
		Pick<CatFunctionOptions, 'params' | 'declaredReturn' | 'paramsJsonSchema'>
	>,
): T {
	const wrapped: Record<string, unknown> = {}

	for (const [methodName, fn] of Object.entries(fns)) {
		const fnKey = `${moduleName}.${methodName}`
		const paramNames = extractParamNames(fn)
		const mode = detectModeForFunction(paramNames)

		const hintedParams =
			options?.[methodName]?.params ??
			paramNames.map((name) => ({ name, type: 'unknown' }))
		const hintedReturn = options?.[methodName]?.declaredReturn ?? 'unknown'

		registerFunction(
			fnKey,
			fn,
			mode,
			hintedParams,
			hintedReturn,
			options?.[methodName]?.paramsJsonSchema ?? null,
		)

		const wrappedFn = buildWrapper(fnKey, fn)
		const entry = Registry.get(fnKey)
		if (entry) entry.originalFn = wrappedFn
		wrapped[methodName] = wrappedFn
	}

	return wrapped as T
}

