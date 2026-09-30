import { WebSocket } from "ws";
import qrcodeTerminal from "qrcode-terminal";
import { handleCommand } from "./ws/router.js";
import type { Command, ServerMessage } from "../../shared/protocol.js";

const CLOUD_RELAY_URL = process.env.NEXUS_RELAY_URL ?? "wss://remote.unlineservice.com/relay";

/**
 * Connecteur client vers le relais cloud Nexus (remote.unlineservice.com).
 * Permet au PC d'être contrôlé de n'importe où via un code PIN court à 6 chiffres
 * sans configuration de pare-feu ni connaissance de l'IP.
 */
export function startRelayClient(): void {
  const url = `${CLOUD_RELAY_URL}?role=agent`;
  console.log(`[Cloud] Liaison automatique au relais : ${CLOUD_RELAY_URL}`);

  let ws: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function startHeartbeat(socket: WebSocket) {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.ping();
        } catch {
          // Socket fermé
        }
      }
    }, 20000); // Heartbeat toutes les 20s pour maintenir le tunnel Cloudflare
  }

  function connect() {
    // Nettoyer l'ancienne instance de socket si existante
    if (ws) {
      try {
        ws.removeAllListeners();
        ws.terminate();
      } catch {}
      ws = null;
    }
    stopHeartbeat();

    try {
      const socket = new WebSocket(url);
      ws = socket;

      socket.on("open", () => {
        console.log("☁️  Liaison Cloud établie avec remote.unlineservice.com ✔");
        startHeartbeat(socket);
      });

      socket.on("message", async (raw) => {
        try {
          const data = JSON.parse(raw.toString());

          // 1. Session prête avec code PIN à 6 chiffres
          if (data.type === "relay:ready") {
            const code = String(data.code);
            const formatted = `${code.slice(0, 3)} ${code.slice(3)}`;
            console.log("\n" + "═".repeat(60));
            console.log("  🚀 VOTRE PC EST CONTRÔLABLE DEPUIS LE CLOUD !");
            console.log("═".repeat(60));
            console.log(`  🔑 CODE PIN DE CONNEXION  :   \x1b[1;32m${formatted}\x1b[0m`);
            console.log(`  🌐 SITE WEB DU CONTRÔLEUR :   https://remote.unlineservice.com`);
            console.log(`  🔗 LIEN DIRECT SMARTPHONE :   ${data.url}`);
            console.log("═".repeat(60));
            console.log("\n📱 Scannez ce QR Code avec votre téléphone pour vous connecter :");
            try {
              qrcodeTerminal.generate(data.url, { small: true });
            } catch {
              // Si la console ne supporte pas le rendu ANSI
            }
            console.log("═".repeat(60) + "\n");
            return;
          }

          if (data.type === "relay:client_joined") {
            console.log("📱 Smartphone connecté avec succès via le Cloud !");
            return;
          }

          if (data.type === "relay:client_left") {
            console.log("📱 Smartphone déconnecté du Cloud.");
            return;
          }

          // 2. Commandes temps réel reçues depuis le téléphone
          const cmd = data as Command;
          try {
            await handleCommand(cmd);
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "ack", cmd: cmd.type } satisfies ServerMessage));
            }
          } catch (err) {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(
                JSON.stringify({
                  type: "error",
                  cmd: cmd.type,
                  payload: String(err),
                } satisfies ServerMessage),
              );
            }
          }
        } catch {
          // Ignorer messages non-JSON
        }
      });

      socket.on("close", () => {
        stopHeartbeat();
        scheduleReconnect();
      });

      socket.on("error", (err) => {
        console.warn("[Cloud Relay] Alerte réseau :", err.message);
        stopHeartbeat();
        scheduleReconnect();
      });
    } catch (e) {
      console.warn("[Cloud Relay] Erreur d'initialisation :", e);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return; // Un seul timer en attente à la fois
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 4000);
  }

  connect();
}
