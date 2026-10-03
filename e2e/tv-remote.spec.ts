import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

/**
 * Suite de tests navigateur end-to-end (Playwright) pour Nexus Remote All.
 * Valide les interactions PWA réelles :
 * - Scenario 1 : Contrôles de la télécommande TV (touches média, chaînes, volume, D-pad 5 directions, combo source, muet, apps)
 * - Scenario 2 : Sécurité des placeholders télécommande (bouton Power sans émission WS, affichage toast)
 * - Scenario 3 : Boutons physiques virtuels du trackpad (Clic Gauche, Milieu, Clic Droit)
 * - Scenario 4 : Gestes tactiles trackpad (tap 1 doigt, tap 2 doigts, glisser 1 doigt avec sensibilité, défilement 2 doigts)
 * - Scenario 5 : Volet de découverte réseau, filtres et bascule de cible (PC Hôte <-> Smart TV Hisense VIDAA)
 * - Scenario 6 : Cache PWA hors-ligne, Service Worker Workbox et rechargement en mode offline
 */

const HTTP_PORT = 4810;
const WS_PORT = 4811;
const DIST = fileURLToPath(new URL("../client/dist/", import.meta.url));

const MIME: Record<string, string> = {
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

let httpServer: Server;
let wss: WebSocketServer;
/** Messages reçus par le WS factice (réinitialisé avant chaque test). */
let received: any[] = [];

test.beforeAll(async () => {
  if (!existsSync(join(DIST, "index.html"))) {
    throw new Error(
      `Bundle PWA introuvable dans ${DIST}. Lancez d'abord « npm run build -w client » à la racine.`,
    );
  }

  // 1. Serveur statique de la PWA (avec support mock API et repli SPA vers index.html).
  httpServer = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
      if (urlPath === "/pair/network-devices") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            devices: [
              { id: "127.0.0.1", name: "PC Nexus Test", ip: "127.0.0.1", type: "pc", isCurrent: true },
              { id: "192.168.1.194", name: "Hisense VIDAA TV", ip: "192.168.1.194", type: "tv", brand: "Hisense" },
            ],
          }),
        );
        return;
      }
      const rel = urlPath.replace(/^\/+/, "");
      let filePath = join(DIST, rel === "" ? "index.html" : rel);
      if (!existsSync(filePath)) filePath = join(DIST, "index.html");
      const body = await readFile(filePath);
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(500);
      res.end("err");
    }
  });
  await new Promise<void>((r) => httpServer.listen(HTTP_PORT, "127.0.0.1", r));

  // 2. WebSocket factice : enregistre + acquitte comme l'agent réel.
  wss = new WebSocketServer({ port: WS_PORT });
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      received.push(msg);
      // L'agent réel n'acquitte pas le handshake client:hello (fire-and-forget).
      if (msg.type !== "client:hello") {
        ws.send(JSON.stringify({ type: "ack", cmd: msg.type }));
      }
    });
  });
});

test.afterAll(async () => {
  await new Promise<void>((r) => httpServer.close(() => r()));
  await new Promise<void>((r) => wss.close(() => r()));
});

test.beforeEach(() => {
  received = [];
});

/** Helper pour vérifier de façon réactive la présence d'un message dans la file WS. */
function expectWsMessage(predicate: (m: any) => boolean, timeout = 5000) {
  return expect.poll(() => received.some(predicate), { timeout }).toBe(true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1 : Contrôles de la télécommande TV
// ─────────────────────────────────────────────────────────────────────────────
test("Scenario 1 (TV Remote Controls): Media keys, channels, volume, full 5-way D-pad, input source, mute, apps", async ({
  page,
}) => {
  await page.goto(
    `http://127.0.0.1:${HTTP_PORT}/?host=127.0.0.1&ws=${WS_PORT}&token=TESTTOKEN`,
  );
  await expectWsMessage((m) => m.type === "client:hello", 7000);

  // Bascule vers l'onglet télécommande Hisense
  await page.getByRole("button", { name: /Hisense/i }).click();
  await expect(page.locator('[data-act="ok"]')).toBeVisible();

  // 1. Contrôle Volume
  await page.locator('[data-act="vol-up"]').click();
  await expectWsMessage((m) => m.type === "media:key" && m.key === "volup");

  await page.locator('[data-act="vol-down"]').click();
  await expectWsMessage((m) => m.type === "media:key" && m.key === "voldown");

  // 2. Contrôle Chaînes
  await page.locator('[data-act="ch-up"]').click();
  await expectWsMessage((m) => m.type === "key:tap" && m.key === "PageUp");

  await page.locator('[data-act="ch-down"]').click();
  await expectWsMessage((m) => m.type === "key:tap" && m.key === "PageDown");

  // 3. D-pad 5 directions complet (up, down, left, right, ok)
  await page.locator('[data-act="up"]').dispatchEvent("click");
  await expectWsMessage((m) => m.type === "media:key" && m.key === "up");

  await page.locator('[data-act="down"]').dispatchEvent("click");
  await expectWsMessage((m) => m.type === "media:key" && m.key === "down");

  await page.locator('[data-act="left"]').dispatchEvent("click");
  await expectWsMessage((m) => m.type === "media:key" && m.key === "left");

  await page.locator('[data-act="right"]').dispatchEvent("click");
  await expectWsMessage((m) => m.type === "media:key" && m.key === "right");

  await page.locator('[data-act="ok"]').click();
  await expectWsMessage((m) => m.type === "media:key" && m.key === "ok");

  // 4. Source d'entrée (combo LeftSuper + P)
  await page.locator('[data-act="source"]').click();
  await expectWsMessage(
    (m) =>
      m.type === "key:combo" &&
      Array.isArray(m.keys) &&
      m.keys.includes("LeftSuper") &&
      m.keys.includes("P"),
  );

  // 5. Muet & Média (Lecture / Menu)
  await page.locator('[data-act="mute"]').click();
  await expectWsMessage((m) => m.type === "media:key" && m.key === "mute");

  await page.locator('[data-act="play"]').click();
  await expectWsMessage((m) => m.type === "media:key" && m.key === "play");

  await page.locator('[data-act="menu"]').click();
  await expectWsMessage((m) => m.type === "media:key" && m.key === "menu");

  // 6. Lanceurs d'applications rapides
  await page.locator('[data-act="app-netflix"]').click();
  await expectWsMessage((m) => m.type === "launch:app" && m.target === "netflix");

  await page.locator('[data-act="app-youtube"]').click();
  await expectWsMessage((m) => m.type === "launch:app" && m.target === "youtube");

  await page.locator('[data-act="app-prime"]').click();
  await expectWsMessage((m) => m.type === "launch:app" && m.target === "primevideo");

  await page.locator('[data-act="app-browser"]').click();
  await expectWsMessage((m) => m.type === "launch:app" && m.target === "chrome");
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2 : Sécurité des placeholders télécommande
// ─────────────────────────────────────────────────────────────────────────────
test("Scenario 2 (TV Remote Placeholder): Power button sends 0 WS commands, triggers toast", async ({
  page,
}) => {
  await page.goto(
    `http://127.0.0.1:${HTTP_PORT}/?host=127.0.0.1&ws=${WS_PORT}&token=TESTTOKEN`,
  );
  await expectWsMessage((m) => m.type === "client:hello");

  await page.getByRole("button", { name: /Hisense/i }).click();
  await expect(page.locator('[data-act="power"]')).toBeVisible();

  const countBefore = received.length;
  await page.locator('[data-act="power"]').click(); // placeholder non mappé
  await page.waitForTimeout(600);

  // Zéro nouvelle commande émise
  expect(received.length).toBe(countBefore);
  // Toast visible informant l'utilisateur
  await expect(page.locator(".tvr-toast.show")).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3 : Boutons physiques virtuels du trackpad
// ─────────────────────────────────────────────────────────────────────────────
test("Scenario 3 (Trackpad Physical Buttons): Clic Gauche, Milieu, Clic Droit", async ({
  page,
}) => {
  await page.goto(
    `http://127.0.0.1:${HTTP_PORT}/?host=127.0.0.1&ws=${WS_PORT}&token=TESTTOKEN`,
  );
  await expectWsMessage((m) => m.type === "client:hello");

  // Par défaut, l'application s'ouvre sur l'onglet Souris (renderTrackpad)
  await expect(page.locator("#trackpad")).toBeVisible();

  // 1. Bouton Clic Gauche -> { type: "mouse:click", button: "left" }
  await page.getByRole("button", { name: /Clic Gauche/i }).click();
  await expectWsMessage((m) => m.type === "mouse:click" && m.button === "left");

  // 2. Bouton Molette / Milieu -> { type: "mouse:click", button: "middle" }
  await page.getByRole("button", { name: /Milieu/i }).click();
  await expectWsMessage((m) => m.type === "mouse:click" && m.button === "middle");

  // 3. Bouton Clic Droit -> { type: "mouse:click", button: "right" }
  await page.getByRole("button", { name: /Clic Droit/i }).click();
  await expectWsMessage((m) => m.type === "mouse:click" && m.button === "right");
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4 : Gestes tactiles trackpad
// ─────────────────────────────────────────────────────────────────────────────
test("Scenario 4 (Trackpad Touch Gestures): Single/Two-finger tap, single-finger drag, two-finger scroll", async ({
  page,
}) => {
  await page.goto(
    `http://127.0.0.1:${HTTP_PORT}/?host=127.0.0.1&ws=${WS_PORT}&token=TESTTOKEN`,
  );
  await expectWsMessage((m) => m.type === "client:hello");
  await expect(page.locator("#trackpad")).toBeVisible();

  // 1. Tap 1 doigt (< 260ms, sans déplacement) -> Clic Gauche
  await page.evaluate(async () => {
    const pad = document.getElementById("trackpad")!;
    const rect = pad.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const t = new Touch({
      identifier: 1,
      target: pad,
      clientX: x,
      clientY: y,
      pageX: x,
      pageY: y,
    });
    pad.dispatchEvent(new TouchEvent("touchstart", {
      touches: [t],
      targetTouches: [t],
      changedTouches: [t],
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((r) => setTimeout(r, 40));
    pad.dispatchEvent(new TouchEvent("touchend", {
      touches: [],
      targetTouches: [],
      changedTouches: [t],
      bubbles: true,
      cancelable: true,
    }));
  });
  await expectWsMessage((m) => m.type === "mouse:click" && m.button === "left");

  // 2. Tap 2 doigts (< 260ms, sans déplacement) -> Clic Droit
  await page.evaluate(async () => {
    const pad = document.getElementById("trackpad")!;
    const rect = pad.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const t1 = new Touch({
      identifier: 1,
      target: pad,
      clientX: x,
      clientY: y,
      pageX: x,
      pageY: y,
    });
    const t2 = new Touch({
      identifier: 2,
      target: pad,
      clientX: x + 25,
      clientY: y,
      pageX: x + 25,
      pageY: y,
    });
    pad.dispatchEvent(new TouchEvent("touchstart", {
      touches: [t1, t2],
      targetTouches: [t1, t2],
      changedTouches: [t1, t2],
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((r) => setTimeout(r, 40));
    pad.dispatchEvent(new TouchEvent("touchend", {
      touches: [],
      targetTouches: [],
      changedTouches: [t1, t2],
      bubbles: true,
      cancelable: true,
    }));
  });
  await expectWsMessage((m) => m.type === "mouse:click" && m.button === "right");

  // 3. Glissement 1 doigt avec sensibilité par défaut 1.6x (dx=+30 -> 48, dy=+20 -> 32)
  await page.evaluate(async () => {
    const pad = document.getElementById("trackpad")!;
    const rect = pad.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const tStart = new Touch({
      identifier: 1,
      target: pad,
      clientX: x,
      clientY: y,
      pageX: x,
      pageY: y,
    });
    pad.dispatchEvent(new TouchEvent("touchstart", {
      touches: [tStart],
      targetTouches: [tStart],
      changedTouches: [tStart],
      bubbles: true,
      cancelable: true,
    }));

    const tMove = new Touch({
      identifier: 1,
      target: pad,
      clientX: x + 30,
      clientY: y + 20,
      pageX: x + 30,
      pageY: y + 20,
    });
    pad.dispatchEvent(new TouchEvent("touchmove", {
      touches: [tMove],
      targetTouches: [tMove],
      changedTouches: [tMove],
      bubbles: true,
      cancelable: true,
    }));

    pad.dispatchEvent(new TouchEvent("touchend", {
      touches: [],
      targetTouches: [],
      changedTouches: [tMove],
      bubbles: true,
      cancelable: true,
    }));
  });
  await expectWsMessage((m) => m.type === "mouse:move" && m.dx === 48 && m.dy === 32);

  // 4. Défilement à 2 doigts (dy=+28 dépasse le seuil de 7px -> 4 pas -> dy: -4)
  await page.evaluate(async () => {
    const pad = document.getElementById("trackpad")!;
    const rect = pad.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const t0Start = new Touch({
      identifier: 1,
      target: pad,
      clientX: x,
      clientY: y,
      pageX: x,
      pageY: y,
    });
    const t1Start = new Touch({
      identifier: 2,
      target: pad,
      clientX: x + 20,
      clientY: y,
      pageX: x + 20,
      pageY: y,
    });
    pad.dispatchEvent(new TouchEvent("touchstart", {
      touches: [t0Start, t1Start],
      targetTouches: [t0Start, t1Start],
      changedTouches: [t0Start, t1Start],
      bubbles: true,
      cancelable: true,
    }));

    const t0Move = new Touch({
      identifier: 1,
      target: pad,
      clientX: x,
      clientY: y + 28,
      pageX: x,
      pageY: y + 28,
    });
    const t1Move = new Touch({
      identifier: 2,
      target: pad,
      clientX: x + 20,
      clientY: y + 28,
      pageX: x + 20,
      pageY: y + 28,
    });
    pad.dispatchEvent(new TouchEvent("touchmove", {
      touches: [t0Move, t1Move],
      targetTouches: [t0Move, t1Move],
      changedTouches: [t0Move, t1Move],
      bubbles: true,
      cancelable: true,
    }));

    pad.dispatchEvent(new TouchEvent("touchend", {
      touches: [],
      targetTouches: [],
      changedTouches: [t0Move, t1Move],
      bubbles: true,
      cancelable: true,
    }));
  });
  await expectWsMessage((m) => m.type === "mouse:scroll" && m.dx === 0 && m.dy === -4);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5 : Volet de découverte réseau, filtres et bascule de cible
// ─────────────────────────────────────────────────────────────────────────────
test("Scenario 5 (Network Device Modal & Target Switching): Modal discovery, filtering, TV target switch and toggle back", async ({
  page,
}) => {
  await page.goto(
    `http://127.0.0.1:${HTTP_PORT}/?host=127.0.0.1&ws=${WS_PORT}&token=TESTTOKEN`,
  );
  await expectWsMessage((m) => m.type === "client:hello");

  // 1. Ouvre le volet appareils réseau depuis le bouton d'en-tête
  await page.locator('[title*="Appareils"]').click();
  const modal = page.locator("#nexus-network-modal");
  await expect(modal).toBeVisible();

  // 2. Vérification des onglets de filtrage (« Tous », « 🖥️ PC », « 📺 Smart TV »)
  const btnFilterAll = modal.locator('button[data-f="all"]');
  const btnFilterPc = modal.locator('button[data-f="pc"]');
  const btnFilterTv = modal.locator('button[data-f="tv"]');

  await expect(btnFilterAll).toContainText("Tous");
  await expect(btnFilterPc).toContainText("PC");
  await expect(btnFilterTv).toContainText("Smart TV");

  // Filtre PC uniquement
  await btnFilterPc.click();
  await expect(modal.getByText("PC Nexus Test")).toBeVisible();
  await expect(modal.getByText("Hisense VIDAA TV")).not.toBeVisible();

  // Filtre Smart TV uniquement
  await btnFilterTv.click();
  await expect(modal.getByText("Hisense VIDAA TV")).toBeVisible();
  await expect(modal.getByText("PC Nexus Test")).not.toBeVisible();

  // Retour à Tous
  await btnFilterAll.click();
  await expect(modal.getByText("PC Nexus Test")).toBeVisible();
  await expect(modal.getByText("Hisense VIDAA TV")).toBeVisible();

  // 3. Basculer vers la Smart TV Hisense VIDAA
  await modal.locator(".net-action-btn", { hasText: "Piloter" }).click();
  await expect(modal).not.toBeVisible();

  // Vérifier la mise à jour de la télécommande en mode Smart TV
  await expect(page.locator(".tvr-target-title")).toContainText("Hisense VIDAA TV");
  await expect(page.locator("#tvr-switch-btn")).toContainText("Mode PC");

  // 4. Clic Volume + : doit émettre tv:command vers l'IP de la TV
  await page.locator('[data-act="vol-up"]').click();
  await expectWsMessage(
    (m) =>
      m.type === "tv:command" &&
      m.targetIp === "192.168.1.194" &&
      m.action === "volup",
  );

  // 5. Basculer à nouveau vers le Mode PC hôte
  await page.locator("#tvr-switch-btn").click();
  await expect(page.locator(".tvr-target-title")).toContainText("PC Hôte");
  await expect(page.locator("#tvr-switch-btn")).toContainText("Mode TV");

  // Clic Volume + en mode PC : doit émettre media:key
  await page.locator('[data-act="vol-up"]').click();
  await expectWsMessage((m) => m.type === "media:key" && m.key === "volup");
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 6 : Cache PWA hors-ligne et Service Worker Workbox
// ─────────────────────────────────────────────────────────────────────────────
test("Scenario 6 (PWA Offline Caching & Service Worker): Manifest, SW registration, Workbox precache, true offline reload", async ({
  page,
  context,
}) => {
  // 1. Vérification du Web App Manifest
  const manifestRes = await page.request.get(
    `http://127.0.0.1:${HTTP_PORT}/manifest.webmanifest`,
  );
  expect(manifestRes.status()).toBe(200);
  const manifest = await manifestRes.json();
  expect(manifest.name).toBe("Nexus Remote All");
  expect(manifest.short_name).toBe("Nexus Remote");
  expect(manifest.display).toBe("standalone");

  // 2. Chargement de l'application
  await page.goto(
    `http://127.0.0.1:${HTTP_PORT}/?host=127.0.0.1&ws=${WS_PORT}&token=TESTTOKEN`,
  );
  await expectWsMessage((m) => m.type === "client:hello");
  await expect(page.locator("#app")).toBeVisible();

  // 3. Attente de l'enregistrement et de l'activation du Service Worker
  await page.waitForFunction(
    async () => {
      if (!("serviceWorker" in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg && !!reg.active;
    },
    { timeout: 10000 },
  );

  // 4. Vérification que le cache Workbox contient /index.html
  const precacheFound = await page.evaluate(async () => {
    const keys = await caches.keys();
    for (const name of keys) {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      for (const req of requests) {
        if (req.url.includes("index.html")) return true;
      }
    }
    return false;
  });
  expect(precacheFound).toBe(true);

  // 5. Simulation du mode véritablement hors-ligne (setOffline true) et rechargement de page
  await context.setOffline(true);
  try {
    await page.reload();
    // Le conteneur racine de l'application reste monté et visible grâce au cache Workbox
    await expect(page.locator("#app")).toBeVisible();
    await expect(page.locator("#trackpad")).toBeVisible();
  } finally {
    // Restauration du mode connecté
    await context.setOffline(false);
  }
});
