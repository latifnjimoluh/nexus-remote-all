import { playClick } from "./audio";

const HAPTICS_KEY = "nexus.haptics_enabled";

/** Vérifie si les vibrations sont activées (défaut: activé). */
export function isHapticsEnabled(): boolean {
  const saved = localStorage.getItem(HAPTICS_KEY);
  return saved === null ? true : saved === "true";
}

/** Active ou désactive les vibrations et sauvegarde la préférence. */
export function setHapticsEnabled(enabled: boolean): void {
  localStorage.setItem(HAPTICS_KEY, enabled ? "true" : "false");
}

/** Bascule l'état des vibrations et renvoie le nouvel état. */
export function toggleHaptics(): boolean {
  const next = !isHapticsEnabled();
  setHapticsEnabled(next);
  return next;
}

/** Retour haptique (vibration) au toucher, supporte une durée ou un pattern. */
export function buzz(pattern: number | number[] = 12): void {
  if (!isHapticsEnabled()) return;
  if ("vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Ignorer si non supporté ou bloqué
    }
  }
}

/**
 * Déclenche le feedback complet (vibration haptique + micro-clic mécanique sonore).
 * Centralise l'effet sensoriel de chaque bouton ou geste de la télécommande.
 */
export function tapFeedback(hapticDuration = 12, soundPitch = 1200): void {
  buzz(hapticDuration);
  playClick(soundPitch);
}
