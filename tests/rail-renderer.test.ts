import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  createRailGraph,
  findRailPath,
  RailNetwork,
  type RailNetworkInput,
  type RailNetworkSnapshot,
  type RailSegmentInput,
} from "../src/game/rail-network";
import { FactorySimulation } from "../src/game/simulation";
import { Direction, type RailStationStorageInterface } from "../src/game/types";
import {
  RailRenderer,
  RailRendererIntegrationAdapter,
} from "../src/render/RailRenderer";

function horizontalLine(
  startX: number,
  endX: number,
  y: number,
  prefix = "rail",
): RailSegmentInput[] {
  return Array.from({ length: endX - startX + 1 }, (_, offset) => ({
    id: `${prefix}-${offset}`,
    x: startX + offset,
    y,
    kind: "straight" as const,
    rotation: 1 as const,
  }));
}

function realCargoFixture(): {
  readonly simulation: FactorySimulation;
  readonly mineStorageId: number;
  readonly foundryStorageId: number;
} {
  const simulation = new FactorySimulation({
    width: 20,
    height: 12,
    seed: 0x7a11,
    generateTerrain: false,
    generateResources: false,
    powerMode: "legacyGlobal",
  });
  const mine = simulation.place("storage", 1, 3, Direction.East);
  const foundry = simulation.place("storage", 11, 3, Direction.West);
  if (!mine.ok || !foundry.ok) {
    throw new Error("Unable to place rail fixture storage.");
  }
  const interfaces: RailStationStorageInterface[] = [
    {
      stationId: "mine",
      storageEntityId: mine.entity.id,
      mode: "load",
      transferRate: 2,
      itemFilter: ["ironOre"],
    },
    {
      stationId: "foundry",
      storageEntityId: foundry.entity.id,
      mode: "unload",
      transferRate: 2,
      itemFilter: ["ironOre"],
    },
  ];
  const network: RailNetworkInput = {
    segments: horizontalLine(1, 12, 2),
    signals: [
      {
        id: "mine-exit",
        fromSegmentId: "rail-2",
        toSegmentId: "rail-3",
        type: "regular",
      },
      {
        id: "main-chain",
        fromSegmentId: "rail-6",
        toSegmentId: "rail-7",
        type: "chain",
      },
      {
        id: "foundry-entry",
        fromSegmentId: "rail-9",
        toSegmentId: "rail-10",
        type: "regular",
      },
    ],
    stations: [
      { id: "mine", segmentId: "rail-0", capacity: 0 },
      { id: "foundry", segmentId: "rail-11", capacity: 0 },
    ],
    trains: [
      {
        id: "ore-shuttle",
        currentSegmentId: "rail-0",
        cars: [
          {
            id: "ore-locomotive",
            kind: "locomotive",
            fuelCapacityMilli: 200_000,
            fuelMilli: 100_000,
          },
          {
            id: "ore-wagon",
            kind: "cargo-wagon",
            capacity: 12,
          },
        ],
        schedule: [
          { stationId: "mine", wait: { type: "cargo-full" } },
          { stationId: "foundry", wait: { type: "cargo-empty" } },
        ],
      },
    ],
  };
  simulation.receive(mine.entity.id, "ironOre", 20);
  expect(
    simulation.configureRailNetwork({
      network,
      stationInterfaces: interfaces,
    }),
  ).toEqual({ ok: true });
  simulation.drainEvents();
  return {
    simulation,
    mineStorageId: mine.entity.id,
    foundryStorageId: foundry.entity.id,
  };
}

function frame(simulation: FactorySimulation) {
  const snapshot = simulation.getRenderSnapshot();
  return {
    elapsedSeconds: snapshot.elapsedSeconds,
    rail: snapshot.rail,
  };
}

function pass10ConnectedYardSegments(): RailSegmentInput[] {
  const main = Array.from({ length: 26 }, (_, x) => ({
    id: `main-${String(x).padStart(2, "0")}`,
    x,
    y: 4,
    kind: x === 8 || x === 20 ? ("junction" as const) : ("straight" as const),
    rotation: x === 8 || x === 20 ? (0 as const) : (1 as const),
  }));
  const siding: RailSegmentInput[] = [
    {
      id: "siding-west-curve",
      x: 8,
      y: 3,
      kind: "curve",
      rotation: 1,
    },
    ...Array.from({ length: 11 }, (_, offset) => ({
      id: `siding-${String(offset + 9).padStart(2, "0")}`,
      x: offset + 9,
      y: 3,
      kind: "straight" as const,
      rotation: 1 as const,
    })),
    {
      id: "siding-east-curve",
      x: 20,
      y: 3,
      kind: "curve",
      rotation: 2,
    },
  ];
  return [...main, ...siding];
}

function visualTopologyNetwork(): RailNetwork {
  return new RailNetwork({
    segments: pass10ConnectedYardSegments(),
    signals: [
      {
        id: "regular-boundary",
        fromSegmentId: "main-07",
        toSegmentId: "main-08",
        type: "regular",
      },
      {
        id: "chain-boundary",
        fromSegmentId: "main-08",
        toSegmentId: "main-09",
        type: "chain",
      },
    ],
    stations: [
      { id: "origin", segmentId: "main-04", capacity: 0 },
      { id: "destination", segmentId: "main-22", capacity: 0 },
    ],
  });
}

function pass11CampaignPresentationNetwork(
  route: "district" | "west-turnout-reversal" = "district",
): RailNetwork {
  const mainId = (x: number) => `campaign-main-${String(x).padStart(2, "0")}`;
  const westJunctionX = 13;
  const eastJunctionX = 24;
  const reversalRoute = route === "west-turnout-reversal";
  return new RailNetwork({
    segments: [
      ...Array.from({ length: 25 }, (_, offset) => {
        const x = offset + 8;
        return {
          id: mainId(x),
          x,
          y: 16,
          kind:
            x === westJunctionX || x === eastJunctionX
              ? ("junction" as const)
              : ("straight" as const),
          rotation:
            x === westJunctionX || x === eastJunctionX
              ? (2 as const)
              : (1 as const),
        };
      }),
      {
        id: "campaign-siding-west-curve",
        x: westJunctionX,
        y: 17,
        kind: "curve" as const,
        rotation: 0 as const,
      },
      ...Array.from(
        { length: eastJunctionX - westJunctionX - 1 },
        (_, offset) => ({
          id: `campaign-siding-${String(westJunctionX + 1 + offset).padStart(
            2,
            "0",
          )}`,
          x: westJunctionX + 1 + offset,
          y: 17,
          kind: "straight" as const,
          rotation: 1 as const,
        }),
      ),
      {
        id: "campaign-siding-east-curve",
        x: eastJunctionX,
        y: 17,
        kind: "curve" as const,
        rotation: 3 as const,
      },
    ],
    signals: [],
    stations: reversalRoute
      ? [
          {
            id: "campaign-live-west-origin",
            segmentId: mainId(8),
            capacity: 0,
          },
          {
            id: "campaign-live-branch-destination",
            segmentId: "campaign-siding-17",
            capacity: 0,
          },
        ]
      : [
          {
            id: "campaign-central-service",
            segmentId: mainId(20),
            capacity: 0,
          },
          {
            id: "campaign-east-service",
            segmentId: mainId(29),
            capacity: 0,
          },
        ],
    trains: [
      {
        id: "campaign-ore-runner",
        currentSegmentId: mainId(20),
        cars: [
          {
            id: "campaign-locomotive",
            kind: "locomotive",
            fuelCapacityMilli: 240_000,
            fuelMilli: 180_000,
          },
          {
            id: "campaign-wagon-a",
            kind: "cargo-wagon",
            capacity: 6,
          },
          {
            id: "campaign-wagon-b",
            kind: "cargo-wagon",
            capacity: 6,
          },
        ],
        schedule: reversalRoute
          ? [
              {
                stationId: "campaign-live-west-origin",
                wait: { type: "time", ticks: 1 },
              },
              {
                stationId: "campaign-live-branch-destination",
                wait: { type: "time", ticks: 600 },
              },
            ]
          : [
              {
                stationId: "campaign-central-service",
                wait: { type: "time", ticks: 180 },
              },
              {
                stationId: "campaign-east-service",
                wait: { type: "time", ticks: 180 },
              },
            ],
      },
    ],
  });
}

function reversedSnapshot(snapshot: RailNetworkSnapshot): RailNetworkSnapshot {
  return {
    ...snapshot,
    graph: {
      nodes: [...snapshot.graph.nodes].reverse(),
      edges: [...snapshot.graph.edges].reverse(),
      blocks: [...snapshot.graph.blocks].reverse().map((block) => ({
        ...block,
        segmentIds: [...block.segmentIds].reverse(),
      })),
    },
    signals: [...snapshot.signals].reverse(),
    stations: [...snapshot.stations].reverse(),
    trains: [...snapshot.trains].reverse(),
    reservations: [...snapshot.reservations].reverse(),
  };
}

describe("RailRenderer", () => {
  it("renders a real v8 custody loop with truthful cargo, fuel, schedules, block state, picking, and motion", () => {
    const fixture = realCargoFixture();
    fixture.simulation.step(3);
    const loading = fixture.simulation.railSnapshot()!;
    expect(loading.trains[0]?.cargoUnits).toBe(6);
    expect(loading.trains[0]?.status).toBe("dwelling");
    expect(
      loading.stations.reduce((sum, station) => sum + station.storedUnits, 0),
    ).toBe(0);

    const parent = new THREE.Group();
    const renderer = new RailRenderer(parent);
    renderer.sync(frame(fixture.simulation));
    const loadingDebug = renderer.getDebug();
    expect(parent.getObjectByName("rail-world-system")).toBe(renderer.root);
    expect(loadingDebug).toMatchObject({
      disposed: false,
      segments: 12,
      renderedSegments: 12,
      omittedSegments: 0,
      signals: 3,
      regularSignals: 2,
      chainSignals: 1,
      stations: 2,
      detailedStations: 2,
      activeStations: 1,
      trains: 1,
      detailedTrains: 1,
      detailedCars: 2,
      overviewCars: 0,
      omittedCars: 0,
      locomotives: 1,
      cargoWagons: 1,
      cargoUnits: 6,
      occupancyModel: "exclusive-block-atomic-consist",
    });
    expect(loadingDebug.occupiedBlocks).toBe(1);
    expect(loadingDebug.routeSegments).toBe(1);
    expect(loadingDebug.drawBatches).toBeLessThan(280);
    expect(loadingDebug.triangles).toBeGreaterThan(10_000);

    for (const name of [
      "rail-track-straight-ballast",
      "rail-track-straight-ballast-detail",
      "rail-track-straight-sleepers",
      "rail-track-straight-running-surfaces",
      "rail-signal-regular-head",
      "rail-signal-chain-head",
      "rail-station-independent-load-chain",
      "rail-station-independent-unload-chain",
      "rail-station-unload-gantry",
      "rail-station-drainage-grating",
      "rail-station-load-infeed-conveyor-frame",
      "rail-station-load-metered-aggregate-bed",
      "rail-station-telescoping-load-chute",
      "rail-station-load-chute-cantilever",
      "rail-station-load-nozzle",
      "rail-station-load-metered-ore-stream",
      "rail-station-load-sloped-chute-bed",
      "rail-station-load-sloped-chute-ore",
      "rail-station-load-source-bin",
      "rail-station-load-source-bin-ore",
      "rail-station-unload-receiving-hopper",
      "rail-station-overhead-unloader",
      "rail-station-unloader-grab",
      "rail-station-fuel-service-arm",
      "rail-station-lived-in-district-ground",
      "rail-station-lived-in-workshop-silos",
      "rail-station-lived-in-crates-drums-and-tools",
      "rail-station-cinder-readable-name",
      "rail-locomotive-engine-armor",
      "rail-flanged-wheel",
      "rail-wheel-inner-flange-ring",
      "rail-bogie-through-axle",
      "rail-locomotive-visible-side-rod",
      "rail-cargo-wagon-sliding-service-hatch",
      "rail-cargo-wagon-keyed-service-port",
      "rail-authoritative-wagon-cargo",
      "rail-locomotive-authoritative-fuel-gauge",
      "rail-train-schedule-route-drum",
    ]) {
      expect(parent.getObjectByName(name), name).toBeDefined();
    }

    const cargo = parent.getObjectByName(
      "rail-authoritative-wagon-cargo",
    ) as THREE.Mesh;
    expect(cargo.visible).toBe(true);
    expect(cargo.userData).toMatchObject({
      itemId: "ironOre",
      stored: 6,
      capacity: 12,
      fillRatio: 0.5,
    });
    cargo.geometry.computeBoundingBox();
    const cargoBounds = cargo.geometry.boundingBox!;
    expect(cargoBounds.max.x - cargoBounds.min.x).toBeLessThan(1);
    expect(cargoBounds.max.z - cargoBounds.min.z).toBeLessThan(0.45);
    const fuel = parent.getObjectByName(
      "rail-locomotive-authoritative-fuel-gauge",
    ) as THREE.Mesh;
    expect(fuel.userData.fuelMilli).toBeGreaterThan(0);
    const activeStation = parent
      .getObjectsByProperty("name", "rail-station-rig")
      .find((station) => station.userData.activeTrainId);
    expect(activeStation?.userData).toMatchObject({
      stationOwnsCargo: false,
      serviceMode: "load",
      visualTransferPath:
        "source-bin>metered-conveyor>cantilever>telescoping-nozzle>open-wagon",
      independentlyRootedChains: true,
    });
    const aggregateBed = parent.getObjectByName(
      "rail-station-load-metered-aggregate-bed",
    ) as THREE.Mesh;
    expect(
      aggregateBed.geometry.boundingBox!.max.x -
        aggregateBed.geometry.boundingBox!.min.x,
    ).toBeGreaterThan(2.8);
    const sourceBin = parent.getObjectByName(
      "rail-station-load-source-bin",
    ) as THREE.Mesh;
    expect(
      sourceBin.geometry.boundingBox!.max.y -
        sourceBin.geometry.boundingBox!.min.y,
    ).toBeGreaterThan(0.4);
    renderer.root.updateMatrixWorld(true);
    const activeLoadChute = activeStation?.getObjectByName(
      "rail-station-telescoping-load-chute",
    );
    expect(activeLoadChute?.userData).toMatchObject({
      serviceMode: "load",
      destination: expect.stringContaining("open-wagon-bay"),
      contactHeight: expect.any(Number),
    });
    expect(activeLoadChute!.userData.contactHeight).toBeGreaterThan(0.94);
    const loadNozzle = activeLoadChute!.getObjectByName(
      "rail-station-load-nozzle",
    )!;
    const loadNozzleWorld = loadNozzle.getWorldPosition(new THREE.Vector3());
    expect(Math.abs(loadNozzleWorld.z - 2.5)).toBeLessThan(0.08);
    expect(
      parent.getObjectsByProperty("name", "rail-flanged-wheel"),
    ).toHaveLength(16);
    expect(renderer.resolvePick(cargo)).toEqual({
      kind: "train",
      trainId: "ore-shuttle",
      carId: "ore-wagon",
    });
    const track = parent.getObjectByName(
      "rail-track-straight-ballast",
    ) as THREE.InstancedMesh;
    expect(renderer.resolvePick(track, 0)).toMatchObject({
      kind: "segment",
    });

    const topologySignature = loadingDebug.topologySignature;
    fixture.simulation.step(24);
    const trainBeforeSync = parent
      .getObjectByName("rail-train-rig")!
      .position.clone();
    renderer.sync(frame(fixture.simulation));
    const train = parent.getObjectByName("rail-train-rig")!;
    const authoritativePosition = train.position.clone();
    expect(renderer.getDebug().topologySignature).toBe(topologySignature);
    expect(renderer.getDebug().stateSignature).not.toBe(
      loadingDebug.stateSignature,
    );
    expect(authoritativePosition.distanceTo(trainBeforeSync)).toBeGreaterThan(
      0.01,
    );
    const wheel = parent.getObjectByName("rail-flanged-wheel")!;
    const wheelBefore = wheel.rotation.z;
    const elapsed = fixture.simulation.getRenderSnapshot().elapsedSeconds;
    renderer.update(elapsed + 1 / 120);
    expect(wheel.rotation.z).not.toBe(wheelBefore);
    expect(train.position.distanceTo(authoritativePosition)).toBeGreaterThan(0);
    expect(train.userData).toMatchObject({
      currentBlockId: expect.any(String),
      occupancyModel: "exclusive-block-atomic-consist",
      schedule: [
        {
          stationId: "mine",
          wait: { type: "cargo-full" },
        },
        {
          stationId: "foundry",
          wait: { type: "cargo-empty" },
        },
      ],
    });
  });

  it("authors distinct curves, junction hardware, regular and chain signals with order-stable signatures", () => {
    const topologySegments = pass10ConnectedYardSegments();
    const graph = createRailGraph(topologySegments);
    const mainPath = Array.from(
      { length: 13 },
      (_, offset) => `main-${String(offset + 8).padStart(2, "0")}`,
    );
    const sidingPath = [
      "main-08",
      "siding-west-curve",
      ...Array.from(
        { length: 11 },
        (_, offset) => `siding-${String(offset + 9).padStart(2, "0")}`,
      ),
      "siding-east-curve",
      "main-20",
    ];
    const routeCost = (path: readonly string[]): number =>
      path.slice(1).reduce((sum, segmentId, index) => {
        const edge = graph.edges.find(
          ({ fromSegmentId, toSegmentId }) =>
            fromSegmentId === path[index] && toSegmentId === segmentId,
        );
        expect(
          edge,
          `missing reciprocal topology edge ${path[index]} -> ${segmentId}`,
        ).toBeDefined();
        return sum + edge!.costMilli;
      }, 0);
    expect(findRailPath(graph, "main-08", "main-20")).toEqual(mainPath);
    expect(routeCost(mainPath)).toBeLessThan(routeCost(sidingPath));
    expect(
      graph.nodes.find(({ segmentId }) => segmentId === "main-08")?.ports,
    ).toEqual(["north", "east", "west"]);
    expect(
      graph.nodes.find(({ segmentId }) => segmentId === "siding-west-curve")
        ?.ports,
    ).toEqual(["east", "south"]);
    expect(
      graph.nodes.find(({ segmentId }) => segmentId === "siding-east-curve")
        ?.ports,
    ).toEqual(["south", "west"]);

    const snapshot = visualTopologyNetwork().snapshot();
    const parent = new THREE.Group();
    const renderer = new RailRenderer(parent);
    renderer.sync({ elapsedSeconds: 1, rail: snapshot });
    const first = renderer.getDebug();
    expect(first).toMatchObject({
      segments: 39,
      straightSegments: 35,
      curvedSegments: 2,
      junctionSegments: 2,
      signals: 2,
      regularSignals: 1,
      chainSignals: 1,
    });
    for (const name of [
      "rail-track-curve-ballast",
      "rail-track-curve-ballast-detail",
      "rail-track-curve-rails",
      "rail-track-junction-rails",
      "rail-track-junction-ballast-detail",
      "rail-track-junction-switch-hardware",
      "rail-track-junction-blades-and-guards",
      "rail-signal-regular-head",
      "rail-signal-chain-head",
    ]) {
      const mesh = parent.getObjectByName(name) as THREE.InstancedMesh;
      expect(mesh, name).toBeDefined();
      expect(mesh.count, name).toBeGreaterThan(0);
      expect(mesh.geometry.boundingBox, name).not.toBeNull();
    }
    const junctionBallast = parent.getObjectByName(
      "rail-track-junction-ballast",
    ) as THREE.InstancedMesh;
    const junctionBallastBounds = junctionBallast.geometry.boundingBox!;
    expect(junctionBallastBounds.max.x).toBeLessThanOrEqual(0.56);
    expect(junctionBallastBounds.min.x).toBeGreaterThanOrEqual(-0.56);
    expect(junctionBallastBounds.max.z).toBeLessThanOrEqual(0.56);
    expect(junctionBallastBounds.min.z).toBeGreaterThanOrEqual(-0.56);
    expect((junctionBallast.material as THREE.Material).name).toBe(
      "rail-turnout-continuous-graded-ballast-bed",
    );
    const junctionSleepers = parent.getObjectByName(
      "rail-track-junction-sleepers",
    ) as THREE.InstancedMesh;
    expect((junctionSleepers.material as THREE.Material).name).toBe(
      "rail-turnout-creosote-timber-dark",
    );
    const junctionSurfaces = parent.getObjectByName(
      "rail-track-junction-running-surfaces",
    ) as THREE.InstancedMesh;
    expect((junctionSurfaces.material as THREE.Material).name).toBe(
      "rail-turnout-weathered-running-surface",
    );
    const junctionHardware = parent.getObjectByName(
      "rail-track-junction-switch-hardware",
    ) as THREE.InstancedMesh;
    expect((junctionHardware.material as THREE.Material).name).toBe(
      "rail-switch-actuator-bronze",
    );
    expect(junctionHardware.geometry.name).toContain(
      "frog-throw-bar-and-linkage",
    );
    const pointMotor = parent.getObjectByName(
      "rail-track-junction-point-motor",
    ) as THREE.InstancedMesh;
    expect(pointMotor.count).toBe(2);
    expect(pointMotor.geometry.name).toContain("weatherproof-point-motor");
    expect(
      (
        parent.getObjectByName(
          "rail-track-junction-blades-and-guards",
        ) as THREE.InstancedMesh
      ).geometry.name,
    ).toContain("continuous-blades-frog-and-check-rails");
    const regular = parent.getObjectByName(
      "rail-signal-regular-head",
    ) as THREE.InstancedMesh;
    const chain = parent.getObjectByName(
      "rail-signal-chain-head",
    ) as THREE.InstancedMesh;
    expect(renderer.resolvePick(regular, 0)).toEqual({
      kind: "signal",
      signalId: "regular-boundary",
    });
    expect(renderer.resolvePick(chain, 0)).toEqual({
      kind: "signal",
      signalId: "chain-boundary",
    });

    renderer.sync({
      elapsedSeconds: 2,
      rail: reversedSnapshot(snapshot),
    });
    expect(renderer.getDebug().topologySignature).toBe(first.topologySignature);
    expect(renderer.getDebug().stateSignature).toBe(first.stateSignature);
  });

  it("enforces PASS11 engineered siding, mechanical consist, lived-in district, and causal timed-service contracts", () => {
    const parent = new THREE.Group();
    const renderer = new RailRenderer(parent);
    const network = pass11CampaignPresentationNetwork();
    renderer.sync({ elapsedSeconds: 0, rail: network.snapshot() });
    renderer.root.updateMatrixWorld(true);

    const westTurnout = parent.getObjectByName(
      "rail-track-integrated-west-turnout-running-surfaces",
    ) as THREE.InstancedMesh;
    const eastTurnout = parent.getObjectByName(
      "rail-track-integrated-east-turnout-running-surfaces",
    ) as THREE.InstancedMesh;
    const siding = parent.getObjectByName(
      "rail-track-integrated-bypass-running-surfaces",
    ) as THREE.InstancedMesh;
    expect(westTurnout.count).toBe(1);
    expect(eastTurnout.count).toBe(1);
    expect(siding.count).toBe(1);
    expect(westTurnout.userData.engineeredGeometry).toMatchObject({
      form: "single-eased-shallow-turnout",
      tangentRun: 8,
      sidingSeparation: 1.62,
      entranceTangent: 0,
      exitTangent: 0,
    });
    expect(siding.userData.engineeredGeometry).toMatchObject({
      form: "tangent-siding-between-eased-turnouts",
      usefulTangentLength: 4.5,
      sidingSeparation: 1.62,
    });
    const turnoutBounds = westTurnout.geometry.boundingBox!;
    expect(turnoutBounds.max.x - turnoutBounds.min.x).toBeGreaterThan(7.9);
    expect(turnoutBounds.max.z - turnoutBounds.min.z).toBeGreaterThan(1.9);
    const sidingBounds = siding.geometry.boundingBox!;
    expect(sidingBounds.max.x - sidingBounds.min.x).toBeGreaterThan(4.45);
    expect(
      parent.getObjectByName(
        "rail-track-integrated-west-turnout-blades-frog-check-rails",
      ),
    ).toBeDefined();
    expect(
      parent.getObjectByName(
        "rail-track-integrated-east-turnout-blades-frog-check-rails",
      ),
    ).toBeDefined();

    const districtGround = parent.getObjectByName(
      "rail-station-lived-in-district-ground",
    ) as THREE.Mesh;
    const districtBounds = districtGround.geometry.boundingBox!;
    expect(districtBounds.min.z).toBeLessThan(-4.65);
    expect(districtBounds.max.z).toBeGreaterThan(4.7);
    expect(districtGround.userData).toMatchObject({
      clearanceEnvelope:
        "loader foundations north of main gauge; public maintenance road beyond siding gauge",
      nearestTrackEdgeZ: -1.53,
      southernContextStartsZ: 2.52,
    });
    for (const name of [
      "rail-station-lived-in-district-steel",
      "rail-station-lived-in-workshop-silos",
      "rail-station-lived-in-safety-markings",
      "rail-station-lived-in-crates-drums-and-tools",
      "rail-station-lived-in-trackside-weeds",
      "rail-station-lived-in-work-lamps",
      "rail-station-cinder-readable-name",
      "rail-station-cinder-roof-stencil",
      "rail-station-live-mode-board",
    ]) {
      expect(parent.getObjectByName(name), name).toBeDefined();
    }

    const trainRoot = parent.getObjectByName("rail-train-rig")!;
    expect(trainRoot.position.y).toBeCloseTo(0.485, 6);
    expect(trainRoot.userData).toMatchObject({
      articulationModel: "distance-sampled-per-car-pose-history",
      bogieArticulationModel: "distance-sampled-independent-bogie-tangent",
      carSpacing: 2.56,
      wheelRailCenters: {
        rail: [-0.19, 0.19],
        wheelTread: [-0.19, 0.19],
      },
    });
    expect(
      parent.getObjectsByProperty("name", "rail-articulated-bogie-rig"),
    ).toHaveLength(6);
    expect(
      parent.getObjectsByProperty("name", "rail-bogie-frame"),
    ).toHaveLength(6);
    expect(
      parent.getObjectsByProperty("name", "rail-bogie-through-axle"),
    ).toHaveLength(12);
    expect(
      parent.getObjectsByProperty("name", "rail-flanged-wheel"),
    ).toHaveLength(24);
    expect(
      parent.getObjectsByProperty("name", "rail-wheel-inner-flange-ring"),
    ).toHaveLength(24);
    expect(
      parent.getObjectsByProperty("name", "rail-brake-arrival-cue"),
    ).toHaveLength(24);
    expect(
      parent.getObjectsByProperty("name", "rail-locomotive-visible-side-rod"),
    ).toHaveLength(2);
    const carRoots = trainRoot.children.filter(
      (child) =>
        child.name === "rail-locomotive-car" ||
        child.name === "rail-cargo-wagon-car",
    );
    expect(carRoots).toHaveLength(3);
    const carWorld = carRoots.map((car) =>
      car.getWorldPosition(new THREE.Vector3()),
    );
    expect(carWorld[0]!.distanceTo(carWorld[1]!)).toBeCloseTo(2.56, 4);
    expect(carWorld[1]!.distanceTo(carWorld[2]!)).toBeCloseTo(2.56, 4);
    const locomotiveRear = carRoots[0]!
      .getObjectByName("rail-rear-coupler")!
      .getWorldPosition(new THREE.Vector3());
    const firstWagonFront = carRoots[1]!
      .getObjectByName("rail-front-coupler")!
      .getWorldPosition(new THREE.Vector3());
    expect(locomotiveRear.distanceTo(firstWagonFront)).toBeGreaterThan(0.3);
    expect(locomotiveRear.distanceTo(firstWagonFront)).toBeLessThan(0.4);
    const locomotiveRearFace = carRoots[0]!
      .getObjectByName("rail-rear-coupler-knuckle-face")!
      .getWorldPosition(new THREE.Vector3());
    const firstWagonFrontFace = carRoots[1]!
      .getObjectByName("rail-front-coupler-knuckle-face")!
      .getWorldPosition(new THREE.Vector3());
    expect(locomotiveRearFace.distanceTo(firstWagonFrontFace)).toBeGreaterThan(
      0.02,
    );
    expect(locomotiveRearFace.distanceTo(firstWagonFrontFace)).toBeLessThan(
      0.06,
    );

    const activeStation = parent
      .getObjectsByProperty("name", "rail-station-rig")
      .find((station) => station.userData.activeTrainId)!;
    expect(activeStation.userData).toMatchObject({
      serviceMode: "service",
      visualTransferPath:
        "service-cartridge>keyed-wagon-port>diagnostic-return",
      heroWagonIndex: 0,
      concurrentActiveLoaders: 1,
    });
    const stageSamples = new Map<
      string,
      {
        extension: number;
        hatch: number;
        payloadVisible: boolean;
        payloadKind: string;
      }
    >();
    for (let index = 0; index <= 48; index += 1) {
      renderer.update(index / 48 / 0.62);
      const hero = activeStation
        .getObjectsByProperty("name", "rail-station-telescoping-load-chute")
        .find((chute) => chute.userData.heroLoader);
      if (!hero) continue;
      stageSamples.set(hero.userData.serviceStage, {
        extension: hero.userData.extensionRatio,
        hatch: hero.userData.hatchOpenRatio,
        payloadVisible: hero.userData.payloadVisible,
        payloadKind: hero.userData.payloadKind,
      });
    }
    expect(stageSamples.get("approach")!.extension).toBeLessThan(1);
    expect(stageSamples.get("contact")).toMatchObject({
      extension: 1,
      hatch: 1,
      payloadVisible: true,
      payloadKind: "non-cargo-keyed-service-cartridge",
    });
    expect(stageSamples.get("transfer")).toMatchObject({
      extension: 1,
      hatch: 1,
      payloadVisible: true,
      payloadKind: "non-cargo-keyed-service-cartridge",
    });
    expect(stageSamples.get("return")!.extension).toBeLessThan(1);
    const transferDelta =
      ((0.49 - Number(activeStation.userData.transferPhase) + 1) % 1) / 0.62;
    renderer.update(1 / 0.62 + transferDelta);
    expect(
      activeStation
        .getObjectsByProperty("name", "rail-station-timed-service-cartridge")
        .filter((cartridge) => cartridge.visible),
    ).toHaveLength(1);
    expect(
      activeStation
        .getObjectsByProperty("name", "rail-station-load-metered-ore-stream")
        .every((stream) => !stream.visible),
    ).toBe(true);
    expect(
      parent
        .getObjectsByProperty("name", "rail-authoritative-wagon-cargo")
        .every((cargo) => !cargo.visible),
    ).toBe(true);
  });

  it("resets distance history on a live schedule reversal before the consist enters the campaign turnout", () => {
    const parent = new THREE.Group();
    const renderer = new RailRenderer(parent);
    const network = pass11CampaignPresentationNetwork("west-turnout-reversal");
    const outboundSegments = new Set([
      "campaign-main-09",
      "campaign-main-10",
      "campaign-main-11",
      "campaign-main-12",
      "campaign-main-13",
      "campaign-siding-west-curve",
      "campaign-siding-14",
    ]);
    let outboundSamples = 0;
    let minimumAdjacentSpacing = Number.POSITIVE_INFINITY;
    let maximumAdjacentSpacing = 0;
    let maximumAdjacentYaw = 0;
    let minimumCarZ = Number.POSITIVE_INFINITY;
    let maximumCarZ = Number.NEGATIVE_INFINITY;

    for (let tick = 0; tick < 420; tick += 1) {
      const snapshot = network.snapshot();
      renderer.sync({ elapsedSeconds: tick / 60, rail: snapshot });
      const train = snapshot.trains[0]!;
      if (
        train.destinationStationId === "campaign-live-branch-destination" &&
        train.status === "moving" &&
        outboundSegments.has(train.currentSegmentId)
      ) {
        renderer.root.updateMatrixWorld(true);
        const trainRoot = parent.getObjectByName("rail-train-rig")!;
        const cars = trainRoot.children.filter(
          (child) =>
            child.name === "rail-locomotive-car" ||
            child.name === "rail-cargo-wagon-car",
        );
        const positions = cars.map((car) =>
          car.getWorldPosition(new THREE.Vector3()),
        );
        const yaws = cars.map((car) => {
          const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(
            car.getWorldQuaternion(new THREE.Quaternion()),
          );
          return -Math.atan2(forward.z, forward.x);
        });
        for (let index = 1; index < cars.length; index += 1) {
          const spacing = positions[index - 1]!.distanceTo(positions[index]!);
          minimumAdjacentSpacing = Math.min(minimumAdjacentSpacing, spacing);
          maximumAdjacentSpacing = Math.max(maximumAdjacentSpacing, spacing);
          maximumAdjacentYaw = Math.max(
            maximumAdjacentYaw,
            Math.abs(
              Math.atan2(
                Math.sin(yaws[index]! - yaws[index - 1]!),
                Math.cos(yaws[index]! - yaws[index - 1]!),
              ),
            ),
          );
        }
        for (const position of positions) {
          minimumCarZ = Math.min(minimumCarZ, position.z);
          maximumCarZ = Math.max(maximumCarZ, position.z);
        }
        outboundSamples += 1;
        if (train.currentSegmentId === "campaign-siding-14") break;
      }
      network.step(1);
    }

    expect(outboundSamples).toBeGreaterThan(20);
    expect(minimumAdjacentSpacing).toBeGreaterThan(2.35);
    expect(maximumAdjacentSpacing).toBeLessThan(2.62);
    expect(maximumAdjacentYaw).toBeLessThan(0.55);
    expect(minimumCarZ).toBeGreaterThan(15.9);
    expect(maximumCarZ).toBeLessThan(18.7);
    expect(parent.getObjectByName("rail-train-rig")!.userData).toMatchObject({
      poseDistanceMetric: "accumulated-rendered-centreline-arc",
      campaignWestTraversalDirection: 1,
      poseHistoryResetCount: 2,
      lastPoseHistoryResetReason: "authoritative-departure-reseed",
    });
  });

  it("bounds dense topology with instanced LOD and maintains a low p95 sync cost", () => {
    const segmentCount = 2_048;
    const network = new RailNetwork({
      segments: horizontalLine(0, segmentCount - 1, 0, "dense"),
      stations: [
        { id: "alpha", segmentId: "dense-0", capacity: 0 },
        {
          id: "omega",
          segmentId: `dense-${segmentCount - 1}`,
          capacity: 0,
        },
      ],
    });
    const parent = new THREE.Group();
    const renderer = new RailRenderer(parent, {
      maxRenderedSegments: 1_024,
      maxDetailedStations: 0,
      maxDetailedTrains: 0,
    });
    const denseFrame = {
      elapsedSeconds: 0,
      rail: network.snapshot(),
    };
    renderer.sync(denseFrame);
    const samples: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      const start = performance.now();
      renderer.sync({
        ...denseFrame,
        elapsedSeconds: index / 60,
      });
      samples.push(performance.now() - start);
    }
    samples.sort((left, right) => left - right);
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    const debug = renderer.getDebug();
    expect(debug).toMatchObject({
      segments: segmentCount,
      renderedSegments: 1_024,
      omittedSegments: 1_024,
      stations: 2,
      detailedStations: 0,
      overviewStations: 2,
      trains: 0,
      drawBatches: 8,
    });
    expect(debug.capacities.trackInstances).toBe(7 * 1_024);
    expect(
      (
        parent.getObjectByName(
          "rail-track-straight-running-surfaces",
        ) as THREE.InstancedMesh
      ).count,
    ).toBe(1_024);
    expect(debug.triangles).toBeGreaterThan(100_000);
    expect(p95).toBeLessThan(100);
    console.info(
      JSON.stringify({
        metric: "rail-dense-sync-p95-ms",
        samples: samples.length,
        segments: segmentCount,
        renderedSegments: debug.renderedSegments,
        p95Milliseconds: Number(p95.toFixed(3)),
        budgetMilliseconds: 100,
      }),
    );
  });

  it("caps detailed consist geometry and preserves overflow cars as bounded pickable instances", () => {
    const wagonCount = 12;
    const network = new RailNetwork({
      segments: horizontalLine(0, 4, 0, "consist"),
      stations: [
        { id: "origin", segmentId: "consist-0", capacity: 0 },
        { id: "destination", segmentId: "consist-4", capacity: 0 },
      ],
      trains: [
        {
          id: "long-haul",
          currentSegmentId: "consist-0",
          cars: [
            {
              id: "lead",
              kind: "locomotive",
              fuelCapacityMilli: 200_000,
              fuelMilli: 100_000,
            },
            ...Array.from({ length: wagonCount }, (_, index) => ({
              id: `wagon-${index}`,
              kind: "cargo-wagon" as const,
              capacity: 40,
            })),
          ],
          schedule: [
            { stationId: "origin", wait: { type: "time", ticks: 1 } },
            {
              stationId: "destination",
              wait: { type: "time", ticks: 1 },
            },
          ],
        },
      ],
    });
    const parent = new THREE.Group();
    const renderer = new RailRenderer(parent, {
      maxDetailedTrains: 1,
      maxDetailedCarsPerTrain: 2,
      maxOverviewCars: 3,
    });
    renderer.sync({ elapsedSeconds: 0, rail: network.snapshot() });

    expect(renderer.getDebug()).toMatchObject({
      trains: 1,
      detailedTrains: 1,
      overviewTrains: 0,
      locomotives: 1,
      cargoWagons: wagonCount,
      detailedCars: 2,
      overviewCars: 3,
      omittedCars: 8,
    });
    const detailedCargoCars: THREE.Object3D[] = [];
    parent.traverse((object) => {
      if (object.name === "rail-cargo-wagon-car") {
        detailedCargoCars.push(object);
      }
    });
    expect(detailedCargoCars).toHaveLength(1);
    const overflow = parent.getObjectByName(
      "rail-overview-cargo-wagon-cars",
    ) as THREE.InstancedMesh;
    expect(overflow.count).toBe(3);
    expect(renderer.resolvePick(overflow, 0)).toEqual({
      kind: "train",
      trainId: "long-haul",
      carId: "wagon-1",
    });
  });

  it("attaches through the ordinary world-loop adapter without taking simulation custody", () => {
    const parent = new THREE.Group();
    const adapter = new RailRendererIntegrationAdapter(parent, {
      maxRenderedSegments: 64,
    });
    const snapshot = visualTopologyNetwork().snapshot();
    adapter.sync({
      elapsed: 1.25,
      rail: snapshot,
    });
    expect(parent.getObjectByName("rail-world-system")).toBe(adapter.root);
    expect(adapter.root.userData.integrationSurface).toBe(
      "ordinary-world-render-loop-adapter",
    );
    expect(adapter.getDebug()).toMatchObject({
      disposed: false,
      segments: 39,
      curvedSegments: 2,
      junctionSegments: 2,
    });
    adapter.update(1.26);
    adapter.dispose();
    expect(adapter.getDebug().disposed).toBe(true);
    expect(parent.getObjectByName("rail-world-system")).toBeUndefined();
  });

  it("clears null state and disposes every owned GPU resource exactly once", () => {
    const parent = new THREE.Group();
    const renderer = new RailRenderer(parent);
    renderer.sync({
      elapsedSeconds: 0,
      rail: visualTopologyNetwork().snapshot(),
    });
    const before = renderer.getDebug().resources;
    expect(before.ownedGeometries).toBeGreaterThan(40);
    expect(before.ownedMaterials).toBeGreaterThan(25);
    expect(before.ownedTextures).toBe(3);
    expect(before.liveInstancedMeshes).toBeGreaterThan(0);

    renderer.sync({ elapsedSeconds: 1, rail: null });
    expect(renderer.root.visible).toBe(false);
    expect(renderer.getDebug()).toMatchObject({
      segments: 0,
      drawBatches: 0,
    });
    renderer.sync({
      elapsedSeconds: 2,
      rail: visualTopologyNetwork().snapshot(),
    });
    expect(renderer.root.visible).toBe(true);

    renderer.dispose();
    const disposed = renderer.getDebug();
    expect(parent.getObjectByName("rail-world-system")).toBeUndefined();
    expect(disposed.disposed).toBe(true);
    expect(disposed.resources).toMatchObject({
      liveInstancedMeshes: 0,
      disposedGeometries: before.ownedGeometries,
      disposedMaterials: before.ownedMaterials,
      disposedTextures: before.ownedTextures,
    });
    expect(disposed.resources.disposedInstancedMeshes).toBeGreaterThanOrEqual(
      before.liveInstancedMeshes,
    );
    const firstDisposal = { ...disposed.resources };
    renderer.dispose();
    expect(renderer.getDebug().resources).toEqual(firstDisposal);
    expect(() => renderer.sync({ elapsedSeconds: 3, rail: null })).toThrow(
      "Rail renderer is disposed.",
    );
    expect(() => renderer.update(3)).toThrow("Rail renderer is disposed.");
  });

  it("renders distinct selected, source, valid, and blocked authoring cues", () => {
    const parent = new THREE.Group();
    const adapter = new RailRendererIntegrationAdapter(parent);
    const snapshot = visualTopologyNetwork().snapshot();
    adapter.sync({ elapsedSeconds: 0, rail: snapshot });
    const selectedNode = snapshot.graph.nodes.find(
      (node) => node.segmentId === "main-08",
    )!;
    adapter.setAuthoringOverlay({
      selected: {
        kind: "segment",
        segmentId: selectedNode.segmentId,
        blockId: selectedNode.blockId,
      },
      sourceSegmentId: "main-07",
      preview: {
        buildKind: "curve",
        x: 12,
        z: 4,
        rotation: 3,
        validity: "valid",
      },
    });
    const overlay = parent.getObjectByName("rail-authoring-overlay")!;
    expect(overlay.visible).toBe(true);
    expect(
      parent.getObjectByName("rail-authoring-selected-target-ring")?.visible,
    ).toBe(true);
    expect(
      parent.getObjectByName(
        "rail-authoring-directed-source-diamond",
      )?.visible,
    ).toBe(true);
    expect(
      parent.getObjectByName("rail-authoring-preview-curve-track")?.visible,
    ).toBe(true);
    const validMarker = parent.getObjectByName(
      "rail-authoring-valid-ring-check",
    )!;
    const validMarkerMeshes = [
      parent.getObjectByName("rail-authoring-valid-ring"),
      parent.getObjectByName("rail-authoring-valid-check-short"),
      parent.getObjectByName("rail-authoring-valid-check-long"),
    ] as THREE.Mesh[];
    expect(validMarker.visible).toBe(true);
    expect(validMarker.position).toMatchObject({
      x: 12,
      y: 0.96,
      z: 4,
    });
    expect(validMarkerMeshes).toHaveLength(3);
    expect(
      validMarkerMeshes.every(
        (mesh) =>
          mesh instanceof THREE.Mesh &&
          mesh.material instanceof THREE.MeshBasicMaterial &&
          mesh.material.depthWrite === false &&
          mesh.material.depthTest === false,
      ),
    ).toBe(true);
    const validMarkerResources = validMarkerMeshes.map((mesh) => ({
      geometry: mesh.geometry,
      material: mesh.material,
    }));
    const resourcesBeforeOverlaySwap = {
      ...adapter.getDebug().resources,
    };
    expect(
      parent.getObjectByName("rail-authoring-blocked-cross")?.visible,
    ).toBe(false);
    expect(overlay.userData).toMatchObject({
      selectedCue: "amber-ring",
      sourceCue: "cyan-diamond",
      validCue: "green-tool-shape-plus-raised-ring-check",
      blockedCue: "red-tool-shape-plus-cross",
    });

    adapter.setAuthoringOverlay({
      selected: null,
      sourceSegmentId: null,
      preview: {
        buildKind: "junction",
        x: 13,
        z: 4,
        rotation: 2,
        validity: "blocked",
        reason: "occupied",
      },
    });
    expect(
      parent.getObjectByName("rail-authoring-preview-junction-track")
        ?.visible,
    ).toBe(true);
    expect(validMarker.visible).toBe(false);
    expect(
      parent.getObjectByName("rail-authoring-blocked-cross")?.visible,
    ).toBe(true);
    expect(adapter.getDebug().resources).toEqual(
      resourcesBeforeOverlaySwap,
    );
    expect(
      validMarkerMeshes.map((mesh) => ({
        geometry: mesh.geometry,
        material: mesh.material,
      })),
    ).toEqual(validMarkerResources);

    adapter.setAuthoringOverlay(null);
    expect(overlay.visible).toBe(false);
    expect(validMarker.visible).toBe(false);
    adapter.setAuthoringOverlay({
      selected: null,
      sourceSegmentId: null,
      preview: {
        buildKind: "station",
        x: 14,
        z: 4,
        rotation: 0,
        validity: "valid",
      },
    });
    expect(validMarker.visible).toBe(true);
    expect(validMarker.position).toMatchObject({
      x: 14,
      y: 0.96,
      z: 4,
    });
    expect(
      validMarkerMeshes.map((mesh) => ({
        geometry: mesh.geometry,
        material: mesh.material,
      })),
    ).toEqual(validMarkerResources);
    adapter.sync({ elapsedSeconds: 1, rail: null });
    expect(overlay.visible).toBe(false);
    expect(validMarker.visible).toBe(false);
    expect(overlay.userData.active).toBe(false);
    adapter.dispose();
  });
});
