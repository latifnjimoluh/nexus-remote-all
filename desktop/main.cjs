const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// ─────────────────────────────────────────────────────────────
//  Chemins des bundles embarqués (copiés par scripts/copy-assets.cjs)
// ─────────────────────────────────────────────────────────────
const AGENT_ENTRY = path.join(__dirname, "agent-dist", "server", "src", "agent.js");
const CLIENT_DIST = path.join(__dirname, "client-dist");
const UI_INDEX = path.join(__dirname, "ui", "index.html");
const ICON_PATH = path.join(__dirname, "assets", "icon.png");
const TRAY_PATH = path.join(__dirname, "assets", "tray.png");

let mainWindow = null;
let tray = null;
let agent = null; // handle renvoyé par startAgent()
let isQuitting = false;

// Instance unique : empêche deux agents de se disputer les ports 4700/4701.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.whenReady().then(bootstrap);
}

async function bootstrap() {
  try {
    // Import dynamique du module ESM de l'agent depuis un contexte CJS.
    const { startAgent } = await import(pathToFileURL(AGENT_ENTRY).href);
    const enableCloud = process.env.NEXUS_CLOUD !== "0";
    agent = await startAgent({ clientDist: CLIENT_DIST, log: true, enableCloud });
  } catch (err) {
    console.error("[Desktop] Échec du démarrage de l'agent :", err);
    // On affiche quand même la fenêtre pour signaler l'erreur.
  }

  createTray();
  createWindow();
}

function createWindow() {
  if (mainWindow) return showWindow();

  mainWindow = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 400,
    minHeight: 560,
    title: "Nexus Remote All",
    icon: ICON_PATH,
    backgroundColor: "#0a0a0f",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(UI_INDEX);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Fermer la fenêtre = réduire dans la barre système (l'agent continue).
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function showWindow() {
  if (!mainWindow) return createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  try {
    let img = nativeImage.createFromPath(TRAY_PATH);
    if (!img.isEmpty()) {
      img = img.resize({ width: 16, height: 16 });
      tray = new Tray(img);
      tray.setToolTip("Nexus Remote All — Agent actif");
      refreshTrayMenu();
      tray.on("double-click", () => showWindow());
    }
  } catch (err) {
    console.warn("[Desktop] Icône de barre des tâches non disponible :", err.message);
  }
}

function refreshTrayMenu() {
  if (!tray) return;
  const autoLaunch = app.getLoginItemSettings().openAtLogin;
  const menu = Menu.buildFromTemplate([
    { label: "Ouvrir Nexus Remote All", click: () => showWindow() },
    {
      label: "Ouvrir la page d'appairage (navigateur)",
      enabled: !!agent,
      click: () => agent && shell.openExternal(agent.pairingDisplayUrl),
    },
    { type: "separator" },
    {
      label: "Démarrer au lancement de Windows",
      type: "checkbox",
      checked: autoLaunch,
      click: (item) => {
        setAutoLaunch(item.checked);
        refreshTrayMenu();
      },
    },
    { type: "separator" },
    {
      label: "Quitter",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function setAutoLaunch(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    // Démarrage silencieux réduit dans la barre système.
    args: ["--hidden"],
  });
}

// ─────────────────────────────────────────────────────────────
//  Pont IPC exposé au renderer (via preload.cjs)
// ─────────────────────────────────────────────────────────────
ipcMain.handle("nexus:get-status", async () => {
  if (!agent) return { ok: false };
  const pairing = await agent.refreshPairing();
  return {
    ok: true,
    ip: agent.ip,
    httpPort: agent.httpPort,
    wsPort: agent.wsPort,
    pairingDisplayUrl: agent.pairingDisplayUrl,
    pairing,
  };
});

ipcMain.handle("nexus:refresh-pairing", async () => {
  if (!agent) return { ok: false };
  return { ok: true, pairing: await agent.refreshPairing() };
});

ipcMain.handle("nexus:get-autolaunch", () => app.getLoginItemSettings().openAtLogin);

ipcMain.handle("nexus:set-autolaunch", (_e, enabled) => {
  setAutoLaunch(!!enabled);
  refreshTrayMenu();
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle("nexus:open-external", (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//.test(url)) shell.openExternal(url);
});

// Ne pas quitter quand toutes les fenêtres sont fermées : on vit dans le tray.
app.on("window-all-closed", (e) => {
  e.preventDefault();
});

app.on("before-quit", () => {
  isQuitting = true;
});

// Si lancé au démarrage de Windows avec --hidden, ne pas montrer la fenêtre.
if (process.argv.includes("--hidden")) {
  app.whenReady().then(() => {
    if (mainWindow) mainWindow.hide();
  });
}
