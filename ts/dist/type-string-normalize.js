/**
 * Normalize TypeScript `typeToString` output for comparison with `getType(result)` strings.
 * Best-effort: peels `Labeled<"L", T>`, optional `Readonly<T>`, `Promise<T>`, and checks union membership.
 */
/** Split `a | b | c` at top-level `|` respecting `<>` and `()` depth. */
export function splitTopLevelUnion(s) {
    const t = s.trim();
    if (!t.includes('|'))
        return [t];
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (c === '<' || c === '(')
            depth++;
        else if (c === '>' || c === ')')
            depth = Math.max(0, depth - 1);
        else if (c === '|' && depth === 0) {
            parts.push(t.slice(start, i).trim());
            start = i + 1;
        }
    }
    parts.push(t.slice(start).trim());
    return parts.filter(Boolean);
}
function splitFirstGenericArg(content) {
    let depth = 0;
    for (let i = 0; i < content.length; i++) {
        const c = content[i];
        if (c === '<' || c === '(')
            depth++;
        else if (c === '>' || c === ')')
            depth = Math.max(0, depth - 1);
        else if (c === ',' && depth === 0) {
            return [content.slice(0, i).trim(), content.slice(i + 1).trim()];
        }
    }
    return null;
}
/**
 * If `s` starts with `Labeled<...>`, return the inner payload type `T` (second type arg).
 */
export function peelOuterLabeled(s) {
    const t = s.trim();
    const prefix = t.match(/^Labeled\s*</i);
    if (!prefix)
        return null;
    const openAngle = prefix[0].length - 1;
    let depth = 0;
    for (let j = openAngle; j < t.length; j++) {
        const c = t[j];
        if (c === '<')
            depth++;
        else if (c === '>') {
            depth--;
            if (depth === 0) {
                const inner = t.slice(openAngle + 1, j);
                const pair = splitFirstGenericArg(inner);
                if (!pair)
                    return null;
                return pair[1].trim();
            }
        }
    }
    return null;
}
/** Strip one layer of `Readonly<T>` / `Readonly<T >` if present. */
export function peelReadonly(s) {
    const t = s.trim();
    const m = /^Readonly\s*</i.exec(t);
    if (!m || m.index !== 0)
        return null;
    const open = m[0].length - 1;
    let depth = 0;
    for (let j = open; j < t.length; j++) {
        const c = t[j];
        if (c === '<')
            depth++;
        else if (c === '>') {
            depth--;
            if (depth === 0) {
                return t.slice(open + 1, j).trim();
            }
        }
    }
    return null;
}
/** Strip one layer of `Promise<T>` if present (async functions use `Promise<...>` in catalog). */
export function peelPromise(s) {
    const t = s.trim();
    const m = /^Promise\s*</i.exec(t);
    if (!m || m.index !== 0)
        return null;
    const open = m[0].length - 1;
    let depth = 0;
    for (let j = open; j < t.length; j++) {
        const c = t[j];
        if (c === '<')
            depth++;
        else if (c === '>') {
            depth--;
            if (depth === 0) {
                return t.slice(open + 1, j).trim();
            }
        }
    }
    return null;
}
/**
 * Recursively peel `Labeled`, `Readonly`, and `Promise` wrappers until stable, then trim.
 */
export function normalizeReturnTypeForRpcCompare(input) {
    let s = input.trim();
    let prev = '';
    while (s !== prev) {
        prev = s;
        {
            const lower = s.toLowerCase();
            // Treat numeric aliases as `number` for runtime comparisons.
            if (lower === 'int' ||
                lower === 'integer' ||
                lower === 'int32' ||
                lower === 'int64' ||
                lower === 'float' ||
                lower === 'float32' ||
                lower === 'float64' ||
                lower === 'double' ||
                lower === 'decimal') {
                s = 'number';
                continue;
            }
        }
        // JS runtime uses `undefined` for `void` returns.
        if (s === 'void') {
            s = 'undefined';
            continue;
        }
        const l = peelOuterLabeled(s);
        if (l !== null) {
            s = l;
            continue;
        }
        const r = peelReadonly(s);
        if (r !== null) {
            s = r;
            continue;
        }
        const p = peelPromise(s);
        if (p !== null) {
            s = p;
            continue;
        }
        // Runtime `returnType` is coarse for objects (`object`), while TypeScript
        // declarations can be object-literals (`{ a: number }`). Treat object-literals as `object`.
        if (s.startsWith('{') && s.endsWith('}')) {
            s = 'object';
            continue;
        }
    }
    return s.trim();
}
/**
 * True if normalized `expected` equals normalized `actual`, or if `expected` is a union
 * and `actual` matches any union member after normalization.
 */
export function typesMatchForRpc(expected, actual) {
    const expN = normalizeReturnTypeForRpcCompare(expected);
    const actN = normalizeReturnTypeForRpcCompare(actual);
    if (expN === actN)
        return true;
    const members = splitTopLevelUnion(expN);
    if (members.length > 1) {
        return members.some((m) => normalizeReturnTypeForRpcCompare(m) === actN);
    }
    return false;
}
//# sourceMappingURL=type-string-normalize.js.map