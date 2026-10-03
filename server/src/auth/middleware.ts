import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { CONFIG } from "../config.js";

const revokedTokens = new Set<string>();

/**
 * Révoque un jeton ou un identifiant client (jti / sub).
 * Extrait automatiquement jti et sub si une chaîne de jeton JWT est fournie.
 */
export function revokeToken(tokenOrId?: string | null): void {
  if (tokenOrId) {
    revokedTokens.add(tokenOrId);

    // Si tokenOrId est un JWT, révoquer également ses revendications d'identité jti et sub
    try {
      const decoded = jwt.decode(tokenOrId) as { jti?: string; sub?: string } | null;
      if (decoded?.jti) revokedTokens.add(decoded.jti);
      if (decoded?.sub) revokedTokens.add(decoded.sub);
    } catch {}

    if (revokedTokens.size > 1000) {
      const first = revokedTokens.values().next().value;
      if (first) revokedTokens.delete(first);
    }
  }
}

/** Vérifie si un jeton ou son identifiant de session est révoqué. */
export function isTokenRevoked(tokenOrId?: string | null): boolean {
  if (!tokenOrId) return false;
  if (revokedTokens.has(tokenOrId)) return true;

  try {
    const decoded = jwt.decode(tokenOrId) as { jti?: string; sub?: string } | null;
    if (decoded?.jti && revokedTokens.has(decoded.jti)) return true;
    if (decoded?.sub && revokedTokens.has(decoded.sub)) return true;
  } catch {}

  return false;
}

/**
 * Valide un jeton d'authentification pour la connexion WebSocket ou les routes HTTP.
 * - En production, les tokens statiques sont strictement rejetés (aucun bypass).
 * - En développement hors production, CONFIG.TOKEN n'est accepté que s'il est configuré.
 * - Les jetons JWT doivent être valides, non révoqués, conformes à l'algorithme HS256,
 *   et contenir la revendication role: "remote".
 */
export function verifyToken(token?: string | null): boolean {
  if (!token || typeof token !== "string") return false;
  if (isTokenRevoked(token)) return false;

  // Repli token statique de dev : STRICTEMENT interdit en production
  if (!CONFIG.IS_PRODUCTION && CONFIG.TOKEN && token === CONFIG.TOKEN) {
    return true;
  }

  try {
    const decoded = jwt.verify(token, CONFIG.JWT_SECRET, {
      algorithms: ["HS256"],
    });

    if (typeof decoded !== "object" || decoded === null) {
      return false;
    }

    const payload = decoded as { role?: unknown; sub?: unknown; jti?: unknown };
    if (payload.jti && isTokenRevoked(String(payload.jti))) return false;
    if (payload.sub && isTokenRevoked(String(payload.sub))) return false;

    return payload.role === "remote";
  } catch {
    return false;
  }
}

/**
 * F3 — Middleware Express exigeant un jeton d'authentification JWT Bearer valide.
 * Rejette toute requête non authentifiée avec HTTP 401 Unauthorized.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  let token: string | null = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (typeof req.query.token === "string") {
    token = req.query.token;
  }

  if (!token || !verifyToken(token)) {
    res.status(401).json({
      ok: false,
      error: "Non autorisé : jeton d'authentification manquant ou invalide.",
    });
    return;
  }

  next();
}

