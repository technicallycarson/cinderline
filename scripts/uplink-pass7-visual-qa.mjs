import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { relative, resolve } from "node:path";
import { chromium } from "playwright";

const BASE_URL =
  process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY =
  process.env.CINDERLINE_UPLINK_OUTPUT
  ?? ".qa/uplink-pass7-work/formative-02";
const STATIC_BUILD_DIRECTORY =
  process.env.CINDERLINE_STATIC_BUILD
  ?? ".qa/uplink-pass7-work/static-build";
const REQUIRE_STATIC_BUILD =
  process.env.CINDERLINE_REQUIRE_STATIC === "1";
const WRITE_BUILDER_SEAL =
  process.env.CINDERLINE_WRITE_BUILDER_SEAL === "1";
const PROVISIONAL_CAPTURE_SCENES = new Set(
  (process.env.CINDERLINE_UPLINK_PROVISIONAL_SCENES ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean),
);
const PROVISIONAL_CAPTURE_MODE = PROVISIONAL_CAPTURE_SCENES.size > 0;
const VIEWPORT = { width: 1920, height: 1080 };
const PASS6_RUNNER = {
  path: "scripts/uplink-visual-qa.mjs",
  bytes: 51_286,
  sha256: "78f99d2a5371df1f37d0c392faf3830f251dc926d901f64f528d6adf745c5cf1",
};
const PASS6_BASELINE_ARTIFACT = {
  path: ".qa/uplink-pass6/final/uplink-pass6-report.json",
  sha256: "136f2df0d4c42c57407688ebc9882d44de089019ab51df69bcb130ffa551217d",
};
const PASS6_LOW_BASELINE = {
  calls: 481,
  triangles: 159_356,
  averageMs: 3.9833333333333334,
  geometries: 892,
  textures: 45,
};
const PASS6_HIGH_MEMORY_BASELINE = {
  geometries: 1_654,
  textures: 46,
};
const PASS6_UPLINK_RIG_BASELINE = {
  geometries: 308,
  materials: 44,
};
const PERFORMANCE_BUDGETS = {
  high: {
    calls: 1_150,
    triangles: 350_000,
    averageMs: 12,
    p95Ms: 16.67,
    geometries: 1_700,
    textures: 47,
  },
  low: {
    calls: 625,
    triangles: 200_000,
    averageMs: 8,
    p95Ms: 12,
    geometries: 970,
    textures: 46,
  },
};
const UPLINK_RIG_BUDGET = {
  geometries: 340,
  materials: 50,
};
const EXPECTED_ROUTE =
  "18:12:0|18:11:0|18:10:1|19:10:1|20:10:2|20:11:2|20:12:1|21:12:1";
const EXPECTED_CATALOG = [
  "ironOre",
  "copperOre",
  "coal",
  "stone",
  "ironPlate",
  "copperPlate",
  "stoneBrick",
  "ironGear",
  "copperWire",
  "circuit",
  "automationCore",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function pngDimensions(buffer) {
  assert(
    buffer.subarray(1, 4).toString("ascii") === "PNG",
    "Captured evidence is not a PNG.",
  );
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

async function fingerprintSources() {
  const sourceFiles = (await walk(resolve("src")))
    .filter((path) => /\.(?:ts|css|json)$/.test(path));
  const paths = [
    resolve("index.html"),
    resolve("package.json"),
    resolve("package-lock.json"),
    resolve("scripts/uplink-visual-qa.mjs"),
    resolve("scripts/uplink-pass7-visual-qa.mjs"),
    ...sourceFiles,
  ];
  const files = [];
  for (const path of paths) {
    const data = await readFile(path);
    files.push({
      path: relative(resolve("."), path),
      bytes: data.length,
      sha256: sha256(data),
    });
  }
  const digest = sha256(
    files.map(({ path, bytes, sha256: hash }) =>
      `${path}\0${bytes}\0${hash}`
    ).join("\n"),
  );
  return { digest, files };
}

async function inspectPass6Runner() {
  const data = await readFile(resolve(PASS6_RUNNER.path));
  return {
    path: PASS6_RUNNER.path,
    bytes: data.length,
    sha256: sha256(data),
    expectedBytes: PASS6_RUNNER.bytes,
    expectedSha256: PASS6_RUNNER.sha256,
    preserved:
      data.length === PASS6_RUNNER.bytes
      && sha256(data) === PASS6_RUNNER.sha256,
  };
}

async function inspectPass6BaselineArtifact() {
  const data = await readFile(resolve(PASS6_BASELINE_ARTIFACT.path));
  const report = JSON.parse(data.toString("utf8"));
  const extracted = {
    low: {
      calls: report.performance?.low?.render?.calls ?? null,
      triangles: report.performance?.low?.render?.triangles ?? null,
      averageMs: report.performance?.low?.averageMs ?? null,
      geometries: report.performance?.low?.memory?.geometries ?? null,
      textures: report.performance?.low?.memory?.textures ?? null,
    },
    highMemory: {
      geometries: report.performance?.high?.memory?.geometries ?? null,
      textures: report.performance?.high?.memory?.textures ?? null,
    },
    uplinkRig: {
      geometries: report.disposal?.removed?.geometryCount ?? null,
      materials: report.disposal?.removed?.materialCount ?? null,
    },
  };
  return {
    path: PASS6_BASELINE_ARTIFACT.path,
    bytes: data.length,
    sha256: sha256(data),
    expectedSha256: PASS6_BASELINE_ARTIFACT.sha256,
    hashMatches:
      sha256(data) === PASS6_BASELINE_ARTIFACT.sha256,
    metricsMatch:
      JSON.stringify(extracted.low) === JSON.stringify(PASS6_LOW_BASELINE)
      && JSON.stringify(extracted.highMemory)
        === JSON.stringify(PASS6_HIGH_MEMORY_BASELINE)
      && JSON.stringify(extracted.uplinkRig)
        === JSON.stringify(PASS6_UPLINK_RIG_BASELINE),
    extracted,
  };
}

async function inspectStaticBuild(sourceFingerprint) {
  let files;
  try {
    files = await walk(resolve(STATIC_BUILD_DIRECTORY));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        present: false,
        directory: STATIC_BUILD_DIRECTORY,
        files: [],
        sourcemapSources: {},
      };
    }
    throw error;
  }
  const records = [];
  const sourcemapSources = {};
  for (const path of files) {
    const data = await readFile(path);
    const buildPath = relative(resolve(STATIC_BUILD_DIRECTORY), path);
    records.push({
      path: buildPath,
      bytes: data.length,
      sha256: sha256(data),
    });
    if (!path.endsWith(".js.map")) continue;
    const map = JSON.parse(data.toString("utf8"));
    for (const [index, source] of (map.sources ?? []).entries()) {
      const content = map.sourcesContent?.[index];
      if (typeof content !== "string") continue;
      const normalizedSource = source.replaceAll("\\", "/");
      const sourceMatch = normalizedSource.match(/(?:^|\/)(src\/.+)$/);
      if (!sourceMatch) continue;
      sourcemapSources[sourceMatch[1]] = sha256(content);
    }
  }
  const fileByPath = new Map(
    sourceFingerprint.files.map((entry) => [entry.path, entry]),
  );
  const mappedSourceComparisons = Object.entries(sourcemapSources).map(
    ([path, hash]) => ({
      path,
      buildSha256: hash,
      sourceSha256: fileByPath.get(path)?.sha256 ?? null,
      matches: hash === fileByPath.get(path)?.sha256,
    }),
  );
  const mappedSourceMismatches = mappedSourceComparisons.filter(
    ({ matches }) => !matches,
  );
  return {
    present: true,
    directory: STATIC_BUILD_DIRECTORY,
    files: records,
    totalBytes: records.reduce((total, entry) => total + entry.bytes, 0),
    digest: sha256(
      records.map(({ path, bytes, sha256: hash }) =>
        `${path}\0${bytes}\0${hash}`
      ).join("\n"),
    ),
    hasIndex: records.some(({ path }) => path === "index.html"),
    javascriptCount: records.filter(({ path }) => path.endsWith(".js")).length,
    sourcemapCount: records.filter(({ path }) => path.endsWith(".js.map"))
      .length,
    cssCount: records.filter(({ path }) => path.endsWith(".css")).length,
    sourcemapSources,
    mappedSourceCount: mappedSourceComparisons.length,
    mappedSourceComparisons,
    mappedSourceMismatches,
    allMappedSourcesMatch:
      mappedSourceComparisons.length > 0
      && mappedSourceMismatches.length === 0,
    sourcemapMatchesCurrentSource: {
      main:
        sourcemapSources["src/main.ts"]
        === fileByPath.get("src/main.ts")?.sha256,
      renderer:
        sourcemapSources["src/render/WorldRenderer.ts"]
        === fileByPath.get("src/render/WorldRenderer.ts")?.sha256,
    },
  };
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
const pass6RunnerProof = await inspectPass6Runner();
const pass6BaselineArtifactProof =
  await inspectPass6BaselineArtifact();
assert(
  pass6RunnerProof.preserved,
  `Pass 6 runner preservation proof is false: ${
    JSON.stringify(pass6RunnerProof)
  }.`,
);
assert(
  pass6BaselineArtifactProof.hashMatches
    && pass6BaselineArtifactProof.metricsMatch,
  `Pass 6 baseline artifact proof is false: ${
    JSON.stringify(pass6BaselineArtifactProof)
  }.`,
);
const sourceFingerprintBefore = await fingerprintSources();
const staticBuildProof = await inspectStaticBuild(
  sourceFingerprintBefore,
);
if (REQUIRE_STATIC_BUILD) {
  assert(
    staticBuildProof.present
      && staticBuildProof.hasIndex
      && staticBuildProof.javascriptCount >= 1
      && staticBuildProof.sourcemapCount >= 1
      && staticBuildProof.cssCount >= 1
      && staticBuildProof.mappedSourceCount >= 10
      && staticBuildProof.allMappedSourcesMatch
      && staticBuildProof.sourcemapMatchesCurrentSource.main
      && staticBuildProof.sourcemapMatchesCurrentSource.renderer,
    `Static bundle/sourcemap proof is false: ${
      JSON.stringify(staticBuildProof)
    }.`,
  );
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
});

try {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const consoleFailures = [];
  const requestFailures = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      consoleFailures.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on(
    "pageerror",
    (error) => consoleFailures.push(`pageerror: ${error.message}`),
  );
  page.on(
    "requestfailed",
    (request) =>
      requestFailures.push(
        `${request.method()} ${request.url()}: ${
          request.failure()?.errorText ?? "unknown"
        }`,
      ),
  );
  page.on("response", (response) => {
    if (response.status() >= 400) {
      requestFailures.push(`${response.status()} ${response.url()}`);
    }
  });

  const url = new URL(BASE_URL.replace(/\/$/, ""));
  url.searchParams.set("fresh", `uplink-pass7-${Date.now()}`);
  url.searchParams.set("uplinkShowcase", "1");
  await page.goto(url.toString(), {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#boot")?.classList.contains("is-done")
      && Boolean(window.__CINDERLINE__?.renderer)
      && Number.isSafeInteger(window.__CINDERLINE__?.uplinkEntityId),
    undefined,
    { timeout: 20_000 },
  );

  await page.keyboard.press("Space");
  await page.waitForTimeout(150);
  const pausedTickBefore = await page.evaluate(
    () => window.__CINDERLINE__.stats().tick,
  );
  await page.waitForTimeout(360);
  const pauseProof = await page.evaluate((tickBefore) => {
    const game = window.__CINDERLINE__;
    const pausePlate = document.querySelector("[data-ref='pause-plate']");
    return {
      tickBefore,
      tickAfter: game.stats().tick,
      stable: tickBefore === game.stats().tick,
      plateVisible:
        pausePlate instanceof HTMLElement
        && getComputedStyle(pausePlate).display !== "none"
        && getComputedStyle(pausePlate).visibility !== "hidden",
      plateText: pausePlate?.textContent?.trim() ?? null,
    };
  }, pausedTickBefore);
  assert(
    pauseProof.stable && pauseProof.plateVisible,
    `Pause proof is false: ${JSON.stringify(pauseProof)}.`,
  );

  const initialProof = await page.evaluate((expectedCatalog) => {
    const game = window.__CINDERLINE__;
    const renderer = game.renderer;
    const uplinkId = game.uplinkEntityId;
    if (renderer.quality !== "high") renderer.toggleQuality();
    game.dismissToasts();
    const rig = renderer.entityObjects.get(uplinkId);
    if (!rig) throw new Error("Commission Uplink rig missing.");
    renderer.setSelected(null);
    renderer.focus(20.4, 14.85);
    renderer.viewWidth = 27;
    renderer.resize();
    renderer.update(0, 8);
    renderer.render(0);
    renderer.renderer.getContext().finish();

    const entities = game.simulation.getEntities();
    const renderEntities = game.snapshot().entities;
    const source = game.simulation.getEntity(12);
    const sourceBelts = entities
      .filter((entity) =>
        entity.kind === "belt" && entity.id >= 14 && entity.id <= 21
      )
      .sort((left, right) => left.id - right.id);
    const inventoryCount = (inventory) =>
      Object.values(inventory ?? {}).reduce(
        (total, count) => total + (count ?? 0),
        0,
      );
    const names = [];
    rig.root.traverse((object) => names.push(object.name));
    const named = (name) => rig.root.getObjectByName(name);
    const prefixCount = (prefix) =>
      names.filter((name) => name.startsWith(prefix)).length;
    const relay = renderEntities.find((entity) => entity.id === 23);
    const paintedArmor = named(
      "commission-uplink-power-sponson-chipped-armor-shell",
    );
    const reflectorPanels = named(
      "commission-uplink-true-stepped-concave-segmented-reflector-face",
    );
    const carrier = named(
      "commission-uplink-loaded-only-open-steel-payload-carrier",
    );
    const rackTeeth = named(
      "commission-uplink-visible-shuttle-rack-drive-teeth",
    );
    const railTies = named(
      "commission-uplink-transfer-rail-supported-cross-ties",
    );
    const railRollers = named(
      "commission-uplink-exposed-transfer-roller-train",
    );
    const outgoingBeam = rig.parts.uplinkOutgoingBeam;
    let outgoingBeamMeshCount = 0;
    outgoingBeam?.traverse((object) => {
      if (object.isMesh) outgoingBeamMeshCount += 1;
    });
    const acknowledgementBeam = rig.parts.uplinkAcknowledgementBeam;
    let acknowledgementBeamMeshCount = 0;
    acknowledgementBeam?.traverse((object) => {
      if (object.isMesh) acknowledgementBeamMeshCount += 1;
    });
    return {
      alloy: game.alloy,
      stats: game.stats(),
      ledger: game.constructionLedger(),
      uplinkId,
      uplinkInventory: game.uplinkInventory,
      uplinkStorage: game.simulation.getEntity(uplinkId)?.inventory ?? null,
      entityIds: entities.map(({ id }) => id).sort((a, b) => a - b),
      paidKinds: entities
        .filter(({ id }) => id >= 12 && id <= 42)
        .map(({ id, kind }) => ({ id, kind })),
      source: {
        id: source?.id ?? null,
        inventory: source?.inventory ?? null,
        inventoryCount: inventoryCount(source?.inventory),
        beltItemCount: sourceBelts.reduce(
          (total, belt) => total + belt.beltItems.length,
          0,
        ),
        totalCargo:
          inventoryCount(source?.inventory)
          + sourceBelts.reduce(
            (total, belt) => total + belt.beltItems.length,
            0,
          ),
        route: sourceBelts.map(
          ({ x, y, direction }) => `${x}:${y}:${direction}`,
        ).join("|"),
        dockId: sourceBelts.at(-1)?.id ?? null,
        dockItemCount: sourceBelts.at(-1)?.beltItems.length ?? null,
      },
      production: [24, 25, 26].map((id) => {
        const entity = game.simulation.getEntity(id);
        return {
          id,
          kind: entity?.kind ?? null,
          recipeId: entity?.recipeId ?? null,
          input: entity?.input ?? null,
        };
      }),
      generator: {
        id: 42,
        kind: game.simulation.getEntity(42)?.kind ?? null,
        coal: game.simulation.getEntity(42)?.fuel?.coal ?? 0,
      },
      relay: {
        id: relay?.id ?? null,
        kind: relay?.kind ?? null,
        powered: relay?.powered ?? null,
        networkId: relay?.powerNetworkId ?? null,
      },
      renderer: {
        quality: renderer.quality,
        variant: rig.variant,
        kind: rig.kind,
        canvas: [
          renderer.renderer.domElement.width,
          renderer.renderer.domElement.height,
        ],
        names,
        requiredCatalog: expectedCatalog,
        transferCatalog: [
          ...(rig.parts.uplinkTransferPayloadVariants?.keys() ?? []),
        ],
        custodyCatalogs:
          (rig.parts.uplinkCustodySlotVariants ?? []).map(
            (variants) => [...variants.keys()],
          ),
        serviceHatchCount: prefixCount(
          "commission-uplink-midvalue-service-hatch-",
        ),
        serviceDeckPanelCount: prefixCount(
          "commission-uplink-segmented-shadowless-service-deck-panel-",
        ),
        reflectorSegmentCount:
          reflectorPanels?.userData.segmentCount ?? null,
        reflectorDepthProfile:
          reflectorPanels?.userData.depthProfile ?? null,
        railCrossTieCount: railTies?.userData.crossTieCount ?? null,
        railRollerCount: railRollers?.userData.rollerCount ?? null,
        rackToothCount: rackTeeth?.count ?? null,
        clampCount: rig.parts.uplinkTransferClamps?.length ?? 0,
        armCount: rig.parts.uplinkTransferArms?.length ?? 0,
        jawCount: rig.parts.uplinkTransferJaws?.length ?? 0,
        scissorCount: rig.parts.uplinkTransferScissors?.length ?? 0,
        actuatorRodPresent:
          rig.parts.uplinkTransferActuatorRod !== undefined,
        outgoingBeamPresent:
          outgoingBeam !== undefined,
        outgoingBeamVisible: outgoingBeam?.visible ?? null,
        outgoingBeamChildCount: outgoingBeam?.children.length ?? null,
        outgoingBeamMeshCount,
        packetCount: rig.parts.uplinkTransmissionPackets?.length ?? 0,
        acknowledgementBeamPresent:
          acknowledgementBeam !== undefined,
        acknowledgementBeamVisible:
          acknowledgementBeam?.visible ?? null,
        acknowledgementBeamChildCount:
          acknowledgementBeam?.children.length ?? null,
        acknowledgementBeamMeshCount,
        acknowledgementPacketCount:
          rig.parts.uplinkAcknowledgementPackets?.length ?? 0,
        receiverRingCount:
          rig.parts.uplinkTransmissionReceiverRings?.length ?? 0,
        acknowledgementLatchPresent:
          rig.parts.uplinkAcknowledgementLatch !== undefined,
        shadowImportanceLod: JSON.parse(JSON.stringify(
          renderer.entityRoot.userData.highShadowImportanceLod ?? null,
        )),
        uplinkShadowImportanceRole:
          rig.root.userData.highShadowImportanceRole ?? null,
        endpointShadowImportanceRole:
          renderer.entityObjects.get(23)?.root.userData
            .highShadowImportanceRole ?? null,
        shutterCount:
          rig.parts.uplinkTransmissionShutters?.length ?? 0,
        carrierBounds: carrier?.userData.bounds ?? null,
        carrierLoadedOnly: carrier?.userData.loadedOnly ?? null,
        ironPlateStampPresent:
          named(
            "commission-uplink-iron-plate-embossed-fe-identity-stamp",
          ) !== undefined,
        opaqueDoorLeafCount: prefixCount(
          "commission-uplink-custody-door-1-opaque-armored-leaf",
        ) + prefixCount(
          "commission-uplink-custody-door-2-opaque-armored-leaf",
        ),
        authoredArmor: {
          material: paintedArmor?.material?.name ?? null,
          asset:
            paintedArmor?.material?.userData.authoredAsset ?? null,
          assetHash:
            paintedArmor?.material?.userData.authoredAssetHash ?? null,
          normalMap:
            paintedArmor?.material?.normalMap?.name ?? null,
          roughnessMap:
            paintedArmor?.material?.roughnessMap?.name ?? null,
          aoMap: paintedArmor?.material?.aoMap?.name ?? null,
        },
        memory: JSON.parse(
          JSON.stringify(renderer.renderer.info.memory),
        ),
      },
    };
  }, EXPECTED_CATALOG);

  const paidLedger = initialProof.ledger.filter(
    ({ provenance }) => provenance.source === "paid",
  );
  const grantedLedger = initialProof.ledger.filter(
    ({ provenance }) => provenance.source === "granted",
  );
  assert(
    initialProof.alloy === 0
      && initialProof.stats.entityCount === 42
      && initialProof.entityIds.join("|")
        === Array.from({ length: 42 }, (_, index) => index + 1).join("|")
      && initialProof.ledger.length === 42
      && grantedLedger.length === 11
      && grantedLedger.map(({ entityId }) => entityId).join("|")
        === "1|2|3|4|5|6|7|8|9|10|11"
      && paidLedger.length === 31
      && paidLedger.map(({ entityId }) => entityId).join("|")
        === Array.from({ length: 31 }, (_, index) => index + 12).join("|")
      && paidLedger.reduce(
        (total, { provenance }) => total + provenance.paidCost,
        0,
      ) === 240
      && initialProof.ledger.find(({ entityId }) => entityId === 11)
        ?.provenance.source === "granted"
      && initialProof.ledger.find(({ entityId }) => entityId === 11)
        ?.provenance.paidCost === 0
      && initialProof.source.id === 12
      && initialProof.source.route === EXPECTED_ROUTE
      && initialProof.source.dockId === 21
      && initialProof.source.totalCargo === 49
      && initialProof.uplinkInventory.entries.length === 0
      && Object.keys(initialProof.uplinkStorage).length === 0
      && initialProof.production.map(({ recipeId }) => recipeId).join("|")
        === "smeltIron|fireBrick|smeltCopper"
      && initialProof.production.every(({ kind }) => kind === "smelter")
      && initialProof.generator.kind === "generator"
      && initialProof.generator.coal >= 1
      && initialProof.relay.id === 23
      && initialProof.relay.kind === "gridRelay"
      && Number.isSafeInteger(initialProof.relay.networkId),
    `Paid-authenticity/route proof is false: ${
      JSON.stringify(initialProof)
    }.`,
  );

  const requiredNames = [
    "commission-uplink-reinforced-foundation",
    "commission-uplink-raised-azimuth-bearing-load-collar",
    "commission-uplink-stout-fork-yoke",
    "commission-uplink-elevation-trunnions",
    "commission-uplink-clean-parabolic-reflector",
    "commission-uplink-true-stepped-concave-segmented-reflector-face",
    "commission-uplink-prime-focus-feed-horn",
    "commission-uplink-rigid-copper-waveguide",
    "commission-uplink-front-cargo-custody-route",
    "commission-uplink-engineered-unloading-bridge",
    "commission-uplink-exposed-load-bearing-transfer-rail",
    "commission-uplink-visible-side-mounted-shuttle-drive-rack",
    "commission-uplink-actuator-to-shuttle-rack-pinion",
    "commission-uplink-paired-custody-entry-positive-stops",
    "commission-uplink-articulated-transfer-carriage",
    "commission-uplink-visible-belt-end-pickup-fork-and-lift-table",
    "commission-uplink-loaded-only-open-steel-payload-carrier",
    "commission-uplink-physical-locking-custody-receiver-chamber",
    "commission-uplink-physical-relay-acknowledgement-latch",
    "commission-uplink-three-stage-custody-conversion-capacitor",
    "commission-uplink-continuous-transmit-beam-sleeve",
    "commission-uplink-return-acknowledgement-beam-sleeve",
    "commission-uplink-relay-receiver-field-ring-2",
    "commission-uplink-relay-receiver-physical-mounting-backplate",
    "commission-uplink-relay-receiver-grounded-capture-mast",
    "commission-uplink-iron-plate-embossed-fe-identity-stamp",
  ];
  assert(
    initialProof.renderer.quality === "high"
      && initialProof.renderer.variant === "uplink"
      && initialProof.renderer.kind === "storage"
      && initialProof.renderer.canvas.join("|") === "1920|1080"
      && requiredNames.every(
        (name) => initialProof.renderer.names.includes(name),
      )
      && initialProof.renderer.transferCatalog.join("|")
        === EXPECTED_CATALOG.join("|")
      && initialProof.renderer.custodyCatalogs.length === 3
      && initialProof.renderer.custodyCatalogs.every(
        (catalog) => catalog.join("|") === EXPECTED_CATALOG.join("|"),
      )
      && initialProof.renderer.serviceHatchCount === 3
      && initialProof.renderer.serviceDeckPanelCount === 6
      && initialProof.renderer.reflectorSegmentCount === 24
      && initialProof.renderer.railCrossTieCount === 2
      && initialProof.renderer.railRollerCount === 2
      && initialProof.renderer.rackToothCount === 5
      && initialProof.renderer.clampCount === 2
      && initialProof.renderer.armCount === 0
      && initialProof.renderer.jawCount === 0
      && initialProof.renderer.scissorCount === 0
      && !initialProof.renderer.actuatorRodPresent
      && initialProof.renderer.outgoingBeamPresent
      && initialProof.renderer.outgoingBeamVisible === false
      && initialProof.renderer.outgoingBeamChildCount === 1
      && initialProof.renderer.outgoingBeamMeshCount === 1
      && initialProof.renderer.packetCount === 3
      && initialProof.renderer.acknowledgementBeamPresent
      && initialProof.renderer.acknowledgementBeamVisible === false
      && initialProof.renderer.acknowledgementBeamChildCount === 1
      && initialProof.renderer.acknowledgementBeamMeshCount === 1
      && initialProof.renderer.acknowledgementPacketCount === 3
      && initialProof.renderer.receiverRingCount === 2
      && initialProof.renderer.acknowledgementLatchPresent
      && initialProof.renderer.shadowImportanceLod.quality === "high"
      && initialProof.renderer.shadowImportanceLod.managedRigCount === 42
      && initialProof.renderer.shadowImportanceLod.endpointRelayIds
        .includes(23)
      && initialProof.renderer.shadowImportanceLod
        .foreignAdapterTraversalCount === 0
      && initialProof.renderer.uplinkShadowImportanceRole === "uplink"
      && initialProof.renderer.endpointShadowImportanceRole
        === "uplink-endpoint-relay"
      && initialProof.renderer.shutterCount === 3
      && initialProof.renderer.carrierLoadedOnly
      && initialProof.renderer.carrierBounds.width === 0.84
      && initialProof.renderer.carrierBounds.depth === 0.52
      && initialProof.renderer.ironPlateStampPresent
      && initialProof.renderer.opaqueDoorLeafCount === 2
      && initialProof.renderer.authoredArmor.asset
        === "/assets/cinder-painted-steel-aged-v2.png"
      && Boolean(initialProof.renderer.authoredArmor.assetHash)
      && Boolean(initialProof.renderer.authoredArmor.normalMap)
      && Boolean(initialProof.renderer.authoredArmor.roughnessMap)
      && Boolean(initialProof.renderer.authoredArmor.aoMap),
    `Pass 7 structure/material proof is false: ${
      JSON.stringify(initialProof.renderer)
    }.`,
  );

  // Resume through the real pause control so evidence keeps the production
  // HUD/canvas without a synthetic DOM hide. The next callback is then
  // intercepted and every evidence state is rendered explicitly below.
  await page.keyboard.press("Space");
  await page.waitForFunction(() => {
    const pausePlate = document.querySelector("[data-ref='pause-plate']");
    return !(
      pausePlate instanceof HTMLElement
      && getComputedStyle(pausePlate).display !== "none"
      && getComputedStyle(pausePlate).visibility !== "hidden"
    );
  });
  await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    game.dismissToasts();
    game.refreshHUD();
  });
  await page.waitForFunction(
    () => document.querySelectorAll("[data-toast-id]").length === 0,
    undefined,
    { timeout: 2_000 },
  );
  const renderLoopFreeze = await page.evaluate(() => {
    let interceptedRequests = 0;
    window.requestAnimationFrame = () => {
      interceptedRequests += 1;
      return 0;
    };
    return {
      installed: window.requestAnimationFrame() === 0,
      interceptedRequests,
    };
  });
  assert(
    renderLoopFreeze.installed && renderLoopFreeze.interceptedRequests === 1,
    `Could not freeze the autonomous render loop: ${
      JSON.stringify(renderLoopFreeze)
    }.`,
  );
  await page.waitForTimeout(100);

  const canvas = page.locator("#world");
  const frames = {};
  const captureDeterministicFrame = async (
    name,
    { focus, viewWidth, elapsed, cycle = null },
  ) => {
    const renderFrame = () =>
      page.evaluate((configuration) => {
        const game = window.__CINDERLINE__;
        const renderer = game.renderer;
        const rig = renderer.entityObjects.get(game.uplinkEntityId);
        if (!rig) throw new Error("Commission Uplink rig missing.");
        game.dismissToasts();
        game.refreshHUD();
        renderer.setSelected(null);
        renderer.focus(configuration.focus[0], configuration.focus[1]);
        renderer.viewWidth = configuration.viewWidth;
        renderer.resize();
        const elapsed = configuration.cycle === null
          ? configuration.elapsed
          : 42 + configuration.cycle * 4.2 - rig.phaseOffset * 0.41;
        renderer.update(0, elapsed);
        renderer.render(0);
        renderer.renderer.getContext().finish();
        const effectivelyVisible = (object) => {
          if (!object) return false;
          let current = object;
          while (current) {
            if (!current.visible) return false;
            if (current === rig.root) return true;
            current = current.parent;
          }
          return false;
        };
        const relayRig = renderer.entityObjects.get(23);
        const outgoingBeam = rig.parts.uplinkOutgoingBeam;
        const acknowledgementBeam = rig.parts.uplinkAcknowledgementBeam;
        const receiver = rig.parts.uplinkTransmissionReceiver;
        const ironPlate = rig.parts.uplinkTransferPayloadVariants?.get(
          "ironPlate",
        );
        const ironPlateStamp = ironPlate?.getObjectByName(
          "commission-uplink-iron-plate-embossed-fe-identity-stamp",
        );
        const ironPlateStraps = ironPlate?.getObjectByName(
          "commission-uplink-iron-plate-two-visible-retaining-straps",
        );
        const ironPlateLayers = ironPlate?.getObjectByName(
          "commission-uplink-iron-plate-six-layer-batched-stack",
        );
        const receiverBackplate = receiver?.getObjectByName(
          "commission-uplink-relay-receiver-physical-mounting-backplate",
        );
        const receiverMast = receiver?.getObjectByName(
          "commission-uplink-relay-receiver-grounded-capture-mast",
        );
        const beltContact = rig.root.getObjectByName(
          "commission-uplink-belt-interface-contact",
        );
        const objectiveList = document.querySelector(
          "[data-ref='objective-list']",
        );
        const toastElements = [
          ...document.querySelectorAll("[data-toast-id]"),
        ];
        const visibleToastCount = toastElements.filter((element) => {
          if (!(element instanceof HTMLElement)) return false;
          const style = getComputedStyle(element);
          const bounds = element.getBoundingClientRect();
          return style.display !== "none"
            && style.visibility !== "hidden"
            && Number(style.opacity) > 0
            && bounds.width > 0
            && bounds.height > 0;
        }).length;
        const projectToCanvas = (object) => {
          if (!object) return null;
          const point = object.getWorldPosition(
            object.position.clone().set(0, 0, 0),
          ).project(renderer.camera);
          const bounds =
            renderer.renderer.domElement.getBoundingClientRect();
          const x = (point.x + 1) * bounds.width * 0.5;
          const y = (-point.y + 1) * bounds.height * 0.5;
          const topElement = document.elementFromPoint(
            bounds.left + x,
            bounds.top + y,
          );
          return {
            x,
            y,
            hudObstructed: Boolean(topElement?.closest("#hud")),
            worldCanvasHit: topElement === renderer.renderer.domElement,
            topElement:
              topElement instanceof HTMLElement
                ? {
                    tag: topElement.tagName,
                    id: topElement.id || null,
                    dataRef: topElement.dataset.ref ?? null,
                    className: topElement.className,
                  }
                : null,
          };
        };
        return {
          elapsed,
          framing: {
            focus: configuration.focus,
            viewWidth: configuration.viewWidth,
            beltContactCanvas: projectToCanvas(beltContact),
          },
          phase: rig.root.userData.uplinkTransmissionPhase,
          transferProgress: rig.entity.uplinkTransferProgress ?? null,
          returning: rig.entity.uplinkTransferReturning ?? null,
          transferItem: rig.entity.uplinkTransferItem ?? null,
          carriageState:
            rig.parts.uplinkTransferCarriage?.userData.mechanicalState
            ?? null,
          carriageZ:
            rig.parts.uplinkTransferCarriage?.position.z ?? null,
          carrierOccupied:
            rig.parts.uplinkTransferPayloadCarrier?.userData.occupied
            ?? null,
          payloadVisible:
            rig.parts.uplinkTransferPayload?.visible ?? null,
          visiblePayloadKinds: [
            ...(rig.parts.uplinkTransferPayloadVariants?.values() ?? []),
          ].filter(effectivelyVisible).map(
            (variant) => variant.userData.itemKind,
          ),
          clampStates:
            (rig.parts.uplinkTransferClamps ?? []).map(
              (clamp) => clamp.userData.mechanicalState,
            ),
          chamberState:
            rig.parts.uplinkCustodyChamber?.userData.receiverState ?? null,
          doorClosures:
            (rig.parts.uplinkCustodyDoors ?? []).map(
              (door) => door.userData.closure,
            ),
          custodySeal: {
            closure:
              rig.parts.uplinkCustodySeal?.userData.closure ?? null,
            pressureState:
              rig.parts.uplinkCustodySeal?.userData.pressureState ?? null,
          },
          lockingBars:
            (rig.parts.uplinkCustodyLockingBars ?? []).map(
              (bar) => ({
                closure: bar.userData.closure ?? null,
                rotationZ: bar.rotation.z,
              }),
            ),
          securedCustodyCount:
            rig.parts.uplinkCustodyMaterial?.userData.securedCustodyCount
            ?? null,
          manifestReady:
            rig.parts.uplinkCustodyMaterial?.userData.manifestReady ?? null,
          latchState:
            rig.parts.uplinkAcknowledgementLatch?.userData.mechanicalState
            ?? null,
          latchRotation:
            rig.parts.uplinkAcknowledgementLatch?.rotation.z ?? null,
          relayState:
            relayRig?.root.userData.uplinkReceptionPhase ?? null,
          relaySource:
            relayRig?.root.userData.uplinkReceptionSourceEntityId ?? null,
          relayVisibleResponse:
            relayRig?.root.userData.uplinkVisibleRelayResponse ?? null,
          outgoingBeamVisible: effectivelyVisible(outgoingBeam),
          outgoingBeamPath: {
            length: outgoingBeam?.userData.pathLength ?? null,
            destinationEntityId:
              outgoingBeam?.userData.destinationEntityId ?? null,
            destinationKind:
              outgoingBeam?.userData.destinationKind ?? null,
          },
          outgoingBeamMeshCount: outgoingBeam?.children.filter(
            effectivelyVisible,
          ).length ?? 0,
          visibleTransmissionPacketCount:
            (rig.parts.uplinkTransmissionPackets ?? []).filter(
              effectivelyVisible,
            ).length,
          acknowledgementBeamVisible:
            effectivelyVisible(acknowledgementBeam),
          acknowledgementBeamPath: {
            length: acknowledgementBeam?.userData.pathLength ?? null,
            originEntityId:
              acknowledgementBeam?.userData.originEntityId ?? null,
            destinationEntityId:
              acknowledgementBeam?.userData.destinationEntityId ?? null,
          },
          acknowledgementBeamMeshCount:
            acknowledgementBeam?.children.filter(effectivelyVisible).length
            ?? 0,
          visibleAcknowledgementPacketCount:
            (rig.parts.uplinkAcknowledgementPackets ?? []).filter(
              effectivelyVisible,
            ).length,
          receiverVisible: effectivelyVisible(receiver),
          receiverMount: {
            destinationEntityId:
              receiver?.userData.destinationEntityId ?? null,
            destinationKind: receiver?.userData.destinationKind ?? null,
            backplateVisible: effectivelyVisible(receiverBackplate),
            mastVisible: effectivelyVisible(receiverMast),
          },
          receiverRingScales:
            (rig.parts.uplinkTransmissionReceiverRings ?? []).map(
              (ring) => ring.scale.x,
            ),
          ironPlateStampVisible: effectivelyVisible(ironPlateStamp),
          ironPlateStrapsVisible: effectivelyVisible(ironPlateStraps),
          ironPlateScale: ironPlate?.scale.toArray() ?? null,
          ironPlateMountScale: ironPlate?.userData.mountScale ?? null,
          ironPlateMountVerticalScale:
            ironPlate?.userData.mountVerticalScale ?? null,
          ironPlateCarrierAligned:
            ironPlate?.userData.carrierAligned ?? null,
          ironPlateLayerCount:
            ironPlateLayers?.userData.layerCount ?? null,
          hud: {
            missionText: objectiveList?.textContent
              ?.replace(/\s+/g, " ")
              .trim() ?? null,
            objectives: [
              ...(objectiveList?.querySelectorAll("[data-objective-id]")
                ?? []),
            ].map((row) => ({
              id:
                row instanceof HTMLElement
                  ? row.dataset.objectiveId ?? null
                  : null,
              label:
                row.querySelector(".objective-name")?.textContent?.trim()
                ?? null,
              count:
                row.querySelector(".objective-count")?.textContent?.trim()
                ?? null,
              complete: row.classList.contains("is-done"),
            })),
          },
          toasts: {
            count: toastElements.length,
            visibleCount: visibleToastCount,
            text: toastElements.map(
              (element) => element.textContent?.replace(/\s+/g, " ").trim()
                ?? "",
            ),
          },
          shutters:
            (rig.parts.uplinkTransmissionShutters ?? []).map((shutter) => ({
              active: shutter.userData.activeState,
              y: shutter.position.y,
              rotationZ: shutter.rotation.z,
            })),
          canvas: [
            renderer.renderer.domElement.width,
            renderer.renderer.domElement.height,
          ],
        };
      }, { focus, viewWidth, elapsed, cycle });
    await renderFrame();
    await page.waitForFunction(
      () => document.querySelectorAll("[data-toast-id]").length === 0,
      undefined,
      { timeout: 2_000 },
    );
    const proof = await renderFrame();
    assert(
      proof.toasts.count === 0 && proof.toasts.visibleCount === 0,
      `${name} frame contains a transient toast: ${
        JSON.stringify(proof.toasts)
      }.`,
    );
    if (
      PROVISIONAL_CAPTURE_MODE
      && !PROVISIONAL_CAPTURE_SCENES.has(name)
    ) {
      const repeatedProof = await renderFrame();
      assert(
        JSON.stringify(proof) === JSON.stringify(repeatedProof),
        `${name} deterministic render proof failed without capture: ${
          JSON.stringify({ proof, repeatedProof })
        }.`,
      );
      frames[name] = {
        path: null,
        sha256: null,
        bytes: 0,
        dimensions: [...proof.canvas],
        deterministicRepeatSha256: null,
        proof,
        provisionalCaptureSkipped: true,
      };
      return;
    }
    const first = await canvas.screenshot({ animations: "disabled" });
    const repeatedProof = await renderFrame();
    const second = await canvas.screenshot({ animations: "disabled" });
    const firstHash = sha256(first);
    const secondHash = sha256(second);
    if (
      firstHash !== secondHash
      || JSON.stringify(proof) !== JSON.stringify(repeatedProof)
    ) {
      await writeFile(
        `${OUTPUT_DIRECTORY}/uplink-pass7-${name}-determinism-a.png`,
        first,
      );
      await writeFile(
        `${OUTPUT_DIRECTORY}/uplink-pass7-${name}-determinism-b.png`,
        second,
      );
    }
    assert(
      firstHash === secondHash
        && JSON.stringify(proof) === JSON.stringify(repeatedProof),
      `${name} deterministic render proof failed: ${
        JSON.stringify({
          firstHash,
          secondHash,
          proof,
          repeatedProof,
        })
      }.`,
    );
    const dimensions = pngDimensions(first);
    assert(
      dimensions.join("|") === "1920|1080",
      `${name} native frame dimensions are false: ${dimensions}.`,
    );
    const path = `${OUTPUT_DIRECTORY}/uplink-pass7-${name}.png`;
    await writeFile(path, first);
    frames[name] = {
      path,
      sha256: firstHash,
      bytes: first.length,
      dimensions,
      deterministicRepeatSha256: secondHash,
      proof,
    };
  };

  await captureDeterministicFrame("district", {
    focus: [20.4, 15.1],
    viewWidth: 25,
    elapsed: 8,
  });
  await captureDeterministicFrame("empty", {
    focus: [22.3, 12.75],
    viewWidth: 17.2,
    elapsed: 8,
  });
  await captureDeterministicFrame("materials", {
    focus: [22.15, 12.45],
    viewWidth: 16.4,
    elapsed: 8,
  });
  assert(
    frames.district.proof.framing.viewWidth >= 24
      && frames.empty.proof.payloadVisible === false
      && frames.empty.proof.carrierOccupied === false
      && frames.empty.proof.chamberState === "open-empty-ready"
      && frames.empty.proof.visiblePayloadKinds.length === 0
      && frames.empty.proof.framing.viewWidth >= 16
      && frames.materials.proof.framing.viewWidth >= 16
      && frames.empty.proof.framing.beltContactCanvas.x >= 340
      && frames.empty.proof.framing.beltContactCanvas.x <= 1_700
      && frames.empty.proof.framing.beltContactCanvas.y >= 100
      && frames.empty.proof.framing.beltContactCanvas.y <= 840
      && !frames.empty.proof.framing.beltContactCanvas.hudObstructed
      && frames.empty.proof.framing.beltContactCanvas.worldCanvasHit,
    `Initial empty frame is false: ${JSON.stringify(frames.empty.proof)}.`,
  );

  const seatedLifecycle = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    const snapshot = () => {
      const rig = game.renderer.entityObjects.get(game.uplinkEntityId);
      return {
        simulationTick: game.stats().tick,
        progress: rig?.entity.uplinkTransferProgress ?? null,
        returning: rig?.entity.uplinkTransferReturning ?? null,
        item: rig?.entity.uplinkTransferItem ?? null,
        custodyEntries: game.uplinkInventory.entries,
        carriageState:
          rig?.parts.uplinkTransferCarriage?.userData.mechanicalState
          ?? null,
        carrierOccupied:
          rig?.parts.uplinkTransferPayloadCarrier?.userData.occupied
          ?? null,
        payloadVisible:
          rig?.parts.uplinkTransferPayload?.visible ?? null,
        visiblePayloadKinds: [
          ...(rig?.parts.uplinkTransferPayloadVariants?.values() ?? []),
        ].filter((variant) => variant.visible).map(
          (variant) => variant.userData.itemKind,
        ),
      };
    };
    for (let index = 0; index < 700; index += 1) {
      game.advanceUplinkShowcase(0.08);
      const state = snapshot();
      if (
        state.item === "ironPlate"
        && state.returning === false
        && state.progress >= 0.38
        && state.progress <= 0.62
      ) return { found: true, steps: index + 1, state };
    }
    return { found: false, steps: 700, state: snapshot() };
  });
  assert(
    seatedLifecycle.found
      && seatedLifecycle.state.custodyEntries
        .some(({ item, count }) => item === "ironPlate" && count === 1)
      && seatedLifecycle.state.carrierOccupied
      && seatedLifecycle.state.payloadVisible
      && seatedLifecycle.state.visiblePayloadKinds.join("|")
        === "ironPlate",
    `Real seated lifecycle state was not found: ${
      JSON.stringify(seatedLifecycle)
    }.`,
  );
  await captureDeterministicFrame("seated", {
    focus: [22.3, 12.75],
    viewWidth: 17.2,
    elapsed: 8,
  });
  assert(
    frames.seated.proof.payloadVisible
      && frames.seated.proof.carrierOccupied
      && frames.seated.proof.visiblePayloadKinds.join("|") === "ironPlate"
      && frames.seated.proof.ironPlateStampVisible
      && frames.seated.proof.ironPlateStrapsVisible
      && frames.seated.proof.ironPlateScale.join("|")
        === "2.25|1.15|2.25"
      && frames.seated.proof.ironPlateMountScale === 2.25
      && frames.seated.proof.ironPlateMountVerticalScale === 1.15
      && frames.seated.proof.ironPlateCarrierAligned
      && frames.seated.proof.ironPlateLayerCount === 6
      && frames.seated.proof.framing.beltContactCanvas.x >= 340
      && frames.seated.proof.framing.beltContactCanvas.x <= 1_700
      && frames.seated.proof.framing.beltContactCanvas.y >= 100
      && frames.seated.proof.framing.beltContactCanvas.y <= 840
      && !frames.seated.proof.framing.beltContactCanvas.hudObstructed
      && frames.seated.proof.framing.beltContactCanvas.worldCanvasHit
      && frames.seated.proof.clampStates.every(
        (state) => state === "cassette-clamped-for-transfer",
      ),
    `Seated frame proof is false: ${
      JSON.stringify(frames.seated.proof)
    }.`,
  );

  const firstCustodyLifecycle = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    const snapshot = () => {
      const rig = game.renderer.entityObjects.get(game.uplinkEntityId);
      return {
        simulationTick: game.stats().tick,
        progress: rig?.entity.uplinkTransferProgress ?? null,
        returning: rig?.entity.uplinkTransferReturning ?? null,
        item: rig?.entity.uplinkTransferItem ?? null,
        custodyCount:
          game.uplinkInventory.entries.reduce(
            (total, entry) => total + entry.count,
            0,
          ),
        carriageState:
          rig?.parts.uplinkTransferCarriage?.userData.mechanicalState
          ?? null,
        carrierOccupied:
          rig?.parts.uplinkTransferPayloadCarrier?.userData.occupied
          ?? null,
        payloadVisible:
          rig?.parts.uplinkTransferPayload?.visible ?? null,
        chamberState:
          rig?.parts.uplinkCustodyChamber?.userData.receiverState ?? null,
        doorClosures:
          (rig?.parts.uplinkCustodyDoors ?? []).map(
            (door) => door.userData.closure,
          ),
      };
    };
    let settlement = null;
    let emptyReturn = null;
    for (let index = 0; index < 600; index += 1) {
      game.advanceUplinkShowcase(0.08);
      const state = snapshot();
      if (
        !settlement
        && state.returning === false
        && state.progress >= 0.98
      ) settlement = state;
      if (
        state.returning === true
        && state.progress >= 0.3
        && state.progress <= 0.75
      ) {
        emptyReturn = state;
        break;
      }
    }
    let readyAfterReturn = null;
    for (let index = 0; index < 300; index += 1) {
      game.advanceUplinkShowcase(0.08);
      const state = snapshot();
      if (
        state.progress === null
        && state.returning === null
        && state.custodyCount >= 1
      ) {
        readyAfterReturn = state;
        break;
      }
    }
    return { settlement, emptyReturn, readyAfterReturn };
  });
  assert(
    firstCustodyLifecycle.settlement
      && firstCustodyLifecycle.settlement.carriageState
        === "seated-inside-interlock"
      && firstCustodyLifecycle.settlement.chamberState
        === "closed-occupied-custody-secured"
      && firstCustodyLifecycle.settlement.doorClosures.every(
        (closure) => closure >= 0.98,
      )
      && firstCustodyLifecycle.emptyReturn
      && firstCustodyLifecycle.emptyReturn.returning
      && firstCustodyLifecycle.emptyReturn.item === null
      && firstCustodyLifecycle.emptyReturn.payloadVisible === false
      && firstCustodyLifecycle.emptyReturn.carrierOccupied === false
      && firstCustodyLifecycle.emptyReturn.carriageState
        === "returning-empty-to-belt-interface"
      && firstCustodyLifecycle.readyAfterReturn
      && firstCustodyLifecycle.readyAfterReturn.progress === null
      && firstCustodyLifecycle.readyAfterReturn.custodyCount >= 1,
    `Custody/empty-return lifecycle proof is false: ${
      JSON.stringify(firstCustodyLifecycle)
    }.`,
  );

  const completionProof = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    const advance = game.advanceUplinkShowcase(120);
    game.refreshHUD();
    game.dismissToasts();
    const rig = game.renderer.entityObjects.get(game.uplinkEntityId);
    const source = game.simulation.getEntity(12);
    const routeBelts = game.simulation.getEntities()
      .filter((entity) =>
        entity.kind === "belt" && entity.id >= 14 && entity.id <= 21
      )
      .sort((left, right) => left.id - right.id);
    const sumInventory = (inventory) =>
      Object.values(inventory ?? {}).reduce(
        (total, count) => total + (count ?? 0),
        0,
      );
    return {
      advance,
      simulationTick: game.stats().tick,
      inventory: game.uplinkInventory,
      custodyCount:
        game.uplinkInventory.entries.reduce(
          (total, entry) => total + entry.count,
          0,
        ),
      sourceInventory: source?.inventory ?? null,
      sourceInventoryCount: sumInventory(source?.inventory),
      sourceBeltItems:
        routeBelts.reduce(
          (total, belt) => total + belt.beltItems.length,
          0,
        ),
      finalDockItems: routeBelts.at(-1)?.beltItems.length ?? null,
      uplinkSimulationStorage:
        game.simulation.getEntity(game.uplinkEntityId)?.inventory ?? null,
      manifest: rig?.entity.uplinkCustodyManifest ?? null,
      rendererCustodyCount: rig?.entity.uplinkCustodyCount ?? null,
      transmissionRequested:
        rig?.entity.uplinkTransmissionActive ?? null,
      securedCustodyCount:
        rig?.parts.uplinkCustodyMaterial?.userData.securedCustodyCount
        ?? null,
      manifestReady:
        rig?.parts.uplinkCustodyMaterial?.userData.manifestReady ?? null,
      carrierOccupied:
        rig?.parts.uplinkTransferPayloadCarrier?.userData.occupied ?? null,
      payloadVisible:
        rig?.parts.uplinkTransferPayload?.visible ?? null,
      carriageState:
        rig?.parts.uplinkTransferCarriage?.userData.mechanicalState
        ?? null,
      hudObjectives: [
        ...document.querySelectorAll(
          "[data-ref='objective-list'] [data-objective-id]",
        ),
      ].map((row) => ({
        id:
          row instanceof HTMLElement
            ? row.dataset.objectiveId ?? null
            : null,
        label:
          row.querySelector(".objective-name")?.textContent?.trim()
          ?? null,
        count:
          row.querySelector(".objective-count")?.textContent?.trim()
          ?? null,
        complete: row.classList.contains("is-done"),
      })),
    };
  });
  const completedEntries = new Map(
    completionProof.inventory.entries.map(
      ({ item, count }) => [item, count],
    ),
  );
  assert(
    completionProof.advance.advancedSeconds > 0
      && completionProof.advance.advancedSeconds <= 120
      && completionProof.advance.steps > 0
      && completionProof.advance.sourceInventory === 0
      && completionProof.advance.sourceBeltItems === 0
      && completionProof.advance.custodyCount === 49
      && completionProof.advance.queueDepth === 0
      && completionProof.advance.activeTransfer === false
      && completionProof.advance.manifestComplete
      && completionProof.custodyCount === 49
      && completedEntries.get("ironPlate") === 24
      && completedEntries.get("copperPlate") === 12
      && completedEntries.get("stoneBrick") === 12
      && completedEntries.get("ironOre") === 1
      && completionProof.sourceInventoryCount === 0
      && completionProof.sourceBeltItems === 0
      && completionProof.finalDockItems === 0
      && Object.keys(completionProof.uplinkSimulationStorage).length === 0
      && completionProof.manifest.map(({ kind }) => kind).join("|")
        === "ironPlate|copperPlate|stoneBrick|ironOre"
      && completionProof.rendererCustodyCount === 49
      && completionProof.transmissionRequested
      && completionProof.securedCustodyCount === 49
      && completionProof.manifestReady
      && completionProof.carrierOccupied === false
      && completionProof.payloadVisible === false
      && completionProof.carriageState === "accepting-at-belt-interface"
      && completionProof.hudObjectives.map(
        ({ label, count, complete }) => `${label}:${count}:${complete}`,
      ).join("|")
        === "Iron plate:24/24:true|Copper plate:12/12:true|Fire brick:12/12:true",
    `49-custody/final-zero proof is false: ${
      JSON.stringify(completionProof)
    }.`,
  );

  await captureDeterministicFrame("transmit", {
    focus: [21.6, 12.9],
    viewWidth: 18,
    elapsed: 0,
    cycle: 0.45,
  });
  await captureDeterministicFrame("ack", {
    focus: [21.6, 12.9],
    viewWidth: 18,
    elapsed: 0,
    cycle: 0.78,
  });
  const expectedCompletedHud =
    "Iron plate:24/24:true|Copper plate:12/12:true|Fire brick:12/12:true";
  const hudSignature = (frame) =>
    frame.proof.hud.objectives.map(
      ({ label, count, complete }) => `${label}:${count}:${complete}`,
    ).join("|");
  const requiredFrameNames = [
    "district",
    "empty",
    "materials",
    "seated",
    "transmit",
    "ack",
  ];
  assert(
    Object.keys(frames).join("|") === requiredFrameNames.join("|")
      && requiredFrameNames.every((name) =>
        frames[name].dimensions.join("|") === "1920|1080"
        && frames[name].proof.canvas.join("|") === "1920|1080"
        && frames[name].proof.framing.viewWidth >= 16
        && frames[name].proof.framing.viewWidth <= 25
        && frames[name].proof.toasts.count === 0
        && frames[name].proof.toasts.visibleCount === 0
      ),
    `Six-frame native/normal-zoom/toast-free proof is false: ${
      JSON.stringify(frames)
    }.`,
  );
  assert(
    frames.transmit.proof.phase === "packets-in-transit"
      && frames.transmit.proof.relayState === "packets-in-transit"
      && frames.transmit.proof.relaySource === 11
      && frames.transmit.proof.relayVisibleResponse
      && frames.transmit.proof.outgoingBeamVisible
      && frames.transmit.proof.outgoingBeamMeshCount === 1
      && frames.transmit.proof.visibleTransmissionPacketCount >= 2
      && frames.transmit.proof.outgoingBeamPath.length > 0
      && frames.transmit.proof.outgoingBeamPath.destinationEntityId === 23
      && frames.transmit.proof.outgoingBeamPath.destinationKind
        === "powered-grid-relay"
      && !frames.transmit.proof.acknowledgementBeamVisible
      && frames.transmit.proof.receiverVisible
      && frames.transmit.proof.receiverMount.destinationEntityId === 23
      && frames.transmit.proof.receiverMount.destinationKind
        === "powered-grid-relay"
      && frames.transmit.proof.receiverMount.backplateVisible
      && frames.transmit.proof.receiverMount.mastVisible
      && frames.transmit.proof.shutters[1].active
      && frames.transmit.proof.manifestReady
      && frames.transmit.proof.securedCustodyCount === 49
      && frames.transmit.proof.chamberState
        === "closed-occupied-custody-secured"
      && frames.transmit.proof.doorClosures.every(
        (closure) => closure >= 0.98,
      )
      && frames.transmit.proof.custodySeal.closure >= 0.98
      && frames.transmit.proof.custodySeal.pressureState
        === "sealed-and-pressurized"
      && frames.transmit.proof.lockingBars.every(
        ({ closure }) => closure >= 0.98,
      )
      && hudSignature(frames.transmit) === expectedCompletedHud
      && frames.transmit.proof.hud.missionText?.includes("24/24")
      && (
        frames.transmit.proof.hud.missionText?.match(/12\/12/g) ?? []
      ).length === 2
      && frames.ack.proof.phase === "relay-acknowledged"
      && frames.ack.proof.relayState === "relay-acknowledged"
      && frames.ack.proof.relaySource === 11
      && frames.ack.proof.relayVisibleResponse
      && !frames.ack.proof.outgoingBeamVisible
      && frames.ack.proof.acknowledgementBeamVisible
      && frames.ack.proof.acknowledgementBeamMeshCount === 1
      && frames.ack.proof.visibleAcknowledgementPacketCount >= 2
      && frames.ack.proof.acknowledgementBeamPath.length > 0
      && frames.ack.proof.acknowledgementBeamPath.originEntityId === 23
      && frames.ack.proof.acknowledgementBeamPath.destinationEntityId === 11
      && frames.ack.proof.receiverVisible
      && frames.ack.proof.receiverMount.destinationEntityId === 23
      && frames.ack.proof.receiverMount.destinationKind
        === "powered-grid-relay"
      && frames.ack.proof.receiverMount.backplateVisible
      && frames.ack.proof.receiverMount.mastVisible
      && frames.ack.proof.receiverRingScales.every(
        (scale) => scale >= 1 && scale <= 1.2,
      )
      && frames.ack.proof.shutters[2].active
      && frames.ack.proof.latchState
        === "physically-engaged-persistent-relay-acknowledged"
      && frames.ack.proof.latchRotation < -0.9
      && frames.ack.proof.chamberState
        === "closed-occupied-custody-secured"
      && frames.ack.proof.doorClosures.every(
        (closure) => closure >= 0.98,
      )
      && frames.ack.proof.custodySeal.closure >= 0.98
      && frames.ack.proof.custodySeal.pressureState
        === "sealed-and-pressurized"
      && frames.ack.proof.lockingBars.every(
        ({ closure }) => closure >= 0.98,
      )
      && hudSignature(frames.ack) === expectedCompletedHud
      && frames.ack.proof.hud.missionText?.includes("24/24")
      && (
        frames.ack.proof.hud.missionText?.match(/12\/12/g) ?? []
      ).length === 2,
    `Transmit/ACK physical-state proof is false: ${
      JSON.stringify({
        transmit: frames.transmit.proof,
        ack: frames.ack.proof,
      })
    }.`,
  );

  const performanceProof = await page.evaluate(({
    baseline,
    highMemoryBaseline,
    budgets,
  }) => {
    const game = window.__CINDERLINE__;
    const renderer = game.renderer;
    const uplinkId = game.uplinkEntityId;
    const gl = renderer.renderer.getContext();
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const captureAggregateCost = (elapsed) => {
      const info = renderer.renderer.info;
      const previousAutoReset = info.autoReset;
      info.autoReset = false;
      info.reset();
      renderer.update(0, elapsed);
      renderer.render(0);
      gl.finish();
      const proof = {
        aggregation: "one-complete-world-frame-with-postprocess",
        autoResetDuringCapture: info.autoReset,
        render: clone(info.render),
        memory: clone(info.memory),
      };
      info.autoReset = previousAutoReset;
      info.reset();
      return proof;
    };
    const sampleFrameTimes = (elapsed, sampleCount) => {
      const frameTimes = [];
      for (let index = 0; index < sampleCount; index += 1) {
        const started = performance.now();
        renderer.update(1 / 60, elapsed + index / 60);
        renderer.render(1 / 60);
        gl.finish();
        frameTimes.push(performance.now() - started);
      }
      const sorted = [...frameTimes].sort((left, right) => left - right);
      const totalMs = frameTimes.reduce(
        (total, frameTime) => total + frameTime,
        0,
      );
      return {
        sampleCount,
        totalMs,
        averageMs: totalMs / sampleCount,
        p95Ms:
          sorted[Math.max(0, Math.ceil(sampleCount * 0.95) - 1)],
        minMs: sorted[0],
        maxMs: sorted.at(-1),
        frameTimes,
      };
    };
    if (renderer.quality !== "high") renderer.toggleQuality();
    let rig = renderer.entityObjects.get(uplinkId);
    renderer.setSelected(uplinkId);
    renderer.focus(21.6, 12.9);
    renderer.viewWidth = 18;
    renderer.resize();
    const allocationSignature = () => {
      const geometries = new Set();
      const materials = new Set();
      renderer.scene.traverse((object) => {
        if (object.geometry?.uuid) geometries.add(object.geometry.uuid);
        const objectMaterials = Array.isArray(object.material)
          ? object.material
          : object.material
            ? [object.material]
            : [];
        for (const material of objectMaterials) {
          if (material?.uuid) materials.add(material.uuid);
        }
      });
      return {
        geometries: [...geometries].sort(),
        materials: [...materials].sort(),
        rendererMemory: clone(renderer.renderer.info.memory),
      };
    };
    const castShadowCount = (root) => {
      let count = 0;
      root?.traverse((object) => {
        if (object.isMesh && object.castShadow) count += 1;
      });
      return count;
    };
    const uplinkRigForShadowTest = renderer.entityObjects.get(uplinkId);
    const endpointRigForShadowTest = renderer.entityObjects.get(23);
    const backgroundRigForShadowTest = renderer.entityObjects.get(25);
    const allocationBeforeShadowTransitions = allocationSignature();
    const shadowBeforeSelection = {
      diagnostics: clone(
        renderer.entityRoot.userData.highShadowImportanceLod,
      ),
      uplinkCastShadowCount:
        castShadowCount(uplinkRigForShadowTest?.root),
      endpointCastShadowCount:
        castShadowCount(endpointRigForShadowTest?.root),
      backgroundCastShadowCount:
        castShadowCount(backgroundRigForShadowTest?.root),
      backgroundRole:
        backgroundRigForShadowTest?.root.userData
          .highShadowImportanceRole ?? null,
    };
    renderer.setSelected(25);
    renderer.focus(20, 16);
    const shadowDuringSelection = {
      diagnostics: clone(
        renderer.entityRoot.userData.highShadowImportanceLod,
      ),
      backgroundCastShadowCount:
        castShadowCount(backgroundRigForShadowTest?.root),
      backgroundRole:
        backgroundRigForShadowTest?.root.userData
          .highShadowImportanceRole ?? null,
    };
    renderer.setSelected(uplinkId);
    renderer.focus(21.6, 12.9);
    renderer.viewWidth = 18;
    renderer.resize();
    const allocationAfterShadowTransitions = allocationSignature();
    const shadowAfterRestoration = {
      diagnostics: clone(
        renderer.entityRoot.userData.highShadowImportanceLod,
      ),
      uplinkCastShadowCount:
        castShadowCount(uplinkRigForShadowTest?.root),
      endpointCastShadowCount:
        castShadowCount(endpointRigForShadowTest?.root),
      backgroundCastShadowCount:
        castShadowCount(backgroundRigForShadowTest?.root),
      backgroundRole:
        backgroundRigForShadowTest?.root.userData
          .highShadowImportanceRole ?? null,
    };
    const shadowLodTransitionProof = {
      before: shadowBeforeSelection,
      during: shadowDuringSelection,
      after: shadowAfterRestoration,
      allocationBefore: allocationBeforeShadowTransitions,
      allocationAfter: allocationAfterShadowTransitions,
      allocationsUnchanged:
        JSON.stringify(allocationBeforeShadowTransitions)
        === JSON.stringify(allocationAfterShadowTransitions),
    };
    const elapsed = 42 + 0.45 * 4.2 - rig.phaseOffset * 0.41;
    const highCost = captureAggregateCost(elapsed);
    const highRigWasVisible = rig.root.visible;
    rig.root.visible = false;
    const highCostWithoutUplink = captureAggregateCost(elapsed);
    rig.root.visible = highRigWasVisible;
    const shadowMapWasEnabled = renderer.renderer.shadowMap.enabled;
    renderer.renderer.shadowMap.enabled = false;
    const highCostWithoutShadows = captureAggregateCost(elapsed);
    renderer.renderer.shadowMap.enabled = shadowMapWasEnabled;
    const captureEntityShadowLod = (label, shouldDisable) => {
      const authoredStates = [];
      for (const [entityId, candidate] of renderer.entityObjects) {
        if (!shouldDisable(entityId, candidate)) continue;
        candidate.root.traverse((object) => {
          if (!("castShadow" in object)) return;
          authoredStates.push([object, object.castShadow]);
          object.castShadow = false;
        });
      }
      const cost = captureAggregateCost(elapsed);
      for (const [object, castShadow] of authoredStates) {
        object.castShadow = castShadow;
      }
      return {
        label,
        disabledObjectCount: authoredStates.filter(
          ([, castShadow]) => castShadow,
        ).length,
        cost,
      };
    };
    const distanceFromUplinkFocus = (candidate) => Math.hypot(
      candidate.root.position.x - 21.6,
      candidate.root.position.z - 12.9,
    );
    const highShadowLodScenarios = [
      captureEntityShadowLod(
        "non-uplink-entity-shadows-disabled",
        (_entityId, candidate) => candidate.variant !== "uplink",
      ),
      captureEntityShadowLod(
        "smelter-inserter-relay-shadows-disabled",
        (_entityId, candidate) =>
          candidate.kind === "smelter"
          || candidate.kind === "inserter"
          || candidate.kind === "gridRelay",
      ),
      captureEntityShadowLod(
        "non-uplink-beyond-four-world-units",
        (_entityId, candidate) =>
          candidate.variant !== "uplink"
          && distanceFromUplinkFocus(candidate) > 4,
      ),
      captureEntityShadowLod(
        "non-uplink-beyond-two-world-units",
        (_entityId, candidate) =>
          candidate.variant !== "uplink"
          && distanceFromUplinkFocus(candidate) > 2,
      ),
    ];
    const highEntityContributions = [];
    for (const [entityId, candidate] of renderer.entityObjects) {
      if (!candidate.root.visible) continue;
      const wasVisible = candidate.root.visible;
      candidate.root.visible = false;
      const withoutCandidate = captureAggregateCost(elapsed);
      candidate.root.visible = wasVisible;
      highEntityContributions.push({
        entityId,
        kind: candidate.kind,
        variant: candidate.variant,
        position: candidate.root.position.toArray(),
        distanceFromUplinkFocus: Math.hypot(
          candidate.root.position.x - 21.6,
          candidate.root.position.z - 12.9,
        ),
        calls:
          highCost.render.calls
          - withoutCandidate.render.calls,
        triangles:
          highCost.render.triangles
          - withoutCandidate.render.triangles,
      });
    }
    highEntityContributions.sort(
      (left, right) => right.calls - left.calls,
    );
    const highRootContributions = [];
    for (const [name, candidateRoot] of Object.entries({
      infrastructureRoot: renderer.infrastructureRoot,
      entityRoot: renderer.entityRoot,
      resourceRoot: renderer.resourceRoot,
      itemRoot: renderer.itemRoot,
      effectsRoot: renderer.effectsRoot,
      powerGridRoot: renderer.powerGridRoot,
      overlayRoot: renderer.overlayRoot,
    })) {
      const wasVisible = candidateRoot.visible;
      candidateRoot.visible = false;
      const withoutRoot = captureAggregateCost(elapsed);
      candidateRoot.visible = wasVisible;
      highRootContributions.push({
        name,
        calls:
          highCost.render.calls - withoutRoot.render.calls,
        triangles:
          highCost.render.triangles - withoutRoot.render.triangles,
      });
    }
    const highTiming = sampleFrameTimes(elapsed, 45);
    const high = {
      quality: renderer.quality,
      ...highTiming,
      cost: highCost,
      costWithoutUplink: highCostWithoutUplink,
      costWithoutShadows: highCostWithoutShadows,
      shadowLodScenarios: highShadowLodScenarios,
      uplinkContribution: {
        calls:
          highCost.render.calls
          - highCostWithoutUplink.render.calls,
        triangles:
          highCost.render.triangles
          - highCostWithoutUplink.render.triangles,
      },
      entityContributions: highEntityContributions,
      rootContributions: highRootContributions,
      render: highCost.render,
      memory: highCost.memory,
      reflectorSegments:
        rig.root.getObjectByName(
          "commission-uplink-true-stepped-concave-segmented-reflector-face",
        )?.userData.segmentCount ?? null,
      railRollers:
        rig.root.getObjectByName(
          "commission-uplink-exposed-transfer-roller-train",
        )?.userData.rollerCount ?? null,
      rackTeeth:
        rig.root.getObjectByName(
          "commission-uplink-visible-shuttle-rack-drive-teeth",
        )?.count ?? null,
    };
    renderer.toggleQuality();
    rig = renderer.entityObjects.get(uplinkId);
    renderer.setSelected(uplinkId);
    renderer.focus(21.6, 12.9);
    renderer.viewWidth = 18;
    renderer.resize();
    const lowCost = captureAggregateCost(elapsed);
    const lowRigWasVisible = rig.root.visible;
    rig.root.visible = false;
    const lowCostWithoutUplink = captureAggregateCost(elapsed);
    rig.root.visible = lowRigWasVisible;
    const target = rig.root.getObjectByName(
      "commission-uplink-reinforced-foundation",
    );
    const world = target.getWorldPosition(
      target.position.clone().set(0, 0, 0),
    );
    const point = world.project(renderer.camera);
    const bounds = renderer.renderer.domElement.getBoundingClientRect();
    const picked = renderer.pickEntity(
      bounds.left + (point.x + 1) * bounds.width * 0.5,
      bounds.top + (-point.y + 1) * bounds.height * 0.5,
    );
    const lowTiming = sampleFrameTimes(elapsed, 60);
    const low = {
      quality: renderer.quality,
      variant: rig.variant,
      selectedIndicatorCount:
        rig.parts.uplinkSelectionIndicators?.length ?? 0,
      picked,
      ...lowTiming,
      cost: lowCost,
      costWithoutUplink: lowCostWithoutUplink,
      uplinkContribution: {
        calls:
          lowCost.render.calls
          - lowCostWithoutUplink.render.calls,
        triangles:
          lowCost.render.triangles
          - lowCostWithoutUplink.render.triangles,
      },
      render: lowCost.render,
      memory: lowCost.memory,
      reflectorSegments:
        rig.root.getObjectByName(
          "commission-uplink-true-stepped-concave-segmented-reflector-face",
        )?.userData.segmentCount ?? null,
      railRollers:
        rig.root.getObjectByName(
          "commission-uplink-exposed-transfer-roller-train",
        )?.userData.rollerCount ?? null,
      rackTeeth:
        rig.root.getObjectByName(
          "commission-uplink-visible-shuttle-rack-drive-teeth",
        )?.count ?? null,
    };
    renderer.toggleQuality();
    rig = renderer.entityObjects.get(uplinkId);
    renderer.setSelected(null);
    renderer.update(0, elapsed);
    renderer.render(0);
    gl.finish();
    const percentage = (delta, reference) =>
      reference === 0 ? null : (delta / reference) * 100;
    return {
      methodology: {
        renderCost:
          "renderer.info.autoReset=false; reset; one complete world frame; GPU finish",
        timing:
          "per-frame update + complete render + GPU finish; actual sorted p95",
      },
      baselines: {
        low: baseline,
        highMemory: highMemoryBaseline,
      },
      budgets,
      high,
      low,
      shadowLodTransitionProof,
      deltas: {
        highMinusLow: {
          calls: high.render.calls - low.render.calls,
          triangles: high.render.triangles - low.render.triangles,
          averageMs: high.averageMs - low.averageMs,
          p95Ms: high.p95Ms - low.p95Ms,
        },
        lowVsPass6: {
          calls: low.render.calls - baseline.calls,
          callsPercent: percentage(
            low.render.calls - baseline.calls,
            baseline.calls,
          ),
          triangles: low.render.triangles - baseline.triangles,
          trianglesPercent: percentage(
            low.render.triangles - baseline.triangles,
            baseline.triangles,
          ),
          averageMs: low.averageMs - baseline.averageMs,
          averageMsPercent: percentage(
            low.averageMs - baseline.averageMs,
            baseline.averageMs,
          ),
          geometries: low.memory.geometries - baseline.geometries,
          textures: low.memory.textures - baseline.textures,
        },
        highMemoryVsPass6: {
          geometries:
            high.memory.geometries - highMemoryBaseline.geometries,
          textures: high.memory.textures - highMemoryBaseline.textures,
        },
        budgetHeadroom: {
          highCalls: budgets.high.calls - high.render.calls,
          highTriangles:
            budgets.high.triangles - high.render.triangles,
          highAverageMs: budgets.high.averageMs - high.averageMs,
          highP95Ms: budgets.high.p95Ms - high.p95Ms,
          highGeometries:
            budgets.high.geometries - high.memory.geometries,
          highTextures: budgets.high.textures - high.memory.textures,
          lowCalls: budgets.low.calls - low.render.calls,
          lowTriangles: budgets.low.triangles - low.render.triangles,
          lowAverageMs: budgets.low.averageMs - low.averageMs,
          lowP95Ms: budgets.low.p95Ms - low.p95Ms,
          lowGeometries:
            budgets.low.geometries - low.memory.geometries,
          lowTextures: budgets.low.textures - low.memory.textures,
        },
      },
      infoAutoResetRestored: renderer.renderer.info.autoReset,
      restoredQuality: renderer.quality,
      restoredVariant: rig.variant,
    };
  }, {
    baseline: PASS6_LOW_BASELINE,
    highMemoryBaseline: PASS6_HIGH_MEMORY_BASELINE,
    budgets: PERFORMANCE_BUDGETS,
  });
  await writeFile(
    resolve(
      OUTPUT_DIRECTORY,
      "uplink-pass7-performance-diagnostic.json",
    ),
    `${JSON.stringify(performanceProof, null, 2)}\n`,
  );
  assert(
    performanceProof.high.quality === "high"
      && performanceProof.high.reflectorSegments === 24
      && performanceProof.high.railRollers === 2
      && performanceProof.high.rackTeeth === 5
      && performanceProof.high.cost.autoResetDuringCapture === false
      && performanceProof.high.render.calls > 1
      && performanceProof.high.render.triangles > 1
      && performanceProof.high.render.calls
        <= PERFORMANCE_BUDGETS.high.calls
      && performanceProof.high.render.triangles
        <= PERFORMANCE_BUDGETS.high.triangles
      && performanceProof.high.averageMs
        <= PERFORMANCE_BUDGETS.high.averageMs
      && performanceProof.high.p95Ms <= PERFORMANCE_BUDGETS.high.p95Ms
      && performanceProof.high.memory.geometries
        <= PERFORMANCE_BUDGETS.high.geometries
      && performanceProof.high.memory.textures
        <= PERFORMANCE_BUDGETS.high.textures
      && performanceProof.low.quality === "performance"
      && performanceProof.low.variant === "uplink"
      && performanceProof.low.reflectorSegments === 18
      && performanceProof.low.railRollers === 1
      && performanceProof.low.rackTeeth === 4
      && performanceProof.low.selectedIndicatorCount >= 1
      && performanceProof.low.picked === 11
      && performanceProof.low.cost.autoResetDuringCapture === false
      && performanceProof.low.render.calls > 1
      && performanceProof.low.render.triangles > 1
      && performanceProof.low.render.calls
        <= PERFORMANCE_BUDGETS.low.calls
      && performanceProof.low.render.triangles
        <= PERFORMANCE_BUDGETS.low.triangles
      && performanceProof.low.averageMs
        <= PERFORMANCE_BUDGETS.low.averageMs
      && performanceProof.low.p95Ms <= PERFORMANCE_BUDGETS.low.p95Ms
      && performanceProof.low.memory.geometries
        <= PERFORMANCE_BUDGETS.low.geometries
      && performanceProof.low.memory.textures
        <= PERFORMANCE_BUDGETS.low.textures
      && performanceProof.low.render.calls
        < performanceProof.high.render.calls
      && performanceProof.low.render.triangles
        < performanceProof.high.render.triangles
      && performanceProof.shadowLodTransitionProof.allocationsUnchanged
      && performanceProof.shadowLodTransitionProof.before
        .diagnostics.foreignAdapterTraversalCount === 0
      && performanceProof.shadowLodTransitionProof.before
        .diagnostics.endpointRelayIds.includes(23)
      && performanceProof.shadowLodTransitionProof.before
        .uplinkCastShadowCount > 0
      && performanceProof.shadowLodTransitionProof.before
        .endpointCastShadowCount > 0
      && performanceProof.shadowLodTransitionProof.before
        .backgroundRole === "background-nonhero"
      && performanceProof.shadowLodTransitionProof.before
        .backgroundCastShadowCount === 0
      && performanceProof.shadowLodTransitionProof.during
        .diagnostics.foreignAdapterTraversalCount === 0
      && performanceProof.shadowLodTransitionProof.during
        .backgroundRole === "selected"
      && performanceProof.shadowLodTransitionProof.during
        .backgroundCastShadowCount > 0
      && performanceProof.shadowLodTransitionProof.after
        .diagnostics.foreignAdapterTraversalCount === 0
      && performanceProof.shadowLodTransitionProof.after
        .uplinkCastShadowCount > 0
      && performanceProof.shadowLodTransitionProof.after
        .endpointCastShadowCount > 0
      && performanceProof.shadowLodTransitionProof.after
        .backgroundRole === "background-nonhero"
      && performanceProof.shadowLodTransitionProof.after
        .backgroundCastShadowCount === 0
      && performanceProof.infoAutoResetRestored
      && performanceProof.restoredQuality === "high"
      && performanceProof.restoredVariant === "uplink",
    `Performance LOD/picking proof is false: ${
      JSON.stringify(performanceProof)
    }.`,
  );

  const disposalProof = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    const renderer = game.renderer;
    const uplinkId = game.uplinkEntityId;
    const baseline = renderer.snapshot;
    const withoutUplink = {
      ...baseline,
      entities: baseline.entities.filter(({ id }) => id !== uplinkId),
    };
    renderer.sync(withoutUplink);
    renderer.sync(baseline);
    renderer.update(0, 48);
    renderer.render(0);
    renderer.renderer.getContext().finish();

    const rig = renderer.entityObjects.get(uplinkId);
    if (!rig) throw new Error("Warm-restored Uplink rig missing.");
    const trackedGeometries = new Set();
    rig.root.traverse((object) => {
      if (object.geometry) trackedGeometries.add(object.geometry);
    });
    const geometryDisposals = new Map();
    for (const geometry of trackedGeometries) {
      geometryDisposals.set(geometry, 0);
      const dispose = geometry.dispose.bind(geometry);
      geometry.dispose = () => {
        geometryDisposals.set(
          geometry,
          geometryDisposals.get(geometry) + 1,
        );
        dispose();
      };
    }
    const materialDisposals = new Map();
    for (const material of new Set(rig.ownedMaterials)) {
      materialDisposals.set(material, 0);
      const dispose = material.dispose.bind(material);
      material.dispose = () => {
        materialDisposals.set(
          material,
          materialDisposals.get(material) + 1,
        );
        dispose();
      };
    }
    const baselineState = {
      manifest: rig.entity.uplinkCustodyManifest,
      count: rig.entity.uplinkCustodyCount,
      transmission: rig.entity.uplinkTransmissionActive,
    };
    const root = rig.root;
    const memoryBefore = {
      ...renderer.renderer.info.memory,
      rigCount: renderer.entityObjects.size,
    };
    renderer.sync(withoutUplink);
    const removed = {
      absent: !renderer.entityObjects.has(uplinkId),
      detached: root.parent === null,
      geometryCount: trackedGeometries.size,
      materialCount: materialDisposals.size,
      geometryZeroDisposals:
        [...geometryDisposals.values()].filter((count) => count === 0)
          .length,
      materialZeroDisposals:
        [...materialDisposals.values()].filter((count) => count === 0)
          .length,
      geometryDisposeCalls:
        [...geometryDisposals.values()].reduce(
          (total, count) => total + count,
          0,
        ),
      materialDisposeCalls:
        [...materialDisposals.values()].reduce(
          (total, count) => total + count,
          0,
        ),
    };
    renderer.sync(baseline);
    renderer.update(0, 48);
    renderer.render(0);
    renderer.renderer.getContext().finish();
    const restored = renderer.entityObjects.get(uplinkId);
    const memoryAfter = {
      ...renderer.renderer.info.memory,
      rigCount: renderer.entityObjects.size,
    };
    const restoredState = {
      manifest: restored?.entity.uplinkCustodyManifest,
      count: restored?.entity.uplinkCustodyCount,
      transmission: restored?.entity.uplinkTransmissionActive,
    };
    return {
      removed,
      memoryBefore,
      memoryAfter,
      restored: {
        present: Boolean(restored),
        variant: restored?.variant ?? null,
        exactState:
          JSON.stringify(restoredState) === JSON.stringify(baselineState),
        state: restoredState,
      },
    };
  });
  disposalProof.costControl = {
    baseline: PASS6_UPLINK_RIG_BASELINE,
    budget: UPLINK_RIG_BUDGET,
    delta: {
      geometries:
        disposalProof.removed.geometryCount
        - PASS6_UPLINK_RIG_BASELINE.geometries,
      materials:
        disposalProof.removed.materialCount
        - PASS6_UPLINK_RIG_BASELINE.materials,
    },
    headroom: {
      geometries:
        UPLINK_RIG_BUDGET.geometries
        - disposalProof.removed.geometryCount,
      materials:
        UPLINK_RIG_BUDGET.materials
        - disposalProof.removed.materialCount,
    },
  };
  assert(
    disposalProof.removed.absent
      && disposalProof.removed.detached
      && disposalProof.removed.geometryCount > 100
      && disposalProof.removed.materialCount > 10
      && disposalProof.removed.geometryZeroDisposals === 0
      && disposalProof.removed.materialZeroDisposals === 0
      && disposalProof.removed.geometryDisposeCalls
        >= disposalProof.removed.geometryCount
      && disposalProof.removed.materialDisposeCalls
        >= disposalProof.removed.materialCount
      && disposalProof.removed.geometryCount
        <= UPLINK_RIG_BUDGET.geometries
      && disposalProof.removed.materialCount
        <= UPLINK_RIG_BUDGET.materials
      && disposalProof.restored.present
      && disposalProof.restored.variant === "uplink"
      && disposalProof.restored.exactState
      && disposalProof.memoryAfter.rigCount
        === disposalProof.memoryBefore.rigCount
      && disposalProof.memoryAfter.geometries
        <= disposalProof.memoryBefore.geometries + 2
      && disposalProof.memoryAfter.textures
        <= disposalProof.memoryBefore.textures + 1,
    `Disposal/restoration proof is false: ${
      JSON.stringify(disposalProof)
    }.`,
  );

  const mainSource = await readFile(resolve("src/main.ts"), "utf8");
  const staticSourceProof = {
    circuitSnapshotPreserved:
      /simulation\.stats\(\)\.power\.mode,\s*simulation\.circuitSnapshot\(\)/s
        .test(mainSource),
    constructionLedgerHook:
      /constructionLedger:\s*\(\)\s*=>/.test(mainSource),
    authenticAdvanceHook:
      /advanceUplinkShowcase:\s*\(seconds:\s*number\)\s*=>\s*advanceUplinkShowcase\(seconds\)/
        .test(mainSource),
    directUplinkReceiveAbsent:
      !/freshSimulation\.receive\(\s*uplink\.id/s.test(mainSource),
    directUplinkInventoryFillAbsent:
      !/addProgressionInventory\(\s*uplinkInventory[\s\S]{0,160}(?:24|12|49)/s
        .test(mainSource),
  };
  assert(
    Object.values(staticSourceProof).every(Boolean),
    `Static authenticity guard is false: ${
      JSON.stringify(staticSourceProof)
    }.`,
  );
  assert(
    consoleFailures.length === 0 && requestFailures.length === 0,
    `Browser failures occurred: ${
      JSON.stringify({ consoleFailures, requestFailures })
    }.`,
  );

  const sourceFingerprintAfter = await fingerprintSources();
  const pass6RunnerProofAfter = await inspectPass6Runner();
  const pass6BaselineArtifactProofAfter =
    await inspectPass6BaselineArtifact();
  assert(
    sourceFingerprintAfter.digest === sourceFingerprintBefore.digest,
    `Source/dependency drifted during QA: ${
      JSON.stringify({
        before: sourceFingerprintBefore.digest,
        after: sourceFingerprintAfter.digest,
      })
    }.`,
  );
  assert(
    pass6BaselineArtifactProofAfter.hashMatches
      && pass6BaselineArtifactProofAfter.metricsMatch
      && pass6BaselineArtifactProofAfter.sha256
        === pass6BaselineArtifactProof.sha256,
    `Pass 6 baseline artifact drifted during QA: ${
      JSON.stringify({
        before: pass6BaselineArtifactProof,
        after: pass6BaselineArtifactProofAfter,
      })
    }.`,
  );
  assert(
    pass6RunnerProofAfter.preserved
      && pass6RunnerProofAfter.sha256 === pass6RunnerProof.sha256
      && pass6RunnerProofAfter.bytes === pass6RunnerProof.bytes,
    `Pass 6 runner drifted during QA: ${
      JSON.stringify({
        before: pass6RunnerProof,
        after: pass6RunnerProofAfter,
      })
    }.`,
  );

  const report = {
    status: "ok",
    qualification:
      "builder evidence only; no AAA/WOW or independent-jury claim",
    url: url.toString(),
    pass6Runner: pass6RunnerProof,
    pass6RunnerAfter: pass6RunnerProofAfter,
    pass6BaselineArtifact: pass6BaselineArtifactProof,
    pass6BaselineArtifactAfter: pass6BaselineArtifactProofAfter,
    sourceFingerprintBefore,
    sourceFingerprintAfter,
    staticBuild: staticBuildProof,
    pause: pauseProof,
    initial: initialProof,
    frames,
    lifecycle: {
      seated: seatedLifecycle,
      firstCustody: firstCustodyLifecycle,
      completion: completionProof,
    },
    performance: performanceProof,
    disposal: disposalProof,
    staticSource: staticSourceProof,
    consoleFailures,
    requestFailures,
  };
  const reportPath = `${OUTPUT_DIRECTORY}/uplink-pass7-report.json`;
  const reportData = `${JSON.stringify(report, null, 2)}\n`;
  const sourceHashesPath =
    `${OUTPUT_DIRECTORY}/uplink-pass7-source-hashes.json`;
  const sourceHashesData = `${JSON.stringify({
    pass6Runner: pass6RunnerProof,
    pass6RunnerAfter: pass6RunnerProofAfter,
    pass6BaselineArtifact: pass6BaselineArtifactProof,
    pass6BaselineArtifactAfter: pass6BaselineArtifactProofAfter,
    before: sourceFingerprintBefore,
    after: sourceFingerprintAfter,
    staticBuild: staticBuildProof,
  }, null, 2)}\n`;
  await writeFile(reportPath, reportData);
  await writeFile(sourceHashesPath, sourceHashesData);

  const manifestPath =
    `${OUTPUT_DIRECTORY}/uplink-pass7-artifact-manifest.json`;
  const manifest = {
    schema: "cinderline-uplink-pass7-artifact-manifest",
    version: 1,
    qualification: report.qualification,
    sourceDigest: sourceFingerprintAfter.digest,
    pass6RunnerPreserved:
      pass6RunnerProof.preserved && pass6RunnerProofAfter.preserved,
    sourceDriftFree:
      sourceFingerprintAfter.digest === sourceFingerprintBefore.digest,
    staticBuildDigest: staticBuildProof.digest ?? null,
    artifacts: [
      {
        role: "qa-report",
        path: reportPath,
        bytes: Buffer.byteLength(reportData),
        sha256: sha256(reportData),
      },
      {
        role: "source-and-build-hash-ledger",
        path: sourceHashesPath,
        bytes: Buffer.byteLength(sourceHashesData),
        sha256: sha256(sourceHashesData),
      },
      ...Object.entries(frames)
        .filter(([, frame]) => frame.path !== null)
        .map(([name, frame]) => ({
        role: `native-${name}-frame`,
        path: frame.path,
        bytes: frame.bytes,
        sha256: frame.sha256,
        dimensions: frame.dimensions,
        deterministicRepeatSha256: frame.deterministicRepeatSha256,
        })),
    ],
    staticBuildFiles: staticBuildProof.files,
  };
  const manifestData = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(manifestPath, manifestData);

  let sealPath = null;
  let sealData = null;
  if (WRITE_BUILDER_SEAL) {
    sealPath = `${OUTPUT_DIRECTORY}/uplink-pass7-seal.json`;
    const seal = {
      schema: "cinderline-uplink-pass7-builder-evidence-seal",
      version: 1,
      status: "sealed-builder-evidence",
      selfApproved: false,
      qualification: report.qualification,
      report: {
        path: reportPath,
        bytes: Buffer.byteLength(reportData),
        sha256: sha256(reportData),
      },
      sourceHashes: {
        path: sourceHashesPath,
        bytes: Buffer.byteLength(sourceHashesData),
        sha256: sha256(sourceHashesData),
      },
      artifactManifest: {
        path: manifestPath,
        bytes: Buffer.byteLength(manifestData),
        sha256: sha256(manifestData),
      },
      sourceDigestBefore: sourceFingerprintBefore.digest,
      sourceDigestAfter: sourceFingerprintAfter.digest,
      sourceDriftFree:
        sourceFingerprintAfter.digest === sourceFingerprintBefore.digest,
      staticBuildDigest: staticBuildProof.digest ?? null,
      pass6Runner: pass6RunnerProof,
      pass6RunnerAfter: pass6RunnerProofAfter,
    };
    sealData = `${JSON.stringify(seal, null, 2)}\n`;
    await writeFile(sealPath, sealData);
  }

  console.log(JSON.stringify({
    status: "ok",
    qualification: report.qualification,
    report: reportPath,
    reportSha256: sha256(reportData),
    artifactManifest: manifestPath,
    artifactManifestSha256: sha256(manifestData),
    seal: sealPath,
    sealSha256: sealData === null ? null : sha256(sealData),
    sourceDigest: sourceFingerprintAfter.digest,
    pass6RunnerPreserved:
      pass6RunnerProof.preserved && pass6RunnerProofAfter.preserved,
    staticBuildDigest: staticBuildProof.digest ?? null,
    paidActors: paidLedger.length,
    paidCost: paidLedger.reduce(
      (total, { provenance }) => total + provenance.paidCost,
      0,
    ),
    custodyCount: completionProof.custodyCount,
    finalSourceInventory: completionProof.sourceInventoryCount,
    finalSourceBeltItems: completionProof.sourceBeltItems,
    frames: Object.fromEntries(
      Object.entries(frames).map(([name, value]) => [
        name,
        {
          sha256: value.sha256,
          dimensions: value.dimensions,
          bytes: value.bytes,
        },
      ]),
    ),
    averagePerformanceFrameMs: performanceProof.low.averageMs,
    p95PerformanceFrameMs: performanceProof.low.p95Ms,
    highAveragePerformanceFrameMs: performanceProof.high.averageMs,
    highP95PerformanceFrameMs: performanceProof.high.p95Ms,
    disposal: disposalProof.removed,
  }, null, 2));
} finally {
  await browser.close();
}
