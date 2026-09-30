import { networkInterfaces } from "node:os";

/**
 * Retourne l'IPv4 LAN réelle de l'hôte (adresse joignable par le smartphone).
 * Écarte les interfaces virtuelles (VMware, VirtualBox, WSL/Hyper-V, VPN, Docker…)
 * et les adresses APIPA (169.254.x), puis préfère la carte Wi-Fi, sinon Ethernet.
 */
export function getLocalIp(): string {
  const candidates: Array<{ name: string; address: string }> = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const net of addrs ?? []) {
      if (net.family !== "IPv4" || net.internal) continue;
      if (net.address.startsWith("169.254.")) continue; // APIPA / link-local
      candidates.push({ name, address: net.address });
    }
  }

  const VIRTUAL =
    /vmware|virtualbox|vbox|vethernet|hyper-?v|wsl|loopback|bluetooth|vpn|tap-?windows|tunnel|tun\d|docker|npcap/i;
  const physical = candidates.filter((c) => !VIRTUAL.test(c.name));
  const pool = physical.length > 0 ? physical : candidates;

  const chosen =
    pool.find((c) => /wi-?fi|wireless|wlan|sans[- ]?fil/i.test(c.name)) ??
    pool.find((c) => /ethernet|eth\d|en0/i.test(c.name)) ??
    pool[0];

  return chosen?.address ?? "127.0.0.1";
}

/**
 * Ensemble des hôtes considérés comme « locaux » : localhost + toutes les IP
 * de la machine. Sert de liste blanche anti DNS-rebinding (F2) sur les en-têtes
 * Host (HTTP) et Origin (WebSocket).
 */
export function localAddresses(): Set<string> {
  const set = new Set<string>(["localhost", "127.0.0.1", "::1", "::ffff:127.0.0.1"]);
  for (const addrs of Object.values(networkInterfaces())) {
    for (const net of addrs ?? []) set.add(net.address.toLowerCase());
  }
  return set;
}
