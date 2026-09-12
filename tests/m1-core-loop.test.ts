import { describe, expect, it } from "vitest";

import {
  FactorySimulation,
} from "../src/game/simulation";
import {
  addProgressionInventory,
  availableCommissionIds,
  completeSelectedCommission,
  createCampaignProgression,
  createProgressionInventory,
  purchasePlacement,
  refundConstruction,
} from "../src/game/progression";
import {
  Direction,
  FIXED_TICK_RATE,
  type EntityKind,
  type EntityState,
  type RecipeId,
  type ResourceId,
} from "../src/game/types";

function placeOrThrow(
  simulation: FactorySimulation,
  kind: EntityKind,
  x: number,
  y: number,
  direction = Direction.East,
  recipeId?: RecipeId,
): EntityState {
  const placed = simulation.place(
    kind,
    x,
    y,
    direction,
    recipeId === undefined ? {} : { recipeId },
  );
  if (!placed.ok) {
    throw new Error(
      `Could not place ${kind} at ${x},${y}: ${placed.reason}.`,
    );
  }
  return placed.entity;
}

function buildSmeltingLine(
  simulation: FactorySimulation,
  y: number,
  resource: ResourceId,
  recipeId: RecipeId,
): void {
  expect(simulation.setResource(3, y, resource, 80)).toBe(true);
  placeOrThrow(simulation, "extractor", 3, y);
  for (let x = 5; x <= 9; x += 1) {
    placeOrThrow(simulation, "belt", x, y);
  }
  placeOrThrow(simulation, "inserter", 10, y);
  placeOrThrow(simulation, "smelter", 11, y, Direction.East, recipeId);
  placeOrThrow(simulation, "inserter", 13, y);
  for (let x = 14; x <= 24; x += 1) {
    placeOrThrow(simulation, "belt", x, y);
  }
}

describe("Milestone M1 playable campaign loop", () => {
  it("extracts, transports, processes, and submits the real Bootstrap manifest", () => {
    const simulation = new FactorySimulation({
      width: 64,
      height: 40,
      seed: 0x4d31,
      generateTerrain: false,
      generateResources: false,
      powerMode: "local",
    });

    // Exercise the same paid placement/provenance/refund lifecycle used by
    // player construction before committing the production layout.
    let progression = createCampaignProgression();
    const purchase = purchasePlacement(progression, "belt");
    expect(purchase.ok).toBe(true);
    if (!purchase.ok) throw new Error("Expected the starter belt purchase.");
    progression = purchase.state;
    const temporary = placeOrThrow(simulation, "belt", 60, 36);
    expect(simulation.remove(temporary.x, temporary.y)?.id).toBe(temporary.id);
    const refund = refundConstruction(progression, purchase.provenance);
    expect(refund).toMatchObject({ ok: true, refund: 2 });
    if (!refund.ok) throw new Error("Expected the full dismantle refund.");
    progression = refund.state;
    expect(progression.alloy).toBe(240);

    // One deterministic relay lattice covers every powered participant while
    // preserving ordinary local-grid assignment and dispatch.
    for (const y of [1, 8, 15, 22]) {
      for (const x of [1, 8, 15, 22, 29, 36]) {
        placeOrThrow(simulation, "gridRelay", x, y, Direction.North);
      }
    }
    const generator = placeOrThrow(simulation, "generator", 39, 2);
    expect(simulation.receive(generator.id, "coal", 40, "fuel")).toBe(40);

    buildSmeltingLine(simulation, 5, "iron", "smeltIron");
    buildSmeltingLine(simulation, 12, "copper", "smeltCopper");
    buildSmeltingLine(simulation, 19, "stone", "fireBrick");

    // The three product lines side-load one southbound trunk. The final
    // powered inserter is the only ingress into the mission depot.
    for (let y = 5; y <= 23; y += 1) {
      placeOrThrow(simulation, "belt", 25, y, Direction.South);
    }
    for (let x = 25; x <= 33; x += 1) {
      placeOrThrow(simulation, "belt", x, 24, Direction.East);
    }
    placeOrThrow(simulation, "inserter", 34, 24, Direction.East);
    const uplink = placeOrThrow(
      simulation,
      "storage",
      35,
      23,
      Direction.East,
    );

    const grid = simulation.powerGridSnapshot();
    expect(grid.mode).toBe("local");
    expect(
      grid.assignments.every(
        ({ relayId, networkId }) => relayId !== null && networkId !== null,
      ),
    ).toBe(true);

    simulation.drainEvents();
    simulation.step(FIXED_TICK_RATE * 120);

    const stats = simulation.stats();
    expect(stats.power.satisfaction).toBe(1);
    expect(stats.resourcesRemaining).toMatchObject({
      iron: expect.any(Number),
      copper: expect.any(Number),
      stone: expect.any(Number),
    });
    expect(stats.resourcesRemaining.iron).toBeLessThanOrEqual(56);
    expect(stats.resourcesRemaining.copper).toBeLessThanOrEqual(68);
    expect(stats.resourcesRemaining.stone).toBeLessThanOrEqual(56);

    const produced = simulation.productionLedger();
    expect(produced.ironOre).toBeGreaterThanOrEqual(24);
    expect(produced.copperOre).toBeGreaterThanOrEqual(12);
    expect(produced.stone).toBeGreaterThanOrEqual(24);
    expect(produced.ironPlate).toBeGreaterThanOrEqual(24);
    expect(produced.copperPlate).toBeGreaterThanOrEqual(12);
    expect(produced.stoneBrick).toBeGreaterThanOrEqual(12);

    const delivered = simulation.getEntity(uplink.id)?.inventory;
    expect(delivered?.ironPlate ?? 0).toBeGreaterThanOrEqual(24);
    expect(delivered?.copperPlate ?? 0).toBeGreaterThanOrEqual(12);
    expect(delivered?.stoneBrick ?? 0).toBeGreaterThanOrEqual(12);

    const uplinkTransfers = simulation
      .drainEvents()
      .filter(
        (event) =>
          event.type === "itemTransferred" && event.entityId === uplink.id,
      );
    for (const item of ["ironPlate", "copperPlate", "stoneBrick"] as const) {
      expect(uplinkTransfers.some((event) => event.item === item)).toBe(true);
    }

    let uplinkInventory = createProgressionInventory();
    for (const [item, amount] of [
      ["ironPlate", 24],
      ["copperPlate", 12],
      ["stoneBrick", 12],
    ] as const) {
      expect(simulation.withdrawStorage(uplink.id, item, amount)).toBe(amount);
      uplinkInventory = addProgressionInventory(
        uplinkInventory,
        item,
        amount,
      );
    }

    const completed = completeSelectedCommission(
      progression,
      uplinkInventory,
      simulation.tickCount,
    );
    expect(completed.ok).toBe(true);
    if (!completed.ok) throw new Error("Expected Bootstrap completion.");
    expect(completed.event).toMatchObject({
      commissionId: "bootstrap",
      alloyBefore: 240,
      alloyAwarded: 300,
      alloyAfter: 540,
      unlockedBuildKinds: ["fabricator"],
      unlockedRecipeIds: ["ironGear", "copperWire", "circuit"],
      unlockedCommissionIds: ["throughput", "control"],
    });
    expect(completed.state.alloy).toBe(540);
    expect(completed.state.selectedCommissionId).toBeNull();
    expect(completed.state.unlockedBuildKinds).toContain("fabricator");
    expect(completed.state.unlockedRecipeIds).toEqual([
      "smeltIron",
      "smeltCopper",
      "fireBrick",
      "ironGear",
      "copperWire",
      "circuit",
    ]);
    expect(availableCommissionIds(completed.state)).toEqual([
      "throughput",
      "control",
    ]);
  });
});
