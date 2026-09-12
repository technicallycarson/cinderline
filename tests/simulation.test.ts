import { describe, expect, it } from "vitest";

import {
  COAL_ENERGY_KJ,
  ENTITY_PROTOTYPES,
  ITEM_IDS,
} from "../src/game/catalog";
import {
  FactorySimulation,
  createDemoSimulation,
} from "../src/game/simulation";
import { toRenderSnapshot } from "../src/game/adapters";
import {
  Direction,
  FIXED_TICK_SECONDS,
  ManifoldMode,
  TerrainType,
  type EntityKind,
  type InventoryCompartment,
  type ItemId,
  type RecipeId,
} from "../src/game/types";

const CARDINAL_DIRECTIONS = [
  Direction.North,
  Direction.East,
  Direction.South,
  Direction.West,
] as const;

const INSERTER_BELT_ORIENTATIONS = CARDINAL_DIRECTIONS.flatMap(
  (inserterDirection) =>
    CARDINAL_DIRECTIONS.flatMap((sourceDirection) =>
      CARDINAL_DIRECTIONS.map(
        (targetDirection) =>
          [
            inserterDirection,
            sourceDirection,
            targetDirection,
          ] as const,
      ),
    ),
);

function testDirectionVector(
  direction: Direction,
): readonly [number, number] {
  switch (direction) {
    case Direction.North:
      return [0, -1];
    case Direction.East:
      return [1, 0];
    case Direction.South:
      return [0, 1];
    case Direction.West:
      return [-1, 0];
  }
}

function blankSimulation(
  width = 32,
  height = 20,
  seed = 12345,
): FactorySimulation {
  return new FactorySimulation({
    width,
    height,
    seed,
    generateTerrain: false,
    generateResources: false,
    powerMode: "legacyGlobal",
  });
}

function poweredRecipeMachine(
  kind: "smelter" | "fabricator",
  recipeId?: RecipeId,
  fueled = true,
) {
  const simulation = blankSimulation(20, 14, 0xc07e);
  const machine = placeOrThrow(
    simulation,
    kind,
    3,
    4,
    Direction.East,
    recipeId === undefined ? {} : { recipeId },
  );
  const generator = placeOrThrow(
    simulation,
    "generator",
    13,
    4,
    Direction.East,
  );
  if (fueled) {
    expect(simulation.receive(generator.id, "coal", 10, "fuel")).toBe(10);
  }
  simulation.drainEvents();
  return { simulation, machine, generator };
}

function placeOrThrow(
  simulation: FactorySimulation,
  ...args: Parameters<FactorySimulation["place"]>
) {
  const placed = simulation.place(...args);
  if (!placed.ok) {
    throw new Error(`Placement failed: ${placed.reason}`);
  }
  return placed.entity;
}

function expectAtomicFailure(
  simulation: FactorySimulation,
  operation: () => unknown,
  message: string,
): void {
  const serializedBefore = simulation.serializeToString();
  const eventsBefore = simulation.peekEvents();
  expect(operation).toThrow(message);
  expect(simulation.serializeToString()).toBe(serializedBefore);
  expect(simulation.peekEvents()).toEqual(eventsBefore);
}

function feedTransportLane(
  simulation: FactorySimulation,
  entityId: number,
  item: ItemId,
  count: number,
  lane: 0 | 1,
): void {
  let accepted = 0;
  let guard = 0;
  while (accepted < count && guard < 10_000) {
    if (simulation.receive(entityId, item, 1, "belt", lane) === 1) {
      accepted += 1;
      simulation.step(8);
    } else {
      simulation.step();
    }
    guard += 1;
  }
  expect(accepted).toBe(count);
}

function eastManifold(
  simulation: FactorySimulation,
  x = 6,
  y = 6,
) {
  return placeOrThrow(
    simulation,
    "manifold",
    x,
    y,
    Direction.East,
  );
}

function poweredInserterNetwork(seed = 0x1a5e47, fueled = true) {
  const simulation = blankSimulation(18, 12, seed);
  const source = placeOrThrow(
    simulation,
    "belt",
    4,
    5,
    Direction.East,
  );
  const inserter = placeOrThrow(
    simulation,
    "inserter",
    5,
    5,
    Direction.East,
  );
  const target = placeOrThrow(
    simulation,
    "belt",
    6,
    5,
    Direction.East,
  );
  const generator = placeOrThrow(
    simulation,
    "generator",
    10,
    4,
    Direction.East,
  );
  if (fueled) {
    expect(simulation.receive(generator.id, "coal", 1, "fuel")).toBe(1);
  }
  expect(simulation.receive(source.id, "ironOre", 1, "belt", 0)).toBe(1);
  simulation.drainEvents();
  return { simulation, source, inserter, target, generator };
}

function stepUntil(
  simulation: FactorySimulation,
  predicate: () => boolean,
  maximumTicks = 240,
): void {
  for (let tick = 0; tick < maximumTicks && !predicate(); tick += 1) {
    simulation.step();
  }
  expect(predicate()).toBe(true);
}

function stepToInserterPickup(
  simulation: FactorySimulation,
  inserterId: number,
): number {
  let ticks = 0;
  while (
    simulation.getEntity(inserterId)?.heldItem === undefined &&
    ticks < 120
  ) {
    simulation.step();
    ticks += 1;
  }
  expect(simulation.getEntity(inserterId)).toMatchObject({
    heldItem: "ironOre",
    heldItemSourceLane: 0,
    armProgress: 0,
    armReturning: false,
  });
  return ticks;
}

describe("FactorySimulation production chain", () => {
  it("moves mined ore through belts, an inserter, a smelter, and storage", () => {
    const simulation = createDemoSimulation(0x51a7);
    const initialIron = simulation.stats().resourcesRemaining.iron;

    simulation.step(60 * 45);

    const storage = simulation.getEntities("storage")[0];
    expect(storage).toBeDefined();
    expect(storage?.inventory.ironPlate ?? 0).toBeGreaterThanOrEqual(5);

    const ledger = simulation.productionLedger();
    expect(ledger.ironOre).toBeGreaterThan(ledger.ironPlate);
    expect(ledger.ironPlate).toBeGreaterThanOrEqual(5);

    const stats = simulation.stats();
    expect(stats.resourcesRemaining.iron).toBeLessThan(initialIron);
    // The fifth Fabricator now receives real side-picked cargo instead of
    // remaining accidentally starved. The deliberately fixed three-generator
    // showcase therefore runs at a visible but non-blocking marginal load.
    expect(stats.power.capacityKW).toBe(2_700);
    expect(stats.power.satisfaction).toBeGreaterThan(0.96);
    expect(stats.objectives[0]?.complete).toBe(true);
    expect(stats.objectives[1]?.complete).toBe(true);

    const producedEvents = simulation
      .drainEvents()
      .filter((event) => event.type === "itemProduced");
    expect(
      producedEvents.some((event) => event.item === "ironPlate"),
    ).toBe(true);
  });

  it("seeds a dense, live multi-material showcase", () => {
    const simulation = createDemoSimulation(0xbeac0);
    const stats = simulation.stats();
    const snapshot = simulation.getRenderSnapshot();
    const mainBusItems = snapshot.entities
      .filter((entity) => entity.kind === "belt" && entity.x === 23)
      .reduce((total, entity) => total + entity.beltItems.length, 0);
    const returnSpineItems = snapshot.entities
      .filter((entity) => entity.kind === "belt" && entity.x === 28)
      .reduce((total, entity) => total + entity.beltItems.length, 0);
    const returnSpineCargo = snapshot.entities
      .filter((entity) => entity.kind === "belt" && entity.x === 28)
      .flatMap((entity) => entity.beltItems.map((item) => item.item));

    expect(snapshot.width).toBe(40);
    expect(snapshot.height).toBe(27);
    expect(stats.entityCounts.extractor).toBeGreaterThanOrEqual(4);
    expect(stats.entityCounts.smelter).toBe(4);
    expect(stats.entityCounts.fabricator).toBe(5);
    expect(stats.entityCounts.generator).toBe(3);
    expect(stats.entityCounts.beacon).toBeGreaterThanOrEqual(2);
    expect(stats.entityCounts.manifold).toBe(2);
    expect(stats.entityCounts.belt).toBeGreaterThanOrEqual(80);
    expect(stats.entityCounts.inserter).toBeGreaterThanOrEqual(24);
    expect(stats.beltItemCount).toBeGreaterThanOrEqual(240);
    expect(mainBusItems).toBeGreaterThanOrEqual(60);
    expect(returnSpineItems).toBeGreaterThanOrEqual(35);
    expect(
      returnSpineCargo.some(
        (item) =>
          item === "ironGear" || item === "circuit" || item === "copperPlate",
      ),
    ).toBe(true);
    expect(
      snapshot.entities.filter(
        (entity) => entity.kind === "smelter" && entity.status === "working",
      ),
    ).toHaveLength(4);
    expect(
      snapshot.entities.filter(
        (entity) => entity.kind === "fabricator" && entity.status === "working",
      ),
    ).toHaveLength(5);

    for (let y = 5; y <= 19; y += 1) {
      expect(simulation.getEntityAt(23, y)?.kind).toBe("belt");
    }
    for (let x = 25; x <= 28; x += 1) {
      expect(simulation.getEntityAt(x, 8)?.kind).toBe("belt");
    }
    for (let y = 8; y <= 17; y += 1) {
      expect(simulation.getEntityAt(28, y)?.kind).toBe("belt");
    }

    const bounds = snapshot.entities.reduce(
      (box, entity) => ({
        minX: Math.min(box.minX, entity.x),
        maxX: Math.max(box.maxX, entity.x + entity.width),
        minY: Math.min(box.minY, entity.y),
        maxY: Math.max(box.maxY, entity.y + entity.height),
      }),
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
    );
    expect(bounds).toEqual({ minX: 2, maxX: 35, minY: 3, maxY: 23 });

    expect(stats.produced.ironPlate).toBeGreaterThan(0);
    expect(stats.produced.copperPlate).toBeGreaterThan(0);
    expect(stats.produced.stoneBrick).toBeGreaterThan(0);
    expect(stats.produced.ironGear).toBeGreaterThanOrEqual(5);
    expect(stats.produced.copperWire).toBeGreaterThanOrEqual(10);
    expect(stats.produced.circuit).toBeGreaterThanOrEqual(5);
    expect(stats.produced.automationCore).toBeGreaterThanOrEqual(1);
    expect(simulation.getEntityAt(30, 10)).toMatchObject({
      kind: "fabricator",
      recipeId: "automationCore",
      status: "working",
    });
    expect(simulation.getEntityAt(16, 8)).toMatchObject({
      kind: "smelter",
      recipeId: "smeltCopper",
      status: "working",
    });
    expect(simulation.getEntityAt(16, 11)).toMatchObject({
      kind: "smelter",
      recipeId: "smeltCopper",
      status: "working",
    });
    expect(simulation.getEntityAt(18, 6)?.kind).toBe("beacon");
    expect(simulation.getEntityAt(13, 10)).toMatchObject({
      kind: "manifold",
      direction: Direction.East,
      manifoldRouting: { mode: ManifoldMode.Even },
    });
    expect(simulation.getEntityAt(14, 9)?.kind).toBe("belt");
    expect(simulation.getEntityAt(14, 8)?.kind).toBe("belt");
    expect(simulation.getEntityAt(15, 8)?.kind).toBe("inserter");
    expect(simulation.getEntityAt(18, 8)?.kind).toBe("inserter");
    expect(simulation.getEntityAt(19, 8)?.kind).toBe("belt");
    expect(simulation.getEntityAt(20, 8)?.kind).toBe("belt");
    expect(simulation.getEntityAt(20, 9)?.kind).toBe("belt");
    expect(simulation.getEntityAt(20, 10)).toMatchObject({
      kind: "manifold",
      direction: Direction.West,
      manifoldRouting: { mode: ManifoldMode.Even },
    });
    expect(simulation.getEntityAt(22, 10)).toMatchObject({
      kind: "belt",
      direction: Direction.South,
    });
    expect(simulation.getEntityAt(19, 12)?.kind).toBe("inserter");
    expect(simulation.getEntityAt(19, 13)).toMatchObject({
      kind: "belt",
      direction: Direction.West,
    });
    expect(simulation.getEntityAt(18, 13)?.kind).toBe("inserter");
    expect(simulation.getEntityAt(16, 13)).toMatchObject({
      kind: "fabricator",
      recipeId: "copperWire",
    });
    expect(simulation.getEntityAt(15, 14)?.kind).toBe("inserter");
    expect(simulation.getEntityAt(13, 13)?.kind).toBe("storage");
    expect(simulation.getEntityAt(29, 11)?.kind).toBe("inserter");
    expect(simulation.getEntityAt(32, 11)?.kind).toBe("inserter");
    expect(
      simulation.getEntityAt(33, 10)?.inventory.automationCore ?? 0,
    ).toBeGreaterThanOrEqual(1);
    // The corrected side-contact geometry keeps the fifth Fabricator working.
    // That deterministic added load deliberately runs this three-generator
    // showcase near capacity without crossing into a material brownout.
    expect(stats.power.satisfaction).toBeGreaterThan(0.96);
    expect(simulation.drainEvents()).toEqual([]);

    const mainCopperSmelter = simulation.getEntityAt(16, 11);
    const parallelCopperSmelter = simulation.getEntityAt(16, 8);
    const initialCourtyardWire = simulation.getEntityAt(13, 13)?.inventory.copperWire ?? 0;
    const fueledGenerator = simulation.getEntityAt(25, 21);
    const initialGeneratorCoal = fueledGenerator?.fuel.coal ?? 0;
    // Observe long enough for a plate to traverse the physical belt output
    // contact, complete both inserter strokes, and finish the wire recipe.
    simulation.step(60 * 40);

    const copperProducerIds = new Set(
      simulation
        .drainEvents()
        .filter(
          (event) =>
            event.type === "itemProduced" && event.item === "copperPlate",
        )
        .map((event) => event.entityId),
    );
    expect(copperProducerIds.has(mainCopperSmelter?.id)).toBe(true);
    expect(copperProducerIds.has(parallelCopperSmelter?.id)).toBe(true);
    expect(simulation.getEntityAt(13, 13)?.inventory.copperWire ?? 0).toBeGreaterThan(
      initialCourtyardWire,
    );
    expect(simulation.getEntityAt(25, 21)?.fuel.coal ?? 0).toBeGreaterThan(
      initialGeneratorCoal,
    );
    expect(simulation.stats().power.satisfaction).toBeGreaterThan(0.96);
  });

  it("holds every item under belt backpressure without duplication or loss", () => {
    const simulation = blankSimulation(18, 10);
    const beltIds = [2, 3, 4].map(
      (x) =>
        placeOrThrow(simulation, "belt", x, 4, Direction.East).id,
    );

    let accepted = 0;
    for (let tick = 0; tick < 900; tick += 1) {
      accepted += simulation.receive(beltIds[0]!, "ironOre", 2, "belt");
      simulation.step();
    }

    const stats = simulation.stats();
    expect(stats.beltItemCount).toBe(3 * 2 * 4);
    expect(accepted).toBe(stats.beltItemCount);
    expect(stats.stored.ironOre).toBe(accepted);

    for (const beltId of beltIds) {
      const belt = simulation.getEntity(beltId);
      expect(belt?.beltItems.length).toBe(8);
      for (const lane of [0, 1] as const) {
        const positions =
          belt?.beltItems
            .filter((item) => item.lane === lane)
            .map((item) => item.progress)
            .sort((a, b) => b - a) ?? [];
        expect(positions).toHaveLength(4);
        for (let index = 1; index < positions.length; index += 1) {
          expect(positions[index - 1]! - positions[index]!).toBeGreaterThanOrEqual(
            0.25 - 1e-7,
          );
        }
      }
    }

    expect(simulation.getEntity(beltIds.at(-1)!)?.status).toBe("blocked");
    expect(simulation.receive(beltIds[0]!, "ironOre", 1, "belt")).toBe(0);
  });
});

describe("FactorySimulation power", () => {
  function poweredExtractor(extraBeaconCount: number): FactorySimulation {
    const simulation = blankSimulation(48, 28, 700 + extraBeaconCount);
    for (let y = 2; y <= 5; y += 1) {
      for (let x = 2; x <= 5; x += 1) {
        simulation.setResource(x, y, "iron", 500);
      }
    }

    placeOrThrow(simulation, "extractor", 3, 3, Direction.East);
    placeOrThrow(simulation, "storage", 5, 3, Direction.East);
    const generator = placeOrThrow(
      simulation,
      "generator",
      19,
      3,
      Direction.East,
    );
    expect(simulation.receive(generator.id, "coal", 20, "fuel")).toBe(20);

    const beaconLocations = [
      [34, 2],
      [38, 2],
      [34, 7],
      [38, 7],
      [34, 12],
    ] as const;
    for (let index = 0; index < extraBeaconCount; index += 1) {
      const location = beaconLocations[index];
      if (!location) break;
      placeOrThrow(
        simulation,
        "beacon",
        location[0],
        location[1],
        Direction.East,
      );
    }
    simulation.drainEvents();
    return simulation;
  }

  it("slows consumers proportionally when generation is insufficient", () => {
    const fullPower = poweredExtractor(0);
    const starved = poweredExtractor(5);

    fullPower.step(60 * 20);
    starved.step(60 * 20);

    const fullOre = fullPower.productionLedger().ironOre;
    const starvedOre = starved.productionLedger().ironOre;
    expect(fullOre).toBeGreaterThan(starvedOre);

    const starvedStats = starved.stats();
    expect(starvedStats.power.capacityKW).toBe(
      ENTITY_PROTOTYPES.generator.generationCapacityKW,
    );
    expect(starvedStats.power.demandKW).toBeGreaterThan(
      starvedStats.power.capacityKW,
    );
    expect(starvedStats.power.satisfaction).toBeCloseTo(
      starvedStats.power.capacityKW / starvedStats.power.demandKW,
      8,
    );

    const extractor = starved.getEntities("extractor")[0];
    expect(extractor?.powerSatisfaction).toBeCloseTo(
      starvedStats.power.satisfaction,
      8,
    );
  });

  for (const powerMode of ["legacyGlobal", "local"] as const) {
    it(`bridges an active-coal boundary from a stocked hopper in ${powerMode} power`, () => {
      const simulation = new FactorySimulation({
        width: 24,
        height: 16,
        seed: 0xc0a1,
        generateTerrain: false,
        generateResources: false,
        powerMode,
      });
      if (powerMode === "local") {
        placeOrThrow(simulation, "gridRelay", 7, 6, Direction.North);
      }
      const generator = placeOrThrow(
        simulation,
        "generator",
        3,
        3,
        Direction.North,
      );
      placeOrThrow(simulation, "beacon", 9, 3, Direction.North);
      expect(simulation.receive(generator.id, "coal", 1, "fuel")).toBe(1);

      const boundaryState = simulation.serialize();
      const serializedGenerator = boundaryState.entities.find(
        (entity) => entity.id === generator.id,
      );
      if (!serializedGenerator) throw new Error("Generator state is missing.");
      serializedGenerator.fuelEnergyKJ = 0.1;
      const boundaryEnergyKJ = 0.1 + COAL_ENERGY_KJ;
      const restored = FactorySimulation.restore(boundaryState);

      restored.step();

      const stats = restored.stats();
      expect(stats.power.capacityKW).toBe(
        ENTITY_PROTOTYPES.generator.generationCapacityKW,
      );
      expect(stats.power.satisfaction).toBe(1);
      expect(restored.getEntity(generator.id)?.fuel.coal ?? 0).toBe(0);
      expect(stats.power.storedFuelKJ).toBeCloseTo(
        boundaryEnergyKJ - stats.power.usedKW * FIXED_TICK_SECONDS,
        10,
      );
      expect(() =>
        FactorySimulation.restore(restored.serialize()),
      ).not.toThrow();
    });
  }
});

describe("FactorySimulation local power grids", () => {
  function localSimulation(
    width = 40,
    height = 24,
    seed = 0x10ca1,
  ): FactorySimulation {
    return new FactorySimulation({
      width,
      height,
      seed,
      generateTerrain: false,
      generateResources: false,
    });
  }

  function fueledGenerator(
    simulation: FactorySimulation,
    x: number,
    y: number,
    amount = 20,
  ) {
    const generator = placeOrThrow(
      simulation,
      "generator",
      x,
      y,
      Direction.North,
    );
    expect(simulation.receive(generator.id, "coal", amount, "fuel")).toBe(
      amount,
    );
    return generator;
  }

  it("defaults fresh worlds to local power and leaves uncovered consumers at zero", () => {
    const simulation = localSimulation(24, 16);
    const generator = fueledGenerator(simulation, 2, 2);
    const beacon = placeOrThrow(
      simulation,
      "beacon",
      16,
      2,
      Direction.North,
    );

    simulation.step();

    expect(simulation.currentPowerMode).toBe("local");
    expect(simulation.getEntity(beacon.id)?.powerSatisfaction).toBe(0);
    expect(simulation.getEntity(generator.id)?.generatedPowerKW).toBe(0);
    expect(simulation.stats().power).toMatchObject({
      mode: "local",
      demandKW: ENTITY_PROTOTYPES.beacon.powerDemandKW,
      usedKW: 0,
      satisfaction: 0,
      disconnectedDemandKW: ENTITY_PROTOTYPES.beacon.powerDemandKW,
      disconnectedCapacityKW:
        ENTITY_PROTOTYPES.generator.generationCapacityKW,
    });
    expect(
      simulation.powerGridSnapshot().assignments.every(
        (assignment) => assignment.networkId === null,
      ),
    ).toBe(true);
  });

  it("uses inclusive square coverage at the exact five-tile center boundary", () => {
    const simulation = localSimulation(20, 14);
    const relay = placeOrThrow(
      simulation,
      "gridRelay",
      5,
      5,
      Direction.North,
    );
    fueledGenerator(simulation, 1, 4);
    placeOrThrow(simulation, "belt", 9, 5, Direction.East);
    const inserter = placeOrThrow(
      simulation,
      "inserter",
      10,
      5,
      Direction.East,
    );

    simulation.step();

    const assignment = simulation
      .powerGridSnapshot()
      .assignments.find((entry) => entry.entityId === inserter.id);
    expect(assignment).toEqual({
      entityId: inserter.id,
      role: "consumer",
      relayId: relay.id,
      networkId: relay.id,
    });
    expect(simulation.getEntity(inserter.id)?.powerSatisfaction).toBe(1);
  });

  it("isolates brownouts between disconnected relay components", () => {
    const simulation = localSimulation(40, 20);
    const relayA = placeOrThrow(
      simulation,
      "gridRelay",
      5,
      5,
      Direction.North,
    );
    fueledGenerator(simulation, 1, 1);
    const gridABeacons = [
      [6, 0],
      [8, 2],
      [1, 5],
      [3, 8],
      [7, 7],
      [9, 5],
    ] as const;
    for (const [x, y] of gridABeacons) {
      placeOrThrow(simulation, "beacon", x, y, Direction.North);
    }

    const relayB = placeOrThrow(
      simulation,
      "gridRelay",
      25,
      5,
      Direction.North,
    );
    fueledGenerator(simulation, 21, 1);
    const isolatedBeacon = placeOrThrow(
      simulation,
      "beacon",
      26,
      2,
      Direction.North,
    );

    simulation.step();

    const stats = simulation.stats();
    expect(stats.power.networks).toHaveLength(2);
    expect(stats.power.networks.find(
      (network) => network.networkId === relayA.id,
    )?.satisfaction).toBeCloseTo(0.75, 10);
    expect(stats.power.networks.find(
      (network) => network.networkId === relayB.id,
    )?.satisfaction).toBe(1);
    expect(
      simulation.getEntity(isolatedBeacon.id)?.powerSatisfaction,
    ).toBe(1);
  });

  it("allocates same-network generators deterministically by ascending ID", () => {
    const simulation = localSimulation(24, 20);
    placeOrThrow(simulation, "gridRelay", 10, 8, Direction.North);
    const first = fueledGenerator(simulation, 6, 4);
    const second = fueledGenerator(simulation, 6, 10);
    for (const [x, y] of [
      [10, 3],
      [12, 5],
      [13, 8],
      [11, 11],
      [8, 12],
    ] as const) {
      placeOrThrow(simulation, "beacon", x, y, Direction.North);
    }

    simulation.step();

    expect(simulation.stats().power.demandKW).toBe(1_000);
    expect(simulation.getEntity(first.id)?.generatedPowerKW).toBe(900);
    expect(simulation.getEntity(second.id)?.generatedPowerKW).toBe(100);
    expect(simulation.stats().power.satisfaction).toBe(1);
  });

  it("keeps transport, storage, and relays passive with zero demand", () => {
    const simulation = localSimulation(20, 14);
    placeOrThrow(simulation, "gridRelay", 4, 4, Direction.North);
    placeOrThrow(simulation, "belt", 7, 4, Direction.East);
    placeOrThrow(simulation, "manifold", 8, 4, Direction.East);
    placeOrThrow(simulation, "storage", 11, 4, Direction.North);

    simulation.step();

    expect(simulation.stats().power.demandKW).toBe(0);
    expect(simulation.powerGridSnapshot().assignments).toEqual([]);
  });

  it("breaks equal-distance assignment ties with the lower relay ID", () => {
    const simulation = localSimulation(24, 14);
    const lowerId = placeOrThrow(
      simulation,
      "gridRelay",
      4,
      4,
      Direction.North,
    );
    const higherId = placeOrThrow(
      simulation,
      "gridRelay",
      12,
      4,
      Direction.North,
    );
    const consumer = placeOrThrow(
      simulation,
      "inserter",
      8,
      4,
      Direction.East,
    );

    const grid = simulation.powerGridSnapshot();
    expect(new Set(grid.relays.map((relay) => relay.networkId)).size).toBe(2);
    expect(
      grid.assignments.find((entry) => entry.entityId === consumer.id),
    ).toMatchObject({
      relayId: lowerId.id,
      networkId: lowerId.id,
    });
    expect(higherId.id).toBeGreaterThan(lowerId.id);
  });

  it("invalidates topology only after successful spatial mutations", () => {
    const simulation = localSimulation(24, 18);
    placeOrThrow(simulation, "gridRelay", 8, 8, Direction.North);
    simulation.powerGridSnapshot();
    expect(simulation.powerDiagnostics()).toMatchObject({
      topologyRebuildCount: 1,
      topologyDirty: false,
    });

    simulation.step(120);
    expect(simulation.powerDiagnostics().topologyRebuildCount).toBe(1);
    expect(
      simulation.place("belt", 8, 8, Direction.East).ok,
    ).toBe(false);
    expect(simulation.powerDiagnostics()).toMatchObject({
      topologyRebuildCount: 1,
      topologyDirty: false,
    });

    const belt = placeOrThrow(
      simulation,
      "belt",
      15,
      8,
      Direction.East,
    );
    expect(simulation.powerDiagnostics().topologyDirty).toBe(true);
    simulation.powerGridSnapshot();
    expect(simulation.powerDiagnostics().topologyRebuildCount).toBe(2);

    expect(simulation.rotate(15, 8, true).ok).toBe(true);
    simulation.powerGridSnapshot();
    expect(simulation.powerDiagnostics().topologyRebuildCount).toBe(3);

    expect(simulation.remove(belt.x, belt.y)?.id).toBe(belt.id);
    simulation.powerGridSnapshot();
    expect(simulation.powerDiagnostics().topologyRebuildCount).toBe(4);
  });

  it("publishes one coherent paused snapshot immediately after relay removal", () => {
    const simulation = localSimulation(24, 16);
    const relay = placeOrThrow(
      simulation,
      "gridRelay",
      8,
      6,
      Direction.North,
    );
    const generator = fueledGenerator(simulation, 4, 4);
    const beacon = placeOrThrow(
      simulation,
      "beacon",
      9,
      4,
      Direction.North,
    );
    simulation.step();
    expect(simulation.getEntity(beacon.id)?.powerSatisfaction).toBe(1);
    expect(simulation.powerDiagnostics().topologyRebuildCount).toBe(1);
    const fuelBeforeSnapshot =
      simulation.getEntity(generator.id)?.fuelEnergyKJ;

    expect(simulation.remove(relay.x, relay.y)?.id).toBe(relay.id);
    expect(simulation.powerDiagnostics().topologyDirty).toBe(true);
    const eventsBeforeSnapshot = simulation.peekEvents();

    const snapshot = simulation.getRenderSnapshot();
    const renderedBeacon = snapshot.entities.find(
      (entity) => entity.id === beacon.id,
    );
    const renderedGenerator = snapshot.entities.find(
      (entity) => entity.id === generator.id,
    );
    const beaconAssignment = snapshot.powerGrid.assignments.find(
      (assignment) => assignment.entityId === beacon.id,
    );
    expect(renderedBeacon).toMatchObject({
      powerSatisfaction: 0,
      status: "noPower",
    });
    expect(renderedGenerator).toMatchObject({
      generatedPowerKW: 0,
      status: "idle",
    });
    expect(beaconAssignment).toMatchObject({
      relayId: null,
      networkId: null,
    });
    expect(snapshot.power).toMatchObject({
      satisfaction: 0,
      usedKW: 0,
      disconnectedDemandKW: ENTITY_PROTOTYPES.beacon.powerDemandKW,
      disconnectedCapacityKW:
        ENTITY_PROTOTYPES.generator.generationCapacityKW,
    });
    expect(simulation.stats().power).toEqual(snapshot.power);
    expect(simulation.getEntity(beacon.id)?.powerSatisfaction).toBe(0);
    expect(simulation.getEntity(generator.id)?.fuelEnergyKJ).toBe(
      fuelBeforeSnapshot,
    );
    expect(simulation.peekEvents()).toEqual(eventsBeforeSnapshot);
    expect(simulation.powerDiagnostics()).toMatchObject({
      topologyRebuildCount: 2,
      topologyDirty: false,
    });
  });

  it("reassigns a rectangular consumer when an occupied tile enters coverage", () => {
    const simulation = localSimulation(20, 16);
    const relay = placeOrThrow(
      simulation,
      "gridRelay",
      11,
      5,
      Direction.North,
    );
    fueledGenerator(simulation, 12, 1);
    const fabricator = placeOrThrow(
      simulation,
      "fabricator",
      4,
      4,
      Direction.East,
    );

    expect(
      simulation.powerGridSnapshot().assignments.find(
        (entry) => entry.entityId === fabricator.id,
      )?.networkId,
    ).toBeNull();
    expect(simulation.rotate(fabricator.x, fabricator.y, true).ok).toBe(
      true,
    );
    expect(
      simulation.powerGridSnapshot().assignments.find(
        (entry) => entry.entityId === fabricator.id,
      ),
    ).toMatchObject({ relayId: relay.id, networkId: relay.id });
  });

  it("keeps a failed rotation topology- and serialization-atomic", () => {
    const simulation = localSimulation(20, 16);
    placeOrThrow(simulation, "gridRelay", 11, 5, Direction.North);
    const fabricator = placeOrThrow(
      simulation,
      "fabricator",
      5,
      4,
      Direction.East,
    );
    placeOrThrow(simulation, "belt", 7, 4, Direction.East);
    simulation.powerGridSnapshot();
    const before = simulation.serializeToString();
    const diagnosticsBefore = simulation.powerDiagnostics();

    expect(simulation.rotate(fabricator.x, fabricator.y, true)).toMatchObject({
      ok: false,
      reason: "occupied",
    });
    expect(simulation.serializeToString()).toBe(before);
    expect(simulation.powerDiagnostics()).toEqual(diagnosticsBefore);
  });

  it("keeps dynamic recipe and fuel changes off the topology rebuild path", () => {
    const simulation = localSimulation(24, 16);
    placeOrThrow(simulation, "gridRelay", 8, 6, Direction.North);
    const generator = placeOrThrow(
      simulation,
      "generator",
      4,
      4,
      Direction.North,
    );
    const fabricator = placeOrThrow(
      simulation,
      "fabricator",
      8,
      8,
      Direction.North,
    );
    simulation.powerGridSnapshot();
    expect(simulation.receive(generator.id, "coal", 2, "fuel")).toBe(2);
    expect(
      simulation.requestRecipeChange(fabricator.id, "ironGear"),
    ).toMatchObject({ ok: true, outcome: "applied" });
    simulation.step(30);
    expect(simulation.powerDiagnostics().topologyRebuildCount).toBe(1);
  });

  it("round-trips local mode and detached frozen topology exactly", () => {
    const simulation = localSimulation(24, 16);
    placeOrThrow(simulation, "gridRelay", 8, 6, Direction.North);
    const generator = fueledGenerator(simulation, 4, 4);
    placeOrThrow(simulation, "beacon", 9, 4, Direction.North);
    simulation.step(30);

    const serialized = simulation.serialize();
    const restored = FactorySimulation.restore(
      structuredClone(serialized),
    );
    expect(restored.serialize()).toEqual(serialized);
    expect(restored.currentPowerMode).toBe("local");
    expect(restored.powerGridSnapshot()).toEqual(
      simulation.powerGridSnapshot(),
    );

    const grid = restored.powerGridSnapshot();
    expect(Object.isFrozen(grid)).toBe(true);
    expect(Object.isFrozen(grid.relays)).toBe(true);
    expect(Object.isFrozen(grid.relays[0])).toBe(true);
    expect(() =>
      (grid.relays as unknown as Array<unknown>).push({}),
    ).toThrow();
    expect(restored.getEntity(generator.id)?.fuel.coal).toBe(
      simulation.getEntity(generator.id)?.fuel.coal,
    );
  });

  it("migrates v4 to the exact legacy-global behavior and rejects bad v5 modes", () => {
    const source = blankSimulation(24, 16);
    const generator = fueledGenerator(source, 2, 2);
    const beacon = placeOrThrow(
      source,
      "beacon",
      16,
      2,
      Direction.North,
    );
    source.step();
    const v4 = structuredClone(source.serialize()) as unknown as Record<
      string,
      unknown
    >;
    v4.version = 4;
    v4.catalogVersion = "cinderline-4";
    delete v4.powerMode;

    const migrated = FactorySimulation.restore(v4 as never);
    expect(migrated.currentPowerMode).toBe("legacyGlobal");
    expect(migrated.getEntities("gridRelay")).toEqual([]);
    migrated.step();
    expect(migrated.getEntity(beacon.id)?.powerSatisfaction).toBe(1);
    expect(migrated.getEntity(generator.id)?.generatedPowerKW).toBeGreaterThan(
      0,
    );

    for (const mode of [undefined, null, "global", 1]) {
      const corrupt = structuredClone(
        source.serialize(),
      ) as unknown as Record<string, unknown>;
      corrupt.powerMode = mode;
      expect(() => FactorySimulation.restore(corrupt as never)).toThrow();
    }
  });

  it("rejects state owned by another entity on grid relays", () => {
    const simulation = localSimulation(18, 14);
    const relay = placeOrThrow(
      simulation,
      "gridRelay",
      5,
      5,
      Direction.North,
    );
    const base = simulation.serialize();
    const relayIndex = base.entities.findIndex(
      (entity) => entity.id === relay.id,
    );
    for (const mutation of [
      (entity: (typeof base.entities)[number]) => {
        entity.animationPhase = 0.25;
      },
      (entity: (typeof base.entities)[number]) => {
        entity.inventory.ironOre = 1;
      },
      (entity: (typeof base.entities)[number]) => {
        entity.generatedPowerKW = 1;
      },
      ...(["working", "noPower", "noFuel", "blocked"] as const).map(
        (status) => (entity: (typeof base.entities)[number]) => {
          entity.status = status;
        },
      ),
      (entity: (typeof base.entities)[number]) => {
        entity.powerSatisfaction = 0.5;
      },
    ]) {
      const corrupt = structuredClone(base);
      mutation(corrupt.entities[relayIndex]!);
      expect(() => FactorySimulation.restore(corrupt)).toThrow();
    }
  });

  it("retrofits legacy saves explicitly and atomically only after full coverage", () => {
    const simulation = blankSimulation(40, 20);
    const generator = fueledGenerator(simulation, 2, 2);
    const beacon = placeOrThrow(
      simulation,
      "beacon",
      30,
      2,
      Direction.North,
    );
    const generatorRelay = placeOrThrow(
      simulation,
      "gridRelay",
      3,
      6,
      Direction.North,
    );
    expect(simulation.currentPowerMode).toBe("legacyGlobal");
    const incompleteCandidate = simulation.powerGridSnapshot();
    expect(incompleteCandidate).toMatchObject({
      mode: "legacyGlobal",
      relays: [
        expect.objectContaining({
          id: generatorRelay.id,
          networkId: generatorRelay.id,
        }),
      ],
    });
    expect(
      incompleteCandidate.assignments.find(
        (assignment) => assignment.entityId === generator.id,
      ),
    ).toMatchObject({
      relayId: generatorRelay.id,
      networkId: generatorRelay.id,
    });
    expect(
      incompleteCandidate.assignments.find(
        (assignment) => assignment.entityId === beacon.id,
      ),
    ).toMatchObject({ relayId: null, networkId: null });

    const serializedBefore = simulation.serializeToString();
    const entitiesBefore = simulation.getEntities();
    const eventsBefore = simulation.peekEvents();
    expect(simulation.retrofitLocalPower()).toEqual({
      ok: false,
      outcome: "uncovered",
      uncoveredEntityIds: [beacon.id],
    });
    expect(simulation.serializeToString()).toBe(serializedBefore);
    expect(simulation.getEntities()).toEqual(entitiesBefore);
    expect(simulation.peekEvents()).toEqual(eventsBefore);
    expect(simulation.getEntity(generator.id)?.fuel.coal).toBe(20);

    const beaconRelay = placeOrThrow(
      simulation,
      "gridRelay",
      30,
      6,
      Direction.North,
    );
    expect(simulation.currentPowerMode).toBe("legacyGlobal");
    const completeCandidate = simulation.getRenderSnapshot();
    expect(completeCandidate.power.mode).toBe("legacyGlobal");
    expect(completeCandidate.powerGrid.mode).toBe("legacyGlobal");
    expect(
      completeCandidate.powerGrid.assignments.find(
        (assignment) => assignment.entityId === beacon.id,
      ),
    ).toMatchObject({
      relayId: beaconRelay.id,
      networkId: beaconRelay.id,
    });
    expect(
      completeCandidate.entities.find((entity) => entity.id === beacon.id),
    ).toMatchObject({
      powerRelayId: beaconRelay.id,
      powerNetworkId: beaconRelay.id,
    });
    expect(simulation.retrofitLocalPower()).toEqual({
      ok: true,
      outcome: "applied",
    });
    expect(simulation.currentPowerMode).toBe("local");
    expect(simulation.getEntity(beacon.id)).toMatchObject({
      powerSatisfaction: 0,
      status: "noPower",
    });
    expect(simulation.getEntity(generator.id)).toMatchObject({
      generatedPowerKW: 0,
      status: "idle",
    });
    expect(simulation.stats().power).toMatchObject({
      mode: "local",
      satisfaction: 0,
      usedKW: 0,
      disconnectedDemandKW: 0,
      disconnectedCapacityKW: 0,
    });
    expect(
      simulation
        .powerGridSnapshot()
        .assignments.find((assignment) => assignment.entityId === beacon.id),
    ).toMatchObject({
      networkId: expect.any(Number),
    });
    const afterApplied = simulation.serializeToString();
    expect(simulation.retrofitLocalPower()).toEqual({
      ok: true,
      outcome: "alreadyLocal",
    });
    expect(simulation.serializeToString()).toBe(afterApplied);
    expect(
      FactorySimulation.restore(simulation.serialize()).currentPowerMode,
    ).toBe("local");
  });

  it("withdraws only physically stored Uplink cargo without emitting a duplicate event", () => {
    const simulation = localSimulation(18, 14);
    const storage = placeOrThrow(
      simulation,
      "storage",
      5,
      5,
      Direction.North,
    );
    expect(simulation.receive(storage.id, "ironPlate", 3, "inventory")).toBe(
      3,
    );
    simulation.drainEvents();

    expect(simulation.withdrawStorage(storage.id, "ironPlate", 2)).toBe(2);
    expect(simulation.getEntity(storage.id)?.inventory.ironPlate).toBe(1);
    expect(simulation.withdrawStorage(storage.id, "ironPlate", 5)).toBe(1);
    expect(simulation.withdrawStorage(storage.id, "ironPlate", 1)).toBe(0);
    expect(simulation.peekEvents()).toEqual([]);
  });

  it("withdraws one deterministic player-accessible payload for manual transfers", () => {
    const simulation = localSimulation(24, 16);
    const storage = placeOrThrow(
      simulation,
      "storage",
      3,
      3,
      Direction.North,
    );
    const belt = placeOrThrow(
      simulation,
      "belt",
      8,
      3,
      Direction.East,
    );
    const generator = placeOrThrow(
      simulation,
      "generator",
      13,
      3,
      Direction.North,
    );
    expect(simulation.receive(storage.id, "coal", 2, "inventory")).toBe(2);
    expect(simulation.receive(belt.id, "coal", 1, "belt", 0)).toBe(1);
    expect(simulation.receive(generator.id, "coal", 2, "fuel")).toBe(2);
    simulation.drainEvents();
    const storedBefore = simulation.stats().stored.coal;

    expect(simulation.withdrawAccessibleItem(storage.id, "coal")).toBe(true);
    expect(simulation.getEntity(storage.id)?.inventory.coal).toBe(1);
    expect(simulation.withdrawAccessibleItem(belt.id, "coal")).toBe(true);
    expect(simulation.getEntity(belt.id)?.beltItems).toHaveLength(0);
    expect(simulation.withdrawAccessibleItem(generator.id, "coal")).toBe(true);
    expect(simulation.getEntity(generator.id)?.fuel.coal).toBe(1);
    expect(simulation.withdrawAccessibleItem(storage.id, "circuit")).toBe(false);
    expect(simulation.withdrawAccessibleItem(999_999, "coal")).toBe(false);
    expect(simulation.stats().stored.coal).toBe(storedBefore - 3);
    expect(simulation.peekEvents()).toEqual([]);
    expect(() =>
      FactorySimulation.restore(simulation.serialize()),
    ).not.toThrow();
  });
});

describe("FactorySimulation determinism and persistence", () => {
  it("continues bit-for-bit from a serialized fixed-step state", () => {
    const uninterrupted = createDemoSimulation(0xd371);
    uninterrupted.tick(12.347);
    uninterrupted.tick(0.013);

    const serialized = uninterrupted.serialize();
    const restored = FactorySimulation.restore(
      JSON.parse(JSON.stringify(serialized)),
    );
    expect(restored.serialize()).toEqual(serialized);

    const deltas = [0.001, 0.25, 1 / 144, 3.7, 0.4, 8.125, 1 / 30];
    for (const delta of deltas) {
      uninterrupted.tick(delta);
      restored.tick(delta);
    }

    expect(restored.serialize()).toEqual(uninterrupted.serialize());
    expect(restored.stats()).toEqual(uninterrupted.stats());
  });

  it("is independent of render-frame grouping", () => {
    const fine = createDemoSimulation(991);
    const coarse = createDemoSimulation(991);

    for (let frame = 0; frame < 600; frame += 1) fine.tick(1 / 60);
    coarse.tick(10);

    expect(coarse.serialize()).toEqual(fine.serialize());
  });
});

describe("FactorySimulation placement invariants", () => {
  it("enforces footprints, bounds, water, resources, rotation, and removal", () => {
    const simulation = blankSimulation(16, 14);

    const missingResource = simulation.place(
      "extractor",
      1,
      1,
      Direction.East,
    );
    expect(missingResource).toMatchObject({
      ok: false,
      reason: "requiresResource",
    });

    simulation.setResource(2, 2, "copper", 100);
    const extractor = placeOrThrow(
      simulation,
      "extractor",
      1,
      1,
      Direction.East,
    );
    expect(simulation.getEntityAt(1, 1)?.id).toBe(extractor.id);
    expect(simulation.getEntityAt(2, 2)?.id).toBe(extractor.id);

    expect(
      simulation.place("belt", 2, 2, Direction.East),
    ).toMatchObject({ ok: false, reason: "occupied" });
    expect(
      simulation.place("storage", 15, 13, Direction.East),
    ).toMatchObject({ ok: false, reason: "outOfBounds" });

    expect(simulation.setTerrain(7, 7, TerrainType.Water)).toBe(true);
    expect(
      simulation.place("belt", 7, 7, Direction.East),
    ).toMatchObject({ ok: false, reason: "water" });

    const fabricator = placeOrThrow(
      simulation,
      "fabricator",
      6,
      2,
      Direction.North,
      { recipeId: "circuit" },
    );
    expect(fabricator.width).toBe(3);
    expect(fabricator.height).toBe(2);
    expect(simulation.getEntityAt(8, 3)?.id).toBe(fabricator.id);

    placeOrThrow(simulation, "belt", 6, 4, Direction.East);
    const rejectedRotation = simulation.rotate(6, 2, true);
    expect(rejectedRotation).toMatchObject({
      ok: false,
      reason: "occupied",
    });
    expect(simulation.getEntity(fabricator.id)?.direction).toBe(Direction.North);
    expect(simulation.getEntityAt(8, 3)?.id).toBe(fabricator.id);

    const removed = simulation.remove(2, 2);
    expect(removed?.id).toBe(extractor.id);
    expect(simulation.getEntityAt(1, 1)).toBeUndefined();
    expect(simulation.getEntityAt(2, 2)).toBeUndefined();
  });

  it("rejects incompatible recipes and keeps transfer helpers atomic", () => {
    const simulation = blankSimulation();
    expect(
      simulation.place("smelter", 2, 2, Direction.East, {
        recipeId: "circuit",
      }),
    ).toMatchObject({ ok: false, reason: "invalidRecipe" });

    const source = placeOrThrow(
      simulation,
      "storage",
      2,
      2,
      Direction.East,
    );
    const target = placeOrThrow(
      simulation,
      "generator",
      7,
      2,
      Direction.East,
    );
    expect(simulation.receive(source.id, "ironOre", 3)).toBe(3);
    expect(simulation.transfer(source.id, target.id, "ironOre", 1)).toEqual({
      item: "ironOre",
      moved: 0,
    });
    expect(simulation.getEntity(source.id)?.inventory.ironOre).toBe(3);

    expect(simulation.receive(source.id, "coal", 2)).toBe(2);
    expect(simulation.transfer(source.id, target.id, "coal", 2)).toEqual({
      item: "coal",
      moved: 2,
    });
    expect(simulation.getEntity(target.id)?.fuel.coal).toBe(2);
  });
});

describe("Machine recipe transitions", () => {
  it("exposes stable typed outcomes and leaves player fabricators unconfigured", () => {
    const simulation = blankSimulation();
    const fabricator = placeOrThrow(
      simulation,
      "fabricator",
      2,
      2,
      Direction.East,
    );
    const smelter = placeOrThrow(
      simulation,
      "smelter",
      8,
      2,
      Direction.East,
    );
    const storage = placeOrThrow(
      simulation,
      "storage",
      13,
      2,
      Direction.East,
    );

    expect(fabricator).toMatchObject({
      status: "unconfigured",
      recipeChangeQueued: false,
      reclaim: {},
    });
    expect(fabricator.recipeId).toBeUndefined();
    simulation.step();
    expect(simulation.getEntity(fabricator.id)?.status).toBe("unconfigured");

    expect(
      simulation.requestRecipeChange(999_999, "ironGear"),
    ).toEqual({
      ok: false,
      outcome: "rejected",
      reason: "notFound",
    });
    expect(
      simulation.requestRecipeChange(storage.id, "ironGear"),
    ).toEqual({
      ok: false,
      outcome: "rejected",
      reason: "notMachine",
    });
    expect(simulation.requestRecipeChange(fabricator.id, null)).toEqual({
      ok: false,
      outcome: "rejected",
      reason: "requiresRecipe",
    });
    expect(
      simulation.requestRecipeChange(fabricator.id, "smeltIron"),
    ).toEqual({
      ok: false,
      outcome: "rejected",
      reason: "invalidRecipe",
    });
    expect(
      simulation.requestRecipeChange(
        fabricator.id,
        "notARecipe" as never,
      ),
    ).toEqual({
      ok: false,
      outcome: "rejected",
      reason: "invalidRecipe",
    });
    expect(
      simulation.requestRecipeChange(fabricator.id, "copperWire"),
    ).toEqual({
      ok: true,
      outcome: "applied",
      recipeId: "copperWire",
    });
    expect(
      simulation.requestRecipeChange(fabricator.id, "copperWire"),
    ).toEqual({
      ok: true,
      outcome: "unchanged",
      recipeId: "copperWire",
    });
    expect(simulation.setRecipe(fabricator.id, "ironGear")).toBe(true);
    expect(simulation.setRecipe(fabricator.id, "smeltIron")).toBe(false);

    expect(simulation.requestRecipeChange(smelter.id, null)).toEqual({
      ok: true,
      outcome: "unchanged",
      recipeId: null,
    });
    expect(
      simulation.requestRecipeChange(smelter.id, "circuit"),
    ).toEqual({
      ok: false,
      outcome: "rejected",
      reason: "invalidRecipe",
    });
  });

  it("applies idle changes atomically, reclaims every old input, and strictly gates auto input", () => {
    const { simulation, machine } = poweredRecipeMachine(
      "fabricator",
      "ironGear",
    );
    expect(simulation.receive(machine.id, "ironPlate", 3, "input")).toBe(3);
    expect(simulation.receive(machine.id, "copperPlate", 2, "input")).toBe(2);
    expect(simulation.receive(machine.id, "automationCore", 1, "output")).toBe(1);

    expect(
      simulation.requestRecipeChange(machine.id, "copperWire"),
    ).toEqual({
      ok: true,
      outcome: "applied",
      recipeId: "copperWire",
    });
    expect(simulation.getEntity(machine.id)).toMatchObject({
      recipeId: "copperWire",
      input: {},
      reclaim: { ironPlate: 3, copperPlate: 2 },
      output: { automationCore: 1 },
      progress: 0,
      recipeChangeQueued: false,
      status: "changingRecipe",
    });
    expect(simulation.stats().stored).toMatchObject({
      ironPlate: 3,
      copperPlate: 2,
      automationCore: 1,
    });

    expect(simulation.receive(machine.id, "ironPlate", 1)).toBe(0);
    expect(simulation.receive(machine.id, "copperPlate", 1)).toBe(1);
    expect(simulation.receive(machine.id, "copperWire", 1)).toBe(0);

    const storage = placeOrThrow(
      simulation,
      "storage",
      9,
      8,
      Direction.East,
    );
    expect(simulation.transfer(machine.id, storage.id)).toEqual({
      item: "ironPlate",
      moved: 1,
    });
    expect(simulation.getEntity(machine.id)?.reclaim.ironPlate).toBe(2);
    expect(simulation.getEntity(machine.id)?.output.automationCore).toBe(1);
  });

  it("queues an in-flight change, lets the latest request win, and completes the old craft exactly once", () => {
    const { simulation, machine } = poweredRecipeMachine(
      "fabricator",
      "ironGear",
    );
    expect(simulation.receive(machine.id, "ironPlate", 5, "input")).toBe(5);
    simulation.step();
    expect(simulation.getEntity(machine.id)).toMatchObject({
      activeRecipeId: "ironGear",
      input: { ironPlate: 3 },
    });

    expect(
      simulation.requestRecipeChange(machine.id, "copperWire"),
    ).toEqual({
      ok: true,
      outcome: "queued",
      recipeId: "copperWire",
    });
    expect(
      simulation.requestRecipeChange(machine.id, "copperWire"),
    ).toEqual({
      ok: true,
      outcome: "unchanged",
      recipeId: "copperWire",
    });
    expect(
      simulation.requestRecipeChange(machine.id, "circuit"),
    ).toEqual({
      ok: true,
      outcome: "queued",
      recipeId: "circuit",
    });
    expect(
      simulation.requestRecipeChange(machine.id, "ironGear"),
    ).toEqual({
      ok: true,
      outcome: "applied",
      recipeId: "ironGear",
    });
    expect(simulation.getEntity(machine.id)?.recipeChangeQueued).toBe(false);
    expect(
      simulation.requestRecipeChange(machine.id, "copperWire"),
    ).toMatchObject({ ok: true, outcome: "queued" });

    expect(simulation.receive(machine.id, "copperPlate", 1)).toBe(0);
    expect(simulation.receive(machine.id, "copperPlate", 1, "input")).toBe(0);
    expect(simulation.getEntity(machine.id)).toMatchObject({
      recipeId: "ironGear",
      activeRecipeId: "ironGear",
      pendingRecipeId: "copperWire",
      recipeChangeQueued: true,
      input: { ironPlate: 3 },
    });

    stepUntil(
      simulation,
      () =>
        simulation.getEntity(machine.id)?.recipeId === "copperWire" &&
        simulation.getEntity(machine.id)?.recipeChangeQueued === false,
      120,
    );
    expect(simulation.getEntity(machine.id)).toMatchObject({
      recipeId: "copperWire",
      input: {},
      reclaim: { ironPlate: 3 },
      output: { ironGear: 1 },
      progress: 0,
      recipeChangeQueued: false,
      status: "changingRecipe",
    });
    expect(simulation.getEntity(machine.id)?.activeRecipeId).toBeUndefined();
    expect(simulation.getEntity(machine.id)?.pendingRecipeId).toBeUndefined();
    expect(simulation.productionLedger().ironGear).toBe(1);
    simulation.step(120);
    expect(simulation.productionLedger().ironGear).toBe(1);
  });

  it("preserves a queued old craft through no-power and output-full stalls", () => {
    const noPower = poweredRecipeMachine(
      "fabricator",
      "ironGear",
      false,
    );
    expect(
      noPower.simulation.receive(noPower.machine.id, "ironPlate", 3, "input"),
    ).toBe(3);
    noPower.simulation.step();
    expect(noPower.simulation.getEntity(noPower.machine.id)).toMatchObject({
      activeRecipeId: "ironGear",
      progress: 0,
      status: "noPower",
      input: { ironPlate: 1 },
    });
    expect(
      noPower.simulation.requestRecipeChange(
        noPower.machine.id,
        "copperWire",
      ),
    ).toMatchObject({ ok: true, outcome: "queued" });
    noPower.simulation.step(180);
    expect(noPower.simulation.getEntity(noPower.machine.id)).toMatchObject({
      activeRecipeId: "ironGear",
      recipeId: "ironGear",
      pendingRecipeId: "copperWire",
      recipeChangeQueued: true,
      reclaim: {},
      input: { ironPlate: 1 },
      output: {},
      progress: 0,
      status: "noPower",
    });
    expect(
      noPower.simulation.receive(noPower.generator.id, "coal", 1, "fuel"),
    ).toBe(1);
    stepUntil(
      noPower.simulation,
      () =>
        noPower.simulation.getEntity(noPower.machine.id)?.recipeId ===
        "copperWire",
      120,
    );
    expect(noPower.simulation.getEntity(noPower.machine.id)).toMatchObject({
      reclaim: { ironPlate: 1 },
      output: { ironGear: 1 },
    });

    const blocked = poweredRecipeMachine(
      "fabricator",
      "ironGear",
    );
    expect(
      blocked.simulation.receive(blocked.machine.id, "ironPlate", 3, "input"),
    ).toBe(3);
    blocked.simulation.step();
    for (const [item, amount] of [
      ["ironGear", 100],
      ["copperWire", 200],
      ["circuit", 200],
      ["automationCore", 50],
    ] as const) {
      expect(
        blocked.simulation.receive(
          blocked.machine.id,
          item,
          amount,
          "output",
        ),
      ).toBe(amount);
    }
    expect(
      blocked.simulation.requestRecipeChange(
        blocked.machine.id,
        "copperWire",
      ),
    ).toMatchObject({ ok: true, outcome: "queued" });
    const heldProgress =
      blocked.simulation.getEntity(blocked.machine.id)?.progress;
    blocked.simulation.step(120);
    expect(blocked.simulation.getEntity(blocked.machine.id)).toMatchObject({
      recipeId: "ironGear",
      activeRecipeId: "ironGear",
      pendingRecipeId: "copperWire",
      recipeChangeQueued: true,
      status: "outputFull",
      progress: heldProgress,
      reclaim: {},
    });
    const storage = placeOrThrow(
      blocked.simulation,
      "storage",
      9,
      8,
      Direction.East,
    );
    expect(
      blocked.simulation.transfer(
        blocked.machine.id,
        storage.id,
        "automationCore",
        50,
        "output",
      ),
    ).toMatchObject({ item: "automationCore", moved: 50 });
    stepUntil(
      blocked.simulation,
      () =>
        blocked.simulation.getEntity(blocked.machine.id)?.recipeId ===
        "copperWire",
      120,
    );
    expect(blocked.simulation.productionLedger().ironGear).toBe(1);
    expect(blocked.simulation.getEntity(blocked.machine.id)?.reclaim).toEqual({
      ironPlate: 1,
    });
  });

  it("supports queued Auto-smelt, gates explicit selections, and extracts reclaim before products", () => {
    const smelting = poweredRecipeMachine("smelter");
    expect(smelting.simulation.receive(smelting.machine.id, "ironOre", 2)).toBe(2);
    expect(smelting.simulation.receive(smelting.machine.id, "copperOre", 2)).toBe(2);
    smelting.simulation.step();
    expect(smelting.simulation.getEntity(smelting.machine.id)?.activeRecipeId)
      .toBe("smeltIron");
    expect(
      smelting.simulation.requestRecipeChange(
        smelting.machine.id,
        "smeltCopper",
      ),
    ).toMatchObject({ ok: true, outcome: "queued" });
    expect(
      smelting.simulation.requestRecipeChange(smelting.machine.id, null),
    ).toEqual({
      ok: true,
      outcome: "applied",
      recipeId: null,
    });
    expect(smelting.simulation.getEntity(smelting.machine.id)).toMatchObject({
      recipeChangeQueued: false,
      recipeId: undefined,
    });
    expect(
      smelting.simulation.requestRecipeChange(
        smelting.machine.id,
        "smeltIron",
      ),
    ).toMatchObject({ ok: true, outcome: "queued" });
    stepUntil(
      smelting.simulation,
      () =>
        smelting.simulation.getEntity(smelting.machine.id)?.recipeId ===
        "smeltIron",
      240,
    );
    expect(smelting.simulation.receive(smelting.machine.id, "copperOre", 1))
      .toBe(0);
    expect(smelting.simulation.receive(smelting.machine.id, "ironOre", 1))
      .toBe(1);

    const extraction = poweredRecipeMachine(
      "fabricator",
      "ironGear",
    );
    expect(
      extraction.simulation.receive(
        extraction.machine.id,
        "ironPlate",
        1,
        "input",
      ),
    ).toBe(1);
    expect(
      extraction.simulation.receive(
        extraction.machine.id,
        "automationCore",
        1,
        "output",
      ),
    ).toBe(1);
    expect(
      extraction.simulation.requestRecipeChange(
        extraction.machine.id,
        "copperWire",
      ),
    ).toMatchObject({ ok: true, outcome: "applied" });
    const inserter = placeOrThrow(
      extraction.simulation,
      "inserter",
      5,
      5,
      Direction.East,
    );
    placeOrThrow(
      extraction.simulation,
      "storage",
      6,
      4,
      Direction.East,
    );
    stepUntil(
      extraction.simulation,
      () =>
        extraction.simulation.getEntity(inserter.id)?.heldItem !== undefined,
      120,
    );
    expect(extraction.simulation.getEntity(inserter.id)?.heldItem).toBe(
      "ironPlate",
    );
    expect(
      extraction.simulation.getEntity(extraction.machine.id)?.output
        .automationCore,
    ).toBe(1);
  });

  it("round-trips and advances queued changes deterministically across fixed-step grouping", () => {
    const fixture = poweredRecipeMachine(
      "fabricator",
      "ironGear",
    );
    expect(
      fixture.simulation.receive(fixture.machine.id, "ironPlate", 5, "input"),
    ).toBe(5);
    fixture.simulation.step(7);
    expect(
      fixture.simulation.requestRecipeChange(
        fixture.machine.id,
        "copperWire",
      ),
    ).toMatchObject({ ok: true, outcome: "queued" });

    const serialized = fixture.simulation.serialize();
    const fine = FactorySimulation.restore(
      JSON.parse(JSON.stringify(serialized)),
    );
    const coarse = FactorySimulation.restore(
      JSON.parse(JSON.stringify(serialized)),
    );
    expect(fine.serialize()).toEqual(serialized);
    expect(coarse.serialize()).toEqual(serialized);

    for (let frame = 0; frame < 180; frame += 1) fine.tick(1 / 60);
    coarse.tick(3);
    expect(coarse.serialize()).toEqual(fine.serialize());
    expect(
      coarse.getEntity(fixture.machine.id),
    ).toMatchObject({
      recipeId: "copperWire",
      reclaim: { ironPlate: 3 },
      output: { ironGear: 1 },
      recipeChangeQueued: false,
    });
  });

  it("migrates v3 transition defaults and rejects corrupt recipe ownership, queues, and reclaim", () => {
    const legacyFixture = poweredRecipeMachine(
      "fabricator",
      "ironGear",
    );
    const legacy = JSON.parse(
      JSON.stringify(legacyFixture.simulation.serialize()),
    );
    legacy.version = 3;
    legacy.catalogVersion = "cinderline-3";
    for (const entity of legacy.entities) {
      delete entity.reclaim;
      delete entity.recipeChangeQueued;
      delete entity.pendingRecipeId;
    }
    const migrated = FactorySimulation.restore(legacy).serialize();
    expect(migrated.version).toBe(8);
    expect(migrated.catalogVersion).toBe("cinderline-8");
    expect(migrated.powerMode).toBe("legacyGlobal");
    expect(
      migrated.entities.every(
        (entity) =>
          entity.recipeChangeQueued === false &&
          Object.keys(entity.reclaim).length === 0,
      ),
    ).toBe(true);

    const fixture = poweredRecipeMachine(
      "fabricator",
      "ironGear",
    );
    expect(
      fixture.simulation.receive(fixture.machine.id, "ironPlate", 3, "input"),
    ).toBe(3);
    fixture.simulation.step();
    fixture.simulation.requestRecipeChange(
      fixture.machine.id,
      "copperWire",
    );
    const queued = fixture.simulation.serialize();
    const mutateMachine = (
      mutate: (entity: Record<string, unknown>) => void,
    ) => {
      const snapshot = JSON.parse(JSON.stringify(queued));
      const entity = snapshot.entities.find(
        (candidate: { id: number }) =>
          candidate.id === fixture.machine.id,
      );
      mutate(entity);
      return snapshot;
    };

    expect(() =>
      FactorySimulation.restore(
        mutateMachine((entity) => {
          entity.pendingRecipeId = "smeltIron";
        }),
      ),
    ).toThrow("invalid pending recipe");
    expect(() =>
      FactorySimulation.restore(
        mutateMachine((entity) => {
          entity.recipeChangeQueued = false;
        }),
      ),
    ).toThrow("orphan pending recipe");
    expect(() =>
      FactorySimulation.restore(
        mutateMachine((entity) => {
          delete entity.pendingRecipeId;
        }),
      ),
    ).toThrow("invalid recipe transition");
    expect(() =>
      FactorySimulation.restore(
        mutateMachine((entity) => {
          entity.activeRecipeId = undefined;
          entity.progress = 0;
        }),
      ),
    ).toThrow("invalid recipe transition");
    expect(() =>
      FactorySimulation.restore(
        mutateMachine((entity) => {
          delete entity.reclaim;
        }),
      ),
    ).toThrow("invalid inventory");
    expect(() =>
      FactorySimulation.restore(
        mutateMachine((entity) => {
          entity.reclaim = { ironPlate: 0 };
        }),
      ),
    ).toThrow("invalid inventory");

    const wrongOwner = JSON.parse(JSON.stringify(queued));
    const generator = wrongOwner.entities.find(
      (entity: { kind: string }) => entity.kind === "generator",
    );
    generator.reclaim = { ironPlate: 1 };
    expect(() => FactorySimulation.restore(wrongOwner)).toThrow(
      "recipe state on another entity",
    );
  });

  it("rejects impossible active and queued crafts on an unconfigured fabricator", () => {
    const fixture = poweredRecipeMachine("fabricator");
    const snapshot = fixture.simulation.serialize();
    const mutateFabricator = (
      recipeChangeQueued: boolean,
    ) => {
      const corrupted = JSON.parse(JSON.stringify(snapshot));
      const machine = corrupted.entities.find(
        (entity: { id: number }) => entity.id === fixture.machine.id,
      );
      machine.activeRecipeId = "ironGear";
      machine.progress = 0.99;
      machine.status = "working";
      machine.recipeChangeQueued = recipeChangeQueued;
      if (recipeChangeQueued) machine.pendingRecipeId = "copperWire";
      return corrupted;
    };

    expect(() =>
      FactorySimulation.restore(mutateFabricator(false)),
    ).toThrow("active craft on an unconfigured fabricator");
    expect(() =>
      FactorySimulation.restore(mutateFabricator(true)),
    ).toThrow("active craft on an unconfigured fabricator");
  });

  it("enforces the complete inventory ownership and capacity matrix after migration", () => {
    type StoredCompartment = Exclude<
      InventoryCompartment,
      "auto" | "belt"
    >;
    const kinds: readonly EntityKind[] = [
      "extractor",
      "belt",
      "manifold",
      "inserter",
      "smelter",
      "fabricator",
      "generator",
      "storage",
      "beacon",
    ];
    const compartments: readonly StoredCompartment[] = [
      "inventory",
      "input",
      "output",
      "reclaim",
      "fuel",
    ];
    const owners: Record<StoredCompartment, readonly EntityKind[]> = {
      inventory: ["storage"],
      input: ["smelter", "fabricator"],
      output: ["extractor", "smelter", "fabricator"],
      reclaim: ["smelter", "fabricator"],
      fuel: ["generator"],
    };
    const snapshotFor = (kind: EntityKind) => {
      const simulation = blankSimulation(18, 18, 0x1a7e);
      if (kind === "extractor") {
        simulation.setResource(3, 3, "iron", 10);
      }
      const entity = placeOrThrow(
        simulation,
        kind,
        3,
        3,
        Direction.East,
      );
      return {
        entity,
        snapshot: simulation.serialize(),
      };
    };

    let ownershipCases = 0;
    for (const kind of kinds) {
      for (const compartment of compartments) {
        const { entity, snapshot } = snapshotFor(kind);
        const corrupted = JSON.parse(JSON.stringify(snapshot));
        const serializedEntity = corrupted.entities.find(
          (candidate: { id: number }) => candidate.id === entity.id,
        );
        serializedEntity[compartment] = {
          [compartment === "fuel" ? "coal" : "ironPlate"]: 1,
        };
        const restore = () => FactorySimulation.restore(corrupted);
        if (owners[compartment].includes(kind)) {
          expect(restore).not.toThrow();
        } else {
          expect(restore).toThrow();
        }
        ownershipCases += 1;
      }
    }
    expect(ownershipCases).toBe(45);

    const boundaries = [
      {
        kind: "storage",
        compartment: "inventory",
        item: "ironPlate",
        maximum: 2_400,
      },
      {
        kind: "extractor",
        compartment: "output",
        item: "ironPlate",
        maximum: 200,
      },
      {
        kind: "smelter",
        compartment: "input",
        item: "ironOre",
        maximum: 300,
      },
      {
        kind: "smelter",
        compartment: "output",
        item: "ironPlate",
        maximum: 200,
      },
      {
        kind: "fabricator",
        compartment: "input",
        item: "ironPlate",
        maximum: 800,
      },
      {
        kind: "fabricator",
        compartment: "output",
        item: "ironGear",
        maximum: 400,
      },
      {
        kind: "generator",
        compartment: "fuel",
        item: "coal",
        maximum: 100,
      },
    ] as const;
    for (const boundary of boundaries) {
      const { entity, snapshot } = snapshotFor(boundary.kind);
      const atCapacity = JSON.parse(JSON.stringify(snapshot));
      atCapacity.entities.find(
        (candidate: { id: number }) => candidate.id === entity.id,
      )[boundary.compartment] = {
        [boundary.item]: boundary.maximum,
      };
      expect(() => FactorySimulation.restore(atCapacity)).not.toThrow();

      const overCapacity = JSON.parse(JSON.stringify(atCapacity));
      overCapacity.entities.find(
        (candidate: { id: number }) => candidate.id === entity.id,
      )[boundary.compartment][boundary.item] += 1;
      expect(() => FactorySimulation.restore(overCapacity)).toThrow(
        "inventory compartment capacity",
      );
    }

    const generatorFixture = snapshotFor("generator");
    const invalidFuel = JSON.parse(
      JSON.stringify(generatorFixture.snapshot),
    );
    invalidFuel.entities.find(
      (candidate: { id: number }) =>
        candidate.id === generatorFixture.entity.id,
    ).fuel = { ironPlate: 1 };
    expect(() => FactorySimulation.restore(invalidFuel)).toThrow(
      "invalid generator fuel",
    );

    for (const kind of ["smelter", "fabricator"] as const) {
      const { entity, snapshot } = snapshotFor(kind);
      const accumulatedReclaim = JSON.parse(JSON.stringify(snapshot));
      accumulatedReclaim.entities.find(
        (candidate: { id: number }) => candidate.id === entity.id,
      ).reclaim = {
        ironPlate: 1_000_000,
        copperPlate: 1_000_000,
        automationCore: 1_000_000,
      };
      expect(() =>
        FactorySimulation.restore(accumulatedReclaim),
      ).not.toThrow();
    }
  });

  it("preserves valid active machines through every legacy migration before strict v4 validation", () => {
    for (const [kind, recipeId, ingredient] of [
      ["fabricator", "ironGear", "ironPlate"],
      ["smelter", "smeltIron", "ironOre"],
    ] as const) {
      const fixture = poweredRecipeMachine(kind, recipeId);
      expect(
        fixture.simulation.receive(
          fixture.machine.id,
          ingredient,
          3,
          "input",
        ),
      ).toBe(3);
      fixture.simulation.step(7);
      const active = fixture.simulation.getEntity(fixture.machine.id)!;

      for (const version of [1, 2, 3] as const) {
        const legacy = JSON.parse(
          JSON.stringify(fixture.simulation.serialize()),
        );
        legacy.version = version;
        legacy.catalogVersion = `cinderline-${version}`;
        for (const entity of legacy.entities) {
          delete entity.reclaim;
          delete entity.recipeChangeQueued;
          delete entity.pendingRecipeId;
          if (version === 1) {
            for (const beltItem of entity.beltItems) {
              delete beltItem.port;
            }
          }
        }

        const restored = FactorySimulation.restore(legacy);
        expect(restored.getEntity(fixture.machine.id)).toMatchObject({
          recipeId,
          activeRecipeId: recipeId,
          progress: active.progress,
          reclaim: {},
          recipeChangeQueued: false,
        });
      }
    }
  });

  it("rejects corrupt ledgers and event counters and guards overflow before production commits", () => {
    const base = blankSimulation().serialize();
    const corruptProduced = [
      (snapshot: Record<string, any>) => {
        delete snapshot.produced.ironGear;
      },
      (snapshot: Record<string, any>) => {
        snapshot.produced.unknownItem = 1;
      },
      (snapshot: Record<string, any>) => {
        snapshot.produced.ironGear = -1;
      },
      (snapshot: Record<string, any>) => {
        snapshot.produced.ironGear = 1.5;
      },
      (snapshot: Record<string, any>) => {
        snapshot.produced.ironGear = Number.MAX_SAFE_INTEGER + 1;
      },
      (snapshot: Record<string, any>) => {
        snapshot.produced.ironGear = Number.POSITIVE_INFINITY;
      },
      (snapshot: Record<string, any>) => {
        snapshot.produced.ironGear = Number.NaN;
      },
    ];
    for (const corrupt of corruptProduced) {
      const snapshot = structuredClone(base) as unknown as Record<string, any>;
      corrupt(snapshot);
      expect(() => FactorySimulation.restore(snapshot as never)).toThrow(
        "save structure is corrupt",
      );
    }
    expect(Object.keys(base.produced).sort()).toEqual(
      [...ITEM_IDS].sort(),
    );

    for (const nextEventId of [
      0,
      -1,
      1.5,
      "7",
      Number.MAX_SAFE_INTEGER,
      Number.POSITIVE_INFINITY,
      Number.NaN,
    ]) {
      const snapshot = structuredClone(base) as unknown as Record<string, any>;
      snapshot.nextEventId = nextEventId;
      expect(() => FactorySimulation.restore(snapshot as never)).toThrow(
        "save structure is corrupt",
      );
    }

    const ledgerFixture = poweredRecipeMachine(
      "fabricator",
      "ironGear",
    );
    expect(
      ledgerFixture.simulation.receive(
        ledgerFixture.machine.id,
        "ironPlate",
        3,
        "input",
      ),
    ).toBe(3);
    ledgerFixture.simulation.step();
    const ledgerOverflow = ledgerFixture.simulation.serialize();
    ledgerOverflow.produced.ironGear = Number.MAX_SAFE_INTEGER;
    const serializedMachine = ledgerOverflow.entities.find(
      (entity) => entity.id === ledgerFixture.machine.id,
    )!;
    serializedMachine.progress = 0.99;
    const ledgerGuard = FactorySimulation.restore(ledgerOverflow);
    const beforeLedgerGuard = ledgerGuard.getEntity(
      ledgerFixture.machine.id,
    )!;
    expect(() => ledgerGuard.step()).toThrow(
      "Production ledger exceeds safe integer range",
    );
    expect(ledgerGuard.getEntity(ledgerFixture.machine.id)).toMatchObject({
      progress: beforeLedgerGuard.progress,
      activeRecipeId: beforeLedgerGuard.activeRecipeId,
      output: beforeLedgerGuard.output,
    });
    expect(ledgerGuard.productionLedger().ironGear).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(ledgerGuard.peekEvents()).toEqual([]);

    const eventFixture = poweredRecipeMachine(
      "fabricator",
      "ironGear",
    );
    expect(
      eventFixture.simulation.receive(
        eventFixture.machine.id,
        "ironPlate",
        4,
        "input",
      ),
    ).toBe(4);
    eventFixture.simulation.step();
    const eventOverflow = eventFixture.simulation.serialize();
    eventOverflow.nextEventId = Number.MAX_SAFE_INTEGER - 1;
    eventOverflow.entities.find(
      (entity) => entity.id === eventFixture.machine.id,
    )!.progress = 0.99;
    const eventGuard = FactorySimulation.restore(eventOverflow);
    const beforeEventGuard = eventGuard.serializeToString();
    expect(() => eventGuard.step()).toThrow(
      "Simulation event id exceeds safe integer range",
    );
    expect(eventGuard.serializeToString()).toBe(beforeEventGuard);
    expect(eventGuard.productionLedger().ironGear).toBe(0);
    expect(eventGuard.peekEvents()).toEqual([]);
  });

  it("canonicalizes fractional sub-tick saves across equivalent frame groupings", () => {
    const fixture = poweredRecipeMachine(
      "fabricator",
      "ironGear",
    );
    expect(
      fixture.simulation.receive(
        fixture.machine.id,
        "ironPlate",
        5,
        "input",
      ),
    ).toBe(5);
    fixture.simulation.step(7);
    fixture.simulation.requestRecipeChange(
      fixture.machine.id,
      "copperWire",
    );
    expect(fixture.simulation.tick(1 / 240)).toBe(0);
    fixture.simulation.drainEvents();

    const serialized = fixture.simulation.serialize();
    const fine = FactorySimulation.restore(structuredClone(serialized));
    const coarse = FactorySimulation.restore(structuredClone(serialized));
    for (let frame = 0; frame < 480; frame += 1) fine.tick(1 / 60);
    coarse.tick(8);

    expect(coarse.serialize()).toEqual(fine.serialize());
    expect(coarse.peekEvents()).toEqual(fine.peekEvents());
  });

  it("latches mixed Auto-smelt crafts and selects each next recipe deterministically", () => {
    const latched = poweredRecipeMachine("smelter");
    expect(
      latched.simulation.receive(
        latched.machine.id,
        "copperOre",
        2,
      ),
    ).toBe(2);
    latched.simulation.step();
    expect(
      latched.simulation.getEntity(latched.machine.id)?.activeRecipeId,
    ).toBe("smeltCopper");
    expect(
      latched.simulation.receive(latched.machine.id, "ironOre", 2),
    ).toBe(2);
    expect(
      latched.simulation.receive(latched.machine.id, "stone", 4),
    ).toBe(4);
    latched.simulation.drainEvents();

    let latchTicks = 0;
    while (
      latched.simulation.productionLedger().copperPlate === 0 &&
      latchTicks < 300
    ) {
      expect(
        latched.simulation.getEntity(latched.machine.id)?.activeRecipeId,
      ).toBe("smeltCopper");
      latched.simulation.step();
      latchTicks += 1;
    }
    expect(latchTicks).toBeLessThan(300);
    expect(latched.simulation.getEntity(latched.machine.id)).toMatchObject({
      activeRecipeId: undefined,
      input: {
        ironOre: 2,
        copperOre: 1,
        stone: 4,
      },
      output: { copperPlate: 1 },
    });
    expect(
      latched.simulation
        .drainEvents()
        .filter((event) => event.type === "itemProduced"),
    ).toMatchObject([
      {
        item: "copperPlate",
        amount: 1,
      },
    ]);
    latched.simulation.step();
    expect(latched.simulation.getEntity(latched.machine.id)).toMatchObject({
      activeRecipeId: "smeltIron",
      input: {
        ironOre: 1,
        copperOre: 1,
        stone: 4,
      },
    });

    const ordered = poweredRecipeMachine("smelter");
    const storage = placeOrThrow(
      ordered.simulation,
      "storage",
      9,
      9,
      Direction.East,
    );
    expect(ordered.simulation.receive(ordered.machine.id, "ironOre", 1))
      .toBe(1);
    expect(ordered.simulation.receive(ordered.machine.id, "copperOre", 1))
      .toBe(1);
    expect(ordered.simulation.receive(ordered.machine.id, "stone", 2))
      .toBe(2);
    ordered.simulation.drainEvents();

    const producedOrder: ItemId[] = [];
    for (let craft = 0; craft < 3; craft += 1) {
      let event: ReturnType<FactorySimulation["drainEvents"]>[number] | undefined;
      for (let tick = 0; tick < 300 && !event; tick += 1) {
        ordered.simulation.step();
        event = ordered.simulation
          .drainEvents()
          .find((candidate) => candidate.type === "itemProduced");
      }
      expect(event?.item).toBeDefined();
      producedOrder.push(event!.item!);
      expect(
        ordered.simulation.transfer(
          ordered.machine.id,
          storage.id,
          event!.item,
          event!.amount,
          "output",
          "inventory",
        ).moved,
      ).toBe(event!.amount);
      ordered.simulation.drainEvents();
    }
    expect(producedOrder).toEqual([
      "ironPlate",
      "copperPlate",
      "stoneBrick",
    ]);
  });

  it("extracts every mixed reclaim item before same-kind and mixed products", () => {
    const fixture = poweredRecipeMachine(
      "fabricator",
      "ironGear",
    );
    const inserter = placeOrThrow(
      fixture.simulation,
      "inserter",
      5,
      5,
      Direction.East,
    );
    const storage = placeOrThrow(
      fixture.simulation,
      "storage",
      6,
      4,
      Direction.East,
    );
    expect(
      fixture.simulation.receive(
        fixture.machine.id,
        "ironPlate",
        2,
        "input",
      ),
    ).toBe(2);
    expect(
      fixture.simulation.receive(
        fixture.machine.id,
        "automationCore",
        2,
        "input",
      ),
    ).toBe(2);
    expect(
      fixture.simulation.receive(
        fixture.machine.id,
        "ironPlate",
        2,
        "output",
      ),
    ).toBe(2);
    expect(
      fixture.simulation.receive(
        fixture.machine.id,
        "copperPlate",
        1,
        "output",
      ),
    ).toBe(1);
    expect(
      fixture.simulation.receive(
        fixture.machine.id,
        "automationCore",
        2,
        "output",
      ),
    ).toBe(2);
    expect(
      fixture.simulation.requestRecipeChange(
        fixture.machine.id,
        "copperWire",
      ),
    ).toMatchObject({ ok: true, outcome: "applied" });
    fixture.simulation.drainEvents();

    const extracted: ItemId[] = [];
    for (
      let tick = 0;
      tick < 3_000 && extracted.length < 9;
      tick += 1
    ) {
      fixture.simulation.step();
      for (const event of fixture.simulation.drainEvents()) {
        if (
          event.type === "itemTransferred" &&
          event.entityId === storage.id &&
          event.item
        ) {
          extracted.push(event.item);
        }
      }
    }
    expect(extracted).toEqual([
      "ironPlate",
      "ironPlate",
      "automationCore",
      "automationCore",
      "ironPlate",
      "ironPlate",
      "copperPlate",
      "automationCore",
      "automationCore",
    ]);
    expect(fixture.simulation.getEntity(fixture.machine.id)).toMatchObject({
      reclaim: {},
      output: {},
    });
    expect(fixture.simulation.getEntity(inserter.id)?.heldItem).toBeUndefined();
  });

  it("backs a manifold adapter up at a queued machine and delivers only after commit", () => {
    const simulation = blankSimulation(28, 18, 0xadab7);
    const manifold = placeOrThrow(
      simulation,
      "manifold",
      6,
      6,
      Direction.East,
    );
    placeOrThrow(simulation, "belt", 7, 5, Direction.East);
    const inserter = placeOrThrow(
      simulation,
      "inserter",
      8,
      5,
      Direction.East,
    );
    const machine = placeOrThrow(
      simulation,
      "fabricator",
      9,
      4,
      Direction.East,
      { recipeId: "ironGear" },
    );
    const generator = placeOrThrow(
      simulation,
      "generator",
      20,
      4,
      Direction.East,
    );
    expect(simulation.receive(generator.id, "coal", 10, "fuel")).toBe(10);
    expect(simulation.receive(machine.id, "ironPlate", 3, "input")).toBe(3);
    expect(
      simulation.receive(manifold.id, "copperPlate", 1, "belt", 0),
    ).toBe(1);
    simulation.step();
    expect(
      simulation.requestRecipeChange(machine.id, "copperWire"),
    ).toMatchObject({ ok: true, outcome: "queued" });

    let earlyPickup = false;
    for (let tick = 0; tick < 200; tick += 1) {
      if (simulation.getEntity(machine.id)?.recipeId === "copperWire") break;
      simulation.step();
      if (
        simulation.getEntity(inserter.id)?.heldItem !== undefined ||
        simulation.getEntity(machine.id)?.input.copperPlate !== undefined
      ) {
        earlyPickup = true;
      }
    }
    expect(earlyPickup).toBe(false);
    expect(simulation.getEntity(machine.id)).toMatchObject({
      recipeId: "copperWire",
      recipeChangeQueued: false,
      output: { ironGear: 1 },
      reclaim: { ironPlate: 1 },
    });

    stepUntil(
      simulation,
      () =>
        simulation.getEntity(machine.id)?.activeRecipeId === "copperWire",
      600,
    );
    stepUntil(
      simulation,
      () => simulation.productionLedger().copperWire === 2,
      120,
    );
    expect(simulation.productionLedger()).toMatchObject({
      ironGear: 1,
      copperWire: 2,
    });
    expect(simulation.getEntity(manifold.id)?.beltItems).toEqual([]);
  });
});

describe("Numeric ceilings and strict restore integrity", () => {
  const exhaustedEventCounter = (
    simulation: FactorySimulation,
  ): FactorySimulation => {
    simulation.drainEvents();
    const snapshot = simulation.serialize();
    snapshot.nextEventId = Number.MAX_SAFE_INTEGER - 1;
    return FactorySimulation.restore(snapshot);
  };

  const atomicCeilingCases: Array<{
    name: string;
    setup: () => {
      simulation: FactorySimulation;
      operation: () => unknown;
      message: string;
    };
  }> = [
    {
      name: "place at the event ceiling",
      setup: () => {
        const simulation = exhaustedEventCounter(blankSimulation());
        return {
          simulation,
          operation: () =>
            simulation.place("storage", 2, 2, Direction.East),
          message: "Simulation event id exceeds safe integer range",
        };
      },
    },
    {
      name: "remove at the event ceiling",
      setup: () => {
        const source = blankSimulation();
        placeOrThrow(source, "storage", 2, 2, Direction.East);
        const simulation = exhaustedEventCounter(source);
        return {
          simulation,
          operation: () => simulation.remove(2, 2),
          message: "Simulation event id exceeds safe integer range",
        };
      },
    },
    {
      name: "rotate at the event ceiling",
      setup: () => {
        const source = blankSimulation();
        placeOrThrow(source, "belt", 2, 2, Direction.East);
        const simulation = exhaustedEventCounter(source);
        return {
          simulation,
          operation: () => simulation.rotate(2, 2),
          message: "Simulation event id exceeds safe integer range",
        };
      },
    },
    {
      name: "receive at the event ceiling",
      setup: () => {
        const source = blankSimulation();
        const storage = placeOrThrow(
          source,
          "storage",
          2,
          2,
          Direction.East,
        );
        const simulation = exhaustedEventCounter(source);
        return {
          simulation,
          operation: () =>
            simulation.receive(storage.id, "ironOre", 1, "inventory"),
          message: "Simulation event id exceeds safe integer range",
        };
      },
    },
    {
      name: "transfer at the event ceiling",
      setup: () => {
        const source = blankSimulation();
        const from = placeOrThrow(
          source,
          "storage",
          2,
          2,
          Direction.East,
        );
        const to = placeOrThrow(
          source,
          "storage",
          6,
          2,
          Direction.East,
        );
        expect(source.receive(from.id, "ironOre", 1, "inventory")).toBe(1);
        const simulation = exhaustedEventCounter(source);
        return {
          simulation,
          operation: () =>
            simulation.transfer(
              from.id,
              to.id,
              "ironOre",
              1,
              "inventory",
              "inventory",
            ),
          message: "Simulation event id exceeds safe integer range",
        };
      },
    },
    {
      name: "step before power and fuel mutation at the event ceiling",
      setup: () => {
        const source = blankSimulation();
        const generator = placeOrThrow(
          source,
          "generator",
          2,
          2,
          Direction.East,
        );
        expect(source.receive(generator.id, "coal", 1, "fuel")).toBe(1);
        const simulation = exhaustedEventCounter(source);
        return {
          simulation,
          operation: () => simulation.step(),
          message: "Simulation event id exceeds safe integer range",
        };
      },
    },
    {
      name: "tick before accumulator mutation at the event ceiling",
      setup: () => {
        const source = blankSimulation();
        source.tick(FIXED_TICK_SECONDS / 2);
        const simulation = exhaustedEventCounter(source);
        return {
          simulation,
          operation: () => simulation.tick(FIXED_TICK_SECONDS / 2),
          message: "Simulation event id exceeds safe integer range",
        };
      },
    },
    {
      name: "place at the signed occupancy id ceiling",
      setup: () => {
        const snapshot = blankSimulation().serialize();
        snapshot.nextEntityId = 0x7fff_ffff;
        const simulation = FactorySimulation.restore(snapshot);
        return {
          simulation,
          operation: () =>
            simulation.place("storage", 2, 2, Direction.East),
          message: "Entity id exceeds signed occupancy range",
        };
      },
    },
    {
      name: "receive at the transport payload id ceiling",
      setup: () => {
        const source = blankSimulation();
        const belt = placeOrThrow(
          source,
          "belt",
          2,
          2,
          Direction.East,
        );
        source.drainEvents();
        const snapshot = source.serialize();
        snapshot.nextBeltItemId = Number.MAX_SAFE_INTEGER - 1;
        const simulation = FactorySimulation.restore(snapshot);
        return {
          simulation,
          operation: () =>
            simulation.receive(belt.id, "ironOre", 1, "belt"),
          message: "Transport payload id exceeds safe integer range",
        };
      },
    },
    {
      name: "step at the tick counter ceiling",
      setup: () => {
        const snapshot = blankSimulation().serialize();
        snapshot.tickCount = Number.MAX_SAFE_INTEGER - 1;
        snapshot.circuitNetwork = {
          ...snapshot.circuitNetwork,
          tick: snapshot.tickCount,
        };
        const simulation = FactorySimulation.restore(snapshot);
        return {
          simulation,
          operation: () => simulation.step(),
          message: "Simulation tick counter exceeds safe integer range",
        };
      },
    },
  ];

  it.each(atomicCeilingCases)(
    "keeps the complete state fingerprint atomic for $name",
    ({ setup }) => {
      const { simulation, operation, message } = setup();
      expectAtomicFailure(simulation, operation, message);
    },
  );

  it("preflights transport allocation, production, and queued reclaim before a fixed step", () => {
    const inserterSource = blankSimulation();
    placeOrThrow(
      inserterSource,
      "inserter",
      2,
      2,
      Direction.East,
    );
    inserterSource.drainEvents();
    const inserterSnapshot = inserterSource.serialize();
    inserterSnapshot.nextBeltItemId = Number.MAX_SAFE_INTEGER - 1;
    const transportGuard = FactorySimulation.restore(inserterSnapshot);
    expectAtomicFailure(
      transportGuard,
      () => transportGuard.step(),
      "Transport payload id exceeds safe integer range",
    );

    const productionFixture = poweredRecipeMachine(
      "fabricator",
      "ironGear",
    );
    expect(
      productionFixture.simulation.receive(
        productionFixture.machine.id,
        "ironPlate",
        3,
        "input",
      ),
    ).toBe(3);
    productionFixture.simulation.step();
    productionFixture.simulation.drainEvents();
    const productionSnapshot = productionFixture.simulation.serialize();
    productionSnapshot.produced.ironGear = Number.MAX_SAFE_INTEGER;
    productionSnapshot.entities.find(
      (entity) => entity.id === productionFixture.machine.id,
    )!.progress = 0.99;
    const productionGuard =
      FactorySimulation.restore(productionSnapshot);
    expectAtomicFailure(
      productionGuard,
      () => productionGuard.step(),
      "Production ledger exceeds safe integer range",
    );

    const reclaimFixture = poweredRecipeMachine(
      "fabricator",
      "ironGear",
    );
    expect(
      reclaimFixture.simulation.receive(
        reclaimFixture.machine.id,
        "ironPlate",
        3,
        "input",
      ),
    ).toBe(3);
    reclaimFixture.simulation.step();
    expect(
      reclaimFixture.simulation.requestRecipeChange(
        reclaimFixture.machine.id,
        "copperWire",
      ),
    ).toMatchObject({ ok: true, outcome: "queued" });
    reclaimFixture.simulation.drainEvents();
    const reclaimGuard = reclaimFixture.simulation;
    (
      reclaimGuard as unknown as {
        entities: Map<number, { reclaim: Record<string, number> }>;
      }
    ).entities.get(reclaimFixture.machine.id)!.reclaim.ironPlate =
      Number.MAX_SAFE_INTEGER;
    expectAtomicFailure(
      reclaimGuard,
      () => reclaimGuard.step(),
      "Reclaim inventory exceeds safe integer range",
    );
  });

  it("preflights an immediate recipe reclaim before deleting any input", () => {
    const source = blankSimulation();
    const machine = placeOrThrow(
      source,
      "fabricator",
      2,
      2,
      Direction.East,
      { recipeId: "ironGear" },
    );
    expect(source.receive(machine.id, "ironPlate", 1, "input")).toBe(1);
    source.drainEvents();
    const simulation = source;
    (
      simulation as unknown as {
        entities: Map<number, { reclaim: Record<string, number> }>;
      }
    ).entities.get(machine.id)!.reclaim.ironPlate =
      Number.MAX_SAFE_INTEGER;
    expectAtomicFailure(
      simulation,
      () => simulation.requestRecipeChange(machine.id, "copperWire"),
      "Reclaim inventory exceeds safe integer range",
    );
  });

  it("rejects every invalid global numeric domain instead of coercing it", () => {
    const base = blankSimulation().serialize();
    const corruptions: Array<{
      field: string;
      values: unknown[];
    }> = [
      {
        field: "width",
        values: [7, 513, 8.5, Number.POSITIVE_INFINITY, Number.NaN, "32"],
      },
      {
        field: "height",
        values: [7, 513, 8.5, Number.POSITIVE_INFINITY, Number.NaN, "20"],
      },
      {
        field: "seed",
        values: [
          0,
          -1,
          1.5,
          0x1_0000_0000,
          Number.POSITIVE_INFINITY,
          Number.NaN,
          "1",
        ],
      },
      {
        field: "randomState",
        values: [
          -1,
          1.5,
          0x1_0000_0000,
          Number.POSITIVE_INFINITY,
          Number.NaN,
          "1",
        ],
      },
      {
        field: "tickCount",
        values: [
          -1,
          1.5,
          Number.MAX_SAFE_INTEGER,
          Number.POSITIVE_INFINITY,
          Number.NaN,
          "1",
        ],
      },
      {
        field: "accumulatorSeconds",
        values: [
          -0.1,
          FIXED_TICK_SECONDS,
          Number.POSITIVE_INFINITY,
          Number.NaN,
          "0",
        ],
      },
      {
        field: "nextEntityId",
        values: [
          0,
          -1,
          1.5,
          0x8000_0000,
          Number.POSITIVE_INFINITY,
          Number.NaN,
          "1",
        ],
      },
      {
        field: "nextBeltItemId",
        values: [
          0,
          -1,
          1.5,
          Number.MAX_SAFE_INTEGER,
          Number.POSITIVE_INFINITY,
          Number.NaN,
          "1",
        ],
      },
      {
        field: "lastPowerSatisfaction",
        values: [
          -0.1,
          1.1,
          Number.POSITIVE_INFINITY,
          Number.NaN,
          "1",
        ],
      },
    ];

    let attempted = 0;
    for (const { field, values } of corruptions) {
      for (const value of values) {
        const snapshot = structuredClone(base) as unknown as Record<
          string,
          unknown
        >;
        snapshot[field] = value;
        expect(
          () => FactorySimulation.restore(snapshot as never),
          `${field} accepted ${String(value)}`,
        ).toThrow();
        attempted += 1;
      }
    }
    expect(attempted).toBe(55);

    const zeroRandomState = structuredClone(base);
    zeroRandomState.randomState = 0;
    expect(
      FactorySimulation.restore(zeroRandomState).serialize().randomState,
    ).toBe(0);
    expect(
      () =>
        new FactorySimulation({
          width: 513,
          height: 8,
          generateTerrain: false,
          generateResources: false,
        }),
    ).toThrow("dimensions");
  });

  it("rejects malformed terrain and resources without filtering, flooring, or overwriting", () => {
    const base = blankSimulation(12, 10).serialize();
    const invalidTerrainValues: unknown[] = [
      -1,
      2,
      0.5,
      Number.POSITIVE_INFINITY,
      Number.NaN,
      "0",
      undefined,
    ];
    for (const value of invalidTerrainValues) {
      const snapshot = structuredClone(base) as unknown as Record<
        string,
        any
      >;
      snapshot.terrain[0] = value;
      expect(() => FactorySimulation.restore(snapshot as never)).toThrow(
        "invalid terrain state",
      );
    }

    const validResource = {
      x: 1,
      y: 1,
      type: "iron",
      amount: 10,
    };
    const corruptResourceLists: unknown[][] = [
      [null],
      [{ ...validResource, x: -1 }],
      [{ ...validResource, x: 12 }],
      [{ ...validResource, x: 1.5 }],
      [{ ...validResource, y: Number.NaN }],
      [{ ...validResource, type: "uranium" }],
      [{ ...validResource, amount: 0 }],
      [{ ...validResource, amount: -1 }],
      [{ ...validResource, amount: 1.5 }],
      [{ ...validResource, amount: Number.MAX_SAFE_INTEGER + 1 }],
      [{ ...validResource, amount: Number.POSITIVE_INFINITY }],
      [{ ...validResource, amount: Number.NaN }],
      [{ ...validResource, amount: "10" }],
      [validResource, { ...validResource, type: "copper" }],
    ];
    for (const resources of corruptResourceLists) {
      const snapshot = structuredClone(base) as unknown as Record<
        string,
        unknown
      >;
      snapshot.resources = resources;
      expect(() => FactorySimulation.restore(snapshot as never)).toThrow();
    }

    const flooded = structuredClone(base) as unknown as Record<string, any>;
    flooded.resources = [validResource];
    flooded.terrain[1 + flooded.width] = TerrainType.Water;
    expect(() => FactorySimulation.restore(flooded as never)).toThrow(
      "invalid resource state",
    );

    const exact = structuredClone(base);
    exact.resources = [validResource as never];
    expect(FactorySimulation.restore(exact).serialize().resources).toEqual([
      validResource,
    ]);
  });

  it("strictly validates finite entity scalars, ownership defaults, and footprints", () => {
    const source = blankSimulation(30, 20);
    source.setResource(2, 2, "iron", 100);
    const extractor = placeOrThrow(
      source,
      "extractor",
      2,
      2,
      Direction.East,
    );
    const manifold = placeOrThrow(
      source,
      "manifold",
      7,
      2,
      Direction.East,
    );
    const generator = placeOrThrow(
      source,
      "generator",
      11,
      2,
      Direction.East,
    );
    const storage = placeOrThrow(
      source,
      "storage",
      16,
      2,
      Direction.East,
    );
    source.drainEvents();
    const base = source.serialize();

    const corruptions: Array<{
      entityId: number;
      field: string;
      value: unknown;
    }> = [
      { entityId: storage.id, field: "status", value: "teleporting" },
      { entityId: storage.id, field: "progress", value: 0.1 },
      { entityId: storage.id, field: "animationPhase", value: 0.1 },
      {
        entityId: storage.id,
        field: "powerSatisfaction",
        value: Number.NaN,
      },
      { entityId: storage.id, field: "powerSatisfaction", value: -0.1 },
      { entityId: storage.id, field: "powerSatisfaction", value: 1.1 },
      { entityId: storage.id, field: "speedMultiplier", value: 1.1 },
      { entityId: storage.id, field: "fuelEnergyKJ", value: 1 },
      { entityId: storage.id, field: "generatedPowerKW", value: 1 },
      { entityId: storage.id, field: "miningResource", value: "iron" },
      { entityId: storage.id, field: "width", value: 1 },
      { entityId: extractor.id, field: "progress", value: -0.1 },
      { entityId: extractor.id, field: "progress", value: 1.1 },
      {
        entityId: extractor.id,
        field: "animationPhase",
        value: Number.POSITIVE_INFINITY,
      },
      { entityId: extractor.id, field: "speedMultiplier", value: 0.9 },
      {
        entityId: extractor.id,
        field: "speedMultiplier",
        value: Number.MAX_VALUE,
      },
      {
        entityId: extractor.id,
        field: "miningResource",
        value: "uranium",
      },
      { entityId: manifold.id, field: "progress", value: 1.01 },
      { entityId: generator.id, field: "fuelEnergyKJ", value: -1 },
      { entityId: generator.id, field: "fuelEnergyKJ", value: 4001 },
      {
        entityId: generator.id,
        field: "fuelEnergyKJ",
        value: Number.POSITIVE_INFINITY,
      },
      { entityId: generator.id, field: "generatedPowerKW", value: -1 },
      { entityId: generator.id, field: "generatedPowerKW", value: 901 },
      {
        entityId: generator.id,
        field: "generatedPowerKW",
        value: Number.NaN,
      },
    ];

    for (const { entityId, field, value } of corruptions) {
      const snapshot = structuredClone(base) as unknown as Record<
        string,
        any
      >;
      const entity = snapshot.entities.find(
        (candidate: { id: number }) => candidate.id === entityId,
      );
      entity[field] = value;
      expect(
        () => FactorySimulation.restore(snapshot as never),
        `${field} accepted ${String(value)}`,
      ).toThrow();
    }

    const floodedEntity = structuredClone(base);
    floodedEntity.terrain[storage.y * floodedEntity.width + storage.x] =
      TerrainType.Water;
    expect(() => FactorySimulation.restore(floodedEntity)).toThrow(
      "flooded",
    );
  });

  it("accepts only a chronological completed-objective prefix at safe ticks", () => {
    const base = blankSimulation().serialize();
    base.tickCount = 100;
    base.circuitNetwork = {
      ...base.circuitNetwork,
      tick: base.tickCount,
    };
    base.objectiveCompletedTicks = {
      "wake-the-line": 10,
      "first-heat": 10,
    };
    expect(
      FactorySimulation.restore(base).serialize().objectiveCompletedTicks,
    ).toEqual(base.objectiveCompletedTicks);

    const invalidObjectiveStates: unknown[] = [
      null,
      [],
      { unknown: 1 },
      { "first-heat": 10 },
      { "wake-the-line": 10, "moving-parts": 20 },
      { "wake-the-line": -1 },
      { "wake-the-line": 1.5 },
      { "wake-the-line": 101 },
      { "wake-the-line": Number.MAX_SAFE_INTEGER + 1 },
      { "wake-the-line": Number.POSITIVE_INFINITY },
      { "wake-the-line": Number.NaN },
      { "wake-the-line": "10" },
      { "wake-the-line": 20, "first-heat": 19 },
    ];
    for (const objectiveCompletedTicks of invalidObjectiveStates) {
      const snapshot = structuredClone(base) as unknown as Record<
        string,
        unknown
      >;
      snapshot.objectiveCompletedTicks = objectiveCompletedTicks;
      expect(() => FactorySimulation.restore(snapshot as never)).toThrow(
        "save structure is corrupt",
      );
    }
  });

  it("requires exact id counters above all signed entity and transport ids", () => {
    const source = blankSimulation();
    const belt = placeOrThrow(
      source,
      "belt",
      2,
      2,
      Direction.East,
    );
    expect(source.receive(belt.id, "ironOre", 1, "belt")).toBe(1);
    source.drainEvents();
    const base = source.serialize();
    const beltItemId = base.entities.find(
      (entity) => entity.id === belt.id,
    )!.beltItems[0]!.id;

    const staleEntityCounter = structuredClone(base);
    staleEntityCounter.nextEntityId = belt.id;
    expect(() => FactorySimulation.restore(staleEntityCounter)).toThrow(
      "counters do not exceed",
    );

    const staleBeltCounter = structuredClone(base);
    staleBeltCounter.nextBeltItemId = beltItemId;
    expect(() => FactorySimulation.restore(staleBeltCounter)).toThrow(
      "counters do not exceed",
    );

    const signedOverflow = structuredClone(base);
    signedOverflow.entities[0]!.id = 0x7fff_ffff;
    signedOverflow.nextEntityId = 0x7fff_ffff;
    expect(() => FactorySimulation.restore(signedOverflow)).toThrow(
      "invalid entity state",
    );
  });

  it("rejects aggregate stored-item and resource totals that overflow across valid cells", () => {
    const itemSource = blankSimulation();
    const firstMachine = placeOrThrow(
      itemSource,
      "fabricator",
      2,
      2,
      Direction.East,
      { recipeId: "ironGear" },
    );
    const secondMachine = placeOrThrow(
      itemSource,
      "fabricator",
      8,
      2,
      Direction.East,
      { recipeId: "copperWire" },
    );
    itemSource.drainEvents();
    const itemOverflow = itemSource.serialize();
    itemOverflow.entities.find(
      (entity) => entity.id === firstMachine.id,
    )!.reclaim.ironPlate = Number.MAX_SAFE_INTEGER;
    itemOverflow.entities.find(
      (entity) => entity.id === secondMachine.id,
    )!.reclaim.ironPlate = 1;
    expect(() => FactorySimulation.restore(itemOverflow)).toThrow(
      "Stored item totals exceed safe integer range",
    );

    const resourceOverflow = blankSimulation().serialize();
    resourceOverflow.resources = [
      { x: 1, y: 1, type: "iron", amount: Number.MAX_SAFE_INTEGER },
      { x: 2, y: 1, type: "iron", amount: 1 },
    ];
    expect(() => FactorySimulation.restore(resourceOverflow)).toThrow(
      "Resource totals exceed safe integer range",
    );
  });

  it("reserves aggregate stored and resource headroom before every live addition", () => {
    const itemSource = blankSimulation();
    const machine = placeOrThrow(
      itemSource,
      "fabricator",
      2,
      2,
      Direction.East,
      { recipeId: "ironGear" },
    );
    const storage = placeOrThrow(
      itemSource,
      "storage",
      8,
      2,
      Direction.East,
    );
    itemSource.drainEvents();
    const itemCeiling = itemSource.serialize();
    itemCeiling.entities.find(
      (entity) => entity.id === machine.id,
    )!.reclaim.ironOre = Number.MAX_SAFE_INTEGER;
    const receiveGuard = FactorySimulation.restore(itemCeiling);
    expect(receiveGuard.stats().stored.ironOre).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expectAtomicFailure(
      receiveGuard,
      () =>
        receiveGuard.receive(storage.id, "ironOre", 1, "inventory"),
      "Stored item totals exceed safe integer range",
    );
    expect(
      receiveGuard.transfer(
        machine.id,
        storage.id,
        "ironOre",
        1,
        "reclaim",
        "inventory",
      ),
    ).toEqual({ item: "ironOre", moved: 1 });
    expect(receiveGuard.stats().stored.ironOre).toBe(
      Number.MAX_SAFE_INTEGER,
    );

    const productionFixture = poweredRecipeMachine(
      "fabricator",
      "ironGear",
    );
    expect(
      productionFixture.simulation.receive(
        productionFixture.machine.id,
        "ironPlate",
        2,
        "input",
      ),
    ).toBe(2);
    productionFixture.simulation.step();
    productionFixture.simulation.drainEvents();
    const productionCeiling = productionFixture.simulation.serialize();
    productionCeiling.entities.find(
      (entity) => entity.id === productionFixture.machine.id,
    )!.reclaim.ironGear = Number.MAX_SAFE_INTEGER;
    const productionGuard = FactorySimulation.restore(productionCeiling);
    expectAtomicFailure(
      productionGuard,
      () => productionGuard.step(),
      "Stored item totals exceed safe integer range",
    );

    const resourceCeiling = blankSimulation().serialize();
    resourceCeiling.resources = [
      { x: 1, y: 1, type: "iron", amount: Number.MAX_SAFE_INTEGER },
    ];
    const resourceGuard = FactorySimulation.restore(resourceCeiling);
    expect(resourceGuard.stats().resourcesRemaining.iron).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expectAtomicFailure(
      resourceGuard,
      () => resourceGuard.setResource(2, 1, "iron", 1),
      "Resource totals exceed safe integer range",
    );
    expect(
      resourceGuard.setResource(
        1,
        1,
        "iron",
        Number.MAX_SAFE_INTEGER,
      ),
    ).toBe(true);
  });
});

describe("Inserter custody and lane-accurate contacts", () => {
  it.each(INSERTER_BELT_ORIENTATIONS)(
    "matches authoritative belt contacts for inserter %i, source %i, target %i",
    (inserterDirection, sourceDirection, targetDirection) => {
      for (const sourceLane of [0, 1] as const) {
        const simulation = blankSimulation(18, 18, 0xc07ac7);
        const [inserterForwardX, inserterForwardY] =
          testDirectionVector(inserterDirection);
        const [sourceForwardX, sourceForwardY] =
          testDirectionVector(sourceDirection);
        const [targetForwardX, targetForwardY] =
          testDirectionVector(targetDirection);
        const inserterRightX = -inserterForwardY;
        const inserterRightY = inserterForwardX;
        const sourceRightX = -sourceForwardY;
        const sourceRightY = sourceForwardX;
        const targetRightX = -targetForwardY;
        const targetRightY = targetForwardX;
        const centerX = 9;
        const centerY = 9;

        const source = placeOrThrow(
          simulation,
          "belt",
          centerX - inserterForwardX,
          centerY - inserterForwardY,
          sourceDirection,
        );
        const inserter = placeOrThrow(
          simulation,
          "inserter",
          centerX,
          centerY,
          inserterDirection,
        );
        placeOrThrow(
          simulation,
          "belt",
          centerX + inserterForwardX,
          centerY + inserterForwardY,
          targetDirection,
        );
        expect(
          simulation.receive(source.id, "ironOre", 1, "belt", sourceLane),
        ).toBe(1);

        const rendered = toRenderSnapshot(simulation.getRenderSnapshot())
          .entities.find((entity) => entity.id === inserter.id)!;
        const sourceLaneOffset = sourceLane === 0 ? -0.17 : 0.17;
        const sourceContactAlignment =
          sourceForwardX * inserterForwardX +
          sourceForwardY * inserterForwardY;
        const pickupWorldX =
          -inserterForwardX +
          sourceForwardX * 0.5 * sourceContactAlignment +
          sourceRightX * sourceLaneOffset;
        const pickupWorldY =
          -inserterForwardY +
          sourceForwardY * 0.5 * sourceContactAlignment +
          sourceRightY * sourceLaneOffset;
        const dropWorldX =
          inserterForwardX -
          targetForwardX * 0.5 +
          targetRightX * 0.17;
        const dropWorldY =
          inserterForwardY -
          targetForwardY * 0.5 +
          targetRightY * 0.17;
        const expectedPickup = [
          pickupWorldX * inserterRightX +
            pickupWorldY * inserterRightY,
          -(
            pickupWorldX * inserterForwardX +
            pickupWorldY * inserterForwardY
          ),
        ];
        const expectedDrop = [
          dropWorldX * inserterRightX + dropWorldY * inserterRightY,
          -(
            dropWorldX * inserterForwardX +
            dropWorldY * inserterForwardY
          ),
        ];

        expect(rendered.pickupContact?.[0]).toBeCloseTo(
          expectedPickup[0]!,
          8,
        );
        expect(rendered.pickupContact?.[1]).toBeCloseTo(
          expectedPickup[1]!,
          8,
        );
        expect(rendered.dropContact?.[0]).toBeCloseTo(expectedDrop[0]!, 8);
        expect(rendered.dropContact?.[1]).toBeCloseTo(expectedDrop[1]!, 8);
      }
    },
  );

  it("preserves output-end custody until the payload reaches the belt exit", () => {
    const { simulation, source, inserter } = poweredInserterNetwork();
    simulation.step(31);
    expect(simulation.getEntity(inserter.id)?.heldItem).toBeUndefined();
    expect(simulation.getEntity(source.id)?.beltItems[0]?.progress)
      .toBeCloseTo(0.96875, 8);
    expect(stepToInserterPickup(simulation, inserter.id)).toBe(1);
    expect(simulation.getEntity(source.id)?.beltItems).toEqual([]);

    const state = simulation.getEntity(inserter.id);
    expect(state).toMatchObject({
      heldItem: "ironOre",
      heldItemSourceLane: 0,
      armReturning: false,
    });

    const rendered = toRenderSnapshot(simulation.getRenderSnapshot())
      .entities.find((entity) => entity.id === inserter.id);
    expect(rendered).toMatchObject({
      carriedItem: "ironOre",
      carriedItemColor: "#7892a2",
      armReturning: false,
      pickupContact: [-0.17, 0.5],
      dropContact: [0.17, -0.5],
    });

    const atContact = poweredInserterNetwork(0xc047ac7, false);
    atContact.simulation.step(32);
    expect(
      atContact.simulation.getEntity(atContact.source.id)?.beltItems[0]
        ?.progress,
    ).toBeCloseTo(1, 6);
    expect(
      atContact.simulation.getEntity(atContact.inserter.id)?.heldItem,
    ).toBeUndefined();
    expect(
      atContact.simulation.receive(
        atContact.generator.id,
        "coal",
        1,
        "fuel",
      ),
    ).toBe(1);
    atContact.simulation.step();
    expect(atContact.simulation.getEntity(atContact.inserter.id)).toMatchObject({
      heldItem: "ironOre",
      heldItemSourceLane: 0,
      armProgress: 0,
    });
  });

  it("claims moving cargo at a perpendicular mid-belt arm contact", () => {
    const simulation = blankSimulation(18, 12, 0x51de7a9);
    placeOrThrow(simulation, "belt", 4, 6, Direction.East);
    const source = placeOrThrow(
      simulation,
      "belt",
      5,
      6,
      Direction.East,
    );
    placeOrThrow(simulation, "belt", 6, 6, Direction.East);
    placeOrThrow(simulation, "belt", 7, 6, Direction.East);
    const inserter = placeOrThrow(
      simulation,
      "inserter",
      5,
      5,
      Direction.North,
    );
    const storage = placeOrThrow(
      simulation,
      "storage",
      4,
      3,
      Direction.North,
    );
    const generator = placeOrThrow(
      simulation,
      "generator",
      11,
      3,
      Direction.North,
    );
    expect(simulation.receive(generator.id, "coal", 1, "fuel")).toBe(1);
    expect(simulation.receive(source.id, "ironOre", 1, "belt", 0)).toBe(1);
    simulation.drainEvents();

    simulation.step(15);
    expect(simulation.getEntity(inserter.id)?.heldItem).toBeUndefined();
    expect(simulation.getEntity(source.id)?.beltItems[0]?.progress)
      .toBeCloseTo(0.46875, 8);
    simulation.step();
    expect(simulation.getEntity(inserter.id)).toMatchObject({
      heldItem: "ironOre",
      heldItemSourceLane: 0,
      armProgress: 0,
    });
    expect(simulation.getEntity(source.id)?.beltItems).toEqual([]);
    expect(simulation.getEntityAt(6, 6)?.beltItems).toEqual([]);
    expect(
      toRenderSnapshot(simulation.getRenderSnapshot()).entities.find(
        (entity) => entity.id === inserter.id,
      )?.pickupContact,
    ).toEqual([0, 0.83]);

    stepUntil(
      simulation,
      () => (simulation.getEntity(storage.id)?.inventory.ironOre ?? 0) === 1,
    );
    expect(simulation.getEntity(storage.id)?.inventory.ironOre).toBe(1);
  });

  it("side-picks only recipe-compatible cargo from mixed through traffic", () => {
    const simulation = blankSimulation(18, 12, 0xf117e7);
    placeOrThrow(simulation, "belt", 4, 6, Direction.East);
    const source = placeOrThrow(
      simulation,
      "belt",
      5,
      6,
      Direction.East,
    );
    placeOrThrow(simulation, "belt", 6, 6, Direction.East);
    placeOrThrow(simulation, "belt", 7, 6, Direction.East);
    const inserter = placeOrThrow(
      simulation,
      "inserter",
      5,
      5,
      Direction.North,
    );
    const fabricator = placeOrThrow(
      simulation,
      "fabricator",
      4,
      3,
      Direction.North,
      { recipeId: "ironGear" },
    );
    const generator = placeOrThrow(
      simulation,
      "generator",
      11,
      3,
      Direction.North,
    );
    expect(simulation.receive(generator.id, "coal", 1, "fuel")).toBe(1);
    expect(
      simulation.receive(source.id, "copperPlate", 1, "belt", 0),
    ).toBe(1);
    expect(
      simulation.receive(source.id, "ironPlate", 1, "belt", 1),
    ).toBe(1);
    simulation.drainEvents();

    simulation.step(16);
    expect(simulation.getEntity(inserter.id)).toMatchObject({
      heldItem: "ironPlate",
      heldItemSourceLane: 1,
    });
    expect(
      simulation.getEntities("belt").flatMap((belt) => belt.beltItems),
    ).toMatchObject([{ item: "copperPlate", lane: 0 }]);

    stepUntil(
      simulation,
      () => (simulation.getEntity(fabricator.id)?.input.ironPlate ?? 0) === 1,
    );
    expect(simulation.getEntity(fabricator.id)?.input).toEqual({
      ironPlate: 1,
    });
    expect(
      simulation.getEntities("belt").flatMap((belt) => belt.beltItems),
    ).toMatchObject([{ item: "copperPlate", lane: 0 }]);
  });

  it("keeps custody and source contact while blocked at the drop", () => {
    const { simulation, inserter, target } = poweredInserterNetwork(0xb10c);
    stepToInserterPickup(simulation, inserter.id);
    const congested = simulation.serialize();
    const serializedTarget = congested.entities.find(
      (entity) => entity.id === target.id,
    )!;
    for (let index = 0; index < 4; index += 1) {
      serializedTarget.beltItems.push({
        id: congested.nextBeltItemId + index,
        item: "coal",
        lane: 1,
        progress: 1 - 1e-7 - index * 0.25,
      });
    }
    congested.nextBeltItemId += 4;
    const blocked = FactorySimulation.restore(congested);

    stepUntil(
      blocked,
      () =>
        blocked.getEntity(inserter.id)?.status === "blocked" &&
        blocked.getEntity(inserter.id)?.armProgress === 1,
    );
    expect(blocked.getEntity(inserter.id)).toMatchObject({
      heldItem: "ironOre",
      heldItemSourceLane: 0,
      armProgress: 1,
      armReturning: false,
      status: "blocked",
    });
    expect(
      toRenderSnapshot(blocked.getRenderSnapshot()).entities.find(
        (entity) => entity.id === inserter.id,
      ),
    ).toMatchObject({
      carriedItem: "ironOre",
      pickupContact: [-0.17, 0.5],
      dropContact: [0.17, -0.5],
    });
  });

  it("drops into target lane 1, then clears custody only after returning", () => {
    const { simulation, inserter, target } = poweredInserterNetwork(0xd20f);
    stepToInserterPickup(simulation, inserter.id);
    stepUntil(
      simulation,
      () => simulation.getEntity(inserter.id)?.armReturning === true,
    );

    expect(simulation.getEntity(inserter.id)).toMatchObject({
      armProgress: 1,
      armReturning: true,
      heldItemSourceLane: 0,
    });
    expect(simulation.getEntity(inserter.id)?.heldItem).toBeUndefined();
    expect(simulation.getEntity(target.id)?.beltItems).toMatchObject([
      { item: "ironOre", lane: 1, progress: 0 },
    ]);
    expect(
      simulation
        .drainEvents()
        .filter((event) => event.type === "itemTransferred"),
    ).toHaveLength(1);

    stepUntil(
      simulation,
      () => simulation.getEntity(inserter.id)?.armProgress === 0,
    );
    expect(simulation.getEntity(inserter.id)).toMatchObject({
      armProgress: 0,
      armReturning: false,
    });
    expect(
      simulation.getEntity(inserter.id)?.heldItemSourceLane,
    ).toBeUndefined();
  });

  it("round-trips mid-carry deterministically and validates custody metadata", () => {
    const { simulation, inserter, target } = poweredInserterNetwork(0x5a7e);
    stepToInserterPickup(simulation, inserter.id);
    simulation.step(14);
    expect(simulation.getEntity(inserter.id)?.armProgress).toBeGreaterThan(0);
    expect(simulation.getEntity(inserter.id)?.armProgress).toBeLessThan(1);

    const serialized = simulation.serialize();
    const restored = FactorySimulation.restore(
      JSON.parse(JSON.stringify(serialized)),
    );
    expect(restored.serialize()).toEqual(serialized);
    for (const delta of [1 / 144, 0.25, 1 / 30, 0.75, 1.125]) {
      simulation.tick(delta);
      restored.tick(delta);
    }
    expect(restored.serialize()).toEqual(simulation.serialize());

    const oldCompatible = JSON.parse(JSON.stringify(serialized));
    delete oldCompatible.entities.find(
      (entity: { id: number }) => entity.id === inserter.id,
    ).heldItemSourceLane;
    expect(() => FactorySimulation.restore(oldCompatible)).not.toThrow();

    const invalidLane = JSON.parse(JSON.stringify(serialized));
    invalidLane.entities.find(
      (entity: { id: number }) => entity.id === inserter.id,
    ).heldItemSourceLane = 2;
    expect(() => FactorySimulation.restore(invalidLane)).toThrow(
      "invalid inserter custody",
    );

    const invalidOwner = JSON.parse(JSON.stringify(serialized));
    invalidOwner.entities.find(
      (entity: { id: number }) => entity.id === target.id,
    ).heldItemSourceLane = 0;
    expect(() => FactorySimulation.restore(invalidOwner)).toThrow(
      "invalid inserter custody",
    );

    const external = poweredInserterNetwork(0xe471);
    stepToInserterPickup(external.simulation, external.inserter.id);
    expect(
      external.simulation.transfer(
        external.inserter.id,
        external.target.id,
        "ironOre",
      ),
    ).toMatchObject({ item: "ironOre", moved: 1 });
    expect(external.simulation.getEntity(external.inserter.id)?.heldItem)
      .toBeUndefined();
    expect(
      external.simulation.getEntity(external.inserter.id)?.heldItemSourceLane,
    ).toBeUndefined();
  });

  it("previews and claims the compatible lane without snapping past an incompatible leader", () => {
    const simulation = blankSimulation(18, 12, 0x5a9);
    const source = placeOrThrow(
      simulation,
      "belt",
      4,
      5,
      Direction.East,
    );
    const inserter = placeOrThrow(
      simulation,
      "inserter",
      5,
      5,
      Direction.East,
    );
    const smelter = placeOrThrow(
      simulation,
      "smelter",
      6,
      4,
      Direction.East,
      { recipeId: "smeltIron" },
    );
    const generator = placeOrThrow(
      simulation,
      "generator",
      11,
      4,
      Direction.East,
    );
    expect(simulation.receive(generator.id, "coal", 1, "fuel")).toBe(1);
    expect(simulation.receive(source.id, "copperOre", 1, "belt", 0)).toBe(1);
    expect(simulation.receive(source.id, "ironOre", 1, "belt", 1)).toBe(1);
    simulation.drainEvents();

    const previewSnapshot = simulation.getRenderSnapshot();
    const previewState = previewSnapshot.entities.find(
      (entity) => entity.id === inserter.id,
    );
    const previewRender = toRenderSnapshot(previewSnapshot).entities.find(
      (entity) => entity.id === inserter.id,
    );
    expect(previewState).toMatchObject({
      inserterPickupItem: "ironOre",
      inserterPickupLane: 1,
    });
    expect(previewRender?.pickupContact).toEqual([0.17, 0.5]);

    stepUntil(
      simulation,
      () => simulation.getEntity(inserter.id)?.heldItem !== undefined,
    );
    expect(simulation.getEntity(inserter.id)).toMatchObject({
      heldItem: "ironOre",
      heldItemSourceLane: 1,
    });
    expect(simulation.getEntity(source.id)?.beltItems).toMatchObject([
      { item: "copperOre", lane: 0 },
    ]);
    expect(simulation.getEntity(smelter.id)?.input).toEqual({});
    expect(
      toRenderSnapshot(simulation.getRenderSnapshot()).entities.find(
        (entity) => entity.id === inserter.id,
      )?.pickupContact,
    ).toEqual(previewRender?.pickupContact);
  });

  it("preserves source-lane contact through a committed external mid-stroke transfer", () => {
    const { simulation, source, inserter, target, generator } =
      poweredInserterNetwork(0x4e7);
    stepToInserterPickup(simulation, inserter.id);
    simulation.step(14);
    const before = simulation.getEntity(inserter.id)!;
    expect(before.armProgress).toBeGreaterThan(0);
    expect(before.armProgress).toBeLessThan(1);
    expect(simulation.receive(source.id, "ironOre", 1, "belt", 1)).toBe(1);

    const contactBefore = toRenderSnapshot(
      simulation.getRenderSnapshot(),
    ).entities.find((entity) => entity.id === inserter.id)?.pickupContact;
    expect(contactBefore).toEqual([-0.17, 0.5]);
    expect(
      simulation.transfer(inserter.id, generator.id, "ironOre"),
    ).toMatchObject({ item: "ironOre", moved: 0 });
    expect(simulation.getEntity(inserter.id)).toMatchObject({
      heldItem: "ironOre",
      heldItemSourceLane: 0,
      armProgress: before.armProgress,
      armReturning: false,
    });
    expect(
      simulation.transfer(inserter.id, target.id, "ironOre"),
    ).toMatchObject({ item: "ironOre", moved: 1 });
    expect(simulation.getEntity(inserter.id)).toMatchObject({
      heldItem: undefined,
      heldItemSourceLane: 0,
      armProgress: before.armProgress,
      armReturning: true,
    });

    simulation.step();
    expect(
      toRenderSnapshot(simulation.getRenderSnapshot()).entities.find(
        (entity) => entity.id === inserter.id,
      )?.pickupContact,
    ).toEqual(contactBefore);
    stepUntil(
      simulation,
      () => simulation.getEntity(inserter.id)?.armProgress === 0,
    );
    expect(simulation.getEntity(inserter.id)?.heldItemSourceLane)
      .toBeUndefined();
    expect(simulation.getRenderSnapshot().entities.find(
      (entity) => entity.id === inserter.id,
    )).toMatchObject({
      inserterPickupItem: "ironOre",
      inserterPickupLane: 1,
    });
  });

  it("hands cargo between inserters only at their shared drop contact", () => {
    const simulation = blankSimulation(18, 12, 0x4a11d0ff);
    const sourceBelt = placeOrThrow(
      simulation,
      "belt",
      3,
      5,
      Direction.East,
    );
    const sourceInserter = placeOrThrow(
      simulation,
      "inserter",
      4,
      5,
      Direction.East,
    );
    const temporaryTarget = placeOrThrow(
      simulation,
      "belt",
      5,
      5,
      Direction.East,
    );
    const generator = placeOrThrow(
      simulation,
      "generator",
      10,
      4,
      Direction.East,
    );
    expect(simulation.receive(generator.id, "coal", 1, "fuel")).toBe(1);
    expect(
      simulation.receive(sourceBelt.id, "ironOre", 1, "belt", 0),
    ).toBe(1);

    stepToInserterPickup(simulation, sourceInserter.id);
    simulation.step(10);
    const beforeHandoff = simulation.getEntity(sourceInserter.id)!;
    expect(beforeHandoff.armProgress).toBeGreaterThan(0);
    expect(beforeHandoff.armProgress).toBeLessThan(1);

    expect(simulation.remove(temporaryTarget.x, temporaryTarget.y)?.id)
      .toBe(temporaryTarget.id);
    const targetInserter = placeOrThrow(
      simulation,
      "inserter",
      5,
      5,
      Direction.East,
    );
    placeOrThrow(simulation, "belt", 6, 5, Direction.East);

    simulation.step();
    expect(simulation.getEntity(sourceInserter.id)).toMatchObject({
      heldItem: "ironOre",
      armReturning: false,
    });
    expect(
      simulation.getEntity(sourceInserter.id)?.armProgress,
    ).toBeGreaterThan(beforeHandoff.armProgress);
    expect(simulation.getEntity(targetInserter.id)?.heldItem).toBeUndefined();
    expect(simulation.getEntity(targetInserter.id)?.armProgress).toBe(0);

    stepUntil(
      simulation,
      () => simulation.getEntity(targetInserter.id)?.heldItem === "ironOre",
    );
    expect(simulation.getEntity(sourceInserter.id)?.heldItem).toBeUndefined();
    expect(simulation.getEntity(sourceInserter.id)).toMatchObject({
      armProgress: 1,
      armReturning: true,
      status: "working",
    });
    expect(simulation.getEntity(targetInserter.id)).toMatchObject({
      heldItem: "ironOre",
      armProgress: 0,
      armReturning: false,
    });
  });

  it("rejects corrupt inserter item ownership and arm phase state", () => {
    const { simulation, inserter, target } =
      poweredInserterNetwork(0xc0570d7);
    stepToInserterPickup(simulation, inserter.id);
    simulation.step(10);
    const serialized = simulation.serialize();
    const inserterState = () =>
      JSON.parse(JSON.stringify(serialized)).entities.find(
        (entity: { id: number }) => entity.id === inserter.id,
      );
    const targetState = () =>
      JSON.parse(JSON.stringify(serialized)).entities.find(
        (entity: { id: number }) => entity.id === target.id,
      );

    const corruptions: Array<{
      snapshot: ReturnType<FactorySimulation["serialize"]>;
      message: string;
    }> = [];
    const withMutation = (
      owner: "inserter" | "target",
      mutate: (entity: Record<string, unknown>) => void,
      message: string,
    ) => {
      const snapshot = JSON.parse(JSON.stringify(serialized));
      const entity = snapshot.entities.find(
        (candidate: { id: number }) =>
          candidate.id === (owner === "inserter" ? inserter.id : target.id),
      );
      mutate(entity);
      corruptions.push({ snapshot, message });
    };

    withMutation(
      "inserter",
      (entity) => { entity.heldItem = "notAnItem"; },
      "invalid inserter custody",
    );
    withMutation(
      "target",
      (entity) => { entity.heldItem = "ironOre"; },
      "invalid inserter custody",
    );
    for (const armProgress of [-0.01, 1.01, Number.NaN]) {
      const snapshot = structuredClone(serialized);
      const entity = snapshot.entities.find(
        (candidate) => candidate.id === inserter.id,
      )!;
      entity.armProgress = armProgress;
      corruptions.push({
        snapshot,
        message: "invalid inserter phase",
      });
    }
    withMutation(
      "inserter",
      (entity) => { entity.armReturning = "yes"; },
      "invalid inserter phase",
    );
    withMutation(
      "inserter",
      (entity) => { entity.armReturning = true; },
      "invalid inserter custody",
    );
    withMutation(
      "target",
      (entity) => { entity.armProgress = 0.25; },
      "inserter phase state on another entity",
    );
    withMutation(
      "target",
      (entity) => { entity.armReturning = true; },
      "inserter phase state on another entity",
    );

    const orphanLane = simulation.serialize();
    const orphan = orphanLane.entities.find(
      (entity) => entity.id === inserter.id,
    )!;
    orphan.heldItem = undefined;
    orphan.armProgress = 0;
    orphan.armReturning = false;
    orphan.heldItemSourceLane = 0;
    corruptions.push({
      snapshot: orphanLane,
      message: "invalid inserter custody",
    });

    const orphanPhase = simulation.serialize();
    const movingEmpty = orphanPhase.entities.find(
      (entity) => entity.id === inserter.id,
    )!;
    movingEmpty.heldItem = undefined;
    movingEmpty.armProgress = 0.4;
    movingEmpty.armReturning = false;
    movingEmpty.heldItemSourceLane = undefined;
    corruptions.push({
      snapshot: orphanPhase,
      message: "invalid inserter custody",
    });

    for (const { snapshot, message } of corruptions) {
      expect(() => FactorySimulation.restore(snapshot)).toThrow(message);
    }
    expect(inserterState()).toBeDefined();
    expect(targetState()).toBeDefined();
  });

  it("rejects direct inserter/manifold custody atomically and requires belt adapters", () => {
    const sourceSide = blankSimulation(18, 12, 0xadab7);
    const manifoldSource = placeOrThrow(
      sourceSide,
      "manifold",
      3,
      5,
      Direction.East,
    );
    const sourceInserter = placeOrThrow(
      sourceSide,
      "inserter",
      5,
      5,
      Direction.East,
    );
    placeOrThrow(sourceSide, "belt", 6, 5, Direction.East);
    const sourceGenerator = placeOrThrow(
      sourceSide,
      "generator",
      11,
      4,
      Direction.East,
    );
    expect(sourceSide.receive(sourceGenerator.id, "coal", 1, "fuel")).toBe(1);
    expect(sourceSide.receive(manifoldSource.id, "ironOre", 1, "belt", 0))
      .toBe(1);
    const sourceCount = sourceSide.stats().stored.ironOre;
    sourceSide.step(90);
    expect(sourceSide.getEntity(sourceInserter.id)?.heldItem).toBeUndefined();
    expect(sourceSide.stats().stored.ironOre).toBe(sourceCount);
    expect(
      sourceSide.transfer(manifoldSource.id, sourceInserter.id, "ironOre"),
    ).toMatchObject({ item: "ironOre", moved: 0 });
    expect(sourceSide.stats().stored.ironOre).toBe(sourceCount);

    const targetSide = blankSimulation(18, 12, 0xadab8);
    const sourceBelt = placeOrThrow(
      targetSide,
      "belt",
      4,
      5,
      Direction.East,
    );
    const targetInserter = placeOrThrow(
      targetSide,
      "inserter",
      5,
      5,
      Direction.East,
    );
    const manifoldTarget = placeOrThrow(
      targetSide,
      "manifold",
      6,
      5,
      Direction.East,
    );
    const targetGenerator = placeOrThrow(
      targetSide,
      "generator",
      11,
      4,
      Direction.East,
    );
    expect(targetSide.receive(targetGenerator.id, "coal", 1, "fuel")).toBe(1);
    expect(targetSide.receive(sourceBelt.id, "ironOre", 1, "belt", 0)).toBe(1);
    targetSide.step(90);
    expect(targetSide.getEntity(targetInserter.id)?.heldItem).toBeUndefined();
    expect(targetSide.getEntity(sourceBelt.id)?.beltItems).toHaveLength(1);

    const carriedSave = targetSide.serialize();
    const serializedSource = carriedSave.entities.find(
      (entity) => entity.id === sourceBelt.id,
    )!;
    serializedSource.beltItems = [];
    const serializedInserter = carriedSave.entities.find(
      (entity) => entity.id === targetInserter.id,
    )!;
    serializedInserter.heldItem = "ironOre";
    serializedInserter.heldItemSourceLane = 0;
    serializedInserter.armProgress = 0;
    serializedInserter.armReturning = false;
    const carried = FactorySimulation.restore(carriedSave);
    expect(
      carried.transfer(targetInserter.id, manifoldTarget.id, "ironOre"),
    ).toMatchObject({ item: "ironOre", moved: 0 });
    expect(carried.getEntity(targetInserter.id)).toMatchObject({
      heldItem: "ironOre",
      heldItemSourceLane: 0,
    });
    carried.step(90);
    expect(carried.getEntity(targetInserter.id)?.heldItem).toBe("ironOre");
    expect(carried.stats().stored.ironOre).toBe(1);
  });
});

describe("Dispatch manifold routing", () => {
  it("splits successful handoffs evenly while preserving both belt lanes", () => {
    const simulation = blankSimulation(18, 14);
    const manifold = eastManifold(simulation);
    const outputA = placeOrThrow(
      simulation,
      "belt",
      7,
      5,
      Direction.North,
    );
    const outputB = placeOrThrow(
      simulation,
      "belt",
      7,
      7,
      Direction.South,
    );
    simulation.drainEvents();

    for (let pulse = 0; pulse < 4; pulse += 1) {
      expect(simulation.receive(manifold.id, "ironOre", 1, "belt", 0)).toBe(1);
      expect(simulation.receive(manifold.id, "ironOre", 1, "belt", 1)).toBe(1);
      simulation.step(8);
    }
    simulation.step(240);

    const a = simulation.getEntity(outputA.id)!;
    const b = simulation.getEntity(outputB.id)!;
    expect(a.beltItems).toHaveLength(4);
    expect(b.beltItems).toHaveLength(4);
    for (const output of [a, b]) {
      expect(output.beltItems.filter((item) => item.lane === 0)).toHaveLength(2);
      expect(output.beltItems.filter((item) => item.lane === 1)).toHaveLength(2);
      expect(output.beltItems.every((item) => item.port === undefined)).toBe(
        true,
      );
    }
    expect(simulation.stats().stored.ironOre).toBe(8);
    expect(simulation.getEntity(manifold.id)?.manifoldRouting).toMatchObject({
      mode: ManifoldMode.Even,
      splitCursors: [0, 1],
    });
  });

  it("fairly merges ready A/B payloads and only advances on success", () => {
    const simulation = blankSimulation(18, 14);
    const manifold = eastManifold(simulation);
    const inputA = placeOrThrow(
      simulation,
      "belt",
      7,
      5,
      Direction.South,
    );
    const inputB = placeOrThrow(
      simulation,
      "belt",
      7,
      7,
      Direction.North,
    );
    const output = placeOrThrow(
      simulation,
      "belt",
      5,
      6,
      Direction.West,
    );
    simulation.drainEvents();

    for (let index = 0; index < 4; index += 1) {
      expect(
        simulation.receive(inputA.id, "ironOre", 1, "belt", 0),
      ).toBe(1);
      expect(
        simulation.receive(inputB.id, "copperOre", 1, "belt", 0),
      ).toBe(1);
      simulation.step(8);
    }
    simulation.step(300);

    const merged = simulation
      .getEntity(output.id)!
      .beltItems.filter((item) => item.lane === 0)
      .sort((a, b) => b.progress - a.progress || a.id - b.id)
      .map((item) => item.item);
    expect(merged).toEqual([
      "ironOre",
      "copperOre",
      "ironOre",
      "copperOre",
    ]);

    const routingBeforeBlockedSteps =
      simulation.getEntity(manifold.id)!.manifoldRouting!;
    simulation.step(120);
    expect(simulation.getEntity(manifold.id)?.manifoldRouting).toEqual(
      routingBeforeBlockedSteps,
    );
    expect(simulation.stats().stored.ironOre).toBe(4);
    expect(simulation.stats().stored.copperOre).toBe(4);
  });

  it("keeps merge arbitration independent between preserved belt lanes", () => {
    const makeNetwork = (withLaneZeroTraffic: boolean) => {
      const simulation = blankSimulation(18, 14);
      const manifold = eastManifold(simulation);
      const inputA = placeOrThrow(
        simulation,
        "belt",
        7,
        5,
        Direction.South,
      );
      const inputB = placeOrThrow(
        simulation,
        "belt",
        7,
        7,
        Direction.North,
      );
      const output = placeOrThrow(
        simulation,
        "belt",
        5,
        6,
        Direction.West,
      );
      expect(simulation.receive(inputA.id, "ironOre", 1, "belt", 1)).toBe(1);
      expect(simulation.receive(inputB.id, "copperOre", 1, "belt", 1)).toBe(1);
      if (withLaneZeroTraffic) {
        expect(simulation.receive(inputA.id, "coal", 1, "belt", 0)).toBe(1);
      }
      simulation.step(180);
      return simulation
        .getEntity(output.id)!
        .beltItems.filter((item) => item.lane === 1)
        .sort((a, b) => b.progress - a.progress || a.id - b.id)
        .map((item) => item.item);
    };

    const isolated = makeNetwork(false);
    const withUnrelatedTraffic = makeNetwork(true);
    expect(isolated).toEqual(["copperOre", "ironOre"]);
    expect(withUnrelatedTraffic).toEqual(isolated);
  });

  it("rejects inward-facing belts as split and merge outputs", () => {
    const split = blankSimulation(18, 14);
    const splitter = eastManifold(split);
    const inwardBranchB = placeOrThrow(
      split,
      "belt",
      7,
      7,
      Direction.North,
    );
    expect(
      split.setManifoldRouting(splitter.id, {
        mode: ManifoldMode.Extract,
        filter: "copperOre",
      }),
    ).toBe(true);
    expect(split.receive(splitter.id, "ironOre", 1, "belt", 0)).toBe(1);
    split.step(120);
    expect(split.getEntity(inwardBranchB.id)?.beltItems).toEqual([]);
    expect(split.getEntity(splitter.id)?.beltItems).toMatchObject([
      { item: "ironOre", lane: 0, progress: expect.closeTo(1, 5) },
    ]);
    expect(split.getEntity(splitter.id)?.status).toBe("blocked");

    const merge = blankSimulation(18, 14);
    const merger = eastManifold(merge);
    const inputA = placeOrThrow(
      merge,
      "belt",
      7,
      5,
      Direction.South,
    );
    const inwardCommon = placeOrThrow(
      merge,
      "belt",
      5,
      6,
      Direction.East,
    );
    expect(merge.receive(inputA.id, "ironOre", 1, "belt", 1)).toBe(1);
    merge.step(180);
    expect(merge.getEntity(inwardCommon.id)?.beltItems).toEqual([]);
    expect(merge.getEntity(merger.id)?.beltItems).toMatchObject([
      { item: "ironOre", lane: 1, port: 0, progress: expect.closeTo(1, 5) },
    ]);
    expect(merge.getEntity(merger.id)?.status).toBe("blocked");
  });

  it.each([
    [ManifoldMode.FavorA, 0, 1],
    [ManifoldMode.FavorB, 1, 0],
  ] as const)(
    "%s prefers its named branch and overflows to the available branch",
    (mode, preferredPort, overflowPort) => {
      const preferred = blankSimulation(18, 14);
      const preferredManifold = eastManifold(preferred);
      expect(
        preferred.setManifoldRouting(preferredManifold.id, { mode }),
      ).toBe(true);
      const preferredOutput = placeOrThrow(
        preferred,
        "belt",
        7,
        preferredPort === 0 ? 5 : 7,
        preferredPort === 0 ? Direction.North : Direction.South,
      );
      feedTransportLane(preferred, preferredManifold.id, "stone", 2, 0);
      preferred.step(180);
      expect(
        preferred.getEntity(preferredOutput.id)?.beltItems.map(
          (item) => item.item,
        ),
      ).toEqual(["stone", "stone"]);

      const overflow = blankSimulation(18, 14);
      const overflowManifold = eastManifold(overflow);
      expect(
        overflow.setManifoldRouting(overflowManifold.id, { mode }),
      ).toBe(true);
      const overflowOutput = placeOrThrow(
        overflow,
        "belt",
        7,
        overflowPort === 0 ? 5 : 7,
        overflowPort === 0 ? Direction.North : Direction.South,
      );
      feedTransportLane(overflow, overflowManifold.id, "coal", 2, 0);
      overflow.step(180);
      expect(
        overflow.getEntity(overflowOutput.id)?.beltItems.map(
          (item) => item.item,
        ),
      ).toEqual(["coal", "coal"]);
      expect(overflow.stats().stored.coal).toBe(2);
    },
  );

  it.each([0, 1] as const)(
    "routes Extract matches exclusively to local port %i and remainders to its opposite",
    (extractPort) => {
      const simulation = blankSimulation(18, 14);
      const manifold = eastManifold(simulation);
      const outputA = placeOrThrow(
        simulation,
        "belt",
        7,
        5,
        Direction.North,
      );
      const outputB = placeOrThrow(
        simulation,
        "belt",
        7,
        7,
        Direction.South,
      );
      expect(
        simulation.setManifoldRouting(manifold.id, {
          mode: ManifoldMode.Extract,
          filter: "copperPlate",
          extractPort,
        }),
      ).toBe(true);

      expect(
        simulation.receive(manifold.id, "copperPlate", 1, "belt", 0),
      ).toBe(1);
      expect(
        simulation.receive(manifold.id, "ironPlate", 1, "belt", 1),
      ).toBe(1);
      simulation.step(180);

      const outputs = [
        simulation.getEntity(outputA.id)!.beltItems,
        simulation.getEntity(outputB.id)!.beltItems,
      ] as const;
      expect(outputs[extractPort].map((item) => item.item)).toEqual([
        "copperPlate",
      ]);
      expect(outputs[extractPort === 0 ? 1 : 0].map((item) => item.item)).toEqual([
        "ironPlate",
      ]);
      expect(
        outputs.flat().every((item) => item.port === undefined),
      ).toBe(true);
      expect(simulation.getEntity(manifold.id)?.manifoldRouting).toMatchObject({
        mode: ManifoldMode.Extract,
        filter: "copperPlate",
        extractPort,
      });
    },
  );

  it.each([0, 1] as const)(
    "enforces mirrored Extract purity for valid and invalid ingress on local port %i",
    (extractPort) => {
      const accepted = blankSimulation(18, 14);
      const acceptedManifold = eastManifold(accepted);
      expect(
        accepted.setManifoldRouting(acceptedManifold.id, {
          mode: ManifoldMode.Extract,
          filter: "copperOre",
          extractPort,
        }),
      ).toBe(true);
      const acceptedA = placeOrThrow(
        accepted,
        "belt",
        7,
        5,
        Direction.South,
      );
      const acceptedB = placeOrThrow(
        accepted,
        "belt",
        7,
        7,
        Direction.North,
      );
      const commonOutput = placeOrThrow(
        accepted,
        "belt",
        5,
        6,
        Direction.West,
      );
      const inputs = [acceptedA, acceptedB] as const;
      expect(
        accepted.receive(
          inputs[extractPort].id,
          "copperOre",
          1,
          "belt",
          0,
        ),
      ).toBe(1);
      expect(
        accepted.receive(
          inputs[extractPort === 0 ? 1 : 0].id,
          "ironOre",
          1,
          "belt",
          1,
        ),
      ).toBe(1);
      accepted.step(180);
      expect(
        accepted
          .getEntity(commonOutput.id)!
          .beltItems.map((item) => item.item)
          .sort(),
      ).toEqual(["copperOre", "ironOre"]);

      const rejected = blankSimulation(18, 14);
      const rejectedManifold = eastManifold(rejected);
      expect(
        rejected.setManifoldRouting(rejectedManifold.id, {
          mode: ManifoldMode.Extract,
          filter: "copperOre",
          extractPort,
        }),
      ).toBe(true);
      const rejectedA = placeOrThrow(
        rejected,
        "belt",
        7,
        5,
        Direction.South,
      );
      const rejectedB = placeOrThrow(
        rejected,
        "belt",
        7,
        7,
        Direction.North,
      );
      placeOrThrow(rejected, "belt", 5, 6, Direction.West);
      const rejectedInputs = [rejectedA, rejectedB] as const;
      expect(
        rejected.receive(
          rejectedInputs[extractPort].id,
          "ironOre",
          1,
          "belt",
          0,
        ),
      ).toBe(1);
      expect(
        rejected.receive(
          rejectedInputs[extractPort === 0 ? 1 : 0].id,
          "copperOre",
          1,
          "belt",
          1,
        ),
      ).toBe(1);
      rejected.step(180);
      expect(rejected.getEntity(rejectedManifold.id)?.beltItems).toEqual([]);
      expect(rejected.getEntity(rejectedInputs[extractPort].id)?.beltItems)
        .toMatchObject([{ item: "ironOre" }]);
      expect(
        rejected.getEntity(rejectedInputs[extractPort === 0 ? 1 : 0].id)
          ?.beltItems,
      ).toMatchObject([{ item: "copperOre" }]);
    },
  );

  it("extracts with strict branch purity and backpressures instead of leaking", () => {
    const simulation = blankSimulation(18, 14);
    const manifold = eastManifold(simulation);
    expect(
      simulation.setManifoldRouting(manifold.id, {
        mode: ManifoldMode.Extract,
        filter: "copperPlate",
      }),
    ).toBe(true);
    const outputA = placeOrThrow(
      simulation,
      "belt",
      7,
      5,
      Direction.North,
    );
    const outputB = placeOrThrow(
      simulation,
      "belt",
      7,
      7,
      Direction.South,
    );

    feedTransportLane(simulation, manifold.id, "copperPlate", 5, 0);
    feedTransportLane(simulation, manifold.id, "ironPlate", 2, 1);
    simulation.step(360);

    const aItems = simulation.getEntity(outputA.id)!.beltItems;
    const bItems = simulation.getEntity(outputB.id)!.beltItems;
    expect(aItems).toHaveLength(4);
    expect(aItems.every((item) => item.item === "copperPlate")).toBe(true);
    expect(bItems).toHaveLength(2);
    expect(bItems.every((item) => item.item === "ironPlate")).toBe(true);

    const buffered = simulation.getEntity(manifold.id)!.beltItems;
    expect(buffered).toHaveLength(1);
    expect(buffered[0]).toMatchObject({
      item: "copperPlate",
      lane: 0,
    });
    expect(buffered[0]?.port).toBeUndefined();
    expect(simulation.getEntity(manifold.id)?.status).toBe("blocked");
    expect(simulation.stats().stored.copperPlate).toBe(5);
    expect(simulation.stats().stored.ironPlate).toBe(2);
  });

  it("enforces Extract purity on reverse branch ingress as atomic backpressure", () => {
    const simulation = blankSimulation(18, 14);
    const manifold = eastManifold(simulation);
    expect(
      simulation.setManifoldRouting(manifold.id, {
        mode: ManifoldMode.Extract,
        filter: "copperOre",
      }),
    ).toBe(true);
    const inputA = placeOrThrow(
      simulation,
      "belt",
      7,
      5,
      Direction.South,
    );
    const inputB = placeOrThrow(
      simulation,
      "belt",
      7,
      7,
      Direction.North,
    );
    placeOrThrow(simulation, "belt", 5, 6, Direction.West);
    expect(simulation.receive(inputA.id, "ironOre", 1, "belt", 0)).toBe(1);
    expect(simulation.receive(inputB.id, "copperOre", 1, "belt", 1)).toBe(1);

    simulation.step(180);

    expect(simulation.getEntity(manifold.id)?.beltItems).toEqual([]);
    expect(simulation.getEntity(inputA.id)?.beltItems).toMatchObject([
      { item: "ironOre", lane: 0 },
    ]);
    expect(simulation.getEntity(inputB.id)?.beltItems).toMatchObject([
      { item: "copperOre", lane: 1 },
    ]);
    expect(simulation.stats().stored.ironOre).toBe(1);
    expect(simulation.stats().stored.copperOre).toBe(1);
  });

  it("changes configuration atomically and rejects invalid or impure state", () => {
    const simulation = blankSimulation(18, 14);
    const manifold = eastManifold(simulation);
    const storage = placeOrThrow(
      simulation,
      "storage",
      11,
      4,
      Direction.East,
    );
    const initial = simulation.getEntity(manifold.id)!.manifoldRouting;

    expect(
      simulation.setManifoldRouting(storage.id, {
        mode: ManifoldMode.FavorA,
      }),
    ).toBe(false);
    expect(
      simulation.setManifoldRouting(manifold.id, {
        mode: ManifoldMode.Extract,
      }),
    ).toBe(false);
    expect(
      simulation.setManifoldRouting(manifold.id, {
        mode: ManifoldMode.Even,
        filter: "coal",
      }),
    ).toBe(false);
    expect(
      simulation.setManifoldRouting(manifold.id, {
        mode: "unknown",
      } as never),
    ).toBe(false);
    for (const extractPort of [-0, -1, 2, 0.5, Number.NaN, null] as const) {
      expect(
        simulation.setManifoldRouting(manifold.id, {
          mode: ManifoldMode.Extract,
          filter: "coal",
          extractPort,
        } as never),
      ).toBe(false);
    }
    expect(simulation.getEntity(manifold.id)?.manifoldRouting).toEqual(initial);

    expect(
      simulation.setManifoldRouting(manifold.id, {
        mode: ManifoldMode.FavorB,
      }),
    ).toBe(true);
    expect(simulation.getEntity(manifold.id)?.manifoldRouting).toEqual({
      mode: ManifoldMode.FavorB,
      extractPort: 0,
      splitCursors: [0, 1],
      mergeCursors: [0, 1],
    });

    const detached = simulation.getEntity(manifold.id)!;
    detached.manifoldRouting!.splitCursors[0] = 1;
    detached.beltItems.push({
      id: 999,
      item: "coal",
      lane: 0,
      progress: 0,
    });
    expect(
      simulation.getEntity(manifold.id)?.manifoldRouting?.splitCursors,
    ).toEqual([0, 1]);
    expect(simulation.getEntity(manifold.id)?.beltItems).toEqual([]);

    const occupied = blankSimulation(18, 14);
    const occupiedManifold = eastManifold(occupied);
    const inputA = placeOrThrow(
      occupied,
      "belt",
      7,
      5,
      Direction.South,
    );
    expect(occupied.receive(inputA.id, "coal", 1, "belt", 0)).toBe(1);
    occupied.step(40);
    expect(occupied.getEntity(occupiedManifold.id)?.beltItems).toMatchObject([
      { item: "coal", port: 0 },
    ]);
    const occupiedBefore = occupied.serializeToString();
    expect(
      occupied.setManifoldRouting(occupiedManifold.id, {
        mode: ManifoldMode.Extract,
        filter: "coal",
        extractPort: 1,
      }),
    ).toBe(false);
    expect(occupied.serializeToString()).toBe(occupiedBefore);
  });

  it("stores the Extract port as latent configuration through other routing modes", () => {
    const simulation = blankSimulation(18, 14);
    const manifold = eastManifold(simulation);
    expect(
      simulation.setManifoldRouting(manifold.id, {
        mode: ManifoldMode.Extract,
        filter: "copperOre",
        extractPort: 1,
      }),
    ).toBe(true);
    expect(
      simulation.setManifoldRouting(manifold.id, {
        mode: ManifoldMode.Even,
        extractPort: 1,
      }),
    ).toBe(true);
    expect(simulation.getEntity(manifold.id)?.manifoldRouting).toEqual({
      mode: ManifoldMode.Even,
      extractPort: 1,
      splitCursors: [0, 1],
      mergeCursors: [0, 1],
    });
    expect(
      simulation.setManifoldRouting(manifold.id, {
        mode: ManifoldMode.Extract,
        filter: "ironOre",
        extractPort: 1,
      }),
    ).toBe(true);
    expect(simulation.getEntity(manifold.id)?.manifoldRouting).toMatchObject({
      mode: ManifoldMode.Extract,
      filter: "ironOre",
      extractPort: 1,
    });
  });

  it("serializes branch cargo/cursors, rotates local A/B intact, and continues exactly", () => {
    const simulation = blankSimulation(24, 18, 0x4d4e);
    const manifold = eastManifold(simulation, 8, 8);
    expect(
      simulation.setManifoldRouting(manifold.id, {
        mode: ManifoldMode.Extract,
        filter: "ironGear",
        extractPort: 1,
      }),
    ).toBe(true);
    const inputB = placeOrThrow(
      simulation,
      "belt",
      9,
      9,
      Direction.North,
    );
    expect(simulation.receive(inputB.id, "ironGear", 1, "belt", 1)).toBe(1);
    simulation.step(40);

    const beforeRotate = simulation.getEntity(manifold.id)!;
    expect(beforeRotate.beltItems).toHaveLength(1);
    expect(beforeRotate.beltItems[0]).toMatchObject({
      item: "ironGear",
      lane: 1,
      port: 1,
    });
    expect(beforeRotate.manifoldRouting?.extractPort).toBe(1);
    const routingBeforeRotate = beforeRotate.manifoldRouting;
    const payloadBeforeRotate = { ...beforeRotate.beltItems[0]! };

    expect(simulation.remove(9, 9)?.id).toBe(inputB.id);
    expect(simulation.rotate(8, 8, true)).toMatchObject({ ok: true });
    expect(simulation.getEntity(manifold.id)?.direction).toBe(Direction.South);
    expect(simulation.getEntity(manifold.id)?.manifoldRouting).toEqual(
      routingBeforeRotate,
    );
    expect(simulation.getEntity(manifold.id)?.beltItems[0]).toEqual(
      payloadBeforeRotate,
    );
    simulation.drainEvents();

    const serialized = simulation.serialize();
    const restored = FactorySimulation.restore(
      JSON.parse(JSON.stringify(serialized)),
    );
    expect(restored.serialize()).toEqual(serialized);
    for (const delta of [1 / 144, 0.75, 2.4, 1 / 30, 4.125]) {
      simulation.tick(delta);
      restored.tick(delta);
    }
    expect(restored.serialize()).toEqual(simulation.serialize());
  });

  it("migrates v1/v2 saves and rejects corrupt manifold saves", () => {
    const legacySource = blankSimulation(18, 14).serialize();
    const legacy = JSON.parse(JSON.stringify(legacySource)) as {
      version: number;
      catalogVersion: string;
    };
    legacy.version = 1;
    legacy.catalogVersion = "cinderline-1";
    const migrated = FactorySimulation.restore(legacy as never).serialize();
    expect(migrated.version).toBe(8);
    expect(migrated.catalogVersion).toBe("cinderline-8");
    expect(migrated.powerMode).toBe("legacyGlobal");

    const simulation = blankSimulation(18, 14);
    const manifold = eastManifold(simulation);
    const legacyV2 = JSON.parse(JSON.stringify(simulation.serialize()));
    legacyV2.version = 2;
    legacyV2.catalogVersion = "cinderline-2";
    const legacyRouting = legacyV2.entities.find(
      (entity: { id: number }) => entity.id === manifold.id,
    ).manifoldRouting;
    legacyV2.entities.find(
      (entity: { id: number }) => entity.id === manifold.id,
    ).manifoldRouting = {
      mode: legacyRouting.mode,
      splitCursor: 1,
      mergeCursor: 0,
    };
    expect(
      FactorySimulation.restore(legacyV2)
        .getEntity(manifold.id)?.manifoldRouting,
    ).toEqual({
      mode: ManifoldMode.Even,
      extractPort: 0,
      splitCursors: [1, 0],
      mergeCursors: [0, 1],
    });

    for (const [version, catalogVersion] of [
      [3, "cinderline-3"],
      [4, "cinderline-4"],
      [5, "cinderline-5"],
    ] as const) {
      const portless = JSON.parse(JSON.stringify(simulation.serialize()));
      portless.version = version;
      portless.catalogVersion = catalogVersion;
      const portlessRouting = portless.entities.find(
        (entity: { id: number }) => entity.id === manifold.id,
      ).manifoldRouting;
      delete portlessRouting.extractPort;
      expect(
        FactorySimulation.restore(portless)
          .getEntity(manifold.id)?.manifoldRouting?.extractPort,
      ).toBe(0);
    }

    const corruptRouting = JSON.parse(
      JSON.stringify(simulation.serialize()),
    );
    corruptRouting.entities.find(
      (entity: { id: number }) => entity.id === manifold.id,
    ).manifoldRouting.splitCursors[0] = 2;
    expect(() => FactorySimulation.restore(corruptRouting)).toThrow(
      "invalid manifold routing",
    );

    const corruptExtractPort = JSON.parse(
      JSON.stringify(simulation.serialize()),
    );
    corruptExtractPort.entities.find(
      (entity: { id: number }) => entity.id === manifold.id,
    ).manifoldRouting.extractPort = 2;
    expect(() => FactorySimulation.restore(corruptExtractPort)).toThrow(
      "invalid manifold routing",
    );

    const negativeZeroExtractPort = simulation.serialize();
    negativeZeroExtractPort.entities.find(
      (entity) => entity.id === manifold.id,
    )!.manifoldRouting!.extractPort = -0;
    expect(() => FactorySimulation.restore(negativeZeroExtractPort)).toThrow(
      "invalid manifold routing",
    );

    const corruptPort = JSON.parse(JSON.stringify(simulation.serialize()));
    const serializedManifold = corruptPort.entities.find(
      (entity: { id: number }) => entity.id === manifold.id,
    );
    serializedManifold.beltItems.push({
      id: 99,
      item: "ironOre",
      lane: 0,
      port: 2,
      progress: 0.5,
    });
    expect(() => FactorySimulation.restore(corruptPort)).toThrow(
      "invalid transport payload",
    );
  });

  it("is deterministic across render-frame grouping with active routing", () => {
    const makeNetwork = () => {
      const simulation = blankSimulation(18, 14, 0xa11e);
      const manifold = eastManifold(simulation);
      placeOrThrow(simulation, "belt", 7, 5, Direction.North);
      placeOrThrow(simulation, "belt", 7, 7, Direction.South);
      expect(
        simulation.receive(manifold.id, "ironOre", 1, "belt", 0),
      ).toBe(1);
      expect(
        simulation.receive(manifold.id, "copperOre", 1, "belt", 1),
      ).toBe(1);
      simulation.drainEvents();
      return simulation;
    };
    const fine = makeNetwork();
    const coarse = makeNetwork();
    for (let frame = 0; frame < 600; frame += 1) fine.tick(1 / 60);
    coarse.tick(10);
    expect(coarse.serialize()).toEqual(fine.serialize());
  });
});
