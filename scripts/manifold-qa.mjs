import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY = ".qa/manifold";

await mkdir(OUTPUT_DIRECTORY, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      failures.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));

  await page.goto(`${BASE_URL}/?fresh=manifold-qa`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => (
      document.querySelector("#boot")?.classList.contains("is-done")
      && Boolean(window.__CINDERLINE__?.simulation)
    ),
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(760);
  // Focus the game surface explicitly: HUD buttons/selects intentionally own
  // Space now, so global simulation shortcuts must not steal their keystrokes.
  await page.locator("#world").focus();
  await page.keyboard.press("Space");

  const setup = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    const simulation = game?.simulation;
    const renderer = game?.renderer;
    if (!simulation || !renderer) {
      throw new Error("Manifold QA bridge unavailable.");
    }

    for (const entity of simulation.getEntities()) {
      const removed = simulation.remove(entity.x, entity.y);
      if (!removed || removed.id !== entity.id) {
        throw new Error(`Could not remove demo entity ${entity.id}.`);
      }
    }

    const EAST = 1;
    const place = (kind, x, y, direction = EAST) => {
      const result = simulation.place(kind, x, y, direction);
      if (!result.ok) {
        throw new Error(
          `Could not place manifold QA ${kind} at ${x},${y}: ${result.reason}.`,
        );
      }
      return result.entity;
    };

    const feed = place("belt", 8, 10);
    for (let x = 9; x <= 11; x += 1) place("belt", x, 10);
    const manifold = place("manifold", 12, 10);
    for (let x = 13; x <= 17; x += 1) {
      place("belt", x, 9);
      place("belt", x, 11);
    }
    if (!simulation.setManifoldRouting(manifold.id, {
      mode: "extract",
      filter: "copperOre",
    })) {
      throw new Error("Could not configure strict extraction.");
    }

    for (let pulse = 0; pulse < 8; pulse += 1) {
      const copper = pulse % 2 === 0;
      const accepted = simulation.receive(
        feed.id,
        copper ? "copperOre" : "ironOre",
        1,
        "belt",
        copper ? 0 : 1,
      );
      if (accepted !== 1) {
        throw new Error(`Feed pulse ${pulse} accepted ${accepted}/1 payload.`);
      }
      simulation.step(8);
    }
    simulation.drainEvents();

    document.querySelector("#boot")?.remove();
    renderer.focus(13, 10.5);
    for (let step = 0; step < 8; step += 1) renderer.zoom(-4);
    return { manifoldId: manifold.id, feedId: feed.id };
  });

  await page.keyboard.press("9");
  const hotkeySelected = await page.locator("[data-build='manifold']")
    .evaluate((element) => element.classList.contains("is-selected"));
  assert(hotkeySelected, "Hotkey 9 did not select the manifold build card.");
  await page.keyboard.press("Escape");

  const screenPoint = await page.evaluate((manifoldId) => {
    const game = window.__CINDERLINE__;
    const rig = game?.renderer.entityObjects.get(manifoldId);
    const canvas = document.querySelector("#world");
    if (!game || !rig || !(canvas instanceof HTMLCanvasElement)) {
      throw new Error("Could not project the manifold for inspector QA.");
    }
    const projected = rig.root.position.clone().project(game.renderer.camera);
    const bounds = canvas.getBoundingClientRect();
    return {
      x: bounds.left + (projected.x + 1) * bounds.width * 0.5,
      y: bounds.top + (-projected.y + 1) * bounds.height * 0.5,
    };
  }, setup.manifoldId);
  await page.mouse.click(screenPoint.x, screenPoint.y);
  await page.waitForFunction(
    () => (
      document.querySelector("[data-ref='inspector-name']")?.textContent
      === "Dispatch manifold"
    ),
  );

  await page.locator("[data-manifold-mode='favorB']").click();
  await page.waitForFunction(
    (id) => (
      window.__CINDERLINE__?.simulation.getEntity(id)?.manifoldRouting?.mode
      === "favorB"
    ),
    setup.manifoldId,
  );
  await page.locator("[data-manifold-mode='extract']").click();
  await page.locator("[data-ref='manifold-filter']").selectOption("copperOre");
  await page.waitForFunction(
    (id) => {
      const routing =
        window.__CINDERLINE__?.simulation.getEntity(id)?.manifoldRouting;
      return routing?.mode === "extract" && routing.filter === "copperOre";
    },
    setup.manifoldId,
  );
  await page.evaluate(() => {
    const pausePlate = document.querySelector("[data-ref='pause-plate']");
    if (pausePlate instanceof HTMLElement) pausePlate.style.display = "none";
  });

  const responsive = await page.evaluate(() => {
    const inspector = document.querySelector("[data-ref='inspector']")
      ?.getBoundingClientRect();
    const minimap = document.querySelector(".minimap-shell")
      ?.getBoundingClientRect();
    return {
      inspector: inspector
        ? { left: inspector.left, right: inspector.right, top: inspector.top, bottom: inspector.bottom }
        : null,
      minimap: minimap
        ? { left: minimap.left, right: minimap.right, top: minimap.top, bottom: minimap.bottom }
        : null,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  assert(
    responsive.inspector && responsive.minimap,
    "Routing inspector or tactical map was not visible.",
  );
  assert(
    responsive.minimap.right <= responsive.inspector.left,
    "Routing inspector overlaps the tactical map.",
  );
  assert(
    responsive.bodyWidth === responsive.viewportWidth,
    "Routing inspector introduced horizontal page overflow.",
  );
  await page.locator("#world").focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    const toastStack = document.querySelector("[data-ref='toast-stack']");
    if (toastStack instanceof HTMLElement) toastStack.style.display = "none";
  });
  await page.screenshot({
    path: `${OUTPUT_DIRECTORY}/routing-inspector.png`,
  });

  await page.evaluate(() => {
    const hud = document.querySelector("#hud");
    if (hud instanceof HTMLElement) hud.style.display = "none";
    const renderer = window.__CINDERLINE__?.renderer;
    renderer?.setSelected(null);
    renderer?.setHovered(null, null);
  });

  const motionEvidence = [];
  for (let frame = 1; frame <= 4; frame += 1) {
    await page.waitForTimeout(180);
    motionEvidence.push(await page.evaluate(() => {
      const simulation = window.__CINDERLINE__?.simulation;
      if (!simulation) throw new Error("Motion evidence bridge unavailable.");
      const payloads = simulation.getEntities()
        .flatMap((entity) => entity.beltItems.map((item) => ({
          entityId: entity.id,
          itemId: item.id,
          progress: Number(item.progress.toFixed(4)),
        })))
        .sort((a, b) => a.itemId - b.itemId);
      return {
        count: payloads.length,
        signature: payloads
          .map((item) => `${item.itemId}:${item.entityId}:${item.progress}`)
          .join("|"),
      };
    }));
    await page.screenshot({
      path: `${OUTPUT_DIRECTORY}/motion-${frame}.png`,
    });
  }
  assert(
    motionEvidence.every((frame) => frame.count === 8),
    "Motion sequence did not conserve all eight payloads.",
  );
  assert(
    new Set(motionEvidence.map((frame) => frame.signature)).size >= 3,
    "Motion sequence did not prove visible payload progression.",
  );

  await page.waitForFunction(
    () => {
      const simulation = window.__CINDERLINE__?.simulation;
      if (!simulation) return false;
      const upper = simulation.getEntities("belt")
        .filter((entity) => entity.y === 9)
        .flatMap((entity) => entity.beltItems);
      const lower = simulation.getEntities("belt")
        .filter((entity) => entity.y === 11)
        .flatMap((entity) => entity.beltItems);
      return upper.length === 4 && lower.length === 4;
    },
    undefined,
    { timeout: 12_000 },
  );
  await page.keyboard.press("Space");
  await page.waitForTimeout(180);

  const result = await page.evaluate((manifoldId) => {
    const game = window.__CINDERLINE__;
    const simulation = game?.simulation;
    const renderer = game?.renderer;
    if (!simulation || !renderer) {
      throw new Error("Manifold QA bridge disappeared.");
    }
    const upper = simulation.getEntities("belt")
      .filter((entity) => entity.y === 9)
      .flatMap((entity) => entity.beltItems);
    const lower = simulation.getEntities("belt")
      .filter((entity) => entity.y === 11)
      .flatMap((entity) => entity.beltItems);
    const allPayloads = simulation.getEntities()
      .flatMap((entity) => entity.beltItems);
    const rig = renderer.entityObjects.get(manifoldId);
    if (!rig) throw new Error("Rendered manifold rig is missing.");
    let meshCount = 0;
    rig.root.traverse((object) => {
      if (object.isMesh) meshCount += 1;
    });
    const restored = simulation.constructor.restore(
      JSON.parse(JSON.stringify(simulation.serialize())),
    );
    return {
      upper,
      lower,
      allPayloads,
      restoredEqual:
        JSON.stringify(restored.serialize())
        === JSON.stringify(simulation.serialize()),
      rig: {
        surfaces: rig.parts.manifoldSurfaces?.length ?? 0,
        rollers: rig.parts.manifoldRollers?.length ?? 0,
        lamps: rig.parts.manifoldPortLamps?.length ?? 0,
        hasVane: Boolean(rig.parts.manifoldVane),
        meshCount,
      },
      sceneItems: renderer.itemRoot.children.length,
      memory: {
        geometries: renderer.renderer.info.memory.geometries,
        textures: renderer.renderer.info.memory.textures,
        programs: renderer.renderer.info.programs?.length ?? 0,
      },
    };
  }, setup.manifoldId);

  assert(result.upper.length === 4, "Extract port A did not receive four payloads.");
  assert(
    result.upper.every((item) => item.item === "copperOre"),
    "Extract port A contains a non-filter payload.",
  );
  assert(result.lower.length === 4, "Remainder port B did not receive four payloads.");
  assert(
    result.lower.every((item) => item.item === "ironOre"),
    "Remainder port B contains a filtered payload.",
  );
  assert(result.allPayloads.length === 8, "Manifold network did not conserve all eight payloads.");
  assert(
    result.allPayloads.every((item) => item.port === undefined),
    "Local manifold port metadata leaked onto an ordinary belt.",
  );
  assert(result.restoredEqual, "Manifold network did not round-trip through save/restore.");
  assert(result.rig.surfaces === 3, "Manifold rig lost one of its three transport surfaces.");
  assert(result.rig.rollers === 4, "Manifold rig lost an animated roller.");
  assert(result.rig.lamps === 2, "Manifold rig lost an A/B routing lamp.");
  assert(result.rig.hasVane, "Manifold selector vane is missing.");
  assert(
    result.sceneItems <= 4,
    "Payload rendering created per-item scene children instead of using instances.",
  );

  await page.waitForTimeout(120);
  await page.screenshot({
    path: `${OUTPUT_DIRECTORY}/extract-network.png`,
  });

  const policyClip = await page.evaluate((id) => {
    const game = window.__CINDERLINE__;
    const rig = game?.renderer.entityObjects.get(id);
    const canvas = document.querySelector("#world");
    if (!game || !rig || !(canvas instanceof HTMLCanvasElement)) {
      throw new Error("Could not frame the manifold close-up.");
    }
    const projected = rig.root.position.clone().project(game.renderer.camera);
    const bounds = canvas.getBoundingClientRect();
    const centerX = bounds.left + (projected.x + 1) * bounds.width * 0.5;
    const centerY = bounds.top + (-projected.y + 1) * bounds.height * 0.5;
    const width = 480;
    const height = 360;
    return {
      x: Math.max(0, Math.min(bounds.width - width, centerX - width * 0.5)),
      y: Math.max(0, Math.min(bounds.height - height, centerY - height * 0.5)),
      width,
      height,
    };
  }, setup.manifoldId);

  const policyVisuals = {};
  for (const mode of ["even", "favorA", "favorB", "extract"]) {
    const state = await page.evaluate(
      ({ id, mode: requestedMode }) => {
        const game = window.__CINDERLINE__;
        const simulation = game?.simulation;
        const renderer = game?.renderer;
        if (!simulation || !renderer) {
          throw new Error("Policy visual bridge unavailable.");
        }
        const routing = requestedMode === "extract"
          ? { mode: requestedMode, filter: "copperOre" }
          : { mode: requestedMode };
        if (!simulation.setManifoldRouting(id, routing)) {
          throw new Error(`Could not set policy ${requestedMode}.`);
        }
        return true;
      },
      { id: setup.manifoldId, mode },
    );
    assert(state, `Policy ${mode} could not be applied.`);
    await page.waitForTimeout(520);
    policyVisuals[mode] = await page.evaluate((id) => {
      const rig = window.__CINDERLINE__?.renderer.entityObjects.get(id);
      if (!rig) throw new Error("Policy visual rig is missing.");
      return {
        vaneAngle: rig.parts.manifoldVane?.rotation.y ?? 0,
        displayedPort: rig.parts.manifoldDisplayedPort,
        targetPort: rig.parts.manifoldTargetPort,
        switchProgress: rig.parts.manifoldSwitchProgress,
        core: `#${rig.parts.manifoldCoreMaterial?.color.getHexString()}`,
        lamps: (rig.parts.manifoldPortLamps ?? []).map((material) => ({
          color: `#${material.color.getHexString()}`,
          intensity: material.emissiveIntensity,
        })),
      };
    }, setup.manifoldId);
    await page.screenshot({
      path: `${OUTPUT_DIRECTORY}/policy-${mode}.png`,
    });
    await page.screenshot({
      path: `${OUTPUT_DIRECTORY}/policy-${mode}-crop.png`,
      clip: policyClip,
    });
  }
  assert(
    Math.abs(policyVisuals.even.vaneAngle) < 0.15
      && policyVisuals.even.lamps.every(
        (lamp) => lamp.color.toLowerCase() === "#43d7c4",
      ),
    "Even policy did not produce a centered, symmetric teal mechanism.",
  );
  assert(
    policyVisuals.favorA.vaneAngle > 0.45
    && policyVisuals.favorB.vaneAngle < -0.45,
    "Favor A/B did not produce distinct selector-vane positions.",
  );
  assert(
    policyVisuals.extract.core.toLowerCase() === "#a869e8",
    "Extract policy did not produce its violet chamber signal.",
  );

  const switchVisuals = [];
  const switchApplied = await page.evaluate((id) => {
    const simulation = window.__CINDERLINE__?.simulation;
    if (!simulation) throw new Error("Switch-sequence bridge unavailable.");
    return simulation.setManifoldRouting(id, { mode: "favorB" });
  }, setup.manifoldId);
  assert(switchApplied, "Could not stage the Favor A-to-B selector transition.");
  for (const [frame, delay] of [70, 90, 90, 170].entries()) {
    await page.waitForTimeout(delay);
    switchVisuals.push(await page.evaluate((id) => {
      const rig = window.__CINDERLINE__?.renderer.entityObjects.get(id);
      if (!rig) throw new Error("Switch-sequence visual rig is missing.");
      return {
        progress: Number((rig.parts.manifoldSwitchProgress ?? 0).toFixed(3)),
        vaneAngle: Number((rig.parts.manifoldVane?.rotation.y ?? 0).toFixed(3)),
        shutterOffsets: (rig.parts.manifoldShutters ?? []).map((shutter) => (
          Number(shutter.position.x.toFixed(3))
        )),
      };
    }, setup.manifoldId));
    await page.screenshot({
      path: `${OUTPUT_DIRECTORY}/switch-${frame + 1}.png`,
      clip: policyClip,
    });
  }
  assert(
    switchVisuals.every((state, index) => (
      index === 0 || state.progress >= switchVisuals[index - 1].progress
    ))
      && switchVisuals[0].progress < switchVisuals.at(-1).progress,
    "Selector transition did not advance monotonically.",
  );
  assert(
    switchVisuals.slice(1, 3).some((state) => (
      state.shutterOffsets.every((offset) => Math.abs(offset) <= 0.35)
    )),
    "Selector transition never visibly closed both ports before turning.",
  );
  assert(
    switchVisuals.at(-1).vaneAngle < -1.25
      && switchVisuals.at(-1).shutterOffsets[1] > 0.43,
    "Selector transition did not finish by opening Favor B.",
  );

  const blockedVisual = await page.evaluate(
    ({ manifoldId }) => {
      const game = window.__CINDERLINE__;
      const simulation = game?.simulation;
      if (!simulation) throw new Error("Blocked-state bridge unavailable.");
      if (!simulation.setManifoldRouting(manifoldId, { mode: "even" })) {
        throw new Error("Could not reset manifold to Even for blockage QA.");
      }
      const branchDocks = [
        simulation.getEntityAt(13, 9),
        simulation.getEntityAt(13, 11),
      ];
      if (branchDocks.some((entity) => entity?.kind !== "belt")) {
        throw new Error("Blocked-state branch dock is missing.");
      }
      let packedPayloads = 0;
      for (let pulse = 0; pulse < 96; pulse += 1) {
        for (const dock of branchDocks) {
          packedPayloads += simulation.receive(
            dock.id,
            pulse % 2 === 0 ? "ironOre" : "copperOre",
            1,
            "belt",
            pulse % 2,
          );
        }
        simulation.step(8);
      }
      const accepted = simulation.receive(
        manifoldId,
        "ironOre",
        1,
        "belt",
        0,
      );
      if (accepted !== 1) {
        throw new Error(`Blocked-state manifold accepted ${accepted}/1 payload.`);
      }
      simulation.step(2);
      return { packedPayloads, status: simulation.getEntity(manifoldId)?.status };
    },
    setup,
  );
  assert(
    blockedVisual.packedPayloads >= 48,
    "Blocked-state fixture did not saturate both downstream branches.",
  );
  await page.keyboard.press("Space");
  await page.waitForFunction(
    (id) => (
      window.__CINDERLINE__?.simulation.getEntity(id)?.status === "blocked"
    ),
    setup.manifoldId,
    { timeout: 8_000 },
  );
  await page.keyboard.press("Space");
  await page.waitForTimeout(520);
  const blockedState = await page.evaluate((id) => {
    const game = window.__CINDERLINE__;
    const entity = game?.simulation.getEntity(id);
    const rig = game?.renderer.entityObjects.get(id);
    if (!entity || !rig) throw new Error("Blocked-state visual rig is missing.");
    return {
      status: entity.status,
      core: `#${rig.parts.manifoldCoreMaterial?.color.getHexString()}`,
      selector: `#${rig.parts.manifoldSelectorMaterial?.color.getHexString()}`,
      lamps: (rig.parts.manifoldPortLamps ?? []).map((material) => (
        `#${material.color.getHexString()}`
      )),
      shutterOffsets: (rig.parts.manifoldShutters ?? []).map((shutter) => (
        Number(shutter.position.x.toFixed(3))
      )),
    };
  }, setup.manifoldId);
  assert(blockedState.status === "blocked", "Fixture did not remain blocked.");
  assert(
    blockedState.core.toLowerCase() === "#43d7c4",
    "Blocked state erased the selected Even policy color.",
  );
  assert(
    blockedState.selector.toLowerCase() === "#ff6550"
      && blockedState.lamps.some((color) => color.toLowerCase() === "#ff6550"),
    "Blocked state did not expose a red mechanical fault signal.",
  );
  assert(
    blockedState.shutterOffsets.filter(
      (offset) => Math.abs(offset) <= 0.3,
    ).length === 1
      && blockedState.shutterOffsets.some(
        (offset) => Math.abs(offset) >= 0.42,
      ),
    "Blocked state did not close the requested route while preserving bypass truth.",
  );
  await page.screenshot({
    path: `${OUTPUT_DIRECTORY}/policy-blocked.png`,
  });
  await page.screenshot({
    path: `${OUTPUT_DIRECTORY}/policy-blocked-crop.png`,
    clip: policyClip,
  });

  if (failures.length > 0) {
    throw new Error(`Browser warnings/errors:\n${failures.join("\n")}`);
  }
  console.log(JSON.stringify({
    ok: true,
    conservation: result.allPayloads.length,
    extractPurity: { A: result.upper.length, B: result.lower.length },
    rig: result.rig,
    instancedItemBuckets: result.sceneItems,
    memory: result.memory,
    responsive,
    motionEvidence,
    policyVisuals,
    switchVisuals,
    blockedState,
    captures: [
      `${OUTPUT_DIRECTORY}/routing-inspector.png`,
      `${OUTPUT_DIRECTORY}/extract-network.png`,
      `${OUTPUT_DIRECTORY}/motion-1.png`,
      `${OUTPUT_DIRECTORY}/motion-2.png`,
      `${OUTPUT_DIRECTORY}/motion-3.png`,
      `${OUTPUT_DIRECTORY}/motion-4.png`,
      `${OUTPUT_DIRECTORY}/policy-even.png`,
      `${OUTPUT_DIRECTORY}/policy-even-crop.png`,
      `${OUTPUT_DIRECTORY}/policy-favorA.png`,
      `${OUTPUT_DIRECTORY}/policy-favorA-crop.png`,
      `${OUTPUT_DIRECTORY}/policy-favorB.png`,
      `${OUTPUT_DIRECTORY}/policy-favorB-crop.png`,
      `${OUTPUT_DIRECTORY}/policy-extract.png`,
      `${OUTPUT_DIRECTORY}/policy-extract-crop.png`,
      `${OUTPUT_DIRECTORY}/switch-1.png`,
      `${OUTPUT_DIRECTORY}/switch-2.png`,
      `${OUTPUT_DIRECTORY}/switch-3.png`,
      `${OUTPUT_DIRECTORY}/switch-4.png`,
      `${OUTPUT_DIRECTORY}/policy-blocked.png`,
      `${OUTPUT_DIRECTORY}/policy-blocked-crop.png`,
    ],
  }, null, 2));
} finally {
  await browser.close();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
