import { send } from "../../core/ws-client";
import { tapFeedback } from "../../core/haptics";
import type { MediaKey } from "@shared/protocol";

function mediaBtn(
  label: string,
  key: MediaKey,
  sublabel?: string,
  cls = "btn",
  pitch = 1200,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.innerHTML = sublabel
    ? `<span class="text-base">${label}</span><span class="text-[9px] text-nexus-muted tracking-tight leading-none">${sublabel}</span>`
    : label;
  b.onclick = () => {
    tapFeedback(15, pitch);
    send({ type: "media:key", key });
  };
  return b;
}

export function renderMedia(root: HTMLElement): void {
  const wrap = document.createElement("div");
  wrap.className = "flex flex-col gap-5 max-w-sm mx-auto items-center pb-2 select-none";

  // 1. Navigation Système TV (Accueil, Retour, Menu)
  const navBar = document.createElement("div");
  navBar.className = "grid grid-cols-3 gap-2 w-full";
  navBar.append(
    mediaBtn("↩", "back", "Retour", "btn flex flex-col items-center py-2.5 gap-0.5", 1100),
    mediaBtn("🏠", "home", "Accueil", "btn flex flex-col items-center py-2.5 gap-0.5", 1300),
    mediaBtn("☰", "menu", "Menu", "btn flex flex-col items-center py-2.5 gap-0.5", 1000),
  );

  // 2. D-Pad Circulaire Style Apple TV Remote
  const dpadContainer = document.createElement("div");
  dpadContainer.className =
    "relative w-64 h-64 rounded-full glass-panel-elevated p-2 border border-white/10 flex items-center justify-center shadow-[0_12px_32px_rgba(0,0,0,0.6)] my-1";

  // Bouton Haut
  const btnUp = document.createElement("button");
  btnUp.className =
    "absolute top-2 left-1/2 -translate-x-1/2 w-28 h-14 flex items-center justify-center text-xl text-slate-200 hover:text-white active:scale-90 active:brightness-150 transition-all rounded-t-full";
  btnUp.innerHTML = "▲";
  btnUp.onclick = () => {
    tapFeedback(14, 1350);
    send({ type: "media:key", key: "up" });
  };

  // Bouton Bas
  const btnDown = document.createElement("button");
  btnDown.className =
    "absolute bottom-2 left-1/2 -translate-x-1/2 w-28 h-14 flex items-center justify-center text-xl text-slate-200 hover:text-white active:scale-90 active:brightness-150 transition-all rounded-b-full";
  btnDown.innerHTML = "▼";
  btnDown.onclick = () => {
    tapFeedback(14, 1050);
    send({ type: "media:key", key: "down" });
  };

  // Bouton Gauche
  const btnLeft = document.createElement("button");
  btnLeft.className =
    "absolute left-2 top-1/2 -translate-y-1/2 h-28 w-14 flex items-center justify-center text-xl text-slate-200 hover:text-white active:scale-90 active:brightness-150 transition-all rounded-l-full";
  btnLeft.innerHTML = "◀";
  btnLeft.onclick = () => {
    tapFeedback(14, 1150);
    send({ type: "media:key", key: "left" });
  };

  // Bouton Droite
  const btnRight = document.createElement("button");
  btnRight.className =
    "absolute right-2 top-1/2 -translate-y-1/2 h-28 w-14 flex items-center justify-center text-xl text-slate-200 hover:text-white active:scale-90 active:brightness-150 transition-all rounded-r-full";
  btnRight.innerHTML = "▶";
  btnRight.onclick = () => {
    tapFeedback(14, 1250);
    send({ type: "media:key", key: "right" });
  };

  // Bouton Central OK surélevé
  const btnOk = document.createElement("button");
  btnOk.className =
    "w-20 h-20 rounded-full bg-gradient-to-tr from-[#6d5efc] via-[#7b6dff] to-[#5a48ef] text-white font-black text-base shadow-[0_4px_20px_rgba(109,94,252,0.5)] border border-white/20 active:scale-90 active:brightness-125 transition-all flex items-center justify-center z-10";
  btnOk.textContent = "OK";
  btnOk.onclick = () => {
    tapFeedback(22, 1500);
    send({ type: "media:key", key: "ok" });
  };

  dpadContainer.append(btnUp, btnDown, btnLeft, btnRight, btnOk);

  // 3. Contrôle de Volume & Lecture
  const controlsGrid = document.createElement("div");
  controlsGrid.className = "grid grid-cols-2 gap-3 w-full";

  // Colonne Volume (Rocker élégant)
  const volBox = document.createElement("div");
  volBox.className =
    "glass-panel rounded-2xl p-2.5 flex flex-col gap-2 items-center justify-between border border-white/5";

  const volTitle = document.createElement("span");
  volTitle.className = "text-[10px] uppercase font-bold text-nexus-muted tracking-wider";
  volTitle.textContent = "Volume";

  const volActions = document.createElement("div");
  volActions.className = "flex items-center gap-1.5 w-full";

  const btnVolDown = mediaBtn("🔉 -", "voldown", undefined, "btn flex-1 py-2 text-xs font-bold", 1000);
  const btnMute = mediaBtn("🔇", "mute", undefined, "btn px-3 py-2 text-xs", 1100);
  const btnVolUp = mediaBtn("🔊 +", "volup", undefined, "btn flex-1 py-2 text-xs font-bold", 1400);

  volActions.append(btnVolDown, btnMute, btnVolUp);
  volBox.append(volTitle, volActions);

  // Colonne Lecture / Pause (Transport Média)
  const playBox = document.createElement("div");
  playBox.className =
    "glass-panel rounded-2xl p-2.5 flex flex-col gap-2 items-center justify-between border border-white/5";

  const playTitle = document.createElement("span");
  playTitle.className = "text-[10px] uppercase font-bold text-nexus-muted tracking-wider";
  playTitle.textContent = "Lecteur";

  const playActions = document.createElement("div");
  playActions.className = "flex items-center gap-1.5 w-full";

  const btnPrev = mediaBtn("⏮", "prev", undefined, "btn flex-1 py-2 text-xs", 1150);
  const btnPlay = mediaBtn("⏯", "play", undefined, "btn-accent flex-1 py-2 text-sm font-bold", 1450);
  const btnNext = mediaBtn("⏭", "next", undefined, "btn flex-1 py-2 text-xs", 1250);

  playActions.append(btnPrev, btnPlay, btnNext);
  playBox.append(playTitle, playActions);

  controlsGrid.append(volBox, playBox);

  // Touche Stop d'appoint
  const bottomBar = document.createElement("div");
  bottomBar.className = "w-full flex justify-center";
  const stopBtn = mediaBtn("⏹ Stop média", "stop", undefined, "btn text-xs py-2 px-6 text-nexus-muted hover:text-white", 900);
  bottomBar.appendChild(stopBtn);

  wrap.append(navBar, dpadContainer, controlsGrid, bottomBar);
  root.appendChild(wrap);
}
