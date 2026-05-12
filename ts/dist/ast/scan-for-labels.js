import ts from 'typescript';
function stringLiteralText(n) {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
        return n.text;
    return null;
}
function unwrapCallee(expr) {
    if (ts.isParenthesizedExpression(expr))
        return unwrapCallee(expr.expression);
    return expr;
}
function isCommaCallee(expr, name) {
    if (!ts.isBinaryExpression(expr))
        return false;
    if (expr.operatorToken.kind !== ts.SyntaxKind.CommaToken)
        return false;
    return ts.isIdentifier(expr.right) && expr.right.text === name;
}
export function parseThrowCall(node) {
    const args = node.arguments;
    if (args.length < 2)
        return null;
    const cal = unwrapCallee(node.expression);
    if (ts.isIdentifier(cal) && cal.text === 'Throw') {
        const label = stringLiteralText(args[0]);
        if (label === null)
            return null;
        return { label, errorExpr: args[1] };
    }
    if (isCommaCallee(cal, 'Throw')) {
        const label = stringLiteralText(args[0]);
        if (label === null)
            return null;
        return { label, errorExpr: args[1] };
    }
    return null;
}
export function parseApiReturnCall(node) {
    const args = node.arguments;
    if (args.length < 3)
        return null;
    const cal = unwrapCallee(node.expression);
    if (ts.isIdentifier(cal) && cal.text === 'ApiReturn') {
        const label = stringLiteralText(args[0]);
        if (label === null)
            return null;
        return { label, statusCodeExpr: args[1], bodyExpr: args[2] };
    }
    if (isCommaCallee(cal, 'ApiReturn')) {
        const label = stringLiteralText(args[0]);
        if (label === null)
            return null;
        return { label, statusCodeExpr: args[1], bodyExpr: args[2] };
    }
    return null;
}
export function scanForThrows(node, checker, results) {
    if (ts.isCallExpression(node)) {
        const parsed = parseThrowCall(node);
        if (parsed) {
            const type = checker.getTypeAtLocation(parsed.errorExpr);
            results.push({
                label: parsed.label,
                type: checker.typeToString(type),
            });
        }
    }
    ts.forEachChild(node, (child) => scanForThrows(child, checker, results));
}
export function scanForApiReturns(node, checker, results) {
    if (ts.isCallExpression(node)) {
        const parsed = parseApiReturnCall(node);
        if (parsed) {
            let statusCode = null;
            if (ts.isNumericLiteral(parsed.statusCodeExpr)) {
                statusCode = Number(parsed.statusCodeExpr.text);
            }
            const body = checker.getTypeAtLocation(parsed.bodyExpr);
            results.push({
                label: parsed.label,
                statusCode,
                bodyType: checker.typeToString(body),
            });
        }
    }
    ts.forEachChild(node, (child) => scanForApiReturns(child, checker, results));
}
//# sourceMappingURL=scan-for-labels.js.map