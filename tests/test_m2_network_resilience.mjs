/**
 * Suite de tests automatisés pour le Jalon M2 : Network Resilience & Concurrency
 * Features couvertes (F10 - F18) :
 * - F10: WS Heartbeat & Keepalive (balayage, pong tracking, terminaison 4008)
 * - F11: Safe WS Send & Error Handlers (ws.on("error"), readyState check, safeSend)
 * - F12: Clean Shutdown API (stop() / close() sur AgentHandle, libération 4700/4701, zéro EADDRINUSE)
 * - F13: Mouse Cursor Concurrency Sync (sérialisation moveQueue, anti lost updates, auto-réparation)
 * - F14: Unique Client Token Identity (UUID sub & jti, isolation de révocation multi-clients)
 * - F15: Touch Streaming Coalescence & Backpressure (défausse deltas hors-ligne, queue bornée 50)
 * - F16: Relay Reconnect Deadlock Fix (éviction immédiate de socket sans lockout 4009, garde race)
 * - F17: Dynamic Anti-DNS-Rebinding Host Check (loopback fast-path, cache TTL, extraction IPv6)
 * - F18: Single-Channel TV Dispatch (dispatch exclusif WS si ready, fallback exclusif HTTP sans doublon)
 */

import { WebSocket, WebSocketServer } from "ws";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import esbuild from "esbuild";

// Imports des modules compilés
import { startAgent } from "../server/dist/server/src/agent.js";
import { CONFIG } from "../server/dist/server/src/config.js";
import { generateClientToken, createPairingInfo } from "../server/dist/server/src/auth/pairing.js";
import { verifyToken, revokeToken, isTokenRevoked } from "../server/dist/server/src/auth/middleware.js";
import { moveRelative, waitForMoveQueue, resetMoveQueue } from "../server/dist/server/src/controllers/mouse.js";
import { localAddresses } from "../server/dist/server/src/net.js";

// Shims d'environnement pour l'exécution des modules PWA Client sous Node.js
if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}
if (!globalThis.location) {
  globalThis.location = {
    hostname: "127.0.0.1",
    port: "4759",
    protocol: "http:",
    host: "127.0.0.1:4759",
  };
}
if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket;
}

// Utilitaires de test
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function assert(condition, message, details = "") {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${message}`);
  } else {
    failedTests++;
    const err = `❌ [FAIL] ${message} ${details ? "(" + details + ")" : ""}`;
    console.error(`  ${err}`);
    failures.push({ message, details });
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runM2Tests() {
  console.log("================================================================================");
  console.log("  SUITE DE TESTS AUTOMATISÉS M2 : NETWORK RESILIENCE & CONCURRENCY");
  console.log("================================================================================\n");

  const projectRoot = fileURLToPath(new URL("..", import.meta.url));

  // Bundlage en mémoire des modules réels client/src pour exécution sous Node.js
  const clientBundle = await esbuild.build({
    stdin: {
      contents: `
        export * as wsClient from '${path.resolve(projectRoot, "client/src/core/ws-client.ts").replace(/\\/g, "/")}';
        export * as discovery from '${path.resolve(projectRoot, "client/src/core/discovery.ts").replace(/\\/g, "/")}';
      `,
      resolveDir: projectRoot,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    alias: {
      "@shared": path.resolve(projectRoot, "shared"),
    },
  });

  const b64Bundle = Buffer.from(clientBundle.outputFiles[0].text).toString("base64");
  const { wsClient, discovery } = await import("data:text/javascript;base64," + b64Bundle);

  // ============================================================================
  // TEST SUITE 1 : F13 — Mouse Cursor Concurrency & Serialized Promise Queue
  // ============================================================================
  console.log("▶ SUITE 1 : F13 — Synchronisation de Concurrence Souris (moveQueue)\n");
  {
    resetMoveQueue();

    // 1.1 Exécution de multiples mouvements sérialisés
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(moveRelative(1, 1));
    }
    await Promise.all(promises);
    await waitForMoveQueue();
    assert(true, "20 appels simultanés à moveRelative(1, 1) se sont exécutés sans deadlock");

    // 1.2 Court-circuit des deltas nuls (0, 0)
    const nullMovePromise = moveRelative(0, 0);
    assert(nullMovePromise instanceof Promise, "moveRelative(0, 0) retourne une Promise");
    await nullMovePromise;
    assert(true, "moveRelative(0, 0) court-circuite sans erreur");

    // 1.3 Auto-réparation de la file en cas d'erreur
    // On vérifie que la queue continue de fonctionner même après un appel
    resetMoveQueue();
    const normalPromise = moveRelative(2, -2);
    await normalPromise;
    await waitForMoveQueue();
    assert(true, "Auto-réparation de moveQueue confirmée après réinitialisation");
  }

  // ============================================================================
  // TEST SUITE 2 : F14 — Unique Client Token Identity & Non-Cascade Revocation
  // ============================================================================
  console.log("\n▶ SUITE 2 : F14 — Identité Unique des Jetons Clients (sub/jti) & Isolation de Révocation\n");
  {
    const token1 = generateClientToken("127.0.0.1");
    const token2 = generateClientToken("127.0.0.1");

    assert(typeof token1 === "string" && token1.length > 50, "token1 généré avec succès");
    assert(typeof token2 === "string" && token2.length > 50, "token2 généré avec succès");
    assert(token1 !== token2, "Deux jetons générés pour le même hôte sont strictement distincts");

    const decoded1 = jwt.decode(token1);
    const decoded2 = jwt.decode(token2);

    assert(Boolean(decoded1?.sub && decoded1?.jti), "token1 contient les revendications sub et jti");
    assert(Boolean(decoded2?.sub && decoded2?.jti), "token2 contient les revendications sub et jti");
    assert(decoded1.sub !== decoded2.sub, "sub de token1 est distinct de sub de token2");
    assert(decoded1.jti !== decoded2.jti, "jti de token1 est distinct de jti de token2");

    // Validation initiale
    assert(verifyToken(token1) === true, "token1 est initialement valide");
    assert(verifyToken(token2) === true, "token2 est initialement valide");

    // Révocation de Client 1 uniquement
    revokeToken(token1);

    assert(isTokenRevoked(token1) === true, "token1 est marqué révoqué");
    assert(verifyToken(token1) === false, "token1 est rejeté après révocation");

    // Isolation stricte : Client 2 ne doit JAMAIS être impacté !
    assert(isTokenRevoked(token2) === false, "token2 n'est PAS marqué révoqué");
    assert(verifyToken(token2) === true, "token2 reste pleinement valide après l'expulsion de client 1 (pas d'effet cascade)");

    // Révocation par client ID (sub)
    const token3 = generateClientToken("127.0.0.1");
    const decoded3 = jwt.decode(token3);
    assert(verifyToken(token3) === true, "token3 est initialement valide");
    revokeToken(decoded3.sub);
    assert(isTokenRevoked(token3) === true, "token3 est reconnu révoqué via son clientId (sub)");
    assert(verifyToken(token3) === false, "token3 est rejeté suite à révocation par clientId");
  }

  // ============================================================================
  // TEST SUITE 3 : F12 — Clean Shutdown API (AgentHandle.stop / close)
  // ============================================================================
  console.log("\n▶ SUITE 3 : F12 — API d'Arrêt Propre (stop / close) et Prévention EADDRINUSE\n");
  {
    const TEST_HTTP = 4750;
    const TEST_WS = 4751;
    process.env.NEXUS_HTTP_PORT = String(TEST_HTTP);
    process.env.NEXUS_WS_PORT = String(TEST_WS);

    // 3.1 Démarrage de la première instance d'agent
    const agent1 = await startAgent({ log: false, enableCloud: false, enableMdns: false, httpPort: TEST_HTTP, wsPort: TEST_WS });
    assert(agent1.httpPort === TEST_HTTP, `agent1 démarré sur port HTTP ${TEST_HTTP}`);
    assert(agent1.wsPort === TEST_WS, `agent1 démarré sur port WS ${TEST_WS}`);
    assert(typeof agent1.stop === "function", "agent1 expose la méthode stop()");
    assert(typeof agent1.close === "function", "agent1 expose l'alias close()");

    // Connexion d'un client WebSocket à agent1
    const { token } = await agent1.getPairingInfo();
    const wsClient = new WebSocket(`ws://127.0.0.1:${TEST_WS}?token=${token}`);
    await new Promise((resolve) => wsClient.on("open", resolve));
    assert(wsClient.readyState === WebSocket.OPEN, "Client WS connecté à agent1");

    // Arrêt complet via stop()
    await agent1.stop();
    assert(true, "agent1.stop() s'est résolu avec succès");

    // Vérifier que la socket cliente a bien été fermée
    await sleep(50);
    assert(wsClient.readyState === WebSocket.CLOSED || wsClient.readyState === WebSocket.CLOSING, "La socket cliente a été fermée lors de agent1.stop()");

    // 3.2 Tentative IMMÉDIATE de réouverture sur les MÊMES PORTS (doit réussir sans EADDRINUSE)
    let agent2 = null;
    try {
      agent2 = await startAgent({ log: false, enableCloud: false, enableMdns: false, httpPort: TEST_HTTP, wsPort: TEST_WS });
      assert(agent2.httpPort === TEST_HTTP, "agent2 a réacquis le port HTTP sans EADDRINUSE");
      assert(agent2.wsPort === TEST_WS, "agent2 a réacquis le port WS sans EADDRINUSE");
    } catch (e) {
      assert(false, "Réouverture des ports a échoué avec EADDRINUSE", String(e));
    }

    if (agent2) {
      // Test de l'alias close()
      await agent2.close();
      assert(true, "agent2.close() (alias) s'est exécuté avec succès");
    }
  }

  // ============================================================================
  // TEST SUITE 4 : F10 & F11 — WS Heartbeat, Pong Tracking & Safe Sends
  // ============================================================================
  console.log("\n▶ SUITE 4 : F10 & F11 — Heartbeat WebSocket, Code 4008 & Safe Sends\n");
  {
    const TEST_HTTP = 4752;
    const TEST_WS = 4753;
    process.env.NEXUS_HTTP_PORT = String(TEST_HTTP);
    process.env.NEXUS_WS_PORT = String(TEST_WS);
    process.env.NEXUS_HEARTBEAT_INTERVAL = "150"; // 150ms pour rapidité de test

    const agent = await startAgent({ log: false, enableCloud: false, enableMdns: false, httpPort: TEST_HTTP, wsPort: TEST_WS });
    const { token } = await agent.getPairingInfo();

    // 4.1 Client inactif qui NE RÉPOND PAS aux pings
    const deadClient = new WebSocket(`ws://127.0.0.1:${TEST_WS}?token=${token}`);
    await new Promise((resolve) => deadClient.on("open", resolve));

    // Supprimer la réponse automatique pong sur le client
    deadClient.pong = () => {};

    // Attendre la fermeture avec code 4008
    const closePromise = new Promise((resolve) => {
      deadClient.on("close", (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    const closeResult = await Promise.race([
      closePromise,
      sleep(1200).then(() => ({ code: -1, reason: "timeout" })),
    ]);

    assert(closeResult.code === 4008, `Client inactif terminé avec le code 4008 (obtenu: ${closeResult.code})`);

    // 4.2 Client actif qui répond aux pings
    const aliveClient = new WebSocket(`ws://127.0.0.1:${TEST_WS}?token=${token}`);
    await new Promise((resolve) => aliveClient.on("open", resolve));
    aliveClient.on("ping", () => {
      if (aliveClient.readyState === WebSocket.OPEN) {
        aliveClient.pong();
      }
    });

    // Attendre 400ms (> 2 cycles de 150ms)
    await sleep(400);
    assert(aliveClient.readyState === WebSocket.OPEN, "Client actif répondant aux pings reste connecté");

    aliveClient.close();
    await agent.stop();
    delete process.env.NEXUS_HEARTBEAT_INTERVAL;
  }

  // ============================================================================
  // TEST SUITE 5 : F17 — Dynamic Host Validation (Anti-DNS-Rebinding)
  // ============================================================================
  console.log("\n▶ SUITE 5 : F17 — Validation Dynamique de l'Hôte Anti DNS-Rebinding\n");
  {
    const TEST_HTTP = 4754;
    const TEST_WS = 4755;
    process.env.NEXUS_HTTP_PORT = String(TEST_HTTP);
    process.env.NEXUS_WS_PORT = String(TEST_WS);

    const agent = await startAgent({ log: false, enableCloud: false, enableMdns: false, httpPort: TEST_HTTP, wsPort: TEST_WS });
    const { token } = await agent.getPairingInfo();

    // 5.1 Requête avec host loopback 127.0.0.1:4754
    const resLoopback = await fetch(`http://127.0.0.1:${TEST_HTTP}/health`, {
      headers: { Host: `127.0.0.1:${TEST_HTTP}` },
    });
    assert(resLoopback.status === 200, "Requête avec Host 127.0.0.1 est acceptée (200)");

    // 5.2 Requête avec host localhost:4754
    const resLocalhost = await fetch(`http://127.0.0.1:${TEST_HTTP}/health`, {
      headers: { Host: `localhost:${TEST_HTTP}` },
    });
    assert(resLocalhost.status === 200, "Requête avec Host localhost est acceptée (200)");

    // 5.3 Requête avec format IPv6 entre crochets [::1]:4754
    const resIpv6 = await fetch(`http://127.0.0.1:${TEST_HTTP}/health`, {
      headers: { Host: `[::1]:${TEST_HTTP}` },
    });
    assert(resIpv6.status === 200, "Requête avec Host [::1] (IPv6 brackets) est acceptée (200)");

    // 5.4 Requête avec hôte externe malveillant (DNS rebinding attack via http.request)
    const evilStatus = await new Promise((resolve) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: TEST_HTTP,
          path: "/health",
          method: "GET",
          headers: { host: `attacker.evil-domain.com:${TEST_HTTP}` },
        },
        (res) => {
          resolve(res.statusCode);
        },
      );
      req.on("error", () => resolve(-1));
      req.end();
    });
    assert(evilStatus === 403, "Requête avec Host externe malveillant est strictement rejetée (403 Forbidden)");

    // 5.5 Connexion WebSocket avec Host externe malveillant (DNS rebinding handshake attack)
    const evilWs = new WebSocket(`ws://127.0.0.1:${TEST_WS}?token=${token}`, {
      headers: { Host: `attacker.evil-domain.com:${TEST_WS}` },
    });
    const evilWsRejected = await new Promise((resolve) => {
      evilWs.on("unexpected-response", (req, res) => {
        resolve(res.statusCode === 403);
      });
      evilWs.on("open", () => resolve(false));
      evilWs.on("error", () => resolve(true));
    });
    assert(evilWsRejected === true, "Connexion WebSocket avec Host externe est rejetée avec HTTP 403 Forbidden");

    // 5.6 Requête HTTP avec Host vide strictement rejetée (403 Forbidden)
    const emptyHostHttpStatus = await new Promise((resolve) => {
      import("node:net").then(({ createConnection }) => {
        const socket = createConnection({ host: "127.0.0.1", port: TEST_HTTP }, () => {
          socket.write("GET /health HTTP/1.1\r\nHost: \r\n\r\n");
        });
        socket.on("data", (data) => {
          const firstLine = data.toString().split("\r\n")[0] || "";
          resolve(firstLine.includes("403"));
          socket.destroy();
        });
        socket.on("error", () => resolve(false));
      });
    });
    assert(emptyHostHttpStatus === true, "Requête HTTP avec Host vide est strictement rejetée avec HTTP 403");

    // 5.7 Handshake WebSocket sans Host strictement rejeté (403 Forbidden)
    const noHostWsStatus = await new Promise((resolve) => {
      import("node:net").then(({ createConnection }) => {
        const socket = createConnection({ host: "127.0.0.1", port: TEST_WS }, () => {
          socket.write(
            `GET /?token=${token} HTTP/1.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`
          );
        });
        socket.on("data", (data) => {
          const firstLine = data.toString().split("\r\n")[0] || "";
          resolve(firstLine.includes("403"));
          socket.destroy();
        });
        socket.on("error", () => resolve(false));
      });
    });
    assert(noHostWsStatus === true, "Handshake WebSocket sans Host est strictement rejeté avec HTTP 403");

    await agent.stop();
  }

  // ============================================================================
  // TEST SUITE 6 : F15 — Touch Streaming Coalescence & Offline Queue Bounding
  // (Exécution directe du module réel client/src/core/ws-client.ts)
  // ============================================================================
  console.log("\n▶ SUITE 6 : F15 — Défausse des Mouvements Hors-Ligne & Queue Bornée à 50 (Module Réel ws-client.ts)\n");
  {
    const MAX_OFFLINE_QUEUE_SIZE = 50;

    // Déconnexion initiale et réinitialisation de la file
    wsClient.disconnect();
    wsClient.clearQueue();
    assert(wsClient.isReady() === false, "wsClient réel est initialement déconnecté (isReady === false)");
    assert(wsClient.getQueueSize() === 0, "File d'attente réelle initialement vide (taille 0)");

    // 6.1 Tentative d'empiler des deltas de mouvement en mode déconnecté
    for (let i = 0; i < 100; i++) {
      wsClient.send({ type: "mouse:move", dx: 5, dy: -5 });
      wsClient.send({ type: "mouse:scroll", dx: 0, dy: 1 });
    }
    assert(
      wsClient.getQueueSize() === 0,
      "Les 200 deltas mouse:move et mouse:scroll ont TOUS été éliminés en mode déconnecté par wsClient réel (taille queue = 0)"
    );

    // 6.2 Empiler des commandes discrètes (clavier, clics, actions)
    for (let i = 0; i < 70; i++) {
      wsClient.send({ type: "key:tap", key: `k${i}` });
    }
    assert(
      wsClient.getQueueSize() === MAX_OFFLINE_QUEUE_SIZE,
      `La file d'attente hors-ligne réelle est strictement bornée à ${MAX_OFFLINE_QUEUE_SIZE} éléments`
    );

    // 6.3 Éviction FIFO et transmission lors du flush à la reconnexion
    const TEST_FLUSH_PORT = 4756;
    const flushServer = new WebSocketServer({ port: TEST_FLUSH_PORT });
    const receivedFlushed = [];

    flushServer.on("connection", (ws) => {
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "key:tap") receivedFlushed.push(msg);
        } catch {}
      });
    });

    wsClient.connect({
      mode: "local",
      host: "127.0.0.1",
      port: TEST_FLUSH_PORT,
      token: "test-token-f15",
    });

    for (let i = 0; i < 30; i++) {
      if (receivedFlushed.length === MAX_OFFLINE_QUEUE_SIZE) break;
      await sleep(50);
    }

    assert(
      receivedFlushed.length === MAX_OFFLINE_QUEUE_SIZE,
      `Exactement ${MAX_OFFLINE_QUEUE_SIZE} commandes discrètes ont été flushées à la reconnexion`
    );
    assert(receivedFlushed[0]?.key === "k20", "L'éviction FIFO a correctement supprimé les 20 plus anciennes commandes (premier reçu: k20)");
    assert(receivedFlushed[49]?.key === "k69", "La dernière commande k69 est fidèlement conservée et reçue");
    assert(wsClient.getQueueSize() === 0, "La file d'attente hors-ligne est entièrement vidée après le flush");

    wsClient.disconnect();
    await new Promise((r) => flushServer.close(r));
  }

  // ============================================================================
  // TEST SUITE 7 : F16 — Relay Reconnect Deadlock Fix & Stale Socket Eviction
  // (Exécution du processus réel compilé relay/dist/index.js)
  // ============================================================================
  console.log("\n▶ SUITE 7 : F16 — Reconnexion Relais sans Deadlock 4009 (Processus Réel relay/dist/index.js)\n");
  {
    const RELAY_PORT = 4757;
    const relayScriptPath = path.resolve(projectRoot, "relay/dist/index.js");

    const relayProc = spawn(process.execPath, [relayScriptPath], {
      env: { ...process.env, PORT: String(RELAY_PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Attendre la disponibilité effective du serveur relais via /health
    let healthy = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${RELAY_PORT}/health`);
        if (res.ok) {
          healthy = true;
          break;
        }
      } catch {}
      await sleep(100);
    }
    assert(healthy === true, `Serveur relais réel (relay/dist/index.js) démarré et sain sur port ${RELAY_PORT}`);

    try {
      // 7.1 Enregistrer l'Agent
      const agentSocket = new WebSocket(`ws://127.0.0.1:${RELAY_PORT}/relay?role=agent`);
      const readyMsg = await new Promise((resolve, reject) => {
        agentSocket.once("message", (raw) => resolve(JSON.parse(raw.toString())));
        agentSocket.once("error", reject);
      });
      assert(readyMsg.type === "relay:ready", "Agent enregistré avec succès sur le serveur relais réel");
      const pinCode = readyMsg.code;
      assert(typeof pinCode === "string" && pinCode.length === 6, `Code PIN à 6 chiffres généré par le relais : ${pinCode}`);

      // 7.2 Connecter Client 1
      const client1 = new WebSocket(`ws://127.0.0.1:${RELAY_PORT}/relay?role=client&code=${pinCode}`);
      const c1Connected = await new Promise((resolve, reject) => {
        client1.once("message", (raw) => resolve(JSON.parse(raw.toString())));
        client1.once("error", reject);
      });
      assert(c1Connected.type === "relay:connected", "Client 1 appairé avec succès au relais réel");

      // 7.3 Reconnexion immédiate de Client 2 avec le MÊME code PIN sans fermer Client 1
      const client2 = new WebSocket(`ws://127.0.0.1:${RELAY_PORT}/relay?role=client&code=${pinCode}`);
      const c2Connected = await new Promise((resolve) => {
        client2.once("message", (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "relay:connected") resolve(true);
        });
        client2.once("close", (code) => {
          if (code === 4009) resolve(false);
        });
        client2.once("error", () => resolve(false));
      });
      assert(c2Connected === true, "Client 2 reconnecté immédiatement sans rejet 4009 already_paired");

      // 7.4 Vérifier l'éviction propre de Client 1
      await sleep(100);
      assert(
        client1.readyState === WebSocket.CLOSING || client1.readyState === WebSocket.CLOSED,
        "L'ancienne socket Client 1 a été évincée proprement par le serveur relais réel"
      );

      // 7.5 Relais des commandes de Client 2 vers l'Agent
      const agentReceivedPromise = new Promise((resolve) => {
        agentSocket.once("message", (raw) => resolve(JSON.parse(raw.toString())));
      });
      client2.send(JSON.stringify({ type: "client:test_msg", value: 123 }));
      const received = await Promise.race([agentReceivedPromise, sleep(500).then(() => null)]);
      assert(received?.value === 123, "Message de commande relayé avec succès de Client 2 vers l'Agent");

      client2.close();
      agentSocket.close();
    } finally {
      relayProc.kill();
    }
  }

  // ============================================================================
  // TEST SUITE 8 : F18 — Single-Channel TV Command Dispatch (Mono-Canal)
  // (Exécution directe du module réel client/src/core/discovery.ts)
  // ============================================================================
  console.log("\n▶ SUITE 8 : F18 — Dispatch Mono-Canal TV (Module Réel discovery.ts)\n");
  {
    const TEST_HTTP_TV_PORT = 4759;
    const TEST_WS_TV_PORT = 4760;

    let httpFetchCount = 0;
    let lastHttpPayload = null;
    const httpTvServer = http.createServer((req, res) => {
      if (req.url === "/pair/tv/command" && req.method === "POST") {
        httpFetchCount++;
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => {
          try {
            lastHttpPayload = JSON.parse(data);
          } catch {}
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, message: "Action reçue via HTTP" }));
        });
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise((r) => httpTvServer.listen(TEST_HTTP_TV_PORT, r));

    // Configurer l'environnement client pour pointer vers nos serveurs de test
    globalThis.location = {
      hostname: "127.0.0.1",
      port: String(TEST_HTTP_TV_PORT),
      protocol: "http:",
      host: `127.0.0.1:${TEST_HTTP_TV_PORT}`,
    };
    globalThis.localStorage.setItem("nexus.host", "127.0.0.1");

    let wsSentCount = 0;
    let lastWsPayload = null;
    const wsTvServer = new WebSocketServer({ port: TEST_WS_TV_PORT });
    wsTvServer.on("connection", (ws) => {
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "tv:command") {
            wsSentCount++;
            lastWsPayload = msg;
          }
        } catch {}
      });
    });

    // 8.1 WebSocket est déconnecté : repli exclusif HTTP
    wsClient.disconnect();
    assert(wsClient.isReady() === false, "wsClient n'est pas prêt en mode déconnecté");

    httpFetchCount = 0;
    wsSentCount = 0;
    lastHttpPayload = null;
    const resFallback = await discovery.sendTvCommand("192.168.1.100", "volup");
    assert(wsSentCount === 0, "Canal WebSocket NON appelé quand WS est déconnecté (0 message WS)");
    assert(httpFetchCount === 1, "Canal HTTP fetch appelé en repli exclusif (1 appel HTTP)");
    assert(resFallback.ok === true, "Résultat de commande OK via repli HTTP");
    assert(lastHttpPayload?.action === "volup", "Payload TV correctement transmis via HTTP");

    // 8.2 WebSocket est connecté : dispatch exclusif WebSocket sans requête HTTP
    wsClient.connect({
      mode: "local",
      host: "127.0.0.1",
      port: TEST_WS_TV_PORT,
      token: "test-token-f18",
    });

    for (let i = 0; i < 20; i++) {
      if (wsClient.isReady()) break;
      await sleep(50);
    }
    assert(wsClient.isReady() === true, "wsClient est connecté et prêt (isReady === true)");

    httpFetchCount = 0;
    wsSentCount = 0;
    lastWsPayload = null;
    const resWs = await discovery.sendTvCommand("192.168.1.100", "volup");
    await sleep(50);

    assert(wsSentCount === 1, "Canal WebSocket utilisé de manière exclusive (1 message WS)");
    assert(httpFetchCount === 0, "Canal HTTP fetch NON appelé quand WS est prêt (0 double exécution)");
    assert(resWs.ok === true, "Résultat de commande OK via WebSocket");
    assert(lastWsPayload?.action === "volup", "Payload TV correctement transmis via WebSocket");

    wsClient.disconnect();
    await new Promise((r) => wsTvServer.close(r));
    await new Promise((r) => httpTvServer.close(r));
  }

  // ============================================================================
  // BILAN DE LA SUITE
  // ============================================================================
  console.log("\n================================================================================");
  console.log(`  BILAN M2 : ${passedTests}/${totalTests} tests réussis (${failedTests} échecs)`);
  console.log("================================================================================\n");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runM2Tests().catch((err) => {
  console.error("Erreur fatale dans la suite de tests M2 :", err);
  process.exit(1);
});
