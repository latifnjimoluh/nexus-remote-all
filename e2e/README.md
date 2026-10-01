# Tests navigateur E2E (Playwright)

Pilote un vrai Chromium sur la PWA **buildée** et vérifie que les clics réels sur
la télécommande **Hisense VIDAA** produisent les bonnes commandes WebSocket.

Dossier **isolé** (hors workspaces npm) : il a son propre `node_modules`.

## Prérequis

Le bundle client doit être construit (le test sert `client/dist`) :

```bash
# à la racine du dépôt
npm run build -w client
```

## Installation (une fois)

```bash
cd e2e
npm install                 # installe @playwright/test + ws
npm run install:browser     # télécharge Chromium (≈130 Mo)
```

> ⚠️ Si la machine bloque les scripts d'install (`allow-scripts`), autorisez le
> téléchargement du navigateur : `npx playwright install chromium` directement,
> ou `npm approve-scripts @playwright/test`.

## Lancer les tests

```bash
cd e2e
npm test            # headless
npm run test:headed # pour voir le navigateur
```

## Ce que le scénario vérifie

`tv-remote.spec.ts` démarre lui-même :
- un **serveur statique** servant `client/dist` (port 4810),
- un **WebSocket factice** qui enregistre les messages et les acquitte comme
  l'agent réel — **aucune action clavier/souris n'est exécutée sur la machine**.

Puis, dans Chromium :
1. charge `/?host=127.0.0.1&ws=4811&token=TESTTOKEN` → auto-connexion (comme un QR scanné) ;
2. vérifie le handshake `client:hello` à l'ouverture du WebSocket ;
3. ouvre l'onglet **Hisense**, puis clique VOL +, D-pad →, touche 5, Netflix ;
4. assure que chaque clic a émis la commande exacte (`media:key` volup/right,
   `key:tap` Num5, `launch:app` netflix) ;
5. vérifie qu'un **bouton placeholder** (Power) n'émet **aucune** commande et
   affiche le toast « à configurer ».
