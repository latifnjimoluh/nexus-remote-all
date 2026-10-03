import { join } from "node:path";
import { existsSync } from "node:fs";
import os from "node:os";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { CONFIG } from "./config.js";
import { handleCommand } from "./ws/router.js";
import { verifyToken, revokeToken, requireAuth } from "./auth/middleware.js";
import { pairingRouter, createPairingInfo, refreshActivePin, generateClientToken } from "./auth/pairing.js";
import { publishService, stopService } from "./discovery/mdns.js";
import { runNetworkScan } from "./discovery/scanner.js";
import { startRelayClient, getCloudSession, onCloudSessionChange, type CloudSessionInfo } from "./relay-client.js";
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
  /** Port HTTP explicite (par défaut : NEXUS_HTTP_PORT ou CONFIG.HTTP_PORT). */
  httpPort?: number;
  /** Port WS explicite (par défaut : NEXUS_WS_PORT ou CONFIG.WS_PORT). */
  wsPort?: number;
  /** Active l'annonce mDNS (par défaut true). */
  enableMdns?: boolean;
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
  /** Génère un jeton unique par client (F14). */
  generateClientToken?: (host?: string, clientId?: string) => string;
  /** Liste en temps réel des terminaux mobiles connectés. */
  getConnectedClients: () => ConnectedClientInfo[];
  /** Notifie lors d'une connexion ou déconnexion d'un client. */
  onClientsChange?: (cb: (clients: ConnectedClientInfo[]) => void) => void;
  /** Récupère l'état et le code de connexion du relais Cloud. */
  getCloudInfo?: () => CloudSessionInfo;
  /** Notifie lors d'une mise à jour de l'état du relais Cloud. */
  onCloudInfoChange?: (cb: (cloud: CloudSessionInfo) => void) => void;
  /** Déconnecte un client spécifique. */
  disconnectClient?: (id: string) => void;
  /** Arrête le serveur, ferme tous les sockets et libère complètement les ports 4700 et 4701 (F12). */
  stop: () => Promise<void>;
  /** Alias pour stop(). */
  close?: () => Promise<void>;
}

/** Interface étendant WebSocket pour le suivi de vivacité (F10). */
interface AliveWebSocket extends WebSocket {
  isAlive?: boolean;
}

/**
 * Émet de manière sécurisée une trame sur un WebSocket (F11).
 * Vérifie que la socket est dans l'état OPEN et intercepte les exceptions synchrones et asynchrones.
 */
function safeSend(ws: WebSocket, message: string | ServerMessage): boolean {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      const payload = typeof message === "string" ? message : JSON.stringify(message);
      ws.send(payload, (err) => {
        if (err) {
          console.warn("[Serveur WS] Échec de l'envoi de trame :", err.message);
        }
      });
      return true;
    } catch (err) {
      console.warn("[Serveur WS] Exception lors de ws.send :", err);
      return false;
    }
  }
  return false;
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
  const httpPort = options.httpPort ?? Number(process.env.NEXUS_HTTP_PORT ?? CONFIG.HTTP_PORT);
  const wsPort = options.wsPort ?? Number(process.env.NEXUS_WS_PORT ?? CONFIG.WS_PORT);

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

  // F17 — Anti DNS-rebinding dynamique avec cache TTL 5s et rafraîchissement à la demande :
  // résiste aux changements d'IP (veille/réveil, renouvellement DHCP, bascule Wi-Fi).
  let cachedLocalHosts: Set<string> | null = null;
  let lastHostsRefresh = 0;
  const HOSTS_CACHE_TTL_MS = 5_000;

  function isAllowedHost(host: string): boolean {
    if (!host) return false;
    const normalized = host.trim().replace(/^\[|\]$/g, "").toLowerCase();

    // Fast-path pour les adresses de bouclage et domaine PWA officiel
    if (
      normalized === "localhost" ||
      normalized === "127.0.0.1" ||
      normalized === "::1" ||
      normalized === "::ffff:127.0.0.1" ||
      normalized === "remote.unlineservice.com" ||
      normalized.endsWith(".unlineservice.com")
    ) {
      return true;
    }

    const now = Date.now();
    if (!cachedLocalHosts || now - lastHostsRefresh > HOSTS_CACHE_TTL_MS) {
      cachedLocalHosts = localAddresses();
      lastHostsRefresh = now;
    }

    if (cachedLocalHosts.has(normalized)) {
      return true;
    }

    // Cache miss : rafraîchissement immédiat à chaud (nouvelle IP attribuée par DHCP / sortie de veille)
    cachedLocalHosts = localAddresses();
    lastHostsRefresh = now;
    return cachedLocalHosts.has(normalized);
  }

  function extractHost(hostHeader?: string): string {
    if (!hostHeader || typeof hostHeader !== "string") return "";
    const trimmed = hostHeader.trim();
    if (!trimmed) return "";
    try {
      return new URL(`http://${trimmed}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    } catch {
      return trimmed.split(":")[0].replace(/^\[|\]$/g, "").toLowerCase();
    }
  }

  app.use((req, res, next) => {
    const host = extractHost(req.headers.host);
    if (!host || !isAllowedHost(host)) {
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
      version: "0.5.1",
      ip,
      hostname: os.hostname(),
      httpPort,
      wsPort,
    });
  });

  app.use("/pair", pairingRouter);

  // Démarrage HTTP avec synchronisation listening et détection d'erreur (F12)
  const httpServer = await new Promise<import("node:http").Server>((resolve, reject) => {
    const server = app.listen(httpPort, "0.0.0.0", () => {
      say(`HTTP  → http://0.0.0.0:${httpPort}`);
      resolve(server);
    });
    server.once("error", reject);
  });
  httpServer.on("error", (err) => {
    console.error("[Serveur HTTP] Erreur :", err.message);
  });

  // ───────────────────────────────────────────────────────────
  //  Serveur WebSocket Local (commandes temps réel sur LAN)
  // ───────────────────────────────────────────────────────────
  let wss: WebSocketServer;
  try {
    wss = await new Promise<WebSocketServer>((resolve, reject) => {
      const server = new WebSocketServer(
        {
          port: wsPort,
          host: "0.0.0.0",
          // Défense anti-flood : une commande/enveloppe fait quelques Ko au plus.
          maxPayload: 64 * 1024,
          verifyClient: (info, callback) => {
            // F17 — Anti DNS-rebinding : validation Origin
            const origin = info.origin;
            if (origin) {
              let originHost = "\0";
              try {
                originHost = new URL(origin).hostname.replace(/^\[|\]$/g, "").toLowerCase();
              } catch {
                originHost = "\0";
              }
              if (!isAllowedHost(originHost)) {
                console.warn(`Connexion WebSocket refusée : origine non autorisée (${origin})`);
                callback(false, 403, "Forbidden origin");
                return;
              }
            }

            // F17 — Validation de l'en-tête Host du handshake WebSocket
            const wsHost = extractHost(info.req.headers.host);
            if (!wsHost || !isAllowedHost(wsHost)) {
              console.warn(`Connexion WebSocket refusée : hôte non autorisé (${wsHost || "absent"})`);
              callback(false, 403, "Hôte non autorisé");
              return;
            }

            const token = new URL(info.req.url ?? "", "http://x").searchParams.get("token");
            if (!verifyToken(token)) {
              console.warn("Connexion WebSocket locale refusée : token manquant ou invalide");
              callback(false, 401, "Unauthorized");
              return;
            }
            callback(true);
          },
        },
        () => {
          say(`WS    → ws://0.0.0.0:${CONFIG.WS_PORT}`);
          resolve(server);
        },
      );
      server.once("error", reject);
    });
  } catch (err) {
    if (httpServer.listening) {
      if (typeof (httpServer as any).closeAllConnections === "function") {
        (httpServer as any).closeAllConnections();
      }
      httpServer.close();
    }
    throw err;
  }

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
        safeSend(
          entry.ws,
          {
            type: "error",
            payload: "Vous avez été déconnecté par l'ordinateur hôte.",
          } satisfies ServerMessage,
        );
        entry.ws.close(4008, "Kicked by host");
      } catch {}
      connectedClients.delete(id);
      notifyClientsChange();
    }
  }

  app.post("/pair/disconnect", requireAuth, (req, res) => {
    const id = req.body?.id;
    if (id && typeof id === "string" && id.trim().length > 0 && id.length <= 64) {
      disconnectClient(id.trim());
      res.json({ ok: true });
    } else {
      res.status(400).json({ ok: false, error: "ID client manquant ou invalide." });
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

  // ───────────────────────────────────────────────────────────
  //  F10 — Balayage Heartbeat (Ping/Pong toutes les 30 secondes)
  // ───────────────────────────────────────────────────────────
  const heartbeatIntervalMs = Number(
    process.env.NEXUS_HEARTBEAT_INTERVAL ?? (CONFIG as any).HEARTBEAT_INTERVAL ?? 30000,
  );
  const heartbeatInterval = setInterval(() => {
    for (const client of wss.clients) {
      const aliveClient = client as AliveWebSocket;
      if (aliveClient.isAlive === false) {
        say(`[Heartbeat] Terminaison socket inactive (code 4008)`);
        try {
          aliveClient.close(4008, "Heartbeat timeout");
        } catch {}
        aliveClient.terminate();
        continue;
      }
      aliveClient.isAlive = false;
      try {
        aliveClient.ping();
      } catch {
        aliveClient.terminate();
      }
    }
  }, heartbeatIntervalMs);
  heartbeatInterval.unref();

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  wss.on("connection", (ws, req) => {
    const rawIp = (req.socket.remoteAddress ?? "127.0.0.1").replace("::ffff:", "");
    const userAgent = (req.headers["user-agent"] as string) || "";
    const deviceType = parseUserAgent(userAgent);
    const token = new URL(req.url ?? "", "http://x").searchParams.get("token") || "";

    // F14 — Identification unique du client : sub/jti ou ID aléatoire
    let tokenClientId: string | undefined;
    if (token) {
      try {
        const decoded = jwt.decode(token) as { sub?: string; jti?: string } | null;
        if (decoded?.sub) tokenClientId = decoded.sub;
        else if (decoded?.jti) tokenClientId = decoded.jti;
      } catch {}
    }

    const clientId = tokenClientId || Math.random().toString(36).slice(2, 10);

    // F11 — Gestionnaire d'erreur systématique sur la socket cliente
    ws.on("error", (err) => {
      say(`[Serveur WS] Alerte socket client [${clientId}] :`, err.message);
    });

    // F10 — Initialisation vivacité et listener pong
    const aliveWs = ws as AliveWebSocket;
    aliveWs.isAlive = true;
    aliveWs.on("pong", () => {
      aliveWs.isAlive = true;
    });

    // Si une socket précédente existe pour ce clientId, la fermer proprement
    const existing = connectedClients.get(clientId);
    if (existing && existing.ws !== ws) {
      say(`[Serveur WS] Reconnexion client [${clientId}] — éviction de l'ancienne socket`);
      try {
        existing.ws.close(4000, "Replaced by new connection");
      } catch {}
    }

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
      aliveWs.isAlive = true;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        safeSend(ws, { type: "error", payload: "JSON invalide" } satisfies ServerMessage);
        return;
      }

      if (parsed && typeof parsed === "object") {
        const pObj = parsed as Record<string, unknown>;
        if (pObj.type === "ping") {
          safeSend(ws, { type: "pong", ts: Date.now() } as any);
          return;
        }
        if (pObj.type === "client:hello") {
          const hello = pObj as { name?: string; device?: string };
          if (hello.name) clientInfo.name = String(hello.name).slice(0, 50);
          if (hello.device) clientInfo.device = String(hello.device).slice(0, 50);
          notifyClientsChange();
          return;
        }
      }

      const cmdType =
        typeof parsed === "object" && parsed !== null
          ? ((parsed as { type?: unknown }).type as ServerMessage["cmd"])
          : undefined;

      try {
        await handleCommand(parsed); // validation F3 effectuée dans handleCommand
        safeSend(ws, { type: "ack", cmd: cmdType } satisfies ServerMessage);
      } catch (e) {
        safeSend(
          ws,
          { type: "error", cmd: cmdType, payload: String(e) } satisfies ServerMessage,
        );
      }
    });

    ws.on("close", () => {
      // F10/F16 : Ne supprimer et notifier que si cette socket est celle activement enregistrée
      if (connectedClients.get(clientId)?.ws === ws) {
        connectedClients.delete(clientId);
        say(`Client déconnecté [${clientId}] — Total: ${connectedClients.size}`);
        notifyClientsChange();
      }
    });
  });

  // ───────────────────────────────────────────────────────────
  //  Services Réseau : mDNS Local + Découverte Smart TVs + Relais Cloud
  // ───────────────────────────────────────────────────────────
  const enableMdns = options.enableMdns ?? true;
  if (enableMdns) {
    publishService();
  }
  void runNetworkScan();

  let relayHandle: { stop?: () => void } | null = null;
  const cloud =
    options.enableCloud ??
    (process.env.NEXUS_CLOUD === "1" || process.env.NEXUS_CLOUD === "true");
  if (cloud) {
    const handle = startRelayClient() as unknown;
    if (handle && typeof (handle as any).stop === "function") {
      relayHandle = handle as { stop: () => void };
    }
  } else {
    say("☁️  Relais cloud désactivé (opt-in). Activez-le avec NEXUS_CLOUD=1.");
  }

  const port = getClientDist() ? CONFIG.HTTP_PORT : CONFIG.CLIENT_PORT;
  const pairingDisplayUrl = `http://127.0.0.1:${httpPort}/pair/display`;

  let currentPairingInfo = await createPairingInfo(ip);
  say(`WS    → ws://0.0.0.0:${wsPort}`);
  say("═".repeat(56));
  say(`  🌐 ${CONFIG.SERVICE_NAME} — Agent Local Prêt`);
  say(`  IP LAN locale : ${ip}`);
  say(`  Page QR Web   : ${pairingDisplayUrl}`);
  say("═".repeat(56));
  void port;

  let isStopping = false;
  async function stop(): Promise<void> {
    if (isStopping) return;
    isStopping = true;

    // 1. Arrêter l'intervalle de heartbeat
    clearInterval(heartbeatInterval);

    // 2. Fermer et terminer tous les WebSockets clients connectés
    for (const client of wss.clients) {
      try {
        client.close(1001, "Server shutting down");
      } catch {}
      try {
        client.terminate();
      } catch {}
    }
    connectedClients.clear();
    notifyClientsChange();

    // 3. Fermer le serveur WebSocket
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });

    // 4. Fermer le serveur HTTP et fermer toutes les connexions actives
    if (httpServer.listening) {
      await new Promise<void>((resolve) => {
        if (typeof (httpServer as any).closeAllConnections === "function") {
          (httpServer as any).closeAllConnections();
        }
        httpServer.close(() => resolve());
      });
    }

    // 5. Arrêter le service mDNS
    if (enableMdns) {
      stopService();
    }

    // 6. Arrêter le relais cloud si actif
    if (relayHandle && typeof relayHandle.stop === "function") {
      relayHandle.stop();
    }

    say(`[Serveur] Arrêt complet : ports ${httpPort} et ${wsPort} libérés.`);
  }

  return {
    ip,
    httpPort,
    wsPort,
    pairingDisplayUrl,
    getPairingInfo: async () => currentPairingInfo,
    refreshPairing: async () => {
      refreshActivePin();
      currentPairingInfo = await createPairingInfo(getLocalIp());
      return currentPairingInfo;
    },
    generateClientToken: (host?: string, clientId?: string) =>
      generateClientToken(host ?? getLocalIp(), clientId),
    getConnectedClients: () => Array.from(connectedClients.values()).map((c) => c.info),
    onClientsChange: (cb: (clients: ConnectedClientInfo[]) => void) => {
      onClientsChangeCb = cb;
    },
    getCloudInfo: () => getCloudSession(),
    onCloudInfoChange: (cb: (cloud: CloudSessionInfo) => void) => onCloudSessionChange(cb),
    disconnectClient,
    stop,
    close: stop,
  };
}
