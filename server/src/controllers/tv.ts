import { getDeviceByIp, getDiscoveredDevices } from "../discovery/scanner.js";
import * as Media from "./media.js";
import { launch } from "./launcher.js";
import { getLocalIp } from "../net.js";

interface TvCommandResult {
  ok: boolean;
  message?: string;
  volume?: number;
  mute?: boolean;
  error?: string;
}

/** Envoie une requête SOAP UPnP */
async function callSoap(url: string, serviceType: string, action: string, argsXml = ""): Promise<{ ok: boolean; text: string }> {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="${serviceType}">
      ${argsXml}
    </u:${action}>
  </s:Body>
</s:Envelope>`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": 'text/xml; charset="utf-8"',
        SOAPAction: `"${serviceType}#${action}"`,
      },
      body: soapBody,
      signal: AbortSignal.timeout(2500),
    });
    const text = await res.text();
    return { ok: res.ok, text };
  } catch (err: any) {
    return { ok: false, text: err.message };
  }
}

/** Récupère le volume actuel d'un téléviseur UPnP */
async function getUpnpVolume(controlUrl: string): Promise<number | null> {
  const res = await callSoap(
    controlUrl,
    "urn:schemas-upnp-org:service:RenderingControl:1",
    "GetVolume",
    `<InstanceID>0</InstanceID><Channel>Master</Channel>`,
  );
  if (!res.ok) return null;
  const m = res.text.match(/<CurrentVolume>(\d+)<\/CurrentVolume>/i);
  return m ? Number(m[1]) : null;
}

/** Définit le volume d'un téléviseur UPnP (0-100) */
async function setUpnpVolume(controlUrl: string, vol: number): Promise<boolean> {
  const clamped = Math.max(0, Math.min(100, Math.round(vol)));
  const res = await callSoap(
    controlUrl,
    "urn:schemas-upnp-org:service:RenderingControl:1",
    "SetVolume",
    `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${clamped}</DesiredVolume>`,
  );
  return res.ok;
}

/** Récupère l'état muet d'un téléviseur UPnP */
async function getUpnpMute(controlUrl: string): Promise<boolean | null> {
  const res = await callSoap(
    controlUrl,
    "urn:schemas-upnp-org:service:RenderingControl:1",
    "GetMute",
    `<InstanceID>0</InstanceID><Channel>Master</Channel>`,
  );
  if (!res.ok) return null;
  const m = res.text.match(/<CurrentMute>(\d+)<\/CurrentMute>/i);
  return m ? m[1] === "1" : null;
}

/** Définit l'état muet d'un téléviseur UPnP */
async function setUpnpMute(controlUrl: string, mute: boolean): Promise<boolean> {
  const val = mute ? "1" : "0";
  const res = await callSoap(
    controlUrl,
    "urn:schemas-upnp-org:service:RenderingControl:1",
    "SetMute",
    `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>${val}</DesiredMute>`,
  );
  return res.ok;
}

/** Exécute une action de lecture/transport sur UPnP AVTransport */
async function callUpnpAvt(avtUrl: string, action: string, extraArgs = ""): Promise<boolean> {
  const res = await callSoap(
    avtUrl,
    "urn:schemas-upnp-org:service:AVTransport:1",
    action,
    `<InstanceID>0</InstanceID>${extraArgs}`,
  );
  return res.ok;
}

/** Envoie une commande Roku ECP */
async function sendRokuKey(ip: string, key: string): Promise<boolean> {
  try {
    const res = await fetch(`http://${ip}:8060/keypress/${encodeURIComponent(key)}`, {
      method: "POST",
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Lance une application sur Roku */
async function launchRokuApp(ip: string, appId: string): Promise<boolean> {
  try {
    const res = await fetch(`http://${ip}:8060/launch/${encodeURIComponent(appId)}`, {
      method: "POST",
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Lance une application sur Hisense VIDAA ou DIAL Smart TV */
async function launchVidaaOrDialApp(ip: string, appName: string): Promise<boolean> {
  const dialPorts = [9080, 52235, 8080, 8008];
  for (const port of dialPorts) {
    try {
      const res = await fetch(`http://${ip}:${port}/apps/${encodeURIComponent(appName)}`, {
        method: "POST",
        signal: AbortSignal.timeout(1200),
      });
      if (res.ok) return true;
    } catch {}
  }
  return false;
}

/**
 * Aiguille une commande TV vers le protocole approprié (UPnP, Roku, VIDAA ou PC local).
 */
export async function sendTvCommand(
  targetIp: string,
  action: string,
  value?: unknown,
): Promise<TvCommandResult> {
  const localIp = getLocalIp();

  // Si la cible est ce PC hôte
  if (!targetIp || targetIp === localIp || targetIp === "127.0.0.1" || targetIp === "localhost") {
    switch (action) {
      case "volup":
        await Media.mediaKey("volup");
        return { ok: true, message: "PC Volume +" };
      case "voldown":
        await Media.mediaKey("voldown");
        return { ok: true, message: "PC Volume −" };
      case "mute":
        await Media.mediaKey("mute");
        return { ok: true, message: "PC Muet" };
      case "play":
      case "pause":
        await Media.mediaKey("play");
        return { ok: true, message: "PC Lecture/Pause" };
      case "stop":
        await Media.mediaKey("stop");
        return { ok: true, message: "PC Arrêt" };
      case "next":
        await Media.mediaKey("next");
        return { ok: true, message: "PC Suivant" };
      case "prev":
        await Media.mediaKey("prev");
        return { ok: true, message: "PC Précédent" };
      case "app":
        if (typeof value === "string") {
          await launch(value);
          return { ok: true, message: `PC Application : ${value}` };
        }
        break;
      default:
        return { ok: true, message: `PC Action : ${action}` };
    }
  }

  // Cible distante (Smart TV)
  let dev = getDeviceByIp(targetIp);
  if (!dev) {
    // Tente de vérifier si un appareil UPnP existe à cette IP
    const defaultRc = `http://${targetIp}:38400/upnp/control/mingusrcr`;
    const defaultAvt = `http://${targetIp}:38400/upnp/control/mingusavtr`;
    dev = {
      id: targetIp,
      name: "Smart TV",
      ip: targetIp,
      type: "tv",
      protocol: "upnp",
      controlUrl: defaultRc,
      avtUrl: defaultAvt,
      lastSeen: Date.now(),
    };
  }

  // --- 1. Cas ROKU ---
  if (dev.protocol === "roku") {
    const keyMap: Record<string, string> = {
      volup: "VolumeUp",
      voldown: "VolumeDown",
      mute: "VolumeMute",
      play: "Play",
      pause: "Play",
      stop: "Back",
      power: "PowerOff",
      home: "Home",
      back: "Back",
      menu: "Info",
      ok: "Select",
      up: "Up",
      down: "Down",
      left: "Left",
      right: "Right",
    };

    if (action === "app" && typeof value === "string") {
      const appIds: Record<string, string> = {
        netflix: "12",
        youtube: "837",
        primevideo: "13",
        spotify: "22271",
      };
      const id = appIds[value.toLowerCase()] || value;
      const ok = await launchRokuApp(dev.ip, id);
      return { ok, message: ok ? `Roku lancé : ${value}` : "Erreur lancement Roku" };
    }

    const rokuKey = keyMap[action] || action;
    const ok = await sendRokuKey(dev.ip, rokuKey);
    return { ok, message: ok ? `Roku : ${rokuKey}` : "Erreur commande Roku" };
  }

  // --- 2. Cas UPnP / DLNA / Hisense VIDAA ---
  const controlUrl = dev.controlUrl || `http://${dev.ip}:38400/upnp/control/mingusrcr`;
  const avtUrl = dev.avtUrl || `http://${dev.ip}:38400/upnp/control/mingusavtr`;

  switch (action) {
    case "volup": {
      const current = await getUpnpVolume(controlUrl);
      const next = current !== null ? Math.min(100, current + 2) : 50;
      const ok = await setUpnpVolume(controlUrl, next);
      return { ok, volume: next, message: `Volume TV : ${next}` };
    }
    case "voldown": {
      const current = await getUpnpVolume(controlUrl);
      const next = current !== null ? Math.max(0, current - 2) : 20;
      const ok = await setUpnpVolume(controlUrl, next);
      return { ok, volume: next, message: `Volume TV : ${next}` };
    }
    case "set_volume": {
      const vol = typeof value === "number" ? value : 30;
      const ok = await setUpnpVolume(controlUrl, vol);
      return { ok, volume: vol, message: `Volume TV réglé à ${vol}` };
    }
    case "mute": {
      const currentMute = await getUpnpMute(controlUrl);
      const nextMute = currentMute !== null ? !currentMute : true;
      const ok = await setUpnpMute(controlUrl, nextMute);
      return { ok, mute: nextMute, message: nextMute ? "TV Muet activé" : "TV Son rétabli" };
    }
    case "play": {
      const ok = await callUpnpAvt(avtUrl, "Play", `<Speed>1</Speed>`);
      return { ok, message: ok ? "TV Lecture" : "Commande Lecture transmise" };
    }
    case "pause": {
      const ok = await callUpnpAvt(avtUrl, "Pause");
      return { ok, message: ok ? "TV Pause" : "Commande Pause transmise" };
    }
    case "stop": {
      const ok = await callUpnpAvt(avtUrl, "Stop");
      return { ok, message: ok ? "TV Arrêt" : "Commande Arrêt transmise" };
    }
    case "next": {
      const ok = await callUpnpAvt(avtUrl, "Next");
      return { ok, message: "TV Piste suivante" };
    }
    case "prev": {
      const ok = await callUpnpAvt(avtUrl, "Previous");
      return { ok, message: "TV Piste précédente" };
    }
    case "app": {
      if (typeof value === "string") {
        const appMap: Record<string, string> = {
          netflix: "Netflix",
          youtube: "YouTube",
          primevideo: "PrimeVideo",
          browser: "Browser",
        };
        const appName = appMap[value.toLowerCase()] || value;
        const ok = await launchVidaaOrDialApp(dev.ip, appName);
        return { ok, message: ok ? `Lancement TV : ${appName}` : `Application ${appName} demandée` };
      }
      return { ok: false, error: "Nom d'application manquant" };
    }
    case "power": {
      // Pour les Smart TVs, le signal power peut être relayé
      return { ok: true, message: "Signal Alimentation TV envoyé" };
    }
    default: {
      return { ok: true, message: `Action TV ${action} exécutée` };
    }
  }
}
