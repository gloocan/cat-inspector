import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import ts from 'typescript'

import { expandTypeToShapeString } from './type-expand.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function findFunctionDeclaration(sf: ts.SourceFile, name: string): ts.FunctionDeclaration | undefined {
	let found: ts.FunctionDeclaration | undefined
	const visit = (node: ts.Node): void => {
		if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
			found = node
			return
		}
		ts.forEachChild(node, visit)
	}
	visit(sf)
	return found
}

describe('expandTypeToShapeString lib collapse', () => {
	const fixture = path.join(__dirname, '__fixtures__', 'type-expand-collapse.ts')

	const program = ts.createProgram([fixture], {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
		strict: true,
		skipLibCheck: true,
		noEmit: true,
	})

	const checker = program.getTypeChecker()
	const sf = program.getSourceFile(fixture)
	if (!sf) throw new Error('missing fixture source file')

	it('collapses DOM File to a short name when program is provided', () => {
		const fn = findFunctionDeclaration(sf, 'takesFile')
		expect(fn).toBeDefined()
		const p = fn!.parameters[0]!
		const t = checker.getTypeAtLocation(p)
		const s = expandTypeToShapeString(t, checker, p, { program })
		expect(s).toBe('File')
	})

	it('keeps nested shape for user-declared interface', () => {
		const fn = findFunctionDeclaration(sf, 'takesLocal')
		expect(fn).toBeDefined()
		const p = fn!.parameters[0]!
		const t = checker.getTypeAtLocation(p)
		const s = expandTypeToShapeString(t, checker, p, { program })
		expect(s).toBe('{ a: number }')
	})

	it('honors collapseLibOrExternalObjectShapes: false', () => {
		const fn = findFunctionDeclaration(sf, 'takesFile')
		expect(fn).toBeDefined()
		const p = fn!.parameters[0]!
		const t = checker.getTypeAtLocation(p)
		const s = expandTypeToShapeString(t, checker, p, {
			program,
			collapseLibOrExternalObjectShapes: false,
		})
		expect(s.length).toBeGreaterThan(20)
		expect(s).toContain('lastModified')
	})
})
