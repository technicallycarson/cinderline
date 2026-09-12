import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY = ".qa/terrain-pan";
const FRAME_OFFSETS = [0, 300, 600, 900, 1_200];

await mkdir(OUTPUT_DIRECTORY, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      errors.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

  await page.goto(`${BASE_URL}/?fresh=terrain-pan-qa`, {
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
  await page.waitForTimeout(600);

  await page.keyboard.press("Space");
  await page.evaluate(() => {
    const hud = document.querySelector("#hud");
    if (hud instanceof HTMLElement) hud.style.display = "none";
  });
  await page.mouse.move(960, 540);
  await page.mouse.wheel(0, -1_600);
  await page.waitForTimeout(300);

  await page.keyboard.down("KeyW");
  await page.keyboard.down("KeyD");
  const frameTimes = await page.evaluate(async () => {
    const samples = [];
    let previous = performance.now();
    await new Promise((resolve) => {
      const step = (now) => {
        samples.push(now - previous);
        previous = now;
        if (samples.length >= 150) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    return samples;
  });
  await page.keyboard.up("KeyD");
  await page.keyboard.up("KeyW");
  await page.keyboard.press("KeyF");
  await page.waitForTimeout(120);

  await page.keyboard.down("KeyW");
  await page.keyboard.down("KeyD");
  const captures = [];
  let previousOffset = 0;
  for (let index = 0; index < FRAME_OFFSETS.length; index += 1) {
    const offset = FRAME_OFFSETS[index];
    await page.waitForTimeout(offset - previousOffset);
    previousOffset = offset;
    const path = `${OUTPUT_DIRECTORY}/frame-${String(index + 1).padStart(2, "0")}.png`;
    const buffer = await page.screenshot({ path });
    captures.push({
      path,
      dataURL: `data:image/png;base64,${buffer.toString("base64")}`,
    });
  }
  await page.keyboard.up("KeyD");
  await page.keyboard.up("KeyW");

  const sorted = [...frameTimes].sort((left, right) => left - right);
  const meanMs = frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length;
  const p95Ms = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  if (p95Ms > 30) {
    throw new Error(`Closest-zoom diagonal pan exceeded the 30 ms p95 budget (${p95Ms.toFixed(2)} ms).`);
  }
  if (errors.length > 0) {
    throw new Error(`Terrain-pan QA observed console failures:\n${errors.join("\n")}`);
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
    path: "slow diagonal pan at closest gameplay zoom",
    durationMs: FRAME_OFFSETS.at(-1),
    frames: captures.map(({ path }) => path),
    contactSheet: `${OUTPUT_DIRECTORY}/contact-sheet.png`,
    timing: {
      meanMs: Number(meanMs.toFixed(3)),
      p95Ms: Number(p95Ms.toFixed(3)),
      samples: frameTimes.length,
    },
    warnings: errors,
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
        width: 1920px; height: 1080px; gap: 3px; padding: 3px;
      }
      figure { position: relative; margin: 0; overflow: hidden; background: #101719; }
      img { display: block; width: 100%; height: 100%; object-fit: cover; }
      figcaption {
        position: absolute; inset: 10px auto auto 10px; padding: 7px 10px;
        color: #bffff0; background: rgba(5, 15, 16, .88); border: 1px solid #58f1cf;
        font: 700 13px/1 ui-monospace, SFMono-Regular, monospace; letter-spacing: .12em;
      }
    </style>
    <main>
      ${captures.map(({ dataURL }, index) => `
        <figure>
          <img src="${dataURL}" alt="Terrain pan frame ${index + 1}">
          <figcaption>T+${(FRAME_OFFSETS[index] / 1_000).toFixed(2)}s</figcaption>
        </figure>
      `).join("")}
    </main>`;
}
