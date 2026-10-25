# butchr-servr

First control-panel sprint for Butchr: authorizations → deployments → process sessions, and authorization-scoped remote briefs. Built for Bun 1.3.11+, with no production npm dependencies.

```sh
bun install
bun run typecheck
bun test
bun start
```

Open http://127.0.0.1:7731. Hosting is **loopback only**. `BUTCHR_SERVR_PORT` changes the loopback port; `BUTCHR_SERVR_DB` changes the SQLite path (default `runtime/control.sqlite`). Keep that directory private. Tests use memory-only generated keys or an explicitly nonsecret mock in disposable temporary databases.

## Security and keys

**Key issuance is disabled by default.** Enabling `BUTCHR_SERVR_ENABLE_KEY_ISSUANCE=1` permits an operator to create authorizations in the dashboard. Enable only after your action-time security approval. No default key exists. The dashboard reveals a new 256-bit bearer key once; SQLite stores its SHA-256 hash only. Keys have no automatic expiry in this sprint; revoke an authorization to stop future connections immediately. Clients refresh every 15 seconds and remove their remote library on failed authentication.

A key permits only identity registration/heartbeat and reading remote briefs assigned to its authorization, through `POST /v1/connect`. It does not grant admin, brief editing, shell execution or fleet control. Anyone holding it can register claimed IDs under that authorization and read those briefs. No hardware/device attestation is provided. Last-seen timestamps report contact, not guaranteed liveness.

Admin pages/APIs require a loopback connection from the same Unix UID, exact Host and compatible Origin/Fetch Metadata. Writes require same Origin, JSON and a per-process CSRF token. Key issuance cannot be unlocked through HTTP. The Linux/macOS peer UID helper is carried from the existing Butchr implementation; unknown peer ownership fails closed. Do not proxy or expose this service publicly. HTTP is acceptable only for this Codey loopback scope; other hosts/TLS/authentication are future work.

Brief content is displayed as plain text in the server dashboard. Client Markdown rendering must ignore raw HTML and unsafe URLs. Remote IDs include persistent server ID, authorization ID and brief ID, avoiding collisions with local/custom records. Revoking or deleting a server brief never deletes existing independent client copies.

The client sends `{deploymentId, sessionId}` with `Authorization: Bearer <key>`. Deployment ID persists; session ID is fresh per process and stable across retries. The response contains `serverId`, `authorizationId` and `briefs`. The server persists first/last contact and deduplicates the authorization/deployment/session tuple. There are 100 briefs, 1,000 deployments and 10,000 sessions per authorization, with a 240 requests/minute per-authorization connection limit. This is an initial local panel, not a multi-tenant internet service.

## Local operations

Back up the SQLite database while the process is stopped. Restarting preserves server identity, authorizations, hierarchy and briefs. No raw keys, client credentials or runtime data belong in Git. The `runtime/` directory is ignored. Server data and the client credential file require private filesystem permissions. Do not log authorization headers or reveal keys in URLs, process arguments, reports or screenshots.

Implementation uses Bun's SQLite API and browser-native DOM rendering. `src/peer-uid.ts` is adapted from the existing MIT-licensed Butchr same-UID guard, preserving its security checks. This repository contains only the server sprint; Butchr client integration is maintained separately.
