import { describe, expect, it } from "vitest";

import { toRenderSnapshot } from "../src/game/adapters";
import {
  RAIL_LIMITS,
  type RailNetworkInput,
  type RailSegmentInput,
  type RailSignalInput,
  type RailTrainInput,
} from "../src/game/rail-network";
import { FactorySimulation } from "../src/game/simulation";
import {
  Direction,
  TerrainType,
  type RailStationStorageInterface,
  type SerializedSimulation,
} from "../src/game/types";

function horizontalLine(
  startX: number,
  endX: number,
  y: number,
  prefix = "rail",
): RailSegmentInput[] {
  return Array.from(
    { length: endX - startX + 1 },
    (_, offset) => ({
      id: `${prefix}-${offset}`,
      x: startX + offset,
      y,
      kind: "straight" as const,
      rotation: 1 as const,
    }),
  );
}

function storage(
  simulation: FactorySimulation,
  x: number,
  y: number,
): number {
  const placed = simulation.place(
    "storage",
    x,
    y,
    Direction.East,
  );
  if (!placed.ok) throw new Error(`storage placement failed: ${placed.reason}`);
  return placed.entity.id;
}

function cargoLoopFixture(): {
  simulation: FactorySimulation;
  mineStorageId: number;
  foundryStorageId: number;
  network: RailNetworkInput;
  interfaces: RailStationStorageInterface[];
} {
  const simulation = new FactorySimulation({
    width: 20,
    height: 12,
    seed: 17,
    generateTerrain: false,
    generateResources: false,
  });
  const mineStorageId = storage(simulation, 1, 3);
  const foundryStorageId = storage(simulation, 11, 3);
  const segments = horizontalLine(1, 12, 2);
  const network: RailNetworkInput = {
    segments,
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
            fuelMilli: 200_000,
          },
          {
            id: "ore-wagon",
            kind: "cargo-wagon",
            capacity: 10,
          },
        ],
        schedule: [
          { stationId: "mine", wait: { type: "cargo-full" } },
          { stationId: "foundry", wait: { type: "cargo-empty" } },
        ],
      },
    ],
  };
  const interfaces: RailStationStorageInterface[] = [
    {
      stationId: "mine",
      storageEntityId: mineStorageId,
      mode: "load",
      transferRate: 2,
      itemFilter: ["ironOre"],
    },
    {
      stationId: "foundry",
      storageEntityId: foundryStorageId,
      mode: "unload",
      transferRate: 2,
      itemFilter: ["ironOre"],
    },
  ];
  return {
    simulation,
    mineStorageId,
    foundryStorageId,
    network,
    interfaces,
  };
}

function itemMass(simulation: FactorySimulation, item = "ironOre"): number {
  return simulation.stats().stored[item as "ironOre"];
}

function fieldPrimeFixture(options: {
  readonly boundStationStorage?: boolean;
  readonly nearCoal?: number;
} = {}): {
  readonly simulation: FactorySimulation;
  readonly nearStorageId: number;
  readonly tiedStorageId: number;
  readonly distanceFiveStorageId: number;
  readonly boundStorageId: number | null;
} {
  const simulation = new FactorySimulation({
    width: 22,
    height: 14,
    seed: 0xf1e1d,
    generateTerrain: false,
    generateResources: false,
  });
  // The rail node is (10, 5). The 2×2 west storage has a nearest footprint
  // cell at (6, 5), exactly four cardinal tiles away. The north storage ties
  // at four; the next west storage is exactly five tiles away.
  const nearStorageId = storage(simulation, 5, 4);
  const tiedStorageId = storage(simulation, 9, 0);
  const distanceFiveStorageId = storage(simulation, 3, 4);
  const boundStorageId = options.boundStationStorage
    ? storage(simulation, 9, 6)
    : null;
  const fill = (entityId: number, amount: number): void => {
    if (amount <= 0) return;
    expect(simulation.receive(entityId, "coal", amount)).toBe(amount);
  };
  fill(nearStorageId, options.nearCoal ?? 4);
  fill(tiedStorageId, 4);
  fill(distanceFiveStorageId, 4);
  if (boundStorageId !== null) fill(boundStorageId, 4);

  const network: RailNetworkInput = {
    segments: horizontalLine(10, 14, 5, "prime"),
    stations: [
      { id: "breakdown", segmentId: "prime-0", capacity: 0 },
      { id: "destination", segmentId: "prime-4", capacity: 0 },
    ],
    trains: [{
      id: "prime-train",
      currentSegmentId: "prime-0",
      cars: [{
        id: "prime-locomotive",
        kind: "locomotive",
        fuelCapacityMilli: 20_000,
        fuelMilli: 0,
      }],
      schedule: [{
        stationId: "destination",
        wait: { type: "time", ticks: 0 },
      }],
    }],
  };
  const stationInterfaces: RailStationStorageInterface[] =
    boundStorageId === null
      ? []
      : [{
          stationId: "breakdown",
          storageEntityId: boundStorageId,
          mode: "load",
          transferRate: 1,
          itemFilter: ["coal"],
        }];
  expect(
    simulation.configureRailNetwork({ network, stationInterfaces }),
  ).toEqual({ ok: true });
  simulation.drainEvents();
  simulation.step();
  expect(
    simulation.railSnapshot()?.trains[0]?.status,
  ).toBe("out-of-fuel");
  simulation.drainEvents();
  return {
    simulation,
    nearStorageId,
    tiedStorageId,
    distanceFiveStorageId,
    boundStorageId,
  };
}

function opposingNetwork(): RailNetworkInput {
  const segments = horizontalLine(2, 8, 5, "op");
  const signals: RailSignalInput[] = [
    {
      id: "left-in",
      fromSegmentId: "op-1",
      toSegmentId: "op-2",
      type: "regular",
    },
    {
      id: "left-out",
      fromSegmentId: "op-2",
      toSegmentId: "op-1",
      type: "regular",
    },
    {
      id: "right-in",
      fromSegmentId: "op-5",
      toSegmentId: "op-4",
      type: "chain",
    },
    {
      id: "right-out",
      fromSegmentId: "op-4",
      toSegmentId: "op-5",
      type: "regular",
    },
  ];
  const locomotive = (id: string): RailTrainInput["cars"][number] => ({
    id,
    kind: "locomotive",
    fuelCapacityMilli: 500_000,
    fuelMilli: 500_000,
  });
  return {
    segments,
    signals,
    stations: [
      { id: "left", segmentId: "op-0", capacity: 0 },
      { id: "beta-turn", segmentId: "op-2", capacity: 0 },
      { id: "alpha-turn", segmentId: "op-4", capacity: 0 },
      { id: "right", segmentId: "op-6", capacity: 0 },
    ],
    trains: [
      {
        id: "alpha",
        currentSegmentId: "op-0",
        cars: [locomotive("alpha-loco")],
        schedule: [
          { stationId: "left", wait: { type: "time", ticks: 10 } },
          { stationId: "alpha-turn", wait: { type: "time", ticks: 0 } },
        ],
      },
      {
        id: "beta",
        currentSegmentId: "op-6",
        cars: [locomotive("beta-loco")],
        schedule: [
          { stationId: "right", wait: { type: "time", ticks: 10 } },
          { stationId: "beta-turn", wait: { type: "time", ticks: 0 } },
        ],
      },
    ],
  };
}

describe("FactorySimulation rail ownership and persistence", () => {
  it("migrates v7 without changing fluid or circuit state", () => {
    const simulation = new FactorySimulation({
      width: 12,
      height: 12,
      generateTerrain: false,
      generateResources: false,
    });
    simulation.step(7);
    const v8 = simulation.serialize();
    const legacy = structuredClone(v8) as unknown as Record<
      string,
      unknown
    >;
    legacy.version = 7;
    legacy.catalogVersion = "cinderline-7";
    delete legacy.railNetwork;
    delete legacy.railStationInterfaces;

    const restored = FactorySimulation.restore(
      legacy as unknown as SerializedSimulation,
    ).serialize();
    expect(restored.version).toBe(8);
    expect(restored.catalogVersion).toBe("cinderline-8");
    expect(restored.railNetwork).toBeNull();
    expect(restored.railStationInterfaces).toEqual([]);
    expect(restored.circuitNetwork).toEqual(v8.circuitNetwork);
    expect(restored.fluidProducedMilli).toEqual(v8.fluidProducedMilli);
    expect(restored.fluidProcessedMilli).toEqual(v8.fluidProcessedMilli);
    expect(restored.fluidTransferredMilli).toBe(v8.fluidTransferredMilli);
  });

  it("aligns fixed ticks and passes a detached structural snapshot through the adapter", () => {
    const fixture = cargoLoopFixture();
    fixture.simulation.step(23);
    expect(
      fixture.simulation.configureRailNetwork({
        network: fixture.network,
        stationInterfaces: fixture.interfaces,
      }),
    ).toEqual({ ok: true });
    expect(fixture.simulation.railSnapshot()?.tick).toBe(23);
    fixture.simulation.step();
    const snapshot = fixture.simulation.getRenderSnapshot();
    expect(snapshot.rail?.tick).toBe(snapshot.tick);
    expect(toRenderSnapshot(snapshot).rail).toEqual(snapshot.rail);
    expect(snapshot.rail?.graph.nodes).toHaveLength(12);
  });

  it("enforces entity, water, edit, and bound-storage collision rules atomically", () => {
    const fixture = cargoLoopFixture();
    expect(
      fixture.simulation.configureRailNetwork({
        network: fixture.network,
        stationInterfaces: fixture.interfaces,
      }),
    ).toEqual({ ok: true });
    expect(
      fixture.simulation.canPlace(
        "belt",
        5,
        2,
        Direction.East,
      ),
    ).toMatchObject({ ok: false, reason: "occupied" });
    expect(
      fixture.simulation.setTerrain(5, 2, TerrainType.Water),
    ).toBe(false);
    expect(fixture.simulation.remove(1, 3)).toBeUndefined();

    const ordinary = fixture.simulation.place(
      "belt",
      5,
      6,
      Direction.East,
    );
    expect(ordinary.ok).toBe(true);
    const before = fixture.simulation.serialize();
    const overlapping = before.railNetwork!.segments.map((segment) =>
      segment.id === "rail-5"
        ? { ...segment, x: 5, y: 6 }
        : segment,
    );
    expect(
      fixture.simulation.replaceRailSegments(overlapping),
    ).toEqual({ ok: false, reason: "occupied" });
    expect(fixture.simulation.serialize()).toEqual(before);
  });

  it("moves real storage cargo through a wagon without duplicating mass", () => {
    const fixture = cargoLoopFixture();
    expect(
      fixture.simulation.receive(
        fixture.mineStorageId,
        "ironOre",
        20,
      ),
    ).toBe(20);
    fixture.simulation.drainEvents();
    expect(
      fixture.simulation.configureRailNetwork({
        network: fixture.network,
        stationInterfaces: fixture.interfaces,
      }),
    ).toEqual({ ok: true });
    fixture.simulation.drainEvents();

    let minimumMass = Number.POSITIVE_INFINITY;
    let maximumMass = 0;
    for (let index = 0; index < 1_500; index += 1) {
      fixture.simulation.step();
      const mass = itemMass(fixture.simulation);
      minimumMass = Math.min(minimumMass, mass);
      maximumMass = Math.max(maximumMass, mass);
    }
    const foundry = fixture.simulation.getEntity(
      fixture.foundryStorageId,
    )!;
    const events = fixture.simulation.drainEvents();
    expect(foundry.inventory.ironOre ?? 0).toBeGreaterThan(0);
    expect(minimumMass).toBe(20);
    expect(maximumMass).toBe(20);
    expect(
      events.some((event) => event.type === "railCargoLoaded"),
    ).toBe(true);
    expect(
      events.some((event) => event.type === "railCargoUnloaded"),
    ).toBe(true);
    expect(
      fixture.simulation.railSnapshot()?.stations.every(
        (station) =>
          station.capacity === 0 &&
          station.inventory.length === 0,
      ),
    ).toBe(true);
  });

  it("round-trips exactly and continues rail, circuit, and custody bit-for-bit", () => {
    const fixture = cargoLoopFixture();
    fixture.simulation.receive(fixture.mineStorageId, "ironOre", 20);
    expect(
      fixture.simulation.configureRailNetwork({
        network: fixture.network,
        stationInterfaces: fixture.interfaces,
      }),
    ).toEqual({ ok: true });
    fixture.simulation.step(137);
    fixture.simulation.drainEvents();
    const serialized = fixture.simulation.serialize();
    const restored = FactorySimulation.restore(
      structuredClone(serialized),
    );
    expect(restored.serialize()).toEqual(serialized);
    expect(restored.railSnapshot()?.tick).toBe(restored.tickCount);
    expect(restored.circuitSnapshot().tick).toBe(restored.tickCount);

    fixture.simulation.step(311);
    restored.step(311);
    expect(restored.serialize()).toEqual(fixture.simulation.serialize());
    expect(restored.drainEvents()).toEqual(
      fixture.simulation.drainEvents(),
    );
  });

  it("rejects hostile rail ticks, keys, cargo domains, station custody, overlaps, and bindings", () => {
    const fixture = cargoLoopFixture();
    fixture.simulation.receive(fixture.mineStorageId, "ironOre", 3);
    expect(
      fixture.simulation.configureRailNetwork({
        network: fixture.network,
        stationInterfaces: fixture.interfaces,
      }),
    ).toEqual({ ok: true });
    fixture.simulation.step();
    const canonical = fixture.simulation.serialize();
    const rejects = (mutate: (save: any) => void): void => {
      const hostile = structuredClone(canonical) as any;
      mutate(hostile);
      expect(() => FactorySimulation.restore(hostile)).toThrow();
    };

    rejects((save) => {
      save.railNetwork.tick -= 1;
    });
    rejects((save) => {
      save.railNetwork.extra = true;
    });
    rejects((save) => {
      save.railNetwork.trains[0].cars.find(
        (car: any) => car.kind === "cargo-wagon",
      ).cargo[0].itemId = "uranium";
    });
    rejects((save) => {
      save.railNetwork.trains[0].distanceTravelledMilli =
        Number.MAX_SAFE_INTEGER;
    });
    rejects((save) => {
      save.railNetwork.trains[0].dwellTicks =
        save.tickCount + 1;
    });
    rejects((save) => {
      save.railNetwork.stations[0].capacity = 1;
    });
    rejects((save) => {
      save.entities.find(
        (entity: any) => entity.id === fixture.mineStorageId,
      ).y = 2;
    });
    rejects((save) => {
      save.railStationInterfaces[0].storageEntityId = 999_999;
    });
    rejects((save) => {
      save.railStationInterfaces[0].itemFilter = [
        "ironOre",
        "coal",
      ];
    });
  });

  it("repaths after topology edits and publishes regular and chain signal aspects", () => {
    const simulation = new FactorySimulation({
      width: 16,
      height: 10,
      generateTerrain: false,
      generateResources: false,
    });
    const segments = horizontalLine(2, 8, 4);
    const signals: RailSignalInput[] = [
      {
        id: "regular",
        fromSegmentId: "rail-1",
        toSegmentId: "rail-2",
        type: "regular",
      },
      {
        id: "chain",
        fromSegmentId: "rail-3",
        toSegmentId: "rail-4",
        type: "chain",
      },
    ];
    expect(
      simulation.configureRailNetwork({
        network: {
          segments,
          signals,
          stations: [
            { id: "origin", segmentId: "rail-0", capacity: 0 },
            { id: "destination", segmentId: "rail-6", capacity: 0 },
          ],
          trains: [
            {
              id: "train",
              currentSegmentId: "rail-0",
              cars: [
                {
                  id: "loco",
                  kind: "locomotive",
                  fuelCapacityMilli: 100_000,
                  fuelMilli: 100_000,
                },
              ],
              schedule: [
                {
                  stationId: "destination",
                  wait: { type: "time", ticks: 0 },
                },
              ],
            },
          ],
        },
      }),
    ).toEqual({ ok: true });
    expect(
      simulation.railSnapshot()?.signals.map((signal) => signal.aspect),
    ).toEqual(expect.arrayContaining(["red", "chain-clear"]));

    expect(
      simulation.replaceRailSignals([]),
    ).toEqual({ ok: true });
    simulation.drainEvents();
    expect(
      simulation.replaceRailSegments(
        segments.filter((segment) => segment.id !== "rail-3"),
      ),
    ).toEqual({ ok: true });
    expect(simulation.railSnapshot()?.trains[0]?.status).toBe("no-path");
    expect(
      simulation
        .drainEvents()
        .some((event) => event.type === "railPathLost"),
    ).toBe(true);
    expect(simulation.replaceRailSegments(segments)).toEqual({ ok: true });
    expect(simulation.railSnapshot()?.trains[0]?.status).not.toBe(
      "no-path",
    );
    expect(
      simulation
        .drainEvents()
        .some((event) => event.type === "railPathRestored"),
    ).toBe(true);
  });

  it("prevents block collisions and gives opposing consists deterministic progress", () => {
    const simulation = new FactorySimulation({
      width: 12,
      height: 12,
      generateTerrain: false,
      generateResources: false,
    });
    expect(
      simulation.configureRailNetwork({ network: opposingNetwork() }),
    ).toEqual({ ok: true });
    simulation.drainEvents();
    for (let index = 0; index < 2_000; index += 1) {
      simulation.step();
      const rail = simulation.railSnapshot()!;
      expect(
        new Set(rail.trains.map((train) => train.currentBlockId)).size,
      ).toBe(rail.trains.length);
    }
    const trains = simulation.railSnapshot()!.trains;
    expect(
      trains.every((train) => train.distanceTravelledMilli > 0),
    ).toBe(true);
    const arrivals = simulation
      .drainEvents()
      .filter((event) => event.type === "railTrainArrived")
      .map((event) => event.railTrainId);
    expect(arrivals).toContain("alpha");
    expect(arrivals).toContain("beta");
  });

  it("supports atomic consist, schedule, cargo, and coal-fueling APIs", () => {
    const fixture = cargoLoopFixture();
    const zeroFuelNetwork: RailNetworkInput = {
      ...fixture.network,
      trains: [
        {
          ...fixture.network.trains![0]!,
          cars: [
            {
              id: "ore-locomotive",
              kind: "locomotive",
              fuelCapacityMilli: 20_000,
              fuelMilli: 0,
            },
            {
              id: "ore-wagon",
              kind: "cargo-wagon",
              capacity: 10,
            },
          ],
          schedule: [
            { stationId: "mine", wait: { type: "time", ticks: 100 } },
            { stationId: "foundry", wait: { type: "time", ticks: 0 } },
          ],
        },
      ],
    };
    const interfaces = fixture.interfaces.map((binding) =>
      binding.stationId === "mine"
        ? { ...binding, mode: "both" as const, itemFilter: ["coal"] as const }
        : binding,
    );
    expect(
      fixture.simulation.configureRailNetwork({
        network: zeroFuelNetwork,
        stationInterfaces: interfaces,
      }),
    ).toEqual({ ok: true });
    expect(
      fixture.simulation.replaceRailStations(
        zeroFuelNetwork.stations,
        interfaces,
      ),
    ).toEqual({ ok: true });
    fixture.simulation.step(3);
    expect(
      fixture.simulation.railSnapshot()?.trains[0]?.dwellTicks,
    ).toBe(3);
    fixture.simulation.receive(fixture.mineStorageId, "coal", 5);
    expect(
      fixture.simulation.fuelRailLocomotiveFromStorage(
        "mine",
        "ore-shuttle",
        "ore-locomotive",
        3,
      ),
    ).toBe(3);
    expect(
      fixture.simulation.getEntity(fixture.mineStorageId)?.inventory.coal,
    ).toBe(2);
    expect(
      fixture.simulation.transferRailCargo(
        "mine",
        "ore-shuttle",
        "ore-wagon",
        "coal",
        1,
      ),
    ).toBe(1);
    expect(
      fixture.simulation.transferRailCargo(
        "mine",
        "ore-shuttle",
        "ore-wagon",
        "coal",
        -1,
      ),
    ).toBe(-1);
    expect(
      fixture.simulation.replaceRailTrainConsist("ore-shuttle", [
        {
          id: "ore-locomotive",
          kind: "locomotive",
          fuelCapacityMilli: 20_000,
          fuelMilli: 12_000,
        },
        {
          id: "ore-wagon",
          kind: "cargo-wagon",
          capacity: 20,
        },
      ]),
    ).toEqual({ ok: true });
    expect(
      fixture.simulation.setRailTrainSchedule("ore-shuttle", [
        {
          stationId: "foundry",
          wait: { type: "time", ticks: 0 },
        },
      ]),
    ).toEqual({ ok: true });
    expect(
      fixture.simulation.replaceRailSignals([
        {
          id: "east-boundary",
          fromSegmentId: "rail-2",
          toSegmentId: "rail-3",
          type: "regular",
        },
        {
          id: "west-boundary",
          fromSegmentId: "rail-3",
          toSegmentId: "rail-2",
          type: "regular",
        },
      ]),
    ).toEqual({ ok: true });

    const extra: RailTrainInput = {
      id: "spare",
      currentSegmentId: "rail-11",
      cars: [
        {
          id: "spare-loco",
          kind: "locomotive",
          fuelCapacityMilli: 10_000,
          fuelMilli: 0,
        },
      ],
      schedule: [
        {
          stationId: "foundry",
          wait: { type: "time", ticks: 0 },
        },
      ],
    };
    expect(fixture.simulation.addRailTrain(extra)).toEqual({ ok: true });
    expect(
      fixture.simulation.removeRailTrain("spare"),
    ).toEqual({ ok: true });
    expect(
      fixture.simulation.addRailTrain({
        ...extra,
        currentSegmentId: "rail-0",
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      fixture.simulation.addRailTrain({
        ...extra,
        id: "preloaded",
        cars: [
          {
            id: "preloaded-loco",
            kind: "locomotive",
            fuelCapacityMilli: 10_000,
            fuelMilli: 0,
          },
          {
            id: "preloaded-wagon",
            kind: "cargo-wagon",
            capacity: 10,
            cargo: [{ itemId: "ironOre", count: 1 }],
          },
        ],
      }),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("conserves locomotive fuel exactly across consist edits and removal", () => {
    const fixture = cargoLoopFixture();
    const network: RailNetworkInput = {
      ...fixture.network,
      trains: [
        {
          ...fixture.network.trains![0]!,
          cars: [
            {
              id: "ore-locomotive",
              kind: "locomotive",
              fuelCapacityMilli: 200_000,
              fuelMilli: 12_000,
            },
          ],
        },
      ],
    };
    expect(
      fixture.simulation.configureRailNetwork({
        network,
        stationInterfaces: fixture.interfaces,
      }),
    ).toEqual({ ok: true });
    const before = fixture.simulation.serializeToString();

    expect(
      fixture.simulation.replaceRailTrainConsist("ore-shuttle", [
        {
          id: "replacement-locomotive",
          kind: "locomotive",
          fuelCapacityMilli: 200_000,
          fuelMilli: 11_999,
        },
      ]),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(fixture.simulation.serializeToString()).toBe(before);
    expect(
      fixture.simulation.replaceRailTrainConsist("ore-shuttle", [
        {
          id: "replacement-locomotive",
          kind: "locomotive",
          fuelCapacityMilli: 200_000,
          fuelMilli: 12_001,
        },
      ]),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(fixture.simulation.serializeToString()).toBe(before);
    expect(
      fixture.simulation.removeRailTrain("ore-shuttle"),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(fixture.simulation.serializeToString()).toBe(before);

    expect(
      fixture.simulation.replaceRailTrainConsist("ore-shuttle", [
        {
          id: "replacement-a",
          kind: "locomotive",
          fuelCapacityMilli: 200_000,
          fuelMilli: 5_000,
        },
        {
          id: "replacement-b",
          kind: "locomotive",
          fuelCapacityMilli: 200_000,
          fuelMilli: 7_000,
        },
      ]),
    ).toEqual({ ok: true });
    expect(
      fixture.simulation.railSnapshot()?.trains[0]?.fuelMilli,
    ).toBe(12_000);
  });

  it("rejects an in-motion consist without mutating any rail state", () => {
    const fixture = cargoLoopFixture();
    const movingNetwork: RailNetworkInput = {
      ...fixture.network,
      trains: [
        {
          ...fixture.network.trains![0]!,
          schedule: [
            {
              stationId: "foundry",
              wait: { type: "time", ticks: 0 },
            },
          ],
        },
      ],
    };
    expect(
      fixture.simulation.configureRailNetwork({
        network: movingNetwork,
        stationInterfaces: fixture.interfaces,
      }),
    ).toEqual({ ok: true });
    for (
      let tick = 0;
      tick < 10 &&
      fixture.simulation.railSnapshot()?.trains[0]?.status !== "moving";
      tick += 1
    ) {
      fixture.simulation.step();
    }
    expect(
      fixture.simulation.railSnapshot()?.trains[0]?.status,
    ).toBe("moving");
    const before = fixture.simulation.serializeToString();
    expect(
      fixture.simulation.removeRailTrain("ore-shuttle"),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(fixture.simulation.serializeToString()).toBe(before);
  });

  it("rejects station replacement that could manufacture station cargo", () => {
    const fixture = cargoLoopFixture();
    expect(
      fixture.simulation.configureRailNetwork({
        network: fixture.network,
        stationInterfaces: fixture.interfaces,
      }),
    ).toEqual({ ok: true });
    const before = fixture.simulation.serializeToString();
    expect(
      fixture.simulation.replaceRailStations(
        fixture.network.stations.map((station, index) =>
          index === 0
            ? {
                ...station,
                capacity: 10,
                inventory: [{ itemId: "ironOre", count: 1 }],
              }
            : station,
        ),
        fixture.interfaces,
      ),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(fixture.simulation.serializeToString()).toBe(before);
  });

  it("preflights the rail tick horizon before mutating simulation state", () => {
    const fixture = cargoLoopFixture();
    expect(
      fixture.simulation.configureRailNetwork({
        network: fixture.network,
        stationInterfaces: fixture.interfaces,
      }),
    ).toEqual({ ok: true });
    const save = fixture.simulation.serialize();
    const atLimit = structuredClone(save);
    atLimit.tickCount = RAIL_LIMITS.maxTicks;
    atLimit.circuitNetwork = {
      ...atLimit.circuitNetwork,
      tick: RAIL_LIMITS.maxTicks,
    };
    atLimit.railNetwork = {
      ...atLimit.railNetwork!,
      tick: RAIL_LIMITS.maxTicks,
    };
    const restored = FactorySimulation.restore(atLimit);
    const before = restored.serialize();
    expect(() => restored.step()).toThrow(/Rail tick counter/);
    expect(restored.serialize()).toEqual(before);
  });

  it("field-primes a cargo-bearing out-of-fuel train from nearby physical coal", () => {
    const fixture = cargoLoopFixture();
    const rescueNetwork: RailNetworkInput = {
      ...fixture.network,
      trains: [{
        ...fixture.network.trains![0]!,
        cars: [
          {
            id: "ore-locomotive",
            kind: "locomotive",
            fuelCapacityMilli: 20_000,
            fuelMilli: 2,
          },
          {
            id: "ore-wagon",
            kind: "cargo-wagon",
            capacity: 10,
          },
        ],
        schedule: [
          { stationId: "mine", wait: { type: "time", ticks: 0 } },
          { stationId: "foundry", wait: { type: "time", ticks: 0 } },
        ],
      }],
    };
    expect(
      fixture.simulation.configureRailNetwork({
        network: rescueNetwork,
        stationInterfaces: fixture.interfaces,
      }),
    ).toEqual({ ok: true });
    fixture.simulation.receive(fixture.mineStorageId, "ironOre", 2);
    fixture.simulation.receive(fixture.mineStorageId, "coal", 2);
    expect(
      fixture.simulation.transferRailCargo(
        "mine",
        "ore-shuttle",
        "ore-wagon",
        "ironOre",
        2,
      ),
    ).toBe(2);
    for (let index = 0; index < 20; index += 1) {
      fixture.simulation.step();
      if (
        fixture.simulation.railSnapshot()?.trains[0]?.status ===
        "out-of-fuel"
      ) {
        break;
      }
    }
    const stranded =
      fixture.simulation.railSnapshot()?.trains[0];
    expect(stranded?.status).toBe("out-of-fuel");
    expect(stranded?.cargoUnits).toBe(2);
    expect(
      fixture.simulation.railFieldPrimeStorageIds("ore-shuttle"),
    ).toContain(fixture.mineStorageId);
    const coalBefore =
      fixture.simulation.getEntity(fixture.mineStorageId)?.inventory.coal;
    expect(
      fixture.simulation.fieldPrimeRailLocomotiveFromStorage(
        fixture.mineStorageId,
        "ore-shuttle",
        "ore-locomotive",
        1,
      ),
    ).toBe(1);
    expect(
      fixture.simulation.getEntity(fixture.mineStorageId)?.inventory.coal,
    ).toBe((coalBefore ?? 0) - 1);
    let resumed = false;
    for (let index = 0; index < 10; index += 1) {
      fixture.simulation.step();
      const train = fixture.simulation.railSnapshot()?.trains[0];
      resumed ||= train?.status === "moving";
      expect(train?.cargoUnits).toBe(2);
    }
    expect(resumed).toBe(true);
  });

  it("rejects every adversarial field-prime without bytes or events and orders footprint-nearest custody", () => {
    const fixture = fieldPrimeFixture();
    const rejectWithoutMutation = (
      simulation: FactorySimulation,
      operation: () => number,
    ): void => {
      simulation.drainEvents();
      const before = simulation.serializeToString();
      expect(operation()).toBe(0);
      expect(simulation.serializeToString()).toBe(before);
      expect(simulation.drainEvents()).toEqual([]);
    };

    expect(
      fixture.simulation.railFieldPrimeStorageIds("prime-train"),
    ).toEqual([
      fixture.nearStorageId,
      fixture.tiedStorageId,
    ]);
    expect(
      fixture.simulation.railFieldPrimeStorageIds("missing-train"),
    ).toEqual([]);

    // A 2×2 storage origin that appears five cells from the train is accepted
    // when its nearest occupied footprint cell is exactly four cells away.
    // The next origin's nearest footprint cell is exactly five and is rejected.
    rejectWithoutMutation(fixture.simulation, () =>
      fixture.simulation.fieldPrimeRailLocomotiveFromStorage(
        fixture.distanceFiveStorageId,
        "prime-train",
        "prime-locomotive",
        1,
      )
    );
    for (const coalCount of [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      rejectWithoutMutation(fixture.simulation, () =>
        fixture.simulation.fieldPrimeRailLocomotiveFromStorage(
          fixture.nearStorageId,
          "prime-train",
          "prime-locomotive",
          coalCount,
        )
      );
    }
    rejectWithoutMutation(fixture.simulation, () =>
      fixture.simulation.fieldPrimeRailLocomotiveFromStorage(
        999_999,
        "prime-train",
        "prime-locomotive",
        1,
      )
    );
    rejectWithoutMutation(fixture.simulation, () =>
      fixture.simulation.fieldPrimeRailLocomotiveFromStorage(
        fixture.nearStorageId,
        "missing-train",
        "prime-locomotive",
        1,
      )
    );
    rejectWithoutMutation(fixture.simulation, () =>
      fixture.simulation.fieldPrimeRailLocomotiveFromStorage(
        fixture.nearStorageId,
        "prime-train",
        "missing-locomotive",
        1,
      )
    );

    const emptyFixture = fieldPrimeFixture({ nearCoal: 0 });
    rejectWithoutMutation(emptyFixture.simulation, () =>
      emptyFixture.simulation.fieldPrimeRailLocomotiveFromStorage(
        emptyFixture.nearStorageId,
        "prime-train",
        "prime-locomotive",
        1,
      )
    );

    const fullSave = structuredClone(
      fixture.simulation.serialize(),
    );
    const fullLocomotive = fullSave.railNetwork!.trains[0]!
      .cars[0] as unknown as {
        fuelCapacityMilli: number;
        fuelMilli: number;
      };
    fullLocomotive.fuelMilli = fullLocomotive.fuelCapacityMilli;
    const fullSimulation = FactorySimulation.restore(fullSave);
    rejectWithoutMutation(fullSimulation, () =>
      fullSimulation.fieldPrimeRailLocomotiveFromStorage(
        fixture.nearStorageId,
        "prime-train",
        "prime-locomotive",
        1,
      )
    );

    const restoreStatus = (
      status: "moving" | "waiting-signal" | "dwelling",
    ): FactorySimulation => {
      const save = structuredClone(fixture.simulation.serialize());
      const train = save.railNetwork!.trains[0]! as unknown as {
        status: "moving" | "waiting-signal" | "dwelling";
        speedMilliPerTick: number;
        progressMilli: number;
        dwellTicks: number;
        reservationWaitTicks: number;
        schedule: Array<{
          stationId: string;
          wait: { type: "time"; ticks: number };
        }>;
      };
      train.status = status;
      train.speedMilliPerTick = status === "moving" ? 1 : 0;
      train.progressMilli = 0;
      train.dwellTicks = 0;
      train.reservationWaitTicks = 0;
      if (status === "dwelling") {
        train.schedule[0] = {
          stationId: "breakdown",
          wait: { type: "time", ticks: 60 },
        };
      }
      return FactorySimulation.restore(save);
    };
    for (const status of [
      "moving",
      "waiting-signal",
      "dwelling",
    ] as const) {
      const simulation = restoreStatus(status);
      expect(
        simulation.railFieldPrimeStorageIds("prime-train"),
      ).toEqual([]);
      rejectWithoutMutation(simulation, () =>
        simulation.fieldPrimeRailLocomotiveFromStorage(
          fixture.nearStorageId,
          "prime-train",
          "prime-locomotive",
          1,
        )
      );
    }

    const coalBefore =
      fixture.simulation.getEntity(fixture.nearStorageId)
        ?.inventory.coal ?? 0;
    expect(
      fixture.simulation.fieldPrimeRailLocomotiveFromStorage(
        fixture.nearStorageId,
        "prime-train",
        "prime-locomotive",
        1,
      ),
    ).toBe(1);
    expect(
      fixture.simulation.getEntity(fixture.nearStorageId)
        ?.inventory.coal,
    ).toBe(coalBefore - 1);
    expect(fixture.simulation.drainEvents()).toEqual([
      expect.objectContaining({
        type: "railFueled",
        railTrainId: "prime-train",
        item: "coal",
        amount: 1,
      }),
    ]);
  });

  it("loads physical coal through a bound station while exactly out of fuel", () => {
    const fixture = fieldPrimeFixture({
      boundStationStorage: true,
    });
    expect(fixture.boundStorageId).not.toBeNull();
    const storageId = fixture.boundStorageId!;
    const coalBefore =
      fixture.simulation.getEntity(storageId)?.inventory.coal ?? 0;
    expect(
      fixture.simulation.fuelRailLocomotiveFromStorage(
        "breakdown",
        "prime-train",
        "prime-locomotive",
        1,
      ),
    ).toBe(1);
    expect(
      fixture.simulation.getEntity(storageId)?.inventory.coal,
    ).toBe(coalBefore - 1);
    expect(fixture.simulation.drainEvents()).toEqual([
      expect.objectContaining({
        type: "railFueled",
        railTrainId: "prime-train",
        railStationId: "breakdown",
        item: "coal",
        amount: 1,
      }),
    ]);
  });

  it("emits a deterministic authoritative rail-loop proof payload", () => {
    const fixture = cargoLoopFixture();
    const initialCargo = 20;
    fixture.simulation.receive(
      fixture.mineStorageId,
      "ironOre",
      initialCargo,
    );
    fixture.simulation.drainEvents();
    expect(
      fixture.simulation.configureRailNetwork({
        network: fixture.network,
        stationInterfaces: fixture.interfaces,
      }),
    ).toEqual({ ok: true });
    fixture.simulation.drainEvents();
    let massConserved = true;
    for (let index = 0; index < 1_500; index += 1) {
      fixture.simulation.step();
      massConserved &&= itemMass(fixture.simulation) === initialCargo;
    }
    const events = fixture.simulation.drainEvents();
    const restored = FactorySimulation.restore(
      fixture.simulation.serialize(),
    );
    fixture.simulation.step(120);
    restored.step(120);
    const rail = fixture.simulation.railSnapshot()!;
    const proof = {
      format: "cinderline-rail-simulation-proof",
      simulationVersion: fixture.simulation.serialize().version,
      catalogVersion: fixture.simulation.serialize().catalogVersion,
      tick: fixture.simulation.tickCount,
      railTick: rail.tick,
      circuitTick: fixture.simulation.circuitSnapshot().tick,
      initialCargo,
      finalCargo: itemMass(fixture.simulation),
      foundryCargo:
        fixture.simulation.getEntity(fixture.foundryStorageId)
          ?.inventory.ironOre ?? 0,
      loadedEvents: events.filter(
        (event) => event.type === "railCargoLoaded",
      ).length,
      unloadedEvents: events.filter(
        (event) => event.type === "railCargoUnloaded",
      ).length,
      departedEvents: events.filter(
        (event) => event.type === "railTrainDeparted",
      ).length,
      arrivedEvents: events.filter(
        (event) => event.type === "railTrainArrived",
      ).length,
      massConserved,
      exactRestoreContinuation:
        restored.serializeToString() ===
        fixture.simulation.serializeToString(),
      stationOwnedCargoUnits: rail.stations.reduce(
        (sum, station) => sum + station.storedUnits,
        0,
      ),
      consistOccupancyModel: "exclusive-block-atomic-consist",
    };
    expect(proof.massConserved).toBe(true);
    expect(proof.exactRestoreContinuation).toBe(true);
    expect(proof.foundryCargo).toBe(initialCargo);
    expect(proof.stationOwnedCargoUnits).toBe(0);
    expect(proof.railTick).toBe(proof.tick);
    expect(proof.circuitTick).toBe(proof.tick);
    const proofEnabled = (
      globalThis as {
        process?: { env?: Record<string, string | undefined> };
      }
    ).process?.env?.CINDERLINE_RAIL_SIMULATION_PROOF === "1";
    if (proofEnabled) {
      console.log(`[rail-simulation-proof]${JSON.stringify(proof)}`);
    }
  });
});
