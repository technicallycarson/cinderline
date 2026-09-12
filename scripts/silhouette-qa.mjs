import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const QA_DIRECTORY = ".qa/silhouette";
const APP_URL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173/?fresh";
const MACHINE_ORDER = [
  "extractor",
  "inserter",
  "smelter",
  "fabricator",
  "generator",
  "storage",
  "beacon",
  "automation-core",
];
const LABELS = "ABCDEFGH".split("");
await mkdir(QA_DIRECTORY, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 480, height: 480 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

try {
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => Boolean(window.__CINDERLINE__?.stats().entityCount),
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(600);
  await page.keyboard.press("Space");

  const targets = await page.evaluate((machineOrder) => {
    const snapshot = window.__CINDERLINE__?.snapshot();
    if (!snapshot) return [];
    return machineOrder.map((requestedKind) => {
      if (requestedKind === "automation-core") {
        return snapshot.entities.find(
          (entity) => (
            entity.kind === "fabricator"
            && (entity.recipeId === "automationCore" || entity.activeRecipeId === "automationCore")
          ),
        );
      }
      if (requestedKind === "fabricator") {
        return snapshot.entities.find(
          (entity) => (
            entity.kind === "fabricator"
            && entity.recipeId !== "automationCore"
            && entity.activeRecipeId !== "automationCore"
          ),
        );
      }
      return snapshot.entities.find((entity) => entity.kind === requestedKind);
    });
  }, MACHINE_ORDER);

  if (targets.length !== MACHINE_ORDER.length || targets.some((target) => !target)) {
    throw new Error("Silhouette QA could not find one representative of every machine family.");
  }

  await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    const renderer = game?.renderer;
    if (!renderer) throw new Error("Renderer QA bridge unavailable.");

    document.querySelector("#boot")?.remove();
    const hud = document.querySelector("#hud");
    if (hud instanceof HTMLElement) hud.style.display = "none";
    document.body.style.background = "#252525";

    renderer.setSelected(null);
    renderer.setHovered(null, null);
    // Freeze renderer synchronization after the initial representative lookup.
    // The live game normally reasserts entity visibility on every sync.
    renderer.sync = () => {};
    renderer.update = () => {};
    renderer.overlayRoot.visible = false;
    renderer.effectsRoot.visible = false;
    renderer.itemRoot.visible = false;
    renderer.resourceRoot.visible = false;
    renderer.infrastructureRoot.visible = false;

    const materials = new Set();
    renderer.entityRoot.traverse((object) => {
      if (!object.isMesh) return;
      const objectMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of objectMaterials) materials.add(material);
    });

    for (const material of materials) {
      if (!material?.isMeshStandardMaterial) continue;
      const color = material.color;
      const luminance =
        color.r * 0.2126
        + color.g * 0.7152
        + color.b * 0.0722;
      const band = luminance < 0.2
        ? 0.15
        : luminance < 0.47
          ? 0.3
          : luminance < 0.72
            ? 0.52
            : 0.75;
      material.color.setRGB(band, band, band);
      material.emissive.setRGB(0, 0, 0);
      material.emissiveIntensity = 0;
      material.metalness = 0;
      material.roughness = 0.82;
      material.needsUpdate = true;
    }

    if (renderer.ground?.material?.isMeshStandardMaterial) {
      renderer.ground.material.color.setRGB(0.13, 0.13, 0.13);
      renderer.ground.material.map = null;
      renderer.ground.material.bumpMap = null;
      renderer.ground.material.needsUpdate = true;
    }
  });

  const rawPaths = [];
  for (let index = 0; index < MACHINE_ORDER.length; index += 1) {
    const target = targets[index];
    const requestedKind = MACHINE_ORDER[index];
    const label = LABELS[index];

    await page.evaluate(
      ({ id, focusX, focusZ }) => {
        const renderer = window.__CINDERLINE__?.renderer;
        if (!renderer) throw new Error("Renderer QA bridge unavailable.");
        for (const [entityId, rig] of renderer.entityObjects) {
          rig.root.visible = String(entityId) === String(id);
        }
        renderer.focus(focusX, focusZ);
        for (let zoomStep = 0; zoomStep < 8; zoomStep += 1) renderer.zoom(-4);
        renderer.render(0);
      },
      {
        id: target.id,
        focusX: target.x + target.width * 0.5,
        focusZ: target.y + target.height * 0.5,
      },
    );
    await page.waitForTimeout(80);

    const canvasBox = await page.locator("#world").boundingBox();
    if (!canvasBox) throw new Error("World canvas has no capture bounds.");
    const cropSize = 96;
    const rawPath = `${QA_DIRECTORY}/raw-${label}.png`;
    await page.screenshot({
      path: rawPath,
      clip: {
        x: canvasBox.x + canvasBox.width * 0.5 - cropSize * 0.5,
        y: canvasBox.y + canvasBox.height * 0.5 - cropSize * 0.5,
        width: cropSize,
        height: cropSize,
      },
    });
    rawPaths.push(rawPath);

    if (
      requestedKind === "automation-core"
      && target.recipeId !== "automationCore"
      && target.activeRecipeId !== "automationCore"
    ) {
      throw new Error("Automation-core silhouette representative has the wrong recipe.");
    }
  }

  const sheet = await context.newPage();
  await sheet.setViewportSize({ width: 816, height: 432 });
  const cells = await Promise.all(
    rawPaths.map(async (path, index) => {
      const source = (await readFile(path)).toString("base64");
      return `
        <figure>
          <div class="sample">
            <img src="data:image/png;base64,${source}" alt="Anonymous machine ${LABELS[index]}">
          </div>
          <figcaption>${LABELS[index]}</figcaption>
        </figure>
      `;
    }),
  );
  await sheet.setContent(`
    <!doctype html>
    <meta charset="utf-8">
    <style>
      * { box-sizing: border-box; }
      html, body {
        width: 100%;
        min-height: 100%;
        margin: 0;
        background: #111718;
        color: #dce6e2;
        font: 700 18px/1 ui-monospace, monospace;
      }
      main {
        display: grid;
        grid-template-columns: repeat(4, 192px);
        gap: 12px 8px;
        padding: 8px;
      }
      figure { width: 192px; margin: 0; }
      .sample {
        width: 192px;
        height: 176px;
        overflow: hidden;
        border: 1px solid #50605d;
        background: #212728;
      }
      img {
        display: block;
        width: 48px;
        height: 48px;
        transform: scale(4);
        transform-origin: 0 0;
        filter: grayscale(1) blur(1.25px) contrast(1.08);
      }
      figcaption {
        height: 24px;
        padding-top: 4px;
        color: #9ff5d8;
        text-align: center;
      }
    </style>
    <main>${cells.join("")}</main>
  `);
  await sheet.screenshot({
    path: `${QA_DIRECTORY}/anonymous-contact-sheet.png`,
    fullPage: true,
  });

  const key = Object.fromEntries(
    LABELS.map((label, index) => [label, MACHINE_ORDER[index]]),
  );
  await writeFile(
    `${QA_DIRECTORY}/key.json`,
    `${JSON.stringify(key, null, 2)}\n`,
    "utf8",
  );

  console.log(JSON.stringify({
    ok: true,
    representatives: MACHINE_ORDER.length,
    raw: rawPaths,
    contactSheet: `${QA_DIRECTORY}/anonymous-contact-sheet.png`,
    key: `${QA_DIRECTORY}/key.json`,
  }, null, 2));
} finally {
  await browser.close();
}
