import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY = ".qa/inserter-custody";
const srgbToLinear = (value) => (
  value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4
);
const COPPER_ORE_RGB = [0xc8, 0x78, 0x42]
  .map((channel) => srgbToLinear(channel / 255));

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

  await page.goto(`${BASE_URL}/?fresh=inserter-custody-qa`, {
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

  const setup = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    const simulation = game?.simulation;
    const renderer = game?.renderer;
    if (!simulation || !renderer) {
      throw new Error("Inserter custody QA bridge unavailable.");
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
          `Could not place custody QA ${kind} at ${x},${y}: ${result.reason}.`,
        );
      }
      return result.entity;
    };

    const source = place("belt", 12, 10);
    const inserter = place("inserter", 13, 10);
    const target = place("belt", 14, 10);
    const generator = place("generator", 8, 14);
    const fueled = simulation.receive(generator.id, "coal", 4, "fuel");
    if (fueled !== 4) {
      throw new Error(`Generator accepted ${fueled}/4 coal.`);
    }
    const seeded = simulation.receive(source.id, "copperOre", 1, "belt", 0);
    if (seeded !== 1) {
      throw new Error(`Source accepted ${seeded}/1 lane-0 copper ore.`);
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
    renderer.focus(13.5, 10.5);
    for (let index = 0; index < 10; index += 1) renderer.zoom(-4);

    const originalUpdate = renderer.update.bind(renderer);
    renderer.update = () => {};
    const baseTick = simulation.tickCount;
    const nextAnimationFrame = () =>
      new Promise((resolve) => requestAnimationFrame(() => resolve()));

    const state = (contactName = "pickup") => {
      const sourceState = simulation.getEntity(source.id);
      const armState = simulation.getEntity(inserter.id);
      const targetState = simulation.getEntity(target.id);
      const rig = renderer.entityObjects.get(inserter.id);
      const canvas = document.querySelector("#world");
      if (
        !sourceState
        || !armState
        || !targetState
        || !rig
        || !(canvas instanceof HTMLCanvasElement)
      ) {
        throw new Error("Custody QA entity or render rig disappeared.");
      }

      rig.root.updateMatrixWorld(true);
      const contact = contactName === "drop"
        ? rig.entity.dropContact
        : rig.entity.pickupContact;
      if (!contact) {
        throw new Error(`Renderer omitted the ${contactName} contact.`);
      }
      const gripper = rig.parts.gripper;
      const armYaw = rig.parts.armYaw;
      if (!gripper || !armYaw) {
        throw new Error("Inserter articulation rig is incomplete.");
      }
      const gripperWorld = rig.root.position.clone();
      gripper.getWorldPosition(gripperWorld);
      const contactWorld = rig.root.position.clone().set(contact[0], 0, contact[1]);
      rig.root.localToWorld(contactWorld);
      const horizontalDistance = Math.hypot(
        gripperWorld.x - contactWorld.x,
        gripperWorld.z - contactWorld.z,
      );

      const projectionContact = contactWorld.clone();
      projectionContact.y = gripperWorld.y;
      const bounds = canvas.getBoundingClientRect();
      const project = (point) => {
        const projected = point.clone().project(renderer.camera);
        return {
          x: bounds.left + (projected.x + 1) * bounds.width * 0.5,
          y: bounds.top + (-projected.y + 1) * bounds.height * 0.5,
        };
      };
      const gripperPixel = project(gripperWorld);
      const contactPixel = project(projectionContact);
      const projectedContactError = Math.hypot(
        gripperPixel.x - contactPixel.x,
        gripperPixel.y - contactPixel.y,
      );

      const armQuaternion = rig.root.quaternion.clone();
      armYaw.getWorldQuaternion(armQuaternion);
      const boomDirection = rig.root.position
        .clone()
        .set(0, 0, -1)
        .applyQuaternion(armQuaternion);
      boomDirection.y = 0;
      boomDirection.normalize();
      const rootQuaternion = rig.root.quaternion.clone();
      rig.root.getWorldQuaternion(rootQuaternion);
      const expectedAxis = rig.root.position
        .clone()
        .set(0, 0, contactName === "drop" ? -1 : 1)
        .applyQuaternion(rootQuaternion);
      expectedAxis.y = 0;
      expectedAxis.normalize();
      const directionDot = boomDirection.dot(expectedAxis);

      const jawA = rig.parts.gripperJaws?.[0];
      const jawB = rig.parts.gripperJaws?.[1];
      const jawGap = jawA && jawB
        ? Math.abs(jawB.position.x - jawA.position.x)
        : Number.NaN;
      const jawWorldA = rig.root.position.clone();
      const jawWorldB = rig.root.position.clone();
      jawA?.getWorldPosition(jawWorldA);
      jawB?.getWorldPosition(jawWorldB);
      const jawPixelA = project(jawWorldA);
      const jawPixelB = project(jawWorldB);
      const jawPixelGap = Math.hypot(
        jawPixelB.x - jawPixelA.x,
        jawPixelB.y - jawPixelA.y,
      );
      const tipA = rig.parts.gripperTipAnchors?.[0];
      const tipB = rig.parts.gripperTipAnchors?.[1];
      if (!tipA || !tipB || !jawA || !jawB) {
        throw new Error("Inserter hooked-tip evidence is incomplete.");
      }
      const tipWorldA = rig.root.position.clone();
      const tipWorldB = rig.root.position.clone();
      tipA.getWorldPosition(tipWorldA);
      tipB.getWorldPosition(tipWorldB);
      const tipPixelA = project(tipWorldA);
      const tipPixelB = project(tipWorldB);
      const jawScreenAxis = {
        x: (jawPixelB.x - jawPixelA.x) / jawPixelGap,
        y: (jawPixelB.y - jawPixelA.y) / jawPixelGap,
      };
      const jawMidPixel = {
        x: (jawPixelA.x + jawPixelB.x) * 0.5,
        y: (jawPixelA.y + jawPixelB.y) * 0.5,
      };
      const projectOnJawAxis = (pixel) =>
        (pixel.x - jawMidPixel.x) * jawScreenAxis.x
        + (pixel.y - jawMidPixel.y) * jawScreenAxis.y;
      const tipAxisA = projectOnJawAxis(tipPixelA);
      const tipAxisB = projectOnJawAxis(tipPixelB);
      const tipAperture = tipAxisB - tipAxisA;
      const payload = rig.parts.heldItem;
      const visibleVariants = Object.values(rig.parts.heldItemVariants ?? {})
        .filter((variant) => variant?.visible).length;
      const payloadWorld = rig.root.position.clone();
      payload?.getWorldPosition(payloadWorld);
      const payloadMaterial = rig.parts.heldItemMaterial;
      const color = payloadMaterial
        ? [
            payloadMaterial.color.r,
            payloadMaterial.color.g,
            payloadMaterial.color.b,
          ]
        : null;
      const ao = rig.root.getObjectByName("inserter-contact-shadow");
      const beltItemEvidence = (belt, item) => {
        if (!item) return null;
        const vectors = [
          { x: 0, z: -1 },
          { x: 1, z: 0 },
          { x: 0, z: 1 },
          { x: -1, z: 0 },
        ];
        const forward = vectors[belt.direction] ?? vectors[0];
        const right = { x: -forward.z, z: forward.x };
        const laneOffset = item.lane === 0 ? -0.17 : 0.17;
        const itemX =
          belt.x + 0.5 + forward.x * (item.progress - 0.5)
          + right.x * laneOffset;
        const itemZ =
          belt.y + 0.5 + forward.z * (item.progress - 0.5)
          + right.z * laneOffset;
        const itemWorld = rig.root.position.clone().set(itemX, 0.31, itemZ);
        const itemPixel = project(itemWorld);
        const drop = rig.entity.dropContact;
        const dropWorld = rig.root.position.clone().set(
          drop?.[0] ?? 0,
          0,
          drop?.[1] ?? -0.5,
        );
        rig.root.localToWorld(dropWorld);
        return {
          itemWorld,
          gripperDistance: Math.hypot(
            gripperWorld.x - itemX,
            gripperWorld.z - itemZ,
          ),
          dropDistance: Math.hypot(
            dropWorld.x - itemX,
            dropWorld.z - itemZ,
          ),
          projectedGripperDistance: Math.hypot(
            gripperPixel.x - itemPixel.x,
            gripperPixel.y - itemPixel.y,
          ),
        };
      };
      const sourceEvidence = beltItemEvidence(
        sourceState,
        sourceState.beltItems[0],
      );
      const targetEvidence = beltItemEvidence(
        targetState,
        targetState.beltItems[0],
      );
      const activePayloadWorld = armState.heldItem
        ? payloadWorld
        : sourceEvidence?.itemWorld
          ?? targetEvidence?.itemWorld
          ?? payloadWorld;
      const activePayloadPixel = project(activePayloadWorld);
      const jawWorldAxis = jawWorldB.clone().sub(jawWorldA).normalize();
      const payloadEdgeA = project(
        activePayloadWorld.clone().addScaledVector(jawWorldAxis, -0.105),
      );
      const payloadEdgeB = project(
        activePayloadWorld.clone().addScaledVector(jawWorldAxis, 0.105),
      );
      const payloadAxisCenter = projectOnJawAxis(activePayloadPixel);
      const payloadHalfWidth = Math.abs(
        projectOnJawAxis(payloadEdgeB) - projectOnJawAxis(payloadEdgeA),
      ) * 0.5;
      const tipPayloadOverlapA =
        (tipAxisA - payloadAxisCenter) + payloadHalfWidth;
      const tipPayloadOverlapB =
        payloadHalfWidth - (tipAxisB - payloadAxisCenter);

      return {
        tick: simulation.tickCount,
        relativeTick: simulation.tickCount - baseTick,
        progress: armState.armProgress,
        heldItem: armState.heldItem ?? null,
        heldItemSourceLane: armState.heldItemSourceLane ?? null,
        armReturning: armState.armReturning,
        status: armState.status,
        renderCarriedItem: rig.entity.carriedItem ?? null,
        sourceItems: sourceState.beltItems.map((item) => ({ ...item })),
        targetItems: targetState.beltItems.map((item) => ({ ...item })),
        payloadVisible: Boolean(payload?.visible),
        visibleVariants,
        payloadY: payloadWorld.y,
        color,
        jawGap,
        jawPixelGap,
        tipAperture,
        tipPayloadOverlapA,
        tipPayloadOverlapB,
        tipPayloadClearanceY:
          Math.min(tipWorldA.y, tipWorldB.y) - activePayloadWorld.y,
        contact: [...contact],
        gripperXZ: [gripperWorld.x, gripperWorld.z],
        contactXZ: [contactWorld.x, contactWorld.z],
        horizontalDistance,
        projectedContactError,
        directionDot,
        sourcePayloadDistance: sourceEvidence?.gripperDistance ?? null,
        targetPayloadDistance: targetEvidence?.gripperDistance ?? null,
        targetDropContactDistance: targetEvidence?.dropDistance ?? null,
        targetPayloadPixelDistance:
          targetEvidence?.projectedGripperDistance ?? null,
        hasGroundAO: Boolean(ao?.visible),
        visibleFeet: [0, 1, 2, 3].filter((index) =>
          rig.root.getObjectByName(`inserter-foot-${index}`)?.visible,
        ).length,
        meshCount: (() => {
          let count = 0;
          rig.root.traverse((object) => {
            if (object.isMesh) count += 1;
          });
          return count;
        })(),
      };
    };

    const reached = (phase, snapshot) => {
      switch (phase) {
        case "reach":
          return snapshot.heldItem === null
            && snapshot.sourceItems.length === 1
            && snapshot.sourceItems[0].progress >= 0.95;
        case "pickup":
          return snapshot.heldItem === "copperOre"
            && snapshot.progress <= 0.001;
        case "lift":
          return snapshot.heldItem === "copperOre"
            && snapshot.progress >= 0.2;
        case "mid":
          return snapshot.heldItem === "copperOre"
            && snapshot.progress >= 0.49;
        case "drop":
          return snapshot.heldItem === "copperOre"
            && snapshot.progress >= 0.999;
        case "release":
          return snapshot.heldItem === null
            && snapshot.armReturning
            && snapshot.targetItems.length === 1;
        default:
          throw new Error(`Unknown custody phase ${phase}.`);
      }
    };

    window.__INSERTER_CUSTODY_QA__ = {
      ids: {
        source: source.id,
        inserter: inserter.id,
        target: target.id,
        generator: generator.id,
      },
      events: () => observedEvents.map((event) => ({ ...event })),
      async settle(contactName = "pickup") {
        await nextAnimationFrame();
        await nextAnimationFrame();
        originalUpdate(0, 0);
        renderer.render(0);
        return state(contactName);
      },
      async advanceTo(phase, contactName = "pickup") {
        for (let step = 0; step < 120; step += 1) {
          simulation.step(1);
          await nextAnimationFrame();
          await nextAnimationFrame();
          const elapsed =
            (simulation.tickCount - baseTick) * simulation.fixedStepSeconds;
          originalUpdate(simulation.fixedStepSeconds, elapsed);
          renderer.render(0);
          const snapshot = state(contactName);
          if (reached(phase, snapshot)) return snapshot;
        }
        throw new Error(`Custody phase ${phase} was not reached within 120 ticks.`);
      },
    };

    return window.__INSERTER_CUSTODY_QA__.ids;
  });

  const captures = [];
  const capture = async (phase, state, caption) => {
    const index = captures.length + 1;
    const path =
      `${OUTPUT_DIRECTORY}/frame-${String(index).padStart(2, "0")}-${phase}.png`;
    const buffer = await page.screenshot({
      path,
      clip: { x: 610, y: 300, width: 700, height: 480 },
    });
    captures.push({
      phase,
      path,
      state,
      caption,
      dataURL: `data:image/png;base64,${buffer.toString("base64")}`,
    });
  };

  const reach = await page.evaluate(
    () => window.__INSERTER_CUSTODY_QA__?.advanceTo("reach", "pickup"),
  );
  assert(reach, "Could not capture the reach phase.");
  assert(
    reach.heldItem === null
      && reach.sourceItems.length === 1
      && reach.sourceItems[0].item === "copperOre"
      && reach.sourceItems[0].lane === 0,
    "Reach phase did not preserve the single lane-0 source payload.",
  );
  validateOpenState(reach, "reach");
  validateContact(reach, "reach");
  assert(
    reach.sourcePayloadDistance <= 0.06,
    `reach: source payload is ${reach.sourcePayloadDistance} world units from the jaws.`,
  );
  await capture("reach", reach, "01 REACH · OPEN JAWS · SOURCE L0");

  const pickup = await page.evaluate(
    () => window.__INSERTER_CUSTODY_QA__?.advanceTo("pickup", "pickup"),
  );
  assert(pickup, "Could not capture the pickup phase.");
  validateCustody(pickup, "pickup");
  validateContact(pickup, "pickup");
  assert(
    pickup.jawGap <= 0.27,
    `Pickup did not visibly clamp the payload (jaw gap ${pickup.jawGap}).`,
  );
  await capture("pickup", pickup, "02 PICKUP · COPPER ORE ACQUIRED");

  const lift = await page.evaluate(
    () => window.__INSERTER_CUSTODY_QA__?.advanceTo("lift", "pickup"),
  );
  assert(lift, "Could not capture the lift phase.");
  validateCustody(lift, "lift");
  validateClosedJaws(lift, "lift");
  await capture("lift", lift, "03 LIFT · JAWS CLAMPED · CUSTODY");

  const mid = await page.evaluate(
    () => window.__INSERTER_CUSTODY_QA__?.advanceTo("mid", "pickup"),
  );
  assert(mid, "Could not capture the mid-carry phase.");
  validateCustody(mid, "mid-carry");
  validateClosedJaws(mid, "mid-carry");
  await capture("mid-carry", mid, "04 MID-CARRY · VISIBLE PAYLOAD");

  const drop = await page.evaluate(
    () => window.__INSERTER_CUSTODY_QA__?.advanceTo("drop", "drop"),
  );
  assert(drop, "Could not capture the drop-contact phase.");
  validateCustody(drop, "drop-contact");
  validateContact(drop, "drop-contact");
  validateClosedJaws(drop, "drop-contact");
  await capture("drop-contact", drop, "05 DROP CONTACT · TARGET L1");

  const release = await page.evaluate(
    () => window.__INSERTER_CUSTODY_QA__?.advanceTo("release", "drop"),
  );
  assert(release, "Could not capture the release phase.");
  assert(
    release.heldItem === null
      && release.renderCarriedItem === null
      && release.armReturning
      && release.targetItems.length === 1
      && release.targetItems[0].item === "copperOre"
      && release.targetItems[0].lane === 1,
    "Release phase did not place the one payload onto target lane 1.",
  );
  validateOpenState(release, "release");
  assert(
    release.targetDropContactDistance <= 0.03,
    `release: target payload is ${release.targetDropContactDistance} world units from its exact drop contact.`,
  );
  assert(
    release.targetPayloadDistance >= 0.24,
    `release: empty head retracted only ${release.targetPayloadDistance} world units.`,
  );
  assert(
    release.targetPayloadPixelDistance >= 18,
    `release: head/payload centers separate by only ${release.targetPayloadPixelDistance}px.`,
  );
  await capture("release", release, "06 RELEASE · TARGET L1 · RETRACT");

  assert(
    mid.payloadY - Math.max(pickup.payloadY, drop.payloadY) >= 0.16,
    `Mid-carry lift is ${(mid.payloadY - Math.max(pickup.payloadY, drop.payloadY)).toFixed(4)}; expected at least 0.16.`,
  );
  assert(
    reach.jawGap - lift.jawGap >= 0.225,
    `Jaw center-gap delta is ${(reach.jawGap - lift.jawGap).toFixed(4)}; expected at least 0.225.`,
  );
  assert(
    reach.jawPixelGap - lift.jawPixelGap >= 16,
    `Projected jaw-gap delta is ${(reach.jawPixelGap - lift.jawPixelGap).toFixed(3)}px; expected at least 16px.`,
  );
  assert(
    reach.tipAperture - pickup.tipAperture >= 15,
    `Projected inner-tip aperture changes by only ${(reach.tipAperture - pickup.tipAperture).toFixed(3)}px; expected at least 15px.`,
  );
  for (const frame of [reach, pickup, lift, mid, drop, release]) {
    const conserved =
      frame.sourceItems.length
      + frame.targetItems.length
      + (frame.heldItem ? 1 : 0);
    assert(conserved === 1, `${frame.relativeTick}: custody count is ${conserved}.`);
    assert(frame.hasGroundAO, `${frame.relativeTick}: local ground AO is absent.`);
    assert(
      frame.visibleFeet === 4,
      `${frame.relativeTick}: only ${frame.visibleFeet}/4 pedestal feet are visible.`,
    );
  }

  const events = await page.evaluate(
    () => window.__INSERTER_CUSTODY_QA__?.events(),
  );
  const transfers = events.filter(
    (event) =>
      event.type === "itemTransferred"
      && event.entityId === setup.target
      && event.item === "copperOre"
      && event.amount === 1,
  );
  assert(
    transfers.length === 1,
    `Expected one target transfer event; observed ${transfers.length}.`,
  );
  if (failures.length > 0) {
    throw new Error(
      `Inserter custody QA observed console failures:\n${failures.join("\n")}`,
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
    ids: setup,
    phases: captures.map(({ phase, path, state }) => {
      const atContact =
        phase === "reach"
        || phase === "pickup"
        || phase === "drop-contact";
      return {
        phase,
        path,
        relativeTick: state.relativeTick,
        progress: Number(state.progress.toFixed(4)),
        heldItem: state.heldItem,
        heldItemSourceLane: state.heldItemSourceLane,
        sourceItems: state.sourceItems,
        targetItems: state.targetItems,
        payloadVisible: state.payloadVisible,
        jawGap: Number(state.jawGap.toFixed(4)),
        jawPixelGap: Number(state.jawPixelGap.toFixed(3)),
        tipAperture: Number(state.tipAperture.toFixed(3)),
        tipPayloadOverlap: [
          Number(state.tipPayloadOverlapA.toFixed(3)),
          Number(state.tipPayloadOverlapB.toFixed(3)),
        ],
        tipPayloadClearanceY: Number(state.tipPayloadClearanceY.toFixed(4)),
        payloadY: Number(state.payloadY.toFixed(4)),
        contactError: atContact
          ? Number(state.horizontalDistance.toFixed(5))
          : null,
        projectedContactError: atContact
          ? Number(state.projectedContactError.toFixed(3))
          : null,
        directionDot: atContact
          ? Number(state.directionDot.toFixed(5))
          : null,
        sourcePayloadDistance: state.sourcePayloadDistance === null
          ? null
          : Number(state.sourcePayloadDistance.toFixed(5)),
        targetPayloadDistance: state.targetPayloadDistance === null
          ? null
          : Number(state.targetPayloadDistance.toFixed(5)),
        targetDropContactDistance: state.targetDropContactDistance === null
          ? null
          : Number(state.targetDropContactDistance.toFixed(5)),
        targetPayloadPixelDistance: state.targetPayloadPixelDistance === null
          ? null
          : Number(state.targetPayloadPixelDistance.toFixed(3)),
      };
    }),
    midCarryLift: Number(
      (mid.payloadY - Math.max(pickup.payloadY, drop.payloadY)).toFixed(4),
    ),
    transferEvent: transfers[0],
    meshCount: mid.meshCount,
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

function validateOpenState(state, phase) {
  assert(!state.payloadVisible, `${phase}: payload proxy remained visible.`);
  assert(
    state.visibleVariants === 0,
    `${phase}: ${state.visibleVariants} carried variants remained visible.`,
  );
  assert(
    state.jawGap >= 0.385 && state.jawGap <= 0.395,
    `${phase}: open jaw gap is ${state.jawGap}.`,
  );
  assert(
    state.jawPixelGap >= 28 && state.jawPixelGap <= 33,
    `${phase}: projected open jaw gap is ${state.jawPixelGap}px.`,
  );
  assert(
    state.tipAperture >= 15,
    `${phase}: projected inner-tip aperture is only ${state.tipAperture}px.`,
  );
  if (phase === "reach") {
    assert(
      state.tipPayloadOverlapA <= 0 && state.tipPayloadOverlapB <= 0,
      `${phase}: open tips overlap the payload silhouette by ${state.tipPayloadOverlapA}px / ${state.tipPayloadOverlapB}px.`,
    );
  }
}

function validateClosedJaws(state, phase) {
  assert(
    state.jawGap >= 0.155 && state.jawGap <= 0.165,
    `${phase}: closed jaw gap is ${state.jawGap}.`,
  );
  assert(
    state.jawPixelGap >= 11 && state.jawPixelGap <= 14.5,
    `${phase}: projected closed jaw gap is ${state.jawPixelGap}px.`,
  );
  assert(
    state.tipPayloadOverlapA >= 5 && state.tipPayloadOverlapB >= 5,
    `${phase}: hooked-tip silhouette overlap is only ${state.tipPayloadOverlapA}px / ${state.tipPayloadOverlapB}px.`,
  );
  assert(
    state.tipPayloadClearanceY >= 0.1,
    `${phase}: hooked tips sit only ${state.tipPayloadClearanceY} above the payload center.`,
  );
}

function validateCustody(state, phase) {
  assert(
    state.heldItem === "copperOre"
      && state.renderCarriedItem === "copperOre"
      && state.heldItemSourceLane === 0,
    `${phase}: authoritative copper-ore lane-0 custody was not preserved.`,
  );
  assert(state.payloadVisible, `${phase}: carried payload is not visible.`);
  assert(
    state.tipPayloadOverlapA >= 5 && state.tipPayloadOverlapB >= 5,
    `${phase}: hooked tips do not visibly cup the carried payload (${state.tipPayloadOverlapA}px / ${state.tipPayloadOverlapB}px).`,
  );
  assert(
    state.visibleVariants === 1,
    `${phase}: expected one item variant, observed ${state.visibleVariants}.`,
  );
  assert(state.color, `${phase}: carried material is absent.`);
  const error = Math.max(
    ...state.color.map((channel, index) =>
      Math.abs(channel - COPPER_ORE_RGB[index])),
  );
  assert(error < 0.04, `${phase}: carried color error is ${error}.`);
}

function validateContact(state, phase) {
  assert(
    state.horizontalDistance <= 0.06,
    `${phase}: gripper is ${state.horizontalDistance} world units from contact.`,
  );
  assert(
    state.projectedContactError <= 6,
    `${phase}: gripper is ${state.projectedContactError}px from contact.`,
  );
  assert(
    state.directionDot >= 0.98,
    `${phase}: boom/contact directional dot is ${state.directionDot}.`,
  );
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
        grid-template-columns: repeat(3, 1fr);
        grid-template-rows: repeat(2, 1fr);
        width: 1920px; height: 1080px; gap: 3px; padding: 3px;
      }
      figure {
        position: relative; margin: 0; overflow: hidden; background: #101719;
      }
      img { display: block; width: 100%; height: 100%; object-fit: cover; }
      figcaption {
        position: absolute; inset: 12px auto auto 12px; padding: 8px 11px;
        color: #bffff0; background: rgba(5, 15, 16, .9);
        border: 1px solid #58f1cf;
        font: 700 13px/1 ui-monospace, SFMono-Regular, monospace;
        letter-spacing: .08em; text-transform: uppercase;
      }
    </style>
    <main>
      ${captures.map(({ caption, dataURL }) => `
        <figure>
          <img src="${dataURL}">
          <figcaption>${caption}</figcaption>
        </figure>
      `).join("")}
    </main>`;
}
