import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY = resolve(
  process.env.RAIL_QA_OUTPUT_DIR ??
    ".qa/rail-network/pass12-work/formative-01",
);
const INTERIM = process.env.RAIL_QA_INTERIM === "1";
const artifactName = (name) =>
  INTERIM ? name.replace(/^visual-/, "interim-visual-") : name;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  OUTPUT_DIRECTORY.includes("/.qa/rail-network/pass12-work/") &&
    !OUTPUT_DIRECTORY.includes("/.qa/jury/rail-pass9-jury") &&
    !OUTPUT_DIRECTORY.includes("/.qa/jury/rail-pass10-jury") &&
    !OUTPUT_DIRECTORY.includes("/.qa/rail-network/pass10-candidate-01"),
  "PASS12 live QA output must stay in .qa/rail-network/pass12-work/**.",
);
await mkdir(OUTPUT_DIRECTORY, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
});
const browserErrors = [];

function auditPage(page, label) {
  page.on("pageerror", (error) =>
    browserErrors.push(`${label} pageerror: ${error.message}`),
  );
  page.on("response", (response) => {
    if (response.status() >= 400) {
      browserErrors.push(
        `${label} http ${response.status()}: ${response.url()}`,
      );
    }
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location();
    browserErrors.push(
      `${label} console: ${message.text()} @ ${location.url}:${location.lineNumber}:${location.columnNumber}`,
    );
  });
}

async function waitForBoot(page) {
  await page.waitForFunction(
    () =>
      document.querySelector("#boot")?.classList.contains("is-done") &&
      Boolean(window.__CINDERLINE__?.renderer),
    undefined,
    { timeout: 20_000 },
  );
}

async function settleLiveFrames(page, count = 3) {
  await page.evaluate(
    (frameCount) =>
      new Promise((resolveFrame) => {
        let remaining = frameCount;
        const advance = () => {
          remaining -= 1;
          if (remaining <= 0) resolveFrame();
          else requestAnimationFrame(advance);
        };
        requestAnimationFrame(advance);
      }),
    count,
  );
}

try {
  const cargoPage = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  auditPage(cargoPage, "cargo");
  await cargoPage.goto(
    `${BASE_URL.replace(/\/$/, "")}/?fresh=rail-pass12-live-cargo&railFixture=1`,
    { waitUntil: "networkidle", timeout: 30_000 },
  );
  await waitForBoot(cargoPage);

  const cargoSetup = await cargoPage.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game) throw new Error("Cinderline cargo bridge is unavailable.");
    const simulation = game.simulation;
    const world = game.renderer;
    document.querySelector("#boot")?.remove();
    const hud = document.querySelector("#hud");
    if (hud instanceof HTMLElement) hud.style.display = "none";
    game.dismissToasts();
    world.resourceRoot.visible = false;
    world.infrastructureRoot.visible = false;
    world.setSelected(null);

    if (simulation.railSnapshot()) {
      throw new Error("Fresh cargo fixture already owns a rail network.");
    }
    for (const existing of [...simulation.getEntities()]) {
      simulation.remove(existing.x, existing.y);
    }
    simulation.drainEvents();

    const dimensions = simulation.getRenderSnapshot();
    let sites = null;
    for (let y = 5; y <= dimensions.height - 5 && !sites; y += 1) {
      for (let left = 3; left <= 14 && !sites; left += 1) {
        for (
          let right = Math.max(left + 17, 21);
          right <= dimensions.width - 4;
          right += 1
        ) {
          if (
            simulation.canPlace("storage", left, y, 1).ok &&
            simulation.canPlace("storage", right, y, 3).ok
          ) {
            sites = { left, right, storageY: y, railY: y - 1 };
            break;
          }
        }
      }
    }
    if (!sites) throw new Error("No live cargo rail sites are buildable.");

    const mineResult = simulation.place(
      "storage",
      sites.left,
      sites.storageY,
      1,
    );
    const foundryResult = simulation.place(
      "storage",
      sites.right,
      sites.storageY,
      3,
    );
    if (!mineResult.ok || !foundryResult.ok) {
      throw new Error("Live cargo storage placement failed.");
    }
    const mine = mineResult.entity;
    const foundry = foundryResult.entity;
    const startX = sites.left - 3;
    const endX = sites.right + 4;
    const segmentCount = endX - startX + 1;
    const mineIndex = sites.left + 1 - startX;
    const foundryIndex = sites.right + 1 - startX;
    const segmentId = (index) => `live-main-${String(index).padStart(2, "0")}`;
    const segments = Array.from({ length: segmentCount }, (_, index) => ({
      id: segmentId(index),
      x: startX + index,
      y: sites.railY,
      kind: "straight",
      rotation: 1,
    }));
    const acceptedIron = simulation.receive(mine.id, "ironOre", 900);
    const acceptedCoal = simulation.receive(mine.id, "coal", 4);
    if (acceptedIron !== 900 || acceptedCoal !== 4) {
      throw new Error(
        `Live cargo source fill failed: iron=${acceptedIron}, coal=${acceptedCoal}.`,
      );
    }
    const configured = simulation.configureRailNetwork({
      network: {
        segments,
        stations: [
          {
            id: "live-mine",
            segmentId: segmentId(mineIndex),
            capacity: 0,
          },
          {
            id: "live-foundry",
            segmentId: segmentId(foundryIndex),
            capacity: 0,
          },
        ],
        trains: [
          {
            id: "live-ore-shuttle",
            currentSegmentId: segmentId(mineIndex),
            cars: [
              {
                id: "live-locomotive",
                kind: "locomotive",
                fuelCapacityMilli: 200_000,
                fuelMilli: 0,
              },
              {
                id: "live-wagon-a",
                kind: "cargo-wagon",
                capacity: 450,
              },
              {
                id: "live-wagon-b",
                kind: "cargo-wagon",
                capacity: 450,
              },
            ],
            schedule: [
              {
                stationId: "live-mine",
                wait: { type: "cargo-full" },
              },
              {
                stationId: "live-foundry",
                wait: { type: "cargo-empty" },
              },
            ],
          },
        ],
      },
      stationInterfaces: [
        {
          stationId: "live-mine",
          storageEntityId: mine.id,
          mode: "load",
          transferRate: 1,
          itemFilter: ["coal", "ironOre"],
        },
        {
          stationId: "live-foundry",
          storageEntityId: foundry.id,
          mode: "unload",
          transferRate: 1,
          itemFilter: ["ironOre"],
        },
      ],
    });
    if (!configured.ok) {
      throw new Error(`Live cargo configuration failed: ${configured.reason}`);
    }
    const fueled = simulation.fuelRailLocomotiveFromStorage(
      "live-mine",
      "live-ore-shuttle",
      "live-locomotive",
      4,
    );
    if (fueled !== 4) {
      throw new Error(`Live locomotive fueling failed: ${fueled}.`);
    }
    const camera = Object.freeze({
      focusX: startX + mineIndex - 2.1,
      focusZ: sites.railY - 1,
      viewWidth: 9.2,
    });
    world.focus(camera.focusX, camera.focusZ);
    world.viewWidth = camera.viewWidth;
    world.resize();

    const integration = world.getRailRendererIntegration();
    const renderer = integration.renderer;
    const cargoIsolationHiddenGroups = [];
    for (const [index, child] of [...world.entityRoot.children].entries()) {
      if (child === renderer.root) continue;
      child.removeFromParent();
      cargoIsolationHiddenGroups.push(
        `non-rail-entity-root-child-${index}:${child.name || "unnamed"}`,
      );
    }
    for (const [label, object] of [
      ["world-items", world.itemRoot],
      ["world-effects", world.effectsRoot],
      ["world-power-grid", world.powerGridRoot],
      ["world-overlays", world.overlayRoot],
    ]) {
      object.visible = false;
      cargoIsolationHiddenGroups.push(label);
    }
    const cargoDistrictPresentationHides = [
      "rail-station-lived-in-district-ground",
      "rail-station-lived-in-district-steel",
      "rail-station-lived-in-workshop-silos",
      "rail-station-lived-in-safety-markings",
      "rail-station-lived-in-crates-drums-and-tools",
      "rail-station-lived-in-trackside-weeds",
      "rail-station-lived-in-work-lamps",
      "rail-station-lived-in-warm-work-light",
    ];
    cargoIsolationHiddenGroups.push(
      "late-created-non-rail-entity-rigs",
      ...cargoDistrictPresentationHides,
    );
    const maintainCargoIsolation = () => {
      world.infrastructureRoot.visible = false;
      world.resourceRoot.visible = false;
      for (const child of [...world.entityRoot.children]) {
        if (child !== renderer.root) child.removeFromParent();
      }
      for (const name of cargoDistrictPresentationHides) {
        for (const districtObject of renderer.root.getObjectsByProperty(
          "name",
          name,
        )) {
          districtObject.visible = false;
        }
      }
    };
    const cargoPresentationIsolation = Object.freeze({
      mode: "loader-causality",
      presentationOnly: true,
      simulationMutation: false,
      applicationLoop: "unmodified requestAnimationFrame",
      retained: [
        "live authoritative rail station and both loader mechanisms",
        "live authoritative locomotive and receiving wagons",
        "authored track and ballast",
      ],
      hiddenGroups: Object.freeze([...cargoIsolationHiddenGroups]),
    });
    const measure = () => {
      maintainCargoIsolation();
      const snapshot = simulation.getRenderSnapshot();
      const station = [...renderer.stationRigs.values()].find(
        (candidate) => candidate.id === "live-mine" && candidate.serviceActive,
      );
      const chutes =
        station?.root
          .getObjectsByProperty("name", "rail-station-telescoping-load-chute")
          .map((chute) => ({
            heroLoader: chute.userData.heroLoader === true,
            serviceStage: chute.userData.serviceStage ?? null,
            extensionRatio: Number(chute.userData.extensionRatio ?? 0),
            hatchOpenRatio: Number(chute.userData.hatchOpenRatio ?? 0),
            contactRatio: Number(chute.userData.contactRatio ?? 0),
            payloadVisible: chute.userData.payloadVisible === true,
            payloadKind: chute.userData.payloadKind ?? null,
            visiblePayloadPieces: Number(
              chute.userData.visiblePayloadPieces ?? 0,
            ),
          })) ?? [];
      const cargoLoads = renderer.root
        .getObjectsByProperty("name", "rail-authoritative-wagon-cargo")
        .map((load) => ({
          visible: load.visible,
          stored: Number(load.userData.stored ?? 0),
          capacity: Number(load.userData.capacity ?? 0),
          fillRatio: Number(load.userData.fillRatio ?? 0),
          scaleY: load.scale.y,
        }));
      const train = snapshot.rail?.trains.find(
        (candidate) => candidate.id === "live-ore-shuttle",
      );
      return {
        tick: snapshot.tick,
        railTick: snapshot.rail?.tick ?? null,
        elapsedSeconds: snapshot.elapsedSeconds,
        visiblePausedText: document.body.innerText.includes("PAUSED"),
        camera,
        train: train
          ? {
              status: train.status,
              currentSegmentId: train.currentSegmentId,
              cargoUnits: train.cargoUnits,
              cargoCapacity: train.cargoCapacity,
              fuelMilli: train.fuelMilli,
            }
          : null,
        mineIron: simulation.getEntity(mine.id)?.inventory.ironOre ?? 0,
        foundryIron: simulation.getEntity(foundry.id)?.inventory.ironOre ?? 0,
        exactIronMass: simulation.stats().stored.ironOre,
        station: station
          ? {
              serviceMode: station.serviceMode,
              heroWagonIndex: station.heroWagonIndex,
              transferPhase: station.transferPhase,
            }
          : null,
        chutes,
        cargoLoads,
        presentationIsolation: {
          ...cargoPresentationIsolation,
          retained: [...cargoPresentationIsolation.retained],
          hiddenGroups: [...cargoPresentationIsolation.hiddenGroups],
        },
        debug: renderer.getDebug(),
      };
    };
    window.__RAIL_LIVE_CARGO_QA__ = {
      measure,
      renderer,
      integration,
      camera,
      maintainCargoIsolation,
      setupTick: simulation.tickCount,
    };
    return {
      setupTick: simulation.tickCount,
      camera,
      fueled,
      sourceIron: acceptedIron,
      presentationIsolation: {
        ...cargoPresentationIsolation,
        retained: [...cargoPresentationIsolation.retained],
        hiddenGroups: [...cargoPresentationIsolation.hiddenGroups],
      },
      executionMode:
        "ordinary application requestAnimationFrame loop; no tick override, pause, or manual step",
      automaticTickDisabled: false,
    };
  });

  await cargoPage.evaluate((deadlineOffset) => {
    const qa = window.__RAIL_LIVE_CARGO_QA__;
    const canvas = document.querySelector("#world");
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("Cargo WebGL canvas is unavailable.");
    }
    qa.cargoCapture = {
      done: false,
      error: null,
      frames: [],
      deadlineTick: qa.setupTick + deadlineOffset,
    };
    const sampleAfterRender = () => {
      qa.maintainCargoIsolation();
      const frame = qa.measure();
      const hero = frame.chutes.find((chute) => chute.heroLoader);
      const index = qa.cargoCapture.frames.length;
      const matches =
        index === 0
          ? frame.tick >= qa.setupTick + 90 &&
            frame.train?.status === "dwelling" &&
            hero?.serviceStage === "approach" &&
            hero.extensionRatio <= 0.035 &&
            frame.chutes.every((chute) => !chute.payloadVisible)
          : index === 1
            ? hero?.serviceStage === "contact" &&
              hero.extensionRatio >= 0.99 &&
              hero.hatchOpenRatio >= 0.99 &&
              hero.contactRatio >= 0.99
            : index === 2
              ? frame.train?.cargoUnits >
                  qa.cargoCapture.frames[1].frame.train.cargoUnits &&
                hero?.serviceStage === "transfer" &&
                hero.payloadVisible &&
                hero.payloadKind === "authoritative-cargo-stream" &&
                hero.visiblePayloadPieces >= 36
              : false;
      if (matches) {
        const imageDataUrl = canvas.toDataURL("image/png");
        if (!imageDataUrl.startsWith("data:image/png;base64,")) {
          qa.cargoCapture.error =
            "Live cargo canvas did not yield a PNG data URL.";
          return;
        }
        qa.cargoCapture.frames.push({ frame, imageDataUrl });
        if (qa.cargoCapture.frames.length === 3) {
          qa.cargoCapture.done = true;
          return;
        }
      }
      if (frame.tick >= qa.cargoCapture.deadlineTick) {
        qa.cargoCapture.error = `Live cargo capture missed state ${index + 1} before tick ${qa.cargoCapture.deadlineTick}; stage=${hero?.serviceStage}, extension=${hero?.extensionRatio}.`;
        return;
      }
      requestAnimationFrame(sampleAfterRender);
    };
    requestAnimationFrame(sampleAfterRender);
  }, 360);
  await cargoPage.waitForFunction(
    () => {
      const capture = window.__RAIL_LIVE_CARGO_QA__?.cargoCapture;
      return capture?.done || Boolean(capture?.error);
    },
    undefined,
    { timeout: 10_000 },
  );
  const cargoCaptureStatus = await cargoPage.evaluate(() => {
    const capture = window.__RAIL_LIVE_CARGO_QA__.cargoCapture;
    return {
      done: capture.done,
      error: capture.error,
      frameCount: capture.frames.length,
      deadlineTick: capture.deadlineTick,
    };
  });
  assert(
    cargoCaptureStatus.done &&
      !cargoCaptureStatus.error &&
      cargoCaptureStatus.frameCount === 3,
    cargoCaptureStatus.error ??
      `Live cargo capture produced ${cargoCaptureStatus.frameCount} frames.`,
  );
  const cargoFrames = [];
  for (let index = 0; index < 3; index += 1) {
    const captured = await cargoPage.evaluate((captureIndex) => {
      const capture =
        window.__RAIL_LIVE_CARGO_QA__.cargoCapture.frames[captureIndex];
      return capture ?? null;
    }, index);
    assert(captured, `Live cargo capture ${index + 1} is unavailable.`);
    const image = artifactName(
      [
        "visual-live-loader-before.png",
        "visual-live-loader-contact.png",
        "visual-live-loader-transfer.png",
      ][index],
    );
    const encodedPng = captured.imageDataUrl.split(",", 2)[1];
    assert(
      encodedPng && encodedPng.length > 100_000,
      `Live cargo capture ${index + 1} PNG payload is implausibly small.`,
    );
    await writeFile(
      `${OUTPUT_DIRECTORY}/${image}`,
      Buffer.from(encodedPng, "base64"),
    );
    cargoFrames.push(captured.frame);
  }
  const [cargoBefore, cargoContact, cargoTransfer] = cargoFrames;

  const campaignPage = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  auditPage(campaignPage, "campaign");
  await campaignPage.goto(
    `${BASE_URL.replace(/\/$/, "")}/?fresh=rail-pass12-live-campaign`,
    { waitUntil: "networkidle", timeout: 30_000 },
  );
  await waitForBoot(campaignPage);

  const campaignSetup = await campaignPage.evaluate(async () => {
    const game = window.__CINDERLINE__;
    if (!game) throw new Error("Campaign rail bridge is unavailable.");
    const simulation = game.simulation;
    const world = game.renderer;
    document.querySelector("#boot")?.remove();
    const hud = document.querySelector("#hud");
    game.dismissToasts();
    world.setSelected(null);
    const integration = world.getRailRendererIntegration();
    const renderer = integration.renderer;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      if (
        renderer.surfaceTexture?.image?.width > 0 &&
        renderer.ballastTexture?.image?.width > 0
      ) {
        break;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      if (attempt === 239) {
        throw new Error("Campaign rail textures did not load.");
      }
    }
    const cameras = Object.freeze({
      wide: Object.freeze({
        focusX: 18.8,
        focusZ: 15.8,
        viewWidth: 28.5,
      }),
      turnout: Object.freeze({
        focusX: 10.75,
        focusZ: 16.52,
        viewWidth: 5,
      }),
      branch: Object.freeze({
        focusX: 9.4,
        focusZ: 16.25,
        viewWidth: 11.1,
      }),
      consist: Object.freeze({
        focusX: 18.2,
        focusZ: 16.05,
        viewWidth: 8.2,
      }),
    });
    const setCamera = (camera) => {
      world.focus(camera.focusX, camera.focusZ);
      world.viewWidth = camera.viewWidth;
      world.resize();
    };
    const presentationIsolation = {
      active: false,
      mode: null,
      records: [],
      disclosure: null,
    };
    const setPresentationIsolation = (mode) => {
      if (presentationIsolation.active) {
        for (const record of presentationIsolation.records) {
          if (record.parent && !record.object.parent) {
            record.parent.add(record.object);
          }
          record.object.visible = record.visible;
        }
        presentationIsolation.active = false;
        presentationIsolation.mode = null;
        presentationIsolation.records = [];
        presentationIsolation.disclosure = null;
      }
      if (mode === null) return;

      const records = [];
      const hiddenLabels = [];
      const hide = (label, object) => {
        if (!object) return;
        records.push({ object, visible: object.visible });
        object.visible = false;
        hiddenLabels.push(label);
      };
      const detach = (label, object) => {
        if (!object?.parent) return;
        records.push({
          object,
          visible: object.visible,
          parent: object.parent,
        });
        object.removeFromParent();
        hiddenLabels.push(label);
      };
      const railRoot = renderer.root;
      const domHud = document.querySelector("#hud");
      if (domHud instanceof HTMLElement) {
        domHud.style.display = "none";
        hiddenLabels.push("dom-hud-after-ordinary-wide-capture");
      }
      for (const [index, child] of [...world.entityRoot.children].entries()) {
        if (child !== railRoot) {
          detach(
            `non-rail-entity-root-child-${index}:${child.name || "unnamed"}`,
            child,
          );
        }
      }
      hide("factory-infrastructure", world.infrastructureRoot);
      hide("world-resources", world.resourceRoot);
      hide("world-items", world.itemRoot);
      hide("world-effects", world.effectsRoot);
      hide("world-power-grid", world.powerGridRoot);
      hide("world-overlays", world.overlayRoot);
      hide(
        "rail-block-and-route-overlays",
        railRoot.getObjectByName("rail-block-and-route-overlays"),
      );
      hide(
        "rail-authoritative-signals",
        railRoot.getObjectByName("rail-authoritative-signals"),
      );
      hide(
        "rail-station-service-rigs",
        railRoot.getObjectByName("rail-station-service-rigs"),
      );
      if (mode === "turnout-macro") {
        hide(
          "rail-detailed-train-rigs",
          railRoot.getObjectByName("rail-detailed-train-rigs"),
        );
      }
      if (mode === "consist-mechanics") {
        const foregroundSpecialwork = [];
        railRoot.traverse((object) => {
          if (
            object.name.startsWith("rail-track-integrated-bypass-") ||
            object.name.startsWith(
              "rail-track-integrated-west-turnout-",
            ) ||
            object.name.startsWith(
              "rail-track-integrated-east-turnout-",
            )
          ) {
            foregroundSpecialwork.push(object);
          }
        });
        for (const object of foregroundSpecialwork) {
          hide(`consist-foreground:${object.name}`, object);
        }
      }
      presentationIsolation.active = true;
      presentationIsolation.mode = mode;
      presentationIsolation.records = records;
      presentationIsolation.disclosure = {
        mode,
        presentationOnly: true,
        simulationMutation: false,
        applicationLoop: "unmodified requestAnimationFrame",
        retained: [
          "authored rail running surfaces",
          "turnout blades, frog, check rails, and point motor",
          "turnout service apron, cable trough, cabinet, and switch lantern",
          ...(mode !== "turnout-macro"
            ? ["live authoritative three-car train"]
            : []),
        ],
        hiddenGroups: hiddenLabels,
      };
    };
    const measure = () => {
      renderer.root.updateMatrixWorld(true);
      const snapshot = simulation.getRenderSnapshot();
      const west = renderer.root.getObjectByName(
        "rail-track-integrated-west-turnout-running-surfaces",
      );
      const siding = renderer.root.getObjectByName(
        "rail-track-integrated-bypass-running-surfaces",
      );
      const trainRoot = renderer.root.getObjectByName("rail-train-rig");
      const carRoots =
        trainRoot?.children.filter(
          (child) =>
            child.name === "rail-locomotive-car" ||
            child.name === "rail-cargo-wagon-car",
        ) ?? [];
      const worldPoint = (object) =>
        object
          ? [
              object.matrixWorld.elements[12],
              object.matrixWorld.elements[13],
              object.matrixWorld.elements[14],
            ]
          : null;
      const distanceBetween = (left, right) =>
        left && right
          ? Math.hypot(
              left[0] - right[0],
              left[1] - right[1],
              left[2] - right[2],
            )
          : null;
      const adjacentCouplerPairs = carRoots.slice(1).map((trailing, index) => {
        const leading = carRoots[index];
        const leadingRearCenter = worldPoint(
          leading?.getObjectByName("rail-rear-coupler"),
        );
        const trailingFrontCenter = worldPoint(
          trailing.getObjectByName("rail-front-coupler"),
        );
        const leadingRearFace = worldPoint(
          leading?.getObjectByName("rail-rear-coupler-knuckle-face"),
        );
        const trailingFrontFace = worldPoint(
          trailing.getObjectByName("rail-front-coupler-knuckle-face"),
        );
        return {
          pairIndex: index,
          leadingCarIndex: index,
          leadingCarId: leading?.userData.carId ?? null,
          trailingCarIndex: index + 1,
          trailingCarId: trailing.userData.carId ?? null,
          leadingRearCenter,
          trailingFrontCenter,
          leadingRearFace,
          trailingFrontFace,
          centerGap: distanceBetween(
            leadingRearCenter,
            trailingFrontCenter,
          ),
          faceGap: distanceBetween(leadingRearFace, trailingFrontFace),
        };
      });
      const wheelRailMeasurements = carRoots.flatMap((car, carIndex) =>
        car
          .getObjectsByProperty("name", "rail-flanged-wheel")
          .map((wheel, wheelIndex) => {
            const wheelCenter = worldPoint(wheel);
            const railCentre = Array.isArray(
              wheel.userData.expectedRailCentreWorld,
            )
              ? [...wheel.userData.expectedRailCentreWorld]
              : null;
            const railTangentYaw = Number(
              wheel.userData.expectedRailTangentYaw,
            );
            const intendedLateralOffset = Number(
              wheel.userData.intendedRailOffset,
            );
            const valid =
              wheelCenter &&
              railCentre?.length === 3 &&
              Number.isFinite(railTangentYaw) &&
              Number.isFinite(intendedLateralOffset);
            const lateralX = valid ? Math.sin(railTangentYaw) : null;
            const lateralZ = valid ? Math.cos(railTangentYaw) : null;
            const measuredLateralOffset = valid
              ? (wheelCenter[0] - railCentre[0]) * lateralX +
                (wheelCenter[2] - railCentre[2]) * lateralZ
              : null;
            const longitudinalSampleOffset = valid
              ? (wheelCenter[0] - railCentre[0]) *
                  Math.cos(railTangentYaw) -
                (wheelCenter[2] - railCentre[2]) *
                  Math.sin(railTangentYaw)
              : null;
            const lateralGaugeError = valid
              ? Math.abs(
                  measuredLateralOffset - intendedLateralOffset,
                )
              : null;
            const intendedTreadWorld = valid
              ? [
                  railCentre[0] + lateralX * intendedLateralOffset,
                  wheelCenter[1],
                  railCentre[2] + lateralZ * intendedLateralOffset,
                ]
              : null;
            return {
              carIndex,
              carId: car.userData.carId ?? null,
              wheelIndex,
              wheelCenter,
              railCentre,
              railTangentYaw: valid ? railTangentYaw : null,
              intendedLateralOffset: valid
                ? intendedLateralOffset
                : null,
              measuredLateralOffset,
              longitudinalSampleOffset,
              lateralGaugeError,
              intendedTreadWorld,
              wheelToIntendedRailError: lateralGaugeError,
              centrelineSource: wheel.userData.railCentreSource ?? null,
            };
          }),
      );
      const wheelGaugeError = Math.max(
        ...wheelRailMeasurements.map(
          ({ lateralGaugeError }) => lateralGaugeError ?? Number.POSITIVE_INFINITY,
        ),
      );
      const wheelToIntendedRailError = Math.max(
        ...wheelRailMeasurements.map(
          ({ wheelToIntendedRailError: error }) =>
            error ?? Number.POSITIVE_INFINITY,
        ),
      );
      const wheels = wheelRailMeasurements;
      const bounds = (object) => {
        const box = object?.geometry?.boundingBox;
        return box
          ? {
              min: [box.min.x, box.min.y, box.min.z],
              max: [box.max.x, box.max.y, box.max.z],
            }
          : null;
      };
      const train = snapshot.rail?.trains.find(
        (candidate) => candidate.id === "campaign-ore-runner",
      );
      const cars = carRoots.map((car) => ({
        name: car.name,
        position: worldPoint(car),
        yaw: car.rotation.y + (trainRoot?.rotation.y ?? 0),
      }));
      const bogies = renderer.root
        .getObjectsByProperty("name", "rail-articulated-bogie-rig")
        .map((bogie) => ({
          tangentYaw: Number(bogie.userData.tangentYaw ?? 0),
          worldYaw: Number(bogie.userData.worldYaw ?? 0),
          position: worldPoint(bogie),
        }));
      const hudElement = document.querySelector("#hud");
      const hudRect =
        hudElement instanceof HTMLElement
          ? hudElement.getBoundingClientRect()
          : null;
      const hudStyle =
        hudElement instanceof HTMLElement
          ? window.getComputedStyle(hudElement)
          : null;
      const hudVisible =
        Boolean(hudRect && hudRect.width > 0 && hudRect.height > 0) &&
        hudStyle?.display !== "none" &&
        hudStyle?.visibility !== "hidden" &&
        Number(hudStyle?.opacity ?? 1) > 0;
      const visibleToastText = Array.from(
        document.querySelectorAll("[data-toast-id]"),
      )
        .filter((toast) => {
          if (!(toast instanceof HTMLElement)) return false;
          const rect = toast.getBoundingClientRect();
          const style = window.getComputedStyle(toast);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || 1) > 0.02
          );
        })
        .map((toast) => (toast.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" | ");
      return {
        tick: snapshot.tick,
        railTick: snapshot.rail?.tick ?? null,
        elapsedSeconds: snapshot.elapsedSeconds,
        visiblePausedText: document.body.innerText.includes("PAUSED"),
        visibleToastText,
        hud: {
          visible: hudVisible,
          bounds: hudRect
            ? [
                hudRect.x,
                hudRect.y,
                hudRect.width,
                hudRect.height,
              ]
            : null,
          text:
            hudElement instanceof HTMLElement
              ? (hudElement.innerText ?? "").replace(/\s+/g, " ").trim()
              : "",
        },
        train: train
          ? {
              status: train.status,
              currentSegmentId: train.currentSegmentId,
              speedMilliPerTick: train.speedMilliPerTick,
              progressMilli: train.progressMilli,
              distanceTravelledMilli: train.distanceTravelledMilli,
              scheduleIndex: train.scheduleIndex,
              destinationStationId: train.destinationStationId,
              path: [...train.path],
            }
          : null,
        locomotivePosition: worldPoint(trainRoot),
        locomotiveYaw: trainRoot?.rotation.y ?? null,
        cars,
        bogies,
        turnout: {
          count: west?.count ?? 0,
          contract: west?.userData.engineeredGeometry ?? null,
          bounds: bounds(west),
          sidingBounds: bounds(siding),
          hardware: {
            bladesAndFrog: Boolean(
              renderer.root.getObjectByName(
                "rail-track-integrated-west-turnout-blades-frog-check-rails",
              ),
            ),
            pointMotor: Boolean(
              renderer.root.getObjectByName(
                "rail-track-integrated-west-turnout-point-motor",
              ),
            ),
            highContrastMechanicalLinkage: Boolean(
              renderer.root.getObjectByName(
                "rail-track-integrated-west-turnout-mechanical-linkage-and-slide-plates",
              ),
            ),
            tracksideServiceContext: [
              "drained-service-apron",
              "segmented-cable-trough",
              "cable-trough-lid-fasteners",
              "cable-trough-oxide-grime",
              "weatherproof-service-cabinet",
              "switch-lantern-and-post",
            ].every((suffix) =>
              Boolean(
                renderer.root.getObjectByName(
                  `rail-track-integrated-west-turnout-${suffix}`,
                ),
              ),
            ),
          },
        },
        mechanics: {
          wheelRailMeasurements,
          railCenters: [-0.19, 0.19],
          wheelGaugeError,
          wheelToIntendedRailError,
          wheelGaugeMetric:
            "actual wheel centre versus the intended rail line through an independent authoritative rendered-centreline sample, resolved in that sample's local tangent/lateral frame",
          adjacentCouplerPairs,
          couplerCenterGap: adjacentCouplerPairs[0]?.centerGap ?? null,
          couplerFaceGap: adjacentCouplerPairs[0]?.faceGap ?? null,
          carCount: carRoots.length,
          bogieCount: bogies.length,
          axleCount: renderer.root.getObjectsByProperty(
            "name",
            "rail-bogie-through-axle",
          ).length,
          wheelCount: wheelRailMeasurements.length,
          flangeCount: renderer.root.getObjectsByProperty(
            "name",
            "rail-wheel-inner-flange-ring",
          ).length,
          freightForms: {
            coveredHopperRoofShoulders: renderer.root.getObjectsByProperty(
              "name",
              "rail-covered-ore-hopper-roof-shoulders",
            ).length,
            openGondolaCrossTies: renderer.root.getObjectsByProperty(
              "name",
              "rail-open-ore-gondola-cross-ties",
            ).length,
            openGondolaCenterDischargeSpine:
              renderer.root.getObjectsByProperty(
                "name",
                "rail-open-ore-gondola-center-discharge-spine",
              ).length,
            openGondolaBedResidueNotCargo:
              renderer.root.getObjectsByProperty(
                "name",
                "rail-open-gondola-low-irregular-ochre-bed-residue-not-cargo",
              ).length,
            openGondolaBrakeStand: renderer.root.getObjectsByProperty(
              "name",
              "rail-open-gondola-deck-brake-stand-and-wheel",
            ).length,
            visibleDraftSills: renderer.root.getObjectsByProperty(
              "name",
              "rail-cargo-wagon-visible-draft-sill-and-end-platform",
            ).length,
            rimRivetsAndTieBolts: renderer.root.getObjectsByProperty(
              "name",
              "rail-cargo-wagon-rim-rivets-and-tie-bolts",
            ).length,
          },
          serviceHatchOpenRatios: renderer.root
            .getObjectsByProperty(
              "name",
              "rail-cargo-wagon-sliding-service-hatch",
            )
            .map((hatch) => Number(hatch.userData.openRatio ?? 0)),
          metadata: trainRoot?.userData ?? null,
        },
        presentationIsolation: presentationIsolation.disclosure
          ? {
              ...presentationIsolation.disclosure,
              hiddenGroups: [...presentationIsolation.disclosure.hiddenGroups],
            }
          : null,
        debug: renderer.getDebug(),
      };
    };
    const validateWheelGaugeDiagnostic = () => {
      const wheel = renderer.root.getObjectByName("rail-flanged-wheel");
      if (!wheel) {
        throw new Error("Wheel-gauge diagnostic calibration has no wheel.");
      }
      const baseline = measure().mechanics.wheelGaugeError;
      const originalZ = wheel.position.z;
      wheel.position.z += 0.05;
      renderer.root.updateMatrixWorld(true);
      const displaced = measure().mechanics.wheelGaugeError;
      wheel.position.z = originalZ;
      renderer.root.updateMatrixWorld(true);
      const restored = measure().mechanics.wheelGaugeError;
      return {
        method:
          "presentation-only 0.05 local-Z wheel displacement with independent rail-centre target held fixed",
        expectedDisplacement: 0.05,
        baseline,
        displaced,
        restored,
        detectedDelta: displaced - baseline,
      };
    };
    const wheelGaugeDiagnosticCalibration = validateWheelGaugeDiagnostic();
    window.__RAIL_LIVE_CAMPAIGN_QA__ = {
      simulation,
      world,
      renderer,
      integration,
      cameras,
      setCamera,
      setPresentationIsolation,
      measure,
      setupTick: simulation.tickCount,
    };
    setCamera(cameras.wide);
    return {
      setupTick: simulation.tickCount,
      wheelGaugeDiagnosticCalibration,
      viewport: [window.innerWidth, window.innerHeight],
      cameras,
      executionMode:
        "ordinary application requestAnimationFrame loop; no tick override, pause, or manual step",
      automaticTickDisabled: false,
    };
  });

  await settleLiveFrames(campaignPage);
  await campaignPage.evaluate(() => window.__CINDERLINE__?.dismissToasts());
  await campaignPage.waitForFunction(
    () => document.querySelectorAll("[data-toast-id]").length === 0,
    undefined,
    { timeout: 2_000 },
  );
  const campaignWide = await campaignPage.evaluate(() =>
    window.__RAIL_LIVE_CAMPAIGN_QA__.measure(),
  );
  await campaignPage.screenshot({
    path: `${OUTPUT_DIRECTORY}/${artifactName(
      "visual-live-campaign-wide.png",
    )}`,
  });

  await campaignPage.evaluate(() => {
    const qa = window.__RAIL_LIVE_CAMPAIGN_QA__;
    qa.setPresentationIsolation("turnout-macro");
    qa.setCamera(qa.cameras.turnout);
  });
  await settleLiveFrames(campaignPage);
  const turnoutMacro = await campaignPage.evaluate(() =>
    window.__RAIL_LIVE_CAMPAIGN_QA__.measure(),
  );
  await campaignPage.locator("#world").screenshot({
    path: `${OUTPUT_DIRECTORY}/${artifactName(
      "visual-live-campaign-west-turnout-macro.png",
    )}`,
  });

  await campaignPage.evaluate(() => {
    const qa = window.__RAIL_LIVE_CAMPAIGN_QA__;
    qa.setPresentationIsolation("consist-mechanics");
    qa.setCamera(qa.cameras.consist);
  });
  const capturedConsist = await campaignPage.evaluate(
    () =>
      new Promise((resolveCapture, rejectCapture) => {
        const qa = window.__RAIL_LIVE_CAMPAIGN_QA__;
        const canvas = document.querySelector("#world");
        if (!(canvas instanceof HTMLCanvasElement)) {
          rejectCapture(new Error("Campaign WebGL canvas is unavailable."));
          return;
        }
        const deadlineTick = qa.setupTick + 360;
        const sampleAfterRender = () => {
          const frame = qa.measure();
          const hatches = frame.mechanics.serviceHatchOpenRatios;
          if (
            frame.tick > qa.setupTick &&
            hatches.length === 4 &&
            hatches.every((ratio) => ratio <= 0.001)
          ) {
            resolveCapture({
              frame,
              imageDataUrl: canvas.toDataURL("image/png"),
              captureMechanism:
                "same-page canvas snapshot sampled after an ordinary requestAnimationFrame render",
            });
            return;
          }
          if (frame.tick >= deadlineTick) {
            rejectCapture(
              new Error(
                `Consist hatches never reached their live closed state before tick ${deadlineTick}: ${JSON.stringify(hatches)}.`,
              ),
            );
            return;
          }
          requestAnimationFrame(sampleAfterRender);
        };
        requestAnimationFrame(sampleAfterRender);
      }),
  );
  const consistClose = capturedConsist.frame;
  const consistPng = capturedConsist.imageDataUrl.split(",", 2)[1];
  assert(
    consistPng && consistPng.length > 100_000,
    "Live consist PNG payload is implausibly small.",
  );
  await writeFile(
    `${OUTPUT_DIRECTORY}/${artifactName(
      "visual-live-campaign-consist-close.png",
    )}`,
    Buffer.from(consistPng, "base64"),
  );
  const consistCaptureStatus = {
    captureMechanism: capturedConsist.captureMechanism,
    tick: consistClose.tick,
    closedServiceHatches: consistClose.mechanics.serviceHatchOpenRatios.every(
      (ratio) => ratio <= 0.001,
    ),
  };

  const branchSetup = await campaignPage.evaluate(() => {
    const qa = window.__RAIL_LIVE_CAMPAIGN_QA__;
    const { simulation, renderer } = qa;
    const snapshot = simulation.railSnapshot();
    if (!snapshot) throw new Error("Campaign rail network disappeared.");
    const stations = snapshot.stations.map((station) => ({
      id: station.id,
      segmentId: station.segmentId,
      capacity: station.capacity,
      inventory: station.inventory.map((stack) => ({ ...stack })),
    }));
    const replaced = simulation.replaceRailStations([
      ...stations,
      {
        id: "campaign-live-west-origin",
        segmentId: "campaign-main-08",
        capacity: 0,
      },
      {
        id: "campaign-live-branch-destination",
        segmentId: "campaign-siding-17",
        capacity: 0,
      },
    ]);
    if (!replaced.ok) {
      throw new Error(
        `Campaign live station mutation failed: ${replaced.reason}`,
      );
    }
    const scheduled = simulation.setRailTrainSchedule("campaign-ore-runner", [
      {
        stationId: "campaign-live-west-origin",
        wait: { type: "time", ticks: 1 },
      },
      {
        stationId: "campaign-live-branch-destination",
        wait: { type: "time", ticks: 600 },
      },
    ]);
    if (!scheduled.ok) {
      throw new Error(
        `Campaign live branch schedule failed: ${scheduled.reason}`,
      );
    }
    qa.setPresentationIsolation("branch-motion");
    qa.setCamera(qa.cameras.branch);
    const hideAuditStations = () => {
      for (const station of renderer.stationRigs.values()) {
        if (station.id.startsWith("campaign-live-")) {
          station.root.visible = false;
        }
      }
    };
    qa.hideAuditStations = hideAuditStations;
    hideAuditStations();
    return {
      tick: simulation.tickCount,
      automaticTickDisabled: false,
      route:
        "campaign-main-08 east through actual campaign west turnout to campaign-siding-17",
      fixedCamera: qa.cameras.branch,
      auditScheduleStationRootsHiddenForTrackClearance: true,
      presentationIsolation:
        "track + live train retained; unrelated factory, signals, station actors, items, effects, power, and overlays hidden; simulation remains live",
      captureMechanism:
        "same-page canvas snapshots sampled after ordinary requestAnimationFrame renders; no pause or manual simulation step",
    };
  });

  const motionTargets = [
    ["campaign-main-10"],
    ["campaign-main-12"],
    ["campaign-siding-west-curve", "campaign-siding-14"],
  ];
  await campaignPage.evaluate(
    ({ targets, earliestTick, deadlineTick }) => {
      const qa = window.__RAIL_LIVE_CAMPAIGN_QA__;
      const canvas = document.querySelector("#world");
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("Campaign WebGL canvas is unavailable.");
      }
      qa.branchCapture = {
        done: false,
        error: null,
        frames: [],
        deadlineTick,
      };
      const sampleAfterRender = () => {
        qa.hideAuditStations();
        const frame = qa.measure();
        const index = qa.branchCapture.frames.length;
        const targetSegments = targets[index];
        if (
          targetSegments &&
          frame.tick > earliestTick &&
          frame.train?.status === "moving" &&
          frame.train.speedMilliPerTick > 0 &&
          frame.train.destinationStationId ===
            "campaign-live-branch-destination" &&
          targetSegments.includes(frame.train.currentSegmentId) &&
          (frame.train.path.includes("campaign-siding-west-curve") ||
            frame.train.currentSegmentId.startsWith("campaign-siding-"))
        ) {
          const imageDataUrl = canvas.toDataURL("image/png");
          if (!imageDataUrl.startsWith("data:image/png;base64,")) {
            qa.branchCapture.error =
              "Live canvas did not yield a PNG data URL.";
            return;
          }
          qa.branchCapture.frames.push({
            frame: {
              ...frame,
              camera: qa.cameras.branch,
            },
            imageDataUrl,
          });
          if (qa.branchCapture.frames.length === targets.length) {
            qa.branchCapture.done = true;
            return;
          }
        }
        if (frame.tick >= deadlineTick) {
          qa.branchCapture.error = `Outbound live capture missed target ${index + 1} before tick ${deadlineTick}; current destination=${frame.train?.destinationStationId}, segment=${frame.train?.currentSegmentId}.`;
          return;
        }
        requestAnimationFrame(sampleAfterRender);
      };
      requestAnimationFrame(sampleAfterRender);
    },
    {
      targets: motionTargets,
      earliestTick: branchSetup.tick,
      deadlineTick: branchSetup.tick + 320,
    },
  );
  await campaignPage.waitForFunction(
    () => {
      const capture = window.__RAIL_LIVE_CAMPAIGN_QA__?.branchCapture;
      return capture?.done || Boolean(capture?.error);
    },
    undefined,
    { timeout: 30_000 },
  );
  const branchCaptureStatus = await campaignPage.evaluate(() => {
    const capture = window.__RAIL_LIVE_CAMPAIGN_QA__.branchCapture;
    return {
      done: capture.done,
      error: capture.error,
      frameCount: capture.frames.length,
      deadlineTick: capture.deadlineTick,
    };
  });
  assert(
    branchCaptureStatus.done &&
      !branchCaptureStatus.error &&
      branchCaptureStatus.frameCount === motionTargets.length,
    branchCaptureStatus.error ??
      `Live branch capture produced ${branchCaptureStatus.frameCount} frames.`,
  );
  const branchMotion = [];
  for (let index = 0; index < motionTargets.length; index += 1) {
    const captured = await campaignPage.evaluate((captureIndex) => {
      const capture =
        window.__RAIL_LIVE_CAMPAIGN_QA__.branchCapture.frames[captureIndex];
      return capture ?? null;
    }, index);
    assert(captured, `Live branch capture ${index + 1} is unavailable.`);
    const image = artifactName(
      `visual-live-campaign-branch-${String(index + 1).padStart(2, "0")}.png`,
    );
    const encodedPng = captured.imageDataUrl.split(",", 2)[1];
    assert(
      encodedPng && encodedPng.length > 100_000,
      `Live branch capture ${index + 1} PNG payload is implausibly small.`,
    );
    await writeFile(
      `${OUTPUT_DIRECTORY}/${image}`,
      Buffer.from(encodedPng, "base64"),
    );
    branchMotion.push({ ...captured.frame, image });
  }

  const cargoHero = (frame) => frame.chutes.find((chute) => chute.heroLoader);
  const cargoDormant = (frame) =>
    frame.chutes.filter((chute) => !chute.heroLoader);
  assert(
    cargoSetup.automaticTickDisabled === false &&
      cargoSetup.executionMode.includes("ordinary application") &&
      cargoBefore.tick > cargoSetup.setupTick &&
      cargoContact.tick > cargoBefore.tick &&
      cargoTransfer.tick > cargoContact.tick &&
      cargoBefore.tick === cargoBefore.railTick &&
      cargoContact.tick === cargoContact.railTick &&
      cargoTransfer.tick === cargoTransfer.railTick,
    "Cargo evidence did not advance naturally through authoritative live ticks.",
  );
  assert(
    cargoSetup.presentationIsolation?.mode === "loader-causality" &&
      cargoSetup.presentationIsolation.presentationOnly === true &&
      cargoSetup.presentationIsolation.simulationMutation === false &&
      [cargoBefore, cargoContact, cargoTransfer].every(
        (frame) =>
          frame.presentationIsolation?.mode === "loader-causality" &&
          frame.presentationIsolation.presentationOnly === true &&
          frame.presentationIsolation.simulationMutation === false,
      ),
    "Cargo evidence lacks an explicit presentation-only isolation disclosure.",
  );
  assert(
    !cargoBefore.visiblePausedText &&
      !cargoContact.visiblePausedText &&
      !cargoTransfer.visiblePausedText &&
      JSON.stringify(cargoBefore.camera) ===
        JSON.stringify(cargoContact.camera) &&
      JSON.stringify(cargoBefore.camera) ===
        JSON.stringify(cargoTransfer.camera),
    "Cargo evidence changed camera or exposed a paused state.",
  );
  assert(
    cargoHero(cargoBefore)?.serviceStage === "approach" &&
      cargoHero(cargoBefore)?.extensionRatio <= 0.035 &&
      cargoHero(cargoContact)?.serviceStage === "contact" &&
      cargoHero(cargoContact)?.extensionRatio >= 0.99 &&
      cargoHero(cargoContact)?.hatchOpenRatio >= 0.99 &&
      cargoHero(cargoContact)?.contactRatio >= 0.99 &&
      cargoHero(cargoTransfer)?.serviceStage === "transfer" &&
      cargoHero(cargoTransfer)?.payloadKind === "authoritative-cargo-stream" &&
      cargoHero(cargoTransfer)?.visiblePayloadPieces >= 36 &&
      cargoTransfer.chutes.filter((chute) => chute.payloadVisible).length ===
        1 &&
      cargoDormant(cargoBefore).every(
        (chute) =>
          chute.extensionRatio === 0 &&
          chute.hatchOpenRatio === 0 &&
          !chute.payloadVisible,
      ) &&
      cargoDormant(cargoContact).every(
        (chute) =>
          chute.extensionRatio === 0 &&
          chute.hatchOpenRatio === 0 &&
          !chute.payloadVisible,
      ) &&
      cargoDormant(cargoTransfer).every(
        (chute) =>
          chute.extensionRatio === 0 &&
          chute.hatchOpenRatio === 0 &&
          !chute.payloadVisible,
      ),
    `Live loader sequence lacks full travel, one 36-piece cargo cascade, or a dormant second loader: ${JSON.stringify(
      {
        before: cargoBefore.chutes,
        contact: cargoContact.chutes,
        transfer: cargoTransfer.chutes,
      },
    )}`,
  );
  assert(
    cargoTransfer.train.cargoUnits > cargoContact.train.cargoUnits &&
      cargoTransfer.mineIron < cargoContact.mineIron &&
      cargoBefore.exactIronMass === 900 &&
      cargoContact.exactIronMass === 900 &&
      cargoTransfer.exactIronMass === 900 &&
      cargoTransfer.cargoLoads.some(
        ({ visible, stored, fillRatio, scaleY }) =>
          visible && stored > 0 && fillRatio > 0 && scaleY > 0.38,
      ),
    "Live cargo frame lacks an authoritative inventory/wagon/fill delta with exact mass.",
  );

  assert(
    campaignSetup.automaticTickDisabled === false &&
      campaignSetup.viewport[0] === 1920 &&
      campaignSetup.viewport[1] === 1080 &&
      turnoutMacro.tick > campaignSetup.setupTick &&
      turnoutMacro.tick === turnoutMacro.railTick &&
      campaignWide.hud.visible === true &&
      campaignWide.hud.text.length > 20 &&
      campaignWide.visibleToastText === "" &&
      campaignWide.presentationIsolation === null &&
      !campaignWide.visiblePausedText &&
      !turnoutMacro.visiblePausedText &&
      !consistClose.visiblePausedText,
    "Campaign proof was not captured live, unpaused, and at 1920×1080.",
  );
  assert(
    turnoutMacro.turnout.count === 1 &&
      turnoutMacro.turnout.contract.tangentRun >= 8 &&
      turnoutMacro.turnout.contract.minimumEquivalentRadius >= 5 &&
      turnoutMacro.turnout.contract.entranceTangent === 0 &&
      turnoutMacro.turnout.contract.exitTangent === 0 &&
      turnoutMacro.turnout.bounds.max[0] - turnoutMacro.turnout.bounds.min[0] >
        7.9 &&
      turnoutMacro.turnout.hardware.bladesAndFrog &&
      turnoutMacro.turnout.hardware.pointMotor &&
      turnoutMacro.turnout.hardware.highContrastMechanicalLinkage &&
      turnoutMacro.turnout.hardware.tracksideServiceContext &&
      turnoutMacro.presentationIsolation?.mode === "turnout-macro" &&
      turnoutMacro.presentationIsolation.presentationOnly === true &&
      turnoutMacro.presentationIsolation.simulationMutation === false &&
      turnoutMacro.presentationIsolation.hiddenGroups.includes(
        "rail-detailed-train-rigs",
      ) &&
      turnoutMacro.presentationIsolation.hiddenGroups.includes(
        "rail-authoritative-signals",
      ) &&
      turnoutMacro.presentationIsolation.hiddenGroups.includes(
        "rail-station-service-rigs",
      ),
    "Actual campaign west turnout lacks the measured 8-unit shallow lead, radius, tangencies, or specialwork.",
  );
  assert(
    campaignSetup.wheelGaugeDiagnosticCalibration.baseline <= 0.01 &&
      campaignSetup.wheelGaugeDiagnosticCalibration.displaced >= 0.04 &&
      campaignSetup.wheelGaugeDiagnosticCalibration.detectedDelta >= 0.035 &&
      campaignSetup.wheelGaugeDiagnosticCalibration.restored <= 0.01,
    `Wheel-gauge diagnostic is not independently sensitive to displacement: ${JSON.stringify(
      campaignSetup.wheelGaugeDiagnosticCalibration,
    )}`,
  );
  const hasPhysicalWheelAndCouplerProof = (frame) =>
    frame.mechanics.wheelRailMeasurements.length === 24 &&
    frame.mechanics.wheelRailMeasurements.every(
      (wheel) =>
        wheel.centrelineSource ===
          "authoritative-rendered-centreline-history-sample" &&
        wheel.lateralGaugeError <= 0.01 &&
        wheel.wheelToIntendedRailError <= 0.01,
    ) &&
    frame.mechanics.wheelGaugeError <= 0.01 &&
    frame.mechanics.wheelToIntendedRailError <= 0.01 &&
    frame.mechanics.adjacentCouplerPairs.length === 2 &&
    frame.mechanics.adjacentCouplerPairs.every(
      (pair) =>
        pair.centerGap > 0.3 &&
        pair.faceGap >= 0.02 &&
        pair.faceGap <= 0.06,
    );
  assert(
    hasPhysicalWheelAndCouplerProof(consistClose) &&
      consistClose.mechanics.carCount === 3 &&
      consistClose.mechanics.bogieCount === 6 &&
      consistClose.mechanics.axleCount === 12 &&
      consistClose.mechanics.wheelCount === 24 &&
      consistClose.mechanics.flangeCount === 24 &&
      consistClose.mechanics.freightForms.coveredHopperRoofShoulders === 1 &&
      consistClose.mechanics.freightForms.openGondolaCrossTies === 1 &&
      consistClose.mechanics.freightForms.openGondolaCenterDischargeSpine ===
        1 &&
      consistClose.mechanics.freightForms.openGondolaBedResidueNotCargo ===
        1 &&
      consistClose.mechanics.freightForms.openGondolaBrakeStand === 1 &&
      consistClose.mechanics.freightForms.visibleDraftSills === 2 &&
      consistClose.mechanics.freightForms.rimRivetsAndTieBolts === 2 &&
      consistClose.mechanics.metadata.bogieArticulationModel ===
        "distance-sampled-independent-bogie-tangent" &&
      consistClose.mechanics.serviceHatchOpenRatios.length === 4 &&
      consistClose.mechanics.serviceHatchOpenRatios.every(
        (ratio) => ratio <= 0.001,
      ) &&
      consistClose.presentationIsolation?.mode === "consist-mechanics" &&
      consistClose.presentationIsolation.presentationOnly === true &&
      consistClose.presentationIsolation.simulationMutation === false &&
      consistClose.presentationIsolation.hiddenGroups.some((label) =>
        label.includes("rail-track-integrated-bypass-"),
      ),
    "Campaign consist violates tread, draft-gear, bogie, axle, flange, or articulation gates.",
  );
  assert(
    branchSetup.automaticTickDisabled === false &&
      branchMotion.length === 3 &&
      branchMotion.every(
        (frame, index) =>
          frame.tick === frame.railTick &&
          frame.train.status === "moving" &&
          frame.train.speedMilliPerTick > 0 &&
          frame.train.destinationStationId ===
            "campaign-live-branch-destination" &&
          frame.presentationIsolation?.mode === "branch-motion" &&
          frame.presentationIsolation.presentationOnly === true &&
          frame.presentationIsolation.simulationMutation === false &&
          !frame.visiblePausedText &&
          JSON.stringify(frame.camera) ===
            JSON.stringify(branchSetup.fixedCamera) &&
          (index === 0 || frame.tick > branchMotion[index - 1].tick),
      ) &&
      branchMotion.at(-1).tick - branchMotion[0].tick < 100,
    "Branch triptych is not a fixed-camera sequence of increasing live authoritative ticks.",
  );
  assert(
    branchMotion.every(hasPhysicalWheelAndCouplerProof),
    `Curved branch frames violate independently measured wheel-to-rail or adjacent coupler bounds: ${JSON.stringify(
      branchMotion.map(({ tick, mechanics }) => ({
        tick,
        wheelGaugeError: mechanics.wheelGaugeError,
        wheelToIntendedRailError: mechanics.wheelToIntendedRailError,
        adjacentCouplerPairs: mechanics.adjacentCouplerPairs.map(
          ({ pairIndex, faceGap, centerGap }) => ({
            pairIndex,
            faceGap,
            centerGap,
          }),
        ),
      })),
    )}`,
  );
  const motionDistance = Math.hypot(
    branchMotion.at(-1).locomotivePosition[0] -
      branchMotion[0].locomotivePosition[0],
    branchMotion.at(-1).locomotivePosition[2] -
      branchMotion[0].locomotivePosition[2],
  );
  const angularDistance = (a, b) =>
    Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const locomotiveYawDelta = angularDistance(
    branchMotion.at(-1).locomotiveYaw,
    branchMotion[0].locomotiveYaw,
  );
  const bogieYawRange = Math.max(
    ...branchMotion.flatMap((frame) =>
      frame.bogies.map(({ tangentYaw }) => Math.abs(tangentYaw)),
    ),
  );
  const carYawSamples = branchMotion.flatMap((frame) =>
    frame.cars.map(({ yaw }) => yaw),
  );
  const carYawRange = Math.max(
    ...carYawSamples.flatMap((yaw, index) =>
      carYawSamples
        .slice(index + 1)
        .map((otherYaw) => angularDistance(yaw, otherYaw)),
    ),
  );
  const adjacentCarSpacings = branchMotion.flatMap((frame) =>
    frame.cars.slice(1).map((car, index) => {
      const preceding = frame.cars[index];
      return Math.hypot(
        car.position[0] - preceding.position[0],
        car.position[1] - preceding.position[1],
        car.position[2] - preceding.position[2],
      );
    }),
  );
  const adjacentCarYawDeltas = branchMotion.flatMap((frame) =>
    frame.cars
      .slice(1)
      .map((car, index) => angularDistance(car.yaw, frame.cars[index].yaw)),
  );
  assert(
    motionDistance > 2 &&
      locomotiveYawDelta > 0.05 &&
      bogieYawRange > 0.005 &&
      carYawRange > 0.04 &&
      Math.min(...adjacentCarSpacings) > 2.35 &&
      Math.max(...adjacentCarSpacings) < 2.62 &&
      Math.max(...adjacentCarYawDeltas) < 0.55 &&
      branchMotion.every(
        (frame) =>
          frame.mechanics.metadata.poseDistanceMetric ===
            "accumulated-rendered-centreline-arc" &&
          frame.mechanics.metadata.campaignWestTraversalDirection === 1 &&
          frame.mechanics.metadata.poseHistoryResetCount >= 1,
      ),
    "Branch triptych does not prove locomotive travel/yaw plus independent bogie and car articulation.",
  );
  assert(
    browserErrors.length === 0,
    `Browser errors: ${browserErrors.join(" | ")}`,
  );

  const proof = {
    format: "cinderline-authentic-live-rail-visual-proof-v4",
    refinementPass: 12,
    interim: INTERIM,
    capturePolicy: {
      applicationLoop: "unmodified requestAnimationFrame",
      automaticTickDisabled: false,
      manualSimulationSteps: 0,
      pausedFrames: 0,
      viewport: [1920, 1080],
    },
    cargoSetup,
    cargoCaptureStatus,
    cargoSequence: {
      before: cargoBefore,
      contact: cargoContact,
      transfer: cargoTransfer,
    },
    campaignSetup,
    campaignWide,
    turnoutMacro,
    consistClose,
    consistCaptureStatus,
    branchSetup,
    branchCaptureStatus,
    branchMotion,
    measuredMotion: {
      motionDistance,
      locomotiveYawDelta,
      bogieYawRange,
      carYawRange,
      adjacentCarSpacings,
      adjacentCarYawDeltas,
    },
    browserErrors,
  };
  const proofPath = `${OUTPUT_DIRECTORY}/${
    INTERIM ? "visual-proof-interim.json" : "visual-proof.json"
  }`;
  await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        proof: proofPath,
        images: [
          "visual-live-loader-before.png",
          "visual-live-loader-contact.png",
          "visual-live-loader-transfer.png",
          "visual-live-campaign-wide.png",
          "visual-live-campaign-west-turnout-macro.png",
          "visual-live-campaign-consist-close.png",
          ...branchMotion.map(({ image }) => image),
        ].map((name) =>
          name.startsWith("interim-")
            ? `${OUTPUT_DIRECTORY}/${name}`
            : `${OUTPUT_DIRECTORY}/${artifactName(name)}`,
        ),
        liveTicks: {
          cargo: [cargoBefore.tick, cargoContact.tick, cargoTransfer.tick],
          branch: branchMotion.map(({ tick }) => tick),
        },
        measuredMotion: proof.measuredMotion,
        turnout: turnoutMacro.turnout,
        mechanics: consistClose.mechanics,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
