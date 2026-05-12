import ts from 'typescript'

export interface ExpandTypeOptions {
	maxDepth?: number
	maxProps?: number
	maxUnion?: number
	maxLen?: number
	/** When set (e.g. from runASTScanner), lib/external object types collapse to `typeToString` (e.g. `File`). */
	program?: ts.Program
	/**
	 * When true, object/interface types declared only in default or external library sources use short names.
	 * Default: `true` when `program` is set, otherwise `false`.
	 */
	collapseLibOrExternalObjectShapes?: boolean
}

const DEFAULT_EXPAND_TYPE_OPTIONS: Required<
	Pick<ExpandTypeOptions, 'maxDepth' | 'maxProps' | 'maxUnion' | 'maxLen'>
> = {
	maxDepth: 3,
	maxProps: 30,
	maxUnion: 5,
	maxLen: 2000,
}

type ResolvedExpandOptions = typeof DEFAULT_EXPAND_TYPE_OPTIONS & {
	program?: ts.Program
	collapseLibOrExternalObjectShapes: boolean
}

type ExpandState = {
	seen: Set<ts.Type>
}

function resolveExpandOptions(opts: ExpandTypeOptions = {}): ResolvedExpandOptions {
	const collapseLibOrExternalObjectShapes =
		opts.collapseLibOrExternalObjectShapes ?? Boolean(opts.program)
	return {
		maxDepth: opts.maxDepth ?? DEFAULT_EXPAND_TYPE_OPTIONS.maxDepth,
		maxProps: opts.maxProps ?? DEFAULT_EXPAND_TYPE_OPTIONS.maxProps,
		maxUnion: opts.maxUnion ?? DEFAULT_EXPAND_TYPE_OPTIONS.maxUnion,
		maxLen: opts.maxLen ?? DEFAULT_EXPAND_TYPE_OPTIONS.maxLen,
		program: opts.program,
		collapseLibOrExternalObjectShapes,
	}
}

function resolveNonAliasSymbol(type: ts.Type, checker: ts.TypeChecker): ts.Symbol | undefined {
	let sym = type.aliasSymbol ?? type.getSymbol()
	if (!sym) return undefined
	while (sym.flags & ts.SymbolFlags.Alias) {
		sym = checker.getAliasedSymbol(sym)
	}
	return sym
}

/** True when every declaration lives in TS default libs or node_modules / external typings. */
function shouldCollapseObjectTypeToName(
	program: ts.Program | undefined,
	collapse: boolean,
	checker: ts.TypeChecker,
	type: ts.Type,
): boolean {
	if (!collapse || !program) return false
	const sym = resolveNonAliasSymbol(type, checker)
	if (!sym?.declarations?.length) return false
	return sym.declarations.every((decl) => {
		const sf = decl.getSourceFile()
		return program.isSourceFileDefaultLibrary(sf) || program.isSourceFileFromExternalLibrary(sf)
	})
}

function withFallback(
	type: ts.Type,
	checker: ts.TypeChecker,
	value: string,
	options: ResolvedExpandOptions,
): string {
	if (value.length > options.maxLen) return checker.typeToString(type)
	return value
}

function isOptionalProperty(symbol: ts.Symbol): boolean {
	if ((symbol.flags & ts.SymbolFlags.Optional) !== 0) return true
	return symbol.declarations?.some((decl) => {
		return (
			(ts.isPropertySignature(decl) || ts.isPropertyDeclaration(decl) || ts.isParameter(decl)) &&
			decl.questionToken !== undefined
		)
	}) ?? false
}

function expandTypeInternal(
	type: ts.Type,
	checker: ts.TypeChecker,
	contextNode: ts.Node,
	options: ResolvedExpandOptions,
	depth: number,
	state: ExpandState,
): string {
	if (depth >= options.maxDepth) return checker.typeToString(type)

	if (state.seen.has(type)) return checker.typeToString(type)

	if (checker.isArrayType(type)) {
		const [elementType] = checker.getTypeArguments(type as ts.TypeReference)
		if (!elementType) return checker.typeToString(type)
		const expanded = expandTypeInternal(
			elementType,
			checker,
			contextNode,
			options,
			depth + 1,
			state,
		)
		return withFallback(type, checker, `Array<${expanded}>`, options)
	}

	if (checker.isTupleType(type)) {
		const tupleArgs = checker
			.getTypeArguments(type as ts.TypeReference)
			.map((arg) => expandTypeInternal(arg, checker, contextNode, options, depth + 1, state))
		return withFallback(type, checker, `[${tupleArgs.join(', ')}]`, options)
	}

	if (type.isUnion()) {
		const booleanLike = new Set(type.types.map((part) => checker.typeToString(part)))
		if (booleanLike.size === 2 && booleanLike.has('false') && booleanLike.has('true')) {
			return 'boolean'
		}
		if (type.types.length > options.maxUnion) return checker.typeToString(type)
		const parts = type.types.map((part) =>
			expandTypeInternal(part, checker, contextNode, options, depth + 1, state),
		)
		return withFallback(type, checker, parts.join(' | '), options)
	}

	if (type.isIntersection()) {
		if (type.types.length > options.maxUnion) return checker.typeToString(type)
		const parts = type.types.map((part) =>
			expandTypeInternal(part, checker, contextNode, options, depth + 1, state),
		)
		return withFallback(type, checker, parts.join(' & '), options)
	}

	const primitiveString = checker.typeToString(type)
	if ((type.flags & ts.TypeFlags.Object) === 0) return primitiveString

	const properties = checker.getPropertiesOfType(type)
	if (properties.length === 0) return primitiveString
	if (properties.length > options.maxProps) return primitiveString

	if (
		shouldCollapseObjectTypeToName(
			options.program,
			options.collapseLibOrExternalObjectShapes,
			checker,
			type,
		)
	) {
		return primitiveString
	}

	state.seen.add(type)
	try {
		const fields = properties.map((symbol) => {
			const propertyType = checker.getTypeOfSymbolAtLocation(symbol, contextNode)
			const propText = expandTypeInternal(
				propertyType,
				checker,
				contextNode,
				options,
				depth + 1,
				state,
			)
			return `${symbol.getName()}${isOptionalProperty(symbol) ? '?' : ''}: ${propText}`
		})
		return withFallback(type, checker, `{ ${fields.join('; ')} }`, options)
	} finally {
		state.seen.delete(type)
	}
}

export function expandTypeToShapeString(
	type: ts.Type,
	checker: ts.TypeChecker,
	contextNode: ts.Node,
	opts: ExpandTypeOptions = {},
): string {
	const options = resolveExpandOptions(opts)

	if (options.maxDepth <= 0 || options.maxProps <= 0 || options.maxUnion <= 0 || options.maxLen <= 0) {
		return checker.typeToString(type)
	}

	return expandTypeInternal(type, checker, contextNode, options, 0, { seen: new Set() })
}
