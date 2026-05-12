import type { QaFileWireMode, QaMediaUploadTarget, RegistryEntry } from '../types.js';
import type { InMemoryUploadStore } from './upload-store.js';
import { type FetchFileUrlOptions } from './fetch-file-url.js';
type QaFileRef = {
    __qaFileRef: string;
};
type QaFileRefs = {
    __qaFileRefs: string[];
};
type QaFileUrl = {
    __qaFileUrl: string;
};
type QaFileUrls = {
    __qaFileUrls: string[];
};
export type MaterializeServiceWireOptions = {
    /** Default `ref` when omitted. */
    qaFileWire?: {
        mode?: QaFileWireMode;
    };
    uploadStore?: InMemoryUploadStore | null;
    fileUrl?: FetchFileUrlOptions | null;
};
export declare function materializeServiceArgsForInvoke(options: {
    entry: RegistryEntry;
    args: unknown[];
    socketId: string;
    materializeAs?: 'file' | 'buffer';
} & MaterializeServiceWireOptions): Promise<unknown[]>;
export type MulterLikeFile = {
    fieldname: string;
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
};
/**
 * When materialized uploads use a single field name, `files` is `Record<field, MulterLikeFile[]>`.
 * Flatten to `MulterLikeFile[]` on the payload so mock `req.files` is an array (handlers often use
 * `(req.files as []).map(...)` like multer `.array()`).
 */
export declare function normalizeExpressPayloadFilesForPlayground(payload: {
    files?: unknown;
}): void;
/**
 * Turn wire payloads on the express RPC payload (`files` / `filesMany` with `__qaFileRef` or
 * `__qaFileUrl`) into multer-like `req.file` / `req.files` on the host before the handler runs.
 * When all uploads share one field name, `req.files` is set to a **flat array** of parts; multiple
 * field names keep a **record** keyed by field. Call {@link normalizeExpressPayloadFilesForPlayground}
 * before building the mock `req` if you merge payloads outside this helper.
 *
 * URL mode: the **client** already uploaded bytes and sent a GET URL (same as service RPC); this
 * step **fetches** those URLs (`fetchFileUrl`) — it does not presign again. Ref mode: reads from
 * `uploadStore` by `__qaFileRef`. Nested `filePaths` inside `express.body` are not handled here
 * (would be a separate protocol/UI phase if product needs it).
 */
export declare function materializeExpressPayloadForInvoke(options: {
    socketId: string;
    uploadStore?: InMemoryUploadStore | null;
    fileUrl?: FetchFileUrlOptions | null;
    qaFileWire?: {
        mode?: QaFileWireMode;
    };
    expressPayload: {
        headers?: Record<string, string>;
        body?: unknown;
        method?: string;
        path?: string;
    } & {
        files?: Array<{
            fieldName: string;
            ref: QaFileRef | QaFileUrl;
        }>;
        filesMany?: Array<{
            fieldName: string;
            refs: Array<QaFileRef | QaFileUrl>;
        } | {
            fieldName: string;
            refs: QaFileRefs | QaFileUrls;
        }>;
    };
}): Promise<{
    file?: MulterLikeFile;
    files?: Record<string, MulterLikeFile[]> | MulterLikeFile[];
} & typeof options.expressPayload>;
/** Public slice of fileUrl options safe for BOOTSTRAP / catalog (no secrets in fileUrl itself). */
export declare function publicFileUrlCatalogSlice(opts: FetchFileUrlOptions | null | undefined): FetchFileUrlOptions | undefined;
export type CatalogWireExtras = {
    qaFileWire: {
        mode: QaFileWireMode;
    };
    qaMediaUpload?: {
        target: QaMediaUploadTarget;
    };
    fileUrl?: FetchFileUrlOptions;
    qaMediaUploadHostUploadUrl?: string;
};
export declare function buildCatalogWireExtras(options: {
    qaFileWire?: {
        mode?: QaFileWireMode;
    };
    qaMediaUpload?: {
        target: QaMediaUploadTarget;
    };
    fileUrl?: FetchFileUrlOptions | null;
    qaMediaUploadHostUploadUrl?: string;
}): CatalogWireExtras;
export declare function enrichRegistryParamsWithWireHints(registry: Record<string, RegistryEntry>, extras: CatalogWireExtras): Record<string, RegistryEntry>;
export {};
//# sourceMappingURL=materialize.d.ts.map