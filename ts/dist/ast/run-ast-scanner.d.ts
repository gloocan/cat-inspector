import ts from 'typescript';
import { type GetAllTsFilesOptions } from './get-all-ts-files.js';
import type { ExpandTypeOptions } from './type-expand.js';
import type { AstMethodResult } from './visit-node.js';
export interface RunAstScannerOptions {
    getAllTsFilesOptions?: GetAllTsFilesOptions;
    /** Extra compiler options merged over parsed config */
    compilerOptions?: ts.CompilerOptions;
    /** If set, only these files are in the program (for tests / narrow scans) */
    files?: string[];
    expandParamTypes?: boolean;
    expandParamTypesOptions?: ExpandTypeOptions;
}
export declare function runASTScanner(rootDir: string, options?: RunAstScannerOptions): AstMethodResult[];
//# sourceMappingURL=run-ast-scanner.d.ts.map