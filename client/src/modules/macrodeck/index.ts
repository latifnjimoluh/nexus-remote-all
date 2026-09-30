import { send } from "../../core/ws-client";
import { tapFeedback } from "../../core/haptics";
import { showToast } from "../../core/toast";

interface StreamTile {
  id: string;
  label: string;
  sublabel: string;
  icon: string;
  colorClass: string;
  borderClass: string;
  glowClass: string;
  onTrigger: () => void;
}

export function renderMacrodeck(root: HTMLElement): void {
  const wrap = document.createElement("div");
  wrap.className = "flex flex-col gap-6 max-w-md mx-auto pb-4";

  // Section 1 : Applications de Streaming & Média
  const APP_TILES: StreamTile[] = [
    {
      id: "youtube",
      label: "YouTube",
      sublabel: "Vidéo & Musique",
      icon: "▶️",
      colorClass: "from-[#2b0c0c] to-[#160606] text-red-400",
      borderClass: "border-red-500/40 hover:border-red-500",
      glowClass: "shadow-[0_6px_20px_rgba(239,68,68,0.2)]",
      onTrigger: () => send({ type: "launch:app", target: "youtube" }),
    },
    {
      id: "netflix",
      label: "Netflix",
      sublabel: "Films & Séries",
      icon: "🎬",
      colorClass: "from-[#2e080b] to-[#170507] text-rose-500",
      borderClass: "border-rose-600/40 hover:border-rose-600",
      glowClass: "shadow-[0_6px_20px_rgba(225,29,72,0.2)]",
      onTrigger: () => send({ type: "launch:app", target: "netflix" }),
    },
    {
      id: "spotify",
      label: "Spotify",
      sublabel: "Streaming Audio",
      icon: "🎧",
      colorClass: "from-[#082a17] to-[#04160c] text-emerald-400",
      borderClass: "border-emerald-500/40 hover:border-emerald-500",
      glowClass: "shadow-[0_6px_20px_rgba(16,185,129,0.2)]",
      onTrigger: () => send({ type: "launch:app", target: "spotify" }),
    },
    {
      id: "steam",
      label: "Steam",
      sublabel: "Bibliothèque Jeux",
      icon: "🎮",
      colorClass: "from-[#0f2438] to-[#07131e] text-sky-400",
      borderClass: "border-sky-500/40 hover:border-sky-500",
      glowClass: "shadow-[0_6px_20px_rgba(14,165,233,0.2)]",
      onTrigger: () => send({ type: "launch:app", target: "steam" }),
    },
    {
      id: "chrome",
      label: "Chrome",
      sublabel: "Navigateur Web",
      icon: "🌐",
      colorClass: "from-[#092938] to-[#04151d] text-cyan-400",
      borderClass: "border-cyan-500/40 hover:border-cyan-500",
      glowClass: "shadow-[0_6px_20px_rgba(6,182,212,0.2)]",
      onTrigger: () => send({ type: "launch:app", target: "chrome" }),
    },
    {
      id: "vlc",
      label: "VLC",
      sublabel: "Lecteur Média",
      icon: "🎦",
      colorClass: "from-[#331c08] to-[#1a0e04] text-orange-400",
      borderClass: "border-orange-500/40 hover:border-orange-500",
      glowClass: "shadow-[0_6px_20px_rgba(249,115,22,0.2)]",
      onTrigger: () => send({ type: "launch:app", target: "vlc" }),
    },
    {
      id: "explorer",
      label: "Fichiers",
      sublabel: "Explorateur PC",
      icon: "📁",
      colorClass: "from-[#0b2440] to-[#051424] text-blue-400",
      borderClass: "border-blue-500/40 hover:border-blue-500",
      glowClass: "shadow-[0_6px_20px_rgba(59,130,246,0.2)]",
      onTrigger: () => send({ type: "launch:app", target: "explorer" }),
    },
  ];

  // Section 2 : Raccourcis Système & Outils de Streamer
  const TOOL_TILES: StreamTile[] = [
    {
      id: "screenshot",
      label: "Capture",
      sublabel: "Zone d'écran",
      icon: "📸",
      colorClass: "from-[#2f2208] to-[#181104] text-amber-300",
      borderClass: "border-amber-500/40 hover:border-amber-500",
      glowClass: "shadow-[0_6px_20px_rgba(245,158,11,0.2)]",
      onTrigger: () =>
        send({ type: "key:combo", keys: ["LeftSuper", "LeftShift", "S"] }),
    },
    {
      id: "fullscreen",
      label: "Plein Écran",
      sublabel: "Mode F11",
      icon: "⛶",
      colorClass: "from-[#22173a] to-[#110a1f] text-purple-300",
      borderClass: "border-purple-500/40 hover:border-purple-500",
      glowClass: "shadow-[0_6px_20px_rgba(168,85,247,0.2)]",
      onTrigger: () => send({ type: "key:tap", key: "F11" }),
    },
    {
      id: "discord_mute",
      label: "Mute Micro",
      sublabel: "Discord / Apps",
      icon: "🎙️",
      colorClass: "from-[#351025] to-[#1c0813] text-pink-400",
      borderClass: "border-pink-500/40 hover:border-pink-500",
      glowClass: "shadow-[0_6px_20px_rgba(236,72,153,0.2)]",
      onTrigger: () =>
        send({ type: "key:combo", keys: ["LeftControl", "LeftShift", "M"] }),
    },
    {
      id: "desktop",
      label: "Bureau",
      sublabel: "Win + D",
      icon: "🖥️",
      colorClass: "from-[#0d2a20] to-[#051510] text-teal-300",
      borderClass: "border-teal-500/40 hover:border-teal-500",
      glowClass: "shadow-[0_6px_20px_rgba(20,184,166,0.2)]",
      onTrigger: () => send({ type: "key:combo", keys: ["LeftSuper", "D"] }),
    },
    {
      id: "alttab",
      label: "Basculer App",
      sublabel: "Alt + Tab",
      icon: "🔁",
      colorClass: "from-[#1d1f3b] to-[#0e0f1f] text-indigo-300",
      borderClass: "border-indigo-500/40 hover:border-indigo-500",
      glowClass: "shadow-[0_6px_20px_rgba(99,102,241,0.2)]",
      onTrigger: () => send({ type: "key:combo", keys: ["LeftAlt", "Tab"] }),
    },
  ];

  function createSection(title: string, count: number, tiles: StreamTile[]): HTMLElement {
    const section = document.createElement("section");
    section.className = "flex flex-col gap-2.5";

    const header = document.createElement("div");
    header.className = "flex items-center justify-between px-1";
    header.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="w-1.5 h-3.5 bg-nexus-accent rounded-full"></span>
        <h2 class="text-xs font-bold text-slate-200 tracking-wide uppercase">${title}</h2>
      </div>
      <span class="text-[10px] font-mono text-nexus-muted px-2 py-0.5 rounded-full bg-white/5 border border-white/5">
        ${count} touches
      </span>
    `;

    const grid = document.createElement("div");
    grid.className = "grid grid-cols-3 gap-2.5";

    for (const tile of tiles) {
      const b = document.createElement("button");
      b.className = `streamdeck-tile btn flex flex-col items-center justify-center p-3 gap-1.5 bg-gradient-to-b ${tile.colorClass} border ${tile.borderClass} ${tile.glowClass}`;
      b.innerHTML = `
        <span class="text-2xl drop-shadow-md leading-none">${tile.icon}</span>
        <span class="text-xs font-bold tracking-tight text-white leading-tight truncate w-full text-center">${tile.label}</span>
        <span class="text-[9px] text-white/50 tracking-tight truncate w-full text-center leading-none">${tile.sublabel}</span>
      `;

      b.onclick = () => {
        tapFeedback(22, 1350);
        tile.onTrigger();
        showToast(`${tile.label} lancé`, "info", 1400);
      };

      grid.appendChild(b);
    }

    section.append(header, grid);
    return section;
  }

  wrap.append(
    createSection("Lanceur d'Applications", APP_TILES.length, APP_TILES),
    createSection("Raccourcis & Streamer Tools", TOOL_TILES.length, TOOL_TILES),
  );

  root.appendChild(wrap);
}
