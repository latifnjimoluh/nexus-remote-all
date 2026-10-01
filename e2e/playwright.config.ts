import { defineConfig, devices } from "@playwright/test";

/**
 * Config Playwright pour les tests navigateur de la PWA Nexus Remote All.
 * Les serveurs (statique + WS factice) sont démarrés dans le test lui-même
 * (voir tv-remote.spec.ts) pour pouvoir inspecter les commandes reçues.
 */
export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    screenshot: "only-on-failure",
  },
});
