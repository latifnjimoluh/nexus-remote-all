# 📌 Décisions Techniques — Nexus Remote All (§0)

> Registre des décisions d'architecture (ADR) figées avant le développement.
> Date de figement : **2026-09-30**. Toute modification ultérieure doit être ajoutée en bas dans « Historique des révisions ».

---

## 🎯 Décisions validées

| # | Sujet | Décision retenue | Statut |
| :--- | :--- | :--- | :--- |
| D-01 | **Backend serveur agent** | **Node.js + TypeScript** | ✅ Figé |
| D-02 | **OS cible piloté (v1)** | **Windows uniquement** | ✅ Figé |
| D-03 | **Périmètre global** | **Complet — Modules 1 à 6 + PWA + Appairage + Passerelle IR ESP32** | ✅ Figé (objectif) |
| D-04 | **Contexte sécurisé / PWA** | **HTTPS local via `mkcert` + WebSocket `wss://`** | ✅ Figé |
| D-05 | **Stratégie de livraison** | **Incrémentale — 5 jalons (v0.1 → v1.0)** | ✅ Figé |

---

## D-01 — Backend : Node.js + TypeScript

**Décision** : le serveur agent est développé en **Node.js avec TypeScript**.

**Conséquences concrètes :**
- Contrôle OS via **`@nut-tree-fork/nut-js`** (successeur maintenu de `robotjs`).
- WebSocket via **`ws`**, HTTP via **`express`**.
- **Types de protocole partagés** entre `server/` et `client/` (mêmes fichiers `.ts` dans `shared/`).
- Monorepo npm workspaces : un seul langage front + back.

**Alternative écartée** : Python + FastAPI (`pyautogui`). Écartée car elle imposerait 2 langages et empêcherait le partage direct des types. *Le contrat JSON restant identique, un portage Python resterait possible sans toucher au frontend.*

---

## D-02 — OS cible : Windows uniquement (v1)

**Décision** : la couche système est écrite **pour Windows d'abord**. Environnement de développement : Windows 11.

**Conséquences concrètes :**
- `server/src/controllers/system.ts` implémente les commandes Windows :
  | Action | Commande Windows |
  | :--- | :--- |
  | Verrouiller | `rundll32.exe user32.dll,LockWorkStation` |
  | Veille | `rundll32.exe powrprof.dll,SetSuspendState 0,1,0` |
  | Redémarrer | `shutdown /r /t 5` |
  | Arrêter | `shutdown /s /t 5` |
  | Wake-on-LAN | paquet magique UDP (cross-platform) |
- Le lanceur d'apps (`launcher.ts`) utilise `start` via `cmd.exe`.
- **Souris & clavier via `nut.js` = déjà cross-platform** → aucun surcoût.
- Prérequis build natif : **Visual Studio Build Tools** (charge « Développement Desktop en C++ ») + Python 3.

**Extensibilité** : la structure prévoit un `switch(process.platform)` pour ajouter macOS/Linux plus tard sans refonte.

---

## D-03 — Périmètre global : complet, ESP32 compris

**Décision** : le projet couvre à terme **l'intégralité du guide**, y compris la passerelle Infrarouge ESP32. ⚠️ *Ce périmètre reste l'**objectif final** ; la livraison est découpée en jalons — voir **D-05**.*

**Périmètre inclus :**
- **Phase 1** — Serveur agent (souris, clavier, média, système, WoL, lanceur).
- **Phase 2** — PWA core : Module 1 (Média/TV), Module 2 (Trackpad), Module 3 (Clavier).
- **Phase 3** — Module 4 (Macro Deck), Module 5 (Présentation + chronomètre), Module 6 (Énergie/Système).
- **Phase 4** — Appairage QR + token, mDNS, `manifest` + service worker (installable + hors-ligne).
- **Phase 5** — Firmware ESP32 (`IRremoteESP8266`) pour relais IR.

**⚠️ Dépendance matérielle** : la Phase 5 nécessite du matériel à acquérir :
- 1× carte **ESP32** (DevKit).
- 1× **LED IR** + transistor (émission).
- 1× récepteur IR **TSOP38238** (apprentissage des codes).
- Arduino IDE ou PlatformIO + bibliothèque `IRremoteESP8266`.

**Note d'ordonnancement** : le logiciel (Phases 1-4) sera développé et testable **sans attendre le matériel**. La Phase 5 sera intégrée quand l'ESP32 sera disponible, sans bloquer le reste.

---

## D-04 — Contexte sécurisé : HTTPS local via `mkcert` + `wss://`

**Problème tranché** : un **service worker** (donc une PWA *installable* et *hors-ligne*) ne s'enregistre **que dans un contexte sécurisé** — `localhost` ou `https://`. Or l'appairage se fait sur une IP LAN (`http://192.168.x.x`), où le service worker serait **refusé**. Servir en simple `http://` condamnerait la promesse « PWA installable » du projet.

**Décision** : mettre en place **HTTPS en réseau local dès la Phase 4**, avec un **certificat de confiance locale généré par [`mkcert`](https://github.com/FiloSottile/mkcert)**.

**Options comparées :**
| Option | PWA installable | Avertissements navigateur | Verdict |
| :--- | :---: | :---: | :--- |
| `http://` simple | ❌ Non | — | ❌ Rejeté (casse la PWA) |
| Certificat **auto-signé** | ✅ Oui | ⚠️ À chaque visite | ❌ Rejeté (UX dégradée) |
| **`mkcert`** (CA locale) | ✅ Oui | ✅ Aucun | ✅ **Retenu** |

**Conséquences concrètes :**
- Le serveur agent écoute en **HTTPS** (module `node:https` avec le cert `mkcert`) au lieu de HTTP simple.
- Le WebSocket passe de `ws://` à **`wss://`** (WebSocket sur TLS) — obligatoire car une page `https://` ne peut pas ouvrir de socket `ws://` non sécurisé (*mixed content* bloqué).
- **Workflow `mkcert`** :
  1. `mkcert -install` (installe l'autorité de certification locale une fois).
  2. `mkcert 192.168.1.x localhost` → génère `cert.pem` + `key.pem` pour l'IP du PC hôte.
  3. Le serveur charge ces fichiers ; le QR d'appairage pointe vers `https://192.168.1.x:...`.
- **Sur le téléphone** : pour zéro avertissement, la CA racine `mkcert` doit être installée sur le mobile (une fois). *À défaut, un simple « accepter le risque » suffit à faire fonctionner l'app, mais l'installation PWA peut rester limitée sur certains navigateurs.*
- **Repli assumé** : en développement pur sur le PC hôte, `localhost` reste un contexte sécurisé valide sans certificat.

**Impact sur le code** : `server/src/config.ts` gagne les chemins des certificats ; `index.ts` crée un serveur `https` ; `client/vite.config.ts` active `server.https` ; le protocole d'URL du client devient `wss://`.

---

## D-05 — Stratégie de livraison : incrémentale (5 jalons)

**Problème tranché** : livrer tout le périmètre D-03 en un seul bloc « v1 » est risqué (rien de fini tant que tout n'est pas fini) et dépend de matériel non encore disponible.

**Décision** : conserver l'objectif complet (D-03) mais **livrer par incréments**, chaque jalon étant **fonctionnel et démontrable** de bout en bout.

| Jalon | Contenu | Critère de « livrable » |
| :--- | :--- | :--- |
| **v0.1** | Serveur agent + Module 2 (Trackpad) | Le curseur du PC bouge depuis le téléphone (via `localhost`/IP) |
| **v0.2** | + Module 3 (Clavier) + Module 1 (Média/TV) | Saisie de texte, macros, volume et D-Pad fonctionnels |
| **v0.3** | + Modules 4, 5, 6 (Macro Deck, Présentation, Système/WoL) | Les 6 modules logiciels opérationnels |
| **v0.4** | + Appairage QR/PIN + HTTPS `mkcert` (D-04) + `manifest`/service worker | PWA **installable** et **hors-ligne** via scan QR sécurisé |
| **v1.0** | + Passerelle IR ESP32 (Phase 5) | Une TV/climatiseur classique piloté via l'ESP32 |

**Règles :**
- On ne démarre un jalon **qu'une fois le précédent validé** (critère de la colonne de droite).
- L'ESP32 (v1.0) n'est **pas bloquant** : les jalons v0.1 → v0.4 se font entièrement en logiciel, sans matériel.
- Chaque jalon peut être taggé en Git (`v0.1`, `v0.2`, …).

---

## 🧱 Stack technique consolidée (résultat des décisions)

| Couche | Technologie figée |
| :--- | :--- |
| Backend | Node.js 20 LTS + TypeScript |
| Contrôle OS | `@nut-tree-fork/nut-js` |
| Serveur temps réel | `ws` (WebSocket over TLS → **`wss://`**) |
| Serveur HTTP | `express` sur **HTTPS** (`node:https`) |
| Certificat local | **`mkcert`** (autorité de confiance locale) |
| Découverte réseau | `bonjour-service` (mDNS) |
| Appairage | `jsonwebtoken` + `qrcode` |
| Frontend | Vite + TypeScript |
| Styles | Tailwind CSS |
| PWA | `vite-plugin-pwa` (Workbox) |
| APIs mobiles | Web Vibration API, Touch Events |
| Firmware IoT | ESP32 + `IRremoteESP8266` |
| Structure | Monorepo npm workspaces (`server`, `client`, `shared`, `firmware`) |

---

## 📎 Historique des révisions

| Date | Décision(s) | Changement |
| :--- | :--- | :--- |
| 2026-09-30 | D-01, D-02, D-03 | Création initiale — décisions figées après validation. |
| 2026-09-30 | D-04 | Ajout : HTTPS local via `mkcert` + passage à `wss://` pour rendre la PWA réellement installable (service worker = contexte sécurisé obligatoire). |
| 2026-09-30 | D-05 | Ajout : stratégie de livraison incrémentale en 5 jalons (v0.1 → v1.0). D-03 requalifié en « objectif global ». |
