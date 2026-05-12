import ts from 'typescript';
export interface ExpandTypeOptions {
    maxDepth?: number;
    maxProps?: number;
    maxUnion?: number;
    maxLen?: number;
    /** When set (e.g. from runASTScanner), lib/external object types collapse to `typeToString` (e.g. `File`). */
    program?: ts.Program;
    /**
     * When true, object/interface types declared only in default or external library sources use short names.
     * Default: `true` when `program` is set, otherwise `false`.
     */
    collapseLibOrExternalObjectShapes?: boolean;
}
export declare function expandTypeToShapeString(type: ts.Type, checker: ts.TypeChecker, contextNode: ts.Node, opts?: ExpandTypeOptions): string;
//# sourceMappingURL=type-expand.d.ts.map