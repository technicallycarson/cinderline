/**
 * Pure, deterministic factory blueprints.
 *
 * Blueprints contain construction intent only. Entity identity, inventories,
 * transport custody, production progress, power state, and animation state are
 * deliberately outside this format.
 */

import {
  CATALOG_VERSION,
  ENTITY_KINDS,
  ENTITY_PROTOTYPES,
  ITEM_IDS,
  PLAYER_BUILD_KINDS,
  RECIPE_IDS,
  RECIPES,
} from "./catalog";
import {
  CIRCUIT_SIGNAL_TYPES,
  type CircuitArithmeticOperator,
  type CircuitComparisonOperator,
  type CircuitCondition,
  type CircuitFrame,
  type CircuitOperand,
  type CircuitSelector,
  type CircuitSignal,
  type CircuitSignalValue,
  type CircuitSorterRoute,
  type CircuitWire,
} from "./circuit-network";
import {
  CIRCUIT_SORTER_OUTPUT_A,
  CIRCUIT_SORTER_OUTPUT_B,
  CIRCUIT_WIRE_REACH_TILES,
  circuitEndpointBindings,
  circuitMachineCapabilities,
  defaultCircuitDeviceConfiguration,
  isCircuitMachineKind,
} from "./circuit-integration";
import {
  RAIL_LIMITS,
  createRailGraph,
  railSegmentPorts,
  type RailNetworkInput,
  type RailNetworkSnapshot,
  type RailScheduleStop,
  type RailSegmentKind,
  type RailSignalType,
  type RailWaitCondition,
} from "./rail-network";
import {
  Direction,
  ManifoldMode,
  type CircuitConnector,
  type CircuitDeviceConfiguration,
  type CircuitEntityKind,
  type CircuitMachinePortConfiguration,
  type CircuitSimulationSnapshot,
  type EntityKind,
  type EntityState,
  type FluidId,
  type FluidRecipeId,
  type ItemId,
  type RailStationStorageInterface,
  type RailStationTransferMode,
  type RecipeId,
} from "./types";

const ARRAY_IS_ARRAY = Array.isArray;
const ARRAY_PROTOTYPE = Array.prototype;
const JSON_PARSE = JSON.parse;
const JSON_STRINGIFY = JSON.stringify;
const NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger;
const OBJECT_CREATE = Object.create;
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
const STRING_CHAR_CODE_AT = String.prototype.charCodeAt;
const STRING_SLICE = String.prototype.slice;

export const BLUEPRINT_FORMAT = "cinderline-blueprint" as const;
export const BLUEPRINT_VERSION = 3 as const;
const LEGACY_BLUEPRINT_VERSION_1 = 1 as const;
const LEGACY_BLUEPRINT_VERSION_2 = 2 as const;
export const MAX_BLUEPRINT_ENTITIES = 4_096;
export const MAX_BLUEPRINT_WIRES = 8_192;
export const MAX_BLUEPRINT_CIRCUIT_SIGNALS = 128;
export const MAX_BLUEPRINT_RAIL_SEGMENTS = RAIL_LIMITS.maxSegments;
export const MAX_BLUEPRINT_RAIL_SIGNALS = RAIL_LIMITS.maxSignals;
export const MAX_BLUEPRINT_RAIL_STATIONS = RAIL_LIMITS.maxStations;
export const MAX_BLUEPRINT_RAIL_TRAINS = RAIL_LIMITS.maxTrains;
export const MAX_BLUEPRINT_RAIL_CARS_PER_TRAIN =
  RAIL_LIMITS.maxCarsPerTrain;
export const MAX_BLUEPRINT_RAIL_SCHEDULE_STOPS =
  RAIL_LIMITS.maxScheduleStops;
export const MAX_BLUEPRINT_RAIL_ITEM_FILTERS = RAIL_LIMITS.maxCargoKinds;
export const MAX_BLUEPRINT_SPAN = 1_024;
export const MAX_BLUEPRINT_JSON_LENGTH = 1_048_576;
export const MAX_BLUEPRINT_CAPTURE_CANDIDATES = 65_536;
export const MAX_BLUEPRINT_JSON_DEPTH = 64;
export const MAX_BLUEPRINT_JSON_OBJECT_MEMBERS = 64;

const VALID_ENTITY_KINDS: readonly EntityKind[] = OBJECT_FREEZE(
  [
    ...ENTITY_KINDS,
    ...PLAYER_BUILD_KINDS.filter(
      (kind) => !ENTITY_KINDS.includes(
        kind as (typeof ENTITY_KINDS)[number],
      ),
    ),
  ],
);
const VALID_LEGACY_ENTITY_KINDS: readonly EntityKind[] = OBJECT_FREEZE(
  ENTITY_KINDS.map((kind) => kind),
);
const VALID_ITEM_IDS: readonly ItemId[] = OBJECT_FREEZE(
  ITEM_IDS.map((item) => item),
);
const VALID_RECIPE_IDS: readonly RecipeId[] = OBJECT_FREEZE(
  RECIPE_IDS.map((recipeId) => recipeId),
);
const CAPTURED_FOOTPRINTS = OBJECT_CREATE(null) as Record<
  EntityKind,
  { readonly width: number; readonly height: number }
>;
for (let index = 0; index < VALID_ENTITY_KINDS.length; index += 1) {
  const kind = VALID_ENTITY_KINDS[index]!;
  const source = ENTITY_PROTOTYPES[kind].footprint;
  CAPTURED_FOOTPRINTS[kind] = OBJECT_FREEZE({
    width: source.width,
    height: source.height,
  });
}
OBJECT_FREEZE(CAPTURED_FOOTPRINTS);
const CAPTURED_RECIPE_MACHINES = OBJECT_CREATE(null) as Record<
  RecipeId,
  "smelter" | "fabricator"
>;
for (let index = 0; index < VALID_RECIPE_IDS.length; index += 1) {
  const recipeId = VALID_RECIPE_IDS[index]!;
  CAPTURED_RECIPE_MACHINES[recipeId] = RECIPES[recipeId].machine;
}
OBJECT_FREEZE(CAPTURED_RECIPE_MACHINES);

export type BlueprintMirror = "horizontal" | "vertical";
export type BlueprintQuarterTurns = 0 | 1 | 2 | 3;

export interface BlueprintSelection {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BlueprintManifoldRouting {
  readonly mode: ManifoldMode;
  readonly filter: ItemId | null;
  /**
   * Matching output retained across routing-mode changes. It is latent user
   * configuration outside Extract mode and therefore remains blueprint intent.
   */
  readonly extractPort: 0 | 1;
}

export type BlueprintCircuitDeviceConfiguration =
  | {
      readonly kind: "constant";
      readonly signals: CircuitFrame;
      readonly enabled: boolean;
    }
  | {
      readonly kind: "arithmetic";
      readonly left: CircuitOperand;
      readonly operator: CircuitArithmeticOperator;
      readonly right: CircuitOperand;
      readonly output: CircuitSignal | { readonly wildcard: "each" };
    }
  | {
      readonly kind: "decider";
      readonly condition: CircuitCondition;
      readonly output: CircuitSignal | { readonly wildcard: "each" };
      readonly outputMode: "one" | "inputCount";
    };

export interface BlueprintCircuitMachineFilter {
  readonly candidates: readonly CircuitSignal[] | null;
  readonly minimum: number;
}

export interface BlueprintCircuitMachineConfiguration {
  readonly enableCondition: CircuitCondition | null;
  readonly powerSwitchCondition: CircuitCondition | null;
  readonly filter: BlueprintCircuitMachineFilter | null;
  readonly sorterRoutes: readonly CircuitSorterRoute[];
  readonly sorterFallback:
    | typeof CIRCUIT_SORTER_OUTPUT_A
    | typeof CIRCUIT_SORTER_OUTPUT_B
    | null;
}

export interface BlueprintEntity {
  /** Canonical blueprint-local reference; always equals canonical array index. */
  readonly ref: number;
  /** Canonical tile anchor relative to the blueprint's top-left occupied tile. */
  readonly x: number;
  readonly y: number;
  readonly kind: EntityKind;
  readonly direction: Direction;
  readonly recipeId: RecipeId | null;
  readonly manifoldRouting: BlueprintManifoldRouting | null;
  readonly fluidId: FluidId | null;
  readonly fluidRecipeId: FluidRecipeId | null;
  readonly circuitDevice: BlueprintCircuitDeviceConfiguration | null;
  readonly circuitMachine: BlueprintCircuitMachineConfiguration | null;
}

export interface BlueprintCircuitEndpoint {
  readonly entityRef: number;
  readonly connector: CircuitConnector;
}

export interface BlueprintCircuitWire {
  readonly color: "red" | "green";
  readonly endpointA: BlueprintCircuitEndpoint;
  readonly endpointB: BlueprintCircuitEndpoint;
}

export interface BlueprintRailSegment {
  /** Canonical blueprint-local segment reference. */
  readonly ref: number;
  readonly x: number;
  readonly y: number;
  readonly kind: RailSegmentKind;
  readonly rotation: 0 | 1 | 2 | 3;
}

export interface BlueprintRailSignal {
  readonly fromSegmentRef: number;
  readonly toSegmentRef: number;
  readonly type: RailSignalType;
}

export interface BlueprintRailStorageBinding {
  readonly entityRef: number;
  readonly mode: RailStationTransferMode;
  readonly transferRate: number;
  /** Null preserves the runtime's unrestricted (absent-filter) semantics. */
  readonly itemFilter: readonly ItemId[] | null;
}

export interface BlueprintRailStation {
  /** Canonical blueprint-local station reference. */
  readonly ref: number;
  readonly segmentRef: number;
  readonly capacity: number;
  readonly storageBinding: BlueprintRailStorageBinding | null;
}

export type BlueprintRailCar =
  | {
      readonly kind: "locomotive";
      /** Construction-time tank capacity only; current fuel is never captured. */
      readonly fuelCapacityMilli: number;
    }
  | {
      readonly kind: "cargo-wagon";
      /** Construction-time wagon capacity only; cargo is never captured. */
      readonly capacity: number;
    };

export interface BlueprintRailScheduleStop {
  readonly stationRef: number;
  readonly wait: RailWaitCondition;
}

export interface BlueprintRailTrain {
  /** Canonical blueprint-local train reference. */
  readonly ref: number;
  /** Construction spawn segment, not runtime progress or reservation custody. */
  readonly segmentRef: number;
  readonly cars: readonly BlueprintRailCar[];
  readonly schedule: readonly BlueprintRailScheduleStop[];
}

export interface BlueprintRailIntent {
  readonly segments: readonly BlueprintRailSegment[];
  readonly signals: readonly BlueprintRailSignal[];
  readonly stations: readonly BlueprintRailStation[];
  readonly trains: readonly BlueprintRailTrain[];
}

export interface BlueprintCircuitCaptureSnapshot {
  readonly devices: CircuitSimulationSnapshot["devices"];
  readonly machinePorts: CircuitSimulationSnapshot["machinePorts"];
  readonly wires: readonly CircuitWire[];
}

export interface BlueprintRailCaptureSnapshot {
  readonly network: RailNetworkInput | RailNetworkSnapshot;
  readonly stationInterfaces?: readonly RailStationStorageInterface[];
}

export interface BlueprintCaptureOptions {
  readonly circuit?: BlueprintCircuitCaptureSnapshot;
  readonly rail?: BlueprintRailCaptureSnapshot;
}

export interface Blueprint {
  readonly format: typeof BLUEPRINT_FORMAT;
  readonly version: typeof BLUEPRINT_VERSION;
  readonly catalog: typeof CATALOG_VERSION;
  readonly width: number;
  readonly height: number;
  readonly entities: readonly BlueprintEntity[];
  readonly wires: readonly BlueprintCircuitWire[];
  readonly rail: BlueprintRailIntent;
}

export interface BlueprintTransform {
  /**
   * Reflection is applied in canonical blueprint space before clockwise
   * rotation. Horizontal mirrors left/right; vertical mirrors top/bottom.
   */
  readonly mirror?: BlueprintMirror;
  readonly quarterTurns?: BlueprintQuarterTurns;
}

export interface BlueprintPlacement {
  readonly ref: number;
  readonly x: number;
  readonly y: number;
  readonly kind: EntityKind;
  readonly direction: Direction;
  readonly recipeId: RecipeId | null;
  readonly manifoldRouting: BlueprintManifoldRouting | null;
  readonly fluidId: FluidId | null;
  readonly fluidRecipeId: FluidRecipeId | null;
  readonly circuitDevice: BlueprintCircuitDeviceConfiguration | null;
  readonly circuitMachine: BlueprintCircuitMachineConfiguration | null;
}

export interface BlueprintPlacementPlan {
  readonly width: number;
  readonly height: number;
  readonly placements: readonly BlueprintPlacement[];
  /** Always present on plans returned by v3; optional for old caller literals. */
  readonly wires?: readonly BlueprintCircuitWire[];
  /** Always present on plans returned by v3; optional for old caller literals. */
  readonly rail?: BlueprintRailIntent;
}

const blueprintBrand = new WeakSet<object>();

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

function contains<Value>(values: readonly Value[], target: unknown): target is Value {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === target) return true;
  }
  return false;
}

function ownData(
  value: object,
  key: string,
  label: string,
  required: boolean,
): unknown {
  const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
  if (descriptor === undefined) {
    if (!required) return undefined;
    throw new TypeError(`${label}.${key} must be an own data field.`);
  }
  if (!("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError(
      `${label}.${key} must be an enumerable own data field.`,
    );
  }
  return descriptor.value;
}

function requireRecord(
  value: unknown,
  expectedKeys: readonly string[],
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
  const names = OBJECT_GET_OWN_PROPERTY_NAMES(value);
  if (names.length !== expectedKeys.length) {
    throw new TypeError(
      `${label} must contain exactly: ${expectedKeys.join(", ")}.`,
    );
  }
  const snapshot = OBJECT_CREATE(null) as Record<string, unknown>;
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys[index]!;
    if (!contains(names, key)) {
      throw new TypeError(
        `${label} must contain exactly: ${expectedKeys.join(", ")}.`,
      );
    }
    snapshot[key] = ownData(value, key, label, true);
  }
  return snapshot;
}

function requireSubsetRecord(
  value: unknown,
  allowedKeys: readonly string[],
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
  const names = OBJECT_GET_OWN_PROPERTY_NAMES(value);
  const snapshot = OBJECT_CREATE(null) as Record<string, unknown>;
  for (let index = 0; index < names.length; index += 1) {
    const key = names[index]!;
    if (!contains(allowedKeys, key)) {
      throw new TypeError(`${label} contains unknown field ${key}.`);
    }
    snapshot[key] = ownData(value, key, label, true);
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
  const lengthDescriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, "length");
  if (
    lengthDescriptor === undefined
    || !("value" in lengthDescriptor)
    || typeof lengthDescriptor.value !== "number"
    || !NUMBER_IS_SAFE_INTEGER(lengthDescriptor.value)
    || lengthDescriptor.value < 0
  ) {
    throw new TypeError(`${label}.length must be a canonical array length.`);
  }
  const length = lengthDescriptor.value;
  if (length > maximumLength) {
    throw new RangeError(
      `${label} exceeds its limit of ${maximumLength} entries.`,
    );
  }
  if (
    OBJECT_GET_PROTOTYPE_OF(value) !== ARRAY_PROTOTYPE
    || OBJECT_GET_OWN_PROPERTY_SYMBOLS(value).length !== 0
  ) {
    throw new TypeError(`${label} must be an ordinary array.`);
  }
  const names = OBJECT_GET_OWN_PROPERTY_NAMES(value);
  if (names.length !== length + 1 || !contains(names, "length")) {
    throw new TypeError(`${label} must be dense and contain no extra fields.`);
  }
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    snapshot.push(ownData(value, String(index), label, true));
  }
  return snapshot;
}

function safeInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number"
    || !NUMBER_IS_SAFE_INTEGER(value)
    || OBJECT_IS(value, -0)
    || value < minimum
    || value > maximum
  ) {
    throw new TypeError(
      `${label} must be a canonical safe integer from ${minimum} to ${maximum}.`,
    );
  }
  return value;
}

function safeCoordinate(value: unknown, label: string): number {
  return safeInteger(value, label, Number.MIN_SAFE_INTEGER);
}

function checkedAdd(left: number, right: number, label: string): number {
  const result = left + right;
  if (!NUMBER_IS_SAFE_INTEGER(result) || OBJECT_IS(result, -0)) {
    throw new RangeError(`${label} exceeds the safe tile-coordinate range.`);
  }
  return result;
}

function entityKind(value: unknown, label: string): EntityKind {
  if (!contains(VALID_ENTITY_KINDS, value)) {
    throw new TypeError(`${label} is not a known entity kind.`);
  }
  return value;
}

function direction(value: unknown, label: string): Direction {
  if (
    typeof value !== "number"
    || !NUMBER_IS_SAFE_INTEGER(value)
    || OBJECT_IS(value, -0)
    || value < Direction.North
    || value > Direction.West
  ) {
    throw new TypeError(`${label} is not a canonical direction.`);
  }
  return value as Direction;
}

const CIRCUIT_ARITHMETIC_OPERATORS: readonly CircuitArithmeticOperator[] =
  OBJECT_FREEZE([
    "add",
    "subtract",
    "multiply",
    "divide",
    "modulo",
    "power",
    "leftShift",
    "rightShift",
    "bitAnd",
    "bitOr",
    "bitXor",
  ]);
const CIRCUIT_COMPARISON_OPERATORS: readonly CircuitComparisonOperator[] =
  OBJECT_FREEZE(["<", "<=", "==", "!=", ">=", ">"]);
const CIRCUIT_WILDCARDS = OBJECT_FREEZE(["each", "any", "every"] as const);
const CIRCUIT_SIGNAL_NAME_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fluidId(
  value: unknown,
  kind: EntityKind,
  label: string,
): FluidId | null {
  if (kind !== "fluidSource") {
    if (value !== null && value !== undefined) {
      throw new TypeError(`${label} is only valid for a fluid source.`);
    }
    return null;
  }
  if (value !== "crudeOil" && value !== "refinedFuel") {
    throw new TypeError(`${label} is not a known fluid source default.`);
  }
  return value;
}

function fluidRecipeId(
  value: unknown,
  kind: EntityKind,
  label: string,
): FluidRecipeId | null {
  if (kind !== "fluidProcessor") {
    if (value !== null && value !== undefined) {
      throw new TypeError(`${label} is only valid for a fluid processor.`);
    }
    return null;
  }
  if (value !== "refineCrude") {
    throw new TypeError(`${label} is not a known fluid processor recipe.`);
  }
  return value;
}

function circuitConnector(
  value: unknown,
  label: string,
): CircuitConnector {
  if (value !== "input" && value !== "output" && value !== "io") {
    throw new TypeError(`${label} is not a canonical circuit connector.`);
  }
  return value;
}

function freezeCircuitSignal(
  type: CircuitSignal["type"],
  name: string,
): CircuitSignal {
  return OBJECT_FREEZE({ type, name });
}

function restoreCircuitSignal(
  value: unknown,
  label: string,
): CircuitSignal {
  const record = requireRecord(value, ["type", "name"], label);
  if (!contains(CIRCUIT_SIGNAL_TYPES, record.type)) {
    throw new TypeError(`${label}.type is not a known circuit signal type.`);
  }
  if (
    typeof record.name !== "string"
    || !CIRCUIT_SIGNAL_NAME_PATTERN.test(record.name)
  ) {
    throw new TypeError(`${label}.name is not canonical.`);
  }
  if (
    record.type === "item"
    && !contains(VALID_ITEM_IDS, record.name)
  ) {
    throw new TypeError(`${label}.name is not a known item signal.`);
  }
  if (
    record.type === "fluid"
    && record.name !== "crudeOil"
    && record.name !== "refinedFuel"
  ) {
    throw new TypeError(`${label}.name is not a known fluid signal.`);
  }
  return freezeCircuitSignal(record.type, record.name);
}

function compareCircuitSignals(
  left: CircuitSignal,
  right: CircuitSignal,
): number {
  return compareText(left.type, right.type) || compareText(left.name, right.name);
}

function circuitSignalKey(value: CircuitSignal): string {
  return `${value.type}\u0000${value.name}`;
}

function freezeCircuitSelectorWildcard(
  wildcard: "each" | "any" | "every",
): { readonly wildcard: "each" | "any" | "every" } {
  return OBJECT_FREEZE({ wildcard });
}

function restoreCircuitSelector(
  value: unknown,
  label: string,
): CircuitSelector {
  const candidate = requireSubsetRecord(
    value,
    ["type", "name", "wildcard"],
    label,
  );
  if (candidate.wildcard !== undefined) {
    requireRecord(value, ["wildcard"], label);
    if (!contains(CIRCUIT_WILDCARDS, candidate.wildcard)) {
      throw new TypeError(`${label}.wildcard is invalid.`);
    }
    return freezeCircuitSelectorWildcard(candidate.wildcard);
  }
  return restoreCircuitSignal(value, label);
}

function freezeCircuitConstantOperand(
  value: number,
): Extract<CircuitOperand, { readonly kind: "constant" }> {
  return OBJECT_FREEZE({ kind: "constant", value });
}

function freezeCircuitSignalOperand(
  selector: CircuitSelector,
): Extract<CircuitOperand, { readonly kind: "signal" }> {
  return OBJECT_FREEZE({ kind: "signal", selector });
}

function restoreCircuitOperand(
  value: unknown,
  label: string,
): CircuitOperand {
  const candidate = requireSubsetRecord(
    value,
    ["kind", "value", "selector"],
    label,
  );
  if (candidate.kind === "constant") {
    const record = requireRecord(value, ["kind", "value"], label);
    return freezeCircuitConstantOperand(
      safeInteger(
        record.value,
        `${label}.value`,
        Number.MIN_SAFE_INTEGER,
      ),
    );
  }
  if (candidate.kind === "signal") {
    const record = requireRecord(value, ["kind", "selector"], label);
    return freezeCircuitSignalOperand(
      restoreCircuitSelector(record.selector, `${label}.selector`),
    );
  }
  throw new TypeError(`${label}.kind is not a known circuit operand kind.`);
}

function circuitSelectorWildcard(
  value: CircuitSelector,
): "each" | "any" | "every" | null {
  return "wildcard" in value ? value.wildcard : null;
}

function restoreCircuitCondition(
  value: unknown,
  label: string,
): CircuitCondition {
  const record = requireRecord(
    value,
    ["left", "operator", "right"],
    label,
  );
  const left = restoreCircuitSelector(record.left, `${label}.left`);
  if (!contains(CIRCUIT_COMPARISON_OPERATORS, record.operator)) {
    throw new TypeError(`${label}.operator is invalid.`);
  }
  const right = restoreCircuitOperand(record.right, `${label}.right`);
  if (
    right.kind === "signal"
    && circuitSelectorWildcard(right.selector) !== null
  ) {
    throw new TypeError(`${label}.right must use a concrete signal.`);
  }
  return OBJECT_FREEZE({ left, operator: record.operator, right });
}

function restoreCircuitOutput(
  value: unknown,
  label: string,
): CircuitSignal | { readonly wildcard: "each" } {
  const candidate = requireSubsetRecord(
    value,
    ["type", "name", "wildcard"],
    label,
  );
  if (candidate.wildcard !== undefined) {
    const record = requireRecord(value, ["wildcard"], label);
    if (record.wildcard !== "each") {
      throw new TypeError(`${label}.wildcard must be each.`);
    }
    return OBJECT_FREEZE({ wildcard: "each" as const });
  }
  return restoreCircuitSignal(value, label);
}

function circuitOperandUsesEach(value: CircuitOperand): boolean {
  return (
    value.kind === "signal"
    && circuitSelectorWildcard(value.selector) === "each"
  );
}

function circuitOperandUsesAggregate(value: CircuitOperand): boolean {
  if (value.kind !== "signal") return false;
  const wildcard = circuitSelectorWildcard(value.selector);
  return wildcard === "any" || wildcard === "every";
}

function canonicalCircuitFrame(
  value: unknown,
  label: string,
  requireCanonical: boolean,
): CircuitFrame {
  const source = requireDenseArray(
    value,
    MAX_BLUEPRINT_CIRCUIT_SIGNALS,
    label,
  );
  const input: CircuitSignalValue[] = [];
  const totals = new Map<
    string,
    { readonly signal: CircuitSignal; value: bigint }
  >();
  for (let index = 0; index < source.length; index += 1) {
    const entry = requireRecord(
      source[index],
      ["signal", "value"],
      `${label}[${index}]`,
    );
    const signal = restoreCircuitSignal(
      entry.signal,
      `${label}[${index}].signal`,
    );
    const amount = safeInteger(
      entry.value,
      `${label}[${index}].value`,
      Number.MIN_SAFE_INTEGER,
    );
    input.push(OBJECT_FREEZE({ signal, value: amount }));
    const key = circuitSignalKey(signal);
    const prior = totals.get(key);
    totals.set(key, {
      signal,
      value: (prior?.value ?? 0n) + BigInt(amount),
    });
  }
  const canonical: CircuitSignalValue[] = [];
  for (const entry of totals.values()) {
    if (entry.value === 0n) continue;
    const amount =
      entry.value > BigInt(Number.MAX_SAFE_INTEGER)
        ? Number.MAX_SAFE_INTEGER
        : entry.value < BigInt(Number.MIN_SAFE_INTEGER)
          ? Number.MIN_SAFE_INTEGER
          : Number(entry.value);
    canonical.push(OBJECT_FREEZE({ signal: entry.signal, value: amount }));
  }
  canonical.sort((left, right) =>
    compareCircuitSignals(left.signal, right.signal)
  );
  if (canonical.length > MAX_BLUEPRINT_CIRCUIT_SIGNALS) {
    throw new RangeError(
      `${label} exceeds ${MAX_BLUEPRINT_CIRCUIT_SIGNALS} canonical signals.`,
    );
  }
  if (requireCanonical) {
    if (input.length !== canonical.length) {
      throw new TypeError(`${label} must omit zero and duplicate signals.`);
    }
    for (let index = 0; index < input.length; index += 1) {
      const before = input[index]!;
      const after = canonical[index]!;
      if (
        compareCircuitSignals(before.signal, after.signal) !== 0
        || before.value !== after.value
      ) {
        throw new TypeError(`${label} is not canonically ordered.`);
      }
    }
  }
  return OBJECT_FREEZE(canonical);
}

function canonicalCircuitDeviceConfiguration(
  value: unknown,
  kind: EntityKind,
  label: string,
  requireCanonical: boolean,
): BlueprintCircuitDeviceConfiguration | null {
  const combinator =
    kind === "constantCombinator"
    || kind === "arithmeticCombinator"
    || kind === "deciderCombinator";
  if (!combinator) {
    if (value !== null && value !== undefined) {
      throw new TypeError(`${label} is only valid for a combinator.`);
    }
    return null;
  }
  if (value === null || value === undefined) {
    throw new TypeError(`${label} is required for ${kind}.`);
  }
  const candidate = requireSubsetRecord(
    value,
    [
      "kind",
      "signals",
      "enabled",
      "left",
      "operator",
      "right",
      "output",
      "condition",
      "outputMode",
    ],
    label,
  );
  if (kind === "constantCombinator") {
    const record = requireRecord(
      value,
      ["kind", "signals", "enabled"],
      label,
    );
    if (record.kind !== "constant" || typeof record.enabled !== "boolean") {
      throw new TypeError(`${label} is incompatible with ${kind}.`);
    }
    return OBJECT_FREEZE({
      kind: "constant" as const,
      signals: canonicalCircuitFrame(
        record.signals,
        `${label}.signals`,
        requireCanonical,
      ),
      enabled: record.enabled,
    });
  }
  if (kind === "arithmeticCombinator") {
    const record = requireRecord(
      value,
      ["kind", "left", "operator", "right", "output"],
      label,
    );
    if (
      record.kind !== "arithmetic"
      || !contains(CIRCUIT_ARITHMETIC_OPERATORS, record.operator)
    ) {
      throw new TypeError(`${label} is incompatible with ${kind}.`);
    }
    const left = restoreCircuitOperand(record.left, `${label}.left`);
    const right = restoreCircuitOperand(record.right, `${label}.right`);
    if (circuitOperandUsesAggregate(left) || circuitOperandUsesAggregate(right)) {
      throw new TypeError(
        `${label} arithmetic operands support only the each wildcard.`,
      );
    }
    const output = restoreCircuitOutput(record.output, `${label}.output`);
    if (
      "wildcard" in output
      && !circuitOperandUsesEach(left)
      && !circuitOperandUsesEach(right)
    ) {
      throw new TypeError(
        `${label} each output requires an each arithmetic operand.`,
      );
    }
    return OBJECT_FREEZE({
      kind: "arithmetic" as const,
      left,
      operator: record.operator,
      right,
      output,
    });
  }
  const record = requireRecord(
    value,
    ["kind", "condition", "output", "outputMode"],
    label,
  );
  if (
    record.kind !== "decider"
    || (record.outputMode !== "one" && record.outputMode !== "inputCount")
  ) {
    throw new TypeError(`${label} is incompatible with ${kind}.`);
  }
  return OBJECT_FREEZE({
    kind: "decider" as const,
    condition: restoreCircuitCondition(
      record.condition,
      `${label}.condition`,
    ),
    output: restoreCircuitOutput(record.output, `${label}.output`),
    outputMode: record.outputMode,
  });
}

function defaultBlueprintCircuitDevice(
  kind: CircuitEntityKind,
): BlueprintCircuitDeviceConfiguration {
  const source = defaultCircuitDeviceConfiguration(kind);
  return canonicalCircuitDeviceConfiguration(
    source.kind === "constant"
      ? {
          kind: source.kind,
          signals: source.signals,
          enabled: source.enabled ?? true,
        }
      : source,
    kind,
    `Default ${kind} configuration`,
    false,
  )!;
}

function canonicalCircuitMachineFilter(
  value: unknown,
  label: string,
  requireCanonical: boolean,
): BlueprintCircuitMachineFilter | null {
  if (value === null) return null;
  const record = requireRecord(value, ["candidates", "minimum"], label);
  const minimum = safeInteger(
    record.minimum,
    `${label}.minimum`,
    Number.MIN_SAFE_INTEGER,
  );
  let candidates: readonly CircuitSignal[] | null = null;
  if (record.candidates !== null) {
    const source = requireDenseArray(
      record.candidates,
      MAX_BLUEPRINT_CIRCUIT_SIGNALS,
      `${label}.candidates`,
    );
    const restored: CircuitSignal[] = [];
    for (let index = 0; index < source.length; index += 1) {
      const signal = restoreCircuitSignal(
        source[index],
        `${label}.candidates[${index}]`,
      );
      if (signal.type !== "item") {
        throw new TypeError(`${label}.candidates must be item signals.`);
      }
      restored.push(signal);
    }
    const sorted = restored.slice().sort(compareCircuitSignals);
    for (let index = 1; index < sorted.length; index += 1) {
      if (compareCircuitSignals(sorted[index - 1]!, sorted[index]!) === 0) {
        throw new TypeError(`${label}.candidates must be unique.`);
      }
    }
    if (requireCanonical) {
      for (let index = 0; index < restored.length; index += 1) {
        if (
          compareCircuitSignals(restored[index]!, sorted[index]!) !== 0
        ) {
          throw new TypeError(`${label}.candidates is not canonically ordered.`);
        }
      }
    }
    candidates = OBJECT_FREEZE(sorted);
  }
  return OBJECT_FREEZE({ candidates, minimum });
}

function compareSorterRoutes(
  left: CircuitSorterRoute,
  right: CircuitSorterRoute,
): number {
  return left.priority - right.priority || compareText(left.output, right.output);
}

function canonicalCircuitMachineConfiguration(
  value: unknown,
  kind: EntityKind,
  label: string,
  requireCanonical: boolean,
): BlueprintCircuitMachineConfiguration | null {
  const capabilities = circuitMachineCapabilities(kind);
  if (capabilities === null) {
    if (value !== null && value !== undefined) {
      throw new TypeError(`${label} is not supported by ${kind}.`);
    }
    return null;
  }
  if (value === null || value === undefined) {
    throw new TypeError(`${label} is required for ${kind}.`);
  }
  const record = requireRecord(
    value,
    [
      "enableCondition",
      "powerSwitchCondition",
      "filter",
      "sorterRoutes",
      "sorterFallback",
    ],
    label,
  );
  if (record.enableCondition !== null && !capabilities.enable) {
    throw new TypeError(`${label}.enableCondition is unsupported by ${kind}.`);
  }
  if (record.powerSwitchCondition !== null && !capabilities.powerSwitch) {
    throw new TypeError(
      `${label}.powerSwitchCondition is unsupported by ${kind}.`,
    );
  }
  if (record.filter !== null && !capabilities.filter) {
    throw new TypeError(`${label}.filter is unsupported by ${kind}.`);
  }
  const enableCondition =
    record.enableCondition === null
      ? null
      : restoreCircuitCondition(
          record.enableCondition,
          `${label}.enableCondition`,
        );
  const powerSwitchCondition =
    record.powerSwitchCondition === null
      ? null
      : restoreCircuitCondition(
          record.powerSwitchCondition,
          `${label}.powerSwitchCondition`,
        );
  const filter = canonicalCircuitMachineFilter(
    record.filter,
    `${label}.filter`,
    requireCanonical,
  );
  const sourceRoutes = requireDenseArray(
    record.sorterRoutes,
    MAX_BLUEPRINT_CIRCUIT_SIGNALS,
    `${label}.sorterRoutes`,
  );
  if (sourceRoutes.length > 0 && !capabilities.sorter) {
    throw new TypeError(`${label}.sorterRoutes is unsupported by ${kind}.`);
  }
  const routes: CircuitSorterRoute[] = [];
  for (let index = 0; index < sourceRoutes.length; index += 1) {
    const route = requireRecord(
      sourceRoutes[index],
      ["priority", "output", "condition"],
      `${label}.sorterRoutes[${index}]`,
    );
    const priority = safeInteger(
      route.priority,
      `${label}.sorterRoutes[${index}].priority`,
      Number.MIN_SAFE_INTEGER,
    );
    if (
      route.output !== CIRCUIT_SORTER_OUTPUT_A
      && route.output !== CIRCUIT_SORTER_OUTPUT_B
    ) {
      throw new TypeError(
        `${label}.sorterRoutes[${index}].output is invalid.`,
      );
    }
    routes.push(OBJECT_FREEZE({
      priority,
      output: route.output,
      condition: restoreCircuitCondition(
        route.condition,
        `${label}.sorterRoutes[${index}].condition`,
      ),
    }));
  }
  const sortedRoutes = routes.slice().sort(compareSorterRoutes);
  for (let index = 1; index < sortedRoutes.length; index += 1) {
    if (sortedRoutes[index - 1]!.priority === sortedRoutes[index]!.priority) {
      throw new TypeError(`${label}.sorterRoutes priorities must be unique.`);
    }
  }
  if (requireCanonical) {
    for (let index = 0; index < routes.length; index += 1) {
      if (routes[index] !== sortedRoutes[index]) {
        throw new TypeError(`${label}.sorterRoutes is not canonically ordered.`);
      }
    }
  }
  if (
    record.sorterFallback !== null
    && record.sorterFallback !== CIRCUIT_SORTER_OUTPUT_A
    && record.sorterFallback !== CIRCUIT_SORTER_OUTPUT_B
  ) {
    throw new TypeError(`${label}.sorterFallback is invalid.`);
  }
  if (record.sorterFallback !== null && !capabilities.sorter) {
    throw new TypeError(`${label}.sorterFallback is unsupported by ${kind}.`);
  }
  return OBJECT_FREEZE({
    enableCondition,
    powerSwitchCondition,
    filter,
    sorterRoutes: OBJECT_FREEZE(sortedRoutes),
    sorterFallback: record.sorterFallback,
  });
}

function defaultBlueprintCircuitMachine(
  kind: EntityKind,
): BlueprintCircuitMachineConfiguration | null {
  if (!isCircuitMachineKind(kind)) return null;
  return canonicalCircuitMachineConfiguration(
    {
      enableCondition: null,
      powerSwitchCondition: null,
      filter: null,
      sorterRoutes: [],
      sorterFallback: null,
    },
    kind,
    `Default ${kind} circuit machine configuration`,
    false,
  );
}

function footprint(
  kind: EntityKind,
  facing: Direction,
): { readonly width: number; readonly height: number } {
  const prototype = CAPTURED_FOOTPRINTS[kind];
  return facing === Direction.East || facing === Direction.West
    ? { width: prototype.height, height: prototype.width }
    : { width: prototype.width, height: prototype.height };
}

function recipe(
  value: unknown,
  kind: EntityKind,
  label: string,
): RecipeId | null {
  if (value === null || value === undefined) return null;
  if (!contains(VALID_RECIPE_IDS, value)) {
    throw new TypeError(`${label} is not a known recipe.`);
  }
  const recipeId = value as RecipeId;
  const expectedMachine =
    kind === "smelter" || kind === "fabricator" ? kind : null;
  if (
    expectedMachine === null
    || CAPTURED_RECIPE_MACHINES[recipeId] !== expectedMachine
  ) {
    throw new TypeError(`${label} is incompatible with ${kind}.`);
  }
  return recipeId;
}

function routingFromSource(
  value: unknown,
  kind: EntityKind,
  label: string,
): BlueprintManifoldRouting | null {
  if (kind !== "manifold") {
    if (value !== undefined && value !== null) {
      throw new TypeError(`${label} is only valid for a manifold.`);
    }
    return null;
  }
  if (value === undefined || value === null) {
    return freezeRouting(ManifoldMode.Even, null, 0);
  }
  if (typeof value !== "object" || value === null || ARRAY_IS_ARRAY(value)) {
    throw new TypeError(`${label} must be a routing record.`);
  }
  const mode = ownData(value, "mode", label, true);
  const filter = ownData(value, "filter", label, false);
  const extractPort = ownData(value, "extractPort", label, false);
  return validateAndFreezeRouting(
    mode,
    filter ?? null,
    extractPort ?? 0,
    label,
  );
}

function validateAndFreezeRouting(
  modeValue: unknown,
  filterValue: unknown,
  extractPortValue: unknown,
  label: string,
): BlueprintManifoldRouting {
  if (
    modeValue !== ManifoldMode.Even
    && modeValue !== ManifoldMode.FavorA
    && modeValue !== ManifoldMode.FavorB
    && modeValue !== ManifoldMode.Extract
  ) {
    throw new TypeError(`${label}.mode is not a known routing mode.`);
  }
  if (
    OBJECT_IS(extractPortValue, -0)
    || (extractPortValue !== 0 && extractPortValue !== 1)
  ) {
    throw new TypeError(
      `${label}.extractPort must be canonical local branch 0 or 1.`,
    );
  }
  let filter: ItemId | null = null;
  if (modeValue === ManifoldMode.Extract) {
    if (!contains(VALID_ITEM_IDS, filterValue)) {
      throw new TypeError(`${label}.filter is required for extract routing.`);
    }
    filter = filterValue;
  } else if (filterValue !== null && filterValue !== undefined) {
    throw new TypeError(`${label}.filter is only valid for extract routing.`);
  }
  return freezeRouting(modeValue, filter, extractPortValue);
}

function freezeRouting(
  mode: ManifoldMode,
  filter: ItemId | null,
  extractPort: 0 | 1,
): BlueprintManifoldRouting {
  return OBJECT_FREEZE({ mode, filter, extractPort });
}

function freezeEntity(
  ref: number,
  kind: EntityKind,
  x: number,
  y: number,
  facing: Direction,
  recipeId: RecipeId | null,
  manifoldRouting: BlueprintManifoldRouting | null,
  configuredFluidId: FluidId | null,
  configuredFluidRecipeId: FluidRecipeId | null,
  circuitDevice: BlueprintCircuitDeviceConfiguration | null,
  circuitMachine: BlueprintCircuitMachineConfiguration | null,
): BlueprintEntity {
  return OBJECT_FREEZE({
    ref,
    kind,
    x,
    y,
    direction: facing,
    recipeId,
    manifoldRouting,
    fluidId: configuredFluidId,
    fluidRecipeId: configuredFluidRecipeId,
    circuitDevice,
    circuitMachine,
  });
}

function compareEntities(left: BlueprintEntity, right: BlueprintEntity): number {
  if (left.y !== right.y) return left.y - right.y;
  if (left.x !== right.x) return left.x - right.x;
  const kindOrder =
    VALID_ENTITY_KINDS.indexOf(left.kind)
    - VALID_ENTITY_KINDS.indexOf(right.kind);
  if (kindOrder !== 0) return kindOrder;
  return left.direction - right.direction;
}

function freezeBlueprint(
  width: number,
  height: number,
  entities: BlueprintEntity[],
  wires: BlueprintCircuitWire[],
  rail: BlueprintRailIntent,
): Blueprint {
  const frozenEntities = OBJECT_FREEZE(entities.slice());
  const blueprint = OBJECT_FREEZE({
    format: BLUEPRINT_FORMAT,
    version: BLUEPRINT_VERSION,
    catalog: CATALOG_VERSION,
    width,
    height,
    entities: frozenEntities,
    wires: OBJECT_FREEZE(wires.slice()),
    rail,
  });
  blueprintBrand.add(blueprint);
  return blueprint;
}

function emptyRailIntent(): BlueprintRailIntent {
  return OBJECT_FREEZE({
    segments: OBJECT_FREEZE([] as BlueprintRailSegment[]),
    signals: OBJECT_FREEZE([] as BlueprintRailSignal[]),
    stations: OBJECT_FREEZE([] as BlueprintRailStation[]),
    trains: OBJECT_FREEZE([] as BlueprintRailTrain[]),
  });
}

function emptyBlueprint(): Blueprint {
  return freezeBlueprint(0, 0, [], [], emptyRailIntent());
}

function validateSelection(selection: BlueprintSelection): BlueprintSelection {
  const record = requireRecord(
    selection,
    ["x", "y", "width", "height"],
    "Blueprint selection",
  );
  const x = safeCoordinate(record.x, "Blueprint selection.x");
  const y = safeCoordinate(record.y, "Blueprint selection.y");
  const width = safeInteger(
    record.width,
    "Blueprint selection.width",
    0,
    MAX_BLUEPRINT_SPAN,
  );
  const height = safeInteger(
    record.height,
    "Blueprint selection.height",
    0,
    MAX_BLUEPRINT_SPAN,
  );
  checkedAdd(x, width, "Blueprint selection right edge");
  checkedAdd(y, height, "Blueprint selection bottom edge");
  return { x, y, width, height };
}

function requireCaptureRecord(
  value: unknown,
  label: string,
): object {
  if (typeof value !== "object" || value === null || ARRAY_IS_ARRAY(value)) {
    throw new TypeError(`${label} must be a plain capture record.`);
  }
  const prototype = OBJECT_GET_PROTOTYPE_OF(value);
  if (prototype !== OBJECT_PROTOTYPE && prototype !== null) {
    throw new TypeError(`${label} must have a plain prototype.`);
  }
  if (OBJECT_GET_OWN_PROPERTY_SYMBOLS(value).length !== 0) {
    throw new TypeError(`${label} must not contain symbol fields.`);
  }
  return value;
}

function sourceFluidDefaults(
  value: object,
  kind: EntityKind,
  label: string,
): {
  readonly fluidId: FluidId | null;
  readonly fluidRecipeId: FluidRecipeId | null;
} {
  if (kind !== "fluidSource" && kind !== "fluidProcessor") {
    return { fluidId: null, fluidRecipeId: null };
  }
  const stateValue = ownData(value, "fluidState", label, false);
  if (stateValue === undefined) {
    return {
      fluidId: kind === "fluidSource" ? "crudeOil" : null,
      fluidRecipeId: kind === "fluidProcessor" ? "refineCrude" : null,
    };
  }
  const state = requireCaptureRecord(stateValue, `${label}.fluidState`);
  return {
    fluidId:
      kind === "fluidSource"
        ? fluidId(
            ownData(
              state,
              "sourceFluidId",
              `${label}.fluidState`,
              false,
            ) ?? "crudeOil",
            kind,
            `${label}.fluidId`,
          )
        : null,
    fluidRecipeId:
      kind === "fluidProcessor"
        ? fluidRecipeId(
            ownData(state, "recipeId", `${label}.fluidState`, false)
              ?? "refineCrude",
            kind,
            `${label}.fluidRecipeId`,
          )
        : null,
  };
}

function sourceEntity(
  value: unknown,
  index: number,
  requireRuntimeId: boolean,
): {
  readonly runtimeId: number | null;
  readonly x: number;
  readonly y: number;
  readonly kind: EntityKind;
  readonly direction: Direction;
  readonly recipeId: RecipeId | null;
  readonly manifoldRouting: BlueprintManifoldRouting | null;
  readonly fluidId: FluidId | null;
  readonly fluidRecipeId: FluidRecipeId | null;
  readonly circuitDevice: BlueprintCircuitDeviceConfiguration | null;
  readonly circuitMachine: BlueprintCircuitMachineConfiguration | null;
} {
  const label = `Blueprint capture entity ${index}`;
  const source = requireCaptureRecord(value, label);
  const runtimeId = requireRuntimeId
    ? safeInteger(ownData(source, "id", label, true), `${label}.id`, 0)
    : null;
  const kind = entityKind(ownData(source, "kind", label, true), `${label}.kind`);
  const facing = direction(
    ownData(source, "direction", label, true),
    `${label}.direction`,
  );
  const x = safeCoordinate(ownData(source, "x", label, true), `${label}.x`);
  const y = safeCoordinate(ownData(source, "y", label, true), `${label}.y`);
  const configuredRecipe = ownData(source, "recipeId", label, false);
  const queuedValue = ownData(source, "recipeChangeQueued", label, false);
  if (queuedValue !== undefined && typeof queuedValue !== "boolean") {
    throw new TypeError(`${label}.recipeChangeQueued must be boolean.`);
  }
  const queued = queuedValue === true;
  if (
    queued &&
    kind !== "smelter" &&
    kind !== "fabricator"
  ) {
    throw new TypeError(
      `${label}.recipeChangeQueued is only valid for a recipe machine.`,
    );
  }
  const pendingRecipe = queued
    ? ownData(source, "pendingRecipeId", label, false)
    : undefined;
  if (
    queued &&
    kind === "fabricator" &&
    (pendingRecipe === undefined || pendingRecipe === null)
  ) {
    throw new TypeError(
      `${label}.pendingRecipeId is required for a queued fabricator target.`,
    );
  }
  const recipeId = recipe(
    queued ? pendingRecipe : configuredRecipe,
    kind,
    `${label}.recipeId`,
  );
  const manifoldRouting = routingFromSource(
    ownData(source, "manifoldRouting", label, false),
    kind,
    `${label}.manifoldRouting`,
  );
  const fluid = sourceFluidDefaults(source, kind, label);
  return {
    runtimeId,
    kind,
    x,
    y,
    direction: facing,
    recipeId,
    manifoldRouting,
    fluidId: fluid.fluidId,
    fluidRecipeId: fluid.fluidRecipeId,
    circuitDevice:
      kind === "constantCombinator"
      || kind === "arithmeticCombinator"
      || kind === "deciderCombinator"
        ? defaultBlueprintCircuitDevice(kind)
        : null,
    circuitMachine: defaultBlueprintCircuitMachine(kind),
  };
}

interface BlueprintCaptureSourceEntity
  extends ReturnType<typeof sourceEntity> {
  readonly sourceIndex: number;
}

function parseCircuitRuntimeReference(
  value: unknown,
  suffix: "device" | "machine",
  label: string,
): number {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a canonical circuit runtime ID.`);
  }
  const match = new RegExp(`^entity:(0|[1-9][0-9]*):${suffix}$`).exec(value);
  if (match === null) {
    throw new TypeError(`${label} must be a canonical circuit runtime ID.`);
  }
  const id = Number(match[1]);
  return safeInteger(id, label, 0);
}

function parseCircuitRuntimeEndpoint(
  value: unknown,
  label: string,
): { readonly entityId: number; readonly connector: CircuitConnector } {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a canonical circuit endpoint ID.`);
  }
  const match =
    /^entity:(0|[1-9][0-9]*):(input|output|io)$/.exec(value);
  if (match === null) {
    throw new TypeError(`${label} must be a canonical circuit endpoint ID.`);
  }
  return {
    entityId: safeInteger(Number(match[1]), `${label} entity`, 0),
    connector: circuitConnector(match[2], `${label} connector`),
  };
}

function sourceCircuitDeviceConfiguration(
  value: unknown,
  index: number,
): {
  readonly entityId: number;
  readonly configuration: BlueprintCircuitDeviceConfiguration;
} {
  const label = `Blueprint circuit device ${index}`;
  const source = requireCaptureRecord(value, label);
  const kind = ownData(source, "kind", label, true);
  const entityId = parseCircuitRuntimeReference(
    ownData(source, "id", label, true),
    "device",
    `${label}.id`,
  );
  const inputEndpoint = `entity:${entityId}:input`;
  const outputEndpoint = `entity:${entityId}:output`;
  let entityKind: CircuitEntityKind;
  let configuration: CircuitDeviceConfiguration;
  if (kind === "constant") {
    entityKind = "constantCombinator";
    if (
      ownData(source, "outputEndpoint", label, true) !== outputEndpoint
    ) {
      throw new TypeError(`${label}.outputEndpoint does not match its entity.`);
    }
    configuration = {
      kind,
      signals: ownData(source, "signals", label, true) as CircuitFrame,
      enabled: ownData(source, "enabled", label, true) as boolean,
    };
  } else if (kind === "arithmetic") {
    entityKind = "arithmeticCombinator";
    if (
      ownData(source, "inputEndpoint", label, true) !== inputEndpoint
      || ownData(source, "outputEndpoint", label, true) !== outputEndpoint
    ) {
      throw new TypeError(`${label} endpoints do not match their entity.`);
    }
    configuration = {
      kind,
      left: ownData(source, "left", label, true) as CircuitOperand,
      operator: ownData(
        source,
        "operator",
        label,
        true,
      ) as CircuitArithmeticOperator,
      right: ownData(source, "right", label, true) as CircuitOperand,
      output: ownData(
        source,
        "output",
        label,
        true,
      ) as CircuitSignal | { readonly wildcard: "each" },
    };
  } else if (kind === "decider") {
    entityKind = "deciderCombinator";
    if (
      ownData(source, "inputEndpoint", label, true) !== inputEndpoint
      || ownData(source, "outputEndpoint", label, true) !== outputEndpoint
    ) {
      throw new TypeError(`${label} endpoints do not match their entity.`);
    }
    configuration = {
      kind,
      condition: ownData(source, "condition", label, true) as CircuitCondition,
      output: ownData(
        source,
        "output",
        label,
        true,
      ) as CircuitSignal | { readonly wildcard: "each" },
      outputMode: ownData(
        source,
        "outputMode",
        label,
        true,
      ) as "one" | "inputCount",
    };
  } else {
    throw new TypeError(`${label}.kind is not a known circuit device kind.`);
  }
  return {
    entityId,
    configuration: canonicalCircuitDeviceConfiguration(
      configuration,
      entityKind,
      `${label}.configuration`,
      false,
    )!,
  };
}

function sourceCircuitMachineConfiguration(
  value: unknown,
  index: number,
): {
  readonly entityId: number;
  readonly configuration: BlueprintCircuitMachineConfiguration;
} {
  const label = `Blueprint circuit machine port ${index}`;
  const source = requireCaptureRecord(value, label);
  const entityId = parseCircuitRuntimeReference(
    ownData(source, "id", label, true),
    "machine",
    `${label}.id`,
  );
  const endpoint = `entity:${entityId}:io`;
  if (
    ownData(source, "inputEndpoint", label, true) !== endpoint
    || ownData(source, "outputEndpoint", label, true) !== endpoint
  ) {
    throw new TypeError(`${label} endpoints do not match their entity.`);
  }
  const configuration = {
    enableCondition: ownData(source, "enableCondition", label, true),
    powerSwitchCondition: ownData(
      source,
      "powerSwitchCondition",
      label,
      true,
    ),
    filter: ownData(source, "filter", label, true),
    sorterRoutes: ownData(source, "sorterRoutes", label, true),
    sorterFallback: ownData(source, "sorterFallback", label, true),
  };
  return {
    entityId,
    // Capability validation is performed after resolving the entity kind.
    configuration: configuration as BlueprintCircuitMachineConfiguration,
  };
}

interface CapturedCircuitConfigurations {
  readonly devices: ReadonlyMap<
    number,
    BlueprintCircuitDeviceConfiguration
  >;
  readonly machines: ReadonlyMap<
    number,
    BlueprintCircuitMachineConfiguration
  >;
  readonly wires: readonly CircuitWire[];
}

function captureCircuitConfigurations(
  value: BlueprintCircuitCaptureSnapshot | undefined,
  sourceByRuntimeId: ReadonlyMap<number, BlueprintCaptureSourceEntity>,
): CapturedCircuitConfigurations {
  if (value === undefined) {
    return {
      devices: new Map(),
      machines: new Map(),
      wires: OBJECT_FREEZE([] as CircuitWire[]),
    };
  }
  const source = requireCaptureRecord(value, "Blueprint circuit snapshot");
  const deviceValues = requireDenseArray(
    ownData(source, "devices", "Blueprint circuit snapshot", true),
    MAX_BLUEPRINT_ENTITIES,
    "Blueprint circuit snapshot.devices",
  );
  const devices = new Map<number, BlueprintCircuitDeviceConfiguration>();
  for (let index = 0; index < deviceValues.length; index += 1) {
    const restored = sourceCircuitDeviceConfiguration(
      deviceValues[index],
      index,
    );
    const entity = sourceByRuntimeId.get(restored.entityId);
    if (entity === undefined) {
      throw new TypeError(
        `Blueprint circuit device ${index} references unknown entity ${restored.entityId}.`,
      );
    }
    const expectedKind =
      restored.configuration.kind === "constant"
        ? "constantCombinator"
        : restored.configuration.kind === "arithmetic"
          ? "arithmeticCombinator"
          : "deciderCombinator";
    if (entity.kind !== expectedKind) {
      throw new TypeError(
        `Blueprint circuit device ${index} is incompatible with ${entity.kind}.`,
      );
    }
    if (devices.has(restored.entityId)) {
      throw new TypeError(
        `Blueprint circuit snapshot duplicates device entity ${restored.entityId}.`,
      );
    }
    devices.set(restored.entityId, restored.configuration);
  }

  const portValues = requireDenseArray(
    ownData(source, "machinePorts", "Blueprint circuit snapshot", true),
    MAX_BLUEPRINT_ENTITIES,
    "Blueprint circuit snapshot.machinePorts",
  );
  const machines = new Map<number, BlueprintCircuitMachineConfiguration>();
  for (let index = 0; index < portValues.length; index += 1) {
    const restored = sourceCircuitMachineConfiguration(portValues[index], index);
    const entity = sourceByRuntimeId.get(restored.entityId);
    if (entity === undefined) {
      throw new TypeError(
        `Blueprint circuit machine port ${index} references unknown entity ${restored.entityId}.`,
      );
    }
    if (machines.has(restored.entityId)) {
      throw new TypeError(
        `Blueprint circuit snapshot duplicates machine entity ${restored.entityId}.`,
      );
    }
    const configuration = canonicalCircuitMachineConfiguration(
      restored.configuration,
      entity.kind,
      `Blueprint circuit machine port ${index}.configuration`,
      false,
    );
    if (configuration === null) {
      throw new TypeError(
        `Blueprint circuit machine port ${index} is incompatible with ${entity.kind}.`,
      );
    }
    machines.set(restored.entityId, configuration);
  }
  const wireValues = requireDenseArray(
    ownData(source, "wires", "Blueprint circuit snapshot", true),
    MAX_BLUEPRINT_WIRES,
    "Blueprint circuit snapshot.wires",
  );
  const wires: CircuitWire[] = [];
  for (let index = 0; index < wireValues.length; index += 1) {
    const wireSource = requireCaptureRecord(
      wireValues[index],
      `Blueprint circuit wire ${index}`,
    );
    const color = ownData(
      wireSource,
      "color",
      `Blueprint circuit wire ${index}`,
      true,
    );
    const endpointA = ownData(
      wireSource,
      "endpointA",
      `Blueprint circuit wire ${index}`,
      true,
    );
    const endpointB = ownData(
      wireSource,
      "endpointB",
      `Blueprint circuit wire ${index}`,
      true,
    );
    if (color !== "red" && color !== "green") {
      throw new TypeError(
        `Blueprint circuit wire ${index}.color must be red or green.`,
      );
    }
    if (typeof endpointA !== "string" || typeof endpointB !== "string") {
      throw new TypeError(
        `Blueprint circuit wire ${index} endpoints must be strings.`,
      );
    }
    wires.push(OBJECT_FREEZE({ color, endpointA, endpointB }));
  }
  return {
    devices,
    machines,
    wires: OBJECT_FREEZE(wires),
  };
}

function connectorOrder(value: CircuitConnector): number {
  return value === "input" ? 0 : value === "output" ? 1 : 2;
}

function compareBlueprintCircuitEndpoints(
  left: BlueprintCircuitEndpoint,
  right: BlueprintCircuitEndpoint,
): number {
  return (
    left.entityRef - right.entityRef
    || connectorOrder(left.connector) - connectorOrder(right.connector)
  );
}

function freezeBlueprintCircuitEndpoint(
  entityRef: number,
  connector: CircuitConnector,
): BlueprintCircuitEndpoint {
  return OBJECT_FREEZE({ entityRef, connector });
}

function freezeBlueprintCircuitWire(
  color: "red" | "green",
  first: BlueprintCircuitEndpoint,
  second: BlueprintCircuitEndpoint,
): BlueprintCircuitWire {
  const endpointA =
    compareBlueprintCircuitEndpoints(first, second) <= 0 ? first : second;
  const endpointB = endpointA === first ? second : first;
  return OBJECT_FREEZE({ color, endpointA, endpointB });
}

function compareBlueprintCircuitWires(
  left: BlueprintCircuitWire,
  right: BlueprintCircuitWire,
): number {
  return (
    compareText(left.color, right.color)
    || compareBlueprintCircuitEndpoints(left.endpointA, right.endpointA)
    || compareBlueprintCircuitEndpoints(left.endpointB, right.endpointB)
  );
}

function blueprintCircuitWireKey(value: BlueprintCircuitWire): string {
  return `${value.color}\u0000${value.endpointA.entityRef}:${
    value.endpointA.connector
  }\u0000${value.endpointB.entityRef}:${value.endpointB.connector}`;
}

function entitySupportsConnector(
  entity: BlueprintCaptureSourceEntity | BlueprintEntity,
  connector: CircuitConnector,
): boolean {
  return circuitEndpointBindings(0, entity.kind).some(
    (binding) => binding.connector === connector,
  );
}

function circuitEntitiesWithinReach(
  first: BlueprintCaptureSourceEntity | BlueprintEntity,
  second: BlueprintCaptureSourceEntity | BlueprintEntity,
): boolean {
  const firstSize = footprint(first.kind, first.direction);
  const secondSize = footprint(second.kind, second.direction);
  const firstX = first.x + firstSize.width / 2;
  const firstY = first.y + firstSize.height / 2;
  const secondX = second.x + secondSize.width / 2;
  const secondY = second.y + secondSize.height / 2;
  return (
    Math.hypot(firstX - secondX, firstY - secondY)
    <= CIRCUIT_WIRE_REACH_TILES
  );
}

const BLUEPRINT_RAIL_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;
const MAX_BLUEPRINT_RAIL_UNITS = RAIL_LIMITS.maxUnits;

function railSourceId(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || !BLUEPRINT_RAIL_ID_PATTERN.test(value)
  ) {
    throw new TypeError(`${label} is not a canonical rail source ID.`);
  }
  return value;
}

function railSegmentKind(
  value: unknown,
  label: string,
): RailSegmentKind {
  if (value !== "straight" && value !== "curve" && value !== "junction") {
    throw new TypeError(`${label} is not a known rail segment kind.`);
  }
  return value;
}

function canonicalRailRotation(
  value: unknown,
  kind: RailSegmentKind,
  label: string,
  requireCanonical: boolean,
): 0 | 1 | 2 | 3 {
  if (
    OBJECT_IS(value, -0)
    || (value !== 0 && value !== 1 && value !== 2 && value !== 3)
  ) {
    throw new TypeError(`${label} must be 0, 1, 2, or 3.`);
  }
  const canonical = kind === "straight"
    ? ((value as number) % 2) as 0 | 1
    : value;
  if (requireCanonical && canonical !== value) {
    throw new TypeError(
      `${label} uses a noncanonical equivalent straight rotation.`,
    );
  }
  return canonical;
}

function railSignalType(value: unknown, label: string): RailSignalType {
  if (value !== "regular" && value !== "chain") {
    throw new TypeError(`${label} is not a known rail signal type.`);
  }
  return value;
}

function freezeRailWait(value: RailWaitCondition): RailWaitCondition {
  if (value.type === "time") {
    return OBJECT_FREEZE({ type: value.type, ticks: value.ticks });
  }
  if (value.type === "cargo-empty" || value.type === "cargo-full") {
    return OBJECT_FREEZE({ type: value.type });
  }
  return OBJECT_FREEZE({
    type: value.type,
    itemId: value.itemId,
    count: value.count,
  });
}

function restoreRailWait(
  value: unknown,
  label: string,
): RailWaitCondition {
  const candidate = requireSubsetRecord(
    value,
    ["type", "ticks", "itemId", "count"],
    label,
  );
  if (candidate.type === "time") {
    const record = requireRecord(value, ["type", "ticks"], label);
    return freezeRailWait({
      type: "time",
      ticks: safeInteger(
        record.ticks,
        `${label}.ticks`,
        0,
        MAX_BLUEPRINT_RAIL_UNITS,
      ),
    });
  }
  if (candidate.type === "cargo-empty" || candidate.type === "cargo-full") {
    requireRecord(value, ["type"], label);
    return freezeRailWait({ type: candidate.type });
  }
  if (
    candidate.type === "item-at-least"
    || candidate.type === "item-at-most"
  ) {
    const record = requireRecord(
      value,
      ["type", "itemId", "count"],
      label,
    );
    if (!contains(VALID_ITEM_IDS, record.itemId)) {
      throw new TypeError(`${label}.itemId is not a known item.`);
    }
    return freezeRailWait({
      type: candidate.type,
      itemId: record.itemId,
      count: safeInteger(
        record.count,
        `${label}.count`,
        0,
        MAX_BLUEPRINT_RAIL_UNITS,
      ),
    });
  }
  throw new TypeError(`${label}.type is not a known rail wait condition.`);
}

function railDirectionBetween(
  from: Pick<BlueprintRailSegment, "x" | "y">,
  to: Pick<BlueprintRailSegment, "x" | "y">,
): "north" | "east" | "south" | "west" | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === -1) return "north";
  if (dx === 1 && dy === 0) return "east";
  if (dx === 0 && dy === 1) return "south";
  if (dx === -1 && dy === 0) return "west";
  return null;
}

function oppositeRailDirection(
  value: "north" | "east" | "south" | "west",
): "north" | "east" | "south" | "west" {
  return value === "north"
    ? "south"
    : value === "east"
      ? "west"
      : value === "south"
        ? "north"
        : "east";
}

function railSegmentsConnect(
  from: Pick<BlueprintRailSegment, "x" | "y" | "kind" | "rotation">,
  to: Pick<BlueprintRailSegment, "x" | "y" | "kind" | "rotation">,
): boolean {
  const direction = railDirectionBetween(from, to);
  if (direction === null) return false;
  return (
    railSegmentPorts(from).includes(direction)
    && railSegmentPorts(to).includes(oppositeRailDirection(direction))
  );
}

function compareBlueprintRailSegments(
  left: BlueprintRailSegment,
  right: BlueprintRailSegment,
): number {
  return (
    left.y - right.y
    || left.x - right.x
    || compareText(left.kind, right.kind)
    || left.rotation - right.rotation
    || left.ref - right.ref
  );
}

function compareBlueprintRailSignals(
  left: BlueprintRailSignal,
  right: BlueprintRailSignal,
): number {
  return (
    left.fromSegmentRef - right.fromSegmentRef
    || left.toSegmentRef - right.toSegmentRef
    || compareText(left.type, right.type)
  );
}

function compareItemIds(left: ItemId, right: ItemId): number {
  return (
    VALID_ITEM_IDS.indexOf(left) - VALID_ITEM_IDS.indexOf(right)
  );
}

function freezeRailItemFilter(
  value: readonly ItemId[] | null,
): readonly ItemId[] | null {
  return value === null ? null : OBJECT_FREEZE(value.slice());
}

function canonicalRailItemFilter(
  value: unknown,
  label: string,
  requireCanonical: boolean,
): readonly ItemId[] | null {
  if (value === null) return null;
  const source = requireDenseArray(
    value,
    MAX_BLUEPRINT_RAIL_ITEM_FILTERS,
    label,
  );
  if (source.length === 0) {
    throw new TypeError(`${label} must be null or contain at least one item.`);
  }
  const restored: ItemId[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (!contains(VALID_ITEM_IDS, source[index])) {
      throw new TypeError(`${label}[${index}] is not a known item.`);
    }
    restored.push(source[index] as ItemId);
  }
  const sorted = restored.slice().sort(compareItemIds);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1] === sorted[index]) {
      throw new TypeError(`${label} must not contain duplicate items.`);
    }
  }
  if (requireCanonical) {
    for (let index = 0; index < restored.length; index += 1) {
      if (restored[index] !== sorted[index]) {
        throw new TypeError(`${label} is not canonically ordered.`);
      }
    }
  }
  return freezeRailItemFilter(sorted);
}

function freezeRailStorageBinding(
  entityRef: number,
  mode: RailStationTransferMode,
  transferRate: number,
  itemFilter: readonly ItemId[] | null,
): BlueprintRailStorageBinding {
  return OBJECT_FREEZE({
    entityRef,
    mode,
    transferRate,
    itemFilter,
  });
}

function compareStorageBindings(
  left: BlueprintRailStorageBinding | null,
  right: BlueprintRailStorageBinding | null,
): number {
  if (left === null || right === null) {
    return left === right ? 0 : left === null ? -1 : 1;
  }
  return (
    left.entityRef - right.entityRef
    || compareText(left.mode, right.mode)
    || left.transferRate - right.transferRate
    || (
      left.itemFilter === null || right.itemFilter === null
        ? left.itemFilter === right.itemFilter
          ? 0
          : left.itemFilter === null
            ? -1
            : 1
        : compareText(
            left.itemFilter.join("\u0000"),
            right.itemFilter.join("\u0000"),
          )
    )
  );
}

function compareBlueprintRailStations(
  left: BlueprintRailStation,
  right: BlueprintRailStation,
): number {
  return (
    left.segmentRef - right.segmentRef
    || left.capacity - right.capacity
    || compareStorageBindings(left.storageBinding, right.storageBinding)
    || left.ref - right.ref
  );
}

function railWaitKey(value: RailWaitCondition): string {
  if (value.type === "time") return `0:${value.ticks}`;
  if (value.type === "cargo-empty") return "1";
  if (value.type === "cargo-full") return "2";
  return `${value.type === "item-at-least" ? "3" : "4"}:${
    value.itemId
  }:${value.count}`;
}

function railTrainSemanticKey(
  value: Omit<BlueprintRailTrain, "ref"> | BlueprintRailTrain,
): string {
  const cars = value.cars.map((car) =>
    car.kind === "locomotive"
      ? `l:${car.fuelCapacityMilli}`
      : `w:${car.capacity}`
  ).join("|");
  const schedule = value.schedule.map((stop) =>
    `${stop.stationRef}:${railWaitKey(stop.wait)}`
  ).join("|");
  return `${value.segmentRef}\u0000${cars}\u0000${schedule}`;
}

function compareBlueprintRailCars(
  left: BlueprintRailCar,
  right: BlueprintRailCar,
): number {
  if (left.kind !== right.kind) {
    return left.kind === "locomotive" ? -1 : 1;
  }
  return left.kind === "locomotive" && right.kind === "locomotive"
    ? left.fuelCapacityMilli - right.fuelCapacityMilli
    : left.kind === "cargo-wagon" && right.kind === "cargo-wagon"
      ? left.capacity - right.capacity
      : 0;
}

function compareBlueprintRailTrains(
  left: BlueprintRailTrain,
  right: BlueprintRailTrain,
): number {
  return (
    compareText(railTrainSemanticKey(left), railTrainSemanticKey(right))
    || left.ref - right.ref
  );
}

function freezeRailIntent(
  segments: readonly BlueprintRailSegment[],
  signals: readonly BlueprintRailSignal[],
  stations: readonly BlueprintRailStation[],
  trains: readonly BlueprintRailTrain[],
): BlueprintRailIntent {
  return OBJECT_FREEZE({
    segments: OBJECT_FREEZE(segments.slice()),
    signals: OBJECT_FREEZE(signals.slice()),
    stations: OBJECT_FREEZE(stations.slice()),
    trains: OBJECT_FREEZE(trains.slice()),
  });
}

interface SourceRailSegment {
  readonly sourceId: string;
  readonly x: number;
  readonly y: number;
  readonly kind: RailSegmentKind;
  readonly rotation: 0 | 1 | 2 | 3;
}

interface SourceRailStation {
  readonly sourceId: string;
  readonly segmentSourceId: string;
  readonly capacity: number;
}

function sourceRailSegments(
  network: object,
): readonly unknown[] {
  const direct = ownData(network, "segments", "Blueprint rail network", false);
  if (direct !== undefined) {
    return requireDenseArray(
      direct,
      MAX_BLUEPRINT_RAIL_SEGMENTS,
      "Blueprint rail network.segments",
    );
  }
  const graph = requireCaptureRecord(
    ownData(network, "graph", "Blueprint rail network", true),
    "Blueprint rail network.graph",
  );
  return requireDenseArray(
    ownData(graph, "nodes", "Blueprint rail network.graph", true),
    MAX_BLUEPRINT_RAIL_SEGMENTS,
    "Blueprint rail network.graph.nodes",
  );
}

function sourceRailOptionalArray(
  network: object,
  key: "signals" | "trains",
  maximum: number,
): readonly unknown[] {
  const value = ownData(network, key, "Blueprint rail network", false);
  return value === undefined
    ? OBJECT_FREEZE([] as unknown[])
    : requireDenseArray(value, maximum, `Blueprint rail network.${key}`);
}

function sourceRailStations(network: object): readonly unknown[] {
  return requireDenseArray(
    ownData(network, "stations", "Blueprint rail network", true),
    MAX_BLUEPRINT_RAIL_STATIONS,
    "Blueprint rail network.stations",
  );
}

function sourceRailCar(
  value: unknown,
  label: string,
): BlueprintRailCar {
  const source = requireCaptureRecord(value, label);
  const kind = ownData(source, "kind", label, true);
  if (kind === "locomotive") {
    return OBJECT_FREEZE({
      kind,
      fuelCapacityMilli: safeInteger(
        ownData(source, "fuelCapacityMilli", label, true),
        `${label}.fuelCapacityMilli`,
        1,
        MAX_BLUEPRINT_RAIL_UNITS,
      ),
    });
  }
  if (kind === "cargo-wagon") {
    const capacityValue =
      ownData(source, "capacity", label, false)
      ?? ownData(source, "cargoCapacity", label, false);
    return OBJECT_FREEZE({
      kind,
      capacity: safeInteger(
        capacityValue,
        `${label}.capacity`,
        1,
        MAX_BLUEPRINT_RAIL_UNITS,
      ),
    });
  }
  throw new TypeError(`${label}.kind is not a known rail car kind.`);
}

function captureRailIntent(
  value: BlueprintRailCaptureSnapshot | undefined,
  selection: BlueprintSelection,
  sourceEntitiesByRuntimeId: ReadonlyMap<number, BlueprintCaptureSourceEntity>,
  capturedEntityRefs: ReadonlyMap<number, number>,
): BlueprintRailIntent {
  if (value === undefined) return emptyRailIntent();
  const capture = requireCaptureRecord(value, "Blueprint rail capture");
  const network = requireCaptureRecord(
    ownData(capture, "network", "Blueprint rail capture", true),
    "Blueprint rail network",
  );
  const right = selection.x + selection.width;
  const bottom = selection.y + selection.height;

  const segmentValues = sourceRailSegments(network);
  const allSegments = new Map<string, SourceRailSegment>();
  const occupiedTiles = new Set<string>();
  const selectedSegments: SourceRailSegment[] = [];
  for (let index = 0; index < segmentValues.length; index += 1) {
    const label = `Blueprint rail segment ${index}`;
    const source = requireCaptureRecord(segmentValues[index], label);
    const directId = ownData(source, "id", label, false);
    const sourceId = railSourceId(
      directId
        ?? ownData(source, "segmentId", label, true),
      `${label}.id`,
    );
    if (allSegments.has(sourceId)) {
      throw new TypeError(`${label}.id duplicates ${sourceId}.`);
    }
    const x = safeCoordinate(ownData(source, "x", label, true), `${label}.x`);
    const y = safeCoordinate(ownData(source, "y", label, true), `${label}.y`);
    const kind = railSegmentKind(
      ownData(source, "kind", label, true),
      `${label}.kind`,
    );
    const rotation = canonicalRailRotation(
      ownData(source, "rotation", label, true),
      kind,
      `${label}.rotation`,
      false,
    );
    const tileKey = `${x},${y}`;
    if (occupiedTiles.has(tileKey)) {
      throw new TypeError(`${label} overlaps another rail at ${tileKey}.`);
    }
    occupiedTiles.add(tileKey);
    const restored = { sourceId, x, y, kind, rotation };
    allSegments.set(sourceId, restored);
    if (x >= selection.x && x < right && y >= selection.y && y < bottom) {
      selectedSegments.push(restored);
    }
  }
  selectedSegments.sort((left, rightSegment) =>
    left.y - rightSegment.y
    || left.x - rightSegment.x
    || compareText(left.kind, rightSegment.kind)
    || left.rotation - rightSegment.rotation
  );
  const segmentRefBySourceId = new Map<string, number>();
  const segments: BlueprintRailSegment[] = [];
  for (let index = 0; index < selectedSegments.length; index += 1) {
    const source = selectedSegments[index]!;
    segmentRefBySourceId.set(source.sourceId, index);
    segments.push(OBJECT_FREEZE({
      ref: index,
      x: source.x,
      y: source.y,
      kind: source.kind,
      rotation: source.rotation,
    }));
  }

  const signalValues = sourceRailOptionalArray(
    network,
    "signals",
    MAX_BLUEPRINT_RAIL_SIGNALS,
  );
  const signals: BlueprintRailSignal[] = [];
  const signalSourceIds = new Set<string>();
  const signalKeys = new Set<string>();
  for (let index = 0; index < signalValues.length; index += 1) {
    const label = `Blueprint rail signal ${index}`;
    const source = requireCaptureRecord(signalValues[index], label);
    const sourceId = railSourceId(
      ownData(source, "id", label, true),
      `${label}.id`,
    );
    if (signalSourceIds.has(sourceId)) {
      throw new TypeError(`${label}.id duplicates ${sourceId}.`);
    }
    signalSourceIds.add(sourceId);
    const fromId = railSourceId(
      ownData(source, "fromSegmentId", label, true),
      `${label}.fromSegmentId`,
    );
    const toId = railSourceId(
      ownData(source, "toSegmentId", label, true),
      `${label}.toSegmentId`,
    );
    const type = railSignalType(
      ownData(source, "type", label, true),
      `${label}.type`,
    );
    const from = allSegments.get(fromId);
    const to = allSegments.get(toId);
    if (from === undefined || to === undefined) {
      throw new TypeError(`${label} contains a dangling segment reference.`);
    }
    if (fromId === toId || !railSegmentsConnect(from, to)) {
      throw new TypeError(`${label} links unreachable rail segments.`);
    }
    const key = `${fromId}\u0000${toId}`;
    if (signalKeys.has(key)) {
      throw new TypeError(`${label} duplicates a directed rail signal.`);
    }
    signalKeys.add(key);
    const fromRef = segmentRefBySourceId.get(fromId);
    const toRef = segmentRefBySourceId.get(toId);
    if (fromRef === undefined || toRef === undefined) continue;
    signals.push(OBJECT_FREEZE({
      fromSegmentRef: fromRef,
      toSegmentRef: toRef,
      type,
    }));
  }
  signals.sort(compareBlueprintRailSignals);

  const stationValues = sourceRailStations(network);
  const allStations = new Map<string, SourceRailStation>();
  const selectedStations: SourceRailStation[] = [];
  const stationSegments = new Set<string>();
  for (let index = 0; index < stationValues.length; index += 1) {
    const label = `Blueprint rail station ${index}`;
    const source = requireCaptureRecord(stationValues[index], label);
    const sourceId = railSourceId(
      ownData(source, "id", label, true),
      `${label}.id`,
    );
    if (allStations.has(sourceId)) {
      throw new TypeError(`${label}.id duplicates ${sourceId}.`);
    }
    const segmentSourceId = railSourceId(
      ownData(source, "segmentId", label, true),
      `${label}.segmentId`,
    );
    if (!allSegments.has(segmentSourceId)) {
      throw new TypeError(`${label} contains a dangling segment reference.`);
    }
    if (stationSegments.has(segmentSourceId)) {
      throw new TypeError(`${label} duplicates a station segment.`);
    }
    stationSegments.add(segmentSourceId);
    const restored = {
      sourceId,
      segmentSourceId,
      capacity: safeInteger(
        ownData(source, "capacity", label, true),
        `${label}.capacity`,
        0,
        MAX_BLUEPRINT_RAIL_UNITS,
      ),
    };
    allStations.set(sourceId, restored);
    if (segmentRefBySourceId.has(segmentSourceId)) {
      selectedStations.push(restored);
    }
  }

  const interfaceValue = ownData(
    capture,
    "stationInterfaces",
    "Blueprint rail capture",
    false,
  );
  const interfaceValues =
    interfaceValue === undefined
      ? OBJECT_FREEZE([] as unknown[])
      : requireDenseArray(
          interfaceValue,
          MAX_BLUEPRINT_RAIL_STATIONS,
          "Blueprint rail capture.stationInterfaces",
        );
  const interfaces = new Map<string, BlueprintRailStorageBinding>();
  for (let index = 0; index < interfaceValues.length; index += 1) {
    const label = `Blueprint rail station interface ${index}`;
    const source = requireCaptureRecord(interfaceValues[index], label);
    const stationId = railSourceId(
      ownData(source, "stationId", label, true),
      `${label}.stationId`,
    );
    if (!allStations.has(stationId)) {
      throw new TypeError(`${label} references unknown station ${stationId}.`);
    }
    if (interfaces.has(stationId)) {
      throw new TypeError(`${label} duplicates station ${stationId}.`);
    }
    const storageEntityId = safeInteger(
      ownData(source, "storageEntityId", label, true),
      `${label}.storageEntityId`,
      0,
    );
    const storage = sourceEntitiesByRuntimeId.get(storageEntityId);
    if (storage === undefined || storage.kind !== "storage") {
      throw new TypeError(`${label} references an invalid storage entity.`);
    }
    const mode = ownData(source, "mode", label, true);
    if (mode !== "load" && mode !== "unload" && mode !== "both") {
      throw new TypeError(`${label}.mode is invalid.`);
    }
    const itemFilterValue = ownData(source, "itemFilter", label, false);
    const entityRef = capturedEntityRefs.get(storageEntityId);
    if (
      segmentRefBySourceId.has(allStations.get(stationId)!.segmentSourceId)
      && entityRef === undefined
    ) {
      throw new TypeError(
        `${label} storage binding leaves the captured selection.`,
      );
    }
    interfaces.set(
      stationId,
      freezeRailStorageBinding(
        entityRef ?? 0,
        mode,
        safeInteger(
          ownData(source, "transferRate", label, true),
          `${label}.transferRate`,
          1,
          MAX_BLUEPRINT_RAIL_UNITS,
        ),
        canonicalRailItemFilter(
          itemFilterValue === undefined ? null : itemFilterValue,
          `${label}.itemFilter`,
          false,
        ),
      ),
    );
  }
  selectedStations.sort((left, rightStation) =>
    segmentRefBySourceId.get(left.segmentSourceId)!
      - segmentRefBySourceId.get(rightStation.segmentSourceId)!
    || left.capacity - rightStation.capacity
  );
  const stationRefBySourceId = new Map<string, number>();
  const stations: BlueprintRailStation[] = [];
  for (let index = 0; index < selectedStations.length; index += 1) {
    const source = selectedStations[index]!;
    stationRefBySourceId.set(source.sourceId, index);
    stations.push(OBJECT_FREEZE({
      ref: index,
      segmentRef: segmentRefBySourceId.get(source.segmentSourceId)!,
      capacity: source.capacity,
      storageBinding: interfaces.get(source.sourceId) ?? null,
    }));
  }

  const trainValues = sourceRailOptionalArray(
    network,
    "trains",
    MAX_BLUEPRINT_RAIL_TRAINS,
  );
  const trainSourceIds = new Set<string>();
  const capturedTrains: Array<Omit<BlueprintRailTrain, "ref">> = [];
  for (let index = 0; index < trainValues.length; index += 1) {
    const label = `Blueprint rail train ${index}`;
    const source = requireCaptureRecord(trainValues[index], label);
    const sourceId = railSourceId(
      ownData(source, "id", label, true),
      `${label}.id`,
    );
    if (trainSourceIds.has(sourceId)) {
      throw new TypeError(`${label}.id duplicates ${sourceId}.`);
    }
    trainSourceIds.add(sourceId);
    const segmentSourceId = railSourceId(
      ownData(source, "currentSegmentId", label, true),
      `${label}.currentSegmentId`,
    );
    if (!allSegments.has(segmentSourceId)) {
      throw new TypeError(`${label} contains a dangling segment reference.`);
    }
    const carValues = requireDenseArray(
      ownData(source, "cars", label, true),
      MAX_BLUEPRINT_RAIL_CARS_PER_TRAIN,
      `${label}.cars`,
    );
    if (carValues.length === 0) {
      throw new TypeError(`${label}.cars must not be empty.`);
    }
    const cars: BlueprintRailCar[] = [];
    let locomotives = 0;
    for (let carIndex = 0; carIndex < carValues.length; carIndex += 1) {
      const car = sourceRailCar(
        carValues[carIndex],
        `${label}.cars[${carIndex}]`,
      );
      if (car.kind === "locomotive") locomotives += 1;
      cars.push(car);
    }
    if (locomotives === 0) {
      throw new TypeError(`${label}.cars must contain a locomotive.`);
    }
    cars.sort(compareBlueprintRailCars);
    const stopValues = requireDenseArray(
      ownData(source, "schedule", label, true),
      MAX_BLUEPRINT_RAIL_SCHEDULE_STOPS,
      `${label}.schedule`,
    );
    if (stopValues.length === 0) {
      throw new TypeError(`${label}.schedule must not be empty.`);
    }
    const scheduleSources: Array<{
      readonly stationId: string;
      readonly wait: RailWaitCondition;
    }> = [];
    for (let stopIndex = 0; stopIndex < stopValues.length; stopIndex += 1) {
      const stopLabel = `${label}.schedule[${stopIndex}]`;
      const stop = requireCaptureRecord(stopValues[stopIndex], stopLabel);
      const stationId = railSourceId(
        ownData(stop, "stationId", stopLabel, true),
        `${stopLabel}.stationId`,
      );
      if (!allStations.has(stationId)) {
        throw new TypeError(`${stopLabel} contains a dangling station reference.`);
      }
      scheduleSources.push({
        stationId,
        wait: restoreRailWait(
          ownData(stop, "wait", stopLabel, true),
          `${stopLabel}.wait`,
        ),
      });
    }
    const segmentRef = segmentRefBySourceId.get(segmentSourceId);
    if (segmentRef === undefined) continue;
    const schedule: BlueprintRailScheduleStop[] = [];
    for (let stopIndex = 0; stopIndex < scheduleSources.length; stopIndex += 1) {
      const stop = scheduleSources[stopIndex]!;
      const stationRef = stationRefBySourceId.get(stop.stationId);
      if (stationRef === undefined) {
        throw new TypeError(
          `${label} schedule leaves the captured rail selection.`,
        );
      }
      schedule.push(OBJECT_FREEZE({ stationRef, wait: stop.wait }));
    }
    capturedTrains.push({
      segmentRef,
      cars: OBJECT_FREEZE(cars),
      schedule: OBJECT_FREEZE(schedule),
    });
  }
  capturedTrains.sort((left, rightTrain) =>
    compareText(railTrainSemanticKey(left), railTrainSemanticKey(rightTrain))
  );
  const trains: BlueprintRailTrain[] = [];
  for (let index = 0; index < capturedTrains.length; index += 1) {
    const train = capturedTrains[index]!;
    trains.push(OBJECT_FREEZE({ ref: index, ...train }));
  }
  return freezeRailIntent(segments, signals, stations, trains);
}

/**
 * Captures every entity whose occupied rectangle intersects the half-open
 * selection rectangle. The result is cropped to occupied bounds, so equivalent
 * marquee selections produce byte-identical blueprints.
 */
export function captureBlueprint(
  entitiesValue: readonly EntityState[],
  selectionValue: BlueprintSelection,
  optionsValue: BlueprintCaptureOptions = {},
): Blueprint {
  const entities = requireDenseArray(
    entitiesValue,
    MAX_BLUEPRINT_CAPTURE_CANDIDATES,
    "Blueprint capture candidates",
  );
  const selection = validateSelection(selectionValue);
  const optionRecord = requireSubsetRecord(
    optionsValue,
    ["circuit", "rail"],
    "Blueprint capture options",
  );
  const circuitSnapshot = optionRecord.circuit as
    | BlueprintCircuitCaptureSnapshot
    | undefined;
  const railSnapshot = optionRecord.rail as
    | BlueprintRailCaptureSnapshot
    | undefined;
  if (selection.width === 0 || selection.height === 0) return emptyBlueprint();
  const needsRuntimeIds =
    circuitSnapshot !== undefined || railSnapshot !== undefined;
  const right = selection.x + selection.width;
  const bottom = selection.y + selection.height;
  const captured: Array<{
    readonly sourceX: number;
    readonly sourceY: number;
    readonly entity: ReturnType<typeof sourceEntity>;
    readonly width: number;
    readonly height: number;
  }> = [];
  const allSources: BlueprintCaptureSourceEntity[] = [];
  const sourceByRuntimeId = new Map<number, BlueprintCaptureSourceEntity>();

  for (let index = 0; index < entities.length; index += 1) {
    const parsed = sourceEntity(entities[index], index, needsRuntimeIds);
    const candidate: BlueprintCaptureSourceEntity = {
      ...parsed,
      sourceIndex: index,
    };
    allSources.push(candidate);
    if (candidate.runtimeId !== null) {
      if (sourceByRuntimeId.has(candidate.runtimeId)) {
        throw new TypeError(
          `Blueprint capture candidates duplicate entity ID ${candidate.runtimeId}.`,
        );
      }
      sourceByRuntimeId.set(candidate.runtimeId, candidate);
    }
    const size = footprint(candidate.kind, candidate.direction);
    const candidateRight = checkedAdd(
      candidate.x,
      size.width,
      `${index} entity right edge`,
    );
    const candidateBottom = checkedAdd(
      candidate.y,
      size.height,
      `${index} entity bottom edge`,
    );
    if (
      candidateRight <= selection.x
      || candidate.x >= right
      || candidateBottom <= selection.y
      || candidate.y >= bottom
    ) {
      continue;
    }
    if (captured.length >= MAX_BLUEPRINT_ENTITIES) {
      throw new RangeError(
        `Blueprint exceeds its limit of ${MAX_BLUEPRINT_ENTITIES} entities.`,
      );
    }
    captured.push({
      sourceX: candidate.x,
      sourceY: candidate.y,
      entity: candidate,
      width: size.width,
      height: size.height,
    });
  }

  captured.sort((left, rightEntry) => {
    if (left.sourceY !== rightEntry.sourceY) {
      return left.sourceY - rightEntry.sourceY;
    }
    if (left.sourceX !== rightEntry.sourceX) {
      return left.sourceX - rightEntry.sourceX;
    }
    const kindOrder =
      VALID_ENTITY_KINDS.indexOf(left.entity.kind)
      - VALID_ENTITY_KINDS.indexOf(rightEntry.entity.kind);
    return kindOrder || left.entity.direction - rightEntry.entity.direction;
  });
  const capturedEntityRefs = new Map<number, number>();
  for (let index = 0; index < captured.length; index += 1) {
    const runtimeId = captured[index]!.entity.runtimeId;
    if (runtimeId !== null) capturedEntityRefs.set(runtimeId, index);
  }
  const circuit = captureCircuitConfigurations(
    circuitSnapshot,
    sourceByRuntimeId,
  );
  const absoluteRail = captureRailIntent(
    railSnapshot,
    selection,
    sourceByRuntimeId,
    capturedEntityRefs,
  );
  if (captured.length === 0 && absoluteRail.segments.length === 0) {
    return emptyBlueprint();
  }

  let minimumX = Number.MAX_SAFE_INTEGER;
  let minimumY = Number.MAX_SAFE_INTEGER;
  let maximumX = Number.MIN_SAFE_INTEGER;
  let maximumY = Number.MIN_SAFE_INTEGER;
  for (let index = 0; index < captured.length; index += 1) {
    const entry = captured[index]!;
    minimumX = Math.min(minimumX, entry.sourceX);
    minimumY = Math.min(minimumY, entry.sourceY);
    maximumX = Math.max(maximumX, entry.sourceX + entry.width);
    maximumY = Math.max(maximumY, entry.sourceY + entry.height);
  }
  for (let index = 0; index < absoluteRail.segments.length; index += 1) {
    const segment = absoluteRail.segments[index]!;
    minimumX = Math.min(minimumX, segment.x);
    minimumY = Math.min(minimumY, segment.y);
    maximumX = Math.max(maximumX, segment.x + 1);
    maximumY = Math.max(maximumY, segment.y + 1);
  }
  const width = maximumX - minimumX;
  const height = maximumY - minimumY;
  if (
    !NUMBER_IS_SAFE_INTEGER(width)
    || !NUMBER_IS_SAFE_INTEGER(height)
    || width > MAX_BLUEPRINT_SPAN
    || height > MAX_BLUEPRINT_SPAN
  ) {
    throw new RangeError(
      `Blueprint occupied bounds exceed ${MAX_BLUEPRINT_SPAN} tiles.`,
    );
  }
  const output: BlueprintEntity[] = [];
  for (let index = 0; index < captured.length; index += 1) {
    const entry = captured[index]!;
    const runtimeId = entry.entity.runtimeId;
    output.push(
      freezeEntity(
        index,
        entry.entity.kind,
        entry.sourceX - minimumX,
        entry.sourceY - minimumY,
        entry.entity.direction,
        entry.entity.recipeId,
        entry.entity.manifoldRouting,
        entry.entity.fluidId,
        entry.entity.fluidRecipeId,
        runtimeId === null
          ? entry.entity.circuitDevice
          : circuit.devices.get(runtimeId) ?? entry.entity.circuitDevice,
        runtimeId === null
          ? entry.entity.circuitMachine
          : circuit.machines.get(runtimeId) ?? entry.entity.circuitMachine,
      ),
    );
  }
  const wires: BlueprintCircuitWire[] = [];
  const wireKeys = new Set<string>();
  for (let index = 0; index < circuit.wires.length; index += 1) {
    const sourceWire = circuit.wires[index]!;
    const first = parseCircuitRuntimeEndpoint(
      sourceWire.endpointA,
      `Blueprint circuit wire ${index}.endpointA`,
    );
    const second = parseCircuitRuntimeEndpoint(
      sourceWire.endpointB,
      `Blueprint circuit wire ${index}.endpointB`,
    );
    const firstEntity = sourceByRuntimeId.get(first.entityId);
    const secondEntity = sourceByRuntimeId.get(second.entityId);
    if (firstEntity === undefined || secondEntity === undefined) {
      throw new TypeError(
        `Blueprint circuit wire ${index} contains a dangling entity reference.`,
      );
    }
    if (first.entityId === second.entityId) {
      throw new TypeError(`Blueprint circuit wire ${index} is a self-link.`);
    }
    if (
      !entitySupportsConnector(firstEntity, first.connector)
      || !entitySupportsConnector(secondEntity, second.connector)
    ) {
      throw new TypeError(
        `Blueprint circuit wire ${index} uses an invalid connector/kind combination.`,
      );
    }
    if (!circuitEntitiesWithinReach(firstEntity, secondEntity)) {
      throw new RangeError(
        `Blueprint circuit wire ${index} exceeds construction reach.`,
      );
    }
    const firstRef = capturedEntityRefs.get(first.entityId);
    const secondRef = capturedEntityRefs.get(second.entityId);
    const globalKey =
      sourceWire.color
      + "\u0000"
      + [
        `${first.entityId}:${first.connector}`,
        `${second.entityId}:${second.connector}`,
      ].sort(compareText).join("\u0000");
    if (wireKeys.has(globalKey)) {
      throw new TypeError(`Blueprint circuit wire ${index} is a duplicate.`);
    }
    wireKeys.add(globalKey);
    if (firstRef === undefined || secondRef === undefined) continue;
    wires.push(
      freezeBlueprintCircuitWire(
        sourceWire.color as "red" | "green",
        freezeBlueprintCircuitEndpoint(firstRef, first.connector),
        freezeBlueprintCircuitEndpoint(secondRef, second.connector),
      ),
    );
  }
  wires.sort(compareBlueprintCircuitWires);

  const translatedSegments = absoluteRail.segments.map((segment) =>
    OBJECT_FREEZE({
      ref: segment.ref,
      x: segment.x - minimumX,
      y: segment.y - minimumY,
      kind: segment.kind,
      rotation: segment.rotation,
    })
  );
  const rail = freezeRailIntent(
    translatedSegments,
    absoluteRail.signals,
    absoluteRail.stations,
    absoluteRail.trains,
  );
  validateGeometry(width, height, output, rail, true);
  validateCircuitWires(output, wires, true);
  validateRailIntent(width, height, output, rail, true);
  const blueprint = freezeBlueprint(width, height, output, wires, rail);
  assertBlueprintCanonicalLength(blueprint);
  return blueprint;
}

function restoreRouting(
  value: unknown,
  kind: EntityKind,
  label: string,
  version:
    | typeof BLUEPRINT_VERSION
    | typeof LEGACY_BLUEPRINT_VERSION_1
    | typeof LEGACY_BLUEPRINT_VERSION_2,
): BlueprintManifoldRouting | null {
  if (value === null) {
    if (kind === "manifold") {
      throw new TypeError(`${label} is required for a manifold.`);
    }
    return null;
  }
  if (kind !== "manifold") {
    throw new TypeError(`${label} is only valid for a manifold.`);
  }
  const record = requireRecord(
    value,
    version === LEGACY_BLUEPRINT_VERSION_1
      ? ["mode", "filter"]
      : ["mode", "filter", "extractPort"],
    label,
  );
  if (record.filter === undefined) {
    throw new TypeError(`${label}.filter must be null or an item.`);
  }
  if (
    version !== LEGACY_BLUEPRINT_VERSION_1
    && record.extractPort === undefined
  ) {
    throw new TypeError(
      `${label}.extractPort must be canonical local branch 0 or 1.`,
    );
  }
  const migratedPort =
    version === LEGACY_BLUEPRINT_VERSION_1
      ? 0
      : record.extractPort;
  return validateAndFreezeRouting(
    record.mode,
    record.filter,
    migratedPort,
    label,
  );
}

function restoreEntity(
  value: unknown,
  index: number,
  version:
    | typeof BLUEPRINT_VERSION
    | typeof LEGACY_BLUEPRINT_VERSION_1
    | typeof LEGACY_BLUEPRINT_VERSION_2,
): BlueprintEntity {
  const label = `Blueprint entity ${index}`;
  const record = requireRecord(
    value,
    version === BLUEPRINT_VERSION
      ? [
          "ref",
          "kind",
          "x",
          "y",
          "direction",
          "recipeId",
          "manifoldRouting",
          "fluidId",
          "fluidRecipeId",
          "circuitDevice",
          "circuitMachine",
        ]
      : ["kind", "x", "y", "direction", "recipeId", "manifoldRouting"],
    label,
  );
  const kind = entityKind(record.kind, `${label}.kind`);
  if (
    version !== BLUEPRINT_VERSION
    && !contains(VALID_LEGACY_ENTITY_KINDS, kind)
  ) {
    throw new TypeError(
      `${label}.kind is not supported by legacy blueprint version ${version}.`,
    );
  }
  const facing = direction(record.direction, `${label}.direction`);
  const x = safeInteger(
    record.x,
    `${label}.x`,
    0,
    MAX_BLUEPRINT_SPAN - 1,
  );
  const y = safeInteger(
    record.y,
    `${label}.y`,
    0,
    MAX_BLUEPRINT_SPAN - 1,
  );
  if (record.recipeId === undefined) {
    throw new TypeError(`${label}.recipeId must be null or a recipe.`);
  }
  const recipeId = recipe(record.recipeId, kind, `${label}.recipeId`);
  const manifoldRouting = restoreRouting(
    record.manifoldRouting,
    kind,
    `${label}.manifoldRouting`,
    version,
  );
  const ref =
    version === BLUEPRINT_VERSION
      ? safeInteger(
          record.ref,
          `${label}.ref`,
          0,
          MAX_BLUEPRINT_ENTITIES - 1,
        )
      : index;
  if (ref !== index) {
    throw new TypeError(`${label}.ref must equal its canonical array index.`);
  }
  const configuredFluidId =
    version === BLUEPRINT_VERSION
      ? fluidId(record.fluidId, kind, `${label}.fluidId`)
      : kind === "fluidSource"
        ? "crudeOil"
        : null;
  const configuredFluidRecipeId =
    version === BLUEPRINT_VERSION
      ? fluidRecipeId(
          record.fluidRecipeId,
          kind,
          `${label}.fluidRecipeId`,
        )
      : kind === "fluidProcessor"
        ? "refineCrude"
        : null;
  const circuitDevice =
    version === BLUEPRINT_VERSION
      ? canonicalCircuitDeviceConfiguration(
          record.circuitDevice,
          kind,
          `${label}.circuitDevice`,
          true,
        )
      : kind === "constantCombinator"
        || kind === "arithmeticCombinator"
        || kind === "deciderCombinator"
        ? defaultBlueprintCircuitDevice(kind)
        : null;
  const circuitMachine =
    version === BLUEPRINT_VERSION
      ? canonicalCircuitMachineConfiguration(
          record.circuitMachine,
          kind,
          `${label}.circuitMachine`,
          true,
        )
      : defaultBlueprintCircuitMachine(kind);
  return freezeEntity(
    ref,
    kind,
    x,
    y,
    facing,
    recipeId,
    manifoldRouting,
    configuredFluidId,
    configuredFluidRecipeId,
    circuitDevice,
    circuitMachine,
  );
}

function validateGeometry(
  width: number,
  height: number,
  entities: readonly BlueprintEntity[],
  rail: BlueprintRailIntent,
  requireCanonicalOrder: boolean,
): void {
  if (entities.length === 0 && rail.segments.length === 0) {
    if (width !== 0 || height !== 0) {
      throw new TypeError("An empty blueprint must have zero width and height.");
    }
    return;
  }
  if (width === 0 || height === 0) {
    throw new TypeError("A non-empty blueprint must have positive dimensions.");
  }
  let minimumX = MAX_BLUEPRINT_SPAN;
  let minimumY = MAX_BLUEPRINT_SPAN;
  let maximumX = 0;
  let maximumY = 0;
  const occupied = new Set<number>();
  let previous: BlueprintEntity | undefined;
  for (let index = 0; index < entities.length; index += 1) {
    const entity = entities[index]!;
    if (entity.ref !== index) {
      throw new TypeError("Blueprint entity refs must be canonical indexes.");
    }
    if (
      requireCanonicalOrder
      && previous !== undefined
      && compareEntities(previous, entity) >= 0
    ) {
      throw new TypeError(
        "Blueprint entities must be unique and canonically ordered.",
      );
    }
    previous = entity;
    const size = footprint(entity.kind, entity.direction);
    const right = entity.x + size.width;
    const bottom = entity.y + size.height;
    if (right > width || bottom > height) {
      throw new RangeError(`Blueprint entity ${index} exceeds blueprint bounds.`);
    }
    minimumX = Math.min(minimumX, entity.x);
    minimumY = Math.min(minimumY, entity.y);
    maximumX = Math.max(maximumX, right);
    maximumY = Math.max(maximumY, bottom);
    for (let y = entity.y; y < bottom; y += 1) {
      for (let x = entity.x; x < right; x += 1) {
        const tile = y * width + x;
        if (occupied.has(tile)) {
          throw new TypeError(`Blueprint entities overlap at tile ${x},${y}.`);
        }
        occupied.add(tile);
      }
    }
  }
  for (let index = 0; index < rail.segments.length; index += 1) {
    const segment = rail.segments[index]!;
    const right = segment.x + 1;
    const bottom = segment.y + 1;
    if (right > width || bottom > height) {
      throw new RangeError(`Blueprint rail segment ${index} exceeds bounds.`);
    }
    minimumX = Math.min(minimumX, segment.x);
    minimumY = Math.min(minimumY, segment.y);
    maximumX = Math.max(maximumX, right);
    maximumY = Math.max(maximumY, bottom);
    const tile = segment.y * width + segment.x;
    if (occupied.has(tile)) {
      throw new TypeError(
        `Blueprint rail/entity construction overlaps at tile ${segment.x},${segment.y}.`,
      );
    }
    occupied.add(tile);
  }
  if (
    minimumX !== 0
    || minimumY !== 0
    || maximumX !== width
    || maximumY !== height
  ) {
    throw new TypeError(
      "Blueprint dimensions must be cropped to canonical occupied bounds.",
    );
  }
}

function restoreBlueprintCircuitEndpoint(
  value: unknown,
  label: string,
): BlueprintCircuitEndpoint {
  const record = requireRecord(value, ["entityRef", "connector"], label);
  return freezeBlueprintCircuitEndpoint(
    safeInteger(
      record.entityRef,
      `${label}.entityRef`,
      0,
      MAX_BLUEPRINT_ENTITIES - 1,
    ),
    circuitConnector(record.connector, `${label}.connector`),
  );
}

function restoreBlueprintCircuitWire(
  value: unknown,
  index: number,
): BlueprintCircuitWire {
  const label = `Blueprint wire ${index}`;
  const record = requireRecord(
    value,
    ["color", "endpointA", "endpointB"],
    label,
  );
  if (record.color !== "red" && record.color !== "green") {
    throw new TypeError(`${label}.color must be red or green.`);
  }
  const endpointA = restoreBlueprintCircuitEndpoint(
    record.endpointA,
    `${label}.endpointA`,
  );
  const endpointB = restoreBlueprintCircuitEndpoint(
    record.endpointB,
    `${label}.endpointB`,
  );
  if (compareBlueprintCircuitEndpoints(endpointA, endpointB) >= 0) {
    throw new TypeError(`${label} endpoints are not canonically ordered.`);
  }
  return OBJECT_FREEZE({
    color: record.color,
    endpointA,
    endpointB,
  });
}

function validateCircuitWires(
  entities: readonly BlueprintEntity[],
  wires: readonly BlueprintCircuitWire[],
  requireCanonicalOrder: boolean,
): void {
  let previous: BlueprintCircuitWire | undefined;
  const keys = new Set<string>();
  for (let index = 0; index < wires.length; index += 1) {
    const wire = wires[index]!;
    if (
      requireCanonicalOrder
      && previous !== undefined
      && compareBlueprintCircuitWires(previous, wire) >= 0
    ) {
      throw new TypeError(
        "Blueprint wires must be unique and canonically ordered.",
      );
    }
    previous = wire;
    if (
      compareBlueprintCircuitEndpoints(wire.endpointA, wire.endpointB) >= 0
    ) {
      throw new TypeError(`Blueprint wire ${index} endpoints are noncanonical.`);
    }
    const first = entities[wire.endpointA.entityRef];
    const second = entities[wire.endpointB.entityRef];
    if (first === undefined || second === undefined) {
      throw new TypeError(`Blueprint wire ${index} contains a dangling ref.`);
    }
    if (first.ref === second.ref) {
      throw new TypeError(`Blueprint wire ${index} is a self-link.`);
    }
    if (
      !entitySupportsConnector(first, wire.endpointA.connector)
      || !entitySupportsConnector(second, wire.endpointB.connector)
    ) {
      throw new TypeError(
        `Blueprint wire ${index} has an invalid connector/kind combination.`,
      );
    }
    if (!circuitEntitiesWithinReach(first, second)) {
      throw new RangeError(
        `Blueprint wire ${index} exceeds ${CIRCUIT_WIRE_REACH_TILES}-tile reach.`,
      );
    }
    const key = blueprintCircuitWireKey(wire);
    if (keys.has(key)) {
      throw new TypeError(`Blueprint wire ${index} is duplicated.`);
    }
    keys.add(key);
  }
}

function restoreBlueprintRailSegment(
  value: unknown,
  index: number,
): BlueprintRailSegment {
  const label = `Blueprint rail segment ${index}`;
  const record = requireRecord(
    value,
    ["ref", "x", "y", "kind", "rotation"],
    label,
  );
  const ref = safeInteger(
    record.ref,
    `${label}.ref`,
    0,
    MAX_BLUEPRINT_RAIL_SEGMENTS - 1,
  );
  if (ref !== index) {
    throw new TypeError(`${label}.ref must equal its canonical array index.`);
  }
  const kind = railSegmentKind(record.kind, `${label}.kind`);
  return OBJECT_FREEZE({
    ref,
    x: safeInteger(record.x, `${label}.x`, 0, MAX_BLUEPRINT_SPAN - 1),
    y: safeInteger(record.y, `${label}.y`, 0, MAX_BLUEPRINT_SPAN - 1),
    kind,
    rotation: canonicalRailRotation(
      record.rotation,
      kind,
      `${label}.rotation`,
      true,
    ),
  });
}

function restoreBlueprintRailSignal(
  value: unknown,
  index: number,
): BlueprintRailSignal {
  const label = `Blueprint rail signal ${index}`;
  const record = requireRecord(
    value,
    ["fromSegmentRef", "toSegmentRef", "type"],
    label,
  );
  return OBJECT_FREEZE({
    fromSegmentRef: safeInteger(
      record.fromSegmentRef,
      `${label}.fromSegmentRef`,
      0,
      MAX_BLUEPRINT_RAIL_SEGMENTS - 1,
    ),
    toSegmentRef: safeInteger(
      record.toSegmentRef,
      `${label}.toSegmentRef`,
      0,
      MAX_BLUEPRINT_RAIL_SEGMENTS - 1,
    ),
    type: railSignalType(record.type, `${label}.type`),
  });
}

function restoreBlueprintRailStorageBinding(
  value: unknown,
  label: string,
): BlueprintRailStorageBinding | null {
  if (value === null) return null;
  const record = requireRecord(
    value,
    ["entityRef", "mode", "transferRate", "itemFilter"],
    label,
  );
  if (record.mode !== "load" && record.mode !== "unload" && record.mode !== "both") {
    throw new TypeError(`${label}.mode is invalid.`);
  }
  return freezeRailStorageBinding(
    safeInteger(
      record.entityRef,
      `${label}.entityRef`,
      0,
      MAX_BLUEPRINT_ENTITIES - 1,
    ),
    record.mode,
    safeInteger(
      record.transferRate,
      `${label}.transferRate`,
      1,
      MAX_BLUEPRINT_RAIL_UNITS,
    ),
    canonicalRailItemFilter(
      record.itemFilter,
      `${label}.itemFilter`,
      true,
    ),
  );
}

function restoreBlueprintRailStation(
  value: unknown,
  index: number,
): BlueprintRailStation {
  const label = `Blueprint rail station ${index}`;
  const record = requireRecord(
    value,
    ["ref", "segmentRef", "capacity", "storageBinding"],
    label,
  );
  const ref = safeInteger(
    record.ref,
    `${label}.ref`,
    0,
    MAX_BLUEPRINT_RAIL_STATIONS - 1,
  );
  if (ref !== index) {
    throw new TypeError(`${label}.ref must equal its canonical array index.`);
  }
  return OBJECT_FREEZE({
    ref,
    segmentRef: safeInteger(
      record.segmentRef,
      `${label}.segmentRef`,
      0,
      MAX_BLUEPRINT_RAIL_SEGMENTS - 1,
    ),
    capacity: safeInteger(
      record.capacity,
      `${label}.capacity`,
      0,
      MAX_BLUEPRINT_RAIL_UNITS,
    ),
    storageBinding: restoreBlueprintRailStorageBinding(
      record.storageBinding,
      `${label}.storageBinding`,
    ),
  });
}

function restoreBlueprintRailCar(
  value: unknown,
  label: string,
): BlueprintRailCar {
  const candidate = requireSubsetRecord(
    value,
    ["kind", "fuelCapacityMilli", "capacity"],
    label,
  );
  if (candidate.kind === "locomotive") {
    const record = requireRecord(
      value,
      ["kind", "fuelCapacityMilli"],
      label,
    );
    return OBJECT_FREEZE({
      kind: "locomotive" as const,
      fuelCapacityMilli: safeInteger(
        record.fuelCapacityMilli,
        `${label}.fuelCapacityMilli`,
        1,
        MAX_BLUEPRINT_RAIL_UNITS,
      ),
    });
  }
  if (candidate.kind === "cargo-wagon") {
    const record = requireRecord(value, ["kind", "capacity"], label);
    return OBJECT_FREEZE({
      kind: "cargo-wagon" as const,
      capacity: safeInteger(
        record.capacity,
        `${label}.capacity`,
        1,
        MAX_BLUEPRINT_RAIL_UNITS,
      ),
    });
  }
  throw new TypeError(`${label}.kind is not a known rail car kind.`);
}

function restoreBlueprintRailScheduleStop(
  value: unknown,
  label: string,
): BlueprintRailScheduleStop {
  const record = requireRecord(value, ["stationRef", "wait"], label);
  return OBJECT_FREEZE({
    stationRef: safeInteger(
      record.stationRef,
      `${label}.stationRef`,
      0,
      MAX_BLUEPRINT_RAIL_STATIONS - 1,
    ),
    wait: restoreRailWait(record.wait, `${label}.wait`),
  });
}

function restoreBlueprintRailTrain(
  value: unknown,
  index: number,
): BlueprintRailTrain {
  const label = `Blueprint rail train ${index}`;
  const record = requireRecord(
    value,
    ["ref", "segmentRef", "cars", "schedule"],
    label,
  );
  const ref = safeInteger(
    record.ref,
    `${label}.ref`,
    0,
    MAX_BLUEPRINT_RAIL_TRAINS - 1,
  );
  if (ref !== index) {
    throw new TypeError(`${label}.ref must equal its canonical array index.`);
  }
  const carValues = requireDenseArray(
    record.cars,
    MAX_BLUEPRINT_RAIL_CARS_PER_TRAIN,
    `${label}.cars`,
  );
  if (carValues.length === 0) {
    throw new TypeError(`${label}.cars must not be empty.`);
  }
  const cars: BlueprintRailCar[] = [];
  let locomotives = 0;
  for (let carIndex = 0; carIndex < carValues.length; carIndex += 1) {
    const car = restoreBlueprintRailCar(
      carValues[carIndex],
      `${label}.cars[${carIndex}]`,
    );
    if (car.kind === "locomotive") locomotives += 1;
    cars.push(car);
  }
  if (locomotives === 0) {
    throw new TypeError(`${label}.cars must contain a locomotive.`);
  }
  for (let carIndex = 1; carIndex < cars.length; carIndex += 1) {
    if (
      compareBlueprintRailCars(cars[carIndex - 1]!, cars[carIndex]!) > 0
    ) {
      throw new TypeError(`${label}.cars must be canonically ordered.`);
    }
  }
  const stopValues = requireDenseArray(
    record.schedule,
    MAX_BLUEPRINT_RAIL_SCHEDULE_STOPS,
    `${label}.schedule`,
  );
  if (stopValues.length === 0) {
    throw new TypeError(`${label}.schedule must not be empty.`);
  }
  const schedule: BlueprintRailScheduleStop[] = [];
  for (let stopIndex = 0; stopIndex < stopValues.length; stopIndex += 1) {
    schedule.push(
      restoreBlueprintRailScheduleStop(
        stopValues[stopIndex],
        `${label}.schedule[${stopIndex}]`,
      ),
    );
  }
  return OBJECT_FREEZE({
    ref,
    segmentRef: safeInteger(
      record.segmentRef,
      `${label}.segmentRef`,
      0,
      MAX_BLUEPRINT_RAIL_SEGMENTS - 1,
    ),
    cars: OBJECT_FREEZE(cars),
    schedule: OBJECT_FREEZE(schedule),
  });
}

function restoreBlueprintRailIntent(value: unknown): BlueprintRailIntent {
  const record = requireRecord(
    value,
    ["segments", "signals", "stations", "trains"],
    "Blueprint.rail",
  );
  const segmentValues = requireDenseArray(
    record.segments,
    MAX_BLUEPRINT_RAIL_SEGMENTS,
    "Blueprint.rail.segments",
  );
  const segments: BlueprintRailSegment[] = [];
  for (let index = 0; index < segmentValues.length; index += 1) {
    segments.push(restoreBlueprintRailSegment(segmentValues[index], index));
  }
  const signalValues = requireDenseArray(
    record.signals,
    MAX_BLUEPRINT_RAIL_SIGNALS,
    "Blueprint.rail.signals",
  );
  const signals: BlueprintRailSignal[] = [];
  for (let index = 0; index < signalValues.length; index += 1) {
    signals.push(restoreBlueprintRailSignal(signalValues[index], index));
  }
  const stationValues = requireDenseArray(
    record.stations,
    MAX_BLUEPRINT_RAIL_STATIONS,
    "Blueprint.rail.stations",
  );
  const stations: BlueprintRailStation[] = [];
  for (let index = 0; index < stationValues.length; index += 1) {
    stations.push(restoreBlueprintRailStation(stationValues[index], index));
  }
  const trainValues = requireDenseArray(
    record.trains,
    MAX_BLUEPRINT_RAIL_TRAINS,
    "Blueprint.rail.trains",
  );
  const trains: BlueprintRailTrain[] = [];
  for (let index = 0; index < trainValues.length; index += 1) {
    trains.push(restoreBlueprintRailTrain(trainValues[index], index));
  }
  return freezeRailIntent(segments, signals, stations, trains);
}

function validateRailIntent(
  width: number,
  height: number,
  entities: readonly BlueprintEntity[],
  rail: BlueprintRailIntent,
  requireCanonicalOrder: boolean,
): void {
  let previousSegment: BlueprintRailSegment | undefined;
  const railTiles = new Set<string>();
  for (let index = 0; index < rail.segments.length; index += 1) {
    const segment = rail.segments[index]!;
    if (segment.ref !== index) {
      throw new TypeError("Blueprint rail segment refs must be canonical.");
    }
    if (
      requireCanonicalOrder
      && previousSegment !== undefined
      && compareBlueprintRailSegments(previousSegment, segment) >= 0
    ) {
      throw new TypeError(
        "Blueprint rail segments must be unique and canonically ordered.",
      );
    }
    previousSegment = segment;
    if (
      segment.x < 0
      || segment.y < 0
      || segment.x >= width
      || segment.y >= height
    ) {
      throw new RangeError(`Blueprint rail segment ${index} exceeds bounds.`);
    }
    const key = `${segment.x},${segment.y}`;
    if (railTiles.has(key)) {
      throw new TypeError(`Blueprint rail segments overlap at ${key}.`);
    }
    railTiles.add(key);
  }

  let previousSignal: BlueprintRailSignal | undefined;
  const signalTransitions = new Set<string>();
  for (let index = 0; index < rail.signals.length; index += 1) {
    const signal = rail.signals[index]!;
    if (
      requireCanonicalOrder
      && previousSignal !== undefined
      && compareBlueprintRailSignals(previousSignal, signal) >= 0
    ) {
      throw new TypeError(
        "Blueprint rail signals must be unique and canonically ordered.",
      );
    }
    previousSignal = signal;
    const from = rail.segments[signal.fromSegmentRef];
    const to = rail.segments[signal.toSegmentRef];
    if (from === undefined || to === undefined) {
      throw new TypeError(`Blueprint rail signal ${index} has a dangling ref.`);
    }
    if (from.ref === to.ref || !railSegmentsConnect(from, to)) {
      throw new TypeError(
        `Blueprint rail signal ${index} links unreachable segments.`,
      );
    }
    const transition = `${signal.fromSegmentRef}\u0000${
      signal.toSegmentRef
    }`;
    if (signalTransitions.has(transition)) {
      throw new TypeError(
        `Blueprint rail signal ${index} duplicates a directed transition.`,
      );
    }
    signalTransitions.add(transition);
  }

  let previousStation: BlueprintRailStation | undefined;
  const stationSegments = new Set<number>();
  const boundStorageEntities = new Set<number>();
  for (let index = 0; index < rail.stations.length; index += 1) {
    const station = rail.stations[index]!;
    if (station.ref !== index) {
      throw new TypeError("Blueprint rail station refs must be canonical.");
    }
    if (
      requireCanonicalOrder
      && previousStation !== undefined
      && compareBlueprintRailStations(previousStation, station) >= 0
    ) {
      throw new TypeError(
        "Blueprint rail stations must be unique and canonically ordered.",
      );
    }
    previousStation = station;
    if (rail.segments[station.segmentRef] === undefined) {
      throw new TypeError(`Blueprint rail station ${index} has a dangling ref.`);
    }
    if (stationSegments.has(station.segmentRef)) {
      throw new TypeError(
        `Blueprint rail station ${index} duplicates a segment binding.`,
      );
    }
    stationSegments.add(station.segmentRef);
    if (station.storageBinding !== null) {
      const storage = entities[station.storageBinding.entityRef];
      if (storage === undefined || storage.kind !== "storage") {
        throw new TypeError(
          `Blueprint rail station ${index} has a dangling/non-storage binding.`,
        );
      }
      if (boundStorageEntities.has(storage.ref)) {
        throw new TypeError(
          `Blueprint rail station ${index} reuses a bound storage entity.`,
        );
      }
      boundStorageEntities.add(storage.ref);
      const stationSegment = rail.segments[station.segmentRef]!;
      const storageSize = footprint(storage.kind, storage.direction);
      let adjacent = false;
      for (
        let y = storage.y;
        y < storage.y + storageSize.height && !adjacent;
        y += 1
      ) {
        for (
          let x = storage.x;
          x < storage.x + storageSize.width;
          x += 1
        ) {
          if (
            Math.abs(x - stationSegment.x)
              + Math.abs(y - stationSegment.y)
            === 1
          ) {
            adjacent = true;
            break;
          }
        }
      }
      if (!adjacent) {
        throw new TypeError(
          `Blueprint rail station ${index} storage binding is not adjacent.`,
        );
      }
    }
  }

  let previousTrain: BlueprintRailTrain | undefined;
  const occupiedSegments = new Set<number>();
  const occupiedBlocks = new Set<string>();
  const railGraph = rail.segments.length === 0
    ? null
    : createRailGraph(
        rail.segments.map((segment) => ({
          id: `segment:${segment.ref}`,
          x: segment.x,
          y: segment.y,
          kind: segment.kind,
          rotation: segment.rotation,
        })),
        rail.signals.map((signal, index) => ({
          id: `signal:${index}`,
          fromSegmentId: `segment:${signal.fromSegmentRef}`,
          toSegmentId: `segment:${signal.toSegmentRef}`,
          type: signal.type,
        })),
      );
  const blockBySegment = new Map(
    railGraph?.nodes.map((node) => [node.segmentId, node.blockId]) ?? [],
  );
  for (let index = 0; index < rail.trains.length; index += 1) {
    const train = rail.trains[index]!;
    if (train.ref !== index) {
      throw new TypeError("Blueprint rail train refs must be canonical.");
    }
    if (
      requireCanonicalOrder
      && previousTrain !== undefined
      && compareBlueprintRailTrains(previousTrain, train) >= 0
    ) {
      throw new TypeError(
        "Blueprint rail trains must be unique and canonically ordered.",
      );
    }
    if (
      previousTrain !== undefined
      && railTrainSemanticKey(previousTrain) === railTrainSemanticKey(train)
    ) {
      throw new TypeError("Blueprint rail trains duplicate construction intent.");
    }
    previousTrain = train;
    if (rail.segments[train.segmentRef] === undefined) {
      throw new TypeError(`Blueprint rail train ${index} has a dangling ref.`);
    }
    if (occupiedSegments.has(train.segmentRef)) {
      throw new TypeError(
        `Blueprint rail train ${index} overlaps another train segment.`,
      );
    }
    occupiedSegments.add(train.segmentRef);
    const blockId = blockBySegment.get(`segment:${train.segmentRef}`)!;
    if (occupiedBlocks.has(blockId)) {
      throw new TypeError(
        `Blueprint rail train ${index} occupies an already occupied block.`,
      );
    }
    occupiedBlocks.add(blockId);
    if (train.cars.length === 0 || !train.cars.some(
      (car) => car.kind === "locomotive",
    )) {
      throw new TypeError(
        `Blueprint rail train ${index} must contain a locomotive.`,
      );
    }
    if (train.schedule.length === 0) {
      throw new TypeError(
        `Blueprint rail train ${index} schedule must not be empty.`,
      );
    }
    for (let stopIndex = 0; stopIndex < train.schedule.length; stopIndex += 1) {
      if (rail.stations[train.schedule[stopIndex]!.stationRef] === undefined) {
        throw new TypeError(
          `Blueprint rail train ${index} schedule has a dangling station ref.`,
        );
      }
    }
  }
}

function parseStrictJson(serialized: string): unknown {
  if (serialized.length > MAX_BLUEPRINT_JSON_LENGTH) {
    throw new RangeError(
      `Blueprint JSON exceeds ${MAX_BLUEPRINT_JSON_LENGTH} characters.`,
    );
  }
  let cursor = 0;
  let depth = 0;
  const length = serialized.length;
  const syntax = (message: string): never => {
    throw new SyntaxError(`Invalid blueprint JSON: ${message}.`);
  };
  const whitespace = (code: number): boolean =>
    code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
  const digit = (code: number): boolean => code >= 0x30 && code <= 0x39;
  const hex = (code: number): boolean =>
    digit(code)
    || (code >= 0x41 && code <= 0x46)
    || (code >= 0x61 && code <= 0x66);
  const skip = (): void => {
    while (cursor < length && whitespace(charCodeAt(serialized, cursor))) {
      cursor += 1;
    }
  };
  const stringToken = (): string => {
    const start = cursor;
    if (charCodeAt(serialized, cursor) !== 0x22) {
      return syntax("expected string");
    }
    cursor += 1;
    while (cursor < length) {
      const code = charCodeAt(serialized, cursor);
      if (code === 0x22) {
        cursor += 1;
        const decoded = REFLECT_APPLY(
          JSON_PARSE,
          undefined,
          [slice(serialized, start, cursor)],
        ) as unknown;
        if (typeof decoded !== "string") return syntax("invalid string");
        return decoded;
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
        for (let offset = 1; offset <= 4; offset += 1) {
          if (
            cursor + offset >= length
            || !hex(charCodeAt(serialized, cursor + offset))
          ) {
            return syntax("invalid unicode escape");
          }
        }
        cursor += 5;
      } else if (
        escape === 0x22
        || escape === 0x5c
        || escape === 0x2f
        || escape === 0x62
        || escape === 0x66
        || escape === 0x6e
        || escape === 0x72
        || escape === 0x74
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
        cursor + index >= length
        || charCodeAt(serialized, cursor + index) !== charCodeAt(expected, index)
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
    if (depth > MAX_BLUEPRINT_JSON_DEPTH) {
      return syntax("maximum nesting depth exceeded");
    }
    cursor += 1;
    skip();
    if (charCodeAt(serialized, cursor) === 0x5d) {
      cursor += 1;
      depth -= 1;
      return;
    }
    while (true) {
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
    if (depth > MAX_BLUEPRINT_JSON_DEPTH) {
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
      if (REFLECT_APPLY(SET_HAS, keys, [key]) as boolean) {
        return syntax(`duplicate member ${quote(key)}`);
      }
      REFLECT_APPLY(SET_ADD, keys, [key]);
      memberCount += 1;
      if (memberCount > MAX_BLUEPRINT_JSON_OBJECT_MEMBERS) {
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
 * Strictly validates an object or serialized blueprint and returns a detached,
 * deeply frozen canonical value. Unknown fields, accessors, sparse arrays,
 * overlaps, stale catalog versions, and non-canonical bounds/order are rejected.
 */
export function restoreBlueprint(value: unknown): Blueprint {
  if (
    typeof value === "object"
    && value !== null
    && blueprintBrand.has(value)
  ) {
    return value as Blueprint;
  }
  const decoded = typeof value === "string" ? parseStrictJson(value) : value;
  const candidate = requireSubsetRecord(
    decoded,
    [
      "format",
      "version",
      "catalog",
      "width",
      "height",
      "entities",
      "wires",
      "rail",
    ],
    "Blueprint",
  );
  const version = candidate.version;
  if (
    version !== BLUEPRINT_VERSION
    && version !== LEGACY_BLUEPRINT_VERSION_1
    && version !== LEGACY_BLUEPRINT_VERSION_2
  ) {
    throw new TypeError(
      `Blueprint version must be ${LEGACY_BLUEPRINT_VERSION_1}, ${
        LEGACY_BLUEPRINT_VERSION_2
      }, or ${BLUEPRINT_VERSION}.`,
    );
  }
  const record = requireRecord(
    decoded,
    version === BLUEPRINT_VERSION
      ? [
          "format",
          "version",
          "catalog",
          "width",
          "height",
          "entities",
          "wires",
          "rail",
        ]
      : ["format", "version", "catalog", "width", "height", "entities"],
    "Blueprint",
  );
  if (record.format !== BLUEPRINT_FORMAT) {
    throw new TypeError(`Blueprint format must be ${BLUEPRINT_FORMAT}.`);
  }
  if (record.catalog !== CATALOG_VERSION) {
    throw new TypeError(`Blueprint catalog must be ${CATALOG_VERSION}.`);
  }
  const width = safeInteger(
    record.width,
    "Blueprint.width",
    0,
    MAX_BLUEPRINT_SPAN,
  );
  const height = safeInteger(
    record.height,
    "Blueprint.height",
    0,
    MAX_BLUEPRINT_SPAN,
  );
  const serializedEntities = requireDenseArray(
    record.entities,
    MAX_BLUEPRINT_ENTITIES,
    "Blueprint.entities",
  );
  const entities: BlueprintEntity[] = [];
  for (let index = 0; index < serializedEntities.length; index += 1) {
    entities.push(
      restoreEntity(
        serializedEntities[index],
        index,
        version,
      ),
    );
  }
  const wires: BlueprintCircuitWire[] = [];
  if (version === BLUEPRINT_VERSION) {
    const wireValues = requireDenseArray(
      record.wires,
      MAX_BLUEPRINT_WIRES,
      "Blueprint.wires",
    );
    for (let index = 0; index < wireValues.length; index += 1) {
      wires.push(restoreBlueprintCircuitWire(wireValues[index], index));
    }
  }
  const rail =
    version === BLUEPRINT_VERSION
      ? restoreBlueprintRailIntent(record.rail)
      : emptyRailIntent();
  validateGeometry(width, height, entities, rail, true);
  validateCircuitWires(entities, wires, true);
  validateRailIntent(width, height, entities, rail, true);
  const blueprint = freezeBlueprint(width, height, entities, wires, rail);
  assertBlueprintCanonicalLength(blueprint);
  return blueprint;
}

function encodeRouting(routing: BlueprintManifoldRouting | null): string {
  if (routing === null) return "null";
  return `{"mode":${quote(routing.mode)},"filter":${
    routing.filter === null ? "null" : quote(routing.filter)
  },"extractPort":${routing.extractPort}}`;
}

function encodeEntity(entity: BlueprintEntity): string {
  return `{"ref":${entity.ref},"kind":${quote(entity.kind)},"x":${entity.x},"y":${entity.y},`
    + `"direction":${entity.direction},"recipeId":${
      entity.recipeId === null ? "null" : quote(entity.recipeId)
    },"manifoldRouting":${encodeRouting(entity.manifoldRouting)}}`;
}

function encodeCanonicalData(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return quote(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!NUMBER_IS_SAFE_INTEGER(value) || OBJECT_IS(value, -0)) {
      throw new TypeError("Canonical blueprint data contains an unsafe number.");
    }
    return String(value);
  }
  if (ARRAY_IS_ARRAY(value)) {
    let encoded = "[";
    for (let index = 0; index < value.length; index += 1) {
      if (index !== 0) encoded += ",";
      encoded += encodeCanonicalData(value[index]);
    }
    return `${encoded}]`;
  }
  if (typeof value !== "object") {
    throw new TypeError("Canonical blueprint data contains an invalid value.");
  }
  const names = OBJECT_GET_OWN_PROPERTY_NAMES(value);
  let encoded = "{";
  for (let index = 0; index < names.length; index += 1) {
    const key = names[index]!;
    if (index !== 0) encoded += ",";
    encoded += `${quote(key)}:${encodeCanonicalData(
      ownData(value, key, "Canonical blueprint data", true),
    )}`;
  }
  return `${encoded}}`;
}

function assertBlueprintCanonicalLength(value: Blueprint): void {
  if (encodeCanonicalData(value).length > MAX_BLUEPRINT_JSON_LENGTH) {
    throw new RangeError(
      `Blueprint JSON exceeds ${MAX_BLUEPRINT_JSON_LENGTH} characters.`,
    );
  }
}

/** Emits one byte-stable JSON representation with explicit property order. */
export function serializeBlueprint(value: Blueprint): string {
  const blueprint = restoreBlueprint(value);
  const encoded = encodeCanonicalData(blueprint);
  if (encoded.length > MAX_BLUEPRINT_JSON_LENGTH) {
    throw new RangeError(
      `Blueprint JSON exceeds ${MAX_BLUEPRINT_JSON_LENGTH} characters.`,
    );
  }
  return encoded;
}

function transformOptions(value: BlueprintTransform | undefined): {
  readonly mirror: BlueprintMirror | undefined;
  readonly quarterTurns: BlueprintQuarterTurns;
} {
  if (value === undefined) return { mirror: undefined, quarterTurns: 0 };
  const record = requireSubsetRecord(
    value,
    ["mirror", "quarterTurns"],
    "Blueprint transform",
  );
  const mirror = record.mirror;
  if (
    mirror !== undefined
    && mirror !== "horizontal"
    && mirror !== "vertical"
  ) {
    throw new TypeError("Blueprint transform mirror is invalid.");
  }
  const turnsValue =
    record.quarterTurns === undefined ? 0 : record.quarterTurns;
  if (
    OBJECT_IS(turnsValue, -0)
    || (
      turnsValue !== 0
    && turnsValue !== 1
    && turnsValue !== 2
    && turnsValue !== 3
    )
  ) {
    throw new TypeError("Blueprint transform quarterTurns must be 0, 1, 2, or 3.");
  }
  return { mirror, quarterTurns: turnsValue };
}

function mirroredDirection(
  facing: Direction,
  mirror: BlueprintMirror,
): Direction {
  if (mirror === "horizontal") {
    if (facing === Direction.East) return Direction.West;
    if (facing === Direction.West) return Direction.East;
    return facing;
  }
  if (facing === Direction.North) return Direction.South;
  if (facing === Direction.South) return Direction.North;
  return facing;
}

function mirroredRouting(
  routing: BlueprintManifoldRouting | null,
): BlueprintManifoldRouting | null {
  if (routing === null) return null;
  return freezeRouting(
    routing.mode === ManifoldMode.FavorA
      ? ManifoldMode.FavorB
      : routing.mode === ManifoldMode.FavorB
        ? ManifoldMode.FavorA
        : routing.mode,
    routing.filter,
    routing.extractPort === 0 ? 1 : 0,
  );
}

function mirroredCircuitMachineConfiguration(
  kind: EntityKind,
  configuration: BlueprintCircuitMachineConfiguration | null,
): BlueprintCircuitMachineConfiguration | null {
  if (kind !== "manifold" || configuration === null) return configuration;
  const swapOutput = (
    output:
      | typeof CIRCUIT_SORTER_OUTPUT_A
      | typeof CIRCUIT_SORTER_OUTPUT_B,
  ): typeof CIRCUIT_SORTER_OUTPUT_A | typeof CIRCUIT_SORTER_OUTPUT_B =>
    output === CIRCUIT_SORTER_OUTPUT_A
      ? CIRCUIT_SORTER_OUTPUT_B
      : CIRCUIT_SORTER_OUTPUT_A;
  return OBJECT_FREEZE({
    enableCondition: configuration.enableCondition,
    powerSwitchCondition: configuration.powerSwitchCondition,
    filter: configuration.filter,
    sorterRoutes: OBJECT_FREEZE(
      configuration.sorterRoutes.map((route) =>
        OBJECT_FREEZE({
          priority: route.priority,
          output: swapOutput(
            route.output as
              | typeof CIRCUIT_SORTER_OUTPUT_A
              | typeof CIRCUIT_SORTER_OUTPUT_B,
          ),
          condition: route.condition,
        })
      ),
    ),
    sorterFallback:
      configuration.sorterFallback === null
        ? null
        : swapOutput(configuration.sorterFallback),
  });
}

function moduloFour(value: number): 0 | 1 | 2 | 3 {
  return ((value % 4) + 4) % 4 as 0 | 1 | 2 | 3;
}

function mirroredRailRotation(
  kind: RailSegmentKind,
  rotation: 0 | 1 | 2 | 3,
  mirror: BlueprintMirror,
): 0 | 1 | 2 | 3 {
  const raw =
    mirror === "horizontal"
      ? kind === "curve"
        ? 3 - rotation
        : 4 - rotation
      : kind === "curve"
        ? 1 - rotation
        : 2 - rotation;
  return canonicalRailRotation(
    moduloFour(raw),
    kind,
    "Transformed rail rotation",
    false,
  );
}

function reindexBlueprintConstruction(
  width: number,
  height: number,
  entityCandidates: readonly BlueprintEntity[],
  sourceWires: readonly BlueprintCircuitWire[],
  railCandidates: BlueprintRailIntent,
): Blueprint {
  const sortedEntities = entityCandidates.slice().sort(compareEntities);
  const entityRefMap = new Map<number, number>();
  const entities: BlueprintEntity[] = [];
  for (let index = 0; index < sortedEntities.length; index += 1) {
    const entity = sortedEntities[index]!;
    entityRefMap.set(entity.ref, index);
    entities.push(
      freezeEntity(
        index,
        entity.kind,
        entity.x,
        entity.y,
        entity.direction,
        entity.recipeId,
        entity.manifoldRouting,
        entity.fluidId,
        entity.fluidRecipeId,
        entity.circuitDevice,
        entity.circuitMachine,
      ),
    );
  }
  const wires: BlueprintCircuitWire[] = [];
  for (let index = 0; index < sourceWires.length; index += 1) {
    const wire = sourceWires[index]!;
    const firstRef = entityRefMap.get(wire.endpointA.entityRef);
    const secondRef = entityRefMap.get(wire.endpointB.entityRef);
    if (firstRef === undefined || secondRef === undefined) {
      throw new TypeError("Transformed wire contains a dangling entity ref.");
    }
    wires.push(
      freezeBlueprintCircuitWire(
        wire.color,
        freezeBlueprintCircuitEndpoint(
          firstRef,
          wire.endpointA.connector,
        ),
        freezeBlueprintCircuitEndpoint(
          secondRef,
          wire.endpointB.connector,
        ),
      ),
    );
  }
  wires.sort(compareBlueprintCircuitWires);

  const sortedSegments = railCandidates.segments
    .slice()
    .sort(compareBlueprintRailSegments);
  const segmentRefMap = new Map<number, number>();
  const segments: BlueprintRailSegment[] = [];
  for (let index = 0; index < sortedSegments.length; index += 1) {
    const segment = sortedSegments[index]!;
    segmentRefMap.set(segment.ref, index);
    segments.push(OBJECT_FREEZE({
      ref: index,
      x: segment.x,
      y: segment.y,
      kind: segment.kind,
      rotation: segment.rotation,
    }));
  }
  const signals: BlueprintRailSignal[] = [];
  for (let index = 0; index < railCandidates.signals.length; index += 1) {
    const signal = railCandidates.signals[index]!;
    const fromSegmentRef = segmentRefMap.get(signal.fromSegmentRef);
    const toSegmentRef = segmentRefMap.get(signal.toSegmentRef);
    if (fromSegmentRef === undefined || toSegmentRef === undefined) {
      throw new TypeError("Transformed signal contains a dangling segment ref.");
    }
    signals.push(OBJECT_FREEZE({
      fromSegmentRef,
      toSegmentRef,
      type: signal.type,
    }));
  }
  signals.sort(compareBlueprintRailSignals);

  const stationCandidates: BlueprintRailStation[] = [];
  for (let index = 0; index < railCandidates.stations.length; index += 1) {
    const station = railCandidates.stations[index]!;
    const segmentRef = segmentRefMap.get(station.segmentRef);
    if (segmentRef === undefined) {
      throw new TypeError("Transformed station contains a dangling segment ref.");
    }
    let storageBinding: BlueprintRailStorageBinding | null = null;
    if (station.storageBinding !== null) {
      const entityRef = entityRefMap.get(station.storageBinding.entityRef);
      if (entityRef === undefined) {
        throw new TypeError(
          "Transformed station contains a dangling storage ref.",
        );
      }
      storageBinding = freezeRailStorageBinding(
        entityRef,
        station.storageBinding.mode,
        station.storageBinding.transferRate,
        station.storageBinding.itemFilter,
      );
    }
    stationCandidates.push(OBJECT_FREEZE({
      ref: station.ref,
      segmentRef,
      capacity: station.capacity,
      storageBinding,
    }));
  }
  stationCandidates.sort(compareBlueprintRailStations);
  const stationRefMap = new Map<number, number>();
  const stations: BlueprintRailStation[] = [];
  for (let index = 0; index < stationCandidates.length; index += 1) {
    const station = stationCandidates[index]!;
    stationRefMap.set(station.ref, index);
    stations.push(OBJECT_FREEZE({
      ref: index,
      segmentRef: station.segmentRef,
      capacity: station.capacity,
      storageBinding: station.storageBinding,
    }));
  }

  const trainCandidates: BlueprintRailTrain[] = [];
  for (let index = 0; index < railCandidates.trains.length; index += 1) {
    const train = railCandidates.trains[index]!;
    const segmentRef = segmentRefMap.get(train.segmentRef);
    if (segmentRef === undefined) {
      throw new TypeError("Transformed train contains a dangling segment ref.");
    }
    const schedule: BlueprintRailScheduleStop[] = [];
    for (let stopIndex = 0; stopIndex < train.schedule.length; stopIndex += 1) {
      const stop = train.schedule[stopIndex]!;
      const stationRef = stationRefMap.get(stop.stationRef);
      if (stationRef === undefined) {
        throw new TypeError(
          "Transformed train schedule contains a dangling station ref.",
        );
      }
      schedule.push(OBJECT_FREEZE({ stationRef, wait: stop.wait }));
    }
    trainCandidates.push(OBJECT_FREEZE({
      ref: train.ref,
      segmentRef,
      cars: train.cars,
      schedule: OBJECT_FREEZE(schedule),
    }));
  }
  trainCandidates.sort(compareBlueprintRailTrains);
  const trains: BlueprintRailTrain[] = [];
  for (let index = 0; index < trainCandidates.length; index += 1) {
    const train = trainCandidates[index]!;
    trains.push(OBJECT_FREEZE({
      ref: index,
      segmentRef: train.segmentRef,
      cars: train.cars,
      schedule: train.schedule,
    }));
  }
  const rail = freezeRailIntent(segments, signals, stations, trains);
  validateGeometry(width, height, entities, rail, true);
  validateCircuitWires(entities, wires, true);
  validateRailIntent(width, height, entities, rail, true);
  const result = freezeBlueprint(width, height, entities, wires, rail);
  assertBlueprintCanonicalLength(result);
  return result;
}

/**
 * Applies an exact grid reflection and/or clockwise quarter-turn. Reflections
 * swap local manifold branches, including the matching output of Extract mode.
 */
export function transformBlueprint(
  value: Blueprint,
  transformValue: BlueprintTransform = {},
): Blueprint {
  const blueprint = restoreBlueprint(value);
  const transform = transformOptions(transformValue);
  let current = blueprint;

  if (transform.mirror !== undefined) {
    const width = current.width;
    const height = current.height;
    const entities = current.entities.map((entity) => {
      const size = footprint(entity.kind, entity.direction);
      return freezeEntity(
        entity.ref,
        entity.kind,
        transform.mirror === "horizontal"
          ? width - entity.x - size.width
          : entity.x,
        transform.mirror === "vertical"
          ? height - entity.y - size.height
          : entity.y,
        mirroredDirection(entity.direction, transform.mirror!),
        entity.recipeId,
        mirroredRouting(entity.manifoldRouting),
        entity.fluidId,
        entity.fluidRecipeId,
        entity.circuitDevice,
        mirroredCircuitMachineConfiguration(
          entity.kind,
          entity.circuitMachine,
        ),
      );
    });
    const segments = current.rail.segments.map((segment) =>
      OBJECT_FREEZE({
        ref: segment.ref,
        x:
          transform.mirror === "horizontal"
            ? width - segment.x - 1
            : segment.x,
        y:
          transform.mirror === "vertical"
            ? height - segment.y - 1
            : segment.y,
        kind: segment.kind,
        rotation: mirroredRailRotation(
          segment.kind,
          segment.rotation,
          transform.mirror!,
        ),
      })
    );
    current = reindexBlueprintConstruction(
      width,
      height,
      entities,
      current.wires,
      freezeRailIntent(
        segments,
        current.rail.signals,
        current.rail.stations,
        current.rail.trains,
      ),
    );
  }

  for (let turn = 0; turn < transform.quarterTurns; turn += 1) {
    const width = current.width;
    const height = current.height;
    const entities = current.entities.map((entity) => {
      const size = footprint(entity.kind, entity.direction);
      return freezeEntity(
        entity.ref,
        entity.kind,
        height - entity.y - size.height,
        entity.x,
        ((entity.direction + 1) % 4) as Direction,
        entity.recipeId,
        entity.manifoldRouting,
        entity.fluidId,
        entity.fluidRecipeId,
        entity.circuitDevice,
        entity.circuitMachine,
      );
    });
    const segments = current.rail.segments.map((segment) =>
      OBJECT_FREEZE({
        ref: segment.ref,
        x: height - segment.y - 1,
        y: segment.x,
        kind: segment.kind,
        rotation: canonicalRailRotation(
          moduloFour(segment.rotation + 1),
          segment.kind,
          "Transformed rail rotation",
          false,
        ),
      })
    );
    current = reindexBlueprintConstruction(
      height,
      width,
      entities,
      current.wires,
      freezeRailIntent(
        segments,
        current.rail.signals,
        current.rail.stations,
        current.rail.trains,
      ),
    );
  }
  return current;
}

/**
 * Produces a detached absolute placement list, sorted top-to-bottom then
 * left-to-right after transformation. It performs no simulation mutation.
 */
export function planBlueprintPlacement(
  value: Blueprint,
  target: Pick<BlueprintSelection, "x" | "y">,
  transformValue: BlueprintTransform = {},
): BlueprintPlacementPlan {
  const targetRecord = requireRecord(target, ["x", "y"], "Blueprint target");
  const targetX = safeCoordinate(targetRecord.x, "Blueprint target.x");
  const targetY = safeCoordinate(targetRecord.y, "Blueprint target.y");
  const blueprint = transformBlueprint(value, transformValue);
  if (blueprint.width > 0 || blueprint.height > 0) {
    checkedAdd(
      targetX,
      blueprint.width,
      "Blueprint placement right edge",
    );
    checkedAdd(
      targetY,
      blueprint.height,
      "Blueprint placement bottom edge",
    );
  }
  const placements: BlueprintPlacement[] = [];
  for (let index = 0; index < blueprint.entities.length; index += 1) {
    const entity = blueprint.entities[index]!;
    const x = checkedAdd(targetX, entity.x, `Placement ${index}.x`);
    const y = checkedAdd(targetY, entity.y, `Placement ${index}.y`);
    const routing = entity.manifoldRouting === null
      ? null
      : freezeRouting(
          entity.manifoldRouting.mode,
          entity.manifoldRouting.filter,
          entity.manifoldRouting.extractPort,
        );
    placements.push(
      OBJECT_FREEZE({
        ref: entity.ref,
        kind: entity.kind,
        x,
        y,
        direction: entity.direction,
        recipeId: entity.recipeId,
        manifoldRouting: routing,
        fluidId: entity.fluidId,
        fluidRecipeId: entity.fluidRecipeId,
        circuitDevice:
          entity.circuitDevice === null
            ? null
            : canonicalCircuitDeviceConfiguration(
                entity.circuitDevice,
                entity.kind,
                `Placement ${index}.circuitDevice`,
                false,
              ),
        circuitMachine:
          entity.circuitMachine === null
            ? null
            : canonicalCircuitMachineConfiguration(
                entity.circuitMachine,
                entity.kind,
                `Placement ${index}.circuitMachine`,
                false,
              ),
      }),
    );
  }
  const wires = blueprint.wires.map((wire) =>
    freezeBlueprintCircuitWire(
      wire.color,
      freezeBlueprintCircuitEndpoint(
        wire.endpointA.entityRef,
        wire.endpointA.connector,
      ),
      freezeBlueprintCircuitEndpoint(
        wire.endpointB.entityRef,
        wire.endpointB.connector,
      ),
    )
  );
  const railSegments = blueprint.rail.segments.map((segment, index) =>
    OBJECT_FREEZE({
      ref: segment.ref,
      x: checkedAdd(targetX, segment.x, `Rail placement ${index}.x`),
      y: checkedAdd(targetY, segment.y, `Rail placement ${index}.y`),
      kind: segment.kind,
      rotation: segment.rotation,
    })
  );
  const railStations = blueprint.rail.stations.map((station) =>
    OBJECT_FREEZE({
      ref: station.ref,
      segmentRef: station.segmentRef,
      capacity: station.capacity,
      storageBinding:
        station.storageBinding === null
          ? null
          : freezeRailStorageBinding(
              station.storageBinding.entityRef,
              station.storageBinding.mode,
              station.storageBinding.transferRate,
              freezeRailItemFilter(station.storageBinding.itemFilter),
            ),
    })
  );
  const railTrains = blueprint.rail.trains.map((train) =>
    OBJECT_FREEZE({
      ref: train.ref,
      segmentRef: train.segmentRef,
      cars: OBJECT_FREEZE(train.cars.map((car) =>
        car.kind === "locomotive"
          ? OBJECT_FREEZE({
              kind: "locomotive" as const,
              fuelCapacityMilli: car.fuelCapacityMilli,
            })
          : OBJECT_FREEZE({
              kind: "cargo-wagon" as const,
              capacity: car.capacity,
            })
      )),
      schedule: OBJECT_FREEZE(train.schedule.map((stop) =>
        OBJECT_FREEZE({
          stationRef: stop.stationRef,
          wait: freezeRailWait(stop.wait),
        })
      )),
    })
  );
  const rail = freezeRailIntent(
    railSegments,
    blueprint.rail.signals.map((signal) =>
      OBJECT_FREEZE({
        fromSegmentRef: signal.fromSegmentRef,
        toSegmentRef: signal.toSegmentRef,
        type: signal.type,
      })
    ),
    railStations,
    railTrains,
  );
  return OBJECT_FREEZE({
    width: blueprint.width,
    height: blueprint.height,
    placements: OBJECT_FREEZE(placements),
    wires: OBJECT_FREEZE(wires),
    rail,
  });
}
