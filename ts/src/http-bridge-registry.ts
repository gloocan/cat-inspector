import type { Express } from 'express'

import type { HttpMethod } from './express.js'
import { invokeExpressSynthetic } from './express.js'
import { Registry } from './registry-state.js'

export type HttpBridgeSpec = {
	app: Express
	method: HttpMethod
	path: string
	mapArgsToBody: (args: unknown[]) => unknown
}

const bridges = new Map<string, HttpBridgeSpec>()

/**
 * Map a catalogued `fnKey` to an in-process HTTP call (Pattern B). Requires an existing `Registry` entry.
 * Side effect: sets `entry.invokeKind = 'http_synthetic'`.
 */
export function registerHttpBridgeRoute(
	app: Express,
	spec: { fnKey: string; method: HttpMethod; path: string; mapArgsToBody: (args: unknown[]) => unknown },
): void {
	const e = Registry.get(spec.fnKey)
	if (!e) {
		throw new Error(`registerHttpBridgeRoute: unknown fnKey "${spec.fnKey}"`)
	}
	if (bridges.has(spec.fnKey)) {
		throw new Error(`registerHttpBridgeRoute: duplicate registration for "${spec.fnKey}"`)
	}
	e.invokeKind = 'http_synthetic'
	bridges.set(spec.fnKey, {
		app,
		method: spec.method,
		path: spec.path,
		mapArgsToBody: spec.mapArgsToBody,
	})
}

export function getHttpBridgeSpec(fnKey: string): HttpBridgeSpec | undefined {
	return bridges.get(fnKey)
}

export function clearHttpBridgeRegistry(): void {
	bridges.clear()
}

export async function runHttpBridgeInvoke(
	spec: HttpBridgeSpec,
	args: unknown[],
): Promise<{ statusCode: number; headers: Record<string, string>; body: unknown }> {
	const body = spec.mapArgsToBody(args)
	const out = await invokeExpressSynthetic(spec.app, {
		method: spec.method,
		path: spec.path,
		body,
	})
	return { statusCode: out.statusCode, headers: out.headers, body: out.bodyJson }
}
