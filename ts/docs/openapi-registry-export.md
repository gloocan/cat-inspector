# OpenAPI export from the registry

`exportRegistryOpenApi(registry, opts?)` returns a minimal **OpenAPI 3.1** JSON document derived from a `Record<string, RegistryEntry>` snapshot.

- Entries with **`route`** and **`httpMethod`** become real path operations (summary = `fnKey`).
- Every `fnKey` also gets a documented **`POST /qa/rpc/{fnKey}`** request body schema mirroring `RPC_CALL` (this path is **not** mounted by the SDK; it is for QA tooling and client generators).

Import from the package root:

```ts
import { exportRegistryOpenApi } from '@gloocan/cat-inspector'
```
