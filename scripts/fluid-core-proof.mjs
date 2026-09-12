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
    "tests/fluid-network.test.ts",
    "--reporter=verbose",
  ],
  {
    cwd: workspace,
    encoding: "utf8",
    env: {
      ...process.env,
      CINDERLINE_FLUID_PROOF: "1",
    },
  },
);

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const marker = "[fluid-core-proof]";
const proofLine = result.stdout
  .split(/\r?\n/)
  .find((line) => line.startsWith(marker));
if (!proofLine) {
  throw new Error("Fluid proof test completed without a proof payload.");
}
const proof = JSON.parse(proofLine.slice(marker.length));
if (
  proof?.format !== "cinderline-fluid-core-proof" ||
  proof?.exactMass?.conserved !== true
) {
  throw new Error("Fluid proof payload failed its conservation gate.");
}

const proofDirectory = resolve(workspace, ".qa/fluid-network");
mkdirSync(proofDirectory, { recursive: true });
const proofPath = resolve(proofDirectory, "core-proof.json");
writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
console.log(`[fluid-core-proof] wrote ${proofPath}`);
