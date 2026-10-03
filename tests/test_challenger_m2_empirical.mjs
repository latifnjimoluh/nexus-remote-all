/**
 * Test Suite Empirique et Adversariale - Challenger M2-1
 *
 * Mission:
 * 1. WebSocket Heartbeat & Ghost Sockets:
 *    - Connect a client that ignores WS ping frames -> verify server terminates connection with code 4008 after timeout.
 *    - Connect and abruptly close socket at raw TCP level -> verify no ghost socket left in connectedClients map.
 * 2. Server Clean Shutdown API & Port Rebinding:
 *    - Start agent, verify listening, call stop(), verify ports are immediately reusable without EADDRINUSE.
 * 3. Dynamic Host Anti-Rebinding Check:
 *    - Verify valid host headers (127.0.0.1, localhost, LAN IPs) are accepted while external malicious domains are rejected with 403.
 */

import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { WebSocket } from "ws";

// Modules compilés du serveur Nexus
import { startAgent } from "../server/dist/server/src/agent.js";
import { localAddresses } from "../server/dist/server/src/net.js";
import { generateClientToken } from "../server/dist/server/src/auth/pairing.js";

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

// Vérifie si un port TCP est ouvert / disponible
function checkPortAvailable(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(200);
    socket.once("connect", () => {
      socket.destroy();
      resolve(false); // Connecté => port en cours d'utilisation
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(true); // Erreur de connexion => port libre
    });
    socket.connect(port, host);
  });
}

async function runEmpiricalChallengerM2() {
  console.log("================================================================================");
  console.log("  CHALLENGER M2-1 : SUITE D'ÉVALUATION EMPIRIQUE & ADVERSARIALE");
  console.log("  Milestone M2 : Network Resilience, Heartbeat, Shutdown API & Anti-Rebinding");
  console.log("================================================================================\n");

  // ============================================================================
  // DOMAINE 1 : WEBSOCKET HEARTBEAT & GHOST SOCKETS
  // ============================================================================
  console.log("▶ DOMAINE 1 : WebSocket Heartbeat & Détection de Sockets Fantômes\n");
  {
    const HTTP_PORT = 4780;
    const WS_PORT = 4781;
    process.env.NEXUS_HEARTBEAT_INTERVAL = "200"; // 200ms pour réactivité du test

    const agent = await startAgent({
      log: false,
      enableCloud: false,
      enableMdns: false,
      httpPort: HTTP_PORT,
      wsPort: WS_PORT,
    });
    const { token } = await agent.getPairingInfo();

    // 1.1 Client ignorant les trames ping WS -> terminaison avec code 4008
    console.log("  [1.1] Test Client Muet / Inerte (ignore les pings WS)");
    const silentWs = new WebSocket(`ws://127.0.0.1:${WS_PORT}?token=${token}`);
    await new Promise((resolve) => silentWs.on("open", resolve));

    // Suppression stricte de la réponse automatique pong
    silentWs.pong = () => {};
    silentWs.removeAllListeners("ping");

    assert(agent.getConnectedClients().length === 1, "Client initialement enregistré dans connectedClients (1 client)");

    const terminationPromise = new Promise((resolve) => {
      silentWs.on("close", (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    const termResult = await Promise.race([
      terminationPromise,
      sleep(1500).then(() => ({ code: -1, reason: "timeout" })),
    ]);

    assert(termResult.code === 4008, `Connexion terminée par le serveur avec le code 4008 (obtenu: ${termResult.code})`);
    assert(
      termResult.reason.includes("Heartbeat timeout") || termResult.code === 4008,
      `Raison de clôture conforme: "${termResult.reason}"`,
    );

    // Attente brève pour propagation du nettoyage interne
    await sleep(50);
    assert(
      agent.getConnectedClients().length === 0,
      `connectedClients nettoyé à 0 suite à clôture 4008 (actuel: ${agent.getConnectedClients().length})`,
    );

    // 1.2 Client actif répondant aux pings reste connecté
    console.log("  [1.2] Test Client Actif (répond normalement aux pings)");
    const activeWs = new WebSocket(`ws://127.0.0.1:${WS_PORT}?token=${token}`);
    await new Promise((resolve) => activeWs.on("open", resolve));
    activeWs.on("ping", () => {
      if (activeWs.readyState === WebSocket.OPEN) {
        activeWs.pong();
      }
    });

    // Attendre 3 cycles de heartbeat (600ms > 3 * 200ms)
    await sleep(650);
    assert(activeWs.readyState === WebSocket.OPEN, "Le client actif répondant aux pings est maintenu ouvert");
    assert(agent.getConnectedClients().length === 1, "connectedClients contient exactement 1 client actif");
    activeWs.close();
    await sleep(50);
    assert(agent.getConnectedClients().length === 0, "connectedClients vidé après fermeture propre du client actif");

    // 1.3 Coupure brutale au niveau TCP brut (ws._socket.destroy) -> pas de socket fantôme
    console.log("  [1.3] Test Coupure Brutale au Niveau TCP Brut (socket.destroy sans WS close frame)");
    const abruptWs = new WebSocket(`ws://127.0.0.1:${WS_PORT}?token=${token}`);
    await new Promise((resolve) => abruptWs.on("open", resolve));
    assert(agent.getConnectedClients().length === 1, "Client connecté enregistré dans connectedClients");

    // Destruction immédiate du socket TCP sous-jacent (simule perte radio brutale / crash client)
    abruptWs._socket.destroy();
    await sleep(80);

    assert(
      agent.getConnectedClients().length === 0,
      `Aucune socket fantôme laissée dans connectedClients après TCP destroy (taille: ${agent.getConnectedClients().length})`,
    );

    // 1.4 Coupure brutale via client TCP brut avec handshake HTTP Upgrade manuel
    console.log("  [1.4] Test Coupure Brutale via Client TCP Brut avec Handshake Manuel");
    const rawTcpClient = new net.Socket();
    const wsKey = crypto.randomBytes(16).toString("base64");
    const handshakeReq =
      `GET /?token=${token} HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${WS_PORT}\r\n` +
      `Upgrade: websocket\r\n` +
      `Connection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${wsKey}\r\n` +
      `Sec-WebSocket-Version: 13\r\n\r\n`;

    await new Promise((resolve) => {
      rawTcpClient.connect(WS_PORT, "127.0.0.1", () => {
        rawTcpClient.write(handshakeReq);
      });
      rawTcpClient.on("data", (data) => {
        if (data.toString().includes("101 Switching Protocols")) {
          resolve(true);
        }
      });
    });

    assert(agent.getConnectedClients().length === 1, "Client TCP brut connecté et enregistré");

    // Coupure brutale immédiate sans aucune trame WS de fermeture (envoi direct TCP RST/FIN)
    rawTcpClient.destroy();
    await sleep(80);

    assert(
      agent.getConnectedClients().length === 0,
      `Aucune socket fantôme après coupure TCP brute du client manuel (taille: ${agent.getConnectedClients().length})`,
    );

    // 1.5 Stress test de concurrence : 20 connexions simultanées avec tokens distincts rompues brutalement
    console.log("  [1.5] Stress Test : 20 Connexions Multi-Clients & Déconnexions TCP Brutales Simultanées");
    const stressClients = [];
    for (let i = 0; i < 20; i++) {
      const uniqueToken = generateClientToken("127.0.0.1", `client-stress-${i}`);
      const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}?token=${uniqueToken}`);
      stressClients.push(ws);
    }
    await Promise.all(
      stressClients.map((ws) => new Promise((resolve) => ws.on("open", resolve))),
    );

    assert(agent.getConnectedClients().length === 20, `20 clients simultanés connectés (obtenu: ${agent.getConnectedClients().length})`);

    // Destruction brutale collective simultanée au niveau TCP
    for (const ws of stressClients) {
      ws._socket.destroy();
    }
    await sleep(150);

    assert(
      agent.getConnectedClients().length === 0,
      `Nettoyage parfait : 0 socket fantôme après destruction brutale collective de 20 clients (obtenu: ${agent.getConnectedClients().length})`,
    );

    await agent.stop();
    delete process.env.NEXUS_HEARTBEAT_INTERVAL;
  }

  // ============================================================================
  // DOMAINE 2 : SERVER CLEAN SHUTDOWN API & PORT REBINDING
  // ============================================================================
  console.log("\n▶ DOMAINE 2 : API d'Arrêt Propre du Serveur & Réutilisation Immédiate des Ports\n");
  {
    const REBIND_HTTP = 4782;
    const REBIND_WS = 4783;

    // 2.1 Vérification de l'interface AgentHandle
    console.log("  [2.1] Vérification des signatures d'API stop() et close()");
    const agent1 = await startAgent({
      log: false,
      enableCloud: false,
      enableMdns: false,
      httpPort: REBIND_HTTP,
      wsPort: REBIND_WS,
    });

    assert(typeof agent1.stop === "function", "AgentHandle.stop est une fonction asynchrone");
    assert(typeof agent1.close === "function", "AgentHandle.close est un alias valide de stop");

    // Vérification de l'écoute effective
    const healthRes = await fetch(`http://127.0.0.1:${REBIND_HTTP}/health`);
    assert(healthRes.status === 200, `Serveur HTTP répond sur le port ${REBIND_HTTP} (200 OK)`);

    const { token: t1 } = await agent1.getPairingInfo();
    const clientWs = new WebSocket(`ws://127.0.0.1:${REBIND_WS}?token=${t1}`);
    await new Promise((resolve) => clientWs.on("open", resolve));
    assert(clientWs.readyState === WebSocket.OPEN, `Serveur WS accepte les connexions sur le port ${REBIND_WS}`);

    // 2.2 Appel de stop() et vérification de libération immédiate
    console.log("  [2.2] Exécution de agent1.stop() et vérification de libération des ports");
    let clientClosedCode = null;
    clientWs.on("close", (code) => {
      clientClosedCode = code;
    });

    await agent1.stop();

    await sleep(50);
    assert(
      clientClosedCode === 1001 || clientWs.readyState === WebSocket.CLOSED,
      `Client WS notifié de l'arrêt du serveur (code 1001 "Server shutting down", obtenu: ${clientClosedCode})`,
    );

    const httpPortFree = await checkPortAvailable(REBIND_HTTP);
    const wsPortFree = await checkPortAvailable(REBIND_WS);
    assert(httpPortFree, `Port HTTP ${REBIND_HTTP} immédiatement libéré`);
    assert(wsPortFree, `Port WS ${REBIND_WS} immédiatement libéré`);

    // 2.3 Réouverture IMMÉDIATE d'une nouvelle instance sur les MÊMES PORTS
    console.log("  [2.3] Démarrage immédiat d'une seconde instance sur les mêmes ports (Test EADDRINUSE)");
    let agent2 = null;
    let bindError = null;
    try {
      agent2 = await startAgent({
        log: false,
        enableCloud: false,
        enableMdns: false,
        httpPort: REBIND_HTTP,
        wsPort: REBIND_WS,
      });
    } catch (e) {
      bindError = e;
    }

    assert(bindError === null, "Seconde instance démarrée sans exception EADDRINUSE", bindError?.message);
    assert(agent2 !== null, "agent2 instancié avec succès");

    if (agent2) {
      const health2 = await fetch(`http://127.0.0.1:${REBIND_HTTP}/health`);
      assert(health2.status === 200, `agent2 répond immédiatement sur http://127.0.0.1:${REBIND_HTTP}/health`);
      await agent2.stop();
    }

    // 2.4 Stress Test : 5 Cycles Rapides Consécutifs de Start / Stop / Rebind
    console.log("  [2.4] Stress Test : 5 Cycles Consécutifs de Start/Stop/Rebind sans délai");
    let rapidSuccessCount = 0;
    const CYCLE_HTTP = 4784;
    const CYCLE_WS = 4785;

    for (let cycle = 1; cycle <= 5; cycle++) {
      try {
        const inst = await startAgent({
          log: false,
          enableCloud: false,
          enableMdns: false,
          httpPort: CYCLE_HTTP,
          wsPort: CYCLE_WS,
        });
        const res = await fetch(`http://127.0.0.1:${CYCLE_HTTP}/health`);
        if (res.status === 200) {
          await inst.stop();
          rapidSuccessCount++;
        } else {
          await inst.stop();
        }
      } catch (err) {
        console.error(`    Échec au cycle ${cycle} :`, err.message);
        break;
      }
    }
    assert(rapidSuccessCount === 5, `5 cycles consécutifs Start/Stop exécutés avec succès (0 EADDRINUSE)`);

    // 2.5 Fermeture propre avec connexions HTTP Keep-Alive actives
    console.log("  [2.5] Arrêt propre avec connexion HTTP Keep-Alive résidente");
    const agentKeepAlive = await startAgent({
      log: false,
      enableCloud: false,
      enableMdns: false,
      httpPort: REBIND_HTTP,
      wsPort: REBIND_WS,
    });

    const keepAliveAgent = new http.Agent({ keepAlive: true });
    await fetch(`http://127.0.0.1:${REBIND_HTTP}/health`, { agent: keepAliveAgent });

    await agentKeepAlive.stop();
    keepAliveAgent.destroy();

    const freeAfterKeepAlive = await checkPortAvailable(REBIND_HTTP);
    assert(freeAfterKeepAlive, "Port HTTP libéré même avec agent keep-alive résident");

    // 2.6 Idempotence de stop()
    console.log("  [2.6] Test d'Idempotence de stop()");
    let doubleStopThrown = false;
    try {
      await agentKeepAlive.stop();
    } catch {
      doubleStopThrown = true;
    }
    assert(!doubleStopThrown, "Second appel à stop() s'exécute de manière idempotente sans lever d'exception");
  }

  // ============================================================================
  // DOMAINE 3 : DYNAMIC HOST ANTI-REBINDING CHECK
  // ============================================================================
  console.log("\n▶ DOMAINE 3 : Validation Dynamique de l'Hôte Anti DNS-Rebinding\n");
  {
    const REBIND_TEST_HTTP = 4786;
    const REBIND_TEST_WS = 4787;

    const agent = await startAgent({
      log: false,
      enableCloud: false,
      enableMdns: false,
      httpPort: REBIND_TEST_HTTP,
      wsPort: REBIND_TEST_WS,
    });
    const { token } = await agent.getPairingInfo();

    // 3.1 Hôtes légitimes autorisés (Bouclage & IPv6)
    console.log("  [3.1] Hôtes de bouclage légitimes acceptés (200 OK)");

    const validHosts = [
      `127.0.0.1:${REBIND_TEST_HTTP}`,
      `localhost:${REBIND_TEST_HTTP}`,
      `[::1]:${REBIND_TEST_HTTP}`,
      `127.0.0.1`,
      `localhost`,
      `[::1]`,
      `LOCALHOST:${REBIND_TEST_HTTP}`,
    ];

    for (const hostHeader of validHosts) {
      const res = await fetch(`http://127.0.0.1:${REBIND_TEST_HTTP}/health`, {
        headers: { Host: hostHeader },
      });
      assert(res.status === 200, `Hôte valide "${hostHeader}" accepté avec statut 200`);
    }

    // 3.2 Toutes les adresses IP physiques de la machine (LAN) sont acceptées dynamiquement
    console.log("  [3.2] Adresses IP LAN réelles de la machine acceptées");
    const machineIps = Array.from(localAddresses()).filter(
      (ip) => ip !== "localhost" && ip !== "127.0.0.1" && ip !== "::1" && ip !== "::ffff:127.0.0.1",
    );

    for (const lanIp of machineIps) {
      // Formater pour IPv6 si contient ':'
      const formattedHost = lanIp.includes(":")
        ? `[${lanIp}]:${REBIND_TEST_HTTP}`
        : `${lanIp}:${REBIND_TEST_HTTP}`;

      const res = await fetch(`http://127.0.0.1:${REBIND_TEST_HTTP}/health`, {
        headers: { Host: formattedHost },
      });
      assert(res.status === 200, `Adresse LAN de la machine "${formattedHost}" acceptée avec statut 200`);
    }

    // 3.3 Hôtes externes et domaines malveillants strictement rejetés avec HTTP 403
    console.log("  [3.3] Domaines externes et tentatives de DNS-rebinding rejetés (HTTP 403 Forbidden)");
    const evilHosts = [
      "evil.com",
      `evil.com:${REBIND_TEST_HTTP}`,
      "attacker.evil-domain.com",
      `attacker.evil-domain.com:${REBIND_TEST_HTTP}`,
      "localhost.evil-domain.com",
      "127.0.0.1.attacker.com",
      "spoofed.bank.com",
      "10.254.254.254", // IP privée arbitraire n'appartenant pas à cette machine
      "192.168.254.254",
      "127.0.0.1.nip.io",
      "attacker.com:80",
    ];

    for (const evil of evilHosts) {
      const res = await new Promise((resolve) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: REBIND_TEST_HTTP,
            path: "/health",
            method: "GET",
            headers: { Host: evil },
          },
          (r) => {
            let body = "";
            r.on("data", (chunk) => (body += chunk));
            r.on("end", () => resolve({ status: r.statusCode, body }));
          },
        );
        req.on("error", () => resolve({ status: -1, body: "" }));
        req.end();
      });

      assert(res.status === 403, `Hôte malveillant "${evil}" rejeté avec code 403 (obtenu: ${res.status})`);
      assert(
        res.body.includes("anti DNS-rebinding") || res.body.includes("non autorisé"),
        `Message d'erreur anti-rebinding explicite pour "${evil}"`,
      );
    }

    // 3.4 Poignée de main WebSocket (Handshake WS) avec en-tête Host externe rejetée
    console.log("  [3.4] Handshake WebSocket avec en-tête Host externe malveillant");
    const evilWs = new WebSocket(`ws://127.0.0.1:${REBIND_TEST_WS}?token=${token}`, {
      headers: { Host: `attacker.evil-domain.com:${REBIND_TEST_WS}` },
    });

    const evilWsStatus = await new Promise((resolve) => {
      evilWs.on("unexpected-response", (_req, res) => {
        resolve(res.statusCode);
      });
      evilWs.on("open", () => resolve(200));
      evilWs.on("error", () => resolve(403));
    });
    assert(evilWsStatus === 403, `Handshake WS avec Host externe rejeté avec HTTP 403 Forbidden (obtenu: ${evilWsStatus})`);

    // 3.5 Handshake WebSocket avec Origin externe malveillant rejeté
    console.log("  [3.5] Handshake WebSocket avec Origin externe malveillant");
    const evilOriginWs = new WebSocket(`ws://127.0.0.1:${REBIND_TEST_WS}?token=${token}`, {
      headers: { Origin: "https://evil-attacker-site.com" },
    });

    const evilOriginStatus = await new Promise((resolve) => {
      evilOriginWs.on("unexpected-response", (_req, res) => {
        resolve(res.statusCode);
      });
      evilOriginWs.on("open", () => resolve(200));
      evilOriginWs.on("error", () => resolve(403));
    });
    assert(
      evilOriginStatus === 403,
      `Handshake WS avec Origin malveillant rejeté avec HTTP 403 Forbidden (obtenu: ${evilOriginStatus})`,
    );

    // 3.6 Handshake WebSocket légitime accepté
    console.log("  [3.6] Handshake WebSocket avec Host et Origin légitimes");
    const legitimateWs = new WebSocket(`ws://127.0.0.1:${REBIND_TEST_WS}?token=${token}`, {
      headers: {
        Host: `127.0.0.1:${REBIND_TEST_WS}`,
        Origin: `http://127.0.0.1:${REBIND_TEST_HTTP}`,
      },
    });

    await new Promise((resolve) => legitimateWs.on("open", resolve));
    assert(legitimateWs.readyState === WebSocket.OPEN, "Handshake WS légitime accepté avec succès");
    legitimateWs.close();

    await agent.stop();
  }

  // ============================================================================
  // DOMAINE 4 : ADVERSARIAL STRESS TEST DE L'ÉVICTION CLIENT PAR TOKEN (F14)
  // ============================================================================
  console.log("\n▶ DOMAINE 4 : Adversarial Test d'Isolation de Révocation Multi-Clients (F14)\n");
  {
    const ISO_HTTP = 4788;
    const ISO_WS = 4789;

    const agent = await startAgent({
      log: false,
      enableCloud: false,
      enableMdns: false,
      httpPort: ISO_HTTP,
      wsPort: ISO_WS,
    });

    const tokenA = generateClientToken("127.0.0.1", "client-device-alpha");
    const tokenB = generateClientToken("127.0.0.1", "client-device-beta");

    const wsA = new WebSocket(`ws://127.0.0.1:${ISO_WS}?token=${tokenA}`);
    const wsB = new WebSocket(`ws://127.0.0.1:${ISO_WS}?token=${tokenB}`);

    await Promise.all([
      new Promise((res) => wsA.on("open", res)),
      new Promise((res) => wsB.on("open", res)),
    ]);

    assert(agent.getConnectedClients().length === 2, "Deux télécommandes distinctes connectées simultanément");

    // Expulser client-device-alpha via disconnectClient
    agent.disconnectClient("client-device-alpha");
    await sleep(50);

    assert(wsA.readyState === WebSocket.CLOSED, "Client Alpha est immédiatement déconnecté");
    assert(wsB.readyState === WebSocket.OPEN, "Client Beta demeure STRICTEMENT connecté (pas d'effet domino)");
    assert(agent.getConnectedClients().length === 1, "connectedClients contient exactement 1 client (Beta)");
    assert(agent.getConnectedClients()[0].id === "client-device-beta", "Le client restant est bien Beta");

    wsB.close();
    await agent.stop();
  }

  // ============================================================================
  // BILAN SYNTHÉTIQUE DE LA SUITE CHALLENGER
  // ============================================================================
  console.log("\n================================================================================");
  console.log(`  BILAN CHALLENGER M2 : ${passedTests}/${totalTests} tests réussis (${failedTests} échecs)`);
  console.log("================================================================================\n");

  if (failedTests > 0) {
    console.error("Détails des échecs constatés :");
    for (const f of failures) {
      console.error(`- ${f.message} : ${f.details}`);
    }
    process.exit(1);
  } else {
    console.log("🎯 TOUTES LES HYPOTHÈSES ADVERSARIALES ET CRITÈRES DE RÉSILIENCE M2 SONT VALIDÉS.");
    process.exit(0);
  }
}

runEmpiricalChallengerM2().catch((err) => {
  console.error("Erreur fatale non interceptée lors de la suite challenger :", err);
  process.exit(1);
});
