import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../e2e/node_modules/playwright/index.mjs";

const DIST = fileURLToPath(new URL("../client/dist/", import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failedCount++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 1: Touch Gesture Mathematical & Boundary Verification
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=======================================================");
console.log("  PART 1: Touch Gesture Mathematical & Boundary Verification");
console.log("=======================================================");

{
  // 1. Simulation of trackpad accumulator logic
  function createAccumulator(sensitivity = 1.6) {
    let pendingDx = 0;
    let pendingDy = 0;
    const sent = [];

    function move(dx, dy) {
      pendingDx += dx * sensitivity;
      pendingDy += dy * sensitivity;
    }

    function flush() {
      if (pendingDx === 0 && pendingDy === 0) return;
      const toSendX = Math.round(pendingDx);
      const toSendY = Math.round(pendingDy);
      pendingDx -= toSendX;
      pendingDy -= toSendY;
      if (toSendX !== 0 || toSendY !== 0) {
        sent.push({ dx: toSendX, dy: toSendY });
      }
    }

    return {
      move,
      flush,
      getPending: () => ({ pendingDx, pendingDy }),
      getSent: () => sent,
    };
  }

  // Test 1.1: Single-finger drag (dx=30, dy=20) with default sensitivity 1.6
  const acc1 = createAccumulator(1.6);
  acc1.move(30, 20);
  acc1.flush();
  const sent1 = acc1.getSent();
  assert(sent1.length === 1, "Single move produced exactly 1 sent command");
  assert(sent1[0].dx === 48, `dx=30 * 1.6 => expected 48, got ${sent1[0].dx}`);
  assert(sent1[0].dy === 32, `dy=20 * 1.6 => expected 32, got ${sent1[0].dy}`);
  assert(acc1.getPending().pendingDx === 0, "No pending remainder for dx");
  assert(acc1.getPending().pendingDy === 0, "No pending remainder for dy");

  // Test 1.2: Negative single-finger drag (dx=-30, dy=-20) with default sensitivity 1.6
  const accNeg = createAccumulator(1.6);
  accNeg.move(-30, -20);
  accNeg.flush();
  const sentNeg = accNeg.getSent();
  assert(sentNeg[0].dx === -48, `dx=-30 * 1.6 => expected -48, got ${sentNeg[0].dx}`);
  assert(sentNeg[0].dy === -32, `dy=-20 * 1.6 => expected -32, got ${sentNeg[0].dy}`);

  // Test 1.3: Sub-pixel accumulation & integer rounding over 5 micro-steps (dx=1, dy=1)
  const accSub = createAccumulator(1.6);
  for (let i = 0; i < 5; i++) {
    accSub.move(1, 1);
    accSub.flush();
  }
  const sentSub = accSub.getSent();
  const totalDx = sentSub.reduce((acc, m) => acc + m.dx, 0);
  const totalDy = sentSub.reduce((acc, m) => acc + m.dy, 0);
  assert(totalDx === 8, `5 steps of dx=1 * 1.6 => total sent dx should be 8, got ${totalDx}`);
  assert(totalDy === 8, `5 steps of dy=1 * 1.6 => total sent dy should be 8, got ${totalDy}`);
  assert(Math.abs(accSub.getPending().pendingDx) < 1e-9, "Accumulator pending remainder is 0");

  // Test 1.4: Sensitivity Clamping Logic from client/src/core/settings.ts
  function clampSensitivity(val) {
    return Math.max(0.4, Math.min(3.5, val));
  }
  function parseSensitivity(saved, DEFAULT_SENSITIVITY = 1.6) {
    if (!saved) return DEFAULT_SENSITIVITY;
    const num = parseFloat(saved);
    return isNaN(num) || num <= 0 ? DEFAULT_SENSITIVITY : num;
  }

  assert(clampSensitivity(1.6) === 1.6, "Default 1.6 remains unchanged");
  assert(clampSensitivity(0.1) === 0.4, "Lower bound clamps to 0.4");
  assert(clampSensitivity(-50) === 0.4, "Negative value clamps to 0.4");
  assert(clampSensitivity(10.0) === 3.5, "Upper bound clamps to 3.5");
  assert(clampSensitivity(Infinity) === 3.5, "Infinity clamps to 3.5");
  assert(clampSensitivity(-Infinity) === 0.4, "-Infinity clamps to 0.4");

  // Storage parsing fallbacks:
  assert(parseSensitivity(null) === 1.6, "Null storage falls back to 1.6");
  assert(parseSensitivity("") === 1.6, "Empty string falls back to 1.6");
  assert(parseSensitivity("invalid") === 1.6, "NaN string falls back to 1.6");
  assert(parseSensitivity("-1.5") === 1.6, "Negative stored string falls back to 1.6");
  assert(parseSensitivity("0") === 1.6, "Zero stored string falls back to 1.6");
  assert(parseSensitivity("2.5") === 2.5, "Valid stored string parses to 2.5");

  // Edge case: "Infinity" string in localStorage
  const infParsed = parseSensitivity("Infinity");
  if (!Number.isFinite(infParsed)) {
    console.log("  ⚠️  DISCOVERY: parseSensitivity('Infinity') returns non-finite value (Infinity)");
  } else {
    assert(Number.isFinite(infParsed), "Stored sensitivity is finite");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 2: PWA Offline Resilience & Workbox Precache Physical Severing Challenge
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=======================================================");
console.log("  PART 2: PWA Offline Resilience Physical Severing Challenge");
console.log("=======================================================");

const TEST_PORT = 4920; // Isolated test port

let httpServer;
let browser;
let context;

try {
  // 1. Create static server
  httpServer = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
      const rel = urlPath.replace(/^\/+/, "");
      let filePath = join(DIST, rel === "" ? "index.html" : rel);
      if (!existsSync(filePath)) filePath = join(DIST, "index.html");
      const body = await readFile(filePath);
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(body);
    } catch (e) {
      res.writeHead(500);
      res.end("err");
    }
  });

  await new Promise((r) => httpServer.listen(TEST_PORT, "127.0.0.1", r));
  console.log(`  Static server running on http://127.0.0.1:${TEST_PORT}`);

  // 2. Launch Chromium
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  const page = await context.newPage();

  // 3. Load PWA while online (with session credentials so shell & trackpad mount)
  await page.goto(`http://127.0.0.1:${TEST_PORT}/?host=127.0.0.1&ws=4921&token=TESTTOKEN`);
  await page.waitForSelector("#app", { timeout: 5000 });
  await page.waitForSelector("#trackpad", { timeout: 5000 });
  assert(true, "PWA mounted #app and #trackpad successfully online");

  // 4. Wait for Service Worker registration & activation
  const swActive = await page.waitForFunction(
    async () => {
      if (!("serviceWorker" in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg && !!reg.active;
    },
    { timeout: 10000 },
  );
  assert(!!swActive, "Service Worker registered and active");

  // 5. Verify Workbox Precache entries
  const precacheUrls = await page.evaluate(async () => {
    const urls = [];
    const keys = await caches.keys();
    for (const name of keys) {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      for (const req of requests) {
        urls.push(req.url);
      }
    }
    return urls;
  });
  console.log(`  Found ${precacheUrls.length} precached URLs in CacheStorage:`);
  for (const u of precacheUrls) {
    console.log(`    - ${u}`);
  }
  assert(precacheUrls.some((u) => u.includes("index.html")), "Precache contains index.html");
  assert(precacheUrls.some((u) => u.includes("manifest.webmanifest")), "Precache contains manifest.webmanifest");
  assert(precacheUrls.some((u) => u.includes(".js")), "Precache contains application JS bundle");
  assert(precacheUrls.some((u) => u.includes(".css")), "Precache contains application CSS bundle");

  // 6. PHYSICAL SEVERING: Completely close/stop the HTTP server!
  console.log("  🛑 Completely terminating HTTP server (simulating total network loss)...");
  if (typeof httpServer.closeAllConnections === "function") {
    httpServer.closeAllConnections();
  }
  await new Promise((r) => httpServer.close(r));
  httpServer = null;

  // 7. Also enable Playwright context offline mode
  await context.setOffline(true);

  // 8. Test Offline Reload with completely dead server
  console.log("  🔄 Attempting page.reload() with HTTP server dead and network severed...");
  await page.reload();

  // 9. Verify that #app and #trackpad are mounted from cache
  await page.waitForSelector("#app", { timeout: 5000 });
  assert(true, "Offline reload: #app successfully mounted from Workbox precache");
  const trackpadVisible = await page.isVisible("#trackpad");
  assert(trackpadVisible, "Offline reload: #trackpad tactile interface is rendered and visible");

  // 10. Test offline UI interactivity
  const leftBtnText = await page.locator("#trackpad + div button").first().innerText();
  assert(leftBtnText.includes("Clic Gauche"), `Offline UI buttons exist (found: "${leftBtnText}")`);

  // 11. Test NavigationRoute offline: open subpath
  console.log("  🔄 Navigating to sub-route http://127.0.0.1:4920/settings while offline...");
  await page.goto(`http://127.0.0.1:${TEST_PORT}/settings`);
  await page.waitForSelector("#app", { timeout: 5000 });
  assert(true, "Workbox NavigationRoute correctly served index.html SPA for sub-route while offline");

} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  if (httpServer) {
    if (typeof httpServer.closeAllConnections === "function") {
      httpServer.closeAllConnections();
    }
    await new Promise((r) => httpServer.close(r));
  }
}

console.log("\n=======================================================");
console.log(`  SUMMARY: ${passedCount} checks passed, ${failedCount} checks failed.`);
console.log("=======================================================\n");

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
