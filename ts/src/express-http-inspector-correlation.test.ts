import express from 'express'
import { beforeEach, describe, expect, it } from 'vitest'

import { createInspectorCorrelationMiddleware } from './express-inspector-correlation.js'
import { invokeExpressSynthetic, registerCatPipeline } from './express.js'
import { cat } from './functional.js'
import { ApiReturn } from './return.js'
import {
	clearBroadcastSink,
	INSPECTOR_SOCKET_ID_HEADER,
	resetInspectorState,
	setBroadcastSink,
} from './registry-state.js'

beforeEach(() => {
	resetInspectorState()
	clearBroadcastSink()
})

describe('HTTP inspector correlation (deferred next)', () => {
	it('includes correlationId on API_RESPONSE when middleware defers next via queueMicrotask', async () => {
		const seen: object[] = []
		setBroadcastSink((d) => {
			seen.push(d)
		})

		const mw = cat(
			'HttpInspectorDeferredMw.microtask',
			function microtaskMw(_req: unknown, _res: unknown, next: (err?: unknown) => void) {
				queueMicrotask(() => next())
			},
		)
		const endp = cat(
			'HttpInspectorDeferredMw.endpoint',
			function endpoint(_req: unknown, res: express.Response) {
				const r = ApiReturn('OK', 200, { ok: true })
				res.status(r.statusCode).json(r.body)
			},
		)

		const app = express()
		app.use(createInspectorCorrelationMiddleware())
		const router = express.Router()
		registerCatPipeline(router, 'post', '/t', [mw, endp])
		app.use('/api', router)

		const { statusCode, bodyJson } = await invokeExpressSynthetic(app, {
			method: 'post',
			path: '/api/t',
			headers: { [INSPECTOR_SOCKET_ID_HEADER]: 'test-socket-tab' },
			body: {},
		})

		expect(statusCode).toBe(200)
		expect(bodyJson).toEqual({ ok: true })

		const apiEv = seen.find((e) => (e as { event?: string }).event === 'API_RESPONSE') as
			| { correlationId?: string; event?: string }
			| undefined
		expect(apiEv).toBeTruthy()
		expect(typeof apiEv?.correlationId).toBe('string')
		expect(apiEv!.correlationId!.length).toBeGreaterThan(0)
	})

	it('includes correlationId when middleware defers next via setImmediate', async () => {
		const seen: object[] = []
		setBroadcastSink((d) => {
			seen.push(d)
		})

		const mw = cat(
			'HttpInspectorDeferredMw.immediate',
			function immediateMw(_req: unknown, _res: unknown, next: (err?: unknown) => void) {
				setImmediate(() => next())
			},
		)
		const endp = cat(
			'HttpInspectorDeferredMw.endpointImm',
			function endpointImm(_req: unknown, res: express.Response) {
				const r = ApiReturn('OK', 200, { x: 1 })
				res.status(r.statusCode).json(r.body)
			},
		)

		const app = express()
		app.use(createInspectorCorrelationMiddleware())
		const router = express.Router()
		registerCatPipeline(router, 'post', '/u', [mw, endp])
		app.use('/api', router)

		const { statusCode } = await invokeExpressSynthetic(app, {
			method: 'post',
			path: '/api/u',
			headers: { [INSPECTOR_SOCKET_ID_HEADER]: 'sock-b' },
			body: {},
		})

		expect(statusCode).toBe(200)

		const apiEv = seen.find((e) => (e as { event?: string }).event === 'API_RESPONSE') as
			| { correlationId?: string }
			| undefined
		expect(apiEv?.correlationId).toBeDefined()
	})
})
