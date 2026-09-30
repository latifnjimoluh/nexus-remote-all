/**
 * Module d'auto-détection et d'appairage par code PIN style Bluetooth sur le réseau local (LAN).
 */

export interface DiscoveredHost {
  ip: string;
  hostname: string;
  httpPort: number;
  wsPort: number;
  service: string;
  version: string;
  lastSeen: number;
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

  // 1. Vérification prioritaire : hôte actuel (si ouvert directement depuis le navigateur du téléphone)
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

  // 4. Liste de sondage ciblée sur les adresses IP les plus probables (routeur, DHCP 2-50, 100-150, 180-220)
  const targets: string[] = [];
  
  // Plage DHCP basse (2-30)
  for (let i = 2; i <= 30; i++) targets.push(`${subnetBase}${i}`);
  // Plage DHCP moyenne (100-130)
  for (let i = 100; i <= 130; i++) targets.push(`${subnetBase}${i}`);
  // Plage DHCP haute (170-210)
  for (let i = 170; i <= 210; i++) targets.push(`${subnetBase}${i}`);

  // Découverte en rafale parallèle (lots de 15 requêtes simultanées)
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
