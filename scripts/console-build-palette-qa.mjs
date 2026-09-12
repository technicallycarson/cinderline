import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "playwright";

const baseUrl = (process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173")
  .replace(/\/$/, "");
const outputDirectory = resolve(
  process.env.CINDERLINE_CONSOLE_PALETTE_OUTPUT
    ?? ".qa/console-build-palette",
);
const qaScope = process.env.CINDERLINE_CONSOLE_PALETTE_SCOPE ?? "all";
if (!["all", "desktop", "mobile"].includes(qaScope)) {
  throw new Error(`Unknown console palette QA scope: ${qaScope}`);
}
const captureScreenshots = process.env.CINDERLINE_CONSOLE_PALETTE_SCREENSHOTS
  !== "0";
const mobileWidths = (process.env.CINDERLINE_CONSOLE_PALETTE_MOBILE_WIDTHS
  ?? "390,320")
  .split(",")
  .map((value) => Number.parseInt(value, 10));
const viewports = [
  { name: "desktop-1366x768", width: 1366, height: 768 },
  { name: "desktop-1920x1080", width: 1920, height: 1080 },
];

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  outputDirectory,
  status: "passed",
  failures: [],
  viewports: [],
};

try {
  if (qaScope !== "mobile") for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      colorScheme: "dark",
    });
    const page = await context.newPage();
    const entry = {
      viewport,
      inserter: null,
      extractorSelection: null,
      extractor: null,
      tooltips: null,
      artifacts: [],
      failures: [],
    };
    report.viewports.push(entry);
    page.on("pageerror", (error) => fail(entry, `Page error: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") fail(entry, `Console error: ${message.text()}`);
    });

    try {
      await page.goto(
        `${baseUrl}/?fresh=console-palette-${viewport.name}`,
        { waitUntil: "networkidle", timeout: 30_000 },
      );
      await page.waitForFunction(
        () => document.querySelector("#app")?.classList.contains("is-hud-ready")
          && window.__CINDERLINE__,
        null,
        { timeout: 10_000 },
      );
      await page.waitForFunction(() =>
        Number.parseFloat(getComputedStyle(document.querySelector("#hud")).opacity) >= 0.99,
      );
      await page.evaluate(() => window.__CINDERLINE__?.dismissToasts());

      await place(page, "inserter", 14, 5);
      await waitForSettledConsole(page);
      entry.inserter = await measure(page, "extractor");
      checkConsoleLayout(entry, entry.inserter, { expectHorizontalScroll: viewport.width === 1366 });
      await screenshot(page, entry, `${viewport.name}-01-inserter-console-palette.png`);

      const extractor = page.locator("[data-build='extractor']");
      await extractor.click({ timeout: 5_000 });
      entry.extractorSelection = await extractor.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        );
        return {
          ariaPressed: element.getAttribute("aria-pressed"),
          bounds: rect(bounds),
          hitAtCenter: Boolean(hit && element.contains(hit)),
        };

        function rect(value) {
          return {
            left: value.left,
            top: value.top,
            right: value.right,
            bottom: value.bottom,
            width: value.width,
            height: value.height,
          };
        }
      });
      check(
        entry,
        entry.extractorSelection.ariaPressed === "true"
          && entry.extractorSelection.hitAtCenter,
        `Extractor card was not actionable after inserter placement: ${JSON.stringify(entry.extractorSelection)}.`,
      );

      await placeArmed(page, "extractor", 5, 12);
      await waitForSettledConsole(page);
      entry.extractor = await measure(page, "inserter");
      checkConsoleLayout(entry, entry.extractor, { expectHorizontalScroll: viewport.width === 1366 });
      await screenshot(page, entry, `${viewport.name}-02-extractor-console-palette.png`);

      const smelterId = await page.evaluate(() =>
        window.__CINDERLINE__?.snapshot().entities.find(
          (entity) => entity.kind === "smelter",
        )?.id ?? null,
      );
      checkGlobal(Number.isSafeInteger(smelterId), "Fresh campaign has no smelter.");
      await page.evaluate((entityId) => {
        window.__CINDERLINE__?.selectEntity(entityId);
      }, smelterId);
      await waitForSettledConsole(page);
      entry.tooltips = await auditConsoleTooltips(page, entry, viewport.name);
    } finally {
      await context.close();
    }
  }
  if (qaScope !== "desktop") {
    for (const width of mobileWidths) {
      await runMobileSwipeProof(browser, width);
    }
  }
} finally {
  await browser.close();
}

report.status = report.failures.length === 0 ? "passed" : "failed";
const reportPath = resolve(outputDirectory, "console-build-palette-report.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  status: report.status,
  report: reportPath,
  failures: report.failures,
  viewports: report.viewports.map((entry) => ({
    viewport: entry.viewport.name,
    failures: entry.failures,
    inserter: entry.inserter,
    extractorSelection: entry.extractorSelection,
    extractor: entry.extractor,
    tooltips: entry.tooltips,
    swipeSequence: entry.swipeSequence,
    artifacts: entry.artifacts,
  })),
}, null, 2));
if (report.status !== "passed") process.exitCode = 1;

async function place(page, kind, x, z) {
  const card = page.locator(`[data-build='${kind}']`);
  if (await card.getAttribute("aria-pressed") !== "true") await card.click();
  await placeArmed(page, kind, x, z);
}

async function placeArmed(page, kind, x, z) {
  const card = page.locator(`[data-build='${kind}']`);
  checkGlobal(
    await card.getAttribute("aria-pressed") === "true",
    `${kind} build tool did not arm.`,
  );
  const point = await locateCell(page, x, z);
  checkGlobal(Boolean(point), `Could not expose ${kind} placement cell ${x},${z}.`);
  await page.mouse.click(point.clientX, point.clientY);
  await page.waitForFunction(
    ({ targetX, targetZ, targetKind }) =>
      window.__CINDERLINE__?.simulation.getEntityAt(targetX, targetZ)?.kind
        === targetKind,
    { targetX: x, targetZ: z, targetKind: kind },
    { timeout: 5_000 },
  );
  await page.waitForFunction(() =>
    document.querySelector(".inspector.is-open")
      && document.querySelector(".inspector.is-open")?.getAttribute("aria-hidden") === "false",
  );
}

async function locateCell(page, x, z) {
  await page.evaluate(({ targetX, targetZ }) => {
    window.__CINDERLINE__?.renderer.focus(targetX + 0.5, targetZ + 0.5);
  }, { targetX: x, targetZ: z });
  await page.waitForTimeout(60);
  return page.evaluate(({ targetX, targetZ }) => {
    const game = window.__CINDERLINE__;
    if (!game) return null;
    const centerX = Math.floor(innerWidth / 2);
    const centerY = Math.floor(innerHeight / 2);
    for (let radius = 0; radius <= Math.max(innerWidth, innerHeight); radius += 4) {
      const left = Math.max(2, centerX - radius);
      const right = Math.min(innerWidth - 2, centerX + radius);
      const top = Math.max(2, centerY - radius);
      const bottom = Math.min(innerHeight - 2, centerY + radius);
      for (let clientX = left; clientX <= right; clientX += 4) {
        for (const clientY of [top, bottom]) {
          if (document.elementFromPoint(clientX, clientY)?.id !== "world") continue;
          const cell = game.renderer.screenToGrid(clientX, clientY);
          if (cell?.x === targetX && cell.z === targetZ) return { clientX, clientY };
        }
      }
      for (let clientY = top + 4; clientY < bottom; clientY += 4) {
        for (const clientX of [left, right]) {
          if (document.elementFromPoint(clientX, clientY)?.id !== "world") continue;
          const cell = game.renderer.screenToGrid(clientX, clientY);
          if (cell?.x === targetX && cell.z === targetZ) return { clientX, clientY };
        }
      }
    }
    return null;
  }, { targetX: x, targetZ: z });
}

async function waitForSettledConsole(page) {
  await page.waitForFunction(() => {
    const inspector = document.querySelector(".inspector.is-open");
    if (!inspector) return false;
    const bounds = inspector.getBoundingClientRect();
    return bounds.right <= innerWidth + 1
      && Number.parseFloat(getComputedStyle(inspector).opacity) >= 0.99;
  }, null, { timeout: 5_000 });
  await page.waitForTimeout(80);
}

async function auditConsoleTooltips(page, entry, viewportName) {
  const proofs = [];
  for (const kind of ["belt", "fabricator", "gridRelay"]) {
    const card = page.locator(`[data-build='${kind}']`);
    await card.scrollIntoViewIfNeeded();
    await card.focus();
    await page.waitForFunction(() => {
      const tooltip = document.querySelector(".tooltip.is-visible");
      return tooltip
        && Number.parseFloat(getComputedStyle(tooltip).opacity) >= 0.99;
    });
    const proof = await page.evaluate((targetKind) => {
      const cardElement = document.querySelector(`[data-build='${targetKind}']`);
      const dock = document.querySelector("#build-dock");
      const tooltip = document.querySelector(".tooltip.is-visible");
      const inspector = document.querySelector(
        ".inspector.is-open:is(.has-process-console, .has-circuit-console)",
      );
      const cardBounds = cardElement?.getBoundingClientRect();
      const dockBounds = dock?.getBoundingClientRect();
      const tooltipBounds = tooltip?.getBoundingClientRect();
      const inspectorBounds = inspector?.getBoundingClientRect();
      const overlapWidth = tooltipBounds && inspectorBounds
        ? Math.max(0, Math.min(tooltipBounds.right, inspectorBounds.right)
          - Math.max(tooltipBounds.left, inspectorBounds.left))
        : 0;
      const overlapHeight = tooltipBounds && inspectorBounds
        ? Math.max(0, Math.min(tooltipBounds.bottom, inspectorBounds.bottom)
          - Math.max(tooltipBounds.top, inspectorBounds.top))
        : 0;
      return {
        kind: targetKind,
        card: rect(cardBounds),
        dock: rect(dockBounds),
        tooltip: rect(tooltipBounds),
        inspector: rect(inspectorBounds),
        tooltipText: tooltip?.textContent?.replace(/\s+/g, " ").trim() ?? null,
        tooltipOverlap: overlapWidth * overlapHeight,
        inspectorClearance: tooltipBounds && inspectorBounds
          ? inspectorBounds.left - tooltipBounds.right
          : null,
        cardFullyInDock: Boolean(
          cardBounds
            && dockBounds
            && cardBounds.left >= dockBounds.left - 0.5
            && cardBounds.right <= dockBounds.right + 0.5,
        ),
      };

      function rect(bounds) {
        return bounds
          ? {
              left: bounds.left,
              top: bounds.top,
              right: bounds.right,
              bottom: bounds.bottom,
              width: bounds.width,
              height: bounds.height,
            }
          : null;
      }
    }, kind);
    check(
      entry,
      proof.cardFullyInDock
        && proof.tooltipOverlap <= 1
        && proof.inspectorClearance >= 9.5
        && proof.tooltip?.left >= 9.5,
      `Console tooltip is outside its safe lane: ${JSON.stringify(proof)}.`,
    );
    proofs.push(proof);
    await screenshot(
      page,
      entry,
      `${viewportName}-03-tooltip-${kind}.png`,
    );
  }
  return proofs;
}

async function runMobileSwipeProof(browserInstance, width) {
  const viewport = width === 320
    ? { name: "mobile-320x568", width: 320, height: 568 }
    : { name: "mobile-390x844", width: 390, height: 844 };
  const entry = {
    viewport,
    swipeSequence: null,
    artifacts: [],
    failures: [],
  };
  report.viewports.push(entry);
  const context = await browserInstance.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    screen: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => fail(entry, `Page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") fail(entry, `Console error: ${message.text()}`);
  });
  try {
    await page.goto(
      `${baseUrl}/?fresh=console-palette-mobile-390`,
      { waitUntil: "networkidle", timeout: 30_000 },
    );
    await page.waitForFunction(
      () => document.querySelector("#app")?.classList.contains("is-hud-ready")
        && window.__CINDERLINE__,
      null,
      { timeout: 30_000 },
    );
    await page.evaluate(() => window.__CINDERLINE__?.dismissToasts());
    const dock = page.locator("#build-dock");
    await dock.evaluate((element) => { element.scrollLeft = 0; });
    const dockBounds = await dock.boundingBox();
    checkGlobal(Boolean(dockBounds), "Mobile build dock has no geometry.");
    const gestures = [];
    const results = [];
    for (let index = 0; index < 2; index += 1) {
      gestures.push(await dispatchNativeDockSwipe(page, context, dockBounds, false));
      await page.waitForTimeout(120);
    }
    for (const kind of ["gridRelay", "extractor", "inserter", "smelter"]) {
      const card = page.locator(`[data-build='${kind}']`);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const geometry = await mobileCardGeometry(card, dock);
        if (geometry.fullyInDock) break;
        gestures.push(await dispatchNativeDockSwipe(
          page,
          context,
          dockBounds,
          geometry.left < geometry.dockLeft,
        ));
        await page.waitForTimeout(120);
      }
      const geometry = await mobileCardGeometry(card, dock);
      check(
        entry,
        geometry.fullyInDock && geometry.hitAtCenter,
        `${kind} is not trusted-tap reachable after native swipes: ${JSON.stringify(geometry)}.`,
      );
      if (!geometry.fullyInDock || !geometry.hitAtCenter) continue;
      await card.tap();
      const selected = await card.getAttribute("aria-pressed");
      check(entry, selected === "true", `${kind} trusted tap did not arm the tool.`);
      results.push({ kind, selected, geometry });
      await page.locator("[data-action='mobile-cancel']").tap();
      await screenshot(page, entry, `${viewport.name}-${kind}-reachable.png`);
    }
    const snapStyles = await page.evaluate(() => {
      const dockElement = document.querySelector("#build-dock");
      const card = document.querySelector(".build-card:not([hidden])");
      return {
        scrollSnapType: getComputedStyle(dockElement).scrollSnapType,
        overscrollBehaviorX: getComputedStyle(dockElement).overscrollBehaviorX,
        touchAction: getComputedStyle(dockElement).touchAction,
        cardSnapAlign: getComputedStyle(card).scrollSnapAlign,
        cardSnapStop: getComputedStyle(card).scrollSnapStop,
        cardWidth: card?.getBoundingClientRect().width ?? null,
      };
    });
    check(
      entry,
      snapStyles.scrollSnapType === "x mandatory"
        && snapStyles.cardSnapStop === "always"
        && snapStyles.cardWidth === 108,
      `Mobile snap contract is incomplete: ${JSON.stringify(snapStyles)}.`,
    );
    entry.swipeSequence = { gestures, results, snapStyles };
  } finally {
    await context.close();
  }
}

async function mobileCardGeometry(card, dock) {
  const cardBounds = await card.boundingBox();
  const dockBounds = await dock.boundingBox();
  checkGlobal(Boolean(cardBounds && dockBounds), "Mobile card or dock has no geometry.");
  const hitAtCenter = await card.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
    );
    return Boolean(hit && element.contains(hit));
  });
  return {
    left: cardBounds.x,
    top: cardBounds.y,
    right: cardBounds.x + cardBounds.width,
    bottom: cardBounds.y + cardBounds.height,
    width: cardBounds.width,
    height: cardBounds.height,
    dockLeft: dockBounds.x,
    dockRight: dockBounds.x + dockBounds.width,
    scrollLeft: await dock.evaluate((element) => element.scrollLeft),
    fullyInDock: cardBounds.x >= dockBounds.x - 0.5
      && cardBounds.x + cardBounds.width <= dockBounds.x + dockBounds.width + 0.5,
    hitAtCenter,
  };
}

async function dispatchNativeDockSwipe(page, context, dockBounds, towardEarlier) {
  const startX = Math.round(
    dockBounds.x + (towardEarlier ? 18 : dockBounds.width - 18),
  );
  const endX = Math.round(
    dockBounds.x + (towardEarlier ? dockBounds.width - 18 : 18),
  );
  const y = Math.round(dockBounds.y + dockBounds.height / 2);
  const before = await page.locator("#build-dock").evaluate((element) => element.scrollLeft);
  const session = await context.newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y, id: 1 }],
    });
    for (let step = 1; step <= 6; step += 1) {
      const ratio = step / 6;
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{
          x: Math.round(startX + (endX - startX) * ratio),
          y,
          id: 1,
        }],
      });
    }
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
  await page.waitForTimeout(80);
  const after = await page.locator("#build-dock").evaluate((element) => element.scrollLeft);
  return { startX, endX, y, before, after, towardEarlier };
}

async function measure(page, nextCardKind) {
  return page.evaluate((kind) => {
    const inspector = document.querySelector(".inspector.is-open");
    const palette = document.querySelector(".build-palette");
    const dock = document.querySelector("#build-dock");
    const minimap = document.querySelector(".minimap-shell");
    const mission = document.querySelector(".mission-panel");
    const nextCard = document.querySelector(`[data-build='${kind}']`);
    const inspectorRect = geometry(inspector);
    const paletteRect = geometry(palette);
    const dockRect = geometry(dock);
    const minimapRect = visible(minimap) ? geometry(minimap) : null;
    const missionRect = visible(mission) ? geometry(mission) : null;
    const nextRect = geometry(nextCard);
    const hit = nextRect
      ? document.elementFromPoint(
          nextRect.left + nextRect.width / 2,
          nextRect.top + nextRect.height / 2,
        )
      : null;
    const visibleCards = [...document.querySelectorAll(".build-card")]
      .filter(visible);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      inspectorClasses: inspector?.className ?? null,
      inspector: inspectorRect,
      palette: paletteRect,
      dock: dockRect,
      dockClientWidth: dock?.clientWidth ?? null,
      dockScrollWidth: dock?.scrollWidth ?? null,
      dockOverflowX: dock ? getComputedStyle(dock).overflowX : null,
      dockJustifyContent: dock ? getComputedStyle(dock).justifyContent : null,
      minimap: minimapRect,
      minimapDisplay: minimap ? getComputedStyle(minimap).display : null,
      mission: missionRect,
      helpDisplay: getComputedStyle(document.querySelector(".context-help")).display,
      coordinateDisplay: getComputedStyle(document.querySelector(".coordinate-readout")).display,
      inspectorPaletteOverlap: overlap(inspectorRect, paletteRect),
      inspectorMinimapOverlap: overlap(inspectorRect, minimapRect),
      missionPaletteOverlap: overlap(missionRect, paletteRect),
      minimapPaletteOverlap: overlap(minimapRect, paletteRect),
      nextCard: nextRect,
      nextCardHitAtCenter: Boolean(hit && nextCard?.contains(hit)),
      cards: visibleCards.map((card) => {
        const style = getComputedStyle(card);
        return {
          kind: card.getAttribute("data-build"),
          width: card.getBoundingClientRect().width,
          flexShrink: style.flexShrink,
        };
      }),
      pageOverflow: {
        horizontal: document.documentElement.scrollWidth > innerWidth + 1,
        vertical: document.documentElement.scrollHeight > innerHeight + 1,
      },
    };

    function visible(element) {
      if (!element) return false;
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number.parseFloat(style.opacity) > 0.001
        && bounds.width > 0
        && bounds.height > 0;
    }

    function geometry(element) {
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      };
    }

    function overlap(left, right) {
      if (!left || !right) return 0;
      return Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
        * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
    }
  }, nextCardKind);
}

function checkConsoleLayout(entry, proof, { expectHorizontalScroll }) {
  check(entry, proof.inspectorPaletteOverlap <= 1, `Inspector/palette overlap: ${JSON.stringify(proof)}.`);
  check(entry, proof.inspectorMinimapOverlap <= 1, `Inspector/minimap overlap: ${JSON.stringify(proof)}.`);
  check(entry, proof.missionPaletteOverlap <= 1, `Mission/palette overlap: ${JSON.stringify(proof)}.`);
  check(entry, proof.minimapPaletteOverlap <= 1, `Minimap/palette overlap: ${JSON.stringify(proof)}.`);
  check(entry, proof.helpDisplay === "none" && proof.coordinateDisplay === "none", "Help/coordinate underlay remains visible.");
  check(entry, proof.palette?.left === 22 && Math.abs(proof.palette.right - (proof.viewport.width - 552)) <= 1, `Palette is outside its console lane: ${JSON.stringify(proof.palette)}.`);
  check(entry, proof.nextCardHitAtCenter, `Next build card is not hit-test reachable: ${JSON.stringify(proof.nextCard)}.`);
  check(entry, proof.cards.every((card) => Math.abs(card.width - 108) <= 0.1 && card.flexShrink === "0"), `Console cards shrink: ${JSON.stringify(proof.cards)}.`);
  check(entry, proof.dockOverflowX === "auto", `Dock overflow-x is ${proof.dockOverflowX}.`);
  check(
    entry,
    expectHorizontalScroll
      ? proof.dockScrollWidth > proof.dockClientWidth
      : proof.dockScrollWidth === proof.dockClientWidth,
    `Dock scroll behavior does not match viewport: ${proof.dockClientWidth}/${proof.dockScrollWidth}.`,
  );
  check(entry, !proof.pageOverflow.horizontal && !proof.pageOverflow.vertical, `Page overflow: ${JSON.stringify(proof.pageOverflow)}.`);
}

async function screenshot(page, entry, name) {
  if (!captureScreenshots) return;
  await page.screenshot({
    path: resolve(outputDirectory, name),
    fullPage: false,
    animations: "disabled",
  });
  entry.artifacts.push(name);
}

function check(entry, condition, message) {
  if (condition) return;
  fail(entry, message);
}

function fail(entry, message) {
  entry.failures.push(message);
  report.failures.push(`${entry.viewport.name}: ${message}`);
}

function checkGlobal(condition, message) {
  if (!condition) throw new Error(message);
}
