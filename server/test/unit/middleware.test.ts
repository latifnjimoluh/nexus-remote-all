import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { verifyToken, revokeToken, isTokenRevoked, requireAuth } from "../../src/auth/middleware.js";
import { CONFIG } from "../../src/config.js";

describe("middleware — JWT Verification, Token Revocation & requireAuth", () => {
  it("verifyToken — accepts valid HS256 JWT with remote role", () => {
    const token = jwt.sign({ role: "remote", host: "127.0.0.1" }, CONFIG.JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: "1h",
    });
    assert.equal(verifyToken(token), true);
  });

  it("verifyToken — rejects null, undefined, empty string, and malformed strings", () => {
    assert.equal(verifyToken(null), false);
    assert.equal(verifyToken(undefined), false);
    assert.equal(verifyToken(""), false);
    assert.equal(verifyToken("not-a-jwt"), false);
    assert.equal(verifyToken("a.b.c"), false);
  });

  it("verifyToken — rejects tokens signed with incorrect secret", () => {
    const forged = jwt.sign({ role: "remote" }, "forged-secret-key-1234", {
      algorithm: "HS256",
      expiresIn: "1h",
    });
    assert.equal(verifyToken(forged), false);
  });

  it("verifyToken — rejects tokens missing role: 'remote'", () => {
    const wrongRole = jwt.sign({ role: "guest" }, CONFIG.JWT_SECRET, { algorithm: "HS256" });
    const noRole = jwt.sign({ user: "nexus" }, CONFIG.JWT_SECRET, { algorithm: "HS256" });
    assert.equal(verifyToken(wrongRole), false);
    assert.equal(verifyToken(noRole), false);
  });

  it("verifyToken — rejects expired tokens", () => {
    const expired = jwt.sign({ role: "remote" }, CONFIG.JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: "-1s",
    });
    assert.equal(verifyToken(expired), false);
  });

  it("verifyToken — rejects tampered token signatures", () => {
    const valid = jwt.sign({ role: "remote" }, CONFIG.JWT_SECRET, { algorithm: "HS256" });
    const parts = valid.split(".");
    // Flip character in signature
    const tamperedSig = parts[2].slice(0, -1) + (parts[2].endsWith("A") ? "B" : "A");
    assert.equal(verifyToken(`${parts[0]}.${parts[1]}.${tamperedSig}`), false);
  });

  it("Token Revocation — revoking token string causes rejection in verifyToken", () => {
    const token = jwt.sign({ role: "remote", sub: "token-to-revoke-directly" }, CONFIG.JWT_SECRET, { algorithm: "HS256" });
    assert.equal(verifyToken(token), true);
    revokeToken(token);
    assert.equal(isTokenRevoked(token), true);
    assert.equal(verifyToken(token), false);
  });

  it("Token Revocation — revoking token cascades to jti and sub session claims", () => {
    const jti = "unique-jti-session-1";
    const sub = "unique-sub-device-1";
    const token = jwt.sign({ role: "remote", jti, sub }, CONFIG.JWT_SECRET, { algorithm: "HS256" });
    revokeToken(token);
    assert.equal(isTokenRevoked(jti), true);
    assert.equal(isTokenRevoked(sub), true);
    // A fresh token with the same jti is also rejected
    const freshToken = jwt.sign({ role: "remote", jti }, CONFIG.JWT_SECRET, { algorithm: "HS256" });
    assert.equal(verifyToken(freshToken), false);
  });

  it("requireAuth middleware — passes with Bearer token, returns 401 on missing or invalid", () => {
    const validToken = jwt.sign({ role: "remote", sub: "client-requireAuth-test" }, CONFIG.JWT_SECRET, { algorithm: "HS256" });

    // Scenario A: Valid Bearer Header
    let nextCalled = false;
    const reqA = { headers: { authorization: `Bearer ${validToken}` }, query: {} } as any;
    const resA = {
      status(code: number) { return this; },
      json() {},
    } as any;
    requireAuth(reqA, resA, () => { nextCalled = true; });
    assert.equal(nextCalled, true);

    // Scenario B: Missing Header & Query Token
    let statusCode = 0;
    let jsonBody: any = null;
    const reqB = { headers: {}, query: {} } as any;
    const resB = {
      status(code: number) { statusCode = code; return this; },
      json(body: any) { jsonBody = body; },
    } as any;
    requireAuth(reqB, resB, () => { assert.fail("next should not be called"); });
    assert.equal(statusCode, 401);
    assert.equal(jsonBody?.ok, false);

    // Scenario C: Malformed Token
    statusCode = 0;
    const reqC = { headers: { authorization: "Bearer invalid.jwt.token" }, query: {} } as any;
    requireAuth(reqC, resB, () => { assert.fail("next should not be called"); });
    assert.equal(statusCode, 401);
  });
});
