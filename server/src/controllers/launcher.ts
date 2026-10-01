import { exec } from "node:child_process";

/**
 * Lanceur d'applications (Macro Deck).
 * Utilise la commande `start` de cmd.exe pour ouvrir apps/URLs/protocoles.
 */
const APPS: Record<string, string> = {
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
};

export function launch(target: string): void {
  const cmd = APPS[target];
  if (cmd) exec(cmd, { shell: "cmd.exe" });
}
