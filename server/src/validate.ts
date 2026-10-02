import type { Command, MediaKey, SystemAction } from "../../shared/protocol.js";

/**
 * F3 — Validation runtime des commandes reçues (WS local ET relais cloud).
 * TypeScript ne protège qu'à la compilation : un client malveillant peut
 * envoyer n'importe quel JSON. On valide donc types et bornes avant exécution.
 * Retourne une commande sûre, ou `null` si la charge utile est invalide.
 */

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

const MAX_DELTA = 10_000; // bornes des mouvements/scroll
const MAX_TEXT = 1_000; // longueur max d'une saisie texte
const MAX_COMBO = 8; // nombre max de touches dans une combinaison
const MAX_KEY = 32; // longueur max d'un nom de touche

const MEDIA_KEYS = new Set<MediaKey>([
  "volup", "voldown", "mute", "play", "pause", "stop", "next", "prev",
  "up", "down", "left", "right", "ok", "home", "back", "menu",
]);
const SYSTEM_ACTIONS = new Set<SystemAction>(["lock", "sleep", "restart", "shutdown", "wol"]);

export function validateCommand(raw: unknown): Command | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;

  switch (c.type) {
    case "mouse:move":
      if (!isNum(c.dx) || !isNum(c.dy) || Math.abs(c.dx) > MAX_DELTA || Math.abs(c.dy) > MAX_DELTA) return null;
      return { type: "mouse:move", dx: c.dx, dy: c.dy };
    case "mouse:scroll":
      if (!isNum(c.dx) || !isNum(c.dy) || Math.abs(c.dx) > MAX_DELTA || Math.abs(c.dy) > MAX_DELTA) return null;
      return { type: "mouse:scroll", dx: c.dx, dy: c.dy };
    case "mouse:click":
      if (c.button !== "left" && c.button !== "right" && c.button !== "middle") return null;
      return { type: "mouse:click", button: c.button };
    case "mouse:drag":
      if (c.state !== "start" && c.state !== "end") return null;
      return { type: "mouse:drag", state: c.state };

    case "key:tap":
      if (!isStr(c.key) || c.key.length === 0 || c.key.length > MAX_KEY) return null;
      return { type: "key:tap", key: c.key };
    case "key:combo":
      if (!Array.isArray(c.keys) || c.keys.length === 0 || c.keys.length > MAX_COMBO) return null;
      if (!c.keys.every((k) => isStr(k) && k.length > 0 && k.length <= MAX_KEY)) return null;
      return { type: "key:combo", keys: c.keys as string[] };
    case "key:text":
      if (!isStr(c.text) || c.text.length > MAX_TEXT) return null;
      return { type: "key:text", text: c.text };

    case "media:key":
      if (!isStr(c.key) || !MEDIA_KEYS.has(c.key as MediaKey)) return null;
      return { type: "media:key", key: c.key as MediaKey };

    case "system:action":
      if (!isStr(c.action) || !SYSTEM_ACTIONS.has(c.action as SystemAction)) return null;
      if (c.mac !== undefined && (!isStr(c.mac) || c.mac.length > 32)) return null;
      return { type: "system:action", action: c.action as SystemAction, mac: c.mac as string | undefined };

    case "launch:app":
      if (!isStr(c.target) || c.target.length === 0 || c.target.length > 64) return null;
      return { type: "launch:app", target: c.target };

    case "slide:next":
    case "slide:prev":
    case "slide:start":
    case "slide:end":
    case "slide:black":
      return { type: c.type } as Command;

    case "tv:command":
      if (!isStr(c.targetIp) || c.targetIp.length === 0 || c.targetIp.length > 64) return null;
      if (!isStr(c.action) || c.action.length === 0 || c.action.length > 32) return null;
      return {
        type: "tv:command",
        targetIp: c.targetIp,
        action: c.action,
        value: c.value,
      };

    case "client:hello":
      return {
        type: "client:hello",
        name: isStr(c.name) ? c.name.slice(0, 60) : undefined,
        device: isStr(c.device) ? c.device.slice(0, 60) : undefined,
      };

    default:
      return null;
  }
}
