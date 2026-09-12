import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY = ".qa/extractor-cycle";
const PHASES = [
  { name: "engage", progress: 0.1 },
  { name: "plunge", progress: 0.28 },
  { name: "bite", progress: 0.48 },
  { name: "full-torque", progress: 0.62 },
  { name: "retract", progress: 0.82 },
  { name: "discharge", progress: 0.96 },
];

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
    if (message.type() === "warning" || message.type() === "error") {
      failures.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));

  await page.goto(`${BASE_URL}/?fresh=extractor-cycle-qa`, {
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
  await page.keyboard.press("Space");

  const pausedTick = await page.evaluate(
    () => window.__CINDERLINE__?.simulation.tickCount,
  );
  await page.waitForTimeout(80);
  const heldTick = await page.evaluate(
    () => window.__CINDERLINE__?.simulation.tickCount,
  );
  assert(
    pausedTick === heldTick,
    `Extractor-cycle QA could not pause the simulation (${pausedTick} → ${heldTick}).`,
  );

  const setup = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    const simulation = game?.simulation;
    const renderer = game?.renderer;
    if (!simulation || !renderer) {
      throw new Error("Extractor-cycle QA bridge unavailable.");
    }

    for (const entity of simulation.getEntities()) {
      const removed = simulation.remove(entity.x, entity.y);
      if (!removed || removed.id !== entity.id) {
        throw new Error(`Could not remove showcase entity ${entity.id}.`);
      }
    }
    for (const resource of simulation.getResources()) {
      if (!simulation.setResource(resource.x, resource.y, resource.type, 0)) {
        throw new Error(`Could not clear resource ${resource.x},${resource.y}.`);
      }
    }

    const EAST = 1;
    for (let y = 9; y <= 12; y += 1) {
      for (let x = 11; x <= 14; x += 1) {
        if (x === 14 && y === 10) continue;
        if (!simulation.setResource(x, y, "copper", 8)) {
          throw new Error(
            `Could not seed the extractor-cycle copper seam at ${x},${y}.`,
          );
        }
      }
    }
    const place = (kind, x, y, direction = EAST) => {
      const result = simulation.place(kind, x, y, direction);
      if (!result.ok) {
        throw new Error(
          `Could not place extractor-cycle ${kind} at ${x},${y}: ${result.reason}.`,
        );
      }
      return result.entity;
    };
    const extractor = place("extractor", 12, 10);
    const target = place("belt", 14, 10);
    const generator = place("generator", 9, 14);
    const fueled = simulation.receive(generator.id, "coal", 4, "fuel");
    if (fueled !== 4) {
      throw new Error(`Generator accepted ${fueled}/4 coal.`);
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
    renderer.overlayRoot.visible = false;
    renderer.effectsRoot.visible = false;
    renderer.resourceRoot.visible = true;
    renderer.infrastructureRoot.visible = false;

    const isolate = () => {
      renderer.resourceRoot.visible = true;
      for (const [entityId, rig] of renderer.entityObjects) {
        rig.root.visible = entityId === extractor.id || entityId === target.id;
      }
    };
    const originalSync = renderer.sync.bind(renderer);
    renderer.sync = (snapshot) => {
      originalSync(snapshot);
      isolate();
    };
    const originalUpdate = renderer.update.bind(renderer);
    renderer.update = () => {};
    renderer.focus(13.25, 10.85);
    for (let index = 0; index < 10; index += 1) renderer.zoom(-4);
    isolate();

    const baseTick = simulation.tickCount;
    const initialProduced = simulation.productionLedger().copperOre ?? 0;
    const initialResource = simulation.getResources()
      .reduce((sum, resource) => sum + (
        resource.type === "copper" ? resource.amount : 0
      ), 0);
    const nextAnimationFrame = () =>
      new Promise((resolve) => requestAnimationFrame(() => resolve()));

    const state = () => {
      const extractorState = simulation.getEntity(extractor.id);
      const targetState = simulation.getEntity(target.id);
      const rig = renderer.entityObjects.get(extractor.id);
      const canvas = document.querySelector("#world");
      if (
        !extractorState
        || !targetState
        || !rig
        || !(canvas instanceof HTMLCanvasElement)
      ) {
        throw new Error("Extractor-cycle entity or render rig disappeared.");
      }
      const required = {
        carriage: rig.parts.extractorCarriage,
        rotor: rig.parts.rotor,
        landmark: rig.parts.extractorDrillLandmark,
        bite: rig.parts.extractorContactAnchor,
        opening: rig.parts.extractorFloorOpening,
        crown: rig.parts.extractorChipCrown,
        dust: rig.parts.extractorDustRing,
        movingMaterial: rig.parts.extractorMovingMaterial,
        gantryMaterial: rig.parts.extractorGantryMaterial,
        output: rig.parts.extractorOutputContactAnchor,
        mouth: rig.parts.extractorChuteMouthAnchor,
        gate: rig.parts.extractorChuteGateAnchor,
        lip: rig.parts.extractorChuteLip,
        feet: rig.parts.extractorFeet,
        lamp: rig.parts.extractorStatusLamp,
        unload: rig.parts.extractorUnloadLinkage,
        wear: rig.parts.extractorWear,
        pitShadow: rig.root.getObjectByName("extractor-contact-shadow"),
      };
      for (const [name, part] of Object.entries(required)) {
        if (!part) throw new Error(`Extractor rig is missing ${name}.`);
      }
      rig.root.updateMatrixWorld(true);
      const worldPosition = (part) => {
        const point = rig.root.position.clone();
        part.getWorldPosition(point);
        return point;
      };
      const carriageWorld = worldPosition(required.carriage);
      const rotorWorld = worldPosition(required.rotor);
      const landmarkWorld = worldPosition(required.landmark);
      const biteWorld = worldPosition(required.bite);
      const outputWorld = worldPosition(required.output);
      const mouthWorld = worldPosition(required.mouth);
      const gateWorld = worldPosition(required.gate);
      const crownWorld = worldPosition(required.crown);
      const crownEdgeWorld = rig.root.position.clone().set(0.205, 0.012, 0);
      required.crown.localToWorld(crownEdgeWorld);
      const groundWorld = biteWorld.clone();
      groundWorld.y = 0;

      const bounds = canvas.getBoundingClientRect();
      const project = (point) => {
        const projected = point.clone().project(renderer.camera);
        return {
          x: bounds.left + (projected.x + 1) * bounds.width * 0.5,
          y: bounds.top + (-projected.y + 1) * bounds.height * 0.5,
        };
      };
      const pixelDistance = (left, right) => {
        const a = project(left);
        const b = project(right);
        return Math.hypot(a.x - b.x, a.y - b.y);
      };
      const pointSegmentDistance = (point, start, end) => {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared === 0
          ? 0
          : Math.max(0, Math.min(
            1,
            ((point.x - start.x) * dx + (point.y - start.y) * dy)
              / lengthSquared,
          ));
        return Math.hypot(
          point.x - (start.x + dx * t),
          point.y - (start.y + dy * t),
        );
      };
      const lipWidth = required.lip.userData.width;
      const lipStartWorld = required.lip.position.clone().set(
        -lipWidth * 0.5,
        0,
        0,
      );
      const lipEndWorld = required.lip.position.clone().set(
        lipWidth * 0.5,
        0,
        0,
      );
      required.lip.localToWorld(lipStartWorld);
      required.lip.localToWorld(lipEndWorld);
      const landmarkNdc = landmarkWorld.clone().project(renderer.camera);
      const landmarkRay = renderer.raycaster;
      landmarkRay.setFromCamera(
        { x: landmarkNdc.x, y: landmarkNdc.y },
        renderer.camera,
      );
      const landmarkFrontHit = landmarkRay.intersectObject(rig.root, true)[0];
      const landmarkVisibleAtCentroid =
        landmarkFrontHit?.object === required.landmark;
      const luminance = (material) => (
        material.color.r * 0.2126
        + material.color.g * 0.7152
        + material.color.b * 0.0722
      );
      const targetItem = targetState.beltItems[0];
      let targetItemWorld = null;
      let outputContactDistance = null;
      let outputContactPixels = null;
      let targetItemRadiusPixels = null;
      let targetItemAreaPixels = null;
      let payloadGateClearancePixels = null;
      let payloadLipClearancePixels = null;
      if (targetItem) {
        const vectors = [
          { x: 0, z: -1 },
          { x: 1, z: 0 },
          { x: 0, z: 1 },
          { x: -1, z: 0 },
        ];
        const forward = vectors[targetState.direction] ?? vectors[0];
        const right = { x: -forward.z, z: forward.x };
        const laneOffset = targetItem.lane === 0 ? -0.17 : 0.17;
        targetItemWorld = outputWorld.clone().set(
          targetState.x + 0.5
            + forward.x * (targetItem.progress - 0.5)
            + right.x * laneOffset,
          0.31,
          targetState.y + 0.5
            + forward.z * (targetItem.progress - 0.5)
            + right.z * laneOffset,
        );
        outputContactDistance = Math.hypot(
          outputWorld.x - targetItemWorld.x,
          outputWorld.z - targetItemWorld.z,
        );
        outputContactPixels = pixelDistance(outputWorld, targetItemWorld);
        const itemEdgeX = targetItemWorld.clone();
        const itemEdgeY = targetItemWorld.clone();
        const itemEdgeZ = targetItemWorld.clone();
        itemEdgeX.x += 0.125;
        itemEdgeY.y += 0.125;
        itemEdgeZ.z += 0.125;
        targetItemRadiusPixels = Math.max(
          pixelDistance(targetItemWorld, itemEdgeX),
          pixelDistance(targetItemWorld, itemEdgeY),
          pixelDistance(targetItemWorld, itemEdgeZ),
        );
        targetItemAreaPixels = Math.PI * targetItemRadiusPixels ** 2;
        payloadGateClearancePixels = (
          pixelDistance(gateWorld, targetItemWorld) - targetItemRadiusPixels
        );
        payloadLipClearancePixels = pointSegmentDistance(
          project(targetItemWorld),
          project(lipStartWorld),
          project(lipEndWorld),
        ) - targetItemRadiusPixels;
      }

      let meshCount = 0;
      let instancedMeshes = 0;
      let instancedDetails = 0;
      rig.root.traverse((object) => {
        if (object.isMesh) meshCount += 1;
        if (object.isInstancedMesh) {
          instancedMeshes += 1;
          instancedDetails += object.count;
        }
      });
      const remainingResource = simulation.getResources()
        .reduce((sum, resource) => sum + (
          resource.type === "copper" ? resource.amount : 0
        ), 0);
      const produced = (
        simulation.productionLedger().copperOre ?? 0
      ) - initialProduced;
      const outputCount = Object.values(extractorState.output)
        .reduce((sum, count) => sum + count, 0);
      const targetCount = targetState.beltItems.length;
      const landmarkVector = landmarkWorld.clone().sub(rotorWorld);
      const underFootprintResources = [...renderer.resourceObjects.values()]
        .filter((resourceRig) => (
          resourceRig.group.visible
          && resourceRig.group.position.x >= extractorState.x
          && resourceRig.group.position.x <= extractorState.x + 2
          && resourceRig.group.position.z >= extractorState.y
          && resourceRig.group.position.z <= extractorState.y + 2
        ));

      return {
        tick: simulation.tickCount,
        relativeTick: simulation.tickCount - baseTick,
        progress: extractorState.progress,
        status: extractorState.status,
        power: extractorState.powerSatisfaction,
        carriageY: carriageWorld.y,
        carriagePixels: project(carriageWorld),
        rotorAngle: rig.parts.rotor.rotation.y,
        landmarkAngle: Math.atan2(landmarkVector.x, landmarkVector.z),
        landmarkPixels: project(landmarkWorld),
        landmarkVisibleAtCentroid,
        biteContactGap: Math.abs(biteWorld.y),
        biteContactPixels: pixelDistance(biteWorld, groundWorld),
        chuteAperture: gateWorld.distanceTo(mouthWorld),
        chuteAperturePixels: pixelDistance(gateWorld, mouthWorld),
        chuteVerticalAperture: gateWorld.y - mouthWorld.y,
        chuteGateY: gateWorld.y,
        openingWidth: required.opening.userData.width,
        openingDepth: required.opening.userData.depth,
        contactResponse: required.crown.userData.response ?? 0,
        torqueExpansion: required.crown.userData.torqueExpansion ?? 0,
        contactCrownVisible: required.crown.visible,
        contactCrownPixels: pixelDistance(crownWorld, crownEdgeWorld) * 2,
        dustOpacity: required.dust.material.opacity,
        movingLuminance: luminance(required.movingMaterial),
        gantryLuminance: luminance(required.gantryMaterial),
        resourceKind: rig.entity.resourceKind ?? null,
        visibleResourceContext: [...renderer.resourceObjects.values()]
          .filter((resourceRig) => resourceRig.group.visible).length,
        underFootprintResourceCount: underFootprintResources.length,
        underFootprintResourceMaxY: Math.max(
          ...underFootprintResources.map(
            (resourceRig) => resourceRig.group.position.y,
          ),
        ),
        pitShadowWidth: required.pitShadow.scale.x * 1.18,
        pitShadowDepth: required.pitShadow.scale.y * 1.18,
        cycleFlash: rig.parts.cycleFlash ?? 0,
        targetItems: targetState.beltItems.map((item) => ({ ...item })),
        outputCount,
        targetCount,
        produced,
        resourceConsumed: initialResource - remainingResource,
        outputContactDistance,
        outputContactPixels,
        targetItemRadiusPixels,
        targetItemAreaPixels,
        payloadGateClearancePixels,
        payloadLipClearancePixels,
        readyLampVisible: required.lamp.visible,
        readySignal: required.lamp.userData.readySignal ?? 0,
        unloadLinkageVisible: required.unload.visible,
        unloadSignal: required.unload.userData.unloadSignal ?? 0,
        events: observedEvents.map((event) => ({ ...event })),
        feet: required.feet.count,
        lampCount: rig.root.getObjectByName("extractor-violet-status") ? 1 : 0,
        wearCount: required.wear.userData.wearCount ?? 0,
        wearScopes: [...(required.wear.userData.wearScopes ?? [])],
        meshCount,
        instancedMeshes,
        instancedDetails,
      };
    };

    const settle = async () => {
      await nextAnimationFrame();
      await nextAnimationFrame();
      isolate();
      const elapsed =
        (simulation.tickCount - baseTick) * simulation.fixedStepSeconds;
      originalUpdate(simulation.fixedStepSeconds, elapsed);
      renderer.render(0);
      return state();
    };

    window.__EXTRACTOR_CYCLE_QA__ = {
      ids: {
        extractor: extractor.id,
        target: target.id,
        generator: generator.id,
      },
      async advanceTo(progress) {
        for (let step = 0; step < 150; step += 1) {
          const before = simulation.getEntity(extractor.id)?.progress ?? 0;
          simulation.step(1);
          const after = simulation.getEntity(extractor.id)?.progress ?? 0;
          if (after < before) {
            throw new Error(
              `Extractor wrapped before visual phase ${progress.toFixed(2)}.`,
            );
          }
          if (after + 1e-8 >= progress) return settle();
        }
        throw new Error(`Extractor did not reach progress ${progress}.`);
      },
      async advanceToWrap() {
        for (let step = 0; step < 150; step += 1) {
          simulation.step(1);
          if (
            (simulation.productionLedger().copperOre ?? 0)
              - initialProduced === 1
          ) {
            return settle();
          }
        }
        throw new Error("Extractor did not produce within 150 ticks.");
      },
    };

    return {
      ids: window.__EXTRACTOR_CYCLE_QA__.ids,
      initialResource,
      initialProduced,
    };
  });

  const canvasBox = await page.locator("#world").boundingBox();
  if (!canvasBox) {
    throw new Error("Extractor-cycle QA could not read world-canvas bounds.");
  }
  const heroClip = {
    x: canvasBox.x + canvasBox.width * 0.5 - 270,
    y: canvasBox.y + canvasBox.height * 0.5 - 220,
    width: 540,
    height: 440,
  };
  const captures = [];
  for (const phase of PHASES) {
    const state = await page.evaluate(
      (progress) => window.__EXTRACTOR_CYCLE_QA__?.advanceTo(progress),
      phase.progress,
    );
    if (!state) throw new Error(`Could not capture ${phase.name}.`);
    const path =
      `${OUTPUT_DIRECTORY}/frame-${String(captures.length + 1).padStart(2, "0")}-${phase.name}.png`;
    const buffer = await page.screenshot({ path, clip: heroClip });
    captures.push({
      phase: phase.name,
      path,
      state,
      dataURL: `data:image/png;base64,${buffer.toString("base64")}`,
    });
  }

  const postWrap = await page.evaluate(
    () => window.__EXTRACTOR_CYCLE_QA__?.advanceToWrap(),
  );
  if (!postWrap) throw new Error("Could not capture post-wrap discharge.");
  const postWrapPath = `${OUTPUT_DIRECTORY}/frame-07-post-wrap.png`;
  const postWrapBuffer = await page.screenshot({
    path: postWrapPath,
    clip: heroClip,
  });
  captures.push({
    phase: "post-wrap",
    path: postWrapPath,
    state: postWrap,
    dataURL: `data:image/png;base64,${postWrapBuffer.toString("base64")}`,
  });

  const byPhase = Object.fromEntries(
    captures.map((capture) => [capture.phase, capture.state]),
  );
  const engage = byPhase.engage;
  const plunge = byPhase.plunge;
  const bite = byPhase.bite;
  const fullTorque = byPhase["full-torque"];
  const retract = byPhase.retract;
  const discharge = byPhase.discharge;
  assert(
    bite.biteContactGap <= 0.06,
    `Drill-to-ground contact gap is ${bite.biteContactGap.toFixed(4)} world units.`,
  );
  assert(
    bite.biteContactPixels <= 3,
    `Drill-to-ground contact gap is ${bite.biteContactPixels.toFixed(3)}px.`,
  );
  const carriageTravel = engage.carriageY - bite.carriageY;
  const carriagePixelTravel = Math.hypot(
    engage.carriagePixels.x - bite.carriagePixels.x,
    engage.carriagePixels.y - bite.carriagePixels.y,
  );
  assert(
    carriageTravel >= 0.18,
    `Carriage travels ${carriageTravel.toFixed(4)} world units.`,
  );
  assert(
    carriagePixelTravel >= 10,
    `Carriage travels ${carriagePixelTravel.toFixed(3)}px.`,
  );
  assert(
    engage.carriageY - plunge.carriageY >= 0.2
      && plunge.carriageY - bite.carriageY >= 0.18
      && retract.carriageY - bite.carriageY >= 0.25
      && engage.carriageY - retract.carriageY >= 0.12,
    "Engage, plunge, bite, and retract carriage silhouettes are not numerically ordered.",
  );
  assert(
    engage.movingLuminance - engage.gantryLuminance >= 0.14,
    `Moving/gantry luminance separation is only ${(engage.movingLuminance - engage.gantryLuminance).toFixed(4)}.`,
  );
  assert(
    engage.openingWidth >= 0.42
      && engage.openingDepth >= 0.48,
    `Floor opening is only ${engage.openingWidth}×${engage.openingDepth}.`,
  );
  assert(
    engage.visibleResourceContext >= 8
      && engage.resourceKind === "copper",
    `Copper seam context is incomplete (${engage.visibleResourceContext} visible, ${engage.resourceKind} active).`,
  );
  assert(
    engage.underFootprintResourceCount >= 4
      && engage.underFootprintResourceMaxY < 0,
    `Extractor aperture does not expose lowered authoritative ore (${engage.underFootprintResourceCount} resources at y=${engage.underFootprintResourceMaxY}).`,
  );
  assert(
    engage.pitShadowWidth >= engage.openingWidth
      && engage.pitShadowDepth >= engage.openingDepth,
    `Dark cutter pit (${engage.pitShadowWidth.toFixed(3)}×${engage.pitShadowDepth.toFixed(3)}) does not cover the ${engage.openingWidth}×${engage.openingDepth} opening.`,
  );
  for (const phase of [bite, fullTorque]) {
    assert(
      phase.contactCrownVisible
        && phase.contactResponse >= 0.9
        && phase.dustOpacity >= 0.25
        && phase.contactCrownPixels >= 8,
      "Bite/torque frame lacks the deterministic resource-colored contact crown.",
    );
  }
  for (const phase of [engage, plunge, retract, discharge, postWrap]) {
    assert(
      !phase.contactCrownVisible
        && phase.contactResponse <= 0.02
        && phase.dustOpacity <= 0.01,
      "Deterministic contact response leaked outside the bite/torque window.",
    );
  }
  assert(
    fullTorque.contactCrownPixels >= bite.contactCrownPixels * 1.75
      && fullTorque.dustOpacity - bite.dustOpacity >= 0.4
      && bite.torqueExpansion <= 0.02
      && fullTorque.torqueExpansion >= 0.98,
    `Torque debris is not decisively broader than bite (${bite.contactCrownPixels.toFixed(2)}px/${fullTorque.contactCrownPixels.toFixed(2)}px, opacity ${bite.dustOpacity.toFixed(2)}/${fullTorque.dustOpacity.toFixed(2)}).`,
  );
  const drillRotation = angularDistance(
    bite.landmarkAngle,
    fullTorque.landmarkAngle,
  );
  assert(
    drillRotation >= Math.PI / 4,
    `Visible drill landmark rotates only ${(drillRotation * 180 / Math.PI).toFixed(2)}°.`,
  );
  const cleatCentroidTravel = Math.hypot(
    bite.landmarkPixels.x - fullTorque.landmarkPixels.x,
    bite.landmarkPixels.y - fullTorque.landmarkPixels.y,
  );
  assert(
    cleatCentroidTravel >= 12,
    `Rotor cleat centroid travels only ${cleatCentroidTravel.toFixed(3)}px from bite to torque.`,
  );
  assert(
    bite.landmarkVisibleAtCentroid && fullTorque.landmarkVisibleAtCentroid,
    "Rotor cleat centroid is occluded in the bite or torque frame.",
  );
  assert(
    engage.readyLampVisible
      && engage.readySignal >= 0.95
      && !engage.unloadLinkageVisible,
    "Engage lacks its exclusive violet ready lamp.",
  );
  for (const phase of [plunge, bite, fullTorque, retract, discharge, postWrap]) {
    assert(
      !phase.readyLampVisible && phase.readySignal <= 0.02,
      "Violet ready lamp leaked outside engage.",
    );
  }
  assert(
    retract.unloadLinkageVisible
      && retract.unloadSignal >= 0.95
      && !retract.readyLampVisible,
    "Retract lacks its exclusive amber unloading linkage.",
  );
  for (const phase of [engage, plunge, bite, fullTorque, discharge, postWrap]) {
    assert(
      !phase.unloadLinkageVisible && phase.unloadSignal <= 0.02,
      "Amber unloading linkage leaked outside retract.",
    );
  }
  const chuteApertureDelta = Math.max(
    discharge.chuteAperturePixels,
    postWrap.chuteAperturePixels,
  ) - engage.chuteAperturePixels;
  assert(
    chuteApertureDelta >= 8,
    `Projected chute aperture changes by only ${chuteApertureDelta.toFixed(3)}px.`,
  );
  assert(
    postWrap.chuteVerticalAperture >= 0.24
      && postWrap.chuteVerticalAperture <= 0.32,
    `Post-wrap throat opens ${postWrap.chuteVerticalAperture.toFixed(4)} world units vertically.`,
  );
  assert(
    postWrap.produced === 1
      && postWrap.resourceConsumed === 1
      && postWrap.outputCount === 0
      && postWrap.targetCount === 1,
    "Post-wrap conservation failed: one consumed resource did not become exactly one target payload.",
  );
  assert(
    postWrap.targetItems[0]?.item === "copperOre"
      && postWrap.targetItems[0]?.lane === 0
      && postWrap.targetItems[0]?.progress === 0,
    "Post-wrap payload is not the exact lane-0 copper ore transfer at progress 0.",
  );
  assert(
    postWrap.outputContactDistance !== null
      && postWrap.outputContactDistance <= 0.06,
    `Output payload is ${postWrap.outputContactDistance} world units from the chute contact.`,
  );
  assert(
    postWrap.outputContactPixels !== null
      && postWrap.outputContactPixels <= 3,
    `Output payload is ${postWrap.outputContactPixels}px from the chute contact.`,
  );
  assert(
    postWrap.targetItemAreaPixels !== null
      && postWrap.targetItemAreaPixels >= 30
      && postWrap.payloadGateClearancePixels !== null
      && postWrap.payloadGateClearancePixels >= 6
      && postWrap.payloadLipClearancePixels !== null
      && postWrap.payloadLipClearancePixels >= 4,
    `Authoritative payload is not fully exposed beyond the flap/lip (${postWrap.targetItemAreaPixels?.toFixed(2)}px², gate ${postWrap.payloadGateClearancePixels?.toFixed(2)}px, lip ${postWrap.payloadLipClearancePixels?.toFixed(2)}px).`,
  );
  const producedEvents = postWrap.events.filter(
    (event) =>
      event.type === "itemProduced"
      && event.entityId === setup.ids.extractor
      && event.item === "copperOre"
      && event.amount === 1,
  );
  const transferEvents = postWrap.events.filter(
    (event) =>
      event.type === "itemTransferred"
      && event.entityId === setup.ids.target
      && event.item === "copperOre"
      && event.amount === 1,
  );
  assert(
    producedEvents.length === 1 && transferEvents.length === 1,
    `Expected one production and one transfer event; observed ${producedEvents.length}/${transferEvents.length}.`,
  );
  assert(
    producedEvents[0].tick === transferEvents[0].tick
      && producedEvents[0].id < transferEvents[0].id,
    "Extractor production/transfer events are not an ordered atomic discharge.",
  );
  for (const capture of captures) {
    assert(
      capture.state.feet === 4,
      `${capture.phase}: extractor exposes ${capture.state.feet}/4 broad feet.`,
    );
    assert(
      capture.state.lampCount === 1,
      `${capture.phase}: extractor has ${capture.state.lampCount} violet status lamps.`,
    );
    assert(
      capture.state.wearCount >= 10
        && [
          "cutter",
          "rail",
          "braces",
          "feet",
          "chute",
        ].every((scope) => capture.state.wearScopes.includes(scope)),
      `${capture.phase}: localized material wear does not cover every extractor contact surface.`,
    );
    assert(
      capture.state.meshCount <= 34,
      `${capture.phase}: extractor rig grew to ${capture.state.meshCount} meshes.`,
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `Extractor-cycle QA observed browser failures:\n${failures.join("\n")}`,
    );
  }

  const sheet = await context.newPage();
  await sheet.setViewportSize({ width: 1920, height: 1080 });
  await sheet.setContent(contactSheetMarkup(captures), { waitUntil: "load" });
  const contactSheetPath = `${OUTPUT_DIRECTORY}/contact-sheet.png`;
  await sheet.screenshot({ path: contactSheetPath, fullPage: true });
  const blindOrder = [
    "full-torque",
    "engage",
    "retract",
    "bite",
    "post-wrap",
    "plunge",
    "discharge",
  ];
  const blindCaptures = blindOrder.map(
    (phase) => captures.find((capture) => capture.phase === phase),
  );
  const blindSheet = await context.newPage();
  await blindSheet.setViewportSize({ width: 1920, height: 1080 });
  await blindSheet.setContent(contactSheetMarkup(blindCaptures), {
    waitUntil: "load",
  });
  const blindContactSheetPath =
    `${OUTPUT_DIRECTORY}/blind-contact-sheet.png`;
  await blindSheet.screenshot({
    path: blindContactSheetPath,
    fullPage: true,
  });
  await Promise.all(
    [
      contactSheetPath,
      blindContactSheetPath,
      ...captures.map(({ path }) => path),
    ]
      .map((path) => readFile(path)),
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    ids: setup.ids,
    frames: captures.map(({ phase, path, state }) => ({
      phase,
      path,
      relativeTick: state.relativeTick,
      progress: Number(state.progress.toFixed(4)),
      carriageY: Number(state.carriageY.toFixed(4)),
      biteContactGap: Number(state.biteContactGap.toFixed(5)),
      biteContactPixels: Number(state.biteContactPixels.toFixed(3)),
      chuteAperturePixels: Number(state.chuteAperturePixels.toFixed(3)),
      chuteVerticalAperture: Number(state.chuteVerticalAperture.toFixed(4)),
      contactResponse: Number(state.contactResponse.toFixed(3)),
      contactCrownPixels: Number(state.contactCrownPixels.toFixed(3)),
      dustOpacity: Number(state.dustOpacity.toFixed(3)),
      landmarkVisibleAtCentroid: state.landmarkVisibleAtCentroid,
      readySignal: Number(state.readySignal.toFixed(3)),
      unloadSignal: Number(state.unloadSignal.toFixed(3)),
      movingGantryLuminanceDelta: Number(
        (state.movingLuminance - state.gantryLuminance).toFixed(4),
      ),
      cycleFlash: Number(state.cycleFlash.toFixed(3)),
    })),
    proof: {
      carriageTravel: Number(carriageTravel.toFixed(4)),
      carriagePixelTravel: Number(carriagePixelTravel.toFixed(3)),
      drillLandmarkRotationDegrees: Number(
        (drillRotation * 180 / Math.PI).toFixed(3),
      ),
      cleatCentroidTravelPixels: Number(cleatCentroidTravel.toFixed(3)),
      biteTorqueCrownExpansion: Number(
        (fullTorque.contactCrownPixels / bite.contactCrownPixels).toFixed(3),
      ),
      chuteApertureDeltaPixels: Number(chuteApertureDelta.toFixed(3)),
      outputContactDistance: Number(postWrap.outputContactDistance.toFixed(5)),
      outputContactPixels: Number(postWrap.outputContactPixels.toFixed(3)),
      payloadProjectedAreaPixels: Number(
        postWrap.targetItemAreaPixels.toFixed(3),
      ),
      payloadGateClearancePixels: Number(
        postWrap.payloadGateClearancePixels.toFixed(3),
      ),
      payloadLipClearancePixels: Number(
        postWrap.payloadLipClearancePixels.toFixed(3),
      ),
      underFootprintResources: postWrap.underFootprintResourceCount,
      resourceConsumed: postWrap.resourceConsumed,
      produced: postWrap.produced,
      targetPayloads: postWrap.targetCount,
      productionEvent: producedEvents[0],
      transferEvent: transferEvents[0],
    },
    rigCost: {
      meshes: postWrap.meshCount,
      instancedMeshes: postWrap.instancedMeshes,
      instancedDetails: postWrap.instancedDetails,
    },
    contactSheet: contactSheetPath,
    blindContactSheet: blindContactSheetPath,
    blindOrder,
    warnings: failures,
  }, null, 2)}\n`);

  await context.close();
} finally {
  await browser.close();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function angularDistance(left, right) {
  const wrapped = ((right - left + Math.PI) % (Math.PI * 2) + Math.PI * 2)
    % (Math.PI * 2) - Math.PI;
  return Math.abs(wrapped);
}

function contactSheetMarkup(captures) {
  return `<!doctype html>
    <meta charset="utf-8">
    <style>
      * { box-sizing: border-box; }
      html, body {
        margin: 0; width: 100%; height: 100%; overflow: hidden;
        background: #071012;
      }
      main {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        grid-template-rows: repeat(2, 1fr);
        width: 1920px; height: 1080px; gap: 3px; padding: 3px;
      }
      figure {
        position: relative; margin: 0; overflow: hidden; background: #101719;
      }
      img { display: block; width: 100%; height: 100%; object-fit: cover; }
    </style>
    <main>
      ${captures.map(({ dataURL }) => `
        <figure><img src="${dataURL}"></figure>
      `).join("")}
    </main>`;
}
