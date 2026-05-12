import { AsyncLocalStorage } from 'node:async_hooks';
import WebSocket from 'ws';
import { resetInvokePolicy } from './invoke-policy.js';
import { resetInvokeTimeoutMs } from './invoke-runtime-config.js';
import { clearHttpBridgeRegistry } from './http-bridge-registry.js';
import { resetParamsJsonSchemaValidators } from './validate-params-json-schema.js';
import { resetReturnJsonSchemaValidators } from './validate-return-json-schema.js';
import { resetRpcSerializationConfig } from './serialize-rpc-result.js';
import { resetSessionStore } from './session-store.js';
import { PROTOCOL_VERSION } from './types.js';
export const Registry = new Map();
/** Live instances for RPC calls */
export const InstanceRegistry = new Map();
/**
 * Instances resolved implicitly (via resolver or constructor fallback).
 * Kept separate from `InstanceRegistry` so explicit registrations remain visible/distinct.
 */
export const AutoInstanceRegistry = new Map();
export const ClassConstructorRegistry = new Map();
export function registerClassConstructor(className, ctor) {
    if (!className)
        return;
    const existing = ClassConstructorRegistry.get(className);
    if (existing) {
        // Idempotent: allow repeated registration of the same constructor.
        if (existing === ctor)
            return;
        throw new Error(`registerClassConstructor: duplicate className "${className}"`);
    }
    ClassConstructorRegistry.set(className, ctor);
}
export function resolveInstanceForClassName(className) {
    const explicit = InstanceRegistry.get(className);
    if (explicit)
        return explicit;
    const cached = AutoInstanceRegistry.get(className);
    if (cached)
        return cached;
    const ctor = ClassConstructorRegistry.get(className);
    if (ctor) {
        const created = new ctor();
        AutoInstanceRegistry.set(className, created);
        return created;
    }
    return null;
}
export const ActiveContext = {
    stack: [],
    push(key) {
        this.stack.push(key);
    },
    pop() {
        const v = this.stack.pop();
        return v ?? null;
    },
    set(key) {
        // Back-compat alias (prefer push/pop).
        this.push(key);
    },
    get() {
        const v = this.stack[this.stack.length - 1];
        return v ?? null;
    },
    clear() {
        // Back-compat: clear entire stack (reset state).
        this.stack = [];
    },
};
export const ApiContext = {
    currentEndpoint: null,
    set(key) {
        this.currentEndpoint = key;
    },
    get() {
        return this.currentEndpoint;
    },
    clear() {
        this.currentEndpoint = null;
    },
};
export const LabelCapture = {
    current: null,
    capture(label) {
        this.current = label;
    },
    read() {
        return this.current;
    },
    clear() {
        this.current = null;
    },
};
export const ErrorCapture = {
    current: null,
    capture(label, error) {
        this.current = { label, error };
    },
    read() {
        return this.current;
    },
    hasCurrent() {
        return this.current !== null;
    },
    clear() {
        this.current = null;
    },
};
/**
 * Last `ApiReturn` payload per endpoint `fnKey`, for correlating express playground RPC
 * with controller-level API semantics. Cleared per express invoke and on inspector reset.
 */
const expressApiInvokeCaptureByEndpoint = new Map();
export function clearExpressApiInvokeCapture() {
    expressApiInvokeCaptureByEndpoint.clear();
}
export function recordExpressApiInvokeCapture(endpointKey, payload) {
    expressApiInvokeCaptureByEndpoint.set(endpointKey, payload);
}
export function readExpressApiInvokeCapture(endpointKey) {
    return expressApiInvokeCaptureByEndpoint.get(endpointKey);
}
export const wsClients = new Set();
const inspectorBroadcastAls = new AsyncLocalStorage();
/** Optional second fan-out (e.g. Socket.IO); receives same object as native ws broadcast */
let broadcastSink = null;
export function setBroadcastSink(fn) {
    broadcastSink = fn;
}
export function clearBroadcastSink() {
    broadcastSink = null;
}
export function getInspectorBroadcastStore() {
    return inspectorBroadcastAls.getStore();
}
/**
 * Correlate subsequent `broadcast()` calls with a Socket.IO tab (or other sink).
 * Default source `rpc` (not gated by HTTP inspector toggle). Use `http` from REST middleware.
 */
export function runWithInspectorBroadcastTarget(socketId, fn, options) {
    const source = options?.source ?? 'rpc';
    return inspectorBroadcastAls.run({ socketId, source, correlationId: options?.correlationId }, fn);
}
/**
 * Run within the current inspector broadcast store but with an updated producer fnKey.
 * No-op if there is no active inspector store (i.e. no X-Socket-Id correlation).
 */
export function runWithProducerFnKey(producerFnKey, fn) {
    const store = getInspectorBroadcastStore();
    if (!store)
        return fn();
    return inspectorBroadcastAls.run({ ...store, producerFnKey }, fn);
}
export const INSPECTOR_SOCKET_ID_HEADER = 'x-socket-id';
function firstHeaderValue(value) {
    if (value === undefined)
        return undefined;
    const s = Array.isArray(value) ? value[0] : value;
    const t = typeof s === 'string' ? s.trim() : '';
    return t.length > 0 ? t : undefined;
}
/** Read Socket.IO correlation id from Express / Node request headers */
export function readInspectorSocketIdFromHeaders(headers) {
    return firstHeaderValue(headers[INSPECTOR_SOCKET_ID_HEADER]);
}
export function broadcast(data) {
    const msg = JSON.stringify(data);
    for (const client of wsClients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    }
    if (broadcastSink) {
        try {
            broadcastSink(data);
        }
        catch {
            /* sink errors must not break native ws path */
        }
    }
}
export function broadcastReturnResolved(payload) {
    const store = getInspectorBroadcastStore();
    const correlationId = payload.correlationId ?? store?.correlationId;
    broadcast({
        ...payload,
        ...(correlationId ? { correlationId } : {}),
        protocolVersion: PROTOCOL_VERSION,
        timestamp: new Date().toISOString(),
    });
}
export function broadcastErrorThrown(payload) {
    const store = getInspectorBroadcastStore();
    const correlationId = payload.correlationId ?? store?.correlationId;
    broadcast({
        ...payload,
        ...(correlationId ? { correlationId } : {}),
        protocolVersion: PROTOCOL_VERSION,
        timestamp: new Date().toISOString(),
    });
}
export function broadcastApiResponse(payload) {
    const store = getInspectorBroadcastStore();
    const correlationId = payload.correlationId ?? store?.correlationId;
    const producerFnKey = 'producerFnKey' in payload
        ? payload.producerFnKey
        : (store?.producerFnKey ?? undefined);
    let safeBody = undefined;
    if ('body' in payload) {
        // Best-effort, size-limited JSON clone for inspector display.
        // Prevents huge payloads from spamming the live inspector feed.
        try {
            const asJson = JSON.stringify(payload.body);
            if (asJson.length <= 10_000) {
                safeBody = JSON.parse(asJson);
            }
            else {
                safeBody = { __omitted: 'body_too_large', bytes: asJson.length };
            }
        }
        catch {
            safeBody = { __omitted: 'body_unserializable' };
        }
    }
    const out = {
        ...payload,
        ...(correlationId ? { correlationId } : {}),
        ...(producerFnKey !== undefined ? { producerFnKey } : {}),
        ...(safeBody !== undefined ? { body: safeBody } : {}),
        protocolVersion: PROTOCOL_VERSION,
        timestamp: new Date().toISOString(),
    };
    broadcast(out);
}
export function broadcastMiddlewareNext(payload) {
    const store = getInspectorBroadcastStore();
    const correlationId = payload.correlationId ?? store?.correlationId;
    broadcast({
        ...payload,
        ...(correlationId ? { correlationId } : {}),
        protocolVersion: PROTOCOL_VERSION,
        timestamp: new Date().toISOString(),
    });
}
export function broadcastJobProgress(payload) {
    broadcast({
        event: 'JOB_PROGRESS',
        protocolVersion: PROTOCOL_VERSION,
        timestamp: new Date().toISOString(),
        ...payload,
    });
}
/** Attach or clear a JSON Schema used by QA to validate RPC `result` for this `fnKey`. */
export function registerReturnJsonSchema(fnKey, schema) {
    const entry = Registry.get(fnKey);
    if (!entry) {
        throw new Error(`registerReturnJsonSchema: unknown fnKey "${fnKey}"`);
    }
    entry.returnJsonSchema = schema;
}
/** Attach or clear a JSON Schema used to validate RPC `args` (whole tuple) for this `fnKey`. */
export function registerParamsJsonSchema(fnKey, schema) {
    const entry = Registry.get(fnKey);
    if (!entry) {
        throw new Error(`registerParamsJsonSchema: unknown fnKey "${fnKey}"`);
    }
    entry.paramsJsonSchema = schema;
}
export function registerInstance(instance) {
    if (typeof instance !== 'object' && typeof instance !== 'function')
        return;
    const name = typeof instance === 'object'
        ? instance.constructor?.name
        : instance.name;
    if (!name)
        return;
    if (InstanceRegistry.has(name)) {
        throw new Error(`registerInstance: duplicate instance name "${name}" (already registered). Use unique class names or register only once.`);
    }
    InstanceRegistry.set(name, instance);
}
/** Test-only: reset in-memory state */
export function resetInspectorState() {
    clearHttpBridgeRegistry();
    resetReturnJsonSchemaValidators();
    resetParamsJsonSchemaValidators();
    Registry.clear();
    InstanceRegistry.clear();
    AutoInstanceRegistry.clear();
    ClassConstructorRegistry.clear();
    ActiveContext.clear();
    ApiContext.clear();
    LabelCapture.clear();
    ErrorCapture.clear();
    clearExpressApiInvokeCapture();
    wsClients.clear();
    clearBroadcastSink();
    resetRpcSerializationConfig();
    resetInvokePolicy();
    resetInvokeTimeoutMs();
    resetSessionStore();
}
//# sourceMappingURL=registry-state.js.map