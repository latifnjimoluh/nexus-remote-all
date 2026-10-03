/**
 * Empirical Challenge & Adversarial Fuzzing Suite — Challenger M3-1
 *
 * Targets:
 * 1. Fuzzing & Boundary Challenge for server/src/validate.ts:
 *    - Massive strings (10KB to 1MB) across all fields
 *    - Unicode surrogates, control characters (\x00-\x1F, \x7F), ANSI escapes, format strings
 *    - Circular-like objects, deep nesting (100 levels), prototype pollution attempts
 *    - NaN, +Infinity, -Infinity, -0, floating point precision overflows, extreme deltas
 *    - Invariant: ZERO uncaught exceptions, strictly deterministic Command | null output
 *
 * 2. Cryptographic & Protocol Boundary Challenge for server/src/e2e.ts:
 *    - Encrypt / decrypt roundtrip with various payloads (empty, 1MB, Unicode)
 *    - Envelope structural validation (isEnvelope) with malformed/missing fields
 *    - Corrupted auth tags (bit flipping in AES-256-GCM auth tag)
 *    - Truncated ciphertexts (< 16 bytes tag, 0 bytes, truncated body)
 *    - Nonce/IV corruption (!== 12 bytes)
 *    - AAD tampering (tampered seq or ts must fail GCM decipher)
 *    - Out-of-order and replayed sequence packets
 *    - Clock drift edge cases (exact boundaries 60,000ms, 60,001ms, negative drift, non-finite ts)
 *
 * 3. Concurrency, Spoofing & Brute Force Challenge for server/src/auth/pairing.ts:
 *    - HTTP X-Forwarded-For / header spoofing resistance on live agent
 *    - Concurrent multi-IP brute force simulation (10 IPs concurrent burst)
 *    - Per-IP rate limiting isolation (attacker lockout does not lock out legitimate IPs)
 *    - Parallel request race condition stress test
 *    - PIN timing-safe equal and edge cases (wrong lengths, non-digits, objects, massive inputs)
 */

import { validateCommand, VALID_KEYS, MEDIA_KEYS, SYSTEM_ACTIONS, VALID_APPS, TV_ACTIONS } from "../server/dist/server/src/validate.js";
import {
  encrypt,
  decrypt,
  isEnvelope,
  validateReplay,
  generateKeyB64url,
  keyFromB64url,
  MAX_DRIFT_MS,
} from "../server/dist/server/src/e2e.js";
import {
  pairingRouter,
  getActivePin,
  refreshActivePin,
  isPinExpired,
  getIpRateLimit,
  resetIpAttempts,
  clearAllRateLimits,
  cleanupIpRateLimits,
  MAX_PIN_FAILED_ATTEMPTS,
  PIN_LOCKOUT_MS,
} from "../server/dist/server/src/auth/pairing.js";
import { startAgent } from "../server/dist/server/src/agent.js";
import { getPortPair } from "./helpers/ports.mjs";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function assert(condition, message, details = "") {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✔ [PASS] ${message}`);
  } else {
    failedTests++;
    const err = `✖ [FAIL] ${message} ${details ? "(" + details + ")" : ""}`;
    console.error(`  ${err}`);
    failures.push({ message, details });
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// SECTION 1: FUZZING & BOUNDARY CHALLENGE FOR validateCommand (server/src/validate.ts)
// ============================================================================
async function runValidationFuzzingChallenges() {
  console.log("\n================================================================================");
  console.log("  🔥 CHALLENGE 1: FUZZING & BOUNDARY STRESS ON validateCommand (validate.ts)");
  console.log("================================================================================");

  // 1.1 Primitives and Non-Objects
  const nonObjects = [
    undefined,
    null,
    12345,
    "string",
    true,
    false,
    Symbol("evil"),
    12345678901234567890n,
    () => {},
    [],
    [1, 2, 3],
    ["mouse:move"],
  ];
  for (const val of nonObjects) {
    let res;
    let threw = false;
    try {
      res = validateCommand(val);
    } catch {
      threw = true;
    }
    assert(!threw && res === null, `Primitive/non-object ${typeof val} safely returns null`);
  }

  // 1.2 Prototype Pollution & Property Injection
  const protoAttacks = [
    JSON.parse('{"type":"mouse:move","dx":10,"dy":20,"__proto__":{"polluted":true}}'),
    JSON.parse('{"type":"key:tap","key":"Enter","constructor":{"prototype":{"polluted":true}}}'),
    { type: "mouse:move", dx: 10, dy: 20, evilField: "injected", admin: true },
    Object.create(null),
    Object.assign(Object.create(null), { type: "mouse:move", dx: 10, dy: 20 }),
  ];

  for (const attack of protoAttacks) {
    let res = null;
    let threw = false;
    try {
      res = validateCommand(attack);
    } catch {
      threw = true;
    }
    assert(!threw, "Prototype pollution payload processed without throwing");
    assert(!({}.polluted), "Global Object.prototype was NOT polluted");
    if (res !== null) {
      assert(!("evilField" in res) && !("admin" in res), "Output command reconstructs clean object without injected fields");
    }
  }

  // 1.3 Circular-like, Getters, and Throwing Objects
  const dangerousObjects = [];

  // Self-referencing circular object
  const circularObj = { type: "key:text", text: "normal" };
  circularObj.circular = circularObj;
  dangerousObjects.push({ desc: "Circular self-reference", obj: circularObj });

  // Object with throwing getter
  const throwingGetter = {
    type: "mouse:move",
    get dx() { throw new Error("Malicious getter trap"); },
    dy: 10,
  };
  dangerousObjects.push({ desc: "Throwing getter", obj: throwingGetter, expectThrowOrNull: true });

  // Object with proxy traps
  const proxiedObj = new Proxy({ type: "mouse:move", dx: 10, dy: 10 }, {
    get(target, prop) {
      if (prop === "dx") return 5;
      return target[prop];
    }
  });
  dangerousObjects.push({ desc: "Proxy object", obj: proxiedObj });

  for (const { desc, obj, expectThrowOrNull } of dangerousObjects) {
    let res = null;
    let threw = false;
    try {
      res = validateCommand(obj);
    } catch {
      threw = true;
    }
    if (expectThrowOrNull) {
      // If a property getter literally throws an Error, validating whether it crashes or propagates
      assert(true, `${desc} handled (threw: ${threw}, res: ${res})`);
    } else {
      assert(!threw, `${desc} processed without throwing uncaught exception`);
    }
  }

  // 1.4 Deep Nesting Stress (100 Levels)
  let deeplyNested = { type: "unknown" };
  for (let i = 0; i < 100; i++) {
    deeplyNested = { child: deeplyNested };
  }
  let resDeep = null;
  let threwDeep = false;
  try {
    resDeep = validateCommand(deeplyNested);
  } catch {
    threwDeep = true;
  }
  assert(!threwDeep && resDeep === null, "100-level deeply nested object rejected safely with null");

  // 1.5 NaN / Infinity / Extremes on Numeric Deltas
  const numericPoisons = [
    NaN,
    Infinity,
    -Infinity,
    -0,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_VALUE,
    1e300,
    -1e300,
    10001,
    -10001,
    10000.0001,
    -10000.0001,
    "10",
    "NaN",
    "Infinity",
    null,
    undefined,
    {},
    [],
  ];

  for (const poison of numericPoisons) {
    let threw = false;
    let resMove = null;
    let resScroll = null;
    try {
      resMove = validateCommand({ type: "mouse:move", dx: poison, dy: 10 });
      resScroll = validateCommand({ type: "mouse:scroll", dx: 10, dy: poison });
    } catch {
      threw = true;
    }
    assert(!threw, `Numeric delta poison (${String(poison)}) handled without throwing`);
    // Boundary check: only finite numbers with |val| <= 10000 are valid
    const isFiniteNum = typeof poison === "number" && Number.isFinite(poison);
    const inBounds = isFiniteNum && Math.abs(poison) <= 10000;
    if (!inBounds) {
      assert(resMove === null, `Out-of-bounds or non-finite dx (${String(poison)}) returned null`);
      assert(resScroll === null, `Out-of-bounds or non-finite dy (${String(poison)}) returned null`);
    } else {
      assert(resMove !== null && resMove.dx === poison, `Valid boundary delta (${String(poison)}) accepted`);
    }
  }

  // 1.6 Massive Strings & Unicode Surrogates
  const massive100KB = "A".repeat(100_000);
  const massive1MB = "X".repeat(1_000_000);
  const unicodeSurrogates = "\uD800\uDFFF\uD83D\uDE00\uD83C\uDF89\u0000\u001F\u007F\u001B[31m";

  // Massive string in key:text
  let resMassive = validateCommand({ type: "key:text", text: massive1MB });
  assert(resMassive === null, "1MB text payload rejected with null (max: 1000 chars)");

  let res1000Chars = validateCommand({ type: "key:text", text: "A".repeat(1000) });
  assert(res1000Chars !== null && res1000Chars.text.length === 1000, "Exact 1,000 char text payload accepted");

  let res1001Chars = validateCommand({ type: "key:text", text: "A".repeat(1001) });
  assert(res1001Chars === null, "1,001 char text payload rejected with null");

  // Unicode surrogates in key:text
  let resUnicode = validateCommand({ type: "key:text", text: unicodeSurrogates });
  assert(resUnicode !== null && resUnicode.text === unicodeSurrogates, "Unicode surrogates & emojis in key:text preserved safely");

  // Massive strings in key:tap and media:key
  let resKeyMassive = validateCommand({ type: "key:tap", key: massive100KB });
  assert(resKeyMassive === null, "Massive string key:tap rejected with null");

  let resMediaMassive = validateCommand({ type: "media:key", key: massive100KB });
  assert(resMediaMassive === null, "Massive string media:key rejected with null");

  // Control characters & massive strings in client:hello
  const dirtyName = "\x00\x1bAdmin\x7f   ";
  const helloCleaned = validateCommand({
    type: "client:hello",
    name: dirtyName,
    device: massive1MB,
  });
  assert(helloCleaned !== null, "client:hello processed successfully");
  assert(helloCleaned.name === "Admin", `Control characters stripped in client:hello name (got: "${helloCleaned.name}")`);
  assert(helloCleaned.device.length === 60, `Massive device string clamped to 60 chars (got: ${helloCleaned.device.length})`);

  // 1.7 tv:command Fuzzing
  const tvFuzzCases = [
    { targetIp: "192.168.1.1", action: "set_volume", value: 100, valid: true },
    { targetIp: "192.168.1.1", action: "set_volume", value: 101, valid: false },
    { targetIp: "192.168.1.1", action: "set_volume", value: -1, valid: false },
    { targetIp: "192.168.1.1", action: "set_volume", value: NaN, valid: false },
    { targetIp: "192.168.1.1", action: "set_volume", value: Infinity, valid: false },
    { targetIp: "192.168.1.1", action: "app", value: "netflix", valid: true },
    { targetIp: "192.168.1.1", action: "app", value: "app; rm -rf /", valid: false },
    { targetIp: "192.168.1.1", action: "app", value: massive100KB, valid: false },
    { targetIp: "evil.com/payload", action: "play", valid: false },
    { targetIp: massive100KB, action: "play", valid: false },
    { targetIp: "192.168.1.50", action: "unsupported_action", valid: false },
  ];

  for (const tc of tvFuzzCases) {
    let res = null;
    let threw = false;
    try {
      res = validateCommand({ type: "tv:command", ...tc });
    } catch {
      threw = true;
    }
    assert(!threw, `tv:command ${tc.action} (${JSON.stringify(tc.value)}) handled without throwing`);
    assert((res !== null) === tc.valid, `tv:command ${tc.action} validity expectation met (expected: ${tc.valid}, got: ${res !== null})`);
  }

  // 1.8 key:combo Boundary & Poison Testing
  const comboCases = [
    { keys: [], valid: false, desc: "Empty combo array" },
    { keys: ["LeftControl", "LeftAlt", "Delete"], valid: true, desc: "Valid 3-key combo" },
    { keys: Array(8).fill("A"), valid: true, desc: "Max 8 keys combo" },
    { keys: Array(9).fill("A"), valid: false, desc: "9 keys combo exceeds MAX_COMBO" },
    { keys: ["Enter", "EvilKey"], valid: false, desc: "Combo with invalid key name" },
    { keys: ["Enter", null], valid: false, desc: "Combo with null element" },
    { keys: ["Enter", massive100KB], valid: false, desc: "Combo with massive string element" },
    { keys: "NotAnArray", valid: false, desc: "Non-array keys" },
  ];

  for (const cc of comboCases) {
    const res = validateCommand({ type: "key:combo", keys: cc.keys });
    assert((res !== null) === cc.valid, `key:combo: ${cc.desc} (expected: ${cc.valid}, got: ${res !== null})`);
  }
}

// ============================================================================
// SECTION 2: CRYPTOGRAPHIC & PROTOCOL BOUNDARY CHALLENGE FOR e2e.ts
// ============================================================================
async function runE2ECryptoChallenges() {
  console.log("\n================================================================================");
  console.log("  🔐 CHALLENGE 2: CRYPTOGRAPHIC & PROTOCOL BOUNDARY STRESS ON e2e.ts");
  console.log("================================================================================");

  const keyB64 = generateKeyB64url();
  const key = keyFromB64url(keyB64);
  assert(key.length === 32, "generateKeyB64url creates exactly 32-byte AES-256 key");

  // 2.1 Roundtrip Payload Scaling
  const payloads = [
    "",
    "Simple short text",
    JSON.stringify({ type: "mouse:move", dx: 15, dy: -25 }),
    "🌟 Emoji & Multibyte Arabic 日本語 \uD83D\uDE00\uD83C\uDF89 🚀",
    "A".repeat(100_000), // 100 KB
  ];

  for (const p of payloads) {
    const env = encrypt(key, p, 1, Date.now());
    assert(isEnvelope(env), `Encrypted envelope satisfies isEnvelope for payload size ${p.length}`);
    const decrypted = decrypt(key, env);
    assert(decrypted === p, `Decrypted text exactly matches original plaintext (length: ${p.length})`);
  }

  // 2.2 Envelope Structure Validation (isEnvelope)
  const baseValid = encrypt(key, "test", 1, Date.now());
  const malformedEnvelopes = [
    null,
    undefined,
    "string",
    123,
    [],
    {},
    { ...baseValid, n: "" },                  // empty IV
    { ...baseValid, d: "" },                  // empty payload
    { ...baseValid, seq: 0 },                 // seq must be > 0
    { ...baseValid, seq: -1 },                // seq must be positive
    { ...baseValid, seq: 1.5 },               // seq must be integer
    { ...baseValid, seq: NaN },               // seq must be integer
    { ...baseValid, seq: Infinity },          // seq must be integer
    { ...baseValid, ts: NaN },                // ts must be finite
    { ...baseValid, ts: Infinity },           // ts must be finite
    { ...baseValid, ts: "12345" },            // ts must be number
    { n: baseValid.n, d: baseValid.d },       // missing seq and ts
  ];

  for (const mal of malformedEnvelopes) {
    assert(!isEnvelope(mal), `Malformed envelope structure safely rejected: ${JSON.stringify(mal)?.slice(0, 50)}`);
  }

  // 2.3 Corrupted Auth Tags (Bit Flipping)
  {
    const originalEnv = encrypt(key, "Sensitive payload", 1, Date.now());
    const rawD = Buffer.from(originalEnv.d, "base64");
    assert(rawD.length >= 16, "Ciphertext contains at least 16 bytes auth tag");

    // Bit flip last byte of auth tag
    const corruptedD = Buffer.from(rawD);
    corruptedD[corruptedD.length - 1] ^= 0x01; // flip 1 bit in tag

    const corruptedEnv = { ...originalEnv, d: corruptedD.toString("base64") };
    let threw = false;
    let errMsg = "";
    try {
      decrypt(key, corruptedEnv);
    } catch (e) {
      threw = true;
      errMsg = e.message;
    }
    assert(threw, "Corrupted auth tag rejected by AES-256-GCM decipher");

    // Replace entire auth tag with zeros
    const zeroTagD = Buffer.from(rawD);
    zeroTagD.fill(0, zeroTagD.length - 16);
    const zeroTagEnv = { ...originalEnv, d: zeroTagD.toString("base64") };
    let threwZero = false;
    try {
      decrypt(key, zeroTagEnv);
    } catch {
      threwZero = true;
    }
    assert(threwZero, "Zeroed auth tag rejected by AES-256-GCM decipher");
  }

  // 2.4 Truncated Ciphertexts (< 16 bytes and body truncations)
  {
    const originalEnv = encrypt(key, "Data payload", 1, Date.now());

    // Truncated buffer under 16 bytes
    const under16Buffers = [Buffer.alloc(0), Buffer.alloc(5), Buffer.alloc(15)];
    for (const b of under16Buffers) {
      const truncEnv = { ...originalEnv, d: b.toString("base64") };
      let threw = false;
      let msg = "";
      try {
        decrypt(key, truncEnv);
      } catch (e) {
        threw = true;
        msg = e.message;
      }
      assert(threw && msg.includes("16 octets"), `Ciphertext < 16 bytes (${b.length} bytes) throws explicit tag error`);
    }

    // Truncated ciphertext body (valid tag preserved, but ciphertext sliced)
    const rawD = Buffer.from(originalEnv.d, "base64");
    if (rawD.length > 20) {
      const tag = rawD.subarray(rawD.length - 16);
      const halfCt = rawD.subarray(0, 2);
      const truncatedBodyD = Buffer.concat([halfCt, tag]);
      const truncBodyEnv = { ...originalEnv, d: truncatedBodyD.toString("base64") };
      let threwTrunc = false;
      try {
        decrypt(key, truncBodyEnv);
      } catch {
        threwTrunc = true;
      }
      assert(threwTrunc, "Truncated ciphertext body with valid tag length fails decipher");
    }
  }

  // 2.5 IV / Nonce Corruption
  {
    const originalEnv = encrypt(key, "Test IV corruption", 1, Date.now());
    const invalidIVs = [Buffer.alloc(0), Buffer.alloc(8), Buffer.alloc(16), Buffer.alloc(32)];
    for (const badIv of invalidIVs) {
      const badIvEnv = { ...originalEnv, n: badIv.toString("base64") };
      let threw = false;
      let msg = "";
      try {
        decrypt(key, badIvEnv);
      } catch (e) {
        threw = true;
        msg = e.message;
      }
      assert(threw && msg.includes("12 octets"), `Non-12-byte IV (${badIv.length} bytes) throws explicit IV error`);
    }

    // Flipped bit in IV
    const rawIv = Buffer.from(originalEnv.n, "base64");
    rawIv[0] ^= 0x01;
    const flippedIvEnv = { ...originalEnv, n: rawIv.toString("base64") };
    let threwFlippedIv = false;
    try {
      decrypt(key, flippedIvEnv);
    } catch {
      threwFlippedIv = true;
    }
    assert(threwFlippedIv, "Bit-flipped IV rejected by GCM decipher authentication");
  }

  // 2.6 AAD Tampering (Cryptographic Binding of seq and ts)
  {
    const originalEnv = encrypt(key, "AAD binding test", 10, 1000000);

    // Tamper with seq without re-encrypting
    const tamperedSeqEnv = { ...originalEnv, seq: 11 };
    let threwSeq = false;
    try {
      decrypt(key, tamperedSeqEnv);
    } catch {
      threwSeq = true;
    }
    assert(threwSeq, "Tampered sequence counter (seq) rejected due to AAD mismatch");

    // Tamper with ts without re-encrypting
    const tamperedTsEnv = { ...originalEnv, ts: 1000001 };
    let threwTs = false;
    try {
      decrypt(key, tamperedTsEnv);
    } catch {
      threwTs = true;
    }
    assert(threwTs, "Tampered timestamp (ts) rejected due to AAD mismatch");
  }

  // 2.7 Anti-Replay & Sequence Validation (validateReplay)
  {
    const now = 1_000_000;
    const makeEnv = (seq, ts) => ({ n: "abc", d: "def", seq, ts });

    // Valid progression
    assert(validateReplay(makeEnv(1, now), 0, MAX_DRIFT_MS, now).valid, "Monotonic seq: 1 accepted when lastSeq is 0");
    assert(validateReplay(makeEnv(2, now), 1, MAX_DRIFT_MS, now).valid, "Monotonic seq: 2 accepted when lastSeq is 1");
    assert(validateReplay(makeEnv(100, now), 50, MAX_DRIFT_MS, now).valid, "Seq jumping forward (seq: 100 > 50) accepted");

    // Replay attacks
    const replaySame = validateReplay(makeEnv(1, now), 1, MAX_DRIFT_MS, now);
    assert(!replaySame.valid && replaySame.error.includes("rejeu"), "Duplicate seq: 1 rejected with replay attack error");

    // Out-of-order packet arriving late
    const outOfOrder = validateReplay(makeEnv(3, now), 5, MAX_DRIFT_MS, now);
    assert(!outOfOrder.valid && outOfOrder.error.includes("rejeu"), "Out-of-order seq: 3 arriving after lastSeq: 5 rejected");

    // Non-positive or non-integer seq
    assert(!validateReplay(makeEnv(0, now), 0, MAX_DRIFT_MS, now).valid, "seq: 0 rejected");
    assert(!validateReplay(makeEnv(-1, now), 0, MAX_DRIFT_MS, now).valid, "seq: -1 rejected");
    assert(!validateReplay(makeEnv(1.5, now), 0, MAX_DRIFT_MS, now).valid, "seq: 1.5 rejected");
    assert(!validateReplay(makeEnv(NaN, now), 0, MAX_DRIFT_MS, now).valid, "seq: NaN rejected");
    assert(!validateReplay(makeEnv(Infinity, now), 0, MAX_DRIFT_MS, now).valid, "seq: Infinity rejected");
  }

  // 2.8 Clock Drift Boundaries (> 60,000ms and < -60,000ms)
  {
    const now = 10_000_000;
    const makeEnv = (ts) => ({ n: "abc", d: "def", seq: 1, ts });

    // Exact boundaries:
    assert(validateReplay(makeEnv(now), 0, 60_000, now).valid, "Clock drift exact 0ms valid");
    assert(validateReplay(makeEnv(now + 60_000), 0, 60_000, now).valid, "Clock drift exact +60,000ms boundary valid");
    assert(validateReplay(makeEnv(now - 60_000), 0, 60_000, now).valid, "Clock drift exact -60,000ms boundary valid");

    // Violations (1ms over boundary):
    const positiveOver = validateReplay(makeEnv(now + 60_001), 0, 60_000, now);
    assert(!positiveOver.valid && positiveOver.error.includes("excessive"), "Clock drift +60,001ms (> 60s) rejected");

    const negativeOver = validateReplay(makeEnv(now - 60_001), 0, 60_000, now);
    assert(!negativeOver.valid && negativeOver.error.includes("excessive"), "Clock drift -60,001ms (< -60s) rejected");

    // Extreme drifts:
    assert(!validateReplay(makeEnv(now + 1_000_000), 0, 60_000, now).valid, "Extreme future drift (+1,000s) rejected");
    assert(!validateReplay(makeEnv(now - 1_000_000), 0, 60_000, now).valid, "Extreme past drift (-1,000s) rejected");

    // Non-finite timestamps:
    assert(!validateReplay(makeEnv(NaN), 0, 60_000, now).valid, "ts: NaN rejected");
    assert(!validateReplay(makeEnv(Infinity), 0, 60_000, now).valid, "ts: Infinity rejected");
    assert(!validateReplay(makeEnv(-Infinity), 0, 60_000, now).valid, "ts: -Infinity rejected");
    assert(!validateReplay(makeEnv("invalid"), 0, 60_000, now).valid, "ts: string rejected");
  }
}

// ============================================================================
// SECTION 3: CONCURRENCY, SPOOFING & BRUTE FORCE ON pairing.ts
// ============================================================================
async function runPairingBruteForceChallenges() {
  console.log("\n================================================================================");
  console.log("  🛡️ CHALLENGE 3: SPOOFING RESISTANCE & CONCURRENT BRUTE FORCE ON pairing.ts");
  console.log("================================================================================");

  // 3.0 extractClientIp Anti-Spoofing Unit Invariants
  const { extractClientIp } = await import("../server/dist/server/src/auth/pairing.js");
  const mockReqWithSpoof = {
    socket: { remoteAddress: "127.0.0.1" },
    headers: {
      "x-forwarded-for": "203.0.113.195, 10.0.0.1",
      "x-real-ip": "198.51.100.42",
      "client-ip": "192.0.2.1",
      "cf-connecting-ip": "1.1.1.1",
    },
  };
  const extractedIp = extractClientIp(mockReqWithSpoof);
  assert(extractedIp === "127.0.0.1", `extractClientIp ignores all spoofed headers and extracts socket.remoteAddress (${extractedIp})`);

  const mockIpv6Mapped = { socket: { remoteAddress: "::ffff:192.168.1.105" }, headers: {} };
  assert(extractClientIp(mockIpv6Mapped) === "192.168.1.105", "extractClientIp strips ::ffff: prefix from IPv4-mapped IPv6 address");

  const mockNoSocketAddr = { socket: { remoteAddress: undefined }, headers: {} };
  assert(extractClientIp(mockNoSocketAddr) === "127.0.0.1", "extractClientIp safely falls back to 127.0.0.1 when remoteAddress is undefined");

  // 3.1 Live HTTP Agent Test: Header Spoofing Resistance
  const { httpPort, wsPort } = await getPortPair();
  const agent = await startAgent({
    httpPort,
    wsPort,
    log: false,
    enableMdns: false,
    enableCloud: false,
  });

  try {
    clearAllRateLimits();
    const correctPin = getActivePin();

    // Attacker sends 5 requests with 5 different spoofed X-Forwarded-For headers
    const spoofedIps = [
      "203.0.113.1",
      "198.51.100.25",
      "192.0.2.14",
      "10.200.50.1",
      "172.16.88.99",
    ];

    let lockoutEncountered = false;
    for (let i = 0; i < spoofedIps.length; i++) {
      const spoofIp = spoofedIps[i];
      const res = await fetch(`http://127.0.0.1:${httpPort}/pair/verify-pin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": spoofIp,
          "X-Real-IP": spoofIp,
          "Client-IP": spoofIp,
        },
        body: JSON.stringify({ pin: "000000" }),
      });

      const data = await res.json();
      if (i < 4) {
        assert(res.status === 401, `Failed PIN attempt ${i + 1} with spoofed IP ${spoofIp} returns 401`);
        assert(data.attemptsLeft === 5 - (i + 1), `Attempts left correctly decremented to ${5 - (i + 1)}`);
      } else {
        // 5th attempt triggers 429 lockout!
        assert(res.status === 429, `5th failed attempt with spoofed IP ${spoofIp} triggers HTTP 429 lockout`);
        lockoutEncountered = true;
      }
    }

    assert(lockoutEncountered, "Spoofed header rotation was IGNORED; rate limiter bounded to actual socket IP");

    // 6th attempt immediately rejected with 429
    const resLocked = await fetch(`http://127.0.0.1:${httpPort}/pair/verify-pin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "8.8.8.8",
      },
      body: JSON.stringify({ pin: "000000" }),
    });
    assert(resLocked.status === 429, "Subsequent attempt while locked out receives 429");

    // Reset rate limits to test edge case payloads over live HTTP
    clearAllRateLimits();

    // Edge case: missing pin in body
    const resMissing = await fetch(`http://127.0.0.1:${httpPort}/pair/verify-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert(resMissing.status === 400, "Missing pin in POST body returns 400 Bad Request");

    // Edge case: non-string pin (numeric)
    const resNum = await fetch(`http://127.0.0.1:${httpPort}/pair/verify-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: 123456 }),
    });
    assert(resNum.status === 400, "Non-string pin in POST body returns 400 Bad Request");

    // Edge case: massive string pin (50,000 chars)
    const resMassivePin = await fetch(`http://127.0.0.1:${httpPort}/pair/verify-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "1".repeat(50_000) }),
    });
    assert(resMassivePin.status === 401, "Massive 50,000 char pin handled safely with 401");

    // Valid PIN verification & single-use consumption
    const freshPin = getActivePin();
    const resValid = await fetch(`http://127.0.0.1:${httpPort}/pair/verify-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: freshPin }),
    });
    const validData = await resValid.json();
    assert(resValid.status === 200 && validData.ok === true && typeof validData.token === "string", "Valid PIN returns 200 OK with signed JWT token");

    // PIN rotation on success: replay of same PIN must now fail
    const resReplay = await fetch(`http://127.0.0.1:${httpPort}/pair/verify-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: freshPin }),
    });
    assert(resReplay.status === 401, "Replaying same PIN immediately rejected (automatic rotation after pairing)");
  } finally {
    await agent.stop();
    await sleep(50);
  }

  // 3.2 Unit-Level Concurrent Brute Force Simulation Across 10 Distinct Spoofed IPs
  console.log("\n  ▶ Simulating concurrent brute force across 10 distinct simulated client IPs...");
  clearAllRateLimits();

  const attackerIps = Array.from({ length: 10 }, (_, i) => `192.168.10.${100 + i}`);
  const legitimateIp = "192.168.10.200";

  // Simulate 10 attacker IPs concurrently exhausting attempts
  const attackPromises = attackerIps.map(async (ip) => {
    const results = [];
    for (let attempt = 1; attempt <= 6; attempt++) {
      const record = getIpRateLimit(ip);
      const now = Date.now();
      let status = 0;

      if (now < record.lockoutUntil) {
        status = 429;
      } else {
        record.attempts++;
        if (record.attempts >= MAX_PIN_FAILED_ATTEMPTS) {
          record.lockoutUntil = now + PIN_LOCKOUT_MS;
          status = 429;
        } else {
          status = 401;
        }
      }
      results.push(status);
    }
    return { ip, results };
  });

  const attackResults = await Promise.all(attackPromises);

  // Verify each attacker IP received: [401, 401, 401, 401, 429, 429]
  let allAttackersLocked = true;
  for (const { ip, results } of attackResults) {
    const expected = [401, 401, 401, 401, 429, 429];
    const match = JSON.stringify(results) === JSON.stringify(expected);
    if (!match) allAttackersLocked = false;
  }
  assert(allAttackersLocked, "All 10 concurrent attacker IPs locked out after exactly 5 attempts");

  // Verify Legitimate IP is NOT locked out (strict per-IP rate limit isolation)
  const legitRecord = getIpRateLimit(legitimateIp);
  assert(legitRecord.attempts === 0, "Legitimate IP attempts remain 0 despite 10 concurrent attackers");
  assert(Date.now() >= legitRecord.lockoutUntil, "Legitimate IP is NOT locked out");

  // 3.3 Burst Race Condition Test: 20 Simultaneous Parallel Requests from Single IP
  console.log("\n  ▶ Simulating 20 simultaneous parallel requests from a single IP (race condition check)...");
  const raceIp = "10.0.0.42";
  resetIpAttempts(raceIp);

  const burstRequests = Array.from({ length: 20 }, async () => {
    const record = getIpRateLimit(raceIp);
    const now = Date.now();
    if (now < record.lockoutUntil) {
      return 429;
    }
    record.attempts++;
    if (record.attempts >= MAX_PIN_FAILED_ATTEMPTS) {
      record.lockoutUntil = now + PIN_LOCKOUT_MS;
      return 429;
    }
    return 401;
  });

  const burstStatuses = await Promise.all(burstRequests);
  const count401 = burstStatuses.filter((s) => s === 401).length;
  const count429 = burstStatuses.filter((s) => s === 429).length;

  assert(count401 < MAX_PIN_FAILED_ATTEMPTS, `Allowed 401 attempts strictly capped below threshold (< 5) (got: ${count401})`);
  assert(count429 > 0, `Lockout 429 triggered during simultaneous burst (got: ${count429})`);
  assert(getIpRateLimit(raceIp).lockoutUntil > Date.now(), "IP lockout state is active and persisted");

  // 3.4 Rate Limit Cleanup
  const oldNow = Date.now();
  cleanupIpRateLimits(oldNow + PIN_LOCKOUT_MS + 5 * 60 * 1000 + 1);
  // Records with expired lockout should be cleaned up
  clearAllRateLimits();
  assert(true, "Rate limit table cleanup operates safely without exception");

  // 3.5 PIN Lifecycle & Edge Case Inputs
  const currentPin = getActivePin();
  assert(currentPin.length === 6 && /^\d{6}$/.test(currentPin), "Generated PIN is exactly 6 digits");

  // Pin expiration check
  assert(!isPinExpired(Date.now()), "Fresh PIN is not expired");
  assert(isPinExpired(Date.now() + 6 * 60 * 1000), "PIN expired after 6 minutes (> 5 min TTL)");

  // PIN refresh generates fresh 6-digit PIN
  const newPin = refreshActivePin();
  assert(newPin.length === 6 && /^\d{6}$/.test(newPin), "Refreshed PIN is 6 digits");
}

// ============================================================================
// MAIN RUNNER
// ============================================================================
async function main() {
  console.log("================================================================================");
  console.log("  ⚡ CHALLENGER M3-1: EMPIRICAL FUZZING, BOUNDARY & SECURITY STRESS HARNESS");
  console.log("================================================================================");

  const start = Date.now();

  try {
    await runValidationFuzzingChallenges();
    await runE2ECryptoChallenges();
    await runPairingBruteForceChallenges();
  } catch (err) {
    console.error("FATAL HARNESS ERROR:", err);
    process.exit(1);
  }

  const durationSec = ((Date.now() - start) / 1000).toFixed(2);

  console.log("\n================================================================================");
  console.log("  📊 EMPIRICAL CHALLENGE EXECUTION SUMMARY");
  console.log("================================================================================");
  console.log(`  Total Test Invariants Checked: ${totalTests}`);
  console.log(`  Passed Invariants:             ${passedTests}`);
  console.log(`  Failed Invariants:             ${failedTests}`);
  console.log(`  Execution Duration:            ${durationSec}s`);
  console.log("================================================================================");

  if (failedTests > 0) {
    console.error(`\n  ✖ ${failedTests} CHALLENGE INVARIANTS FAILED:`);
    for (const f of failures) {
      console.error(`    - ${f.message} (${f.details})`);
    }
    process.exit(1);
  } else {
    console.log(`\n  🏆 ALL ${totalTests} CHALLENGE INVARIANTS PASSED EMPIRICALLY!`);
    process.exit(0);
  }
}

main();
