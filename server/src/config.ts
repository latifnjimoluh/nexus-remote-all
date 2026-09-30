import { randomBytes } from "node:crypto";

/**
 * Configuration centrale du serveur agent.
 */
export const CONFIG = {
  /** Port du serveur HTTP (santé, appairage). */
  HTTP_PORT: Number(process.env.NEXUS_HTTP_PORT ?? 4700),

  /** Port du serveur WebSocket (commandes temps réel). */
  WS_PORT: Number(process.env.NEXUS_WS_PORT ?? 4701),

  /** Port du client Vite en dev. */
  CLIENT_PORT: Number(process.env.NEXUS_CLIENT_PORT ?? 5173),

  /** Secret JWT pour signature des tokens d'appairage. */
  JWT_SECRET: process.env.NEXUS_JWT_SECRET ?? randomBytes(32).toString("hex"),

  /** Durée de validité du token. */
  TOKEN_TTL: "24h",

  /** Token statique de repli en dev. */
  TOKEN: process.env.NEXUS_TOKEN ?? randomBytes(8).toString("hex"),

  /** Vitesse du curseur nut.js (px/s). */
  MOUSE_SPEED: Number(process.env.NEXUS_MOUSE_SPEED ?? 3000),

  /** Nom du service pour découverte réseau mDNS. */
  SERVICE_NAME: "Nexus Remote All",
} as const;
