import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY = ".qa/process-console";
const DESKTOP_VIEWPORTS = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1366x768", width: 1366, height: 768 },
];
const FABRICATOR_RECIPE_IDS = [
  "ironGear",
  "copperWire",
  "circuit",
  "automationCore",
];
const ITEM_IDS = [
  "ironOre",
  "copperOre",
  "coal",
  "stone",
  "ironPlate",
  "copperPlate",
  "stoneBrick",
  "ironGear",
  "copperWire",
  "circuit",
  "automationCore",
];

await mkdir(OUTPUT_DIRECTORY, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = {
  ok: true,
  captures: [],
  stateSignatures: {},
  focusIsolation: [],
  toastClearance: [],
  transitionOrders: [],
  performance: null,
  mobile: null,
};

try {
  for (const viewport of DESKTOP_VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const consoleFailures = [];
    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") {
        consoleFailures.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) =>
      consoleFailures.push(`pageerror: ${error.message}`),
    );

    await page.goto(
      `${BASE_URL}/?showcase&fresh=process-console-${viewport.name}-${Date.now()}`,
      {
        waitUntil: "networkidle",
        timeout: 30_000,
      },
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#boot")?.classList.contains("is-done") &&
        Boolean(window.__CINDERLINE__?.simulation),
      undefined,
      { timeout: 15_000 },
    );
    await page.keyboard.press("Space");

    const fixture = await page.evaluate(() => {
      const game = window.__CINDERLINE__;
      const simulation = game?.simulation;
      if (!game || !simulation) {
        throw new Error("Process-console QA bridge unavailable.");
      }
      const existing = simulation.getEntities();
      const originalFabricator = existing.find(
        (entity) => entity.kind === "fabricator",
      );
      const originalGenerator = existing.find(
        (entity) => entity.kind === "generator",
      );
      const originalStorage = existing.find(
        (entity) => entity.kind === "storage",
      );
      const originalSmelter = existing.find(
        (entity) => entity.kind === "smelter",
      );
      if (
        !originalFabricator ||
        !originalGenerator ||
        !originalStorage ||
        !originalSmelter
      ) {
        throw new Error("Demo does not contain the required QA footprints.");
      }
      // The console fixture intentionally isolates one generator and one
      // process machine semantically. Retain the showcase's entity identities
      // so the atomic construction ledger remains valid across real Ctrl+Z
      // restores; direct remove/place fixtures would manufacture untracked
      // construction after the campaign-ledger migration.
      simulation.powerMode = "legacyGlobal";
      const fabricator = simulation.entities.get(originalFabricator.id);
      const storage = simulation.entities.get(originalStorage.id);
      const smelter = simulation.entities.get(originalSmelter.id);
      if (!fabricator || !storage || !smelter) {
        throw new Error("Showcase QA identities disappeared.");
      }
      fabricator.recipeId = undefined;
      fabricator.activeRecipeId = undefined;
      fabricator.pendingRecipeId = undefined;
      fabricator.recipeChangeQueued = false;
      fabricator.input = {};
      fabricator.output = {};
      fabricator.reclaim = {};
      fabricator.progress = 0;
      fabricator.status = "unconfigured";
      fabricator.powerSatisfaction = 1;
      // Keep the showcase construction ledger exact while making the chosen
      // machine a real isolated process fixture. `health` is renderer-only and
      // does not stop authoritative inserter transfers; rotate every inserter
      // whose pickup or drop contact touches this fabricator instead. Rotation
      // is a normal simulation mutation, preserves entity identity/kind for
      // Ctrl+Z provenance, and leaves the one-tile footprint unchanged.
      const touchesFabricator = (point) =>
        point.x >= fabricator.x &&
        point.x < fabricator.x + fabricator.width &&
        point.y >= fabricator.y &&
        point.y < fabricator.y + fabricator.height;
      const contactFor = (entity, front) => {
        const distance = front ? 1 : -1;
        if (entity.direction === 0) {
          return { x: entity.x, y: entity.y - distance };
        }
        if (entity.direction === 1) {
          return { x: entity.x + distance, y: entity.y };
        }
        if (entity.direction === 2) {
          return { x: entity.x, y: entity.y + distance };
        }
        return { x: entity.x - distance, y: entity.y };
      };
      for (const candidate of existing) {
        if (candidate.kind !== "inserter") continue;
        let live = simulation.entities.get(candidate.id);
        let guard = 0;
        while (
          live &&
          (touchesFabricator(contactFor(live, true)) ||
            touchesFabricator(contactFor(live, false))) &&
          guard++ < 4
        ) {
          const rotated = simulation.rotate(live.x, live.y, true);
          if (!rotated.ok) {
            throw new Error("Could not isolate the process-console inserter.");
          }
          live = simulation.entities.get(candidate.id);
        }
        if (
          live &&
          (touchesFabricator(contactFor(live, true)) ||
            touchesFabricator(contactFor(live, false)))
        ) {
          throw new Error("Process-console inserter remained attached.");
        }
      }
      storage.inventory = {};
      smelter.recipeId = undefined;
      smelter.activeRecipeId = undefined;
      smelter.pendingRecipeId = undefined;
      smelter.recipeChangeQueued = false;
      smelter.input = {};
      smelter.output = {};
      smelter.reclaim = {};
      smelter.progress = 0;
      smelter.status = "missingInput";
      smelter.powerSatisfaction = 1;
      const generator = simulation.entities.get(originalGenerator.id);
      if (!generator || generator.kind !== "generator") {
        throw new Error("Showcase QA generator disappeared.");
      }
      generator.fuel = {};
      generator.fuelEnergyKJ = 0;
      if (simulation.receive(originalGenerator.id, "coal", 1, "fuel") !== 1) {
        throw new Error("Could not fuel the QA generator.");
      }
      simulation.step(2);
      simulation.drainEvents();

      const audioEvents = [];
      const originalMachineAccent = game.audio.machineAccent.bind(game.audio);
      const originalRotate = game.audio.rotate.bind(game.audio);
      game.audio.machineAccent = (...args) => {
        audioEvents.push({ type: "machineAccent", args });
        return originalMachineAccent(...args);
      };
      game.audio.rotate = (...args) => {
        audioEvents.push({ type: "rotate", args });
        return originalRotate(...args);
      };
      window.__PROCESS_CONSOLE_AUDIO_EVENTS__ = audioEvents;

      document.querySelector("#boot")?.remove();
      const pausePlate = document.querySelector("[data-ref='pause-plate']");
      if (pausePlate instanceof HTMLElement) pausePlate.style.display = "none";
      document
        .querySelectorAll("[data-ref='toast-stack'] > *")
        .forEach((element) => element.remove());
      game.renderer.focus(
        fabricator.x + fabricator.width * 0.5,
        fabricator.y + fabricator.height * 0.5,
      );
      for (let step = 0; step < 4; step += 1) game.renderer.zoom(-4);
      game.refreshHUD();
      return {
        fabricatorId: fabricator.id,
        storageId: storage.id,
        smelterId: smelter.id,
      };
    });

    await page.waitForTimeout(220);
    const fabricatorPoint = await projectEntity(page, fixture.fabricatorId);
    await page.mouse.click(fabricatorPoint.x, fabricatorPoint.y);
    await page.waitForFunction(
      (id) =>
        document
          .querySelector("[data-ref='inspector']")
          ?.classList.contains("has-process-console") &&
        document.querySelector("[data-ref='process-console']")
          ?.getAttribute("data-process-state") === "unconfigured" &&
        window.__CINDERLINE__?.simulation.getEntity(id)?.kind === "fabricator",
      fixture.fabricatorId,
    );
    await page.waitForTimeout(240);

    const identityProof = await page.evaluate(() => {
      const game = window.__CINDERLINE__;
      const before = Array.from(
        document.querySelectorAll("[data-recipe-choice]"),
      );
      for (let refresh = 0; refresh < 300; refresh += 1) game?.refreshHUD();
      const after = Array.from(
        document.querySelectorAll("[data-recipe-choice]"),
      );
      return {
        before: before.length,
        after: after.length,
        preserved:
          before.length === after.length &&
          before.every((element, index) => element === after[index]),
      };
    });
    assert(identityProof.before === 4, "Unconfigured deck did not have four cards.");
    assert(identityProof.preserved, "Recipe card identities changed across 300 HUD refreshes.");

    const focusIsolation = await verifyClosedInspectorIsolation(page);
    report.focusIsolation.push({
      viewport: viewport.name,
      ...focusIsolation,
    });
    await page.mouse.click(fabricatorPoint.x, fabricatorPoint.y);
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-ref='inspector']")
          ?.classList.contains("is-open") &&
        document
          .querySelector("[data-ref='process-console']")
          ?.getAttribute("data-process-state") === "unconfigured",
    );
    await page.waitForTimeout(180);

    const unconfigured = await auditState(
      page,
      fixture.fabricatorId,
      "unconfigured",
      {
        current: [],
        active: [],
        pending: [],
        condition: "Select a recipe to arm this fabricator.",
      },
    );
    report.captures.push(
      await capture(page, viewport.name, "unconfigured", unconfigured),
    );

    await page.locator("[data-recipe-id='copperWire']").click();
    await page.evaluate((id) => {
      const simulation = window.__CINDERLINE__?.simulation;
      simulation?.step();
      window.__CINDERLINE__?.refreshHUD();
      if (simulation?.getEntity(id)?.recipeId !== "copperWire") {
        throw new Error("Real recipe click did not configure Copper wire.");
      }
    }, fixture.fabricatorId);
    await page.waitForFunction(
      () =>
        document.querySelector("[data-ref='process-console']")
          ?.getAttribute("data-process-state") === "starved",
    );
    assert(
      (await page.locator(".toast").innerText()).includes("RECIPE ARMED"),
      "Applied recipe click did not emit the armed toast.",
    );
    report.toastClearance.push({
      viewport: viewport.name,
      state: "starved",
      ...(await assertToastClearOfMap(page, "armed recipe")),
    });
    assert(
      await page.evaluate(() =>
        window.__PROCESS_CONSOLE_AUDIO_EVENTS__?.some(
          (event) => event.type === "machineAccent",
        ),
      ),
      "Applied recipe click did not invoke the machine accent.",
    );
    const starved = await auditState(
      page,
      fixture.fabricatorId,
      "starved",
      {
        current: ["copperWire"],
        active: [],
        pending: [],
        condition: "Waiting for Copper plate — 0 / 1 loaded.",
        formula: "Copper plate ×1 → Copper wire ×2",
      },
    );
    report.captures.push(
      await capture(page, viewport.name, "starved", starved),
    );

    await page.evaluate((id) => {
      const simulation = window.__CINDERLINE__?.simulation;
      if (!simulation) throw new Error("Simulation disappeared.");
      if (simulation.receive(id, "copperPlate", 2, "input") !== 2) {
        throw new Error("Could not load the working/surplus input.");
      }
      simulation.step();
      simulation.drainEvents();
      window.__CINDERLINE__?.refreshHUD();
    }, fixture.fabricatorId);
    await page.waitForFunction(
      (id) =>
        window.__CINDERLINE__?.simulation.getEntity(id)?.activeRecipeId ===
          "copperWire" &&
        document.querySelector("[data-ref='process-console']")
          ?.getAttribute("data-process-state") === "working",
      fixture.fabricatorId,
    );
    const working = await auditState(
      page,
      fixture.fabricatorId,
      "working",
      {
        current: ["copperWire"],
        active: ["copperWire"],
        pending: [],
        condition:
          "Process nominal — the committed batch is in the chamber.",
      },
    );
    assert(
      working.metrics.every((metric) => metric.strong.length > 0),
      "Working telemetry contains an empty metric.",
    );
    assert(
      Number(working.metrics.find((metric) => metric.id === "timing")
        ?.dataset.effectiveSeconds) > 0,
      "Working telemetry did not expose a nonzero effective cycle time.",
    );
    report.captures.push(
      await capture(page, viewport.name, "working", working),
    );

    const circuitCard = page.locator("[data-recipe-id='circuit']");
    await circuitCard.focus();
    await circuitCard.press("Enter");
    await page.waitForFunction(
      (id) =>
        window.__CINDERLINE__?.simulation.getEntity(id)?.pendingRecipeId ===
        "circuit",
      fixture.fabricatorId,
    );
    assert(
      (await page.locator(".toast").innerText()).includes("CHANGE QUEUED"),
      "Keyboard recipe activation did not emit the queued toast.",
    );
    report.toastClearance.push({
      viewport: viewport.name,
      state: "queued",
      ...(await assertToastClearOfMap(page, "queued recipe")),
    });
    const queuedAudioBeforeUndo = await page.evaluate(
      () =>
        window.__PROCESS_CONSOLE_AUDIO_EVENTS__?.filter(
          (event) => event.type === "rotate",
        ).length ?? 0,
    );
    assert(queuedAudioBeforeUndo > 0, "Queued command did not invoke its audio detent.");

    await page.keyboard.press("Control+z");
    await page.waitForFunction(
      (id) =>
        window.__CINDERLINE__?.simulation.getEntity(id)
          ?.recipeChangeQueued === false,
      fixture.fabricatorId,
    );
    const undoFocus = await page.evaluate(() => ({
      recipeId:
        document.activeElement instanceof HTMLElement
          ? document.activeElement.dataset.recipeId
          : undefined,
      consoleOpen: document
        .querySelector("[data-ref='inspector']")
        ?.classList.contains("is-open"),
    }));
    assert(
      undoFocus.recipeId === "circuit" && undoFocus.consoleOpen,
      "Focused Ctrl+Z did not preserve the Circuit card and open console.",
    );
    await circuitCard.press("Enter");
    await page.waitForFunction(
      (id) =>
        window.__CINDERLINE__?.simulation.getEntity(id)?.pendingRecipeId ===
        "circuit",
      fixture.fabricatorId,
    );
    const queued = await auditState(
      page,
      fixture.fabricatorId,
      "queued",
      {
        current: ["copperWire"],
        active: ["copperWire"],
        pending: ["circuit"],
        condition:
          "Change queued — finishing Copper wire before Logic circuit; leftover input will move to RECLAIM.",
      },
    );
    report.captures.push(
      await capture(page, viewport.name, "queued", queued),
    );

    const transition = await page.evaluate(
      ({ fabricatorId }) => {
        const simulation = window.__CINDERLINE__?.simulation;
        if (!simulation) throw new Error("Simulation disappeared.");
        let guard = 0;
        while (
          simulation.getEntity(fabricatorId)?.recipeChangeQueued &&
          guard++ < 240
        ) {
          simulation.step();
        }
        const afterBoundary = simulation.getEntity(fabricatorId);
        const events = simulation.drainEvents();
        const oldProducedTick = events.find(
          (event) =>
            event.type === "itemProduced" &&
            event.entityId === fabricatorId &&
            event.item === "copperWire",
        )?.tick;
        if (
          afterBoundary?.recipeId !== "circuit" ||
          afterBoundary.reclaim.copperPlate !== 1 ||
          oldProducedTick === undefined
        ) {
          throw new Error("Queued boundary did not preserve product and reclaim.");
        }
        const reclaimObservedTick = simulation.stats().tick;
        if (
          simulation.receive(fabricatorId, "ironPlate", 1, "input") !== 1 ||
          simulation.receive(fabricatorId, "copperWire", 3, "input") !== 3
        ) {
          throw new Error("Could not load the Circuit batch.");
        }
        simulation.step();
        for (const [item, amount] of [
          ["ironGear", 100],
          ["circuit", 200],
          ["automationCore", 50],
        ]) {
          if (
            simulation.receive(
              fabricatorId,
              item,
              amount,
              "output",
            ) !== amount
          ) {
            throw new Error(`Could not saturate output with ${item}.`);
          }
        }
        simulation.step();
        simulation.drainEvents();
        window.__CINDERLINE__?.refreshHUD();
        return { oldProducedTick, reclaimObservedTick };
      },
      { fabricatorId: fixture.fabricatorId },
    );
    await page.waitForFunction(
      (id) =>
        window.__CINDERLINE__?.simulation.getEntity(id)?.status ===
          "outputFull" &&
        document.querySelector("[data-ref='process-console']")
          ?.getAttribute("data-process-state") === "output-blocked",
      fixture.fabricatorId,
    );
    await page
      .locator(".toast")
      .filter({ hasText: "CHANGE QUEUED" })
      .waitFor({ state: "detached", timeout: 2_000 });
    const blocked = await auditState(
      page,
      fixture.fabricatorId,
      "output-blocked",
      {
        current: ["circuit"],
        active: ["circuit"],
        pending: [],
        condition:
          "Output blocked — clear capacity for 1 Logic circuit. RECLAIM has extraction priority.",
      },
    );
    assert(
      blocked.authoritative.reclaim.some(
        (item) => item.id === "copperPlate" && item.amount === 1,
      ),
      "Output-blocked frame did not retain exact reclaim.",
    );
    assert(
      blocked.authoritative.output.length === 4,
      "Output-blocked frame did not expose every occupied output stack.",
    );
    assert(
      !(await page.locator("[data-ref='toast-stack']").innerText()).includes(
        "CHANGE QUEUED",
      ),
      "Applied recipe boundary left a contradictory queued toast visible.",
    );
    if (viewport.name === "1366x768") {
      assert(
        Number.isFinite(blocked.dockClearance) &&
          blocked.dockClearance > 0,
        `1366px blocked inspector lost positive build-dock clearance (${blocked.dockClearance}px).`,
      );
    }
    report.captures.push(
      await capture(page, viewport.name, "output-blocked-reclaim", blocked),
    );

    if (viewport.name === "1366x768") {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(180);
      report.mobile = await auditMobileSheet(page);
      const mobileAudit = await auditState(
        page,
        fixture.fabricatorId,
        "output-blocked",
        {
          current: ["circuit"],
          active: ["circuit"],
          pending: [],
          condition:
            "Output blocked — clear capacity for 1 Logic circuit. RECLAIM has extraction priority.",
        },
      );
      await page.locator("[data-recipe-id='ironGear']").focus();
      await page.keyboard.press("ArrowDown");
      const twoColumnTarget = await focusedRecipeId(page);
      assert(
        twoColumnTarget === "circuit",
        `390px ArrowDown did not follow the computed two-column grid (focused ${twoColumnTarget}).`,
      );
      const mobilePath = `${OUTPUT_DIRECTORY}/390x844-output-blocked-reclaim.png`;
      await captureCleanEvidence(page, mobilePath);
      report.mobile.path = mobilePath;
      report.mobile.audit = {
        condition: mobileAudit.condition,
        visualSignature: mobileAudit.visualSignature,
      };
      report.mobile.navigation = {
        twoColumns: twoColumnTarget,
      };
      assert(
        (await page.locator("[data-process-condition]").innerText()) ===
          "Output blocked — clear capacity for 1 Logic circuit. RECLAIM has extraction priority.",
        "Mobile evidence did not preserve the blocked/reclaim condition.",
      );

      await page.setViewportSize({ width: 370, height: 844 });
      await page.waitForTimeout(180);
      const narrowColumns = await recipeColumnCount(page);
      assert(
        narrowColumns === 1,
        `370px process console did not collapse to one recipe column (found ${narrowColumns}).`,
      );
      await page.locator("[data-recipe-id='ironGear']").focus();
      await page.keyboard.press("ArrowDown");
      const oneColumnTarget = await focusedRecipeId(page);
      assert(
        oneColumnTarget === "copperWire",
        `370px ArrowDown did not follow the computed one-column grid (focused ${oneColumnTarget}).`,
      );
      report.mobile.navigation.oneColumn = oneColumnTarget;

      await page.setViewportSize({ width: 1366, height: 768 });
      await page.waitForTimeout(180);
    }

    const viewportCaptures = report.captures.filter(
      (captureResult) => captureResult.viewport === viewport.name,
    );
    assert(
      viewportCaptures.length === 5,
      `${viewport.name} did not produce all five process evidence states.`,
    );
    const uniqueSignatures = new Set(
      viewportCaptures.map((captureResult) => captureResult.visualSignature),
    );
    assert(
      uniqueSignatures.size === viewportCaptures.length,
      `${viewport.name} process states are not all visually distinct without text.`,
    );
    report.stateSignatures[viewport.name] = Object.fromEntries(
      viewportCaptures.map((captureResult) => [
        captureResult.state,
        captureResult.visualSignature,
      ]),
    );

    const causal = await page.evaluate(
      ({ fabricatorId, storageId, transition }) => {
        const simulation = window.__CINDERLINE__?.simulation;
        if (!simulation) throw new Error("Simulation disappeared.");
        const firstExtracted = simulation.transfer(
          fabricatorId,
          storageId,
        );
        if (firstExtracted.item !== "copperPlate" || firstExtracted.moved !== 1) {
          throw new Error("Reclaim was not the first extractable source.");
        }
        const cleared = simulation.transfer(
          fabricatorId,
          storageId,
          "circuit",
          200,
          "output",
        );
        if (cleared.moved !== 200) {
          throw new Error("Could not clear the blocking circuit stack.");
        }
        let newProducedTick;
        for (let guard = 0; guard < 240 && newProducedTick === undefined; guard += 1) {
          simulation.step();
          const events = simulation.drainEvents();
          newProducedTick = events.find(
            (event) =>
              event.type === "itemProduced" &&
              event.entityId === fabricatorId &&
              event.item === "circuit",
          )?.tick;
        }
        if (newProducedTick === undefined) {
          throw new Error("New Circuit craft never completed.");
        }
        return {
          ...transition,
          newProducedTick,
          firstExtracted,
        };
      },
      {
        fabricatorId: fixture.fabricatorId,
        storageId: fixture.storageId,
        transition,
      },
    );
    assert(
      causal.oldProducedTick <= causal.reclaimObservedTick &&
        causal.reclaimObservedTick < causal.newProducedTick,
      `Causal order failed (${causal.oldProducedTick} <= ${causal.reclaimObservedTick} < ${causal.newProducedTick}).`,
    );
    report.transitionOrders.push({
      viewport: viewport.name,
      ...causal,
    });

    if (viewport.name === "1920x1080") {
      report.smelterDeck = await verifySmelterDeck(
        page,
        fixture.smelterId,
      );
    }

    assert(
      consoleFailures.length === 0,
      `Browser emitted warnings/errors: ${consoleFailures.join(" | ")}`,
    );
    await context.close();
  }

  report.performance = await measureIsolatedConsolePerformance();
  assert(
    report.performance.openP95 <=
      Math.max(
        report.performance.closedP95 * 1.1,
        report.performance.closedP95 + 1.5,
      ),
    `Process console p95 regressed (${report.performance.closedP95}ms closed, ${report.performance.openP95}ms open; ${JSON.stringify(report.performance)}).`,
  );
  assert(
    report.performance.openP95 <= 25,
    `Process console absolute p95 is ${report.performance.openP95}ms (limit 25ms; runs ${report.performance.openRuns.map(({ p95Ms }) => p95Ms).join(", ")}ms; synchronous ${JSON.stringify(report.performance.synchronous)}).`,
  );

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}

async function verifySmelterDeck(page, smelterId) {
  await page.evaluate((id) => {
    const game = window.__CINDERLINE__;
    const simulation = game?.simulation;
    if (!game || !simulation) throw new Error("Simulation disappeared.");
    const smelter = simulation.entities.get(id);
    if (!smelter || smelter.kind !== "smelter") {
      throw new Error("Auto-smelt QA unit disappeared.");
    }
    smelter.recipeId = undefined;
    smelter.activeRecipeId = undefined;
    smelter.pendingRecipeId = undefined;
    smelter.recipeChangeQueued = false;
    smelter.input = {};
    smelter.output = {};
    smelter.reclaim = {};
    smelter.progress = 0;
    smelter.status = "missingInput";
    simulation.step();
    game.renderer.focus(
      smelter.x + smelter.width * 0.5,
      smelter.y + smelter.height * 0.5,
    );
    game.refreshHUD();
  }, smelterId);
  await page.waitForTimeout(180);
  const point = await projectEntity(page, smelterId);
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-ref='process-console']")
        ?.getAttribute("data-machine-kind") === "smelter",
  );

  const initial = await page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll("[data-recipe-choice]"),
    );
    return {
      ids: cards.map((card) => card.getAttribute("data-recipe-id")),
      pictograms: cards.map((card) => {
        const icon = card.querySelector(".recipe-option-icon");
        const svg = icon?.querySelector("svg[data-pictogram]");
        return {
          id: svg?.getAttribute("data-pictogram"),
          role: svg?.getAttribute("role"),
          label: svg?.getAttribute("aria-label"),
          fallbackText: icon?.textContent?.trim() ?? "",
          buttonLabel: card.getAttribute("aria-label") ?? "",
        };
      }),
      autoCurrent: document
        .querySelector("[data-recipe-id='auto']")
        ?.getAttribute("data-current"),
      autoPressed: document
        .querySelector("[data-recipe-id='auto']")
        ?.getAttribute("aria-pressed"),
      autoFormulaIds: Array.from(
        document.querySelectorAll(
          "[data-recipe-id='auto'] [data-recipe-formula]",
        ),
      ).map((formula) => formula.getAttribute("data-recipe-formula")),
    };
  });
  assert(
    JSON.stringify(initial.ids) ===
      JSON.stringify(["auto", "smeltIron", "smeltCopper", "fireBrick"]),
    `Smelter recipe deck is invalid: ${initial.ids.join(", ")}.`,
  );
  assert(
    initial.autoCurrent === "true" && initial.autoPressed === "true",
    "Auto-smelt is not the initial configured command target.",
  );
  assert(
    JSON.stringify(initial.autoFormulaIds) ===
      JSON.stringify(["smeltIron", "smeltCopper", "fireBrick"]),
    "Auto-smelt does not expose all three exact process formulas.",
  );
  assert(
    new Set(initial.pictograms.map((pictogram) => pictogram.id)).size === 4,
    "Smelter deck does not use four distinct SVG recipe pictograms.",
  );
  for (const pictogram of initial.pictograms) {
    assert(
      Boolean(pictogram.id) &&
        pictogram.role === "img" &&
        Boolean(pictogram.label) &&
        pictogram.fallbackText === "",
      `Smelter recipe pictogram is inaccessible or acronym-backed: ${JSON.stringify(pictogram)}.`,
    );
    assert(
      pictogram.buttonLabel.includes("seconds:") &&
        pictogram.buttonLabel.includes(" produces "),
      `Smelter recipe accessible name omits duration or material flow: ${pictogram.buttonLabel}.`,
    );
  }

  await page.locator("[data-recipe-id='smeltIron']").click();
  await page.waitForFunction(
    (id) =>
      window.__CINDERLINE__?.simulation.getEntity(id)?.recipeId ===
      "smeltIron",
    smelterId,
  );
  await page.locator("[data-recipe-id='auto']").click();
  await page.waitForFunction(
    (id) =>
      window.__CINDERLINE__?.simulation.getEntity(id)?.recipeId === undefined &&
      document
        .querySelector("[data-recipe-id='auto']")
        ?.getAttribute("data-current") === "true",
    smelterId,
  );
  return {
    entityId: smelterId,
    cards: initial.ids,
    pictograms: initial.pictograms,
    autoFormulaIds: initial.autoFormulaIds,
    realClickRoundTrip: true,
  };
}

async function projectEntity(page, entityId) {
  return page.evaluate((id) => {
    const game = window.__CINDERLINE__;
    const rig = game?.renderer.entityObjects.get(id);
    const canvas = document.querySelector("#world");
    if (!game || !rig || !(canvas instanceof HTMLCanvasElement)) {
      throw new Error(`Could not project entity ${id}.`);
    }
    const projected = rig.root.position.clone().project(game.renderer.camera);
    const bounds = canvas.getBoundingClientRect();
    return {
      x: bounds.left + (projected.x + 1) * bounds.width * 0.5,
      y: bounds.top + (-projected.y + 1) * bounds.height * 0.5,
    };
  }, entityId);
}

async function auditState(page, entityId, expectedState, expected) {
  const result = await page.evaluate(
    ({ entityId, itemIds }) => {
      const simulation = window.__CINDERLINE__?.simulation;
      const entity = simulation?.getEntity(entityId);
      const consoleElement = document.querySelector(
        "[data-ref='process-console']",
      );
      const inspector = document.querySelector("[data-ref='inspector']");
      if (!entity || !(consoleElement instanceof HTMLElement) || !inspector) {
        throw new Error("Process-console audit target disappeared.");
      }
      const readCards = (attribute) =>
        Array.from(document.querySelectorAll("[data-recipe-choice]"))
          .filter((card) => card.getAttribute(attribute) === "true")
          .map((card) => card.getAttribute("data-recipe-id"));
      const readBuffer = (name) =>
        Array.from(
          document.querySelectorAll(
            `[data-ref='process-${name}-list'] [data-process-item]`,
          ),
        ).map((row) => ({
          id: row.getAttribute("data-item-id"),
          amount: Number(row.getAttribute("data-amount")),
        }));
      const authoritative = {};
      for (const name of ["input", "output", "reclaim"]) {
        authoritative[name] = itemIds.flatMap((id) => {
          const amount = entity[name][id] ?? 0;
          return amount > 0 ? [{ id, amount }] : [];
        });
      }
      const rect = (element) => {
        const bounds = element?.getBoundingClientRect();
        return bounds
          ? {
              left: bounds.left,
              right: bounds.right,
              top: bounds.top,
              bottom: bounds.bottom,
              width: bounds.width,
              height: bounds.height,
            }
          : null;
      };
      const dock = document.querySelector(".build-dock");
      const minimap = document.querySelector(".minimap-shell");
      const pausePlate = document.querySelector("[data-ref='pause-plate']");
      const metrics = Array.from(
        document.querySelectorAll("[data-process-metric]"),
      ).map((metric) => ({
        id: metric.getAttribute("data-process-metric"),
        strong: metric.querySelector("strong")?.textContent ?? "",
        dataset: { ...metric.dataset },
      }));
      const cardIds = Array.from(
        document.querySelectorAll("[data-recipe-choice]"),
      ).map((card) => card.getAttribute("data-recipe-id"));
      const visibleBadges = (kind) =>
        document.querySelectorAll(
          `[data-recipe-badge='${kind}']:not([hidden])`,
        ).length;
      const isVisible = (element) => {
        if (!(element instanceof Element)) return false;
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          bounds.width > 0 &&
          bounds.height > 0
        );
      };
      const textRules = [
        {
          selector: ".process-metric small, .process-metric em",
          minimum: 9,
        },
        {
          selector: ".process-stage > header, .process-reclaim > header",
          minimum: 10,
        },
        {
          selector:
            ".process-stage > header small, .process-reclaim > header small",
          minimum: 9,
        },
        {
          selector:
            ".process-stack, .process-empty, .process-chamber-formula, .process-progress span, .recipe-console-heading small, .recipe-option-header small, .recipe-formula-row",
          minimum: 9,
        },
        {
          selector: ".process-condition, .recipe-console-heading",
          minimum: 10,
        },
        {
          selector: ".process-stage-chamber > strong",
          minimum: 12,
        },
        {
          selector: ".recipe-option-header strong",
          minimum: 12,
        },
        {
          selector: ".recipe-badge:not([hidden])",
          minimum: 9,
        },
      ];
      const typography = textRules.flatMap(({ selector, minimum }) =>
        Array.from(document.querySelectorAll(selector))
          .filter(isVisible)
          .map((element) => ({
            selector,
            minimum,
            text: element.textContent?.trim() ?? "",
            fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
          })),
      );
      const overflowSelector = [
        ".process-metric",
        ".process-metric small",
        ".process-metric em",
        ".process-metric strong",
        ".process-stage > header span",
        ".process-stage > header small",
        ".process-stack",
        ".process-item-label",
        ".process-stack strong",
        ".process-empty",
        ".process-stage-chamber > strong",
        ".process-chamber-formula",
        ".process-reclaim > header span",
        ".process-reclaim > header small",
        ".process-condition",
        ".recipe-console-heading span",
        ".recipe-console-heading small",
        ".recipe-option-header strong",
        ".recipe-option-header small",
        ".recipe-formula-row",
        ".recipe-badge:not([hidden])",
        ".process-stack-list",
        ".recipe-option",
      ].join(", ");
      const textFit = Array.from(
        document.querySelectorAll(overflowSelector),
      )
        .filter(isVisible)
        .map((element) => {
          const style = getComputedStyle(element);
          return {
            className: element.className,
            text: element.textContent?.trim() ?? "",
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            overflowX:
              element.clientWidth > 0 &&
              element.scrollWidth > element.clientWidth + 1,
            overflowY:
              element.clientHeight > 0 &&
              element.scrollHeight > element.clientHeight + 1,
            ellipsized: style.textOverflow === "ellipsis",
            lineClamp:
              style.webkitLineClamp === "none"
                ? "none"
                : style.webkitLineClamp,
          };
        });
      const recipePictograms = Array.from(
        document.querySelectorAll("[data-recipe-choice]"),
      ).map((card) => {
        const icon = card.querySelector(".recipe-option-icon");
        const svg = icon?.querySelector("svg[data-pictogram]");
        return {
          recipeId: card.getAttribute("data-recipe-id"),
          pictogramId: svg?.getAttribute("data-pictogram"),
          pictogramRole: svg?.getAttribute("role"),
          pictogramLabel: svg?.getAttribute("aria-label"),
          fallbackText: icon?.textContent?.trim() ?? "",
          buttonLabel: card.getAttribute("aria-label") ?? "",
          formulaRows: Array.from(
            card.querySelectorAll("[data-recipe-formula]"),
          ).map((formula) => formula.textContent?.trim() ?? ""),
        };
      });
      const bufferPictograms = Object.fromEntries(
        ["input", "output", "reclaim"].map((name) => [
          name,
          Array.from(
            document.querySelectorAll(
              `[data-ref='process-${name}-list'] [data-process-item]`,
            ),
          ).map((row) => {
            const svg = row.querySelector("svg[data-pictogram]");
            return {
              itemId: row.getAttribute("data-item-id"),
              pictogramId: svg?.getAttribute("data-pictogram"),
              role: svg?.getAttribute("role"),
              label: svg?.getAttribute("aria-label"),
            };
          }),
        ]),
      );
      const chamberPictograms = Array.from(
        document.querySelectorAll(
          ".process-chamber-formula svg[data-pictogram]",
        ),
      ).map((svg) => ({
        id: svg.getAttribute("data-pictogram"),
        role: svg.getAttribute("role"),
        label: svg.getAttribute("aria-label"),
      }));
      const cssSignature = (element, pseudo) => {
        if (!(element instanceof Element)) return null;
        const style = getComputedStyle(element, pseudo);
        return {
          borderStyle: style.borderStyle,
          borderColor: style.borderColor,
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          boxShadow: style.boxShadow,
          width: style.width,
          opacity: style.opacity,
        };
      };
      const inputStage = document.querySelector(
        "[data-process-stage='input']",
      );
      const chamberStage = document.querySelector(
        "[data-process-stage='chamber']",
      );
      const outputStage = document.querySelector(
        "[data-process-stage='output']",
      );
      const processArrow = document.querySelector(".process-arrow");
      const recipeGrid = document.querySelector("[data-ref='recipe-grid']");
      const visualStyles = {
        input: cssSignature(inputStage),
        inputMarker: cssSignature(inputStage, "::before"),
        chamber: cssSignature(chamberStage),
        output: cssSignature(outputStage),
        outputGate: cssSignature(outputStage, "::before"),
        arrow: cssSignature(processArrow),
        recipeGrid: cssSignature(recipeGrid),
      };
      const cardVisualStates = Array.from(
        document.querySelectorAll("[data-recipe-choice]"),
      ).map((card) => ({
        recipeId: card.getAttribute("data-recipe-id"),
        current: card.getAttribute("data-current"),
        active: card.getAttribute("data-active"),
        pending: card.getAttribute("data-pending"),
        boxShadow: getComputedStyle(card).boxShadow,
        borderColor: getComputedStyle(card).borderColor,
      }));
      return {
        processState: consoleElement.dataset.processState,
        dataStateSignature: consoleElement.dataset.stateSignature,
        visualStyles,
        visualSignature: JSON.stringify(visualStyles),
        consoleCount: document.querySelectorAll(
          "[data-ref='process-console']",
        ).length,
        stageCount: document.querySelectorAll("[data-process-stage]").length,
        metricCount: metrics.length,
        metrics,
        cardCount: cardIds.length,
        cardIds,
        conditionCount: document.querySelectorAll(
          "[data-process-condition]",
        ).length,
        reclaimCount: document.querySelectorAll("[data-process-reclaim]")
          .length,
        condition:
          document.querySelector("[data-process-condition]")?.textContent ??
          "",
        current: readCards("data-current"),
        active: readCards("data-active"),
        pending: readCards("data-pending"),
        visibleBadges: {
          current: visibleBadges("current"),
          active: visibleBadges("active"),
          pending: visibleBadges("queued"),
        },
        cardVisualStates,
        recipePictograms,
        bufferPictograms,
        chamberPictograms,
        typography,
        textFit,
        formulaText: Array.from(
          document.querySelectorAll(".recipe-formula-row"),
        ).map((row) => row.textContent ?? ""),
        buffers: {
          input: readBuffer("input"),
          output: readBuffer("output"),
          reclaim: readBuffer("reclaim"),
        },
        authoritative,
        inspector: rect(inspector),
        console: rect(consoleElement),
        dock: rect(dock),
        dockClearance:
          rect(dock) && rect(inspector)
            ? rect(dock).top - rect(inspector).bottom
            : null,
        minimap: rect(minimap),
        pauseDisplay: pausePlate
          ? getComputedStyle(pausePlate).display
          : "missing",
        consoleFilter: getComputedStyle(consoleElement).filter,
        inspectorScrollHeight: inspector.scrollHeight,
        inspectorClientHeight: inspector.clientHeight,
        inspectorInert: inspector.hasAttribute("inert"),
        layoutHeights: Object.fromEntries(
          [
            ["metrics", ".process-metrics"],
            ["flow", ".process-flow"],
            ["reclaim", ".process-reclaim"],
            ["condition", ".process-condition"],
            ["heading", ".recipe-console-heading"],
            ["recipes", ".recipe-grid"],
          ].map(([name, selector]) => [
            name,
            document.querySelector(selector)?.getBoundingClientRect().height ??
              0,
          ]),
        ),
        bodyWidth: document.body.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      };
    },
    { entityId, itemIds: ITEM_IDS },
  );

  assert(result.processState === expectedState, `Expected ${expectedState}, got ${result.processState}.`);
  assert(result.consoleCount === 1, "Expected exactly one process console.");
  assert(result.stageCount === 3, "Expected exactly three process stages.");
  assert(result.metricCount === 4, "Expected exactly four process metrics.");
  assert(result.cardCount === 4, "Expected exactly four Fabricator recipe cards.");
  assert(
    JSON.stringify(result.cardIds) === JSON.stringify(FABRICATOR_RECIPE_IDS),
    `Recipe deck is stale or reordered: ${result.cardIds.join(", ")}.`,
  );
  assert(result.conditionCount === 1, "Expected exactly one process condition.");
  assert(result.reclaimCount === 1, "Expected exactly one reclaim rail.");
  assert(result.condition === expected.condition, `Condition copy mismatch: ${result.condition}`);
  assert(!result.inspectorInert, "Open process inspector is incorrectly inert.");
  const expectedStateSignatures = {
    unconfigured: "chamber-disabled",
    starved: "input-warning",
    working: "chamber-running",
    queued: "target-bridge",
    "output-blocked": "output-gate",
    "no-power": "grid-lockout",
    idle: "armed-standby",
  };
  assert(
    result.dataStateSignature === expectedStateSignatures[expectedState],
    `${expectedState} does not expose its structural state signature.`,
  );
  for (const key of ["current", "active", "pending"]) {
    assert(
      JSON.stringify(result[key]) === JSON.stringify(expected[key]),
      `${key} cards mismatch: ${JSON.stringify(result[key])}.`,
    );
    assert(
      result.visibleBadges[key] === expected[key].length,
      `${key} badge count does not match card state.`,
    );
    for (const recipeId of expected[key]) {
      const card = result.cardVisualStates.find(
        (candidate) => candidate.recipeId === recipeId,
      );
      assert(
        card?.boxShadow && card.boxShadow !== "none",
        `${key} recipe ${recipeId} has no non-text rail or casing signature.`,
      );
    }
  }
  for (const key of ["input", "output", "reclaim"]) {
    assert(
      JSON.stringify(result.buffers[key]) ===
        JSON.stringify(result.authoritative[key]),
      `${key} DOM does not match authoritative inventory.`,
    );
    assert(
      new Set(result.buffers[key].map((item) => item.id)).size ===
        result.buffers[key].length,
      `${key} contains duplicate item rows.`,
    );
    assert(
      result.bufferPictograms[key].length === result.buffers[key].length,
      `${key} does not have one material pictogram per occupied stack.`,
    );
    for (const pictogram of result.bufferPictograms[key]) {
      assert(
        pictogram.itemId === pictogram.pictogramId &&
          pictogram.role === "img" &&
          Boolean(pictogram.label),
        `${key} material pictogram is not distinct and accessible: ${JSON.stringify(pictogram)}.`,
      );
    }
  }
  assert(
    new Set(
      result.recipePictograms.map((pictogram) => pictogram.pictogramId),
    ).size === FABRICATOR_RECIPE_IDS.length,
    "Fabricator deck does not use four distinct SVG recipe pictograms.",
  );
  for (const pictogram of result.recipePictograms) {
    assert(
      Boolean(pictogram.pictogramId) &&
        pictogram.pictogramRole === "img" &&
        Boolean(pictogram.pictogramLabel) &&
        pictogram.fallbackText === "",
      `Recipe pictogram is inaccessible or acronym-backed: ${JSON.stringify(pictogram)}.`,
    );
    assert(
      pictogram.buttonLabel.includes("seconds:") &&
        pictogram.buttonLabel.includes(" produces "),
      `Recipe accessible name omits duration or input/output flow: ${pictogram.buttonLabel}.`,
    );
    assert(
      pictogram.formulaRows.every(
        (formula) => formula.includes(" → ") && formula.length > 4,
      ),
      `Recipe ${pictogram.recipeId} has an incomplete visible formula.`,
    );
  }
  for (const pictogram of result.chamberPictograms) {
    assert(
      Boolean(pictogram.id) &&
        pictogram.role === "img" &&
        Boolean(pictogram.label),
      `Chamber material pictogram is inaccessible: ${JSON.stringify(pictogram)}.`,
    );
  }
  if (expectedState === "working" || expectedState === "queued" || expectedState === "output-blocked") {
    assert(
      result.chamberPictograms.length >= 2,
      `${expectedState} chamber omits committed input/output pictograms.`,
    );
  }
  for (const sample of result.typography) {
    assert(
      Number.isFinite(sample.fontSize) &&
        sample.fontSize + 0.01 >= sample.minimum,
      `Operational text fell below ${sample.minimum}px (${sample.fontSize}px: "${sample.text}").`,
    );
  }
  for (const fit of result.textFit) {
    assert(
      !fit.ellipsized &&
        (fit.lineClamp === "none" || fit.lineClamp === "0"),
      `Operational text uses truncation/clamping: "${fit.text}".`,
    );
    assert(
      !fit.overflowX && !fit.overflowY,
      `Operational text or stack content is clipped: ${JSON.stringify(fit)}.`,
    );
  }
  if (expected.formula) {
    assert(
      result.formulaText.includes(expected.formula),
      `Exact formula missing: ${expected.formula}.`,
    );
  }
  const stateStyles = result.visualStyles;
  if (expectedState === "unconfigured") {
    assert(
      stateStyles.chamber?.borderStyle.includes("dashed") &&
        stateStyles.chamber.backgroundImage.includes(
          "repeating-linear-gradient",
        ),
      "Unconfigured state lacks a disabled/hatch chamber signature.",
    );
  } else if (expectedState === "starved") {
    assert(
      stateStyles.inputMarker?.width === "4px" &&
        stateStyles.input.backgroundImage.includes("repeating-linear-gradient"),
      "Starved state lacks a physical warning rail and feed-bay hatch.",
    );
  } else if (expectedState === "working") {
    assert(
      stateStyles.chamber?.boxShadow !== "none",
      "Working state lacks a live chamber material signature.",
    );
  } else if (expectedState === "queued") {
    assert(
      stateStyles.arrow?.borderColor !== "rgba(0, 0, 0, 0)" &&
        stateStyles.recipeGrid?.boxShadow !== "none",
      "Queued state lacks target-bridge rails.",
    );
  } else if (expectedState === "output-blocked") {
    assert(
      stateStyles.outputGate?.width === "5px" &&
        stateStyles.output.backgroundImage.includes(
          "repeating-linear-gradient",
        ),
      "Output-blocked state lacks a physical output gate.",
    );
  }
  assert(
    result.bodyWidth === result.viewportWidth,
    "Process console introduced horizontal page overflow.",
  );
  assert(
    result.pauseDisplay === "none" && result.consoleFilter === "none",
    "Evidence frame is obscured by the paused plate or a console blur filter.",
  );
  assert(
    result.inspectorScrollHeight <= result.inspectorClientHeight + 1,
    `Inspector clips console content (${result.inspectorScrollHeight} > ${result.inspectorClientHeight}; ${JSON.stringify(result.layoutHeights)}).`,
  );
  assert(
    result.console.top >= result.inspector.top &&
      result.console.bottom <= result.inspector.bottom + 1,
    "Process console is clipped outside its inspector.",
  );
  assert(
    !rectanglesOverlap(result.inspector, result.dock),
    "Process inspector overlaps the build dock.",
  );
  assert(
    result.minimap.right <= result.inspector.left,
    `Tactical map overlaps the process inspector (${JSON.stringify({
      minimap: result.minimap,
      inspector: result.inspector,
    })}).`,
  );
  return result;
}

async function capture(page, viewportName, state, audit) {
  const path = `${OUTPUT_DIRECTORY}/${viewportName}-${state}.png`;
  const cleanEvidence = await captureCleanEvidence(page, path);
  return {
    viewport: viewportName,
    state,
    path,
    cleanEvidence,
    visualSignature: audit.visualSignature,
    dockClearance: audit.dockClearance,
    condition: audit.condition,
    current: audit.current,
    active: audit.active,
    pending: audit.pending,
    authoritative: audit.authoritative,
  };
}

async function captureCleanEvidence(page, path) {
  await page.evaluate(() => window.__CINDERLINE__?.dismissToasts());
  await page.waitForFunction(
    () => document.querySelectorAll("[data-ref='toast-stack'] .toast").length === 0,
    undefined,
    { timeout: 2_000 },
  );
  const evidence = await page.evaluate(() => ({
    toastCount: document.querySelectorAll("[data-ref='toast-stack'] .toast")
      .length,
    pauseDisplay:
      document.querySelector("[data-ref='pause-plate']") instanceof HTMLElement
        ? getComputedStyle(
            document.querySelector("[data-ref='pause-plate']"),
          ).display
        : "missing",
  }));
  assert(
    evidence.toastCount === 0 && evidence.pauseDisplay === "none",
    `Evidence frame is not clean: ${JSON.stringify(evidence)}.`,
  );
  await page.screenshot({ path });
  return {
    ...evidence,
    contradictoryNoticeFree: true,
  };
}

async function verifyClosedInspectorIsolation(page) {
  await page.locator("[data-recipe-id='ironGear']").focus();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => {
    const inspector = document.querySelector("[data-ref='inspector']");
    return (
      inspector?.getAttribute("aria-hidden") === "true" &&
      inspector.hasAttribute("inert") &&
      !inspector.classList.contains("is-open")
    );
  });
  const afterClose = await page.evaluate(() => {
    const inspector = document.querySelector("[data-ref='inspector']");
    const close = document.querySelector("[data-action='close-inspector']");
    const world = document.querySelector("#world");
    if (
      !(inspector instanceof HTMLElement) ||
      !(close instanceof HTMLElement) ||
      !(world instanceof HTMLElement)
    ) {
      throw new Error("Inspector isolation targets disappeared.");
    }
    const focusWasReturnedToWorld = document.activeElement === world;
    close.focus();
    return {
      ariaHidden: inspector.getAttribute("aria-hidden"),
      inertAttribute: inspector.hasAttribute("inert"),
      inertProperty: inspector.inert,
      focusWasReturnedToWorld,
      programmaticFocusBlocked: document.activeElement !== close,
      activeInsideInspector: inspector.contains(document.activeElement),
    };
  });
  await page.keyboard.press("Tab");
  const tabInsideInspector = await page.evaluate(() =>
    document
      .querySelector("[data-ref='inspector']")
      ?.contains(document.activeElement),
  );
  assert(
    afterClose.ariaHidden === "true" &&
      afterClose.inertAttribute &&
      afterClose.inertProperty &&
      afterClose.focusWasReturnedToWorld &&
      afterClose.programmaticFocusBlocked &&
      !afterClose.activeInsideInspector &&
      !tabInsideInspector,
    `Closed inspector remains keyboard reachable: ${JSON.stringify({
      ...afterClose,
      tabInsideInspector,
    })}.`,
  );
  return {
    ...afterClose,
    tabInsideInspector,
  };
}

async function assertToastClearOfMap(page, label) {
  const geometry = await page.evaluate(() => {
    const toRect = (element) => {
      if (!(element instanceof Element)) return null;
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      };
    };
    const map = document.querySelector(".minimap-shell");
    return {
      map: toRect(map),
      mapDisplay: map ? getComputedStyle(map).display : "missing",
      toasts: Array.from(
        document.querySelectorAll(
          "[data-ref='toast-stack'] .toast:not(.is-leaving)",
        ),
      ).map(toRect),
    };
  });
  assert(
    geometry.toasts.length > 0,
    `No visible ${label} toast was available for collision QA.`,
  );
  if (geometry.mapDisplay !== "none") {
    for (const toast of geometry.toasts) {
      assert(
        !rectanglesOverlap(toast, geometry.map),
        `${label} toast overlaps the tactical map: ${JSON.stringify(geometry)}.`,
      );
    }
  }
  return {
    map: geometry.map,
    toastCount: geometry.toasts.length,
    overlap: false,
  };
}

async function recipeColumnCount(page) {
  return page.evaluate(() => {
    const grid = document.querySelector("[data-ref='recipe-grid']");
    if (!(grid instanceof HTMLElement)) return 0;
    return getComputedStyle(grid)
      .gridTemplateColumns
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
  });
}

async function focusedRecipeId(page) {
  return page.evaluate(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement.dataset.recipeId
      : undefined,
  );
}

async function auditMobileSheet(page) {
  const mobile = await page.evaluate(() => {
    const inspector = document
      .querySelector("[data-ref='inspector']")
      ?.getBoundingClientRect();
    const consoleElement = document
      .querySelector("[data-ref='process-console']")
      ?.getBoundingClientRect();
    const cards = Array.from(
      document.querySelectorAll("[data-recipe-choice]"),
    );
    const mission = document.querySelector(".mission-panel");
    const dock = document.querySelector(".build-dock");
    return {
      inspector: inspector
        ? {
            left: inspector.left,
            right: inspector.right,
            top: inspector.top,
            bottom: inspector.bottom,
          }
        : null,
      console: consoleElement
        ? {
            left: consoleElement.left,
            right: consoleElement.right,
            top: consoleElement.top,
            bottom: consoleElement.bottom,
          }
        : null,
      cardColumns: new Set(
        cards.map((card) => card.getBoundingClientRect().left),
      ).size,
      minimumCardHeight: Math.min(
        ...cards.map((card) => card.getBoundingClientRect().height),
      ),
      missionDisplay: mission ? getComputedStyle(mission).display : "missing",
      dockDisplay: dock ? getComputedStyle(dock).display : "missing",
      bodyWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  assert(
    mobile.inspector?.left === 0 &&
      mobile.inspector?.right === 390 &&
      mobile.inspector?.top === 54,
    "Mobile process console is not a full-width sheet below the top bar.",
  );
  assert(
    mobile.cardColumns === 2,
    "390px process console did not retain the two-column recipe deck.",
  );
  assert(
    mobile.minimumCardHeight >= 44,
    "Mobile recipe targets are smaller than 44px.",
  );
  assert(
    mobile.missionDisplay === "none" && mobile.dockDisplay === "none",
    "Mobile sheet did not suppress obscured mission/build controls.",
  );
  assert(
    mobile.bodyWidth === mobile.viewportWidth,
    "Mobile process console introduced horizontal scroll.",
  );
  return mobile;
}

async function measureIsolatedConsolePerformance() {
  // Headless Chrome on high-refresh hosts aliases rAF into ~27ms scheduler
  // clusters even on an untouched page. The isolated uncapped browser keeps
  // this gate tied to application frame cost instead of host display cadence.
  const performanceBrowser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--disable-frame-rate-limit"],
  });
  try {
    const context = await performanceBrowser.newContext({
      viewport: { width: 1366, height: 768 },
      deviceScaleFactor: 1,
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const consoleFailures = [];
    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") {
        consoleFailures.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) =>
      consoleFailures.push(`pageerror: ${error.message}`),
    );
    await page.goto(
      `${BASE_URL}/?showcase&fresh=process-console-performance-${Date.now()}`,
      {
        waitUntil: "networkidle",
        timeout: 30_000,
      },
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#boot")?.classList.contains("is-done") &&
        Boolean(window.__CINDERLINE__?.simulation),
      undefined,
      { timeout: 15_000 },
    );
    await page.keyboard.press("Space");
    const fixture = await page.evaluate(() => {
      const game = window.__CINDERLINE__;
      const simulation = game?.simulation;
      const fabricator = simulation
        ?.getEntities()
        .find((entity) => entity.kind === "fabricator");
      if (!game || !simulation || !fabricator) {
        throw new Error("Isolated process-console fixture unavailable.");
      }
      document.querySelector("#boot")?.remove();
      const pausePlate = document.querySelector("[data-ref='pause-plate']");
      if (pausePlate instanceof HTMLElement) pausePlate.style.display = "none";
      document
        .querySelectorAll("[data-ref='toast-stack'] > *")
        .forEach((element) => element.remove());
      game.renderer.focus(
        fabricator.x + fabricator.width * 0.5,
        fabricator.y + fabricator.height * 0.5,
      );
      for (let step = 0; step < 4; step += 1) game.renderer.zoom(-4);
      game.refreshHUD();
      return {
        fabricatorId: fabricator.id,
        entityCount: simulation.getEntities().length,
      };
    });
    await page.waitForTimeout(220);
    const point = await projectEntity(page, fixture.fabricatorId);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-ref='inspector']")
          ?.classList.contains("has-process-console"),
    );
    await page.waitForTimeout(280);
    const performance = await measureConsolePerformance(
      page,
      fixture.fabricatorId,
    );
    assert(
      consoleFailures.length === 0,
      `Isolated performance browser emitted warnings/errors: ${consoleFailures.join(" | ")}.`,
    );
    return {
      ...performance,
      isolatedEntityCount: fixture.entityCount,
    };
  } finally {
    await performanceBrowser.close();
  }
}

async function measureConsolePerformance(page, entityId) {
  const sample = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const deltas = [];
          let previous = performance.now();
          const frame = (now) => {
            deltas.push(now - previous);
            previous = now;
            if (deltas.length >= 90) {
              const stable = deltas.slice(5).sort((a, b) => a - b);
              resolve({
                medianMs: stable[Math.floor(stable.length * 0.5)] ?? 0,
                p95Ms: stable[Math.floor(stable.length * 0.95)] ?? 0,
                worstMs: stable.at(-1) ?? 0,
                samples: stable.length,
              });
            } else {
              requestAnimationFrame(frame);
            }
          };
          requestAnimationFrame(frame);
        }),
    );
  const point = await projectEntity(page, entityId);
  const setOpen = async (open) => {
    const current = await page
      .locator("[data-ref='inspector']")
      .evaluate((element) => element.classList.contains("is-open"));
    if (current !== open && open) {
      await page.mouse.click(point.x, point.y);
      await page.waitForFunction(
        () =>
          document
            .querySelector("[data-ref='inspector']")
            ?.classList.contains("has-process-console"),
      );
    } else if (current !== open) {
      await page.locator("[data-action='close-inspector']").click();
      await page.waitForFunction(
        () =>
          !document
        .querySelector("[data-ref='inspector']")
            ?.classList.contains("is-open"),
      );
    }
    // Measure steady state, not the intentional 220ms panel transition.
    await page.waitForTimeout(280);
  };
  const roundedRun = (run) => ({
    medianMs: Number(run.medianMs.toFixed(3)),
    p95Ms: Number(run.p95Ms.toFixed(3)),
    worstMs: Number(run.worstMs.toFixed(3)),
    samples: run.samples,
  });
  const openRuns = [];
  const closedRuns = [];
  for (let repetition = 0; repetition < 3; repetition += 1) {
    if (repetition % 2 === 0) {
      await setOpen(true);
      openRuns.push(roundedRun(await sample()));
      await setOpen(false);
      closedRuns.push(roundedRun(await sample()));
    } else {
      await setOpen(false);
      closedRuns.push(roundedRun(await sample()));
      await setOpen(true);
      openRuns.push(roundedRun(await sample()));
    }
  }
  const medianP95 = (runs) => {
    const values = runs.map(({ p95Ms }) => p95Ms).sort((a, b) => a - b);
    return values[Math.floor(values.length * 0.5)] ?? 0;
  };
  const synchronous = {};
  for (const open of [false, true]) {
    await setOpen(open);
    synchronous[open ? "open" : "closed"] =
      await measureSynchronousFrameCosts(page);
  }
  await setOpen(true);
  return {
    harness: "headless-chrome-uncapped-frame-scheduler",
    openP95: medianP95(openRuns),
    closedP95: medianP95(closedRuns),
    openWorstP95: Math.max(...openRuns.map(({ p95Ms }) => p95Ms)),
    closedWorstP95: Math.max(...closedRuns.map(({ p95Ms }) => p95Ms)),
    openRuns,
    closedRuns,
    synchronous,
  };
}

async function measureSynchronousFrameCosts(page) {
  return page.evaluate(() => {
    const game = window.__CINDERLINE__;
    const renderer = game?.renderer;
    if (!game || !renderer) {
      throw new Error("Synchronous performance bridge unavailable.");
    }
    const gl = renderer.renderer.getContext();
    const samples = {
      hudUpdateLayout: [],
      syncUpdate: [],
      renderFinish: [],
      fullPipeline: [],
    };
    const timed = (key, action) => {
      const start = performance.now();
      action();
      samples[key].push(performance.now() - start);
    };
    for (let sample = 0; sample < 24; sample += 1) {
      timed("hudUpdateLayout", () => {
        game.refreshHUD();
        document
          .querySelector("[data-ref='inspector']")
          ?.getBoundingClientRect();
      });
      timed("syncUpdate", () => {
        renderer.sync(renderer.snapshot);
        renderer.update(0, renderer.lastElapsed + sample / 600);
      });
      timed("renderFinish", () => {
        renderer.render(0);
        gl.finish();
      });
      timed("fullPipeline", () => {
        renderer.sync(renderer.snapshot);
        renderer.update(0, renderer.lastElapsed + sample / 600);
        renderer.render(0);
        gl.finish();
      });
    }
    const summarize = (values) => {
      const ordered = [...values].sort((a, b) => a - b);
      return {
        medianMs: Number(
          (ordered[Math.floor(ordered.length * 0.5)] ?? 0).toFixed(3),
        ),
        p95Ms: Number(
          (ordered[Math.floor(ordered.length * 0.95)] ?? 0).toFixed(3),
        ),
        worstMs: Number((ordered.at(-1) ?? 0).toFixed(3)),
        samples: ordered.length,
      };
    };
    return Object.fromEntries(
      Object.entries(samples).map(([key, values]) => [
        key,
        summarize(values),
      ]),
    );
  });
}

function rectanglesOverlap(a, b) {
  if (!a || !b || a.width === 0 || b.width === 0) return false;
  return !(
    a.right <= b.left ||
    b.right <= a.left ||
    a.bottom <= b.top ||
    b.bottom <= a.top
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
