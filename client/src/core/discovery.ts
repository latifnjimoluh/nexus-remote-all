/**
 * Module d'auto-détection, gestion des appareils du réseau (PC & Smart TVs),
 * et appairage par code PIN style Bluetooth sur le réseau local (LAN).
 */
import { send, isReady } from "./ws-client";

export interface DiscoveredHost {
  ip: string;
  hostname: string;
  httpPort: number;
  wsPort: number;
  service: string;
  version: string;
  lastSeen: number;
}

export interface NetworkDevice {
  id: string;
  name: string;
  ip: string;
  type: "pc" | "tv";
  brand?: string;
  model?: string;
  isCurrent?: boolean;
  protocol?: "upnp" | "roku" | "nexus" | "vidaa";
  controlUrl?: string;
  avtUrl?: string;
  httpPort?: number;
  wsPort?: number;
  lastSeen?: number;
}

export type RemoteTargetMode = "pc" | "tv";

export interface ActiveRemoteTarget {
  mode: RemoteTargetMode;
  device?: NetworkDevice | null;
}

let activeTarget: ActiveRemoteTarget = {
  mode: (localStorage.getItem("nexus.target_mode") as RemoteTargetMode) || "pc",
  device: (() => {
    try {
      const raw = localStorage.getItem("nexus.selected_tv");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })(),
};

const targetListeners: Array<(target: ActiveRemoteTarget) => void> = [];

export function getActiveRemoteTarget(): ActiveRemoteTarget {
  return activeTarget;
}

export function setActiveRemoteTarget(mode: RemoteTargetMode, device?: NetworkDevice | null): void {
  activeTarget = { mode, device: device ?? null };
  localStorage.setItem("nexus.target_mode", mode);
  if (device) {
    localStorage.setItem("nexus.selected_tv", JSON.stringify(device));
  }
  for (const listener of targetListeners) {
    try {
      listener(activeTarget);
    } catch {}
  }
}

export function onTargetChange(listener: (target: ActiveRemoteTarget) => void): () => void {
  targetListeners.push(listener);
  return () => {
    const idx = targetListeners.indexOf(listener);
    if (idx !== -1) targetListeners.splice(idx, 1);
  };
}

/** Tente d'interroger un hôte spécifique sur le port 4700 pour vérifier s'il s'agit d'un agent Nexus. */
export async function probeHost(ip: string, port = 4700): Promise<DiscoveredHost | null> {
  try {
    const res = await fetch(`http://${ip}:${port}/health`, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      signal: AbortSignal.timeout(650),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.ok && (data.service === "Nexus Remote All" || data.service?.includes("Nexus"))) {
      return {
        ip: data.ip || ip,
        hostname: data.hostname || "PC Nexus",
        httpPort: Number(data.httpPort) || port,
        wsPort: Number(data.wsPort) || 4701,
        service: data.service,
        version: data.version || "0.5.0",
        lastSeen: Date.now(),
      };
    }
  } catch {}
  return null;
}

/** Récupère la liste complète des appareils découverts (PC & Smart TVs) auprès de l'agent */
export async function fetchNetworkDevices(host?: string, refresh = false): Promise<NetworkDevice[]> {
  const targetHost =
    host ||
    localStorage.getItem("nexus.host") ||
    (location.hostname !== "localhost" && /^\d+\.\d+\.\d+\.\d+$/.test(location.hostname) ? location.hostname : "127.0.0.1");

  const httpPort = location.port && /^\d+$/.test(location.port) ? location.port : "4700";

  try {
    const res = await fetch(`http://${targetHost}:${httpPort}/pair/network-devices?refresh=${refresh ? "1" : "0"}`, {
      mode: "cors",
      cache: "no-store",
      signal: AbortSignal.timeout(3500),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok && Array.isArray(data.devices)) {
        return data.devices;
      }
    }
  } catch {}

  // Repli : scan local direct depuis le navigateur
  const fallbackList: NetworkDevice[] = [];
  const hosts = await scanLocalNetwork(() => {});
  for (const h of hosts) {
    fallbackList.push({
      id: h.ip,
      name: h.hostname,
      ip: h.ip,
      type: "pc",
      brand: "Nexus",
      model: h.version,
      httpPort: h.httpPort,
      wsPort: h.wsPort,
      lastSeen: h.lastSeen,
    });
  }
  return fallbackList;
}

/**
 * Envoie une commande TV de manière exclusive mono-canal (F18) :
 * - Si le WebSocket est connecté et prêt, utilise exclusivement le canal WebSocket temps réel.
 * - Si le WebSocket n'est pas prêt, bascule sur le relais HTTP fetch direct.
 * Élimine toute double exécution ou saut de pas de volume.
 */
export async function sendTvCommand(
  targetIp: string,
  action: string,
  value?: unknown,
): Promise<{ ok: boolean; message?: string; volume?: number; mute?: boolean }> {
  // 1. Canal prioritaire : WebSocket (temps réel ultra-rapide)
  if (isReady()) {
    try {
      send({
        type: "tv:command",
        targetIp,
        action,
        value,
      });
      return { ok: true, message: `Action ${action} transmise via WebSocket` };
    } catch {
      // En cas d'erreur synchrone d'émission, repli sur le canal HTTP ci-dessous
    }
  }

  // 2. Canal de repli exclusif : Relais HTTP direct vers l'agent hôte
  const host =
    localStorage.getItem("nexus.host") ||
    (location.hostname !== "localhost" && /^\d+\.\d+\.\d+\.\d+$/.test(location.hostname) ? location.hostname : "127.0.0.1");

  const httpPort = location.port && /^\d+$/.test(location.port) ? location.port : "4700";

  const token = localStorage.getItem("nexus.token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const res = await fetch(`http://${host}:${httpPort}/pair/tv/command`, {
      method: "POST",
      headers,
      body: JSON.stringify({ targetIp, action, value }),
      mode: "cors",
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {}

  return { ok: true, message: `Action ${action} transmise` };
}

/**
 * Scanne le réseau local pour trouver automatiquement tous les PC hôtes Nexus actifs.
 * Appelle onFound dès qu'un appareil est détecté en temps réel.
 */
export async function scanLocalNetwork(
  onFound: (host: DiscoveredHost) => void,
): Promise<DiscoveredHost[]> {
  const found: DiscoveredHost[] = [];
  const visited = new Set<string>();

  const register = (device: DiscoveredHost) => {
    if (!visited.has(device.ip)) {
      visited.add(device.ip);
      found.push(device);
      onFound(device);
    }
  };

  // 1. Vérification prioritaire : hôte actuel
  const currentHost = location.hostname;
  if (
    currentHost &&
    currentHost !== "localhost" &&
    currentHost !== "127.0.0.1" &&
    !currentHost.includes("unlineservice.com") &&
    /^\d+\.\d+\.\d+\.\d+$/.test(currentHost)
  ) {
    const d = await probeHost(currentHost);
    if (d) register(d);
  }

  // 2. Vérification de l'hôte sauvegardé dans le cache local
  const cachedHost = localStorage.getItem("nexus.host");
  if (cachedHost && /^\d+\.\d+\.\d+\.\d+$/.test(cachedHost)) {
    const d = await probeHost(cachedHost);
    if (d) register(d);
  }

  // 3. Détermination du sous-réseau Wi-Fi local (ex: 192.168.1.X)
  let subnetBase = "192.168.1.";
  if (currentHost && /^\d+\.\d+\.\d+\.\d+$/.test(currentHost)) {
    const parts = currentHost.split(".");
    subnetBase = `${parts[0]}.${parts[1]}.${parts[2]}.`;
  } else if (cachedHost && /^\d+\.\d+\.\d+\.\d+$/.test(cachedHost)) {
    const parts = cachedHost.split(".");
    subnetBase = `${parts[0]}.${parts[1]}.${parts[2]}.`;
  }

  // 4. Liste de sondage ciblée sur les adresses IP les plus probables
  const targets: string[] = [];
  for (let i = 2; i <= 30; i++) targets.push(`${subnetBase}${i}`);
  for (let i = 100; i <= 130; i++) targets.push(`${subnetBase}${i}`);
  for (let i = 170; i <= 210; i++) targets.push(`${subnetBase}${i}`);

  const BATCH_SIZE = 15;
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    const promises = batch
      .filter((ip) => !visited.has(ip))
      .map(async (ip) => {
        const d = await probeHost(ip);
        if (d) register(d);
      });
    await Promise.all(promises);
  }

  return found;
}

/**
 * Envoie le code PIN de 6 chiffres saisi par l'utilisateur au PC hôte pour vérification.
 * Si le PIN correspond à celui affiché sur l'écran du PC, l'agent renvoie le jeton de session JWT.
 */
export async function pairWithPin(
  host: string,
  httpPort: number,
  pin: string,
): Promise<{ ok: boolean; token?: string; wsPort?: number; hostname?: string; error?: string }> {
  try {
    const res = await fetch(`http://${host}:${httpPort}/pair/verify-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      mode: "cors",
      body: JSON.stringify({ pin: pin.replace(/\D/g, "") }),
      signal: AbortSignal.timeout(3000),
    });

    const data = await res.json();
    if (res.ok && data.ok && data.token) {
      return {
        ok: true,
        token: data.token,
        wsPort: Number(data.wsPort) || 4701,
        hostname: data.hostname,
      };
    }
    return {
      ok: false,
      error: data.error || "Code PIN invalide ou expiré.",
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err.name === "TimeoutError" ? "Délai de connexion dépassé" : "Impossible de contacter ce PC",
    };
  }
}
