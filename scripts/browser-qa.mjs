import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseURL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
await mkdir(".qa", { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const warnings = [];

try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await context.newPage();

  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
    if (message.type() === "warning") warnings.push(message.text());
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!url.includes("fonts.googleapis.com") && !url.includes("fonts.gstatic.com")) {
      errors.push(`requestfailed: ${url} — ${request.failure()?.errorText ?? "unknown"}`);
    }
  });

  await page.goto(`${baseURL}/?fresh=qa`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => document.querySelector("#boot")?.classList.contains("is-done"),
    null,
    { timeout: 10_000 },
  );
  await page.waitForFunction(
    () => Boolean(window.__CINDERLINE__?.stats().entityCount),
    null,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(1_500);

  const initial = await page.evaluate(() => window.__CINDERLINE__?.stats());
  const initialAlloy = await readAlloy(page);
  const campaign = await page.evaluate(() => ({
    mode: window.__CINDERLINE__?.progression.mode,
    selected: window.__CINDERLINE__?.progression.selectedCommissionId,
    uplinkEntityId: window.__CINDERLINE__?.uplinkEntityId,
    coreGeneratorEntityId: window.__CINDERLINE__?.coreGeneratorEntityId,
    uplinkEntries: window.__CINDERLINE__?.uplinkInventory.entries.length,
  }));
  assert(initial, "QA bridge did not expose simulation stats.");
  assert(initialAlloy === 240, `Fresh campaign alloy was ${initialAlloy}, expected 240.`);
  assert(campaign.mode === "campaign", "Fresh session did not enter campaign mode.");
  assert(campaign.selected === "bootstrap", "Bootstrap commission was not selected.");
  assert(
    Number.isSafeInteger(campaign.uplinkEntityId) && campaign.uplinkEntries === 0,
    "Fresh campaign is missing a clean physical Commission Uplink.",
  );
  assert(
    campaign.coreGeneratorEntityId === 1,
    "Fresh campaign is missing its protected bootstrap generator anchor.",
  );
  assert(initial.entityCount === 11, `Expected sparse 11-entity start, got ${initial.entityCount}.`);
  assert(initial.entityCounts.belt === 4, "Starter iron line is not intentionally incomplete.");
  assert(initial.entityCounts.extractor === 1, "Starter campaign must grant exactly one extractor.");
  assert(initial.power.capacityKW >= initial.power.usedKW, "Starter showcase is power starved.");

  await page.keyboard.press("Space");
  await page.waitForTimeout(80);
  assert(
    await page.locator("[data-ref='pause-plate']").evaluate((element) =>
      element.classList.contains("is-open"),
    ),
    "Space did not pause the simulation.",
  );
  await page.keyboard.press("Space");

  await page.locator("[data-build='belt']").click();
  assert(
    await page.locator("[data-build='belt']").getAttribute("aria-pressed") === "true",
    "Build palette did not select the belt tool.",
  );

  const candidate = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game) return null;
    const points = [
      [1050, 660],
      [1180, 680],
      [1380, 620],
      [980, 800],
      [1460, 770],
      [1160, 360],
    ];
    for (const [clientX, clientY] of points) {
      const cell = game.renderer.screenToGrid(clientX, clientY);
      if (
        cell &&
        game.simulation.canPlace("belt", cell.x, cell.z, 1).ok
      ) {
        return { clientX, clientY, cell };
      }
    }
    return null;
  });
  assert(candidate, "Could not find a visible empty cell for direct-manipulation QA.");

  const beforePlacement = await page.evaluate(
    () => window.__CINDERLINE__?.stats().entityCount ?? 0,
  );
  await page.mouse.click(candidate.clientX, candidate.clientY);
  await page.waitForTimeout(160);
  const afterPlacement = await page.evaluate(
    () => window.__CINDERLINE__?.stats().entityCount ?? 0,
  );
  const alloyAfterPlacement = await readAlloy(page);
  assert(
    afterPlacement === beforePlacement + 1,
    `World click did not place exactly one belt (${beforePlacement} -> ${afterPlacement}).`,
  );
  assert(
    alloyAfterPlacement === 238,
    `Belt placement did not atomically spend 2 alloy (got ${alloyAfterPlacement}).`,
  );

  await page.keyboard.press("Delete");
  await page.waitForTimeout(180);
  const afterDeleteRemoval = await page.evaluate(
    () => window.__CINDERLINE__?.stats().entityCount ?? 0,
  );
  const alloyAfterDelete = await readAlloy(page);
  assert(
    afterDeleteRemoval === beforePlacement,
    `Delete did not dismantle the selected belt (${afterPlacement} -> ${afterDeleteRemoval}).`,
  );
  assert(
    alloyAfterDelete === 240,
    `Belt dismantle did not fully recover its construction alloy (got ${alloyAfterDelete}).`,
  );

  await page.keyboard.press("Control+Z");
  await page.waitForTimeout(180);
  const afterUndoDismantle = await page.evaluate(
    () => window.__CINDERLINE__?.stats().entityCount ?? 0,
  );
  const alloyAfterUndoDismantle = await readAlloy(page);
  assert(
    afterUndoDismantle === beforePlacement + 1 &&
      alloyAfterUndoDismantle === 238,
    `Undo dismantle was not atomic (entities ${afterUndoDismantle}, alloy ${alloyAfterUndoDismantle}).`,
  );

  await page.keyboard.press("Control+Z");
  await page.waitForTimeout(180);
  const afterUndoPlacement = await page.evaluate(
    () => window.__CINDERLINE__?.stats().entityCount ?? 0,
  );
  const alloyAfterUndoPlacement = await readAlloy(page);
  assert(
    afterUndoPlacement === beforePlacement && alloyAfterUndoPlacement === 240,
    `Undo placement did not restore entity count and stock (entities ${afterUndoPlacement}, alloy ${alloyAfterUndoPlacement}).`,
  );

  await page.locator("[data-build='belt']").click();
  await page.mouse.click(candidate.clientX, candidate.clientY);
  await page.waitForTimeout(160);
  const afterReplacement = await page.evaluate(
    () => window.__CINDERLINE__?.stats().entityCount ?? 0,
  );
  const alloyAfterReplacement = await readAlloy(page);
  assert(
    afterReplacement === beforePlacement + 1,
    `Could not replace the belt for Shift+RMB QA (${beforePlacement} -> ${afterReplacement}).`,
  );
  assert(alloyAfterReplacement === 238, "Replacement belt did not cost 2 alloy.");

  await page.keyboard.down("Shift");
  await page.mouse.click(candidate.clientX, candidate.clientY, {
    button: "right",
  });
  await page.keyboard.up("Shift");
  await page.waitForTimeout(180);
  const afterShiftRemoval = await page.evaluate(
    () => window.__CINDERLINE__?.stats().entityCount ?? 0,
  );
  const alloyAfterShiftRemoval = await readAlloy(page);
  assert(
    afterShiftRemoval === beforePlacement && alloyAfterShiftRemoval === 240,
    `Shift+RMB dismantle was not atomic (entities ${afterShiftRemoval}, alloy ${alloyAfterShiftRemoval}).`,
  );
  await page.keyboard.press("Control+Z");
  await page.waitForTimeout(180);
  assert(
    (await page.evaluate(
      () => window.__CINDERLINE__?.stats().entityCount ?? 0,
    )) === beforePlacement + 1 &&
      (await readAlloy(page)) === 238,
    "Undo after Shift+RMB did not restore the placed-belt session.",
  );

  await page.evaluate(() => window.__CINDERLINE__?.selectEntity(5));
  await page.keyboard.press("Control+C");
  await page.waitForFunction(
    () =>
      window.__CINDERLINE__?.blueprint.mode === "paste" &&
      window.__CINDERLINE__?.blueprint.clipboard?.entities.length === 1,
    null,
    { timeout: 5_000 },
  );
  const blueprintCandidate = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game) return null;
    for (let clientY = 180; clientY <= 860; clientY += 18) {
      for (let clientX = 340; clientX <= 1540; clientX += 18) {
        if (document.elementFromPoint(clientX, clientY)?.id !== "world") {
          continue;
        }
        const cell = game.renderer.screenToGrid(clientX, clientY);
        if (!cell) continue;
        const preview = game.previewBlueprint(cell.x, cell.z);
        if (
          preview.ok &&
          preview.cost > 0 &&
          preview.diagnostics.some(
            (diagnostic) =>
              diagnostic.ok && diagnostic.action === "construct",
          )
        ) {
          return { clientX, clientY, cell };
        }
      }
    }
    return null;
  });
  assert(blueprintCandidate, "Could not find a visible blueprint destination.");
  const beforeBlueprint = await page.evaluate(
    () => window.__CINDERLINE__?.stats().entityCount ?? 0,
  );
  await page.mouse.click(
    blueprintCandidate.clientX,
    blueprintCandidate.clientY,
  );
  await page.waitForTimeout(180);
  assert(
    (await page.evaluate(
      () => window.__CINDERLINE__?.stats().entityCount ?? 0,
    )) === beforeBlueprint + 1 &&
      (await readAlloy(page)) === 236,
    "Single-unit blueprint was not purchased and deployed atomically.",
  );
  await page.keyboard.press("Control+Z");
  await page.waitForTimeout(180);
  assert(
    (await page.evaluate(
      () => window.__CINDERLINE__?.stats().entityCount ?? 0,
    )) === beforeBlueprint &&
      (await readAlloy(page)) === 238,
    "One-step blueprint undo did not restore entity count and alloy.",
  );
  await page.keyboard.press("Escape");
  assert(
    (await page.evaluate(() => window.__CINDERLINE__?.blueprint.mode)) === null,
    "Escape did not cancel blueprint placement mode.",
  );

  // Rail-aware campaign framing can place the original starter construction
  // outside the untouched viewport. Center the deterministic starter cell
  // before testing an area capture so this QA does not depend on scene bounds.
  await page.evaluate(() => window.__CINDERLINE__?.renderer.focus(10, 5));
  await page.waitForTimeout(120);
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
  assert(
    captureCorners?.first && captureCorners.second,
    "Could not resolve visible world cells for area blueprint capture.",
  );
  await page.keyboard.press("b");
  await page.mouse.click(
    captureCorners.first.clientX,
    captureCorners.first.clientY,
  );
  await page.mouse.click(
    captureCorners.second.clientX,
    captureCorners.second.clientY,
  );
  await page.waitForFunction(
    () =>
      window.__CINDERLINE__?.blueprint.mode === "paste" &&
      (window.__CINDERLINE__?.blueprint.clipboard?.entities.length ?? 0) >= 6,
    null,
    { timeout: 5_000 },
  );
  const multiBlueprintCandidate = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game) return null;
    const seen = new Set();
    for (let clientY = 160; clientY <= 650; clientY += 10) {
      for (let clientX = 310; clientX <= 1600; clientX += 10) {
        if (document.elementFromPoint(clientX, clientY)?.id !== "world") {
          continue;
        }
        const cell = game.renderer.screenToGrid(clientX, clientY);
        if (!cell) continue;
        const key = `${cell.x},${cell.z}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const preview = game.previewBlueprint(cell.x, cell.z);
        if (
          preview.ok &&
          preview.cost > 0 &&
          preview.diagnostics.length === preview.plan.placements.length &&
          preview.diagnostics.every(
            (diagnostic) =>
              diagnostic.ok && diagnostic.action === "construct",
          )
        ) {
          return {
            clientX,
            clientY,
            cell,
            cost: preview.cost,
            units: preview.plan.placements.length,
          };
        }
      }
    }
    return null;
  });
  assert(
    multiBlueprintCandidate?.units >= 6,
    "Could not find a visible valid destination for the area blueprint.",
  );
  const exactBlueprintPreview = await page.evaluate(() =>
    window.__CINDERLINE__?.previewBlueprint(7, 4),
  );
  assert(
    exactBlueprintPreview?.ok === true &&
      exactBlueprintPreview.cost === 0 &&
      exactBlueprintPreview.conflictCount === 0 &&
      exactBlueprintPreview.diagnostics.length ===
        multiBlueprintCandidate.units &&
      exactBlueprintPreview.diagnostics.every(
        (diagnostic) => diagnostic.action === "match",
      ),
    `Blueprint did not classify its source construction as a zero-cost exact match: ${JSON.stringify(exactBlueprintPreview)}.`,
  );
  const beforeExactMatch = await page.evaluate(
    () => window.__CINDERLINE__?.stats().entityCount ?? 0,
  );
  const alloyBeforeExactMatch = await readAlloy(page);
  await page.mouse.click(
    captureCorners.first.clientX,
    captureCorners.first.clientY,
  );
  await page.waitForTimeout(180);
  assert(
    (await page.evaluate(
      () => window.__CINDERLINE__?.stats().entityCount ?? 0,
    )) === beforeExactMatch &&
      (await readAlloy(page)) === alloyBeforeExactMatch &&
      (await page.evaluate(
        () => window.__CINDERLINE__?.blueprint.mode,
      )) === "paste",
    "Clicking an exact blueprint match mutated construction or left repeat-paste mode.",
  );
  const invalidBlueprintPreview = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game) return null;
    for (let z = 0; z <= 18; z += 1) {
      for (let x = 0; x <= 30; x += 1) {
        const preview = game.previewBlueprint(x, z);
        if (
          !preview.ok &&
          preview.cost > 0 &&
          preview.diagnostics.some(
            (diagnostic) => diagnostic.action === "construct",
          )
        ) {
          return preview;
        }
      }
    }
    return null;
  });
  assert(
    invalidBlueprintPreview?.ok === false &&
      invalidBlueprintPreview.cost > 0 &&
      invalidBlueprintPreview.cost <= multiBlueprintCandidate.cost &&
      invalidBlueprintPreview.conflictCount >= 1 &&
      invalidBlueprintPreview.diagnostics.length ===
        multiBlueprintCandidate.units,
    "Invalid blueprint preview did not retain complete per-unit diagnostics and new-construction cost.",
  );
  const beforeMultiBlueprint = await page.evaluate(
    () => window.__CINDERLINE__?.stats().entityCount ?? 0,
  );
  const alloyBeforeMultiBlueprint = await readAlloy(page);
  await page.mouse.click(
    multiBlueprintCandidate.clientX,
    multiBlueprintCandidate.clientY,
  );
  await page.waitForTimeout(220);
  assert(
    (await page.evaluate(
      () => window.__CINDERLINE__?.stats().entityCount ?? 0,
    )) === beforeMultiBlueprint + multiBlueprintCandidate.units &&
      (await readAlloy(page)) ===
        alloyBeforeMultiBlueprint - multiBlueprintCandidate.cost,
    "Area blueprint did not commit every unit and aggregate cost atomically.",
  );
  await page.keyboard.press("Control+Z");
  await page.waitForTimeout(220);
  assert(
    (await page.evaluate(
      () => window.__CINDERLINE__?.stats().entityCount ?? 0,
    )) === beforeMultiBlueprint &&
      (await readAlloy(page)) === alloyBeforeMultiBlueprint &&
      (await page.evaluate(
        () => window.__CINDERLINE__?.blueprint.mode,
      )) === "paste",
    "One-step area-blueprint undo did not restore the transaction while preserving repeat-paste mode.",
  );
  await page.keyboard.press("Control+Shift+Z");
  await page.waitForTimeout(220);
  assert(
    (await page.evaluate(
      () => window.__CINDERLINE__?.stats().entityCount ?? 0,
    )) === beforeMultiBlueprint + multiBlueprintCandidate.units &&
      (await readAlloy(page)) ===
        alloyBeforeMultiBlueprint - multiBlueprintCandidate.cost &&
      (await page.evaluate(
        () => window.__CINDERLINE__?.blueprint.mode,
      )) === "paste",
    "Area-blueprint redo did not reapply the complete atomic transaction in repeat-paste mode.",
  );
  await page.keyboard.press("Control+Z");
  await page.waitForTimeout(220);
  assert(
    (await page.evaluate(
      () => window.__CINDERLINE__?.stats().entityCount ?? 0,
    )) === beforeMultiBlueprint &&
      (await readAlloy(page)) === alloyBeforeMultiBlueprint &&
      (await page.evaluate(
        () => window.__CINDERLINE__?.blueprint.mode,
      )) === "paste",
    "Undo after blueprint redo did not restore the transaction.",
  );
  await page.evaluate(() => window.__CINDERLINE__?.dismissToasts());
  await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game) return;
    window.__CINDERLINE_EXPECTED_CONSOLE_ERROR__ = console.error;
    console.error = () => {};
    const simulation = game.simulation;
    const place = simulation.place.bind(simulation);
    let calls = 0;
    simulation.place = (...args) => {
      calls += 1;
      return calls === 2
        ? { ok: false, reason: "occupied" }
        : place(...args);
    };
  });
  await page.mouse.click(
    multiBlueprintCandidate.clientX,
    multiBlueprintCandidate.clientY,
  );
  await page.waitForTimeout(220);
  await page.evaluate(() => {
    if (window.__CINDERLINE_EXPECTED_CONSOLE_ERROR__) {
      console.error = window.__CINDERLINE_EXPECTED_CONSOLE_ERROR__;
      delete window.__CINDERLINE_EXPECTED_CONSOLE_ERROR__;
    }
  });
  assert(
    (await page.evaluate(
      () => window.__CINDERLINE__?.stats().entityCount ?? 0,
    )) === beforeMultiBlueprint &&
      (await readAlloy(page)) === alloyBeforeMultiBlueprint &&
      (await page.evaluate(
        () => window.__CINDERLINE__?.blueprint.mode,
      )) === "paste",
    "Injected second-unit failure did not roll the entire blueprint transaction back.",
  );
  await page.keyboard.press("Escape");

  await page.evaluate(() => window.dispatchEvent(new Event("beforeunload")));
  const persisted = await page.evaluate(() => {
    const raw = localStorage.getItem("cinderline.autosave.v6");
    return raw ? JSON.parse(raw) : null;
  });
  assert(
      persisted?.format === "cinderline-session" &&
      persisted?.version === 6 &&
      persisted?.origin === "campaign" &&
      persisted?.coreGeneratorEntityId === 1 &&
      persisted?.progression?.alloy === 238 &&
      persisted?.progression?.mode === "campaign" &&
      persisted?.uplinkInventory &&
      persisted?.construction?.length === beforePlacement + 1 &&
      persisted?.simulation,
    "Autosave is not a valid atomic v6 campaign session wrapper.",
  );

  const tamperCases = [
    [
      "alloy",
      (session) => {
        session.progression.alloy = 999_999;
      },
    ],
    [
      "manifest",
      (session) => {
        session.uplinkInventory.entries = [
          { item: "ironPlate", count: 24 },
          { item: "copperPlate", count: 12 },
          { item: "stoneBrick", count: 12 },
        ];
      },
    ],
    [
      "starter fuel custody",
      (session) => {
        const generator = session.simulation.entities.find(
          (entity) => entity.id === session.coreGeneratorEntityId,
        );
        generator.fuel.coal = 50;
      },
    ],
    [
      "machine input custody",
      (session) => {
        const smelter = session.simulation.entities.find(
          (entity) => entity.id === 10,
        );
        smelter.input.ironOre = 50;
      },
    ],
    [
      "starter provenance",
      (session) => {
        const entry = session.construction.find(
          (candidate) => candidate.entityId === 1,
        );
        entry.provenance = {
          format: "cinderline-construction-provenance",
          version: 1,
          source: "paid",
          buildKind: "generator",
          paidCost: 40,
        };
      },
    ],
    [
      "missing bootstrap generator",
      (session) => {
        session.simulation.entities = session.simulation.entities.filter(
          (entity) => entity.id !== session.coreGeneratorEntityId,
        );
        session.construction = session.construction.filter(
          (entry) => entry.entityId !== session.coreGeneratorEntityId,
        );
      },
    ],
    [
      "construction revision floor",
      (session) => {
        session.simulation.entities = session.simulation.entities.filter(
          (entity) => entity.id !== 2,
        );
        session.construction = session.construction.filter(
          (entry) => entry.entityId !== 2,
        );
      },
    ],
    [
      "global campaign power",
      (session) => {
        session.simulation.powerMode = "legacyGlobal";
      },
    ],
  ];
  for (const [name, mutate] of tamperCases) {
    const tampered = structuredClone(persisted);
    mutate(tampered);
    const tamperContext = await browser.newContext({
      viewport: { width: 1024, height: 720 },
      colorScheme: "dark",
      storageState: {
        cookies: [],
        origins: [
          {
            origin: new URL(baseURL).origin,
            localStorage: [
              {
                name: "cinderline.autosave.v6",
                value: JSON.stringify(tampered),
              },
            ],
          },
        ],
      },
    });
    const tamperPage = await tamperContext.newPage();
    const tamperWarnings = [];
    tamperPage.on("pageerror", (error) =>
      errors.push(`tamper ${name} pageerror: ${error.message}`),
    );
    tamperPage.on("console", (message) => {
      if (message.type() === "warning") {
        tamperWarnings.push(message.text());
      }
    });
    await tamperPage.goto(baseURL, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await tamperPage.waitForFunction(
      () => Boolean(window.__CINDERLINE__?.stats().entityCount),
      null,
      { timeout: 10_000 },
    );
    const rejected = await tamperPage.evaluate(() => ({
      entities: window.__CINDERLINE__?.stats().entityCount,
      alloy: window.__CINDERLINE__?.alloy,
      revision: window.__CINDERLINE__?.progression.revision,
    }));
    assert(
      rejected.entities === 11 &&
        rejected.alloy === 240 &&
        rejected.revision === 0 &&
        tamperWarnings.some((warning) =>
          warning.includes("could not be restored")
        ),
      `Tampered ${name} save was not rejected to a clean campaign: ${JSON.stringify(rejected)}.`,
    );
    await tamperContext.close();
  }

  const blackStartContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: "dark",
  });
  const blackStartPage = await blackStartContext.newPage();
  blackStartPage.on("pageerror", (error) =>
    errors.push(`black-start pageerror: ${error.message}`),
  );
  await blackStartPage.goto(`${baseURL}/?fresh=black-start`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await blackStartPage.waitForFunction(
    () => Boolean(window.__CINDERLINE__?.coreGeneratorEntityId),
    null,
    { timeout: 10_000 },
  );
  await blackStartPage.keyboard.press("Space");
  const exhausted = await blackStartPage.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game || game.coreGeneratorEntityId === null) return null;
    game.simulation.step(36_000);
    game.simulation.drainEvents();
    game.selectEntity(game.coreGeneratorEntityId);
    const generator = game.simulation.getEntity(game.coreGeneratorEntityId);
    return {
      capacityKW: game.stats().power.capacityKW,
      coal: generator?.fuel.coal ?? 0,
      fuelEnergyKJ: generator?.fuelEnergyKJ ?? 0,
      status: generator?.status,
      resources: game.stats().resourcesRemaining.coal,
    };
  });
  assert(
    exhausted?.capacityKW === 0 &&
      exhausted.coal === 0 &&
      exhausted.fuelEnergyKJ === 0 &&
      exhausted.status === "noFuel",
    `Starter generator did not reach the intended black-start state: ${JSON.stringify(exhausted)}.`,
  );
  await blackStartPage.keyboard.press("Space");
  const primeButton = blackStartPage.locator(
    "[data-inspector-action='hand-prime-coal']",
  );
  await primeButton.waitFor({ state: "visible", timeout: 5_000 });
  assert(!(await primeButton.isDisabled()), "Black-start coal action was disabled.");
  await blackStartPage.waitForTimeout(320);
  await blackStartPage.screenshot({ path: ".qa/black-start-recovery.png" });
  await primeButton.screenshot({ path: ".qa/black-start-action.png" });
  await primeButton.click();
  const recovered = await blackStartPage.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game || game.coreGeneratorEntityId === null) return null;
    game.simulation.step(1);
    const generator = game.simulation.getEntity(game.coreGeneratorEntityId);
    return {
      capacityKW: game.stats().power.capacityKW,
      coal: generator?.fuel.coal ?? 0,
      fuelEnergyKJ: generator?.fuelEnergyKJ ?? 0,
      resources: game.stats().resourcesRemaining.coal,
    };
  });
  assert(
    recovered &&
      recovered.capacityKW > 0 &&
      recovered.fuelEnergyKJ > 0 &&
      recovered.resources === exhausted.resources - 1,
    `Manual coal prime did not recover the dead grid atomically: ${JSON.stringify(recovered)}.`,
  );
  await blackStartContext.close();

  const custodyRecoveryFixture = structuredClone(persisted);
  custodyRecoveryFixture.simulation.resources =
    custodyRecoveryFixture.simulation.resources.filter(
      (resource) => resource.type !== "coal",
    );
  custodyRecoveryFixture.simulation.produced.coal = 5_376;
  const custodyCore = custodyRecoveryFixture.simulation.entities.find(
    (entity) => entity.id === custodyRecoveryFixture.coreGeneratorEntityId,
  );
  const custodyBeltId = custodyRecoveryFixture.construction.find(
    (entry) => entry.provenance?.source === "paid",
  )?.entityId;
  const custodyBelt = custodyRecoveryFixture.simulation.entities.find(
    (entity) => entity.id === custodyBeltId && entity.kind === "belt",
  );
  assert(custodyCore && custodyBelt, "Could not prepare custody recovery fixture.");
  custodyCore.fuel = {};
  custodyCore.fuelEnergyKJ = 0;
  custodyCore.generatedPowerKW = 0;
  custodyCore.status = "noFuel";
  custodyBelt.beltItems.push({
    id: custodyRecoveryFixture.simulation.nextBeltItemId,
    item: "coal",
    lane: 1,
    progress: 0.1,
  });
  custodyRecoveryFixture.simulation.nextBeltItemId += 1;
  const custodyRecoveryContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: "dark",
    storageState: {
      cookies: [],
      origins: [
        {
          origin: new URL(baseURL).origin,
          localStorage: [
            {
              name: "cinderline.autosave.v6",
              value: JSON.stringify(custodyRecoveryFixture),
            },
          ],
        },
      ],
    },
  });
  const custodyRecoveryPage = await custodyRecoveryContext.newPage();
  await custodyRecoveryPage.goto(baseURL, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await custodyRecoveryPage.waitForFunction(
    () => Boolean(window.__CINDERLINE__?.coreGeneratorEntityId),
    null,
    { timeout: 10_000 },
  );
  await custodyRecoveryPage.keyboard.press("Space");
  await custodyRecoveryPage.evaluate(() => {
    const game = window.__CINDERLINE__;
    game?.selectEntity(game.coreGeneratorEntityId);
  });
  const transferPrimeButton = custodyRecoveryPage.locator(
    "[data-inspector-action='hand-prime-coal']",
  );
  await transferPrimeButton.waitFor({ state: "visible", timeout: 5_000 });
  assert(
    !(await transferPrimeButton.isDisabled()) &&
      (await transferPrimeButton.textContent())?.includes("HAND-TRANSFER"),
    "Seam-depleted black start did not offer physical coal transfer.",
  );
  await transferPrimeButton.click();
  const custodyRecovered = await custodyRecoveryPage.evaluate((beltId) => {
    const game = window.__CINDERLINE__;
    if (!game || game.coreGeneratorEntityId === null) return null;
    game.simulation.step(1);
    const core = game.simulation.getEntity(game.coreGeneratorEntityId);
    const belt = game.simulation.getEntity(beltId);
    return {
      capacityKW: game.stats().power.capacityKW,
      fuelEnergyKJ: core?.fuelEnergyKJ ?? 0,
      beltCoal: belt?.beltItems.filter((item) => item.item === "coal").length,
      remainingCoal: game.stats().resourcesRemaining.coal,
    };
  }, custodyBeltId);
  assert(
    custodyRecovered &&
      custodyRecovered.capacityKW > 0 &&
      custodyRecovered.fuelEnergyKJ > 0 &&
      custodyRecovered.beltCoal === 0 &&
      custodyRecovered.remainingCoal === 0,
    `Physical-coal black start did not preserve custody and recover power: ${JSON.stringify(custodyRecovered)}.`,
  );
  await custodyRecoveryContext.close();

  const uplinkContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  const uplinkPage = await uplinkContext.newPage();
  uplinkPage.on("pageerror", (error) =>
    errors.push(`uplink pageerror: ${error.message}`),
  );
  await uplinkPage.goto(`${baseURL}/?fresh=uplink-transaction`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await uplinkPage.waitForFunction(
    () => Boolean(window.__CINDERLINE__?.uplinkEntityId),
    null,
    { timeout: 10_000 },
  );
  assert(
    await uplinkPage.locator("[data-build='fabricator']").isDisabled(),
    "Fabricator was not locked before the Bootstrap commission.",
  );
  await uplinkPage.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game || game.uplinkEntityId === null) {
      throw new Error("Uplink QA bridge is unavailable.");
    }
    game.simulation.receive(
      game.uplinkEntityId,
      "ironPlate",
      24,
      "inventory",
    );
    game.simulation.receive(
      game.uplinkEntityId,
      "copperPlate",
      12,
      "inventory",
    );
    game.simulation.receive(
      game.uplinkEntityId,
      "stoneBrick",
      12,
      "inventory",
    );
  });
  await uplinkPage.waitForFunction(
    () =>
      window.__CINDERLINE__?.uplinkInventory.entries.reduce(
        (sum, entry) => sum + entry.count,
        0,
      ) === 48,
    null,
    { timeout: 5_000 },
  );
  const delivered = await uplinkPage.evaluate(() => {
    const game = window.__CINDERLINE__;
    const depot =
      game?.uplinkEntityId === null || game?.uplinkEntityId === undefined
        ? undefined
        : game.simulation.getEntity(game.uplinkEntityId);
    return {
      manifest: game?.uplinkInventory.entries,
      physicalCount: depot
        ? Object.values(depot.inventory).reduce(
            (sum, count) => sum + (count ?? 0),
            0,
          )
        : -1,
    };
  });
  assert(
    delivered.physicalCount === 0 &&
      delivered.manifest?.length === 3,
    "Uplink delivery was duplicated between depot storage and secure manifest.",
  );
  await uplinkPage.locator("[data-action='commission-submit']").click();
  await uplinkPage.waitForFunction(
    () =>
      window.__CINDERLINE__?.progression.commissions[0]?.completionCount === 1,
    null,
    { timeout: 5_000 },
  );
  const completedBootstrap = await uplinkPage.evaluate(() => ({
    alloy: window.__CINDERLINE__?.alloy,
    selected: window.__CINDERLINE__?.progression.selectedCommissionId,
    cargo: window.__CINDERLINE__?.uplinkInventory.entries.length,
    fabricatorUnlocked:
      window.__CINDERLINE__?.progression.unlockedBuildKinds.includes(
        "fabricator",
      ),
  }));
  assert(
    completedBootstrap.alloy === 540 &&
      completedBootstrap.selected === null &&
      completedBootstrap.cargo === 0 &&
      completedBootstrap.fabricatorUnlocked === true,
    `Bootstrap transaction was not atomic: ${JSON.stringify(completedBootstrap)}.`,
  );
  assert(
    !(await uplinkPage.locator("[data-build='fabricator']").isDisabled()),
    "Fabricator palette did not enable after Bootstrap.",
  );
  await uplinkPage.locator("[data-build='fabricator']").click();
  const fabricatorCandidate = await uplinkPage.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game) return null;
    const points = [
      [950, 650],
      [1080, 690],
      [850, 720],
      [1130, 520],
      [760, 610],
    ];
    for (const [clientX, clientY] of points) {
      const cell = game.renderer.screenToGrid(clientX, clientY);
      if (
        cell &&
        game.simulation.canPlace("fabricator", cell.x, cell.z, 1).ok
      ) {
        return { clientX, clientY };
      }
    }
    return null;
  });
  assert(fabricatorCandidate, "Could not find a visible Bootstrap fabricator site.");
  await uplinkPage.mouse.click(
    fabricatorCandidate.clientX,
    fabricatorCandidate.clientY,
  );
  await uplinkPage.waitForFunction(
    () => window.__CINDERLINE__?.stats().entityCounts.fabricator === 1,
    null,
    { timeout: 5_000 },
  );
  const unlockedRecipeFixture = await uplinkPage.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game) return null;
    // This control fixture injected finished cargo through the QA bridge
    // instead of producing it. Reconcile that deliberate test-only mutation
    // before exercising the product's self-validating save path.
    game.simulation.produced.ironPlate = 1_000;
    game.simulation.produced.copperPlate = 1_000;
    game.simulation.produced.stoneBrick = 1_000;
    window.dispatchEvent(new Event("beforeunload"));
    const raw = localStorage.getItem("cinderline.autosave.v6");
    return raw ? JSON.parse(raw) : null;
  });
  assert(unlockedRecipeFixture, "Bootstrap fabricator session was not saved.");
  await uplinkContext.close();

  const recipeControlContext = await browser.newContext({
    viewport: { width: 1024, height: 720 },
    colorScheme: "dark",
    storageState: {
      cookies: [],
      origins: [
        {
          origin: new URL(baseURL).origin,
          localStorage: [
            {
              name: "cinderline.autosave.v6",
              value: JSON.stringify(unlockedRecipeFixture),
            },
          ],
        },
      ],
    },
  });
  const recipeControlPage = await recipeControlContext.newPage();
  await recipeControlPage.goto(baseURL, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await recipeControlPage.waitForFunction(
    () => Boolean(window.__CINDERLINE__?.stats().entityCount),
    null,
    { timeout: 10_000 },
  );
  const recipeControl = await recipeControlPage.evaluate(() => ({
    entities: window.__CINDERLINE__?.stats().entityCount,
    alloy: window.__CINDERLINE__?.alloy,
    bootstrap:
      window.__CINDERLINE__?.progression.commissions[0]?.completionCount,
  }));
  assert(
    recipeControl.entities === 12 &&
      recipeControl.alloy === 350 &&
      recipeControl.bootstrap === 1,
    `Compatible Bootstrap control save was not accepted: ${JSON.stringify(recipeControl)}.`,
  );
  await recipeControlContext.close();

  const lockedRecipeFixture = structuredClone(unlockedRecipeFixture);
  const lockedFabricator = lockedRecipeFixture.simulation.entities.find(
    (entity) => entity.kind === "fabricator",
  );
  assert(lockedFabricator, "Locked-recipe fixture lost its fabricator.");
  lockedFabricator.recipeId = "automationCore";
  const lockedRecipeContext = await browser.newContext({
    viewport: { width: 1024, height: 720 },
    colorScheme: "dark",
    storageState: {
      cookies: [],
      origins: [
        {
          origin: new URL(baseURL).origin,
          localStorage: [
            {
              name: "cinderline.autosave.v6",
              value: JSON.stringify(lockedRecipeFixture),
            },
          ],
        },
      ],
    },
  });
  const lockedRecipePage = await lockedRecipeContext.newPage();
  const lockedRecipeWarnings = [];
  lockedRecipePage.on("console", (message) => {
    if (message.type() === "warning") lockedRecipeWarnings.push(message.text());
  });
  await lockedRecipePage.goto(baseURL, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await lockedRecipePage.waitForFunction(
    () => Boolean(window.__CINDERLINE__?.stats().entityCount),
    null,
    { timeout: 10_000 },
  );
  const lockedRecipeRejected = await lockedRecipePage.evaluate(() => ({
    entities: window.__CINDERLINE__?.stats().entityCount,
    alloy: window.__CINDERLINE__?.alloy,
    revision: window.__CINDERLINE__?.progression.revision,
  }));
  assert(
    lockedRecipeRejected.entities === 11 &&
      lockedRecipeRejected.alloy === 240 &&
      lockedRecipeRejected.revision === 0 &&
      lockedRecipeWarnings.some((warning) =>
        warning.includes("could not be restored")
      ),
    `Machine-compatible locked recipe was not rejected by campaign semantics: ${JSON.stringify(lockedRecipeRejected)}.`,
  );
  await lockedRecipeContext.close();

  await page.goto(baseURL, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => document.querySelector("#boot")?.classList.contains("is-done"),
    null,
    { timeout: 10_000 },
  );
  await page.waitForFunction(
    () => Boolean(window.__CINDERLINE__?.stats().entityCount),
    null,
    { timeout: 10_000 },
  );
  const afterReload = await page.evaluate(
    () => window.__CINDERLINE__?.stats().entityCount ?? 0,
  );
  const alloyAfterReload = await readAlloy(page);
  assert(
    afterReload === beforePlacement + 1 && alloyAfterReload === 238,
    `Reload did not restore the session atomically (entities ${afterReload}, alloy ${alloyAfterReload}, warnings ${JSON.stringify(warnings)}).`,
  );

  const version4 = structuredClone(persisted);
  const version4Paid = version4.construction.find(
    (entry) => entry.provenance?.source === "paid",
  );
  assert(version4Paid, "Could not prepare a paid v4 migration fixture.");
  version4.version = 4;
  delete version4.origin;
  delete version4.coreGeneratorEntityId;
  // A genuine v4 wrapper predates the v7 circuit snapshot and v8 rail
  // snapshot. Downgrade the nested fixture to the last pre-circuit schema so
  // migration rebuilds endpoint custody from its surviving entities instead
  // of retaining deliberately removed v8 endpoints.
  version4.simulation.version = 6;
  version4.simulation.catalogVersion = "cinderline-6";
  delete version4.simulation.circuitNetwork;
  delete version4.simulation.railNetwork;
  delete version4.simulation.railStationInterfaces;
  version4.simulation.entities = version4.simulation.entities.filter(
    (entity) =>
      entity.id !== 1 && entity.id !== version4Paid.entityId,
  );
  version4.construction = version4.construction.filter(
    (entry) =>
      entry.entityId !== 1 && entry.entityId !== version4Paid.entityId,
  );
  version4.progression.alloy = 239;
  version4.progression.revision = 3;
  const version4Context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    colorScheme: "dark",
    storageState: {
      cookies: [],
      origins: [
        {
          origin: new URL(baseURL).origin,
          localStorage: [
            {
              name: "cinderline.autosave.v4",
              value: JSON.stringify(version4),
            },
          ],
        },
      ],
    },
  });
  const version4Page = await version4Context.newPage();
  version4Page.on("pageerror", (error) =>
    errors.push(`v4 migration pageerror: ${error.message}`),
  );
  await version4Page.goto(baseURL, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await version4Page.waitForFunction(
    () => Boolean(window.__CINDERLINE__?.stats().entityCount),
    null,
    { timeout: 10_000 },
  );
  const version4Migration = await version4Page.evaluate(() => {
    const game = window.__CINDERLINE__;
    const core =
      game?.coreGeneratorEntityId === null ||
      game?.coreGeneratorEntityId === undefined
        ? undefined
        : game.simulation.getEntity(game.coreGeneratorEntityId);
    window.dispatchEvent(new Event("beforeunload"));
    const raw = localStorage.getItem("cinderline.autosave.v6");
    const saved = raw ? JSON.parse(raw) : null;
    return {
      entityCount: game?.stats().entityCount,
      alloy: game?.alloy,
      coreId: game?.coreGeneratorEntityId,
      coreKind: core?.kind,
      savedVersion: saved?.version,
      savedCoreId: saved?.coreGeneratorEntityId,
    };
  });
  assert(
    version4Migration.entityCount === 11 &&
      version4Migration.alloy === 240 &&
      Number.isSafeInteger(version4Migration.coreId) &&
      version4Migration.coreId !== 1 &&
      version4Migration.coreKind === "generator" &&
      version4Migration.savedVersion === 6 &&
      version4Migration.savedCoreId === version4Migration.coreId,
    `v4 campaign did not migrate, refund, and recover its core generator: ${JSON.stringify(version4Migration)}.`,
  );
  await version4Context.close();

  const legacyContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    colorScheme: "dark",
    storageState: {
      cookies: [],
      origins: [
        {
          origin: new URL(baseURL).origin,
          localStorage: [
            {
              name: "cinderline.autosave.v2",
              value: JSON.stringify(persisted.simulation),
            },
          ],
        },
      ],
    },
  });
  const legacyPage = await legacyContext.newPage();
  legacyPage.on("pageerror", (error) =>
    errors.push(`legacy pageerror: ${error.message}`),
  );
  legacyPage.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`legacy console: ${message.text()}`);
    }
  });
  await legacyPage.goto(baseURL, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await legacyPage.waitForFunction(
    () => document.querySelector("#boot")?.classList.contains("is-done"),
    null,
    { timeout: 10_000 },
  );
  const legacyMigration = {
    entityCount: await legacyPage.evaluate(
      () => window.__CINDERLINE__?.stats().entityCount ?? 0,
    ),
    alloy: await readAlloy(legacyPage),
  };
  assert(
    legacyMigration.entityCount === afterReload &&
      legacyMigration.alloy === 3_200,
    `Legacy v2 raw save did not migrate safely (entities ${legacyMigration.entityCount}, alloy ${legacyMigration.alloy}).`,
  );
  await legacyContext.close();

  const routingContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
  });
  const routingPage = await routingContext.newPage();
  routingPage.on("pageerror", (error) =>
    errors.push(`blueprint routing pageerror: ${error.message}`),
  );
  routingPage.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`blueprint routing console: ${message.text()}`);
    }
    if (message.type() === "warning") {
      warnings.push(`blueprint routing: ${message.text()}`);
    }
  });
  await routingPage.goto(`${baseURL}/?showcase=blueprint-routing`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await routingPage.waitForFunction(
    () => Boolean(window.__CINDERLINE__?.stats().entityCount),
    null,
    { timeout: 10_000 },
  );
  await routingPage.keyboard.press("Space");
  await routingPage.locator("[data-build='manifold']").click();
  const routingSourceSite = await findBuildDestination(
    routingPage,
    "manifold",
  );
  assert(
    routingSourceSite,
    "Could not find an isolated player-buildable manifold source site.",
  );
  await routingPage.mouse.click(
    routingSourceSite.clientX,
    routingSourceSite.clientY,
  );
  await routingPage.waitForFunction(
    ({ x, y }) =>
      window.__CINDERLINE__?.simulation.getEntityAt(x, y)?.kind ===
        "manifold",
    routingSourceSite.cell,
    { timeout: 5_000 },
  );
  await routingPage.keyboard.press("Escape");
  const routingSource = await routingPage.evaluate(({ x, y }) => {
    const game = window.__CINDERLINE__;
    if (!game) return null;
    const entity = game.simulation.getEntityAt(x, y);
    if (!entity || entity.kind !== "manifold") return null;
    const configured = game.simulation.setManifoldRouting(
      entity.id,
      { mode: "even", extractPort: 1 },
    );
    return configured ? { id: entity.id, x, y } : null;
  }, routingSourceSite.cell);
  assert(routingSource, "Could not prepare an isolated manifold blueprint source.");

  await routingPage.evaluate(
    (entityId) => window.__CINDERLINE__?.selectEntity(entityId),
    routingSource.id,
  );
  await routingPage.keyboard.press("Control+C");
  await routingPage.waitForFunction(
    () =>
      window.__CINDERLINE__?.blueprint.clipboard?.entities[0]
        ?.manifoldRouting?.extractPort === 1,
    null,
    { timeout: 5_000 },
  );
  const beforeVerticalMirror = await routingPage.evaluate(() =>
    localStorage.getItem("cinderline.blueprint.v2"),
  );
  await routingPage.keyboard.press("Shift+m");
  await routingPage.waitForFunction(
    () =>
      window.__CINDERLINE__?.blueprint.clipboard?.entities[0]
        ?.manifoldRouting?.extractPort === 0,
    null,
    { timeout: 5_000 },
  );
  await routingPage.keyboard.press("Shift+m");
  await routingPage.waitForFunction(
    () =>
      window.__CINDERLINE__?.blueprint.clipboard?.entities[0]
        ?.manifoldRouting?.extractPort === 1,
    null,
    { timeout: 5_000 },
  );
  assert(
    (await routingPage.evaluate(() =>
      localStorage.getItem("cinderline.blueprint.v2"),
    )) === beforeVerticalMirror,
    "Two vertical mirror hotkeys did not restore byte-identical clipboard intent.",
  );
  const evenDestination = await findBlueprintDestination(routingPage);
  assert(evenDestination, "Could not find an Even-B blueprint destination.");
  await routingPage.mouse.click(
    evenDestination.clientX,
    evenDestination.clientY,
  );
  await routingPage.waitForTimeout(180);
  const pastedEvenRouting = await routingPage.evaluate(
    ({ x, y }) =>
      window.__CINDERLINE__?.simulation.getEntityAt(x, y)?.manifoldRouting,
    evenDestination.placement,
  );
  assert(
    pastedEvenRouting?.mode === "even" &&
      pastedEvenRouting.extractPort === 1,
    `Even-B blueprint paste lost latent branch state: ${JSON.stringify(pastedEvenRouting)}.`,
  );
  const reapplyPreview = await routingPage.evaluate(({ x, y }) => {
    const game = window.__CINDERLINE__;
    const entity = game?.simulation.getEntityAt(x, y);
    if (!game || !entity) return null;
    if (
      !game.simulation.setManifoldRouting(entity.id, {
        mode: "favorA",
        extractPort: 0,
      })
    ) {
      return null;
    }
    return {
      preview: game.previewBlueprint(x, y),
      entityCount: game.stats().entityCount,
      alloy: game.alloy,
    };
  }, evenDestination.placement);
  assert(
    reapplyPreview?.preview.ok === true &&
      reapplyPreview.preview.cost === 0 &&
      reapplyPreview.preview.diagnostics.length === 1 &&
      reapplyPreview.preview.diagnostics[0]?.action === "configure",
    `Exact-entity blueprint configuration was not classified as a zero-cost reapply: ${JSON.stringify(reapplyPreview)}.`,
  );
  await routingPage.mouse.click(
    evenDestination.clientX,
    evenDestination.clientY,
  );
  await routingPage.waitForTimeout(180);
  const reappliedEvenRouting = await routingPage.evaluate(
    ({ x, y }) => {
      const game = window.__CINDERLINE__;
      return {
        routing: game?.simulation.getEntityAt(x, y)?.manifoldRouting,
        entityCount: game?.stats().entityCount,
        alloy: game?.alloy,
      };
    },
    evenDestination.placement,
  );
  assert(
    reappliedEvenRouting.routing?.mode === "even" &&
      reappliedEvenRouting.routing.extractPort === 1 &&
      reappliedEvenRouting.entityCount === reapplyPreview.entityCount &&
      reappliedEvenRouting.alloy === reapplyPreview.alloy,
    `Blueprint configuration reapply was not atomic and zero-cost: ${JSON.stringify(reappliedEvenRouting)}.`,
  );
  await routingPage.keyboard.press("Escape");

  await routingPage.evaluate(
    ({ id }) => {
      const game = window.__CINDERLINE__;
      game?.simulation.setManifoldRouting(id, {
        mode: "extract",
        filter: "copperOre",
        extractPort: 0,
      });
      game?.selectEntity(id);
    },
    routingSource,
  );
  await routingPage.keyboard.press("Control+C");
  await routingPage.keyboard.press("m");
  await routingPage.waitForFunction(
    () => {
      const routing =
        window.__CINDERLINE__?.blueprint.clipboard?.entities[0]
          ?.manifoldRouting;
      return routing?.mode === "extract" && routing.extractPort === 1;
    },
    null,
    { timeout: 5_000 },
  );
  const extractDestination = await findBlueprintDestination(routingPage);
  assert(
    extractDestination,
    "Could not find a mirrored Extract-B blueprint destination.",
  );
  await routingPage.mouse.click(
    extractDestination.clientX,
    extractDestination.clientY,
  );
  await routingPage.waitForTimeout(180);
  const pastedExtractRouting = await routingPage.evaluate(
    ({ x, y }) =>
      window.__CINDERLINE__?.simulation.getEntityAt(x, y)?.manifoldRouting,
    extractDestination.placement,
  );
  assert(
    pastedExtractRouting?.mode === "extract" &&
      pastedExtractRouting.filter === "copperOre" &&
      pastedExtractRouting.extractPort === 1,
    `Mirrored Extract-B blueprint paste changed routing: ${JSON.stringify(pastedExtractRouting)}.`,
  );

  const legacyBlueprintBytes = await routingPage.evaluate(() => {
    const raw = localStorage.getItem("cinderline.blueprint.v2");
    if (!raw) return null;
    const legacy = JSON.parse(raw);
    legacy.version = 1;
    delete legacy.wires;
    delete legacy.rail;
    for (const entity of legacy.entities) {
      delete entity.ref;
      delete entity.fluidId;
      delete entity.fluidRecipeId;
      delete entity.circuitDevice;
      delete entity.circuitMachine;
      if (entity.manifoldRouting) delete entity.manifoldRouting.extractPort;
    }
    return JSON.stringify(legacy);
  });
  assert(legacyBlueprintBytes, "Blueprint v1 migration fixture was not created.");
  await routingContext.close();

  const blueprintMigrationContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    colorScheme: "dark",
    storageState: {
      cookies: [],
      origins: [
        {
          origin: new URL(baseURL).origin,
          localStorage: [
            {
              name: "cinderline.blueprint.v1",
              value: legacyBlueprintBytes,
            },
          ],
        },
      ],
    },
  });
  const blueprintMigrationPage = await blueprintMigrationContext.newPage();
  blueprintMigrationPage.on("pageerror", (error) =>
    errors.push(`blueprint migration pageerror: ${error.message}`),
  );
  await blueprintMigrationPage.goto(`${baseURL}/?showcase=blueprint-migration`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await blueprintMigrationPage.waitForFunction(
    () => Boolean(window.__CINDERLINE__?.blueprint.clipboard),
    null,
    { timeout: 10_000 },
  );
  const blueprintMigration = await blueprintMigrationPage.evaluate(() => {
    const clipboard = window.__CINDERLINE__?.blueprint.clipboard;
    const current = localStorage.getItem("cinderline.blueprint.v2");
    return {
      version: clipboard?.version,
      extractPort:
        clipboard?.entities[0]?.manifoldRouting?.extractPort,
      savedVersion: current ? JSON.parse(current).version : null,
      legacyRemoved:
        localStorage.getItem("cinderline.blueprint.v1") === null,
    };
  });
  assert(
    blueprintMigration.version === 3 &&
      blueprintMigration.extractPort === 0 &&
      blueprintMigration.savedVersion === 3 &&
      blueprintMigration.legacyRemoved,
    `Blueprint v1 did not migrate atomically into the current storage slot: ${JSON.stringify(blueprintMigration)}.`,
  );
  await blueprintMigrationContext.close();

  await page.keyboard.press("Escape");
  await page.mouse.wheel(0, -320);
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(180);
  await page.keyboard.up("KeyD");

  const frameTiming = await page.evaluate(async () => {
    const gaps = [];
    await new Promise((resolve) => {
      let previous = performance.now();
      let count = 0;
      const sample = (now) => {
        gaps.push(now - previous);
        previous = now;
        count += 1;
        if (count >= 120) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    gaps.shift();
    gaps.sort((a, b) => a - b);
    return {
      meanMs: gaps.reduce((sum, value) => sum + value, 0) / gaps.length,
      p95Ms: gaps[Math.floor(gaps.length * 0.95)],
      maxMs: gaps.at(-1),
    };
  });

  await page.waitForTimeout(5_000);
  await page.screenshot({ path: ".qa/current-1920.png" });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(350);
  const overflow = await page.evaluate(() => ({
    bodyX: document.body.scrollWidth - document.body.clientWidth,
    bodyY: document.body.scrollHeight - document.body.clientHeight,
    dockBottom: document
      .querySelector(".build-dock")
      ?.getBoundingClientRect().bottom,
    inspectorRight: document
      .querySelector(".inspector")
      ?.getBoundingClientRect().right,
  }));
  assert(overflow.bodyX <= 0 && overflow.bodyY <= 0, "Responsive HUD causes document overflow.");
  assert(
    (overflow.dockBottom ?? 0) <= 768,
    "Build dock leaves the 1366×768 viewport.",
  );
  await page.screenshot({ path: ".qa/current-1366.png" });

  const final = await page.evaluate(() => window.__CINDERLINE__?.stats());
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: errors.length === 0,
        initial: {
          entityCount: initial.entityCount,
          beltItems: initial.beltItemCount,
          power: initial.power,
          alloy: initialAlloy,
        },
        final: {
          tick: final?.tick,
          produced: final?.produced,
          alloy: await readAlloy(page),
        },
        version4Migration,
        legacyMigration,
        frameTiming,
        responsive: overflow,
        warnings,
        errors,
      },
      null,
      2,
    )}\n`,
  );

  assert(errors.length === 0, `Browser emitted errors:\n${errors.join("\n")}`);
  await context.close();
} finally {
  await browser.close();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function findBuildDestination(page, kind) {
  const target = await page.evaluate((buildKind) => {
    const game = window.__CINDERLINE__;
    if (!game) return null;
    for (let y = 0; y < game.simulation.height; y += 1) {
      for (let x = 0; x < game.simulation.width; x += 1) {
        if (game.simulation.canPlace(buildKind, x, y, 1).ok) {
          game.renderer.focus(x, y);
          return { x, y };
        }
      }
    }
    return null;
  }, kind);
  if (!target) return null;
  await page.waitForTimeout(120);
  return page.evaluate(({ buildKind, targetCell }) => {
    const game = window.__CINDERLINE__;
    if (!game) return null;
    for (let clientY = 20; clientY < window.innerHeight - 20; clientY += 4) {
      for (let clientX = 20; clientX < window.innerWidth - 20; clientX += 4) {
        if (document.elementFromPoint(clientX, clientY)?.id !== "world") {
          continue;
        }
        const cell = game.renderer.screenToGrid(clientX, clientY);
        if (
          cell?.x === targetCell.x &&
          cell.z === targetCell.y &&
          game.simulation.canPlace(buildKind, cell.x, cell.z, 1).ok
        ) {
          return { clientX, clientY, cell: { x: cell.x, y: cell.z } };
        }
      }
    }
    return null;
  }, { buildKind: kind, targetCell: target });
}

async function findBlueprintDestination(page) {
  const scanVisibleWorld = () => page.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game) return null;
    const seen = new Set();
    for (let clientY = 24; clientY < window.innerHeight - 24; clientY += 8) {
      for (let clientX = 24; clientX < window.innerWidth - 24; clientX += 8) {
        if (document.elementFromPoint(clientX, clientY)?.id !== "world") {
          continue;
        }
        const cell = game.renderer.screenToGrid(clientX, clientY);
        if (!cell) continue;
        const key = `${cell.x},${cell.z}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const preview = game.previewBlueprint(cell.x, cell.z);
        const placement = preview.plan.placements[0];
        if (
          preview.ok &&
          preview.cost > 0 &&
          placement &&
          preview.diagnostics.length === 1 &&
          preview.diagnostics[0]?.ok &&
          preview.diagnostics[0].action === "construct"
        ) {
          return {
            clientX,
            clientY,
            placement: { x: placement.x, y: placement.y },
          };
        }
      }
    }
    return null;
  });
  const visible = await scanVisibleWorld();
  if (visible) return visible;

  // Dense showcase revisions can legitimately fill the initial camera frame.
  // Locate a valid world-space destination with the authoritative preflight,
  // focus it, and then resolve a real clickable canvas coordinate. This keeps
  // the test user-input driven without coupling it to one camera composition.
  const focused = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game) return false;
    for (let y = 0; y < game.simulation.height; y += 1) {
      for (let x = 0; x < game.simulation.width; x += 1) {
        const preview = game.previewBlueprint(x, y);
        if (
          preview.ok &&
          preview.cost > 0 &&
          preview.plan.placements.length === 1 &&
          preview.diagnostics.length === 1 &&
          preview.diagnostics[0]?.ok &&
          preview.diagnostics[0].action === "construct"
        ) {
          game.renderer.focus(x, y);
          return true;
        }
      }
    }
    return false;
  });
  if (!focused) return null;
  await page.waitForTimeout(120);
  return scanVisibleWorld();
}

async function readAlloy(page) {
  return page.evaluate(() => window.__CINDERLINE__?.alloy ?? Number.NaN);
}
