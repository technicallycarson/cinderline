import { describe, expect, it } from "vitest";

import {
  RAIL_DISTANCE_SCALE,
  RAIL_LIMITS,
  RailNetwork,
  canonicalRailBytes,
  createRailGraph,
  findRailPath,
  isCanonicalRailSave,
  railSegmentPorts,
  restoreRailNetwork,
  type RailEvent,
  type RailNetworkHooks,
  type RailNetworkInput,
  type RailSegmentInput,
  type RailSignalInput,
  type RailStationInput,
  type RailTrainInput,
} from "../src/game/rail-network";

function horizontalLine(
  length: number,
  prefix = "rail",
  y = 0,
): RailSegmentInput[] {
  return Array.from({ length }, (_, x) => ({
    id: `${prefix}-${x}`,
    x,
    y,
    kind: "straight" as const,
    rotation: 1 as const,
  }));
}

function locomotive(
  fuelMilli = 10_000,
  id = "loco",
): RailTrainInput["cars"][number] {
  return {
    id,
    kind: "locomotive",
    fuelCapacityMilli: 100_000,
    fuelMilli,
  };
}

function cargoWagon(
  capacity = 20,
  id = "wagon",
): RailTrainInput["cars"][number] {
  return {
    id,
    kind: "cargo-wagon",
    capacity,
  };
}

function timeStop(stationId: string, ticks = 0) {
  return {
    stationId,
    wait: { type: "time" as const, ticks },
  };
}

function station(
  id: string,
  segmentId: string,
  capacity = 100,
  inventory: RailStationInput["inventory"] = [],
): RailStationInput {
  return { id, segmentId, capacity, inventory };
}

function singleTrainLine(
  length = 5,
  fuelMilli = 10_000,
): RailNetworkInput {
  const segments = horizontalLine(length);
  return {
    segments,
    stations: [
      station("origin", segments[0]!.id),
      station("destination", segments.at(-1)!.id),
    ],
    trains: [
      {
        id: "train",
        currentSegmentId: segments[0]!.id,
        cars: [locomotive(fuelMilli)],
        schedule: [timeStop("destination")],
      },
    ],
  };
}

function trainById(network: RailNetwork, id = "train") {
  return network.snapshot().trains.find((train) => train.id === id)!;
}

function totalItemUnits(network: RailNetwork, itemId: string): number {
  const snapshot = network.snapshot();
  const stationUnits = snapshot.stations.reduce(
    (sum, current) =>
      sum +
      (current.inventory.find((stack) => stack.itemId === itemId)?.count ??
        0),
    0,
  );
  const trainUnits = snapshot.trains.reduce(
    (sum, train) =>
      sum +
      (train.cargo.find((stack) => stack.itemId === itemId)?.count ?? 0),
    0,
  );
  return stationUnits + trainUnits;
}

function opposingNetwork(
  segmentOrder: "forward" | "reverse" = "forward",
  trainOrder: "forward" | "reverse" = "forward",
  terminalDwellTicks = 100,
): RailNetwork {
  const line = horizontalLine(7, "op");
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
      type: "regular",
    },
    {
      id: "right-out",
      fromSegmentId: "op-4",
      toSegmentId: "op-5",
      type: "regular",
    },
  ];
  const trains: RailTrainInput[] = [
    {
      id: "alpha",
      currentSegmentId: "op-0",
      cars: [locomotive(100_000, "alpha-loco")],
      schedule: [
        timeStop("left", terminalDwellTicks),
        timeStop("alpha-turn", 0),
      ],
    },
    {
      id: "beta",
      currentSegmentId: "op-6",
      cars: [locomotive(100_000, "beta-loco")],
      schedule: [
        timeStop("right", terminalDwellTicks),
        timeStop("beta-turn", 0),
      ],
    },
  ];
  return new RailNetwork({
    segments:
      segmentOrder === "forward" ? line : [...line].reverse(),
    signals: [...signals].reverse(),
    stations: [
      station("right", "op-6"),
      station("beta-turn", "op-2"),
      station("left", "op-0"),
      station("alpha-turn", "op-4"),
    ],
    trains: trainOrder === "forward" ? trains : [...trains].reverse(),
  });
}

describe("deterministic rail topology", () => {
  it("rotates straight, curve, and junction ports and builds reciprocal directed edges", () => {
    expect(
      railSegmentPorts({ kind: "straight", rotation: 0 }),
    ).toEqual(["north", "south"]);
    expect(
      railSegmentPorts({ kind: "straight", rotation: 1 }),
    ).toEqual(["east", "west"]);
    expect(railSegmentPorts({ kind: "curve", rotation: 1 })).toEqual([
      "east",
      "south",
    ]);
    expect(
      railSegmentPorts({ kind: "junction", rotation: 2 }),
    ).toEqual(["east", "south", "west"]);

    const graph = createRailGraph([
      {
        id: "corner",
        x: 0,
        y: 0,
        kind: "curve",
        rotation: 1,
      },
      {
        id: "east",
        x: 1,
        y: 0,
        kind: "straight",
        rotation: 1,
      },
      {
        id: "south",
        x: 0,
        y: 1,
        kind: "straight",
        rotation: 0,
      },
      {
        id: "junction",
        x: 2,
        y: 0,
        kind: "junction",
        rotation: 0,
      },
    ]);
    expect(findRailPath(graph, "south", "junction")).toEqual([
      "south",
      "corner",
      "east",
      "junction",
    ]);
    for (const edge of graph.edges) {
      expect(
        graph.edges.some(
          (reverse) =>
            reverse.fromSegmentId === edge.toSegmentId &&
            reverse.toSegmentId === edge.fromSegmentId,
        ),
      ).toBe(true);
    }
  });

  it("breaks geometrically equal shortest paths by canonical segment sequence", () => {
    const segments: RailSegmentInput[] = [
      {
        id: "start",
        x: 0,
        y: 1,
        kind: "straight",
        rotation: 1,
      },
      {
        id: "split",
        x: 1,
        y: 1,
        kind: "junction",
        rotation: 3,
      },
      {
        id: "aaa-top-left",
        x: 1,
        y: 0,
        kind: "curve",
        rotation: 1,
      },
      {
        id: "aaa-top",
        x: 2,
        y: 0,
        kind: "straight",
        rotation: 1,
      },
      {
        id: "aaa-top-right",
        x: 3,
        y: 0,
        kind: "curve",
        rotation: 2,
      },
      {
        id: "zzz-bottom-left",
        x: 1,
        y: 2,
        kind: "curve",
        rotation: 0,
      },
      {
        id: "zzz-bottom",
        x: 2,
        y: 2,
        kind: "straight",
        rotation: 1,
      },
      {
        id: "zzz-bottom-right",
        x: 3,
        y: 2,
        kind: "curve",
        rotation: 3,
      },
      {
        id: "merge",
        x: 3,
        y: 1,
        kind: "junction",
        rotation: 1,
      },
      {
        id: "finish",
        x: 4,
        y: 1,
        kind: "straight",
        rotation: 1,
      },
    ];
    const path = findRailPath(
      createRailGraph([...segments].reverse()),
      "start",
      "finish",
    );
    expect(path).toEqual([
      "start",
      "split",
      "aaa-top-left",
      "aaa-top",
      "aaa-top-right",
      "merge",
      "finish",
    ]);
  });

  it("chooses the shortest route canonically, repaths after edits, and recovers from no-path", () => {
    const segments: RailSegmentInput[] = [
      {
        id: "start",
        x: 0,
        y: 1,
        kind: "straight",
        rotation: 1,
      },
      {
        id: "left-junction",
        x: 1,
        y: 1,
        kind: "junction",
        rotation: 0,
      },
      {
        id: "direct",
        x: 2,
        y: 1,
        kind: "straight",
        rotation: 1,
      },
      {
        id: "right-junction",
        x: 3,
        y: 1,
        kind: "junction",
        rotation: 0,
      },
      {
        id: "finish",
        x: 4,
        y: 1,
        kind: "straight",
        rotation: 1,
      },
      {
        id: "upper-left",
        x: 1,
        y: 0,
        kind: "curve",
        rotation: 1,
      },
      {
        id: "upper",
        x: 2,
        y: 0,
        kind: "straight",
        rotation: 1,
      },
      {
        id: "upper-right",
        x: 3,
        y: 0,
        kind: "curve",
        rotation: 2,
      },
    ];
    const observedEvents: RailEvent[] = [];
    const network = new RailNetwork(
      {
        segments: [...segments].reverse(),
        stations: [
          station("finish-station", "finish"),
          station("start-station", "start"),
        ],
        trains: [
          {
            id: "train",
            currentSegmentId: "start",
            cars: [locomotive()],
            schedule: [timeStop("finish-station")],
          },
        ],
      },
      { onEvent: (event) => observedEvents.push(event) },
    );

    expect(trainById(network).path).toEqual([
      "start",
      "left-junction",
      "direct",
      "right-junction",
      "finish",
    ]);

    network.replaceSegments(
      segments.filter((segment) => segment.id !== "direct"),
    );
    expect(trainById(network).path).toEqual([
      "start",
      "left-junction",
      "upper-left",
      "upper",
      "upper-right",
      "right-junction",
      "finish",
    ]);

    network.replaceSegments(
      segments.filter(
        (segment) =>
          segment.id !== "direct" && segment.id !== "upper",
      ),
    );
    expect(trainById(network).status).toBe("no-path");
    expect(observedEvents.some((event) => event.type === "path-lost")).toBe(
      true,
    );

    network.replaceSegments(segments);
    expect(trainById(network).status).toBe("moving");
    expect(trainById(network).path).toContain("direct");
    expect(
      observedEvents.some((event) => event.type === "path-restored"),
    ).toBe(true);
  });
});

describe("stations, consists, cargo, and fixed-point movement", () => {
  it("honors exact station dwell ticks before departing", () => {
    const input = singleTrainLine(3);
    const network = new RailNetwork({
      ...input,
      trains: [
        {
          ...input.trains![0]!,
          schedule: [timeStop("origin", 3), timeStop("destination", 0)],
        },
      ],
    });
    expect(network.step(2).events).toHaveLength(0);
    expect(trainById(network).status).toBe("dwelling");
    expect(trainById(network).dwellTicks).toBe(2);

    const result = network.step(1);
    expect(result.events).toContainEqual({
      type: "train-departed",
      tick: 3,
      trainId: "train",
      stationId: "origin",
    });
    expect(trainById(network).status).toBe("moving");
  });

  it("clamps transfer hooks to wagon/station capacity and conserves cargo", () => {
    const segments = horizontalLine(2, "cargo");
    const hooks: RailNetworkHooks = {
      transferAtStation: () => [
        { wagonId: "wagon", itemId: "ore", amount: 7 },
        { wagonId: "wagon", itemId: "ore", amount: 8 },
      ],
    };
    const network = new RailNetwork(
      {
        segments,
        stations: [
          station("mine", "cargo-0", 20, [
            { itemId: "ore", count: 10 },
          ]),
          station("sink", "cargo-1"),
        ],
        trains: [
          {
            id: "train",
            currentSegmentId: "cargo-0",
            cars: [locomotive(), cargoWagon(5)],
            schedule: [
              {
                stationId: "mine",
                wait: { type: "cargo-full" },
              },
              timeStop("sink"),
            ],
          },
        ],
      },
      hooks,
    );
    const result = network.step(1);
    expect(
      result.events.find((event) => event.type === "cargo-transferred"),
    ).toMatchObject({ amount: 5, itemId: "ore" });
    expect(trainById(network).cargo).toEqual([
      { itemId: "ore", count: 5 },
    ]);
    expect(
      network.snapshot().stations.find((current) => current.id === "mine")
        ?.inventory,
    ).toEqual([{ itemId: "ore", count: 5 }]);
    expect(totalItemUnits(network, "ore")).toBe(10);
  });

  it("gates acceleration on locomotive fuel and resumes after deterministic refuelling", () => {
    const network = new RailNetwork(singleTrainLine(4, 0));
    network.step(20);
    expect(trainById(network)).toMatchObject({
      currentSegmentId: "rail-0",
      progressMilli: 0,
      speedMilliPerTick: 0,
      status: "out-of-fuel",
      distanceTravelledMilli: 0,
    });

    expect(network.addFuel("train", "loco", 200)).toBe(200);
    network.step(20);
    expect(trainById(network).distanceTravelledMilli).toBeGreaterThan(
      RAIL_DISTANCE_SCALE,
    );
    expect(trainById(network).currentSegmentId).not.toBe("rail-0");
  });
});

describe("signals, reservations, and collision prevention", () => {
  it("holds a chain signal red when its regular-signal exit block is occupied", () => {
    const segments = horizontalLine(5, "chain");
    const signals: RailSignalInput[] = [
      {
        id: "chain-entry",
        fromSegmentId: "chain-1",
        toSegmentId: "chain-2",
        type: "chain",
      },
      {
        id: "regular-exit",
        fromSegmentId: "chain-3",
        toSegmentId: "chain-4",
        type: "regular",
      },
    ];
    const stations = [
      station("west", "chain-0"),
      station("east", "chain-4"),
    ];
    const occupied = new RailNetwork({
      segments,
      signals,
      stations,
      trains: [
        {
          id: "blocker",
          currentSegmentId: "chain-4",
          cars: [locomotive()],
          schedule: [timeStop("east", 1_000)],
        },
      ],
    });
    expect(occupied.signalAspect("regular-exit")).toBe("red");
    expect(occupied.signalAspect("chain-entry")).toBe("red");

    const clear = new RailNetwork({ segments, signals, stations });
    expect(clear.signalAspect("regular-exit")).toBe("green");
    expect(clear.signalAspect("chain-entry")).toBe("chain-clear");
  });

  it("brakes before an occupied regular-signal block and never enters it", () => {
    const segments = horizontalLine(4, "brake");
    const network = new RailNetwork({
      segments,
      signals: [
        {
          id: "guard",
          fromSegmentId: "brake-1",
          toSegmentId: "brake-2",
          type: "regular",
        },
      ],
      stations: [
        station("west", "brake-0"),
        station("east", "brake-3"),
      ],
      trains: [
        {
          id: "mover",
          currentSegmentId: "brake-0",
          cars: [locomotive(10_000, "mover-loco")],
          schedule: [timeStop("east")],
        },
        {
          id: "blocker",
          currentSegmentId: "brake-3",
          cars: [locomotive(10_000, "blocker-loco")],
          schedule: [timeStop("east", 10_000)],
        },
      ],
    });
    network.step(500);
    expect(trainById(network, "mover").currentBlockId).not.toBe(
      trainById(network, "blocker").currentBlockId,
    );
    expect(trainById(network, "mover").currentSegmentId).toBe("brake-1");
    expect(trainById(network, "mover").speedMilliPerTick).toBe(0);
    expect(trainById(network, "mover").status).toBe("waiting-signal");
    expect(trainById(network, "blocker").currentSegmentId).toBe("brake-3");
  });

  it("arbitrates opposing trains by stable ID and lets both clear the shared block without overlap", () => {
    const network = opposingNetwork();
    const result = network.step(1_500);
    const alphaArrivals = result.events.filter(
      (event) =>
        event.type === "train-arrived" &&
        event.trainId === "alpha" &&
        event.stationId === "alpha-turn",
    );
    const betaArrivals = result.events.filter(
      (event) =>
        event.type === "train-arrived" &&
        event.trainId === "beta" &&
        event.stationId === "beta-turn",
    );
    expect(alphaArrivals.length).toBeGreaterThan(0);
    expect(betaArrivals.length).toBeGreaterThan(0);

    const snapshot = network.snapshot();
    expect(
      new Set(snapshot.trains.map((train) => train.currentSegmentId)).size,
    ).toBe(snapshot.trains.length);
    expect(
      new Set(snapshot.trains.map((train) => train.currentBlockId)).size,
    ).toBe(snapshot.trains.length);
    for (const reservation of snapshot.reservations) {
      expect(
        snapshot.reservations.filter(
          (candidate) =>
            candidate.blockId === reservation.blockId &&
            candidate.trainId !== reservation.trainId,
        ),
      ).toHaveLength(0);
    }
  });

  it("uses canonical wait-age fairness to prevent stable-ID starvation", () => {
    const network = opposingNetwork("reverse", "reverse", 0);
    const events = network.step(2_000).events;
    for (const trainId of ["alpha", "beta"]) {
      expect(
        events.some(
          (event) =>
            event.type === "train-arrived" &&
            event.trainId === trainId &&
            event.stationId.endsWith("-turn"),
        ),
      ).toBe(true);
    }
  });

  it("remains overlap-free across a long adversarial opposing run", () => {
    const network = opposingNetwork();
    let maximumSpeed = 0;
    for (let tick = 0; tick < 5_000; tick += 1) {
      const snapshot = network.step().snapshot;
      const segmentIds = snapshot.trains.map(
        (train) => train.currentSegmentId,
      );
      const blockIds = snapshot.trains.map((train) => train.currentBlockId);
      expect(new Set(segmentIds).size).toBe(segmentIds.length);
      expect(new Set(blockIds).size).toBe(blockIds.length);
      maximumSpeed = Math.max(
        maximumSpeed,
        ...snapshot.trains.map((train) => train.speedMilliPerTick),
      );
    }
    expect(maximumSpeed).toBeGreaterThan(0);
  });
});

describe("canonical determinism and hostile persistence", () => {
  it("is independent of segment, signal, station, and train insertion history", () => {
    const forward = opposingNetwork("forward", "forward");
    const reverse = opposingNetwork("reverse", "reverse");
    forward.step(1_000);
    reverse.step(1_000);
    expect(reverse.snapshot()).toEqual(forward.snapshot());
    expect(canonicalRailBytes(reverse)).toBe(canonicalRailBytes(forward));
  });

  it("round-trips exact canonical bytes and rejects corruption, extras, and non-canonical order", () => {
    const network = opposingNetwork();
    network.step(777);
    const bytes = canonicalRailBytes(network);
    const parsed: unknown = JSON.parse(bytes);
    expect(isCanonicalRailSave(parsed)).toBe(true);
    const restored = restoreRailNetwork(parsed);
    expect(canonicalRailBytes(restored)).toBe(bytes);
    expect(restored.snapshot()).toEqual(network.snapshot());

    const extra = JSON.parse(bytes) as Record<string, unknown>;
    extra.exploit = true;
    expect(isCanonicalRailSave(extra)).toBe(false);
    expect(() => restoreRailNetwork(extra)).toThrow(/hostile/);

    const overflow = JSON.parse(bytes) as {
      trains: Array<{ speedMilliPerTick: number }>;
    };
    overflow.trains[0]!.speedMilliPerTick = Number.MAX_SAFE_INTEGER;
    expect(isCanonicalRailSave(overflow)).toBe(false);

    const reordered = JSON.parse(bytes) as {
      segments: RailSegmentInput[];
    };
    reordered.segments.reverse();
    expect(isCanonicalRailSave(reordered)).toBe(false);

    const oversized = {
      ...(JSON.parse(bytes) as Record<string, unknown>),
      segments: Array.from(
        { length: RAIL_LIMITS.maxSegments + 1 },
        (_, index) => ({
          id: `oversized-${index}`,
          x: index,
          y: 0,
          kind: "straight",
          rotation: 1,
        }),
      ),
    };
    expect(isCanonicalRailSave(oversized)).toBe(false);
  });
});

describe("production-loop proof", () => {
  it("runs mine → loading dwell → signal blocks → unloading dwell with exact cargo conservation", () => {
    const segments = horizontalLine(8, "loop");
    const signals: RailSignalInput[] = [
      {
        id: "west-chain",
        fromSegmentId: "loop-1",
        toSegmentId: "loop-2",
        type: "chain",
      },
      {
        id: "west-regular-return",
        fromSegmentId: "loop-2",
        toSegmentId: "loop-1",
        type: "regular",
      },
      {
        id: "east-regular",
        fromSegmentId: "loop-5",
        toSegmentId: "loop-6",
        type: "regular",
      },
      {
        id: "east-chain-return",
        fromSegmentId: "loop-6",
        toSegmentId: "loop-5",
        type: "chain",
      },
    ];
    const hooks: RailNetworkHooks = {
      transferAtStation: ({ station: current }) =>
        current.id === "mine"
          ? [{ wagonId: "ore-wagon", itemId: "iron-ore", amount: 2 }]
          : [{ wagonId: "ore-wagon", itemId: "iron-ore", amount: -2 }],
    };
    const network = new RailNetwork(
      {
        segments,
        signals,
        stations: [
          station("mine", "loop-0", 100, [
            { itemId: "iron-ore", count: 40 },
          ]),
          station("foundry", "loop-7", 100),
        ],
        trains: [
          {
            id: "ore-runner",
            currentSegmentId: "loop-0",
            cars: [
              locomotive(100_000, "ore-loco"),
              cargoWagon(10, "ore-wagon"),
            ],
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
          },
        ],
      },
      hooks,
    );

    const result = network.step(2_500);
    const transfers = result.events.filter(
      (event) => event.type === "cargo-transferred",
    );
    const arrivals = result.events.filter(
      (event) => event.type === "train-arrived",
    );
    expect(transfers.some((event) => event.amount > 0)).toBe(true);
    expect(transfers.some((event) => event.amount < 0)).toBe(true);
    expect(
      arrivals.some(
        (event) =>
          event.type === "train-arrived" &&
          event.stationId === "foundry",
      ),
    ).toBe(true);
    expect(totalItemUnits(network, "iron-ore")).toBe(40);
    const foundry = network
      .snapshot()
      .stations.find((current) => current.id === "foundry")!;
    expect(
      foundry.inventory.find((stack) => stack.itemId === "iron-ore")?.count,
    ).toBeGreaterThanOrEqual(10);
    expect(trainById(network, "ore-runner").distanceTravelledMilli).toBeGreaterThan(
      7 * RAIL_DISTANCE_SCALE,
    );
    expect(
      trainById(network, "ore-runner").fuelMilli,
    ).toBeLessThan(100_000);
  });
});
