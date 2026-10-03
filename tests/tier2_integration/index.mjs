import { runTest as runLoopbackTest } from "./test_loopback_restriction.mjs";
import { runTest as runProtectedEndpointsTest } from "./test_protected_endpoints.mjs";
import { runTest as runWsHandshakeTest } from "./test_ws_handshake_auth.mjs";
import { runTest as runPairingLifecycleTest } from "./test_pairing_lifecycle.mjs";
import { runTest as runCloudRelayTunnelTest } from "./test_cloud_relay_tunnel.mjs";

async function main() {
  console.log("================================================================================");
  console.log("  🛡️  TIER 2 INTEGRATION & SECURITY SUITE");
  console.log("================================================================================\n");

  const suites = [
    { name: "Loopback Restriction Matrix", fn: runLoopbackTest },
    { name: "Protected Endpoints & Authorization", fn: runProtectedEndpointsTest },
    { name: "WebSocket Handshake Authentication & Anti-DNS Rebinding", fn: runWsHandshakeTest },
    { name: "Full Pairing Handshake Lifecycle", fn: runPairingLifecycleTest },
    { name: "Cloud Relay E2EE Tunnel & Anti-Replay", fn: runCloudRelayTunnelTest },
  ];

  let totalPassed = 0;
  let totalFailed = 0;
  const start = Date.now();

  for (const suite of suites) {
    try {
      const { passed, failed } = await suite.fn();
      totalPassed += passed;
      totalFailed += failed;
      // Socket recycling cooldown
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.error(`  ✖ Fatal exception in ${suite.name}:`, err);
      totalFailed++;
    }
    console.log("");
  }

  const durationSec = ((Date.now() - start) / 1000).toFixed(1);
  console.log("--------------------------------------------------------------------------------");
  console.log(`  Tier 2 Result: ${totalPassed} passed, ${totalFailed} failed in ${durationSec}s`);
  console.log("================================================================================");

  process.exit(totalFailed > 0 ? 1 : 0);
}

main();
