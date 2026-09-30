import type { Command } from "@shared/protocol";

export type Status = "connecting" | "open" | "closed";

let socket: WebSocket | null = null;
let queue: Command[] = [];
let cfg: { host: string; port: number; token: string } | null = null;
let statusCb: (s: Status) => void = () => {};
let shouldReconnect = true;

/** Abonnement à l'état de la connexion (pour l'indicateur UI). */
export function onStatus(cb: (s: Status) => void): void {
  statusCb = cb;
}

/** Ouvre (ou ré-ouvre) la connexion avec la config donnée. */
export function connect(config: { host: string; port: number; token: string }): void {
  cfg = config;
  shouldReconnect = true;
  open();
}

function open(): void {
  if (!cfg) return;
  // wss:// si la page est servie en HTTPS (D-04), ws:// sinon (dev).
  const proto = location.protocol === "https:" ? "wss" : "ws";
  statusCb("connecting");
  socket = new WebSocket(
    `${proto}://${cfg.host}:${cfg.port}?token=${encodeURIComponent(cfg.token)}`,
  );
  socket.onopen = () => {
    statusCb("open");
    for (const c of queue) socket!.send(JSON.stringify(c));
    queue = [];
  };
  socket.onclose = () => {
    statusCb("closed");
    if (shouldReconnect) setTimeout(open, 1000); // reconnexion auto
  };
  socket.onerror = () => socket?.close();
}

export function disconnect(): void {
  shouldReconnect = false;
  socket?.close();
}

/** Envoie une commande (mise en file si la socket n'est pas prête). */
export function send(cmd: Command): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(cmd));
  } else {
    queue.push(cmd);
  }
}
