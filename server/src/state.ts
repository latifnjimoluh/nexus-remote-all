/**
 * État partagé du serveur agent.
 *
 * Le chemin du bundle PWA (client/dist) doit être connu à la fois par le
 * serveur statique (index/agent) et par le module d'appairage (pairing.ts).
 * En mode CLI il est auto-détecté ; en mode application Electron packagée il
 * est fourni explicitement par le processus principal (les fichiers vivent
 * alors sous « resources/ » et non plus relativement à process.cwd()).
 */

let clientDistDir: string | null = null;

/** Définit le dossier du bundle PWA à servir (ou null si aucun). */
export function setClientDist(dir: string | null): void {
  clientDistDir = dir;
}

/** Retourne le dossier du bundle PWA actuellement servi, ou null. */
export function getClientDist(): string | null {
  return clientDistDir;
}
