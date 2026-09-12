import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";

const OUTPUT_DIRECTORY = ".qa/materials";
const APP_URL = process.env.CINDERLINE_URL
  ?? "http://127.0.0.1:4173/?showcase&fresh=materials-qa";
const REPRESENTATIVES = [
  { id: "extractor", label: "EXTRACTOR" },
  { id: "inserter", label: "INSERTER" },
  { id: "smelter", label: "SMELTER" },
  { id: "fabricator", label: "FABRICATOR" },
  { id: "generator", label: "GENERATOR" },
  { id: "storage", label: "STORAGE" },
  { id: "beacon", label: "BEACON" },
  { id: "automation-core", label: "CORE FABRICATOR" },
];

await mkdir(OUTPUT_DIRECTORY, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const warnings = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      warnings.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => warnings.push(`pageerror: ${error.message}`));

  await page.goto(APP_URL, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForFunction(
    () => document.querySelector("#boot")?.classList.contains("is-done"),
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForFunction(
    () => (window.__CINDERLINE__?.stats().entityCount ?? 0) >= 120,
    undefined,
    { timeout: 15_000 },
  );

  const frameTiming = await page.evaluate(async () => {
    const samples = [];
    let previous = performance.now();
    await new Promise((resolve) => {
      const sample = (now) => {
        samples.push(now - previous);
        previous = now;
        if (samples.length >= 90) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    return samples;
  });

  await page.keyboard.press("Space");
  await page.evaluate(() => {
    document.querySelector("#boot")?.remove();
    const hud = document.querySelector("#hud");
    if (hud instanceof HTMLElement) hud.style.display = "none";
    const renderer = window.__CINDERLINE__?.renderer;
    renderer?.setSelected(null);
    renderer?.setHovered(null, null);
    renderer?.render(0);
  });
  await page.waitForTimeout(120);

  const overviewPath = `${OUTPUT_DIRECTORY}/overview.png`;
  await page.screenshot({ path: overviewPath });

  const targets = await page.evaluate((representatives) => {
    const snapshot = window.__CINDERLINE__?.snapshot();
    if (!snapshot) return [];
    return representatives.map(({ id, label }) => {
      const entity = snapshot.entities.find((candidate) => {
        if (id === "automation-core") {
          return candidate.kind === "fabricator"
            && (
              candidate.recipe === "automationCore"
              || candidate.recipeId === "automationCore"
              || candidate.activeRecipeId === "automationCore"
            );
        }
        if (id === "fabricator") {
          return candidate.kind === "fabricator"
            && candidate.recipe !== "automationCore"
            && candidate.recipeId !== "automationCore"
            && candidate.activeRecipeId !== "automationCore";
        }
        return candidate.kind === id;
      });
      if (!entity) return null;
      return {
        id: String(entity.id),
        kind: id,
        label,
        x: entity.x + entity.width * 0.5,
        z: entity.y + entity.height * 0.5,
      };
    });
  }, REPRESENTATIVES);

  if (
    targets.length !== REPRESENTATIVES.length
    || targets.some((target) => target === null)
  ) {
    throw new Error("Material QA could not find one representative of every machine family.");
  }

  await page.evaluate(() => {
    const renderer = window.__CINDERLINE__?.renderer;
    if (!renderer) throw new Error("Renderer QA bridge unavailable.");
    renderer.overlayRoot.visible = false;
    renderer.effectsRoot.visible = false;
    renderer.itemRoot.visible = false;
    renderer.resourceRoot.visible = false;
    renderer.infrastructureRoot.visible = false;

    // Normalize every moving assembly before synchronization is frozen. This
    // keeps before/after material captures pixel-comparable instead of letting
    // a different arm or flywheel pose influence a blind visual verdict.
    for (const rig of renderer.entityObjects.values()) {
      rig.entity = {
        ...rig.entity,
        active: false,
        powered: true,
        progress: 0,
        status: "idle",
      };
      rig.parts.previousProgress = 0;
      rig.parts.previousAuxPhase = 0;
      rig.parts.cycleFlash = 0;
      rig.parts.carrying = false;
      if (rig.parts.rotor) rig.parts.rotor.rotation.set(0, 0, 0);
      for (const cutter of rig.parts.cutters ?? []) cutter.rotation.x = 0;
      for (const roller of rig.parts.rollers ?? []) roller.rotation.y = 0;
      for (const fan of rig.parts.fans ?? []) fan.rotation.z = 0;
      if (rig.parts.turntable) rig.parts.turntable.rotation.y = 0;
      if (rig.parts.flywheel) rig.parts.flywheel.rotation.x = 0;
      if (rig.parts.heroCoreGlow) rig.parts.heroCoreGlow.rotation.y = 0;
      if (rig.parts.hatch) rig.parts.hatch.rotation.y = 0;
      if (rig.parts.ringA) rig.parts.ringA.rotation.y = 0;
      if (rig.parts.ringB) rig.parts.ringB.rotation.y = 0;
      renderer.animateRig(rig, 0, 0);
    }
    renderer.sync = () => {};
    renderer.update = () => {};
  });

  const canvasBox = await page.locator("#world").boundingBox();
  if (!canvasBox || canvasBox.width < 1000 || canvasBox.height < 600) {
    throw new Error("Material QA canvas is missing or unexpectedly small.");
  }

  const captures = [];
  for (const target of targets) {
    const placement = await page.evaluate(({ id, x, z }) => {
      const renderer = window.__CINDERLINE__?.renderer;
      if (!renderer) throw new Error("Renderer QA bridge unavailable.");
      for (const [entityId, rig] of renderer.entityObjects) {
        rig.root.visible = String(entityId) === id;
      }
      renderer.focus(x, z);
      for (let step = 0; step < 8; step += 1) renderer.zoom(-4);
      renderer.render(0);
      const rig = [...renderer.entityObjects.entries()]
        .find(([entityId]) => String(entityId) === id)?.[1];
      if (!rig?.root.visible) return null;
      const projected = rig.root.position.clone().project(renderer.camera);
      return {
        screenX: (projected.x * 0.5 + 0.5) * renderer.canvas.clientWidth,
        screenY: (-projected.y * 0.5 + 0.5) * renderer.canvas.clientHeight,
      };
    }, target);
    if (!placement) throw new Error(`Material QA could not display ${target.label}.`);
    const centerError = Math.hypot(
      placement.screenX - canvasBox.width * 0.5,
      placement.screenY - canvasBox.height * 0.5,
    );
    if (centerError > 4) {
      throw new Error(`${target.label} capture is off-center by ${centerError.toFixed(1)}px.`);
    }

    const path = `${OUTPUT_DIRECTORY}/${target.kind}.png`;
    const buffer = await page.screenshot({
      path,
      clip: {
        x: canvasBox.x + canvasBox.width * 0.5 - 180,
        y: canvasBox.y + canvasBox.height * 0.5 - 160,
        width: 360,
        height: 320,
      },
    });
    captures.push({
      kind: target.kind,
      label: target.label,
      path,
      dataURL: `data:image/png;base64,${buffer.toString("base64")}`,
    });
  }

  const renderStats = await page.evaluate(() => {
    const renderer = window.__CINDERLINE__?.renderer;
    renderer?.render(0);
    return {
      calls: renderer?.renderer?.info.render.calls ?? null,
      triangles: renderer?.renderer?.info.render.triangles ?? null,
      programs: renderer?.renderer?.info.programs?.length ?? null,
      textures: renderer?.renderer?.info.memory.textures ?? null,
      geometries: renderer?.renderer?.info.memory.geometries ?? null,
    };
  });

  if (warnings.length > 0) {
    throw new Error(`Material QA observed browser warnings:\n${warnings.join("\n")}`);
  }

  const sheet = await context.newPage();
  await sheet.setViewportSize({ width: 1440, height: 720 });
  await sheet.setContent(contactSheetMarkup(captures), { waitUntil: "load" });
  const contactSheetPath = `${OUTPUT_DIRECTORY}/contact-sheet.png`;
  await sheet.screenshot({ path: contactSheetPath, fullPage: true });

  // Verify that every written PNG can be read before reporting a passing gate.
  await Promise.all(
    [overviewPath, contactSheetPath, ...captures.map(({ path }) => path)]
      .map((path) => readFile(path)),
  );

  const sortedTiming = [...frameTiming].sort((left, right) => left - right);
  const meanMs = frameTiming.reduce((sum, value) => sum + value, 0) / frameTiming.length;
  const p95Ms = sortedTiming[Math.floor(sortedTiming.length * 0.95)] ?? 0;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    overview: overviewPath,
    contactSheet: contactSheetPath,
    representatives: captures.map(({ kind, label, path }) => ({ kind, label, path })),
    renderStats,
    timing: {
      meanMs: Number(meanMs.toFixed(3)),
      p95Ms: Number(p95Ms.toFixed(3)),
      samples: frameTiming.length,
    },
    warnings,
  }, null, 2)}\n`);

  await context.close();
} finally {
  await browser.close();
}

function contactSheetMarkup(captures) {
  return `<!doctype html>
    <meta charset="utf-8">
    <style>
      * { box-sizing: border-box; }
      html, body {
        width: 1440px;
        min-height: 720px;
        margin: 0;
        overflow: hidden;
        background: #071012;
        color: #dce6e2;
        font: 700 14px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      main {
        display: grid;
        grid-template-columns: repeat(4, 360px);
        grid-template-rows: repeat(2, 360px);
      }
      figure {
        position: relative;
        width: 360px;
        height: 360px;
        margin: 0;
        overflow: hidden;
        border: 1px solid #31423f;
        background: #101719;
      }
      img { display: block; width: 360px; height: 320px; object-fit: cover; }
      figcaption {
        height: 40px;
        padding: 13px 12px 0;
        color: #9ff5d8;
        border-top: 1px solid #31423f;
        letter-spacing: .1em;
      }
    </style>
    <main>
      ${captures.map(({ label, dataURL }) => `
        <figure>
          <img src="${dataURL}" alt="${label}">
          <figcaption>${label}</figcaption>
        </figure>
      `).join("")}
    </main>`;
}
