import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { chromium } from "playwright";

const BASE_URL = (process.env.CINDERLINE_URL ?? "http://127.0.0.1:4197")
  .replace(/\/$/, "");
const OUTPUT_DIRECTORY = process.env.CINDERLINE_M1_OUTPUT
  ?? ".qa/m1-browser-qa/iteration-01";
const FORMATIVE_DEV_OPT_OUT = process.env.CINDERLINE_ALLOW_FORMATIVE_DEV === "1";
const REQUIRE_PRODUCTION = !FORMATIVE_DEV_OPT_OUT;
const DESKTOP_VIEWPORT = { width: 1920, height: 1080 };
const SAVE_KEY = "cinderline.autosave.v6";
let desktopPhase2SaveBytes = null;
const REQUIREMENTS = Object.freeze({
  ironPlate: 24,
  copperPlate: 12,
  stoneBrick: 12,
});
const COSTS = Object.freeze({
  belt: 2,
  extractor: 15,
  fabricator: 50,
  inserter: 8,
  smelter: 30,
  gridRelay: 12,
});
const DIRECTION = Object.freeze({ North: 0, East: 1, South: 2, West: 3 });

// The accepted route uses the rail district's west gap at x7 for stone raw
// cargo, processes brick above the tracks, and merges finished brick at x19.
// Iron descends directly at x15. The result is 33 belts and an exact 208-alloy
// paid loop without crossing rail occupancy or changing any custody rule.
const PAID_ROUTE = Object.freeze([
  { label: "iron-output", kind: "inserter", x: 14, y: 5, direction: DIRECTION.East },

  { label: "copper-extractor", kind: "extractor", x: 5, y: 12, direction: DIRECTION.East },
  ...range(7, 10).map((x) => ({
    label: `copper-raw-${x}`,
    kind: "belt",
    x,
    y: 12,
    direction: DIRECTION.East,
  })),
  { label: "copper-input", kind: "inserter", x: 11, y: 12, direction: DIRECTION.East },
  {
    label: "copper-smelter",
    kind: "smelter",
    x: 12,
    y: 11,
    direction: DIRECTION.East,
    recipeId: "smeltCopper",
  },
  { label: "copper-output", kind: "inserter", x: 14, y: 12, direction: DIRECTION.East },
  ...range(15, 21).map((x) => ({
    label: `shared-east-${x}`,
    kind: "belt",
    x,
    y: 12,
    direction: DIRECTION.East,
  })),

  { label: "stone-relay", kind: "gridRelay", x: 9, y: 15, direction: DIRECTION.East },
  { label: "stone-extractor", kind: "extractor", x: 5, y: 19, direction: DIRECTION.East },
  { label: "stone-input", kind: "inserter", x: 8, y: 14, direction: DIRECTION.East },
  {
    label: "stone-smelter",
    kind: "smelter",
    x: 9,
    y: 13,
    direction: DIRECTION.East,
    recipeId: "fireBrick",
  },
  { label: "stone-output", kind: "inserter", x: 11, y: 14, direction: DIRECTION.East },
  ...range(12, 18).map((x) => ({
    label: `stone-finished-${x}`,
    kind: "belt",
    x,
    y: 14,
    direction: DIRECTION.East,
  })),

  ...range(5, 11).map((y) => ({
    label: `iron-descent-${y}`,
    kind: "belt",
    x: 15,
    y,
    direction: DIRECTION.South,
  })),
  ...rangeDescending(19, 14).map((y) => ({
    label: `stone-raw-ascent-${y}`,
    kind: "belt",
    x: 7,
    y,
    direction: DIRECTION.North,
  })),
  { label: "stone-turn", kind: "belt", x: 19, y: 14, direction: DIRECTION.North },
  { label: "stone-merge", kind: "belt", x: 19, y: 13, direction: DIRECTION.North },
]);

// Phase 2 spends more alloy than remained before Bootstrap, so this route is
// also a causal proof that the commission reward is usable. The westbound
// coal spur continuously fuels the original generator. One switchable
// fabricator then diverts finished Phase-1 plate from the shared trunk and
// returns its products to the existing surveyed Uplink dock.
const PHASE2_COAL_ROUTE = Object.freeze([
  { label: "phase2-coal-relay", kind: "gridRelay", x: 22, y: 6, direction: DIRECTION.West },
  { label: "phase2-coal-extractor", kind: "extractor", x: 24, y: 4, direction: DIRECTION.West },
  ...rangeDescending(23, 21).map((x) => ({
    label: `phase2-coal-belt-${x}`,
    kind: "belt",
    x,
    y: 4,
    direction: DIRECTION.West,
  })),
  { label: "phase2-coal-loader", kind: "inserter", x: 20, y: 4, direction: DIRECTION.West },
]);

const PHASE2_PRODUCT_ROUTE = Object.freeze([
  {
    label: "phase2-fabricator",
    kind: "fabricator",
    x: 16,
    y: 9,
    direction: DIRECTION.North,
    recipeId: "ironGear",
  },
  { label: "phase2-plate-input", kind: "inserter", x: 17, y: 11, direction: DIRECTION.North },
  { label: "phase2-product-output", kind: "inserter", x: 17, y: 8, direction: DIRECTION.North },
  ...range(17, 20).map((x) => ({
    label: `phase2-product-east-${x}`,
    kind: "belt",
    x,
    y: 7,
    direction: DIRECTION.East,
  })),
  { label: "phase2-product-turn", kind: "belt", x: 21, y: 7, direction: DIRECTION.South },
  ...range(8, 11).map((y) => ({
    label: `phase2-product-south-${y}`,
    kind: "belt",
    x: 21,
    y,
    direction: DIRECTION.South,
  })),
]);

const PHASE2_ROUTE = Object.freeze([
  ...PHASE2_COAL_ROUTE,
  ...PHASE2_PRODUCT_ROUTE,
]);

const expectedSpend = PAID_ROUTE.reduce(
  (total, placement) => total + COSTS[placement.kind],
  0,
);
assert(expectedSpend === 208, `Route arithmetic is ${expectedSpend}, expected 208.`);
assert(
  PAID_ROUTE.filter((placement) => placement.x === 16 && placement.y === 12)
    .length === 1,
  "The shared x16,y12 belt must be placed exactly once.",
);
const expectedPhase2CoalSpend = PHASE2_COAL_ROUTE.reduce(
  (total, placement) => total + COSTS[placement.kind],
  0,
);
const expectedPhase2ProductSpend = PHASE2_PRODUCT_ROUTE.reduce(
  (total, placement) => total + COSTS[placement.kind],
  0,
);
const expectedPhase2Spend = expectedPhase2CoalSpend + expectedPhase2ProductSpend;
assert(expectedPhase2CoalSpend === 41, `Phase-2 coal route arithmetic is ${expectedPhase2CoalSpend}, expected 41.`);
assert(expectedPhase2ProductSpend === 84, `Phase-2 product route arithmetic is ${expectedPhase2ProductSpend}, expected 84.`);
assert(expectedPhase2Spend === 125, `Phase-2 route arithmetic is ${expectedPhase2Spend}, expected 125.`);
assert(PHASE2_ROUTE.length === 18, `Phase-2 route has ${PHASE2_ROUTE.length} entities, expected 18.`);

await prepareOutputDirectory(OUTPUT_DIRECTORY);
const source = await fingerprintSources();
const served = await inspectServedBuild(BASE_URL);
if (REQUIRE_PRODUCTION) {
  assert(served.mode === "vite-production-preview", `Sealed proof requires production preview, received ${served.mode}.`);
  assert(served.localDistMatches, "Served production assets do not match the local dist tree.");
}
const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = {
  schema: "cinderline-m1-browser-qa",
  version: 1,
  status: "running",
  baseURL: BASE_URL,
  build: served,
  productionRequired: REQUIRE_PRODUCTION,
  formativeDevelopmentOptOut: FORMATIVE_DEV_OPT_OUT,
  source,
  stability: null,
  outputDirectory: OUTPUT_DIRECTORY,
  eventObservation: {
    mode: "copy-returned-frame-drain-array",
    callsDrainEventsDirectly: false,
    changesReturnedArray: false,
    instrumentationMutatesDrainMethodReference: true,
    mutatesSimulationState: false,
  },
  authorizedAcceleration: {
    method: "window.__CINDERLINE__.simulation.step(integerTicks)",
    normalAnimationFramesBetweenBatches: true,
    directPlacement: false,
    directCargoInjection: false,
    generatorCoalInjection: false,
    cameraFraming:
      "Public renderer.focus changes view only to expose a target cell; every construction, inspection, and action still uses a real mouse or touchscreen event.",
  },
  desktop: null,
  mobile: null,
  storageDenial: null,
  sessionRecovery: null,
  artifacts: [],
};

try {
  report.desktop = await runDesktopPlaythrough(browser, report);
  // Mobile and storage-denial lanes are added after the paid desktop route is
  // empirically proven; keeping this call boundary makes failures readable.
  report.mobile = await runMobileProofs(browser, report);
  report.storageDenial = await runStorageDenialProof(browser, report);
  report.sessionRecovery = await runSessionRecoveryProof(browser, report);
  const endingSource = await fingerprintSources();
  const endingBuild = await inspectServedBuild(BASE_URL);
  report.stability = {
    sourceStartDigest: source.digest,
    sourceEndDigest: endingSource.digest,
    sourceStable: endingSource.digest === source.digest,
    servedBuildStartDigest: served.digest,
    servedBuildEndDigest: endingBuild.digest,
    servedBuildStable: endingBuild.digest === served.digest,
    endingSource,
    endingBuild,
  };
  assert(report.stability.sourceStable, "Source tree changed during the browser proof; artifacts are not sealable.");
  assert(report.stability.servedBuildStable, "Served build changed during the browser proof; artifacts are not sealable.");
  if (REQUIRE_PRODUCTION) assert(endingBuild.localDistMatches, "Ending production assets no longer match dist.");
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
  throw error;
} finally {
  await browser.close();
  await writeJson("m1-browser-report.json", report);
}

await writeJson("m1-playthrough.json", report.desktop);
await writeJson("m1-events.json", {
  sourceDigest: source.digest,
  observer: report.eventObservation,
  events: report.desktop?.events ?? [],
});
await writeJson("m1-phase2-events.json", {
  sourceDigest: source.digest,
  observer: report.eventObservation,
  proof: report.desktop?.phase2?.eventProof ?? null,
  events: report.desktop?.phase2?.events ?? [],
});
await writeJson("m1-mobile.json", {
  sourceDigest: source.digest,
  proofs: report.mobile,
});
await writeJson("m1-storage-denial.json", {
  sourceDigest: source.digest,
  proof: report.storageDenial,
});
await writeJson("m1-session-recovery.json", {
  sourceDigest: source.digest,
  proof: report.sessionRecovery,
});
report.artifacts = await artifactRecords(
  OUTPUT_DIRECTORY,
  ["artifact-manifest.json", "m1-browser-report.json"],
);
await writeJson("m1-browser-report.json", report);
const manifest = {
  schema: "cinderline-m1-artifact-manifest",
  version: 1,
  sourceDigest: source.digest,
  baseURL: BASE_URL,
  buildMode: served.mode,
  artifacts: await artifactRecords(OUTPUT_DIRECTORY, ["artifact-manifest.json"]),
};
await writeJson("artifact-manifest.json", manifest);
process.stdout.write(`${JSON.stringify({
  ok: true,
  sourceDigest: source.digest,
  buildMode: served.mode,
  outputDirectory: OUTPUT_DIRECTORY,
  alloy: report.desktop?.economy,
  manifest: report.desktop?.manifestReady?.inventory,
  mobile: report.mobile?.map((entry) => entry.viewport),
  storageDenial: report.storageDenial?.session,
}, null, 2)}\n`);

async function runDesktopPlaythrough(browserInstance, rootReport) {
  const context = await browserInstance.newContext({
    viewport: DESKTOP_VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const diagnostics = observePage(page, "desktop-normal");
  const screenshots = [];
  try {
    await gotoGame(page, `${BASE_URL}/?fresh=m1-desktop`);
    await installEventObserver(page);
    const initial = await readGameState(page);
    assert(initial.alloy === 240, `Fresh alloy is ${initial.alloy}, expected 240.`);
    assert(initial.stats.entityCount === 11, "Fresh campaign is not the untouched 11-entity start.");
    assert(initial.stats.entityCounts.belt === 4, "Starter iron handoff is not incomplete.");
    assert(initial.stats.entityCounts.extractor === 1, "Starter campaign does not have one granted extractor.");
    assert(initial.uplinkInventory.entries.length === 0, "Fresh Uplink is not empty.");
    assert(initial.progression.selectedCommissionId === "bootstrap", "Bootstrap is not selected.");
    assert(initial.ledger.every((entry) => entry.provenance.source === "granted"), "Fresh ledger contains paid construction.");
    const onboarding = await readOnboarding(page);
    assert(
      onboarding.text.includes("smelter output")
        && onboarding.text.includes("inserter")
        && onboarding.text.includes("pulsing cyan DOCK")
        && onboarding.text.includes("X21 Z12")
        && onboarding.text.includes("auto-aligns eastbound"),
      "Onboarding omits the starter handoff.",
    );
    assert(onboarding.text.includes("Copper plate"), "Onboarding omits copper.");
    assert(onboarding.text.includes("Fire brick"), "Onboarding omits masonry.");
    const onboardingKinds = new Set(onboarding.buildCards.map((card) => card.kind));
    for (const kind of ["belt", "extractor", "inserter", "smelter", "gridRelay"]) {
      assert(onboardingKinds.has(kind), `Onboarding build palette omits ${kind}.`);
    }
    assert(onboarding.buildCards.every((card) => card.label), "An onboarding build card lacks an accessible label.");
    const onboardingPower = (onboarding.powerText ?? "").match(/^(\d+(?:\.\d+)?) \/ (\d+(?:\.\d+)?)$/);
    assert(
      onboardingPower
        && Number(onboardingPower[1]) > 0
        && Number(onboardingPower[2]) > 0,
      `Onboarding power telemetry is not visibly energized: ${onboarding.powerText}.`,
    );
    assert(
      onboarding.powerPanelText?.includes("Grid supply") && onboarding.powerPanelText.includes("MW"),
      `Onboarding does not label grid supply and units: ${onboarding.powerPanelText}.`,
    );
    const saveLabel = onboarding.saveLabel?.toLowerCase() ?? "";
    const helpLabel = onboarding.helpLabel?.toLowerCase() ?? "";
    assert(saveLabel.includes("save") && saveLabel.includes("campaign"), "Onboarding save control lacks save/campaign semantics.");
    assert(helpLabel.includes("field") && helpLabel.includes("manual"), "Onboarding field-manual control lacks accessible semantics.");
    screenshots.push(await screenshot(page, "desktop-01-fresh.png"));

    const construction = [];
    let selectedDirection = DIRECTION.East;
    for (const placement of PAID_ROUTE) {
      selectedDirection = await orientTool(page, selectedDirection, placement.direction);
      const receipt = await placeThroughHud(page, placement);
      construction.push(receipt);
      if (placement.recipeId) {
        receipt.recipe = await chooseRecipeThroughHud(
          page,
          receipt.entityId,
          placement.recipeId,
        );
      }
    }

    const built = await readGameState(page);
    assert(built.alloy === 32, `Paid route left ${built.alloy} alloy, expected 32.`);
    assert(built.stats.entityCount === 54, `Paid route has ${built.stats.entityCount} entities, expected 54.`);
    const paidLedger = built.ledger.filter((entry) => entry.provenance.source === "paid");
    const paidLedgerCost = paidLedger.reduce(
      (total, entry) => total + entry.provenance.paidCost,
      0,
    );
    assert(paidLedger.length === 43, `Paid ledger has ${paidLedger.length} entries, expected 43.`);
    assert(paidLedgerCost === 208, `Paid ledger records ${paidLedgerCost}, expected 208.`);
    assertRouteMatchesWorld(built.entities);
    assert(
      built.entities.find((entity) => entity.x === 12 && entity.y === 11)?.recipeId === "smeltCopper",
      "Copper smelter recipe was not configured through the HUD.",
    );
    assert(
      built.entities.find((entity) => entity.x === 9 && entity.y === 13)?.recipeId === "fireBrick",
      "Stone smelter recipe was not configured through the HUD.",
    );
    assert(built.stats.power.capacityKW > 0, "Constructed factory has no power capacity.");
    assert(built.stats.power.satisfaction > 0.999, "Constructed factory is not fully powered.");
    const power = await readPowerProof(page, construction.map((entry) => entry.entityId));
    assert(power.unassignedPaidConsumers.length === 0, "Paid consumers are outside relay coverage.");
    await frameFactory(page, 14.5, 12.5);
    screenshots.push(await screenshot(page, "desktop-02-built.png"));

    const acceleration = [];
    const handPrimeActions = [];
    let manifestReady = await readManifestState(page);
    for (let batch = 0; batch < 420 && !manifestComplete(manifestReady.inventory); batch += 1) {
      const result = await page.evaluate((ticks) => {
        const game = window.__CINDERLINE__;
        if (!game) throw new Error("M1 bridge disappeared during acceleration.");
        const before = game.stats().tick;
        game.simulation.step(ticks);
        return { before, after: game.stats().tick };
      }, 30);
      assert(result.after - result.before === 30, "Public simulation.step did not advance exactly 30 ticks.");
      if (batch % 12 === 0) acceleration.push({ batch, ...result });
      await page.waitForTimeout(34);
      if (batch % 4 === 0) manifestReady = await readManifestState(page);
      if (batch > 0 && batch % 80 === 0 && !manifestComplete(manifestReady.inventory)) {
        const generator = await readGenerator(page);
        if (generator.status === "noFuel") {
          handPrimeActions.push(await primeGeneratorThroughHud(page));
        }
      }
    }
    manifestReady = await readManifestState(page);
    assert(manifestComplete(manifestReady.inventory), `Manifest did not complete: ${JSON.stringify(manifestReady.inventory)}.`);
    const generatorAtManifest = await readGenerator(page);
    if (generatorAtManifest?.status === "noFuel") {
      handPrimeActions.push(await primeGeneratorThroughHud(page));
      await page.waitForTimeout(120);
      const recoveredPower = await page.evaluate(() => window.__CINDERLINE__?.stats().power);
      assert(
        (recoveredPower?.capacityKW ?? 0) > 0
          && (recoveredPower?.storedFuelKJ ?? 0) > 0,
        "UI hand-prime did not restore generator capacity.",
      );
    }
    assert(handPrimeActions.length >= 1, "The playthrough never exercised actual generator hand-priming.");
    await page.waitForTimeout(260);
    const manifestUi = await readMissionUI(page);
    assert(manifestUi.submitEnabled, "Transmit manifest is not enabled at full custody.");
    assert(manifestUi.text.includes("24/24"), "Iron manifest counter is not visibly full.");
    assert(manifestUi.text.includes("12/12"), "Copper/brick manifest counters are not visibly full.");
    await frameFactory(page, 17.5, 12.8);
    screenshots.push(await screenshot(page, "desktop-03-manifest-ready.png"));

    const beforeTransmit = await readGameState(page);
    await page.locator("[data-action='commission-submit']").click();
    await page.waitForFunction(() =>
      window.__CINDERLINE__?.progression.commissions
        .find((entry) => entry.id === "bootstrap")?.completionCount === 1,
    );
    await page.waitForTimeout(140);
    const completed = await readGameState(page);
    assert(completed.alloy === 332, `Bootstrap completion left ${completed.alloy} alloy, expected 332.`);
    assert(completed.stats.entityCount === 54, "Commission completion changed construction.");
    assert(
      completed.progression.commissions.find((entry) => entry.id === "bootstrap")?.completionCount === 1,
      "Bootstrap completion record is missing.",
    );
    assert(completed.progression.unlockedBuildKinds.includes("fabricator"), "Bootstrap did not unlock fabricators.");
    await frameFactory(page, 17.5, 12.8);
    screenshots.push(await screenshot(page, "desktop-04-completed.png"));

    const phase2 = await runPhase2Throughput(page, {
      completed,
      initial,
      selectedDirection,
      screenshots,
    });
    selectedDirection = phase2.selectedDirection;

    await page.locator("#world").press("Space");
    await page.waitForFunction(() =>
      document.querySelector("[data-ref='pause-plate']")?.classList.contains("is-open"),
    );
    await page.locator("[data-action='session-toggle']").click();
    const explicitSaveAbsent = await page.evaluate((key) => {
      localStorage.removeItem(key);
      return localStorage.getItem(key) === null;
    }, SAVE_KEY);
    assert(explicitSaveAbsent, "Could not clear the current key before explicit SAVE NOW proof.");
    await page.locator("[data-action='session-save']").click();
    await page.waitForFunction((key) => localStorage.getItem(key) !== null, SAVE_KEY);
    const save = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return {
        raw,
        bytes: new TextEncoder().encode(raw).byteLength,
        version: parsed.version,
        format: parsed.format,
        entityCount: parsed.simulation?.entities?.length,
        alloy: parsed.progression?.alloy,
        bootstrapCompletion: parsed.progression?.commissions
          ?.find((entry) => entry.id === "bootstrap")?.completionCount,
        throughputCompletion: parsed.progression?.commissions
          ?.find((entry) => entry.id === "throughput")?.completionCount,
      };
    }, SAVE_KEY);
    assert(save?.version === 6 && save.format === "cinderline-session", "Explicit save is not current v6.");
    assert(
      save.entityCount === 72
        && save.alloy === 607
        && save.bootstrapCompletion === 1
        && save.throughputCompletion === 1,
      "Explicit save does not contain the completed Phase-2 factory.",
    );
    desktopPhase2SaveBytes = save.raw;
    const saveProof = {
      ...save,
      raw: undefined,
      sha256: sha256(save.raw),
      input: "actual SAVE NOW click after removing the current save key",
      keyProvenAbsentImmediatelyBeforeClick: explicitSaveAbsent,
    };
    const events = await page.evaluate(() => window.__M1_EVENT_OBSERVER__?.events ?? []);
    const observerHealth = await page.evaluate(() => {
      const capture = window.__M1_EVENT_OBSERVER__;
      return {
        installedAsActiveDrainMethod:
          window.__CINDERLINE__?.simulation.drainEvents === capture?.wrapper,
        wrapperCalls: capture?.wrapperCalls ?? 0,
        directDrainCalls: capture?.directDrainCalls ?? 0,
        capturedEvents: capture?.events.length ?? 0,
        contract: capture?.contract ?? null,
      };
    });
    assert(
      observerHealth.installedAsActiveDrainMethod
        && observerHealth.wrapperCalls > 0
        && observerHealth.directDrainCalls === 0
        && observerHealth.capturedEvents === events.length
        && events.length > 0,
      `Frame event observer lost custody: ${JSON.stringify(observerHealth)}.`,
    );
    rootReport.eventObservation.health = observerHealth;

    await page.goto(`${BASE_URL}/?m1Reload=1`, { waitUntil: "networkidle", timeout: 30_000 });
    await waitForGame(page);
    const initiallyPaused = await page.locator("[data-ref='pause-plate']")
      .evaluate((element) => element.classList.contains("is-open"));
    if (!initiallyPaused) {
      await page.locator("#world").press("Space");
      await page.waitForFunction(() =>
        document.querySelector("[data-ref='pause-plate']")?.classList.contains("is-open"),
      );
    }
    const beforeResume = await readReloadContinuation(page);
    await page.locator("#world").press("Space");
    await page.waitForFunction(() =>
      !document.querySelector("[data-ref='pause-plate']")?.classList.contains("is-open"),
    );
    await page.waitForFunction(
      ({ startingTick }) =>
        (window.__CINDERLINE__?.stats().tick ?? 0) >= startingTick + 30,
      { startingTick: beforeResume.tick },
      { timeout: 5_000 },
    );
    const afterResume = await readReloadContinuation(page);
    assert(
      afterResume.tick - beforeResume.tick >= 30
        && afterResume.power.capacityKW > 0
        && afterResume.power.satisfaction >= 0.96
        && afterResume.power.storedFuelKJ > 0
        && afterResume.generator?.status !== "noFuel"
        && afterResume.coalExtractor?.direction === DIRECTION.West
        && afterResume.coalExtractor?.status !== "noPower"
        && afterResume.coalLoader?.direction === DIRECTION.West
        && afterResume.coalLoader?.status !== "noPower",
      `Normal-RAF reload continuation lost automatic coal or loaded power: ${JSON.stringify({ beforeResume, afterResume })}.`,
    );
    await page.locator("#world").press("Space");
    await page.waitForFunction(() =>
      document.querySelector("[data-ref='pause-plate']")?.classList.contains("is-open"),
    );
    const afterRepause = await readReloadContinuation(page);
    const reloadContinuation = {
      input:
        "actual canvas Space pause, actual canvas Space resume, normal requestAnimationFrame continuation, actual canvas Space re-pause",
      directSimulationStepCalls: 0,
      initiallyPaused,
      beforeResume,
      afterResume,
      afterRepause,
      tickDelta: afterResume.tick - beforeResume.tick,
    };
    const reloaded = await readGameState(page);
    assert(reloaded.alloy === 607, "Reload did not restore post-Throughput alloy.");
    assert(reloaded.stats.entityCount === 72, "Reload did not restore the Phase-2 factory.");
    assertRouteMatchesWorld(reloaded.entities);
    assertPlacementsMatchWorld(PHASE2_ROUTE, reloaded.entities);
    assert(
      reloaded.progression.commissions.find((entry) => entry.id === "bootstrap")?.completionCount === 1,
      "Reload lost Bootstrap completion.",
    );
    assert(
      reloaded.progression.commissions.find((entry) => entry.id === "throughput")?.completionCount === 1,
      "Reload lost Throughput completion.",
    );
    const reloadedPaidLedger = reloaded.ledger.filter(
      (entry) => entry.provenance.source === "paid",
    );
    assert(
      reloadedPaidLedger.length === 61
        && reloadedPaidLedger.reduce(
          (total, entry) => total + entry.provenance.paidCost,
          0,
        ) === 333,
      "Reload lost exact paid-construction economics.",
    );
    assert(
      reloaded.entities.find(
        (entity) => entity.x === 16 && entity.y === 9,
      )?.recipeId === "copperWire",
      "Reload lost the Fabricator's player-selected copper-wire recipe.",
    );
    const reloadedGenerator = reloaded.entities.find((entity) => entity.id === reloaded.coreGeneratorEntityId);
    assert(
      reloaded.stats.power.capacityKW > 0
        && reloaded.stats.power.storedFuelKJ > 0
        && reloadedGenerator?.status !== "noFuel",
      "Reload lost the automatically fueled generator's recovered power state.",
    );
    await page.locator("[data-action='session-toggle']").click();
    const reloadSessionLabel = await page.locator("[data-ref='session-state']").innerText();
    assert(reloadSessionLabel === "CONTINUED", `Reload session label is ${reloadSessionLabel}.`);
    screenshots.push(await screenshot(page, "desktop-11-reloaded.png"));

    const eventProof = summarizeEvents(
      events,
      initial.uplinkEntityId,
      [...built.entities, ...phase2.built.entities],
    );
    for (const [item, required] of Object.entries(REQUIREMENTS)) {
      assert(
        (eventProof.uplinkTransfers[item] ?? 0) >= required,
        `Observed physical Uplink transfers for ${item} are below ${required}.`,
      );
      assert(
        (eventProof.produced[item] ?? 0) >= required,
        `Observed product events for ${item} are below ${required}.`,
      );
    }
    assertResourceProduction(initial.stats, beforeTransmit.stats);
    assertDiagnosticsClean(diagnostics, "Desktop normal lane");

    return {
      viewport: DESKTOP_VIEWPORT,
      diagnostics,
      screenshots,
      onboarding,
      initial,
      construction: {
        inputMethod: "HUD build card plus real canvas pointer click",
        acceptedRoute:
          "Iron descends at x15; stone raw crosses the west rail gap at x7, is smelted above the tracks, and finished brick merges at x19. The route contains 33 belts and costs exactly 208 alloy.",
        expectedSpend,
        receipts: construction,
        paidLedgerCount: paidLedger.length,
        paidLedgerCost,
        route: PAID_ROUTE,
      },
      built,
      power,
      acceleration,
      handPrimeActions,
      manifestReady: {
        ...manifestReady,
        ui: manifestUi,
      },
      beforeTransmit,
      completed,
      phase2,
      save: saveProof,
      reloaded,
      reloadContinuation,
      reloadSessionLabel,
      economy: {
        fresh: initial.alloy,
        afterPaidConstruction: built.alloy,
        paid: initial.alloy - built.alloy,
        bootstrapReward: completed.alloy - built.alloy,
        afterBootstrap: completed.alloy,
        phase2Paid: completed.alloy - phase2.built.state.alloy,
        beforeThroughput: phase2.beforeTransmit.alloy,
        throughputReward: phase2.completed.alloy - phase2.beforeTransmit.alloy,
        afterThroughput: phase2.completed.alloy,
      },
      eventProof,
      observerHealth,
      events,
    };
  } finally {
    await context.close();
  }
}

async function runPhase2Throughput(page, options) {
  const {
    completed,
    initial,
    screenshots,
  } = options;
  let selectedDirection = options.selectedDirection;
  const beforeSelection = await readGameState(page);
  assert(beforeSelection.alloy === 332, "Phase 2 did not begin with the earned Bootstrap reward.");
  // Bootstrap may finish with only a fraction of its last emergency coal
  // burning. Establish the same one-whole-coal black-start condition used by
  // the deterministic Phase-2 engine proof, through the real inspector action,
  // before the automatic spur exists. No manual prime is permitted after the
  // spur's first physical delivery.
  const transitionHandPrime = await primeGeneratorThroughHud(page);
  assert(
    generatorFuelEquivalent(transitionHandPrime.after) >= 1,
    "The actual transition hand-prime did not establish one whole coal equivalent.",
  );
  await page.waitForTimeout(120);
  const phase2EventStart = await page.evaluate(
    () => window.__M1_EVENT_OBSERVER__?.events.length ?? 0,
  );

  const throughputChoice = page.locator("[data-commission-id='throughput']");
  await throughputChoice.waitFor({ state: "visible", timeout: 5_000 });
  assert(!(await throughputChoice.isDisabled()), "Throughput is not available after Bootstrap.");
  await throughputChoice.click();
  await page.waitForFunction(
    () => window.__CINDERLINE__?.progression.selectedCommissionId === "throughput",
  );
  assert(
    await throughputChoice.getAttribute("aria-pressed") === "true",
    "The actual Throughput commission control did not expose selected state.",
  );
  const selectedUI = await readMissionUI(page);
  assert(
    selectedUI.text.includes("0/20") && selectedUI.text.includes("0/40"),
    `Fresh Throughput counters are not visible: ${selectedUI.text}.`,
  );

  const coalReceipts = [];
  for (const placement of PHASE2_COAL_ROUTE) {
    await armBuildTool(page, placement.kind);
    selectedDirection = await orientTool(
      page,
      selectedDirection,
      placement.direction,
    );
    coalReceipts.push(await placeThroughHud(page, placement));
  }
  const coalBuilt = await readGameState(page);
  assert(coalBuilt.alloy === 291, `Automatic coal spur left ${coalBuilt.alloy} alloy, expected 291.`);
  assert(coalBuilt.stats.entityCount === 60, `Automatic coal spur has ${coalBuilt.stats.entityCount} entities, expected 60.`);
  assertPlacementsMatchWorld(PHASE2_COAL_ROUTE, coalBuilt.entities);
  const coalExtractorId = receiptId(coalReceipts, "phase2-coal-extractor");
  const coalLoaderId = receiptId(coalReceipts, "phase2-coal-loader");
  const phase2CoalStartEvents = await readObservedEvents(page, phase2EventStart);
  const coalExtractorPlaced = phase2CoalStartEvents.find(
    (event) => event.type === "placed" && event.entityId === coalExtractorId,
  );
  assert(coalExtractorPlaced, "The coal extractor lacks its causal placement event.");

  const coalAcceleration = [];
  const coalPowerSamples = [];
  let coalEvents = phase2CoalStartEvents;
  let firstCoalProduced = findEvent(
    coalEvents,
    (event) =>
      event.type === "itemProduced"
      && event.entityId === coalExtractorId
      && event.item === "coal",
  );
  let firstGeneratorDelivery = findEvent(
    coalEvents,
    (event) =>
      event.type === "itemTransferred"
      && event.entityId === initial.coreGeneratorEntityId
      && event.item === "coal"
      && event.tick >= coalExtractorPlaced.tick,
  );
  let coalRuntime = await readPhase2Runtime(page, {
    fabricatorId: null,
    coalExtractorId,
    coalLoaderId,
  });
  let fuelAtFirstDelivery = null;
  if (firstGeneratorDelivery) {
    fuelAtFirstDelivery = coalRuntime.stats.power.storedFuelKJ;
  }
  for (let batch = 0; batch < 96; batch += 1) {
    const reserveEstablished =
      firstCoalProduced
      && firstGeneratorDelivery
      && coalRuntime.stats.tick - coalExtractorPlaced.tick >= 20 * 60
      && (coalRuntime.stats.produced.coal ?? 0) - (completed.stats.produced.coal ?? 0) >= 8
      && generatorFuelEquivalent(coalRuntime.generator) >= 4;
    if (reserveEstablished) break;
    const step = await stepPublicSimulation(page, 15);
    if (batch % 4 === 0) coalAcceleration.push({ batch, ...step });
    await page.waitForTimeout(34);
    coalRuntime = await readPhase2Runtime(page, {
      fabricatorId: null,
      coalExtractorId,
      coalLoaderId,
    });
    assert(
      coalRuntime.stats.power.capacityKW > 0
        && coalRuntime.generator?.status !== "noFuel",
      `Generator exhausted before automatic coal recovery: ${JSON.stringify(coalRuntime)}.`,
    );
    coalPowerSamples.push(powerSample(coalRuntime));
    coalEvents = await readObservedEvents(page, phase2EventStart);
    firstCoalProduced ??= findEvent(
      coalEvents,
      (event) =>
        event.type === "itemProduced"
        && event.entityId === coalExtractorId
        && event.item === "coal",
    );
    const discoveredDelivery = findEvent(
      coalEvents,
      (event) =>
        event.type === "itemTransferred"
        && event.entityId === initial.coreGeneratorEntityId
        && event.item === "coal"
        && event.tick >= coalExtractorPlaced.tick,
    );
    if (!firstGeneratorDelivery && discoveredDelivery) {
      firstGeneratorDelivery = discoveredDelivery;
      fuelAtFirstDelivery = coalRuntime.stats.power.storedFuelKJ;
    }
  }
  assert(firstCoalProduced, "The paid coal extractor never physically produced coal.");
  assert(firstGeneratorDelivery, "The paid coal spur never physically delivered coal to the generator.");
  const firstCoalDeliverySeconds =
    (firstGeneratorDelivery.tick - coalExtractorPlaced.tick) / 60;
  assert(
    firstCoalDeliverySeconds > 0 && firstCoalDeliverySeconds <= 8,
    `First automatic coal delivery took ${firstCoalDeliverySeconds.toFixed(2)} seconds, expected the short-spur startup window.`,
  );
  assert(
    coalRuntime.stats.tick - coalExtractorPlaced.tick >= 20 * 60
      && (coalRuntime.stats.produced.coal ?? 0) - (completed.stats.produced.coal ?? 0) >= 8
      && generatorFuelEquivalent(coalRuntime.generator) >= 4,
    "Coal-first staging did not establish a durable reserve before adding the Fabricator cell.",
  );
  assert(
    fuelAtFirstDelivery === null
      || coalRuntime.stats.power.storedFuelKJ > fuelAtFirstDelivery,
    "Automatic coal staging did not grow stored fuel after the first delivery.",
  );
  await frameFactory(page, 22.5, 4.8);
  screenshots.push(await screenshot(page, "desktop-05-phase2-coal-online.png"));

  const productReceipts = [];
  let emptyFabricator = null;
  let ironGearRecipe = null;
  for (const placement of PHASE2_PRODUCT_ROUTE) {
    await armBuildTool(page, placement.kind);
    selectedDirection = await orientTool(
      page,
      selectedDirection,
      placement.direction,
    );
    const receipt = await placeThroughHud(page, placement);
    productReceipts.push(receipt);
    if (placement.recipeId) {
      ironGearRecipe = await chooseRecipeThroughHud(
        page,
        receipt.entityId,
        placement.recipeId,
      );
      emptyFabricator = await page.evaluate((entityId) => {
        const machine = window.__CINDERLINE__?.simulation.getEntity(entityId);
        return machine ? JSON.parse(JSON.stringify(machine)) : null;
      }, receipt.entityId);
    }
  }
  const phase2BuiltState = await readGameState(page);
  assert(phase2BuiltState.alloy === 207, `Phase-2 construction left ${phase2BuiltState.alloy} alloy, expected 207.`);
  assert(phase2BuiltState.stats.entityCount === 72, `Phase-2 factory has ${phase2BuiltState.stats.entityCount} entities, expected 72.`);
  assertRouteMatchesWorld(phase2BuiltState.entities);
  assertPlacementsMatchWorld(PHASE2_ROUTE, phase2BuiltState.entities);
  const paidLedger = phase2BuiltState.ledger.filter(
    (entry) => entry.provenance.source === "paid",
  );
  const paidLedgerCost = paidLedger.reduce(
    (total, entry) => total + entry.provenance.paidCost,
    0,
  );
  assert(paidLedger.length === 61, `Phase-2 paid ledger has ${paidLedger.length} entries, expected 61.`);
  assert(paidLedgerCost === 333, `Phase-2 paid ledger records ${paidLedgerCost}, expected 333.`);
  assert(
    emptyFabricator
      && inventoryTotal(emptyFabricator.input) === 0
      && inventoryTotal(emptyFabricator.output) === 0
      && emptyFabricator.recipeId === "ironGear",
    `The newly configured Fabricator was not an empty, HUD-selected iron-gear machine: ${JSON.stringify(emptyFabricator)}.`,
  );
  const fabricatorId = receiptId(productReceipts, "phase2-fabricator");
  const plateInputId = receiptId(productReceipts, "phase2-plate-input");
  const productOutputId = receiptId(productReceipts, "phase2-product-output");
  const firstProductBeltId = receiptId(productReceipts, "phase2-product-east-17");
  const dockBeltId = phase2BuiltState.entities.find(
    (entity) => entity.kind === "belt" && entity.x === 21 && entity.y === 12,
  )?.id;
  assert(dockBeltId, "The original Commission Uplink dock belt disappeared.");
  const phase2EntityIds = [...coalReceipts, ...productReceipts]
    .map((receipt) => receipt.entityId);
  const phase2Power = await readPowerProof(page, phase2EntityIds);
  assert(
    phase2Power.unassignedPaidConsumers.length === 0
      && phase2Power.paidConsumers.every(
        (consumer) => consumer.powerSatisfaction >= 0.96,
      ),
    `A Phase-2 consumer is unassigned or below 96% satisfaction: ${JSON.stringify(phase2Power.paidConsumers)}.`,
  );
  await frameFactory(page, 18.8, 9.3);
  screenshots.push(await screenshot(page, "desktop-06-phase2-cell-built.png"));

  const acceleration = [];
  const powerSamples = [];
  let minimumCapacityKW = Number.POSITIVE_INFINITY;
  let minimumSatisfaction = Number.POSITIVE_INFINITY;
  let maximumStoredFuelKJ = coalRuntime.stats.power.storedFuelKJ;
  let runtime = await readPhase2Runtime(page, {
    fabricatorId,
    coalExtractorId,
    coalLoaderId,
    plateInputId,
    productOutputId,
    firstProductBeltId,
    dockBeltId,
  });
  const automaticFuelTick = firstGeneratorDelivery.tick;
  let gearReady = null;
  let copperWireRecipe = null;
  let recipeSwitchEventStart = null;
  for (let batch = 0; batch < 1_200; batch += 1) {
    const sustainedSeconds = (runtime.stats.tick - automaticFuelTick) / 60;
    if (
      copperWireRecipe
      && (runtime.inventory.ironGear ?? 0) >= 20
      && (runtime.inventory.copperWire ?? 0) >= 40
      && sustainedSeconds >= 180
    ) {
      break;
    }
    const step = await stepPublicSimulation(page, 30);
    if (batch % 12 === 0) acceleration.push({ batch, ...step });
    await page.waitForTimeout(34);
    runtime = await readPhase2Runtime(page, {
      fabricatorId,
      coalExtractorId,
      coalLoaderId,
      plateInputId,
      productOutputId,
      firstProductBeltId,
      dockBeltId,
    });
    minimumCapacityKW = Math.min(minimumCapacityKW, runtime.stats.power.capacityKW);
    minimumSatisfaction = Math.min(minimumSatisfaction, runtime.stats.power.satisfaction);
    maximumStoredFuelKJ = Math.max(maximumStoredFuelKJ, runtime.stats.power.storedFuelKJ);
    assert(
      runtime.stats.power.capacityKW > 0
        && runtime.stats.power.satisfaction >= 0.96
        && runtime.generator?.status !== "noFuel",
      `Automatic Phase-2 power continuity failed: ${JSON.stringify(runtime)}.`,
    );
    if (batch % 12 === 0) powerSamples.push(powerSample(runtime));

    if (!gearReady && (runtime.inventory.ironGear ?? 0) >= 20) {
      gearReady = runtime;
      await page.keyboard.press("Escape");
      await frameFactory(page, 18.8, 9.3);
      screenshots.push(await screenshot(page, "desktop-07-phase2-gears-secured.png"));
      const point = await locateCell(page, 16, 9);
      assert(point, "Could not expose the live Fabricator for its recipe switch.");
      await page.mouse.click(point.clientX, point.clientY);
      await page.locator("[data-recipe-id='copperWire']").waitFor({
        state: "visible",
        timeout: 5_000,
      });
      recipeSwitchEventStart = await page.evaluate(
        () => window.__M1_EVENT_OBSERVER__?.events.length ?? 0,
      );
      copperWireRecipe = await chooseRecipeThroughHud(
        page,
        fabricatorId,
        "copperWire",
      );
      await page.keyboard.press("Escape");
    }
  }
  runtime = await readPhase2Runtime(page, {
    fabricatorId,
    coalExtractorId,
    coalLoaderId,
    plateInputId,
    productOutputId,
    firstProductBeltId,
    dockBeltId,
  });
  const sustainedSeconds = (runtime.stats.tick - automaticFuelTick) / 60;
  assert(gearReady, "Twenty physical iron gears never reached Uplink custody.");
  assert(copperWireRecipe, "The live Fabricator was never switched to copper wire through its HUD.");
  assert(
    (runtime.inventory.ironGear ?? 0) >= 20
      && (runtime.inventory.copperWire ?? 0) >= 40,
    `Throughput cargo did not physically arrive: ${JSON.stringify(runtime.inventory)}.`,
  );
  assert(
    sustainedSeconds >= 180
      && minimumCapacityKW > 0
      && minimumSatisfaction >= 0.96
      && maximumStoredFuelKJ > (fuelAtFirstDelivery ?? 0),
    `Automatic coal did not sustain the loaded factory for 180 seconds: ${JSON.stringify({ sustainedSeconds, minimumCapacityKW, minimumSatisfaction, maximumStoredFuelKJ })}.`,
  );
  await page.waitForFunction(() => {
    const button = document.querySelector("[data-action='commission-submit']");
    const text = document.querySelector("[data-ref='mission-panel']")
      ?.textContent?.replace(/\s+/g, " ") ?? "";
    return button instanceof HTMLButtonElement
      && !button.disabled
      && text.includes("20/20")
      && text.includes("40/40");
  }, null, { timeout: 5_000 });
  const readyUI = await readMissionUI(page);
  assert(readyUI.submitEnabled, "Transmit manifest is not enabled for complete Throughput custody.");
  assert(readyUI.text.includes("20/20") && readyUI.text.includes("40/40"), `Throughput counters are not visibly full: ${readyUI.text}.`);
  await frameFactory(page, 18.8, 9.3);
  screenshots.push(await screenshot(page, "desktop-08-phase2-throughput-ready.png"));

  const visualProof = await capturePhase2VisualSequence(page, {
    fabricatorId,
    productOutputId,
    firstProductBeltId,
    screenshots,
  });
  const beforeTransmit = await readGameState(page);
  assert(beforeTransmit.alloy === 207, "Throughput readiness mutated the exact 207-alloy pre-submit economy.");
  assert(beforeTransmit.stats.entityCount === 72, "Throughput readiness changed construction.");
  assertRouteMatchesWorld(beforeTransmit.entities);
  assertPlacementsMatchWorld(PHASE2_ROUTE, beforeTransmit.entities);

  const phase2EventsBeforeSubmit = await readObservedEvents(page, phase2EventStart);
  const eventProof = summarizePhase2Events(phase2EventsBeforeSubmit, {
    coalExtractorId,
    generatorId: initial.coreGeneratorEntityId,
    fabricatorId,
    plateInputId,
    productOutputId,
    firstProductBeltId,
    uplinkEntityId: initial.uplinkEntityId,
    phase2EntityIds,
    sourceBusBeltId: phase2BuiltState.entities.find(
      (entity) => entity.kind === "belt" && entity.x === 17 && entity.y === 12,
    )?.id,
    downstreamBusBeltIds: phase2BuiltState.entities
      .filter(
        (entity) =>
          entity.kind === "belt"
          && entity.y === 12
          && entity.x >= 18
          && entity.x <= 21,
      )
      .map((entity) => entity.id),
  });
  assertPhase2EventProof(eventProof);
  const sourceProductionDelta = {
    ironPlate:
      (beforeTransmit.stats.produced.ironPlate ?? 0)
      - (completed.stats.produced.ironPlate ?? 0),
    copperPlate:
      (beforeTransmit.stats.produced.copperPlate ?? 0)
      - (completed.stats.produced.copperPlate ?? 0),
  };
  assert(
    sourceProductionDelta.ironPlate >= 40
      && sourceProductionDelta.copperPlate >= 20,
    `The unchanged Phase-1 sources did not keep producing throughout Phase 2: ${JSON.stringify(sourceProductionDelta)}.`,
  );
  assert(
    phase2EventsBeforeSubmit.every((event) => event.type !== "rotated"),
    "Phase 2 unexpectedly rotated a live belt or source entity.",
  );

  await page.locator("[data-action='commission-submit']").click();
  await page.waitForFunction(() =>
    window.__CINDERLINE__?.progression.commissions
      .find((entry) => entry.id === "throughput")?.completionCount === 1,
  );
  await page.waitForTimeout(140);
  const completedPhase2 = await readGameState(page);
  assert(completedPhase2.alloy === 607, `Throughput completion left ${completedPhase2.alloy} alloy, expected 607.`);
  assert(completedPhase2.stats.entityCount === 72, "Throughput completion changed construction.");
  assert(
    completedPhase2.progression.commissions.find(
      (entry) => entry.id === "throughput",
    )?.completionCount === 1,
    "Throughput completion record is missing.",
  );
  for (const kind of [
    "manifold",
    "fluidSource",
    "fluidPump",
    "fluidPipe",
    "fluidTank",
    "fluidProcessor",
  ]) {
    assert(
      completedPhase2.progression.unlockedBuildKinds.includes(kind),
      `Throughput did not unlock ${kind}.`,
    );
  }
  const postSubmitUI = await readMissionUI(page);
  assert(
    postSubmitUI.text.includes("Throughput transmitted")
      && postSubmitUI.text.includes("Dispatch manifolds")
      && postSubmitUI.text.includes("fluid-processing tier")
      && !postSubmitUI.text.includes("choose Throughput"),
    `Post-Throughput guidance is stale or incomplete: ${postSubmitUI.text}.`,
  );
  await frameFactory(page, 18.8, 9.3);
  screenshots.push(await screenshot(page, "desktop-10-throughput-completed.png"));
  const phase2Events = await readObservedEvents(page, phase2EventStart);

  return {
    selectedDirection,
    beforeSelection,
    selection: {
      input: "actual Throughput commission button click",
      selector: "[data-commission-id='throughput']",
      ui: selectedUI,
    },
    construction: {
      inputMethod: "HUD build card plus real canvas pointer click",
      coalRoute: PHASE2_COAL_ROUTE,
      productRoute: PHASE2_PRODUCT_ROUTE,
      expectedCoalSpend: expectedPhase2CoalSpend,
      expectedProductSpend: expectedPhase2ProductSpend,
      expectedSpend: expectedPhase2Spend,
      coalReceipts,
      productReceipts,
      paidLedgerCount: paidLedger.length,
      paidLedgerCost,
      liveEntityRotationActions: [],
      liveSourceShutdownActions: [],
    },
    automaticCoal: {
      transitionHandPrime,
      coalExtractorPlaced,
      firstCoalProduced,
      firstGeneratorDelivery,
      firstCoalDeliverySeconds,
      fuelAtFirstDeliveryKJ: fuelAtFirstDelivery,
      reserveBeforeFabricator: {
        tick: coalRuntime.stats.tick,
        producedCoalDelta:
          (coalRuntime.stats.produced.coal ?? 0)
          - (completed.stats.produced.coal ?? 0),
        storedFuelKJ: coalRuntime.stats.power.storedFuelKJ,
        generatorFuelEquivalent: generatorFuelEquivalent(coalRuntime.generator),
      },
      acceleration: coalAcceleration,
      powerSamples: coalPowerSamples,
      manualPrimeActionsAfterSpur: [],
    },
    recipes: {
      initial: ironGearRecipe,
      switch: copperWireRecipe,
      switchEventStart: recipeSwitchEventStart,
      initialEmptyFabricator: emptyFabricator,
    },
    built: {
      state: phase2BuiltState,
      entities: phase2BuiltState.entities.filter(
        (entity) => phase2EntityIds.includes(entity.id),
      ),
      power: phase2Power,
    },
    gearReady,
    manifestReady: {
      runtime,
      ui: readyUI,
    },
    powerContinuity: {
      automaticFuelTick,
      finalTick: runtime.stats.tick,
      sustainedSeconds,
      minimumCapacityKW,
      minimumSatisfaction,
      maximumStoredFuelKJ,
      samples: powerSamples,
    },
    uncongestedSidePickup: {
      sourceBelt: { x: 17, y: 12, direction: DIRECTION.East },
      downstreamBeltRange: { x: [18, 21], y: 12, direction: DIRECTION.East },
      compatibleInputTransfers: eventProof.fabricatorInputTransfers,
      downstreamUplinkCustody: {
        ironPlate: eventProof.uplinkTransfers.ironPlate,
        copperPlate: eventProof.uplinkTransfers.copperPlate,
      },
      engineInternalBeltHandoffsAreNotEvents: true,
      sourceProductionDelta,
      liveEntityRotationActions: [],
      liveSourceShutdownActions: [],
      succeededWithoutTerminatingBus: true,
    },
    acceleration,
    visualProof,
    beforeTransmit,
    completed: completedPhase2,
    postSubmitUI,
    eventProof,
    events: phase2Events,
  };
}

async function capturePhase2VisualSequence(page, options) {
  const {
    fabricatorId,
    productOutputId,
    firstProductBeltId,
    screenshots,
  } = options;
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    window.__CINDERLINE__?.dismissToasts();
    window.__CINDERLINE__?.renderer.focus(18.8, 9.3);
  });
  await page.waitForTimeout(180);
  const band = await findTouchBand(page);
  assert(band?.width > 400, `Could not find a clear native-canvas zoom band: ${JSON.stringify(band)}.`);
  const projectionBeforeZoom = await readProjection(page, band);
  assert(projectionBeforeZoom.span, "Could not measure the pre-zoom world projection.");
  await page.mouse.move((band.left + band.right) / 2, band.y);
  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(220);
  const projectionAfterZoom = await readProjection(page, band);
  assert(projectionAfterZoom.span, "Could not measure the post-zoom world projection.");
  assert(
    projectionAfterZoom.span < projectionBeforeZoom.span * 0.88,
    `Native wheel input did not produce a meaningful close camera: ${JSON.stringify({ projectionBeforeZoom, projectionAfterZoom })}.`,
  );

  const missionCollapse = page.locator("[data-action='mission-collapse']");
  let missionCollapsedForHero = false;
  if (
    await missionCollapse.isVisible()
    && await missionCollapse.getAttribute("aria-expanded") === "true"
  ) {
    await missionCollapse.click();
    missionCollapsedForHero = true;
    await page.waitForTimeout(80);
  }

  await page.waitForFunction(
    ({ machineId }) => {
      const game = window.__CINDERLINE__;
      const machine = game?.simulation.getEntity(machineId);
      return machine?.activeRecipeId === "copperWire"
        && machine.status === "working"
        && machine.progress <= 0.2;
    },
    { machineId: fabricatorId },
    { timeout: 20_000, polling: 10 },
  );
  const cycleStart = await readPhase2VisualState(
    page,
    fabricatorId,
    productOutputId,
    firstProductBeltId,
  );
  const producedAtCycleStart = cycleStart.producedCopperWire;
  const frames = [];
  const captureFrame = async (index) => {
    const state = await readPhase2VisualState(
      page,
      fabricatorId,
      productOutputId,
      firstProductBeltId,
    );
    const record = await liveScreenshot(
      page,
      `desktop-phase2-cycle-${String(index).padStart(2, "0")}.png`,
    );
    assert(
      record.width === DESKTOP_VIEWPORT.width
        && record.height === DESKTOP_VIEWPORT.height,
      `Phase-2 visual frame ${index} is not full viewport.`,
    );
    screenshots.push(record);
    frames.push({ index, state, screenshot: record });
  };

  await captureFrame(1);
  await page.waitForTimeout(45);
  await captureFrame(2);
  await page.waitForTimeout(45);
  await captureFrame(3);
  await page.waitForTimeout(45);
  await captureFrame(4);
  await page.waitForFunction(
    ({ amount }) =>
      (window.__CINDERLINE__?.stats().produced.copperWire ?? 0) >= amount,
    { amount: producedAtCycleStart + 2 },
    { timeout: 5_000, polling: 8 },
  );
  await captureFrame(5);
  await page.waitForFunction(
    ({ armId, beltId, amount }) => {
      const game = window.__CINDERLINE__;
      const arm = game?.simulation.getEntity(armId);
      const belt = game?.simulation.getEntity(beltId);
      return arm?.heldItem === "copperWire"
        || belt?.beltItems?.some((item) => item.item === "copperWire")
        || (game?.stats().produced.copperWire ?? 0) >= amount;
    },
    {
      armId: productOutputId,
      beltId: firstProductBeltId,
      amount: producedAtCycleStart + 4,
    },
    { timeout: 5_000, polling: 8 },
  );
  await captureFrame(6);
  const cycleEnd = await readPhase2VisualState(
    page,
    fabricatorId,
    productOutputId,
    firstProductBeltId,
  );
  assert(
    frames.some((frame) => frame.state.fabricator?.activeRecipeId === "copperWire")
      && cycleEnd.producedCopperWire >= producedAtCycleStart + 2,
    "The six-frame visual sequence did not cross a real copper-wire craft boundary.",
  );
  const projectionAfterSequence = await readProjection(page, band);
  assert(
    Math.abs(projectionAfterSequence.span - projectionAfterZoom.span) <= 0.25,
    "The close camera moved during the copper-wire sequence.",
  );
  const hero = await liveScreenshot(page, "desktop-09-phase2-hero.png");
  assert(
    hero.width === DESKTOP_VIEWPORT.width
      && hero.height === DESKTOP_VIEWPORT.height,
    "The Phase-2 hero is not a 1920×1080 full-viewport capture.",
  );
  screenshots.push(hero);

  if (missionCollapsedForHero) {
    await page.locator("[data-action='mission-expand']").click();
    await page.waitForTimeout(80);
  }
  return {
    method:
      "live campaign; view-only renderer focus; native canvas wheel zoom; normal requestAnimationFrame timing; no fixture or animation-state mutation",
    cssAnimationsDisabledForCapture: false,
    focus: { x: 18.8, y: 9.3 },
    wheelDeltaY: -900,
    viewport: DESKTOP_VIEWPORT,
    clearCanvasBand: band,
    projectionBeforeZoom,
    projectionAfterZoom,
    projectionAfterSequence,
    missionCollapsedThroughActualControl: missionCollapsedForHero,
    cycleStart,
    cycleEnd,
    producedAcrossSequence:
      cycleEnd.producedCopperWire - producedAtCycleStart,
    frames,
    hero,
  };
}

async function readPhase2VisualState(
  page,
  fabricatorId,
  productOutputId,
  firstProductBeltId,
) {
  return page.evaluate(({ machineId, armId, beltId }) => {
    const game = window.__CINDERLINE__;
    if (!game) throw new Error("M1 bridge is unavailable during visual capture.");
    const clone = (entity) => entity ? JSON.parse(JSON.stringify(entity)) : null;
    return {
      tick: game.stats().tick,
      producedCopperWire: game.stats().produced.copperWire ?? 0,
      fabricator: clone(game.simulation.getEntity(machineId)),
      outputInserter: clone(game.simulation.getEntity(armId)),
      firstProductBelt: clone(game.simulation.getEntity(beltId)),
    };
  }, {
    machineId: fabricatorId,
    armId: productOutputId,
    beltId: firstProductBeltId,
  });
}

async function readPhase2Runtime(page, ids) {
  return page.evaluate((entityIds) => {
    const game = window.__CINDERLINE__;
    if (!game) throw new Error("M1 bridge is unavailable during Phase 2.");
    const clone = (entity) => entity ? JSON.parse(JSON.stringify(entity)) : null;
    const entries = Object.fromEntries(
      game.uplinkInventory.entries.map((entry) => [entry.item, entry.count]),
    );
    const at = (x, y) => clone(game.simulation.getEntityAt(x, y));
    return {
      stats: JSON.parse(JSON.stringify(game.stats())),
      inventory: entries,
      generator: game.coreGeneratorEntityId === null
        ? null
        : clone(game.simulation.getEntity(game.coreGeneratorEntityId)),
      coalExtractor: entityIds.coalExtractorId === null
        ? null
        : clone(game.simulation.getEntity(entityIds.coalExtractorId)),
      coalLoader: entityIds.coalLoaderId === null
        ? null
        : clone(game.simulation.getEntity(entityIds.coalLoaderId)),
      fabricator: entityIds.fabricatorId === null
        ? null
        : clone(game.simulation.getEntity(entityIds.fabricatorId)),
      plateInput: entityIds.plateInputId
        ? clone(game.simulation.getEntity(entityIds.plateInputId))
        : null,
      productOutput: entityIds.productOutputId
        ? clone(game.simulation.getEntity(entityIds.productOutputId))
        : null,
      firstProductBelt: entityIds.firstProductBeltId
        ? clone(game.simulation.getEntity(entityIds.firstProductBeltId))
        : null,
      dockBelt: entityIds.dockBeltId
        ? clone(game.simulation.getEntity(entityIds.dockBeltId))
        : null,
      sourceBus: [17, 18, 19, 20, 21].map((x) => at(x, 12)),
      phase1Sources: [at(5, 5), at(12, 4), at(5, 12), at(12, 11)],
    };
  }, ids);
}

async function stepPublicSimulation(page, ticks) {
  const result = await page.evaluate((stepTicks) => {
    const game = window.__CINDERLINE__;
    if (!game) throw new Error("M1 bridge disappeared during acceleration.");
    const before = game.stats().tick;
    game.simulation.step(stepTicks);
    return { before, after: game.stats().tick, ticks: stepTicks };
  }, ticks);
  assert(
    result.after - result.before === ticks,
    `Public simulation.step advanced ${result.after - result.before} ticks, expected ${ticks}.`,
  );
  return result;
}

async function readObservedEvents(page, start = 0) {
  return page.evaluate((startIndex) =>
    (window.__M1_EVENT_OBSERVER__?.events ?? [])
      .slice(startIndex)
      .map((event) => JSON.parse(JSON.stringify(event))),
  start);
}

function summarizePhase2Events(events, ids) {
  const amount = (predicate) => events.reduce(
    (total, event) => total + (predicate(event) ? (event.amount ?? 0) : 0),
    0,
  );
  const index = (predicate) => events.findIndex(predicate);
  const items = ["ironPlate", "copperPlate", "ironGear", "copperWire", "coal"];
  const countsByItem = (predicate) => Object.fromEntries(
    items.map((item) => [item, amount(
      (event) => event.item === item && predicate(event),
    )]),
  );
  const downstream = new Set(ids.downstreamBusBeltIds);
  const phase2Ids = new Set(ids.phase2EntityIds);
  const placedIds = events
    .filter((event) => event.type === "placed" && phase2Ids.has(event.entityId))
    .map((event) => event.entityId);
  return {
    totalEvents: events.length,
    identities: ids,
    phase2PlacementEvents: placedIds,
    phase2PlacementEventCount: new Set(placedIds).size,
    rotationEvents: events.filter((event) => event.type === "rotated"),
    coalProduced: amount((event) =>
      event.type === "itemProduced"
      && event.entityId === ids.coalExtractorId
      && event.item === "coal"),
    coalDeliveredToGenerator: amount((event) =>
      event.type === "itemTransferred"
      && event.entityId === ids.generatorId
      && event.item === "coal"),
    fabricatorInputTransfers: countsByItem((event) =>
      event.type === "itemTransferred"
      && event.entityId === ids.fabricatorId),
    fabricatorProduction: countsByItem((event) =>
      event.type === "itemProduced"
      && event.entityId === ids.fabricatorId),
    firstProductBeltTransfers: countsByItem((event) =>
      event.type === "itemTransferred"
      && event.entityId === ids.firstProductBeltId),
    uplinkTransfers: countsByItem((event) =>
      event.type === "itemTransferred"
      && event.entityId === ids.uplinkEntityId),
    downstreamBusTransfers: countsByItem((event) =>
      event.type === "itemTransferred"
      && downstream.has(event.entityId)),
    firstEventIndex: {
      coalProduced: index((event) =>
        event.type === "itemProduced"
        && event.entityId === ids.coalExtractorId
        && event.item === "coal"),
      coalDelivered: index((event) =>
        event.type === "itemTransferred"
        && event.entityId === ids.generatorId
        && event.item === "coal"),
      ironInput: index((event) =>
        event.type === "itemTransferred"
        && event.entityId === ids.fabricatorId
        && event.item === "ironPlate"),
      ironProduced: index((event) =>
        event.type === "itemProduced"
        && event.entityId === ids.fabricatorId
        && event.item === "ironGear"),
      ironOutput: index((event) =>
        event.type === "itemTransferred"
        && event.entityId === ids.firstProductBeltId
        && event.item === "ironGear"),
      ironUplink: index((event) =>
        event.type === "itemTransferred"
        && event.entityId === ids.uplinkEntityId
        && event.item === "ironGear"),
      copperInput: index((event) =>
        event.type === "itemTransferred"
        && event.entityId === ids.fabricatorId
        && event.item === "copperPlate"),
      copperProduced: index((event) =>
        event.type === "itemProduced"
        && event.entityId === ids.fabricatorId
        && event.item === "copperWire"),
      copperOutput: index((event) =>
        event.type === "itemTransferred"
        && event.entityId === ids.firstProductBeltId
        && event.item === "copperWire"),
      copperUplink: index((event) =>
        event.type === "itemTransferred"
        && event.entityId === ids.uplinkEntityId
        && event.item === "copperWire"),
    },
  };
}

function assertPhase2EventProof(proof) {
  assert(proof.phase2PlacementEventCount === 18, "Phase 2 lacks 18 distinct causal placement events.");
  assert(proof.rotationEvents.length === 0, "Phase 2 contains an unexpected live-entity rotation event.");
  assert(proof.coalProduced >= 1, "No causal coal production event was observed.");
  assert(proof.coalDeliveredToGenerator >= 1, "No causal coal delivery to the generator was observed.");
  assert(
    proof.fabricatorInputTransfers.ironPlate >= 40
      && proof.fabricatorProduction.ironGear >= 20
      && proof.firstProductBeltTransfers.ironGear >= 20
      && proof.uplinkTransfers.ironGear >= 20,
    `Iron-gear custody chain is incomplete: ${JSON.stringify(proof)}.`,
  );
  assert(
    proof.fabricatorInputTransfers.copperPlate >= 20
      && proof.fabricatorProduction.copperWire >= 40
      && proof.firstProductBeltTransfers.copperWire >= 40
      && proof.uplinkTransfers.copperWire >= 40,
    `Copper-wire custody chain is incomplete: ${JSON.stringify(proof)}.`,
  );
  assert(
    proof.uplinkTransfers.ironPlate >= 1
      && proof.uplinkTransfers.copperPlate >= 1,
    `Post-placement Uplink custody did not prove that both plate streams traversed the live eastbound bus beyond the north-facing side pickup: ${JSON.stringify(proof.uplinkTransfers)}.`,
  );
  const first = proof.firstEventIndex;
  assert(
    first.coalProduced >= 0 && first.coalDelivered > first.coalProduced,
    "Automatic coal event order is not extractor → generator.",
  );
  assert(
    first.ironInput >= 0
      && first.ironProduced > first.ironInput
      && first.ironOutput > first.ironProduced
      && first.ironUplink > first.ironOutput,
    `Iron-gear event order is not bus → Fabricator → belt → Uplink: ${JSON.stringify(first)}.`,
  );
  assert(
    first.copperInput >= 0
      && first.copperProduced > first.copperInput
      && first.copperOutput > first.copperProduced
      && first.copperUplink > first.copperOutput,
    `Copper-wire event order is not bus → Fabricator → belt → Uplink: ${JSON.stringify(first)}.`,
  );
}

function findEvent(events, predicate) {
  return events.find(predicate) ?? null;
}

function receiptId(receipts, label) {
  const id = receipts.find((receipt) => receipt.label === label)?.entityId;
  assert(Number.isInteger(id), `Construction receipt ${label} is missing.`);
  return id;
}

function inventoryTotal(inventory) {
  return Object.values(inventory ?? {}).reduce(
    (total, count) => total + (Number.isFinite(count) ? count : 0),
    0,
  );
}

function generatorFuelEquivalent(generator) {
  return (generator?.fuel?.coal ?? 0) + (generator?.fuelEnergyKJ ?? 0) / 4_000;
}

function powerSample(runtime) {
  return {
    tick: runtime.stats.tick,
    capacityKW: runtime.stats.power.capacityKW,
    demandKW: runtime.stats.power.demandKW,
    satisfaction: runtime.stats.power.satisfaction,
    storedFuelKJ: runtime.stats.power.storedFuelKJ,
    generatorStatus: runtime.generator?.status ?? null,
    generatorFuelEquivalent: generatorFuelEquivalent(runtime.generator),
    coalProduced: runtime.stats.produced.coal ?? 0,
  };
}

async function runMobileProofs(browserInstance) {
  const configurations = [
    { label: "mobile-390", viewport: { width: 390, height: 844 } },
    { label: "mobile-320", viewport: { width: 320, height: 568 } },
  ];
  const results = [];
  for (const configuration of configurations) {
    const context = await browserInstance.newContext({
      viewport: configuration.viewport,
      screen: configuration.viewport,
      deviceScaleFactor: 1,
      colorScheme: "dark",
      reducedMotion: "reduce",
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const diagnostics = observePage(page, `${configuration.label}-normal`);
    const screenshots = [];
    try {
      await gotoGame(page, `${BASE_URL}/?fresh=${configuration.label}`);
      const initial = await readGameState(page);
      assert(initial.alloy === 240 && initial.stats.entityCount === 11, `${configuration.label} is not fresh.`);
      const initialLayout = await auditMobileViewport(page);
      assert(initialLayout.documentOverflow.x <= 0 && initialLayout.documentOverflow.y <= 0, `${configuration.label} overflows the viewport.`);
      assert(initialLayout.telemetryDisplay === "none", `${configuration.label} telemetry is not hidden.`);
      assert(initialLayout.helpDisplay === "none", `${configuration.label} top Help is not hidden.`);
      for (const target of initialLayout.criticalHitTargets) {
        assert(target.visible && target.hit, `${configuration.label} control ${target.selector} is intercepted.`);
      }
      screenshots.push(await screenshot(page, `${configuration.label}-01-controls.png`));

      let manual = null;
      let mobileSave = null;
      let resetSafety = null;
      if (configuration.viewport.width === 390) {
        await page.locator("[data-action='session-toggle']").tap();
        await page.locator("[data-action='manual-open']").tap();
        await page.locator("[data-ref='field-manual']").waitFor({ state: "visible" });
        manual = await page.locator("[data-ref='field-manual']").evaluate((element) => ({
          text: element.textContent?.replace(/\s+/g, " ").trim(),
          rect: (() => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
          })(),
          card: (() => {
            const card = element.querySelector(".field-manual-card");
            const rect = card?.getBoundingClientRect();
            return rect ? {
              rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
              scrollHeight: card.scrollHeight,
              clientHeight: card.clientHeight,
              horizontalOverflow: card.scrollWidth - card.clientWidth,
            } : null;
          })(),
          focusedAction: document.activeElement?.getAttribute("data-action"),
        }));
        assert(manual.text.includes("TOUCH"), "Mobile Field Manual omits touch controls.");
        assert(manual.text.includes("Feed the Commission Uplink"), "Mobile Field Manual omits the first contract.");
        assert(
          manual.text.includes("SECOND CONTRACT")
            && manual.text.includes("Automate coal first")
            && manual.text.includes("Precision Fabricator")
            && manual.text.includes("Iron gear")
            && manual.text.includes("same Fabricator")
            && manual.text.includes("Copper wire")
            && manual.text.includes("Dispatch manifolds")
            && manual.text.includes("fluid processing"),
          "Mobile Field Manual omits the playable Throughput recipe-switch contract.",
        );
        assert(
          manual.text.includes("Power / relays")
            && manual.text.includes("No power")
            && manual.text.includes("Grid relays")
            && manual.text.includes("fueled generator")
            && manual.text.includes("hand-prime coal"),
          "Mobile Field Manual omits explicit power, relay, and generator-prime recovery guidance.",
        );
        assert(
          manual.rect.left >= 0
            && manual.rect.top >= 0
            && manual.rect.right <= configuration.viewport.width
            && manual.rect.bottom <= configuration.viewport.height,
          `Mobile Field Manual escapes the 390×844 viewport: ${JSON.stringify(manual.rect)}.`,
        );
        assert(
          manual.card
            && manual.card.rect.left >= 0
            && manual.card.rect.top >= 0
            && manual.card.rect.right <= configuration.viewport.width
            && manual.card.rect.bottom <= configuration.viewport.height
            && manual.card.scrollHeight > manual.card.clientHeight
            && manual.card.horizontalOverflow <= 0,
          `Longer mobile Field Manual is not contained in its vertical scroll sheet: ${JSON.stringify(manual.card)}.`,
        );
        assert(manual.focusedAction === "manual-close", "Mobile Field Manual did not trap initial focus.");
        screenshots.push(await screenshot(page, "mobile-390-02-manual.png"));
        const manualSecondContract = await revealManualSecondContract(page);
        manual.secondContract = manualSecondContract;
        const secondContractScreenshot = await screenshot(page, "mobile-390-phase2-manual.png");
        manual.secondContractScreenshot = secondContractScreenshot;
        screenshots.push(secondContractScreenshot);
        const manualPowerGuidance = await revealManualPowerGuidance(page);
        manual.powerGuidance = manualPowerGuidance;
        const manualPowerScreenshot = await screenshot(page, "mobile-390-03-manual-power.png");
        manual.powerGuidanceScreenshot = manualPowerScreenshot;
        screenshots.push(manualPowerScreenshot);
        await page.locator("[data-action='manual-close']").first().tap();

        await page.locator("[data-action='session-toggle']").tap();
        const keyAbsentBeforeSave = await page.evaluate((key) => {
          localStorage.removeItem(key);
          return localStorage.getItem(key) === null;
        }, SAVE_KEY);
        assert(keyAbsentBeforeSave, "390px lane could not clear the current key before SAVE NOW.");
        await page.locator("[data-action='session-save']").tap();
        await page.waitForFunction((key) => localStorage.getItem(key) !== null, SAVE_KEY);
        mobileSave = await page.evaluate((key) => {
          const raw = localStorage.getItem(key);
          return {
            state: document.querySelector("[data-ref='session-state']")?.textContent,
            bytes: raw ? new TextEncoder().encode(raw).byteLength : 0,
            version: raw ? JSON.parse(raw).version : null,
          };
        }, SAVE_KEY);
        mobileSave.keyProvenAbsentImmediatelyBeforeTap = keyAbsentBeforeSave;
        mobileSave.input = "native SAVE NOW tap after removing the current save key";
        assert(mobileSave.bytes > 0 && mobileSave.version === 6, "390px SAVE NOW did not recreate valid v6 bytes.");
        const beforeResetArm = await readGameState(page);
        await page.locator("[data-action='session-reset']").tap();
        resetSafety = await page.evaluate(() => ({
          label: document.querySelector("[data-action='session-reset']")?.textContent,
          armed: document.querySelector("[data-action='session-reset']")?.getAttribute("data-confirm-reset"),
          entityCount: window.__CINDERLINE__?.stats().entityCount,
          alloy: window.__CINDERLINE__?.alloy,
        }));
        assert(
          resetSafety.label === "CONFIRM RESET"
            && resetSafety.armed === "true"
            && resetSafety.entityCount === beforeResetArm.stats.entityCount
            && resetSafety.alloy === beforeResetArm.alloy,
          "First mobile reset tap was not a non-mutating confirmation step.",
        );
        await page.locator("[data-action='session-close']").tap();
      }

      let missionDisclosure = null;
      if (configuration.viewport.width === 320) {
        const initiallyCollapsed = await page.locator("[data-ref='mission-panel']")
          .evaluate((element) => element.classList.contains("is-collapsed"));
        assert(initiallyCollapsed, "320×568 mission brief did not default to its compact state.");
        await page.locator("[data-action='mission-expand']").tap();
        const expanded = await auditMobileViewport(page, { includeCriticalHits: false });
        assert(
          !expanded.missionCollapsed,
          "320×568 mission expand action did not reveal objectives.",
        );
        assert(
          expanded.objectiveRows.length === 3
            && expanded.objectiveRows.every((row) =>
              row.visible
                && row.fullyOnscreen
                && row.blockingOverlapArea === 0
                && row.counter.visible
                && row.counter.fullyOnscreen
                && row.counter.blockingOverlapArea === 0
                && /^\d+\/\d+$/.test(row.counter.text)),
          `320×568 expanded brief did not expose all three objective rows and counters: ${JSON.stringify(expanded.objectiveRows)}.`,
        );
        assert(
          expanded.missionPaletteOverlap.area === 0,
          `320×568 expanded brief overlaps the build palette: ${JSON.stringify(expanded.missionPaletteOverlap)}.`,
        );
        assert(
          expanded.toastStates.every((toast) =>
            toast.display === "none" || toast.visibility === "hidden" || Number(toast.opacity) === 0),
          `320×568 expanded objectives are visually covered by a toast: ${JSON.stringify(expanded.toastStates)}.`,
        );
        assert(
          expanded.missionControls.collapse.visible
            && expanded.missionControls.collapse.fullyOnscreen
            && expanded.missionControls.collapse.unobscuredAtCenter
            && expanded.missionControls.collapse.paletteOverlap.area === 0,
          `320×568 HIDE BRIEF control is clipped or obscured: ${JSON.stringify(expanded.missionControls.collapse)}.`,
        );
        const expandedScreenshot = await screenshot(page, "mobile-320-02-mission-expanded.png");
        screenshots.push(expandedScreenshot);
        await page.locator("[data-action='mission-collapse']").tap();
        const collapsed = await auditMobileViewport(page);
        assert(
          collapsed.missionCollapsed,
          "320×568 mission collapse action did not restore the compact brief.",
        );
        assert(
          collapsed.worldVisible.sampleCount >= 200
            && collapsed.worldVisible.bounds.width >= 80
            && collapsed.worldVisible.bounds.height >= 100,
          `320×568 compact brief leaves too little unobscured world: ${JSON.stringify(collapsed.worldVisible)}.`,
        );
        assert(
          collapsed.missionControls.expand.visible
            && collapsed.missionControls.expand.fullyOnscreen
            && collapsed.missionControls.expand.unobscuredAtCenter
            && collapsed.missionControls.expand.paletteOverlap.area === 0,
          `320×568 SHOW OBJECTIVES control is clipped or obscured: ${JSON.stringify(collapsed.missionControls.expand)}.`,
        );
        const collapsedScreenshot = await screenshot(page, "mobile-320-03-mission-collapsed.png");
        screenshots.push(collapsedScreenshot);
        await page.locator("[data-action='mission-expand']").tap();
        const expandedBeforeBuild = await auditMobileViewport(page, { includeCriticalHits: false });
        assert(!expandedBeforeBuild.missionCollapsed, "320×568 brief did not re-expand before build selection.");
        missionDisclosure = {
          input: "native touchscreen SHOW OBJECTIVES, HIDE BRIEF, SHOW OBJECTIVES, then Belt",
          initiallyCollapsed,
          expanded,
          expandedScreenshot,
          collapsed,
          collapsedScreenshot,
          expandedBeforeBuild,
        };
      }

      const build = await exerciseMobileBuildRotateDismantle(page, configuration.label, {
        expectMissionAutoCollapse: configuration.viewport.width === 320,
        autoCollapseScreenshot: configuration.viewport.width === 320
          ? "mobile-320-04-build-auto-collapsed.png"
          : null,
      });
      if (build.autoCollapseScreenshot) screenshots.push(build.autoCollapseScreenshot);
      if (missionDisclosure) {
        missionDisclosure.autoCollapsedOnBuildSelection = build.missionCollapsedAfterToolSelection;
        missionDisclosure.autoCollapseLayout = build.layoutAfterToolSelection;
        missionDisclosure.autoCollapseScreenshot = build.autoCollapseScreenshot;
      }
      const paletteReachability = await exerciseMobilePaletteReachability(page, configuration.label);
      const generator = await inspectGeneratorByTouch(page, configuration.label);
      if (configuration.viewport.width === 390) {
        screenshots.push(await screenshot(page, "mobile-390-04-generator-power.png"));
      }
      await page.locator("[data-action='close-inspector']").tap();
      const pause = await exerciseMobilePause(page);
      const touch = await exerciseTouchPanPinch(page);
      screenshots.push(await screenshot(page, `${configuration.label}-05-touch.png`));
      const finalLayout = await auditMobileViewport(page);
      assert(finalLayout.documentOverflow.x <= 0 && finalLayout.documentOverflow.y <= 0, `${configuration.label} overflows after touch input.`);
      assertDiagnosticsClean(diagnostics, `${configuration.label} normal lane`);
      results.push({
        label: configuration.label,
        viewport: configuration.viewport,
        diagnostics,
        screenshots,
        initialLayout,
        finalLayout,
        manual,
        save: mobileSave,
        resetSafety,
        missionDisclosure,
        build,
        paletteReachability,
        generator,
        pause,
        touch,
      });
    } finally {
      await context.close();
    }
  }
  assert(
    typeof desktopPhase2SaveBytes === "string",
    "The Phase-2 mobile continuation lacks exact desktop SAVE NOW bytes.",
  );
  results.push(await runPhase2MobileRecipeProof(
    browserInstance,
    desktopPhase2SaveBytes,
  ));
  return results;
}

async function runPhase2MobileRecipeProof(browserInstance, saveBytes) {
  const viewport = { width: 390, height: 844 };
  const parsedSeed = JSON.parse(saveBytes);
  const seededFabricator = parsedSeed.simulation?.entities?.find(
    (entity) =>
      entity.kind === "fabricator"
      && entity.x === 16
      && entity.y === 9,
  );
  assert(seededFabricator, "Exact desktop save bytes do not contain the Phase-2 Fabricator.");
  assert(
    parsedSeed.version === 6
      && parsedSeed.progression?.alloy === 607
      && parsedSeed.simulation?.entities?.length === 72
      && seededFabricator.recipeId === "copperWire",
    "Exact desktop save bytes are not the completed 72-entity Phase-2 campaign.",
  );
  const seedRecord = byteRecord(saveBytes);
  const context = await browserInstance.newContext({
    viewport,
    screen: viewport,
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
    storageState: {
      cookies: [],
      origins: [{
        origin: new URL(BASE_URL).origin,
        localStorage: [{ name: SAVE_KEY, value: saveBytes }],
      }],
    },
  });
  const page = await context.newPage();
  const diagnostics = observePage(page, "mobile-390-phase2-recipe");
  const screenshots = [];
  try {
    await gotoGame(page, `${BASE_URL}/?m1Phase2Mobile=1`);
    const continued = await readGameState(page);
    const sessionLabel = await page.locator("[data-ref='session-state']").innerText();
    const liveFabricator = continued.entities.find(
      (entity) => entity.x === 16 && entity.y === 9,
    );
    assert(
      sessionLabel === "CONTINUED"
        && continued.alloy === 607
        && continued.stats.entityCount === 72
        && liveFabricator?.id === seededFabricator.id
        && liveFabricator.kind === "fabricator"
        && liveFabricator.recipeId === "copperWire",
      `390px Phase-2 continuation did not restore the exact desktop factory: ${JSON.stringify({ sessionLabel, alloy: continued.alloy, entityCount: continued.stats.entityCount, liveFabricator, seededFabricator })}.`,
    );

    const point = await locateCell(page, 16, 9);
    assert(point, "390px continuation could not expose the saved Fabricator.");
    await page.touchscreen.tap(point.clientX, point.clientY);
    await page.waitForFunction(() =>
      document.querySelector("[data-ref='inspector']")?.classList.contains("is-open")
        && !document.querySelector("[data-ref='process-console']")?.hasAttribute("hidden"),
    );
    await page.evaluate(() => window.__CINDERLINE__?.dismissToasts());

    const initialCopperControl = await exposeMobileRecipeControl(
      page,
      "copperWire",
    );
    await page.waitForFunction(() =>
      document.querySelector("[data-recipe-id='copperWire']")
        ?.getAttribute("data-current") === "true"
        && document.querySelector("[data-recipe-id='copperWire']")
          ?.getAttribute("aria-pressed") === "true",
    );
    const before = await auditMobileRecipeSheet(
      page,
      seededFabricator.id,
      "copperWire",
    );
    assertMobileRecipeSheet(before, "initial restored copper-wire target");
    const restoredShot = await screenshot(
      page,
      "mobile-390-phase2-01-restored-copper.png",
    );
    screenshots.push(restoredShot);

    const ironControl = await exposeMobileRecipeControl(page, "ironGear");
    await page.touchscreen.tap(ironControl.center.x, ironControl.center.y);
    await page.waitForFunction(
      ({ entityId }) =>
        window.__CINDERLINE__?.simulation.getEntity(entityId)?.recipeId
          === "ironGear"
          && document.querySelector("[data-recipe-id='ironGear']")
            ?.getAttribute("data-current") === "true"
          && document.querySelector("[data-recipe-id='ironGear']")
            ?.getAttribute("aria-pressed") === "true",
      { entityId: seededFabricator.id },
    );
    await page.evaluate(() => window.__CINDERLINE__?.dismissToasts());
    const afterIron = await auditMobileRecipeSheet(
      page,
      seededFabricator.id,
      "ironGear",
    );
    assertMobileRecipeSheet(afterIron, "native-touch iron-gear target");
    const ironShot = await screenshot(
      page,
      "mobile-390-phase2-02-iron-selected.png",
    );
    screenshots.push(ironShot);

    const copperControl = await exposeMobileRecipeControl(page, "copperWire");
    await page.touchscreen.tap(copperControl.center.x, copperControl.center.y);
    await page.waitForFunction(
      ({ entityId }) =>
        window.__CINDERLINE__?.simulation.getEntity(entityId)?.recipeId
          === "copperWire"
          && document.querySelector("[data-recipe-id='copperWire']")
            ?.getAttribute("data-current") === "true"
          && document.querySelector("[data-recipe-id='copperWire']")
            ?.getAttribute("aria-pressed") === "true",
      { entityId: seededFabricator.id },
    );
    await page.evaluate(() => window.__CINDERLINE__?.dismissToasts());
    const afterCopper = await auditMobileRecipeSheet(
      page,
      seededFabricator.id,
      "copperWire",
    );
    assertMobileRecipeSheet(afterCopper, "native-touch copper-wire target");
    const copperShot = await screenshot(
      page,
      "mobile-390-phase2-03-copper-selected.png",
    );
    screenshots.push(copperShot);

    const finalFabricator = await page.evaluate((entityId) => {
      const entity = window.__CINDERLINE__?.simulation.getEntity(entityId);
      return entity ? JSON.parse(JSON.stringify(entity)) : null;
    }, seededFabricator.id);
    assert(
      finalFabricator?.id === seededFabricator.id
        && finalFabricator.x === 16
        && finalFabricator.y === 9
        && finalFabricator.recipeId === "copperWire",
      "Mobile recipe switching did not finish on the same saved Fabricator id.",
    );
    assertDiagnosticsClean(diagnostics, "390px Phase-2 recipe continuation");
    return {
      label: "mobile-390-phase2-recipe",
      viewport,
      diagnostics,
      screenshots,
      seedProvenance: {
        source:
          "exact unmodified v6 bytes created by the desktop lane's actual SAVE NOW click after Throughput",
        storageKey: SAVE_KEY,
        ...seedRecord,
        version: parsedSeed.version,
        entityCount: parsedSeed.simulation.entities.length,
        alloy: parsedSeed.progression.alloy,
        bytesTransformedBeforeSeeding: false,
      },
      continued: {
        sessionLabel,
        alloy: continued.alloy,
        entityCount: continued.stats.entityCount,
        throughputCompletion: continued.progression.commissions.find(
          (entry) => entry.id === "throughput",
        )?.completionCount,
      },
      fabricator: {
        id: seededFabricator.id,
        x: seededFabricator.x,
        y: seededFabricator.y,
        initialRecipeId: liveFabricator.recipeId,
        finalRecipeId: finalFabricator.recipeId,
      },
      touch: {
        input: "native touchscreen world tap, native sheet swipes, native recipe-control taps",
        worldPoint: point,
        initialCopperControl,
        ironControl,
        copperControl,
      },
      sheet: {
        before,
        afterIron,
        afterCopper,
      },
    };
  } finally {
    await context.close();
  }
}

async function exposeMobileRecipeControl(page, recipeId) {
  const control = page.locator(`[data-recipe-id='${recipeId}']`);
  await control.waitFor({ state: "attached", timeout: 5_000 });
  const gestures = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const geometry = await control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const inspector = document.querySelector("[data-ref='inspector']");
      const inspectorRect = inspector?.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const hit = centerX >= 0
        && centerX < innerWidth
        && centerY >= 0
        && centerY < innerHeight
        ? document.elementFromPoint(centerX, centerY)
        : null;
      return {
        recipeId: element.getAttribute("data-recipe-id"),
        ariaLabel: element.getAttribute("aria-label"),
        ariaPressed: element.getAttribute("aria-pressed"),
        current: element.getAttribute("data-current"),
        rect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        },
        inspectorRect: inspectorRect ? {
          left: inspectorRect.left,
          top: inspectorRect.top,
          right: inspectorRect.right,
          bottom: inspectorRect.bottom,
          width: inspectorRect.width,
          height: inspectorRect.height,
        } : null,
        inspectorScrollTop: inspector?.scrollTop ?? null,
        fullyOnscreen:
          rect.left >= 0
          && rect.top >= 0
          && rect.right <= innerWidth
          && rect.bottom <= innerHeight,
        fullyInSheet: Boolean(
          inspectorRect
          && rect.left >= inspectorRect.left
          && rect.top >= inspectorRect.top
          && rect.right <= inspectorRect.right
          && rect.bottom <= inspectorRect.bottom
        ),
        unobscuredAtCenter: Boolean(hit && element.contains(hit)),
        center: { x: centerX, y: centerY },
      };
    });
    if (
      geometry.fullyOnscreen
      && geometry.fullyInSheet
      && geometry.unobscuredAtCenter
      && geometry.rect.width >= 44
      && geometry.rect.height >= 44
    ) {
      return { ...geometry, gestures };
    }
    assert(geometry.inspectorRect, "Mobile recipe sheet has no inspector geometry.");
    const targetAbove = geometry.rect.bottom <= geometry.inspectorRect.top;
    gestures.push(await dispatchNativeSwipe(page, {
      startX: Math.round(viewportCenter(geometry.inspectorRect.left, geometry.inspectorRect.right)),
      startY: Math.round(
        targetAbove
          ? geometry.inspectorRect.top + 110
          : geometry.inspectorRect.bottom - 70,
      ),
      endX: Math.round(viewportCenter(geometry.inspectorRect.left, geometry.inspectorRect.right)),
      endY: Math.round(
        targetAbove
          ? geometry.inspectorRect.bottom - 70
          : geometry.inspectorRect.top + 110,
      ),
    }));
    await page.waitForTimeout(100);
  }
  throw new Error(`Native sheet swipes never exposed the ${recipeId} recipe control.`);
}

async function auditMobileRecipeSheet(page, fabricatorId, targetRecipeId) {
  return page.evaluate(({ entityId, recipeId }) => {
    const rectRecord = (element) => {
      const rect = element?.getBoundingClientRect();
      return rect ? {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      } : null;
    };
    const geometry = (element, sheetRect) => {
      const rect = element?.getBoundingClientRect();
      if (!element || !rect) return null;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const hit = centerX >= 0
        && centerX < innerWidth
        && centerY >= 0
        && centerY < innerHeight
        ? document.elementFromPoint(centerX, centerY)
        : null;
      return {
        rect: rectRecord(element),
        fullyOnscreen:
          rect.left >= 0
          && rect.top >= 0
          && rect.right <= innerWidth
          && rect.bottom <= innerHeight,
        fullyInSheet: Boolean(
          sheetRect
          && rect.left >= sheetRect.left
          && rect.top >= sheetRect.top
          && rect.right <= sheetRect.right
          && rect.bottom <= sheetRect.bottom
        ),
        unobscuredAtCenter: Boolean(hit && element.contains(hit)),
      };
    };
    const inspector = document.querySelector("[data-ref='inspector']");
    const process = document.querySelector("[data-ref='process-console']");
    const recipeGrid = document.querySelector("[data-ref='recipe-grid']");
    const close = document.querySelector("[data-action='close-inspector']");
    const target = document.querySelector(`[data-recipe-id='${recipeId}']`);
    const inspectorRect = inspector?.getBoundingClientRect() ?? null;
    const targetGeometry = geometry(target, inspectorRect);
    const machine = window.__CINDERLINE__?.simulation.getEntity(entityId);
    return {
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      documentOverflow: {
        x: document.documentElement.scrollWidth - innerWidth,
        y: document.documentElement.scrollHeight - innerHeight,
        bodyX: document.body.scrollWidth - innerWidth,
        bodyY: document.body.scrollHeight - innerHeight,
      },
      inspector: {
        open: inspector?.classList.contains("is-open") ?? false,
        ariaHidden: inspector?.getAttribute("aria-hidden"),
        rect: rectRecord(inspector),
        fullyOnscreen: Boolean(
          inspectorRect
          && inspectorRect.left >= 0
          && inspectorRect.top >= 0
          && inspectorRect.right <= innerWidth
          && inspectorRect.bottom <= innerHeight
        ),
        scrollTop: inspector?.scrollTop ?? null,
        scrollHeight: inspector?.scrollHeight ?? null,
        clientHeight: inspector?.clientHeight ?? null,
        horizontalOverflow:
          inspector ? inspector.scrollWidth - inspector.clientWidth : null,
      },
      process: {
        visible: Boolean(process && !process.hasAttribute("hidden")),
        rect: rectRecord(process),
        horizontalOverflow:
          process ? process.scrollWidth - process.clientWidth : null,
      },
      recipeGrid: {
        rect: rectRecord(recipeGrid),
        horizontalOverflow:
          recipeGrid ? recipeGrid.scrollWidth - recipeGrid.clientWidth : null,
      },
      close: geometry(close, inspectorRect),
      target: {
        recipeId: target?.getAttribute("data-recipe-id"),
        ariaLabel: target?.getAttribute("aria-label"),
        ariaPressed: target?.getAttribute("aria-pressed"),
        current: target?.getAttribute("data-current"),
        ...targetGeometry,
      },
      machine: machine ? JSON.parse(JSON.stringify({
        id: machine.id,
        kind: machine.kind,
        x: machine.x,
        y: machine.y,
        recipeId: machine.recipeId,
        activeRecipeId: machine.activeRecipeId,
        pendingRecipeId: machine.pendingRecipeId,
      })) : null,
      inspectorName:
        document.querySelector("[data-ref='inspector-name']")?.textContent?.trim(),
    };
  }, { entityId: fabricatorId, recipeId: targetRecipeId });
}

function assertMobileRecipeSheet(proof, label) {
  assert(
    proof.viewport.width === 390
      && proof.viewport.height === 844
      && proof.documentOverflow.x <= 0
      && proof.documentOverflow.y <= 0
      && proof.documentOverflow.bodyX <= 0
      && proof.documentOverflow.bodyY <= 0,
    `${label} overflows the 390×844 document: ${JSON.stringify(proof.documentOverflow)}.`,
  );
  assert(
    proof.inspector.open
      && proof.inspector.ariaHidden === "false"
      && proof.inspector.fullyOnscreen
      && proof.inspector.horizontalOverflow <= 0
      && proof.process.visible
      && proof.process.horizontalOverflow <= 0
      && proof.recipeGrid.horizontalOverflow <= 0,
    `${label} sheet or process console is clipped: ${JSON.stringify(proof)}.`,
  );
  assert(
    proof.close?.fullyOnscreen
      && proof.close.fullyInSheet
      && proof.close.unobscuredAtCenter
      && proof.close.rect.width >= 44
      && proof.close.rect.height >= 44,
    `${label} close control is not touch-visible: ${JSON.stringify(proof.close)}.`,
  );
  assert(
    proof.target?.fullyOnscreen
      && proof.target.fullyInSheet
      && proof.target.unobscuredAtCenter
      && proof.target.rect.width >= 44
      && proof.target.rect.height >= 44
      && proof.target.ariaPressed === "true"
      && proof.target.current === "true"
      && proof.machine?.recipeId === proof.target.recipeId
      && proof.machine?.id > 0
      && proof.inspectorName?.toLowerCase().includes("precision fabricator"),
    `${label} recipe control is not a visible authoritative target: ${JSON.stringify(proof)}.`,
  );
}

function viewportCenter(start, end) {
  return start + (end - start) / 2;
}

async function runStorageDenialProof(browserInstance) {
  const viewport = { width: 320, height: 568 };
  const context = await browserInstance.newContext({
    viewport,
    screen: viewport,
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  await context.addInitScript(() => {
    const denied = () => {
      throw new DOMException("M1 deterministic storage denial", "SecurityError");
    };
    for (const method of ["getItem", "setItem", "removeItem", "clear"]) {
      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        value: denied,
      });
    }
  });
  const page = await context.newPage();
  const diagnostics = observePage(page, "mobile-320-storage-denied");
  try {
    await gotoGame(page, `${BASE_URL}/?fresh=m1-storage-denied`);
    const initial = await readGameState(page);
    assert(initial.alloy === 240 && initial.stats.entityCount === 11, "Storage denial prevented a fresh playable run.");
    await page.locator("[data-action='session-toggle']").tap();
    const session = await page.evaluate(() => ({
      label: document.querySelector("[data-ref='session-state']")?.textContent,
      detail: document.querySelector("[data-ref='session-detail']")?.textContent,
      saveLabel: document.querySelector("[data-action='session-save']")?.textContent,
      saveDisabled: document.querySelector("[data-action='session-save']")?.disabled,
    }));
    assert(session.label === "LOCAL SAVE OFFLINE", `Storage-denied state is ${session.label}.`);
    assert(session.saveDisabled && session.saveLabel === "SAVE UNAVAILABLE", "Storage denial did not disable save explicitly.");
    assert(session.detail.includes("remains playable"), "Storage denial does not explain volatile play.");
    await page.locator("[data-action='session-close']").tap();
    const belt = page.locator("[data-build='belt']");
    await belt.tap();
    const point = await locateCell(page, 3, 3);
    assert(point, "Storage-denied run could not expose a build cell.");
    await page.touchscreen.tap(point.clientX, point.clientY);
    await page.waitForTimeout(100);
    const playable = await page.evaluate(() => ({
      alloy: window.__CINDERLINE__?.alloy,
      entityCount: window.__CINDERLINE__?.stats().entityCount,
      entity: window.__CINDERLINE__?.simulation.getEntityAt(3, 3),
    }));
    assert(playable.alloy === 238 && playable.entityCount === 12 && playable.entity?.kind === "belt", "Storage-denied run is not playable.");
    await page.locator("[data-action='mobile-cancel']").tap();
    await page.locator("[data-action='session-toggle']").tap();
    const beforeFirstResetTap = await readGameState(page);
    await page.locator("[data-action='session-reset']").tap();
    const firstResetTap = await page.evaluate(() => ({
      label: document.querySelector("[data-action='session-reset']")?.textContent,
      armed: document.querySelector("[data-action='session-reset']")?.getAttribute("data-confirm-reset"),
      alloy: window.__CINDERLINE__?.alloy,
      entityCount: window.__CINDERLINE__?.stats().entityCount,
      sessionLabel: document.querySelector("[data-ref='session-state']")?.textContent,
      saveDisabled: document.querySelector("[data-action='session-save']")?.disabled,
    }));
    assert(
      firstResetTap.label === "CONFIRM RESET"
        && firstResetTap.armed === "true"
        && firstResetTap.alloy === beforeFirstResetTap.alloy
        && firstResetTap.entityCount === beforeFirstResetTap.stats.entityCount
        && firstResetTap.sessionLabel === "LOCAL SAVE OFFLINE"
        && firstResetTap.saveDisabled,
      `Storage-denied first reset tap mutated state or lost offline disclosure: ${JSON.stringify(firstResetTap)}.`,
    );
    await page.locator("[data-action='session-reset']").tap();
    await page.waitForFunction(() =>
      window.__CINDERLINE__?.alloy === 240
        && window.__CINDERLINE__?.stats().entityCount === 11,
    );
    await page.locator("[data-action='session-toggle']").tap();
    const afterSecondResetTap = await page.evaluate(() => ({
      alloy: window.__CINDERLINE__?.alloy,
      entityCount: window.__CINDERLINE__?.stats().entityCount,
      marker: window.__CINDERLINE__?.simulation.getEntityAt(3, 3) ?? null,
      sessionLabel: document.querySelector("[data-ref='session-state']")?.textContent,
      sessionDetail: document.querySelector("[data-ref='session-detail']")?.textContent,
      saveLabel: document.querySelector("[data-action='session-save']")?.textContent,
      saveDisabled: document.querySelector("[data-action='session-save']")?.disabled,
    }));
    assert(
      afterSecondResetTap.alloy === 240
        && afterSecondResetTap.entityCount === 11
        && afterSecondResetTap.marker === null
        && afterSecondResetTap.sessionLabel === "LOCAL SAVE OFFLINE"
        && afterSecondResetTap.sessionDetail.includes("remains playable")
        && afterSecondResetTap.saveLabel === "SAVE UNAVAILABLE"
        && afterSecondResetTap.saveDisabled,
      `Storage-denied confirmed reset did not remain fresh and explicitly volatile: ${JSON.stringify(afterSecondResetTap)}.`,
    );
    const shot = await screenshot(page, "mobile-320-storage-offline.png");
    const layout = await auditMobileViewport(page, { includeCriticalHits: false });
    assert(diagnostics.errors.length === 0, `Storage-denied page errors: ${diagnostics.errors.join("\n")}`);
    assert(diagnostics.requestFailures.length === 0, `Storage-denied request failures: ${diagnostics.requestFailures.join("\n")}`);
    assert(
      diagnostics.warnings.some((warning) => warning.includes("Local storage read failed")),
      "Storage denial did not emit its expected scoped warning.",
    );
    assert(
      diagnostics.warnings.every((warning) => /^Local storage (?:read|write|remove|verify) failed for /.test(warning)),
      `Storage denial emitted an unrelated warning: ${JSON.stringify(diagnostics.warnings)}.`,
    );
    return {
      viewport,
      injection: "Storage.prototype methods throw SecurityError before application load",
      expectedWarningOnly: true,
      diagnostics,
      initial: { alloy: initial.alloy, entityCount: initial.stats.entityCount },
      session,
      playable,
      volatileReset: {
        input: "two native RESET CAMPAIGN taps while Storage methods throw",
        beforeFirstTap: {
          alloy: beforeFirstResetTap.alloy,
          entityCount: beforeFirstResetTap.stats.entityCount,
        },
        firstTap: firstResetTap,
        afterSecondTap: afterSecondResetTap,
      },
      layout,
      screenshot: shot,
    };
  } finally {
    await context.close();
  }
}

async function exerciseMobileBuildRotateDismantle(page, label, options = {}) {
  const belt = page.locator("[data-build='belt']");
  await belt.tap();
  assert((await belt.getAttribute("aria-pressed")) === "true", `${label} belt card did not arm.`);
  const layoutAfterToolSelection = await auditMobileViewport(page, { includeCriticalHits: false });
  if (options.expectMissionAutoCollapse) {
    assert(
      layoutAfterToolSelection.missionCollapsed,
      `${label} mission brief did not auto-collapse when Belt was selected.`,
    );
  }
  const autoCollapseScreenshot = options.autoCollapseScreenshot
    ? await screenshot(page, options.autoCollapseScreenshot)
    : null;
  await page.locator("[data-action='mobile-rotate']").tap();
  const point = await locateCell(page, 3, 3);
  assert(point, `${label} could not expose its mobile build cell.`);
  await page.touchscreen.tap(point.clientX, point.clientY);
  await page.waitForTimeout(100);
  const placed = await page.evaluate(() => ({
    alloy: window.__CINDERLINE__?.alloy,
    entityCount: window.__CINDERLINE__?.stats().entityCount,
    entity: window.__CINDERLINE__?.simulation.getEntityAt(3, 3),
  }));
  assert(
    placed.alloy === 238
      && placed.entityCount === 12
      && placed.entity?.kind === "belt"
      && placed.entity.direction === 2,
    `${label} touch build/rotate failed: ${JSON.stringify(placed)}.`,
  );
  await page.locator("[data-action='mobile-cancel']").tap();
  assert((await belt.getAttribute("aria-pressed")) === "false", `${label} mobile cancel did not clear the tool.`);
  const inspector = page.locator("[data-ref='inspector']");
  if (await inspector.evaluate((element) => element.classList.contains("is-open"))) {
    await page.locator("[data-action='close-inspector']").tap();
    await page.waitForFunction(() =>
      !document.querySelector("[data-ref='inspector']")?.classList.contains("is-open"),
    );
  }
  const selectPoint = await locateCell(page, 3, 3);
  assert(selectPoint, `${label} could not expose the placed belt for a fresh touch inspection.`);
  await page.touchscreen.tap(selectPoint.clientX, selectPoint.clientY);
  await page.waitForFunction(() =>
    document.querySelector("[data-ref='inspector']")?.classList.contains("is-open"),
  );
  const selectedName = await page.locator("[data-ref='inspector-name']").innerText();
  assert(selectedName.trim().toLowerCase() === "transport belt", `${label} touch inspect selected ${selectedName}.`);
  await page.locator("[data-action='mobile-dismantle']").tap();
  await page.waitForFunction(() =>
    window.__CINDERLINE__?.simulation.getEntityAt(3, 3) === undefined
      && window.__CINDERLINE__?.alloy === 240,
  );
  return {
    input: "native touchscreen tap on build card, rotate, world, cancel, inspect, dismantle",
    missionCollapsedAfterToolSelection: layoutAfterToolSelection.missionCollapsed,
    layoutAfterToolSelection,
    autoCollapseScreenshot,
    point,
    placed,
    selectedName,
    afterDismantle: await page.evaluate(() => ({
      alloy: window.__CINDERLINE__?.alloy,
      entityCount: window.__CINDERLINE__?.stats().entityCount,
      entityAtCell: window.__CINDERLINE__?.simulation.getEntityAt(3, 3) ?? null,
    })),
  };
}

async function revealManualPowerGuidance(page) {
  const row = page.locator(".manual-controls dl > div")
    .filter({ hasText: "Power / relays" });
  assert(await row.count() === 1, "Field Manual has no unique Power / relays row.");
  const gestures = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const proof = await row.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
        fullyOnscreen: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        unobscuredAtCenter: Boolean(hit && element.contains(hit)),
        manualScrollTop: document.querySelector("[data-ref='field-manual']")?.scrollTop ?? null,
        cardScrollTop: document.querySelector(".field-manual-card")?.scrollTop ?? null,
      };
    });
    if (proof.fullyOnscreen && proof.unobscuredAtCenter) {
      assert(
        proof.text.includes("No power")
          && proof.text.includes("Grid relays")
          && proof.text.includes("fueled generator")
          && proof.text.includes("hand-prime coal"),
        `Visible manual guidance is incomplete: ${proof.text}.`,
      );
      return {
        input: "native touchscreen vertical swipe inside the Field Manual",
        gestures,
        ...proof,
      };
    }
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const gesture = await dispatchNativeSwipe(page, {
      startX: Math.round(viewport.width / 2),
      startY: Math.round(viewport.height * 0.76),
      endX: Math.round(viewport.width / 2),
      endY: Math.round(viewport.height * 0.25),
    });
    gestures.push(gesture);
    await page.waitForTimeout(180);
  }
  throw new Error("Native Field Manual scrolling never exposed the Power / relays row.");
}

async function revealManualSecondContract(page) {
  const kicker = page.locator(".manual-stage-kicker").filter({
    hasText: "SECOND CONTRACT",
  });
  assert(await kicker.count() === 1, "Field Manual has no unique SECOND CONTRACT stage.");
  const gestures = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const proof = await kicker.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const card = element.closest(".field-manual-card");
      const cardRect = card?.getBoundingClientRect();
      const heading = element.nextElementSibling;
      const steps = heading?.nextElementSibling;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(centerX, centerY);
      return {
        text: [element.textContent, heading?.textContent, steps?.textContent]
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
        cardRect: cardRect ? { left: cardRect.left, top: cardRect.top, right: cardRect.right, bottom: cardRect.bottom, width: cardRect.width, height: cardRect.height } : null,
        cardScrollTop: card?.scrollTop ?? null,
        cardScrollable: Boolean(card && card.scrollHeight > card.clientHeight),
        fullyOnscreen:
          rect.left >= 0
          && rect.top >= 0
          && rect.right <= innerWidth
          && rect.bottom <= innerHeight,
        fullyInCard: Boolean(
          cardRect
          && rect.left >= cardRect.left
          && rect.top >= cardRect.top
          && rect.right <= cardRect.right
          && rect.bottom <= cardRect.bottom
        ),
        unobscuredAtCenter: Boolean(hit && element.contains(hit)),
      };
    });
    if (proof.fullyOnscreen && proof.fullyInCard && proof.unobscuredAtCenter) {
      assert(
        proof.cardScrollable
          && proof.text.includes("SECOND CONTRACT")
          && proof.text.includes("Automate coal first")
          && proof.text.includes("Precision Fabricator")
          && proof.text.includes("Iron gear")
          && proof.text.includes("same Fabricator")
          && proof.text.includes("Copper wire")
          && proof.text.includes("Dispatch manifolds")
          && proof.text.includes("fluid processing"),
        `Visible SECOND CONTRACT guidance is incomplete: ${proof.text}.`,
      );
      return {
        input: "native touchscreen vertical swipe inside the Field Manual",
        gestures,
        ...proof,
      };
    }
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const targetAbove = Boolean(
      proof.cardRect && proof.rect.bottom <= proof.cardRect.top + 62,
    );
    gestures.push(await dispatchNativeSwipe(page, {
      startX: Math.round(viewport.width / 2),
      startY: Math.round(
        viewport.height * (targetAbove ? 0.28 : 0.76),
      ),
      endX: Math.round(viewport.width / 2),
      endY: Math.round(
        viewport.height * (targetAbove ? 0.76 : 0.25),
      ),
    }));
    await page.waitForTimeout(160);
  }
  throw new Error("Native Field Manual scrolling never exposed the SECOND CONTRACT stage.");
}

async function exerciseMobilePaletteReachability(page, label) {
  const dock = page.locator("#build-dock");
  const dockRect = await dock.boundingBox();
  assert(dockRect, `${label} construction dock has no geometry.`);
  const gestures = [];
  // Deliberately move away from the leading cards, then prove they can be
  // recovered with native horizontal swipes rather than DOM scroll setters.
  for (let index = 0; index < 2; index += 1) {
    gestures.push(await dispatchNativeSwipe(page, {
      startX: Math.round(dockRect.x + dockRect.width - 18),
      startY: Math.round(dockRect.y + dockRect.height / 2),
      endX: Math.round(dockRect.x + 18),
      endY: Math.round(dockRect.y + dockRect.height / 2),
    }));
    await page.waitForTimeout(120);
  }
  const results = [];
  for (const kind of ["gridRelay", "extractor", "inserter", "smelter"]) {
    const card = page.locator(`[data-build='${kind}']`);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const geometry = await card.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const dockElement = document.querySelector("#build-dock");
        const dockBounds = dockElement?.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          dockLeft: dockBounds?.left ?? 0,
          dockRight: dockBounds?.right ?? innerWidth,
          scrollLeft: dockElement?.scrollLeft ?? 0,
        };
      });
      if (geometry.left >= geometry.dockLeft && geometry.right <= geometry.dockRight) break;
      const needsEarlierCards = geometry.left < geometry.dockLeft;
      gestures.push(await dispatchNativeSwipe(page, {
        startX: Math.round(dockRect.x + (needsEarlierCards ? 18 : dockRect.width - 18)),
        startY: Math.round(dockRect.y + dockRect.height / 2),
        endX: Math.round(dockRect.x + (needsEarlierCards ? dockRect.width - 18 : 18)),
        endY: Math.round(dockRect.y + dockRect.height / 2),
      }));
      await page.waitForTimeout(120);
    }
    const finalPreTapGeometry = await card.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const dockElement = document.querySelector("#build-dock");
      const dockBounds = dockElement?.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        dockLeft: dockBounds?.left ?? 0,
        dockRight: dockBounds?.right ?? innerWidth,
        dockTop: dockBounds?.top ?? 0,
        dockBottom: dockBounds?.bottom ?? innerHeight,
        scrollLeft: dockElement?.scrollLeft ?? 0,
      };
    });
    assert(
      finalPreTapGeometry.left >= finalPreTapGeometry.dockLeft
        && finalPreTapGeometry.right <= finalPreTapGeometry.dockRight
        && finalPreTapGeometry.top >= finalPreTapGeometry.dockTop
        && finalPreTapGeometry.bottom <= finalPreTapGeometry.dockBottom,
      `${label} native swipes did not expose ${kind} before the tap: ${JSON.stringify(finalPreTapGeometry)}.`,
    );
    await card.tap();
    const proof = await card.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        kind: element.getAttribute("data-build"),
        ariaLabel: element.getAttribute("aria-label"),
        ariaPressed: element.getAttribute("aria-pressed"),
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
        hit: Boolean(hit && element.contains(hit)),
      };
    });
    proof.finalPreTapGeometry = finalPreTapGeometry;
    assert(
      proof.ariaPressed === "true"
        && proof.ariaLabel
        && proof.hit
        && proof.rect.left >= 0
        && proof.rect.right <= await page.evaluate(() => innerWidth),
      `${label} ${kind} build card is not touch-reachable: ${JSON.stringify(proof)}.`,
    );
    results.push(proof);
    await page.locator("[data-action='mobile-cancel']").tap();
  }
  assert(
    gestures.some((gesture) =>
      gesture.before.dockScrollLeft !== null
        && gesture.after.dockScrollLeft !== null
        && Math.abs(gesture.after.dockScrollLeft - gesture.before.dockScrollLeft) >= 1),
    `${label} palette gestures never changed native dock scrollLeft.`,
  );
  return {
    input: "native horizontal palette swipes plus touchscreen tap and Cancel for every remaining M1 unit",
    gestures,
    cards: results,
  };
}

async function dispatchNativeSwipe(page, points) {
  const before = await page.evaluate(() => ({
    dockScrollLeft: document.querySelector("#build-dock")?.scrollLeft ?? null,
    manualScrollTop: document.querySelector("[data-ref='field-manual']")?.scrollTop ?? null,
    manualCardScrollTop: document.querySelector(".field-manual-card")?.scrollTop ?? null,
    inspectorScrollTop: document.querySelector("[data-ref='inspector']")?.scrollTop ?? null,
  }));
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: points.startX, y: points.startY, id: 1 }],
    });
    for (let step = 1; step <= 6; step += 1) {
      const ratio = step / 6;
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{
          x: Math.round(points.startX + (points.endX - points.startX) * ratio),
          y: Math.round(points.startY + (points.endY - points.startY) * ratio),
          id: 1,
        }],
      });
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await session.detach();
  }
  await page.waitForTimeout(80);
  const after = await page.evaluate(() => ({
    dockScrollLeft: document.querySelector("#build-dock")?.scrollLeft ?? null,
    manualScrollTop: document.querySelector("[data-ref='field-manual']")?.scrollTop ?? null,
    manualCardScrollTop: document.querySelector(".field-manual-card")?.scrollTop ?? null,
    inspectorScrollTop: document.querySelector("[data-ref='inspector']")?.scrollTop ?? null,
  }));
  return { ...points, before, after };
}

async function inspectGeneratorByTouch(page, label) {
  const point = await locateCell(page, 18, 3);
  assert(point, `${label} could not expose the starter generator.`);
  await page.touchscreen.tap(point.clientX, point.clientY);
  await page.waitForFunction(() =>
    document.querySelector("[data-ref='inspector']")?.classList.contains("is-open")
      && document.querySelector("[data-ref='inspector-name']")?.textContent === "Combustion generator",
  );
  await page.waitForTimeout(180);
  const proof = await page.evaluate((touchPoint) => {
    const inspector = document.querySelector("[data-ref='inspector']");
    const game = window.__CINDERLINE__;
    const id = game?.coreGeneratorEntityId;
    const visibleGeometry = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const hit = rect.width > 0 && rect.height > 0
        ? document.elementFromPoint(centerX, centerY)
        : null;
      return {
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        fullyOnscreen: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        unobscuredAtCenter: Boolean(hit && element.contains(hit)),
      };
    };
    const powerCell = inspector?.querySelector("[data-stat-id='power']");
    const networkCell = inspector?.querySelector("[data-stat-id='network']");
    return {
      input: "native touchscreen world tap",
      point: touchPoint,
      name: document.querySelector("[data-ref='inspector-name']")?.textContent,
      status: document.querySelector("[data-ref='inspector-status']")?.textContent?.replace(/\s+/g, " ").trim(),
      power: powerCell?.textContent?.replace(/\s+/g, " ").trim(),
      network: networkCell?.textContent?.replace(/\s+/g, " ").trim(),
      powerGeometry: visibleGeometry(powerCell),
      networkGeometry: visibleGeometry(networkCell),
      recoveryAction: inspector?.querySelector("[data-inspector-action='hand-prime-coal']")?.textContent,
      entity: id === null || id === undefined ? null : game.simulation.getEntity(id),
    };
  }, point);
  assert(proof.name === "Combustion generator", `${label} generator name is not discoverable.`);
  assert(proof.power?.includes("Power") && proof.power.includes("%"), `${label} generator power state is not rendered.`);
  assert(proof.network?.includes("Network") && proof.network.includes("N-"), `${label} generator network is not rendered.`);
  for (const [name, geometry] of [["Power", proof.powerGeometry], ["Network", proof.networkGeometry]]) {
    assert(
      geometry
        && geometry.display !== "none"
        && geometry.visibility !== "hidden"
        && Number(geometry.opacity) > 0
        && geometry.fullyOnscreen
        && geometry.unobscuredAtCenter,
      `${label} generator ${name} stat is DOM-only, clipped, or obscured: ${JSON.stringify(geometry)}.`,
    );
  }
  assert(proof.recoveryAction?.includes("PRIME"), `${label} generator recovery action is not discoverable.`);
  return proof;
}

async function exerciseMobilePause(page) {
  const button = page.locator("[data-action='pause']");
  await button.tap();
  const paused = await page.locator("[data-ref='pause-plate']").evaluate((element) => ({
    open: element.classList.contains("is-open"),
    ariaHidden: element.getAttribute("aria-hidden"),
  }));
  assert(paused.open && paused.ariaHidden === "false", "Mobile pause did not visibly engage.");
  await button.tap();
  const resumed = await page.locator("[data-ref='pause-plate']").evaluate((element) => ({
    open: element.classList.contains("is-open"),
    ariaHidden: element.getAttribute("aria-hidden"),
  }));
  assert(!resumed.open && resumed.ariaHidden === "true", "Mobile pause did not resume.");
  return { input: "native touchscreen taps", paused, resumed };
}

async function exerciseTouchPanPinch(page) {
  const band = await findTouchBand(page);
  assert(band && band.right - band.left >= 70, `No unobstructed touch band: ${JSON.stringify(band)}.`);
  const session = await page.context().newCDPSession(page);
  const beforePan = await readProjection(page, band);
  const panStart = { x: band.right - 8, y: band.y };
  const panEnd = { x: band.left + 8, y: band.y };
  await dispatchTouch(session, "touchStart", [{ id: 1, ...panStart }]);
  await dispatchTouch(session, "touchMove", [{ id: 1, ...panEnd }]);
  await dispatchTouch(session, "touchEnd", []);
  await page.waitForTimeout(100);
  const afterPan = await readProjection(page, band);
  const panGridDelta = gridDistance(beforePan.center, afterPan.center);
  assert(panGridDelta >= 1, `Native touch pan did not move the world mapping (${panGridDelta}).`);

  const center = Math.round((band.left + band.right) / 2);
  const startHalf = Math.min(20, Math.floor((band.right - band.left) / 5));
  const endHalf = Math.floor((band.right - band.left) / 2) - 5;
  const beforePinch = await readProjection(page, band);
  await dispatchTouch(session, "touchStart", [
    { id: 2, x: center - startHalf, y: band.y },
    { id: 3, x: center + startHalf, y: band.y },
  ]);
  await dispatchTouch(session, "touchMove", [
    { id: 2, x: center - endHalf, y: band.y },
    { id: 3, x: center + endHalf, y: band.y },
  ]);
  await dispatchTouch(session, "touchEnd", []);
  await page.waitForTimeout(120);
  const afterPinch = await readProjection(page, band);
  assert(
    afterPinch.span < beforePinch.span,
    `Native pinch did not zoom in (${beforePinch.span} -> ${afterPinch.span}).`,
  );
  return {
    input: "Chromium native Input.dispatchTouchEvent",
    band,
    pan: { start: panStart, end: panEnd, before: beforePan, after: afterPan, gridDelta: panGridDelta },
    pinch: {
      startDistance: startHalf * 2,
      endDistance: endHalf * 2,
      before: beforePinch,
      after: afterPinch,
      spanDelta: afterPinch.span - beforePinch.span,
    },
  };
}

async function dispatchTouch(session, type, points) {
  await session.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((point) => ({
      x: point.x,
      y: point.y,
      id: point.id,
      radiusX: 1,
      radiusY: 1,
      rotationAngle: 0,
      force: 1,
    })),
  });
}

async function findTouchBand(page) {
  return page.evaluate(() => {
    let best = null;
    for (let y = 72; y <= innerHeight - 125; y += 8) {
      const points = [];
      for (let x = 8; x <= innerWidth - 8; x += 4) {
        if (document.elementFromPoint(x, y)?.id === "world") points.push(x);
      }
      if (points.length === 0) continue;
      let runStart = points[0];
      let previous = points[0];
      for (let index = 1; index <= points.length; index += 1) {
        const next = points[index];
        if (next !== undefined && next - previous <= 4) {
          previous = next;
          continue;
        }
        const candidate = { left: runStart, right: previous, y, width: previous - runStart };
        if (!best || candidate.width > best.width) best = candidate;
        runStart = next;
        previous = next;
      }
    }
    return best;
  });
}

async function readProjection(page, band) {
  return page.evaluate((sample) => {
    const renderer = window.__CINDERLINE__?.renderer;
    if (!renderer) throw new Error("Renderer is unavailable for touch projection.");
    const left = renderer.screenToGrid(sample.left + 4, sample.y);
    const right = renderer.screenToGrid(sample.right - 4, sample.y);
    const center = renderer.screenToGrid((sample.left + sample.right) / 2, sample.y);
    return {
      left,
      right,
      center,
      span: left && right ? Math.hypot(right.x - left.x, right.z - left.z) : null,
    };
  }, band);
}

async function auditMobileViewport(page, options = {}) {
  return page.evaluate(({ includeCriticalHits }) => {
    const recordRect = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const overlap = (first, second) => {
      if (!first || !second) return { width: 0, height: 0, area: 0 };
      const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
      const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
      return { width, height, area: width * height };
    };
    const selectors = [
      "[data-action='session-toggle']",
      "[data-action='pause']",
      "[data-build='belt']",
      "[data-action='mobile-rotate']",
      "[data-action='mobile-cancel']",
      "[data-action='mobile-focus']",
    ];
    const criticalHitTargets = includeCriticalHits === false ? [] : selectors.map((selector) => {
      const element = document.querySelector(selector);
      const rect = element?.getBoundingClientRect();
      const style = element ? getComputedStyle(element) : null;
      const visible = Boolean(
        element
          && rect
          && rect.width > 0
          && rect.height > 0
          && style?.display !== "none"
          && style?.visibility !== "hidden",
      );
      const centerX = rect ? Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2)) : 0;
      const centerY = rect ? Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2)) : 0;
      const hitElement = visible ? document.elementFromPoint(centerX, centerY) : null;
      return {
        selector,
        visible,
        rect: recordRect(element),
        hit: Boolean(element && hitElement && element.contains(hitElement)),
        hitTag: hitElement?.tagName,
        hitAction: hitElement?.closest("[data-action]")?.getAttribute("data-action"),
        hitBuild: hitElement?.closest("[data-build]")?.getAttribute("data-build"),
      };
    });
    const mission = recordRect(document.querySelector("[data-ref='mission-panel']"));
    const palette = recordRect(document.querySelector(".build-palette"));
    const isVisibleInViewport = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.display !== "none"
        && style.visibility !== "hidden"
        && rect.right > 0
        && rect.bottom > 0
        && rect.left < innerWidth
        && rect.top < innerHeight;
    };
    const blockingElements = [
      ["topbar", document.querySelector(".topbar")],
      ["build-palette", document.querySelector(".build-palette")],
      ["session-panel", document.querySelector("[data-ref='session-panel']:not([hidden])")],
      ["field-manual", document.querySelector("[data-ref='field-manual']:not([hidden])")],
      ["inspector", document.querySelector("[data-ref='inspector'].is-open")],
      ["pause", document.querySelector("[data-ref='pause-plate'].is-open")],
      ...[...document.querySelectorAll("[data-toast-id]")]
        .map((element, index) => [`toast-${index}`, element]),
    ].filter(([, element]) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity) > 0
        && rect.width > 0
        && rect.height > 0;
    });
    const blockingOverlap = (element) => {
      const targetRect = recordRect(element);
      const overlaps = blockingElements.map(([name, blocker]) => ({
        name,
        rect: recordRect(blocker),
        overlap: overlap(targetRect, recordRect(blocker)),
      })).filter((entry) => entry.overlap.area > 0);
      return {
        overlaps,
        area: overlaps.reduce((total, entry) => total + entry.overlap.area, 0),
      };
    };
    const geometryProof = (element) => {
      const rect = element?.getBoundingClientRect();
      if (!element || !rect) {
        return {
          visible: false,
          fullyOnscreen: false,
          unobscuredAtCenter: false,
          rect: null,
        };
      }
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const hit = rect.width > 0 && rect.height > 0
        ? document.elementFromPoint(centerX, centerY)
        : null;
      return {
        visible: isVisibleInViewport(element),
        fullyOnscreen: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        unobscuredAtCenter: Boolean(hit && element.contains(hit)),
        rect: recordRect(element),
      };
    };
    const objectiveRows = [...document.querySelectorAll("[data-ref='objective-list'] .objective")]
      .map((row) => {
        const counter = row.querySelector(".objective-count");
        const rowGeometry = geometryProof(row);
        const counterGeometry = geometryProof(counter);
        const rowBlocking = blockingOverlap(row);
        const counterBlocking = blockingOverlap(counter);
        return {
          id: row.getAttribute("data-objective-id"),
          ...rowGeometry,
          blockingOverlaps: rowBlocking.overlaps,
          blockingOverlapArea: rowBlocking.area,
          counter: {
            text: counter?.textContent?.trim() ?? "",
            ...counterGeometry,
            blockingOverlaps: counterBlocking.overlaps,
            blockingOverlapArea: counterBlocking.area,
          },
        };
      });
    const toastStates = [...document.querySelectorAll("[data-toast-id]")]
      .map((element) => {
        const style = getComputedStyle(element);
        return {
          id: element.getAttribute("data-toast-id"),
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          rect: recordRect(element),
        };
      });
    const missionControlProof = (action) => {
      const element = document.querySelector(`[data-action='${action}']`);
      return {
        ...geometryProof(element),
        paletteOverlap: overlap(recordRect(element), palette),
      };
    };
    let worldSampleCount = 0;
    let worldLeft = Infinity;
    let worldTop = Infinity;
    let worldRight = -Infinity;
    let worldBottom = -Infinity;
    for (let y = 2; y < innerHeight; y += 4) {
      for (let x = 2; x < innerWidth; x += 4) {
        if (document.elementFromPoint(x, y)?.id !== "world") continue;
        worldSampleCount += 1;
        worldLeft = Math.min(worldLeft, x);
        worldTop = Math.min(worldTop, y);
        worldRight = Math.max(worldRight, x);
        worldBottom = Math.max(worldBottom, y);
      }
    }
    const worldBounds = worldSampleCount === 0
      ? { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
      : {
          left: worldLeft,
          top: worldTop,
          right: worldRight,
          bottom: worldBottom,
          width: worldRight - worldLeft,
          height: worldBottom - worldTop,
        };
    return {
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      documentOverflow: {
        x: document.documentElement.scrollWidth - innerWidth,
        y: document.documentElement.scrollHeight - innerHeight,
        bodyX: document.body.scrollWidth - innerWidth,
        bodyY: document.body.scrollHeight - innerHeight,
      },
      telemetryDisplay: getComputedStyle(document.querySelector(".telemetry")).display,
      helpDisplay: getComputedStyle(document.querySelector("[data-action='help']")).display,
      mission,
      palette,
      missionPaletteOverlap: overlap(mission, palette),
      missionCollapsed: document.querySelector("[data-ref='mission-panel']")?.classList.contains("is-collapsed"),
      objectiveRows,
      visibleBlockingOverlays: blockingElements.map(([name, element]) => ({ name, rect: recordRect(element) })),
      toastStates,
      missionControls: {
        expand: missionControlProof("mission-expand"),
        collapse: missionControlProof("mission-collapse"),
      },
      worldVisible: {
        samplingStepPixels: 4,
        sampleCount: worldSampleCount,
        estimatedVisiblePixels: worldSampleCount * 16,
        bounds: worldBounds,
      },
      worldAtCenter: document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.id,
      criticalHitTargets,
    };
  }, { includeCriticalHits: options.includeCriticalHits ?? true });
}

function byteRecord(value) {
  if (typeof value !== "string") return null;
  return { bytes: Buffer.byteLength(value), sha256: sha256(value) };
}

function gridDistance(first, second) {
  if (!first || !second) return 0;
  return Math.hypot(second.x - first.x, second.z - first.z);
}

async function runSessionRecoveryProof(browserInstance) {
  const context = await browserInstance.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const diagnostics = observePage(page, "session-reset-restore");
  let restoredBytes;
  let resetRestore;
  try {
    await gotoGame(page, `${BASE_URL}/?fresh=m1-reset-restore`);
    const placement = await placeThroughHud(page, {
      label: "reset-recovery-marker",
      kind: "belt",
      x: 3,
      y: 3,
      direction: DIRECTION.East,
    });
    await page.locator("[data-action='session-toggle']").click();
    const beforeFirstTap = await readGameState(page);
    await page.locator("[data-action='session-reset']").click();
    const firstTap = await page.evaluate(() => ({
      label: document.querySelector("[data-action='session-reset']")?.textContent,
      armed: document.querySelector("[data-action='session-reset']")?.getAttribute("data-confirm-reset"),
      entityCount: window.__CINDERLINE__?.stats().entityCount,
      alloy: window.__CINDERLINE__?.alloy,
      backupPresent: localStorage.getItem("cinderline.autosave.pre-reset.v6") !== null,
    }));
    assert(
      firstTap.label === "CONFIRM RESET"
        && firstTap.armed === "true"
        && firstTap.entityCount === beforeFirstTap.stats.entityCount
        && firstTap.alloy === beforeFirstTap.alloy
        && !firstTap.backupPresent,
      "First reset click mutated state or backup custody.",
    );
    await page.locator("[data-action='session-reset']").click();
    await page.waitForFunction(() =>
      window.__CINDERLINE__?.stats().entityCount === 11
        && window.__CINDERLINE__?.alloy === 240,
    );
    const afterReset = await page.evaluate(() => {
      const current = localStorage.getItem("cinderline.autosave.v6");
      const backup = localStorage.getItem("cinderline.autosave.pre-reset.v6");
      return {
        entityCount: window.__CINDERLINE__?.stats().entityCount,
        alloy: window.__CINDERLINE__?.alloy,
        current,
        backup,
        currentParsed: current ? JSON.parse(current) : null,
        backupParsed: backup ? JSON.parse(backup) : null,
      };
    });
    assert(afterReset.currentParsed?.version === 6 && afterReset.currentParsed?.simulation.entities.length === 11, "Reset did not persist a fresh current v6.");
    assert(afterReset.backupParsed?.version === 6 && afterReset.backupParsed?.simulation.entities.length === 12, "Reset did not preserve the prior v6 backup.");
    assert(afterReset.backupParsed?.progression.alloy === 238, "Reset backup lost paid economy.");
    await page.locator("[data-action='session-toggle']").click();
    const restore = page.locator("[data-action='session-restore']");
    assert(await restore.isVisible(), "Restore pre-reset action is not exposed after reset.");
    await restore.click();
    await page.waitForFunction(() =>
      window.__CINDERLINE__?.stats().entityCount === 12
        && window.__CINDERLINE__?.alloy === 238,
    );
    const restored = await page.evaluate(() => ({
      entityCount: window.__CINDERLINE__?.stats().entityCount,
      alloy: window.__CINDERLINE__?.alloy,
      marker: window.__CINDERLINE__?.simulation.getEntityAt(3, 3),
      current: localStorage.getItem("cinderline.autosave.v6"),
      backup: localStorage.getItem("cinderline.autosave.pre-reset.v6"),
    }));
    assert(restored.marker?.kind === "belt", "Restore lost the paid marker entity.");
    assert(restored.current === afterReset.backup, "Restore did not promote the exact backup bytes.");
    restoredBytes = restored.current;
    const screenshotRecord = await screenshot(page, "desktop-session-reset-restored.png");
    resetRestore = {
      input: "two actual RESET CAMPAIGN clicks followed by actual RESTORE PRE-RESET click",
      placement,
      beforeFirstTap: { entityCount: beforeFirstTap.stats.entityCount, alloy: beforeFirstTap.alloy },
      firstTap,
      afterReset: {
        entityCount: afterReset.entityCount,
        alloy: afterReset.alloy,
        current: byteRecord(afterReset.current),
        backup: byteRecord(afterReset.backup),
      },
      restored: {
        entityCount: restored.entityCount,
        alloy: restored.alloy,
        marker: restored.marker,
        current: byteRecord(restored.current),
        backup: byteRecord(restored.backup),
        currentExactlyMatchesBackup: restored.current === afterReset.backup,
      },
      screenshot: screenshotRecord,
      diagnostics,
    };
    assertDiagnosticsClean(diagnostics, "Reset/restore normal lane");
  } finally {
    await context.close();
  }

  assert(restoredBytes, "Reset/restore did not yield valid current bytes.");
  const validV5 = JSON.parse(restoredBytes);
  validV5.version = 5;
  delete validV5.railConstruction;
  const validV5Bytes = JSON.stringify(validV5);
  const malformedCurrentBytes = '{"format":"cinderline-session","version":6,"truncated":';
  const recoveryContext = await browserInstance.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    storageState: {
      cookies: [],
      origins: [{
        origin: new URL(BASE_URL).origin,
        localStorage: [
          { name: "cinderline.autosave.v6", value: malformedCurrentBytes },
          { name: "cinderline.autosave.v5", value: validV5Bytes },
        ],
      }],
    },
  });
  const recoveryPage = await recoveryContext.newPage();
  const recoveryDiagnostics = observePage(recoveryPage, "malformed-v6-valid-v5-recovery");
  try {
    await gotoGame(recoveryPage, `${BASE_URL}/?m1Recovery=1`);
    const recovered = await readGameState(recoveryPage);
    const storage = await recoveryPage.evaluate(() => ({
      current: localStorage.getItem("cinderline.autosave.v6"),
      fallback: localStorage.getItem("cinderline.autosave.v5"),
      sessionLabel: document.querySelector("[data-ref='session-state']")?.textContent,
      sessionDetail: document.querySelector("[data-ref='session-detail']")?.textContent,
    }));
    assert(recovered.stats.entityCount === 12 && recovered.alloy === 238, "Valid v5 fallback was not recovered.");
    assert(storage.sessionLabel === "RECOVERED", `Fallback session label is ${storage.sessionLabel}.`);
    assert(storage.fallback === validV5Bytes, "Recovery did not preserve exact fallback bytes.");
    assert(storage.current !== malformedCurrentBytes, "Recovery left malformed current bytes active.");
    const parsedCurrent = JSON.parse(storage.current);
    assert(parsedCurrent.version === 6 && parsedCurrent.simulation.entities.length === 12, "Recovery did not migrate current bytes to v6.");
    assert(
      recoveryDiagnostics.warnings.some((warning) =>
        warning.includes("Autosave cinderline.autosave.v6 could not be restored")),
      "Malformed current save did not emit the expected recovery warning.",
    );
    assert(
      recoveryDiagnostics.warnings.every((warning) =>
        warning.includes("Autosave cinderline.autosave.v6 could not be restored")),
      `Malformed-save recovery emitted an unrelated warning: ${JSON.stringify(recoveryDiagnostics.warnings)}.`,
    );
    assert(
      recoveryDiagnostics.errors.length === 0 && recoveryDiagnostics.requestFailures.length === 0,
      `Recovery emitted errors or request failures: ${JSON.stringify(recoveryDiagnostics)}.`,
    );
    const screenshotRecord = await screenshot(recoveryPage, "desktop-session-recovered.png");
    return {
      resetRestore,
      malformedCurrentFallback: {
        input: {
          malformedCurrent: byteRecord(malformedCurrentBytes),
          validFallback: byteRecord(validV5Bytes),
        },
        recovered: {
          entityCount: recovered.stats.entityCount,
          alloy: recovered.alloy,
          sessionLabel: storage.sessionLabel,
          sessionDetail: storage.sessionDetail,
          current: byteRecord(storage.current),
          fallback: byteRecord(storage.fallback),
          fallbackBytesPreservedExactly: storage.fallback === validV5Bytes,
          malformedCurrentRejected: storage.current !== malformedCurrentBytes,
        },
        diagnostics: recoveryDiagnostics,
        screenshot: screenshotRecord,
      },
    };
  } finally {
    await recoveryContext.close();
  }
}

async function placeThroughHud(page, placement) {
  process.stdout.write(`M1 place ${placement.label} ${placement.kind}@${placement.x},${placement.y}\n`);
  const button = page.locator(`[data-build='${placement.kind}']`);
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
  assert((await button.getAttribute("aria-pressed")) === "true", `${placement.kind} tool did not arm.`);
  const before = await page.evaluate(() => ({
    alloy: window.__CINDERLINE__?.alloy,
    ids: window.__CINDERLINE__?.simulation.getEntities().map((entity) => entity.id) ?? [],
  }));
  const point = await locateCell(page, placement.x, placement.y);
  assert(point, `Could not expose ${placement.label} at ${placement.x},${placement.y}.`);
  await page.mouse.click(point.clientX, point.clientY);
  await page.waitForTimeout(80);
  const immediate = await page.evaluate(({ x, y }) => ({
    entity: window.__CINDERLINE__?.simulation.getEntityAt(x, y) ?? null,
    alloy: window.__CINDERLINE__?.alloy,
    coordinate: {
      x: document.querySelector("[data-ref='coordinate-x']")?.textContent,
      z: document.querySelector("[data-ref='coordinate-z']")?.textContent,
    },
    toasts: [...document.querySelectorAll("[data-toast-id]")]
      .map((toast) => toast.textContent?.replace(/\s+/g, " ").trim()),
  }), placement);
  assert(
    immediate.entity?.kind === placement.kind,
    `${placement.label} did not place: ${JSON.stringify(immediate)}.`,
  );
  const after = await page.evaluate(({ x, y }) => {
    const game = window.__CINDERLINE__;
    const entity = game?.simulation.getEntityAt(x, y);
    return {
      alloy: game?.alloy,
      entity: entity ? JSON.parse(JSON.stringify(entity)) : null,
      ledger: game?.constructionLedger(),
    };
  }, placement);
  assert(after.entity, `${placement.label} placement did not create an entity.`);
  assert(!before.ids.includes(after.entity.id), `${placement.label} reused an existing entity.`);
  assert(after.entity.direction === placement.direction, `${placement.label} has direction ${after.entity.direction}.`);
  assert(before.alloy - after.alloy === COSTS[placement.kind], `${placement.label} spent the wrong alloy amount.`);
  const ledger = after.ledger.find((entry) => entry.entityId === after.entity.id)?.provenance;
  assert(ledger?.source === "paid", `${placement.label} lacks paid provenance.`);
  assert(ledger.paidCost === COSTS[placement.kind], `${placement.label} ledger cost is wrong.`);
  return {
    label: placement.label,
    input: { toolSelector: `[data-build='${placement.kind}']`, pointer: point },
    beforeAlloy: before.alloy,
    afterAlloy: after.alloy,
    entityId: after.entity.id,
    kind: after.entity.kind,
    x: after.entity.x,
    y: after.entity.y,
    direction: after.entity.direction,
    paidCost: ledger.paidCost,
  };
}

async function armBuildTool(page, kind) {
  const button = page.locator(`[data-build='${kind}']`);
  await button.waitFor({ state: "visible", timeout: 5_000 });
  if ((await button.getAttribute("aria-pressed")) !== "true") {
    await button.click();
  }
  assert(
    await button.getAttribute("aria-pressed") === "true",
    `${kind} tool did not arm before orientation.`,
  );
}

async function chooseRecipeThroughHud(page, entityId, recipeId) {
  const recipe = page.locator(`[data-recipe-id='${recipeId}']`);
  await recipe.waitFor({ state: "visible", timeout: 5_000 });
  await recipe.scrollIntoViewIfNeeded();
  await recipe.click();
  await page.waitForFunction(
    ({ id, recipe }) => window.__CINDERLINE__?.simulation.getEntity(id)?.recipeId === recipe,
    { id: entityId, recipe: recipeId },
  );
  return {
    selector: `[data-recipe-id='${recipeId}']`,
    configuredRecipeId: recipeId,
    ariaPressed: await recipe.getAttribute("aria-pressed"),
  };
}

async function orientTool(page, current, target) {
  const rotations = (target - current + 4) % 4;
  const canvas = page.locator("#world");
  for (let index = 0; index < rotations; index += 1) {
    await canvas.press("r");
  }
  return target;
}

async function locateCell(page, x, y) {
  await page.evaluate(({ targetX, targetY }) => {
    window.__CINDERLINE__?.renderer.focus(targetX + 0.5, targetY + 0.5);
  }, { targetX: x, targetY: y });
  await page.waitForTimeout(45);
  return page.evaluate(({ targetX, targetY }) => {
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
          if (cell?.x === targetX && cell.z === targetY) return { clientX, clientY };
        }
      }
      for (let clientY = top + 4; clientY < bottom; clientY += 4) {
        for (const clientX of [left, right]) {
          if (document.elementFromPoint(clientX, clientY)?.id !== "world") continue;
          const cell = game.renderer.screenToGrid(clientX, clientY);
          if (cell?.x === targetX && cell.z === targetY) return { clientX, clientY };
        }
      }
    }
    return null;
  }, { targetX: x, targetY: y });
}

async function primeGeneratorThroughHud(page) {
  await page.keyboard.press("Escape");
  const before = await readGenerator(page);
  const resourceBefore = (await page.evaluate(() => window.__CINDERLINE__?.stats().resourcesRemaining.coal)) ?? 0;
  const point = await locateCell(page, 18, 3);
  assert(point, "Could not expose the bootstrap generator for field priming.");
  await page.mouse.click(point.clientX, point.clientY);
  const action = page.locator("[data-inspector-action='hand-prime-coal']");
  await action.waitFor({ state: "visible" });
  assert(!(await action.isDisabled()), "Bootstrap generator cannot be field-primed.");
  await action.click();
  const after = await readGenerator(page);
  const resourceAfter = (await page.evaluate(() => window.__CINDERLINE__?.stats().resourcesRemaining.coal)) ?? 0;
  assert(resourceBefore - resourceAfter === 1, "Field priming did not hand-mine exactly one coal.");
  return { input: "world selection plus inspector action", before, after, resourceBefore, resourceAfter };
}

async function readGenerator(page) {
  return page.evaluate(() => {
    const game = window.__CINDERLINE__;
    const entity = game?.coreGeneratorEntityId === null || game?.coreGeneratorEntityId === undefined
      ? null
      : game.simulation.getEntity(game.coreGeneratorEntityId);
    return entity ? JSON.parse(JSON.stringify(entity)) : null;
  });
}

async function readReloadContinuation(page) {
  return page.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game) throw new Error("M1 bridge is unavailable during reload continuation.");
    const clone = (entity) => entity ? JSON.parse(JSON.stringify(entity)) : null;
    return {
      tick: game.stats().tick,
      power: JSON.parse(JSON.stringify(game.stats().power)),
      generator: game.coreGeneratorEntityId === null
        ? null
        : clone(game.simulation.getEntity(game.coreGeneratorEntityId)),
      coalExtractor: clone(game.simulation.getEntityAt(24, 4)),
      coalLoader: clone(game.simulation.getEntityAt(20, 4)),
    };
  });
}

async function readGameState(page) {
  return page.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game) throw new Error("M1 bridge is unavailable.");
    return JSON.parse(JSON.stringify({
      alloy: game.alloy,
      progression: game.progression,
      uplinkInventory: game.uplinkInventory,
      uplinkEntityId: game.uplinkEntityId,
      coreGeneratorEntityId: game.coreGeneratorEntityId,
      stats: game.stats(),
      entities: game.simulation.getEntities(),
      resources: game.simulation.getResources(),
      ledger: game.constructionLedger(),
      powerGrid: game.simulation.powerGridSnapshot(),
    }));
  });
}

async function readManifestState(page) {
  return page.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game) throw new Error("M1 bridge is unavailable.");
    const inventory = Object.fromEntries(game.uplinkInventory.entries.map((entry) => [entry.item, entry.count]));
    return {
      tick: game.stats().tick,
      inventory,
      produced: game.stats().produced,
      resourcesRemaining: game.stats().resourcesRemaining,
      stored: game.stats().stored,
      generator: game.coreGeneratorEntityId === null
        ? null
        : game.simulation.getEntity(game.coreGeneratorEntityId),
    };
  });
}

async function readPowerProof(page, paidEntityIds) {
  return page.evaluate((ids) => {
    const game = window.__CINDERLINE__;
    if (!game) throw new Error("M1 bridge is unavailable.");
    const grid = game.simulation.powerGridSnapshot();
    const paid = new Set(ids);
    const paidConsumers = game.simulation.getEntities()
      .filter((entity) => paid.has(entity.id) && entity.kind !== "belt" && entity.kind !== "gridRelay")
      .map((entity) => ({
        id: entity.id,
        kind: entity.kind,
        powerSatisfaction: entity.powerSatisfaction,
        assignment: grid.assignments.find((entry) => entry.entityId === entity.id) ?? null,
      }));
    return {
      stats: game.stats().power,
      grid,
      paidConsumers,
      unassignedPaidConsumers: paidConsumers.filter(
        (entity) => entity.assignment?.networkId === null,
      ),
      underSatisfiedPaidConsumers: paidConsumers.filter(
        (entity) => entity.powerSatisfaction < 0.999,
      ),
      generator: game.coreGeneratorEntityId === null
        ? null
        : game.simulation.getEntity(game.coreGeneratorEntityId),
    };
  }, paidEntityIds);
}

async function readOnboarding(page) {
  return page.evaluate(() => {
    const mission = document.querySelector("[data-ref='mission-panel']");
    const buildCards = [...document.querySelectorAll("[data-build]")].map((element) => ({
      kind: element.getAttribute("data-build"),
      label: element.getAttribute("aria-label"),
    }));
    return {
      text: mission?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      buildCards,
      powerText: document.querySelector("[data-ref='power-value']")?.textContent?.trim(),
      powerPanelText: document.querySelector("[data-ref='power-value']")
        ?.closest(".telemetry-item")?.textContent?.replace(/\s+/g, " ").trim(),
      saveLabel: document.querySelector("[data-action='session-toggle']")?.getAttribute("aria-label"),
      helpLabel: document.querySelector("[data-action='help']")?.getAttribute("aria-label"),
    };
  });
}

async function readMissionUI(page) {
  return page.evaluate(() => {
    const panel = document.querySelector("[data-ref='mission-panel']");
    const button = document.querySelector("[data-action='commission-submit']");
    return {
      text: panel?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      submitEnabled: button instanceof HTMLButtonElement && !button.disabled,
      objectiveRows: [...document.querySelectorAll("[data-ref='objective-list'] > *")]
        .map((row) => row.textContent?.replace(/\s+/g, " ").trim()),
    };
  });
}

function manifestComplete(inventory) {
  return Object.entries(REQUIREMENTS).every(([item, count]) => (inventory[item] ?? 0) >= count);
}

function assertRouteMatchesWorld(entities) {
  assertPlacementsMatchWorld(PAID_ROUTE, entities, { recipes: true });
}

function assertPlacementsMatchWorld(route, entities, options = {}) {
  for (const placement of route) {
    const entity = entities.find((candidate) => candidate.x === placement.x && candidate.y === placement.y);
    assert(entity?.kind === placement.kind, `${placement.label} is missing after world/save restore.`);
    assert(entity.direction === placement.direction, `${placement.label} direction changed after restore.`);
    if (options.recipes && placement.recipeId) {
      assert(entity.recipeId === placement.recipeId, `${placement.label} recipe changed.`);
    }
  }
}

function assertResourceProduction(initialStats, finalStats) {
  const expected = {
    iron: { item: "ironOre", minimum: 24 },
    copper: { item: "copperOre", minimum: 12 },
    stone: { item: "stone", minimum: 24 },
  };
  for (const [resource, proof] of Object.entries(expected)) {
    const depleted = initialStats.resourcesRemaining[resource] - finalStats.resourcesRemaining[resource];
    assert(depleted >= proof.minimum, `${resource} seam depletion ${depleted} is below ${proof.minimum}.`);
    assert(finalStats.produced[proof.item] >= proof.minimum, `${proof.item} production is below ${proof.minimum}.`);
  }
  for (const [item, minimum] of Object.entries(REQUIREMENTS)) {
    assert(finalStats.produced[item] >= minimum, `${item} production is below ${minimum}.`);
  }
}

function summarizeEvents(events, uplinkEntityId, entities) {
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const produced = {};
  const uplinkTransfers = {};
  const productionEntities = {};
  for (const event of events) {
    if (event.type === "itemProduced" && event.item) {
      produced[event.item] = (produced[event.item] ?? 0) + (event.amount ?? 0);
      const entity = entityById.get(event.entityId);
      const key = `${event.entityId}:${entity?.kind ?? "unknown"}:${entity?.x ?? "?"},${entity?.y ?? "?"}`;
      productionEntities[key] = (productionEntities[key] ?? 0) + (event.amount ?? 0);
    }
    if (event.type === "itemTransferred" && event.entityId === uplinkEntityId && event.item) {
      uplinkTransfers[event.item] = (uplinkTransfers[event.item] ?? 0) + (event.amount ?? 0);
    }
  }
  return { totalEvents: events.length, produced, uplinkTransfers, productionEntities };
}

async function installEventObserver(page) {
  await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game) throw new Error("Cannot install M1 event observer without the game bridge.");
    const simulation = game.simulation;
    const original = simulation.drainEvents;
    const capture = {
      contract: "copy exact array returned to main frame; return same array unchanged",
      directDrainCalls: 0,
      wrapperCalls: 0,
      events: [],
    };
    const observedFrameDrain = function observedFrameDrain() {
      const returned = original.call(this);
      capture.wrapperCalls += 1;
      for (const event of returned) capture.events.push(JSON.parse(JSON.stringify(event)));
      return returned;
    };
    capture.wrapper = observedFrameDrain;
    simulation.drainEvents = observedFrameDrain;
    Object.defineProperty(window, "__M1_EVENT_OBSERVER__", {
      value: capture,
      configurable: false,
      enumerable: false,
      writable: false,
    });
  });
}

async function frameFactory(page, x, y) {
  await page.evaluate(({ focusX, focusY }) => {
    window.__CINDERLINE__?.dismissToasts();
    window.__CINDERLINE__?.renderer.focus(focusX, focusY);
  }, { focusX: x, focusY: y });
  await page.waitForTimeout(360);
}

async function gotoGame(page, url) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  await waitForGame(page);
}

async function waitForGame(page) {
  await page.waitForFunction(
    () => document.querySelector("#boot")?.classList.contains("is-done"),
    null,
    { timeout: 12_000 },
  );
  await page.waitForFunction(() => Boolean(window.__CINDERLINE__?.stats().entityCount), null, { timeout: 12_000 });
  // #boot fades for 700 ms after is-done.  Waiting only on the class lets the
  // transparent transition layer briefly intercept otherwise valid touch
  // targets, so readiness includes the browser's final hit-testing state.
  await page.waitForFunction(() => {
    const boot = document.querySelector("#boot");
    if (!boot) return true;
    const style = getComputedStyle(boot);
    if (style.visibility !== "hidden" || Number(style.opacity) > 0) return false;
    const sample = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return !sample || !boot.contains(sample);
  }, null, { timeout: 12_000 });
  await page.waitForTimeout(60);
}

function observePage(page, label) {
  const diagnostics = { label, errors: [], warnings: [], requestFailures: [] };
  page.on("pageerror", (error) => diagnostics.errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.errors.push(`console: ${message.text()}`);
    if (message.type() === "warning") diagnostics.warnings.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (/fonts\.(?:googleapis|gstatic)\.com/.test(request.url())) return;
    diagnostics.requestFailures.push(`${request.url()} — ${request.failure()?.errorText ?? "unknown"}`);
  });
  return diagnostics;
}

function assertDiagnosticsClean(diagnostics, label) {
  assert(
    diagnostics.errors.length === 0
      && diagnostics.warnings.length === 0
      && diagnostics.requestFailures.length === 0,
    `${label} emitted diagnostics: ${JSON.stringify(diagnostics)}.`,
  );
}

async function screenshot(page, filename) {
  const path = resolve(OUTPUT_DIRECTORY, filename);
  await page.screenshot({ path, animations: "disabled" });
  const data = await readFile(path);
  const dimensions = pngDimensions(data);
  return { filename, bytes: data.length, sha256: sha256(data), ...dimensions };
}

async function liveScreenshot(page, filename) {
  const path = resolve(OUTPUT_DIRECTORY, filename);
  await page.screenshot({ path });
  const data = await readFile(path);
  const dimensions = pngDimensions(data);
  return { filename, bytes: data.length, sha256: sha256(data), ...dimensions };
}

async function fingerprintSources() {
  const sourceFiles = await walk(resolve("src"));
  const publicFiles = await walk(resolve("public"));
  const testFiles = await walk(resolve("tests"));
  const paths = [
    resolve("index.html"),
    resolve("package.json"),
    resolve("package-lock.json"),
    resolve("MILESTONE-M1.md"),
    resolve("README.md"),
    resolve("tsconfig.json"),
    resolve("vite.config.ts"),
    resolve("scripts/m1-browser-qa.mjs"),
    ...sourceFiles,
    ...publicFiles,
    ...testFiles,
  ].sort();
  const files = [];
  for (const path of paths) {
    const data = await readFile(path);
    files.push({ path: relative(resolve("."), path), bytes: data.length, sha256: sha256(data) });
  }
  return {
    digest: sha256(files.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`).join("\n")),
    files,
  };
}

async function inspectServedBuild(baseURL) {
  const response = await fetch(`${baseURL}/`, { redirect: "follow" });
  assert(response.ok, `Server ${baseURL} returned HTTP ${response.status}.`);
  const html = await response.text();
  const mode = html.includes("/@vite/client")
    ? "vite-development"
    : /\/assets\/[^\"']+\.js/.test(html)
      ? "vite-production-preview"
      : "unknown";
  const assetURLs = [...new Set(
    [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map((match) => new URL(match[1], response.url))
      .filter((url) => url.origin === new URL(response.url).origin)
      .map((url) => url.href),
  )];
  const assets = [];
  for (const url of assetURLs) {
    const assetResponse = await fetch(url, { redirect: "follow" });
    assert(assetResponse.ok, `Served asset ${url} returned HTTP ${assetResponse.status}.`);
    const bytes = Buffer.from(await assetResponse.arrayBuffer());
    assets.push({
      url,
      pathname: new URL(url).pathname,
      status: assetResponse.status,
      contentType: assetResponse.headers.get("content-type"),
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
  const localDist = await fingerprintDirectoryIfPresent("dist");
  const distByPath = new Map(
    (localDist?.files ?? []).map((entry) => [`/${entry.path}`, entry]),
  );
  const servedAssetMatches = assets.map((asset) => ({
    pathname: asset.pathname,
    servedSha256: asset.sha256,
    distSha256: distByPath.get(asset.pathname)?.sha256 ?? null,
    matches: distByPath.get(asset.pathname)?.sha256 === asset.sha256,
  }));
  const htmlMatchesDist = localDist?.files
    .find((entry) => entry.path === "index.html")?.sha256 === sha256(html);
  const localDistMatches = mode === "vite-production-preview"
    && htmlMatchesDist
    && servedAssetMatches.length > 0
    && servedAssetMatches.every((entry) => entry.matches);
  const digest = sha256([
    sha256(html),
    ...assets.map((asset) => `${asset.pathname}\0${asset.bytes}\0${asset.sha256}`),
    `dist\0${localDist?.digest ?? "absent"}`,
  ].join("\n"));
  return {
    mode,
    finalURL: response.url,
    status: response.status,
    contentType: response.headers.get("content-type"),
    htmlBytes: Buffer.byteLength(html),
    htmlSha256: sha256(html),
    assets,
    localDist,
    htmlMatchesDist,
    servedAssetMatches,
    localDistMatches,
    digest,
  };
}

async function fingerprintDirectoryIfPresent(directory) {
  const absolute = resolve(directory);
  try {
    if (!(await stat(absolute)).isDirectory()) return null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const paths = (await walk(absolute)).sort();
  const files = [];
  for (const path of paths) {
    const data = await readFile(path);
    files.push({ path: relative(absolute, path), bytes: data.length, sha256: sha256(data) });
  }
  return {
    path: relative(resolve("."), absolute),
    digest: sha256(files.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`).join("\n")),
    files,
  };
}

async function prepareOutputDirectory(directory) {
  const absolute = resolve(directory);
  const workspaceQa = resolve(".qa");
  assert(absolute.startsWith(`${workspaceQa}/`), "M1 output must be a child of .qa.");
  try {
    const metadata = await stat(absolute);
    if (metadata.isDirectory() && (await readdir(absolute)).length === 0) return;
    throw new Error(`Refusing to mix M1 evidence into existing path ${directory}.`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(absolute, { recursive: true });
}

async function artifactRecords(directory, excluded = []) {
  const exclusions = new Set(excluded);
  const files = (await walk(resolve(directory)))
    .filter((path) => !exclusions.has(relative(resolve(directory), path)))
    .sort();
  const records = [];
  for (const path of files) {
    const data = await readFile(path);
    records.push({
      path: relative(resolve(directory), path),
      bytes: data.length,
      sha256: sha256(data),
      ...(path.endsWith(".png") ? pngDimensions(data) : {}),
    });
  }
  return records;
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}

async function writeJson(filename, value) {
  await writeFile(resolve(OUTPUT_DIRECTORY, filename), `${JSON.stringify(value, null, 2)}\n`);
}

function pngDimensions(buffer) {
  assert(buffer.subarray(1, 4).toString("ascii") === "PNG", "Artifact is not a PNG.");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function rangeDescending(start, end) {
  return Array.from({ length: start - end + 1 }, (_, index) => start - index);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
