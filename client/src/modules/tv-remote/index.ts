/**
 * Module « TV Remote » — reproduction fidèle de la télécommande Hisense VIDAA.
 *
 * Isolé volontairement : styles préfixés `tvr-` injectés une seule fois, aucune
 * dépendance aux autres modules. Pour l'activer dans l'app, voir INTEGRATION.md.
 *
 * Chaque touche est reliée à une vraie commande PC via la table ACTIONS ci-dessous.
 * Les boutons purement « TV » sans équivalent PC (Power, GUIDE, couleurs…) sont
 * des placeholders (`cmd: null`) : ils affichent un toast et attendent un mappage.
 */
import { send } from "../../core/ws-client";
import { tapFeedback } from "../../core/haptics";
import type { Command } from "@shared/protocol";

interface Action {
  /** Commande envoyée à l'agent, ou null pour un bouton non encore mappé. */
  cmd: Command | null;
  /** Libellé lisible (toast des boutons non mappés). */
  label: string;
  /** Fréquence du retour haptique (Hz). */
  hz?: number;
}

/** Table de mappage bouton → commande PC. Modifiable en un seul endroit. */
const ACTIONS: Record<string, Action> = {
  // Alimentation & entrées
  power: { cmd: null, label: "Alimentation", hz: 800 },
  source: { cmd: { type: "key:combo", keys: ["LeftSuper", "P"] }, label: "Source", hz: 1000 },
  mute: { cmd: { type: "media:key", key: "mute" }, label: "Muet", hz: 1100 },

  // Pavé numérique
  "num-1": { cmd: { type: "key:tap", key: "Num1" }, label: "1" },
  "num-2": { cmd: { type: "key:tap", key: "Num2" }, label: "2" },
  "num-3": { cmd: { type: "key:tap", key: "Num3" }, label: "3" },
  "num-4": { cmd: { type: "key:tap", key: "Num4" }, label: "4" },
  "num-5": { cmd: { type: "key:tap", key: "Num5" }, label: "5" },
  "num-6": { cmd: { type: "key:tap", key: "Num6" }, label: "6" },
  "num-7": { cmd: { type: "key:tap", key: "Num7" }, label: "7" },
  "num-8": { cmd: { type: "key:tap", key: "Num8" }, label: "8" },
  "num-9": { cmd: { type: "key:tap", key: "Num9" }, label: "9" },
  "num-0": { cmd: { type: "key:tap", key: "Num0" }, label: "0" },
  guide: { cmd: null, label: "Guide" },
  chlist: { cmd: null, label: "Liste des chaînes" },

  // Boutons couleur (télétexte) — placeholders
  "color-red": { cmd: null, label: "Rouge" },
  "color-green": { cmd: null, label: "Vert" },
  "color-yellow": { cmd: null, label: "Jaune" },
  "color-blue": { cmd: null, label: "Bleu" },

  // Média
  play: { cmd: { type: "media:key", key: "play" }, label: "Lecture/Pause", hz: 1450 },
  menu: { cmd: { type: "media:key", key: "menu" }, label: "Menu", hz: 1000 },

  // Navigation
  up: { cmd: { type: "media:key", key: "up" }, label: "Haut", hz: 1350 },
  down: { cmd: { type: "media:key", key: "down" }, label: "Bas", hz: 1050 },
  left: { cmd: { type: "media:key", key: "left" }, label: "Gauche", hz: 1150 },
  right: { cmd: { type: "media:key", key: "right" }, label: "Droite", hz: 1250 },
  ok: { cmd: { type: "media:key", key: "ok" }, label: "OK", hz: 1500 },

  // Fonctions
  exit: { cmd: { type: "media:key", key: "back" }, label: "Quitter", hz: 1000 },
  back: { cmd: { type: "key:tap", key: "Backspace" }, label: "Retour", hz: 1100 },
  return: { cmd: { type: "key:combo", keys: ["LeftAlt", "ArrowLeft"] }, label: "Précédent", hz: 1050 },
  info: { cmd: null, label: "Info" },
  subtitle: { cmd: { type: "key:tap", key: "C" }, label: "Sous-titres", hz: 1150 },
  txt: { cmd: null, label: "Télétexte" },

  // Bascules chaîne / volume
  "ch-up": { cmd: { type: "key:tap", key: "PageUp" }, label: "Chaîne +", hz: 1400 },
  "ch-down": { cmd: { type: "key:tap", key: "PageDown" }, label: "Chaîne −", hz: 1000 },
  "vol-up": { cmd: { type: "media:key", key: "volup" }, label: "Volume +", hz: 1400 },
  "vol-down": { cmd: { type: "media:key", key: "voldown" }, label: "Volume −", hz: 1000 },

  // Applications
  "app-all": { cmd: null, label: "Toutes les apps" },
  "app-free": { cmd: null, label: "VIDAA Free" },
  "app-netflix": { cmd: { type: "launch:app", target: "netflix" }, label: "Netflix", hz: 1300 },
  "app-youtube": { cmd: { type: "launch:app", target: "youtube" }, label: "YouTube", hz: 1300 },
  "app-prime": { cmd: { type: "launch:app", target: "primevideo" }, label: "Prime Video", hz: 1300 },
  "app-browser": { cmd: { type: "launch:app", target: "chrome" }, label: "Navigateur", hz: 1300 },
  "app-media": { cmd: { type: "launch:app", target: "vlc" }, label: "Média", hz: 1300 },
  "app-music": { cmd: { type: "launch:app", target: "spotify" }, label: "Musique", hz: 1300 },
};

/** Injecte la feuille de style scellée du module (une seule fois). */
function injectStyles(): void {
  if (document.getElementById("tvr-styles")) return;
  const style = document.createElement("style");
  style.id = "tvr-styles";
  style.textContent = `
  .tvr-remote {
    --tvr-top:#3b3b42; --tvr-bot:#23232a; --tvr-edge:rgba(255,255,255,.07);
    --tvr-ink:#d9dae2; --tvr-dim:#9a9ba6;
    width:312px; max-width:100%; margin:4px auto 18px; padding:20px 20px 22px;
    background:linear-gradient(160deg,#2c2c32 0%,#1a1a1f 42%,#202026 100%);
    border-radius:46px; border:1px solid rgba(255,255,255,.06); position:relative;
    box-shadow:0 2px 1px rgba(255,255,255,.10) inset,0 -20px 40px rgba(0,0,0,.35) inset,0 30px 60px rgba(0,0,0,.55),0 8px 18px rgba(0,0,0,.4);
    display:flex; flex-direction:column; gap:16px; user-select:none;
    font-family:"Segoe UI",system-ui,-apple-system,Roboto,sans-serif;
  }
  .tvr-remote::before{content:"";position:absolute;inset:3px;border-radius:43px;pointer-events:none;
    background:linear-gradient(105deg,rgba(255,255,255,.05) 0%,transparent 18%,transparent 82%,rgba(255,255,255,.03) 100%);}
  .tvr-row{display:flex;align-items:center;justify-content:center;gap:12px;}
  .tvr-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
  .tvr-btn{appearance:none;border:1px solid var(--tvr-edge);
    background:linear-gradient(180deg,var(--tvr-top),var(--tvr-bot));color:var(--tvr-ink);
    box-shadow:0 1px 0 rgba(255,255,255,.06) inset,0 3px 5px rgba(0,0,0,.45);cursor:pointer;
    transition:transform .06s ease,filter .06s ease;display:flex;align-items:center;justify-content:center;line-height:1;
    font-family:inherit;}
  .tvr-btn:hover{filter:brightness(1.12);}
  .tvr-btn:active{transform:translateY(2px);filter:brightness(.9);}
  .tvr-btn:focus-visible{outline:2px solid #6d8bff;outline-offset:2px;}
  .tvr-num{width:56px;height:44px;border-radius:22px;font-size:1.25rem;font-weight:600;margin:0 auto;}
  .tvr-lbl{font-size:.58rem;font-weight:700;letter-spacing:.06em;color:var(--tvr-dim);}
  .tvr-power{width:46px;height:46px;border-radius:50%;font-size:1.2rem;color:#ff5a5a;}
  .tvr-fn{height:42px;border-radius:14px;font-size:.62rem;font-weight:700;letter-spacing:.05em;padding:0 6px;text-align:center;}
  .tvr-ic{width:46px;height:42px;border-radius:14px;font-size:1.05rem;}
  .tvr-color{width:40px;height:26px;border-radius:9px;border:1px solid rgba(0,0,0,.35);cursor:pointer;
    box-shadow:0 2px 4px rgba(0,0,0,.5),0 1px 0 rgba(255,255,255,.25) inset;}
  .tvr-color:active{transform:translateY(2px);}
  .tvr-c-blue{background:linear-gradient(180deg,#3f86ff,#1e5fd6);}
  .tvr-c-yellow{background:linear-gradient(180deg,#ffd23f,#e5a800);}
  .tvr-c-green{background:linear-gradient(180deg,#4cd267,#2a9f43);}
  .tvr-c-red{background:linear-gradient(180deg,#ff5a52,#d62b23);}
  .tvr-dpad{width:176px;height:176px;border-radius:50%;position:relative;margin:0 auto;
    background:radial-gradient(circle at 50% 38%,#33333a 0%,#212127 60%,#191920 100%);
    box-shadow:0 6px 14px rgba(0,0,0,.5),0 1px 0 rgba(255,255,255,.08) inset;border:1px solid rgba(255,255,255,.05);}
  .tvr-arrow{position:absolute;background:none;border:none;color:#c9cad4;font-size:1.05rem;cursor:pointer;
    width:44px;height:44px;display:flex;align-items:center;justify-content:center;}
  .tvr-arrow:active{color:#fff;transform:scale(.9);}
  .tvr-up{top:6px;left:50%;transform:translateX(-50%);}
  .tvr-down{bottom:6px;left:50%;transform:translateX(-50%);}
  .tvr-left{left:6px;top:50%;transform:translateY(-50%);}
  .tvr-right{right:6px;top:50%;transform:translateY(-50%);}
  .tvr-ok{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:78px;height:78px;border-radius:50%;
    background:radial-gradient(circle at 50% 35%,#45454d,#26262d 70%,#1e1e24);color:#eceef6;font-weight:700;
    font-size:.95rem;letter-spacing:.08em;border:1px solid rgba(255,255,255,.09);cursor:pointer;
    box-shadow:0 4px 10px rgba(0,0,0,.5),0 1px 0 rgba(255,255,255,.12) inset;display:flex;align-items:center;justify-content:center;}
  .tvr-ok:active{transform:translate(-50%,-50%) translateY(2px);filter:brightness(.9);}
  .tvr-rocker{width:58px;border-radius:29px;padding:8px 0;background:linear-gradient(180deg,var(--tvr-top),var(--tvr-bot));
    border:1px solid var(--tvr-edge);box-shadow:0 1px 0 rgba(255,255,255,.06) inset,0 3px 6px rgba(0,0,0,.45);
    display:flex;flex-direction:column;align-items:center;gap:6px;}
  .tvr-chev{background:none;border:none;color:#c9cad4;font-size:1rem;cursor:pointer;padding:4px 14px;width:100%;}
  .tvr-chev:active{color:#fff;}
  .tvr-rlbl{font-size:.62rem;font-weight:700;letter-spacing:.08em;color:var(--tvr-dim);}
  .tvr-controls{display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:center;}
  .tvr-col{display:flex;flex-direction:column;gap:10px;}
  .tvr-apps{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
  .tvr-app{height:40px;border-radius:10px;border:none;cursor:pointer;font-weight:800;font-size:.72rem;letter-spacing:.02em;
    display:flex;align-items:center;justify-content:center;font-family:inherit;
    box-shadow:0 3px 6px rgba(0,0,0,.45),0 1px 0 rgba(255,255,255,.3) inset;transition:transform .06s ease,filter .06s ease;}
  .tvr-app:active{transform:translateY(2px);filter:brightness(.94);}
  .tvr-cream{background:linear-gradient(180deg,#f2efe8,#dcd8cf);color:#2a2a2a;}
  .tvr-purple{background:linear-gradient(180deg,#9b4dff,#7a26e0);color:#fff;}
  .tvr-netflix{color:#e50914;font-weight:900;}
  .tvr-yt{color:#ff0000;font-weight:900;display:inline-flex;align-items:center;gap:3px;}
  .tvr-yt span{color:#2a2a2a;}
  .tvr-prime{color:#00a8e1;font-weight:800;}
  .tvr-prime b{color:#ff9900;}
  .tvr-brand{text-align:center;margin-top:2px;letter-spacing:.06em;}
  .tvr-brand .h{color:#cfd0da;font-weight:700;font-size:.82rem;}
  .tvr-brand .v{color:#8b8c98;font-weight:600;font-size:.66rem;margin-left:6px;}
  .tvr-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(10px);
    background:rgba(20,20,26,.95);color:#eceef6;border:1px solid rgba(255,255,255,.12);
    padding:9px 16px;border-radius:12px;font-size:.8rem;font-family:"Segoe UI",system-ui,sans-serif;
    box-shadow:0 10px 30px rgba(0,0,0,.5);opacity:0;transition:opacity .2s,transform .2s;z-index:9999;pointer-events:none;}
  .tvr-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
  @media (prefers-reduced-motion:reduce){.tvr-btn,.tvr-app,.tvr-toast{transition:none;}}
  `;
  document.head.appendChild(style);
}

let toastEl: HTMLDivElement | null = null;
let toastTimer: number | undefined;
function toast(msg: string): void {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "tvr-toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove("show"), 1600);
}

function handle(act: string): void {
  const a = ACTIONS[act];
  if (!a) return;
  tapFeedback(14, a.hz ?? 1200);
  if (a.cmd) {
    send(a.cmd);
  } else {
    toast(`« ${a.label} » : à configurer`);
  }
}

export function renderTvRemote(root: HTMLElement): void {
  injectStyles();

  const remote = document.createElement("div");
  remote.className = "tvr-remote";
  remote.setAttribute("role", "group");
  remote.setAttribute("aria-label", "Télécommande Hisense VIDAA");
  remote.innerHTML = `
    <div class="tvr-row" style="justify-content:space-between;">
      <button class="tvr-btn tvr-power" data-act="power" aria-label="Marche/Arrêt">⏻</button>
      <button class="tvr-btn tvr-ic" data-act="source" aria-label="Source">⧉</button>
      <button class="tvr-btn tvr-ic" data-act="mute" aria-label="Muet">🔇</button>
    </div>

    <div class="tvr-grid3">
      <button class="tvr-btn tvr-num" data-act="num-1">1</button>
      <button class="tvr-btn tvr-num" data-act="num-2">2</button>
      <button class="tvr-btn tvr-num" data-act="num-3">3</button>
      <button class="tvr-btn tvr-num" data-act="num-4">4</button>
      <button class="tvr-btn tvr-num" data-act="num-5">5</button>
      <button class="tvr-btn tvr-num" data-act="num-6">6</button>
      <button class="tvr-btn tvr-num" data-act="num-7">7</button>
      <button class="tvr-btn tvr-num" data-act="num-8">8</button>
      <button class="tvr-btn tvr-num" data-act="num-9">9</button>
      <button class="tvr-btn tvr-num" data-act="guide"><span class="tvr-lbl">GUIDE</span></button>
      <button class="tvr-btn tvr-num" data-act="num-0">0</button>
      <button class="tvr-btn tvr-num" data-act="chlist"><span class="tvr-lbl">CH.LIST</span></button>
    </div>

    <div class="tvr-row" style="justify-content:space-between;">
      <div class="tvr-row" style="gap:8px;">
        <button class="tvr-color tvr-c-red" data-act="color-red" aria-label="Rouge"></button>
        <button class="tvr-color tvr-c-green" data-act="color-green" aria-label="Vert"></button>
        <button class="tvr-color tvr-c-yellow" data-act="color-yellow" aria-label="Jaune"></button>
        <button class="tvr-color tvr-c-blue" data-act="color-blue" aria-label="Bleu"></button>
      </div>
      <div class="tvr-row" style="gap:8px;">
        <button class="tvr-btn tvr-ic" data-act="play" aria-label="Lecture/Pause">⏯</button>
        <button class="tvr-btn tvr-ic" data-act="menu" aria-label="Menu">▤</button>
      </div>
    </div>

    <div class="tvr-dpad">
      <button class="tvr-arrow tvr-up" data-act="up" aria-label="Haut">▲</button>
      <button class="tvr-arrow tvr-left" data-act="left" aria-label="Gauche">◀</button>
      <button class="tvr-ok" data-act="ok">OK</button>
      <button class="tvr-arrow tvr-right" data-act="right" aria-label="Droite">▶</button>
      <button class="tvr-arrow tvr-down" data-act="down" aria-label="Bas">▼</button>
    </div>

    <div class="tvr-controls">
      <div class="tvr-col">
        <button class="tvr-btn tvr-fn" data-act="exit">EXIT</button>
        <button class="tvr-btn tvr-fn" data-act="back" aria-label="Retour">↩</button>
        <button class="tvr-btn tvr-fn" data-act="return" aria-label="Précédent">↺</button>
      </div>
      <div class="tvr-row" style="gap:12px;">
        <div class="tvr-rocker">
          <button class="tvr-chev" data-act="ch-up" aria-label="Chaîne +">∧</button>
          <span class="tvr-rlbl">CH</span>
          <button class="tvr-chev" data-act="ch-down" aria-label="Chaîne −">∨</button>
        </div>
        <div class="tvr-rocker">
          <button class="tvr-chev" data-act="vol-up" aria-label="Volume +">∧</button>
          <span class="tvr-rlbl">VOL</span>
          <button class="tvr-chev" data-act="vol-down" aria-label="Volume −">∨</button>
        </div>
      </div>
      <div class="tvr-col">
        <button class="tvr-btn tvr-fn" data-act="info">INFO</button>
        <button class="tvr-btn tvr-fn" data-act="subtitle">SUBTITLE</button>
        <button class="tvr-btn tvr-fn" data-act="txt">TXT</button>
      </div>
    </div>

    <div class="tvr-apps">
      <button class="tvr-app tvr-purple" data-act="app-all">ALL</button>
      <button class="tvr-app tvr-purple" data-act="app-free">FREE</button>
      <button class="tvr-app tvr-cream" data-act="app-prime"><span class="tvr-prime">prime<b>video</b></span></button>
      <button class="tvr-app tvr-cream" data-act="app-netflix"><span class="tvr-netflix">NETFLIX</span></button>
      <button class="tvr-app tvr-cream" data-act="app-youtube"><span class="tvr-yt">▶<span>YouTube</span></span></button>
      <button class="tvr-app tvr-cream" data-act="app-browser">BROWSER</button>
      <button class="tvr-app tvr-cream" data-act="app-media">MEDIA</button>
      <button class="tvr-app tvr-cream" data-act="app-music">Music</button>
      <button class="tvr-app tvr-cream" data-act="app-all" aria-label="Applications">⋮⋮⋮</button>
    </div>

    <div class="tvr-brand"><span class="h">Hisense</span><span class="v">VIDAA</span></div>
  `;

  remote.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (target) handle(target.getAttribute("data-act")!);
  });

  root.appendChild(remote);
}
