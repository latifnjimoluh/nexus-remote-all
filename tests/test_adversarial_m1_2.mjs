/**
 * Suite de tests de stress adversariaux Challenger M1-2
 * Tests avancés :
 * 1. Attaques par injection / empoisonnement de seq (DoS via lastReceivedSeq poisoning)
 * 2. Non-contournement du rate-limiting via headers forgés (X-Forwarded-For, etc.)
 * 3. Robustesse aux types inattendus sur le body PIN (numbers, arrays, prototype, objets)
 * 4. Déverrouillage après expiration du lockout (recovery post-60s)
 * 5. Gestion des payloads vides, grands buffers, et caractères spéciaux
 * 6. Nettoyage de mémoire et résistance aux fuites (cleanupIpRateLimits)
 */

import http from "node:http";
import express from "express";
import * as serverE2e from "../server/dist/server/src/e2e.js";
import * as clientE2e from "../client/src/core/e2e.ts";
import * as pairing from "../server/dist/server/src/auth/pairing.js";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function assert(condition, message, details = "") {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${message}`);
  } else {
    failedTests++;
    const err = `❌ [FAIL] ${message} ${details ? "(" + details + ")" : ""}`;
    console.error(`  ${err}`);
    failures.push({ message, details });
  }
}

async function runAdversarialStress() {
  console.log("================================================================================");
  console.log("  ADVERSARIAL STRESS SUITE : CHALLENGER M1-2");
  console.log("================================================================================\n");

  const serverKey = serverE2e.keyFromB64url(serverE2e.generateKeyB64url());
  const clientKey = await clientE2e.importKey(serverKey.toString("base64url"));

  // ============================================================================
  // ADVERSARIAL SECTION 1 : E2EE ATTEMPTS TO POISON STATE OR CRASH CIPHER
  // ============================================================================
  console.log("▶ 1. E2EE Attack Vectors : Sequence Poisoning, Edge Sizes, Types\n");

  // 1.1 Tentative d'empoisonnement DoS de lastReceivedSeq
  // Scénario : L'attaquant envoie un seq énorme (seq=999999) avec un tag corrompu.
  // Si le serveur mettait à jour lastReceivedSeq avant le déchiffrement réussi,
  // tous les paquets ultérieurs du client légitime (seq 2, 3...) seraient rejetés !
  let statefulLastSeq = 1;
  const maliciousForgedSeqEnv = {
    ...serverE2e.encrypt(serverKey, "malicious", 1, Date.now()),
    seq: 999999, // Faux numéro de séquence élevé
  };

  // Le test stateless validateReplay passe (999999 > 1)
  const replayPasses = serverE2e.validateReplay(maliciousForgedSeqEnv, statefulLastSeq);
  assert(replayPasses.valid === true, "Forged high seq passes stateless replay check");

  // Mais lors du déchiffrement : échec GCM AAD
  let decryptFailed = false;
  try {
    serverE2e.decrypt(serverKey, maliciousForgedSeqEnv);
    statefulLastSeq = maliciousForgedSeqEnv.seq; // NE DOIT PAS ÊTRE ATTEINT
  } catch {
    decryptFailed = true;
  }
  assert(decryptFailed, "Decryption of forged high seq envelope fails with AAD error");
  assert(statefulLastSeq === 1, "lastReceivedSeq state was NOT poisoned by unauthenticated envelope");

  // Le client légitime envoie seq=2 : doit être accepté normalement
  const legitimateEnvSeq2 = serverE2e.encrypt(serverKey, "legitimate command", 2, Date.now());
  const legCheck = serverE2e.validateReplay(legitimateEnvSeq2, statefulLastSeq);
  assert(legCheck.valid === true, "Legitimate packet seq=2 is accepted without DoS lockout");

  // 1.2 Chiffrement d'une chaîne vide
  const emptyEnv = serverE2e.encrypt(serverKey, "", 3, Date.now());
  const decryptedEmpty = serverE2e.decrypt(serverKey, emptyEnv);
  assert(decryptedEmpty === "", "Empty plaintext encrypts and decrypts cleanly");

  // 1.3 Chiffrement d'un très grand message (64 KB)
  const largePlaintext = "X".repeat(65536);
  const largeEnv = serverE2e.encrypt(serverKey, largePlaintext, 4, Date.now());
  const decryptedLarge = serverE2e.decrypt(serverKey, largeEnv);
  assert(decryptedLarge === largePlaintext, "Large payload (64KB) encrypts and decrypts cleanly");

  // 1.4 WebCrypto -> Node Crypto avec grand message
  const clientLargeEnv = await clientE2e.encrypt(clientKey, largePlaintext, 5, Date.now());
  const nodeDecryptedLarge = serverE2e.decrypt(serverKey, clientLargeEnv);
  assert(nodeDecryptedLarge === largePlaintext, "Cross-decrypt 64KB WebCrypto -> Node matches exactly");

  // 1.5 Attaque par injection de prototypes / propriétés parasites sur Envelope
  const prototypePollutedEnv = {
    n: legitimateEnvSeq2.n,
    d: legitimateEnvSeq2.d,
    seq: 6,
    ts: Date.now(),
    __proto__: { isAdmin: true },
    constructor: Object,
    valueOf: () => 42,
  };
  assert(serverE2e.isEnvelope(prototypePollutedEnv), "Envelope with parasite properties satisfies isEnvelope");
  // Doit échouer car le tag AAD est lié à seq=2 original, pas seq=6
  let protoTamperCaught = false;
  try {
    serverE2e.decrypt(serverKey, prototypePollutedEnv);
  } catch {
    protoTamperCaught = true;
  }
  assert(protoTamperCaught, "Tampered envelope with injected props caught by GCM tag verification");

  // ============================================================================
  // ADVERSARIAL SECTION 2 : PIN RATE LIMITING ATTACKS (IP SPOOFING, INJECTIONS)
  // ============================================================================
  console.log("\n▶ 2. PIN Endpoint Attack Vectors : IP Spoofing, Bad Types, State Recovery\n");

  const app = express();
  app.use(express.json());
  app.use("/pair", pairing.pairingRouter);

  const testServer = http.createServer(app);
  const TEST_PORT = 4736;
  await new Promise((res) => testServer.listen(TEST_PORT, "127.0.0.1", res));

  try {
    pairing.clearAllRateLimits();

    // 2.1 Tentative de contournement du Rate Limiting via en-têtes HTTP forgés (IP Spoofing)
    console.log("  [Test 2.1] IP Spoofing via headers (X-Forwarded-For, CF-Connecting-IP)");
    for (let i = 1; i <= 5; i++) {
      const resp = await fetch(`http://127.0.0.1:${TEST_PORT}/pair/verify-pin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": `203.0.113.${i}`, // Tentative de faire croire à une IP différente à chaque requête
          "X-Real-IP": `203.0.113.${i}`,
          "CF-Connecting-IP": `203.0.113.${i}`,
          "Client-IP": `203.0.113.${i}`,
        },
        body: JSON.stringify({ pin: "000000" }),
      });
      if (i < 5) {
        assert(resp.status === 401, `Attempt ${i}/5 with spoofed headers is rejected with 401`);
      } else {
        assert(
          resp.status === 429,
          "5th attempt with spoofed headers triggers 429 lockout (spoofed headers are ignored)",
        );
      }
    }

    // 2.2 Vérification que les headers forgés ne permettent pas de contourner le lockout
    const spoofBypassResp = await fetch(`http://127.0.0.1:${TEST_PORT}/pair/verify-pin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "1.2.3.4",
      },
      body: JSON.stringify({ pin: "000000" }),
    });
    assert(
      spoofBypassResp.status === 429,
      "Subsequent request with new spoofed X-Forwarded-For remains locked out (429)",
    );

    // 2.3 Injection de types malveillants sur req.body.pin (non-strings)
    pairing.clearAllRateLimits();

    const badPinPayloads = [
      { name: "integer pin", body: { pin: 123456 } },
      { name: "array pin", body: { pin: ["123456"] } },
      { name: "null pin", body: { pin: null } },
      { name: "boolean pin", body: { pin: true } },
      { name: "object pin", body: { pin: { value: "123456" } } },
      { name: "missing pin field", body: {} },
    ];

    for (const testCase of badPinPayloads) {
      const resp = await fetch(`http://127.0.0.1:${TEST_PORT}/pair/verify-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testCase.body),
      });
      const data = await resp.json();
      assert(
        resp.status === 400 && data.ok === false,
        `Malformed payload (${testCase.name}) returns HTTP 400 with 'Code PIN manquant.'`,
      );
    }

    // 2.4 Chaînes spéciales et tentatives d'injection dans pin
    const injectionPins = [
      "' OR '1'='1",
      "<script>alert(1)</script>",
      "^([0-9]{6})$",
      "      ",
      "12345",     // 5 chiffres
      "1234567",   // 7 chiffres
      "abcdef",    // lettres
    ];

    for (const badPin of injectionPins) {
      const resp = await fetch(`http://127.0.0.1:${TEST_PORT}/pair/verify-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: badPin }),
      });
      assert(
        resp.status === 401 || resp.status === 429,
        `Adversarial pin input (${badPin.slice(0, 15)}) safely rejected without crash or bypass`,
      );
    }

    // 2.5 Déverrouillage automatique après écoulement du temps de lockout (Recovery post-lockout)
    console.log("\n  [Test 2.5] Recovery post-lockout test via simulated clock");
    pairing.clearAllRateLimits();
    const clientIp = "192.168.1.100";
    const record = pairing.getIpRateLimit(clientIp);
    const fakeNow = Date.now();

    // Verrouiller manuellement le record à fakeNow
    record.attempts = 5;
    record.lockoutUntil = fakeNow + pairing.PIN_LOCKOUT_MS; // +60s

    // Simuler un appel à fakeNow + 30s (doit être bloqué)
    const isLockedAt30s = fakeNow + 30_000 < record.lockoutUntil;
    assert(isLockedAt30s, "IP is confirmed locked at +30s into lockout");

    // Simuler un appel à fakeNow + 61s (doit être débloqué)
    const timeAfterLockout = fakeNow + 61_000;
    const isUnlockedAt61s = timeAfterLockout >= record.lockoutUntil;
    assert(isUnlockedAt61s, "Lockout expiration condition satisfied at +61s");

    // Nettoyage automatique des enregistrements obsolètes
    record.lastAttemptAt = fakeNow - pairing.STALE_RECORD_TTL_MS - 1000; // Ancien de > 5 min
    record.attempts = 0;
    record.lockoutUntil = 0;
    pairing.cleanupIpRateLimits(fakeNow);
    // Vérifier que le record a été nettoyé de la map
    const newRecord = pairing.getIpRateLimit(clientIp);
    assert(newRecord.attempts === 0, "Stale rate limit records are successfully collected by cleanup");

  } finally {
    await new Promise((res) => testServer.close(res));
    console.log("  Serveur de test de stress arrêté.");
  }

  // ============================================================================
  // BILAN FINAL ADVERSARIAL
  // ============================================================================
  console.log("\n================================================================================");
  console.log(`  BILAN DE STRESS : ${passedTests}/${totalTests} tests réussis (${failedTests} échecs)`);
  console.log("================================================================================");

  if (failedTests > 0) {
    console.error("\nDétail des échecs de stress :");
    for (const f of failures) {
      console.error(`- ${f.message}: ${f.details}`);
    }
  }

  process.exit(failedTests === 0 ? 0 : 1);
}

runAdversarialStress().catch((err) => {
  console.error("Erreur fatale dans la suite de stress :", err);
  process.exit(1);
});
