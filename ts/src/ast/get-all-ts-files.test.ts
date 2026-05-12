import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { getAllTsFiles } from './get-all-ts-files.js'

describe('getAllTsFiles', () => {
	it('lists ts files and skips node_modules', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-inspector-'))
		fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true })
		fs.writeFileSync(path.join(dir, 'a.ts'), '')
		fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'b.ts'), '')

		const files = getAllTsFiles(dir)
		expect(files.map((f) => path.basename(f)).sort()).toEqual(['a.ts'])
	})
})
