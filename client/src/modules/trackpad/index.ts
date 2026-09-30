import { send } from "../../core/ws-client";
import { tapFeedback } from "../../core/haptics";
import { getTrackpadSensitivity, openSettingsModal } from "../../core/settings";
import type { MouseButton } from "@shared/protocol";

export function renderTrackpad(root: HTMLElement): void {
  const wrap = document.createElement("div");
  wrap.className = "h-full flex flex-col gap-3 justify-between pb-1 max-w-lg mx-auto";

  // En-tête informatif discret avec indicateur de sensibilité
  const header = document.createElement("div");
  header.className = "flex items-center justify-between px-1 text-xs text-nexus-muted";

  const hints = document.createElement("div");
  hints.className = "flex items-center gap-1.5";
  hints.innerHTML = `
    <span class="inline-block w-2 h-2 rounded-full bg-nexus-accent animate-pulse"></span>
    <span class="text-[11px] font-medium text-slate-300">Trackpad Tactile</span>
  `;

  const sensBadge = document.createElement("button");
  const sens = getTrackpadSensitivity();
  sensBadge.className =
    "px-2 py-0.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-mono text-nexus-accent hover:text-white transition flex items-center gap-1";
  sensBadge.innerHTML = `<span>⚡ Vitesse :</span><strong>${sens.toFixed(1)}x</strong>`;
  sensBadge.title = "Ajuster la sensibilité du curseur";
  sensBadge.onclick = () => {
    tapFeedback(10);
    openSettingsModal();
  };

  header.append(hints, sensBadge);

  // Surface tactile principale
  const padContainer = document.createElement("div");
  padContainer.className =
    "relative flex-1 rounded-3xl glass-panel border border-white/10 flex flex-col items-center justify-center overflow-hidden touch-none select-none shadow-[inset_0_2px_8px_rgba(0,0,0,0.4)]";

  // Repère visuel central et texture de fond
  const centerGuide = document.createElement("div");
  centerGuide.className =
    "flex flex-col items-center justify-center gap-2 pointer-events-none opacity-40 select-none text-center px-4";
  centerGuide.innerHTML = `
    <div class="w-14 h-14 rounded-full border border-dashed border-white/30 flex items-center justify-center">
      <span class="text-2xl opacity-60">👆</span>
    </div>
    <p class="text-xs font-medium text-slate-300 tracking-wide">Zone tactile haute précision</p>
    <div class="flex items-center gap-3 text-[10px] text-nexus-muted">
      <span>• 1 doigt = Curseur</span>
      <span>• Tap = Clic G</span>
      <span>• 2 doigts = Défilement</span>
    </div>
  `;

  // Curseur/Feedback visuel lumineux sous le doigt
  const pointerPill = document.createElement("div");
  pointerPill.className =
    "absolute w-12 h-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-nexus-accent/30 border border-nexus-accent/60 blur-[2px] pointer-events-none opacity-0 transition-opacity duration-150";

  padContainer.append(centerGuide, pointerPill);

  let last: { x: number; y: number } | null = null;
  let moved = false;
  let startTime = 0;

  padContainer.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches[0];
      const rect = padContainer.getBoundingClientRect();
      last = { x: t.clientX, y: t.clientY };
      moved = false;
      startTime = Date.now();

      // Placer l'indicateur visuel
      pointerPill.style.left = `${t.clientX - rect.left}px`;
      pointerPill.style.top = `${t.clientY - rect.top}px`;
      pointerPill.style.opacity = "1";
    },
    { passive: true },
  );

  padContainer.addEventListener(
    "touchmove",
    (e) => {
      if (!last) return;
      const t = e.touches[0];
      const rect = padContainer.getBoundingClientRect();
      const dx = t.clientX - last.x;
      const dy = t.clientY - last.y;

      pointerPill.style.left = `${t.clientX - rect.left}px`;
      pointerPill.style.top = `${t.clientY - rect.top}px`;

      const currentSensitivity = getTrackpadSensitivity();

      if (e.touches.length >= 2) {
        // Deux doigts = défilement / molette fluide
        send({
          type: "mouse:scroll",
          dx: Math.round(dx / 4),
          dy: Math.round(dy / 2.5),
        });
      } else {
        // Un doigt = déplacement du curseur
        send({
          type: "mouse:move",
          dx: Math.round(dx * currentSensitivity),
          dy: Math.round(dy * currentSensitivity),
        });
      }

      last = { x: t.clientX, y: t.clientY };
      moved = true;
    },
    { passive: true },
  );

  padContainer.addEventListener("touchend", () => {
    pointerPill.style.opacity = "0";

    // Tap rapide sans mouvement = Clic gauche
    if (!moved && Date.now() - startTime < 220) {
      tapFeedback(15, 1300);
      send({ type: "mouse:click", button: "left" });
    }
    last = null;
  });

  // Barre inférieure avec boutons physiques virtuels
  const buttonRow = document.createElement("div");
  buttonRow.className = "grid grid-cols-12 gap-2 h-20";

  // 1. Bouton Clic Gauche large (pondération 6/12 = 50%)
  const leftBtn = document.createElement("button");
  leftBtn.className =
    "col-span-6 btn rounded-2xl flex flex-col items-center justify-center gap-1 active:translate-y-0.5 active:shadow-inner bg-gradient-to-b from-[#222238] to-[#151524] border border-white/10";
  leftBtn.innerHTML = `
    <span class="text-xl">👈</span>
    <span class="text-xs font-bold tracking-tight text-white">Clic Gauche</span>
  `;
  leftBtn.onclick = () => {
    tapFeedback(18, 1200);
    send({ type: "mouse:click", button: "left" });
  };

  // 2. Bouton Molette / Clic Central (pondération 2/12 = ~17%)
  const middleBtn = document.createElement("button");
  middleBtn.className =
    "col-span-2 btn rounded-2xl flex flex-col items-center justify-center gap-1 active:translate-y-0.5 active:shadow-inner bg-gradient-to-b from-[#222238] to-[#151524] border border-white/10";
  middleBtn.innerHTML = `
    <span class="text-lg">⚙️</span>
    <span class="text-[10px] font-semibold text-slate-300">Milieu</span>
  `;
  middleBtn.onclick = () => {
    tapFeedback(25, 950);
    send({ type: "mouse:click", button: "middle" });
  };

  // 3. Bouton Clic Droit (pondération 4/12 = ~33%)
  const rightBtn = document.createElement("button");
  rightBtn.className =
    "col-span-4 btn rounded-2xl flex flex-col items-center justify-center gap-1 active:translate-y-0.5 active:shadow-inner bg-gradient-to-b from-[#222238] to-[#151524] border border-white/10";
  rightBtn.innerHTML = `
    <span class="text-xl">👉</span>
    <span class="text-xs font-bold tracking-tight text-white">Clic Droit</span>
  `;
  rightBtn.onclick = () => {
    tapFeedback(20, 1100);
    send({ type: "mouse:click", button: "right" });
  };

  buttonRow.append(leftBtn, middleBtn, rightBtn);

  wrap.append(header, padContainer, buttonRow);
  root.appendChild(wrap);
}
