import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { scanReachableServices } from './scan-reachable-services.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('scanReachableServices', () => {
	it('discovers catModule methods called by cat-wrapped controller', () => {
		const fixtureDir = path.join(__dirname, '__fixtures__')
		const fixture = path.join(fixtureDir, 'reachable-services-fixture.ts')
		const out = scanReachableServices(fixtureDir, {
			files: [fixture],
			ownedRoots: [fixtureDir],
		})

		const names = out.services.map((s) => s.name)
		expect(names).toEqual(expect.arrayContaining(['PricingService.applyTax', 'PricingService.quoteTotal']))
	})

	it('discovers imported service called by unwrapped controller', () => {
		const fixtureDir = path.join(__dirname, '__fixtures__')
		const controllerFixture = path.join(fixtureDir, 'unwrapped-controller-service.ts')
		const serviceFixture = path.join(fixtureDir, 'unwrapped-service.ts')
		const out = scanReachableServices(fixtureDir, {
			files: [controllerFixture, serviceFixture],
			ownedRoots: [fixtureDir],
		})

		const names = out.services.map((s) => s.name)
		expect(names).toEqual(expect.arrayContaining(['importedService']))
	})
})

