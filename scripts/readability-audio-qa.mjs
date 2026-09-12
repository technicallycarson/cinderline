import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "playwright";

const BASE_URL = (process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173")
  .replace(/\/$/, "");
const OUTPUT_DIRECTORY = resolve(
  process.env.CINDERLINE_READABILITY_AUDIO_OUTPUT
    ?? ".qa/readability-audio",
);
const QA_SCOPE = process.env.CINDERLINE_READABILITY_AUDIO_SCOPE ?? "combined";
if (!["combined", "audio", "typography"].includes(QA_SCOPE)) {
  throw new Error(`Unknown readability/audio QA scope: ${QA_SCOPE}`);
}

const VIEWPORTS = Object.freeze([
  { name: "desktop-1920x1080", width: 1920, height: 1080, mobile: false },
  { name: "desktop-1366x768", width: 1366, height: 768, mobile: false },
  { name: "mobile-390x844", width: 390, height: 844, mobile: true },
  { name: "mobile-320x568", width: 320, height: 568, mobile: true },
]);

const TEXT_THRESHOLDS = Object.freeze({
  actionablePixels: 14,
  prosePixels: 16,
  headingPixels: 18,
  secondaryPixels: 12,
  proseLineHeightRatio: 1.4,
  touchTargetPixels: 44,
});

const AUDIO_THRESHOLDS = Object.freeze({
  unlockMilliseconds: 500,
  muteMilliseconds: 100,
  unmuteMilliseconds: 150,
  routine: {
    minimumPeakDecibels: -18,
    maximumPeakDecibels: -7,
    minimumActiveRmsDecibels: -30,
    maximumActiveRmsDecibels: -18,
    minimumAmbientSeparationDecibels: 10,
  },
  direct: {
    minimumPeakDecibels: -12,
    maximumPeakDecibels: -3,
    minimumActiveRmsDecibels: -24,
    maximumActiveRmsDecibels: -14,
    minimumAmbientSeparationDecibels: 14,
  },
  maximumOutputPeakDecibels: -1,
  maximumSampleMagnitude: 0.999,
  minimumUsefulBandRatioDecibels: -12,
});

const INITIAL_TEXT_SPEC = Object.freeze({
  heading: ["[data-ref='mission-title']"],
  prose: ["[data-ref='mission-copy']"],
  actionable: [
    ".commission-option",
    ".commission-submit",
    ".mission-collapse",
    ".objective",
    ".objective-count",
    ".build-category-tab",
    ".build-name",
    ".build-cost",
    ".build-state",
    ".mobile-world-controls button",
    ".mobile-world-controls button span",
  ],
  secondary: [
    ".brand-name span",
    ".telemetry-item label",
    ".telemetry-value small",
    ".panel-eyebrow",
    ".build-key",
    ".context-help",
    ".coordinate-readout",
    ".minimap-title",
  ],
  required: [
    "[data-ref='mission-title']",
    "[data-ref='mission-copy']",
    ".commission-option",
    ".commission-submit",
    ".objective",
    ".build-category-tab",
    ".build-name",
    ".build-cost",
    ".build-state",
  ],
  panels: [".hud-topbar", ".mission-panel", ".build-palette"],
});

const SHORT_PHONE_INITIAL_TEXT_SPEC = Object.freeze({
  heading: ["[data-ref='mission-title']"],
  prose: [],
  actionable: [
    ".mission-collapse",
    ".mission-collapsed-summary",
    ".mission-collapsed-summary strong",
    ".mission-collapsed-summary span",
    ".build-category-tab",
    ".build-name",
    ".build-cost",
    ".build-state",
    ".mobile-world-controls button",
    ".mobile-world-controls button span",
  ],
  secondary: [
    ".brand-name span",
    ".telemetry-item label",
    ".telemetry-value small",
    ".panel-eyebrow",
    ".build-key",
  ],
  required: [
    "[data-ref='mission-title']",
    ".mission-collapse",
    ".mission-collapsed-summary",
    ".build-category-tab",
    ".build-name",
    ".build-cost",
    ".build-state",
  ],
  panels: [".hud-topbar", ".mission-panel", ".build-palette"],
});

const EXPANDED_MISSION_TEXT_SPEC = Object.freeze({
  heading: ["[data-ref='mission-title']"],
  prose: ["[data-ref='mission-copy']"],
  actionable: [
    ".mission-collapse",
    ".commission-option",
    ".commission-submit",
    ".objective",
    ".objective-count",
    "[data-build='belt']",
    "[data-build='belt'] .build-name",
  ],
  secondary: [".panel-eyebrow"],
  required: [
    "[data-ref='mission-title']",
    "[data-ref='mission-copy']",
    ".mission-collapse",
    ".commission-option",
    ".commission-submit",
    ".objective",
    "[data-build='belt']",
    "[data-build='belt'] .build-name",
  ],
  panels: [".mission-panel", ".build-palette"],
});

const INSPECTOR_TEXT_SPEC = Object.freeze({
  heading: [".inspector h2"],
  prose: [],
  actionable: [
    ".inspector-status",
    ".stat-cell label",
    ".recipe-chip",
    ".inspector-action",
    ".process-stage > header",
    ".process-stage > header small",
    ".process-stack",
    ".process-empty",
    ".process-stage-chamber > strong",
    ".process-chamber-formula",
    ".process-progress span",
    ".process-condition",
    ".recipe-console-heading",
    ".recipe-console-heading small",
    ".recipe-option-header strong",
    ".recipe-option-header small",
    ".recipe-formula-row",
    ".recipe-badge",
  ],
  secondary: [],
  required: [
    ".inspector h2",
    ".inspector-status",
    ".process-stage > header",
    ".process-condition",
    ".recipe-console-heading",
    ".recipe-option-header strong",
    ".recipe-formula-row",
  ],
  panels: [".inspector"],
  overlapPairs: [
    [".inspector", ".minimap-shell"],
    [".inspector", ".context-help"],
    [".inspector", ".build-palette"],
  ],
});

const SESSION_TEXT_SPEC = Object.freeze({
  heading: [".session-panel > header strong"],
  prose: [".session-status small", ".session-panel > p"],
  actionable: [
    ".session-status strong",
    ".session-actions button",
    ".session-close",
  ],
  secondary: [".session-panel > header small"],
  required: [
    ".session-panel > header strong",
    ".session-status strong",
    ".session-status small",
    ".session-actions button",
  ],
  panels: [".session-panel"],
  overlapPairs: [[".session-panel", ".minimap-shell"]],
});

const MANUAL_TEXT_SPEC = Object.freeze({
  heading: [
    ".field-manual-card > header strong",
    ".manual-objective h2",
  ],
  prose: [".manual-objective ol"],
  actionable: [
    ".manual-controls dt",
    ".manual-controls dd",
    ".field-manual-card > header button",
    ".field-manual-card footer button",
  ],
  secondary: [
    ".field-manual-card > header small",
    ".manual-kicker",
  ],
  required: [
    ".field-manual-card > header strong",
    ".manual-objective h2",
    ".manual-objective ol",
    ".manual-controls dt",
    ".manual-controls dd",
    ".field-manual-card footer button",
  ],
  panels: [".field-manual-card"],
});

const AUDIO_CUES = Object.freeze([
  { name: "belt-transfer", group: "routine", duration: 0.36 },
  { name: "inserter-transfer", group: "routine", duration: 0.42 },
  { name: "extraction", group: "routine", duration: 0.42 },
  { name: "smelter-complete", group: "routine", duration: 0.48 },
  { name: "fabricator-arc", group: "routine", duration: 0.36 },
  { name: "fabricator-complete", group: "routine", duration: 0.42 },
  { name: "placed", group: "direct", duration: 0.52 },
  { name: "removed", group: "direct", duration: 0.58 },
  { name: "rotate", group: "direct", duration: 0.36 },
  { name: "error", group: "direct", duration: 0.58 },
  { name: "complete", group: "direct", duration: 1.05 },
]);

await mkdir(OUTPUT_DIRECTORY, { recursive: true });

const report = {
  schema: "cinderline-readability-audio-qa",
  version: 1,
  status: "running",
  scope: QA_SCOPE,
  baseURL: BASE_URL,
  outputDirectory: OUTPUT_DIRECTORY,
  thresholds: {
    text: TEXT_THRESHOLDS,
    audio: AUDIO_THRESHOLDS,
  },
  typography: [],
  audio: null,
  console: { errors: [], warnings: [] },
  failures: [],
};

const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  if (QA_SCOPE !== "audio") {
    for (const viewport of VIEWPORTS) {
      try {
        report.typography.push(
          await auditViewport(browser, viewport, report),
        );
      } catch (error) {
        report.failures.push(
          `${viewport.name} harness failure: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
        );
      }
    }
  }
  if (QA_SCOPE !== "typography") {
    report.audio = await auditAudio(browser, report);
  }
  report.status = report.failures.length === 0 ? "passed" : "failed";
} catch (error) {
  report.status = "failed";
  report.failures.push(
    `QA harness failure: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
  );
} finally {
  const reportPath = resolve(OUTPUT_DIRECTORY, "readability-audio-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await browser.close();
  console.log(JSON.stringify({
    status: report.status,
    report: reportPath,
    typography: report.typography.map((entry) => ({
      viewport: entry.viewport.name,
      failures: entry.failures.length,
      minimums: entry.minimums,
    })),
    audio: report.audio
      ? {
          unlockMilliseconds: report.audio.activation.unlockMilliseconds,
          ambient: report.audio.ambient,
          cues: report.audio.cues.map((cue) => ({
            name: cue.name,
            peakDecibels: cue.peakDecibels,
            activeRmsDecibels: cue.activeRmsDecibels,
            ambientSeparationDecibels: cue.ambientSeparationDecibels,
          })),
          worstCase: report.audio.worstCase,
        }
      : null,
    failures: report.failures,
  }, null, 2));
}

if (report.status !== "passed") process.exitCode = 1;

async function auditViewport(browserInstance, viewport, rootReport) {
  const context = await browserInstance.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
  });
  const page = await context.newPage();
  const entry = {
    viewport,
    states: [],
    minimums: {
      actionablePixels: Number.POSITIVE_INFINITY,
      prosePixels: Number.POSITIVE_INFINITY,
      headingPixels: Number.POSITIVE_INFINITY,
      secondaryPixels: Number.POSITIVE_INFINITY,
    },
    failures: [],
    artifacts: [],
  };

  watchPage(page, rootReport, viewport.name);

  try {
    await page.goto(
      `${BASE_URL}/?fresh=readability-audio-${encodeURIComponent(viewport.name)}`,
      { waitUntil: "networkidle", timeout: 30_000 },
    );
    await page.waitForFunction(
      () => document.querySelector("#boot")?.classList.contains("is-done"),
      null,
      { timeout: 10_000 },
    );
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(
      () => {
        const boot = document.querySelector("#boot");
        return !boot || Number.parseFloat(getComputedStyle(boot).opacity) <= 0.001;
      },
      null,
      { timeout: 2_000 },
    );
    await page.waitForFunction(
      () => {
        const hud = document.querySelector("#hud");
        const toast = document.querySelector(".toast");
        if (!hud || !toast) return false;
        const hudStyle = getComputedStyle(hud);
        const toastStyle = getComputedStyle(toast);
        const bounds = toast.getBoundingClientRect();
        return hudStyle.visibility !== "hidden"
          && Number.parseFloat(hudStyle.opacity) >= 0.99
          && toastStyle.display !== "none"
          && toastStyle.visibility !== "hidden"
          && Number.parseFloat(toastStyle.opacity) >= 0.95
          && bounds.width > 0
          && bounds.height > 0;
      },
      null,
      { timeout: 2_000 },
    );
    const toastLive = await measureTransientState(page);
    const toastLiveName = `${viewport.name}-toast-live.png`;
    await page.screenshot({
      path: resolve(OUTPUT_DIRECTORY, toastLiveName),
      fullPage: false,
    });
    entry.artifacts.push(toastLiveName);
    record(
      entry,
      rootReport,
      toastLive.toastPresent && toastLive.toastVisible,
      `${viewport.name}: the scheduled onboarding toast never became visibly testable.`,
    );
    record(
      entry,
      rootReport,
      toastLive.bootOpacity === null || toastLive.bootOpacity <= 0.001,
      `${viewport.name}: boot overlay opacity ${toastLive.bootOpacity} ghosts through the live HUD.`,
    );
    record(
      entry,
      rootReport,
      viewport.mobile
        ? toastLive.missionOpacity === null || toastLive.missionOpacity <= 0.01
        : toastLive.overlapArea <= 1,
      `${viewport.name}: live onboarding toast overlaps readable mission content by ${toastLive.overlapArea}px² at mission opacity ${toastLive.missionOpacity}.`,
    );
    await page.evaluate(() => window.__CINDERLINE__?.dismissToasts());
    await page.waitForTimeout(100);
    const toastExit = await measureTransientState(page);
    const toastExitName = `${viewport.name}-toast-exit.png`;
    await page.screenshot({
      path: resolve(OUTPUT_DIRECTORY, toastExitName),
      fullPage: false,
    });
    entry.artifacts.push(toastExitName);
    record(
      entry,
      rootReport,
      !toastExit.toastPresent
        || (viewport.mobile
          ? toastExit.missionOpacity === null || toastExit.missionOpacity <= 0.01
          : toastExit.overlapArea <= 1),
      `${viewport.name}: departing welcome toast overlaps readable mission content by ${toastExit.overlapArea}px² at mission opacity ${toastExit.missionOpacity}.`,
    );
    await page.waitForFunction(() => !document.querySelector(".toast"), null, {
      timeout: 2_000,
    });
    await page.waitForTimeout(50);

    const shortPhone = viewport.mobile && viewport.height <= 640;
    await captureTextState(
      page,
      entry,
      "initial",
      shortPhone ? SHORT_PHONE_INITIAL_TEXT_SPEC : INITIAL_TEXT_SPEC,
      viewport,
    );
    if (viewport.mobile) {
      await auditMobileBuildDockSwipe(
        page,
        entry,
        rootReport,
        viewport,
      );
      await auditMobilePaletteTargetedRecovery(
        page,
        entry,
        rootReport,
        viewport,
      );
    }

    if (shortPhone) {
      await page.locator("[data-action='mission-expand']").click();
      await page.waitForTimeout(100);
      await captureTextState(
        page,
        entry,
        "expanded-mission",
        EXPANDED_MISSION_TEXT_SPEC,
        viewport,
      );
      await auditExpandedMissionLayout(page, entry, rootReport, viewport);
      await auditExpandedMissionBuildSelection(
        page,
        entry,
        rootReport,
        viewport,
      );
      await page.locator("[data-action='mission-collapse']").click();
      await page.waitForTimeout(100);
    }

    if (viewport.mobile) {
      const mobileControlCount = await page.locator(
        ".mobile-world-controls button:visible",
      ).count();
      record(
        entry,
        rootReport,
        mobileControlCount > 0,
        `${viewport.name}: touch world controls are not visible.`,
      );
    }

    const smelterId = await page.evaluate(() =>
      window.__CINDERLINE__?.snapshot().entities.find(
        (entity) => entity.kind === "smelter",
      )?.id ?? null,
    );
    record(
      entry,
      rootReport,
      Number.isSafeInteger(smelterId),
      `${viewport.name}: fresh campaign has no smelter for process-console readability QA.`,
    );
    if (Number.isSafeInteger(smelterId)) {
      await page.evaluate((entityId) => {
        window.__CINDERLINE__?.selectEntity(entityId);
      }, smelterId);
      const inspectorSettling = await waitForSettledInspectorGeometry(page);
      entry.inspectorSettling = inspectorSettling;
      record(
        entry,
        rootReport,
        inspectorSettling.settled
          && inspectorSettling.final?.fullyOnscreen,
        `${viewport.name}: smelter inspector did not reach stable, fully onscreen geometry before capture (${JSON.stringify(inspectorSettling)}).`,
      );
      await captureTextState(
        page,
        entry,
        "smelter-inspector",
        INSPECTOR_TEXT_SPEC,
        viewport,
      );
      if (!viewport.mobile) {
        await auditInspectorBuildPalette(
          page,
          entry,
          rootReport,
          viewport,
        );
      }
      await page.evaluate(() => window.__CINDERLINE__?.selectEntity(null));
      await page.waitForTimeout(260);
    }

    await page.locator("[data-action='session-toggle']").click();
    await page.waitForTimeout(100);
    await captureTextState(
      page,
      entry,
      "session",
      SESSION_TEXT_SPEC,
      viewport,
    );
    // The compact phone top bar hides its duplicate Help icon. Exercise the
    // visible Field Manual action in the session panel at every viewport.
    await page.locator("[data-action='manual-open']").click();
    await page.waitForTimeout(100);
    await captureTextState(
      page,
      entry,
      "field-manual",
      MANUAL_TEXT_SPEC,
      viewport,
    );

    for (const key of Object.keys(entry.minimums)) {
      if (!Number.isFinite(entry.minimums[key])) entry.minimums[key] = null;
    }
  } finally {
    await context.close();
  }

  return entry;
}

async function waitForSettledInspectorGeometry(page) {
  const startedAt = Date.now();
  const samples = [];
  let previous = null;
  let stableOnscreenSamples = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const sample = await page.evaluate(() => {
      const inspector = document.querySelector(".inspector.is-open");
      if (!inspector) return null;
      const rect = inspector.getBoundingClientRect();
      const style = getComputedStyle(inspector);
      return {
        left: Math.round(rect.left * 10) / 10,
        top: Math.round(rect.top * 10) / 10,
        right: Math.round(rect.right * 10) / 10,
        bottom: Math.round(rect.bottom * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        display: style.display,
        visibility: style.visibility,
        opacity: Number.parseFloat(style.opacity),
        transform: style.transform,
        fullyOnscreen:
          rect.left >= -0.5
          && rect.top >= -0.5
          && rect.right <= innerWidth + 0.5
          && rect.bottom <= innerHeight + 0.5,
      };
    });
    samples.push(sample);
    const visible = sample
      && sample.display !== "none"
      && sample.visibility !== "hidden"
      && sample.opacity > 0.01;
    const delta = sample && previous
      ? Math.max(
        Math.abs(sample.left - previous.left),
        Math.abs(sample.top - previous.top),
        Math.abs(sample.right - previous.right),
        Math.abs(sample.bottom - previous.bottom),
      )
      : Number.POSITIVE_INFINITY;
    stableOnscreenSamples =
      visible && sample.fullyOnscreen && delta <= 0.5
        ? stableOnscreenSamples + 1
        : 0;
    if (stableOnscreenSamples >= 3) {
      return {
        settled: true,
        elapsedMilliseconds: Date.now() - startedAt,
        consecutiveStableSamples: stableOnscreenSamples,
        final: sample,
        recentSamples: samples.slice(-6),
      };
    }
    previous = sample;
    await page.waitForTimeout(50);
  }
  return {
    settled: false,
    elapsedMilliseconds: Date.now() - startedAt,
    consecutiveStableSamples: stableOnscreenSamples,
    final: samples.at(-1) ?? null,
    recentSamples: samples.slice(-6),
  };
}

async function measureTransientState(page) {
  return page.evaluate(() => {
    const boot = document.querySelector("#boot");
    const toast = document.querySelector(".toast");
    const mission = document.querySelector(".mission-panel");
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number.parseFloat(style.opacity) > 0.01
        && bounds.width > 0
        && bounds.height > 0;
    };
    const bounds = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };
    };
    const toastBounds = bounds(toast);
    const missionBounds = bounds(mission);
    const overlapWidth = toastBounds && missionBounds
      ? Math.max(
          0,
          Math.min(toastBounds.right, missionBounds.right)
            - Math.max(toastBounds.left, missionBounds.left),
        )
      : 0;
    const overlapHeight = toastBounds && missionBounds
      ? Math.max(
          0,
          Math.min(toastBounds.bottom, missionBounds.bottom)
            - Math.max(toastBounds.top, missionBounds.top),
        )
      : 0;
    return {
      bootOpacity: boot
        ? Number.parseFloat(getComputedStyle(boot).opacity)
        : null,
      toastPresent: Boolean(toast),
      toastVisible: visible(toast),
      toastLeaving: toast?.classList.contains("is-leaving") ?? false,
      missionOpacity: mission
        ? Number.parseFloat(getComputedStyle(mission).opacity)
        : null,
      overlapArea: visible(toast) && visible(mission)
        ? Math.round(overlapWidth * overlapHeight * 10) / 10
        : 0,
      toastBounds,
      missionBounds,
    };
  });
}

async function captureTextState(page, entry, stateName, spec, viewport) {
  const result = await page.evaluate(
    ({ spec: browserSpec, thresholds, mobile }) => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const visible = (element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity) > 0
          && bounds.width > 0
          && bounds.height > 0;
      };
      const select = (selectors) => {
        const elements = new Set();
        for (const selector of selectors) {
          for (const element of document.querySelectorAll(selector)) {
            if (visible(element)) elements.add(element);
          }
        }
        return [...elements];
      };
      const describe = (element, category) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        const fontSize = Number.parseFloat(style.fontSize);
        const lineHeight = Number.parseFloat(style.lineHeight);
        const lineHeightRatio = Number.isFinite(lineHeight)
          ? lineHeight / fontSize
          : null;
        const clipsHorizontally = element.scrollWidth > element.clientWidth + 1
          && ["hidden", "clip"].includes(style.overflowX);
        const clipsVertically = element.scrollHeight > element.clientHeight + 2
          && ["hidden", "clip"].includes(style.overflowY);
        const text = element.textContent?.trim().replace(/\s+/g, " ") ?? "";
        return {
          category,
          selectorHint:
            element.getAttribute("data-ref")
            ?? element.getAttribute("data-action")
            ?? element.getAttribute("data-build")
            ?? element.className
            ?? element.tagName.toLowerCase(),
          tag: element.tagName.toLowerCase(),
          text: text.slice(0, 180),
          fontSize,
          lineHeight: Number.isFinite(lineHeight) ? lineHeight : style.lineHeight,
          lineHeightRatio,
          bounds: {
            left: round(bounds.left),
            top: round(bounds.top),
            right: round(bounds.right),
            bottom: round(bounds.bottom),
            width: round(bounds.width),
            height: round(bounds.height),
          },
          clipsHorizontally,
          clipsVertically,
          touchTargetFailure:
            mobile
            && ["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(element.tagName)
            && (bounds.width + 0.5 < thresholds.touchTargetPixels
              || bounds.height + 0.5 < thresholds.touchTargetPixels),
        };
      };

      const elements = {
        actionable: select(browserSpec.actionable).map((element) =>
          describe(element, "actionable")),
        prose: select(browserSpec.prose).map((element) =>
          describe(element, "prose")),
        heading: select(browserSpec.heading).map((element) =>
          describe(element, "heading")),
        secondary: select(browserSpec.secondary).map((element) =>
          describe(element, "secondary")),
      };
      const required = browserSpec.required.map((selector) => ({
        selector,
        count: [...document.querySelectorAll(selector)].filter(visible).length,
      }));
      const panels = browserSpec.panels.map((selector) => {
        const element = [...document.querySelectorAll(selector)].find(visible);
        if (!element) return { selector, missing: true };
        const bounds = element.getBoundingClientRect();
        return {
          selector,
          missing: false,
          bounds: {
            left: round(bounds.left),
            top: round(bounds.top),
            right: round(bounds.right),
            bottom: round(bounds.bottom),
            width: round(bounds.width),
            height: round(bounds.height),
          },
          withinViewport:
            bounds.left >= -0.5
            && bounds.top >= -0.5
            && bounds.right <= viewportWidth + 0.5
            && bounds.bottom <= viewportHeight + 0.5,
          scrollableX: element.scrollWidth > element.clientWidth + 1,
          scrollableY: element.scrollHeight > element.clientHeight + 1,
        };
      });

      const panelBySelector = Object.fromEntries(
        panels.filter((panel) => !panel.missing).map((panel) => [panel.selector, panel]),
      );
      const overlaps = [];
      if (panelBySelector[".mission-panel"] && panelBySelector[".build-palette"]) {
        const left = panelBySelector[".mission-panel"].bounds;
        const right = panelBySelector[".build-palette"].bounds;
        const overlapWidth = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
        const overlapHeight = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
        if (overlapWidth * overlapHeight > 1) {
          overlaps.push({
            left: ".mission-panel",
            right: ".build-palette",
            area: round(overlapWidth * overlapHeight),
          });
        }
      }
      for (const [leftSelector, rightSelector] of browserSpec.overlapPairs ?? []) {
        const leftElement = [...document.querySelectorAll(leftSelector)].find(visible);
        const rightElement = [...document.querySelectorAll(rightSelector)].find(visible);
        if (!leftElement || !rightElement) continue;
        const left = leftElement.getBoundingClientRect();
        const right = rightElement.getBoundingClientRect();
        const overlapWidth = Math.max(
          0,
          Math.min(left.right, right.right) - Math.max(left.left, right.left),
        );
        const overlapHeight = Math.max(
          0,
          Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top),
        );
        if (overlapWidth * overlapHeight > 1) {
          overlaps.push({
            left: leftSelector,
            right: rightSelector,
            area: round(overlapWidth * overlapHeight),
          });
        }
      }

      return {
        viewport: { width: viewportWidth, height: viewportHeight },
        elements,
        required,
        panels,
        overlaps,
        pageOverflow: {
          horizontal: document.documentElement.scrollWidth > viewportWidth + 1,
          vertical: document.documentElement.scrollHeight > viewportHeight + 1,
        },
      };

      function round(value) {
        return Math.round(value * 10) / 10;
      }
    },
    { spec, thresholds: TEXT_THRESHOLDS, mobile: viewport.mobile },
  );

  const screenshotName = `${viewport.name}-${stateName}.png`;
  await page.screenshot({
    path: resolve(OUTPUT_DIRECTORY, screenshotName),
    fullPage: false,
  });
  entry.artifacts.push(screenshotName);

  const state = { name: stateName, ...result, failures: [] };
  entry.states.push(state);

  validateTextCategory(
    entry,
    state,
    "actionable",
    TEXT_THRESHOLDS.actionablePixels,
  );
  validateTextCategory(
    entry,
    state,
    "prose",
    TEXT_THRESHOLDS.prosePixels,
  );
  validateTextCategory(
    entry,
    state,
    "heading",
    TEXT_THRESHOLDS.headingPixels,
  );
  validateTextCategory(
    entry,
    state,
    "secondary",
    TEXT_THRESHOLDS.secondaryPixels,
  );

  for (const element of state.elements.prose) {
    if (
      element.lineHeightRatio !== null
      && element.lineHeightRatio + 0.001 < TEXT_THRESHOLDS.proseLineHeightRatio
    ) {
      failState(
        entry,
        state,
        `${viewport.name}/${stateName}: prose "${element.text}" line-height ratio ${round(element.lineHeightRatio)} is below ${TEXT_THRESHOLDS.proseLineHeightRatio}.`,
      );
    }
  }
  for (const required of state.required) {
    if (required.count === 0) {
      failState(
        entry,
        state,
        `${viewport.name}/${stateName}: required selector ${required.selector} has no visible match.`,
      );
    }
  }
  for (const panel of state.panels) {
    if (panel.missing) {
      failState(
        entry,
        state,
        `${viewport.name}/${stateName}: panel ${panel.selector} is missing.`,
      );
    } else if (!panel.withinViewport) {
      failState(
        entry,
        state,
        `${viewport.name}/${stateName}: panel ${panel.selector} leaves the native viewport (${JSON.stringify(panel.bounds)}).`,
      );
    }
  }
  for (const overlap of state.overlaps) {
    failState(
      entry,
      state,
      `${viewport.name}/${stateName}: ${overlap.left} overlaps ${overlap.right} by ${overlap.area}px².`,
    );
  }
  if (state.pageOverflow.horizontal || state.pageOverflow.vertical) {
    failState(
      entry,
      state,
      `${viewport.name}/${stateName}: page-level overflow is ${JSON.stringify(state.pageOverflow)}.`,
    );
  }
}

function validateTextCategory(entry, state, category, minimumPixels) {
  const elements = state.elements[category];
  for (const element of elements) {
    entry.minimums[`${category}Pixels`] = Math.min(
      entry.minimums[`${category}Pixels`],
      element.fontSize,
    );
    if (element.fontSize + 0.001 < minimumPixels) {
      failState(
        entry,
        state,
        `${entry.viewport.name}/${state.name}: ${category} text "${element.text}" is ${element.fontSize}px; requires >=${minimumPixels}px.`,
      );
    }
    if (element.clipsHorizontally || element.clipsVertically) {
      failState(
        entry,
        state,
        `${entry.viewport.name}/${state.name}: ${category} text "${element.text}" is clipped.`,
      );
    }
    if (element.touchTargetFailure) {
      failState(
        entry,
        state,
        `${entry.viewport.name}/${state.name}: touch target "${element.text}" is ${element.bounds.width}×${element.bounds.height}px; requires >=${TEXT_THRESHOLDS.touchTargetPixels}×${TEXT_THRESHOLDS.touchTargetPixels}px.`,
      );
    }
  }
}

async function auditMobileBuildDockSwipe(
  page,
  entry,
  rootReport,
  viewport,
) {
  const setup = await page.evaluate(() => {
    const palette = document.querySelector(".build-palette");
    const dock = document.querySelector(".build-dock");
    if (!palette || !dock) {
      return { missing: { palette: !palette, dock: !dock } };
    }
    dock.scrollLeft = 0;
    const controller = new AbortController();
    window.__readabilityDockSwipeController?.abort();
    window.__readabilityDockSwipeController = controller;
    window.__readabilityDockSwipeEvents = {
      starts: 0,
      moves: 0,
      ends: 0,
      allTrusted: true,
    };
    const recordEvent = (key) => (event) => {
      window.__readabilityDockSwipeEvents[key] += 1;
      window.__readabilityDockSwipeEvents.allTrusted &&= event.isTrusted;
    };
    dock.addEventListener("touchstart", recordEvent("starts"), {
      passive: true,
      signal: controller.signal,
    });
    dock.addEventListener("touchmove", recordEvent("moves"), {
      passive: true,
      signal: controller.signal,
    });
    dock.addEventListener("touchend", recordEvent("ends"), {
      passive: true,
      signal: controller.signal,
    });
    const paletteBounds = palette.getBoundingClientRect();
    const dockBounds = dock.getBoundingClientRect();
    const dockStyle = getComputedStyle(dock);
    const cards = [...dock.querySelectorAll(
      ".build-card[data-build-category='factory']:not([hidden])",
    )].filter((card) => {
      const style = getComputedStyle(card);
      const bounds = card.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && bounds.width > 0
        && bounds.height > 0;
    });
    return {
      missing: null,
      paletteVisible:
        getComputedStyle(palette).display !== "none"
        && paletteBounds.width > 0
        && paletteBounds.height > 0,
      dockVisible:
        dockStyle.display !== "none"
        && dockBounds.width > 0
        && dockBounds.height > 0,
      dockBounds: {
        left: dockBounds.left,
        top: dockBounds.top,
        right: dockBounds.right,
        bottom: dockBounds.bottom,
        width: dockBounds.width,
        height: dockBounds.height,
      },
      overflowX: dockStyle.overflowX,
      clientWidth: dock.clientWidth,
      scrollWidth: dock.scrollWidth,
      maximumScrollLeft: Math.max(0, dock.scrollWidth - dock.clientWidth),
      cardIds: cards.map((card) => card.dataset.build),
    };
  });

  record(
    entry,
    rootReport,
    setup.missing === null,
    `${viewport.name}: mobile build-dock swipe audit is missing ${JSON.stringify(setup.missing)}.`,
  );
  if (setup.missing !== null) return;

  const sampleDock = () => page.evaluate(() => {
    const dock = document.querySelector(".build-dock");
    if (!dock) return null;
    const dockBounds = dock.getBoundingClientRect();
    const cards = [...dock.querySelectorAll(
      ".build-card[data-build-category='factory']:not([hidden])",
    )];
    return {
      scrollLeft: dock.scrollLeft,
      cards: cards.map((card) => {
        const bounds = card.getBoundingClientRect();
        const fullyVisible =
          bounds.left >= dockBounds.left - 0.5
          && bounds.right <= dockBounds.right + 0.5
          && bounds.top >= dockBounds.top - 0.5
          && bounds.bottom <= dockBounds.bottom + 0.5
          && bounds.left >= -0.5
          && bounds.right <= window.innerWidth + 0.5;
        const x = Math.min(
          window.innerWidth - 1,
          Math.max(0, bounds.left + bounds.width / 2),
        );
        const y = Math.min(
          window.innerHeight - 1,
          Math.max(0, bounds.top + bounds.height / 2),
        );
        const hit = fullyVisible ? document.elementFromPoint(x, y) : null;
        return {
          id: card.dataset.build,
          fullyVisible,
          hitTestable: Boolean(
            hit && (hit === card || card.contains(hit)),
          ),
          bounds: {
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
            bottom: bounds.bottom,
          },
        };
      }),
    };
  });

  const cdp = await page.context().newCDPSession(page);
  const nativeSwipe = async (direction) => {
    const dockBounds = await page.locator(".build-dock").boundingBox();
    if (!dockBounds) return;
    const distance = Math.min(82, Math.max(54, dockBounds.width * 0.24));
    const startX = direction === "forward"
      ? dockBounds.x + dockBounds.width - 24
      : dockBounds.x + 24;
    const endX = direction === "forward"
      ? startX - distance
      : startX + distance;
    const y = dockBounds.y + dockBounds.height * 0.55;
    const point = (x) => ({
      x,
      y,
      id: 1,
      radiusX: 2,
      radiusY: 2,
      force: 1,
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point(startX)],
    });
    for (let step = 1; step <= 8; step += 1) {
      const progress = step / 8;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [point(startX + (endX - startX) * progress)],
      });
      await page.waitForTimeout(18);
    }
    await page.waitForTimeout(55);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await page.waitForTimeout(105);
  };

  const collectReachable = (sample, target) => {
    for (const card of sample?.cards ?? []) {
      if (card.fullyVisible && card.hitTestable) target.add(card.id);
    }
  };

  const forwardReachable = new Set();
  const reverseReachable = new Set();
  const forwardTrace = [];
  const reverseTrace = [];
  let sample = await sampleDock();
  collectReachable(sample, forwardReachable);
  for (let iteration = 0; iteration < 30; iteration += 1) {
    if (sample.scrollLeft >= setup.maximumScrollLeft - 1) break;
    const before = sample.scrollLeft;
    await nativeSwipe("forward");
    sample = await sampleDock();
    forwardTrace.push({ before, after: sample.scrollLeft });
    collectReachable(sample, forwardReachable);
    if (
      forwardTrace.length >= 3
      && forwardTrace.slice(-3).every(
        (step) => step.after <= step.before + 0.5,
      )
    ) break;
  }
  const forwardEnd = sample;
  collectReachable(forwardEnd, forwardReachable);

  const screenshotName = `${viewport.name}-initial-build-dock-native-end.png`;
  await page.screenshot({
    path: resolve(OUTPUT_DIRECTORY, screenshotName),
    fullPage: false,
  });
  entry.artifacts.push(screenshotName);

  collectReachable(sample, reverseReachable);
  for (let iteration = 0; iteration < 30; iteration += 1) {
    if (sample.scrollLeft <= 1) break;
    const before = sample.scrollLeft;
    await nativeSwipe("reverse");
    sample = await sampleDock();
    reverseTrace.push({ before, after: sample.scrollLeft });
    collectReachable(sample, reverseReachable);
    if (
      reverseTrace.length >= 3
      && reverseTrace.slice(-3).every(
        (step) => step.after >= step.before - 0.5,
      )
    ) break;
  }
  const reverseEnd = sample;
  collectReachable(reverseEnd, reverseReachable);
  const eventProbe = await page.evaluate(() => {
    const events = window.__readabilityDockSwipeEvents;
    window.__readabilityDockSwipeController?.abort();
    return events;
  });
  await cdp.detach();

  const result = {
    ...setup,
    forwardTrace,
    reverseTrace,
    forwardEndScrollLeft: forwardEnd.scrollLeft,
    reverseEndScrollLeft: reverseEnd.scrollLeft,
    forwardReachable: [...forwardReachable],
    reverseReachable: [...reverseReachable],
    missingForward: setup.cardIds.filter((id) => !forwardReachable.has(id)),
    missingReverse: setup.cardIds.filter((id) => !reverseReachable.has(id)),
    eventProbe,
    forwardEndCards: forwardEnd.cards,
    reverseEndCards: reverseEnd.cards,
  };
  entry.mobileBuildDockSwipe = result;

  record(
    entry,
    rootReport,
    result.paletteVisible && result.dockVisible,
    `${viewport.name}: mobile construction palette or build dock is not visible.`,
  );
  record(
    entry,
    rootReport,
    result.cardIds.length > 0
      && result.maximumScrollLeft > 1
      && ["auto", "scroll"].includes(result.overflowX),
    `${viewport.name}: mobile Factory cards are not exposed through a native horizontal scroller (${JSON.stringify(setup)}).`,
  );
  record(
    entry,
    rootReport,
    eventProbe.starts > 0
      && eventProbe.moves > 0
      && eventProbe.ends > 0
      && eventProbe.allTrusted,
    `${viewport.name}: dock did not receive trusted native touch events (${JSON.stringify(eventProbe)}).`,
  );
  record(
    entry,
    rootReport,
    result.forwardEndScrollLeft >= result.maximumScrollLeft - 1
      && result.reverseEndScrollLeft <= 1
      && forwardTrace.some((step) => step.after > step.before + 0.5)
      && reverseTrace.some((step) => step.after < step.before - 0.5),
    `${viewport.name}: native bidirectional swipe did not traverse the complete dock (${JSON.stringify({ maximum: result.maximumScrollLeft, forwardEnd: result.forwardEndScrollLeft, reverseEnd: result.reverseEndScrollLeft, forwardTrace, reverseTrace })}).`,
  );
  record(
    entry,
    rootReport,
    result.missingForward.length === 0 && result.missingReverse.length === 0,
    `${viewport.name}: Factory cards are not fully visible and hit-testable in both native swipe directions (${JSON.stringify({ missingForward: result.missingForward, missingReverse: result.missingReverse })}).`,
  );
}

async function auditMobilePaletteTargetedRecovery(
  page,
  entry,
  rootReport,
  viewport,
) {
  const dock = page.locator("#build-dock");
  const dockBounds = await dock.boundingBox();
  if (!dockBounds) {
    record(
      entry,
      rootReport,
      false,
      `${viewport.name}: construction dock has no geometry for targeted native recovery.`,
    );
    return;
  }

  await page.evaluate(() => {
    const dockElement = document.querySelector("#build-dock");
    if (dockElement) dockElement.scrollLeft = 0;
    window.__readabilityTargetedInputController?.abort();
    const controller = new AbortController();
    window.__readabilityTargetedInputController = controller;
    window.__readabilityTargetedInputEvents = [];
    const capture = (event) => {
      const target = event.target instanceof Element
        ? event.target.closest("[data-build], [data-action='mobile-cancel']")
        : null;
      if (!target) return;
      window.__readabilityTargetedInputEvents.push({
        type: event.type,
        trusted: event.isTrusted,
        build: target.getAttribute("data-build"),
        action: target.getAttribute("data-action"),
      });
    };
    document.addEventListener("touchend", capture, {
      capture: true,
      signal: controller.signal,
    });
    document.addEventListener("click", capture, {
      capture: true,
      signal: controller.signal,
    });
  });

  const session = await page.context().newCDPSession(page);
  const gestures = [];
  const dispatchNativeSwipe = async (direction) => {
    const startX = Math.round(
      dockBounds.x + (direction === "earlier" ? 18 : dockBounds.width - 18),
    );
    const endX = Math.round(
      dockBounds.x + (direction === "earlier" ? dockBounds.width - 18 : 18),
    );
    const y = Math.round(dockBounds.y + dockBounds.height / 2);
    const before = await page.evaluate(() =>
      document.querySelector("#build-dock")?.scrollLeft ?? null,
    );
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
    await page.waitForTimeout(120);
    const after = await page.evaluate(() =>
      document.querySelector("#build-dock")?.scrollLeft ?? null,
    );
    const gesture = { direction, startX, endX, y, before, after };
    gestures.push(gesture);
    return gesture;
  };

  const readGeometry = (card) => card.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const dockElement = document.querySelector("#build-dock");
    const dockRect = dockElement?.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(centerX, centerY);
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      dockLeft: dockRect?.left ?? 0,
      dockRight: dockRect?.right ?? innerWidth,
      dockTop: dockRect?.top ?? 0,
      dockBottom: dockRect?.bottom ?? innerHeight,
      scrollLeft: dockElement?.scrollLeft ?? 0,
      fullyInside:
        rect.left >= (dockRect?.left ?? 0)
        && rect.right <= (dockRect?.right ?? innerWidth)
        && rect.top >= (dockRect?.top ?? 0)
        && rect.bottom <= (dockRect?.bottom ?? innerHeight),
      hitTestable: Boolean(hit && (hit === element || element.contains(hit))),
    };
  });

  const results = [];
  const repetitionCount = 3;
  try {
    for (let repetition = 1; repetition <= repetitionCount; repetition += 1) {
      // Let any native compositor fling expire before restoring the exact
      // production-sequence starting state. A second assignment catches a
      // late compositor write instead of allowing it to taint the next pass.
      await page.waitForTimeout(240);
      await page.evaluate(() => {
        const dockElement = document.querySelector("#build-dock");
        if (dockElement) dockElement.scrollLeft = 0;
      });
      await page.waitForTimeout(100);
      await page.evaluate(() => {
        const dockElement = document.querySelector("#build-dock");
        if (dockElement) dockElement.scrollLeft = 0;
      });
      await page.waitForTimeout(40);

      // Match the production M1 proof exactly: first leave the leading cards,
      // then recover a deliberately non-monotonic sequence one target at a time.
      await dispatchNativeSwipe("later");
      await dispatchNativeSwipe("later");

      for (const kind of ["gridRelay", "extractor", "inserter", "smelter"]) {
        const card = page.locator(`[data-build='${kind}']`);
        const attempts = [];
        let geometry = await readGeometry(card);
        for (let attempt = 0; attempt < 8 && !geometry.fullyInside; attempt += 1) {
          const direction = geometry.left < geometry.dockLeft
            ? "earlier"
            : "later";
          const gesture = await dispatchNativeSwipe(direction);
          geometry = await readGeometry(card);
          attempts.push({ gesture, geometry });
        }

        const finalPreTapGeometry = await readGeometry(card);
        const screenshotName = `${viewport.name}-target-r${repetition}-${kind}-pre-tap.png`;
        await page.screenshot({
          path: resolve(OUTPUT_DIRECTORY, screenshotName),
          fullPage: false,
        });
        entry.artifacts.push(screenshotName);
        record(
          entry,
          rootReport,
          finalPreTapGeometry.fullyInside && finalPreTapGeometry.hitTestable,
          `${viewport.name}: targeted native recovery repetition ${repetition} did not expose ${kind} fully and hit-testably immediately before tap after 8 attempts (${JSON.stringify(finalPreTapGeometry)}).`,
        );

        const eventStart = await page.evaluate(() =>
          window.__readabilityTargetedInputEvents?.length ?? 0,
        );
        if (finalPreTapGeometry.fullyInside && finalPreTapGeometry.hitTestable) {
          await card.tap();
        }
        const selected = await card.getAttribute("aria-pressed");
        const cardEvents = await page.evaluate((start) =>
          (window.__readabilityTargetedInputEvents ?? []).slice(start),
        eventStart);
        record(
          entry,
          rootReport,
          finalPreTapGeometry.fullyInside
            && finalPreTapGeometry.hitTestable
            && selected === "true"
            && cardEvents.some((event) => event.trusted),
          `${viewport.name}: repetition ${repetition} ${kind} was not selected by a trusted, fully exposed touch tap (${JSON.stringify({ finalPreTapGeometry, selected, cardEvents })}).`,
        );

        const cancel = page.locator("[data-action='mobile-cancel']");
        const cancelVisible = await cancel.isVisible();
        const cancelEventStart = await page.evaluate(() =>
          window.__readabilityTargetedInputEvents?.length ?? 0,
        );
        if (cancelVisible && selected === "true") await cancel.tap();
        const cancelEvents = await page.evaluate((start) =>
          (window.__readabilityTargetedInputEvents ?? []).slice(start),
        cancelEventStart);
        const cancelled = await card.getAttribute("aria-pressed");
        record(
          entry,
          rootReport,
          cancelVisible
            && cancelled === "false"
            && cancelEvents.some((event) => event.trusted),
          `${viewport.name}: repetition ${repetition} ${kind} placement was not cancelled with a trusted touchscreen tap (${JSON.stringify({ cancelVisible, cancelled, cancelEvents })}).`,
        );
        results.push({
          repetition,
          kind,
          attempts,
          finalPreTapGeometry,
          selected,
          cardEvents,
          cancelVisible,
          cancelled,
          cancelEvents,
        });
      }
    }
  } finally {
    await session.detach();
    await page.evaluate(() => {
      window.__readabilityTargetedInputController?.abort();
    });
  }

  const allEventsTrusted = results.every((result) =>
    result.cardEvents.length > 0
      && result.cardEvents.every((event) => event.trusted)
      && result.cancelEvents.length > 0
      && result.cancelEvents.every((event) => event.trusted),
  );
  entry.mobilePaletteTargetedRecovery = {
    input: "trusted Chromium native swipes, touchscreen card taps, and touchscreen Cancel taps",
    sequence: ["two later swipes", "gridRelay", "extractor", "inserter", "smelter"],
    settlingMilliseconds: 120,
    maximumRecoveryAttemptsPerTarget: 8,
    repetitionCount,
    gestures,
    results,
    allEventsTrusted,
  };
  record(
    entry,
    rootReport,
    allEventsTrusted,
    `${viewport.name}: targeted palette card/Cancel event stream was not wholly trusted.`,
  );
}

async function auditInspectorBuildPalette(
  page,
  entry,
  rootReport,
  viewport,
) {
  const layout = await page.evaluate(() => {
    const inspector = document.querySelector(".inspector.is-open");
    const palette = document.querySelector(".build-palette");
    const dock = document.querySelector(".build-dock");
    const categoryTabs = document.querySelector(".build-category-tabs");
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number.parseFloat(style.opacity) > 0.01
        && bounds.width > 0
        && bounds.height > 0;
    };
    const bounds = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const intersectionArea = (left, right) => {
      const width = Math.max(
        0,
        Math.min(left.right, right.right) - Math.max(left.left, right.left),
      );
      const height = Math.max(
        0,
        Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top),
      );
      return Math.round(width * height * 10) / 10;
    };
    const hitTest = (element) => {
      const rect = element.getBoundingClientRect();
      const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
      const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && (hit === element || element.contains(hit)));
    };

    if (!inspector || !palette || !dock || !categoryTabs) {
      return {
        missing: {
          inspector: !inspector,
          palette: !palette,
          dock: !dock,
          categoryTabs: !categoryTabs,
        },
      };
    }

    const inspectorBounds = bounds(inspector);
    const paletteBounds = bounds(palette);
    const dockBounds = bounds(dock);
    const paletteVisible = visible(palette);
    const dockVisible = visible(dock);
    const dockStyle = getComputedStyle(dock);
    const originalScrollLeft = dock.scrollLeft;
    const maximumScrollLeft = Math.max(0, dock.scrollWidth - dock.clientWidth);
    const cards = [...dock.querySelectorAll(".build-card")].filter(visible);
    const cardResults = [];

    for (const card of cards) {
      card.scrollIntoView({ block: "nearest", inline: "nearest" });
      const cardBounds = bounds(card);
      const currentDockBounds = bounds(dock);
      const fullyVisible =
        cardBounds.left >= currentDockBounds.left - 0.5
        && cardBounds.right <= currentDockBounds.right + 0.5
        && cardBounds.top >= currentDockBounds.top - 0.5
        && cardBounds.bottom <= currentDockBounds.bottom + 0.5
        && cardBounds.left >= -0.5
        && cardBounds.right <= window.innerWidth + 0.5
        && cardBounds.top >= -0.5
        && cardBounds.bottom <= window.innerHeight + 0.5;
      let keyboardFocusable = true;
      if (!card.disabled) {
        card.focus({ preventScroll: false });
        keyboardFocusable = document.activeElement === card;
      }
      cardResults.push({
        label: card.getAttribute("aria-label") ?? card.textContent?.trim() ?? "",
        disabled: card.disabled,
        fullyVisible,
        hitTestable: card.disabled ? true : hitTest(card),
        keyboardFocusable,
        bounds: cardBounds,
        scrollLeft: dock.scrollLeft,
      });
    }

    dock.scrollLeft = maximumScrollLeft;
    const endScrollLeft = dock.scrollLeft;
    const tabs = [...categoryTabs.querySelectorAll(".build-category-tab")]
      .filter(visible)
      .map((tab) => ({
        label: tab.textContent?.trim() ?? "",
        disabled: tab.disabled,
        hitTestable: tab.disabled ? true : hitTest(tab),
        tabIndex: tab.tabIndex,
        role: tab.getAttribute("role"),
        ariaSelected: tab.getAttribute("aria-selected"),
      }));

    return {
      missing: null,
      inspectorBounds,
      palette: {
        visible: paletteVisible,
        bounds: paletteBounds,
        withinViewport:
          paletteBounds.left >= -0.5
          && paletteBounds.top >= -0.5
          && paletteBounds.right <= window.innerWidth + 0.5
          && paletteBounds.bottom <= window.innerHeight + 0.5,
        overlapWithInspector: paletteVisible
          ? intersectionArea(inspectorBounds, paletteBounds)
          : 0,
      },
      dock: {
        visible: dockVisible,
        bounds: dockBounds,
        clientWidth: dock.clientWidth,
        scrollWidth: dock.scrollWidth,
        originalScrollLeft,
        maximumScrollLeft,
        endScrollLeft,
        overflowX: dockStyle.overflowX,
      },
      tabs,
      cards: cardResults,
    };
  });

  if (layout.missing === null) {
    const selectedTab = page.locator(
      ".build-category-tab[aria-selected='true']",
    );
    const initialTab = await selectedTab.evaluate((tab) => ({
      label: tab.textContent?.trim() ?? "",
      index: [...tab.parentElement.querySelectorAll(".build-category-tab")]
        .indexOf(tab),
    }));
    await selectedTab.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(40);
    const movedTab = await page.evaluate(() => {
      const selected = document.querySelector(
        ".build-category-tab[aria-selected='true']",
      );
      const focused = document.activeElement?.closest?.(
        ".build-category-tab",
      );
      return {
        selected: selected?.textContent?.trim() ?? null,
        focused: focused?.textContent?.trim() ?? null,
        inspectorOpen: Boolean(document.querySelector(".inspector.is-open")),
        paletteVisible: Boolean(
          document.querySelector(".build-palette")?.getBoundingClientRect().width,
        ),
      };
    });
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(40);
    const restoredTab = await page.evaluate(() => {
      const selected = document.querySelector(
        ".build-category-tab[aria-selected='true']",
      );
      const focused = document.activeElement?.closest?.(
        ".build-category-tab",
      );
      return {
        selected: selected?.textContent?.trim() ?? null,
        focused: focused?.textContent?.trim() ?? null,
      };
    });
    const expectedTab = layout.tabs[
      (initialTab.index + 1) % layout.tabs.length
    ]?.label ?? null;
    layout.tabKeyboardNavigation = {
      initial: initialTab.label,
      expected: expectedTab,
      moved: movedTab,
      restored: restoredTab,
    };

    await page.evaluate(() => {
      const dock = document.querySelector(".build-dock");
      if (!dock) return;
      dock.scrollLeft = dock.scrollWidth;
      const cards = [...dock.querySelectorAll(".build-card")].filter((card) => {
        const style = getComputedStyle(card);
        const bounds = card.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && bounds.width > 0
          && bounds.height > 0;
      });
      cards.at(-1)?.focus({ preventScroll: false });
    });
    await page.waitForTimeout(80);
    layout.tooltip = await page.evaluate(() => {
      const inspector = document.querySelector(".inspector.is-open");
      const tooltip = document.querySelector(".tooltip");
      if (!inspector || !tooltip) return { visible: false, overlap: 0 };
      const style = getComputedStyle(tooltip);
      const tooltipBounds = tooltip.getBoundingClientRect();
      const inspectorBounds = inspector.getBoundingClientRect();
      const visible = style.display !== "none"
        && style.visibility !== "hidden"
        && Number.parseFloat(style.opacity) > 0.01
        && tooltipBounds.width > 0
        && tooltipBounds.height > 0;
      const overlapWidth = Math.max(
        0,
        Math.min(tooltipBounds.right, inspectorBounds.right)
          - Math.max(tooltipBounds.left, inspectorBounds.left),
      );
      const overlapHeight = Math.max(
        0,
        Math.min(tooltipBounds.bottom, inspectorBounds.bottom)
          - Math.max(tooltipBounds.top, inspectorBounds.top),
      );
      return {
        visible,
        bounds: {
          left: tooltipBounds.left,
          top: tooltipBounds.top,
          right: tooltipBounds.right,
          bottom: tooltipBounds.bottom,
        },
        overlap: visible
          ? Math.round(overlapWidth * overlapHeight * 10) / 10
          : 0,
      };
    });
  }

  entry.inspectorBuildPalette = layout;
  record(
    entry,
    rootReport,
    layout.missing === null,
    `${viewport.name}: inspector build-palette audit is missing ${JSON.stringify(layout.missing)}.`,
  );
  if (layout.missing !== null) return;

  record(
    entry,
    rootReport,
    layout.palette.visible && layout.dock.visible,
    `${viewport.name}: opening the inspector hides the construction palette or build dock.`,
  );
  record(
    entry,
    rootReport,
    layout.palette.withinViewport,
    `${viewport.name}: inspector build palette leaves the viewport (${JSON.stringify(layout.palette.bounds)}).`,
  );
  record(
    entry,
    rootReport,
    layout.palette.overlapWithInspector <= 1,
    `${viewport.name}: inspector overlaps the usable construction palette by ${layout.palette.overlapWithInspector}px².`,
  );
  record(
    entry,
    rootReport,
    layout.tabs.length > 0
      && layout.tabs.every(
        (tab) => !tab.disabled && tab.hitTestable && tab.role === "tab",
      )
      && layout.tabs.filter((tab) => tab.tabIndex === 0).length === 1
      && layout.tabs.filter((tab) => tab.ariaSelected === "true").length === 1
      && layout.tabs.find((tab) => tab.tabIndex === 0)?.ariaSelected === "true",
    `${viewport.name}: inspector leaves category tabs inaccessible (${JSON.stringify(layout.tabs)}).`,
  );
  record(
    entry,
    rootReport,
    layout.tabKeyboardNavigation.moved.focused
        === layout.tabKeyboardNavigation.expected
      && layout.tabKeyboardNavigation.moved.selected
        === layout.tabKeyboardNavigation.expected
      && layout.tabKeyboardNavigation.moved.inspectorOpen
      && layout.tabKeyboardNavigation.moved.paletteVisible
      && layout.tabKeyboardNavigation.restored.focused
        === layout.tabKeyboardNavigation.initial
      && layout.tabKeyboardNavigation.restored.selected
        === layout.tabKeyboardNavigation.initial,
    `${viewport.name}: ArrowRight/ArrowLeft does not preserve tablist navigation while the inspector is open (${JSON.stringify(layout.tabKeyboardNavigation)}).`,
  );
  record(
    entry,
    rootReport,
    layout.cards.length > 0
      && layout.cards.some((card) => !card.disabled)
      && layout.cards.every(
        (card) =>
          card.fullyVisible && card.hitTestable && card.keyboardFocusable,
      ),
    `${viewport.name}: not every visible build button is scroll-reachable and usable (${JSON.stringify(layout.cards)}).`,
  );
  const requiresHorizontalScroll =
    layout.dock.scrollWidth > layout.dock.clientWidth + 1;
  record(
    entry,
    rootReport,
    !requiresHorizontalScroll
      || (["auto", "scroll"].includes(layout.dock.overflowX)
        && layout.dock.maximumScrollLeft > 1
        && Math.abs(
          layout.dock.endScrollLeft - layout.dock.maximumScrollLeft,
        ) <= 1),
    `${viewport.name}: clipped build buttons cannot be reached with contained horizontal scrolling (${JSON.stringify(layout.dock)}).`,
  );
  record(
    entry,
    rootReport,
    !layout.tooltip.visible || layout.tooltip.overlap <= 1,
    `${viewport.name}: focused build-card tooltip overlaps the inspector by ${layout.tooltip.overlap}px² (${JSON.stringify(layout.tooltip.bounds)}).`,
  );

  const screenshotName = `${viewport.name}-smelter-inspector-build-dock-end.png`;
  await page.waitForTimeout(60);
  await page.screenshot({
    path: resolve(OUTPUT_DIRECTORY, screenshotName),
    fullPage: false,
  });
  entry.artifacts.push(screenshotName);
  await page.evaluate((scrollLeft) => {
    const dock = document.querySelector(".build-dock");
    if (dock) dock.scrollLeft = scrollLeft;
  }, layout.dock.originalScrollLeft);
}

async function auditExpandedMissionLayout(page, entry, rootReport, viewport) {
  const layout = await page.evaluate(async () => {
    const mission = document.querySelector(".mission-panel");
    const collapse = document.querySelector("[data-action='mission-collapse']");
    if (!mission || !collapse) return { missing: true };
    const missionStyle = getComputedStyle(mission);
    const missionBounds = mission.getBoundingClientRect();
    const visible = (element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity) > 0.01
        && bounds.width > 0
        && bounds.height > 0;
    };
    const collisions = [];
    for (const selector of [".mobile-world-controls", ".build-palette"]) {
      const element = document.querySelector(selector);
      if (!element || !visible(element)) continue;
      const bounds = element.getBoundingClientRect();
      const overlapWidth = Math.max(
        0,
        Math.min(missionBounds.right, bounds.right)
          - Math.max(missionBounds.left, bounds.left),
      );
      const overlapHeight = Math.max(
        0,
        Math.min(missionBounds.bottom, bounds.bottom)
          - Math.max(missionBounds.top, bounds.top),
      );
      if (overlapWidth * overlapHeight > 1) {
        collisions.push({
          selector,
          area: Math.round(overlapWidth * overlapHeight * 10) / 10,
        });
      }
    }
    const scrollable = mission.scrollHeight > mission.clientHeight + 1;
    const containedOverflow = !scrollable
      || ["auto", "scroll", "hidden", "clip"].includes(missionStyle.overflowY);
    const originalScroll = mission.scrollTop;
    mission.scrollTop = mission.scrollHeight;
    const collapseAtBottom = collapse.getBoundingClientRect();
    const collapseRemainsReachable =
      collapseAtBottom.top >= missionBounds.top - 0.5
      && collapseAtBottom.bottom <= missionBounds.bottom + 0.5;
    mission.scrollTop = originalScroll;
    const toastStack = document.querySelector(".toast-stack");
    const toastProbe = document.createElement("div");
    toastProbe.className = "toast";
    toastProbe.textContent = "Expanded mission collision probe";
    toastStack?.append(toastProbe);
    await new Promise((resolvePromise) => window.setTimeout(resolvePromise, 240));
    const missionOpacityWithToast = Number.parseFloat(
      getComputedStyle(mission).opacity,
    );
    toastProbe.remove();
    await new Promise((resolvePromise) => window.setTimeout(resolvePromise, 220));
    return {
      missing: false,
      collisions,
      scrollable,
      overflowY: missionStyle.overflowY,
      containedOverflow,
      collapsePosition: getComputedStyle(collapse.parentElement).position,
      collapseRemainsReachable,
      missionOpacityWithToast,
    };
  });

  record(
    entry,
    rootReport,
    !layout.missing,
    `${viewport.name}: expanded mission surface or Hide Brief control is missing.`,
  );
  if (layout.missing) return;
  for (const collision of layout.collisions) {
    record(
      entry,
      rootReport,
      false,
      `${viewport.name}: expanded mission collides with ${collision.selector} by ${collision.area}px².`,
    );
  }
  record(
    entry,
    rootReport,
    layout.containedOverflow,
    `${viewport.name}: expanded mission content overflows with overflow-y:${layout.overflowY}.`,
  );
  if (layout.scrollable) {
    record(
      entry,
      rootReport,
      layout.collapseRemainsReachable,
      `${viewport.name}: Hide Brief leaves the visible mission surface when its content is scrolled.`,
    );
  }
  record(
    entry,
    rootReport,
    layout.missionOpacityWithToast >= 0.99,
    `${viewport.name}: expanded mission fades to opacity ${layout.missionOpacityWithToast} when a later toast arrives.`,
  );
}

async function auditExpandedMissionBuildSelection(
  page,
  entry,
  rootReport,
  viewport,
) {
  await page.evaluate(() => {
    window.__readabilityExpandedBuildInputController?.abort();
    const controller = new AbortController();
    window.__readabilityExpandedBuildInputController = controller;
    window.__readabilityExpandedBuildInputEvents = [];
    const capture = (event) => {
      const target = event.target instanceof Element
        ? event.target.closest(
          "[data-build='belt'], [data-action='mobile-cancel']",
        )
        : null;
      if (!target) return;
      window.__readabilityExpandedBuildInputEvents.push({
        type: event.type,
        trusted: event.isTrusted,
        build: target.getAttribute("data-build"),
        action: target.getAttribute("data-action"),
      });
    };
    document.addEventListener("touchend", capture, {
      capture: true,
      signal: controller.signal,
    });
    document.addEventListener("click", capture, {
      capture: true,
      signal: controller.signal,
    });
  });

  const readState = () => page.evaluate(() => {
    const mission = document.querySelector("[data-ref='mission-panel']");
    const palette = document.querySelector(".build-palette");
    const dock = document.querySelector("#build-dock");
    const belt = document.querySelector("[data-build='belt']");
    const cancel = document.querySelector("[data-action='mobile-cancel']");
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number.parseFloat(style.opacity) > 0.01
        && rect.width > 0
        && rect.height > 0;
    };
    const bounds = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const beltBounds = bounds(belt);
    const dockBounds = bounds(dock);
    const missionBounds = bounds(mission);
    const paletteBounds = bounds(palette);
    const centerX = beltBounds
      ? beltBounds.left + beltBounds.width / 2
      : -1;
    const centerY = beltBounds
      ? beltBounds.top + beltBounds.height / 2
      : -1;
    const hit = beltBounds
      ? document.elementFromPoint(centerX, centerY)
      : null;
    const overlap = missionBounds && paletteBounds
      ? Math.max(
        0,
        Math.min(missionBounds.right, paletteBounds.right)
          - Math.max(missionBounds.left, paletteBounds.left),
      ) * Math.max(
        0,
        Math.min(missionBounds.bottom, paletteBounds.bottom)
          - Math.max(missionBounds.top, paletteBounds.top),
      )
      : 0;
    return {
      missionCollapsed: Boolean(mission?.classList.contains("is-collapsed")),
      paletteVisible: visible(palette),
      dockVisible: visible(dock),
      beltVisible: visible(belt),
      beltPressed: belt?.getAttribute("aria-pressed"),
      cancelVisible: visible(cancel),
      beltBounds,
      dockBounds,
      missionBounds,
      paletteBounds,
      missionPaletteOverlap: Math.round(overlap * 10) / 10,
      beltFullyOnscreen: Boolean(
        beltBounds
          && beltBounds.left >= 0
          && beltBounds.top >= 0
          && beltBounds.right <= innerWidth
          && beltBounds.bottom <= innerHeight,
      ),
      beltFullyInsideDock: Boolean(
        beltBounds
          && dockBounds
          && beltBounds.left >= dockBounds.left
          && beltBounds.top >= dockBounds.top
          && beltBounds.right <= dockBounds.right
          && beltBounds.bottom <= dockBounds.bottom,
      ),
      beltHitTestable: Boolean(
        belt
          && hit
          && (hit === belt || belt.contains(hit)),
      ),
    };
  });

  const before = await readState();
  const accessible =
    !before.missionCollapsed
    && before.paletteVisible
    && before.dockVisible
    && before.beltVisible
    && before.beltFullyOnscreen
    && before.beltFullyInsideDock
    && before.beltHitTestable
    && before.missionPaletteOverlap <= 1;
  record(
    entry,
    rootReport,
    accessible,
    `${viewport.name}: expanded mission makes Belt unavailable for its auto-collapse workflow (${JSON.stringify(before)}).`,
  );

  const blockedScreenshot = `${viewport.name}-expanded-mission-build-access.png`;
  await page.screenshot({
    path: resolve(OUTPUT_DIRECTORY, blockedScreenshot),
    fullPage: false,
  });
  entry.artifacts.push(blockedScreenshot);

  const belt = page.locator("[data-build='belt']");
  const eventStart = await page.evaluate(() =>
    window.__readabilityExpandedBuildInputEvents?.length ?? 0,
  );
  if (accessible) await belt.tap({ timeout: 1_000 });
  await page.waitForTimeout(180);
  const afterSelection = await readState();
  const selectionEvents = await page.evaluate((start) =>
    (window.__readabilityExpandedBuildInputEvents ?? []).slice(start),
  eventStart);
  const autoCollapsed =
    accessible
    && afterSelection.missionCollapsed
    && afterSelection.beltPressed === "true"
    && afterSelection.paletteVisible
    && afterSelection.dockVisible
    && selectionEvents.length > 0
    && selectionEvents.every((event) => event.trusted);
  record(
    entry,
    rootReport,
    autoCollapsed,
    `${viewport.name}: trusted Belt tap from the expanded mission did not arm Belt and auto-collapse the brief (${JSON.stringify({ afterSelection, selectionEvents })}).`,
  );

  const autoCollapseScreenshot = `${viewport.name}-expanded-mission-belt-auto-collapse.png`;
  await page.screenshot({
    path: resolve(OUTPUT_DIRECTORY, autoCollapseScreenshot),
    fullPage: false,
  });
  entry.artifacts.push(autoCollapseScreenshot);

  const cancel = page.locator("[data-action='mobile-cancel']");
  const cancelEventStart = await page.evaluate(() =>
    window.__readabilityExpandedBuildInputEvents?.length ?? 0,
  );
  if (autoCollapsed && afterSelection.cancelVisible) {
    await cancel.tap({ timeout: 1_000 });
  }
  await page.waitForTimeout(100);
  const afterCancel = await readState();
  const cancelEvents = await page.evaluate((start) =>
    (window.__readabilityExpandedBuildInputEvents ?? []).slice(start),
  cancelEventStart);
  const cancelled =
    autoCollapsed
    && afterSelection.cancelVisible
    && afterCancel.beltPressed === "false"
    && cancelEvents.length > 0
    && cancelEvents.every((event) => event.trusted);
  record(
    entry,
    rootReport,
    cancelled,
    `${viewport.name}: expanded-mission Belt workflow did not clear with a trusted Cancel tap (${JSON.stringify({ afterCancel, cancelEvents })}).`,
  );

  let restoredExpanded = !afterCancel.missionCollapsed;
  if (!restoredExpanded) {
    const expand = page.locator("[data-action='mission-expand']");
    if (await expand.isVisible()) await expand.tap({ timeout: 1_000 });
    await page.waitForTimeout(120);
    restoredExpanded = !(await readState()).missionCollapsed;
  }
  record(
    entry,
    rootReport,
    restoredExpanded,
    `${viewport.name}: mission could not be restored after the expanded-mission Belt workflow.`,
  );

  await page.evaluate(() => {
    window.__readabilityExpandedBuildInputController?.abort();
  });
  entry.expandedMissionBuildSelection = {
    input: "trusted touchscreen Belt selection from expanded objectives, then trusted Cancel",
    before,
    accessible,
    afterSelection,
    selectionEvents,
    autoCollapsed,
    afterCancel,
    cancelEvents,
    cancelled,
    restoredExpanded,
  };
}

async function auditAudio(browserInstance, rootReport) {
  const context = await browserInstance.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  watchPage(page, rootReport, "audio");

  try {
    await page.goto(`${BASE_URL}/?fresh=readability-audio-output`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await page.waitForFunction(
      () => document.querySelector("#boot")?.classList.contains("is-done"),
      null,
      { timeout: 10_000 },
    );

    const beforeGesture = await page.evaluate(() => {
      const audio = window.__CINDERLINE__?.audio;
      return {
        supported: audio?.isSupported ?? false,
        ready: audio?.isReady ?? false,
        contextState:
          audio && "context" in audio
            ? audio.context?.state ?? null
            : null,
      };
    });
    const firstCueProbe = await page.evaluate(() => {
      const audio = window.__CINDERLINE__?.audio;
      if (!audio) return false;
      window.__readabilityAudioActivationProbe = {
        gestureMilliseconds: null,
        readyMilliseconds: null,
        cueMilliseconds: null,
      };
      window.addEventListener(
        "pointerdown",
        () => {
          const probe = window.__readabilityAudioActivationProbe;
          probe.gestureMilliseconds = performance.now();
          audio.error(0);
          const interval = window.setInterval(() => {
            const now = performance.now();
            if (
              probe.readyMilliseconds === null
              && audio.isReady
              && "context" in audio
              && audio.context?.state === "running"
            ) {
              probe.readyMilliseconds = now;
            }
            if (
              probe.cueMilliseconds === null
              && "transientSources" in audio
              && audio.transientSources.size > 0
            ) {
              probe.cueMilliseconds = now;
            }
            if (
              (probe.readyMilliseconds !== null
                && probe.cueMilliseconds !== null)
              || now - probe.gestureMilliseconds > 1_000
            ) {
              window.clearInterval(interval);
            }
          }, 1);
        },
        { once: true },
      );
      return true;
    });
    const driverUnlockStart = performance.now();
    await page.locator("#world").click({ position: { x: 620, y: 340 } });
    await page.waitForFunction(
      () =>
        window.__readabilityAudioActivationProbe?.readyMilliseconds !== null,
      null,
      { timeout: AUDIO_THRESHOLDS.unlockMilliseconds },
    );
    const driverUnlockMilliseconds = performance.now() - driverUnlockStart;
    let firstCueRendered;
    try {
      await page.waitForFunction(
        () =>
          window.__readabilityAudioActivationProbe?.cueMilliseconds !== null,
        null,
        { timeout: AUDIO_THRESHOLDS.unlockMilliseconds },
      );
      firstCueRendered = true;
    } catch {
      firstCueRendered = false;
    }
    const activationTiming = await page.evaluate(() => {
      const probe = window.__readabilityAudioActivationProbe;
      return {
        unlockMilliseconds:
          probe?.gestureMilliseconds !== null
            && probe?.readyMilliseconds !== null
            ? probe.readyMilliseconds - probe.gestureMilliseconds
            : Number.POSITIVE_INFINITY,
        firstCueMilliseconds:
          probe?.gestureMilliseconds !== null
            && probe?.cueMilliseconds !== null
            ? probe.cueMilliseconds - probe.gestureMilliseconds
            : Number.POSITIVE_INFINITY,
      };
    });
    const unlockMilliseconds = activationTiming.unlockMilliseconds;

    const pausePlate = page.locator("[data-ref='pause-plate']");
    if (!(await pausePlate.evaluate((element) => element.classList.contains("is-open")))) {
      await page.keyboard.press("Space");
    }
    await page.waitForFunction(
      () => document.querySelector("[data-ref='pause-plate']")?.classList.contains("is-open"),
    );
    await page.waitForTimeout(900);

    await page.evaluate(async () => {
      const audio = window.__CINDERLINE__?.audio;
      if (audio && "context" in audio) await audio.context?.suspend();
    });
    await page.evaluate(() => {
      const audio = window.__CINDERLINE__?.audio;
      window.__readabilityAudioResumeProbe = {
        gestureMilliseconds: null,
        readyMilliseconds: null,
      };
      window.addEventListener(
        "pointerdown",
        () => {
          const probe = window.__readabilityAudioResumeProbe;
          probe.gestureMilliseconds = performance.now();
          audio?.rotate(0);
          const interval = window.setInterval(() => {
            const now = performance.now();
            if (
              probe.readyMilliseconds === null
              && audio?.isReady
              && "context" in audio
              && audio.context?.state === "running"
            ) {
              probe.readyMilliseconds = now;
              window.clearInterval(interval);
            } else if (now - probe.gestureMilliseconds > 1_000) {
              window.clearInterval(interval);
            }
          }, 1);
        },
        { once: true },
      );
    });
    const driverResumeStart = performance.now();
    await page.locator("#world").click({ position: { x: 900, y: 500 } });
    await page.waitForFunction(
      () => window.__readabilityAudioResumeProbe?.readyMilliseconds !== null,
      null,
      { timeout: AUDIO_THRESHOLDS.unlockMilliseconds },
    );
    const driverResumeMilliseconds = performance.now() - driverResumeStart;
    const resumeMilliseconds = await page.evaluate(() => {
      const probe = window.__readabilityAudioResumeProbe;
      return probe?.gestureMilliseconds !== null
        && probe?.readyMilliseconds !== null
        ? probe.readyMilliseconds - probe.gestureMilliseconds
        : Number.POSITIVE_INFINITY;
    });
    await page.waitForTimeout(500);

    const measurements = await page.evaluate(
      async ({ cues, thresholds }) => {
        const audio = window.__CINDERLINE__?.audio;
        if (!audio || !("context" in audio) || !("outputCeiling" in audio)) {
          throw new Error("Audio internals are unavailable to the post-output QA tap.");
        }
        const audioContext = audio.context;
        const output = audio.outputCeiling;
        if (!audioContext || !output || audioContext.state !== "running") {
          throw new Error("Audio graph is not running for post-output QA.");
        }

        const fullProcessor = audioContext.createScriptProcessor(256, 2, 2);
        const highpass = audioContext.createBiquadFilter();
        const lowpass = audioContext.createBiquadFilter();
        const bandProcessor = audioContext.createScriptProcessor(256, 2, 2);
        const silentFull = audioContext.createGain();
        const silentBand = audioContext.createGain();
        highpass.type = "highpass";
        highpass.frequency.value = 250;
        highpass.Q.value = 0.707;
        lowpass.type = "lowpass";
        lowpass.frequency.value = 4_000;
        lowpass.Q.value = 0.707;
        silentFull.gain.value = 0;
        silentBand.gain.value = 0;
        output.connect(fullProcessor);
        output.connect(highpass).connect(lowpass).connect(bandProcessor);
        fullProcessor.connect(silentFull).connect(audioContext.destination);
        bandProcessor.connect(silentBand).connect(audioContext.destination);

        const capture = async (durationSeconds, trigger) => {
          const left = [];
          const right = [];
          const bandLeft = [];
          const bandRight = [];
          fullProcessor.onaudioprocess = (event) => {
            left.push(...event.inputBuffer.getChannelData(0));
            right.push(...event.inputBuffer.getChannelData(1));
          };
          bandProcessor.onaudioprocess = (event) => {
            bandLeft.push(...event.inputBuffer.getChannelData(0));
            bandRight.push(...event.inputBuffer.getChannelData(1));
          };
          await wait(70);
          trigger?.();
          await wait(durationSeconds * 1_000);
          fullProcessor.onaudioprocess = null;
          bandProcessor.onaudioprocess = null;
          return analyze(left, right, bandLeft, bandRight, audioContext.sampleRate);
        };

        audio.setAmbientEnabled(true);
        await wait(450);
        const ambient = await capture(2.25);
        audio.setAmbientEnabled(false);
        await wait(260);

        const cueRows = [];
        for (const cue of cues) {
          const repetitions = [];
          for (let repetition = 0; repetition < 3; repetition += 1) {
            if ("cueCooldowns" in audio) audio.cueCooldowns.clear();
            repetitions.push(
              await capture(cue.duration, () => invokeCue(audio, cue.name)),
            );
            await wait(90);
          }
          cueRows.push({
            ...cue,
            ...summarizeMeasurements(repetitions),
            repetitions,
          });
        }

        if ("cueCooldowns" in audio) audio.cueCooldowns.clear();
        const worstCase = await capture(0.82, () => {
          audio.transfer("belt", -0.5, 0.55);
          audio.transfer("inserter", 0.5, 0.62);
          audio.extraction(-0.2, 0.7);
          audio.smelter("complete", 0.15, 0.7);
          audio.fabricator("complete", 0.35, 0.7);
          audio.placed(0, 1);
        });

        const muteStarted = performance.now();
        audio.setMuted(true);
        while (audio.masterBus.gain.value > 0.001 && performance.now() - muteStarted < 500) {
          await wait(4);
        }
        const muteMilliseconds = performance.now() - muteStarted;
        const mutedGain = audio.masterBus.gain.value;
        const unmuteStarted = performance.now();
        audio.setMuted(false);
        const expectedMaster = audio.mixDiagnostics.masterGain;
        while (
          Math.abs(audio.masterBus.gain.value - expectedMaster) > 0.005
          && performance.now() - unmuteStarted < 500
        ) {
          await wait(4);
        }
        const unmuteMilliseconds = performance.now() - unmuteStarted;
        const restoredGain = audio.masterBus.gain.value;

        fullProcessor.disconnect();
        highpass.disconnect();
        lowpass.disconnect();
        bandProcessor.disconnect();
        silentFull.disconnect();
        silentBand.disconnect();

        const mixDiagnostics = audio.mixDiagnostics;
        audio.dispose();
        return {
          sampleRate: audioContext.sampleRate,
          mixDiagnostics,
          ambient,
          cues: cueRows,
          worstCase,
          mute: {
            muteMilliseconds,
            mutedGain,
            unmuteMilliseconds,
            restoredGain,
          },
        };

        function invokeCue(engine, name) {
          switch (name) {
            case "belt-transfer":
              engine.transfer("belt", 0, 0.35);
              break;
            case "inserter-transfer":
              engine.transfer("inserter", 0, 0.35);
              break;
            case "extraction":
              engine.extraction(0, 0.55);
              break;
            case "smelter-complete":
              engine.smelter("complete", 0, 0.5);
              break;
            case "fabricator-arc":
              engine.fabricator("arc", 0, 0.45);
              break;
            case "fabricator-complete":
              engine.fabricator("complete", 0, 0.45);
              break;
            case "placed":
              engine.placed(0, 1);
              break;
            case "removed":
              engine.removed(0, 1);
              break;
            case "rotate":
              engine.rotate(0);
              break;
            case "error":
              engine.error(0);
              break;
            case "complete":
              engine.complete(0);
              break;
            default:
              throw new Error(`Unknown audio QA cue: ${name}`);
          }
        }

        function analyze(left, right, bandLeft, bandRight, sampleRate) {
          const frameCount = Math.min(left.length, right.length);
          let peak = 0;
          let sampleSum = 0;
          let finite = true;
          let clippedSamples = 0;
          for (let index = 0; index < frameCount; index += 1) {
            const samples = [left[index], right[index]];
            for (const sample of samples) {
              if (!Number.isFinite(sample)) finite = false;
              const magnitude = Math.abs(sample);
              peak = Math.max(peak, magnitude);
              sampleSum += sample * sample;
              if (magnitude >= thresholds.maximumSampleMagnitude) clippedSamples += 1;
            }
          }
          const rms = Math.sqrt(sampleSum / Math.max(1, frameCount * 2));
          // Measure active loudness from short-time energy, not the interval
          // between the first and last sample over a tiny peak-relative
          // threshold. The old interval expanded when a quiet procedural
          // noise tail crossed that threshold, even though cue energy and
          // audibility were unchanged. Five-millisecond frames within 14 dB
          // of the strongest frame form a stable, repeatable active region.
          const activeFrameSize = Math.max(1, Math.round(sampleRate * 0.005));
          const activeFrames = [];
          let maximumFrameRms = 0;
          for (let start = 0; start < frameCount; start += activeFrameSize) {
            const end = Math.min(frameCount, start + activeFrameSize);
            let frameSum = 0;
            for (let index = start; index < end; index += 1) {
              frameSum += left[index] * left[index] + right[index] * right[index];
            }
            const sampleCount = Math.max(1, (end - start) * 2);
            const frameRms = Math.sqrt(frameSum / sampleCount);
            maximumFrameRms = Math.max(maximumFrameRms, frameRms);
            activeFrames.push({ frameSum, sampleCount, frameRms });
          }
          const activeGate = maximumFrameRms * 0.2;
          let activeSum = 0;
          let activeCount = 0;
          for (const frame of activeFrames) {
            if (frame.frameRms + Number.EPSILON < activeGate) continue;
            activeSum += frame.frameSum;
            activeCount += frame.sampleCount;
          }
          const activeRms = Math.sqrt(activeSum / Math.max(1, activeCount));
          const bandFrames = Math.min(bandLeft.length, bandRight.length);
          let bandSum = 0;
          for (let index = 0; index < bandFrames; index += 1) {
            bandSum += bandLeft[index] * bandLeft[index]
              + bandRight[index] * bandRight[index];
          }
          const bandRms = Math.sqrt(bandSum / Math.max(1, bandFrames * 2));
          return {
            frames: frameCount,
            finite,
            clippedSamples,
            peak,
            peakDecibels: decibels(peak),
            rms,
            rmsDecibels: decibels(rms),
            activeRms,
            activeRmsDecibels: decibels(activeRms),
            activeMilliseconds: (activeCount / 2 / sampleRate) * 1_000,
            usefulBandRms: bandRms,
            usefulBandRmsDecibels: decibels(bandRms),
            usefulBandRatioDecibels: decibels(bandRms / Math.max(rms, 1e-12)),
          };
        }

        function summarizeMeasurements(rows) {
          const summary = {};
          for (const key of [
            "frames",
            "peak",
            "peakDecibels",
            "rms",
            "rmsDecibels",
            "activeRms",
            "activeRmsDecibels",
            "activeMilliseconds",
            "usefulBandRms",
            "usefulBandRmsDecibels",
            "usefulBandRatioDecibels",
          ]) {
            const values = rows.map((row) => row[key]).sort((leftValue, rightValue) => leftValue - rightValue);
            summary[key] = values[Math.floor(values.length / 2)];
          }
          summary.finite = rows.every((row) => row.finite);
          summary.clippedSamples = rows.reduce(
            (total, row) => total + row.clippedSamples,
            0,
          );
          return summary;
        }

        function decibels(value) {
          return 20 * Math.log10(Math.max(value, 1e-12));
        }

        function wait(milliseconds) {
          return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
        }
      },
      { cues: AUDIO_CUES, thresholds: AUDIO_THRESHOLDS },
    );

    const audioEntry = {
      beforeGesture,
      activation: {
        firstCueProbeInstalled: firstCueProbe,
        unlockMilliseconds: round(unlockMilliseconds),
        firstCueMilliseconds: round(activationTiming.firstCueMilliseconds),
        firstCueRendered,
        resumeMilliseconds: round(resumeMilliseconds),
        driverUnlockMilliseconds: round(driverUnlockMilliseconds),
        driverResumeMilliseconds: round(driverResumeMilliseconds),
      },
      ...measurements,
      failures: [],
    };

    audioCheck(
      audioEntry,
      rootReport,
      beforeGesture.supported,
      "Web Audio is not supported in the production browser.",
    );
    audioCheck(
      audioEntry,
      rootReport,
      !beforeGesture.ready && beforeGesture.contextState === null,
      `Audio graph started before user activation (${JSON.stringify(beforeGesture)}).`,
    );
    audioCheck(
      audioEntry,
      rootReport,
      unlockMilliseconds <= AUDIO_THRESHOLDS.unlockMilliseconds,
      `Audio unlock took ${round(unlockMilliseconds)}ms; requires <=${AUDIO_THRESHOLDS.unlockMilliseconds}ms.`,
    );
    audioCheck(
      audioEntry,
      rootReport,
      firstCueRendered
        && activationTiming.firstCueMilliseconds
          <= AUDIO_THRESHOLDS.unlockMilliseconds,
      `The cue requested on the first activation gesture rendered in ${round(activationTiming.firstCueMilliseconds)}ms; requires <=${AUDIO_THRESHOLDS.unlockMilliseconds}ms.`,
    );
    audioCheck(
      audioEntry,
      rootReport,
      resumeMilliseconds <= AUDIO_THRESHOLDS.unlockMilliseconds,
      `Suspended audio recovery took ${round(resumeMilliseconds)}ms; requires <=${AUDIO_THRESHOLDS.unlockMilliseconds}ms.`,
    );

    for (const cue of audioEntry.cues) {
      cue.ambientSeparationDecibels =
        cue.activeRmsDecibels - audioEntry.ambient.rmsDecibels;
      const limits = AUDIO_THRESHOLDS[cue.group];
      audioCheck(
        audioEntry,
        rootReport,
        cue.repetitions.length === 3,
        `${cue.name} has ${cue.repetitions.length} measurements; requires 3.`,
      );
      for (const [index, measurement] of cue.repetitions.entries()) {
        measurement.ambientSeparationDecibels =
          measurement.activeRmsDecibels - audioEntry.ambient.rmsDecibels;
        const label = `${cue.name} repetition ${index + 1}`;
        audioCheck(
          audioEntry,
          rootReport,
          measurement.peakDecibels >= limits.minimumPeakDecibels
            && measurement.peakDecibels <= limits.maximumPeakDecibels,
          `${label} peak ${round(measurement.peakDecibels)} dBFS is outside ${limits.minimumPeakDecibels}..${limits.maximumPeakDecibels} dBFS.`,
        );
        audioCheck(
          audioEntry,
          rootReport,
          measurement.activeRmsDecibels >= limits.minimumActiveRmsDecibels
            && measurement.activeRmsDecibels <= limits.maximumActiveRmsDecibels,
          `${label} active RMS ${round(measurement.activeRmsDecibels)} dBFS is outside ${limits.minimumActiveRmsDecibels}..${limits.maximumActiveRmsDecibels} dBFS.`,
        );
        audioCheck(
          audioEntry,
          rootReport,
          measurement.ambientSeparationDecibels
            >= limits.minimumAmbientSeparationDecibels,
          `${label} is only ${round(measurement.ambientSeparationDecibels)}dB above ambient RMS; requires >=${limits.minimumAmbientSeparationDecibels}dB.`,
        );
        audioCheck(
          audioEntry,
          rootReport,
          measurement.usefulBandRatioDecibels
            >= AUDIO_THRESHOLDS.minimumUsefulBandRatioDecibels,
          `${label} has insufficient 250Hz–4kHz energy (${round(measurement.usefulBandRatioDecibels)}dB relative).`,
        );
        audioCheck(
          audioEntry,
          rootReport,
          measurement.finite && measurement.clippedSamples === 0,
          `${label} produced non-finite or clipped samples.`,
        );
      }
    }

    const theoreticalPeak = audioEntry.mixDiagnostics.maximumOutputPeakDecibels;
    audioCheck(
      audioEntry,
      rootReport,
      theoreticalPeak <= AUDIO_THRESHOLDS.maximumOutputPeakDecibels,
      `Theoretical output ceiling is ${round(theoreticalPeak)} dBFS; requires <=${AUDIO_THRESHOLDS.maximumOutputPeakDecibels} dBFS.`,
    );
    audioCheck(
      audioEntry,
      rootReport,
      audioEntry.worstCase.peakDecibels
        <= AUDIO_THRESHOLDS.maximumOutputPeakDecibels,
      `Representative mix peak is ${round(audioEntry.worstCase.peakDecibels)} dBFS; requires <=${AUDIO_THRESHOLDS.maximumOutputPeakDecibels} dBFS.`,
    );
    audioCheck(
      audioEntry,
      rootReport,
      audioEntry.worstCase.finite
        && audioEntry.worstCase.clippedSamples === 0,
      "Representative mix produced non-finite or clipped samples.",
    );
    audioCheck(
      audioEntry,
      rootReport,
      audioEntry.mute.muteMilliseconds <= AUDIO_THRESHOLDS.muteMilliseconds
        && audioEntry.mute.mutedGain <= 0.001,
      `Mute took ${round(audioEntry.mute.muteMilliseconds)}ms and ended at ${audioEntry.mute.mutedGain}; requires <=${AUDIO_THRESHOLDS.muteMilliseconds}ms and <=0.001.`,
    );
    audioCheck(
      audioEntry,
      rootReport,
      audioEntry.mute.unmuteMilliseconds <= AUDIO_THRESHOLDS.unmuteMilliseconds
        && Math.abs(
          audioEntry.mute.restoredGain
            - audioEntry.mixDiagnostics.masterGain,
        ) <= 0.005,
      `Unmute took ${round(audioEntry.mute.unmuteMilliseconds)}ms and restored ${audioEntry.mute.restoredGain}; requires <=${AUDIO_THRESHOLDS.unmuteMilliseconds}ms.`,
    );

    return audioEntry;
  } finally {
    await context.close();
  }
}

function failState(entry, state, message) {
  state.failures.push(message);
  entry.failures.push(message);
  report.failures.push(message);
}

function record(entry, rootReport, condition, message) {
  if (condition) return;
  entry.failures.push(message);
  rootReport.failures.push(message);
}

function audioCheck(entry, rootReport, condition, message) {
  if (condition) return;
  entry.failures.push(message);
  rootReport.failures.push(message);
}

function watchPage(page, rootReport, label) {
  page.on("pageerror", (error) => {
    rootReport.console.errors.push(`${label}: pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      rootReport.console.errors.push(`${label}: console: ${message.text()}`);
    }
    if (message.type() === "warning") {
      rootReport.console.warnings.push(`${label}: ${message.text()}`);
    }
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (url.includes("fonts.googleapis.com") || url.includes("fonts.gstatic.com")) {
      return;
    }
    rootReport.console.errors.push(
      `${label}: requestfailed: ${url} — ${request.failure()?.errorText ?? "unknown"}`,
    );
  });
}

function round(value) {
  return Math.round(value * 100) / 100;
}
