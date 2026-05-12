import type { CompilerOptions } from 'typescript';
import { type GetAllTsFilesOptions } from './ast/get-all-ts-files.js';
import type { ExpandTypeOptions } from './ast/type-expand.js';
export type CatalogFingerprintInput = {
    scanRoots: string[];
    getAllTsFilesOptions?: GetAllTsFilesOptions;
    compilerOptions?: CompilerOptions;
    expandParamTypes?: boolean;
    expandParamTypesOptions?: ExpandTypeOptions;
    redactBodies?: boolean;
    protocolVersion?: number;
};
/**
 * Compute a stable fingerprint for the catalog bootstrap inputs.
 *
 * This is meant to be fast (mtime+size), so the server can skip running the
 * full AST bootstrap when nothing relevant changed.
 */
export declare function computeCatalogFingerprint(input: CatalogFingerprintInput): string;
//# sourceMappingURL=catalog-fingerprint.d.ts.map