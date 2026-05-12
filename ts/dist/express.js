import http from 'node:http';
import { readInspectorHttpMeta } from './express-inspector-correlation.js';
import { ApiContext, Registry, runWithInspectorBroadcastTarget, runWithProducerFnKey } from './registry-state.js';
function isThenable(v) {
    return Boolean(v && typeof v.then === 'function');
}
export function pipelineIdForRoute(method, route) {
    return `${method.toUpperCase()} ${route}`;
}
export function registerCatPipeline(router, method, route, handlers) {
    const pid = pipelineIdForRoute(method, route);
    const endpointHandler = handlers[handlers.length - 1];
    let endpointFnKey = null;
    handlers.forEach((handler, index) => {
        if (typeof handler !== 'function')
            return;
        const isLast = index === handlers.length - 1;
        Registry.forEach((entry) => {
            if (entry.originalFn === handler &&
                (entry.mode === 'api_candidate' || entry.mode === 'api')) {
                entry.route = route;
                entry.httpMethod = method.toUpperCase();
                entry.pipelineId = pid;
                entry.pipelineIndex = index;
                // In a pipeline, treat the final handler as the endpoint ("api"),
                // and prior handlers as middleware ("api_candidate").
                entry.mode = isLast ? 'api' : 'api_candidate';
            }
        });
        if (handler === endpointHandler) {
            for (const [k, e] of Registry.entries()) {
                if (e.originalFn === handler) {
                    endpointFnKey = k;
                    break;
                }
            }
        }
    });
    const wrapped = handlers.map((handler) => {
        if (typeof handler !== 'function')
            return handler;
        let fnKey = null;
        for (const [k, e] of Registry.entries()) {
            if (e.originalFn === handler) {
                fnKey = k;
                break;
            }
        }
        return function wrappedPipelineHandler(...args) {
            const req = args[0];
            const res = args[1];
            const next = args[2];
            const runInner = () => {
                // Ensure ApiReturn broadcasts are correlated to the endpoint for HTTP requests.
                if (endpointFnKey)
                    ApiContext.set(endpointFnKey);
                return runWithProducerFnKey(fnKey, () => {
                    if (typeof next !== 'function') {
                        // Express route handler (req,res) style
                        return handler.apply(this, args);
                    }
                    const wrappedNext = (...nextArgs) => {
                        return next(...nextArgs);
                    };
                    return handler.call(this, req, res, wrappedNext);
                });
            };
            const runWithHttpInspector = () => {
                const meta = req ? readInspectorHttpMeta(req) : undefined;
                if (meta) {
                    return runWithInspectorBroadcastTarget(meta.socketId, runInner, {
                        source: 'http',
                        correlationId: meta.correlationId,
                    });
                }
                return runInner();
            };
            try {
                const out = runWithHttpInspector();
                if (isThenable(out)) {
                    return Promise.resolve(out).finally(() => {
                        ApiContext.clear();
                    });
                }
                ApiContext.clear();
                return out;
            }
            catch (err) {
                ApiContext.clear();
                throw err;
            }
        };
    });
    router[method](route, ...wrapped);
}
export function createCorrelationMiddleware() {
    return function correlationMiddleware(req, res, next) {
        const header = req.header('x-correlation-id') ?? req.header('x-request-id') ?? undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = req;
        if (r.correlationId === undefined)
            r.correlationId = header ?? `${Date.now()}`;
        if (!res.headersSent) {
            try {
                res.setHeader('X-Correlation-Id', String(r.correlationId));
            }
            catch {
                // ignore
            }
        }
        next();
    };
}
/**
 * Run one in-process HTTP request against an Express `app` (local `127.0.0.1` ephemeral port).
 * Useful for QA / tests that need real `req`/`res` middleware without deploying.
 */
export async function invokeExpressSynthetic(app, opts) {
    const server = http.createServer(app);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    const port = addr.port;
    const path = opts.path.startsWith('/') ? opts.path : `/${opts.path}`;
    const url = `http://127.0.0.1:${port}${path}`;
    try {
        const method = opts.method.toUpperCase();
        const headers = new Headers();
        for (const [k, v] of Object.entries(opts.headers ?? {})) {
            headers.set(k, v);
        }
        const init = { method, headers };
        if (opts.body !== undefined && method !== 'GET' && method !== 'HEAD') {
            if (!headers.has('content-type')) {
                headers.set('content-type', 'application/json');
            }
            init.body = JSON.stringify(opts.body);
        }
        const resp = await fetch(url, init);
        const bodyText = await resp.text();
        let bodyJson = bodyText;
        if (bodyText) {
            try {
                bodyJson = JSON.parse(bodyText);
            }
            catch {
                bodyJson = bodyText;
            }
        }
        else {
            bodyJson = null;
        }
        const outHeaders = {};
        resp.headers.forEach((v, k) => {
            outHeaders[k] = v;
        });
        return { statusCode: resp.status, headers: outHeaders, bodyText, bodyJson };
    }
    finally {
        await new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        });
    }
}
//# sourceMappingURL=express.js.map