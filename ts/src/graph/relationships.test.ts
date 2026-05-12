import { describe, expect, it, beforeEach } from 'vitest'

import { Registry, resetInspectorState } from '../registry-state.js'
import {
	analyzeRelationships,
	buildTree,
	resolveRelationships,
} from './relationships.js'

function makeEntry(partial: Partial<import('../types.js').RegistryEntry> & { className: string; method: string }): import('../types.js').RegistryEntry {
	return {
		mode: 'service',
		style: 'class',
		body: '',
		params: [],
		declaredReturn: 'void',
		returns: [],
		errors: [],
		children: [],
		parents: [],
		route: null,
		httpMethod: null,
		apiResponses: [],
		serviceLinks: [],
		pipelineId: null,
		pipelineIndex: null,
		originalFn: function noop() {},
		...partial,
	}
}

beforeEach(() => {
	resetInspectorState()
})

describe('resolveRelationships', () => {
	it('links parent/child when body mentions method name', () => {
		Registry.set('A.parent', makeEntry({
			className: 'A',
			method: 'parent',
			body: 'child();',
		}))
		Registry.set('B.child', makeEntry({
			className: 'B',
			method: 'child',
		}))

		resolveRelationships()

		expect(Registry.get('A.parent')!.children).toContain('B.child')
		expect(Registry.get('B.child')!.parents).toContain('A.parent')
	})
})

describe('analyzeRelationships', () => {
	it('classifies roots and leaves', () => {
		Registry.set('R.root', makeEntry({
			className: 'R',
			method: 'root',
			children: ['R.leaf'],
			parents: [],
		}))
		Registry.set('R.leaf', makeEntry({
			className: 'R',
			method: 'leaf',
			children: [],
			parents: ['R.root'],
		}))

		const { roots, leaves } = analyzeRelationships()
		expect(roots).toContain('R.root')
		expect(leaves).toContain('R.leaf')
	})
})

describe('buildTree', () => {
	it('detects cycles', () => {
		Registry.set('C.a', makeEntry({
			className: 'C',
			method: 'a',
			children: ['C.b'],
			parents: [],
		}))
		Registry.set('C.b', makeEntry({
			className: 'C',
			method: 'b',
			children: ['C.a'],
			parents: ['C.a'],
		}))

		const t = buildTree('C.a') as { key: string; children: object[] }
		const nested = t.children[0] as { key: string; children: object[] }
		expect(nested.key).toBe('C.b')
		const back = nested.children[0] as { circular?: boolean; key: string }
		expect(back.circular).toBe(true)
	})
})
