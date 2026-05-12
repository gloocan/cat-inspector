import type { RpcArtifactRef } from './types.js'

/** Normalize artifact-like objects nested under `result` into `RpcResponse.artifacts` (optional UX helper). */
export function extractArtifactsFromResult(result: unknown): RpcArtifactRef[] | undefined {
	if (!result || typeof result !== 'object') return undefined
	const r = result as Record<string, unknown>
	const ex = r.express
	if (ex && typeof ex === 'object' && 'handlerReturn' in ex) {
		return extractArtifactsFromResult((ex as { handlerReturn?: unknown }).handlerReturn)
	}
	const raw = r.artifacts
	if (!Array.isArray(raw)) return undefined
	const out: RpcArtifactRef[] = []
	for (const item of raw) {
		if (item && typeof item === 'object' && typeof (item as RpcArtifactRef).kind === 'string') {
			out.push(item as RpcArtifactRef)
		}
	}
	return out.length > 0 ? out : undefined
}
