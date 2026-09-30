import { exec } from "node:child_process";
import dgram from "node:dgram";
import type { SystemAction } from "../../../shared/protocol.js";

/**
 * Commandes système Windows (voir DECISIONS.md D-02).
 * ⚠️ restart/shutdown doivent être confirmés côté client avant envoi.
 */
const WIN_CMDS: Partial<Record<SystemAction, string>> = {
  lock: "rundll32.exe user32.dll,LockWorkStation",
  sleep: "rundll32.exe powrprof.dll,SetSuspendState 0,1,0",
  restart: "shutdown /r /t 5",
  shutdown: "shutdown /s /t 5",
};

/** Exécute une action système (hors Wake-on-LAN, géré séparément). */
export function runSystem(action: SystemAction, mac?: string): void {
  if (action === "wol") {
    if (mac) wakeOnLan(mac);
    return;
  }
  const cmd = WIN_CMDS[action];
  if (cmd) exec(cmd);
}

/** Wake-on-LAN : envoie un « paquet magique » en broadcast UDP. */
export function wakeOnLan(mac: string): void {
  const bytes = mac.split(/[:-]/).map((h) => parseInt(h, 16));
  if (bytes.length !== 6 || bytes.some((b) => Number.isNaN(b))) return;

  const magic = Buffer.concat([
    Buffer.alloc(6, 0xff),
    Buffer.concat(Array(16).fill(Buffer.from(bytes))),
  ]);

  const socket = dgram.createSocket("udp4");
  socket.once("error", () => socket.close());
  socket.on("listening", () => socket.setBroadcast(true));
  socket.send(magic, 0, magic.length, 9, "255.255.255.255", () => socket.close());
}
