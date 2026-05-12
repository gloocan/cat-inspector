import type { NextFunction, Request, Response } from 'express'

export type ExpressPlaygroundPayload = {
	headers?: Record<string, string>
	body?: unknown
	method?: string
	path?: string
	/** Optional: attach a single file (multer-like) */
	file?: unknown
	/** Optional: attach multiple files by field name (multer-like) */
	files?: unknown
}

export type ExpressPlaygroundCapture = {
	statusCode: number | null
	body: unknown
	nextCalled: boolean
	nextError: unknown | null
}

/**
 * Minimal req/res/next for exercising Cat Express handlers over Socket.IO.
 * Headers should use lower-case keys where possible (Express normalizes).
 */
export function createExpressPlaygroundMocks(
	payload: ExpressPlaygroundPayload,
): {
	req: Request
	res: Response
	next: NextFunction
	getCapture: () => ExpressPlaygroundCapture
} {
	const headers: Record<string, string> = {}
	for (const [k, v] of Object.entries(payload.headers ?? {})) {
		headers[k.toLowerCase()] = String(v)
	}

	let statusCode: number | null = null
	let body: unknown = undefined

	const res = {
		status(code: number) {
			statusCode = code
			return res
		},
		json(obj: unknown) {
			body = obj
			return res
		},
		send(data: unknown) {
			body = data
			return res
		},
	} as unknown as Response

	let nextCalled = false
	let nextError: unknown = null
	const next = ((err?: unknown) => {
		nextCalled = true
		nextError = err === undefined ? null : err
	}) as NextFunction

	const req = {
		headers,
		body: payload.body,
		file: payload.file,
		files: payload.files,
		method: payload.method ?? 'POST',
		path: payload.path ?? '/api/run',
		header(name: string) {
			return headers[name.toLowerCase()]
		},
	} as unknown as Request

	return {
		req,
		res,
		next,
		getCapture: () => ({
			statusCode,
			body,
			nextCalled,
			nextError,
		}),
	}
}
