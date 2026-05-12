import type { NextFunction, Request, Response } from 'express';
export type ExpressPlaygroundPayload = {
    headers?: Record<string, string>;
    body?: unknown;
    method?: string;
    path?: string;
    /** Optional: attach a single file (multer-like) */
    file?: unknown;
    /** Optional: attach multiple files by field name (multer-like) */
    files?: unknown;
};
export type ExpressPlaygroundCapture = {
    statusCode: number | null;
    body: unknown;
    nextCalled: boolean;
    nextError: unknown | null;
};
/**
 * Minimal req/res/next for exercising Cat Express handlers over Socket.IO.
 * Headers should use lower-case keys where possible (Express normalizes).
 */
export declare function createExpressPlaygroundMocks(payload: ExpressPlaygroundPayload): {
    req: Request;
    res: Response;
    next: NextFunction;
    getCapture: () => ExpressPlaygroundCapture;
};
//# sourceMappingURL=express-playground-mocks.d.ts.map