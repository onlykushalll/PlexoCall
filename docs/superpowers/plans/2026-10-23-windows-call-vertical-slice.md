# Plexocall Windows Call Vertical Slice Implementation Plan

**Goal:** Deliver a Windows-first Electron app that can create and join expiring invite rooms, publish and receive audio/video, share a screen, and show useful connection state using only owner-hosted services.

**Architecture:** React/Electron renderer uses LiveKit's React and JavaScript client SDKs. Electron main owns the narrow IPC bridge and calls the project control API. The control API persists invite capabilities in PostgreSQL and issues short-lived LiveKit room tokens; LiveKit OSS carries encrypted WebRTC media as an SFU. Development uses Docker Compose. No client binary contains LiveKit API secrets. The initial call path uses normal WebRTC ICE and recovery; bonding and third-party app routing remain future projects.

**Stack:** Electron + React + TypeScript + Vite + Tailwind; `@livekit/components-react`, `livekit-client`; Node.js + Fastify + PostgreSQL + `livekit-server-sdk`; LiveKit OSS container. Preserve the upstream Plexo MIT license and copied notices.

**Design source:** `docs/superpowers/specs/2026-10-23-plexocall-design.md` (approved). The chosen LiveKit stack and operational constraints follow the [LiveKit React Components docs](https://docs.livekit.io/reference/components/react/), [self-host deployment guide](https://docs.livekit.io/transport/self-hosting/deployment/), and [ports and firewall reference](https://docs.livekit.io/transport/self-hosting/ports-firewall/).

**Global constraints:** Windows desktop client only. Keep the renderer sandboxed with context isolation and a typed allow-listed preload API. Validate IPC sender and payloads. Keep service/API secrets out of the app. Store only invite hashes, expire invites, rate-limit public control routes, avoid recording/transcription/third-party telemetry, and describe server trust honestly. Do not claim zero loss or seamless multi-link failover. Do not add or run tests in this plan pass; provide reproducible manual setup/run instructions instead.

**Review focus:** API capability leakage, room/invite authorization and expiry, Electron IPC and deep-link validation, packaging boundary, microphone/camera/screen permission handling, Windows device behavior, participant track lifecycle, reconnect/error states, and accurate diagnostics.

## Task 1: Establish the Windows desktop shell

**Files:** `package.json`, `package-lock.json`, `electron.vite.config.ts`, `electron-builder.yml`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `.gitignore`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `src/main/index.ts`, `src/preload/index.ts`, `src/preload/globals.d.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/assets/main.css`.

1. Create a minimal app package from the reviewed Plexo shell/build configuration, with product metadata set to Plexocall and Windows x64/arm64 NSIS packaging only.
2. Remove torrent, download, browser-extension, updater, and platform-specific network-binding dependencies and scripts; keep only the Electron/React/UI/LiveKit client dependencies.
3. Adapt the Electron bootstrap to a single-instance Windows app, a fixed secure BrowserWindow policy, safe external-link handling, and the `plexocall://` invite scheme.
4. Preserve the Plexo MIT license and add a copied-file/dependency provenance note; do not ship the Plexo brand or claim upstream endorsement.
5. Keep CSP limited to app assets plus the configured HTTPS/WSS service/media endpoints needed by the call client.

**Acceptance:** The desktop source tree contains no Plexo download/torrent runtime modules; packaged identity and protocol are Plexocall; the renderer has no direct Node/Electron access.

## Task 2: Add the self-hosted call control service

**Files:** `services/control-api/package.json`, `services/control-api/package-lock.json`, `services/control-api/tsconfig.json`, `services/control-api/src/config.ts`, `services/control-api/src/db.ts`, `services/control-api/src/schema.sql`, `services/control-api/src/routes/calls.ts`, `services/control-api/src/server.ts`, `services/control-api/Dockerfile`, `infra/dev/compose.yaml`, `infra/dev/livekit.yaml`, `.env.example`.

1. Add a Fastify service with configuration validation, request body schemas, security headers, bounded request sizes, rate limits, and a health route.
2. Add PostgreSQL schema and parameterized data-access functions for call IDs, hashed invite/owner capabilities, a hashed create idempotency key and keyed display-name fingerprint, creation/expiry/revocation/room-close/final-close timestamps, and opaque LiveKit room names.
3. Implement create, join, and revoke routes. Derive high-entropy invite and owner capabilities from a random client idempotency key and the server secret; only return raw capabilities to the creating host; require the invite capability to join; scope short-lived LiveKit tokens to a single room; reject expired/revoked invitations; authorize revocation with the owner capability.
4. Serialize create-replay and join token issuance against revocation using the call row, and reconcile expired/revoked SFU room closure at startup and periodically. Repeat room closure through the three-minute participant-token grace window before finalizing. Keep owner controls and unresolved endpoint-specific create idempotency keys encrypted locally so a creator can recover after an app restart.
5. Ensure API errors/logs never include raw capabilities, tokens, or media; set sensible maximum participants and room TTL; never expose LiveKit API credentials in responses.
6. Add a local Compose stack for PostgreSQL, LiveKit, and the API with development-only credentials, persistent database volume, explicit UDP/TCP port mapping, and no public binding by default.

**Acceptance:** The control service can create/join/revoke an expiring room using only owner-run services; invalid, expired, revoked, malformed, or over-rate requests fail without returning credentials.

## Task 3: Build the narrow Electron-to-control API bridge

**Files:** `src/shared/call-contract.ts`, `src/main/apiClient.ts`, `src/main/settings.ts`, `src/main/ipc.ts`, `src/main/deepLinks.ts`, `src/preload/index.ts`, `src/preload/globals.d.ts`, `electron-builder.yml`.

1. Define typed IPC methods for reading/updating the service endpoint, creating/joining/revoking a room, and receiving a validated invite deep link.
2. Call the configured control API only from Electron main; apply endpoint URL policy, request timeout, response validation, and safe error mapping.
3. Validate that IPC messages come from the app's top-level renderer frame and reject unexpected senders or malformed arguments.
4. Support Windows protocol activation on first launch and second instance; parse only the exact `plexocall://join/<id>?invite=<capability>` format and pass validated data to the renderer.
5. Expose no generic `ipcRenderer`, filesystem, shell, or arbitrary-fetch capability to React.

**Acceptance:** Renderer can perform only the declared call operations; invalid deep links and IPC senders are ignored/rejected; the API URL and service secrets are not hard-coded into packaged source.

## Task 4: Deliver the call experience

**Files:** `src/renderer/src/App.tsx`, `src/renderer/src/call/CallHome.tsx`, `src/renderer/src/call/Prejoin.tsx`, `src/renderer/src/call/CallRoom.tsx`, `src/renderer/src/call/ParticipantGrid.tsx`, `src/renderer/src/call/CallControls.tsx`, `src/renderer/src/call/ConnectionStatus.tsx`, `src/renderer/src/call/callState.ts`, `src/renderer/src/assets/main.css`, `src/renderer/index.html`.

1. Build a focused home screen with display name, create-call, paste/open-invite join, service endpoint configuration, and a clear self-hosted service status.
2. Add a prejoin view with camera preview, microphone/camera selection, permission/device errors, and explicit Join action.
3. Integrate LiveKit room lifecycle using maintained React hooks/components: connect, local and remote audio/video, participant grid, camera/microphone toggles, screen sharing, leave, owner end/revoke, and rejoin/reconnect status.
4. Render remote audio through the supported room audio component; clean up room listeners, tracks, and screen-capture resources on leave or unmount.
5. Add per-call diagnostics for connection state, selected ICE path when available, round-trip time, jitter, packet loss, send/receive bitrate, and unavailable metrics; do not label an ICE path as multipath.
6. Make call errors actionable and avoid presenting a connected room as healthy when media is muted, permission-denied, or disconnected.

**Acceptance:** A user can create a room, copy a link, join by invite, communicate with multiple participants, share a screen, leave/end, and understand connection or device failures.

## Task 5: Document owner-run setup and release boundaries

**Files:** `README.md`, `docs/operations/self-hosting.md`, `docs/operations/privacy-and-security.md`, `docs/operations/windows-release.md`, `.env.example`, `THIRD_PARTY_NOTICES.md`.

1. Document Windows prerequisites, local Docker startup, API endpoint configuration, app development/packaging commands, and how a second device joins.
2. Separate local development instructions from internet deployment. Document trusted TLS, domain/public IP needs, firewall/UDP ports, TURN/TLS tradeoffs, backups, upgrades, and capacity limits based on official LiveKit guidance.
3. State that no paid vendor API is required, but internet availability, compute, public reachability, and bandwidth still have real infrastructure costs.
4. Document the invite capability model, data kept by the control service, server trust boundary, and the fact that app-managed E2EE key lifecycle is not yet implemented.
5. List deferred gates: public account/auth policy, app-level E2EE/key rotation, abuse controls beyond the alpha, multipath lab, and third-party app booster.

**Acceptance:** A project owner can run a local self-hosted development stack and knows the exact network/security work required before exposing it to internet users; no claim of production-hosted availability is made without an operator endpoint.

## Plan self-review

- Keeps the first milestone to an independently usable calling app and makes later multipath/booster work explicit follow-ons.
- Uses owner-hosted Postgres and LiveKit rather than a paid calling API; does not imply zero infrastructure cost.
- Calls out security boundaries across the renderer, main process, API, database, and SFU.
- Keeps UI, control-plane, desktop integration, and operations documentation in bounded file groups.
- Leaves the user with local run/deployment instructions; this plan does not claim public hosting or completed verification.
