import type { Command } from "../../../shared/protocol.js";
import * as Mouse from "../controllers/mouse.js";
import * as Kbd from "../controllers/keyboard.js";
import * as Media from "../controllers/media.js";
import * as Sys from "../controllers/system.js";
import { launch } from "../controllers/launcher.js";

/**
 * Aiguille chaque commande reçue vers le contrôleur adéquat.
 * Le `switch` exhaustif garantit (via TypeScript) qu'aucun type n'est oublié.
 */
export async function handleCommand(cmd: Command): Promise<void> {
  switch (cmd.type) {
    // --- Souris ---
    case "mouse:move":
      return Mouse.moveRelative(cmd.dx, cmd.dy);
    case "mouse:click":
      return Mouse.click(cmd.button);
    case "mouse:scroll":
      return Mouse.scroll(cmd.dx, cmd.dy);
    case "mouse:drag":
      return cmd.state === "start" ? Mouse.dragStart() : Mouse.dragEnd();

    // --- Clavier ---
    case "key:tap":
      return Kbd.tap(cmd.key);
    case "key:combo":
      return Kbd.combo(cmd.keys);
    case "key:text":
      return Kbd.typeText(cmd.text);

    // --- Média / TV ---
    case "media:key":
      return Media.mediaKey(cmd.key);

    // --- Système ---
    case "system:action":
      return Sys.runSystem(cmd.action, cmd.mac);

    // --- Lanceur ---
    case "launch:app":
      return launch(cmd.target);

    // --- Présentation ---
    case "slide:next":
      return Kbd.tap("ArrowRight");
    case "slide:prev":
      return Kbd.tap("ArrowLeft");
    case "slide:start":
      return Kbd.tap("F5");
    case "slide:end":
      return Kbd.tap("Escape");
    case "slide:black":
      return Kbd.tap("B");

    default: {
      // Sécurité de typage : si un cas manque, TypeScript le signale ici.
      const _exhaustive: never = cmd;
      void _exhaustive;
    }
  }
}
