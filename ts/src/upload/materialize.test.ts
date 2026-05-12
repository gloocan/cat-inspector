import { describe, expect, it } from 'vitest'

import type { RegistryEntry } from '../types.js'
import { InMemoryUploadStore } from './upload-store.js'
import {
	materializeExpressPayloadForInvoke,
	materializeServiceArgsForInvoke,
	normalizeExpressPayloadFilesForPlayground,
} from './materialize.js'

function makeEntry(params: any[]): RegistryEntry {
	return {
		mode: 'service',
		className: 'X',
		method: 'y',
		style: 'function',
		body: '',
		params,
		declaredReturn: 'unknown',
		returns: [],
		errors: [],
		children: [],
		parents: [],
		route: null,
		httpMethod: null,
		apiResponses: [],
		serviceLinks: [],
		pipelineId: null,
		pipelineIndex: null,
		originalFn: () => null,
	}
}

describe('materializeServiceArgsForInvoke', () => {
	it('materializes top-level single file param', async () => {
		const store = new InMemoryUploadStore({ maxSizeBytes: 1024, idleTimeoutMs: 10_000 })
		store.start('s1', { uploadId: 'u1', filename: 'a', contentType: 'x', sizeBytes: 3 })
		store.writeChunk('s1', Buffer.from('abc'))
		store.finish('s1', 'u1')

		const entry = makeEntry([{ name: 'file', type: 'File', kind: 'file' }])
		const out = await materializeServiceArgsForInvoke({
			entry,
			args: [{ __qaFileRef: 'u1' }],
			socketId: 's1',
			uploadStore: store,
			materializeAs: 'buffer',
		})
		expect(Buffer.isBuffer(out[0])).toBe(true)
		expect((out[0] as Buffer).toString('utf8')).toBe('abc')
	})

	it('materializes top-level multi-file param from array of refs', async () => {
		const store = new InMemoryUploadStore({ maxSizeBytes: 1024, idleTimeoutMs: 10_000 })
		for (const [id, body] of [
			['u1', 'a'],
			['u2', 'b'],
		] as const) {
			store.start('s1', { uploadId: id, filename: id, contentType: 'x', sizeBytes: 1 })
			store.writeChunk('s1', Buffer.from(body))
			store.finish('s1', id)
		}

		const entry = makeEntry([{ name: 'files', type: 'File[]', kind: 'files' }])
		const out = await materializeServiceArgsForInvoke({
			entry,
			args: [[{ __qaFileRef: 'u1' }, { __qaFileRef: 'u2' }]],
			socketId: 's1',
			uploadStore: store,
			materializeAs: 'buffer',
		})
		expect(Array.isArray(out[0])).toBe(true)
		expect((out[0] as Buffer[]).map((b) => b.toString('utf8'))).toEqual(['a', 'b'])
	})

	it('materializes nested filePaths inside an object param', async () => {
		const store = new InMemoryUploadStore({ maxSizeBytes: 1024, idleTimeoutMs: 10_000 })
		store.start('s1', { uploadId: 'u1', filename: 'a', contentType: 'x', sizeBytes: 1 })
		store.writeChunk('s1', Buffer.from('z'))
		store.finish('s1', 'u1')

		const entry = makeEntry([{ name: 'input', type: '{file: File}', filePaths: ['file'] }])
		const input: any = { name: 'n', file: { __qaFileRef: 'u1' } }
		const out = await materializeServiceArgsForInvoke({
			entry,
			args: [input],
			socketId: 's1',
			uploadStore: store,
			materializeAs: 'buffer',
		})
		expect(Buffer.isBuffer((out[0] as any).file)).toBe(true)
		expect(((out[0] as any).file as Buffer).toString('utf8')).toBe('z')
	})

	it('rejects __qaFileUrl when qaFileWire mode is ref', async () => {
		const store = new InMemoryUploadStore({ maxSizeBytes: 1024, idleTimeoutMs: 10_000 })
		const entry = makeEntry([{ name: 'file', type: 'Buffer', kind: 'file' }])
		await expect(
			materializeServiceArgsForInvoke({
				entry,
				args: [{ __qaFileUrl: 'https://example.com/a' }],
				socketId: 's1',
				uploadStore: store,
				qaFileWire: { mode: 'ref' },
				materializeAs: 'buffer',
			}),
		).rejects.toThrow('FILE_URL_NOT_ALLOWED')
	})
})

describe('materializeExpressPayloadForInvoke', () => {
	it('materializes express.filesMany into payload.files mapping', async () => {
		const store = new InMemoryUploadStore({ maxSizeBytes: 1024, idleTimeoutMs: 10_000 })
		for (const [id, body] of [
			['u1', 'a'],
			['u2', 'b'],
		] as const) {
			store.start('s1', { uploadId: id, filename: id, contentType: 'text/plain', sizeBytes: 1 })
			store.writeChunk('s1', Buffer.from(body))
			store.finish('s1', id)
		}

		const payload = await materializeExpressPayloadForInvoke({
			socketId: 's1',
			uploadStore: store,
			expressPayload: {
				body: {},
				filesMany: [{ fieldName: 'files', refs: [{ __qaFileRef: 'u1' }, { __qaFileRef: 'u2' }] }],
			},
		})

		expect(Array.isArray(payload.files)).toBe(true)
		expect((payload.files as import('./materialize.js').MulterLikeFile[]).length).toBe(2)
		expect((payload.files as import('./materialize.js').MulterLikeFile[]).map((f) => f.buffer.toString('utf8'))).toEqual([
			'a',
			'b',
		])
	})

	it('normalizeExpressPayloadFilesForPlayground flattens single-key record to array', () => {
		const payload: { files?: unknown } = {
			files: {
				file: [
					{
						fieldname: 'file',
						originalname: 'a.txt',
						mimetype: 'text/plain',
						size: 1,
						buffer: Buffer.from('x'),
					},
				],
			},
		}
		normalizeExpressPayloadFilesForPlayground(payload)
		expect(Array.isArray(payload.files)).toBe(true)
		expect((payload.files as { buffer: Buffer }[])[0]!.buffer.toString('utf8')).toBe('x')
	})

	it('normalizeExpressPayloadFilesForPlayground leaves multi-field map unchanged', () => {
		const payload: { files?: unknown } = {
			files: {
				a: [{ fieldname: 'a', originalname: '1', mimetype: 'x', size: 1, buffer: Buffer.from('1') }],
				b: [{ fieldname: 'b', originalname: '2', mimetype: 'x', size: 1, buffer: Buffer.from('2') }],
			},
		}
		normalizeExpressPayloadFilesForPlayground(payload)
		expect(Array.isArray(payload.files)).toBe(false)
		expect(Object.keys(payload.files as object)).toEqual(['a', 'b'])
	})
})

