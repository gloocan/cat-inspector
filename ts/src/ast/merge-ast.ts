import type { AstMethodResult } from './visit-node.js'
import { Registry } from '../registry-state.js'

export function mergeASTIntoRegistry(astResults: AstMethodResult[]): void {
	for (const row of astResults) {
		const { fnName, className, returns, throws, apiReturns } = row
		const fnKey = `${className}.${fnName}`
		if (!Registry.has(fnKey)) continue
		const meta = Registry.get(fnKey)!

		if (row.paramsFromAst && row.paramsFromAst.length > 0) {
			meta.params = row.paramsFromAst
		}
		if (row.declaredReturnFromAst !== undefined) {
			meta.declaredReturn = row.declaredReturnFromAst
		}

		for (const { label, type } of returns) {
			const entry = meta.returns.find((r) => r.label === label)
			if (entry) {
				entry.type = type
				entry.status = 'resolved'
			}
		}

		for (const { label, type } of throws) {
			const entry = meta.errors.find((e) => e.label === label)
			if (entry) {
				entry.type = type
				entry.status = 'resolved'
			}
		}

		for (const { label, statusCode, bodyType } of apiReturns) {
			const entry = meta.apiResponses.find((r) => r.label === label)
			if (entry) {
				if (statusCode !== null) entry.statusCode = statusCode
				entry.bodyShape = bodyType
				entry.status = 'resolved'
			}
		}
	}
}
