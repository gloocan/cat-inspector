# @gloocan/cat-inspector

TypeScript SDK for **registering allowlisted backend functions** so QA and inspection tools get a **catalog** (ids, parameters, return metadata, optional JSON Schema), then **invoke** those units over a **versioned** wire protocol—embedded WebSocket, Socket.IO, or remote bridge—not arbitrary code execution from the network.

**Typical host:** Node.js with **Express** (or similar). Types ship with the package (`dist/*.d.ts`).

---

## Install

```bash
npm install @gloocan/cat-inspector
```

Install **peer** packages you actually use in your app (npm does not install peers for you):

| Peer            | When you need it                                      |
| --------------- | ----------------------------------------------------- |
| `express`       | Express integration (`registerCatPipeline`, etc.).  |
| `socket.io`     | Socket.IO transport (`@gloocan/cat-inspector/socket-io`). Optional. |
| `minio`         | Optional host-side object storage helpers.          |

Always install **`reflect-metadata`** if you use **`@Cat`** decorators (see TypeScript below).

---

## Package entry points

The package is **ESM** (`"type": "module"`).

| Import from                         | Use for |
| ----------------------------------- | ------- |
| `@gloocan/cat-inspector`            | Main API: registration, `bootstrap`, Express, RPC, WebSocket server, types, policy, validation, etc. |
| `@gloocan/cat-inspector/socket-io`  | `attachCatRPC`, Socket.IO–oriented helpers. Requires `socket.io` as a dependency. |

---

## TypeScript and decorators

For **`@Cat`** (and related metadata), enable decorator emit and load reflect metadata **before** other app imports:

1. `npm install reflect-metadata`
2. At the **top** of your app entry (e.g. `server.ts`): `import 'reflect-metadata'`
3. In `tsconfig.json`:

```json
{
	"compilerOptions": {
		"experimentalDecorators": true,
		"emitDecoratorMetadata": true
	}
}
```

If you only use the **functional** API (`cat()`, `catModule()`, …), decorators may be unnecessary; still follow the docs for your chosen registration style.

---

## Quick examples: registration

Each example uses a **stable function id** (`fnKey`) such as `Orders.find`—that id is what the catalog and RPC clients use. Pick ids that stay stable across refactors.

### `cat()` — one function

Wrap a plain function and give it a unique key. For HTTP-style handlers you can pass `route` / `method` so the catalog knows the path.

```ts
import { cat, Return, Throw } from '@gloocan/cat-inspector'

export const findUser = cat('Users.findById', function findUser(id: string) {
	if (!id) return Throw('INVALID', new Error('id required'))
	return Return('OK', { id, name: 'Ada' })
})
```

Call `findUser('42')` as normal; the wrapper records **which labeled branch** ran for inspector UIs.

### `@Cat` — class methods

Requires `reflect-metadata` and the `tsconfig.json` flags above. Registration runs when the class is **loaded**.

```ts
import 'reflect-metadata'
import { Cat, Return } from '@gloocan/cat-inspector'

export class Billing {
	@Cat
	estimate(total: number) {
		return Return('QUOTE', { cents: Math.round(total * 100) })
	}
}
```

The catalog entry key becomes **`Billing.estimate`** (class name + method name).

### `catModule()` — a namespace of functions

Registers every export under **`${moduleName}.${methodName}`** in one call.

```ts
import { catModule, Return } from '@gloocan/cat-inspector'

export const inventory = catModule('Inventory', {
	list() {
		return Return('LIST', [{ sku: 'a1' }])
	},
	reserve(sku: string) {
		return Return('RESERVED', { sku, qty: 1 })
	},
})
// Keys: Inventory.list, Inventory.reserve — call inventory.list() as usual.
```

Optional third argument lets you attach per-method `params`, `declaredReturn`, or `paramsJsonSchema` (see typings).

### `registerCatPipeline()` — Express route + middleware chain

Pass an Express `Router`, HTTP method, route path, and an array of **already wrapped** `cat()` handlers. The **last** handler is the route endpoint; earlier entries are treated as middleware (`req`, `res`, `next`).

```ts
import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import { cat, registerCatPipeline, Return } from '@gloocan/cat-inspector'

const router = express.Router()

const requireAuth = cat('Api.requireAuth', (req: Request, res: Response, next: NextFunction) => {
	// …validate session, then:
	next()
})

const getProfile = cat('Api.getProfile', (req: Request, res: Response) => {
	return Return('BODY', { userId: req.params['id'] })
})

registerCatPipeline(router, 'get', '/users/:id', [requireAuth, getProfile])
// app.use('/v1', router)
```

The SDK aligns all handlers in the array with one **pipeline id** (e.g. `GET /users/:id`) so tools see middleware + endpoint as one HTTP unit.

---

## `Return()` and `Throw()` — labels for tooling

These helpers are **no-ops for business data**: they return or throw the same values you would use without Cat Inspector. Their job is to attach a **string label** so QA clients and the catalog can distinguish branches (success variants, validation failures, expected errors) without parsing your whole codebase.

| Helper | What you write | What QA / catalog sees |
| ------ | -------------- | ---------------------- |
| `Return(label, value)` | `return Return('CREATED', entity)` | Outcome tied to label **`CREATED`**; payload is `value` (types/shapes can be captured for assertions). |
| `Throw(label, error)` | `return Throw('NOT_FOUND', new Error('…'))` | Expected error path **`NOT_FOUND`** with message/stack; still throws `error` to callers. |

**Labels** are arbitrary string literals you choose (`'OK'`, `'INVALID'`, `'QUOTE'`, …). Use short, stable names: they become part of how teams author **assertions** (“expect `Users.findById` to resolve with label `OK`”).

**Data:** the second argument to `Return` is whatever your function would normally return. `Throw` always takes an `Error` (or subclass); use normal `throw new Error()` for unexpected failures you do **not** want labeled.

Combine with `cat` / `@Cat` / `catModule` so the inspector knows **which function** is active when a label fires (`ActiveContext` is managed by the wrappers).

---

## Minimal integration shape

Exact APIs depend on your stack; most setups touch these ideas in order:

1. **Register** testable units (`@Cat`, `cat`, `catModule`, class helpers, `registerInstance`, …).
2. **Wire Express** (e.g. `registerCatPipeline`, correlation middleware) so HTTP routes map to catalog entries.
3. **Expose a transport** so a QA client can load the catalog and call `invoke`—e.g. `startInspectorWebSocket`, or `attachCatRPC` from the `socket-io` entry after you create your `socket.io` `Server`.

Example (illustrative only—adapt ports, CORS, and auth to your environment):

```ts
import 'reflect-metadata'

import express from 'express'
import http from 'node:http'
import { Server as SocketIOServer } from 'socket.io'

import {
	createInspectorCorrelationMiddleware,
	attachCatRPC,
} from '@gloocan/cat-inspector/socket-io'

const app = express()
app.use(express.json())
app.use('/api', createInspectorCorrelationMiddleware())

const server = http.createServer(app)
const io = new SocketIOServer(server, {
	cors: { origin: 'http://localhost:3013' },
})

attachCatRPC(io, {
	scanRoots: [new URL('.', import.meta.url).pathname],
	serverId: 'my-service',
	isDevelopment: process.env.NODE_ENV !== 'production',
	// bootstrap, upload, auth: see docs and PROTOCOL.md in the source repo
})

server.listen(5050)
```

For **`executeRPC`**, validation, serialization limits, pre-invoke hooks, and audits, import from `@gloocan/cat-inspector`.

---

## Wire protocol and versioning

Clients and hosts must agree on JSON message shapes. The SDK exports **`PROTOCOL_VERSION`** from the main entry—bump-aware clients should read it and follow the contract documented alongside the source tree.

**Note:** The **published npm tarball** contains **`dist/`** (compiled JS + declarations) plus standard metadata. Markdown references such as **`PROTOCOL.md`** live in the **source repository** (use the **Repository** link on the [npm package page](https://www.npmjs.com/package/@gloocan/cat-inspector) if your maintainers have set `repository` in `package.json`).

---

## Security (read before production)

- Only **registered** functions are invokable—treat registration as an **allowlist**.
- **Authenticate** transports in non-dev environments; do not expose invoke surfaces anonymously on the public internet.
- Prefer **read-only** or sandbox data for QA; avoid putting production secrets in tool-visible payloads.
- Configure **serialization limits**, **rate limits**, and **pre-invoke** hooks where appropriate (`setRpcSerializationConfig`, `configureInvokeRateLimit`, `registerPreInvoke`, …—see typings and docs).

---

## Documentation and examples

- **Product / docs site:** [cat-inspector.gloocan.com](https://cat-inspector.gloocan.com) (when available for your deployment).
- **Deep reference:** your team’s Nextra or internal doc site, if published.
- **Runnable monorepo example:** an Express + Socket.IO backend under the same repository as this package (search for `examples/cat-demo` in the SDK source tree).

---

## Public API surface

The supported public API is whatever **`@gloocan/cat-inspector` re-exports** from its main module (registration, `bootstrap`, Express helpers, `executeRPC`, transports, `PROTOCOL_VERSION`, wire types such as `RegistryEntry` and `RpcResponse`, validation helpers, policy hooks, uploads, coverage/OpenAPI helpers, sessions, etc.). Prefer importing from the package root rather than deep paths into `dist/`, which are not a stable contract.

---

## License

MIT — see the `license` field in `package.json`.
