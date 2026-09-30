/**
 * Chiffrement de bout en bout (F5) côté client — Web Crypto API (AES-256-GCM).
 * Interopérable avec le module Node de l'agent (`server/src/e2e.ts`).
 * La clé est transmise via le fragment d'URL (#k=...) scanné depuis le QR :
 * le fragment n'est jamais envoyé au serveur web, donc le relais ne le voit pas.
 */
export interface Envelope {
  n: string; // IV (nonce) base64
  d: string; // ciphertext || tag, base64
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

export async function encrypt(key: CryptoKey, plaintext: string): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctTag = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)),
  );
  return { n: bytesToB64(iv), d: bytesToB64(ctTag) };
}

export async function decrypt(key: CryptoKey, env: Envelope): Promise<string> {
  const iv = b64ToBytes(env.n);
  const ctTag = b64ToBytes(env.d);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ctTag);
  return new TextDecoder().decode(pt);
}
