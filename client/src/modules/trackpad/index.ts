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
    <span class="text-[11px] font-medium text-slate-300">Trackpad Tactile Précision</span>
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
  padContainer.id = "trackpad";
  padContainer.className =
    "relative flex-1 rounded-3xl glass-panel border border-white/10 flex flex-col items-center justify-center overflow-hidden touch-none select-none shadow-[inset_0_2px_8px_rgba(0,0,0,0.4)]";

  // Repère visuel central et gestes tactiles
  const centerGuide = document.createElement("div");
  centerGuide.className =
    "flex flex-col items-center justify-center gap-2 pointer-events-none opacity-40 select-none text-center px-4";
  centerGuide.innerHTML = `
    <div class="w-14 h-14 rounded-full border border-dashed border-white/30 flex items-center justify-center">
      <span class="text-2xl opacity-60">👆</span>
    </div>
    <p class="text-xs font-medium text-slate-300 tracking-wide">Zone tactile haute précision</p>
    <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-nexus-muted mt-1">
      <span>• 1 doigt = Curseur</span>
      <span>• Tap 1 doigt = Clic Gauche</span>
      <span>• 2 doigts = Défilement</span>
      <span>• Tap 2 doigts = Clic Droit</span>
    </div>
  `;

  // Curseur/Feedback visuel lumineux sous le doigt
  const pointerPill = document.createElement("div");
  pointerPill.className =
    "absolute w-12 h-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-nexus-accent/30 border border-nexus-accent/60 blur-[2px] pointer-events-none opacity-0 transition-opacity duration-150";

  padContainer.append(centerGuide, pointerPill);

  // État du trackpad tactile multi-touch
  let lastSingle: { x: number; y: number } | null = null;
  let lastMid: { x: number; y: number } | null = null;
  let maxTouchCount = 0;
  let moved = false;
  let startTime = 0;
  let scrollAccumY = 0;
  let scrollAccumX = 0;

  // ── GESTION DE LA COALESCENCE & DU BRIDAGE (Feature 15: rAF / 60 Hz) ──
  let pendingDx = 0;
  let pendingDy = 0;
  let rafMoveId: number | null = null;
  let lastMoveSendTime = 0;
  const MIN_MOVE_INTERVAL_MS = 16; // Cible 60 Hz (~16.6 ms)

  const requestFrame =
    typeof requestAnimationFrame !== "undefined"
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => setTimeout(cb, 16) as unknown as number;

  const cancelFrame =
    typeof cancelAnimationFrame !== "undefined"
      ? cancelAnimationFrame
      : (id: number) => clearTimeout(id);

  function flushPendingMove(): void {
    if (pendingDx === 0 && pendingDy === 0) return;
    const toSendX = Math.round(pendingDx);
    const toSendY = Math.round(pendingDy);
    pendingDx -= toSendX;
    pendingDy -= toSendY;
    if (toSendX !== 0 || toSendY !== 0) {
      send({
        type: "mouse:move",
        dx: toSendX,
        dy: toSendY,
      });
    }
  }

  function scheduleFlushMove(): void {
    if (rafMoveId !== null) return;
    rafMoveId = requestFrame(() => {
      rafMoveId = null;
      const now = performance.now();
      if (now - lastMoveSendTime >= MIN_MOVE_INTERVAL_MS) {
        lastMoveSendTime = now;
        flushPendingMove();
      } else {
        scheduleFlushMove();
      }
    });
  }

  padContainer.addEventListener(
    "touchstart",
    (e) => {
      const count = e.touches.length;
      maxTouchCount = Math.max(maxTouchCount, count);
      startTime = Date.now();
      const rect = padContainer.getBoundingClientRect();

      if (count === 1) {
        const t = e.touches[0];
        lastSingle = { x: t.clientX, y: t.clientY };
        lastMid = null;

        pointerPill.style.left = `${t.clientX - rect.left}px`;
        pointerPill.style.top = `${t.clientY - rect.top}px`;
        pointerPill.style.opacity = "1";
      } else if (count >= 2) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        lastMid = {
          x: (t0.clientX + t1.clientX) / 2,
          y: (t0.clientY + t1.clientY) / 2,
        };
        lastSingle = null;
        scrollAccumY = 0;
        scrollAccumX = 0;

        pointerPill.style.left = `${lastMid.x - rect.left}px`;
        pointerPill.style.top = `${lastMid.y - rect.top}px`;
        pointerPill.style.opacity = "1";
      }
    },
    { passive: true },
  );

  padContainer.addEventListener(
    "touchmove",
    (e) => {
      if (e.cancelable) e.preventDefault();
      const count = e.touches.length;
      maxTouchCount = Math.max(maxTouchCount, count);
      const rect = padContainer.getBoundingClientRect();

      if (count >= 2) {
        // ── DÉFILEMENT À 2 DOIGTS (SCROLL MOLETTE) ──
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const midX = (t0.clientX + t1.clientX) / 2;
        const midY = (t0.clientY + t1.clientY) / 2;

        pointerPill.style.left = `${midX - rect.left}px`;
        pointerPill.style.top = `${midY - rect.top}px`;

        if (lastMid) {
          const dx = midX - lastMid.x;
          const dy = midY - lastMid.y;

          if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
            moved = true;
          }

          scrollAccumY += dy;
          scrollAccumX += dx;

          // Seuil de défilement (pixels par cran de molette PC)
          const SCROLL_THRESHOLD = 7;

          if (Math.abs(scrollAccumY) >= SCROLL_THRESHOLD) {
            const steps = Math.trunc(scrollAccumY / SCROLL_THRESHOLD);
            scrollAccumY -= steps * SCROLL_THRESHOLD;

            // Défilement naturel : glisser vers le haut (dy négatif) fait défiler la page vers le bas (steps positif)
            send({
              type: "mouse:scroll",
              dx: 0,
              dy: -steps,
            });
          }

          if (Math.abs(scrollAccumX) >= SCROLL_THRESHOLD * 2) {
            const stepsX = Math.trunc(scrollAccumX / (SCROLL_THRESHOLD * 2));
            scrollAccumX -= stepsX * (SCROLL_THRESHOLD * 2);
            send({
              type: "mouse:scroll",
              dx: stepsX,
              dy: 0,
            });
          }
        }

        lastMid = { x: midX, y: midY };
      } else if (count === 1) {
        // ── DÉPLACEMENT DU CURSEUR À 1 DOIGT ──
        const t = e.touches[0];
        pointerPill.style.left = `${t.clientX - rect.left}px`;
        pointerPill.style.top = `${t.clientY - rect.top}px`;

        if (lastSingle) {
          const dx = t.clientX - lastSingle.x;
          const dy = t.clientY - lastSingle.y;

          if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
            moved = true;
          }

          const currentSensitivity = getTrackpadSensitivity();
          pendingDx += dx * currentSensitivity;
          pendingDy += dy * currentSensitivity;
          scheduleFlushMove();
        }

        lastSingle = { x: t.clientX, y: t.clientY };
      }
    },
    { passive: false },
  );

  const handleTouchEnd = (e: TouchEvent) => {
    if (e.touches.length === 0) {
      pointerPill.style.opacity = "0";
      const duration = Date.now() - startTime;

      if (rafMoveId !== null) {
        cancelFrame(rafMoveId);
        rafMoveId = null;
      }

      // Tap court sans mouvement
      if (!moved && duration < 260) {
        pendingDx = 0;
        pendingDy = 0;
        if (maxTouchCount >= 2) {
          // Tap à 2 doigts = Clic Droit
          tapFeedback(20, 1100);
          send({ type: "mouse:click", button: "right" });
        } else {
          // Tap à 1 doigt = Clic Gauche
          tapFeedback(15, 1300);
          send({ type: "mouse:click", button: "left" });
        }
      } else {
        // En cas de mouvement normal, vider immédiatement tout résidu en attente
        flushPendingMove();
      }

      lastSingle = null;
      lastMid = null;
      maxTouchCount = 0;
      moved = false;
      scrollAccumY = 0;
      scrollAccumX = 0;
    } else if (e.touches.length === 1) {
      // Transition propre : un doigt restant ne fait pas sauter le curseur
      const t = e.touches[0];
      lastSingle = { x: t.clientX, y: t.clientY };
      lastMid = null;
      scrollAccumY = 0;
      scrollAccumX = 0;
      flushPendingMove();
    }
  };

  padContainer.addEventListener("touchend", handleTouchEnd);
  padContainer.addEventListener("touchcancel", handleTouchEnd);

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
