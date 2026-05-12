import { describe, expect, it, beforeEach } from 'vitest'
import express from 'express'

import { registerHttpBridgeRoute } from './http-bridge-registry.js'
import { setInvokeTimeoutMs } from './invoke-runtime-config.js'
import { setRpcSerializationConfig } from './serialize-rpc-result.js'
import { executeRPC } from './rpc.js'
import {
	registerClassConstructor,
	registerInstance,
	registerParamsJsonSchema,
	Registry,
	resetInspectorState,
} from './registry-state.js'
import { Return } from './return.js'

beforeEach(() => {
	resetInspectorState()
})

describe('executeRPC', () => {
	it('invokes instance method and returns ok', async () => {
		class Demo {
			f(x: number): number {
				return Return('OK', x + 1)
			}
		}

		Registry.set('Demo.f', {
			mode: 'service',
			className: 'Demo',
			method: 'f',
			style: 'class',
			body: '',
			params: [{ name: 'x', type: 'number' }],
			declaredReturn: 'number',
			returns: [{ label: 'OK', type: null, status: 'pending' }],
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

		registerInstance(new Demo())

		const resp = await executeRPC({
			requestId: 'r1',
			fnKey: 'Demo.f',
			args: [1],
		})

		expect(resp.status).toBe('ok')
		expect(resp.result).toBe(2)
		expect(resp.label).toBe('OK')
		expect(resp.returnShape).toBe('int')
	})

	it('returns validation error for unknown fn', async () => {
		const resp = await executeRPC({ requestId: 'r2', fnKey: 'X.y', args: [] })
		expect(resp.status).toBe('error')
		expect(resp.error?.layer).toBe('validation')
		expect(resp.error?.code).toBe('FN_NOT_FOUND')
	})

	it('invokes function-style entry without registerInstance', async () => {
		Registry.set('Demo.f', {
			mode: 'service',
			className: 'Demo',
			method: 'f',
			style: 'function',
			body: '',
			params: [{ name: 'x', type: 'number' }],
			declaredReturn: 'number',
			returns: [{ label: 'OK', type: null, status: 'pending' }],
			errors: [],
			children: [],
			parents: [],
			route: null,
			httpMethod: null,
			apiResponses: [],
			serviceLinks: [],
			pipelineId: null,
			pipelineIndex: null,
			originalFn: (x: number) => Return('OK', x + 1),
		})

		const resp = await executeRPC({
			requestId: 'r3',
			fnKey: 'Demo.f',
			args: [1],
		})

		expect(resp.status).toBe('ok')
		expect(resp.result).toBe(2)
		expect(resp.label).toBe('OK')
	})

	it('invokes class-style entry via resolver without registerInstance', async () => {
		class Demo {
			f(x: number): number {
				return Return('OK', x + 1)
			}
		}

		registerClassConstructor('Demo', Demo)

		Registry.set('Demo.f', {
			mode: 'service',
			className: 'Demo',
			method: 'f',
			style: 'class',
			body: '',
			params: [{ name: 'x', type: 'number' }],
			declaredReturn: 'number',
			returns: [{ label: 'OK', type: null, status: 'pending' }],
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

		const resp = await executeRPC({
			requestId: 'r4',
			fnKey: 'Demo.f',
			args: [1],
		})

		expect(resp.status).toBe('ok')
		expect(resp.result).toBe(2)
	})

	it('explicit registerInstance wins over auto-instantiated singleton', async () => {
		class Demo {
			f(x: number): number {
				return Return('OK', x + 1)
			}
		}

		registerClassConstructor('Demo', Demo)

		Registry.set('Demo.f', {
			mode: 'service',
			className: 'Demo',
			method: 'f',
			style: 'class',
			body: '',
			params: [{ name: 'x', type: 'number' }],
			declaredReturn: 'number',
			returns: [{ label: 'OK', type: null, status: 'pending' }],
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

		registerInstance({
			constructor: { name: 'Demo' },
			f: (x: number) => Return('OK', x + 100),
		})

		const resp = await executeRPC({
			requestId: 'r5',
			fnKey: 'Demo.f',
			args: [1],
		})

		expect(resp.status).toBe('ok')
		expect(resp.result).toBe(101)
	})

	it('serializes bigint in result when rpcSerialization enabled', async () => {
		setRpcSerializationConfig({ enabled: true, maxUtf8Bytes: 64_000 })
		Registry.set('Demo.big', {
			mode: 'service',
			className: 'Demo',
			method: 'big',
			style: 'function',
			body: '',
			params: [],
			declaredReturn: 'object',
			returns: [{ label: 'OK', type: null, status: 'pending' }],
			errors: [],
			children: [],
			parents: [],
			route: null,
			httpMethod: null,
			apiResponses: [],
			serviceLinks: [],
			pipelineId: null,
			pipelineIndex: null,
			originalFn: () => Return('OK', { v: 9n }),
		})

		const resp = await executeRPC({
			requestId: 'r-big',
			fnKey: 'Demo.big',
			args: [],
		})

		expect(resp.status).toBe('ok')
		expect(resp.result).toEqual({ v: '9' })
	})

	it('times out slow handler when invokeTimeoutMs is set', async () => {
		setInvokeTimeoutMs(40)
		Registry.set('Slow.f', {
			mode: 'service',
			className: 'Slow',
			method: 'f',
			style: 'function',
			body: '',
			params: [],
			declaredReturn: 'number',
			returns: [{ label: 'OK', type: null, status: 'pending' }],
			errors: [],
			children: [],
			parents: [],
			route: null,
			httpMethod: null,
			apiResponses: [],
			serviceLinks: [],
			pipelineId: null,
			pipelineIndex: null,
			originalFn: () =>
				new Promise<unknown>((resolve) => {
					setTimeout(() => resolve(Return('OK', 1)), 200)
				}),
		})

		const resp = await executeRPC({ requestId: 'r-to', fnKey: 'Slow.f', args: [] })
		expect(resp.status).toBe('error')
		expect(resp.label).toBe('INVOKE_TIMEOUT')
		expect(resp.error?.code).toBe('INVOKE_TIMEOUT')
	})

	it('validates paramsJsonSchema when validateParamsJsonSchema is on', async () => {
		setRpcSerializationConfig({ validateParamsJsonSchema: true })
		Registry.set('In.f', {
			mode: 'service',
			className: 'In',
			method: 'f',
			style: 'function',
			body: '',
			params: [{ name: 'x', type: 'number' }],
			declaredReturn: 'number',
			returns: [{ label: 'OK', type: null, status: 'pending' }],
			errors: [],
			children: [],
			parents: [],
			route: null,
			httpMethod: null,
			apiResponses: [],
			serviceLinks: [],
			pipelineId: null,
			pipelineIndex: null,
			paramsJsonSchema: {
				type: 'array',
				minItems: 1,
				maxItems: 1,
				items: [{ type: 'number' }],
			},
			originalFn: (x: number) => Return('OK', x),
		})

		const bad = await executeRPC({ requestId: 'r-in-bad', fnKey: 'In.f', args: ['nope'] })
		expect(bad.status).toBe('error')
		expect(bad.label).toBe('INPUT_SCHEMA_INVALID')
		expect(bad.error?.code).toBe('INPUT_SCHEMA_INVALID')

		const ok = await executeRPC({ requestId: 'r-in-ok', fnKey: 'In.f', args: [3] })
		expect(ok.status).toBe('ok')
		expect(ok.result).toBe(3)
	})

	it('skips paramsJsonSchema when validateParamsJsonSchema is off', async () => {
		Registry.set('In2.f', {
			mode: 'service',
			className: 'In2',
			method: 'f',
			style: 'function',
			body: '',
			params: [{ name: 'x', type: 'number' }],
			declaredReturn: 'number',
			returns: [{ label: 'OK', type: null, status: 'pending' }],
			errors: [],
			children: [],
			parents: [],
			route: null,
			httpMethod: null,
			apiResponses: [],
			serviceLinks: [],
			pipelineId: null,
			pipelineIndex: null,
			paramsJsonSchema: {
				type: 'array',
				minItems: 1,
				maxItems: 1,
				items: [{ type: 'number' }],
			},
			originalFn: (x: unknown) => Return('OK', x),
		})

		const resp = await executeRPC({ requestId: 'r-in2', fnKey: 'In2.f', args: ['nope'] })
		expect(resp.status).toBe('ok')
	})

	it('validates params before http_synthetic bridge', async () => {
		setRpcSerializationConfig({ validateParamsJsonSchema: true })
		const app = express()
		app.post('/never-hit', (_req, res) => {
			res.json({ hit: true })
		})

		Registry.set('BridgeIn.hit', {
			mode: 'service',
			className: 'BridgeIn',
			method: 'hit',
			style: 'function',
			body: '',
			params: [{ name: 'x', type: 'number' }],
			declaredReturn: 'object',
			returns: [{ label: 'OK', type: null, status: 'pending' }],
			errors: [],
			children: [],
			parents: [],
			route: null,
			httpMethod: null,
			apiResponses: [],
			serviceLinks: [],
			pipelineId: null,
			pipelineIndex: null,
			invokeKind: 'http_synthetic',
			paramsJsonSchema: {
				type: 'array',
				minItems: 1,
				maxItems: 1,
				items: [{ type: 'number' }],
			},
			originalFn: () => {},
		})
		registerHttpBridgeRoute(app, {
			fnKey: 'BridgeIn.hit',
			method: 'post',
			path: '/never-hit',
			mapArgsToBody: (args) => ({ x: args[0] }),
		})

		const resp = await executeRPC({ requestId: 'r-br-in', fnKey: 'BridgeIn.hit', args: ['bad'] })
		expect(resp.status).toBe('error')
		expect(resp.error?.code).toBe('INPUT_SCHEMA_INVALID')
	})

	it('registerParamsJsonSchema attaches tuple schema', async () => {
		setRpcSerializationConfig({ validateParamsJsonSchema: true })
		Registry.set('RegP.f', {
			mode: 'service',
			className: 'RegP',
			method: 'f',
			style: 'function',
			body: '',
			params: [{ name: 'a', type: 'unknown' }],
			declaredReturn: 'unknown',
			returns: [{ label: 'OK', type: null, status: 'pending' }],
			errors: [],
			children: [],
			parents: [],
			route: null,
			httpMethod: null,
			apiResponses: [],
			serviceLinks: [],
			pipelineId: null,
			pipelineIndex: null,
			originalFn: (a: unknown) => Return('OK', a),
		})
		registerParamsJsonSchema('RegP.f', {
			type: 'array',
			minItems: 1,
			maxItems: 1,
			items: [{ type: 'string', minLength: 1 }],
		})

		const bad = await executeRPC({ requestId: 'r-rp', fnKey: 'RegP.f', args: [''] })
		expect(bad.error?.code).toBe('INPUT_SCHEMA_INVALID')
	})

	it('validates returnJsonSchema when opt-in serialization flags are on', async () => {
		setRpcSerializationConfig({ enabled: true, maxUtf8Bytes: 64_000, validateReturnJsonSchema: true })
		Registry.set('Schema.f', {
			mode: 'service',
			className: 'Schema',
			method: 'f',
			style: 'function',
			body: '',
			params: [],
			declaredReturn: 'object',
			returns: [{ label: 'OK', type: null, status: 'pending' }],
			errors: [],
			children: [],
			parents: [],
			route: null,
			httpMethod: null,
			apiResponses: [],
			serviceLinks: [],
			pipelineId: null,
			pipelineIndex: null,
			returnJsonSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
			originalFn: () => Return('OK', { n: 'x' }),
		})

		const bad = await executeRPC({ requestId: 'r-sch', fnKey: 'Schema.f', args: [] })
		expect(bad.status).toBe('error')
		expect(bad.label).toBe('RETURN_SCHEMA_INVALID')
		expect(bad.error?.code).toBe('RETURN_SCHEMA_INVALID')

		Registry.set('Schema.ok', {
			mode: 'service',
			className: 'Schema',
			method: 'ok',
			style: 'function',
			body: '',
			params: [],
			declaredReturn: 'object',
			returns: [{ label: 'OK', type: null, status: 'pending' }],
			errors: [],
			children: [],
			parents: [],
			route: null,
			httpMethod: null,
			apiResponses: [],
			serviceLinks: [],
			pipelineId: null,
			pipelineIndex: null,
			returnJsonSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
			originalFn: () => Return('OK', { n: 1 }),
		})
		const ok = await executeRPC({ requestId: 'r-sok', fnKey: 'Schema.ok', args: [] })
		expect(ok.status).toBe('ok')
	})

	it('http_synthetic bridge invokes express route', async () => {
		const app = express()
		app.use(express.json())
		app.post('/bridge-echo', (req, res) => {
			res.status(202).json({ echoed: req.body })
		})

		Registry.set('BridgeDemo.hit', {
			mode: 'service',
			className: 'BridgeDemo',
			method: 'hit',
			style: 'function',
			body: '',
			params: [],
			declaredReturn: 'object',
			returns: [{ label: 'OK', type: null, status: 'pending' }],
			errors: [],
			children: [],
			parents: [],
			route: null,
			httpMethod: null,
			apiResponses: [],
			serviceLinks: [],
			pipelineId: null,
			pipelineIndex: null,
			originalFn: () => {},
		})
		registerHttpBridgeRoute(app, {
			fnKey: 'BridgeDemo.hit',
			method: 'post',
			path: '/bridge-echo',
			mapArgsToBody: () => ({ hello: 'ws' }),
		})

		const resp = await executeRPC({ requestId: 'r-br', fnKey: 'BridgeDemo.hit', args: [] })
		expect(resp.status).toBe('ok')
		expect(resp.result).toMatchObject({
			http: {
				statusCode: 202,
				body: { echoed: { hello: 'ws' } },
			},
		})
	})

	it('propagates artifacts from ok handler result', async () => {
		Registry.set('Art.f', {
			mode: 'service',
			className: 'Art',
			method: 'f',
			style: 'function',
			body: '',
			params: [],
			declaredReturn: 'object',
			returns: [{ label: 'OK', type: null, status: 'pending' }],
			errors: [],
			children: [],
			parents: [],
			route: null,
			httpMethod: null,
			apiResponses: [],
			serviceLinks: [],
			pipelineId: null,
			pipelineIndex: null,
			originalFn: () => Return('OK', { n: 1, artifacts: [{ kind: 'screen', uploadUrl: 'https://x' }] }),
		})

		const resp = await executeRPC({ requestId: 'r-art', fnKey: 'Art.f', args: [] })
		expect(resp.status).toBe('ok')
		expect(resp.artifacts).toEqual([{ kind: 'screen', uploadUrl: 'https://x' }])
	})
})

