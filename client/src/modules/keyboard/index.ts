import { send } from "../../core/ws-client";
import { tapFeedback } from "../../core/haptics";
import { showToast } from "../../core/toast";

function keyChip(
  label: string,
  shortcut: string,
  onTap: () => void,
  isAccent = false,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = isAccent
    ? "btn-accent flex items-center justify-between px-3 py-2 text-xs font-semibold"
    : "btn flex items-center justify-between px-3 py-2 text-xs text-slate-200 hover:text-white bg-white/5 border border-white/5";
  b.innerHTML = `
    <span class="font-medium">${label}</span>
    <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-nexus-muted ml-1.5 border border-white/5">${shortcut}</span>
  `;
  b.onclick = () => {
    tapFeedback(12, 1250);
    onTap();
  };
  return b;
}

function arrowBtn(symbol: string, key: string, label: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "btn flex flex-col items-center justify-center p-2 text-base active:scale-95";
  b.innerHTML = `
    <span class="font-bold leading-none">${symbol}</span>
    <span class="text-[8px] text-nexus-muted mt-0.5 uppercase">${label}</span>
  `;
  b.onclick = () => {
    tapFeedback(10, 1100);
    send({ type: "key:tap", key });
  };
  return b;
}

export function renderKeyboard(root: HTMLElement): void {
  const wrap = document.createElement("div");
  wrap.className = "flex flex-col gap-4 max-w-md mx-auto pb-2";

  // 1. Zone de saisie directe stylisée
  const inputCard = document.createElement("div");
  inputCard.className =
    "glass-panel rounded-2xl p-3 flex flex-col gap-2 border border-white/10 relative shadow-[0_4px_20px_rgba(0,0,0,0.3)]";

  const inputHeader = document.createElement("div");
  inputHeader.className = "flex items-center justify-between text-xs";
  inputHeader.innerHTML = `
    <div class="flex items-center gap-1.5">
      <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
      <span class="text-[11px] font-semibold text-slate-300">Saisie en direct & Dictée</span>
    </div>
  `;

  const clearBtn = document.createElement("button");
  clearBtn.className =
    "text-[11px] text-nexus-muted hover:text-rose-400 bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded-lg border border-white/5 transition";
  clearBtn.textContent = "✕ Effacer";

  inputHeader.appendChild(clearBtn);

  const textarea = document.createElement("textarea");
  textarea.className =
    "w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-slate-100 placeholder-white/25 outline-none focus:border-nexus-accent resize-none h-20 font-sans transition select-text";
  textarea.placeholder = "Tapez ici ou utilisez le micro de votre smartphone pour dicter au PC...";
  textarea.autocapitalize = "sentences";

  clearBtn.onclick = () => {
    textarea.value = "";
    textarea.focus();
    tapFeedback(10);
  };

  // Envoi de la frappe en temps réel
  textarea.addEventListener("beforeinput", (e: Event) => {
    const ev = e as InputEvent;
    if (ev.inputType === "insertText" && ev.data) {
      tapFeedback(8, 1400);
      send({ type: "key:text", text: ev.data });
    } else if (ev.inputType === "insertLineBreak") {
      tapFeedback(14, 1100);
      send({ type: "key:tap", key: "Enter" });
    } else if (ev.inputType === "deleteContentBackward") {
      tapFeedback(10, 900);
      send({ type: "key:tap", key: "Backspace" });
    } else if (ev.data) {
      send({ type: "key:text", text: ev.data });
    }
  });

  // Bouton envoyer bloc complet (utile pour texte collé volumineux)
  const sendBlockBtn = document.createElement("button");
  sendBlockBtn.className =
    "self-end text-[11px] text-nexus-accent hover:text-white font-semibold flex items-center gap-1 transition";
  sendBlockBtn.innerHTML = `<span>Envoyer tout le texte</span> <span>↗</span>`;
  sendBlockBtn.onclick = () => {
    const text = textarea.value;
    if (text) {
      send({ type: "key:text", text });
      showToast("Texte envoyé à l'hôte", "success", 1500);
      textarea.value = "";
    }
  };

  inputCard.append(inputHeader, textarea, sendBlockBtn);

  // 2. Touches Principales de contrôle (Entrée, Suppr, Tab, Échap)
  const primaryKeys = document.createElement("div");
  primaryKeys.className = "grid grid-cols-4 gap-2";

  const btnEnter = document.createElement("button");
  btnEnter.className = "btn-accent py-2.5 text-xs font-bold flex items-center justify-center gap-1";
  btnEnter.innerHTML = `<span>⏎</span><span>Entrée</span>`;
  btnEnter.onclick = () => {
    tapFeedback(15, 1450);
    send({ type: "key:tap", key: "Enter" });
  };

  const btnBackspace = document.createElement("button");
  btnBackspace.className = "btn py-2.5 text-xs font-semibold flex items-center justify-center gap-1";
  btnBackspace.innerHTML = `<span>⌫</span><span>Suppr</span>`;
  btnBackspace.onclick = () => {
    tapFeedback(12, 950);
    send({ type: "key:tap", key: "Backspace" });
  };

  const btnTab = document.createElement("button");
  btnTab.className = "btn py-2.5 text-xs font-semibold flex items-center justify-center gap-1";
  btnTab.innerHTML = `<span>⇥</span><span>Tab</span>`;
  btnTab.onclick = () => {
    tapFeedback(10, 1200);
    send({ type: "key:tap", key: "Tab" });
  };

  const btnEsc = document.createElement("button");
  btnEsc.className = "btn py-2.5 text-xs font-semibold flex items-center justify-center gap-1";
  btnEsc.innerHTML = `<span>⎋</span><span>Échap</span>`;
  btnEsc.onclick = () => {
    tapFeedback(12, 1000);
    send({ type: "key:tap", key: "Escape" });
  };

  primaryKeys.append(btnEnter, btnBackspace, btnTab, btnEsc);

  // 3. Raccourcis d'Édition & Presse-Papier sous forme de chips
  const editSection = document.createElement("div");
  editSection.className = "flex flex-col gap-1.5";

  const editTitle = document.createElement("span");
  editTitle.className = "text-[10px] uppercase font-bold text-nexus-muted tracking-wider px-1";
  editTitle.textContent = "Édition & Presse-papier";

  const editGrid = document.createElement("div");
  editGrid.className = "grid grid-cols-2 gap-2";
  editGrid.append(
    keyChip("Copier", "Ctrl+C", () => send({ type: "key:combo", keys: ["LeftControl", "C"] })),
    keyChip("Coller", "Ctrl+V", () => send({ type: "key:combo", keys: ["LeftControl", "V"] })),
    keyChip("Annuler", "Ctrl+Z", () => send({ type: "key:combo", keys: ["LeftControl", "Z"] })),
    keyChip("Tout sél.", "Ctrl+A", () => send({ type: "key:combo", keys: ["LeftControl", "A"] })),
  );

  editSection.append(editTitle, editGrid);

  // 4. Raccourcis Système (Alt+Tab, Bureau, Windows)
  const sysSection = document.createElement("div");
  sysSection.className = "flex flex-col gap-1.5";

  const sysTitle = document.createElement("span");
  sysTitle.className = "text-[10px] uppercase font-bold text-nexus-muted tracking-wider px-1";
  sysTitle.textContent = "Navigation Système";

  const sysGrid = document.createElement("div");
  sysGrid.className = "grid grid-cols-3 gap-2";
  sysGrid.append(
    keyChip("Alt + Tab", "Changer app", () => send({ type: "key:combo", keys: ["LeftAlt", "Tab"] })),
    keyChip("Bureau", "Win+D", () => send({ type: "key:combo", keys: ["LeftSuper", "D"] })),
    keyChip("Windows", "⊞ Start", () => send({ type: "key:tap", key: "LeftSuper" })),
  );

  sysSection.append(sysTitle, sysGrid);

  // 5. Pavé Directionnel (Flèches pour positionner le curseur)
  const arrowsCard = document.createElement("div");
  arrowsCard.className = "flex items-center justify-between glass-panel rounded-2xl p-2.5 px-4 border border-white/5";

  const arrowLabel = document.createElement("div");
  arrowLabel.className = "flex flex-col";
  arrowLabel.innerHTML = `
    <span class="text-xs font-semibold text-slate-200">Curseur texte</span>
    <span class="text-[10px] text-nexus-muted">Flèches de direction</span>
  `;

  const arrowCluster = document.createElement("div");
  arrowCluster.className = "grid grid-cols-3 gap-1.5 w-36";
  const emptyCell = () => {
    const d = document.createElement("div");
    return d;
  };

  arrowCluster.append(
    emptyCell(),
    arrowBtn("▲", "ArrowUp", "Haut"),
    emptyCell(),
    arrowBtn("◀", "ArrowLeft", "G"),
    arrowBtn("▼", "ArrowDown", "Bas"),
    arrowBtn("▶", "ArrowRight", "D"),
  );

  arrowsCard.append(arrowLabel, arrowCluster);

  wrap.append(inputCard, primaryKeys, editSection, sysSection, arrowsCard);
  root.appendChild(wrap);
}
