export declare function resetSessionStore(): void;
export declare function sessionCreate(sessionKey?: string): {
    sessionId: string;
};
export declare function sessionStep(sessionId: string, step: string, payload: unknown): {
    sessionId: string;
    data: Record<string, unknown>;
};
//# sourceMappingURL=session-store.d.ts.map