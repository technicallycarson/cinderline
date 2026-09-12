import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

// PASS6 is a new mutable evidence lane. It deliberately derives the proven
// lifecycle fixture from PASS5 while redirecting all bytes and freshness
// identifiers; the PASS5 script and every sealed PASS5 artifact stay read-only.
const pass5Source = await readFile(
  new URL("./fluid-visual-qa-pass5.mjs", import.meta.url),
  "utf8",
);
const outputDirectory =
  process.env.CINDERLINE_FLUID_PASS6_OUTPUT ??
  ".qa/fluid-network/pass6-work/formative";
const pass6Source = pass5Source
  .replace(
    'new URL("./fluid-visual-qa.mjs", import.meta.url)',
    'new URL("./scripts/fluid-visual-qa.mjs", import.meta.url)',
  )
  .replace(
    "process.env.CINDERLINE_FLUID_PASS5_OUTPUT ??",
    "process.env.CINDERLINE_FLUID_PASS6_OUTPUT ??",
  )
  .replace(
    '".qa/fluid-network/pass5-work/formative"',
    JSON.stringify(outputDirectory),
  )
  .replace(
    'if (message.type() === "error") {',
    'if (message.type() === "error" || message.type() === "warning") {',
  )
  .replaceAll("fluid-visual-qa-pass5", "fluid-visual-qa-pass6")
  .replaceAll("fluid-pass5", "fluid-pass6")
  .replaceAll("PASS5", "PASS6");

if (pass6Source === pass5Source) {
  throw new Error("PASS6 QA harness transformation did not apply.");
}

let exitCode = 0;
if (
  process.env.CINDERLINE_FLUID_PASS6_SOURCE_ONLY !== "1" &&
  process.env.CINDERLINE_FLUID_PASS6_SKIP_BASE !== "1"
) {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", pass6Source],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CINDERLINE_FLUID_PASS6_OUTPUT: outputDirectory,
      },
      stdio: "inherit",
    },
  );

  child.once("error", (error) => {
    throw error;
  });

  exitCode = await new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      if (signal) {
        throw new Error(`PASS6 QA harness terminated by ${signal}.`);
      }
      resolve(code ?? 1);
    });
  });
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const digest = (buffer) =>
  createHash("sha256").update(buffer).digest("hex");
const pngDimensions = (buffer) => ({
  width: buffer.readUInt32BE(16),
  height: buffer.readUInt32BE(20),
});

if (exitCode === 0) {
  await mkdir(outputDirectory, { recursive: true });
  const baseUrl =
    process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
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
    page.on("pageerror", (error) =>
      errors.push(`pageerror: ${error.message}`),
    );
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        errors.push(`console-${message.type()}: ${message.text()}`);
      }
    });
    await page.goto(
      `${baseUrl.replace(/\/$/, "")}/?fresh=fluid-visual-qa-pass6-source`,
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
    await page.keyboard.press("Space");

    const setup = await page.evaluate(() => {
      const game = window.__CINDERLINE__;
      if (!game) throw new Error("PASS6 source bridge is unavailable.");
      const simulation = game.simulation;
      const world = game.renderer;
      for (const existing of [...simulation.getEntities()]) {
        simulation.remove(existing.x, existing.y);
      }
      simulation.drainEvents();
      const place = (kind, x, y, direction = 1, options = {}) => {
        const result = simulation.place(kind, x, y, direction, options);
        if (!result.ok) {
          throw new Error(
            `PASS6 source placement failed for ${kind}: ${result.reason}`,
          );
        }
        return result.entity;
      };
      const source = place("fluidSource", 8, 8, 1, {
        fluidId: "crudeOil",
      });
      const pipeA = place("fluidPipe", 10, 8, 1);
      const pipeB = place("fluidPipe", 11, 8, 1);
      const pipeC = place("fluidPipe", 12, 8, 1);
      const includedIds = [source.id, pipeA.id, pipeB.id, pipeC.id];
      const includedIdSet = new Set(includedIds);
      const toFluidFrame = (snapshot) => ({
        elapsedSeconds: snapshot.elapsedSeconds,
        fluidEntities: snapshot.entities
          .filter(
            (entity) =>
              includedIdSet.has(entity.id) &&
              entity.fluidState !== undefined,
          )
          .map((entity) => ({
            id: entity.id,
            kind: entity.kind,
            x: entity.x,
            z: entity.y,
            direction: entity.direction,
            status: entity.status,
            powerSatisfaction: entity.powerSatisfaction,
            fluidState: entity.fluidState,
          })),
        fluidNetwork: {
          ...snapshot.fluidNetwork,
          nodes: snapshot.fluidNetwork.nodes.filter(({ entityId }) =>
            includedIdSet.has(entityId),
          ),
          edges: snapshot.fluidNetwork.edges.filter(
            ({ sourceEntityId, targetEntityId }) =>
              includedIdSet.has(sourceEntityId) &&
              includedIdSet.has(targetEntityId),
          ),
          components: [],
        },
      });
      const inactiveSnapshot = simulation.getRenderSnapshot();
      simulation.step(2);
      const activeSnapshot = simulation.getRenderSnapshot();
      window.__fluidPass6SourceFrames = {
        inactive: toFluidFrame(inactiveSnapshot),
        active: toFluidFrame(activeSnapshot),
      };
      window.__fluidPass6SourceId = source.id;
      window.__fluidPass6IncludedIds = includedIds;

      world.powerGridRoot.visible = false;
      world.infrastructureRoot.visible = false;
      world.effectsRoot.visible = false;
      world.itemRoot.visible = false;
      world.overlayRoot.visible = false;
      world.resourceRoot.visible = false;
      for (const rig of world.entityObjects.values()) {
        rig.root.visible = false;
      }
      for (const child of world.entityRoot.children) {
        child.visible = child === world.fluidRenderer.root;
      }
      world.fluidRenderer.root.visible = true;
      // The application still draws while simulation time is paused. Prevent
      // its next presentation sync from replacing the controlled extrema
      // between render() and the native canvas screenshot.
      world.sync = () => {};
      document.querySelector("#boot")?.remove();
      const hud = document.querySelector("#hud");
      if (hud instanceof HTMLElement) hud.style.display = "none";
      return {
        sourceId: source.id,
        includedIds,
        inactiveStatus:
          window.__fluidPass6SourceFrames.inactive.fluidEntities.find(
            ({ id }) => id === source.id,
          )?.status,
        activeStatus:
          window.__fluidPass6SourceFrames.active.fluidEntities.find(
            ({ id }) => id === source.id,
          )?.status,
      };
    });

    const canvas = page.locator("#world");
    const capture = async ({
      file,
      frameName,
      pose,
      sourceOnly,
      focusX,
      focusZ,
      viewWidth,
      cameraOffsetX = 6,
      cameraOffsetZ = 16.5,
      cameraTargetY = 0.65,
    }) => {
      const measurement = await page.evaluate(
        ({
          frameName,
          pose,
          sourceOnly,
          focusX,
          focusZ,
          viewWidth,
          cameraOffsetX,
          cameraOffsetZ,
          cameraTargetY,
        }) => {
          const game = window.__CINDERLINE__;
          const frames = window.__fluidPass6SourceFrames;
          const sourceId = window.__fluidPass6SourceId;
          if (!game || !frames || !sourceId) {
            throw new Error("PASS6 source capture bridge is unavailable.");
          }
          const world = game.renderer;
          const originalFrame = frames[frameName];
          const sourceEntity = originalFrame.fluidEntities.find(
            ({ id }) => id === sourceId,
          );
          if (!sourceEntity) {
            throw new Error("PASS6 source entity is missing.");
          }
          const bias = sourceId * 0.071;
          const activeRate = 4.7;
          const elapsedSeconds =
            pose === "up"
              ? (Math.PI * 4 - bias) / activeRate
              : pose === "down"
                ? (Math.PI * 5 - bias) / activeRate
                : (Math.PI * 4 - bias) / 0.38;
          const frame = sourceOnly
            ? {
                elapsedSeconds,
                fluidEntities: [sourceEntity],
                fluidNetwork: {
                  ...originalFrame.fluidNetwork,
                  nodes: originalFrame.fluidNetwork.nodes.filter(
                    ({ entityId }) => entityId === sourceId,
                  ),
                  edges: [],
                  components: [],
                },
              }
            : {
                ...originalFrame,
                elapsedSeconds,
              };
          world.fluidRenderer.sync(frame);
          world.fluidRenderer.root.visible = true;
          for (const child of world.entityRoot.children) {
            child.visible = child === world.fluidRenderer.root;
          }
          world.focus(focusX, focusZ);
          world.viewWidth = viewWidth;
          world.resize();
          // PASS6 source adjudication needs the vertical load path to remain
          // readable. The normal strategic camera is deliberately steep;
          // lower only this native QA capture to a restrained 3/4 equipment
          // inspection angle without changing renderer geometry or framing.
          world.camera.position.set(
            focusX + cameraOffsetX,
            14,
            focusZ + cameraOffsetZ,
          );
          world.camera.lookAt(focusX, cameraTargetY, focusZ);
          world.camera.updateMatrixWorld();
          world.render(0);
          world.renderer.getContext().finish();

          const fluidRoot = world.fluidRenderer.root;
          fluidRoot.updateWorldMatrix(true, true);
          const rig = fluidRoot.getObjectByName(
            "fluid-fluidSource-rig",
          );
          const beam = fluidRoot.getObjectByName(
            "fluid-source-reciprocating-beam",
          );
          const rod = fluidRoot.getObjectByName(
            "fluid-source-polished-rod",
          );
          const pitman = fluidRoot.getObjectByName(
            "fluid-source-crank-pitman-link",
          );
          const flange = fluidRoot.getObjectByName(
            "fluid-source-output-flange",
          );
          const horsehead = fluidRoot.getObjectByName(
            "fluid-source-pass6-broad-curved-horsehead",
          );
          const bridle = fluidRoot.getObjectByName(
            "fluid-source-pass6-exposed-horsehead-bridle",
          );
          const carrier = fluidRoot.getObjectByName(
            "fluid-source-pass6-bridle-polished-rod-carrier",
          );
          const stuffingBox = fluidRoot.getObjectByName(
            "fluid-source-pass6-stuffing-box",
          );
          const wellhead = fluidRoot.getObjectByName(
            "fluid-source-pass6-wellhead-body",
          );
          const crank = fluidRoot.getObjectByName(
            "fluid-source-crank-flywheel",
          );
          if (
            !rig ||
            !beam ||
            !rod ||
            !pitman ||
            !flange ||
            !horsehead ||
            !bridle ||
            !carrier ||
            !stuffingBox ||
            !wellhead ||
            !crank
          ) {
            throw new Error("PASS6 pumpjack mechanism is incomplete.");
          }
          const vector = (object) => {
            const value = object.getWorldPosition(object.position.clone());
            return [value.x, value.y, value.z];
          };
          const bridles = [];
          const nosePins = [];
          fluidRoot.traverse((object) => {
            if (
              object.name ===
              "fluid-source-pass6-exposed-horsehead-bridle"
            ) {
              bridles.push(object);
            }
            if (
              object.name ===
              "fluid-source-pass6-horsehead-nose-pin"
            ) {
              nosePins.push(object);
            }
          });
          const endpoint = (object, localY) =>
            object.position
              .clone()
              .set(0, localY, 0)
              .applyMatrix4(object.matrixWorld);
          const carrierWorld = carrier.getWorldPosition(
            carrier.position.clone(),
          );
          const rodTopWorld = rod.position
            .clone()
            .set(0, 0.5, 0)
            .applyMatrix4(rod.matrixWorld);
          let maximumNosePinError = 0;
          let maximumCarrierError = 0;
          let minimumBridleLength = Number.POSITIVE_INFINITY;
          const projectedBridleCenters = [];
          for (const member of bridles) {
            const start = endpoint(member, -0.5);
            const end = endpoint(member, 0.5);
            const projectedCenter = start
              .clone()
              .add(end)
              .multiplyScalar(0.5)
              .project(world.camera);
            projectedBridleCenters.push([
              (projectedCenter.x * 0.5 + 0.5) * 1920,
              (-projectedCenter.y * 0.5 + 0.5) * 1080,
            ]);
            const nearestNoseError = Math.min(
              ...nosePins.map((pin) =>
                start.distanceTo(
                  pin.getWorldPosition(pin.position.clone()),
                ),
              ),
            );
            maximumNosePinError = Math.max(
              maximumNosePinError,
              nearestNoseError,
            );
            const carrierOffset = Number(
              member.userData.carrierLateralOffset ?? 0,
            );
            const expectedCarrierContact = carrier.position
              .clone()
              .set(carrierOffset, 0, 0)
              .applyMatrix4(carrier.matrixWorld);
            maximumCarrierError = Math.max(
              maximumCarrierError,
              end.distanceTo(expectedCarrierContact),
            );
            minimumBridleLength = Math.min(
              minimumBridleLength,
              member.scale.y,
            );
          }
          const declaredPortLocal = rig.userData.localOutputPort;
          const declaredPortWorld = rig.position
            .clone()
            .set(...declaredPortLocal)
            .applyMatrix4(rig.matrixWorld);
          const flangeWorld = flange.getWorldPosition(
            flange.position.clone(),
          );
          const district = fluidRoot.getObjectByName(
            "fluid-refinery-district-service-floor-system",
          );
          const routeAudit = district?.userData.routeAudit ?? [];
          const sourceRoute = routeAudit.find(
            ({ sourceEntityId, targetEntityId }) =>
              sourceEntity.id === sourceEntityId ||
              sourceEntity.id === targetEntityId,
          );
          const routePort = sourceRoute
            ? sourceRoute.sourceEntityId === sourceEntity.id
              ? sourceRoute.start
              : sourceRoute.end
            : null;
          const routePortDistance = routePort
            ? declaredPortWorld.distanceTo(
                rig.position.clone().set(...routePort),
              )
            : null;
          const visibleNames = [];
          fluidRoot.traverseVisible((object) => {
            if (object.name) visibleNames.push(object.name);
          });
          const projectedBounds = {
            minX: Number.POSITIVE_INFINITY,
            maxX: Number.NEGATIVE_INFINITY,
            minY: Number.POSITIVE_INFINITY,
            maxY: Number.NEGATIVE_INFINITY,
          };
          let projectedMeshCount = 0;
          rig.traverseVisible((object) => {
            if (!object.isMesh || !object.geometry) return;
            object.geometry.computeBoundingBox();
            const box = object.geometry.boundingBox;
            if (!box || box.isEmpty()) return;
            projectedMeshCount += 1;
            for (const x of [box.min.x, box.max.x]) {
              for (const y of [box.min.y, box.max.y]) {
                for (const z of [box.min.z, box.max.z]) {
                  const point = box.min
                    .clone()
                    .set(x, y, z)
                    .applyMatrix4(object.matrixWorld)
                    .project(world.camera);
                  const pixelX = (point.x * 0.5 + 0.5) * 1920;
                  const pixelY = (-point.y * 0.5 + 0.5) * 1080;
                  projectedBounds.minX = Math.min(
                    projectedBounds.minX,
                    pixelX,
                  );
                  projectedBounds.maxX = Math.max(
                    projectedBounds.maxX,
                    pixelX,
                  );
                  projectedBounds.minY = Math.min(
                    projectedBounds.minY,
                    pixelY,
                  );
                  projectedBounds.maxY = Math.max(
                    projectedBounds.maxY,
                    pixelY,
                  );
                }
              }
            }
          });
          const minimumSafeMarginPixels = Math.min(
            projectedBounds.minX,
            1920 - projectedBounds.maxX,
            projectedBounds.minY,
            1080 - projectedBounds.maxY,
          );
          return {
            frameName,
            pose,
            sourceOnly,
            sourceStatus: sourceEntity.status,
            elapsedSeconds,
            beamAngle: beam.userData.beamAngle,
            rodStroke: rod.userData.stroke,
            rodWorld: vector(rod),
            pitmanWorld: vector(pitman),
            flangeWorld: [
              flangeWorld.x,
              flangeWorld.y,
              flangeWorld.z,
            ],
            declaredPortWorld: [
              declaredPortWorld.x,
              declaredPortWorld.y,
              declaredPortWorld.z,
            ],
            flangePortDistance:
              flangeWorld.distanceTo(declaredPortWorld),
            routePortDistance,
            routeAudit,
            supportAudit: district?.userData.supportAudit ?? [],
            framing: {
              projectedMeshCount,
              projectedBoundsPixels: projectedBounds,
              minimumSafeMarginPixels,
            },
            hasHorsehead: visibleNames.includes(
              "fluid-source-pass6-broad-curved-horsehead",
            ),
            hasBridle: visibleNames.includes(
              "fluid-source-pass6-exposed-horsehead-bridle",
            ),
            hasPolishedRod: visibleNames.includes(
              "fluid-source-polished-rod",
            ),
            hasWellhead: visibleNames.includes(
              "fluid-source-pass6-wellhead-body",
            ),
            hasCrank: visibleNames.includes(
              "fluid-source-crank-flywheel",
            ),
            bridleChain: {
              bridleCount: bridles.length,
              nosePinCount: nosePins.length,
              minimumBridleLength,
              maximumNosePinError,
              maximumCarrierError,
              carrierPolishedRodError:
                carrierWorld.distanceTo(rodTopWorld),
              projectedCenterSeparationPixels:
                projectedBridleCenters.length === 2
                  ? Math.hypot(
                      projectedBridleCenters[0][0] -
                        projectedBridleCenters[1][0],
                      projectedBridleCenters[0][1] -
                        projectedBridleCenters[1][1],
                    )
                  : 0,
              hasStuffingBox: visibleNames.includes(
                "fluid-source-pass6-stuffing-box",
              ),
            },
            localOutputPort: declaredPortLocal,
          };
        },
        {
          frameName,
          pose,
          sourceOnly,
          focusX,
          focusZ,
          viewWidth,
          cameraOffsetX,
          cameraOffsetZ,
          cameraTargetY,
        },
      );
      await page.waitForTimeout(24);
      const buffer = await canvas.screenshot({
        path: `${outputDirectory}/${file}`,
      });
      return {
        ...measurement,
        image: {
          file,
          width: 1920,
          height: 1080,
          bytes: buffer.byteLength,
          sha256: digest(buffer),
        },
      };
    };

    const inactive = await capture({
      file: "pumpjack-inactive-close.png",
      frameName: "inactive",
      pose: "idle",
      sourceOnly: true,
      focusX: 8.9,
      focusZ: 9,
      viewWidth: 8.25,
      cameraTargetY: 1.15,
    });
    const activeUp = await capture({
      file: "pumpjack-active-up-close.png",
      frameName: "active",
      pose: "up",
      sourceOnly: true,
      focusX: 8.9,
      focusZ: 9,
      viewWidth: 8.25,
      cameraTargetY: 1.15,
    });
    const activeDown = await capture({
      file: "pumpjack-active-down-close.png",
      frameName: "active",
      pose: "down",
      sourceOnly: true,
      focusX: 8.9,
      focusZ: 9,
      viewWidth: 8.25,
      cameraTargetY: 1.15,
    });
    const bridleInspection = await capture({
      file: "pumpjack-bridle-load-chain-close.png",
      frameName: "active",
      pose: "up",
      sourceOnly: true,
      focusX: 8.9,
      focusZ: 9,
      viewWidth: 6.9,
      cameraOffsetX: 17.5,
      cameraOffsetZ: 2.5,
      cameraTargetY: 1.05,
    });
    const plumbing = await capture({
      file: "source-grounded-plumbing-macro.png",
      frameName: "active",
      pose: "up",
      sourceOnly: false,
      focusX: 10.2,
      focusZ: 9,
      viewWidth: 7.8,
    });
    const beamPoseDelta = Math.abs(
      activeUp.beamAngle - activeDown.beamAngle,
    );
    const rodTravel = Math.abs(
      activeUp.rodStroke - activeDown.rodStroke,
    );
    const assertions = {
      inactiveIsNotWorking: inactive.sourceStatus !== "working",
      activeIsWorking:
        activeUp.sourceStatus === "working" &&
        activeDown.sourceStatus === "working",
      beamPoseDeltaAtLeastPointFour: beamPoseDelta >= 0.4,
      rodTravelAtLeastPointEight: rodTravel >= 0.8,
      flangeMatchesDeclaredPort:
        plumbing.flangePortDistance <= 0.001,
      routeMatchesDeclaredPort:
        plumbing.routePortDistance !== null &&
        plumbing.routePortDistance <= 0.03,
      hasGroundedSupports:
        plumbing.supportAudit.length >= 3 &&
        plumbing.supportAudit.every(
          ({ groundContactY }) => groundContactY <= 0.04,
        ),
      completeVisibleLoadChain:
        activeUp.hasHorsehead &&
        activeUp.hasBridle &&
        activeUp.hasPolishedRod &&
        activeUp.hasWellhead &&
        activeUp.hasCrank &&
        activeUp.bridleChain.bridleCount === 2 &&
        activeUp.bridleChain.nosePinCount === 2 &&
        activeUp.bridleChain.minimumBridleLength >= 0.6 &&
        activeUp.bridleChain.maximumNosePinError <= 0.001 &&
        activeUp.bridleChain.maximumCarrierError <= 0.001 &&
        activeUp.bridleChain.carrierPolishedRodError <= 0.001 &&
        activeUp.bridleChain.hasStuffingBox &&
        activeDown.bridleChain.bridleCount === 2 &&
        activeDown.bridleChain.nosePinCount === 2 &&
        activeDown.bridleChain.minimumBridleLength >= 0.6 &&
        activeDown.bridleChain.maximumNosePinError <= 0.001 &&
        activeDown.bridleChain.maximumCarrierError <= 0.001 &&
        activeDown.bridleChain.carrierPolishedRodError <= 0.001 &&
        activeDown.bridleChain.hasStuffingBox,
      bridlePairReadableInDedicatedNativeView:
        bridleInspection.bridleChain.bridleCount === 2 &&
        bridleInspection.bridleChain.projectedCenterSeparationPixels >=
          80,
      mechanismSafeMarginsAtBothWorkingExtrema:
        activeUp.framing.minimumSafeMarginPixels >= 96 &&
        activeDown.framing.minimumSafeMarginPixels >= 96,
      noBrowserErrors: errors.length === 0,
    };
    assert(
      Object.values(assertions).every(Boolean),
      `PASS6 source invariant failed: ${JSON.stringify(assertions)}`,
    );
    const proof = {
      schema: "cinderline-fluid-pass6-source-macro-v1",
      nativeViewport: { width: 1920, height: 1080 },
      setup,
      thresholds: {
        minimumBeamPoseDeltaRadians: 0.4,
        minimumRodTipTravelWorldUnits: 0.8,
        maximumFlangePortDistance: 0.001,
        maximumRoutePortDistance: 0.03,
        minimumWorkingExtremaFrameMarginPixels: 96,
      },
      measurements: {
        beamPoseDeltaRadians: beamPoseDelta,
        rodTipTravelWorldUnits: rodTravel,
        workingExtremaSafeMarginsPixels: {
          up: activeUp.framing.minimumSafeMarginPixels,
          down: activeDown.framing.minimumSafeMarginPixels,
        },
      },
      assertions,
      captures: [
        inactive,
        activeUp,
        activeDown,
        bridleInspection,
        plumbing,
      ],
      browserErrors: errors,
    };
    await writeFile(
      `${outputDirectory}/source-mechanism-proof.json`,
      `${JSON.stringify(proof, null, 2)}\n`,
      "utf8",
    );
    let districtLifecycle = null;
    let ordinaryLiveGameplay = null;
    let visualProof = null;
    if (process.env.CINDERLINE_FLUID_PASS6_SOURCE_ONLY !== "1") {
      const districtSetup = await page.evaluate(() => {
        const game = window.__CINDERLINE__;
        if (!game) {
          throw new Error("PASS6 district lifecycle bridge is unavailable.");
        }
        const simulation = game.simulation;
        const world = game.renderer;
        for (const existing of [...simulation.getEntities()]) {
          simulation.remove(existing.x, existing.y);
        }
        simulation.drainEvents();
        const placements = [];
        const place = (kind, x, y, direction = 1, options = {}) => {
          const result = simulation.place(kind, x, y, direction, options);
          if (!result.ok) {
            throw new Error(
              `PASS6 district placement failed for ${kind} at ${x},${y}: ${result.reason}`,
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
        const source = place("fluidSource", 1, 7, 1, {
          fluidId: "crudeOil",
        });
        place("fluidPump", 3, 7, 1);
        place("fluidPipe", 4, 7, 1);
        place("fluidPipe", 5, 7, 1);
        const processor = place("fluidProcessor", 6, 6, 1, {
          fluidRecipeId: "refineCrude",
        });
        place("fluidPipe", 9, 7, 1);
        place("fluidPump", 10, 7, 1);
        place("fluidPipe", 11, 7, 1);
        const receiver = place("fluidTank", 12, 6, 1);
        const fluidPlacements = placements.filter(({ kind }) =>
          kind.startsWith("fluid"),
        );
        const includedIds = fluidPlacements.map(({ id }) => id);

        for (const [x, y] of [
          [3, 5],
          [10, 3],
          [3, 11],
          [9, 14],
          [5, 20],
          [15, 5],
        ]) {
          place("gridRelay", x, y);
        }
        const generator = place("generator", 16, 3);
        const reserveGenerator = place("generator", 0, 16);
        for (const powerSource of [generator, reserveGenerator]) {
          const fueled = simulation.receive(
            powerSource.id,
            "coal",
            40,
            "fuel",
          );
          if (fueled !== 40) {
            throw new Error("PASS6 district generator did not fuel.");
          }
        }
        simulation.drainEvents();
        window.__fluidPass6District = {
          includedIds,
          processorId: processor.id,
          receiverId: receiver.id,
          sourceId: source.id,
          startingTick: simulation.getRenderSnapshot().tick,
        };
        world.powerGridRoot.visible = false;
        world.infrastructureRoot.visible = false;
        world.effectsRoot.visible = false;
        world.itemRoot.visible = false;
        world.overlayRoot.visible = false;
        world.resourceRoot.visible = false;
        for (const rig of world.entityObjects.values()) {
          rig.root.visible = false;
        }
        for (const child of world.entityRoot.children) {
          child.visible = child === world.fluidRenderer.root;
        }
        world.fluidRenderer.root.visible = true;
        return {
          sourceId: source.id,
          processorId: processor.id,
          receiverId: receiver.id,
          startingTick: window.__fluidPass6District.startingTick,
          fluidPlacements,
          includedIds,
        };
      });

      const districtCapture = async ({
        advanceTicks,
        label,
        file,
        focusX,
        focusZ,
        viewWidth,
        cameraOffsetX = -9.5,
        cameraOffsetZ = 19,
        cameraHeight = 13.8,
        cameraTargetY = 0.78,
      }) => {
        const measurement = await page.evaluate(
          ({
            advanceTicks,
            label,
            focusX,
            focusZ,
            viewWidth,
            cameraOffsetX,
            cameraOffsetZ,
            cameraHeight,
            cameraTargetY,
          }) => {
            const game = window.__CINDERLINE__;
            const district = window.__fluidPass6District;
            if (!game || !district) {
              throw new Error(
                "PASS6 district capture bridge is unavailable.",
              );
            }
            const simulation = game.simulation;
            const world = game.renderer;
            simulation.step(advanceTicks);
            const snapshot = simulation.getRenderSnapshot();
            const includedIdSet = new Set(district.includedIds);
            const fluidEntities = snapshot.entities
              .filter(
                (entity) =>
                  includedIdSet.has(entity.id) &&
                  entity.fluidState !== undefined,
              )
              .map((entity) => ({
                id: entity.id,
                kind: entity.kind,
                x: entity.x,
                z: entity.y,
                direction: entity.direction,
                status: entity.status,
                powerSatisfaction: entity.powerSatisfaction,
                fluidState: entity.fluidState,
              }));
            const fluidNetwork = {
              ...snapshot.fluidNetwork,
              nodes: snapshot.fluidNetwork.nodes.filter(({ entityId }) =>
                includedIdSet.has(entityId),
              ),
              edges: snapshot.fluidNetwork.edges.filter(
                ({ sourceEntityId, targetEntityId }) =>
                  includedIdSet.has(sourceEntityId) &&
                  includedIdSet.has(targetEntityId),
              ),
              components: [],
            };
            world.fluidRenderer.sync({
              elapsedSeconds: snapshot.elapsedSeconds,
              fluidEntities,
              fluidNetwork,
            });
            world.powerGridRoot.visible = false;
            world.infrastructureRoot.visible = false;
            world.effectsRoot.visible = false;
            world.itemRoot.visible = false;
            world.overlayRoot.visible = false;
            world.resourceRoot.visible = false;
            for (const rig of world.entityObjects.values()) {
              rig.root.visible = false;
            }
            for (const child of world.entityRoot.children) {
              child.visible = child === world.fluidRenderer.root;
            }
            world.fluidRenderer.root.visible = true;
            world.focus(focusX, focusZ);
            world.viewWidth = viewWidth;
            world.resize();
            // A native equipment-inspection angle exposes the full vertical
            // process path and the custody columns that the strategic camera
            // compresses. The camera remains orthographic and uses the live
            // scene, renderer, materials, shadows, and authoritative frame.
            world.camera.position.set(
              focusX + cameraOffsetX,
              cameraHeight,
              focusZ + cameraOffsetZ,
            );
            world.camera.lookAt(focusX, cameraTargetY, focusZ);
            world.camera.updateProjectionMatrix();
            world.camera.updateMatrixWorld();
            world.render(0);
            world.renderer.getContext().finish();

            const fluidRoot = world.fluidRenderer.root;
            fluidRoot.updateWorldMatrix(true, true);
            let processorRig = null;
            let tankRig = null;
            fluidRoot.traverse((object) => {
              if (object.userData.entityId === district.processorId) {
                processorRig = object;
              }
              if (object.userData.entityId === district.receiverId) {
                tankRig = object;
              }
            });
            if (!processorRig || !tankRig) {
              throw new Error(
                "PASS6 district processor or receiver rig is missing.",
              );
            }
            const effectivelyVisible = (object) => {
              let current = object;
              while (current) {
                if (!current.visible) return false;
                current = current.parent;
              }
              return true;
            };
            const collect = (root, name) => {
              const values = [];
              root.traverse((object) => {
                if (object.name === name) values.push(object);
              });
              return values;
            };
            const stageShutters = collect(
              processorRig,
              "fluid-processor-pass6-fractionation-stage-shutter",
            );
            const feedSlug = processorRig.getObjectByName(
              "fluid-processor-pass6-authoritative-feed-slug",
            );
            const productSlug = processorRig.getObjectByName(
              "fluid-processor-pass6-authoritative-product-slug",
            );
            const reliefSpring = processorRig.getObjectByName(
              "fluid-processor-pass6-primary-relief-spring",
            );
            const reliefCap = processorRig.getObjectByName(
              "fluid-processor-relief-cap",
            );
            const steamPlumes = collect(
              processorRig,
              "fluid-processor-authoritative-steam-plume",
            );
            const custodyLevels = collect(
              tankRig,
              "fluid-tank-pass6-authoritative-custody-column-fill",
            );
            const pressureSprings = collect(
              tankRig,
              "fluid-tank-pass6-pressure-spring-cage",
            );
            const ventCaps = collect(
              tankRig,
              "fluid-tank-pass6-pressure-vent-cap",
            );
            const gaugeNeedles = collect(
              tankRig,
              "fluid-tank-pass6-large-pressure-gauge-needle",
            );
            const visibleCustody = custodyLevels.find(effectivelyVisible);
            const visiblePressureSpring =
              pressureSprings.find(effectivelyVisible);
            const visibleVentCap = ventCaps.find(effectivelyVisible);
            const visibleGaugeNeedle =
              gaugeNeedles.find(effectivelyVisible);
            const processorEntity = fluidEntities.find(
              ({ id }) => id === district.processorId,
            );
            const receiverEntity = fluidEntities.find(
              ({ id }) => id === district.receiverId,
            );
            const projectedBounds = {
              minX: Number.POSITIVE_INFINITY,
              maxX: Number.NEGATIVE_INFINITY,
              minY: Number.POSITIVE_INFINITY,
              maxY: Number.NEGATIVE_INFINITY,
            };
            let projectedMeshCount = 0;
            const excludedBoundsNames = [
              "irregular-stained-aggregate-service-yard",
              "localized-oil-and-rust-wear",
              "grounded-aggregate-and-maintenance-debris",
              "terrain-contact-staining",
            ];
            fluidRoot.traverseVisible((object) => {
              if (
                !object.isMesh ||
                !object.geometry ||
                excludedBoundsNames.some((name) =>
                  object.name.includes(name),
                )
              ) {
                return;
              }
              let box = null;
              if (object.isInstancedMesh) {
                object.computeBoundingBox();
                box = object.boundingBox;
              } else {
                object.geometry.computeBoundingBox();
                box = object.geometry.boundingBox;
              }
              if (!box || box.isEmpty()) return;
              projectedMeshCount += 1;
              for (const x of [box.min.x, box.max.x]) {
                for (const y of [box.min.y, box.max.y]) {
                  for (const z of [box.min.z, box.max.z]) {
                    const point = box.min
                      .clone()
                      .set(x, y, z)
                      .applyMatrix4(object.matrixWorld)
                      .project(world.camera);
                    const pixelX = (point.x * 0.5 + 0.5) * 1920;
                    const pixelY = (-point.y * 0.5 + 0.5) * 1080;
                    projectedBounds.minX = Math.min(
                      projectedBounds.minX,
                      pixelX,
                    );
                    projectedBounds.maxX = Math.max(
                      projectedBounds.maxX,
                      pixelX,
                    );
                    projectedBounds.minY = Math.min(
                      projectedBounds.minY,
                      pixelY,
                    );
                    projectedBounds.maxY = Math.max(
                      projectedBounds.maxY,
                      pixelY,
                    );
                  }
                }
              }
            });
            return {
              label,
              tick: snapshot.tick,
              tickDelta: snapshot.tick - district.startingTick,
              elapsedSeconds: snapshot.elapsedSeconds,
              processorStatus: processorEntity?.status ?? null,
              receiverStatus: receiverEntity?.status ?? null,
              processorState: processorEntity?.fluidState ?? null,
              receiverState: receiverEntity?.fluidState ?? null,
              process: {
                stage: Number(processorRig.userData.processStage ?? -1),
                stageName:
                  processorRig.userData.processStageName ?? null,
                engagedStageCount: Number(
                  processorRig.userData.engagedFractionationStages ?? -1,
                ),
                stageShutterCount: stageShutters.length,
                engagedShutterCount: stageShutters.filter(
                  ({ userData }) => userData.stageEngaged,
                ).length,
                feedSlugVisible:
                  Boolean(feedSlug) && effectivelyVisible(feedSlug),
                feedSlugState:
                  feedSlug?.userData.operatingState ?? null,
                productSlugVisible:
                  Boolean(productSlug) &&
                  effectivelyVisible(productSlug),
                productSlugState:
                  productSlug?.userData.operatingState ?? null,
                reliefSpringCompression: Number(
                  reliefSpring?.userData.compressionRatio ?? 0,
                ),
                reliefCapLift: Number(
                  reliefCap?.userData.lift ?? 0,
                ),
                steamPlumeCount: steamPlumes.length,
                visibleSteamPlumeCount:
                  steamPlumes.filter(effectivelyVisible).length,
                causalPath:
                  processorRig.userData.lifecycleCausality ?? null,
              },
              tank: {
                fillRatio: Number(
                  visibleCustody?.userData.fillRatio ?? 0,
                ),
                custodyVisible:
                  Boolean(visibleCustody) &&
                  effectivelyVisible(visibleCustody),
                custodyLevelCount: custodyLevels.length,
                visibleCustodyLevelCount:
                  custodyLevels.filter(effectivelyVisible).length,
                gaugePressureRatio: Number(
                  visibleGaugeNeedle?.userData.pressureRatio ?? 0,
                ),
                springCompression: Number(
                  visiblePressureSpring?.userData.compressionRatio ?? 0,
                ),
                ventCapLift: Number(
                  visibleVentCap?.userData.lift ?? 0,
                ),
                pressureMechanismState:
                  tankRig.userData.pressureMechanismState ?? null,
              },
              debug: world.fluidRenderer.getDebug(),
              framing: {
                projectedMeshCount,
                projectedBoundsPixels: projectedBounds,
                minimumSafeMarginPixels: Math.min(
                  projectedBounds.minX,
                  1920 - projectedBounds.maxX,
                  projectedBounds.minY,
                  1080 - projectedBounds.maxY,
                ),
              },
            };
          },
          {
            advanceTicks,
            label,
            focusX,
            focusZ,
            viewWidth,
            cameraOffsetX,
            cameraOffsetZ,
            cameraHeight,
            cameraTargetY,
          },
        );
        await page.waitForTimeout(32);
        const buffer = await canvas.screenshot({
          path: `${outputDirectory}/${file}`,
        });
        return {
          ...measurement,
          image: {
            file,
            width: 1920,
            height: 1080,
            bytes: buffer.byteLength,
            sha256: digest(buffer),
          },
        };
      };

      const districtStages = [];
      let transferClose = null;
      let pressureClose = null;
      let candidateHero = null;
      for (const [advanceTicks, label, file] of [
        [0, "cold-and-empty", "district-phase-00-cold.png"],
        [20, "crude-feed-primed", "district-phase-01-feed.png"],
        [340, "fired-fractionation", "district-phase-02-fired.png"],
        [1_200, "product-transfer", "district-phase-03-transfer.png"],
        [8_400, "storage-backpressure", "district-phase-04-pressure.png"],
      ]) {
        districtStages.push(
          await districtCapture({
            advanceTicks,
            label,
            file,
            focusX: 8,
            focusZ: 7.5,
            viewWidth: 16.2,
          }),
        );
        if (label === "product-transfer") {
          candidateHero = await districtCapture({
            advanceTicks: 0,
            label: "product-transfer-candidate-hero",
            file: "refinery-hero.png",
            focusX: 8,
            focusZ: 7.5,
            viewWidth: 16.2,
            cameraOffsetX: -10.5,
            cameraOffsetZ: 19,
            cameraHeight: 13.4,
            cameraTargetY: 0.82,
          });
          transferClose = await districtCapture({
            advanceTicks: 0,
            label: "product-transfer-close",
            file: "processor-tank-phase-03-transfer-close.png",
            focusX: 10.2,
            focusZ: 7.5,
            viewWidth: 10.4,
            cameraOffsetX: -15,
            cameraOffsetZ: 11,
            cameraTargetY: 0.9,
          });
        } else if (label === "storage-backpressure") {
          pressureClose = await districtCapture({
            advanceTicks: 0,
            label: "storage-backpressure-close",
            file: "processor-tank-phase-04-pressure-close.png",
            focusX: 10.2,
            focusZ: 7.5,
            viewWidth: 10.4,
            cameraOffsetX: -15,
            cameraOffsetZ: 11,
            cameraTargetY: 0.9,
          });
        }
      }
      assert(
        candidateHero && transferClose && pressureClose,
        "PASS6 district hero and close captures were not produced.",
      );
      const expectedStageNames = [
        "cold-and-empty",
        "crude-feed-primed",
        "fired-fractionation",
        "product-transfer",
        "storage-backpressure",
      ];
      const districtAssertions = {
        exactFixedTickSchedule:
          districtStages.map(({ tickDelta }) => tickDelta).join(",") ===
          "0,20,360,1560,9960",
        exactFiveStageSequence:
          districtStages
            .map(({ process }) => process.stageName)
            .join(",") === expectedStageNames.join(","),
        fivePhysicalFractionationStages:
          districtStages.every(
            ({ process }) =>
              process.stageShutterCount === 5 &&
              process.engagedShutterCount ===
                process.engagedStageCount,
          ),
        feedThenProductCausality:
          !districtStages[0].process.feedSlugVisible &&
          districtStages[1].process.feedSlugVisible &&
          !districtStages[1].process.productSlugVisible &&
          districtStages[2].process.productSlugVisible &&
          districtStages[3].process.productSlugVisible,
        oneRestrainedRelief:
          districtStages.every(
            ({ process }) => process.steamPlumeCount === 1,
          ) &&
          districtStages
            .slice(0, 4)
            .every(
              ({ process }) =>
                process.visibleSteamPlumeCount === 0,
            ) &&
          districtStages[4].process.visibleSteamPlumeCount === 1,
        receiverCustodyRises:
          districtStages[0].tank.fillRatio === 0 &&
          districtStages[2].tank.fillRatio > 0 &&
          districtStages[3].tank.fillRatio >
            districtStages[2].tank.fillRatio + 0.25 &&
          districtStages[4].tank.fillRatio === 1,
        firedToTransferCustodyDeltaIsReadable:
          districtStages[3].tank.fillRatio -
            districtStages[2].tank.fillRatio >=
          0.35,
        firedToTransferGaugeDeltaIsReadable:
          districtStages[3].tank.gaugePressureRatio -
            districtStages[2].tank.gaugePressureRatio >=
          0.35,
        tankPressureIsMechanical:
          districtStages[4].tank.gaugePressureRatio === 1 &&
          districtStages[4].tank.springCompression >= 0.29 &&
          districtStages[4].tank.ventCapLift >= 0.07 &&
          districtStages[4].tank.pressureMechanismState ===
            "full-gauge-high-spring-compressed-cap-lifted",
        processorPressureIsMechanical:
          districtStages[4].process.reliefSpringCompression >=
            0.31 &&
          districtStages[4].process.reliefCapLift >= 0.07 &&
          districtStages[4].process.productSlugState ===
            "pressure-held-product",
        oneVisibleTankCustodyStation:
          districtStages.every(
            ({ tank }) =>
              tank.custodyLevelCount === 4 &&
              tank.visibleCustodyLevelCount <= 1,
          ),
        candidateHeroHasCompleteSafeConnectedComposition:
          candidateHero.framing.projectedMeshCount > 0 &&
          candidateHero.framing.minimumSafeMarginPixels >= 56 &&
          candidateHero.process.productSlugVisible &&
          candidateHero.tank.custodyVisible,
        nativeFrameDimensions:
          [
            ...districtStages,
            candidateHero,
            transferClose,
            pressureClose,
          ].every(
            ({ image }) =>
              image.width === 1920 &&
              image.height === 1080 &&
              image.bytes > 100_000 &&
              /^[a-f0-9]{64}$/.test(image.sha256),
          ),
        noBrowserErrors: errors.length === 0,
      };
      assert(
        Object.values(districtAssertions).every(Boolean),
        `PASS6 district lifecycle invariant failed: ${JSON.stringify(districtAssertions)}`,
      );
      districtLifecycle = {
        schema: "cinderline-fluid-pass6-low-angle-lifecycle-v1",
        nativeViewport: { width: 1920, height: 1080 },
        setup: districtSetup,
        assertions: districtAssertions,
        stages: districtStages,
        candidateHero,
        closeCaptures: [transferClose, pressureClose],
        browserErrors: errors,
      };
      await writeFile(
        `${outputDirectory}/district-lifecycle-proof.json`,
        `${JSON.stringify(districtLifecycle, null, 2)}\n`,
        "utf8",
      );

      const visualProofPath = `${outputDirectory}/visual-proof.json`;
      visualProof = JSON.parse(await readFile(visualProofPath, "utf8"));
      const heroRecord = visualProof.heroAndClose?.find(
        ({ file }) => file === "refinery-hero.png",
      );
      assert(
        heroRecord && visualProof.imageDigests,
        "PASS6 base visual proof is missing its hero digest record.",
      );
      Object.assign(heroRecord, {
        sha256: candidateHero.image.sha256,
        bytes: candidateHero.image.bytes,
        focus: {
          x: 8,
          z: 7.5,
          viewWidth: 16.2,
        },
        cameraFit: null,
        includedEntityCount:
          districtLifecycle.setup.fluidPlacements.length,
        districtFloorVisible: true,
        composition:
          "single-compact-connected-source-processor-receiver-chain-at-product-transfer",
        framing: candidateHero.framing,
      });
      visualProof.imageDigests["refinery-hero.png"] =
        candidateHero.image.sha256;
      visualProof.pass6CandidateHeroOverride = {
        source: "district-lifecycle-proof.json",
        lifecycleLabel: candidateHero.label,
        tickDelta: candidateHero.tickDelta,
        processStage: candidateHero.process.stageName,
        framing: candidateHero.framing,
        rationale:
          "Replaces the rejected sprawling overview with one complete compact connected chain.",
      };
      const prunedAlternateCompositions = [
        {
          file: "upper-header-close.png",
          rationale:
            "Rejected alternate crop crosses the top and bottom frame edges.",
        },
        {
          file: "processor-tanks-close.png",
          rationale:
            "Rejected alternate crop reads as two disconnected machine rows.",
        },
        {
          file: "tank-manifold-close.png",
          rationale:
            "Rejected alternate crop reads as a fragmented broad overview.",
        },
      ];
      for (const { file } of prunedAlternateCompositions) {
        await unlink(`${outputDirectory}/${file}`).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
        delete visualProof.imageDigests[file];
      }
      visualProof.heroAndClose = visualProof.heroAndClose.filter(
        ({ file }) =>
          !prunedAlternateCompositions.some(
            ({ file: prunedFile }) => prunedFile === file,
          ),
      );
      visualProof.pass6PrunedAlternateCompositions =
        prunedAlternateCompositions;
      await writeFile(
        visualProofPath,
        `${JSON.stringify(visualProof, null, 2)}\n`,
        "utf8",
      );

      const ordinaryErrors = [];
      const ordinaryPage = await browser.newPage({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        colorScheme: "dark",
      });
      ordinaryPage.on("pageerror", (error) =>
        ordinaryErrors.push(`pageerror: ${error.message}`),
      );
      ordinaryPage.on("console", (message) => {
        if (
          message.type() === "error" ||
          message.type() === "warning"
        ) {
          ordinaryErrors.push(
            `console-${message.type()}: ${message.text()}`,
          );
        }
      });
      await ordinaryPage.goto(
        `${baseUrl.replace(/\/$/, "")}/?fresh=fluid-pass6-ordinary-live&railFixture`,
        {
          waitUntil: "networkidle",
          timeout: 30_000,
        },
      );
      await ordinaryPage.waitForFunction(
        () =>
          document.querySelector("#boot")?.classList.contains("is-done") &&
          Boolean(window.__CINDERLINE__?.renderer),
        undefined,
        { timeout: 20_000 },
      );
      const ordinarySetup = await ordinaryPage.evaluate(() => {
        const game = window.__CINDERLINE__;
        if (!game) {
          throw new Error(
            "PASS6 ordinary gameplay bridge is unavailable.",
          );
        }
        const simulation = game.simulation;
        const world = game.renderer;
        for (const existing of [...simulation.getEntities()]) {
          simulation.remove(existing.x, existing.y);
        }
        simulation.drainEvents();
        const placements = [];
        const place = (kind, x, y, direction = 1, options = {}) => {
          const result = simulation.place(
            kind,
            x,
            y,
            direction,
            options,
          );
          if (!result.ok) {
            throw new Error(
              `PASS6 ordinary placement failed for ${kind} at ${x},${y}: ${result.reason}`,
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
        const source = place("fluidSource", 12, 20, 1, {
          fluidId: "crudeOil",
        });
        place("fluidPump", 14, 20, 1);
        place("fluidPipe", 15, 20, 1);
        place("fluidPipe", 16, 20, 1);
        const processor = place("fluidProcessor", 17, 19, 1, {
          fluidRecipeId: "refineCrude",
        });
        place("fluidPipe", 20, 20, 1);
        place("fluidPump", 21, 20, 1);
        place("fluidPipe", 22, 20, 1);
        const receiver = place("fluidTank", 23, 19, 1);
        for (const [x, y] of [
          [15, 18],
          [20, 17],
          [24, 18],
        ]) {
          place("gridRelay", x, y);
        }
        const generator = place("generator", 17, 16);
        const fueled = simulation.receive(
          generator.id,
          "coal",
          40,
          "fuel",
        );
        if (fueled !== 40) {
          throw new Error(
            "PASS6 ordinary gameplay generator did not fuel.",
          );
        }
        simulation.drainEvents();
        const preconditionTick =
          simulation.getRenderSnapshot().tick;
        simulation.step(1_560);
        simulation.drainEvents();

        // Use only ordinary public camera controls. The application RAF,
        // renderer sync method, HUD, floor, utilities, and generic machines
        // remain untouched and visible.
        world.focus(19, 21);
        world.zoom(-4);
        world.zoom(-1);
        game.selectEntity(null);
        game.refreshHUD();
        game.dismissToasts();
        window.__fluidPass6NativeRaf = window.requestAnimationFrame;
        window.__fluidPass6Ordinary = {
          sourceId: source.id,
          processorId: processor.id,
          receiverId: receiver.id,
          generatorId: generator.id,
          preconditionTick,
          placements,
        };
        window.__fluidPass6CollectOrdinaryState = () => {
          const bridge = window.__CINDERLINE__;
          const fixture = window.__fluidPass6Ordinary;
          if (!bridge || !fixture) {
            throw new Error(
              "PASS6 ordinary state collector is unavailable.",
            );
          }
          const renderer = bridge.renderer;
          const snapshot = bridge.simulation.getRenderSnapshot();
          const fluidRoot = renderer.fluidRenderer.root;
          fluidRoot.updateWorldMatrix(true, true);
          renderer.camera.updateMatrixWorld();
          const effectivelyVisible = (object) => {
            let current = object;
            while (current) {
              if (!current.visible) return false;
              current = current.parent;
            }
            return true;
          };
          let processorRig = null;
          let receiverRig = null;
          fluidRoot.traverse((object) => {
            if (
              object.name === "fluid-fluidProcessor-rig" &&
              object.userData.entityId === fixture.processorId
            ) {
              processorRig = object;
            }
            if (
              object.name === "fluid-fluidTank-rig" &&
              object.userData.entityId === fixture.receiverId
            ) {
              receiverRig = object;
            }
          });
          const processorEntity = snapshot.entities.find(
            ({ id }) => id === fixture.processorId,
          );
          const receiverEntity = snapshot.entities.find(
            ({ id }) => id === fixture.receiverId,
          );
          const sourceEntity = snapshot.entities.find(
            ({ id }) => id === fixture.sourceId,
          );
          const projectedBounds = {
            minX: Number.POSITIVE_INFINITY,
            maxX: Number.NEGATIVE_INFINITY,
            minY: Number.POSITIVE_INFINITY,
            maxY: Number.NEGATIVE_INFINITY,
          };
          let projectedMeshCount = 0;
          const excludedBoundsNames = [
            "irregular-stained-aggregate-service-yard",
            "localized-oil-and-rust-wear",
            "grounded-aggregate-and-maintenance-debris",
            "terrain-contact-staining",
          ];
          fluidRoot.traverseVisible((object) => {
            if (
              !object.isMesh ||
              !object.geometry ||
              excludedBoundsNames.some((name) =>
                object.name.includes(name),
              )
            ) {
              return;
            }
            let box = null;
            if (object.isInstancedMesh) {
              object.computeBoundingBox();
              box = object.boundingBox;
            } else {
              object.geometry.computeBoundingBox();
              box = object.geometry.boundingBox;
            }
            if (!box || box.isEmpty()) return;
            projectedMeshCount += 1;
            for (const x of [box.min.x, box.max.x]) {
              for (const y of [box.min.y, box.max.y]) {
                for (const z of [box.min.z, box.max.z]) {
                  const point = box.min
                    .clone()
                    .set(x, y, z)
                    .applyMatrix4(object.matrixWorld)
                    .project(renderer.camera);
                  const pixelX = (point.x * 0.5 + 0.5) * 1920;
                  const pixelY = (-point.y * 0.5 + 0.5) * 1080;
                  projectedBounds.minX = Math.min(
                    projectedBounds.minX,
                    pixelX,
                  );
                  projectedBounds.maxX = Math.max(
                    projectedBounds.maxX,
                    pixelX,
                  );
                  projectedBounds.minY = Math.min(
                    projectedBounds.minY,
                    pixelY,
                  );
                  projectedBounds.maxY = Math.max(
                    projectedBounds.maxY,
                    pixelY,
                  );
                }
              }
            }
          });
          const hud = document.querySelector("#hud");
          const hudStyle =
            hud instanceof HTMLElement
              ? getComputedStyle(hud)
              : null;
          const hudRect =
            hud instanceof HTMLElement
              ? hud.getBoundingClientRect()
              : null;
          const districtFloor = fluidRoot.getObjectByName(
            "fluid-refinery-district-service-floor-system",
          );
          const genericVisibleKinds = [];
          const fixtureBounds = { ...projectedBounds };
          let fixtureProjectedObjectCount = projectedMeshCount;
          const projectFixtureTree = (root) => {
            root.updateWorldMatrix(true, true);
            root.traverseVisible((object) => {
              if (
                (!object.isMesh && !object.isLine) ||
                !object.geometry
              ) {
                return;
              }
              let box = null;
              if (object.isInstancedMesh) {
                object.computeBoundingBox();
                box = object.boundingBox;
              } else {
                object.geometry.computeBoundingBox();
                box = object.geometry.boundingBox;
              }
              if (!box || box.isEmpty()) return;
              fixtureProjectedObjectCount += 1;
              for (const x of [box.min.x, box.max.x]) {
                for (const y of [box.min.y, box.max.y]) {
                  for (const z of [box.min.z, box.max.z]) {
                    const point = box.min
                      .clone()
                      .set(x, y, z)
                      .applyMatrix4(object.matrixWorld)
                      .project(renderer.camera);
                    const pixelX = (point.x * 0.5 + 0.5) * 1920;
                    const pixelY = (-point.y * 0.5 + 0.5) * 1080;
                    fixtureBounds.minX = Math.min(
                      fixtureBounds.minX,
                      pixelX,
                    );
                    fixtureBounds.maxX = Math.max(
                      fixtureBounds.maxX,
                      pixelX,
                    );
                    fixtureBounds.minY = Math.min(
                      fixtureBounds.minY,
                      pixelY,
                    );
                    fixtureBounds.maxY = Math.max(
                      fixtureBounds.maxY,
                      pixelY,
                    );
                  }
                }
              }
            });
          };
          for (const rig of renderer.entityObjects.values()) {
            if (effectivelyVisible(rig.root)) {
              genericVisibleKinds.push(rig.kind);
              projectFixtureTree(rig.root);
            }
          }
          let visiblePowerGridMeshes = 0;
          renderer.powerGridRoot.traverseVisible((object) => {
            if (object.isMesh || object.isLine) {
              visiblePowerGridMeshes += 1;
            }
          });
          projectFixtureTree(renderer.powerGridRoot);
          const receiverBuffer =
            receiverEntity?.fluidState?.buffer ?? null;
          const receiverFillRatio =
            receiverBuffer && receiverBuffer.capacityMilli > 0
              ? receiverBuffer.amountMilli /
                receiverBuffer.capacityMilli
              : 0;
          const processorInputAmount =
            processorEntity?.fluidState?.input?.amountMilli ?? 0;
          const authoritativeLifecycleBand =
            processorEntity?.status === "outputFull" ||
            receiverFillRatio >= 0.9
              ? "storage-backpressure"
              : processorEntity?.status === "working" &&
                  receiverFillRatio >= 0.25
                ? "product-transfer"
                : processorEntity?.status === "working"
                  ? "fired-fractionation"
                  : processorInputAmount > 0
                    ? "crude-feed-primed"
                    : "cold-and-empty";
          return {
            tick: snapshot.tick,
            elapsedSeconds: snapshot.elapsedSeconds,
            documentVisibilityState: document.visibilityState,
            authoritativeLifecycleBand,
            source: {
              id: sourceEntity?.id ?? null,
              status: sourceEntity?.status ?? null,
            },
            processor: {
              id: processorEntity?.id ?? null,
              status: processorEntity?.status ?? null,
              stage: Number(processorRig?.userData.processStage ?? -1),
              stageName:
                processorRig?.userData.processStageName ?? null,
              inputAmountMilli:
                processorEntity?.fluidState?.input?.amountMilli ?? null,
              outputAmountMilli:
                processorEntity?.fluidState?.output?.amountMilli ?? null,
            },
            receiver: {
              id: receiverEntity?.id ?? null,
              status: receiverEntity?.status ?? null,
              amountMilli: receiverBuffer?.amountMilli ?? null,
              capacityMilli: receiverBuffer?.capacityMilli ?? null,
              fillRatio: receiverFillRatio,
              presentationState:
                receiverRig?.userData.pressureMechanismState ?? null,
            },
            renderer: {
              worldRootVisible: renderer.worldRoot.visible,
              groundVisible:
                Boolean(renderer.ground) &&
                effectivelyVisible(renderer.ground),
              infrastructureRootVisible:
                renderer.infrastructureRoot.visible,
              entityRootVisible: renderer.entityRoot.visible,
              powerGridRootVisible: renderer.powerGridRoot.visible,
              fluidRootVisible: fluidRoot.visible,
              districtFloorVisible:
                Boolean(districtFloor) &&
                effectivelyVisible(districtFloor),
              genericVisibleRigCount: genericVisibleKinds.length,
              genericVisibleKinds,
              visiblePowerGridMeshes,
              viewWidth: renderer.viewWidth,
              worldSyncOwnProperty: Object.hasOwn(
                renderer,
                "sync",
              ),
              worldSyncSource:
                Function.prototype.toString.call(renderer.sync),
            },
            runtime: {
              requestAnimationFrameIdentityStable:
                window.requestAnimationFrame ===
                window.__fluidPass6NativeRaf,
              requestAnimationFrameSource:
                Function.prototype.toString.call(
                  window.requestAnimationFrame,
                ),
            },
            hud: {
              exists: Boolean(hud),
              inlineDisplay:
                hud instanceof HTMLElement
                  ? hud.style.display
                  : null,
              computedDisplay: hudStyle?.display ?? null,
              computedVisibility: hudStyle?.visibility ?? null,
              width: hudRect?.width ?? 0,
              height: hudRect?.height ?? 0,
              childElementCount:
                hud instanceof HTMLElement
                  ? hud.querySelectorAll("*").length
                  : 0,
              activeToastCount:
                hud instanceof HTMLElement
                  ? hud.querySelectorAll("[data-toast-id]").length
                  : 0,
            },
            canvas: {
              width: renderer.renderer.domElement.width,
              height: renderer.renderer.domElement.height,
              clientWidth: renderer.renderer.domElement.clientWidth,
              clientHeight:
                renderer.renderer.domElement.clientHeight,
            },
            framing: {
              projectedMeshCount,
              projectedBoundsPixels: projectedBounds,
              minimumSafeMarginPixels: Math.min(
                projectedBounds.minX,
                1920 - projectedBounds.maxX,
                projectedBounds.minY,
                1080 - projectedBounds.maxY,
              ),
            },
            completeFixtureFraming: {
              projectedObjectCount: fixtureProjectedObjectCount,
              projectedBoundsPixels: fixtureBounds,
              minimumSafeMarginPixels: Math.min(
                fixtureBounds.minX,
                1920 - fixtureBounds.maxX,
                fixtureBounds.minY,
                1080 - fixtureBounds.maxY,
              ),
            },
            debug: renderer.fluidRenderer.getDebug(),
          };
        };
        return {
          sourceId: source.id,
          processorId: processor.id,
          receiverId: receiver.id,
          generatorId: generator.id,
          preconditionTick,
          preconditionAdvanceTicks: 1_560,
          placements,
        };
      });
      // The fluid gauges and stage presentation ease toward the authoritative
      // snapshot over native application frames. Wait for that visible
      // presentation to reach product transfer instead of assuming a fixed
      // wall-time is sufficient on a busy browser host.
      await ordinaryPage.waitForFunction(
        () =>
          window.__fluidPass6CollectOrdinaryState?.().processor
            .stageName === "product-transfer",
        undefined,
        { timeout: 5_000 },
      );
      const ordinaryVisibleProductTransferGate =
        await ordinaryPage.evaluate(() =>
          window.__fluidPass6CollectOrdinaryState(),
        );
      await ordinaryPage.waitForTimeout(32);
      const ordinaryBefore = await ordinaryPage.evaluate(() =>
        window.__fluidPass6CollectOrdinaryState(),
      );
      await ordinaryPage.waitForTimeout(360);
      const ordinaryAdvanced = await ordinaryPage.evaluate(() =>
        window.__fluidPass6CollectOrdinaryState(),
      );
      await ordinaryPage.evaluate(() => {
        window.__CINDERLINE__?.dismissToasts();
      });
      await ordinaryPage.waitForFunction(
        () =>
          document.querySelectorAll(
            "#hud [data-toast-id]",
          ).length === 0,
        undefined,
        { timeout: 2_000 },
      );
      const ordinaryFullBuffer = await ordinaryPage.screenshot({
        path: `${outputDirectory}/ordinary-full-hud-gameplay.png`,
        fullPage: false,
      });
      const ordinaryAfterFull = await ordinaryPage.evaluate(() =>
        window.__fluidPass6CollectOrdinaryState(),
      );
      const pureCanvasCapture = await ordinaryPage.evaluate(async () => {
        const game = window.__CINDERLINE__;
        if (!game) {
          throw new Error(
            "PASS6 ordinary pure-canvas bridge is unavailable.",
          );
        }
        const hud = document.querySelector("#hud");
        const previousHudVisibility =
          hud instanceof HTMLElement
            ? hud.style.visibility
            : null;
        if (hud instanceof HTMLElement) {
          hud.style.visibility = "hidden";
        }
        // Let Chrome de-occlude the backing WebGL surface that normally sits
        // beneath opaque HUD panels, then read the exact native canvas. The
        // HUD is restored before collecting post-capture state.
        await new Promise((resolve) =>
          window.requestAnimationFrame(() => resolve()),
        );
        game.renderer.render(0);
        game.renderer.renderer.getContext().finish();
        const dataUrl =
          game.renderer.renderer.domElement.toDataURL("image/png");
        if (
          hud instanceof HTMLElement &&
          previousHudVisibility !== null
        ) {
          hud.style.visibility = previousHudVisibility;
        }
        return {
          dataUrl,
          state: window.__fluidPass6CollectOrdinaryState(),
          captureIsolation: {
            method:
              "one-native-raf-deocclusion-with-momentary-hud-visibility-restore",
            hudVisibilityBefore: previousHudVisibility,
            hudVisibilityAfter:
              hud instanceof HTMLElement
                ? hud.style.visibility
                : null,
          },
        };
      });
      const ordinaryCanvasBuffer = Buffer.from(
        pureCanvasCapture.dataUrl.replace(
          /^data:image\/png;base64,/,
          "",
        ),
        "base64",
      );
      await writeFile(
        `${outputDirectory}/ordinary-pure-canvas-match.png`,
        ordinaryCanvasBuffer,
      );
      const ordinaryAfterCanvas = pureCanvasCapture.state;
      const ordinaryFullDimensions =
        pngDimensions(ordinaryFullBuffer);
      const ordinaryCanvasDimensions =
        pngDimensions(ordinaryCanvasBuffer);
      const fullImage = {
        file: "ordinary-full-hud-gameplay.png",
        ...ordinaryFullDimensions,
        bytes: ordinaryFullBuffer.byteLength,
        sha256: digest(ordinaryFullBuffer),
        tick: ordinaryAfterFull.tick,
      };
      const canvasImage = {
        file: "ordinary-pure-canvas-match.png",
        ...ordinaryCanvasDimensions,
        bytes: ordinaryCanvasBuffer.byteLength,
        sha256: digest(ordinaryCanvasBuffer),
        tick: ordinaryAfterCanvas.tick,
      };
      const ordinaryAssertions = {
        applicationRafAdvancesSimulation:
          ordinaryAdvanced.tick - ordinaryBefore.tick >= 4,
        requestAnimationFrameIsUnmodified:
          ordinaryBefore.runtime
            .requestAnimationFrameIdentityStable &&
          ordinaryAdvanced.runtime
            .requestAnimationFrameIdentityStable &&
          ordinaryAdvanced.runtime.requestAnimationFrameSource.includes(
            "[native code]",
          ),
        rendererSyncIsUnpatched:
          !ordinaryBefore.renderer.worldSyncOwnProperty &&
          !ordinaryAdvanced.renderer.worldSyncOwnProperty,
        ordinaryHudIsVisible:
          ordinaryAdvanced.hud.exists &&
          ordinaryAdvanced.hud.inlineDisplay !== "none" &&
          ordinaryAdvanced.hud.computedDisplay !== "none" &&
          ordinaryAdvanced.hud.computedVisibility === "visible" &&
          ordinaryAdvanced.hud.width === 1920 &&
          ordinaryAdvanced.hud.height === 1080 &&
          ordinaryAdvanced.hud.childElementCount > 20 &&
          ordinaryAfterFull.hud.activeToastCount === 0 &&
          ordinaryAfterCanvas.hud.activeToastCount === 0,
        ordinaryFloorUtilitiesAndGenericInfrastructureVisible:
          ordinaryAdvanced.renderer.worldRootVisible &&
          ordinaryAdvanced.renderer.groundVisible &&
          ordinaryAdvanced.renderer.infrastructureRootVisible &&
          ordinaryAdvanced.renderer.entityRootVisible &&
          ordinaryAdvanced.renderer.powerGridRootVisible &&
          ordinaryAdvanced.renderer.fluidRootVisible &&
          ordinaryAdvanced.renderer.districtFloorVisible &&
          ordinaryAdvanced.renderer.genericVisibleRigCount >= 1 &&
          ordinaryAdvanced.renderer.genericVisibleKinds.includes(
            "generator",
          ) &&
          ordinaryAdvanced.renderer.visiblePowerGridMeshes > 0,
        ordinaryFrameContainsCompleteFluidChain:
          ordinaryAdvanced.debug.sources === 1 &&
          ordinaryAdvanced.debug.processors === 1 &&
          ordinaryAdvanced.debug.tanks === 1 &&
          ordinaryAdvanced.debug.pumps === 2 &&
          ordinaryAdvanced.debug.pipes === 4 &&
          ordinaryAdvanced.framing.projectedMeshCount > 0 &&
          ordinaryAdvanced.framing.minimumSafeMarginPixels >= 48 &&
          ordinaryAdvanced.completeFixtureFraming
            .projectedObjectCount >
            ordinaryAdvanced.framing.projectedMeshCount &&
          ordinaryAdvanced.completeFixtureFraming
            .minimumSafeMarginPixels >= 64,
        ordinaryStateIsProductTransfer:
          ordinaryVisibleProductTransferGate.processor.stageName ===
            "product-transfer" &&
          ordinaryAdvanced.authoritativeLifecycleBand ===
            "product-transfer" &&
          ordinaryAdvanced.receiver.fillRatio > 0.25 &&
          ordinaryAdvanced.receiver.fillRatio < 0.9,
        matchedPairRemainsSameLifecycleState:
          ordinaryAfterFull.authoritativeLifecycleBand ===
            "product-transfer" &&
          ordinaryAfterFull.authoritativeLifecycleBand ===
            ordinaryAfterCanvas.authoritativeLifecycleBand &&
          ordinaryAfterFull.processor.id ===
            ordinaryAfterCanvas.processor.id &&
          ordinaryAfterFull.receiver.id ===
            ordinaryAfterCanvas.receiver.id &&
          ordinaryAfterCanvas.tick - ordinaryAfterFull.tick <= 40 &&
          Math.abs(
            ordinaryAfterCanvas.receiver.fillRatio -
              ordinaryAfterFull.receiver.fillRatio,
          ) <= 0.03 &&
          ordinaryAfterCanvas.hud.computedVisibility === "visible" &&
          pureCanvasCapture.captureIsolation.hudVisibilityAfter ===
            pureCanvasCapture.captureIsolation.hudVisibilityBefore,
        nativeFrameDimensions:
          fullImage.width === 1920 &&
          fullImage.height === 1080 &&
          canvasImage.width === 1920 &&
          canvasImage.height === 1080 &&
          fullImage.bytes > 100_000 &&
          canvasImage.bytes > 100_000,
        noBrowserErrorsOrWarnings: ordinaryErrors.length === 0,
      };
      assert(
        Object.values(ordinaryAssertions).every(Boolean),
        `PASS6 ordinary gameplay invariant failed: ${JSON.stringify({
          assertions: ordinaryAssertions,
          samples: {
            visibleProductTransferGate:
              ordinaryVisibleProductTransferGate,
            before: ordinaryBefore,
            advanced: ordinaryAdvanced,
            afterFull: ordinaryAfterFull,
            afterCanvas: ordinaryAfterCanvas,
          },
        })}`,
      );
      ordinaryLiveGameplay = {
        schema: "cinderline-fluid-pass6-ordinary-live-gameplay-v1",
        nativeViewport: { width: 1920, height: 1080 },
        setup: ordinarySetup,
        assertions: ordinaryAssertions,
        tickAdvanceSample: {
          before: ordinaryBefore.tick,
          after: ordinaryAdvanced.tick,
          delta: ordinaryAdvanced.tick - ordinaryBefore.tick,
          wallMilliseconds: 360,
        },
        captureContinuity: {
          visibleProductTransferGate:
            ordinaryVisibleProductTransferGate,
          beforeFull: ordinaryBefore,
          afterFull: ordinaryAfterFull,
          afterCanvas: ordinaryAfterCanvas,
          tickGap:
            ordinaryAfterCanvas.tick - ordinaryAfterFull.tick,
          receiverFillRatioDelta:
            ordinaryAfterCanvas.receiver.fillRatio -
            ordinaryAfterFull.receiver.fillRatio,
          pureCanvasIsolation:
            pureCanvasCapture.captureIsolation,
        },
        images: [fullImage, canvasImage],
        browserErrorsOrWarnings: ordinaryErrors,
      };
      await writeFile(
        `${outputDirectory}/live-gameplay-proof.json`,
        `${JSON.stringify(ordinaryLiveGameplay, null, 2)}\n`,
        "utf8",
      );
      await ordinaryPage.close();

      const formativeAssertions = {
        exactFixedTickLifecycle:
          districtLifecycle.assertions.exactFixedTickSchedule &&
          visualProof.stages
            .map(({ tickDelta }) => tickDelta)
            .join(",") === "0,20,360,1560,9960",
        exactMassConservedAtEveryAuthoritativeStage:
          visualProof.stages.every(
            ({ authoritative }) =>
              authoritative.exactMassConserved === true,
          ),
        sourceMechanismCompleteAndSafelyFramed:
          proof.assertions.completeVisibleLoadChain &&
          proof.assertions
            .mechanismSafeMarginsAtBothWorkingExtrema,
        lifecycleCausalityAndMechanicalPressure:
          districtLifecycle.assertions.feedThenProductCausality &&
          districtLifecycle.assertions.oneRestrainedRelief &&
          districtLifecycle.assertions.receiverCustodyRises &&
          districtLifecycle.assertions
            .firedToTransferCustodyDeltaIsReadable &&
          districtLifecycle.assertions.tankPressureIsMechanical &&
          districtLifecycle.assertions
            .processorPressureIsMechanical,
        compactCandidateHeroReplacesSprawlingBaseHero:
          visualProof.imageDigests["refinery-hero.png"] ===
            districtLifecycle.candidateHero.image.sha256 &&
          visualProof.pass6CandidateHeroOverride.tickDelta ===
            1_560 &&
          districtLifecycle.assertions
            .candidateHeroHasCompleteSafeConnectedComposition,
        ordinaryGameplayAndPureCanvasPair:
          Object.values(
            ordinaryLiveGameplay.assertions,
          ).every(Boolean),
        noBrowserErrorsOrWarnings:
          errors.length === 0 &&
          visualProof.errors.length === 0 &&
          ordinaryErrors.length === 0,
        performanceEvidenceUnderCeiling:
          visualProof.performance.high.p95Milliseconds <
            visualProof.performance
              .evidenceCeilingMilliseconds &&
          visualProof.performance.performanceMode.p95Milliseconds <
            visualProof.performance
              .evidenceCeilingMilliseconds,
      };
      assert(
        Object.values(formativeAssertions).every(Boolean),
        `PASS6 formative proof invariant failed: ${JSON.stringify(formativeAssertions)}`,
      );
      const formativeProof = {
        schema: "cinderline-fluid-pass6-formative-recovery-v1",
        status: "formative-builder-evidence-only",
        outputDirectory,
        assertions: formativeAssertions,
        fixedTickSchedule: [0, 20, 360, 1_560, 9_960],
        proofFiles: {
          visual: "visual-proof.json",
          sourceMechanism: "source-mechanism-proof.json",
          districtLifecycle: "district-lifecycle-proof.json",
          ordinaryLiveGameplay: "live-gameplay-proof.json",
        },
        candidateHero:
          districtLifecycle.candidateHero.image,
        ordinaryPair: ordinaryLiveGameplay.images,
        performance: visualProof.performance,
      };
      await writeFile(
        `${outputDirectory}/formative-proof.json`,
        `${JSON.stringify(formativeProof, null, 2)}\n`,
        "utf8",
      );
      await writeFile(
        `${outputDirectory}/BUILDER-HANDOFF.md`,
        [
          "# Fluid Pass 6 formative builder handoff",
          "",
          "Status: builder evidence only; no staging, sealing, or final quality claim.",
          "",
          "Primary review order:",
          "",
          "1. `ordinary-full-hud-gameplay.png` and `ordinary-pure-canvas-match.png` — matched live application/canvas pair with the HUD, floor, utilities, generic generator, and unpatched RAF/sync verified in `live-gameplay-proof.json`.",
          "2. `refinery-hero.png` — compact connected source → processor → receiver chain at the fixed product-transfer tick.",
          "3. `district-phase-02-fired.png`, `district-phase-03-transfer.png`, and `district-phase-04-pressure.png` — visible fired/transfer/pressure differences.",
          "4. `pumpjack-active-up-close.png` and `pumpjack-active-down-close.png` — complete working extrema with measured safe margins.",
          "",
          "Machine-readable aggregation: `formative-proof.json`.",
          "",
          "Authoritative lifecycle schedule remains 0, 20, 360, 1560, 9960 ticks. The base visual proof records exact mass conservation at every stage. Browser warnings and errors are treated as failures.",
          "",
        ].join("\n"),
        "utf8",
      );
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          sourceProof: `${outputDirectory}/source-mechanism-proof.json`,
          measurements: proof.measurements,
          assertions,
          images: proof.captures.map(({ image }) => image),
          ...(districtLifecycle
            ? {
                districtProof:
                  `${outputDirectory}/district-lifecycle-proof.json`,
                districtAssertions: districtLifecycle.assertions,
                districtImages: [
                  ...districtLifecycle.stages,
                  districtLifecycle.candidateHero,
                  ...districtLifecycle.closeCaptures,
                ].map(({ image }) => image),
                ordinaryGameplayProof:
                  `${outputDirectory}/live-gameplay-proof.json`,
                ordinaryGameplayAssertions:
                  ordinaryLiveGameplay?.assertions ?? null,
                formativeProof:
                  `${outputDirectory}/formative-proof.json`,
              }
            : {}),
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

if (exitCode !== 0) process.exitCode = exitCode;
