export interface RemoteInspectorBridgeOptions {
    /** Local port QA WebSocket clients connect to. */
    listenPort: number;
    listenHost?: string;
    /** Target embedded inspector, e.g. `ws://127.0.0.1:9234?token=secret` */
    targetWsUrl: string;
}
export interface RemoteInspectorBridgeHandle {
    readonly port: number;
    close(): Promise<void>;
}
/**
 * Minimal WebSocket **duplex proxy** between a QA client and an existing
 * `startInspectorWebSocket` endpoint. Forwards JSON frames as-is (`BOOTSTRAP`,
 * `RPC_CALL` / `RPC_RESPONSE`, `QA_UPLOAD_*`, sessions, coverage, etc.).
 */
export declare function startRemoteInspectorBridge(options: RemoteInspectorBridgeOptions): Promise<RemoteInspectorBridgeHandle>;
//# sourceMappingURL=remote-inspector-bridge.d.ts.map