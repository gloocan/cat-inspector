import type { Request, RequestHandler } from 'express'

import { randomUUID } from 'node:crypto'

import type { InspectorBroadcastSource } from './registry-state.js'
import { readInspectorSocketIdFromHeaders } from './registry-state.js'

/**
 * Non-enumerable request metadata so HTTP inspector broadcasts stay correlated when
 * middleware defers `next()` (multipart parsers, microtasks, etc.) and AsyncLocalStorage
 * from an outer scope is no longer active.
 */
export const INSPECTOR_HTTP_META = Symbol.for('@gloocan/cat-inspector-http')

export type InspectorHttpRequestMeta = {
	socketId: string
	correlationId: string
	source: Extract<InspectorBroadcastSource, 'http'>
}

export function attachInspectorHttpMeta(req: object, meta: InspectorHttpRequestMeta): void {
	Object.defineProperty(req, INSPECTOR_HTTP_META, {
		value: meta,
		enumerable: false,
		writable: true,
		configurable: true,
	})
}

/** Read metadata attached by {@link createInspectorCorrelationMiddleware}. */
export function readInspectorHttpMeta(req: unknown): InspectorHttpRequestMeta | undefined {
	if (!req || typeof req !== 'object') return undefined
	const v = (req as Record<symbol, unknown>)[INSPECTOR_HTTP_META]
	if (!v || typeof v !== 'object') return undefined
	const o = v as Record<string, unknown>
	const socketId = typeof o.socketId === 'string' ? o.socketId : ''
	const correlationId = typeof o.correlationId === 'string' ? o.correlationId : ''
	if (!socketId.trim() || !correlationId.trim()) return undefined
	if (o.source !== 'http') return undefined
	return { socketId, correlationId, source: 'http' }
}

/**
 * When `X-Socket-Id` is present, attaches per-request inspector metadata on `req` so
 * {@link registerCatPipeline} can re-enter `runWithInspectorBroadcastTarget` for each
 * wrapped handler (survives deferred `next()` and async gaps). Does not wrap `next()` in ALS.
 */
export function createInspectorCorrelationMiddleware(): RequestHandler {
	return (req: Request, _res, next) => {
		const id = readInspectorSocketIdFromHeaders(req.headers)
		if (!id) {
			next()
			return
		}
		const correlationId = randomUUID()
		attachInspectorHttpMeta(req, { socketId: id, correlationId, source: 'http' })
		next()
	}
}
