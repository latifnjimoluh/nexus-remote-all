import { join } from "node:path";
import { existsSync } from "node:fs";
import express from "express";
import { WebSocketServer } from "ws";
import { CONFIG } from "./config.js";
import { handleCommand } from "./ws/router.js";
import { verifyToken } from "./auth/middleware.js";
import { pairingRouter, createPairingInfo } from "./auth/pairing.js";
import { publishService } from "./discovery/mdns.js";
import { startRelayClient } from "./relay-client.js";
import { getLocalIp, localAddresses } from "./net.js";
import { setClientDist, getClientDist } from "./state.js";
import type { ServerMessage } from "../../shared/protocol.js";

export interface AgentOptions {
  /**
   * Chemin explicite du bundle PWA (client/dist). Fourni par l'app Electron.
   * Si omis, une auto-détection relative à process.cwd() est tentée (mode CLI).
   */
  clientDist?: string;
  /** Active le relais cloud (par défaut : variable d'env NEXUS_CLOUD). */
  enableCloud?: boolean;
  /** Journalise dans la console (par défaut true). */
  log?: boolean;
}

export interface AgentHandle {
  ip: string;
  httpPort: number;
  wsPort: number;
  /** URL de la page QR affichable sur l'écran du PC hôte. */
  pairingDisplayUrl: string;
  /** Génère à la demande de nouvelles infos d'appairage (token + QR frais). */
  refreshPairing: () => ReturnType<typeof createPairingInfo>;
}

/** Résout le dossier du bundle PWA : option explicite, sinon auto-détection. */
function resolveClientDist(explicit?: string): string | null {
  if (explicit && existsSync(explicit)) return explicit;
  const candidates = [
    join(process.cwd(), "../client/dist"),
    join(process.cwd(), "client/dist"),
    join(process.cwd(), "dist/client"),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? null;
}

/**
 * Démarre l'agent Nexus (HTTP + WebSocket + découverte + relais optionnel).
 * Utilisé aussi bien par le CLI (index.ts) que par l'application Electron.
 */
export async function startAgent(options: AgentOptions = {}): Promise<AgentHandle> {
  const log = options.log ?? true;
  const say = (...args: unknown[]) => {
    if (log) console.log(...args);
  };

  const ip = getLocalIp();

  // Chemin du bundle PWA connu de tout le serveur (statique + appairage).
  const clientDist = resolveClientDist(options.clientDist);
  setClientDist(clientDist);

  // ───────────────────────────────────────────────────────────
  //  Serveur HTTP (santé, appairage & distribution PWA locale)
  // ───────────────────────────────────────────────────────────
  const app = express();
  app.use(express.json());

  // F2 — Anti DNS-rebinding : n'accepter que les requêtes dont l'en-tête Host
  // pointe vers une adresse locale de la machine (localhost / IP LAN).
  const LOCAL_HOSTS = localAddresses();
  app.use((req, res, next) => {
    const host = (req.headers.host ?? "").split(":")[0].toLowerCase();
    if (!LOCAL_HOSTS.has(host)) {
      res.status(403).json({ error: "Hôte non autorisé (protection anti DNS-rebinding)." });
      return;
    }
    next();
  });

  // Distribution PWA : sert le bundle client si présent.
  if (clientDist) {
    app.use(express.static(clientDist));
    say(`PWA   → Client servi statiquement depuis : ${clientDist}`);
  }

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: CONFIG.SERVICE_NAME, version: "0.5.0", ip });
  });

  app.use("/pair", pairingRouter);

  const httpServer = app.listen(CONFIG.HTTP_PORT, () => {
    say(`HTTP  → http://0.0.0.0:${CONFIG.HTTP_PORT}`);
  });
  httpServer.on("error", (err) => {
    console.error("[Serveur HTTP] Erreur :", err.message);
  });

  // ───────────────────────────────────────────────────────────
  //  Serveur WebSocket Local (commandes temps réel sur LAN)
  // ───────────────────────────────────────────────────────────
  const wss = new WebSocketServer({
    port: CONFIG.WS_PORT,
    verifyClient: (info, callback) => {
      // F2 — anti DNS-rebinding : si un Origin de navigateur est présent, son
      // hôte doit être local. (Origin absent = client non-navigateur.)
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

  wss.on("error", (err) => {
    console.error("[Serveur WSS] Erreur :", err.message);
  });

  wss.on("connection", (ws) => {
    say("Client local connecté ✔");

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

    ws.on("close", () => say("Client local déconnecté"));
  });

  // ───────────────────────────────────────────────────────────
  //  Services Réseau : mDNS Local + Relais Cloud à Code PIN
  // ───────────────────────────────────────────────────────────
  publishService();

  const cloud =
    options.enableCloud ??
    (process.env.NEXUS_CLOUD === "1" || process.env.NEXUS_CLOUD === "true");
  if (cloud) {
    startRelayClient();
  } else {
    say("☁️  Relais cloud désactivé (opt-in). Activez-le avec NEXUS_CLOUD=1.");
  }

  const port = getClientDist() ? CONFIG.HTTP_PORT : CONFIG.CLIENT_PORT;
  const pairingDisplayUrl = `http://${ip}:${CONFIG.HTTP_PORT}/pair/display`;

  const info = await createPairingInfo(ip);
  say(`WS    → ws://0.0.0.0:${CONFIG.WS_PORT}`);
  say("═".repeat(56));
  say(`  🌐 ${CONFIG.SERVICE_NAME} — Agent Local Prêt`);
  say(`  IP LAN locale : ${ip}`);
  say(`  Page QR Web   : ${pairingDisplayUrl}`);
  say("═".repeat(56));
  void info;
  void port;

  return {
    ip,
    httpPort: CONFIG.HTTP_PORT,
    wsPort: CONFIG.WS_PORT,
    pairingDisplayUrl,
    refreshPairing: () => createPairingInfo(getLocalIp()),
  };
}
