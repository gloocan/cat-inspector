import { describe, expect, it } from 'vitest'

import {
	extractParamNames,
	extractReturnLabels,
	getFunctionBody,
} from './source-utils.js'

describe('extractParamNames', () => {
	it('reads names from a plain function', () => {
		function f(a: number, b: string) {
			return a + b
		}
		expect(extractParamNames(f)).toEqual(['a', 'b'])
	})

	it('returns empty for no params', () => {
		function f() {
			return 1
		}
		expect(extractParamNames(f)).toEqual([])
	})
})

describe('extractReturnLabels', () => {
	it('finds Return call labels', () => {
		const body = `
      if (x) return Return("A", 1);
      return Return('B', null);
    `
		expect(extractReturnLabels(body)).toEqual(['A', 'B'])
	})

	it('finds labels in comma-callee form', () => {
		const body = 'if (x < 0) return (0,Return)("NEG", 0);\nreturn (0,Return)("POS", x);'
		expect(extractReturnLabels(body).sort()).toEqual(['NEG', 'POS'])
	})
})

describe('getFunctionBody', () => {
	it('returns trimmed block body', () => {
		function g() {
			return 42
		}
		expect(getFunctionBody(g)).toContain('return 42')
	})
})
