import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, beforeEach } from 'vitest'

import { bootstrap, validateBootstrapFileWire, validateBootstrapStorage } from './bootstrap.js'
import { Registry, resetInspectorState } from './registry-state.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => {
	resetInspectorState()
})

describe('bootstrap', () => {
	it('runs AST merge and relationships without WebSocket', async () => {
		await import('./ast/__fixtures__/ast-sample.js')

		const result = await bootstrap({
			scanRoots: [path.join(__dirname, 'ast', '__fixtures__')],
			wsPort: 0,
			enableWebSocket: false,
			logLevel: 'error',
		})

		const entry = result.registry['AstSample.evaluate']
		expect(entry).toBeDefined()
		expect(entry!.params[0]?.type).toBe('boolean')
		expect(entry!.declaredReturn).toBe('string')
		expect(result.tree.length).toBeGreaterThanOrEqual(0)
		expect(Registry.size).toBeGreaterThan(0)
	})

	it('passes expandParamTypes config through bootstrap', async () => {
		await import('./ast/__fixtures__/imported-types-sample.js')

		const result = await bootstrap({
			scanRoots: [path.join(__dirname, 'ast', '__fixtures__')],
			wsPort: 0,
			enableWebSocket: false,
			logLevel: 'error',
			expandParamTypes: true,
			expandParamTypesOptions: {
				maxDepth: 4,
				maxProps: 20,
				maxUnion: 5,
				maxLen: 2000,
			},
		})

		const entry = result.registry['ImportedTypes.create']
		expect(entry).toBeDefined()
		expect(entry!.params[0]?.type).toBe('{ sku: string; qty: number; subtotal: number }')
	})

	it('validateBootstrapStorage throws QA_STORAGE_NOT_CONFIGURED when threshold without adapter', () => {
		expect(() =>
			validateBootstrapStorage({ artifactThresholdBytes: 1024 }),
		).toThrow(/QA_STORAGE_NOT_CONFIGURED/)
	})

	it('validateBootstrapFileWire requires allowedHosts when mode is url', () => {
		expect(() => validateBootstrapFileWire({ qaFileWire: { mode: 'url' } })).toThrow(
			/fileUrl.allowedHosts/,
		)
		expect(() =>
			validateBootstrapFileWire({
				qaFileWire: { mode: 'url' },
				fileUrl: { allowedHosts: [], maxDownloadBytes: 1, timeoutMs: 1 },
			}),
		).toThrow(/fileUrl.allowedHosts/)
	})
})
