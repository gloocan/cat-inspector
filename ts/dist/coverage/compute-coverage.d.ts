import ts from 'typescript';
import { type GetAllTsFilesOptions } from '../ast/get-all-ts-files.js';
import type { RegistryEntry } from '../types.js';
import type { CandidateRef, CoverageCandidates } from './types.js';
export interface CoverageSummaryCounts {
    total: number;
    wrapped: number;
    left: number;
}
export interface CoverageReport {
    summary: {
        middleware: CoverageSummaryCounts;
        controllers: CoverageSummaryCounts;
        services: CoverageSummaryCounts;
    };
    left: {
        middleware: CandidateRef[];
        controllers: CandidateRef[];
        services: CandidateRef[];
    };
    meta: {
        scanRoots: string[];
        filesScanned: number;
        generatedAt: string;
        protocolVersion: number;
        unresolvedHandlers: number;
        nodesVisited: number;
    };
}
export interface ComputeCoverageOptions {
    scanRoots: string[];
    registrySnapshot: Record<string, RegistryEntry>;
    getAllTsFilesOptions?: GetAllTsFilesOptions;
    compilerOptions?: ts.CompilerOptions;
    maxServiceNodes?: number;
}
export declare function computeCoverageReport(options: ComputeCoverageOptions): {
    candidates: CoverageCandidates;
    report: CoverageReport;
};
//# sourceMappingURL=compute-coverage.d.ts.map