import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY =
  ".qa/circuit-network/pass2-work-iteration5";

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
    `${BASE_URL.replace(/\/$/, "")}/?fresh=circuit-pass2-visual-qa`,
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
          `Authoritative circuit placement failed for ${kind}: ${result.reason}`,
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
          `Authoritative circuit wire failed: ${color} ${first.id}:${firstConnector} -> ${second.id}:${secondConnector}`,
        );
      }
    };

    // The complete input -> arithmetic -> decision -> real fabricator chain
    // stays to the right of the ordinary mission HUD. A compact live copper
    // cell provides honest factory density without a showcase-length belt
    // wall: four belts, two inserters, a fueled generator, and a physical
    // output depot surround the circuit-controlled fabricator.
    const constant = place("constantCombinator", 9, 6);
    const arithmetic = place("arithmeticCombinator", 12, 6);
    const decider = place("deciderCombinator", 15, 6);
    const fabricator = place(
      "fabricator",
      17,
      9,
      1,
      { recipeId: "copperWire" },
    );
    const storage = place("storage", 7, 5);
    const routeConstant = place("constantCombinator", 10, 13);
    const routeDecider = place("deciderCombinator", 13, 13);
    const pump = place("fluidPump", 16, 13);
    place("fluidSource", 17, 12);
    const belts = [];
    for (let x = 12; x <= 15; x += 1) {
      belts.push(place("belt", x, 10));
    }
    const inputArm = place("inserter", 16, 10);
    const outputArm = place("inserter", 20, 10);
    const outputStorage = place("storage", 21, 9);
    const generator = place("generator", 19, 13);

    const run = circuitSignal("virtual", "run");
    const scaled = circuitSignal("virtual", "scaled");
    const go = circuitSignal("virtual", "go");
    const route = circuitSignal("virtual", "route");
    const gate = circuitSignal("virtual", "gate");
    const iron = circuitSignal("item", "ironPlate");

    const configureSources = (enabled) => {
      if (
        !simulation.configureCircuitDevice(constant.id, {
          kind: "constant",
          enabled,
          signals: [
            { signal: run, value: 1 },
            { signal: iron, value: 24 },
          ],
        })
      ) {
        throw new Error("Could not configure the authoritative input cabinet.");
      }
      if (
        !simulation.configureCircuitDevice(routeConstant.id, {
          kind: "constant",
          enabled,
          signals: [{ signal: route, value: 1 }],
        })
      ) {
        throw new Error("Could not configure the authoritative route cabinet.");
      }
    };
    configureSources(false);
    if (
      !simulation.configureCircuitDevice(arithmetic.id, {
        kind: "arithmetic",
        left: circuitOperand(run),
        operator: "multiply",
        right: circuitConstant(2),
        output: scaled,
      })
    ) {
      throw new Error("Could not configure the authoritative arithmetic cabinet.");
    }
    if (
      !simulation.configureCircuitDevice(decider.id, {
        kind: "decider",
        condition: {
          left: scaled,
          operator: ">=",
          right: circuitConstant(2),
        },
        output: go,
        outputMode: "one",
      })
    ) {
      throw new Error("Could not configure the authoritative decider cabinet.");
    }
    if (
      !simulation.configureCircuitDevice(routeDecider.id, {
        kind: "decider",
        condition: {
          left: route,
          operator: ">",
          right: circuitConstant(0),
        },
        output: gate,
        outputMode: "one",
      })
    ) {
      throw new Error("Could not configure the authoritative route decider.");
    }
    if (
      !simulation.configureCircuitMachinePort(fabricator.id, {
        enableCondition: {
          left: go,
          operator: ">",
          right: circuitConstant(0),
        },
      })
    ) {
      throw new Error("Could not configure the authoritative fabricator control.");
    }
    if (
      !simulation.configureCircuitMachinePort(pump.id, {
        powerSwitchCondition: {
          left: gate,
          operator: ">",
          right: circuitConstant(0),
        },
      })
    ) {
      throw new Error("Could not configure the authoritative pump control.");
    }

    connect("red", constant, "output", arithmetic, "input");
    connect("green", arithmetic, "output", decider, "input");
    connect("red", decider, "output", fabricator, "io");
    connect("green", constant, "output", storage, "io");
    connect("green", routeConstant, "output", routeDecider, "input");
    connect("red", routeDecider, "output", pump, "io");

    const fuelAccepted = simulation.receive(
      generator.id,
      "coal",
      12,
      "fuel",
    );
    const stagedCopper = simulation.receive(
      belts.at(-1).id,
      "copperPlate",
      1,
      "belt",
      0,
    );
    const stagedCopperB = simulation.receive(
      belts.at(-2).id,
      "copperPlate",
      1,
      "belt",
      1,
    );
    const storedWire = simulation.receive(
      outputStorage.id,
      "copperWire",
      8,
      "inventory",
    );
    if (
      fuelAccepted !== 12 ||
      stagedCopper !== 1 ||
      stagedCopperB !== 1 ||
      storedWire !== 8
    ) {
      throw new Error("Could not seed the authoritative live production cell.");
    }
    simulation.step(44);
    simulation.receive(belts[0].id, "copperPlate", 1, "belt", 0);
    simulation.receive(belts[1].id, "copperPlate", 1, "belt", 1);
    configureSources(true);
    simulation.drainEvents();

    const circuitRenderer = world.circuitRenderer;
    if (!circuitRenderer) {
      throw new Error("WorldRenderer has no integrated circuit renderer.");
    }
    window.__CIRCUIT_PASS2__ = {
      simulation,
      world,
      circuitRenderer,
      toRenderSnapshot,
      configureSources,
      ids: {
        constant: constant.id,
        arithmetic: arithmetic.id,
        decider: decider.id,
        fabricator: fabricator.id,
        routeConstant: routeConstant.id,
        routeDecider: routeDecider.id,
        pump: pump.id,
        belts: belts.map((belt) => belt.id),
        inputArm: inputArm.id,
        outputArm: outputArm.id,
        outputStorage: outputStorage.id,
        generator: generator.id,
      },
    };
    world.setSelected(null);
    world.focus(14.5, 9.5);
    world.viewWidth = 18;
    world.resize();

    const initialSnapshot = simulation.getRenderSnapshot();
    const adapted = toRenderSnapshot(initialSnapshot);
    world.sync(adapted);
    world.update(0, initialSnapshot.elapsedSeconds);
    world.render(0);
    world.render(0);
    world.renderer.getContext().finish();
    return {
      placements,
      startingTick: simulation.tickCount,
      exactSnapshotIdentity: adapted.circuit === initialSnapshot.circuit,
      liveCell: {
        beltPayloads: belts.reduce(
          (total, belt) =>
            total +
            (simulation.getEntity(belt.id)?.beltItems.length ?? 0),
          0,
        ),
        inputHeld:
          simulation.getEntity(inputArm.id)?.heldItem ?? null,
        outputStored:
          simulation.getEntity(outputStorage.id)?.inventory.copperWire ?? 0,
        generatorFuel:
          simulation.getEntity(generator.id)?.fuel.coal ?? 0,
      },
      textureAsset:
        circuitRenderer.materials.textures[0]?.userData.authoredAsset ?? null,
    };
  });

  const captureStage = async (name, steps, focus = null, viewWidth = null) => {
    const state = await page.evaluate(
      ({ steps: stepCount, focus: nextFocus, viewWidth: nextWidth }) => {
        const qa = window.__CIRCUIT_PASS2__;
        if (!qa) throw new Error("Circuit pass-2 fixture is unavailable.");
        qa.simulation.step(stepCount);
        const snapshot = qa.simulation.getRenderSnapshot();
        const adapted = qa.toRenderSnapshot(snapshot);
        qa.world.sync(adapted);
        if (nextFocus) qa.world.focus(nextFocus[0], nextFocus[1]);
        if (nextWidth) {
          qa.world.viewWidth = nextWidth;
          qa.world.resize();
        }
        qa.circuitRenderer.update(snapshot.elapsedSeconds);
        qa.world.render(0);
        qa.world.render(0);
        qa.world.renderer.getContext().finish();

        const objectNames = [];
        qa.circuitRenderer.root.traverse((object) => objectNames.push(object.name));
        const controls = Object.fromEntries(
          snapshot.circuit.machineControls.map((control) => [
            control.portId,
            {
              enabled: control.enabled,
              powerSwitchClosed: control.powerSwitchClosed,
              sorterOutput: control.sorterOutput,
            },
          ]),
        );
        const deviceOutputs = Object.fromEntries(
          snapshot.circuit.devices.map((device) => {
            const endpoint = snapshot.circuit.endpoints.find(
              (candidate) => candidate.endpointId === device.outputEndpoint,
            );
            return [device.id, endpoint?.signals ?? []];
          }),
        );
        return {
          tick: qa.simulation.tickCount,
          elapsed: snapshot.elapsedSeconds,
          debug: qa.circuitRenderer.getDebug(),
          controls,
          deviceOutputs,
          objectNames,
          stateSignature: qa.circuitRenderer.getDebug().stateSignature,
        };
      },
      { steps, focus, viewWidth },
    );
    await page.locator("#world").screenshot({
      path: `${OUTPUT_DIRECTORY}/${name}.png`,
    });
    return state;
  };

  const stages = [];
  stages.push(await captureStage("00-input-read", 1));
  stages.push(await captureStage("01-arithmetic-evaluation", 1));
  stages.push(await captureStage("02-decider-output-write", 1));
  stages.push(await captureStage("03-machine-actuated-enabled", 1));
  stages.push(
    await captureStage(
      "04-control-cabinets-close",
      0,
      [12.6, 6.7],
      10,
    ),
  );
  stages.push(
    await captureStage(
      "05-machine-actuator-close",
      0,
      [17.8, 9.8],
      8,
    ),
  );

  await page.evaluate(() => {
    const qa = window.__CIRCUIT_PASS2__;
    if (!qa) throw new Error("Circuit pass-2 fixture is unavailable.");
    qa.configureSources(false);
    qa.world.focus(14.5, 9.5);
    qa.world.viewWidth = 18;
    qa.world.resize();
  });
  const disabled = await captureStage("06-district-disabled", 4);
  const disabledClose = await captureStage(
    "07-machine-actuator-close-disabled",
    0,
    [17.8, 9.8],
    8,
  );

  await page.evaluate(() => {
    const qa = window.__CIRCUIT_PASS2__;
    if (!qa) throw new Error("Circuit pass-2 fixture is unavailable.");
    qa.configureSources(true);
    qa.world.focus(14.5, 9.5);
    qa.world.viewWidth = 18;
    qa.world.resize();
  });
  const reenabled = await captureStage("08-district-hero-enabled", 4);
  const ordinaryPlayProof = await page.evaluate(() => {
    const qa = window.__CIRCUIT_PASS2__;
    if (!qa) throw new Error("Circuit pass-2 fixture is unavailable.");
    const hud = document.querySelector("#hud");
    if (hud instanceof HTMLElement) hud.style.display = "";
    qa.world.focus(14.5, 9.5);
    qa.world.viewWidth = 18;
    qa.world.resize();
    qa.world.render(0);
    qa.world.render(0);
    qa.world.renderer.getContext().finish();
    return {
      viewport: [window.innerWidth, window.innerHeight],
      hudVisible:
        hud instanceof HTMLElement &&
        window.getComputedStyle(hud).display !== "none",
      viewWidth: qa.world.viewWidth,
      focus: [14.5, 9.5],
    };
  });
  await page.screenshot({
    path: `${OUTPUT_DIRECTORY}/09-ordinary-play-full-ui.png`,
  });
  await page.evaluate(() => {
    const hud = document.querySelector("#hud");
    if (hud instanceof HTMLElement) hud.style.display = "none";
  });

  const structural = await page.evaluate(async () => {
    const qa = window.__CIRCUIT_PASS2__;
    if (!qa) throw new Error("Circuit pass-2 fixture is unavailable.");
    const snapshot = qa.simulation.getRenderSnapshot();
    const adapted = qa.toRenderSnapshot(snapshot);
    qa.circuitRenderer.sync(adapted);
    const wire = qa.circuitRenderer.root.getObjectByName(
      "circuit-wire-red-outer",
    );
    const first = wire
      ? Array.from(wire.instanceMatrix.array.slice(0, wire.count * 16))
      : [];
    qa.circuitRenderer.sync(adapted);
    const second = wire
      ? Array.from(wire.instanceMatrix.array.slice(0, wire.count * 16))
      : [];

    const raycaster = qa.world.raycaster;
    raycaster.ray.origin.set(9.5, 10, 6.5);
    raycaster.ray.direction.set(0, -1, 0);
    const hits = raycaster.intersectObject(qa.circuitRenderer.root, true);
    let pickedEntityId = null;
    for (const hit of hits) {
      if (hit.instanceId !== undefined) {
        const ids = hit.object.userData.entityIds;
        if (Array.isArray(ids) && ids[hit.instanceId] !== undefined) {
          pickedEntityId = ids[hit.instanceId];
          break;
        }
      }
      let current = hit.object;
      while (current) {
        if (current.userData.entityId !== undefined) {
          pickedEntityId = current.userData.entityId;
          break;
        }
        current = current.parent;
      }
      if (pickedEntityId !== null) break;
    }

    const names = [];
    qa.circuitRenderer.root.traverse((object) => names.push(object.name));
    const forbiddenPresentation = names.filter((name) =>
      /circuit-(?:pulse|wire-.*tracer|signal-(?:item|fluid|virtual))/.test(name),
    );
    const materialFacts = {
      redEmissive: qa.circuitRenderer.materials.wireRed.emissiveIntensity,
      greenEmissive: qa.circuitRenderer.materials.wireGreen.emissiveIntensity,
      surfaceName:
        qa.circuitRenderer.materials.constantHousing.bumpMap?.name ?? null,
      surfaceAsset:
        qa.circuitRenderer.materials.constantHousing.bumpMap?.userData
          .authoredAsset ??
        null,
    };
    const memoryBaseline = {
      geometries: qa.world.renderer.info.memory.geometries,
      textures: qa.world.renderer.info.memory.textures,
    };
    const { CircuitRenderer } = await import(
      "/src/render/CircuitRenderer.ts"
    );
    const probe = new CircuitRenderer(qa.world.entityRoot, {
      quality: "low",
      maxRenderedEndpoints: 8192,
      maxRenderedWires: 8192,
    });
    probe.root.name = "circuit-pass2-disposal-probe";
    probe.sync(adapted);
    qa.world.render(0);
    qa.world.renderer.getContext().finish();
    const beforeDispose = probe.getDebug();
    probe.dispose();
    probe.dispose();
    qa.world.render(0);
    qa.world.renderer.getContext().finish();
    return {
      deterministicMatrices: JSON.stringify(first) === JSON.stringify(second),
      pickedEntityId,
      expectedPick: qa.ids.constant,
      names,
      forbiddenPresentation,
      materialFacts,
      debug: qa.circuitRenderer.getDebug(),
      lowQualityDebug: beforeDispose,
      disposedDebug: probe.getDebug(),
      disposalRootRemaining: Boolean(
        qa.world.entityRoot.getObjectByName("circuit-pass2-disposal-probe"),
      ),
      memoryBaseline,
      memoryAfter: {
        geometries: qa.world.renderer.info.memory.geometries,
        textures: qa.world.renderer.info.memory.textures,
      },
    };
  });

  const fabricatorPort = `entity:${fixture.placements.find(
    (entry) => entry.kind === "fabricator",
  ).id}:machine`;
  const pumpPort = `entity:${fixture.placements.find(
    (entry) => entry.kind === "fluidPump",
  ).id}:machine`;
  assert(fixture.exactSnapshotIdentity, "Renderer did not use the exact snapshot.");
  assert(
    fixture.textureAsset === "/assets/cinder-painted-steel-aged-v2.png",
    "Authored Cinderline cabinet texture was not bound.",
  );
  assert(
    fixture.liveCell.beltPayloads >= 2 &&
      fixture.liveCell.outputStored >= 8 &&
      fixture.liveCell.generatorFuel > 0,
    "The ordinary-play proof is not backed by a live authoritative production cell.",
  );
  assert(
    new Set(stages.slice(0, 4).map((stage) => stage.stateSignature)).size >= 3,
    "One-tick causal stages did not produce distinct render state.",
  );
  assert(
    stages[3].controls[fabricatorPort]?.enabled === true &&
      stages[3].controls[pumpPort]?.powerSwitchClosed === true,
    "Enabled causal stage did not actuate both real targets.",
  );
  assert(
    disabled.controls[fabricatorPort]?.enabled === false &&
      disabled.controls[pumpPort]?.powerSwitchClosed === false,
    "Disabled causal stage did not visibly de-actuate both real targets.",
  );
  assert(
    reenabled.controls[fabricatorPort]?.enabled === true &&
      reenabled.controls[pumpPort]?.powerSwitchClosed === true,
    "Re-enabled causal stage did not restore both real targets.",
  );
  assert(
    structural.forbiddenPresentation.length === 0 &&
      structural.debug.presentationPulses === 0 &&
      structural.debug.pulses === 0,
    `Presentation still contains diagnostic glyphs: ${structural.forbiddenPresentation.join(", ")}`,
  );
  assert(
    structural.materialFacts.redEmissive === 0 &&
      structural.materialFacts.greenEmissive === 0,
    "Cable jackets are still emissive overlays.",
  );
  assert(
    structural.debug.wireSag.spanScaled &&
      structural.debug.wireSag.minimum >= 0.055 &&
      structural.debug.wireSag.maximum > structural.debug.wireSag.minimum,
    "Cable catenary is not span-scaled.",
  );
  assert(
      structural.names.includes("circuit-endpoint-red-strain-relief") &&
      structural.names.includes("circuit-endpoint-green-strain-relief") &&
      structural.names.includes("circuit-machine-actuator-shutter-open") &&
      structural.names.includes(
        "circuit-machine-actuator-shutter-closed-guide-rails-latches",
      ),
    "Physical connector or actuator hardware is incomplete.",
  );
  assert(
    ordinaryPlayProof.hudVisible &&
      ordinaryPlayProof.viewWidth === 18,
    "Ordinary play proof did not preserve the full HUD-safe camera.",
  );
  assert(
    structural.deterministicMatrices,
    "Identical authoritative frames produced different cable matrices.",
  );
  assert(
    structural.pickedEntityId === structural.expectedPick,
    "Cabinet picking did not resolve its authoritative entity.",
  );
  assert(
    structural.lowQualityDebug.quality === "low" &&
      structural.lowQualityDebug.detailedDevices <= 12,
    "Low-quality LOD did not cap detailed cabinets.",
  );
  assert(
    structural.disposedDebug.disposed &&
      structural.disposedDebug.resources.disposedGeometries ===
        structural.disposedDebug.resources.ownedGeometries &&
      structural.disposedDebug.resources.disposedMaterials ===
        structural.disposedDebug.resources.ownedMaterials &&
      structural.disposedDebug.resources.disposedTextures ===
        structural.disposedDebug.resources.ownedTextures &&
      !structural.disposalRootRemaining,
    "Circuit disposal did not release every owned resource exactly once.",
  );
  assert(errors.length === 0, `Browser errors: ${errors.join(" | ")}`);

  const proof = {
    fixture,
    stages,
    disabled,
    disabledClose,
    reenabled,
    ordinaryPlayProof,
    structural,
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
          "00-input-read.png",
          "01-arithmetic-evaluation.png",
          "02-decider-output-write.png",
          "03-machine-actuated-enabled.png",
          "04-control-cabinets-close.png",
          "05-machine-actuator-close.png",
          "06-district-disabled.png",
          "07-machine-actuator-close-disabled.png",
          "08-district-hero-enabled.png",
          "09-ordinary-play-full-ui.png",
        ],
        proof: `${OUTPUT_DIRECTORY}/visual-proof.json`,
        debug: structural.debug,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
