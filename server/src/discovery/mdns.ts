import { Bonjour } from "bonjour-service";
import { CONFIG } from "../config.js";

let instance: Bonjour | null = null;

/** Publie le service Nexus sur le réseau local via mDNS (Bonjour). */
export function publishService(): void {
  try {
    instance = new Bonjour();
    instance.publish({
      name: CONFIG.SERVICE_NAME,
      type: "nexusremote",
      port: CONFIG.HTTP_PORT,
      txt: { ws: String(CONFIG.WS_PORT) },
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
