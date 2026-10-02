import { Router, type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import os from "node:os";
import { CONFIG } from "../config.js";
import { getLocalIp, localAddresses } from "../net.js";
import { getClientDist } from "../state.js";
import { getDiscoveredDevices, runNetworkScan } from "../discovery/scanner.js";
import { sendTvCommand } from "../controllers/tv.js";

export const pairingRouter = Router();

// Gestion du code PIN d'appairage style Bluetooth
let activePin = generateRandomPin();
let failedAttempts = 0;
let lockoutUntil = 0;

function generateRandomPin(): string {
  // Code à 6 chiffres aléatoires (100000 - 999999)
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function formatPin(pin: string): string {
  return `${pin.slice(0, 3)} ${pin.slice(3)}`;
}

export function getActivePin(): string {
  return activePin;
}

export function refreshActivePin(): string {
  activePin = generateRandomPin();
  failedAttempts = 0;
  lockoutUntil = 0;
  return activePin;
}

export interface PairingInfo {
  token: string;
  pin: string; // ex: "582 914"
  url: string;
  qrDataUrl: string;
}

export function isClientBuilt(): boolean {
  return getClientDist() !== null;
}

/** Génère un token JWT signé et l'URL complète d'appairage. */
export async function createPairingInfo(ip: string): Promise<PairingInfo> {
  const token = jwt.sign({ role: "remote", host: ip }, CONFIG.JWT_SECRET, {
    expiresIn: CONFIG.TOKEN_TTL,
  });

  const port = isClientBuilt() ? CONFIG.HTTP_PORT : CONFIG.CLIENT_PORT;
  const pin = formatPin(activePin);
  const url = `http://${ip}:${port}/?host=${ip}&ws=${CONFIG.WS_PORT}&token=${token}&pin=${activePin}`;
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 2, scale: 6 });

  return { token, pin, url, qrDataUrl };
}

// F1 — L'accès direct au QR et jeton brut est autorisé pour le PC hôte et les appareils du réseau local privé (LAN)
const requireHostOnly = (req: Request, res: Response, next: NextFunction): void => {
  const ra = (req.socket.remoteAddress ?? "").replace("::ffff:", "").toLowerCase();
  const localSet = localAddresses();

  // Autorise localhost, ::1 et toutes les IP réseau de l'hôte
  if (ra === "127.0.0.1" || ra === "::1" || localSet.has(ra)) {
    next();
    return;
  }

  // Autorise également les appareils du réseau local privé (LAN : 192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  const isPrivateLan =
    ra.startsWith("192.168.") ||
    ra.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ra);

  if (isPrivateLan) {
    next();
    return;
  }

  res.status(403).json({ error: "Appairage direct accessible uniquement depuis le PC hôte ou le réseau local." });
};

// Endpoint API : données d'appairage complètes (QR + PIN)
pairingRouter.get("/qr", requireHostOnly, async (req, res) => {
  try {
    const info = await createPairingInfo(getLocalIp());
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Endpoint HTML : page visuelle avec QR Code et PIN pour affichage sur l'écran du PC
pairingRouter.get("/display", requireHostOnly, async (req, res) => {
  try {
    const info = await createPairingInfo(getLocalIp());
    res.send(`
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Appairage — Nexus Remote All</title>
        <style>
          body { background: #0a0a0f; color: #fff; font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; box-sizing: border-box; }
          .card { background: #15151f; padding: 2rem; border-radius: 1.5rem; text-align: center; max-width: 420px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid #1e1e2b; }
          img { border-radius: 1rem; margin: 1rem 0; width: 200px; height: 200px; background: white; padding: 8px; }
          .pin-box { background: #10101b; border: 1px solid #2a2a40; border-radius: 1rem; padding: 1rem; margin: 1rem 0; }
          .pin-label { font-size: 0.75rem; font-weight: 700; color: #8a8a9a; letter-spacing: 1px; }
          .pin-code { font-family: monospace; font-size: 2rem; font-weight: 900; color: #6d5efc; letter-spacing: 6px; margin: 0.25rem 0; }
          .code { font-family: monospace; background: #1e1e2b; padding: 0.6rem 1rem; border-radius: 0.5rem; word-break: break-all; font-size: 0.8rem; color: #6d5efc; margin-top: 0.5rem; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2 style="margin: 0;">🌐 Nexus Remote All</h2>
          <p style="color: #8a8a9a; font-size: 0.85rem; margin-top: 0.5rem;">Scannez ce QR Code avec l'appareil photo du smartphone :</p>
          <img src="${info.qrDataUrl}" alt="QR Code d'appairage" />
          
          <div class="pin-box">
            <div class="pin-label">CODE D'APPAIRAGE BLUETOOTH / LAN</div>
            <div class="pin-code">${info.pin}</div>
            <div style="font-size: 0.75rem; color: #8a8a9a;">À saisir sur le smartphone s'il détecte ce PC sur le réseau</div>
          </div>

          <p style="color: #8a8a9a; font-size: 0.8rem; margin: 0;">Ou ouvrez ce lien directement :</p>
          <div class="code"><a href="${info.url}" style="color: #6d5efc; text-decoration: none;">${info.url}</a></div>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(String(err));
  }
});

/**
 * Endpoint d'appairage par code PIN style Bluetooth (accessible sur le LAN).
 * Permet au smartphone de s'associer simplement en tapant le code PIN affiché sur le PC.
 */
pairingRouter.post("/verify-pin", (req: Request, res: Response): void => {
  const now = Date.now();
  if (now < lockoutUntil) {
    const remaining = Math.ceil((lockoutUntil - now) / 1000);
    res.status(429).json({
      ok: false,
      error: `Trop de tentatives. Veuillez patienter ${remaining}s avant de réessayer.`,
    });
    return;
  }

  const rawPin = req.body?.pin;
  if (!rawPin || typeof rawPin !== "string") {
    res.status(400).json({ ok: false, error: "Code PIN manquant." });
    return;
  }

  const cleanInput = rawPin.replace(/\D/g, "");
  const cleanActive = activePin.replace(/\D/g, "");

  if (cleanInput.length === 6 && cleanInput === cleanActive) {
    failedAttempts = 0;
    const ip = getLocalIp();
    const token = jwt.sign({ role: "remote", host: ip }, CONFIG.JWT_SECRET, {
      expiresIn: CONFIG.TOKEN_TTL,
    });
    res.json({
      ok: true,
      token,
      host: ip,
      wsPort: CONFIG.WS_PORT,
      hostname: os.hostname(),
    });
    return;
  }

  failedAttempts++;
  if (failedAttempts >= 5) {
    lockoutUntil = Date.now() + 60_000;
    res.status(429).json({
      ok: false,
      error: "5 tentatives incorrectes. Appairage bloqué pendant 60 secondes.",
    });
    return;
  }

  res.status(401).json({
    ok: false,
    error: "Code PIN incorrect. Vérifiez les 6 chiffres affichés sur votre écran de PC.",
    attemptsLeft: 5 - failedAttempts,
  });
});

/**
 * Endpoint de découverte réseau : renvoie la liste en temps réel des PC Nexus
 * et des Smart TVs (Hisense VIDAA, LG WebOS, Roku, DLNA) détectés sur le LAN.
 */
pairingRouter.get("/network-devices", async (req: Request, res: Response): Promise<void> => {
  const refresh = req.query.refresh === "1" || req.query.refresh === "true";
  if (refresh) {
    await runNetworkScan();
  }
  const devices = await getDiscoveredDevices(refresh);
  res.json({ ok: true, devices });
});

/**
 * Relais de commandes vers les Smart TVs du réseau local (évite les restrictions CORS des navigateurs).
 */
pairingRouter.post("/tv/command", async (req: Request, res: Response): Promise<void> => {
  const { targetIp, action, value } = req.body ?? {};
  if (!targetIp || typeof targetIp !== "string" || !action || typeof action !== "string") {
    res.status(400).json({ ok: false, error: "Paramètres targetIp et action requis." });
    return;
  }
  try {
    const result = await sendTvCommand(targetIp, action, value);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

