import http from "node:http";
import { WebSocket } from "ws";
import { startAgent } from "../../server/dist/server/src/agent.js";
import { clearAllRateLimits, getActivePin } from "../../server/dist/server/src/auth/pairing.js";
import { getPortPair } from "../helpers/ports.mjs";

export async function runTest() {
  console.log("  ▶ [Tier 2] Test Full Pairing Handshake Lifecycle (PIN -> Token -> WS -> Commands)");
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

  clearAllRateLimits();
  const { httpPort, wsPort } = await getPortPair();
  const agent = await startAgent({
    httpPort,
    wsPort,
    log: false,
    enableCloud: false,
    enableMdns: false,
  });

  const postPin = (pin, simIp = "192.168.1.80") => {
    return new Promise((resolve, reject) => {
      const dataStr = JSON.stringify({ pin });
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: httpPort,
          path: "/pair/verify-pin",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(dataStr),
            "x-sim-remote-ip": simIp,
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
            resolve({ status: res.statusCode, json });
          });
        },
      );
      req.on("error", reject);
      req.write(dataStr);
      req.end();
    });
  };

  try {
    const pairingInfo = await agent.getPairingInfo();
    const correctPin = pairingInfo.pin.replace(/\s+/g, "");

    // 1. Wrong PIN attempt returns 401
    const badAttempt = await postPin("000000", "192.168.1.81");
    assert(badAttempt.status === 401, "POST /pair/verify-pin with wrong PIN returns 401");
    assert(typeof badAttempt.json?.attemptsLeft === "number", "Response includes attemptsLeft count");

    // 2. Rate limiting lockout after 5 failed attempts
    for (let i = 0; i < 4; i++) {
      await postPin("000000");
    }
    const fifthAttempt = await postPin("000000");
    assert(fifthAttempt.status === 429, "5th failed PIN attempt triggers 429 Too Many Requests");

    // Reset rate limits to allow testing legitimate PIN verification
    clearAllRateLimits();

    // 3. Successful verification with active PIN
    const validPinAttempt = await postPin(correctPin);
    assert(validPinAttempt.status === 200, "POST /pair/verify-pin with correct PIN returns 200 OK");
    assert(typeof validPinAttempt.json?.token === "string", "Verification returns signed JWT token");

    const token = validPinAttempt.json?.token;

    // 4. Verification automatically regenerates active PIN
    assert(getActivePin() !== correctPin, "Active PIN automatically rotated after successful pairing");

    // 5. Connect WebSocket with issued token
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}?token=${token}`);
    await new Promise((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });
    assert(ws.readyState === WebSocket.OPEN, "WebSocket connected successfully with issued token");

    const receivedMessages = [];
    ws.on("message", (raw) => {
      try {
        receivedMessages.push(JSON.parse(raw.toString()));
      } catch {
        receivedMessages.push(raw.toString());
      }
    });

    const sendWaitAck = async (msg, expectedCmd) => {
      const startLen = receivedMessages.length;
      ws.send(JSON.stringify(msg));
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 20));
        const found = receivedMessages.slice(startLen).find((m) => m.type === "ack" && m.cmd === expectedCmd);
        if (found) return found;
      }
      return null;
    };

    // 6. Send client:hello
    ws.send(JSON.stringify({ type: "client:hello", name: "Pixel 9", device: "Smartphone" }));
    await new Promise((r) => setTimeout(r, 50));
    assert(agent.getConnectedClients().length === 1, "Agent registered client in connectedClients list");

    // 7. Send mouse:move (dx:0, dy:0) and await ack
    const mouseAck = await sendWaitAck({ type: "mouse:move", dx: 0, dy: 0 }, "mouse:move");
    assert(mouseAck !== null, "Received ACK for mouse:move command");

    // 8. Send key:tap and await ack
    const keyAck = await sendWaitAck({ type: "key:tap", key: "Enter" }, "key:tap");
    assert(keyAck !== null, "Received ACK for key:tap command");

    // 9. Send invalid JSON payload -> receive error frame without socket disconnect
    const errStartLen = receivedMessages.length;
    ws.send("INVALID_PAYLOAD_STRING{{{");
    let errFrame = null;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 20));
      errFrame = receivedMessages.slice(errStartLen).find((m) => m.type === "error");
      if (errFrame) break;
    }
    assert(errFrame !== null, "Received error frame on malformed JSON payload");
    assert(ws.readyState === WebSocket.OPEN, "WebSocket remains open after malformed JSON");

    ws.close();
  } finally {
    await agent.stop();
  }

  return { passed, failed };
}

if (process.argv[1]?.endsWith("test_pairing_lifecycle.mjs")) {
  runTest().then(({ passed, failed }) => {
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  });
}
