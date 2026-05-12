/**
 * Minimal req/res/next for exercising Cat Express handlers over Socket.IO.
 * Headers should use lower-case keys where possible (Express normalizes).
 */
export function createExpressPlaygroundMocks(payload) {
    const headers = {};
    for (const [k, v] of Object.entries(payload.headers ?? {})) {
        headers[k.toLowerCase()] = String(v);
    }
    let statusCode = null;
    let body = undefined;
    const res = {
        status(code) {
            statusCode = code;
            return res;
        },
        json(obj) {
            body = obj;
            return res;
        },
        send(data) {
            body = data;
            return res;
        },
    };
    let nextCalled = false;
    let nextError = null;
    const next = ((err) => {
        nextCalled = true;
        nextError = err === undefined ? null : err;
    });
    const req = {
        headers,
        body: payload.body,
        file: payload.file,
        files: payload.files,
        method: payload.method ?? 'POST',
        path: payload.path ?? '/api/run',
        header(name) {
            return headers[name.toLowerCase()];
        },
    };
    return {
        req,
        res,
        next,
        getCapture: () => ({
            statusCode,
            body,
            nextCalled,
            nextError,
        }),
    };
}
//# sourceMappingURL=express-playground-mocks.js.map