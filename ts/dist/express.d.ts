import type { Express, NextFunction, Request, Response, Router } from 'express';
export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';
export declare function pipelineIdForRoute(method: string, route: string): string;
export declare function registerCatPipeline(router: Router, method: HttpMethod, route: string, handlers: readonly ((...args: any[]) => any)[]): void;
export declare function createCorrelationMiddleware(): (req: Request, res: Response, next: NextFunction) => void;
/**
 * Run one in-process HTTP request against an Express `app` (local `127.0.0.1` ephemeral port).
 * Useful for QA / tests that need real `req`/`res` middleware without deploying.
 */
export declare function invokeExpressSynthetic(app: Express, opts: {
    method: HttpMethod;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
}): Promise<{
    statusCode: number;
    headers: Record<string, string>;
    bodyText: string;
    bodyJson: unknown;
}>;
//# sourceMappingURL=express.d.ts.map