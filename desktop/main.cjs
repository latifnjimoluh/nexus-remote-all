const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

app.setAppUserModelId("com.nexus.remoteall");

const LOG_FILE = path.join(process.env.APPDATA || os.tmpdir(), "nexus-remote-desktop.log");

function log(...args) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : a).join(" ")}\n`);
  } catch {}
  console.log(...args);
}

process.on("uncaughtException", (err) => {
  log("UNCAUGHT EXCEPTION:", err.stack || err);
});
process.on("unhandledRejection", (err) => {
  log("UNHANDLED REJECTION:", err);
});

// ─────────────────────────────────────────────────────────────
//  Chemins des bundles embarqués
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
let cachedPairing = null;

// Instance unique : empêche deux agents de se disputer les ports 4700/4701.
const gotLock = app.requestSingleInstanceLock();
log("Singleton lock result:", gotLock);

if (!gotLock) {
  log("Second instance detected, focusing existing window and quitting.");
  app.quit();
} else {
  app.on("second-instance", () => {
    log("Second instance requested, showing main window.");
    showWindow();
  });
  app.whenReady().then(bootstrap);
}

function bootstrap() {
  log("Bootstrapping Nexus Remote All application...");
  createWindow();
  createTray();
  bootstrapAgent();
}

async function bootstrapAgent() {
  log("Bootstrapping embedded agent in background...");
  try {
    const { startAgent } = await import(pathToFileURL(AGENT_ENTRY).href);
    const enableCloud = process.env.NEXUS_CLOUD !== "0";
    agent = await startAgent({ clientDist: CLIENT_DIST, log: true, enableCloud });
    log("Agent started successfully. IP:", agent.ip);
    refreshTrayMenu();

    if (agent.onClientsChange) {
      agent.onClientsChange((clients) => {
        log("Clients changed, count:", clients.length);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("nexus:clients-updated", clients);
        }
        refreshTrayMenu();
      });
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      const status = await getStatusPayload();
      mainWindow.webContents.send("nexus:status-updated", status);
    }
  } catch (err) {
    log("Échec du démarrage de l'agent :", err.stack || err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("nexus:status-updated", { ok: false, error: err.message });
    }
  }
}

function createWindow() {
  log("createWindow called");
  if (mainWindow && !mainWindow.isDestroyed()) {
    return showWindow();
  }

  try {
    mainWindow = new BrowserWindow({
      width: 780,
      height: 600,
      minWidth: 660,
      minHeight: 520,
      title: "Nexus Remote All",
      icon: ICON_PATH,
      backgroundColor: "#0a0b12",
      autoHideMenuBar: true,
      show: true,
      center: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    log("BrowserWindow instance created.");

    mainWindow.loadFile(UI_INDEX)
      .then(() => log("mainWindow.loadFile succeeded"))
      .catch((err) => log("mainWindow.loadFile failed:", err.stack || err));

    mainWindow.webContents.on("did-finish-load", () => {
      log("mainWindow webContents did-finish-load");
    });

    mainWindow.webContents.on("did-fail-load", (_e, errorCode, errorDescription) => {
      log("mainWindow webContents did-fail-load:", errorCode, errorDescription);
    });

    mainWindow.webContents.on("console-message", (_e, level, message) => {
      log("Renderer console:", message);
    });

    mainWindow.once("ready-to-show", () => {
      log("mainWindow ready-to-show");
      mainWindow.show();
      mainWindow.focus();
    });

    // Fermer la fenêtre = réduire dans la barre système (l'agent continue).
    mainWindow.on("close", (event) => {
      log("mainWindow close event, isQuitting:", isQuitting);
      if (!isQuitting) {
        event.preventDefault();
        mainWindow.hide();
        log("mainWindow hidden to tray");
      }
    });
  } catch (err) {
    log("CRITICAL error in createWindow:", err.stack || err);
  }
}

function showWindow() {
  log("showWindow called");
  if (!mainWindow || mainWindow.isDestroyed()) {
    return createWindow();
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  log("createTray called");
  try {
    let img = nativeImage.createFromPath(TRAY_PATH);
    if (!img.isEmpty()) {
      img = img.resize({ width: 16, height: 16 });
      tray = new Tray(img);
      tray.setToolTip("Nexus Remote All — Agent actif");
      refreshTrayMenu();
      tray.on("double-click", () => showWindow());
      log("Tray created successfully");
    } else {
      log("Tray icon empty, skipping tray creation");
    }
  } catch (err) {
    log("Warning: createTray failed:", err.message);
  }
}

function refreshTrayMenu() {
  if (!tray) return;
  try {
    const clients = agent && agent.getConnectedClients ? agent.getConnectedClients() : [];
    const count = clients.length;
    tray.setToolTip(`Nexus Remote All — ${count > 0 ? `${count} appareil(s) connecté(s)` : "Agent actif"}`);

    const autoLaunch = app.getLoginItemSettings().openAtLogin;
    const clientItems = count === 0
      ? [{ label: "Aucun appareil connecté", enabled: false }]
      : clients.map((c) => ({
          label: `📱 ${c.name || c.device} (${c.ip})`,
          enabled: false,
        }));

    const menu = Menu.buildFromTemplate([
      { label: "Ouvrir Nexus Remote All", click: () => showWindow() },
      {
        label: "Ouvrir la page d'appairage (navigateur)",
        enabled: !!agent,
        click: () => agent && shell.openExternal(agent.pairingDisplayUrl),
      },
      { type: "separator" },
      { label: `📱 Appareils connectés (${count}) :`, enabled: false },
      ...clientItems,
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
  } catch (err) {
    log("Warning: refreshTrayMenu failed:", err.message);
  }
}

function setAutoLaunch(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      args: ["--hidden"],
    });
  } catch (err) {
    log("Warning: setAutoLaunch failed:", err.message);
  }
}

// ─────────────────────────────────────────────────────────────
//  Pont IPC exposé au renderer (via preload.cjs)
// ─────────────────────────────────────────────────────────────
async function getStatusPayload() {
  if (!agent) {
    return { ok: false, booting: true, clients: [] };
  }
  if (!cachedPairing) {
    if (agent.getPairingInfo) {
      cachedPairing = await agent.getPairingInfo();
    } else if (agent.refreshPairing) {
      cachedPairing = await agent.refreshPairing();
    }
  }
  const clients = agent.getConnectedClients ? agent.getConnectedClients() : [];
  return {
    ok: true,
    ip: agent.ip,
    httpPort: agent.httpPort,
    wsPort: agent.wsPort,
    pairingDisplayUrl: agent.pairingDisplayUrl,
    pairing: cachedPairing,
    clients,
  };
}

ipcMain.handle("nexus:get-status", async () => {
  return await getStatusPayload();
});

ipcMain.handle("nexus:disconnect-client", (_e, id) => {
  if (agent && agent.disconnectClient) {
    agent.disconnectClient(id);
    return true;
  }
  return false;
});

ipcMain.handle("nexus:refresh-pairing", async () => {
  if (!agent) return { ok: false };
  cachedPairing = await agent.refreshPairing();
  refreshTrayMenu();
  return { ok: true, pairing: cachedPairing };
});

ipcMain.handle("nexus:get-autolaunch", () => {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
});

ipcMain.handle("nexus:set-autolaunch", (_e, enabled) => {
  setAutoLaunch(!!enabled);
  refreshTrayMenu();
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
});

ipcMain.handle("nexus:open-external", (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//.test(url)) shell.openExternal(url);
});

// Ne pas quitter quand toutes les fenêtres sont fermées : on vit dans le tray.
app.on("window-all-closed", (e) => {
  log("window-all-closed event");
  e.preventDefault();
});

app.on("before-quit", () => {
  log("before-quit event");
  isQuitting = true;
});

// Si lancé au démarrage de Windows avec --hidden, masquer la fenêtre.
if (process.argv.includes("--hidden")) {
  app.whenReady().then(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
      log("Started with --hidden, window hidden");
    }
  });
}
