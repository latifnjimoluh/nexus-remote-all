import { createServer } from "node:http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT ?? 4720);

interface Session {
  code: string;
  agentWs: WebSocket;
  clientWs: WebSocket | null;
  createdAt: number;
}

const sessions = new Map<string, Session>();
// Index inverse pour nettoyage rapide à la déconnexion
const wsToSession = new Map<WebSocket, { code: string; role: "agent" | "client" }>();

/** Génère un code PIN à 6 chiffres unique non encore attribué. */
function generateUniqueCode(): string {
  let code = "";
  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (sessions.has(code));
  return code;
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "Nexus Cloud Relay", activeSessions: sessions.size });
});

app.get("/status", (_req, res) => {
  res.json({
    sessionsCount: sessions.size,
    sessions: Array.from(sessions.entries()).map(([code, s]) => ({
      code,
      hasClient: Boolean(s.clientWs),
      uptimeSeconds: Math.round((Date.now() - s.createdAt) / 1000),
    })),
  });
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

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

wss.on("connection", (ws: WebSocket, req) => {
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

  // 1. Enregistrement d'un Agent (PC hôte à contrôler)
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

  // 2. Connexion d'un Client (Smartphone / Télécommande)
  if (role === "client") {
    if (!codeParam || !sessions.has(codeParam)) {
      console.warn(`[RELAY] Client refusé — Code invalide ou expiré : "${codeParam}"`);
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

// Nettoyage régulier des sessions orphelines (> 24h)
setInterval(() => {
  const now = Date.now();
  for (const [code, s] of sessions.entries()) {
    if (now - s.createdAt > 24 * 3600 * 1000) {
      s.agentWs.close(4008, "session_expired");
      if (s.clientWs) s.clientWs.close(4008, "session_expired");
      sessions.delete(code);
    }
  }
}, 60000);

server.listen(PORT, () => {
  console.log(`🚀 Nexus Cloud Relay en écoute sur http://0.0.0.0:${PORT}`);
  console.log(`📡 WebSocket endpoint disponible sur /relay`);
});
