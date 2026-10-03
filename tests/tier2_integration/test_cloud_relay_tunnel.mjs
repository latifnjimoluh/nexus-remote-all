import http from "node:http";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import {
  generateKeyB64url,
  keyFromB64url,
  encrypt,
  decrypt,
  isEnvelope,
  validateReplay,
} from "../../server/dist/server/src/e2e.js";
import { getAvailablePort } from "../helpers/ports.mjs";

export async function runTest() {
  console.log("  ▶ [Tier 2] Test Cloud Relay E2EE Tunnel (AES-GCM Envelope & Anti-Replay)");
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

  // Wait for relay /health endpoint
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
  let clientWs = null;

  try {
    const ready = await waitForHealth();
    assert(ready, "Cloud Relay process spawned and healthy on dynamic port");

    const key = keyFromB64url(generateKeyB64url());

    // 1. Connect agent
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

    assert(typeof relayReady.code === "string", `Agent registered with relay, pairing PIN: ${relayReady.code}`);
    const pin = relayReady.code;

    // 2. Connect client
    clientWs = new WebSocket(`ws://127.0.0.1:${relayPort}/relay?role=client&code=${pin}`);
    await new Promise((resolve, reject) => {
      clientWs.on("open", resolve);
      clientWs.on("error", reject);
    });

    assert(clientWs.readyState === WebSocket.OPEN, "Client paired successfully with relay session");

    // Agent receives client_joined event
    const joinNotif = await new Promise((resolve) => {
      agentWs.once("message", (data) => {
        try {
          resolve(JSON.parse(data.toString()));
        } catch {
          resolve(null);
        }
      });
    });
    assert(joinNotif?.type === "relay:client_joined", "Agent received relay:client_joined notification from relay");

    // 3. Client encrypts and transmits command envelope
    const commandPayload = JSON.stringify({ type: "key:tap", key: "Enter" });
    const now = Date.now();
    const envSeq1 = encrypt(key, commandPayload, 1, now);

    const agentReceived = new Promise((resolve) => {
      agentWs.once("message", (data) => {
        try {
          resolve(JSON.parse(data.toString()));
        } catch {
          resolve(null);
        }
      });
    });

    clientWs.send(JSON.stringify(envSeq1));
    const receivedEnv = await agentReceived;

    assert(isEnvelope(receivedEnv), "Agent received valid structural AES-GCM envelope");

    let lastSeq = 0;
    const replayCheck = validateReplay(receivedEnv, lastSeq);
    assert(replayCheck.valid === true, "validateReplay accepted initial monotonic seq: 1");
    lastSeq = receivedEnv.seq;

    const decryptedCommand = decrypt(key, receivedEnv);
    assert(decryptedCommand === commandPayload, "Decrypted plaintext matches original command");

    // 4. Agent sends encrypted ACK
    const ackPayload = JSON.stringify({ type: "ack", cmd: "key:tap" });
    const ackEnv = encrypt(key, ackPayload, 1, Date.now());

    const clientReceived = new Promise((resolve) => {
      clientWs.once("message", (data) => {
        try {
          resolve(JSON.parse(data.toString()));
        } catch {
          resolve(null);
        }
      });
    });

    agentWs.send(JSON.stringify(ackEnv));
    const receivedAckEnv = await clientReceived;
    const decryptedAck = decrypt(key, receivedAckEnv);
    assert(decryptedAck === ackPayload, "Client successfully received and decrypted ACK envelope");

    // 5. Replay Attack Test: Send duplicate seq: 1 envelope
    const replayAttempt = validateReplay(envSeq1, lastSeq);
    assert(replayAttempt.valid === false, "validateReplay rejected duplicate seq: 1 replay attack");
    assert(replayAttempt.error?.includes("rejeu"), "Error message explicitly flags replay attack");

    // 6. Ciphertext Tamper Defense Test: Flip bits in ciphertext
    const tamperedEnv = { ...envSeq1 };
    const rawCipher = Buffer.from(tamperedEnv.d, "base64");
    rawCipher[0] ^= 0xaa;
    tamperedEnv.d = rawCipher.toString("base64");

    let decryptFailed = false;
    try {
      decrypt(key, tamperedEnv);
    } catch {
      decryptFailed = true;
    }
    assert(decryptFailed === true, "Tampered ciphertext rejected by AES-256-GCM decipher");
  } finally {
    if (agentWs) agentWs.close();
    if (clientWs) clientWs.close();
    relayProc.kill();
  }

  return { passed, failed };
}

if (process.argv[1]?.endsWith("test_cloud_relay_tunnel.mjs")) {
  runTest().then(({ passed, failed }) => {
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  });
}
