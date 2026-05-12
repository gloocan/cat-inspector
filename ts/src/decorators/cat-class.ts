import { registerClassConstructor } from '../registry-state.js'

/**
 * Optional class decorator to enable singleton fallback construction for `@Cat` RPC.
 *
 * Usage:
 *   @CatClass()
 *   class UserService { ... }
 */
export function CatClass(): ClassDecorator {
	return (target) => {
		const ctor = target as unknown as new (...args: any[]) => any
		const name = (ctor as { name?: string }).name ?? ''
		if (!name) return
		registerClassConstructor(name, ctor)
	}
}

/** Alias for readability in app code */
export const CatService = CatClass

