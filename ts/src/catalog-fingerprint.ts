import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { CompilerOptions } from 'typescript'

import { PROTOCOL_VERSION } from './types.js'
import { getAllTsFiles, type GetAllTsFilesOptions } from './ast/get-all-ts-files.js'
import type { ExpandTypeOptions } from './ast/type-expand.js'

export type CatalogFingerprintInput = {
	scanRoots: string[]
	getAllTsFilesOptions?: GetAllTsFilesOptions
	compilerOptions?: CompilerOptions
	expandParamTypes?: boolean
	expandParamTypesOptions?: ExpandTypeOptions
	redactBodies?: boolean
	protocolVersion?: number
}

function stableStringify(value: unknown): string {
	if (value === null) return 'null'
	const t = typeof value
	if (t === 'string') return JSON.stringify(value)
	if (t === 'number' || t === 'boolean') return String(value)
	if (t !== 'object') return JSON.stringify(String(value))
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

	const obj = value as Record<string, unknown>
	const keys = Object.keys(obj).sort()
	return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

function normalizeRoot(p: string): string {
	return path.resolve(p)
}

/**
 * Compute a stable fingerprint for the catalog bootstrap inputs.
 *
 * This is meant to be fast (mtime+size), so the server can skip running the
 * full AST bootstrap when nothing relevant changed.
 */
export function computeCatalogFingerprint(input: CatalogFingerprintInput): string {
	const scanRoots = (input.scanRoots ?? []).map(normalizeRoot).sort()
	if (scanRoots.length === 0) {
		throw new Error('computeCatalogFingerprint: scanRoots must include at least one directory')
	}

	const files = [...new Set(scanRoots.flatMap((r) => getAllTsFiles(r, input.getAllTsFilesOptions)))]
	files.sort()

	const fileStats = files.map((filePath) => {
		const abs = path.resolve(filePath)
		const st = fs.statSync(abs)
		return { path: abs, mtimeMs: st.mtimeMs, size: st.size }
	})

	const payload = {
		version: 1,
		protocolVersion: input.protocolVersion ?? Number(PROTOCOL_VERSION),
		scanRoots,
		getAllTsFilesOptions: input.getAllTsFilesOptions ?? null,
		compilerOptions: input.compilerOptions ?? null,
		expandParamTypes: input.expandParamTypes ?? null,
		expandParamTypesOptions: input.expandParamTypesOptions ?? null,
		redactBodies: input.redactBodies ?? null,
		files: fileStats,
	}

	const text = stableStringify(payload)
	return crypto.createHash('sha256').update(text).digest('hex')
}

