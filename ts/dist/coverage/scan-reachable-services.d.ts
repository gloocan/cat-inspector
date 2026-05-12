import type { CandidateRef } from './types.js';
import { type ScanExpressCandidatesOptions } from './scan-express-candidates.js';
export interface ScanReachableServicesOptions extends ScanExpressCandidatesOptions {
    /** Safety bound to avoid pathological recursion */
    maxNodes?: number;
}
export declare function scanReachableServices(rootDir: string, options?: ScanReachableServicesOptions): {
    services: CandidateRef[];
    meta: {
        nodesVisited: number;
    };
};
//# sourceMappingURL=scan-reachable-services.d.ts.map