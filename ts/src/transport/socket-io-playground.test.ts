import { beforeEach, describe, expect, it } from 'vitest'

import { createExpressPlaygroundMocks } from '../express-playground-mocks.js'
import {
	ActiveContext,
	Registry,
	recordExpressApiInvokeCapture,
	registerInstance,
	resetInspectorState,
} from '../registry-state.js'
import type { RegistryEntry } from '../types.js'
import { ApiReturn, Return } from '../return.js'
import { invokeExpressPlayground, resolveExpressCallableForInvoke } from './socket-io-playground.js'

function baseApiEntry(): Omit<RegistryEntry, 'style' | 'originalFn'> {
	return {
		mode: 'api',
		className: 'Demo',
		method: 'handler',
		body: '',
		params: [
			{ name: 'req', type: 'Request' },
			{ name: 'res', type: 'Response' },
		],
		declaredReturn: 'void',
		returns: [{ label: 'OK', type: null, status: 'pending' }],
		errors: [],
		children: [],
		parents: [],
		route: '/demo',
		httpMethod: 'POST',
		apiResponses: [],
		serviceLinks: [],
		pipelineId: null,
		pipelineIndex: null,
	}
}

beforeEach(() => {
	resetInspectorState()
})

describe('resolveExpressCallableForInvoke', () => {
	it('resolves function-style express handler without instance', () => {
		const entry: RegistryEntry = {
			...baseApiEntry(),
			style: 'function',
			originalFn: (_req: unknown, _res: unknown) => Return('OK', { ok: true }),
		}

		const resolved = resolveExpressCallableForInvoke('r-fn', 'Demo.handler', entry, 0)
		expect('error' in resolved).toBe(false)
		if ('error' in resolved) return
		expect(resolved.callThis).toBeUndefined()
		expect(resolved.callable({}, {})).toEqual({ ok: true })
	})

	it('returns NO_INSTANCE for class-style handler when instance is missing', () => {
		const entry: RegistryEntry = {
			...baseApiEntry(),
			style: 'class',
			originalFn: function noop() {},
		}

		const resolved = resolveExpressCallableForInvoke('r-class', 'Demo.handler', entry, 0)
		expect('error' in resolved).toBe(true)
		if (!('error' in resolved)) return
		expect(resolved.error.status).toBe('error')
		expect(resolved.error.label).toBe('NO_INSTANCE')
		expect(resolved.error.error?.code).toBe('NO_INSTANCE')
	})

	it('resolves class-style method when instance exists', () => {
		class Demo {
			handler(): unknown {
				return Return('OK', { ok: true, from: 'class' })
			}
		}
		registerInstance(new Demo())
		const entry: RegistryEntry = {
			...baseApiEntry(),
			style: 'class',
			originalFn: function noop() {},
		}

		const resolved = resolveExpressCallableForInvoke('r-class-ok', 'Demo.handler', entry, 0)
		expect('error' in resolved).toBe(false)
		if ('error' in resolved) return
		expect(resolved.callThis).toBeTruthy()
		expect(resolved.callable.call(resolved.callThis)).toEqual({ ok: true, from: 'class' })
	})
})

describe('invokeExpressPlayground ApiReturn vs Return label', () => {
	it('prefers ApiReturn label over prior Return label capture for api handlers', async () => {
		const fnKey = 'Demo.endpoint'
		Registry.set(fnKey, {
			...baseApiEntry(),
			className: 'Demo',
			method: 'endpoint',
			style: 'function',
			originalFn: (req: unknown, res: unknown) => {
				void req
				void res
				ActiveContext.push('Demo.middleware')
				try {
					Return('MW_OK', { step: 'mw' })
				} finally {
					ActiveContext.pop()
				}
				const r = ApiReturn('OK', 200, { ok: true })
				;(res as any).status(r.statusCode).json(r.body)
			},
		} as RegistryEntry)

		const resp = await invokeExpressPlayground(
			'r1',
			fnKey,
			{ method: 'POST', path: '/demo', headers: {}, body: {} },
			createExpressPlaygroundMocks,
		)
		expect(resp.status).toBe('ok')
		expect(resp.label).toBe('OK')
	})

	it('derives returnType from response body for api handlers when ApiReturn ran', async () => {
		const fnKey = 'Demo.endpoint2'
		Registry.set(fnKey, {
			...baseApiEntry(),
			className: 'Demo',
			method: 'endpoint2',
			style: 'function',
			originalFn: (_req: unknown, res: unknown) => {
				const r = ApiReturn('OK', 200, { ok: true, n: 1 })
				;(res as any).status(r.statusCode).json(r.body)
			},
		} as RegistryEntry)

		const resp = await invokeExpressPlayground(
			'r2',
			fnKey,
			{ method: 'POST', path: '/demo', headers: {}, body: {} },
			createExpressPlaygroundMocks,
		)
		expect(resp.status).toBe('ok')
		expect(resp.returnType).toBe('object')
	})

	it('uses last ApiReturn for same endpoint when multiple fire', async () => {
		const fnKey = 'Demo.multi'
		Registry.set(fnKey, {
			...baseApiEntry(),
			className: 'Demo',
			method: 'multi',
			style: 'function',
			originalFn: (_req: unknown, res: unknown) => {
				const r1 = ApiReturn('PARTIAL', 200, { step: 1 })
				;(res as any).status(r1.statusCode).json(r1.body)
				const r2 = ApiReturn('OK', 200, { step: 2 })
				;(res as any).status(r2.statusCode).json(r2.body)
			},
		} as RegistryEntry)

		const resp = await invokeExpressPlayground(
			'r3',
			fnKey,
			{ method: 'POST', path: '/demo', headers: {}, body: {} },
			createExpressPlaygroundMocks,
		)
		expect(resp.label).toBe('OK')
	})

	it('ignores manual capture for a different endpointKey', async () => {
		const fnKey = 'Demo.endpoint3'
		Registry.set(fnKey, {
			...baseApiEntry(),
			className: 'Demo',
			method: 'endpoint3',
			style: 'function',
			originalFn: (_req: unknown, res: unknown) => {
				recordExpressApiInvokeCapture('Other.endpoint', {
					label: 'BAD',
					statusCode: 200,
					body: { nope: true },
				})
				const r = ApiReturn('OK', 200, { ok: true })
				;(res as any).status(r.statusCode).json(r.body)
			},
		} as RegistryEntry)

		const resp = await invokeExpressPlayground(
			'r4',
			fnKey,
			{ method: 'POST', path: '/demo', headers: {}, body: {} },
			createExpressPlaygroundMocks,
		)
		expect(resp.label).toBe('OK')
	})
})

