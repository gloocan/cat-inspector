import type { RpcResponse } from './types.js';
export type InvokeTransport = 'socket.io' | 'websocket';
export type PreInvokeContext = {
    fnKey: string;
    args: unknown[];
    socketId: string | undefined;
    transport: InvokeTransport;
    /** Present for Socket.IO `rpc:call` and embedded ws `RPC_CALL` when the client supplied a token. */
    requestId?: string;
    /** Socket.IO: `handshake.auth.token`. WebSocket: `?token=` query when present. */
    authToken?: string | undefined;
};
export type PreInvokeHook = (ctx: PreInvokeContext) => void | RpcResponse | Promise<void | RpcResponse>;
export type InvokeAuditEvent = {
    fnKey: string;
    requestId: string;
    status: 'ok' | 'error';
    transport: InvokeTransport;
    socketId: string | undefined;
    durationMs: number;
};
export type InvokeAuditHook = (evt: InvokeAuditEvent) => void | Promise<void>;
export declare function registerPreInvoke(hook: PreInvokeHook): () => void;
export declare function registerInvokeAudit(hook: InvokeAuditHook): () => void;
export declare function configureInvokeRateLimit(opts: {
    maxInvokesPerWindow: number;
    windowMs: number;
} | null): void;
export declare function resetInvokePolicy(): void;
export declare function runPreInvokes(ctx: PreInvokeContext): Promise<RpcResponse | undefined>;
export declare function invokeRateLimitAllow(key: string): boolean;
export declare function invokeRateLimitRetryAfterMs(key: string): number;
export declare function invokeAudit(evt: InvokeAuditEvent): Promise<void>;
//# sourceMappingURL=invoke-policy.d.ts.map