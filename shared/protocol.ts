/**
 * Contrat de protocole partagé entre le serveur agent et la PWA cliente.
 * PIÈCE MAÎTRESSE : tout message échangé sur le WebSocket suit ces types.
 * Fichier importé des deux côtés (server/ et client/) — source unique de vérité.
 */

/** Commande envoyée par le client (PWA) vers le serveur agent. */
export type Command =
  // --- Souris / Trackpad ---
  | { type: "mouse:move"; dx: number; dy: number }
  | { type: "mouse:click"; button: MouseButton }
  | { type: "mouse:scroll"; dx: number; dy: number }
  | { type: "mouse:drag"; state: "start" | "end" }
  // --- Clavier ---
  | { type: "key:tap"; key: string }
  | { type: "key:combo"; keys: string[] } // ex: ["LeftControl", "C"]
  | { type: "key:text"; text: string } // saisie directe / presse-papier
  // --- Média & TV ---
  | { type: "media:key"; key: MediaKey }
  // --- Système ---
  | { type: "system:action"; action: SystemAction; mac?: string } // mac requis pour "wol"
  // --- Lanceur / Macro Deck ---
  | { type: "launch:app"; target: string }
  // --- Présentation ---
  | { type: "slide:next" }
  | { type: "slide:prev" }
  | { type: "slide:start" }
  | { type: "slide:end" }
  | { type: "slide:black" };

export type MouseButton = "left" | "right" | "middle";

export type MediaKey =
  | "volup"
  | "voldown"
  | "mute"
  | "play"
  | "pause"
  | "stop"
  | "next"
  | "prev"
  | "up"
  | "down"
  | "left"
  | "right"
  | "ok"
  | "home"
  | "back"
  | "menu";

export type SystemAction = "lock" | "sleep" | "restart" | "shutdown" | "wol";

/** Réponse du serveur vers le client. */
export interface ServerMessage {
  type: "ack" | "error" | "state";
  /** Type de la commande acquittée (si applicable). */
  cmd?: Command["type"];
  /** Message d'erreur ou données d'état. */
  payload?: unknown;
}
