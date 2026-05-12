import { describe, expect, it } from 'vitest'

import { extractArtifactsFromResult } from './artifact-helpers.js'

describe('extractArtifactsFromResult', () => {
	it('reads artifacts from plain result', () => {
		const refs = extractArtifactsFromResult({
			data: 1,
			artifacts: [{ kind: 'log' }, { kind: 'x', extra: 1 }],
		})
		expect(refs).toEqual([{ kind: 'log' }, { kind: 'x', extra: 1 }])
	})

	it('unwraps express.handlerReturn', () => {
		const refs = extractArtifactsFromResult({
			express: { handlerReturn: { artifacts: [{ kind: 'cap' }] } },
		})
		expect(refs).toEqual([{ kind: 'cap' }])
	})

	it('returns undefined when missing or invalid', () => {
		expect(extractArtifactsFromResult({})).toBeUndefined()
		expect(extractArtifactsFromResult({ artifacts: [{}] })).toBeUndefined()
	})
})
