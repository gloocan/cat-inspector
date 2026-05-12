import { registerClassConstructor } from '../registry-state.js';
/**
 * Optional class decorator to enable singleton fallback construction for `@Cat` RPC.
 *
 * Usage:
 *   @CatClass()
 *   class UserService { ... }
 */
export function CatClass() {
    return (target) => {
        const ctor = target;
        const name = ctor.name ?? '';
        if (!name)
            return;
        registerClassConstructor(name, ctor);
    };
}
/** Alias for readability in app code */
export const CatService = CatClass;
//# sourceMappingURL=cat-class.js.map