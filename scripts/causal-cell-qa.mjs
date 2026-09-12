import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY = ".qa/causal-cell";
const EXPECTED_PHASE_TICKS = {
  feed: 0,
  process: 87,
  transfer: 123,
  buffer: 144,
};
const EXPECTED_EVENT_TICKS = {
  input: 68,
  produced: 107,
  buffer: 144,
};

await mkdir(OUTPUT_DIRECTORY, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      failures.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));

  await page.goto(`${BASE_URL}/?fresh=causal-cell-qa`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => document.querySelector("#boot")?.classList.contains("is-done"),
    undefined,
    { timeout: 15_000 },
  );
  await page.keyboard.press("Space");

  const pausedTick = await page.evaluate(() => window.__CINDERLINE__?.stats().tick);
  await page.waitForTimeout(100);
  const heldTick = await page.evaluate(() => window.__CINDERLINE__?.stats().tick);
  assert(
    pausedTick === heldTick,
    `Causal-cell QA could not pause the live simulation (${pausedTick} → ${heldTick}).`,
  );

  const setup = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    const simulation = game?.simulation;
    const renderer = game?.renderer;
    if (!simulation || !renderer) {
      throw new Error("Causal-cell QA bridge unavailable.");
    }

    for (const entity of simulation.getEntities()) {
      const removed = simulation.remove(entity.x, entity.y);
      if (!removed || removed.id !== entity.id) {
        throw new Error(`Could not remove showcase entity ${entity.id}.`);
      }
    }

    const EAST = 1;
    const place = (kind, x, y, direction = EAST, options = {}) => {
      const result = simulation.place(kind, x, y, direction, options);
      if (!result.ok) {
        throw new Error(
          `Could not place causal-cell ${kind} at ${x},${y}: ${result.reason}.`,
        );
      }
      return result.entity;
    };

    const belts = [14, 15, 16].map((x) => place("belt", x, 13));
    const inputArm = place("inserter", 17, 13);
    const fabricator = place("fabricator", 18, 12, EAST, {
      recipeId: "copperWire",
    });
    const outputArm = place("inserter", 20, 13);
    const storage = place("storage", 21, 12);
    const generator = place("generator", 18, 16);

    const fuelAccepted = simulation.receive(generator.id, "coal", 10, "fuel");
    if (fuelAccepted !== 10) {
      throw new Error(`Generator accepted ${fuelAccepted}/10 coal.`);
    }

    const initialProducedWire =
      simulation.productionLedger().copperWire ?? 0;
    simulation.drainEvents();
    const seeded = simulation.receive(
      belts[2].id,
      "copperPlate",
      1,
      "belt",
      0,
    );
    if (seeded !== 1) {
      throw new Error(`Input belt accepted ${seeded}/1 copper plate.`);
    }
    simulation.drainEvents();

    const observedEvents = [];
    const originalDrainEvents = simulation.drainEvents.bind(simulation);
    simulation.drainEvents = () => {
      const events = originalDrainEvents();
      observedEvents.push(...events.map((event) => ({ ...event })));
      return [];
    };

    document.querySelector("#boot")?.remove();
    const hud = document.querySelector("#hud");
    if (hud instanceof HTMLElement) hud.style.display = "none";
    renderer.setSelected(null);
    renderer.setHovered(null, null);
    renderer.resourceRoot.visible = false;
    renderer.overlayRoot.visible = false;
    renderer.effectsRoot.visible = false;

    const originalUpdate = renderer.update.bind(renderer);
    renderer.update = () => {};
    renderer.focus(18.5, 14);
    for (let index = 0; index < 8; index += 1) renderer.zoom(-4);

    const ids = {
      belts: belts.map((belt) => belt.id),
      inputArm: inputArm.id,
      fabricator: fabricator.id,
      outputArm: outputArm.id,
      storage: storage.id,
      generator: generator.id,
    };
    const baseTick = simulation.tickCount;

    const state = () => {
      const belt = simulation.getEntity(belts[2].id);
      const input = simulation.getEntity(inputArm.id);
      const machine = simulation.getEntity(fabricator.id);
      const output = simulation.getEntity(outputArm.id);
      const buffer = simulation.getEntity(storage.id);
      if (!belt || !input || !machine || !output || !buffer) {
        throw new Error("A causal-cell entity disappeared during QA.");
      }
      return {
        tick: simulation.tickCount,
        relativeTick: simulation.tickCount - baseTick,
        beltItems: belt.beltItems.map((item) => ({ ...item })),
        inputHeld: input.heldItem ?? null,
        inputArmProgress: input.armProgress,
        machineStatus: machine.status,
        machineRecipe: machine.recipeId ?? null,
        activeRecipe: machine.activeRecipeId ?? null,
        machineProgress: machine.progress,
        machineInput: { ...machine.input },
        machineOutput: { ...machine.output },
        machinePower: machine.powerSatisfaction,
        outputHeld: output.heldItem ?? null,
        outputArmProgress: output.armProgress,
        outputArmReturning: output.armReturning,
        storage: { ...buffer.inventory },
        producedWire:
          (simulation.productionLedger().copperWire ?? 0) - initialProducedWire,
        storedWire: simulation.stats().stored.copperWire ?? 0,
        handoffDockCount:
          renderer.infrastructureRoot.userData.handoffDockCount ?? 0,
        handoffDockInstances:
          renderer.infrastructureRoot.userData.handoffDockInstances ?? 0,
      };
    };

    const reached = (phase, snapshot) => {
      switch (phase) {
        case "process":
          return (
            snapshot.activeRecipe === "copperWire"
            && snapshot.machineProgress >= 0.48
          );
        case "transfer":
          return (
            snapshot.outputHeld === "copperWire"
            && snapshot.outputArmProgress >= 0.42
          );
        case "buffer":
          return (
            (snapshot.storage.copperWire ?? 0) >= 1
            && snapshot.outputHeld === null
            && snapshot.outputArmReturning
          );
        default:
          throw new Error(`Unknown causal-cell phase ${phase}.`);
      }
    };

    const nextAnimationFrame = () =>
      new Promise((resolve) => requestAnimationFrame(() => resolve()));

    window.__CAUSAL_CELL_QA__ = {
      ids,
      state,
      events: () => observedEvents.map((event) => ({ ...event })),
      async settle() {
        await nextAnimationFrame();
        await nextAnimationFrame();
        originalUpdate(0, 0);
        renderer.render(0);
        return state();
      },
      async advanceTo(phase) {
        for (let step = 0; step < 180; step += 1) {
          simulation.step(1);
          await nextAnimationFrame();
          const relativeTick = simulation.tickCount - baseTick;
          originalUpdate(
            simulation.fixedStepSeconds,
            relativeTick * simulation.fixedStepSeconds,
          );
          renderer.render(0);
          const snapshot = state();
          if (reached(phase, snapshot)) return snapshot;
        }
        throw new Error(`Causal-cell phase ${phase} was not reached within 180 ticks.`);
      },
    };

    return {
      ids,
      kinds: {
        belts: belts.map((entity) => entity.kind),
        inputArm: inputArm.kind,
        fabricator: fabricator.kind,
        outputArm: outputArm.kind,
        storage: storage.kind,
        generator: generator.kind,
      },
      recipe: fabricator.recipeId,
    };
  });

  validateSetup(setup);

  const captures = [];
  const capture = async (phase, state, caption) => {
    const index = captures.length + 1;
    const path = `${OUTPUT_DIRECTORY}/frame-${String(index).padStart(2, "0")}-${phase}.png`;
    const buffer = await page.screenshot({
      path,
      clip: { x: 360, y: 202, width: 1200, height: 675 },
    });
    captures.push({
      phase,
      path,
      state,
      caption,
      dataURL: `data:image/png;base64,${buffer.toString("base64")}`,
    });
  };

  const feed = await page.evaluate(() => window.__CAUSAL_CELL_QA__?.settle());
  assert(feed, "Causal-cell QA could not read its feed phase.");
  validatePhaseTick("feed", feed);
  assert(
    feed.beltItems.length === 1
      && feed.beltItems[0].item === "copperPlate"
      && feed.beltItems[0].lane === 0,
    "Feed phase does not contain exactly one lane-0 copper plate.",
  );
  assert(
    feed.inputHeld === null
      && feed.outputHeld === null
      && (feed.storage.copperWire ?? 0) === 0,
    "Feed phase started with a loaded arm or buffer.",
  );
  assert(
    feed.handoffDockCount === 3 && feed.handoffDockInstances === 9,
    `Causal cell rendered ${feed.handoffDockCount} handoff docks/${feed.handoffDockInstances} instances; expected 3/9.`,
  );
  await capture(
    "feed",
    feed,
    `FEED · T+000 · BELT#${setup.ids.belts[2]} CuP×1 · ARM#${setup.ids.inputArm} —`,
  );

  const processPhase = await page.evaluate(() =>
    window.__CAUSAL_CELL_QA__?.advanceTo("process"),
  );
  assert(processPhase, "Causal-cell QA could not read its process phase.");
  validatePhaseTick("process", processPhase);
  assert(
    processPhase.machineRecipe === "copperWire"
      && processPhase.activeRecipe === "copperWire"
      && processPhase.machineStatus === "working"
      && processPhase.machineProgress >= 0.48
      && processPhase.machineProgress <= 0.52,
    "Process phase does not show the copper-wire recipe at midpoint.",
  );
  assert(
    processPhase.producedWire === 0
      && (processPhase.machineInput.copperPlate ?? 0) === 0
      && (processPhase.machineOutput.copperWire ?? 0) === 0,
    "Process phase inventory changed before recipe completion.",
  );
  assert(
    processPhase.machinePower > 0.99,
    `Process phase power satisfaction fell to ${processPhase.machinePower}.`,
  );
  await capture(
    "process",
    processPhase,
    `PROCESS · T+087 · FAB#${setup.ids.fabricator} 50% · IN 0 · OUT 0`,
  );

  const transfer = await page.evaluate(() =>
    window.__CAUSAL_CELL_QA__?.advanceTo("transfer"),
  );
  assert(transfer, "Causal-cell QA could not read its transfer phase.");
  validatePhaseTick("transfer", transfer);
  assert(
    transfer.outputHeld === "copperWire"
      && transfer.outputArmProgress >= 0.42
      && transfer.outputArmProgress <= 0.45
      && (transfer.machineOutput.copperWire ?? 0) === 1
      && (transfer.storage.copperWire ?? 0) === 0
      && transfer.producedWire === 2,
    "Transfer phase does not show one real wire in the output arm and one in machine output.",
  );
  await capture(
    "transfer",
    transfer,
    `TRANSFER · T+123 · ARM#${setup.ids.outputArm} CuW · FAB OUT 1`,
  );

  const buffer = await page.evaluate(() =>
    window.__CAUSAL_CELL_QA__?.advanceTo("buffer"),
  );
  assert(buffer, "Causal-cell QA could not read its buffer phase.");
  validatePhaseTick("buffer", buffer);
  assert(
    (buffer.storage.copperWire ?? 0) === 1
      && buffer.outputHeld === null
      && buffer.outputArmReturning
      && (buffer.machineOutput.copperWire ?? 0) === 1,
    "Buffer phase does not contain the completed storage handoff.",
  );
  assert(
    buffer.producedWire === 2 && buffer.storedWire === 2,
    `Copper-wire conservation failed (produced ${buffer.producedWire}, stored ${buffer.storedWire}).`,
  );
  assert(
    (buffer.machineInput.copperPlate ?? 0) === 0
      && buffer.beltItems.length === 0
      && buffer.inputHeld === null,
    "The source copper plate was not fully consumed.",
  );

  const events = await page.evaluate(() => window.__CAUSAL_CELL_QA__?.events());
  assert(events, "Causal-cell QA could not read observed simulation events.");
  const eventChain = validateEventChain(events, setup.ids, feed.tick);
  await capture(
    "buffer",
    buffer,
    `BUFFER · T+144 · STORE#${setup.ids.storage} CuW 0→1 · EVENT#${eventChain.buffer.id}`,
  );

  if (failures.length > 0) {
    throw new Error(
      `Causal-cell QA observed console failures:\n${failures.join("\n")}`,
    );
  }

  const sheet = await context.newPage();
  await sheet.setViewportSize({ width: 1920, height: 1080 });
  await sheet.setContent(contactSheetMarkup(captures), { waitUntil: "load" });
  await sheet.screenshot({
    path: `${OUTPUT_DIRECTORY}/contact-sheet.png`,
    fullPage: true,
  });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    entityIds: setup.ids,
    phases: captures.map(({ phase, path, state }) => ({
      phase,
      path,
      tick: state.tick,
      relativeTick: state.relativeTick,
      beltItems: state.beltItems,
      inputHeld: state.inputHeld,
      machineProgress: Number(state.machineProgress.toFixed(3)),
      machineOutput: state.machineOutput,
      outputHeld: state.outputHeld,
      outputArmProgress: Number(state.outputArmProgress.toFixed(3)),
      storage: state.storage,
    })),
    events: eventChain,
    producedWire: buffer.producedWire,
    storedWire: buffer.storedWire,
    handoffDocks: {
      count: feed.handoffDockCount,
      instances: feed.handoffDockInstances,
    },
    contactSheet: `${OUTPUT_DIRECTORY}/contact-sheet.png`,
    warnings: failures,
  }, null, 2)}\n`);

  await context.close();
} finally {
  await browser.close();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateSetup(setup) {
  const ids = [
    ...setup.ids.belts,
    setup.ids.inputArm,
    setup.ids.fabricator,
    setup.ids.outputArm,
    setup.ids.storage,
    setup.ids.generator,
  ];
  assert(
    ids.every((id) => Number.isInteger(id) && id > 0),
    "Causal-cell setup produced an invalid entity ID.",
  );
  assert(
    new Set(ids).size === ids.length,
    "Causal-cell setup produced duplicate entity IDs.",
  );
  assert(
    setup.kinds.belts.every((kind) => kind === "belt")
      && setup.kinds.inputArm === "inserter"
      && setup.kinds.fabricator === "fabricator"
      && setup.kinds.outputArm === "inserter"
      && setup.kinds.storage === "storage"
      && setup.kinds.generator === "generator"
      && setup.recipe === "copperWire",
    "Causal-cell setup has an incorrect entity kind or recipe.",
  );
}

function validatePhaseTick(phase, state) {
  assert(
    state.relativeTick === EXPECTED_PHASE_TICKS[phase],
    `${phase} phase arrived at T+${state.relativeTick}; expected T+${EXPECTED_PHASE_TICKS[phase]}.`,
  );
}

function validateEventChain(events, ids, baseTick) {
  const input = events.find(
    (event) =>
      event.type === "itemTransferred"
      && event.entityId === ids.fabricator
      && event.item === "copperPlate"
      && event.amount === 1,
  );
  const produced = events.find(
    (event) =>
      event.type === "itemProduced"
      && event.entityId === ids.fabricator
      && event.item === "copperWire"
      && event.amount === 2,
  );
  const buffer = events.find(
    (event) =>
      event.type === "itemTransferred"
      && event.entityId === ids.storage
      && event.item === "copperWire"
      && event.amount === 1,
  );
  assert(input && produced && buffer, "The expected causal event chain is incomplete.");
  assert(
    input.id < produced.id
      && produced.id < buffer.id
      && input.tick < produced.tick
      && produced.tick < buffer.tick,
    "The causal event chain is out of order.",
  );
  assert(
    input.tick - baseTick === EXPECTED_EVENT_TICKS.input
      && produced.tick - baseTick === EXPECTED_EVENT_TICKS.produced
      && buffer.tick - baseTick === EXPECTED_EVENT_TICKS.buffer,
    `Event timing changed: input T+${input.tick - baseTick}, produced T+${produced.tick - baseTick}, buffer T+${buffer.tick - baseTick}.`,
  );
  return {
    input: { ...input, relativeTick: input.tick - baseTick },
    produced: { ...produced, relativeTick: produced.tick - baseTick },
    buffer: { ...buffer, relativeTick: buffer.tick - baseTick },
  };
}

function contactSheetMarkup(captures) {
  return `<!doctype html>
    <meta charset="utf-8">
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #071012; }
      main {
        display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;
        width: 1920px; height: 1080px; gap: 3px; padding: 3px;
      }
      figure { position: relative; margin: 0; overflow: hidden; background: #101719; }
      img { display: block; width: 100%; height: 100%; object-fit: cover; }
      figcaption {
        position: absolute; inset: 12px auto auto 12px; padding: 8px 11px;
        color: #bffff0; background: rgba(5, 15, 16, .9); border: 1px solid #58f1cf;
        font: 700 13px/1 ui-monospace, SFMono-Regular, monospace;
        letter-spacing: .08em; text-transform: uppercase;
      }
    </style>
    <main>
      ${captures.map(({ phase, caption, dataURL }) => `
        <figure>
          <img src="${dataURL}" alt="${phase} causal-cell phase">
          <figcaption>${caption}</figcaption>
        </figure>
      `).join("")}
    </main>`;
}
