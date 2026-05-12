/**
 * Build a minimal OpenAPI 3.1 document from a registry snapshot.
 * - Express-backed entries (`route` + `httpMethod`) become real paths.
 * - Every `fnKey` also gets a documented `POST /qa/rpc/{fnKey}` placeholder (not mounted by the SDK).
 */
export function exportRegistryOpenApi(registry, opts) {
    const paths = {};
    for (const [fnKey, e] of Object.entries(registry)) {
        if (e.route && e.httpMethod) {
            const route = e.route.startsWith('/') ? e.route : `/${e.route}`;
            const method = e.httpMethod.toLowerCase();
            if (!paths[route])
                paths[route] = {};
            paths[route][method] = {
                summary: fnKey,
                operationId: fnKey.replace(/[^a-zA-Z0-9_]/g, '_'),
                responses: {
                    '200': { description: 'Handler response (shape varies)' },
                },
            };
        }
        const rpcPath = `/qa/rpc/${encodeURIComponent(fnKey)}`;
        if (!paths[rpcPath]) {
            paths[rpcPath] = {
                post: {
                    summary: `RPC invoke ${fnKey}`,
                    operationId: `rpc_${fnKey.replace(/[^a-zA-Z0-9_]/g, '_')}`,
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['type', 'requestId', 'fnKey', 'args'],
                                    properties: {
                                        type: { const: 'RPC_CALL' },
                                        requestId: { type: 'string' },
                                        fnKey: { const: fnKey },
                                        args: { type: 'array' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        '200': { description: 'RPC_RESPONSE JSON' },
                    },
                },
            };
        }
    }
    return {
        openapi: '3.1.0',
        info: {
            title: opts?.title ?? 'Cat inspector registry',
            version: opts?.version ?? '1.0.0',
        },
        paths,
    };
}
//# sourceMappingURL=registry-to-openapi.js.map