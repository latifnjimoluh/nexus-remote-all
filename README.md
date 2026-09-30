# 🌐 Nexus Remote All — Universal Controller Suite

> **Nexus Remote All** est une suite de contrôle universelle moderne sous forme de **Progressive Web App (PWA)** permettant de transformer n'importe quel smartphone, tablette ou navigateur en une télécommande tout-en-un ultra-réactive pour PC, Mac, Smart TV et appareils multimédias.

---

## 🎯 1. Vision & Objectifs

* **Zéro installation mobile requise** : Accessible directement via le navigateur web et installable en un clic sur l'écran d'accueil (PWA).
* **Multi-usages** : Regroupe en une seule interface fluide tous les outils de contrôle du quotidien (TV, Souris, Clavier, Présentation, Raccourcis, Système).
* **Temps réel & Latence minimale** : Communication bidirectionnelle via WebSockets locaux (< 10 ms) pour une réactivité parfaite du curseur et des touches.
* **Ergonomie tactile** : Interface moderne "Dark Mode", boutons haptiques (vibration au toucher) et navigation par onglets optimisée pour une utilisation à une main.

---

## 🏗️ 2. Architecture Globale du Système

```
               ┌────────────────────────────────────────────────────────┐
               │         📱 Smartphone / Tablette (Client PWA)          │
               │                   Nexus Remote All                     │
               └───────────────────────────┬────────────────────────────┘
                                           │
                        (Wi-Fi Local / WebSockets & HTTP)
                                           │
                                           ▼
               ┌────────────────────────────────────────────────────────┐
               │          🖥️ Serveur Hôte / Agent Récepteur            │
               │                 (Node.js ou Python)                    │
               └───────────┬───────────────────────────────┬────────────┘
                           │                               │
            (Contrôle OS Natif)                 (Réseau Local / IoT)
                           │                               │
        ┌──────────────────┴───────────────┐               │
        │ • Mouvements souris (Curseur)    │               ▼
        │ • Clics & Défilement             │   ┌─────────────────────────┐
        │ • Frappes clavier & Raccourcis   │   │  📺 Smart TV (Wi-Fi)     │
        │ • Actions système (Éteindre...)  │   │  (Android TV, LG, etc.) │
        └──────────────────────────────────┘   └───────────┬─────────────┘
                                                           │
                                             (Option Passerelle ESP32)
                                                           │
                                                           ▼
                                               ┌───────────────────────┐
                                               │ 📡 Relais IR / RF     │
                                               │ (Climatiseurs, TV     │
                                               │  classiques, Amplis)  │
                                               └───────────────────────┘
```

---

## 🎛️ 3. Spécification Détaillée des Modules (Remotes)

### 📺 Module 1 : Télécommande TV & Média (`Media Remote`)
* **Pavé directionnel (D-Pad)** : Flèches directionnelles (Haut, Bas, Gauche, Droite) + bouton central `OK / Entrée`.
* **Contrôle Volume** : `Vol +`, `Vol -`, `Mute`.
* **Navigation Chaînes / Pistes** : `CH +`, `CH -`, Piste précédente / suivante.
* **Lecteur Multimédia** : `Play`, `Pause`, `Stop`, Avance / Retour rapide (10s).
* **Touches système** : `Home / Accueil`, `Retour`, `Menu`, `Sélection de source (HDMI)`.
* **Clavier numérique (0-9)** : Pour zapper directement sur un numéro de chaîne.

### 🖱️ Module 2 : Souris & Trackpad Tactile (`Trackpad Remote`)
* **Zone tactile multi-touch** :
  * Déplacement fluide du doigt = translation relative du curseur à l'écran.
  * 1 tap rapide = Clic gauche.
  * Tap à 2 doigts = Clic droit.
  * Glissement vertical à 2 doigts = Défilement de page (Scroll).
  * Double tap maintenu = Glisser-déposer (Drag & Drop).
* **Barre d'actions rapides sous le trackpad** :
  * Bouton Clic Gauche, Bouton Clic Droit, Bouton Molette centrale.
* **Réglages** : Sensibilité et accélération du curseur ajustables.

### ⌨️ Module 3 : Clavier Universel (`Keyboard Remote`)
* **Saisie directe** : Champ de saisie instantané utilisant le clavier natif du smartphone (avec prédiction et dictée vocale).
* **Touches fonctionnelles & de contrôle** :
  * `Entrée`, `Échap`, `Backspace`, `Suppr`, `Tab`, `Espace`.
  * Touches de navigation (`Page Up`, `Page Down`, Flèches).
* **Touches de combinaison (Macros rapides)** :
  * `Ctrl + C` (Copier), `Ctrl + V` (Coller), `Ctrl + Z` (Annuler).
  * `Alt + Tab` (Changer de fenêtre), `Touche Windows / Super`.
  * Presse-papier partagé (envoyer du texte ou un lien du smartphone vers le PC).

### 🎛️ Module 4 : Macro Deck & Lanceur (`Stream Deck Remote`)
* Grille de boutons personnalisables avec icônes.
* **Lancement d'applications en 1 tap** :
  * Lancer le navigateur (Chrome, Firefox, Edge).
  * Ouvrir YouTube, Netflix, Spotify, Steam, VLC.
* **Actions de confort** :
  * Coupure rapide du microphone (Discord, Zoom, Teams).
  * Capture d'écran instantanée.
  * Passage en plein écran (`F11`).

### 📊 Module 5 : Télécommande Présentation (`Slide Remote`)
* Interface grand format épurée pour présentations (PowerPoint, Google Slides, PDF, Keynote).
* **Commandes principales** :
  * Deux gros boutons tactiles : `Diapositive Suivante` / `Diapositive Précédente`.
  * `F5` (Démarrer le diaporama) / `Échap` (Quitter).
  * `B` (Black Screen / Écran noir pour focaliser l'attention sur l'orateur).
* **Outils orateur** :
  * Chronomètre et compte à rebours intégrés sur l'écran du smartphone.
  * Vibrations d'alerte configurables (ex: rappel à 5 minutes de la fin).

### ⚡ Module 6 : Contrôle Énergie & Système (`Power Remote`)
* **Gestion d'état** :
  * Verrouiller la session (`Win + L`).
  * Mettre en veille.
  * Redémarrer l'ordinateur.
  * Arrêter complètement la machine (avec confirmation de sécurité).
* **Wake-on-LAN (WoL)** : Envoi d'un paquet magique pour allumer le PC à distance en Wi-Fi.

---

## 🛠️ 4. Stack Technique & Technologies

| Couche | Technologie recommandée | Rôle |
| :--- | :--- | :--- |
| **Frontend PWA** | HTML5, Modern JavaScript / TypeScript, Tailwind CSS | Interface tactile responsive, esthétique, ultra-rapide |
| **APIs Web Mobiles** | Web Vibration API (`navigator.vibrate`), Touch Events | Sensation de retour physique haptique et gestes tactiles |
| **Communication** | WebSocket (`ws://`) + API REST (`http://`) | Échanges bidirectionnels à latence quasi-nulle (< 10ms) |
| **Backend Agent** | Node.js (Express + `ws` + `robotjs` / `nut.js`) ou Python (FastAPI + `pyautogui`) | Exécution des mouvements de souris, touches et commandes OS |
| **Appairage & Découverte** | mDNS / Bonjour + QR Code / Code PIN | Connexion automatique et sécurisée du smartphone au serveur |
| **Extension IoT (Option)** | ESP32 + `IRremoteESP8266` | Relais pour appareils Infrarouge (TV classiques, Climatiseurs) |

---

## 🔒 5. Sécurité & Appairage

1. **Génération d'un QR Code** : Le serveur hôte affiche au démarrage une URL locale ainsi qu'un QR Code avec un jeton temporaire d'appairage.
2. **Scan instantané** : Le smartphone scanne le QR Code pour ouvrir directement la PWA pré-configurée.
3. **Protection sur le réseau local** : Seuls les appareils authentifiés par code PIN / token peuvent envoyer des commandes de clavier ou d'extinction du système.

---

## 🚀 6. Feuille de Route du Projet (Roadmap)

- [ ] **Phase 1 : Socle Technique & Serveur Agent**
  - Création du serveur local (Node.js ou Python) avec gestionnaire WebSocket.
  - Implémentation des contrôles natifs du système d'exploitation (souris, touches clavier, volume).
- [ ] **Phase 2 : Interface PWA Core (Nexus UI)**
  - Conception de l'interface Dark Mode tactile avec Tailwind CSS.
  - Module 1 : Télécommande Média / TV.
  - Module 2 : Surface tactile Trackpad / Souris (gestes multi-touch).
  - Module 3 : Clavier virtuel & touches d'action rapide.
- [ ] **Phase 3 : Modules Avancés**
  - Module 4 : Macro Deck personnalisable.
  - Module 5 : Télécommande Présentation avec chronomètre.
  - Module 6 : Gestion Système & Alimentation.
- [ ] **Phase 4 : Configuration PWA & Appairage**
  - Ajout du `manifest.json`, des icônes et du `service-worker.js` pour installation hors-ligne.
  - Page d'appairage avec affichage de l'adresse IP et QR Code dans la console / interface serveur.
- [ ] **Phase 5 : Extension Passerelle Infrarouge (Optionnelle)**
  - Firmware pour ESP32 permettant de relayer les ordres IR vers les équipements de salon traditionnels.
