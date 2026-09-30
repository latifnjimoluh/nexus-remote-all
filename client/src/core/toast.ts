/**
 * Système de notifications toast Dark Glassmorphism, élégant et non intrusif.
 */
export function showToast(
  message: string,
  variant: "info" | "success" | "warning" | "error" = "info",
  durationMs = 2800,
): void {
  const existing = document.getElementById("nexus-toast-container");
  let container = existing;
  if (!container) {
    container = document.createElement("div");
    container.id = "nexus-toast-container";
    container.className =
      "fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none w-[90%] max-w-sm items-center";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  const variantStyles = {
    info: "border-nexus-accent/40 text-slate-100 bg-nexus-panel/90 shadow-[0_8px_24px_rgba(109,94,252,0.25)]",
    success: "border-emerald-500/50 text-emerald-200 bg-emerald-950/80 shadow-[0_8px_24px_rgba(16,185,129,0.25)]",
    warning: "border-amber-500/50 text-amber-200 bg-amber-950/80 shadow-[0_8px_24px_rgba(245,158,11,0.25)]",
    error: "border-rose-500/50 text-rose-200 bg-rose-950/80 shadow-[0_8px_24px_rgba(244,63,94,0.25)]",
  };

  const icons = {
    info: "✨",
    success: "✅",
    warning: "⚠️",
    error: "❌",
  };

  toast.className = `animate-toast pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border backdrop-blur-xl text-xs font-semibold select-none ${variantStyles[variant]}`;
  toast.innerHTML = `
    <span class="text-base">${icons[variant]}</span>
    <span class="flex-1">${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px) scale(0.95)";
    setTimeout(() => toast.remove(), 320);
  }, durationMs);
}
