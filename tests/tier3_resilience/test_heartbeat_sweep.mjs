import { WebSocket } from "ws";
import { startAgent } from "../../server/dist/server/src/agent.js";
import { generateClientToken } from "../../server/dist/server/src/auth/pairing.js";
import { getPortPair } from "../helpers/ports.mjs";

export async function runTest() {
  console.log("  ▶ [Tier 3] Test WebSocket Heartbeat Sweep & Ghost Socket Purge (Code 4008)");
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

  process.env.NEXUS_HEARTBEAT_INTERVAL = "150"; // 150ms accelerated heartbeat for testing
  const { httpPort, wsPort } = await getPortPair();
  const agent = await startAgent({
    httpPort,
    wsPort,
    log: false,
    enableCloud: false,
    enableMdns: false,
  });

  const tokenA = generateClientToken("127.0.0.1", "client-silent");
  const tokenB = generateClientToken("127.0.0.1", "client-active");
  const tokenC = generateClientToken("127.0.0.1", "client-tcp-destroy");

  try {
    // 1. Silent Client A (ignores pings, does not send pong)
    const clientA = new WebSocket(`ws://127.0.0.1:${wsPort}?token=${tokenA}`);
    await new Promise((r) => clientA.on("open", r));
    clientA.pong = () => {};
    clientA.removeAllListeners("ping");

    // 2. Active Client B (responds to pings)
    const clientB = new WebSocket(`ws://127.0.0.1:${wsPort}?token=${tokenB}`);
    await new Promise((r) => clientB.on("open", r));
    clientB.on("ping", () => {
      if (clientB.readyState === WebSocket.OPEN) clientB.pong();
    });

    assert(agent.getConnectedClients().length === 2, "Both clients A and B initially connected");

    // Wait for Client A to be terminated by heartbeat sweep (> 2 missed cycles = >300ms)
    let clientACloseCode = 0;
    let clientACloseReason = "";
    clientA.on("close", (code, reason) => {
      clientACloseCode = code;
      clientACloseReason = reason.toString();
    });

    const t0 = Date.now();
    while (clientACloseCode === 0 && Date.now() - t0 < 3000) {
      await new Promise((r) => setTimeout(r, 50));
    }

    assert(clientACloseCode === 4008, `Client A terminated by server with code 4008 (got: ${clientACloseCode})`);
    assert(clientACloseReason.includes("Heartbeat timeout") || clientACloseCode === 4008, "Termination reason specifies Heartbeat timeout");

    await new Promise((r) => setTimeout(r, 50));
    assert(agent.getConnectedClients().length === 1, "Agent removed dead Client A from connectedClients");
    assert(clientB.readyState === WebSocket.OPEN, "Active Client B remains OPEN and unaffected");

    // 3. Raw TCP Abrupt Drop test on Client C
    const clientC = new WebSocket(`ws://127.0.0.1:${wsPort}?token=${tokenC}`);
    await new Promise((r) => clientC.on("open", r));
    assert(agent.getConnectedClients().length === 2, "Client C connected (total: 2)");

    // Abruptly destroy TCP socket underneath WS without sending close frames
    if (clientC._socket) {
      clientC._socket.destroy();
    } else {
      clientC.terminate();
    }

    // Wait for server to detect closed socket via I/O event or next heartbeat cycle
    const t1 = Date.now();
    while (agent.getConnectedClients().length > 1 && Date.now() - t1 < 3000) {
      await new Promise((r) => setTimeout(r, 50));
    }

    assert(agent.getConnectedClients().length === 1, "Server purged abruptly-dropped socket without ghost sockets remaining");

    clientB.close();
  } finally {
    delete process.env.NEXUS_HEARTBEAT_INTERVAL;
    await agent.stop();
  }

  return { passed, failed };
}

if (process.argv[1]?.endsWith("test_heartbeat_sweep.mjs")) {
  runTest().then(({ passed, failed }) => {
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  });
}
