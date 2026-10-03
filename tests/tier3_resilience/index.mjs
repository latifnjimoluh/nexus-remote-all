import { runTest as runBurstTest } from "./test_burst_flood.mjs";
import { runTest as runConcurrentClientsTest } from "./test_concurrent_clients.mjs";
import { runTest as runHeartbeatSweepTest } from "./test_heartbeat_sweep.mjs";
import { runTest as runCleanShutdownTest } from "./test_clean_shutdown.mjs";
import { runTest as runRelayReconnectTest } from "./test_relay_reconnect_race.mjs";

async function main() {
  console.log("================================================================================");
  console.log("  💥 TIER 3 RESILIENCE & STRESS SUITE");
  console.log("================================================================================\n");

  const suites = [
    { name: "High-Frequency Event Burst (1,000 Moves & Memory Bounds)", fn: runBurstTest },
    { name: "Concurrent Multi-Client Management & Non-Cascade Revocation", fn: runConcurrentClientsTest },
    { name: "WebSocket Heartbeat Sweep & Ghost Socket Purge (Code 4008)", fn: runHeartbeatSweepTest },
    { name: "Server Clean Shutdown API & Port Rebinding (Zero EADDRINUSE)", fn: runCleanShutdownTest },
    { name: "Relay Reconnection Race Resolution (Zero Code 4009 Deadlock)", fn: runRelayReconnectTest },
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
  console.log(`  Tier 3 Result: ${totalPassed} passed, ${totalFailed} failed in ${durationSec}s`);
  console.log("================================================================================");

  process.exit(totalFailed > 0 ? 1 : 0);
}

main();
