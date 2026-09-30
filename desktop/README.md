# 🖥️ Nexus Remote All — Application de bureau (Electron)

Logiciel Windows installable qui **embarque l'agent PC** (souris/clavier/système)
et affiche une **fenêtre d'appairage** (QR Code) pour connecter un smartphone.
Aucun prérequis : Node.js et toutes les dépendances sont inclus dans l'installeur.

## Ce que fait l'application

- Démarre l'agent Nexus en interne (HTTP `:4700`, WebSocket `:4701`, mDNS).
- Sert la PWA mobile sur le réseau local.
- Affiche une fenêtre avec le **QR Code d'appairage** + l'IP/port.
- Reste active dans la **barre système** quand on ferme la fenêtre.
- Option **« Démarrer au lancement de Windows »** (fenêtre / tray).

## Développement

Prérequis : avoir compilé le serveur et le client à la racine du dépôt.

```bash
# À la racine (une fois)
npm install
npm run build            # compile server + client + relay

# Lancer l'app de bureau en dev
npm run desktop          # = npm run dev -w desktop
```

`npm run desktop` copie automatiquement les bundles compilés
(`server/dist` → `desktop/agent-dist`, `client/dist` → `desktop/client-dist`)
puis démarre Electron.

## Construire l'installeur `.exe`

```bash
# À la racine : rebuild + packaging complet
npm run desktop:dist

# ou directement dans desktop/
npm run dist
```

Résultat : `desktop/release/Nexus Remote All Setup <version>.exe` (installeur NSIS).

## Notes techniques importantes

- **Module natif `nut-js`** : construit en **N-API** (ABI stable). Il fonctionne
  sous Electron **sans recompilation** → `npmRebuild` est désactivé dans la
  config `build` (pas d'`electron-rebuild` nécessaire).
- **`asar: false`** : les fichiers de l'app sont posés en clair sous
  `resources/app/` (l'agent est de l'ESM chargé dynamiquement — évite les
  incompatibilités du chargeur ESM avec les archives asar).
- **`agent-dist/package.json`** (`{ "type": "module" }`) est réécrit par
  `scripts/copy-assets.cjs` : la copie du bundle serveur perd le marqueur ESM,
  il faut le restaurer sinon Electron charge l'agent en CommonJS et échoue.
- **Version d'Electron épinglée** (`electron: "33.4.11"` + `electronVersion`
  dans `build`) : nécessaire car en monorepo npm les paquets sont *hoistés* et
  electron-builder ne sait pas déduire la version d'une plage `^`.
- **Garde-fou `allow-scripts`** sur la machine de build : certains scripts
  d'installation (téléchargement du binaire Electron, etc.) sont bloqués. Les
  autoriser avec `npm approve-scripts electron` si le binaire manque.
```
