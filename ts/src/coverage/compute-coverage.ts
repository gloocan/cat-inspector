import fs from 'node:fs'
import path from 'node:path'

import ts from 'typescript'

import { getAllTsFiles, type GetAllTsFilesOptions } from '../ast/get-all-ts-files.js'
import type { RegistryEntry } from '../types.js'
import { scanExpressCandidates, type ScanExpressCandidatesOptions } from './scan-express-candidates.js'
import { scanReachableServices, type ScanReachableServicesOptions } from './scan-reachable-services.js'
import type { CandidateRef, CoverageCandidates, SourcePos } from './types.js'

export interface CoverageSummaryCounts {
	total: number
	wrapped: number
	left: number
}

export interface CoverageReport {
	summary: {
		middleware: CoverageSummaryCounts
		controllers: CoverageSummaryCounts
		services: CoverageSummaryCounts
	}
	left: {
		middleware: CandidateRef[]
		controllers: CandidateRef[]
		services: CandidateRef[]
	}
	meta: {
		scanRoots: string[]
		filesScanned: number
		generatedAt: string
		protocolVersion: number
		unresolvedHandlers: number
		nodesVisited: number
	}
}

export interface ComputeCoverageOptions {
	scanRoots: string[]
	registrySnapshot: Record<string, RegistryEntry>
	getAllTsFilesOptions?: GetAllTsFilesOptions
	compilerOptions?: ts.CompilerOptions
	maxServiceNodes?: number
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

function posToTsPosition(source: ts.SourceFile, p: SourcePos): number {
	return ts.getPositionOfLineAndCharacter(source, p.line - 1, p.col - 1)
}

function findSmallestNodeContainingPosition(
	source: ts.SourceFile,
	position: number,
): ts.Node | null {
	let found: ts.Node | null = null
	const visit = (n: ts.Node): void => {
		const start = n.getStart(source, false)
		const end = n.getEnd()
		if (position < start || position > end) return
		found = n
		ts.forEachChild(n, visit)
	}
	visit(source)
	return found
}

function getStringLiteralText(node: ts.Expression | undefined): string | null {
	if (!node) return null
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
	return null
}

function hasDecoratorNamed(node: ts.Node, name: string): boolean {
	const mods = (node as { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers
	if (!mods) return false
	return mods.some((m) => {
		if (!ts.isDecorator(m)) return false
		const expr = m.expression
		if (ts.isIdentifier(expr)) return expr.text === name
		if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) return expr.expression.text === name
		return false
	})
}

function resolveAliasedSymbol(checker: ts.TypeChecker, sym: ts.Symbol | undefined): ts.Symbol | null {
	if (!sym) return null
	let cur: ts.Symbol | null = sym
	for (let i = 0; i < 10 && cur; i++) {
		if (cur.flags & ts.SymbolFlags.Alias) {
			cur = checker.getAliasedSymbol(cur)
			continue
		}
		return cur
	}
	return cur
}

function tryResolveFnKeyFromNode(
	checker: ts.TypeChecker,
	node: ts.Node,
): string | null {
	// @Cat method: ClassName.method
	if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
		if (hasDecoratorNamed(node, 'Cat')) {
			const cls = node.parent
			if (ts.isClassDeclaration(cls) && cls.name) return `${cls.name.text}.${node.name.text}`
		}
	}

	// Identifier used in routing, e.g. `requireUser`, where definition is:
	// const requireUser = cat('AuthMiddleware.requireUser', fn)
	if (ts.isIdentifier(node)) {
		const sym = resolveAliasedSymbol(checker, checker.getSymbolAtLocation(node))
		const decl = sym?.getDeclarations?.()?.[0]
		if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
			const init = decl.initializer
			if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'cat') {
				return getStringLiteralText(init.arguments[0] as ts.Expression | undefined)
			}
		}
	}

	// Property access used in routing, e.g. `ctrl.create` or `ctrl.create.bind(ctrl)`
	// Try to resolve the symbol to a method declaration and check for @Cat.
	if (ts.isPropertyAccessExpression(node)) {
		const sym = resolveAliasedSymbol(checker, checker.getSymbolAtLocation(node.name))
		const decl = sym?.getDeclarations?.()?.[0]
		if (decl && ts.isMethodDeclaration(decl) && ts.isIdentifier(decl.name)) {
			if (hasDecoratorNamed(decl, 'Cat')) {
				const cls = decl.parent
				if (ts.isClassDeclaration(cls) && cls.name) return `${cls.name.text}.${decl.name.text}`
			}
		}
	}

	// Bind call: `ctrl.create.bind(ctrl)` => underlying `ctrl.create`
	if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
		if (node.expression.name.text === 'bind') {
			const inner = node.expression.expression
			if (ts.isPropertyAccessExpression(inner) || ts.isIdentifier(inner)) {
				return tryResolveFnKeyFromNode(checker, inner)
			}
		}
	}

	return null
}

function enrichCandidatesWithResolvedFnKeys(
	program: ts.Program,
	candidates: CandidateRef[],
): CandidateRef[] {
	const checker = program.getTypeChecker()
	const out: CandidateRef[] = []

	for (const c of candidates) {
		const source = program.getSourceFile(c.source.file)
		if (!source) {
			out.push(c)
			continue
		}
		const position = posToTsPosition(source, c.source)
		const node = findSmallestNodeContainingPosition(source, position)
		if (!node) {
			out.push(c)
			continue
		}
		const resolved = tryResolveFnKeyFromNode(checker, node)
		out.push({
			...c,
			resolvedFnKey: resolved ?? c.resolvedFnKey ?? null,
		})
	}

	return out
}

function splitWrappedLeft(
	items: CandidateRef[],
	wrappedFnKeys: Set<string>,
): { wrapped: CandidateRef[]; left: CandidateRef[] } {
	const wrapped: CandidateRef[] = []
	const left: CandidateRef[] = []
	for (const c of items) {
		const key = c.resolvedFnKey ?? null
		if (key && wrappedFnKeys.has(key)) wrapped.push(c)
		else left.push(c)
	}
	return { wrapped, left }
}

export function computeCoverageReport(
	options: ComputeCoverageOptions,
): { candidates: CoverageCandidates; report: CoverageReport } {
	const scanRoots = options.scanRoots
	if (scanRoots.length === 0) {
		throw new Error('computeCoverageReport: scanRoots must include at least one directory')
	}
	const scanRoot = scanRoots[0]!

	// 1) Candidates (HTTP)
	const scanOpts: ScanExpressCandidatesOptions = {
		getAllTsFilesOptions: options.getAllTsFilesOptions,
		compilerOptions: options.compilerOptions,
		ownedRoots: options.scanRoots,
	}
	const http = scanExpressCandidates(scanRoot, scanOpts)

	// 2) Reachable services
	const svc = scanReachableServices(scanRoot, {
		...scanOpts,
		maxNodes: options.maxServiceNodes,
	} satisfies ScanReachableServicesOptions)

	const wrappedFnKeys = new Set(Object.keys(options.registrySnapshot))

	// 3) Build a TS program so we can infer fnKeys for unwrapped route handlers too.
	const files = [...new Set(scanRoots.flatMap((r) => getAllTsFiles(r, options.getAllTsFilesOptions)))]
	const compilerOptions = loadCompilerOptions(scanRoot, options.compilerOptions)
	const program = ts.createProgram(files, compilerOptions)

	const middleware = enrichCandidatesWithResolvedFnKeys(program, http.middleware)
	const controllers = enrichCandidatesWithResolvedFnKeys(program, http.controllers)
	const services = enrichCandidatesWithResolvedFnKeys(program, svc.services)

	const mwSplit = splitWrappedLeft(middleware, wrappedFnKeys)
	const ctrlSplit = splitWrappedLeft(controllers, wrappedFnKeys)
	const svcSplit = splitWrappedLeft(services, wrappedFnKeys)

	const candidates: CoverageCandidates = {
		middleware,
		controllers,
		services,
		meta: {
			filesScanned: files.length,
			unresolvedHandlers: http.meta.unresolvedHandlers,
			droppedThirdParty: http.meta.droppedThirdParty,
		},
	}

	const report: CoverageReport = {
		summary: {
			middleware: {
				total: middleware.length,
				wrapped: mwSplit.wrapped.length,
				left: mwSplit.left.length,
			},
			controllers: {
				total: controllers.length,
				wrapped: ctrlSplit.wrapped.length,
				left: ctrlSplit.left.length,
			},
			services: {
				total: services.length,
				wrapped: svcSplit.wrapped.length,
				left: svcSplit.left.length,
			},
		},
		left: {
			middleware: mwSplit.left,
			controllers: ctrlSplit.left,
			services: svcSplit.left,
		},
		meta: {
			scanRoots,
			filesScanned: files.length,
			generatedAt: new Date().toISOString(),
			protocolVersion: 0,
			unresolvedHandlers: http.meta.unresolvedHandlers,
			nodesVisited: svc.meta.nodesVisited,
		},
	}

	return { candidates, report }
}

