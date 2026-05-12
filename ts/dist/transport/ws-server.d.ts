import type { RegistryEntry } from '../types.js';
import type { RpcSerializationOptions } from '../serialize-rpc-result.js';
import type { FetchFileUrlOptions } from '../upload/fetch-file-url.js';
import type { QaFileWireMode, QaMediaUploadTarget } from '../types.js';
export interface InspectorWebSocketOptions {
    port: number;
    host?: string;
    /** If set, client must pass the same value as query `?token=` */
    authToken?: string;
    maxPayloadBytes?: number;
    /** Used for coverage scanning on demand */
    scanRoots?: string[];
    rpcSerialization?: RpcSerializationOptions;
    invokeRateLimit?: {
        maxInvokesPerWindow: number;
        windowMs: number;
    };
    invokeTimeoutMs?: number;
    /**
     * When `enabled: true`, accepts `QA_UPLOAD_*` JSON messages (base64 chunks) and materializes
     * `{ __qaFileRef }` placeholders in `RPC_CALL` args the same way as Socket.IO (`qa:upload:*`).
     */
    upload?: {
        enabled?: boolean;
        maxSizeBytes?: number;
        idleTimeoutMs?: number;
    };
    qaFileWire?: {
        mode?: QaFileWireMode;
    };
    qaMediaUpload?: {
        target: QaMediaUploadTarget;
    };
    fileUrl?: FetchFileUrlOptions;
    qaMediaUploadHostUploadUrl?: string;
}
export interface InspectorWebSocketHandle {
    readonly port: number;
    close(): Promise<void>;
}
export declare function startInspectorWebSocket(registrySnapshot: Record<string, RegistryEntry>, tree: object[], options: InspectorWebSocketOptions): Promise<InspectorWebSocketHandle>;
//# sourceMappingURL=ws-server.d.ts.map