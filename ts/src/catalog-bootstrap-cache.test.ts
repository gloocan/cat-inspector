import { describe, expect, it } from 'vitest'

import { createCatalogBootstrapCache } from './catalog-bootstrap-cache.js'

describe('createCatalogBootstrapCache', () => {
	it('get() caches the payload and does not rebuild twice', async () => {
		let fp = 'h1'
		let builds = 0

		const cache = createCatalogBootstrapCache({
			computeFingerprint: () => fp,
			computePayload: async (catalogHash) => {
				builds++
				return {
					event: 'BOOTSTRAP',
					protocolVersion: 1,
					catalogHash,
					registry: { builds },
					tree: [],
				}
			},
		})

		const a = await cache.get()
		const b = await cache.get()
		expect(builds).toBe(1)
		expect(b).toEqual(a)
		expect(b.catalogHash).toBe('h1')
	})

	it('refresh() returns cached payload when fingerprint unchanged', async () => {
		let fp = 'h1'
		let builds = 0

		const cache = createCatalogBootstrapCache({
			computeFingerprint: () => fp,
			computePayload: async (catalogHash) => {
				builds++
				return {
					event: 'BOOTSTRAP',
					protocolVersion: 1,
					catalogHash,
					registry: { builds },
					tree: [],
				}
			},
		})

		const a = await cache.get()
		const b = await cache.refresh()
		expect(builds).toBe(1)
		expect(b).toEqual(a)
	})

	it('refresh() rebuilds when fingerprint changes', async () => {
		let fp = 'h1'
		let builds = 0

		const cache = createCatalogBootstrapCache({
			computeFingerprint: () => fp,
			computePayload: async (catalogHash) => {
				builds++
				return {
					event: 'BOOTSTRAP',
					protocolVersion: 1,
					catalogHash,
					registry: { builds },
					tree: [],
				}
			},
		})

		const a = await cache.get()
		fp = 'h2'
		const b = await cache.refresh()

		expect(builds).toBe(2)
		expect(a.catalogHash).toBe('h1')
		expect(b.catalogHash).toBe('h2')
	})
})

