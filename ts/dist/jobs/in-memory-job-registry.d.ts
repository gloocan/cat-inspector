export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
type JobRow = {
    status: JobStatus;
    percent: number;
    result?: unknown;
    detail?: string;
};
/**
 * Minimal in-memory job registry for QA demos: creates ids, updates status, fans out `JOB_PROGRESS` on the inspector broadcast path.
 */
export declare class InMemoryJobRegistry {
    private readonly jobs;
    createJob(): string;
    setRunning(jobId: string, percent?: number): void;
    complete(jobId: string, result?: unknown): void;
    fail(jobId: string, detail?: string): void;
    get(jobId: string): JobRow | undefined;
    private require;
}
export {};
//# sourceMappingURL=in-memory-job-registry.d.ts.map