/**
 * Suite de tests empiriques et contradictoires Challenger M1-2
 * Périmètre :
 * 1. Cloud Relay E2EE Replay Attack Protection (server/src/e2e.ts & client/src/core/e2e.ts)
 * 2. PIN Brute-force & Rate Limiting (server/src/auth/pairing.ts)
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

async function runTests() {
  console.log("================================================================================");
  console.log("  EMPIRICAL CHALLENGER M1-2 : E2EE REPLAY PROTECTION & PIN RATE LIMITING");
  console.log("================================================================================\n");

  // ============================================================================
  // SUITE 1 : Cloud Relay E2EE Replay Attack Protection & Cryptographic Integrity
  // ============================================================================
  console.log("▶ SUITE 1 : Cloud Relay E2EE Replay Attack Protection & Cross-Interop\n");

  // 1.1 Cross-Compatibility: Key generation and import
  const keyB64url = serverE2e.generateKeyB64url();
  const serverKey = serverE2e.keyFromB64url(keyB64url);
  assert(serverKey.length === 32, "Server key generation produces 32-byte AES key");

  let clientKey;
  try {
    clientKey = await clientE2e.importKey(keyB64url);
    assert(Boolean(clientKey), "Client WebCrypto successfully imports Server b64url key");
  } catch (err) {
    assert(false, "Client WebCrypto failed to import Server key", String(err));
  }

  // 1.2 Cross-Encryption: Server encrypts -> Client decrypts
  const serverPlaintext = JSON.stringify({ type: "mouse:move", dx: 150, dy: -250 });
  const serverEnvelope = serverE2e.encrypt(serverKey, serverPlaintext, 1, Date.now());
  assert(serverE2e.isEnvelope(serverEnvelope), "Server envelope satisfies server isEnvelope guard");
  assert(clientE2e.isEnvelope(serverEnvelope), "Server envelope satisfies client isEnvelope guard");

  try {
    const decryptedByClient = await clientE2e.decrypt(clientKey, serverEnvelope);
    assert(
      decryptedByClient === serverPlaintext,
      "Client WebCrypto successfully decrypts Server AES-256-GCM envelope with AAD",
    );
  } catch (err) {
    assert(false, "Client failed to decrypt Server envelope", String(err));
  }

  // 1.3 Cross-Encryption: Client encrypts -> Server decrypts
  const clientPlaintext = JSON.stringify({ type: "key:tap", key: "Enter", payload: "accentué & emoji 🚀" });
  const clientEnvelope = await clientE2e.encrypt(clientKey, clientPlaintext, 2, Date.now());
  assert(serverE2e.isEnvelope(clientEnvelope), "Client envelope satisfies server isEnvelope guard");
  assert(clientE2e.isEnvelope(clientEnvelope), "Client envelope satisfies client isEnvelope guard");

  try {
    const decryptedByServer = serverE2e.decrypt(serverKey, clientEnvelope);
    assert(
      decryptedByServer === clientPlaintext,
      "Server Node crypto successfully decrypts Client WebCrypto AES-256-GCM envelope with AAD",
    );
  } catch (err) {
    assert(false, "Server failed to decrypt Client envelope", String(err));
  }

  // 1.4 Replaying an identical envelope twice
  const envSeq10 = serverE2e.encrypt(serverKey, JSON.stringify({ type: "slide:next" }), 10, Date.now());
  let lastReceivedSeq = 0;

  // Première réception
  const firstReplayCheck = serverE2e.validateReplay(envSeq10, lastReceivedSeq);
  assert(firstReplayCheck.valid === true, "First receipt of envelope (seq=10) passes replay validation");
  lastReceivedSeq = envSeq10.seq; // Mise à jour de l'état atomique après validation

  // Deuxième réception de l'enveloppe identique (Attaque par rejeu)
  const secondReplayCheck = serverE2e.validateReplay(envSeq10, lastReceivedSeq);
  assert(
    secondReplayCheck.valid === false && secondReplayCheck.error?.includes("rejeu"),
    "Second receipt of identical envelope is strictly rejected as replay attack",
    `error: ${secondReplayCheck.error}`,
  );

  // 1.5 Altering `seq` in cleartext without re-encrypting (AAD Tampering Attack)
  // L'attaquant intercepte une enveloppe valide avec seq=1, et modifie seq=2 dans l'enveloppe JSON
  const origEnvForSeqTamper = serverE2e.encrypt(
    serverKey,
    JSON.stringify({ type: "mouse:click", button: "left" }),
    1,
    Date.now(),
  );
  const tamperedSeqEnv = { ...origEnvForSeqTamper, seq: 2 };

  // Le test validateReplay passera car 2 > 0
  const tamperedReplayCheck = serverE2e.validateReplay(tamperedSeqEnv, 0);
  assert(
    tamperedReplayCheck.valid === true,
    "Tampered seq envelope passes initial stateless seq check (seq 2 > 0)",
  );

  // MAIS le déchiffrement côté serveur DOIT échouer car l'AAD '2:ts' ne correspond pas à l'AAD chiffré '1:ts'
  let serverSeqTamperDetected = false;
  try {
    serverE2e.decrypt(serverKey, tamperedSeqEnv);
  } catch (err) {
    serverSeqTamperDetected = true;
  }
  assert(
    serverSeqTamperDetected,
    "Server AES-GCM decrypt strictly rejects cleartext seq tampering via AAD authentication tag failure",
  );

  // De même côté client WebCrypto
  let clientSeqTamperDetected = false;
  try {
    await clientE2e.decrypt(clientKey, tamperedSeqEnv);
  } catch (err) {
    clientSeqTamperDetected = true;
  }
  assert(
    clientSeqTamperDetected,
    "Client WebCrypto decrypt strictly rejects cleartext seq tampering via AAD tag mismatch",
  );

  // 1.6 Altering `ts` in cleartext without re-encrypting (AAD Tampering Attack)
  const origEnvForTsTamper = serverE2e.encrypt(
    serverKey,
    JSON.stringify({ type: "mouse:scroll", dy: 100 }),
    5,
    Date.now(),
  );
  const tamperedTsEnv = { ...origEnvForTsTamper, ts: origEnvForTsTamper.ts + 5000 };

  let serverTsTamperDetected = false;
  try {
    serverE2e.decrypt(serverKey, tamperedTsEnv);
  } catch (err) {
    serverTsTamperDetected = true;
  }
  assert(
    serverTsTamperDetected,
    "Server AES-GCM decrypt strictly rejects cleartext ts tampering via AAD authentication tag failure",
  );

  let clientTsTamperDetected = false;
  try {
    await clientE2e.decrypt(clientKey, tamperedTsEnv);
  } catch (err) {
    clientTsTamperDetected = true;
  }
  assert(
    clientTsTamperDetected,
    "Client WebCrypto decrypt strictly rejects cleartext ts tampering via AAD tag mismatch",
  );

  // 1.7 Altering ciphertext `d` or IV `n`
  const tamperedCiphertextEnv = { ...origEnvForTsTamper, d: Buffer.from("corruptedData1234567890").toString("base64") };
  let ctTamperDetected = false;
  try {
    serverE2e.decrypt(serverKey, tamperedCiphertextEnv);
  } catch {
    ctTamperDetected = true;
  }
  assert(ctTamperDetected, "Corrupted ciphertext payload is rejected by decrypt()");

  const tamperedIvEnv = { ...origEnvForTsTamper, n: Buffer.from("shortIV").toString("base64") };
  let ivTamperDetected = false;
  try {
    serverE2e.decrypt(serverKey, tamperedIvEnv);
  } catch (err) {
    ivTamperDetected = String(err).includes("12 octets");
  }
  assert(ivTamperDetected, "Invalid IV length (< 12 bytes) is rejected by decrypt()");

  // 1.8 Expired timestamp & drift window
  const expiredPastEnv = serverE2e.encrypt(
    serverKey,
    "test",
    1,
    Date.now() - 120_000, // 120s dans le passé
  );
  const expiredCheck = serverE2e.validateReplay(expiredPastEnv, 0);
  assert(
    expiredCheck.valid === false && expiredCheck.error?.includes("Dérive d'horloge excessive"),
    "Expired timestamp (120s in past) is rejected by replay validation",
    `error: ${expiredCheck.error}`,
  );

  const futureEnv = serverE2e.encrypt(
    serverKey,
    "test",
    1,
    Date.now() + 120_000, // 120s dans le futur
  );
  const futureCheck = serverE2e.validateReplay(futureEnv, 0);
  assert(
    futureCheck.valid === false && futureCheck.error?.includes("Dérive d'horloge excessive"),
    "Future timestamp (120s in future) is rejected by replay validation",
    `error: ${futureCheck.error}`,
  );

  // Boundary conditions: 59s drift (acceptable) vs 61s drift (rejected)
  const validDriftEnv = serverE2e.encrypt(serverKey, "test", 1, Date.now() - 59_000);
  assert(
    serverE2e.validateReplay(validDriftEnv, 0).valid === true,
    "Boundary drift 59s (<= 60s max drift) is accepted",
  );

  const invalidDriftEnv = serverE2e.encrypt(serverKey, "test", 1, Date.now() - 61_000);
  assert(
    serverE2e.validateReplay(invalidDriftEnv, 0).valid === false,
    "Boundary drift 61s (> 60s max drift) is rejected",
  );

  // 1.9 Sequence number jumping backwards or duplicate
  const seq50Env = serverE2e.encrypt(serverKey, "test", 50, Date.now());
  const seq49Env = serverE2e.encrypt(serverKey, "test", 49, Date.now());
  const seq1Env = serverE2e.encrypt(serverKey, "test", 1, Date.now());
  const seq51Env = serverE2e.encrypt(serverKey, "test", 51, Date.now());

  assert(
    serverE2e.validateReplay(seq49Env, 50).valid === false,
    "Sequence jumping backwards (seq 49 after 50) is rejected",
  );
  assert(
    serverE2e.validateReplay(seq1Env, 50).valid === false,
    "Sequence jumping backwards to 1 (seq 1 after 50) is rejected",
  );
  assert(
    serverE2e.validateReplay(seq50Env, 50).valid === false,
    "Duplicate sequence number (seq 50 after 50) is rejected",
  );
  assert(
    serverE2e.validateReplay(seq51Env, 50).valid === true,
    "Strictly advancing sequence number (seq 51 after 50) is accepted",
  );

  // Invalid seq values (0, negative, floats, NaN)
  const invalidSeqValues = [0, -1, 3.14, NaN, Infinity, -Infinity];
  for (const badSeq of invalidSeqValues) {
    const badEnv = { n: "AAAA", d: "BBBB", seq: badSeq, ts: Date.now() };
    const res = serverE2e.validateReplay(badEnv, 0);
    assert(res.valid === false, `Malformed sequence value (${badSeq}) is rejected`);
  }

  // ============================================================================
  // SUITE 2 : PIN Brute-force & Per-IP Rate Limiting
  // ============================================================================
  console.log("\n▶ SUITE 2 : PIN Brute-force & Per-IP Rate Limiting (Unit & Stateful)\n");

  pairing.clearAllRateLimits();

  const ipAttacker = "198.51.100.42";
  const ipVictim = "198.51.100.99";

  // Simulation d'une fonction d'exécution de requête sur la logique de pairing
  // Crée un mock Request / Response pour tester directement l'algorithme
  function mockVerifyPin(clientIp, pin) {
    let statusCode = 200;
    let responseBody = null;

    const req = {
      socket: { remoteAddress: clientIp },
      body: { pin },
    };

    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };

    // On invoque le handler en reproduisant la signature du router
    // Récupérer le middleware / handler de verify-pin
    const record = pairing.getIpRateLimit(pairing.extractClientIp(req));
    const now = Date.now();

    if (now < record.lockoutUntil) {
      const remaining = Math.ceil((record.lockoutUntil - now) / 1000);
      return {
        status: 429,
        body: {
          ok: false,
          error: `Trop de tentatives depuis cette adresse IP. Veuillez patienter ${remaining}s avant de réessayer.`,
        },
      };
    }

    if (record.lockoutUntil > 0 && now >= record.lockoutUntil) {
      record.attempts = 0;
      record.lockoutUntil = 0;
    }

    const rawPin = req.body?.pin;
    if (!rawPin || typeof rawPin !== "string") {
      return { status: 400, body: { ok: false, error: "Code PIN manquant." } };
    }

    const cleanInput = rawPin.replace(/\D/g, "");
    const cleanActive = pairing.getActivePin().replace(/\D/g, "");

    const isMatch =
      cleanInput.length === 6 &&
      cleanActive.length === 6 &&
      cleanInput === cleanActive; // timingSafeEqual testé par ailleurs

    if (isMatch) {
      pairing.resetIpAttempts(clientIp);
      pairing.refreshActivePin();
      return {
        status: 200,
        body: { ok: true, token: "mock_jwt_token" },
      };
    }

    record.attempts++;
    record.lastAttemptAt = now;

    if (record.attempts >= pairing.MAX_PIN_FAILED_ATTEMPTS) {
      record.lockoutUntil = now + pairing.PIN_LOCKOUT_MS;
      return {
        status: 429,
        body: {
          ok: false,
          error: "5 tentatives incorrectes. Appairage bloqué pour votre adresse IP pendant 60 secondes.",
        },
      };
    }

    return {
      status: 401,
      body: {
        ok: false,
        error: "Code PIN incorrect. Vérifiez les 6 chiffres affichés sur votre écran de PC.",
        attemptsLeft: pairing.MAX_PIN_FAILED_ATTEMPTS - record.attempts,
      },
    };
  }

  // 2.1 5 mauvaises tentatives successives depuis ipAttacker
  console.log("  [Test 2.1] 5 mauvaises tentatives successives depuis ipAttacker");
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = mockVerifyPin(ipAttacker, "000000");
    assert(
      res.status === 401 && res.body.attemptsLeft === 5 - attempt,
      `Attempt ${attempt}/5 returns HTTP 401 with attemptsLeft=${5 - attempt}`,
    );
  }

  // 5e tentative erronée -> déclenchement du 429 lockout
  const attempt5 = mockVerifyPin(ipAttacker, "000000");
  assert(
    attempt5.status === 429 && attempt5.body.error?.includes("bloqué pour votre adresse IP pendant 60 secondes"),
    "5th failed attempt triggers HTTP 429 lockout for 60s",
    `status: ${attempt5.status}, body: ${JSON.stringify(attempt5.body)}`,
  );

  // 6e tentative (immédiate pendant la période de lockout)
  const attempt6 = mockVerifyPin(ipAttacker, "000000");
  assert(
    attempt6.status === 429 && attempt6.body.error?.includes("Trop de tentatives"),
    "6th attempt while locked out returns HTTP 429 with remaining retry countdown",
    `status: ${attempt6.status}, body: ${JSON.stringify(attempt6.body)}`,
  );

  // Tentative avec le BON PIN pendant le lockout
  const activePinDuringLockout = pairing.getActivePin();
  const attemptWithCorrectPinDuringLockout = mockVerifyPin(ipAttacker, activePinDuringLockout);
  assert(
    attemptWithCorrectPinDuringLockout.status === 429,
    "Locked-out IP CANNOT bypass lockout even by providing correct PIN (returns HTTP 429)",
  );

  // 2.2 Isolation stricte par adresse IP (Per-IP Isolation)
  console.log("\n  [Test 2.2] Isolation stricte : ipVictim non impacté pendant le lockout de ipAttacker");
  
  // ipVictim soumet un mauvais PIN : doit recevoir 401 avec 4 tentatives restantes (PAS 429)
  const victimWrong = mockVerifyPin(ipVictim, "111111");
  assert(
    victimWrong.status === 401 && victimWrong.body.attemptsLeft === 4,
    "Unrelated client IP (ipVictim) is NOT locked out when ipAttacker is locked (returns 401, attemptsLeft=4)",
  );

  // ipVictim soumet le BON PIN : doit recevoir 200 OK avec succès
  const currentPin = pairing.getActivePin();
  const victimCorrect = mockVerifyPin(ipVictim, currentPin);
  assert(
    victimCorrect.status === 200 && victimCorrect.body.ok === true,
    "Unrelated client IP (ipVictim) successfully authenticates with valid PIN during ipAttacker lockout",
  );

  // Vérification qu'ipAttacker est TOUJOURS bloqué après le succès d'ipVictim
  const attackerStillLocked = mockVerifyPin(ipAttacker, "999999");
  assert(
    attackerStillLocked.status === 429,
    "ipAttacker remains strictly locked out after ipVictim successfully pairs",
  );

  // Vérification de la régénération du PIN après appairage réussi : l'ancien PIN ne fonctionne plus
  const retryOldPin = mockVerifyPin(ipVictim, currentPin);
  assert(
    retryOldPin.status === 401,
    "Old PIN was immediately rotated and revoked after successful pairing (cannot be reused)",
  );

  // ============================================================================
  // SUITE 3 : Tests d'Intégration Réseau HTTP Réel via Serveur Express & Fetch
  // ============================================================================
  console.log("\n▶ SUITE 3 : Live HTTP Server Express Verification (/pair/verify-pin)\n");

  const app = express();
  app.use(express.json());
  app.use("/pair", pairing.pairingRouter);

  const testServer = http.createServer(app);
  const TEST_PORT = 4735;

  await new Promise((resolve) => testServer.listen(TEST_PORT, "127.0.0.1", resolve));
  console.log(`  Serveur HTTP de test démarré sur http://127.0.0.1:${TEST_PORT}`);

  try {
    pairing.clearAllRateLimits();
    const liveActivePin = pairing.getActivePin();

    // Effectuer 5 requêtes HTTP réelles avec mauvais code PIN depuis 127.0.0.1
    for (let i = 1; i <= 4; i++) {
      const resp = await fetch(`http://127.0.0.1:${TEST_PORT}/pair/verify-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: "000000" }),
      });
      const data = await resp.json();
      assert(
        resp.status === 401 && data.attemptsLeft === 5 - i,
        `Live HTTP POST attempt ${i}/5 returns 401 with attemptsLeft=${data.attemptsLeft}`,
      );
    }

    // 5e requête HTTP réelle -> 429
    const resp5 = await fetch(`http://127.0.0.1:${TEST_PORT}/pair/verify-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "000000" }),
    });
    const data5 = await resp5.json();
    assert(
      resp5.status === 429 && data5.error?.includes("bloqué"),
      "Live HTTP POST 5th failure returns 429 Too Many Requests lockout",
    );

    // 6e requête HTTP réelle -> 429
    const resp6 = await fetch(`http://127.0.0.1:${TEST_PORT}/pair/verify-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: liveActivePin }),
    });
    const data6 = await resp6.json();
    assert(
      resp6.status === 429 && data6.error?.includes("Trop de tentatives"),
      "Live HTTP POST subsequent attempt during lockout returns 429",
    );

    // Réinitialiser les compteurs pour tester le flux nominal de succès
    pairing.clearAllRateLimits();
    const freshPin = pairing.getActivePin();
    const successResp = await fetch(`http://127.0.0.1:${TEST_PORT}/pair/verify-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: freshPin }),
    });
    const successData = await successResp.json();
    assert(
      successResp.status === 200 && successData.ok === true && Boolean(successData.token),
      "Live HTTP POST with correct PIN returns 200 OK with valid JWT token",
    );

    // Vérifier que le PIN a été régénéré et que réutiliser le même renvoie 401
    const reusedResp = await fetch(`http://127.0.0.1:${TEST_PORT}/pair/verify-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: freshPin }),
    });
    assert(
      reusedResp.status === 401,
      "Live HTTP POST immediately rejects reused PIN after successful pairing",
    );
  } finally {
    await new Promise((resolve) => testServer.close(resolve));
    console.log("  Serveur HTTP de test arrêté.");
  }

  // ============================================================================
  // BILAN FINAL
  // ============================================================================
  console.log("\n================================================================================");
  console.log(`  BILAN : ${passedTests}/${totalTests} tests réussis (${failedTests} échecs)`);
  console.log("================================================================================");

  if (failedTests > 0) {
    console.error("\nDétail des échecs :");
    for (const f of failures) {
      console.error(`- ${f.message}: ${f.details}`);
    }
  }

  process.exit(failedTests === 0 ? 0 : 1);
}

runTests().catch((err) => {
  console.error("Erreur fatale dans la suite de tests :", err);
  process.exit(1);
});
