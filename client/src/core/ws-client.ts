import type { Command } from "@shared/protocol";
import { importKey, encrypt } from "./e2e";

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
let cryptoKey: CryptoKey | null = null; // clé E2E (F5), mode cloud uniquement
let sendChain: Promise<void> = Promise.resolve(); // sérialise le chiffrement pour préserver l'ordre

/** Abonnement à l'état de la connexion. */
export function onStatus(cb: (s: Status) => void): void {
  statusCb = cb;
}

/** Abonnement aux messages d'erreur de connexion. */
export function onError(cb: (msg: string) => void): void {
  errorCb = cb;
}

/** Ouvre la connexion (mode Cloud avec code PIN, ou mode Local avec IP). */
export function connect(config: ConnectionConfig): void {
  currentConfig = config;
  shouldReconnect = true;
  cryptoKey = null;

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
    const proto = location.protocol === "https:" || isRemoteDomain ? "wss" : "ws";
    const code = cfg.code.replace(/\D/g, "");
    return `${proto}://${baseHost}/relay?role=client&code=${code}`;
  } else {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${cfg.host}:${cfg.port}?token=${encodeURIComponent(cfg.token)}`;
  }
}

function open(): void {
  if (!currentConfig) return;

  statusCb("connecting");
  const url = getSocketUrl(currentConfig);

  try {
    socket = new WebSocket(url);

    socket.onopen = () => {
      statusCb("open");
      flush();
    };

    socket.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "relay:error") {
          errorCb(data.message || "Erreur de relais");
        }
      } catch {}
    };

    socket.onclose = (e) => {
      statusCb("closed");
      if (e.code === 4004) {
        // Code PIN invalide ou PC déconnecté : ne pas reconnecter en boucle
        errorCb("Code invalide ou ordinateur hôte déconnecté.");
        shouldReconnect = false;
        return;
      }
      if (shouldReconnect) setTimeout(open, 1500);
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
  socket?.close();
  socket = null;
}

/** Prêt à émettre : socket ouvert + (en cloud) clé E2E importée. */
function ready(): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  if (currentConfig?.mode === "cloud" && !cryptoKey) return false;
  return true;
}

/** Vide la file d'attente une fois la connexion (et la clé) prêtes. */
function flush(): void {
  if (!ready()) return;
  const items = queue;
  queue = [];
  for (const c of items) frameAndSend(c);
}

/** Encode puis émet une commande : chiffrée E2E en mode cloud, en clair en local. */
function frameAndSend(cmd: Command): void {
  if (!ready()) {
    queue.push(cmd);
    return;
  }
  if (currentConfig?.mode === "cloud") {
    const key = cryptoKey!;
    // Sérialisé pour garantir l'ordre malgré l'asynchronisme du chiffrement.
    sendChain = sendChain
      .then(async () => {
        const env = await encrypt(key, JSON.stringify(cmd));
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
