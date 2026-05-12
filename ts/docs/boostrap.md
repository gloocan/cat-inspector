const server = http.createServer(app)
const io = new SocketIOServer(server, {
	cors: { origin: DEV_WEB_ORIGIN },
})
attachCatRPC(io, {
	scanRoots: [new URL('.', import.meta.url).pathname],
	serverId: 'cat-demo-backend',
	isDevelopment: process.env.NODE_ENV !== 'production',
	...(QA_AUTH_TOKEN ? { rpcAuth: { token: QA_AUTH_TOKEN } } : {}),
	upload: {
		enabled: true,
		maxSizeBytes: 50 * 1024 * 1024,
		idleTimeoutMs: 60_000,
	},
	bootstrap: {
		expandParamTypes: true,
		expandParamTypesOptions: {
			maxDepth: 6,
			maxProps: 80,
			maxUnion: 10,
			maxLen: 10_000,
		},
	},
})

// Note: the embedded Socket.IO catalog bootstrap is cached and gated by an
// input fingerprint (scanRoots file mtimes/sizes + bootstrap-shape options).
// Calling `catalog:refresh` will only rebuild the catalog when that fingerprint
// changes. The emitted `catalog:bootstrap` payload includes `catalogHash` so
// UIs can quickly tell whether a refresh changed anything.

//
