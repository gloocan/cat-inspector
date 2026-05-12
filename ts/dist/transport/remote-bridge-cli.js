/**
 * Standalone bridge: `TARGET_WS_URL` → listen on `BRIDGE_PORT` (default 9339).
 * Run after `npm run build` from package root:
 * `node dist/transport/remote-bridge-cli.js`
 */
import { startRemoteInspectorBridge } from './remote-inspector-bridge.js';
const listenPort = Number(process.env.BRIDGE_PORT ?? '9339');
const targetWsUrl = process.env.TARGET_WS_URL ?? 'ws://127.0.0.1:9234';
const handle = await startRemoteInspectorBridge({ listenPort, targetWsUrl });
// eslint-disable-next-line no-console
console.log(`cat-inspector remote bridge listening ws://127.0.0.1:${handle.port} → ${targetWsUrl}`);
//# sourceMappingURL=remote-bridge-cli.js.map