import { describe, expect, it, beforeEach } from 'vitest'

import {
	clearBroadcastSink,
	Registry,
	resetInspectorState,
	runWithInspectorBroadcastTarget,
	setBroadcastSink,
} from './registry-state.js'
import { ApiReturn, Return } from './return.js'
import { cat, catModule } from './functional.js'

beforeEach(() => {
	resetInspectorState()
})

describe('cat', () => {
	it('registers service function metadata', () => {
		const f = cat('Demo.f', function f(x: number) {
			return Return('OK', x)
		})
		expect(typeof f).toBe('function')
		expect(Registry.has('Demo.f')).toBe(true)
		const e = Registry.get('Demo.f')!
		expect(e.mode).toBe('service')
		expect(e.style).toBe('function')
		expect(e.returns.map((r) => r.label)).toContain('OK')
	})

	it('stores paramsJsonSchema on registry entry when provided', () => {
		const schema = {
			type: 'array' as const,
			minItems: 1,
			maxItems: 1,
			items: [{ type: 'string' as const }],
		}
		cat(
			'Demo.withSchema',
			function withSchema(_s: string) {
				return Return('OK', 1)
			},
			{ paramsJsonSchema: schema },
		)
		expect(Registry.get('Demo.withSchema')?.paramsJsonSchema).toEqual(schema)
	})

	it('keeps ApiContext through async api handlers so ApiReturn after await is recorded', async () => {
		cat(
			'Demo.asyncApi',
			async function asyncApi(_req: unknown, _res: unknown) {
				await Promise.resolve()
				ApiReturn('OK', 200, { ok: true })
			},
			{ method: 'POST', route: '/async-api' },
		)
		const { clearExpressApiInvokeCapture, readExpressApiInvokeCapture } = await import('./registry-state.js')
		clearExpressApiInvokeCapture()
		const wrapped = Registry.get('Demo.asyncApi')!.originalFn as (a: unknown, b: unknown) => Promise<unknown>
		await wrapped({}, {})
		const cap = readExpressApiInvokeCapture('Demo.asyncApi')
		expect(cap?.label).toBe('OK')
	})

	it('marks as api when route option is provided', () => {
		cat(
			'Demo.h',
			function h(req: unknown, res: unknown) {
				return { req, res }
			},
			{ method: 'POST', route: '/x' },
		)
		const e = Registry.get('Demo.h')!
		expect(e.mode).toBe('api')
		expect(e.route).toBe('/x')
		expect(e.httpMethod).toBe('POST')
	})

	it('throws when the same fnKey is registered twice', () => {
		cat('Demo.uniqueOnce', function once(x: number) {
			return Return('OK', x)
		})
		expect(() =>
			cat('Demo.uniqueOnce', function twice(x: number) {
				return Return('OK', x)
			}),
		).toThrow(/duplicate fnKey/)
	})

	it('emits MIDDLEWARE_NEXT when api_candidate middleware calls next()', () => {
		const seen: any[] = []
		setBroadcastSink((data) => {
			seen.push(data)
		})

		const mw = cat('DemoMiddleware.ok', function ok(req: unknown, res: unknown, next: any) {
			void req
			void res
			next()
		})

		runWithInspectorBroadcastTarget(
			'socket-1',
			() => {
				mw({}, {}, () => {})
			},
			{ source: 'http', correlationId: 'cid-1' },
		)
		clearBroadcastSink()

		const ev = seen.find((e) => e?.event === 'MIDDLEWARE_NEXT')
		expect(ev).toBeTruthy()
		expect(ev.fnKey).toBe('DemoMiddleware.ok')
		expect(ev.correlationId).toBe('cid-1')
	})

	it('emits ERROR_THROWN once when api_candidate middleware calls next(err)', () => {
		const seen: any[] = []
		setBroadcastSink((data) => {
			seen.push(data)
		})

		const mw = cat('DemoMiddleware.err', function err(req: unknown, res: unknown, next: any) {
			void req
			void res
			next(new Error('boom'))
		})

		runWithInspectorBroadcastTarget(
			'socket-1',
			() => {
				mw({}, {}, () => {})
			},
			{ source: 'http', correlationId: 'cid-2' },
		)
		clearBroadcastSink()

		const errs = seen.filter((e) => e?.event === 'ERROR_THROWN' && e?.fnKey === 'DemoMiddleware.err')
		expect(errs.length).toBe(1)
		expect(errs[0].correlationId).toBe('cid-2')
	})

	it('emits MIDDLEWARE_NEXT only once when next() is called twice', () => {
		const seen: any[] = []
		setBroadcastSink((data) => {
			seen.push(data)
		})

		const mw = cat(
			'DemoMiddleware.doubleNext',
			function doubleNext(req: unknown, res: unknown, next: any) {
				void req
				void res
				next()
				next()
			},
		)

		runWithInspectorBroadcastTarget(
			'socket-1',
			() => {
				mw({}, {}, () => {})
			},
			{ source: 'http', correlationId: 'cid-3' },
		)
		clearBroadcastSink()

		const nextEvents = seen.filter(
			(e) => e?.event === 'MIDDLEWARE_NEXT' && e?.fnKey === 'DemoMiddleware.doubleNext',
		)
		expect(nextEvents.length).toBe(1)
	})
})

describe('catModule', () => {
	it('wraps and registers all functions in module', () => {
		const mod = catModule('M', {
			a(x: number) {
				return Return('A', x)
			},
			b(y: string) {
				return Return('B', y)
			},
		})

		expect(typeof mod.a).toBe('function')
		expect(typeof mod.b).toBe('function')
		expect(Registry.has('M.a')).toBe(true)
		expect(Registry.has('M.b')).toBe(true)
	})

	it('applies per-method paramsJsonSchema from options', () => {
		const tuple = {
			type: 'array' as const,
			minItems: 1,
			maxItems: 1,
			items: [{ type: 'boolean' as const }],
		}
		catModule(
			'ModSch',
			{
				flag(v: boolean) {
					return Return('OK', v)
				},
			},
			{ flag: { paramsJsonSchema: tuple } },
		)
		expect(Registry.get('ModSch.flag')?.paramsJsonSchema).toEqual(tuple)
	})
})

