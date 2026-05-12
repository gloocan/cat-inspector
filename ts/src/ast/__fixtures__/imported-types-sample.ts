import { catModule } from '../../functional.js'

import type { ImportedOrderInput, LargeUnion, RecursiveNode } from './imported-types-shared.js'

export const importedTypes = catModule('ImportedTypes', {
	create(input: ImportedOrderInput): string {
		return input.sku
	},
	recursive(input: RecursiveNode): string {
		return input.name
	},
	maybe(input: LargeUnion): string {
		return input
	},
})
