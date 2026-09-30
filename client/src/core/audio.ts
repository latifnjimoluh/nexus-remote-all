/**
 * Module Audio Web Audio API pour retour sonore haptique mécanique.
 * Synthétise un micro-clic ultra-court (< 6ms), doux et discret,
 * simulant la sensation tactile d'une touche physique de télécommande.
 */

let audioCtx: AudioContext | null = null;
const STORAGE_KEY = "nexus.sound_enabled";

/** Vérifie si le son est activé dans le localStorage (par défaut: activé). */
export function isSoundEnabled(): boolean {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === null ? true : saved === "true";
}

/** Active ou désactive le retour sonore et sauvegarde la préférence. */
export function setSoundEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
}

/** Bascule l'état du son et renvoie le nouvel état. */
export function toggleSound(): boolean {
  const next = !isSoundEnabled();
  setSoundEnabled(next);
  return next;
}

/** Obtient ou réveille l'AudioContext sur geste utilisateur. */
function getAudioContext(): AudioContext | null {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Joue un micro-clic mécanique feutré et non intrusif.
 * @param pitch Fréquence de base en Hz (défaut ~1200Hz pour un clic vif et doux).
 * @param volume Volume relatif (0.01 à 1.0, défaut 0.15 pour rester très subtil).
 */
export function playClick(pitch = 1200, volume = 0.12): void {
  if (!isSoundEnabled()) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    // Filtre passe-bande pour adoucir le rendu métallique
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(pitch, now);
    filter.Q.setValueAtTime(3.0, now);

    // Fréquence descendante ultra-rapide (effet percussif du clic)
    osc.type = "triangle";
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.006);

    // Enveloppe d'amplitude percutante puis coupure abrupte (< 6ms)
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.006);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.008);
  } catch {
    // Échec silencieux si le contexte est verrouillé
  }
}

/** Clic alternatif plus grave pour les validations ou touches fortes */
export function playConfirmationSound(): void {
  playClick(1600, 0.18);
  setTimeout(() => playClick(2200, 0.15), 35);
}
