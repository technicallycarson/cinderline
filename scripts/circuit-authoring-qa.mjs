import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL =
  process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY =
  process.env.CINDERLINE_CIRCUIT_AUTHORING_OUTPUT ??
  ".qa/circuit-authoring/pass1-work/formative-01";

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

async function findPlacementChain(page) {
  const chain = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    const canvas = document.querySelector("#world");
    if (!game || !(canvas instanceof HTMLCanvasElement)) return null;
    const bounds = canvas.getBoundingClientRect();
    const candidates = [];
    const visited = new Set();
    const minX = bounds.width <= 700 ? 245 : 330;
    const maxX = bounds.width <= 700
      ? bounds.width - 30
      : bounds.width - 505;
    const minY = 145;
    const maxY = bounds.height - 175;
    for (let clientY = minY; clientY <= maxY; clientY += 4) {
      for (let clientX = minX; clientX <= maxX; clientX += 4) {
        const cell = game.renderer.screenToGrid(
          bounds.left + clientX,
          bounds.top + clientY,
        );
        if (!cell) continue;
        const key = `${cell.x},${cell.z}`;
        if (visited.has(key)) continue;
        visited.add(key);
        if (
          game.simulation.canPlace(
            "constantCombinator",
            cell.x,
            cell.z,
            1,
          ).ok
        ) {
          candidates.push({
            clientX: bounds.left + clientX,
            clientY: bounds.top + clientY,
            cell,
          });
        }
      }
    }
    const distance = (left, right) =>
      Math.hypot(
        left.cell.x - right.cell.x,
        left.cell.z - right.cell.z,
      );
    for (const first of candidates) {
      const second = candidates.find(
        (candidate) =>
          candidate !== first &&
          distance(first, candidate) >= 1 &&
          distance(first, candidate) <= 4,
      );
      if (!second) continue;
      const third = candidates.find(
        (candidate) =>
          candidate !== first &&
          candidate !== second &&
          distance(second, candidate) >= 1 &&
          distance(second, candidate) <= 4,
      );
      if (!third) continue;
      const fourth = candidates.find(
        (candidate) =>
          candidate !== first &&
          candidate !== second &&
          candidate !== third &&
          distance(third, candidate) >= 1 &&
          distance(third, candidate) <= 4,
      );
      if (fourth) return [first, second, third, fourth];
    }
    return null;
  });
  assert(chain?.length === 4, "No visible four-unit circuit chain was found.");
  return chain;
}

async function placeThroughHUD(page, definition, point) {
  await page
    .locator(`[data-build-category-select="${definition.category}"]`)
    .click();
  const card = page.locator(`[data-build="${definition.kind}"]`);
  await card.waitFor({ state: "visible" });
  const beforeIds = await page.evaluate(
    (kind) =>
      window.__CINDERLINE__?.simulation
        .getEntities(kind)
        .map((entity) => entity.id) ?? [],
    definition.kind,
  );
  await card.click();
  await page.mouse.move(point.clientX, point.clientY);
  await page.waitForTimeout(80);
  await page.mouse.click(point.clientX, point.clientY);
  await page.waitForFunction(
    ({ kind, count }) =>
      (window.__CINDERLINE__?.simulation.getEntities(kind).length ?? 0) >
      count,
    { kind: definition.kind, count: beforeIds.length },
  );
  const entity = await page.evaluate(
    ({ kind, before }) => {
      const game = window.__CINDERLINE__;
      return game?.simulation
        .getEntities(kind)
        .find((candidate) => !before.includes(candidate.id));
    },
    { kind: definition.kind, before: beforeIds },
  );
  assert(entity, `${definition.kind} was not placed through the HUD.`);
  return { ...definition, point, entity };
}

async function selectPlaced(page, placement) {
  await page.keyboard.press("Escape");
  await page.mouse.click(placement.point.clientX, placement.point.clientY);
  await page.waitForFunction(
    (id) =>
      document
        .querySelector("[data-ref='inspector']")
        ?.classList.contains("is-open") &&
      document
        .querySelector("[data-ref='inspector-type']")
        ?.textContent?.includes(`UNIT ${String(id).padStart(3, "0")}`),
    placement.entity.id,
  );
  await page
    .locator("[data-ref='circuit-console']")
    .waitFor({ state: "visible" });
}

async function configureConstant(page, placement, enabled = true) {
  await selectPlaced(page, placement);
  const toggle = page.locator("[name='constant-enabled']");
  if (enabled) await toggle.check();
  else await toggle.uncheck();
  const rows = page.locator("[data-circuit-constant-row]");
  if ((await rows.count()) === 0) {
    await page.locator("[data-circuit-action='add-signal']").click();
  }
  const first = page.locator("[data-circuit-constant-row]").first();
  await first.locator("[name='constant-signal-type']").selectOption("virtual");
  await first.locator("[name='constant-signal-name']").fill("run");
  await first.locator("[name='constant-signal-value']").fill("1");
  if ((await rows.count()) < 2) {
    await page.locator("[data-circuit-action='add-signal']").click();
  }
  const second = page.locator("[data-circuit-constant-row]").nth(1);
  await second.locator("[name='constant-signal-type']").selectOption("item");
  await second.locator("[name='constant-signal-name']").fill("ironPlate");
  await second.locator("[name='constant-signal-value']").fill("3");
  await page
    .locator("form[data-circuit-form='constant'] .circuit-apply")
    .click();
  await page.waitForFunction(
    ({ id, enabled }) => {
      const device = window.__CINDERLINE__?.simulation
        .circuitSnapshot()
        .devices.find((candidate) => candidate.id === `entity:${id}:device`);
      return (
        device?.kind === "constant" &&
        device.enabled === enabled &&
        device.signals.length === 2
      );
    },
    { id: placement.entity.id, enabled },
  );
}

async function configureArithmetic(page, placement) {
  await selectPlaced(page, placement);
  await page.locator("[name='arith-left-source']").selectOption("signal");
  await page.locator("[name='arith-left-type']").selectOption("virtual");
  await page.locator("[name='arith-left-name']").fill("run");
  await page.locator("[name='arith-operator']").selectOption("multiply");
  await page.locator("[name='arith-right-source']").selectOption("constant");
  await page.locator("[name='arith-right-value']").fill("2");
  await page.locator("[name='arith-output-source']").selectOption("signal");
  await page.locator("[name='arith-output-type']").selectOption("virtual");
  await page.locator("[name='arith-output-name']").fill("scaled");
  await page
    .locator("form[data-circuit-form='arithmetic'] .circuit-apply")
    .click();
  await page.waitForFunction(
    (id) => {
      const device = window.__CINDERLINE__?.simulation
        .circuitSnapshot()
        .devices.find((candidate) => candidate.id === `entity:${id}:device`);
      return device?.kind === "arithmetic" && device.operator === "multiply";
    },
    placement.entity.id,
  );
}

async function configureDecider(page, placement) {
  await selectPlaced(page, placement);
  await page.locator("[name='decider-left-source']").selectOption("signal");
  await page.locator("[name='decider-left-type']").selectOption("virtual");
  await page.locator("[name='decider-left-name']").fill("scaled");
  await page.locator("[name='decider-operator']").selectOption(">=");
  await page.locator("[name='decider-right-source']").selectOption("constant");
  await page.locator("[name='decider-right-value']").fill("2");
  await page.locator("[name='decider-output-source']").selectOption("signal");
  await page.locator("[name='decider-output-type']").selectOption("virtual");
  await page.locator("[name='decider-output-name']").fill("go");
  await page.locator("[name='decider-output-mode']").selectOption("one");
  await page
    .locator("form[data-circuit-form='decider'] .circuit-apply")
    .click();
  await page.waitForFunction(
    (id) => {
      const device = window.__CINDERLINE__?.simulation
        .circuitSnapshot()
        .devices.find((candidate) => candidate.id === `entity:${id}:device`);
      return (
        device?.kind === "decider" &&
        device.condition.operator === ">=" &&
        device.outputMode === "one"
      );
    },
    placement.entity.id,
  );
}

async function configureInserter(page, placement) {
  await selectPlaced(page, placement);
  await page.locator("[name='machine-enable-active']").check();
  await page
    .locator("[name='machine-enable-left-source']")
    .selectOption("signal");
  await page
    .locator("[name='machine-enable-left-type']")
    .selectOption("virtual");
  await page.locator("[name='machine-enable-left-name']").fill("go");
  await page.locator("[name='machine-enable-operator']").selectOption(">");
  await page
    .locator("[name='machine-enable-right-source']")
    .selectOption("constant");
  await page.locator("[name='machine-enable-right-value']").fill("0");
  await page
    .locator("form[data-circuit-form='machine'] .circuit-apply")
    .click();
  await page.waitForFunction(
    (id) => {
      const port = window.__CINDERLINE__?.simulation
        .circuitSnapshot()
        .machinePorts.find((candidate) => candidate.id === `entity:${id}:machine`);
      return port?.enableCondition?.operator === ">";
    },
    placement.entity.id,
  );
}

async function connectThroughHUD(
  page,
  source,
  sourceConnector,
  target,
  targetConnector,
  color,
) {
  const before = await page.evaluate(
    () => window.__CINDERLINE__?.simulation.circuitSnapshot().wires.length ?? -1,
  );
  await selectPlaced(page, source);
  await page
    .locator(
      `[data-circuit-connector="${sourceConnector}"] [data-wire-color="${color}"]`,
    )
    .click();
  assert(
    (await page.evaluate(
      () => window.__CINDERLINE__?.circuitAuthoringState().pendingWire?.color,
    )) === color,
    `${color} source was not armed.`,
  );
  await page.mouse.click(target.point.clientX, target.point.clientY);
  await page
    .locator(
      `[data-circuit-connector="${targetConnector}"] [data-wire-color="${color}"]`,
    )
    .click();
  await page.waitForFunction(
    (count) =>
      (window.__CINDERLINE__?.simulation.circuitSnapshot().wires.length ??
        -1) ===
      count + 1,
    before,
  );
}

async function geometryProof(page) {
  return page.evaluate(() => {
    const inspector = document.querySelector("[data-ref='inspector']");
    const consoleElement = document.querySelector(
      "[data-ref='circuit-console']",
    );
    if (
      !(inspector instanceof HTMLElement) ||
      !(consoleElement instanceof HTMLElement)
    ) {
      return null;
    }
    const viewport = { width: innerWidth, height: innerHeight };
    const inspectorBox = inspector.getBoundingClientRect();
    const controls = [
      ...consoleElement.querySelectorAll(
        "button:not([hidden]), input:not([hidden]), select:not([hidden])",
      ),
    ].map((element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    });
    return {
      viewport,
      accessibility: {
        keyboardScope: consoleElement.dataset.keyboardScope,
        liveRole: consoleElement
          .querySelector("[data-ref='circuit-live']")
          ?.getAttribute("role"),
        livePoliteness: consoleElement
          .querySelector("[data-ref='circuit-live']")
          ?.getAttribute("aria-live"),
        labelledBy: consoleElement.getAttribute("aria-labelledby"),
      },
      inspector: {
        left: inspectorBox.left,
        right: inspectorBox.right,
        top: inspectorBox.top,
        bottom: inspectorBox.bottom,
        clientHeight: inspector.clientHeight,
        scrollHeight: inspector.scrollHeight,
        clientWidth: inspector.clientWidth,
        scrollWidth: inspector.scrollWidth,
      },
      horizontalOverflow:
        inspector.scrollWidth > inspector.clientWidth + 1 ||
        controls.some(
          (control) =>
            control.left < inspectorBox.left - 1 ||
            control.right > inspectorBox.right + 1,
        ),
      controls,
    };
  });
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
    `${BASE_URL.replace(/\/$/, "")}/?showcase=circuit-authoring-formative-01`,
    { waitUntil: "networkidle", timeout: 30_000 },
  );
  await waitForGame(page);

  const points = await findPlacementChain(page);
  const definitions = [
    { kind: "constantCombinator", category: "signals" },
    { kind: "arithmeticCombinator", category: "signals" },
    { kind: "deciderCombinator", category: "signals" },
    { kind: "inserter", category: "factory" },
  ];
  const placements = [];
  for (const [index, definition] of definitions.entries()) {
    placements.push(
      await placeThroughHUD(page, definition, points[index]),
    );
  }
  const [source, arithmetic, decider, inserter] = placements;

  await configureConstant(page, source, true);
  await configureArithmetic(page, arithmetic);
  await configureDecider(page, decider);
  await configureInserter(page, inserter);

  await connectThroughHUD(
    page,
    source,
    "output",
    arithmetic,
    "input",
    "red",
  );
  await connectThroughHUD(
    page,
    arithmetic,
    "output",
    decider,
    "input",
    "red",
  );
  await connectThroughHUD(
    page,
    decider,
    "output",
    inserter,
    "io",
    "green",
  );
  await page.waitForFunction(
    (id) =>
      window.__CINDERLINE__?.simulation.getCircuitMachineControl(id)
        ?.enabled === true,
    inserter.entity.id,
  );

  const duplicateBefore = await page.evaluate(() => ({
    history: window.__CINDERLINE__?.circuitAuthoringState(),
    wires:
      window.__CINDERLINE__?.simulation.circuitSnapshot().wires.length,
  }));
  await selectPlaced(page, source);
  await page
    .locator(
      '[data-circuit-connector="output"] [data-wire-color="red"]',
    )
    .click();
  await page.mouse.click(arithmetic.point.clientX, arithmetic.point.clientY);
  await page
    .locator(
      '[data-circuit-connector="input"] [data-wire-color="red"]',
    )
    .click();
  await page.waitForTimeout(180);
  const duplicateAfter = await page.evaluate(() => ({
    history: window.__CINDERLINE__?.circuitAuthoringState(),
    wires:
      window.__CINDERLINE__?.simulation.circuitSnapshot().wires.length,
    toast: document.querySelector("[data-ref='toast-stack']")?.textContent,
  }));
  assert(
    duplicateAfter.wires === duplicateBefore.wires &&
      duplicateAfter.history.undoDepth === duplicateBefore.history.undoDepth &&
      duplicateAfter.toast?.includes("already share a wire"),
    "Duplicate wire rejection changed topology/history or lacked feedback.",
  );
  await page.locator("[data-circuit-wire-action='cancel']").click();
  const cancelAfter = await page.evaluate(
    () => window.__CINDERLINE__?.circuitAuthoringState(),
  );
  assert(
    cancelAfter.undoDepth === duplicateBefore.history.undoDepth &&
      cancelAfter.pendingWire === null,
    "Cancel created history or left the wire workflow armed.",
  );

  await configureConstant(page, source, false);
  await page.waitForFunction(
    (id) =>
      window.__CINDERLINE__?.simulation.getCircuitMachineControl(id)
        ?.enabled === false,
    inserter.entity.id,
  );
  await page.keyboard.press("Control+KeyZ");
  await page.waitForFunction(
    ({ sourceId, machineId }) => {
      const game = window.__CINDERLINE__;
      const device = game?.simulation
        .circuitSnapshot()
        .devices.find(
          (candidate) => candidate.id === `entity:${sourceId}:device`,
        );
      return (
        device?.kind === "constant" &&
        device.enabled === true &&
        game?.simulation.getCircuitMachineControl(machineId)?.enabled === true
      );
    },
    { sourceId: source.entity.id, machineId: inserter.entity.id },
  );
  await page.keyboard.press("Control+Shift+KeyZ");
  await page.waitForFunction(
    ({ sourceId, machineId }) => {
      const game = window.__CINDERLINE__;
      const device = game?.simulation
        .circuitSnapshot()
        .devices.find(
          (candidate) => candidate.id === `entity:${sourceId}:device`,
        );
      return (
        device?.kind === "constant" &&
        device.enabled === false &&
        game?.simulation.getCircuitMachineControl(machineId)?.enabled === false
      );
    },
    { sourceId: source.entity.id, machineId: inserter.entity.id },
  );
  await configureConstant(page, source, true);
  await page.waitForFunction(
    (id) =>
      window.__CINDERLINE__?.simulation.getCircuitMachineControl(id)
        ?.enabled === true,
    inserter.entity.id,
  );

  await selectPlaced(page, inserter);
  const greenWireRecord = page
    .locator(".circuit-wire-record")
    .filter({ has: page.locator(".wire-dot.is-green") });
  await greenWireRecord.locator("button").click();
  await page.waitForFunction(
    (id) =>
      (window.__CINDERLINE__?.simulation.circuitSnapshot().wires.length ??
        -1) === 2 &&
      window.__CINDERLINE__?.simulation.getCircuitMachineControl(id)
        ?.enabled === false,
    inserter.entity.id,
  );
  await page.keyboard.press("Control+KeyZ");
  await page.waitForFunction(
    (id) =>
      (window.__CINDERLINE__?.simulation.circuitSnapshot().wires.length ??
        -1) === 3 &&
      window.__CINDERLINE__?.simulation.getCircuitMachineControl(id)
        ?.enabled === true,
    inserter.entity.id,
  );
  await selectPlaced(page, inserter);
  await page
    .locator(".circuit-wire-record")
    .filter({ has: page.locator(".wire-dot.is-green") })
    .locator("button")
    .click();
  await page.waitForFunction(
    () =>
      (window.__CINDERLINE__?.simulation.circuitSnapshot().wires.length ??
        -1) === 2,
  );
  await connectThroughHUD(
    page,
    decider,
    "output",
    inserter,
    "io",
    "green",
  );
  await page.waitForFunction(
    (id) =>
      window.__CINDERLINE__?.simulation.getCircuitMachineControl(id)
        ?.enabled === true,
    inserter.entity.id,
  );

  await selectPlaced(page, source);
  await page.evaluate(() => window.__CINDERLINE__?.dismissToasts());
  await page.waitForTimeout(220);
  const desktopGeometry = await geometryProof(page);
  assert(
    desktopGeometry &&
      !desktopGeometry.horizontalOverflow &&
      desktopGeometry.inspector.left >= 0 &&
      desktopGeometry.inspector.right <= desktopGeometry.viewport.width &&
      desktopGeometry.inspector.top >= 0 &&
      desktopGeometry.inspector.bottom <= desktopGeometry.viewport.height,
    `Desktop circuit editor clipped: ${JSON.stringify(desktopGeometry)}`,
  );
  const desktopScreenshot = `${OUTPUT_DIRECTORY}/desktop-circuit-editor.png`;
  await page.screenshot({
    path: desktopScreenshot,
    animations: "disabled",
  });
  screenshots.push(desktopScreenshot);

  const beforeReload = await page.evaluate((ids) => {
    const game = window.__CINDERLINE__;
    window.dispatchEvent(new Event("beforeunload"));
    const saved = localStorage.getItem("cinderline.autosave.v5");
    return {
      ids,
      circuit: game?.simulation.circuitSnapshot(),
      control: game?.simulation.getCircuitMachineControl(ids[3]),
      saved: saved ? JSON.parse(saved) : null,
    };
  }, placements.map((placement) => placement.entity.id));
  assert(
    beforeReload.saved?.simulation?.circuitNetwork?.wires?.length === 3,
    "Autosave did not persist the authored circuit topology.",
  );

  await page.goto(
    `${BASE_URL.replace(/\/$/, "")}/?circuitAuthoringReload=1`,
    { waitUntil: "networkidle", timeout: 30_000 },
  );
  await waitForGame(page);
  await page.waitForFunction(
    ({ ids }) => {
      const game = window.__CINDERLINE__;
      return (
        ids.every((id) => Boolean(game?.simulation.getEntity(id))) &&
        game?.simulation.circuitSnapshot().wires.length === 3 &&
        game?.simulation.getCircuitMachineControl(ids[3])?.enabled === true
      );
    },
    { ids: beforeReload.ids },
  );
  const reloaded = await page.evaluate((ids) => {
    const game = window.__CINDERLINE__;
    return {
      entityKinds: ids.map((id) => game?.simulation.getEntity(id)?.kind),
      devices: game?.simulation.circuitSnapshot().devices.filter((device) =>
        ids.includes(Number(device.id.split(":")[1])),
      ),
      wires: game?.simulation.circuitSnapshot().wires,
      machinePort: game?.simulation
        .circuitSnapshot()
        .machinePorts.find((port) => port.id === `entity:${ids[3]}:machine`),
      control: game?.simulation.getCircuitMachineControl(ids[3]),
    };
  }, beforeReload.ids);
  assert(
    reloaded.devices.length === 3 &&
      reloaded.wires.length === 3 &&
      reloaded.machinePort?.enableCondition?.operator === ">" &&
      reloaded.control?.enabled === true,
    "Reload lost authored programs, wires, or downstream machine causality.",
  );

  await page.setViewportSize({ width: 600, height: 800 });
  await page.evaluate((id) => {
    window.__CINDERLINE__?.selectEntity(id);
    window.__CINDERLINE__?.refreshHUD();
    window.__CINDERLINE__?.dismissToasts();
  }, beforeReload.ids[0]);
  await page.waitForTimeout(520);
  const responsiveGeometry = await geometryProof(page);
  assert(
    responsiveGeometry &&
      !responsiveGeometry.horizontalOverflow &&
      responsiveGeometry.accessibility.keyboardScope === "circuit" &&
      responsiveGeometry.accessibility.liveRole === "status" &&
      responsiveGeometry.accessibility.livePoliteness === "polite" &&
      Boolean(responsiveGeometry.accessibility.labelledBy) &&
      responsiveGeometry.inspector.left >= 0 &&
      responsiveGeometry.inspector.right <= 600 &&
      responsiveGeometry.inspector.top >= 0 &&
      responsiveGeometry.inspector.bottom <= 800 &&
      responsiveGeometry.controls
        .filter((control) => control.bottom > 54 && control.top < 800)
        .every((control) => control.width > 0 && control.height > 0),
    `Responsive circuit editor clipped: ${JSON.stringify(responsiveGeometry)}`,
  );
  const responsiveTop = `${OUTPUT_DIRECTORY}/responsive-600x800-editor.png`;
  await page.screenshot({
    path: responsiveTop,
    animations: "disabled",
  });
  screenshots.push(responsiveTop);
  await page.locator("[data-ref='inspector']").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.waitForTimeout(120);
  const responsivePatchbay =
    `${OUTPUT_DIRECTORY}/responsive-600x800-patchbay.png`;
  await page.screenshot({
    path: responsivePatchbay,
    animations: "disabled",
  });
  screenshots.push(responsivePatchbay);

  assert(errors.length === 0, `Browser errors: ${errors.join(" | ")}`);
  proof = {
    formative: true,
    viewportEvidence: {
      desktop: { width: 1440, height: 900, geometry: desktopGeometry },
      responsive: {
        width: 600,
        height: 800,
        geometry: responsiveGeometry,
      },
    },
    placements: placements.map((placement) => ({
      id: placement.entity.id,
      kind: placement.entity.kind,
      cell: placement.point.cell,
      authoring: "HUD build card + canvas click",
    })),
    programs: {
      constant: "multi-signal run=1 + ironPlate=3, enabled",
      arithmetic: "run multiply 2 → scaled",
      decider: "scaled >= 2 → go (one)",
      inserter: "enable when go > 0",
    },
    wires: [
      "red constant.output → arithmetic.input",
      "red arithmetic.output → decider.input",
      "green decider.output → inserter.io",
    ],
    rejectionAndCancel: { duplicateBefore, duplicateAfter, cancelAfter },
    causality: {
      enabledAfterChain: true,
      disabledAfterConstantToggle: true,
      undoRestoredEnabled: true,
      redoRestoredDisabled: true,
      disconnectDisabledMachine: true,
      reconnectEnabledMachine: true,
    },
    persistence: {
      storedWireCount:
        beforeReload.saved.simulation.circuitNetwork.wires.length,
      reloaded,
    },
    errors,
  };
} finally {
  await context.close();
  await browser.close();
}

assert(proof, "Circuit authoring proof was not produced.");
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
      screenshots: manifest,
      errors: proof.errors,
    },
    null,
    2,
  ),
);
