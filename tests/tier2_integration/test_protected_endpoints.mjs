import http from "node:http";
import jwt from "jsonwebtoken";
import { startAgent } from "../../server/dist/server/src/agent.js";
import { CONFIG } from "../../server/dist/server/src/config.js";
import { revokeToken } from "../../server/dist/server/src/auth/middleware.js";
import { getPortPair } from "../helpers/ports.mjs";

export async function runTest() {
  console.log("  ▶ [Tier 2] Test Protected Endpoints & Authorization (/pair/tv/command & /pair/disconnect)");
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

  const post = (path, body, headers = {}) => {
    return new Promise((resolve, reject) => {
      const dataStr = JSON.stringify(body);
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: httpPort,
          path,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(dataStr),
            ...headers,
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            let json = null;
            try {
              json = JSON.parse(data);
            } catch {}
            resolve({ status: res.statusCode, json, data });
          });
        },
      );
      req.on("error", reject);
      req.write(dataStr);
      req.end();
    });
  };

  try {
    const validToken = jwt.sign({ role: "remote", sub: "test-auth-client" }, CONFIG.JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: "1h",
    });
    const expiredToken = jwt.sign({ role: "remote", sub: "test-expired" }, CONFIG.JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: "-10s",
    });
    const revokedToken = jwt.sign({ role: "remote", sub: "test-revoked-endpoint" }, CONFIG.JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: "1h",
    });
    revokeToken(revokedToken);

    // 1. /pair/tv/command tests
    const tvNoAuth = await post("/pair/tv/command", { targetIp: "192.168.1.50", action: "volup" });
    assert(tvNoAuth.status === 401, "POST /pair/tv/command without token returns 401 Unauthorized");

    const tvBadAuth = await post("/pair/tv/command", { targetIp: "192.168.1.50", action: "volup" }, {
      Authorization: "Bearer invalid.jwt.string",
    });
    assert(tvBadAuth.status === 401, "POST /pair/tv/command with invalid token returns 401 Unauthorized");

    const tvExpired = await post("/pair/tv/command", { targetIp: "192.168.1.50", action: "volup" }, {
      Authorization: `Bearer ${expiredToken}`,
    });
    assert(tvExpired.status === 401, "POST /pair/tv/command with expired token returns 401 Unauthorized");

    const tvRevoked = await post("/pair/tv/command", { targetIp: "192.168.1.50", action: "volup" }, {
      Authorization: `Bearer ${revokedToken}`,
    });
    assert(tvRevoked.status === 401, "POST /pair/tv/command with revoked token returns 401 Unauthorized");

    const tvValidAuthEmptyBody = await post("/pair/tv/command", {}, {
      Authorization: `Bearer ${validToken}`,
    });
    assert(tvValidAuthEmptyBody.status === 400, "POST /pair/tv/command with valid token but empty body returns 400 Bad Request");

    // 2. /pair/disconnect tests
    const discNoAuth = await post("/pair/disconnect", { id: "client-123" });
    assert(discNoAuth.status === 401, "POST /pair/disconnect without token returns 401 Unauthorized");

    const discBadAuth = await post("/pair/disconnect", { id: "client-123" }, {
      Authorization: "Bearer invalid.token",
    });
    assert(discBadAuth.status === 401, "POST /pair/disconnect with invalid token returns 401 Unauthorized");

    const discMissingId = await post("/pair/disconnect", {}, {
      Authorization: `Bearer ${validToken}`,
    });
    assert(discMissingId.status === 400, "POST /pair/disconnect with valid token but missing id returns 400 Bad Request");

    const discValid = await post("/pair/disconnect", { id: "client-nonexistent" }, {
      Authorization: `Bearer ${validToken}`,
    });
    assert(discValid.status === 200 && discValid.json?.ok === true, "POST /pair/disconnect with valid token and id returns 200 OK");
  } finally {
    await agent.stop();
  }

  return { passed, failed };
}

if (process.argv[1]?.endsWith("test_protected_endpoints.mjs")) {
  runTest().then(({ passed, failed }) => {
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  });
}
