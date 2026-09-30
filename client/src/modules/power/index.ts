import { send } from "../../core/ws-client";
import { tapFeedback, buzz } from "../../core/haptics";
import { showToast } from "../../core/toast";
import type { SystemAction } from "@shared/protocol";

export function renderPower(root: HTMLElement): void {
  const wrap = document.createElement("div");
  wrap.className = "flex flex-col gap-5 max-w-md mx-auto pb-4";

  // 1. Section Wake-on-LAN (Allumage réseau)
  const wolCard = document.createElement("div");
  wolCard.className =
    "glass-panel rounded-3xl p-4 flex flex-col gap-3 border border-white/10 shadow-[0_6px_24px_rgba(0,0,0,0.3)]";
  wolCard.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-lg">⚡</span>
        <h2 class="text-xs font-bold text-slate-200 uppercase tracking-wider">Allumage à Distance (Wake-on-LAN)</h2>
      </div>
      <span class="text-[10px] text-nexus-muted bg-white/5 px-2 py-0.5 rounded-full border border-white/5">Paquet magique</span>
    </div>
    <p class="text-[11px] text-nexus-muted">
      Allumez l'ordinateur à distance sur le réseau local via son adresse physique MAC.
    </p>
    <div class="flex gap-2">
      <input id="mac-input" placeholder="AA:BB:CC:DD:EE:FF"
        class="bg-black/40 border border-white/10 rounded-xl p-3 text-xs flex-1 outline-none font-mono text-slate-100 placeholder-white/20 focus:border-nexus-accent transition tracking-widest uppercase" />
      <button id="wol-btn" class="btn-accent px-4 py-2.5 text-xs font-bold whitespace-nowrap flex items-center gap-1.5 shadow-[0_4px_16px_rgba(109,94,252,0.4)]">
        <span>⚡</span>
        <span>Réveiller</span>
      </button>
    </div>
  `;

  const macInput = wolCard.querySelector<HTMLInputElement>("#mac-input")!;
  const wolBtn = wolCard.querySelector<HTMLButtonElement>("#wol-btn")!;
  macInput.value = localStorage.getItem("nexus.mac") ?? "";

  wolBtn.onclick = () => {
    tapFeedback(25, 1400);
    const mac = macInput.value.trim().toUpperCase();
    if (!mac) {
      showToast("Veuillez renseigner une adresse MAC valide", "warning");
      macInput.focus();
      return;
    }
    localStorage.setItem("nexus.mac", mac);
    send({ type: "system:action", action: "wol", mac });
    showToast(`Paquet magique WOL envoyé à ${mac}`, "success", 2500);
  };

  // 2. Section Gestion de Session (Actions immédiates sûres)
  const sessionCard = document.createElement("div");
  sessionCard.className = "flex flex-col gap-2.5";

  const sessionHeader = document.createElement("div");
  sessionHeader.className = "flex items-center gap-2 px-1";
  sessionHeader.innerHTML = `
    <span class="w-1.5 h-3.5 bg-nexus-accent rounded-full"></span>
    <h2 class="text-xs font-bold text-slate-200 tracking-wide uppercase">Contrôle de Session</h2>
  `;

  const sessionGrid = document.createElement("div");
  sessionGrid.className = "grid grid-cols-2 gap-3";

  // Verrouiller
  const lockBtn = document.createElement("button");
  lockBtn.className =
    "glass-panel btn flex flex-col items-center justify-center gap-2 p-4 border border-white/10";
  lockBtn.innerHTML = `
    <span class="text-3xl">🔒</span>
    <div class="text-center">
      <div class="text-xs font-bold text-white">Verrouiller</div>
      <div class="text-[10px] text-nexus-muted">Bloque la session actuelle</div>
    </div>
  `;
  lockBtn.onclick = () => {
    tapFeedback(20, 1200);
    send({ type: "system:action", action: "lock" });
    showToast("Session verrouillée", "info", 1500);
  };

  // Veille
  const sleepBtn = document.createElement("button");
  sleepBtn.className =
    "glass-panel btn flex flex-col items-center justify-center gap-2 p-4 border border-white/10";
  sleepBtn.innerHTML = `
    <span class="text-3xl">🌙</span>
    <div class="text-center">
      <div class="text-xs font-bold text-white">Mise en veille</div>
      <div class="text-[10px] text-nexus-muted">Économie d'énergie</div>
    </div>
  `;
  sleepBtn.onclick = () => {
    tapFeedback(20, 1000);
    send({ type: "system:action", action: "sleep" });
    showToast("Mise en veille en cours...", "info", 1500);
  };

  sessionGrid.append(lockBtn, sleepBtn);
  sessionCard.append(sessionHeader, sessionGrid);

  // 3. Section Zone Haute Sécurité (Redémarrage & Extinction)
  const dangerCard = document.createElement("div");
  dangerCard.className =
    "rounded-3xl p-4 bg-gradient-to-b from-[#241113] to-[#14080a] border border-rose-900/40 flex flex-col gap-3 shadow-[0_6px_24px_rgba(225,29,72,0.15)]";

  const dangerHeader = document.createElement("div");
  dangerHeader.className = "flex items-center justify-between";
  dangerHeader.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="text-base text-rose-400">⚠️</span>
      <h2 class="text-xs font-bold text-rose-300 uppercase tracking-wider">Zone Critique</h2>
    </div>
    <span class="text-[10px] font-semibold text-rose-400/80 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">
      Confirmation requise
    </span>
  `;

  const dangerGrid = document.createElement("div");
  dangerGrid.className = "grid grid-cols-2 gap-3";

  // Redémarrer
  const restartBtn = document.createElement("button");
  restartBtn.className =
    "btn flex flex-col items-center justify-center gap-2 p-4 bg-[#231508] border border-amber-600/30 text-amber-300 hover:border-amber-500/60";
  restartBtn.innerHTML = `
    <span class="text-3xl">🔄</span>
    <div class="text-center">
      <div class="text-xs font-bold text-amber-200">Redémarrer</div>
      <div class="text-[10px] text-amber-400/60">Reboot complet</div>
    </div>
  `;
  restartBtn.onclick = () => {
    tapFeedback(25, 1150);
    askConfirmation("Redémarrer l'ordinateur ?", "restart");
  };

  // Éteindre
  const shutdownBtn = document.createElement("button");
  shutdownBtn.className =
    "btn flex flex-col items-center justify-center gap-2 p-4 bg-[#260a0d] border border-rose-600/40 text-rose-300 hover:border-rose-500/60";
  shutdownBtn.innerHTML = `
    <span class="text-3xl">🛑</span>
    <div class="text-center">
      <div class="text-xs font-bold text-rose-200">Arrêter le PC</div>
      <div class="text-[10px] text-rose-400/60">Extinction complète</div>
    </div>
  `;
  shutdownBtn.onclick = () => {
    tapFeedback(30, 900);
    askConfirmation("Arrêter complètement l'ordinateur ?", "shutdown");
  };

  dangerGrid.append(restartBtn, shutdownBtn);
  dangerCard.append(dangerHeader, dangerGrid);

  wrap.append(wolCard, sessionCard, dangerCard);
  root.appendChild(wrap);

  // Modale de Confirmation Haute Sécurité
  function askConfirmation(message: string, action: SystemAction) {
    buzz([40, 60, 40]);
    const modal = document.createElement("div");
    modal.className =
      "fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-5 z-50 animate-fade-in";
    modal.innerHTML = `
      <div class="glass-panel-elevated border border-rose-500/40 rounded-3xl p-6 max-w-sm w-full flex flex-col gap-4 text-center shadow-[0_16px_40px_rgba(244,63,94,0.3)]">
        <div class="w-16 h-16 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center mx-auto text-3xl">
          ⚠️
        </div>
        <div>
          <h3 class="text-base font-bold text-white">${message}</h3>
          <p class="text-xs text-nexus-muted mt-1 leading-relaxed">
            Cette action prendra effet immédiatement. Tous les programmes non sauvegardés seront fermés sur l'ordinateur hôte.
          </p>
        </div>
        <div class="grid grid-cols-2 gap-3 mt-1">
          <button id="cancel-btn" class="btn text-xs font-semibold py-3 border border-white/10">
            Annuler
          </button>
          <button id="confirm-btn" class="bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white rounded-2xl py-3 text-xs font-bold shadow-[0_4px_16px_rgba(225,29,72,0.4)] active:scale-95 transition-all">
            Confirmer l'action
          </button>
        </div>
      </div>
    `;

    modal.querySelector("#cancel-btn")!.addEventListener("click", () => {
      tapFeedback(12);
      modal.remove();
    });

    modal.querySelector("#confirm-btn")!.addEventListener("click", () => {
      buzz([80, 40, 100]);
      send({ type: "system:action", action });
      showToast(action === "restart" ? "Redémarrage lancé..." : "Arrêt en cours...", "warning", 3000);
      modal.remove();
    });

    document.body.appendChild(modal);
  }
}
