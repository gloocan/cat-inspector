import { describe, expect, it } from 'vitest'

import { fetchFileUrl, isHostnameAllowed } from './fetch-file-url.js'

describe('isHostnameAllowed', () => {
	it('matches exact host', () => {
		expect(isHostnameAllowed('example.com', ['example.com'])).toBe(true)
		expect(isHostnameAllowed('evil.com', ['example.com'])).toBe(false)
	})

	it('matches suffix when entry starts with dot', () => {
		expect(isHostnameAllowed('bucket.s3.eu-west-1.amazonaws.com', ['.amazonaws.com'])).toBe(true)
	})
})

describe('fetchFileUrl', () => {
	it('rejects host not in allowlist', async () => {
		await expect(
			fetchFileUrl('https://evil.com/x', {
				allowedHosts: ['example.com'],
				maxDownloadBytes: 100,
				timeoutMs: 2000,
			}),
		).rejects.toThrow('FILE_URL_HOST_NOT_ALLOWED')
	})
})
