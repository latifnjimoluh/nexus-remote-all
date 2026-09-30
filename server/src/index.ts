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
import { getLocalIp, localAddresses } from "./net.js";
import type { ServerMessage } from "../../shared/protocol.js";

// Protection contre les interruptions intempestives
process.on("uncaughtException", (err) => {
  console.error("[Serveur] Exception non interceptée :", err?.message ?? err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[Serveur] Rejet de promesse non géré :", reason);
});

const ip = getLocalIp();

// ─────────────────────────────────────────────────────────────
//  Serveur HTTP (santé, appairage & distribution PWA locale)
// ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// F2 — Anti DNS-rebinding : n'accepter que les requêtes dont l'en-tête Host
// pointe vers une adresse locale de la machine (localhost / IP LAN). Bloque
// l'accès depuis un domaine tiers qui aurait été rebindé sur l'IP locale.
const LOCAL_HOSTS = localAddresses();
app.use((req, res, next) => {
  const host = (req.headers.host ?? "").split(":")[0].toLowerCase();
  if (!LOCAL_HOSTS.has(host)) {
    res.status(403).json({ error: "Hôte non autorisé (protection anti DNS-rebinding)." });
    return;
  }
  next();
});

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
    // F2 — anti DNS-rebinding : si un Origin de navigateur est présent, son hôte
    // doit être local. (Origin absent = client non-navigateur : app native / test.)
    const origin = info.origin;
    if (origin) {
      let originHost = "\0";
      try {
        originHost = new URL(origin).hostname.toLowerCase();
      } catch {
        originHost = "\0";
      }
      if (!LOCAL_HOSTS.has(originHost)) {
        console.warn(`Connexion WebSocket refusée : origine non autorisée (${origin})`);
        callback(false, 403, "Forbidden origin");
        return;
      }
    }
    const token = new URL(info.req.url ?? "", "http://x").searchParams.get("token");
    if (!verifyToken(token)) {
      console.warn("Connexion WebSocket locale refusée : token manquant ou invalide");
      callback(false, 401, "Unauthorized");
      return;
    }
    callback(true);
  },
});

wss.on("connection", (ws) => {
  console.log("Client local connecté ✔");

  ws.on("message", async (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return ws.send(
        JSON.stringify({ type: "error", payload: "JSON invalide" } satisfies ServerMessage),
      );
    }

    const cmdType =
      typeof parsed === "object" && parsed !== null
        ? ((parsed as { type?: unknown }).type as ServerMessage["cmd"])
        : undefined;

    try {
      await handleCommand(parsed); // validation F3 effectuée dans handleCommand
      ws.send(JSON.stringify({ type: "ack", cmd: cmdType } satisfies ServerMessage));
    } catch (e) {
      ws.send(
        JSON.stringify({ type: "error", cmd: cmdType, payload: String(e) } satisfies ServerMessage),
      );
    }
  });

  ws.on("close", () => console.log("Client local déconnecté"));
});

// ─────────────────────────────────────────────────────────────
//  Services Réseau : mDNS Local + Relais Cloud à Code PIN
// ─────────────────────────────────────────────────────────────
publishService();

// Connexion au relais cloud — DÉSACTIVÉE par défaut (opt-in).
// Le cloud rend le PC pilotable depuis Internet : à n'activer qu'en connaissance de cause.
if (process.env.NEXUS_CLOUD === "1" || process.env.NEXUS_CLOUD === "true") {
  startRelayClient();
} else {
  console.log("☁️  Relais cloud désactivé (opt-in). Activez-le avec NEXUS_CLOUD=1.");
}

createPairingInfo(ip).then((info) => {
  console.log(`WS    → ws://0.0.0.0:${CONFIG.WS_PORT}`);
  console.log("═".repeat(56));
  console.log(`  🌐 ${CONFIG.SERVICE_NAME} — Agent Local Prêt`);
  console.log(`  IP LAN locale : ${ip}`);
  console.log(`  Page QR Web   : http://${ip}:${CONFIG.HTTP_PORT}/pair/display`);
  console.log("═".repeat(56));
});
