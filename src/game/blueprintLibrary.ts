/**
 * Pure, deterministic blueprint libraries and share records.
 *
 * This layer deliberately stores construction intent and presentation metadata
 * only. Embedded blueprints are always delegated to the blueprint kernel for
 * validation and canonical serialization.
 */

import {
  CATALOG_VERSION,
  ENTITY_KINDS,
  ITEM_IDS,
} from "./catalog";
import {
  restoreBlueprint,
  serializeBlueprint,
  type Blueprint,
} from "./blueprints";
import type { EntityKind, ItemId } from "./types";

const ARRAY_IS_ARRAY = Array.isArray;
const ARRAY_PROTOTYPE = Array.prototype;
const JSON_PARSE = JSON.parse;
const JSON_STRINGIFY = JSON.stringify;
const NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger;
const OBJECT_CREATE = Object.create;
const OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const OBJECT_FREEZE = Object.freeze;
const OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const OBJECT_GET_OWN_PROPERTY_NAMES = Object.getOwnPropertyNames;
const OBJECT_GET_OWN_PROPERTY_SYMBOLS = Object.getOwnPropertySymbols;
const OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const OBJECT_PROTOTYPE = Object.prototype;
const OBJECT_IS = Object.is;
const REFLECT_APPLY = Reflect.apply;
const SET_CONSTRUCTOR = Set;
const SET_ADD = Set.prototype.add;
const SET_HAS = Set.prototype.has;
const WEAK_MAP_GET = WeakMap.prototype.get;
const WEAK_MAP_SET = WeakMap.prototype.set;
const WEAK_SET_ADD = WeakSet.prototype.add;
const WEAK_SET_HAS = WeakSet.prototype.has;
const WEAK_SET_PROTOTYPE = WeakSet.prototype;
const STRING_CHAR_CODE_AT = String.prototype.charCodeAt;
const STRING_NORMALIZE = String.prototype.normalize;
const STRING_SLICE = String.prototype.slice;
const STRING_TRIM = String.prototype.trim;

export const BLUEPRINT_LIBRARY_FORMAT =
  "cinderline-blueprint-library" as const;
export const BLUEPRINT_LIBRARY_VERSION = 2 as const;
export const LEGACY_BLUEPRINT_LIBRARY_VERSION = 1 as const;

export const MAX_BLUEPRINT_LIBRARY_RECORDS = 1_024;
export const MAX_BLUEPRINT_LIBRARY_ENTITIES = 65_536;
export const MAX_BLUEPRINT_LIBRARY_JSON_BYTES = 16 * 1_024 * 1_024;
export const MAX_BLUEPRINT_LIBRARY_BOOK_DEPTH = 6;
export const MAX_BLUEPRINT_LIBRARY_ICONS = 4;
export const MAX_BLUEPRINT_LIBRARY_ID_LENGTH = 64;
export const MAX_BLUEPRINT_LIBRARY_NAME_LENGTH = 64;
export const MAX_BLUEPRINT_LIBRARY_DESCRIPTION_LENGTH = 512;
export const MAX_BLUEPRINT_LIBRARY_JSON_DEPTH = 32;
export const MAX_BLUEPRINT_LIBRARY_JSON_TOKENS = 2_000_000;
export const MAX_BLUEPRINT_LIBRARY_JSON_OBJECT_MEMBERS = 16;
export const MAX_BLUEPRINT_LIBRARY_JSON_ARRAY_ITEMS =
  MAX_BLUEPRINT_LIBRARY_ENTITIES;

export type BlueprintLibraryIcon =
  | {
      readonly type: "item";
      readonly id: ItemId;
    }
  | {
      readonly type: "entity";
      readonly id: EntityKind;
    };

interface BlueprintLibraryEntryBase {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icons: readonly BlueprintLibraryIcon[];
}

export interface BlueprintLibraryBlueprintEntry
  extends BlueprintLibraryEntryBase {
  readonly kind: "blueprint";
  readonly blueprint: Blueprint;
}

export interface BlueprintLibraryBookEntry
  extends BlueprintLibraryEntryBase {
  readonly kind: "book";
  readonly entries: readonly BlueprintLibraryEntry[];
}

export type BlueprintLibraryEntry =
  | BlueprintLibraryBlueprintEntry
  | BlueprintLibraryBookEntry;

export interface BlueprintLibrary {
  readonly format: typeof BLUEPRINT_LIBRARY_FORMAT;
  readonly version: typeof BLUEPRINT_LIBRARY_VERSION;
  readonly catalog: typeof CATALOG_VERSION;
  readonly selectedId: string | null;
  readonly entries: readonly BlueprintLibraryEntry[];
}

export type BlueprintLibraryEntryDraft =
  | {
      readonly kind: "blueprint";
      readonly id: string;
      readonly name: string;
      readonly description: string;
      readonly icons: readonly BlueprintLibraryIcon[];
      readonly blueprint: Blueprint;
    }
  | {
      readonly kind: "book";
      readonly id: string;
      readonly name: string;
      readonly description: string;
      readonly icons: readonly BlueprintLibraryIcon[];
    };

export interface BlueprintLibraryEntryUpdate {
  readonly name?: string;
  readonly description?: string;
  readonly icons?: readonly BlueprintLibraryIcon[];
  /** Valid only when updating a blueprint record. */
  readonly blueprint?: Blueprint;
}

export const BlueprintLibraryOperationErrorCode = {
  EntryNotFound: "ENTRY_NOT_FOUND",
  ParentNotFound: "PARENT_NOT_FOUND",
  ParentNotBook: "PARENT_NOT_BOOK",
  DuplicateId: "DUPLICATE_ID",
  InvalidIndex: "INVALID_INDEX",
  DuplicateIdCount: "DUPLICATE_ID_COUNT",
  MoveCycle: "MOVE_CYCLE",
  WrongEntryKind: "WRONG_ENTRY_KIND",
  EmptyUpdate: "EMPTY_UPDATE",
} as const;

export type BlueprintLibraryOperationErrorCode =
  (typeof BlueprintLibraryOperationErrorCode)[keyof typeof BlueprintLibraryOperationErrorCode];

export class BlueprintLibraryOperationError extends Error {
  readonly code: BlueprintLibraryOperationErrorCode;

  constructor(
    code: BlueprintLibraryOperationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BlueprintLibraryOperationError";
    this.code = code;
  }
}

interface RestoreTracker {
  readonly ids: Set<string>;
  recordCount: number;
  entityCount: number;
}

interface FoundEntry {
  readonly entry: BlueprintLibraryEntry;
  readonly parentId: string | null;
  readonly index: number;
}

const libraryBrand = new WeakSet<object>();
const libraryJsonBytes = new WeakMap<object, number>();
const mutableItemIds: ItemId[] = [];
for (let index = 0; index < ITEM_IDS.length; index += 1) {
  writeArray(mutableItemIds, index, ITEM_IDS[index]!);
}
const VALID_ITEM_IDS: readonly ItemId[] = OBJECT_FREEZE(mutableItemIds);
const mutableEntityKinds: EntityKind[] = [];
for (let index = 0; index < ENTITY_KINDS.length; index += 1) {
  writeArray(mutableEntityKinds, index, ENTITY_KINDS[index]!);
}
const VALID_ENTITY_KINDS: readonly EntityKind[] = OBJECT_FREEZE(
  mutableEntityKinds,
);

function quote(value: string): string {
  return REFLECT_APPLY(JSON_STRINGIFY, undefined, [value]) as string;
}

function charCodeAt(value: string, index: number): number {
  return REFLECT_APPLY(STRING_CHAR_CODE_AT, value, [index]) as number;
}

function slice(value: string, start: number, end?: number): string {
  return REFLECT_APPLY(
    STRING_SLICE,
    value,
    end === undefined ? [start] : [start, end],
  ) as string;
}

function normalizeNfc(value: string): string {
  return REFLECT_APPLY(STRING_NORMALIZE, value, ["NFC"]) as string;
}

function trim(value: string): string {
  return REFLECT_APPLY(STRING_TRIM, value, []) as string;
}

function contains<Value>(
  values: readonly Value[],
  target: unknown,
): target is Value {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === target) return true;
  }
  return false;
}

function hasOwn(value: object, key: string): boolean {
  return OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key) !== undefined;
}

function writeArray<Value>(
  values: Value[],
  index: number,
  value: Value,
): void {
  REFLECT_APPLY(OBJECT_DEFINE_PROPERTY, undefined, [
    values,
    index,
    {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    },
  ]);
}

function copyArray<Value>(
  values: readonly Value[],
): Value[] {
  const copy: Value[] = [];
  for (let index = 0; index < values.length; index += 1) {
    writeArray(copy, index, values[index]!);
  }
  return copy;
}

function append<Value>(
  values: Value[],
  value: Value,
): void {
  writeArray(values, values.length, value);
}

function joinedKeys(values: readonly string[]): string {
  let result = "";
  for (let index = 0; index < values.length; index += 1) {
    if (index !== 0) result += ", ";
    result += values[index]!;
  }
  return result;
}

function keysWithFinal(
  values: readonly string[],
  finalValue: string,
): string[] {
  const result = copyArray(values);
  append(result, finalValue);
  return result;
}

function insertAt<Value>(
  values: readonly Value[],
  index: number,
  inserted: Value,
): Value[] {
  const result: Value[] = [];
  for (let source = 0; source < values.length + 1; source += 1) {
    if (source < index) {
      writeArray(result, source, values[source]!);
    } else if (source === index) {
      writeArray(result, source, inserted);
    } else {
      writeArray(result, source, values[source - 1]!);
    }
  }
  return result;
}

function ownData(
  value: object,
  key: string | number,
  label: string,
): unknown {
  const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    !descriptor.enumerable
  ) {
    throw new TypeError(`${label}.${key} must be an enumerable own data field.`);
  }
  return descriptor.value;
}

function requirePlainRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || ARRAY_IS_ARRAY(value)) {
    throw new TypeError(`${label} must be a plain record.`);
  }
  const prototype = OBJECT_GET_PROTOTYPE_OF(value);
  if (prototype !== OBJECT_PROTOTYPE && prototype !== null) {
    throw new TypeError(`${label} must have a plain prototype.`);
  }
  if (OBJECT_GET_OWN_PROPERTY_SYMBOLS(value).length !== 0) {
    throw new TypeError(`${label} must not contain symbol fields.`);
  }
  return value as Record<string, unknown>;
}

function requireRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  const record = requirePlainRecord(value, label);
  const names = OBJECT_GET_OWN_PROPERTY_NAMES(record);
  if (names.length !== expectedKeys.length) {
    throw new TypeError(
      `${label} must contain exactly: ${joinedKeys(expectedKeys)}.`,
    );
  }
  const snapshot = OBJECT_CREATE(null) as Record<string, unknown>;
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys[index]!;
    if (!contains(names, key)) {
      throw new TypeError(
        `${label} must contain exactly: ${joinedKeys(expectedKeys)}.`,
      );
    }
    snapshot[key] = ownData(record, key, label);
  }
  return snapshot;
}

function requireSubsetRecord(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  const record = requirePlainRecord(value, label);
  const names = OBJECT_GET_OWN_PROPERTY_NAMES(record);
  const snapshot = OBJECT_CREATE(null) as Record<string, unknown>;
  for (let index = 0; index < names.length; index += 1) {
    const key = names[index]!;
    if (!contains(allowedKeys, key)) {
      throw new TypeError(`${label} contains unknown field ${key}.`);
    }
    snapshot[key] = ownData(record, key, label);
  }
  return snapshot;
}

function requireDenseArray(
  value: unknown,
  maximumLength: number,
  label: string,
): readonly unknown[] {
  if (!ARRAY_IS_ARRAY(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  if (
    OBJECT_GET_PROTOTYPE_OF(value) !== ARRAY_PROTOTYPE ||
    OBJECT_GET_OWN_PROPERTY_SYMBOLS(value).length !== 0
  ) {
    throw new TypeError(`${label} must be an ordinary array.`);
  }
  const lengthDescriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !NUMBER_IS_SAFE_INTEGER(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > maximumLength
  ) {
    throw new RangeError(
      `${label} exceeds its limit of ${maximumLength} entries.`,
    );
  }
  const length = lengthDescriptor.value;
  const names = OBJECT_GET_OWN_PROPERTY_NAMES(value);
  if (names.length !== length + 1 || !contains(names, "length")) {
    throw new TypeError(`${label} must be dense and contain no extra fields.`);
  }
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    writeArray(result, index, ownData(value, index, label));
  }
  return result;
}

function canonicalIndex(
  value: unknown,
  maximum: number,
  label: string,
): number {
  if (
    typeof value !== "number" ||
    !NUMBER_IS_SAFE_INTEGER(value) ||
    OBJECT_IS(value, -0) ||
    value < 0 ||
    value > maximum
  ) {
    throw new BlueprintLibraryOperationError(
      BlueprintLibraryOperationErrorCode.InvalidIndex,
      `${label} must be a canonical integer from 0 to ${maximum}.`,
    );
  }
  return value;
}

function canonicalId(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_BLUEPRINT_LIBRARY_ID_LENGTH
  ) {
    throw new TypeError(
      `${label} must be 1-${MAX_BLUEPRINT_LIBRARY_ID_LENGTH} ASCII characters.`,
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = charCodeAt(value, index);
    const digit = code >= 0x30 && code <= 0x39;
    const lower = code >= 0x61 && code <= 0x7a;
    const punctuation =
      code === 0x2d || code === 0x2e || code === 0x3a || code === 0x5f;
    if (
      (!digit && !lower && !(index > 0 && punctuation)) ||
      (index === 0 && !digit && !lower)
    ) {
      throw new TypeError(
        `${label} must match [a-z0-9][a-z0-9._:-]* exactly.`,
      );
    }
  }
  return value;
}

function textScalarLength(value: string, label: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = charCodeAt(value, index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const following =
        index + 1 < value.length ? charCodeAt(value, index + 1) : -1;
      if (following < 0xdc00 || following > 0xdfff) {
        throw new TypeError(`${label} contains an unpaired surrogate.`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`${label} contains an unpaired surrogate.`);
    }
    count += 1;
  }
  return count;
}

function canonicalText(
  value: unknown,
  label: string,
  maximumLength: number,
  allowEmpty: boolean,
  allowLineBreaks: boolean,
): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }
  const length = textScalarLength(value, label);
  if ((!allowEmpty && length === 0) || length > maximumLength) {
    throw new RangeError(
      `${label} must contain ${allowEmpty ? "0" : "1"}-${maximumLength} Unicode scalars.`,
    );
  }
  if (normalizeNfc(value) !== value) {
    throw new TypeError(`${label} must already be Unicode NFC normalized.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = charCodeAt(value, index);
    const allowedWhitespace =
      allowLineBreaks && (code === 0x09 || code === 0x0a);
    if (
      (!allowedWhitespace && (code < 0x20 || code === 0x7f)) ||
      (code >= 0x80 && code <= 0x9f) ||
      code === 0x0d
      || code === 0x2028
      || code === 0x2029
    ) {
      throw new TypeError(`${label} contains a forbidden control character.`);
    }
  }
  if (!allowEmpty) {
    if (trim(value) !== value) {
      throw new TypeError(`${label} must not begin or end with whitespace.`);
    }
  }
  return value;
}

function canonicalName(value: unknown, label: string): string {
  return canonicalText(
    value,
    label,
    MAX_BLUEPRINT_LIBRARY_NAME_LENGTH,
    false,
    false,
  );
}

function canonicalDescription(value: unknown, label: string): string {
  return canonicalText(
    value,
    label,
    MAX_BLUEPRINT_LIBRARY_DESCRIPTION_LENGTH,
    true,
    true,
  );
}

function restoreIcon(value: unknown, label: string): BlueprintLibraryIcon {
  const record = requireRecord(value, ["type", "id"], label);
  if (record.type === "item") {
    if (!contains(VALID_ITEM_IDS, record.id)) {
      throw new TypeError(`${label}.id is not a catalog item.`);
    }
    return OBJECT_FREEZE({ type: "item", id: record.id });
  }
  if (record.type === "entity") {
    if (!contains(VALID_ENTITY_KINDS, record.id)) {
      throw new TypeError(`${label}.id is not a catalog entity.`);
    }
    return OBJECT_FREEZE({ type: "entity", id: record.id });
  }
  throw new TypeError(`${label}.type must be item or entity.`);
}

function restoreIcons(
  value: unknown,
  label: string,
): readonly BlueprintLibraryIcon[] {
  const values = requireDenseArray(
    value,
    MAX_BLUEPRINT_LIBRARY_ICONS,
    label,
  );
  const icons: BlueprintLibraryIcon[] = [];
  const keys = new SET_CONSTRUCTOR<string>();
  for (let index = 0; index < values.length; index += 1) {
    const icon = restoreIcon(values[index], `${label}[${index}]`);
    const key = `${icon.type}:${icon.id}`;
    if (REFLECT_APPLY(SET_HAS, keys, [key]) as boolean) {
      throw new TypeError(`${label} contains duplicate icon ${key}.`);
    }
    REFLECT_APPLY(SET_ADD, keys, [key]);
    writeArray(icons, index, icon);
  }
  return OBJECT_FREEZE(icons);
}

function restoreEmbeddedBlueprint(
  value: unknown,
  label: string,
): Blueprint {
  if (
    typeof value !== "object" ||
    value === null ||
    ARRAY_IS_ARRAY(value)
  ) {
    throw new TypeError(`${label} must be an embedded blueprint record.`);
  }
  const currentHas = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
    WEAK_SET_PROTOTYPE,
    "has",
  );
  const currentAdd = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
    WEAK_SET_PROTOTYPE,
    "add",
  );
  if (
    currentHas === undefined ||
    !("value" in currentHas) ||
    currentHas.value !== WEAK_SET_HAS ||
    currentAdd === undefined ||
    !("value" in currentAdd) ||
    currentAdd.value !== WEAK_SET_ADD
  ) {
    throw new TypeError(
      `${label} cannot be restored while WeakSet brand intrinsics are altered.`,
    );
  }
  return restoreBlueprint(value);
}

function freezeBlueprintEntry(
  id: string,
  name: string,
  description: string,
  icons: readonly BlueprintLibraryIcon[],
  blueprint: Blueprint,
): BlueprintLibraryBlueprintEntry {
  return OBJECT_FREEZE({
    kind: "blueprint",
    id,
    name,
    description,
    icons,
    blueprint,
  });
}

function freezeBookEntry(
  id: string,
  name: string,
  description: string,
  icons: readonly BlueprintLibraryIcon[],
  entries: readonly BlueprintLibraryEntry[],
): BlueprintLibraryBookEntry {
  return OBJECT_FREEZE({
    kind: "book",
    id,
    name,
    description,
    icons,
    entries: OBJECT_FREEZE(copyArray(entries)),
  });
}

function freezeLibrary(
  selectedId: string | null,
  entries: readonly BlueprintLibraryEntry[],
  reuseEntries = false,
): BlueprintLibrary {
  const library = OBJECT_FREEZE({
    format: BLUEPRINT_LIBRARY_FORMAT,
    version: BLUEPRINT_LIBRARY_VERSION,
    catalog: CATALOG_VERSION,
    selectedId,
    entries: reuseEntries
      ? entries
      : OBJECT_FREEZE(copyArray(entries)),
  });
  REFLECT_APPLY(WEAK_SET_ADD, libraryBrand, [library]);
  return library;
}

function restoreEntry(
  value: unknown,
  version:
    | typeof BLUEPRINT_LIBRARY_VERSION
    | typeof LEGACY_BLUEPRINT_LIBRARY_VERSION,
  parentBookDepth: number,
  tracker: RestoreTracker,
  label: string,
): BlueprintLibraryEntry {
  const candidate = requirePlainRecord(value, label);
  const kind = ownData(candidate, "kind", label);
  const isLegacy = version === LEGACY_BLUEPRINT_LIBRARY_VERSION;
  const commonKeys = isLegacy
    ? ["kind", "id", "name", "icon"]
    : ["kind", "id", "name", "description", "icons"];
  const specificKey =
    kind === "blueprint"
      ? "blueprint"
      : kind === "book"
        ? "entries"
        : undefined;
  if (specificKey === undefined) {
    throw new TypeError(`${label}.kind must be blueprint or book.`);
  }
  const record = requireRecord(
    candidate,
    keysWithFinal(commonKeys, specificKey),
    label,
  );
  const id = canonicalId(record.id, `${label}.id`);
  if (REFLECT_APPLY(SET_HAS, tracker.ids, [id]) as boolean) {
    throw new TypeError(`${label}.id duplicates ${id}.`);
  }
  REFLECT_APPLY(SET_ADD, tracker.ids, [id]);
  tracker.recordCount += 1;
  if (tracker.recordCount > MAX_BLUEPRINT_LIBRARY_RECORDS) {
    throw new RangeError(
      `Blueprint library exceeds ${MAX_BLUEPRINT_LIBRARY_RECORDS} records.`,
    );
  }
  const name = canonicalName(record.name, `${label}.name`);
  const description = isLegacy
    ? ""
    : canonicalDescription(record.description, `${label}.description`);
  const icons = isLegacy
    ? record.icon === null
      ? OBJECT_FREEZE([] as BlueprintLibraryIcon[])
      : OBJECT_FREEZE([
          restoreIcon(record.icon, `${label}.icon`),
        ])
    : restoreIcons(record.icons, `${label}.icons`);

  if (kind === "blueprint") {
    const blueprint = restoreEmbeddedBlueprint(
      record.blueprint,
      `${label}.blueprint`,
    );
    tracker.entityCount += blueprint.entities.length;
    if (tracker.entityCount > MAX_BLUEPRINT_LIBRARY_ENTITIES) {
      throw new RangeError(
        `Blueprint library exceeds ${MAX_BLUEPRINT_LIBRARY_ENTITIES} construction entities.`,
      );
    }
    return freezeBlueprintEntry(id, name, description, icons, blueprint);
  }

  const bookDepth = parentBookDepth + 1;
  if (bookDepth > MAX_BLUEPRINT_LIBRARY_BOOK_DEPTH) {
    throw new RangeError(
      `Blueprint books exceed depth ${MAX_BLUEPRINT_LIBRARY_BOOK_DEPTH}.`,
    );
  }
  const serializedEntries = requireDenseArray(
    record.entries,
    MAX_BLUEPRINT_LIBRARY_RECORDS,
    `${label}.entries`,
  );
  const entries: BlueprintLibraryEntry[] = [];
  for (let index = 0; index < serializedEntries.length; index += 1) {
    writeArray(
      entries,
      index,
      restoreEntry(
        serializedEntries[index],
        version,
        bookDepth,
        tracker,
        `${label}.entries[${index}]`,
      ),
    );
  }
  return freezeBookEntry(id, name, description, icons, entries);
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = charCodeAt(value, index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const following =
        index + 1 < value.length ? charCodeAt(value, index + 1) : -1;
      if (following >= 0xdc00 && following <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        // UTF-8 encoders replace an isolated UTF-16 surrogate with U+FFFD.
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > MAX_BLUEPRINT_LIBRARY_JSON_BYTES) return bytes;
  }
  return bytes;
}

function encodeIcon(icon: BlueprintLibraryIcon): string {
  return `{"type":${quote(icon.type)},"id":${quote(icon.id)}}`;
}

function encodeIcons(icons: readonly BlueprintLibraryIcon[]): string {
  let encoded = "[";
  for (let index = 0; index < icons.length; index += 1) {
    if (index !== 0) encoded += ",";
    encoded += encodeIcon(icons[index]!);
  }
  return `${encoded}]`;
}

function encodeEntry(entry: BlueprintLibraryEntry): string {
  const common =
    `{"kind":${quote(entry.kind)},"id":${quote(entry.id)},` +
    `"name":${quote(entry.name)},"description":${quote(entry.description)},` +
    `"icons":${encodeIcons(entry.icons)},`;
  if (entry.kind === "blueprint") {
    return `${common}"blueprint":${serializeBlueprint(entry.blueprint)}}`;
  }
  return `${common}"entries":${encodeEntries(entry.entries)}}`;
}

function encodeEntries(entries: readonly BlueprintLibraryEntry[]): string {
  let encoded = "[";
  for (let index = 0; index < entries.length; index += 1) {
    if (index !== 0) encoded += ",";
    encoded += encodeEntry(entries[index]!);
  }
  return `${encoded}]`;
}

function encodeLibrary(library: BlueprintLibrary): string {
  return (
    `{"format":${quote(BLUEPRINT_LIBRARY_FORMAT)},` +
    `"version":${BLUEPRINT_LIBRARY_VERSION},"catalog":${quote(CATALOG_VERSION)},` +
    `"selectedId":${
      library.selectedId === null ? "null" : quote(library.selectedId)
    },"entries":${encodeEntries(library.entries)}}`
  );
}

function assertCanonicalByteLimit(library: BlueprintLibrary): void {
  const byteLength = utf8ByteLength(encodeLibrary(library));
  if (byteLength > MAX_BLUEPRINT_LIBRARY_JSON_BYTES) {
    throw new RangeError(
      `Blueprint library JSON exceeds ${MAX_BLUEPRINT_LIBRARY_JSON_BYTES} bytes.`,
    );
  }
  REFLECT_APPLY(WEAK_MAP_SET, libraryJsonBytes, [library, byteLength]);
}

function parseStrictJson(serialized: string): unknown {
  if (
    serialized.length > MAX_BLUEPRINT_LIBRARY_JSON_BYTES ||
    utf8ByteLength(serialized) > MAX_BLUEPRINT_LIBRARY_JSON_BYTES
  ) {
    throw new RangeError(
      `Blueprint library JSON exceeds ${MAX_BLUEPRINT_LIBRARY_JSON_BYTES} bytes.`,
    );
  }
  const length = serialized.length;
  let cursor = 0;
  let depth = 0;
  let tokens = 0;
  const syntax = (message: string): never => {
    throw new SyntaxError(
      `Invalid blueprint library JSON at character ${cursor}: ${message}.`,
    );
  };
  const bump = (): void => {
    tokens += 1;
    if (tokens > MAX_BLUEPRINT_LIBRARY_JSON_TOKENS) {
      syntax("maximum token count exceeded");
    }
  };
  const whitespace = (code: number): boolean =>
    code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
  const digit = (code: number): boolean => code >= 0x30 && code <= 0x39;
  const skip = (): void => {
    while (cursor < length && whitespace(charCodeAt(serialized, cursor))) {
      cursor += 1;
    }
  };
  const stringToken = (): string => {
    if (charCodeAt(serialized, cursor) !== 0x22) {
      return syntax("expected string");
    }
    const start = cursor;
    cursor += 1;
    while (cursor < length) {
      const code = charCodeAt(serialized, cursor);
      if (code === 0x22) {
        cursor += 1;
        return REFLECT_APPLY(
          JSON_PARSE,
          undefined,
          [slice(serialized, start, cursor)],
        ) as string;
      }
      if (code < 0x20) return syntax("unescaped control character");
      if (code !== 0x5c) {
        cursor += 1;
        continue;
      }
      cursor += 1;
      if (cursor >= length) return syntax("unterminated escape");
      const escape = charCodeAt(serialized, cursor);
      if (escape === 0x75) {
        cursor += 1;
        for (let index = 0; index < 4; index += 1) {
          if (cursor >= length) return syntax("incomplete Unicode escape");
          const hex = charCodeAt(serialized, cursor);
          const valid =
            (hex >= 0x30 && hex <= 0x39) ||
            (hex >= 0x41 && hex <= 0x46) ||
            (hex >= 0x61 && hex <= 0x66);
          if (!valid) return syntax("invalid Unicode escape");
          cursor += 1;
        }
      } else if (
        escape === 0x22 ||
        escape === 0x5c ||
        escape === 0x2f ||
        escape === 0x62 ||
        escape === 0x66 ||
        escape === 0x6e ||
        escape === 0x72 ||
        escape === 0x74
      ) {
        cursor += 1;
      } else {
        return syntax("invalid escape");
      }
    }
    return syntax("unterminated string");
  };
  const literal = (expected: string): void => {
    for (let index = 0; index < expected.length; index += 1) {
      if (
        cursor + index >= length ||
        charCodeAt(serialized, cursor + index) !== charCodeAt(expected, index)
      ) {
        return syntax("invalid literal");
      }
    }
    cursor += expected.length;
  };
  const number = (): void => {
    if (charCodeAt(serialized, cursor) === 0x2d) cursor += 1;
    if (cursor >= length) return syntax("incomplete number");
    const first = charCodeAt(serialized, cursor);
    if (first === 0x30) {
      cursor += 1;
      if (cursor < length && digit(charCodeAt(serialized, cursor))) {
        return syntax("leading zero");
      }
    } else if (first >= 0x31 && first <= 0x39) {
      cursor += 1;
      while (cursor < length && digit(charCodeAt(serialized, cursor))) {
        cursor += 1;
      }
    } else {
      return syntax("invalid number");
    }
    if (cursor < length && charCodeAt(serialized, cursor) === 0x2e) {
      cursor += 1;
      if (cursor >= length || !digit(charCodeAt(serialized, cursor))) {
        return syntax("invalid fraction");
      }
      while (cursor < length && digit(charCodeAt(serialized, cursor))) {
        cursor += 1;
      }
    }
    if (cursor < length) {
      const exponent = charCodeAt(serialized, cursor);
      if (exponent === 0x65 || exponent === 0x45) {
        cursor += 1;
        if (cursor < length) {
          const sign = charCodeAt(serialized, cursor);
          if (sign === 0x2b || sign === 0x2d) cursor += 1;
        }
        if (cursor >= length || !digit(charCodeAt(serialized, cursor))) {
          return syntax("invalid exponent");
        }
        while (cursor < length && digit(charCodeAt(serialized, cursor))) {
          cursor += 1;
        }
      }
    }
  };
  let value: () => void;
  const array = (): void => {
    depth += 1;
    if (depth > MAX_BLUEPRINT_LIBRARY_JSON_DEPTH) {
      return syntax("maximum nesting depth exceeded");
    }
    cursor += 1;
    skip();
    let itemCount = 0;
    if (charCodeAt(serialized, cursor) === 0x5d) {
      cursor += 1;
      depth -= 1;
      return;
    }
    while (true) {
      itemCount += 1;
      if (itemCount > MAX_BLUEPRINT_LIBRARY_JSON_ARRAY_ITEMS) {
        return syntax("maximum array length exceeded");
      }
      value();
      skip();
      const separator = charCodeAt(serialized, cursor);
      if (separator === 0x5d) {
        cursor += 1;
        depth -= 1;
        return;
      }
      if (separator !== 0x2c) return syntax("expected array separator");
      cursor += 1;
      skip();
    }
  };
  const object = (): void => {
    depth += 1;
    if (depth > MAX_BLUEPRINT_LIBRARY_JSON_DEPTH) {
      return syntax("maximum nesting depth exceeded");
    }
    cursor += 1;
    skip();
    if (charCodeAt(serialized, cursor) === 0x7d) {
      cursor += 1;
      depth -= 1;
      return;
    }
    const keys = new SET_CONSTRUCTOR<string>();
    let memberCount = 0;
    while (true) {
      const key = stringToken();
      bump();
      if (REFLECT_APPLY(SET_HAS, keys, [key]) as boolean) {
        return syntax(`duplicate member ${quote(key)}`);
      }
      REFLECT_APPLY(SET_ADD, keys, [key]);
      memberCount += 1;
      if (memberCount > MAX_BLUEPRINT_LIBRARY_JSON_OBJECT_MEMBERS) {
        return syntax("maximum object member count exceeded");
      }
      skip();
      if (charCodeAt(serialized, cursor) !== 0x3a) {
        return syntax("expected member colon");
      }
      cursor += 1;
      skip();
      value();
      skip();
      const separator = charCodeAt(serialized, cursor);
      if (separator === 0x7d) {
        cursor += 1;
        depth -= 1;
        return;
      }
      if (separator !== 0x2c) return syntax("expected object separator");
      cursor += 1;
      skip();
    }
  };
  value = (): void => {
    bump();
    skip();
    if (cursor >= length) return syntax("expected value");
    const code = charCodeAt(serialized, cursor);
    if (code === 0x22) {
      stringToken();
    } else if (code === 0x7b) {
      object();
    } else if (code === 0x5b) {
      array();
    } else if (code === 0x74) {
      literal("true");
    } else if (code === 0x66) {
      literal("false");
    } else if (code === 0x6e) {
      literal("null");
    } else if (code === 0x2d || digit(code)) {
      number();
    } else {
      return syntax("unexpected token");
    }
  };
  value();
  skip();
  if (cursor !== length) syntax("trailing content");
  return REFLECT_APPLY(JSON_PARSE, undefined, [serialized]) as unknown;
}

/**
 * Restores current v2 libraries or migrates v1 records. The only migration is
 * explicit and deterministic: v1's nullable single `icon` becomes a 0/1-item
 * `icons` array and its missing description becomes the empty string.
 */
export function restoreBlueprintLibrary(value: unknown): BlueprintLibrary {
  if (
    typeof value === "object" &&
    value !== null &&
    (REFLECT_APPLY(WEAK_SET_HAS, libraryBrand, [value]) as boolean)
  ) {
    return value as BlueprintLibrary;
  }
  const decoded = typeof value === "string" ? parseStrictJson(value) : value;
  const record = requireRecord(
    decoded,
    ["format", "version", "catalog", "selectedId", "entries"],
    "Blueprint library",
  );
  if (record.format !== BLUEPRINT_LIBRARY_FORMAT) {
    throw new TypeError(
      `Blueprint library format must be ${BLUEPRINT_LIBRARY_FORMAT}.`,
    );
  }
  if (
    record.version !== BLUEPRINT_LIBRARY_VERSION &&
    record.version !== LEGACY_BLUEPRINT_LIBRARY_VERSION
  ) {
    throw new TypeError(
      `Blueprint library version must be ${LEGACY_BLUEPRINT_LIBRARY_VERSION} or ${BLUEPRINT_LIBRARY_VERSION}.`,
    );
  }
  if (record.catalog !== CATALOG_VERSION) {
    throw new TypeError(
      `Blueprint library catalog must be ${CATALOG_VERSION}.`,
    );
  }
  const selectedId =
    record.selectedId === null
      ? null
      : canonicalId(record.selectedId, "Blueprint library.selectedId");
  const rawEntries = requireDenseArray(
    record.entries,
    MAX_BLUEPRINT_LIBRARY_RECORDS,
    "Blueprint library.entries",
  );
  const tracker: RestoreTracker = {
    ids: new SET_CONSTRUCTOR<string>(),
    recordCount: 0,
    entityCount: 0,
  };
  const entries: BlueprintLibraryEntry[] = [];
  for (let index = 0; index < rawEntries.length; index += 1) {
    writeArray(
      entries,
      index,
      restoreEntry(
        rawEntries[index],
        record.version,
        0,
        tracker,
        `Blueprint library.entries[${index}]`,
      ),
    );
  }
  if (
    selectedId !== null &&
    !(REFLECT_APPLY(SET_HAS, tracker.ids, [selectedId]) as boolean)
  ) {
    throw new TypeError(
      `Blueprint library.selectedId does not identify a record: ${selectedId}.`,
    );
  }
  const library = freezeLibrary(selectedId, entries);
  assertCanonicalByteLimit(library);
  return library;
}

/** Emits the single canonical v2 JSON byte representation. */
export function serializeBlueprintLibrary(value: BlueprintLibrary): string {
  const library = restoreBlueprintLibrary(value);
  const encoded = encodeLibrary(library);
  if (utf8ByteLength(encoded) > MAX_BLUEPRINT_LIBRARY_JSON_BYTES) {
    throw new RangeError(
      `Blueprint library JSON exceeds ${MAX_BLUEPRINT_LIBRARY_JSON_BYTES} bytes.`,
    );
  }
  return encoded;
}

/** Creates an empty, immutable v2 library. */
export function createBlueprintLibrary(): BlueprintLibrary {
  const library = freezeLibrary(null, []);
  assertCanonicalByteLimit(library);
  return library;
}

function findEntry(
  entries: readonly BlueprintLibraryEntry[],
  id: string,
  parentId: string | null = null,
): FoundEntry | undefined {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.id === id) return { entry, parentId, index };
    if (entry.kind === "book") {
      const nested = findEntry(entry.entries, id, entry.id);
      if (nested) return nested;
    }
  }
  return undefined;
}

function requireFound(
  library: BlueprintLibrary,
  idValue: unknown,
): FoundEntry {
  const id = canonicalId(idValue, "Blueprint library entry id");
  const found = findEntry(library.entries, id);
  if (!found) {
    throw new BlueprintLibraryOperationError(
      BlueprintLibraryOperationErrorCode.EntryNotFound,
      `Blueprint library entry was not found: ${id}.`,
    );
  }
  return found;
}

function requireParent(
  library: BlueprintLibrary,
  parentIdValue: unknown,
): BlueprintLibraryBookEntry | null {
  if (parentIdValue === null) return null;
  const parentId = canonicalId(
    parentIdValue,
    "Blueprint library parent id",
  );
  const found = findEntry(library.entries, parentId);
  if (!found) {
    throw new BlueprintLibraryOperationError(
      BlueprintLibraryOperationErrorCode.ParentNotFound,
      `Blueprint library parent was not found: ${parentId}.`,
    );
  }
  if (found.entry.kind !== "book") {
    throw new BlueprintLibraryOperationError(
      BlueprintLibraryOperationErrorCode.ParentNotBook,
      `Blueprint library parent is not a book: ${parentId}.`,
    );
  }
  return found.entry;
}

function restoreDraft(value: unknown): BlueprintLibraryEntry {
  const candidate = requirePlainRecord(value, "Blueprint library entry draft");
  const kind = ownData(
    candidate,
    "kind",
    "Blueprint library entry draft",
  );
  const keys =
    kind === "blueprint"
      ? ["kind", "id", "name", "description", "icons", "blueprint"]
      : kind === "book"
        ? ["kind", "id", "name", "description", "icons"]
        : undefined;
  if (!keys) {
    throw new TypeError(
      "Blueprint library entry draft.kind must be blueprint or book.",
    );
  }
  const record = requireRecord(
    candidate,
    keys,
    "Blueprint library entry draft",
  );
  const id = canonicalId(record.id, "Blueprint library entry draft.id");
  const name = canonicalName(
    record.name,
    "Blueprint library entry draft.name",
  );
  const description = canonicalDescription(
    record.description,
    "Blueprint library entry draft.description",
  );
  const icons = restoreIcons(
    record.icons,
    "Blueprint library entry draft.icons",
  );
  return kind === "blueprint"
    ? freezeBlueprintEntry(
        id,
        name,
        description,
        icons,
        restoreEmbeddedBlueprint(
          record.blueprint,
          "Blueprint library entry draft.blueprint",
        ),
      )
    : freezeBookEntry(id, name, description, icons, []);
}

function cloneBookWithEntries(
  book: BlueprintLibraryBookEntry,
  entries: readonly BlueprintLibraryEntry[],
): BlueprintLibraryBookEntry {
  return freezeBookEntry(
    book.id,
    book.name,
    book.description,
    book.icons,
    entries,
  );
}

function insertIntoParent(
  entries: readonly BlueprintLibraryEntry[],
  parentId: string | null,
  index: number,
  inserted: BlueprintLibraryEntry,
): readonly BlueprintLibraryEntry[] {
  if (parentId === null) {
    return OBJECT_FREEZE(insertAt(entries, index, inserted));
  }
  const next: BlueprintLibraryEntry[] = [];
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex]!;
    if (entry.id === parentId) {
      if (entry.kind !== "book") {
        throw new Error("Validated blueprint library parent changed kind.");
      }
      append(
        next,
        cloneBookWithEntries(
          entry,
          insertAt(entry.entries, index, inserted),
        ),
      );
    } else if (entry.kind === "book") {
      const nested = findEntry(entry.entries, parentId);
      append(
        next,
        nested
          ? cloneBookWithEntries(
              entry,
              insertIntoParent(entry.entries, parentId, index, inserted),
            )
          : entry,
      );
    } else {
      append(next, entry);
    }
  }
  return OBJECT_FREEZE(next);
}

function replaceEntry(
  entries: readonly BlueprintLibraryEntry[],
  id: string,
  replacement: BlueprintLibraryEntry,
): readonly BlueprintLibraryEntry[] {
  const next: BlueprintLibraryEntry[] = [];
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex]!;
    if (entry.id === id) {
      append(next, replacement);
    } else if (entry.kind === "book" && findEntry(entry.entries, id)) {
      append(
        next,
        cloneBookWithEntries(
          entry,
          replaceEntry(entry.entries, id, replacement),
        ),
      );
    } else {
      append(next, entry);
    }
  }
  return OBJECT_FREEZE(next);
}

function removeEntry(
  entries: readonly BlueprintLibraryEntry[],
  id: string,
): readonly BlueprintLibraryEntry[] {
  const next: BlueprintLibraryEntry[] = [];
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex]!;
    if (entry.id === id) continue;
    if (entry.kind === "book" && findEntry(entry.entries, id)) {
      append(
        next,
        cloneBookWithEntries(entry, removeEntry(entry.entries, id)),
      );
    } else {
      append(next, entry);
    }
  }
  return OBJECT_FREEZE(next);
}

function collectIds(
  entry: BlueprintLibraryEntry,
  target: string[] = [],
): string[] {
  append(target, entry.id);
  if (entry.kind === "book") {
    for (let index = 0; index < entry.entries.length; index += 1) {
      collectIds(entry.entries[index]!, target);
    }
  }
  return target;
}

function assertAggregate(library: BlueprintLibrary): void {
  const tracker: RestoreTracker = {
    ids: new SET_CONSTRUCTOR<string>(),
    recordCount: 0,
    entityCount: 0,
  };
  const visit = (
    entries: readonly BlueprintLibraryEntry[],
    parentBookDepth: number,
  ): void => {
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;
      if (REFLECT_APPLY(SET_HAS, tracker.ids, [entry.id]) as boolean) {
        throw new TypeError(`Blueprint library contains duplicate id ${entry.id}.`);
      }
      REFLECT_APPLY(SET_ADD, tracker.ids, [entry.id]);
      tracker.recordCount += 1;
      if (tracker.recordCount > MAX_BLUEPRINT_LIBRARY_RECORDS) {
        throw new RangeError(
          `Blueprint library exceeds ${MAX_BLUEPRINT_LIBRARY_RECORDS} records.`,
        );
      }
      if (entry.kind === "blueprint") {
        tracker.entityCount += entry.blueprint.entities.length;
        if (tracker.entityCount > MAX_BLUEPRINT_LIBRARY_ENTITIES) {
          throw new RangeError(
            `Blueprint library exceeds ${MAX_BLUEPRINT_LIBRARY_ENTITIES} construction entities.`,
          );
        }
      } else {
        const depth = parentBookDepth + 1;
        if (depth > MAX_BLUEPRINT_LIBRARY_BOOK_DEPTH) {
          throw new RangeError(
            `Blueprint books exceed depth ${MAX_BLUEPRINT_LIBRARY_BOOK_DEPTH}.`,
          );
        }
        visit(entry.entries, depth);
      }
    }
  };
  visit(library.entries, 0);
  if (
    library.selectedId !== null &&
    !(REFLECT_APPLY(SET_HAS, tracker.ids, [library.selectedId]) as boolean)
  ) {
    throw new TypeError(
      `Blueprint library selection is missing: ${library.selectedId}.`,
    );
  }
  assertCanonicalByteLimit(library);
}

function completeMutation(
  selectedId: string | null,
  entries: readonly BlueprintLibraryEntry[],
): BlueprintLibrary {
  const library = freezeLibrary(selectedId, entries);
  assertAggregate(library);
  return library;
}

function encodedSelectionByteLength(id: string | null): number {
  return utf8ByteLength(id === null ? "null" : quote(id));
}

/**
 * Selection changes do not alter the immutable tree or any aggregate count.
 * Reuse the already-validated frozen entries and update the cached canonical
 * byte count by the exact selected-id delta, avoiding a multi-megabyte encode.
 */
function completeSelection(
  library: BlueprintLibrary,
  selectedId: string | null,
): BlueprintLibrary {
  let currentBytes = REFLECT_APPLY(
    WEAK_MAP_GET,
    libraryJsonBytes,
    [library],
  ) as number | undefined;
  if (currentBytes === undefined) {
    assertCanonicalByteLimit(library);
    currentBytes = REFLECT_APPLY(
      WEAK_MAP_GET,
      libraryJsonBytes,
      [library],
    ) as number;
  }
  const nextBytes =
    currentBytes -
    encodedSelectionByteLength(library.selectedId) +
    encodedSelectionByteLength(selectedId);
  if (nextBytes > MAX_BLUEPRINT_LIBRARY_JSON_BYTES) {
    throw new RangeError(
      `Blueprint library JSON exceeds ${MAX_BLUEPRINT_LIBRARY_JSON_BYTES} bytes.`,
    );
  }
  const selected = freezeLibrary(selectedId, library.entries, true);
  REFLECT_APPLY(WEAK_MAP_SET, libraryJsonBytes, [selected, nextBytes]);
  return selected;
}

/**
 * Inserts one caller-identified record at an explicit final index. Books are
 * created empty; existing trees enter through strict restore/import instead.
 */
export function createBlueprintLibraryEntry(
  value: BlueprintLibrary,
  parentId: string | null,
  indexValue: number,
  draftValue: BlueprintLibraryEntryDraft,
): BlueprintLibrary {
  const library = restoreBlueprintLibrary(value);
  const parent = requireParent(library, parentId);
  const index = canonicalIndex(
    indexValue,
    parent?.entries.length ?? library.entries.length,
    "Blueprint library insertion index",
  );
  const draft = restoreDraft(draftValue);
  if (findEntry(library.entries, draft.id)) {
    throw new BlueprintLibraryOperationError(
      BlueprintLibraryOperationErrorCode.DuplicateId,
      `Blueprint library id already exists: ${draft.id}.`,
    );
  }
  return completeMutation(
    library.selectedId,
    insertIntoParent(
      library.entries,
      parent?.id ?? null,
      index,
      draft,
    ),
  );
}

/** Updates editable metadata or an embedded blueprint without changing identity. */
export function updateBlueprintLibraryEntry(
  value: BlueprintLibrary,
  id: string,
  updateValue: BlueprintLibraryEntryUpdate,
): BlueprintLibrary {
  const library = restoreBlueprintLibrary(value);
  const found = requireFound(library, id);
  const update = requireSubsetRecord(
    updateValue,
    ["name", "description", "icons", "blueprint"],
    "Blueprint library entry update",
  );
  const names = OBJECT_GET_OWN_PROPERTY_NAMES(update);
  if (names.length === 0) {
    throw new BlueprintLibraryOperationError(
      BlueprintLibraryOperationErrorCode.EmptyUpdate,
      "Blueprint library entry update must contain at least one field.",
    );
  }
  if (hasOwn(update, "blueprint") && found.entry.kind !== "blueprint") {
    throw new BlueprintLibraryOperationError(
      BlueprintLibraryOperationErrorCode.WrongEntryKind,
      `Blueprint library book ${found.entry.id} cannot store a blueprint.`,
    );
  }
  const name = hasOwn(update, "name")
    ? canonicalName(update.name, "Blueprint library entry update.name")
    : found.entry.name;
  const description = hasOwn(update, "description")
    ? canonicalDescription(
        update.description,
        "Blueprint library entry update.description",
      )
    : found.entry.description;
  const icons = hasOwn(update, "icons")
    ? restoreIcons(update.icons, "Blueprint library entry update.icons")
    : found.entry.icons;
  const replacement =
    found.entry.kind === "blueprint"
      ? freezeBlueprintEntry(
          found.entry.id,
          name,
          description,
          icons,
          hasOwn(update, "blueprint")
            ? restoreEmbeddedBlueprint(
                update.blueprint,
                "Blueprint library entry update.blueprint",
              )
            : found.entry.blueprint,
        )
      : freezeBookEntry(
          found.entry.id,
          name,
          description,
          icons,
          found.entry.entries,
        );
  return completeMutation(
    library.selectedId,
    replaceEntry(library.entries, found.entry.id, replacement),
  );
}

/**
 * Duplicates a record or complete book subtree. `newIds` is required in
 * deterministic pre-order (source record first), so the kernel never invents
 * identity or randomness.
 */
export function duplicateBlueprintLibraryEntry(
  value: BlueprintLibrary,
  sourceId: string,
  newIdsValue: readonly string[],
  parentId: string | null,
  indexValue: number,
): BlueprintLibrary {
  const library = restoreBlueprintLibrary(value);
  const source = requireFound(library, sourceId).entry;
  const parent = requireParent(library, parentId);
  const index = canonicalIndex(
    indexValue,
    parent?.entries.length ?? library.entries.length,
    "Blueprint library duplicate index",
  );
  const sourceIds = collectIds(source);
  const rawNewIds = requireDenseArray(
    newIdsValue,
    MAX_BLUEPRINT_LIBRARY_RECORDS,
    "Blueprint library duplicate ids",
  );
  if (rawNewIds.length !== sourceIds.length) {
    throw new BlueprintLibraryOperationError(
      BlueprintLibraryOperationErrorCode.DuplicateIdCount,
      `Blueprint library duplicate requires ${sourceIds.length} caller-supplied ids.`,
    );
  }
  const newIds: string[] = [];
  const seen = new SET_CONSTRUCTOR<string>();
  for (let offset = 0; offset < rawNewIds.length; offset += 1) {
    const newId = canonicalId(
      rawNewIds[offset],
      `Blueprint library duplicate ids[${offset}]`,
    );
    if (
      findEntry(library.entries, newId) ||
      (REFLECT_APPLY(SET_HAS, seen, [newId]) as boolean)
    ) {
      throw new BlueprintLibraryOperationError(
        BlueprintLibraryOperationErrorCode.DuplicateId,
        `Blueprint library duplicate id is not unique: ${newId}.`,
      );
    }
    REFLECT_APPLY(SET_ADD, seen, [newId]);
    writeArray(newIds, offset, newId);
  }
  let cursor = 0;
  const duplicate = (
    entry: BlueprintLibraryEntry,
  ): BlueprintLibraryEntry => {
    const newId = newIds[cursor++]!;
    return entry.kind === "blueprint"
      ? freezeBlueprintEntry(
          newId,
          entry.name,
          entry.description,
          entry.icons,
          entry.blueprint,
        )
      : (() => {
          const duplicatedEntries: BlueprintLibraryEntry[] = [];
          for (
            let index = 0;
            index < entry.entries.length;
            index += 1
          ) {
            writeArray(
              duplicatedEntries,
              index,
              duplicate(entry.entries[index]!),
            );
          }
          return freezeBookEntry(
            newId,
            entry.name,
            entry.description,
            entry.icons,
            duplicatedEntries,
          );
        })();
  };
  return completeMutation(
    library.selectedId,
    insertIntoParent(
      library.entries,
      parent?.id ?? null,
      index,
      duplicate(source),
    ),
  );
}

/**
 * Moves an existing record. `index` is interpreted in the destination's final
 * child array after the source subtree has been removed.
 */
export function moveBlueprintLibraryEntry(
  value: BlueprintLibrary,
  id: string,
  parentId: string | null,
  indexValue: number,
): BlueprintLibrary {
  const library = restoreBlueprintLibrary(value);
  const found = requireFound(library, id);
  const sourceIds = collectIds(found.entry);
  let movesIntoSource = false;
  if (parentId !== null) {
    for (let index = 0; index < sourceIds.length; index += 1) {
      if (sourceIds[index] === parentId) {
        movesIntoSource = true;
        break;
      }
    }
  }
  if (movesIntoSource) {
    throw new BlueprintLibraryOperationError(
      BlueprintLibraryOperationErrorCode.MoveCycle,
      `Blueprint library entry ${found.entry.id} cannot move into its own subtree.`,
    );
  }
  const withoutSource = removeEntry(library.entries, found.entry.id);
  const temporary = freezeLibrary(library.selectedId, withoutSource);
  const parent = requireParent(temporary, parentId);
  const index = canonicalIndex(
    indexValue,
    parent?.entries.length ?? withoutSource.length,
    "Blueprint library move index",
  );
  return completeMutation(
    library.selectedId,
    insertIntoParent(
      withoutSource,
      parent?.id ?? null,
      index,
      found.entry,
    ),
  );
}

/** Deletes one record/subtree and clears selection only when it was deleted. */
export function deleteBlueprintLibraryEntry(
  value: BlueprintLibrary,
  id: string,
): BlueprintLibrary {
  const library = restoreBlueprintLibrary(value);
  const found = requireFound(library, id);
  const removedIds = new SET_CONSTRUCTOR<string>();
  const removedIdValues = collectIds(found.entry);
  for (let index = 0; index < removedIdValues.length; index += 1) {
    REFLECT_APPLY(SET_ADD, removedIds, [removedIdValues[index]!]);
  }
  const selectedId =
    library.selectedId !== null &&
    (REFLECT_APPLY(SET_HAS, removedIds, [library.selectedId]) as boolean)
      ? null
      : library.selectedId;
  return completeMutation(
    selectedId,
    removeEntry(library.entries, found.entry.id),
  );
}

/** Selects any existing record, or explicitly clears selection with `null`. */
export function selectBlueprintLibraryEntry(
  value: BlueprintLibrary,
  idValue: string | null,
): BlueprintLibrary {
  const library = restoreBlueprintLibrary(value);
  if (idValue === null) {
    return library.selectedId === null
      ? library
      : completeSelection(library, null);
  }
  const found = requireFound(library, idValue);
  return library.selectedId === found.entry.id
    ? library
    : completeSelection(library, found.entry.id);
}
