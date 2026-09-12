import { describe, expect, it } from "vitest";

import { RAIL_BUILD_COSTS } from "../src/game/railAuthoring";
import {
  CAMPAIGN_INITIAL_ALLOY,
  COMMISSION_CATALOG,
  COMMISSION_DEFINITIONS,
  COMMISSION_DEFINITION_VERSION,
  COMMISSION_IDS,
  CONSTRUCTION_REFUND_PERCENT,
  MAX_COMMISSION_DEFINITIONS,
  PROGRESSION_BUILD_COSTS,
  PROGRESSION_BUILD_KINDS,
  PROGRESSION_ITEM_IDS,
  PROGRESSION_RECIPE_IDS,
  addProgressionInventory,
  availableCommissionIds,
  benchmarkPreparedCommissionProbe,
  commitPlacement,
  commitSelectedCommissionCompletion,
  compareProgressionEvents,
  completeSelectedCommission,
  constructionRefundAmount,
  createCampaignProgression,
  createProgressionInventory,
  grantedConstructionProvenance,
  isPreparedCommissionReady,
  migrateLegacySandboxProgression,
  parseProgression,
  parseProgressionInventory,
  preflightPlacement,
  preflightSelectedCommissionCompletion,
  prepareSelectedCommissionProbe,
  progressionInventoryCount,
  purchasePlacement,
  refundConstruction,
  restoreConstructionProvenance,
  restoreProgression,
  restoreProgressionInventory,
  selectCommission,
  serializeProgression,
  serializeProgressionInventory,
  snapshotProgression,
  type CommissionCompletedEvent,
  type CommissionCompletionFailureReason,
  type CommissionId,
  type ProgressionInventory,
  type ProgressionItemId,
  type ProgressionState,
} from "../src/game/progression";

type MutableDeep<Value> =
  Value extends readonly (infer Entry)[]
    ? MutableDeep<Entry>[]
    : Value extends object
      ? { -readonly [Key in keyof Value]: MutableDeep<Value[Key]> }
      : Value;

function deepClone<Value>(value: Value): MutableDeep<Value> {
  return structuredClone(value) as MutableDeep<Value>;
}

function expectDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeepFrozen(nested);
}

function expectNoNegativeZero(value: unknown): void {
  if (typeof value === "number") {
    expect(Object.is(value, -0)).toBe(false);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) expectNoNegativeZero(entry);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) expectNoNegativeZero(entry);
  }
}

function inventoryFor(
  commissionId: CommissionId,
  multiplier = 1,
  extras: Partial<Record<ProgressionItemId, number>> = {},
): ProgressionInventory {
  const definition = COMMISSION_DEFINITIONS[
    COMMISSION_IDS.indexOf(commissionId)
  ]!;
  const counts: Partial<Record<ProgressionItemId, number>> = { ...extras };
  for (const requirement of definition.requirements) {
    counts[requirement.item] =
      (counts[requirement.item] ?? 0) + requirement.amount * multiplier;
  }
  return createProgressionInventory(counts);
}

function selectOrThrow(
  state: ProgressionState,
  commissionId: CommissionId,
): ProgressionState {
  const selection = selectCommission(state, commissionId);
  expect(selection.ok).toBe(true);
  if (!selection.ok) throw new Error(`Selection failed: ${selection.reason}`);
  return selection.state;
}

function completeOrThrow(
  state: ProgressionState,
  commissionId: CommissionId,
  tick: number,
  inventory = inventoryFor(commissionId),
): {
  readonly state: ProgressionState;
  readonly inventory: ProgressionInventory;
  readonly event: CommissionCompletedEvent;
} {
  if (state.selectedCommissionId !== commissionId) {
    state = selectOrThrow(state, commissionId);
  }
  const completion = completeSelectedCommission(state, inventory, tick);
  expect(completion.ok).toBe(true);
  if (!completion.ok) {
    throw new Error(`Completion failed: ${completion.reason}`);
  }
  return completion;
}

function stateAfterBootstrap(tick = 10): ProgressionState {
  return completeOrThrow(
    createCampaignProgression(),
    "bootstrap",
    tick,
  ).state;
}

function stateAtFrontier(tick = 40): ProgressionState {
  let state = stateAfterBootstrap(tick - 30);
  state = completeOrThrow(
    state,
    "throughput",
    tick - 20,
  ).state;
  state = completeOrThrow(state, "control", tick - 10).state;
  state = completeOrThrow(state, "autonomy", tick).state;
  return selectOrThrow(state, "frontier-shipment");
}

function stateBytes(state: ProgressionState): string {
  return serializeProgression(state);
}

function inventoryBytes(inventory: ProgressionInventory): string {
  return serializeProgressionInventory(inventory);
}

function expectAtomicCompletionFailure(
  state: ProgressionState,
  inventory: ProgressionInventory,
  tick: number,
  reason: CommissionCompletionFailureReason,
): void {
  const stateBefore = stateBytes(state);
  const inventoryBefore = inventoryBytes(inventory);
  const result = completeSelectedCommission(state, inventory, tick);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected completion failure.");
  expect(result.reason).toBe(reason);
  expect(result.state).toBe(state);
  expect(result.inventory).toBe(inventory);
  expect(stateBytes(state)).toBe(stateBefore);
  expect(inventoryBytes(inventory)).toBe(inventoryBefore);
}

describe("commission definitions", () => {
  it("encodes the audited five-commission graph exactly and deeply freezes it", () => {
    expect(COMMISSION_DEFINITION_VERSION).toBe(2);
    expect(COMMISSION_CATALOG).toEqual({
      version: 2,
      definitions: COMMISSION_DEFINITIONS,
    });
    expectDeepFrozen(COMMISSION_CATALOG);
    expect(COMMISSION_DEFINITIONS).toEqual([
      {
        id: "bootstrap",
        title: "Bootstrap",
        repeatable: false,
        prerequisiteIds: [],
        availabilityRecipeIds: [],
        requirements: [
          { item: "ironPlate", amount: 24 },
          { item: "copperPlate", amount: 12 },
          { item: "stoneBrick", amount: 12 },
        ],
        reward: {
          alloy: 300,
          buildKinds: ["fabricator"],
          recipeIds: ["ironGear", "copperWire", "circuit"],
        },
      },
      {
        id: "throughput",
        title: "Throughput",
        repeatable: false,
        prerequisiteIds: ["bootstrap"],
        availabilityRecipeIds: [],
        requirements: [
          { item: "ironGear", amount: 20 },
          { item: "copperWire", amount: 40 },
        ],
        reward: {
          alloy: 400,
          buildKinds: [
            "manifold",
            "fluidSource",
            "fluidPump",
            "fluidPipe",
            "fluidTank",
            "fluidProcessor",
          ],
          recipeIds: [],
        },
      },
      {
        id: "control",
        title: "Control",
        repeatable: false,
        prerequisiteIds: ["bootstrap"],
        availabilityRecipeIds: [],
        requirements: [
          { item: "circuit", amount: 12 },
          { item: "stoneBrick", amount: 24 },
        ],
        reward: {
          alloy: 300,
          buildKinds: [
            "beacon",
            "constantCombinator",
            "arithmeticCombinator",
            "deciderCombinator",
          ],
          recipeIds: [],
        },
      },
      {
        id: "autonomy",
        title: "Autonomy",
        repeatable: false,
        prerequisiteIds: ["throughput", "control"],
        availabilityRecipeIds: ["automationCore"],
        requirements: [{ item: "automationCore", amount: 6 }],
        reward: {
          alloy: 500,
          buildKinds: [],
          recipeIds: [],
        },
      },
      {
        id: "frontier-shipment",
        title: "Frontier shipment",
        repeatable: true,
        prerequisiteIds: ["autonomy"],
        availabilityRecipeIds: [],
        requirements: [
          { item: "automationCore", amount: 4 },
          { item: "stoneBrick", amount: 20 },
        ],
        reward: {
          alloy: 240,
          buildKinds: [],
          recipeIds: [],
        },
      },
    ]);
    expect(COMMISSION_DEFINITIONS).toHaveLength(5);
    expect(COMMISSION_DEFINITIONS.length).toBeLessThanOrEqual(
      MAX_COMMISSION_DEFINITIONS,
    );
    expectDeepFrozen(COMMISSION_DEFINITIONS);
    expectDeepFrozen(PROGRESSION_ITEM_IDS);
    expectDeepFrozen(PROGRESSION_BUILD_KINDS);
    expectDeepFrozen(PROGRESSION_RECIPE_IDS);
    expectDeepFrozen(PROGRESSION_BUILD_COSTS);
    expect(() => {
      (
        COMMISSION_DEFINITIONS as unknown as {
          pop(): unknown;
        }
      ).pop();
    }).toThrow();
    expect(() => {
      (
        COMMISSION_DEFINITIONS[0]!.requirements as unknown as {
          push(value: unknown): number;
        }
      ).push({ item: "coal", amount: 1 });
    }).toThrow();
  });

  it("funds each post-Bootstrap starter build with routing headroom", () => {
    const build = PROGRESSION_BUILD_COSTS;
    const requiredByReward: Readonly<Record<CommissionId, number>> = {
      // Automatic coal spur plus one input/output Fabricator cell.
      bootstrap:
        build.gridRelay + build.extractor + build.belt * 3 + build.inserter
        + build.fabricator + build.inserter * 2 + build.belt * 9,
      // One useful refinery: source, pump, processor, two tanks, routing,
      // local power, and a Dispatch manifold.
      throughput:
        build.manifold + build.fluidSource + build.fluidPump
        + build.fluidPipe * 3 + build.fluidTank * 2
        + build.fluidProcessor + build.gridRelay,
      // A complete signal chain, one controlled inserter, and one beacon.
      control:
        build.beacon + build.constantCombinator
        + build.arithmeticCombinator + build.deciderCombinator
        + build.inserter,
      // A two-station starter railway with a passing junction, signals,
      // locomotive, and two cargo wagons.
      autonomy:
        RAIL_BUILD_COSTS.straight * 24 + RAIL_BUILD_COSTS.curve * 2
        + RAIL_BUILD_COSTS.junction * 2 + RAIL_BUILD_COSTS.regularSignal
        + RAIL_BUILD_COSTS.chainSignal + RAIL_BUILD_COSTS.station * 2
        + RAIL_BUILD_COSTS.locomotive + RAIL_BUILD_COSTS.cargoWagon * 2,
      // One repeatable rail outpost expansion.
      "frontier-shipment":
        RAIL_BUILD_COSTS.straight * 12 + RAIL_BUILD_COSTS.regularSignal
        + RAIL_BUILD_COSTS.chainSignal + RAIL_BUILD_COSTS.station
        + RAIL_BUILD_COSTS.cargoWagon,
    };

    for (const definition of COMMISSION_DEFINITIONS) {
      const required = requiredByReward[definition.id];
      expect(
        definition.reward.alloy * 2,
        `${definition.id} reward lacks 50% construction headroom`,
      ).toBeGreaterThanOrEqual(required * 3);
    }
  });
});

describe("campaign flow", () => {
  it("starts sparse, canonical, and with only Bootstrap selected", () => {
    const state = createCampaignProgression();
    expect(state.alloy).toBe(CAMPAIGN_INITIAL_ALLOY);
    expect(state.selectedCommissionId).toBe("bootstrap");
    expect(state.unlockedBuildKinds).toEqual([
      "belt",
      "extractor",
      "inserter",
      "smelter",
      "generator",
      "storage",
      "gridRelay",
    ]);
    expect(state.unlockedRecipeIds).toEqual([
      "smeltIron",
      "smeltCopper",
      "fireBrick",
    ]);
    expect(availableCommissionIds(state)).toEqual(["bootstrap"]);
    expect(state.commissions.every(({ completionCount }) =>
      completionCount === 0
    )).toBe(true);
    expectDeepFrozen(state);
    expect(snapshotProgression(state)).toBe(state);
    expectNoNegativeZero(state);
  });

  it("consumes exact requirements, preserves surplus, and executes the full graph", () => {
    let state = createCampaignProgression();
    const bootstrapInventory = inventoryFor("bootstrap", 1, {
      ironPlate: 6,
      copperPlate: 3,
      stoneBrick: 8,
      coal: 9,
    });
    const bootstrap = completeOrThrow(
      state,
      "bootstrap",
      100,
      bootstrapInventory,
    );
    state = bootstrap.state;
    expect(state.alloy).toBe(540);
    expect(state.selectedCommissionId).toBeNull();
    expect(state.unlockedBuildKinds).toContain("fabricator");
    expect(state.unlockedRecipeIds).toEqual([
      "smeltIron",
      "smeltCopper",
      "fireBrick",
      "ironGear",
      "copperWire",
      "circuit",
    ]);
    expect(availableCommissionIds(state)).toEqual([
      "throughput",
      "control",
    ]);
    expect(bootstrap.event.unlockedBuildKinds).toEqual(["fabricator"]);
    expect(bootstrap.event.unlockedRecipeIds).toEqual([
      "ironGear",
      "copperWire",
      "circuit",
    ]);
    expect(bootstrap.event.unlockedCommissionIds).toEqual([
      "throughput",
      "control",
    ]);
    expect(progressionInventoryCount(bootstrap.inventory, "ironPlate")).toBe(
      6,
    );
    expect(
      progressionInventoryCount(bootstrap.inventory, "copperPlate"),
    ).toBe(3);
    expect(
      progressionInventoryCount(bootstrap.inventory, "stoneBrick"),
    ).toBe(8);
    expect(progressionInventoryCount(bootstrap.inventory, "coal")).toBe(9);

    const throughput = completeOrThrow(state, "throughput", 200);
    state = throughput.state;
    expect(state.alloy).toBe(940);
    expect(state.unlockedBuildKinds).toContain("manifold");
    expect(state.unlockedRecipeIds).not.toContain("automationCore");
    expect(availableCommissionIds(state)).toEqual(["control"]);
    expect(throughput.event.unlockedCommissionIds).toEqual([]);

    const control = completeOrThrow(state, "control", 300);
    state = control.state;
    expect(state.alloy).toBe(1_240);
    expect(state.unlockedBuildKinds).toContain("beacon");
    expect(state.unlockedRecipeIds).toContain("automationCore");
    expect(availableCommissionIds(state)).toEqual(["autonomy"]);
    expect(control.event.unlockedRecipeIds).toEqual(["automationCore"]);
    expect(control.event.unlockedCommissionIds).toEqual(["autonomy"]);

    const autonomy = completeOrThrow(state, "autonomy", 400);
    state = autonomy.state;
    expect(state.alloy).toBe(1_740);
    expect(availableCommissionIds(state)).toEqual(["frontier-shipment"]);
    expect(autonomy.event.unlockedCommissionIds).toEqual([
      "frontier-shipment",
    ]);

    state = selectOrThrow(state, "frontier-shipment");
    const repeatableInventory = inventoryFor("frontier-shipment", 2, {
      stoneBrick: 3,
      ironOre: 11,
    });
    const first = completeOrThrow(
      state,
      "frontier-shipment",
      500,
      repeatableInventory,
    );
    expect(first.state.selectedCommissionId).toBe("frontier-shipment");
    expect(first.state.alloy).toBe(1_980);
    expect(first.event.completionCount).toBe(1);
    expect(progressionInventoryCount(first.inventory, "automationCore")).toBe(
      4,
    );
    expect(progressionInventoryCount(first.inventory, "stoneBrick")).toBe(23);
    expect(progressionInventoryCount(first.inventory, "ironOre")).toBe(11);

    const second = completeOrThrow(
      first.state,
      "frontier-shipment",
      501,
      first.inventory,
    );
    expect(second.state.alloy).toBe(2_220);
    expect(second.state.selectedCommissionId).toBe("frontier-shipment");
    expect(second.state.commissions[4]).toEqual({
      id: "frontier-shipment",
      completionCount: 2,
      firstCompletedTick: 500,
      lastCompletedTick: 501,
    });
    expect(second.event.completionCount).toBe(2);
    expect(progressionInventoryCount(second.inventory, "automationCore")).toBe(
      0,
    );
    expect(progressionInventoryCount(second.inventory, "stoneBrick")).toBe(3);
    expect(progressionInventoryCount(second.inventory, "ironOre")).toBe(11);
    expectDeepFrozen(second.event);
    expectDeepFrozen(second.state);
    expectDeepFrozen(second.inventory);
    expectNoNegativeZero(second);
  });

  it("keeps concurrent branches independent and canonical in either order", () => {
    const run = (
      first: "throughput" | "control",
      second: "throughput" | "control",
    ): ProgressionState => {
      let state = stateAfterBootstrap(10);
      state = completeOrThrow(state, first, 20).state;
      expect(availableCommissionIds(state)).toEqual([second]);
      state = completeOrThrow(state, second, 20).state;
      return state;
    };
    const throughputFirst = run("throughput", "control");
    const controlFirst = run("control", "throughput");
    expect(serializeProgression(throughputFirst)).toBe(
      serializeProgression(controlFirst),
    );
    expect(availableCommissionIds(throughputFirst)).toEqual(["autonomy"]);
    expect(throughputFirst.unlockedRecipeIds).toContain("automationCore");
  });

  it("consumes only the selected branch and never uses unrelated inventory", () => {
    let state = stateAfterBootstrap();
    state = selectOrThrow(state, "throughput");
    const inventory = createProgressionInventory({
      ironGear: 20,
      copperWire: 40,
      circuit: 12,
      stoneBrick: 24,
    });
    const throughput = completeSelectedCommission(state, inventory, 20);
    expect(throughput.ok).toBe(true);
    if (!throughput.ok) throw new Error("Expected Throughput completion.");
    expect(progressionInventoryCount(throughput.inventory, "ironGear")).toBe(0);
    expect(progressionInventoryCount(throughput.inventory, "copperWire")).toBe(
      0,
    );
    expect(progressionInventoryCount(throughput.inventory, "circuit")).toBe(
      12,
    );
    expect(progressionInventoryCount(throughput.inventory, "stoneBrick")).toBe(
      24,
    );
    expectAtomicCompletionFailure(
      throughput.state,
      throughput.inventory,
      20,
      "noSelection",
    );
  });
});

describe("atomic completion transactions", () => {
  it("binds authorization to exact source state/inventory and consumes it once", () => {
    const state = createCampaignProgression();
    const inventory = inventoryFor("bootstrap");
    const stateBefore = stateBytes(state);
    const inventoryBefore = inventoryBytes(inventory);
    const preflight = preflightSelectedCommissionCompletion(
      state,
      inventory,
      10,
    );
    expect(preflight.ok).toBe(true);
    if (!preflight.ok) throw new Error("Expected successful preflight.");
    expectDeepFrozen(preflight.authorization);

    const forged = { ...preflight.authorization };
    expect(() =>
      commitSelectedCommissionCompletion(
        state,
        inventory,
        forged,
      )
    ).toThrow("not issued");
    expect(stateBytes(state)).toBe(stateBefore);
    expect(inventoryBytes(inventory)).toBe(inventoryBefore);

    const equalButDetachedState = restoreProgression(deepClone(state));
    expect(() =>
      commitSelectedCommissionCompletion(
        equalButDetachedState,
        inventory,
        preflight.authorization,
      )
    ).toThrow("does not match");
    const equalButDetachedInventory = restoreProgressionInventory(
      deepClone(inventory),
    );
    expect(() =>
      commitSelectedCommissionCompletion(
        state,
        equalButDetachedInventory,
        preflight.authorization,
      )
    ).toThrow("does not match");
    expect(stateBytes(state)).toBe(stateBefore);
    expect(inventoryBytes(inventory)).toBe(inventoryBefore);

    const committed = commitSelectedCommissionCompletion(
      state,
      inventory,
      preflight.authorization,
    );
    expect(committed.state.alloy).toBe(540);
    expect(() =>
      commitSelectedCommissionCompletion(
        state,
        inventory,
        preflight.authorization,
      )
    ).toThrow("not issued");
    expect(stateBytes(state)).toBe(stateBefore);
    expect(inventoryBytes(inventory)).toBe(inventoryBefore);
  });

  it("enforces source CAS across sibling tokens and cross-operation authorizations", () => {
    const state = createCampaignProgression();
    const inventory = inventoryFor("bootstrap");
    const first = preflightSelectedCommissionCompletion(
      state,
      inventory,
      10,
    );
    const identical = preflightSelectedCommissionCompletion(
      state,
      inventory,
      10,
    );
    expect(first.ok).toBe(true);
    expect(identical.ok).toBe(true);
    if (!first.ok || !identical.ok) {
      throw new Error("Expected identical completion preflights.");
    }
    expect(identical.authorization).toBe(first.authorization);
    const committed = commitSelectedCommissionCompletion(
      state,
      inventory,
      first.authorization,
    );
    expect(committed.state.revision).toBe(1);
    expect(() =>
      commitSelectedCommissionCompletion(
        state,
        inventory,
        identical.authorization,
      )
    ).toThrow("not issued");
    expect(
      preflightSelectedCommissionCompletion(state, inventory, 10),
    ).toMatchObject({ ok: false, reason: "sourceConsumed" });
    expect(preflightPlacement(state, "belt")).toMatchObject({
      ok: false,
      reason: "sourceConsumed",
    });
    expect(selectCommission(state, "bootstrap")).toMatchObject({
      ok: false,
      reason: "sourceConsumed",
    });

    const supersededState = createCampaignProgression();
    const supersededInventory = inventoryFor("bootstrap");
    const earlier = preflightSelectedCommissionCompletion(
      supersededState,
      supersededInventory,
      10,
    );
    const later = preflightSelectedCommissionCompletion(
      supersededState,
      supersededInventory,
      11,
    );
    if (!earlier.ok || !later.ok) {
      throw new Error("Expected completion preflights.");
    }
    expect(earlier.authorization).not.toBe(later.authorization);
    expect(() =>
      commitSelectedCommissionCompletion(
        supersededState,
        supersededInventory,
        earlier.authorization,
      )
    ).toThrow("not issued");
    expect(
      commitSelectedCommissionCompletion(
        supersededState,
        supersededInventory,
        later.authorization,
      ).event.tick,
    ).toBe(11);

    const crossState = createCampaignProgression();
    const crossInventory = inventoryFor("bootstrap");
    const completion = preflightSelectedCommissionCompletion(
      crossState,
      crossInventory,
      10,
    );
    const placement = preflightPlacement(crossState, "belt");
    if (!completion.ok || !placement.ok) {
      throw new Error("Expected cross-operation preflights.");
    }
    expect(() =>
      commitSelectedCommissionCompletion(
        crossState,
        crossInventory,
        completion.authorization,
      )
    ).toThrow("not issued");
    const purchase = commitPlacement(crossState, placement.authorization);
    expect(purchase.state.alloy).toBe(CAMPAIGN_INITIAL_ALLOY - 2);

    const placementState = createCampaignProgression();
    const belt = preflightPlacement(placementState, "belt");
    const beltAgain = preflightPlacement(placementState, "belt");
    if (!belt.ok || !beltAgain.ok) {
      throw new Error("Expected placement preflights.");
    }
    expect(beltAgain.authorization).toBe(belt.authorization);
    const extractor = preflightPlacement(placementState, "extractor");
    if (!extractor.ok) throw new Error("Expected extractor preflight.");
    expect(() =>
      commitPlacement(placementState, belt.authorization)
    ).toThrow("not issued");
    expect(
      commitPlacement(placementState, extractor.authorization).buildKind,
    ).toBe("extractor");
  });

  it("rejects every runtime completion failure without changing either input", () => {
    const afterBootstrap = stateAfterBootstrap();
    expectAtomicCompletionFailure(
      afterBootstrap,
      createProgressionInventory(),
      20,
      "noSelection",
    );
    expectAtomicCompletionFailure(
      createCampaignProgression(),
      createProgressionInventory({
        ironPlate: 23,
        copperPlate: 12,
        stoneBrick: 12,
      }),
      10,
      "insufficientItems",
    );

    let frontier = stateAtFrontier(40);
    let first = completeSelectedCommission(
      frontier,
      inventoryFor("frontier-shipment"),
      100,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("Expected Frontier completion.");
    frontier = first.state;
    expectAtomicCompletionFailure(
      frontier,
      inventoryFor("frontier-shipment"),
      99,
      "tickRegression",
    );

    const alloyOverflowSnapshot = deepClone(createCampaignProgression());
    alloyOverflowSnapshot.alloy = Number.MAX_SAFE_INTEGER - 100;
    expectAtomicCompletionFailure(
      restoreProgression(alloyOverflowSnapshot),
      inventoryFor("bootstrap"),
      10,
      "alloyOverflow",
    );

    const countOverflowSnapshot = deepClone(stateAtFrontier(40));
    countOverflowSnapshot.commissions[4]!.completionCount =
      Number.MAX_SAFE_INTEGER;
    countOverflowSnapshot.commissions[4]!.firstCompletedTick = 40;
    countOverflowSnapshot.commissions[4]!.lastCompletedTick = 40;
    countOverflowSnapshot.lastCompletionTick = 40;
    expect(() => restoreProgression(countOverflowSnapshot)).toThrow(
      "minimum reachable revision",
    );

    const revisionOverflowSnapshot = deepClone(createCampaignProgression());
    revisionOverflowSnapshot.revision = Number.MAX_SAFE_INTEGER;
    expectAtomicCompletionFailure(
      restoreProgression(revisionOverflowSnapshot),
      inventoryFor("bootstrap"),
      10,
      "revisionOverflow",
    );
  });

  it("does not invoke hostile getters in rejected snapshots or forged authorizations", () => {
    let getterCalls = 0;
    const hostileState = deepClone(createCampaignProgression()) as unknown as
      Record<string, unknown>;
    Object.defineProperty(hostileState, "alloy", {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        return 240;
      },
    });
    expect(() => restoreProgression(hostileState)).toThrow("data field");
    expect(getterCalls).toBe(0);

    const state = createCampaignProgression();
    const inventory = inventoryFor("bootstrap");
    const preflight = preflightSelectedCommissionCompletion(
      state,
      inventory,
      10,
    );
    if (!preflight.ok) throw new Error("Expected completion preflight.");
    const hostileAuthorization: Record<string, unknown> = {};
    Object.defineProperty(hostileAuthorization, "commissionId", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "bootstrap";
      },
    });
    expect(() =>
      commitSelectedCommissionCompletion(
        state,
        inventory,
        hostileAuthorization as never,
      )
    ).toThrow("not issued");
    expect(getterCalls).toBe(0);
    const completion = commitSelectedCommissionCompletion(
      state,
      inventory,
      preflight.authorization,
    );
    expect(completion.ok).toBe(true);
  });

  it("keeps brands and private authorization metadata opaque after prototype monkeypatching", () => {
    const weakMapDescriptors = {
      get: Object.getOwnPropertyDescriptor(WeakMap.prototype, "get")!,
      set: Object.getOwnPropertyDescriptor(WeakMap.prototype, "set")!,
      delete: Object.getOwnPropertyDescriptor(WeakMap.prototype, "delete")!,
    };
    const weakSetDescriptors = {
      add: Object.getOwnPropertyDescriptor(WeakSet.prototype, "add")!,
      has: Object.getOwnPropertyDescriptor(WeakSet.prototype, "has")!,
    };
    let callbackCount = 0;
    const leakedValues: unknown[] = [];
    let operationError: unknown;
    let completionAlloy: number | undefined;
    let placementAlloy: number | undefined;
    let preparedReady: boolean | undefined;
    let grantedRefund: number | undefined;

    try {
      Object.defineProperty(WeakMap.prototype, "get", {
        ...weakMapDescriptors.get,
        value() {
          callbackCount += 1;
          return undefined;
        },
      });
      Object.defineProperty(WeakMap.prototype, "set", {
        ...weakMapDescriptors.set,
        value(_key: object, value: unknown) {
          callbackCount += 1;
          leakedValues.push(value);
          return this;
        },
      });
      Object.defineProperty(WeakMap.prototype, "delete", {
        ...weakMapDescriptors.delete,
        value() {
          callbackCount += 1;
          return false;
        },
      });
      Object.defineProperty(WeakSet.prototype, "add", {
        ...weakSetDescriptors.add,
        value(value: unknown) {
          callbackCount += 1;
          leakedValues.push(value);
          return this;
        },
      });
      Object.defineProperty(WeakSet.prototype, "has", {
        ...weakSetDescriptors.has,
        value() {
          callbackCount += 1;
          return false;
        },
      });

      const state = createCampaignProgression();
      const inventory = inventoryFor("bootstrap");
      const probe = prepareSelectedCommissionProbe(state);
      preparedReady = isPreparedCommissionReady(
        probe,
        state,
        inventory,
        10,
      );
      const preflight = preflightSelectedCommissionCompletion(
        state,
        inventory,
        10,
      );
      if (!preflight.ok) throw new Error("Completion preflight failed.");
      const completion = commitSelectedCommissionCompletion(
        state,
        inventory,
        preflight.authorization,
      );
      completionAlloy = completion.state.alloy;

      const placement = preflightPlacement(completion.state, "belt");
      if (!placement.ok) throw new Error("Placement preflight failed.");
      placementAlloy = commitPlacement(
        completion.state,
        placement.authorization,
      ).state.alloy;
      grantedRefund = constructionRefundAmount(
        grantedConstructionProvenance("belt"),
      );
    } catch (error) {
      operationError = error;
    } finally {
      Object.defineProperty(
        WeakMap.prototype,
        "get",
        weakMapDescriptors.get,
      );
      Object.defineProperty(
        WeakMap.prototype,
        "set",
        weakMapDescriptors.set,
      );
      Object.defineProperty(
        WeakMap.prototype,
        "delete",
        weakMapDescriptors.delete,
      );
      Object.defineProperty(
        WeakSet.prototype,
        "add",
        weakSetDescriptors.add,
      );
      Object.defineProperty(
        WeakSet.prototype,
        "has",
        weakSetDescriptors.has,
      );
    }

    expect(operationError).toBeUndefined();
    expect(callbackCount).toBe(0);
    expect(leakedValues).toEqual([]);
    expect(preparedReady).toBe(true);
    expect(completionAlloy).toBe(540);
    expect(placementAlloy).toBe(538);
    expect(grantedRefund).toBe(0);
  });

  it("retains captured freeze, descriptor, JSON, and numeric-storage intrinsics after monkeypatching", () => {
    const descriptors = {
      freeze: Object.getOwnPropertyDescriptor(Object, "freeze")!,
      getPrototypeOf:
        Object.getOwnPropertyDescriptor(Object, "getPrototypeOf")!,
      getOwnPropertyNames:
        Object.getOwnPropertyDescriptor(Object, "getOwnPropertyNames")!,
      getOwnPropertySymbols:
        Object.getOwnPropertyDescriptor(Object, "getOwnPropertySymbols")!,
      getOwnPropertyDescriptor:
        Object.getOwnPropertyDescriptor(
          Object,
          "getOwnPropertyDescriptor",
        )!,
      isArray: Object.getOwnPropertyDescriptor(Array, "isArray")!,
      parse: Object.getOwnPropertyDescriptor(JSON, "parse")!,
      stringify: Object.getOwnPropertyDescriptor(JSON, "stringify")!,
      float64: Object.getOwnPropertyDescriptor(
        globalThis,
        "Float64Array",
      )!,
    };
    let callbackCount = 0;
    let operationError: unknown;
    let completedState: ProgressionState | undefined;

    const hostile = () => {
      callbackCount += 1;
      throw new Error("hostile intrinsic callback");
    };
    try {
      Object.defineProperty(Object, "freeze", {
        ...descriptors.freeze,
        value: hostile,
      });
      Object.defineProperty(Object, "getPrototypeOf", {
        ...descriptors.getPrototypeOf,
        value: hostile,
      });
      Object.defineProperty(Object, "getOwnPropertyNames", {
        ...descriptors.getOwnPropertyNames,
        value: hostile,
      });
      Object.defineProperty(Object, "getOwnPropertySymbols", {
        ...descriptors.getOwnPropertySymbols,
        value: hostile,
      });
      Object.defineProperty(Object, "getOwnPropertyDescriptor", {
        ...descriptors.getOwnPropertyDescriptor,
        value: hostile,
      });
      Object.defineProperty(Array, "isArray", {
        ...descriptors.isArray,
        value: hostile,
      });
      Object.defineProperty(JSON, "parse", {
        ...descriptors.parse,
        value: hostile,
      });
      Object.defineProperty(JSON, "stringify", {
        ...descriptors.stringify,
        value: hostile,
      });
      Object.defineProperty(globalThis, "Float64Array", {
        ...descriptors.float64,
        value: hostile,
      });

      const state = parseProgression(
        serializeProgression(createCampaignProgression()),
      );
      const inventory = parseProgressionInventory(
        serializeProgressionInventory(inventoryFor("bootstrap")),
      );
      const completion = completeSelectedCommission(
        state,
        inventory,
        10,
      );
      if (!completion.ok) throw new Error("Completion failed.");
      completedState = completion.state;
    } catch (error) {
      operationError = error;
    } finally {
      Object.defineProperty(Object, "freeze", descriptors.freeze);
      Object.defineProperty(
        Object,
        "getPrototypeOf",
        descriptors.getPrototypeOf,
      );
      Object.defineProperty(
        Object,
        "getOwnPropertyNames",
        descriptors.getOwnPropertyNames,
      );
      Object.defineProperty(
        Object,
        "getOwnPropertySymbols",
        descriptors.getOwnPropertySymbols,
      );
      Object.defineProperty(
        Object,
        "getOwnPropertyDescriptor",
        descriptors.getOwnPropertyDescriptor,
      );
      Object.defineProperty(Array, "isArray", descriptors.isArray);
      Object.defineProperty(JSON, "parse", descriptors.parse);
      Object.defineProperty(JSON, "stringify", descriptors.stringify);
      Object.defineProperty(
        globalThis,
        "Float64Array",
        descriptors.float64,
      );
    }

    expect(operationError).toBeUndefined();
    expect(callbackCount).toBe(0);
    expect(completedState?.alloy).toBe(540);
    expectDeepFrozen(completedState);
  });

  it("blocks the typed-array length receiver leak from private inventory buffers", () => {
    const typedArrayPrototype = Object.getPrototypeOf(
      Float64Array.prototype,
    );
    const lengthDescriptor = Object.getOwnPropertyDescriptor(
      typedArrayPrototype,
      "length",
    );
    if (!lengthDescriptor?.get) {
      throw new Error("Missing intrinsic typed-array length accessor.");
    }
    const intrinsicLength = lengthDescriptor.get;
    let callbackCount = 0;
    let leakedReceiver: object | undefined;
    let operationError: unknown;
    let completionReason: string | undefined;
    let serializedBefore = "";
    let serializedAfter = "";
    let publicIron = -1;

    try {
      Object.defineProperty(typedArrayPrototype, "length", {
        ...lengthDescriptor,
        get(this: object) {
          callbackCount += 1;
          leakedReceiver = this;
          return Reflect.apply(intrinsicLength, this, []);
        },
      });
      const inventory = createProgressionInventory();
      serializedBefore = serializeProgressionInventory(inventory);
      publicIron = progressionInventoryCount(inventory, "ironPlate");
      if (leakedReceiver !== undefined) {
        const leaked = leakedReceiver as Float64Array;
        leaked[4] = 24;
        leaked[5] = 12;
        leaked[6] = 12;
      }
      const completion = completeSelectedCommission(
        createCampaignProgression(),
        inventory,
        10,
      );
      completionReason = completion.ok ? "ok" : completion.reason;
      serializedAfter = serializeProgressionInventory(inventory);
      addProgressionInventory(inventory, "ironOre", 1);
    } catch (error) {
      operationError = error;
    } finally {
      Object.defineProperty(
        typedArrayPrototype,
        "length",
        lengthDescriptor,
      );
    }

    expect(operationError).toBeUndefined();
    expect(callbackCount).toBe(0);
    expect(leakedReceiver).toBeUndefined();
    expect(publicIron).toBe(0);
    expect(completionReason).toBe("insufficientItems");
    expect(serializedBefore).toBe(
      '{"format":"cinderline-progression-inventory","version":1,"entries":[]}',
    );
    expect(serializedAfter).toBe(serializedBefore);
  });

  it("uses schema encoders without inherited object or array toJSON hooks", () => {
    const objectDescriptor = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "toJSON",
    );
    const arrayDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "toJSON",
    );
    const state = stateAtFrontier();
    const inventory = createProgressionInventory({
      ironOre: 2,
      stoneBrick: 41,
      automationCore: 9,
    });
    const expectedState = serializeProgression(state);
    const expectedInventory = serializeProgressionInventory(inventory);
    let callbackCount = 0;
    let operationError: unknown;
    let stateBytesAfter = "";
    let inventoryBytesAfter = "";

    try {
      Object.defineProperty(Object.prototype, "toJSON", {
        configurable: true,
        writable: true,
        value() {
          callbackCount += 1;
          return { forged: true };
        },
      });
      Object.defineProperty(Array.prototype, "toJSON", {
        configurable: true,
        writable: true,
        value() {
          callbackCount += 1;
          return ["forged"];
        },
      });
      stateBytesAfter = serializeProgression(
        parseProgression(serializeProgression(state)),
      );
      inventoryBytesAfter = serializeProgressionInventory(
        parseProgressionInventory(
          serializeProgressionInventory(inventory),
        ),
      );
    } catch (error) {
      operationError = error;
    } finally {
      if (arrayDescriptor) {
        Object.defineProperty(
          Array.prototype,
          "toJSON",
          arrayDescriptor,
        );
      } else {
        delete (Array.prototype as { toJSON?: unknown }).toJSON;
      }
      if (objectDescriptor) {
        Object.defineProperty(
          Object.prototype,
          "toJSON",
          objectDescriptor,
        );
      } else {
        delete (Object.prototype as { toJSON?: unknown }).toJSON;
      }
    }

    expect(operationError).toBeUndefined();
    expect(callbackCount).toBe(0);
    expect(stateBytesAfter).toBe(expectedState);
    expect(inventoryBytesAfter).toBe(expectedInventory);
  });

  it("never delegates progression authority to ambient Array or Set operations", () => {
    const arrayPrototype = Array.prototype;
    const iteratorDescriptor = Object.getOwnPropertyDescriptor(
      arrayPrototype,
      Symbol.iterator,
    )!;
    const methodNames = [
      "map",
      "filter",
      "some",
      "includes",
      "join",
      "push",
      "sort",
    ] as const;
    const methodDescriptors = new Array<PropertyDescriptor>(
      methodNames.length,
    );
    for (let index = 0; index < methodNames.length; index += 1) {
      methodDescriptors[index] = Object.getOwnPropertyDescriptor(
        arrayPrototype,
        methodNames[index]!,
      )!;
    }
    const setHasDescriptor = Object.getOwnPropertyDescriptor(
      Set.prototype,
      "has",
    )!;
    const setAddDescriptor = Object.getOwnPropertyDescriptor(
      Set.prototype,
      "add",
    )!;
    const emptyInventory = createProgressionInventory();
    const paidInventory = inventoryFor("bootstrap");
    let iteratorCalls = 0;
    let methodCalls = 0;
    let setCalls = 0;
    let operationError: unknown;
    let created: ProgressionState | undefined;
    let restored: ProgressionState | undefined;
    let missingReason = "";
    let autonomyReason = "";
    let placementReason = "";
    let completed: ReturnType<typeof completeSelectedCommission> | undefined;

    try {
      Object.defineProperty(arrayPrototype, Symbol.iterator, {
        ...iteratorDescriptor,
        value() {
          iteratorCalls += 1;
          throw new Error("AMBIENT_ARRAY_ITERATOR_MUST_NOT_RUN");
        },
      });
      for (let index = 0; index < methodNames.length; index += 1) {
        const name = methodNames[index]!;
        Object.defineProperty(arrayPrototype, name, {
          ...methodDescriptors[index]!,
          value() {
            methodCalls += 1;
            throw new Error(`AMBIENT_ARRAY_${name}_MUST_NOT_RUN`);
          },
        });
      }
      Object.defineProperty(Set.prototype, "has", {
        ...setHasDescriptor,
        value() {
          setCalls += 1;
          throw new Error("AMBIENT_SET_HAS_MUST_NOT_RUN");
        },
      });
      Object.defineProperty(Set.prototype, "add", {
        ...setAddDescriptor,
        value() {
          setCalls += 1;
          throw new Error("AMBIENT_SET_ADD_MUST_NOT_RUN");
        },
      });

      created = createCampaignProgression();
      restored = parseProgression(serializeProgression(created));
      const missing = completeSelectedCommission(
        created,
        emptyInventory,
        1,
      );
      missingReason = missing.ok ? "ok" : missing.reason;
      const autonomy = selectCommission(created, "autonomy");
      autonomyReason = autonomy.ok ? "ok" : autonomy.reason;
      const placement = preflightPlacement(created, "beacon");
      placementReason = placement.ok ? "ok" : placement.reason;
      completed = completeSelectedCommission(created, paidInventory, 1);
    } catch (error) {
      operationError = error;
    } finally {
      Object.defineProperty(
        arrayPrototype,
        Symbol.iterator,
        iteratorDescriptor,
      );
      for (let index = 0; index < methodNames.length; index += 1) {
        Object.defineProperty(
          arrayPrototype,
          methodNames[index]!,
          methodDescriptors[index]!,
        );
      }
      Object.defineProperty(Set.prototype, "has", setHasDescriptor);
      Object.defineProperty(Set.prototype, "add", setAddDescriptor);
    }

    expect(operationError).toBeUndefined();
    expect(iteratorCalls).toBe(0);
    expect(methodCalls).toBe(0);
    expect(setCalls).toBe(0);
    expect(created?.revision).toBe(0);
    expect(created?.unlockedBuildKinds).toEqual([
      "belt",
      "extractor",
      "inserter",
      "smelter",
      "generator",
      "storage",
      "gridRelay",
    ]);
    expect(created?.unlockedRecipeIds).toEqual([
      "smeltIron",
      "smeltCopper",
      "fireBrick",
    ]);
    expect(restored).toEqual(created);
    expect(missingReason).toBe("insufficientItems");
    expect(autonomyReason).toBe("unavailable");
    expect(placementReason).toBe("locked");
    expect(completed?.ok).toBe(true);
    if (!completed?.ok) throw new Error("Expected Bootstrap completion.");
    expect(completed.state.unlockedBuildKinds).not.toContain("beacon");
    expect(completed.state.unlockedBuildKinds).not.toContain("manifold");
    expect(completed.state.unlockedRecipeIds).toEqual([
      "smeltIron",
      "smeltCopper",
      "fireBrick",
      "ironGear",
      "copperWire",
      "circuit",
    ]);
    expect(progressionInventoryCount(completed.inventory, "ironPlate")).toBe(0);
    expect(
      progressionInventoryCount(completed.inventory, "copperPlate"),
    ).toBe(0);
    expect(
      progressionInventoryCount(completed.inventory, "stoneBrick"),
    ).toBe(0);
  });

  it("captures Object.is and safe-integer hooks so -0 stays rejected", () => {
    const descriptors = {
      objectIs: Object.getOwnPropertyDescriptor(Object, "is")!,
      isSafeInteger:
        Object.getOwnPropertyDescriptor(Number, "isSafeInteger")!,
      floor: Object.getOwnPropertyDescriptor(Math, "floor")!,
      min: Object.getOwnPropertyDescriptor(Math, "min")!,
      max: Object.getOwnPropertyDescriptor(Math, "max")!,
      ceil: Object.getOwnPropertyDescriptor(Math, "ceil")!,
    };
    const stateSnapshot = deepClone(createCampaignProgression());
    stateSnapshot.revision = -0;
    const inventorySnapshot = deepClone(
      createProgressionInventory({ ironPlate: 1 }),
    );
    inventorySnapshot.entries[0]!.count = -0;
    const inventory = inventoryFor("bootstrap");
    const state = createCampaignProgression();
    const probe = prepareSelectedCommissionProbe(state);
    const paid = purchasePlacement(
      migrateLegacySandboxProgression(100),
      "belt",
    );
    if (!paid.ok) throw new Error("Expected paid provenance.");
    let callbackCount = 0;
    let operationError: unknown;
    let rejectedCount = 0;
    let refund = -1;
    let benchmarkReady = false;
    const reject = (operation: () => unknown): void => {
      try {
        operation();
      } catch {
        rejectedCount += 1;
      }
    };

    try {
      Object.defineProperty(Object, "is", {
        ...descriptors.objectIs,
        value() {
          callbackCount += 1;
          return false;
        },
      });
      Object.defineProperty(Number, "isSafeInteger", {
        ...descriptors.isSafeInteger,
        value() {
          callbackCount += 1;
          return true;
        },
      });
      for (const key of ["floor", "min", "max", "ceil"] as const) {
        Object.defineProperty(Math, key, {
          ...descriptors[key],
          value() {
            callbackCount += 1;
            throw new Error(`hostile Math.${key}`);
          },
        });
      }
      reject(() => createCampaignProgression(-0));
      reject(() => createProgressionInventory({ ironPlate: -0 }));
      reject(() =>
        addProgressionInventory(
          createProgressionInventory(),
          "ironPlate",
          -0,
        )
      );
      reject(() => restoreProgression(stateSnapshot));
      reject(() => restoreProgressionInventory(inventorySnapshot));
      reject(() =>
        benchmarkPreparedCommissionProbe(
          probe,
          state,
          inventory,
          10,
          { warmupSamples: -0, samples: 1, nominalEntityCount: 1 },
        )
      );
      refund = constructionRefundAmount(paid.provenance);
      benchmarkReady = benchmarkPreparedCommissionProbe(
        probe,
        state,
        inventory,
        10,
        { warmupSamples: 1, samples: 1, nominalEntityCount: 1 },
      ).ready;
    } catch (error) {
      operationError = error;
    } finally {
      Object.defineProperty(Object, "is", descriptors.objectIs);
      Object.defineProperty(
        Number,
        "isSafeInteger",
        descriptors.isSafeInteger,
      );
      Object.defineProperty(Math, "floor", descriptors.floor);
      Object.defineProperty(Math, "min", descriptors.min);
      Object.defineProperty(Math, "max", descriptors.max);
      Object.defineProperty(Math, "ceil", descriptors.ceil);
    }

    expect(operationError).toBeUndefined();
    expect(callbackCount).toBe(0);
    expect(rejectedCount).toBe(6);
    expect(refund).toBe(2);
    expect(benchmarkReady).toBe(true);
  });
});

describe("deterministic snapshots and continuation", () => {
  it("round-trips campaign, legacy, inventory, and arbitrary property order canonically", () => {
    const campaign = stateAtFrontier();
    const campaignRoundTrip = parseProgression(
      serializeProgression(campaign),
    );
    expect(serializeProgression(campaignRoundTrip)).toBe(
      serializeProgression(campaign),
    );
    const legacy = migrateLegacySandboxProgression(3_200);
    expect(parseProgression(serializeProgression(legacy))).toEqual(legacy);

    const inventory = createProgressionInventory({
      automationCore: 9,
      ironOre: 2,
      stoneBrick: 41,
    });
    expect(
      serializeProgressionInventory(
        parseProgressionInventory(
          serializeProgressionInventory(inventory),
        ),
      ),
    ).toBe(serializeProgressionInventory(inventory));

    const reordered = {
      commissions: deepClone(campaign.commissions),
      unlockedRecipeIds: [...campaign.unlockedRecipeIds],
      unlockedBuildKinds: [...campaign.unlockedBuildKinds],
      selectedCommissionId: campaign.selectedCommissionId,
      lastCompletionTick: campaign.lastCompletionTick,
      alloy: campaign.alloy,
      revision: campaign.revision,
      mode: campaign.mode,
      version: campaign.version,
      format: campaign.format,
    };
    expect(serializeProgression(restoreProgression(reordered))).toBe(
      serializeProgression(campaign),
    );
  });

  it("is detached from restore/create inputs and deeply immutable", () => {
    const inventoryInput: Partial<Record<ProgressionItemId, number>> = {
      ironPlate: 24,
    };
    const inventory = createProgressionInventory(inventoryInput);
    inventoryInput.ironPlate = 999;
    expect(progressionInventoryCount(inventory, "ironPlate")).toBe(24);

    const mutableSnapshot = deepClone(stateAfterBootstrap());
    const restored = restoreProgression(mutableSnapshot);
    const restoredBytes = serializeProgression(restored);
    mutableSnapshot.alloy = 0;
    mutableSnapshot.unlockedBuildKinds.pop();
    mutableSnapshot.commissions[0]!.completionCount = 0;
    expect(serializeProgression(restored)).toBe(restoredBytes);

    const mutableInventorySnapshot = deepClone(inventory);
    const restoredInventory = restoreProgressionInventory(
      mutableInventorySnapshot,
    );
    mutableInventorySnapshot.entries[0]!.count = 1;
    expect(progressionInventoryCount(restoredInventory, "ironPlate")).toBe(24);
    expectDeepFrozen(restored);
    expectDeepFrozen(restoredInventory);
    expect(() => {
      (
        restored.unlockedBuildKinds as unknown as {
          pop(): unknown;
        }
      ).pop();
    }).toThrow();
  });

  it("produces identical one-item-before and completion-tick continuations under tick grouping", () => {
    const schedules = [
      Array.from({ length: 600 }, () => 1),
      [...Array.from({ length: 85 }, () => 7), 5],
      Array.from({ length: 10 }, () => 60),
      [113, 17, 89, 3, 211, 67, 100],
    ];
    const outcomes: string[] = [];
    for (const schedule of schedules) {
      expect(schedule.reduce((sum, value) => sum + value, 0)).toBe(600);
      let state = createCampaignProgression();
      let inventory = createProgressionInventory({
        ironPlate: 23,
        copperPlate: 12,
        stoneBrick: 12,
      });
      let tick = 0;
      for (const group of schedule) {
        tick += group;
        if (tick < 600) {
          const attempt = completeSelectedCommission(state, inventory, tick);
          expect(attempt.ok).toBe(false);
          expect(attempt.state).toBe(state);
          expect(attempt.inventory).toBe(inventory);
        }
      }
      state = parseProgression(serializeProgression(state));
      inventory = parseProgressionInventory(
        serializeProgressionInventory(inventory),
      );
      inventory = addProgressionInventory(inventory, "ironPlate", 1);
      const completion = completeSelectedCommission(state, inventory, tick);
      expect(completion.ok).toBe(true);
      if (!completion.ok) throw new Error("Expected grouped completion.");

      let continuationState = parseProgression(
        serializeProgression(completion.state),
      );
      continuationState = selectOrThrow(
        continuationState,
        "throughput",
      );
      const continuation = completeSelectedCommission(
        continuationState,
        parseProgressionInventory(
          serializeProgressionInventory(inventoryFor("throughput")),
        ),
        900,
      );
      expect(continuation.ok).toBe(true);
      if (!continuation.ok) throw new Error("Expected continuation.");
      outcomes.push(JSON.stringify({
        state: continuation.state,
        inventory: continuation.inventory,
        event: continuation.event,
      }));
    }
    expect(new Set(outcomes).size).toBe(1);
  });

  it("preserves grouped atomicity across randomized schedules and save boundaries", () => {
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 96; seed += 1) {
      let random = seed >>> 0;
      const nextRandom = (): number => {
        random = (
          Math.imul(random, 1_664_525) + 1_013_904_223
        ) >>> 0;
        return random;
      };
      let state = createCampaignProgression();
      let inventory = createProgressionInventory({
        ironPlate: 23,
        copperPlate: 12,
        stoneBrick: 12,
      });
      let tick = 0;
      while (tick < 600) {
        const group = Math.min(600 - tick, 1 + nextRandom() % 79);
        tick += group;
        if (tick < 600) {
          const stateBefore = stateBytes(state);
          const inventoryBefore = inventoryBytes(inventory);
          const attempt = completeSelectedCommission(
            state,
            inventory,
            tick,
          );
          expect(attempt).toMatchObject({
            ok: false,
            reason: "insufficientItems",
          });
          expect(stateBytes(state)).toBe(stateBefore);
          expect(inventoryBytes(inventory)).toBe(inventoryBefore);
          expect(preflightPlacement(state, "beacon")).toMatchObject({
            ok: false,
            reason: "locked",
          });
          expect(selectCommission(state, "control")).toMatchObject({
            ok: false,
            reason: "unavailable",
          });
        }
        if ((nextRandom() & 3) === 0) {
          state = parseProgression(serializeProgression(state));
          inventory = parseProgressionInventory(
            serializeProgressionInventory(inventory),
          );
        }
      }
      inventory = addProgressionInventory(inventory, "ironPlate", 1);
      const stateBefore = stateBytes(state);
      const inventoryBefore = inventoryBytes(inventory);
      const first = preflightSelectedCommissionCompletion(
        state,
        inventory,
        tick,
      );
      const sibling = preflightSelectedCommissionCompletion(
        state,
        inventory,
        tick,
      );
      if (!first.ok || !sibling.ok) {
        throw new Error("Expected randomized completion preflight.");
      }
      expect(sibling.authorization).toBe(first.authorization);
      expect(() =>
        commitSelectedCommissionCompletion(
          state,
          inventory,
          { ...first.authorization },
        )
      ).toThrow("not issued");
      const completion = commitSelectedCommissionCompletion(
        state,
        inventory,
        first.authorization,
      );
      expect(stateBytes(state)).toBe(stateBefore);
      expect(inventoryBytes(inventory)).toBe(inventoryBefore);
      outcomes.add(
        serializeProgression(completion.state)
          + "\n" + serializeProgressionInventory(completion.inventory)
          + "\n" + JSON.stringify(completion.event),
      );
    }
    expect(outcomes.size).toBe(1);
  });

  it("sorts same-tick events by immutable commission definition order", () => {
    const bootstrap = completeOrThrow(
      createCampaignProgression(),
      "bootstrap",
      10,
    );
    const throughput = completeOrThrow(
      bootstrap.state,
      "throughput",
      20,
    );
    const control = completeOrThrow(
      throughput.state,
      "control",
      20,
    );
    const shuffled = [control.event, bootstrap.event, throughput.event];
    shuffled.sort(compareProgressionEvents);
    expect(shuffled.map(({ commissionId }) => commissionId)).toEqual([
      "bootstrap",
      "throughput",
      "control",
    ]);
  });
});

describe("strict restore validation", () => {
  it("rejects duplicate JSON members, including nested and escape-equivalent keys", () => {
    const state = serializeProgression(createCampaignProgression());
    const inventory = serializeProgressionInventory(
      createProgressionInventory({ ironPlate: 2 }),
    );
    const duplicateRoot = state.replace(
      '{"format":',
      '{"format":"cinderline-progression","format":',
    );
    const escapedDuplicateRoot = state.replace(
      '{"format":',
      '{"f\\u006frmat":"cinderline-progression","format":',
    );
    const duplicateCommission = state.replace(
      '{"id":"bootstrap","completionCount":',
      '{"id":"bootstrap","id":"bootstrap","completionCount":',
    );
    const duplicateInventoryEntry = inventory.replace(
      '{"item":"ironPlate","count":',
      '{"item":"ironPlate","item":"ironPlate","count":',
    );

    expect(() => parseProgression(duplicateRoot)).toThrow(
      "duplicate member",
    );
    expect(() => parseProgression(escapedDuplicateRoot)).toThrow(
      "duplicate member",
    );
    expect(() => parseProgression(duplicateCommission)).toThrow(
      "duplicate member",
    );
    expect(() =>
      parseProgressionInventory(duplicateInventoryEntry)
    ).toThrow("duplicate member");
  });

  it("rejects unreachable completion ticks and revisions", () => {
    const mismatchedTick = deepClone(stateAfterBootstrap(10));
    mismatchedTick.commissions[0]!.lastCompletedTick = 11;
    mismatchedTick.lastCompletionTick = 11;
    expect(() => restoreProgression(mismatchedTick)).toThrow(
      "completion ticks",
    );

    const completedBelowMinimum = deepClone(stateAfterBootstrap(10));
    completedBelowMinimum.revision = 0;
    expect(() => restoreProgression(completedBelowMinimum)).toThrow(
      "minimum reachable mutation count",
    );

    const selectedBelowMinimum = deepClone(
      selectOrThrow(stateAfterBootstrap(10), "throughput"),
    );
    selectedBelowMinimum.revision = 1;
    expect(() => restoreProgression(selectedBelowMinimum)).toThrow(
      "minimum reachable mutation count",
    );

    const frontierBelowMinimum = deepClone(stateAtFrontier(40));
    frontierBelowMinimum.revision -= 1;
    expect(() => restoreProgression(frontierBelowMinimum)).toThrow(
      "minimum reachable mutation count",
    );
  });

  it("rejects malformed progression state domains", () => {
    const base = (): ReturnType<typeof deepClone<ProgressionState>> =>
      deepClone(createCampaignProgression());
    const malformed: unknown[] = [];

    const wrongFormat = base();
    (wrongFormat as { format: string }).format = "other";
    malformed.push(wrongFormat);
    const wrongVersion = base();
    (wrongVersion as { version: number }).version = 2;
    malformed.push(wrongVersion);
    const wrongMode = base();
    (wrongMode as { mode: string }).mode = "creative";
    malformed.push(wrongMode);
    const negativeZero = base();
    negativeZero.alloy = -0;
    malformed.push(negativeZero);
    const nanAlloy = base();
    nanAlloy.alloy = Number.NaN;
    malformed.push(nanAlloy);
    const extra = base() as ProgressionState & { surprise?: boolean };
    extra.surprise = true;
    malformed.push(extra);
    const missing = base() as unknown as Record<string, unknown>;
    delete missing.revision;
    malformed.push(missing);
    const unknownSelected = base();
    (unknownSelected as { selectedCommissionId: string }).selectedCommissionId =
      "unknown";
    malformed.push(unknownSelected);
    const unavailableSelected = base();
    unavailableSelected.selectedCommissionId = "control";
    malformed.push(unavailableSelected);
    const reversedBuilds = base();
    reversedBuilds.unlockedBuildKinds.reverse();
    malformed.push(reversedBuilds);
    const missingRecipe = base();
    missingRecipe.unlockedRecipeIds.pop();
    malformed.push(missingRecipe);
    const swappedRecords = base();
    [
      swappedRecords.commissions[0],
      swappedRecords.commissions[1],
    ] = [
      swappedRecords.commissions[1]!,
      swappedRecords.commissions[0]!,
    ];
    malformed.push(swappedRecords);
    const nonrepeatTwice = base();
    nonrepeatTwice.commissions[0]!.completionCount = 2;
    nonrepeatTwice.commissions[0]!.firstCompletedTick = 1;
    nonrepeatTwice.commissions[0]!.lastCompletedTick = 2;
    nonrepeatTwice.lastCompletionTick = 2;
    malformed.push(nonrepeatTwice);
    const tickWithoutCount = base();
    tickWithoutCount.commissions[0]!.firstCompletedTick = 1;
    tickWithoutCount.commissions[0]!.lastCompletedTick = 1;
    tickWithoutCount.lastCompletionTick = 1;
    malformed.push(tickWithoutCount);
    const countWithoutTick = base();
    countWithoutTick.commissions[0]!.completionCount = 1;
    malformed.push(countWithoutTick);
    const noncanonicalLastTick = base();
    noncanonicalLastTick.lastCompletionTick = 1;
    malformed.push(noncanonicalLastTick);
    const prerequisiteViolation = base();
    prerequisiteViolation.commissions[1]!.completionCount = 1;
    prerequisiteViolation.commissions[1]!.firstCompletedTick = 1;
    prerequisiteViolation.commissions[1]!.lastCompletedTick = 1;
    prerequisiteViolation.lastCompletionTick = 1;
    malformed.push(prerequisiteViolation);
    const extraArrayField = base();
    Object.defineProperty(extraArrayField.unlockedBuildKinds, "extra", {
      value: true,
      enumerable: true,
    });
    malformed.push(extraArrayField);
    const symbolField = base() as unknown as Record<PropertyKey, unknown>;
    symbolField[Symbol("hidden")] = true;
    malformed.push(symbolField);
    const legacyProgress = deepClone(migrateLegacySandboxProgression(3_200));
    legacyProgress.commissions[0]!.completionCount = 1;
    legacyProgress.commissions[0]!.firstCompletedTick = 1;
    legacyProgress.commissions[0]!.lastCompletedTick = 1;
    legacyProgress.lastCompletionTick = 1;
    malformed.push(legacyProgress);

    for (const [index, snapshot] of malformed.entries()) {
      expect(
        () => restoreProgression(snapshot),
        `malformed progression case ${index}`,
      ).toThrow();
    }
  });

  it("rejects malformed inventories and provenance", () => {
    const baseInventory = (): ReturnType<
      typeof deepClone<ProgressionInventory>
    > => deepClone(createProgressionInventory({ ironPlate: 2 }));
    const malformedInventories: unknown[] = [];
    const wrongFormat = baseInventory();
    (wrongFormat as { format: string }).format = "other";
    malformedInventories.push(wrongFormat);
    const wrongVersion = baseInventory();
    (wrongVersion as { version: number }).version = 2;
    malformedInventories.push(wrongVersion);
    const zero = baseInventory();
    zero.entries[0]!.count = 0;
    malformedInventories.push(zero);
    const negative = baseInventory();
    negative.entries[0]!.count = -1;
    malformedInventories.push(negative);
    const negativeZero = baseInventory();
    negativeZero.entries[0]!.count = -0;
    malformedInventories.push(negativeZero);
    const duplicate = baseInventory();
    duplicate.entries.push({ item: "ironPlate", count: 1 });
    malformedInventories.push(duplicate);
    const reversed = deepClone(createProgressionInventory({
      ironOre: 1,
      automationCore: 1,
    }));
    reversed.entries.reverse();
    malformedInventories.push(reversed);
    const unknown = baseInventory();
    (unknown.entries[0] as { item: string }).item = "uranium";
    malformedInventories.push(unknown);
    const extra = baseInventory() as ProgressionInventory & {
      surprise?: boolean;
    };
    extra.surprise = true;
    malformedInventories.push(extra);
    for (const [index, snapshot] of malformedInventories.entries()) {
      expect(
        () => restoreProgressionInventory(snapshot),
        `malformed inventory case ${index}`,
      ).toThrow();
    }

    const paid = purchasePlacement(
      migrateLegacySandboxProgression(100),
      "belt",
    );
    expect(paid.ok).toBe(true);
    if (!paid.ok) throw new Error("Expected paid provenance.");
    const badPaidCost = deepClone(paid.provenance);
    badPaidCost.paidCost = 99;
    expect(() => restoreConstructionProvenance(badPaidCost)).toThrow();
    const badGranted = deepClone(grantedConstructionProvenance("belt"));
    badGranted.paidCost = 1;
    expect(() => restoreConstructionProvenance(badGranted)).toThrow();

    expect(() =>
      createProgressionInventory({ ironPlate: -0 })
    ).toThrow();
    expect(() =>
      createProgressionInventory({
        ironPlate: Number.MAX_SAFE_INTEGER + 1,
      })
    ).toThrow();
    expect(() => parseProgression("{broken")).toThrow();
    expect(() => parseProgressionInventory("{broken")).toThrow();
  });
});

describe("construction authorization and provenance", () => {
  it("uses one input-independent lock decision for hotkeys and pointer placement", () => {
    const state = createCampaignProgression();
    const hotkey = preflightPlacement(state, "fabricator");
    const pointer = preflightPlacement(state, "fabricator");
    expect(JSON.stringify(hotkey)).toBe(JSON.stringify(pointer));
    expect(hotkey).toMatchObject({
      ok: false,
      reason: "locked",
      buildKind: "fabricator",
      cost: 50,
    });
    expect(stateBytes(state)).toBe(
      stateBytes(createCampaignProgression()),
    );
  });

  it("binds placement authorization once and emits paid provenance", () => {
    const state = createCampaignProgression();
    const stateBefore = stateBytes(state);
    const preflight = preflightPlacement(state, "belt");
    expect(preflight.ok).toBe(true);
    if (!preflight.ok) throw new Error("Expected placement authorization.");
    expectDeepFrozen(preflight.authorization);

    expect(() =>
      commitPlacement(state, { ...preflight.authorization })
    ).toThrow("not issued");
    const equalButDetached = restoreProgression(deepClone(state));
    expect(() =>
      commitPlacement(equalButDetached, preflight.authorization)
    ).toThrow("stale");
    expect(stateBytes(state)).toBe(stateBefore);

    const purchase = commitPlacement(state, preflight.authorization);
    expect(purchase.cost).toBe(2);
    expect(purchase.state.alloy).toBe(238);
    expect(purchase.provenance).toEqual({
      format: "cinderline-construction-provenance",
      version: 1,
      source: "paid",
      buildKind: "belt",
      paidCost: 2,
    });
    expect(constructionRefundAmount(purchase.provenance)).toBe(2);
    expect(() =>
      commitPlacement(state, preflight.authorization)
    ).toThrow("not issued");
    expect(stateBytes(state)).toBe(stateBefore);
  });

  it("fully recovers paid construction, never refunds granted units, and stays bounded", () => {
    expect(CONSTRUCTION_REFUND_PERCENT).toBe(100);
    for (const kind of PROGRESSION_BUILD_KINDS) {
      const sandbox = migrateLegacySandboxProgression(10_000);
      const purchase = purchasePlacement(sandbox, kind);
      expect(purchase.ok).toBe(true);
      if (!purchase.ok) throw new Error(`Could not buy ${kind}.`);
      const expected = PROGRESSION_BUILD_COSTS[kind];
      const refund = constructionRefundAmount(purchase.provenance);
      expect(refund).toBe(expected);
      expect(refund).toBeLessThanOrEqual(purchase.provenance.paidCost);
      expect(
        constructionRefundAmount(grantedConstructionProvenance(kind)),
      ).toBe(0);
      const restored = restoreConstructionProvenance(
        deepClone(purchase.provenance),
      );
      expect(constructionRefundAmount(restored)).toBe(refund);
      expectDeepFrozen(restored);
      expectNoNegativeZero(restored);
    }
  });

  it("consumes provenance once and credits dismantle refunds atomically", () => {
    const initial = createCampaignProgression();
    const purchase = purchasePlacement(initial, "belt");
    expect(purchase.ok).toBe(true);
    if (!purchase.ok) throw new Error("Expected belt purchase.");

    const sibling = preflightPlacement(purchase.state, "belt");
    expect(sibling.ok).toBe(true);
    if (!sibling.ok) throw new Error("Expected sibling placement preflight.");
    const refunded = refundConstruction(
      purchase.state,
      purchase.provenance,
    );
    expect(refunded).toMatchObject({
      ok: true,
      refund: 2,
      state: { alloy: 240, revision: 2 },
    });
    if (!refunded.ok) throw new Error("Expected construction refund.");
    expect(() =>
      commitPlacement(purchase.state, sibling.authorization)
    ).toThrow("not issued");
    expect(
      refundConstruction(refunded.state, purchase.provenance),
    ).toMatchObject({
      ok: false,
      reason: "provenanceConsumed",
    });

    const granted = grantedConstructionProvenance("gridRelay");
    const grantedRefund = refundConstruction(refunded.state, granted);
    expect(grantedRefund).toMatchObject({
      ok: true,
      refund: 0,
      state: { alloy: 240, revision: 3 },
    });
    expect(() =>
      refundConstruction(
        refunded.state,
        { ...granted } as never,
      )
    ).toThrow("created or restored");
  });

  it("rejects locked, insufficient, revision-overflow, and unknown placement atomically", () => {
    const locked = createCampaignProgression();
    const lockedBefore = stateBytes(locked);
    expect(preflightPlacement(locked, "beacon")).toMatchObject({
      ok: false,
      reason: "locked",
    });
    expect(stateBytes(locked)).toBe(lockedBefore);

    const poor = createCampaignProgression(1);
    const poorBefore = stateBytes(poor);
    expect(purchasePlacement(poor, "belt")).toMatchObject({
      ok: false,
      reason: "insufficientAlloy",
    });
    expect(stateBytes(poor)).toBe(poorBefore);

    const overflowSnapshot = deepClone(createCampaignProgression());
    overflowSnapshot.revision = Number.MAX_SAFE_INTEGER;
    const overflow = restoreProgression(overflowSnapshot);
    const overflowBefore = stateBytes(overflow);
    expect(preflightPlacement(overflow, "belt")).toMatchObject({
      ok: false,
      reason: "revisionOverflow",
    });
    expect(stateBytes(overflow)).toBe(overflowBefore);

    expect(() =>
      preflightPlacement(locked, "teleporter" as never)
    ).toThrow("Unknown");
    expect(stateBytes(locked)).toBe(lockedBefore);
  });
});

describe("selection, overflow, and no-negative-zero invariants", () => {
  it("rejects unavailable, legacy, revision-overflow, and unknown selections atomically", () => {
    const initial = createCampaignProgression();
    const initialBefore = stateBytes(initial);
    expect(selectCommission(initial, "control")).toMatchObject({
      ok: false,
      reason: "unavailable",
    });
    expect(stateBytes(initial)).toBe(initialBefore);

    const legacy = migrateLegacySandboxProgression(3_200);
    const legacyBefore = stateBytes(legacy);
    expect(selectCommission(legacy, "bootstrap")).toMatchObject({
      ok: false,
      reason: "legacySandbox",
    });
    expect(stateBytes(legacy)).toBe(legacyBefore);

    const overflowSnapshot = deepClone(initial);
    overflowSnapshot.revision = Number.MAX_SAFE_INTEGER;
    overflowSnapshot.selectedCommissionId = null;
    const overflow = restoreProgression(overflowSnapshot);
    expect(selectCommission(overflow, "bootstrap")).toMatchObject({
      ok: false,
      reason: "revisionOverflow",
    });
    expect(() =>
      selectCommission(initial, "unknown" as never)
    ).toThrow("Unknown");
    expect(stateBytes(initial)).toBe(initialBefore);
  });

  it("rejects inventory and alloy overflow without mutation", () => {
    const full = createProgressionInventory({
      ironPlate: Number.MAX_SAFE_INTEGER,
    });
    const before = inventoryBytes(full);
    expect(() =>
      addProgressionInventory(full, "ironPlate", 1)
    ).toThrow("safe integer range");
    expect(inventoryBytes(full)).toBe(before);
    expect(() =>
      addProgressionInventory(full, "ironPlate", -0)
    ).toThrow("canonical safe integer");
    expect(inventoryBytes(full)).toBe(before);
  });

  it("never emits negative zero across campaign, legacy, completion, inventory, and refunds", () => {
    const initial = createCampaignProgression(0);
    expectNoNegativeZero(initial);
    const legacy = migrateLegacySandboxProgression(0);
    expectNoNegativeZero(legacy);
    const completion = completeSelectedCommission(
      initial,
      inventoryFor("bootstrap"),
      0,
    );
    expect(completion.ok).toBe(true);
    expectNoNegativeZero(completion);
    expectNoNegativeZero(createProgressionInventory());
    expect(
      Object.is(
        constructionRefundAmount(
          grantedConstructionProvenance("belt"),
        ),
        -0,
      ),
    ).toBe(false);
  });
});

describe("prepared event-driven path and scale proof", () => {
  it("uses a reusable allocation-free readiness probe and rejects stale/forged probes", () => {
    const state = createCampaignProgression();
    const probe = prepareSelectedCommissionProbe(state);
    const short = createProgressionInventory({
      ironPlate: 23,
      copperPlate: 12,
      stoneBrick: 12,
    });
    expect(isPreparedCommissionReady(probe, state, short, 10)).toBe(false);
    const ready = addProgressionInventory(short, "ironPlate", 1);
    expect(isPreparedCommissionReady(probe, state, ready, 10)).toBe(true);
    expectDeepFrozen(probe);
    expect(() =>
      isPreparedCommissionReady(
        { ...probe },
        state,
        ready,
        10,
      )
    ).toThrow("not issued");

    const completion = completeSelectedCommission(state, ready, 10);
    expect(completion.ok).toBe(true);
    if (!completion.ok) throw new Error("Expected completion.");
    expect(() =>
      isPreparedCommissionReady(
        probe,
        completion.state,
        completion.inventory,
        10,
      )
    ).toThrow("stale");
  });

  it("holds the <0.10ms p95 prepared gate for three 5,000-entity-context rounds", () => {
    const state = createCampaignProgression();
    const inventory = inventoryFor("bootstrap");
    const probe = prepareSelectedCommissionProbe(state);
    const rounds = Array.from({ length: 3 }, () =>
      benchmarkPreparedCommissionProbe(
        probe,
        state,
        inventory,
        10,
        {
          warmupSamples: 1_000,
          samples: 5_000,
          nominalEntityCount: 5_000,
        },
      )
    );
    console.info(
      `[progression-prepared-benchmark] ${JSON.stringify(rounds)}`,
    );
    for (const metrics of rounds) {
      expect(metrics.ready).toBe(true);
      expect(metrics.commissionDefinitionCount).toBe(5);
      expect(metrics.maximumCommissionDefinitionCount).toBe(32);
      expect(metrics.nominalEntityCount).toBe(5_000);
      expect(metrics.p95Ms).toBeLessThan(0.10);
      expectDeepFrozen(metrics);
    }
  });
});
