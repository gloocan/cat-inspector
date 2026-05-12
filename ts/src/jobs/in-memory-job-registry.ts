import { randomUUID } from 'node:crypto'

import { broadcastJobProgress } from '../registry-state.js'

export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

type JobRow = { status: JobStatus; percent: number; result?: unknown; detail?: string }

/**
 * Minimal in-memory job registry for QA demos: creates ids, updates status, fans out `JOB_PROGRESS` on the inspector broadcast path.
 */
export class InMemoryJobRegistry {
	private readonly jobs = new Map<string, JobRow>()

	createJob(): string {
		const jobId = randomUUID()
		this.jobs.set(jobId, { status: 'queued', percent: 0 })
		broadcastJobProgress({ jobId, status: 'queued', percent: 0 })
		return jobId
	}

	setRunning(jobId: string, percent?: number): void {
		const j = this.require(jobId)
		j.status = 'running'
		if (percent !== undefined) j.percent = percent
		broadcastJobProgress({ jobId, status: 'running', percent: j.percent, detail: j.detail })
	}

	complete(jobId: string, result?: unknown): void {
		const j = this.require(jobId)
		j.status = 'done'
		j.percent = 100
		j.result = result
		broadcastJobProgress({ jobId, status: 'done', percent: 100, detail: j.detail })
	}

	fail(jobId: string, detail?: string): void {
		const j = this.require(jobId)
		j.status = 'failed'
		j.detail = detail
		broadcastJobProgress({ jobId, status: 'failed', percent: j.percent, detail })
	}

	get(jobId: string): JobRow | undefined {
		return this.jobs.get(jobId)
	}

	private require(jobId: string): JobRow {
		const j = this.jobs.get(jobId)
		if (!j) throw new Error(`unknown jobId ${jobId}`)
		return j
	}
}
