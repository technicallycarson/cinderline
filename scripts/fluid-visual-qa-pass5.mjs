import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

// PASS5 intentionally reuses the already exhaustive authoritative lifecycle
// harness while redirecting every mutable artifact into a new custody tree.
// Keeping the transformation here also makes it impossible for formative
// runs to mutate the sealed PASS4 evidence.
const source = await readFile(
  new URL("./fluid-visual-qa.mjs", import.meta.url),
  "utf8",
);
const outputDirectory =
  process.env.CINDERLINE_FLUID_PASS5_OUTPUT ??
  ".qa/fluid-network/pass5-work/formative";
const transformed = source
  .replace(
    'const OUTPUT_DIRECTORY = ".qa/fluid-network";',
    `const OUTPUT_DIRECTORY = ${JSON.stringify(outputDirectory)};`,
  )
  .replace(
    "/?fresh=fluid-visual-qa-v4",
    "/?fresh=fluid-visual-qa-pass5&railFixture=fluid-pass5",
  )
  .replace(
    "heroMainlineEntityIds: setup.heroMainlineEntityIds,",
    "heroMainlineEntityIds: setup.fluidPlacements.filter(({ id }) => !setup.lifecycleEntityIds.includes(id)).map(({ id }) => id),",
  )
  .replace(
    "const heroEntityIds = setup.heroMainlineEntityIds;",
    "const heroEntityIds = heroPlacements.map(({ id }) => id);",
  )
  .replace(
    `({ x, y }) => x >= 14 && x <= 20 && y >= 10 && y <= 12,`,
    `({ x, y }) => x >= 14 && x <= 17 && y >= 10 && y <= 12,`,
  )
  .replace(
    `"source-pump-close.png",
    17.5,
    11.35,
    7.6,`,
    `"source-pump-close.png",
    15.8,
    11.25,
    5.2,`,
  )
  .replace(
    `"hero-source-pump-and-feed-header-only",
  );`,
    `"hero-source-pump-and-feed-header-only",
    true,
  );`,
  )
  .replace(
    `(kind === "fluidTank" && y <= 13) ||
        ((kind === "fluidPipe" || kind === "fluidPump") &&
          x >= 22 &&
          x <= 24 &&
          y >= 9 &&
          y <= 14)`,
    `(kind === "fluidTank" || kind === "fluidProcessor") &&
          x >= 18 &&
          x <= 27 &&
          y >= 7 &&
          y <= 17 ||
        ((kind === "fluidPipe" || kind === "fluidPump") &&
          x >= 20 &&
          x <= 25 &&
          y >= 7 &&
          y <= 16)`,
  )
  .replace(
    `"tank-manifold-close.png",
    23.5,
    11.5,
    15.5,`,
    `"tank-manifold-close.png",
    25,
    11.6,
    13.2,`,
  )
  .replace(
    `"hero-three-family-buffer-and-custody-bank-only",
  );`,
    `"hero-three-family-buffer-and-custody-bank-only",
    true,
  );`,
  )
  .replace(
    `    imageDigests[imageName] = imageRecord.sha256;
    previousPhaseImage = image;
    return {
      ...stage,
      image: imageRecord,
    };`,
    `    imageDigests[imageName] = imageRecord.sha256;
    previousPhaseImage = image;
    const detailSpec =
      label === "cold-and-empty" || label === "first-extraction-stroke"
        ? {
            file:
              label === "cold-and-empty"
                ? "source-close-phase-00-inactive.png"
                : "source-close-phase-01-active.png",
            ids: setup.fluidPlacements
              .filter(
                ({ id, kind, x }) =>
                  setup.lifecycleEntityIds.includes(id) &&
                  x <= 5 &&
                  (kind === "fluidSource" ||
                    kind === "fluidPump" ||
                    kind === "fluidPipe"),
              )
              .map(({ id }) => id),
          }
        : label === "product-transfer" ||
            label === "storage-and-backpressure"
          ? {
              file:
                label === "product-transfer"
                  ? "processor-close-phase-03-transfer.png"
                  : "processor-close-phase-04-backpressure.png",
              ids: setup.fluidPlacements
                .filter(
                  ({ id, x }) =>
                    setup.lifecycleEntityIds.includes(id) && x >= 5,
                )
                .map(({ id }) => id),
            }
          : null;
    let detailImage = null;
    if (detailSpec) {
      const cameraFit = await page.evaluate((includedEntityIds) => {
        const game = window.__CINDERLINE__;
        const world = game?.renderer;
        if (!game || !world) {
          throw new Error("Fluid detail proof renderer is unavailable.");
        }
        window.__fluidQaIncludedEntityIds = includedEntityIds;
        window.__fluidQaShowDistrictFloor = true;
        const snapshot = game.simulation.getRenderSnapshot();
        world.sync(window.__fluidQaAdapt(snapshot));
        window.__fluidQaHideUtilities?.();
        const fit = window.__fluidQaFitHeroCamera?.(0.12);
        if (!fit) throw new Error("Fluid detail camera fitter is unavailable.");
        world.update(0, snapshot.elapsedSeconds);
        window.__fluidQaHideUtilities?.();
        world.render(0);
        world.renderer.getContext().finish();
        return fit;
      }, detailSpec.ids);
      await page.waitForTimeout(32);
      const detailBuffer = await worldCanvas.screenshot({
        path: \`\${OUTPUT_DIRECTORY}/\${detailSpec.file}\`,
      });
      detailImage = {
        file: detailSpec.file,
        sha256: digest(detailBuffer),
        bytes: detailBuffer.byteLength,
        includedEntityCount: detailSpec.ids.length,
        cameraFit,
      };
      imageDigests[detailSpec.file] = detailImage.sha256;
    }
    return {
      ...stage,
      image: imageRecord,
      ...(detailImage ? { detailImage } : {}),
    };`,
  )
  .replaceAll(
    "window.__fluidQaShowDistrictFloor = false;",
    "window.__fluidQaShowDistrictFloor = true;",
  );

if (transformed === source) {
  throw new Error("PASS5 QA harness transformation did not apply.");
}

const child = spawn(
  process.execPath,
  ["--input-type=module", "--eval", transformed],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  },
);

child.once("error", (error) => {
  throw error;
});

const exitCode = await new Promise((resolve) => {
  child.once("exit", (code, signal) => {
    if (signal) {
      throw new Error(`PASS5 QA harness terminated by ${signal}.`);
    }
    resolve(code ?? 1);
  });
});

if (exitCode !== 0) process.exitCode = exitCode;
