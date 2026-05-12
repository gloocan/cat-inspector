/** Parameter names from Function#toString — no execution */
export declare function extractParamNames(fn: Function): string[];
export declare function getFunctionBody(fn: Function): string;
/**
 * Regex scan for Return("LABEL", ...) — no execution.
 * Supports direct `Return("L", v)` and bundler comma form `(0,Return)("L", v)`.
 */
export declare function extractReturnLabels(body: string): string[];
/**
 * Regex scan for Throw("LABEL", ...) — no execution.
 * Supports direct `Throw("L", err)` and bundler comma form `(0,Throw)("L", err)`.
 */
export declare function extractThrowLabels(body: string): string[];
/**
 * Regex scan for ApiReturn("LABEL", ...) — no execution.
 * Supports direct `ApiReturn("L", ...)` and bundler comma form `(0,ApiReturn)("L", ...)`.
 */
export declare function extractApiReturnLabels(body: string): string[];
//# sourceMappingURL=source-utils.d.ts.map