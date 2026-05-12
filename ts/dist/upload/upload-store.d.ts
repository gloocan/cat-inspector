export type UploadMeta = {
    uploadId: string;
    socketId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
};
export type CompletedUpload = UploadMeta & {
    buffer: Buffer;
    receivedBytes: number;
    createdAtMs: number;
};
export type UploadStartInput = Omit<UploadMeta, 'uploadId' | 'socketId'> & {
    uploadId?: string;
};
export type UploadLimits = {
    maxSizeBytes: number;
    idleTimeoutMs: number;
};
/**
 * Minimal in-memory upload store keyed by uploadId, scoped to a Socket.IO connection.
 * Designed for QA uploads (not production-scale storage).
 */
export declare class InMemoryUploadStore {
    private readonly limits;
    private activeBySocketId;
    private completedByUploadId;
    constructor(limits: UploadLimits);
    start(socketId: string, input: UploadStartInput): UploadMeta;
    writeChunk(socketId: string, chunk: Buffer): {
        uploadId: string;
        receivedBytes: number;
    };
    finish(socketId: string, uploadId: string): CompletedUpload;
    /**
     * Lookup an upload for materialization. Enforces socket ownership.
     * When consume=true, the upload is removed after read (single-use).
     */
    get(socketId: string, uploadId: string, options?: {
        consume?: boolean;
    }): CompletedUpload | null;
    abort(socketId: string): void;
}
//# sourceMappingURL=upload-store.d.ts.map