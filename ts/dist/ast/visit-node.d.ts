import ts from 'typescript';
import { type ExpandTypeOptions } from './type-expand.js';
import type { RegistryParam } from '../types.js';
export interface AstMethodResult {
    fnName: string;
    className: string;
    returns: {
        label: string;
        type: string;
    }[];
    throws: {
        label: string;
        type: string;
    }[];
    apiReturns: {
        label: string;
        statusCode: number | null;
        bodyType: string;
    }[];
    /** From TypeChecker — fills registry when reflect-metadata is missing (e.g. Vitest/esbuild) */
    paramsFromAst?: RegistryParam[];
    declaredReturnFromAst?: string;
}
export interface VisitNodeOptions {
    expandParamTypes: boolean;
    expandParamTypesOptions?: ExpandTypeOptions;
    /** Passed from runASTScanner into param type expansion (lib/external collapse). */
    program?: ts.Program;
}
export declare function visitNode(node: ts.Node, _source: ts.SourceFile, checker: ts.TypeChecker, results: AstMethodResult[], options: VisitNodeOptions): void;
//# sourceMappingURL=visit-node.d.ts.map