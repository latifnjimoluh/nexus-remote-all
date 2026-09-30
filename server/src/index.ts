import { startAgent } from "./agent.js";

// Protection contre les interruptions intempestives
process.on("uncaughtException", (err) => {
  console.error("[Serveur] Exception non interceptée :", err?.message ?? err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[Serveur] Rejet de promesse non géré :", reason);
});

// Point d'entrée CLI : démarre l'agent avec auto-détection du bundle PWA.
startAgent().catch((err) => {
  console.error("[Serveur] Échec du démarrage de l'agent :", err);
  process.exit(1);
});
