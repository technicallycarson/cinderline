import { describe, expect, it } from "vitest";

import { FactorySimulation } from "../src/game/simulation";
import {
  PROGRESSION_BUILD_COSTS,
  addProgressionInventory,
  completeSelectedCommission,
  createCampaignProgression,
  createProgressionInventory,
  progressionInventoryCount,
  purchasePlacement,
  selectCommission,
  type ProgressionInventory,
  type ProgressionState,
} from "../src/game/progression";
import {
  Direction,
  type EntityKind,
  type EntityState,
  type ItemId,
  type RecipeId,
  type SimulationEvent,
} from "../src/game/types";

interface Placement {
  readonly kind: EntityKind;
  readonly x: number;
  readonly y: number;
  readonly direction: Direction;
  readonly recipeId?: RecipeId;
}

const M1_ROUTE: readonly Placement[] = [
  { kind: "inserter", x: 14, y: 5, direction: Direction.East },
  { kind: "extractor", x: 5, y: 12, direction: Direction.East },
  ...[7, 8, 9, 10].map((x) => ({
    kind: "belt" as const,
    x,
    y: 12,
    direction: Direction.East,
  })),
  { kind: "inserter", x: 11, y: 12, direction: Direction.East },
  {
    kind: "smelter",
    x: 12,
    y: 11,
    direction: Direction.East,
    recipeId: "smeltCopper",
  },
  { kind: "inserter", x: 14, y: 12, direction: Direction.East },
  ...[15, 16, 17, 18, 19, 20, 21].map((x) => ({
    kind: "belt" as const,
    x,
    y: 12,
    direction: Direction.East,
  })),
  { kind: "gridRelay", x: 9, y: 15, direction: Direction.East },
  { kind: "extractor", x: 5, y: 19, direction: Direction.East },
  { kind: "inserter", x: 8, y: 14, direction: Direction.East },
  {
    kind: "smelter",
    x: 9,
    y: 13,
    direction: Direction.East,
    recipeId: "fireBrick",
  },
  { kind: "inserter", x: 11, y: 14, direction: Direction.East },
  ...[12, 13, 14, 15, 16, 17, 18].map((x) => ({
    kind: "belt" as const,
    x,
    y: 14,
    direction: Direction.East,
  })),
  ...[5, 6, 7, 8, 9, 10, 11].map((y) => ({
    kind: "belt" as const,
    x: 15,
    y,
    direction: Direction.South,
  })),
  ...[19, 18, 17, 16, 15, 14].map((y) => ({
    kind: "belt" as const,
    x: 7,
    y,
    direction: Direction.North,
  })),
  { kind: "belt", x: 19, y: 14, direction: Direction.North },
  { kind: "belt", x: 19, y: 13, direction: Direction.North },
];

const AUTOMATIC_COAL_SPUR: readonly Placement[] = [
  { kind: "gridRelay", x: 22, y: 6, direction: Direction.North },
  { kind: "extractor", x: 24, y: 4, direction: Direction.West },
  { kind: "belt", x: 23, y: 4, direction: Direction.West },
  { kind: "belt", x: 22, y: 4, direction: Direction.West },
  { kind: "belt", x: 21, y: 4, direction: Direction.West },
  { kind: "inserter", x: 20, y: 4, direction: Direction.West },
];

const FABRICATOR_CELL: readonly Placement[] = [
  { kind: "fabricator", x: 16, y: 9, direction: Direction.North },
  { kind: "inserter", x: 17, y: 11, direction: Direction.North },
  { kind: "inserter", x: 17, y: 8, direction: Direction.North },
  { kind: "belt", x: 17, y: 7, direction: Direction.East },
  { kind: "belt", x: 18, y: 7, direction: Direction.East },
  { kind: "belt", x: 19, y: 7, direction: Direction.East },
  { kind: "belt", x: 20, y: 7, direction: Direction.East },
  { kind: "belt", x: 21, y: 7, direction: Direction.South },
  { kind: "belt", x: 21, y: 8, direction: Direction.South },
  { kind: "belt", x: 21, y: 9, direction: Direction.South },
  { kind: "belt", x: 21, y: 10, direction: Direction.South },
  { kind: "belt", x: 21, y: 11, direction: Direction.South },
];

function routeCost(route: readonly Placement[]): number {
  return route.reduce(
    (total, placement) =>
      total + PROGRESSION_BUILD_COSTS[placement.kind],
    0,
  );
}

function placeOrThrow(
  simulation: FactorySimulation,
  placement: Placement,
): EntityState {
  const result = simulation.place(
    placement.kind,
    placement.x,
    placement.y,
    placement.direction,
    placement.recipeId === undefined
      ? {}
      : { recipeId: placement.recipeId },
  );
  if (!result.ok) {
    throw new Error(
      `${placement.kind} at ${placement.x},${placement.y}: ${result.reason}`,
    );
  }
  return result.entity;
}

function purchaseRoute(
  simulation: FactorySimulation,
  state: ProgressionState,
  route: readonly Placement[],
): { readonly state: ProgressionState; readonly entities: EntityState[] } {
  const entities: EntityState[] = [];
  let nextState = state;
  for (const placement of route) {
    const purchase = purchasePlacement(nextState, placement.kind);
    expect(purchase.ok).toBe(true);
    if (!purchase.ok) throw new Error(purchase.reason);
    entities.push(placeOrThrow(simulation, placement));
    nextState = purchase.state;
  }
  return { state: nextState, entities };
}

function paintPatch(
  simulation: FactorySimulation,
  item: "iron" | "copper" | "coal" | "stone",
  originX: number,
  originY: number,
): void {
  for (let y = originY; y < originY + 4; y += 1) {
    for (let x = originX; x < originX + 4; x += 1) {
      expect(simulation.setResource(x, y, item, 420)).toBe(true);
    }
  }
}

function collectDockCargo(
  simulation: FactorySimulation,
  uplinkId: number,
  inventory: ProgressionInventory,
): {
  readonly inventory: ProgressionInventory;
  readonly events: readonly SimulationEvent[];
} {
  const dock = simulation.getEntityAt(21, 12);
  if (!dock || dock.kind !== "belt") {
    throw new Error("The Commission Uplink dock belt is missing.");
  }
  const contact = dock.beltItems
    .filter((item) => item.progress >= 0.999)
    .sort((left, right) => right.progress - left.progress || left.id - right.id)[0];
  let transferred = 0;
  if (contact) {
    transferred = simulation.transfer(
      dock.id,
      uplinkId,
      contact.item,
      1,
      "belt",
      "inventory",
    ).moved;
  }
  if (transferred <= 0) {
    return { inventory, events: [] };
  }
  const events = simulation.drainEvents();
  let nextInventory = inventory;
  for (const event of events) {
    if (
      event.type !== "itemTransferred" ||
      event.entityId !== uplinkId ||
      !event.item ||
      !event.amount
    ) {
      continue;
    }
    const secured = simulation.withdrawStorage(
      uplinkId,
      event.item,
      event.amount,
    );
    if (secured > 0) {
      nextInventory = addProgressionInventory(
        nextInventory,
        event.item,
        secured,
      );
    }
  }
  return { inventory: nextInventory, events };
}

describe("Milestone M1 earned-alloy Phase-2 preview", () => {
  it("automates fuel, fabricates Throughput cargo, and reveals the next tier", () => {
    expect(routeCost(M1_ROUTE)).toBe(208);
    expect(routeCost(AUTOMATIC_COAL_SPUR)).toBe(41);
    expect(routeCost(FABRICATOR_CELL)).toBe(84);

    const simulation = new FactorySimulation({
      width: 40,
      height: 27,
      seed: 0x4d32,
      generateTerrain: false,
      generateResources: false,
      powerMode: "local",
    });
    paintPatch(simulation, "iron", 4, 4);
    paintPatch(simulation, "copper", 4, 11);
    paintPatch(simulation, "stone", 4, 18);
    paintPatch(simulation, "coal", 26, 4);

    const generator = placeOrThrow(simulation, {
      kind: "generator",
      x: 18,
      y: 3,
      direction: Direction.East,
    });
    placeOrThrow(simulation, {
      kind: "gridRelay",
      x: 16,
      y: 6,
      direction: Direction.East,
    });
    placeOrThrow(simulation, {
      kind: "gridRelay",
      x: 9,
      y: 8,
      direction: Direction.East,
    });
    placeOrThrow(simulation, {
      kind: "extractor",
      x: 5,
      y: 5,
      direction: Direction.East,
    });
    for (let x = 7; x <= 10; x += 1) {
      placeOrThrow(simulation, {
        kind: "belt",
        x,
        y: 5,
        direction: Direction.East,
      });
    }
    placeOrThrow(simulation, {
      kind: "inserter",
      x: 11,
      y: 5,
      direction: Direction.East,
    });
    placeOrThrow(simulation, {
      kind: "smelter",
      x: 12,
      y: 4,
      direction: Direction.East,
      recipeId: "smeltIron",
    });
    const uplink = placeOrThrow(simulation, {
      kind: "storage",
      x: 22,
      y: 11,
      direction: Direction.East,
    });
    expect(simulation.receive(generator.id, "coal", 1, "fuel")).toBe(1);

    let progression = createCampaignProgression();
    const bootstrapRoute = purchaseRoute(
      simulation,
      progression,
      M1_ROUTE,
    );
    progression = bootstrapRoute.state;
    expect(progression.alloy).toBe(32);

    const bootstrap = completeSelectedCommission(
      progression,
      // Bootstrap's physical extraction/custody path is already sealed by
      // m1-core-loop and the production browser lane. This focused test starts
      // at that proven handoff so every simulated tick below belongs to the
      // earned-alloy Phase-2 continuation.
      createProgressionInventory({
        ironPlate: 24,
        copperPlate: 12,
        stoneBrick: 12,
      }),
      simulation.tickCount,
    );
    expect(bootstrap.ok).toBe(true);
    if (!bootstrap.ok) throw new Error(bootstrap.reason);
    progression = bootstrap.state;
    expect(progression.alloy).toBe(332);

    const selected = selectCommission(progression, "throughput");
    expect(selected.ok).toBe(true);
    if (!selected.ok) throw new Error(selected.reason);
    progression = selected.state;

    const coalRoute = purchaseRoute(
      simulation,
      progression,
      AUTOMATIC_COAL_SPUR,
    );
    progression = coalRoute.state;
    expect(progression.alloy).toBe(291);

    // Follow the player-facing order: bring the short fuel spur online before
    // adding the 180 kW Fabricator cell. At the existing foundry load, one
    // burning coal has enough margin for the first mined unit to arrive, after
    // which the hopper begins accumulating a durable reserve.
    let minimumCapacityKW = Number.POSITIVE_INFINITY;
    for (let tick = 0; tick < 20 * 60; tick += 1) {
      simulation.step();
      const power = simulation.stats().power;
      minimumCapacityKW = Math.min(
        minimumCapacityKW,
        power.capacityKW,
      );
    }
    expect(minimumCapacityKW).toBeGreaterThan(0);
    expect(simulation.stats().power.capacityKW).toBe(900);
    expect(simulation.stats().power.satisfaction).toBe(1);
    expect(simulation.productionLedger().coal).toBeGreaterThanOrEqual(8);
    const establishedFuelReserve =
      (simulation.getEntity(generator.id)?.fuel.coal ?? 0) +
      (simulation.getEntity(generator.id)?.fuelEnergyKJ ?? 0) / 4_000;
    expect(establishedFuelReserve).toBeGreaterThanOrEqual(4);
    simulation.drainEvents();
    let minimumSatisfaction = 1;
    let minimumGeneratorOutputKW = Number.POSITIVE_INFINITY;

    const fabricatorRoute = purchaseRoute(
      simulation,
      progression,
      FABRICATOR_CELL,
    );
    progression = fabricatorRoute.state;
    expect(progression.alloy).toBe(207);

    const fabricator = fabricatorRoute.entities.find(
      (entity) => entity.kind === "fabricator",
    );
    if (!fabricator) throw new Error("Fabricator placement is missing.");
    expect(
      simulation.requestRecipeChange(fabricator.id, "ironGear"),
    ).toMatchObject({ ok: true, recipeId: "ironGear" });

    const poweredPhase2Ids = [
      ...coalRoute.entities,
      ...fabricatorRoute.entities,
    ]
      .filter((entity) =>
        ["extractor", "inserter", "fabricator"].includes(entity.kind),
      )
      .map((entity) => entity.id);
    const assignments = simulation.powerGridSnapshot().assignments.filter(
      (assignment) => poweredPhase2Ids.includes(assignment.entityId),
    );
    expect(assignments).toHaveLength(poweredPhase2Ids.length);
    expect(
      assignments.every(
        (assignment) =>
          assignment.relayId !== null && assignment.networkId !== null,
      ),
    ).toBe(true);

    let uplinkInventory = createProgressionInventory();
    const observedProducts = new Set<ItemId>();
    const observedUplinkTransfers = new Set<ItemId>();
    const advanceUntil = (item: ItemId, amount: number): void => {
      for (let tick = 0; tick < 30_000; tick += 1) {
        simulation.step();
        const custody = collectDockCargo(
          simulation,
          uplink.id,
          uplinkInventory,
        );
        uplinkInventory = custody.inventory;
        for (const event of custody.events) {
          if (event.type === "itemProduced" && event.item) {
            observedProducts.add(event.item);
          }
          if (
            event.type === "itemTransferred" &&
            event.entityId === uplink.id &&
            event.item
          ) {
            observedUplinkTransfers.add(event.item);
          }
        }
        const liveFabricator = simulation.getEntity(fabricator.id);
        const liveGenerator = simulation.getEntity(generator.id);
        minimumSatisfaction = Math.min(
          minimumSatisfaction,
          liveFabricator?.powerSatisfaction ?? 0,
        );
        minimumGeneratorOutputKW = Math.min(
          minimumGeneratorOutputKW,
          liveGenerator?.generatedPowerKW ?? 0,
        );
        if (progressionInventoryCount(uplinkInventory, item) >= amount) {
          return;
        }
      }
      throw new Error(
        `${item} did not reach ${amount} units: ${JSON.stringify({
          inventory: uplinkInventory.entries,
          produced: simulation.productionLedger(),
          fabricator: simulation.getEntity(fabricator.id),
          inputInserter: simulation.getEntityAt(17, 11),
          inputBelt: simulation.getEntityAt(17, 12),
          dock: simulation.getEntityAt(21, 12),
          power: simulation.stats().power,
        })}`,
      );
    };

    advanceUntil("ironGear", 20);
    expect(minimumSatisfaction).toBeGreaterThanOrEqual(0.96);
    expect(minimumGeneratorOutputKW).toBeGreaterThan(0);
    expect(simulation.stats().power.capacityKW).toBe(900);
    expect(simulation.productionLedger().coal).toBeGreaterThan(0);
    expect(
      (simulation.getEntity(generator.id)?.fuel.coal ?? 0) +
        (simulation.getEntity(generator.id)?.fuelEnergyKJ ?? 0) / 4_000,
    ).toBeGreaterThan(0);

    expect(
      simulation.requestRecipeChange(fabricator.id, "copperWire"),
    ).toMatchObject({ ok: true, recipeId: "copperWire" });
    advanceUntil("copperWire", 40);
    expect(minimumSatisfaction).toBeGreaterThanOrEqual(0.96);
    expect(minimumGeneratorOutputKW).toBeGreaterThan(0);
    expect(simulation.stats().power.capacityKW).toBe(900);

    const deliveredGears = progressionInventoryCount(
      uplinkInventory,
      "ironGear",
    );
    const deliveredWire = progressionInventoryCount(
      uplinkInventory,
      "copperWire",
    );
    // The physical output belt can already hold the next gear when the 20th
    // reaches the Uplink. The commission consumes its exact manifest and
    // leaves that legitimate pipeline surplus in player custody.
    expect(deliveredGears).toBeGreaterThanOrEqual(20);
    expect(deliveredWire).toBeGreaterThanOrEqual(40);
    expect(observedProducts.has("ironGear")).toBe(true);
    expect(observedProducts.has("copperWire")).toBe(true);
    expect(observedProducts.has("coal")).toBe(true);
    expect(observedUplinkTransfers).toEqual(
      new Set(["ironGear", "copperWire", "ironPlate", "copperPlate", "stoneBrick"]),
    );

    const throughput = completeSelectedCommission(
      progression,
      uplinkInventory,
      simulation.tickCount,
    );
    expect(throughput.ok).toBe(true);
    if (!throughput.ok) throw new Error(throughput.reason);
    expect(throughput.event).toMatchObject({
      commissionId: "throughput",
      alloyBefore: 207,
      alloyAwarded: 400,
      alloyAfter: 607,
      unlockedBuildKinds: [
        "manifold",
        "fluidSource",
        "fluidPump",
        "fluidPipe",
        "fluidTank",
        "fluidProcessor",
      ],
    });
    expect(throughput.state.alloy).toBe(607);
    expect(throughput.state.unlockedBuildKinds).toContain("manifold");
    expect(throughput.state.unlockedBuildKinds).toContain("fluidProcessor");
    expect(progressionInventoryCount(throughput.inventory, "ironGear")).toBe(
      deliveredGears - 20,
    );
    expect(progressionInventoryCount(throughput.inventory, "copperWire")).toBe(
      deliveredWire - 40,
    );
  }, 30_000);
});
