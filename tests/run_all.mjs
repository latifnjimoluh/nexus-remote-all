import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

const rootDir = resolve(".");

async function runCommand(cmd, args, label) {
  const start = Date.now();
  console.log(`\n================================================================================`);
  console.log(`  🚀 RUNNING: ${label}`);
  console.log(`  Command: ${cmd} ${args.join(" ")}`);
  console.log(`================================================================================\n`);

  return new Promise((res) => {
    const child = spawn(cmd, args, {
      cwd: rootDir,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, FORCE_COLOR: "1" },
    });

    child.on("close", (code) => {
      const durationSec = ((Date.now() - start) / 1000).toFixed(1);
      res({
        label,
        passed: code === 0,
        code,
        duration: durationSec,
      });
    });

    child.on("error", (err) => {
      const durationSec = ((Date.now() - start) / 1000).toFixed(1);
      console.error(`  ✖ Failed to start ${label}:`, err.message);
      res({
        label,
        passed: false,
        code: 1,
        duration: durationSec,
      });
    });
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("================================================================================");
  console.log("  🏆 NEXUS REMOTE ALL — UNIFIED MULTI-TIER AUTOMATED TEST RUNNER");
  console.log("================================================================================\n");

  // Check if server/dist exists; if not, compile before starting integration tests
  const serverDistIndex = join(rootDir, "server", "dist", "server", "src", "index.js");
  if (!existsSync(serverDistIndex)) {
    console.log("  ⚠️  Compiled artifacts missing in server/dist. Running 'npm run build' first...\n");
    const buildResult = await runCommand("npm", ["run", "build"], "Pre-Test Monorepo Build");
    if (!buildResult.passed) {
      console.error("  ✖ Pre-test build failed. Aborting test execution.");
      process.exit(1);
    }
    await sleep(500);
  }

  const testSuites = [
    {
      label: "Tier 1: Unit Test Suite (server/test/unit/)",
      cmd: "npm",
      args: ["run", "test:unit", "-w", "server"],
    },
    {
      label: "Tier 2: Integration & Security Suite (tests/tier2_integration/)",
      cmd: "node",
      args: ["tests/tier2_integration/index.mjs"],
    },
    {
      label: "Tier 3: Resilience & Stress Suite (tests/tier3_resilience/)",
      cmd: "node",
      args: ["tests/tier3_resilience/index.mjs"],
    },
    {
      label: "Regression Smoke: Core LAN E2E (test_e2e.mjs)",
      cmd: "node",
      args: ["test_e2e.mjs"],
    },
  ];

  const results = [];
  const globalStart = Date.now();

  for (const suite of testSuites) {
    const result = await runCommand(suite.cmd, suite.args, suite.label);
    results.push(result);

    if (!result.passed) {
      console.error(`\n  ✖ FAIL-FAST: Test suite '${suite.label}' exited with code ${result.code}.`);
      break;
    }

    // Cooldown pause between suites to allow OS to recycle TCP sockets and free ports
    await sleep(250);
  }

  const totalDuration = ((Date.now() - globalStart) / 1000).toFixed(1);

  console.log("\n================================================================================");
  console.log("  📊 TEST EXECUTION SUMMARY");
  console.log("================================================================================");

  let allPassed = true;
  for (const r of results) {
    const icon = r.passed ? "✔ [PASS   ]" : "✖ [FAIL   ]";
    console.log(`  ${icon} ${r.label.padEnd(65)} (${r.duration.padStart(5)}s)`);
    if (!r.passed) allPassed = false;
  }

  console.log("--------------------------------------------------------------------------------");
  if (allPassed && results.length === testSuites.length) {
    console.log(`  🏆 ALL TEST SUITES PASSED (${results.length} suites executed in ${totalDuration}s)`);
  } else {
    console.log(`  💥 TEST SUITE RUN COMPLETED WITH FAILURES (duration: ${totalDuration}s)`);
  }
  console.log("================================================================================\n");

  process.exit(allPassed && results.length === testSuites.length ? 0 : 1);
}

main();
