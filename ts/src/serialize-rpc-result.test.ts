import { describe, expect, it, beforeEach } from 'vitest'

import {
	maybeSerializeRpcResult,
	resetRpcSerializationConfig,
	SerializeRpcResultError,
	serializeRpcResult,
	setRpcSerializationConfig,
} from './serialize-rpc-result.js'

beforeEach(() => {
	resetRpcSerializationConfig()
})

describe('serializeRpcResult', () => {
	it('converts bigint to string', () => {
		expect(serializeRpcResult({ x: 1n })).toEqual({ x: '1' })
	})

	it('converts Date to ISO string', () => {
		const d = new Date('2026-04-17T12:00:00.000Z')
		expect(serializeRpcResult({ d })).toEqual({ d: '2026-04-17T12:00:00.000Z' })
	})

	it('rejects circular structures', () => {
		const a: Record<string, unknown> = { id: 1 }
		a.self = a
		expect(() => serializeRpcResult(a)).toThrow(SerializeRpcResultError)
	})

	it('rejects class instances', () => {
		class Row {
			x = 1
		}
		expect(() => serializeRpcResult(new Row())).toThrow(SerializeRpcResultError)
	})

	it('enforces maxUtf8Bytes', () => {
		setRpcSerializationConfig({ enabled: true, maxUtf8Bytes: 10 })
		expect(() => serializeRpcResult({ a: 'x'.repeat(100) })).toThrow(SerializeRpcResultError)
	})

	it('maybeSerializeRpcResult is passthrough when disabled', () => {
		const v = { a: 1n }
		const r = maybeSerializeRpcResult(v)
		expect(r.ok).toBe(true)
		if (r.ok) expect(r.value).toBe(v)
	})

	it('maybeSerializeRpcResult serializes when enabled', () => {
		setRpcSerializationConfig({ enabled: true, maxUtf8Bytes: 1024 })
		const r = maybeSerializeRpcResult({ a: 2n })
		expect(r.ok).toBe(true)
		if (r.ok) expect(r.value).toEqual({ a: '2' })
	})
})
