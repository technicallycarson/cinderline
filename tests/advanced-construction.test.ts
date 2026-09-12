import { describe, expect, it } from "vitest";

import {
  CIRCUIT_ENTITY_KINDS,
  FLUID_ENTITY_KINDS,
  PLAYER_BUILD_KINDS,
} from "../src/game/catalog";
import {
  COMMISSION_DEFINITIONS,
  PROGRESSION_BUILD_COSTS,
  PROGRESSION_BUILD_KINDS,
  completeSelectedCommission,
  createCampaignProgression,
  createProgressionInventory,
  migrateLegacySandboxProgression,
  purchasePlacement,
  refundConstruction,
  restoreConstructionProvenance,
  restoreProgression,
  restoreProgressionWithBuildCatalogReconciliation,
  selectCommission,
  serializeProgression,
  type CommissionId,
  type ProgressionState,
} from "../src/game/progression";
import { FactorySimulation } from "../src/game/simulation";
import { Direction } from "../src/game/types";
import {
  HUD_ADVANCED_BUILD_ORDER,
  HUD_BUILD_ORDER,
  HUD_PRIMARY_BUILD_ORDER,
} from "../src/ui/HUD";

const ADVANCED_KINDS = [
  ...FLUID_ENTITY_KINDS,
  ...CIRCUIT_ENTITY_KINDS,
] as const;

const PRE_ADVANCED_KINDS = new Set([
  "belt",
  "extractor",
  "inserter",
  "smelter",
  "fabricator",
  "generator",
  "storage",
  "beacon",
  "manifold",
  "gridRelay",
]);

function completeCommission(
  state: ProgressionState,
  commissionId: CommissionId,
  tick: number,
): ProgressionState {
  if (state.selectedCommissionId !== commissionId) {
    const selected = selectCommission(state, commissionId);
    expect(selected.ok).toBe(true);
    if (!selected.ok) throw new Error(selected.reason);
    state = selected.state;
  }
  const definition = COMMISSION_DEFINITIONS.find(
    (candidate) => candidate.id === commissionId,
  )!;
  const inventory = createProgressionInventory(
    Object.fromEntries(
      definition.requirements.map((requirement) => [
        requirement.item,
        requirement.amount,
      ]),
    ),
  );
  const completed = completeSelectedCommission(state, inventory, tick);
  expect(completed.ok).toBe(true);
  if (!completed.ok) throw new Error(completed.reason);
  return completed.state;
}

function allAdvancedCampaignState(): ProgressionState {
  let state = completeCommission(
    createCampaignProgression(),
    "bootstrap",
    10,
  );
  state = completeCommission(state, "throughput", 20);
  return completeCommission(state, "control", 30);
}

describe("advanced player construction catalog", () => {
  it("keeps ordinary 1–9/0 stable and exposes all eight advanced hotkeys", () => {
    expect(HUD_PRIMARY_BUILD_ORDER).toEqual([
      "belt",
      "extractor",
      "inserter",
      "smelter",
      "fabricator",
      "generator",
      "storage",
      "beacon",
      "manifold",
      "gridRelay",
    ]);
    expect(HUD_ADVANCED_BUILD_ORDER).toEqual(ADVANCED_KINDS);
    expect(HUD_BUILD_ORDER).toEqual(PLAYER_BUILD_KINDS);
    expect(PROGRESSION_BUILD_KINDS).toEqual(PLAYER_BUILD_KINDS);
    expect(new Set(HUD_BUILD_ORDER).size).toBe(18);
  });

  it("uses deterministic positive costs and the audited unlock schedule", () => {
    expect(
      Object.fromEntries(
        ADVANCED_KINDS.map((kind) => [
          kind,
          PROGRESSION_BUILD_COSTS[kind],
        ]),
      ),
    ).toEqual({
      fluidSource: 32,
      fluidPump: 14,
      fluidPipe: 3,
      fluidTank: 36,
      fluidProcessor: 64,
      constantCombinator: 10,
      arithmeticCombinator: 16,
      deciderCombinator: 18,
    });

    const initial = createCampaignProgression();
    expect(
      ADVANCED_KINDS.filter((kind) =>
        initial.unlockedBuildKinds.includes(kind)
      ),
    ).toEqual([]);
    const bootstrap = completeCommission(initial, "bootstrap", 10);
    const throughput = completeCommission(
      bootstrap,
      "throughput",
      20,
    );
    expect(
      FLUID_ENTITY_KINDS.every((kind) =>
        throughput.unlockedBuildKinds.includes(kind)
      ),
    ).toBe(true);
    expect(
      CIRCUIT_ENTITY_KINDS.some((kind) =>
        throughput.unlockedBuildKinds.includes(kind)
      ),
    ).toBe(false);
    const control = completeCommission(
      completeCommission(
        createCampaignProgression(),
        "bootstrap",
        10,
      ),
      "control",
      20,
    );
    expect(
      CIRCUIT_ENTITY_KINDS.every((kind) =>
        control.unlockedBuildKinds.includes(kind)
      ),
    ).toBe(true);
    expect(
      FLUID_ENTITY_KINDS.some((kind) =>
        control.unlockedBuildKinds.includes(kind)
      ),
    ).toBe(false);
  });

  it("charges, records, restores, and fully refunds every advanced kind", () => {
    for (const kind of ADVANCED_KINDS) {
      const before = migrateLegacySandboxProgression(1_000);
      const purchased = purchasePlacement(before, kind);
      expect(purchased.ok).toBe(true);
      if (!purchased.ok) throw new Error(purchased.reason);
      const cost = PROGRESSION_BUILD_COSTS[kind];
      expect(purchased.state.alloy).toBe(1_000 - cost);
      expect(purchased.provenance).toMatchObject({
        source: "paid",
        buildKind: kind,
        paidCost: cost,
      });
      const restored = restoreConstructionProvenance(
        structuredClone(purchased.provenance),
      );
      const refunded = refundConstruction(purchased.state, restored);
      expect(refunded.ok).toBe(true);
      if (!refunded.ok) throw new Error(refunded.reason);
      expect(refunded.refund).toBe(cost);
      expect(refunded.state.alloy).toBe(1_000);
    }
  });
});

describe("advanced entity defaults and persistence", () => {
  it("round-trips all eight entities with fluid defaults and circuit devices", () => {
    const simulation = new FactorySimulation({
      width: 32,
      height: 18,
      seed: 0xad_8ced,
      generateTerrain: false,
      generateResources: false,
      powerMode: "legacyGlobal",
    });
    const placements = [
      ["fluidSource", 2, 2, { fluidId: "crudeOil" }],
      ["fluidPump", 5, 2, {}],
      ["fluidPipe", 7, 2, {}],
      ["fluidTank", 9, 2, {}],
      [
        "fluidProcessor",
        14,
        2,
        { fluidRecipeId: "refineCrude" },
      ],
      ["constantCombinator", 3, 9, {}],
      ["arithmeticCombinator", 5, 9, {}],
      ["deciderCombinator", 7, 9, {}],
    ] as const;
    for (const [kind, x, y, options] of placements) {
      const placed = simulation.place(
        kind,
        x,
        y,
        Direction.East,
        options,
      );
      expect(placed.ok).toBe(true);
    }

    const source = simulation.getEntities("fluidSource")[0]!;
    const processor = simulation.getEntities("fluidProcessor")[0]!;
    expect(source.fluidState?.sourceFluidId).toBe("crudeOil");
    expect(processor.fluidState?.recipeId).toBe("refineCrude");
    expect(
      simulation.circuitSnapshot().devices.map((device) => device.kind),
    ).toEqual(["constant", "arithmetic", "decider"]);

    const serialized = simulation.serialize();
    const restored = FactorySimulation.restore(serialized);
    expect(restored.serialize()).toEqual(serialized);
    expect(
      restored.getEntities("fluidSource")[0]?.fluidState?.sourceFluidId,
    ).toBe("crudeOil");
    expect(
      restored.getEntities("fluidProcessor")[0]?.fluidState?.recipeId,
    ).toBe("refineCrude");
    expect(restored.circuitSnapshot().devices).toEqual(
      simulation.circuitSnapshot().devices,
    );
  });
});

describe("pre-feature progression compatibility", () => {
  it("reconciles only the exact historical derived unlock catalog", () => {
    const current = allAdvancedCampaignState();
    const historical = structuredClone(current) as unknown as {
      unlockedBuildKinds: string[];
    };
    historical.unlockedBuildKinds =
      historical.unlockedBuildKinds.filter((kind) =>
        PRE_ADVANCED_KINDS.has(kind)
      );

    expect(() => restoreProgression(historical)).toThrow(
      "do not match completion state",
    );
    const reconciled =
      restoreProgressionWithBuildCatalogReconciliation(historical);
    expect(reconciled.unlockedBuildKinds).toEqual(
      current.unlockedBuildKinds,
    );
    expect(restoreProgression(JSON.parse(serializeProgression(reconciled))))
      .toEqual(reconciled);

    const partial = structuredClone(historical);
    partial.unlockedBuildKinds.push("fluidSource");
    expect(() =>
      restoreProgressionWithBuildCatalogReconciliation(partial)
    ).toThrow();
  });

  it("reconciles pre-feature legacy sandboxes without changing alloy", () => {
    const current = migrateLegacySandboxProgression(3_137);
    const historical = structuredClone(current) as unknown as {
      unlockedBuildKinds: string[];
    };
    historical.unlockedBuildKinds =
      historical.unlockedBuildKinds.filter((kind) =>
        PRE_ADVANCED_KINDS.has(kind)
      );
    const restored =
      restoreProgressionWithBuildCatalogReconciliation(historical);
    expect(restored.alloy).toBe(3_137);
    expect(restored.unlockedBuildKinds).toEqual(
      PROGRESSION_BUILD_KINDS,
    );
  });
});
