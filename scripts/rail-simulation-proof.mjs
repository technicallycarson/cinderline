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
    "tests/rail-integration.test.ts",
    "--reporter=verbose",
  ],
  {
    cwd: workspace,
    encoding: "utf8",
    env: {
      ...process.env,
      CINDERLINE_RAIL_SIMULATION_PROOF: "1",
    },
  },
);

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);

const marker = "[rail-simulation-proof]";
const proofLine = result.stdout
  .split(/\r?\n/)
  .find((line) => line.startsWith(marker));
if (!proofLine) {
  throw new Error(
    "Rail integration tests completed without a proof payload.",
  );
}

const proof = JSON.parse(proofLine.slice(marker.length));
if (
  proof?.format !== "cinderline-rail-simulation-proof" ||
  proof?.simulationVersion !== 8 ||
  proof?.catalogVersion !== "cinderline-8" ||
  proof?.tick !== proof?.railTick ||
  proof?.tick !== proof?.circuitTick ||
  proof?.initialCargo !== 20 ||
  proof?.finalCargo !== proof?.initialCargo ||
  proof?.foundryCargo !== proof?.initialCargo ||
  proof?.loadedEvents < 1 ||
  proof?.unloadedEvents < 1 ||
  proof?.departedEvents < 1 ||
  proof?.arrivedEvents < 1 ||
  proof?.massConserved !== true ||
  proof?.exactRestoreContinuation !== true ||
  proof?.stationOwnedCargoUnits !== 0 ||
  proof?.consistOccupancyModel !==
    "exclusive-block-atomic-consist"
) {
  throw new Error(
    "Rail simulation proof payload failed its authoritative gates.",
  );
}

const proofDirectory = resolve(workspace, ".qa/rail-network");
mkdirSync(proofDirectory, { recursive: true });
const proofPath = resolve(proofDirectory, "simulation-proof.json");
writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
console.log(`[rail-simulation-proof] wrote ${proofPath}`);
