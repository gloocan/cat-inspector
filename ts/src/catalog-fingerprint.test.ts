import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { computeCatalogFingerprint } from './catalog-fingerprint.js'

describe('computeCatalogFingerprint', () => {
	it('is stable for same inputs', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-inspector-fp-'))
		fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1\n')

		const a = computeCatalogFingerprint({ scanRoots: [dir] })
		const b = computeCatalogFingerprint({ scanRoots: [dir] })
		expect(a).toBe(b)
	})

	it('changes when a scanned file changes', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-inspector-fp-'))
		const file = path.join(dir, 'a.ts')
		fs.writeFileSync(file, 'export const a = 1\n')

		const before = computeCatalogFingerprint({ scanRoots: [dir] })

		// Ensure mtimeMs changes reliably
		await new Promise((r) => setTimeout(r, 5))
		fs.writeFileSync(file, 'export const a = 2\n')

		const after = computeCatalogFingerprint({ scanRoots: [dir] })
		expect(after).not.toBe(before)
	})
})

