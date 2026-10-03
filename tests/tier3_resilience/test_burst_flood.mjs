import { WebSocket } from "ws";
import http from "node:http";
import { startAgent } from "../../server/dist/server/src/agent.js";
import { waitForMoveQueue, resetMoveQueue } from "../../server/dist/server/src/controllers/mouse.js";
import { getPortPair } from "../helpers/ports.mjs";

export async function runTest() {
  console.log("  ▶ [Tier 3] Test High-Frequency Event Burst (1,000 Rapid Moves & Memory Bounds)");
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

  resetMoveQueue();
  const { httpPort, wsPort } = await getPortPair();
  const agent = await startAgent({
    httpPort,
    wsPort,
    log: false,
    enableCloud: false,
    enableMdns: false,
  });

  const { token } = await agent.getPairingInfo();
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}?token=${token}`);
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });

  let acks = 0;
  let errors = 0;
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "ack") acks++;
      if (msg.type === "error") errors++;
    } catch {}
  });

  try {
    if (global.gc) global.gc();
    const initialHeap = process.memoryUsage().heapUsed;

    // Stream 1,000 rapid mouse move events in a tight burst
    const BURST_COUNT = 1000;
    const startBurst = Date.now();
    for (let i = 0; i < BURST_COUNT; i++) {
      ws.send(JSON.stringify({ type: "mouse:move", dx: 0, dy: 0 }));
    }

    // Await all ACKs with timeout
    const ackTimeout = 10_000;
    const t0 = Date.now();
    while (acks < BURST_COUNT && Date.now() - t0 < ackTimeout) {
      await new Promise((r) => setTimeout(r, 20));
    }

    await waitForMoveQueue();
    const burstDurationMs = Date.now() - startBurst;

    assert(acks === BURST_COUNT, `Received 1,000 ACKs for 1,000 burst events (acks: ${acks}, duration: ${burstDurationMs}ms)`);
    assert(errors === 0, `Zero errors encountered during burst flood (errors: ${errors})`);

    // Memory Heap Delta check (< 35 MB)
    const finalHeap = process.memoryUsage().heapUsed;
    const heapDeltaMb = (finalHeap - initialHeap) / (1024 * 1024);
    assert(heapDeltaMb < 35, `Heap memory growth is bounded: ${heapDeltaMb.toFixed(2)} MB (< 35 MB limit)`);

    // Socket remains OPEN
    assert(ws.readyState === WebSocket.OPEN, "WebSocket client remains in OPEN state after 1,000 burst flood");

    // Server health responsiveness under/after load
    const healthStart = Date.now();
    const healthOk = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${httpPort}/health`, (res) => {
        resolve(res.statusCode === 200);
      }).on("error", () => resolve(false));
    });
    const healthDurationMs = Date.now() - healthStart;
    assert(healthOk && healthDurationMs < 500, `Server /health endpoint responds rapidly in ${healthDurationMs}ms (< 500ms)`);

    ws.close();
  } finally {
    await agent.stop();
  }

  return { passed, failed };
}

if (process.argv[1]?.endsWith("test_burst_flood.mjs")) {
  runTest().then(({ passed, failed }) => {
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  });
}
