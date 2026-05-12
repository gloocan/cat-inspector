## Protocol / wire format notes

This package uses a versioned wire protocol via `PROTOCOL_VERSION` in [`sdk/ts/src/types.ts`](sdk/ts/src/types.ts).

For no-code QA limitations, wrapper patterns (streaming, sessions), and catalog flow, see [`docs/qa-sdk-limitations-and-wrappers.md`](docs/qa-sdk-limitations-and-wrappers.md).

For **hard-case coverage** (wrapper contracts, serialization rules, policy model, pattern catalog, failure semantics, coverage matrix), see [`docs/qa-sdk-wrappers-hard-cases.md`](docs/qa-sdk-wrappers-hard-cases.md).

- **`PROTOCOL_VERSION = 5`**: Registry entries include richer parameter metadata for file materialization (`params[].kind`, `params[].filePaths`, `params[].fileArrayPaths`) used by the QA UI + Socket.IO runtime.
- **`PROTOCOL_VERSION = 6`**: Adds optional **control messages** on the embedded WebSocket transport (`SESSION_CREATE`, `SESSION_STEP` → `SESSION_STATE` / `SESSION_ERROR`) and optional inspector **`JOB_PROGRESS`** events (same JSON fan-out as other inspector events). Strict clients may ignore unknown `type` / `event` values. See [docs/protocol-client.md](docs/protocol-client.md).
- **`PROTOCOL_VERSION = 7`**: `RPC_RESPONSE` may include optional **`artifacts`**: an array of `{ kind: string, uploadUrl?, objectKey?, expiresAt?, ... }` (artifact refs for QA UIs). **`error.code`** (optional string) is also documented for machine-readable failures (e.g. `FN_NOT_FOUND`, `INVOKE_TIMEOUT`, `RETURN_SCHEMA_INVALID`); strict clients may ignore unknown fields.
- **`PROTOCOL_VERSION = 8`**: Embedded **`ws`** transport (`startInspectorWebSocket`) may accept the same **QA upload** contract as Socket.IO: JSON messages **`QA_UPLOAD_START`**, **`QA_UPLOAD_CHUNK`** (base64 in **`b64`**), **`QA_UPLOAD_FINISH`**, **`QA_UPLOAD_ABORT`**, with replies **`QA_UPLOAD_ACK`**, **`QA_UPLOAD_PROGRESS`**, **`QA_UPLOAD_COMPLETE`**, **`QA_UPLOAD_ERROR`** (only when `upload.enabled` is set on the server). **`RPC_CALL`** then materializes `{ "__qaFileRef": "<uploadId>" }` via the in-memory upload store before `executeRPC`. See [docs/protocol-client.md](docs/protocol-client.md).
- **`PROTOCOL_VERSION = 9`**: **`BOOTSTRAP` / `catalog:bootstrap`** may include **`qaFileWire`** (`{ "mode": "ref" | "url" }`, default `ref`), optional **`qaMediaUpload`** (`{ "target": "admin" | "host" }`), optional **`fileUrl`** (public slice: `allowedHosts`, `maxDownloadBytes`, `timeoutMs`, …), and optional **`qaMediaUploadHostUploadUrl`** (HTTPS URL for host-side upload; no secrets). Registry **`params[]`** may echo **`qaFileWire`** / **`qaMediaUpload`** on file-capable parameters for QA UIs. **`RPC_CALL`** may materialize **`__qaFileUrl`** placeholders via HTTPS fetch when `fileUrl` is configured, even if `upload.enabled` is false. Host-only credentials (**`hostMinio`**, etc.) must never appear on the wire.
- **`PROTOCOL_VERSION = 10`**: When the host is configured for **URL wire** + **`qaMediaUpload.target === "host"`** + **`hostMinio`** (host process only; stripped before bootstrap), **`catalog:bootstrap`** may include **`qaHostMediaUploadViaSocket: true`**. Tenants may then stream file bytes over **Socket.IO** using **`qa:hostMedia:start`** (JSON: `uploadId`, `filename`, `contentType`, `sizeBytes`), **`qa:hostMedia:chunk`** (binary chunk; same framing style as **`qa:upload:chunk`**), **`qa:hostMedia:finish`** (`{ uploadId }`), and **`qa:hostMedia:abort`**. Server replies: **`qa:hostMedia:ack`**, **`qa:hostMedia:progress`**, **`qa:hostMedia:complete`** (`{ uploadId, getUrl }` — presigned **GET** URL for materialize), **`qa:hostMedia:error`**. Limits reuse the host’s ref-upload **`upload`** options (`maxSizeBytes`, `idleTimeoutMs`) on a separate in-memory assembly buffer. **Precedence:** if **`qaMediaUploadHostUploadUrl`** is present, clients may keep using **HTTP POST** (legacy); otherwise **`qaHostMediaUploadViaSocket`** is the host-media path. **`fileUrl.allowedHosts`** must allow the hostname used on presigned GET URLs for invoke-time fetch.

## Remote WebSocket bridge (optional process)

[`startRemoteInspectorBridge`](../src/transport/remote-inspector-bridge.ts) listens on a local port and **proxies** all WebSocket messages to an existing embedded inspector URL (same JSON shapes and **`PROTOCOL_VERSION`** on payloads). After `npm run build` in `sdk/ts`, run **`node dist/transport/remote-bridge-cli.js`** with environment variables **`BRIDGE_PORT`** (default `9339`) and **`TARGET_WS_URL`** (default `ws://127.0.0.1:9234`). Contract tests live in [`remote-inspector-bridge.test.ts`](../src/transport/remote-inspector-bridge.test.ts).

## Type extraction notes (registry `params` / `declaredReturn`)

There are two ways registry entries get parameter/return type strings:

- **`@Cat` (decorator)**: uses runtime `reflect-metadata` (`design:paramtypes`, `design:returntype`) for class methods.
- **`cat()` / `catModule()` (functional registration)**:
  - runtime registration defaults `params[].type` / `declaredReturn` to `"unknown"` (TypeScript types are erased at runtime for plain functions)
  - **`bootstrap()` AST scan + merge** backfills `params` and `declaredReturn` from the TypeScript checker when source files are available
  - optional manual type hints can be provided to `cat()` / `catModule()` as a fallback when bootstrap isn't run

When changing the shape of any WebSocket message or required fields on registry entries, bump `PROTOCOL_VERSION` and update tests in [`sdk/ts/src/transport/ws-server.test.ts`](sdk/ts/src/transport/ws-server.test.ts).

## File params (Socket.IO upload + invoke-time materialization)

The catalog may mark parameters as file-capable so the QA UI can present file pickers and the runtime can replace wire placeholders with real values before invoking handlers.

- **`params[].kind`**:
  - `file`: single file value (e.g. `File`, `Blob`, `Buffer`)
  - `files`: array of files (e.g. `File[]`)
  - omitted: treat as JSON-only
- **`params[].filePaths`**: nested single-file fields inside an object parameter (e.g. `input.file`)
- **`params[].fileArrayPaths`**: nested multi-file fields inside an object parameter (e.g. `input.attachments`)

### Wire placeholders (JSON-safe)

- Single file (upload store): `{ "__qaFileRef": "<uploadId>" }`
- Multiple files (upload store):
  - `{ "__qaFileRefs": ["<id1>", "<id2>"] }`
  - or `[ { "__qaFileRef": "<id1>" }, { "__qaFileRef": "<id2>" } ]`
- Single file (URL, when `qaFileWire.mode` is `url` and `fileUrl` is configured): `{ "__qaFileUrl": "<https://...>" }`
- Multiple files (URL): `{ "__qaFileUrls": ["<url1>", "<url2>"] }` or `[{ "__qaFileUrl": "..." }, ...]`

Never send **both** `__qaFileRef` and `__qaFileUrl` on the same leaf. Placeholders are only accepted at indices/paths declared by the catalog; otherwise they are treated as validation errors.

### Scope note (WebSocket-only transport)

The embedded WebSocket server (`sdk/ts/src/transport/ws-server.ts`) supports **JSON** control frames including **`QA_UPLOAD_*`** (protocol v8+) when **`startInspectorWebSocket({ upload: { enabled: true } })`** is set; chunk bytes are sent as **base64** in **`QA_UPLOAD_CHUNK.b64`**, mirroring Socket.IO’s `qa:upload:*` semantics and the same **`materializeServiceArgsForInvoke`** path. **Host Minio / `qa:hostMedia:*`** is implemented on **Socket.IO** (`attachCatRPC`) only in v10+, not on the embedded **`ws`** inspector. If uploads are disabled, use Socket.IO, enable **`upload`** on the embedded server, or use a separate HTTP upload API (multipart/presigned).

## RPC execution notes (instance resolution)

`executeRPC()` supports two registry styles:

- **`style: "function"`** (`cat()` / `catModule()`): RPC invokes `RegistryEntry.originalFn` directly. No `registerInstance(...)` is required.
- **`style: "class"`** (`@Cat`): RPC needs an instance for `ClassName` and resolves it in this order:
  - explicit `registerInstance(new Service())`
  - cached auto-created singleton instance
  - constructor fallback: `@Cat` auto-registers the owning class constructor, and RPC will `new Service()` on first call and cache it

If none of the above provide an instance, RPC returns `NO_INSTANCE`.

### Caveat (important)

Auto-instantiation assumes the service class constructor is **safe to run automatically** (ideally zero-arg, no heavy side effects). If your service requires DI constructor args, prefer explicit `registerInstance(...)`.

