import http from 'node:http'
import type { AddressInfo } from 'node:net'

import type { Express, NextFunction, Request, Response, Router } from 'express'

import { readInspectorHttpMeta } from './express-inspector-correlation.js'
import { ApiContext, Registry, runWithInspectorBroadcastTarget, runWithProducerFnKey } from './registry-state.js'

function isThenable(v: unknown): v is PromiseLike<unknown> {
	return Boolean(v && typeof (v as PromiseLike<unknown>).then === 'function')
}

export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch'

export function pipelineIdForRoute(method: string, route: string): string {
	return `${method.toUpperCase()} ${route}`
}

export function registerCatPipeline(
	router: Router,
	method: HttpMethod,
	route: string,
	handlers: readonly ((...args: any[]) => any)[],
): void {
	const pid = pipelineIdForRoute(method, route)
	const endpointHandler = handlers[handlers.length - 1]
	let endpointFnKey: string | null = null

	handlers.forEach((handler, index) => {
		if (typeof handler !== 'function') return
		const isLast = index === handlers.length - 1
		Registry.forEach((entry) => {
			if (
				entry.originalFn === handler &&
				(entry.mode === 'api_candidate' || entry.mode === 'api')
			) {
				entry.route = route
				entry.httpMethod = method.toUpperCase()
				entry.pipelineId = pid
				entry.pipelineIndex = index
				// In a pipeline, treat the final handler as the endpoint ("api"),
				// and prior handlers as middleware ("api_candidate").
				entry.mode = isLast ? 'api' : 'api_candidate'
			}
		})
		if (handler === endpointHandler) {
			for (const [k, e] of Registry.entries()) {
				if (e.originalFn === handler) {
					endpointFnKey = k
					break
				}
			}
		}
	})

	const wrapped = handlers.map((handler) => {
		if (typeof handler !== 'function') return handler
		let fnKey: string | null = null
		for (const [k, e] of Registry.entries()) {
			if (e.originalFn === handler) {
				fnKey = k
				break
			}
		}
		return function wrappedPipelineHandler(this: unknown, ...args: any[]) {
			const req = args[0] as Request | undefined
			const res = args[1] as Response | undefined
			const next = args[2] as NextFunction | undefined

			const runInner = () => {
				// Ensure ApiReturn broadcasts are correlated to the endpoint for HTTP requests.
				if (endpointFnKey) ApiContext.set(endpointFnKey)
				return runWithProducerFnKey(fnKey, () => {
					if (typeof next !== 'function') {
						// Express route handler (req,res) style
						return handler.apply(this, args)
					}
					const wrappedNext: NextFunction = (...nextArgs: any[]) => {
						return next(...nextArgs)
					}
					return handler.call(this, req, res, wrappedNext)
				})
			}

			const runWithHttpInspector = () => {
				const meta = req ? readInspectorHttpMeta(req) : undefined
				if (meta) {
					return runWithInspectorBroadcastTarget(meta.socketId, runInner, {
						source: 'http',
						correlationId: meta.correlationId,
					})
				}
				return runInner()
			}

			try {
				const out = runWithHttpInspector()
				if (isThenable(out)) {
					return Promise.resolve(out).finally(() => {
						ApiContext.clear()
					})
				}
				ApiContext.clear()
				return out
			} catch (err) {
				ApiContext.clear()
				throw err
			}
		}
	})

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	;(router[method] as any)(route, ...wrapped)
}

export function createCorrelationMiddleware(): (
	req: Request,
	res: Response,
	next: NextFunction,
) => void {
	return function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
		const header =
			req.header('x-correlation-id') ?? req.header('x-request-id') ?? undefined

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const r = req as any
		if (r.correlationId === undefined) r.correlationId = header ?? `${Date.now()}`

		if (!res.headersSent) {
			try {
				res.setHeader('X-Correlation-Id', String(r.correlationId))
			} catch {
				// ignore
			}
		}

		next()
	}
}

/**
 * Run one in-process HTTP request against an Express `app` (local `127.0.0.1` ephemeral port).
 * Useful for QA / tests that need real `req`/`res` middleware without deploying.
 */
export async function invokeExpressSynthetic(
	app: Express,
	opts: {
		method: HttpMethod
		path: string
		headers?: Record<string, string>
		body?: unknown
	},
): Promise<{
	statusCode: number
	headers: Record<string, string>
	bodyText: string
	bodyJson: unknown
}> {
	const server = http.createServer(app)
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => resolve())
	})
	const addr = server.address() as AddressInfo
	const port = addr.port
	const path = opts.path.startsWith('/') ? opts.path : `/${opts.path}`
	const url = `http://127.0.0.1:${port}${path}`
	try {
		const method = opts.method.toUpperCase()
		const headers = new Headers()
		for (const [k, v] of Object.entries(opts.headers ?? {})) {
			headers.set(k, v)
		}
		const init: RequestInit = { method, headers }
		if (opts.body !== undefined && method !== 'GET' && method !== 'HEAD') {
			if (!headers.has('content-type')) {
				headers.set('content-type', 'application/json')
			}
			init.body = JSON.stringify(opts.body)
		}
		const resp = await fetch(url, init)
		const bodyText = await resp.text()
		let bodyJson: unknown = bodyText
		if (bodyText) {
			try {
				bodyJson = JSON.parse(bodyText) as unknown
			} catch {
				bodyJson = bodyText
			}
		} else {
			bodyJson = null
		}
		const outHeaders: Record<string, string> = {}
		resp.headers.forEach((v, k) => {
			outHeaders[k] = v
		})
		return { statusCode: resp.status, headers: outHeaders, bodyText, bodyJson }
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()))
		})
	}
}

