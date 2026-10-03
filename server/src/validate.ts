import type { Command, MediaKey, SystemAction } from "../../shared/protocol.js";

/**
 * F1 — Validation runtime stricte et déterministe des commandes reçues.
 * Rejette toute charge utile malformée, hors bornes ou inconnue en renvoyant null.
 * Reconstruit un objet neuf pour interdire toute pollution d'attributs.
 */

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

const MAX_DELTA = 10_000; // bornes des mouvements/scroll
const MAX_TEXT = 1_000;   // longueur max d'une saisie texte
const MAX_COMBO = 8;      // nombre max de touches dans une combinaison

const MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
const IP_OR_HOST_REGEX = /^(?:(?:\d{1,3}\.){3}\d{1,3}|\[?[a-fA-F0-9:]+\]?|localhost)$/;

export const MEDIA_KEYS = new Set<MediaKey>([
  "volup", "voldown", "mute", "play", "pause", "stop", "next", "prev",
  "up", "down", "left", "right", "ok", "home", "back", "menu",
]);

export const SYSTEM_ACTIONS = new Set<SystemAction>([
  "lock", "sleep", "restart", "shutdown", "wol",
]);

export const VALID_APPS = new Set<string>([
  "chrome", "firefox", "edge", "explorer", "youtube",
  "netflix", "primevideo", "spotify", "steam", "vlc", "notepad",
]);

export const TV_ACTIONS = new Set<string>([
  "volup", "voldown", "set_volume", "mute",
  "play", "pause", "stop", "next", "prev",
  "power", "home", "back", "menu", "ok",
  "up", "down", "left", "right", "app",
]);

export const VALID_KEYS = new Set<string>([
  // Contrôle & Édition
  "Enter", "Escape", "Backspace", "Tab", "Space", "Delete", "Insert",
  // Modificateurs
  "LeftControl", "RightControl", "LeftAlt", "RightAlt",
  "LeftShift", "RightShift", "LeftSuper", "RightSuper",
  // Capture d'écran (Impr. Écran)
  "PrintScreen", "Print", "Snapshot",
  // Alphabet complet A-Z
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
  // Chiffres 0 à 9
  "Num0", "Num1", "Num2", "Num3", "Num4", "Num5", "Num6", "Num7", "Num8", "Num9",
  // Touches de fonction F1 à F12
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
  // Navigation
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "PageUp", "PageDown", "Home", "End",
]);

function sanitizeString(val: unknown, maxLength: number): string | undefined {
  if (!isStr(val)) return undefined;
  const cleaned = val.replace(/[\x00-\x1F\x7F]/g, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, maxLength) : undefined;
}

export function validateCommand(raw: unknown): Command | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
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
      if (!isStr(c.key) || !VALID_KEYS.has(c.key)) return null;
      return { type: "key:tap", key: c.key };

    case "key:combo":
      if (!Array.isArray(c.keys) || c.keys.length === 0 || c.keys.length > MAX_COMBO) return null;
      if (!c.keys.every((k) => isStr(k) && VALID_KEYS.has(k))) return null;
      return { type: "key:combo", keys: [...c.keys] as string[] };

    case "key:text":
      if (!isStr(c.text) || c.text.length > MAX_TEXT) return null;
      return { type: "key:text", text: c.text };

    case "media:key":
      if (!isStr(c.key) || !MEDIA_KEYS.has(c.key as MediaKey)) return null;
      return { type: "media:key", key: c.key as MediaKey };

    case "system:action":
      if (!isStr(c.action) || !SYSTEM_ACTIONS.has(c.action as SystemAction)) return null;
      if (c.action === "wol") {
        if (!isStr(c.mac) || !MAC_REGEX.test(c.mac)) return null;
        return { type: "system:action", action: "wol", mac: c.mac };
      }
      if (c.mac !== undefined && (!isStr(c.mac) || c.mac.length > 32)) return null;
      return { type: "system:action", action: c.action as SystemAction, mac: c.mac as string | undefined };

    case "launch:app":
      if (!isStr(c.target) || !VALID_APPS.has(c.target)) return null;
      return { type: "launch:app", target: c.target };

    case "slide:next":
    case "slide:prev":
    case "slide:start":
    case "slide:end":
    case "slide:black":
      return { type: c.type } as Command;

    case "tv:command": {
      if (!isStr(c.targetIp) || c.targetIp.length === 0 || c.targetIp.length > 64) return null;
      if (!IP_OR_HOST_REGEX.test(c.targetIp)) return null;
      if (!isStr(c.action) || !TV_ACTIONS.has(c.action)) return null;

      let validValue: unknown = undefined;
      if (c.action === "set_volume") {
        if (c.value !== undefined) {
          if (!isNum(c.value) || c.value < 0 || c.value > 100) return null;
          validValue = c.value;
        }
      } else if (c.action === "app") {
        if (!isStr(c.value) || c.value.length === 0 || c.value.length > 64) return null;
        if (!/^[a-zA-Z0-9_\-:]+$/.test(c.value)) return null;
        validValue = c.value;
      } else if (c.value !== undefined) {
        if (typeof c.value !== "string" && typeof c.value !== "number" && typeof c.value !== "boolean") {
          return null;
        }
        if (isStr(c.value) && c.value.length > 64) return null;
        validValue = c.value;
      }

      return {
        type: "tv:command",
        targetIp: c.targetIp,
        action: c.action,
        value: validValue,
      };
    }

    case "client:hello":
      return {
        type: "client:hello",
        name: sanitizeString(c.name, 60),
        device: sanitizeString(c.device, 60),
      };

    default:
      return null;
  }
}

