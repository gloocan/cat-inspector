import { Registry } from '../registry-state.js';
function dedupePush(arr, key) {
    if (!arr.includes(key))
        arr.push(key);
}
export function resolveRelationships() {
    const allKeys = [...Registry.keys()];
    Registry.forEach((meta, fnKey) => {
        for (const otherKey of allKeys) {
            if (otherKey === fnKey)
                continue;
            const methodName = otherKey.split('.')[1];
            if (!methodName)
                continue;
            if (meta.body.includes(methodName)) {
                const other = Registry.get(otherKey);
                if (!other)
                    continue;
                if (meta.mode === 'service' && other.mode === 'service') {
                    dedupePush(meta.children, otherKey);
                    dedupePush(other.parents, fnKey);
                }
                if (meta.mode === 'api' && other.mode === 'service') {
                    dedupePush(meta.serviceLinks, otherKey);
                }
            }
        }
    });
}
export function analyzeRelationships() {
    const roots = [];
    const leaves = [];
    const middle = [];
    Registry.forEach((meta, key) => {
        const hasParents = meta.parents.length > 0;
        const hasChildren = meta.children.length > 0;
        if (!hasParents && hasChildren)
            roots.push(key);
        if (hasParents && !hasChildren)
            leaves.push(key);
        if (hasParents && hasChildren)
            middle.push(key);
    });
    return { roots, leaves, middle };
}
export function buildTree(fnKey, visited = new Set()) {
    if (visited.has(fnKey))
        return { key: fnKey, circular: true };
    visited.add(fnKey);
    const meta = Registry.get(fnKey);
    if (!meta)
        return { key: fnKey, error: 'not found' };
    return {
        key: fnKey,
        mode: meta.mode,
        className: meta.className,
        method: meta.method,
        params: meta.params,
        declaredReturn: meta.declaredReturn,
        returns: meta.returns,
        errors: meta.errors,
        apiResponses: meta.apiResponses,
        route: meta.route,
        httpMethod: meta.httpMethod,
        pipelineId: meta.pipelineId,
        pipelineIndex: meta.pipelineIndex,
        serviceLinks: meta.serviceLinks,
        isRoot: meta.parents.length === 0,
        isLeaf: meta.children.length === 0,
        children: meta.children.map((child) => buildTree(child, visited)),
    };
}
export function groupApiPipelines() {
    const grouped = {};
    Registry.forEach((meta, fnKey) => {
        if (meta.pipelineId === null || meta.pipelineIndex === null)
            return;
        if (!grouped[meta.pipelineId])
            grouped[meta.pipelineId] = [];
        grouped[meta.pipelineId].push(fnKey);
    });
    for (const [pid, keys] of Object.entries(grouped)) {
        keys.sort((a, b) => {
            const ai = Registry.get(a)?.pipelineIndex ?? 0;
            const bi = Registry.get(b)?.pipelineIndex ?? 0;
            return ai - bi;
        });
        grouped[pid] = keys;
    }
    return grouped;
}
//# sourceMappingURL=relationships.js.map