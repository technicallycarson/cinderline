import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY =
  process.env.CIRCUIT_PASS3_OUTPUT ??
  ".qa/circuit-network/pass3-work/iteration1";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];

try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("requestfailed", (request) => {
    errors.push(
      `requestfailed: ${request.url()} ${request.failure()?.errorText ?? ""}`,
    );
  });

  await page.goto(
    `${BASE_URL.replace(/\/$/, "")}/?fresh=circuit-pass3-visual-qa`,
    { waitUntil: "networkidle", timeout: 30_000 },
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#boot")?.classList.contains("is-done") &&
      Boolean(window.__CINDERLINE__?.renderer),
    undefined,
    { timeout: 20_000 },
  );

  const fixture = await page.evaluate(async () => {
    const game = window.__CINDERLINE__;
    if (!game) throw new Error("Cinderline debug bridge is unavailable.");
    const [{ toRenderSnapshot }, circuitModule] = await Promise.all([
      import("/src/game/adapters.ts"),
      import("/src/game/circuit-network.ts"),
    ]);
    const { circuitSignal, circuitOperand, circuitConstant } = circuitModule;
    const simulation = game.simulation;
    const world = game.renderer;

    document.querySelector("#boot")?.remove();
    const hud = document.querySelector("#hud");
    if (hud instanceof HTMLElement) hud.style.display = "none";
    world.resourceRoot.visible = false;
    for (const existing of [...simulation.getEntities()]) {
      simulation.remove(existing.x, existing.y);
    }
    simulation.drainEvents();

    const placements = [];
    const place = (kind, x, y, direction = 1, options = {}) => {
      const result = simulation.place(kind, x, y, direction, options);
      if (!result.ok) {
        throw new Error(
          `Pass3 placement failed for ${kind}@${x},${y}: ${result.reason}`,
        );
      }
      placements.push({
        id: result.entity.id,
        kind: result.entity.kind,
        x: result.entity.x,
        y: result.entity.y,
      });
      return result.entity;
    };
    const connect = (
      color,
      first,
      firstConnector,
      second,
      secondConnector,
    ) => {
      if (
        !simulation.connectCircuitWire(
          color,
          { entityId: first.id, connector: firstConnector },
          { entityId: second.id, connector: secondConnector },
        )
      ) {
        throw new Error(
          `Pass3 wire failed: ${color} ${first.id}:${firstConnector} -> ${second.id}:${secondConnector}`,
        );
      }
    };

    // Compact main logic spine. Every link remains short, fully on-camera and
    // lands on an authoritative input/output/io face.
    const input = place("constantCombinator", 12, 6);
    const arithmetic = place("arithmeticCombinator", 14, 6);
    const decider = place("deciderCombinator", 16, 6);
    const fabricator = place(
      "fabricator",
      18,
      5,
      1,
      { recipeId: "copperWire" },
    );

    const feed = circuitSignal("virtual", "feed");
    const tripled = circuitSignal("virtual", "tripled");
    const run = circuitSignal("virtual", "run");
    const configureInput = (enabled, value = 3) => {
      if (
        !simulation.configureCircuitDevice(input.id, {
          kind: "constant",
          enabled,
          signals: [{ signal: feed, value }],
        })
      ) {
        throw new Error("Could not configure the pass3 input source.");
      }
    };
    configureInput(false);
    if (
      !simulation.configureCircuitDevice(arithmetic.id, {
        kind: "arithmetic",
        left: circuitOperand(feed),
        operator: "multiply",
        right: circuitConstant(3),
        output: tripled,
      })
    ) {
      throw new Error("Could not configure the pass3 arithmetic stage.");
    }
    if (
      !simulation.configureCircuitDevice(decider.id, {
        kind: "decider",
        condition: {
          left: tripled,
          operator: ">",
          right: circuitConstant(8),
        },
        output: run,
        outputMode: "one",
      })
    ) {
      throw new Error("Could not configure the pass3 decider stage.");
    }
    if (
      !simulation.configureCircuitMachinePort(fabricator.id, {
        enableCondition: {
          left: run,
          operator: ">",
          right: circuitConstant(0),
        },
      })
    ) {
      throw new Error("Could not configure the pass3 fabricator control.");
    }

    connect("red", input, "output", arithmetic, "input");
    connect("green", arithmetic, "output", decider, "input");
    connect("red", decider, "output", fabricator, "io");

    simulation.step(8);
    simulation.drainEvents();

    const circuitRenderer = world.circuitRenderer;
    if (!circuitRenderer) {
      throw new Error("WorldRenderer has no integrated circuit renderer.");
    }
    const ids = {
      input: input.id,
      arithmetic: arithmetic.id,
      decider: decider.id,
      fabricator: fabricator.id,
      outputInserter: null,
      outputStorage: null,
    };
    const installOutputCell = () => {
      if (
        Number.isSafeInteger(ids.outputInserter) &&
        Number.isSafeInteger(ids.outputStorage)
      ) {
        return {
          outputInserter: ids.outputInserter,
          outputStorage: ids.outputStorage,
          alreadyInstalled: true,
        };
      }
      // The short physical output route is installed only after the causal
      // triptych, whose fixed camera proves exactly source -> math -> verdict
      // -> machine without unrelated edge fragments.
      const outputInserter = place("inserter", 20, 6, 1);
      const outputStorage = place("storage", 21, 5);
      ids.outputInserter = outputInserter.id;
      ids.outputStorage = outputStorage.id;
      simulation.receive(outputStorage.id, "copperWire", 24, "inventory");
      simulation.step(2);
      simulation.drainEvents();
      return {
        outputInserter: outputInserter.id,
        outputStorage: outputStorage.id,
        alreadyInstalled: false,
        route:
          "fabricator -> grounded adjacent inserter -> stocked steel depot",
        destinationInventory: {
          copperWire:
            simulation.getEntity(outputStorage.id)?.inventory.copperWire ?? 0,
        },
      };
    };
    window.__CIRCUIT_PASS3__ = {
      simulation,
      world,
      circuitRenderer,
      toRenderSnapshot,
      configureInput,
      installOutputCell,
      ids,
    };
    world.setSelected(null);
    world.focus(16.5, 6.7);
    world.viewWidth = 17.8;
    world.resize();

    const snapshot = simulation.getRenderSnapshot();
    const adapted = toRenderSnapshot(snapshot);
    world.sync(adapted);
    world.getRailRendererIntegration().root.visible = false;
    world.update(0, snapshot.elapsedSeconds);
    world.render(0);
    world.render(0);
    world.renderer.getContext().finish();
    return {
      placements,
      exactSnapshotIdentity: adapted.circuit === snapshot.circuit,
      textureAsset:
        circuitRenderer.materials.textures[0]?.userData.authoredAsset ?? null,
      mainPortId: `entity:${fabricator.id}:machine`,
      startTick: simulation.tickCount,
    };
  });

  const capture = async (
    name,
    {
      steps = 0,
      focus = [16.5, 6.7],
      viewWidth = 17.8,
      fullPage = false,
    } = {},
  ) => {
    const state = await page.evaluate(
      ({ steps: count, focus: target, viewWidth: width }) => {
        const qa = window.__CIRCUIT_PASS3__;
        if (!qa) throw new Error("Circuit pass3 fixture is unavailable.");
        qa.simulation.step(count);
        const snapshot = qa.simulation.getRenderSnapshot();
        const adapted = qa.toRenderSnapshot(snapshot);
        qa.world.sync(adapted);
        qa.world.getRailRendererIntegration().root.visible = false;
        qa.world.focus(target[0], target[1]);
        qa.world.viewWidth = width;
        qa.world.resize();
        qa.circuitRenderer.update(snapshot.elapsedSeconds);
        qa.world.render(0);
        qa.world.render(0);
        qa.world.renderer.getContext().finish();

        const meters = {};
        const machineResponses = {};
        const names = [];
        const criticalObjects = new Map();
        const circuitLabels = new Map([
          [qa.ids.input, "input"],
          [qa.ids.arithmetic, "arithmetic"],
          [qa.ids.decider, "decider"],
        ]);
        qa.circuitRenderer.root.traverse((object) => {
          names.push(object.name);
          if (
            object.userData.entityId !== undefined &&
            Array.isArray(object.userData.meterReadout)
          ) {
            meters[object.userData.entityId] = {
              lines: object.userData.meterReadout,
              input: object.userData.meterInputValue,
              operand: object.userData.meterOperandValue,
              output: object.userData.meterOutputValue,
            };
            const label = circuitLabels.get(object.userData.entityId);
            if (label && object.name.endsWith("-rig")) {
              criticalObjects.set(label, object);
            }
          }
          if (object.userData.actualConnectedMachineResponse === true) {
            machineResponses[object.userData.portId] = {
              enabled: object.userData.enabled,
              motion: object.userData.mechanicalMotion,
              heat: object.userData.processHeat,
              productPath: object.userData.productPath,
              exhaust: object.userData.exhaust,
              channels: object.userData.responseChannels,
            };
            if (object.userData.machineEntityId === qa.ids.fabricator) {
              criticalObjects.set("machineResponse", object);
            }
          }
        });
        for (const object of qa.world.entityRoot.children) {
          const entityId = object.userData.entityId;
          if (entityId === qa.ids.fabricator) {
            criticalObjects.set("nativeMachine", object);
          } else if (entityId === qa.ids.outputInserter) {
            criticalObjects.set("outputInserter", object);
          } else if (entityId === qa.ids.outputStorage) {
            criticalObjects.set("outputStorage", object);
          }
        }
        const canvasRect = qa.world.canvas.getBoundingClientRect();
        const criticalBounds = {};
        for (const [label, object] of criticalObjects) {
          const points = [];
          object.updateWorldMatrix(true, true);
          object.traverse((child) => {
            let visibilityNode = child;
            while (visibilityNode) {
              if (visibilityNode.visible === false) return;
              if (visibilityNode === object) break;
              visibilityNode = visibilityNode.parent;
            }
            const geometry = child.geometry;
            if (!geometry?.attributes?.position) return;
            geometry.computeBoundingBox();
            const box = geometry.boundingBox;
            if (!box) return;
            const instanceCount =
              child.isInstancedMesh === true ? child.count : 1;
            for (let instanceIndex = 0; instanceIndex < instanceCount; instanceIndex += 1) {
              const transform = child.matrixWorld.clone();
              if (child.isInstancedMesh === true) {
                child.getMatrixAt(instanceIndex, transform);
                transform.premultiply(child.matrixWorld);
              }
              for (const x of [box.min.x, box.max.x]) {
                for (const y of [box.min.y, box.max.y]) {
                  for (const z of [box.min.z, box.max.z]) {
                    const projected = box.min
                      .clone()
                      .set(x, y, z)
                      .applyMatrix4(transform)
                      .project(qa.world.camera);
                    points.push([
                      (projected.x + 1) * 0.5 * canvasRect.width,
                      (1 - projected.y) * 0.5 * canvasRect.height,
                    ]);
                  }
                }
              }
            }
          });
          if (points.length === 0) continue;
          const xs = points.map((point) => point[0]);
          const ys = points.map((point) => point[1]);
          const bounds = {
            left: Math.min(...xs),
            top: Math.min(...ys),
            right: Math.max(...xs),
            bottom: Math.max(...ys),
          };
          criticalBounds[label] = {
            ...bounds,
            intersects:
              bounds.right > 2 &&
              bounds.bottom > 2 &&
              bounds.left < canvasRect.width - 2 &&
              bounds.top < canvasRect.height - 2,
            complete:
              bounds.left >= 2 &&
              bounds.top >= 2 &&
              bounds.right <= canvasRect.width - 2 &&
              bounds.bottom <= canvasRect.height - 2,
          };
        }
        const controls = Object.fromEntries(
          snapshot.circuit.machineControls.map((control) => [
            control.portId,
            {
              enabled: control.enabled,
              powerSwitchClosed: control.powerSwitchClosed,
            },
          ]),
        );
        const requiredActorLabels = [
          "input",
          "arithmetic",
          "decider",
          "nativeMachine",
          "machineResponse",
        ];
        const partialActors = Object.entries(criticalBounds)
          .filter(([, bounds]) =>
            bounds.intersects === true && bounds.complete !== true
          )
          .map(([label]) => label);
        const cropAssertions = {
          requiredActors: requiredActorLabels,
          requiredActorBounds: Object.fromEntries(
            requiredActorLabels.map((label) => [
              label,
              criticalBounds[label] ?? null,
            ]),
          ),
          allRequiredComplete: requiredActorLabels.every(
            (label) => criticalBounds[label]?.complete === true,
          ),
          partialActors,
          noPartialActors: partialActors.length === 0,
          outputCellInstalled:
            Number.isSafeInteger(qa.ids.outputInserter) &&
            Number.isSafeInteger(qa.ids.outputStorage),
        };
        return {
          tick: snapshot.tick,
          elapsed: snapshot.elapsedSeconds,
          meters,
          machineResponses,
          controls,
          names,
          debug: qa.circuitRenderer.getDebug(),
          camera: {
            focus: [target[0], target[1]],
            viewWidth: qa.world.viewWidth,
          },
          cropAssertions,
          criticalBounds,
        };
      },
      { steps, focus, viewWidth },
    );
    if (fullPage) {
      await page.screenshot({
        path: `${OUTPUT_DIRECTORY}/${name}.png`,
      });
    } else {
      await page.locator("#world").screenshot({
        path: `${OUTPUT_DIRECTORY}/${name}.png`,
      });
    }
    return state;
  };

  await page.evaluate(() => {
    const qa = window.__CIRCUIT_PASS3__;
    if (!qa) throw new Error("Circuit pass3 fixture is unavailable.");
    qa.configureInput(true, 1);
  });
  const causalInput = await capture("00-causal-input", {
    steps: 4,
    focus: [16.2, 6.25],
    viewWidth: 10.2,
  });
  await page.evaluate(() => {
    const qa = window.__CIRCUIT_PASS3__;
    if (!qa) throw new Error("Circuit pass3 fixture is unavailable.");
    qa.configureInput(true, 2);
  });
  const causalArithmetic = await capture("01-causal-arithmetic", {
    steps: 4,
    focus: [16.2, 6.25],
    viewWidth: 10.2,
  });
  await page.evaluate(() => {
    const qa = window.__CIRCUIT_PASS3__;
    if (!qa) throw new Error("Circuit pass3 fixture is unavailable.");
    qa.configureInput(true, 6);
  });
  const causalDecider = await capture("02-causal-decider", {
    steps: 4,
    focus: [16.2, 6.25],
    viewWidth: 10.2,
  });
  fixture.outputCell = await page.evaluate(() => {
    const qa = window.__CIRCUIT_PASS3__;
    if (!qa) throw new Error("Circuit pass3 fixture is unavailable.");
    return qa.installOutputCell();
  });
  const machineEnabled = await capture("03-machine-enabled", {
    steps: 2,
    focus: [19.1, 6.25],
    viewWidth: 8.2,
  });

  await page.evaluate(() => {
    const qa = window.__CIRCUIT_PASS3__;
    if (!qa) throw new Error("Circuit pass3 fixture is unavailable.");
    qa.configureInput(false, 6);
  });
  const machineDisabled = await capture("04-machine-disabled", {
    steps: 4,
    focus: [19.1, 6.25],
    viewWidth: 8.2,
  });

  await page.evaluate(() => {
    const qa = window.__CIRCUIT_PASS3__;
    if (!qa) throw new Error("Circuit pass3 fixture is unavailable.");
    qa.configureInput(true, 6);
  });
  await capture("05-cabinet-line-close", {
    steps: 4,
    focus: [14.5, 6.5],
    viewWidth: 7.2,
  });
  await capture("06-wire-endpoints-close", {
    focus: [15.5, 6.5],
    viewWidth: 5.6,
  });
  const hero = await capture("07-industrial-district-hero", {
    focus: [16.9, 6.35],
    viewWidth: 12.5,
  });

  const ordinarySetup = await page.evaluate(() => {
    const qa = window.__CIRCUIT_PASS3__;
    if (!qa) throw new Error("Circuit pass3 fixture is unavailable.");
    const hud = document.querySelector("#hud");
    if (hud instanceof HTMLElement) hud.style.display = "";
    qa.world.focus(16.9, 6.35);
    qa.world.viewWidth = 13.5;
    qa.world.resize();
    qa.world.render(0);
    qa.world.render(0);
    qa.world.renderer.getContext().finish();
    qa.circuitRenderer.root.updateMatrixWorld(true);
    const canvasRect = document
      .querySelector("#world")
      ?.getBoundingClientRect();
    const hudRects = [
      [".hud-topbar", "topbar"],
      [".mission-panel", "mission"],
      [".minimap-shell", "minimap"],
      [".build-dock", "build-dock"],
    ].flatMap(([selector, label]) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return [];
      const rect = element.getBoundingClientRect();
      return [{
        label,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      }];
    });
    const subjectObjects = [];
    qa.circuitRenderer.root.traverse((object) => {
      if (
        object.name.endsWith("-rig") &&
        [
          qa.ids.input,
          qa.ids.arithmetic,
          qa.ids.decider,
        ].includes(object.userData.entityId)
      ) {
        subjectObjects.push(object);
      }
      if (
        object.userData.actualConnectedMachineResponse === true &&
        object.userData.machineEntityId === qa.ids.fabricator
      ) {
        subjectObjects.push(object);
      }
    });
    const subjectMetrics =
      canvasRect === undefined
        ? []
        : subjectObjects.map((object) => {
            const point = object.position.clone();
            object.getWorldPosition(point);
            point.project(qa.world.camera);
            const screenX =
              canvasRect.left + (point.x + 1) * 0.5 * canvasRect.width;
            const screenY =
              canvasRect.top + (1 - point.y) * 0.5 * canvasRect.height;
            const radius = object.userData.actualConnectedMachineResponse
              ? 118
              : 58;
            const overlaps = hudRects
              .filter(
                (rect) =>
                  screenX + radius > rect.left &&
                  screenX - radius < rect.right &&
                  screenY + radius > rect.top &&
                  screenY - radius < rect.bottom,
              )
              .map((rect) => rect.label);
            return {
              name: object.name,
              entityId: object.userData.entityId,
              screen: [screenX, screenY],
              radius,
              overlaps,
            };
          });
    return {
      viewport: [window.innerWidth, window.innerHeight],
      viewWidth: qa.world.viewWidth,
      hudVisible:
        hud instanceof HTMLElement &&
        window.getComputedStyle(hud).display !== "none",
      hudRects,
      subjectMetrics,
      overlapCount: subjectMetrics.reduce(
        (total, subject) => total + subject.overlaps.length,
        0,
      ),
    };
  });
  await page.screenshot({
    path: `${OUTPUT_DIRECTORY}/08-ordinary-full-ui.png`,
  });
  await page.evaluate(() => {
    const hud = document.querySelector("#hud");
    if (hud instanceof HTMLElement) hud.style.display = "none";
  });
  const pureCanvas = await capture("09-pure-canvas", {
    focus: [16.9, 6.35],
    viewWidth: 12.5,
  });

  const causalFrames = [causalInput, causalArithmetic, causalDecider];
  const meterSequence = causalFrames.map((stage) => ({
    input: stage.meters[fixture.placements.find(
      (entry) => entry.kind === "constantCombinator" && entry.x === 12,
    ).id],
    arithmetic: stage.meters[fixture.placements.find(
      (entry) => entry.kind === "arithmeticCombinator" && entry.x === 14,
    ).id],
    decider: stage.meters[fixture.placements.find(
      (entry) => entry.kind === "deciderCombinator" && entry.x === 16,
    ).id],
  }));

  assert(fixture.exactSnapshotIdentity, "Renderer did not use exact snapshot.");
  assert(
    fixture.textureAsset === "/assets/cinder-painted-steel-aged-v2.png",
    "Authored aged cabinet surface is not bound.",
  );
  assert(
    new Set(
      meterSequence.map((entry) => JSON.stringify(entry)),
    ).size === 3,
    "Three causal frames do not have three distinct visible meter states.",
  );
  assert(
    causalFrames.every(
      (stage) =>
        stage.camera.viewWidth === 10.2 &&
        stage.camera.focus[0] === 16.2 &&
        stage.camera.focus[1] === 6.25 &&
        stage.cropAssertions !== null &&
        stage.cropAssertions.allRequiredComplete === true &&
        stage.cropAssertions.noPartialActors === true &&
        stage.cropAssertions.outputCellInstalled === false &&
        stage.criticalBounds.outputInserter === undefined &&
        stage.criticalBounds.outputStorage === undefined,
    ),
    "Causal evidence camera or fragment-free output isolation regressed.",
  );
  assert(
    causalInput.controls[fixture.mainPortId]?.enabled === false &&
      causalArithmetic.controls[fixture.mainPortId]?.enabled === false &&
      causalDecider.controls[fixture.mainPortId]?.enabled === true &&
      causalInput.machineResponses[fixture.mainPortId]?.motion === "parked" &&
      causalArithmetic.machineResponses[fixture.mainPortId]?.motion ===
        "parked" &&
      causalDecider.machineResponses[fixture.mainPortId]?.motion === "running",
    "Triptych does not visibly cross the threshold at the controlled machine.",
  );
  assert(
    causalFrames.every((stage) =>
      [
        "input",
        "arithmetic",
        "decider",
        "nativeMachine",
        "machineResponse",
      ].every(
        (label) => stage.criticalBounds[label]?.complete === true,
      )
    ),
    `A causal cabinet or the controlled machine is cropped in the triptych: ${JSON.stringify(
      causalFrames.map((stage) => stage.criticalBounds),
    )}`,
  );
  assert(
    meterSequence.at(-1).input.input === 6 &&
      meterSequence.at(-1).arithmetic.input === 6 &&
      meterSequence.at(-1).arithmetic.operand === 3 &&
      meterSequence.at(-1).arithmetic.output === 18 &&
      meterSequence.at(-1).decider.input === 18 &&
      meterSequence.at(-1).decider.operand === 8 &&
      meterSequence.at(-1).decider.output === 1,
    "Final causal frame does not visibly map the authoritative chain.",
  );
  assert(
    fixture.outputCell.alreadyInstalled === false &&
      fixture.outputCell.destinationInventory.copperWire === 24,
    "Physical output cell was not installed and stocked after causal proof.",
  );
  assert(
    machineEnabled.controls[fixture.mainPortId]?.enabled === true &&
      machineEnabled.machineResponses[fixture.mainPortId]?.motion ===
        "running" &&
      machineEnabled.machineResponses[fixture.mainPortId]?.heat === "hot" &&
      machineEnabled.machineResponses[fixture.mainPortId]?.productPath ===
        "occupied-moving" &&
      machineEnabled.machineResponses[fixture.mainPortId]?.exhaust ===
        "flowing",
    "Enabled actual-machine response is incomplete.",
  );
  assert(
    machineDisabled.controls[fixture.mainPortId]?.enabled === false &&
      machineDisabled.machineResponses[fixture.mainPortId]?.motion ===
        "parked" &&
      machineDisabled.machineResponses[fixture.mainPortId]?.heat === "cold" &&
      machineDisabled.machineResponses[fixture.mainPortId]?.productPath ===
        "empty" &&
      machineDisabled.machineResponses[fixture.mainPortId]?.exhaust ===
        "stopped",
    "Disabled actual-machine response is incomplete.",
  );
  assert(
    [machineEnabled, machineDisabled].every((stage) =>
      [
        "decider",
        "nativeMachine",
        "machineResponse",
        "outputInserter",
        "outputStorage",
      ].every(
        (label) => stage.criticalBounds[label]?.complete === true,
      ) &&
      ["input", "arithmetic"].every(
        (label) => stage.criticalBounds[label]?.intersects === false,
      ) &&
      stage.cropAssertions.noPartialActors === true &&
      stage.cropAssertions.outputCellInstalled === true,
    ),
    `Machine state pair crops its comparator, machine, or output destination: ${JSON.stringify(
      [machineEnabled.criticalBounds, machineDisabled.criticalBounds],
    )}`,
  );
  assert(
    hero.debug.causalMeters >= 3 &&
      hero.debug.machineProcessRigs >= 1 &&
      hero.debug.districtModules >= 9 &&
      hero.debug.districtTraySegments >= 2,
    "Renderer-owned industrial district is incomplete.",
  );
  assert(
    [
      "input",
      "arithmetic",
      "decider",
      "nativeMachine",
      "outputInserter",
      "outputStorage",
    ].every((label) => hero.criticalBounds[label]?.complete === true),
    "Industrial hero crops a required control-cell actor.",
  );
  assert(
    hero.cropAssertions.noPartialActors === true &&
      hero.cropAssertions.outputCellInstalled === true,
    "Industrial hero contains a partial actor or lacks its output cell.",
  );
  assert(
    hero.debug.presentationPulses === 0 &&
      hero.debug.pulses === 0 &&
      hero.debug.cableSupports === 0,
    "Presentation regressed to debug packets or invented supports.",
  );
  assert(
    ordinarySetup.hudVisible &&
      ordinarySetup.viewWidth === 13.5 &&
      ordinarySetup.overlapCount === 0,
    "Ordinary full-UI evidence did not preserve gameplay HUD and camera.",
  );
  assert(
    pureCanvas.debug.wireSag.spanScaled &&
      pureCanvas.debug.wireSag.minimum >= 0.055,
    "Physical cable sag contract failed.",
  );
  assert(errors.length === 0, `Browser errors: ${errors.join(" | ")}`);

  const proof = {
    fixture,
    causalFrames,
    meterSequence,
    machineEnabled,
    machineDisabled,
    hero,
    ordinarySetup,
    pureCanvas,
    errors,
  };
  await writeFile(
    `${OUTPUT_DIRECTORY}/visual-proof.json`,
    `${JSON.stringify(proof, null, 2)}\n`,
    "utf8",
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        outputDirectory: OUTPUT_DIRECTORY,
        images: [
          "00-causal-input.png",
          "01-causal-arithmetic.png",
          "02-causal-decider.png",
          "03-machine-enabled.png",
          "04-machine-disabled.png",
          "05-cabinet-line-close.png",
          "06-wire-endpoints-close.png",
          "07-industrial-district-hero.png",
          "08-ordinary-full-ui.png",
          "09-pure-canvas.png",
        ],
        proof: `${OUTPUT_DIRECTORY}/visual-proof.json`,
        debug: hero.debug,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
