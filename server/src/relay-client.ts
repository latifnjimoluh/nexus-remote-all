import { WebSocket } from "ws";
import qrcodeTerminal from "qrcode-terminal";
import QRCode from "qrcode";
import { handleCommand } from "./ws/router.js";
import {
  generateKeyB64url,
  keyFromB64url,
  encrypt,
  decrypt,
  isEnvelope,
  validateReplay,
} from "./e2e.js";
import type { ServerMessage } from "../../shared/protocol.js";

const CLOUD_RELAY_URL = process.env.NEXUS_RELAY_URL ?? "wss://remote.unlineservice.com/relay";

export interface CloudSessionInfo {
  connected: boolean;
  code?: string;
  pin?: string;
  url?: string;
  secureUrl?: string;
  qrDataUrl?: string;
  clientConnected?: boolean;
}

let activeCloudSession: CloudSessionInfo = {
  connected: false,
};

let cloudChangeListeners: Array<(info: CloudSessionInfo) => void> = [];

export function getCloudSession(): CloudSessionInfo {
  return activeCloudSession;
}

export function onCloudSessionChange(listener: (info: CloudSessionInfo) => void): () => void {
  cloudChangeListeners.push(listener);
  return () => {
    cloudChangeListeners = cloudChangeListeners.filter((l) => l !== listener);
  };
}

function notifyCloudChange(): void {
  for (const listener of cloudChangeListeners) {
    try {
      listener(activeCloudSession);
    } catch {}
  }
}

/**
 * Connecteur client vers le relais cloud Nexus (remote.unlineservice.com).
 * Permet au PC d'être contrôlé de n'importe où via un code PIN court à 6 chiffres
 * sans configuration de pare-feu ni connaissance de l'IP.
 */
export function startRelayClient(): { stop: () => void; getCloudSession: () => CloudSessionInfo } {
  const url = `${CLOUD_RELAY_URL}?role=agent`;
  console.log(`[Cloud] Liaison automatique au relais : ${CLOUD_RELAY_URL}`);

  let ws: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let sessionKey: Buffer | null = null; // clé E2E (F5) de la session cloud courante
  let lastReceivedSeq = 0; // F6 anti-rejeu
  let serverSeq = 0; // Compteur pour les réponses sortantes

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
        activeCloudSession = { ...activeCloudSession, connected: true };
        notifyCloudChange();
        startHeartbeat(socket);
      });

      socket.on("message", async (raw) => {
        try {
          const data = JSON.parse(raw.toString());

          // 1. Session prête avec code PIN à 6 chiffres
          if (data.type === "relay:ready") {
            const code = String(data.code);
            const formatted = `${code.slice(0, 3)} ${code.slice(3)}`;
            // F5 — clé E2E générée localement, placée dans le FRAGMENT d'URL (#k=)
            // qui n'est jamais transmis au serveur web : le relais ne la voit pas.
            const keyB64url = generateKeyB64url();
            sessionKey = keyFromB64url(keyB64url);
            lastReceivedSeq = 0;
            serverSeq = 0;
            const sep = String(data.url).includes("#") ? "&" : "#";
            const secureUrl = `${data.url}${sep}k=${keyB64url}`;

            QRCode.toDataURL(secureUrl, { margin: 2, scale: 6 })
              .then((qrDataUrl) => {
                activeCloudSession = {
                  connected: true,
                  code,
                  pin: formatted,
                  url: data.url,
                  secureUrl,
                  qrDataUrl,
                  clientConnected: false,
                };
                notifyCloudChange();
              })
              .catch(() => {
                activeCloudSession = {
                  connected: true,
                  code,
                  pin: formatted,
                  url: data.url,
                  secureUrl,
                  clientConnected: false,
                };
                notifyCloudChange();
              });

            console.log("\n" + "═".repeat(60));
            console.log("  🚀 VOTRE PC EST CONTRÔLABLE DEPUIS LE CLOUD (chiffré E2E) !");
            console.log("═".repeat(60));
            console.log(`  🔑 CODE PIN DE CONNEXION  :   \x1b[1;32m${formatted}\x1b[0m`);
            console.log(`  🌐 SITE WEB DU CONTRÔLEUR :   https://remote.unlineservice.com`);
            console.log(`  🔗 LIEN DIRECT SMARTPHONE :   ${secureUrl}`);
            console.log("═".repeat(60));
            console.log("\n📱 Scannez ce QR Code avec votre téléphone (il contient la clé de chiffrement) :");
            try {
              qrcodeTerminal.generate(secureUrl, { small: true });
            } catch {
              // Si la console ne supporte pas le rendu ANSI
            }
            console.log("═".repeat(60) + "\n");
            return;
          }

          if (data.type === "relay:client_joined") {
            console.log("📱 Smartphone connecté avec succès via le Cloud !");
            activeCloudSession = { ...activeCloudSession, clientConnected: true };
            notifyCloudChange();
            lastReceivedSeq = 0;
            serverSeq = 0;
            return;
          }

          if (data.type === "relay:client_left") {
            console.log("📱 Smartphone déconnecté du Cloud.");
            activeCloudSession = { ...activeCloudSession, clientConnected: false };
            notifyCloudChange();
            lastReceivedSeq = 0;
            serverSeq = 0;
            return;
          }

          // 2. Commande CHIFFRÉE E2E (F5/F6) reçue depuis le téléphone via le relais.
          if (!sessionKey) return;
          if (!isEnvelope(data)) {
            console.warn("[Cloud Relay] Enveloppe ignorée: structure invalide ou champs seq/ts manquants.");
            return;
          }

          // 1. Filtrage anti-rejeu strict O(1) AVANT déchiffrement
          const replayCheck = validateReplay(data, lastReceivedSeq);
          if (!replayCheck.valid) {
            console.warn(`[Cloud Relay] Message rejeté par l'anti-rejeu: ${replayCheck.error}`);
            return;
          }

          let cmdType: ServerMessage["cmd"] = undefined;
          try {
            // 2. Déchiffrement et validation du tag GCM + AAD
            const decrypted = decrypt(sessionKey, data);

            // 3. Authentification cryptographique réussie : validation atomique du numéro de séquence
            lastReceivedSeq = data.seq;

            const parsed = JSON.parse(decrypted) as { type?: ServerMessage["cmd"] };
            cmdType = parsed.type;
            await handleCommand(parsed);
            if (socket.readyState === WebSocket.OPEN) {
              const ack = encrypt(
                sessionKey,
                JSON.stringify({ type: "ack", cmd: cmdType } satisfies ServerMessage),
                ++serverSeq,
                Date.now(),
              );
              socket.send(JSON.stringify(ack));
            }
          } catch (err) {
            console.warn("[Cloud Relay] Erreur lors du déchiffrement ou traitement:", err);
            if (socket.readyState === WebSocket.OPEN && sessionKey) {
              const env = encrypt(
                sessionKey,
                JSON.stringify({ type: "error", cmd: cmdType, payload: String(err) } satisfies ServerMessage),
                ++serverSeq,
                Date.now(),
              );
              socket.send(JSON.stringify(env));
            }
          }
        } catch {
          // Ignorer messages non-JSON
        }
      });

      socket.on("close", () => {
        activeCloudSession = { ...activeCloudSession, connected: false, clientConnected: false };
        notifyCloudChange();
        stopHeartbeat();
        scheduleReconnect();
      });

      socket.on("error", (err) => {
        console.warn("[Cloud Relay] Alerte réseau :", err.message);
        activeCloudSession = { ...activeCloudSession, connected: false, clientConnected: false };
        notifyCloudChange();
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

  return {
    stop: () => {
      stopHeartbeat();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        try {
          ws.removeAllListeners();
          ws.terminate();
        } catch {}
        ws = null;
      }
      activeCloudSession = { connected: false };
      notifyCloudChange();
    },
    getCloudSession,
  };
}
