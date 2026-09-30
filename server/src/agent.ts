import { join } from "node:path";
import { existsSync } from "node:fs";
import os from "node:os";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { CONFIG } from "./config.js";
import { handleCommand } from "./ws/router.js";
import { verifyToken, revokeToken } from "./auth/middleware.js";
import { pairingRouter, createPairingInfo, refreshActivePin } from "./auth/pairing.js";
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

export interface ConnectedClientInfo {
  id: string;
  ip: string;
  device: string;
  name?: string;
  connectedAt: number;
}

export interface AgentHandle {
  ip: string;
  httpPort: number;
  wsPort: number;
  /** URL de la page QR affichable sur l'écran du PC hôte. */
  pairingDisplayUrl: string;
  /** Récupère les infos actuelles d'appairage sans changer le code PIN. */
  getPairingInfo: () => ReturnType<typeof createPairingInfo>;
  /** Génère à la demande de nouvelles infos d'appairage (token + QR frais). */
  refreshPairing: () => ReturnType<typeof createPairingInfo>;
  /** Liste en temps réel des terminaux mobiles connectés. */
  getConnectedClients: () => ConnectedClientInfo[];
  /** Notifie lors d'une connexion ou déconnexion d'un client. */
  onClientsChange?: (cb: (clients: ConnectedClientInfo[]) => void) => void;
  /** Déconnecte un client spécifique. */
  disconnectClient?: (id: string) => void;
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

  // En-têtes CORS pour permettre l'auto-détection et l'appairage depuis le navigateur mobile
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

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
    res.json({
      ok: true,
      service: CONFIG.SERVICE_NAME,
      version: "0.5.0",
      ip,
      hostname: os.hostname(),
      httpPort: CONFIG.HTTP_PORT,
      wsPort: CONFIG.WS_PORT,
    });
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

  // Suivi en direct des terminaux mobiles connectés
  const connectedClients = new Map<string, { ws: WebSocket; token: string; info: ConnectedClientInfo }>();
  let onClientsChangeCb: ((clients: ConnectedClientInfo[]) => void) | null = null;

  function notifyClientsChange() {
    if (onClientsChangeCb) {
      const list = Array.from(connectedClients.values()).map((c) => c.info);
      onClientsChangeCb(list);
    }
  }

  function disconnectClient(id: string) {
    const entry = connectedClients.get(id);
    if (entry) {
      if (entry.token) {
        revokeToken(entry.token);
      }
      try {
        entry.ws.send(
          JSON.stringify({
            type: "error",
            payload: "Vous avez été déconnecté par l'ordinateur hôte.",
          } satisfies ServerMessage),
        );
        entry.ws.close(4008, "Kicked by host");
      } catch {}
      connectedClients.delete(id);
      notifyClientsChange();
    }
  }

  app.post("/pair/disconnect", (req, res) => {
    const id = req.body?.id;
    if (id && typeof id === "string") {
      disconnectClient(id);
      res.json({ ok: true });
    } else {
      res.status(400).json({ ok: false, error: "ID client manquant" });
    }
  });

  function parseUserAgent(ua?: string): string {
    if (!ua) return "Appareil Mobile";
    if (/iPhone/i.test(ua)) return "iPhone (Safari)";
    if (/iPad/i.test(ua)) return "iPad (Safari)";
    if (/Android/i.test(ua)) {
      if (/Mobile/i.test(ua)) return "Smartphone Android";
      return "Tablette Android";
    }
    if (/Windows/i.test(ua)) return "PC Windows";
    if (/Macintosh/i.test(ua)) return "Mac";
    if (/Linux/i.test(ua)) return "Linux";
    return "Navigateur Web";
  }

  wss.on("connection", (ws, req) => {
    const clientId = Math.random().toString(36).slice(2, 10);
    const rawIp = (req.socket.remoteAddress ?? "127.0.0.1").replace("::ffff:", "");
    const userAgent = (req.headers["user-agent"] as string) || "";
    const deviceType = parseUserAgent(userAgent);
    const token = new URL(req.url ?? "", "http://x").searchParams.get("token") || "";

    const clientInfo: ConnectedClientInfo = {
      id: clientId,
      ip: rawIp,
      device: deviceType,
      connectedAt: Date.now(),
    };

    connectedClients.set(clientId, { ws, token, info: clientInfo });
    say(`Client connecté ✔ [${clientId}] ${clientInfo.device} (${clientInfo.ip}) — Total: ${connectedClients.size}`);
    notifyClientsChange();

    ws.on("message", async (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return ws.send(
          JSON.stringify({ type: "error", payload: "JSON invalide" } satisfies ServerMessage),
        );
      }

      if (parsed && typeof parsed === "object" && (parsed as { type?: string }).type === "client:hello") {
        const hello = parsed as { name?: string; device?: string };
        if (hello.name) clientInfo.name = String(hello.name).slice(0, 50);
        if (hello.device) clientInfo.device = String(hello.device).slice(0, 50);
        notifyClientsChange();
        return;
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

    ws.on("close", () => {
      connectedClients.delete(clientId);
      say(`Client déconnecté [${clientId}] — Total: ${connectedClients.size}`);
      notifyClientsChange();
    });
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

  let currentPairingInfo = await createPairingInfo(ip);
  say(`WS    → ws://0.0.0.0:${CONFIG.WS_PORT}`);
  say("═".repeat(56));
  say(`  🌐 ${CONFIG.SERVICE_NAME} — Agent Local Prêt`);
  say(`  IP LAN locale : ${ip}`);
  say(`  Page QR Web   : ${pairingDisplayUrl}`);
  say("═".repeat(56));
  void port;

  return {
    ip,
    httpPort: CONFIG.HTTP_PORT,
    wsPort: CONFIG.WS_PORT,
    pairingDisplayUrl,
    getPairingInfo: async () => currentPairingInfo,
    refreshPairing: async () => {
      refreshActivePin();
      currentPairingInfo = await createPairingInfo(getLocalIp());
      return currentPairingInfo;
    },
    getConnectedClients: () => Array.from(connectedClients.values()).map((c) => c.info),
    onClientsChange: (cb: (clients: ConnectedClientInfo[]) => void) => {
      onClientsChangeCb = cb;
    },
    disconnectClient,
  };
}
