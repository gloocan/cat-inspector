import { beforeEach, describe, expect, it } from 'vitest'

import {
	broadcast,
	clearBroadcastSink,
	getInspectorBroadcastStore,
	readInspectorSocketIdFromHeaders,
	registerInstance,
	resetInspectorState,
	runWithInspectorBroadcastTarget,
	setBroadcastSink,
} from './registry-state.js'

beforeEach(() => {
	resetInspectorState()
})

describe('registerInstance', () => {
	it('throws on duplicate constructor.name', () => {
		registerInstance({ constructor: { name: 'Greeter' }, hello() {} })
		expect(() =>
			registerInstance({ constructor: { name: 'Greeter' }, hello() {} }),
		).toThrow(/duplicate instance name "Greeter"/)
	})
})

describe('broadcast sink + inspector ALS', () => {
	it('broadcast invokes sink and ignores sink throw', () => {
		const seen: object[] = []
		setBroadcastSink((d) => {
			seen.push(d)
		})
		broadcast({ a: 1 })
		expect(seen).toEqual([{ a: 1 }])
		setBroadcastSink(() => {
			throw new Error('sink boom')
		})
		expect(() => broadcast({ b: 2 })).not.toThrow()
		clearBroadcastSink()
	})

	it('runWithInspectorBroadcastTarget sets store for sync fn', () => {
		runWithInspectorBroadcastTarget('sock-abc', () => {
			expect(getInspectorBroadcastStore()).toEqual({
				socketId: 'sock-abc',
				source: 'rpc',
			})
		})
		expect(getInspectorBroadcastStore()).toBeUndefined()
	})

	it('runWithInspectorBroadcastTarget accepts http source', () => {
		runWithInspectorBroadcastTarget(
			'id',
			() => {
				expect(getInspectorBroadcastStore()?.source).toBe('http')
			},
			{ source: 'http' },
		)
	})

	it('readInspectorSocketIdFromHeaders reads x-socket-id', () => {
		expect(
			readInspectorSocketIdFromHeaders({
				'x-socket-id': '  tab1  ',
			}),
		).toBe('tab1')
		expect(readInspectorSocketIdFromHeaders({})).toBeUndefined()
	})

	it('resetInspectorState clears broadcast sink', () => {
		const first: object[] = []
		setBroadcastSink((d) => first.push(d))
		resetInspectorState()
		broadcast({ x: 1 })
		expect(first).toHaveLength(0)
	})
})

