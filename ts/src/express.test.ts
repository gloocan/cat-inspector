import express from 'express'
import { describe, expect, it, beforeEach } from 'vitest'

import { Registry, resetInspectorState } from './registry-state.js'
import { invokeExpressSynthetic, registerCatPipeline } from './express.js'
import { cat } from './functional.js'

beforeEach(() => {
	resetInspectorState()
})

describe('registerCatPipeline', () => {
	it('fills pipelineId and pipelineIndex for each handler', () => {
		const router = express.Router()

		const h0 = cat('Auth.require', function require(req: unknown, res: unknown, next: unknown) {
			return { req, res, next }
		})

		const h1 = cat('Ctrl.create', function create(req: unknown, res: unknown) {
			return { req, res }
		})

		registerCatPipeline(router, 'post', '/orders', [h0, h1])

		const e0 = Registry.get('Auth.require')!
		const e1 = Registry.get('Ctrl.create')!

		expect(e0.pipelineId).toBe('POST /orders')
		expect(e0.pipelineIndex).toBe(0)
		expect(e1.pipelineIndex).toBe(1)
		expect(e1.mode).toBe('api')
	})
})

describe('invokeExpressSynthetic', () => {
	it('returns JSON body for a mounted route', async () => {
		const app = express()
		app.get('/ping', (_req, res) => {
			res.status(200).json({ ok: true })
		})
		const out = await invokeExpressSynthetic(app, { method: 'get', path: '/ping' })
		expect(out.statusCode).toBe(200)
		expect(out.bodyJson).toEqual({ ok: true })
	})
})

