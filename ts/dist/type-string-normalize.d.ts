/**
 * Normalize TypeScript `typeToString` output for comparison with `getType(result)` strings.
 * Best-effort: peels `Labeled<"L", T>`, optional `Readonly<T>`, `Promise<T>`, and checks union membership.
 */
/** Split `a | b | c` at top-level `|` respecting `<>` and `()` depth. */
export declare function splitTopLevelUnion(s: string): string[];
/**
 * If `s` starts with `Labeled<...>`, return the inner payload type `T` (second type arg).
 */
export declare function peelOuterLabeled(s: string): string | null;
/** Strip one layer of `Readonly<T>` / `Readonly<T >` if present. */
export declare function peelReadonly(s: string): string | null;
/** Strip one layer of `Promise<T>` if present (async functions use `Promise<...>` in catalog). */
export declare function peelPromise(s: string): string | null;
/**
 * Recursively peel `Labeled`, `Readonly`, and `Promise` wrappers until stable, then trim.
 */
export declare function normalizeReturnTypeForRpcCompare(input: string): string;
/**
 * True if normalized `expected` equals normalized `actual`, or if `expected` is a union
 * and `actual` matches any union member after normalization.
 */
export declare function typesMatchForRpc(expected: string, actual: string): boolean;
//# sourceMappingURL=type-string-normalize.d.ts.map