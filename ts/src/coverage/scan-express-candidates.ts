import fs from 'node:fs'
import path from 'node:path'

import ts from 'typescript'

import { getAllTsFiles, type GetAllTsFilesOptions } from '../ast/get-all-ts-files.js'
import type { CandidateRef, CoverageCandidates, RouteInfo, SourcePos } from './types.js'

export interface ScanExpressCandidatesOptions {
	getAllTsFilesOptions?: GetAllTsFilesOptions
	/** Extra compiler options merged over parsed config */
	compilerOptions?: ts.CompilerOptions
	/** If set, only these files are in the program (for tests / narrow scans) */
	files?: string[]
	/**
	 * If set, only keep handlers whose resolved declaration source file is under one of these roots.
	 * Used to drop third-party middleware calls like `express.json()` from coverage totals.
	 */
	ownedRoots?: string[]
}

function loadCompilerOptions(
	rootDir: string,
	extra?: ts.CompilerOptions,
): ts.CompilerOptions {
	const configPath = ts.findConfigFile(rootDir, ts.sys.fileExists, 'tsconfig.json')
	if (!configPath) {
		return {
			...(extra ?? {}),
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.NodeNext,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
			strict: true,
		}
	}
	const read = ts.readConfigFile(configPath, (p) => fs.readFileSync(p, 'utf8'))
	if (read.error) {
		throw new Error(ts.formatDiagnostic(read.error, ts.createCompilerHost({})))
	}
	const parsed = ts.parseJsonConfigFileContent(
		read.config,
		ts.sys,
		path.dirname(configPath),
		undefined,
		configPath,
	)
	return { ...parsed.options, ...extra }
}

const HTTP_METHODS = new Set([
	'get',
	'post',
	'put',
	'delete',
	'patch',
	'options',
	'head',
	'all',
])

function isHttpMethodName(name: string): boolean {
	return HTTP_METHODS.has(name.toLowerCase())
}

function posOf(source: ts.SourceFile, node: ts.Node): SourcePos {
	const lc = source.getLineAndCharacterOfPosition(node.getStart(source, false))
	return {
		file: source.fileName,
		line: lc.line + 1,
		col: lc.character + 1,
	}
}

function stringLiteralText(expr: ts.Expression | undefined): string | null {
	if (!expr) return null
	if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text
	return null
}

function normalizeHandlerExpression(expr: ts.Expression): ts.Expression {
	// Unwrap `.bind(...)` so candidate points at the underlying method.
	// e.g. `ctrl.create.bind(ctrl)` -> `ctrl.create`
	if (
		ts.isCallExpression(expr) &&
		ts.isPropertyAccessExpression(expr.expression) &&
		expr.expression.name.text === 'bind'
	) {
		return expr.expression.expression
	}
	return expr
}

function flattenHandlers(expr: ts.Expression): ts.Expression[] {
	const n = normalizeHandlerExpression(expr)
	if (ts.isArrayLiteralExpression(n)) {
		const out: ts.Expression[] = []
		for (const el of n.elements) {
			if (ts.isSpreadElement(el)) {
				// Best-effort: treat spread as a single unresolved handler.
				out.push(el.expression)
			} else {
				out.push(el)
			}
		}
		return out.flatMap((e) => flattenHandlers(e))
	}
	return [n]
}

function exprDisplayName(source: ts.SourceFile, expr: ts.Expression): string {
	const normalized = normalizeHandlerExpression(expr)
	if (ts.isIdentifier(normalized)) return normalized.text
	if (ts.isPropertyAccessExpression(normalized)) return normalized.getText(source)
	if (ts.isFunctionExpression(normalized) || ts.isArrowFunction(normalized)) {
		return 'anonymous'
	}
	if (ts.isCallExpression(normalized)) return normalized.expression.getText(source)
	return normalized.getText(source)
}

function maybeResolveFnKeyFromExpression(expr: ts.Expression): string | null {
	// Only handles easy/stable shapes. Anything else returns null.
	const n = normalizeHandlerExpression(expr)
	if (ts.isPropertyAccessExpression(n)) {
		// obj.method -> unknown class; but for Cat we usually want Class.method.
		// Without type resolution we can't safely map obj->ClassName.
		return null
	}
	if (ts.isIdentifier(n)) {
		// Named function like `requireUser` - no stable fnKey without convention.
		return null
	}
	return null
}

function routeInfoFromCall(methodName: string, pathExpr: ts.Expression | undefined): RouteInfo {
	const p = stringLiteralText(pathExpr)
	return {
		method: methodName.toUpperCase(),
		path: p ?? '<dynamic>',
	}
}

function extractHandlersForExpressCall(
	calleeName: string,
	args: readonly ts.Expression[],
): { route: RouteInfo | null; handlers: ts.Expression[] } | null {
	const lower = calleeName.toLowerCase()

	if (lower === 'use') {
		// app.use([path], ...handlers)
		const first = args[0]
		const maybePath = stringLiteralText(first)
		const startIdx = maybePath !== null ? 1 : 0
		const handlers = args.slice(startIdx).flatMap((a) => flattenHandlers(a))
		return { route: null, handlers }
	}

	if (!isHttpMethodName(lower)) return null

	// app.get(path, ...handlers)
	const route = routeInfoFromCall(lower, args[0])
	const handlers = args.slice(1).flatMap((a) => flattenHandlers(a))
	return { route, handlers }
}

function extractHandlersForRegisterCatPipelineCall(
	args: readonly ts.Expression[],
): { route: RouteInfo | null; handlers: ts.Expression[] } | null {
	// registerCatPipeline(router, method, route, handlersArray)
	const methodExpr = args[1]
	const routeExpr = args[2]
	const handlersExpr = args[3]
	if (!methodExpr || !routeExpr || !handlersExpr) return null

	const methodText = stringLiteralText(methodExpr) ?? '<dynamic>'
	const routeText = stringLiteralText(routeExpr) ?? '<dynamic>'
	const route: RouteInfo = {
		method: methodText === '<dynamic>' ? '<dynamic>' : methodText.toUpperCase(),
		path: routeText,
	}

	// Only support literal arrays in V1 (best-effort).
	if (!ts.isArrayLiteralExpression(handlersExpr)) return { route, handlers: [] }
	const handlers = flattenHandlers(handlersExpr)
	return { route, handlers }
}

function tryExtractExpressRegistration(
	node: ts.Node,
): { route: RouteInfo | null; handlers: ts.Expression[]; methodName: string } | null {
	if (!ts.isCallExpression(node)) return null

	// registerCatPipeline(router, method, route, handlers)
	if (ts.isIdentifier(node.expression) && node.expression.text === 'registerCatPipeline') {
		const extracted = extractHandlersForRegisterCatPipelineCall(node.arguments)
		if (extracted) return { ...extracted, methodName: 'registerCatPipeline' }
	}

	// Handle `router.route('/x').get(...handlers)` chains.
	if (ts.isPropertyAccessExpression(node.expression)) {
		const methodName = node.expression.name.text
		if (isHttpMethodName(methodName) || methodName.toLowerCase() === 'use') {
			// Normal: router.get(...) / app.use(...)
			const extracted = extractHandlersForExpressCall(methodName, node.arguments)
			if (extracted) return { ...extracted, methodName }
		}

		// Chain: router.route('/x').get(...)
		// node.expression.expression should be a CallExpression of `.route('/x')`
		const inner = node.expression.expression
		if (
			isHttpMethodName(methodName) &&
			ts.isCallExpression(inner) &&
			ts.isPropertyAccessExpression(inner.expression) &&
			inner.expression.name.text === 'route'
		) {
			const route = routeInfoFromCall(methodName, inner.arguments[0])
			const handlers = node.arguments.flatMap((a) => flattenHandlers(a))
			return { route, handlers, methodName }
		}
	}

	return null
}

export function scanExpressCandidates(
	rootDir: string,
	options: ScanExpressCandidatesOptions = {},
): CoverageCandidates {
	const files =
		options.files ?? getAllTsFiles(rootDir, options.getAllTsFilesOptions)
	const compilerOptions = loadCompilerOptions(rootDir, options.compilerOptions)
	const program = ts.createProgram(files, compilerOptions)
	const checker = program.getTypeChecker()

	const middleware: CandidateRef[] = []
	const controllers: CandidateRef[] = []
	let unresolvedHandlers = 0
	let droppedThirdParty = 0

	const ownedRoots = (options.ownedRoots ?? []).map((p) => path.resolve(p))

	function isOwnedSourceFile(fileName: string): boolean {
		const norm = fileName.split(path.sep).join('/')
		if (norm.includes('/node_modules/')) return false
		if (ownedRoots.length === 0) return true
		const abs = path.resolve(fileName)
		return ownedRoots.some((r) => abs === r || abs.startsWith(r + path.sep))
	}

	function resolveHandlerDeclaration(expr: ts.Expression): ts.Declaration | null {
		const n = normalizeHandlerExpression(expr)
		// Inline definitions are always owned.
		if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return n
		if (ts.isIdentifier(n)) {
			const sym = checker.getSymbolAtLocation(n)
			return (sym?.getDeclarations?.()?.[0] as ts.Declaration | undefined) ?? null
		}
		if (ts.isPropertyAccessExpression(n)) {
			const sym = checker.getSymbolAtLocation(n.name)
			return (sym?.getDeclarations?.()?.[0] as ts.Declaration | undefined) ?? null
		}
		// Factory calls (express.json()) are typically third-party. Drop unless we can resolve to owned.
		if (ts.isCallExpression(n)) {
			const sym = checker.getSymbolAtLocation(n.expression)
			return (sym?.getDeclarations?.()?.[0] as ts.Declaration | undefined) ?? null
		}
		return null
	}

	function shouldKeepHandler(expr: ts.Expression): boolean {
		const decl = resolveHandlerDeclaration(expr)
		if (!decl) return false
		return isOwnedSourceFile(decl.getSourceFile().fileName)
	}

	for (const filePath of files) {
		const source = program.getSourceFile(filePath)
		if (!source) continue

		const visit = (node: ts.Node): void => {
			const reg = tryExtractExpressRegistration(node)
			if (reg) {
				const hs = reg.handlers
				if (hs.length > 0) {
					if (reg.route) {
						// For route method calls, last handler is the controller.
						for (let i = 0; i < hs.length; i++) {
							const h = hs[i]!
							if (!shouldKeepHandler(h)) {
								droppedThirdParty++
								continue
							}
							const kind = i === hs.length - 1 ? 'controller' : 'middleware'
							const name = exprDisplayName(source, h)
							const pos = posOf(source, h)
							const resolvedFnKey = maybeResolveFnKeyFromExpression(h)

							const base: CandidateRef = {
								kind,
								name,
								source: pos,
								route: reg.route,
								resolvedFnKey,
								_nodeKind: h.kind,
							}
							if (kind === 'controller') controllers.push(base)
							else middleware.push(base)

							if (resolvedFnKey === null) unresolvedHandlers++
						}
					} else {
						// use(): treat all as middleware.
						for (const h of hs) {
							if (!shouldKeepHandler(h)) {
								droppedThirdParty++
								continue
							}
							const name = exprDisplayName(source, h)
							const pos = posOf(source, h)
							const resolvedFnKey = maybeResolveFnKeyFromExpression(h)
							middleware.push({
								kind: 'middleware',
								name,
								source: pos,
								resolvedFnKey,
								_nodeKind: h.kind,
							})
							if (resolvedFnKey === null) unresolvedHandlers++
						}
					}
				}
			}

			ts.forEachChild(node, visit)
		}

		visit(source)
	}

	return {
		middleware,
		controllers,
		services: [],
		meta: {
			filesScanned: files.length,
			unresolvedHandlers,
			droppedThirdParty,
		},
	}
}

