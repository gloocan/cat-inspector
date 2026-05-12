import { randomUUID } from 'node:crypto';
import { broadcastJobProgress } from '../registry-state.js';
/**
 * Minimal in-memory job registry for QA demos: creates ids, updates status, fans out `JOB_PROGRESS` on the inspector broadcast path.
 */
export class InMemoryJobRegistry {
    jobs = new Map();
    createJob() {
        const jobId = randomUUID();
        this.jobs.set(jobId, { status: 'queued', percent: 0 });
        broadcastJobProgress({ jobId, status: 'queued', percent: 0 });
        return jobId;
    }
    setRunning(jobId, percent) {
        const j = this.require(jobId);
        j.status = 'running';
        if (percent !== undefined)
            j.percent = percent;
        broadcastJobProgress({ jobId, status: 'running', percent: j.percent, detail: j.detail });
    }
    complete(jobId, result) {
        const j = this.require(jobId);
        j.status = 'done';
        j.percent = 100;
        j.result = result;
        broadcastJobProgress({ jobId, status: 'done', percent: 100, detail: j.detail });
    }
    fail(jobId, detail) {
        const j = this.require(jobId);
        j.status = 'failed';
        j.detail = detail;
        broadcastJobProgress({ jobId, status: 'failed', percent: j.percent, detail });
    }
    get(jobId) {
        return this.jobs.get(jobId);
    }
    require(jobId) {
        const j = this.jobs.get(jobId);
        if (!j)
            throw new Error(`unknown jobId ${jobId}`);
        return j;
    }
}
//# sourceMappingURL=in-memory-job-registry.js.map