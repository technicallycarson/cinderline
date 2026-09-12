import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL =
  process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY =
  process.env.CINDERLINE_ADVANCED_CONSTRUCTION_OUTPUT ??
  ".qa/advanced-construction/pass1-work/formative-02";

const ADVANCED = [
  {
    kind: "fluidSource",
    category: "fluids",
    shortcut: "Shift+Digit1",
    cost: 32,
  },
  {
    kind: "fluidPump",
    category: "fluids",
    shortcut: "Shift+Digit2",
    cost: 14,
  },
  {
    kind: "fluidPipe",
    category: "fluids",
    shortcut: "Shift+Digit3",
    cost: 3,
  },
  {
    kind: "fluidTank",
    category: "fluids",
    shortcut: "Shift+Digit4",
    cost: 36,
  },
  {
    kind: "fluidProcessor",
    category: "fluids",
    shortcut: "Shift+Digit5",
    cost: 64,
  },
  {
    kind: "constantCombinator",
    category: "signals",
    shortcut: "Shift+Digit6",
    cost: 10,
  },
  {
    kind: "arithmeticCombinator",
    category: "signals",
    shortcut: "Shift+Digit7",
    cost: 16,
  },
  {
    kind: "deciderCombinator",
    category: "signals",
    shortcut: "Shift+Digit8",
    cost: 18,
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function inspectorTypeLabel(kind) {
  return kind
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toUpperCase();
}

function captureErrors(page, label) {
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(`${label} pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`${label} console: ${message.text()}`);
    }
  });
  return errors;
}

async function waitForGame(page) {
  await page.waitForFunction(
    () =>
      document.querySelector("#boot")?.classList.contains("is-done") &&
      Boolean(window.__CINDERLINE__?.renderer),
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(1_050);
  await page.evaluate(() => window.__CINDERLINE__?.dismissToasts());
}

async function verifyAdvancedHotkeys(page) {
  const proof = [];
  for (const definition of ADVANCED) {
    await page.keyboard.press(definition.shortcut);
    const card = page.locator(`[data-build="${definition.kind}"]`);
    await card.waitFor({ state: "visible", timeout: 3_000 });
    assert(
      (await card.getAttribute("aria-pressed")) === "true",
      `${definition.shortcut} did not select ${definition.kind}.`,
    );
    const selectedTab = page.locator(
      `[data-build-category-select="${definition.category}"]`,
    );
    assert(
      (await selectedTab.getAttribute("aria-selected")) === "true",
      `${definition.shortcut} did not reveal ${definition.category}.`,
    );
    proof.push({
      kind: definition.kind,
      shortcut: definition.shortcut,
      category: definition.category,
    });
    await page.keyboard.press("Escape");
  }
  return proof;
}

async function findPlaceableScreenPoint(page, kind) {
  const result = await page.evaluate((requestedKind) => {
    const game = window.__CINDERLINE__;
    const canvas = document.querySelector("#world");
    if (!game || !(canvas instanceof HTMLCanvasElement)) return null;
    const bounds = canvas.getBoundingClientRect();
    const options =
      requestedKind === "fluidSource"
        ? { fluidId: "crudeOil" }
        : requestedKind === "fluidProcessor"
          ? { fluidRecipeId: "refineCrude" }
          : {};
    const minimumX =
      bounds.width <= 700 ? Math.max(270, bounds.width * 0.45) : 340;
    const minimumY = bounds.height <= 820 ? 260 : 240;
    const maximumX = bounds.width - (bounds.width <= 700 ? 38 : 100);
    const maximumY = bounds.height - 165;
    const visited = new Set();
    for (let y = minimumY; y <= maximumY; y += 6) {
      for (let x = minimumX; x <= maximumX; x += 6) {
        const cell = game.renderer.screenToGrid(
          bounds.left + x,
          bounds.top + y,
        );
        if (!cell) continue;
        const key = `${cell.x},${cell.z}`;
        if (visited.has(key)) continue;
        visited.add(key);
        const placement = game.simulation.canPlace(
          requestedKind,
          cell.x,
          cell.z,
          1,
          options,
        );
        if (placement.ok) {
          return {
            clientX: bounds.left + x,
            clientY: bounds.top + y,
            cell,
          };
        }
      }
    }
    return null;
  }, kind);
  assert(result, `No visible placeable cell was found for ${kind}.`);
  return result;
}

async function inspectGhost(page, expectedKind) {
  return page.evaluate((kind) => {
    const renderer = window.__CINDERLINE__?.renderer;
    if (!renderer) return null;
    const state = renderer.ghostState;
    const visual = renderer.ghostVisual;
    let visibleMeshes = 0;
    let vertices = 0;
    const meshNames = [];
    visual?.traverse((object) => {
      if (!object.isMesh || object.visible === false) return;
      visibleMeshes += 1;
      vertices += object.geometry?.attributes?.position?.count ?? 0;
      if (object.name) meshNames.push(object.name);
    });
    return {
      expectedKind: kind,
      state: state
        ? {
            kind: state.kind,
            x: state.x,
            z: state.z,
            direction: state.direction,
            valid: state.valid,
          }
        : null,
      rootVisible: renderer.ghostRoot?.visible === true,
      visibleMeshes,
      vertices,
      meshNames,
    };
  }, expectedKind);
}

async function placeAllAdvanced(page, label) {
  const placed = [];
  for (const definition of ADVANCED) {
    await page
      .locator(
        `[data-build-category-select="${definition.category}"]`,
      )
      .click();
    const card = page.locator(`[data-build="${definition.kind}"]`);
    await card.waitFor({ state: "visible", timeout: 3_000 });
    const cardProof = await card.evaluate((element) => ({
      hidden: element.hidden,
      ariaDisabled: element.getAttribute("aria-disabled"),
      cost: element.querySelector(".build-cost")?.textContent?.trim(),
      status: element.querySelector(".build-state")?.textContent?.trim(),
      title: element.getAttribute("title"),
    }));
    assert(!cardProof.hidden, `${definition.kind} card stayed hidden.`);
    assert(
      cardProof.ariaDisabled === "false",
      `${definition.kind} card was unavailable in showcase.`,
    );
    assert(
      cardProof.cost?.includes(String(definition.cost)),
      `${definition.kind} did not show cost ${definition.cost}.`,
    );
    assert(
      cardProof.status === "Ready" &&
        cardProof.title?.includes(`${definition.cost} alloy`) &&
        cardProof.title?.includes("Ready"),
      `${definition.kind} card did not expose a truthful status/tooltip.`,
    );

    const point = await findPlaceableScreenPoint(page, definition.kind);
    const before = await page.evaluate((kind) => {
      const game = window.__CINDERLINE__;
      return {
        alloy: game?.alloy ?? -1,
        ids:
          game?.simulation.getEntities(kind).map((entity) => entity.id) ??
          [],
        circuitDevices:
          game?.simulation.circuitSnapshot().devices.length ?? -1,
      };
    }, definition.kind);
    await card.click();
    assert(
      (await card.getAttribute("aria-pressed")) === "true",
      `${definition.kind} card click did not select its build tool.`,
    );
    await page.mouse.move(point.clientX, point.clientY);
    await page.waitForTimeout(90);
    const ghost = await inspectGhost(page, definition.kind);
    assert(
      ghost?.rootVisible &&
        ghost.state?.kind === definition.kind &&
        ghost.state.valid &&
        ghost.visibleMeshes > 0 &&
        ghost.vertices > 0,
      `${definition.kind} placement ghost was empty or invalid: ${JSON.stringify(ghost)}`,
    );

    await page.mouse.click(point.clientX, point.clientY);
    await page.waitForFunction(
      ({ kind, count }) =>
        (window.__CINDERLINE__?.simulation.getEntities(kind).length ?? 0) >
        count,
      { kind: definition.kind, count: before.ids.length },
      { timeout: 5_000 },
    );
    const after = await page.evaluate(
      ({ kind, previousIds }) => {
        const game = window.__CINDERLINE__;
        if (!game) return null;
        const entity = game.simulation
          .getEntities(kind)
          .find((candidate) => !previousIds.includes(candidate.id));
        if (!entity) return null;
        const ledger = game
          .constructionLedger()
          .find((entry) => entry.entityId === entity.id);
        return {
          alloy: game.alloy,
          entity: {
            id: entity.id,
            kind: entity.kind,
            x: entity.x,
            y: entity.y,
            direction: entity.direction,
            fluidState: entity.fluidState,
          },
          provenance: ledger?.provenance ?? null,
          circuitDevices:
            game.simulation.circuitSnapshot().devices.length,
        };
      },
      { kind: definition.kind, previousIds: before.ids },
    );
    assert(after, `${definition.kind} did not produce a new entity.`);
    assert(
      after.alloy === before.alloy - definition.cost,
      `${definition.kind} alloy delta was ${before.alloy - after.alloy}, expected ${definition.cost}.`,
    );
    assert(
      after.provenance?.source === "paid" &&
        after.provenance.buildKind === definition.kind &&
        after.provenance.paidCost === definition.cost,
      `${definition.kind} paid provenance was not recorded.`,
    );
    const expectedInspectorType =
      `${inspectorTypeLabel(definition.kind)} // UNIT ${String(after.entity.id).padStart(3, "0")}`;
    await page.waitForFunction(
      (expected) =>
        document
          .querySelector("[data-ref='inspector-type']")
          ?.textContent?.trim() === expected,
      expectedInspectorType,
      { timeout: 3_000 },
    );
    const inspectorType = await page
      .locator("[data-ref='inspector-type']")
      .innerText();
    assert(
      inspectorType.trim() === expectedInspectorType,
      `${definition.kind} inspector type was not humanized: ${inspectorType}`,
    );
    if (definition.kind === "fluidSource") {
      assert(
        after.entity.fluidState?.sourceFluidId === "crudeOil",
        "Player fluid source did not use crudeOil.",
      );
    }
    if (definition.kind === "fluidProcessor") {
      assert(
        after.entity.fluidState?.recipeId === "refineCrude",
        "Player fluid processor did not use refineCrude.",
      );
    }
    if (definition.category === "signals") {
      assert(
        after.circuitDevices === before.circuitDevices + 1,
        `${definition.kind} did not join the circuit network.`,
      );
    }
    placed.push({
      label,
      ...definition,
      point,
      card: cardProof,
      ghost,
      entity: after.entity,
      provenance: after.provenance,
      inspectorType: inspectorType.trim(),
      alloyBefore: before.alloy,
      alloyAfter: after.alloy,
    });
  }
  return placed;
}

async function verifyUndoRedoRefund(page, placed) {
  const target = placed.at(-1);
  assert(target, "No advanced placement was available for history proof.");
  const entityId = target.entity.id;
  const cost = target.cost;
  const baseline = await page.evaluate(() => ({
    alloy: window.__CINDERLINE__?.alloy ?? -1,
    ledger: window.__CINDERLINE__?.constructionLedger().length ?? -1,
  }));

  await page.keyboard.press("Control+KeyZ");
  await page.waitForFunction(
    (id) => !window.__CINDERLINE__?.simulation.getEntity(id),
    entityId,
  );
  const undone = await page.evaluate((id) => ({
    alloy: window.__CINDERLINE__?.alloy ?? -1,
    provenance:
      window.__CINDERLINE__
        ?.constructionLedger()
        .some((entry) => entry.entityId === id) ?? true,
  }), entityId);
  assert(
    undone.alloy === baseline.alloy + cost && !undone.provenance,
    "Placement undo did not restore alloy/entity provenance atomically.",
  );

  await page.keyboard.press("Control+Shift+KeyZ");
  await page.waitForFunction(
    (id) => Boolean(window.__CINDERLINE__?.simulation.getEntity(id)),
    entityId,
  );
  const redone = await page.evaluate((id) => ({
    alloy: window.__CINDERLINE__?.alloy ?? -1,
    provenance:
      window.__CINDERLINE__
        ?.constructionLedger()
        .some((entry) => entry.entityId === id) ?? false,
  }), entityId);
  assert(
    redone.alloy === baseline.alloy && redone.provenance,
    "Placement redo did not restore the paid entity atomically.",
  );

  await page.keyboard.down("Shift");
  await page.mouse.click(
    target.point.clientX,
    target.point.clientY,
    { button: "right" },
  );
  await page.keyboard.up("Shift");
  await page.waitForFunction(
    (id) => !window.__CINDERLINE__?.simulation.getEntity(id),
    entityId,
  );
  const dismantled = await page.evaluate((id) => ({
    alloy: window.__CINDERLINE__?.alloy ?? -1,
    provenance:
      window.__CINDERLINE__
        ?.constructionLedger()
        .some((entry) => entry.entityId === id) ?? true,
  }), entityId);
  assert(
    dismantled.alloy === baseline.alloy + cost &&
      !dismantled.provenance,
    "Shift+RMB did not provide the full paid refund.",
  );

  await page.keyboard.press("Control+KeyZ");
  await page.waitForFunction(
    (id) => Boolean(window.__CINDERLINE__?.simulation.getEntity(id)),
    entityId,
  );
  const restored = await page.evaluate((id) => ({
    alloy: window.__CINDERLINE__?.alloy ?? -1,
    provenance:
      window.__CINDERLINE__
        ?.constructionLedger()
        .some((entry) => entry.entityId === id) ?? false,
  }), entityId);
  assert(
    restored.alloy === baseline.alloy && restored.provenance,
    "Undo after dismantle did not restore custody and alloy.",
  );
  return {
    entityId,
    cost,
    baseline,
    undone,
    redone,
    dismantled,
    restored,
  };
}

async function verifySaveReload(page, placed) {
  const expectedIds = placed.map((entry) => entry.entity.id);
  const expectedAlloy = await page.evaluate(
    () => window.__CINDERLINE__?.alloy ?? -1,
  );
  const saved = await page.evaluate(() => {
    window.dispatchEvent(new Event("beforeunload"));
    const raw = localStorage.getItem("cinderline.autosave.v5");
    return raw ? JSON.parse(raw) : null;
  });
  assert(
    saved?.format === "cinderline-session" && saved.version === 5,
    "Actual beforeunload did not write a v5 session.",
  );
  const savedEntities = saved.simulation.entities.filter((entity) =>
    expectedIds.includes(entity.id)
  );
  const savedLedger = saved.construction.filter((entry) =>
    expectedIds.includes(entry.entityId)
  );
  assert(
    savedEntities.length === ADVANCED.length &&
      savedLedger.length === ADVANCED.length &&
      savedLedger.every(
        (entry) =>
          entry.provenance.source === "paid" &&
          entry.provenance.paidCost > 0,
      ),
    "Saved v5 session did not cover all advanced paid entities.",
  );
  assert(
    savedEntities.find((entity) => entity.kind === "fluidSource")
      ?.fluidState?.sourceFluidId === "crudeOil" &&
      savedEntities.find((entity) => entity.kind === "fluidProcessor")
        ?.fluidState?.recipeId === "refineCrude",
    "Saved v5 session lost advanced fluid defaults.",
  );

  await page.goto(
    `${BASE_URL.replace(/\/$/, "")}/?advancedConstructionReload=1`,
    { waitUntil: "networkidle", timeout: 30_000 },
  );
  await waitForGame(page);
  const reloaded = await page.evaluate((ids) => {
    const game = window.__CINDERLINE__;
    if (!game) return null;
    const entities = ids.map((id) => game.simulation.getEntity(id));
    const ledger = game.constructionLedger().filter((entry) =>
      ids.includes(entry.entityId)
    );
    return {
      alloy: game.alloy,
      entities: entities.map((entity) =>
        entity
          ? {
              id: entity.id,
              kind: entity.kind,
              fluidState: entity.fluidState,
            }
          : null
      ),
      ledger,
    };
  }, expectedIds);
  assert(
    reloaded &&
      reloaded.alloy === expectedAlloy &&
      reloaded.entities.every(Boolean) &&
      reloaded.ledger.length === ADVANCED.length,
    "Reloaded v5 session lost advanced entities, alloy, or provenance.",
  );
  assert(
    reloaded.entities.find((entity) => entity?.kind === "fluidSource")
      ?.fluidState?.sourceFluidId === "crudeOil" &&
      reloaded.entities.find(
        (entity) => entity?.kind === "fluidProcessor",
      )?.fluidState?.recipeId === "refineCrude",
    "Reloaded v5 session lost fluid placement defaults.",
  );
  return {
    expectedIds,
    expectedAlloy,
    storedAdvancedEntityCount: savedEntities.length,
    storedPaidLedgerCount: savedLedger.length,
    reloaded,
  };
}

async function paletteGeometry(page) {
  return page.evaluate(() => {
    const palette = document.querySelector(".build-palette");
    const dock = document.querySelector(".build-dock");
    if (!(palette instanceof HTMLElement) || !(dock instanceof HTMLElement)) {
      return null;
    }
    const paletteBox = palette.getBoundingClientRect();
    const visibleCards = [
      ...document.querySelectorAll("[data-build]:not([hidden])"),
    ].map((element) => {
      const box = element.getBoundingClientRect();
      return {
        kind: element.dataset.build,
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        cost: element.querySelector(".build-cost")?.textContent?.trim(),
        status: element.querySelector(".build-state")?.textContent?.trim(),
      };
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      palette: {
        left: paletteBox.left,
        right: paletteBox.right,
        top: paletteBox.top,
        bottom: paletteBox.bottom,
      },
      dock: {
        clientWidth: dock.clientWidth,
        scrollWidth: dock.scrollWidth,
      },
      visibleCards,
    };
  });
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
});

const screenshots = [];
let proof;
try {
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const desktop = await desktopContext.newPage();
  const desktopErrors = captureErrors(desktop, "desktop");
  await desktop.goto(
    `${BASE_URL.replace(/\/$/, "")}/?showcase=advanced-construction-desktop`,
    { waitUntil: "networkidle", timeout: 30_000 },
  );
  await waitForGame(desktop);
  const hotkeys = await verifyAdvancedHotkeys(desktop);
  const desktopPlaced = await placeAllAdvanced(desktop, "desktop");
  const history = await verifyUndoRedoRefund(desktop, desktopPlaced);
  await desktop.evaluate(async () => {
    const game = window.__CINDERLINE__;
    game?.refreshHUD();
    const { toHUDMapEntities } = await import("/src/game/adapters.ts");
    window.__advancedConstructionMapKinds = game
      ? toHUDMapEntities(game.snapshot(), null)
          .map((entity) => entity.kind)
          .filter(
            (kind) =>
              kind.startsWith("fluid") ||
              kind.endsWith("Combinator"),
          )
      : [];
    game?.dismissToasts();
  });
  await desktop
    .locator('[data-build-category-select="fluids"]')
    .click();
  await desktop.waitForTimeout(180);
  const desktopScreenshot =
    `${OUTPUT_DIRECTORY}/desktop-all-advanced.png`;
  await desktop.screenshot({
    path: desktopScreenshot,
    animations: "disabled",
  });
  screenshots.push(desktopScreenshot);
  const desktopPalette = await paletteGeometry(desktop);
  const minimapKinds = await desktop.evaluate(
    () => window.__advancedConstructionMapKinds ?? [],
  );
  assert(
    new Set(minimapKinds).size === ADVANCED.length,
    `HUD minimap adapter did not receive all advanced kinds: ${minimapKinds}`,
  );
  const saveReload = await verifySaveReload(desktop, desktopPlaced);
  assert(
    desktopErrors.length === 0,
    `Desktop browser errors: ${desktopErrors.join(" | ")}`,
  );

  const responsiveContext = await browser.newContext({
    viewport: { width: 600, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const responsive = await responsiveContext.newPage();
  const responsiveErrors = captureErrors(responsive, "responsive");
  await responsive.goto(
    `${BASE_URL.replace(/\/$/, "")}/?showcase=advanced-construction-responsive`,
    { waitUntil: "networkidle", timeout: 30_000 },
  );
  await waitForGame(responsive);
  const responsivePlaced = await placeAllAdvanced(
    responsive,
    "responsive",
  );
  await responsive
    .locator('[data-build-category-select="signals"]')
    .click();
  const responsiveInspectorType = (
    await responsive.locator("[data-ref='inspector-type']").innerText()
  ).trim();
  assert(
    responsiveInspectorType.startsWith("DECIDER COMBINATOR // UNIT "),
    `Responsive evidence does not show a corrected advanced type label: ${responsiveInspectorType}`,
  );
  const responsivePalette = await paletteGeometry(responsive);
  assert(responsivePalette, "Responsive palette geometry was unavailable.");
  assert(
    responsivePalette.palette.left >= 0 &&
      responsivePalette.palette.right <=
        responsivePalette.viewport.width &&
      responsivePalette.palette.top >= 0 &&
      responsivePalette.palette.bottom <=
        responsivePalette.viewport.height &&
      responsivePalette.visibleCards.every(
        (card) =>
          card.left >= 0 &&
          card.right <= responsivePalette.viewport.width &&
          card.top >= 0 &&
          card.bottom <= responsivePalette.viewport.height &&
          card.cost?.includes("alloy") &&
          card.status === "Ready",
      ),
    `Responsive palette overflowed or hid cost/status: ${JSON.stringify(responsivePalette)}`,
  );
  const responsiveScreenshot =
    `${OUTPUT_DIRECTORY}/responsive-all-advanced.png`;
  await responsive.screenshot({
    path: responsiveScreenshot,
    animations: "disabled",
  });
  screenshots.push(responsiveScreenshot);
  assert(
    responsiveErrors.length === 0,
    `Responsive browser errors: ${responsiveErrors.join(" | ")}`,
  );

  proof = {
    formative: true,
    baseUrl: BASE_URL,
    advancedKinds: ADVANCED.map(({ kind }) => kind),
    totalCost: ADVANCED.reduce(
      (total, definition) => total + definition.cost,
      0,
    ),
    hotkeys,
    desktop: {
      placements: desktopPlaced,
      history,
      saveReload,
      minimapKinds: [...new Set(minimapKinds)].sort(),
      palette: desktopPalette,
      errors: desktopErrors,
    },
    responsive: {
      placements: responsivePlaced,
      visibleInspectorType: responsiveInspectorType,
      palette: responsivePalette,
      errors: responsiveErrors,
    },
  };

  await responsiveContext.close();
  await desktopContext.close();
} finally {
  await browser.close();
}

assert(proof, "Advanced construction proof was not produced.");
await writeFile(
  `${OUTPUT_DIRECTORY}/browser-proof.json`,
  `${JSON.stringify(proof, null, 2)}\n`,
  "utf8",
);
const screenshotManifest = [];
for (const path of screenshots) {
  const bytes = await readFile(path);
  screenshotManifest.push({
    path,
    bytes: bytes.length,
    sha256: digest(bytes),
  });
}
await writeFile(
  `${OUTPUT_DIRECTORY}/screenshot-manifest.json`,
  `${JSON.stringify(screenshotManifest, null, 2)}\n`,
  "utf8",
);
console.log(
  JSON.stringify(
    {
      outputDirectory: OUTPUT_DIRECTORY,
      advancedKinds: proof.advancedKinds,
      desktopPlacements: proof.desktop.placements.length,
      responsivePlacements: proof.responsive.placements.length,
      storedAdvancedEntities:
        proof.desktop.saveReload.storedAdvancedEntityCount,
      errors: [
        ...proof.desktop.errors,
        ...proof.responsive.errors,
      ],
      screenshots: screenshotManifest,
    },
    null,
    2,
  ),
);
