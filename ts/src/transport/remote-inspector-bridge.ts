import type { AddressInfo } from 'node:net'

import WebSocket, { WebSocketServer } from 'ws'

export interface RemoteInspectorBridgeOptions {
	/** Local port QA WebSocket clients connect to. */
	listenPort: number
	listenHost?: string
	/** Target embedded inspector, e.g. `ws://127.0.0.1:9234?token=secret` */
	targetWsUrl: string
}

export interface RemoteInspectorBridgeHandle {
	readonly port: number
	close(): Promise<void>
}

/**
 * Minimal WebSocket **duplex proxy** between a QA client and an existing
 * `startInspectorWebSocket` endpoint. Forwards JSON frames as-is (`BOOTSTRAP`,
 * `RPC_CALL` / `RPC_RESPONSE`, `QA_UPLOAD_*`, sessions, coverage, etc.).
 */
export function startRemoteInspectorBridge(
	options: RemoteInspectorBridgeOptions,
): Promise<RemoteInspectorBridgeHandle> {
	const host = options.listenHost ?? '127.0.0.1'
	return new Promise((resolve, reject) => {
		const wss = new WebSocketServer({ host, port: options.listenPort })

		wss.on('connection', (client: WebSocket) => {
			const upstream = new WebSocket(options.targetWsUrl)
			const pending: Buffer[] = []

			const flushPending = (): void => {
				if (upstream.readyState !== WebSocket.OPEN) return
				for (const chunk of pending) upstream.send(chunk)
				pending.length = 0
			}

			client.on('message', (data) => {
				const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
				if (upstream.readyState === WebSocket.OPEN) upstream.send(buf)
				else pending.push(buf)
			})

			upstream.on('open', () => {
				flushPending()
				upstream.on('message', (data) => {
					if (client.readyState === WebSocket.OPEN) client.send(data as Buffer)
				})
			})

			const shutdownPair = (): void => {
				try {
					client.close()
				} catch {
					/* ignore */
				}
				try {
					upstream.close()
				} catch {
					/* ignore */
				}
			}

			client.on('close', shutdownPair)
			client.on('error', shutdownPair)
			upstream.on('close', shutdownPair)
			upstream.on('error', shutdownPair)
		})

		wss.on('listening', () => {
			const addr = wss.address() as AddressInfo
			resolve({
				port: addr.port,
				close: () =>
					new Promise<void>((res, rej) => {
						wss.close((err) => {
							if (err) rej(err)
							else res()
						})
					}),
			})
		})

		wss.on('error', reject)
	})
}
