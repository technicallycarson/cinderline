import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { chromium } from "playwright";

const BASE_URL = (
  process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173"
).replace(/\/$/, "");
const OUTPUT_DIRECTORY = resolve(
  process.env.RAIL_AUTHORING_QA_OUTPUT_DIR ??
    ".qa/rail-authoring/pass1-work/formative-01",
);
const MANIFEST_PATH = resolve(OUTPUT_DIRECTORY, "manifest.json");
const EXPECTED_SOURCE_FINGERPRINT =
  "42390772bb512c7a274b561db50ffe29e84fa9dd8ab8529e24411c4817e1b6bd";

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(path));
    } else if (/\.(?:ts|css|json)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

async function sourceFiles() {
  return [
    ...await collectSourceFiles("src"),
    "index.html",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vite.config.ts",
  ].sort();
}
const TOOL_COSTS = Object.freeze({
  straight: 2,
  curve: 3,
  junction: 6,
  regularSignal: 4,
  chainSignal: 6,
  station: 24,
  locomotive: 60,
  cargoWagon: 24,
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function assertDeepEqual(actual, expected, message) {
  const actualBytes = JSON.stringify(stable(actual));
  const expectedBytes = JSON.stringify(stable(expected));
  assert(
    actualBytes === expectedBytes,
    `${message}\nactual=${actualBytes}\nexpected=${expectedBytes}`,
  );
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sourceFingerprint() {
  const entries = [];
  for (const path of await sourceFiles()) {
    const bytes = await readFile(resolve(path));
    entries.push({ path, sha256: sha256(bytes) });
  }
  const aggregate = entries
    .map((entry) => `${entry.path}\0${entry.sha256}\n`)
    .join("");
  return Object.freeze({
    algorithm: "sha256",
    digest: sha256(aggregate),
    files: Object.freeze(entries),
  });
}

assert(
  OUTPUT_DIRECTORY.includes(
    "/.qa/rail-authoring/pass1-work/",
  ),
  "Rail authoring QA output must remain in .qa/rail-authoring/pass1-work/**.",
);
await mkdir(OUTPUT_DIRECTORY, { recursive: true });
await rm(MANIFEST_PATH, { force: true });
for (const name of await readdir(OUTPUT_DIRECTORY)) {
  if (name.endsWith(".png") || name === "proof.json") {
    await rm(resolve(OUTPUT_DIRECTORY, name), { force: true });
  }
}

const startingFingerprint = await sourceFingerprint();
assert(
  startingFingerprint.digest === EXPECTED_SOURCE_FINGERPRINT,
  `Rail authoring QA source drifted: expected ${EXPECTED_SOURCE_FINGERPRINT}, received ${startingFingerprint.digest}. Update and re-audit the runner before capture.`,
);
const runnerBytes = await readFile(
  resolve("scripts/rail-authoring-qa.mjs"),
);
const runnerFingerprint = sha256(runnerBytes);

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
});
const browserErrors = [];
const screenshots = [];
const proof = {
  format: "cinderline-rail-authoring-formative-proof",
  version: 1,
  acceptance: "formative-engineering-evidence-only",
  sourceFingerprint: startingFingerprint.digest,
  runnerFingerprint,
  fixture: null,
  keyboardAndModes: null,
  previews: null,
  paidTools: null,
  stationEditor: null,
  scheduleAndConsist: null,
  fuelCustody: null,
  dismantleUndoRedo: null,
  reload: null,
  hover: null,
  mobile: [],
  campaignVisual: null,
  noRail: null,
  migration: null,
};

function auditPage(page, label) {
  page.on("pageerror", (error) => {
    browserErrors.push(`${label} pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (
      message.type() !== "error" &&
      message.type() !== "warning"
    ) return;
    const location = message.location();
    browserErrors.push(
      `${label} console: ${message.text()} @ ${location.url}:${location.lineNumber}:${location.columnNumber}`,
    );
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    browserErrors.push(
      `${label} http ${response.status()}: ${response.url()}`,
    );
  });
  page.on("requestfailed", (request) => {
    browserErrors.push(
      `${label} requestfailed: ${request.url()} · ${
        request.failure()?.errorText ?? "unknown"
      }`,
    );
  });
}

async function waitForBoot(page) {
  await page.waitForFunction(
    () =>
      Boolean(window.__CINDERLINE__?.renderer) &&
      document.querySelector("#boot")?.classList.contains("is-done"),
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(850);
  await page.waitForFunction(
    () => document.elementFromPoint(
      Math.floor(innerWidth / 2),
      Math.floor(innerHeight / 2),
    )?.id !== "boot",
    undefined,
    { timeout: 5_000 },
  );
}

async function readRailState(page) {
  return page.evaluate(() => {
    const game = window.__CINDERLINE__;
    if (!game) throw new Error("Cinderline QA bridge is unavailable.");
    return {
      ...game.railAuthoringState(),
      alloy: game.alloy,
    };
  });
}

function mutationSignature(state) {
  return {
    network: state.network,
    stationInterfaces: state.stationInterfaces,
    ledger: state.ledger,
    alloy: state.alloy,
    undoDepth: state.undoDepth,
    redoDepth: state.redoDepth,
  };
}

function persistentRailSignature(state) {
  const network = state.network;
  return {
    nodes: network?.graph.nodes.map((node) => ({
      segmentId: node.segmentId,
      x: node.x,
      y: node.y,
      kind: node.kind,
      rotation: node.rotation,
    })),
    signals: network?.signals.map((signal) => ({
      id: signal.id,
      fromSegmentId: signal.fromSegmentId,
      toSegmentId: signal.toSegmentId,
      type: signal.type,
    })),
    stations: network?.stations.map((station) => ({
      id: station.id,
      segmentId: station.segmentId,
      capacity: station.capacity,
      inventory: station.inventory,
    })),
    trains: network?.trains.map((train) => ({
      id: train.id,
      currentSegmentId: train.currentSegmentId,
      schedule: train.schedule,
      cars: train.cars.map((car) => ({
        id: car.id,
        kind: car.kind,
        capacity: car.capacity,
        stored: car.stored,
        cargo: car.cargo,
        fuelCapacityMilli: car.fuelCapacityMilli,
        fuelMilli: car.fuelMilli,
      })),
    })),
    stationInterfaces: state.stationInterfaces,
    ledger: state.ledger,
    alloy: state.alloy,
  };
}

async function overlayState(page) {
  return page.evaluate(() => {
    const root = window.__CINDERLINE__?.renderer
      .getRailRendererIntegration()
      .root.getObjectByName("rail-authoring-overlay");
    return root
      ? JSON.parse(JSON.stringify(root.userData))
      : null;
  });
}

function targetMatches(target, expected) {
  if (!target || target.kind !== expected.kind) return false;
  if (
    expected.kind === "segment" &&
    target.segmentId !== expected.id
  ) {
    return false;
  }
  if (
    expected.kind === "station" &&
    target.stationId !== expected.id
  ) {
    return false;
  }
  if (
    expected.kind === "signal" &&
    target.signalId !== expected.id
  ) {
    return false;
  }
  if (
    expected.kind === "train" &&
    target.trainId !== expected.id
  ) {
    return false;
  }
  if (
    expected.carId !== undefined &&
    target.carId !== expected.carId
  ) {
    return false;
  }
  return true;
}

async function findWorldPoint(
  page,
  { cell = null, target = null, step = 2 } = {},
) {
  let resolvedCell = cell;
  if (!resolvedCell && target) {
    resolvedCell = await page.evaluate((requestedTarget) => {
      const rail =
        window.__CINDERLINE__?.railAuthoringState().network;
      if (!rail) return null;
      const segmentId =
        requestedTarget.kind === "segment"
          ? requestedTarget.id
          : requestedTarget.kind === "station"
            ? rail.stations.find(
                (station) => station.id === requestedTarget.id,
              )?.segmentId
            : requestedTarget.kind === "train"
              ? rail.trains.find(
                  (train) => train.id === requestedTarget.id,
                )?.currentSegmentId
              : requestedTarget.kind === "signal"
                ? rail.signals.find(
                    (signal) => signal.id === requestedTarget.id,
                  )?.fromSegmentId
                : undefined;
      const node = rail.graph.nodes.find(
        (candidate) => candidate.segmentId === segmentId,
      );
      return node ? { x: node.x, z: node.y } : null;
    }, target);
  }
  const point = await page.evaluate(
    ({ requestedCell, requestedTarget, scanStep }) => {
      const game = window.__CINDERLINE__;
      const canvas = document.querySelector("#world");
      if (!game || !(canvas instanceof HTMLCanvasElement)) return null;
      const bounds = canvas.getBoundingClientRect();
      const matches = [];
      const matchesTarget = (candidate) => {
        if (!requestedTarget) return true;
        if (!candidate || candidate.kind !== requestedTarget.kind) {
          return false;
        }
        if (
          requestedTarget.kind === "segment" &&
          candidate.segmentId !== requestedTarget.id
        ) return false;
        if (
          requestedTarget.kind === "station" &&
          candidate.stationId !== requestedTarget.id
        ) return false;
        if (
          requestedTarget.kind === "signal" &&
          candidate.signalId !== requestedTarget.id
        ) return false;
        if (
          requestedTarget.kind === "train" &&
          candidate.trainId !== requestedTarget.id
        ) return false;
        if (
          requestedTarget.carId !== undefined &&
          candidate.carId !== requestedTarget.carId
        ) return false;
        return true;
      };
      for (
        let clientY = Math.ceil(bounds.top) + 1;
        clientY < Math.floor(bounds.bottom) - 1;
        clientY += scanStep
      ) {
        for (
          let clientX = Math.ceil(bounds.left) + 1;
          clientX < Math.floor(bounds.right) - 1;
          clientX += scanStep
        ) {
          if (document.elementFromPoint(clientX, clientY) !== canvas) {
            continue;
          }
          const grid = game.renderer.screenToGrid(clientX, clientY);
          if (
            requestedCell &&
            (
              grid?.x !== requestedCell.x ||
              grid?.z !== requestedCell.z
            )
          ) {
            continue;
          }
          const picked = requestedTarget
            ? game.renderer.pickRailTarget(clientX, clientY)
            : null;
          if (!matchesTarget(picked)) continue;
          matches.push({ x: clientX, y: clientY, grid, picked });
        }
      }
      return matches.length === 0
        ? null
        : matches[Math.floor(matches.length / 2)];
    },
    {
      requestedCell: resolvedCell,
      requestedTarget: target,
      scanStep: step,
    },
  );
  assert(
    point,
    `No native world point found for ${JSON.stringify({
      cell: resolvedCell,
      target,
    })}.`,
  );
  if (target) {
    assert(
      targetMatches(point.picked, target),
      `Resolved the wrong rail target for ${JSON.stringify(target)}.`,
    );
  }
  return point;
}

function exactNativeTargetRepresentative(observation, target) {
  const expectedOrdinals = "1,16,32,48,64";
  assert(
    observation.termination === "exact-quota" &&
      observation.exactQuota === 64 &&
      observation.hardSampleCap === 50_000 &&
      observation.hardElapsedCapMilliseconds === 10_000 &&
      observation.exactCountLowerBound === 64 &&
      observation.representativeNativePoints.length === 5 &&
      observation.representativeNativePoints
        .map((point) => point.matchOrdinal)
        .join(",") === expectedOrdinals &&
      observation.representativeNativePoints.every(
        (point) =>
          point.element === "world" &&
          targetMatches(point.picked, target),
      ),
    `Native ${target.kind} target quota failed: ${JSON.stringify(observation)}.`,
  );
  const representative =
    observation.representativeNativePoints.find(
      (point) => point.matchOrdinal === 32,
    );
  assert(
    representative &&
      representative.element === "world" &&
      targetMatches(representative.picked, target),
    `Native ${target.kind} representative is invalid: ${JSON.stringify(representative)}.`,
  );
  return representative;
}

async function scanProjectedStationTarget(
  page,
  stationId,
  step = 2,
  sampleCap = 50_000,
  elapsedCapMilliseconds = 10_000,
  exactQuota = 64,
) {
  return page.evaluate(
    ({
      requestedStationId,
      scanStep,
      hardSampleCap,
      hardElapsedCapMilliseconds,
      requestedExactQuota,
    }) => {
      const targetStarted = performance.now();
      const game = window.__CINDERLINE__;
      const canvas = document.querySelector("#world");
      const camera = game?.renderer?.camera;
      if (
        !game ||
        !(canvas instanceof HTMLCanvasElement) ||
        !camera?.isCamera
      ) {
        throw new Error(
          "Campaign renderer, canvas, or live camera is unavailable.",
        );
      }
      const railRoot = game.renderer
        .getRailRendererIntegration()
        .root;
      let stationRig = null;
      railRoot.traverse((object) => {
        if (stationRig) return;
        const pickTarget = object.userData?.pickTarget;
        if (
          pickTarget?.kind === "station" &&
          pickTarget.stationId === requestedStationId
        ) {
          stationRig = object;
        }
      });
      if (!stationRig) {
        throw new Error(
          `Exact station rig ${requestedStationId} is unavailable.`,
        );
      }

      railRoot.updateWorldMatrix(true, true);
      stationRig.updateWorldMatrix(true, true);
      camera.updateWorldMatrix(true, false);
      const canvasBounds = canvas.getBoundingClientRect();
      const projectedUnion = {
        left: Number.POSITIVE_INFINITY,
        top: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        bottom: Number.NEGATIVE_INFINITY,
      };
      let projectedMeshCount = 0;
      const effectivelyVisible = (object) => {
        let current = object;
        while (current) {
          if (!current.visible) return false;
          if (current === stationRig) return true;
          current = current.parent;
        }
        return false;
      };
      stationRig.traverse((object) => {
        if (
          object.isMesh !== true ||
          !object.geometry ||
          !effectivelyVisible(object)
        ) {
          return;
        }
        const geometry = object.geometry;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        const local = geometry.boundingBox;
        if (!local || local.isEmpty()) return;
        if (
          ![
            local.min.x,
            local.min.y,
            local.min.z,
            local.max.x,
            local.max.y,
            local.max.z,
          ].every(Number.isFinite)
        ) {
          return;
        }
        const projected = {
          left: Number.POSITIVE_INFINITY,
          top: Number.POSITIVE_INFINITY,
          right: Number.NEGATIVE_INFINITY,
          bottom: Number.NEGATIVE_INFINITY,
        };
        for (const x of [local.min.x, local.max.x]) {
          for (const y of [local.min.y, local.max.y]) {
            for (const z of [local.min.z, local.max.z]) {
              const ndc = local.min
                .clone()
                .set(x, y, z)
                .applyMatrix4(object.matrixWorld)
                .project(camera);
              const clientX =
                canvasBounds.left +
                ((ndc.x + 1) * 0.5) * canvasBounds.width;
              const clientY =
                canvasBounds.top +
                ((1 - ndc.y) * 0.5) * canvasBounds.height;
              if (
                !Number.isFinite(clientX) ||
                !Number.isFinite(clientY)
              ) {
                continue;
              }
              projected.left = Math.min(
                projected.left,
                clientX,
              );
              projected.top = Math.min(
                projected.top,
                clientY,
              );
              projected.right = Math.max(
                projected.right,
                clientX,
              );
              projected.bottom = Math.max(
                projected.bottom,
                clientY,
              );
            }
          }
        }
        if (
          !Object.values(projected).every(Number.isFinite)
        ) {
          return;
        }
        projectedUnion.left = Math.min(
          projectedUnion.left,
          projected.left,
        );
        projectedUnion.top = Math.min(
          projectedUnion.top,
          projected.top,
        );
        projectedUnion.right = Math.max(
          projectedUnion.right,
          projected.right,
        );
        projectedUnion.bottom = Math.max(
          projectedUnion.bottom,
          projected.bottom,
        );
        projectedMeshCount += 1;
      });
      if (
        projectedMeshCount === 0 ||
        !Object.values(projectedUnion).every(Number.isFinite)
      ) {
        throw new Error(
          `Station ${requestedStationId} has no projected visible bounds.`,
        );
      }

      const expandedBounds = {
        left: projectedUnion.left - 8,
        top: projectedUnion.top - 8,
        right: projectedUnion.right + 8,
        bottom: projectedUnion.bottom + 8,
      };
      const clippedBounds = {
        left: Math.max(
          Math.ceil(canvasBounds.left) + 1,
          Math.floor(expandedBounds.left),
        ),
        top: Math.max(
          Math.ceil(canvasBounds.top) + 1,
          Math.floor(expandedBounds.top),
        ),
        right: Math.min(
          Math.floor(canvasBounds.right) - 1,
          Math.ceil(expandedBounds.right),
        ),
        bottom: Math.min(
          Math.floor(canvasBounds.bottom) - 1,
          Math.ceil(expandedBounds.bottom),
        ),
      };
      if (
        clippedBounds.right < clippedBounds.left ||
        clippedBounds.bottom < clippedBounds.top
      ) {
        throw new Error(
          `Station ${requestedStationId} projected bounds miss the canvas.`,
        );
      }

      const scanStarted = performance.now();
      let scannedCandidates = 0;
      let exposedWorldPoints = 0;
      let exactCount = 0;
      let termination = null;
      const representativeNativePoints = [];
      const representativeOrdinals = new Set([
        1,
        16,
        32,
        48,
        requestedExactQuota,
      ]);
      for (
        let clientY = clippedBounds.top;
        clientY <= clippedBounds.bottom;
        clientY += scanStep
      ) {
        for (
          let clientX = clippedBounds.left;
          clientX <= clippedBounds.right;
          clientX += scanStep
        ) {
          if (scannedCandidates >= hardSampleCap) {
            termination = "hard-sample-cap";
            break;
          }
          if (
            performance.now() - targetStarted >=
            hardElapsedCapMilliseconds
          ) {
            termination = "hard-elapsed-cap";
            break;
          }
          scannedCandidates += 1;
          if (document.elementFromPoint(clientX, clientY) !== canvas) {
            continue;
          }
          exposedWorldPoints += 1;
          const picked = game.renderer.pickRailTarget(
            clientX,
            clientY,
          );
          if (
            picked?.kind !== "station" ||
            picked.stationId !== requestedStationId
          ) {
            continue;
          }
          exactCount += 1;
          if (representativeOrdinals.has(exactCount)) {
            representativeNativePoints.push({
              matchOrdinal: exactCount,
              x: clientX,
              y: clientY,
              element:
                document.elementFromPoint(clientX, clientY)?.id ??
                null,
              grid: game.renderer.screenToGrid(clientX, clientY),
              picked,
            });
          }
          if (exactCount >= requestedExactQuota) {
            termination = "exact-quota";
            break;
          }
        }
        if (termination) break;
      }
      return {
        target: { kind: "station", id: requestedStationId },
        rig: {
          name: stationRig.name || null,
          stationId:
            stationRig.userData?.stationId ??
            stationRig.userData?.pickTarget?.stationId ??
            null,
          pickTarget:
            stationRig.userData?.pickTarget ?? null,
        },
        projectedMeshCount,
        projectedUnion,
        expandedPixels: 8,
        expandedBounds,
        canvasBounds: {
          left: canvasBounds.left,
          top: canvasBounds.top,
          right: canvasBounds.right,
          bottom: canvasBounds.bottom,
        },
        clippedBounds,
        step: scanStep,
        hardSampleCap,
        hardElapsedCapMilliseconds,
        exactQuota: requestedExactQuota,
        scannedCandidates,
        exposedWorldPoints,
        exactCount,
        exactCountLowerBound: Math.min(
          exactCount,
          requestedExactQuota,
        ),
        representativeNativePoints,
        termination:
          termination ?? "projected-bounds-exhausted",
        projectionDurationMilliseconds:
          scanStarted - targetStarted,
        raycastDurationMilliseconds:
          performance.now() - scanStarted,
        durationMilliseconds:
          performance.now() - targetStarted,
      };
    },
    {
      requestedStationId: stationId,
      scanStep: step,
      hardSampleCap: sampleCap,
      hardElapsedCapMilliseconds: elapsedCapMilliseconds,
      requestedExactQuota: exactQuota,
    },
  );
}

async function scanTrainLiveCellTarget(
  page,
  trainId,
  step = 2,
  sampleCap = 50_000,
  elapsedCapMilliseconds = 10_000,
  exactQuota = 64,
) {
  return page.evaluate(
    ({
      requestedTrainId,
      scanStep,
      hardSampleCap,
      hardElapsedCapMilliseconds,
      requestedExactQuota,
    }) => {
      const started = performance.now();
      const game = window.__CINDERLINE__;
      const canvas = document.querySelector("#world");
      if (!game || !(canvas instanceof HTMLCanvasElement)) {
        throw new Error("Campaign renderer is unavailable.");
      }
      const network = game.railAuthoringState().network;
      const train = network.trains.find(
        (candidate) => candidate.id === requestedTrainId,
      );
      const node = network.graph.nodes.find(
        (candidate) =>
          candidate.segmentId === train?.currentSegmentId,
      );
      if (!train || !node) {
        throw new Error(
          `Train ${requestedTrainId} has no live cell.`,
        );
      }
      const liveCell = { x: node.x, z: node.y };
      const bounds = canvas.getBoundingClientRect();
      let canvasCandidatePoints = 0;
      let scannedCandidates = 0;
      let exactCount = 0;
      let termination = null;
      const representativeNativePoints = [];
      const representativeOrdinals = new Set([
        1,
        16,
        32,
        48,
        requestedExactQuota,
      ]);
      for (
        let clientY = Math.ceil(bounds.top) + 1;
        clientY < Math.floor(bounds.bottom) - 1;
        clientY += scanStep
      ) {
        for (
          let clientX = Math.ceil(bounds.left) + 1;
          clientX < Math.floor(bounds.right) - 1;
          clientX += scanStep
        ) {
          if (
            performance.now() - started >=
            hardElapsedCapMilliseconds
          ) {
            termination = "hard-elapsed-cap";
            break;
          }
          if (document.elementFromPoint(clientX, clientY) !== canvas) {
            continue;
          }
          canvasCandidatePoints += 1;
          const grid = game.renderer.screenToGrid(
            clientX,
            clientY,
          );
          if (
            grid?.x !== liveCell.x ||
            grid?.z !== liveCell.z
          ) {
            continue;
          }
          if (scannedCandidates >= hardSampleCap) {
            termination = "hard-sample-cap";
            break;
          }
          scannedCandidates += 1;
          const picked = game.renderer.pickRailTarget(
            clientX,
            clientY,
          );
          if (
            picked?.kind !== "train" ||
            picked.trainId !== requestedTrainId
          ) {
            continue;
          }
          exactCount += 1;
          if (representativeOrdinals.has(exactCount)) {
            representativeNativePoints.push({
              matchOrdinal: exactCount,
              x: clientX,
              y: clientY,
              element:
                document.elementFromPoint(clientX, clientY)?.id ??
                null,
              grid,
              picked,
            });
          }
          if (exactCount >= requestedExactQuota) {
            termination = "exact-quota";
            break;
          }
        }
        if (termination) break;
      }
      return {
        target: { kind: "train", id: requestedTrainId },
        liveSegmentId: train.currentSegmentId,
        liveCell,
        step: scanStep,
        hardSampleCap,
        hardElapsedCapMilliseconds,
        exactQuota: requestedExactQuota,
        canvasCandidatePoints,
        scannedCandidates,
        exactCount,
        exactCountLowerBound: Math.min(
          exactCount,
          requestedExactQuota,
        ),
        representativeNativePoints,
        termination: termination ?? "live-cell-exhausted",
        durationMilliseconds: performance.now() - started,
      };
    },
    {
      requestedTrainId: trainId,
      scanStep: step,
      hardSampleCap: sampleCap,
      hardElapsedCapMilliseconds: elapsedCapMilliseconds,
      requestedExactQuota: exactQuota,
    },
  );
}

async function auditMobileSignalEndpoints(page, flow) {
  const state = await readRailState(page);
  const sourceNode = state.network.graph.nodes.find(
    (node) => node.segmentId === flow.source,
  );
  const destinationNode = state.network.graph.nodes.find(
    (node) => node.segmentId === flow.destination,
  );
  const endpointIds = new Set([
    flow.source,
    flow.destination,
  ]);
  const conflicts = {
    signals: state.network.signals
      .filter(
        (signal) =>
          endpointIds.has(signal.fromSegmentId) ||
          endpointIds.has(signal.toSegmentId),
      )
      .map((signal) => signal.id),
    stations: state.network.stations
      .filter((station) => endpointIds.has(station.segmentId))
      .map((station) => station.id),
    trains: state.network.trains
      .filter((train) =>
        endpointIds.has(train.currentSegmentId)
      )
      .map((train) => train.id),
  };
  assert(
    sourceNode &&
      destinationNode &&
      Math.abs(sourceNode.x - destinationNode.x) +
        Math.abs(sourceNode.y - destinationNode.y) ===
        1 &&
      conflicts.signals.length === 0 &&
      conflicts.stations.length === 0 &&
      conflicts.trains.length === 0,
    `${flow.label} mobile signal endpoints are missing, non-adjacent, or conflicted: ${JSON.stringify({
      sourceNode,
      destinationNode,
      conflicts,
    })}.`,
  );
  const sourcePoint = await findWorldPoint(page, {
    target: { kind: "segment", id: flow.source },
    step: 1,
  });
  const destinationPoint = await findWorldPoint(page, {
    target: { kind: "segment", id: flow.destination },
    step: 1,
  });
  const exposure = await page.evaluate(
    ({ source, destination }) => {
      const canvas = document.querySelector("#world");
      if (!(canvas instanceof HTMLCanvasElement)) return null;
      let exposedWorldSamples = 0;
      for (let row = 1; row <= 8; row += 1) {
        for (let column = 1; column <= 8; column += 1) {
          const x = (innerWidth * column) / 9;
          const y = (innerHeight * row) / 9;
          if (document.elementFromPoint(x, y) === canvas) {
            exposedWorldSamples += 1;
          }
        }
      }
      return {
        exposedWorldSamples,
        sourceElement:
          document.elementFromPoint(source.x, source.y)?.id ??
          null,
        destinationElement:
          document.elementFromPoint(
            destination.x,
            destination.y,
          )?.id ?? null,
      };
    },
    {
      source: { x: sourcePoint.x, y: sourcePoint.y },
      destination: {
        x: destinationPoint.x,
        y: destinationPoint.y,
      },
    },
  );
  assert(
    exposure &&
      exposure.exposedWorldSamples >= 4 &&
      exposure.sourceElement === "world" &&
      exposure.destinationElement === "world",
    `${flow.label} mobile endpoints are not both exposed before mutation: ${JSON.stringify(exposure)}.`,
  );
  return {
    sourcePoint,
    destinationPoint,
    proof: {
      source: {
        id: flow.source,
        cell: { x: sourceNode.x, z: sourceNode.y },
        client: { x: sourcePoint.x, y: sourcePoint.y },
      },
      destination: {
        id: flow.destination,
        cell: {
          x: destinationNode.x,
          z: destinationNode.y,
        },
        client: {
          x: destinationPoint.x,
          y: destinationPoint.y,
        },
      },
      conflicts,
      exposure,
    },
  };
}

async function waitForSettledRailTray(
  page,
  collapsed,
  label,
) {
  await page.waitForFunction(
    ({ expectedCollapsed, probeKey }) => {
      const consoleElement = document.querySelector(
        "[data-ref='rail-console']",
      );
      const collapseButton = consoleElement?.querySelector(
        "[data-action='rail-collapse']",
      );
      if (
        !(consoleElement instanceof HTMLElement) ||
        !(collapseButton instanceof HTMLElement)
      ) {
        return false;
      }
      const height =
        consoleElement.getBoundingClientRect().height;
      const stateMatches =
        consoleElement.classList.contains("is-collapsed") ===
          expectedCollapsed &&
        collapseButton.getAttribute("aria-expanded") ===
          String(!expectedCollapsed) &&
        (
          expectedCollapsed
            ? Math.abs(height - 68) <= 0.25
            : height > 68.25
        );
      const probes =
        window.__railQaTraySettleProbes ??=
          Object.create(null);
      const previous = probes[probeKey];
      const stable =
        stateMatches &&
        previous?.stateMatches === true &&
        Math.abs(previous.height - height) <= 0.1
          ? previous.stable + 1
          : 0;
      probes[probeKey] = {
        height,
        stateMatches,
        stable,
      };
      return stable >= 2;
    },
    {
      expectedCollapsed: collapsed,
      probeKey: `${label}:${collapsed ? "collapsed" : "expanded"}`,
    },
    { timeout: 4_000, polling: "raf" },
  );
  const before = await page.locator(
    "[data-ref='rail-console']",
  ).evaluate((consoleElement) => {
    const bounds = consoleElement.getBoundingClientRect();
    return {
      collapsed:
        consoleElement.classList.contains("is-collapsed"),
      ariaExpanded: consoleElement
        .querySelector("[data-action='rail-collapse']")
        ?.getAttribute("aria-expanded"),
      width: bounds.width,
      height: bounds.height,
      top: bounds.top,
      left: bounds.left,
    };
  });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(resolve)
        )
      ),
  );
  const after = await page.locator(
    "[data-ref='rail-console']",
  ).evaluate((consoleElement) => {
    const bounds = consoleElement.getBoundingClientRect();
    return {
      collapsed:
        consoleElement.classList.contains("is-collapsed"),
      ariaExpanded: consoleElement
        .querySelector("[data-action='rail-collapse']")
        ?.getAttribute("aria-expanded"),
      width: bounds.width,
      height: bounds.height,
      top: bounds.top,
      left: bounds.left,
    };
  });
  assert(
    before.collapsed === collapsed &&
      after.collapsed === collapsed &&
      before.ariaExpanded === String(!collapsed) &&
      after.ariaExpanded === String(!collapsed) &&
      (
        collapsed
          ? Math.abs(after.height - 68) <= 0.25
          : after.height > 68.25
      ) &&
      Math.abs(before.width - after.width) <= 0.1 &&
      Math.abs(before.height - after.height) <= 0.1 &&
      Math.abs(before.top - after.top) <= 0.1 &&
      Math.abs(before.left - after.left) <= 0.1,
    `${label} rail tray did not settle across two animation frames: ${JSON.stringify({
      before,
      after,
    })}.`,
  );
  return after;
}

async function toggleAndSettleRailTray(
  page,
  collapseButton,
  collapsed,
  label,
) {
  await collapseButton.tap();
  return waitForSettledRailTray(page, collapsed, label);
}

async function auditMobileEditorTarget(
  page,
  target,
  label,
) {
  const point = await findWorldPoint(page, {
    target,
    step: 1,
  });
  const exposure = await page.evaluate(
    ({ clientX, clientY }) => {
      const canvas = document.querySelector("#world");
      if (!(canvas instanceof HTMLCanvasElement)) return null;
      let exposedWorldSamples = 0;
      for (let row = 1; row <= 8; row += 1) {
        for (let column = 1; column <= 8; column += 1) {
          const x = (innerWidth * column) / 9;
          const y = (innerHeight * row) / 9;
          if (document.elementFromPoint(x, y) === canvas) {
            exposedWorldSamples += 1;
          }
        }
      }
      return {
        exposedWorldSamples,
        targetElement:
          document.elementFromPoint(clientX, clientY)?.id ??
          null,
      };
    },
    { clientX: point.x, clientY: point.y },
  );
  assert(
    exposure &&
      exposure.exposedWorldSamples >= 4 &&
      exposure.targetElement === "world",
    `${label} editor target is not exposed before tap: ${JSON.stringify(exposure)}.`,
  );
  return {
    target,
    cell: point.grid,
    client: { x: point.x, y: point.y },
    picked: point.picked,
    exposure,
  };
}

async function nativeMobileCameraPan(
  page,
  direction,
  label,
) {
  const viewport = page.viewportSize();
  assert(viewport, `${label} has no viewport for native panning.`);
  const east = direction === "east";
  const from = {
    x: Math.round(viewport.width * (east ? 0.85 : 0.28)),
    y: Math.round(viewport.height * 0.5),
  };
  const to = {
    x: Math.round(viewport.width * (east ? 0.28 : 0.85)),
    y: from.y,
  };
  const before = await page.evaluate(
    ({ start, end }) => {
      const game = window.__CINDERLINE__;
      return {
        startElement:
          document.elementFromPoint(start.x, start.y)?.id ??
          null,
        endElement:
          document.elementFromPoint(end.x, end.y)?.id ?? null,
        centerGrid: game?.renderer.screenToGrid(
          innerWidth / 2,
          innerHeight / 2,
        ),
      };
    },
    { start: from, end: to },
  );
  assert(
    before.startElement === "world" &&
      before.endElement === "world" &&
      before.centerGrid,
    `${label} native pan lane is not fully exposed: ${JSON.stringify(before)}.`,
  );
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up({ button: "right" });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(resolve)
        )
      ),
  );
  const after = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    return {
      centerGrid: game?.renderer.screenToGrid(
        innerWidth / 2,
        innerHeight / 2,
      ),
      centerElement:
        document.elementFromPoint(
          innerWidth / 2,
          innerHeight / 2,
        )?.id ?? null,
    };
  });
  assert(
    after.centerElement === "world" &&
      after.centerGrid &&
      (
        east
          ? after.centerGrid.x > before.centerGrid.x
          : after.centerGrid.x < before.centerGrid.x
      ),
    `${label} native ${direction} pan did not move the camera as required: ${JSON.stringify({
      before,
      after,
    })}.`,
  );
  return {
    type: "native-right-drag",
    direction,
    from,
    to,
    steps: 12,
    beforeCenterGrid: before.centerGrid,
    afterCenterGrid: after.centerGrid,
  };
}

async function twoAnimationFrames(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(resolve)
        )
      ),
  );
}

async function readCampaignCameraState(page) {
  return page.evaluate(() => {
    const renderer = window.__CINDERLINE__?.renderer;
    const authoring =
      window.__CINDERLINE__?.railAuthoringState();
    return {
      focus: {
        x: renderer?.focusPoint?.x ?? null,
        z: renderer?.focusPoint?.z ?? null,
      },
      camera: {
        x: renderer?.camera?.position?.x ?? null,
        y: renderer?.camera?.position?.y ?? null,
        z: renderer?.camera?.position?.z ?? null,
      },
      centerGrid: renderer?.screenToGrid(
        innerWidth / 2,
        innerHeight / 2,
      ),
      authoring: {
        open: authoring?.open ?? false,
        selectedTool: authoring?.selectedTool ?? null,
        rotation: authoring?.rotation ?? null,
      },
    };
  });
}

async function nativeCampaignCameraPan(
  page,
  {
    label,
    from,
    to,
    axis,
    direction,
    expectedAuthoringOpen,
  },
) {
  const before = await readCampaignCameraState(page);
  assert(
    before.authoring.selectedTool === null &&
      before.authoring.open === expectedAuthoringOpen,
    `${label} must run with no selected tool and the expected authoring visibility: ${JSON.stringify(before.authoring)}.`,
  );
  const lane = await page.evaluate(
    ({ start, end }) => ({
      start:
        document.elementFromPoint(start.x, start.y)?.id ?? null,
      end: document.elementFromPoint(end.x, end.y)?.id ?? null,
    }),
    { start: from, end: to },
  );
  assert(
    lane.start === "world" && lane.end === "world",
    `${label} native pan lane is covered: ${JSON.stringify(lane)}.`,
  );
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(to.x, to.y, { steps: 1 });
  await page.mouse.up({ button: "right" });
  await twoAnimationFrames(page);
  const after = await readCampaignCameraState(page);
  const delta = {
    focusX: after.focus.x - before.focus.x,
    focusZ: after.focus.z - before.focus.z,
    cameraX: after.camera.x - before.camera.x,
    cameraY: after.camera.y - before.camera.y,
    cameraZ: after.camera.z - before.camera.z,
    centerGridX:
      after.centerGrid.x - before.centerGrid.x,
    centerGridZ:
      after.centerGrid.z - before.centerGrid.z,
  };
  const tolerance = 0.000_001;
  const focusAxisDelta =
    axis === "x" ? delta.focusX : delta.focusZ;
  const cameraAxisDelta =
    axis === "x" ? delta.cameraX : delta.cameraZ;
  const focusCrossDelta =
    axis === "x" ? delta.focusZ : delta.focusX;
  const cameraCrossDelta =
    axis === "x" ? delta.cameraZ : delta.cameraX;
  const centerAxisDelta =
    axis === "x" ? delta.centerGridX : delta.centerGridZ;
  assert(
    Number.isFinite(focusAxisDelta) &&
      Number.isFinite(cameraAxisDelta) &&
      (
        direction === "positive"
          ? focusAxisDelta > 0 && centerAxisDelta > 0
          : focusAxisDelta < 0 && centerAxisDelta < 0
      ) &&
      Math.abs(cameraAxisDelta - focusAxisDelta) <
        tolerance &&
      Math.abs(focusCrossDelta) < tolerance &&
      Math.abs(cameraCrossDelta) < tolerance &&
      Math.abs(delta.cameraY) < tolerance &&
      after.authoring.selectedTool === null &&
      after.authoring.open === expectedAuthoringOpen,
    `${label} native pan delta is invalid: ${JSON.stringify({
      before,
      after,
      delta,
    })}.`,
  );
  return {
    label,
    nativeMethod: "right-drag",
    from,
    to,
    steps: 1,
    lane,
    axis,
    direction,
    before,
    after,
    delta,
  };
}

function campaignCameraRestoreAudit(
  baseline,
  restored,
  forwardHorizontal,
  forwardVertical,
  inverseVertical,
  inverseHorizontal,
) {
  const tolerance = 0.000_001;
  const residual = {
    focusX: restored.focus.x - baseline.focus.x,
    focusZ: restored.focus.z - baseline.focus.z,
    cameraX: restored.camera.x - baseline.camera.x,
    cameraY: restored.camera.y - baseline.camera.y,
    cameraZ: restored.camera.z - baseline.camera.z,
    horizontalFocus:
      forwardHorizontal.delta.focusX +
      inverseHorizontal.delta.focusX,
    horizontalCamera:
      forwardHorizontal.delta.cameraX +
      inverseHorizontal.delta.cameraX,
    verticalFocus:
      forwardVertical.delta.focusZ +
      inverseVertical.delta.focusZ,
    verticalCamera:
      forwardVertical.delta.cameraZ +
      inverseVertical.delta.cameraZ,
  };
  assert(
    Object.values(residual).every(
      (value) =>
        Number.isFinite(value) &&
        Math.abs(value) < tolerance,
    ) &&
      restored.centerGrid.x === baseline.centerGrid.x &&
      restored.centerGrid.z === baseline.centerGrid.z &&
      restored.authoring.open === false &&
      restored.authoring.selectedTool === null,
    `Campaign camera did not return to its exact baseline: ${JSON.stringify({
      baseline,
      restored,
      residual,
      tolerance,
    })}.`,
  );
  return {
    tolerance,
    baseline,
    restored,
    residual,
  };
}

async function readPauseUiState(page) {
  return page.evaluate(() => ({
    plateOpen:
      document.querySelector("[data-ref='pause-plate']")
        ?.classList.contains("is-open") ?? false,
    plateAriaHidden:
      document.querySelector("[data-ref='pause-plate']")
        ?.getAttribute("aria-hidden") ?? null,
    buttonLabel:
      document.querySelector("[data-action='pause']")
        ?.getAttribute("aria-label") ?? null,
  }));
}

function assertRunningPauseState(state, label) {
  assert(
    state.plateOpen === false &&
      state.plateAriaHidden === "true" &&
      state.buttonLabel === "Pause simulation",
    `${label} unexpectedly exposes PAUSED state: ${JSON.stringify(state)}.`,
  );
}

function assertPausedPauseState(state, label) {
  assert(
    state.plateOpen === true &&
      state.plateAriaHidden === "false" &&
      state.buttonLabel === "Resume simulation",
    `${label} did not enter authoritative pause: ${JSON.stringify(state)}.`,
  );
}

async function screenshot(page, name) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll("[data-toast-id]").length === 0,
    undefined,
    { timeout: 12_000 },
  );
  const viewportAudit = await page.evaluate(() => {
    const canvas = document.querySelector("#world");
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const bounds = canvas.getBoundingClientRect();
    let exposedSamples = 0;
    for (let row = 1; row <= 8; row += 1) {
      for (let column = 1; column <= 8; column += 1) {
        const x = (innerWidth * column) / 9;
        const y = (innerHeight * row) / 9;
        if (document.elementFromPoint(x, y) === canvas) {
          exposedSamples += 1;
        }
      }
    }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      canvas: {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
      },
      toasts: document.querySelectorAll("[data-toast-id]").length,
      exposedSamples,
    };
  });
  const expectedViewport = page.viewportSize();
  assert(
    viewportAudit &&
      expectedViewport &&
      viewportAudit.viewport.width === expectedViewport.width &&
      viewportAudit.viewport.height === expectedViewport.height &&
      viewportAudit.canvas.left === 0 &&
      viewportAudit.canvas.top === 0 &&
      viewportAudit.canvas.right === expectedViewport.width &&
      viewportAudit.canvas.bottom === expectedViewport.height &&
      viewportAudit.toasts === 0 &&
      viewportAudit.exposedSamples >= 4,
    `Screenshot ${name} has a covered/misaligned world or toast contamination: ${JSON.stringify(viewportAudit)}.`,
  );
  const path = resolve(OUTPUT_DIRECTORY, name);
  await page.screenshot({
    path,
    animations: "disabled",
  });
  const png = await readFile(path);
  assert(
    png.subarray(1, 4).toString("ascii") === "PNG" &&
      png.readUInt32BE(16) === expectedViewport.width &&
      png.readUInt32BE(20) === expectedViewport.height,
    `Screenshot ${name} does not have exact ${expectedViewport.width}×${expectedViewport.height} PNG dimensions.`,
  );
  screenshots.push(name);
}

async function campaignScreenshot(page, name) {
  const campaignAudit = await page.evaluate(() => ({
    pausePlateOpen:
      document.querySelector("[data-ref='pause-plate']")
        ?.classList.contains("is-open") ?? false,
    pausePlateAriaHidden:
      document.querySelector("[data-ref='pause-plate']")
        ?.getAttribute("aria-hidden") ?? null,
    pauseButtonLabel:
      document.querySelector("[data-action='pause']")
        ?.getAttribute("aria-label") ?? null,
    campaignSegments:
      window.__CINDERLINE__?.railAuthoringState().network
        ?.graph.nodes.filter((node) =>
          node.segmentId.startsWith("campaign-")
        ).length ?? 0,
    denseSegments:
      window.__CINDERLINE__?.railAuthoringState().network
        ?.graph.nodes.filter((node) =>
          node.segmentId.startsWith("dense-")
        ).length ?? 0,
  }));
  assert(
    !campaignAudit.pausePlateOpen &&
      campaignAudit.pausePlateAriaHidden === "true" &&
      campaignAudit.pauseButtonLabel === "Pause simulation" &&
      campaignAudit.campaignSegments >= 36 &&
      campaignAudit.denseSegments === 0,
    `Campaign visual ${name} is paused, dense, or not the real campaign district: ${JSON.stringify(campaignAudit)}.`,
  );
  await screenshot(page, name);
}

async function selectTool(page, kind, method = "click") {
  if ((await readRailState(page)).selectedTool === kind) return;
  const tool = page.locator(`[data-rail-tool="${kind}"]`);
  await tool.scrollIntoViewIfNeeded();
  if (method === "tap") await tool.tap();
  else await tool.click();
  await page.waitForFunction(
    (selectedKind) =>
      window.__CINDERLINE__?.railAuthoringState().selectedTool ===
      selectedKind,
    kind,
  );
}

async function setRotation(page, rotation) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const state = await readRailState(page);
    if (state.rotation === rotation) return;
    await page.locator("[data-action='rail-rotate']").click();
  }
  throw new Error(`Could not set rail authoring rotation ${rotation}.`);
}

async function nativeHoverBurst(page, minimumSamples = 120) {
  const layout = await page.evaluate(() => {
    const canvas = document.querySelector("#world");
    const consoleElement = document.querySelector(
      "[data-ref='rail-console']",
    );
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const canvasBounds = canvas.getBoundingClientRect();
    const consoleBounds =
      consoleElement instanceof HTMLElement &&
      !consoleElement.hidden &&
      !consoleElement.classList.contains("is-collapsed")
        ? consoleElement.getBoundingClientRect()
        : null;
    return {
      left: Math.max(
        canvasBounds.left + 20,
        consoleBounds ? consoleBounds.right + 12 : canvasBounds.left + 20,
      ),
      right: canvasBounds.right - 20,
      top: Math.max(canvasBounds.top + 95, 95),
      bottom: canvasBounds.bottom - 145,
    };
  });
  assert(layout && layout.right - layout.left > 120, "No hover lane.");
  const legs = Math.ceil(minimumSamples / 24);
  await page.mouse.move(layout.left, layout.top);
  for (let index = 0; index < legs; index += 1) {
    const y =
      layout.top +
      ((layout.bottom - layout.top) * (index + 1)) / (legs + 1);
    await page.mouse.move(
      index % 2 === 0 ? layout.right : layout.left,
      y,
      { steps: 24 },
    );
  }
}

async function measureNativeHoverWindow(
  page,
  label,
  minimumSamples = 144,
) {
  const waitStarted = performance.now();
  const countBeforeAlignment = await page.evaluate(
    () =>
      window.__CINDERLINE__?.simulation.serializationCount() ??
      null,
  );
  assert(
    Number.isSafeInteger(countBeforeAlignment),
    `${label} hover alignment could not read the serialization counter.`,
  );
  await page.waitForFunction(
    (count) =>
      (
        window.__CINDERLINE__?.simulation.serializationCount() ??
        count
      ) > count,
    countBeforeAlignment,
    { timeout: 35_000, polling: 50 },
  );
  const aligned = await page.evaluate(() => ({
    count:
      window.__CINDERLINE__?.simulation.serializationCount() ??
      null,
    browserPerformanceMilliseconds: performance.now(),
    wallClock: new Date().toISOString(),
  }));
  const alignmentWaitMilliseconds =
    performance.now() - waitStarted;
  assert(
    aligned.count === countBeforeAlignment + 1,
    `${label} hover alignment did not observe exactly one normal autosave: ${JSON.stringify({
      countBeforeAlignment,
      aligned,
    })}.`,
  );

  const burstStarted = performance.now();
  const serializationBefore = aligned.count;
  await nativeHoverBurst(page, minimumSamples);
  const serializationAfter = await page.evaluate(
    () =>
      window.__CINDERLINE__?.simulation.serializationCount() ??
      null,
  );
  const burstDurationMilliseconds =
    performance.now() - burstStarted;
  assert(
    burstDurationMilliseconds <= 5_000,
    `${label} native hover burst exceeded 5 seconds: ${burstDurationMilliseconds.toFixed(3)}ms.`,
  );
  assert(
    serializationAfter === serializationBefore,
    `${label} native hover called simulation.serialize(): ${JSON.stringify({
      serializationBefore,
      serializationAfter,
      burstDurationMilliseconds,
    })}.`,
  );
  return {
    countBeforeAlignment,
    postAutosaveCount: aligned.count,
    postAutosaveBrowserPerformanceMilliseconds:
      aligned.browserPerformanceMilliseconds,
    postAutosaveWallClock: aligned.wallClock,
    alignmentWaitMilliseconds,
    minimumSamples,
    serializationBefore,
    serializationAfter,
    burstDurationMilliseconds,
  };
}

async function pageHasFocus(page, selector) {
  return page.locator(selector).evaluate(
    (element) => document.activeElement === element,
  );
}

async function readStorageCoal(page, storageId) {
  return page.evaluate((id) => {
    const storage = window.__CINDERLINE__?.simulation.getEntity(id);
    return storage?.kind === "storage"
      ? storage.inventory.coal ?? 0
      : null;
  }, storageId);
}

async function pause(page) {
  const button = page.locator("[data-action='pause']");
  if ((await button.getAttribute("aria-label")) === "Pause simulation") {
    await button.click();
  }
  await page.waitForFunction(
    () =>
      document.querySelector("[data-action='pause']")
        ?.getAttribute("aria-label") === "Resume simulation",
  );
}

async function resume(page) {
  const button = page.locator("[data-action='pause']");
  if ((await button.getAttribute("aria-label")) === "Resume simulation") {
    await button.click();
  }
  await page.waitForFunction(
    () =>
      document.querySelector("[data-action='pause']")
        ?.getAttribute("aria-label") === "Pause simulation",
  );
}

try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    hasTouch: true,
  });
  const page = await context.newPage();
  auditPage(page, "desktop");

  // Bootstrap through the game's deterministic dense fixture, then cross a
  // real navigation boundary so every authoring action runs against strict,
  // reread v6 bytes in this isolated context.
  await page.goto(
    `${BASE_URL}/?showcase&railAuthoringDense&fresh=rail-authoring-native`,
    { waitUntil: "networkidle", timeout: 30_000 },
  );
  await waitForBoot(page);
  await page.goto(`${BASE_URL}/`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await waitForBoot(page);
  const fixture = await page.evaluate(() => {
    const raw = localStorage.getItem("cinderline.autosave.v6");
    if (!raw) return null;
    const session = JSON.parse(raw);
    const rail = window.__CINDERLINE__?.railAuthoringState();
    return {
      format: session.format,
      version: session.version,
      origin: session.origin,
      segmentCount: session.simulation.railNetwork?.segments.length ?? 0,
      stationCount: session.simulation.railNetwork?.stations.length ?? 0,
      trainCount: session.simulation.railNetwork?.trains.length ?? 0,
      alloy: session.progression.alloy,
      ledgerEntries: session.railConstruction?.entries.length ?? 0,
      grantedEntries:
        session.railConstruction?.entries.filter(
          (entry) =>
            entry.source === "granted" &&
            entry.paidCost === 0,
        ).length ?? 0,
      liveSegmentCount: rail?.network?.graph.nodes.length ?? 0,
    };
  });
  assert(fixture, "The isolated v6 rail fixture was not persisted.");
  assertDeepEqual(
    {
      format: fixture.format,
      version: fixture.version,
      origin: fixture.origin,
      segmentCount: fixture.segmentCount,
      stationCount: fixture.stationCount,
      trainCount: fixture.trainCount,
      alloy: fixture.alloy,
      liveSegmentCount: fixture.liveSegmentCount,
    },
    {
      format: "cinderline-session",
      version: 6,
      origin: "legacySandbox",
      segmentCount: 2048,
      stationCount: 4,
      trainCount: 1,
      alloy: 1_000_000,
      liveSegmentCount: 2048,
    },
    "Strict v6 dense fixture identity changed.",
  );
  assert(
    fixture.ledgerEntries === fixture.grantedEntries,
    "The v6 bootstrap ledger was not wholly granted.",
  );
  proof.fixture = fixture;

  const canvas = page.locator("#world");
  await canvas.focus();
  await page.keyboard.press("KeyT");
  await page.waitForFunction(
    () => window.__CINDERLINE__?.railAuthoringState().open === true,
  );
  await page.waitForTimeout(25);
  assert(
    await pageHasFocus(
      page,
      "[data-ref='rail-console'] [data-action='rail-toggle']",
    ),
    "Opening with T did not focus Close.",
  );
  const toolAudit = await page.locator("[data-rail-tool]").evaluateAll(
    (tools) =>
      tools.map((tool) => ({
        kind: tool.dataset.railTool,
        enabled: tool.dataset.railEnabled,
        ariaDisabled: tool.getAttribute("aria-disabled"),
        hasIcon: Boolean(tool.querySelector("svg")),
      })),
  );
  assert(toolAudit.length === 8, "Rail console does not expose eight tools.");
  assert(
    toolAudit.every(
      (tool) =>
        tool.enabled === "true" &&
        tool.ariaDisabled === "false" &&
        tool.hasIcon,
    ),
    "Strict fixture is not fully unlocked with eight pictograms.",
  );

  await page.keyboard.press("Digit1");
  await page.waitForFunction(
    () =>
      window.__CINDERLINE__?.railAuthoringState().selectedTool ===
      "straight",
  );
  await page.keyboard.press("KeyR");
  await page.waitForFunction(
    () => window.__CINDERLINE__?.railAuthoringState().rotation === 1,
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      window.__CINDERLINE__?.railAuthoringState().selectedTool === null,
  );
  await page.keyboard.press("KeyT");
  await page.waitForFunction(
    () => window.__CINDERLINE__?.railAuthoringState().open === false,
  );
  await page.waitForTimeout(25);
  assert(
    await pageHasFocus(page, "#world"),
    "Explicit T close did not restore canvas focus.",
  );

  await page.keyboard.press("KeyT");
  await page.waitForFunction(
    () => window.__CINDERLINE__?.railAuthoringState().open === true,
  );
  await canvas.focus();
  await page.keyboard.press("KeyB");
  await page.waitForFunction(
    () =>
      window.__CINDERLINE__?.railAuthoringState().open === false &&
      window.__CINDERLINE__?.blueprint.mode === "capture",
  );
  const switchedConsole = await page.locator(
    "[data-ref='rail-console']",
  ).evaluate((element) => ({
    hidden: element.hidden,
    inert: element.hasAttribute("inert"),
  }));
  assertDeepEqual(
    switchedConsole,
    { hidden: true, inert: true },
    "Blueprint mode did not synchronously hide and inert rail authoring.",
  );
  await page.keyboard.press("Escape");
  await canvas.focus();
  await page.keyboard.press("KeyT");
  await page.waitForFunction(
    () => window.__CINDERLINE__?.railAuthoringState().open === true,
  );
  proof.keyboardAndModes = {
    openFocus: "close",
    toolHotkey: "straight",
    rotationDegrees: 90,
    cancelCleared: true,
    explicitCloseFocus: "world-canvas",
    blueprintSwitch: switchedConsole,
  };
  await pause(page);

  // A native focus-triggered tool rebuild must retain the same semantic tool.
  const straightButton = page.locator('[data-rail-tool="straight"]');
  await straightButton.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      window.__CINDERLINE__?.railAuthoringState().selectedTool ===
      "straight",
  );
  assert(
    await pageHasFocus(page, '[data-rail-tool="straight"]'),
    "Tool-grid rebuild did not restore focus to Straight.",
  );
  await setRotation(page, 1);

  // Reach a genuine outside-world edge with a native right-drag pan, exercise
  // it, then restore the camera with the exact inverse drag.
  await page.mouse.move(1_700, 540);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(1_000, 540, { steps: 12 });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(50);
  const edgePoints = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    const canvas = document.querySelector("#world");
    if (!game || !(canvas instanceof HTMLCanvasElement)) return [];
    const bounds = canvas.getBoundingClientRect();
    const candidates = [];
    for (const [x, y] of [
      [bounds.left + 2, bounds.top + 2],
      [bounds.right - 2, bounds.top + 2],
      [bounds.left + 2, bounds.bottom - 2],
      [bounds.right - 2, bounds.bottom - 2],
      [bounds.left + 2, bounds.top + bounds.height / 2],
      [bounds.right - 2, bounds.top + bounds.height / 2],
    ]) {
      if (document.elementFromPoint(x, y) !== canvas) continue;
      const grid = game.renderer.screenToGrid(x, y);
      if (
        grid &&
        (
          grid.x < 0 ||
          grid.z < 0 ||
          grid.x >= game.snapshot().width ||
          grid.z >= game.snapshot().height
        )
      ) candidates.push({ x, y, grid });
    }
    return candidates;
  });
  assert(edgePoints.length > 0, "No negative/outside canvas edge was visible.");
  for (const point of edgePoints) {
    await page.mouse.move(point.x, point.y);
  }
  await page.mouse.move(1_000, 540);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(1_700, 540, { steps: 12 });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(50);

  const blockedPoint = await findWorldPoint(page, {
    cell: { x: 35, z: 23 },
  });
  await page.mouse.move(blockedPoint.x, blockedPoint.y);
  await page.waitForFunction(
    () => {
      const root = window.__CINDERLINE__?.renderer
        .getRailRendererIntegration()
        .root.getObjectByName("rail-authoring-overlay");
      return root?.userData.preview?.validity === "blocked";
    },
  );
  const blockedOverlay = await overlayState(page);
  assert(
    blockedOverlay?.preview?.validity === "blocked" &&
      blockedOverlay.blockedCue ===
        "red-tool-shape-plus-cross",
    "Occupied track did not produce a red blocked shape-plus-cross overlay.",
  );
  await page.waitForTimeout(6_300);
  await screenshot(page, "engineering-dense-blocked-track.png");

  const initialState = await readRailState(page);
  const created = {
    segments: [],
    signals: [],
    stations: [],
    trains: [],
    cars: [],
  };
  const placeTrack = async (kind, cell, screenshotName = null) => {
    await selectTool(page, kind);
    await setRotation(page, 1);
    const before = await readRailState(page);
    const beforeIds = new Set(
      before.network.graph.nodes.map((node) => node.segmentId),
    );
    const point = await findWorldPoint(page, { cell });
    await page.mouse.move(point.x, point.y);
    await page.waitForFunction(
      (expectedKind) => {
        const root = window.__CINDERLINE__?.renderer
          .getRailRendererIntegration()
          .root.getObjectByName("rail-authoring-overlay");
        return (
          root?.userData.preview?.buildKind === expectedKind &&
          root.userData.preview.validity === "valid"
        );
      },
      kind,
    );
    const overlay = await overlayState(page);
    assert(
      overlay.preview.validity === "valid" &&
        overlay.validCue ===
          "green-tool-shape-plus-raised-ring-check",
      `${kind} did not expose a green valid preview.`,
    );
    if (screenshotName) await screenshot(page, screenshotName);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(
      (count) =>
        (
          window.__CINDERLINE__?.railAuthoringState().network
            ?.graph.nodes.length ?? 0
        ) === count + 1,
      before.network.graph.nodes.length,
    );
    const after = await readRailState(page);
    const id = after.network.graph.nodes.find(
      (node) => !beforeIds.has(node.segmentId),
    )?.segmentId;
    assert(id, `${kind} did not create one stable segment ID.`);
    created.segments.push({ id, kind, cell });
    assert(
      after.alloy === before.alloy - TOOL_COSTS[kind],
      `${kind} did not debit exact alloy cost.`,
    );
  };
  await placeTrack(
    "straight",
    { x: 38, z: 22 },
    "engineering-dense-valid-straight.png",
  );
  await placeTrack("curve", { x: 39, z: 22 });
  await placeTrack("junction", { x: 40, z: 22 });

  const placeSignal = async (
    kind,
    sourceId,
    destinationId,
  ) => {
    await selectTool(page, kind);
    const before = await readRailState(page);
    const beforeIds = new Set(
      before.network.signals.map((signal) => signal.id),
    );
    const source = await findWorldPoint(page, {
      target: { kind: "segment", id: sourceId },
    });
    await page.mouse.click(source.x, source.y);
    await page.waitForFunction(
      (id) =>
        window.__CINDERLINE__?.railAuthoringState().sourceSegmentId === id,
      sourceId,
    );
    const sourceOverlay = await overlayState(page);
    assert(
      sourceOverlay?.sourceSegmentId === sourceId &&
        sourceOverlay.sourceCue === "cyan-diamond",
      `${kind} did not retain a cyan directed source cue.`,
    );
    const destination = await findWorldPoint(page, {
      target: { kind: "segment", id: destinationId },
    });
    await page.mouse.click(destination.x, destination.y);
    await page.waitForFunction(
      (count) =>
        (
          window.__CINDERLINE__?.railAuthoringState().network
            ?.signals.length ?? 0
        ) === count + 1,
      before.network.signals.length,
    );
    const after = await readRailState(page);
    const id = after.network.signals.find(
      (signal) => !beforeIds.has(signal.id),
    )?.id;
    assert(id, `${kind} did not create one stable signal ID.`);
    assert(
      after.sourceSegmentId === null,
      `${kind} did not clear its source after completion.`,
    );
    assert(
      after.alloy === before.alloy - TOOL_COSTS[kind],
      `${kind} did not debit exact alloy cost.`,
    );
    created.signals.push({
      id,
      kind,
      sourceId,
      destinationId,
    });
  };
  await placeSignal(
    "regularSignal",
    "dense-19-31",
    "dense-19-32",
  );
  await placeSignal(
    "chainSignal",
    "dense-19-33",
    "dense-19-34",
  );

  await selectTool(page, "station");
  const beforeStation = await readRailState(page);
  const stationIdsBefore = new Set(
    beforeStation.network.stations.map((station) => station.id),
  );
  const stationSegment = await findWorldPoint(page, {
    target: { kind: "segment", id: "dense-18-38" },
  });
  await page.mouse.click(stationSegment.x, stationSegment.y);
  await page.waitForFunction(
    (count) =>
      (
        window.__CINDERLINE__?.railAuthoringState().network
          ?.stations.length ?? 0
      ) === count + 1,
    beforeStation.network.stations.length,
  );
  const afterStation = await readRailState(page);
  const authoredStationId = afterStation.network.stations.find(
    (station) => !stationIdsBefore.has(station.id),
  )?.id;
  assert(authoredStationId, "Station tool did not create a stable station.");
  assert(
    afterStation.alloy ===
      beforeStation.alloy - TOOL_COSTS.station,
    "Station did not debit 24 alloy.",
  );
  created.stations.push(authoredStationId);

  await page.locator("[data-action='rail-cancel']").click();
  const fuelStationPoint = await findWorldPoint(page, {
    target: { kind: "station", id: "dense-fuel-service" },
  });
  await page.mouse.click(fuelStationPoint.x, fuelStationPoint.y);
  await page.waitForFunction(
    () =>
      document.querySelector("[data-rail-station-form]")
        ?.getAttribute("data-station-id") === "dense-fuel-service",
  );
  const stationForm = page.locator("[data-rail-station-form]");
  await stationForm.scrollIntoViewIfNeeded();
  const storageSelect = stationForm.locator("[data-rail-storage]");
  const storageId = await storageSelect.evaluate((select) => {
    const option = [...select.options].find((candidate) => candidate.value);
    return option ? Number(option.value) : null;
  });
  assert(Number.isSafeInteger(storageId), "Fuel storage is not selectable.");
  await storageSelect.selectOption(String(storageId));
  await stationForm.locator("[data-rail-mode]").selectOption("load");

  const stationRate = stationForm.locator("[data-rail-rate]");
  const initialNoFilter = stationForm.locator(
    "[data-rail-no-filter]",
  );
  await stationRate.scrollIntoViewIfNeeded();
  await stationRate.click();
  assert(
    await pageHasFocus(page, "[data-rail-rate]"),
    "Native text/number input click was intercepted by the world canvas.",
  );
  await initialNoFilter.scrollIntoViewIfNeeded();
  const initialFilterState = await initialNoFilter.isChecked();
  await initialNoFilter.click();
  assert(
    (await initialNoFilter.isChecked()) !== initialFilterState,
    "Native checkbox click was intercepted by the world canvas.",
  );
  await initialNoFilter.click();
  assert(
    (await initialNoFilter.isChecked()) === initialFilterState,
    "Native checkbox did not return to its original draft state.",
  );
  const pointerRoutingAudit = await page.evaluate(() => ({
    inputPointerEvents: getComputedStyle(
      document.querySelector("[data-rail-rate]"),
    ).pointerEvents,
    checkboxPointerEvents: getComputedStyle(
      document.querySelector("[data-rail-no-filter]"),
    ).pointerEvents,
    exposedWorld:
      document.elementFromPoint(
        Math.floor(innerWidth * 0.72),
        Math.floor(innerHeight * 0.5),
      )?.id,
  }));
  assertDeepEqual(
    pointerRoutingAudit,
    {
      inputPointerEvents: "auto",
      checkboxPointerEvents: "auto",
      exposedWorld: "world",
    },
    "HUD form pointer routing or exposed world interaction is invalid.",
  );
  await stationForm.evaluate((form) => {
    window.__railQaStationForm = form;
  });
  await stationRate.fill("777");
  await stationRate.focus();
  const stationHoverWindow = await measureNativeHoverWindow(
    page,
    "Dense selected-station",
    144,
  );
  const serializationBeforeStationHover =
    stationHoverWindow.serializationBefore;
  const stationHoverState = await readRailState(page);
  const stationPerf = await page.evaluate(
    () => window.__CINDERLINE__?.railHoverPerformance().station,
  );
  assert(
    stationHoverState.serializationCount ===
      serializationBeforeStationHover,
    "Native station hover called simulation.serialize().",
  );
  assert(
    stationPerf.samples >= 100 &&
      stationPerf.p95Milliseconds < 8,
    `Dense selected-station hover missed budget: ${JSON.stringify(stationPerf)}.`,
  );
  const stationDraftPreserved = await stationForm.evaluate((form) => ({
    sameNode: window.__railQaStationForm === form,
    rate: form.querySelector("[data-rail-rate]")?.value,
    focused:
      document.activeElement ===
      form.querySelector("[data-rail-rate]"),
  }));
  assertDeepEqual(
    stationDraftPreserved,
    { sameNode: true, rate: "777", focused: true },
    "Station draft/focus did not survive native rail hover.",
  );

  const beforeInvalidRate = mutationSignature(
    await readRailState(page),
  );
  await stationRate.fill("0");
  await stationRate.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(50);
  assertDeepEqual(
    mutationSignature(await readRailState(page)),
    beforeInvalidRate,
    "Rejected station rate mutated authoritative state/history.",
  );
  assert(
    await pageHasFocus(page, "[data-rail-rate]") &&
      (await stationRate.inputValue()) === "0",
    "Rejected station rate did not retain its invalid control and focus.",
  );

  await stationRate.fill("1");
  const noFilter = stationForm.locator("[data-rail-no-filter]");
  if (!(await noFilter.isChecked())) await noFilter.check();
  const beforeNullApply = await readRailState(page);
  await stationRate.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    ({ stationId, entityId }) =>
      window.__CINDERLINE__?.railAuthoringState()
        .stationInterfaces.some(
          (binding) =>
            binding.stationId === stationId &&
            binding.storageEntityId === entityId &&
            binding.itemFilter === undefined,
        ),
    { stationId: "dense-fuel-service", entityId: storageId },
  );
  await page.waitForFunction(
    () =>
      document.activeElement?.matches(
        "[data-rail-station-form] [data-rail-editor-apply]",
      ) === true,
    undefined,
    { timeout: 2_000 },
  );
  const afterNullApply = await readRailState(page);
  assert(
    afterNullApply.undoDepth === beforeNullApply.undoDepth + 1,
    "Canonical null station filter did not record exactly one command.",
  );

  const rebuiltStationForm = page.locator("[data-rail-station-form]");
  const rebuiltNoFilter =
    rebuiltStationForm.locator("[data-rail-no-filter]");
  await rebuiltNoFilter.uncheck();
  const rebuiltRate = rebuiltStationForm.locator("[data-rail-rate]");
  const beforeEmptyFilter = mutationSignature(
    await readRailState(page),
  );
  await rebuiltRate.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(50);
  assertDeepEqual(
    mutationSignature(await readRailState(page)),
    beforeEmptyFilter,
    "Rejected empty station filter mutated state/history.",
  );
  assert(
    await pageHasFocus(page, "[data-rail-rate]") &&
      !(await rebuiltNoFilter.isChecked()) &&
      (await rebuiltStationForm.locator(
        "[data-rail-filter-item]:checked",
      ).count()) === 0,
    "Rejected empty filter did not retain its draft and focused control.",
  );
  await rebuiltStationForm
    .locator('[data-rail-filter-item][value="coal"]')
    .check();
  await rebuiltRate.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      window.__CINDERLINE__?.railAuthoringState()
        .stationInterfaces.some(
          (binding) =>
            binding.stationId === "dense-fuel-service" &&
            binding.itemFilter?.length === 1 &&
            binding.itemFilter[0] === "coal",
        ),
  );
  await page.waitForFunction(
    () =>
      document.activeElement?.matches(
        "[data-rail-station-form] [data-rail-editor-apply]",
      ) === true,
    undefined,
    { timeout: 2_000 },
  );
  await screenshot(page, "engineering-dense-station-interface.png");
  proof.stationEditor = {
    stationId: "dense-fuel-service",
    storageId,
    pointerRouting: pointerRoutingAudit,
    draftHover: stationDraftPreserved,
    rejectedRatePreserved: true,
    canonicalNullRecorded: true,
    rejectedEmptyFilterPreserved: true,
    canonicalFilter: ["coal"],
    acceptedFocus: "apply-interface",
  };

  // Locomotive placement deliberately targets exposed rail under the station,
  // not the station mesh, and every input below is a native UI/world action.
  await selectTool(page, "locomotive");
  const beforeTrain = await readRailState(page);
  const trainIdsBefore = new Set(
    beforeTrain.network.trains.map((train) => train.id),
  );
  const fuelSegmentPoint = await findWorldPoint(page, {
    target: { kind: "segment", id: "dense-15-28" },
  });
  await page.mouse.click(fuelSegmentPoint.x, fuelSegmentPoint.y);
  await page.waitForFunction(
    (count) =>
      (
        window.__CINDERLINE__?.railAuthoringState().network
          ?.trains.length ?? 0
      ) === count + 1,
    beforeTrain.network.trains.length,
  );
  const afterTrain = await readRailState(page);
  const trainId = afterTrain.network.trains.find(
    (train) => !trainIdsBefore.has(train.id),
  )?.id;
  assert(trainId, "Locomotive tool did not create one train.");
  assert(
    afterTrain.alloy ===
      beforeTrain.alloy - TOOL_COSTS.locomotive,
    "Locomotive did not debit 60 alloy.",
  );
  created.trains.push(trainId);

  await selectTool(page, "cargoWagon");
  const beforeWagon = await readRailState(page);
  const authoredTrainBeforeWagon = beforeWagon.network.trains.find(
    (train) => train.id === trainId,
  );
  const carIdsBefore = new Set(
    authoredTrainBeforeWagon.cars.map((car) => car.id),
  );
  const trainPoint = await findWorldPoint(page, {
    target: { kind: "train", id: trainId },
  });
  await page.mouse.click(trainPoint.x, trainPoint.y);
  await page.waitForFunction(
    ({ id, count }) =>
      window.__CINDERLINE__?.railAuthoringState().network
        ?.trains.find((train) => train.id === id)?.cars.length ===
      count + 1,
    { id: trainId, count: authoredTrainBeforeWagon.cars.length },
  );
  const afterWagon = await readRailState(page);
  const authoredTrainAfterWagon = afterWagon.network.trains.find(
    (train) => train.id === trainId,
  );
  const wagonId = authoredTrainAfterWagon.cars.find(
    (car) => !carIdsBefore.has(car.id),
  )?.id;
  assert(wagonId, "Cargo wagon tool did not add one stable car.");
  assert(
    afterWagon.alloy ===
      beforeWagon.alloy - TOOL_COSTS.cargoWagon,
    "Cargo wagon did not debit 24 alloy.",
  );
  created.cars.push(wagonId);
  await page.locator("[data-action='rail-cancel']").click();

  const selectTrainPoint = await findWorldPoint(page, {
    target: { kind: "train", id: trainId },
  });
  await page.mouse.click(selectTrainPoint.x, selectTrainPoint.y);
  await page.waitForFunction(
    (id) =>
      document.querySelector("[data-rail-schedule-form]")
        ?.getAttribute("data-train-id") === id,
    trainId,
  );

  const beforeEditorConsist = await readRailState(page);
  const editorTrainBefore = beforeEditorConsist.network.trains.find(
    (train) => train.id === trainId,
  );
  const editorCarIds = new Set(
    editorTrainBefore.cars.map((car) => car.id),
  );
  const addLocomotive = page.locator(
    '[data-rail-editor-action="consist-locomotive"]',
  );
  await addLocomotive.scrollIntoViewIfNeeded();
  await addLocomotive.click();
  await page.waitForFunction(
    ({ id, count }) =>
      window.__CINDERLINE__?.railAuthoringState().network
        ?.trains.find((train) => train.id === id)?.cars.length ===
      count + 1,
    { id: trainId, count: editorTrainBefore.cars.length },
  );
  const withExtraLocomotive = await readRailState(page);
  const addedLocomotiveId = withExtraLocomotive.network.trains
    .find((train) => train.id === trainId)
    .cars.find((car) => !editorCarIds.has(car.id))?.id;
  assert(addedLocomotiveId, "Consist editor did not add a locomotive.");
  const addedRow = page.locator(
    `[data-rail-car-id="${addedLocomotiveId}"]`,
  );
  await addedRow.locator(
    '[data-rail-editor-action="car-remove"]',
  ).click();
  await page.waitForFunction(
    ({ id, count }) =>
      window.__CINDERLINE__?.railAuthoringState().network
        ?.trains.find((train) => train.id === id)?.cars.length ===
      count,
    { id: trainId, count: editorTrainBefore.cars.length },
  );
  const afterEditorConsist = await readRailState(page);
  assert(
    afterEditorConsist.alloy === beforeEditorConsist.alloy,
    "Editor add/remove did not return exact paid provenance.",
  );

  const scheduleForm = page.locator("[data-rail-schedule-form]");
  for (let index = 0; index < 3; index += 1) {
    await scheduleForm.locator(
      '[data-rail-editor-action="schedule-add"]',
    ).click();
  }
  const rows = scheduleForm.locator("[data-rail-stop]");
  assert((await rows.count()) === 5, "Schedule editor did not reach 5 stops.");
  const controlAudit = await rows.evaluateAll((stops) =>
    stops.map((stop, index) => {
      const read = (action) => {
        const button = stop.querySelector(
          `[data-rail-editor-action="${action}"]`,
        );
        return {
          disabled: button?.disabled,
          ariaDisabled: button?.getAttribute("aria-disabled"),
        };
      };
      return {
        index,
        legend: stop.querySelector("legend span")?.textContent,
        up: read("schedule-up"),
        down: read("schedule-down"),
        remove: read("schedule-remove"),
      };
    }),
  );
  assert(
    controlAudit[0].up.disabled &&
      controlAudit[0].up.ariaDisabled === "true" &&
      controlAudit.at(-1).down.disabled &&
      controlAudit.at(-1).down.ariaDisabled === "true" &&
      controlAudit.every(
        (row, index) =>
          row.legend === String(index + 1) &&
          !row.remove.disabled &&
          row.remove.ariaDisabled === "false",
      ),
    "Schedule order controls/ARIA are not exact after local add.",
  );

  const waitTypes = [
    "time",
    "cargo-full",
    "cargo-empty",
    "item-at-least",
    "item-at-most",
  ];
  const stationOptions = await rows.first().locator(
    "[data-rail-stop-station] option",
  ).evaluateAll((options) => options.map((option) => option.value));
  assert(
    stationOptions.includes("dense-fuel-service") &&
      stationOptions.includes("dense-route-service"),
    "Authored train schedule is missing its physical route stations.",
  );
  const scheduleStations = [
    "dense-fuel-service",
    "dense-route-service",
    ...stationOptions.filter(
      (id) =>
        id !== "dense-fuel-service" &&
        id !== "dense-route-service",
    ),
  ];
  for (let index = 0; index < 5; index += 1) {
    const row = rows.nth(index);
    await row.locator("[data-rail-stop-station]").selectOption(
      scheduleStations[index % scheduleStations.length],
    );
    await row.locator("[data-rail-wait-type]").selectOption(
      waitTypes[index],
    );
    if (waitTypes[index] === "time") {
      await row.locator("[data-rail-wait-ticks]").fill("0");
    }
    if (
      waitTypes[index] === "item-at-least" ||
      waitTypes[index] === "item-at-most"
    ) {
      await row.locator("[data-rail-wait-item]").selectOption(
        index === 3 ? "coal" : "ironOre",
      );
      await row.locator("[data-rail-wait-count]").fill(
        index === 3 ? "2" : "3",
      );
    }
  }

  await scheduleForm.evaluate((form) => {
    window.__railQaScheduleForm = form;
  });
  const draftTicks = rows.first().locator("[data-rail-wait-ticks]");
  await draftTicks.fill("777");
  await draftTicks.focus();
  await nativeHoverBurst(page, 48);
  const scheduleDraftPreserved = await scheduleForm.evaluate((form) => ({
    sameNode: window.__railQaScheduleForm === form,
    ticks: form.querySelector("[data-rail-wait-ticks]")?.value,
    focused:
      document.activeElement ===
      form.querySelector("[data-rail-wait-ticks]"),
  }));
  assertDeepEqual(
    scheduleDraftPreserved,
    { sameNode: true, ticks: "777", focused: true },
    "Schedule draft/focus did not survive native hover.",
  );
  const beforeInvalidSchedule = mutationSignature(
    await readRailState(page),
  );
  await draftTicks.fill("-1");
  await draftTicks.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(50);
  assertDeepEqual(
    mutationSignature(await readRailState(page)),
    beforeInvalidSchedule,
    "Rejected schedule ticks mutated authoritative state/history.",
  );
  const rejectedScheduleDraft = await scheduleForm.evaluate(
    (form) => ({
      sameNode: window.__railQaScheduleForm === form,
      ticks: form.querySelector("[data-rail-wait-ticks]")?.value,
      focused:
        document.activeElement ===
        form.querySelector("[data-rail-wait-ticks]"),
    }),
  );
  assertDeepEqual(
    rejectedScheduleDraft,
    { sameNode: true, ticks: "-1", focused: true },
    "Rejected schedule did not retain its invalid draft/control focus.",
  );
  await draftTicks.fill("0");
  await draftTicks.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    ({ id, types }) => {
      const schedule = window.__CINDERLINE__?.railAuthoringState()
        .network?.trains.find((train) => train.id === id)?.schedule;
      return (
        schedule?.length === types.length &&
        schedule[0]?.stationId === "dense-fuel-service" &&
        schedule[1]?.stationId === "dense-route-service" &&
        schedule.every(
          (stop, index) => stop.wait.type === types[index],
        )
      );
    },
    { id: trainId, types: waitTypes },
  );
  await page.waitForFunction(
    () =>
      document.activeElement?.matches(
        "[data-rail-schedule-form] [data-rail-editor-apply]",
      ) === true,
    undefined,
    { timeout: 2_000 },
  );
  await screenshot(
    page,
    "engineering-dense-train-schedule-consist.png",
  );

  const coalBefore = await readStorageCoal(page, storageId);
  const preFuel = await readRailState(page);
  const preFuelTrain = preFuel.network.trains.find(
    (train) => train.id === trainId,
  );
  const preFuelValue = preFuelTrain.fuelMilli;
  const fuelButton = page.locator(
    '[data-rail-editor-action="locomotive-fuel"]:not([disabled])',
  ).first();
  await fuelButton.scrollIntoViewIfNeeded();
  await fuelButton.click();
  await page.waitForFunction(
    ({ id, value }) =>
      (
        window.__CINDERLINE__?.railAuthoringState().network
          ?.trains.find((train) => train.id === id)?.fuelMilli ?? 0
      ) > value,
    { id: trainId, value: preFuelValue },
  );
  const postFuel = await readRailState(page);
  const coalAfter = await readStorageCoal(page, storageId);
  const postFuelValue = postFuel.network.trains.find(
    (train) => train.id === trainId,
  ).fuelMilli;
  const consumedCoal = coalBefore - coalAfter;
  assert(
    consumedCoal > 0 &&
      postFuelValue - preFuelValue === consumedCoal * 4_000,
    `Fuel UI did not conserve physical coal at 4,000 fuel/coal: ${JSON.stringify({
      coalBefore,
      coalAfter,
      preFuelValue,
      postFuelValue,
    })}.`,
  );
  assert(
    postFuel.undoDepth === preFuel.undoDepth + 1,
    "Fuel transfer did not create exactly one history command.",
  );
  proof.fuelCustody = {
    storageId,
    coalBefore,
    coalAfter,
    consumedCoal,
    fuelBefore: preFuelValue,
    fuelAfter: postFuelValue,
    historyDelta: 1,
  };

  const fuelRejectBefore = mutationSignature(
    await readRailState(page),
  );
  await page.locator("[data-action='rail-cancel']").focus();
  await page.keyboard.press("Delete");
  await page.waitForTimeout(40);
  assertDeepEqual(
    mutationSignature(await readRailState(page)),
    fuelRejectBefore,
    "Fuel-bearing train dismantle rejection mutated state/history.",
  );

  await resume(page);
  await page.waitForFunction(
    (id) =>
      window.__CINDERLINE__?.railAuthoringState().network
        ?.trains.find((train) => train.id === id)?.status === "moving",
    trainId,
    { timeout: 20_000 },
  );
  await pause(page);
  const movingDraft = page.locator(
    "[data-rail-schedule-form] [data-rail-wait-ticks]",
  ).first();
  await movingDraft.evaluate((input) => {
    window.__railQaMovingDraft = input;
  });
  await movingDraft.fill("12345");
  await movingDraft.focus();
  const trainHoverWindow = await measureNativeHoverWindow(
    page,
    "Dense selected-train",
    144,
  );
  const serializationBeforeTrainHover =
    trainHoverWindow.serializationBefore;
  const movingDraftProof = await movingDraft.evaluate((input) => ({
    sameNode: window.__railQaMovingDraft === input,
    value: input.value,
    focused: document.activeElement === input,
    status: document.querySelector(
      "[data-rail-train-status]",
    )?.textContent,
  }));
  assert(
    movingDraftProof.sameNode &&
      movingDraftProof.value === "12345" &&
      movingDraftProof.focused &&
      movingDraftProof.status === "MOVING",
    "Live moving telemetry replaced or blurred the unsaved schedule draft.",
  );
  const trainHoverState = await readRailState(page);
  assert(
    trainHoverState.serializationCount ===
      serializationBeforeTrainHover,
    "Native train hover called simulation.serialize().",
  );
  const trainPerf = await page.evaluate(
    () => window.__CINDERLINE__?.railHoverPerformance().train,
  );
  assert(
    trainPerf.samples >= 100 &&
      trainPerf.p95Milliseconds < 8,
    `Dense selected-train hover missed budget: ${JSON.stringify(trainPerf)}.`,
  );

  // Pausing does not rewrite the authoritative train status, so this remains
  // a real moving-train blocker without a ticking comparison race.
  assert(
    (
      await readRailState(page)
    ).network.trains.find((train) => train.id === trainId)
      .status === "moving",
    "Pausing rewrote the moving train status under test.",
  );
  const movingRejectBefore = mutationSignature(
    await readRailState(page),
  );
  await page.locator("[data-action='rail-cancel']").focus();
  await page.keyboard.press("Delete");
  await page.waitForTimeout(40);
  assertDeepEqual(
    mutationSignature(await readRailState(page)),
    movingRejectBefore,
    "Moving train dismantle rejection mutated state/history.",
  );

  proof.hover = {
    denseSegments: fixture.segmentCount,
    serializationDelta:
      trainHoverState.serializationCount -
        serializationBeforeTrainHover +
      stationHoverState.serializationCount -
        serializationBeforeStationHover,
    train: trainPerf,
    station: stationPerf,
    liveMovingDraft: movingDraftProof,
    autosaveAlignment: {
      station: stationHoverWindow,
      train: trainHoverWindow,
    },
  };

  // Establish a deterministic physical stop with a separate, native
  // time-only route. The five-condition editor proof above is not used as a
  // travel oracle. Once stopped, reapply all five condition types with the
  // current station first and cargo-full, yielding stable reload bytes.
  const pausedTrainPoint = await findWorldPoint(page, {
    target: { kind: "train", id: trainId },
  });
  await page.mouse.click(pausedTrainPoint.x, pausedTrainPoint.y);
  await page.waitForFunction(
    (id) =>
      document.querySelector("[data-rail-schedule-form]")
        ?.getAttribute("data-train-id") === id,
    trainId,
  );
  const travelForm = page.locator("[data-rail-schedule-form]");
  while (
    (await travelForm.locator("[data-rail-stop]").count()) > 2
  ) {
    await travelForm
      .locator("[data-rail-stop]")
      .last()
      .locator('[data-rail-editor-action="schedule-remove"]')
      .click();
  }
  const travelRows = travelForm.locator("[data-rail-stop]");
  await travelRows
    .nth(0)
    .locator("[data-rail-stop-station]")
    .selectOption("dense-route-service");
  await travelRows
    .nth(1)
    .locator("[data-rail-stop-station]")
    .selectOption("dense-fuel-service");
  for (let index = 0; index < 2; index += 1) {
    const row = travelRows.nth(index);
    await row
      .locator("[data-rail-wait-type]")
      .selectOption("time");
    await row.locator("[data-rail-wait-ticks]").fill("100000");
  }
  await travelRows
    .first()
    .locator("[data-rail-wait-ticks]")
    .focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (id) => {
      const schedule = window.__CINDERLINE__?.railAuthoringState()
        .network?.trains.find((train) => train.id === id)?.schedule;
      return (
        schedule?.length === 2 &&
        schedule.every(
          (stop) =>
            stop.wait.type === "time" &&
            stop.wait.ticks === 100000,
        )
      );
    },
    trainId,
  );
  await resume(page);
  await page.waitForFunction(
    (id) => {
      const train = window.__CINDERLINE__?.railAuthoringState()
        .network?.trains.find((candidate) => candidate.id === id);
      return (
        train?.status === "dwelling" &&
        train.currentSegmentId === "dense-15-46"
      );
    },
    trainId,
    { timeout: 45_000 },
  );
  await pause(page);

  const stableForm = page.locator("[data-rail-schedule-form]");
  for (let index = 0; index < 3; index += 1) {
    await stableForm
      .locator('[data-rail-editor-action="schedule-add"]')
      .click();
  }
  const stableRows = stableForm.locator("[data-rail-stop]");
  const stableTypes = [
    "cargo-full",
    "time",
    "cargo-empty",
    "item-at-least",
    "item-at-most",
  ];
  const stableStations = [
    "dense-route-service",
    "dense-fuel-service",
    "dense-east-service",
    "dense-west-service",
    authoredStationId,
  ];
  for (let index = 0; index < stableTypes.length; index += 1) {
    const row = stableRows.nth(index);
    await row
      .locator("[data-rail-stop-station]")
      .selectOption(stableStations[index]);
    await row
      .locator("[data-rail-wait-type]")
      .selectOption(stableTypes[index]);
    if (stableTypes[index] === "time") {
      await row.locator("[data-rail-wait-ticks]").fill("0");
    }
    if (
      stableTypes[index] === "item-at-least" ||
      stableTypes[index] === "item-at-most"
    ) {
      await row
        .locator("[data-rail-wait-item]")
        .selectOption(index === 3 ? "coal" : "ironOre");
      await row
        .locator("[data-rail-wait-count]")
        .fill(index === 3 ? "2" : "3");
    }
  }
  await stableRows
    .nth(1)
    .locator("[data-rail-wait-ticks]")
    .focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    ({ id, types }) => {
      const train = window.__CINDERLINE__?.railAuthoringState()
        .network?.trains.find((candidate) => candidate.id === id);
      return (
        train?.status === "dwelling" &&
        train.currentSegmentId === "dense-15-46" &&
        train.schedule.length === types.length &&
        train.schedule.every(
          (stop, index) => stop.wait.type === types[index],
        )
      );
    },
    { id: trainId, types: stableTypes },
  );
  const stableReloadSchedule = {
    stationIds: stableStations,
    waitTypes: stableTypes,
    status: "dwelling",
  };

  await page.locator("[data-action='rail-cancel']").click();
  const junctionEntry = created.segments.find(
    (entry) => entry.kind === "junction",
  );
  const junctionPoint = await findWorldPoint(page, {
    target: { kind: "segment", id: junctionEntry.id },
  });
  await page.mouse.click(junctionPoint.x, junctionPoint.y);
  await page.waitForFunction(
    (id) =>
      window.__CINDERLINE__?.railAuthoringState().selectedTarget
        ?.segmentId === id,
    junctionEntry.id,
  );
  const dismantleButton = page.locator(
    "[data-action='rail-dismantle']",
  );
  await dismantleButton.scrollIntoViewIfNeeded();
  assert(
    !(await dismantleButton.isDisabled()),
    "Dependency-free paid junction was not dismantleable.",
  );
  const beforeDismantle = await readRailState(page);
  await dismantleButton.click();
  await page.waitForFunction(
    (id) =>
      !window.__CINDERLINE__?.railAuthoringState().network
        ?.graph.nodes.some((node) => node.segmentId === id),
    junctionEntry.id,
  );
  const afterDismantle = await readRailState(page);
  assert(
    afterDismantle.alloy ===
      beforeDismantle.alloy + TOOL_COSTS.junction,
    "Paid junction dismantle did not refund exact provenance.",
  );
  await canvas.focus();
  await page.keyboard.press("Control+KeyZ");
  await page.waitForFunction(
    (id) =>
      window.__CINDERLINE__?.railAuthoringState().network
        ?.graph.nodes.some((node) => node.segmentId === id),
    junctionEntry.id,
  );
  const afterUndo = await readRailState(page);
  assertDeepEqual(
    persistentRailSignature(afterUndo),
    persistentRailSignature(beforeDismantle),
    "Undo did not restore exact pre-dismantle rail/economy state.",
  );
  const undoTeardown = await page.evaluate(() => {
    const consoleElement = document.querySelector(
      "[data-ref='rail-console']",
    );
    const overlay = window.__CINDERLINE__?.renderer
      .getRailRendererIntegration()
      .root.getObjectByName("rail-authoring-overlay");
    return {
      open: window.__CINDERLINE__?.railAuthoringState().open,
      selectedTool:
        window.__CINDERLINE__?.railAuthoringState().selectedTool,
      selectedTarget:
        window.__CINDERLINE__?.railAuthoringState().selectedTarget,
      source:
        window.__CINDERLINE__?.railAuthoringState().sourceSegmentId,
      hidden:
        consoleElement instanceof HTMLElement
          ? consoleElement.hidden
          : false,
      inert:
        consoleElement instanceof HTMLElement
          ? consoleElement.hasAttribute("inert")
          : false,
      overlayActive: overlay?.userData.active ?? false,
    };
  });
  assertDeepEqual(
    undoTeardown,
    {
      open: false,
      selectedTool: null,
      selectedTarget: null,
      source: null,
      hidden: true,
      inert: true,
      overlayActive: false,
    },
    "Undo did not tear down every rail authoring surface.",
  );
  await page.keyboard.press("Control+KeyY");
  await page.waitForFunction(
    (id) =>
      !window.__CINDERLINE__?.railAuthoringState().network
        ?.graph.nodes.some((node) => node.segmentId === id),
    junctionEntry.id,
  );
  const afterRedo = await readRailState(page);
  assertDeepEqual(
    persistentRailSignature(afterRedo),
    persistentRailSignature(afterDismantle),
    "Redo did not restore exact post-dismantle rail/economy state.",
  );
  await page.keyboard.press("Control+KeyZ");
  await page.waitForFunction(
    (id) =>
      window.__CINDERLINE__?.railAuthoringState().network
        ?.graph.nodes.some((node) => node.segmentId === id),
    junctionEntry.id,
  );
  const finalRestored = await readRailState(page);
  assertDeepEqual(
    persistentRailSignature(finalRestored),
    persistentRailSignature(beforeDismantle),
    "Final undo did not retain the paid junction for reload/migration.",
  );
  proof.dismantleUndoRedo = {
    dismantledId: junctionEntry.id,
    refund: TOOL_COSTS.junction,
    exactUndo: true,
    exactRedo: true,
    finalState: "pre-dismantle-restored",
    teardown: undoTeardown,
  };

  const paidEntries = finalRestored.ledger.entries.filter(
    (entry) => entry.source === "paid",
  );
  for (const kind of Object.keys(TOOL_COSTS)) {
    assert(
      paidEntries.some(
        (entry) => entry.buildKind === kind,
      ),
      `No paid ledger proof for exercised tool ${kind}.`,
    );
  }
  proof.paidTools = {
    costs: TOOL_COSTS,
    created,
    initialAlloy: initialState.alloy,
    finalAlloy: finalRestored.alloy,
    paidEntries: paidEntries.map((entry) => ({
      key: entry.key,
      buildKind: entry.buildKind,
      paidCost: entry.paidCost,
    })),
  };
  proof.previews = {
    valid: {
      kind: "straight",
      cue: "green-tool-shape-plus-raised-ring-check",
    },
    blocked: blockedOverlay,
    selectedCue: "amber-ring",
    sourceCue: "cyan-diamond",
    outsideEdgeSamples: edgePoints,
  };
  proof.scheduleAndConsist = {
    trainId,
    cargoWagonId: wagonId,
    editorLocomotiveAddedAndRefunded: addedLocomotiveId,
    scheduleWaitTypes: waitTypes,
    scheduleControlAudit: controlAudit,
    draftHover: scheduleDraftPreserved,
    rejectedDraft: rejectedScheduleDraft,
    acceptedFocus: "apply-schedule",
    stableReloadSchedule,
  };
  assert(
    proof.scheduleAndConsist !== null &&
      proof.scheduleAndConsist.stableReloadSchedule ===
        stableReloadSchedule,
    "Schedule/consist proof branch was not initialized before use.",
  );

  const beforeReload = await readRailState(page);
  const persistentBeforeReload =
    persistentRailSignature(beforeReload);
  await page.reload({ waitUntil: "networkidle", timeout: 30_000 });
  await waitForBoot(page);
  const afterReload = await readRailState(page);
  assertDeepEqual(
    persistentRailSignature(afterReload),
    persistentBeforeReload,
    "v6 save/reload changed topology, IDs, schedule, interface, fuel, alloy, or ledger.",
  );
  const reloadTeardown = await page.evaluate(() => {
    const state = window.__CINDERLINE__?.railAuthoringState();
    const root = window.__CINDERLINE__?.renderer
      .getRailRendererIntegration()
      .root.getObjectByName("rail-authoring-overlay");
    return {
      open: state?.open,
      tool: state?.selectedTool,
      target: state?.selectedTarget,
      source: state?.sourceSegmentId,
      overlayActive: root?.userData.active ?? false,
    };
  });
  assertDeepEqual(
    reloadTeardown,
    {
      open: false,
      tool: null,
      target: null,
      source: null,
      overlayActive: false,
    },
    "Reload left transient rail authoring state alive.",
  );
  proof.reload = {
    exactPersistentSignature: true,
    teardown: reloadTeardown,
  };
  await screenshot(page, "engineering-dense-reloaded-world.png");

  const mobileSignalFlows = [
    {
      viewport: { width: 600, height: 800 },
      label: "engineering-dense-mobile-600",
      tool: "chainSignal",
      source: "dense-19-35",
      destination: "dense-19-36",
    },
    {
      viewport: { width: 390, height: 844 },
      label: "engineering-dense-mobile-390",
      tool: "regularSignal",
      source: "dense-19-45",
      destination: "dense-19-46",
    },
  ];
  let denseEastCameraEstablished = false;
  for (const flow of mobileSignalFlows) {
    await page.setViewportSize(flow.viewport);
    await page.waitForTimeout(180);
    const topToggle = page.locator(
      ".hud-topbar [data-action='rail-toggle']",
    );
    await topToggle.tap();
    await page.waitForFunction(
      () => window.__CINDERLINE__?.railAuthoringState().open === true,
    );
    const layout = await page.locator(
      "[data-ref='rail-console']",
    ).evaluate((consoleElement) => {
      const bounds = consoleElement.getBoundingClientRect();
      const header = consoleElement.querySelector(
        ".rail-console-header",
      );
      const actionContainer = consoleElement.querySelector(
        ".rail-console-header-actions",
      );
      const headerBounds = header?.getBoundingClientRect();
      const actionBounds = actionContainer?.getBoundingClientRect();
      const actions = [
        ...consoleElement.querySelectorAll(
          ".rail-console-header-actions button",
        ),
      ].map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          label: button.textContent?.trim(),
          width: rect.width,
          height: rect.height,
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            getComputedStyle(button).visibility !== "hidden",
        };
      });
      return {
        width: bounds.width,
        height: bounds.height,
        scrollWidth: consoleElement.scrollWidth,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        headerWidth: headerBounds?.width ?? 0,
        actionContainerWidth: actionBounds?.width ?? 0,
        actionRows: [
          ...new Set(
            actions.map((action) => {
              const button = [
                ...consoleElement.querySelectorAll(
                  ".rail-console-header-actions button",
                ),
              ].find(
                (candidate) =>
                  candidate.textContent?.trim() === action.label,
              );
              return Math.round(
                button?.getBoundingClientRect().top ?? 0,
              );
            }),
          ),
        ].length,
        actions,
        tools: [
          ...consoleElement.querySelectorAll("[data-rail-tool]"),
        ].map((button) => ({
          kind: button.dataset.railTool,
          icon: Boolean(button.querySelector("svg")),
          height: button.getBoundingClientRect().height,
        })),
      };
    });
    assert(
      layout.scrollWidth <= layout.width + 1 &&
        layout.width <= layout.viewportWidth + 1 &&
        layout.height <= layout.viewportHeight * 0.69 &&
        layout.actions.length === 4 &&
        layout.actions.every(
          (action) => action.visible && action.height >= 42,
        ) &&
        layout.tools.length === 8 &&
        layout.tools.every(
          (tool) => tool.icon && tool.height >= 44,
        ) &&
        (
          flow.viewport.width > 430 ||
          (
            layout.actionContainerWidth >=
              layout.headerWidth - 1 &&
            layout.actionRows === 2
          )
        ),
      `${flow.label} expanded console overflows or clips controls.`,
    );
    await screenshot(page, `${flow.label}-expanded.png`);
    await selectTool(page, flow.tool, "tap");
    const collapse = page.locator("[data-action='rail-collapse']");
    await collapse.scrollIntoViewIfNeeded();
    await collapse.focus();
    const initialCollapsedSettle =
      await toggleAndSettleRailTray(
        page,
        collapse,
        true,
        `${flow.label} initial collapse`,
      );
    const collapsed = await page.locator(
      "[data-ref='rail-console']",
    ).evaluate((consoleElement) => ({
      height: consoleElement.getBoundingClientRect().height,
      ariaExpanded: consoleElement
        .querySelector("[data-action='rail-collapse']")
        ?.getAttribute("aria-expanded"),
      focusAction:
        document.activeElement?.getAttribute("data-action"),
      exposedElement:
        document.elementFromPoint(
          Math.floor(innerWidth / 2),
          Math.floor(innerHeight / 2),
        )?.id,
    }));
    assertDeepEqual(
      collapsed,
      {
        height: 68,
        ariaExpanded: "false",
        focusAction: "rail-collapse",
        exposedElement: "world",
      },
      `${flow.label} compact tray did not expose/focus the map exactly.`,
    );
    const endpointAudit = await auditMobileSignalEndpoints(
      page,
      flow,
    );
    const sourcePoint = endpointAudit.sourcePoint;
    await page.touchscreen.tap(sourcePoint.x, sourcePoint.y);
    await page.waitForFunction(
      (id) =>
        window.__CINDERLINE__?.railAuthoringState().sourceSegmentId === id,
      flow.source,
    );
    const afterSource = await readRailState(page);
    const sourceStillCollapsed = await page
      .locator("[data-ref='rail-console']")
      .evaluate((element) =>
        element.classList.contains("is-collapsed")
      );
    assert(
      afterSource.selectedTool === flow.tool &&
        sourceStillCollapsed,
      `${flow.label} lost its armed signal/source while collapsed.`,
    );
    await screenshot(page, `${flow.label}-collapsed-signal-source.png`);
    const signalCount = afterSource.network.signals.length;
    const destinationPoint = endpointAudit.destinationPoint;
    await page.touchscreen.tap(
      destinationPoint.x,
      destinationPoint.y,
    );
    await page.waitForFunction(
      (count) =>
        (
          window.__CINDERLINE__?.railAuthoringState().network
            ?.signals.length ?? 0
        ) === count + 1,
      signalCount,
    );
    const stateWhileCollapsed = await readRailState(page);
    const retained = {
      tool: stateWhileCollapsed.selectedTool,
      target: stateWhileCollapsed.selectedTarget,
      source: stateWhileCollapsed.sourceSegmentId,
      status: stateWhileCollapsed.status,
    };
    await collapse.focus();
    const signalExpandedSettle =
      await toggleAndSettleRailTray(
        page,
        collapse,
        false,
        `${flow.label} signal completion expand`,
      );
    const expandedState = await readRailState(page);
    assertDeepEqual(
      {
        tool: expandedState.selectedTool,
        target: expandedState.selectedTarget,
        source: expandedState.sourceSegmentId,
        status: expandedState.status,
      },
      retained,
      `${flow.label} EDIT expansion changed tool/target/source/status.`,
    );
    assert(
      (await collapse.getAttribute("aria-expanded")) === "true" &&
        (await pageHasFocus(page, "[data-action='rail-collapse']")),
      `${flow.label} EDIT did not restore expanded ARIA/focus.`,
    );
    await screenshot(page, `${flow.label}-signal-complete-expanded.png`);

    await page.locator("[data-action='rail-cancel']").tap();
    const editorCollapsedSettle =
      await toggleAndSettleRailTray(
        page,
        collapse,
        true,
        `${flow.label} editor target collapse`,
      );
    const editorPan =
      flow.viewport.width === 600
        ? await nativeMobileCameraPan(
            page,
            "east",
            `${flow.label} east station`,
          )
        : null;
    if (editorPan) denseEastCameraEstablished = true;
    assert(
      flow.viewport.width === 600 ||
        denseEastCameraEstablished,
      `${flow.label} did not retain the proven east camera.`,
    );
    const editorTarget =
      flow.viewport.width === 600
        ? {
            kind: "station",
            id: "dense-east-service",
          }
        : { kind: "train", id: trainId };
    if (editorTarget.kind === "train") {
      const authoredTrain = (
        await readRailState(page)
      ).network.trains.find(
        (train) => train.id === trainId,
      );
      assert(
        authoredTrain?.currentSegmentId === "dense-15-46",
        `${flow.label} authored train is not at the proven route cell: ${JSON.stringify(authoredTrain)}.`,
      );
    }
    const editorTargetAudit = await auditMobileEditorTarget(
      page,
      editorTarget,
      `${flow.label} ${editorTarget.kind}`,
    );
    assert(
      editorTarget.kind === "station"
        ? (
          editorTargetAudit.cell?.x === 50 &&
          editorTargetAudit.cell?.z === 24 &&
          editorTargetAudit.picked?.kind === "station" &&
          editorTargetAudit.picked.stationId ===
            "dense-east-service"
        )
        : (
          editorTargetAudit.cell?.x === 50 &&
          editorTargetAudit.cell?.z === 19 &&
          editorTargetAudit.picked?.kind === "train" &&
          editorTargetAudit.picked.trainId === trainId
        ),
      `${flow.label} did not prove its exact east-side editor target through the native picker: ${JSON.stringify(editorTargetAudit)}.`,
    );
    const editorPoint = editorTargetAudit.client;
    await page.touchscreen.tap(editorPoint.x, editorPoint.y);
    const selectedAfterMapTap = await readRailState(page);
    const editorExpandedSettle =
      await toggleAndSettleRailTray(
        page,
        collapse,
        false,
        `${flow.label} editor expand`,
      );
    await page.waitForFunction(
      (kind) =>
        kind === "station"
          ? Boolean(document.querySelector("[data-rail-station-form]"))
          : Boolean(document.querySelector("[data-rail-schedule-form]")),
      editorTarget.kind,
    );
    const selectedAfterEditorExpand = await readRailState(page);
    assertDeepEqual(
      selectedAfterEditorExpand.selectedTarget,
      selectedAfterMapTap.selectedTarget,
      `${flow.label} editor expansion did not retain the real map target.`,
    );
    await screenshot(
      page,
      `${flow.label}-${editorTarget.kind}-editor.png`,
    );
    const close = page.locator(
      "[data-ref='rail-console'] [data-action='rail-toggle']",
    );
    await close.scrollIntoViewIfNeeded();
    await close.tap();
    await page.waitForFunction(
      () => window.__CINDERLINE__?.railAuthoringState().open === false,
    );
    await page.waitForTimeout(25);
    assert(
      await pageHasFocus(
        page,
        ".hud-topbar [data-action='rail-toggle']",
      ),
      `${flow.label} explicit Close did not return focus to its opener.`,
    );
    proof.mobile.push({
      ...flow,
      layout,
      collapsed,
      signalSourceRetained: flow.source,
      completionRetained: retained,
      editorTarget: selectedAfterEditorExpand.selectedTarget,
      closeFocus: "top-rail-toggle",
      endpointAudit: endpointAudit.proof,
      traySettles: {
        initialCollapsed: initialCollapsedSettle,
        signalExpanded: signalExpandedSettle,
        editorCollapsed: editorCollapsedSettle,
        editorExpanded: editorExpandedSettle,
      },
      editorPan,
      editorTargetAudit,
    });
  }

  const finalV6Bytes = await page.evaluate(
    () => localStorage.getItem("cinderline.autosave.v6"),
  );
  assert(finalV6Bytes, "Final v6 bytes are missing after mobile authoring.");
  const finalV6 = JSON.parse(finalV6Bytes);
  const finalLiveState = await readRailState(page);
  await context.close();

  // Presentation evidence is deliberately separate from the dense engineering
  // fixture. Start from the real fresh campaign simulation/rail district, then
  // migrate it through strict v5→v6 validation with the canonical unlocked
  // Source the all-tools unlock authority from its own canonical, non-dense
  // legacy session. The campaign visual path must not depend on the dense
  // engineering fixture even indirectly.
  const campaignUnlockContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const campaignUnlockPage = await campaignUnlockContext.newPage();
  auditPage(campaignUnlockPage, "campaign-unlock");
  await campaignUnlockPage.goto(
    `${BASE_URL}/?showcase&fresh=rail-campaign-visual-unlock`,
    { waitUntil: "networkidle", timeout: 30_000 },
  );
  await waitForBoot(campaignUnlockPage);
  await campaignUnlockPage.goto(`${BASE_URL}/`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await waitForBoot(campaignUnlockPage);
  const campaignUnlockBytes = await campaignUnlockPage.evaluate(
    () => localStorage.getItem("cinderline.autosave.v6"),
  );
  assert(
    campaignUnlockBytes,
    "Canonical non-dense unlock session did not persist strict v6 bytes.",
  );
  const campaignUnlock = JSON.parse(campaignUnlockBytes);
  assert(
    campaignUnlock.origin === "legacySandbox" &&
      campaignUnlock.progression?.mode === "legacySandbox" &&
      (
        campaignUnlock.simulation?.railNetwork?.segments
          ?.length ?? 0
      ) !== 2048,
    "Campaign visual unlock authority is not canonical and non-dense.",
  );
  await campaignUnlockContext.close();

  // Keep the exact fresh campaign simulation, construction ledger, terrain,
  // entities, and railway, while migrating only the separately sourced
  // legacy-sandbox progression. This changes fixture authority; every
  // authoring interaction and camera action below remains native.
  const campaignSeedContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const campaignSeedPage = await campaignSeedContext.newPage();
  auditPage(campaignSeedPage, "campaign-seed");
  await campaignSeedPage.goto(
    `${BASE_URL}/?fresh=rail-campaign-visual-seed`,
    { waitUntil: "networkidle", timeout: 30_000 },
  );
  await waitForBoot(campaignSeedPage);
  await campaignSeedPage.goto(`${BASE_URL}/`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await waitForBoot(campaignSeedPage);
  const campaignCampaignBytes = await campaignSeedPage.evaluate(
    () => localStorage.getItem("cinderline.autosave.v6"),
  );
  assert(
    campaignCampaignBytes,
    "Fresh campaign district did not persist strict v6 bytes.",
  );
  await campaignSeedContext.close();
  const campaignCampaign = JSON.parse(campaignCampaignBytes);
  const campaignVisualV5 = {
    ...campaignCampaign,
    version: 5,
    origin: "legacySandbox",
    coreGeneratorEntityId: null,
    progression: structuredClone(campaignUnlock.progression),
    uplinkInventory: structuredClone(
      campaignUnlock.uplinkInventory,
    ),
    uplinkEntityId: null,
  };
  delete campaignVisualV5.railConstruction;

  const campaignContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    hasTouch: true,
  });
  await campaignContext.addInitScript(
    ({ bytes }) => {
      if (!sessionStorage.getItem("rail-campaign-visual-seeded")) {
        localStorage.clear();
        localStorage.setItem("cinderline.autosave.v5", bytes);
        sessionStorage.setItem(
          "rail-campaign-visual-seeded",
          "true",
        );
      }
    },
    { bytes: JSON.stringify(campaignVisualV5) },
  );
  const campaignPage = await campaignContext.newPage();
  auditPage(campaignPage, "campaign-visual");
  await campaignPage.goto(`${BASE_URL}/`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await waitForBoot(campaignPage);
  const campaignFixtureAudit = await campaignPage.evaluate(() => {
    const state = window.__CINDERLINE__?.railAuthoringState();
    const raw = localStorage.getItem("cinderline.autosave.v6");
    const session = raw ? JSON.parse(raw) : null;
    return {
      persistedVersion: session?.version,
      persistedOrigin: session?.origin,
      campaignSegments:
        state?.network?.graph.nodes.filter((node) =>
          node.segmentId.startsWith("campaign-")
        ).length ?? 0,
      denseSegments:
        state?.network?.graph.nodes.filter((node) =>
          node.segmentId.startsWith("dense-")
        ).length ?? 0,
      stations: state?.network?.stations.map(
        (station) => station.id,
      ),
      trains: state?.network?.trains.map((train) => train.id),
    };
  });
  assert(
    campaignFixtureAudit.persistedVersion === 6 &&
      campaignFixtureAudit.persistedOrigin === "legacySandbox" &&
      campaignFixtureAudit.campaignSegments === 37 &&
      campaignFixtureAudit.denseSegments === 0 &&
      campaignFixtureAudit.stations.includes(
        "campaign-central-service",
      ) &&
      campaignFixtureAudit.stations.includes(
        "campaign-east-service",
      ) &&
      campaignFixtureAudit.trains.includes(
        "campaign-ore-runner",
      ),
    `Normal campaign visual fixture is not canonical: ${JSON.stringify(campaignFixtureAudit)}.`,
  );
  const campaignCanvas = campaignPage.locator("#world");
  await campaignCanvas.focus();
  await campaignPage.keyboard.press("KeyT");
  await campaignPage.waitForFunction(
    () => window.__CINDERLINE__?.railAuthoringState().open === true,
  );
  assert(
    (await campaignPage.locator(
      "[data-rail-tool][data-rail-enabled='true']",
    ).count()) === 8,
    "Normal campaign district is not fully unlocked for visual authoring.",
  );

  const campaignForwardHorizontal =
    await nativeCampaignCameraPan(campaignPage, {
      label: "campaign desktop east framing",
      from: { x: 1_500, y: 540 },
      to: { x: 1_360, y: 540 },
      axis: "x",
      direction: "positive",
      expectedAuthoringOpen: true,
    });
  const campaignForwardVertical =
    await nativeCampaignCameraPan(campaignPage, {
      label: "campaign desktop vertical framing",
      from: { x: 1_500, y: 500 },
      to: { x: 1_500, y: 590 },
      axis: "z",
      direction: "positive",
      expectedAuthoringOpen: true,
    });

  await selectTool(campaignPage, "straight");
  await setRotation(campaignPage, 1);
  const campaignValidPoint = await findWorldPoint(campaignPage, {
    cell: { x: 33, z: 16 },
    step: 4,
  });
  await campaignPage.mouse.move(
    campaignValidPoint.x,
    campaignValidPoint.y,
  );
  await campaignPage.waitForFunction(
    () => {
      const overlay = window.__CINDERLINE__?.renderer
        .getRailRendererIntegration()
        .root.getObjectByName("rail-authoring-overlay");
      return (
        overlay?.userData.preview?.validity === "valid" &&
        overlay.userData.validCue ===
          "green-tool-shape-plus-raised-ring-check"
      );
    },
  );
  await campaignScreenshot(
    campaignPage,
    "visual-campaign-desktop-valid-placement.png",
  );
  const campaignBeforeTrack = await readRailState(campaignPage);
  const campaignSegmentIds = new Set(
    campaignBeforeTrack.network.graph.nodes.map(
      (node) => node.segmentId,
    ),
  );
  await campaignPage.mouse.click(
    campaignValidPoint.x,
    campaignValidPoint.y,
  );
  await campaignPage.waitForFunction(
    (count) =>
      (
        window.__CINDERLINE__?.railAuthoringState().network
          ?.graph.nodes.length ?? 0
      ) === count + 1,
    campaignBeforeTrack.network.graph.nodes.length,
  );
  const campaignAfterTrack = await readRailState(campaignPage);
  const campaignPaidSegment = campaignAfterTrack.network.graph.nodes.find(
    (node) => !campaignSegmentIds.has(node.segmentId),
  )?.segmentId;
  assert(
    campaignPaidSegment,
    "Campaign visual placement did not create a paid segment.",
  );

  const campaignBlockedPoint = await findWorldPoint(campaignPage, {
    cell: { x: 31, z: 16 },
    step: 4,
  });
  await campaignPage.mouse.move(
    campaignBlockedPoint.x,
    campaignBlockedPoint.y,
  );
  await campaignPage.waitForFunction(
    () => {
      const overlay = window.__CINDERLINE__?.renderer
        .getRailRendererIntegration()
        .root.getObjectByName("rail-authoring-overlay");
      return (
        overlay?.userData.preview?.validity === "blocked" &&
        overlay.userData.blockedCue ===
          "red-tool-shape-plus-cross"
      );
    },
  );
  await campaignScreenshot(
    campaignPage,
    "visual-campaign-desktop-blocked-placement.png",
  );

  await campaignPage.locator("[data-action='rail-cancel']").click();
  const campaignPaidPoint = await findWorldPoint(campaignPage, {
    target: { kind: "segment", id: campaignPaidSegment },
  });
  await campaignPage.mouse.click(
    campaignPaidPoint.x,
    campaignPaidPoint.y,
  );
  await campaignPage.waitForFunction(
    (id) => {
      const state = window.__CINDERLINE__?.railAuthoringState();
      const overlay = window.__CINDERLINE__?.renderer
        .getRailRendererIntegration()
        .root.getObjectByName("rail-authoring-overlay");
      return (
        state?.selectedTarget?.segmentId === id &&
        overlay?.userData.selectedCue === "amber-ring"
      );
    },
    campaignPaidSegment,
  );
  assert(
    !(await campaignPage.locator(
      "[data-action='rail-dismantle']",
    ).isDisabled()),
    "Normal campaign paid segment is not ready to dismantle.",
  );
  await campaignScreenshot(
    campaignPage,
    "visual-campaign-desktop-selected-dismantle.png",
  );

  const campaignStationTarget = {
    kind: "station",
    id: "campaign-east-service",
  };
  const campaignStationPauseBefore =
    await readPauseUiState(campaignPage);
  assertRunningPauseState(
    campaignStationPauseBefore,
    "Campaign station selection precondition",
  );
  await pause(campaignPage);
  const campaignStationPauseDuring =
    await readPauseUiState(campaignPage);
  assertPausedPauseState(
    campaignStationPauseDuring,
    "Campaign station selection",
  );
  const campaignStationTargetScan =
    await scanProjectedStationTarget(
      campaignPage,
      campaignStationTarget.id,
    );
  const campaignStationPoint =
    exactNativeTargetRepresentative(
      campaignStationTargetScan,
      campaignStationTarget,
    );
  await campaignPage.mouse.click(
    campaignStationPoint.x,
    campaignStationPoint.y,
  );
  await campaignPage.waitForFunction(
    () =>
      document.querySelector("[data-rail-station-form]")
        ?.getAttribute("data-station-id") ===
      "campaign-east-service",
  );
  await resume(campaignPage);
  const campaignStationPauseAfter =
    await readPauseUiState(campaignPage);
  assertRunningPauseState(
    campaignStationPauseAfter,
    "Campaign station screenshot",
  );
  const campaignStationTargetAudit = {
    ...campaignStationTargetScan,
    clickedRepresentative: campaignStationPoint,
  };
  const campaignStationPauseAudit = {
    nativeMethod: "HUD pause button",
    before: campaignStationPauseBefore,
    during: campaignStationPauseDuring,
    after: campaignStationPauseAfter,
  };
  await campaignPage
    .locator("[data-rail-station-form]")
    .scrollIntoViewIfNeeded();
  await campaignScreenshot(
    campaignPage,
    "visual-campaign-desktop-station-editor.png",
  );

  const campaignTrainTarget = {
    kind: "train",
    id: "campaign-ore-runner",
  };
  const campaignTrainPauseBefore =
    await readPauseUiState(campaignPage);
  assertRunningPauseState(
    campaignTrainPauseBefore,
    "Campaign train selection precondition",
  );
  await pause(campaignPage);
  const campaignTrainPauseDuring =
    await readPauseUiState(campaignPage);
  assertPausedPauseState(
    campaignTrainPauseDuring,
    "Campaign train selection",
  );
  const campaignTrainTargetScan =
    await scanTrainLiveCellTarget(
      campaignPage,
      campaignTrainTarget.id,
    );
  const campaignTrainPoint =
    exactNativeTargetRepresentative(
      campaignTrainTargetScan,
      campaignTrainTarget,
    );
  await campaignPage.mouse.click(
    campaignTrainPoint.x,
    campaignTrainPoint.y,
  );
  await campaignPage.waitForFunction(
    () =>
      document.querySelector("[data-rail-schedule-form]")
        ?.getAttribute("data-train-id") ===
      "campaign-ore-runner",
  );
  await resume(campaignPage);
  const campaignTrainPauseAfter =
    await readPauseUiState(campaignPage);
  assertRunningPauseState(
    campaignTrainPauseAfter,
    "Campaign train screenshots",
  );
  const campaignTrainTargetAudit = {
    ...campaignTrainTargetScan,
    clickedRepresentative: campaignTrainPoint,
  };
  const campaignTrainPauseAudit = {
    nativeMethod: "HUD pause button",
    before: campaignTrainPauseBefore,
    during: campaignTrainPauseDuring,
    after: campaignTrainPauseAfter,
  };
  await campaignPage
    .locator(".rail-car-list")
    .scrollIntoViewIfNeeded();
  await campaignScreenshot(
    campaignPage,
    "visual-campaign-desktop-consist-fuel.png",
  );
  await campaignPage
    .locator("[data-rail-schedule-form]")
    .scrollIntoViewIfNeeded();
  await campaignScreenshot(
    campaignPage,
    "visual-campaign-desktop-schedule.png",
  );

  await campaignPage.locator("[data-action='rail-cancel']").click();
  const campaignDismantlePoint = await findWorldPoint(campaignPage, {
    target: { kind: "segment", id: campaignPaidSegment },
  });
  await campaignPage.mouse.click(
    campaignDismantlePoint.x,
    campaignDismantlePoint.y,
  );
  await campaignPage.locator(
    "[data-action='rail-dismantle']",
  ).click();
  await campaignPage.waitForFunction(
    (id) =>
      !window.__CINDERLINE__?.railAuthoringState().network
        ?.graph.nodes.some((node) => node.segmentId === id),
    campaignPaidSegment,
  );
  await campaignPage
    .locator(
      "[data-ref='rail-console'] [data-action='rail-toggle']",
    )
    .click();
  await campaignPage.waitForFunction(
    () => window.__CINDERLINE__?.railAuthoringState().open === false,
  );

  const campaignInverseVertical =
    await nativeCampaignCameraPan(campaignPage, {
      label: "campaign desktop inverse vertical framing",
      from: { x: 1_500, y: 590 },
      to: { x: 1_500, y: 500 },
      axis: "z",
      direction: "negative",
      expectedAuthoringOpen: false,
    });
  const campaignInverseHorizontal =
    await nativeCampaignCameraPan(campaignPage, {
      label: "campaign desktop inverse east framing",
      from: { x: 1_360, y: 540 },
      to: { x: 1_500, y: 540 },
      axis: "x",
      direction: "negative",
      expectedAuthoringOpen: false,
    });
  const campaignRestoredCamera =
    await readCampaignCameraState(campaignPage);
  const campaignCameraRestoration =
    campaignCameraRestoreAudit(
      campaignForwardHorizontal.before,
      campaignRestoredCamera,
      campaignForwardHorizontal,
      campaignForwardVertical,
      campaignInverseVertical,
      campaignInverseHorizontal,
    );

  const campaignMobileFlows = [
    {
      viewport: { width: 600, height: 800 },
      label: "visual-campaign-mobile-600",
      tool: "chainSignal",
      source: "campaign-main-18",
      destination: "campaign-main-19",
    },
    {
      viewport: { width: 390, height: 844 },
      label: "visual-campaign-mobile-390",
      tool: "regularSignal",
      source: "campaign-main-16",
      destination: "campaign-main-17",
    },
  ];
  const campaignMobileProof = [];
  for (const flow of campaignMobileFlows) {
    await campaignPage.setViewportSize(flow.viewport);
    await campaignPage.waitForTimeout(180);
    await campaignPage
      .locator(".hud-topbar [data-action='rail-toggle']")
      .tap();
    await campaignPage.waitForFunction(
      () => window.__CINDERLINE__?.railAuthoringState().open === true,
    );
    await campaignScreenshot(
      campaignPage,
      `${flow.label}-expanded.png`,
    );
    await selectTool(campaignPage, flow.tool, "tap");
    const campaignCollapse = campaignPage.locator(
      "[data-action='rail-collapse']",
    );
    await campaignCollapse.scrollIntoViewIfNeeded();
    const campaignCollapsedSettle =
      await toggleAndSettleRailTray(
        campaignPage,
        campaignCollapse,
        true,
        `${flow.label} source collapse`,
      );
    const campaignEndpointAudit =
      await auditMobileSignalEndpoints(campaignPage, flow);
    const campaignSourcePoint =
      campaignEndpointAudit.sourcePoint;
    await campaignPage.touchscreen.tap(
      campaignSourcePoint.x,
      campaignSourcePoint.y,
    );
    await campaignPage.waitForFunction(
      (id) =>
        window.__CINDERLINE__?.railAuthoringState()
          .sourceSegmentId === id,
      flow.source,
    );
    await campaignScreenshot(
      campaignPage,
      `${flow.label}-collapsed-source.png`,
    );
    const campaignSignalCount = (
      await readRailState(campaignPage)
    ).network.signals.length;
    const campaignDestinationPoint =
      campaignEndpointAudit.destinationPoint;
    await campaignPage.touchscreen.tap(
      campaignDestinationPoint.x,
      campaignDestinationPoint.y,
    );
    await campaignPage.waitForFunction(
      (count) =>
        (
          window.__CINDERLINE__?.railAuthoringState().network
            ?.signals.length ?? 0
        ) === count + 1,
      campaignSignalCount,
    );
    const collapsedCompletion = await readRailState(campaignPage);
    const campaignExpandedSettle =
      await toggleAndSettleRailTray(
        campaignPage,
        campaignCollapse,
        false,
        `${flow.label} completion expand`,
      );
    await campaignScreenshot(
      campaignPage,
      `${flow.label}-completed-expanded.png`,
    );
    campaignMobileProof.push({
      ...flow,
      selectedTool: collapsedCompletion.selectedTool,
      selectedTarget: collapsedCompletion.selectedTarget,
      sourceAfterCompletion:
        collapsedCompletion.sourceSegmentId,
      status: collapsedCompletion.status,
      endpointAudit: campaignEndpointAudit.proof,
      traySettles: {
        collapsed: campaignCollapsedSettle,
        expanded: campaignExpandedSettle,
      },
    });
    await campaignPage
      .locator(
        "[data-ref='rail-console'] [data-action='rail-toggle']",
      )
      .tap();
    await campaignPage.waitForFunction(
      () => window.__CINDERLINE__?.railAuthoringState().open === false,
    );
  }
  proof.campaignVisual = {
    fixture: campaignFixtureAudit,
    worldSource: "fresh campaign simulation and rail district",
    unlockAuthority:
      "strict v5-to-v6 migration with canonical legacy-sandbox progression",
    normalGameplayZoom: true,
    pausedFrames: 0,
    denseFrames: 0,
    validCue: "green-tool-shape-plus-raised-ring-check",
    blockedCue: "red-tool-shape-plus-cross",
    selectedCue: "amber-ring",
    stationEditor: "campaign-east-service",
    trainEditor: "campaign-ore-runner",
    cameraAuthoringAudit: {
      forward: {
        horizontal: campaignForwardHorizontal,
        vertical: campaignForwardVertical,
      },
      inverse: {
        vertical: campaignInverseVertical,
        horizontal: campaignInverseHorizontal,
      },
      restoration: campaignCameraRestoration,
    },
    nativeTargetAudit: {
      station: campaignStationTargetAudit,
      train: campaignTrainTargetAudit,
    },
    targetPauseAudit: {
      station: campaignStationPauseAudit,
      train: campaignTrainPauseAudit,
    },
    dismantledPaidSegment: campaignPaidSegment,
    mobile: campaignMobileProof,
  };
  await campaignContext.close();

  const noRailContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const noRailPage = await noRailContext.newPage();
  auditPage(noRailPage, "no-rail");
  await noRailPage.goto(
    `${BASE_URL}/?fresh=no-rail-authoring&railFixture=1`,
    { waitUntil: "networkidle", timeout: 30_000 },
  );
  await waitForBoot(noRailPage);
  await noRailPage.locator("#world").focus();
  await noRailPage.keyboard.press("KeyT");
  await noRailPage.waitForFunction(
    () => window.__CINDERLINE__?.railAuthoringState().open === true,
  );
  const noRailProof = await noRailPage.evaluate(() => {
    const state = window.__CINDERLINE__?.railAuthoringState();
    return {
      status: document.querySelector("[data-ref='rail-status']")
        ?.textContent,
      network: state?.network ?? null,
      ledgerEntries: state?.ledger.entries.length,
      tools: [
        ...document.querySelectorAll("[data-rail-tool]"),
      ].map((tool) => ({
        enabled: tool.dataset.railEnabled,
        ariaDisabled: tool.getAttribute("aria-disabled"),
      })),
    };
  });
  assert(
    noRailProof.status ===
      "This world has no configured rail network." &&
      noRailProof.network === null &&
      noRailProof.ledgerEntries === 0 &&
      noRailProof.tools.length === 8 &&
      noRailProof.tools.every(
        (tool) =>
          tool.enabled === "false" &&
          tool.ariaDisabled === "true",
      ),
    "No-rail mode is not an exact disabled/empty state.",
  );
  proof.noRail = noRailProof;
  await screenshot(
    noRailPage,
    "engineering-no-rail-disabled.png",
  );
  await noRailContext.close();

  const v5 = structuredClone(finalV6);
  v5.version = 5;
  delete v5.railConstruction;
  const migrationContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  await migrationContext.addInitScript(
    ({ legacyBytes }) => {
      if (!sessionStorage.getItem("rail-authoring-v5-seeded")) {
        localStorage.clear();
        localStorage.setItem(
          "cinderline.autosave.v5",
          legacyBytes,
        );
        sessionStorage.setItem(
          "rail-authoring-v5-seeded",
          "true",
        );
      }
      window.__railMigrationLog = [];
      const originalSet = Storage.prototype.setItem;
      const originalRemove = Storage.prototype.removeItem;
      Storage.prototype.setItem = function (key, value) {
        if (this === localStorage) {
          window.__railMigrationLog.push({
            action: "set",
            key,
            bytes: String(value).length,
          });
        }
        return originalSet.call(this, key, value);
      };
      Storage.prototype.removeItem = function (key) {
        if (this === localStorage) {
          window.__railMigrationLog.push({
            action: "remove",
            key,
          });
        }
        return originalRemove.call(this, key);
      };
    },
    { legacyBytes: JSON.stringify(v5) },
  );
  const migrationPage = await migrationContext.newPage();
  auditPage(migrationPage, "migration");
  await migrationPage.goto(`${BASE_URL}/`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await waitForBoot(migrationPage);
  const migrationStorage = await migrationPage.evaluate(() => ({
    log: window.__railMigrationLog,
    v6: localStorage.getItem("cinderline.autosave.v6"),
    v5: localStorage.getItem("cinderline.autosave.v5"),
  }));
  const v6SetIndex = migrationStorage.log.findIndex(
    (entry) =>
      entry.action === "set" &&
      entry.key === "cinderline.autosave.v6",
  );
  const v5RemoveIndex = migrationStorage.log.findIndex(
    (entry) =>
      entry.action === "remove" &&
      entry.key === "cinderline.autosave.v5",
  );
  assert(
    v6SetIndex >= 0 &&
      v5RemoveIndex > v6SetIndex &&
      migrationStorage.v6 &&
      migrationStorage.v5 === null,
    "v5 migration did not write/reread v6 before deleting v5.",
  );
  const migratedState = await readRailState(migrationPage);
  const expectedMigration = persistentRailSignature(finalLiveState);
  const actualMigration = persistentRailSignature(migratedState);
  assertDeepEqual(
    {
      nodes: actualMigration.nodes,
      signals: actualMigration.signals,
      stations: actualMigration.stations,
      trains: actualMigration.trains,
      stationInterfaces: actualMigration.stationInterfaces,
      alloy: actualMigration.alloy,
    },
    {
      nodes: expectedMigration.nodes,
      signals: expectedMigration.signals,
      stations: expectedMigration.stations,
      trains: expectedMigration.trains,
      stationInterfaces: expectedMigration.stationInterfaces,
      alloy: expectedMigration.alloy,
    },
    "v5 migration changed topology, IDs, schedule, interfaces, fuel, or alloy.",
  );
  assert(
    migratedState.ledger.entries.length > 0 &&
      migratedState.ledger.entries.every(
        (entry) =>
          entry.source === "granted" &&
          entry.paidCost === 0,
      ),
    "v5 migration did not grant every recovered rail identity.",
  );
  const migratedSignature =
    persistentRailSignature(migratedState);
  await migrationPage.reload({
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await waitForBoot(migrationPage);
  assertDeepEqual(
    persistentRailSignature(await readRailState(migrationPage)),
    migratedSignature,
    "Migrated v6 rail state was not stable on reload.",
  );
  proof.migration = {
    writeV6Index: v6SetIndex,
    removeV5Index: v5RemoveIndex,
    v6Bytes: migrationStorage.v6.length,
    recoveredEntries: migratedState.ledger.entries.length,
    allRecoveredProvenance: "granted",
    reloadStable: true,
  };
  await migrationContext.close();

  assert(
    browserErrors.length === 0,
    `Browser errors were observed:\n${browserErrors.join("\n")}`,
  );
  const endingFingerprint = await sourceFingerprint();
  assertDeepEqual(
    endingFingerprint,
    startingFingerprint,
    "Rail authoring sources changed during native QA.",
  );
  const endingRunnerFingerprint = sha256(
    await readFile(resolve("scripts/rail-authoring-qa.mjs")),
  );
  assert(
    endingRunnerFingerprint === runnerFingerprint,
    "The rail authoring QA runner changed during capture.",
  );

  const proofPath = resolve(OUTPUT_DIRECTORY, "proof.json");
  await writeFile(
    proofPath,
    `${JSON.stringify(proof, null, 2)}\n`,
    "utf8",
  );
  const artifactNames = [
    ...(await readdir(OUTPUT_DIRECTORY)).filter((name) =>
      name.endsWith(".png")
    ),
    basename(proofPath),
  ].sort();
  const artifacts = [];
  for (const name of artifactNames) {
    const bytes = await readFile(resolve(OUTPUT_DIRECTORY, name));
    artifacts.push({
      name,
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
  const manifest = {
    format: "cinderline-rail-authoring-formative-manifest",
    version: 1,
    status: "passed",
    acceptance: "formative-engineering-evidence-only",
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    browserVersion: await browser.version(),
    source: endingFingerprint,
    runner: {
      path: "scripts/rail-authoring-qa.mjs",
      sha256: runnerFingerprint,
    },
    screenshots,
    browserErrors,
    artifacts,
  };
  // The manifest is the seal and is deliberately the final write. Every
  // assertion, error audit, and source-drift check has passed at this point.
  await writeFile(
    MANIFEST_PATH,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  console.log(
    JSON.stringify(
      {
        outputDirectory: OUTPUT_DIRECTORY,
        manifest: MANIFEST_PATH,
        sourceFingerprint: endingFingerprint.digest,
        runnerFingerprint,
        stationHover: proof.hover.station,
        trainHover: proof.hover.train,
        screenshots: screenshots.length,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
