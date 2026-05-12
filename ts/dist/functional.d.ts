export interface CatFunctionOptions {
    method?: string;
    route?: string;
    /**
     * Optional manual type hints (fallback when AST scan isn't run).
     * If provided, overrides default 'unknown' registration types.
     */
    params?: import('./types.js').RegistryParam[];
    declaredReturn?: string;
    /** Optional JSON Schema (draft-07 subset) for the entire positional args array when `validateParamsJsonSchema` is enabled. */
    paramsJsonSchema?: Record<string, unknown>;
}
export declare function cat<T extends (...args: any[]) => any>(fnKey: string, fn: T, options?: CatFunctionOptions): T;
export declare function catModule<T extends Record<string, (...args: any[]) => any>>(moduleName: string, fns: T, options?: Record<string, Pick<CatFunctionOptions, 'params' | 'declaredReturn' | 'paramsJsonSchema'>>): T;
//# sourceMappingURL=functional.d.ts.map