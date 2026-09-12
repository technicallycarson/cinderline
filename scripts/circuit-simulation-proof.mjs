import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const workspace = resolve(import.meta.dirname, "..");
const vitestEntry = resolve(workspace, "node_modules/vitest/vitest.mjs");
const result = spawnSync(
  process.execPath,
  [
    vitestEntry,
    "run",
    "tests/circuit-simulation.test.ts",
    "--reporter=verbose",
  ],
  {
    cwd: workspace,
    encoding: "utf8",
    env: {
      ...process.env,
      CINDERLINE_CIRCUIT_SIMULATION_PROOF: "1",
    },
  },
);

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);

const marker = "[circuit-simulation-proof]";
const proofLine = result.stdout
  .split(/\r?\n/)
  .find((line) => line.startsWith(marker));
if (!proofLine) {
  throw new Error(
    "Circuit simulation tests completed without a proof payload.",
  );
}

const proof = JSON.parse(proofLine.slice(marker.length));
if (
  proof?.format !== "cinderline-circuit-simulation-proof" ||
  proof?.simulationVersion !== 8 ||
  proof?.catalogVersion !== "cinderline-8" ||
  proof?.oneTickPublication !== true ||
  proof?.exactRestoreContinuation !== true ||
  proof?.enabledAtTick !== proof?.disabledAtTick + 1 ||
  proof?.authoritativeControl?.enabled !== true ||
  proof?.authoritativeControl?.powerSwitchClosed !== true ||
  !Number.isSafeInteger(proof?.endpointCount) ||
  proof.endpointCount < 5 ||
  proof?.wireCount !== 1 ||
  proof?.componentCount !== 1 ||
  !Number.isSafeInteger(proof?.workUnits) ||
  proof.workUnits < 1
) {
  throw new Error(
    "Circuit simulation proof payload failed its authoritative gates.",
  );
}

const proofDirectory = resolve(workspace, ".qa/circuit-network");
mkdirSync(proofDirectory, { recursive: true });
const proofPath = resolve(proofDirectory, "simulation-proof.json");
writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
console.log(`[circuit-simulation-proof] wrote ${proofPath}`);
