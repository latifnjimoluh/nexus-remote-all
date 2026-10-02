import dgram from "node:dgram";
import os from "node:os";
import { getLocalIp } from "../net.js";
import { CONFIG } from "../config.js";

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
  lastSeen: number;
}

// Cache des appareils découverts sur le LAN
const discovered = new Map<string, NetworkDevice>();
let isScanning = false;
let lastScanTime = 0;

/** Extrait une balise XML simple sans dépendance lourde */
function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1].trim() : null;
}

/** Tente de récupérer et analyser la description XML UPnP d'un appareil */
async function fetchUpnpDesc(locationUrl: string, ip: string): Promise<NetworkDevice | null> {
  try {
    const res = await fetch(locationUrl, { signal: AbortSignal.timeout(1800) });
    if (!res.ok) return null;
    const xml = await res.text();

    const friendlyName = extractTag(xml, "friendlyName") || "Smart TV";
    const manufacturer = extractTag(xml, "manufacturer") || "SmartTV";
    const modelName = extractTag(xml, "modelName") || "";
    const modelDesc = extractTag(xml, "modelDescription") || "";

    // URLs de contrôle UPnP (RenderingControl et AVTransport)
    let controlUrl: string | undefined;
    let avtUrl: string | undefined;

    const baseMatch = xml.match(/<URLBase>([^<]+)<\/URLBase>/i);
    const baseUrl = baseMatch ? baseMatch[1].trim().replace(/\/+$/, "") : new URL(locationUrl).origin;

    // Détection de RenderingControl (volume, muet)
    const rcMatch = xml.match(/<serviceType>[^<]*RenderingControl:[^<]*<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/i);
    if (rcMatch) {
      const path = rcMatch[1].trim();
      controlUrl = path.startsWith("http") ? path : `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
    }

    // Détection d'AVTransport (lecture, pause, stop)
    const avtMatch = xml.match(/<serviceType>[^<]*AVTransport:[^<]*<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/i);
    if (avtMatch) {
      const path = avtMatch[1].trim();
      avtUrl = path.startsWith("http") ? path : `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
    }

    // Détection marque (Hisense VIDAA, LG WebOS, Roku, Samsung)
    let brand = manufacturer;
    if (/hisense|vidaa/i.test(friendlyName) || /hisense|vidaa/i.test(modelDesc) || /hisense/i.test(manufacturer)) {
      brand = "Hisense VIDAA";
    } else if (/webos|lge/i.test(xml) || /lg/i.test(manufacturer)) {
      brand = "LG WebOS";
    } else if (/samsung|tizen/i.test(xml) || /samsung/i.test(manufacturer)) {
      brand = "Samsung";
    } else if (/roku/i.test(xml) || /roku/i.test(manufacturer)) {
      brand = "Roku";
    }

    return {
      id: ip,
      name: friendlyName,
      ip,
      type: "tv",
      brand,
      model: modelName || undefined,
      protocol: "upnp",
      controlUrl,
      avtUrl,
      lastSeen: Date.now(),
    };
  } catch {
    return null;
  }
}

/** Envoie une requête SSDP M-SEARCH sur le réseau local pour découvrir Smart TVs & UPnP */
export async function scanSsdp(durationMs = 2500): Promise<void> {
  return new Promise((resolve) => {
    let socket: dgram.Socket | null = null;
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (socket) {
        try {
          socket.close();
        } catch {}
        socket = null;
      }
      resolve();
    };

    try {
      socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

      socket.on("error", () => {
        cleanup();
      });

      socket.on("message", async (msg, rinfo) => {
        try {
          const str = msg.toString();
          const locationMatch = str.match(/LOCATION:\s*([^\r\n]+)/i);
          if (locationMatch && locationMatch[1]) {
            const loc = locationMatch[1].trim();
            const dev = await fetchUpnpDesc(loc, rinfo.address);
            if (dev) {
              discovered.set(dev.ip, dev);
            }
          }
        } catch {}
      });

      socket.bind(0, () => {
        try {
          socket?.setBroadcast(true);
          const search = [
            "M-SEARCH * HTTP/1.1",
            "HOST: 239.255.255.250:1900",
            'MAN: "ssdp:discover"',
            "MX: 2",
            "ST: ssdp:all",
            "",
            "",
          ].join("\r\n");

          const buf = Buffer.from(search);
          socket?.send(buf, 0, buf.length, 1900, "239.255.255.250");
        } catch {
          cleanup();
        }
      });

      timer = setTimeout(cleanup, durationMs);
    } catch {
      cleanup();
    }
  });
}

/** Sonde les IP locales pour trouver d'autres agents Nexus PC et des appareils Roku */
export async function probeSubnetHosts(): Promise<void> {
  const localIp = getLocalIp();
  const parts = localIp.split(".");
  if (parts.length !== 4) return;
  const subnet = `${parts[0]}.${parts[1]}.${parts[2]}.`;

  // Plages DHCP ciblées pour rapidité
  const ips: string[] = [];
  for (let i = 2; i <= 30; i++) ips.push(`${subnet}${i}`);
  for (let i = 100; i <= 130; i++) ips.push(`${subnet}${i}`);
  for (let i = 170; i <= 210; i++) ips.push(`${subnet}${i}`);

  const BATCH = 15;
  for (let i = 0; i < ips.length; i += BATCH) {
    const chunk = ips.slice(i, i + BATCH);
    await Promise.all(
      chunk.map(async (targetIp) => {
        if (targetIp === localIp) return;

        // 1. Sonde Nexus PC (port 4700)
        try {
          const res = await fetch(`http://${targetIp}:4700/health`, {
            signal: AbortSignal.timeout(600),
          });
          if (res.ok) {
            const data = await res.json();
            if (data && data.ok && data.service?.includes("Nexus")) {
              discovered.set(targetIp, {
                id: targetIp,
                name: data.hostname || "PC Nexus",
                ip: targetIp,
                type: "pc",
                brand: "Nexus",
                model: data.version || "0.5.0",
                httpPort: Number(data.httpPort) || 4700,
                wsPort: Number(data.wsPort) || 4701,
                lastSeen: Date.now(),
              });
              return;
            }
          }
        } catch {}

        // 2. Sonde Roku (port 8060)
        try {
          const res = await fetch(`http://${targetIp}:8060/query/device-info`, {
            signal: AbortSignal.timeout(600),
          });
          if (res.ok) {
            const xml = await res.text();
            const modelName = extractTag(xml, "model-name") || "Roku";
            const userDeviceName = extractTag(xml, "user-device-name") || modelName;
            discovered.set(targetIp, {
              id: targetIp,
              name: userDeviceName,
              ip: targetIp,
              type: "tv",
              brand: "Roku",
              model: modelName,
              protocol: "roku",
              lastSeen: Date.now(),
            });
          }
        } catch {}
      }),
    );
  }
}

/** Exécute un scan réseau complet en arrière-plan */
export async function runNetworkScan(): Promise<void> {
  if (isScanning) return;
  isScanning = true;
  lastScanTime = Date.now();

  try {
    await Promise.all([scanSsdp(2500), probeSubnetHosts()]);
  } catch (err) {
    console.warn("[Scanner] Avertissement scan réseau :", err);
  } finally {
    isScanning = false;
  }
}

/** Récupère la liste de tous les appareils découverts, avec le PC actuel en première position */
export async function getDiscoveredDevices(forceRefresh = false): Promise<NetworkDevice[]> {
  const now = Date.now();
  if (forceRefresh || now - lastScanTime > 45_000) {
    // Si premier scan ou données trop anciennes, lance un rafraîchissement
    if (!isScanning) {
      void runNetworkScan();
    }
  }

  const localIp = getLocalIp();
  const currentPc: NetworkDevice = {
    id: localIp,
    name: `${os.hostname()} (Ce PC)`,
    ip: localIp,
    type: "pc",
    brand: "Nexus",
    model: "Nexus Remote All v0.5.0",
    isCurrent: true,
    httpPort: CONFIG.HTTP_PORT,
    wsPort: CONFIG.WS_PORT,
    lastSeen: Date.now(),
  };

  const list: NetworkDevice[] = [currentPc];
  for (const [ip, dev] of discovered.entries()) {
    if (ip !== localIp) {
      list.push(dev);
    }
  }

  return list;
}

/** Récupère un appareil spécifique par son IP */
export function getDeviceByIp(ip: string): NetworkDevice | undefined {
  if (ip === getLocalIp() || ip === "127.0.0.1" || ip === "localhost") {
    return {
      id: getLocalIp(),
      name: `${os.hostname()} (Ce PC)`,
      ip: getLocalIp(),
      type: "pc",
      brand: "Nexus",
      isCurrent: true,
      lastSeen: Date.now(),
    };
  }
  return discovered.get(ip);
}
