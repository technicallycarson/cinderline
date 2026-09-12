import { describe, expect, it } from "vitest";

import {
  BLUEPRINT_FORMAT,
  BLUEPRINT_VERSION,
  MAX_BLUEPRINT_CAPTURE_CANDIDATES,
  MAX_BLUEPRINT_ENTITIES,
  MAX_BLUEPRINT_JSON_LENGTH,
  captureBlueprint,
  planBlueprintPlacement,
  restoreBlueprint,
  serializeBlueprint,
  transformBlueprint,
  type Blueprint,
} from "../src/game/blueprints";
import { CATALOG_VERSION } from "../src/game/catalog";
import {
  Direction,
  ManifoldMode,
  type EntityState,
} from "../src/game/types";

function entity(
  kind: EntityState["kind"],
  x: number,
  y: number,
  direction = Direction.North,
  configuration: {
    recipeId?: EntityState["recipeId"];
    manifoldRouting?: EntityState["manifoldRouting"];
  } = {},
): EntityState {
  return {
    kind,
    x,
    y,
    direction,
    recipeId: configuration.recipeId,
    manifoldRouting: configuration.manifoldRouting,
  } as EntityState;
}

function deepMutable(value: Blueprint): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function expectDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const entry of Object.values(value)) expectDeepFrozen(entry);
}

const EMPTY_RAIL = {
  segments: [],
  signals: [],
  stations: [],
  trains: [],
};

const EMPTY_CIRCUIT_MACHINE = {
  enableCondition: null,
  powerSwitchCondition: null,
  filter: null,
  sorterRoutes: [],
  sorterFallback: null,
};

describe("blueprint capture and canonical storage", () => {
  it("captures only construction intent, crops anchors, orders deterministically, and round-trips canonically", () => {
    const routing = {
      mode: ManifoldMode.FavorA,
      extractPort: 1,
      splitCursors: [1, 0],
      mergeCursors: [0, 1],
    } as EntityState["manifoldRouting"];
    const source = [
      entity("belt", 18, 13, Direction.West),
      entity("fabricator", 12, 10, Direction.North, {
        recipeId: "circuit",
      }),
      entity("manifold", 16, 11, Direction.North, {
        manifoldRouting: routing,
      }),
    ];

    const blueprint = captureBlueprint(source, {
      x: 11,
      y: 9,
      width: 9,
      height: 6,
    });
    expect(blueprint).toEqual({
      format: BLUEPRINT_FORMAT,
      version: BLUEPRINT_VERSION,
      catalog: CATALOG_VERSION,
      width: 7,
      height: 4,
      entities: [
        {
          ref: 0,
          kind: "fabricator",
          x: 0,
          y: 0,
          direction: Direction.North,
          recipeId: "circuit",
          manifoldRouting: null,
          fluidId: null,
          fluidRecipeId: null,
          circuitDevice: null,
          circuitMachine: EMPTY_CIRCUIT_MACHINE,
        },
        {
          ref: 1,
          kind: "manifold",
          x: 4,
          y: 1,
          direction: Direction.North,
          recipeId: null,
          manifoldRouting: {
            mode: ManifoldMode.FavorA,
            filter: null,
            extractPort: 1,
          },
          fluidId: null,
          fluidRecipeId: null,
          circuitDevice: null,
          circuitMachine: EMPTY_CIRCUIT_MACHINE,
        },
        {
          ref: 2,
          kind: "belt",
          x: 6,
          y: 3,
          direction: Direction.West,
          recipeId: null,
          manifoldRouting: null,
          fluidId: null,
          fluidRecipeId: null,
          circuitDevice: null,
          circuitMachine: null,
        },
      ],
      wires: [],
      rail: EMPTY_RAIL,
    });
    expectDeepFrozen(blueprint);

    routing!.mode = ManifoldMode.FavorB;
    expect(blueprint.entities[1]!.manifoldRouting!.mode).toBe(
      ManifoldMode.FavorA,
    );

    const bytes = serializeBlueprint(blueprint);
    const restored = restoreBlueprint(bytes);
    expect(restored).toEqual(blueprint);
    expect(restored).not.toBe(blueprint);
    expect(serializeBlueprint(restored)).toBe(bytes);
    expectDeepFrozen(restored);
  });

  it("is independent of source enumeration and marquee padding", () => {
    const first = entity("belt", 30, 20, Direction.East);
    const second = entity("storage", 32, 21, Direction.South);
    const a = captureBlueprint([second, first], {
      x: 29,
      y: 19,
      width: 8,
      height: 8,
    });
    const b = captureBlueprint([first, second], {
      x: 30,
      y: 20,
      width: 4,
      height: 3,
    });
    expect(serializeBlueprint(a)).toBe(serializeBlueprint(b));
  });

  it("represents empty and zero-area selections canonically", () => {
    const source = [entity("belt", 5, 5)];
    const missed = captureBlueprint(source, {
      x: 100,
      y: 100,
      width: 2,
      height: 2,
    });
    const zero = captureBlueprint(source, {
      x: 5,
      y: 5,
      width: 0,
      height: 1,
    });
    expect(missed).toEqual({
      format: BLUEPRINT_FORMAT,
      version: BLUEPRINT_VERSION,
      catalog: CATALOG_VERSION,
      width: 0,
      height: 0,
      entities: [],
      wires: [],
      rail: EMPTY_RAIL,
    });
    expect(serializeBlueprint(zero)).toBe(serializeBlueprint(missed));
  });

  it("does not inspect or serialize runtime identity, custody, progress, or power", () => {
    const runtimeNames = [
      "id",
      "inventory",
      "input",
      "output",
      "reclaim",
      "fuel",
      "beltItems",
      "heldItem",
      "heldItemSourceLane",
      "armProgress",
      "armReturning",
      "status",
      "progress",
      "animationPhase",
      "powerSatisfaction",
      "speedMultiplier",
      "activeRecipeId",
      "miningResource",
      "fuelEnergyKJ",
      "generatedPowerKW",
    ];
    const source: Record<string, unknown> = {
      x: 4,
      y: 7,
      kind: "manifold",
      direction: Direction.East,
      recipeId: undefined,
      manifoldRouting: {
        mode: ManifoldMode.Extract,
        filter: "ironPlate",
        extractPort: 1,
        splitCursors: [1, 1],
        mergeCursors: [1, 0],
      },
    };
    for (const name of runtimeNames) {
      Object.defineProperty(source, name, {
        enumerable: true,
        get: () => {
          throw new Error(`runtime field ${name} was read`);
        },
      });
    }

    const blueprint = captureBlueprint(
      [source as unknown as EntityState],
      { x: 4, y: 7, width: 2, height: 1 },
    );
    const bytes = serializeBlueprint(blueprint);
    const stored = JSON.parse(bytes) as {
      entities: Array<Record<string, unknown>>;
    };
    for (const name of runtimeNames) {
      expect(stored.entities[0]).not.toHaveProperty(name);
    }
    expect(bytes).not.toContain("splitCursors");
    expect(bytes).not.toContain("mergeCursors");
    expect(blueprint.entities[0]!.manifoldRouting).toEqual({
      mode: ManifoldMode.Extract,
      filter: "ironPlate",
      extractPort: 1,
    });
  });

  it("captures the player's queued recipe target instead of the in-flight recipe", () => {
    const fabricator = entity(
      "fabricator",
      4,
      7,
      Direction.North,
      { recipeId: "ironGear" },
    );
    fabricator.activeRecipeId = "ironGear";
    fabricator.recipeChangeQueued = true;
    fabricator.pendingRecipeId = "copperWire";
    const smelter = entity(
      "smelter",
      8,
      7,
      Direction.North,
      { recipeId: "smeltIron" },
    );
    smelter.activeRecipeId = "smeltIron";
    smelter.recipeChangeQueued = true;
    smelter.pendingRecipeId = undefined;

    const blueprint = captureBlueprint(
      [fabricator, smelter],
      { x: 4, y: 7, width: 6, height: 2 },
    );
    expect(
      blueprint.entities.find((entry) => entry.kind === "fabricator")
        ?.recipeId,
    ).toBe("copperWire");
    expect(
      blueprint.entities.find((entry) => entry.kind === "smelter")
        ?.recipeId,
    ).toBeNull();
  });
});

describe("exact blueprint transforms and placement plans", () => {
  it("rotates anchors and non-square footprints exactly through all four turns", () => {
    const original = captureBlueprint(
      [
        entity("fabricator", 10, 20, Direction.North, {
          recipeId: "automationCore",
        }),
        entity("belt", 14, 21, Direction.East),
      ],
      { x: 10, y: 20, width: 5, height: 2 },
    );
    const rotated = transformBlueprint(original, { quarterTurns: 1 });
    expect(rotated.width).toBe(2);
    expect(rotated.height).toBe(5);
    expect(rotated.entities).toEqual([
      {
        ref: 0,
        kind: "fabricator",
        x: 0,
        y: 0,
        direction: Direction.East,
        recipeId: "automationCore",
        manifoldRouting: null,
        fluidId: null,
        fluidRecipeId: null,
        circuitDevice: null,
        circuitMachine: EMPTY_CIRCUIT_MACHINE,
      },
      {
        ref: 1,
        kind: "belt",
        x: 0,
        y: 4,
        direction: Direction.South,
        recipeId: null,
        manifoldRouting: null,
        fluidId: null,
        fluidRecipeId: null,
        circuitDevice: null,
        circuitMachine: null,
      },
    ]);

    const plan = planBlueprintPlacement(
      original,
      { x: 100, y: 200 },
      { quarterTurns: 1 },
    );
    expect(plan).toEqual({
      width: 2,
      height: 5,
      placements: [
        {
          ref: 0,
          kind: "fabricator",
          x: 100,
          y: 200,
          direction: Direction.East,
          recipeId: "automationCore",
          manifoldRouting: null,
          fluidId: null,
          fluidRecipeId: null,
          circuitDevice: null,
          circuitMachine: EMPTY_CIRCUIT_MACHINE,
        },
        {
          ref: 1,
          kind: "belt",
          x: 100,
          y: 204,
          direction: Direction.South,
          recipeId: null,
          manifoldRouting: null,
          fluidId: null,
          fluidRecipeId: null,
          circuitDevice: null,
          circuitMachine: null,
        },
      ],
      wires: [],
      rail: EMPTY_RAIL,
    });
    expectDeepFrozen(plan);

    let fullTurn = original;
    for (let turn = 0; turn < 4; turn += 1) {
      fullTurn = transformBlueprint(fullTurn, { quarterTurns: 1 });
    }
    expect(serializeBlueprint(fullTurn)).toBe(serializeBlueprint(original));
  });

  it("mirrors directions and swaps representable manifold branch priority", () => {
    const original = captureBlueprint(
      [
        entity("manifold", 3, 4, Direction.North, {
          manifoldRouting: {
            mode: ManifoldMode.FavorA,
            extractPort: 1,
            splitCursors: [0, 1],
            mergeCursors: [0, 1],
          },
        }),
        entity("belt", 5, 5, Direction.East),
      ],
      { x: 3, y: 4, width: 3, height: 2 },
    );
    const mirrored = transformBlueprint(original, { mirror: "horizontal" });
    expect(mirrored.entities.find((entry) => entry.kind === "manifold")).toEqual({
      ref: 0,
      kind: "manifold",
      x: 2,
      y: 0,
      direction: Direction.North,
      recipeId: null,
      manifoldRouting: {
        mode: ManifoldMode.FavorB,
        filter: null,
        extractPort: 0,
      },
      fluidId: null,
      fluidRecipeId: null,
      circuitDevice: null,
      circuitMachine: EMPTY_CIRCUIT_MACHINE,
    });
    expect(mirrored.entities.find((entry) => entry.kind === "belt")!.direction)
      .toBe(Direction.West);
    expect(
      serializeBlueprint(
        transformBlueprint(mirrored, { mirror: "horizontal" }),
      ),
    ).toBe(serializeBlueprint(original));
  });

  it("mirrors an extract route onto the opposite local filter port exactly", () => {
    const extract = captureBlueprint(
      [
        entity("manifold", 0, 0, Direction.North, {
          manifoldRouting: {
            mode: ManifoldMode.Extract,
            filter: "copperOre",
            extractPort: 0,
            splitCursors: [0, 1],
            mergeCursors: [0, 1],
          },
        }),
      ],
      { x: 0, y: 0, width: 1, height: 2 },
    );
    const mirrored = transformBlueprint(extract, { mirror: "vertical" });
    expect(mirrored.entities[0]!.manifoldRouting).toEqual({
      mode: ManifoldMode.Extract,
      filter: "copperOre",
      extractPort: 1,
    });
    expect(
      serializeBlueprint(
        transformBlueprint(mirrored, { mirror: "vertical" }),
      ),
    ).toBe(serializeBlueprint(extract));
  });

  it("preserves and mirrors the latent Extract selector in non-Extract modes", () => {
    const even = captureBlueprint(
      [
        entity("manifold", 8, 5, Direction.West, {
          manifoldRouting: {
            mode: ManifoldMode.Even,
            extractPort: 1,
            splitCursors: [1, 0],
            mergeCursors: [0, 1],
          },
        }),
      ],
      { x: 8, y: 5, width: 2, height: 1 },
    );
    expect(even.entities[0]!.manifoldRouting).toEqual({
      mode: ManifoldMode.Even,
      filter: null,
      extractPort: 1,
    });
    const mirrored = transformBlueprint(even, { mirror: "horizontal" });
    expect(mirrored.entities[0]!.manifoldRouting).toEqual({
      mode: ManifoldMode.Even,
      filter: null,
      extractPort: 0,
    });
    expect(
      serializeBlueprint(
        transformBlueprint(mirrored, { mirror: "horizontal" }),
      ),
    ).toBe(serializeBlueprint(even));
  });
});

describe("hostile blueprint validation", () => {
  const valid = (): Record<string, unknown> =>
    deepMutable(
      captureBlueprint(
        [
          entity("belt", 0, 0, Direction.East),
          entity("fabricator", 1, 0, Direction.North, {
            recipeId: "circuit",
          }),
        ],
        { x: 0, y: 0, width: 4, height: 2 },
      ),
    );

  it("rejects wrong envelopes, unknown fields, unsafe numbers, and stale catalogs", () => {
    const malformed: Record<string, unknown>[] = [];
    const extra = valid();
    extra.__proto_pollution__ = true;
    malformed.push(extra);
    const format = valid();
    format.format = "other";
    malformed.push(format);
    const version = valid();
    version.version = 99;
    malformed.push(version);
    const catalog = valid();
    catalog.catalog = "stale-catalog";
    malformed.push(catalog);
    const negativeZero = valid();
    negativeZero.width = -0;
    malformed.push(negativeZero);
    const fractional = valid();
    fractional.height = 2.5;
    malformed.push(fractional);
    const unsafe = valid();
    unsafe.width = Number.MAX_SAFE_INTEGER + 1;
    malformed.push(unsafe);
    for (const candidate of malformed) {
      expect(() => restoreBlueprint(candidate)).toThrow();
    }
  });

  it("rejects malformed configuration, overlap, wrong bounds, and noncanonical order", () => {
    const unknownKind = valid();
    (unknownKind.entities as Record<string, unknown>[])[0]!.kind = "teleporter";
    expect(() => restoreBlueprint(unknownKind)).toThrow(/known entity kind/);

    const badDirection = valid();
    (badDirection.entities as Record<string, unknown>[])[0]!.direction = 4;
    expect(() => restoreBlueprint(badDirection)).toThrow(/direction/);

    const wrongRecipe = valid();
    (wrongRecipe.entities as Record<string, unknown>[])[0]!.recipeId =
      "circuit";
    expect(() => restoreBlueprint(wrongRecipe)).toThrow(/incompatible/);

    const wrongRouting = valid();
    (wrongRouting.entities as Record<string, unknown>[])[0]!.manifoldRouting = {
      mode: ManifoldMode.Even,
      filter: null,
    };
    expect(() => restoreBlueprint(wrongRouting)).toThrow(/only valid/);

    const manifold = deepMutable(
      captureBlueprint(
        [
          entity("manifold", 0, 0, Direction.North, {
            manifoldRouting: {
              mode: ManifoldMode.Extract,
              filter: "ironOre",
              extractPort: 0,
              splitCursors: [0, 1],
              mergeCursors: [0, 1],
            },
          }),
        ],
        { x: 0, y: 0, width: 1, height: 2 },
      ),
    );
    (
      (manifold.entities as Record<string, unknown>[])[0]!
        .manifoldRouting as Record<string, unknown>
    ).filter = null;
    expect(() => restoreBlueprint(manifold)).toThrow(/filter is required/);

    const overlap = valid();
    (overlap.entities as Record<string, unknown>[])[1]!.x = 0;
    expect(() => restoreBlueprint(overlap)).toThrow(/overlap/);

    const padded = valid();
    padded.width = 5;
    expect(() => restoreBlueprint(padded)).toThrow(/cropped/);

    const reordered = valid();
    (reordered.entities as unknown[]).reverse();
    expect(() => restoreBlueprint(reordered)).toThrow(
      /canonical array index|canonically ordered/,
    );

    const extraEntityKey = valid();
    (extraEntityKey.entities as Record<string, unknown>[])[0]!.inventory = {};
    expect(() => restoreBlueprint(extraEntityKey)).toThrow(/exactly/);
  });

  it("rejects accessors, exotic prototypes, symbols, and sparse arrays", () => {
    const accessor = valid();
    Object.defineProperty(accessor, "width", {
      enumerable: true,
      get: () => 4,
    });
    expect(() => restoreBlueprint(accessor)).toThrow(/data field/);

    const exotic = valid();
    Object.setPrototypeOf(exotic, { inherited: true });
    expect(() => restoreBlueprint(exotic)).toThrow(/plain prototype/);

    const symbolic = valid();
    symbolic[Symbol("hidden") as unknown as string] = true;
    expect(() => restoreBlueprint(symbolic)).toThrow(/symbol/);

    const sparse = valid();
    delete (sparse.entities as unknown[])[0];
    expect(() => restoreBlueprint(sparse)).toThrow(/dense/);
  });

  it("rejects duplicate and escape-equivalent JSON member names", () => {
    const bytes = serializeBlueprint(restoreBlueprint(valid()));
    const duplicate = bytes.replace(
      `"version":${BLUEPRINT_VERSION}`,
      `"version":${BLUEPRINT_VERSION},"version":${BLUEPRINT_VERSION}`,
    );
    const escaped = bytes.replace(
      `"version":${BLUEPRINT_VERSION}`,
      `"version":${BLUEPRINT_VERSION},"ver\\u0073ion":${BLUEPRINT_VERSION}`,
    );
    expect(() => restoreBlueprint(duplicate)).toThrow(/duplicate member/);
    expect(() => restoreBlueprint(escaped)).toThrow(/duplicate member/);
  });

  it("rejects hostile target and transform records before planning", () => {
    const blueprint = restoreBlueprint(valid());
    expect(() =>
      planBlueprintPlacement(
        blueprint,
        { x: Number.MAX_SAFE_INTEGER, y: 0 },
      ),
    ).toThrow(/safe tile-coordinate|right edge/);
    expect(() =>
      planBlueprintPlacement(
        blueprint,
        { x: 0, y: Number.MAX_SAFE_INTEGER },
      ),
    ).toThrow(/safe tile-coordinate|bottom edge/);
    expect(() =>
      transformBlueprint(blueprint, { quarterTurns: 4 as 0 }),
    ).toThrow(/quarterTurns/);
    expect(() =>
      transformBlueprint(
        blueprint,
        { mirror: "diagonal" as "horizontal" },
      ),
    ).toThrow(/mirror/);
    expect(() =>
      transformBlueprint(
        blueprint,
        { quarterTurns: -0 as 0 },
      ),
    ).toThrow(/quarterTurns/);
    expect(() =>
      transformBlueprint(
        blueprint,
        { quarterTurns: null as unknown as 0 },
      ),
    ).toThrow(/quarterTurns/);
  });

  it("rejects negative-zero directions and parser complexity bombs canonically", () => {
    const negativeDirection = valid();
    (negativeDirection.entities as Record<string, unknown>[])[0]!.direction =
      -0;
    expect(() => restoreBlueprint(negativeDirection)).toThrow(/direction/);

    const bytes = serializeBlueprint(restoreBlueprint(valid()));
    const jsonNegativeDirection = bytes.replace(
      `"direction":${Direction.East}`,
      "\"direction\":-0",
    );
    expect(() => restoreBlueprint(jsonNegativeDirection)).toThrow(/direction/);

    const oversizedObject = `{${Array.from(
      { length: 65 },
      (_, index) => `"k${index}":0`,
    ).join(",")}}`;
    expect(() => restoreBlueprint(oversizedObject)).toThrow(
      /maximum object member count/,
    );

    const deep = "[".repeat(65) + "0" + "]".repeat(65);
    expect(() => restoreBlueprint(deep)).toThrow(/maximum nesting depth/);
  });

  it("strictly migrates canonical v1 routing to v3 without changing intent", () => {
    const current = captureBlueprint(
      [
        entity("manifold", 0, 0, Direction.North, {
          manifoldRouting: {
            mode: ManifoldMode.Extract,
            filter: "copperOre",
            extractPort: 1,
            splitCursors: [0, 1],
            mergeCursors: [1, 0],
          },
        }),
        entity("manifold", 2, 0, Direction.North, {
          manifoldRouting: {
            mode: ManifoldMode.FavorA,
            extractPort: 0,
            splitCursors: [1, 0],
            mergeCursors: [0, 1],
          },
        }),
      ],
      { x: 0, y: 0, width: 3, height: 2 },
    );
    const legacy = deepMutable(current);
    legacy.version = 1;
    delete legacy.wires;
    delete legacy.rail;
    for (const candidate of legacy.entities as Record<string, unknown>[]) {
      const routing = candidate.manifoldRouting as Record<string, unknown>;
      delete routing.extractPort;
      delete candidate.ref;
      delete candidate.fluidId;
      delete candidate.fluidRecipeId;
      delete candidate.circuitDevice;
      delete candidate.circuitMachine;
    }

    const fromObject = restoreBlueprint(legacy);
    const fromBytes = restoreBlueprint(JSON.stringify(legacy));
    expect(fromObject.version).toBe(BLUEPRINT_VERSION);
    expect(fromObject.entities[0]!.manifoldRouting).toEqual({
      mode: ManifoldMode.Extract,
      filter: "copperOre",
      extractPort: 0,
    });
    expect(fromObject.entities[1]!.manifoldRouting).toEqual({
      mode: ManifoldMode.FavorA,
      filter: null,
      extractPort: 0,
    });
    expect(fromBytes).toEqual(fromObject);
    expect(serializeBlueprint(restoreBlueprint(serializeBlueprint(fromObject))))
      .toBe(serializeBlueprint(fromObject));

    const mirrored = transformBlueprint(fromObject, {
      mirror: "horizontal",
    });
    const extract = mirrored.entities.find(
      (candidate) =>
        candidate.manifoldRouting?.mode === ManifoldMode.Extract,
    );
    expect(extract!.manifoldRouting!.extractPort).toBe(1);

    const v1WithV2Field = JSON.parse(JSON.stringify(legacy)) as Record<
      string,
      unknown
    >;
    (
      (v1WithV2Field.entities as Record<string, unknown>[])[0]!
        .manifoldRouting as Record<string, unknown>
    ).extractPort = 0;
    expect(() => restoreBlueprint(v1WithV2Field)).toThrow(/exactly/);
  });

  it("rejects noncanonical v2 routing fields instead of normalizing them", () => {
    const blueprint = deepMutable(
      captureBlueprint(
        [
          entity("manifold", 0, 0, Direction.North, {
            manifoldRouting: {
              mode: ManifoldMode.Extract,
              filter: "ironOre",
              extractPort: 0,
              splitCursors: [0, 1],
              mergeCursors: [0, 1],
            },
          }),
        ],
        { x: 0, y: 0, width: 1, height: 2 },
      ),
    );
    const routing = (
      (blueprint.entities as Record<string, unknown>[])[0]!
        .manifoldRouting as Record<string, unknown>
    );

    const nullPort = JSON.parse(JSON.stringify(blueprint)) as Record<
      string,
      unknown
    >;
    (
      (nullPort.entities as Record<string, unknown>[])[0]!
        .manifoldRouting as Record<string, unknown>
    ).extractPort = null;
    expect(() => restoreBlueprint(nullPort)).toThrow(/extractPort/);

    delete routing.extractPort;
    expect(() => restoreBlueprint(blueprint)).toThrow(/exactly/);

    const undefinedFilter = deepMutable(
      captureBlueprint(
        [
          entity("manifold", 0, 0, Direction.North, {
            manifoldRouting: {
              mode: ManifoldMode.Even,
              extractPort: 0,
              splitCursors: [0, 1],
              mergeCursors: [0, 1],
            },
          }),
        ],
        { x: 0, y: 0, width: 1, height: 2 },
      ),
    );
    (
      (undefinedFilter.entities as Record<string, unknown>[])[0]!
        .manifoldRouting as Record<string, unknown>
    ).filter = undefined;
    expect(() => restoreBlueprint(undefinedFilter)).toThrow(/filter/);

    const negativePort = deepMutable(
      captureBlueprint(
        [
          entity("manifold", 0, 0, Direction.North, {
            manifoldRouting: {
              mode: ManifoldMode.Extract,
              filter: "ironOre",
              extractPort: 0,
              splitCursors: [0, 1],
              mergeCursors: [0, 1],
            },
          }),
        ],
        { x: 0, y: 0, width: 1, height: 2 },
      ),
    );
    (
      (negativePort.entities as Record<string, unknown>[])[0]!
        .manifoldRouting as Record<string, unknown>
    ).extractPort = -0;
    expect(() => restoreBlueprint(negativePort)).toThrow(/extractPort/);

    const negativePortBytes = serializeBlueprint(
      captureBlueprint(
        [
          entity("manifold", 0, 0, Direction.North, {
            manifoldRouting: {
              mode: ManifoldMode.Extract,
              filter: "ironOre",
              extractPort: 0,
              splitCursors: [0, 1],
              mergeCursors: [0, 1],
            },
          }),
        ],
        { x: 0, y: 0, width: 1, height: 2 },
      ),
    ).replace('"extractPort":0', '"extractPort":-0');
    expect(() => restoreBlueprint(negativePortBytes)).toThrow(/extractPort/);
  });

  it("rejects impossible queued capture intent", () => {
    const fabricator = entity(
      "fabricator",
      0,
      0,
      Direction.North,
      { recipeId: "ironGear" },
    );
    fabricator.recipeChangeQueued = true;
    fabricator.pendingRecipeId = undefined;
    expect(() =>
      captureBlueprint(
        [fabricator],
        { x: 0, y: 0, width: 2, height: 2 },
      ),
    ).toThrow(/pendingRecipeId/);

    const belt = entity("belt", 0, 0, Direction.East);
    belt.recipeChangeQueued = true;
    expect(() =>
      captureBlueprint(
        [belt],
        { x: 0, y: 0, width: 1, height: 1 },
      ),
    ).toThrow(/only valid for a recipe machine/);
  });
});

describe("blueprint limits and scale", () => {
  it("round-trips and transforms the maximum 64x64 belt blueprint deterministically", () => {
    const source: EntityState[] = [];
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        source.push(
          entity(
            "belt",
            10_000 + x,
            -20_000 + y,
            ((x + y) % 4) as Direction,
          ),
        );
      }
    }
    expect(source).toHaveLength(MAX_BLUEPRINT_ENTITIES);
    const blueprint = captureBlueprint(source.reverse(), {
      x: 10_000,
      y: -20_000,
      width: 64,
      height: 64,
    });
    const bytes = serializeBlueprint(blueprint);
    expect(bytes.length).toBeGreaterThan(650_000);
    expect(bytes.length).toBeLessThanOrEqual(MAX_BLUEPRINT_JSON_LENGTH);
    const restored = restoreBlueprint(bytes);
    const rotated = transformBlueprint(restored, { quarterTurns: 3 });
    expect(rotated.entities).toHaveLength(MAX_BLUEPRINT_ENTITIES);
    expect(rotated.width).toBe(64);
    expect(rotated.height).toBe(64);
    expect(serializeBlueprint(restoreBlueprint(bytes))).toBe(bytes);
  });

  it("enforces entity and capture-candidate limits", () => {
    const tooMany = Array.from(
      { length: MAX_BLUEPRINT_ENTITIES + 1 },
      (_, index) => entity("belt", index % 65, Math.floor(index / 65)),
    );
    expect(() =>
      captureBlueprint(tooMany, {
        x: 0,
        y: 0,
        width: 65,
        height: 64,
      }),
    ).toThrow(/4096 entities/);

    const encoded = deepMutable(
      captureBlueprint(
        [entity("belt", 0, 0)],
        { x: 0, y: 0, width: 1, height: 1 },
      ),
    );
    encoded.entities = Array.from(
      { length: MAX_BLUEPRINT_ENTITIES + 1 },
      () => (encoded.entities as unknown[])[0],
    );
    expect(() => restoreBlueprint(encoded)).toThrow(/limit/);

    const tooManyCandidates = new Array<EntityState>(
      MAX_BLUEPRINT_CAPTURE_CANDIDATES + 1,
    ).fill(entity("belt", 0, 0));
    expect(() =>
      captureBlueprint(tooManyCandidates, {
        x: 10,
        y: 10,
        width: 1,
        height: 1,
      }),
    ).toThrow(/capture candidates.*limit/i);
  });
});
