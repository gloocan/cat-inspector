import ts from 'typescript';
export declare function parseThrowCall(node: ts.CallExpression): {
    label: string;
    errorExpr: ts.Expression;
} | null;
export declare function parseApiReturnCall(node: ts.CallExpression): {
    label: string;
    statusCodeExpr: ts.Expression;
    bodyExpr: ts.Expression;
} | null;
export declare function scanForThrows(node: ts.Node, checker: ts.TypeChecker, results: {
    label: string;
    type: string;
}[]): void;
export declare function scanForApiReturns(node: ts.Node, checker: ts.TypeChecker, results: {
    label: string;
    statusCode: number | null;
    bodyType: string;
}[]): void;
//# sourceMappingURL=scan-for-labels.d.ts.map