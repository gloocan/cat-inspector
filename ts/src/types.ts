export const PROTOCOL_VERSION = 10 as const

export interface ReturnEntry {
	label: string
	type: string | null
	status: 'pending' | 'resolved'
}

export interface ErrorEntry {
	label: string
	type: string | null
	message: string | null
	status: 'pending' | 'resolved'
}

export interface ApiResponseEntry {
	label: string
	statusCode: number | null
	bodyShape: string | null
	status: 'pending' | 'resolved'
}

export type CatMode = 'service' | 'api_candidate' | 'api'

export type ParamKind = 'json' | 'file' | 'files'

/** Wire encoding for file params on RPC; default on catalog is `ref`. */
export type QaFileWireMode = 'ref' | 'url'

/** Where tenant web uploads bytes before persisting `__qaFileUrl` (catalog hint only). */
export type QaMediaUploadTarget = 'admin' | 'host'

export type RegistryParam = {
	name: string
	type: string
	/**
	 * Optional richer classification for QA UIs and file materialization.
	 *
	 * - `file`: param value itself is a single file (File/Blob/Buffer/etc.)
	 * - `files`: param value itself is an array of files (File[]/Blob[]/Buffer[]/etc.)
	 * - `json`: default / everything else
	 */
	kind?: ParamKind
	/** Nested single-file fields inside an object param (e.g. `input.file`). */
	filePaths?: string[]
	/** Nested multi-file (array-of-file) fields inside an object param (e.g. `input.attachments`). */
	fileArrayPaths?: string[]
	/** Copied from host bootstrap for QA UI (scenario builder). Omitted for non-file params. */
	qaFileWire?: QaFileWireMode
	/** When `qaFileWire` is `url`, which upload API the UI should use. */
	qaMediaUpload?: QaMediaUploadTarget
}

export interface RegistryEntry {
	mode: CatMode
	className: string
	method: string
	style: 'class' | 'function'
	body: string
	params: RegistryParam[]
	declaredReturn: string
	returns: ReturnEntry[]
	errors: ErrorEntry[]
	children: string[]
	parents: string[]
	route: string | null
	httpMethod: string | null
	apiResponses: ApiResponseEntry[]
	serviceLinks: string[]
	pipelineId: string | null
	pipelineIndex: number | null
	/** Optional JSON Schema (draft-07 subset) for the entire positional `args` array (tuple-style). */
	paramsJsonSchema?: Record<string, unknown> | null
	/** Optional JSON Schema (draft-07 subset) for QA validation of RPC `result` */
	returnJsonSchema?: Record<string, unknown> | null
	/** When `http_synthetic`, `executeRPC` runs in-process HTTP via `registerHttpBridgeRoute` instead of `originalFn`. */
	invokeKind?: 'rpc' | 'http_synthetic'
	/** For Express handler matching (CatRouter / registerCatPipeline) */
	originalFn: Function
}

export interface RpcErrorDetail {
	message: string
	stack: string | null
	layer: 'validation' | 'expected' | 'unexpected'
	/** Machine-readable code (e.g. `FN_NOT_FOUND`, `RATE_LIMITED`); optional for back-compat. */
	code?: string
}

export interface RpcArtifactRef {
	kind: string
	uploadUrl?: string
	objectKey?: string
	expiresAt?: string
	[key: string]: unknown
}

export interface RpcResponse {
	type: 'RPC_RESPONSE'
	requestId: string
	fnKey: string
	status: 'ok' | 'error'
	result: unknown
	returnType: string
	/** Runtime `getShape(result)` when status is ok; null on error */
	returnShape: string | null
	label: string | null
	duration: string
	error: RpcErrorDetail | null
	/** Optional artifact handles (protocol v7+). */
	artifacts?: RpcArtifactRef[]
}

export interface CoverageRequest {
	type: 'COVERAGE_REQUEST'
}

export interface CoverageReportWire {
	type: 'COVERAGE_REPORT'
	protocolVersion: typeof PROTOCOL_VERSION
	/** Present on success */
	report?: unknown
	/** Present on failure */
	error?: string
}

export interface BootstrapEvent {
	event: 'BOOTSTRAP'
	protocolVersion: typeof PROTOCOL_VERSION
	registry: Record<string, RegistryEntry>
	tree: object[]
	/** v9+: wire mode for file params (`ref` = __qaFileRef, `url` = __qaFileUrl). */
	qaFileWire?: { mode: QaFileWireMode }
	/** v9+: catalog hint for URL-mode uploads (no secrets). */
	qaMediaUpload?: { target: QaMediaUploadTarget }
	/** v9+: invoke-time URL fetch allowlist (hostnames only). */
	fileUrl?: {
		allowedHosts: string[]
		maxDownloadBytes: number
		timeoutMs: number
		maxRedirects?: number
		allowHttp?: boolean
	}
	/** v9+: HTTPS base for host-only Minio upload when `qaMediaUpload.target === 'host'` (no credentials). */
	qaMediaUploadHostUploadUrl?: string
	/** v10+: when true, tenant may stream bytes over Socket.IO `qa:hostMedia:*` instead of HTTP `qaMediaUploadHostUploadUrl`. */
	qaHostMediaUploadViaSocket?: boolean
}

export interface ReturnResolvedEvent {
	event: 'RETURN_RESOLVED'
	protocolVersion: typeof PROTOCOL_VERSION
	fnKey: string
	label: string
	type: string
	timestamp: string
	/** Optional: attach correlation for HTTP-originated traces */
	correlationId?: string
}

export interface ErrorThrownEvent {
	event: 'ERROR_THROWN'
	protocolVersion: typeof PROTOCOL_VERSION
	fnKey: string
	label: string
	layer: RpcErrorDetail['layer']
	message: string
	stack: string | null
	timestamp: string
	correlationId?: string
}

export interface ApiResponseEvent {
	event: 'API_RESPONSE'
	protocolVersion: typeof PROTOCOL_VERSION
	endpointKey: string
	/**
	 * Optional: which pipeline handler produced this response.
	 * When middleware returns early (no next()), this should be that middleware fnKey so UI can mark it as fail/warn.
	 */
	producerFnKey?: string | null
	label: string
	statusCode: number
	bodyShape: string
	/**
	 * Optional JSON payload for debugging/QA (may be omitted/redacted/size-limited).
	 * Intended to help QA see validation issues without guessing from `bodyShape`.
	 */
	body?: unknown
	timestamp: string
	correlationId?: string
}

export interface MiddlewareNextEvent {
	event: 'MIDDLEWARE_NEXT'
	protocolVersion: typeof PROTOCOL_VERSION
	/** Middleware fnKey (matches expected pipeline handler title) */
	fnKey: string
	/** Optional label for display, e.g. NEXT */
	label?: string
	timestamp: string
	correlationId?: string
}

export interface RpcExecutedEvent {
	event: 'RPC_EXECUTED'
	protocolVersion: typeof PROTOCOL_VERSION
	requestId: string
	fnKey: string
	label: string | null
	status: 'ok' | 'error'
	duration: string
	timestamp: string
}

/** Server → client job progress (inspector broadcast / optional strict parsers). */
export interface JobProgressWireEvent {
	event: 'JOB_PROGRESS'
	protocolVersion: typeof PROTOCOL_VERSION
	jobId: string
	status: 'queued' | 'running' | 'done' | 'failed'
	percent?: number
	detail?: string
	timestamp: string
}

/** Server → client session snapshot after `SESSION_CREATE` / `SESSION_STEP` on WebSocket transport. */
export interface SessionStateWireMessage {
	type: 'SESSION_STATE'
	protocolVersion: typeof PROTOCOL_VERSION
	requestId: string
	sessionId: string
	data: Record<string, unknown>
}

export type InspectorWireEvent =
	| BootstrapEvent
	| ReturnResolvedEvent
	| ErrorThrownEvent
	| ApiResponseEvent
	| MiddlewareNextEvent
	| RpcExecutedEvent
	| RpcResponse
	| CoverageReportWire
	| JobProgressWireEvent
