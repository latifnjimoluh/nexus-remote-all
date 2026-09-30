/**
 * Test d'intégration du canal CLOUD chiffré de bout en bout (F5).
 *
 * Exerce le pipeline réel : relais local → agent cloud → client chiffré → curseur.
 * Vérifie que le curseur bouge via des commandes AES-256-GCM et qu'AUCUNE commande
 * ne transite en clair (le relais ne voit que des enveloppes opaques).
 *
 * ⚠️ Test LOCAL : nécessite un vrai curseur (nut.js) — ne pas exécuter en CI headless.
 * Prérequis : `npm run build -w @nexus/server && npm run build -w @nexus/relay`
 * Lancement  : `node test_cloud_e2e.mjs`
 */
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { mouse, Point } from "@nut-tree-fork/nut-js";
import { keyFromB64url, encrypt, decrypt } from "./server/dist/server/src/e2e.js";

const RELAY_PORT = 4750;
const REPO = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const relay = spawn("node", ["relay/dist/index.js"], { cwd: REPO, env: { ...process.env, PORT: String(RELAY_PORT) }, stdio: ["ignore", "pipe", "pipe"] });
relay.stdout.on("data", () => {}); relay.stderr.on("data", () => {});
let relayUp = false;
for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${RELAY_PORT}/health`)).status === 200) { relayUp = true; break; } } catch {} await sleep(200); }
console.log("1. relais cloud up      :", relayUp);

let agentOut = "";
const agent = spawn("node", ["server/dist/server/src/index.js"], {
  cwd: REPO,
  env: { ...process.env, NEXUS_CLOUD: "1", NEXUS_RELAY_URL: `ws://127.0.0.1:${RELAY_PORT}/relay`, NEXUS_HTTP_PORT: "4752", NEXUS_WS_PORT: "4753" },
  stdio: ["ignore", "pipe", "pipe"],
});
agent.stdout.on("data", (d) => { agentOut += d.toString(); });
agent.stderr.on("data", () => {});

let code = null, k = null;
for (let i = 0; i < 60; i++) {
  const mCode = agentOut.match(/code=(\d{6})/);
  const mK = agentOut.match(/#k=([A-Za-z0-9_-]+)/);
  if (mCode && mK) { code = mCode[1]; k = mK[1]; break; }
  await sleep(250);
}
console.log("2. agent appairé        : PIN =", code, "| clé E2E =", k ? "reçue" : "ABSENTE");
if (!code || !k) { console.log("INTEGRATION E2E: FAIL (pas de PIN/clé)"); relay.kill(); agent.kill(); process.exit(1); }
const key = keyFromB64url(k);

const client = new WebSocket(`ws://127.0.0.1:${RELAY_PORT}/relay?role=client&code=${code}`);
let connected = false, acks = 0, plaintextLeak = false;
client.on("message", (raw) => {
  let obj; try { obj = JSON.parse(raw.toString()); } catch { return; }
  if (obj.type === "relay:connected") { connected = true; return; }
  if (typeof obj.type === "string" && obj.type.startsWith("relay:")) return;
  if (obj.n && obj.d) { try { if (JSON.parse(decrypt(key, obj)).type === "ack") acks++; } catch {} return; }
  if (obj.type === "ack" || obj.type === "mouse:move") plaintextLeak = true;
});
await new Promise((res) => { client.on("open", res); setTimeout(res, 3000); });
await sleep(500);
console.log("3. client connecté      :", connected);

const orig = await mouse.getPosition();
await mouse.setPosition(new Point(400, 300)); await sleep(150);
const base = await mouse.getPosition();
const sendEnc = (cmd) => client.send(JSON.stringify(encrypt(key, JSON.stringify(cmd))));
for (let i = 0; i < 12; i++) { sendEnc({ type: "mouse:move", dx: 10, dy: 0 }); await sleep(15); }
for (let i = 0; i < 9; i++) { sendEnc({ type: "mouse:move", dx: 0, dy: 10 }); await sleep(15); }
await sleep(400);
const end = await mouse.getPosition();
const dx = end.x - base.x, dy = end.y - base.y;
await mouse.setPosition(new Point(orig.x, orig.y));
console.log("4. curseur (chiffré)    : delta", dx, dy, "| acks chiffrés reçus:", acks);

client.close(); agent.kill(); relay.kill();
const ok = relayUp && connected && dx >= 100 && dy >= 70 && acks > 0 && !plaintextLeak;
console.log("   confidentialité (aucune commande en clair) :", !plaintextLeak);
console.log(ok ? "INTEGRATION E2E: PASS" : "INTEGRATION E2E: FAIL");
process.exit(ok ? 0 : 1);
