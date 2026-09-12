import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY = ".qa/blueprint-ui";

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
  await page.goto(`${BASE_URL}/?fresh=blueprint-ui-qa`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#boot")?.classList.contains("is-done") &&
      Boolean(window.__CINDERLINE__?.stats().entityCount),
    null,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(1_500);

  const captureCorners = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game) return null;
    const locate = (targetX, targetZ) => {
      for (let clientY = 150; clientY <= 650; clientY += 4) {
        for (let clientX = 310; clientX <= 1600; clientX += 4) {
          if (document.elementFromPoint(clientX, clientY)?.id !== "world") {
            continue;
          }
          const cell = game.renderer.screenToGrid(clientX, clientY);
          if (cell?.x === targetX && cell.z === targetZ) {
            return { clientX, clientY };
          }
        }
      }
      return null;
    };
    return {
      first: locate(7, 4),
      second: locate(13, 6),
    };
  });
  assert(captureCorners?.first && captureCorners.second, "Capture cells missing.");

  await page.keyboard.press("b");
  await page.mouse.move(
    captureCorners.first.clientX,
    captureCorners.first.clientY,
  );
  await page.mouse.down();
  await page.mouse.move(
    captureCorners.second.clientX,
    captureCorners.second.clientY,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      window.__CINDERLINE__?.blueprint.mode === "paste" &&
      (window.__CINDERLINE__?.blueprint.clipboard?.entities.length ?? 0) >= 6,
    null,
    { timeout: 5_000 },
  );

  const destination = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game) return null;
    const seen = new Set();
    for (let clientY = 300; clientY <= 900; clientY += 10) {
      for (let clientX = 320; clientX <= 1600; clientX += 10) {
        if (document.elementFromPoint(clientX, clientY)?.id !== "world") {
          continue;
        }
        const cell = game.renderer.screenToGrid(clientX, clientY);
        if (!cell) continue;
        const key = `${cell.x},${cell.z}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const preview = game.previewBlueprint(cell.x, cell.z);
        if (preview.ok) return { clientX, clientY };
      }
    }
    return null;
  });
  assert(destination, "Valid blueprint destination missing.");
  await page.mouse.move(destination.clientX, destination.clientY);
  await page.waitForTimeout(120);

  const viewports = [
    { width: 1920, height: 1080, name: "desktop-1920" },
    { width: 1366, height: 768, name: "desktop-1366" },
    { width: 390, height: 844, name: "mobile-390" },
  ];
  const results = [];

  for (const viewport of viewports) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.waitForTimeout(180);
    const layout = await page.locator("[data-ref='blueprint-panel']").evaluate(
      (panel, size) => {
        const bounds = panel.getBoundingClientRect();
        const buttons = [...panel.querySelectorAll("button")].map((button) => {
          const buttonBounds = button.getBoundingClientRect();
          return {
            width: buttonBounds.width,
            height: buttonBounds.height,
          };
        });
        const legend = [...panel.querySelectorAll(".blueprint-legend > span")].map(
          (entry) => ({
            state: entry.dataset.state,
            count: entry.querySelector("b")?.textContent,
            color: getComputedStyle(entry.querySelector("b")).color,
          }),
        );
        return {
          bounds: {
            left: bounds.left,
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom,
            width: bounds.width,
            height: bounds.height,
          },
          hidden: panel.hidden,
          scrollWidth: panel.scrollWidth,
          clientWidth: panel.clientWidth,
          units: panel.querySelector("[data-ref='blueprint-units']")?.textContent,
          dimensions: panel.querySelector(
            "[data-ref='blueprint-dimensions']",
          )?.textContent,
          cost: panel.querySelector("[data-ref='blueprint-cost']")?.textContent,
          status: panel.querySelector("[data-ref='blueprint-status']")?.textContent,
          legend,
          buttons,
          viewport: size,
        };
      },
      { width: viewport.width, height: viewport.height },
    );
    assert(!layout.hidden, `${viewport.name}: panel hidden.`);
    assert(
      layout.bounds.left >= 0 &&
        layout.bounds.right <= viewport.width &&
        layout.bounds.top >= 0 &&
        layout.bounds.bottom <= viewport.height,
      `${viewport.name}: panel clips viewport (${JSON.stringify(layout.bounds)}).`,
    );
    assert(
      layout.scrollWidth <= layout.clientWidth,
      `${viewport.name}: panel overflows horizontally.`,
    );
    assert(
      layout.buttons.every((button) => button.height >= 44),
      `${viewport.name}: blueprint action target below 44px.`,
    );
    assert(Number(layout.units) >= 6, `${viewport.name}: multi-unit count missing.`);
    assert(
      layout.legend.map((entry) => entry.state).join(",") ===
        "construct,configure,match,blocked",
      `${viewport.name}: semantic blueprint legend is incomplete.`,
    );
    assert(
      Number(layout.legend.find((entry) => entry.state === "construct")?.count) >= 6,
      `${viewport.name}: construction-state count missing.`,
    );
    assert(
      new Set(layout.legend.map((entry) => entry.color)).size === 4,
      `${viewport.name}: blueprint states are not visually distinct.`,
    );
    await page.screenshot({
      path: `${OUTPUT_DIRECTORY}/${viewport.name}.png`,
    });
    results.push({ name: viewport.name, ...layout });
  }

  assert(errors.length === 0, errors.join("\n"));
  console.log(JSON.stringify({ ok: true, results, errors }, null, 2));
} finally {
  await browser.close();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
