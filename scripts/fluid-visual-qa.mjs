import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY = ".qa/fluid-network";
const HERO_PREVIEW_ONLY =
  process.env.CINDERLINE_FLUID_HERO_PREVIEW_ONLY === "1";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
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
  await page.goto(`${BASE_URL.replace(/\/$/, "")}/?fresh=fluid-visual-qa-v4`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#boot")?.classList.contains("is-done") &&
      Boolean(window.__CINDERLINE__?.renderer),
    undefined,
    { timeout: 20_000 },
  );

  // Freeze the normal animation loop. Every stage below advances only through
  // the real fixed-step simulation call recorded in the proof.
  await page.keyboard.press("Space");

  const setup = await page.evaluate(async () => {
    const game = window.__CINDERLINE__;
    if (!game) throw new Error("Cinderline debug bridge is unavailable.");
    const world = game.renderer;
    const simulation = game.simulation;
    window.__fluidQaAdapt = (snapshot) => ({
      tick: snapshot.tick,
      elapsed: snapshot.elapsedSeconds,
      bounds: {
        minX: 0,
        minZ: 0,
        maxX: snapshot.width,
        maxZ: snapshot.height,
      },
      entities: [],
      resources: [],
      beltItems: [],
      fluid: snapshot.fluid,
      fluidNetwork: snapshot.fluidNetwork,
      fluidEntities: snapshot.entities
        .filter(
          (entity) =>
            entity.kind.startsWith("fluid") &&
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
      circuit: snapshot.circuit,
      circuitEntities: [],
      rail: snapshot.rail,
      powerGrid: {
        mode:
          snapshot.powerGrid.mode === "legacyGlobal" ? "global" : "local",
        halfExtent: snapshot.powerGrid.supplyHalfExtentTiles,
        cableReach: snapshot.powerGrid.cableReachTiles,
        relayCenters: [],
        relayLinks: [],
      },
    });
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
          `Real fluid fixture placement failed for ${kind} at ${x},${y}: ${result.reason}`,
        );
      }
      placements.push({
        id: result.entity.id,
        kind: result.entity.kind,
        x: result.entity.x,
        y: result.entity.y,
        direction: result.entity.direction,
      });
      return result.entity;
    };

    // North proof train: one compact, literal extraction → pump →
    // fractionation → receiving-tank custody path. The lifecycle camera locks
    // to this chain; the larger south process field belongs to the wide hero.
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
    const lifecycleEntityIds = placements.map(({ id }) => id);

    // Hero network A is the upper eastbound process train. Its main header,
    // fractionator, custody vessel, and north buffer branch all occupy one
    // compact process court; every visible branch remains a real connection.
    const westSource = place("fluidSource", 14, 11, 1, {
      fluidId: "crudeOil",
    });
    place("fluidPump", 16, 11, 1);
    place("fluidPipe", 17, 11, 1);
    const westProcessor = place("fluidProcessor", 18, 10, 1, {
      fluidRecipeId: "refineCrude",
    });
    place("fluidPipe", 21, 11, 1);
    place("fluidPump", 22, 11, 1);
    place("fluidPipe", 23, 11, 1);
    place("fluidTank", 24, 10, 1);
    place("fluidPipe", 23, 10, 0);
    place("fluidTank", 22, 7, 0);

    // Hero network B approaches the same court from the east. Reversing its
    // process direction interleaves two fractionators with four structurally
    // distinct vessels instead of creating a second distant demo island.
    const heroBPlacementStart = placements.length;
    const northBankSource = place("fluidSource", 32, 14, 3, {
      fluidId: "crudeOil",
    });
    place("fluidPump", 31, 14, 3);
    place("fluidPipe", 30, 14, 3);
    place("fluidPipe", 29, 14, 3);
    const northboundProcessor = place("fluidProcessor", 26, 13, 3, {
      fluidRecipeId: "refineCrude",
    });
    place("fluidPipe", 25, 14, 3);
    place("fluidPump", 24, 14, 3);
    place("fluidPipe", 23, 14, 3);
    place("fluidPipe", 30, 13, 0);
    place("fluidTank", 20, 13, 3);
    place("fluidPipe", 23, 15, 2);
    place("fluidPump", 30, 12, 0);
    place("fluidPipe", 30, 11, 0);
    place("fluidTank", 22, 16, 2);
    place("fluidPipe", 30, 10, 0);
    place("fluidPump", 30, 9, 0);
    place("fluidPipe", 30, 8, 0);
    place("fluidPipe", 31, 11, 1);
    place("fluidPump", 32, 11, 1);
    place("fluidPipe", 33, 11, 1);
    const heroBEntityIds = placements
      .slice(heroBPlacementStart)
      .map(({ id }) => id);
    const heroCoreEntityIds = placements
      .slice(heroBPlacementStart)
      .filter(({ kind, x }) => kind === "fluidProcessor" || x >= 29)
      .map(({ id }) => id);
    const heroMainlineEntityIds = placements
      .slice(heroBPlacementStart)
      .filter(
        ({ kind, x, y }) =>
          kind === "fluidProcessor" || (y === 14 && x >= 29),
      )
      .map(({ id }) => id);
    const upperBranchEntityIds = placements
      .slice(heroBPlacementStart)
      .filter(
        ({ x, y }) =>
          (x === 30 && y >= 8 && y <= 14) ||
          (y === 11 && x >= 31 && x <= 33),
      )
      .map(({ id }) => id);

    // Local power is fully real, but its long wire overlay is hidden in the
    // visual proof so it cannot masquerade as fluid connectivity.
    const utilityCenters = [
      [3, 5],
      [10, 3],
      [3, 11],
      [9, 14],
      [5, 20],
      [23, 5],
      [18, 7],
      [27, 20],
      [29, 10],
      [28, 8],
      [32, 5],
      [36, 9],
      [36, 14],
      [36, 20],
    ];
    window.__fluidQaUtilityCenters = utilityCenters.map(([x, y]) => [
      x + 0.5,
      y + 0.5,
    ]);
    for (const [x, y] of utilityCenters) {
      place("gridRelay", x, y);
    }
    const generator = place("generator", 35, 3);
    const reserveGenerator = place("generator", 0, 22);
    for (const powerSource of [generator, reserveGenerator]) {
      const fueled = simulation.receive(powerSource.id, "coal", 40, "fuel");
      if (fueled !== 40) {
        throw new Error("Fluid fixture generator did not fuel.");
      }
    }
    simulation.drainEvents();

    window.__fluidQaIncludedEntityIds = null;
    window.__fluidQaShowDistrictFloor = false;
    const snapshot = simulation.getRenderSnapshot();
    world.sync(window.__fluidQaAdapt(snapshot));
    world.setSelected(null);
    const hideUtilities = () => {
      world.powerGridRoot.visible = false;
      world.infrastructureRoot.visible = false;
      world.effectsRoot.visible = false;
      world.itemRoot.visible = false;
      world.overlayRoot.visible = false;
      world.powerGridRoot.traverse((object) => {
        object.visible = false;
        object.layers.set(31);
      });
      world.gridRelayPerformance.root.traverse((object) => {
        object.visible = false;
        object.layers.set(31);
      });
      world.gridRelayPerformance.root.visible = false;
      for (const rig of world.entityObjects.values()) {
        rig.root.visible = false;
        rig.root.traverse((object) => {
          object.visible = false;
          object.layers.set(31);
        });
      }
      for (const child of world.entityRoot.children) {
        child.visible = child === world.fluidRenderer.root;
        if (child !== world.fluidRenderer.root) {
          child.traverse((object) => {
            object.visible = false;
            object.layers.set(31);
          });
        }
      }
      world.scene.traverse((object) => {
        if (
          object.name.startsWith("gridRelay-") ||
          object.name.includes("grid-relay") ||
          object.name.startsWith("generator-") ||
          object.name === "local-power-grid" ||
          object.userData?.entityKind === "gridRelay"
        ) {
          object.visible = false;
        }
      });
      const belongsToFluid = (object) => {
        let current = object;
        while (current) {
          if (current === world.fluidRenderer.root) return true;
          current = current.parent;
        }
        return false;
      };
      world.scene.traverse((object) => {
        if (
          object === world.ground ||
          object === world.fluidRenderer.root ||
          belongsToFluid(object)
        ) {
          return;
        }
        const atUtilityCenter = window.__fluidQaUtilityCenters?.some(
          ([x, z]) =>
            Math.abs(object.position.x - x) < 0.16 &&
            Math.abs(object.position.z - z) < 0.16,
        );
        if (atUtilityCenter) {
          object.visible = false;
          object.layers.set(31);
        }
      });
      world.fluidRenderer.root.visible = true;
      world.fluidRenderer.root.traverse((object) => {
        object.layers.set(0);
      });
      const district = world.fluidRenderer.root.getObjectByName(
        "fluid-refinery-district-service-floor-system",
      );
      const showDistrict = Boolean(window.__fluidQaShowDistrictFloor);
      if (district) {
        district.visible = showDistrict;
      }
      const legacyPipeSupports = world.fluidRenderer.root.getObjectByName(
        "fluid-pipe-load-bearing-saddles",
      );
      if (legacyPipeSupports) {
        legacyPipeSupports.visible = !showDistrict;
      }
      const legacyCouplings = world.fluidRenderer.root.getObjectByName(
        "fluid-network-coupling-hoses",
      );
      if (legacyCouplings) {
        legacyCouplings.visible = !showDistrict;
      }
      world.fluidRenderer.root.traverse((object) => {
        if (!object.name.startsWith("fluid-tank-family-")) return;
        let family = object;
        while (
          family.parent &&
          typeof family.userData.finishVariantIndex !== "number"
        ) {
          family = family.parent;
        }
        let rig = family;
        while (
          rig.parent &&
          typeof rig.userData.finishVariant !== "number"
        ) {
          rig = rig.parent;
        }
        object.visible =
          showDistrict &&
          typeof family.userData.finishVariantIndex === "number" &&
          family.userData.finishVariantIndex ===
            rig.userData.structuralVariant;
      });
      world.fluidRenderer.root.traverse((rig) => {
        const entityKind = rig.userData.entityKind;
        if (
          entityKind !== "fluidSource" &&
          entityKind !== "fluidPump" &&
          entityKind !== "fluidProcessor" &&
          entityKind !== "fluidTank"
        ) {
          return;
        }
        const structuralVariant = Number(
          rig.userData.structuralVariant ?? 1,
        );
        rig.traverse((object) => {
          if (object === rig) return;
          let family = object;
          while (
            family.parent &&
            family.parent !== rig &&
            typeof family.userData.finishVariantIndex !== "number"
          ) {
            family = family.parent;
          }
          const inTankFamily =
            typeof family.userData.finishVariantIndex === "number";
          if (
            showDistrict &&
            entityKind === "fluidTank" &&
            structuralVariant !== 1 &&
            !inTankFamily
          ) {
            object.visible = false;
            return;
          }
          if (
            showDistrict &&
            entityKind !== "fluidTank" &&
            (object.name.endsWith("-foundation") ||
              object.name.includes("-service-deck") ||
              object.name.includes("load-spreading-pier") ||
              object.name.includes("deck-hazard-marker") ||
              object.name.includes("localized-deck-grime") ||
              object.name.includes("foundation-anchor") ||
              object.name.includes("terrain-contact-staining"))
          ) {
            object.visible = false;
          }
        });
      });
    };
    window.__fluidQaHideUtilities = hideUtilities;
    hideUtilities();
    window.__fluidQaFitHeroCamera = (paddingRatio = 0.1) => {
      const fluidRoot = world.fluidRenderer.root;
      const camera = world.camera;
      fluidRoot.updateWorldMatrix(true, true);
      camera.updateMatrixWorld(true);

      const right = camera.up
        .clone()
        .set(1, 0, 0)
        .applyQuaternion(camera.quaternion)
        .normalize();
      const up = camera.up
        .clone()
        .applyQuaternion(camera.quaternion)
        .normalize();
      const projected = {
        minX: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
      };
      const excludedBoundsNames = [
        "irregular-stained-aggregate-service-yard",
        "localized-oil-and-rust-wear",
        "grounded-aggregate-and-maintenance-debris",
        "terrain-contact-staining",
      ];
      let boundedMeshes = 0;
      fluidRoot.traverseVisible((object) => {
        if (
          !object.isMesh ||
          !object.geometry ||
          excludedBoundsNames.some((name) => object.name.includes(name))
        ) {
          return;
        }
        let localBox;
        if (object.isInstancedMesh) {
          object.computeBoundingBox();
          localBox = object.boundingBox;
        } else {
          object.geometry.computeBoundingBox();
          localBox = object.geometry.boundingBox;
        }
        if (!localBox || localBox.isEmpty()) return;
        boundedMeshes += 1;
        for (const x of [localBox.min.x, localBox.max.x]) {
          for (const y of [localBox.min.y, localBox.max.y]) {
            for (const z of [localBox.min.z, localBox.max.z]) {
              const corner = localBox.min
                .clone()
                .set(x, y, z)
                .applyMatrix4(object.matrixWorld);
              const projectedX = corner.dot(right);
              const projectedY = corner.dot(up);
              projected.minX = Math.min(projected.minX, projectedX);
              projected.maxX = Math.max(projected.maxX, projectedX);
              projected.minY = Math.min(projected.minY, projectedY);
              projected.maxY = Math.max(projected.maxY, projectedY);
            }
          }
        }
      });
      if (
        boundedMeshes === 0 ||
        !Object.values(projected).every(Number.isFinite)
      ) {
        throw new Error("Hero camera fit found no visible fluid geometry.");
      }

      const centerX = (projected.minX + projected.maxX) * 0.5;
      const centerY = (projected.minY + projected.maxY) * 0.5;
      const determinant = right.x * up.z - right.z * up.x;
      if (Math.abs(determinant) < 0.0001) {
        throw new Error("Hero camera basis cannot solve a ground-plane focus.");
      }
      const focusX =
        (centerX * up.z - right.z * centerY) / determinant;
      const focusZ =
        (right.x * centerY - centerX * up.x) / determinant;
      const width = projected.maxX - projected.minX;
      const height = projected.maxY - projected.minY;
      const canvasWidth = Math.max(
        1,
        world.canvas.clientWidth || world.canvas.width,
      );
      const canvasHeight = Math.max(
        1,
        world.canvas.clientHeight || world.canvas.height,
      );
      const aspect = canvasWidth / canvasHeight;
      const contentFraction = Math.max(0.5, 1 - paddingRatio * 2);
      const viewWidth =
        Math.max(width, height * aspect) / contentFraction;
      const viewHeight = viewWidth / aspect;

      world.focus(focusX, focusZ);
      world.viewWidth = viewWidth;
      world.resize();
      const borderRatios = {
        left: 0.5 + (projected.minX - centerX) / viewWidth,
        right: 0.5 - (projected.maxX - centerX) / viewWidth,
        top: 0.5 - (projected.maxY - centerY) / viewHeight,
        bottom: 0.5 + (projected.minY - centerY) / viewHeight,
      };
      return {
        method:
          "visible-fluid-mesh-projected-box3-ground-focus-10-percent-pad",
        boundedMeshes,
        focus: { x: focusX, z: focusZ },
        viewWidth,
        viewHeight,
        projectedBounds: projected,
        projectedSize: { width, height },
        borderRatios,
      };
    };
    window.__fluidQaProjectedSlabAudit = () => {
      const fluidRoot = world.fluidRenderer.root;
      const camera = world.camera;
      const width = Math.max(
        1,
        world.canvas.clientWidth || world.canvas.width,
      );
      const height = Math.max(
        1,
        world.canvas.clientHeight || world.canvas.height,
      );
      fluidRoot.updateWorldMatrix(true, true);
      camera.updateMatrixWorld(true);
      const candidates = [];
      fluidRoot.traverseVisible((object) => {
        if (!object.isMesh || !object.geometry || object.isInstancedMesh) {
          return;
        }
        object.geometry.computeBoundingBox();
        const localBox = object.geometry.boundingBox;
        if (!localBox || localBox.isEmpty()) return;
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const x of [localBox.min.x, localBox.max.x]) {
          for (const y of [localBox.min.y, localBox.max.y]) {
            for (const z of [localBox.min.z, localBox.max.z]) {
              const projected = localBox.min
                .clone()
                .set(x, y, z)
                .applyMatrix4(object.matrixWorld)
                .project(camera);
              minX = Math.min(minX, projected.x);
              maxX = Math.max(maxX, projected.x);
              minY = Math.min(minY, projected.y);
              maxY = Math.max(maxY, projected.y);
            }
          }
        }
        const pixelWidth = ((maxX - minX) * width) / 2;
        const pixelHeight = ((maxY - minY) * height) / 2;
        if (
          pixelHeight >= 70 &&
          pixelWidth >= 12 &&
          pixelHeight / pixelWidth >= 2
        ) {
          candidates.push({
            name: object.name,
            pixelWidth,
            pixelHeight,
            aspect: pixelHeight / pixelWidth,
          });
        }
      });
      return candidates
        .sort(
          (left, right) =>
            right.pixelHeight - left.pixelHeight ||
            right.aspect - left.aspect,
        )
        .slice(0, 40);
    };
    // The game keeps rendering while paused. Sanitize every subsequent sync
    // so its normal presentation loop cannot re-introduce generic relay rigs
    // in the 32 ms between our authoritative stage render and screenshot.
    const nativeFluidProofSync = world.sync.bind(world);
    world.sync = (frame) => {
      const includedEntityIds = Array.isArray(
        window.__fluidQaIncludedEntityIds,
      )
        ? new Set(window.__fluidQaIncludedEntityIds)
        : null;
      const fluidEntities = includedEntityIds
        ? frame.fluidEntities.filter(({ id }) => includedEntityIds.has(id))
        : frame.fluidEntities;
      const fluidNodes = includedEntityIds
        ? frame.fluidNetwork.nodes.filter(({ entityId }) =>
            includedEntityIds.has(entityId),
          )
        : frame.fluidNetwork.nodes;
      const fluidEdges = includedEntityIds
        ? frame.fluidNetwork.edges.filter(
            ({ sourceEntityId, targetEntityId }) =>
              includedEntityIds.has(sourceEntityId) &&
              includedEntityIds.has(targetEntityId),
          )
        : frame.fluidNetwork.edges;
      nativeFluidProofSync({
        ...frame,
        entities: [],
        resources: [],
        beltItems: [],
        circuitEntities: [],
        fluidEntities,
        fluidNetwork: {
          ...frame.fluidNetwork,
          nodes: fluidNodes,
          edges: fluidEdges,
          components: includedEntityIds ? [] : frame.fluidNetwork.components,
        },
        powerGrid: {
          ...frame.powerGrid,
          relayCenters: [],
          relayLinks: [],
        },
      });
      hideUtilities();
    };
    world.focus(8, 7.45);
    world.viewWidth = 16.4;
    world.resize();
    world.update(0, snapshot.elapsedSeconds);
    world.render(0);
    world.renderer.getContext().finish();

    return {
      startingTick: snapshot.tick,
      sourceId: source.id,
      processorId: processor.id,
      receiverId: receiver.id,
      sourceIds: [source.id, westSource.id, northBankSource.id],
      processorIds: [processor.id, westProcessor.id, northboundProcessor.id],
      generatorId: generator.id,
      generatorIds: [generator.id, reserveGenerator.id],
      presentation: {
        utilitiesHidden: true,
        genericInfrastructureHidden: true,
        lifecycleDistrictFloorHidden: true,
        heroDistrictFloorVisible: true,
        reason: "Power and generic entity footprints remain authoritative; duplicate pads, relay LODs, and wire overlays are excluded from dedicated FluidRenderer judgment. The authored district floor is hidden only in the locked lifecycle composition and restored for hero judgment.",
      },
      placements,
      heroBEntityIds,
      heroCoreEntityIds,
      heroMainlineEntityIds,
      upperBranchEntityIds,
      lifecycleEntityIds,
      fluidPlacements: placements.filter(({ kind }) =>
        kind.startsWith("fluid"),
      ),
    };
  });

  const worldCanvas = page.locator("#world");
  if (HERO_PREVIEW_ONLY) {
    const preview = await page.evaluate(
      ({ heroMainlineEntityIds }) => {
        const game = window.__CINDERLINE__;
        const world = game?.renderer;
        if (!game || !world) {
          throw new Error("Fluid hero preview bridge is unavailable.");
        }
        game.simulation.step(9_960);
        window.__fluidQaIncludedEntityIds = heroMainlineEntityIds;
        window.__fluidQaShowDistrictFloor = true;
        const snapshot = game.simulation.getRenderSnapshot();
        world.sync(window.__fluidQaAdapt(snapshot));
        window.__fluidQaHideUtilities?.();
        const cameraFit = window.__fluidQaFitHeroCamera?.(0.1);
        if (!cameraFit) {
          throw new Error("Fluid hero camera fitter is unavailable.");
        }
        world.update(0, snapshot.elapsedSeconds);
        window.__fluidQaHideUtilities?.();
        world.render(0);
        world.renderer.getContext().finish();
        return {
          tick: snapshot.tick,
          entityCount: heroMainlineEntityIds.length,
          debug: world.fluidRenderer.getDebug(),
          cameraFit,
          slabAudit: window.__fluidQaProjectedSlabAudit?.() ?? [],
        };
      },
      {
        heroMainlineEntityIds: setup.heroMainlineEntityIds,
      },
    );
    await page.waitForTimeout(32);
    const buffer = await worldCanvas.screenshot({
      path: `${OUTPUT_DIRECTORY}/refinery-hero-preview.png`,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          preview,
          image: `${OUTPUT_DIRECTORY}/refinery-hero-preview.png`,
          sha256: digest(buffer),
          bytes: buffer.byteLength,
        },
        null,
        2,
      ),
    );
    await browser.close();
    process.exit(0);
  }
  await page.evaluate(() => {
    const world = window.__CINDERLINE__?.renderer;
    if (!world) throw new Error("Fluid baseline renderer is unavailable.");
    world.entityRoot.visible = false;
    world.render(0);
    world.renderer.getContext().finish();
  });
  await page.waitForTimeout(80);
  const terrainBaseline = await worldCanvas.screenshot();
  await page.evaluate(() => {
    const world = window.__CINDERLINE__?.renderer;
    if (!world) throw new Error("Fluid baseline restore is unavailable.");
    world.entityRoot.visible = true;
    world.fluidRenderer.root.visible = true;
    window.__fluidQaHideUtilities?.();
    world.render(0);
    world.renderer.getContext().finish();
  });

  const compareImages = async (image, baseline, previous = null) =>
    page.evaluate(
      async ({ imageBase64, baselineBase64, previousBase64 }) => {
        const decode = async (base64) => {
          const response = await fetch(`data:image/png;base64,${base64}`);
          const bitmap = await createImageBitmap(await response.blob());
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = canvas.getContext("2d", {
            willReadFrequently: true,
          });
          context.drawImage(bitmap, 0, 0);
          return {
            width: bitmap.width,
            height: bitmap.height,
            data: context.getImageData(0, 0, bitmap.width, bitmap.height).data,
          };
        };
        const current = await decode(imageBase64);
        const baselineImage = await decode(baselineBase64);
        const previousImage = previousBase64
          ? await decode(previousBase64)
          : null;
        if (
          current.width !== baselineImage.width ||
          current.height !== baselineImage.height ||
          (previousImage &&
            (current.width !== previousImage.width ||
              current.height !== previousImage.height))
        ) {
          throw new Error("Fluid visual metric dimensions do not match.");
        }
        let nonBlack = 0;
        let foreground = 0;
        let temporalChanged = 0;
        let temporalDifference = 0;
        let edgeEnergy = 0;
        const pixelCount = current.width * current.height;
        const data = current.data;
        for (let pixel = 0; pixel < pixelCount; pixel += 1) {
          const offset = pixel * 4;
          const red = data[offset];
          const green = data[offset + 1];
          const blue = data[offset + 2];
          if (red + green + blue > 24) nonBlack += 1;
          const baselineDelta =
            Math.abs(red - baselineImage.data[offset]) +
            Math.abs(green - baselineImage.data[offset + 1]) +
            Math.abs(blue - baselineImage.data[offset + 2]);
          if (baselineDelta > 36) foreground += 1;
          if (previousImage) {
            const difference =
              Math.abs(red - previousImage.data[offset]) +
              Math.abs(green - previousImage.data[offset + 1]) +
              Math.abs(blue - previousImage.data[offset + 2]);
            temporalDifference += difference / 3;
            if (difference > 24) temporalChanged += 1;
          }
          if (pixel % 2 === 0 && pixel % current.width < current.width - 2) {
            const neighbor = offset + 8;
            edgeEnergy +=
              Math.abs(red - data[neighbor]) +
              Math.abs(green - data[neighbor + 1]) +
              Math.abs(blue - data[neighbor + 2]);
          }
        }
        return {
          width: current.width,
          height: current.height,
          nonBlackRatio: nonBlack / pixelCount,
          foregroundCoverageRatio: foreground / pixelCount,
          temporalChangedRatio: previousImage
            ? temporalChanged / pixelCount
            : 0,
          meanTemporalDifference: previousImage
            ? temporalDifference / pixelCount
            : 0,
          edgeEnergyPerPixel: edgeEnergy / pixelCount,
        };
      },
      {
        imageBase64: image.toString("base64"),
        baselineBase64: baseline.toString("base64"),
        previousBase64: previous?.toString("base64") ?? null,
      },
    );

  const imageDigests = {};
  let previousPhaseImage = null;

  const renderStage = async (advanceTicks, label, imageName) => {
    const stage = await page.evaluate(
      async ({
        advanceTicks,
        label,
        startingTick,
        trackedEntityIds,
        lifecycleEntityIds,
      }) => {
        const game = window.__CINDERLINE__;
        if (!game) throw new Error("Cinderline stage bridge is unavailable.");
        const simulation = game.simulation;
        const world = game.renderer;
        const fluidRenderer = world.fluidRenderer;
        const measureVisualCost = () => {
          let visibleDrawObjects = 0;
          let triangles = 0;
          const effectivelyVisible = (object) => {
            let current = object;
            while (current) {
              if (!current.visible) return false;
              current = current.parent;
            }
            return true;
          };
          fluidRenderer.root.traverse((object) => {
            if (
              !effectivelyVisible(object) ||
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
            triangles +=
              primitiveCount * (object.isInstancedMesh ? object.count : 1);
          });
          return {
            visibleDrawObjects,
            triangles: Math.round(triangles),
          };
        };
        simulation.step(advanceTicks);
        const snapshot = simulation.getRenderSnapshot();
        const renderStarted = performance.now();
        window.__fluidQaIncludedEntityIds = null;
        window.__fluidQaShowDistrictFloor = false;
        world.sync(window.__fluidQaAdapt(snapshot));
        const fixtureDebug = { ...world.fluidRenderer.getDebug() };
        const fixtureVisualCost = measureVisualCost();
        window.__fluidQaIncludedEntityIds = lifecycleEntityIds;
        world.sync(window.__fluidQaAdapt(snapshot));
        window.__fluidQaHideUtilities?.();
        world.focus(8, 7.45);
        world.viewWidth = 16.4;
        world.resize();
        world.update(0, snapshot.elapsedSeconds);
        window.__fluidQaHideUtilities?.();
        world.render(0);
        world.renderer.getContext().finish();
        const renderMilliseconds = performance.now() - renderStarted;

        const objectNames = [];
        let visibleDrawObjects = 0;
        let visualTriangles = 0;
        const effectivelyVisible = (object) => {
          let current = object;
          while (current) {
            if (!current.visible) return false;
            current = current.parent;
          }
          return true;
        };
        fluidRenderer.root.traverse((object) => {
          objectNames.push(object.name);
          if (
            !effectivelyVisible(object) ||
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
        const presentationContaminants = [];
        const belongsToFluidRenderer = (object) => {
          let current = object;
          while (current) {
            if (current === fluidRenderer.root) return true;
            current = current.parent;
          }
          return false;
        };
        world.scene.traverse((object) => {
          if (
            presentationContaminants.length >= 80 ||
            !effectivelyVisible(object) ||
            belongsToFluidRenderer(object) ||
            object === world.ground ||
            !(object.isMesh || object.isLine || object.isPoints)
          ) {
            return;
          }
          presentationContaminants.push({
            name: object.name,
            type: object.type,
            entityKind: object.userData?.entityKind ?? null,
            parent: object.parent?.name ?? null,
          });
        });

        const find = (name) => fluidRenderer.root.getObjectByName(name);
        const tankLevels = [];
        const operatingStates = [];
        const steam = [];
        const sourceMechanisms = [];
        const pumpMechanisms = [];
        const processorMechanisms = [];
        const ownerEntityId = (object) => {
          let current = object;
          while (current) {
            if (Number.isInteger(current.userData.entityId)) {
              return current.userData.entityId;
            }
            current = current.parent;
          }
          return null;
        };
        fluidRenderer.root.traverse((object) => {
          if (object.name === "fluid-tank-top-contents-bezel") {
            tankLevels.push({
              entityId: ownerEntityId(object),
              fillRatio: Number(object.userData.fillRatio ?? 0),
              fluidId: object.userData.fluidId ?? null,
              operatingState: object.userData.operatingState ?? null,
            });
          }
          if (object.name.endsWith("-status")) {
            operatingStates.push({
              name: object.name,
              state: object.userData.operatingState ?? null,
            });
          }
          if (object.name === "fluid-processor-authoritative-steam-plume") {
            steam.push({
              visible: object.visible,
              phase: Number(object.userData.emissionPhase ?? 0),
              y: object.position.y,
              state: object.userData.operatingState ?? null,
            });
          }
          if (object.name === "fluid-source-reciprocating-beam") {
            sourceMechanisms.push({
              entityId: ownerEntityId(object),
              beamAngle: Number(object.userData.beamAngle ?? 0),
              crankPhase: Number(object.userData.crankPhase ?? 0),
            });
          }
          if (object.name === "fluid-source-polished-rod") {
            const owner = sourceMechanisms.find(
              ({ entityId }) => entityId === ownerEntityId(object),
            );
            if (owner) {
              owner.stroke = Number(object.userData.stroke ?? 0);
            }
          }
          if (object.name === "fluid-source-crank-pitman-link") {
            const owner = sourceMechanisms.find(
              ({ entityId }) => entityId === ownerEntityId(object),
            );
            if (owner) {
              owner.pitmanBeamAngle = Number(
                object.userData.beamAngle ?? 0,
              );
            }
          }
          if (object.name === "fluid-pump-visible-impeller") {
            pumpMechanisms.push({
              entityId: ownerEntityId(object),
              impellerRotation: object.rotation.z,
              active: Boolean(object.userData.authoritativeActive),
            });
          }
          if (object.name === "fluid-processor-metering-rotor") {
            processorMechanisms.push({
              entityId: ownerEntityId(object),
              meteringRotation: object.rotation.z,
              active: Boolean(object.userData.authoritativeActive),
            });
          }
          if (object.name === "fluid-processor-condenser-fan") {
            const owner = processorMechanisms.find(
              ({ entityId }) => entityId === ownerEntityId(object),
            );
            if (owner) {
              owner.condenserRotation = object.rotation.y;
            }
          }
          if (object.name === "fluid-processor-relief-cap") {
            const owner = processorMechanisms.find(
              ({ entityId }) => entityId === ownerEntityId(object),
            );
            if (owner) {
              owner.reliefLift = Number(object.userData.lift ?? 0);
            }
          }
          if (
            object.name ===
            "fluid-processor-mechanical-shutdown-trip-gate"
          ) {
            const owner = processorMechanisms.find(
              ({ entityId }) => entityId === ownerEntityId(object),
            );
            if (owner) {
              owner.shutdownGateState =
                object.userData.operatingState ?? null;
              owner.shutdownGateTravel = Number(
                object.userData.travelRatio ?? 0,
              );
            }
          }
        });

        const fluidStats = simulation.stats().fluid;
        const storedTotal = Object.values(fluidStats.storedMilli).reduce(
          (total, amount) => total + amount,
          0,
        );
        const producedTotal = Object.values(fluidStats.producedMilli).reduce(
          (total, amount) => total + amount,
          0,
        );
        const inputWindow = find("fluid-processor-crude-input-window");
        const outputWindow = find("fluid-processor-refined-output-window");
        return {
          label,
          tick: snapshot.tick,
          tickDelta: snapshot.tick - startingTick,
          renderMilliseconds,
          debug: fluidRenderer.getDebug(),
          fixtureDebug,
          fixtureVisualCost,
          authoritative: {
            fluidStats,
            nodeCount: snapshot.fluidNetwork.nodes.length,
            edgeCount: snapshot.fluidNetwork.edges.length,
            trackedEntities: snapshot.entities
              .filter(({ id }) => trackedEntityIds.includes(id))
              .map(
                ({
                  id,
                  kind,
                  status,
                  powerSatisfaction,
                  fluidState,
                }) => ({
                  id,
                  kind,
                  status,
                  powerSatisfaction,
                  fluidState,
                }),
              ),
            producedTotal,
            storedTotal,
            exactMassConserved: producedTotal === storedTotal,
          },
          mechanisms: {
            sourceMechanisms,
            pumpMechanisms,
            processorMechanisms,
            sourceBeamAngle:
              find("fluid-source-reciprocating-beam")?.userData.beamAngle ??
              null,
            sourceStroke:
              find("fluid-source-polished-rod")?.userData.stroke ?? null,
            pumpImpellerRotation:
              find("fluid-pump-visible-impeller")?.rotation.z ?? null,
            processorRotorRotation:
              find("fluid-processor-metering-rotor")?.rotation.z ?? null,
            pressureValveRotation:
              find("fluid-processor-backpressure-handwheel")?.rotation.z ??
              null,
            processorInput: {
              fillRatio: Number(inputWindow?.userData.fillRatio ?? 0),
              amountMilli: Number(inputWindow?.userData.amountMilli ?? 0),
              fluidId: inputWindow?.userData.fluidId ?? null,
            },
            processorOutput: {
              fillRatio: Number(outputWindow?.userData.fillRatio ?? 0),
              amountMilli: Number(outputWindow?.userData.amountMilli ?? 0),
              fluidId: outputWindow?.userData.fluidId ?? null,
            },
            tankLevels,
            operatingStates,
            steam,
          },
          objectNames,
          visualCost: {
            visibleDrawObjects,
            triangles: Math.round(visualTriangles),
          },
          presentationContaminants,
          authoredSurfaceMaps: {
            foundation: fluidRenderer.materials.foundation.map?.name ?? null,
            steelDark: fluidRenderer.materials.steelDark.map?.name ?? null,
            copper: fluidRenderer.materials.copper.map?.name ?? null,
            brass: fluidRenderer.materials.brass.map?.name ?? null,
            ceramic: fluidRenderer.materials.ceramic.map?.name ?? null,
            enamel: fluidRenderer.materials.enamel.map?.name ?? null,
          },
        };
      },
      {
        advanceTicks,
        label,
        startingTick: setup.startingTick,
        trackedEntityIds: [
          ...setup.sourceIds,
          ...setup.processorIds,
          setup.receiverId,
        ],
        lifecycleEntityIds: setup.lifecycleEntityIds,
      },
    );
    await page.waitForTimeout(32);
    const image = await worldCanvas.screenshot({
      path: `${OUTPUT_DIRECTORY}/${imageName}`,
    });
    const metrics = await compareImages(
      image,
      terrainBaseline,
      previousPhaseImage,
    );
    const imageRecord = {
      file: imageName,
      sha256: digest(image),
      bytes: image.byteLength,
      metrics,
    };
    imageDigests[imageName] = imageRecord.sha256;
    previousPhaseImage = image;
    return {
      ...stage,
      image: imageRecord,
    };
  };

  const stages = [];
  stages.push(await renderStage(0, "cold-and-empty", "phase-00-empty.png"));
  stages.push(
    await renderStage(20, "first-extraction-stroke", "phase-01-crude-charge.png"),
  );
  stages.push(
    await renderStage(340, "feed-and-fractionation", "phase-02-fractionating.png"),
  );
  stages.push(
    await renderStage(
      1_200,
      "product-transfer",
      "phase-03-product-transfer.png",
    ),
  );
  stages.push(
    await renderStage(
      8_400,
      "storage-and-backpressure",
      "phase-04-backpressure.png",
    ),
  );
  const proof = {
    format: "cinderline-authentic-fluid-visual-proof-v4",
    setup,
    stages,
    final: stages.at(-1),
    imageDigests,
    errors,
  };
  const final = proof.final;
  const mainProcessorAt = (stage) =>
    stage.mechanisms.processorMechanisms.find(
      ({ entityId }) => entityId === setup.processorId,
    );
  const receiverAt = (stage) =>
    stage.mechanisms.tankLevels.find(
      ({ entityId }) => entityId === setup.receiverId,
    );
  const expectedKindCounts = setup.fluidPlacements.reduce(
    (counts, { kind }) => {
      counts[kind] = (counts[kind] ?? 0) + 1;
      return counts;
    },
    {},
  );
  console.log("Fluid fixture debug:", final.fixtureDebug);
  assert(
    setup.fluidPlacements.length >= 35,
    "The proof refinery requires at least thirty-five real fluid entities.",
  );
  assert(
    final.fixtureDebug.entities === setup.fluidPlacements.length,
    "Fluid renderer lost fixture entities.",
  );
  assert(
    final.fixtureDebug.pipes === expectedKindCounts.fluidPipe,
    "Directional pipe batch count diverged from the real fixture.",
  );
  assert(
    final.fixtureDebug.sources === expectedKindCounts.fluidSource,
    "Source rigs were not rendered exactly.",
  );
  assert(
    final.fixtureDebug.pumps === expectedKindCounts.fluidPump,
    "Isolation pumps were not rendered exactly.",
  );
  assert(
    final.fixtureDebug.tanks === expectedKindCounts.fluidTank,
    "Storage rigs were not rendered exactly.",
  );
  assert(
    final.fixtureDebug.processors === expectedKindCounts.fluidProcessor,
    "Processor rigs were not rendered exactly.",
  );
  assert(
    final.fixtureDebug.edges >= 35,
    "Branched topology was not fully rendered.",
  );
  console.log(
    "Fluid lifecycle flow-window counts:",
    stages
      .map(
        ({ label, fixtureDebug }) =>
          `${label}=${fixtureDebug.flowPulses}`,
      )
      .join(", "),
  );
  console.log(
    "Fluid tracked entities:",
    JSON.stringify(
      stages.map(({ label, authoritative }) => ({
        label,
        entities: authoritative.trackedEntities,
      })),
    ),
  );
  assert(
    Math.max(
      ...stages.map(({ fixtureDebug }) => fixtureDebug.flowPulses),
    ) >= 10,
    "Active custody paths did not produce enough contained flow windows.",
  );
  assert(
    final.fixtureDebug.flowPulses <
      stages[3].fixtureDebug.flowPulses,
    "Backpressure did not mechanically darken and hold the active route.",
  );
  assert(
    stages.map(({ tickDelta }) => tickDelta).join(",") ===
      "0,20,360,1560,9960",
    "Real simulation stages did not advance by the exact fixed-tick schedule.",
  );
  assert(
    stages.every(({ authoritative }) => authoritative.exactMassConserved) &&
      final.authoritative.producedTotal > 0,
    "Rendered fluid fixture did not preserve exact produced mass.",
  );
  assert(
    final.authoritative.fluidStats.processedMilli.refinedFuel > 0,
    "Real processor did not produce refined fuel.",
  );
  assert(
    stages[0].mechanisms.processorOutput.amountMilli === 0 &&
      stages.slice(1).some(
        ({ mechanisms }) => mechanisms.processorOutput.amountMilli > 0,
      ),
    "Processor custody windows do not prove conversion over time.",
  );
  assert(
    mainProcessorAt(stages[1])?.active === false &&
      stages[1].mechanisms.processorInput.amountMilli > 0 &&
      stages[1].mechanisms.steam.every(({ visible }) => !visible),
    "Extraction phase did not keep the charged processor mechanically cold.",
  );
  assert(
    mainProcessorAt(stages[2])?.active === true &&
      (receiverAt(stages[2])?.fillRatio ?? 1) > 0 &&
      (receiverAt(stages[2])?.fillRatio ?? 1) < 0.25,
    "Fractionation phase did not fire while its receiver remained low.",
  );
  assert(
    (receiverAt(stages[3])?.fillRatio ?? 0) >
      (receiverAt(stages[2])?.fillRatio ?? 1) + 0.25,
    "Product-transfer phase did not visibly raise the receiving tank.",
  );
  assert(
    mainProcessorAt(final)?.active === false &&
      mainProcessorAt(final)?.shutdownGateState === "trip-gate-seated" &&
      receiverAt(final)?.fillRatio === 1 &&
      receiverAt(final)?.operatingState === "pressure-held-full",
    "Final receiver and processor did not prove a mechanical pressure trip.",
  );
  assert(
    new Set(
      stages.map(({ mechanisms }) => mechanisms.processorRotorRotation),
    ).size >= 4,
    "Processor rotor lacks multi-frame mechanism evidence.",
  );
  assert(
    new Set(
      stages.map(({ mechanisms }) =>
        Number(mechanisms.sourceBeamAngle).toFixed(6),
      ),
    ).size >= 4,
    "Crank-linked source beam lacks multi-frame pose evidence.",
  );
  assert(
    new Set(
      stages.map(({ mechanisms }) =>
        Number(mechanisms.sourceStroke).toFixed(6),
      ),
    ).size >= 4,
    "Polished-rod stroke lacks multi-frame mechanism evidence.",
  );
  assert(
    stages.slice(1).some(({ mechanisms }) =>
      mechanisms.steam.some(({ visible }) => visible),
    ),
    "Authoritative processor state never drove visible process emissions.",
  );
  assert(
    Object.values(final.authoredSurfaceMaps).every(
      (name) => typeof name === "string" && name.startsWith("fluid-authored-"),
    ),
    "Authored industrial surface maps did not reach every mapped material family.",
  );
  assert(
    stages.every(
      ({ image }) =>
        /^[a-f0-9]{64}$/.test(image.sha256) &&
        imageDigests[image.file] === image.sha256,
    ),
    "Every temporal phase must embed its own exact image digest.",
  );
  console.log(
    "fluid phase image metrics",
    stages.map(({ label, image }) => ({ label, ...image.metrics })),
  );
  assert(
    stages.every(
      ({ image }) =>
        image.metrics.nonBlackRatio > 0.9 &&
        image.metrics.foregroundCoverageRatio > 0.08,
    ),
    "Temporal proof failed its non-black or authored-coverage floor.",
  );
  assert(
    stages
      .slice(1)
      .every(
        ({ image }) =>
          image.metrics.temporalChangedRatio > 0.00045 &&
          image.metrics.meanTemporalDifference > 0.035,
      ),
    "At least one separated phase lacks measurable image change.",
  );
  assert(
    final.authoritative.fluidStats.backpressuredEntityIds.length >= 3,
    "Final storage did not drive real backpressure response.",
  );
  assert(
    stages.every(({ presentationContaminants }) =>
      presentationContaminants.length === 0,
    ),
    "A generic entity or utility visual contaminated the fluid-only proof.",
  );
  for (const requiredName of [
    "fluid-source-reciprocating-beam",
    "fluid-source-crank-pitman-link",
    "fluid-source-polished-rod",
    "fluid-pump-visible-impeller",
    "fluid-pump-visible-drive-shaft",
    "fluid-pump-pressure-gauge-needle",
    "fluid-pipe-load-bearing-saddles",
    "fluid-tank-visible-level",
    "fluid-tank-field-repair-patch",
    "fluid-processor-fractionation-tower",
    "fluid-processor-refractory-furnace",
    "fluid-processor-authoritative-burner-window",
    "fluid-processor-shell-tube-exchanger",
    "fluid-processor-condenser-fan",
    "fluid-processor-metering-pump-volute",
    "fluid-processor-crude-input-window",
    "fluid-processor-refined-output-window",
    "fluid-processor-authoritative-steam-plume",
    "fluid-processor-mechanical-shutdown-trip-gate",
    "fluid-source-gooseneck-discharge-with-elbow",
    "fluid-tank-family-b-horizontal-pressure-drum",
    "fluid-tank-family-c-vertical-accumulator",
    "fluid-tank-family-d-external-heating-coil",
    "fluid-network-crude-flow-pulses",
    "fluid-network-refined-flow-pulses",
  ]) {
    assert(
      final.objectNames.includes(requiredName),
      `Required fluid mechanism is missing: ${requiredName}`,
    );
  }
  assert(
    !final.objectNames.some((name) => name.includes("operating-state-halo")),
    "Overlay-like operating halos returned to the machine read.",
  );
  assert(
    final.mechanisms.processorMechanisms.some(
      ({ shutdownGateState, shutdownGateTravel }) =>
        shutdownGateState === "trip-gate-seated" &&
        shutdownGateTravel === 0,
    ) &&
      stages.slice(1, 4).some(({ mechanisms }) =>
        mechanisms.processorMechanisms.some(
          ({ shutdownGateState, shutdownGateTravel }) =>
            shutdownGateState === "trip-gate-clear" &&
            shutdownGateTravel === 1,
        ),
      ),
    "Processor trip gate did not visibly separate working and backpressure.",
  );
  console.log("fluid visual cost", final.visualCost);
  assert(
    final.fixtureVisualCost.visibleDrawObjects >= 1_200 &&
      final.fixtureVisualCost.visibleDrawObjects <= 5_000 &&
      final.fixtureVisualCost.triangles >= 220_000 &&
      final.fixtureVisualCost.triangles <= 2_000_000,
    "The process field fell outside its authored detail/performance envelope.",
  );
  assert(
    final.renderMilliseconds < 1_500,
    "Steady-state renderer exceeded the browser proof time ceiling.",
  );

  const heroAndClose = [];
  const heroPlacements = setup.fluidPlacements.filter(
    ({ id }) => !setup.lifecycleEntityIds.includes(id),
  );
  const heroEntityIds = setup.heroMainlineEntityIds;
  const sourceCloseEntityIds = heroPlacements
    .filter(
      ({ x, y }) => x >= 14 && x <= 20 && y >= 10 && y <= 12,
    )
    .map(({ id }) => id);
  const processorCloseEntityIds = heroPlacements
    .filter(
      ({ kind, x, y }) =>
        kind === "fluidProcessor" ||
        (kind === "fluidTank" && y >= 10 && y <= 13) ||
        ((kind === "fluidPipe" || kind === "fluidPump") &&
          x >= 21 &&
          x <= 25 &&
          y >= 10 &&
          y <= 15),
    )
    .map(({ id }) => id);
  const tankCloseEntityIds = heroPlacements
    .filter(
      ({ kind, x, y }) =>
        (kind === "fluidTank" && y <= 13) ||
        ((kind === "fluidPipe" || kind === "fluidPump") &&
          x >= 22 &&
          x <= 24 &&
          y >= 9 &&
          y <= 14),
    )
    .map(({ id }) => id);
  const captureView = async (
    file,
    focusX,
    focusZ,
    viewWidth,
    includedEntityIds,
    composition,
    fitHeroCamera = false,
  ) => {
    const cameraFit = await page.evaluate(
      ({
        focusX,
        focusZ,
        viewWidth,
        includedEntityIds,
        showDistrictFloor,
        fitHeroCamera,
      }) => {
        const game = window.__CINDERLINE__;
        const world = game?.renderer;
        if (!world) throw new Error("Fluid proof renderer is unavailable.");
        window.__fluidQaIncludedEntityIds = includedEntityIds;
        window.__fluidQaShowDistrictFloor = showDistrictFloor;
        const snapshot = game.simulation.getRenderSnapshot();
        world.sync(window.__fluidQaAdapt(snapshot));
        window.__fluidQaHideUtilities?.();
        const fitted = fitHeroCamera
          ? window.__fluidQaFitHeroCamera?.(0.1)
          : null;
        if (fitHeroCamera && !fitted) {
          throw new Error("Fluid hero camera fitter is unavailable.");
        }
        if (!fitHeroCamera) {
          world.focus(focusX, focusZ);
          world.viewWidth = viewWidth;
          world.resize();
        }
        world.update(0, snapshot.elapsedSeconds);
        window.__fluidQaHideUtilities?.();
        world.render(0);
        world.renderer.getContext().finish();
        return fitted;
      },
      {
        focusX,
        focusZ,
        viewWidth,
        includedEntityIds,
        showDistrictFloor: true,
        fitHeroCamera,
      },
    );
    if (cameraFit) {
      assert(
        Object.values(cameraFit.borderRatios).every(
          (ratio) => ratio >= 0.075 && ratio < 0.3,
        ),
        `Computed hero fit clipped geometry or left an empty border: ${JSON.stringify(cameraFit.borderRatios)}`,
      );
    }
    await page.waitForTimeout(32);
    const buffer = await worldCanvas.screenshot({
      path: `${OUTPUT_DIRECTORY}/${file}`,
    });
    const record = {
      file,
      sha256: digest(buffer),
      bytes: buffer.byteLength,
      focus: cameraFit
        ? {
            x: cameraFit.focus.x,
            z: cameraFit.focus.z,
            viewWidth: cameraFit.viewWidth,
          }
        : { x: focusX, z: focusZ, viewWidth },
      cameraFit,
      includedEntityCount: includedEntityIds.length,
      districtFloorVisible: true,
      composition,
    };
    imageDigests[file] = record.sha256;
    heroAndClose.push(record);
  };
  await captureView(
    "refinery-hero.png",
    30.15,
    12.1,
    13.8,
    heroEntityIds,
    "single-connected-bottom-processor-header-source-mainline-only",
    true,
  );
  await captureView(
    "upper-header-close.png",
    31,
    11.15,
    9.5,
    setup.upperBranchEntityIds,
    "real-upper-auxiliary-header-and-pump-branch-only",
  );
  await captureView(
    "source-pump-close.png",
    17.5,
    11.35,
    7.6,
    sourceCloseEntityIds,
    "hero-source-pump-and-feed-header-only",
  );
  await captureView(
    "processor-tanks-close.png",
    23.5,
    13,
    14.5,
    processorCloseEntityIds,
    "hero-interleaved-fractionators-and-upper-bank-only",
  );
  await captureView(
    "tank-manifold-close.png",
    23.5,
    11.5,
    15.5,
    tankCloseEntityIds,
    "hero-three-family-buffer-and-custody-bank-only",
  );
  proof.heroAndClose = heroAndClose;
  const performanceProof = await page.evaluate((heroEntityIds) => {
    const game = window.__CINDERLINE__;
    const world = game?.renderer;
    if (!game || !world) {
      throw new Error("Fluid performance proof renderer is unavailable.");
    }
    window.__fluidQaIncludedEntityIds = heroEntityIds;
    window.__fluidQaShowDistrictFloor = true;
    const snapshot = game.simulation.getRenderSnapshot();
    world.sync(window.__fluidQaAdapt(snapshot));
    window.__fluidQaHideUtilities?.();
    world.focus(26, 14.2);
    world.viewWidth = 24.5;
    world.resize();
    const sampleFrames = (count) => {
      const timings = [];
      for (let index = 0; index < count + 4; index += 1) {
        world.update(0, snapshot.elapsedSeconds);
        const started = performance.now();
        world.render(0);
        world.renderer.getContext().finish();
        if (index >= 4) timings.push(performance.now() - started);
      }
      timings.sort((left, right) => left - right);
      const percentile = (fraction) =>
        timings[
          Math.min(
            timings.length - 1,
            Math.max(0, Math.ceil(timings.length * fraction) - 1),
          )
        ];
      return {
        samples: timings.length,
        medianMilliseconds: percentile(0.5),
        p95Milliseconds: percentile(0.95),
        maxMilliseconds: timings.at(-1),
      };
    };
    if (world.quality !== "high") world.toggleQuality();
    const debugBefore = JSON.stringify(world.fluidRenderer.getDebug());
    const high = sampleFrames(32);
    const performanceQuality = world.toggleQuality();
    const performanceMode = sampleFrames(32);
    const restoredQuality = world.toggleQuality();
    const debugAfter = JSON.stringify(world.fluidRenderer.getDebug());
    world.render(0);
    world.renderer.getContext().finish();
    return {
      target60HzBudgetMilliseconds: 1000 / 60,
      evidenceCeilingMilliseconds: 40,
      high,
      performanceMode,
      performanceQuality,
      restoredQuality,
      authoritativeDebugStable: debugBefore === debugAfter,
    };
  }, heroEntityIds);
  assert(
    performanceProof.performanceQuality === "performance" &&
      performanceProof.restoredQuality === "high" &&
      performanceProof.authoritativeDebugStable,
    "Renderer quality round-trip changed authoritative fluid presentation.",
  );
  assert(
    performanceProof.high.p95Milliseconds <
      performanceProof.evidenceCeilingMilliseconds &&
      performanceProof.performanceMode.p95Milliseconds <
        performanceProof.evidenceCeilingMilliseconds,
    "Fluid renderer exceeded its observed p95 evidence ceiling.",
  );
  proof.performance = performanceProof;
  await writeFile(
    `${OUTPUT_DIRECTORY}/visual-proof.json`,
    `${JSON.stringify(proof, null, 2)}\n`,
    "utf8",
  );
  assert(errors.length === 0, `Browser errors: ${errors.join(" | ")}`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        image: `${OUTPUT_DIRECTORY}/refinery-hero.png`,
        proof: `${OUTPUT_DIRECTORY}/visual-proof.json`,
        stages: stages.map(({ label, tickDelta, mechanisms }) => ({
          label,
          tickDelta,
          processorInput: mechanisms.processorInput,
          processorOutput: mechanisms.processorOutput,
          activeSteam: mechanisms.steam.filter(({ visible }) => visible).length,
        })),
        debug: final.debug,
        authoritative: final.authoritative,
        visualCost: final.visualCost,
        performance: performanceProof,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
