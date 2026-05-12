/** Parameter names from Function#toString — no execution */
export function extractParamNames(fn: Function): string[] {
	const src = fn.toString()
	const match = /\(([^)]*)\)/.exec(src)
	if (!match || !match[1].trim()) return []

	return match[1]
		.split(',')
		.map((p) => p.trim().split(':')[0]?.replace(/=.+/, '').trim())
		.filter((p): p is string => Boolean(p))
}

export function getFunctionBody(fn: Function): string {
	const src = fn.toString()
	const start = src.indexOf('{')
	const end = src.lastIndexOf('}')
	if (start === -1 || end === -1) return ''
	return src.slice(start + 1, end).trim()
}

/**
 * Regex scan for Return("LABEL", ...) — no execution.
 * Supports direct `Return("L", v)` and bundler comma form `(0,Return)("L", v)`.
 */
export function extractReturnLabels(body: string): string[] {
	const labels: string[] = []
	const direct = /Return\w*\(\s*["'`](\w+)["'`]/g
	const commaCallee = /Return\w*\)\s*\(\s*["'`](\w+)["'`]/g
	let match: RegExpExecArray | null
	while ((match = direct.exec(body)) !== null) labels.push(match[1]!)
	while ((match = commaCallee.exec(body)) !== null) labels.push(match[1]!)
	return labels
}

/**
 * Regex scan for Throw("LABEL", ...) — no execution.
 * Supports direct `Throw("L", err)` and bundler comma form `(0,Throw)("L", err)`.
 */
export function extractThrowLabels(body: string): string[] {
	const labels: string[] = []
	const direct = /Throw\w*\(\s*["'`](\w+)["'`]/g
	const commaCallee = /Throw\w*\)\s*\(\s*["'`](\w+)["'`]/g
	let match: RegExpExecArray | null
	while ((match = direct.exec(body)) !== null) labels.push(match[1]!)
	while ((match = commaCallee.exec(body)) !== null) labels.push(match[1]!)
	return labels
}

/**
 * Regex scan for ApiReturn("LABEL", ...) — no execution.
 * Supports direct `ApiReturn("L", ...)` and bundler comma form `(0,ApiReturn)("L", ...)`.
 */
export function extractApiReturnLabels(body: string): string[] {
	const labels: string[] = []
	const direct = /ApiReturn\w*\(\s*["'`](\w+)["'`]/g
	const commaCallee = /ApiReturn\w*\)\s*\(\s*["'`](\w+)["'`]/g
	let match: RegExpExecArray | null
	while ((match = direct.exec(body)) !== null) labels.push(match[1]!)
	while ((match = commaCallee.exec(body)) !== null) labels.push(match[1]!)
	return labels
}
