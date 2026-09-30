import {
  connect,
  onStatus,
  onError,
  isReconnecting,
  type Status,
  type ConnectionConfig,
} from "./core/ws-client";
import { tapFeedback } from "./core/haptics";
import { openSettingsModal } from "./core/settings";
import { showToast } from "./core/toast";
import {
  scanLocalNetwork,
  probeHost,
  pairWithPin,
  type DiscoveredHost,
} from "./core/discovery";
import { renderTrackpad } from "./modules/trackpad";
import { renderMedia } from "./modules/media";
import { renderTvRemote } from "./modules/tv-remote";
import { renderKeyboard } from "./modules/keyboard";
import { renderMacrodeck } from "./modules/macrodeck";
import { renderSlides } from "./modules/slides";
import { renderPower } from "./modules/power";

/** Lit la configuration depuis l'URL ou le localStorage */
function readConfig(): ConnectionConfig | null {
  const q = new URLSearchParams(location.search);
  const code = q.get("code") ?? localStorage.getItem("nexus.code");

  // Priorité 1 : Code PIN Cloud (mode AnyDesk)
  if (code && code.replace(/\D/g, "").length === 6) {
    const cleanCode = code.replace(/\D/g, "");
    const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
    const key = hashParams.get("k") ?? localStorage.getItem("nexus.key") ?? undefined;
    localStorage.setItem("nexus.code", cleanCode);
    if (key) localStorage.setItem("nexus.key", key);
    return { mode: "cloud", code: cleanCode, key };
  }

  // Priorité 2 : Mode Local direct par IP
  const host = q.get("host") ?? localStorage.getItem("nexus.host");
  const port = q.get("ws") ?? localStorage.getItem("nexus.port");
  const token = q.get("token") ?? localStorage.getItem("nexus.token");
  if (host && port && token) {
    localStorage.setItem("nexus.host", host);
    localStorage.setItem("nexus.port", port);
    localStorage.setItem("nexus.token", token);
    return { host, port: Number(port), token, mode: "local" };
  }

  return null;
}

export function bootstrap(root: HTMLElement): void {
  onError((msg) => {
    showToast(msg, "warning");
    if (msg.includes("déconnecté par l'ordinateur hôte") || !isReconnecting()) {
      showDisconnectOverlay(root);
    }
  });

  const cfg = readConfig();
  if (cfg) {
    connect(cfg);
    mountShell(root);
  } else {
    mountConnect(root);
  }
}

/** Écran d'accueil et d'appairage multi-mode : Auto-Détection Wi-Fi, Code PIN Bluetooth-style, Cloud AnyDesk */
function mountConnect(root: HTMLElement): void {
  root.className = "h-full flex items-center justify-center p-4 sm:p-6 relative overflow-hidden select-none";

  let activeTab: "lan" | "cloud" | "manual" = "lan";
  let discovered: DiscoveredHost[] = [];
  let isScanning = false;
  let selectedDevice: DiscoveredHost | null = null;

  function renderView(): void {
    root.innerHTML = "";

    // Lueur d'ambiance d'arrière-plan
    const glow = document.createElement("div");
    glow.className =
      "absolute -top-32 left-1/2 -translate-x-1/2 w-96 h-96 bg-nexus-accent/20 rounded-full blur-3xl pointer-events-none";
    root.appendChild(glow);

    const card = document.createElement("div");
    card.className =
      "glass-panel-elevated w-full max-w-sm rounded-3xl p-5 sm:p-7 flex flex-col gap-4 relative z-10 border border-white/10 shadow-2xl max-h-[92vh] overflow-y-auto no-scrollbar";

    // Si l'utilisateur est en train de saisir le code PIN pour un PC spécifique
    if (selectedDevice) {
      renderPinPrompt(card, selectedDevice);
      root.appendChild(card);
      return;
    }

    // 1. En-tête
    const header = document.createElement("div");
    header.className = "text-center";
    header.innerHTML = `
      <div class="w-14 h-14 rounded-2xl bg-gradient-to-tr from-[#6d5efc] to-[#00f2fe] mx-auto flex items-center justify-center shadow-[0_0_24px_rgba(109,94,252,0.5)] mb-2.5">
        <span class="text-2xl">🌐</span>
      </div>
      <h1 class="text-xl font-black tracking-tight text-white">Nexus Remote</h1>
      <p class="text-nexus-muted text-xs mt-0.5">Appairage & Détection Automatique</p>
    `;

    // 2. Sélecteur d'onglets (Détection Wi-Fi vs Cloud vs Manuel)
    const tabsWrap = document.createElement("div");
    tabsWrap.className = "flex p-1 bg-white/5 rounded-2xl border border-white/5 text-[11px] font-bold";

    const btnLan = document.createElement("button");
    btnLan.className = `flex-1 py-2 rounded-xl transition ${
      activeTab === "lan" ? "bg-nexus-accent text-white shadow-md" : "text-nexus-muted hover:text-white"
    }`;
    btnLan.innerHTML = "📡 Wi-Fi Local";
    btnLan.onclick = () => {
      tapFeedback(10);
      activeTab = "lan";
      renderView();
      if (discovered.length === 0) triggerScan();
    };

    const btnCloud = document.createElement("button");
    btnCloud.className = `flex-1 py-2 rounded-xl transition ${
      activeTab === "cloud" ? "bg-nexus-accent text-white shadow-md" : "text-nexus-muted hover:text-white"
    }`;
    btnCloud.innerHTML = "☁️ Cloud PIN";
    btnCloud.onclick = () => {
      tapFeedback(10);
      activeTab = "cloud";
      renderView();
    };

    const btnManual = document.createElement("button");
    btnManual.className = `flex-1 py-2 rounded-xl transition ${
      activeTab === "manual" ? "bg-nexus-accent text-white shadow-md" : "text-nexus-muted hover:text-white"
    }`;
    btnManual.innerHTML = "⚙️ Manuel";
    btnManual.onclick = () => {
      tapFeedback(10);
      activeTab = "manual";
      renderView();
    };

    tabsWrap.append(btnLan, btnCloud, btnManual);
    card.append(header, tabsWrap);

    // 3. Contenu selon l'onglet actif
    if (activeTab === "lan") {
      renderLanTab(card);
    } else if (activeTab === "cloud") {
      renderCloudTab(card);
    } else {
      renderManualTab(card);
    }

    root.appendChild(card);
  }

  // ── ONGLET 1 : DÉTECTION WI-FI LOCALE & APPAIRAGE PAR PIN ──
  function renderLanTab(card: HTMLElement): void {
    const wrap = document.createElement("div");
    wrap.className = "flex flex-col gap-3";

    // Barre d'état de scan
    const scanHeader = document.createElement("div");
    scanHeader.className = "flex items-center justify-between px-1";
    scanHeader.innerHTML = `
      <div class="flex items-center gap-1.5 text-xs text-slate-300 font-semibold">
        <span class="${isScanning ? "animate-spin" : ""}">📡</span>
        <span>Appareils sur votre réseau</span>
      </div>
    `;

    const rescanBtn = document.createElement("button");
    rescanBtn.className =
      "px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] font-bold text-nexus-accent transition border border-white/5";
    rescanBtn.textContent = isScanning ? "Recherche…" : "🔄 Actualiser";
    rescanBtn.disabled = isScanning;
    rescanBtn.onclick = () => triggerScan();
    scanHeader.appendChild(rescanBtn);

    wrap.appendChild(scanHeader);

    // Liste des appareils trouvés
    const listWrap = document.createElement("div");
    listWrap.className = "flex flex-col gap-2 min-h-[120px]";

    if (discovered.length === 0) {
      if (isScanning) {
        listWrap.innerHTML = `
          <div class="p-6 rounded-2xl border border-white/5 bg-white/[0.02] flex flex-col items-center justify-center gap-2 text-center">
            <div class="w-8 h-8 rounded-full border-2 border-nexus-accent border-t-transparent animate-spin"></div>
            <p class="text-xs text-slate-300 font-medium mt-1">Recherche d'ordinateurs sur le Wi-Fi…</p>
            <p class="text-[10px] text-nexus-muted">Vérifiez que Nexus Remote All est lancé sur votre PC</p>
          </div>
        `;
      } else {
        listWrap.innerHTML = `
          <div class="p-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] text-center flex flex-col gap-1.5">
            <span class="text-2xl opacity-60">🔍</span>
            <p class="text-xs text-slate-300 font-medium">Aucun PC détecté automatiquement</p>
            <p class="text-[10px] text-nexus-muted">Même réseau Wi-Fi requis. Vous pouvez aussi taper l'adresse IP ci-dessous :</p>
          </div>
        `;
      }
    } else {
      discovered.forEach((dev) => {
        const item = document.createElement("div");
        item.className =
          "p-3 rounded-2xl bg-white/5 border border-white/10 hover:border-nexus-accent/60 flex items-center justify-between gap-2 transition cursor-pointer group shadow-sm active:scale-[0.99]";
        item.innerHTML = `
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-9 h-9 rounded-xl bg-nexus-accent/20 border border-nexus-accent/40 flex items-center justify-center text-base shrink-0 group-hover:bg-nexus-accent transition">
              🖥️
            </div>
            <div class="flex flex-col min-w-0 leading-tight">
              <span class="text-xs font-bold text-white truncate flex items-center gap-1.5">
                ${dev.hostname || "PC Nexus"}
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
              </span>
              <span class="text-[10px] font-mono text-nexus-muted">${dev.ip}</span>
            </div>
          </div>
          <button class="shrink-0 px-3 py-1.5 rounded-xl bg-nexus-accent hover:bg-nexus-accent-hover text-white text-[11px] font-bold shadow-md transition flex items-center gap-1">
            <span>Associer</span>
            <span>🔑</span>
          </button>
        `;
        item.onclick = () => {
          tapFeedback(15);
          selectedDevice = dev;
          renderView();
        };
        listWrap.appendChild(item);
      });
    }

    wrap.appendChild(listWrap);

    // Formulaire rapide par IP si la détection automatique échoue
    const manualIpBox = document.createElement("div");
    manualIpBox.className = "pt-2 border-t border-white/5 flex flex-col gap-1.5";
    manualIpBox.innerHTML = `
      <label class="text-[10px] font-bold text-nexus-muted uppercase tracking-wider">
        Ou rechercher une IP précise :
      </label>
    `;

    const ipForm = document.createElement("form");
    ipForm.className = "flex gap-2";
    ipForm.innerHTML = `
      <input id="quick-ip" placeholder="ex: 192.168.1.180" class="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/20 outline-none focus:border-nexus-accent font-mono" />
      <button type="submit" class="btn-accent px-3 py-2 text-xs font-bold rounded-xl whitespace-nowrap">
        Sonder
      </button>
    `;
    ipForm.onsubmit = async (e) => {
      e.preventDefault();
      const input = ipForm.querySelector<HTMLInputElement>("#quick-ip")!;
      const targetIp = input.value.trim();
      if (!targetIp) return;
      showToast(`Sondage de ${targetIp}…`, "info", 1200);
      const res = await probeHost(targetIp);
      if (res) {
        selectedDevice = res;
        renderView();
      } else {
        showToast("Aucun agent Nexus détecté à cette adresse IP", "warning", 2500);
      }
    };
    manualIpBox.appendChild(ipForm);
    wrap.appendChild(manualIpBox);

    card.appendChild(wrap);
  }

  // ── SOUS-VUE : SAISIE DU CODE PIN STYLE BLUETOOTH POUR LE PC SÉLECTIONNÉ ──
  function renderPinPrompt(card: HTMLElement, device: DiscoveredHost): void {
    const wrap = document.createElement("div");
    wrap.className = "flex flex-col gap-4";

    const topBar = document.createElement("div");
    topBar.className = "flex items-center gap-2.5";
    const backBtn = document.createElement("button");
    backBtn.className =
      "w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 text-white flex items-center justify-center text-xs transition border border-white/5";
    backBtn.innerHTML = "◀";
    backBtn.title = "Retour à la liste";
    backBtn.onclick = () => {
      tapFeedback(12);
      selectedDevice = null;
      renderView();
    };

    const hostInfo = document.createElement("div");
    hostInfo.className = "flex flex-col leading-tight min-w-0";
    hostInfo.innerHTML = `
      <span class="text-xs font-bold text-white truncate flex items-center gap-1.5">
        <span>🖥️</span> <span>${device.hostname || "PC Nexus"}</span>
      </span>
      <span class="text-[10px] font-mono text-nexus-muted">${device.ip} • Port ${device.httpPort}</span>
    `;

    topBar.append(backBtn, hostInfo);
    wrap.appendChild(topBar);

    // Carte explicative du code PIN
    const pinNotice = document.createElement("div");
    pinNotice.className =
      "p-3.5 rounded-2xl bg-gradient-to-b from-nexus-accent/15 to-transparent border border-nexus-accent/30 text-center flex flex-col items-center gap-1";
    pinNotice.innerHTML = `
      <span class="text-xl">🔑</span>
      <p class="text-xs font-bold text-slate-100">Code d'appairage à 6 chiffres</p>
      <p class="text-[10.5px] text-nexus-muted leading-tight">
        Regardez l'écran de votre ordinateur, le code PIN est affiché sous le QR Code.
      </p>
    `;
    wrap.appendChild(pinNotice);

    // Formulaire de saisie du PIN
    const pinForm = document.createElement("form");
    pinForm.className = "flex flex-col gap-3";

    const pinInput = document.createElement("input");
    pinInput.type = "text";
    pinInput.inputMode = "numeric";
    pinInput.maxLength = 7;
    pinInput.placeholder = "000 000";
    pinInput.autofocus = true;
    pinInput.className =
      "w-full bg-white/5 border border-white/15 rounded-2xl p-3.5 text-2xl font-mono font-black text-center tracking-[0.25em] text-white placeholder-white/20 outline-none focus:border-nexus-accent focus:shadow-[0_0_20px_rgba(109,94,252,0.3)] transition";

    pinInput.oninput = () => {
      let raw = pinInput.value.replace(/\D/g, "");
      if (raw.length > 6) raw = raw.slice(0, 6);
      if (raw.length > 3) {
        pinInput.value = `${raw.slice(0, 3)} ${raw.slice(3)}`;
      } else {
        pinInput.value = raw;
      }
    };

    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className =
      "btn-accent font-bold text-xs py-3.5 flex items-center justify-center gap-2 shadow-[0_4px_20px_rgba(109,94,252,0.4)]";
    submitBtn.innerHTML = `
      <span>Valider l'association</span>
      <span>→</span>
    `;

    pinForm.append(pinInput, submitBtn);

    pinForm.onsubmit = async (e) => {
      e.preventDefault();
      tapFeedback(20);
      const cleanPin = pinInput.value.replace(/\D/g, "");
      if (cleanPin.length !== 6) {
        showToast("Le code PIN doit comporter 6 chiffres", "warning", 2000);
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span>Vérification…</span>`;

      const result = await pairWithPin(device.ip, device.httpPort, cleanPin);
      if (result.ok && result.token) {
        tapFeedback(35, 1400);
        showToast("Appairage réussi !", "success", 1500);

        localStorage.setItem("nexus.host", device.ip);
        localStorage.setItem("nexus.port", String(result.wsPort || device.wsPort));
        localStorage.setItem("nexus.token", result.token);
        localStorage.setItem("nexus.hostname", result.hostname || device.hostname);

        connect({
          mode: "local",
          host: device.ip,
          port: result.wsPort || device.wsPort,
          token: result.token,
        });
        mountShell(root);
      } else {
        tapFeedback(25, 800);
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>Valider l'association</span> <span>→</span>`;
        showToast(result.error || "Code PIN incorrect.", "warning", 3000);
        pinInput.focus();
        pinInput.select();
      }
    };

    wrap.appendChild(pinForm);
    card.appendChild(wrap);
  }

  // ── ONGLET 2 : CODE CLOUD (ANYDESK INTERNET) ──
  function renderCloudTab(card: HTMLElement): void {
    const wrap = document.createElement("form");
    wrap.className = "flex flex-col gap-3.5";
    wrap.innerHTML = `
      <div>
        <label class="text-[11px] font-semibold text-nexus-muted uppercase tracking-wider mb-1.5 block text-center">
          Code Relais Cloud (Hors Wi-Fi)
        </label>
        <input id="cloud-pin" name="code" placeholder="ex: 842 195" maxlength="8" autofocus
          class="w-full bg-white/5 border border-white/10 rounded-2xl p-3.5 text-2xl font-mono font-bold text-center tracking-[0.25em] text-white placeholder-white/20 outline-none focus:border-nexus-accent focus:shadow-[0_0_20px_rgba(109,94,252,0.3)] transition" />
      </div>

      <button type="submit" class="btn-accent font-bold text-sm py-3.5 flex items-center justify-center gap-2 shadow-[0_4px_20px_rgba(109,94,252,0.4)]">
        <span>Se connecter via Cloud</span>
        <span>→</span>
      </button>

      <p class="text-[11px] text-nexus-muted text-center leading-relaxed">
        💡 Permet de contrôler votre PC à distance même sur un réseau 4G/5G distinct.
      </p>
    `;

    const pinInput = wrap.querySelector<HTMLInputElement>("#cloud-pin")!;
    pinInput.oninput = () => {
      let raw = pinInput.value.replace(/\D/g, "");
      if (raw.length > 6) raw = raw.slice(0, 6);
      if (raw.length > 3) {
        pinInput.value = `${raw.slice(0, 3)} ${raw.slice(3)}`;
      } else {
        pinInput.value = raw;
      }
    };

    wrap.onsubmit = (e) => {
      e.preventDefault();
      tapFeedback(20);
      const code = pinInput.value.replace(/\D/g, "");
      if (code.length !== 6) {
        showToast("Veuillez saisir un code PIN valide à 6 chiffres", "warning");
        return;
      }

      localStorage.setItem("nexus.code", code);
      localStorage.setItem("nexus.host", `PC [${code.slice(0, 3)}-${code.slice(3)}]`);
      connect({ mode: "cloud", code });
      mountShell(root);
    };

    card.appendChild(wrap);
  }

  // ── ONGLET 3 : CONNEXION MANUELLE AVANCÉE ──
  function renderManualTab(card: HTMLElement): void {
    const wrap = document.createElement("form");
    wrap.className = "flex flex-col gap-3";
    wrap.innerHTML = `
      <div>
        <label class="text-[11px] font-semibold text-nexus-muted uppercase tracking-wider mb-1 block">Adresse IP</label>
        <input name="host" placeholder="192.168.1.180" value="${location.hostname !== 'localhost' ? location.hostname : ''}"
          class="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white placeholder-white/30 outline-none focus:border-nexus-accent font-mono transition" />
      </div>

      <div class="grid grid-cols-3 gap-2">
        <div class="col-span-1">
          <label class="text-[11px] font-semibold text-nexus-muted uppercase tracking-wider mb-1 block">Port WS</label>
          <input name="port" placeholder="4701" value="4701" inputmode="numeric"
            class="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white placeholder-white/30 outline-none focus:border-nexus-accent font-mono transition text-center" />
        </div>
        <div class="col-span-2">
          <label class="text-[11px] font-semibold text-nexus-muted uppercase tracking-wider mb-1 block">Code PIN PC</label>
          <input name="pin" placeholder="ex: 582 914" maxlength="7"
            class="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 text-xs text-white placeholder-white/30 outline-none focus:border-nexus-accent font-mono transition text-center" />
        </div>
      </div>

      <button type="submit" class="btn-accent mt-2 font-bold text-xs py-3 flex items-center justify-center gap-2">
        <span>Connexion Directe</span>
        <span>→</span>
      </button>
    `;

    wrap.onsubmit = async (e) => {
      e.preventDefault();
      tapFeedback(20);
      const data = new FormData(wrap);
      const host = String(data.get("host")).trim();
      const port = Number(data.get("port")) || 4701;
      const pin = String(data.get("pin")).replace(/\D/g, "");

      if (!host) {
        showToast("Veuillez renseigner une adresse IP", "warning");
        return;
      }

      if (pin && pin.length === 6) {
        showToast("Vérification du PIN…", "info", 1000);
        const pairRes = await pairWithPin(host, 4700, pin);
        if (pairRes.ok && pairRes.token) {
          localStorage.setItem("nexus.host", host);
          localStorage.setItem("nexus.port", String(pairRes.wsPort || port));
          localStorage.setItem("nexus.token", pairRes.token);
          connect({ mode: "local", host, port: pairRes.wsPort || port, token: pairRes.token });
          mountShell(root);
          return;
        } else {
          showToast(pairRes.error || "Code PIN invalide", "warning");
          return;
        }
      }

      const existingToken = localStorage.getItem("nexus.token") || "";
      if (existingToken) {
        localStorage.setItem("nexus.host", host);
        localStorage.setItem("nexus.port", String(port));
        connect({ mode: "local", host, port, token: existingToken });
        mountShell(root);
      } else {
        showToast("Veuillez entrer le Code PIN affiché sur le PC", "warning");
      }
    };

    card.appendChild(wrap);
  }

  // Déclenche le scan réseau en arrière-plan
  async function triggerScan(): Promise<void> {
    if (isScanning) return;
    isScanning = true;
    renderView();

    try {
      await scanLocalNetwork((device) => {
        // Ajout en direct sans doublons
        if (!discovered.some((d) => d.ip === device.ip)) {
          discovered.push(device);
          renderView();
        }
      });
    } catch {}

    isScanning = false;
    renderView();
  }

  // Démarrage initial : rendu et scan immédiat
  renderView();
  triggerScan();
}

const TABS = [
  { id: "trackpad", label: "Souris", icon: "🖱️", render: renderTrackpad },
  { id: "media", label: "TV / Média", icon: "📺", render: renderMedia },
  { id: "tv-remote", label: "Hisense", icon: "🛰️", render: renderTvRemote },
  { id: "keyboard", label: "Clavier", icon: "⌨️", render: renderKeyboard },
  { id: "macrodeck", label: "Deck", icon: "🎛️", render: renderMacrodeck },
  { id: "slides", label: "Diapo", icon: "📊", render: renderSlides },
  { id: "power", label: "Système", icon: "⚡", render: renderPower },
];

/** Overlay plein écran lorsque le PC hôte interrompt la session */
function showDisconnectOverlay(root: HTMLElement): void {
  const existing = document.getElementById("nexus-disconnect-overlay");
  if (existing) return;

  const overlay = document.createElement("div");
  overlay.id = "nexus-disconnect-overlay";
  overlay.className =
    "fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-6 text-center animate-fadeIn";

  const box = document.createElement("div");
  box.className =
    "glass-panel-elevated max-w-xs w-full p-6 rounded-3xl border border-white/10 flex flex-col items-center gap-4 shadow-2xl";

  const icon = document.createElement("div");
  icon.className =
    "w-16 h-16 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-3xl shadow-[0_0_20px_rgba(244,63,94,0.3)]";
  icon.textContent = "🛑";

  const title = document.createElement("h2");
  title.className = "text-lg font-bold text-white tracking-wide";
  title.textContent = "Session interrompue";

  const desc = document.createElement("p");
  desc.className = "text-xs text-nexus-muted leading-relaxed";
  desc.textContent =
    "Votre appareil a été déconnecté par l'ordinateur hôte. Vous ne pouvez plus contrôler ce PC sans un nouvel appairage.";

  const btn = document.createElement("button");
  btn.className =
    "w-full py-3 px-4 rounded-xl bg-nexus-accent hover:bg-nexus-accent-hover text-white font-semibold text-xs tracking-wider shadow-lg shadow-nexus-accent/30 transition transform active:scale-95";
  btn.textContent = "🔄 Reconnecter / Scanner";
  btn.onclick = () => {
    tapFeedback(15);
    try {
      localStorage.removeItem("nexus.token");
      localStorage.removeItem("nexus.code");
      if (typeof history !== "undefined" && history.replaceState) {
        history.replaceState(null, "", location.pathname);
      }
    } catch {}
    overlay.remove();
    mountConnect(root);
  };

  box.append(icon, title, desc, btn);
  overlay.appendChild(box);
  root.appendChild(overlay);
}

/** Shell principal ultra-moderne Dark Glassmorphism */
function mountShell(root: HTMLElement): void {
  root.className = "h-full flex flex-col justify-between overflow-hidden";
  root.innerHTML = "";

  const savedHost = localStorage.getItem("nexus.hostname") || localStorage.getItem("nexus.host") || "PC Connecté";

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

  const settingsBtn = document.createElement("button");
  settingsBtn.className =
    "p-2 rounded-xl text-nexus-muted hover:text-white bg-white/5 hover:bg-white/10 border border-white/5 transition flex items-center justify-center text-sm";
  settingsBtn.title = "Paramètres de la télécommande";
  settingsBtn.innerHTML = "⚙️";
  settingsBtn.onclick = () => {
    tapFeedback(12);
    openSettingsModal();
  };

  const disconnectBtn = document.createElement("button");
  disconnectBtn.className =
    "p-2 rounded-xl text-nexus-muted hover:text-rose-300 bg-white/5 hover:bg-rose-500/15 border border-white/5 transition flex items-center justify-center text-sm";
  disconnectBtn.title = "Se déconnecter";
  disconnectBtn.innerHTML = "🚪";
  disconnectBtn.onclick = () => {
    tapFeedback(20);
    if (confirm("Se déconnecter de la session actuelle ?")) {
      localStorage.removeItem("nexus.token");
      localStorage.removeItem("nexus.code");
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
      if (!isReconnecting()) {
        statusLabel.textContent = "Déconnecté par l'hôte";
        statusLabel.className = "text-[10px] text-rose-400 font-semibold";
        showDisconnectOverlay(root);
      } else {
        statusLabel.textContent = "Déconnecté — tentative…";
        statusLabel.className = "text-[10px] text-rose-400 font-medium";
      }
    }
  });

  // 2. Zone de contenu principal des modules
  const content = document.createElement("main");
  content.className = "flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 no-scrollbar relative z-10";

  // 3. Barre de navigation ergonomique en bas (onglets tactiles, largeur auto-adaptée)
  const nav = document.createElement("nav");
  nav.className =
    "glass-panel grid gap-1 p-1.5 border-t border-white/5 pb-safe z-20 shadow-[0_-8px_24px_rgba(0,0,0,0.4)]";
  nav.style.gridTemplateColumns = `repeat(${TABS.length}, minmax(0, 1fr))`;

  let activeTabId = "trackpad";
  const tabButtons: Map<string, HTMLButtonElement> = new Map();

  const show = (tab: (typeof TABS)[number]) => {
    activeTabId = tab.id;
    content.innerHTML = "";
    content.scrollTop = 0;
    tab.render(content);

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
  show(TABS[0]);
}
