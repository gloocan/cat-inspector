import type { QaFileWireMode, QaMediaUploadTarget, RegistryEntry } from '../types.js'
import type { CompletedUpload, InMemoryUploadStore } from './upload-store.js'
import { fetchFileUrl, type FetchFileUrlOptions } from './fetch-file-url.js'

type QaFileRef = { __qaFileRef: string }
type QaFileRefs = { __qaFileRefs: string[] }
type QaFileUrl = { __qaFileUrl: string }
type QaFileUrls = { __qaFileUrls: string[] }

function isQaFileRef(v: unknown): v is QaFileRef {
	return Boolean(v && typeof v === 'object' && typeof (v as any).__qaFileRef === 'string')
}

function isQaFileRefs(v: unknown): v is QaFileRefs {
	return Boolean(
		v &&
			typeof v === 'object' &&
			Array.isArray((v as any).__qaFileRefs) &&
			((v as any).__qaFileRefs as unknown[]).every((x) => typeof x === 'string'),
	)
}

function isArrayOfQaFileRef(v: unknown): v is QaFileRef[] {
	return Array.isArray(v) && v.every((x) => isQaFileRef(x))
}

function isQaFileUrl(v: unknown): v is QaFileUrl {
	return Boolean(v && typeof v === 'object' && typeof (v as any).__qaFileUrl === 'string')
}

function isQaFileUrls(v: unknown): v is QaFileUrls {
	return Boolean(
		v &&
			typeof v === 'object' &&
			Array.isArray((v as any).__qaFileUrls) &&
			((v as any).__qaFileUrls as unknown[]).every((x) => typeof x === 'string'),
	)
}

function isArrayOfQaFileUrl(v: unknown): v is QaFileUrl[] {
	return Array.isArray(v) && v.every((x) => isQaFileUrl(x))
}

function assertLeafRefUrlExclusivity(leaf: unknown): void {
	if (!leaf || typeof leaf !== 'object') return
	const o = leaf as Record<string, unknown>
	const hasRef = typeof o.__qaFileRef === 'string'
	const hasUrl = typeof o.__qaFileUrl === 'string'
	if (hasRef && hasUrl) {
		throw new Error('FILE_REF_AND_URL: both __qaFileRef and __qaFileUrl on same value')
	}
}

function getUploadOrThrow(
	store: InMemoryUploadStore,
	socketId: string,
	uploadId: string,
): CompletedUpload {
	const u = store.get(socketId, uploadId, { consume: true })
	if (!u) throw new Error(`UPLOAD_NOT_FOUND: ${uploadId}`)
	return u
}

function bufferToFile(u: CompletedUpload): File {
	const FileCtor = (globalThis as any).File as typeof File | undefined
	if (!FileCtor) throw new Error('FILE_UNAVAILABLE: global File is not available in this Node runtime')
	return new FileCtor([u.buffer], u.filename, { type: u.contentType })
}

function bufferToFileFromParts(parts: {
	buffer: Buffer
	filename: string
	contentType: string
}, as: 'file' | 'buffer'): File | Buffer {
	if (as === 'buffer') return parts.buffer
	const FileCtor = (globalThis as any).File as typeof File | undefined
	if (!FileCtor) throw new Error('FILE_UNAVAILABLE: global File is not available in this Node runtime')
	return new FileCtor([parts.buffer], parts.filename, { type: parts.contentType })
}

function materializeSingleRef(
	store: InMemoryUploadStore,
	socketId: string,
	uploadId: string,
	as: 'file' | 'buffer',
): File | Buffer {
	const u = getUploadOrThrow(store, socketId, uploadId)
	return as === 'file' ? bufferToFile(u) : u.buffer
}

function materializeManyRef(
	store: InMemoryUploadStore,
	socketId: string,
	uploadIds: string[],
	as: 'file' | 'buffer',
): Array<File> | Array<Buffer> {
	return uploadIds.map((id) => materializeSingleRef(store, socketId, id, as)) as any
}

async function materializeSingleUrl(
	url: string,
	fileUrl: FetchFileUrlOptions,
	as: 'file' | 'buffer',
): Promise<File | Buffer> {
	const fetched = await fetchFileUrl(url, fileUrl)
	return bufferToFileFromParts(
		{
			buffer: fetched.buffer,
			filename: fetched.filename,
			contentType: fetched.contentType,
		},
		as,
	)
}

async function materializeManyUrl(
	urls: string[],
	fileUrl: FetchFileUrlOptions,
	as: 'file' | 'buffer',
): Promise<Array<File> | Array<Buffer>> {
	const out: Array<File | Buffer> = []
	for (const u of urls) {
		out.push(await materializeSingleUrl(u, fileUrl, as))
	}
	return out as any
}

export type MaterializeServiceWireOptions = {
	/** Default `ref` when omitted. */
	qaFileWire?: { mode?: QaFileWireMode }
	uploadStore?: InMemoryUploadStore | null
	fileUrl?: FetchFileUrlOptions | null
}

function effectiveWireMode(wire?: { mode?: QaFileWireMode }): QaFileWireMode {
	return wire?.mode ?? 'ref'
}

function assertModeAllowsRef(mode: QaFileWireMode): void {
	if (mode === 'url') throw new Error('FILE_REF_NOT_ALLOWED: qaFileWire.mode is url')
}

function assertModeAllowsUrl(mode: QaFileWireMode): void {
	if (mode === 'ref') throw new Error('FILE_URL_NOT_ALLOWED: qaFileWire.mode is ref')
}

type PathToken = { kind: 'prop'; key: string } | { kind: 'index'; index: number }

function parsePath(path: string): PathToken[] {
	const out: PathToken[] = []
	const parts = path.split('.')
	for (const part of parts) {
		const m = /^([^\[]+)(?:\[(\d+)\])?$/.exec(part)
		if (!m) continue
		out.push({ kind: 'prop', key: m[1]! })
		if (m[2] !== undefined) out.push({ kind: 'index', index: Number(m[2]) })
	}
	return out
}

function getAt(root: any, tokens: PathToken[]): any {
	let cur = root
	for (const t of tokens) {
		if (cur === null || cur === undefined) return undefined
		if (t.kind === 'prop') cur = cur[t.key]
		else cur = cur[t.index]
	}
	return cur
}

function setAt(root: any, tokens: PathToken[], value: any): void {
	if (tokens.length === 0) return
	let cur = root
	for (let i = 0; i < tokens.length - 1; i++) {
		const t = tokens[i]!
		if (t.kind === 'prop') {
			if (cur[t.key] === undefined) cur[t.key] = {}
			cur = cur[t.key]
		} else {
			if (!Array.isArray(cur)) throw new Error('PATH_NOT_ARRAY')
			if (cur[t.index] === undefined) cur[t.index] = {}
			cur = cur[t.index]
		}
	}
	const last = tokens[tokens.length - 1]!
	if (last.kind === 'prop') cur[last.key] = value
	else {
		if (!Array.isArray(cur)) throw new Error('PATH_NOT_ARRAY')
		cur[last.index] = value
	}
}

export async function materializeServiceArgsForInvoke(options: {
	entry: RegistryEntry
	args: unknown[]
	socketId: string
	materializeAs?: 'file' | 'buffer'
} & MaterializeServiceWireOptions): Promise<unknown[]> {
	const { entry, args, socketId } = options
	const materializeAs: 'file' | 'buffer' = options.materializeAs ?? 'buffer'
	const uploadStore = options.uploadStore ?? null
	const fileUrl = options.fileUrl ?? null
	const mode = effectiveWireMode(options.qaFileWire)
	const out = [...args]

	for (let i = 0; i < entry.params.length; i++) {
		const p = entry.params[i]!
		const v = out[i]

		if (p.kind === 'file') {
			assertLeafRefUrlExclusivity(v)
			if (isQaFileRef(v)) {
				assertModeAllowsRef(mode)
				if (!uploadStore) throw new Error('FILE_REF_NOT_ALLOWED: upload store not configured')
				out[i] = materializeSingleRef(uploadStore, socketId, v.__qaFileRef, materializeAs)
				continue
			}
			if (isQaFileUrl(v)) {
				assertModeAllowsUrl(mode)
				if (!fileUrl?.allowedHosts?.length) {
					throw new Error('FILE_URL_MATERIALIZE_DISABLED: fileUrl.allowedHosts not configured')
				}
				out[i] = await materializeSingleUrl(v.__qaFileUrl, fileUrl, materializeAs)
				continue
			}
		}

		if (p.kind === 'files') {
			if (isQaFileRefs(v)) {
				assertModeAllowsRef(mode)
				if (!uploadStore) throw new Error('FILE_REF_NOT_ALLOWED: upload store not configured')
				out[i] = materializeManyRef(uploadStore, socketId, v.__qaFileRefs, materializeAs)
				continue
			}
			if (isArrayOfQaFileRef(v)) {
				assertModeAllowsRef(mode)
				if (!uploadStore) throw new Error('FILE_REF_NOT_ALLOWED: upload store not configured')
				out[i] = materializeManyRef(
					uploadStore,
					socketId,
					v.map((x) => x.__qaFileRef),
					materializeAs,
				)
				continue
			}
			if (isQaFileUrls(v)) {
				assertModeAllowsUrl(mode)
				if (!fileUrl?.allowedHosts?.length) {
					throw new Error('FILE_URL_MATERIALIZE_DISABLED: fileUrl.allowedHosts not configured')
				}
				out[i] = await materializeManyUrl(v.__qaFileUrls, fileUrl, materializeAs)
				continue
			}
			if (isArrayOfQaFileUrl(v)) {
				assertModeAllowsUrl(mode)
				if (!fileUrl?.allowedHosts?.length) {
					throw new Error('FILE_URL_MATERIALIZE_DISABLED: fileUrl.allowedHosts not configured')
				}
				out[i] = await materializeManyUrl(
					v.map((x) => x.__qaFileUrl),
					fileUrl,
					materializeAs,
				)
				continue
			}
		}

		if (p.filePaths && p.filePaths.length && v && typeof v === 'object') {
			for (const path of p.filePaths) {
				const tokens = parsePath(path)
				const leaf = getAt(v as any, tokens)
				assertLeafRefUrlExclusivity(leaf)
				if (isQaFileRef(leaf)) {
					assertModeAllowsRef(mode)
					if (!uploadStore) throw new Error('FILE_REF_NOT_ALLOWED: upload store not configured')
					setAt(
						v as any,
						tokens,
						materializeSingleRef(uploadStore, socketId, leaf.__qaFileRef, materializeAs),
					)
				} else if (isQaFileUrl(leaf)) {
					assertModeAllowsUrl(mode)
					if (!fileUrl?.allowedHosts?.length) {
						throw new Error('FILE_URL_MATERIALIZE_DISABLED: fileUrl.allowedHosts not configured')
					}
					setAt(v as any, tokens, await materializeSingleUrl(leaf.__qaFileUrl, fileUrl, materializeAs))
				}
			}
		}

		if (p.fileArrayPaths && p.fileArrayPaths.length && v && typeof v === 'object') {
			for (const path of p.fileArrayPaths) {
				const tokens = parsePath(path)
				const leaf = getAt(v as any, tokens)
				if (isQaFileRefs(leaf)) {
					assertModeAllowsRef(mode)
					if (!uploadStore) throw new Error('FILE_REF_NOT_ALLOWED: upload store not configured')
					setAt(v as any, tokens, materializeManyRef(uploadStore, socketId, leaf.__qaFileRefs, materializeAs))
				} else if (isArrayOfQaFileRef(leaf)) {
					assertModeAllowsRef(mode)
					if (!uploadStore) throw new Error('FILE_REF_NOT_ALLOWED: upload store not configured')
					setAt(
						v as any,
						tokens,
						materializeManyRef(
							uploadStore,
							socketId,
							leaf.map((x) => x.__qaFileRef),
							materializeAs,
						),
					)
				} else if (isQaFileUrls(leaf)) {
					assertModeAllowsUrl(mode)
					if (!fileUrl?.allowedHosts?.length) {
						throw new Error('FILE_URL_MATERIALIZE_DISABLED: fileUrl.allowedHosts not configured')
					}
					setAt(v as any, tokens, await materializeManyUrl(leaf.__qaFileUrls, fileUrl, materializeAs))
				} else if (isArrayOfQaFileUrl(leaf)) {
					assertModeAllowsUrl(mode)
					if (!fileUrl?.allowedHosts?.length) {
						throw new Error('FILE_URL_MATERIALIZE_DISABLED: fileUrl.allowedHosts not configured')
					}
					setAt(
						v as any,
						tokens,
						await materializeManyUrl(
							leaf.map((x) => x.__qaFileUrl),
							fileUrl,
							materializeAs,
						),
					)
				} else if (leaf && typeof leaf === 'object') {
					assertLeafRefUrlExclusivity(leaf)
				}
			}
		}
	}

	return out
}

export type MulterLikeFile = {
	fieldname: string
	originalname: string
	mimetype: string
	size: number
	buffer: Buffer
}

/**
 * When materialized uploads use a single field name, `files` is `Record<field, MulterLikeFile[]>`.
 * Flatten to `MulterLikeFile[]` on the payload so mock `req.files` is an array (handlers often use
 * `(req.files as []).map(...)` like multer `.array()`).
 */
export function normalizeExpressPayloadFilesForPlayground(payload: { files?: unknown }): void {
	const raw = payload.files
	if (!raw || Array.isArray(raw) || typeof raw !== 'object') return
	const record = raw as Record<string, MulterLikeFile[]>
	const keys = Object.keys(record)
	if (keys.length !== 1) return
	const arr = record[keys[0]!]
	if (Array.isArray(arr)) payload.files = arr
}

/**
 * Turn wire payloads on the express RPC payload (`files` / `filesMany` with `__qaFileRef` or
 * `__qaFileUrl`) into multer-like `req.file` / `req.files` on the host before the handler runs.
 * When all uploads share one field name, `req.files` is set to a **flat array** of parts; multiple
 * field names keep a **record** keyed by field. Call {@link normalizeExpressPayloadFilesForPlayground}
 * before building the mock `req` if you merge payloads outside this helper.
 *
 * URL mode: the **client** already uploaded bytes and sent a GET URL (same as service RPC); this
 * step **fetches** those URLs (`fetchFileUrl`) — it does not presign again. Ref mode: reads from
 * `uploadStore` by `__qaFileRef`. Nested `filePaths` inside `express.body` are not handled here
 * (would be a separate protocol/UI phase if product needs it).
 */
export async function materializeExpressPayloadForInvoke(options: {
	socketId: string
	uploadStore?: InMemoryUploadStore | null
	fileUrl?: FetchFileUrlOptions | null
	qaFileWire?: { mode?: QaFileWireMode }
	expressPayload: { headers?: Record<string, string>; body?: unknown; method?: string; path?: string } & {
		files?: Array<{ fieldName: string; ref: QaFileRef | QaFileUrl }>
		filesMany?: Array<
			| { fieldName: string; refs: Array<QaFileRef | QaFileUrl> }
			| { fieldName: string; refs: QaFileRefs | QaFileUrls }
		>
	}
}): Promise<
	{ file?: MulterLikeFile; files?: Record<string, MulterLikeFile[]> | MulterLikeFile[] } & typeof options.expressPayload
> {
	const { socketId, uploadStore } = options
	const fileUrl = options.fileUrl ?? null
	const mode = effectiveWireMode(options.qaFileWire)
	const payload: any = { ...options.expressPayload }

	let single: MulterLikeFile | undefined
	const filesByField: Record<string, MulterLikeFile[]> = {}

	if (Array.isArray(payload.files)) {
		for (const f of payload.files) {
			if (!f || typeof f !== 'object') continue
			const ref = (f as any).ref as unknown
			assertLeafRefUrlExclusivity(ref)
			if (isQaFileRef(ref)) {
				assertModeAllowsRef(mode)
				if (!uploadStore) throw new Error('FILE_REF_NOT_ALLOWED: upload store not configured')
				const u = getUploadOrThrow(uploadStore, socketId, ref.__qaFileRef)
				const mf: MulterLikeFile = {
					fieldname: f.fieldName,
					originalname: u.filename,
					mimetype: u.contentType,
					size: u.sizeBytes,
					buffer: u.buffer,
				}
				single = mf
				filesByField[f.fieldName] = [mf]
			} else if (isQaFileUrl(ref)) {
				assertModeAllowsUrl(mode)
				if (!fileUrl?.allowedHosts?.length) {
					throw new Error('FILE_URL_MATERIALIZE_DISABLED: fileUrl.allowedHosts not configured')
				}
				const fetched = await fetchFileUrl(ref.__qaFileUrl, fileUrl)
				const mf: MulterLikeFile = {
					fieldname: f.fieldName,
					originalname: fetched.filename,
					mimetype: fetched.contentType,
					size: fetched.buffer.byteLength,
					buffer: fetched.buffer,
				}
				single = mf
				filesByField[f.fieldName] = [mf]
			}
		}
	}

	if (Array.isArray(payload.filesMany)) {
		for (const group of payload.filesMany) {
			if (!group || typeof group !== 'object') continue
			const fieldName = (group as any).fieldName
			if (typeof fieldName !== 'string' || !fieldName) continue
			const refsVal = (group as any).refs as unknown
			const list: MulterLikeFile[] = []

			if (isQaFileRefs(refsVal)) {
				assertModeAllowsRef(mode)
				if (!uploadStore) throw new Error('FILE_REF_NOT_ALLOWED: upload store not configured')
				for (const id of refsVal.__qaFileRefs) {
					const u = getUploadOrThrow(uploadStore, socketId, id)
					list.push({
						fieldname: fieldName,
						originalname: u.filename,
						mimetype: u.contentType,
						size: u.sizeBytes,
						buffer: u.buffer,
					})
				}
			} else if (isQaFileUrls(refsVal)) {
				assertModeAllowsUrl(mode)
				if (!fileUrl?.allowedHosts?.length) {
					throw new Error('FILE_URL_MATERIALIZE_DISABLED: fileUrl.allowedHosts not configured')
				}
				for (const url of refsVal.__qaFileUrls) {
					const fetched = await fetchFileUrl(url, fileUrl)
					list.push({
						fieldname: fieldName,
						originalname: fetched.filename,
						mimetype: fetched.contentType,
						size: fetched.buffer.byteLength,
						buffer: fetched.buffer,
					})
				}
			} else if (Array.isArray(refsVal)) {
				for (const r of refsVal as unknown[]) {
					assertLeafRefUrlExclusivity(r)
					if (isQaFileRef(r)) {
						assertModeAllowsRef(mode)
						if (!uploadStore) throw new Error('FILE_REF_NOT_ALLOWED: upload store not configured')
						const u = getUploadOrThrow(uploadStore, socketId, r.__qaFileRef)
						list.push({
							fieldname: fieldName,
							originalname: u.filename,
							mimetype: u.contentType,
							size: u.sizeBytes,
							buffer: u.buffer,
						})
					} else if (isQaFileUrl(r)) {
						assertModeAllowsUrl(mode)
						if (!fileUrl?.allowedHosts?.length) {
							throw new Error('FILE_URL_MATERIALIZE_DISABLED: fileUrl.allowedHosts not configured')
						}
						const fetched = await fetchFileUrl(r.__qaFileUrl, fileUrl)
						list.push({
							fieldname: fieldName,
							originalname: fetched.filename,
							mimetype: fetched.contentType,
							size: fetched.buffer.byteLength,
							buffer: fetched.buffer,
						})
					}
				}
			}

			if (list.length) filesByField[fieldName] = list
		}
	}

	payload.file = single ?? payload.file
	const keys = Object.keys(filesByField)
	if (keys.length === 1) {
		payload.files = filesByField[keys[0]!]
	} else if (keys.length > 1) {
		payload.files = filesByField
	}
	return payload
}

/** Public slice of fileUrl options safe for BOOTSTRAP / catalog (no secrets in fileUrl itself). */
export function publicFileUrlCatalogSlice(opts: FetchFileUrlOptions | null | undefined): FetchFileUrlOptions | undefined {
	if (!opts) return undefined
	return {
		allowedHosts: [...opts.allowedHosts],
		maxDownloadBytes: opts.maxDownloadBytes,
		timeoutMs: opts.timeoutMs,
		maxRedirects: opts.maxRedirects,
		allowHttp: opts.allowHttp,
	}
}

export type CatalogWireExtras = {
	qaFileWire: { mode: QaFileWireMode }
	qaMediaUpload?: { target: QaMediaUploadTarget }
	fileUrl?: FetchFileUrlOptions
	qaMediaUploadHostUploadUrl?: string
}

export function buildCatalogWireExtras(options: {
	qaFileWire?: { mode?: QaFileWireMode }
	qaMediaUpload?: { target: QaMediaUploadTarget }
	fileUrl?: FetchFileUrlOptions | null
	qaMediaUploadHostUploadUrl?: string
}): CatalogWireExtras {
	const mode: QaFileWireMode = options.qaFileWire?.mode ?? 'ref'
	const out: CatalogWireExtras = { qaFileWire: { mode } }
	if (options.qaMediaUpload) out.qaMediaUpload = { ...options.qaMediaUpload }
	const pub = publicFileUrlCatalogSlice(options.fileUrl ?? null)
	if (pub) out.fileUrl = pub
	if (typeof options.qaMediaUploadHostUploadUrl === 'string' && options.qaMediaUploadHostUploadUrl.trim()) {
		out.qaMediaUploadHostUploadUrl = options.qaMediaUploadHostUploadUrl.trim()
	}
	return out
}

export function enrichRegistryParamsWithWireHints(
	registry: Record<string, RegistryEntry>,
	extras: CatalogWireExtras,
): Record<string, RegistryEntry> {
	const mode = extras.qaFileWire.mode
	const target = extras.qaMediaUpload?.target
	return Object.fromEntries(
		Object.entries(registry).map(([k, entry]) => {
			const params = entry.params.map((p) => {
				const hasFile =
					p.kind === 'file' ||
					p.kind === 'files' ||
					(p.filePaths && p.filePaths.length > 0) ||
					(p.fileArrayPaths && p.fileArrayPaths.length > 0)
				if (!hasFile) return { ...p }
				return {
					...p,
					qaFileWire: mode,
					...(target !== undefined ? { qaMediaUpload: target } : {}),
				}
			})
			return [k, { ...entry, params }]
		}),
	)
}
