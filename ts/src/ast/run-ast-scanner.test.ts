import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, beforeEach } from 'vitest'

import { Registry, resetInspectorState } from '../registry-state.js'
import { mergeASTIntoRegistry } from './merge-ast.js'
import { runASTScanner } from './run-ast-scanner.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => {
	resetInspectorState()
})

describe('runASTScanner + mergeASTIntoRegistry', () => {
	it('resolves Return label types from TypeChecker', async () => {
		await import('./__fixtures__/ast-sample.js')

		const root = path.join(__dirname, '..', '..')
		const fixture = path.join(__dirname, '__fixtures__', 'ast-sample.ts')
		const cat = path.join(__dirname, '..', 'decorators', 'cat.ts')
		const ret = path.join(__dirname, '..', 'return.ts')
		const types = path.join(__dirname, '..', 'types.ts')
		const regState = path.join(__dirname, '..', 'registry-state.ts')
		const sourceUtils = path.join(__dirname, '..', 'source-utils.ts')

		const ast = runASTScanner(root, {
			files: [fixture, cat, ret, types, regState, sourceUtils],
		})
		mergeASTIntoRegistry(ast)

		const entry = Registry.get('AstSample.evaluate')
		expect(entry).toBeDefined()
		const labels = entry!.returns.map((r) => r.label).sort()
		expect(labels).toEqual(['WHEN_FALSE', 'WHEN_TRUE'])
		const tTrue = entry!.returns.find((r) => r.label === 'WHEN_TRUE')?.type
		const tFalse = entry!.returns.find((r) => r.label === 'WHEN_FALSE')?.type
		expect(tTrue).toBeTruthy()
		expect(tFalse).toBeTruthy()
		expect(entry!.returns.every((r) => r.status === 'resolved')).toBe(true)
	})

	it('extracts param + return types for cat() and catModule()', async () => {
		await import('./__fixtures__/functional-sample.js')

		const root = path.join(__dirname, '..', '..')
		const fixture = path.join(__dirname, '__fixtures__', 'functional-sample.ts')
		const functional = path.join(__dirname, '..', 'functional.ts')
		const types = path.join(__dirname, '..', 'types.ts')
		const regState = path.join(__dirname, '..', 'registry-state.ts')
		const sourceUtils = path.join(__dirname, '..', 'source-utils.ts')

		const ast = runASTScanner(root, {
			files: [fixture, functional, types, regState, sourceUtils],
		})
		mergeASTIntoRegistry(ast)

		const greeter = Registry.get('Greeter.hello')
		expect(greeter).toBeDefined()
		expect(greeter!.params[0]?.type).toBe('string')
		expect(greeter!.declaredReturn).toBe('string')

		const pricing = Registry.get('PricingService.applyTax')
		expect(pricing).toBeDefined()
		expect(pricing!.params[0]?.type).toBe('number')
		expect(pricing!.declaredReturn).toBe('number')
	})

	it('resolves Return/Throw/ApiReturn label types for cat() and catModule()', async () => {
		await import('./__fixtures__/functional-labels-sample.js')

		const root = path.join(__dirname, '..', '..')
		const fixture = path.join(__dirname, '__fixtures__', 'functional-labels-sample.ts')
		const functional = path.join(__dirname, '..', 'functional.ts')
		const ret = path.join(__dirname, '..', 'return.ts')
		const types = path.join(__dirname, '..', 'types.ts')
		const regState = path.join(__dirname, '..', 'registry-state.ts')
		const sourceUtils = path.join(__dirname, '..', 'source-utils.ts')

		const ast = runASTScanner(root, {
			files: [fixture, functional, ret, types, regState, sourceUtils],
		})
		mergeASTIntoRegistry(ast)

		const greeter = Registry.get('Greeter.hello')
		expect(greeter).toBeDefined()
		const helloReturn = greeter!.returns.find((r) => r.label === 'HELLO')
		expect(helloReturn?.type).toBeTruthy()
		expect(helloReturn?.status).toBe('resolved')
		const noName = greeter!.errors.find((e) => e.label === 'NO_NAME')
		expect(noName?.type).toBeTruthy()
		expect(noName?.status).toBe('resolved')

		const pricing = Registry.get('PricingService.applyTax')
		expect(pricing).toBeDefined()
		const taxed = pricing!.returns.find((r) => r.label === 'TAXED')
		expect(taxed?.type).toBeTruthy()
		expect(taxed?.status).toBe('resolved')
		const zero = pricing!.errors.find((e) => e.label === 'ZERO')
		expect(zero?.type).toBeTruthy()
		expect(zero?.status).toBe('resolved')

		const api = Registry.get('PricingService.apiExample')
		expect(api).toBeDefined()
		const ok = api!.apiResponses.find((r) => r.label === 'OK')
		expect(ok?.bodyShape).toBeTruthy()
		expect(ok?.status).toBe('resolved')
		expect(ok?.statusCode).toBe(200)
	})

	it('expands imported param type aliases and falls back safely for recursive/large types', async () => {
		await import('./__fixtures__/imported-types-sample.js')

		const root = path.join(__dirname, '..', '..')
		const fixture = path.join(__dirname, '__fixtures__', 'imported-types-sample.ts')
		const shared = path.join(__dirname, '__fixtures__', 'imported-types-shared.ts')
		const functional = path.join(__dirname, '..', 'functional.ts')
		const types = path.join(__dirname, '..', 'types.ts')
		const regState = path.join(__dirname, '..', 'registry-state.ts')
		const sourceUtils = path.join(__dirname, '..', 'source-utils.ts')

		const ast = runASTScanner(root, {
			files: [fixture, shared, functional, types, regState, sourceUtils],
			expandParamTypes: true,
			expandParamTypesOptions: {
				maxDepth: 3,
				maxProps: 10,
				maxUnion: 5,
				maxLen: 2000,
			},
		})
		mergeASTIntoRegistry(ast)

		const create = Registry.get('ImportedTypes.create')
		expect(create).toBeDefined()
		expect(create!.params[0]?.type).toBe('{ sku: string; qty: number; subtotal: number }')

		const recursive = Registry.get('ImportedTypes.recursive')
		expect(recursive).toBeDefined()
		expect(recursive!.params[0]?.type).toContain('name: string')
		expect(recursive!.params[0]?.type).toContain('child?: undefined | RecursiveNode')

		const maybe = Registry.get('ImportedTypes.maybe')
		expect(maybe).toBeDefined()
		expect(maybe!.params[0]?.type).toBe('LargeUnion')
	})

	it('passes bootstrap config through to the AST scanner for real example files', () => {
		const backendRoot = path.join(__dirname, '..', '..', '..', '..', 'examples', 'cat-demo', 'backend')
		const ordersService = path.join(
			backendRoot,
			'src',
			'structured-example',
			'services',
			'orders.service.ts',
		)

		const ast = runASTScanner(backendRoot, {
			files: [ordersService],
			expandParamTypes: true,
			expandParamTypesOptions: {
				maxDepth: 6,
				maxProps: 50,
				maxUnion: 10,
				maxLen: 10_000,
			},
		})

		const placeOrder = ast.find(
			(row) => row.className === 'OrdersService' && row.fnName === 'placeOrder',
		)
		expect(placeOrder).toBeDefined()
		expect(placeOrder!.paramsFromAst?.[0]?.type).toBe(
			'{ sku: string; qty: number; subtotal: number }',
		)
	})
})
