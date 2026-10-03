import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Enveloppe chiffrée E2E renforcée pour le transport via relais Cloud (F5/F6).
 */
export interface Envelope {
  /** Nonce/IV aléatoire AES-GCM (12 octets) encodé en base64. */
  n: string;
  /** Concaténation ciphertext + auth tag AES-GCM (16 octets) encodée en base64. */
  d: string;
  /** Numéro de séquence strictement croissant (commence à 1). */
  seq: number;
  /** Horodatage Epoch UTC de création en millisecondes. */
  ts: number;
}

/** Fenêtre de tolérance maximale pour la dérive d'horloge (anti-rejeu) : 60 secondes. */
export const MAX_DRIFT_MS = 60_000;

export interface ReplayValidationResult {
  valid: boolean;
  error?: string;
}

/** Génère une clé AES-256 (32 octets) encodée base64url pour le fragment d'URL. */
export function generateKeyB64url(): string {
  return randomBytes(32).toString("base64url");
}

export function keyFromB64url(k: string): Buffer {
  return Buffer.from(k, "base64url");
}

/**
 * Chiffre un texte en clair en AES-256-GCM et lie cryptographiquement seq et ts via AAD.
 */
export function encrypt(key: Buffer, plaintext: string, seq = 0, ts = Date.now()): Envelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (seq !== undefined && ts !== undefined) {
    cipher.setAAD(Buffer.from(`${seq}:${ts}`, "utf8"));
  }
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    n: iv.toString("base64"),
    d: Buffer.concat([ct, tag]).toString("base64"),
    seq,
    ts,
  };
}

/**
 * Déchiffre une enveloppe chiffrée en vérifiant l'étiquette d'authentification GCM et l'AAD.
 * Lève une exception si l'IV est invalide, si la charge est trop courte (< 16 octets)
 * ou si les données ont été altérées.
 */
export function decrypt(key: Buffer, env: Envelope): string {
  const iv = Buffer.from(env.n, "base64");
  if (iv.length !== 12) {
    throw new Error("Longueur d'IV invalide: 12 octets requis pour AES-256-GCM");
  }
  const buf = Buffer.from(env.d, "base64");
  if (buf.length < 16) {
    throw new Error("Ciphertext corrompu: taille inférieure aux 16 octets du tag GCM");
  }
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(0, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  if (typeof env.seq === "number" && typeof env.ts === "number") {
    decipher.setAAD(Buffer.from(`${env.seq}:${env.ts}`, "utf8"));
  }
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * Type guard validant la structure physique d'une enveloppe E2EE renforcée.
 */
export function isEnvelope(obj: unknown): obj is Envelope {
  if (typeof obj !== "object" || obj === null) return false;
  const env = obj as Record<string, unknown>;
  return (
    typeof env.n === "string" &&
    env.n.length > 0 &&
    typeof env.d === "string" &&
    env.d.length > 0 &&
    typeof env.seq === "number" &&
    Number.isInteger(env.seq) &&
    env.seq > 0 &&
    typeof env.ts === "number" &&
    Number.isFinite(env.ts)
  );
}

/**
 * Valide les critères anti-rejeu (monotonicité du seq et fenêtre temporelle du ts).
 */
export function validateReplay(
  env: Envelope,
  lastReceivedSeq: number,
  maxDriftMs: number = MAX_DRIFT_MS,
  now: number = Date.now(),
): ReplayValidationResult {
  if (typeof env.seq !== "number" || !Number.isInteger(env.seq) || env.seq <= 0) {
    return { valid: false, error: `Numéro de séquence invalide: ${env.seq}` };
  }
  if (typeof env.ts !== "number" || !Number.isFinite(env.ts)) {
    return { valid: false, error: `Horodatage invalide: ${env.ts}` };
  }
  const drift = Math.abs(now - env.ts);
  if (drift > maxDriftMs) {
    return {
      valid: false,
      error: `Dérive d'horloge excessive ou message expiré (dérive: ${drift}ms, max toléré: ${maxDriftMs}ms)`,
    };
  }
  if (env.seq <= lastReceivedSeq) {
    return {
      valid: false,
      error: `Attaque par rejeu détectée: seq ${env.seq} <= dernier seq validé ${lastReceivedSeq}`,
    };
  }
  return { valid: true };
}

