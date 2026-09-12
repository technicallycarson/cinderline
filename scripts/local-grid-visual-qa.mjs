import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY = ".qa/local-grid";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });

const relays = [
  { id: "relay-a", x: 8, z: 8, relayId: 101, networkId: 7 },
  { id: "relay-b", x: 12, z: 8, relayId: 102, networkId: 7 },
  { id: "relay-c", x: 8, z: 12, relayId: 103, networkId: 7 },
  { id: "relay-d", x: 12, z: 12, relayId: 104, networkId: 7 },
  { id: "relay-e", x: 16, z: 9, relayId: 201, networkId: 12 },
  { id: "relay-f", x: 16, z: 13, relayId: 202, networkId: 12 },
];
const links = [
  { relayAId: 101, relayBId: 102 },
  { relayAId: 101, relayBId: 103 },
  { relayAId: 102, relayBId: 104 },
  { relayAId: 103, relayBId: 104 },
  { relayAId: 201, relayBId: 202 },
];
const relayEntities = relays.map((relay) => ({
  id: relay.id,
  kind: "gridRelay",
  x: relay.x,
  z: relay.z,
  active: false,
  powered: true,
  status: "idle",
  powerRelayId: relay.relayId,
  powerNetworkId: relay.networkId,
}));
const contextEntities = [
  {
    id: "generator-context",
    kind: "generator",
    x: 4,
    z: 9,
    direction: 1,
    active: true,
    powered: true,
    status: "working",
    progress: 0.42,
  },
  {
    id: "fabricator-context",
    kind: "fabricator",
    x: 14,
    z: 5,
    direction: 2,
    active: true,
    powered: true,
    status: "working",
    processState: "working",
    recipe: "circuit",
    processRecipe: "circuit",
    progress: 0.58,
  },
  {
    id: "storage-context",
    kind: "storage",
    x: 18,
    z: 12,
    direction: 0,
    active: false,
    powered: true,
    status: "idle",
  },
  ...Array.from({ length: 13 }, (_, index) => ({
    id: `belt-context-${index}`,
    kind: "belt",
    x: 4 + index,
    z: 16,
    direction: 1,
    active: true,
    powered: true,
    status: "working",
  })),
];
const makeSnapshot = (mode = "local") => ({
  tick: 900,
  elapsed: 8.4,
  bounds: { minX: 0, minZ: 0, maxX: 24, maxZ: 22 },
  entities: [...relayEntities, ...contextEntities],
  resources: [],
  beltItems: [],
  powerGrid: {
    mode,
    halfExtent: 3,
    cableReach: 5,
    relayCenters: relays.map((relay) => ({
      relayId: relay.relayId,
      x: relay.x + 0.5,
      z: relay.z + 0.5,
      networkId: relay.networkId,
    })),
    relayLinks: links,
  },
});

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const consoleFailures = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      consoleFailures.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    consoleFailures.push(`pageerror: ${error.message}`);
  });

  const pageUrl = BASE_URL.endsWith(".html")
    ? `${BASE_URL}?fresh=local-grid-${Date.now()}`
    : `${BASE_URL.replace(/\/$/, "")}/?fresh=local-grid-${Date.now()}`;
  await page.goto(pageUrl, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#boot")?.classList.contains("is-done")
      && Boolean(window.__CINDERLINE__?.renderer),
    undefined,
    { timeout: 20_000 },
  );

  await page.evaluate((snapshot) => {
    const renderer = window.__CINDERLINE__?.renderer;
    if (!renderer) throw new Error("Local Grid QA renderer bridge unavailable.");
    document.querySelector("#boot")?.remove();
    const hud = document.querySelector("#hud");
    if (hud instanceof HTMLElement) hud.style.display = "none";

    const originalSync = renderer.sync.bind(renderer);
    const originalUpdate = renderer.update.bind(renderer);
    const originalRender = renderer.render.bind(renderer);
    const qa = {
      hold: true,
      originalSync,
      originalUpdate,
      originalRender,
      snapshot,
    };
    renderer.sync = (nextSnapshot) => {
      if (!qa.hold) originalSync(nextSnapshot);
    };
    renderer.update = () => {};
    renderer.render = () => {};
    renderer.__localGridQA = qa;
    originalSync(snapshot);
    renderer.setHovered(null, null);
    renderer.focus(12.5, 10.5);
    renderer.viewWidth = 22;
    renderer.resize();
    originalUpdate(0, 8.4);
    originalRender(0);
  }, makeSnapshot("local"));

  const draw = async (elapsed) => {
    await page.evaluate((time) => {
      const renderer = window.__CINDERLINE__?.renderer;
      const qa = renderer?.__localGridQA;
      if (!renderer || !qa) throw new Error("Local Grid QA state missing.");
      qa.originalUpdate(0, time);
      qa.originalRender(0);
      renderer.renderer.getContext().finish();
    }, elapsed);
  };
  const setView = async (x, z, width, selectedId = null) => {
    await page.evaluate(({ x, z, width, selectedId }) => {
      const renderer = window.__CINDERLINE__?.renderer;
      if (!renderer) throw new Error("Local Grid QA renderer missing.");
      renderer.setSelected(selectedId);
      renderer.focus(x, z);
      renderer.viewWidth = width;
      renderer.resize();
    }, { x, z, width, selectedId });
  };

  await setView(12.5, 10.5, 22, null);
  await draw(8.6);
  await page.locator("#world").screenshot({
    path: `${OUTPUT_DIRECTORY}/local-grid-overview.png`,
  });

  await setView(8.5, 8.5, 15, "relay-a");
  await draw(9.2);
  await page.locator("#world").screenshot({
    path: `${OUTPUT_DIRECTORY}/selected-relay-coverage.png`,
  });

  const highProof = await page.evaluate(() => {
    const renderer = window.__CINDERLINE__?.renderer;
    if (!renderer) throw new Error("Local Grid QA renderer missing.");
    const rig = renderer.entityObjects.get("relay-a");
    if (!rig) throw new Error("Authored relay rig missing.");
    const names = [];
    rig.root.traverse((object) => names.push(object.name));
    const coverage = renderer.powerGridSelection.coverage.geometry.getAttribute(
      "position",
    );
    const coveragePositions = Array.from(
      { length: coverage.count },
      (_, index) => [
        coverage.getX(index),
        coverage.getY(index),
        coverage.getZ(index),
      ],
    );
    const point = rig.root.position.clone();
    point.y = 0.5;
    point.project(renderer.camera);
    const bounds = renderer.canvas.getBoundingClientRect();
    const picked = renderer.pickEntity(
      bounds.left + (point.x + 1) * bounds.width * 0.5,
      bounds.top + (-point.y + 1) * bounds.height * 0.5,
    );
    return {
      quality: renderer.quality,
      names,
      picked,
      cableCount: renderer.powerGridBatches.cables.count,
      cableShadowCount: renderer.powerGridBatches.cableShadows.count,
      pulseCount: renderer.powerGridBatches.pulses.count,
      gridVisible: renderer.powerGridBatches.root.visible,
      gridMetadata: { ...renderer.powerGridBatches.root.userData },
      selectionVisible: renderer.powerGridSelection.root.visible,
      selectedLinkSegments: renderer.powerGridSelection.links.count,
      selectionMetadata: { ...renderer.powerGridSelection.root.userData },
      coveragePositions,
    };
  });

  assert(highProof.quality === "high", `Expected high quality, got ${highProof.quality}.`);
  assert(
    highProof.names.includes("grid-relay-grounded-octagonal-foundation")
      && highProof.names.includes("grid-relay-stacked-porcelain-insulators")
      && highProof.names.includes("grid-relay-induction-coil-rotor")
      && highProof.names.includes("grid-relay-overhead-cable-terminal")
      && highProof.names.includes("grid-relay-visible-earth-bond")
      && highProof.names.includes("grid-relay-open-lattice-load-bearing-mast")
      && highProof.names.includes("grid-relay-offset-terminal-crossarms")
      && highProof.names.includes("grid-relay-offset-fuse-service-box"),
    `Authored relay landmarks are incomplete: ${JSON.stringify(highProof.names)}.`,
  );
  assert(
    highProof.cableCount === links.length * 12
      && highProof.cableShadowCount === highProof.cableCount
      && highProof.pulseCount === links.length
      && highProof.gridVisible,
    `High-quality Local Grid batching is false: ${JSON.stringify(highProof)}.`,
  );
  assert(
    highProof.selectionVisible
      && highProof.selectionMetadata.relayId === 101
      && highProof.selectionMetadata.highlightedLinkCount === 2
      && highProof.selectionMetadata.linkEmphasis
        === "continuous-conductor-parallel-edge-tracer"
      && highProof.selectedLinkSegments === 24,
    `Selected relay link emphasis is false: ${JSON.stringify(highProof)}.`,
  );
  const xs = highProof.coveragePositions.map((point) => point[0]);
  const zs = highProof.coveragePositions.map((point) => point[2]);
  assert(
    Math.min(...xs) === 5.5
      && Math.max(...xs) === 11.5
      && Math.min(...zs) === 5.5
      && Math.max(...zs) === 11.5,
    `Coverage square is not centered on the relay: ${JSON.stringify(highProof.coveragePositions)}.`,
  );
  assert(
    highProof.picked === "relay-a",
    `High-quality relay picking returned ${String(highProof.picked)}.`,
  );

  await page.evaluate((snapshot) => {
    const renderer = window.__CINDERLINE__?.renderer;
    const qa = renderer?.__localGridQA;
    if (!renderer || !qa) throw new Error("Local Grid QA state missing.");
    qa.snapshot = snapshot;
    qa.originalSync(snapshot);
    renderer.setSelected("relay-a");
  }, makeSnapshot("global"));
  await setView(10.5, 9.5, 18, "relay-a");
  await draw(9.8);
  await page.locator("#world").screenshot({
    path: `${OUTPUT_DIRECTORY}/global-retrofit-candidate.png`,
  });
  const globalProof = await page.evaluate(() => {
    const renderer = window.__CINDERLINE__?.renderer;
    if (!renderer) throw new Error("Local Grid QA renderer missing.");
    return {
      mode: renderer.powerGridBatches.root.userData.mode,
      visible: renderer.powerGridBatches.root.visible,
      cables: renderer.powerGridBatches.cables.count,
      pulses: renderer.powerGridBatches.pulses.count,
      cableOpacity: renderer.powerGridBatches.cables.material.opacity,
      coverageVisible: renderer.powerGridSelection.root.visible,
      highlightedLinkCount:
        renderer.powerGridSelection.root.userData.highlightedLinkCount,
    };
  });
  assert(
    globalProof.mode === "global"
      && globalProof.visible
      && globalProof.cables === links.length * 12
      && globalProof.pulses === 0
      && globalProof.cableOpacity < 0.7
      && globalProof.coverageVisible
      && globalProof.highlightedLinkCount === 2,
    `Global retrofit preview is blind: ${JSON.stringify(globalProof)}.`,
  );

  await page.evaluate(() => {
    const renderer = window.__CINDERLINE__?.renderer;
    const qa = renderer?.__localGridQA;
    if (!renderer || !qa) throw new Error("Local Grid QA state missing.");
    qa.originalSync({ ...qa.snapshot, powerGrid: { ...qa.snapshot.powerGrid, mode: "local" } });
    qa.hold = false;
    if (renderer.quality !== "performance") renderer.toggleQuality();
    qa.hold = true;
    renderer.setSelected("relay-d");
  });
  await setView(12.5, 10.5, 22, "relay-d");
  await draw(10.3);
  await page.locator("#world").screenshot({
    path: `${OUTPUT_DIRECTORY}/performance-grid-overview.png`,
  });
  const performanceProof = await page.evaluate(() => {
    const renderer = window.__CINDERLINE__?.renderer;
    if (!renderer) throw new Error("Local Grid QA renderer missing.");
    const batch = renderer.gridRelayPerformance;
    const activeDraws = [
      batch.bases,
      batch.masts,
      batch.insulators,
      batch.coils,
      batch.lamps,
    ].filter((mesh) => mesh.count > 0).length;
    const rig = renderer.entityObjects.get("relay-d");
    const point = rig.root.position.clone();
    point.y = 0.5;
    point.project(renderer.camera);
    const bounds = renderer.canvas.getBoundingClientRect();
    const clientX = bounds.left + (point.x + 1) * bounds.width * 0.5;
    const clientY = bounds.top + (-point.y + 1) * bounds.height * 0.5;
    renderer.setPointer(clientX, clientY);
    renderer.raycaster.setFromCamera(renderer.pointer, renderer.camera);
    const rawHits = renderer.raycaster
      .intersectObjects(renderer.entityRoot.children, true)
      .slice(0, 8)
      .map((hit) => ({
        name: hit.object.name,
        instanceId: hit.instanceId,
        mappedId:
          hit.instanceId === undefined
            ? null
            : hit.object.userData.entityIds?.[hit.instanceId] ?? null,
      }));
    return {
      quality: renderer.quality,
      batchVisible: batch.root.visible,
      activeDraws,
      relayCount: batch.root.userData.relayCount,
      drawCallContract: batch.root.userData.drawCallContract,
      counts: {
        bases: batch.bases.count,
        masts: batch.masts.count,
        insulators: batch.insulators.count,
        coils: batch.coils.count,
        lamps: batch.lamps.count,
      },
      authoredVisible: Array.from(renderer.entityObjects.values())
        .filter((candidate) => candidate.kind === "gridRelay")
        .some((candidate) => candidate.root.visible),
      cableSegments: renderer.powerGridBatches.cables.count,
      cableShadowSegments: renderer.powerGridBatches.cableShadows.count,
      picked: renderer.pickEntity(
        clientX,
        clientY,
      ),
      rawHits,
    };
  });
  assert(
    performanceProof.quality === "performance"
      && performanceProof.batchVisible
      && performanceProof.activeDraws === 5
      && performanceProof.drawCallContract === 5
      && performanceProof.relayCount === relays.length
      && performanceProof.counts.bases === relays.length
      && performanceProof.counts.masts === relays.length
      && performanceProof.counts.insulators === relays.length * 4
      && performanceProof.counts.coils === relays.length * 3
      && performanceProof.counts.lamps === relays.length
      && !performanceProof.authoredVisible
      && performanceProof.cableSegments === links.length * 4
      && performanceProof.cableShadowSegments
        === performanceProof.cableSegments
      && performanceProof.picked === "relay-d",
    `Performance relay LOD contract is false: ${JSON.stringify(performanceProof)}.`,
  );

  await page.evaluate(() => {
    const renderer = window.__CINDERLINE__?.renderer;
    const qa = renderer?.__localGridQA;
    if (!renderer || !qa) throw new Error("Local Grid QA state missing.");
    qa.hold = false;
    if (renderer.quality !== "high") renderer.toggleQuality();
    qa.hold = true;
    renderer.setSelected(null);
    renderer.setGhost("gridRelay", 15, 11, 0, true);
    renderer.focus(14, 10.5);
    renderer.viewWidth = 15;
    renderer.resize();
  });
  await draw(10.8);
  await page.locator("#world").screenshot({
    path: `${OUTPUT_DIRECTORY}/relay-placement-ghost.png`,
  });
  const ghostProof = await page.evaluate(() => {
    const renderer = window.__CINDERLINE__?.renderer;
    if (!renderer) throw new Error("Local Grid QA renderer missing.");
    const names = [];
    renderer.ghostVisual?.traverse((object) => names.push(object.name));
    return {
      quality: renderer.quality,
      visible: renderer.ghostRoot.visible,
      kind: renderer.ghostKind,
      names,
      material: renderer.ghostVisual?.userData.ghostMaterial
          ? {
            transparent:
              renderer.ghostVisual.userData.ghostMaterial.transparent,
            alphaHash: renderer.ghostVisual.userData.ghostMaterial.alphaHash,
            depthWrite:
              renderer.ghostVisual.userData.ghostMaterial.depthWrite,
            opacity: renderer.ghostVisual.userData.ghostMaterial.opacity,
            occlusion:
              renderer.ghostVisual.userData.ghostMaterial.userData
                .placementGhostOcclusion,
          }
        : null,
      invalidCueVisible:
        renderer.ghostVisual?.userData.ghostInvalidCue?.visible ?? null,
    };
  });
  assert(
    ghostProof.quality === "high"
      && ghostProof.visible
      && ghostProof.kind === "gridRelay"
      && ghostProof.names.includes("grid-relay-grounded-octagonal-foundation")
      && ghostProof.names.includes(
        "grid-relay-ghost-crisp-one-tile-footprint",
      )
      && ghostProof.names.includes(
        "grid-relay-ghost-subordinate-coverage-boundary",
      )
      && ghostProof.names.includes(
        "grid-relay-ghost-sagging-terminal-to-terminal-conductors",
      )
      && ghostProof.names.includes(
        "grid-relay-ghost-invalid-collision-crosshatching",
      )
      && ghostProof.material?.transparent
      && ghostProof.material?.alphaHash === false
      && ghostProof.material?.depthWrite
      && ghostProof.material?.occlusion === "depth-writing-alpha-blend"
      && ghostProof.invalidCueVisible === false,
    `Grid relay ghost is false: ${JSON.stringify(ghostProof)}.`,
  );

  await page.evaluate(() => {
    const renderer = window.__CINDERLINE__?.renderer;
    if (!renderer) throw new Error("Local Grid QA renderer missing.");
    renderer.setGhost("gridRelay", 15, 11, 0, false, "occupied");
  });
  await draw(11);
  await page.locator("#world").screenshot({
    path: `${OUTPUT_DIRECTORY}/relay-placement-ghost-invalid.png`,
  });
  const invalidGhostProof = await page.evaluate(() => {
    const renderer = window.__CINDERLINE__?.renderer;
    const material = renderer?.ghostVisual?.userData.ghostMaterial;
    const range = renderer?.ghostVisual?.userData.ghostRangeMaterial;
    if (!renderer || !material || !range) {
      throw new Error("Invalid relay ghost materials missing.");
    }
    return {
      visible: renderer.ghostRoot.visible,
      bodyColor: material.color.getHexString(),
      rangeColor: range.color.getHexString(),
      transparent: material.transparent,
      alphaHash: material.alphaHash,
      depthWrite: material.depthWrite,
      occlusion: material.userData.placementGhostOcclusion,
      invalidCueVisible:
        renderer.ghostVisual?.userData.ghostInvalidCue?.visible ?? null,
      prospectiveColor:
        renderer.ghostVisual?.userData.ghostProspectiveMaterial?.color
          ?.getHexString() ?? null,
    };
  });
  assert(
    invalidGhostProof.visible
      && invalidGhostProof.bodyColor === "ff6550"
      && invalidGhostProof.rangeColor === "ff6b55"
      && invalidGhostProof.transparent
      && invalidGhostProof.alphaHash === false
      && invalidGhostProof.depthWrite
      && invalidGhostProof.occlusion === "depth-writing-alpha-blend"
      && invalidGhostProof.invalidCueVisible
      && invalidGhostProof.prospectiveColor === "c78b4f",
    `Invalid relay ghost is not equally authored: ${JSON.stringify(invalidGhostProof)}.`,
  );

  const teardownProof = await page.evaluate(() => {
    const renderer = window.__CINDERLINE__?.renderer;
    const qa = renderer?.__localGridQA;
    if (!renderer || !qa) throw new Error("Local Grid QA state missing.");
    renderer.setGhost(null, 0, 0, 0, true);
    const before = renderer.renderer.info.memory.geometries;
    qa.originalSync({
      tick: 901,
      elapsed: 11,
      bounds: qa.snapshot.bounds,
      entities: qa.snapshot.entities.filter((entity) => entity.kind !== "gridRelay"),
      resources: [],
      beltItems: [],
    });
    qa.originalUpdate(0, 11);
    qa.originalRender(0);
    const removed = {
      relayRigs: Array.from(renderer.entityObjects.values())
        .filter((rig) => rig.kind === "gridRelay").length,
      cableCount: renderer.powerGridBatches.cables.count,
      cableShadowCount: renderer.powerGridBatches.cableShadows.count,
      pulseCount: renderer.powerGridBatches.pulses.count,
      gridVisible: renderer.powerGridBatches.root.visible,
      selectionVisible: renderer.powerGridSelection.root.visible,
      performanceRelayCount: renderer.gridRelayPerformance.bases.count,
    };
    qa.originalSync({ ...qa.snapshot, powerGrid: { ...qa.snapshot.powerGrid, mode: "local" } });
    qa.originalUpdate(0, 11.2);
    qa.originalRender(0);
    return {
      before,
      after: renderer.renderer.info.memory.geometries,
      removed,
      restoredRelayRigs: Array.from(renderer.entityObjects.values())
        .filter((rig) => rig.kind === "gridRelay").length,
      restoredCableCount: renderer.powerGridBatches.cables.count,
    };
  });
  assert(
    teardownProof.removed.relayRigs === 0
      && teardownProof.removed.cableCount === 0
      && teardownProof.removed.cableShadowCount === 0
      && teardownProof.removed.pulseCount === 0
      && !teardownProof.removed.gridVisible
      && !teardownProof.removed.selectionVisible
      && teardownProof.removed.performanceRelayCount === 0
      && teardownProof.restoredRelayRigs === relays.length
      && teardownProof.restoredCableCount === links.length * 12
      && teardownProof.after <= teardownProof.before + 4,
    `Local Grid teardown/roundtrip is false: ${JSON.stringify(teardownProof)}.`,
  );

  assert(
    consoleFailures.length === 0,
    `Local Grid QA emitted console failures: ${JSON.stringify(consoleFailures)}.`,
  );
  const report = {
    high: highProof,
    globalCandidate: globalProof,
    performance: performanceProof,
    ghost: ghostProof,
    invalidGhost: invalidGhostProof,
    teardown: teardownProof,
    consoleFailures,
  };
  await writeFile(
    `${OUTPUT_DIRECTORY}/report.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify({
    status: "ok",
    outputs: [
      `${OUTPUT_DIRECTORY}/local-grid-overview.png`,
      `${OUTPUT_DIRECTORY}/selected-relay-coverage.png`,
      `${OUTPUT_DIRECTORY}/global-retrofit-candidate.png`,
      `${OUTPUT_DIRECTORY}/performance-grid-overview.png`,
      `${OUTPUT_DIRECTORY}/relay-placement-ghost.png`,
      `${OUTPUT_DIRECTORY}/relay-placement-ghost-invalid.png`,
      `${OUTPUT_DIRECTORY}/report.json`,
    ],
    summary: {
      highCableSegments: highProof.cableCount,
      highPulseCount: highProof.pulseCount,
      performanceDraws: performanceProof.activeDraws,
      selectedLinks: highProof.selectionMetadata.highlightedLinkCount,
      globalCandidateCables: globalProof.cables,
      teardown: teardownProof.removed,
    },
  }, null, 2));
} finally {
  await browser.close();
}
