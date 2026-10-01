import { createServer, type IncomingMessage } from "node:http";
import { randomInt } from "node:crypto";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT ?? 4720);

// Anti-brute-force : fenêtre glissante par IP sur les codes invalides.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_FAILS = 10;
const failCounts = new Map<string, { fails: number; resetAt: number }>();

interface Session {
  code: string;
  agentWs: WebSocket;
  clientWs: WebSocket | null;
  createdAt: number;
}

const sessions = new Map<string, Session>();
// Index inverse pour nettoyage rapide à la déconnexion
const wsToSession = new Map<WebSocket, { code: string; role: "agent" | "client" }>();

/** Génère un code PIN à 6 chiffres cryptographiquement sûr (crypto.randomInt) et unique. */
function generateUniqueCode(): string {
  let code = "";
  do {
    code = randomInt(100000, 1000000).toString();
  } while (sessions.has(code));
  return code;
}

/**
 * IP du client pour le rate-limiting (derrière le reverse-proxy nginx).
 * nginx (`proxy_add_x_forwarded_for`) AJOUTE l'IP réelle en FIN de la liste
 * X-Forwarded-For. On prend donc la DERNIÈRE entrée : un client malveillant
 * peut injecter de fausses IP en tête, mais pas après celle ajoutée par nginx.
 * Prendre la première (`[0]`) laisserait contourner le rate-limit (énumération
 * des codes PIN) via des en-têtes XFF forgés.
 */
function clientIp(req: IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** Renvoie (et initialise/réinitialise) l'état de rate-limiting d'une IP. */
function rateState(ip: string): { fails: number; resetAt: number } {
  const now = Date.now();
  let e = failCounts.get(ip);
  if (!e || now > e.resetAt) {
    e = { fails: 0, resetAt: now + RATE_WINDOW_MS };
    failCounts.set(ip, e);
  }
  return e;
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "Nexus Cloud Relay", activeSessions: sessions.size });
});

// /status : agrégats uniquement — ne divulgue JAMAIS les codes PIN.
app.get("/status", (_req, res) => {
  let paired = 0;
  for (const s of sessions.values()) if (s.clientWs) paired++;
  res.json({ sessionsCount: sessions.size, pairedCount: paired });
});

const server = createServer(app);
// maxPayload : défense anti-flood sur le relais public (les enveloppes chiffrées
// relayées font quelques Ko ; on plafonne pour éviter l'épuisement mémoire).
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "", "http://x");
  if (url.pathname === "/relay" || url.pathname === "/relay/") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  (ws as any).isAlive = true;
  ws.on("pong", () => {
    (ws as any).isAlive = true;
  });
  ws.on("error", (err) => {
    console.warn("[RELAY] Erreur socket :", err.message);
  });

  const url = new URL(req.url ?? "", "http://x");
  const role = url.searchParams.get("role");
  const codeParam = url.searchParams.get("code")?.replace(/\D/g, ""); // normalise chiffres

  // ── 1. Enregistrement d'un Agent (PC hôte à contrôler) ──
  if (role === "agent") {
    const code = generateUniqueCode();
    const session: Session = {
      code,
      agentWs: ws,
      clientWs: null,
      createdAt: Date.now(),
    };

    sessions.set(code, session);
    wsToSession.set(ws, { code, role: "agent" });

    console.log(`[RELAY] Nouvel agent enregistré — Code : ${code}`);

    ws.send(
      JSON.stringify({
        type: "relay:ready",
        code,
        url: `https://remote.unlineservice.com/?code=${code}`,
      }),
    );

    ws.on("message", (data) => {
      // Relayer vers le client smartphone si connecté
      const s = sessions.get(code);
      if (s?.clientWs && s.clientWs.readyState === WebSocket.OPEN) {
        s.clientWs.send(data.toString());
      }
    });

    ws.on("close", () => {
      console.log(`[RELAY] Agent déconnecté — Fin de session ${code}`);
      const s = sessions.get(code);
      if (s?.clientWs && s.clientWs.readyState === WebSocket.OPEN) {
        s.clientWs.send(
          JSON.stringify({
            type: "relay:agent_disconnected",
            message: "L'ordinateur hôte s'est déconnecté.",
          }),
        );
        s.clientWs.close(4002, "agent_left");
      }
      sessions.delete(code);
      wsToSession.delete(ws);
    });
    return;
  }

  // ── 2. Connexion d'un Client (Smartphone / Télécommande) ──
  if (role === "client") {
    const ip = clientIp(req);
    const rl = rateState(ip);

    // Rate-limiting : casse l'énumération des codes PIN (brute-force).
    if (rl.fails >= RATE_MAX_FAILS) {
      ws.send(
        JSON.stringify({
          type: "relay:error",
          message: "Trop de tentatives. Patientez une minute avant de réessayer.",
        }),
      );
      ws.close(4029, "rate_limited");
      return;
    }

    if (!codeParam || !sessions.has(codeParam)) {
      rl.fails++;
      console.warn(`[RELAY] Client refusé — code invalide "${codeParam}" (ip ${ip}, essais ${rl.fails})`);
      ws.send(
        JSON.stringify({
          type: "relay:error",
          message: "Code d'accès introuvable. Assurez-vous que l'application est lancée sur votre PC.",
        }),
      );
      ws.close(4004, "invalid_code");
      return;
    }

    const session = sessions.get(codeParam)!;

    // Session à client unique : refuse un 2e appareil (empêche le vol de session en cours).
    if (session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "relay:error",
          message: "Cette session est déjà utilisée par un autre appareil.",
        }),
      );
      ws.close(4009, "already_paired");
      return;
    }

    session.clientWs = ws;
    wsToSession.set(ws, { code: codeParam, role: "client" });

    console.log(`[RELAY] Client smartphone appairé avec l'agent [${codeParam}] ✔`);

    ws.send(JSON.stringify({ type: "relay:connected", code: codeParam }));
    session.agentWs.send(JSON.stringify({ type: "relay:client_joined" }));

    ws.on("message", (data) => {
      // Relayer directement la commande vers le PC hôte
      if (session.agentWs.readyState === WebSocket.OPEN) {
        session.agentWs.send(data.toString());
      }
    });

    ws.on("close", () => {
      console.log(`[RELAY] Client smartphone déconnecté [${codeParam}]`);
      if (sessions.has(codeParam)) {
        session.clientWs = null;
        if (session.agentWs.readyState === WebSocket.OPEN) {
          session.agentWs.send(JSON.stringify({ type: "relay:client_left" }));
        }
      }
      wsToSession.delete(ws);
    });
    return;
  }

  // Rôle inconnu
  ws.close(4000, "invalid_role");
});

// Heartbeat sweep toutes les 30s pour purger les connexions interrompues brutalement
setInterval(() => {
  wss.clients.forEach((ws) => {
    if ((ws as any).isAlive === false) {
      return ws.terminate();
    }
    (ws as any).isAlive = false;
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  });
}, 30000);

// Nettoyage régulier : sessions orphelines (>24h) + compteurs de rate-limiting expirés.
setInterval(() => {
  const now = Date.now();
  for (const [code, s] of sessions.entries()) {
    if (now - s.createdAt > 24 * 3600 * 1000) {
      s.agentWs.close(4008, "session_expired");
      if (s.clientWs) s.clientWs.close(4008, "session_expired");
      sessions.delete(code);
    }
  }
  for (const [ip, e] of failCounts.entries()) {
    if (now > e.resetAt) failCounts.delete(ip);
  }
}, 60000);

server.listen(PORT, () => {
  console.log(`🚀 Nexus Cloud Relay en écoute sur http://0.0.0.0:${PORT}`);
  console.log(`📡 WebSocket endpoint disponible sur /relay`);
});
