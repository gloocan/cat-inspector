import { randomUUID } from 'node:crypto'

export type UploadMeta = {
	uploadId: string
	socketId: string
	filename: string
	contentType: string
	sizeBytes: number
}

export type CompletedUpload = UploadMeta & {
	buffer: Buffer
	receivedBytes: number
	createdAtMs: number
}

export type UploadStartInput = Omit<UploadMeta, 'uploadId' | 'socketId'> & {
	uploadId?: string
}

export type UploadLimits = {
	maxSizeBytes: number
	idleTimeoutMs: number
}

type ActiveUpload = UploadMeta & {
	receivedBytes: number
	lastChunkAtMs: number
	chunks: Buffer[]
}

/**
 * Minimal in-memory upload store keyed by uploadId, scoped to a Socket.IO connection.
 * Designed for QA uploads (not production-scale storage).
 */
export class InMemoryUploadStore {
	private activeBySocketId = new Map<string, ActiveUpload>()
	private completedByUploadId = new Map<string, CompletedUpload>()

	constructor(private readonly limits: UploadLimits) {}

	start(socketId: string, input: UploadStartInput): UploadMeta {
		const uploadId = input.uploadId ?? randomUUID()
		const meta: UploadMeta = {
			uploadId,
			socketId,
			filename: input.filename,
			contentType: input.contentType,
			sizeBytes: input.sizeBytes,
		}
		if (meta.sizeBytes > this.limits.maxSizeBytes) {
			throw new Error(`upload_too_large: ${meta.sizeBytes} > ${this.limits.maxSizeBytes}`)
		}
		this.activeBySocketId.set(socketId, {
			...meta,
			receivedBytes: 0,
			lastChunkAtMs: Date.now(),
			chunks: [],
		})
		return meta
	}

	writeChunk(socketId: string, chunk: Buffer): { uploadId: string; receivedBytes: number } {
		const active = this.activeBySocketId.get(socketId)
		if (!active) throw new Error('no_active_upload')
		const nextBytes = active.receivedBytes + chunk.byteLength
		if (nextBytes > active.sizeBytes) throw new Error('upload_exceeds_declared_size')
		if (nextBytes > this.limits.maxSizeBytes) throw new Error('upload_exceeds_max_size')
		active.receivedBytes = nextBytes
		active.lastChunkAtMs = Date.now()
		active.chunks.push(chunk)
		return { uploadId: active.uploadId, receivedBytes: active.receivedBytes }
	}

	finish(socketId: string, uploadId: string): CompletedUpload {
		const active = this.activeBySocketId.get(socketId)
		if (!active) throw new Error('no_active_upload')
		if (active.uploadId !== uploadId) throw new Error('upload_id_mismatch')
		const now = Date.now()
		if (now - active.lastChunkAtMs > this.limits.idleTimeoutMs) throw new Error('upload_idle_timeout')
		if (active.receivedBytes !== active.sizeBytes) throw new Error('upload_incomplete')
		const buffer = Buffer.concat(active.chunks, active.receivedBytes)
		const completed: CompletedUpload = {
			...active,
			buffer,
			createdAtMs: now,
		}
		this.activeBySocketId.delete(socketId)
		this.completedByUploadId.set(uploadId, completed)
		return completed
	}

	/**
	 * Lookup an upload for materialization. Enforces socket ownership.
	 * When consume=true, the upload is removed after read (single-use).
	 */
	get(
		socketId: string,
		uploadId: string,
		options?: { consume?: boolean },
	): CompletedUpload | null {
		const u = this.completedByUploadId.get(uploadId)
		if (!u) return null
		if (u.socketId !== socketId) return null
		if (options?.consume) this.completedByUploadId.delete(uploadId)
		return u
	}

	abort(socketId: string): void {
		this.activeBySocketId.delete(socketId)
	}
}

