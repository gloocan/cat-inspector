import { randomUUID } from 'node:crypto';
/**
 * Minimal in-memory upload store keyed by uploadId, scoped to a Socket.IO connection.
 * Designed for QA uploads (not production-scale storage).
 */
export class InMemoryUploadStore {
    limits;
    activeBySocketId = new Map();
    completedByUploadId = new Map();
    constructor(limits) {
        this.limits = limits;
    }
    start(socketId, input) {
        const uploadId = input.uploadId ?? randomUUID();
        const meta = {
            uploadId,
            socketId,
            filename: input.filename,
            contentType: input.contentType,
            sizeBytes: input.sizeBytes,
        };
        if (meta.sizeBytes > this.limits.maxSizeBytes) {
            throw new Error(`upload_too_large: ${meta.sizeBytes} > ${this.limits.maxSizeBytes}`);
        }
        this.activeBySocketId.set(socketId, {
            ...meta,
            receivedBytes: 0,
            lastChunkAtMs: Date.now(),
            chunks: [],
        });
        return meta;
    }
    writeChunk(socketId, chunk) {
        const active = this.activeBySocketId.get(socketId);
        if (!active)
            throw new Error('no_active_upload');
        const nextBytes = active.receivedBytes + chunk.byteLength;
        if (nextBytes > active.sizeBytes)
            throw new Error('upload_exceeds_declared_size');
        if (nextBytes > this.limits.maxSizeBytes)
            throw new Error('upload_exceeds_max_size');
        active.receivedBytes = nextBytes;
        active.lastChunkAtMs = Date.now();
        active.chunks.push(chunk);
        return { uploadId: active.uploadId, receivedBytes: active.receivedBytes };
    }
    finish(socketId, uploadId) {
        const active = this.activeBySocketId.get(socketId);
        if (!active)
            throw new Error('no_active_upload');
        if (active.uploadId !== uploadId)
            throw new Error('upload_id_mismatch');
        const now = Date.now();
        if (now - active.lastChunkAtMs > this.limits.idleTimeoutMs)
            throw new Error('upload_idle_timeout');
        if (active.receivedBytes !== active.sizeBytes)
            throw new Error('upload_incomplete');
        const buffer = Buffer.concat(active.chunks, active.receivedBytes);
        const completed = {
            ...active,
            buffer,
            createdAtMs: now,
        };
        this.activeBySocketId.delete(socketId);
        this.completedByUploadId.set(uploadId, completed);
        return completed;
    }
    /**
     * Lookup an upload for materialization. Enforces socket ownership.
     * When consume=true, the upload is removed after read (single-use).
     */
    get(socketId, uploadId, options) {
        const u = this.completedByUploadId.get(uploadId);
        if (!u)
            return null;
        if (u.socketId !== socketId)
            return null;
        if (options?.consume)
            this.completedByUploadId.delete(uploadId);
        return u;
    }
    abort(socketId) {
        this.activeBySocketId.delete(socketId);
    }
}
//# sourceMappingURL=upload-store.js.map