import { isHapticsEnabled, setHapticsEnabled, buzz, tapFeedback } from "./haptics";
import { isSoundEnabled, setSoundEnabled, playConfirmationSound } from "./audio";
import { showToast } from "./toast";

const SENSITIVITY_KEY = "nexus.trackpad_sensitivity";
const DEFAULT_SENSITIVITY = 1.6;

export function getTrackpadSensitivity(): number {
  const saved = localStorage.getItem(SENSITIVITY_KEY);
  if (!saved) return DEFAULT_SENSITIVITY;
  const num = parseFloat(saved);
  return isNaN(num) || num <= 0 ? DEFAULT_SENSITIVITY : num;
}

export function setTrackpadSensitivity(val: number): void {
  const clamped = Math.max(0.4, Math.min(3.5, val));
  localStorage.setItem(SENSITIVITY_KEY, clamped.toFixed(2));
}

/**
 * Affiche la modale des Réglages rapides Nexus Remote (Glassmorphism & Toggles)
 */
export function openSettingsModal(): void {
  const existing = document.getElementById("nexus-settings-modal");
  if (existing) existing.remove();

  let hapticsActive = isHapticsEnabled();
  let soundActive = isSoundEnabled();
  let sensitivity = getTrackpadSensitivity();

  const modal = document.createElement("div");
  modal.id = "nexus-settings-modal";
  modal.className =
    "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in";

  const host = localStorage.getItem("nexus.host") || "Serveur local";
  const port = localStorage.getItem("nexus.port") || "4701";

  modal.innerHTML = `
    <div class="glass-panel-elevated w-full max-w-sm rounded-3xl p-6 flex flex-col gap-5 border border-white/10 text-white relative">
      <!-- En-tête -->
      <div class="flex items-center justify-between pb-2 border-b border-white/10">
        <div class="flex items-center gap-2.5">
          <span class="text-2xl">⚙️</span>
          <div>
            <h2 class="text-base font-bold tracking-tight">Réglages Nexus</h2>
            <p class="text-[11px] text-nexus-muted">Sensations tactiles & Sensibilité</p>
          </div>
        </div>
        <button id="modal-close" class="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-sm font-bold text-slate-300">
          ✕
        </button>
      </div>

      <!-- Options Toggles -->
      <div class="flex flex-col gap-3.5">
        <!-- Vibration haptique -->
        <div class="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5">
          <div class="flex items-center gap-3">
            <span class="text-xl">📳</span>
            <div>
              <div class="text-xs font-semibold">Vibrations haptiques</div>
              <div class="text-[10px] text-nexus-muted">Retours tactiles lors des clics</div>
            </div>
          </div>
          <button id="toggle-haptics" class="w-12 h-6 rounded-full transition-colors relative ${hapticsActive ? "bg-nexus-accent" : "bg-white/20"}">
            <span class="absolute top-0.5 ${hapticsActive ? "right-1" : "left-1"} w-5 h-5 rounded-full bg-white transition-all shadow-md"></span>
          </button>
        </div>

        <!-- Clics sonores télécommande -->
        <div class="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5">
          <div class="flex items-center gap-3">
            <span class="text-xl">🔊</span>
            <div>
              <div class="text-xs font-semibold">Micro-clics sonores</div>
              <div class="text-[10px] text-nexus-muted">Simulation mécanique de télécommande</div>
            </div>
          </div>
          <button id="toggle-sound" class="w-12 h-6 rounded-full transition-colors relative ${soundActive ? "bg-nexus-accent" : "bg-white/20"}">
            <span class="absolute top-0.5 ${soundActive ? "right-1" : "left-1"} w-5 h-5 rounded-full bg-white transition-all shadow-md"></span>
          </button>
        </div>

        <!-- Sensibilité curseur trackpad -->
        <div class="flex flex-col gap-2 p-3.5 rounded-2xl bg-white/5 border border-white/5">
          <div class="flex items-center justify-between text-xs">
            <div class="flex items-center gap-2">
              <span class="text-base">🖱️</span>
              <span class="font-semibold">Vitesse du curseur</span>
            </div>
            <span id="sensitivity-value" class="font-mono text-nexus-accent font-bold px-2 py-0.5 rounded-md bg-nexus-accent/15 border border-nexus-accent/30 text-xs">
              ${sensitivity.toFixed(1)}x
            </span>
          </div>
          <input id="sensitivity-range" type="range" min="0.6" max="3.0" step="0.1" value="${sensitivity}"
            class="w-full h-2 bg-nexus-panel2 rounded-lg appearance-none cursor-pointer accent-[#6d5efc] mt-1" />
          <div class="flex justify-between text-[10px] text-nexus-muted px-0.5">
            <span>Précis (0.6x)</span>
            <span>Normal (1.6x)</span>
            <span>Rapide (3.0x)</span>
          </div>
        </div>
      </div>

      <!-- Info Connexion -->
      <div class="p-3 rounded-2xl bg-black/30 border border-white/5 flex items-center justify-between text-[11px] text-nexus-muted">
        <span>Hôte connecté :</span>
        <span class="font-mono text-slate-200">${host}:${port}</span>
      </div>

      <!-- Bouton Tester retour sensoriel -->
      <div class="flex gap-2">
        <button id="btn-test-feedback" class="btn flex-1 text-xs font-semibold py-2.5">
          🔔 Tester le feedback
        </button>
        <button id="btn-save-settings" class="btn-accent px-5 text-xs font-bold py-2.5">
          Valider
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const close = () => {
    tapFeedback(10);
    modal.classList.add("opacity-0", "transition-opacity", "duration-150");
    setTimeout(() => modal.remove(), 160);
  };

  modal.querySelector("#modal-close")?.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  // Toggle Haptique
  const toggleHapticsBtn = modal.querySelector<HTMLButtonElement>("#toggle-haptics")!;
  toggleHapticsBtn.onclick = () => {
    hapticsActive = !hapticsActive;
    setHapticsEnabled(hapticsActive);
    toggleHapticsBtn.className = `w-12 h-6 rounded-full transition-colors relative ${hapticsActive ? "bg-nexus-accent" : "bg-white/20"}`;
    toggleHapticsBtn.innerHTML = `<span class="absolute top-0.5 ${hapticsActive ? "right-1" : "left-1"} w-5 h-5 rounded-full bg-white transition-all shadow-md"></span>`;
    if (hapticsActive) buzz(20);
  };

  // Toggle Son
  const toggleSoundBtn = modal.querySelector<HTMLButtonElement>("#toggle-sound")!;
  toggleSoundBtn.onclick = () => {
    soundActive = !soundActive;
    setSoundEnabled(soundActive);
    toggleSoundBtn.className = `w-12 h-6 rounded-full transition-colors relative ${soundActive ? "bg-nexus-accent" : "bg-white/20"}`;
    toggleSoundBtn.innerHTML = `<span class="absolute top-0.5 ${soundActive ? "right-1" : "left-1"} w-5 h-5 rounded-full bg-white transition-all shadow-md"></span>`;
    tapFeedback(12);
  };

  // Slider Sensibilité
  const range = modal.querySelector<HTMLInputElement>("#sensitivity-range")!;
  const valueDisplay = modal.querySelector<HTMLSpanElement>("#sensitivity-value")!;
  range.oninput = () => {
    sensitivity = parseFloat(range.value);
    valueDisplay.textContent = `${sensitivity.toFixed(1)}x`;
    setTrackpadSensitivity(sensitivity);
  };

  // Test feedback
  modal.querySelector("#btn-test-feedback")?.addEventListener("click", () => {
    playConfirmationSound();
    buzz([20, 40, 20]);
    showToast("Feedback haptique & sonore testé !", "info", 1800);
  });

  // Enregistrer et fermer
  modal.querySelector("#btn-save-settings")?.addEventListener("click", () => {
    setTrackpadSensitivity(sensitivity);
    setHapticsEnabled(hapticsActive);
    setSoundEnabled(soundActive);
    playConfirmationSound();
    showToast("Réglages enregistrés avec succès", "success");
    close();
  });
}
