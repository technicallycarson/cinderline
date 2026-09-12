import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseURL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const frameOffsets = [0, 450, 900, 1_350];
const outputPaths = frameOffsets.map(
  (_, index) => `.qa/motion-${String(index + 1).padStart(2, "0")}.png`,
);

await mkdir(".qa", { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  await page.goto(`${baseURL}/?fresh=motion-qa`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => document.querySelector("#boot")?.classList.contains("is-done"),
    null,
    { timeout: 10_000 },
  );
  await page.waitForFunction(
    () => (window.__CINDERLINE__?.stats().beltItemCount ?? 0) >= 180,
    null,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(1_000);

  const captures = [];
  let previousOffset = 0;
  for (let index = 0; index < frameOffsets.length; index += 1) {
    const offset = frameOffsets[index];
    await page.waitForTimeout(offset - previousOffset);
    previousOffset = offset;
    const state = await page.evaluate(() => {
      const snapshot = window.__CINDERLINE__?.snapshot();
      if (!snapshot) return null;
      const items = snapshot.entities.flatMap((entity) =>
        entity.beltItems.map((item) => ({
          id: item.id,
          belt: entity.id,
          progress: Number(item.progress.toFixed(4)),
        })),
      );
      return {
        tick: snapshot.tick,
        working: snapshot.entities.filter((entity) => entity.status === "working").length,
        items,
      };
    });
    if (!state) throw new Error("Motion QA could not read the simulation snapshot.");
    const buffer = await page.screenshot({ path: outputPaths[index] });
    captures.push({ state, dataURL: `data:image/png;base64,${buffer.toString("base64")}` });
  }

  const first = new Map(
    captures[0].state.items.map((item) => [
      item.id,
      `${item.belt}:${item.progress}`,
    ]),
  );
  const moved = captures.at(-1).state.items.filter(
    (item) => first.get(item.id) !== `${item.belt}:${item.progress}`,
  ).length;
  if (moved < 40) {
    throw new Error(`Expected at least 40 physical payloads to move; observed ${moved}.`);
  }
  const workingCounts = captures.map(({ state }) => state.working);
  const averageWorking =
    workingCounts.reduce((sum, count) => sum + count, 0) / workingCounts.length;
  if (Math.min(...workingCounts) < 20 || averageWorking < 25) {
    throw new Error(
      `The showcased line lost too many simultaneously working units (${workingCounts.join(", ")}).`,
    );
  }

  const sheet = await context.newPage();
  await sheet.setViewportSize({ width: 1920, height: 1080 });
  await sheet.setContent(
    contactSheetMarkup(
      captures.map(({ dataURL }) => dataURL),
      captures.map(
        ({ state }, index) =>
          `T+${(frameOffsets[index] / 1_000).toFixed(2)}s // TICK ${state.tick}`,
      ),
    ),
    { waitUntil: "load" },
  );
  await sheet.screenshot({ path: ".qa/motion-contact-sheet.png" });

  await page.bringToFront();
  await page.mouse.click(782, 480);
  await page.waitForTimeout(250);
  await page.mouse.move(782, 480);
  await page.mouse.wheel(0, -360);
  await page.waitForTimeout(450);
  const inspectorVisible = await page.locator(".inspector").evaluate((element) =>
    element.classList.contains("is-open"),
  );
  if (!inspectorVisible) {
    throw new Error("Motion QA could not open the machine inspector.");
  }
  const closeupFrames = [];
  const closeupOffsets = [0, 300, 600, 900];
  for (let index = 0; index < closeupOffsets.length; index += 1) {
    if (index > 0) {
      await page.waitForTimeout(closeupOffsets[index] - closeupOffsets[index - 1]);
    }
    const buffer = await page.screenshot({
      path:
        index === 0
          ? ".qa/review-closeup.png"
          : `.qa/close-motion-${String(index + 1).padStart(2, "0")}.png`,
    });
    closeupFrames.push(`data:image/png;base64,${buffer.toString("base64")}`);
  }
  await sheet.setContent(
    contactSheetMarkup(
      closeupFrames,
      closeupOffsets.map((offset) => `DETAIL // T+${(offset / 1_000).toFixed(2)}s`),
    ),
    { waitUntil: "load" },
  );
  await sheet.screenshot({ path: ".qa/close-motion-contact-sheet.png" });

  await page.keyboard.press("KeyF");
  await page.waitForTimeout(350);
  const coreTarget = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    const entity = game
      ?.snapshot()
      .entities.find(
        (candidate) =>
          candidate.kind === "fabricator" &&
          candidate.recipeId === "automationCore",
      );
    if (!game || !entity) {
      throw new Error("Motion QA could not locate the automation-core hero cell.");
    }
    const rig = game.renderer.entityObjects.get(entity.id);
    if (!rig) {
      throw new Error("Motion QA could not resolve the automation-core world rig.");
    }
    game.renderer.focus(
      entity.x + entity.width * 0.5,
      entity.y + entity.height * 0.5,
    );
    return {
      id: entity.id,
      world: {
        x: rig.root.position.x,
        y: rig.root.position.y,
        z: rig.root.position.z,
      },
    };
  });
  await page.waitForTimeout(350);
  const corePoint = await page.evaluate((target) => {
    const game = window.__CINDERLINE__;
    const canvas = document.querySelector("#world");
    if (!game || !(canvas instanceof HTMLCanvasElement)) {
      throw new Error("Motion QA could not project the automation-core hero cell.");
    }
    const projected = game.renderer.camera.position
      .clone()
      .set(target.world.x, target.world.y, target.world.z)
      .project(game.renderer.camera);
    const bounds = canvas.getBoundingClientRect();
    return {
      x: bounds.left + (projected.x + 1) * bounds.width * 0.5,
      y: bounds.top + (-projected.y + 1) * bounds.height * 0.5,
    };
  }, coreTarget);
  await page.mouse.click(corePoint.x, corePoint.y);
  await page.waitForTimeout(220);
  await page.mouse.move(corePoint.x, corePoint.y);
  await page.mouse.wheel(0, -320);
  await page.waitForTimeout(420);
  const coreInspector = await page.locator(".inspector").innerText();
  if (!coreInspector.toLowerCase().includes("automation core")) {
    throw new Error("Motion QA could not inspect the automation-core hero cell.");
  }
  await page.screenshot({ path: ".qa/core-hero-closeup.png" });

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        movedPayloads: moved,
        ticks: captures.map(({ state }) => state.tick),
        workingUnits: workingCounts,
        averageWorkingUnits: averageWorking,
        frames: outputPaths,
        contactSheet: ".qa/motion-contact-sheet.png",
        closeup: ".qa/review-closeup.png",
        closeupContactSheet: ".qa/close-motion-contact-sheet.png",
        coreHeroCloseup: ".qa/core-hero-closeup.png",
      },
      null,
      2,
    )}\n`,
  );

  await context.close();
} finally {
  await browser.close();
}

function contactSheetMarkup(images, captions) {
  return `<!doctype html>
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #071012; }
      main { display: grid; grid-template-columns: 1fr 1fr; width: 100%; height: 100%; gap: 2px; }
      figure { position: relative; margin: 0; overflow: hidden; background: #071012; }
      img { display: block; width: 100%; height: 100%; object-fit: cover; }
      figcaption {
        position: absolute; inset: 10px auto auto 10px; padding: 6px 9px;
        color: #bffff0; background: rgba(5, 15, 16, .86); border: 1px solid #58f1cf;
        font: 700 13px/1 ui-monospace, SFMono-Regular, monospace; letter-spacing: .14em;
      }
    </style>
    <main>
      ${images
        .map(
          (dataURL, index) =>
            `<figure><img src="${dataURL}"><figcaption>${captions[index]}</figcaption></figure>`,
        )
        .join("")}
    </main>`;
}
