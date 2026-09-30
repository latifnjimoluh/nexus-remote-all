import { connect, onStatus, type Status } from "./core/ws-client";
import { tapFeedback } from "./core/haptics";
import { openSettingsModal } from "./core/settings";
import { showToast } from "./core/toast";
import { renderTrackpad } from "./modules/trackpad";
import { renderMedia } from "./modules/media";
import { renderKeyboard } from "./modules/keyboard";
import { renderMacrodeck } from "./modules/macrodeck";
import { renderSlides } from "./modules/slides";
import { renderPower } from "./modules/power";

interface Cfg {
  host: string;
  port: number;
  token: string;
}

/** Lit la configuration depuis l'URL (?host&ws&token) ou le localStorage */
function readConfig(): Cfg | null {
  const q = new URLSearchParams(location.search);
  const host = q.get("host") ?? localStorage.getItem("nexus.host");
  const port = q.get("ws") ?? localStorage.getItem("nexus.port");
  const token = q.get("token") ?? localStorage.getItem("nexus.token");
  if (host && port && token) {
    localStorage.setItem("nexus.host", host);
    localStorage.setItem("nexus.port", port);
    localStorage.setItem("nexus.token", token);
    return { host, port: Number(port), token };
  }
  return null;
}

export function bootstrap(root: HTMLElement): void {
  const cfg = readConfig();
  if (cfg) {
    connect(cfg);
    mountShell(root);
  } else {
    mountConnect(root);
  }
}

/** Écran de connexion au design Dark Glassmorphism avec reflets et contrastes */
function mountConnect(root: HTMLElement): void {
  root.className = "h-full flex items-center justify-center p-6 relative overflow-hidden";
  root.innerHTML = `
    <!-- Lueur d'ambiance d'arrière-plan -->
    <div class="absolute -top-32 left-1/2 -translate-x-1/2 w-96 h-96 bg-nexus-accent/20 rounded-full blur-3xl pointer-events-none"></div>

    <div class="glass-panel-elevated w-full max-w-sm rounded-3xl p-6 sm:p-8 flex flex-col gap-6 relative z-10 border border-white/10">
      <div class="text-center">
        <div class="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#6d5efc] to-[#00f2fe] mx-auto flex items-center justify-center shadow-[0_0_30px_rgba(109,94,252,0.5)] mb-3">
          <span class="text-3xl">🌐</span>
        </div>
        <h1 class="text-2xl font-black tracking-tight text-white">Nexus Remote</h1>
        <p class="text-nexus-muted text-xs mt-1">Contrôle universel PC, Mac & Smart TV</p>
      </div>

      <form id="cf" class="flex flex-col gap-3.5">
        <div>
          <label class="text-[11px] font-semibold text-nexus-muted uppercase tracking-wider mb-1 block">Adresse Hôte</label>
          <div class="relative">
            <input name="host" placeholder="ex: 192.168.1.20" required
              class="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white placeholder-white/30 outline-none focus:border-nexus-accent transition" />
          </div>
        </div>

        <div class="grid grid-cols-3 gap-2">
          <div class="col-span-1">
            <label class="text-[11px] font-semibold text-nexus-muted uppercase tracking-wider mb-1 block">Port WS</label>
            <input name="port" placeholder="4701" value="4701" required inputmode="numeric"
              class="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white placeholder-white/30 outline-none focus:border-nexus-accent transition text-center font-mono" />
          </div>
          <div class="col-span-2">
            <label class="text-[11px] font-semibold text-nexus-muted uppercase tracking-wider mb-1 block">Jeton (Token)</label>
            <input name="token" placeholder="Token d'accès ou appairage" required
              class="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white placeholder-white/30 outline-none focus:border-nexus-accent transition font-mono text-xs" />
          </div>
        </div>

        <button type="submit" class="btn-accent mt-3 font-bold text-sm py-3.5 flex items-center justify-center gap-2">
          <span>Se connecter</span>
          <span>→</span>
        </button>
      </form>

      <div class="text-center pt-2 border-t border-white/5">
        <p class="text-[11px] text-nexus-muted">
          💡 Scannez le QR Code affiché sur votre PC ou entrez l'adresse IP manuellement.
        </p>
      </div>
    </div>
  `;

  const form = root.querySelector<HTMLFormElement>("#cf")!;
  form.onsubmit = (e) => {
    e.preventDefault();
    tapFeedback(20);
    const data = new FormData(form);
    const host = String(data.get("host")).trim();
    const port = Number(data.get("port"));
    const token = String(data.get("token")).trim();

    localStorage.setItem("nexus.host", host);
    localStorage.setItem("nexus.port", String(port));
    localStorage.setItem("nexus.token", token);

    connect({ host, port, token });
    mountShell(root);
  };
}

const TABS = [
  { id: "trackpad", label: "Souris", icon: "🖱️", render: renderTrackpad },
  { id: "media", label: "TV / Média", icon: "📺", render: renderMedia },
  { id: "keyboard", label: "Clavier", icon: "⌨️", render: renderKeyboard },
  { id: "macrodeck", label: "Deck", icon: "🎛️", render: renderMacrodeck },
  { id: "slides", label: "Diapo", icon: "📊", render: renderSlides },
  { id: "power", label: "Système", icon: "⚡", render: renderPower },
];

/** Shell principal ultra-moderne Dark Glassmorphism */
function mountShell(root: HTMLElement): void {
  root.className = "h-full flex flex-col justify-between overflow-hidden";
  root.innerHTML = "";

  const savedHost = localStorage.getItem("nexus.host") || "Hôte distant";

  // 1. Barre d'en-tête supérieure
  const bar = document.createElement("header");
  bar.className =
    "glass-panel flex items-center justify-between px-4 py-2.5 z-20 border-b border-white/5 pt-safe";

  // Bloc statut & hôte
  const statusWrap = document.createElement("div");
  statusWrap.className = "flex items-center gap-2.5";

  // Pastille pulsée
  const dotContainer = document.createElement("div");
  dotContainer.className = "relative flex items-center justify-center w-3 h-3";
  const ping = document.createElement("span");
  ping.className = "animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75";
  const dot = document.createElement("span");
  dot.className = "relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]";
  dotContainer.append(ping, dot);

  const textWrap = document.createElement("div");
  textWrap.className = "flex flex-col leading-tight";
  const hostLabel = document.createElement("span");
  hostLabel.className = "text-xs font-bold text-slate-100 flex items-center gap-1";
  hostLabel.textContent = savedHost;
  const statusLabel = document.createElement("span");
  statusLabel.className = "text-[10px] text-nexus-muted";
  statusLabel.textContent = "Connexion en cours…";
  textWrap.append(hostLabel, statusLabel);

  statusWrap.append(dotContainer, textWrap);

  // Bloc Actions rapides (Réglages & Déconnexion)
  const headerActions = document.createElement("div");
  headerActions.className = "flex items-center gap-1.5";

  // Bouton Réglages
  const settingsBtn = document.createElement("button");
  settingsBtn.className =
    "p-2 rounded-xl text-nexus-muted hover:text-white bg-white/5 hover:bg-white/10 border border-white/5 transition flex items-center justify-center text-sm";
  settingsBtn.title = "Paramètres de la télécommande";
  settingsBtn.innerHTML = "⚙️";
  settingsBtn.onclick = () => {
    tapFeedback(12);
    openSettingsModal();
  };

  // Bouton Déconnexion
  const disconnectBtn = document.createElement("button");
  disconnectBtn.className =
    "p-2 rounded-xl text-nexus-muted hover:text-rose-300 bg-white/5 hover:bg-rose-500/15 border border-white/5 transition flex items-center justify-center text-sm";
  disconnectBtn.title = "Se déconnecter";
  disconnectBtn.innerHTML = "🚪";
  disconnectBtn.onclick = () => {
    tapFeedback(20);
    if (confirm("Se déconnecter de la session actuelle ?")) {
      localStorage.removeItem("nexus.token");
      location.reload();
    }
  };

  headerActions.append(settingsBtn, disconnectBtn);
  bar.append(statusWrap, headerActions);

  // Écoute de l'état de la connexion WebSocket
  onStatus((s: Status) => {
    if (s === "open") {
      dot.className = "relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]";
      ping.className = "animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75";
      statusLabel.textContent = "Connecté & Synchronisé";
      statusLabel.className = "text-[10px] text-emerald-400 font-medium";
    } else if (s === "connecting") {
      dot.className = "relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]";
      ping.className = "animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75";
      statusLabel.textContent = "Connexion…";
      statusLabel.className = "text-[10px] text-amber-400 font-medium";
    } else {
      dot.className = "relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.7)]";
      ping.className = "animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75";
      statusLabel.textContent = "Déconnecté — tentative…";
      statusLabel.className = "text-[10px] text-rose-400 font-medium";
    }
  });

  // 2. Zone de contenu principal des modules
  const content = document.createElement("main");
  content.className = "flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 no-scrollbar relative z-10";

  // 3. Barre de navigation ergonomique en bas (6 onglets tactiles)
  const nav = document.createElement("nav");
  nav.className =
    "glass-panel grid grid-cols-6 gap-1 p-1.5 border-t border-white/5 pb-safe z-20 shadow-[0_-8px_24px_rgba(0,0,0,0.4)]";

  let activeTabId = "trackpad";
  const tabButtons: Map<string, HTMLButtonElement> = new Map();

  const show = (tab: (typeof TABS)[number]) => {
    activeTabId = tab.id;
    content.innerHTML = "";
    content.scrollTop = 0;
    tab.render(content);

    // Mettre à jour l'apparence des onglets
    for (const [id, btn] of tabButtons.entries()) {
      if (id === activeTabId) {
        btn.className =
          "flex flex-col items-center justify-center py-2 px-0.5 rounded-2xl bg-nexus-accent text-white font-semibold shadow-[0_2px_12px_rgba(109,94,252,0.4)] border border-white/20 transition-all scale-100";
      } else {
        btn.className =
          "flex flex-col items-center justify-center py-2 px-0.5 rounded-2xl text-nexus-muted hover:text-white hover:bg-white/5 border border-transparent transition-all";
      }
    }
  };

  for (const tab of TABS) {
    const b = document.createElement("button");
    b.className = "flex flex-col items-center justify-center py-2 px-0.5 rounded-2xl transition-all";
    b.innerHTML = `
      <span class="text-lg leading-none mb-1">${tab.icon}</span>
      <span class="text-[10px] tracking-tight truncate leading-tight">${tab.label}</span>
    `;
    b.onclick = () => {
      tapFeedback(14, 1100);
      show(tab);
    };
    tabButtons.set(tab.id, b);
    nav.appendChild(b);
  }

  root.append(bar, content, nav);
  show(TABS[0]); // Démarrer sur le trackpad
}
