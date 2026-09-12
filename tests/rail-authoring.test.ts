import { describe, expect, it } from "vitest";

import {
  RailNetwork,
  type RailNetworkSnapshot,
  type RailScheduleStop,
} from "../src/game/rail-network";
import {
  COMMISSION_DEFINITIONS,
  commitRailAlloy,
  completeSelectedCommission,
  createCampaignProgression,
  createProgressionInventory,
  isRailAuthoringUnlocked,
  migrateLegacySandboxProgression,
  preflightRailPurchase,
  preflightRailRefund,
  selectCommission,
  serializeProgression,
  type ProgressionState,
} from "../src/game/progression";
import {
  RAIL_BUILD_COSTS,
  authoredSegment,
  canonicalRailAuthoringState,
  canonicalRailItemFilter,
  createGrantedRailAuthoringState,
  nextRailId,
  paidRailAlloy,
  preflightDirectedSignal,
  preflightSchedule,
  preflightStationBinding,
  preflightStationPlacement,
  preflightTrackPlacement,
  preflightTrainPlacement,
  railDismantleBlockers,
  railEntry,
  railLedgerKey,
  recordRailConstructions,
  removeRailConstructions,
  restoreRailAuthoringState,
} from "../src/game/railAuthoring";
import {
  Direction,
  type RailStationStorageInterface,
} from "../src/game/types";

function fixture(): RailNetworkSnapshot {
  return new RailNetwork({
    segments: [
      {
        id: "player-segment-000004",
        x: 1,
        y: 2,
        kind: "straight",
        rotation: 1,
      },
      {
        id: "middle",
        x: 2,
        y: 2,
        kind: "straight",
        rotation: 1,
      },
      {
        id: "terminus",
        x: 3,
        y: 2,
        kind: "straight",
        rotation: 1,
      },
    ],
    signals: [
      {
        id: "player-signal-000002",
        fromSegmentId: "player-segment-000004",
        toSegmentId: "middle",
        type: "regular",
      },
    ],
    stations: [
      { id: "depot", segmentId: "terminus", capacity: 0 },
    ],
    trains: [
      {
        id: "player-train-000003",
        currentSegmentId: "player-segment-000004",
        cars: [
          {
            id: "player-car-000007",
            kind: "locomotive",
            fuelCapacityMilli: 20_000,
            fuelMilli: 0,
          },
          {
            id: "wagon-a",
            kind: "cargo-wagon",
            capacity: 20,
          },
        ],
        schedule: [
          {
            stationId: "depot",
            wait: { type: "time", ticks: 0 },
          },
        ],
      },
    ],
  }).snapshot();
}

function autonomyCompleteState(): ProgressionState {
  let state = createCampaignProgression();
  let tick = 1;
  for (const id of [
    "bootstrap",
    "throughput",
    "control",
    "autonomy",
  ] as const) {
    if (state.selectedCommissionId !== id) {
      const selected = selectCommission(state, id);
      if (!selected.ok) {
        throw new Error(`Unable to select ${id}: ${selected.reason}`);
      }
      state = selected.state;
    }
    const definition = COMMISSION_DEFINITIONS.find(
      (candidate) => candidate.id === id,
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
    if (!completed.ok) {
      throw new Error(`Unable to complete ${id}: ${completed.reason}`);
    }
    state = completed.state;
    tick += 1;
  }
  return state;
}

describe("rail authoring economy, IDs, and provenance", () => {
  it("publishes the exact frozen construction cost table", () => {
    expect(RAIL_BUILD_COSTS).toEqual({
      straight: 2,
      curve: 3,
      junction: 6,
      regularSignal: 4,
      chainSignal: 6,
      station: 24,
      locomotive: 60,
      cargoWagon: 24,
    });
    expect(Object.isFrozen(RAIL_BUILD_COSTS)).toBe(true);
  });

  it("canonicalizes null/no filter and rejects ambiguous empty filters", () => {
    expect(canonicalRailItemFilter(null)).toBeUndefined();
    expect(canonicalRailItemFilter(undefined)).toBeUndefined();
    expect(() => canonicalRailItemFilter([])).toThrow(/nonempty/);
    expect(
      canonicalRailItemFilter(["stone", "ironOre", "coal"]),
    ).toEqual(["ironOre", "coal", "stone"]);
    expect(() =>
      canonicalRailItemFilter(["coal", "coal"])
    ).toThrow(/unique/);
  });

  it("migrates every live rail identity as granted and advances cursors", () => {
    const snapshot = fixture();
    const state = createGrantedRailAuthoringState(snapshot);
    expect(state.entries).toHaveLength(
      snapshot.graph.nodes.length +
        snapshot.signals.length +
        snapshot.stations.length +
        snapshot.trains.length +
        snapshot.trains[0]!.cars.length,
    );
    expect(state.entries.every((entry) => entry.source === "granted")).toBe(
      true,
    );
    expect(paidRailAlloy(state)).toBe(0);
    expect(nextRailId(state, "segment")).toBe(
      "player-segment-000005",
    );
    expect(nextRailId(state, "signal")).toBe("player-signal-000003");
    expect(nextRailId(state, "train")).toBe("player-train-000004");
    expect(nextRailId(state, "car")).toBe("player-car-000008");
    expect(
      railEntry(
        state,
        "car",
        "player-car-000007",
        "player-train-000003",
      )?.buildKind,
    ).toBe("locomotive");
  });

  it("records paid construction, refunds fully, and never reuses IDs", () => {
    const original = createGrantedRailAuthoringState(fixture());
    const id = nextRailId(original, "segment");
    const paid = recordRailConstructions(original, [
      {
        targetKind: "segment",
        id,
        buildKind: "curve",
        source: "paid",
      },
    ]);
    expect(paidRailAlloy(paid)).toBe(3);
    expect(nextRailId(paid, "segment")).toBe(
      "player-segment-000006",
    );
    const removed = removeRailConstructions(paid, [
      railLedgerKey("segment", id),
    ]);
    expect(removed.refund).toBe(3);
    expect(paidRailAlloy(removed.state)).toBe(0);
    expect(nextRailId(removed.state, "segment")).toBe(
      "player-segment-000006",
    );
  });

  it("rejects missing, duplicate, forged, mismatched, and rewound ledger data", () => {
    const snapshot = fixture();
    const state = createGrantedRailAuthoringState(snapshot);
    type MutableState = {
      nextIds: {
        segment: number;
        signal: number;
        station: number;
        train: number;
        car: number;
      };
      entries: Array<{
        key: string;
        targetKind: string;
        id: string;
        trainId: string | null;
        buildKind: string;
        source: string;
        paidCost: number;
      }>;
    };
    const clone = () =>
      structuredClone(state) as unknown as MutableState;

    const missing = clone();
    missing.entries.pop();
    expect(() => restoreRailAuthoringState(missing, snapshot)).toThrow(
      /cover every live rail identity/,
    );

    const duplicate = clone();
    duplicate.entries[1] = structuredClone(duplicate.entries[0]!);
    expect(() => restoreRailAuthoringState(duplicate, snapshot)).toThrow(
      /unique and canonically ordered/,
    );

    const forged = clone();
    forged.entries[0]!.source = "paid";
    forged.entries[0]!.paidCost = 999;
    expect(() => restoreRailAuthoringState(forged, snapshot)).toThrow(
      /not canonical/,
    );

    const mismatch = clone();
    const segmentIndex = mismatch.entries.findIndex(
      (entry) => entry.targetKind === "segment",
    );
    mismatch.entries[segmentIndex]!.buildKind = "curve";
    mismatch.entries[segmentIndex]!.paidCost = 0;
    expect(() => restoreRailAuthoringState(mismatch, snapshot)).toThrow(
      /does not match/,
    );

    const rewound = clone();
    rewound.nextIds.segment = 4;
    expect(() => restoreRailAuthoringState(rewound, snapshot)).toThrow(
      /would reuse/,
    );
  });

  it("unlocks at Autonomy and commits alloy only through issued transactions", () => {
    const locked = createCampaignProgression();
    expect(isRailAuthoringUnlocked(locked)).toBe(false);
    expect(preflightRailPurchase(locked, ["straight"])).toMatchObject({
      ok: false,
      reason: "locked",
    });

    const state = autonomyCompleteState();
    expect(isRailAuthoringUnlocked(state)).toBe(true);
    const before = serializeProgression(state);
    const purchase = preflightRailPurchase(state, ["curve"]);
    expect(purchase.ok).toBe(true);
    expect(serializeProgression(state)).toBe(before);
    if (!purchase.ok) throw new Error("Expected rail purchase.");
    const purchased = commitRailAlloy(state, purchase.authorization);
    expect(purchased.amount).toBe(3);
    expect(purchased.state.alloy).toBe(state.alloy - 3);
    expect(() =>
      commitRailAlloy(state, purchase.authorization)
    ).toThrow(/not issued/);

    const refund = preflightRailRefund(purchased.state, ["curve"]);
    expect(refund.ok).toBe(true);
    if (!refund.ok) throw new Error("Expected rail refund.");
    const refunded = commitRailAlloy(
      purchased.state,
      refund.authorization,
    );
    expect(refunded.amount).toBe(3);
    expect(refunded.state.alloy).toBe(state.alloy);
  });

  it("makes the full rail suite available in legacy sandbox", () => {
    const sandbox = migrateLegacySandboxProgression(1_000);
    expect(isRailAuthoringUnlocked(sandbox)).toBe(true);
    const transaction = preflightRailPurchase(sandbox, [
      "straight",
      "curve",
      "junction",
      "regularSignal",
      "chainSignal",
      "station",
      "locomotive",
      "cargoWagon",
    ]);
    expect(transaction.ok).toBe(true);
    if (!transaction.ok) throw new Error("Expected sandbox purchase.");
    expect(transaction.authorization.amount).toBe(129);
  });
});

describe("rail authoring preflights", () => {
  it("validates track tiles and explicit directed signal transitions", () => {
    const snapshot = fixture();
    expect(
      preflightTrackPlacement(
        snapshot,
        authoredSegment("new", "curve", 4, 2, 3),
      ),
    ).toEqual({ ok: true });
    expect(
      preflightTrackPlacement(
        snapshot,
        authoredSegment("new", "straight", 2, 2, 1),
      ),
    ).toMatchObject({ ok: false });

    expect(
      preflightDirectedSignal(
        snapshot,
        "middle",
        "terminus",
        "chain",
      ),
    ).toEqual({ ok: true });
    expect(
      preflightDirectedSignal(
        snapshot,
        "terminus",
        "player-segment-000004",
        "regular",
      ),
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining("adjacent"),
    });
    expect(
      preflightDirectedSignal(
        snapshot,
        "player-segment-000004",
        "middle",
        "regular",
      ),
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining("already"),
    });
  });

  it("reports a truthful disabled reason for worlds without rail bootstrap", () => {
    expect(
      preflightTrackPlacement(
        null,
        authoredSegment("first", "straight", 1, 1, 0),
      ),
    ).toEqual({
      ok: false,
      reason: "This world has no configured rail network.",
    });
    expect(createGrantedRailAuthoringState(null).entries).toEqual([]);
    expect(
      restoreRailAuthoringState(
        createGrantedRailAuthoringState(null),
        null,
      ).entries,
    ).toEqual([]);
  });

  it("validates station/storage uniqueness and occupied train blocks", () => {
    const snapshot = fixture();
    expect(
      preflightStationPlacement(snapshot, "middle"),
    ).toEqual({ ok: true });
    expect(
      preflightStationPlacement(snapshot, "terminus"),
    ).toMatchObject({ ok: false });
    expect(
      preflightTrainPlacement(snapshot, "middle"),
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining("occupied"),
    });

    const interfaces: RailStationStorageInterface[] = [
      {
        stationId: "other",
        storageEntityId: 7,
        mode: "load",
        transferRate: 1,
      },
    ];
    expect(
      preflightStationBinding(
        snapshot,
        "depot",
        8,
        "both",
        3,
        ["ironOre"],
        [
          {
            id: 8,
            kind: "storage",
            x: 3,
            y: 3,
            direction: Direction.North,
          },
        ],
        interfaces,
      ),
    ).toEqual({ ok: true });
    expect(
      preflightStationBinding(
        snapshot,
        "depot",
        7,
        "both",
        3,
        ["ironOre"],
        [
          {
            id: 7,
            kind: "storage",
            x: 3,
            y: 3,
            direction: Direction.North,
          },
        ],
        interfaces,
      ),
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining("already bound"),
    });

    for (const direction of [
      Direction.North,
      Direction.East,
      Direction.South,
      Direction.West,
    ]) {
      expect(
        preflightStationBinding(
          snapshot,
          "depot",
          10,
          "load",
          1,
          undefined,
          [
            {
              id: 10,
              kind: "storage",
              x: 2,
              y: 3,
              direction,
            },
          ],
          [],
        ),
      ).toEqual({ ok: true });
    }
    expect(
      preflightStationBinding(
        snapshot,
        "depot",
        11,
        "load",
        1,
        undefined,
        [
          {
            id: 11,
            kind: "storage",
            x: 4,
            y: 3,
            direction: Direction.North,
          },
        ],
        [],
      ),
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining("exactly one"),
    });
    expect(
      preflightStationBinding(
        snapshot,
        "depot",
        12,
        "load",
        1,
        undefined,
        [
          {
            id: 12,
            kind: "storage",
            x: 2,
            y: 2,
            direction: Direction.North,
          },
        ],
        [],
      ),
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining("exactly one"),
    });
  });

  it("accepts every schedule wait condition and rejects empty schedules", () => {
    const snapshot = fixture();
    const waits: RailScheduleStop[] = [
      {
        stationId: "depot",
        wait: { type: "time", ticks: 90 },
      },
      { stationId: "depot", wait: { type: "cargo-empty" } },
      { stationId: "depot", wait: { type: "cargo-full" } },
      {
        stationId: "depot",
        wait: {
          type: "item-at-least",
          itemId: "ironOre",
          count: 12,
        },
      },
      {
        stationId: "depot",
        wait: {
          type: "item-at-most",
          itemId: "coal",
          count: 4,
        },
      },
    ];
    expect(preflightSchedule(snapshot, waits)).toEqual({ ok: true });
    expect(preflightSchedule(snapshot, [])).toMatchObject({
      ok: false,
      reason: expect.stringContaining("require"),
    });
  });

  it("explains dependency blockers without silently cascading", () => {
    const snapshot = fixture();
    expect(
      railDismantleBlockers(
        snapshot,
        "segment",
        "player-segment-000004",
      ),
    ).toEqual([
      "signal player-signal-000002",
      "train player-train-000003",
    ]);
    expect(
      railDismantleBlockers(
        snapshot,
        "station",
        "depot",
        [
          {
            stationId: "depot",
            storageEntityId: 9,
            mode: "both",
            transferRate: 2,
          },
        ],
      ),
    ).toEqual([
      "schedule on train player-train-000003",
      "storage binding 9",
    ]);
  });

  it("canonicalizes a staged ledger before mutation but rejects a mismatched post-snapshot", () => {
    const before = createGrantedRailAuthoringState(fixture());
    const staged = recordRailConstructions(before, [{
      targetKind: "segment",
      id: nextRailId(before, "segment"),
      buildKind: "straight",
      source: "paid",
    }]);
    expect(canonicalRailAuthoringState(staged)).toEqual(staged);
    expect(() =>
      restoreRailAuthoringState(staged, fixture())
    ).toThrow(/cover every live rail identity/);
    expect(restoreRailAuthoringState(before, fixture())).toEqual(before);
  });

  it("reports moving trains as dismantle-blocked even when empty and unfueled", () => {
    const network = new RailNetwork({
      segments: [
        { id: "a", x: 0, y: 0, kind: "straight", rotation: 1 },
        { id: "b", x: 1, y: 0, kind: "straight", rotation: 1 },
        { id: "c", x: 2, y: 0, kind: "straight", rotation: 1 },
      ],
      stations: [
        { id: "west", segmentId: "a", capacity: 0 },
        { id: "east", segmentId: "c", capacity: 0 },
      ],
      trains: [{
        id: "runner",
        currentSegmentId: "a",
        cars: [{
          id: "loco",
          kind: "locomotive",
          fuelCapacityMilli: 20_000,
          fuelMilli: 20_000,
        }],
        schedule: [
          { stationId: "west", wait: { type: "time", ticks: 0 } },
          { stationId: "east", wait: { type: "time", ticks: 0 } },
        ],
      }],
    });
    for (let index = 0; index < 20; index += 1) {
      network.step();
      if (network.snapshot().trains[0]?.status === "moving") break;
    }
    const moving = network.snapshot();
    expect(moving.trains[0]?.status).toBe("moving");
    expect(
      railDismantleBlockers(moving, "train", "runner"),
    ).toContain("train runner is moving");
  });

  it("blocks removal of an empty car while another wagon holds cargo", () => {
    const snapshot = new RailNetwork({
      segments: [
        { id: "yard", x: 0, y: 0, kind: "straight", rotation: 1 },
      ],
      stations: [{ id: "depot", segmentId: "yard", capacity: 0 }],
      trains: [{
        id: "loaded",
        currentSegmentId: "yard",
        cars: [
          {
            id: "loco",
            kind: "locomotive",
            fuelCapacityMilli: 20_000,
            fuelMilli: 0,
          },
          {
            id: "loaded-wagon",
            kind: "cargo-wagon",
            capacity: 10,
            cargo: [{ itemId: "ironOre", count: 3 }],
          },
          {
            id: "empty-wagon",
            kind: "cargo-wagon",
            capacity: 10,
          },
        ],
        schedule: [
          { stationId: "depot", wait: { type: "time", ticks: 10 } },
        ],
      }],
    }).snapshot();
    expect(
      railDismantleBlockers(
        snapshot,
        "car",
        "empty-wagon",
        [],
        "loaded",
      ),
    ).toContain("3 cargo units on train loaded");
  });
});
