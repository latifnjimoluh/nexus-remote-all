import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Chiffrement de bout en bout (F5) côté agent — AES-256-GCM.
 * Interopérable avec la Web Crypto API du client : l'enveloppe transporte
 * l'IV (`n`) et la concaténation ciphertext||tag (`d`), comme le produit/attend
 * `crypto.subtle` (AES-GCM colle le tag de 16 octets à la fin du ciphertext).
 * Le relais cloud ne voit que ces enveloppes opaques : il ne peut ni lire ni
 * forger de commandes.
 */
export interface Envelope {
  n: string; // IV (nonce) en base64
  d: string; // ciphertext || tag, en base64
}

/** Génère une clé AES-256 (32 octets) encodée base64url pour le fragment d'URL. */
export function generateKeyB64url(): string {
  return randomBytes(32).toString("base64url");
}

export function keyFromB64url(k: string): Buffer {
  return Buffer.from(k, "base64url");
}

export function encrypt(key: Buffer, plaintext: string): Envelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { n: iv.toString("base64"), d: Buffer.concat([ct, tag]).toString("base64") };
}

export function decrypt(key: Buffer, env: Envelope): string {
  const iv = Buffer.from(env.n, "base64");
  const buf = Buffer.from(env.d, "base64");
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(0, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function isEnvelope(obj: unknown): obj is Envelope {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof (obj as { n?: unknown }).n === "string" &&
    typeof (obj as { d?: unknown }).d === "string"
  );
}
