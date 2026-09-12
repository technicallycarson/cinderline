import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL =
  process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY =
  ".qa/circuit-authoring/pass1-work/formative-02";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function captureErrors(page) {
  const errors = [];
  page.on("pageerror", (error) =>
    errors.push(`pageerror: ${error.message}`),
  );
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
  return errors;
}

async function waitForGame(page) {
  await page.waitForFunction(
    () =>
      Boolean(window.__CINDERLINE__?.renderer) &&
      document.querySelector("#boot")?.classList.contains("is-done"),
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(650);
  await page.evaluate(() => window.__CINDERLINE__?.dismissToasts());
}

async function findPlaceablePoint(page, kind, anchor = null) {
  const point = await page.evaluate(
    ({ requestedKind, anchorCell }) => {
      const game = window.__CINDERLINE__;
      const canvas = document.querySelector("#world");
      if (!game || !(canvas instanceof HTMLCanvasElement)) return null;
      const bounds = canvas.getBoundingClientRect();
      const minimumX = 320;
      const maximumX = bounds.width - 510;
      const minimumY = 150;
      const maximumY = bounds.height - 175;
      const visited = new Set();
      const candidates = [];
      for (let y = minimumY; y <= maximumY; y += 4) {
        for (let x = minimumX; x <= maximumX; x += 4) {
          const cell = game.renderer.screenToGrid(
            bounds.left + x,
            bounds.top + y,
          );
          if (!cell) continue;
          const key = `${cell.x},${cell.z}`;
          if (visited.has(key)) continue;
          visited.add(key);
          const distance = anchorCell
            ? Math.hypot(
                cell.x - anchorCell.x,
                cell.z - anchorCell.z,
              )
            : 0;
          if (
            anchorCell &&
            (distance < 1 || distance > 7.25)
          ) {
            continue;
          }
          const options =
            requestedKind === "fluidPump"
              ? {}
              : {};
          if (
            game.simulation.canPlace(
              requestedKind,
              cell.x,
              cell.z,
              1,
              options,
            ).ok
          ) {
            candidates.push({
              clientX: bounds.left + x,
              clientY: bounds.top + y,
              cell,
              distance,
            });
          }
        }
      }
      candidates.sort(
        (left, right) =>
          left.distance - right.distance ||
          left.cell.z - right.cell.z ||
          left.cell.x - right.cell.x,
      );
      return candidates[0] ?? null;
    },
    { requestedKind: kind, anchorCell: anchor },
  );
  assert(point, `No visible placeable point was found for ${kind}.`);
  return point;
}

async function placeThroughHUD(page, kind, category, anchor = null) {
  const point = await findPlaceablePoint(page, kind, anchor);
  const before = await page.evaluate(
    (requestedKind) =>
      window.__CINDERLINE__?.simulation
        .getEntities(requestedKind)
        .map((entity) => entity.id) ?? [],
    kind,
  );
  await page
    .locator(`[data-build-category-select="${category}"]`)
    .click();
  const card = page.locator(`[data-build="${kind}"]`);
  await card.waitFor({ state: "visible" });
  await card.click();
  await page.mouse.move(point.clientX, point.clientY);
  await page.waitForTimeout(70);
  await page.mouse.click(point.clientX, point.clientY);
  await page.waitForFunction(
    ({ requestedKind, count }) =>
      (window.__CINDERLINE__?.simulation.getEntities(requestedKind)
        .length ?? 0) > count,
    { requestedKind: kind, count: before.length },
  );
  const entity = await page.evaluate(
    ({ requestedKind, previous }) =>
      window.__CINDERLINE__?.simulation
        .getEntities(requestedKind)
        .find((candidate) => !previous.includes(candidate.id)),
    { requestedKind: kind, previous: before },
  );
  assert(entity, `${kind} was not placed through its build card.`);
  return { kind, category, point, entity };
}

async function selectPlaced(page, placement) {
  await page.keyboard.press("Escape");
  await page.mouse.click(placement.point.clientX, placement.point.clientY);
  await page.waitForFunction(
    (id) =>
      document
        .querySelector("[data-ref='inspector-type']")
        ?.textContent?.includes(`UNIT ${String(id).padStart(3, "0")}`) &&
      !document
        .querySelector("[data-ref='circuit-console']")
        ?.hasAttribute("hidden"),
    placement.entity.id,
  );
}

async function setCondition(page, prefix, signalName, operator, value) {
  await page
    .locator(`[name='${prefix}-left-source']`)
    .selectOption("signal");
  await page
    .locator(`[name='${prefix}-left-type']`)
    .selectOption("virtual");
  await page.locator(`[name='${prefix}-left-name']`).fill(signalName);
  await page.locator(`[name='${prefix}-operator']`).selectOption(operator);
  await page
    .locator(`[name='${prefix}-right-source']`)
    .selectOption("constant");
  await page.locator(`[name='${prefix}-right-value']`).fill(String(value));
}

async function setConditionWithin(
  row,
  prefix,
  signalName,
  operator,
  value,
) {
  await row
    .locator(`[name='${prefix}-left-source']`)
    .selectOption("signal");
  await row
    .locator(`[name='${prefix}-left-type']`)
    .selectOption("virtual");
  await row.locator(`[name='${prefix}-left-name']`).fill(signalName);
  await row.locator(`[name='${prefix}-operator']`).selectOption(operator);
  await row
    .locator(`[name='${prefix}-right-source']`)
    .selectOption("constant");
  await row
    .locator(`[name='${prefix}-right-value']`)
    .fill(String(value));
}

async function setConstantSignals(page, source, signals) {
  await selectPlaced(page, source);
  await page.locator("[name='constant-enabled']").check();
  let rows = page.locator("[data-circuit-constant-row]");
  while ((await rows.count()) > signals.length) {
    await rows.last().locator("[data-circuit-action='remove-signal']").click();
    rows = page.locator("[data-circuit-constant-row]");
  }
  while ((await rows.count()) < signals.length) {
    await page.locator("[data-circuit-action='add-signal']").click();
    rows = page.locator("[data-circuit-constant-row]");
  }
  for (const [index, signal] of signals.entries()) {
    const row = rows.nth(index);
    await row
      .locator("[name='constant-signal-type']")
      .selectOption(signal.type);
    await row.locator("[name='constant-signal-name']").fill(signal.name);
    await row
      .locator("[name='constant-signal-value']")
      .fill(String(signal.value));
  }
  await page
    .locator("form[data-circuit-form='constant'] .circuit-apply")
    .click();
  await page.waitForFunction(
    ({ id, expected }) => {
      const device = window.__CINDERLINE__?.simulation
        .circuitSnapshot()
        .devices.find((candidate) => candidate.id === `entity:${id}:device`);
      return device?.kind === "constant" && device.signals.length === expected;
    },
    { id: source.entity.id, expected: signals.length },
  );
}

async function connectThroughHUD(
  page,
  source,
  target,
  color,
) {
  const before = await page.evaluate(
    () => window.__CINDERLINE__?.simulation.circuitSnapshot().wires.length,
  );
  await selectPlaced(page, source);
  await page
    .locator(
      `[data-circuit-connector='output'] [data-wire-color='${color}']`,
    )
    .click();
  await page.mouse.click(target.point.clientX, target.point.clientY);
  await page
    .locator(
      `[data-circuit-connector='io'] [data-wire-color='${color}']`,
    )
    .click();
  await page.waitForFunction(
    (count) =>
      window.__CINDERLINE__?.simulation.circuitSnapshot().wires.length ===
      count + 1,
    before,
  );
}

async function configureInserter(page, inserter) {
  await selectPlaced(page, inserter);
  assert(
    (await page.locator("[name='machine-enable-active']").count()) === 1 &&
      (await page.locator("[name='machine-power-active']").count()) === 1 &&
      (await page.locator("[name='machine-filter-active']").count()) === 1 &&
      (await page.locator("[data-circuit-sorter-routes]").count()) === 0,
    "Inserter capability gating exposed the wrong controls.",
  );
  await page.locator("[name='machine-enable-active']").check();
  await setCondition(page, "machine-enable", "go", ">", 0);
  await page.locator("[name='machine-power-active']").check();
  await setCondition(page, "machine-power", "run", ">", 0);
  await page.locator("[name='machine-filter-active']").check();
  await page.locator("[name='machine-filter-minimum']").fill("2");
  await page
    .locator(
      "[name='machine-filter-candidate'][value='ironPlate']",
    )
    .check();
  await page
    .locator("form[data-circuit-form='machine'] .circuit-apply")
    .click();
  await page.waitForFunction(
    (id) => {
      const port = window.__CINDERLINE__?.simulation
        .circuitSnapshot()
        .machinePorts.find((candidate) => candidate.id === `entity:${id}:machine`);
      return (
        port?.enableCondition?.left?.name === "go" &&
        port.powerSwitchCondition?.left?.name === "run" &&
        port.filter?.minimum === 2 &&
        port.filter.candidates?.[0]?.name === "ironPlate"
      );
    },
    inserter.entity.id,
  );

  const unchangedBefore = await page.evaluate(
    () => window.__CINDERLINE__?.circuitAuthoringState(),
  );
  await page
    .locator("form[data-circuit-form='machine'] .circuit-apply")
    .click();
  await page.waitForTimeout(120);
  const unchangedAfter = await page.evaluate(() => ({
    history: window.__CINDERLINE__?.circuitAuthoringState(),
    toast: document.querySelector("[data-ref='toast-stack']")?.textContent,
  }));
  assert(
    JSON.stringify(unchangedAfter.history) ===
      JSON.stringify(unchangedBefore) &&
      unchangedAfter.toast?.includes("CONTROLS UNCHANGED"),
    "Unchanged inserter apply modified history or lacked feedback.",
  );

  await page
    .locator("[name='machine-filter-minimum']")
    .fill("9007199254740992");
  const rejectedBefore = await page.evaluate((id) => ({
    history: window.__CINDERLINE__?.circuitAuthoringState(),
    port: window.__CINDERLINE__?.simulation
      .circuitSnapshot()
      .machinePorts.find((candidate) => candidate.id === `entity:${id}:machine`),
  }), inserter.entity.id);
  await page
    .locator("form[data-circuit-form='machine'] .circuit-apply")
    .click();
  await page.waitForTimeout(120);
  const rejectedAfter = await page.evaluate((id) => ({
    history: window.__CINDERLINE__?.circuitAuthoringState(),
    port: window.__CINDERLINE__?.simulation
      .circuitSnapshot()
      .machinePorts.find((candidate) => candidate.id === `entity:${id}:machine`),
    toast: document.querySelector("[data-ref='toast-stack']")?.textContent,
  }), inserter.entity.id);
  assert(
    JSON.stringify(rejectedAfter.history) ===
      JSON.stringify(rejectedBefore.history) &&
      JSON.stringify(rejectedAfter.port) === JSON.stringify(rejectedBefore.port) &&
      rejectedAfter.toast?.includes("whole number"),
    `Rejected filter value changed history/configuration or lacked feedback: ${JSON.stringify({ rejectedBefore, rejectedAfter })}`,
  );
  await page.locator("[name='machine-filter-minimum']").fill("2");
  return { unchangedBefore, unchangedAfter, rejectedBefore, rejectedAfter };
}

async function configureManifold(page, manifold) {
  await selectPlaced(page, manifold);
  assert(
    (await page.locator("[name='machine-enable-active']").count()) === 1 &&
      (await page.locator("[data-circuit-sorter-routes]").count()) === 1 &&
      (await page.locator("[name='machine-power-active']").count()) === 0 &&
      (await page.locator("[name='machine-filter-active']").count()) === 0,
    "Manifold capability gating exposed the wrong controls.",
  );
  const addRoute = page.locator("[data-circuit-action='add-route']");
  await addRoute.focus();
  await page.keyboard.press("Enter");
  await addRoute.focus();
  await page.keyboard.press("Enter");
  const rows = page.locator("[data-circuit-sorter-route]");
  assert((await rows.count()) === 2, "Keyboard route authoring did not add two rows.");
  await rows.nth(0).locator("[name='route-priority']").fill("10");
  await rows.nth(0).locator("[name='route-output']").selectOption("A");
  await setConditionWithin(rows.nth(0), "route", "routeA", ">", 0);
  await rows.nth(1).locator("[name='route-priority']").fill("10");
  await rows.nth(1).locator("[name='route-output']").selectOption("B");
  await setConditionWithin(rows.nth(1), "route", "routeB", ">", 0);
  await page
    .locator("[name='machine-sorter-fallback']")
    .selectOption("A");

  const rejectedBefore = await page.evaluate((id) => ({
    history: window.__CINDERLINE__?.circuitAuthoringState(),
    port: window.__CINDERLINE__?.simulation
      .circuitSnapshot()
      .machinePorts.find((candidate) => candidate.id === `entity:${id}:machine`),
  }), manifold.entity.id);
  await page
    .locator("form[data-circuit-form='machine'] .circuit-apply")
    .click();
  await page.waitForTimeout(140);
  const rejectedAfter = await page.evaluate((id) => ({
    history: window.__CINDERLINE__?.circuitAuthoringState(),
    port: window.__CINDERLINE__?.simulation
      .circuitSnapshot()
      .machinePorts.find((candidate) => candidate.id === `entity:${id}:machine`),
    toast: document.querySelector("[data-ref='toast-stack']")?.textContent,
    formValidity: (() => {
      const form = document.querySelector(
        "form[data-circuit-form='machine']",
      );
      return {
        valid: form instanceof HTMLFormElement ? form.checkValidity() : null,
        invalid: [
          ...(form?.querySelectorAll("input, select") ?? []),
        ]
          .filter(
            (field) =>
              field instanceof HTMLInputElement ||
              field instanceof HTMLSelectElement,
          )
          .filter((field) => !field.validity.valid)
          .map((field) => ({
            name: field.getAttribute("name"),
            value: field.value,
            message: field.validationMessage,
          })),
      };
    })(),
  }), manifold.entity.id);
  assert(
    JSON.stringify(rejectedAfter.history) ===
      JSON.stringify(rejectedBefore.history) &&
      JSON.stringify(rejectedAfter.port) === JSON.stringify(rejectedBefore.port) &&
      rejectedAfter.toast?.includes("priorities must be unique"),
    `Duplicate sorter priorities changed authoritative state/history: ${JSON.stringify({ rejectedBefore, rejectedAfter })}`,
  );

  await rows.nth(1).locator("[name='route-priority']").fill("20");
  await page
    .locator("form[data-circuit-form='machine'] .circuit-apply")
    .click();
  await page.waitForFunction(
    (id) => {
      const port = window.__CINDERLINE__?.simulation
        .circuitSnapshot()
        .machinePorts.find((candidate) => candidate.id === `entity:${id}:machine`);
      return (
        port?.sorterRoutes.length === 2 &&
        port.sorterRoutes[0]?.priority === 10 &&
        port.sorterRoutes[0]?.output === "A" &&
        port.sorterRoutes[1]?.priority === 20 &&
        port.sorterRoutes[1]?.output === "B" &&
        port.sorterFallback === "A"
      );
    },
    manifold.entity.id,
  );
  return { rejectedBefore, rejectedAfter };
}

async function configureFluidPump(page, pump) {
  await selectPlaced(page, pump);
  assert(
    (await page.locator("[name='machine-power-active']").count()) === 1 &&
      (await page.locator("[name='machine-enable-active']").count()) === 0 &&
      (await page.locator("[name='machine-filter-active']").count()) === 0 &&
      (await page.locator("[data-circuit-sorter-routes]").count()) === 0,
    "Fluid pump did not expose its distinct power-switch-only path.",
  );
  await page.locator("[name='machine-power-active']").check();
  await setCondition(page, "machine-power", "run", ">", 0);
  await page
    .locator("form[data-circuit-form='machine'] .circuit-apply")
    .click();
  await page.waitForFunction(
    (id) => {
      const port = window.__CINDERLINE__?.simulation
        .circuitSnapshot()
        .machinePorts.find((candidate) => candidate.id === `entity:${id}:machine`);
      return (
        port?.powerSwitchCondition?.left?.name === "run" &&
        port.enableCondition === null &&
        port.filter === null &&
        port.sorterRoutes.length === 0
      );
    },
    pump.entity.id,
  );
}

async function editorGeometry(page) {
  return page.evaluate(() => {
    const inspector = document.querySelector("[data-ref='inspector']");
    const consoleElement = document.querySelector(
      "[data-ref='circuit-console']",
    );
    const overview = document.querySelector(".minimap-shell");
    if (
      !(inspector instanceof HTMLElement) ||
      !(consoleElement instanceof HTMLElement) ||
      !(overview instanceof HTMLElement)
    ) {
      return null;
    }
    const inspectorBox = inspector.getBoundingClientRect();
    const overviewBox = overview.getBoundingClientRect();
    const overviewVisible =
      overviewBox.width > 0 &&
      overviewBox.height > 0 &&
      getComputedStyle(overview).display !== "none";
    const controls = [
      ...consoleElement.querySelectorAll(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled)",
      ),
    ]
      .map((element) => {
        const box = element.getBoundingClientRect();
        const labelled =
          element instanceof HTMLButtonElement
            ? Boolean(
                element.getAttribute("aria-label") ||
                  element.textContent?.trim(),
              )
            : Boolean(
                element.getAttribute("aria-label") ||
                  element.labels?.length,
              );
        return {
          tag: element.tagName,
          name: element.getAttribute("name"),
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
          labelled,
        };
      })
      .filter((control) => control.width > 0 && control.height > 0);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      inspector: {
        left: inspectorBox.left,
        right: inspectorBox.right,
        top: inspectorBox.top,
        bottom: inspectorBox.bottom,
        clientWidth: inspector.clientWidth,
        scrollWidth: inspector.scrollWidth,
        clientHeight: inspector.clientHeight,
        scrollHeight: inspector.scrollHeight,
      },
      overview: {
        visible: overviewVisible,
        left: overviewBox.left,
        right: overviewBox.right,
        top: overviewBox.top,
        bottom: overviewBox.bottom,
        safeGapMinimum: 12,
        gapToInspector: inspectorBox.left - overviewBox.right,
      },
      accessibility: {
        keyboardScope: consoleElement.dataset.keyboardScope,
        labelledBy: consoleElement.getAttribute("aria-labelledby"),
        liveRole: consoleElement
          .querySelector("[data-ref='circuit-live']")
          ?.getAttribute("role"),
        livePoliteness: consoleElement
          .querySelector("[data-ref='circuit-live']")
          ?.getAttribute("aria-live"),
        allControlsLabelled: controls.every((control) => control.labelled),
      },
      controls,
      horizontalOverflow:
        inspector.scrollWidth > inspector.clientWidth + 1 ||
        controls.some(
          (control) =>
            control.left < inspectorBox.left - 1 ||
            control.right > inspectorBox.right + 1,
        ),
    };
  });
}

async function screenshotEditor(
  page,
  placement,
  focusSelector,
  path,
  alreadySelected = false,
) {
  if (!alreadySelected) await selectPlaced(page, placement);
  await page.evaluate(() => window.__CINDERLINE__?.dismissToasts());
  const focus = page.locator(focusSelector).first();
  await focus.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const geometry = await editorGeometry(page);
  assert(
    geometry &&
      !geometry.horizontalOverflow &&
      geometry.accessibility.keyboardScope === "circuit" &&
      Boolean(geometry.accessibility.labelledBy) &&
      geometry.accessibility.liveRole === "status" &&
      geometry.accessibility.livePoliteness === "polite" &&
      geometry.accessibility.allControlsLabelled &&
      (geometry.viewport.width <= 690 ||
        (geometry.overview.visible &&
          geometry.overview.right <= geometry.inspector.left - 12)) &&
      geometry.inspector.left >= -1 &&
      geometry.inspector.right <= geometry.viewport.width + 1 &&
      geometry.inspector.top >= 0 &&
      geometry.inspector.bottom <= geometry.viewport.height + 1,
    `Editor geometry/accessibility failed: ${JSON.stringify(geometry)}`,
  );
  await page.screenshot({ path, animations: "disabled" });
  return geometry;
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
});
const page = await context.newPage();
const errors = captureErrors(page);
const screenshots = [];
let proof;

try {
  await page.goto(
    `${BASE_URL.replace(/\/$/, "")}/?showcase=circuit-capabilities-formative-02`,
    { waitUntil: "networkidle", timeout: 30_000 },
  );
  await waitForGame(page);

  const source = await placeThroughHUD(
    page,
    "constantCombinator",
    "signals",
  );
  const inserter = await placeThroughHUD(
    page,
    "inserter",
    "factory",
    source.point.cell,
  );
  const manifold = await placeThroughHUD(
    page,
    "manifold",
    "factory",
    source.point.cell,
  );
  const pump = await placeThroughHUD(
    page,
    "fluidPump",
    "fluids",
    source.point.cell,
  );
  const placements = { source, inserter, manifold, pump };

  const allSignals = [
    { type: "virtual", name: "run", value: 1 },
    { type: "virtual", name: "go", value: 1 },
    { type: "virtual", name: "routeA", value: 1 },
    { type: "virtual", name: "routeB", value: 1 },
    { type: "item", name: "ironPlate", value: 5 },
  ];
  await setConstantSignals(page, source, allSignals);
  const inserterHistory = await configureInserter(page, inserter);
  const manifoldHistory = await configureManifold(page, manifold);
  await configureFluidPump(page, pump);
  await connectThroughHUD(page, source, inserter, "red");
  await connectThroughHUD(page, source, manifold, "green");
  await connectThroughHUD(page, source, pump, "red");

  await page.waitForFunction(
    ({ inserterId, manifoldId, pumpId }) => {
      const simulation = window.__CINDERLINE__?.simulation;
      const inserterControl =
        simulation?.getCircuitMachineControl(inserterId);
      return (
        inserterControl?.enabled === true &&
        inserterControl.powerSwitchClosed === true &&
        inserterControl.filterSignal?.name === "ironPlate" &&
        simulation?.getCircuitMachineControl(manifoldId)?.sorterOutput ===
          "A" &&
        simulation?.getCircuitMachineControl(pumpId)?.powerSwitchClosed ===
          true
      );
    },
    {
      inserterId: inserter.entity.id,
      manifoldId: manifold.entity.id,
      pumpId: pump.entity.id,
    },
  );
  const initialControls = await page.evaluate(
    ({ inserterId, manifoldId, pumpId }) => ({
      inserter:
        window.__CINDERLINE__?.simulation.getCircuitMachineControl(
          inserterId,
        ),
      manifold:
        window.__CINDERLINE__?.simulation.getCircuitMachineControl(
          manifoldId,
        ),
      pump:
        window.__CINDERLINE__?.simulation.getCircuitMachineControl(pumpId),
    }),
    {
      inserterId: inserter.entity.id,
      manifoldId: manifold.entity.id,
      pumpId: pump.entity.id,
    },
  );

  await setConstantSignals(
    page,
    source,
    allSignals.filter((signal) => signal.name !== "routeA"),
  );
  await page.waitForFunction(
    (id) =>
      window.__CINDERLINE__?.simulation.getCircuitMachineControl(id)
        ?.sorterOutput === "B",
    manifold.entity.id,
  );
  const routeBDecision = await page.evaluate(
    (id) =>
      window.__CINDERLINE__?.simulation.getCircuitMachineControl(id),
    manifold.entity.id,
  );

  await setConstantSignals(
    page,
    source,
    allSignals.filter(
      (signal) =>
        signal.name !== "routeA" && signal.name !== "routeB",
    ),
  );
  await page.waitForFunction(
    (id) =>
      window.__CINDERLINE__?.simulation.getCircuitMachineControl(id)
        ?.sorterOutput === "A",
    manifold.entity.id,
  );
  const fallbackDecision = await page.evaluate(
    (id) =>
      window.__CINDERLINE__?.simulation.getCircuitMachineControl(id),
    manifold.entity.id,
  );

  await setConstantSignals(page, source, []);
  await page.waitForFunction(
    ({ inserterId, pumpId }) => {
      const simulation = window.__CINDERLINE__?.simulation;
      const inserterControl =
        simulation?.getCircuitMachineControl(inserterId);
      return (
        inserterControl?.enabled === false &&
        inserterControl.powerSwitchClosed === false &&
        inserterControl.filterSignal === null &&
        simulation?.getCircuitMachineControl(pumpId)
          ?.powerSwitchClosed === false
      );
    },
    { inserterId: inserter.entity.id, pumpId: pump.entity.id },
  );
  const stoppedControls = await page.evaluate(
    ({ inserterId, pumpId }) => ({
      inserter:
        window.__CINDERLINE__?.simulation.getCircuitMachineControl(
          inserterId,
        ),
      pump:
        window.__CINDERLINE__?.simulation.getCircuitMachineControl(pumpId),
    }),
    { inserterId: inserter.entity.id, pumpId: pump.entity.id },
  );
  await setConstantSignals(page, source, allSignals);

  await selectPlaced(page, source);
  const historyBeforeKeyboardCancel = await page.evaluate(
    () => window.__CINDERLINE__?.circuitAuthoringState(),
  );
  const greenButton = page.locator(
    "[data-circuit-connector='output'] [data-wire-color='green']",
  );
  await greenButton.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  const historyAfterKeyboardCancel = await page.evaluate(
    () => window.__CINDERLINE__?.circuitAuthoringState(),
  );
  assert(
    JSON.stringify(historyAfterKeyboardCancel) ===
      JSON.stringify(historyBeforeKeyboardCancel),
    "Keyboard Escape cancellation changed history or remained armed.",
  );

  const desktopInserterPath =
    `${OUTPUT_DIRECTORY}/desktop-inserter-power-filter.png`;
  const desktopInserterGeometry = await screenshotEditor(
    page,
    inserter,
    "[name='machine-filter-active']",
    desktopInserterPath,
  );
  screenshots.push(desktopInserterPath);
  const desktopManifoldPath =
    `${OUTPUT_DIRECTORY}/desktop-manifold-sorter.png`;
  const desktopManifoldGeometry = await screenshotEditor(
    page,
    manifold,
    "[data-circuit-sorter-routes]",
    desktopManifoldPath,
  );
  screenshots.push(desktopManifoldPath);

  const ids = Object.fromEntries(
    Object.entries(placements).map(([name, placement]) => [
      name,
      placement.entity.id,
    ]),
  );
  const saved = await page.evaluate(() => {
    window.dispatchEvent(new Event("beforeunload"));
    const raw = localStorage.getItem("cinderline.autosave.v5");
    return raw ? JSON.parse(raw) : null;
  });
  assert(
    saved?.simulation?.circuitNetwork?.wires?.length >= 3,
    "Capability topology was not persisted.",
  );
  await page.goto(
    `${BASE_URL.replace(/\/$/, "")}/?circuitCapabilitiesReload=1`,
    { waitUntil: "networkidle", timeout: 30_000 },
  );
  await waitForGame(page);
  await page.waitForFunction(
    ({ sourceId, inserterId, manifoldId, pumpId }) => {
      const simulation = window.__CINDERLINE__?.simulation;
      return (
        simulation?.getEntity(sourceId)?.kind === "constantCombinator" &&
        simulation?.getCircuitMachineControl(inserterId)?.filterSignal
          ?.name === "ironPlate" &&
        simulation?.getCircuitMachineControl(manifoldId)?.sorterOutput ===
          "A" &&
        simulation?.getCircuitMachineControl(pumpId)
          ?.powerSwitchClosed === true
      );
    },
    {
      sourceId: ids.source,
      inserterId: ids.inserter,
      manifoldId: ids.manifold,
      pumpId: ids.pump,
    },
  );
  const reloaded = await page.evaluate((entityIds) => {
    const simulation = window.__CINDERLINE__?.simulation;
    return {
      wires: simulation?.circuitSnapshot().wires,
      inserterPort: simulation
        ?.circuitSnapshot()
        .machinePorts.find(
          (port) => port.id === `entity:${entityIds.inserter}:machine`,
        ),
      manifoldPort: simulation
        ?.circuitSnapshot()
        .machinePorts.find(
          (port) => port.id === `entity:${entityIds.manifold}:machine`,
        ),
      pumpPort: simulation
        ?.circuitSnapshot()
        .machinePorts.find(
          (port) => port.id === `entity:${entityIds.pump}:machine`,
        ),
      inserterControl: simulation?.getCircuitMachineControl(
        entityIds.inserter,
      ),
      manifoldControl: simulation?.getCircuitMachineControl(
        entityIds.manifold,
      ),
      pumpControl: simulation?.getCircuitMachineControl(entityIds.pump),
    };
  }, ids);

  await page.setViewportSize({ width: 600, height: 800 });
  await page.evaluate((id) => {
    window.__CINDERLINE__?.selectEntity(id);
    window.__CINDERLINE__?.refreshHUD();
    window.__CINDERLINE__?.dismissToasts();
  }, ids.inserter);
  await page.waitForTimeout(520);
  const responsiveInserterPath =
    `${OUTPUT_DIRECTORY}/responsive-600x800-inserter-filter.png`;
  const responsiveInserterGeometry = await screenshotEditor(
    page,
    { ...inserter, entity: { ...inserter.entity, id: ids.inserter } },
    "[name='machine-filter-active']",
    responsiveInserterPath,
    true,
  );
  screenshots.push(responsiveInserterPath);

  await page.evaluate((id) => {
    window.__CINDERLINE__?.selectEntity(id);
    window.__CINDERLINE__?.refreshHUD();
    window.__CINDERLINE__?.dismissToasts();
  }, ids.manifold);
  await page.waitForTimeout(520);
  const responsiveManifoldPath =
    `${OUTPUT_DIRECTORY}/responsive-600x800-manifold-sorter.png`;
  const responsiveManifoldGeometry = await screenshotEditor(
    page,
    { ...manifold, entity: { ...manifold.entity, id: ids.manifold } },
    "[data-circuit-sorter-routes]",
    responsiveManifoldPath,
    true,
  );
  screenshots.push(responsiveManifoldPath);

  assert(errors.length === 0, `Browser errors: ${errors.join(" | ")}`);
  proof = {
    formative: true,
    interactionPolicy:
      "All construction, configuration, dynamic route editing, wire authoring, rejection, unchanged apply, and cancellation used native HUD/canvas controls. Debug access was read-only except deterministic responsive inspector selection.",
    placements: Object.fromEntries(
      Object.entries(placements).map(([name, placement]) => [
        name,
        {
          id: placement.entity.id,
          kind: placement.kind,
          cell: placement.point.cell,
        },
      ]),
    ),
    capabilityGating: {
      inserter: ["enableCondition", "powerSwitchCondition", "filter"],
      manifold: ["enableCondition", "sorterRoutes", "sorterFallback"],
      fluidPump: ["powerSwitchCondition"],
    },
    authoritativeControls: {
      initial: initialControls,
      routeBDecision,
      fallbackDecision,
      stopped: stoppedControls,
      reloaded,
    },
    history: {
      inserter: inserterHistory,
      manifold: manifoldHistory,
      keyboardCancel: {
        before: historyBeforeKeyboardCancel,
        after: historyAfterKeyboardCancel,
      },
    },
    geometry: {
      desktop: {
        inserter: desktopInserterGeometry,
        manifold: desktopManifoldGeometry,
      },
      responsive600x800: {
        inserter: responsiveInserterGeometry,
        manifold: responsiveManifoldGeometry,
      },
    },
    errors,
  };
} finally {
  await context.close();
  await browser.close();
}

assert(proof, "Capability-specific browser proof was not produced.");
await writeFile(
  `${OUTPUT_DIRECTORY}/browser-proof.json`,
  `${JSON.stringify(proof, null, 2)}\n`,
  "utf8",
);
const manifest = [];
for (const path of screenshots) {
  const bytes = await readFile(path);
  manifest.push({
    path,
    bytes: bytes.length,
    sha256: digest(bytes),
  });
}
await writeFile(
  `${OUTPUT_DIRECTORY}/screenshot-manifest.json`,
  `${JSON.stringify({ formative: true, screenshots: manifest }, null, 2)}\n`,
  "utf8",
);
console.log(
  JSON.stringify(
    {
      ok: true,
      outputDirectory: OUTPUT_DIRECTORY,
      placements: proof.placements,
      controls: proof.authoritativeControls,
      screenshots: manifest,
      errors: proof.errors,
    },
    null,
    2,
  ),
);
