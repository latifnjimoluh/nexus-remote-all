import { Router, type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import os from "node:os";
import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { CONFIG } from "../config.js";
import { getLocalIp } from "../net.js";
import { getClientDist } from "../state.js";
import { getDiscoveredDevices, runNetworkScan } from "../discovery/scanner.js";
import { sendTvCommand } from "../controllers/tv.js";
import { requireAuth } from "./middleware.js";

export const pairingRouter = Router();

// ============================================================================
// Feature 4: Cryptographically secure PIN lifecycle & TTL
// ============================================================================

/** Durée de validité maximale d'un code PIN (5 minutes). */
export const PIN_TTL_MS = 5 * 60 * 1000;

let activePin = generateRandomPin();
let pinCreatedAt = Date.now();

/**
 * Génère un code PIN à 6 chiffres aléatoires cryptographiquement sécurisé (100000 - 999999).
 * Utilise CSPRNG node:crypto (randomInt) au lieu de Math.random().
 */
export function generateRandomPin(): string {
  return randomInt(100000, 1000000).toString();
}

export function formatPin(pin: string): string {
  return `${pin.slice(0, 3)} ${pin.slice(3)}`;
}

/** Indique si le code PIN actif actuel a expiré. */
export function isPinExpired(now: number = Date.now()): boolean {
  return now - pinCreatedAt >= PIN_TTL_MS;
}

/**
 * Récupère le code PIN actif. S'il a expiré, il est automatiquement renouvelé.
 */
export function getActivePin(now: number = Date.now()): string {
  if (isPinExpired(now)) {
    refreshActivePin();
  }
  return activePin;
}

/**
 * Force le renouvellement immédiat du code PIN et réinitialise son horodatage.
 */
export function refreshActivePin(): string {
  activePin = generateRandomPin();
  pinCreatedAt = Date.now();
  return activePin;
}

// ============================================================================
// Feature 5: Per-IP Rate Limiting sur la vérification PIN
// ============================================================================

export interface IpRateLimitRecord {
  attempts: number;
  lockoutUntil: number;
  lastAttemptAt: number;
}

export const MAX_PIN_FAILED_ATTEMPTS = 5;
export const PIN_LOCKOUT_MS = 60_000; // 60 secondes
export const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60_000; // 1 minute
export const STALE_RECORD_TTL_MS = 5 * 60 * 1000; // 5 minutes

const ipRateLimits = new Map<string, IpRateLimitRecord>();

/**
 * Extrait l'adresse IP cliente brute depuis la socket TCP sans se fier aux
 * en-têtes X-Forwarded-For non fiables sur le réseau local.
 */
export function extractClientIp(req: Request): string {
  const raw = req.socket.remoteAddress ?? "127.0.0.1";
  return raw.replace(/^::ffff:/, "").toLowerCase();
}

export function getIpRateLimit(clientIp: string): IpRateLimitRecord {
  let record = ipRateLimits.get(clientIp);
  if (!record) {
    record = { attempts: 0, lockoutUntil: 0, lastAttemptAt: Date.now() };
    ipRateLimits.set(clientIp, record);
  }
  return record;
}

export function resetIpAttempts(clientIp: string): void {
  ipRateLimits.delete(clientIp);
}

export function cleanupIpRateLimits(now: number = Date.now()): void {
  for (const [ip, record] of ipRateLimits.entries()) {
    const isLockoutExpired = now >= record.lockoutUntil;
    const isStale = now - record.lastAttemptAt >= STALE_RECORD_TTL_MS;
    if (isLockoutExpired && (record.attempts === 0 || isStale)) {
      ipRateLimits.delete(ip);
    }
  }
}

export function clearAllRateLimits(): void {
  ipRateLimits.clear();
}

const cleanupTimer = setInterval(() => {
  cleanupIpRateLimits();
}, RATE_LIMIT_CLEANUP_INTERVAL_MS);

if (typeof cleanupTimer.unref === "function") {
  cleanupTimer.unref();
}

// ============================================================================
// Feature 2: Restriction stricte à la boucle locale (Loopback-Only)
// ============================================================================

/**
 * Vérifie si une adresse IP correspond strictement à l'interface de bouclage locale.
 */
export function isLoopbackAddress(ip?: string | null): boolean {
  if (!ip) return false;
  const normalized = ip.trim().toLowerCase();
  if (normalized === "::1" || normalized === "127.0.0.1" || normalized === "::ffff:127.0.0.1") {
    return true;
  }
  const stripped = normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
  return stripped === "127.0.0.1" || stripped.startsWith("127.");
}

export const requireHostOnly = (req: Request, res: Response, next: NextFunction): void => {
  const remoteIp = req.socket.remoteAddress;

  if (isLoopbackAddress(remoteIp)) {
    next();
    return;
  }

  res.status(403).json({
    ok: false,
    error: "Appairage direct accessible uniquement depuis le PC hôte (loopback).",
  });
};

export interface PairingInfo {
  token: string;
  pin: string; // ex: "582 914"
  url: string;
  qrDataUrl: string;
}

export function isClientBuilt(): boolean {
  return getClientDist() !== null;
}

/**
 * Génère un jeton JWT avec identifiant unique de client (sub) et de jeton (jti).
 * Garantit l'isolation cryptographique stricte entre terminaux mobiles distincts.
 */
export function generateClientToken(ip: string, clientId: string = randomUUID()): string {
  return jwt.sign(
    {
      role: "remote",
      host: ip,
      sub: clientId,
      jti: clientId,
    },
    CONFIG.JWT_SECRET,
    {
      expiresIn: CONFIG.TOKEN_TTL,
    },
  );
}

/** Génère un token JWT signé et l'URL complète d'appairage. */
export async function createPairingInfo(ip: string): Promise<PairingInfo> {
  const currentPin = getActivePin();
  const token = generateClientToken(ip);

  const port = isClientBuilt() ? CONFIG.HTTP_PORT : CONFIG.CLIENT_PORT;
  const pin = formatPin(currentPin);
  const url = `http://${ip}:${port}/?host=${ip}&ws=${CONFIG.WS_PORT}&token=${token}&pin=${currentPin}`;
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 2, scale: 6 });

  return { token, pin, url, qrDataUrl };
}

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
  const clientIp = extractClientIp(req);
  const now = Date.now();
  const record = getIpRateLimit(clientIp);

  if (now < record.lockoutUntil) {
    const remaining = Math.ceil((record.lockoutUntil - now) / 1000);
    res.status(429).json({
      ok: false,
      error: `Trop de tentatives depuis cette adresse IP. Veuillez patienter ${remaining}s avant de réessayer.`,
    });
    return;
  }

  if (record.lockoutUntil > 0 && now >= record.lockoutUntil) {
    record.attempts = 0;
    record.lockoutUntil = 0;
  }

  const rawPin = req.body?.pin;
  if (!rawPin || typeof rawPin !== "string") {
    res.status(400).json({ ok: false, error: "Code PIN manquant." });
    return;
  }

  if (isPinExpired(now)) {
    refreshActivePin();
    res.status(401).json({
      ok: false,
      error: "Code PIN expiré. Un nouveau code à 6 chiffres a été généré sur l'écran du PC.",
    });
    return;
  }

  const cleanInput = rawPin.replace(/\D/g, "");
  const cleanActive = getActivePin().replace(/\D/g, "");

  const isMatch =
    cleanInput.length === 6 &&
    cleanActive.length === 6 &&
    timingSafeEqual(Buffer.from(cleanInput, "utf-8"), Buffer.from(cleanActive, "utf-8"));

  if (isMatch) {
    resetIpAttempts(clientIp);
    const ip = getLocalIp();
    const token = generateClientToken(ip);
    refreshActivePin();
    res.json({
      ok: true,
      token,
      host: ip,
      wsPort: CONFIG.WS_PORT,
      hostname: os.hostname(),
    });
    return;
  }

  record.attempts++;
  record.lastAttemptAt = now;

  if (record.attempts >= MAX_PIN_FAILED_ATTEMPTS) {
    record.lockoutUntil = now + PIN_LOCKOUT_MS;
    res.status(429).json({
      ok: false,
      error: "5 tentatives incorrectes. Appairage bloqué pour votre adresse IP pendant 60 secondes.",
    });
    return;
  }

  res.status(401).json({
    ok: false,
    error: "Code PIN incorrect. Vérifiez les 6 chiffres affichés sur votre écran de PC.",
    attemptsLeft: MAX_PIN_FAILED_ATTEMPTS - record.attempts,
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
 * Relais de commandes vers les Smart TVs du réseau local (protégé par authentification Bearer JWT).
 */
pairingRouter.post("/tv/command", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { targetIp, action, value } = req.body ?? {};
  if (!targetIp || typeof targetIp !== "string" || !action || typeof action !== "string") {
    res.status(400).json({ ok: false, error: "Paramètres targetIp et action requis." });
    return;
  }

  if (targetIp.length > 64 || action.length > 32) {
    res.status(400).json({ ok: false, error: "Paramètres hors limites autorisées." });
    return;
  }

  try {
    const result = await sendTvCommand(targetIp, action, value);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});


