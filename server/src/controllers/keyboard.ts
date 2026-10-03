import { keyboard, Key } from "@nut-tree-fork/nut-js";

keyboard.config.autoDelayMs = 0;

/**
 * Table de correspondance nom logique → touche nut.js.
 * Supporte l'alphabet complet (A-Z), les modificateurs, les touches de fonction et la capture d'écran.
 */
const KEYMAP: Record<string, Key> = {
  // Contrôle & Édition
  Enter: Key.Enter,
  Escape: Key.Escape,
  Backspace: Key.Backspace,
  Tab: Key.Tab,
  Space: Key.Space,
  Delete: Key.Delete,
  Insert: Key.Insert,

  // Modificateurs
  LeftControl: Key.LeftControl,
  RightControl: Key.RightControl,
  LeftAlt: Key.LeftAlt,
  RightAlt: Key.RightAlt,
  LeftShift: Key.LeftShift,
  RightShift: Key.RightShift,
  LeftSuper: Key.LeftSuper, // touche Windows / Super gauche
  RightSuper: Key.RightSuper,

  // Touches de Capture d'écran (Impr. Écran)
  PrintScreen: Key.Print,
  Print: Key.Print,
  Snapshot: Key.Print,

  // Alphabet complet A-Z (permet tous les raccourcis comme Win+Shift+S, Ctrl+C, etc.)
  A: Key.A,
  B: Key.B,
  C: Key.C,
  D: Key.D,
  E: Key.E,
  F: Key.F,
  G: Key.G,
  H: Key.H,
  I: Key.I,
  J: Key.J,
  K: Key.K,
  L: Key.L,
  M: Key.M,
  N: Key.N,
  O: Key.O,
  P: Key.P,
  Q: Key.Q,
  R: Key.R,
  S: Key.S,
  T: Key.T,
  U: Key.U,
  V: Key.V,
  W: Key.W,
  X: Key.X,
  Y: Key.Y,
  Z: Key.Z,

  // Chiffres 0 à 9
  Num0: Key.Num0,
  Num1: Key.Num1,
  Num2: Key.Num2,
  Num3: Key.Num3,
  Num4: Key.Num4,
  Num5: Key.Num5,
  Num6: Key.Num6,
  Num7: Key.Num7,
  Num8: Key.Num8,
  Num9: Key.Num9,

  // Touches de fonction F1 à F12
  F1: Key.F1,
  F2: Key.F2,
  F3: Key.F3,
  F4: Key.F4,
  F5: Key.F5,
  F6: Key.F6,
  F7: Key.F7,
  F8: Key.F8,
  F9: Key.F9,
  F10: Key.F10,
  F11: Key.F11,
  F12: Key.F12,

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

Object.freeze(KEYMAP);

/** Vérifie si un serveur d'affichage graphique est disponible (évite les crashs libxdo sous Linux headless). */
function hasDisplay(): boolean {
  if (process.platform === "linux") {
    return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  }
  return true;
}

/** Appui + relâchement d'une touche simple. */
export async function tap(name: string): Promise<void> {
  if (!hasDisplay()) {
    return;
  }
  if (!Object.hasOwn(KEYMAP, name)) {
    console.warn(`[Keyboard] Touche non reconnue : ${name}`);
    return;
  }
  const k = KEYMAP[name];
  if (k === undefined) {
    console.warn(`[Keyboard] Touche non reconnue : ${name}`);
    return;
  }
  try {
    await keyboard.pressKey(k);
    await keyboard.releaseKey(k);
  } catch (err) {
    console.warn(`[Keyboard] Erreur simulation touche :`, err);
  }
}

/** Combinaison de touches (ex: Win+Shift+S, Ctrl+C). Appui dans l'ordre, relâchement inverse. */
export async function combo(names: string[]): Promise<void> {
  if (!hasDisplay()) {
    return;
  }
  const keys = names
    .filter((n) => typeof n === "string" && Object.hasOwn(KEYMAP, n))
    .map((n) => KEYMAP[n])
    .filter((k): k is Key => k !== undefined);
  if (keys.length === 0) return;
  try {
    for (const k of keys) await keyboard.pressKey(k);
    for (const k of [...keys].reverse()) await keyboard.releaseKey(k);
  } catch (err) {
    console.warn(`[Keyboard] Erreur simulation combo :`, err);
  }
}

/** Saisie de texte / presse-papier (utilise le layout natif). */
export async function typeText(text: string): Promise<void> {
  if (!hasDisplay()) {
    return;
  }
  try {
    await keyboard.type(text);
  } catch (err) {
    console.warn(`[Keyboard] Erreur saisie texte :`, err);
  }
}
