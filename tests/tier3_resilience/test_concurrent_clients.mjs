import { WebSocket } from "ws";
import { startAgent } from "../../server/dist/server/src/agent.js";
import { generateClientToken } from "../../server/dist/server/src/auth/pairing.js";
import { getPortPair } from "../helpers/ports.mjs";

export async function runTest() {
  console.log("  ▶ [Tier 3] Test Concurrent Multi-Client Management & Non-Cascade Revocation");
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

  const clientIds = ["client-alpha", "client-beta", "client-gamma", "client-delta"];
  const tokens = clientIds.map((id) => generateClientToken("127.0.0.1", id));
  const sockets = [];
  const clientAcks = [0, 0, 0, 0];

  try {
    // 1. Connect 4 concurrent clients with unique identity tokens
    for (let i = 0; i < 4; i++) {
      const idx = i;
      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}?token=${tokens[idx]}`);
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "ack") clientAcks[idx]++;
        } catch {}
      });
      await new Promise((resolve, reject) => {
        ws.on("open", resolve);
        ws.on("error", reject);
      });
      ws.send(JSON.stringify({ type: "client:hello", name: `Device ${idx + 1}` }));
      sockets.push(ws);
    }

    await new Promise((r) => setTimeout(r, 100));
    assert(agent.getConnectedClients().length === 4, "Server registers exactly 4 concurrent connected clients");

    // 2. Stream 20 concurrent commands per client simultaneously (80 commands total)
    const commandsPerClient = 20;
    for (let i = 0; i < 4; i++) {
      for (let c = 0; c < commandsPerClient; c++) {
        sockets[i].send(JSON.stringify({ type: "key:tap", key: "Enter" }));
      }
    }

    const t0 = Date.now();
    while (clientAcks.some((c) => c < commandsPerClient) && Date.now() - t0 < 5000) {
      await new Promise((r) => setTimeout(r, 20));
    }

    assert(
      clientAcks.every((c) => c === commandsPerClient),
      `All 4 clients received 20/20 ACKs (total: ${clientAcks.reduce((a, b) => a + b, 0)}/80 ACKs)`,
    );

    // 3. Kick Client 0 (client-alpha) via agent.disconnectClient
    let client0ClosedCode = 0;
    sockets[0].on("close", (code) => {
      client0ClosedCode = code;
    });

    agent.disconnectClient("client-alpha");
    await new Promise((r) => setTimeout(r, 100));

    assert(sockets[0].readyState === WebSocket.CLOSED, "Client 0 socket is closed after targeted kick");
    assert(client0ClosedCode === 4008, `Client 0 closed with code 4008 (got: ${client0ClosedCode})`);
    assert(agent.getConnectedClients().length === 3, "Connected clients count decremented to 3");

    // 4. Reconnection by Client 0 with kicked token is rejected with 401
    const reconnectAttempt = await new Promise((resolve) => {
      const reconnWs = new WebSocket(`ws://127.0.0.1:${wsPort}?token=${tokens[0]}`);
      reconnWs.on("open", () => {
        reconnWs.close();
        resolve({ success: true, statusCode: 101 });
      });
      reconnWs.on("unexpected-response", (_req, res) => {
        resolve({ success: false, statusCode: res.statusCode });
      });
      reconnWs.on("error", (err) => resolve({ success: false, error: err.message }));
    });
    assert(reconnectAttempt.statusCode === 401, "Kicked client token rejected on reconnect attempt (401)");

    // 5. Strict Non-Cascade Isolation: Clients 1, 2, 3 remain healthy and operational
    for (let i = 1; i < 4; i++) {
      assert(sockets[i].readyState === WebSocket.OPEN, `Client ${i} remained OPEN without cascade disconnection`);
    }

    // Verify Clients 1, 2, 3 can continue sending commands and receiving ACKs
    const postKickAcks = [0, 0, 0];
    for (let i = 1; i < 4; i++) {
      const idx = i - 1;
      const initialAckCount = clientAcks[i];
      sockets[i].send(JSON.stringify({ type: "media:key", key: "volup" }));
      for (let w = 0; w < 50; w++) {
        await new Promise((r) => setTimeout(r, 20));
        if (clientAcks[i] > initialAckCount) {
          postKickAcks[idx] = 1;
          break;
        }
      }
    }
    assert(postKickAcks.every((a) => a === 1), "Remaining Clients 1, 2, 3 continue executing commands with 100% ACKs");

    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    }
  } finally {
    await agent.stop();
  }

  return { passed, failed };
}

if (process.argv[1]?.endsWith("test_concurrent_clients.mjs")) {
  runTest().then(({ passed, failed }) => {
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  });
}
