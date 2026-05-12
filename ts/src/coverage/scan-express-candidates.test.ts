import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { scanExpressCandidates } from './scan-express-candidates.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('scanExpressCandidates', () => {
	it('extracts registerCatPipeline handlers and drops third-party middleware', () => {
		const fixture = path.join(__dirname, '__fixtures__', 'pipeline-scan-fixture.ts')
		const out = scanExpressCandidates(path.join(__dirname, '__fixtures__'), {
			files: [fixture],
			ownedRoots: [path.join(__dirname, '__fixtures__')],
		})

		// From registerCatPipeline: [requireUser, validateBody, run]
		// requireUser + validateBody => middleware, run => controller
		expect(out.middleware.map((m) => m.name)).toEqual(
			expect.arrayContaining(['requireUser', 'validateBody']),
		)
		expect(out.controllers.map((c) => c.name)).toEqual(expect.arrayContaining(['run']))

		// express.json() should be dropped because it resolves to third-party declarations.
		expect(out.middleware.some((m) => m.name.includes('express.json'))).toBe(false)
	})
})

