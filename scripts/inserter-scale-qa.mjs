import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY = ".qa/inserter-scale";
const INSERTER_COUNT = 250;
const P95_BUDGET_MS = 12;
const MEDIAN_BUDGET_MS = 6;
const DRAW_CALL_BUDGET = 12;
const TRIANGLE_BUDGET = 100_000;

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

  await page.goto(`${BASE_URL}/?fresh=inserter-scale-qa`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => (
      document.querySelector("#boot")?.classList.contains("is-done")
      && Boolean(window.__CINDERLINE__?.renderer)
    ),
    undefined,
    { timeout: 15_000 },
  );

  const setup = await page.evaluate((count) => {
    const renderer = window.__CINDERLINE__?.renderer;
    if (!renderer) throw new Error("Inserter scale QA renderer bridge unavailable.");

    const createEntities = (entityCount) => {
      const itemKinds = ["copperOre", "ironIngot", "violetCoil", "automationCore"];
      return Array.from({ length: entityCount }, (_, index) => {
        const column = index % 25;
        const row = Math.floor(index / 25);
        return {
          id: `scale-inserter-${index}`,
          kind: "inserter",
          x: 8 + column,
          z: 12 + row,
          direction: index % 4,
          active: true,
          powered: true,
          status: index % 19 === 0 ? "blocked" : "working",
          progress: (index % 17) / 16,
          carriedItem: itemKinds[index % itemKinds.length],
          armReturning: false,
          pickupContact: [index % 2 === 0 ? -0.17 : 0.17, 0.5],
          dropContact: [index % 2 === 0 ? 0.17 : -0.17, -0.5],
        };
      });
    };
    const emptySnapshot = { elapsed: 0, entities: [], resources: [], beltItems: [] };
    const scaleSnapshot = {
      elapsed: 2.4,
      entities: createEntities(count),
      resources: [],
      beltItems: [],
    };

    if (renderer.quality !== "performance") renderer.toggleQuality();
    const originalSync = renderer.sync.bind(renderer);
    const originalUpdate = renderer.update.bind(renderer);
    const originalRender = renderer.render.bind(renderer);

    for (const rootName of [
      "worldRoot",
      "infrastructureRoot",
      "resourceRoot",
      "itemRoot",
      "effectsRoot",
      "overlayRoot",
      "ghostRoot",
    ]) {
      const root = renderer[rootName];
      if (root) root.visible = false;
    }
    document.querySelector("#boot")?.remove();
    const hud = document.querySelector("#hud");
    if (hud instanceof HTMLElement) hud.style.display = "none";
    renderer.setSelected(null);
    renderer.setHovered(null, null);

    originalSync(emptySnapshot);
    originalUpdate(0, 0);
    originalRender(0);
    renderer.renderer.getContext().finish();
    const baseline = {
      geometries: renderer.renderer.info.memory.geometries,
      textures: renderer.renderer.info.memory.textures,
    };

    originalSync(scaleSnapshot);
    originalUpdate(0, 2.4);
    renderer.focus(20.5, 16.5);
    for (let index = 0; index < 12; index += 1) renderer.zoom(4);
    originalRender(0);
    renderer.renderer.getContext().finish();

    let detailedMeshCount = 0;
    for (const rig of renderer.entityObjects.values()) {
      if (rig.kind !== "inserter") continue;
      rig.root.traverse((object) => {
        if (object.isMesh) detailedMeshCount += 1;
      });
    }
    const batches = renderer.inserterPerformance;
    const payloadCounts = Object.fromEntries(
      Object.entries(batches.payloads).map(([kind, mesh]) => [kind, mesh.count]),
    );
    renderer.__inserterScaleQA = {
      originalSync,
      originalUpdate,
      originalRender,
      emptySnapshot,
      scaleSnapshot,
      baseline,
    };
    renderer.sync = () => {};
    renderer.update = () => {};
    renderer.render = () => {};

    return {
      quality: renderer.quality,
      detailedMeshCount,
      entityRigCount: renderer.entityObjects.size,
      baseCount: batches.base.count,
      armCount: batches.arm.count,
      jawCount: batches.jaws.count,
      signalCount: batches.signal.count,
      payloadCounts,
      baseline,
      scaleMemory: {
        geometries: renderer.renderer.info.memory.geometries,
        textures: renderer.renderer.info.memory.textures,
      },
    };
  }, INSERTER_COUNT);

  await page.screenshot({
    path: `${OUTPUT_DIRECTORY}/performance-250.png`,
  });

  const result = await page.evaluate(async () => {
    const renderer = window.__CINDERLINE__?.renderer;
    const state = renderer?.__inserterScaleQA;
    if (!renderer || !state) {
      throw new Error("Inserter scale QA state was not preserved.");
    }
    const {
      originalSync,
      originalUpdate,
      originalRender,
      emptySnapshot,
      scaleSnapshot,
      baseline,
    } = state;
    const gl = renderer.renderer.getContext();

    for (let index = 0; index < 12; index += 1) {
      originalUpdate(1 / 60, 2.4 + index / 60);
      originalRender(0);
      gl.finish();
    }

    const samples = [];
    for (let index = 0; index < 72; index += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const started = performance.now();
      originalUpdate(1 / 60, 3 + index / 60);
      originalRender(0);
      gl.finish();
      samples.push(performance.now() - started);
    }
    const sortedSamples = samples.slice().sort((a, b) => a - b);
    const medianMs = sortedSamples[Math.floor(sortedSamples.length * 0.5)] ?? 0;
    const p95Ms = sortedSamples[Math.floor(sortedSamples.length * 0.95)] ?? 0;
    const renderStats = {
      calls: renderer.renderer.info.render.calls,
      triangles: renderer.renderer.info.render.triangles,
      points: renderer.renderer.info.render.points,
      lines: renderer.renderer.info.render.lines,
    };

    const armTranslations = new Set();
    const armMatrices = renderer.inserterPerformance.arm.instanceMatrix.array;
    for (let index = 0; index < renderer.inserterPerformance.arm.count; index += 1) {
      const offset = index * 16;
      armTranslations.add(
        [
          armMatrices[offset + 12],
          armMatrices[offset + 13],
          armMatrices[offset + 14],
        ].map((value) => Number(value).toFixed(3)).join(":"),
      );
    }
    const wristPositions = new Map();
    const wristMatrices = renderer.inserterPerformance.wrist.instanceMatrix.array;
    renderer.inserterPerformance.entityIds.forEach((entityId, index) => {
      const offset = index * 16;
      wristPositions.set(entityId, [
        wristMatrices[offset + 12],
        wristMatrices[offset + 13],
        wristMatrices[offset + 14],
      ]);
    });
    let payloadIdMismatches = 0;
    let maxPayloadToWristDistance = 0;
    for (const [kind, payload] of Object.entries(renderer.inserterPerformance.payloads)) {
      const payloadIds = renderer.inserterPerformance.payloadEntityIds[kind];
      const payloadMatrices = payload.instanceMatrix.array;
      for (let index = 0; index < payload.count; index += 1) {
        const wristPosition = wristPositions.get(payloadIds[index]);
        if (!wristPosition) {
          payloadIdMismatches += 1;
          continue;
        }
        const offset = index * 16;
        maxPayloadToWristDistance = Math.max(
          maxPayloadToWristDistance,
          Math.hypot(
            payloadMatrices[offset + 12] - wristPosition[0],
            payloadMatrices[offset + 13] - wristPosition[1],
            payloadMatrices[offset + 14] - wristPosition[2],
          ),
        );
      }
    }

    originalSync(emptySnapshot);
    originalUpdate(0, 6);
    originalRender(0);
    gl.finish();
    const afterFirstEmpty = {
      geometries: renderer.renderer.info.memory.geometries,
      textures: renderer.renderer.info.memory.textures,
      entityRigCount: renderer.entityObjects.size,
      baseCount: renderer.inserterPerformance.base.count,
    };

    originalSync(scaleSnapshot);
    originalUpdate(0, 6.1);
    originalRender(0);
    gl.finish();
    const secondScaleMemory = {
      geometries: renderer.renderer.info.memory.geometries,
      textures: renderer.renderer.info.memory.textures,
    };

    originalSync(emptySnapshot);
    originalUpdate(0, 6.2);
    originalRender(0);
    gl.finish();
    const afterSecondEmpty = {
      geometries: renderer.renderer.info.memory.geometries,
      textures: renderer.renderer.info.memory.textures,
      entityRigCount: renderer.entityObjects.size,
      baseCount: renderer.inserterPerformance.base.count,
    };

    renderer.sync = originalSync;
    renderer.update = originalUpdate;
    renderer.render = originalRender;
    delete renderer.__inserterScaleQA;

    const highQuality = renderer.toggleQuality();
    originalSync({
      elapsed: 0.5,
      entities: [{
        id: "quality-roundtrip",
        kind: "inserter",
        x: 12,
        z: 12,
        direction: 1,
        powered: true,
        active: true,
        status: "working",
        progress: 0.5,
        carriedItem: "copperOre",
        pickupContact: [-0.17, 0.5],
        dropContact: [0.17, -0.5],
      }],
      resources: [],
      beltItems: [],
    });
    const detailedRig = renderer.entityObjects.get("quality-roundtrip");
    let highDetailedMeshes = 0;
    detailedRig?.root.traverse((object) => {
      if (object.isMesh) highDetailedMeshes += 1;
    });
    const highBatchVisible = renderer.inserterPerformance.root.visible;

    const performanceQuality = renderer.toggleQuality();
    const performanceRig = renderer.entityObjects.get("quality-roundtrip");
    let roundtripPerformanceMeshes = 0;
    performanceRig?.root.traverse((object) => {
      if (object.isMesh) roundtripPerformanceMeshes += 1;
    });
    const roundtripBaseCount = renderer.inserterPerformance.base.count;
    originalSync(emptySnapshot);

    return {
      samples,
      medianMs,
      p95Ms,
      renderStats,
      uniqueArmTranslations: armTranslations.size,
      payloadIdMismatches,
      maxPayloadToWristDistance,
      baseline,
      afterFirstEmpty,
      secondScaleMemory,
      afterSecondEmpty,
      highQuality,
      highDetailedMeshes,
      highBatchVisible,
      performanceQuality,
      roundtripPerformanceMeshes,
      roundtripBaseCount,
    };
  });

  const payloadTotal = Object.values(setup.payloadCounts)
    .reduce((sum, count) => sum + count, 0);
  const assertions = [
    [
      setup.quality === "performance",
      `Expected performance quality, got ${setup.quality}.`,
    ],
    [
      setup.entityRigCount === INSERTER_COUNT,
      `Expected ${INSERTER_COUNT} lightweight rigs, got ${setup.entityRigCount}.`,
    ],
    [
      setup.detailedMeshCount === 0,
      `Performance rigs allocated ${setup.detailedMeshCount} detailed meshes.`,
    ],
    [
      setup.baseCount === INSERTER_COUNT && setup.armCount === INSERTER_COUNT,
      `Instanced base/arm counts were ${setup.baseCount}/${setup.armCount}.`,
    ],
    [
      setup.jawCount === INSERTER_COUNT * 2,
      `Expected ${INSERTER_COUNT * 2} instanced jaws, got ${setup.jawCount}.`,
    ],
    [
      setup.signalCount === INSERTER_COUNT,
      `Expected ${INSERTER_COUNT} status signals, got ${setup.signalCount}.`,
    ],
    [
      payloadTotal === INSERTER_COUNT
        && Object.values(setup.payloadCounts).every((count) => count > 0),
      `Custody payload batching was incomplete: ${JSON.stringify(setup.payloadCounts)}.`,
    ],
    [
      result.renderStats.calls <= DRAW_CALL_BUDGET,
      `Scale render used ${result.renderStats.calls}/${DRAW_CALL_BUDGET} draw calls.`,
    ],
    [
      result.renderStats.triangles <= TRIANGLE_BUDGET,
      `Scale render used ${result.renderStats.triangles}/${TRIANGLE_BUDGET} triangles.`,
    ],
    [
      result.p95Ms <= P95_BUDGET_MS,
      `Scale p95 was ${result.p95Ms.toFixed(2)}/${P95_BUDGET_MS} ms.`,
    ],
    [
      result.medianMs <= MEDIAN_BUDGET_MS,
      `Scale median was ${result.medianMs.toFixed(2)}/${MEDIAN_BUDGET_MS} ms.`,
    ],
    [
      result.uniqueArmTranslations >= 100,
      `Only ${result.uniqueArmTranslations} distinct moving-arm transforms were rendered.`,
    ],
    [
      result.payloadIdMismatches === 0
        && result.maxPayloadToWristDistance >= 0.1
        && result.maxPayloadToWristDistance <= 0.14,
      `Batched custody detached from its authoritative wrist (${result.payloadIdMismatches} ID mismatches, ${result.maxPayloadToWristDistance.toFixed(4)} max distance).`,
    ],
    [
      result.afterFirstEmpty.entityRigCount === 0
        && result.afterFirstEmpty.baseCount === 0
        && result.afterSecondEmpty.entityRigCount === 0
        && result.afterSecondEmpty.baseCount === 0,
      "Inserter batches or entity rigs survived an empty-snapshot teardown.",
    ],
    [
      result.afterFirstEmpty.geometries <= result.baseline.geometries + 1
        && result.afterSecondEmpty.geometries <= result.baseline.geometries + 1
        && result.afterFirstEmpty.textures === result.baseline.textures
        && result.afterSecondEmpty.textures === result.baseline.textures,
      `Lifecycle memory did not return to baseline: ${JSON.stringify({
        baseline: result.baseline,
        first: result.afterFirstEmpty,
        second: result.afterSecondEmpty,
      })}.`,
    ],
    [
      result.highQuality === "high"
        && result.highDetailedMeshes >= 40
        && result.highBatchVisible === false,
      `High-quality roundtrip failed (${result.highQuality}, ${result.highDetailedMeshes} meshes, batch visible ${result.highBatchVisible}).`,
    ],
    [
      result.performanceQuality === "performance"
        && result.roundtripPerformanceMeshes === 0
        && result.roundtripBaseCount === 1,
      `Performance roundtrip failed (${result.performanceQuality}, ${result.roundtripPerformanceMeshes} meshes, ${result.roundtripBaseCount} bases).`,
    ],
  ];
  for (const [passed, message] of assertions) {
    if (!passed) failures.push(message);
  }
  if (failures.length > 0) {
    throw new Error(
      `Inserter scale QA failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
    );
  }

  console.log(JSON.stringify({
    inserters: INSERTER_COUNT,
    drawCalls: result.renderStats.calls,
    triangles: result.renderStats.triangles,
    medianMs: Number(result.medianMs.toFixed(3)),
    p95Ms: Number(result.p95Ms.toFixed(3)),
    detailedMeshesInPerformance: setup.detailedMeshCount,
    payloadCounts: setup.payloadCounts,
    uniqueArmTranslations: result.uniqueArmTranslations,
    maxPayloadToWristDistance: Number(result.maxPayloadToWristDistance.toFixed(4)),
    lifecycle: {
      baseline: result.baseline,
      afterFirstEmpty: result.afterFirstEmpty,
      afterSecondEmpty: result.afterSecondEmpty,
    },
    highQualityRoundtripMeshes: result.highDetailedMeshes,
    screenshot: `${OUTPUT_DIRECTORY}/performance-250.png`,
  }, null, 2));
} finally {
  await browser.close();
}
