import { describe, expect, it } from "vitest";

import {
  BLUEPRINT_LIBRARY_FORMAT,
  BLUEPRINT_LIBRARY_VERSION,
  LEGACY_BLUEPRINT_LIBRARY_VERSION,
  MAX_BLUEPRINT_LIBRARY_BOOK_DEPTH,
  MAX_BLUEPRINT_LIBRARY_DESCRIPTION_LENGTH,
  MAX_BLUEPRINT_LIBRARY_ENTITIES,
  MAX_BLUEPRINT_LIBRARY_ICONS,
  MAX_BLUEPRINT_LIBRARY_JSON_ARRAY_ITEMS,
  MAX_BLUEPRINT_LIBRARY_JSON_BYTES,
  MAX_BLUEPRINT_LIBRARY_JSON_DEPTH,
  MAX_BLUEPRINT_LIBRARY_NAME_LENGTH,
  MAX_BLUEPRINT_LIBRARY_RECORDS,
  BlueprintLibraryOperationError,
  BlueprintLibraryOperationErrorCode,
  createBlueprintLibrary,
  createBlueprintLibraryEntry,
  deleteBlueprintLibraryEntry,
  duplicateBlueprintLibraryEntry,
  moveBlueprintLibraryEntry,
  restoreBlueprintLibrary,
  selectBlueprintLibraryEntry,
  serializeBlueprintLibrary,
  updateBlueprintLibraryEntry,
  type BlueprintLibrary,
  type BlueprintLibraryEntryDraft,
} from "../src/game/blueprintLibrary";
import {
  BLUEPRINT_FORMAT,
  BLUEPRINT_VERSION,
  MAX_BLUEPRINT_ENTITIES,
  restoreBlueprint,
  serializeBlueprint,
  type Blueprint,
} from "../src/game/blueprints";
import { CATALOG_VERSION } from "../src/game/catalog";
import { Direction } from "../src/game/types";

const EMPTY_BLUEPRINT = restoreBlueprint({
  format: BLUEPRINT_FORMAT,
  version: BLUEPRINT_VERSION,
  catalog: CATALOG_VERSION,
  width: 0,
  height: 0,
  entities: [],
  wires: [],
  rail: {
    segments: [],
    signals: [],
    stations: [],
    trains: [],
  },
});

function blueprintDraft(
  id: string,
  name = `Blueprint ${id}`,
  blueprint: Blueprint = EMPTY_BLUEPRINT,
): BlueprintLibraryEntryDraft {
  return {
    kind: "blueprint",
    id,
    name,
    description: "",
    icons: [],
    blueprint,
  };
}

function bookDraft(
  id: string,
  name = `Book ${id}`,
): BlueprintLibraryEntryDraft {
  return {
    kind: "book",
    id,
    name,
    description: "",
    icons: [],
  };
}

function operationCode(
  operation: () => unknown,
): string | undefined {
  try {
    operation();
  } catch (error) {
    return error instanceof BlueprintLibraryOperationError
      ? error.code
      : undefined;
  }
  return undefined;
}

function currentRawLibrary(
  entries: unknown[] = [],
  selectedId: string | null = null,
): Record<string, unknown> {
  return {
    format: BLUEPRINT_LIBRARY_FORMAT,
    version: BLUEPRINT_LIBRARY_VERSION,
    catalog: CATALOG_VERSION,
    selectedId,
    entries,
  };
}

function currentRawBlueprintEntry(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "blueprint",
    id,
    name: `Blueprint ${id}`,
    description: "",
    icons: [],
    blueprint: EMPTY_BLUEPRINT,
    ...overrides,
  };
}

describe("blueprint library canonical records", () => {
  it("creates ordered immutable records and emits one byte-stable representation", () => {
    const empty = createBlueprintLibrary();
    const withBook = createBlueprintLibraryEntry(
      empty,
      null,
      0,
      {
        ...bookDraft("smelting"),
        name: "Smelting 🏭",
        description: "Hot-side production\nRevision A",
        icons: [
          { type: "entity", id: "smelter" },
          { type: "item", id: "ironPlate" },
        ],
      },
    );
    const library = createBlueprintLibraryEntry(
      withBook,
      "smelting",
      0,
      blueprintDraft("iron-line", "Iron line"),
    );
    const selected = selectBlueprintLibraryEntry(library, "iron-line");
    const bytes = serializeBlueprintLibrary(selected);
    const restored = restoreBlueprintLibrary(bytes);

    expect(restored).toEqual(selected);
    expect(serializeBlueprintLibrary(restored)).toBe(bytes);
    expect(serializeBlueprintLibrary(restoreBlueprintLibrary(bytes))).toBe(
      bytes,
    );
    expect(bytes.startsWith(
      `{"format":"${BLUEPRINT_LIBRARY_FORMAT}","version":${BLUEPRINT_LIBRARY_VERSION},`,
    )).toBe(true);
    expect(bytes).toContain(
      `"blueprint":${serializeBlueprint(EMPTY_BLUEPRINT)}`,
    );
    expect(restored.selectedId).toBe("iron-line");
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored.entries)).toBe(true);
    const book = restored.entries[0];
    expect(book?.kind).toBe("book");
    if (book?.kind !== "book") throw new Error("Expected book fixture.");
    expect(Object.isFrozen(book)).toBe(true);
    expect(Object.isFrozen(book.entries)).toBe(true);
    expect(Object.isFrozen(book.icons)).toBe(true);
    expect(Object.isFrozen(book.icons[0])).toBe(true);
    const nestedBlueprint = book.entries[0];
    if (nestedBlueprint?.kind !== "blueprint") {
      throw new Error("Expected nested blueprint fixture.");
    }
    expect(Object.isFrozen(nestedBlueprint.blueprint)).toBe(true);
    expect(empty.entries).toEqual([]);
  });

  it("retains caller order instead of sorting names or ids", () => {
    let library = createBlueprintLibrary();
    for (const [index, id] of ["z-last", "a-first", "m-mid"].entries()) {
      library = createBlueprintLibraryEntry(
        library,
        null,
        index,
        blueprintDraft(id),
      );
    }
    expect(library.entries.map((entry) => entry.id)).toEqual([
      "z-last",
      "a-first",
      "m-mid",
    ]);
    const moved = moveBlueprintLibraryEntry(
      library,
      "z-last",
      null,
      2,
    );
    expect(moved.entries.map((entry) => entry.id)).toEqual([
      "a-first",
      "m-mid",
      "z-last",
    ]);
    expect(library.entries.map((entry) => entry.id)).toEqual([
      "z-last",
      "a-first",
      "m-mid",
    ]);
  });

  it("migrates only the documented v1 icon and description fields", () => {
    const legacy = {
      format: BLUEPRINT_LIBRARY_FORMAT,
      version: LEGACY_BLUEPRINT_LIBRARY_VERSION,
      catalog: CATALOG_VERSION,
      selectedId: "legacy-blueprint",
      entries: [
        {
          kind: "book",
          id: "legacy-book",
          name: "Legacy book",
          icon: null,
          entries: [
            {
              kind: "blueprint",
              id: "legacy-blueprint",
              name: "Legacy blueprint",
              icon: { type: "item", id: "ironOre" },
              blueprint: EMPTY_BLUEPRINT,
            },
          ],
        },
      ],
    };
    const migrated = restoreBlueprintLibrary(legacy);
    const book = migrated.entries[0];
    if (book?.kind !== "book") throw new Error("Expected migrated book.");
    const blueprint = book.entries[0];
    expect(migrated.version).toBe(BLUEPRINT_LIBRARY_VERSION);
    expect(book.description).toBe("");
    expect(book.icons).toEqual([]);
    expect(blueprint?.description).toBe("");
    expect(blueprint?.icons).toEqual([{ type: "item", id: "ironOre" }]);
    const bytes = serializeBlueprintLibrary(migrated);
    expect(bytes).toContain(`"version":${BLUEPRINT_LIBRARY_VERSION}`);
    expect(bytes).not.toContain('"icon":');
    expect(restoreBlueprintLibrary(bytes)).toEqual(migrated);
  });

  it("accepts permuted object properties but canonicalizes export order", () => {
    const raw = {
      entries: [
        {
          blueprint: EMPTY_BLUEPRINT,
          icons: [{ id: "belt", type: "entity" }],
          description: "Exact",
          name: "Permutation",
          id: "permuted",
          kind: "blueprint",
        },
      ],
      selectedId: null,
      catalog: CATALOG_VERSION,
      version: BLUEPRINT_LIBRARY_VERSION,
      format: BLUEPRINT_LIBRARY_FORMAT,
    };
    const canonical = serializeBlueprintLibrary(
      restoreBlueprintLibrary(raw),
    );
    expect(canonical).toBe(
      serializeBlueprintLibrary(
        restoreBlueprintLibrary(JSON.stringify(raw)),
      ),
    );
    expect(canonical.indexOf('"kind"')).toBeLessThan(
      canonical.indexOf('"name"'),
    );
    expect(canonical.indexOf('"description"')).toBeLessThan(
      canonical.indexOf('"icons"'),
    );
  });
});

describe("blueprint library pure operations", () => {
  it("updates, duplicates nested books, moves, selects, and deletes without mutation", () => {
    const empty = createBlueprintLibrary();
    let library = createBlueprintLibraryEntry(
      empty,
      null,
      0,
      bookDraft("source-book"),
    );
    library = createBlueprintLibraryEntry(
      library,
      "source-book",
      0,
      blueprintDraft("source-blueprint"),
    );
    library = createBlueprintLibraryEntry(
      library,
      null,
      1,
      blueprintDraft("loose"),
    );
    const beforeUpdate = library;
    library = updateBlueprintLibraryEntry(
      library,
      "source-blueprint",
      {
        name: "Updated line",
        description: "Exact metadata",
        icons: [
          { type: "item", id: "copperPlate" },
          { type: "entity", id: "inserter" },
        ],
      },
    );
    expect(beforeUpdate.entries[0]).not.toBe(library.entries[0]);
    const beforeDuplicate = library;
    library = duplicateBlueprintLibraryEntry(
      library,
      "source-book",
      ["copy-book", "copy-blueprint"],
      null,
      2,
    );
    expect(library.entries.map((entry) => entry.id)).toEqual([
      "source-book",
      "loose",
      "copy-book",
    ]);
    const copy = library.entries[2];
    if (copy?.kind !== "book") throw new Error("Expected copied book.");
    expect(copy.entries.map((entry) => entry.id)).toEqual(["copy-blueprint"]);
    expect(copy.entries[0]?.name).toBe("Updated line");
    expect(copy.entries[0]?.name).toBe(
      (library.entries[0] as { entries: readonly { name: string }[] })
        .entries[0]?.name,
    );
    expect(beforeDuplicate.entries).toHaveLength(2);

    library = moveBlueprintLibraryEntry(
      library,
      "loose",
      "copy-book",
      1,
    );
    const movedCopy = library.entries[1];
    if (movedCopy?.kind !== "book") throw new Error("Expected moved book.");
    expect(movedCopy.entries.map((entry) => entry.id)).toEqual([
      "copy-blueprint",
      "loose",
    ]);

    library = selectBlueprintLibraryEntry(library, "source-blueprint");
    expect(library.selectedId).toBe("source-blueprint");
    library = deleteBlueprintLibraryEntry(library, "source-book");
    expect(library.selectedId).toBeNull();
    expect(library.entries.map((entry) => entry.id)).toEqual(["copy-book"]);
    expect(empty.entries).toEqual([]);
  });

  it("requires explicit caller identities for every duplicated subtree record", () => {
    let library = createBlueprintLibraryEntry(
      createBlueprintLibrary(),
      null,
      0,
      bookDraft("book"),
    );
    library = createBlueprintLibraryEntry(
      library,
      "book",
      0,
      blueprintDraft("child"),
    );
    expect(
      operationCode(() =>
        duplicateBlueprintLibraryEntry(
          library,
          "book",
          ["copy-only"],
          null,
          1,
        ),
      ),
    ).toBe(BlueprintLibraryOperationErrorCode.DuplicateIdCount);
    expect(
      operationCode(() =>
        duplicateBlueprintLibraryEntry(
          library,
          "book",
          ["copy", "copy"],
          null,
          1,
        ),
      ),
    ).toBe(BlueprintLibraryOperationErrorCode.DuplicateId);
    expect(
      operationCode(() =>
        duplicateBlueprintLibraryEntry(
          library,
          "book",
          ["book", "copy-child"],
          null,
          1,
        ),
      ),
    ).toBe(BlueprintLibraryOperationErrorCode.DuplicateId);
    expect(library.entries).toHaveLength(1);
  });

  it("reports semantic failures with stable explicit error codes", () => {
    let library = createBlueprintLibraryEntry(
      createBlueprintLibrary(),
      null,
      0,
      blueprintDraft("blueprint"),
    );
    library = createBlueprintLibraryEntry(
      library,
      null,
      1,
      bookDraft("book"),
    );
    library = createBlueprintLibraryEntry(
      library,
      "book",
      0,
      bookDraft("child-book"),
    );
    expect(
      operationCode(() =>
        createBlueprintLibraryEntry(
          library,
          null,
          2,
          blueprintDraft("blueprint"),
        ),
      ),
    ).toBe(BlueprintLibraryOperationErrorCode.DuplicateId);
    expect(
      operationCode(() =>
        createBlueprintLibraryEntry(
          library,
          "missing",
          0,
          blueprintDraft("new"),
        ),
      ),
    ).toBe(BlueprintLibraryOperationErrorCode.ParentNotFound);
    expect(
      operationCode(() =>
        createBlueprintLibraryEntry(
          library,
          "blueprint",
          0,
          blueprintDraft("new"),
        ),
      ),
    ).toBe(BlueprintLibraryOperationErrorCode.ParentNotBook);
    expect(
      operationCode(() =>
        moveBlueprintLibraryEntry(
          library,
          "book",
          "child-book",
          0,
        ),
      ),
    ).toBe(BlueprintLibraryOperationErrorCode.MoveCycle);
    expect(
      operationCode(() =>
        updateBlueprintLibraryEntry(library, "book", {
          blueprint: EMPTY_BLUEPRINT,
        }),
      ),
    ).toBe(BlueprintLibraryOperationErrorCode.WrongEntryKind);
    expect(
      operationCode(() =>
        updateBlueprintLibraryEntry(library, "book", {}),
      ),
    ).toBe(BlueprintLibraryOperationErrorCode.EmptyUpdate);
    expect(
      operationCode(() =>
        deleteBlueprintLibraryEntry(library, "missing"),
      ),
    ).toBe(BlueprintLibraryOperationErrorCode.EntryNotFound);
    expect(
      operationCode(() =>
        moveBlueprintLibraryEntry(library, "blueprint", null, -0),
      ),
    ).toBe(BlueprintLibraryOperationErrorCode.InvalidIndex);
  });

  it("preserves deterministic state through property-style operation sequences", () => {
    let state = 0x6d2b79f5;
    const random = (): number => {
      state = Math.imul(state ^ (state >>> 15), 1 | state);
      state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
      return ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296;
    };
    let library = createBlueprintLibrary();
    for (let index = 0; index < 96; index += 1) {
      const insertion = Math.floor(random() * (library.entries.length + 1));
      library = createBlueprintLibraryEntry(
        library,
        null,
        insertion,
        {
          ...blueprintDraft(`record-${String(index).padStart(3, "0")}`),
          name: `Cell ${index} Ω`,
          description: `Seed ${Math.floor(random() * 1_000_000)}`,
          icons:
            index % 3 === 0
              ? [{ type: "entity", id: "belt" }]
              : [],
        },
      );
      const bytes = serializeBlueprintLibrary(library);
      expect(serializeBlueprintLibrary(restoreBlueprintLibrary(bytes))).toBe(
        bytes,
      );
    }
    expect(library.entries).toHaveLength(96);
    expect(new Set(library.entries.map((entry) => entry.id)).size).toBe(96);
  });
});

describe("blueprint library metadata and structure validation", () => {
  it("requires canonical stable caller ids and NFC bounded text", () => {
    const attempts: BlueprintLibraryEntryDraft[] = [
      blueprintDraft("Uppercase"),
      blueprintDraft("-leading"),
      blueprintDraft("space id"),
      { ...blueprintDraft("decomposed"), name: "Cafe\u0301" },
      {
        ...blueprintDraft("long-name"),
        name: "x".repeat(MAX_BLUEPRINT_LIBRARY_NAME_LENGTH + 1),
      },
      { ...blueprintDraft("surrogate"), name: "\ud800" },
      { ...blueprintDraft("control"), name: "Bad\u0000name" },
      { ...blueprintDraft("line-separator"), name: "Bad\u2028name" },
      { ...blueprintDraft("paragraph-separator"), name: "Bad\u2029name" },
      { ...blueprintDraft("padded"), name: " Padded" },
      { ...blueprintDraft("unicode-padded"), name: "\u00a0Padded" },
      {
        ...blueprintDraft("long-description"),
        description: "x".repeat(
          MAX_BLUEPRINT_LIBRARY_DESCRIPTION_LENGTH + 1,
        ),
      },
      {
        ...blueprintDraft("description-line-separator"),
        description: "Bad\u2028description",
      },
      {
        ...blueprintDraft("description-paragraph-separator"),
        description: "Bad\u2029description",
      },
    ];
    for (const draft of attempts) {
      expect(() =>
        createBlueprintLibraryEntry(
          createBlueprintLibrary(),
          null,
          0,
          draft,
        ),
      ).toThrow();
    }
    const valid = createBlueprintLibraryEntry(
      createBlueprintLibrary(),
      null,
      0,
      {
        ...blueprintDraft("line:01_alpha.beta"),
        name: "Café 🚂",
        description: "Line one\n\tLine two",
      },
    );
    expect(valid.entries[0]?.name).toBe("Café 🚂");
  });

  it("accepts 0–4 unique catalog icons and rejects malformed icon state", () => {
    const icons = [
      { type: "item", id: "ironOre" },
      { type: "entity", id: "extractor" },
      { type: "item", id: "ironPlate" },
      { type: "entity", id: "storage" },
    ] as const;
    const valid = createBlueprintLibraryEntry(
      createBlueprintLibrary(),
      null,
      0,
      { ...blueprintDraft("icons"), icons },
    );
    expect(valid.entries[0]?.icons).toEqual(icons);
    expect(icons).toHaveLength(MAX_BLUEPRINT_LIBRARY_ICONS);

    const invalidIcons: unknown[] = [
      [...icons, { type: "item", id: "coal" }],
      [
        { type: "item", id: "coal" },
        { type: "item", id: "coal" },
      ],
      [{ type: "item", id: "not-an-item" }],
      [{ type: "entity", id: "not-an-entity" }],
      [{ type: "recipe", id: "ironGear" }],
      [{ type: "item", id: "coal", extra: true }],
    ];
    for (const candidate of invalidIcons) {
      expect(() =>
        createBlueprintLibraryEntry(
          createBlueprintLibrary(),
          null,
          0,
          { ...blueprintDraft("bad-icons"), icons: candidate } as never,
        ),
      ).toThrow();
    }
  });

  it("allows six nested books and rejects the seventh atomically", () => {
    let library = createBlueprintLibrary();
    let parentId: string | null = null;
    for (let depth = 1; depth <= MAX_BLUEPRINT_LIBRARY_BOOK_DEPTH; depth += 1) {
      const id = `book-${depth}`;
      library = createBlueprintLibraryEntry(
        library,
        parentId,
        0,
        bookDraft(id),
      );
      parentId = id;
    }
    const before = serializeBlueprintLibrary(library);
    expect(() =>
      createBlueprintLibraryEntry(
        library,
        parentId,
        0,
        bookDraft("too-deep"),
      ),
    ).toThrow(/depth/);
    expect(serializeBlueprintLibrary(library)).toBe(before);

    const withDestination = createBlueprintLibraryEntry(
      library,
      null,
      1,
      bookDraft("destination"),
    );
    expect(() =>
      moveBlueprintLibraryEntry(
        withDestination,
        "book-1",
        "destination",
        0,
      ),
    ).toThrow(/depth/);
    expect(() =>
      duplicateBlueprintLibraryEntry(
        withDestination,
        "book-1",
        Array.from(
          { length: MAX_BLUEPRINT_LIBRARY_BOOK_DEPTH },
          (_, index) => `deep-copy-${index + 1}`,
        ),
        "destination",
        0,
      ),
    ).toThrow(/depth/);
  });

  it("delegates every embedded construction payload to the blueprint kernel", () => {
    const invalid = {
      ...EMPTY_BLUEPRINT,
      entities: [],
      runtimeTick: 99,
    };
    expect(() =>
      restoreBlueprintLibrary(
        currentRawLibrary([
          currentRawBlueprintEntry("invalid-blueprint", {
            blueprint: invalid,
          }),
        ]),
      ),
    ).toThrow(/Blueprint.*(?:exactly|unknown field)/i);
    expect(() =>
      restoreBlueprintLibrary(
        currentRawLibrary([
          currentRawBlueprintEntry("string-blueprint", {
            blueprint: serializeBlueprint(EMPTY_BLUEPRINT),
          }),
        ]),
      ),
    ).toThrow(/embedded blueprint record/);

    const canonical = restoreBlueprintLibrary(
      currentRawLibrary([
        currentRawBlueprintEntry("valid-blueprint"),
      ]),
    );
    const entry = canonical.entries[0];
    if (entry?.kind !== "blueprint") throw new Error("Expected blueprint.");
    expect(serializeBlueprint(entry.blueprint)).toBe(
      serializeBlueprint(EMPTY_BLUEPRINT),
    );
    expect(Object.keys(entry)).toEqual([
      "kind",
      "id",
      "name",
      "description",
      "icons",
      "blueprint",
    ]);
  });
});

describe("hostile blueprint library import", () => {
  it("captures brand intrinsics so WeakSet tampering cannot forge validation", () => {
    const originalHas = WeakSet.prototype.has;
    const originalAdd = WeakSet.prototype.add;
    let forgedError: unknown;
    let nestedError: unknown;
    let created: BlueprintLibrary | undefined;
    WeakSet.prototype.has = (() => true) as typeof WeakSet.prototype.has;
    WeakSet.prototype.add = (() => {
      throw new Error("poisoned WeakSet.add");
    }) as typeof WeakSet.prototype.add;
    try {
      try {
        restoreBlueprintLibrary({
          format: "evil",
          version: 999,
          catalog: "stale",
          selectedId: "missing",
          entries: "not-an-array",
        });
      } catch (error) {
        forgedError = error;
      }
      try {
        restoreBlueprintLibrary(
          currentRawLibrary([
            currentRawBlueprintEntry("nested-forgery", {
              blueprint: {
                format: "evil-blueprint",
                version: 999,
                catalog: "stale",
                width: 0,
                height: 0,
                entities: [],
              },
            }),
          ]),
        );
      } catch (error) {
        nestedError = error;
      }
      created = createBlueprintLibrary();
    } finally {
      WeakSet.prototype.has = originalHas;
      WeakSet.prototype.add = originalAdd;
    }
    expect(forgedError).toBeInstanceOf(TypeError);
    expect(nestedError).toBeInstanceOf(TypeError);
    expect(String(nestedError)).toContain("intrinsics are altered");
    expect(created?.format).toBe(BLUEPRINT_LIBRARY_FORMAT);
    expect(created?.entries).toEqual([]);
  });

  it("uses indexed array paths when mutable Array intrinsics are poisoned", () => {
    let library = createBlueprintLibraryEntry(
      createBlueprintLibrary(),
      null,
      0,
      blueprintDraft("original"),
    );
    const originalIterator = Array.prototype[Symbol.iterator];
    const originalMap = Array.prototype.map;
    const originalPush = Array.prototype.push;
    const originalSome = Array.prototype.some;
    const originalSplice = Array.prototype.splice;
    const poisoned = (): never => {
      throw new Error("poisoned mutable Array intrinsic");
    };
    Array.prototype[Symbol.iterator] = (function* () {
      return undefined;
    }) as typeof Array.prototype[typeof Symbol.iterator];
    Array.prototype.map = poisoned as typeof Array.prototype.map;
    Array.prototype.push = poisoned as typeof Array.prototype.push;
    Array.prototype.some = poisoned as typeof Array.prototype.some;
    Array.prototype.splice = poisoned as typeof Array.prototype.splice;
    try {
      library = createBlueprintLibraryEntry(
        library,
        null,
        1,
        blueprintDraft("added"),
      );
      library = moveBlueprintLibraryEntry(
        library,
        "original",
        null,
        1,
      );
      library = duplicateBlueprintLibraryEntry(
        library,
        "added",
        ["copy"],
        null,
        2,
      );
      library = selectBlueprintLibraryEntry(library, "copy");
      library = deleteBlueprintLibraryEntry(library, "added");
    } finally {
      Array.prototype[Symbol.iterator] = originalIterator;
      Array.prototype.map = originalMap;
      Array.prototype.push = originalPush;
      Array.prototype.some = originalSome;
      Array.prototype.splice = originalSplice;
    }
    expect(library.entries.map((entry) => entry.id)).toEqual([
      "original",
      "copy",
    ]);
    expect(library.selectedId).toBe("copy");
    expect(serializeBlueprintLibrary(restoreBlueprintLibrary(library))).toBe(
      serializeBlueprintLibrary(library),
    );
  });

  it("defines own array cells when inherited numeric setters are poisoned", () => {
    const original = createBlueprintLibraryEntry(
      createBlueprintLibrary(),
      null,
      0,
      blueprintDraft("original"),
    );
    const previous = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    let result: BlueprintLibrary | undefined;
    let operationError: unknown;
    Object.defineProperty(Array.prototype, "0", {
      configurable: true,
      get() {
        return undefined;
      },
      set() {
        // Deliberately discard ordinary indexed assignment.
      },
    });
    try {
      try {
        result = createBlueprintLibraryEntry(
          original,
          null,
          1,
          blueprintDraft("added"),
        );
      } catch (error) {
        operationError = error;
      }
    } finally {
      if (previous) {
        Object.defineProperty(Array.prototype, "0", previous);
      } else {
        delete (Array.prototype as unknown as Record<string, unknown>)["0"];
      }
    }
    if (operationError) throw operationError;
    expect(result?.entries.map((entry) => entry.id)).toEqual([
      "original",
      "added",
    ]);
    expect(serializeBlueprintLibrary(result!)).toContain('"id":"added"');
  });

  it("does not use the mutable global String function for array keys", () => {
    const original = createBlueprintLibraryEntry(
      createBlueprintLibrary(),
      null,
      0,
      blueprintDraft("original"),
    );
    const originalString = globalThis.String;
    let result: BlueprintLibrary | undefined;
    let operationError: unknown;
    globalThis.String = (() => "0") as StringConstructor;
    try {
      try {
        result = createBlueprintLibraryEntry(
          original,
          null,
          1,
          blueprintDraft("added"),
        );
      } catch (error) {
        operationError = error;
      }
    } finally {
      globalThis.String = originalString;
    }
    if (operationError) throw operationError;
    expect(result?.entries.map((entry) => entry.id)).toEqual([
      "original",
      "added",
    ]);
  });

  it("rejects duplicate and escape-equivalent JSON members at every depth", () => {
    const canonical = serializeBlueprintLibrary(
      createBlueprintLibraryEntry(
        createBlueprintLibrary(),
        null,
        0,
        blueprintDraft("duplicate-test"),
      ),
    );
    const duplicateRoot = canonical.replace(
      `"format":"${BLUEPRINT_LIBRARY_FORMAT}"`,
      `"format":"${BLUEPRINT_LIBRARY_FORMAT}","format":"${BLUEPRINT_LIBRARY_FORMAT}"`,
    );
    const escapedRoot = canonical.replace(
      `"format":"${BLUEPRINT_LIBRARY_FORMAT}"`,
      `"format":"${BLUEPRINT_LIBRARY_FORMAT}","for\\u006dat":"${BLUEPRINT_LIBRARY_FORMAT}"`,
    );
    const duplicateBlueprint = canonical.replace(
      '"width":0',
      '"width":0,"\\u0077idth":0',
    );
    for (const bytes of [
      duplicateRoot,
      escapedRoot,
      duplicateBlueprint,
    ]) {
      expect(() => restoreBlueprintLibrary(bytes)).toThrow(/duplicate member/);
    }
  });

  it("rejects depth, member, array, byte, and syntax complexity bombs early", () => {
    const depthBomb =
      "[".repeat(MAX_BLUEPRINT_LIBRARY_JSON_DEPTH + 1) +
      "]".repeat(MAX_BLUEPRINT_LIBRARY_JSON_DEPTH + 1);
    const memberBomb =
      "{" +
      Array.from({ length: 17 }, (_, index) => `"k${index}":null`).join(",") +
      "}";
    const arrayBomb =
      "[" +
      new Array(MAX_BLUEPRINT_LIBRARY_JSON_ARRAY_ITEMS + 1)
        .fill("null")
        .join(",") +
      "]";
    expect(() => restoreBlueprintLibrary(depthBomb)).toThrow(/depth/);
    expect(() => restoreBlueprintLibrary(memberBomb)).toThrow(/member count/);
    expect(() => restoreBlueprintLibrary(arrayBomb)).toThrow(/array length/);
    expect(() =>
      restoreBlueprintLibrary(
        " ".repeat(MAX_BLUEPRINT_LIBRARY_JSON_BYTES + 1),
      ),
    ).toThrow(/bytes/);
    expect(() => restoreBlueprintLibrary('{"format":')).toThrow(
      /Invalid blueprint library JSON/,
    );
    expect(() => restoreBlueprintLibrary("{} trailing")).toThrow(/trailing/);
  });

  it("rejects unknown fields, accessors, symbols, exotic prototypes, and sparse arrays", () => {
    const unknown = {
      ...currentRawLibrary(),
      runtimeState: { tick: 10 },
    };
    const accessor = currentRawLibrary();
    Object.defineProperty(accessor, "selectedId", {
      enumerable: true,
      get() {
        return null;
      },
    });
    const symbol = currentRawLibrary();
    Object.defineProperty(symbol, Symbol("hidden"), {
      enumerable: true,
      value: true,
    });
    const exotic = Object.assign(
      Object.create({ inherited: true }),
      currentRawLibrary(),
    );
    const sparse = currentRawLibrary(new Array(2));
    for (const candidate of [unknown, accessor, symbol, exotic, sparse]) {
      expect(() => restoreBlueprintLibrary(candidate)).toThrow();
    }
  });

  it("rejects duplicate ids, missing selections, wrong fields, and negative-zero indices", () => {
    expect(() =>
      restoreBlueprintLibrary({
        ...currentRawLibrary(),
        catalog: "stale-catalog",
      }),
    ).toThrow(/catalog/);
    expect(() =>
      restoreBlueprintLibrary(
        currentRawLibrary([
          currentRawBlueprintEntry("same"),
          currentRawBlueprintEntry("same"),
        ]),
      ),
    ).toThrow(/duplicates/);
    expect(() =>
      restoreBlueprintLibrary(currentRawLibrary([], "missing")),
    ).toThrow(/does not identify/);
    expect(() =>
      restoreBlueprintLibrary(
        currentRawLibrary([
          {
            ...currentRawBlueprintEntry("extra"),
            runtimeInventory: { ironOre: 10 },
          },
        ]),
      ),
    ).toThrow(/exactly/);
    expect(
      operationCode(() =>
        createBlueprintLibraryEntry(
          createBlueprintLibrary(),
          null,
          -0,
          blueprintDraft("negative-zero"),
        ),
      ),
    ).toBe(BlueprintLibraryOperationErrorCode.InvalidIndex);
  });
});

describe("blueprint library limits and scale", () => {
  it("round-trips the exact maximum record count and rejects one more", () => {
    const entries = Array.from(
      { length: MAX_BLUEPRINT_LIBRARY_RECORDS },
      (_, index) =>
        currentRawBlueprintEntry(
          `record-${String(index).padStart(4, "0")}`,
        ),
    );
    const library = restoreBlueprintLibrary(currentRawLibrary(entries));
    expect(library.entries).toHaveLength(MAX_BLUEPRINT_LIBRARY_RECORDS);
    const bytes = serializeBlueprintLibrary(library);
    expect(restoreBlueprintLibrary(bytes).entries).toHaveLength(
      MAX_BLUEPRINT_LIBRARY_RECORDS,
    );
    const selected = selectBlueprintLibraryEntry(
      library,
      `record-${String(MAX_BLUEPRINT_LIBRARY_RECORDS - 1).padStart(4, "0")}`,
    );
    expect(selected.entries).toBe(library.entries);
    expect(serializeBlueprintLibrary(restoreBlueprintLibrary(
      serializeBlueprintLibrary(selected),
    ))).toBe(serializeBlueprintLibrary(selected));
    expect(() =>
      restoreBlueprintLibrary(
        currentRawLibrary([
          ...entries,
          currentRawBlueprintEntry("overflow"),
        ]),
      ),
    ).toThrow(/limit/);
  });

  it("counts construction entities across shared blueprint records", () => {
    const entities = [];
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        entities.push({
          kind: "belt",
          x,
          y,
          direction: Direction.North,
          recipeId: null,
          manifoldRouting: null,
        });
      }
    }
    expect(entities).toHaveLength(MAX_BLUEPRINT_ENTITIES);
    const maximumBlueprint = restoreBlueprint({
      format: BLUEPRINT_FORMAT,
      version: 2,
      catalog: CATALOG_VERSION,
      width: 64,
      height: 64,
      entities,
    });
    const recordCount =
      MAX_BLUEPRINT_LIBRARY_ENTITIES / MAX_BLUEPRINT_ENTITIES;
    const atLimit = Array.from({ length: recordCount }, (_, index) =>
      currentRawBlueprintEntry(`full-${index}`, {
        blueprint: maximumBlueprint,
      }),
    );
    const library = restoreBlueprintLibrary(currentRawLibrary(atLimit));
    expect(
      library.entries.reduce(
        (total, entry) =>
          total +
          (entry.kind === "blueprint" ? entry.blueprint.entities.length : 0),
        0,
      ),
    ).toBe(MAX_BLUEPRINT_LIBRARY_ENTITIES);
    let selection = library;
    const selectionSamples: number[] = [];
    for (let index = 0; index < 250; index += 1) {
      const started = performance.now();
      selection = selectBlueprintLibraryEntry(
        selection,
        `full-${index % recordCount}`,
      );
      selectionSamples[index] = performance.now() - started;
    }
    selectionSamples.sort((left, right) => left - right);
    const selectionP95 =
      selectionSamples[Math.floor(selectionSamples.length * 0.95)]!;
    console.info(
      `[blueprint-library-selection] ${JSON.stringify({
        canonicalBytes: serializeBlueprintLibrary(library).length,
        entityCount: MAX_BLUEPRINT_LIBRARY_ENTITIES,
        samples: selectionSamples.length,
        p95Ms: selectionP95,
      })}`,
    );
    expect(selection.entries).toBe(library.entries);
    expect(selectionP95).toBeLessThan(5);
    const withEmpty = createBlueprintLibraryEntry(
      library,
      null,
      library.entries.length,
      blueprintDraft("empty-at-entity-limit"),
    );
    expect(() =>
      updateBlueprintLibraryEntry(
        withEmpty,
        "empty-at-entity-limit",
        { blueprint: maximumBlueprint },
      ),
    ).toThrow(/construction entities/);
    expect(() =>
      duplicateBlueprintLibraryEntry(
        library,
        "full-0",
        ["duplicate-full"],
        null,
        library.entries.length,
      ),
    ).toThrow(/construction entities/);
    expect(() =>
      restoreBlueprintLibrary(
        currentRawLibrary([
          ...atLimit,
          currentRawBlueprintEntry("entity-overflow", {
            blueprint: maximumBlueprint,
          }),
        ]),
      ),
    ).toThrow(/construction entities/);
  });
});
