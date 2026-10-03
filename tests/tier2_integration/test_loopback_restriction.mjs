import http from "node:http";
import express from "express";
import { pairingRouter, isLoopbackAddress } from "../../server/dist/server/src/auth/pairing.js";
import { getAvailablePort } from "../helpers/ports.mjs";

export async function runTest() {
  console.log("  ▶ [Tier 2] Test Loopback Restriction Matrix (/pair/qr & /pair/display)");
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

  // 1. isLoopbackAddress unit checks
  assert(isLoopbackAddress("127.0.0.1") === true, "127.0.0.1 recognized as loopback");
  assert(isLoopbackAddress("::1") === true, "::1 recognized as loopback");
  assert(isLoopbackAddress("::ffff:127.0.0.1") === true, "::ffff:127.0.0.1 recognized as loopback");
  assert(isLoopbackAddress("192.168.1.100") === false, "192.168.1.100 rejected as non-loopback");
  assert(isLoopbackAddress("10.0.0.1") === false, "10.0.0.1 rejected as non-loopback");
  assert(isLoopbackAddress("8.8.8.8") === false, "8.8.8.8 rejected as non-loopback");

  // 2. HTTP Server integration test
  const port = await getAvailablePort();
  const app = express();
  app.use(express.json());

  // Socket IP simulation middleware for testing remote requests
  app.use((req, res, next) => {
    const simIp = req.headers["x-sim-remote-ip"];
    if (typeof simIp === "string") {
      Object.defineProperty(req.socket, "remoteAddress", {
        value: simIp,
        configurable: true,
      });
    }
    next();
  });

  app.use("/pair", pairingRouter);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

  const request = (path, headers = {}) => {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: "GET",
          headers,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            let json = null;
            try {
              json = JSON.parse(data);
            } catch {}
            resolve({ status: res.statusCode, data, json });
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
  };

  try {
    // 2.1 Loopback requests succeed (HTTP 200)
    const qrLoopback = await request("/pair/qr");
    assert(qrLoopback.status === 200, "GET /pair/qr from loopback returns 200 OK");
    assert(typeof qrLoopback.json?.token === "string", "GET /pair/qr payload contains token");
    assert(typeof qrLoopback.json?.pin === "string", "GET /pair/qr payload contains PIN");

    const displayLoopback = await request("/pair/display");
    assert(displayLoopback.status === 200, "GET /pair/display from loopback returns 200 OK");
    assert(displayLoopback.data.includes("Appairage — Nexus Remote All"), "GET /pair/display returns HTML with title");

    // 2.2 Simulated LAN IP requests are rejected with 403 Forbidden
    const qrLan = await request("/pair/qr", { "x-sim-remote-ip": "192.168.1.100" });
    assert(qrLan.status === 403, "GET /pair/qr from LAN (192.168.1.100) returns 403 Forbidden");
    assert(qrLan.json?.ok === false, "GET /pair/qr returns ok: false on 403");

    const displayLan = await request("/pair/display", { "x-sim-remote-ip": "10.0.0.50" });
    assert(displayLan.status === 403, "GET /pair/display from LAN (10.0.0.50) returns 403 Forbidden");

    // 2.3 Spoofed X-Forwarded-For headers on LAN socket are still rejected (remoteAddress trusted)
    const qrSpoof = await request("/pair/qr", {
      "x-sim-remote-ip": "192.168.1.100",
      "x-forwarded-for": "127.0.0.1",
      "client-ip": "127.0.0.1",
    });
    assert(qrSpoof.status === 403, "GET /pair/qr spoofed with X-Forwarded-For: 127.0.0.1 is rejected with 403");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  return { passed, failed };
}

if (process.argv[1]?.endsWith("test_loopback_restriction.mjs")) {
  runTest().then(({ passed, failed }) => {
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  });
}
