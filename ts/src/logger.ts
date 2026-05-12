export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
	debug: (...args: unknown[]) => void
	info: (...args: unknown[]) => void
	warn: (...args: unknown[]) => void
	error: (...args: unknown[]) => void
}

const PREFIX = '[cat-inspector]'

export function createLogger(level: LogLevel = 'info'): Logger {
	const order: LogLevel[] = ['debug', 'info', 'warn', 'error']
	const min = order.indexOf(level)

	function emit(
		lv: LogLevel,
		fn: typeof console.log,
		args: unknown[],
	): void {
		if (order.indexOf(lv) < min) return
		fn(PREFIX, ...args)
	}

	return {
		debug: (...args: unknown[]) => emit('debug', console.log, args),
		info: (...args: unknown[]) => emit('info', console.log, args),
		warn: (...args: unknown[]) => emit('warn', console.warn, args),
		error: (...args: unknown[]) => emit('error', console.error, args),
	}
}
