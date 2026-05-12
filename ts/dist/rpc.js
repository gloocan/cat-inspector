import { performance } from 'node:perf_hooks';
import { ActiveContext, ApiContext, ErrorCapture, LabelCapture, Registry, broadcast, resolveInstanceForClassName, } from './registry-state.js';
import { getHttpBridgeSpec, runHttpBridgeInvoke } from './http-bridge-registry.js';
import { getShape, getType } from './return.js';
import { getInvokeTimeoutMs } from './invoke-runtime-config.js';
import { getRpcSerializationConfig, maybeSerializeRpcResult } from './serialize-rpc-result.js';
import { extractArtifactsFromResult } from './artifact-helpers.js';
import { validateArgsAgainstParamsJsonSchema } from './validate-params-json-schema.js';
import { validateResultAgainstReturnJsonSchema } from './validate-return-json-schema.js';
function errResp(requestId, fnKey, label, message, start, layer, stack = null, code) {
    const errCode = code ?? label;
    return {
        type: 'RPC_RESPONSE',
        requestId,
        fnKey,
        status: 'error',
        result: null,
        returnType: 'error',
        returnShape: null,
        label,
        duration: `${(performance.now() - start).toFixed(2)}ms`,
        error: { message, stack, layer, code: errCode },
    };
}
async function withInvokeTimeout(promise, ms) {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error('RPC invoke exceeded invokeTimeoutMs'));
        }, ms);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
    }
}
function validateParamsSchemaIfConfigured(requestId, fnKey, entry, args, start) {
    const ser = getRpcSerializationConfig();
    if (!ser.validateParamsJsonSchema || !entry.paramsJsonSchema)
        return null;
    const v = validateArgsAgainstParamsJsonSchema(fnKey, entry.paramsJsonSchema, args);
    if (v.ok)
        return null;
    return errResp(requestId, fnKey, 'INPUT_SCHEMA_INVALID', v.message, start, 'validation', null, 'INPUT_SCHEMA_INVALID');
}
function validateReturnSchemaIfConfigured(requestId, fnKey, entry, result, start) {
    const ser = getRpcSerializationConfig();
    if (!ser.enabled || !ser.validateReturnJsonSchema || !entry.returnJsonSchema)
        return null;
    const v = validateResultAgainstReturnJsonSchema(fnKey, entry.returnJsonSchema, result);
    if (v.ok)
        return null;
    return errResp(requestId, fnKey, 'RETURN_SCHEMA_INVALID', v.message, start, 'validation', null, 'RETURN_SCHEMA_INVALID');
}
async function executeHttpBridgeRequest(request, entry, start) {
    const { requestId, fnKey, args } = request;
    const spec = getHttpBridgeSpec(fnKey);
    if (!spec) {
        return errResp(requestId, fnKey, 'HTTP_BRIDGE_NOT_CONFIGURED', `call registerHttpBridgeRoute for ${fnKey}`, start, 'validation', null, 'HTTP_BRIDGE_NOT_CONFIGURED');
    }
    LabelCapture.clear();
    ErrorCapture.clear();
    try {
        const isApi = entry.mode === 'api';
        if (isApi)
            ApiContext.set(fnKey);
        else
            ActiveContext.push(fnKey);
        const invokeMs = getInvokeTimeoutMs();
        const httpP = runHttpBridgeInvoke(spec, args);
        let httpOut;
        try {
            httpOut =
                invokeMs !== undefined ? await withInvokeTimeout(httpP, invokeMs) : await httpP;
        }
        catch (timeoutErr) {
            const msg = timeoutErr instanceof Error ? timeoutErr.message : 'timeout';
            if (msg.includes('invokeTimeoutMs') || msg.includes('exceeded')) {
                broadcast({
                    event: 'RPC_EXECUTED',
                    requestId,
                    fnKey,
                    label: 'INVOKE_TIMEOUT',
                    status: 'error',
                    duration: `${(performance.now() - start).toFixed(2)}ms`,
                });
                return errResp(requestId, fnKey, 'INVOKE_TIMEOUT', `handler exceeded invokeTimeoutMs (${invokeMs}ms)`, start, 'validation', null, 'INVOKE_TIMEOUT');
            }
            throw timeoutErr;
        }
        const rawResult = {
            http: {
                statusCode: httpOut.statusCode,
                headers: httpOut.headers,
                body: httpOut.body,
            },
        };
        const serialized = maybeSerializeRpcResult(rawResult);
        if (!serialized.ok) {
            const duration = `${(performance.now() - start).toFixed(2)}ms`;
            broadcast({
                event: 'RPC_EXECUTED',
                requestId,
                fnKey,
                label: 'RESULT_NOT_SERIALIZABLE',
                status: 'error',
                duration,
            });
            return errResp(requestId, fnKey, 'RESULT_NOT_SERIALIZABLE', serialized.message, start, 'validation', null, 'RESULT_NOT_SERIALIZABLE');
        }
        const result = serialized.value;
        const schemaHit = validateReturnSchemaIfConfigured(requestId, fnKey, entry, result, start);
        if (schemaHit)
            return schemaHit;
        const duration = `${(performance.now() - start).toFixed(2)}ms`;
        broadcast({
            event: 'RPC_EXECUTED',
            requestId,
            fnKey,
            label: LabelCapture.read(),
            status: 'ok',
            duration,
        });
        return buildOkRpcResponse(requestId, fnKey, result, start);
    }
    catch (err) {
        const duration = `${(performance.now() - start).toFixed(2)}ms`;
        const captured = ErrorCapture.read();
        const label = captured?.label ?? 'UNEXPECTED_ERROR';
        const layer = captured ? 'expected' : 'unexpected';
        broadcast({
            event: 'RPC_EXECUTED',
            requestId,
            fnKey,
            label,
            status: 'error',
            duration,
        });
        const message = err instanceof Error ? err.message : 'error';
        const stack = err instanceof Error ? err.stack ?? null : null;
        const errCode = layer === 'unexpected' ? 'UNEXPECTED_ERROR' : label;
        return errResp(requestId, fnKey, label, message, start, layer, stack, errCode);
    }
    finally {
        ApiContext.clear();
        ActiveContext.pop();
    }
}
function buildOkRpcResponse(requestId, fnKey, result, start) {
    const artifacts = extractArtifactsFromResult(result);
    const duration = `${(performance.now() - start).toFixed(2)}ms`;
    const base = {
        type: 'RPC_RESPONSE',
        requestId,
        fnKey,
        status: 'ok',
        result,
        returnType: getType(result),
        returnShape: getShape(result),
        label: LabelCapture.read(),
        duration,
        error: null,
    };
    if (artifacts)
        base.artifacts = artifacts;
    return base;
}
export async function executeRPC(request) {
    const { requestId, fnKey, args } = request;
    const start = performance.now();
    if (!fnKey.includes('.')) {
        return errResp(requestId, fnKey, 'INVALID_FN_KEY', 'must be ClassName.methodName', start, 'validation');
    }
    if (!Registry.has(fnKey)) {
        return errResp(requestId, fnKey, 'FN_NOT_FOUND', `Not found. Available: ${[...Registry.keys()].join(', ')}`, start, 'validation');
    }
    const entry = Registry.get(fnKey);
    const expected = entry.params.length;
    if (args.length !== expected) {
        return errResp(requestId, fnKey, 'WRONG_ARG_COUNT', `Expected ${expected} args, got ${args.length}`, start, 'validation');
    }
    const paramsSchemaHit = validateParamsSchemaIfConfigured(requestId, fnKey, entry, args, start);
    if (paramsSchemaHit)
        return paramsSchemaHit;
    if (entry.invokeKind === 'http_synthetic') {
        return await executeHttpBridgeRequest({ requestId, fnKey, args }, entry, start);
    }
    const [className, methodName] = fnKey.split('.');
    const maybeFn = entry.style === 'function'
        ? entry.originalFn
        : // eslint-disable-next-line @typescript-eslint/no-explicit-any
            resolveInstanceForClassName(className)?.[methodName];
    if (typeof maybeFn !== 'function') {
        if (entry.style === 'function') {
            return errResp(requestId, fnKey, 'NOT_A_FUNCTION', `${fnKey} not callable`, start, 'validation');
        }
        if (!resolveInstanceForClassName(className)) {
            return errResp(requestId, fnKey, 'NO_INSTANCE', `No instance for ${className}. Ensure the class method is decorated with @Cat (constructor auto-registered) or call registerInstance().`, start, 'validation');
        }
        return errResp(requestId, fnKey, 'NOT_A_FUNCTION', `${methodName} not callable on ${className}`, start, 'validation');
    }
    LabelCapture.clear();
    ErrorCapture.clear();
    try {
        const isApi = entry.mode === 'api';
        if (isApi)
            ApiContext.set(fnKey);
        else
            ActiveContext.push(fnKey);
        const invokeMs = getInvokeTimeoutMs();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const invokePromise = maybeFn(...args);
        let rawResult;
        try {
            rawResult =
                invokeMs !== undefined ? await withInvokeTimeout(invokePromise, invokeMs) : await invokePromise;
        }
        catch (timeoutErr) {
            const msg = timeoutErr instanceof Error ? timeoutErr.message : 'timeout';
            if (msg.includes('invokeTimeoutMs') || msg.includes('exceeded')) {
                broadcast({
                    event: 'RPC_EXECUTED',
                    requestId,
                    fnKey,
                    label: 'INVOKE_TIMEOUT',
                    status: 'error',
                    duration: `${(performance.now() - start).toFixed(2)}ms`,
                });
                return errResp(requestId, fnKey, 'INVOKE_TIMEOUT', `handler exceeded invokeTimeoutMs (${invokeMs}ms)`, start, 'validation', null, 'INVOKE_TIMEOUT');
            }
            throw timeoutErr;
        }
        const serialized = maybeSerializeRpcResult(rawResult);
        if (!serialized.ok) {
            const duration = `${(performance.now() - start).toFixed(2)}ms`;
            broadcast({
                event: 'RPC_EXECUTED',
                requestId,
                fnKey,
                label: 'RESULT_NOT_SERIALIZABLE',
                status: 'error',
                duration,
            });
            return errResp(requestId, fnKey, 'RESULT_NOT_SERIALIZABLE', serialized.message, start, 'validation', null, 'RESULT_NOT_SERIALIZABLE');
        }
        const result = serialized.value;
        const schemaHit = validateReturnSchemaIfConfigured(requestId, fnKey, entry, result, start);
        if (schemaHit)
            return schemaHit;
        const duration = `${(performance.now() - start).toFixed(2)}ms`;
        broadcast({
            event: 'RPC_EXECUTED',
            requestId,
            fnKey,
            label: LabelCapture.read(),
            status: 'ok',
            duration,
        });
        return buildOkRpcResponse(requestId, fnKey, result, start);
    }
    catch (err) {
        const duration = `${(performance.now() - start).toFixed(2)}ms`;
        const captured = ErrorCapture.read();
        const label = captured?.label ?? 'UNEXPECTED_ERROR';
        const layer = captured ? 'expected' : 'unexpected';
        broadcast({
            event: 'RPC_EXECUTED',
            requestId,
            fnKey,
            label,
            status: 'error',
            duration,
        });
        const message = err instanceof Error ? err.message : 'error';
        const stack = err instanceof Error ? err.stack ?? null : null;
        const errCode = layer === 'unexpected' ? 'UNEXPECTED_ERROR' : label;
        return errResp(requestId, fnKey, label, message, start, layer, stack, errCode);
    }
    finally {
        ApiContext.clear();
        ActiveContext.pop();
    }
}
//# sourceMappingURL=rpc.js.map