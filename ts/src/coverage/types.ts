import ts from 'typescript'

export type CandidateKind = 'middleware' | 'controller' | 'service'

export interface SourcePos {
	file: string
	line: number
	col: number
}

export interface RouteInfo {
	method: string
	path: string
}

export interface CandidateRef {
	kind: CandidateKind
	name: string
	source: SourcePos
	route?: RouteInfo
	/** Best-effort stable id when derivable; for Cat this is typically `Class.method`. */
	resolvedFnKey?: string | null
	/** Internal: raw node kind for debugging */
	_nodeKind?: ts.SyntaxKind
}

export interface CoverageCandidates {
	middleware: CandidateRef[]
	controllers: CandidateRef[]
	services: CandidateRef[]
	meta: {
		filesScanned: number
		unresolvedHandlers: number
		droppedThirdParty: number
	}
}

