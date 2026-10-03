import { exec } from "node:child_process";

/**
 * Lanceur d'applications (Macro Deck).
 * Utilise la commande `start` de cmd.exe pour ouvrir apps/URLs/protocoles.
 */
const APPS: Record<string, string> = Object.freeze({
  chrome: "start chrome",
  firefox: "start firefox",
  edge: "start msedge",
  explorer: "start explorer",
  youtube: "start https://youtube.com",
  netflix: "start https://netflix.com",
  primevideo: "start https://www.primevideo.com",
  spotify: "start spotify:",
  steam: "start steam:",
  vlc: "start vlc",
  notepad: "start notepad",
});

export function launch(target: string): void {
  if (!Object.hasOwn(APPS, target)) {
    console.warn(`[Launcher] Application non autorisée ou inconnue : ${target}`);
    return;
  }
  const cmd = APPS[target];
  if (cmd && typeof cmd === "string") {
    exec(cmd, { shell: "cmd.exe" });
  }
}
