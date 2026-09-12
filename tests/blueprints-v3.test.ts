import { describe, expect, it } from "vitest";

import {
  BLUEPRINT_FORMAT,
  BLUEPRINT_VERSION,
  MAX_BLUEPRINT_ENTITIES,
  MAX_BLUEPRINT_JSON_LENGTH,
  captureBlueprint,
  planBlueprintPlacement,
  restoreBlueprint,
  serializeBlueprint,
  transformBlueprint,
  type Blueprint,
  type BlueprintCircuitCaptureSnapshot,
  type BlueprintRailCaptureSnapshot,
} from "../src/game/blueprints";
import { CATALOG_VERSION } from "../src/game/catalog";
import {
  RailNetwork,
  createRailGraph,
  findRailPath,
  type RailNetworkInput,
} from "../src/game/rail-network";
import {
  Direction,
  ManifoldMode,
  type EntityKind,
  type EntityState,
  type ItemId,
} from "../src/game/types";

function entity(
  id: number,
  kind: EntityKind,
  x: number,
  y: number,
  direction = Direction.North,
  extra: Record<string, unknown> = {},
): EntityState {
  return {
    id,
    kind,
    x,
    y,
    direction,
    ...extra,
  } as unknown as EntityState;
}

function mutable(value: Blueprint): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function expectDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

const emptyCircuit: BlueprintCircuitCaptureSnapshot = {
  devices: [],
  machinePorts: [],
  wires: [],
};

const railSelection = {
  x: 9,
  y: 9,
  width: 8,
  height: 6,
};

interface RailFixture {
  readonly entities: readonly EntityState[];
  readonly capture: BlueprintRailCaptureSnapshot;
  readonly ids: {
    readonly segments: readonly string[];
    readonly station: string;
  };
}

function railFixture(
  prefix: string,
  reverseInsertion = false,
  itemFilter?: readonly ItemId[],
): RailFixture {
  const segments = Array.from({ length: 4 }, (_, index) => ({
    id: `${prefix}-segment-${index}`,
    x: 10 + index,
    y: 10,
    kind: "straight" as const,
    rotation: 1 as const,
  }));
  const station = `${prefix}-station`;
  const storageId = prefix === "alpha" ? 501 : 902;
  const cars = [
    {
      id: `${prefix}-wagon-large`,
      kind: "cargo-wagon" as const,
      capacity: 40,
      cargo: [{ itemId: "copperOre", count: 17 }],
    },
    {
      id: `${prefix}-locomotive`,
      kind: "locomotive" as const,
      fuelCapacityMilli: 100_000,
      fuelMilli: prefix === "alpha" ? 90_000 : 1,
    },
    {
      id: `${prefix}-wagon-small`,
      kind: "cargo-wagon" as const,
      capacity: 20,
      cargo: [{ itemId: "ironOre", count: 9 }],
    },
  ];
  const network = {
    segments: reverseInsertion ? [...segments].reverse() : segments,
    signals: [
      {
        id: `${prefix}-signal`,
        fromSegmentId: segments[1]!.id,
        toSegmentId: segments[2]!.id,
        type: "regular" as const,
      },
    ],
    stations: [
      {
        id: station,
        segmentId: segments[3]!.id,
        capacity: 0,
        inventory: [{ itemId: "coal", count: 999 }],
      },
    ],
    trains: [
      {
        id: `${prefix}-train`,
        currentSegmentId: segments[0]!.id,
        cars: reverseInsertion ? [...cars].reverse() : cars,
        schedule: [
          {
            stationId: station,
            wait: {
              type: "item-at-least" as const,
              itemId: "ironOre",
              count: 2,
            },
          },
        ],
        scheduleIndex: 0,
        progressMilli: 777,
        speedMilliPerTick: 88,
        reservationWaitTicks: 44,
        distanceTravelledMilli: 33_000,
      },
    ],
    tick: 55,
    reservations: [
      {
        blockId: "runtime-block",
        trainId: `${prefix}-train`,
        kind: "reserved",
      },
    ],
  } as unknown as RailNetworkInput;
  const binding = {
    stationId: station,
    storageEntityId: storageId,
    mode: "both" as const,
    transferRate: 7,
    ...(itemFilter === undefined ? {} : { itemFilter }),
  };
  return {
    entities: [
      entity(storageId, "storage", 13, 11, Direction.North, {
        inventory: { ironOre: 500 },
      }),
    ],
    capture: {
      network,
      stationInterfaces: [binding],
    },
    ids: {
      segments: segments.map((segment) => segment.id),
      station,
    },
  };
}

function captureRail(
  fixture: RailFixture,
  selection = railSelection,
): Blueprint {
  return captureBlueprint(
    fixture.entities,
    selection,
    { rail: fixture.capture },
  );
}

describe("blueprint v3 migration and advanced construction defaults", () => {
  it("strictly migrates a canonical v2 envelope and rejects advanced kinds in legacy versions", () => {
    const current = captureBlueprint(
      [
        entity(1, "manifold", 0, 0, Direction.North, {
          manifoldRouting: {
            mode: ManifoldMode.FavorB,
            filter: null,
            extractPort: 1,
            splitCursors: [1, 0],
            mergeCursors: [0, 1],
          },
        }),
      ],
      { x: 0, y: 0, width: 1, height: 2 },
    );
    const legacy = mutable(current);
    legacy.version = 2;
    delete legacy.wires;
    delete legacy.rail;
    for (const candidate of legacy.entities as Record<string, unknown>[]) {
      delete candidate.ref;
      delete candidate.fluidId;
      delete candidate.fluidRecipeId;
      delete candidate.circuitDevice;
      delete candidate.circuitMachine;
    }

    const migrated = restoreBlueprint(legacy);
    expect(migrated).toMatchObject({
      format: BLUEPRINT_FORMAT,
      version: BLUEPRINT_VERSION,
      catalog: CATALOG_VERSION,
      wires: [],
      rail: {
        segments: [],
        signals: [],
        stations: [],
        trains: [],
      },
    });
    expect(migrated.entities[0]).toMatchObject({
      ref: 0,
      fluidId: null,
      fluidRecipeId: null,
      circuitDevice: null,
    });
    expect(serializeBlueprint(restoreBlueprint(serializeBlueprint(migrated))))
      .toBe(serializeBlueprint(migrated));
    expectDeepFrozen(migrated);

    const impossibleLegacy = clone(legacy);
    (impossibleLegacy.entities as Record<string, unknown>[])[0]!.kind =
      "fluidPipe";
    (impossibleLegacy.entities as Record<string, unknown>[])[0]!
      .manifoldRouting = null;
    expect(() => restoreBlueprint(impossibleLegacy)).toThrow(
      /not supported by legacy blueprint version/,
    );
  });

  it("captures fluid choices, combinator programs, machine controls, and wires as detached canonical intent", () => {
    const iron = { type: "item" as const, name: "ironOre" };
    const copper = { type: "item" as const, name: "copperOre" };
    const entities = [
      entity(10, "constantCombinator", 0, 0),
      entity(20, "inserter", 2, 0, Direction.East),
      entity(30, "fluidSource", 4, 0, Direction.North, {
        fluidState: {
          sourceFluidId: "refinedFuel",
          amountMilli: 9_999,
          progressMilli: 444,
        },
      }),
      entity(40, "fluidProcessor", 7, 0, Direction.North, {
        fluidState: {
          recipeId: "refineCrude",
          inputAmountMilli: 99_999,
          outputAmountMilli: 88_888,
          progressMilli: 333,
        },
      }),
    ];
    const snapshot = {
      devices: [
        {
          kind: "constant" as const,
          id: "entity:10:device",
          outputEndpoint: "entity:10:output",
          signals: [
            { signal: iron, value: 2 },
            { signal: copper, value: 1 },
            { signal: iron, value: 3 },
          ],
          enabled: false,
        },
      ],
      machinePorts: [
        {
          id: "entity:20:machine",
          inputEndpoint: "entity:20:io",
          outputEndpoint: "entity:20:io",
          enableCondition: {
            left: iron,
            operator: ">" as const,
            right: { kind: "constant" as const, value: 3 },
          },
          powerSwitchCondition: {
            left: copper,
            operator: ">=" as const,
            right: { kind: "constant" as const, value: 1 },
          },
          filter: {
            candidates: [iron, copper],
            minimum: 2,
          },
          sorterRoutes: [],
          sorterFallback: null,
        },
      ],
      wires: [
        {
          color: "red",
          endpointA: "entity:20:io",
          endpointB: "entity:10:output",
        },
      ],
    };

    const blueprint = captureBlueprint(
      entities,
      { x: 0, y: 0, width: 10, height: 3 },
      { circuit: snapshot },
    );
    expect(blueprint.entities.map((candidate) => candidate.kind)).toEqual([
      "constantCombinator",
      "inserter",
      "fluidSource",
      "fluidProcessor",
    ]);
    expect(blueprint.entities[0]!.circuitDevice).toEqual({
      kind: "constant",
      signals: [
        { signal: copper, value: 1 },
        { signal: iron, value: 5 },
      ],
      enabled: false,
    });
    expect(blueprint.entities[1]!.circuitMachine).toMatchObject({
      filter: {
        candidates: [copper, iron],
        minimum: 2,
      },
    });
    expect(blueprint.entities[2]).toMatchObject({
      fluidId: "refinedFuel",
      fluidRecipeId: null,
    });
    expect(blueprint.entities[3]).toMatchObject({
      fluidId: null,
      fluidRecipeId: "refineCrude",
    });
    expect(blueprint.wires).toEqual([
      {
        color: "red",
        endpointA: { entityRef: 0, connector: "output" },
        endpointB: { entityRef: 1, connector: "io" },
      },
    ]);
    const bytes = serializeBlueprint(blueprint);
    expect(bytes).not.toContain("amountMilli");
    expect(bytes).not.toContain("progressMilli");
    expect(serializeBlueprint(restoreBlueprint(bytes))).toBe(bytes);
    expectDeepFrozen(blueprint);
  });

  it("returns a parsable canonical value near the JSON budget and preserves that invariant through transform", () => {
    const source = Array.from(
      { length: MAX_BLUEPRINT_ENTITIES },
      (_, index) =>
        entity(
          index + 1,
          "constantCombinator",
          index % 64,
          Math.floor(index / 64),
          (index % 4) as Direction,
        ),
    );
    const blueprint = captureBlueprint(
      source.reverse(),
      { x: 0, y: 0, width: 64, height: 64 },
    );
    const bytes = serializeBlueprint(blueprint);
    expect(bytes.length).toBeGreaterThan(850_000);
    expect(bytes.length).toBeLessThanOrEqual(MAX_BLUEPRINT_JSON_LENGTH);
    expect(serializeBlueprint(restoreBlueprint(bytes))).toBe(bytes);

    const transformed = transformBlueprint(blueprint, {
      mirror: "horizontal",
      quarterTurns: 3,
    });
    const transformedBytes = serializeBlueprint(transformed);
    expect(transformedBytes.length).toBeLessThanOrEqual(
      MAX_BLUEPRINT_JSON_LENGTH,
    );
    expect(serializeBlueprint(restoreBlueprint(transformedBytes))).toBe(
      transformedBytes,
    );
  });
});

describe("blueprint v3 circuit topology validation and transforms", () => {
  function wiredPair(
    firstX = 0,
    secondX = 2,
  ): {
    readonly entities: readonly EntityState[];
    readonly circuit: BlueprintCircuitCaptureSnapshot;
  } {
    return {
      entities: [
        entity(10, "constantCombinator", firstX, 0),
        entity(20, "inserter", secondX, 0, Direction.East),
      ],
      circuit: {
        devices: [],
        machinePorts: [],
        wires: [
          {
            color: "green",
            endpointA: "entity:10:output",
            endpointB: "entity:20:io",
          },
        ],
      },
    };
  }

  it("remaps canonical local refs through rotations/mirrors and preserves exact double/full-turn identities", () => {
    const fixture = wiredPair();
    const original = captureBlueprint(
      fixture.entities,
      { x: 0, y: 0, width: 3, height: 1 },
      { circuit: fixture.circuit },
    );
    const mirrored = transformBlueprint(original, { mirror: "horizontal" });
    expect(mirrored.entities.map((candidate) => candidate.kind)).toEqual([
      "inserter",
      "constantCombinator",
    ]);
    expect(mirrored.wires).toEqual([
      {
        color: "green",
        endpointA: { entityRef: 0, connector: "io" },
        endpointB: { entityRef: 1, connector: "output" },
      },
    ]);
    expect(
      serializeBlueprint(
        transformBlueprint(mirrored, { mirror: "horizontal" }),
      ),
    ).toBe(serializeBlueprint(original));
    expect(
      serializeBlueprint(
        transformBlueprint(
          transformBlueprint(original, { mirror: "vertical" }),
          { mirror: "vertical" },
        ),
      ),
    ).toBe(serializeBlueprint(original));

    let rotated = original;
    for (let turn = 0; turn < 4; turn += 1) {
      rotated = transformBlueprint(rotated, { quarterTurns: 1 });
    }
    expect(serializeBlueprint(rotated)).toBe(serializeBlueprint(original));

    const plan = planBlueprintPlacement(
      original,
      { x: 100, y: 200 },
      { quarterTurns: 1 },
    );
    expect(plan.placements.map(({ ref, kind, x, y }) => ({
      ref,
      kind,
      x,
      y,
    }))).toEqual([
      { ref: 0, kind: "constantCombinator", x: 100, y: 200 },
      { ref: 1, kind: "inserter", x: 100, y: 202 },
    ]);
    expect(plan.wires).toEqual([
      {
        color: "green",
        endpointA: { entityRef: 0, connector: "output" },
        endpointB: { entityRef: 1, connector: "io" },
      },
    ]);
    expectDeepFrozen(plan);
  });

  it("swaps manifold circuit sorter A/B intent on either mirror but retains local branches on rotation", () => {
    const iron = { type: "item" as const, name: "ironOre" };
    const copper = { type: "item" as const, name: "copperOre" };
    const condition = (
      signal: typeof iron | typeof copper,
      value: number,
    ) => ({
      left: signal,
      operator: ">" as const,
      right: { kind: "constant" as const, value },
    });
    const original = captureBlueprint(
      [entity(30, "manifold", 0, 0, Direction.North)],
      { x: 0, y: 0, width: 1, height: 2 },
      {
        circuit: {
          devices: [],
          machinePorts: [
            {
              id: "entity:30:machine",
              inputEndpoint: "entity:30:io",
              outputEndpoint: "entity:30:io",
              enableCondition: null,
              powerSwitchCondition: null,
              filter: null,
              sorterRoutes: [
                {
                  priority: 20,
                  output: "B",
                  condition: condition(copper, 2),
                },
                {
                  priority: 10,
                  output: "A",
                  condition: condition(iron, 1),
                },
              ],
              sorterFallback: "A",
            },
          ],
          wires: [],
        },
      },
    );
    expect(
      original.entities[0]!.circuitMachine!.sorterRoutes.map(
        ({ priority, output }) => ({ priority, output }),
      ),
    ).toEqual([
      { priority: 10, output: "A" },
      { priority: 20, output: "B" },
    ]);

    for (const mirror of ["horizontal", "vertical"] as const) {
      const mirrored = transformBlueprint(original, { mirror });
      expect(
        mirrored.entities[0]!.circuitMachine!.sorterRoutes.map(
          ({ priority, output }) => ({ priority, output }),
        ),
      ).toEqual([
        { priority: 10, output: "B" },
        { priority: 20, output: "A" },
      ]);
      expect(
        mirrored.entities[0]!.circuitMachine!.sorterFallback,
      ).toBe("B");
      expect(
        serializeBlueprint(transformBlueprint(mirrored, { mirror })),
      ).toBe(serializeBlueprint(original));
    }

    const quarterTurn = transformBlueprint(original, { quarterTurns: 1 });
    expect(quarterTurn.entities[0]!.circuitMachine).toEqual(
      original.entities[0]!.circuitMachine,
    );
    let fullTurn = original;
    for (let turn = 0; turn < 4; turn += 1) {
      fullTurn = transformBlueprint(fullTurn, { quarterTurns: 1 });
    }
    expect(serializeBlueprint(fullTurn)).toBe(serializeBlueprint(original));
  });

  it("drops cross-boundary wires and rejects dangling, self, duplicate, invalid-connector, and over-reach links", () => {
    const valid = wiredPair();
    const cropped = captureBlueprint(
      valid.entities,
      { x: 0, y: 0, width: 1, height: 1 },
      { circuit: valid.circuit },
    );
    expect(cropped.entities).toHaveLength(1);
    expect(cropped.wires).toEqual([]);

    const invalidCases = [
      {
        entities: valid.entities,
        wire: {
          color: "red",
          endpointA: "entity:10:output",
          endpointB: "entity:999:io",
        },
        pattern: /dangling entity reference/,
      },
      {
        entities: valid.entities,
        wire: {
          color: "red",
          endpointA: "entity:10:output",
          endpointB: "entity:10:output",
        },
        pattern: /self-link/,
      },
      {
        entities: valid.entities,
        wire: {
          color: "red",
          endpointA: "entity:10:input",
          endpointB: "entity:20:io",
        },
        pattern: /invalid connector/,
      },
      {
        entities: wiredPair(0, 10).entities,
        wire: {
          color: "red",
          endpointA: "entity:10:output",
          endpointB: "entity:20:io",
        },
        pattern: /reach/,
      },
    ] as const;
    for (const candidate of invalidCases) {
      expect(() =>
        captureBlueprint(
          candidate.entities,
          { x: 0, y: 0, width: 11, height: 1 },
          {
            circuit: {
              devices: [],
              machinePorts: [],
              wires: [candidate.wire],
            },
          },
        ),
      ).toThrow(candidate.pattern);
    }

    expect(() =>
      captureBlueprint(
        valid.entities,
        { x: 0, y: 0, width: 3, height: 1 },
        {
          circuit: {
            devices: [],
            machinePorts: [],
            wires: [
              valid.circuit.wires[0]!,
              {
                ...valid.circuit.wires[0]!,
                endpointA: valid.circuit.wires[0]!.endpointB,
                endpointB: valid.circuit.wires[0]!.endpointA,
              },
            ],
          },
        },
      ),
    ).toThrow(/duplicate/);
  });

  it("rejects device-kind and machine-capability mismatches in capture and hostile v3 objects", () => {
    const arithmetic = entity(10, "arithmeticCombinator", 0, 0);
    expect(() =>
      captureBlueprint(
        [arithmetic],
        { x: 0, y: 0, width: 1, height: 1 },
        {
          circuit: {
            devices: [
              {
                kind: "constant",
                id: "entity:10:device",
                outputEndpoint: "entity:10:output",
                signals: [],
                enabled: true,
              },
            ],
            machinePorts: [],
            wires: [],
          },
        },
      ),
    ).toThrow(/incompatible/);

    const storage = entity(11, "storage", 0, 0);
    expect(() =>
      captureBlueprint(
        [storage],
        { x: 0, y: 0, width: 2, height: 2 },
        {
          circuit: {
            devices: [],
            machinePorts: [
              {
                id: "entity:11:machine",
                inputEndpoint: "entity:11:io",
                outputEndpoint: "entity:11:io",
                enableCondition: {
                  left: { type: "item", name: "ironOre" },
                  operator: ">",
                  right: { kind: "constant", value: 0 },
                },
                powerSwitchCondition: null,
                filter: null,
                sorterRoutes: [],
                sorterFallback: null,
              },
            ],
            wires: [],
          },
        },
      ),
    ).toThrow(/unsupported/);

    const valid = mutable(
      captureBlueprint(
        [entity(12, "constantCombinator", 0, 0)],
        { x: 0, y: 0, width: 1, height: 1 },
      ),
    );
    const device = (
      (valid.entities as Record<string, unknown>[])[0]!
        .circuitDevice as Record<string, unknown>
    );
    device.signals = [
      {
        signal: { type: "item", name: "ironOre" },
        value: 0,
      },
    ];
    expect(() => restoreBlueprint(valid)).toThrow(/omit zero/);
  });
});

describe("blueprint v3 rail intent", () => {
  it("is runtime-ID and insertion-order independent for a mixed locomotive/cargo consist", () => {
    const alpha = captureRail(railFixture("alpha", false));
    const omega = captureRail(railFixture("omega", true));
    expect(serializeBlueprint(alpha)).toBe(serializeBlueprint(omega));
    expect(alpha.rail.trains[0]!.cars).toEqual([
      { kind: "locomotive", fuelCapacityMilli: 100_000 },
      { kind: "cargo-wagon", capacity: 20 },
      { kind: "cargo-wagon", capacity: 40 },
    ]);

    const bytes = serializeBlueprint(alpha);
    for (const runtimeKey of [
      "\"id\"",
      "\"fuelMilli\"",
      "\"cargo\"",
      "\"inventory\"",
      "\"progressMilli\"",
      "\"speedMilliPerTick\"",
      "\"scheduleIndex\"",
      "\"reservationWaitTicks\"",
      "\"distanceTravelledMilli\"",
      "\"reservations\"",
      "\"tick\"",
    ]) {
      expect(bytes).not.toContain(runtimeKey);
    }
    expect(serializeBlueprint(restoreBlueprint(bytes))).toBe(bytes);
    expectDeepFrozen(alpha);
  });

  it("captures an actual RailNetworkSnapshot without retaining runtime state", () => {
    const fixture = railFixture("alpha");
    const runtime = new RailNetwork({
      segments: Array.from({ length: 4 }, (_, index) => ({
        id: fixture.ids.segments[index]!,
        x: 10 + index,
        y: 10,
        kind: "straight" as const,
        rotation: 1 as const,
      })),
      signals: [
        {
          id: "snapshot-signal",
          fromSegmentId: fixture.ids.segments[1]!,
          toSegmentId: fixture.ids.segments[2]!,
          type: "regular",
        },
      ],
      stations: [
        {
          id: fixture.ids.station,
          segmentId: fixture.ids.segments[3]!,
          capacity: 0,
        },
      ],
      trains: [
        {
          id: "snapshot-train",
          currentSegmentId: fixture.ids.segments[0]!,
          cars: [
            {
              id: "z-large",
              kind: "cargo-wagon",
              capacity: 40,
              cargo: [{ itemId: "copperOre", count: 17 }],
            },
            {
              id: "a-engine",
              kind: "locomotive",
              fuelCapacityMilli: 100_000,
              fuelMilli: 75_000,
            },
            {
              id: "m-small",
              kind: "cargo-wagon",
              capacity: 20,
              cargo: [{ itemId: "ironOre", count: 9 }],
            },
          ],
          schedule: [
            {
              stationId: fixture.ids.station,
              wait: {
                type: "item-at-least",
                itemId: "ironOre",
                count: 2,
              },
            },
          ],
        },
      ],
    });
    runtime.step();
    const fromSnapshot = captureBlueprint(
      fixture.entities,
      railSelection,
      {
        rail: {
          network: runtime.snapshot(),
          stationInterfaces: fixture.capture.stationInterfaces,
        },
      },
    );
    expect(serializeBlueprint(fromSnapshot)).toBe(
      serializeBlueprint(captureRail(fixture)),
    );
  });

  it("preserves unrestricted versus filtered storage semantics, exact placement refs, and directed signals", () => {
    const unrestricted = captureRail(railFixture("alpha"));
    expect(
      unrestricted.rail.stations[0]!.storageBinding!.itemFilter,
    ).toBeNull();

    const filtered = captureRail(
      railFixture("alpha", false, ["copperOre", "ironOre"]),
    );
    expect(filtered.rail.stations[0]!.storageBinding!.itemFilter).toEqual([
      "ironOre",
      "copperOre",
    ]);
    const plan = planBlueprintPlacement(filtered, { x: 100, y: 200 });
    expect(plan.rail!.segments.map(({ ref, x, y }) => ({ ref, x, y })))
      .toEqual([
        { ref: 0, x: 100, y: 200 },
        { ref: 1, x: 101, y: 200 },
        { ref: 2, x: 102, y: 200 },
        { ref: 3, x: 103, y: 200 },
      ]);
    expect(plan.rail!.stations[0]).toMatchObject({
      ref: 0,
      segmentRef: 3,
      storageBinding: {
        entityRef: 0,
        itemFilter: ["ironOre", "copperOre"],
      },
    });
    expect(plan.rail!.trains[0]).toMatchObject({
      ref: 0,
      segmentRef: 0,
      schedule: [{ stationRef: 0 }],
    });

    const mirrored = transformBlueprint(filtered, { mirror: "horizontal" });
    const guarded = mirrored.rail.signals[0]!;
    const from = mirrored.rail.segments[guarded.fromSegmentRef]!;
    const to = mirrored.rail.segments[guarded.toSegmentRef]!;
    expect({ from: [from.x, from.y], to: [to.x, to.y] }).toEqual({
      from: [3, 0],
      to: [2, 0],
    });
    expect(
      serializeBlueprint(
        transformBlueprint(mirrored, { mirror: "horizontal" }),
      ),
    ).toBe(serializeBlueprint(filtered));
    expect(
      serializeBlueprint(
        transformBlueprint(
          transformBlueprint(filtered, { mirror: "vertical" }),
          { mirror: "vertical" },
        ),
      ),
    ).toBe(serializeBlueprint(filtered));
    let rotated = filtered;
    for (let turn = 0; turn < 4; turn += 1) {
      rotated = transformBlueprint(rotated, { quarterTurns: 1 });
    }
    expect(serializeBlueprint(rotated)).toBe(serializeBlueprint(filtered));
  });

  it("crops rail-only intent independently of marquee padding and applies kind-sensitive mirror rotations", () => {
    const mirrorRotation = (
      kind: "straight" | "curve" | "junction",
      rotation: 0 | 1 | 2 | 3,
      mirror: "horizontal" | "vertical",
    ): 0 | 1 | 2 | 3 => {
      const raw = mirror === "horizontal"
        ? kind === "curve"
          ? 3 - rotation
          : 4 - rotation
        : kind === "curve"
          ? 1 - rotation
          : 2 - rotation;
      const modulo = ((raw % 4) + 4) % 4 as 0 | 1 | 2 | 3;
      return kind === "straight"
        ? (modulo % 2) as 0 | 1
        : modulo;
    };

    for (const kind of ["straight", "curve", "junction"] as const) {
      for (const rotation of [0, 1, 2, 3] as const) {
        const network: RailNetworkInput = {
          segments: [
            {
              id: `segment-${kind}-${rotation}`,
              x: 50,
              y: 60,
              kind,
              rotation,
            },
          ],
          stations: [],
        };
        const exact = captureBlueprint(
          [],
          { x: 50, y: 60, width: 1, height: 1 },
          { rail: { network } },
        );
        const padded = captureBlueprint(
          [],
          { x: 45, y: 55, width: 12, height: 12 },
          { rail: { network } },
        );
        expect(serializeBlueprint(padded)).toBe(serializeBlueprint(exact));
        expect(exact).toMatchObject({
          width: 1,
          height: 1,
          entities: [],
        });
        const canonicalRotation = kind === "straight"
          ? (rotation % 2) as 0 | 1
          : rotation;
        expect(exact.rail.segments[0]!.rotation).toBe(canonicalRotation);
        for (const mirror of ["horizontal", "vertical"] as const) {
          const mirrored = transformBlueprint(exact, { mirror });
          expect(mirrored.rail.segments[0]!.rotation).toBe(
            mirrorRotation(kind, canonicalRotation, mirror),
          );
          expect(
            serializeBlueprint(transformBlueprint(mirrored, { mirror })),
          ).toBe(serializeBlueprint(exact));
        }
        let rotated = exact;
        for (let turn = 0; turn < 4; turn += 1) {
          rotated = transformBlueprint(rotated, { quarterTurns: 1 });
        }
        expect(serializeBlueprint(rotated)).toBe(serializeBlueprint(exact));
      }
    }
  });

  it("keeps a signaled curve/junction topology connected through both mirrors and a full rotation cycle", () => {
    const network: RailNetworkInput = {
      segments: [
        {
          id: "west",
          x: 40,
          y: 50,
          kind: "straight",
          rotation: 1,
        },
        {
          id: "junction",
          x: 41,
          y: 50,
          kind: "junction",
          rotation: 0,
        },
        {
          id: "curve",
          x: 42,
          y: 50,
          kind: "curve",
          rotation: 2,
        },
        {
          id: "south",
          x: 42,
          y: 51,
          kind: "straight",
          rotation: 0,
        },
      ],
      signals: [
        {
          id: "junction-to-curve",
          fromSegmentId: "junction",
          toSegmentId: "curve",
          type: "chain",
        },
      ],
      stations: [],
    };
    const original = captureBlueprint(
      [],
      { x: 38, y: 48, width: 8, height: 7 },
      { rail: { network } },
    );
    const expectConnected = (blueprint: Blueprint): void => {
      const graph = createRailGraph(
        blueprint.rail.segments.map((segment) => ({
          id: `segment:${segment.ref}`,
          x: segment.x,
          y: segment.y,
          kind: segment.kind,
          rotation: segment.rotation,
        })),
        blueprint.rail.signals.map((signal, index) => ({
          id: `signal:${index}`,
          fromSegmentId: `segment:${signal.fromSegmentRef}`,
          toSegmentId: `segment:${signal.toSegmentRef}`,
          type: signal.type,
        })),
      );
      expect(graph.nodes).toHaveLength(4);
      expect(
        findRailPath(graph, "segment:0", "segment:3"),
      ).not.toBeNull();
    };
    expectConnected(original);

    for (const mirror of ["horizontal", "vertical"] as const) {
      const mirrored = transformBlueprint(original, { mirror });
      expectConnected(mirrored);
      const inverted = transformBlueprint(mirrored, { mirror });
      expectConnected(inverted);
      expect(serializeBlueprint(inverted)).toBe(serializeBlueprint(original));
    }

    let rotated = original;
    for (let turn = 0; turn < 4; turn += 1) {
      rotated = transformBlueprint(rotated, { quarterTurns: 1 });
      expectConnected(rotated);
    }
    expect(serializeBlueprint(rotated)).toBe(serializeBlueprint(original));

    const plan = planBlueprintPlacement(
      original,
      { x: 300, y: 400 },
    );
    const plannedGraph = createRailGraph(
      plan.rail!.segments.map((segment) => ({
        id: `segment:${segment.ref}`,
        x: segment.x,
        y: segment.y,
        kind: segment.kind,
        rotation: segment.rotation,
      })),
      plan.rail!.signals.map((signal, index) => ({
        id: `signal:${index}`,
        fromSegmentId: `segment:${signal.fromSegmentRef}`,
        toSegmentId: `segment:${signal.toSegmentRef}`,
        type: signal.type,
      })),
    );
    expect(findRailPath(plannedGraph, "segment:0", "segment:3"))
      .not.toBeNull();
  });

  it("enforces crop policy for signals, trains, schedules, and station storage bindings", () => {
    const outsideTrain = railFixture("alpha");
    const cropped = captureRail(outsideTrain, {
      x: 12,
      y: 10,
      width: 3,
      height: 3,
    });
    expect(cropped.rail.segments).toHaveLength(2);
    expect(cropped.rail.signals).toEqual([]);
    expect(cropped.rail.trains).toEqual([]);
    expect(cropped.rail.stations).toHaveLength(1);

    expect(() =>
      captureRail(railFixture("alpha"), {
        x: 10,
        y: 10,
        width: 2,
        height: 1,
      }),
    ).toThrow(/schedule leaves the captured rail selection/);

    expect(() =>
      captureRail(railFixture("alpha"), {
        x: 13,
        y: 10,
        width: 1,
        height: 1,
      }),
    ).toThrow(/storage binding leaves the captured selection/);
  });

  it("rejects duplicate signal transitions, empty schedules, nonadjacent/reused storage, rail overlap, and empty filters", () => {
    const duplicateSignal = railFixture("alpha");
    const duplicateNetwork = clone(
      duplicateSignal.capture.network,
    ) as unknown as {
      signals: Array<Record<string, unknown>>;
    };
    duplicateNetwork.signals.push({
      ...duplicateNetwork.signals[0]!,
      id: "other-signal",
      type: "chain",
    });
    expect(() =>
      captureBlueprint(
        duplicateSignal.entities,
        railSelection,
        {
          rail: {
            ...duplicateSignal.capture,
            network: duplicateNetwork as unknown as RailNetworkInput,
          },
        },
      ),
    ).toThrow(/duplicates a directed rail signal/);

    const emptySchedule = railFixture("alpha");
    const noStops = clone(emptySchedule.capture.network) as unknown as {
      trains: Array<{ schedule: unknown[] }>;
    };
    noStops.trains[0]!.schedule = [];
    expect(() =>
      captureBlueprint(
        emptySchedule.entities,
        railSelection,
        {
          rail: {
            ...emptySchedule.capture,
            network: noStops as unknown as RailNetworkInput,
          },
        },
      ),
    ).toThrow(/schedule must not be empty/);

    const far = railFixture("alpha");
    const farStorage = [
      entity(501, "storage", 20, 11, Direction.North),
    ];
    expect(() =>
      captureBlueprint(
        farStorage,
        { x: 9, y: 9, width: 14, height: 6 },
        { rail: far.capture },
      ),
    ).toThrow(/not adjacent/);

    const overlap = railFixture("alpha");
    expect(() =>
      captureBlueprint(
        [
          ...overlap.entities,
          entity(777, "belt", 10, 10, Direction.East),
        ],
        railSelection,
        { rail: overlap.capture },
      ),
    ).toThrow(/rail\/entity construction overlaps/);

    expect(() =>
      captureRail(railFixture("alpha", false, [])),
    ).toThrow(/null or contain at least one item/);

    const reusedStorage = railFixture("alpha");
    const reusedNetwork = clone(
      reusedStorage.capture.network,
    ) as unknown as {
      stations: Array<Record<string, unknown>>;
    };
    reusedNetwork.stations.push({
      id: "second-station",
      segmentId: reusedStorage.ids.segments[2]!,
      capacity: 0,
    });
    const interfaces = [
      ...reusedStorage.capture.stationInterfaces!,
      {
        stationId: "second-station",
        storageEntityId: 501,
        mode: "load" as const,
        transferRate: 1,
      },
    ];
    expect(() =>
      captureBlueprint(
        [entity(501, "storage", 12, 11, Direction.North)],
        railSelection,
        {
          rail: {
            network: reusedNetwork as unknown as RailNetworkInput,
            stationInterfaces: interfaces,
          },
        },
      ),
    ).toThrow(/reuses a bound storage entity/);
  });

  it("rejects trains sharing a segment or a signal-defined block", () => {
    for (const currentSegmentIndex of [0, 1]) {
      const fixture = railFixture("alpha");
      const network = clone(fixture.capture.network) as unknown as {
        trains: Array<Record<string, unknown>>;
      };
      network.trains.push({
        id: `second-train-${currentSegmentIndex}`,
        currentSegmentId: fixture.ids.segments[currentSegmentIndex]!,
        cars: [
          {
            id: `second-loco-${currentSegmentIndex}`,
            kind: "locomotive",
            fuelCapacityMilli: 50_000,
            fuelMilli: 50_000,
          },
        ],
        schedule: [
          {
            stationId: fixture.ids.station,
            wait: { type: "time", ticks: 0 },
          },
        ],
      });
      expect(() =>
        captureBlueprint(
          fixture.entities,
          railSelection,
          {
            rail: {
              ...fixture.capture,
              network: network as unknown as RailNetworkInput,
            },
          },
        ),
      ).toThrow(
        currentSegmentIndex === 0
          ? /overlaps another train segment/
          : /already occupied block/,
      );
    }
  });

  it("rejects hostile rail refs, noncanonical car order, storage distance, and schedule item aliases after restore", () => {
    const baseline = mutable(captureRail(railFixture("alpha")));

    const danglingSignal = clone(baseline);
    (
      (danglingSignal.rail as Record<string, unknown>)
        .signals as Record<string, unknown>[]
    )[0]!.toSegmentRef = 99;
    expect(() => restoreBlueprint(danglingSignal)).toThrow(/dangling ref/);

    const carsOutOfOrder = clone(baseline);
    const cars = (
      (
        (carsOutOfOrder.rail as Record<string, unknown>)
          .trains as Record<string, unknown>[]
      )[0]!.cars as unknown[]
    );
    cars.reverse();
    expect(() => restoreBlueprint(carsOutOfOrder)).toThrow(
      /cars must be canonically ordered/,
    );

    const farBinding = clone(baseline);
    (
      (
        (farBinding.rail as Record<string, unknown>)
          .stations as Record<string, unknown>[]
      )[0]!
    ).segmentRef = 0;
    expect(() => restoreBlueprint(farBinding)).toThrow(/not adjacent/);

    const alias = clone(baseline);
    const wait = (
      (
        (
          (alias.rail as Record<string, unknown>)
            .trains as Record<string, unknown>[]
        )[0]!.schedule as Record<string, unknown>[]
      )[0]!.wait as Record<string, unknown>
    );
    wait.itemId = "Iron Ore";
    expect(() => restoreBlueprint(alias)).toThrow(/known item/);
  });
});
