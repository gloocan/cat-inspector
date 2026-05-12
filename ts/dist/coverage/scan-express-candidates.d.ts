import ts from 'typescript';
import { type GetAllTsFilesOptions } from '../ast/get-all-ts-files.js';
import type { CoverageCandidates } from './types.js';
export interface ScanExpressCandidatesOptions {
    getAllTsFilesOptions?: GetAllTsFilesOptions;
    /** Extra compiler options merged over parsed config */
    compilerOptions?: ts.CompilerOptions;
    /** If set, only these files are in the program (for tests / narrow scans) */
    files?: string[];
    /**
     * If set, only keep handlers whose resolved declaration source file is under one of these roots.
     * Used to drop third-party middleware calls like `express.json()` from coverage totals.
     */
    ownedRoots?: string[];
}
export declare function scanExpressCandidates(rootDir: string, options?: ScanExpressCandidatesOptions): CoverageCandidates;
//# sourceMappingURL=scan-express-candidates.d.ts.map