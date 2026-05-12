import type { Server, Socket } from 'socket.io';
import { type BootstrapOptions } from '../bootstrap.js';
import { createExpressPlaygroundMocks, type ExpressPlaygroundPayload } from '../express-playground-mocks.js';
import { type BootstrapStorageOptions } from '../bootstrap.js';
import type { RpcSerializationOptions } from '../serialize-rpc-result.js';
import { type QaFileWireMode, type QaMediaUploadTarget, type RegistryEntry, type RpcResponse } from '../types.js';
import type { FetchFileUrlOptions } from '../upload/fetch-file-url.js';
export declare const INSPECTOR_BROADCAST_EVENT = "inspector:broadcast";
export { INSPECTOR_SOCKET_ID_HEADER } from '../registry-state.js';
export type AttachCatRPCOptions = {
    scanRoots: string[];
    bootstrap?: Partial<Pick<BootstrapOptions, 'importEntryUrls' | 'getAllTsFilesOptions' | 'compilerOptions' | 'logLevel' | 'redactBodies' | 'expandParamTypes' | 'expandParamTypesOptions' | 'rpcSerialization' | 'storage' | 'invokeTimeoutMs' | 'qaFileWire' | 'qaMediaUpload' | 'fileUrl' | 'qaMediaUploadHostUploadUrl' | 'hostMinio' | 'upload'>>;
    /** Merged into `bootstrap({ ... })` for catalog build; validated with `artifactThresholdBytes`. */
    storage?: BootstrapStorageOptions;
    /** Token bucket per Socket.IO `socket.id`. */
    invokeRateLimit?: {
        maxInvokesPerWindow: number;
        windowMs: number;
    };
    /** Applied with catalog `bootstrap()` merge (same as `bootstrap.rpcSerialization`). */
    rpcSerialization?: RpcSerializationOptions;
    /** Same as `bootstrap.invokeTimeoutMs` when using embedded catalog bootstrap. */
    invokeTimeoutMs?: number;
    serverId?: string;
    /** When false, HTTP-sourced inspector never reaches Socket.IO */
    isDevelopment?: boolean;
    forwardBroadcast?: boolean;
    emitUnscopedBroadcasts?: boolean;
    createExpressMocks?: typeof createExpressPlaygroundMocks;
    hooks?: AttachCatRPCHooks;
    upload?: {
        enabled?: boolean;
        maxSizeBytes?: number;
        idleTimeoutMs?: number;
    };
    /**
     * When set and `isDevelopment` is false, RPC invokes require Socket.IO
     * `auth.token` to match this string (see protocol-client / cat-demo web profiles).
     */
    rpcAuth?: {
        token: string;
    };
    /**
     * When set, merged into each emitted `catalog:bootstrap` (not part of AST fingerprint cache).
     * Host should pass from env; never read env inside the SDK.
     */
    secretApiKey?: string;
    /** Overrides / supplements `bootstrap` for catalog + RPC materialize (same semantics as embedded WS). */
    qaFileWire?: {
        mode?: QaFileWireMode;
    };
    qaMediaUpload?: {
        target: QaMediaUploadTarget;
    };
    fileUrl?: FetchFileUrlOptions;
    qaMediaUploadHostUploadUrl?: string;
};
export type AttachCatRPCHooks = {
    onConnection?: (socket: Socket) => void | Promise<void>;
    onBeforeRpc?: (socket: Socket, raw: unknown) => Promise<RpcResponse | undefined>;
    onAfterRpc?: (socket: Socket, requestId: string, response: RpcResponse) => void;
    onCatalogError?: (socket: Socket, error: unknown) => void;
};
export type AttachCatRPCHandle = {
    detach: () => void;
};
export declare function invokeExpressPlayground(requestId: string, fnKey: string, expressPayload: ExpressPlaygroundPayload, createMocks: typeof createExpressPlaygroundMocks): Promise<RpcResponse>;
export declare function resolveExpressCallableForInvoke(requestId: string, fnKey: string, entry: RegistryEntry, start: number): {
    callable: (...args: unknown[]) => unknown;
    callThis: unknown;
} | {
    error: RpcResponse;
};
/**
 * Register Socket.IO catalog + RPC playground handlers and optional broadcast bridge.
 */
export declare function attachCatRPC(io: Server, options: AttachCatRPCOptions): AttachCatRPCHandle;
//# sourceMappingURL=socket-io-playground.d.ts.map