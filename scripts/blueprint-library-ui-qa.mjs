import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY = ".qa/blueprint-library";

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  colorScheme: "dark",
  deviceScaleFactor: 1,
});
const errors = [];
const warnings = [];

page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
  if (message.type() === "warning") warnings.push(message.text());
});

try {
  await page.goto(`${BASE_URL}/?showcase=1&fresh=blueprint-library-ui`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#boot")?.classList.contains("is-done") &&
      Boolean(window.__CINDERLINE__?.stats().entityCount),
    null,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(1_500);

  const captureArea = async (
    firstX,
    firstZ,
    secondX,
    secondZ,
    minimumUnits,
  ) => {
    const captureCorners = await page.evaluate(
      ({ firstX, firstZ, secondX, secondZ }) => {
        const game = window.__CINDERLINE__;
        if (!game) return null;
        const locate = (targetX, targetZ) => {
          const candidates = [];
          for (let clientY = 70; clientY <= 810; clientY += 3) {
            for (let clientX = 30; clientX <= 1410; clientX += 3) {
              if (document.elementFromPoint(clientX, clientY)?.id !== "world") {
                continue;
              }
              const cell = game.renderer.screenToGrid(clientX, clientY);
              if (cell?.x === targetX && cell.z === targetZ) {
                candidates.push({ clientX, clientY });
              }
            }
          }
          if (candidates.length === 0) return null;
          const centerX =
            candidates.reduce((sum, point) => sum + point.clientX, 0) /
            candidates.length;
          const centerY =
            candidates.reduce((sum, point) => sum + point.clientY, 0) /
            candidates.length;
          return candidates.reduce((closest, point) => {
            const distance =
              (point.clientX - centerX) ** 2 +
              (point.clientY - centerY) ** 2;
            const closestDistance =
              (closest.clientX - centerX) ** 2 +
              (closest.clientY - centerY) ** 2;
            return distance < closestDistance ? point : closest;
          });
        };
        return {
          first: locate(firstX, firstZ),
          second: locate(secondX, secondZ),
        };
      },
      { firstX, firstZ, secondX, secondZ },
    );
    assert(
      captureCorners?.first && captureCorners.second,
      `Capture cells missing for ${firstX},${firstZ} → ${secondX},${secondZ}.`,
    );
    const previousSignature = await page.evaluate(
      () =>
        window.__CINDERLINE__?.blueprint.clipboard?.entities
          .map(
            (entity) =>
              `${entity.kind}:${entity.x}:${entity.y}:${entity.recipeId ?? "-"}:${entity.manifoldRouting?.mode ?? "-"}`,
          )
          .join("|") ?? "",
    );
    await page.locator("#world").focus();
    await page.keyboard.press("b");
    await page.waitForFunction(
      () => window.__CINDERLINE__?.blueprint.mode === "capture",
      null,
      { timeout: 5_000 },
    );
    await page.mouse.move(
      captureCorners.first.clientX,
      captureCorners.first.clientY,
    );
    await page.mouse.down();
    await page.waitForFunction(
      () => window.__CINDERLINE__?.blueprint.captureAnchor !== null,
      null,
      { timeout: 5_000 },
    );
    await page.mouse.move(
      captureCorners.second.clientX,
      captureCorners.second.clientY,
      { steps: 10 },
    );
    await page.mouse.up();
    await page.waitForFunction(
      ({ minimum, previous }) => {
        const blueprint = window.__CINDERLINE__?.blueprint;
        const signature =
          blueprint?.clipboard?.entities
            .map(
              (entity) =>
                `${entity.kind}:${entity.x}:${entity.y}:${entity.recipeId ?? "-"}:${entity.manifoldRouting?.mode ?? "-"}`,
            )
            .join("|") ?? "";
        return (
          blueprint?.mode === "paste" &&
          (blueprint.clipboard?.entities.length ?? 0) >= minimum &&
          signature !== previous
        );
      },
      { minimum: minimumUnits, previous: previousSignature },
      { timeout: 5_000 },
    );
    return page.evaluate(
      () => window.__CINDERLINE__?.blueprint.clipboard?.entities.length ?? 0,
    );
  };

  const poweredCellUnits = await captureArea(34, 9, 23, 2, 8);

  await page.keyboard.press("Shift+b");
  const layer = page.locator("[data-ref='blueprint-library-layer']");
  await layer.waitFor({ state: "visible" });
  await page.waitForFunction(() =>
    Boolean(
      document.querySelector("[data-ref='blueprint-library-layer']")
        ?.contains(document.activeElement),
    ),
  );
  const name = page.locator("[data-ref='blueprint-library-name']");
  const saveLiveCapture = async ({
    parentId,
    recordName,
    firstX,
    firstZ,
    secondX,
    secondZ,
    minimumUnits,
  }) => {
    const parent = page.locator(`[data-library-id="${parentId}"]`);
    await parent.scrollIntoViewIfNeeded();
    await parent.click();
    await page
      .locator(
        ".blueprint-library-header [data-action='blueprint-library-toggle']",
      )
      .click();
    await layer.waitFor({ state: "hidden" });
    const units = await captureArea(
      firstX,
      firstZ,
      secondX,
      secondZ,
      minimumUnits,
    );
    await page.keyboard.press("Shift+b");
    await layer.waitFor({ state: "visible" });
    await name.fill(recordName);
    await page.locator("[data-action='blueprint-library-save']").click();
    await page.waitForFunction(
      (expectedName) => {
        const library = window.__CINDERLINE__?.blueprintLibrary;
        const find = (entries) => {
          for (const entry of entries ?? []) {
            if (entry.id === library?.selectedId) return entry;
            if (entry.kind === "book") {
              const nested = find(entry.entries);
              if (nested) return nested;
            }
          }
          return null;
        };
        return find(library?.entries)?.name === expectedName;
      },
      recordName,
    );
    const id = await page.evaluate(
      () => window.__CINDERLINE__?.blueprintLibrary.selectedId ?? null,
    );
    assert(id, `Saved record id missing for ${recordName}.`);
    return { id, units };
  };

  await name.fill("Powered <Gear> & Grid");
  await page.locator("[data-action='blueprint-library-save']").click();
  await page.waitForFunction(
    () => window.__CINDERLINE__?.blueprintLibrary.entries.length === 1,
  );
  assert(
    await page.locator(".blueprint-library-entry strong").first().textContent() ===
      "Powered <Gear> & Grid",
    "Library record name was not rendered as literal text.",
  );
  await name.fill("Powered Gear Cell");
  await page.locator("[data-action='blueprint-library-update']").click();
  await page.waitForFunction(
    () =>
      window.__CINDERLINE__?.blueprintLibrary.entries[0]?.name ===
      "Powered Gear Cell",
  );

  await name.fill("Routing Folios");
  await page.locator("[data-action='blueprint-library-new-book']").click();
  await page.waitForFunction(
    () =>
      window.__CINDERLINE__?.blueprintLibrary.entries.length === 2 &&
      window.__CINDERLINE__?.blueprintLibrary.entries[1]?.kind === "book",
  );
  const routingBookId = await page.evaluate(() => {
    const entry = window.__CINDERLINE__?.blueprintLibrary.entries[1];
    return entry?.kind === "book" ? entry.id : null;
  });
  assert(routingBookId, "Routing book id missing.");

  await page
    .locator(
      ".blueprint-library-header [data-action='blueprint-library-toggle']",
    )
    .click();
  await layer.waitFor({ state: "hidden" });
  const routingCellUnits = await captureArea(12, 8, 22, 16, 12);
  await page.keyboard.press("Shift+b");
  await layer.waitFor({ state: "visible" });
  await name.fill("Copper Logic Route");
  await page.locator("[data-action='blueprint-library-save']").click();
  await page.waitForFunction(
    () => {
      const entries = window.__CINDERLINE__?.blueprintLibrary.entries;
      return (
        entries?.length === 2 &&
        entries[1]?.kind === "book" &&
        entries[1].entries.length === 1
      );
    },
  );
  const originalNestedId = await page.evaluate(() => {
    const entry = window.__CINDERLINE__?.blueprintLibrary.entries[1];
    return entry?.kind === "book" ? entry.entries[0]?.id : null;
  });
  assert(originalNestedId, "Original nested blueprint id missing.");
  await name.fill("Copper Logic Route Mk II");
  await page.locator("[data-action='blueprint-library-update']").click();
  await page.waitForFunction(
    (id) => {
      const entry = window.__CINDERLINE__?.blueprintLibrary.entries[1];
      return (
        entry?.kind === "book" &&
        entry.entries[0]?.id === id &&
        entry.entries[0]?.name === "Copper Logic Route Mk II"
      );
    },
    originalNestedId,
  );
  await page.locator("[data-action='blueprint-library-reassign']").click();
  await page.locator("[data-action='blueprint-library-duplicate']").click();
  await page.waitForFunction(
    (id) => {
      const library = window.__CINDERLINE__?.blueprintLibrary;
      const entry = library?.entries[1];
      return (
        entry?.kind === "book" &&
        entry.entries.length === 2 &&
        library?.selectedId !== id
      );
    },
    originalNestedId,
  );
  const duplicateId = await page.evaluate(
    () => window.__CINDERLINE__?.blueprintLibrary.selectedId,
  );
  assert(duplicateId, "Duplicated blueprint id missing.");
  await page.locator("[data-action='blueprint-library-move-up']").click();
  await page.waitForFunction(
    (id) => {
      const entry = window.__CINDERLINE__?.blueprintLibrary.entries[1];
      return entry?.kind === "book" && entry.entries[0]?.id === id;
    },
    duplicateId,
  );
  await page.waitForFunction(() => {
    const button = document.querySelector(
      "[data-action='blueprint-library-move-down']",
    );
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await page.locator("[data-action='blueprint-library-move-down']").evaluate(
    (button) => button.click(),
  );
  await page.waitForFunction(
    (id) => {
      const entry = window.__CINDERLINE__?.blueprintLibrary.entries[1];
      return entry?.kind === "book" && entry.entries[1]?.id === id;
    },
    duplicateId,
  );
  await page.locator("[data-action='blueprint-library-delete']").click();
  await page.waitForFunction(
    () => {
      const entry = window.__CINDERLINE__?.blueprintLibrary.entries[1];
      return entry?.kind === "book" && entry.entries.length === 1;
    },
  );
  await page.locator("[data-action='blueprint-library-restore-delete']").click();
  await page.waitForFunction(
    () => {
      const entry = window.__CINDERLINE__?.blueprintLibrary.entries[1];
      return entry?.kind === "book" && entry.entries.length === 2;
    },
  );
  await page.locator(`[data-library-id="${duplicateId}"]`).click();
  await page.locator("[data-action='blueprint-library-delete']").click();
  await page.waitForFunction(
    () => {
      const entry = window.__CINDERLINE__?.blueprintLibrary.entries[1];
      return entry?.kind === "book" && entry.entries.length === 1;
    },
  );
  await page.locator(`[data-library-id="${originalNestedId}"]`).click();
  await name.fill("Copper Logic Route Mk II");
  await page.locator("[data-action='blueprint-library-update']").click();

  const coreAssembly = await saveLiveCapture({
    parentId: routingBookId,
    recordName: "Core Assembly Cell",
    firstX: 35,
    firstZ: 14,
    secondX: 28,
    secondZ: 8,
    minimumUnits: 8,
  });

  await name.fill("Power & Logistics");
  await page.locator("[data-action='blueprint-library-new-book']").click();
  await page.waitForFunction(
    () => {
      const roots = window.__CINDERLINE__?.blueprintLibrary.entries;
      return (
        roots?.length === 3 &&
        roots[2]?.kind === "book" &&
        roots[2].name === "Power & Logistics"
      );
    },
  );
  const powerBookId = await page.evaluate(() => {
    const entry = window.__CINDERLINE__?.blueprintLibrary.entries[2];
    return entry?.kind === "book" ? entry.id : null;
  });
  assert(powerBookId, "Power and logistics book id missing.");

  const coalFeed = await saveLiveCapture({
    parentId: powerBookId,
    recordName: "Coal Feed Grid",
    firstX: 27,
    firstZ: 23,
    secondX: 17,
    secondZ: 17,
    minimumUnits: 8,
  });
  const circuitDepot = await saveLiveCapture({
    parentId: powerBookId,
    recordName: "Circuit Depot",
    firstX: 35,
    firstZ: 20,
    secondX: 28,
    secondZ: 14,
    minimumUnits: 8,
  });

  assert(
    (await page.locator(".blueprint-library-entry").count()) === 7,
    "Expanded nested library tree did not render all seven true records.",
  );
  const canonicalSemantics = await page.evaluate(() => {
    const roots = window.__CINDERLINE__?.blueprintLibrary.entries ?? [];
    const plans = [];
    let bookCount = 0;
    const visit = (entries) => {
      for (const entry of entries) {
        if (entry.kind === "book") {
          bookCount += 1;
          visit(entry.entries);
          continue;
        }
        const kinds = [
          ...new Set(entry.blueprint.entities.map((entity) => entity.kind)),
        ].sort();
        const recipes = [
          ...new Set(
            entry.blueprint.entities
              .map((entity) => entity.recipeId)
              .filter(Boolean),
          ),
        ].sort();
        plans.push({
          id: entry.id,
          name: entry.name,
          kinds,
          recipes,
          units: entry.blueprint.entities.length,
          width: entry.blueprint.width,
          height: entry.blueprint.height,
          signature: entry.blueprint.entities
            .map(
              (entity) =>
                `${entity.kind}:${entity.x}:${entity.y}:${entity.recipeId ?? "-"}:${entity.manifoldRouting?.mode ?? "-"}`,
            )
            .join("|"),
        });
      }
    };
    visit(roots);
    return {
      bookCount,
      plans,
      selectedId: window.__CINDERLINE__?.blueprintLibrary.selectedId,
    };
  });
  const semanticPlan = (recordName) =>
    canonicalSemantics.plans.find((plan) => plan.name === recordName);
  assert(
    canonicalSemantics.bookCount === 2 &&
      canonicalSemantics.plans.length === 5 &&
      new Set(canonicalSemantics.plans.map((plan) => plan.signature)).size ===
        5,
    "The canonical archive is not five distinct live plans across two books.",
  );
  assert(
    semanticPlan("Powered Gear Cell")?.kinds.includes("generator") &&
      semanticPlan("Powered Gear Cell").kinds.includes("gridRelay") &&
      semanticPlan("Powered Gear Cell").kinds.includes("fabricator") &&
      semanticPlan("Powered Gear Cell").kinds.includes("storage") &&
      semanticPlan("Powered Gear Cell").units === poweredCellUnits,
    "The first canonical record is not a real powered fabrication cell.",
  );
  assert(
    semanticPlan("Copper Logic Route Mk II")?.kinds.includes("manifold") &&
      semanticPlan("Copper Logic Route Mk II").kinds.includes("fabricator") &&
      semanticPlan("Copper Logic Route Mk II").kinds.includes("storage") &&
      semanticPlan("Copper Logic Route Mk II").units === routingCellUnits,
    `The routed canonical record is not a real product-and-storage cell: ${JSON.stringify(semanticPlan("Copper Logic Route Mk II"))}.`,
  );
  assert(
    semanticPlan("Core Assembly Cell")?.recipes.includes("automationCore") &&
      semanticPlan("Core Assembly Cell").units === coreAssembly.units &&
      semanticPlan("Coal Feed Grid")?.kinds.includes("generator") &&
      semanticPlan("Coal Feed Grid").kinds.includes("gridRelay") &&
      semanticPlan("Coal Feed Grid").units === coalFeed.units &&
      semanticPlan("Circuit Depot")?.recipes.includes("circuit") &&
      semanticPlan("Circuit Depot").units === circuitDepot.units,
    "The additional live captures lost their distinct recipe or power identity.",
  );
  assert(
    (await page.locator(
      ".blueprint-library-tree .blueprint-library-entry-glyph.is-plan > svg",
    ).count()) === 5,
    "Saved blueprints did not render spatial micro-previews.",
  );
  assert(
    (await page.locator("[data-library-unit]").count()) >= 12,
    "Blueprint micro-previews omitted stored construction units.",
  );
  assert(
    (await page.locator(".blueprint-library-unit-symbol").count()) >= 12,
    "Blueprint micro-previews omitted prototype-specific machine symbols.",
  );
  assert(
    (await page.locator(".blueprint-library-prototype-icon").count()) >= 12,
    "Blueprint micro-previews did not reuse authored prototype pictograms.",
  );
  assert(
    (await page.locator(".blueprint-library-belt-lanes").count()) >= 4 &&
      (await page.locator(".blueprint-library-belt-arrows").count()) >= 4,
    "Belt previews omitted visible lanes or cardinal flow arrows.",
  );
  assert(
    (await page.locator(".blueprint-library-machine-port").count()) >= 2,
    "Machine previews omitted physical input/output ports.",
  );
  assert(
    (await page.locator(".blueprint-library-recipe-badge").count()) >= 2,
    "Configured or automatic process identity was absent from machine previews.",
  );
  assert(
    (await page.locator(".blueprint-library-entry-content > i").count()) >= 4,
    "Plan cards did not expose their content-derived machine palette.",
  );
  assert(
    (await page.locator(".blueprint-library-unit-underlay").count()) >= 12 &&
      (await page.locator(".blueprint-library-unit-bevel").count()) >= 12 &&
      (await page.locator(".blueprint-library-unit-rivet").count()) >= 4 &&
      (await page.locator(".blueprint-library-unit-occlusion").count()) >= 12 &&
      (await page.locator(".blueprint-library-unit-wear").count()) >= 12 &&
      (await page.locator(".blueprint-library-unit-status").count()) >= 4 &&
      (await page.locator(".blueprint-library-mechanical-detail").count()) >=
        12 &&
      (await page.locator(".blueprint-library-unit-patina").count()) >= 12 &&
      (await page.locator(".blueprint-library-recipe-bezel").count()) ===
        (await page.locator(".blueprint-library-recipe-badge").count()),
    "Machine miniatures omitted layered chassis depth or fastener detail.",
  );
  assert(
    (await page.locator(".blueprint-library-process-core").count()) >= 2 &&
      (await page.locator(".blueprint-library-belt-roller").count()) >= 4,
    "Process cores or belt hardware were absent from the canonical plan.",
  );
  assert(
    (await page.locator(".blueprint-library-production-chain").count()) === 1 &&
      (await page.locator(".blueprint-library-chain-node").count()) >= 3 &&
      (await page.locator(".blueprint-library-chain-output").count()) === 1 &&
      (await page.locator(".blueprint-library-chain-power").count()) === 1,
    "Selected plan omitted its production/product/power identity chain.",
  );
  assert(
    (await page
      .locator("[data-ref='blueprint-library-index-summary']")
      .textContent()) === "5 PLANS · 2 BOOKS",
    "The archive index did not truthfully summarize the expanded working library.",
  );
  assert(
    await page.locator(".blueprint-library-chain-node small").evaluateAll(
      (labels) =>
        labels.length >= 4 &&
        labels.every(
          (label) =>
            label.textContent?.trim().length > 0 &&
            label.scrollWidth <= label.clientWidth + 1,
        ),
    ),
    "Selected topology labels were missing or visually truncated.",
  );
  assert(
    (await page.locator(".blueprint-library-map-links path").count()) >= 2,
    "Blueprint micro-previews did not visualize connected topology.",
  );
  assert(
    (await page.locator(".blueprint-library-book-cover").count()) === 2,
    "Nested blueprint books did not render as dimensional folios.",
  );
  assert(
    !(await page.locator(".blueprint-library-transfer").evaluate(
      (element) => element.hasAttribute("open"),
    )),
    "Raw transfer data should remain collapsed in the primary workflow.",
  );

  await page.locator(".blueprint-library-transfer summary").click();
  await page.locator("[data-action='blueprint-library-export']").click();
  const share = page.locator("[data-ref='blueprint-library-share']");
  const exported = await share.inputValue();
  const persisted = await page.evaluate(() =>
    localStorage.getItem("cinderline.blueprint-library.v2"),
  );
  assert(exported.length > 100, "Library export did not emit canonical bytes.");
  assert(exported === persisted, "Export and persisted canonical bytes diverged.");

  const beforeInvalidImport = await page.evaluate(
    () => JSON.stringify(window.__CINDERLINE__?.blueprintLibrary),
  );
  await share.fill('{"format":"not-a-library"}');
  await page.locator("[data-action='blueprint-library-import']").click();
  await page.waitForTimeout(100);
  assert(
    (await page.evaluate(
      () => JSON.stringify(window.__CINDERLINE__?.blueprintLibrary),
    )) === beforeInvalidImport,
    "Invalid import partially replaced the live library.",
  );

  const nestedId = originalNestedId;
  assert(nestedId, "Nested blueprint id missing.");
  await page.locator(`[data-library-id="${nestedId}"]`).click();
  await page.locator("[data-action='blueprint-library-export']").click();
  const beforeNestedDelete = await share.inputValue();
  await page.locator("[data-action='blueprint-library-delete']").click();
  await page.waitForFunction(
    () => {
      const entry = window.__CINDERLINE__?.blueprintLibrary.entries[1];
      return entry?.kind === "book" && entry.entries.length === 1;
    },
  );
  await page.locator("[data-action='blueprint-library-restore-delete']").click();
  await page.waitForFunction(
    () => {
      const entry = window.__CINDERLINE__?.blueprintLibrary.entries[1];
      return entry?.kind === "book" && entry.entries.length === 2;
    },
  );
  assert(
    (await page.evaluate(() =>
      localStorage.getItem("cinderline.blueprint-library.v2"),
    )) === beforeNestedDelete,
    "Restoring a deletion did not recover the exact canonical library bytes.",
  );
  await page.locator(`[data-library-id="${nestedId}"]`).click();
  await page.locator("[data-action='blueprint-library-delete']").click();
  await page.waitForFunction(
    () => {
      const entry = window.__CINDERLINE__?.blueprintLibrary.entries[1];
      return entry?.kind === "book" && entry.entries.length === 1;
    },
  );
  await share.fill(exported);
  await page.locator("[data-action='blueprint-library-import']").click();
  await page.waitForFunction(
    () => {
      const entry = window.__CINDERLINE__?.blueprintLibrary.entries[1];
      return entry?.kind === "book" && entry.entries.length === 2;
    },
  );

  await page.locator(".blueprint-library-transfer summary").click();
  const alignArchiveAtRecord = async (id) => {
    const record = page.locator(`[data-library-id="${id}"]`);
    await record.evaluate((entry) => {
      const tree = entry.closest(".blueprint-library-tree");
      if (!(tree instanceof HTMLElement)) return;
      const entryBounds = entry.getBoundingClientRect();
      const treeBounds = tree.getBoundingClientRect();
      tree.scrollTop += entryBounds.top - treeBounds.top;
    });
    await page.waitForTimeout(60);
    const archiveBoundary = await record.evaluate((entry) => {
      const tree = entry.closest(".blueprint-library-tree");
      if (!(tree instanceof HTMLElement)) return null;
      const paddingTop =
        Number.parseFloat(getComputedStyle(tree).paddingTop) || 0;
      const entryBounds = entry.getBoundingClientRect();
      const treeBounds = tree.getBoundingClientRect();
      const previous = entry.previousElementSibling;
      const previousBounds =
        previous instanceof HTMLElement
          ? previous.getBoundingClientRect()
          : null;
      return {
        entryTop: entryBounds.top,
        treeTop: treeBounds.top,
        paddingTop,
        previousBottom: previousBounds?.bottom ?? null,
        scrollTop: tree.scrollTop,
        maximumScrollTop: tree.scrollHeight - tree.clientHeight,
      };
    });
    assert(
      archiveBoundary !== null &&
        Math.abs(
          archiveBoundary.entryTop -
            archiveBoundary.treeTop,
        ) <= 2 &&
        (archiveBoundary.previousBottom === null ||
          archiveBoundary.previousBottom <= archiveBoundary.treeTop + 1),
      `Archive proof did not begin on a deliberate full-record boundary: ${JSON.stringify(archiveBoundary)}`,
    );
  };
  await alignArchiveAtRecord(originalNestedId);

  const desktopLayout = await inspectLayout(page, 1440, 900);
  await page.screenshot({
    path: `${OUTPUT_DIRECTORY}/desktop-1440.png`,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(180);
  await alignArchiveAtRecord(originalNestedId);
  const mobileLayout = await inspectLayout(page, 390, 844);
  await page.screenshot({
    path: `${OUTPUT_DIRECTORY}/mobile-390.png`,
  });
  const toolsToggle = page.locator(
    "[data-action='blueprint-library-tools-toggle']",
  );
  await toolsToggle.click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-ref='blueprint-library-selected']")
      ?.classList.contains("is-tools-open"),
  );
  assert(
    await page.locator(".blueprint-library-secondary-actions").isVisible(),
    "Mobile record-management disclosure did not reveal secondary actions.",
  );
  await page.waitForTimeout(180);
  await page.screenshot({
    path: `${OUTPUT_DIRECTORY}/mobile-manage-expanded-390.png`,
  });
  assert(
    await page.evaluate(() => {
      const detail = document.querySelector(".blueprint-library-detail");
      const selected = document.querySelector(
        "[data-ref='blueprint-library-selected']",
      );
      if (!(detail instanceof HTMLElement) || !(selected instanceof HTMLElement)) {
        return false;
      }
      const detailBounds = detail.getBoundingClientRect();
      const selectedBounds = selected.getBoundingClientRect();
      return Math.abs(selectedBounds.top - detailBounds.top) <= 4;
    }),
    "Expanded mobile management did not begin at the Selected record boundary.",
  );
  await toolsToggle.evaluate((toggle) =>
    toggle.scrollIntoView({ block: "start" }),
  );
  await page.waitForTimeout(120);
  await page.screenshot({
    path: `${OUTPUT_DIRECTORY}/mobile-actions-recovery-390.png`,
  });
  assert(
    await page.locator(".blueprint-library-secondary-actions").evaluate(
      (actions) => {
        const viewportHeight = window.innerHeight;
        return [...actions.querySelectorAll("button")].every((button) => {
          const bounds = button.getBoundingClientRect();
          return bounds.top >= 54 && bounds.bottom <= viewportHeight + 3;
        });
      },
    ),
    "Expanded mobile management actions remained below the viewport fold.",
  );
  assert(
    await page.evaluate(() => {
      const finalRow = document.querySelector(
        ".blueprint-library-order-actions",
      );
      const recovery = document.querySelector(
        ".blueprint-library-transfer summary",
      );
      if (!(finalRow instanceof HTMLElement) || !(recovery instanceof HTMLElement)) {
        return false;
      }
      const rowBounds = finalRow.getBoundingClientRect();
      const recoveryBounds = recovery.getBoundingClientRect();
      return (
        rowBounds.top >= 54 &&
        rowBounds.bottom <= window.innerHeight + 3 &&
        recoveryBounds.top >= 54 &&
        recoveryBounds.bottom <= window.innerHeight + 3
      );
    }),
    "The final management row and Transfer & recovery were not visible together in mobile proof.",
  );
  await toolsToggle.click();
  assert(
    !(await page.locator(".blueprint-library-secondary-actions").isVisible()),
    "Mobile record-management disclosure did not collapse.",
  );

  await page.locator(`[data-library-id="${nestedId}"]`).click();
  await page.locator("[data-action='blueprint-library-load']").click();
  await page.waitForFunction(
    (expectedUnits) =>
      document.querySelector("[data-ref='blueprint-library-layer']")?.hidden ===
        true &&
      window.__CINDERLINE__?.blueprint.mode === "paste" &&
      window.__CINDERLINE__?.blueprint.clipboard?.entities.length ===
        expectedUnits,
    routingCellUnits,
  );

  assert(errors.length === 0, errors.join("\n"));
  assert(warnings.length === 0, warnings.join("\n"));
  console.log(
    JSON.stringify(
      {
        ok: true,
        canonicalBytes: exported.length,
        desktopLayout,
        mobileLayout,
        warnings,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}

async function inspectLayout(target, width, height) {
  return target.locator(".blueprint-library-console").evaluate(
    (consoleElement, viewport) => {
      const bounds = consoleElement.getBoundingClientRect();
      const actionButtons = [
        ...consoleElement.querySelectorAll(
          ".blueprint-library-capture button, .blueprint-library-selected button, .blueprint-library-share-actions button",
        ),
      ].filter((button) => button instanceof HTMLElement && button.offsetParent !== null).map((button) => {
        const box = button.getBoundingClientRect();
        return { width: box.width, height: box.height };
      });
      if (
        bounds.left < 0 ||
        bounds.top < 0 ||
        bounds.right > viewport.width ||
        bounds.bottom > viewport.height
      ) {
        throw new Error(
          `Library console clips ${viewport.width}x${viewport.height}: ${JSON.stringify(bounds.toJSON())}`,
        );
      }
      if (actionButtons.some((button) => button.height < 44)) {
        throw new Error("Library contains an action target below 44px.");
      }
      if (document.documentElement.scrollWidth > viewport.width) {
        throw new Error("Library caused horizontal document overflow.");
      }
      const tree = consoleElement.querySelector(".blueprint-library-tree");
      const detail = consoleElement.querySelector(".blueprint-library-detail");
      const entries = [
        ...consoleElement.querySelectorAll(".blueprint-library-entry"),
      ];
      if (entries.length !== 7) {
        throw new Error("Canonical visual proof does not contain seven records.");
      }
      const expectedEntryHeight = viewport.width <= 690 ? 70 : 78;
      if (
        entries.some(
          (entry) =>
            entry.getBoundingClientRect().height < expectedEntryHeight,
        )
      ) {
        throw new Error(
          "Expanded archive compressed a true record below its readable card height.",
        );
      }
      const metadataNodes = [
        ...consoleElement.querySelectorAll(
          ".blueprint-library-header small, .blueprint-library-entry small, .blueprint-library-entry-route, .blueprint-library-subhead, .blueprint-library-subhead small, .blueprint-library-name > span, .blueprint-library-capture small, .blueprint-library-selected-heading small, .blueprint-library-selected-heading b, .blueprint-library-selected-copy > strong, .blueprint-library-chain-node small, .blueprint-library-chain-output > small, .blueprint-library-chain-power small, .blueprint-library-vault-status strong, .blueprint-library-vault-status small, .blueprint-library-transfer summary b, .blueprint-library-transfer summary small, .blueprint-library-assurance",
        ),
      ].filter(
        (node) => node instanceof HTMLElement && node.offsetParent !== null,
      );
      const minimumMetadataSize = viewport.width <= 690 ? 10 : 9;
      const undersizedMetadata = metadataNodes
        .filter(
          (node) =>
            Number.parseFloat(getComputedStyle(node).fontSize) <
            minimumMetadataSize,
        )
        .map((node) => ({
          className: node.className,
          fontSize: getComputedStyle(node).fontSize,
          text: node.textContent?.trim().slice(0, 48),
        }));
      if (undersizedMetadata.length > 0) {
        throw new Error(
          `Library metadata falls below the ${minimumMetadataSize}px minimum: ${JSON.stringify(undersizedMetadata)}`,
        );
      }
      if (
        viewport.width <= 690 &&
        (
          !(tree instanceof HTMLElement) ||
          !(detail instanceof HTMLElement) ||
          getComputedStyle(tree).overflowY === "visible" ||
          getComputedStyle(detail).overflowY === "visible"
        )
      ) {
        throw new Error(
          "Mobile library workflows are not contained in bounded scroll regions.",
        );
      }
      return {
        bounds: bounds.toJSON(),
        actionButtons,
        treeRecords:
          consoleElement.querySelectorAll(".blueprint-library-entry").length,
        focusedInside:
          consoleElement.contains(document.activeElement),
        treeScroll: tree instanceof HTMLElement
          ? { clientHeight: tree.clientHeight, scrollHeight: tree.scrollHeight }
          : null,
        detailScroll: detail instanceof HTMLElement
          ? {
              clientHeight: detail.clientHeight,
              scrollHeight: detail.scrollHeight,
            }
          : null,
      };
    },
    { width, height },
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
