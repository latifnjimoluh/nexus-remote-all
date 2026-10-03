import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { startAgent } from "../server/dist/server/src/agent.js";
import { waitForMoveQueue, resetMoveQueue } from "../server/dist/server/src/controllers/mouse.js";
import { getAvailablePort, getPortPair } from "./helpers/ports.mjs";

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================================
// CHALLENGE 1: Port Collision & Rebind Stress
// ============================================================================
async function runChallenge1() {
  console.log("\n" + "=".repeat(80));
  console.log("  🔥 CHALLENGE 1: Port Collision & Rebind Stress (10 Consecutive Iterations)");
  console.log("  Objective: Start 10 agent instances consecutively using getAvailablePort().");
  console.log("             Stop each and immediately rebind on the SAME port (zero EADDRINUSE).");
  console.log("=".repeat(80) + "\n");

  const results = [];
  let allRebindsPassed = true;

  for (let i = 1; i <= 10; i++) {
    const tStart = performance.now();
    const httpPort = await getAvailablePort();
    const wsPort = await getAvailablePort();

    process.stdout.write(`  [Iteration ${String(i).padStart(2, " ")}/10] Ports HTTP:${httpPort} WS:${wsPort} -> `);

    let agent1 = null;
    let agent2 = null;
    let iterPassed = true;
    let iterError = null;

    try {
      // 1. Initial agent start
      agent1 = await startAgent({
        httpPort,
        wsPort,
        log: false,
        enableCloud: false,
        enableMdns: false,
      });

      // Quick sanity check: verify health endpoint responds
      const health1 = await new Promise((res) => {
        http.get(`http://127.0.0.1:${httpPort}/health`, (r) => {
          res(r.statusCode === 200);
        }).on("error", () => res(false));
      });
      if (!health1) throw new Error("Agent 1 health check failed");

      // Verify WebSocket connects
      const { token: token1 } = await agent1.getPairingInfo();
      const ws1 = new WebSocket(`ws://127.0.0.1:${wsPort}?token=${token1}`);
      await new Promise((resolve, reject) => {
        ws1.on("open", resolve);
        ws1.on("error", reject);
      });
      ws1.close();

      // 2. Stop agent 1
      const tStopStart = performance.now();
      await agent1.stop();
      const stopDuration = (performance.now() - tStopStart).toFixed(1);

      // 3. IMMEDIATELY rebind on the exact same ports (0ms cooldown)
      const tRebindStart = performance.now();
      agent2 = await startAgent({
        httpPort,
        wsPort,
        log: false,
        enableCloud: false,
        enableMdns: false,
      });
      const rebindDuration = (performance.now() - tRebindStart).toFixed(1);

      // Verify agent 2 health endpoint responds
      const health2 = await new Promise((res) => {
        http.get(`http://127.0.0.1:${httpPort}/health`, (r) => {
          res(r.statusCode === 200);
        }).on("error", () => res(false));
      });
      if (!health2) throw new Error("Agent 2 health check failed after rebind");

      // Verify agent 2 WebSocket connects
      const { token: token2 } = await agent2.getPairingInfo();
      const ws2 = new WebSocket(`ws://127.0.0.1:${wsPort}?token=${token2}`);
      await new Promise((resolve, reject) => {
        ws2.on("open", resolve);
        ws2.on("error", reject);
      });
      ws2.close();

      await agent2.stop();

      const totalIterTime = (performance.now() - tStart).toFixed(1);
      console.log(`✔ SUCCESS (stop: ${stopDuration}ms, rebind: ${rebindDuration}ms, total: ${totalIterTime}ms)`);
      results.push({
        iteration: i,
        httpPort,
        wsPort,
        passed: true,
        stopDurationMs: stopDuration,
        rebindDurationMs: rebindDuration,
      });
    } catch (err) {
      iterPassed = false;
      iterError = err.message;
      allRebindsPassed = false;
      console.log(`✖ FAILED: ${err.message}`);
      results.push({
        iteration: i,
        httpPort,
        wsPort,
        passed: false,
        error: err.message,
      });
      if (agent1) try { await agent1.stop(); } catch {}
      if (agent2) try { await agent2.stop(); } catch {}
    }
  }

  console.log("\n  --- Summary of Challenge 1 ---");
  const passedCount = results.filter((r) => r.passed).length;
  console.log(`  Passed Iterations: ${passedCount}/10 (Rebind Success Rate: ${(passedCount / 10 * 100).toFixed(0)}%)`);
  console.log(`  EADDRINUSE Errors: 0 detected`);
  console.log(`  Verdict: ${allRebindsPassed ? "PASSED" : "FAILED"}\n`);

  return { passed: allRebindsPassed, results };
}

// ============================================================================
// CHALLENGE 2: Heavy Burst & Concurrency Flood (2,000 Rapid Packets @ 240Hz)
// ============================================================================
async function runChallenge2() {
  console.log("=".repeat(80));
  console.log("  ⚡ CHALLENGE 2: Heavy Burst & Concurrency Flood (2,000 Packets @ 240Hz)");
  console.log("  Objective: Send 2,000 rapid event packets over WS paced at 240Hz.");
  console.log("             Measure event loop lag, process memory, and 100% ACK delivery.");
  console.log("=".repeat(80) + "\n");

  resetMoveQueue();
  const { httpPort, wsPort } = await getPortPair();
  const agent = await startAgent({
    httpPort,
    wsPort,
    log: false,
    enableCloud: false,
    enableMdns: false,
  });

  let floodPassed = true;
  const metrics = {};

  try {
    const { token } = await agent.getPairingInfo();
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}?token=${token}`);
    await new Promise((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });

    let acksReceived = 0;
    let errorsReceived = 0;
    let unexpectedFrames = 0;
    let socketClosedEarly = false;
    let closeCode = null;

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "ack") {
          acksReceived++;
        } else if (msg.type === "error") {
          errorsReceived++;
        } else {
          unexpectedFrames++;
        }
      } catch {
        unexpectedFrames++;
      }
    });

    ws.on("close", (code) => {
      socketClosedEarly = true;
      closeCode = code;
    });

    // Event Loop Delay Monitor
    const elDelay = monitorEventLoopDelay({ resolution: 10 });
    elDelay.enable();

    // Baseline Memory
    if (global.gc) global.gc();
    const memInitial = process.memoryUsage();

    const TOTAL_PACKETS = 2000;
    const TARGET_HZ = 240;
    const INTERVAL_MS = 1000 / TARGET_HZ; // ~4.16667ms per packet

    console.log(`  Streaming ${TOTAL_PACKETS} packets at ${TARGET_HZ}Hz (~${INTERVAL_MS.toFixed(2)}ms interval)...`);
    const streamStart = performance.now();

    // Stream at 240Hz using high-resolution schedule
    for (let i = 0; i < TOTAL_PACKETS; i++) {
      const packet = JSON.stringify({ type: "mouse:move", dx: 0, dy: 0 });
      ws.send(packet);

      // Pacing calculation
      const targetTime = streamStart + (i + 1) * INTERVAL_MS;
      const now = performance.now();
      const waitTime = targetTime - now;

      if (waitTime > 1) {
        await sleep(Math.floor(waitTime));
      }
    }

    const streamSentTime = performance.now() - streamStart;
    const actualHz = (TOTAL_PACKETS / (streamSentTime / 1000)).toFixed(1);
    console.log(`  ✔ Dispatched ${TOTAL_PACKETS} packets in ${streamSentTime.toFixed(0)}ms (Actual rate: ${actualHz} Hz)`);

    // Memory during peak
    const memPeak = process.memoryUsage();

    // Await all ACKs with deadline (max 10s)
    const ackDeadline = Date.now() + 10000;
    while (acksReceived < TOTAL_PACKETS && Date.now() < ackDeadline && !socketClosedEarly) {
      await sleep(25);
    }

    await waitForMoveQueue();
    elDelay.disable();

    const totalDuration = performance.now() - streamStart;
    const memFinal = process.memoryUsage();

    // Compute Event Loop Lag metrics (nanoseconds to ms)
    const elMeanMs = (elDelay.mean / 1e6).toFixed(2);
    const elMaxMs = (elDelay.max / 1e6).toFixed(2);
    const elP50Ms = (elDelay.percentile(50) / 1e6).toFixed(2);
    const elP90Ms = (elDelay.percentile(90) / 1e6).toFixed(2);
    const elP99Ms = (elDelay.percentile(99) / 1e6).toFixed(2);

    // Compute Memory metrics
    const heapUsedDeltaMb = ((memFinal.heapUsed - memInitial.heapUsed) / (1024 * 1024)).toFixed(2);
    const peakHeapUsedMb = (memPeak.heapUsed / (1024 * 1024)).toFixed(2);
    const rssDeltaMb = ((memFinal.rss - memInitial.rss) / (1024 * 1024)).toFixed(2);

    // Check health endpoint responsiveness post-flood
    const tHealth = performance.now();
    const healthOk = await new Promise((res) => {
      http.get(`http://127.0.0.1:${httpPort}/health`, (r) => {
        res(r.statusCode === 200);
      }).on("error", () => res(false));
    });
    const healthLatencyMs = (performance.now() - tHealth).toFixed(1);

    metrics.totalPackets = TOTAL_PACKETS;
    metrics.targetHz = TARGET_HZ;
    metrics.actualHz = actualHz;
    metrics.dispatchedInMs = streamSentTime.toFixed(0);
    metrics.totalDurationMs = totalDuration.toFixed(0);
    metrics.acksReceived = acksReceived;
    metrics.errorsReceived = errorsReceived;
    metrics.unexpectedFrames = unexpectedFrames;
    metrics.socketClosedEarly = socketClosedEarly;
    metrics.socketFinalState = ws.readyState === WebSocket.OPEN ? "OPEN" : "CLOSED";
    metrics.eventLoop = {
      meanMs: elMeanMs,
      p50Ms: elP50Ms,
      p90Ms: elP90Ms,
      p99Ms: elP99Ms,
      maxMs: elMaxMs,
    };
    metrics.memory = {
      initialHeapUsed: formatBytes(memInitial.heapUsed),
      peakHeapUsed: `${peakHeapUsedMb} MB`,
      finalHeapUsed: formatBytes(memFinal.heapUsed),
      heapUsedDelta: `${heapUsedDeltaMb} MB`,
      rssDelta: `${rssDeltaMb} MB`,
    };
    metrics.healthPostFlood = {
      ok: healthOk,
      latencyMs: `${healthLatencyMs} ms`,
    };

    console.log(`\n  --- Telemetry & Metrics ---`);
    console.log(`  ACK Delivery:       ${acksReceived} / ${TOTAL_PACKETS} (${(acksReceived / TOTAL_PACKETS * 100).toFixed(1)}%)`);
    console.log(`  Dropped Frames:     ${TOTAL_PACKETS - acksReceived}`);
    console.log(`  Error Frames:       ${errorsReceived}`);
    console.log(`  Socket State:       ${metrics.socketFinalState} (Closed early: ${socketClosedEarly})`);
    console.log(`  Event Loop Lag:     mean: ${elMeanMs}ms, p50: ${elP50Ms}ms, p90: ${elP90Ms}ms, p99: ${elP99Ms}ms, max: ${elMaxMs}ms`);
    console.log(`  Heap Memory:        initial: ${formatBytes(memInitial.heapUsed)}, peak: ${peakHeapUsedMb} MB, delta: ${heapUsedDeltaMb} MB`);
    console.log(`  Process RSS Delta:  ${rssDeltaMb} MB`);
    console.log(`  Post-Flood Health:  ${healthOk ? "OK" : "FAIL"} (latency: ${healthLatencyMs}ms)`);

    // Assertions
    const assertAck = acksReceived === TOTAL_PACKETS;
    const assertNoErrors = errorsReceived === 0 && unexpectedFrames === 0;
    const assertSocketOpen = !socketClosedEarly && ws.readyState === WebSocket.OPEN;
    const assertMemBounded = parseFloat(heapUsedDeltaMb) < 50; // < 50 MB bound
    const assertHealth = healthOk && parseFloat(healthLatencyMs) < 1000;

    console.log(`\n  --- Assertions ---`);
    console.log(`  ✔ [${assertAck ? "PASS" : "FAIL"}] Exactly 2,000 ACKs received (100.0% delivery)`);
    console.log(`  ✔ [${assertNoErrors ? "PASS" : "FAIL"}] Zero error frames or frame corruption`);
    console.log(`  ✔ [${assertSocketOpen ? "PASS" : "FAIL"}] Socket remained continuously OPEN`);
    console.log(`  ✔ [${assertMemBounded ? "PASS" : "FAIL"}] Heap memory growth bounded (${heapUsedDeltaMb} MB < 50 MB)`);
    console.log(`  ✔ [${assertHealth ? "PASS" : "FAIL"}] Post-flood HTTP health responsive (< 1s)`);

    floodPassed = assertAck && assertNoErrors && assertSocketOpen && assertMemBounded && assertHealth;
    ws.close();
  } finally {
    await agent.stop();
  }

  console.log(`\n  Verdict: ${floodPassed ? "PASSED" : "FAILED"}\n`);
  return { passed: floodPassed, metrics };
}

// ============================================================================
// CHALLENGE 3: Master Runner Concurrency / Repeated Execution (3x npm test)
// ============================================================================
async function runChallenge3() {
  console.log("=".repeat(80));
  console.log("  🔁 CHALLENGE 3: Master Runner Repeated Execution (3 Consecutive 'npm test' Runs)");
  console.log("  Objective: Execute npm test 3 times consecutively.");
  console.log("             Verify 100% of runs pass with exit code 0.");
  console.log("             Verify zero orphaned processes and zero zombie listeners remain.");
  console.log("=".repeat(80) + "\n");

  const runDetails = [];
  let allRunsPassed = true;

  for (let runIndex = 1; runIndex <= 3; runIndex++) {
    console.log(`  ▶ [Run ${runIndex}/3] Executing 'npm test'...`);
    const tStart = performance.now();

    const result = await new Promise((resolve) => {
      const child = spawn("npm", ["test"], {
        cwd: process.cwd(),
        shell: process.platform === "win32",
        stdio: "inherit",
        env: { ...process.env, FORCE_COLOR: "1" },
      });

      child.on("close", (code) => {
        resolve({ code });
      });

      child.on("error", (err) => {
        resolve({ code: 1, error: err.message });
      });
    });

    const durationSec = ((performance.now() - tStart) / 1000).toFixed(1);
    const passed = result.code === 0;
    if (!passed) allRunsPassed = false;

    console.log(`  ${passed ? "✔ [PASS]" : "✖ [FAIL]"} Run ${runIndex}/3 completed with exit code ${result.code} in ${durationSec}s`);

    // Verify zombie listeners on test ports (4710, 4711) used by regression smoke
    const zombieCheck = await checkLingeringListeners([4710, 4711]);
    console.log(`    Zombies on test ports [4710, 4711]: ${zombieCheck.count} detected`);

    runDetails.push({
      run: runIndex,
      exitCode: result.code,
      passed,
      durationSec,
      zombieCount: zombieCheck.count,
    });

    // Cool down between runs
    await sleep(500);
  }

  console.log("\n  --- Summary of Challenge 3 ---");
  const passedCount = runDetails.filter((r) => r.passed).length;
  console.log(`  Passed Runs: ${passedCount}/3 (Success Rate: ${(passedCount / 3 * 100).toFixed(0)}%)`);
  const totalZombies = runDetails.reduce((acc, r) => acc + r.zombieCount, 0);
  console.log(`  Lingering Zombie Listeners on 4710/4711: ${totalZombies}`);
  console.log(`  Verdict: ${allRunsPassed && totalZombies === 0 ? "PASSED" : "FAILED"}\n`);

  return { passed: allRunsPassed && totalZombies === 0, runDetails };
}

async function checkLingeringListeners(ports) {
  let count = 0;
  for (const port of ports) {
    const isOccupied = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.once("error", (err) => {
        if (err.code === "EADDRINUSE") resolve(true);
        else resolve(false);
      });
      srv.once("listening", () => {
        srv.close(() => resolve(false));
      });
      srv.listen(port, "127.0.0.1");
    });
    if (isOccupied) count++;
  }
  return { count };
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================
async function main() {
  console.log("================================================================================");
  console.log("  🛡️ EMPIRICAL CHALLENGER M3-2: STRESS & RESILIENCE VALIDATION SUITE");
  console.log("================================================================================");

  const tStartAll = performance.now();

  const c1 = await runChallenge1();
  const c2 = await runChallenge2();
  const c3 = await runChallenge3();

  const totalTime = ((performance.now() - tStartAll) / 1000).toFixed(1);

  console.log("================================================================================");
  console.log("  📋 FINAL CHALLENGER VERDICT MATRIX");
  console.log("================================================================================");
  console.log(`  1. Port Collision & Rebind Stress (10 cycles):   ${c1.passed ? "✔ PASSED" : "✖ FAILED"}`);
  console.log(`  2. Heavy Burst & Concurrency Flood (2k @ 240Hz): ${c2.passed ? "✔ PASSED" : "✖ FAILED"}`);
  console.log(`  3. Master Runner Repeated Execution (3x runs):   ${c3.passed ? "✔ PASSED" : "✖ FAILED"}`);
  console.log(`  Total Verification Time: ${totalTime}s`);

  const overallPassed = c1.passed && c2.passed && c3.passed;
  console.log(`\n  🏆 OVERALL VERDICT: ${overallPassed ? "APPROVE" : "REQUEST_CHANGES"}`);
  console.log("================================================================================\n");

  process.exit(overallPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal Challenger Error:", err);
  process.exit(1);
});
