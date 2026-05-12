import { randomUUID } from 'node:crypto'

type SessionRow = { sessionKey?: string; data: Record<string, unknown> }

const sessions = new Map<string, SessionRow>()

export function resetSessionStore(): void {
	sessions.clear()
}

export function sessionCreate(sessionKey?: string): { sessionId: string } {
	const sessionId = randomUUID()
	sessions.set(sessionId, { sessionKey, data: {} })
	return { sessionId }
}

export function sessionStep(
	sessionId: string,
	step: string,
	payload: unknown,
): { sessionId: string; data: Record<string, unknown> } {
	const row = sessions.get(sessionId)
	if (!row) {
		throw new Error(`SESSION_NOT_FOUND: ${sessionId}`)
	}
	row.data[step] = payload === undefined ? true : payload
	return { sessionId, data: { ...row.data } }
}
