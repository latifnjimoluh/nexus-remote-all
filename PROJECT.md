# Project: Nexus Remote All — Security, Resilience & Exhaustive Testing

## Architecture
Nexus Remote All is a cross-platform remote control system comprising:
- `@nexus/server`: Node.js / Express / ws backend controlling OS input (nut.js, keyboard, mouse, media, app launcher) and Smart TVs (SSDP, UPnP, DIAL, Roku ECP). Listens on HTTP 4700 and WS 4701.
- `@nexus/client`: Modern PWA (Vite / TypeScript / CSS) providing trackpad, keyboard, TV remotes, and device discovery. Connects directly over LAN (WS/HTTP) or via Cloud Relay.
- `@nexus/relay`: WebSocket relay server running on remote cloud endpoint facilitating NAT traversal and end-to-end encrypted tunneling (AES-256-GCM).
- `@nexus/desktop`: Electron wrapper embedding the server with tray icon, desktop UI, and settings.
- `e2e`: Playwright end-to-end test suite for browser/PWA interactions.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Input Schema Validation | Deterministic validation for all 15 protocol commands in `validateCommand` | M1 | Survey (F1) |
| 2 | Loopback-Only Pairing QR & Display | Restrict `GET /pair/qr` and `/pair/display` strictly to loopback (127.0.0.1/::1) | M1 | Survey (F2) |
| 3 | TV Command & Disconnect Auth | Require valid JWT Bearer on `POST /pair/tv/command` and `POST /pair/disconnect` | M1 | Survey (F3) |
| 4 | Cryptographic PIN Lifecycle | `crypto.randomInt()`, 5-minute TTL, automatic PIN regeneration on pair | M1 | Survey (F4) |
| 5 | Per-IP Rate Limiting | Per-remote-IP attempt counter and lockout on `POST /pair/verify-pin` | M1 | Survey (F5) |
| 6 | Cloud Relay E2EE Replay Defense | Monotonic sequence counter (`seq`) and timestamp (`ts`) validation in E2EE payloads | M1 | Survey (F6) |
| 7 | Prototype Pollution Hardening | `Object.hasOwn()` guards on KEYMAP, APPS, and TV commands dictionary lookups | M1 | Survey (F7) |
| 8 | Production Dev Token Removal | Remove static dev token backdoor in production, enforce `HS256` in JWT verify | M1 | Survey (F8) |
| 9 | Desktop UI XSS Sanitization | Use `textContent` and sanitize remote device names in Electron DOM | M1 | Survey (F9) |
| 10 | Server WS Heartbeat & Keepalive | 15s ping/pong sweep, termination of dead sockets, prevention of ghost sockets | M2 | Survey (F10) |
| 11 | Safe WS Send & Error Handlers | `ws.on("error")` handler on all sockets and `readyState === OPEN` guards | M2 | Survey (F11) |
| 12 | Agent Server Clean Shutdown API | Expose `stop()` / `close()` on AgentHandle to prevent port locks on 4700/4701 | M2 | Survey (F12) |
| 13 | Mouse Cursor Concurrency Sync | Sequence/queue cursor relative movements to eliminate lost updates | M2 | Survey (F13) |
| 14 | Unique Client Token Identity | Unique `sub` / `jti` per client token to prevent cascade disconnect on kick | M2 | Survey (F14) |
| 15 | Touch Streaming Coalescence | rAF / 60Hz touch delta throttling and bounded queue to prevent crypto lag | M2 | Survey (F15) |
| 16 | Relay Reconnect Deadlock Fix | Handle abrupt client reconnect without 4009 already_paired deadlock | M2 | Survey (F16) |
| 17 | Dynamic DNS-Rebinding Host Check | Query active network interfaces dynamically instead of static boot-time cache | M2 | Survey (F17) |
| 18 | Single-Channel TV Dispatch | Remove redundant HTTP fetch when TV command is dispatched via WebSocket | M2 | Survey (F18) |
| 19 | Monorepo Script Harmonization | Add `typecheck` and `build` to `desktop/package.json` and harmonize root scripts | M3 | Survey (F19) |
| 20 | Tier 1 Unit Test Suite | Comprehensive unit tests for `validate.ts`, `e2e.ts`, `pairing.ts`, `middleware.ts` | M3 | Survey (F20) |
| 21 | Tier 2 Integration & Security Suite | Automated HTTP & WS security matrices (401/403/429), PIN brute force, replay tests | M3 | Survey (F21) |
| 22 | Tier 3 Resilience & Stress Suite | 1,000 rapid event burst, memory leak check, abrupt disconnect cleanup | M3 | Survey (F22) |
| 23 | Tier 4 Browser Playwright Expansion | Playwright tests for Trackpad, Media/Keyboard, Device modal, offline PWA | M4 | Survey (F23) |
| 24 | Non-Regression & Monorepo Validation | 100% green `npm test`, `npm run typecheck`, and `npm run build` across all workspaces | M4 | Survey (F24) |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Security Hardening & Input Defense | Features 1–9: auth, PIN, loopback check, replay defense, validation, XSS | none | DONE |
| M2 | Network Resilience & Concurrency | Features 10–18: heartbeat, shutdown API, cursor sync, throttling, relay fix | M1 | DONE |
| M3 | Automated Multi-Tier Test Suite | Features 19–22: scripts harmonization, Tiers 1–3 (unit, integration, stress) | M1, M2 | DONE |
| M4 | E2E Playwright & Full Verification | Features 23–24: Tier 4 browser tests, full non-regression, 100% green test | M3 | DONE |

## Interface Contracts
### Client ↔ Server (LAN WebSocket: 4701)
- Handshake query: `?token=<jwt>`
- Ping/Pong: Server sends WS Ping frame every 15s; Client responds with Pong frame. 2 missed cycles -> terminate with code 4008.
- Message format: `{ type: string, ...payload }` conforming strictly to `validateCommand()`.

### Client ↔ Server (Cloud Relay Tunnel)
- Encrypted envelope: `{ n: string, d: string, seq: number, ts: number }`
  - `n`: Base64 12-byte IV
  - `d`: Base64 AES-256-GCM ciphertext + 16-byte auth tag
  - `seq`: Monotonically increasing sequence integer (starts at 1)
  - `ts`: Epoch millisecond timestamp (|server_ts - client_ts| <= 60000ms)

### Server HTTP Pairing API (Port 4700)
- `GET /pair/qr`, `GET /pair/display`: Restricted to 127.0.0.1, ::1, ::ffff:127.0.0.1. Rejects external LAN with 403.
- `POST /pair/verify-pin`: `{ pin: string }`. Returns `{ token, host, wsPort }`. Max 5 failed attempts per client IP -> 429 for 60s.
- `POST /pair/tv/command`: Header `Authorization: Bearer <token>`. Body `{ targetIp, action, value }`.
- `POST /pair/disconnect`: Header `Authorization: Bearer <token>`. Body `{ id }`.

## Code Layout
- `server/src/`:
  - `agent.ts`: HTTP/WS server lifecycle, heartbeat, host validation, shutdown API.
  - `auth/pairing.ts`: PIN generation, rate limiting, loopback security, pairing routes.
  - `auth/middleware.ts`: JWT verification, Bearer auth helper.
  - `controllers/`: `mouse.ts` (cursor sync), `keyboard.ts`, `launcher.ts`, `tv.ts`.
  - `validate.ts`: Runtime protocol validation.
  - `e2e.ts`, `relay-client.ts`: Cloud relay AES-GCM crypto with seq & ts.
- `client/src/`:
  - `core/ws-client.ts`: WS client, auto-reconnect with backoff, E2EE envelope encryption with seq & ts.
  - `core/discovery.ts`: Single-channel dispatch for TV commands.
  - `modules/trackpad/index.ts`: Touch event coalescing and throttling.
- `relay/src/`:
  - `index.ts`: Reconnect handling without 4009 deadlock.
- `desktop/`:
  - `package.json`: typecheck and build scripts.
  - `ui/index.html`: DOM sanitization with textContent.
- `tests/` / `server/test/`:
  - Automated unit, integration, and resilience test suites.
- `e2e/`:
  - Playwright browser test specifications.
