import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY = ".qa/process-world";
const FRAME_WIDTH = 440;
const FRAME_HEIGHT = 380;
const BLIND_SLOT_KEYS = [
  "working-automation-core",
  "starved-iron-gear",
  "blocked-copper-smelt",
  "auto-smelt",
  "queued-circuit-to-core",
  "unconfigured",
  "explicit-iron-smelt",
  "reclaim-fire-brick",
  "working-copper-wire",
  "no-power-circuit",
  "idle-ready-gear",
];
const MECHANISM_TOKEN_BY_RECIPE = {
  ironGear: "fabricator-gear-",
  copperWire: "fabricator-wire-",
  circuit: "fabricator-circuit-",
  automationCore: "fabricator-core-",
  smeltCopper: "smelter-copper-",
  fireBrick: "smelter-fire-brick-",
  auto: "smelter-auto-",
  smeltIron: "smelter-iron-",
};
const FIXTURES = [
  {
    key: "unconfigured",
    kind: "fabricator",
    x: 7,
    y: 7,
    direction: 0,
    state: "unconfigured",
    recipe: null,
    expectedSignature: "empty-open-tool-chuck",
    expectedPort: "recipe-socket",
    expectedRecipeSignature: null,
  },
  {
    key: "starved-iron-gear",
    kind: "fabricator",
    x: 13,
    y: 7,
    direction: 1,
    state: "starved",
    recipe: "ironGear",
    expectedSignature: "rear-amber-empty-hopper",
    expectedPort: "input",
    expectedRecipeSignature: "solid-eight-tooth-gear-die",
  },
  {
    key: "working-copper-wire",
    kind: "fabricator",
    x: 19,
    y: 7,
    direction: 2,
    state: "working",
    recipe: "copperWire",
    activeRecipe: "copperWire",
    progress: 0.48,
    expectedSignature: "green-driven-chamber-impeller",
    expectedPort: "chamber",
    expectedRecipeSignature: "thick-copper-spool-die",
  },
  {
    key: "queued-circuit-to-core",
    kind: "fabricator",
    x: 25,
    y: 7,
    direction: 3,
    state: "queued",
    recipe: "circuit",
    activeRecipe: "circuit",
    pendingRecipe: "automationCore",
    progress: 0.62,
    expectedSignature: "static-current-to-pending-tool-bridge",
    expectedPort: "queue",
    expectedRecipeSignature: "green-three-node-board-die",
    expectedPendingRecipeSignature: "green-hex-cyan-rotor-core-die",
  },
  {
    key: "working-automation-core",
    kind: "fabricator",
    x: 7,
    y: 14,
    direction: 1,
    state: "working",
    recipe: "automationCore",
    activeRecipe: "automationCore",
    progress: 0.57,
    expectedSignature: "green-driven-chamber-impeller",
    expectedPort: "chamber",
    expectedRecipeSignature: "green-hex-cyan-rotor-core-die",
  },
  {
    key: "blocked-copper-smelt",
    kind: "smelter",
    x: 14,
    y: 14,
    direction: 2,
    state: "output-blocked",
    recipe: "smeltCopper",
    expectedSignature: "front-red-full-output-crate",
    expectedPort: "output",
    expectedRecipeSignature: "ribbed-copper-plate-die",
  },
  {
    key: "reclaim-fire-brick",
    kind: "smelter",
    x: 20,
    y: 14,
    direction: 3,
    state: "starved",
    recipe: "fireBrick",
    reclaim: { stone: 2 },
    expectedSignature: "rear-amber-empty-hopper",
    expectedPort: "input",
    expectedRecipeSignature: "five-brick-bond-die",
  },
  {
    key: "auto-smelt",
    kind: "smelter",
    x: 26,
    y: 14,
    direction: 0,
    state: "starved",
    recipe: "auto",
    expectedSignature: "rear-amber-empty-hopper",
    expectedPort: "input",
    expectedRecipeSignature: "dual-ore-auto-furnace-selector",
  },
  {
    key: "explicit-iron-smelt",
    kind: "smelter",
    x: 10,
    y: 20,
    direction: 3,
    state: "starved",
    recipe: "smeltIron",
    expectedSignature: "rear-amber-empty-hopper",
    expectedPort: "input",
    expectedRecipeSignature: "solid-silver-plate-die",
  },
  {
    key: "no-power-circuit",
    kind: "fabricator",
    x: 16,
    y: 20,
    direction: 0,
    state: "no-power",
    recipe: "circuit",
    expectedSignature: "side-disconnected-power-plug",
    expectedPort: "power",
    expectedRecipeSignature: "green-three-node-board-die",
  },
  {
    key: "idle-ready-gear",
    kind: "fabricator",
    x: 22,
    y: 20,
    direction: 1,
    state: "idle",
    recipe: "ironGear",
    expectedSignature: "neutral-parked-control-lever",
    expectedPort: "operator-clutch",
    expectedRecipeSignature: "solid-eight-tooth-gear-die",
  },
];

await mkdir(OUTPUT_DIRECTORY, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      failures.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));

  await page.goto(`${BASE_URL}/?fresh=process-world-${Date.now()}`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#boot")?.classList.contains("is-done")
      && Boolean(window.__CINDERLINE__?.simulation)
      && Boolean(window.__CINDERLINE__?.renderer),
    undefined,
    { timeout: 15_000 },
  );
  await page.keyboard.press("Space");
  const tickBefore = await page.evaluate(
    () => window.__CINDERLINE__?.simulation.tickCount,
  );
  await page.waitForTimeout(80);
  const tickAfter = await page.evaluate(
    () => window.__CINDERLINE__?.simulation.tickCount,
  );
  assert(
    tickBefore === tickAfter,
    `Process-world QA could not pause (${tickBefore} → ${tickAfter}).`,
  );

  const fixtureIds = await page.evaluate((fixtures) => {
    const game = window.__CINDERLINE__;
    const simulation = game?.simulation;
    const renderer = game?.renderer;
    if (!simulation || !renderer) {
      throw new Error("Process-world QA bridge unavailable.");
    }
    for (const entity of simulation.getEntities()) {
      const removed = simulation.remove(entity.x, entity.y);
      if (!removed || removed.id !== entity.id) {
        throw new Error(`Could not remove showcase entity ${entity.id}.`);
      }
    }
    for (const resource of simulation.getResources()) {
      simulation.setResource(resource.x, resource.y, resource.type, 0);
    }
    // This renderer-only fixture matrix intentionally exercises process states
    // without introducing relay entities that would contaminate isolation,
    // picking, or the exact five-call 128-machine overview measurement.
    simulation.powerMode = "legacyGlobal";

    const ids = {};
    for (const fixture of fixtures) {
      const configuredRecipe =
        fixture.recipe === "auto" || fixture.recipe === null
          ? undefined
          : fixture.recipe;
      const placed = simulation.place(
        fixture.kind,
        fixture.x,
        fixture.y,
        fixture.direction,
        configuredRecipe ? { recipeId: configuredRecipe } : {},
      );
      if (!placed.ok) {
        throw new Error(
          `Could not place ${fixture.key}: ${placed.reason}.`,
        );
      }
      ids[fixture.key] = placed.entity.id;
      const authoritative = simulation.entities.get(placed.entity.id);
      if (!authoritative) {
        throw new Error(`Missing authoritative entity for ${fixture.key}.`);
      }
      authoritative.powerSatisfaction = 1;
      authoritative.progress = fixture.progress ?? 0;
      authoritative.reclaim = { ...(fixture.reclaim ?? {}) };
      authoritative.output = {};
      authoritative.input = {};
      authoritative.recipeChangeQueued = fixture.state === "queued";
      authoritative.pendingRecipeId =
        fixture.pendingRecipe === "auto"
          ? undefined
          : fixture.pendingRecipe;
      authoritative.activeRecipeId = fixture.activeRecipe;
      switch (fixture.state) {
        case "unconfigured":
          authoritative.status = "unconfigured";
          authoritative.recipeId = undefined;
          break;
        case "starved":
          authoritative.status = "missingInput";
          break;
        case "working":
          authoritative.status = "working";
          break;
        case "queued":
          authoritative.status = "changingRecipe";
          break;
        case "output-blocked":
          authoritative.status = "outputFull";
          authoritative.output =
            fixture.recipe === "smeltCopper"
              ? { copperPlate: 100 }
              : { ironPlate: 100 };
          break;
        case "no-power":
          authoritative.status = "noPower";
          authoritative.powerSatisfaction = 0;
          break;
        case "idle":
          authoritative.status = "idle";
          authoritative.activeRecipeId = undefined;
          authoritative.progress = 0;
          authoritative.input =
            fixture.recipe === "ironGear" ? { ironPlate: 2 } : {};
          break;
        default:
          throw new Error(`Unsupported fixture state ${fixture.state}.`);
      }
    }

    document.querySelector("#boot")?.remove();
    const hud = document.querySelector("#hud");
    if (hud instanceof HTMLElement) hud.style.display = "none";
    renderer.setSelected(null);
    renderer.setHovered(null, null);
    renderer.resourceRoot.visible = false;
    renderer.infrastructureRoot.visible = false;
    renderer.effectsRoot.visible = false;
    renderer.overlayRoot.visible = false;

    const originalSync = renderer.sync.bind(renderer);
    const originalUpdate = renderer.update.bind(renderer);
    const originalRender = renderer.render.bind(renderer);
    const qa = {
      ids,
      targetId: null,
      originalSync,
      originalUpdate,
      originalRender,
      holdSnapshot: false,
    };
    const isolate = () => {
      for (const [entityId, rig] of renderer.entityObjects) {
        rig.root.visible =
          qa.targetId === null || entityId === qa.targetId;
      }
      renderer.resourceRoot.visible = false;
      renderer.infrastructureRoot.visible = false;
      renderer.effectsRoot.visible = false;
      renderer.overlayRoot.visible = false;
    };
    renderer.sync = (snapshot) => {
      if (qa.holdSnapshot) return;
      originalSync(snapshot);
      isolate();
    };
    renderer.update = () => {};
    renderer.__processWorldQA = qa;
    return ids;
  }, FIXTURES);

  await page.waitForFunction(
    (ids) => {
      const objects = window.__CINDERLINE__?.renderer.entityObjects;
      return Boolean(
        objects
        && objects.size === ids.length
        && ids.every((id) => objects.has(id)),
      );
    },
    Object.values(fixtureIds),
    { timeout: 10_000 },
  );

  const canvasBox = await page.locator("#world").boundingBox();
  if (!canvasBox || canvasBox.width < 1200 || canvasBox.height < 700) {
    throw new Error("Process-world canvas is missing or unexpectedly small.");
  }

  const captures = [];
  const proofs = [];
  for (const [index, fixture] of FIXTURES.entries()) {
    const proof = await page.evaluate(
      ({ fixture, fixtureId, elapsed, mechanismToken }) => {
        const game = window.__CINDERLINE__;
        const simulation = game?.simulation;
        const renderer = game?.renderer;
        const qa = renderer?.__processWorldQA;
        if (!simulation || !renderer || !qa) {
          throw new Error("Process-world capture bridge disappeared.");
        }
        qa.targetId = fixtureId;
        const rig = renderer.entityObjects.get(fixtureId);
        const renderEntity = renderer.entityData.get(fixtureId);
        const authoritative = simulation.getEntity(fixtureId);
        if (!rig || !renderEntity || !authoritative) {
          throw new Error(`Capture rig ${fixture.key} disappeared.`);
        }
        for (const [entityId, candidate] of renderer.entityObjects) {
          candidate.root.visible = entityId === fixtureId;
        }
        qa.originalUpdate(0, elapsed);
        renderer.focus(rig.root.position.x, rig.root.position.z);
        for (let zoom = 0; zoom < 10; zoom += 1) renderer.zoom(-4);
        qa.originalRender(0);
        renderer.renderer.getContext().finish();

        const effectiveVisible = (object) => {
          let current = object;
          while (current) {
            if (!current.visible) return false;
            if (current === rig.root) break;
            current = current.parent;
          }
          return true;
        };
        const primary = [
          rig.parts.processUnconfigured,
          rig.parts.processInputLatch,
          rig.parts.processChamberPulse,
          rig.parts.processQueueBridge,
          rig.parts.processOutputGate,
          rig.parts.processPowerBreaker,
          rig.parts.processIdleReady,
        ].filter((part) => part && effectiveVisible(part));
        const stateWitnesses = [
          ...(rig.parts.processStateWitnesses?.entries() ?? []),
        ].filter(([, part]) => part && effectiveVisible(part));
        const Quaternion = renderer.camera.quaternion.constructor;
        const Vector3 = renderer.camera.position.constructor;
        const rootQuaternion = rig.root.getWorldQuaternion(new Quaternion());
        const signalQuaternion = rig.parts.processSignalRoot.getWorldQuaternion(
          new Quaternion(),
        );
        const localFront = new Vector3(0, 0, -1)
          .applyQuaternion(rootQuaternion)
          .setY(0)
          .normalize();
        const expectedFronts = [
          [0, 0, -1],
          [1, 0, 0],
          [0, 0, 1],
          [-1, 0, 0],
        ];
        const expectedFront = new Vector3(
          ...expectedFronts[fixture.direction],
        );
        const quaternionDot = Math.abs(rootQuaternion.dot(signalQuaternion));

        const bounds = renderer.canvas.getBoundingClientRect();
        renderer.selectionHalo.geometry.computeBoundingBox();
        const Box3 = renderer.selectionHalo.geometry.boundingBox?.constructor;
        const glyphBox = Box3 ? new Box3() : null;
        if (glyphBox && effectiveVisible(rig.parts.processGlyphRoot)) {
          glyphBox.setFromObject(rig.parts.processGlyphRoot);
        }
        const projectedSize = (box) => {
          if (!box || box.isEmpty()) return { width: 0, height: 0 };
          const points = [];
          for (const x of [box.min.x, box.max.x]) {
            for (const y of [box.min.y, box.max.y]) {
              for (const z of [box.min.z, box.max.z]) {
                const point = new Vector3(x, y, z)
                  .project(renderer.camera);
                points.push({
                  x: (point.x + 1) * bounds.width * 0.5,
                  y: (-point.y + 1) * bounds.height * 0.5,
                });
              }
            }
          }
          return {
            width:
              Math.max(...points.map((point) => point.x))
              - Math.min(...points.map((point) => point.x)),
            height:
              Math.max(...points.map((point) => point.y))
              - Math.min(...points.map((point) => point.y)),
          };
        };
        const authoredNames = [];
        rig.root.traverse((object) => {
          if (object.name) authoredNames.push(object.name);
        });
        const mechanismNames = mechanismToken
          ? authoredNames.filter((name) => name.includes(mechanismToken))
          : [];
        const productShuttle = rig.parts.recipeProductShuttle;
        const attachedToRig = (object) => {
          let current = object;
          while (current) {
            if (current === rig.root) return true;
            current = current.parent;
          }
          return false;
        };

        return {
          key: fixture.key,
          authoritative: {
            status: authoritative.status,
            recipeId: authoritative.recipeId ?? null,
            activeRecipeId: authoritative.activeRecipeId ?? null,
            queued: authoritative.recipeChangeQueued,
            pendingRecipeId: authoritative.pendingRecipeId ?? null,
            reclaimCount: Object.values(authoritative.reclaim).reduce(
              (sum, amount) => sum + (amount ?? 0),
              0,
            ),
          },
          renderContract: {
            processState: renderEntity.processState ?? null,
            processRecipe: renderEntity.processRecipe ?? null,
            pendingRecipe: renderEntity.pendingRecipe ?? null,
            reclaimCount: renderEntity.reclaimCount ?? 0,
          },
          signal: {
            state: rig.parts.processSignalRoot.userData.processState,
            primaryCount: primary.length,
            primaryName: primary[0]?.name ?? null,
            primarySignature:
              rig.parts.processSignalRoot.userData.visiblePrimarySignature,
            primaryPort:
              rig.parts.processSignalRoot.userData.visiblePrimaryPort,
            recipeIdentity:
              rig.parts.processGlyphRoot.userData.recipeIdentity,
            recipeSignature:
              rig.parts.processGlyphRoot.userData.recipeSignature,
            recipeVisible: effectiveVisible(rig.parts.processGlyphRoot),
            reclaimVisible: effectiveVisible(rig.parts.processReclaimBin),
            reclaimCount:
              rig.parts.processReclaimBin.userData.reclaimCount,
            reclaimSignature:
              rig.parts.processReclaimBin.userData.signalSignature ?? null,
            reclaimPort:
              rig.parts.processReclaimBin.userData.physicalPort ?? null,
            pendingRecipe:
              rig.parts.processQueueBridge.userData.pendingRecipe,
            pendingRecipeIdentity:
              rig.parts.processPendingGlyphRoot?.userData.recipeIdentity ?? null,
            pendingRecipeSignature:
              rig.parts.processPendingGlyphRoot?.userData.recipeSignature
                ?? null,
            pendingRecipeVisible:
              rig.parts.processPendingGlyphRoot
                ? effectiveVisible(rig.parts.processPendingGlyphRoot)
                : false,
            physicallyAttached:
              rig.parts.processSignalRoot.parent === rig.root,
            quaternionDot,
            forwardDot: localFront.dot(expectedFront),
            glyphPixels: projectedSize(glyphBox),
            fixedWitness: {
              count: stateWitnesses.length,
              state: stateWitnesses[0]?.[0] ?? null,
              name: stateWitnesses[0]?.[1]?.name ?? null,
              rootAttached:
                rig.parts.processStateWitnessRoot?.parent
                  === rig.parts.processSignalRoot,
              rootPosition:
                rig.parts.processStateWitnessRoot?.position.toArray() ?? null,
            },
            fixedRecipeStation: {
              rootAttached:
                rig.parts.processGlyphRoot?.parent
                  === rig.parts.processSignalRoot,
              rootPosition:
                rig.parts.processGlyphRoot?.position.toArray() ?? null,
              plaquePosition:
                rig.parts.processPlaque?.position.toArray() ?? null,
              pendingRootAttached:
                rig.parts.processPendingGlyphRoot?.parent
                  === rig.parts.processSignalRoot,
              pendingRootPosition:
                rig.parts.processPendingGlyphRoot?.position.toArray() ?? null,
            },
          },
          mechanical: {
            mechanismToken,
            mechanismNames,
            mechanismCount: mechanismNames.length,
            toolingRecipe:
              rig.root.getObjectByName(
                rig.kind === "smelter"
                  ? "smelter-recipe-specific-working-tooling"
                  : "fabricator-recipe-specific-working-tooling",
              )?.userData.recipeIdentity ?? null,
            localizedWear:
              authoredNames.find((name) =>
                name.endsWith("-localized-process-wear")
              ) ?? null,
            productName: productShuttle?.name ?? null,
            productChildren: productShuttle?.children.length ?? 0,
            productVisible:
              productShuttle ? effectiveVisible(productShuttle) : false,
            productAttached: productShuttle
              ? attachedToRig(productShuttle)
              : false,
            actuationName:
              rig.parts.recipeMechanismActuator?.name
              ?? rig.parts.recipeMechanismRotor?.name
              ?? null,
            actuationAttached: attachedToRig(
              rig.parts.recipeMechanismActuator
                ?? rig.parts.recipeMechanismRotor,
            ),
          },
          renderStats: {
            calls: renderer.renderer.info.render.calls,
            triangles: renderer.renderer.info.render.triangles,
          },
        };
      },
      {
        fixture,
        fixtureId: fixtureIds[fixture.key],
        elapsed: 2.1 + index * 0.37,
        mechanismToken:
          fixture.recipe === null
            ? null
            : MECHANISM_TOKEN_BY_RECIPE[fixture.recipe],
      },
    );

    assert(
      proof.renderContract.processState === fixture.state,
      `${fixture.key}: render state ${proof.renderContract.processState} != ${fixture.state}.`,
    );
    assert(
      proof.signal.state === fixture.state,
      `${fixture.key}: signal state ${proof.signal.state} != ${fixture.state}.`,
    );
    assert(
      proof.signal.primaryCount === 1,
      `${fixture.key}: expected exactly one primary signal, got ${proof.signal.primaryCount}.`,
    );
    assert(
      proof.signal.primarySignature === fixture.expectedSignature,
      `${fixture.key}: primary signature ${proof.signal.primarySignature} != ${fixture.expectedSignature}.`,
    );
    assert(
      proof.signal.primaryPort === fixture.expectedPort,
      `${fixture.key}: primary port ${proof.signal.primaryPort} != ${fixture.expectedPort}.`,
    );
    assert(
      proof.signal.fixedWitness.count === 1
        && proof.signal.fixedWitness.state === fixture.state
        && proof.signal.fixedWitness.rootAttached
        && JSON.stringify(proof.signal.fixedWitness.rootPosition)
          === JSON.stringify([-0.44, 1.08, -0.34]),
      `${fixture.key}: fixed state witness is false (${JSON.stringify(proof.signal.fixedWitness)}).`,
    );
    const expectedRecipeX = fixture.pendingRecipe ? 0.285 : 0.44;
    assert(
      proof.signal.fixedRecipeStation.rootAttached
        && proof.signal.fixedRecipeStation.pendingRootAttached
        && JSON.stringify(proof.signal.fixedRecipeStation.rootPosition)
          === JSON.stringify([expectedRecipeX, 0.946, -0.34])
        && JSON.stringify(proof.signal.fixedRecipeStation.plaquePosition)
          === JSON.stringify([expectedRecipeX, 0.84, -0.34])
        && JSON.stringify(proof.signal.fixedRecipeStation.pendingRootPosition)
          === JSON.stringify([0.595, 0.946, -0.34])
        && expectedRecipeX - (-0.44) >= 0.72,
      `${fixture.key}: fixed recipe/state channel separation is false (${JSON.stringify(proof.signal.fixedRecipeStation)}).`,
    );
    assert(
      proof.signal.recipeSignature === fixture.expectedRecipeSignature,
      `${fixture.key}: recipe signature ${proof.signal.recipeSignature} != ${fixture.expectedRecipeSignature}.`,
    );
    assert(
      proof.signal.recipeIdentity === (
        fixture.recipe === null ? null : fixture.recipe
      ),
      `${fixture.key}: recipe identity ${proof.signal.recipeIdentity} is false.`,
    );
    assert(
      proof.signal.recipeVisible === (fixture.recipe !== null),
      `${fixture.key}: recipe visibility is false for its authority.`,
    );
    const expectsReclaim = Boolean(fixture.reclaim);
    assert(
      proof.signal.reclaimVisible === expectsReclaim,
      `${fixture.key}: reclaim visibility is false for its authority.`,
    );
    assert(
      proof.signal.reclaimSignature
        === "side-scrap-tray-separated-extraction-claw"
        && proof.signal.reclaimPort === "reclaim",
      `${fixture.key}: reclaim hardware signature/port is false.`,
    );
    assert(
      proof.renderContract.reclaimCount
        === proof.authoritative.reclaimCount
        && proof.signal.reclaimCount
          === proof.authoritative.reclaimCount,
      `${fixture.key}: reclaim count drifted across simulation/render/signal.`,
    );
    assert(
      proof.signal.pendingRecipe === (fixture.pendingRecipe ?? null),
      `${fixture.key}: pending recipe signal is false.`,
    );
    assert(
      proof.signal.pendingRecipeIdentity === (fixture.pendingRecipe ?? null)
        && proof.signal.pendingRecipeSignature
          === (fixture.expectedPendingRecipeSignature ?? null)
        && proof.signal.pendingRecipeVisible
          === Boolean(fixture.pendingRecipe),
      `${fixture.key}: pending die identity is false (${JSON.stringify({
        identity: proof.signal.pendingRecipeIdentity,
        signature: proof.signal.pendingRecipeSignature,
        visible: proof.signal.pendingRecipeVisible,
      })}).`,
    );
    assert(
      proof.signal.physicallyAttached,
      `${fixture.key}: signal root is not physically attached.`,
    );
    assert(
      proof.signal.quaternionDot > 0.99999
        && proof.signal.forwardDot > 0.99999,
      `${fixture.key}: signal rotation drifted (${proof.signal.quaternionDot}/${proof.signal.forwardDot}).`,
    );
    if (fixture.recipe !== null) {
      assert(
        proof.signal.glyphPixels.width >= 18
          && proof.signal.glyphPixels.height >= 12,
        `${fixture.key}: recipe glyph is not gameplay-readable (${JSON.stringify(proof.signal.glyphPixels)}).`,
      );
      const expectsVisibleProduct =
        fixture.state === "working"
        || fixture.state === "queued"
        || fixture.state === "output-blocked";
      assert(
        proof.mechanical.mechanismToken
          === MECHANISM_TOKEN_BY_RECIPE[fixture.recipe]
          && proof.mechanical.mechanismCount >= 3
          && proof.mechanical.toolingRecipe === fixture.recipe
          && proof.mechanical.localizedWear
            ?.endsWith("-localized-process-wear")
          && proof.mechanical.productChildren >= 1
          && proof.mechanical.productAttached
          && proof.mechanical.productVisible === expectsVisibleProduct
          && proof.mechanical.actuationName
          && proof.mechanical.actuationAttached,
        `${fixture.key}: recipe-specific chamber/product/actuation/wear proof is false (${JSON.stringify(proof.mechanical)}).`,
      );
    }

    const path = `${OUTPUT_DIRECTORY}/${String(index + 1).padStart(2, "0")}-${fixture.key}.png`;
    const buffer = await page.screenshot({
      path,
      clip: {
        x: canvasBox.x + canvasBox.width * 0.5 - FRAME_WIDTH * 0.5,
        y: canvasBox.y + canvasBox.height * 0.5 - FRAME_HEIGHT * 0.58,
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
      },
    });
    captures.push({
      key: fixture.key,
      path,
      dataURL: `data:image/png;base64,${buffer.toString("base64")}`,
    });
    proofs.push(proof);
  }

  const denseSetup = await page.evaluate((fixtures) => {
    const renderer = window.__CINDERLINE__?.renderer;
    const qa = renderer?.__processWorldQA;
    if (!renderer || !qa) {
      throw new Error("Process-world dense-context bridge unavailable.");
    }
    qa.targetId = null;
    qa.holdSnapshot = true;
    qa.exactSnapshot = renderer.snapshot;
    // Keep the exact isolated truth captures above unchanged, then challenge
    // the same eleven states inside a compact production floor. Dense-facing
    // fabricators use their two-tile depth so every transfer arm retains a
    // genuine one-tile source and destination.
    const processPlacements = {
      "unconfigured": { x: 6, z: 6, direction: 0 },
      "blocked-copper-smelt": { x: 12, z: 6, direction: 2 },
      "working-copper-wire": { x: 15, z: 6, direction: 2 },
      "auto-smelt": { x: 20, z: 6, direction: 0 },
      "queued-circuit-to-core": { x: 7, z: 11, direction: 2 },
      "reclaim-fire-brick": { x: 12, z: 11, direction: 3 },
      "starved-iron-gear": { x: 15, z: 11, direction: 0 },
      "working-automation-core": { x: 19, z: 11, direction: 2 },
      "explicit-iron-smelt": { x: 6, z: 16, direction: 3 },
      "no-power-circuit": { x: 10, z: 16, direction: 0 },
      "idle-ready-gear": { x: 15, z: 16, direction: 2 },
    };
    const footprints = {
      belt: [1, 1],
      manifold: [1, 2],
      extractor: [2, 2],
      inserter: [1, 1],
      smelter: [2, 2],
      fabricator: [3, 2],
      generator: [2, 2],
      storage: [2, 2],
      beacon: [2, 2],
      gridRelay: [1, 1],
    };
    const footprint = (entity) => {
      const size = footprints[entity.kind];
      if (!size) throw new Error(`Unsupported dense entity ${entity.kind}.`);
      const direction = ((entity.direction ?? 0) % 4 + 4) % 4;
      return direction % 2 === 1
        ? { width: size[1], height: size[0] }
        : { width: size[0], height: size[1] };
    };
    const occupied = new Map();
    const occupy = (entity) => {
      const size = footprint(entity);
      for (let dz = 0; dz < size.height; dz += 1) {
        for (let dx = 0; dx < size.width; dx += 1) {
          const key = `${entity.x + dx},${entity.z + dz}`;
          const previous = occupied.get(key);
          if (previous) {
            throw new Error(
              `Dense fixture collision at ${key}: ${previous.id}/${entity.id}.`,
            );
          }
          occupied.set(key, entity);
        }
      }
      return entity;
    };

    const processEntities = fixtures.map((fixture) => {
      const placement = processPlacements[fixture.key];
      if (!placement) {
        throw new Error(`Dense placement ${fixture.key} is missing.`);
      }
      const processRecipe =
        fixture.recipe === null ? undefined : fixture.recipe;
      return occupy({
        id: qa.ids[fixture.key],
        kind: fixture.kind,
        ...placement,
        active: fixture.state === "working" || fixture.state === "queued",
        powered: fixture.state !== "no-power",
        progress: fixture.progress ?? 0.42,
        status:
          fixture.state === "output-blocked"
            ? "blocked"
            : fixture.state === "no-power"
              ? "unpowered"
              : fixture.state === "working" || fixture.state === "queued"
                ? "working"
                : "idle",
        health: 1,
        recipe:
          processRecipe === "auto" ? undefined : processRecipe,
        processState: fixture.state,
        processRecipe,
        pendingRecipe: fixture.pendingRecipe,
        reclaimCount: fixture.reclaim
          ? Object.values(fixture.reclaim).reduce(
              (sum, amount) => sum + (amount ?? 0),
              0,
            )
          : 0,
      });
    });

    const contextEntities = [];
    const beltItems = [];
    const addContext = (entity) => {
      contextEntities.push(occupy(entity));
      return entity;
    };
    const recipeCargo = {
      ironGear: ["ironPlate", "ironGear"],
      copperWire: ["copperPlate", "copperWire"],
      circuit: ["copperWire", "ironPlate", "circuit"],
      automationCore: ["ironGear", "circuit", "automationCore"],
      smeltIron: ["ironOre", "ironPlate"],
      smeltCopper: ["copperOre", "copperPlate"],
      fireBrick: ["stone", "fireBrick"],
      auto: ["ironOre", "copperOre", "ironPlate", "copperPlate"],
    };
    let inserterIndex = 0;
    for (const process of processEntities) {
      const size = footprint(process);
      const portOffsets =
        process.kind === "fabricator" ? [0, size.width - 1] : [0];
      const itemCycle =
        recipeCargo[process.processRecipe]
        ?? ["ironPlate", "copperPlate", "circuit"];
      for (const [portIndex, offsetX] of portOffsets.entries()) {
        for (const [side, z] of [
          ["input", process.z - 1],
          ["output", process.z + size.height],
        ]) {
          const itemOffset =
            inserterIndex + portIndex + (side === "output" ? 1 : 0);
          addContext({
            id: `dense-inserter-${inserterIndex}`,
            kind: "inserter",
            x: process.x + offsetX,
            z,
            direction: 2,
            active: true,
            powered: true,
            progress: 0.18 + (inserterIndex % 6) * 0.13,
            status: "working",
            pickupContact: [0, 0.76],
            dropContact: [0, -0.76],
            health: 1,
            carriedItem: itemCycle[itemOffset % itemCycle.length],
          });
          inserterIndex += 1;
        }
      }
    }

    const relays = [
      { id: "dense-relay-a", x: 4, z: 6, relayId: 501 },
      { id: "dense-relay-b", x: 4, z: 12, relayId: 502 },
      { id: "dense-relay-c", x: 4, z: 18, relayId: 503 },
      { id: "dense-relay-d", x: 11, z: 5, relayId: 504 },
      { id: "dense-relay-e", x: 10, z: 20, relayId: 505 },
      { id: "dense-relay-f", x: 18, z: 5, relayId: 506 },
      { id: "dense-relay-g", x: 17, z: 20, relayId: 507 },
      { id: "dense-relay-h", x: 24, z: 5, relayId: 508 },
      { id: "dense-relay-i", x: 24, z: 11, relayId: 509 },
      { id: "dense-relay-j", x: 23, z: 17, relayId: 510 },
      { id: "dense-relay-k", x: 11, z: 11, relayId: 511 },
      { id: "dense-relay-l", x: 18, z: 11, relayId: 512 },
      { id: "dense-relay-m", x: 18, z: 17, relayId: 513 },
    ].map((relay) => {
      addContext({
        id: relay.id,
        kind: "gridRelay",
        x: relay.x,
        z: relay.z,
        direction: 0,
        active: false,
        powered: true,
        progress: 0,
        status: "idle",
        health: 1,
        powerRelayId: relay.relayId,
        powerNetworkId: 77,
      });
      return relay;
    });
    const relayLinks = [
      [501, 502],
      [502, 503],
      [501, 504],
      [504, 506],
      [506, 508],
      [508, 509],
      [509, 510],
      [503, 505],
      [505, 507],
      [507, 510],
      [502, 511],
      [504, 511],
      [511, 512],
      [506, 512],
      [512, 513],
      [513, 507],
      [513, 510],
    ].map(([relayAId, relayBId]) => ({ relayAId, relayBId }));

    for (const entity of [
      {
        id: "dense-storage-a",
        kind: "storage",
        x: 22,
        z: 6,
        direction: 0,
        active: true,
        powered: true,
        progress: 0.31,
        status: "idle",
        health: 1,
      },
      {
        id: "dense-generator-a",
        kind: "generator",
        x: 26,
        z: 6,
        direction: 1,
        active: true,
        powered: true,
        progress: 0.36,
        status: "working",
        health: 1,
      },
      {
        id: "dense-beacon-a",
        kind: "beacon",
        x: 25,
        z: 11,
        direction: 0,
        active: true,
        powered: true,
        progress: 0.63,
        status: "working",
        health: 1,
      },
      {
        id: "dense-storage-b",
        kind: "storage",
        x: 27,
        z: 11,
        direction: 3,
        active: true,
        powered: true,
        progress: 0.52,
        status: "idle",
        health: 1,
      },
      {
        id: "dense-beacon-b",
        kind: "beacon",
        x: 19,
        z: 16,
        direction: 2,
        active: true,
        powered: true,
        progress: 0.77,
        status: "working",
        health: 1,
      },
      {
        id: "dense-storage-c",
        kind: "storage",
        x: 25,
        z: 16,
        direction: 0,
        active: true,
        powered: true,
        progress: 0.24,
        status: "idle",
        health: 1,
      },
      {
        id: "dense-generator-b",
        kind: "generator",
        x: 27,
        z: 16,
        direction: 3,
        active: true,
        powered: true,
        progress: 0.68,
        status: "working",
        health: 1,
      },
    ]) {
      addContext(entity);
    }

    // Four connected conveyor passes form one deterministic snake. Corner
    // direction changes exercise the renderer's real left/right belt meshes.
    const beltCells = new Map();
    const setBelt = (x, z, direction) => {
      beltCells.set(`${x},${z}`, { x, z, direction });
    };
    for (let x = 5; x <= 29; x += 1) setBelt(x, 4, 1);
    setBelt(29, 4, 2);
    for (let z = 5; z <= 9; z += 1) setBelt(29, z, 2);
    setBelt(29, 9, 3);
    for (let x = 28; x >= 5; x -= 1) setBelt(x, 9, 3);
    setBelt(5, 9, 2);
    for (let z = 10; z <= 14; z += 1) setBelt(5, z, 2);
    setBelt(5, 14, 1);
    for (let x = 6; x <= 29; x += 1) setBelt(x, 14, 1);
    setBelt(29, 14, 2);
    for (let z = 15; z <= 19; z += 1) setBelt(29, z, 2);
    setBelt(29, 19, 3);
    for (let x = 28; x >= 5; x -= 1) setBelt(x, 19, 3);

    for (const [index, belt] of [...beltCells.values()].entries()) {
      addContext({
        id: `dense-belt-${index}`,
        kind: "belt",
        ...belt,
        active: true,
        powered: true,
        progress: (index * 0.137) % 1,
        status: "working",
        health: 1,
      });
    }

    // Every conveyor carrier gets both physical lanes. Progress is omitted so
    // stable IDs move deterministically with the elapsed time used per capture.
    const itemKinds = [
      "ironPlate",
      "copperPlate",
      "circuit",
      "copperWire",
      "automationCore",
    ];
    const cargoCarriers = [
      ...[...beltCells.values()].map((belt, index) => ({
        id: `belt-${index}`,
        carrier: "belt",
        ...belt,
      })),
    ];
    for (const [carrierIndex, carrier] of cargoCarriers.entries()) {
      for (const [laneIndex, lane] of [-1, 1].entries()) {
        beltItems.push({
          id: `dense-item-${carrier.id}-${laneIndex}`,
          kind:
            itemKinds[
              (carrierIndex * 3 + laneIndex * 2) % itemKinds.length
            ],
          x: carrier.x,
          z: carrier.z,
          direction: carrier.direction,
          lane,
          carrier: carrier.carrier,
        });
      }
    }

    const relayById = new Map(relays.map((relay) => [relay.relayId, relay]));
    const nearestRelay = (entity) => {
      const size = footprint(entity);
      const x = entity.x + size.width * 0.5;
      const z = entity.z + size.height * 0.5;
      return relays
        .map((relay) => ({
          relay,
          deltaX: Math.abs(x - (relay.x + 0.5)),
          deltaZ: Math.abs(z - (relay.z + 0.5)),
          distance: Math.hypot(x - (relay.x + 0.5), z - (relay.z + 0.5)),
        }))
        .filter(({ deltaX, deltaZ }) => deltaX <= 5 && deltaZ <= 5)
        .sort(
          (left, right) =>
            left.distance - right.distance
            || left.relay.relayId - right.relay.relayId,
        )[0];
    };
    for (const entity of [...processEntities, ...contextEntities]) {
      if (
        entity.kind === "belt"
        || entity.kind === "manifold"
        || entity.kind === "storage"
        || entity.kind === "gridRelay"
        || !entity.powered
      ) {
        continue;
      }
      const assignment = nearestRelay(entity);
      if (!assignment) {
        throw new Error(`Dense power assignment missed ${entity.id}.`);
      }
      entity.powerRelayId = assignment.relay.relayId;
      entity.powerNetworkId = 77;
    }

    const directions = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];
    const transferable = new Set([
      "belt",
      "manifold",
      "smelter",
      "fabricator",
      "storage",
    ]);
    const attachedInserters = contextEntities.filter((entity) => {
      if (entity.kind !== "inserter") return false;
      const [dx, dz] = directions[entity.direction ?? 0];
      const source = occupied.get(`${entity.x - dx},${entity.z - dz}`);
      const target = occupied.get(`${entity.x + dx},${entity.z + dz}`);
      return transferable.has(source?.kind) && transferable.has(target?.kind);
    });

    const denseSnapshot = {
      tick: 540,
      elapsed: 9,
      bounds: { minX: 3, minZ: 3, maxX: 31, maxZ: 21 },
      entities: [...processEntities, ...contextEntities],
      resources: [],
      beltItems,
      powerGrid: {
        mode: "local",
        halfExtent: 5,
        cableReach: 7.5,
        relayCenters: relays.map((relay) => ({
          relayId: relay.relayId,
          x: relay.x + 0.5,
          z: relay.z + 0.5,
          networkId: 77,
        })),
        relayLinks,
      },
    };
    qa.denseSnapshot = denseSnapshot;
    qa.originalSync(denseSnapshot);
    for (const rig of renderer.entityObjects.values()) rig.root.visible = true;
    renderer.infrastructureRoot.visible = true;
    renderer.resourceRoot.visible = false;
    renderer.itemRoot.visible = true;
    renderer.effectsRoot.visible = true;
    renderer.overlayRoot.visible = false;
    renderer.focus(17, 11.75);
    renderer.viewWidth = 31.5;
    renderer.resize();
    qa.originalUpdate(0, 9);
    qa.originalRender(0);
    renderer.renderer.getContext().finish();

    const kindCounts = {};
    for (const entity of denseSnapshot.entities) {
      kindCounts[entity.kind] = (kindCounts[entity.kind] ?? 0) + 1;
    }
    const turnCounts = { left: 0, right: 0 };
    for (const rig of renderer.entityObjects.values()) {
      if (rig.kind !== "belt") continue;
      if (rig.parts.beltTurn === "left") turnCounts.left += 1;
      if (rig.parts.beltTurn === "right") turnCounts.right += 1;
    }
    const occupiedCells = [...occupied.keys()].map((key) =>
      key.split(",").map(Number)
    );
    const cargoKinds = new Set(beltItems.map(({ kind }) => kind));
    const laneCounts = {
      negative: beltItems.filter(({ lane }) => lane === -1).length,
      positive: beltItems.filter(({ lane }) => lane === 1).length,
    };
    const authoredVisible = processEntities.filter((entity) => {
      const root = renderer.entityObjects.get(entity.id)?.parts.processSignalRoot;
      if (!root) return false;
      let current = root;
      while (current) {
        if (!current.visible) return false;
        current = current.parent;
      }
      return true;
    }).length;
    const linkDegree = new Map(relays.map(({ relayId }) => [relayId, 0]));
    const validPowerLinks = relayLinks.every(({ relayAId, relayBId }) => {
      const relayA = relayById.get(relayAId);
      const relayB = relayById.get(relayBId);
      if (!relayA || !relayB) return false;
      linkDegree.set(relayAId, (linkDegree.get(relayAId) ?? 0) + 1);
      linkDegree.set(relayBId, (linkDegree.get(relayBId) ?? 0) + 1);
      return Math.hypot(relayA.x - relayB.x, relayA.z - relayB.z) <= 7.5;
    });
    return {
      ids: Object.fromEntries(
        fixtures.map((fixture) => [fixture.key, qa.ids[fixture.key]]),
      ),
      proof: {
        processCount: processEntities.length,
        kindCounts,
        occupiedCells: occupied.size,
        compactSpan: {
          x: Math.max(...occupiedCells.map(([x]) => x))
            - Math.min(...occupiedCells.map(([x]) => x))
            + 1,
          z: Math.max(...occupiedCells.map(([, z]) => z))
            - Math.min(...occupiedCells.map(([, z]) => z))
            + 1,
        },
        inserters: {
          total: contextEntities.filter(({ kind }) => kind === "inserter").length,
          attached: attachedInserters.length,
        },
        belts: {
          total: kindCounts.belt ?? 0,
          turns: turnCounts,
          manifolds: kindCounts.manifold ?? 0,
        },
        cargo: {
          total: beltItems.length,
          kinds: [...cargoKinds].sort(),
          laneCounts,
          proceduralMotion: beltItems.every(
            ({ progress }) => progress === undefined,
          ),
        },
        power: {
          mode: denseSnapshot.powerGrid.mode,
          relays: relays.length,
          links: relayLinks.length,
          activeGridLinks: renderer.powerGridRoot.userData.linkCount ?? 0,
          cableInstances: renderer.powerGridBatches.cables.count,
          validLinks: validPowerLinks,
          maxLinkDegree: Math.max(...linkDegree.values()),
        },
        viewWidth: renderer.viewWidth,
        overviewLOD: renderer.processSignalOverviewLOD,
        authoredVisible,
      },
    };
  }, FIXTURES);

  assert(
    denseSetup.proof.processCount === FIXTURES.length
      && denseSetup.proof.compactSpan.x <= 27
      && denseSetup.proof.compactSpan.z <= 17
      && denseSetup.proof.kindCounts.generator === 2
      && denseSetup.proof.kindCounts.storage === 3
      && denseSetup.proof.kindCounts.beacon === 2,
    `Dense factory composition is not compact/complete: ${JSON.stringify(denseSetup.proof)}.`,
  );
  assert(
    denseSetup.proof.inserters.total >= 32
      && denseSetup.proof.inserters.attached
        === denseSetup.proof.inserters.total
      && denseSetup.proof.belts.turns.left
        + denseSetup.proof.belts.turns.right >= 6,
    `Dense factory transfer topology is false: ${JSON.stringify(denseSetup.proof)}.`,
  );
  assert(
    denseSetup.proof.cargo.total >= 190
      && denseSetup.proof.cargo.kinds.length === 5
      && denseSetup.proof.cargo.laneCounts.negative
        === denseSetup.proof.cargo.laneCounts.positive
      && denseSetup.proof.cargo.proceduralMotion,
    `Dense factory cargo proof is false: ${JSON.stringify(denseSetup.proof.cargo)}.`,
  );
  assert(
    denseSetup.proof.power.mode === "local"
      && denseSetup.proof.power.relays === 13
      && denseSetup.proof.power.links === 17
      && denseSetup.proof.power.activeGridLinks === 17
      && denseSetup.proof.power.cableInstances >= 102
      && denseSetup.proof.power.validLinks
      && denseSetup.proof.power.maxLinkDegree <= 5
      && !denseSetup.proof.overviewLOD
      && denseSetup.proof.authoredVisible === FIXTURES.length,
    `Dense factory power/detail proof is false: ${JSON.stringify(denseSetup.proof)}.`,
  );

  const denseOverviewPath = `${OUTPUT_DIRECTORY}/dense-context-overview.png`;
  await page.screenshot({ path: denseOverviewPath });
  const denseCaptures = [];
  for (const [index, fixture] of FIXTURES.entries()) {
    await page.evaluate(
      ({ fixtureId, elapsed }) => {
        const renderer = window.__CINDERLINE__?.renderer;
        const qa = renderer?.__processWorldQA;
        const rig = renderer?.entityObjects.get(fixtureId);
        if (!renderer || !qa || !rig) {
          throw new Error(`Dense target ${String(fixtureId)} disappeared.`);
        }
        for (const candidate of renderer.entityObjects.values()) {
          candidate.root.visible = true;
        }
        qa.originalUpdate(0, elapsed);
        renderer.focus(rig.root.position.x, rig.root.position.z);
        renderer.viewWidth = 22;
        renderer.resize();
        qa.originalRender(0);
        renderer.renderer.getContext().finish();
      },
      {
        fixtureId: denseSetup.ids[fixture.key],
        elapsed: 9.2 + index * 0.11,
      },
    );
    const path =
      `${OUTPUT_DIRECTORY}/dense-${String(index + 1).padStart(2, "0")}-${fixture.key}.png`;
    const buffer = await page.screenshot({
      path,
      clip: {
        x: canvasBox.x + canvasBox.width * 0.5 - FRAME_WIDTH * 0.5,
        y: canvasBox.y + canvasBox.height * 0.5 - FRAME_HEIGHT * 0.58,
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
      },
    });
    denseCaptures.push({
      key: fixture.key,
      path,
      dataURL: `data:image/png;base64,${buffer.toString("base64")}`,
    });
  }

  const representativeProof = await page.evaluate(() => {
    const renderer = window.__CINDERLINE__?.renderer;
    const qa = renderer?.__processWorldQA;
    if (!renderer || !qa) {
      throw new Error("Representative production-chain bridge unavailable.");
    }
    qa.targetId = null;
    qa.holdSnapshot = true;
    renderer.setSelected(null);
    renderer.setHovered(null, null);
    if (renderer.quality !== "high") renderer.toggleQuality();

    const entities = [];
    const belts = [];
    const inserters = [];
    const processMachines = [];
    const relayPlacements = [
      [3, 3],
      [9, 3],
      [15, 3],
      [21, 3],
      [27, 3],
      [9, 11],
      [15, 11],
      [21, 11],
    ];
    const relays = relayPlacements.map(([x, z], index) => ({
      id: `chain-relay-${index + 1}`,
      kind: "gridRelay",
      x,
      z,
      direction: 0,
      active: false,
      powered: true,
      progress: 0,
      status: "idle",
      health: 1,
      powerRelayId: 801 + index,
      powerNetworkId: 91,
    }));
    const nearestRelayId = (x, z) => {
      const nearest = relays
        .map((relay) => ({
          relay,
          distance: Math.hypot(
            x - (relay.x + 0.5),
            z - (relay.z + 0.5),
          ),
        }))
        .sort((left, right) =>
          left.distance - right.distance
          || left.relay.powerRelayId - right.relay.powerRelayId
        )[0];
      return nearest.relay.powerRelayId;
    };
    const powered = (
      entity,
      centerX = entity.x + 0.5,
      centerZ = entity.z + 0.5,
    ) => ({
      ...entity,
      powered: true,
      health: 1,
      powerRelayId: nearestRelayId(centerX, centerZ),
      powerNetworkId: 91,
    });
    const addBelt = (x, cargoKind, cargoProgress, lane = -1) => {
      const belt = {
        id: `chain-belt-${x}`,
        kind: "belt",
        x,
        z: 7,
        direction: 1,
        active: true,
        powered: true,
        progress: (x * 0.173) % 1,
        status: "working",
        health: 1,
      };
      belts.push(belt);
      entities.push(belt);
      return {
        id: `chain-cargo-${x}`,
        kind: cargoKind,
        x,
        z: 7,
        direction: 1,
        lane,
        progress: cargoProgress,
        carrier: "belt",
      };
    };
    const addInserter = (
      id,
      x,
      carriedItem,
      progress,
    ) => {
      const inserter = powered({
        id,
        kind: "inserter",
        x,
        z: 7,
        direction: 1,
        active: true,
        progress,
        status: "working",
        pickupContact: [0, 0.8],
        dropContact: [0, -0.8],
        carriedItem,
      });
      inserters.push(inserter);
      entities.push(inserter);
      return inserter;
    };
    const addProcess = (
      id,
      kind,
      x,
      recipe,
      progress,
    ) => {
      const machine = powered(
        {
          id,
          kind,
          x,
          z: 6,
          direction: 1,
          active: true,
          progress,
          status: "working",
          recipe,
          processState: "working",
          processRecipe: recipe,
          reclaimCount: 0,
        },
        x + (kind === "fabricator" ? 1.5 : 1),
      );
      processMachines.push(machine);
      entities.push(machine);
      return machine;
    };

    const extractor = powered(
      {
        id: "chain-extractor",
        kind: "extractor",
        x: 1,
        z: 6,
        direction: 1,
        active: true,
        progress: 0.58,
        status: "working",
      },
      2,
    );
    entities.push(extractor);
    addInserter("chain-transfer-ore-a", 3, "ironOre", 0.72);
    const beltItems = [
      addBelt(4, "ironOre", 0.52),
    ];
    addInserter("chain-transfer-ore-b", 5, "ironOre", 0.38);
    addProcess("chain-smelter", "smelter", 6, "smeltIron", 0.66);
    addInserter("chain-transfer-plate-a", 8, "ironPlate", 0.62);
    beltItems.push(addBelt(9, "ironPlate", 0.44, 1));
    addInserter("chain-transfer-plate-b", 10, "ironPlate", 0.31);
    addProcess("chain-gear-fabricator", "fabricator", 11, "ironGear", 0.73);
    addInserter("chain-transfer-gear-a", 13, "ironGear", 0.68);
    beltItems.push(addBelt(14, "ironGear", 0.48));
    addInserter("chain-transfer-gear-b", 15, "ironGear", 0.35);
    addProcess(
      "chain-core-fabricator",
      "fabricator",
      16,
      "automationCore",
      0.61,
    );
    addInserter("chain-transfer-core-a", 18, "automationCore", 0.64);
    beltItems.push(addBelt(19, "automationCore", 0.46, 1));
    addInserter("chain-transfer-core-b", 20, "automationCore", 0.34);

    const bufferStorage = powered(
      {
        id: "chain-shipment-buffer",
        kind: "storage",
        x: 21,
        z: 6,
        direction: 1,
        active: true,
        progress: 0.38,
        status: "working",
      },
      22,
    );
    entities.push(bufferStorage);
    addInserter("chain-transfer-shipment", 23, "automationCore", 0.74);
    beltItems.push(
      addBelt(24, "automationCore", 0.28),
      addBelt(25, "automationCore", 0.61, 1),
      addBelt(26, "automationCore", 0.93),
    );
    const uplink = powered(
      {
        id: "chain-uplink",
        kind: "storage",
        x: 27,
        z: 6,
        // Match the authoritative campaign depot: the engineered intake faces
        // the eastbound belt terminus immediately to its west.
        direction: 1,
        active: true,
        progress: 0.82,
        status: "working",
        uplink: true,
        uplinkCustodyManifest: [
          { kind: "automationCore", count: 3, target: 3 },
        ],
        uplinkCustodyCount: 3,
        uplinkTransferProgress: 1,
        uplinkTransferItem: "automationCore",
        uplinkTransferReturning: false,
        uplinkTransmissionActive: true,
      },
      28,
    );
    entities.push(uplink);

    const generator = powered(
      {
        id: "chain-generator",
        kind: "generator",
        x: 13,
        z: 11,
        direction: 1,
        active: true,
        progress: 0.57,
        status: "working",
      },
      14,
    );
    entities.push(generator, ...relays);

    const relayLinks = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [5, 6],
      [6, 7],
      [1, 5],
      [2, 6],
      [3, 7],
    ].map(([indexA, indexB]) => ({
      relayAId: relays[indexA].powerRelayId,
      relayBId: relays[indexB].powerRelayId,
    }));
    const resources = [
      [1, 6],
      [2, 6],
      [1, 7],
      [2, 7],
    ].map(([x, z], index) => ({
      x,
      z,
      kind: "iron",
      amount: 92 - index * 7,
      depleted: false,
    }));
    const representativeSnapshot = {
      tick: 720,
      elapsed: 14.4,
      bounds: { minX: 0, minZ: 0, maxX: 29, maxZ: 14 },
      entities,
      resources,
      beltItems,
      powerGrid: {
        mode: "local",
        halfExtent: 5,
        cableReach: 8.5,
        relayCenters: relays.map((relay) => ({
          relayId: relay.powerRelayId,
          x: relay.x + 0.5,
          z: relay.z + 0.5,
          networkId: 91,
        })),
        relayLinks,
      },
    };
    qa.representativeSnapshot = representativeSnapshot;
    qa.originalSync(representativeSnapshot);
    for (const rig of renderer.entityObjects.values()) rig.root.visible = true;
    renderer.infrastructureRoot.visible = true;
    renderer.resourceRoot.visible = true;
    renderer.itemRoot.visible = true;
    renderer.effectsRoot.visible = true;
    renderer.overlayRoot.visible = false;
    renderer.focus(14.5, 6.1);
    renderer.viewWidth = 29.5;
    renderer.resize();
    qa.originalUpdate(0, representativeSnapshot.elapsed);
    qa.originalRender(0);
    renderer.renderer.getContext().finish();

    const directions = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];
    const footprints = {
      belt: [1, 1],
      extractor: [2, 2],
      inserter: [1, 1],
      smelter: [2, 2],
      fabricator: [3, 2],
      generator: [2, 2],
      storage: [2, 2],
      gridRelay: [1, 1],
    };
    const occupied = new Map();
    for (const entity of entities) {
      const base = footprints[entity.kind];
      const width =
        (entity.direction ?? 0) % 2 === 1 ? base[1] : base[0];
      const height =
        (entity.direction ?? 0) % 2 === 1 ? base[0] : base[1];
      for (let dz = 0; dz < height; dz += 1) {
        for (let dx = 0; dx < width; dx += 1) {
          occupied.set(`${entity.x + dx},${entity.z + dz}`, entity);
        }
      }
    }
    const transferable = new Set([
      "extractor",
      "belt",
      "smelter",
      "fabricator",
      "storage",
    ]);
    const attachedInserters = inserters.filter((inserter) => {
      const [dx, dz] = directions[inserter.direction];
      const source = occupied.get(
        `${inserter.x - dx},${inserter.z - dz}`,
      );
      const target = occupied.get(
        `${inserter.x + dx},${inserter.z + dz}`,
      );
      return transferable.has(source?.kind) && transferable.has(target?.kind);
    });
    const uplinkRig = renderer.entityObjects.get(uplink.id);
    const canvasBounds = renderer.canvas.getBoundingClientRect();
    const Vector3 = renderer.camera.position.constructor;
    const projectedPoint = (id) => {
      const rig = renderer.entityObjects.get(id);
      if (!rig) return null;
      const point = rig.root.getWorldPosition(new Vector3());
      point.project(renderer.camera);
      return {
        x: canvasBounds.left + (point.x + 1) * canvasBounds.width * 0.5,
        y: canvasBounds.top + (-point.y + 1) * canvasBounds.height * 0.5,
      };
    };
    const firstX = projectedPoint(extractor.id)?.x ?? Number.NaN;
    const lastX = projectedPoint(uplink.id)?.x ?? Number.NaN;
    const stageOrder = [
      extractor.id,
      "chain-smelter",
      "chain-gear-fabricator",
      "chain-core-fabricator",
      bufferStorage.id,
      uplink.id,
    ];
    const stageScreenXs = stageOrder.map(
      (id) => projectedPoint(id)?.x ?? Number.NaN,
    );
    const stageGapRatios = stageScreenXs.slice(1).map(
      (x, index) =>
        Math.abs(x - stageScreenXs[index]) / canvasBounds.width,
    );
    const compositionPoints = [
      ...stageOrder,
      generator.id,
      ...relays.map(({ id }) => id),
    ].map(projectedPoint).filter(Boolean);
    const compositionMinX = Math.min(
      ...compositionPoints.map(({ x }) => x),
    );
    const compositionMaxX = Math.max(
      ...compositionPoints.map(({ x }) => x),
    );
    const compositionMinY = Math.min(
      ...compositionPoints.map(({ y }) => y),
    );
    const compositionMaxY = Math.max(
      ...compositionPoints.map(({ y }) => y),
    );
    const processSignalsVisible = processMachines.every((machine) => {
      const signalRoot =
        renderer.entityObjects.get(machine.id)?.parts.processSignalRoot;
      if (!signalRoot) return false;
      let current = signalRoot;
      while (current) {
        if (!current.visible) return false;
        current = current.parent;
      }
      return true;
    });
    const intakeThroat = uplinkRig?.root.getObjectByName(
      "commission-uplink-recessed-cargo-intake-throat",
    );
    const dockWorld = intakeThroat?.getWorldPosition(new Vector3()) ?? null;
    const finalCargo = beltItems.at(-1);
    const finalCargoWorld = finalCargo
      ? {
          x: finalCargo.x + finalCargo.progress,
          z: finalCargo.z + 0.5 + (finalCargo.lane ?? 0) * 0.17,
        }
      : null;
    return {
      evidenceClass: "deterministic-renderer-composition-fixture",
      authoritativeSimulation: false,
      claimScope:
        "Normal-zoom composition, readable handoffs, local-grid integration, and Uplink hardware only.",
      stageOrder,
      stageScreenXs,
      stageFlowMonotonic: stageScreenXs.every(
        (x, index) => index === 0 || x > stageScreenXs[index - 1],
      ),
      maximumStageGapRatio: Math.max(...stageGapRatios),
      screenSpan: {
        pixels: Math.abs(lastX - firstX),
        ratio: Math.abs(lastX - firstX) / canvasBounds.width,
      },
      screenFill: {
        widthPixels: compositionMaxX - compositionMinX,
        heightPixels: compositionMaxY - compositionMinY,
        widthRatio:
          (compositionMaxX - compositionMinX) / canvasBounds.width,
        heightRatio:
          (compositionMaxY - compositionMinY) / canvasBounds.height,
      },
      viewWidth: renderer.viewWidth,
      overviewLOD: renderer.processSignalOverviewLOD,
      entityCount: entities.length,
      belts: belts.length,
      inserters: {
        total: inserters.length,
        attached: attachedInserters.length,
      },
      processRecipes: processMachines.map((machine) => ({
        id: machine.id,
        recipe: machine.processRecipe,
        state: machine.processState,
        powered: machine.powered,
      })),
      cargoKinds: [...new Set(beltItems.map((item) => item.kind))],
      finalCargo: {
        kind: finalCargo?.kind ?? null,
        x: finalCargo?.x ?? null,
        progress: finalCargo?.progress ?? null,
        dockDistance:
          dockWorld && finalCargoWorld
            ? Math.hypot(
                dockWorld.x - finalCargoWorld.x,
                dockWorld.z - finalCargoWorld.z,
              )
            : null,
      },
      power: {
        relays: relays.length,
        links: relayLinks.length,
        renderedLinks: renderer.powerGridRoot.userData.linkCount ?? 0,
        cableInstances: renderer.powerGridBatches.cables.count,
        poweredConsumers: entities.filter(
          (entity) =>
            entity.kind !== "belt"
            && entity.kind !== "gridRelay"
            && entity.powered
            && entity.powerRelayId !== undefined,
        ).length,
      },
      processSignalsVisible,
      uplink: {
        variant: uplinkRig?.variant ?? null,
        intakeVisible: Boolean(
          uplinkRig?.root.getObjectByName(
            "commission-uplink-recessed-cargo-intake-throat",
          )?.visible,
        ),
        custodyVisible: Boolean(
          uplinkRig?.root.getObjectByName(
            "commission-uplink-midtone-keyed-custody-buffer",
          )?.visible,
        ),
        feedVisible: Boolean(uplinkRig?.parts.uplinkFeedPulse?.visible),
        transmissionActive:
          uplinkRig?.parts.uplinkFeedPulse?.userData.transmissionActive
            ?? false,
        visibleCustodyItems:
          (uplinkRig?.parts.uplinkCustodyItems ?? []).filter(
            (item) => item.visible,
          ).length,
        visibleCustodyKinds:
          (uplinkRig?.parts.uplinkCustodyItems ?? [])
            .filter((item) => item.visible)
            .map((item) => item.userData.itemKind),
        custodyCount:
          uplinkRig?.parts.uplinkCustodyMaterial?.userData.custodyCount
            ?? null,
        securedCustodyCount:
          uplinkRig?.parts.uplinkCustodyMaterial?.userData.securedCustodyCount
            ?? null,
        manifestReady:
          uplinkRig?.parts.uplinkCustodyMaterial?.userData.manifestReady
            ?? null,
        transferState:
          uplinkRig?.parts.uplinkTransferCarriage?.userData.mechanicalState
            ?? null,
        selectionIndicatorsHidden:
          (uplinkRig?.parts.uplinkSelectionIndicators ?? []).every(
            (indicator) => !indicator.visible,
          ),
      },
      render: {
        calls: renderer.renderer.info.render.calls,
        triangles: renderer.renderer.info.render.triangles,
      },
    };
  });

  assert(
    representativeProof.viewWidth <= 30
      && !representativeProof.overviewLOD
      && representativeProof.screenSpan.ratio >= 0.68
      && representativeProof.screenFill.widthRatio >= 0.72
      && representativeProof.screenFill.heightRatio >= 0.42
      && representativeProof.stageScreenXs.every(Number.isFinite)
      && representativeProof.stageFlowMonotonic
      && representativeProof.maximumStageGapRatio <= 0.24,
    `Representative chain is not screen-filling at gameplay zoom: ${JSON.stringify({
      span: representativeProof.screenSpan,
      fill: representativeProof.screenFill,
    })}.`,
  );
  assert(
    representativeProof.inserters.total === 9
      && representativeProof.inserters.attached === 9
      && representativeProof.belts === 7
      && representativeProof.processSignalsVisible,
    `Representative chain transfer topology is false: ${JSON.stringify(representativeProof)}.`,
  );
  assert(
    representativeProof.processRecipes.length === 3
      && representativeProof.processRecipes.every(
        ({ state, powered }) => state === "working" && powered,
      )
      && representativeProof.cargoKinds.includes("ironOre")
      && representativeProof.cargoKinds.includes("ironPlate")
      && representativeProof.cargoKinds.includes("ironGear")
      && representativeProof.cargoKinds.includes("automationCore")
      && representativeProof.finalCargo.kind === "automationCore"
      && representativeProof.finalCargo.x === 26
      && representativeProof.finalCargo.progress >= 0.9
      && representativeProof.finalCargo.dockDistance <= 0.25,
    `Representative chain product progression is false: ${JSON.stringify(representativeProof)}.`,
  );
  assert(
    representativeProof.power.relays === 8
      && representativeProof.power.links === 9
      && representativeProof.power.renderedLinks === 9
      && representativeProof.power.cableInstances >= 108
      && representativeProof.power.poweredConsumers >= 14,
    `Representative chain power integration is false: ${JSON.stringify(representativeProof.power)}.`,
  );
  assert(
    representativeProof.uplink.variant === "uplink"
      && representativeProof.uplink.intakeVisible
      && representativeProof.uplink.custodyVisible
      && representativeProof.uplink.feedVisible
      && representativeProof.uplink.transmissionActive
      && representativeProof.uplink.visibleCustodyItems === 1
      && representativeProof.uplink.visibleCustodyKinds.join("|")
        === "automationCore"
      && representativeProof.uplink.custodyCount === 3
      && representativeProof.uplink.securedCustodyCount === 3
      && representativeProof.uplink.manifestReady
      && representativeProof.uplink.transferState
        === "seated-inside-interlock"
      && representativeProof.uplink.selectionIndicatorsHidden,
    `Representative chain Uplink shipment hardware is false: ${JSON.stringify(representativeProof.uplink)}.`,
  );
  const representativeChainPath =
    `${OUTPUT_DIRECTORY}/representative-visual-composition-fixture.png`;
  await page.screenshot({ path: representativeChainPath });
  const representativeChainProofPath =
    `${OUTPUT_DIRECTORY}/representative-visual-composition-fixture-proof.json`;
  await writeFile(
    representativeChainProofPath,
    `${JSON.stringify(representativeProof, null, 2)}\n`,
  );

  await page.evaluate(() => {
    const renderer = window.__CINDERLINE__?.renderer;
    const qa = renderer?.__processWorldQA;
    if (!renderer || !qa?.exactSnapshot) {
      throw new Error("Process-world exact snapshot could not be restored.");
    }
    qa.originalSync(qa.exactSnapshot);
    qa.holdSnapshot = false;
    for (const rig of renderer.entityObjects.values()) rig.root.visible = true;
    renderer.infrastructureRoot.visible = false;
    renderer.resourceRoot.visible = false;
    renderer.effectsRoot.visible = false;
    renderer.overlayRoot.visible = false;
    qa.originalUpdate(0, 10.6);
    qa.originalRender(0);
    renderer.renderer.getContext().finish();
  });

  const autoLODProof = await page.evaluate((fixtures) => {
    const renderer = window.__CINDERLINE__?.renderer;
    const qa = renderer?.__processWorldQA;
    if (!renderer || !qa) {
      throw new Error("Process-world automatic LOD bridge unavailable.");
    }
    if (renderer.quality !== "high") renderer.toggleQuality();
    const batches = renderer.processSignalPerformance;
    const batchMeshes = [
      batches.plaques,
      batches.bars,
      batches.rings,
      batches.octahedra,
      batches.tokens,
    ];
    const fixtureIds = fixtures.map((fixture) => qa.ids[fixture.key]);
    const batchEntitySet = () =>
      new Set(
        Object.values(batches.entityIds).flat(),
      );
    const authoredSignature = (id) => {
      const rig = renderer.entityObjects.get(id);
      if (!rig?.parts.processSignalRoot) return null;
      return {
        state: rig.parts.processSignalRoot.userData.processState ?? null,
        stateSignature:
          rig.parts.processSignalRoot.userData.visiblePrimarySignature ?? null,
        statePort:
          rig.parts.processSignalRoot.userData.visiblePrimaryPort ?? null,
        recipe:
          rig.parts.processGlyphRoot?.userData.recipeIdentity ?? null,
        recipeSignature:
          rig.parts.processGlyphRoot?.userData.recipeSignature ?? null,
        pendingRecipe:
          rig.parts.processPendingGlyphRoot?.userData.recipeIdentity ?? null,
        pendingRecipeSignature:
          rig.parts.processPendingGlyphRoot?.userData.recipeSignature ?? null,
        pendingVisible:
          rig.parts.processPendingGlyphRoot?.visible ?? false,
        reclaim:
          (rig.parts.processReclaimBin?.userData.reclaimCount ?? 0) > 0,
        reclaimVisible: rig.parts.processReclaimBin?.visible ?? false,
      };
    };
    const snapshotStage = (label) => {
      const batchIds = batchEntitySet();
      const detailedIds = fixtureIds.filter(
        (id) =>
          renderer.entityObjects.get(id)?.parts.processSignalRoot?.visible,
      );
      return {
        label,
        viewWidth: renderer.viewWidth,
        overview: renderer.processSignalOverviewLOD,
        selectedId: renderer.selectedId,
        batchRootVisible: batches.root.visible,
        activeBatchDraws: batchMeshes.filter((mesh) => mesh.count > 0).length,
        memory: {
          geometries: renderer.renderer.info.memory.geometries,
          textures: renderer.renderer.info.memory.textures,
        },
        detailedIds,
        batchIds: fixtureIds.filter((id) => batchIds.has(id)),
        duplicateIds: detailedIds.filter((id) => batchIds.has(id)),
        signatures: fixtures.map((fixture) => ({
          key: fixture.key,
          id: qa.ids[fixture.key],
          ...(batches.signatures.get(qa.ids[fixture.key]) ?? {}),
        })),
      };
    };
    const setStage = (width, selectedId, elapsed, label) => {
      renderer.setSelected(selectedId);
      renderer.viewWidth = width;
      renderer.resize();
      qa.originalUpdate(0, elapsed);
      qa.originalRender(0);
      renderer.renderer.getContext().finish();
      return snapshotStage(label);
    };

    renderer.focus(17.5, 14);
    // Chromium only registers the five prebuilt overview batch geometries
    // with renderer.info after their first draw. Preflight one complete
    // overview→close cycle so the roundtrip assertion measures retained or
    // leaked memory, not Three's lazy first-use accounting.
    setStage(34, null, 10.7, "allocation-preflight-overview");
    setStage(30, null, 10.75, "allocation-preflight-close");
    const close = setStage(22, null, 10.8, "close");
    const entered = setStage(34, null, 10.9, "entered");
    const heldOverview = setStage(32, null, 11, "held-overview");
    const exited = setStage(30, null, 11.1, "exited");
    const heldClose = setStage(32, null, 11.2, "held-close");

    const queuedId = qa.ids["queued-circuit-to-core"];
    const reclaimId = qa.ids["reclaim-fire-brick"];
    const ironId = qa.ids["explicit-iron-smelt"];
    const selectedQueued = setStage(
      34,
      queuedId,
      11.3,
      "selected-queued",
    );
    const selectedQueuedAuthored = authoredSignature(queuedId);
    const selectedReclaim = setStage(
      34,
      reclaimId,
      11.4,
      "selected-reclaim",
    );
    const selectedReclaimAuthored = authoredSignature(reclaimId);

    const pickAtRig = (id) => {
      const rig = renderer.entityObjects.get(id);
      if (!rig) return null;
      const Vector3 = renderer.camera.position.constructor;
      const point = new Vector3(0, 0.5, 0);
      rig.root.localToWorld(point);
      point.project(renderer.camera);
      const bounds = renderer.canvas.getBoundingClientRect();
      return renderer.pickEntity(
        bounds.left + (point.x + 1) * bounds.width * 0.5,
        bounds.top + (-point.y + 1) * bounds.height * 0.5,
      );
    };
    const picks = {
      selected: {
        expected: reclaimId,
        actual: pickAtRig(reclaimId),
      },
      batched: {
        expected: ironId,
        actual: pickAtRig(ironId),
      },
    };

    const closeRoundtrip = setStage(30, null, 11.5, "close-roundtrip");
    const closeAuthored = fixtures.map((fixture) => ({
      key: fixture.key,
      id: qa.ids[fixture.key],
      ...authoredSignature(qa.ids[fixture.key]),
    }));
    const finalSelected = setStage(
      34,
      queuedId,
      11.6,
      "final-selected-overview",
    );

    return {
      thresholds: {
        enter: batches.root.userData.enterViewWidth,
        exit: batches.root.userData.exitViewWidth,
      },
      close,
      entered,
      heldOverview,
      exited,
      heldClose,
      selectedQueued,
      selectedQueuedAuthored,
      selectedReclaim,
      selectedReclaimAuthored,
      picks,
      closeRoundtrip,
      closeAuthored,
      finalSelected,
    };
  }, FIXTURES);

  assert(
    autoLODProof.thresholds.enter === 34
      && autoLODProof.thresholds.exit === 30
      && !autoLODProof.close.overview
      && !autoLODProof.close.batchRootVisible
      && autoLODProof.close.detailedIds.length === FIXTURES.length,
    `Automatic process LOD close mode is false: ${JSON.stringify(autoLODProof.close)}.`,
  );
  assert(
    autoLODProof.entered.overview
      && autoLODProof.entered.batchRootVisible
      && autoLODProof.entered.activeBatchDraws <= 5
      && autoLODProof.entered.detailedIds.length === 0
      && autoLODProof.entered.batchIds.length === FIXTURES.length
      && autoLODProof.entered.duplicateIds.length === 0,
    `Automatic process LOD overview mode is false: ${JSON.stringify(autoLODProof.entered)}.`,
  );
  assert(
    autoLODProof.heldOverview.overview
      && !autoLODProof.exited.overview
      && !autoLODProof.heldClose.overview,
    `Automatic process LOD hysteresis is false: ${JSON.stringify({
      heldOverview: autoLODProof.heldOverview,
      exited: autoLODProof.exited,
      heldClose: autoLODProof.heldClose,
    })}.`,
  );
  const assertBatchedSignatures = (stage, excludedKey = null) => {
    for (const fixture of FIXTURES) {
      const signature = stage.signatures.find(
        (candidate) => candidate.key === fixture.key,
      );
      if (fixture.key === excludedKey) {
        assert(
          signature
            && signature.state === undefined
            && !stage.batchIds.includes(signature.id),
          `${fixture.key}: selected authored signal was duplicated in ${stage.label}.`,
        );
        continue;
      }
      assert(
        signature?.state === fixture.state
          && signature.stateSignature === fixture.expectedSignature
          && signature.recipe === (fixture.recipe ?? null)
          && signature.recipeSignature === fixture.expectedRecipeSignature
          && signature.pendingRecipe === (fixture.pendingRecipe ?? null)
          && signature.pendingRecipeSignature
            === (fixture.expectedPendingRecipeSignature ?? null)
          && signature.reclaim === Boolean(fixture.reclaim),
        `${fixture.key}: ${stage.label} batch identity is false (${JSON.stringify(signature)}).`,
      );
    }
  };
  assertBatchedSignatures(autoLODProof.entered);
  assertBatchedSignatures(
    autoLODProof.selectedQueued,
    "queued-circuit-to-core",
  );
  assertBatchedSignatures(
    autoLODProof.selectedReclaim,
    "reclaim-fire-brick",
  );
  assert(
    autoLODProof.selectedQueued.detailedIds.length === 1
      && autoLODProof.selectedQueued.duplicateIds.length === 0
      && autoLODProof.selectedQueuedAuthored?.state === "queued"
      && autoLODProof.selectedQueuedAuthored.stateSignature
        === "static-current-to-pending-tool-bridge"
      && autoLODProof.selectedQueuedAuthored.statePort === "queue"
      && autoLODProof.selectedQueuedAuthored.recipe === "circuit"
      && autoLODProof.selectedQueuedAuthored.recipeSignature
        === "green-three-node-board-die"
      && autoLODProof.selectedQueuedAuthored.pendingRecipe
        === "automationCore"
      && autoLODProof.selectedQueuedAuthored.pendingRecipeSignature
        === "green-hex-cyan-rotor-core-die"
      && autoLODProof.selectedQueuedAuthored.pendingVisible
      && !autoLODProof.selectedQueuedAuthored.reclaim,
    `Selected queued machine lost authored semantics: ${JSON.stringify(autoLODProof.selectedQueuedAuthored)}.`,
  );
  assert(
    autoLODProof.selectedReclaim.detailedIds.length === 1
      && autoLODProof.selectedReclaim.duplicateIds.length === 0
      && autoLODProof.selectedReclaimAuthored?.state === "starved"
      && autoLODProof.selectedReclaimAuthored.stateSignature
        === "rear-amber-empty-hopper"
      && autoLODProof.selectedReclaimAuthored.statePort === "input"
      && autoLODProof.selectedReclaimAuthored.recipe === "fireBrick"
      && autoLODProof.selectedReclaimAuthored.recipeSignature
        === "five-brick-bond-die"
      && autoLODProof.selectedReclaimAuthored.reclaim
      && autoLODProof.selectedReclaimAuthored.reclaimVisible,
    `Selected reclaim machine lost authored semantics: ${JSON.stringify(autoLODProof.selectedReclaimAuthored)}.`,
  );
  assert(
    autoLODProof.picks.selected.actual
      === autoLODProof.picks.selected.expected
      && autoLODProof.picks.batched.actual
        === autoLODProof.picks.batched.expected,
    `Automatic LOD changed picking: ${JSON.stringify(autoLODProof.picks)}.`,
  );
  for (const fixture of FIXTURES) {
    const authored = autoLODProof.closeAuthored.find(
      (candidate) => candidate.key === fixture.key,
    );
    assert(
      authored?.state === fixture.state
        && authored.stateSignature === fixture.expectedSignature
        && authored.statePort === fixture.expectedPort
        && authored.recipe === (fixture.recipe ?? null)
        && authored.recipeSignature === fixture.expectedRecipeSignature
        && authored.pendingRecipe === (fixture.pendingRecipe ?? null)
        && authored.pendingRecipeSignature
          === (fixture.expectedPendingRecipeSignature ?? null)
        && authored.reclaim === Boolean(fixture.reclaim)
        && authored.reclaimVisible === Boolean(fixture.reclaim),
      `${fixture.key}: close→overview→close authored identity is false (${JSON.stringify(authored)}).`,
    );
  }
  assert(
    !autoLODProof.closeRoundtrip.overview
      && !autoLODProof.closeRoundtrip.batchRootVisible
      && autoLODProof.closeRoundtrip.detailedIds.length === FIXTURES.length
      && autoLODProof.closeRoundtrip.duplicateIds.length === 0
      && autoLODProof.entered.memory.geometries
        === autoLODProof.close.memory.geometries
      && autoLODProof.closeRoundtrip.memory.geometries
        === autoLODProof.close.memory.geometries
      && autoLODProof.entered.memory.textures
        === autoLODProof.close.memory.textures
      && autoLODProof.closeRoundtrip.memory.textures
        === autoLODProof.close.memory.textures,
    `Automatic process LOD close roundtrip is false: ${JSON.stringify({
      close: autoLODProof.close,
      entered: autoLODProof.entered,
      closeRoundtrip: autoLODProof.closeRoundtrip,
    })}.`,
  );
  const autoLODSelectedPath =
    `${OUTPUT_DIRECTORY}/auto-lod-overview-selected.png`;
  const autoLODSelectionProof = await page.evaluate(() => {
    const renderer = window.__CINDERLINE__?.renderer;
    const qa = renderer?.__processWorldQA;
    if (!renderer || !qa) {
      throw new Error("Process-world selection-outline bridge unavailable.");
    }
    qa.holdSnapshot = true;
    const gl = renderer.renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const baseline = new Uint8Array(width * height * 4);
    const selected = new Uint8Array(width * height * 4);
    renderer.hoverFrame.visible = false;
    renderer.ghostRoot.visible = false;
    qa.originalUpdate(0, 11.65);
    renderer.overlayRoot.visible = false;
    qa.originalRender(0);
    gl.finish();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, baseline);
    renderer.overlayRoot.visible = true;
    qa.originalRender(0);
    gl.finish();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, selected);
    let changedPixelCount = 0;
    let deltaSum = 0;
    let maxDelta = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      const delta = Math.max(
        Math.abs(selected[offset] - baseline[offset]),
        Math.abs(selected[offset + 1] - baseline[offset + 1]),
        Math.abs(selected[offset + 2] - baseline[offset + 2]),
      );
      if (delta < 12) continue;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      changedPixelCount += 1;
      deltaSum += delta;
      maxDelta = Math.max(maxDelta, delta);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const material = renderer.selectionHalo.material;
    return {
      overlayVisible: renderer.overlayRoot.visible,
      haloVisible: renderer.selectionHalo.visible,
      selectedId: renderer.selectedId,
      depthTest: material.depthTest,
      depthWrite: material.depthWrite,
      opacity: material.opacity,
      renderOrder: renderer.selectionHalo.renderOrder,
      pixelDelta: {
        changedPixelCount,
        meanPeakChannelDelta:
          changedPixelCount > 0 ? deltaSum / changedPixelCount : 0,
        maxPeakChannelDelta: maxDelta,
        width: maxX >= minX ? maxX - minX + 1 : 0,
        height: maxY >= minY ? maxY - minY + 1 : 0,
      },
    };
  });
  assert(
    autoLODSelectionProof.overlayVisible
      && autoLODSelectionProof.haloVisible
      && autoLODSelectionProof.selectedId
        === autoLODProof.finalSelected.selectedId
      && autoLODSelectionProof.depthTest === false
      && autoLODSelectionProof.depthWrite === false
      && autoLODSelectionProof.opacity >= 0.9
      && autoLODSelectionProof.renderOrder >= 1000,
    `Automatic process LOD selection outline is weak: ${JSON.stringify(autoLODSelectionProof)}.`,
  );
  assert(
    autoLODSelectionProof.pixelDelta.changedPixelCount >= 1_000
      && autoLODSelectionProof.pixelDelta.meanPeakChannelDelta >= 28
      && autoLODSelectionProof.pixelDelta.maxPeakChannelDelta >= 100
      && autoLODSelectionProof.pixelDelta.width >= 150
      && autoLODSelectionProof.pixelDelta.height >= 100,
    `Automatic process LOD selection outline is not measurably legible: ${JSON.stringify(autoLODSelectionProof.pixelDelta)}.`,
  );
  await page.screenshot({ path: autoLODSelectedPath });
  await page.evaluate(() => {
    const renderer = window.__CINDERLINE__?.renderer;
    const qa = renderer?.__processWorldQA;
    if (!renderer || !qa) {
      throw new Error("Process-world automatic LOD restore failed.");
    }
    renderer.overlayRoot.visible = false;
    qa.holdSnapshot = false;
    renderer.setSelected(null);
    renderer.viewWidth = 22;
    renderer.resize();
    qa.originalUpdate(0, 11.7);
    qa.originalRender(0);
    renderer.renderer.getContext().finish();
  });

  const selectedSignalCosts = await page.evaluate((fixtures) => {
    const renderer = window.__CINDERLINE__?.renderer;
    const qa = renderer?.__processWorldQA;
    if (!renderer || !qa) {
      throw new Error("Selected process-signal cost bridge unavailable.");
    }
    if (renderer.quality !== "high") renderer.toggleQuality();
    renderer.setSelected(null);
    renderer.viewWidth = 22;
    renderer.resize();
    qa.originalUpdate(0, 11.8);
    const gl = renderer.renderer.getContext();
    const directStats = () => {
      renderer.renderer.info.reset();
      renderer.renderer.render(renderer.scene, renderer.camera);
      gl.finish();
      return {
        calls: renderer.renderer.info.render.calls,
        triangles: renderer.renderer.info.render.triangles,
      };
    };
    const previousAutoReset = renderer.renderer.info.autoReset;
    renderer.renderer.info.autoReset = false;
    const costs = [];
    for (const fixture of fixtures) {
      const id = qa.ids[fixture.key];
      const root = renderer.entityObjects.get(id)?.parts.processSignalRoot;
      if (!root) throw new Error(`${fixture.key}: authored signal root missing.`);
      root.visible = false;
      const hidden = directStats();
      root.visible = true;
      const visible = directStats();
      let visibleMeshes = 0;
      root.traverse((object) => {
        if (!object.isMesh) return;
        let current = object;
        while (current && current !== root) {
          if (!current.visible) return;
          current = current.parent;
        }
        visibleMeshes += 1;
      });
      costs.push({
        key: fixture.key,
        state: fixture.state,
        recipe: fixture.recipe,
        hidden,
        visible,
        incrementalCalls: visible.calls - hidden.calls,
        incrementalTriangles: visible.triangles - hidden.triangles,
        visibleMeshes,
      });
    }

    const consoleRepresentative = costs.find(
      ({ key }) => key === "working-copper-wire",
    );
    const consoleRoot = renderer.entityObjects.get(
      qa.ids["working-copper-wire"],
    )?.parts.processSignalRoot;
    const timing = { hidden: [], visible: [] };
    if (consoleRoot && consoleRepresentative) {
      for (let sample = 0; sample < 30; sample += 1) {
        for (const visible of sample % 2 === 0
          ? [false, true]
          : [true, false]) {
          consoleRoot.visible = visible;
          const start = performance.now();
          directStats();
          timing[visible ? "visible" : "hidden"].push(
            performance.now() - start,
          );
        }
      }
      consoleRoot.visible = true;
    }
    renderer.renderer.info.autoReset = previousAutoReset;
    qa.originalRender(0);
    gl.finish();
    const summarize = (samples) => {
      const ordered = [...samples].sort((left, right) => left - right);
      return {
        medianMs: ordered[Math.floor(ordered.length * 0.5)] ?? 0,
        p95Ms: ordered[Math.floor(ordered.length * 0.95)] ?? 0,
        samples: ordered.length,
      };
    };
    return {
      costs,
      representativeTiming: {
        hidden: summarize(timing.hidden),
        visible: summarize(timing.visible),
      },
    };
  }, FIXTURES);
  assert(
    selectedSignalCosts.costs.length === FIXTURES.length
      && selectedSignalCosts.costs.every(
        ({ incrementalCalls, incrementalTriangles }) =>
          incrementalCalls > 0 && incrementalTriangles > 0,
      ),
    `Selected authored signal cost measurement is false: ${JSON.stringify(selectedSignalCosts)}.`,
  );

  const lodProof = await page.evaluate((fixtures) => {
    const renderer = window.__CINDERLINE__?.renderer;
    const qa = renderer?.__processWorldQA;
    if (!renderer || !qa) {
      throw new Error("Process-world LOD bridge unavailable.");
    }
    qa.targetId = null;
    if (renderer.quality !== "performance") renderer.toggleQuality();
    qa.originalUpdate(0, 8.4);
    renderer.focus(18, 14);
    renderer.viewWidth = 38;
    renderer.resize();
    qa.originalRender(0);
    renderer.renderer.getContext().finish();
    const batches = renderer.processSignalPerformance;
    const signatures = fixtures.map((fixture) => {
      const id = qa.ids[fixture.key];
      return {
        key: fixture.key,
        id,
        ...(batches.signatures.get(id) ?? {}),
      };
    });
    return {
      quality: renderer.quality,
      batchRootVisible: batches.root.visible,
      activeBatchDraws: [
        batches.plaques,
        batches.bars,
        batches.rings,
        batches.octahedra,
        batches.tokens,
      ].filter((batch) => batch.count > 0).length,
      batchCounts: {
        plaques: batches.plaques.count,
        bars: batches.bars.count,
        rings: batches.rings.count,
        octahedra: batches.octahedra.count,
        tokens: batches.tokens.count,
      },
      authoredSignalRoots: [...renderer.entityObjects.values()].filter(
        (rig) => rig.parts.processSignalRoot,
      ).length,
      signatures,
    };
  }, FIXTURES);
  assert(
    lodProof.quality === "performance"
      && lodProof.batchRootVisible
      && lodProof.activeBatchDraws <= 5,
    `Process-world LOD did not engage its shared batches: ${JSON.stringify(lodProof)}.`,
  );
  assert(
    lodProof.authoredSignalRoots === 0
      && lodProof.batchCounts.plaques >= FIXTURES.length * 2,
    `Process-world LOD retained detailed roots or missed plaques: ${JSON.stringify(lodProof.batchCounts)}.`,
  );
  for (const fixture of FIXTURES) {
    const signature = lodProof.signatures.find(
      (candidate) => candidate.key === fixture.key,
    );
    assert(
      signature?.state === fixture.state
        && signature.stateSignature === fixture.expectedSignature
        && signature.recipe === (fixture.recipe ?? null)
        && signature.recipeSignature === fixture.expectedRecipeSignature
        && signature.pendingRecipe === (fixture.pendingRecipe ?? null)
        && signature.pendingRecipeSignature
          === (fixture.expectedPendingRecipeSignature ?? null)
        && signature.reclaim === Boolean(fixture.reclaim),
      `${fixture.key}: performance LOD signature is false (${JSON.stringify(signature)}).`,
    );
  }
  const performanceLODPath = `${OUTPUT_DIRECTORY}/performance-lod-11.png`;
  await page.screenshot({ path: performanceLODPath });

  const performance = await page.evaluate(() => {
    const renderer = window.__CINDERLINE__?.renderer;
    const qa = renderer?.__processWorldQA;
    if (!renderer || !qa) {
      throw new Error("Process-world performance bridge unavailable.");
    }
    renderer.sync = qa.originalSync;
    renderer.update = qa.originalUpdate;
    renderer.render = qa.originalRender;
    qa.targetId = null;
    if (renderer.quality !== "performance") renderer.toggleQuality();
    const empty = {
      tick: 0,
      elapsed: 0,
      entities: [],
      resources: [],
      beltItems: [],
    };
    const states = [
      "unconfigured",
      "starved",
      "working",
      "queued",
      "output-blocked",
      "no-power",
      "idle",
    ];
    const recipes = [
      "ironGear",
      "copperWire",
      "circuit",
      "automationCore",
      "auto",
      "smeltIron",
      "smeltCopper",
      "fireBrick",
    ];
    const createScale = (elapsed) => ({
      tick: Math.round(elapsed * 60),
      elapsed,
      resources: [],
      beltItems: [],
      entities: Array.from({ length: 128 }, (_, index) => {
        const recipe = recipes[index % recipes.length];
        const kind =
          recipe === "auto" || recipe.startsWith("smelt") || recipe === "fireBrick"
            ? "smelter"
            : "fabricator";
        const state = states[index % states.length];
        const unconfigured = kind === "fabricator" && state === "unconfigured";
        const effectiveState =
          kind === "smelter" && state === "unconfigured" ? "starved" : state;
        return {
          id: `process-scale-${index}`,
          kind,
          x: 2 + (index % 16) * 4,
          z: 2 + Math.floor(index / 16) * 4,
          direction: index % 4,
          active: effectiveState === "working" || effectiveState === "queued",
          powered: effectiveState !== "no-power",
          progress: (index * 0.173) % 1,
          status:
            effectiveState === "output-blocked"
              ? "blocked"
              : effectiveState === "no-power"
                ? "unpowered"
              : effectiveState === "working" || effectiveState === "queued"
                ? "working"
                : "idle",
          health: 1,
          recipe: unconfigured || recipe === "auto" ? undefined : recipe,
          processState: unconfigured ? "unconfigured" : effectiveState,
          processRecipe: unconfigured ? undefined : recipe,
          pendingRecipe:
            effectiveState === "queued" ? "automationCore" : undefined,
          reclaimCount: index % 7 === 0 ? 2 : 0,
        };
      }),
    });
    const gl = renderer.renderer.getContext();
    const memory = () => ({
      geometries: renderer.renderer.info.memory.geometries,
      textures: renderer.renderer.info.memory.textures,
    });
    const settle = (snapshot, elapsed) => {
      qa.originalSync(snapshot);
      qa.originalUpdate(0, elapsed);
      qa.originalRender(0);
      gl.finish();
    };

    settle(empty, 0);
    const baseline = memory();
    const scale = createScale(4.2);
    renderer.focus(32, 16);
    renderer.viewWidth = 72;
    renderer.resize();
    settle(scale, 4.2);
    const batches = renderer.processSignalPerformance;
    const batchMeshes = [
      batches.plaques,
      batches.bars,
      batches.rings,
      batches.octahedra,
      batches.tokens,
    ];
    const renderStats = (visible, elapsed) => {
      qa.originalUpdate(0, elapsed);
      batches.root.visible = visible;
      qa.originalRender(0);
      gl.finish();
      return {
        calls: renderer.renderer.info.render.calls,
        triangles: renderer.renderer.info.render.triangles,
      };
    };
    for (let warm = 0; warm < 5; warm += 1) {
      renderStats(false, 4.3 + warm / 120);
      renderStats(true, 4.35 + warm / 120);
    }
    const hiddenStats = renderStats(false, 4.5);
    const visibleStats = renderStats(true, 4.5);
    const scaleStats = {
      ...memory(),
      rigCount: renderer.entityObjects.size,
      authoredSignalRoots: [...renderer.entityObjects.values()].filter(
        (rig) => rig.parts.processSignalRoot,
      ).length,
      signatureCount: batches.signatures.size,
      activeBatchDraws: batchMeshes.filter((batch) => batch.count > 0).length,
      batchCounts: {
        plaques: batches.plaques.count,
        bars: batches.bars.count,
        rings: batches.rings.count,
        octahedra: batches.octahedra.count,
        tokens: batches.tokens.count,
      },
      hiddenStats,
      visibleStats,
      incrementalCalls: visibleStats.calls - hiddenStats.calls,
      incrementalTriangles: visibleStats.triangles - hiddenStats.triangles,
      stateCoverage: [...new Set(
        [...batches.signatures.values()].map((signature) => signature.state),
      )].sort(),
      recipeCoverage: [...new Set(
        [...batches.signatures.values()]
          .map((signature) => signature.recipe)
          .filter(Boolean),
      )].sort(),
      reclaimPresent: [...batches.signatures.values()].some(
        (signature) => signature.reclaim,
      ),
      reclaimAbsent: [...batches.signatures.values()].some(
        (signature) => !signature.reclaim,
      ),
    };

    const hiddenSamples = [];
    const visibleSamples = [];
    for (let sample = 0; sample < 36; sample += 1) {
      for (const visible of sample % 2 === 0 ? [false, true] : [true, false]) {
        const start = performance.now();
        qa.originalUpdate(1 / 60, 4.6 + sample / 60);
        batches.root.visible = visible;
        qa.originalRender(0);
        gl.finish();
        (visible ? visibleSamples : hiddenSamples).push(
          performance.now() - start,
        );
      }
    }
    hiddenSamples.sort((left, right) => left - right);
    visibleSamples.sort((left, right) => left - right);
    const percentile = (samples, proportion) =>
      samples[Math.floor(samples.length * proportion)] ?? 0;
    const timing = {
      hiddenMedianMs: percentile(hiddenSamples, 0.5),
      hiddenP95Ms: percentile(hiddenSamples, 0.95),
      visibleMedianMs: percentile(visibleSamples, 0.5),
      visibleP95Ms: percentile(visibleSamples, 0.95),
      p95DeltaMs: Math.max(
        0,
        percentile(visibleSamples, 0.95)
          - percentile(hiddenSamples, 0.95),
      ),
      samplesPerMode: hiddenSamples.length,
    };

    settle(empty, 5.2);
    const afterFirstEmpty = {
      ...memory(),
      rigCount: renderer.entityObjects.size,
    };
    settle(createScale(5.8), 5.8);
    settle(empty, 6.2);
    const afterSecondEmpty = {
      ...memory(),
      rigCount: renderer.entityObjects.size,
    };
    const roundtripSnapshot = {
      tick: 420,
      elapsed: 7,
      resources: [],
      beltItems: [],
      entities: [{
        id: "process-quality-roundtrip",
        kind: "fabricator",
        x: 15,
        z: 11,
        direction: 3,
        active: true,
        powered: true,
        progress: 0.61,
        status: "working",
        health: 1,
        recipe: "circuit",
        processState: "queued",
        processRecipe: "circuit",
        pendingRecipe: "automationCore",
        reclaimCount: 2,
      }],
    };
    settle(roundtripSnapshot, 7);
    const performanceBefore = {
      quality: renderer.quality,
      authoredSignalRoots: [...renderer.entityObjects.values()].filter(
        (rig) => rig.parts.processSignalRoot,
      ).length,
      signature: {
        ...(batches.signatures.get("process-quality-roundtrip") ?? {}),
      },
    };
    renderer.viewWidth = 22;
    renderer.resize();
    const highQuality = renderer.toggleQuality();
    qa.originalUpdate(0, 7.1);
    qa.originalRender(0);
    gl.finish();
    const highRig = renderer.entityObjects.get("process-quality-roundtrip");
    let visibleDetailedSignalMeshes = 0;
    highRig?.parts.processSignalRoot?.traverse((object) => {
      if (!object.isMesh) return;
      let current = object;
      while (current && current !== highRig.root) {
        if (!current.visible) return;
        current = current.parent;
      }
      if (highRig.root.visible) visibleDetailedSignalMeshes += 1;
    });
    const high = {
      quality: highQuality,
      hasAuthoredRoot: Boolean(highRig?.parts.processSignalRoot),
      visibleDetailedSignalMeshes,
      state:
        highRig?.parts.processSignalRoot?.userData.processState ?? null,
      recipe:
        highRig?.parts.processGlyphRoot?.userData.recipeIdentity ?? null,
      recipeSignature:
        highRig?.parts.processGlyphRoot?.userData.recipeSignature ?? null,
      pending:
        highRig?.parts.processQueueBridge?.userData.pendingRecipe ?? null,
      pendingRecipeSignature:
        highRig?.parts.processPendingGlyphRoot?.userData.recipeSignature
          ?? null,
      reclaimVisible:
        highRig?.parts.processReclaimBin?.visible ?? false,
      performanceRootVisible: batches.root.visible,
    };
    const performanceQuality = renderer.toggleQuality();
    qa.originalUpdate(0, 7.2);
    qa.originalRender(0);
    gl.finish();
    const performanceAfter = {
      quality: performanceQuality,
      authoredSignalRoots: [...renderer.entityObjects.values()].filter(
        (rig) => rig.parts.processSignalRoot,
      ).length,
      signature: {
        ...(batches.signatures.get("process-quality-roundtrip") ?? {}),
      },
      rootVisible: batches.root.visible,
    };
    settle(empty, 7.4);
    const roundtripCleanup = {
      ...memory(),
      rigCount: renderer.entityObjects.size,
    };
    delete renderer.__processWorldQA;
    return {
      baseline,
      scaleStats,
      timing,
      afterFirstEmpty,
      afterSecondEmpty,
      roundtrip: {
        performanceBefore,
        high,
        performanceAfter,
        cleanup: roundtripCleanup,
      },
    };
  });

  assert(
    performance.scaleStats.rigCount === 128
      && performance.scaleStats.signatureCount === 128,
    `Process-world scale allocated ${performance.scaleStats.rigCount}/128 rigs and ${performance.scaleStats.signatureCount}/128 signatures.`,
  );
  assert(
    performance.scaleStats.authoredSignalRoots === 0,
    `Performance LOD retained ${performance.scaleStats.authoredSignalRoots} authored signal roots.`,
  );
  assert(
    performance.scaleStats.activeBatchDraws <= 5
      && performance.scaleStats.incrementalCalls <= 16,
    `Process-world LOD adds ${performance.scaleStats.incrementalCalls}/16 calls across ${performance.scaleStats.activeBatchDraws} batches.`,
  );
  assert(
    performance.scaleStats.incrementalTriangles <= 180_000,
    `Process-world LOD adds ${performance.scaleStats.incrementalTriangles}/180000 triangles.`,
  );
  assert(
    performance.timing.p95DeltaMs <= 1.5,
    `Process-world LOD p95 delta is ${performance.timing.p95DeltaMs.toFixed(3)}/1.5ms: ${JSON.stringify({
      timing: performance.timing,
      scale: performance.scaleStats,
    })}.`,
  );
  assert(
    performance.scaleStats.stateCoverage.length === 7
      && performance.scaleStats.recipeCoverage.length === 8
      && performance.scaleStats.reclaimPresent
      && performance.scaleStats.reclaimAbsent,
    `Process-world LOD coverage is incomplete: ${JSON.stringify(performance.scaleStats)}.`,
  );
  assert(
    performance.scaleStats.batchCounts.plaques >= 256,
    `Process-world LOD encoded only ${performance.scaleStats.batchCounts.plaques} outer/socket plaque instances for 128 machines.`,
  );
  assert(
    performance.roundtrip.performanceBefore.quality === "performance"
      && performance.roundtrip.performanceBefore.authoredSignalRoots === 0
      && performance.roundtrip.performanceBefore.signature.state === "queued"
      && performance.roundtrip.performanceBefore.signature.recipe === "circuit"
      && performance.roundtrip.performanceBefore.signature.pendingRecipe
        === "automationCore"
      && performance.roundtrip.performanceBefore.signature.pendingRecipeSignature
        === "green-hex-cyan-rotor-core-die"
      && performance.roundtrip.performanceBefore.signature.reclaim,
    `Process-world pre-roundtrip LOD identity is false: ${JSON.stringify(performance.roundtrip.performanceBefore)}.`,
  );
  assert(
    performance.roundtrip.high.quality === "high"
      && performance.roundtrip.high.hasAuthoredRoot
      && performance.roundtrip.high.visibleDetailedSignalMeshes > 0
      && performance.roundtrip.high.state === "queued"
      && performance.roundtrip.high.recipe === "circuit"
      && performance.roundtrip.high.recipeSignature
        === "green-three-node-board-die"
      && performance.roundtrip.high.pending === "automationCore"
      && performance.roundtrip.high.pendingRecipeSignature
        === "green-hex-cyan-rotor-core-die"
      && performance.roundtrip.high.reclaimVisible
      && !performance.roundtrip.high.performanceRootVisible,
    `Process-world high roundtrip identity is false: ${JSON.stringify(performance.roundtrip.high)}.`,
  );
  assert(
    performance.roundtrip.performanceAfter.quality === "performance"
      && performance.roundtrip.performanceAfter.authoredSignalRoots === 0
      && performance.roundtrip.performanceAfter.rootVisible
      && performance.roundtrip.performanceAfter.signature.state === "queued"
      && performance.roundtrip.performanceAfter.signature.recipe === "circuit"
      && performance.roundtrip.performanceAfter.signature.pendingRecipe
        === "automationCore"
      && performance.roundtrip.performanceAfter.signature.pendingRecipeSignature
        === "green-hex-cyan-rotor-core-die"
      && performance.roundtrip.performanceAfter.signature.reclaim,
    `Process-world post-roundtrip LOD identity is false: ${JSON.stringify(performance.roundtrip.performanceAfter)}.`,
  );
  for (const [name, empty] of [
    ["first", performance.afterFirstEmpty],
    ["second", performance.afterSecondEmpty],
  ]) {
    assert(
      empty.rigCount === 0
        && empty.geometries === performance.baseline.geometries
        && empty.textures === performance.baseline.textures,
      `${name} teardown missed baseline: ${JSON.stringify(empty)} vs ${JSON.stringify(performance.baseline)}.`,
    );
  }
  assert(
    performance.roundtrip.cleanup.rigCount === 0
      && performance.roundtrip.cleanup.geometries
        === performance.baseline.geometries
      && performance.roundtrip.cleanup.textures
        === performance.baseline.textures,
    `Quality roundtrip cleanup missed baseline: ${JSON.stringify(performance.roundtrip.cleanup)}.`,
  );

  // This is the authoritative production proof. Unlike the deterministic
  // composition fixture above, it never replaces the renderer snapshot:
  // `?showcase` constructs and warms a real FactorySimulation, we advance that
  // same simulation through public fixed steps, and the ordinary main loop
  // adapts/syncs its resulting state into WorldRenderer.
  const authoritativeContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const authoritativePage = await authoritativeContext.newPage();
  authoritativePage.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      failures.push(`authoritative-${message.type()}: ${message.text()}`);
    }
  });
  authoritativePage.on(
    "pageerror",
    (error) => failures.push(`authoritative-pageerror: ${error.message}`),
  );
  await authoritativePage.goto(
    `${BASE_URL}/?showcase&fresh=process-world-authoritative-${Date.now()}`,
    {
      waitUntil: "networkidle",
      timeout: 30_000,
    },
  );
  await authoritativePage.waitForFunction(
    () =>
      document.querySelector("#boot")?.classList.contains("is-done")
      && Boolean(window.__CINDERLINE__?.simulation)
      && Boolean(window.__CINDERLINE__?.renderer),
    undefined,
    { timeout: 15_000 },
  );
  await authoritativePage.keyboard.press("Space");
  const authoritativePauseBefore = await authoritativePage.evaluate(
    () => window.__CINDERLINE__?.simulation.tickCount,
  );
  await authoritativePage.waitForTimeout(90);
  const authoritativePauseAfter = await authoritativePage.evaluate(
    () => window.__CINDERLINE__?.simulation.tickCount,
  );
  assert(
    authoritativePauseBefore === authoritativePauseAfter,
    `Authoritative showcase could not pause (${authoritativePauseBefore} → ${authoritativePauseAfter}).`,
  );

  const prepareAuthoritativeFrame = async () =>
    authoritativePage.evaluate(() => {
      const game = window.__CINDERLINE__;
      const renderer = game?.renderer;
      const simulation = game?.simulation;
      if (!renderer || !simulation) {
        throw new Error("Authoritative showcase bridge unavailable.");
      }
      document.querySelector("#boot")?.remove();
      const hud = document.querySelector("#hud");
      if (hud instanceof HTMLElement) hud.style.display = "none";
      if (renderer.quality !== "high") renderer.toggleQuality();
      renderer.setSelected(null);
      renderer.setHovered(null, null);
      renderer.overlayRoot.visible = false;
      renderer.infrastructureRoot.visible = true;
      renderer.resourceRoot.visible = true;
      renderer.itemRoot.visible = true;
      renderer.effectsRoot.visible = true;
      // The complete foundry spans x≈5–35. This is ordinary high-detail
      // gameplay zoom (below the overview-LOD threshold) and intentionally
      // crops only the empty edge terrain.
      renderer.focus(20, 12.5);
      renderer.viewWidth = 29.5;
      renderer.resize();
      renderer.update(0, simulation.elapsedSeconds);
      renderer.render(0);
      renderer.renderer.getContext().finish();

      const bounds = renderer.canvas.getBoundingClientRect();
      const Vector3 = renderer.camera.position.constructor;
      const visibleCenters = [];
      const visibleKindCounts = {};
      for (const rig of renderer.entityObjects.values()) {
        const point = rig.root.getWorldPosition(new Vector3());
        point.project(renderer.camera);
        const projected = {
          x: (point.x + 1) * bounds.width * 0.5,
          y: (-point.y + 1) * bounds.height * 0.5,
        };
        if (
          rig.root.visible
          && projected.x >= 0
          && projected.x <= bounds.width
          && projected.y >= 0
          && projected.y <= bounds.height
        ) {
          visibleCenters.push(projected);
          visibleKindCounts[rig.kind] =
            (visibleKindCounts[rig.kind] ?? 0) + 1;
        }
      }
      const minX = Math.min(...visibleCenters.map(({ x }) => x));
      const maxX = Math.max(...visibleCenters.map(({ x }) => x));
      const minY = Math.min(...visibleCenters.map(({ y }) => y));
      const maxY = Math.max(...visibleCenters.map(({ y }) => y));
      const production = [...renderer.entityObjects.values()].filter(
        (rig) => rig.kind === "smelter" || rig.kind === "fabricator",
      );
      const snapshot = renderer.snapshot;
      const cargoKinds = [
        ...new Set((snapshot.beltItems ?? []).map(({ kind }) => kind)),
      ].sort();
      return {
        viewWidth: renderer.viewWidth,
        overviewLOD: renderer.processSignalOverviewLOD,
        rendererQuality: renderer.quality,
        simulationTick: simulation.tickCount,
        rendererTick: snapshot.tick,
        visibleEntityCount: visibleCenters.length,
        visibleKindCounts,
        screenFill: {
          widthRatio: (maxX - minX) / bounds.width,
          heightRatio: (maxY - minY) / bounds.height,
        },
        cargoCount: snapshot.beltItems?.length ?? 0,
        cargoKinds,
        production: production.map((rig) => ({
          id: rig.entity.id,
          kind: rig.kind,
          recipe:
            rig.entity.processRecipe
            ?? rig.entity.recipe
            ?? null,
          state: rig.entity.processState ?? null,
          powered: rig.entity.powered ?? null,
          signalVisible: Boolean(rig.parts.processSignalRoot?.visible),
        })),
        power: {
          links: renderer.powerGridRoot.userData.linkCount ?? 0,
          cableInstances: renderer.powerGridBatches.cables.count,
          networkCount: snapshot.power?.networks?.length ?? null,
          satisfaction: snapshot.power?.satisfaction ?? null,
        },
        render: {
          calls: renderer.renderer.info.render.calls,
          triangles: renderer.renderer.info.render.triangles,
        },
        rendererSnapshotInjected: false,
      };
    });

  const authoritativeBeforeVisual = await prepareAuthoritativeFrame();
  const authoritativeBeforePath =
    `${OUTPUT_DIRECTORY}/authoritative-showcase-before.png`;
  await authoritativePage.locator("#world").screenshot({
    path: authoritativeBeforePath,
  });

  const authoritativeLedger = await authoritativePage.evaluate(() => {
    const game = window.__CINDERLINE__;
    const simulation = game?.simulation;
    if (!simulation) {
      throw new Error("Authoritative showcase simulation unavailable.");
    }
    const snapshotSummary = (snapshot) => ({
      tick: snapshot.tick,
      entities: snapshot.entities.map((entity) => ({
        id: entity.id,
        kind: entity.kind,
        recipe: entity.recipeId ?? null,
        activeRecipe: entity.activeRecipeId ?? null,
        status: entity.status,
        progress: entity.progress,
        input: { ...entity.input },
        output: { ...entity.output },
        inventory: { ...entity.inventory },
        fuel: { ...entity.fuel },
        fuelEnergyKJ: entity.fuelEnergyKJ,
      })),
    });
    const flattenCargo = (snapshot) =>
      snapshot.entities.flatMap((entity) =>
        entity.beltItems.map((payload) => ({
          id: payload.id,
          item: payload.item,
          carrierId: entity.id,
          carrierKind: entity.kind,
          x: entity.x,
          y: entity.y,
          direction: entity.direction,
          lane: payload.lane,
          progress: payload.progress,
        }))
      );
    const deltaRecord = (before, after) =>
      Object.fromEntries(
        [...new Set([...Object.keys(before), ...Object.keys(after)])]
          .sort()
          .map((key) => [key, (after[key] ?? 0) - (before[key] ?? 0)])
          .filter(([, delta]) => delta !== 0),
      );
    const inventoryTotal = (inventory) =>
      Object.values(inventory).reduce(
        (total, amount) => total + (amount ?? 0),
        0,
      );

    const beforeStats = simulation.stats();
    const beforeSnapshot = simulation.getRenderSnapshot();
    const beforeSummary = snapshotSummary(beforeSnapshot);
    const beforeCargo = flattenCargo(beforeSnapshot);
    simulation.drainEvents();
    const events = [];
    const fixedStepChunks = 12;
    const fixedStepsPerChunk = 60;
    for (let chunk = 0; chunk < fixedStepChunks; chunk += 1) {
      simulation.step(fixedStepsPerChunk);
      events.push(...simulation.drainEvents());
    }
    const afterStats = simulation.stats();
    const afterSnapshot = simulation.getRenderSnapshot();
    const afterSummary = snapshotSummary(afterSnapshot);
    const afterCargo = flattenCargo(afterSnapshot);
    const beforeEntityById = new Map(
      beforeSummary.entities.map((entity) => [entity.id, entity]),
    );
    const afterEntityById = new Map(
      afterSummary.entities.map((entity) => [entity.id, entity]),
    );
    const afterCargoById = new Map(
      afterCargo.map((payload) => [payload.id, payload]),
    );
    const movedSharedCargo = beforeCargo.flatMap((before) => {
      const after = afterCargoById.get(before.id);
      if (!after) return [];
      const moved =
        before.carrierId !== after.carrierId
        || before.x !== after.x
        || before.y !== after.y
        || before.lane !== after.lane
        || Math.abs(before.progress - after.progress) > 0.001;
      return moved ? [{ before, after }] : [];
    });
    const eventCountByType = {};
    const producedBySourceKind = {};
    const producedByItem = {};
    const transferredToKind = {};
    const transferredByItem = {};
    const eventTimeline = [];
    for (const event of events) {
      eventCountByType[event.type] =
        (eventCountByType[event.type] ?? 0) + 1;
      const entity =
        event.entityId === undefined
          ? null
          : simulation.getEntity(event.entityId);
      if (event.type === "itemProduced" && event.item) {
        const kind = entity?.kind ?? "missing";
        producedBySourceKind[kind] =
          (producedBySourceKind[kind] ?? 0) + (event.amount ?? 1);
        producedByItem[event.item] =
          (producedByItem[event.item] ?? 0) + (event.amount ?? 1);
      }
      if (event.type === "itemTransferred" && event.item) {
        const kind = entity?.kind ?? "missing";
        transferredToKind[kind] =
          (transferredToKind[kind] ?? 0) + (event.amount ?? 1);
        transferredByItem[event.item] =
          (transferredByItem[event.item] ?? 0) + (event.amount ?? 1);
      }
      if (
        eventTimeline.length < 180
        && (
          event.type === "itemProduced"
          || event.type === "itemTransferred"
        )
      ) {
        eventTimeline.push({
          tick: event.tick,
          type: event.type,
          entityId: event.entityId ?? null,
          targetOrSourceKind: entity?.kind ?? null,
          recipe: entity?.recipeId ?? entity?.activeRecipeId ?? null,
          item: event.item ?? null,
          amount: event.amount ?? null,
        });
      }
    }
    const machineTransitions = afterSummary.entities
      .filter(
        (after) =>
          after.kind === "smelter" || after.kind === "fabricator",
      )
      .map((after) => {
        const before = beforeEntityById.get(after.id);
        return {
          id: after.id,
          kind: after.kind,
          recipe: after.recipe ?? after.activeRecipe,
          beforeStatus: before?.status ?? null,
          afterStatus: after.status,
          beforeProgress: before?.progress ?? null,
          afterProgress: after.progress,
          inputDelta: before
            ? deltaRecord(before.input, after.input)
            : {},
          outputDelta: before
            ? deltaRecord(before.output, after.output)
            : {},
          changed:
            !before
            || before.status !== after.status
            || Math.abs(before.progress - after.progress) > 0.001
            || JSON.stringify(before.input) !== JSON.stringify(after.input)
            || JSON.stringify(before.output) !== JSON.stringify(after.output),
        };
      });
    const storageTransitions = afterSummary.entities
      .filter((after) => after.kind === "storage")
      .map((after) => {
        const before = beforeEntityById.get(after.id);
        return {
          id: after.id,
          before: before?.inventory ?? {},
          after: after.inventory,
          delta: before
            ? deltaRecord(before.inventory, after.inventory)
            : {},
          totalDelta:
            inventoryTotal(after.inventory)
            - inventoryTotal(before?.inventory ?? {}),
        };
      });
    const generatorTransitions = afterSummary.entities
      .filter((after) => after.kind === "generator")
      .map((after) => {
        const before = beforeEntityById.get(after.id);
        return {
          id: after.id,
          fuelItemsBefore: before?.fuel.coal ?? 0,
          fuelItemsAfter: after.fuel.coal ?? 0,
          fuelEnergyBefore: before?.fuelEnergyKJ ?? 0,
          fuelEnergyAfter: after.fuelEnergyKJ,
        };
      });
    return {
      evidenceClass: "authoritative-live-factory-simulation",
      source: "?showcase",
      authoritativeSimulation: true,
      rendererSnapshotInjected: false,
      fixedStepChunks,
      fixedStepsPerChunk,
      fixedSteps: fixedStepChunks * fixedStepsPerChunk,
      before: {
        tick: beforeStats.tick,
        elapsedSeconds: beforeStats.elapsedSeconds,
        produced: beforeStats.produced,
        stored: beforeStats.stored,
        resourcesRemaining: beforeStats.resourcesRemaining,
        power: beforeStats.power,
        cargoCount: beforeCargo.length,
        cargoKinds: [...new Set(beforeCargo.map(({ item }) => item))].sort(),
      },
      after: {
        tick: afterStats.tick,
        elapsedSeconds: afterStats.elapsedSeconds,
        produced: afterStats.produced,
        stored: afterStats.stored,
        resourcesRemaining: afterStats.resourcesRemaining,
        power: afterStats.power,
        cargoCount: afterCargo.length,
        cargoKinds: [...new Set(afterCargo.map(({ item }) => item))].sort(),
      },
      delta: {
        tick: afterStats.tick - beforeStats.tick,
        elapsedSeconds:
          afterStats.elapsedSeconds - beforeStats.elapsedSeconds,
        produced: deltaRecord(beforeStats.produced, afterStats.produced),
        stored: deltaRecord(beforeStats.stored, afterStats.stored),
        resourcesRemaining: deltaRecord(
          beforeStats.resourcesRemaining,
          afterStats.resourcesRemaining,
        ),
        storedFuelKJ:
          afterStats.power.storedFuelKJ
          - beforeStats.power.storedFuelKJ,
      },
      events: {
        total: events.length,
        countByType: eventCountByType,
        producedBySourceKind,
        producedByItem,
        transferredToKind,
        transferredByItem,
        timeline: eventTimeline,
      },
      custody: {
        beforeCargoCount: beforeCargo.length,
        afterCargoCount: afterCargo.length,
        sharedMovedCount: movedSharedCargo.length,
        sharedMovedExamples: movedSharedCargo.slice(0, 24),
      },
      machineTransitions,
      storageTransitions,
      generatorTransitions,
      powerGrid: {
        mode: afterSnapshot.powerGrid.mode,
        relays: afterSnapshot.powerGrid.relays.length,
        links: afterSnapshot.powerGrid.links.length,
        networks: afterStats.power.networks,
      },
      entityCountStable:
        beforeSnapshot.entities.length === afterSnapshot.entities.length,
      eventTicksMonotonic: events.every(
        (event, index) => index === 0 || event.tick >= events[index - 1].tick,
      ),
      ordinaryPublicSimulationStep: true,
    };
  });

  await authoritativePage.waitForFunction(
    (tick) =>
      window.__CINDERLINE__?.renderer.snapshot.tick === tick,
    authoritativeLedger.after.tick,
    { timeout: 5_000 },
  );
  const authoritativeAfterVisual = await prepareAuthoritativeFrame();
  const authoritativeShowcasePath =
    `${OUTPUT_DIRECTORY}/authoritative-showcase-gameplay.png`;
  await authoritativePage.locator("#world").screenshot({
    path: authoritativeShowcasePath,
  });
  const authoritativeShowcaseProofPath =
    `${OUTPUT_DIRECTORY}/authoritative-showcase-proof.json`;
  const authoritativeShowcaseProof = {
    evidenceClass: "authoritative-live-factory-simulation",
    source: "?showcase",
    beforeVisual: authoritativeBeforeVisual,
    afterVisual: authoritativeAfterVisual,
    ledger: authoritativeLedger,
    captures: {
      before: authoritativeBeforePath,
      after: authoritativeShowcasePath,
    },
  };
  await writeFile(
    authoritativeShowcaseProofPath,
    `${JSON.stringify(authoritativeShowcaseProof, null, 2)}\n`,
  );

  const positiveProductionKinds = Object.entries(
    authoritativeLedger.delta.produced,
  )
    .filter(([, amount]) => amount > 0)
    .map(([kind]) => kind);
  const negativeResourceKinds = Object.entries(
    authoritativeLedger.delta.resourcesRemaining,
  )
    .filter(([, amount]) => amount < 0)
    .map(([kind]) => kind);
  assert(
    authoritativeLedger.authoritativeSimulation
      && !authoritativeLedger.rendererSnapshotInjected
      && authoritativeLedger.ordinaryPublicSimulationStep
      && authoritativeLedger.fixedSteps === 720
      && authoritativeLedger.delta.tick === 720
      && Math.abs(authoritativeLedger.delta.elapsedSeconds - 12) < 0.001
      && authoritativeLedger.entityCountStable
      && authoritativeLedger.eventTicksMonotonic,
    `Authoritative showcase stepping contract is false: ${JSON.stringify(authoritativeLedger)}.`,
  );
  assert(
    (authoritativeLedger.events.countByType.itemProduced ?? 0) > 0
      && (authoritativeLedger.events.countByType.itemTransferred ?? 0) > 0
      && (authoritativeLedger.events.producedBySourceKind.extractor ?? 0) > 0
      && (authoritativeLedger.events.producedBySourceKind.smelter ?? 0) > 0
      && (authoritativeLedger.events.producedBySourceKind.fabricator ?? 0) > 0
      && positiveProductionKinds.some((kind) =>
        ["ironOre", "copperOre", "stone", "coal"].includes(kind)
      )
      && positiveProductionKinds.some((kind) =>
        ["ironPlate", "copperPlate", "stoneBrick"].includes(kind)
      )
      && positiveProductionKinds.some((kind) =>
        ["ironGear", "copperWire", "circuit", "automationCore"].includes(kind)
      ),
    `Authoritative extraction/process production did not advance: ${JSON.stringify({
      positiveProductionKinds,
      events: authoritativeLedger.events,
    })}.`,
  );
  assert(
    (authoritativeLedger.events.transferredToKind.belt ?? 0) > 0
      && (authoritativeLedger.events.transferredToKind.smelter ?? 0) > 0
      && (authoritativeLedger.events.transferredToKind.fabricator ?? 0) > 0
      && (authoritativeLedger.events.transferredToKind.storage ?? 0) > 0
      && authoritativeLedger.custody.sharedMovedCount > 0
      && new Set([
        ...authoritativeLedger.before.cargoKinds,
        ...authoritativeLedger.after.cargoKinds,
      ]).size >= 6
      && authoritativeLedger.storageTransitions.some(
        ({ totalDelta }) => totalDelta !== 0,
      ),
    `Authoritative transport/storage custody did not advance: ${JSON.stringify({
      transferTargets: authoritativeLedger.events.transferredToKind,
      custody: authoritativeLedger.custody,
      storageTransitions: authoritativeLedger.storageTransitions,
    })}.`,
  );
  assert(
    authoritativeLedger.machineTransitions.length >= 8
      && new Set(
        authoritativeLedger.machineTransitions.map(({ recipe }) => recipe),
      ).size >= 7
      && authoritativeLedger.machineTransitions.filter(({ changed }) => changed)
        .length >= 6
      && negativeResourceKinds.length >= 3
      && authoritativeLedger.after.power.mode === "local"
      && authoritativeLedger.after.power.networks.length === 2
      && authoritativeLedger.after.power.usedKW > 0
      && authoritativeLedger.after.power.satisfaction > 0
      && authoritativeLedger.delta.storedFuelKJ !== 0
      && authoritativeLedger.generatorTransitions.some(
        (generator) =>
          generator.fuelItemsBefore !== generator.fuelItemsAfter
          || Math.abs(
            generator.fuelEnergyBefore - generator.fuelEnergyAfter,
          ) > 0.001,
      ),
    `Authoritative recipe/resource/power evolution is false: ${JSON.stringify({
      machines: authoritativeLedger.machineTransitions,
      negativeResourceKinds,
      power: authoritativeLedger.after.power,
      storedFuelDelta: authoritativeLedger.delta.storedFuelKJ,
      generators: authoritativeLedger.generatorTransitions,
    })}.`,
  );
  assert(
    authoritativeAfterVisual.rendererQuality === "high"
      && authoritativeAfterVisual.viewWidth === 29.5
      && !authoritativeAfterVisual.overviewLOD
      && authoritativeAfterVisual.simulationTick
        === authoritativeLedger.after.tick
      && authoritativeAfterVisual.rendererTick
        === authoritativeLedger.after.tick
      && authoritativeAfterVisual.visibleEntityCount >= 70
      && authoritativeAfterVisual.screenFill.widthRatio >= 0.78
      && authoritativeAfterVisual.screenFill.heightRatio >= 0.58
      && (authoritativeAfterVisual.visibleKindCounts.extractor ?? 0) >= 3
      && (authoritativeAfterVisual.visibleKindCounts.belt ?? 0) >= 30
      && (authoritativeAfterVisual.visibleKindCounts.inserter ?? 0) >= 12
      && (authoritativeAfterVisual.visibleKindCounts.smelter ?? 0) >= 4
      && (authoritativeAfterVisual.visibleKindCounts.fabricator ?? 0) >= 4
      && (authoritativeAfterVisual.visibleKindCounts.storage ?? 0) >= 3
      && (authoritativeAfterVisual.visibleKindCounts.generator ?? 0) >= 1
      && (authoritativeAfterVisual.visibleKindCounts.gridRelay ?? 0) >= 8
      && authoritativeAfterVisual.cargoCount > 0
      && authoritativeAfterVisual.cargoKinds.length >= 6
      && authoritativeAfterVisual.power.links >= 10
      && authoritativeAfterVisual.power.cableInstances > 0
      && !authoritativeAfterVisual.rendererSnapshotInjected,
    `Authoritative gameplay composition is not screen-filling and production-dense: ${JSON.stringify(authoritativeAfterVisual)}.`,
  );
  await authoritativeContext.close();

  const liveContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const livePage = await liveContext.newPage();
  livePage.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      failures.push(`live-${message.type()}: ${message.text()}`);
    }
  });
  livePage.on(
    "pageerror",
    (error) => failures.push(`live-pageerror: ${error.message}`),
  );
  await livePage.goto(
    `${BASE_URL}/?fresh=process-world-live-${Date.now()}`,
    {
      waitUntil: "networkidle",
      timeout: 30_000,
    },
  );
  await livePage.waitForFunction(
    () =>
      document.querySelector("#boot")?.classList.contains("is-done")
      && (window.__CINDERLINE__?.renderer.entityObjects.size ?? 0) > 0,
    undefined,
    { timeout: 15_000 },
  );
  await livePage.waitForTimeout(450);
  const liveEvidence = await livePage.evaluate(() => {
    const game = window.__CINDERLINE__;
    const renderer = game?.renderer;
    const simulation = game?.simulation;
    if (!renderer || !simulation) {
      throw new Error("Untouched live-factory bridge unavailable.");
    }
    document.querySelector("#boot")?.remove();
    const hud = document.querySelector("#hud");
    if (hud instanceof HTMLElement) hud.style.display = "none";
    if (renderer.quality !== "high") renderer.toggleQuality();
    renderer.setSelected(null);
    renderer.setHovered(null, null);
    renderer.overlayRoot.visible = false;
    renderer.infrastructureRoot.visible = true;
    renderer.resourceRoot.visible = true;
    renderer.itemRoot.visible = true;
    renderer.effectsRoot.visible = true;

    const production = [...renderer.entityObjects.values()].filter(
      (rig) => rig.kind === "smelter" || rig.kind === "fabricator",
    );
    const centers = production.map((rig) => rig.root.position);
    const minX = Math.min(...centers.map(({ x }) => x));
    const maxX = Math.max(...centers.map(({ x }) => x));
    const minZ = Math.min(...centers.map(({ z }) => z));
    const maxZ = Math.max(...centers.map(({ z }) => z));
    renderer.focus((minX + maxX) * 0.5, (minZ + maxZ) * 0.5);
    renderer.viewWidth = 38;
    renderer.resize();
    renderer.update(0, simulation.elapsedSeconds);
    renderer.render(0);
    renderer.renderer.getContext().finish();

    renderer.selectionHalo.geometry.computeBoundingBox();
    const Box3 = renderer.selectionHalo.geometry.boundingBox?.constructor;
    const Vector3 = renderer.camera.position.constructor;
    const Matrix4 = renderer.camera.matrixWorld.constructor;
    const canvasBounds = renderer.canvas.getBoundingClientRect();
    const effectiveVisible = (object, rig) => {
      let current = object;
      while (current) {
        if (!current.visible) return false;
        if (current === rig.root) return rig.root.visible;
        current = current.parent;
      }
      return false;
    };
    const projectedBoxSize = (box) => {
      if (!box) return { width: 0, height: 0 };
      if (box.isEmpty()) return { width: 0, height: 0 };
      const points = [];
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            const point = new Vector3(x, y, z).project(renderer.camera);
            points.push({
              x: (point.x + 1) * canvasBounds.width * 0.5,
              y: (-point.y + 1) * canvasBounds.height * 0.5,
            });
          }
        }
      }
      return {
        width:
          Math.max(...points.map(({ x }) => x))
          - Math.min(...points.map(({ x }) => x)),
        height:
          Math.max(...points.map(({ y }) => y))
          - Math.min(...points.map(({ y }) => y)),
      };
    };
    const projectedSize = (object) => {
      if (!Box3 || !object) return { width: 0, height: 0 };
      return projectedBoxSize(new Box3().setFromObject(object));
    };
    const projectedInstanceSize = (mesh, entityIds, entityId) => {
      if (!Box3 || !mesh?.geometry) return { width: 0, height: 0 };
      mesh.geometry.computeBoundingBox();
      const geometryBox = mesh.geometry.boundingBox;
      if (!geometryBox) return { width: 0, height: 0 };
      const union = new Box3().makeEmpty();
      const matrix = new Matrix4();
      for (let index = 0; index < mesh.count; index += 1) {
        if (entityIds[index] !== entityId) continue;
        mesh.getMatrixAt(index, matrix);
        union.union(geometryBox.clone().applyMatrix4(matrix));
      }
      return projectedBoxSize(union);
    };
    const batches = renderer.processSignalPerformance;
    const glyphProofs = production
      .filter((rig) => batches.signatures.has(rig.entity.id))
      .map((rig) => {
        const glyph = projectedInstanceSize(
          batches.plaques,
          batches.entityIds.plaques,
          rig.entity.id,
        );
        const machine = projectedSize(rig.root);
        const signature = batches.signatures.get(rig.entity.id);
        return {
          id: rig.entity.id,
          state: rig.entity.processState ?? null,
          recipe: rig.entity.processRecipe ?? rig.entity.recipe ?? null,
          recipeSignature: signature?.recipeSignature ?? null,
          glyph,
          machine,
          occlusionRatio:
            glyph.width * glyph.height
            / Math.max(1, machine.width * machine.height),
        };
      });
    const kindCounts = {};
    for (const entity of renderer.snapshot.entities) {
      kindCounts[entity.kind] = (kindCounts[entity.kind] ?? 0) + 1;
    }
    return {
      viewWidth: renderer.viewWidth,
      entityCount: renderer.snapshot.entities.length,
      kindCounts,
      resourceCount: renderer.snapshot.resources?.length ?? 0,
      beltItemCount: renderer.snapshot.beltItems?.length ?? 0,
      productionMachineCount: production.length,
      automaticLOD: renderer.processSignalOverviewLOD,
      batchRootVisible: batches.root.visible,
      activeBatchDraws: [
        batches.plaques,
        batches.bars,
        batches.rings,
        batches.octahedra,
        batches.tokens,
      ].filter((mesh) => mesh.count > 0).length,
      batchSignatureCount: batches.signatures.size,
      authoredVisibleCount: production.filter(
        (rig) =>
          rig.parts.processSignalRoot
          && effectiveVisible(rig.parts.processSignalRoot, rig),
      ).length,
      visibleGlyphCount: glyphProofs.length,
      readableGlyphCount: glyphProofs.filter(
        ({ glyph }) => glyph.width >= 8 && glyph.height >= 6,
      ).length,
      minimumGlyphWidth: Math.min(
        ...glyphProofs.map(({ glyph }) => glyph.width),
      ),
      maximumGlyphOcclusionRatio: Math.max(
        ...glyphProofs.map(({ occlusionRatio }) => occlusionRatio),
      ),
      glyphProofs,
    };
  });
  assert(
    liveEvidence.viewWidth === 38
      && liveEvidence.entityCount >= 8
      && (liveEvidence.kindCounts.gridRelay ?? 0) >= 1
      && (liveEvidence.kindCounts.storage ?? 0) >= 1
      && (liveEvidence.kindCounts.generator ?? 0) >= 1
      && liveEvidence.productionMachineCount >= 1
      && liveEvidence.resourceCount >= 20
      && liveEvidence.beltItemCount >= 0,
    `Untouched campaign factory context is not representative: ${JSON.stringify(liveEvidence)}.`,
  );
  assert(
    liveEvidence.automaticLOD
      && liveEvidence.batchRootVisible
      && liveEvidence.activeBatchDraws <= 5
      && liveEvidence.batchSignatureCount
        === liveEvidence.productionMachineCount
      && liveEvidence.authoredVisibleCount === 0
      && liveEvidence.visibleGlyphCount
        === liveEvidence.productionMachineCount
      && liveEvidence.readableGlyphCount === liveEvidence.visibleGlyphCount
      && liveEvidence.minimumGlyphWidth >= 8
      && liveEvidence.maximumGlyphOcclusionRatio <= 0.32,
    `Live-factory glyph legibility/occlusion failed: ${JSON.stringify(liveEvidence)}.`,
  );
  const liveDefaultContextPath =
    `${OUTPUT_DIRECTORY}/live-default-factory-context.png`;
  await livePage.screenshot({ path: liveDefaultContextPath });
  await liveContext.close();

  if (failures.length > 0) {
    throw new Error(
      `Process-world QA observed browser warnings:\n${failures.join("\n")}`,
    );
  }

  const sheetPage = await context.newPage();
  const sheetRows = Math.ceil(captures.length / 3);
  await sheetPage.setViewportSize({
    width: FRAME_WIDTH * 3,
    height: FRAME_HEIGHT * sheetRows,
  });
  const labeledCaptures = denseCaptures.map((capture, index) => {
    const fixture = FIXTURES.find(({ key }) => key === capture.key);
    return {
      ...capture,
      label: `${String(index + 1).padStart(2, "0")}  ${capture.key.toUpperCase()}  ·  STATE ${fixture?.state ?? "?"}  ·  RECIPE ${fixture?.recipe ?? "NONE"}`,
    };
  });
  await sheetPage.setContent(contactSheetMarkup(labeledCaptures, true), {
    waitUntil: "load",
  });
  const labeledEvidenceSheetPath =
    `${OUTPUT_DIRECTORY}/labeled-evidence-sheet.png`;
  await sheetPage.screenshot({
    path: labeledEvidenceSheetPath,
    fullPage: true,
  });

  const blindCaptures = BLIND_SLOT_KEYS.map((key) => {
    const capture = denseCaptures.find((candidate) => candidate.key === key);
    if (!capture) throw new Error(`Blind capture ${key} is missing.`);
    return capture;
  });
  const blindSlots = Object.fromEntries(
    blindCaptures.map((capture, index) => {
      const fixture = FIXTURES.find(({ key }) => key === capture.key);
      const slot = String.fromCharCode("A".charCodeAt(0) + index);
      return [slot, {
        row: Math.floor(index / 3) + 1,
        column: index % 3 + 1,
        key: capture.key,
        state: fixture?.state ?? null,
        recipe: fixture?.recipe ?? null,
        pendingRecipe: fixture?.pendingRecipe ?? null,
        reclaim: Boolean(fixture?.reclaim),
      }];
    }),
  );
  await sheetPage.setContent(contactSheetMarkup(blindCaptures, false), {
    waitUntil: "load",
  });
  const blindSheetPath = `${OUTPUT_DIRECTORY}/blind-sheet.png`;
  await sheetPage.screenshot({ path: blindSheetPath, fullPage: true });
  const blindMapPath = `${OUTPUT_DIRECTORY}/blind-map.json`;
  await writeFile(
    blindMapPath,
    `${JSON.stringify({
      deterministicOrder: BLIND_SLOT_KEYS,
      slotConvention: `Opaque A-${String.fromCharCode("A".charCodeAt(0) + blindCaptures.length - 1)} slots are row-major; the image itself has no labels.`,
      slots: blindSlots,
    }, null, 2)}\n`,
  );

  const contactSheetPath = labeledEvidenceSheetPath;
  await Promise.all(
    [
      contactSheetPath,
      blindSheetPath,
      blindMapPath,
      denseOverviewPath,
      representativeChainPath,
      representativeChainProofPath,
      authoritativeBeforePath,
      authoritativeShowcasePath,
      authoritativeShowcaseProofPath,
      liveDefaultContextPath,
      autoLODSelectedPath,
      performanceLODPath,
      ...captures.map(({ path }) => path),
      ...denseCaptures.map(({ path }) => path),
    ].map((path) => readFile(path)),
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    contactSheet: contactSheetPath,
    labeledEvidenceSheet: labeledEvidenceSheetPath,
    blindSheet: blindSheetPath,
    blindMap: blindMapPath,
    denseOverview: denseOverviewPath,
    denseProof: denseSetup.proof,
    representativeVisualFixture: representativeChainPath,
    representativeVisualFixtureProof: representativeProof,
    representativeVisualFixtureProofPath: representativeChainProofPath,
    authoritativeShowcase: authoritativeShowcasePath,
    authoritativeShowcaseBefore: authoritativeBeforePath,
    authoritativeShowcaseProof,
    authoritativeShowcaseProofPath,
    liveDefaultContext: liveDefaultContextPath,
    liveEvidence,
    autoLODSelected: autoLODSelectedPath,
    autoLODProof,
    autoLODSelectionProof,
    selectedSignalCosts,
    denseCaptures: denseCaptures.map(({ key, path }) => ({ key, path })),
    performanceLOD: performanceLODPath,
    captures: captures.map(({ key, path }) => ({ key, path })),
    proofs,
    lodProof,
    identities: Object.fromEntries(
      proofs
        .filter((proof) => proof.signal.recipeIdentity !== null)
        .map((proof) => [
          proof.signal.recipeIdentity,
          proof.signal.recipeSignature,
        ]),
    ),
    rotations: proofs.map((proof) => ({
      key: proof.key,
      quaternionDot: proof.signal.quaternionDot,
      forwardDot: proof.signal.forwardDot,
    })),
    performance,
    warnings: failures,
  }, null, 2)}\n`);
  await context.close();
} finally {
  await browser.close();
}

function contactSheetMarkup(captures, labeled) {
  const rows = Math.ceil(captures.length / 3);
  return `<!doctype html>
    <meta charset="utf-8">
    <style>
      * { box-sizing: border-box; }
      html, body {
        width: ${FRAME_WIDTH * 3}px;
        min-height: ${FRAME_HEIGHT * rows}px;
        margin: 0;
        overflow: hidden;
        background: #071012;
      }
      main {
        display: grid;
        grid-template-columns: repeat(3, ${FRAME_WIDTH}px);
        grid-template-rows: repeat(${rows}, ${FRAME_HEIGHT}px);
      }
      figure {
        position: relative;
        width: ${FRAME_WIDTH}px;
        height: ${FRAME_HEIGHT}px;
        margin: 0;
        overflow: hidden;
      }
      img {
        display: block;
        width: ${FRAME_WIDTH}px;
        height: ${FRAME_HEIGHT}px;
        object-fit: cover;
      }
      figcaption {
        position: absolute;
        left: 10px;
        right: 10px;
        bottom: 10px;
        min-height: 28px;
        padding: 7px 10px;
        border: 1px solid rgba(229, 186, 88, 0.7);
        border-radius: 4px;
        color: #f3ebd8;
        background: rgba(5, 10, 11, 0.9);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.65);
        font: 700 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
        letter-spacing: 0.035em;
        text-transform: uppercase;
      }
    </style>
    <main>
      ${captures.map(({ dataURL, label = "" }) => `
        <figure>
          <img src="${dataURL}" alt="">
          ${labeled ? `<figcaption>${escapeMarkup(label)}</figcaption>` : ""}
        </figure>
      `).join("")}
    </main>`;
}

function escapeMarkup(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
