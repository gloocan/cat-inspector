import { describe, expect, it } from 'vitest'

import type { HostMinioOptions } from '../bootstrap.js'
import { parseHostMinioEndpoint } from './host-minio-client.js'

function baseHost(overrides: Partial<HostMinioOptions> = {}): HostMinioOptions {
	return {
		endpoint: 'http://localhost:9000',
		accessKeyId: 'k',
		secretAccessKey: 's',
		bucket: 'b',
		...overrides,
	}
}

describe('parseHostMinioEndpoint', () => {
	it('parses http URL with port', () => {
		const c = parseHostMinioEndpoint(baseHost({ endpoint: 'http://minio.internal:9000' }))
		expect(c.endPoint).toBe('minio.internal')
		expect(c.port).toBe(9000)
		expect(c.useSSL).toBe(false)
		expect(c.accessKey).toBe('k')
		expect(c.secretKey).toBe('s')
		expect(c.pathStyle).toBe(false)
	})

	it('parses https URL default port', () => {
		const c = parseHostMinioEndpoint(baseHost({ endpoint: 'https://s3.example.com' }))
		expect(c.endPoint).toBe('s3.example.com')
		expect(c.port).toBe(443)
		expect(c.useSSL).toBe(true)
	})

	it('parses bare host:port with implied http', () => {
		const c = parseHostMinioEndpoint(baseHost({ endpoint: '127.0.0.1:9000' }))
		expect(c.endPoint).toBe('127.0.0.1')
		expect(c.port).toBe(9000)
		expect(c.useSSL).toBe(false)
	})

	it('honors forcePathStyle', () => {
		const c = parseHostMinioEndpoint(baseHost({ forcePathStyle: true }))
		expect(c.pathStyle).toBe(true)
	})

	it('throws on empty endpoint', () => {
		expect(() => parseHostMinioEndpoint(baseHost({ endpoint: '  ' }))).toThrow(/endpoint/)
	})
})
