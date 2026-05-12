import { describe, expect, it, afterAll } from 'vitest'

import { Cat } from './cat.js'
import { ClassConstructorRegistry, resetInspectorState, Registry } from '../registry-state.js'
import { Return } from '../return.js'

afterAll(() => {
	resetInspectorState()
})

class Sample {
	@Cat
	run(x: number): number {
		if (x < 0) return Return('NEG', 0)
		return Return('POS', x)
	}
}

describe('@Cat', () => {
	it('registers method metadata at load', () => {
		const key = 'Sample.run'
		expect(Registry.has(key)).toBe(true)
		const e = Registry.get(key)!
		expect(e.className).toBe('Sample')
		expect(e.method).toBe('run')
		expect(e.params.some((p) => p.name === 'x')).toBe(true)
		expect(e.returns.map((r) => r.label).sort()).toEqual(['NEG', 'POS'])
	})

	it('registers the owning class constructor', () => {
		expect(ClassConstructorRegistry.has('Sample')).toBe(true)
		const ctor = ClassConstructorRegistry.get('Sample')!
		expect(typeof ctor).toBe('function')
	})

	it('wraps execution with ActiveContext', () => {
		const s = new Sample()
		const out = s.run(2)
		expect(out).toBe(2)
		const e = Registry.get('Sample.run')!
		expect(e.returns.find((r) => r.label === 'POS')?.status).toBe('resolved')
	})
})
