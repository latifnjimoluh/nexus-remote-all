# 🛠️ Guide de Développement Complet — Nexus Remote All

> Document de référence exhaustif : **toutes les étapes**, dans l'ordre, pour construire la suite Nexus Remote All depuis un dossier vide jusqu'à une PWA déployable et un serveur agent packagé.
>
> Ce guide est conçu pour être suivi **linéairement**. Chaque étape indique : *l'objectif*, *les commandes*, *le code clé*, et *le critère de validation* (« ✅ Fait quand… »).

---

## 📋 Table des matières

0. [Décisions techniques préalables](#0-décisions-techniques-préalables)
1. [Prérequis & installation de l'environnement](#1-prérequis--installation-de-lenvironnement)
2. [Initialisation du dépôt & structure du monorepo](#2-initialisation-du-dépôt--structure-du-monorepo)
3. [Phase 1 — Serveur Agent (backend)](#3-phase-1--serveur-agent-backend)
4. [Phase 2 — Interface PWA Core (frontend)](#4-phase-2--interface-pwa-core-frontend)
5. [Phase 3 — Modules avancés](#5-phase-3--modules-avancés)
6. [Phase 4 — Configuration PWA & Appairage sécurisé](#6-phase-4--configuration-pwa--appairage-sécurisé)
7. [Phase 5 — Extension passerelle Infrarouge ESP32](#7-phase-5--extension-passerelle-infrarouge-esp32)
8. [Tests, qualité & débogage](#8-tests-qualité--débogage)
9. [Packaging & déploiement](#9-packaging--déploiement)
10. [Checklist finale de livraison](#10-checklist-finale-de-livraison)

---

## 0. Décisions techniques préalables

Avant d'écrire une ligne de code, on fige les choix. Ces décisions conditionnent tout le reste.

| Décision | Choix retenu | Justification |
| :--- | :--- | :--- |
| **Langage backend** | **Node.js (TypeScript)** | Un seul langage front + back, écosystème `ws` mature, `nut.js` moderne. Alternative Python/FastAPI possible (voir Annexe). |
| **Contrôle OS** | **`@nut-tree-fork/nut-js`** | Successeur maintenu de `robotjs` (souris, clavier, écran). `robotjs` est abandonné. |
| **Frontend** | **Vite + TypeScript + Tailwind CSS** | Build ultra-rapide, HMR, PWA plugin disponible. |
| **PWA** | **`vite-plugin-pwa`** (Workbox) | Génère `manifest` + `service-worker` automatiquement. |
| **Transport** | **WebSocket** (commandes temps réel) + **HTTP/REST** (appairage, config) | Latence < 10 ms pour souris/clavier. |
| **Appairage** | **QR Code + token JWT court** | Scan → connexion pré-authentifiée. |
| **Découverte réseau** | **mDNS (`bonjour-service`)** | Le téléphone trouve le serveur sans saisir d'IP. |

> ⚠️ **Note plateforme** : `nut.js` nécessite des outils de build natifs.
> - **Windows** : « Desktop development with C++ » (Visual Studio Build Tools).
> - **macOS** : accorder les permissions *Accessibilité* + *Enregistrement de l'écran*.
> - **Linux** : `libxtst-dev`, `libpng++-dev`, serveur X (Wayland partiellement supporté).

---

## 1. Prérequis & installation de l'environnement

### 1.1 Logiciels à installer

```bash
# Node.js LTS (≥ 20) — vérifier
node -v      # doit afficher v20.x ou plus
npm -v

# Git
git --version
```

- **Node.js 20 LTS** : https://nodejs.org
- **Git** : https://git-scm.com
- **VS Code** (recommandé) + extensions : ESLint, Prettier, Tailwind CSS IntelliSense.
- **Windows uniquement** : Visual Studio Build Tools avec la charge « Développement Desktop en C++ ».

### 1.2 Outils de build natifs (Windows)

> ✅ **Vérifié empiriquement le 2026-09-30 sur cette machine (Node.js v24.19.0 LTS)** : `@nut-tree-fork/nut-js` s'installe via un **binaire précompilé (prebuild)** et fonctionne (lecture de la position curseur OK) **sans** VS Build Tools. → **Aucune compilation native requise dans notre configuration.**

Les VS Build Tools ne deviennent nécessaires **que si** un futur module natif ne fournit pas de prebuild pour ta version de Node. Dans ce cas seulement :

```powershell
# Via winget (recommandé) — installe le compilateur C++
winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools"
```

### 1.3 `mkcert` (requis au jalon v0.4 — voir DECISIONS.md D-04)

```powershell
winget install FiloSottile.mkcert   # ou : choco install mkcert
mkcert -install                     # installe la CA de confiance locale (une fois)
```

✅ **Fait quand** : `node -v` ≥ 20, `git --version` OK, et `@nut-tree-fork/nut-js` lit la position du curseur sans erreur (test déjà validé sur cette machine).

---

## 2. Initialisation du dépôt & structure du monorepo

### 2.1 Initialiser Git

```bash
cd D:/Formation/Project/remote
git init
```

### 2.2 Structure cible du projet

```
nexus-remote-all/
├── README.md
├── GUIDE_DEVELOPPEMENT.md
├── .gitignore
├── package.json                  # workspaces (monorepo)
│
├── server/                       # 🖥️ Serveur Agent (backend Node.js)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts              # point d'entrée : HTTP + WS + mDNS
│   │   ├── config.ts             # ports, constantes
│   │   ├── ws/
│   │   │   ├── server.ts         # serveur WebSocket
│   │   │   └── router.ts         # dispatch des commandes reçues
│   │   ├── controllers/
│   │   │   ├── mouse.ts          # nut.js : souris
│   │   │   ├── keyboard.ts       # nut.js : clavier + macros
│   │   │   ├── media.ts          # touches média/volume
│   │   │   ├── system.ts         # veille, arrêt, verrou, WoL
│   │   │   └── launcher.ts       # lancement d'apps
│   │   ├── auth/
│   │   │   ├── pairing.ts        # génération token + QR
│   │   │   └── middleware.ts     # vérification token
│   │   └── discovery/
│   │       └── mdns.ts           # publication du service
│   └── dist/                     # build compilé
│
├── client/                       # 📱 PWA (frontend)
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── index.html
│   ├── public/
│   │   ├── manifest.webmanifest
│   │   └── icons/                # icônes PWA (192, 512, maskable)
│   └── src/
│       ├── main.ts               # bootstrap
│       ├── app.ts                # shell + navigation onglets
│       ├── core/
│       │   ├── ws-client.ts      # connexion WebSocket + reconnexion
│       │   ├── haptics.ts        # navigator.vibrate
│       │   └── protocol.ts       # types de messages partagés
│       ├── modules/
│       │   ├── media/            # Module 1
│       │   ├── trackpad/         # Module 2
│       │   ├── keyboard/         # Module 3
│       │   ├── macrodeck/        # Module 4
│       │   ├── slides/           # Module 5
│       │   └── power/            # Module 6
│       └── styles/
│           └── index.css         # directives Tailwind
│
├── shared/                       # 🔗 Types partagés front/back
│   └── protocol.ts               # contrat de messages WS
│
└── firmware/                     # 📡 (Phase 5) ESP32
    └── nexus_ir_gateway.ino
```

### 2.3 `.gitignore`

```gitignore
node_modules/
dist/
.env
*.log
.DS_Store
build/
```

### 2.4 `package.json` racine (monorepo avec workspaces)

```json
{
  "name": "nexus-remote-all",
  "private": true,
  "version": "0.1.0",
  "workspaces": ["server", "client"],
  "scripts": {
    "dev:server": "npm run dev -w server",
    "dev:client": "npm run dev -w client",
    "dev": "concurrently \"npm:dev:server\" \"npm:dev:client\"",
    "build": "npm run build -w server && npm run build -w client"
  },
  "devDependencies": {
    "concurrently": "^9.0.0"
  }
}
```

✅ **Fait quand** : la structure de dossiers existe, `git status` fonctionne, `npm install` à la racine réussit.

---

## 3. Phase 1 — Serveur Agent (backend)

> **Objectif** : un serveur qui écoute en WebSocket, reçoit des commandes JSON et pilote réellement la souris, le clavier et le système de l'hôte.

### 3.1 Initialiser le package serveur

```bash
cd server
npm init -y
npm install ws express @nut-tree-fork/nut-js bonjour-service qrcode jsonwebtoken
npm install -D typescript @types/node @types/ws @types/express @types/qrcode @types/jsonwebtoken tsx
npx tsc --init
```

- `ws` : WebSocket serveur
- `express` : endpoints HTTP (appairage, santé)
- `@nut-tree-fork/nut-js` : contrôle souris/clavier/écran
- `bonjour-service` : mDNS
- `qrcode` : génération QR d'appairage
- `jsonwebtoken` : tokens d'authentification
- `tsx` : exécution TS en dev sans build

### 3.2 Contrat de protocole partagé (`shared/protocol.ts`)

C'est **la pièce maîtresse** : tout message échangé suit ce format.

```typescript
// shared/protocol.ts
export type Command =
  // Souris
  | { type: "mouse:move"; dx: number; dy: number }
  | { type: "mouse:click"; button: "left" | "right" | "middle" }
  | { type: "mouse:scroll"; dx: number; dy: number }
  | { type: "mouse:drag"; state: "start" | "end" }
  // Clavier
  | { type: "key:tap"; key: string }
  | { type: "key:combo"; keys: string[] }          // ex: ["LeftControl","C"]
  | { type: "key:text"; text: string }             // saisie/presse-papier
  // Média & TV
  | { type: "media:key"; key: MediaKey }
  // Système
  | { type: "system:action"; action: SystemAction }
  // Lanceur / macro deck
  | { type: "launch:app"; target: string }
  // Présentation
  | { type: "slide:next" } | { type: "slide:prev" }
  | { type: "slide:start" } | { type: "slide:end" } | { type: "slide:black" };

export type MediaKey =
  | "volup" | "voldown" | "mute"
  | "play" | "pause" | "stop" | "next" | "prev"
  | "up" | "down" | "left" | "right" | "ok"
  | "home" | "back" | "menu";

export type SystemAction =
  | "lock" | "sleep" | "restart" | "shutdown" | "wol";

export interface ServerMessage {
  type: "ack" | "error" | "state";
  payload?: unknown;
}
```

### 3.3 Configuration (`server/src/config.ts`)

```typescript
export const CONFIG = {
  HTTP_PORT: 4700,
  WS_PORT: 4701,
  JWT_SECRET: process.env.JWT_SECRET ?? "change-me-in-prod",
  TOKEN_TTL: "12h",
  SERVICE_NAME: "Nexus Remote All",
};
```

### 3.4 Contrôleur souris (`server/src/controllers/mouse.ts`)

```typescript
import { mouse, Point, Button, straightTo } from "@nut-tree-fork/nut-js";

mouse.config.mouseSpeed = 3000; // réactivité

export async function moveRelative(dx: number, dy: number) {
  const pos = await mouse.getPosition();
  await mouse.setPosition(new Point(pos.x + dx, pos.y + dy));
}

export async function click(button: "left" | "right" | "middle") {
  const map = { left: Button.LEFT, right: Button.RIGHT, middle: Button.MIDDLE };
  await mouse.click(map[button]);
}

export async function scroll(dx: number, dy: number) {
  if (dy) dy > 0 ? await mouse.scrollDown(dy) : await mouse.scrollUp(-dy);
  if (dx) dx > 0 ? await mouse.scrollRight(dx) : await mouse.scrollLeft(-dx);
}

export async function dragStart() { await mouse.pressButton(Button.LEFT); }
export async function dragEnd() { await mouse.releaseButton(Button.LEFT); }
```

### 3.5 Contrôleur clavier (`server/src/controllers/keyboard.ts`)

```typescript
import { keyboard, Key } from "@nut-tree-fork/nut-js";

// Table de correspondance nom → touche nut.js
const KEYMAP: Record<string, Key> = {
  Enter: Key.Enter, Escape: Key.Escape, Backspace: Key.Backspace,
  Tab: Key.Tab, Space: Key.Space, Delete: Key.Delete,
  LeftControl: Key.LeftControl, LeftAlt: Key.LeftAlt,
  LeftSuper: Key.LeftSuper, LeftShift: Key.LeftShift,
  C: Key.C, V: Key.V, Z: Key.Z, F5: Key.F5, F11: Key.F11, B: Key.B,
  ArrowUp: Key.Up, ArrowDown: Key.Down, ArrowLeft: Key.Left, ArrowRight: Key.Right,
  PageUp: Key.PageUp, PageDown: Key.PageDown,
};

export async function tap(name: string) {
  const k = KEYMAP[name];
  if (k) await keyboard.pressKey(k), await keyboard.releaseKey(k);
}

export async function combo(names: string[]) {
  const keys = names.map((n) => KEYMAP[n]).filter(Boolean) as Key[];
  for (const k of keys) await keyboard.pressKey(k);
  for (const k of [...keys].reverse()) await keyboard.releaseKey(k);
}

export async function typeText(text: string) {
  await keyboard.type(text);
}
```

### 3.6 Contrôleur système (`server/src/controllers/system.ts`)

```typescript
import { exec } from "node:child_process";
import { SystemAction } from "../../../shared/protocol";

// Commandes par OS (exemple Windows ; adapter pour macOS/Linux)
const WIN_CMDS: Partial<Record<SystemAction, string>> = {
  lock: "rundll32.exe user32.dll,LockWorkStation",
  sleep: "rundll32.exe powrprof.dll,SetSuspendState 0,1,0",
  restart: "shutdown /r /t 5",
  shutdown: "shutdown /s /t 5",
};

export function runSystem(action: SystemAction) {
  const cmd = WIN_CMDS[action];
  if (cmd) exec(cmd);
}
```

> ⚠️ `shutdown`/`restart` doivent **exiger une confirmation côté client** avant envoi.

### 3.7 Wake-on-LAN (`system.ts`, suite)

```typescript
import dgram from "node:dgram";

export function wakeOnLan(mac: string) {
  const bytes = mac.split(/[:-]/).map((h) => parseInt(h, 16));
  const magic = Buffer.concat([
    Buffer.alloc(6, 0xff),
    Buffer.concat(Array(16).fill(Buffer.from(bytes))),
  ]);
  const socket = dgram.createSocket("udp4");
  socket.on("listening", () => socket.setBroadcast(true));
  socket.send(magic, 0, magic.length, 9, "255.255.255.255", () => socket.close());
}
```

### 3.8 Routeur de commandes (`server/src/ws/router.ts`)

```typescript
import { Command } from "../../../shared/protocol";
import * as Mouse from "../controllers/mouse";
import * as Kbd from "../controllers/keyboard";
import * as Sys from "../controllers/system";

export async function handleCommand(cmd: Command) {
  switch (cmd.type) {
    case "mouse:move":   return Mouse.moveRelative(cmd.dx, cmd.dy);
    case "mouse:click":  return Mouse.click(cmd.button);
    case "mouse:scroll": return Mouse.scroll(cmd.dx, cmd.dy);
    case "mouse:drag":   return cmd.state === "start" ? Mouse.dragStart() : Mouse.dragEnd();
    case "key:tap":      return Kbd.tap(cmd.key);
    case "key:combo":    return Kbd.combo(cmd.keys);
    case "key:text":     return Kbd.typeText(cmd.text);
    case "system:action":return Sys.runSystem(cmd.action);
    // media, launch, slide … à câbler de la même façon
  }
}
```

### 3.9 Serveur WebSocket + HTTP (`server/src/index.ts`)

```typescript
import express from "express";
import { WebSocketServer } from "ws";
import { CONFIG } from "./config";
import { handleCommand } from "./ws/router";
import { verifyToken } from "./auth/middleware";
import { publishService } from "./discovery/mdns";
import { pairingRouter } from "./auth/pairing";

// --- HTTP (appairage, santé) ---
const app = express();
app.use(express.json());
app.get("/health", (_, res) => res.json({ ok: true }));
app.use("/pair", pairingRouter);
app.listen(CONFIG.HTTP_PORT, () =>
  console.log(`HTTP  → http://0.0.0.0:${CONFIG.HTTP_PORT}`)
);

// --- WebSocket (commandes temps réel) ---
const wss = new WebSocketServer({ port: CONFIG.WS_PORT });
wss.on("connection", (ws, req) => {
  const token = new URL(req.url ?? "", "http://x").searchParams.get("token");
  if (!verifyToken(token)) return ws.close(4001, "unauthorized");

  ws.on("message", async (raw) => {
    try {
      const cmd = JSON.parse(raw.toString());
      await handleCommand(cmd);
      ws.send(JSON.stringify({ type: "ack" }));
    } catch (e) {
      ws.send(JSON.stringify({ type: "error", payload: String(e) }));
    }
  });
});
console.log(`WS    → ws://0.0.0.0:${CONFIG.WS_PORT}`);

publishService();
```

### 3.10 Scripts `server/package.json`

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

✅ **Fait quand** : `npm run dev -w server` démarre, et un client WS de test (ex. extension navigateur ou `wscat`) qui envoie `{"type":"mouse:move","dx":50,"dy":0}` **déplace réellement le curseur**.

---

## 4. Phase 2 — Interface PWA Core (frontend)

> **Objectif** : le shell tactile Dark Mode avec navigation par onglets + les 3 premiers modules (Média, Trackpad, Clavier) connectés au serveur.

### 4.1 Initialiser le client Vite

> ✅ **Implémenté le 2026-09-30 avec Tailwind CSS v4** (et non v3). La v4 supprime `tailwind.config.js`, `postcss`/`autoprefixer` et les directives `@tailwind` au profit d'un plugin Vite officiel + configuration du thème directement en CSS.

```bash
npm install -D -w @nexus/client vite typescript @tailwindcss/vite tailwindcss
```

### 4.2 Configurer Tailwind (v4 — plugin Vite + `@theme`)

`vite.config.ts` :
```typescript
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  server: { host: true, fs: { allow: [".."] } }, // LAN + accès dossier shared/
});
```

`src/styles/index.css` (le thème se déclare en CSS via `@theme`) :
```css
@import "tailwindcss";

@theme {
  --color-nexus-bg: #0a0a0f;
  --color-nexus-panel: #15151f;
  --color-nexus-accent: #6d5efc;
}

body { @apply bg-nexus-bg text-white select-none; touch-action: manipulation; }

@layer components {
  .btn { @apply bg-nexus-panel active:bg-nexus-accent rounded-2xl p-4 text-center transition; }
}
```

> ⚠️ **TypeScript 7** : l'option `baseUrl` a été supprimée. Pour les alias (`@shared/*`), utiliser uniquement `paths` dans `tsconfig.json`, sans `baseUrl`.

### 4.3 Client WebSocket avec reconnexion (`src/core/ws-client.ts`)

```typescript
import type { Command } from "../../../shared/protocol";

let socket: WebSocket | null = null;
let queue: Command[] = [];

export function connect(host: string, port: number, token: string) {
  socket = new WebSocket(`wss://${host}:${port}?token=${token}`); // wss:// (TLS) — voir DECISIONS.md D-04
  socket.onopen = () => { queue.forEach(send); queue = []; };
  socket.onclose = () => setTimeout(() => connect(host, port, token), 1000); // auto-reconnect
}

export function send(cmd: Command) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(cmd));
  else queue.push(cmd); // file d'attente si déconnecté
}
```

### 4.4 Retour haptique (`src/core/haptics.ts`)

```typescript
export function buzz(ms = 15) {
  if ("vibrate" in navigator) navigator.vibrate(ms);
}
```

### 4.5 Shell + navigation par onglets (`src/app.ts`)

```typescript
import { renderMedia } from "./modules/media";
import { renderTrackpad } from "./modules/trackpad";
import { renderKeyboard } from "./modules/keyboard";

const TABS = [
  { id: "media", label: "📺 TV", render: renderMedia },
  { id: "trackpad", label: "🖱️ Souris", render: renderTrackpad },
  { id: "keyboard", label: "⌨️ Clavier", render: renderKeyboard },
];

export function mountApp(root: HTMLElement) {
  const content = document.createElement("div");
  content.className = "flex-1 overflow-auto p-4";
  const nav = document.createElement("nav");
  nav.className = "flex gap-1 bg-nexus-panel p-2";

  const show = (tab: typeof TABS[number]) => {
    content.innerHTML = "";
    tab.render(content);
  };

  TABS.forEach((tab) => {
    const b = document.createElement("button");
    b.className = "btn flex-1 text-sm";
    b.textContent = tab.label;
    b.onclick = () => show(tab);
    nav.appendChild(b);
  });

  root.className = "h-screen flex flex-col";
  root.append(content, nav);
  show(TABS[0]);
}
```

### 4.6 Module 2 — Trackpad (le plus technique)

```typescript
// src/modules/trackpad/index.ts
import { send } from "../../core/ws-client";
import { buzz } from "../../core/haptics";

export function renderTrackpad(root: HTMLElement) {
  const pad = document.createElement("div");
  pad.className = "btn h-2/3 w-full touch-none";
  pad.textContent = "Zone tactile";

  let last: { x: number; y: number } | null = null;
  let moved = false;
  let touchStart = 0;

  pad.addEventListener("touchstart", (e) => {
    last = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    moved = false;
    touchStart = Date.now();
  });

  pad.addEventListener("touchmove", (e) => {
    if (!last) return;
    const t = e.touches[0];
    const dx = t.clientX - last.x;
    const dy = t.clientY - last.y;
    if (e.touches.length === 2) {
      send({ type: "mouse:scroll", dx: 0, dy: Math.round(dy / 3) }); // 2 doigts = scroll
    } else {
      send({ type: "mouse:move", dx: Math.round(dx * 1.5), dy: Math.round(dy * 1.5) });
    }
    last = { x: t.clientX, y: t.clientY };
    moved = true;
  });

  pad.addEventListener("touchend", (e) => {
    const wasTwoFingers = e.changedTouches.length >= 1 && (e as any).__two;
    if (!moved && Date.now() - touchStart < 200) {
      buzz();
      send({ type: "mouse:click", button: "left" }); // tap = clic gauche
    }
    last = null;
  });

  // Barre d'actions
  const bar = document.createElement("div");
  bar.className = "flex gap-2 mt-4";
  (["left", "middle", "right"] as const).forEach((btn) => {
    const b = document.createElement("button");
    b.className = "btn flex-1";
    b.textContent = btn === "left" ? "Clic G" : btn === "right" ? "Clic D" : "Molette";
    b.onclick = () => { buzz(); send({ type: "mouse:click", button: btn }); };
    bar.appendChild(b);
  });

  root.append(pad, bar);
}
```

### 4.7 Modules 1 (Média) et 3 (Clavier)

- **Média** : grille de boutons envoyant `{ type: "media:key", key }` (D-Pad, volume, lecteur, pavé numérique).
- **Clavier** : un `<input>` masqué qui capte la saisie native → `key:text` ; plus une rangée de boutons macro (`Ctrl+C`, `Alt+Tab`, etc.) → `key:combo`.

Chaque bouton appelle `buzz()` puis `send(...)`.

✅ **Fait quand** : depuis le téléphone (même Wi-Fi), les 3 modules pilotent réellement le PC — curseur fluide, volume, saisie de texte.

---

## 5. Phase 3 — Modules avancés

### 5.1 Module 4 — Macro Deck / Lanceur

- Grille configurable (données en `localStorage` : `{ icon, label, action }`).
- Actions : `launch:app` (Chrome, Steam, VLC…), captures, mute micro, plein écran.
- Côté serveur, `launcher.ts` mappe les cibles vers des chemins/commandes par OS :

```typescript
const APPS: Record<string, string> = {
  chrome: "start chrome",
  vlc: "start vlc",
  youtube: "start https://youtube.com",
};
export function launch(target: string) {
  const cmd = APPS[target];
  if (cmd) exec(cmd, { shell: "cmd.exe" });
}
```

### 5.2 Module 5 — Présentation

- Deux gros boutons `Suivant` / `Précédent` → `slide:next` / `slide:prev` (mappés F5/flèches/Échap côté serveur).
- **Chronomètre & compte à rebours** entièrement côté client (pas de réseau).
- Vibration d'alerte configurable (ex. `navigator.vibrate([200,100,200])` à T-5 min).

### 5.3 Module 6 — Énergie & Système

- Boutons `Verrouiller`, `Veille`, `Redémarrer`, `Arrêter` → `system:action`.
- **Confirmation obligatoire** (modale) avant `restart`/`shutdown`.
- **Wake-on-LAN** : champ MAC stocké, bouton « Réveiller le PC » → `system:action: "wol"`.

✅ **Fait quand** : les 6 modules sont fonctionnels et la navigation entre onglets est fluide.

---

## 6. Phase 4 — Configuration PWA & Appairage sécurisé

### 6.1 Appairage côté serveur (`server/src/auth/pairing.ts`)

```typescript
import { Router } from "express";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import { CONFIG } from "../config";

export const pairingRouter = Router();

// Génère un token + un QR contenant l'URL de la PWA pré-remplie
pairingRouter.get("/qr", async (_req, res) => {
  const token = jwt.sign({ role: "remote" }, CONFIG.JWT_SECRET, { expiresIn: CONFIG.TOKEN_TTL });
  const ip = getLocalIp(); // helper à écrire (os.networkInterfaces)
  const url = `https://${ip}:5173/?host=${ip}&ws=${CONFIG.WS_PORT}&token=${token}`; // https:// — voir DECISIONS.md D-04
  const qr = await QRCode.toDataURL(url);
  res.json({ url, qr });
});
```

Au démarrage du serveur, **afficher l'URL + le QR dans la console** (via `qrcode-terminal`) pour un appairage immédiat.

### 6.2 Vérification du token (`server/src/auth/middleware.ts`)

```typescript
import jwt from "jsonwebtoken";
import { CONFIG } from "../config";

export function verifyToken(token: string | null): boolean {
  if (!token) return false;
  try { jwt.verify(token, CONFIG.JWT_SECRET); return true; }
  catch { return false; }
}
```

### 6.3 mDNS (`server/src/discovery/mdns.ts`)

```typescript
import { Bonjour } from "bonjour-service";
import { CONFIG } from "../config";

export function publishService() {
  new Bonjour().publish({
    name: CONFIG.SERVICE_NAME,
    type: "nexusremote",
    port: CONFIG.HTTP_PORT,
  });
}
```

### 6.4 Manifest PWA (`client/public/manifest.webmanifest`)

```json
{
  "name": "Nexus Remote All",
  "short_name": "Nexus Remote",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0a0a0f",
  "theme_color": "#6d5efc",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### 6.5 Service Worker via `vite-plugin-pwa` (`client/vite.config.ts`)

```typescript
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: { host: true },              // exposer sur le réseau local
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      manifest: false,                  // on utilise notre manifest.webmanifest
      workbox: { globPatterns: ["**/*.{js,css,html,png,svg}"] },
    }),
  ],
});
```

### 6.6 Écran d'appairage côté client

- Au 1er lancement : lire `host`, `ws`, `token` depuis l'URL (issus du QR) → stocker en `localStorage` → `connect()`.
- Sinon : afficher un écran « Scannez le QR affiché sur le PC » ou saisie manuelle IP + PIN.

✅ **Fait quand** : scanner le QR ouvre la PWA déjà connectée ; « Ajouter à l'écran d'accueil » installe l'app ; elle se relance hors-ligne (shell en cache).

---

## 7. Phase 5 — Extension passerelle Infrarouge ESP32 (optionnelle)

> **Objectif** : relayer des commandes vers TV classiques, climatiseurs, amplis via IR.

### 7.1 Matériel
- ESP32 (DevKit).
- LED IR + transistor (émission), récepteur IR TSOP38238 (pour apprendre les codes).

### 7.2 Environnement
- Arduino IDE ou PlatformIO.
- Bibliothèque **`IRremoteESP8266`**.

### 7.3 Principe
1. L'ESP32 se connecte au Wi-Fi local et expose un endpoint HTTP (ou rejoint le serveur en WebSocket).
2. Le serveur Node relaie les commandes `ir:send` reçues de la PWA vers l'ESP32.
3. L'ESP32 émet le code IR appris correspondant.

### 7.4 Squelette firmware (`firmware/nexus_ir_gateway.ino`)

```cpp
#include <WiFi.h>
#include <WebServer.h>
#include <IRsend.h>

const uint16_t IR_LED = 4;
IRsend irsend(IR_LED);
WebServer server(80);

void handleSend() {
  uint64_t code = strtoull(server.arg("code").c_str(), nullptr, 16);
  irsend.sendNEC(code, 32);            // adapter au protocole de l'appareil
  server.send(200, "text/plain", "OK");
}

void setup() {
  irsend.begin();
  WiFi.begin("SSID", "PASSWORD");
  while (WiFi.status() != WL_CONNECTED) delay(300);
  server.on("/ir", handleSend);        // GET /ir?code=0x20DF10EF
  server.begin();
}

void loop() { server.handleClient(); }
```

✅ **Fait quand** : un appui dans la PWA éteint/allume une TV classique via l'ESP32.

---

## 8. Tests, qualité & débogage

### 8.1 Qualité de code
```bash
npm install -D eslint prettier
npx eslint --init
```
- Prettier + ESLint sur `server` et `client`.
- `tsc --noEmit` en pré-commit (via `husky` optionnel).

### 8.2 Tests
- **Unitaires** (Vitest) : le routeur de commandes, la génération WoL, le mapping clavier.
- **Manuels** : checklist par module (curseur, scroll, drag, chaque macro).
- **Latence** : mesurer l'aller-retour `send → ack` (objectif < 10 ms en local).

### 8.3 Débogage courant
| Symptôme | Cause probable | Solution |
| :--- | :--- | :--- |
| `nut.js` ne compile pas | Outils natifs manquants | Installer VS Build Tools / libxtst-dev |
| Souris ne bouge pas (macOS) | Permissions | Autoriser Accessibilité dans Réglages |
| Téléphone ne trouve pas le PC | Pare-feu / mDNS bloqué | Ouvrir ports 4700/4701/5173, saisir IP manuellement |
| WS se déconnecte | Veille Wi-Fi mobile | Auto-reconnexion (déjà gérée) + `keep-alive` ping |

---

## 9. Packaging & déploiement

### 9.1 Build production
```bash
npm run build            # compile server (tsc) + client (vite build)
```
- `client/dist/` : fichiers statiques de la PWA.
- `server/dist/` : serveur compilé.

### 9.2 Servir la PWA depuis le serveur agent
Faire servir `client/dist` par Express (`app.use(express.static(...))`) → **un seul processus** à lancer, PWA + WS ensemble.

### 9.3 Exécutable autonome (confort utilisateur)
- **`pkg`** ou **`nexe`** : empaqueter le serveur Node en `.exe` Windows.
- **Lancement au démarrage** : raccourci dans `shell:startup` (Windows) / `launchd` (macOS).
- Afficher automatiquement le QR au lancement.

### 9.4 HTTPS local — OBLIGATOIRE pour la PWA (voir `DECISIONS.md` D-04)
- Un **service worker** (PWA installable + hors-ligne) ne s'enregistre **que** dans un contexte sécurisé : `localhost` ou `https://`. Sur une IP LAN en `http://`, il est **refusé**.
- **Solution retenue : `mkcert`** (autorité de confiance locale, zéro avertissement) :
  ```bash
  mkcert -install                       # une fois : installe la CA locale
  mkcert 192.168.1.x localhost          # génère cert.pem + key.pem pour l'IP de l'hôte
  ```
- Le serveur agent écoute alors en **HTTPS** (`node:https`) et le WebSocket devient **`wss://`** (une page `https://` ne peut pas ouvrir un `ws://` non sécurisé → *mixed content* bloqué).
- Le QR d'appairage pointe vers `https://192.168.1.x:...`.

✅ **Fait quand** : double-clic sur l'exécutable → QR affiché → scan → contrôle total du PC.

---

## 10. Checklist finale de livraison

**Backend**
- [ ] Serveur WS + HTTP démarre sans erreur
- [ ] Souris : move / click (G/D/molette) / scroll / drag
- [ ] Clavier : tap / combos / saisie texte / presse-papier
- [ ] Média : D-Pad, volume, lecteur, pavé numérique
- [ ] Système : lock / veille / restart / shutdown (avec confirmation) / WoL
- [ ] Lanceur d'applications
- [ ] Authentification par token vérifiée sur chaque connexion WS
- [ ] mDNS publie le service

**Frontend PWA**
- [ ] 6 modules fonctionnels
- [ ] Navigation par onglets fluide, Dark Mode
- [ ] Retour haptique sur les actions
- [ ] Reconnexion WebSocket automatique
- [ ] `manifest` + `service-worker` → installable + hors-ligne
- [ ] Écran d'appairage QR / PIN

**Sécurité**
- [ ] Token expirant, secret non par défaut en prod
- [ ] Confirmation sur actions destructrices
- [ ] Commandes refusées sans token valide

**Distribution**
- [ ] Build production OK
- [ ] Exécutable autonome + lancement au démarrage
- [ ] README d'installation utilisateur final

---

## 📎 Annexe — Alternative Backend Python (FastAPI)

Si le choix se porte sur Python plutôt que Node.js :

```bash
pip install fastapi uvicorn websockets pyautogui zeroconf qrcode pyjwt
```
- `pyautogui` remplace `nut.js` (souris/clavier).
- `websockets` / FastAPI `WebSocket` remplace `ws`.
- `zeroconf` remplace `bonjour-service` (mDNS).
- Le **contrat de protocole JSON reste identique** → le frontend ne change pas.

---

## 🧭 Ordre de travail recommandé (résumé)

1. Décisions (§0) → Environnement (§1) → Structure (§2)
2. **Serveur : souris d'abord** (§3.4) — c'est la boucle de feedback la plus gratifiante
3. Clavier + système (§3.5–3.7)
4. Client : WS + trackpad (§4.3, §4.6) — premier vrai test bout-en-bout
5. Modules média + clavier UI (§4.7)
6. Modules avancés (§5)
7. Appairage + PWA installable (§6)
8. Tests & packaging (§8, §9)
9. ESP32 en bonus (§7)

> 💡 **Conseil** : ne pas attendre d'avoir tout fini pour tester sur téléphone. Dès la §4.6, testez le trackpad sur mobile réel — c'est là que se joue la sensation de latence.
