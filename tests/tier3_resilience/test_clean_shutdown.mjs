import http from "node:http";
import { WebSocket } from "ws";
import { startAgent } from "../../server/dist/server/src/agent.js";
import { getPortPair } from "../helpers/ports.mjs";

export async function runTest() {
  console.log("  ▶ [Tier 3] Test Server Clean Shutdown API & Port Rebinding (Zero EADDRINUSE)");
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

  // 1. Initial agent start and client connection
  let agent = await startAgent({
    httpPort,
    wsPort,
    log: false,
    enableCloud: false,
    enableMdns: false,
  });

  const { token } = await agent.getPairingInfo();
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}?token=${token}`);
  await new Promise((r) => ws.on("open", r));

  let wsCloseCode = 0;
  ws.on("close", (code) => {
    wsCloseCode = code;
  });

  // Call stop() and verify clean shutdown
  await agent.stop();
  await new Promise((r) => setTimeout(r, 50));

  assert(wsCloseCode === 1001, `Connected WS client terminated with code 1001 on server stop (got: ${wsCloseCode})`);

  // 2. Idempotence test: calling stop() again resolves without throwing
  let secondStopFailed = false;
  try {
    await agent.stop();
  } catch {
    secondStopFailed = true;
  }
  assert(!secondStopFailed, "Calling agent.stop() twice is idempotent and resolves cleanly");

  // 3. Port rebinding: immediately restart agent on EXACT SAME PORTS without EADDRINUSE
  let rebindAgent = null;
  let rebindError = null;
  try {
    rebindAgent = await startAgent({
      httpPort,
      wsPort,
      log: false,
      enableCloud: false,
      enableMdns: false,
    });
  } catch (err) {
    rebindError = err;
  }

  assert(rebindError === null && rebindAgent !== null, "Second agent bound to identical ports immediately without EADDRINUSE");
  if (rebindAgent) await rebindAgent.stop();

  // 4. Stress Loop: 5 rapid consecutive start / stop cycles on identical ports
  let allCyclesPassed = true;
  for (let cycle = 1; cycle <= 5; cycle++) {
    try {
      const a = await startAgent({
        httpPort,
        wsPort,
        log: false,
        enableCloud: false,
        enableMdns: false,
      });
      await a.stop();
    } catch (err) {
      allCyclesPassed = false;
      console.error(`    ✖ Cycle ${cycle} failed:`, err.message);
      break;
    }
  }

  assert(allCyclesPassed, "5 rapid consecutive start/stop cycles succeeded on identical ports with zero errors");

  return { passed, failed };
}

if (process.argv[1]?.endsWith("test_clean_shutdown.mjs")) {
  runTest().then(({ passed, failed }) => {
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  });
}
