import { describe, expect, it } from 'vitest'

import { exportRegistryOpenApi } from './registry-to-openapi.js'
import type { RegistryEntry } from '../types.js'

const baseEntry = (over: Partial<RegistryEntry>): RegistryEntry => ({
	mode: 'service',
	className: 'X',
	method: 'm',
	style: 'function',
	body: '',
	params: [],
	declaredReturn: 'void',
	returns: [{ label: 'OK', type: null, status: 'pending' }],
	errors: [],
	children: [],
	parents: [],
	route: null,
	httpMethod: null,
	apiResponses: [],
	serviceLinks: [],
	pipelineId: null,
	pipelineIndex: null,
	originalFn: () => {},
	...over,
})

describe('exportRegistryOpenApi', () => {
	it('includes express route and rpc placeholder', () => {
		const doc = exportRegistryOpenApi({
			'Orders.get': baseEntry({
				route: '/orders',
				httpMethod: 'GET',
			}),
		}) as { paths: Record<string, Record<string, unknown>> }

		expect(doc.paths['/orders']?.get).toBeTruthy()
		expect(doc.paths['/qa/rpc/Orders.get']?.post).toBeTruthy()
	})

	it('uses custom info title', () => {
		const doc = exportRegistryOpenApi(
			{ 'A.b': baseEntry({}) },
			{ title: 'My API', version: '2.0.0' },
		) as { info: { title: string; version: string } }
		expect(doc.info.title).toBe('My API')
		expect(doc.info.version).toBe('2.0.0')
	})
})
