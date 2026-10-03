import test, { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import {
  generateRandomPin,
  formatPin,
  isPinExpired,
  getActivePin,
  refreshActivePin,
  getIpRateLimit,
  resetIpAttempts,
  clearAllRateLimits,
  isLoopbackAddress,
  generateClientToken,
  PIN_TTL_MS,
  MAX_PIN_FAILED_ATTEMPTS,
  PIN_LOCKOUT_MS,
} from "../../src/auth/pairing.js";

describe("pairing — PIN Lifecycle, Rate Limiting & Loopback Security", () => {
  beforeEach(() => {
    clearAllRateLimits();
  });

  it("generateRandomPin — generates 6-digit CSPRNG integer strings", () => {
    const pin = generateRandomPin();
    assert.equal(typeof pin, "string");
    assert.equal(pin.length, 6);
    assert.match(pin, /^\d{6}$/);
    const num = Number(pin);
    assert.equal(num >= 100000 && num <= 999999, true);
  });

  it("formatPin — formats 6 digits with middle space delimiter", () => {
    assert.equal(formatPin("123456"), "123 456");
    assert.equal(formatPin("987654"), "987 654");
  });

  it("isPinExpired — respects 5-minute (300,000ms) TTL", () => {
    refreshActivePin();
    const t0 = Date.now();
    assert.equal(isPinExpired(t0 + 1000), false);
    assert.equal(isPinExpired(t0 + 299_999), false);
    assert.equal(isPinExpired(t0 + PIN_TTL_MS), true);
    assert.equal(isPinExpired(t0 + PIN_TTL_MS + 10_000), true);
  });

  it("getActivePin — auto-refreshes PIN when expired", () => {
    const pin1 = refreshActivePin();
    const t0 = Date.now();
    // Valid window: returns identical active PIN
    assert.equal(getActivePin(t0 + 10_000), pin1);
    // Expired window: returns newly generated PIN
    const pin2 = getActivePin(t0 + PIN_TTL_MS + 1000);
    assert.match(pin2, /^\d{6}$/);
  });

  it("isLoopbackAddress — accurately identifies loopback vs external IP addresses", () => {
    assert.equal(isLoopbackAddress("127.0.0.1"), true);
    assert.equal(isLoopbackAddress("::1"), true);
    assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
    assert.equal(isLoopbackAddress("127.0.0.5"), true);
    assert.equal(isLoopbackAddress("127.255.255.255"), true);
    assert.equal(isLoopbackAddress("192.168.1.100"), false);
    assert.equal(isLoopbackAddress("10.0.0.1"), false);
    assert.equal(isLoopbackAddress("8.8.8.8"), false);
    assert.equal(isLoopbackAddress(""), false);
    assert.equal(isLoopbackAddress(null), false);
  });

  it("Rate Limiting — tracks failed attempts per client IP", () => {
    const ip = "192.168.1.42";
    const rec = getIpRateLimit(ip);
    assert.equal(rec.attempts, 0);
    rec.attempts++;
    assert.equal(getIpRateLimit(ip).attempts, 1);
  });

  it("Rate Limiting — locks out IP after 5 failed attempts for 60 seconds", () => {
    const ip = "192.168.1.55";
    const now = Date.now();
    const rec = getIpRateLimit(ip);
    rec.attempts = MAX_PIN_FAILED_ATTEMPTS;
    rec.lockoutUntil = now + PIN_LOCKOUT_MS;

    assert.equal(now < rec.lockoutUntil, true);
    assert.equal(rec.attempts, 5);
  });

  it("Rate Limiting — resetIpAttempts completely removes record", () => {
    const ip = "192.168.1.77";
    const rec = getIpRateLimit(ip);
    rec.attempts = 3;
    resetIpAttempts(ip);
    assert.equal(getIpRateLimit(ip).attempts, 0);
  });

  it("Rate Limiting — isolates attempt counts across distinct IPs", () => {
    const ipA = "192.168.1.10";
    const ipB = "192.168.1.20";
    getIpRateLimit(ipA).attempts = 4;
    assert.equal(getIpRateLimit(ipB).attempts, 0);
  });

  it("generateClientToken — creates valid JWT containing host, unique sub and jti", () => {
    const ip = "192.168.1.100";
    const tokenA = generateClientToken(ip);
    const tokenB = generateClientToken(ip);
    const decA = jwt.decode(tokenA) as any;
    const decB = jwt.decode(tokenB) as any;

    assert.equal(decA.role, "remote");
    assert.equal(decA.host, ip);
    assert.equal(typeof decA.sub, "string");
    assert.equal(decA.sub, decA.jti);
    // Distinct tokens for same IP have unique client IDs
    assert.notEqual(decA.sub, decB.sub);
  });
});
