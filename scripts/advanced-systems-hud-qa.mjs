import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL =
  process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY = ".qa/advanced-systems-hud";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
});
const errors = [];

try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.goto(
    `${BASE_URL.replace(/\/$/, "")}/?fresh=advanced-systems-hud-qa`,
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
    if (!game) throw new Error("Cinderline QA bridge is unavailable.");
    const [{ toHUDMapEntities, toRenderSnapshot }, circuitModule] =
      await Promise.all([
        import("/src/game/adapters.ts"),
        import("/src/game/circuit-network.ts"),
      ]);
    const simulation = game.simulation;
    for (const entity of [...simulation.getEntities()]) {
      simulation.remove(entity.x, entity.y);
    }
    simulation.drainEvents();

    const place = (kind, x, y, direction = 1, options = {}) => {
      const result = simulation.place(kind, x, y, direction, options);
      if (!result.ok) {
        throw new Error(
          `Advanced HUD fixture could not place ${kind}: ${result.reason}`,
        );
      }
      return result.entity;
    };

    const source = place("fluidSource", 2, 8, 1, {
      fluidId: "crudeOil",
    });
    place("fluidPump", 4, 8);
    place("fluidPipe", 5, 8);
    place("fluidTank", 6, 7);
    place("fluidPipe", 9, 8);
    place("fluidProcessor", 10, 7, 1, {
      fluidRecipeId: "refineCrude",
    });
    place("fluidPipe", 13, 8);
    place("fluidTank", 14, 7);

    const constant = place("constantCombinator", 4, 17);
    const arithmetic = place("arithmeticCombinator", 6, 17);
    const decider = place("deciderCombinator", 8, 17);
    const {
      circuitConstant,
      circuitSignal,
    } = circuitModule;
    const iron = circuitSignal("item", "ironPlate");
    const copper = circuitSignal("item", "copperPlate");
    simulation.configureCircuitDevice(constant.id, {
      kind: "constant",
      signals: [{ signal: iron, value: 24 }],
    });
    simulation.configureCircuitDevice(arithmetic.id, {
      kind: "arithmetic",
      left: { kind: "signal", selector: iron },
      operator: "add",
      right: circuitConstant(12),
      output: copper,
    });
    const redConnected = simulation.connectCircuitWire(
      "red",
      { entityId: constant.id, connector: "output" },
      { entityId: arithmetic.id, connector: "input" },
    );
    const greenConnected = simulation.connectCircuitWire(
      "green",
      { entityId: arithmetic.id, connector: "output" },
      { entityId: decider.id, connector: "input" },
    );
    if (!redConnected || !greenConnected) {
      throw new Error("Advanced HUD circuit fixture did not connect.");
    }
    simulation.step(180);

    const snapshot = simulation.getRenderSnapshot();
    const adapted = toRenderSnapshot(snapshot);
    game.renderer.sync(adapted);
    game.renderer.focus(9, 12);
    game.renderer.update(0, snapshot.elapsedSeconds);
    game.renderer.render(0);
    game.renderer.renderer.getContext().finish();
    game.selectEntity(source.id);
    game.refreshHUD();
    game.dismissToasts();

    const mapEntities = toHUDMapEntities(snapshot, source.id);
    const advancedKinds = [
      ...new Set(
        mapEntities
          .filter(
            (entity) =>
              entity.kind.startsWith("fluid") ||
              entity.kind.endsWith("Combinator"),
          )
          .map((entity) => entity.kind),
      ),
    ].sort();
    return {
      sourceId: source.id,
      mapEntityCount: mapEntities.length,
      advancedKinds,
      selectedMapEntity:
        mapEntities.find((entity) => entity.selected)?.kind ?? null,
      circuit: {
        tick: snapshot.circuit.tick,
        endpoints: snapshot.circuit.endpoints.length,
        wires: snapshot.circuit.wires.length,
      },
      fluid: {
        nodes: snapshot.fluidNetwork.nodes.length,
        edges: snapshot.fluidNetwork.edges.length,
        producedCrudeMilli:
          snapshot.fluid.producedMilli.crudeOil,
      },
    };
  });

  const inspector = page.locator("[data-ref='inspector']");
  await page.waitForTimeout(360);
  await inspector.waitFor({ state: "visible", timeout: 5_000 });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    window.__CINDERLINE__?.dismissToasts();
  });
  await page.waitForTimeout(360);
  const inspectorText = (await inspector.innerText()).toUpperCase();
  assert(
    inspectorText.includes("CRUDE OIL WELLHEAD") &&
      inspectorText.includes("VOLUME") &&
      inspectorText.includes("UNITS") &&
      !inspectorText.includes("PAYLOAD"),
    `Fluid inspector is not semantically truthful: ${inspectorText}`,
  );
  assert(
    proof.advancedKinds.length === 8,
    `Tactical map omitted advanced kinds: ${JSON.stringify(proof.advancedKinds)}`,
  );
  assert(
    proof.selectedMapEntity === "fluidSource",
    "Tactical map did not retain the selected fluid source.",
  );
  assert(
    proof.circuit.endpoints >= 5 &&
      proof.circuit.wires === 2,
    `Circuit fixture did not reach the authoritative HUD snapshot: ${JSON.stringify(proof.circuit)}`,
  );
  assert(
    proof.fluid.nodes >= 8 &&
      proof.fluid.edges >= 7 &&
      proof.fluid.producedCrudeMilli > 0,
    "Fluid fixture did not reach the authoritative HUD snapshot.",
  );
  assert(errors.length === 0, `Browser errors: ${errors.join(" | ")}`);

  await page.screenshot({
    path: `${OUTPUT_DIRECTORY}/advanced-systems-hud.png`,
  });
  await page.locator("#minimap").screenshot({
    path: `${OUTPUT_DIRECTORY}/advanced-systems-minimap.png`,
  });
  await inspector.screenshot({
    path: `${OUTPUT_DIRECTORY}/fluid-inspector.png`,
  });
  await writeFile(
    `${OUTPUT_DIRECTORY}/proof.json`,
    `${JSON.stringify({ proof, inspectorText, errors }, null, 2)}\n`,
    "utf8",
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        proof,
        images: [
          `${OUTPUT_DIRECTORY}/advanced-systems-hud.png`,
          `${OUTPUT_DIRECTORY}/advanced-systems-minimap.png`,
          `${OUTPUT_DIRECTORY}/fluid-inspector.png`,
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
