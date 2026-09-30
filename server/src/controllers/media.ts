import { keyboard, Key } from "@nut-tree-fork/nut-js";
import type { MediaKey } from "../../../shared/protocol.js";

/**
 * Correspondance des touches Média / TV.
 * Les touches multimédia (Audio*) peuvent ne pas exister sur tous les claviers
 * virtuels nut.js ; les entrées inconnues sont ignorées sans erreur.
 */
const MEDIA: Partial<Record<MediaKey, Key>> = {
  volup: Key.AudioVolUp,
  voldown: Key.AudioVolDown,
  mute: Key.AudioMute,
  play: Key.AudioPlay,
  pause: Key.AudioPause,
  stop: Key.AudioStop,
  next: Key.AudioNext,
  prev: Key.AudioPrev,
  // D-Pad → flèches
  up: Key.Up,
  down: Key.Down,
  left: Key.Left,
  right: Key.Right,
  ok: Key.Enter,
  // Navigation TV
  home: Key.Home,
  back: Key.Escape,
  menu: Key.Menu,
};

export async function mediaKey(k: MediaKey): Promise<void> {
  const key = MEDIA[k];
  if (key === undefined) return;
  await keyboard.pressKey(key);
  await keyboard.releaseKey(key);
}
