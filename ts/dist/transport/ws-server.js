import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import WebSocket, { WebSocketServer } from 'ws';
import { computeCoverageReport } from '../coverage/compute-coverage.js';
import { configureInvokeRateLimit, invokeAudit, invokeRateLimitAllow, invokeRateLimitRetryAfterMs, runPreInvokes, } from '../invoke-policy.js';
import { Registry, wsClients } from '../registry-state.js';
import { executeRPC } from '../rpc.js';
import { setInvokeTimeoutMs } from '../invoke-runtime-config.js';
import { resetRpcSerializationConfig, setRpcSerializationConfig, } from '../serialize-rpc-result.js';
import { sessionCreate, sessionStep } from '../session-store.js';
import { PROTOCOL_VERSION } from '../types.js';
import { buildCatalogWireExtras, enrichRegistryParamsWithWireHints, materializeServiceArgsForInvoke, } from '../upload/materialize.js';
import { InMemoryUploadStore } from '../upload/upload-store.js';
function rpcRateLimitedResponse(requestId, fnKey, retryAfterMs) {
    return {
        type: 'RPC_RESPONSE',
        requestId,
        fnKey,
        status: 'error',
        result: null,
        returnType: 'error',
        returnShape: null,
        label: 'RATE_LIMITED',
        duration: '0ms',
        error: {
            message: `rate limited; retry after ${retryAfterMs}ms`,
            stack: null,
            layer: 'validation',
            code: 'RATE_LIMITED',
        },
    };
}
function rpcUploadMaterializeError(requestId, fnKey, message, start) {
    return {
        type: 'RPC_RESPONSE',
        requestId,
        fnKey,
        status: 'error',
        result: null,
        returnType: 'error',
        returnShape: null,
        label: 'UPLOAD_MATERIALIZE_FAILED',
        duration: `${(performance.now() - start).toFixed(2)}ms`,
        error: {
            message,
            stack: null,
            layer: 'validation',
            code: 'UPLOAD_MATERIALIZE_FAILED',
        },
    };
}
function getAuthTokenFromRequest(req) {
    const url = req.url;
    if (!url)
        return undefined;
    try {
        const q = url.includes('?') ? url.slice(url.indexOf('?')) : '';
        const params = new URLSearchParams(q);
        return params.get('token') ?? undefined;
    }
    catch {
        return undefined;
    }
}
export function startInspectorWebSocket(registrySnapshot, tree, options) {
    const host = options.host ?? '127.0.0.1';
    const max = options.maxPayloadBytes ?? 4 * 1024 * 1024;
    configureInvokeRateLimit(options.invokeRateLimit ?? null);
    setInvokeTimeoutMs(options.invokeTimeoutMs);
    if (options.rpcSerialization !== undefined) {
        if (options.rpcSerialization.enabled) {
            setRpcSerializationConfig(options.rpcSerialization);
        }
        else {
            resetRpcSerializationConfig();
        }
    }
    return new Promise((resolve, reject) => {
        const wss = new WebSocketServer({
            host,
            port: options.port,
            maxPayload: max,
        });
        wss.on('connection', (ws, req) => {
            const connKey = randomUUID();
            const clientWireToken = getAuthTokenFromRequest(req);
            const uploadEnabled = options.upload?.enabled === true;
            const uploadStore = uploadEnabled
                ? new InMemoryUploadStore({
                    maxSizeBytes: options.upload?.maxSizeBytes ?? 50 * 1024 * 1024,
                    idleTimeoutMs: options.upload?.idleTimeoutMs ?? 60_000,
                })
                : null;
            if (options.authToken !== undefined) {
                const token = clientWireToken;
                if (token !== options.authToken) {
                    ws.close(4401, 'Unauthorized');
                    return;
                }
            }
            wsClients.add(ws);
            const redactedRegistry = Object.fromEntries(Object.entries(registrySnapshot).map(([k, v]) => [k, { ...v, body: '' }]));
            const wireExtras = buildCatalogWireExtras({
                qaFileWire: options.qaFileWire,
                qaMediaUpload: options.qaMediaUpload,
                fileUrl: options.fileUrl,
                qaMediaUploadHostUploadUrl: options.qaMediaUploadHostUploadUrl,
            });
            const registryForWire = enrichRegistryParamsWithWireHints(redactedRegistry, wireExtras);
            ws.send(JSON.stringify({
                event: 'BOOTSTRAP',
                protocolVersion: PROTOCOL_VERSION,
                registry: registryForWire,
                tree,
                qaFileWire: wireExtras.qaFileWire,
                ...(wireExtras.qaMediaUpload ? { qaMediaUpload: wireExtras.qaMediaUpload } : {}),
                ...(wireExtras.fileUrl ? { fileUrl: wireExtras.fileUrl } : {}),
                ...(wireExtras.qaMediaUploadHostUploadUrl
                    ? { qaMediaUploadHostUploadUrl: wireExtras.qaMediaUploadHostUploadUrl }
                    : {}),
            }));
            ws.on('message', async (data) => {
                let msg;
                try {
                    msg = JSON.parse(data.toString());
                }
                catch {
                    ws.send(JSON.stringify({ event: 'ERROR', error: 'Invalid JSON' }));
                    return;
                }
                if (typeof msg !== 'object' || msg === null)
                    return;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const m = msg;
                function sendUploadError(code, message, uploadId) {
                    ws.send(JSON.stringify({
                        type: 'QA_UPLOAD_ERROR',
                        protocolVersion: PROTOCOL_VERSION,
                        code,
                        message,
                        uploadId,
                    }));
                }
                if (m.type === 'QA_UPLOAD_START') {
                    if (!uploadStore) {
                        sendUploadError('UPLOAD_DISABLED', 'QA file uploads are not enabled on this WebSocket server', typeof m.uploadId === 'string' ? m.uploadId : null);
                        return;
                    }
                    try {
                        const filename = typeof m.filename === 'string' ? m.filename : 'upload.bin';
                        const contentType = typeof m.contentType === 'string' ? m.contentType : 'application/octet-stream';
                        const sizeBytes = typeof m.sizeBytes === 'number' && Number.isFinite(m.sizeBytes) ? m.sizeBytes : -1;
                        if (sizeBytes < 0) {
                            throw new Error('sizeBytes must be a non-negative number');
                        }
                        const uploadId = typeof m.uploadId === 'string' ? m.uploadId : undefined;
                        const meta = uploadStore.start(connKey, { uploadId, filename, contentType, sizeBytes });
                        ws.send(JSON.stringify({
                            type: 'QA_UPLOAD_ACK',
                            protocolVersion: PROTOCOL_VERSION,
                            uploadId: meta.uploadId,
                            accepted: true,
                        }));
                    }
                    catch (e) {
                        const message = e instanceof Error ? e.message : 'UPLOAD_START_FAILED';
                        sendUploadError('UPLOAD_START_FAILED', message, typeof m.uploadId === 'string' ? m.uploadId : null);
                    }
                    return;
                }
                if (m.type === 'QA_UPLOAD_CHUNK') {
                    if (!uploadStore) {
                        sendUploadError('UPLOAD_DISABLED', 'QA file uploads are not enabled on this WebSocket server', null);
                        return;
                    }
                    const b64 = typeof m.b64 === 'string' ? m.b64 : '';
                    let buf;
                    try {
                        buf = Buffer.from(b64, 'base64');
                    }
                    catch {
                        sendUploadError('INVALID_CHUNK', 'b64 must be valid base64', null);
                        return;
                    }
                    try {
                        const { uploadId, receivedBytes } = uploadStore.writeChunk(connKey, buf);
                        ws.send(JSON.stringify({
                            type: 'QA_UPLOAD_PROGRESS',
                            protocolVersion: PROTOCOL_VERSION,
                            uploadId,
                            receivedBytes,
                        }));
                    }
                    catch (e) {
                        const message = e instanceof Error ? e.message : 'UPLOAD_CHUNK_FAILED';
                        sendUploadError('UPLOAD_CHUNK_FAILED', message, typeof m.uploadId === 'string' ? m.uploadId : null);
                    }
                    return;
                }
                if (m.type === 'QA_UPLOAD_FINISH') {
                    if (!uploadStore) {
                        sendUploadError('UPLOAD_DISABLED', 'QA file uploads are not enabled on this WebSocket server', null);
                        return;
                    }
                    const uploadId = typeof m.uploadId === 'string' ? m.uploadId : '';
                    if (!uploadId) {
                        sendUploadError('INVALID_PAYLOAD', 'uploadId is required', null);
                        return;
                    }
                    try {
                        const done = uploadStore.finish(connKey, uploadId);
                        ws.send(JSON.stringify({
                            type: 'QA_UPLOAD_COMPLETE',
                            protocolVersion: PROTOCOL_VERSION,
                            uploadId: done.uploadId,
                            filename: done.filename,
                            contentType: done.contentType,
                            receivedBytes: done.receivedBytes,
                        }));
                    }
                    catch (e) {
                        const message = e instanceof Error ? e.message : 'UPLOAD_FINISH_FAILED';
                        sendUploadError('UPLOAD_FINISH_FAILED', message, uploadId);
                    }
                    return;
                }
                if (m.type === 'QA_UPLOAD_ABORT') {
                    if (uploadStore)
                        uploadStore.abort(connKey);
                    ws.send(JSON.stringify({
                        type: 'QA_UPLOAD_ACK',
                        protocolVersion: PROTOCOL_VERSION,
                        aborted: true,
                    }));
                    return;
                }
                if (m.type === 'RPC_CALL') {
                    if (typeof m.requestId !== 'string' || typeof m.fnKey !== 'string')
                        return;
                    if (!Array.isArray(m.args))
                        return;
                    const t0 = performance.now();
                    const requestId = m.requestId;
                    const fnKey = m.fnKey;
                    let args = m.args;
                    const entry = Registry.get(fnKey);
                    const fileUrlOpts = options.fileUrl;
                    const canMaterializeRefs = Boolean(uploadStore && entry);
                    const canMaterializeUrls = Boolean(entry && fileUrlOpts && fileUrlOpts.allowedHosts && fileUrlOpts.allowedHosts.length > 0);
                    if (entry && (canMaterializeRefs || canMaterializeUrls)) {
                        try {
                            const wantsFile = entry.params.some((pp) => {
                                const t = String(pp.type ?? '');
                                return /\bFile\b|\bBlob\b/.test(t);
                            });
                            args = await materializeServiceArgsForInvoke({
                                entry,
                                args,
                                socketId: connKey,
                                uploadStore,
                                fileUrl: fileUrlOpts ?? null,
                                qaFileWire: options.qaFileWire,
                                materializeAs: wantsFile ? 'file' : 'buffer',
                            });
                        }
                        catch (err) {
                            const message = err instanceof Error ? err.message : 'error';
                            const resp = rpcUploadMaterializeError(requestId, fnKey, message, t0);
                            ws.send(JSON.stringify(resp));
                            await invokeAudit({
                                fnKey,
                                requestId,
                                status: 'error',
                                transport: 'websocket',
                                socketId: connKey,
                                durationMs: performance.now() - t0,
                            });
                            return;
                        }
                    }
                    const pre = await runPreInvokes({
                        fnKey,
                        args,
                        socketId: connKey,
                        transport: 'websocket',
                        requestId,
                        authToken: clientWireToken,
                    });
                    if (pre) {
                        ws.send(JSON.stringify(pre));
                        await invokeAudit({
                            fnKey,
                            requestId: pre.requestId,
                            status: pre.status,
                            transport: 'websocket',
                            socketId: connKey,
                            durationMs: performance.now() - t0,
                        });
                        return;
                    }
                    if (!invokeRateLimitAllow(connKey)) {
                        const resp = rpcRateLimitedResponse(requestId, fnKey, invokeRateLimitRetryAfterMs(connKey));
                        ws.send(JSON.stringify(resp));
                        await invokeAudit({
                            fnKey,
                            requestId,
                            status: 'error',
                            transport: 'websocket',
                            socketId: connKey,
                            durationMs: performance.now() - t0,
                        });
                        return;
                    }
                    const resp = await executeRPC({
                        requestId,
                        fnKey,
                        args,
                    });
                    ws.send(JSON.stringify(resp));
                    await invokeAudit({
                        fnKey,
                        requestId,
                        status: resp.status,
                        transport: 'websocket',
                        socketId: connKey,
                        durationMs: performance.now() - t0,
                    });
                    return;
                }
                if (m.type === 'SESSION_CREATE') {
                    const requestId = typeof m.requestId === 'string' ? m.requestId : randomUUID();
                    const sessionKey = typeof m.sessionKey === 'string' ? m.sessionKey : undefined;
                    try {
                        const { sessionId } = sessionCreate(sessionKey);
                        ws.send(JSON.stringify({
                            type: 'SESSION_STATE',
                            protocolVersion: PROTOCOL_VERSION,
                            requestId,
                            sessionId,
                            data: {},
                        }));
                    }
                    catch (e) {
                        const msg = e instanceof Error ? e.message : 'SESSION_CREATE_FAILED';
                        ws.send(JSON.stringify({ type: 'SESSION_ERROR', protocolVersion: PROTOCOL_VERSION, requestId, message: msg }));
                    }
                    return;
                }
                if (m.type === 'SESSION_STEP') {
                    const requestId = typeof m.requestId === 'string' ? m.requestId : randomUUID();
                    const sessionId = typeof m.sessionId === 'string' ? m.sessionId : '';
                    const step = typeof m.step === 'string' ? m.step : '';
                    if (!sessionId || !step) {
                        ws.send(JSON.stringify({
                            type: 'SESSION_ERROR',
                            protocolVersion: PROTOCOL_VERSION,
                            requestId,
                            message: 'sessionId and step are required',
                        }));
                        return;
                    }
                    try {
                        const { data } = sessionStep(sessionId, step, m.payload);
                        ws.send(JSON.stringify({
                            type: 'SESSION_STATE',
                            protocolVersion: PROTOCOL_VERSION,
                            requestId,
                            sessionId,
                            data,
                        }));
                    }
                    catch (e) {
                        const msg = e instanceof Error ? e.message : 'SESSION_STEP_FAILED';
                        ws.send(JSON.stringify({
                            type: 'SESSION_ERROR',
                            protocolVersion: PROTOCOL_VERSION,
                            requestId,
                            message: msg,
                        }));
                    }
                    return;
                }
                if (m.type === 'COVERAGE_REQUEST') {
                    const roots = Array.isArray(options.scanRoots)
                        ? options.scanRoots.filter((x) => typeof x === 'string')
                        : [];
                    if (roots.length === 0) {
                        ws.send(JSON.stringify({
                            type: 'COVERAGE_REPORT',
                            protocolVersion: PROTOCOL_VERSION,
                            error: 'scanRoots_missing',
                        }));
                        return;
                    }
                    const { report } = computeCoverageReport({
                        scanRoots: roots,
                        registrySnapshot,
                    });
                    ws.send(JSON.stringify({
                        type: 'COVERAGE_REPORT',
                        protocolVersion: PROTOCOL_VERSION,
                        report: { ...report, meta: { ...report.meta, protocolVersion: PROTOCOL_VERSION } },
                    }));
                    return;
                }
            });
            ws.on('close', () => {
                wsClients.delete(ws);
                uploadStore?.abort(connKey);
            });
        });
        wss.on('listening', () => {
            const addr = wss.address();
            resolve({
                port: addr.port,
                close: () => new Promise((res, rej) => {
                    wss.close((err) => {
                        if (err)
                            rej(err);
                        else
                            res();
                    });
                }),
            });
        });
        wss.on('error', reject);
    });
}
//# sourceMappingURL=ws-server.js.map