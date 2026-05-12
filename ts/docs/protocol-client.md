# Minimal non-TypeScript client (WebSocket)

This document is enough to implement a **small client** in any language that speaks JSON over the **`ws`** library protocol used by [`startInspectorWebSocket`](../src/transport/ws-server.ts).

## Connect

```
ws://127.0.0.1:<port>/?token=<optional-authToken>
```

### Socket.IO (cat-demo / `attachCatRPC`)

Clients should use `io(baseUrl, { transports: ["websocket"], auth: { token: "<secret>" } })` when the host enables **`rpcAuth`** (for example cat-demo with **`QA_AUTH_TOKEN`** in **`NODE_ENV=production`**). In development, the token is optional unless you configure auth explicitly.

On **`catalog:bootstrap`** (protocol v10+), the host may include **`qaHostMediaUploadViaSocket`** when URL-mode host media is backed by Minio in-process; the tenant then uses **`qa:hostMedia:*`** events (see [`PROTOCOL.md`](../PROTOCOL.md)) instead of a separate HTTP **`qaMediaUploadHostUploadUrl`**. Admin presign flows are unchanged.

## Server → client: `BOOTSTRAP`

First message is JSON:

```json
{
  "event": "BOOTSTRAP",
  "protocolVersion": 10,
  "registry": { },
  "tree": []
}
```

## Client → server: `RPC_CALL`

```json
{
  "type": "RPC_CALL",
  "requestId": "uuid-or-string",
  "fnKey": "ClassName.methodName",
  "args": [ …positional args… ]
}
```

## Server → client: `RPC_RESPONSE`

```json
{
  "type": "RPC_RESPONSE",
  "requestId": "same-as-call",
  "fnKey": "ClassName.methodName",
  "status": "ok",
  "result": {},
  "returnType": "…",
  "returnShape": "…",
  "label": "…",
  "duration": "1.23ms",
  "error": null,
  "artifacts": [ { "kind": "example", "objectKey": "optional" } ]
}
```

`artifacts` is only present when the handler result carried artifact refs (protocol v7+). On errors, `error` may include optional **`code`** (string) alongside `message` / `layer` / `stack`.

## File uploads on embedded `ws` (protocol v8+)

When the host starts the server with **`upload.enabled: true`**, the client uploads bytes with the same lifecycle as Socket.IO’s `qa:upload:*` events, using **JSON messages** (base64 chunks for browser-friendly clients).

**Start**

```json
{
  "type": "QA_UPLOAD_START",
  "filename": "blob.bin",
  "contentType": "application/octet-stream",
  "sizeBytes": 1234,
  "uploadId": "optional-client-chosen-id"
}
```

**Server → `QA_UPLOAD_ACK`**

```json
{
  "type": "QA_UPLOAD_ACK",
  "protocolVersion": 10,
  "uploadId": "…",
  "accepted": true
}
```

**Chunk** (repeat until cumulative base64-decoded length equals `sizeBytes`)

```json
{ "type": "QA_UPLOAD_CHUNK", "b64": "<base64>" }
```

**Server → `QA_UPLOAD_PROGRESS`**

```json
{
  "type": "QA_UPLOAD_PROGRESS",
  "protocolVersion": 10,
  "uploadId": "…",
  "receivedBytes": 1234
}
```

**Finish**

```json
{ "type": "QA_UPLOAD_FINISH", "uploadId": "…" }
```

**Server → `QA_UPLOAD_COMPLETE`**

```json
{
  "type": "QA_UPLOAD_COMPLETE",
  "protocolVersion": 10,
  "uploadId": "…",
  "filename": "blob.bin",
  "contentType": "application/octet-stream",
  "receivedBytes": 1234
}
```

**Abort**

```json
{ "type": "QA_UPLOAD_ABORT" }
```

**Server → `QA_UPLOAD_ACK`** `{ "type": "QA_UPLOAD_ACK", "protocolVersion": 10, "aborted": true }`

**Errors → `QA_UPLOAD_ERROR`**

```json
{
  "type": "QA_UPLOAD_ERROR",
  "protocolVersion": 10,
  "code": "UPLOAD_CHUNK_FAILED",
  "message": "…",
  "uploadId": "… or null"
}
```

After a successful upload, reference the bytes in **`RPC_CALL.args`** using `{ "__qaFileRef": "<uploadId>" }` at catalog-approved positions (see [PROTOCOL.md](../PROTOCOL.md) file-param rules).

## Sessions (protocol v6+)

**Create**

```json
{ "type": "SESSION_CREATE", "requestId": "r1", "sessionKey": "optional-key" }
```

**Response**

```json
{
  "type": "SESSION_STATE",
  "protocolVersion": 10,
  "requestId": "r1",
  "sessionId": "uuid",
  "data": {}
}
```

**Step**

```json
{ "type": "SESSION_STEP", "requestId": "r2", "sessionId": "…", "step": "name", "payload": { "any": "json" } }
```

**Response:** another `SESSION_STATE` with merged `data`.

## Remote bridge (optional)

To reach an embedded inspector that only listens on another interface or port, run the packaged CLI after building `sdk/ts`: `node dist/transport/remote-bridge-cli.js` with **`TARGET_WS_URL`** pointing at the real inspector and **`BRIDGE_PORT`** for where your QA client connects. The bridge forwards JSON WebSocket frames unchanged.

## Sample clients

- Python: [`examples/protocol-smoke/client.py`](../../examples/protocol-smoke/client.py) (requires `websockets`).
- Go: [`examples/protocol-smoke/client.go`](../../examples/protocol-smoke/client.go) (requires `github.com/gorilla/websocket`).
