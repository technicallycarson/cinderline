import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "playwright";

const baseUrl = (process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173")
  .replace(/\/$/, "");
const outputDirectory = resolve(
  process.env.CINDERLINE_STARTUP_QA_OUTPUT
    ?? ".qa/readability-audio/startup-readability",
);

const viewports = [
  { name: "mobile-390x844", width: 390, height: 844, mobile: true },
  { name: "mobile-320x568", width: 320, height: 568, mobile: true },
  { name: "desktop-1366x768", width: 1366, height: 768, mobile: false },
  { name: "desktop-1920x1080", width: 1920, height: 1080, mobile: false },
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
  for (const viewport of viewports) {
    const entry = {
      viewport,
      normalMotion: {},
      reducedMotion: {},
      inspector: null,
      expandedWithToast: null,
      artifacts: [],
      failures: [],
    };
    report.viewports.push(entry);

    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      colorScheme: "dark",
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
    });
    const page = await context.newPage();
    watchPage(page, entry);
    if (viewport.mobile) await installSlowStartupCapture(page);

    await page.goto(
      `${baseUrl}/?fresh=startup-readability-${viewport.name}`,
      { waitUntil: "domcontentloaded", timeout: 30_000 },
    );
    await page.locator("#boot").waitFor({ state: "visible", timeout: 5_000 });
    entry.normalMotion.boot = await measureLayers(page);
    await capture(page, entry, `${viewport.name}-01-boot.png`);
    check(
      entry,
      entry.normalMotion.boot.bootVisible
        && !entry.normalMotion.boot.hudVisible,
      "Initial boot frame exposes the HUD.",
    );

    await page.waitForFunction(
      () => document.querySelector("#boot")?.classList.contains("is-done"),
      null,
      { timeout: 10_000 },
    );
    await page.waitForTimeout(250);
    entry.normalMotion.transition = await measureLayers(page);
    await capture(page, entry, `${viewport.name}-02-boot-exit.png`);
    check(
      entry,
      !entry.normalMotion.transition.simultaneousVisibility
        && (viewport.mobile
          ? entry.normalMotion.transition.bootVisible
            && entry.normalMotion.transition.bootOpacity > 0
            && entry.normalMotion.transition.bootOpacity < 1
            && !entry.normalMotion.transition.hudVisible
          : entry.normalMotion.transition.bootVisible
            !== entry.normalMotion.transition.hudVisible),
      "Boot exit frame does not exclusively own the viewport.",
    );

    await page.waitForFunction(
      () => document.querySelector("#app")?.classList.contains("is-hud-ready"),
      null,
      { timeout: 3_000 },
    );
    await page.waitForFunction(() => {
      const hud = document.querySelector("#hud");
      return hud && Number.parseFloat(getComputedStyle(hud).opacity) >= 0.99;
    });
    await page.evaluate(() => document.fonts.ready);
    entry.normalMotion.stable = await measureLayers(page);
    await capture(page, entry, `${viewport.name}-03-stable-initial.png`);
    check(
      entry,
      !entry.normalMotion.stable.bootVisible
        && entry.normalMotion.stable.bootDisplay === "none"
        && entry.normalMotion.stable.hudVisible,
      "Stable initial frame does not contain a fully handed-off HUD.",
    );

    if (viewport.width === 320) {
      const mission = page.locator(".mission-panel");
      if (await mission.evaluate((element) => element.classList.contains("is-collapsed"))) {
        await page.locator("[data-action='mission-expand']").click();
      }
      await page.waitForTimeout(100);
      entry.expandedWithToast = await page.evaluate(() => {
        const panel = document.querySelector(".mission-panel");
        const palette = document.querySelector(".build-palette");
        const stack = document.querySelector(".toast-stack");
        const toasts = [...document.querySelectorAll(".toast")];
        const panelStyle = panel ? getComputedStyle(panel) : null;
        const paletteStyle = palette ? getComputedStyle(palette) : null;
        const stackStyle = stack ? getComputedStyle(stack) : null;
        const bounds = panel?.getBoundingClientRect();
        return {
          toastCount: toasts.length,
          toastStackVisibility: stackStyle?.visibility ?? null,
          missionOpacity: panelStyle
            ? Number.parseFloat(panelStyle.opacity)
            : null,
          missionVisibility: panelStyle?.visibility ?? null,
          missionDisplay: panelStyle?.display ?? null,
          missionBounds: bounds
            ? {
                left: bounds.left,
                top: bounds.top,
                right: bounds.right,
                bottom: bounds.bottom,
                width: bounds.width,
                height: bounds.height,
              }
            : null,
          buildPaletteDisplay: paletteStyle?.display ?? null,
          actionableLabels: panel
            ? [...panel.querySelectorAll("button")]
                .filter((element) => {
                  const style = getComputedStyle(element);
                  return style.display !== "none"
                    && style.visibility !== "hidden"
                    && element.getBoundingClientRect().width > 0;
                })
                .map((element) => element.textContent?.replace(/\s+/g, " ").trim())
            : [],
        };
      });
      await capture(page, entry, `${viewport.name}-04-expanded-live-toast.png`);
      check(
        entry,
        entry.expandedWithToast.toastCount > 0
          && entry.expandedWithToast.toastStackVisibility === "hidden"
          && entry.expandedWithToast.missionOpacity >= 0.99
          && entry.expandedWithToast.missionVisibility === "visible"
          && entry.expandedWithToast.missionBounds?.height > 100
          && entry.expandedWithToast.buildPaletteDisplay === "none",
        "Expanded short-phone brief becomes blank while a live toast exists.",
      );
    }

    if (!viewport.mobile) {
      await page.evaluate(() => window.__CINDERLINE__?.dismissToasts());
      const smelterId = await page.evaluate(() =>
        window.__CINDERLINE__?.snapshot().entities.find(
          (entity) => entity.kind === "smelter",
        )?.id ?? null,
      );
      check(entry, Number.isSafeInteger(smelterId), "No smelter QA target exists.");
      if (Number.isSafeInteger(smelterId)) {
        await page.evaluate((id) => window.__CINDERLINE__?.selectEntity(id), smelterId);
        await page.locator(".inspector.has-process-console.is-open").waitFor({
          state: "visible",
          timeout: 3_000,
        });
        await page.waitForFunction(() => {
          const inspector = document.querySelector(
            ".inspector.has-process-console.is-open",
          );
          return inspector && inspector.getBoundingClientRect().right <= innerWidth + 1;
        }, null, { timeout: 3_000 });
        await page.waitForTimeout(50);
        entry.inspector = await measureInspector(page);
        await capture(page, entry, `${viewport.name}-04-process-inspector.png`);
        check(
          entry,
          entry.inspector.hiddenUnderlay
            && entry.inspector.minimapOverlapArea <= 1
            && entry.inspector.minimapGap >= 9
            && entry.inspector.inspectorWithinViewport,
          "Desktop process inspector is occluded by underlying HUD furniture.",
        );
      }
    }

    await context.close();

    const reducedContext = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      colorScheme: "dark",
      reducedMotion: "reduce",
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
    });
    const reducedPage = await reducedContext.newPage();
    watchPage(reducedPage, entry);
    await reducedPage.goto(
      `${baseUrl}/?fresh=startup-readability-reduced-${viewport.name}`,
      { waitUntil: "domcontentloaded", timeout: 30_000 },
    );
    await reducedPage.locator("#boot").waitFor({ state: "visible", timeout: 5_000 });
    entry.reducedMotion.boot = await measureLayers(reducedPage);
    await capture(reducedPage, entry, `${viewport.name}-05-reduced-boot.png`);
    await reducedPage.waitForFunction(
      () => document.querySelector("#app")?.classList.contains("is-hud-ready"),
      null,
      { timeout: 10_000 },
    );
    entry.reducedMotion.stable = await measureLayers(reducedPage);
    entry.reducedMotion.motionStyles = await reducedPage.evaluate(() => ({
      bootTransition: getComputedStyle(document.querySelector("#boot")).transitionDuration,
      hudTransition: getComputedStyle(document.querySelector("#hud")).transitionDuration,
      markAnimation: getComputedStyle(document.querySelector(".boot-mark span")).animationName,
      trackAnimation: getComputedStyle(document.querySelector(".boot-track i")).animationName,
    }));
    await capture(reducedPage, entry, `${viewport.name}-06-reduced-stable.png`);
    check(
      entry,
      !entry.reducedMotion.stable.bootVisible
        && entry.reducedMotion.stable.hudVisible
        && entry.reducedMotion.motionStyles.bootTransition === "0s"
        && entry.reducedMotion.motionStyles.hudTransition === "0s"
        && entry.reducedMotion.motionStyles.markAnimation === "none"
        && entry.reducedMotion.motionStyles.trackAnimation === "none",
      "Reduced-motion startup still animates or exposes both layers.",
    );
    await reducedContext.close();
  }
} finally {
  await browser.close();
}

report.status = report.failures.length === 0 ? "passed" : "failed";
const reportPath = resolve(outputDirectory, "startup-readability-report.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  status: report.status,
  report: reportPath,
  failures: report.failures,
  viewports: report.viewports.map((entry) => ({
    viewport: entry.viewport.name,
    failures: entry.failures,
    transition: entry.normalMotion.transition,
    stable: entry.normalMotion.stable,
    inspector: entry.inspector,
    expandedWithToast: entry.expandedWithToast,
    reducedMotion: entry.reducedMotion,
  })),
}, null, 2));
if (report.status !== "passed") process.exitCode = 1;

async function capture(page, entry, name) {
  await page.screenshot({ path: resolve(outputDirectory, name), fullPage: false });
  entry.artifacts.push(name);
}

async function measureLayers(page) {
  return page.evaluate(() => {
    const boot = document.querySelector("#boot");
    const hud = document.querySelector("#hud");
    const bootStyle = boot ? getComputedStyle(boot) : null;
    const hudStyle = hud ? getComputedStyle(hud) : null;
    const bootOpacity = bootStyle ? Number.parseFloat(bootStyle.opacity) : 0;
    const hudOpacity = hudStyle ? Number.parseFloat(hudStyle.opacity) : 0;
    const bootVisible = Boolean(
      bootStyle
        && bootStyle.display !== "none"
        && bootStyle.visibility !== "hidden"
        && bootOpacity > 0.001,
    );
    const hudVisible = Boolean(
      hudStyle
        && hudStyle.display !== "none"
        && hudStyle.visibility !== "hidden"
        && hudOpacity > 0.001,
    );
    return {
      appClasses: document.querySelector("#app")?.className ?? "",
      bootClasses: boot?.className ?? "",
      bootHidden: boot?.hasAttribute("hidden") ?? true,
      bootDisplay: bootStyle?.display ?? null,
      bootVisibility: bootStyle?.visibility ?? null,
      bootOpacity,
      bootVisible,
      hudDisplay: hudStyle?.display ?? null,
      hudVisibility: hudStyle?.visibility ?? null,
      hudOpacity,
      hudVisible,
      simultaneousVisibility: bootVisible && hudVisible,
      toastCount: document.querySelectorAll(".toast").length,
    };
  });
}

async function measureInspector(page) {
  return page.evaluate(() => {
    const inspector = document.querySelector(".inspector.has-process-console.is-open");
    const minimap = document.querySelector(".minimap-shell");
    const viewport = { width: innerWidth, height: innerHeight };
    const inspectorRect = rect(inspector);
    const minimapRect = rect(minimap);
    const overlapWidth = inspectorRect && minimapRect
      ? Math.max(0, Math.min(inspectorRect.right, minimapRect.right)
        - Math.max(inspectorRect.left, minimapRect.left))
      : 0;
    const overlapHeight = inspectorRect && minimapRect
      ? Math.max(0, Math.min(inspectorRect.bottom, minimapRect.bottom)
        - Math.max(inspectorRect.top, minimapRect.top))
      : 0;
    const styles = Object.fromEntries(
      [".context-help", ".coordinate-readout", ".build-palette"].map((selector) => {
        const element = document.querySelector(selector);
        return [selector, element ? getComputedStyle(element).display : null];
      }),
    );
    return {
      viewport,
      inspector: inspectorRect,
      minimap: minimapRect,
      minimapGap: inspectorRect && minimapRect
        ? inspectorRect.left - minimapRect.right
        : null,
      minimapOverlapArea: overlapWidth * overlapHeight,
      underlayDisplays: styles,
      hiddenUnderlay: Object.values(styles).every((display) => display === "none"),
      inspectorWithinViewport: Boolean(
        inspectorRect
          && inspectorRect.left >= 0
          && inspectorRect.top >= 0
          && inspectorRect.right <= viewport.width
          && inspectorRect.bottom <= viewport.height,
      ),
    };

    function rect(element) {
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
  });
}

function check(entry, condition, message) {
  if (condition) return;
  entry.failures.push(message);
  report.failures.push(`${entry.viewport.name}: ${message}`);
}

function watchPage(page, entry) {
  page.on("pageerror", (error) => check(entry, false, `Page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      check(entry, false, `Console error: ${message.text()}`);
    }
  });
}

async function installSlowStartupCapture(page) {
  await page.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay = 0, ...args) => nativeSetTimeout(
      callback,
      delay === 850 ? 3_600 : delay,
      ...args,
    );
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.dataset.qaSlowStartup = "true";
      style.textContent = "#boot { transition-duration: 3000ms !important; }";
      document.head.append(style);
    }, { once: true });
  });
}
