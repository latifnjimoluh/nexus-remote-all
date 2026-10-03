import http from "node:http";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { getAvailablePort } from "../helpers/ports.mjs";

export async function runTest() {
  console.log("  ▶ [Tier 3] Test Relay Reconnection Race Resolution (Zero Code 4009 Deadlock)");
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

  const relayPort = await getAvailablePort();
  const relayProc = spawn("node", ["relay/dist/index.js"], {
    env: { ...process.env, PORT: String(relayPort) },
    stdio: "pipe",
  });

  const waitForHealth = async () => {
    for (let i = 0; i < 30; i++) {
      try {
        const ok = await new Promise((resolve) => {
          const req = http.get(`http://127.0.0.1:${relayPort}/health`, (res) => {
            resolve(res.statusCode === 200);
          });
          req.on("error", () => resolve(false));
        });
        if (ok) return true;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };

  let agentWs = null;

  try {
    const ready = await waitForHealth();
    assert(ready, "Relay server spawned on dynamic port");

    // 1. Agent registers with relay
    agentWs = new WebSocket(`ws://127.0.0.1:${relayPort}/relay?role=agent`);
    const relayReady = await new Promise((resolve, reject) => {
      agentWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "relay:ready") resolve(msg);
        } catch {}
      });
      agentWs.on("error", reject);
    });

    const pin = relayReady.code;
    assert(typeof pin === "string", `Agent registered with relay PIN: ${pin}`);

    // 2. Client 1 pairs with PIN
    const client1 = new WebSocket(`ws://127.0.0.1:${relayPort}/relay?role=client&code=${pin}`);
    await new Promise((r) => client1.on("open", r));

    // 3. Client 1 abruptly terminates socket at raw TCP level
    client1.terminate();

    // 4. Client 2 reconnects immediately with the same PIN without delay
    let client2CloseCode = 0;
    const client2 = new WebSocket(`ws://127.0.0.1:${relayPort}/relay?role=client&code=${pin}`);
    client2.on("close", (code) => {
      client2CloseCode = code;
    });

    const client2Msg = await new Promise((resolve, reject) => {
      client2.on("message", (data) => {
        try {
          const m = JSON.parse(data.toString());
          if (m.type === "relay:connected") resolve(m);
        } catch {}
      });
      client2.on("error", reject);
      setTimeout(() => resolve(null), 3000);
    });

    assert(client2CloseCode !== 4009, "Client 2 did NOT encounter code 4009 (already_paired) deadlock");
    assert(client2Msg?.type === "relay:connected", "Client 2 received relay:connected confirmation immediately");

    // 5. Verify bi-directional messaging between Agent and Client 2
    const agentMsgPromise = new Promise((resolve) => {
      agentWs.on("message", (data) => {
        try {
          const m = JSON.parse(data.toString());
          if (m.type === "ping-test") resolve(m);
        } catch {}
      });
    });

    client2.send(JSON.stringify({ type: "ping-test", payload: "from-client-2" }));
    const receivedByAgent = await Promise.race([
      agentMsgPromise,
      new Promise((r) => setTimeout(() => r(null), 2000)),
    ]);
    assert(receivedByAgent?.payload === "from-client-2", "Bi-directional relay communication verified on reconnected socket");

    client2.close();

    // 6. Rapid Stress Loop: 10 consecutive abrupt drop-reconnect cycles
    let stressPassed = true;
    for (let c = 1; c <= 10; c++) {
      let codeReceived = 0;
      const cWs = new WebSocket(`ws://127.0.0.1:${relayPort}/relay?role=client&code=${pin}`);
      cWs.on("close", (code) => { codeReceived = code; });

      const connected = await new Promise((resolve) => {
        cWs.on("message", (data) => {
          try {
            const m = JSON.parse(data.toString());
            if (m.type === "relay:connected") resolve(true);
          } catch {}
        });
        cWs.on("error", () => resolve(false));
        setTimeout(() => resolve(false), 1500);
      });

      if (!connected || codeReceived === 4009) {
        stressPassed = false;
        console.error(`    ✖ Cycle ${c} failed (close code: ${codeReceived})`);
        break;
      }
      cWs.terminate();
    }

    assert(stressPassed, "10 rapid consecutive drop-reconnect cycles succeeded without 4009 deadlocks");
  } finally {
    if (agentWs) agentWs.close();
    relayProc.kill();
  }

  return { passed, failed };
}

if (process.argv[1]?.endsWith("test_relay_reconnect_race.mjs")) {
  runTest().then(({ passed, failed }) => {
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  });
}
