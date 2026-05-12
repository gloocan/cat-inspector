import type { IncomingHttpHeaders } from 'node:http';
import WebSocket from 'ws';
import type { ApiResponseEvent, ErrorThrownEvent, JobProgressWireEvent, MiddlewareNextEvent, ReturnResolvedEvent } from './types.js';
export declare const Registry: Map<string, import("./types.js").RegistryEntry>;
/** Live instances for RPC calls */
export declare const InstanceRegistry: Map<string, unknown>;
/**
 * Instances resolved implicitly (via resolver or constructor fallback).
 * Kept separate from `InstanceRegistry` so explicit registrations remain visible/distinct.
 */
export declare const AutoInstanceRegistry: Map<string, unknown>;
export declare const ClassConstructorRegistry: Map<string, new (...args: any[]) => any>;
export declare function registerClassConstructor(className: string, ctor: new (...args: any[]) => any): void;
export declare function resolveInstanceForClassName(className: string): unknown | null;
export declare const ActiveContext: {
    stack: string[];
    push(key: string): void;
    pop(): string | null;
    set(key: string): void;
    get(): string | null;
    clear(): void;
};
export declare const ApiContext: {
    currentEndpoint: string | null;
    set(key: string): void;
    get(): string | null;
    clear(): void;
};
export declare const LabelCapture: {
    current: string | null;
    capture(label: string): void;
    read(): string | null;
    clear(): void;
};
export declare const ErrorCapture: {
    current: {
        label: string;
        error: Error;
    } | null;
    capture(label: string, error: Error): void;
    read(): {
        label: string;
        error: Error;
    } | null;
    hasCurrent(): boolean;
    clear(): void;
};
export declare function clearExpressApiInvokeCapture(): void;
export declare function recordExpressApiInvokeCapture(endpointKey: string, payload: {
    label: string;
    statusCode: number;
    body: unknown;
}): void;
export declare function readExpressApiInvokeCapture(endpointKey: string): {
    label: string;
    statusCode: number;
    body: unknown;
} | undefined;
export declare const wsClients: Set<WebSocket>;
export type InspectorBroadcastSource = 'rpc' | 'http';
export type InspectorBroadcastStore = {
    socketId: string;
    source: InspectorBroadcastSource;
    /**
     * Optional per-request correlation id.
     * Used by HTTP inspector to group events belonging to a single inbound request.
     */
    correlationId?: string;
    /**
     * Optional: which pipeline handler is currently executing (middleware or endpoint).
     * Used to tag API responses so the UI can attribute early responses to the correct middleware.
     */
    producerFnKey?: string | null;
};
export declare function setBroadcastSink(fn: ((data: object) => void) | null): void;
export declare function clearBroadcastSink(): void;
export declare function getInspectorBroadcastStore(): InspectorBroadcastStore | undefined;
/**
 * Correlate subsequent `broadcast()` calls with a Socket.IO tab (or other sink).
 * Default source `rpc` (not gated by HTTP inspector toggle). Use `http` from REST middleware.
 */
export declare function runWithInspectorBroadcastTarget<T>(socketId: string, fn: () => T, options?: {
    source?: InspectorBroadcastSource;
    correlationId?: string;
}): T;
/**
 * Run within the current inspector broadcast store but with an updated producer fnKey.
 * No-op if there is no active inspector store (i.e. no X-Socket-Id correlation).
 */
export declare function runWithProducerFnKey<T>(producerFnKey: string | null, fn: () => T): T;
export declare const INSPECTOR_SOCKET_ID_HEADER = "x-socket-id";
/** Read Socket.IO correlation id from Express / Node request headers */
export declare function readInspectorSocketIdFromHeaders(headers: IncomingHttpHeaders): string | undefined;
export declare function broadcast(data: object): void;
export declare function broadcastReturnResolved(payload: Omit<ReturnResolvedEvent, 'protocolVersion' | 'timestamp'>): void;
export declare function broadcastErrorThrown(payload: Omit<ErrorThrownEvent, 'protocolVersion' | 'timestamp'>): void;
export declare function broadcastApiResponse(payload: Omit<ApiResponseEvent, 'protocolVersion' | 'timestamp'>): void;
export declare function broadcastMiddlewareNext(payload: Omit<MiddlewareNextEvent, 'protocolVersion' | 'timestamp'>): void;
export declare function broadcastJobProgress(payload: Omit<JobProgressWireEvent, 'event' | 'protocolVersion' | 'timestamp'>): void;
/** Attach or clear a JSON Schema used by QA to validate RPC `result` for this `fnKey`. */
export declare function registerReturnJsonSchema(fnKey: string, schema: Record<string, unknown> | null): void;
/** Attach or clear a JSON Schema used to validate RPC `args` (whole tuple) for this `fnKey`. */
export declare function registerParamsJsonSchema(fnKey: string, schema: Record<string, unknown> | null): void;
export declare function registerInstance(instance: unknown): void;
/** Test-only: reset in-memory state */
export declare function resetInspectorState(): void;
//# sourceMappingURL=registry-state.d.ts.map