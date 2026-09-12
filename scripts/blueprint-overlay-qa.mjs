import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY = ".qa/blueprint-overlay";

await mkdir(OUTPUT_DIRECTORY, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
});
const errors = [];

page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

try {
  await page.goto(`${BASE_URL}/?fresh=blueprint-overlay-qa`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#boot")?.classList.contains("is-done") &&
      Boolean(window.__CINDERLINE__?.stats().entityCount) &&
      typeof window.__CINDERLINE__?.renderer.getBlueprintOverlayDebug ===
        "function",
    null,
    { timeout: 12_000 },
  );
  await page.waitForTimeout(800);

  const captureCorners = await locateCells(page, [
    { x: 7, z: 4 },
    { x: 13, z: 6 },
  ]);
  assert(captureCorners.every(Boolean), "Blueprint capture cells are not visible.");

  await page.keyboard.press("b");
  await page.mouse.move(
    captureCorners[0].clientX,
    captureCorners[0].clientY,
  );
  await page.mouse.down();
  await page.mouse.move(
    captureCorners[1].clientX,
    captureCorners[1].clientY,
    { steps: 10 },
  );
  await page.waitForFunction(
    () => {
      const debug =
        window.__CINDERLINE__?.renderer.getBlueprintOverlayDebug?.();
      return (debug?.captureIncluded ?? 0) >= 6;
    },
  );
  const captureDebug = await overlayDebug(page);
  assert(
    captureDebug.captureIncluded >= 6,
    "Capture marquee did not tint intersecting construction.",
  );
  await page.screenshot({
    path: `${OUTPUT_DIRECTORY}/capture-marquee.png`,
  });
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      window.__CINDERLINE__?.blueprint.mode === "paste" &&
      (window.__CINDERLINE__?.blueprint.clipboard?.entities.length ?? 0) >= 6,
  );

  const destination = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game) return null;
    const seen = new Set();
    for (let clientY = 300; clientY <= 900; clientY += 8) {
      for (let clientX = 320; clientX <= 1600; clientX += 8) {
        if (document.elementFromPoint(clientX, clientY)?.id !== "world") {
          continue;
        }
        const cell = game.renderer.screenToGrid(clientX, clientY);
        if (!cell) continue;
        const key = `${cell.x},${cell.z}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (game.previewBlueprint(cell.x, cell.z).ok) {
          return { clientX, clientY, x: cell.x, z: cell.z };
        }
      }
    }
    return null;
  });
  assert(destination, "No valid multi-unit blueprint destination was visible.");

  await page.mouse.move(destination.clientX, destination.clientY);
  await page.waitForFunction(
    () => {
      const debug =
        window.__CINDERLINE__?.renderer.getBlueprintOverlayDebug?.();
      return (debug?.total ?? 0) >= 6 && debug?.counts?.construct >= 6;
    },
  );
  const constructDebug = await overlayDebug(page);
  assert(
    constructDebug.total >= 6 &&
      constructDebug.detailed === constructDebug.total &&
      constructDebug.counts.construct === constructDebug.total,
    `Construction hologram contract failed: ${JSON.stringify(constructDebug)}`,
  );
  await page.screenshot({
    path: `${OUTPUT_DIRECTORY}/construct-plan.png`,
  });

  const beforePlacement = await page.evaluate(
    () => window.__CINDERLINE__?.stats().entityCount ?? 0,
  );
  await page.mouse.click(destination.clientX, destination.clientY);
  await page.waitForFunction(
    (before) =>
      (window.__CINDERLINE__?.stats().entityCount ?? 0) >= before + 6,
    beforePlacement,
  );

  const mutationProof = await page.evaluate(({ x, z }) => {
    const game = window.__CINDERLINE__;
    if (!game) return null;
    const preview = game.previewBlueprint(x, z);
    const smelter = preview.diagnostics.find(
      (diagnostic) =>
        diagnostic.action === "match" &&
        diagnostic.placement.kind === "smelter" &&
        diagnostic.entityId !== undefined,
    );
    const belts = preview.diagnostics.filter(
      (diagnostic) =>
        diagnostic.action === "match" &&
        diagnostic.placement.kind === "belt",
    );
    if (!smelter || belts.length < 2) return null;
    const recipeResult = game.simulation.requestRecipeChange(
      smelter.entityId,
      smelter.placement.recipeId === null ? "smeltIron" : null,
    );
    const missing = belts[0].placement;
    const occupied = belts[1].placement;
    const removedMissing = game.simulation.remove(missing.x, missing.y);
    const removedOccupied = game.simulation.remove(occupied.x, occupied.y);
    const obstruction = game.simulation.place(
      "gridRelay",
      occupied.x,
      occupied.y,
      0,
    );
    return {
      recipeOk: recipeResult.ok,
      removedMissing: Boolean(removedMissing),
      removedOccupied: Boolean(removedOccupied),
      obstructionOk: obstruction.ok,
    };
  }, { x: destination.x, z: destination.z });
  assert(
    mutationProof?.recipeOk &&
      mutationProof.removedMissing &&
      mutationProof.removedOccupied &&
      mutationProof.obstructionOk,
    `Could not construct the four-state overlay fixture: ${JSON.stringify(
      mutationProof,
    )}`,
  );
  await page.mouse.move(destination.clientX + 28, destination.clientY + 18);
  await page.mouse.move(destination.clientX, destination.clientY, { steps: 3 });
  await page.waitForFunction(
    () => {
      const counts =
        window.__CINDERLINE__?.renderer.getBlueprintOverlayDebug?.().counts;
      return (
        counts?.construct >= 1 &&
        counts.configure >= 1 &&
        counts.match >= 1 &&
        counts.blocked >= 1
      );
    },
  );
  const semanticDebug = await overlayDebug(page);
  for (const state of ["construct", "configure", "match", "blocked"]) {
    assert(
      semanticDebug.counts[state] >= 1,
      `${state} was not represented in the semantic hologram.`,
    );
  }
  await page.screenshot({
    path: `${OUTPUT_DIRECTORY}/semantic-four-state.png`,
  });

  const scaleDebug = await page.evaluate(async () => {
    const game = window.__CINDERLINE__;
    if (!game) return null;
    const overlay = await import("/src/render/blueprintOverlay.ts");
    const placements = Array.from({ length: 4_096 }, (_, index) => ({
      kind: "belt",
      x: 2 + (index % 64),
      z: 2 + Math.floor(index / 64),
      direction: index % 4,
      state: index % 31 === 0 ? "blocked" : "construct",
    }));
    const layout = overlay.createBlueprintOverlayLayout({
      anchorX: 2,
      anchorZ: 2,
      width: 64,
      height: 64,
      focus: { x: 34, z: 34 },
      placements,
    });
    game.renderer.setBlueprintCaptureMarquee(null);
    game.renderer.setBlueprintOverlay(layout);
    game.renderer.focus(34, 34);
    for (let index = 0; index < 8; index += 1) game.renderer.zoom(4);
    return game.renderer.getBlueprintOverlayDebug();
  });
  assert(
    scaleDebug?.total === 4_096 &&
      scaleDebug.detailed === 96 &&
      scaleDebug.batches <= 8 &&
      scaleDebug.counts.construct + scaleDebug.counts.blocked === 4_096,
    `4,096-unit overlay contract failed: ${JSON.stringify(scaleDebug)}`,
  );
  const frameP95 = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const samples = [];
        let previous = performance.now();
        const sample = (now) => {
          samples.push(now - previous);
          previous = now;
          if (samples.length < 120) {
            requestAnimationFrame(sample);
            return;
          }
          samples.sort((left, right) => left - right);
          resolve(samples[Math.floor(samples.length * 0.95)]);
        };
        requestAnimationFrame(sample);
      }),
  );
  assert(
    frameP95 <= 35,
    `4,096-unit overlay frame p95 exceeded 35ms (${frameP95.toFixed(2)}ms).`,
  );
  await page.screenshot({
    path: `${OUTPUT_DIRECTORY}/scale-4096.png`,
  });

  assert(errors.length === 0, errors.join("\n"));
  console.log(
    JSON.stringify(
      {
        ok: true,
        captureDebug,
        constructDebug,
        semanticDebug,
        scaleDebug,
        frameP95,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}

async function locateCells(page, targets) {
  return page.evaluate((requested) => {
    const game = window.__CINDERLINE__;
    if (!game) return requested.map(() => null);
    return requested.map((target) => {
      for (let clientY = 145; clientY <= 820; clientY += 4) {
        for (let clientX = 260; clientX <= 1660; clientX += 4) {
          if (document.elementFromPoint(clientX, clientY)?.id !== "world") {
            continue;
          }
          const cell = game.renderer.screenToGrid(clientX, clientY);
          if (cell?.x === target.x && cell.z === target.z) {
            return { clientX, clientY };
          }
        }
      }
      return null;
    });
  }, targets);
}

async function overlayDebug(page) {
  return page.evaluate(
    () => window.__CINDERLINE__?.renderer.getBlueprintOverlayDebug?.(),
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
