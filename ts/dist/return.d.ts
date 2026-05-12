export declare function getType(value: unknown): string;
export declare function getShape(value: unknown, depth?: number): string;
export type Labeled<L extends string, T> = T & {
    readonly __brand?: L;
};
/** Runtime behavior unchanged; inferred return type is `T` so catalog `declaredReturn` matches `getType`. */
export declare function Return<L extends string, T>(label: L, value: T): T;
export declare function Throw<L extends string>(label: L, error: Error): never;
export interface ApiPayload<T> {
    statusCode: number;
    body: T;
}
export declare function ApiReturn<L extends string, T>(label: L, statusCode: number, body: T): ApiPayload<T>;
//# sourceMappingURL=return.d.ts.map