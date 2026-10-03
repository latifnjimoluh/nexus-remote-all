import net from "node:net";

/**
 * Finds an available dynamic TCP port by listening on port 0.
 * The operating system assigns a guaranteed-free ephemeral port.
 */
export async function getAvailablePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, host, () => {
      const address = srv.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Returns a pair of distinct available ports for HTTP and WS.
 */
export async function getPortPair(host = "127.0.0.1") {
  const httpPort = await getAvailablePort(host);
  let wsPort = await getAvailablePort(host);
  while (wsPort === httpPort) {
    wsPort = await getAvailablePort(host);
  }
  return { httpPort, wsPort };
}
