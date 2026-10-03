import { WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { startAgent } from "../../server/dist/server/src/agent.js";
import { CONFIG } from "../../server/dist/server/src/config.js";
import { revokeToken } from "../../server/dist/server/src/auth/middleware.js";
import { getPortPair } from "../helpers/ports.mjs";

export async function runTest() {
  console.log("  ▶ [Tier 2] Test WebSocket Handshake Authentication & Anti-DNS Rebinding");
  let passed = 0;
  let failed = 0;
  const assert = (cond, msg) => {
    if (cond) {
      passed++;
      console.log(`    ✔ [PASS] ${msg}`);
    } else {
      failed++;
      console.error(`    ✖ [FAIL] ${msg}`);
    }
  };

  const { httpPort, wsPort } = await getPortPair();
  const agent = await startAgent({
    httpPort,
    wsPort,
    log: false,
    enableCloud: false,
    enableMdns: false,
  });

  const validToken = jwt.sign({ role: "remote", sub: "ws-auth-client-1" }, CONFIG.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "1h",
  });
  const revokedToken = jwt.sign({ role: "remote", sub: "ws-revoked-client-1" }, CONFIG.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "1h",
  });
  revokeToken(revokedToken);

  const attemptConnect = (url, headers = {}) => {
    return new Promise((resolve) => {
      const ws = new WebSocket(url, { headers });
      ws.on("open", () => {
        ws.close();
        resolve({ success: true, statusCode: 101 });
      });
      ws.on("unexpected-response", (_req, res) => {
        resolve({ success: false, statusCode: res.statusCode });
      });
      ws.on("error", (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  };

  try {
    // 1. Handshake token authentication
    const noToken = await attemptConnect(`ws://127.0.0.1:${wsPort}`);
    assert(noToken.statusCode === 401, "WS connect without token rejected with 401");

    const badToken = await attemptConnect(`ws://127.0.0.1:${wsPort}?token=fake.token.value`);
    assert(badToken.statusCode === 401, "WS connect with fake token rejected with 401");

    const revokedAttempt = await attemptConnect(`ws://127.0.0.1:${wsPort}?token=${revokedToken}`);
    assert(revokedAttempt.statusCode === 401, "WS connect with revoked token rejected with 401");

    const validAttempt = await attemptConnect(`ws://127.0.0.1:${wsPort}?token=${validToken}`);
    assert(validAttempt.success === true, "WS connect with valid token accepted (HTTP 101 / OPEN)");

    // 2. Anti DNS-rebinding & Origin validation
    const maliciousHost = await attemptConnect(`ws://127.0.0.1:${wsPort}?token=${validToken}`, {
      Host: `attacker.evil-domain.com:${wsPort}`,
    });
    assert(maliciousHost.statusCode === 403, "WS connect with malicious Host rejected with 403");

    const maliciousOrigin = await attemptConnect(`ws://127.0.0.1:${wsPort}?token=${validToken}`, {
      Origin: "https://evil-attacker.com",
    });
    assert(maliciousOrigin.statusCode === 403, "WS connect with untrusted Origin rejected with 403");

    const validLocalhost = await attemptConnect(`ws://127.0.0.1:${wsPort}?token=${validToken}`, {
      Host: `localhost:${wsPort}`,
    });
    assert(validLocalhost.success === true, "WS connect with Host: localhost accepted");
  } finally {
    await agent.stop();
  }

  return { passed, failed };
}

if (process.argv[1]?.endsWith("test_ws_handshake_auth.mjs")) {
  runTest().then(({ passed, failed }) => {
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  });
}
