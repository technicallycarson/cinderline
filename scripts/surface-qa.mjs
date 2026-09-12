import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY = ".qa/surface";

await mkdir(OUTPUT_DIRECTORY, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      failures.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));

  await page.goto(`${BASE_URL}/?fresh=surface-qa`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => document.querySelector("#boot")?.classList.contains("is-done"),
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForFunction(
    () => (window.__CINDERLINE__?.stats().beltItemCount ?? 0) >= 180,
    undefined,
    { timeout: 15_000 },
  );
  await page.keyboard.press("Space");
  await page.evaluate(() => {
    document.querySelector("#boot")?.remove();
    const hud = document.querySelector("#hud");
    if (hud instanceof HTMLElement) hud.style.display = "none";
  });
  await page.waitForTimeout(180);

  const targets = await page.evaluate(() => {
    const snapshot = window.__CINDERLINE__?.snapshot();
    if (!snapshot) return null;
    const smelter = snapshot.entities.find((entity) => entity.kind === "smelter");
    const hero = snapshot.entities.find(
      (entity) => (
        entity.kind === "fabricator"
        && (entity.recipe === "automationCore" || entity.activeRecipeId === "automationCore")
      ),
    );
    if (!smelter || !hero) return null;
    return { smelter: String(smelter.id), hero: String(hero.id) };
  });
  if (!targets) throw new Error("Surface QA could not locate its fixed machine targets.");

  const timing = await page.evaluate(async () => {
    const samples = [];
    let previous = performance.now();
    await new Promise((resolve) => {
      const step = (now) => {
        samples.push(now - previous);
        previous = now;
        if (samples.length >= 120) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    return samples;
  });

  const captures = [];
  const capture = async (name, caption, clip) => {
    const path = `${OUTPUT_DIRECTORY}/${name}.png`;
    const buffer = await page.screenshot({ path, clip });
    captures.push({
      caption,
      path,
      dataURL: `data:image/png;base64,${buffer.toString("base64")}`,
    });
  };

  await capture("overview", "OVERVIEW // GROUND CONTINUITY");
  await page.evaluate((id) => {
    const renderer = window.__CINDERLINE__?.renderer;
    const rig = [...(renderer?.entityObjects?.entries() ?? [])]
      .find(([entityId]) => String(entityId) === id)?.[1];
    if (!rig) throw new Error(`Surface QA could not resolve renderer rig ${id}.`);
    renderer.focus(rig.root.position.x, rig.root.position.z);
    for (let index = 0; index < 8; index += 1) renderer?.zoom(-4);
    renderer?.render(0);
  }, targets.smelter);
  await page.waitForTimeout(220);
  await capture(
    "smelter-closeup",
    "SMELTER // FOUNDATION LOAD PATH",
    { x: 520, y: 270, width: 880, height: 540 },
  );

  await page.evaluate((id) => {
    const renderer = window.__CINDERLINE__?.renderer;
    const rig = [...(renderer?.entityObjects?.entries() ?? [])]
      .find(([entityId]) => String(entityId) === id)?.[1];
    if (!rig) throw new Error(`Surface QA could not resolve renderer rig ${id}.`);
    renderer.focus(rig.root.position.x, rig.root.position.z);
    renderer?.render(0);
  }, targets.hero);
  await page.waitForTimeout(220);
  await capture(
    "hero-closeup",
    "FABRICATOR // TERRAIN INTEGRATION",
    { x: 520, y: 270, width: 880, height: 540 },
  );

  const renderStats = await page.evaluate(() => {
    const renderer = window.__CINDERLINE__?.renderer;
    const foundation = renderer?.infrastructureRoot?.getObjectByName(
      "infrastructure-foundations",
    );
    return {
      calls: renderer?.renderer?.info?.render?.calls ?? null,
      triangles: renderer?.renderer?.info?.render?.triangles ?? null,
      infrastructureChildren: renderer?.infrastructureRoot?.children?.length ?? null,
      foundationInstances: foundation?.count ?? null,
      handoffDocks:
        renderer?.infrastructureRoot?.userData?.handoffDockCount ?? null,
      handoffDockInstances:
        renderer?.infrastructureRoot?.userData?.handoffDockInstances ?? null,
    };
  });
  const sorted = [...timing].sort((left, right) => left - right);
  const meanMs = timing.reduce((sum, value) => sum + value, 0) / timing.length;
  const p95Ms = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  if (failures.length > 0) {
    throw new Error(`Surface QA observed console failures:\n${failures.join("\n")}`);
  }

  const sheet = await context.newPage();
  await sheet.setViewportSize({ width: 1920, height: 1080 });
  await sheet.setContent(contactSheetMarkup(captures), { waitUntil: "load" });
  await sheet.screenshot({
    path: `${OUTPUT_DIRECTORY}/contact-sheet.png`,
    fullPage: true,
  });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    captures: captures.map(({ caption, path }) => ({ caption, path })),
    contactSheet: `${OUTPUT_DIRECTORY}/contact-sheet.png`,
    renderStats,
    timing: {
      meanMs: Number(meanMs.toFixed(3)),
      p95Ms: Number(p95Ms.toFixed(3)),
      samples: timing.length,
    },
    warnings: failures,
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
        display: grid;
        grid-template-columns: 1fr 1fr;
        grid-template-rows: 540px 540px;
        width: 1920px;
        height: 1080px;
        gap: 3px;
        padding: 3px;
      }
      figure { position: relative; margin: 0; overflow: hidden; background: #101719; }
      figure:first-child { grid-column: 1 / -1; }
      img { display: block; width: 100%; height: 100%; object-fit: cover; }
      figcaption {
        position: absolute; inset: 12px auto auto 12px; padding: 8px 11px;
        color: #bffff0; background: rgba(5, 15, 16, .9); border: 1px solid #58f1cf;
        font: 700 13px/1 ui-monospace, SFMono-Regular, monospace;
        letter-spacing: .1em;
      }
    </style>
    <main>
      ${captures.map(({ caption, dataURL }) => `
        <figure>
          <img src="${dataURL}" alt="${caption}">
          <figcaption>${caption}</figcaption>
        </figure>
      `).join("")}
    </main>`;
}
