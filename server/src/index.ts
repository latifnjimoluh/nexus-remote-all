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
import type { Command, ServerMessage } from "../../shared/protocol.js";

/**
 * Retourne l'IPv4 LAN réelle de l'hôte (adresse joignable par le smartphone).
 * Écarte les interfaces virtuelles (VMware, VirtualBox, WSL/Hyper-V, VPN, Docker…)
 * et les adresses APIPA (169.254.x), puis préfère la carte Wi-Fi, sinon Ethernet.
 */
function getLocalIp(): string {
  const candidates: Array<{ name: string; address: string }> = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const net of addrs ?? []) {
      if (net.family !== "IPv4" || net.internal) continue;
      if (net.address.startsWith("169.254.")) continue; // APIPA / link-local
      candidates.push({ name, address: net.address });
    }
  }

  // Interfaces virtuelles à ignorer (nom convivial Windows/Linux)
  const VIRTUAL =
    /vmware|virtualbox|vbox|vethernet|hyper-?v|wsl|loopback|bluetooth|vpn|tap-?windows|tunnel|tun\d|docker|npcap/i;
  const physical = candidates.filter((c) => !VIRTUAL.test(c.name));
  const pool = physical.length > 0 ? physical : candidates;

  // Préférence : Wi-Fi > Ethernet > première disponible
  const chosen =
    pool.find((c) => /wi-?fi|wireless|wlan|sans[- ]?fil/i.test(c.name)) ??
    pool.find((c) => /ethernet|eth\d|en0/i.test(c.name)) ??
    pool[0];

  return chosen?.address ?? "127.0.0.1";
}

const ip = getLocalIp();

// ─────────────────────────────────────────────────────────────
//  Serveur HTTP (santé, appairage & distribution PWA)
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
  res.json({ ok: true, service: CONFIG.SERVICE_NAME, version: "0.4.0", ip });
});

// Endpoints d'appairage (/pair/qr et /pair/display)
app.use("/pair", pairingRouter);

app.listen(CONFIG.HTTP_PORT, () => {
  console.log(`HTTP  → http://0.0.0.0:${CONFIG.HTTP_PORT}`);
});

// ─────────────────────────────────────────────────────────────
//  Serveur WebSocket (commandes temps réel avec auth verifyClient)
// ─────────────────────────────────────────────────────────────
const wss = new WebSocketServer({
  port: CONFIG.WS_PORT,
  verifyClient: (info, callback) => {
    const token = new URL(info.req.url ?? "", "http://x").searchParams.get("token");
    if (!verifyToken(token)) {
      console.warn("Connexion WebSocket refusée : token manquant ou invalide");
      callback(false, 401, "Unauthorized");
    } else {
      callback(true);
    }
  },
});

wss.on("connection", (ws) => {
  console.log("Client authentifié et connecté ✔");

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

  ws.on("close", () => console.log("Client déconnecté"));
});

// ─────────────────────────────────────────────────────────────
//  Publication mDNS & Bannière avec QR Code
// ─────────────────────────────────────────────────────────────
publishService();

createPairingInfo(ip).then((info) => {
  console.log(`WS    → ws://0.0.0.0:${CONFIG.WS_PORT}`);
  console.log("═".repeat(56));
  console.log(`  🌐 ${CONFIG.SERVICE_NAME} — Serveur Agent v0.4`);
  console.log(`  Hôte LAN    : ${ip}`);
  console.log(`  Page QR Web : http://${ip}:${CONFIG.HTTP_PORT}/pair/display`);
  console.log(`  Lien direct : ${info.url}`);
  console.log("═".repeat(56));
  console.log("\n📱 Scannez le QR Code ci-dessous avec votre smartphone :");
  try {
    qrcodeTerminal.generate(info.url, { small: true });
  } catch {
    // Si la console ne supporte pas le rendu ANSI
  }
  console.log("═".repeat(56));
});
