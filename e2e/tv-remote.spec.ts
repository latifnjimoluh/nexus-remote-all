import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

/**
 * Test navigateur de bout en bout du module « tv-remote » (Hisense VIDAA).
 *
 * Chaîne vérifiée : vrai Chromium charge la PWA buildée → auto-connexion via
 * les paramètres d'URL (?host&ws&token) → clic réel sur l'onglet Hisense puis
 * sur les touches → la commande JSON correcte arrive sur le WebSocket.
 *
 * Le WebSocket est un serveur FACTICE qui enregistre les messages et acquitte
 * comme l'agent réel — AUCUNE action clavier/souris n'est exécutée sur la machine.
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

  // 1. Serveur statique de la PWA (avec repli SPA vers index.html).
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
      let filePath = join(DIST, urlPath === "/" ? "index.html" : urlPath);
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

test("la télécommande Hisense pilote les commandes jusqu'au WebSocket", async ({ page }) => {
  // Auto-connexion via paramètres d'URL (comme un QR Code scanné).
  await page.goto(
    `http://127.0.0.1:${HTTP_PORT}/?host=127.0.0.1&ws=${WS_PORT}&token=TESTTOKEN`,
  );

  // Handshake envoyé à l'ouverture du WebSocket.
  await expect
    .poll(() => received.some((m) => m.type === "client:hello"), { timeout: 7000 })
    .toBe(true);

  // Ouvre l'onglet « Hisense » puis attend le rendu du module.
  await page.getByRole("button", { name: /Hisense/i }).click();
  await expect(page.locator('[data-act="ok"]')).toBeVisible();

  // Clics réels sur les touches.
  await page.locator('[data-act="vol-up"]').click();
  // Flèche du D-pad : son centre géométrique chevauche le conteneur circulaire,
  // ce qui bloque le hit-test strict de Playwright. On dispatche le clic
  // directement sur l'élément (même handler délégué, cible = la flèche).
  await page.locator('[data-act="right"]').dispatchEvent("click");
  await page.locator('[data-act="num-5"]').click();
  await page.locator('[data-act="app-netflix"]').click();

  // Chaque clic a produit la bonne commande sur le fil.
  const has = (pred: (m: any) => boolean) =>
    expect.poll(() => received.some(pred), { timeout: 5000 }).toBe(true);

  await has((m) => m.type === "media:key" && m.key === "volup"); // VOL +
  await has((m) => m.type === "media:key" && m.key === "right"); // D-pad →
  await has((m) => m.type === "key:tap" && m.key === "Num5"); //    touche 5
  await has((m) => m.type === "launch:app" && m.target === "netflix"); // Netflix
});

test("un bouton placeholder n'envoie aucune commande (toast « à configurer »)", async ({ page }) => {
  await page.goto(
    `http://127.0.0.1:${HTTP_PORT}/?host=127.0.0.1&ws=${WS_PORT}&token=TESTTOKEN`,
  );
  await expect.poll(() => received.some((m) => m.type === "client:hello")).toBe(true);
  await page.getByRole("button", { name: /Hisense/i }).click();
  await expect(page.locator('[data-act="power"]')).toBeVisible();

  const before = received.length;
  await page.locator('[data-act="power"]').click(); // placeholder (cmd: null)
  await page.waitForTimeout(600);

  // Aucune nouvelle commande n'a été émise par un bouton non mappé.
  expect(received.length).toBe(before);
  await expect(page.locator(".tvr-toast.show")).toBeVisible();
});

test("le volet appareils réseau détecte les Smart TVs et bascule la télécommande", async ({ page }) => {
  await page.goto(
    `http://127.0.0.1:${HTTP_PORT}/?host=127.0.0.1&ws=${WS_PORT}&token=TESTTOKEN`,
  );
  await expect.poll(() => received.some((m) => m.type === "client:hello")).toBe(true);

  // 1. Ouvre le volet appareils réseau depuis le bouton d'en-tête
  await page.locator('[title*="Appareils"]').click();
  await expect(page.locator("#nexus-network-modal")).toBeVisible();
  await expect(page.getByText("Hisense VIDAA TV")).toBeVisible();

  // 2. Clique sur "Piloter" pour la Smart TV Hisense
  await page.locator(".net-action-btn", { hasText: "Piloter" }).click();
  await expect(page.locator("#nexus-network-modal")).not.toBeVisible();

  // 3. Vérifie que la télécommande est en mode TV sur Hisense VIDAA
  await expect(page.locator(".tvr-target-title")).toContainText("Hisense VIDAA TV");
  await expect(page.locator("#tvr-switch-btn")).toContainText("Mode PC");

  // 4. Clique sur Volume + : doit émettre tv:command vers la TV
  await page.locator('[data-act="vol-up"]').click();
  await expect
    .poll(
      () =>
        received.some(
          (m) => m.type === "tv:command" && m.targetIp === "192.168.1.194" && m.action === "volup",
        ),
      { timeout: 5000 },
    )
    .toBe(true);
});

