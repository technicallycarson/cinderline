import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY = ".qa/circuit-network";

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
  await page.goto(
    `${BASE_URL.replace(/\/$/, "")}/?fresh=circuit-visual-qa`,
    {
      waitUntil: "networkidle",
      timeout: 30_000,
    },
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#boot")?.classList.contains("is-done") &&
      Boolean(window.__CINDERLINE__?.renderer),
    undefined,
    { timeout: 20_000 },
  );

  const proof = await page.evaluate(async () => {
    const game = window.__CINDERLINE__;
    if (!game) throw new Error("Cinderline debug bridge is unavailable.");
    const world = game.renderer;
    const simulation = game.simulation;
    const [{ toRenderSnapshot }, circuitModule] =
      await Promise.all([
        import("/src/game/adapters.ts"),
        import("/src/game/circuit-network.ts"),
      ]);
    const {
      circuitSignal,
      circuitOperand,
      circuitConstant,
    } = circuitModule;
    document.querySelector("#boot")?.remove();
    const hud = document.querySelector("#hud");
    if (hud instanceof HTMLElement) hud.style.display = "none";
    world.resourceRoot.visible = false;

    for (const existing of [...simulation.getEntities()]) {
      simulation.remove(existing.x, existing.y);
    }
    simulation.drainEvents();

    const placements = [];
    const place = (
      kind,
      x,
      y,
      direction = 1,
      options = {},
    ) => {
      const result = simulation.place(kind, x, y, direction, options);
      if (!result.ok) {
        throw new Error(
          `Real circuit fixture placement failed for ${kind}: ${result.reason}`,
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
      const connected = simulation.connectCircuitWire(
        color,
        { entityId: first.id, connector: firstConnector },
        { entityId: second.id, connector: secondConnector },
      );
      if (!connected) {
        throw new Error(
          `Real circuit fixture wire failed: ${color} ${first.id}:${firstConnector} → ${second.id}:${secondConnector}`,
        );
      }
    };

    const constantA = place("constantCombinator", 3, 7);
    const arithmetic = place("arithmeticCombinator", 7, 7);
    const deciderA = place("deciderCombinator", 11, 7);
    const inserter = place("inserter", 15, 7);
    const storage = place("storage", 3, 11);
    const constantB = place("constantCombinator", 7, 11);
    const deciderB = place("deciderCombinator", 11, 11);
    const manifold = place("manifold", 15, 11);
    const pump = place("fluidPump", 18, 9);
    const run = circuitSignal("virtual", "run");
    const scaled = circuitSignal("virtual", "scaled");
    const go = circuitSignal("virtual", "go");
    const route = circuitSignal("virtual", "route");
    const gate = circuitSignal("virtual", "gate");
    const iron = circuitSignal("item", "ironPlate");
    const copper = circuitSignal("item", "copperPlate");
    const refined = circuitSignal("fluid", "refinedFuel");

    if (!simulation.configureCircuitDevice(constantA.id, {
      kind: "constant",
      signals: [
        { signal: run, value: 1 },
        { signal: iron, value: 12 },
        { signal: circuitSignal("virtual", "clock"), value: 3 },
      ],
    })) {
      throw new Error("Could not configure real primary constant terminal.");
    }
    if (!simulation.configureCircuitDevice(arithmetic.id, {
      kind: "arithmetic",
      left: circuitOperand(run),
      operator: "multiply",
      right: circuitConstant(2),
      output: scaled,
    })) {
      throw new Error("Could not configure real arithmetic engine.");
    }
    if (!simulation.configureCircuitDevice(deciderA.id, {
      kind: "decider",
      condition: {
        left: scaled,
        operator: ">=",
        right: circuitConstant(2),
      },
      output: go,
      outputMode: "one",
    })) {
      throw new Error("Could not configure real primary decider.");
    }
    if (!simulation.configureCircuitDevice(constantB.id, {
      kind: "constant",
      signals: [
        { signal: route, value: 1 },
        { signal: copper, value: 20 },
        { signal: refined, value: 5_000 },
      ],
    })) {
      throw new Error("Could not configure real routing constant terminal.");
    }
    if (!simulation.configureCircuitDevice(deciderB.id, {
      kind: "decider",
      condition: {
        left: route,
        operator: ">",
        right: circuitConstant(0),
      },
      output: gate,
      outputMode: "one",
    })) {
      throw new Error("Could not configure real routing decider.");
    }
    if (!simulation.configureCircuitMachinePort(inserter.id, {
      enableCondition: {
        left: go,
        operator: ">",
        right: circuitConstant(0),
      },
      filter: {
        candidates: [iron, copper],
        minimum: 1,
      },
    })) {
      throw new Error("Could not configure real inserter circuit port.");
    }
    if (!simulation.configureCircuitMachinePort(manifold.id, {
      sorterRoutes: [{
        priority: 0,
        output: "B",
        condition: {
          left: gate,
          operator: ">",
          right: circuitConstant(0),
        },
      }],
      sorterFallback: "A",
    })) {
      throw new Error("Could not configure real manifold circuit port.");
    }
    if (!simulation.configureCircuitMachinePort(pump.id, {
      powerSwitchCondition: {
        left: gate,
        operator: ">",
        right: circuitConstant(0),
      },
    })) {
      throw new Error("Could not configure real pump circuit port.");
    }

    connect("red", constantA, "output", arithmetic, "input");
    connect("red", constantA, "output", storage, "io");
    connect("green", storage, "io", arithmetic, "input");
    connect("green", arithmetic, "output", deciderA, "input");
    connect("red", deciderA, "output", inserter, "io");
    connect("red", deciderA, "output", manifold, "io");
    connect("green", constantB, "output", deciderB, "input");
    connect("green", constantB, "output", storage, "io");
    connect("green", arithmetic, "output", deciderB, "input");
    connect("red", deciderB, "output", manifold, "io");
    connect("green", deciderB, "output", pump, "io");
    connect("red", constantB, "output", inserter, "io");

    simulation.drainEvents();
    const startingTick = simulation.tickCount;
    simulation.step(10);
    const simulationSnapshot = simulation.getRenderSnapshot();
    const adapted = toRenderSnapshot(simulationSnapshot);
    world.sync(adapted);
    world.setSelected(null);
    world.focus(10.5, 10);
    world.viewWidth = 20.5;
    world.resize();
    world.update(0, simulationSnapshot.elapsedSeconds);
    world.render(0);
    world.renderer.getContext().finish();
    const memoryBaseline = {
      geometries: world.renderer.info.memory.geometries,
      textures: world.renderer.info.memory.textures,
    };

    const circuitRenderer = world.circuitRenderer;
    if (!circuitRenderer) {
      throw new Error("WorldRenderer has no integrated circuit renderer.");
    }
    window.__CIRCUIT_VISUAL_QA__ = circuitRenderer;
    circuitRenderer.update(simulationSnapshot.elapsedSeconds + 0.007);
    world.render(0);
    world.renderer.getContext().finish();

    const objectNames = [];
    let visibleDrawObjects = 0;
    let visualTriangles = 0;
    circuitRenderer.root.traverse((object) => {
      objectNames.push(object.name);
      if (
        !object.visible ||
        !(object.isMesh || object.isLine || object.isPoints)
      ) {
        return;
      }
      visibleDrawObjects += 1;
      const geometry = object.geometry;
      if (!geometry) return;
      const primitiveCount = geometry.index
        ? geometry.index.count / 3
        : (geometry.attributes.position?.count ?? 0) / 3;
      visualTriangles +=
        primitiveCount * (object.isInstancedMesh ? object.count : 1);
    });
    const circuit = simulationSnapshot.circuit;
    const controls = Object.fromEntries(
      circuit.machineControls.map((control) => [
        control.portId,
        {
          enabled: control.enabled,
          powerSwitchClosed: control.powerSwitchClosed,
          filterSignal: control.filterSignal,
          sorterOutput: control.sorterOutput,
        },
      ]),
    );
    return {
      debug: circuitRenderer.getDebug(),
      objectNames,
      authoritative: {
        tick: circuit.tick,
        tickDelta: circuit.tick - startingTick,
        placements,
        circuitEntityIds: adapted.circuitEntities.map((entity) => entity.id),
        endpointCount: circuit.endpoints.length,
        wireCount: circuit.wires.length,
        componentCount: circuit.topology.components.length,
        workUnits: circuit.workUnits,
        deviceKinds: circuit.devices.map((device) => device.kind),
        wireColors: circuit.wires.map((wire) => wire.color),
        controls,
        inserterPortId: `entity:${inserter.id}:machine`,
        manifoldPortId: `entity:${manifold.id}:machine`,
        pumpPortId: `entity:${pump.id}:machine`,
        rendererUsesExactSnapshot:
          adapted.circuit === simulationSnapshot.circuit,
      },
      visualCost: {
        visibleDrawObjects,
        triangles: Math.round(visualTriangles),
      },
      materialNames: [
        "wireRed",
        "wireGreen",
        "tracerRed",
        "tracerGreen",
        "constantHousing",
        "arithmeticHousing",
        "deciderHousing",
      ].map((key) => circuitRenderer.materials[key].name),
      memoryBaseline,
      memoryActive: {
        geometries: world.renderer.info.memory.geometries,
        textures: world.renderer.info.memory.textures,
      },
      bounds: {
        focus: [world.focusPoint.x, world.focusPoint.z],
        viewWidth: world.viewWidth,
      },
    };
  });

  assert(
    proof.authoritative.rendererUsesExactSnapshot,
    "Circuit renderer did not receive the real adapted simulation snapshot.",
  );
  assert(
    proof.authoritative.tickDelta === 10,
    "Real circuit fixture did not advance exactly ten fixed ticks.",
  );
  assert(
    proof.authoritative.circuitEntityIds.length === 5,
    "Real circuit fixture did not expose all five combinators.",
  );
  assert(
    proof.authoritative.endpointCount >= 12,
    "Real circuit fixture did not expose the expected endpoints.",
  );
  assert(
    proof.authoritative.wireCount === 12 &&
      proof.debug.wires === proof.authoritative.wireCount,
    "Rendered wires do not exactly match the authoritative topology.",
  );
  assert(
    proof.debug.redWires === 6 && proof.debug.greenWires === 6,
    "Red/green wire families were not rendered independently.",
  );
  assert(
    proof.debug.junctions >= 7,
    "Physical split/merge crowns are missing from the branched topology.",
  );
  assert(
    proof.debug.directionalWires >= 10 &&
      proof.debug.pulses === proof.debug.directionalWires,
    "Authoritative source roles did not produce enough directional routes.",
  );
  assert(
    proof.debug.activeDevices === 5 &&
      proof.debug.signalIndicators >= 10,
    "Device state/signal instrumentation is incomplete.",
  );
  assert(
    proof.debug.machinePorts === 4 &&
      proof.debug.configuredMachinePorts === 3,
    "Machine-port attachment projection is incomplete.",
  );
  assert(
    proof.authoritative.controls[
      proof.authoritative.inserterPortId
    ]?.enabled === true,
    "Real inserter enable control did not reach the rendered machine port.",
  );
  assert(
    proof.authoritative.controls[
      proof.authoritative.manifoldPortId
    ]?.sorterOutput === "B",
    "Real sorter output did not reach the rendered machine port.",
  );
  assert(
    proof.authoritative.controls[
      proof.authoritative.pumpPortId
    ]?.powerSwitchClosed === true,
    "Real pump power switch did not close through the circuit.",
  );
  for (const requiredName of [
    "circuit-constant-indexing-drum",
    "circuit-arithmetic-differential-gear-a",
    "circuit-arithmetic-differential-gear-b",
    "circuit-decider-balance-beam",
    "circuit-decider-gate-leaf",
    "circuit-wire-red-tracer",
    "circuit-wire-green-tracer",
    "circuit-junction-red",
    "circuit-junction-green",
    "circuit-machine-port-clamp",
    "circuit-pulse-red",
    "circuit-pulse-green",
  ]) {
    assert(
      proof.objectNames.includes(requiredName),
      `Required circuit mechanism is missing: ${requiredName}`,
    );
  }
  assert(
    proof.materialNames.every(
      (name) => typeof name === "string" && name.startsWith("circuit-"),
    ),
    "Circuit material families are not explicitly authored/named.",
  );
  assert(
    proof.visualCost.triangles >= 5_000 &&
      proof.visualCost.triangles <= 150_000,
    "Circuit close-up triangle budget is outside the audited range.",
  );

  await page.locator("#world").screenshot({
    path: `${OUTPUT_DIRECTORY}/circuit-network-hero.png`,
  });
  await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    const circuit = window.__CIRCUIT_VISUAL_QA__;
    if (!game || !circuit) {
      throw new Error("Circuit close-up renderer is unavailable.");
    }
    game.renderer.focus(7.5, 8.9);
    game.renderer.viewWidth = 12.2;
    game.renderer.resize();
    circuit.update(game.snapshot().elapsedSeconds + 0.011);
    game.renderer.render(0);
    game.renderer.renderer.getContext().finish();
  });
  await page.locator("#world").screenshot({
    path: `${OUTPUT_DIRECTORY}/circuit-logic-close.png`,
  });
  await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    const circuit = window.__CIRCUIT_VISUAL_QA__;
    if (!game || !circuit) {
      throw new Error("Circuit control close-up renderer is unavailable.");
    }
    game.renderer.focus(13.9, 10);
    game.renderer.viewWidth = 12.5;
    game.renderer.resize();
    circuit.update(game.snapshot().elapsedSeconds + 0.004);
    game.renderer.render(0);
    game.renderer.renderer.getContext().finish();
  });
  await page.locator("#world").screenshot({
    path: `${OUTPUT_DIRECTORY}/circuit-controls-close.png`,
  });

  const teardown = await page.evaluate(async () => {
    const game = window.__CINDERLINE__;
    const integrated = window.__CIRCUIT_VISUAL_QA__;
    if (!game || !integrated) {
      throw new Error("Circuit teardown renderer is unavailable.");
    }
    const [{ toRenderSnapshot }, { CircuitRenderer }] = await Promise.all([
      import("/src/game/adapters.ts"),
      import("/src/render/CircuitRenderer.ts"),
    ]);
    const circuit = new CircuitRenderer(game.renderer.entityRoot, {
      maxDetailedDevices: 24,
      maxSignalsPerDevice: 3,
      maxPulses: 128,
    });
    circuit.root.name = "circuit-disposal-probe";
    circuit.sync(toRenderSnapshot(game.snapshot()));
    game.renderer.render(0);
    game.renderer.renderer.getContext().finish();
    const activeMemory = {
      geometries: game.renderer.renderer.info.memory.geometries,
      textures: game.renderer.renderer.info.memory.textures,
    };
    const before = circuit.getDebug();
    circuit.dispose();
    circuit.dispose();
    game.renderer.render(0);
    game.renderer.renderer.getContext().finish();
    return {
      before,
      after: circuit.getDebug(),
      activeMemory,
      memory: {
        geometries: game.renderer.renderer.info.memory.geometries,
        textures: game.renderer.renderer.info.memory.textures,
      },
      rootRemaining: Boolean(
        game.renderer.entityRoot.getObjectByName("circuit-disposal-probe"),
      ),
      integratedStillLive: !integrated.getDebug().disposed,
    };
  });
  assert(teardown.after.disposed, "Circuit renderer did not mark disposal.");
  assert(
    teardown.after.resources.disposedGeometries ===
      teardown.before.resources.ownedGeometries,
    "Circuit renderer did not dispose every owned geometry exactly once.",
  );
  assert(
    teardown.after.resources.disposedMaterials ===
      teardown.before.resources.ownedMaterials,
    "Circuit renderer did not dispose every owned material exactly once.",
  );
  assert(
    teardown.after.resources.liveInstancedMeshes === 0 &&
      !teardown.rootRemaining,
    "Circuit renderer left live batches or a world root after teardown.",
  );
  assert(
    teardown.integratedStillLive,
    "Circuit lifecycle probe disposed the live integrated renderer.",
  );
  assert(
    teardown.memory.geometries === proof.memoryBaseline.geometries &&
      teardown.memory.textures === proof.memoryBaseline.textures,
    `WebGL memory did not return to baseline: ${JSON.stringify({
      baseline: proof.memoryBaseline,
      active: proof.memoryActive,
      after: teardown.memory,
    })}`,
  );
  assert(errors.length === 0, `Browser errors: ${errors.join(" | ")}`);
  await writeFile(
    `${OUTPUT_DIRECTORY}/visual-proof.json`,
    `${JSON.stringify({ proof, teardown, errors }, null, 2)}\n`,
    "utf8",
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        images: [
          `${OUTPUT_DIRECTORY}/circuit-network-hero.png`,
          `${OUTPUT_DIRECTORY}/circuit-logic-close.png`,
          `${OUTPUT_DIRECTORY}/circuit-controls-close.png`,
        ],
        proof: `${OUTPUT_DIRECTORY}/visual-proof.json`,
        debug: proof.debug,
        authoritative: proof.authoritative,
        visualCost: proof.visualCost,
        teardown: {
          memoryBaseline: proof.memoryBaseline,
          memoryActive: proof.memoryActive,
          memoryAfter: teardown.memory,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
