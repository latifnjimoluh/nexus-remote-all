# Module TV Remote — intégration

Reproduction fidèle de la télécommande **Hisense VIDAA**. Module **isolé** :
styles `tvr-` injectés une seule fois, aucune dépendance croisée. Il ne modifie
aucun fichier existant tant que tu n'appliques pas les 2 lignes ci-dessous.

## Activer le module (2 modifications dans `client/src/app.ts`)

À faire **quand la session parallèle qui édite `app.ts` est au repos**, pour
éviter les conflits.

### 1. Ajouter l'import (près des autres `import … from "./modules/…"`)

```ts
import { renderTvRemote } from "./modules/tv-remote";
```

### 2. Ajouter (ou remplacer) une entrée dans le tableau `TABS`

Le tableau `TABS` liste les onglets du bas. Deux options :

**Option A — nouvel onglet dédié** (garde l'ancien module Média) :

```ts
const TABS = [
  { id: "trackpad", label: "Souris", icon: "🖱️", render: renderTrackpad },
  { id: "media", label: "TV / Média", icon: "📺", render: renderMedia },
  { id: "tv-remote", label: "Hisense", icon: "🛰️", render: renderTvRemote }, // ← ajout
  { id: "keyboard", label: "Clavier", icon: "⌨️", render: renderKeyboard },
  { id: "macrodeck", label: "Deck", icon: "🎛️", render: renderMacrodeck },
  { id: "slides", label: "Diapo", icon: "📊", render: renderSlides },
  { id: "power", label: "Système", icon: "⚡", render: renderPower },
];
```

**Option B — remplacer le module Média** par la télécommande Hisense :

```ts
  { id: "media", label: "TV / Média", icon: "📺", render: renderTvRemote }, // ← remplace renderMedia
```

C'est tout. Aucun autre câblage n'est nécessaire : `render(content)` reçoit son
conteneur et le module s'occupe du reste (styles + envoi des commandes).

## Mapping des touches → commandes PC

Tout le mappage est centralisé dans la constante `ACTIONS` (en haut de `index.ts`).
Modifie une seule ligne pour changer le comportement d'un bouton.

| Bouton | Commande | Effet PC |
|---|---|---|
| D-pad ▲▼◀▶ / OK | `media:key` up/down/left/right/ok | Flèches + Entrée |
| VOL ∧∨ / Muet | `media:key` volup/voldown/mute | Volume système |
| CH ∧∨ | `key:tap` PageUp/PageDown | Page précédente/suivante |
| 0–9 | `key:tap` Num0–Num9 | Saisie des chiffres |
| Lecture/Pause, Menu | `media:key` play/menu | Touches média |
| EXIT / ↩ / ↺ | Escape / Backspace / Alt+← | Quitter / effacer / précédent |
| Source | Win+P | Sélecteur d'affichage Windows |
| SUBTITLE | `key:tap` C | Sous-titres (YouTube/Netflix) |
| Netflix / YouTube / Browser / Media / Music | `launch:app` | Lance l'app/URL |

### Boutons « placeholders » (`cmd: null`)

Power, GUIDE, CH.LIST, boutons couleur, INFO, TXT, ALL, FREE : sans équivalent PC
évident. Ils affichent un toast « à configurer ». Assigne-leur une commande dans
`ACTIONS` quand tu veux les activer.

### Cibles `launch:app` à compléter côté serveur (optionnel)

`server/src/controllers/launcher.ts` possède une whitelist. **Prime Video**
(`primevideo`) n'y est pas encore : ajoute une ligne pour l'activer, sinon le
bouton est ignoré sans erreur.

```ts
// server/src/controllers/launcher.ts → const APPS
primevideo: "start https://www.primevideo.com",
```
