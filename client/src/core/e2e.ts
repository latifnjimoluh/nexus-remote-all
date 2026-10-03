/**
 * Chiffrement de bout en bout (F5/F6) côté client — Web Crypto API (AES-256-GCM).
 * Interopérable avec le module Node de l'agent (`server/src/e2e.ts`).
 * L'enveloppe transporte le nonce, le ciphertext, le numéro de séquence et le timestamp.
 * La chaîne `${seq}:${ts}` est liée cryptographiquement via l'AAD d'AES-GCM.
 */
export interface Envelope {
  n: string; // IV (nonce) base64
  d: string; // ciphertext || tag base64
  seq: number; // Numéro de séquence strictement croissant (commence à 1)
  ts: number;  // Horodatage Epoch en millisecondes
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64urlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
  return b64ToBytes(padded);
}

export async function importKey(keyB64url: string): Promise<CryptoKey> {
  const raw = b64urlToBytes(keyB64url);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encrypt(
  key: CryptoKey,
  plaintext: string,
  seq = 1,
  ts = Date.now(),
): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const subtleParams: AesGcmParams = {
    name: "AES-GCM",
    iv,
    ...(seq !== undefined && ts !== undefined
      ? { additionalData: new TextEncoder().encode(`${seq}:${ts}`) }
      : {}),
  };
  const ctTag = new Uint8Array(
    await crypto.subtle.encrypt(subtleParams, key, new TextEncoder().encode(plaintext)),
  );
  return { n: bytesToB64(iv), d: bytesToB64(ctTag), seq, ts };
}

export async function decrypt(key: CryptoKey, env: Envelope): Promise<string> {
  const iv = b64ToBytes(env.n);
  const ctTag = b64ToBytes(env.d);
  const subtleParams: AesGcmParams = {
    name: "AES-GCM",
    iv,
    ...(typeof env.seq === "number" && typeof env.ts === "number"
      ? { additionalData: new TextEncoder().encode(`${env.seq}:${env.ts}`) }
      : {}),
  };
  const pt = await crypto.subtle.decrypt(subtleParams, key, ctTag);
  return new TextDecoder().decode(pt);
}

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
    typeof env.ts === "number" &&
    Number.isFinite(env.ts)
  );
}

