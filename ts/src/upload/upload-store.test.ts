import { describe, expect, it } from 'vitest'

import { InMemoryUploadStore } from './upload-store.js'

describe('InMemoryUploadStore', () => {
	it('stores and returns completed upload scoped to socket', () => {
		const store = new InMemoryUploadStore({ maxSizeBytes: 1024, idleTimeoutMs: 10_000 })
		const meta = store.start('s1', {
			uploadId: 'u1',
			filename: 'a.txt',
			contentType: 'text/plain',
			sizeBytes: 3,
		})
		expect(meta.uploadId).toBe('u1')
		store.writeChunk('s1', Buffer.from('a'))
		store.writeChunk('s1', Buffer.from('bc'))
		const done = store.finish('s1', 'u1')
		expect(done.buffer.toString('utf8')).toBe('abc')

		expect(store.get('s2', 'u1')).toBeNull()
		expect(store.get('s1', 'u1')?.buffer.toString('utf8')).toBe('abc')
	})
})

