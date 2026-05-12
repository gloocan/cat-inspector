# Artifact, storage, and job patterns (QA SDK)

This note describes **recommended shapes** for large payloads and long-running work. The wire model stays **JSON RPC**; bytes and durable objects live **outside** `result` when possible.

## Artifacts (presigned URL / object key)

Handlers return **small JSON** that references bytes elsewhere:

```json
{
  "uploadUrl": "https://storage.example/presigned-put",
  "objectKey": "imports/abc",
  "expiresAt": "2026-01-01T00:00:00.000Z"
}
```

- **Secrets** stay in **env / vault**; the host implements signing inside a **`StorageAdapter`** (see `BootstrapOptions.storage` in [`bootstrap.ts`](../src/bootstrap.ts)).
- If you set **`artifactThresholdBytes`** on `bootstrap.storage`, you **must** supply **`adapter`** or bootstrap throws `QA_STORAGE_NOT_CONFIGURED` (fail-fast).

## In-memory QA uploads today

Socket.IO + `__qaFileRef` + `InMemoryUploadStore` cover **moderate** uploads for QA. For **large / durable** files, use **object storage** and return handles as above.

## Jobs (quick return + progress)

1. First RPC returns `{ "jobId": "…", "status": "queued" }`.
2. Host code calls `InMemoryJobRegistry` (or your store) and **`broadcastJobProgress`** so the inspector / QA UI can show progress.
3. Poll with a second `fnKey` (e.g. `QaJobs.getStatus`) or consume `JOB_PROGRESS` events on WebSocket.

Use [`InMemoryJobRegistry`](../src/jobs/in-memory-job-registry.ts) as a **demo** implementation.

## Sessions (multi-step state)

- **WebSocket** (embedded inspector): send `SESSION_CREATE` / `SESSION_STEP` JSON messages; server replies with `SESSION_STATE` or `SESSION_ERROR`. See [`protocol-client.md`](protocol-client.md).
- **Socket.IO**: `playground:session:create` and `playground:session:step` with **ack** payloads carrying `sessionId` and merged `data`.

## See also

- [qa-sdk-extension-architecture.md](qa-sdk-extension-architecture.md)
- [qa-sdk-limitations-and-wrappers.md](qa-sdk-limitations-and-wrappers.md)
