/**
 * Optional class decorator to enable singleton fallback construction for `@Cat` RPC.
 *
 * Usage:
 *   @CatClass()
 *   class UserService { ... }
 */
export declare function CatClass(): ClassDecorator;
/** Alias for readability in app code */
export declare const CatService: typeof CatClass;
//# sourceMappingURL=cat-class.d.ts.map