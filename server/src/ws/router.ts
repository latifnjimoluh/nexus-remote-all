import * as Mouse from "../controllers/mouse.js";
import * as Kbd from "../controllers/keyboard.js";
import * as Media from "../controllers/media.js";
import * as Sys from "../controllers/system.js";
import * as Tv from "../controllers/tv.js";
import { launch } from "../controllers/launcher.js";
import { validateCommand } from "../validate.js";

/**
 * Valide (F3) puis aiguille chaque commande reçue vers le contrôleur adéquat.
 * `raw` est la charge JSON brute et non fiable ; la validation rejette toute
 * commande malformée avant exécution. Le `switch` exhaustif garantit (via
 * TypeScript) qu'aucun type de commande n'est oublié.
 */
export async function handleCommand(raw: unknown): Promise<void> {
  const cmd = validateCommand(raw);
  if (!cmd) throw new Error("Commande invalide ou malformée");

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

    // --- Contrôle TV Direct ou Relais ---
    case "tv:command":
      return Tv.sendTvCommand(cmd.targetIp, cmd.action, cmd.value).then(() => {});

    // --- Identification / Handshake ---
    case "client:hello":
      return Promise.resolve();

    default: {
      // Sécurité de typage : si un cas manque, TypeScript le signale ici.
      const _exhaustive: never = cmd;
      void _exhaustive;
    }
  }
}
