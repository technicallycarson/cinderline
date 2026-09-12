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
    "tests/circuit-network.test.ts",
    "--reporter=verbose",
  ],
  {
    cwd: workspace,
    encoding: "utf8",
    env: {
      ...process.env,
      CINDERLINE_CIRCUIT_PROOF: "1",
    },
  },
);

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const marker = "[circuit-core-proof]";
const proofLine = result.stdout
  .split(/\r?\n/)
  .find((line) => line.startsWith(marker));
if (!proofLine) {
  throw new Error("Circuit tests completed without a proof payload.");
}

const proof = JSON.parse(proofLine.slice(marker.length));
const stages = proof?.oneTickStages;
if (
  proof?.format !== "cinderline-circuit-core-proof" ||
  proof?.exactRestoreContinuation !== true ||
  proof?.finalControl?.enabled !== true ||
  !Number.isSafeInteger(proof?.canonicalByteLength) ||
  proof.canonicalByteLength < 1 ||
  stages?.arithmeticReadAtTick !== stages?.sensorPublishedAtTick + 1 ||
  stages?.deciderReadAtTick !== stages?.arithmeticReadAtTick + 1 ||
  stages?.machineEnabledAtTick !== stages?.deciderReadAtTick + 1
) {
  throw new Error("Circuit proof payload failed its deterministic gates.");
}

const proofDirectory = resolve(workspace, ".qa/circuit-network");
mkdirSync(proofDirectory, { recursive: true });
const proofPath = resolve(proofDirectory, "core-proof.json");
writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
console.log(`[circuit-core-proof] wrote ${proofPath}`);
