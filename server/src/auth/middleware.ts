import jwt from "jsonwebtoken";
import { CONFIG } from "../config.js";

/**
 * Valide un jeton d'authentification pour la connexion WebSocket.
 * Accepte les JWT signés ou le token statique de développement.
 */
export function verifyToken(token: string | null): boolean {
  if (!token) return false;

  // Repli token statique de dev
  if (token === CONFIG.TOKEN) return true;

  try {
    jwt.verify(token, CONFIG.JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}
