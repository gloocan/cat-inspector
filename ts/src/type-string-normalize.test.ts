import { describe, expect, it } from 'vitest'

import {
	normalizeReturnTypeForRpcCompare,
	peelOuterLabeled,
	splitTopLevelUnion,
	typesMatchForRpc,
} from './type-string-normalize.js'

describe('type-string-normalize', () => {
	it('peels one Labeled layer', () => {
		expect(peelOuterLabeled('Labeled<"HELLO", string>')).toBe('string')
		expect(peelOuterLabeled(`Labeled<'X', number>`)).toBe('number')
	})

	it('normalizes nested Labeled', () => {
		expect(normalizeReturnTypeForRpcCompare('Labeled<"A", Labeled<"B", string>>')).toBe('string')
	})

	it('strips Readonly', () => {
		expect(normalizeReturnTypeForRpcCompare('Readonly<{ x: int }>')).toBe('object')
	})

	it('strips Promise for RPC compare (async catalog return)', () => {
		expect(normalizeReturnTypeForRpcCompare('Promise<{ a: number }>')).toBe('object')
		expect(normalizeReturnTypeForRpcCompare('Promise<string>')).toBe('string')
		expect(normalizeReturnTypeForRpcCompare('Promise<Readonly<{ a: int }>>')).toBe('object')
	})

	it('peels nested Promise wrappers', () => {
		expect(normalizeReturnTypeForRpcCompare('Promise<Promise<string>>')).toBe('string')
	})

	it('normalizes void to undefined', () => {
		expect(normalizeReturnTypeForRpcCompare('void')).toBe('undefined')
		expect(typesMatchForRpc('void', 'undefined')).toBe(true)
	})

	it('normalizes object-literals to object', () => {
		expect(normalizeReturnTypeForRpcCompare('{ x: number }')).toBe('object')
		expect(typesMatchForRpc('{ score: number }', 'object')).toBe(true)
	})

	it('typesMatchForRpc: string vs Labeled', () => {
		expect(typesMatchForRpc('Labeled<"HELLO", string>', 'string')).toBe(true)
	})

	it('typesMatchForRpc: union', () => {
		expect(typesMatchForRpc('number | string', 'string')).toBe(true)
		expect(typesMatchForRpc('number | string', 'int')).toBe(true)
	})

	it('splitTopLevelUnion', () => {
		expect(splitTopLevelUnion('a | b')).toEqual(['a', 'b'])
		expect(splitTopLevelUnion('Foo<bar|baz> | c')).toEqual(['Foo<bar|baz>', 'c'])
	})
})
