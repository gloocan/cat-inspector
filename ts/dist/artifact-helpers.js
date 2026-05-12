/** Normalize artifact-like objects nested under `result` into `RpcResponse.artifacts` (optional UX helper). */
export function extractArtifactsFromResult(result) {
    if (!result || typeof result !== 'object')
        return undefined;
    const r = result;
    const ex = r.express;
    if (ex && typeof ex === 'object' && 'handlerReturn' in ex) {
        return extractArtifactsFromResult(ex.handlerReturn);
    }
    const raw = r.artifacts;
    if (!Array.isArray(raw))
        return undefined;
    const out = [];
    for (const item of raw) {
        if (item && typeof item === 'object' && typeof item.kind === 'string') {
            out.push(item);
        }
    }
    return out.length > 0 ? out : undefined;
}
//# sourceMappingURL=artifact-helpers.js.map