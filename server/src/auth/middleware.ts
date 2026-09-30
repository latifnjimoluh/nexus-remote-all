import jwt from "jsonwebtoken";
import { CONFIG } from "../config.js";

const revokedTokens = new Set<string>();

export function revokeToken(token?: string | null): void {
  if (token) {
    revokedTokens.add(token);
    if (revokedTokens.size > 1000) {
      const first = revokedTokens.values().next().value;
      if (first) revokedTokens.delete(first);
    }
  }
}

export function isTokenRevoked(token?: string | null): boolean {
  if (!token) return false;
  return revokedTokens.has(token);
}

/**
 * Valide un jeton d'authentification pour la connexion WebSocket.
 * Accepte les JWT signés ou le token statique de développement.
 */
export function verifyToken(token: string | null): boolean {
  if (!token) return false;
  if (isTokenRevoked(token)) return false;

  // Repli token statique de dev
  if (token === CONFIG.TOKEN) return true;

  try {
    jwt.verify(token, CONFIG.JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}
