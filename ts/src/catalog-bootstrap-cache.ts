export type CatalogBootstrapPayload = {
	event: 'BOOTSTRAP'
	protocolVersion: number
	catalogHash: string
	registry: Record<string, unknown>
	tree: object[]
}

export type CatalogBootstrapCache = {
	get: () => Promise<CatalogBootstrapPayload>
	refresh: () => Promise<CatalogBootstrapPayload>
}

/**
 * Small in-memory cache for catalog bootstrap payloads, gated by a fingerprint.
 *
 * - `get()` computes and caches on first call.
 * - `refresh()` recomputes the fingerprint and only rebuilds when it changed.
 * - concurrent callers share a single in-flight promise.
 */
export function createCatalogBootstrapCache(input: {
	computeFingerprint: () => string
	computePayload: (catalogHash: string) => Promise<CatalogBootstrapPayload>
}): CatalogBootstrapCache {
	let lastPayload: CatalogBootstrapPayload | null = null
	let lastFingerprint: string | null = null
	let inFlight: Promise<CatalogBootstrapPayload> | null = null

	async function runBuild(fingerprint: string): Promise<CatalogBootstrapPayload> {
		return await input.computePayload(fingerprint)
	}

	return {
		get: async () => {
			if (lastPayload) return lastPayload
			if (!inFlight) {
				const fingerprint = input.computeFingerprint()
				inFlight = runBuild(fingerprint)
					.then((p) => {
						lastPayload = p
						lastFingerprint = fingerprint
						return p
					})
					.finally(() => {
						inFlight = null
					})
			}
			return await inFlight
		},
		refresh: async () => {
			const fingerprint = input.computeFingerprint()
			if (lastPayload && lastFingerprint === fingerprint) return lastPayload

			lastPayload = null
			lastFingerprint = null
			if (!inFlight) {
				inFlight = runBuild(fingerprint)
					.then((p) => {
						lastPayload = p
						lastFingerprint = fingerprint
						return p
					})
					.finally(() => {
						inFlight = null
					})
			}
			return await inFlight
		},
	}
}

