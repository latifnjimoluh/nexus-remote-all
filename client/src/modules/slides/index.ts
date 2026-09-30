import { send } from "../../core/ws-client";
import { tapFeedback, buzz } from "../../core/haptics";
import { showToast } from "../../core/toast";

let timerInterval: ReturnType<typeof setInterval> | null = null;
let secondsElapsed = 0;
let isTimerRunning = false;

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function renderSlides(root: HTMLElement): void {
  const wrap = document.createElement("div");
  wrap.className = "flex flex-col gap-3 max-w-md mx-auto h-full justify-between pb-2 select-none";

  // En-tête explicatif du mode Présentation
  const infoBanner = document.createElement("div");
  infoBanner.className =
    "glass-panel rounded-2xl px-3 py-2 border border-white/10 flex items-center justify-between text-xs";
  infoBanner.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="text-base">📊</span>
      <div class="flex flex-col">
        <span class="font-bold text-slate-200 text-[11px]">Télécommande Présentation</span>
        <span class="text-[10px] text-nexus-muted">Pour PowerPoint, Google Slides, Keynote, PDF</span>
      </div>
    </div>
    <span class="px-2 py-0.5 rounded-full bg-nexus-accent/20 border border-nexus-accent/40 text-nexus-accent font-semibold text-[10px]">Diapo</span>
  `;

  // 1. Chronomètre Orateur Numérique (Style LED / Scène)
  const timerCard = document.createElement("div");
  timerCard.className =
    "glass-panel-elevated rounded-3xl p-3 flex flex-col items-center justify-center gap-2 border border-white/10 shadow-[0_8px_30px_rgba(0,0,0,0.5)]";

  const timerHeader = document.createElement("div");
  timerHeader.className = "flex items-center justify-between w-full px-2";

  const timerTitle = document.createElement("div");
  timerTitle.className = "flex items-center gap-2";
  timerTitle.innerHTML = `
    <span class="text-sm">⏱️</span>
    <span class="text-[11px] font-bold uppercase text-nexus-muted tracking-wider">Chronomètre Exposé</span>
  `;

  const statusBadge = document.createElement("span");
  statusBadge.className = isTimerRunning
    ? "px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-[10px] font-bold flex items-center gap-1"
    : "px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-nexus-muted text-[10px] font-bold flex items-center gap-1";
  statusBadge.innerHTML = isTimerRunning
    ? `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> EN COURS`
    : `<span class="w-1.5 h-1.5 rounded-full bg-slate-500"></span> PAUSE`;

  timerHeader.append(timerTitle, statusBadge);

  const timerDisplay = document.createElement("div");
  timerDisplay.className =
    "text-5xl font-mono font-black tracking-widest text-slate-100 py-1 drop-shadow-[0_0_18px_rgba(109,94,252,0.4)]";
  timerDisplay.textContent = formatTime(secondsElapsed);

  const timerControls = document.createElement("div");
  timerControls.className = "flex gap-2 w-full max-w-xs mt-1";

  const startPauseBtn = document.createElement("button");
  startPauseBtn.className = isTimerRunning
    ? "btn flex-1 py-2 text-xs font-bold text-amber-300 border-amber-500/30"
    : "btn-accent flex-1 py-2 text-xs font-bold";
  startPauseBtn.textContent = isTimerRunning ? "⏸ Pause" : "▶ Démarrer";

  const resetBtn = document.createElement("button");
  resetBtn.className = "btn px-4 py-2 text-xs font-semibold text-nexus-muted hover:text-white";
  resetBtn.textContent = "↺ Reset";

  startPauseBtn.onclick = () => {
    tapFeedback(15, 1300);
    if (isTimerRunning) {
      if (timerInterval) clearInterval(timerInterval);
      isTimerRunning = false;
      startPauseBtn.textContent = "▶ Reprendre";
      startPauseBtn.className = "btn-accent flex-1 py-2 text-xs font-bold";
      statusBadge.className =
        "px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-400 text-[10px] font-bold flex items-center gap-1";
      statusBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span> PAUSE`;
    } else {
      isTimerRunning = true;
      startPauseBtn.textContent = "⏸ Pause";
      startPauseBtn.className = "btn flex-1 py-2 text-xs font-bold text-amber-300 border-amber-500/30";
      statusBadge.className =
        "px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-[10px] font-bold flex items-center gap-1";
      statusBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> EN COURS`;

      timerInterval = setInterval(() => {
        secondsElapsed++;
        timerDisplay.textContent = formatTime(secondsElapsed);
      }, 1000);
    }
  };

  resetBtn.onclick = () => {
    tapFeedback(18, 900);
    if (timerInterval) clearInterval(timerInterval);
    isTimerRunning = false;
    secondsElapsed = 0;
    timerDisplay.textContent = "00:00";
    startPauseBtn.textContent = "▶ Démarrer";
    startPauseBtn.className = "btn-accent flex-1 py-2 text-xs font-bold";
    statusBadge.className =
      "px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-nexus-muted text-[10px] font-bold flex items-center gap-1";
    statusBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-slate-500"></span> ARRÊT`;
  };

  timerControls.append(startPauseBtn, resetBtn);
  timerCard.append(timerHeader, timerDisplay, timerControls);

  // 2. Boutons Géants XXL Tactiles (Manipulation aveugle sécurisée)
  const navSection = document.createElement("div");
  navSection.className = "grid grid-cols-2 gap-3 flex-1 min-h-[200px]";

  const prevBtn = document.createElement("button");
  prevBtn.className =
    "glass-panel rounded-3xl flex flex-col items-center justify-center gap-3 p-4 border border-white/10 active:scale-95 active:brightness-125 transition-all shadow-[0_8px_24px_rgba(0,0,0,0.4)]";
  prevBtn.innerHTML = `
    <span class="text-5xl font-black text-slate-300">◀</span>
    <span class="text-sm font-bold tracking-wide text-slate-300 uppercase">Précédent</span>
  `;
  prevBtn.onclick = () => {
    buzz(25);
    tapFeedback(25, 1100);
    send({ type: "slide:prev" });
  };

  const nextBtn = document.createElement("button");
  nextBtn.className =
    "btn-accent rounded-3xl flex flex-col items-center justify-center gap-3 p-4 active:scale-95 active:brightness-110 transition-all shadow-[0_8px_32px_rgba(109,94,252,0.5)]";
  nextBtn.innerHTML = `
    <span class="text-5xl font-black text-white">▶</span>
    <span class="text-sm font-black tracking-wide text-white uppercase">Suivant</span>
  `;
  nextBtn.onclick = () => {
    buzz(35);
    tapFeedback(35, 1400);
    send({ type: "slide:next" });
  };

  navSection.append(prevBtn, nextBtn);

  // 3. Commandes Spéciales Orateur (Écran Noir B, Diaporama F5, Échap)
  const quickActions = document.createElement("div");
  quickActions.className = "grid grid-cols-3 gap-2";

  // Bouton F5
  const startShowBtn = document.createElement("button");
  startShowBtn.className = "btn flex flex-col items-center justify-center py-2.5 gap-1 text-xs font-semibold";
  startShowBtn.innerHTML = `
    <span class="text-base">▶️</span>
    <span>Lancer (F5)</span>
  `;
  startShowBtn.onclick = () => {
    tapFeedback(20, 1300);
    send({ type: "slide:start" });
    showToast("Diaporama lancé (F5)", "info", 1500);
  };

  // Bouton Écran Noir (B) très contrasté
  const blackBtn = document.createElement("button");
  blackBtn.className =
    "btn flex flex-col items-center justify-center py-2.5 gap-1 text-xs font-bold bg-black/90 border border-amber-500/40 text-amber-300 hover:border-amber-400";
  blackBtn.innerHTML = `
    <span class="text-base">⬛</span>
    <span>Écran Noir (B)</span>
  `;
  blackBtn.onclick = () => {
    tapFeedback(25, 1000);
    send({ type: "slide:black" });
    showToast("Bascule Écran Noir (B)", "warning", 1500);
  };

  // Bouton Quitter (Échap)
  const endBtn = document.createElement("button");
  endBtn.className = "btn flex flex-col items-center justify-center py-2.5 gap-1 text-xs font-semibold text-rose-300";
  endBtn.innerHTML = `
    <span class="text-base">⏹</span>
    <span>Quitter (Échap)</span>
  `;
  endBtn.onclick = () => {
    tapFeedback(20, 950);
    send({ type: "slide:end" });
    showToast("Sortie du diaporama", "info", 1500);
  };

  quickActions.append(startShowBtn, blackBtn, endBtn);

  wrap.append(timerCard, navSection, quickActions);
  root.appendChild(wrap);
}
