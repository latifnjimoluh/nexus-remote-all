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

/** Défilement. dy>0 = vers le bas, dx>0 = vers la droite. */
export async function scroll(dx: number, dy: number): Promise<void> {
  if (dy) dy > 0 ? await mouse.scrollDown(dy) : await mouse.scrollUp(-dy);
  if (dx) dx > 0 ? await mouse.scrollRight(dx) : await mouse.scrollLeft(-dx);
}

export async function dragStart(): Promise<void> {
  await mouse.pressButton(Button.LEFT);
}

export async function dragEnd(): Promise<void> {
  await mouse.releaseButton(Button.LEFT);
}
