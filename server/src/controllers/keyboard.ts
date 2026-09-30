import { keyboard, Key } from "@nut-tree-fork/nut-js";

keyboard.config.autoDelayMs = 0;

/**
 * Table de correspondance nom logique → touche nut.js.
 * Les noms côté client restent stables même si l'API nut.js évolue.
 */
const KEYMAP: Record<string, Key> = {
  // Contrôle
  Enter: Key.Enter,
  Escape: Key.Escape,
  Backspace: Key.Backspace,
  Tab: Key.Tab,
  Space: Key.Space,
  Delete: Key.Delete,
  // Modificateurs
  LeftControl: Key.LeftControl,
  LeftAlt: Key.LeftAlt,
  LeftShift: Key.LeftShift,
  LeftSuper: Key.LeftSuper, // touche Windows / Super
  // Lettres usuelles (macros)
  C: Key.C,
  V: Key.V,
  X: Key.X,
  Z: Key.Z,
  A: Key.A,
  // Fonctions
  F5: Key.F5,
  F11: Key.F11,
  B: Key.B,
  // Navigation
  ArrowUp: Key.Up,
  ArrowDown: Key.Down,
  ArrowLeft: Key.Left,
  ArrowRight: Key.Right,
  PageUp: Key.PageUp,
  PageDown: Key.PageDown,
  Home: Key.Home,
  End: Key.End,
};

/** Appui + relâchement d'une touche simple. */
export async function tap(name: string): Promise<void> {
  const k = KEYMAP[name];
  if (k === undefined) return;
  await keyboard.pressKey(k);
  await keyboard.releaseKey(k);
}

/** Combinaison de touches (ex: Ctrl+C). Appui dans l'ordre, relâchement inverse. */
export async function combo(names: string[]): Promise<void> {
  const keys = names.map((n) => KEYMAP[n]).filter((k): k is Key => k !== undefined);
  for (const k of keys) await keyboard.pressKey(k);
  for (const k of [...keys].reverse()) await keyboard.releaseKey(k);
}

/** Saisie de texte / presse-papier (utilise le layout natif). */
export async function typeText(text: string): Promise<void> {
  await keyboard.type(text);
}
