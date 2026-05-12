import fs from 'node:fs'
import path from 'node:path'

import ts from 'typescript'

import { getAllTsFiles, type GetAllTsFilesOptions } from './get-all-ts-files.js'
import type { ExpandTypeOptions } from './type-expand.js'
import type { AstMethodResult } from './visit-node.js'
import { visitNode } from './visit-node.js'

export interface RunAstScannerOptions {
	getAllTsFilesOptions?: GetAllTsFilesOptions
	/** Extra compiler options merged over parsed config */
	compilerOptions?: ts.CompilerOptions
	/** If set, only these files are in the program (for tests / narrow scans) */
	files?: string[]
	expandParamTypes?: boolean
	expandParamTypesOptions?: ExpandTypeOptions
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
			experimentalDecorators: true,
			emitDecoratorMetadata: true,
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

export function runASTScanner(
	rootDir: string,
	options: RunAstScannerOptions = {},
): AstMethodResult[] {
	const files =
		options.files ?? getAllTsFiles(rootDir, options.getAllTsFilesOptions)
	const results: AstMethodResult[] = []
	const compilerOptions = loadCompilerOptions(rootDir, options.compilerOptions)

	const program = ts.createProgram(files, compilerOptions)
	const checker = program.getTypeChecker()

	for (const filePath of files) {
		const source = program.getSourceFile(filePath)
		if (!source) continue
		ts.forEachChild(source, (node) =>
			visitNode(node, source, checker, results, {
				expandParamTypes: options.expandParamTypes ?? true,
				expandParamTypesOptions: options.expandParamTypesOptions,
				program,
			}),
		)
	}

	return results
}
