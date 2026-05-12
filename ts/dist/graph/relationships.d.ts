export declare function resolveRelationships(): void;
export declare function analyzeRelationships(): {
    roots: string[];
    leaves: string[];
    middle: string[];
};
export declare function buildTree(fnKey: string, visited?: Set<string>): object;
export declare function groupApiPipelines(): Record<string, string[]>;
//# sourceMappingURL=relationships.d.ts.map