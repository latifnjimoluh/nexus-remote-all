import { Bonjour } from "bonjour-service";
import { CONFIG } from "../config.js";

let instance: Bonjour | null = null;

/** Publie le service Nexus sur le réseau local via mDNS (Bonjour). */
export function publishService(): void {
  try {
    if (instance) {
      try {
        instance.destroy();
      } catch {}
      instance = null;
    }
    instance = new Bonjour();
    const service = instance.publish({
      name: CONFIG.SERVICE_NAME,
      type: "nexusremote",
      port: CONFIG.HTTP_PORT,
      txt: { ws: String(CONFIG.WS_PORT) },
    });
    service.on("error", (err) => {
      console.warn("mDNS avertissement (collision de nom ou réseau) :", err?.message ?? err);
    });
    console.log(`mDNS  → service "${CONFIG.SERVICE_NAME}" diffusé sur le réseau local`);
  } catch (err) {
    console.warn("mDNS : publication impossible sur cette interface :", err);
  }
}

export function stopService(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}
