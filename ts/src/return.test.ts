import { describe, expect, it } from 'vitest'

import {
	ActiveContext,
	ApiContext,
	clearBroadcastSink,
	Registry,
	resetInspectorState,
	setBroadcastSink,
} from './registry-state.js'
import { ApiReturn, Throw, getShape, getType, Return } from './return.js'

describe('getType / getShape', () => {
	it('getType classifies primitives', () => {
		expect(getType(null)).toBe('null')
		expect(getType(undefined)).toBe('undefined')
		expect(getType(3)).toBe('int')
		expect(getType(3.1)).toBe('float')
		expect(getType('x')).toBe('string')
	})

	it('getShape nests objects', () => {
		const s = getShape({ a: { b: 1 } })
		expect(s).toContain('a:')
		expect(s).toContain('b:')
	})

	it('getShape expands arrays of objects', () => {
		const s = getShape({ issues: [{ path: 'x', message: 'required' }] })
		expect(s).toContain('issues: Array<')
		expect(s).toContain('path:')
		expect(s).toContain('message:')
	})
})

describe('Return', () => {
	it('updates registry when ActiveContext matches', () => {
		resetInspectorState()
		Registry.set('Demo.m', {
			mode: 'service',
			className: 'Demo',
			method: 'm',
			style: 'class',
			body: '',
			params: [],
			declaredReturn: 'void',
			returns: [{ label: 'X', type: null, status: 'pending' }],
			errors: [],
			children: [],
			parents: [],
			route: null,
			httpMethod: null,
			apiResponses: [],
			serviceLinks: [],
			pipelineId: null,
			pipelineIndex: null,
			originalFn: function noop() {},
		})

		ActiveContext.set('Demo.m')
		const v = Return('X', { n: 1 })
		expect(v).toEqual({ n: 1 })
		expect(Registry.get('Demo.m')?.returns[0]?.status).toBe('resolved')
		expect(Registry.get('Demo.m')?.returns[0]?.type).toContain('n')
		ActiveContext.pop()
	})

	it('returns value unchanged without context', () => {
		resetInspectorState()
		expect(Return('L', 5)).toBe(5)
	})
})

describe('Throw', () => {
	it('throws and records ErrorCapture when ActiveContext matches', () => {
		resetInspectorState()
		Registry.set('Demo.t', {
			mode: 'service',
			className: 'Demo',
			method: 't',
			style: 'class',
			body: '',
			params: [],
			declaredReturn: 'void',
			returns: [],
			errors: [{ label: 'BAD', type: null, message: null, status: 'pending' }],
			children: [],
			parents: [],
			route: null,
			httpMethod: null,
			apiResponses: [],
			serviceLinks: [],
			pipelineId: null,
			pipelineIndex: null,
			originalFn: function noop() {},
		})

		ActiveContext.set('Demo.t')
		expect(() => Throw('BAD', new Error('nope'))).toThrow('nope')
		expect(Registry.get('Demo.t')?.errors[0]?.status).toBe('resolved')
		ActiveContext.pop()
	})
})

describe('ActiveContext nesting', () => {
	it('restores parent context after nested wrapped calls', () => {
		resetInspectorState()
		const seen: any[] = []
		setBroadcastSink((data) => {
			seen.push(data)
		})

		Registry.set('A.parent', {
			mode: 'service',
			className: 'A',
			method: 'parent',
			style: 'function',
			body: '',
			params: [],
			declaredReturn: 'unknown',
			returns: [{ label: 'P', type: null, status: 'pending' }],
			errors: [],
			children: [],
			parents: [],
			route: null,
			httpMethod: null,
			apiResponses: [],
			serviceLinks: [],
			pipelineId: null,
			pipelineIndex: null,
			originalFn: function noop() {},
		})
		Registry.set('B.child', {
			mode: 'service',
			className: 'B',
			method: 'child',
			style: 'function',
			body: '',
			params: [],
			declaredReturn: 'unknown',
			returns: [{ label: 'C', type: null, status: 'pending' }],
			errors: [],
			children: [],
			parents: [],
			route: null,
			httpMethod: null,
			apiResponses: [],
			serviceLinks: [],
			pipelineId: null,
			pipelineIndex: null,
			originalFn: function noop() {},
		})

		function child() {
			return Return('C', { ok: true })
		}
		function parent() {
			ActiveContext.push('B.child')
			try {
				child()
			} finally {
				ActiveContext.pop()
			}
			return Return('P', { done: true })
		}

		ActiveContext.push('A.parent')
		try {
			parent()
		} finally {
			ActiveContext.pop()
		}

		clearBroadcastSink()

		const resolved = seen.filter((e) => e?.event === 'RETURN_RESOLVED')
		expect(resolved.some((e) => e.fnKey === 'B.child' && e.label === 'C')).toBe(true)
		expect(resolved.some((e) => e.fnKey === 'A.parent' && e.label === 'P')).toBe(true)
	})
})

describe('ApiReturn', () => {
	it('returns payload shape', () => {
		resetInspectorState()
		const r = ApiReturn('X', 201, { ok: true })
		expect(r.statusCode).toBe(201)
		expect(r.body).toEqual({ ok: true })
	})
})

describe('ApiReturn inspector payload', () => {
	it('includes body on API_RESPONSE broadcast (best-effort)', () => {
		resetInspectorState()
		const seen: object[] = []
		setBroadcastSink((data) => {
			seen.push(data)
		})
		Registry.set('Demo.api', {
			mode: 'api',
			className: 'Demo',
			method: 'api',
			style: 'function',
			body: '',
			params: [],
			declaredReturn: 'void',
			returns: [],
			errors: [],
			children: [],
			parents: [],
			route: '/demo',
			httpMethod: 'post',
			apiResponses: [{ label: 'X', statusCode: null, bodyShape: null, status: 'pending' }],
			serviceLinks: [],
			pipelineId: null,
			pipelineIndex: null,
			originalFn: function noop() {},
		})
		ApiContext.set('Demo.api')
		ApiReturn('X', 422, { issues: [{ path: 'sku', message: 'string required' }] })
		ApiContext.clear()
		clearBroadcastSink()
		expect(seen.some((e) => (e as any).event === 'API_RESPONSE' && (e as any).body)).toBe(true)
	})
})
