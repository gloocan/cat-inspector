import { randomUUID } from 'node:crypto';
const sessions = new Map();
export function resetSessionStore() {
    sessions.clear();
}
export function sessionCreate(sessionKey) {
    const sessionId = randomUUID();
    sessions.set(sessionId, { sessionKey, data: {} });
    return { sessionId };
}
export function sessionStep(sessionId, step, payload) {
    const row = sessions.get(sessionId);
    if (!row) {
        throw new Error(`SESSION_NOT_FOUND: ${sessionId}`);
    }
    row.data[step] = payload === undefined ? true : payload;
    return { sessionId, data: { ...row.data } };
}
//# sourceMappingURL=session-store.js.map