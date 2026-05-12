import { fetchFileUrl } from './fetch-file-url.js';
function isQaFileRef(v) {
    return Boolean(v && typeof v === 'object' && typeof v.__qaFileRef === 'string');
}
function isQaFileRefs(v) {
    return Boolean(v &&
        typeof v === 'object' &&
        Array.isArray(v.__qaFileRefs) &&
        v.__qaFileRefs.every((x) => typeof x === 'string'));
}
function isArrayOfQaFileRef(v) {
    return Array.isArray(v) && v.every((x) => isQaFileRef(x));
}
function isQaFileUrl(v) {
    return Boolean(v && typeof v === 'object' && typeof v.__qaFileUrl === 'string');
}
function isQaFileUrls(v) {
    return Boolean(v &&
        typeof v === 'object' &&
        Array.isArray(v.__qaFileUrls) &&
        v.__qaFileUrls.every((x) => typeof x === 'string'));
}
function isArrayOfQaFileUrl(v) {
    return Array.isArray(v) && v.every((x) => isQaFileUrl(x));
}
function assertLeafRefUrlExclusivity(leaf) {
    if (!leaf || typeof leaf !== 'object')
        return;
    const o = leaf;
    const hasRef = typeof o.__qaFileRef === 'string';
    const hasUrl = typeof o.__qaFileUrl === 'string';
    if (hasRef && hasUrl) {
        throw new Error('FILE_REF_AND_URL: both __qaFileRef and __qaFileUrl on same value');
    }
}
function getUploadOrThrow(store, socketId, uploadId) {
    const u = store.get(socketId, uploadId, { consume: true });
    if (!u)
        throw new Error(`UPLOAD_NOT_FOUND: ${uploadId}`);
    return u;
}
function bufferToFile(u) {
    const FileCtor = globalThis.File;
    if (!FileCtor)
        throw new Error('FILE_UNAVAILABLE: global File is not available in this Node runtime');
    return new FileCtor([u.buffer], u.filename, { type: u.contentType });
}
function bufferToFileFromParts(parts, as) {
    if (as === 'buffer')
        return parts.buffer;
    const FileCtor = globalThis.File;
    if (!FileCtor)
        throw new Error('FILE_UNAVAILABLE: global File is not available in this Node runtime');
    return new FileCtor([parts.buffer], parts.filename, { type: parts.contentType });
}
function materializeSingleRef(store, socketId, uploadId, as) {
    const u = getUploadOrThrow(store, socketId, uploadId);
    return as === 'file' ? bufferToFile(u) : u.buffer;
}
function materializeManyRef(store, socketId, uploadIds, as) {
    return uploadIds.map((id) => materializeSingleRef(store, socketId, id, as));
}
async function materializeSingleUrl(url, fileUrl, as) {
    const fetched = await fetchFileUrl(url, fileUrl);
    return bufferToFileFromParts({
        buffer: fetched.buffer,
        filename: fetched.filename,
        contentType: fetched.contentType,
    }, as);
}
async function materializeManyUrl(urls, fileUrl, as) {
    const out = [];
    for (const u of urls) {
        out.push(await materializeSingleUrl(u, fileUrl, as));
    }
    return out;
}
function effectiveWireMode(wire) {
    return wire?.mode ?? 'ref';
}
function assertModeAllowsRef(mode) {
    if (mode === 'url')
        throw new Error('FILE_REF_NOT_ALLOWED: qaFileWire.mode is url');
}
function assertModeAllowsUrl(mode) {
    if (mode === 'ref')
        throw new Error('FILE_URL_NOT_ALLOWED: qaFileWire.mode is ref');
}
function parsePath(path) {
    const out = [];
    const parts = path.split('.');
    for (const part of parts) {
        const m = /^([^\[]+)(?:\[(\d+)\])?$/.exec(part);
        if (!m)
            continue;
        out.push({ kind: 'prop', key: m[1] });
        if (m[2] !== undefined)
            out.push({ kind: 'index', index: Number(m[2]) });
    }
    return out;
}
function getAt(root, tokens) {
    let cur = root;
    for (const t of tokens) {
        if (cur === null || cur === undefined)
            return undefined;
        if (t.kind === 'prop')
            cur = cur[t.key];
        else
            cur = cur[t.index];
    }
    return cur;
}
function setAt(root, tokens, value) {
    if (tokens.length === 0)
        return;
    let cur = root;
    for (let i = 0; i < tokens.length - 1; i++) {
        const t = tokens[i];
        if (t.kind === 'prop') {
            if (cur[t.key] === undefined)
                cur[t.key] = {};
            cur = cur[t.key];
        }
        else {
            if (!Array.isArray(cur))
                throw new Error('PATH_NOT_ARRAY');
            if (cur[t.index] === undefined)
                cur[t.index] = {};
            cur = cur[t.index];
        }
    }
    const last = tokens[tokens.length - 1];
    if (last.kind === 'prop')
        cur[last.key] = value;
    else {
        if (!Array.isArray(cur))
            throw new Error('PATH_NOT_ARRAY');
        cur[last.index] = value;
    }
}
export async function materializeServiceArgsForInvoke(options) {
    const { entry, args, socketId } = options;
    const materializeAs = options.materializeAs ?? 'buffer';
    const uploadStore = options.uploadStore ?? null;
    const fileUrl = options.fileUrl ?? null;
    const mode = effectiveWireMode(options.qaFileWire);
    const out = [...args];
    for (let i = 0; i < entry.params.length; i++) {
        const p = entry.params[i];
        const v = out[i];
        if (p.kind === 'file') {
            assertLeafRefUrlExclusivity(v);
            if (isQaFileRef(v)) {
                assertModeAllowsRef(mode);
                if (!uploadStore)
                    throw new Error('FILE_REF_NOT_ALLOWED: upload store not configured');
                out[i] = materializeSingleRef(uploadStore, socketId, v.__qaFileRef, materializeAs);
                continue;
            }
            if (isQaFileUrl(v)) {
                assertModeAllowsUrl(mode);
                if (!fileUrl?.allowedHosts?.length) {
                    throw new Error('FILE_URL_MATERIALIZE_DISABLED: fileUrl.allowedHosts not configured');
                }
                out[i] = await materializeSingleUrl(v.__qaFileUrl, fileUrl, materializeAs);
                continue;
            }
        }
        if (p.kind === 'files') {
            if (isQaFileRefs(v)) {
                assertModeAllowsRef(mode);
                if (!uploadStore)
                    throw new Error('FILE_REF_NOT_ALLOWED: upload store not configured');
                out[i] = materializeManyRef(uploadStore, socketId, v.__qaFileRefs, materializeAs);
                continue;
            }
            if (isArrayOfQaFileRef(v)) {
                assertModeAllowsRef(mode);
                if (!uploadStore)
                    throw new Error('FILE_REF_NOT_ALLOWED: upload store not configured');
                out[i] = materializeManyRef(uploadStore, socketId, v.map((x) => x.__qaFileRef), materializeAs);
                continue;
            }
            if (isQaFileUrls(v)) {
                assertModeAllowsUrl(mode);
                if (!fileUrl?.allowedHosts?.length) {
                    throw new Error('FILE_URL_MATERIALIZE_DISABLED: fileUrl.allowedHosts not configured');
                }
                out[i] = await materializeManyUrl(v.__qaFileUrls, fileUrl, materializeAs);
                continue;
            }
            if (isArrayOfQaFileUrl(v)) {
                assertModeAllowsUrl(mode);
                if (!fileUrl?.allowedHosts?.length) {
                    throw new Error('FILE_URL_MATERIALIZE_DISABLED: fileUrl.allowedHosts not configured');
                }
                out[i] = await materializeManyUrl(v.map((x) => x.__qaFileUrl), fileUrl, materializeAs);
                continue;
            }
        }
        if (p.filePaths && p.filePaths.length && v && typeof v === 'object') {
            for (const path of p.filePaths) {
                const tokens = parsePath(path);
                const leaf = getAt(v, tokens);
                assertLeafRefUrlExclusivity(leaf);
                if (isQaFileRef(leaf)) {
                    assertModeAllowsRef(mode);
                    if (!uploadStore)
                        throw new Error('FILE_REF_NOT_ALLOWED: upload store not configured');
                    setAt(v, tokens, materializeSingleRef(uploadStore, socketId, leaf.__qaFileRef, materializeAs));
                }
                else if (isQaFileUrl(leaf)) {
                    assertModeAllowsUrl(mode);
                    if (!fileUrl?.allowedHosts?.length) {
                        throw new Error('FILE_URL_MATERIALIZE_DISABLED: fileUrl.allowedHosts not configured');
                    }
                    setAt(v, tokens, await materializeSingleUrl(leaf.__qaFileUrl, fileUrl, materializeAs));
                }
            }
        }
        if (p.fileArrayPaths && p.fileArrayPaths.length && v && typeof v === 'object') {
            for (const path of p.fileArrayPaths) {
                const tokens = parsePath(path);
                const leaf = getAt(v, tokens);
                if (isQaFileRefs(leaf)) {
                    assertModeAllowsRef(mode);
                    if (!uploadStore)
                        throw new Error('FILE_REF_NOT_ALLOWED: upload store not configured');
                    setAt(v, tokens, materializeManyRef(uploadStore, socketId, leaf.__qaFileRefs, materializeAs));
                }
                else if (isArrayOfQaFileRef(leaf)) {
                    assertModeAllowsRef(mode);
                    if (!uploadStore)
                        throw new Error('FILE_REF_NOT_ALLOWED: upload store not configured');
                    setAt(v, tokens, materializeManyRef(uploadStore, socketId, leaf.map((x) => x.__qaFileRef), materializeAs));
                }
                else if (isQaFileUrls(leaf)) {
                    assertModeAllowsUrl(mode);
                    if (!fileUrl?.allowedHosts?.length) {
                        throw new Error('FILE_URL_MATERIALIZE_DISABLED: fileUrl.allowedHosts not configured');
                    }
                    setAt(v, tokens, await materializeManyUrl(leaf.__qaFileUrls, fileUrl, materializeAs));
                }
                else if (isArrayOfQaFileUrl(leaf)) {
                    assertModeAllowsUrl(mode);
                    if (!fileUrl?.allowedHosts?.length) {
                        throw new Error('FILE_URL_MATERIALIZE_DISABLED: fileUrl.allowedHosts not configured');
                    }
                    setAt(v, tokens, await materializeManyUrl(leaf.map((x) => x.__qaFileUrl), fileUrl, materializeAs));
                }
                else if (leaf && typeof leaf === 'object') {
                    assertLeafRefUrlExclusivity(leaf);
                }
            }
        }
    }
    return out;
}
/**
 * When materialized uploads use a single field name, `files` is `Record<field, MulterLikeFile[]>`.
 * Flatten to `MulterLikeFile[]` on the payload so mock `req.files` is an array (handlers often use
 * `(req.files as []).map(...)` like multer `.array()`).
 */
export function normalizeExpressPayloadFilesForPlayground(payload) {
    const raw = payload.files;
    if (!raw || Array.isArray(raw) || typeof raw !== 'object')
        return;
    const record = raw;
    const keys = Object.keys(record);
    if (keys.length !== 1)
        return;
    const arr = record[keys[0]];
    if (Array.isArray(arr))
        payload.files = arr;
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
export async function materializeExpressPayloadForInvoke(options) {
    const { socketId, uploadStore } = options;
    const fileUrl = options.fileUrl ?? null;
    const mode = effectiveWireMode(options.qaFileWire);
    const payload = { ...options.expressPayload };
    let single;
    const filesByField = {};
    if (Array.isArray(payload.files)) {
        for (const f of payload.files) {
            if (!f || typeof f !== 'object')
                continue;
            const ref = f.ref;
            assertLeafRefUrlExclusivity(ref);
            if (isQaFileRef(ref)) {
                assertModeAllowsRef(mode);
                if (!uploadStore)
                    throw new Error('FILE_REF_NOT_ALLOWED: upload store not configured');
                const u = getUploadOrThrow(uploadStore, socketId, ref.__qaFileRef);
                const mf = {
                    fieldname: f.fieldName,
                    originalname: u.filename,
                    mimetype: u.contentType,
                    size: u.sizeBytes,
                    buffer: u.buffer,
                };
                single = mf;
                filesByField[f.fieldName] = [mf];
            }
            else if (isQaFileUrl(ref)) {
                assertModeAllowsUrl(mode);
                if (!fileUrl?.allowedHosts?.length) {
                    throw new Error('FILE_URL_MATERIALIZE_DISABLED: fileUrl.allowedHosts not configured');
                }
                const fetched = await fetchFileUrl(ref.__qaFileUrl, fileUrl);
                const mf = {
                    fieldname: f.fieldName,
                    originalname: fetched.filename,
                    mimetype: fetched.contentType,
                    size: fetched.buffer.byteLength,
                    buffer: fetched.buffer,
                };
                single = mf;
                filesByField[f.fieldName] = [mf];
            }
        }
    }
    if (Array.isArray(payload.filesMany)) {
        for (const group of payload.filesMany) {
            if (!group || typeof group !== 'object')
                continue;
            const fieldName = group.fieldName;
            if (typeof fieldName !== 'string' || !fieldName)
                continue;
            const refsVal = group.refs;
            const list = [];
            if (isQaFileRefs(refsVal)) {
                assertModeAllowsRef(mode);
                if (!uploadStore)
                    throw new Error('FILE_REF_NOT_ALLOWED: upload store not configured');
                for (const id of refsVal.__qaFileRefs) {
                    const u = getUploadOrThrow(uploadStore, socketId, id);
                    list.push({
                        fieldname: fieldName,
                        originalname: u.filename,
                        mimetype: u.contentType,
                        size: u.sizeBytes,
                        buffer: u.buffer,
                    });
                }
            }
            else if (isQaFileUrls(refsVal)) {
                assertModeAllowsUrl(mode);
                if (!fileUrl?.allowedHosts?.length) {
                    throw new Error('FILE_URL_MATERIALIZE_DISABLED: fileUrl.allowedHosts not configured');
                }
                for (const url of refsVal.__qaFileUrls) {
                    const fetched = await fetchFileUrl(url, fileUrl);
                    list.push({
                        fieldname: fieldName,
                        originalname: fetched.filename,
                        mimetype: fetched.contentType,
                        size: fetched.buffer.byteLength,
                        buffer: fetched.buffer,
                    });
                }
            }
            else if (Array.isArray(refsVal)) {
                for (const r of refsVal) {
                    assertLeafRefUrlExclusivity(r);
                    if (isQaFileRef(r)) {
                        assertModeAllowsRef(mode);
                        if (!uploadStore)
                            throw new Error('FILE_REF_NOT_ALLOWED: upload store not configured');
                        const u = getUploadOrThrow(uploadStore, socketId, r.__qaFileRef);
                        list.push({
                            fieldname: fieldName,
                            originalname: u.filename,
                            mimetype: u.contentType,
                            size: u.sizeBytes,
                            buffer: u.buffer,
                        });
                    }
                    else if (isQaFileUrl(r)) {
                        assertModeAllowsUrl(mode);
                        if (!fileUrl?.allowedHosts?.length) {
                            throw new Error('FILE_URL_MATERIALIZE_DISABLED: fileUrl.allowedHosts not configured');
                        }
                        const fetched = await fetchFileUrl(r.__qaFileUrl, fileUrl);
                        list.push({
                            fieldname: fieldName,
                            originalname: fetched.filename,
                            mimetype: fetched.contentType,
                            size: fetched.buffer.byteLength,
                            buffer: fetched.buffer,
                        });
                    }
                }
            }
            if (list.length)
                filesByField[fieldName] = list;
        }
    }
    payload.file = single ?? payload.file;
    const keys = Object.keys(filesByField);
    if (keys.length === 1) {
        payload.files = filesByField[keys[0]];
    }
    else if (keys.length > 1) {
        payload.files = filesByField;
    }
    return payload;
}
/** Public slice of fileUrl options safe for BOOTSTRAP / catalog (no secrets in fileUrl itself). */
export function publicFileUrlCatalogSlice(opts) {
    if (!opts)
        return undefined;
    return {
        allowedHosts: [...opts.allowedHosts],
        maxDownloadBytes: opts.maxDownloadBytes,
        timeoutMs: opts.timeoutMs,
        maxRedirects: opts.maxRedirects,
        allowHttp: opts.allowHttp,
    };
}
export function buildCatalogWireExtras(options) {
    const mode = options.qaFileWire?.mode ?? 'ref';
    const out = { qaFileWire: { mode } };
    if (options.qaMediaUpload)
        out.qaMediaUpload = { ...options.qaMediaUpload };
    const pub = publicFileUrlCatalogSlice(options.fileUrl ?? null);
    if (pub)
        out.fileUrl = pub;
    if (typeof options.qaMediaUploadHostUploadUrl === 'string' && options.qaMediaUploadHostUploadUrl.trim()) {
        out.qaMediaUploadHostUploadUrl = options.qaMediaUploadHostUploadUrl.trim();
    }
    return out;
}
export function enrichRegistryParamsWithWireHints(registry, extras) {
    const mode = extras.qaFileWire.mode;
    const target = extras.qaMediaUpload?.target;
    return Object.fromEntries(Object.entries(registry).map(([k, entry]) => {
        const params = entry.params.map((p) => {
            const hasFile = p.kind === 'file' ||
                p.kind === 'files' ||
                (p.filePaths && p.filePaths.length > 0) ||
                (p.fileArrayPaths && p.fileArrayPaths.length > 0);
            if (!hasFile)
                return { ...p };
            return {
                ...p,
                qaFileWire: mode,
                ...(target !== undefined ? { qaMediaUpload: target } : {}),
            };
        });
        return [k, { ...entry, params }];
    }));
}
//# sourceMappingURL=materialize.js.map