import WebSocket, { WebSocketServer } from 'ws';
/**
 * Minimal WebSocket **duplex proxy** between a QA client and an existing
 * `startInspectorWebSocket` endpoint. Forwards JSON frames as-is (`BOOTSTRAP`,
 * `RPC_CALL` / `RPC_RESPONSE`, `QA_UPLOAD_*`, sessions, coverage, etc.).
 */
export function startRemoteInspectorBridge(options) {
    const host = options.listenHost ?? '127.0.0.1';
    return new Promise((resolve, reject) => {
        const wss = new WebSocketServer({ host, port: options.listenPort });
        wss.on('connection', (client) => {
            const upstream = new WebSocket(options.targetWsUrl);
            const pending = [];
            const flushPending = () => {
                if (upstream.readyState !== WebSocket.OPEN)
                    return;
                for (const chunk of pending)
                    upstream.send(chunk);
                pending.length = 0;
            };
            client.on('message', (data) => {
                const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
                if (upstream.readyState === WebSocket.OPEN)
                    upstream.send(buf);
                else
                    pending.push(buf);
            });
            upstream.on('open', () => {
                flushPending();
                upstream.on('message', (data) => {
                    if (client.readyState === WebSocket.OPEN)
                        client.send(data);
                });
            });
            const shutdownPair = () => {
                try {
                    client.close();
                }
                catch {
                    /* ignore */
                }
                try {
                    upstream.close();
                }
                catch {
                    /* ignore */
                }
            };
            client.on('close', shutdownPair);
            client.on('error', shutdownPair);
            upstream.on('close', shutdownPair);
            upstream.on('error', shutdownPair);
        });
        wss.on('listening', () => {
            const addr = wss.address();
            resolve({
                port: addr.port,
                close: () => new Promise((res, rej) => {
                    wss.close((err) => {
                        if (err)
                            rej(err);
                        else
                            res();
                    });
                }),
            });
        });
        wss.on('error', reject);
    });
}
//# sourceMappingURL=remote-inspector-bridge.js.map