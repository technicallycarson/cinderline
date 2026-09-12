import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE_URL = (process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173")
  .replace(/\/$/, "");
const OUTPUT_DIRECTORY = resolve(
  process.env.CINDERLINE_UPLINK_PLAYABILITY_OUTPUT
    ?? ".qa/uplink-playability",
);
const REPORT_PATH = resolve(
  OUTPUT_DIRECTORY,
  "uplink-playability-report.json",
);
const VIEWPORT = { width: 1920, height: 1080 };
const DIRECTION = Object.freeze({ North: 0, East: 1, South: 2, West: 3 });
const DOCK = Object.freeze({ x: 21, z: 12 });
const DECOY = Object.freeze({ x: 21, z: 11 });

await mkdir(OUTPUT_DIRECTORY, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: VIEWPORT,
  screen: VIEWPORT,
  deviceScaleFactor: 1,
  colorScheme: "dark",
  hasTouch: true,
  serviceWorkers: "block",
});
const page = await context.newPage();
const diagnostics = observePage(page);
const startURL = new URL(BASE_URL);
startURL.searchParams.set("fresh", `uplink-playability-${Date.now()}`);

const report = {
  schema: "cinderline-uplink-playability-qa",
  version: 1,
  status: "running",
  baseURL: BASE_URL,
  startURL: startURL.toString(),
  outputDirectory: OUTPUT_DIRECTORY,
  viewport: VIEWPORT,
  inputPolicy: {
    construction:
      "Native build-card clicks, keyboard rotation, and canvas pointer gestures only.",
    touchSelection: "Native Playwright touchscreen tap on the occupied dock cell.",
    camera:
      "Public renderer.focus changes only the view; screenToGrid locates targets under the real canvas.",
    acceleration:
      "Public simulation.step advances authoritative fixed ticks in small batches; animation frames retain the live Uplink transfer adapter and event handling.",
    forbiddenShortcuts: [
      "direct simulation.place",
      "direct cargo injection",
      "direct progression inventory mutation",
      "direct entity selection",
    ],
  },
  artifacts: [],
  proof: null,
  diagnostics,
};

let failure = null;

try {
  await page.goto(startURL.toString(), {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => document.querySelector("#boot")?.classList.contains("is-done"),
    null,
    { timeout: 12_000 },
  );
  await page.waitForFunction(
    () => {
      const boot = document.querySelector("#boot");
      return !boot || boot.hidden || boot.getAttribute("aria-hidden") === "true";
    },
    null,
    { timeout: 12_000 },
  );
  await page.waitForFunction(
    () => window.__CINDERLINE__?.stats().entityCount === 11,
    null,
    { timeout: 12_000 },
  );
  await waitForNoToasts(page, 8_000);

  const initial = await readGameState(page);
  assert(initial.entityCount === 11, `Fresh campaign has ${initial.entityCount} entities.`);
  assert(initial.alloy === 240, `Fresh campaign has ${initial.alloy} alloy.`);
  assert(initial.uplinkEntityId === 11, `Fresh Uplink ID is ${initial.uplinkEntityId}.`);
  assert(initial.manifest.length === 0, "Fresh Uplink manifest is not empty.");
  assert(initial.decoy === null && initial.dock === null, "Fresh Uplink rear cells are occupied.");
  assert(
    initial.reservation?.dockTile?.x === DOCK.x
      && initial.reservation?.dockTile?.z === DOCK.z,
    `Canonical dock is not X${DOCK.x} Z${DOCK.z}: ${JSON.stringify(initial.reservation)}.`,
  );
  assert(
    initial.reservation?.legacyRearTile?.x === DECOY.x
      && initial.reservation?.legacyRearTile?.z === DECOY.z,
    `False rear lane is not X${DECOY.x} Z${DECOY.z}: ${JSON.stringify(initial.reservation)}.`,
  );

  const uplinkPoints = await focusAndLocateCells(page, 22.1, 11.9, [
    DECOY,
    DOCK,
    { x: 20, z: 12 },
    { x: 22, z: 11 },
  ]);
  report.artifacts.push(await capture(page, "before.png"));

  const beltCard = page.locator("[data-build='belt']");
  await beltCard.click();
  assert(
    (await beltCard.getAttribute("aria-pressed")) === "true",
    "Belt build card did not arm from one native click.",
  );

  const beforeDecoy = await readGameState(page);
  await moveToCell(page, uplinkPoints, DECOY);
  const decoyGhost = await inspectGhost(page);
  assertGhost(decoyGhost, {
    kind: "belt",
    x: DECOY.x,
    z: DECOY.z,
    valid: false,
  });
  assert(
    decoyGhost.visibleMeshes > 0,
    `Decoy rejection has no visible placement geometry: ${JSON.stringify(decoyGhost)}.`,
  );
  await clickCell(page, uplinkPoints, DECOY);
  await page.waitForTimeout(160);
  const afterDecoy = await readGameState(page);
  const rejectionToasts = await readToasts(page);
  const rejectionCopy = rejectionToasts
    .map((toast) => `${toast.title} ${toast.text}`)
    .join(" ")
    .toLowerCase();
  assert(afterDecoy.decoy === null, "False rear lane accepted a belt.");
  assert(
    afterDecoy.entityCount === beforeDecoy.entityCount,
    `Rejected decoy changed entity count ${beforeDecoy.entityCount} -> ${afterDecoy.entityCount}.`,
  );
  assert(
    afterDecoy.alloy === beforeDecoy.alloy,
    `Rejected decoy spent alloy ${beforeDecoy.alloy} -> ${afterDecoy.alloy}.`,
  );
  assert(rejectionToasts.length > 0, "Rejected decoy produced no visible toast.");
  assert(
    rejectionCopy.includes("placement rejected")
      && rejectionCopy.includes("cyan")
      && rejectionCopy.includes("dock")
      && rejectionCopy.includes("auto-align"),
    `Decoy rejection is not actionable: ${JSON.stringify(rejectionToasts)}.`,
  );
  report.artifacts.push(await capture(page, "hover.png"));

  await waitForNoToasts(page, 5_000);
  const canvas = page.locator("#world");
  await canvas.focus();
  await page.keyboard.press("r");
  await moveToCell(page, uplinkPoints, { x: 20, z: 12 });
  const wrongDirectionGhost = await inspectGhost(page);
  assertGhost(wrongDirectionGhost, {
    kind: "belt",
    x: 20,
    z: 12,
    direction: DIRECTION.South,
    valid: true,
  });

  await moveToCell(page, uplinkPoints, DOCK);
  const autoAlignedGhost = await inspectGhost(page);
  assertGhost(autoAlignedGhost, {
    kind: "belt",
    x: DOCK.x,
    z: DOCK.z,
    direction: DIRECTION.East,
    valid: true,
  });

  await clickCell(page, uplinkPoints, DOCK);
  await page.waitForTimeout(180);
  const afterDockPlacement = await readGameState(page);
  assert(afterDockPlacement.dock?.kind === "belt", "Canonical dock belt was not placed.");
  assert(
    afterDockPlacement.dock.direction === DIRECTION.East,
    `Canonical belt direction is ${afterDockPlacement.dock.direction}, expected East.`,
  );
  assert(
    afterDockPlacement.alloy === afterDecoy.alloy - 2,
    `Canonical belt spent ${afterDecoy.alloy - afterDockPlacement.alloy} alloy.`,
  );
  const connectedToasts = await readToasts(page);
  const connectedCopy = connectedToasts
    .map((toast) => `${toast.title} ${toast.text}`)
    .join(" ")
    .toLowerCase();
  assert(
    connectedCopy.includes("uplink dock connected")
      && connectedCopy.includes("auto-aligned")
      && connectedCopy.includes("cyan cargo bridge"),
    `Auto-aligned placement lacks confirmation: ${JSON.stringify(connectedToasts)}.`,
  );

  await beltCard.click();
  assert(
    (await beltCard.getAttribute("aria-pressed")) === "false",
    "One native belt-card click did not cancel the armed tool.",
  );
  await page.touchscreen.tap(
    cellPoint(uplinkPoints, DOCK).clientX,
    cellPoint(uplinkPoints, DOCK).clientY,
  );
  await page.waitForFunction(
    () => document.querySelector("[data-ref='inspector']")?.classList.contains("is-open"),
    null,
    { timeout: 3_000 },
  );
  const touchSelection = await readInspector(page);
  assert(
    touchSelection.name.toLowerCase() === "transport belt",
    `Native dock tap selected ${touchSelection.name || "nothing"}, not Transport Belt.`,
  );
  assert(
    !touchSelection.name.toLowerCase().includes("uplink"),
    `Native dock tap was stolen by the Uplink: ${JSON.stringify(touchSelection)}.`,
  );
  await page.locator("[data-action='close-inspector']").click();
  await page.waitForFunction(
    () => !document.querySelector("[data-ref='inspector']")?.classList.contains("is-open"),
  );

  const routePoints = await focusAndLocateCells(page, 18, 8.7, [
    { x: 14, z: 5 },
    { x: 15, z: 5 },
    { x: 15, z: 11 },
    { x: 15, z: 12 },
    { x: 20, z: 12 },
  ]);
  const outputInserter = await placeThroughHud(
    page,
    routePoints,
    "inserter",
    { x: 14, z: 5 },
  );
  assert(
    outputInserter.direction === DIRECTION.East,
    `Output inserter direction is ${outputInserter.direction}, expected East.`,
  );

  await beltCard.click();
  assert(
    (await beltCard.getAttribute("aria-pressed")) === "true",
    "Belt card did not replace the inserter tool.",
  );
  await canvas.focus();
  await page.keyboard.press("r");
  await moveToCell(page, routePoints, { x: 15, z: 5 });
  const verticalStartGhost = await inspectGhost(page);
  assert(
    verticalStartGhost.state?.direction === DIRECTION.South,
    `Vertical drag started in direction ${verticalStartGhost.state?.direction}.`,
  );
  const verticalDrag = await dragCells(
    page,
    routePoints,
    { x: 15, z: 5 },
    { x: 15, z: 11 },
  );
  const verticalBelts = await readCells(
    page,
    range(5, 11).map((z) => ({ x: 15, z })),
  );
  assertBeltLine(verticalBelts, DIRECTION.South, "vertical drag");
  assert(
    (await beltCard.getAttribute("aria-pressed")) === "true",
    "Belt tool disarmed after the vertical drag.",
  );

  await canvas.focus();
  for (let index = 0; index < 3; index += 1) await page.keyboard.press("r");
  await moveToCell(page, routePoints, { x: 15, z: 12 });
  const horizontalStartGhost = await inspectGhost(page);
  assert(
    horizontalStartGhost.state?.direction === DIRECTION.East,
    `Horizontal drag started in direction ${horizontalStartGhost.state?.direction}.`,
  );
  const horizontalDrag = await dragCells(
    page,
    routePoints,
    { x: 15, z: 12 },
    { x: 20, z: 12 },
  );
  const horizontalBelts = await readCells(
    page,
    range(15, 20).map((x) => ({ x, z: 12 })),
  );
  assertBeltLine(horizontalBelts, DIRECTION.East, "horizontal drag");
  assert(
    (await beltCard.getAttribute("aria-pressed")) === "true",
    "Belt tool disarmed after the horizontal drag.",
  );

  const constructed = await readGameState(page);
  assert(constructed.entityCount === 26, `Constructed route has ${constructed.entityCount} entities.`);
  assert(constructed.alloy === 204, `Constructed route left ${constructed.alloy} alloy.`);
  assert(constructed.manifest.length === 0, "Cargo arrived before delivery proof began.");
  await beltCard.click();
  assert(
    (await beltCard.getAttribute("aria-pressed")) === "false",
    "Belt tool did not cancel after route construction.",
  );

  await page.evaluate(() => window.__CINDERLINE__?.renderer.focus(18.8, 9.2));
  await page.waitForTimeout(180);
  const rendererDock = await readRendererDock(page);
  assert(
    rendererDock.dockBeltIds.length === 1
      && rendererDock.dockBeltIds[0] === afterDockPlacement.dock.id,
    `Renderer dock classification is not canonical: ${JSON.stringify(rendererDock)}.`,
  );
  assert(
    rendererDock.approachBeltIds.includes(afterDockPlacement.dock.id),
    `Renderer approach omits dock belt ${afterDockPlacement.dock.id}.`,
  );
  report.artifacts.push(await capture(page, "connected.png"));

  const acceleration = [];
  let delivery = await readDelivery(page);
  for (let batch = 0; batch < 240 && (delivery.inventory.ironPlate ?? 0) < 1; batch += 1) {
    const tickWindow = await page.evaluate((ticks) => {
      const game = window.__CINDERLINE__;
      if (!game) throw new Error("Uplink QA bridge disappeared during acceleration.");
      const before = game.stats().tick;
      game.simulation.step(ticks);
      return { before, after: game.stats().tick };
    }, 30);
    assert(
      tickWindow.after - tickWindow.before === 30,
      `simulation.step advanced ${tickWindow.after - tickWindow.before} ticks.`,
    );
    await page.waitForTimeout(34);
    delivery = await readDelivery(page);
    if (batch % 10 === 0 || (delivery.inventory.ironPlate ?? 0) > 0) {
      acceleration.push({ batch, ...tickWindow, delivery });
    }
  }
  assert(
    (delivery.inventory.ironPlate ?? 0) >= 1,
    `Canonical cargo never reached the Uplink: ${JSON.stringify(delivery)}.`,
  );
  assert(
    (delivery.produced.ironPlate ?? 0) >= 1,
    `No iron plate was physically produced: ${JSON.stringify(delivery.produced)}.`,
  );

  const deliveryPoints = await focusAndLocateCells(page, 20.2, 9.5, [
    { x: 22, z: 11 },
  ]);
  await clickCell(page, deliveryPoints, { x: 22, z: 11 });
  await page.waitForFunction(
    () => document.querySelector("[data-ref='inspector']")?.classList.contains("is-open"),
    null,
    { timeout: 3_000 },
  );
  const deliveryInspector = await readInspector(page);
  const mission = await readMission(page);
  assert(
    deliveryInspector.name.toLowerCase() === "commission uplink",
    `Delivery inspection selected ${deliveryInspector.name}.`,
  );
  assert(
    deliveryInspector.status.toLowerCase().includes("cargo dock linked"),
    `Uplink inspector does not report a linked dock: ${JSON.stringify(deliveryInspector)}.`,
  );
  assert(
    mission.objectives.some(
      (objective) => objective.toLowerCase().includes("iron plate")
        && /[1-9]\d*\/24/.test(objective),
    ),
    `Mission HUD does not expose delivered iron: ${JSON.stringify(mission)}.`,
  );
  report.artifacts.push(await capture(page, "delivery.png"));

  await page.waitForTimeout(120);
  assertDiagnosticsClean(diagnostics);
  report.proof = {
    initial,
    decoy: {
      cell: DECOY,
      input: "Native belt-card click, canvas hover, and primary click",
      ghost: decoyGhost,
      before: summarizeState(beforeDecoy),
      after: summarizeState(afterDecoy),
      rejectionToasts,
    },
    canonical: {
      cell: DOCK,
      wrongDirectionControl: wrongDirectionGhost,
      autoAlignedGhost,
      placed: afterDockPlacement.dock,
      connectedToasts,
      rendererDock,
    },
    touchSelection: {
      input: "Native touchscreen tap at the canonical occupied ground cell",
      ...touchSelection,
    },
    route: {
      outputInserter,
      verticalDrag,
      verticalBelts,
      horizontalDrag,
      horizontalBelts,
      after: summarizeState(constructed),
    },
    delivery: {
      acceleration,
      final: delivery,
      inspector: deliveryInspector,
      mission,
    },
  };
  report.status = "passed";
} catch (error) {
  failure = error;
  report.status = "failed";
  report.failure = {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
  try {
    report.artifacts.push(await capture(page, "failure.png"));
  } catch (screenshotError) {
    report.failure.screenshotError = screenshotError instanceof Error
      ? screenshotError.message
      : String(screenshotError);
  }
} finally {
  await context.close();
  await browser.close();
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

if (failure) throw failure;
process.stdout.write(
  `Uplink playability QA passed. Report: ${REPORT_PATH}\n`,
);

function observePage(targetPage) {
  const result = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    requestFailures: [],
    httpFailures: [],
  };
  targetPage.on("console", (message) => {
    if (message.type() === "error") result.consoleErrors.push(message.text());
    if (message.type() === "warning") result.consoleWarnings.push(message.text());
  });
  targetPage.on("pageerror", (error) => result.pageErrors.push(error.message));
  targetPage.on("requestfailed", (request) => {
    result.requestFailures.push({
      method: request.method(),
      url: request.url(),
      error: request.failure()?.errorText ?? "unknown",
    });
  });
  targetPage.on("response", (response) => {
    if (response.status() < 400) return;
    result.httpFailures.push({
      status: response.status(),
      url: response.url(),
    });
  });
  return result;
}

function assertDiagnosticsClean(value) {
  assert(
    value.consoleErrors.length === 0,
    `Console errors: ${JSON.stringify(value.consoleErrors)}.`,
  );
  assert(
    value.pageErrors.length === 0,
    `Page errors: ${JSON.stringify(value.pageErrors)}.`,
  );
  assert(
    value.requestFailures.length === 0,
    `Request failures: ${JSON.stringify(value.requestFailures)}.`,
  );
  assert(
    value.httpFailures.length === 0,
    `HTTP failures: ${JSON.stringify(value.httpFailures)}.`,
  );
}

async function waitForNoToasts(targetPage, timeout) {
  await targetPage.waitForFunction(
    () => document.querySelectorAll("[data-toast-id]").length === 0,
    null,
    { timeout },
  );
}

async function capture(targetPage, filename) {
  const path = resolve(OUTPUT_DIRECTORY, filename);
  await targetPage.screenshot({ path, type: "png" });
  const metadata = await stat(path);
  return {
    filename,
    path,
    bytes: metadata.size,
    viewport: VIEWPORT,
  };
}

async function focusAndLocateCells(targetPage, focusX, focusZ, cells) {
  await targetPage.evaluate(({ x, z }) => {
    window.__CINDERLINE__?.renderer.focus(x, z);
  }, { x: focusX, z: focusZ });
  await targetPage.waitForTimeout(160);
  const points = await targetPage.evaluate((targets) => {
    const game = window.__CINDERLINE__;
    const canvas = document.querySelector("#world");
    const bounds = canvas?.getBoundingClientRect();
    if (!game || !bounds) return [];
    const samples = targets.map(() => ({ x: 0, y: 0, count: 0 }));
    for (
      let clientY = Math.max(2, Math.ceil(bounds.top));
      clientY < Math.min(innerHeight - 2, Math.floor(bounds.bottom));
      clientY += 3
    ) {
      for (
        let clientX = Math.max(2, Math.ceil(bounds.left));
        clientX < Math.min(innerWidth - 2, Math.floor(bounds.right));
        clientX += 3
      ) {
        if (document.elementFromPoint(clientX, clientY)?.id !== "world") continue;
        const cell = game.renderer.screenToGrid(clientX, clientY);
        if (!cell) continue;
        for (let index = 0; index < targets.length; index += 1) {
          const target = targets[index];
          if (cell.x !== target.x || cell.z !== target.z) continue;
          samples[index].x += clientX;
          samples[index].y += clientY;
          samples[index].count += 1;
        }
      }
    }
    return samples.map((sample, index) => sample.count === 0
      ? null
      : {
          cell: { ...targets[index] },
          clientX: Math.round(sample.x / sample.count),
          clientY: Math.round(sample.y / sample.count),
          samples: sample.count,
        });
  }, cells);
  assert(
    points.length === cells.length && points.every(Boolean),
    `Could not expose cells after focus ${focusX},${focusZ}: ${JSON.stringify({ cells, points })}.`,
  );
  return points;
}

function cellPoint(points, cell) {
  const point = points.find(
    (candidate) => candidate.cell.x === cell.x && candidate.cell.z === cell.z,
  );
  assert(point, `No screen point for X${cell.x} Z${cell.z}.`);
  return point;
}

async function moveToCell(targetPage, points, cell) {
  const point = cellPoint(points, cell);
  await targetPage.mouse.move(point.clientX, point.clientY);
  await targetPage.waitForTimeout(120);
}

async function clickCell(targetPage, points, cell) {
  const point = cellPoint(points, cell);
  await targetPage.mouse.click(point.clientX, point.clientY);
}

async function dragCells(targetPage, points, from, to) {
  const start = cellPoint(points, from);
  const end = cellPoint(points, to);
  const before = await targetPage.evaluate(() => ({
    entityCount: window.__CINDERLINE__?.stats().entityCount,
    alloy: window.__CINDERLINE__?.alloy,
    cardArmed: document.querySelector("[data-build='belt']")?.getAttribute("aria-pressed"),
  }));
  await targetPage.mouse.move(start.clientX, start.clientY);
  await targetPage.mouse.down();
  await targetPage.waitForTimeout(50);
  const afterPointerDown = await targetPage.evaluate(() => ({
    entityCount: window.__CINDERLINE__?.stats().entityCount,
    alloy: window.__CINDERLINE__?.alloy,
    cardArmed: document.querySelector("[data-build='belt']")?.getAttribute("aria-pressed"),
  }));
  await targetPage.mouse.move(end.clientX, end.clientY, { steps: 48 });
  await targetPage.waitForTimeout(80);
  await targetPage.mouse.up();
  await targetPage.waitForTimeout(120);
  const after = await targetPage.evaluate(() => ({
    entityCount: window.__CINDERLINE__?.stats().entityCount,
    alloy: window.__CINDERLINE__?.alloy,
    cardArmed: document.querySelector("[data-build='belt']")?.getAttribute("aria-pressed"),
  }));
  return { from, to, start, end, before, afterPointerDown, after };
}

async function placeThroughHud(targetPage, points, kind, cell) {
  const card = targetPage.locator(`[data-build='${kind}']`);
  if ((await card.getAttribute("aria-pressed")) !== "true") await card.click();
  assert(
    (await card.getAttribute("aria-pressed")) === "true",
    `${kind} card did not arm.`,
  );
  const before = await targetPage.evaluate(() => ({
    entityCount: window.__CINDERLINE__?.stats().entityCount,
    alloy: window.__CINDERLINE__?.alloy,
  }));
  await clickCell(targetPage, points, cell);
  await targetPage.waitForTimeout(140);
  const after = await targetPage.evaluate(({ x, z }) => {
    const game = window.__CINDERLINE__;
    const entity = game?.simulation.getEntityAt(x, z);
    return {
      entity: entity ? JSON.parse(JSON.stringify(entity)) : null,
      entityCount: game?.stats().entityCount,
      alloy: game?.alloy,
    };
  }, cell);
  assert(after.entity?.kind === kind, `${kind} was not placed at ${JSON.stringify(cell)}.`);
  assert(
    after.entityCount === before.entityCount + 1,
    `${kind} placement changed entity count ${before.entityCount} -> ${after.entityCount}.`,
  );
  return after.entity;
}

async function inspectGhost(targetPage) {
  return targetPage.evaluate(() => {
    const renderer = window.__CINDERLINE__?.renderer;
    if (!renderer) return null;
    const state = renderer.ghostState;
    const visual = renderer.ghostVisual;
    let visibleMeshes = 0;
    let vertices = 0;
    visual?.traverse((object) => {
      if (!object.isMesh || object.visible === false) return;
      visibleMeshes += 1;
      vertices += object.geometry?.attributes?.position?.count ?? 0;
    });
    const material = visual?.userData.ghostMaterial;
    return {
      state: state ? {
        kind: state.kind,
        x: state.x,
        z: state.z,
        direction: state.direction,
        valid: state.valid,
        reason: state.reason ?? null,
      } : null,
      rootVisible: renderer.ghostRoot?.visible === true,
      visibleMeshes,
      vertices,
      materialColor: material?.color?.getHexString?.() ?? null,
      materialOpacity: material?.opacity ?? null,
    };
  });
}

function assertGhost(ghost, expected) {
  assert(ghost?.rootVisible, `Placement ghost root is hidden: ${JSON.stringify(ghost)}.`);
  for (const [key, value] of Object.entries(expected)) {
    assert(
      ghost.state?.[key] === value,
      `Placement ghost ${key} is ${ghost.state?.[key]}, expected ${value}: ${JSON.stringify(ghost)}.`,
    );
  }
}

async function readGameState(targetPage) {
  return targetPage.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game) throw new Error("Uplink QA bridge is unavailable.");
    const clone = (value) => value === undefined
      ? null
      : JSON.parse(JSON.stringify(value));
    return {
      entityCount: game.stats().entityCount,
      alloy: game.alloy,
      tick: game.stats().tick,
      uplinkEntityId: game.uplinkEntityId,
      manifest: clone(game.uplinkInventory.entries),
      reservation: clone(game.uplinkSiteClearance()),
      decoy: clone(game.simulation.getEntityAt(21, 11)),
      dock: clone(game.simulation.getEntityAt(21, 12)),
    };
  });
}

function summarizeState(state) {
  return {
    entityCount: state.entityCount,
    alloy: state.alloy,
    tick: state.tick,
    manifest: state.manifest,
    decoy: state.decoy,
    dock: state.dock,
  };
}

async function readCells(targetPage, cells) {
  return targetPage.evaluate((targets) => {
    const simulation = window.__CINDERLINE__?.simulation;
    return targets.map((cell) => {
      const entity = simulation?.getEntityAt(cell.x, cell.z);
      return {
        ...cell,
        entity: entity ? {
          id: entity.id,
          kind: entity.kind,
          direction: entity.direction,
        } : null,
      };
    });
  }, cells);
}

function assertBeltLine(cells, direction, label) {
  for (const cell of cells) {
    assert(
      cell.entity?.kind === "belt" && cell.entity.direction === direction,
      `${label} failed at X${cell.x} Z${cell.z}: ${JSON.stringify(cell.entity)}.`,
    );
  }
  const ids = cells.map((cell) => cell.entity.id);
  assert(new Set(ids).size === cells.length, `${label} reused a belt entity.`);
}

async function readRendererDock(targetPage) {
  return targetPage.evaluate(() => {
    const renderer = window.__CINDERLINE__?.renderer;
    return {
      dockBeltIds: [...(renderer?.infrastructureRoot?.userData.uplinkDockBeltIds ?? [])],
      approachBeltIds: [...(renderer?.infrastructureRoot?.userData.uplinkApproachBeltIds ?? [])],
      sites: JSON.parse(JSON.stringify(
        renderer?.infrastructureRoot?.userData.uplinkDockSites ?? [],
      )),
    };
  });
}

async function readDelivery(targetPage) {
  return targetPage.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game) throw new Error("Uplink QA bridge is unavailable.");
    const inventory = Object.fromEntries(
      game.uplinkInventory.entries.map((entry) => [entry.item, entry.count]),
    );
    const dock = game.simulation.getEntityAt(21, 12);
    const smelter = game.simulation.getEntityAt(12, 4);
    const inserter = game.simulation.getEntityAt(14, 5);
    const summarize = (entity) => entity ? {
      id: entity.id,
      kind: entity.kind,
      status: entity.status,
      direction: entity.direction,
      beltItems: entity.beltItems?.map((item) => ({
        item: item.item,
        lane: item.lane,
        progress: item.progress,
      })) ?? [],
      inventory: { ...entity.inventory },
      input: { ...entity.input },
      output: { ...entity.output },
      heldItem: entity.heldItem ?? null,
    } : null;
    return {
      tick: game.stats().tick,
      inventory,
      produced: { ...game.stats().produced },
      dock: summarize(dock),
      smelter: summarize(smelter),
      outputInserter: summarize(inserter),
    };
  });
}

async function readToasts(targetPage) {
  return targetPage.evaluate(() => [
    ...document.querySelectorAll("[data-toast-id]:not(.is-leaving)"),
  ].map((element) => ({
    id: element.getAttribute("data-toast-id"),
    title: element.querySelector("b")?.textContent?.trim() ?? "",
    text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
    role: element.getAttribute("role"),
    error: element.classList.contains("is-error"),
  })));
}

async function readInspector(targetPage) {
  return targetPage.evaluate(() => ({
    open: document.querySelector("[data-ref='inspector']")?.classList.contains("is-open") ?? false,
    type: document.querySelector("[data-ref='inspector-type']")?.textContent?.trim() ?? "",
    name: document.querySelector("[data-ref='inspector-name']")?.textContent?.trim() ?? "",
    status: document.querySelector("[data-ref='inspector-status']")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
  }));
}

async function readMission(targetPage) {
  return targetPage.evaluate(() => ({
    title: document.querySelector("[data-ref='mission-title']")?.textContent?.trim() ?? "",
    copy: document.querySelector("[data-ref='mission-copy']")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    objectives: [...document.querySelectorAll("[data-objective-id]")]
      .map((element) => element.textContent?.replace(/\s+/g, " ").trim() ?? ""),
  }));
}

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
