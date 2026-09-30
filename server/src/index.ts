import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import express from "express";
import { WebSocketServer } from "ws";
import qrcodeTerminal from "qrcode-terminal";
import { CONFIG } from "./config.js";
import { handleCommand } from "./ws/router.js";
import { verifyToken } from "./auth/middleware.js";
import { pairingRouter, createPairingInfo } from "./auth/pairing.js";
import { publishService } from "./discovery/mdns.js";
import { startRelayClient } from "./relay-client.js";
import type { Command, ServerMessage } from "../../shared/protocol.js";

/** Retourne la première IPv4 non-interne (adresse LAN de l'hôte). */
function getLocalIp(): string {
  for (const iface of Object.values(networkInterfaces())) {
    for (const net of iface ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

const ip = getLocalIp();

// ─────────────────────────────────────────────────────────────
//  Serveur HTTP (santé, appairage & distribution PWA locale)
// ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Distribution PWA : sert le dossier client/dist si compilé
const clientDistCandidates = [
  join(process.cwd(), "../client/dist"),
  join(process.cwd(), "client/dist"),
  join(process.cwd(), "dist/client"),
];

for (const dir of clientDistCandidates) {
  if (existsSync(dir)) {
    app.use(express.static(dir));
    console.log(`PWA   → Client servi statiquement depuis : ${dir}`);
    break;
  }
}

// Endpoint de santé
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: CONFIG.SERVICE_NAME, version: "0.5.0", ip });
});

// Endpoints d'appairage (/pair/qr et /pair/display)
app.use("/pair", pairingRouter);

app.listen(CONFIG.HTTP_PORT, () => {
  console.log(`HTTP  → http://0.0.0.0:${CONFIG.HTTP_PORT}`);
});

// ─────────────────────────────────────────────────────────────
//  Serveur WebSocket Local (commandes temps réel sur LAN)
// ─────────────────────────────────────────────────────────────
const wss = new WebSocketServer({
  port: CONFIG.WS_PORT,
  verifyClient: (info, callback) => {
    const token = new URL(info.req.url ?? "", "http://x").searchParams.get("token");
    if (!verifyToken(token)) {
      console.warn("Connexion WebSocket locale refusée : token manquant ou invalide");
      callback(false, 401, "Unauthorized");
    } else {
      callback(true);
    }
  },
});

wss.on("connection", (ws) => {
  console.log("Client local connecté ✔");

  ws.on("message", async (raw) => {
    let cmd: Command;
    try {
      cmd = JSON.parse(raw.toString()) as Command;
    } catch {
      return ws.send(
        JSON.stringify({ type: "error", payload: "JSON invalide" } satisfies ServerMessage),
      );
    }

    try {
      await handleCommand(cmd);
      ws.send(JSON.stringify({ type: "ack", cmd: cmd.type } satisfies ServerMessage));
    } catch (e) {
      ws.send(
        JSON.stringify({ type: "error", cmd: cmd.type, payload: String(e) } satisfies ServerMessage),
      );
    }
  });

  ws.on("close", () => console.log("Client local déconnecté"));
});

// ─────────────────────────────────────────────────────────────
//  Services Réseau : mDNS Local + Relais Cloud à Code PIN
// ─────────────────────────────────────────────────────────────
publishService();

// Connexion automatique au relais cloud (https://remote.unlineservice.com)
startRelayClient();

createPairingInfo(ip).then((info) => {
  console.log(`WS    → ws://0.0.0.0:${CONFIG.WS_PORT}`);
  console.log("═".repeat(56));
  console.log(`  🌐 ${CONFIG.SERVICE_NAME} — Agent Local Prêt`);
  console.log(`  IP LAN locale : ${ip}`);
  console.log(`  Page QR Web   : http://${ip}:${CONFIG.HTTP_PORT}/pair/display`);
  console.log("═".repeat(56));
});
