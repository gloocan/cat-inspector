import WebSocket from 'ws'

import { describe, expect, it, vi } from 'vitest'

import { startInspectorWebSocket } from './ws-server.js'
import { PROTOCOL_VERSION, type RegistryEntry } from '../types.js'
import { Registry, registerInstance, resetInspectorState } from '../registry-state.js'
import { Return } from '../return.js'

describe('startInspectorWebSocket', () => {
	it('sends BOOTSTRAP on connect', async () => {
		const registry: Record<string, RegistryEntry> = {
			'Demo.f': {
				mode: 'service',
				className: 'Demo',
				method: 'f',
				style: 'class',
				body: '',
				params: [],
				declaredReturn: 'void',
				returns: [],
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
			},
		}
		const tree: object[] = []

		const server = await startInspectorWebSocket(registry, tree, {
			port: 0,
			host: '127.0.0.1',
		})

		await new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${server.port}`)
			ws.on('message', (data) => {
				try {
					const msg = JSON.parse(data.toString()) as {
						event: string
						protocolVersion: number
						registry: typeof registry
					}
					expect(msg.event).toBe('BOOTSTRAP')
					expect(msg.protocolVersion).toBe(PROTOCOL_VERSION)
					expect(msg.registry['Demo.f']?.method).toBe('f')
					expect((msg as { qaFileWire?: { mode: string } }).qaFileWire).toEqual({ mode: 'ref' })
					ws.close()
					resolve()
				} catch (e) {
					reject(e)
				}
			})
			ws.on('error', reject)
		})

		await server.close()
	})

	it('handles RPC_CALL and replies with RPC_RESPONSE', async () => {
		resetInspectorState()

		class Demo {
			f(x: number): number {
				return Return('OK', x + 1)
			}
		}
		registerInstance(new Demo())

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

		const server = await startInspectorWebSocket(
			{ 'Demo.f': Registry.get('Demo.f')! },
			[],
			{ port: 0, host: '127.0.0.1' },
		)

		await new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${server.port}`)
			ws.on('message', (data) => {
				const msg = JSON.parse(data.toString()) as { event?: string; type?: string }
				if (msg.event === 'BOOTSTRAP') {
					ws.send(
						JSON.stringify({
							type: 'RPC_CALL',
							requestId: 'r1',
							fnKey: 'Demo.f',
							args: [1],
						}),
					)
					return
				}
				if (msg.type === 'RPC_RESPONSE') {
					expect(msg).toMatchObject({ status: 'ok', fnKey: 'Demo.f' })
					ws.close()
					resolve()
				}
			})
			ws.on('error', reject)
		})

		await server.close()
	})

	it('handles SESSION_CREATE with SESSION_STATE reply', async () => {
		const registry: Record<string, RegistryEntry> = {}
		const tree: object[] = []
		const server = await startInspectorWebSocket(registry, tree, {
			port: 0,
			host: '127.0.0.1',
		})

		await new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${server.port}`)
			let sawBootstrap = false
			ws.on('message', (data) => {
				const msg = JSON.parse(data.toString()) as { event?: string; type?: string }
				if (msg.event === 'BOOTSTRAP') {
					sawBootstrap = true
					ws.send(
						JSON.stringify({
							type: 'SESSION_CREATE',
							requestId: 'sr1',
							sessionKey: 'demo',
						}),
					)
					return
				}
				if (sawBootstrap && msg.type === 'SESSION_STATE') {
					expect(msg).toMatchObject({
						type: 'SESSION_STATE',
						protocolVersion: PROTOCOL_VERSION,
						requestId: 'sr1',
					})
					expect(typeof (msg as { sessionId?: string }).sessionId).toBe('string')
					ws.close()
					resolve()
				}
			})
			ws.on('error', reject)
		})

		await server.close()
	})

	it('QA_UPLOAD + RPC_CALL materializes __qaFileRef when upload.enabled', async () => {
		resetInspectorState()

		Registry.set('UpEcho.take', {
			mode: 'service',
			className: 'UpEcho',
			method: 'take',
			style: 'function',
			body: '',
			params: [{ name: 'buf', type: 'Buffer', kind: 'file' }],
			declaredReturn: 'string',
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
			originalFn: (buf: Buffer) => Return('OK', buf.toString('utf8')),
		})

		const entry = Registry.get('UpEcho.take')!
		const server = await startInspectorWebSocket({ 'UpEcho.take': entry }, [], {
			port: 0,
			host: '127.0.0.1',
			upload: { enabled: true, maxSizeBytes: 1024 * 1024, idleTimeoutMs: 60_000 },
		})

		await new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${server.port}`)
			let uploadId = ''
			ws.on('message', (data) => {
				const msg = JSON.parse(data.toString()) as Record<string, unknown>
				if (msg.event === 'BOOTSTRAP') {
					ws.send(
						JSON.stringify({
							type: 'QA_UPLOAD_START',
							filename: 't.bin',
							contentType: 'application/octet-stream',
							sizeBytes: 3,
						}),
					)
					return
				}
				if (msg.type === 'QA_UPLOAD_ACK' && msg.accepted === true && typeof msg.uploadId === 'string') {
					uploadId = msg.uploadId
					ws.send(
						JSON.stringify({
							type: 'QA_UPLOAD_CHUNK',
							b64: Buffer.from('abc', 'utf8').toString('base64'),
						}),
					)
					return
				}
				if (msg.type === 'QA_UPLOAD_PROGRESS') {
					ws.send(JSON.stringify({ type: 'QA_UPLOAD_FINISH', uploadId }))
					return
				}
				if (msg.type === 'QA_UPLOAD_COMPLETE') {
					ws.send(
						JSON.stringify({
							type: 'RPC_CALL',
							requestId: 'r-up',
							fnKey: 'UpEcho.take',
							args: [{ __qaFileRef: uploadId }],
						}),
					)
					return
				}
				if (msg.type === 'RPC_RESPONSE') {
					expect(msg.status).toBe('ok')
					expect(msg.result).toBe('abc')
					ws.close()
					resolve()
				}
			})
			ws.on('error', reject)
		})

		await server.close()
	})

	it('RPC_CALL materializes __qaFileUrl when upload disabled and fileUrl configured', async () => {
		resetInspectorState()

		Registry.set('UrlEcho.take', {
			mode: 'service',
			className: 'UrlEcho',
			method: 'take',
			style: 'function',
			body: '',
			params: [{ name: 'buf', type: 'Buffer', kind: 'file' }],
			declaredReturn: 'string',
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
			originalFn: (buf: Buffer) => Return('OK', buf.toString('utf8')),
		})

		const origFetch = globalThis.fetch
		globalThis.fetch = vi.fn(async () => {
			return new Response(new Uint8Array([120, 121]), {
				status: 200,
				headers: { 'content-type': 'text/plain', 'content-length': '2' },
			}) as any
		}) as any

		const entry = Registry.get('UrlEcho.take')!
		const server = await startInspectorWebSocket({ 'UrlEcho.take': entry }, [], {
			port: 0,
			host: '127.0.0.1',
			qaFileWire: { mode: 'url' },
			fileUrl: {
				allowedHosts: ['example.com'],
				maxDownloadBytes: 1024,
				timeoutMs: 5000,
			},
		})

		try {
			await new Promise<void>((resolve, reject) => {
				const ws = new WebSocket(`ws://127.0.0.1:${server.port}`)
				ws.on('message', (data) => {
					const msg = JSON.parse(data.toString()) as Record<string, unknown>
					if (msg.event === 'BOOTSTRAP') {
						ws.send(
							JSON.stringify({
								type: 'RPC_CALL',
								requestId: 'r-url',
								fnKey: 'UrlEcho.take',
								args: [{ __qaFileUrl: 'https://example.com/blob.bin' }],
							}),
						)
						return
					}
					if (msg.type === 'RPC_RESPONSE') {
						expect(msg.status).toBe('ok')
						expect(msg.result).toBe('xy')
						ws.close()
						resolve()
					}
				})
				ws.on('error', reject)
			})
		} finally {
			globalThis.fetch = origFetch
			await server.close()
		}
	})
})
