# E2E Test Infra: Nexus Remote All

## Test Philosophy
- Requirement-driven and opaque-box.
- Multi-tier validation: Category-Partition, Boundary Value Analysis, Concurrency/Stress, and Browser Workload Testing.
- 100% deterministic green exit across automated runs.

## Feature Inventory & Test Mapping
| # | Feature | Requirement | Tier 1 (Unit) | Tier 2 (Integration) | Tier 3 (Resilience) | Tier 4 (Browser E2E) |
|---|---------|-------------|:-------------:|:--------------------:|:-------------------:|:--------------------:|
| 1 | Input Schema Validation | R1 | ✓ (15 commands) | ✓ | - | - |
| 2 | Loopback-Only Pairing | R1 | - | ✓ (LAN 403, 127.0.0.1 200) | - | - |
| 3 | TV & Disconnect Auth | R1 | - | ✓ (401 unauth, 200 auth) | - | - |
| 4 | Cryptographic PIN Lifecycle | R1 | ✓ (randomness, TTL) | ✓ (verify PIN flow) | - | - |
| 5 | Per-IP Rate Limiting | R1 | - | ✓ (5 failed -> 429) | - | - |
| 6 | Cloud Relay E2EE Replay | R1 | ✓ (seq/ts window) | ✓ (replay rejected) | - | - |
| 7 | Prototype Pollution Hardening | R1 | ✓ (Object.hasOwn) | - | - | - |
| 8 | Production Dev Token Removal | R1 | ✓ (token verify) | - | - | - |
| 9 | Desktop UI XSS Sanitization | R1 | - | - | - | ✓ |
| 10 | WS Heartbeat & Keepalive | R2 | - | ✓ | ✓ (sweep dead sockets) | - |
| 11 | Safe WS Send & Error Handlers | R2 | - | ✓ | ✓ (error propagation) | - |
| 12 | Agent Server Clean Shutdown API | R2 | - | ✓ (stop() releases ports) | ✓ (port reuse test) | - |
| 13 | Mouse Concurrency Sync | R2 | ✓ (queue logic) | - | ✓ (concurrent moves) | - |
| 14 | Unique Client Token Identity | R2 | ✓ (sub/jti claims) | ✓ (kick isolation) | - | - |
| 15 | Touch Streaming Coalescence | R2 | ✓ (coalescing) | - | ✓ (1,000 burst stress) | - |
| 16 | Relay Reconnect Deadlock Fix | R2 | - | ✓ (reconnect takeover) | ✓ (abrupt drop test) | - |
| 17 | Dynamic DNS Host Check | R2 | ✓ | ✓ | - | - |
| 18 | Single-Channel TV Dispatch | R2 | - | ✓ (no duplicate exec) | - | ✓ |
| 19 | Monorepo Script Harmonization | R3, R4 | ✓ (typecheck/build) | - | - | - |
| 20 | Tier 1 Unit Test Suite | R3 | ✓ | - | - | - |
| 21 | Tier 2 Integration & Security | R3 | - | ✓ | - | - |
| 22 | Tier 3 Resilience & Stress | R2, R3 | - | - | ✓ | - |
| 23 | Tier 4 Browser Playwright | R3, R4 | - | - | - | ✓ |
| 24 | Monorepo Non-Regression | R4 | ✓ | ✓ | ✓ | ✓ |

## Test Architecture
- **Tier 1 (Unit)**: `node:test` + `tsx` running in-process tests for `validate.ts`, `e2e.ts`, `pairing.ts`, `middleware.ts`. Fast (<1s), no network dependencies.
- **Tier 2 (Integration & Security)**: Express/Supertest & WebSocket clients testing pairing API, 401/403/429 status codes, LAN vs loopback restrictions, and Cloud Relay protocol.
- **Tier 3 (Resilience & Stress)**: Dedicated stress runner simulating 1,000 rapid trackpad moves, abrupt TCP disconnects, ghost socket cleanup verification, and clean port release on 4700/4701.
- **Tier 4 (Browser Playwright)**: Headless Chromium running PWA interactions: TV remote, Trackpad UI, Network Device modal, offline PWA cache.
- **Unified Test Command**: Root `npm test` runs Tiers 1-3 and existing integration suites, ensuring 100% pass. Playwright suite executed via `npm --prefix e2e test` or unified script.

## Coverage Goals & Thresholds
- Tier 1: >= 30 test cases across validators, crypto, auth, and state logic.
- Tier 2: >= 20 test cases across HTTP security, WS security, rate limiting, and pairing.
- Tier 3: >= 10 resilience test scenarios (burst load, drop recovery, port rebind, replay rejection).
- Tier 4: >= 5 realistic browser interaction scenarios in Playwright.
- Monorepo Validation: `npm run typecheck`, `npm run build`, and `npm test` must all exit 0 with 100% green tests.
