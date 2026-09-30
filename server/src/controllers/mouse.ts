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

/** Déplacement RELATIF du curseur (le cœur du trackpad). */
export async function moveRelative(dx: number, dy: number): Promise<void> {
  const p = await mouse.getPosition();
  await mouse.setPosition(new Point(Math.round(p.x + dx), Math.round(p.y + dy)));
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
