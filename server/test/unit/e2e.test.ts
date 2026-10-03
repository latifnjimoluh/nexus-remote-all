import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyB64url,
  keyFromB64url,
  encrypt,
  decrypt,
  isEnvelope,
  validateReplay,
} from "../../src/e2e.js";

describe("e2e — Cloud Relay AES-256-GCM Cryptographic Tunnel", () => {
  it("generateKeyB64url — generates 32-byte high-entropy base64url keys", () => {
    const k1 = generateKeyB64url();
    const k2 = generateKeyB64url();
    assert.notEqual(k1, k2);
    const buf = keyFromB64url(k1);
    assert.equal(buf.length, 32);
  });

  it("encrypt & decrypt — achieves lossless roundtrip with UTF-8 strings and JSON", () => {
    const key = keyFromB64url(generateKeyB64url());
    const payload = JSON.stringify({ type: "mouse:move", dx: 50, dy: -20, unicode: "Nexus 🚀 Clé" });
    const envelope = encrypt(key, payload, 1, 1000);
    const decrypted = decrypt(key, envelope);
    assert.equal(decrypted, payload);
  });

  it("encrypt — generates unique IVs and ciphertexts for identical plaintexts", () => {
    const key = keyFromB64url(generateKeyB64url());
    const text = "constant plaintext";
    const env1 = encrypt(key, text, 1, 1000);
    const env2 = encrypt(key, text, 1, 1000);
    assert.notEqual(env1.n, env2.n);
    assert.notEqual(env1.d, env2.d);
  });

  it("AAD cryptographic binding — tampering seq causes decryption failure", () => {
    const key = keyFromB64url(generateKeyB64url());
    const envelope = encrypt(key, "sensitive command", 10, 5000);
    // Tamper seq without updating ciphertext
    envelope.seq = 11;
    assert.throws(() => decrypt(key, envelope), /Unsupported state or unable to authenticate data|bad auth tag/i);
  });

  it("AAD cryptographic binding — tampering ts causes decryption failure", () => {
    const key = keyFromB64url(generateKeyB64url());
    const envelope = encrypt(key, "sensitive command", 5, 5000);
    // Tamper ts without updating ciphertext
    envelope.ts = 6000;
    assert.throws(() => decrypt(key, envelope), /Unsupported state or unable to authenticate data|bad auth tag/i);
  });

  it("decrypt — tampering ciphertext or auth tag causes decryption failure", () => {
    const key = keyFromB64url(generateKeyB64url());
    const envelope = encrypt(key, "command", 1, 1000);
    const buf = Buffer.from(envelope.d, "base64");
    buf[0] ^= 0xff; // flip bits in ciphertext
    envelope.d = buf.toString("base64");
    assert.throws(() => decrypt(key, envelope), /Unsupported state or unable to authenticate data|bad auth tag/i);
  });

  it("decrypt — rejects corrupted IVs and truncated payloads", () => {
    const key = keyFromB64url(generateKeyB64url());
    const envelope = encrypt(key, "command", 1, 1000);
    // 11-byte IV instead of 12
    envelope.n = Buffer.alloc(11).toString("base64");
    assert.throws(() => decrypt(key, envelope), /Longueur d'IV invalide: 12 octets requis/);

    // Payload < 16 bytes (smaller than tag)
    envelope.n = Buffer.alloc(12).toString("base64");
    envelope.d = Buffer.alloc(10).toString("base64");
    assert.throws(() => decrypt(key, envelope), /Ciphertext corrompu: taille inférieure aux 16 octets/);
  });

  it("isEnvelope — validates structural shape and rejects malformed objects", () => {
    assert.equal(isEnvelope({ n: "YWJj", d: "ZGVm", seq: 1, ts: 12345 }), true);
    assert.equal(isEnvelope(null), false);
    assert.equal(isEnvelope({}), false);
    assert.equal(isEnvelope({ n: "a", d: "b", seq: 0, ts: 10 }), false);
    assert.equal(isEnvelope({ n: "a", d: "b", seq: 1.5, ts: 10 }), false);
    assert.equal(isEnvelope({ n: "a", d: "b", seq: 1, ts: NaN }), false);
  });

  it("validateReplay — enforces monotonic sequence counters", () => {
    const now = 100_000;
    const base = { n: "a", d: "b", ts: now };
    // Valid: seq > lastReceivedSeq
    assert.equal(validateReplay({ ...base, seq: 11 }, 10, 60_000, now).valid, true);
    // Duplicate seq rejected
    const dupRes = validateReplay({ ...base, seq: 10 }, 10, 60_000, now);
    assert.equal(dupRes.valid, false);
    assert.match(dupRes.error ?? "", /Attaque par rejeu détectée/);
    // Older seq rejected
    const oldRes = validateReplay({ ...base, seq: 9 }, 10, 60_000, now);
    assert.equal(oldRes.valid, false);
    assert.match(oldRes.error ?? "", /Attaque par rejeu détectée/);
  });

  it("validateReplay — enforces 60-second timestamp drift window", () => {
    const now = 200_000;
    const env = (ts: number) => ({ n: "a", d: "b", seq: 5, ts });
    // Exact match
    assert.equal(validateReplay(env(now), 4, 60_000, now).valid, true);
    // Past boundary valid (exactly 60s ago)
    assert.equal(validateReplay(env(now - 60_000), 4, 60_000, now).valid, true);
    // Past boundary invalid (60.001s ago)
    const pastErr = validateReplay(env(now - 60_001), 4, 60_000, now);
    assert.equal(pastErr.valid, false);
    assert.match(pastErr.error ?? "", /Dérive d'horloge excessive/);
    // Future boundary valid (exactly 60s ahead)
    assert.equal(validateReplay(env(now + 60_000), 4, 60_000, now).valid, true);
    // Future boundary invalid (60.001s ahead)
    const futureErr = validateReplay(env(now + 60_001), 4, 60_000, now);
    assert.equal(futureErr.valid, false);
    assert.match(futureErr.error ?? "", /Dérive d'horloge excessive/);
  });
});
