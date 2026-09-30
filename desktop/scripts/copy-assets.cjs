#!/usr/bin/env node
/**
 * Copie les bundles compilés du serveur et du client PWA dans le dossier de
 * l'app Electron afin qu'ils soient embarqués dans l'installeur.
 *
 *   ../server/dist  ->  ./agent-dist   (code de l'agent + shared/)
 *   ../client/dist  ->  ./client-dist  (PWA statique servie sur le LAN)
 *
 * Lancé automatiquement avant « start », « dev » et « dist ».
 */
const { cpSync, existsSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const repo = join(root, "..");

const jobs = [
  { from: join(repo, "server", "dist"), to: join(root, "agent-dist"), label: "agent (server/dist)" },
  { from: join(repo, "client", "dist"), to: join(root, "client-dist"), label: "PWA (client/dist)" },
];

let ok = true;
for (const { from, to, label } of jobs) {
  if (!existsSync(from)) {
    console.error(`[copy-assets] ✖ Source introuvable : ${from}`);
    console.error(`[copy-assets]   Compilez d'abord avec « npm run build » à la racine.`);
    ok = false;
    continue;
  }
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  console.log(`[copy-assets] ✔ ${label} -> ${to}`);
}

// Le code de l'agent est de l'ESM (server/package.json a "type":"module").
// La copie perd ce marqueur ; on le réécrit pour qu'Electron charge l'agent
// comme un module ES et non en CommonJS.
if (ok) {
  writeFileSync(
    join(root, "agent-dist", "package.json"),
    JSON.stringify({ type: "module" }, null, 2),
  );
  console.log("[copy-assets] ✔ agent-dist/package.json ({ type: module }) écrit");
}

if (!ok) process.exit(1);
