import type { CompilerOptions } from 'typescript';
import { type GetAllTsFilesOptions } from './ast/get-all-ts-files.js';
import type { ExpandTypeOptions } from './ast/type-expand.js';
import type { Logger } from './logger.js';
import type { FetchFileUrlOptions } from './upload/fetch-file-url.js';
import type { QaFileWireMode, QaMediaUploadTarget, RegistryEntry } from './types.js';
import { type InspectorWebSocketHandle } from './transport/ws-server.js';
import { type RpcSerializationOptions } from './serialize-rpc-result.js';
/** Host-provided object storage wiring (secrets read inside adapter from env / vault). */
export interface StorageAdapter {
    createPresignedPut(input: {
        key: string;
        contentType?: string;
        sizeBytes?: number;
    }): Promise<{
        uploadUrl: string;
        objectKey: string;
        expiresAt?: string;
    }>;
}
export interface BootstrapStorageOptions {
    adapter?: StorageAdapter;
    /** When set and positive, `adapter` is required (fail-fast `QA_STORAGE_NOT_CONFIGURED`). */
    artifactThresholdBytes?: number;
}
export declare function validateBootstrapStorage(storage: BootstrapStorageOptions | undefined): void;
/** S3-compatible store (e.g. Minio). Never serialize to BOOTSTRAP / catalog JSON. */
export interface HostMinioOptions {
    endpoint: string;
    region?: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    forcePathStyle?: boolean;
}
export declare function validateBootstrapFileWire(options: {
    qaFileWire?: {
        mode?: QaFileWireMode;
    };
    fileUrl?: FetchFileUrlOptions | null;
}): void;
export interface BootstrapOptions {
    /** Directories scanned for `.ts` sources (AST + optional discovery) */
    scanRoots: string[];
    /** WebSocket listen port */
    wsPort: number;
    wsHost?: string;
    /** Start embedded WebSocket server (default true) */
    enableWebSocket?: boolean;
    authToken?: string;
    /** Absolute file URLs or paths dynamically imported before AST (compiled `.js` or ESM entry) */
    importEntryUrls?: string[];
    getAllTsFilesOptions?: GetAllTsFilesOptions;
    compilerOptions?: CompilerOptions;
    expandParamTypes?: boolean;
    expandParamTypesOptions?: ExpandTypeOptions;
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
    logger?: Logger;
    /** Install SIGINT / SIGTERM handlers that close the WebSocket server */
    registerSignalHandlers?: boolean;
    /** Redact `RegistryEntry.body` from returned/transported registry (GDPR-safe). Default: true. */
    redactBodies?: boolean;
    /** Optional post-invoke JSON normalization for `executeRPC` `result` (BigInt, Date, plain objects, size cap). */
    rpcSerialization?: RpcSerializationOptions;
    /** Optional large-payload / presign wiring; validated with `artifactThresholdBytes`. */
    storage?: BootstrapStorageOptions;
    /** When embedded WebSocket is enabled, token bucket per connection id. */
    invokeRateLimit?: {
        maxInvokesPerWindow: number;
        windowMs: number;
    };
    /** When set, `executeRPC` rejects handler hangs after this many ms (best-effort; handler may still run). */
    invokeTimeoutMs?: number;
    /** Wire mode for file RPC params. Default `ref`. */
    qaFileWire?: {
        mode?: QaFileWireMode;
    };
    /** Catalog hint: where tenant web uploads before `__qaFileUrl` (no secrets). */
    qaMediaUpload?: {
        target: QaMediaUploadTarget;
    };
    /** Invoke-time URL fetch policy for `__qaFileUrl`. Required when `qaFileWire.mode` is `url`. */
    fileUrl?: FetchFileUrlOptions;
    /** HTTPS URL for host-only upload route (no credentials). */
    qaMediaUploadHostUploadUrl?: string;
    /**
     * Host-held Minio/S3 credentials (process memory only). Never sent on BOOTSTRAP.
     * Used by host HTTP upload routes implemented outside this package.
     */
    hostMinio?: HostMinioOptions;
    /** In-memory QA uploads for `__qaFileRef`; enable when `qaFileWire.mode` is `ref` or alongside URL mode. */
    upload?: {
        enabled?: boolean;
        maxSizeBytes?: number;
        idleTimeoutMs?: number;
    };
}
export interface BootstrapResult {
    registry: Record<string, RegistryEntry>;
    tree: object[];
    ws: InspectorWebSocketHandle | undefined;
    shutdown: () => Promise<void>;
}
export declare function bootstrap(options: BootstrapOptions): Promise<BootstrapResult>;
//# sourceMappingURL=bootstrap.d.ts.map