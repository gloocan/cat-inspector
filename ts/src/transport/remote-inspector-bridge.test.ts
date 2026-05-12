import WebSocket from 'ws'

import { describe, expect, it } from 'vitest'

import { Registry, registerInstance, resetInspectorState } from '../registry-state.js'
import { Return } from '../return.js'
import type { RegistryEntry } from '../types.js'
import { PROTOCOL_VERSION } from '../types.js'
import { startInspectorWebSocket } from './ws-server.js'
import { startRemoteInspectorBridge } from './remote-inspector-bridge.js'

describe('startRemoteInspectorBridge', () => {
	it('proxies BOOTSTRAP and RPC_CALL to an embedded inspector', async () => {
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
		} satisfies RegistryEntry)

		const entry = Registry.get('Demo.f')!
		const embedded = await startInspectorWebSocket({ 'Demo.f': entry }, [], {
			port: 0,
			host: '127.0.0.1',
		})

		const bridge = await startRemoteInspectorBridge({
			listenPort: 0,
			listenHost: '127.0.0.1',
			targetWsUrl: `ws://127.0.0.1:${embedded.port}`,
		})

		await new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`)
			ws.on('message', (data) => {
				const msg = JSON.parse(data.toString()) as { event?: string; type?: string }
				if (msg.event === 'BOOTSTRAP') {
					expect(msg).toMatchObject({ protocolVersion: PROTOCOL_VERSION })
					ws.send(
						JSON.stringify({
							type: 'RPC_CALL',
							requestId: 'rb1',
							fnKey: 'Demo.f',
							args: [2],
						}),
					)
					return
				}
				if (msg.type === 'RPC_RESPONSE') {
					expect(msg).toMatchObject({ status: 'ok', result: 3 })
					ws.close()
					resolve()
				}
			})
			ws.on('error', reject)
		})

		await bridge.close()
		await embedded.close()
	})
})
