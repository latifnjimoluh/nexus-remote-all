/**
 * Suite de tests empiriques et contradictoires Challenger M1-1
 *
 * Mission de vérification :
 * 1. `validateCommand` dans `server/src/validate.ts` :
 *    - Boundary violations (hors bornes, NaN, Infinity, -Infinity)
 *    - Touches non autorisées (non-whitelisted keys)
 *    - Applications non autorisées (non-whitelisted apps)
 *    - Attaques par pollution de prototype ("__proto__", "toString", "constructor", "valueOf", "hasOwnProperty")
 *    - Adresses MAC invalides et tentatives d'injection de commandes
 *    - Types de commandes inconnus et charges utiles primitives
 *    - Nettoyage et élimination des attributs parasites
 * 2. Sécurité des points de terminaison (`server/src/auth/pairing.ts` & `server/src/agent.ts`) :
 *    - Requêtes non authentifiées sur POST /pair/tv/command (401)
 *    - Requêtes non authentifiées sur POST /pair/disconnect (401)
 *    - Requêtes authentifiées valides sur POST /pair/tv/command et POST /pair/disconnect
 *    - Requêtes LAN simulées (192.168.1.50, 10.0.0.1, 172.16.0.1) sur GET /pair/qr et GET /pair/display (403)
 *    - Résistance au spoofing d'en-tête X-Forwarded-For sur GET /pair/qr et GET /pair/display (403)
 *    - Requêtes loopback (127.0.0.1, ::1, ::ffff:127.0.0.1) sur GET /pair/qr et GET /pair/display (200)
 *    - Vérification E2E sur serveur agent live
 */

import http from "node:http";
import { spawn } from "node:child_process";
import express from "express";
import jwt from "jsonwebtoken";
import {
  validateCommand,
  VALID_KEYS,
  VALID_APPS,
  MEDIA_KEYS,
  SYSTEM_ACTIONS,
  TV_ACTIONS,
} from "../server/dist/server/src/validate.js";
import {
  isLoopbackAddress,
  requireHostOnly,
  pairingRouter,
} from "../server/dist/server/src/auth/pairing.js";
import { requireAuth } from "../server/dist/server/src/auth/middleware.js";
import { CONFIG } from "../server/dist/server/src/config.js";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function assert(condition, message, details = "") {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${message}`);
  } else {
    failedTests++;
    const err = `❌ [FAIL] ${message} ${details ? "(" + details + ")" : ""}`;
    console.error(`  ${err}`);
    failures.push({ message, details });
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
  console.log("================================================================================");
  console.log("  EMPIRICAL CHALLENGER M1-1 : VALIDATION SCHEMA & ENDPOINT SECURITY");
  console.log("================================================================================\n");

  // ============================================================================
  // SUITE 1 : validateCommand — Robustesse, Bornes, Prototype Pollution & Filtrage
  // ============================================================================
  console.log("▶ SUITE 1 : validateCommand — Tests aux limites & Résistance Adversariale\n");

  // 1.1 Payloads non-objets / primitifs / corrompus
  console.log("  [1.1 Payloads non-objets & types primitifs]");
  assert(validateCommand(null) === null, "null retourne null");
  assert(validateCommand(undefined) === null, "undefined retourne null");
  assert(validateCommand(42) === null, "Nombre primitif retourne null");
  assert(validateCommand("mouse:move") === null, "Chaîne de caractères retourne null");
  assert(validateCommand(true) === null, "Booléen retourne null");
  assert(validateCommand([]) === null, "Tableau vide retourne null");
  assert(validateCommand([1, 2, 3]) === null, "Tableau avec éléments retourne null");
  assert(validateCommand(Symbol("cmd")) === null, "Symbole retourne null");
  assert(validateCommand(() => {}) === null, "Fonction retourne null");

  // 1.2 Types de commandes inconnus ou malformés
  console.log("\n  [1.2 Types de commandes inconnus ou malformés]");
  assert(validateCommand({}) === null, "Objet vide {} retourne null");
  assert(validateCommand({ type: "" }) === null, "type chaîne vide retourne null");
  assert(validateCommand({ type: "unknown:command" }) === null, "type inconnu retourne null");
  assert(validateCommand({ type: "system:exec" }) === null, "type non autorisé 'system:exec' retourne null");
  assert(validateCommand({ type: "os:shell" }) === null, "type shell injection retourne null");
  assert(validateCommand({ type: 12345 }) === null, "type numérique retourne null");
  assert(validateCommand({ type: null }) === null, "type null retourne null");
  assert(validateCommand({ type: ["mouse:move"] }) === null, "type tableau retourne null");

  // 1.3 Attaques par Pollution de Prototype
  console.log("\n  [1.3 Attaques par Pollution de Prototype (__proto__, toString, constructor)]");
  assert(validateCommand({ type: "__proto__" }) === null, "type '__proto__' retourne null");
  assert(validateCommand({ type: "toString" }) === null, "type 'toString' retourne null");
  assert(validateCommand({ type: "constructor" }) === null, "type 'constructor' retourne null");
  assert(validateCommand({ type: "valueOf" }) === null, "type 'valueOf' retourne null");
  assert(validateCommand({ type: "hasOwnProperty" }) === null, "type 'hasOwnProperty' retourne null");

  // Injection via JSON.parse __proto__
  const pollutedJson = '{"__proto__":{"polluted":true},"type":"mouse:move","dx":10,"dy":20}';
  const parsedPolluted = JSON.parse(pollutedJson);
  const validatedPolluted = validateCommand(parsedPolluted);
  assert(validatedPolluted !== null, "Commande valide avec __proto__ parasite est acceptée");
  assert(
    ({}).polluted === undefined && Object.prototype.polluted === undefined,
    "Object.prototype n'est pas pollué après validateCommand",
  );
  assert(validatedPolluted.polluted === undefined, "L'objet retourné ne contient pas la clé injectée polluted");

  // Clés prototype pollution dans les sous-champs
  assert(validateCommand({ type: "key:tap", key: "__proto__" }) === null, "key:tap avec key='__proto__' retourne null");
  assert(validateCommand({ type: "key:tap", key: "toString" }) === null, "key:tap avec key='toString' retourne null");
  assert(validateCommand({ type: "key:tap", key: "constructor" }) === null, "key:tap avec key='constructor' retourne null");
  assert(validateCommand({ type: "launch:app", target: "__proto__" }) === null, "launch:app avec target='__proto__' retourne null");
  assert(validateCommand({ type: "launch:app", target: "toString" }) === null, "launch:app avec target='toString' retourne null");
  assert(validateCommand({ type: "media:key", key: "__proto__" }) === null, "media:key avec key='__proto__' retourne null");
  assert(validateCommand({ type: "media:key", key: "toString" }) === null, "media:key avec key='toString' retourne null");
  assert(validateCommand({ type: "system:action", action: "__proto__" }) === null, "system:action avec action='__proto__' retourne null");
  assert(validateCommand({ type: "system:action", action: "toString" }) === null, "system:action avec action='toString' retourne null");
  assert(validateCommand({ type: "tv:command", targetIp: "127.0.0.1", action: "__proto__" }) === null, "tv:command avec action='__proto__' retourne null");
  assert(validateCommand({ type: "tv:command", targetIp: "127.0.0.1", action: "toString" }) === null, "tv:command avec action='toString' retourne null");

  // 1.4 Bornes mouse:move et mouse:scroll
  console.log("\n  [1.4 Bornes numériques mouse:move & mouse:scroll (MAX_DELTA = 10 000)]");
  // mouse:move hors bornes
  assert(validateCommand({ type: "mouse:move", dx: 10001, dy: 0 }) === null, "mouse:move dx > 10000 retourne null");
  assert(validateCommand({ type: "mouse:move", dx: -10001, dy: 0 }) === null, "mouse:move dx < -10000 retourne null");
  assert(validateCommand({ type: "mouse:move", dx: 0, dy: 10001 }) === null, "mouse:move dy > 10000 retourne null");
  assert(validateCommand({ type: "mouse:move", dx: 0, dy: -10001 }) === null, "mouse:move dy < -10000 retourne null");
  // mouse:move NaN & Infinity
  assert(validateCommand({ type: "mouse:move", dx: Number.NaN, dy: 0 }) === null, "mouse:move dx = NaN retourne null");
  assert(validateCommand({ type: "mouse:move", dx: 0, dy: Number.NaN }) === null, "mouse:move dy = NaN retourne null");
  assert(validateCommand({ type: "mouse:move", dx: Number.POSITIVE_INFINITY, dy: 0 }) === null, "mouse:move dx = +Infinity retourne null");
  assert(validateCommand({ type: "mouse:move", dx: 0, dy: Number.NEGATIVE_INFINITY }) === null, "mouse:move dy = -Infinity retourne null");
  assert(validateCommand({ type: "mouse:move", dx: "100", dy: 0 }) === null, "mouse:move dx chaîne de caractères retourne null");
  assert(validateCommand({ type: "mouse:move", dx: null, dy: 0 }) === null, "mouse:move dx null retourne null");
  assert(validateCommand({ type: "mouse:move", dx: undefined, dy: 0 }) === null, "mouse:move dx undefined retourne null");

  // mouse:move valeurs autorisées aux frontières exactes
  const validMoveEdge = validateCommand({ type: "mouse:move", dx: 10000, dy: -10000 });
  assert(validMoveEdge !== null && validMoveEdge.dx === 10000 && validMoveEdge.dy === -10000, "mouse:move dx=10000, dy=-10000 valide");
  const validMoveZero = validateCommand({ type: "mouse:move", dx: 0, dy: 0 });
  assert(validMoveZero !== null && validMoveZero.dx === 0 && validMoveZero.dy === 0, "mouse:move dx=0, dy=0 valide");

  // mouse:scroll hors bornes & NaN
  assert(validateCommand({ type: "mouse:scroll", dx: 10001, dy: 0 }) === null, "mouse:scroll dx > 10000 retourne null");
  assert(validateCommand({ type: "mouse:scroll", dx: 0, dy: 10001 }) === null, "mouse:scroll dy > 10000 retourne null");
  assert(validateCommand({ type: "mouse:scroll", dx: Number.NaN, dy: 0 }) === null, "mouse:scroll dx = NaN retourne null");
  assert(validateCommand({ type: "mouse:scroll", dx: 0, dy: Number.POSITIVE_INFINITY }) === null, "mouse:scroll dy = Infinity retourne null");
  const validScroll = validateCommand({ type: "mouse:scroll", dx: 100, dy: -200 });
  assert(validScroll !== null && validScroll.dx === 100 && validScroll.dy === -200, "mouse:scroll valide");

  // 1.5 mouse:click & mouse:drag
  console.log("\n  [1.5 mouse:click & mouse:drag]");
  assert(validateCommand({ type: "mouse:click", button: "left" })?.type === "mouse:click", "mouse:click 'left' valide");
  assert(validateCommand({ type: "mouse:click", button: "right" })?.type === "mouse:click", "mouse:click 'right' valide");
  assert(validateCommand({ type: "mouse:click", button: "middle" })?.type === "mouse:click", "mouse:click 'middle' valide");
  assert(validateCommand({ type: "mouse:click", button: "double" }) === null, "mouse:click 'double' invalide retourne null");
  assert(validateCommand({ type: "mouse:click", button: "other" }) === null, "mouse:click 'other' invalide retourne null");
  assert(validateCommand({ type: "mouse:click", button: "" }) === null, "mouse:click chaîne vide retourne null");
  assert(validateCommand({ type: "mouse:click", button: null }) === null, "mouse:click null retourne null");

  assert(validateCommand({ type: "mouse:drag", state: "start" })?.type === "mouse:drag", "mouse:drag 'start' valide");
  assert(validateCommand({ type: "mouse:drag", state: "end" })?.type === "mouse:drag", "mouse:drag 'end' valide");
  assert(validateCommand({ type: "mouse:drag", state: "move" }) === null, "mouse:drag 'move' invalide retourne null");
  assert(validateCommand({ type: "mouse:drag", state: "stop" }) === null, "mouse:drag 'stop' invalide retourne null");
  assert(validateCommand({ type: "mouse:drag", state: "" }) === null, "mouse:drag chaîne vide retourne null");

  // 1.6 key:tap, key:combo, key:text
  console.log("\n  [1.6 Touches clavier : key:tap, key:combo, key:text]");
  // key:tap - Touches valides
  assert(validateCommand({ type: "key:tap", key: "Enter" })?.type === "key:tap", "key:tap 'Enter' valide");
  assert(validateCommand({ type: "key:tap", key: "Escape" })?.type === "key:tap", "key:tap 'Escape' valide");
  assert(validateCommand({ type: "key:tap", key: "A" })?.type === "key:tap", "key:tap 'A' valide");
  assert(validateCommand({ type: "key:tap", key: "F1" })?.type === "key:tap", "key:tap 'F1' valide");
  assert(validateCommand({ type: "key:tap", key: "F12" })?.type === "key:tap", "key:tap 'F12' valide");
  assert(validateCommand({ type: "key:tap", key: "Num0" })?.type === "key:tap", "key:tap 'Num0' valide");
  assert(validateCommand({ type: "key:tap", key: "LeftControl" })?.type === "key:tap", "key:tap 'LeftControl' valide");
  assert(validateCommand({ type: "key:tap", key: "RightSuper" })?.type === "key:tap", "key:tap 'RightSuper' valide");

  // key:tap - Touches non autorisées ou malformées
  assert(validateCommand({ type: "key:tap", key: "a" }) === null, "key:tap minuscule 'a' rejetée (doit être majuscule)");
  assert(validateCommand({ type: "key:tap", key: "enter" }) === null, "key:tap 'enter' en minuscule rejetée");
  assert(validateCommand({ type: "key:tap", key: "Control" }) === null, "key:tap 'Control' générique rejeté");
  assert(validateCommand({ type: "key:tap", key: "Alt" }) === null, "key:tap 'Alt' générique rejeté");
  assert(validateCommand({ type: "key:tap", key: "Meta" }) === null, "key:tap 'Meta' rejeté");
  assert(validateCommand({ type: "key:tap", key: "Num10" }) === null, "key:tap 'Num10' hors bornes rejeté");
  assert(validateCommand({ type: "key:tap", key: "F13" }) === null, "key:tap 'F13' hors bornes rejeté");
  assert(validateCommand({ type: "key:tap", key: "<script>alert(1)</script>" }) === null, "key:tap injection XSS rejetée");
  assert(validateCommand({ type: "key:tap", key: "" }) === null, "key:tap chaîne vide rejetée");
  assert(validateCommand({ type: "key:tap", key: 13 }) === null, "key:tap code ASCII numérique rejeté");

  // key:combo
  assert(validateCommand({ type: "key:combo", keys: [] }) === null, "key:combo tableau vide rejeté");
  assert(
    validateCommand({ type: "key:combo", keys: ["A", "B", "C", "D", "E", "F", "G", "H", "I"] }) === null,
    "key:combo avec 9 touches (> MAX_COMBO 8) rejeté",
  );
  assert(validateCommand({ type: "key:combo", keys: ["LeftControl", "invalidKey"] }) === null, "key:combo avec touche invalide rejeté");
  assert(validateCommand({ type: "key:combo", keys: ["LeftControl", "__proto__"] }) === null, "key:combo avec __proto__ rejeté");
  assert(validateCommand({ type: "key:combo", keys: ["LeftControl", 123] }) === null, "key:combo avec élément non-chaîne rejeté");
  assert(validateCommand({ type: "key:combo", keys: ["LeftControl", null] }) === null, "key:combo avec élément null rejeté");
  assert(validateCommand({ type: "key:combo", keys: "LeftControl" }) === null, "key:combo non-tableau rejeté");

  const validCombo = validateCommand({ type: "key:combo", keys: ["LeftControl", "LeftShift", "S"] });
  assert(validCombo !== null && validCombo.keys.length === 3, "key:combo valide (Ctrl+Shift+S)");
  const validMaxCombo = validateCommand({ type: "key:combo", keys: ["A", "B", "C", "D", "E", "F", "G", "H"] });
  assert(validMaxCombo !== null && validMaxCombo.keys.length === 8, "key:combo à 8 touches (borne max autorisée) valide");

  // key:text (MAX_TEXT = 1 000)
  assert(validateCommand({ type: "key:text", text: "a".repeat(1001) }) === null, "key:text avec 1001 caractères rejeté");
  assert(validateCommand({ type: "key:text", text: 12345 }) === null, "key:text numérique rejeté");
  assert(validateCommand({ type: "key:text", text: null }) === null, "key:text null rejeté");
  assert(validateCommand({ type: "key:text", text: {} }) === null, "key:text objet rejeté");
  const validTextMax = validateCommand({ type: "key:text", text: "a".repeat(1000) });
  assert(validTextMax !== null && validTextMax.text.length === 1000, "key:text à 1000 caractères valide");
  assert(validateCommand({ type: "key:text", text: "Bonjour Nexus!" })?.text === "Bonjour Nexus!", "key:text standard valide");

  // 1.7 media:key & system:action
  console.log("\n  [1.7 media:key & system:action (dont Wake-on-LAN)]");
  assert(validateCommand({ type: "media:key", key: "volup" })?.type === "media:key", "media:key 'volup' valide");
  assert(validateCommand({ type: "media:key", key: "voldown" })?.type === "media:key", "media:key 'voldown' valide");
  assert(validateCommand({ type: "media:key", key: "mute" })?.type === "media:key", "media:key 'mute' valide");
  assert(validateCommand({ type: "media:key", key: "play" })?.type === "media:key", "media:key 'play' valide");
  assert(validateCommand({ type: "media:key", key: "ok" })?.type === "media:key", "media:key 'ok' valide");
  assert(validateCommand({ type: "media:key", key: "power" }) === null, "media:key 'power' rejeté (non présent dans MEDIA_KEYS)");
  assert(validateCommand({ type: "media:key", key: "volume_up" }) === null, "media:key 'volume_up' non normalisé rejeté");
  assert(validateCommand({ type: "media:key", key: "" }) === null, "media:key vide rejeté");

  assert(validateCommand({ type: "system:action", action: "lock" })?.type === "system:action", "system:action 'lock' valide");
  assert(validateCommand({ type: "system:action", action: "sleep" })?.type === "system:action", "system:action 'sleep' valide");
  assert(validateCommand({ type: "system:action", action: "restart" })?.type === "system:action", "system:action 'restart' valide");
  assert(validateCommand({ type: "system:action", action: "shutdown" })?.type === "system:action", "system:action 'shutdown' valide");
  assert(validateCommand({ type: "system:action", action: "reboot" }) === null, "system:action 'reboot' rejeté");
  assert(validateCommand({ type: "system:action", action: "format" }) === null, "system:action 'format' rejeté");
  assert(validateCommand({ type: "system:action", action: "powershell" }) === null, "system:action 'powershell' rejeté");
  assert(validateCommand({ type: "system:action", action: "lock", mac: "a".repeat(33) }) === null, "system:action mac > 32 chars rejeté");

  // system:action:wol (Validation MAC stricte)
  assert(validateCommand({ type: "system:action", action: "wol", mac: "00:11:22:33:44:55" })?.type === "system:action", "wol MAC valide avec ':'");
  assert(validateCommand({ type: "system:action", action: "wol", mac: "00-11-22-33-44-55" })?.type === "system:action", "wol MAC valide avec '-'");
  assert(validateCommand({ type: "system:action", action: "wol", mac: "AA:BB:CC:DD:EE:FF" })?.type === "system:action", "wol MAC majuscule valide");
  assert(validateCommand({ type: "system:action", action: "wol", mac: "00:11:22:33:44" }) === null, "wol MAC trop courte (5 octets) rejetée");
  assert(validateCommand({ type: "system:action", action: "wol", mac: "00:11:22:33:44:55:66" }) === null, "wol MAC trop longue (7 octets) rejetée");
  assert(validateCommand({ type: "system:action", action: "wol", mac: "00:11:22:33:44:GG" }) === null, "wol MAC avec caractères non hexadécimaux rejetée");
  assert(validateCommand({ type: "system:action", action: "wol", mac: "001122334455" }) === null, "wol MAC sans séparateurs rejetée");
  assert(validateCommand({ type: "system:action", action: "wol", mac: "00:11:22:33:44:55; rm -rf /" }) === null, "wol MAC injection commande rejetée");
  assert(validateCommand({ type: "system:action", action: "wol", mac: "" }) === null, "wol MAC chaîne vide rejetée");
  assert(validateCommand({ type: "system:action", action: "wol" }) === null, "wol sans champ mac rejeté");
  assert(validateCommand({ type: "system:action", action: "wol", mac: 12345 }) === null, "wol avec mac numérique rejeté");

  // 1.8 launch:app
  console.log("\n  [1.8 Applications autorisées : launch:app]");
  assert(validateCommand({ type: "launch:app", target: "chrome" })?.type === "launch:app", "launch:app 'chrome' valide");
  assert(validateCommand({ type: "launch:app", target: "firefox" })?.type === "launch:app", "launch:app 'firefox' valide");
  assert(validateCommand({ type: "launch:app", target: "edge" })?.type === "launch:app", "launch:app 'edge' valide");
  assert(validateCommand({ type: "launch:app", target: "explorer" })?.type === "launch:app", "launch:app 'explorer' valide");
  assert(validateCommand({ type: "launch:app", target: "youtube" })?.type === "launch:app", "launch:app 'youtube' valide");
  assert(validateCommand({ type: "launch:app", target: "netflix" })?.type === "launch:app", "launch:app 'netflix' valide");
  assert(validateCommand({ type: "launch:app", target: "primevideo" })?.type === "launch:app", "launch:app 'primevideo' valide");
  assert(validateCommand({ type: "launch:app", target: "spotify" })?.type === "launch:app", "launch:app 'spotify' valide");
  assert(validateCommand({ type: "launch:app", target: "steam" })?.type === "launch:app", "launch:app 'steam' valide");
  assert(validateCommand({ type: "launch:app", target: "vlc" })?.type === "launch:app", "launch:app 'vlc' valide");
  assert(validateCommand({ type: "launch:app", target: "notepad" })?.type === "launch:app", "launch:app 'notepad' valide");

  assert(validateCommand({ type: "launch:app", target: "calc" }) === null, "launch:app 'calc' rejeté");
  assert(validateCommand({ type: "launch:app", target: "cmd" }) === null, "launch:app 'cmd' rejeté");
  assert(validateCommand({ type: "launch:app", target: "powershell" }) === null, "launch:app 'powershell' rejeté");
  assert(validateCommand({ type: "launch:app", target: "bash" }) === null, "launch:app 'bash' rejeté");
  assert(validateCommand({ type: "launch:app", target: "regedit" }) === null, "launch:app 'regedit' rejeté");
  assert(validateCommand({ type: "launch:app", target: "" }) === null, "launch:app chaîne vide rejetée");
  assert(validateCommand({ type: "launch:app", target: 42 }) === null, "launch:app nombre rejeté");

  // 1.9 Commandes de Présentation (Slides)
  console.log("\n  [1.9 Commandes de présentation (slide:*)]");
  assert(validateCommand({ type: "slide:next" })?.type === "slide:next", "slide:next valide");
  assert(validateCommand({ type: "slide:prev" })?.type === "slide:prev", "slide:prev valide");
  assert(validateCommand({ type: "slide:start" })?.type === "slide:start", "slide:start valide");
  assert(validateCommand({ type: "slide:end" })?.type === "slide:end", "slide:end valide");
  assert(validateCommand({ type: "slide:black" })?.type === "slide:black", "slide:black valide");
  assert(validateCommand({ type: "slide:jump" }) === null, "slide:jump rejeté");
  assert(validateCommand({ type: "slide:pause" }) === null, "slide:pause rejeté");

  // 1.10 Commandes Smart TV (tv:command)
  console.log("\n  [1.10 Commandes Smart TV (tv:command)]");
  // targetIp validation
  assert(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "volup" })?.type === "tv:command", "tv:command IP valide");
  assert(validateCommand({ type: "tv:command", targetIp: "localhost", action: "volup" })?.type === "tv:command", "tv:command 'localhost' valide");
  assert(validateCommand({ type: "tv:command", targetIp: "127.0.0.1", action: "volup" })?.type === "tv:command", "tv:command 127.0.0.1 valide");
  assert(validateCommand({ type: "tv:command", targetIp: "", action: "volup" }) === null, "tv:command targetIp vide rejetée");
  assert(validateCommand({ type: "tv:command", targetIp: "not_an_ip", action: "volup" }) === null, "tv:command targetIp invalide rejetée");
  assert(validateCommand({ type: "tv:command", targetIp: "192.168.1.1; rm -rf", action: "volup" }) === null, "tv:command targetIp injection rejetée");
  assert(validateCommand({ type: "tv:command", targetIp: "1".repeat(65), action: "volup" }) === null, "tv:command targetIp > 64 chars rejetée");

  // action whitelist
  assert(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "voldown" })?.type === "tv:command", "tv:command 'voldown' valide");
  assert(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "mute" })?.type === "tv:command", "tv:command 'mute' valide");
  assert(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "power" })?.type === "tv:command", "tv:command 'power' valide");
  assert(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "exploit" }) === null, "tv:command action non autorisée rejetée");

  // set_volume (0 à 100, number finite)
  assert(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "set_volume", value: 0 })?.value === 0, "tv:command set_volume 0 valide");
  assert(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "set_volume", value: 50 })?.value === 50, "tv:command set_volume 50 valide");
  assert(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "set_volume", value: 100 })?.value === 100, "tv:command set_volume 100 valide");
  assert(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "set_volume", value: -1 }) === null, "tv:command set_volume -1 rejeté");
  assert(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "set_volume", value: 101 }) === null, "tv:command set_volume 101 rejeté");
  assert(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "set_volume", value: Number.NaN }) === null, "tv:command set_volume NaN rejeté");
  assert(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "set_volume", value: Number.POSITIVE_INFINITY }) === null, "tv:command set_volume Infinity rejeté");
  assert(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "set_volume", value: "50" }) === null, "tv:command set_volume chaîne '50' rejetée");

  // app (alphanumeric, max 64)
  assert(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "app", value: "netflix" })?.value === "netflix", "tv:command app 'netflix' valide");
  assert(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "app", value: "youtube" })?.value === "youtube", "tv:command app 'youtube' valide");
  assert(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "app", value: "" }) === null, "tv:command app chaîne vide rejetée");
  assert(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "app", value: "netflix; reboot" }) === null, "tv:command app avec espace/point-virgule rejetée");
  assert(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "app", value: "a".repeat(65) }) === null, "tv:command app > 64 chars rejetée");
  assert(validateCommand({ type: "tv:command", targetIp: "192.168.1.50", action: "app", value: 12345 }) === null, "tv:command app valeur numérique rejetée");

  // 1.11 client:hello et assainissement
  console.log("\n  [1.11 client:hello & Assainissement ASCII]");
  const helloNorm = validateCommand({ type: "client:hello", name: "Pixel 7 Pro", device: "Android 14" });
  assert(helloNorm?.type === "client:hello" && helloNorm.name === "Pixel 7 Pro", "client:hello standard valide");

  const helloControlChars = validateCommand({
    type: "client:hello",
    name: "Pixel\x00\x08\x1b 7\x7f",
    device: "Mobile\x00",
  });
  assert(
    helloControlChars?.name === "Pixel 7" && helloControlChars?.device === "Mobile",
    "Caractères de contrôle ASCII supprimés de name et device",
  );

  const helloEmptyControl = validateCommand({
    type: "client:hello",
    name: "\x00\x01\x02",
    device: "SafeDevice",
  });
  assert(helloEmptyControl?.name === undefined, "Nom composé uniquement de caractères de contrôle devient undefined");

  const helloLong = validateCommand({
    type: "client:hello",
    name: "A".repeat(100),
    device: "B".repeat(100),
  });
  assert(
    helloLong?.name?.length === 60 && helloLong?.device?.length === 60,
    "Nom et modèle tronqués à 60 caractères max",
  );

  // 1.12 Élimination des attributs parasites (Clean object guarantee)
  console.log("\n  [1.12 Reconstitution d'objets neufs & Suppression d'attributs parasites]");
  const dirtyCmd = {
    type: "mouse:move",
    dx: 5,
    dy: -10,
    extraParam: "malicious_injection",
    adminPrivilege: true,
    nested: { hack: 1 },
  };
  const cleaned = validateCommand(dirtyCmd);
  assert(cleaned !== null, "Commande valide avec attributs parasites est analysée");
  assert(cleaned.extraParam === undefined, "extraParam a été supprimé");
  assert(cleaned.adminPrivilege === undefined, "adminPrivilege a été supprimé");
  assert(cleaned.nested === undefined, "nested a été supprimé");
  const cleanedKeys = Object.keys(cleaned).sort();
  assert(
    cleanedKeys.length === 3 && cleanedKeys[0] === "dx" && cleanedKeys[1] === "dy" && cleanedKeys[2] === "type",
    "L'objet reconstruit contient strictement les clés attendues ('dx', 'dy', 'type')",
  );

  // ============================================================================
  // SUITE 2 : Endpoint Security — Auth 401 & Loopback-Only 403
  // ============================================================================
  console.log("\n▶ SUITE 2 : Sécurité des Points de Terminaison (/pair/tv/command, /pair/disconnect, /pair/qr, /pair/display)\n");

  // 2.1 Tests unitaires directs de isLoopbackAddress
  console.log("  [2.1 Validation logique de isLoopbackAddress]");
  assert(isLoopbackAddress("127.0.0.1") === true, "127.0.0.1 est reconnu comme loopback");
  assert(isLoopbackAddress("::1") === true, "::1 (IPv6 loopback) est reconnu comme loopback");
  assert(isLoopbackAddress("::ffff:127.0.0.1") === true, "::ffff:127.0.0.1 (IPv4-mapped) est reconnu comme loopback");
  assert(isLoopbackAddress("127.0.0.2") === true, "127.0.0.2 (plage 127.0.0.0/8) est reconnu comme loopback");
  assert(isLoopbackAddress("192.168.1.50") === false, "192.168.1.50 (LAN privé) N'EST PAS reconnu comme loopback");
  assert(isLoopbackAddress("192.168.1.1") === false, "192.168.1.1 N'EST PAS reconnu comme loopback");
  assert(isLoopbackAddress("10.0.0.1") === false, "10.0.0.1 (LAN classe A) N'EST PAS reconnu comme loopback");
  assert(isLoopbackAddress("172.16.0.1") === false, "172.16.0.1 (LAN classe B) N'EST PAS reconnu comme loopback");
  assert(isLoopbackAddress("8.8.8.8") === false, "8.8.8.8 (WAN) N'EST PAS reconnu comme loopback");
  assert(isLoopbackAddress("::ffff:192.168.1.50") === false, "::ffff:192.168.1.50 N'EST PAS reconnu comme loopback");
  assert(isLoopbackAddress(null) === false, "null retourne false");
  assert(isLoopbackAddress(undefined) === false, "undefined retourne false");
  assert(isLoopbackAddress("") === false, "Chaîne vide retourne false");

  // 2.2 Middleware requireHostOnly unitaire
  console.log("\n  [2.2 Middleware requireHostOnly unitaire]");
  {
    let nextCalled = false;
    let statusCode = 0;
    let responseBody = null;
    const reqLan = { socket: { remoteAddress: "192.168.1.50" }, headers: {} };
    const resLan = {
      status(c) { statusCode = c; return this; },
      json(b) { responseBody = b; return this; },
    };
    requireHostOnly(reqLan, resLan, () => { nextCalled = true; });
    assert(nextCalled === false && statusCode === 403, "requireHostOnly rejette IP LAN 192.168.1.50 avec HTTP 403");
    assert(responseBody?.ok === false, "Corps JSON d'erreur ok: false renvoyé");
  }
  {
    let nextCalled = false;
    const reqLoopback = { socket: { remoteAddress: "127.0.0.1" }, headers: {} };
    const resLoopback = { status: () => resLoopback, json: () => resLoopback };
    requireHostOnly(reqLoopback, resLoopback, () => { nextCalled = true; });
    assert(nextCalled === true, "requireHostOnly autorise 127.0.0.1 (appelle next())");
  }
  {
    let nextCalled = false;
    const reqIpv6 = { socket: { remoteAddress: "::1" }, headers: {} };
    const resIpv6 = { status: () => resIpv6, json: () => resIpv6 };
    requireHostOnly(reqIpv6, resIpv6, () => { nextCalled = true; });
    assert(nextCalled === true, "requireHostOnly autorise ::1 (appelle next())");
  }

  // 2.3 Serveur HTTP Express dédié pour tester le routage, simulation LAN & spoofing
  console.log("\n  [2.3 Serveur Express de test — Simulation LAN & Résistance au Spoofing]");
  const TEST_HTTP_PORT = 4737;
  const app = express();
  app.use(express.json());

  // Middleware simulateur d'IP cliente pour tester les flux réseau distants
  app.use((req, res, next) => {
    const simIp = req.headers["x-simulate-socket-ip"];
    if (typeof simIp === "string") {
      Object.defineProperty(req.socket, "remoteAddress", {
        value: simIp,
        configurable: true,
      });
    }
    next();
  });

  app.use("/pair", pairingRouter);

  // Simuler aussi POST /pair/disconnect tel qu'exposé dans agent.ts
  app.post("/pair/disconnect", requireAuth, (req, res) => {
    const id = req.body?.id;
    if (id && typeof id === "string" && id.trim().length > 0 && id.length <= 64) {
      res.json({ ok: true });
    } else {
      res.status(400).json({ ok: false, error: "ID client manquant ou invalide." });
    }
  });

  const testServer = await new Promise((resolve) => {
    const s = app.listen(TEST_HTTP_PORT, "127.0.0.1", () => resolve(s));
  });

  try {
    const baseUrl = `http://127.0.0.1:${TEST_HTTP_PORT}`;

    // A. GET /pair/qr et GET /pair/display en Loopback natif -> Expect 200
    const resQrLoopback = await fetch(`${baseUrl}/pair/qr`);
    assert(resQrLoopback.status === 200, "GET /pair/qr en loopback retourne HTTP 200");
    const jsonQr = await resQrLoopback.json();
    assert(Boolean(jsonQr.token) && Boolean(jsonQr.pin), "GET /pair/qr renvoie token et pin valides");

    const resDisplayLoopback = await fetch(`${baseUrl}/pair/display`);
    assert(resDisplayLoopback.status === 200, "GET /pair/display en loopback retourne HTTP 200");
    const htmlDisplay = await resDisplayLoopback.text();
    assert(htmlDisplay.includes("Appairage"), "GET /pair/display renvoie la page HTML d'appairage");

    // B. GET /pair/qr et GET /pair/display avec IP LAN simulée (192.168.1.50) -> Expect 403
    const resQrLan = await fetch(`${baseUrl}/pair/qr`, {
      headers: { "x-simulate-socket-ip": "192.168.1.50" },
    });
    assert(resQrLan.status === 403, "GET /pair/qr depuis LAN 192.168.1.50 est STRICTEMENT REJETÉ avec HTTP 403");

    const resDisplayLan = await fetch(`${baseUrl}/pair/display`, {
      headers: { "x-simulate-socket-ip": "192.168.1.50" },
    });
    assert(resDisplayLan.status === 403, "GET /pair/display depuis LAN 192.168.1.50 est STRICTEMENT REJETÉ avec HTTP 403");

    // Autres IP de réseaux privés
    const resQrLan10 = await fetch(`${baseUrl}/pair/qr`, {
      headers: { "x-simulate-socket-ip": "10.0.0.1" },
    });
    assert(resQrLan10.status === 403, "GET /pair/qr depuis LAN 10.0.0.1 est REJETÉ avec HTTP 403");

    const resQrLan172 = await fetch(`${baseUrl}/pair/qr`, {
      headers: { "x-simulate-socket-ip": "172.16.5.20" },
    });
    assert(resQrLan172.status === 403, "GET /pair/qr depuis LAN 172.16.5.20 est REJETÉ avec HTTP 403");

    // C. Tentative de Contournement par Spoofing d'en-tête (X-Forwarded-For: 127.0.0.1)
    const resQrSpoof = await fetch(`${baseUrl}/pair/qr`, {
      headers: {
        "x-simulate-socket-ip": "192.168.1.50",
        "X-Forwarded-For": "127.0.0.1",
        "X-Real-IP": "127.0.0.1",
      },
    });
    assert(
      resQrSpoof.status === 403,
      "Spoofing X-Forwarded-For: 127.0.0.1 depuis LAN est neutralisé (HTTP 403)",
    );

    // D. Requêtes non authentifiées sur POST /pair/tv/command -> Expect 401
    const resTvNoAuth = await fetch(`${baseUrl}/pair/tv/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetIp: "127.0.0.1", action: "volup" }),
    });
    assert(resTvNoAuth.status === 401, "POST /pair/tv/command sans jeton retourne HTTP 401");

    const resTvBadToken = await fetch(`${baseUrl}/pair/tv/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid_garbage_token",
      },
      body: JSON.stringify({ targetIp: "127.0.0.1", action: "volup" }),
    });
    assert(resTvBadToken.status === 401, "POST /pair/tv/command avec faux jeton Bearer retourne HTTP 401");

    // E. Requêtes non authentifiées sur POST /pair/disconnect -> Expect 401
    const resDiscNoAuth = await fetch(`${baseUrl}/pair/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "client_123" }),
    });
    assert(resDiscNoAuth.status === 401, "POST /pair/disconnect sans jeton retourne HTTP 401");

    const resDiscBadToken = await fetch(`${baseUrl}/pair/disconnect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer forked_token_bad_signature",
      },
      body: JSON.stringify({ id: "client_123" }),
    });
    assert(resDiscBadToken.status === 401, "POST /pair/disconnect avec faux jeton Bearer retourne HTTP 401");

    // F. Requêtes avec Jeton JWT Valide
    const validJwt = jwt.sign({ role: "remote", host: "127.0.0.1" }, CONFIG.JWT_SECRET, {
      expiresIn: "1h",
      algorithm: "HS256",
    });

    const resDiscValid = await fetch(`${baseUrl}/pair/disconnect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validJwt}`,
      },
      body: JSON.stringify({ id: "valid_client_id" }),
    });
    assert(resDiscValid.status === 200, "POST /pair/disconnect avec JWT valide retourne HTTP 200 { ok: true }");
    const jsonDisc = await resDiscValid.json();
    assert(jsonDisc.ok === true, "Réponse ok: true confirmée");

    const resTvValidAuth = await fetch(`${baseUrl}/pair/tv/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${validJwt}`,
      },
      body: JSON.stringify({ targetIp: "127.0.0.1", action: "volup" }),
    });
    assert(
      resTvValidAuth.status !== 401,
      `POST /pair/tv/command avec JWT valide passe l'authentification (status ${resTvValidAuth.status} != 401)`,
    );

    // G. Vérification de rejet d'un jeton avec mauvais rôle (ex: role: "attacker" ou role: "admin")
    const badRoleJwt = jwt.sign({ role: "attacker", host: "127.0.0.1" }, CONFIG.JWT_SECRET, {
      expiresIn: "1h",
      algorithm: "HS256",
    });
    const resBadRole = await fetch(`${baseUrl}/pair/disconnect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${badRoleJwt}`,
      },
      body: JSON.stringify({ id: "client_123" }),
    });
    assert(resBadRole.status === 401, "JWT sans claim role: 'remote' est strictement rejeté avec HTTP 401");

  } finally {
    await new Promise((resolve) => testServer.close(resolve));
  }

  // ============================================================================
  // SUITE 3 : Vérification E2E Live sur Instance Complète du Serveur Agent
  // ============================================================================
  console.log("\n▶ SUITE 3 : Vérification Live E2E sur Serveur Agent Réel Spawné\n");

  const LIVE_HTTP_PORT = 4725;
  const LIVE_WS_PORT = 4726;

  console.log(`  Démarrage de l'agent réel sur HTTP ${LIVE_HTTP_PORT} / WS ${LIVE_WS_PORT}...`);
  const agentProc = spawn("node", ["server/dist/server/src/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXUS_HTTP_PORT: String(LIVE_HTTP_PORT),
      NEXUS_WS_PORT: String(LIVE_WS_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  agentProc.stdout.on("data", () => {});
  agentProc.stderr.on("data", () => {});

  // Attente active que le serveur soit prêt
  {
    const deadline = Date.now() + 15000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`http://127.0.0.1:${LIVE_HTTP_PORT}/health`);
        if (r.status === 200) {
          ready = true;
          break;
        }
      } catch {}
      await sleep(300);
    }
    assert(ready, "Serveur agent réel opérationnel sur ports dédiés");
  }

  try {
    const liveBase = `http://127.0.0.1:${LIVE_HTTP_PORT}`;

    // Test 1: GET /pair/qr loopback live
    const resQrLive = await fetch(`${liveBase}/pair/qr`);
    assert(resQrLive.status === 200, "Serveur Live : GET /pair/qr retourne 200 OK");
    const qrData = await resQrLive.json();
    assert(Boolean(qrData.token), "Serveur Live : token JWT obtenu via loopback");

    // Test 2: GET /pair/display loopback live
    const resDisplayLive = await fetch(`${liveBase}/pair/display`);
    assert(resDisplayLive.status === 200, "Serveur Live : GET /pair/display retourne 200 OK");

    // Test 3: POST /pair/tv/command sans auth live -> 401
    const resTvNoAuthLive = await fetch(`${liveBase}/pair/tv/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetIp: "127.0.0.1", action: "volup" }),
    });
    assert(resTvNoAuthLive.status === 401, "Serveur Live : POST /pair/tv/command sans auth retourne 401");

    // Test 4: POST /pair/disconnect sans auth live -> 401
    const resDiscNoAuthLive = await fetch(`${liveBase}/pair/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "client_99" }),
    });
    assert(resDiscNoAuthLive.status === 401, "Serveur Live : POST /pair/disconnect sans auth retourne 401");

    // Test 5: POST /pair/disconnect avec token live valide -> 200
    const resDiscValidLive = await fetch(`${liveBase}/pair/disconnect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${qrData.token}`,
      },
      body: JSON.stringify({ id: "test_disconnect_client" }),
    });
    assert(resDiscValidLive.status === 200, "Serveur Live : POST /pair/disconnect avec token légitime retourne 200 OK");
  } finally {
    agentProc.kill("SIGTERM");
    await sleep(500);
  }

  // ============================================================================
  // BILAN FINAL
  // ============================================================================
  console.log("\n================================================================================");
  console.log(`  BILAN : ${passedTests}/${totalTests} tests réussis (${failedTests} échecs)`);
  console.log("================================================================================\n");

  if (failedTests > 0) {
    console.error("Détail des échecs :");
    for (const f of failures) {
      console.error(`- ${f.message}: ${f.details}`);
    }
  }

  process.exit(failedTests === 0 ? 0 : 1);
}

runTests().catch((err) => {
  console.error("Erreur fatale lors des tests :", err);
  process.exit(1);
});
