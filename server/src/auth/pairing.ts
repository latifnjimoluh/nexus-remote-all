import { Router } from "express";
import { join } from "node:path";
import { existsSync } from "node:fs";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import { CONFIG } from "../config.js";

export const pairingRouter = Router();

export interface PairingInfo {
  token: string;
  url: string;
  qrDataUrl: string;
}

export function isClientBuilt(): boolean {
  return (
    existsSync(join(process.cwd(), "../client/dist")) ||
    existsSync(join(process.cwd(), "client/dist"))
  );
}

/** Génère un token JWT signé et l'URL complète d'appairage. */
export async function createPairingInfo(ip: string): Promise<PairingInfo> {
  const token = jwt.sign({ role: "remote", host: ip }, CONFIG.JWT_SECRET, {
    expiresIn: CONFIG.TOKEN_TTL,
  });

  const port = isClientBuilt() ? CONFIG.HTTP_PORT : CONFIG.CLIENT_PORT;
  const url = `http://${ip}:${port}/?host=${ip}&ws=${CONFIG.WS_PORT}&token=${token}`;
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 2, scale: 6 });

  return { token, url, qrDataUrl };
}

// Endpoint API : données d'appairage
pairingRouter.get("/qr", async (req, res) => {
  try {
    const hostHeader = req.headers.host?.split(":")[0] ?? "127.0.0.1";
    const info = await createPairingInfo(hostHeader);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Endpoint HTML : page visuelle avec QR Code pour affichage sur l'écran du PC
pairingRouter.get("/display", async (req, res) => {
  try {
    const hostHeader = req.headers.host?.split(":")[0] ?? "127.0.0.1";
    const info = await createPairingInfo(hostHeader);
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
          img { border-radius: 1rem; margin: 1.5rem 0; width: 220px; height: 220px; background: white; padding: 8px; }
          .code { font-family: monospace; background: #1e1e2b; padding: 0.6rem 1rem; border-radius: 0.5rem; word-break: break-all; font-size: 0.8rem; color: #6d5efc; margin-top: 0.5rem; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2 style="margin: 0;">📱 Nexus Remote All</h2>
          <p style="color: #8a8a9a; font-size: 0.9rem; margin-top: 0.5rem;">Scannez ce QR Code avec l'appareil photo de votre smartphone :</p>
          <img src="${info.qrDataUrl}" alt="QR Code d'appairage" />
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
