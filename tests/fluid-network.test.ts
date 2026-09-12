import { describe, expect, it } from "vitest";

import {
  CATALOG_VERSION,
  FLUID_IDS,
  FLUID_RECIPES,
} from "../src/game/catalog";
import { toRenderSnapshot } from "../src/game/adapters";
import { FactorySimulation } from "../src/game/simulation";
import {
  Direction,
  FIXED_TICK_SECONDS,
  SIMULATION_VERSION,
  type EntityState,
  type FluidId,
  type SerializedSimulation,
} from "../src/game/types";

function blankSimulation(
  width = 40,
  height = 24,
  seed = 0xf10d,
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

function placeOrThrow(
  simulation: FactorySimulation,
  ...args: Parameters<FactorySimulation["place"]>
): EntityState {
  const result = simulation.place(...args);
  if (!result.ok) {
    throw new Error(`Placement failed: ${result.reason}`);
  }
  return result.entity;
}

function nodeAmount(
  simulation: FactorySimulation,
  entityId: number,
  role: "buffer" | "input" | "output" = "buffer",
): number {
  return (
    simulation
      .fluidNetworkSnapshot()
      .nodes.find(
        (node) => node.entityId === entityId && node.role === role,
      )?.amountMilli ?? 0
  );
}

function storedMass(simulation: FactorySimulation): number {
  const stored = simulation.stats().fluid.storedMilli;
  return FLUID_IDS.reduce(
    (total, fluidId) => total + stored[fluidId],
    0,
  );
}

function fuelGenerator(
  simulation: FactorySimulation,
  x = 30,
  y = 3,
): EntityState {
  const generator = placeOrThrow(
    simulation,
    "generator",
    x,
    y,
    Direction.East,
  );
  expect(simulation.receive(generator.id, "coal", 20, "fuel")).toBe(20);
  return generator;
}

function buildProductionChain(simulation: FactorySimulation) {
  const source = placeOrThrow(
    simulation,
    "fluidSource",
    2,
    8,
    Direction.East,
    { fluidId: "crudeOil" },
  );
  const pump = placeOrThrow(
    simulation,
    "fluidPump",
    4,
    8,
    Direction.East,
  );
  placeOrThrow(simulation, "fluidPipe", 5, 8, Direction.East);
  const crudeTank = placeOrThrow(
    simulation,
    "fluidTank",
    6,
    7,
    Direction.East,
  );
  placeOrThrow(simulation, "fluidPipe", 9, 8, Direction.East);
  const processor = placeOrThrow(
    simulation,
    "fluidProcessor",
    10,
    7,
    Direction.East,
    { fluidRecipeId: "refineCrude" },
  );
  placeOrThrow(simulation, "fluidPipe", 13, 8, Direction.East);
  const productTank = placeOrThrow(
    simulation,
    "fluidTank",
    14,
    7,
    Direction.East,
  );
  const generator = fuelGenerator(simulation);
  simulation.drainEvents();
  return {
    source,
    pump,
    crudeTank,
    processor,
    productTank,
    generator,
  };
}

function fluidProjection(simulation: FactorySimulation) {
  const entities = new Map(
    simulation
      .getEntities()
      .map((entity) => [entity.id, entity] as const),
  );
  const network = simulation.fluidNetworkSnapshot();
  return {
    nodes: network.nodes
      .map((node) => {
        const entity = entities.get(node.entityId)!;
        return {
          kind: entity.kind,
          x: entity.x,
          y: entity.y,
          direction: entity.direction,
          role: node.role,
          componentId: node.componentId,
          fluidId: node.fluidId ?? null,
          amountMilli: node.amountMilli,
          capacityMilli: node.capacityMilli,
          incomingEdgeCount: node.incomingEdgeCount,
          outgoingEdgeCount: node.outgoingEdgeCount,
        };
      })
      .sort(
        (left, right) =>
          left.y - right.y ||
          left.x - right.x ||
          left.role.localeCompare(right.role),
      ),
    edges: network.edges
      .map((edge) => {
        const source = entities.get(edge.sourceEntityId)!;
        const target = entities.get(edge.targetEntityId)!;
        return {
          source: `${source.x},${source.y}:${edge.sourceRole}`,
          target: `${target.x},${target.y}:${edge.targetRole}`,
          throughputMilliPerTick: edge.throughputMilliPerTick,
        };
      })
      .sort(
        (left, right) =>
          left.source.localeCompare(right.source) ||
          left.target.localeCompare(right.target),
      ),
    components: network.components.map((component) => ({
      ...component,
      fluidIds: [...component.fluidIds],
    })),
  };
}

describe("deterministic fixed-point fluid networks", () => {
  it("runs a powered source → pump → tank → processor → product chain with exact mass", () => {
    const simulation = blankSimulation();
    const chain = buildProductionChain(simulation);

    simulation.step(1_200);

    const stats = simulation.stats().fluid;
    const producedMass = FLUID_IDS.reduce(
      (total, fluidId) => total + stats.producedMilli[fluidId],
      0,
    );
    expect(producedMass).toBeGreaterThan(0);
    expect(storedMass(simulation)).toBe(producedMass);
    expect(stats.processedMilli.refinedFuel).toBeGreaterThan(0);
    expect(
      stats.processedMilli.refinedFuel %
        FLUID_RECIPES.refineCrude.batchMilli,
    ).toBe(0);
    expect(nodeAmount(simulation, chain.productTank.id)).toBeGreaterThan(0);
    expect(stats.transferredMilli).toBeGreaterThan(producedMass);
    expect(stats.componentCount).toBe(2);

    const render = simulation.getRenderSnapshot();
    expect(render.fluid).toEqual(stats);
    expect(render.fluidNetwork.nodes.length).toBe(9);
    const adapted = toRenderSnapshot(render);
    expect(adapted.entities.some((entity) =>
      entity.kind.startsWith("fluid")
    )).toBe(false);
    expect(adapted.fluidEntities).toHaveLength(8);
    expect(adapted.fluidNetwork).toEqual(render.fluidNetwork);

    const proof = {
      format: "cinderline-fluid-core-proof",
      simulationVersion: SIMULATION_VERSION,
      catalogVersion: CATALOG_VERSION,
      tick: simulation.tickCount,
      exactMass: {
        producedMilli: producedMass,
        storedMilli: storedMass(simulation),
        conserved: storedMass(simulation) === producedMass,
      },
      processedMilli: stats.processedMilli,
      transferredMilli: stats.transferredMilli,
      componentCount: stats.componentCount,
      nodeCount: stats.nodeCount,
      network: fluidProjection(simulation),
    };
    const proofEnvironment = (
      globalThis as {
        process?: { env?: Record<string, string | undefined> };
      }
    ).process?.env;
    if (proofEnvironment?.CINDERLINE_FLUID_PROOF === "1") {
      console.log(`[fluid-core-proof]${JSON.stringify(proof)}`);
    }
  });

  it("gates pump output on power while retaining upstream mass", () => {
    const simulation = blankSimulation(28, 18);
    const source = placeOrThrow(
      simulation,
      "fluidSource",
      2,
      6,
      Direction.East,
    );
    const pump = placeOrThrow(
      simulation,
      "fluidPump",
      4,
      6,
      Direction.East,
    );
    placeOrThrow(simulation, "fluidPipe", 5, 6, Direction.East);
    const tank = placeOrThrow(
      simulation,
      "fluidTank",
      6,
      5,
      Direction.East,
    );

    simulation.step(160);
    expect(nodeAmount(simulation, source.id)).toBeGreaterThan(0);
    expect(nodeAmount(simulation, pump.id)).toBeGreaterThan(0);
    expect(nodeAmount(simulation, tank.id)).toBe(0);
    expect(simulation.getEntity(pump.id)?.status).toBe("noPower");

    fuelGenerator(simulation, 20, 3);
    simulation.step(80);
    expect(nodeAmount(simulation, tank.id)).toBeGreaterThan(0);
    expect(simulation.getEntity(pump.id)?.powerSatisfaction).toBeGreaterThan(0);
  });

  it("enforces per-tick pump throughput and target capacity exactly", () => {
    const simulation = blankSimulation(24, 16);
    const pump = placeOrThrow(
      simulation,
      "fluidPump",
      4,
      7,
      Direction.East,
    );
    const tank = placeOrThrow(
      simulation,
      "fluidTank",
      5,
      6,
      Direction.East,
    );
    fuelGenerator(simulation, 18, 2);
    expect(simulation.receiveFluid(pump.id, "crudeOil", 8_000)).toBe(
      8_000,
    );

    simulation.step();
    expect(nodeAmount(simulation, pump.id)).toBe(6_500);
    expect(nodeAmount(simulation, tank.id)).toBe(1_500);
    expect(simulation.stats().fluid.transferredMilli).toBe(1_500);
  });

  it("conserves every milli-unit through passive splits and merges", () => {
    const simulation = blankSimulation(28, 20);
    const input = placeOrThrow(
      simulation,
      "fluidPipe",
      5,
      10,
      Direction.East,
    );
    placeOrThrow(simulation, "fluidPipe", 6, 10, Direction.East);
    placeOrThrow(simulation, "fluidPipe", 7, 10, Direction.East);
    placeOrThrow(simulation, "fluidPipe", 6, 9, Direction.North);
    placeOrThrow(simulation, "fluidPipe", 6, 11, Direction.South);
    placeOrThrow(simulation, "fluidTank", 8, 9, Direction.East);
    placeOrThrow(simulation, "fluidTank", 5, 6, Direction.North);
    placeOrThrow(simulation, "fluidTank", 5, 12, Direction.South);

    expect(simulation.receiveFluid(input.id, "crudeOil", 8_000)).toBe(
      8_000,
    );
    const before = storedMass(simulation);
    simulation.step(400);
    expect(before).toBe(8_000);
    expect(storedMass(simulation)).toBe(before);
    expect(simulation.stats().fluid.producedMilli).toEqual({
      crudeOil: 0,
      refinedFuel: 0,
    });
    expect(
      simulation
        .fluidNetworkSnapshot()
        .nodes.every(
          (node) =>
            Number.isSafeInteger(node.amountMilli) &&
            node.amountMilli >= 0 &&
            node.amountMilli <= node.capacityMilli,
        ),
    ).toBe(true);
  });

  it("does not over-allocate one- and two-milli split remainders", () => {
    for (const amount of [1, 2] as const) {
      const simulation = blankSimulation(20, 16, 0x5100 + amount);
      const input = placeOrThrow(
        simulation,
        "fluidPipe",
        5,
        8,
        Direction.East,
      );
      placeOrThrow(simulation, "fluidPipe", 6, 8, Direction.East);
      placeOrThrow(simulation, "fluidPipe", 7, 8, Direction.East);
      placeOrThrow(simulation, "fluidPipe", 6, 7, Direction.North);
      placeOrThrow(simulation, "fluidPipe", 6, 9, Direction.South);
      expect(
        simulation.receiveFluid(input.id, "crudeOil", amount),
      ).toBe(amount);
      simulation.step(20);
      expect(storedMass(simulation)).toBe(amount);
      expect(
        simulation
          .fluidNetworkSnapshot()
          .nodes.reduce(
            (total, node) => total + node.amountMilli,
            0,
          ),
      ).toBe(amount);
    }
  });

  it("arbitrates incompatible merge fluids deterministically without mixing", () => {
    const build = (reverse: boolean): FactorySimulation => {
      const simulation = blankSimulation(28, 18, 0xf1a1);
      const placements = [
        () =>
          placeOrThrow(
            simulation,
            "fluidSource",
            8,
            9,
            Direction.East,
            { fluidId: "crudeOil" },
          ),
        () =>
          placeOrThrow(
            simulation,
            "fluidSource",
            13,
            9,
            Direction.West,
            { fluidId: "refinedFuel" },
          ),
      ];
      if (reverse) placements.reverse();
      for (const place of placements) place();
      placeOrThrow(
        simulation,
        "fluidTank",
        10,
        8,
        Direction.East,
      );
      simulation.step(100);
      return simulation;
    };

    const forward = build(false);
    const reverse = build(true);
    for (const simulation of [forward, reverse]) {
      const stats = simulation.stats().fluid;
      expect(storedMass(simulation)).toBe(
        stats.producedMilli.crudeOil +
          stats.producedMilli.refinedFuel,
      );
      expect(
        simulation.fluidNetworkSnapshot().nodes.every(
          (node) =>
            node.amountMilli === 0 || node.fluidId !== undefined,
        ),
      ).toBe(true);
      const tank = simulation.getEntityAt(10, 8)!;
      expect(
        simulation
          .fluidNetworkSnapshot()
          .nodes.find((node) => node.entityId === tank.id)?.fluidId,
      ).toBe("crudeOil");
    }
    expect(fluidProjection(reverse)).toEqual(fluidProjection(forward));
  });

  it("gates processor work on power and preserves a blocked batch", () => {
    const simulation = blankSimulation(24, 16);
    const processor = placeOrThrow(
      simulation,
      "fluidProcessor",
      4,
      6,
      Direction.East,
    );
    expect(
      simulation.receiveFluid(
        processor.id,
        "crudeOil",
        5_000,
        "input",
      ),
    ).toBe(5_000);
    simulation.step(100);
    expect(nodeAmount(simulation, processor.id, "input")).toBe(5_000);
    expect(nodeAmount(simulation, processor.id, "output")).toBe(0);
    expect(simulation.getEntity(processor.id)?.status).toBe("noPower");

    fuelGenerator(simulation, 18, 2);
    simulation.step(FLUID_RECIPES.refineCrude.durationTicks);
    expect(nodeAmount(simulation, processor.id, "input")).toBe(0);
    expect(nodeAmount(simulation, processor.id, "output")).toBe(5_000);
    expect(simulation.stats().fluid.processedMilli.refinedFuel).toBe(
      5_000,
    );

    expect(
      simulation.receiveFluid(
        processor.id,
        "crudeOil",
        5_000,
        "input",
      ),
    ).toBe(5_000);
    expect(
      simulation.receiveFluid(
        processor.id,
        "refinedFuel",
        45_000,
        "output",
      ),
    ).toBe(45_000);
    simulation.step(100);
    expect(nodeAmount(simulation, processor.id, "input")).toBe(5_000);
    expect(nodeAmount(simulation, processor.id, "output")).toBe(50_000);
    expect(simulation.getEntity(processor.id)?.status).toBe("outputFull");
  });

  it("rebuilds deterministic components after placement, removal, and rotation", () => {
    const simulation = blankSimulation(24, 18);
    placeOrThrow(simulation, "fluidPipe", 8, 9, Direction.East);
    placeOrThrow(simulation, "fluidPipe", 9, 9, Direction.East);
    placeOrThrow(simulation, "fluidPipe", 10, 9, Direction.East);
    const north = placeOrThrow(
      simulation,
      "fluidPump",
      9,
      8,
      Direction.North,
    );
    const south = placeOrThrow(
      simulation,
      "fluidPump",
      9,
      10,
      Direction.South,
    );

    let network = simulation.fluidNetworkSnapshot();
    expect(network.components).toHaveLength(1);
    expect(network.edges).toHaveLength(4);

    expect(simulation.rotate(north.x, north.y).ok).toBe(true);
    network = simulation.fluidNetworkSnapshot();
    expect(network.components).toHaveLength(2);
    expect(network.edges).toHaveLength(3);

    expect(simulation.remove(south.x, south.y)?.id).toBe(south.id);
    network = simulation.fluidNetworkSnapshot();
    expect(network.components).toHaveLength(2);
    expect(network.edges).toHaveLength(2);

    const replacement = placeOrThrow(
      simulation,
      "fluidPump",
      9,
      10,
      Direction.South,
    );
    expect(replacement.id).not.toBe(south.id);
    expect(simulation.fluidNetworkSnapshot().components).toHaveLength(2);

    expect(simulation.rotate(north.x, north.y, false).ok).toBe(true);
    expect(simulation.fluidNetworkSnapshot().components).toHaveLength(1);
  });

  it("is independent of entity insertion history for splits and merges", () => {
    const placements = [
      ["fluidPipe", 5, 10, Direction.East],
      ["fluidPipe", 6, 10, Direction.East],
      ["fluidPipe", 7, 10, Direction.East],
      ["fluidPipe", 6, 9, Direction.North],
      ["fluidPipe", 6, 11, Direction.South],
      ["fluidTank", 8, 9, Direction.East],
      ["fluidTank", 5, 6, Direction.North],
      ["fluidTank", 5, 12, Direction.South],
    ] as const;
    const build = (order: readonly number[]): FactorySimulation => {
      const simulation = blankSimulation(28, 20, 0xd371);
      for (const index of order) {
        const [kind, x, y, direction] = placements[index]!;
        placeOrThrow(simulation, kind, x, y, direction);
      }
      const input = simulation.getEntityAt(5, 10);
      expect(input).toBeDefined();
      expect(
        simulation.receiveFluid(input!.id, "crudeOil", 7_997),
      ).toBe(7_997);
      simulation.step(257);
      return simulation;
    };

    const forward = build(placements.map((_, index) => index));
    const reverse = build(
      placements.map((_, index) => index).reverse(),
    );
    expect(fluidProjection(reverse)).toEqual(fluidProjection(forward));
    expect(reverse.stats().fluid.storedMilli).toEqual(
      forward.stats().fluid.storedMilli,
    );
    expect(reverse.stats().fluid.transferredMilli).toBe(
      forward.stats().fluid.transferredMilli,
    );
  });

  it("round-trips canonical fluid state and rejects hostile corruption", () => {
    const simulation = blankSimulation();
    buildProductionChain(simulation);
    simulation.step(321);
    const serialized = simulation.serialize();

    expect(FactorySimulation.restore(serialized).serialize()).toEqual(
      serialized,
    );

    const corruptions: Array<
      (snapshot: SerializedSimulation) => void
    > = [
      (snapshot) => {
        const source = snapshot.entities.find(
          (entity) => entity.kind === "fluidSource",
        )!;
        source.fluidState!.buffer!.amountMilli = 0.5;
      },
      (snapshot) => {
        const source = snapshot.entities.find(
          (entity) => entity.kind === "fluidSource",
        )!;
        source.fluidState!.buffer!.capacityMilli += 1;
      },
      (snapshot) => {
        const source = snapshot.entities.find(
          (entity) => entity.kind === "fluidSource",
        )!;
        source.fluidState!.buffer!.amountMilli = 0;
        source.fluidState!.buffer!.fluidId = "crudeOil";
      },
      (snapshot) => {
        const source = snapshot.entities.find(
          (entity) => entity.kind === "fluidSource",
        )!;
        (source.fluidState as unknown as Record<string, unknown>).foreign =
          true;
      },
      (snapshot) => {
        const processor = snapshot.entities.find(
          (entity) => entity.kind === "fluidProcessor",
        )!;
        processor.fluidState!.input!.amountMilli = 1;
        processor.fluidState!.input!.fluidId = "refinedFuel";
      },
      (snapshot) => {
        snapshot.fluidProducedMilli.crudeOil = -1;
      },
      (snapshot) => {
        snapshot.fluidProcessedMilli = {
          crudeOil: 0,
        } as Record<FluidId, number>;
      },
      (snapshot) => {
        snapshot.fluidTransferredMilli = Number.NaN;
      },
      (snapshot) => {
        const processor = snapshot.entities.find(
          (entity) => entity.kind === "fluidProcessor",
        )!;
        processor.fluidState!.processTicks =
          FLUID_RECIPES.refineCrude.durationTicks;
      },
    ];
    for (const corrupt of corruptions) {
      const snapshot = structuredClone(serialized);
      corrupt(snapshot);
      expect(() => FactorySimulation.restore(snapshot)).toThrow();
    }
  });

  it("continues bit-for-bit across fixed-step frame grouping", () => {
    const initial = blankSimulation();
    buildProductionChain(initial);
    initial.step(137);
    const checkpoint = initial.serialize();
    const fine = FactorySimulation.restore(
      structuredClone(checkpoint),
    );
    const coarse = FactorySimulation.restore(
      structuredClone(checkpoint),
    );

    fine.step(600);
    expect(coarse.tick(600 * FIXED_TICK_SECONDS)).toBe(600);
    expect(coarse.serialize()).toEqual(fine.serialize());
    expect(coarse.fluidNetworkSnapshot()).toEqual(
      fine.fluidNetworkSnapshot(),
    );
  });

  it("preflights fluid ledger overflow before mutating any state", () => {
    const sourceSimulation = blankSimulation(18, 12);
    placeOrThrow(
      sourceSimulation,
      "fluidSource",
      4,
      4,
      Direction.East,
    );
    const snapshot = sourceSimulation.serialize();
    snapshot.fluidProducedMilli.crudeOil =
      Number.MAX_SAFE_INTEGER - 100;
    const restored = FactorySimulation.restore(snapshot);
    const before = restored.serializeToString();
    expect(() => restored.step()).toThrow(
      "Fluid production ledger exceeds safe integer range.",
    );
    expect(restored.serializeToString()).toBe(before);
  });

  it("migrates a real v5 non-fluid save and rejects v5 fluid smuggling", () => {
    const simulation = blankSimulation(20, 14);
    placeOrThrow(simulation, "belt", 4, 5, Direction.East);
    simulation.step(12);
    const current = simulation.serialize();
    const legacy = structuredClone(current) as Omit<
      SerializedSimulation,
      | "fluidProducedMilli"
      | "fluidProcessedMilli"
      | "fluidTransferredMilli"
    > & {
      version: 5;
      catalogVersion: "cinderline-5";
      fluidProducedMilli?: Record<FluidId, number>;
      fluidProcessedMilli?: Record<FluidId, number>;
      fluidTransferredMilli?: number;
    };
    legacy.version = 5;
    legacy.catalogVersion = "cinderline-5";
    delete legacy.fluidProducedMilli;
    delete legacy.fluidProcessedMilli;
    delete legacy.fluidTransferredMilli;

    const migrated = FactorySimulation.restore(legacy as never).serialize();
    expect(migrated.version).toBe(SIMULATION_VERSION);
    expect(migrated.catalogVersion).toBe(CATALOG_VERSION);
    expect(migrated.fluidProducedMilli).toEqual({
      crudeOil: 0,
      refinedFuel: 0,
    });
    expect(migrated.fluidProcessedMilli).toEqual({
      crudeOil: 0,
      refinedFuel: 0,
    });
    expect(migrated.fluidTransferredMilli).toBe(0);
    expect(migrated.entities).toEqual(current.entities);
    expect(migrated.tickCount).toBe(current.tickCount);

    const smuggled = structuredClone(legacy) as unknown as {
      entities: Array<Record<string, unknown>>;
    };
    smuggled.entities[0]!.fluidState = undefined;
    expect(() => FactorySimulation.restore(smuggled as never)).toThrow(
      "Legacy saves cannot contain fluid entity state.",
    );
  });

  it("reports bounded source backpressure without creating mass", () => {
    const simulation = blankSimulation(16, 12);
    const source = placeOrThrow(
      simulation,
      "fluidSource",
      4,
      4,
      Direction.East,
    );
    simulation.step(100);
    const before = simulation.stats().fluid;
    expect(nodeAmount(simulation, source.id)).toBe(20_000);
    expect(before.producedMilli.crudeOil).toBe(20_000);
    expect(before.backpressuredEntityIds).toContain(source.id);

    simulation.step(100);
    const after = simulation.stats().fluid;
    expect(after.producedMilli.crudeOil).toBe(20_000);
    expect(storedMass(simulation)).toBe(20_000);
    expect(after.backpressuredEntityIds).toContain(source.id);
  });
});
