import type { Command } from "@shared/protocol";
import { importKey, encrypt, decrypt, isEnvelope } from "./e2e";

export type Status = "connecting" | "open" | "closed";

export type ConnectionConfig =
  | { mode: "cloud"; code: string; key?: string }
  | { mode: "local"; host: string; port: number; token: string };

let socket: WebSocket | null = null;
let queue: Command[] = [];
let currentConfig: ConnectionConfig | null = null;
let statusCb: (s: Status) => void = () => {};
let errorCb: (msg: string) => void = () => {};
let shouldReconnect = true;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectTimer: any = null;
let keepAliveTimer: any = null;
let cryptoKey: CryptoKey | null = null; // clé E2E (F5), mode cloud uniquement
let clientSeq = 0; // Compteur de séquence anti-rejeu (F6)
let sendChain: Promise<void> = Promise.resolve(); // sérialise le chiffrement pour préserver l'ordre

function stopKeepAlive(): void {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function startKeepAlive(): void {
  stopKeepAlive();
  keepAliveTimer = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: "ping", ts: Date.now() }));
      } catch {}
    }
  }, 15000);
}

/** Abonnement à l'état de la connexion. */
export function onStatus(cb: (s: Status) => void): void {
  statusCb = cb;
}

/** Abonnement aux messages d'erreur de connexion. */
export function onError(cb: (msg: string) => void): void {
  errorCb = cb;
}

export function isReconnecting(): boolean {
  return shouldReconnect;
}

/** Ouvre la connexion (mode Cloud avec code PIN, ou mode Local avec IP). */
export function connect(config: ConnectionConfig): void {
  currentConfig = config;
  shouldReconnect = true;
  reconnectAttempts = 0;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  cryptoKey = null;
  clientSeq = 0;

  // Sécurité Contenu Mixte : un navigateur sur https:// bloque les WebSockets non sécurisés ws://
  if (config.mode === "local" && location.protocol === "https:") {
    shouldReconnect = false;
    statusCb("closed");
    errorCb(
      `Connexion locale bloquée par le navigateur : les connexions directes Wi-Fi non chiffrées (ws://) sont interdites depuis un site sécurisé (https://). ` +
      `Pour utiliser le Wi-Fi direct, ouvrez http://${config.host}:4700 sur votre smartphone, ou utilisez la connexion Cloud.`
    );
    return;
  }

  if (config.mode === "cloud") {
    // F5 — le mode cloud EXIGE la clé de chiffrement (transmise via le QR).
    if (!config.key) {
      statusCb("closed");
      errorCb("Le contrôle à distance nécessite de scanner le QR Code sécurisé (chiffrement requis).");
      return;
    }
    importKey(config.key)
      .then((k) => {
        cryptoKey = k;
        flush();
      })
      .catch(() => errorCb("Clé de chiffrement invalide."));
  }

  open();
}

function getSocketUrl(cfg: ConnectionConfig): string {
  if (cfg.mode === "cloud") {
    const isRemoteDomain = location.hostname.includes("unlineservice.com");
    const baseHost = isRemoteDomain ? location.host : "remote.unlineservice.com";
    // Le relais Cloud distant exige impérativement WSS
    const proto = "wss";
    const code = cfg.code.replace(/\D/g, "");
    return `${proto}://${baseHost}/relay?role=client&code=${code}`;
  } else {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${cfg.host}:${cfg.port}?token=${encodeURIComponent(cfg.token)}`;
  }
}

function getDeviceDetails(): { name: string; device: string } {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  let dev = "Smartphone Mobile";
  if (/iPad/i.test(ua)) dev = "iPad (Safari)";
  else if (/iPhone/i.test(ua)) dev = "iPhone (Safari)";
  else if (/Android/i.test(ua)) {
    dev = /Mobile/i.test(ua) ? "Smartphone Android" : "Tablette Android";
  } else if (/Macintosh/i.test(ua)) dev = "Mac";
  else if (/Windows/i.test(ua)) dev = "PC Windows";

  const customName = typeof localStorage !== "undefined" ? localStorage.getItem("nexus.deviceName") : null;
  return {
    name: customName || dev,
    device: dev,
  };
}

function open(): void {
  if (!currentConfig) return;

  statusCb("connecting");
  const url = getSocketUrl(currentConfig);

  try {
    socket = new WebSocket(url);

    socket.onopen = () => {
      clientSeq = 0;
      reconnectAttempts = 0;
      statusCb("open");
      startKeepAlive();
      try {
        const details = getDeviceDetails();
        socket?.send(JSON.stringify({ type: "client:hello", ...details }));
      } catch {}
      flush();
    };

    socket.onmessage = async (e) => {
      try {
        let data = JSON.parse(e.data);
        // Si le mode est Cloud et qu'une clé est disponible, déchiffrer l'enveloppe entrante
        if (currentConfig?.mode === "cloud" && cryptoKey && isEnvelope(data)) {
          try {
            const pt = await decrypt(cryptoKey, data);
            data = JSON.parse(pt);
          } catch {
            return;
          }
        }
        if (data.type === "relay:error") {
          errorCb(data.message || "Erreur de relais");
        } else if (data.type === "error" && typeof data.payload === "string") {
          if (data.payload.includes("déconnecté par l'ordinateur hôte") || data.payload.includes("Token révoqué")) {
            shouldReconnect = false;
            try {
              localStorage.removeItem("nexus.token");
              localStorage.removeItem("nexus.code");
              if (typeof history !== "undefined" && history.replaceState) {
                history.replaceState(null, "", location.pathname);
              }
            } catch {}
            errorCb(data.payload);
          }
        }
      } catch {}
    };

    socket.onclose = (e) => {
      statusCb("closed");
      stopKeepAlive();
      // Arrêt définitif de la reconnexion automatique pour les codes fatals
      if (
        e.code === 4000 || // Replaced by new connection (évite les batailles infinies d'éviction)
        e.code === 4001 || // Unauthorized
        e.code === 4003 || // Forbidden
        e.code === 4004 || // Invalid PIN code
        e.code === 4008 || // Heartbeat timeout / Kicked by host
        e.code === 1008    // Policy violation
      ) {
        shouldReconnect = false;
        try {
          localStorage.removeItem("nexus.token");
          localStorage.removeItem("nexus.code");
          if (typeof history !== "undefined" && history.replaceState) {
            history.replaceState(null, "", location.pathname);
          }
        } catch {}
        if (e.code === 4000) {
          errorCb("Cette session de télécommande a été reprise par un autre appareil.");
        } else if (e.code === 4004) {
          errorCb("Code de connexion introuvable ou expiré.");
        } else {
          errorCb("Vous avez été déconnecté par l'ordinateur hôte.");
        }
        return;
      }

      if (shouldReconnect) {
        reconnectAttempts++;
        if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
          shouldReconnect = false;
          errorCb(
            "Impossible d'établir la connexion après plusieurs tentatives. Vérifiez que l'application est bien lancée sur votre ordinateur et que vous êtes sur le bon réseau."
          );
          return;
        }
        // Backoff exponentiel progressif : 1.5s -> 2.5s -> 4s -> 6s max
        const delay = Math.min(1500 * Math.pow(1.5, reconnectAttempts - 1), 6000);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(open, delay);
      }
    };

    socket.onerror = () => {
      socket?.close();
    };
  } catch (err) {
    statusCb("closed");
    errorCb(String(err));
  }
}

export function disconnect(): void {
  shouldReconnect = false;
  reconnectAttempts = 0;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopKeepAlive();
  socket?.close();
  socket = null;
  clientSeq = 0;
  queue = [];
}

const MAX_OFFLINE_QUEUE_SIZE = 50;
const WS_BACKPRESSURE_THRESHOLD = 32 * 1024; // 32 Ko

/** Prêt à émettre : socket ouvert + (en cloud) clé E2E importée. */
function ready(): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  if (currentConfig?.mode === "cloud" && !cryptoKey) return false;
  return true;
}

/** Indique si le client WebSocket est connecté et prêt à émettre (en clair ou E2EE prêt). */
export function isReady(): boolean {
  return ready();
}

/** Alias de isReady pour conformité d'interface. */
export function isConnected(): boolean {
  return ready();
}

/** Utilitaire d'observabilité et de test : taille actuelle de la file d'attente hors-ligne. */
export function getQueueSize(): number {
  return queue.length;
}

/** Utilitaire de test : vide la file d'attente hors-ligne. */
export function clearQueue(): void {
  queue = [];
}

/** Vide la file d'attente une fois la connexion (et la clé) prêtes. */
function flush(): void {
  if (!ready()) return;
  const items = queue;
  queue = [];
  // Élimine les deltas de mouvement résiduels accumulés pendant la déconnexion
  const filtered = items.filter((c) => c.type !== "mouse:move" && c.type !== "mouse:scroll");
  for (const c of filtered) frameAndSend(c);
}

/** Encode puis émet une commande : chiffrée E2E en mode cloud, en clair en local. */
function frameAndSend(cmd: Command): void {
  if (!ready()) {
    // Élimination immédiate des deltas éphémères hors-ligne
    if (cmd.type === "mouse:move" || cmd.type === "mouse:scroll") {
      return;
    }
    // File bornée avec éviction FIFO de la plus ancienne commande
    if (queue.length >= MAX_OFFLINE_QUEUE_SIZE) {
      queue.shift();
    }
    queue.push(cmd);
    return;
  }

  // Contre-pression active : éliminer les deltas de mouvement si le buffer réseau est saturé
  if (cmd.type === "mouse:move" || cmd.type === "mouse:scroll") {
    if (socket && socket.bufferedAmount > WS_BACKPRESSURE_THRESHOLD) {
      return;
    }
  }

  if (currentConfig?.mode === "cloud") {
    const key = cryptoKey!;
    // Sérialisé pour garantir l'ordre malgré l'asynchronisme du chiffrement.
    sendChain = sendChain
      .then(async () => {
        const seq = ++clientSeq;
        const ts = Date.now();
        const env = await encrypt(key, JSON.stringify(cmd), seq, ts);
        if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(env));
      })
      .catch(() => {});
  } else {
    socket!.send(JSON.stringify(cmd));
  }
}

/** Envoie une commande vers l'hôte distant. */
export function send(cmd: Command): void {
  frameAndSend(cmd);
}
