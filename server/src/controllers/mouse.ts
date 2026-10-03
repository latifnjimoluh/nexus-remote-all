import { mouse, Point, Button } from "@nut-tree-fork/nut-js";
import type { MouseButton } from "../../../shared/protocol.js";
import { CONFIG } from "../config.js";

// Réactivité maximale : pas de délai automatique entre les actions.
mouse.config.mouseSpeed = CONFIG.MOUSE_SPEED;
mouse.config.autoDelayMs = 0;

const BUTTONS: Record<MouseButton, Button> = {
  left: Button.LEFT,
  right: Button.RIGHT,
  middle: Button.MIDDLE,
};


/**
 * File d'attente d'exécution sérialisée (Promise chain) éliminant la race condition
 * "Lost Update" sur les appels concurrents à getPosition() et setPosition().
 */
let moveQueue: Promise<void> = Promise.resolve();

/**
 * Déplacement RELATIF du curseur (le cœur du trackpad).
 * Exécute chaque mouvement de manière strictement séquentielle via une file FIFO.
 */
export function moveRelative(dx: number, dy: number): Promise<void> {
  const roundedDx = Math.round(dx);
  const roundedDy = Math.round(dy);

  // Optimisation : ignorer les deltas nuls sans appel système
  if (roundedDx === 0 && roundedDy === 0) {
    return Promise.resolve();
  }

  const task = async () => {
    const p = await mouse.getPosition();
    await mouse.setPosition(new Point(p.x + roundedDx, p.y + roundedDy));
  };

  // Enchaînement : s'exécute séquentiellement même si la tâche précédente a échoué
  const next = moveQueue.then(task, task);
  // Auto-réparation de la file pour éviter la propagation d'erreurs orphelines
  moveQueue = next.catch(() => {});
  return next;
}

/** Utilitaire de test : attend que tous les mouvements en attente soient vidés. */
export function waitForMoveQueue(): Promise<void> {
  return moveQueue;
}

/** Utilitaire de test : réinitialise la chaîne de promesses. */
export function resetMoveQueue(): void {
  moveQueue = Promise.resolve();
}

export async function click(button: MouseButton): Promise<void> {
  await mouse.click(BUTTONS[button]);
}

/**
 * Défilement molette souris.
 * dy > 0 = vers le bas, dy < 0 = vers le haut
 * dx > 0 = vers la droite, dx < 0 = vers la gauche
 */
export async function scroll(dx: number, dy: number): Promise<void> {
  // Limiter l'amplitude par événement pour éviter tout gel du thread d'injection
  const safeDy = Math.min(Math.max(Math.round(dy), -20), 20);
  const safeDx = Math.min(Math.max(Math.round(dx), -20), 20);

  if (safeDy) {
    if (safeDy > 0) {
      await mouse.scrollDown(safeDy);
    } else {
      await mouse.scrollUp(-safeDy);
    }
  }

  if (safeDx) {
    if (safeDx > 0) {
      await mouse.scrollRight(safeDx);
    } else {
      await mouse.scrollLeft(-safeDx);
    }
  }
}

export async function dragStart(): Promise<void> {
  await mouse.pressButton(Button.LEFT);
}

export async function dragEnd(): Promise<void> {
  await mouse.releaseButton(Button.LEFT);
}
