import ts from 'typescript';
/**
 * Recognizes `Return("L", v)` and `(0,Return)("L", v)`-style calls.
 */
export declare function parseReturnCall(node: ts.CallExpression): {
    label: string;
    valueExpr: ts.Expression;
} | null;
export declare function scanForReturns(node: ts.Node, checker: ts.TypeChecker, results: {
    label: string;
    type: string;
}[]): void;
//# sourceMappingURL=scan-for-returns.d.ts.map