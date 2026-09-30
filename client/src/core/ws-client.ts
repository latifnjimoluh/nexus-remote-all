import type { Command } from "@shared/protocol";

export type Status = "connecting" | "open" | "closed";

export type ConnectionConfig =
  | { mode: "cloud"; code: string }
  | { mode: "local"; host: string; port: number; token: string };

let socket: WebSocket | null = null;
let queue: Command[] = [];
let currentConfig: ConnectionConfig | null = null;
let statusCb: (s: Status) => void = () => {};
let errorCb: (msg: string) => void = () => {};
let shouldReconnect = true;

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
      for (const c of queue) socket!.send(JSON.stringify(c));
      queue = [];
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

/** Envoie une commande vers l'hôte distant. */
export function send(cmd: Command): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(cmd));
  } else {
    queue.push(cmd);
  }
}
