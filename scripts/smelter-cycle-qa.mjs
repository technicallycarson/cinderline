import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY = ".qa/smelter-cycle";
const PHASES = [
  { name: "warmup", progress: 0.08 },
  { name: "heat", progress: 0.32 },
  { name: "soak", progress: 0.62 },
  { name: "door", progress: 0.84 },
  { name: "discharge", progress: 0.96 },
  { name: "cycle-flash", progress: 0.03 },
];

await mkdir(OUTPUT_DIRECTORY, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 960, height: 720 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/?fresh=smelter-cycle-qa`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => document.querySelector("#boot")?.classList.contains("is-done"),
    undefined,
    { timeout: 15_000 },
  );

  const target = await page.evaluate(() => {
    const entity = window.__CINDERLINE__?.snapshot().entities.find(
      (candidate) => candidate.kind === "smelter",
    );
    if (!entity) return null;
    return {
      id: String(entity.id),
      x: entity.x,
      y: entity.y,
      width: entity.width,
      height: entity.height,
    };
  });
  if (!target) throw new Error("Smelter-cycle QA could not locate a representative smelter.");

  const partNames = await page.evaluate(
    ({ id, focusX, focusZ }) => {
      const renderer = window.__CINDERLINE__?.renderer;
      if (!renderer) throw new Error("Renderer QA bridge unavailable.");

      document.querySelector("#boot")?.remove();
      const hud = document.querySelector("#hud");
      if (hud instanceof HTMLElement) hud.style.display = "none";

      const isolate = () => {
        renderer.resourceRoot.visible = false;
        renderer.itemRoot.visible = false;
        renderer.effectsRoot.visible = false;
        renderer.overlayRoot.visible = false;
        for (const [entityId, rig] of renderer.entityObjects) {
          rig.root.visible = String(entityId) === id;
        }
      };
      const originalSync = renderer.sync.bind(renderer);
      renderer.sync = (snapshot) => {
        const hero = snapshot.entities.find((entity) => String(entity.id) === id);
        if (hero) {
          hero.active = true;
          hero.status = "working";
          hero.progress = window.__SMELTER_CYCLE_QA_PROGRESS__ ?? 0.08;
        }
        originalSync(snapshot);
        isolate();
      };
      window.__SMELTER_CYCLE_QA_PROGRESS__ = 0.08;
      isolate();
      renderer.focus(focusX, focusZ);
      for (let step = 0; step < 8; step += 1) renderer.zoom(-4);
      renderer.render(0);

      const rig = [...renderer.entityObjects.entries()]
        .find(([entityId]) => String(entityId) === id)?.[1];
      return rig ? Object.keys(rig.parts).sort() : [];
    },
    {
      id: target.id,
      focusX: target.x + target.width * 0.5,
      focusZ: target.y + target.height * 0.5,
    },
  );
  for (const required of [
    "crucibleRing",
    "crucibleGlow",
    "doorGlow",
    "furnaceDoor",
    "heatVents",
    "dischargeGlow",
    "flashCore",
  ]) {
    if (!partNames.includes(required)) {
      throw new Error(`Smelter-cycle QA is missing required rig part ${required}.`);
    }
  }

  const canvasBox = await page.locator("#world").boundingBox();
  if (!canvasBox) throw new Error("Smelter-cycle QA could not read world-canvas bounds.");
  const cropSize = 240;
  const heroClip = {
    x: canvasBox.x + canvasBox.width * 0.5 - cropSize * 0.5,
    y: canvasBox.y + canvasBox.height * 0.5 - cropSize * 0.5,
    width: cropSize,
    height: cropSize,
  };

  const captures = [];
  for (let index = 0; index < PHASES.length; index += 1) {
    const phase = PHASES[index];
    await page.evaluate((progress) => {
      window.__SMELTER_CYCLE_QA_PROGRESS__ = progress;
    }, phase.progress);
    await page.waitForTimeout(42);

    const state = await page.evaluate((id) => {
      const renderer = window.__CINDERLINE__?.renderer;
      const rig = [...(renderer?.entityObjects.entries() ?? [])]
        .find(([entityId]) => String(entityId) === id)?.[1];
      if (!rig) return null;
      const intensity = (part) => (
        part?.material?.isMeshStandardMaterial
          ? Number(part.material.emissiveIntensity.toFixed(3))
          : null
      );
      return {
        progress: Number((rig.entity.progress ?? 0).toFixed(3)),
        cycleFlash: Number((rig.parts.cycleFlash ?? 0).toFixed(3)),
        ring: intensity(rig.parts.crucibleRing),
        crucible: intensity(rig.parts.crucibleGlow),
        door: intensity(rig.parts.doorGlow),
        vents: Number((
          (rig.parts.heatVents ?? []).reduce((sum, part) => sum + (intensity(part) ?? 0), 0)
          / Math.max(1, rig.parts.heatVents?.length ?? 0)
        ).toFixed(3)),
        discharge: intensity(rig.parts.dischargeGlow),
        flashCore: intensity(rig.parts.flashCore),
        doorY: Number((rig.parts.furnaceDoor?.position.y ?? 0).toFixed(3)),
      };
    }, target.id);
    if (!state) throw new Error(`Smelter-cycle QA could not read phase ${phase.name}.`);

    const path = `${OUTPUT_DIRECTORY}/frame-${String(index + 1).padStart(2, "0")}-${phase.name}.png`;
    const buffer = await page.screenshot({ path, clip: heroClip });
    captures.push({
      phase: phase.name,
      path,
      state,
      dataURL: `data:image/png;base64,${buffer.toString("base64")}`,
    });
  }

  const sheet = await context.newPage();
  await sheet.setViewportSize({ width: 1440, height: 960 });
  await sheet.setContent(contactSheetMarkup(captures), { waitUntil: "load" });
  await sheet.screenshot({
    path: `${OUTPUT_DIRECTORY}/contact-sheet.png`,
    fullPage: true,
  });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    targetId: target.id,
    parts: partNames,
    phases: captures.map(({ phase, path, state }) => ({ phase, path, ...state })),
    contactSheet: `${OUTPUT_DIRECTORY}/contact-sheet.png`,
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
      html, body { margin: 0; width: 100%; min-height: 100%; background: #071012; }
      main {
        display: grid; grid-template-columns: repeat(3, 1fr);
        width: 1440px; height: 960px; gap: 3px; padding: 3px;
      }
      figure { position: relative; margin: 0; overflow: hidden; background: #101719; }
      img { display: block; width: 100%; height: 100%; object-fit: cover; }
      figcaption {
        position: absolute; inset: 12px auto auto 12px; min-width: 235px; padding: 8px 11px;
        color: #bffff0; background: rgba(5, 15, 16, .9); border: 1px solid #58f1cf;
        font: 700 13px/1.25 ui-monospace, SFMono-Regular, monospace;
        letter-spacing: .1em; text-transform: uppercase;
      }
      small { display: block; margin-top: 5px; color: #a6b8b2; font-size: 10px; letter-spacing: .05em; }
    </style>
    <main>
      ${captures.map(({ phase, state, dataURL }) => `
        <figure>
          <img src="${dataURL}" alt="${phase} smelter phase">
          <figcaption>
            ${phase}
            <small>
              P ${state.progress.toFixed(2)} // R ${state.ring} // C ${state.crucible}
              // D ${state.door} // V ${state.vents} // O ${state.discharge} // F ${state.flashCore}
            </small>
          </figcaption>
        </figure>
      `).join("")}
    </main>`;
}
