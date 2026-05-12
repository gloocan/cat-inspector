import ts from 'typescript';
function stringLiteralText(n) {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
        return n.text;
    return null;
}
/**
 * Recognizes `Return("L", v)` and `(0,Return)("L", v)`-style calls.
 */
export function parseReturnCall(node) {
    const args = node.arguments;
    if (args.length < 2)
        return null;
    let cal = node.expression;
    if (ts.isParenthesizedExpression(cal)) {
        cal = cal.expression;
    }
    if (ts.isIdentifier(cal) && cal.text === 'Return') {
        const label = stringLiteralText(args[0]);
        if (label === null)
            return null;
        return { label, valueExpr: args[1] };
    }
    if (ts.isBinaryExpression(cal) && cal.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        const right = cal.right;
        if (ts.isIdentifier(right) && right.text === 'Return') {
            const label = stringLiteralText(args[0]);
            if (label === null)
                return null;
            return { label, valueExpr: args[1] };
        }
    }
    return null;
}
export function scanForReturns(node, checker, results) {
    if (ts.isCallExpression(node)) {
        const parsed = parseReturnCall(node);
        if (parsed) {
            const type = checker.getTypeAtLocation(parsed.valueExpr);
            results.push({
                label: parsed.label,
                type: checker.typeToString(type),
            });
        }
    }
    ts.forEachChild(node, (child) => scanForReturns(child, checker, results));
}
//# sourceMappingURL=scan-for-returns.js.map