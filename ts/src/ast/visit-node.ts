import ts from 'typescript'

import { scanForReturns } from './scan-for-returns.js'
import { scanForApiReturns, scanForThrows } from './scan-for-labels.js'
import { expandTypeToShapeString, type ExpandTypeOptions } from './type-expand.js'
import type { RegistryParam } from '../types.js'

export interface AstMethodResult {
	fnName: string
	className: string
	returns: { label: string; type: string }[]
	throws: { label: string; type: string }[]
	apiReturns: { label: string; statusCode: number | null; bodyType: string }[]
	/** From TypeChecker — fills registry when reflect-metadata is missing (e.g. Vitest/esbuild) */
	paramsFromAst?: RegistryParam[]
	declaredReturnFromAst?: string
}

export interface VisitNodeOptions {
	expandParamTypes: boolean
	expandParamTypesOptions?: ExpandTypeOptions
	/** Passed from runASTScanner into param type expansion (lib/external collapse). */
	program?: ts.Program
}

function getFunctionLikeSignatureTypes(
	fn:
		| ts.FunctionExpression
		| ts.ArrowFunction
		| ts.FunctionDeclaration
		| ts.MethodDeclaration,
	checker: ts.TypeChecker,
	options: VisitNodeOptions,
): {
	params: RegistryParam[]
	declaredReturn: string
} | undefined {
	const sig = checker.getSignatureFromDeclaration(fn)
	if (!sig) return undefined

	const params: RegistryParam[] = []
	for (let i = 0; i < fn.parameters.length; i++) {
		const p = fn.parameters[i]!
		const paramName = ts.isIdentifier(p.name) ? p.name.text : `arg${i}`
		const t = checker.getTypeAtLocation(p)
		const fileMeta = computeFileMetaForType(t, checker, 0, new Set())
		params.push({
			name: paramName,
			type: options.expandParamTypes
				? expandTypeToShapeString(t, checker, p, {
						...options.expandParamTypesOptions,
						program: options.program ?? options.expandParamTypesOptions?.program,
					})
				: checker.typeToString(t),
			...fileMeta,
		})
	}

	const ret = checker.getReturnTypeOfSignature(sig)
	const declaredReturn = checker.typeToString(ret)

	return { params, declaredReturn }
}

const FILE_TYPE_NAMES = new Set(['File', 'Blob', 'Buffer'])

function isFileLikeType(t: ts.Type, checker: ts.TypeChecker): boolean {
	const sym = t.getSymbol() ?? t.aliasSymbol
	const name = sym?.getName()
	if (name && FILE_TYPE_NAMES.has(name)) return true
	// Fallback: typeToString() can include `File`/`Blob`/`Buffer` even when symbol names vary.
	const s = checker.typeToString(t)
	return s === 'File' || s === 'Blob' || s === 'Buffer'
}

function computeFileMetaForType(
	t: ts.Type,
	checker: ts.TypeChecker,
	depth: number,
	// Track by type string to avoid obvious cycles without relying on private `id`.
	seen: Set<string>,
): Pick<RegistryParam, 'kind' | 'filePaths' | 'fileArrayPaths'> {
	if (depth > 6) return {}
	const key = checker.typeToString(t)
	if (seen.has(key)) return {}
	seen.add(key)

	// Top-level single file
	if (isFileLikeType(t, checker)) return { kind: 'file' }

	// Top-level array of file
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyChecker = checker as any
	if (typeof anyChecker.isArrayType === 'function' && anyChecker.isArrayType(t)) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call
		const el = anyChecker.getElementTypeOfArrayType(t) as ts.Type | undefined
		if (el && isFileLikeType(el, checker)) return { kind: 'files' }
		// Arrays of objects might contain nested files; treat via recursive scan below.
	}

	// Nested paths inside object types
	const filePaths: string[] = []
	const fileArrayPaths: string[] = []

	const collect = (subType: ts.Type, prefix: string) => {
		if (isFileLikeType(subType, checker)) {
			filePaths.push(prefix)
			return
		}
		if (typeof anyChecker.isArrayType === 'function' && anyChecker.isArrayType(subType)) {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-call
			const el = anyChecker.getElementTypeOfArrayType(subType) as ts.Type | undefined
			if (el && isFileLikeType(el, checker)) {
				fileArrayPaths.push(prefix)
				return
			}
			// Array of objects: record nested with a representative [0] path
			if (el) {
				const nested = computeFileMetaForType(el, checker, depth + 1, seen)
				for (const p of nested.filePaths ?? []) filePaths.push(`${prefix}[0].${p}`)
				for (const p of nested.fileArrayPaths ?? []) fileArrayPaths.push(`${prefix}[0].${p}`)
			}
			return
		}
		const nested = computeFileMetaForType(subType, checker, depth + 1, seen)
		for (const p of nested.filePaths ?? []) filePaths.push(`${prefix}.${p}`)
		for (const p of nested.fileArrayPaths ?? []) fileArrayPaths.push(`${prefix}.${p}`)
	}

	// Only recurse into object-ish types (primitives will have no properties)
	for (const prop of t.getProperties()) {
		const decl = prop.valueDeclaration ?? prop.declarations?.[0]
		if (!decl) continue
		const propType = checker.getTypeOfSymbolAtLocation(prop, decl)
		collect(propType, prop.getName())
	}

	const out: Pick<RegistryParam, 'kind' | 'filePaths' | 'fileArrayPaths'> = {}
	if (filePaths.length) out.filePaths = [...new Set(filePaths)]
	if (fileArrayPaths.length) out.fileArrayPaths = [...new Set(fileArrayPaths)]
	return out
}

function getStringLiteralText(node: ts.Expression | undefined): string | undefined {
	if (!node) return undefined
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
		return node.text
	}
	return undefined
}

function parseFnKeyLiteral(
	fnKey: string,
): { className: string; fnName: string } | undefined {
	const dot = fnKey.indexOf('.')
	if (dot <= 0 || dot === fnKey.length - 1) return undefined
	return { className: fnKey.slice(0, dot), fnName: fnKey.slice(dot + 1) }
}

function tryVisitFunctionalRegistrations(
	node: ts.Node,
	checker: ts.TypeChecker,
	results: AstMethodResult[],
	options: VisitNodeOptions,
): void {
	if (!ts.isCallExpression(node)) return
	if (!ts.isIdentifier(node.expression)) return
	const callee = node.expression.text

	if (callee === 'cat') {
		const fnKeyText = getStringLiteralText(node.arguments[0])
		const fnArg = node.arguments[1]
		if (!fnKeyText || !fnArg) return
		const parsed = parseFnKeyLiteral(fnKeyText)
		if (!parsed) return
		if (!ts.isFunctionExpression(fnArg) && !ts.isArrowFunction(fnArg)) return

		const signatureTypes = getFunctionLikeSignatureTypes(fnArg, checker, options)
		const returns: { label: string; type: string }[] = []
		const throws: { label: string; type: string }[] = []
		const apiReturns: { label: string; statusCode: number | null; bodyType: string }[] = []
		// FunctionExpression always has a block body; ArrowFunction may be block or expression.
		scanForReturns(fnArg.body, checker, returns)
		scanForThrows(fnArg.body, checker, throws)
		scanForApiReturns(fnArg.body, checker, apiReturns)
		results.push({
			fnName: parsed.fnName,
			className: parsed.className,
			returns,
			throws,
			apiReturns,
			paramsFromAst: signatureTypes?.params,
			declaredReturnFromAst: signatureTypes?.declaredReturn,
		})
		return
	}

	if (callee === 'catModule') {
		const moduleName = getStringLiteralText(node.arguments[0])
		const objArg = node.arguments[1]
		if (!moduleName) return
		if (!objArg || !ts.isObjectLiteralExpression(objArg)) return

		for (const prop of objArg.properties) {
			if (ts.isMethodDeclaration(prop) && prop.name) {
				const propName =
					ts.isIdentifier(prop.name)
						? prop.name.text
						: ts.isStringLiteral(prop.name)
							? prop.name.text
							: undefined
				if (!propName) continue

				const signatureTypes = getFunctionLikeSignatureTypes(prop, checker, options)
				const returns: { label: string; type: string }[] = []
				const throws: { label: string; type: string }[] = []
				const apiReturns: { label: string; statusCode: number | null; bodyType: string }[] = []
				if (prop.body) {
					scanForReturns(prop.body, checker, returns)
					scanForThrows(prop.body, checker, throws)
					scanForApiReturns(prop.body, checker, apiReturns)
				}
				results.push({
					fnName: propName,
					className: moduleName,
					returns,
					throws,
					apiReturns,
					paramsFromAst: signatureTypes?.params,
					declaredReturnFromAst: signatureTypes?.declaredReturn,
				})
				continue
			}

			if (ts.isPropertyAssignment(prop) && prop.name) {
				const propName =
					ts.isIdentifier(prop.name)
						? prop.name.text
						: ts.isStringLiteral(prop.name)
							? prop.name.text
							: undefined
				if (!propName) continue

				const init = prop.initializer
				if (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init)) continue

				const signatureTypes = getFunctionLikeSignatureTypes(init, checker, options)
				const returns: { label: string; type: string }[] = []
				const throws: { label: string; type: string }[] = []
				const apiReturns: { label: string; statusCode: number | null; bodyType: string }[] = []
				scanForReturns(init.body, checker, returns)
				scanForThrows(init.body, checker, throws)
				scanForApiReturns(init.body, checker, apiReturns)
				results.push({
					fnName: propName,
					className: moduleName,
					returns,
					throws,
					apiReturns,
					paramsFromAst: signatureTypes?.params,
					declaredReturnFromAst: signatureTypes?.declaredReturn,
				})
			}
		}
	}
}

function getMethodSignatureTypes(
	member: ts.MethodDeclaration,
	checker: ts.TypeChecker,
	options: VisitNodeOptions,
): {
	params: { name: string; type: string }[]
	declaredReturn: string
} | undefined {
	const sig = checker.getSignatureFromDeclaration(member)
	if (!sig) return undefined

	const params: { name: string; type: string }[] = []
	for (let i = 0; i < member.parameters.length; i++) {
		const p = member.parameters[i]!
		const paramName = ts.isIdentifier(p.name) ? p.name.text : `arg${i}`
		const t = checker.getTypeAtLocation(p)
		params.push({
			name: paramName,
			type: options.expandParamTypes
				? expandTypeToShapeString(t, checker, p, {
						...options.expandParamTypesOptions,
						program: options.program ?? options.expandParamTypesOptions?.program,
					})
				: checker.typeToString(t),
		})
	}

	const ret = checker.getReturnTypeOfSignature(sig)
	const declaredReturn = checker.typeToString(ret)

	return { params, declaredReturn }
}

function hasCatDecorator(member: ts.MethodDeclaration): boolean {
	const mods = member.modifiers
	if (!mods) return false
	return mods.some((mod) => {
		if (!ts.isDecorator(mod)) return false
		const expr = mod.expression
		if (ts.isIdentifier(expr) && expr.text === 'Cat') return true
		if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
			return expr.expression.text === 'Cat'
		}
		return false
	})
}

export function visitNode(
	node: ts.Node,
	_source: ts.SourceFile,
	checker: ts.TypeChecker,
	results: AstMethodResult[],
	options: VisitNodeOptions,
): void {
	tryVisitFunctionalRegistrations(node, checker, results, options)
	if (ts.isClassDeclaration(node) && node.name) {
		const className = node.name.text
		for (const member of node.members) {
			if (!ts.isMethodDeclaration(member)) continue
			if (!hasCatDecorator(member)) continue
			const name = member.name
			if (!ts.isIdentifier(name)) continue
			const fnName = name.text
			const returns: { label: string; type: string }[] = []
			const throws: { label: string; type: string }[] = []
			const apiReturns: { label: string; statusCode: number | null; bodyType: string }[] = []
			if (member.body) {
				scanForReturns(member.body, checker, returns)
				scanForThrows(member.body, checker, throws)
				scanForApiReturns(member.body, checker, apiReturns)
			}
			const signatureTypes = getMethodSignatureTypes(member, checker, options)
			results.push({
				fnName,
				className,
				returns,
				throws,
				apiReturns,
				paramsFromAst: signatureTypes?.params,
				declaredReturnFromAst: signatureTypes?.declaredReturn,
			})
		}
	}
	ts.forEachChild(node, (child) => visitNode(child, _source, checker, results, options))
}
