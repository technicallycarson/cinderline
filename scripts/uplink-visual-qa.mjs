import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { relative, resolve } from "node:path";
import { chromium } from "playwright";

const BASE_URL =
  process.env.CINDERLINE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIRECTORY =
  process.env.CINDERLINE_UPLINK_OUTPUT ?? ".qa/uplink-pass6/final";
const STATIC_BUILD_DIRECTORY =
  process.env.CINDERLINE_STATIC_BUILD
  ?? ".qa/uplink-pass6/static-build";
const REQUIRE_STATIC_BUILD =
  process.env.CINDERLINE_REQUIRE_STATIC === "1";
const VIEWPORT = { width: 1920, height: 1080 };
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
      if (source.endsWith("/src/main.ts") || source.endsWith("src/main.ts")) {
        sourcemapSources["src/main.ts"] = sha256(content);
      }
      if (
        source.endsWith("/src/render/WorldRenderer.ts")
        || source.endsWith("src/render/WorldRenderer.ts")
      ) {
        sourcemapSources["src/render/WorldRenderer.ts"] = sha256(content);
      }
    }
  }
  const fileByPath = new Map(
    sourceFingerprint.files.map((entry) => [entry.path, entry]),
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
  url.searchParams.set("fresh", `uplink-pass6-${Date.now()}`);
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
    document.querySelector("#boot")?.remove();
    game.dismissToasts();
    for (const selector of [
      "[data-ref='pause-plate']",
      "[data-ref='toast-stack']",
    ]) {
      const element = document.querySelector(selector);
      if (element instanceof HTMLElement) element.style.display = "none";
    }
    const rig = renderer.entityObjects.get(uplinkId);
    if (!rig) throw new Error("Commission Uplink rig missing.");
    renderer.setSelected(null);
    renderer.focus(20.4, 14.85);
    renderer.viewWidth = 20.8;
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
    const sourceInserter = game.simulation.getEntity(13);
    const inFlightInserterCount = sourceInserter?.heldItem ? 1 : 0;
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
    const cassette = named(
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
        inFlightInserterCount,
        totalCargo:
          inventoryCount(source?.inventory)
          + sourceBelts.reduce(
            (total, belt) => total + belt.beltItems.length,
            0,
          )
          + inFlightInserterCount,
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
        acknowledgementLatchPresent:
          rig.parts.uplinkAcknowledgementLatch !== undefined,
        shutterCount:
          rig.parts.uplinkTransmissionShutters?.length ?? 0,
        cassetteBounds: cassette?.userData.bounds ?? null,
        cassetteLoadedOnly: cassette?.userData.loadedOnly ?? null,
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
        renderInfo: JSON.parse(
          JSON.stringify(renderer.renderer.info.render),
        ),
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
    "commission-uplink-canonical-dock-landing-guide",
    "commission-uplink-canonical-dock-inbound-direction-chevrons",
    "commission-uplink-canonical-dock-contained-point-light",
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
      && initialProof.renderer.acknowledgementLatchPresent
      && initialProof.renderer.shutterCount === 3
      && initialProof.renderer.cassetteLoadedOnly
      && initialProof.renderer.cassetteBounds.width === 0.84
      && initialProof.renderer.cassetteBounds.depth === 0.52
      && initialProof.renderer.authoredArmor.asset
        === "/assets/cinder-painted-steel-aged-v2.png"
      && Boolean(initialProof.renderer.authoredArmor.assetHash)
      && Boolean(initialProof.renderer.authoredArmor.normalMap)
      && Boolean(initialProof.renderer.authoredArmor.roughnessMap)
      && Boolean(initialProof.renderer.authoredArmor.aoMap),
    `Pass 6 structure/material proof is false: ${
      JSON.stringify(initialProof.renderer)
    }.`,
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
          let current = object;
          while (current) {
            if (!current.visible) return false;
            if (current === rig.root) return true;
            current = current.parent;
          }
          return false;
        };
        const relayRig = renderer.entityObjects.get(23);
        return {
          elapsed,
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
    const proof = await renderFrame();
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
        `${OUTPUT_DIRECTORY}/uplink-pass6-${name}-determinism-a.png`,
        first,
      );
      await writeFile(
        `${OUTPUT_DIRECTORY}/uplink-pass6-${name}-determinism-b.png`,
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
    const path = `${OUTPUT_DIRECTORY}/uplink-pass6-${name}.png`;
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
    focus: [20.4, 14.85],
    viewWidth: 20.8,
    elapsed: 8,
  });
  await captureDeterministicFrame("empty", {
    focus: [22.75, 11.15],
    viewWidth: 11.2,
    elapsed: 8,
  });
  assert(
    frames.empty.proof.payloadVisible === false
      && frames.empty.proof.carrierOccupied === false
      && frames.empty.proof.chamberState === "open-empty-ready"
      && frames.empty.proof.visiblePayloadKinds.length === 0,
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
    focus: [22.75, 11.15],
    viewWidth: 11.2,
    elapsed: 8,
  });
  assert(
    frames.seated.proof.payloadVisible
      && frames.seated.proof.carrierOccupied
      && frames.seated.proof.visiblePayloadKinds.join("|") === "ironPlate"
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
      && completionProof.carriageState === "accepting-at-belt-interface",
    `49-custody/final-zero proof is false: ${
      JSON.stringify(completionProof)
    }.`,
  );

  await captureDeterministicFrame("transmit", {
    focus: [22.35, 11.75],
    viewWidth: 13.2,
    elapsed: 0,
    cycle: 0.45,
  });
  await captureDeterministicFrame("ack", {
    focus: [22.35, 11.75],
    viewWidth: 13.2,
    elapsed: 0,
    cycle: 0.78,
  });
  assert(
    frames.transmit.proof.phase === "packets-in-transit"
      && frames.transmit.proof.relayState === "packets-in-transit"
      && frames.transmit.proof.relaySource === 11
      && frames.transmit.proof.shutters[1].active
      && frames.transmit.proof.manifestReady
      && frames.transmit.proof.securedCustodyCount === 49
      && frames.ack.proof.phase === "relay-acknowledged"
      && frames.ack.proof.relayState === "relay-acknowledged"
      && frames.ack.proof.relaySource === 11
      && frames.ack.proof.shutters[2].active
      && frames.ack.proof.latchState
        === "physically-engaged-persistent-relay-acknowledged"
      && frames.ack.proof.latchRotation < -0.9,
    `Transmit/ACK physical-state proof is false: ${
      JSON.stringify({
        transmit: frames.transmit.proof,
        ack: frames.ack.proof,
      })
    }.`,
  );

  const performanceProof = await page.evaluate(() => {
    const game = window.__CINDERLINE__;
    const renderer = game.renderer;
    const uplinkId = game.uplinkEntityId;
    if (renderer.quality !== "high") renderer.toggleQuality();
    let rig = renderer.entityObjects.get(uplinkId);
    renderer.setSelected(uplinkId);
    renderer.focus(22.35, 11.75);
    renderer.viewWidth = 13.2;
    renderer.resize();
    const elapsed = 42 + 0.45 * 4.2 - rig.phaseOffset * 0.41;
    renderer.update(0, elapsed);
    renderer.render(0);
    renderer.renderer.getContext().finish();
    const high = {
      quality: renderer.quality,
      render: JSON.parse(JSON.stringify(renderer.renderer.info.render)),
      memory: JSON.parse(JSON.stringify(renderer.renderer.info.memory)),
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
    renderer.focus(22.35, 11.75);
    renderer.viewWidth = 13.2;
    renderer.resize();
    renderer.update(0, elapsed);
    renderer.render(0);
    renderer.renderer.getContext().finish();
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
    const started = performance.now();
    const sampleCount = 30;
    for (let index = 0; index < sampleCount; index += 1) {
      renderer.update(1 / 60, elapsed + index / 60);
      renderer.render(1 / 60);
    }
    renderer.renderer.getContext().finish();
    const totalMs = performance.now() - started;
    const low = {
      quality: renderer.quality,
      variant: rig.variant,
      selectedIndicatorCount:
        rig.parts.uplinkSelectionIndicators?.length ?? 0,
      picked,
      sampleCount,
      totalMs,
      averageMs: totalMs / sampleCount,
      render: JSON.parse(JSON.stringify(renderer.renderer.info.render)),
      memory: JSON.parse(JSON.stringify(renderer.renderer.info.memory)),
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
    renderer.renderer.getContext().finish();
    return {
      high,
      low,
      restoredQuality: renderer.quality,
      restoredVariant: rig.variant,
    };
  });
  assert(
    performanceProof.high.quality === "high"
      && performanceProof.high.reflectorSegments === 24
      && performanceProof.high.railRollers === 2
      && performanceProof.high.rackTeeth === 5
      && performanceProof.low.quality === "performance"
      && performanceProof.low.variant === "uplink"
      && performanceProof.low.reflectorSegments === 18
      && performanceProof.low.railRollers === 1
      && performanceProof.low.rackTeeth === 4
      && performanceProof.low.selectedIndicatorCount >= 1
      && performanceProof.low.picked === 11
      && performanceProof.low.averageMs < 100
      && performanceProof.low.render.calls > 0
      && performanceProof.low.render.triangles > 0
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
  assert(
    sourceFingerprintAfter.digest === sourceFingerprintBefore.digest,
    `Source/dependency drifted during QA: ${
      JSON.stringify({
        before: sourceFingerprintBefore.digest,
        after: sourceFingerprintAfter.digest,
      })
    }.`,
  );

  const report = {
    status: "ok",
    qualification:
      "builder evidence only; no AAA/WOW or independent-jury claim",
    url: url.toString(),
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
  const reportPath = `${OUTPUT_DIRECTORY}/uplink-pass6-report.json`;
  const reportData = `${JSON.stringify(report, null, 2)}\n`;
  const sourceHashesPath =
    `${OUTPUT_DIRECTORY}/uplink-pass6-source-hashes.json`;
  const sourceHashesData = `${JSON.stringify({
    before: sourceFingerprintBefore,
    after: sourceFingerprintAfter,
    staticBuild: staticBuildProof,
  }, null, 2)}\n`;
  await writeFile(reportPath, reportData);
  await writeFile(sourceHashesPath, sourceHashesData);

  const manifestPath =
    `${OUTPUT_DIRECTORY}/uplink-pass6-artifact-manifest.json`;
  const manifest = {
    schema: "cinderline-uplink-pass6-artifact-manifest",
    version: 1,
    qualification: report.qualification,
    sourceDigest: sourceFingerprintAfter.digest,
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
      ...Object.entries(frames).map(([name, frame]) => ({
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

  const sealPath = `${OUTPUT_DIRECTORY}/uplink-pass6-seal.json`;
  const seal = {
    schema: "cinderline-uplink-pass6-builder-evidence-seal",
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
  };
  const sealData = `${JSON.stringify(seal, null, 2)}\n`;
  await writeFile(sealPath, sealData);

  console.log(JSON.stringify({
    status: "ok",
    qualification: report.qualification,
    report: reportPath,
    reportSha256: sha256(reportData),
    artifactManifest: manifestPath,
    artifactManifestSha256: sha256(manifestData),
    seal: sealPath,
    sealSha256: sha256(sealData),
    sourceDigest: sourceFingerprintAfter.digest,
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
    disposal: disposalProof.removed,
  }, null, 2));
} finally {
  await browser.close();
}
