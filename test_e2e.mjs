import { spawn } from "node:child_process";
import { WebSocket } from "ws";

const HTTP_PORT = 4710;
const WS_PORT = 4711;

let serverProcess = null;

function log(test, status, details = "") {
  const icon = status ? "✅" : "❌";
  console.log(`${icon} [${test}] ${details}`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log("\n=======================================================");
  console.log("  🧪 NEXUS REMOTE ALL — SUITE DE TESTS END-TO-END");
  console.log("=======================================================\n");

  let allPassed = true;

  // 1. Démarrage du serveur d'intégration
  console.log("▶ 1. Démarrage du serveur d'intégration sur ports dédiés (HTTP 4710, WS 4711)...");
  serverProcess = spawn("node", ["server/dist/server/src/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXUS_HTTP_PORT: String(HTTP_PORT),
      NEXUS_WS_PORT: String(WS_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stderr.on("data", (d) => {
    const str = d.toString();
    if (!str.includes("Connexion WebSocket refusée")) {
      console.error("[Serveur ERR]:", str);
    }
  });

  await sleep(1500);

  // 2. Test HTTP /health
  let token = "";
  try {
    const res = await fetch(`http://127.0.0.1:${HTTP_PORT}/health`);
    const data = await res.json();
    const ok = res.status === 200 && data.ok === true;
    log("HTTP /health", ok, `Status ${res.status}, Service: "${data.service}"`);
    if (!ok) allPassed = false;
  } catch (e) {
    log("HTTP /health", false, String(e));
    allPassed = false;
  }

  // 3. Test HTTP /pair/qr
  try {
    const res = await fetch(`http://127.0.0.1:${HTTP_PORT}/pair/qr`);
    const data = await res.json();
    token = data.token;
    const ok =
      res.status === 200 &&
      Boolean(token) &&
      data.qrDataUrl.startsWith("data:image/png;base64,");
    log(
      "HTTP /pair/qr",
      ok,
      `Token JWT généré (longueur ${token.length}), QR DataURL valide`,
    );
    if (!ok) allPassed = false;
  } catch (e) {
    log("HTTP /pair/qr", false, String(e));
    allPassed = false;
  }

  // 4. Test HTTP /pair/display (Page HTML avec QR)
  try {
    const res = await fetch(`http://127.0.0.1:${HTTP_PORT}/pair/display`);
    const text = await res.text();
    const ok = res.status === 200 && text.includes("Scannez ce QR Code");
    log("HTTP /pair/display", ok, `Page HTML servie avec succès (${text.length} octets)`);
    if (!ok) allPassed = false;
  } catch (e) {
    log("HTTP /pair/display", false, String(e));
    allPassed = false;
  }

  // 5. Test Distribution PWA statique
  try {
    const resRoot = await fetch(`http://127.0.0.1:${HTTP_PORT}/`);
    const html = await resRoot.text();
    const resManifest = await fetch(
      `http://127.0.0.1:${HTTP_PORT}/manifest.webmanifest`,
    );
    const manifest = await resManifest.json();
    const resSW = await fetch(`http://127.0.0.1:${HTTP_PORT}/sw.js`);

    const ok =
      resRoot.status === 200 &&
      html.includes("Nexus Remote All") &&
      resManifest.status === 200 &&
      manifest.short_name === "Nexus Remote" &&
      resSW.status === 200;

    log(
      "Distribution PWA",
      ok,
      `index.html (200), manifest.webmanifest (200), Service Worker sw.js (200)`,
    );
    if (!ok) allPassed = false;
  } catch (e) {
    log("Distribution PWA", false, String(e));
    allPassed = false;
  }

  // 6. Test Sécurité WebSocket (Connexion sans token -> rejetée au handshake HTTP 401)
  await new Promise((resolve) => {
    const wsUnauthorized = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
    wsUnauthorized.on("error", (err) => {
      const ok = err.message.includes("401");
      log(
        "Sécurité WS",
        ok,
        `Connexion sans token rejetée au handshake : "${err.message}" (401)`,
      );
      if (!ok) allPassed = false;
      resolve();
    });
    wsUnauthorized.on("open", () => {
      log("Sécurité WS", false, "ERREUR : Connexion acceptée sans token !");
      allPassed = false;
      wsUnauthorized.close();
      resolve();
    });
  });

  // 7. Test Connexion WebSocket avec Token JWT valide
  let wsClient = null;
  await new Promise((resolve) => {
    wsClient = new WebSocket(`ws://127.0.0.1:${WS_PORT}?token=${token}`);
    wsClient.on("open", () => {
      log("Auth WebSocket", true, "Client connecté avec JWT valide !");
      resolve();
    });
    wsClient.on("error", (err) => {
      log("Auth WebSocket", false, String(err));
      allPassed = false;
      resolve();
    });
  });

  // 8. Test Commandes Temps Réel via WebSocket
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    const testCommand = async (name, cmd) => {
      return new Promise((resolve) => {
        const handler = (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === "ack" && msg.cmd === cmd.type) {
              log(`WS Command: ${name}`, true, `Reçu ACK pour '${cmd.type}'`);
              wsClient.off("message", handler);
              resolve(true);
            }
          } catch {}
        };
        wsClient.on("message", handler);
        wsClient.send(JSON.stringify(cmd));
        setTimeout(() => {
          wsClient.off("message", handler);
          resolve(false);
        }, 1500);
      });
    };

    // Commande Souris
    const okMouse = await testCommand("mouse:move", {
      type: "mouse:move",
      dx: 0,
      dy: 0,
    });
    if (!okMouse) allPassed = false;

    // Commande Clavier
    const okKey = await testCommand("key:tap", {
      type: "key:tap",
      key: "Escape",
    });
    if (!okKey) allPassed = false;

    // Commande Média
    const okMedia = await testCommand("media:key", {
      type: "media:key",
      key: "ok",
    });
    if (!okMedia) allPassed = false;

    // Commande Slides
    const okSlide = await testCommand("slide:next", { type: "slide:next" });
    if (!okSlide) allPassed = false;

    // Commande Erreur Invalide
    await new Promise((resolve) => {
      wsClient.once("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        const ok = msg.type === "error";
        log(
          "WS Commande Invalide",
          ok,
          `JSON corrompu géré proprement : error = "${msg.payload}"`,
        );
        if (!ok) allPassed = false;
        resolve();
      });
      wsClient.send("NOT_A_VALID_JSON{{{");
    });

    wsClient.close();
  }

  // 9. Arrêt propre du serveur
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }

  console.log("\n=======================================================");
  if (allPassed) {
    console.log("  🏆 TOUS LES TESTS SONT AU VERT — SYSTÈME 100% OPÉRATIONNEL");
  } else {
    console.log("  ⚠️ CERTAINS TESTS ONT ÉCHOUÉ — VÉRIFICATION REQUISE");
  }
  console.log("=======================================================\n");

  process.exit(allPassed ? 0 : 1);
}

run().catch((e) => {
  if (serverProcess) serverProcess.kill();
  console.error("Erreur critique de test :", e);
  process.exit(1);
});
