/**
 * Pure, deterministic campaign progression for the Commission Uplink.
 *
 * This module deliberately has no dependency on the simulation, catalog, UI,
 * renderer, RNG, or wall clock. Public state, inventory, definitions, events,
 * authorizations, and provenance are canonical JSON-shaped frozen values.
 * Mutable typed arrays used by the prepared path are private and never exposed.
 */

import {
  RAIL_BUILD_COSTS,
  RAIL_BUILD_KINDS,
  type RailBuildKind,
} from "./railAuthoring";

// Public-object and storage intrinsics are captured before application code can
// replace them. This preserves canonical freezing, strict descriptor checks,
// serialization, and private numeric storage after module initialization.
const FREEZE_VALUE: typeof Object.freeze = Object.freeze;
const OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const OBJECT_GET_OWN_PROPERTY_SYMBOLS = Object.getOwnPropertySymbols;
const OBJECT_GET_OWN_PROPERTY_NAMES = Object.getOwnPropertyNames;
const OBJECT_GET_OWN_PROPERTY_DESCRIPTOR =
  Object.getOwnPropertyDescriptor;
const ARRAY_CONSTRUCTOR = Array;
const ARRAY_PROTOTYPE = Array.prototype;
const ARRAY_IS_ARRAY = Array.isArray;
const JSON_PARSE = JSON.parse;
const FLOAT64_ARRAY_CONSTRUCTOR = Float64Array;
const REFLECT_APPLY = Reflect.apply;
const OBJECT_IS = Object.is;
const NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger;
const NUMBER_MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const NUMBER_TO_STRING = Number.prototype.toString;
const STRING_CHAR_CODE_AT = String.prototype.charCodeAt;
const STRING_SLICE = String.prototype.slice;
const MATH_FLOOR = Math.floor;
const MATH_MIN = Math.min;
const MATH_MAX = Math.max;
const MATH_CEIL = Math.ceil;

export const PROGRESSION_FORMAT = "cinderline-progression" as const;
export const PROGRESSION_VERSION = 1 as const;
export const PROGRESSION_INVENTORY_FORMAT =
  "cinderline-progression-inventory" as const;
export const PROGRESSION_INVENTORY_VERSION = 1 as const;
export const CONSTRUCTION_PROVENANCE_FORMAT =
  "cinderline-construction-provenance" as const;
export const CONSTRUCTION_PROVENANCE_VERSION = 1 as const;
export const COMMISSION_DEFINITION_VERSION = 2 as const;
export const CAMPAIGN_INITIAL_ALLOY = 240;
export const MAX_COMMISSION_DEFINITIONS = 32;
/**
 * Mining placed infrastructure is fully reversible. This matches the
 * construction-item custody players expect from factory builders and makes it
 * impossible to strand a campaign by experimenting before its first reward.
 */
export const CONSTRUCTION_REFUND_PERCENT = 100;
// This literal is deliberately independent of `%TypedArray%.prototype.length`.
// Private inventory buffers must never become the receiver of a live
// post-import accessor.
const PROGRESSION_ITEM_COUNT = 11;

function copyArray<Value>(values: readonly Value[]): Value[] {
  const length = values.length;
  const output = new ARRAY_CONSTRUCTOR<Value>(length);
  for (let index = 0; index < length; index += 1) {
    output[index] = values[index]!;
  }
  return output;
}

function freezeArrayCopy<Value>(
  values: readonly Value[],
): readonly Value[] {
  return FREEZE_VALUE(copyArray(values));
}

function mapArray<Input, Output>(
  values: readonly Input[],
  project: (value: Input, index: number) => Output,
): Output[] {
  const length = values.length;
  const output = new ARRAY_CONSTRUCTOR<Output>(length);
  for (let index = 0; index < length; index += 1) {
    output[index] = project(values[index]!, index);
  }
  return output;
}

function appendValue<Value>(values: Value[], value: Value): void {
  values[values.length] = value;
}

function arrayContains<Value>(
  values: readonly Value[],
  target: Value,
): boolean {
  const length = values.length;
  for (let index = 0; index < length; index += 1) {
    if (values[index] === target) return true;
  }
  return false;
}

function joinStrings(
  values: readonly string[],
  separator: string,
): string {
  let output = "";
  const length = values.length;
  for (let index = 0; index < length; index += 1) {
    if (index > 0) output += separator;
    output += values[index]!;
  }
  return output;
}

export const PROGRESSION_ITEM_IDS = FREEZE_VALUE([
  "ironOre",
  "copperOre",
  "coal",
  "stone",
  "ironPlate",
  "copperPlate",
  "stoneBrick",
  "ironGear",
  "copperWire",
  "circuit",
  "automationCore",
] as const);

export type ProgressionItemId = (typeof PROGRESSION_ITEM_IDS)[number];

export const PROGRESSION_BUILD_KINDS = FREEZE_VALUE([
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
  "fluidSource",
  "fluidPump",
  "fluidPipe",
  "fluidTank",
  "fluidProcessor",
  "constantCombinator",
  "arithmeticCombinator",
  "deciderCombinator",
] as const);

export type ProgressionBuildKind =
  (typeof PROGRESSION_BUILD_KINDS)[number];

/**
 * Canonical construction catalog used by persisted progression before
 * advanced fluid/circuit construction became player-buildable. This exists
 * only to validate and reconcile that exact historical derived unlock list.
 */
const PRE_ADVANCED_BUILD_KINDS = FREEZE_VALUE([
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
] as const satisfies readonly ProgressionBuildKind[]);

export const PROGRESSION_RECIPE_IDS = FREEZE_VALUE([
  "smeltIron",
  "smeltCopper",
  "fireBrick",
  "ironGear",
  "copperWire",
  "circuit",
  "automationCore",
] as const);

export type ProgressionRecipeId =
  (typeof PROGRESSION_RECIPE_IDS)[number];

export const COMMISSION_IDS = FREEZE_VALUE([
  "bootstrap",
  "throughput",
  "control",
  "autonomy",
  "frontier-shipment",
] as const);

export type CommissionId = (typeof COMMISSION_IDS)[number];
export type ProgressionMode = "campaign" | "legacySandbox";

export const PROGRESSION_BUILD_COSTS: Readonly<
  Record<ProgressionBuildKind, number>
> = FREEZE_VALUE({
  belt: 2,
  extractor: 15,
  inserter: 8,
  smelter: 30,
  fabricator: 50,
  generator: 40,
  storage: 20,
  beacon: 75,
  manifold: 18,
  gridRelay: 12,
  fluidSource: 32,
  fluidPump: 14,
  fluidPipe: 3,
  fluidTank: 36,
  fluidProcessor: 64,
  constantCombinator: 10,
  arithmeticCombinator: 16,
  deciderCombinator: 18,
});

export interface CommissionRequirement {
  readonly item: ProgressionItemId;
  readonly amount: number;
}

export interface CommissionReward {
  readonly alloy: number;
  readonly buildKinds: readonly ProgressionBuildKind[];
  readonly recipeIds: readonly ProgressionRecipeId[];
}

export interface CommissionDefinition {
  readonly id: CommissionId;
  readonly title: string;
  readonly repeatable: boolean;
  readonly prerequisiteIds: readonly CommissionId[];
  /**
   * Capabilities granted when all prerequisites make this commission
   * available. Autonomy uses this to expose its required core recipe.
   */
  readonly availabilityRecipeIds: readonly ProgressionRecipeId[];
  readonly requirements: readonly CommissionRequirement[];
  readonly reward: CommissionReward;
}

function frozenRequirement(
  item: ProgressionItemId,
  amount: number,
): CommissionRequirement {
  return FREEZE_VALUE({ item, amount });
}

function frozenDefinition(
  definition: CommissionDefinition,
): CommissionDefinition {
  return FREEZE_VALUE({
    ...definition,
    prerequisiteIds: freezeArrayCopy(definition.prerequisiteIds),
    availabilityRecipeIds:
      freezeArrayCopy(definition.availabilityRecipeIds),
    requirements: FREEZE_VALUE(
      mapArray(definition.requirements, (requirement) =>
        frozenRequirement(requirement.item, requirement.amount)
      ),
    ),
    reward: FREEZE_VALUE({
      alloy: definition.reward.alloy,
      buildKinds: freezeArrayCopy(definition.reward.buildKinds),
      recipeIds: freezeArrayCopy(definition.reward.recipeIds),
    }),
  });
}

/**
 * Canonical definition order is also canonical completion-event order.
 */
export const COMMISSION_DEFINITIONS: readonly CommissionDefinition[] =
  FREEZE_VALUE([
    frozenDefinition({
      id: "bootstrap",
      title: "Bootstrap",
      repeatable: false,
      prerequisiteIds: [],
      availabilityRecipeIds: [],
      requirements: [
        frozenRequirement("ironPlate", 24),
        frozenRequirement("copperPlate", 12),
        frozenRequirement("stoneBrick", 12),
      ],
      reward: {
        alloy: 300,
        buildKinds: ["fabricator"],
        recipeIds: ["ironGear", "copperWire", "circuit"],
      },
    }),
    frozenDefinition({
      id: "throughput",
      title: "Throughput",
      repeatable: false,
      prerequisiteIds: ["bootstrap"],
      availabilityRecipeIds: [],
      requirements: [
        frozenRequirement("ironGear", 20),
        frozenRequirement("copperWire", 40),
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
    }),
    frozenDefinition({
      id: "control",
      title: "Control",
      repeatable: false,
      prerequisiteIds: ["bootstrap"],
      availabilityRecipeIds: [],
      requirements: [
        frozenRequirement("circuit", 12),
        frozenRequirement("stoneBrick", 24),
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
    }),
    frozenDefinition({
      id: "autonomy",
      title: "Autonomy",
      repeatable: false,
      prerequisiteIds: ["throughput", "control"],
      availabilityRecipeIds: ["automationCore"],
      requirements: [frozenRequirement("automationCore", 6)],
      reward: {
        alloy: 500,
        buildKinds: [],
        recipeIds: [],
      },
    }),
    frozenDefinition({
      id: "frontier-shipment",
      title: "Frontier shipment",
      repeatable: true,
      prerequisiteIds: ["autonomy"],
      availabilityRecipeIds: [],
      requirements: [
        frozenRequirement("automationCore", 4),
        frozenRequirement("stoneBrick", 20),
      ],
      reward: {
        alloy: 240,
        buildKinds: [],
        recipeIds: [],
      },
    }),
  ]);

export const COMMISSION_CATALOG = FREEZE_VALUE({
  version: COMMISSION_DEFINITION_VERSION,
  definitions: COMMISSION_DEFINITIONS,
});

if (COMMISSION_DEFINITIONS.length > MAX_COMMISSION_DEFINITIONS) {
  throw new RangeError(
    `Commission catalog exceeds ${MAX_COMMISSION_DEFINITIONS} definitions.`,
  );
}

const INITIAL_BUILD_KINDS = FREEZE_VALUE([
  "belt",
  "extractor",
  "inserter",
  "smelter",
  "generator",
  "storage",
  "gridRelay",
] as const satisfies readonly ProgressionBuildKind[]);

const INITIAL_RECIPE_IDS = FREEZE_VALUE([
  "smeltIron",
  "smeltCopper",
  "fireBrick",
] as const satisfies readonly ProgressionRecipeId[]);

const EMPTY_COMMISSION_IDS =
  FREEZE_VALUE([]) as readonly CommissionId[];
const EMPTY_BUILD_KINDS =
  FREEZE_VALUE([]) as readonly ProgressionBuildKind[];
const EMPTY_RECIPE_IDS =
  FREEZE_VALUE([]) as readonly ProgressionRecipeId[];
const EMPTY_MISSING_ITEMS =
  FREEZE_VALUE([]) as readonly MissingCommissionItem[];

export interface CommissionProgress {
  readonly id: CommissionId;
  readonly completionCount: number;
  readonly firstCompletedTick: number | null;
  readonly lastCompletedTick: number | null;
}

export interface ProgressionState {
  readonly format: typeof PROGRESSION_FORMAT;
  readonly version: typeof PROGRESSION_VERSION;
  readonly mode: ProgressionMode;
  readonly revision: number;
  readonly alloy: number;
  readonly lastCompletionTick: number | null;
  readonly selectedCommissionId: CommissionId | null;
  readonly unlockedBuildKinds: readonly ProgressionBuildKind[];
  readonly unlockedRecipeIds: readonly ProgressionRecipeId[];
  readonly commissions: readonly CommissionProgress[];
}

export interface ProgressionInventoryEntry {
  readonly item: ProgressionItemId;
  readonly count: number;
}

export interface ProgressionInventory {
  readonly format: typeof PROGRESSION_INVENTORY_FORMAT;
  readonly version: typeof PROGRESSION_INVENTORY_VERSION;
  readonly entries: readonly ProgressionInventoryEntry[];
}

export interface MissingCommissionItem {
  readonly item: ProgressionItemId;
  readonly required: number;
  readonly available: number;
}

export interface CommissionCompletedEvent {
  readonly type: "commissionCompleted";
  readonly eventOrder: number;
  readonly sequence: number;
  readonly commissionId: CommissionId;
  readonly completionCount: number;
  readonly tick: number;
  readonly consumed: readonly CommissionRequirement[];
  readonly alloyBefore: number;
  readonly alloyAwarded: number;
  readonly alloyAfter: number;
  readonly unlockedBuildKinds: readonly ProgressionBuildKind[];
  readonly unlockedRecipeIds: readonly ProgressionRecipeId[];
  readonly unlockedCommissionIds: readonly CommissionId[];
}

export type CommissionCompletionFailureReason =
  | "noSelection"
  | "insufficientItems"
  | "tickRegression"
  | "alloyOverflow"
  | "completionOverflow"
  | "revisionOverflow"
  | "sourceConsumed";

export interface CommissionCompletionFailure {
  readonly ok: false;
  readonly reason: CommissionCompletionFailureReason;
  readonly state: ProgressionState;
  readonly inventory: ProgressionInventory;
  readonly missingItems: readonly MissingCommissionItem[];
}

export interface CommissionCompletionSuccess {
  readonly ok: true;
  readonly state: ProgressionState;
  readonly inventory: ProgressionInventory;
  readonly event: CommissionCompletedEvent;
  readonly events: readonly [CommissionCompletedEvent];
}

export type CommissionCompletionResult =
  | CommissionCompletionFailure
  | CommissionCompletionSuccess;

export interface CommissionCompletionAuthorization {
  readonly commissionId: CommissionId;
  readonly stateRevision: number;
  readonly tick: number;
  readonly alloyAfter: number;
  readonly completionCountAfter: number;
}

export type CommissionCompletionPreflight =
  | CommissionCompletionFailure
  | {
    readonly ok: true;
    readonly authorization: CommissionCompletionAuthorization;
  };

export type CommissionSelectionFailureReason =
  | "legacySandbox"
  | "unavailable"
  | "revisionOverflow"
  | "sourceConsumed";

export type CommissionSelectionResult =
  | {
    readonly ok: false;
    readonly reason: CommissionSelectionFailureReason;
    readonly state: ProgressionState;
  }
  | {
    readonly ok: true;
    readonly changed: boolean;
    readonly state: ProgressionState;
  };

export interface ConstructionProvenance {
  readonly format: typeof CONSTRUCTION_PROVENANCE_FORMAT;
  readonly version: typeof CONSTRUCTION_PROVENANCE_VERSION;
  readonly source: "paid" | "granted";
  readonly buildKind: ProgressionBuildKind;
  readonly paidCost: number;
}

export type ConstructionRefundFailureReason =
  | "sourceConsumed"
  | "provenanceConsumed"
  | "revisionOverflow"
  | "alloyOverflow";

export type ConstructionRefundResult =
  | {
      readonly ok: false;
      readonly reason: ConstructionRefundFailureReason;
      readonly state: ProgressionState;
      readonly provenance: ConstructionProvenance;
    }
  | {
      readonly ok: true;
      readonly state: ProgressionState;
      readonly provenance: ConstructionProvenance;
      readonly refund: number;
    };

export type PlacementAuthorizationFailureReason =
  | "locked"
  | "insufficientAlloy"
  | "revisionOverflow"
  | "sourceConsumed";

export interface PlacementAuthorization {
  readonly buildKind: ProgressionBuildKind;
  readonly stateRevision: number;
  readonly cost: number;
  readonly alloyAfter: number;
}

export type PlacementPreflight =
  | {
    readonly ok: false;
    readonly reason: PlacementAuthorizationFailureReason;
    readonly state: ProgressionState;
    readonly buildKind: ProgressionBuildKind;
    readonly cost: number;
  }
  | {
    readonly ok: true;
    readonly authorization: PlacementAuthorization;
  };

export interface PlacementPurchaseSuccess {
  readonly ok: true;
  readonly state: ProgressionState;
  readonly buildKind: ProgressionBuildKind;
  readonly cost: number;
  readonly provenance: ConstructionProvenance;
}

export type PlacementPurchaseResult =
  | Exclude<PlacementPreflight, { readonly ok: true }>
  | PlacementPurchaseSuccess;

export type RailAlloyAuthorizationFailureReason =
  | "locked"
  | "insufficientAlloy"
  | "revisionOverflow"
  | "alloyOverflow"
  | "sourceConsumed";

export interface RailAlloyAuthorization {
  readonly direction: "purchase" | "refund";
  readonly buildKinds: readonly RailBuildKind[];
  readonly stateRevision: number;
  readonly amount: number;
  readonly alloyAfter: number;
  /**
   * Fully branded and canonicalized during preflight. Callers may stage all
   * post-success session values before mutating the simulation, but must still
   * call commitRailAlloy to consume the source authorization.
   */
  readonly stagedState: ProgressionState;
}

export type RailAlloyPreflight =
  | {
      readonly ok: false;
      readonly reason: RailAlloyAuthorizationFailureReason;
      readonly state: ProgressionState;
      readonly direction: "purchase" | "refund";
      readonly buildKinds: readonly RailBuildKind[];
      readonly amount: number;
    }
  | {
      readonly ok: true;
      readonly authorization: RailAlloyAuthorization;
    };

export interface RailAlloyCommit {
  readonly ok: true;
  readonly state: ProgressionState;
  readonly direction: "purchase" | "refund";
  readonly buildKinds: readonly RailBuildKind[];
  readonly amount: number;
}

export interface PreparedCommissionProbe {
  readonly commissionId: CommissionId;
  readonly stateRevision: number;
  readonly requirementCount: number;
}

export interface ProgressionBenchmarkOptions {
  readonly warmupSamples?: number;
  readonly samples?: number;
  /**
   * Report-only scale context. Entity count cannot affect this isolated,
   * Uplink-event-driven kernel because entities are never passed to it.
   */
  readonly nominalEntityCount?: number;
}

export interface ProgressionBenchmark {
  readonly commissionDefinitionCount: number;
  readonly maximumCommissionDefinitionCount: number;
  readonly nominalEntityCount: number;
  readonly requirementCount: number;
  readonly samples: number;
  readonly ready: boolean;
  readonly p50Ms: number;
  readonly p95Ms: number;
}

interface CompletionAuthorizationInternal {
  readonly state: ProgressionState;
  readonly inventory: ProgressionInventory;
  readonly result: CommissionCompletionSuccess;
}

interface PlacementAuthorizationInternal {
  readonly state: ProgressionState;
  readonly result: PlacementPurchaseSuccess;
}

interface RailAlloyAuthorizationInternal {
  readonly state: ProgressionState;
  readonly result: RailAlloyCommit;
}

interface PreparedProbeInternal {
  readonly state: ProgressionState;
  readonly requirementItemIndices: readonly number[];
  readonly requirementAmounts: readonly number[];
  readonly definition: CommissionDefinition;
}

const validProgressionStates = new WeakSet<object>();
const inventoryCounts = new WeakMap<ProgressionInventory, Float64Array>();
const validConstructionProvenance = new WeakSet<object>();
const consumedConstructionProvenance = new WeakSet<object>();
const completionAuthorizationInternals = new WeakMap<
  CommissionCompletionAuthorization,
  CompletionAuthorizationInternal
>();
const placementAuthorizationInternals = new WeakMap<
  PlacementAuthorization,
  PlacementAuthorizationInternal
>();
const railAlloyAuthorizationInternals = new WeakMap<
  RailAlloyAuthorization,
  RailAlloyAuthorizationInternal
>();
const preparedProbeInternals = new WeakMap<
  PreparedCommissionProbe,
  PreparedProbeInternal
>();
const activeMutationAuthorization = new WeakMap<
  ProgressionState,
  object
>();
const consumedMutationSources = new WeakSet<ProgressionState>();

// Capture brand/private-metadata intrinsics before application or test code can
// monkeypatch public prototypes. No operation below performs an instance
// `.get`, `.set`, `.has`, `.add`, or `.delete`, so post-import hooks cannot
// observe, replace, leak, or forge authorization internals.
const WEAK_MAP_GET = WeakMap.prototype.get;
const WEAK_MAP_SET = WeakMap.prototype.set;
const WEAK_MAP_DELETE = WeakMap.prototype.delete;
const WEAK_SET_ADD = WeakSet.prototype.add;
const WEAK_SET_HAS = WeakSet.prototype.has;

function privateMapGet<Key extends object, Value>(
  map: WeakMap<Key, Value>,
  key: Key,
): Value | undefined {
  return REFLECT_APPLY(WEAK_MAP_GET, map, [key]) as Value | undefined;
}

function privateMapSet<Key extends object, Value>(
  map: WeakMap<Key, Value>,
  key: Key,
  value: Value,
): void {
  REFLECT_APPLY(WEAK_MAP_SET, map, [key, value]);
}

function privateMapDelete<Key extends object, Value>(
  map: WeakMap<Key, Value>,
  key: Key,
): void {
  REFLECT_APPLY(WEAK_MAP_DELETE, map, [key]);
}

function privateSetAdd<Key extends object>(
  set: WeakSet<Key>,
  key: Key,
): void {
  REFLECT_APPLY(WEAK_SET_ADD, set, [key]);
}

function privateSetHas<Key extends object>(
  set: WeakSet<Key>,
  key: Key,
): boolean {
  return REFLECT_APPLY(WEAK_SET_HAS, set, [key]) as boolean;
}

function mutationSourceConsumed(state: ProgressionState): boolean {
  return privateSetHas(consumedMutationSources, state);
}

function retireActiveAuthorization(state: ProgressionState): void {
  const active = privateMapGet(activeMutationAuthorization, state);
  if (!active) return;
  privateMapDelete(
    completionAuthorizationInternals,
    active as CommissionCompletionAuthorization,
  );
  privateMapDelete(
    placementAuthorizationInternals,
    active as PlacementAuthorization,
  );
  privateMapDelete(
    railAlloyAuthorizationInternals,
    active as RailAlloyAuthorization,
  );
  privateMapDelete(activeMutationAuthorization, state);
}

function activateAuthorization(
  state: ProgressionState,
  authorization: object,
): void {
  const active = privateMapGet(activeMutationAuthorization, state);
  if (active === authorization) return;
  retireActiveAuthorization(state);
  privateMapSet(activeMutationAuthorization, state, authorization);
}

function consumeMutationSource(state: ProgressionState): void {
  retireActiveAuthorization(state);
  privateSetAdd(consumedMutationSources, state);
}

function commissionIndex(id: unknown): number {
  switch (id) {
    case "bootstrap":
      return 0;
    case "throughput":
      return 1;
    case "control":
      return 2;
    case "autonomy":
      return 3;
    case "frontier-shipment":
      return 4;
    default:
      return -1;
  }
}

function itemIndex(id: unknown): number {
  switch (id) {
    case "ironOre":
      return 0;
    case "copperOre":
      return 1;
    case "coal":
      return 2;
    case "stone":
      return 3;
    case "ironPlate":
      return 4;
    case "copperPlate":
      return 5;
    case "stoneBrick":
      return 6;
    case "ironGear":
      return 7;
    case "copperWire":
      return 8;
    case "circuit":
      return 9;
    case "automationCore":
      return 10;
    default:
      return -1;
  }
}

function buildKindIndex(id: unknown): number {
  switch (id) {
    case "belt":
      return 0;
    case "extractor":
      return 1;
    case "inserter":
      return 2;
    case "smelter":
      return 3;
    case "fabricator":
      return 4;
    case "generator":
      return 5;
    case "storage":
      return 6;
    case "beacon":
      return 7;
    case "manifold":
      return 8;
    case "gridRelay":
      return 9;
    case "fluidSource":
      return 10;
    case "fluidPump":
      return 11;
    case "fluidPipe":
      return 12;
    case "fluidTank":
      return 13;
    case "fluidProcessor":
      return 14;
    case "constantCombinator":
      return 15;
    case "arithmeticCombinator":
      return 16;
    case "deciderCombinator":
      return 17;
    default:
      return -1;
  }
}

function recipeIndex(id: unknown): number {
  switch (id) {
    case "smeltIron":
      return 0;
    case "smeltCopper":
      return 1;
    case "fireBrick":
      return 2;
    case "ironGear":
      return 3;
    case "copperWire":
      return 4;
    case "circuit":
      return 5;
    case "automationCore":
      return 6;
    default:
      return -1;
  }
}

function canonicalInteger(
  value: unknown,
  label: string,
  minimum = 0,
): number {
  if (
    typeof value !== "number"
    || !NUMBER_IS_SAFE_INTEGER(value)
    || OBJECT_IS(value, -0)
    || value < minimum
  ) {
    throw new RangeError(
      `${label} must be a canonical safe integer >= ${minimum}.`,
    );
  }
  return value;
}

function optionalTick(value: unknown, label: string): number | null {
  return value === null ? null : canonicalInteger(value, label);
}

function safeAdd(
  left: number,
  right: number,
  label: string,
): number {
  const result = left + right;
  if (!NUMBER_IS_SAFE_INTEGER(result) || result < 0) {
    throw new RangeError(`${label} exceeds the safe integer range.`);
  }
  return result === 0 ? 0 : result;
}

function incrementOrNull(value: number): number | null {
  return value === NUMBER_MAX_SAFE_INTEGER ? null : value + 1;
}

function numberToString(value: number): string {
  return REFLECT_APPLY(NUMBER_TO_STRING, value, []) as string;
}

function stringCharCodeAt(value: string, index: number): number {
  return REFLECT_APPLY(STRING_CHAR_CODE_AT, value, [index]) as number;
}

function stringSlice(
  value: string,
  start: number,
  end: number,
): string {
  return REFLECT_APPLY(STRING_SLICE, value, [start, end]) as string;
}

const HEX_DIGITS = "0123456789abcdef";

function unicodeEscape(code: number): string {
  return "\\u"
    + HEX_DIGITS[(code >>> 12) & 0xf]
    + HEX_DIGITS[(code >>> 8) & 0xf]
    + HEX_DIGITS[(code >>> 4) & 0xf]
    + HEX_DIGITS[code & 0xf];
}

/**
 * Schema strings are currently ASCII enums, but this encoder is deliberately
 * complete for JSON strings so future schema text cannot reintroduce a
 * `toJSON` or ambient `JSON.stringify` dependency.
 */
function encodeJsonString(value: string): string {
  let output = "\"";
  for (let index = 0; index < value.length; index += 1) {
    const code = stringCharCodeAt(value, index);
    switch (code) {
      case 0x08:
        output += "\\b";
        break;
      case 0x09:
        output += "\\t";
        break;
      case 0x0a:
        output += "\\n";
        break;
      case 0x0c:
        output += "\\f";
        break;
      case 0x0d:
        output += "\\r";
        break;
      case 0x22:
        output += "\\\"";
        break;
      case 0x5c:
        output += "\\\\";
        break;
      default:
        if (code < 0x20) {
          output += unicodeEscape(code);
        } else if (code >= 0xd800 && code <= 0xdbff) {
          const next = index + 1 < value.length
            ? stringCharCodeAt(value, index + 1)
            : -1;
          if (next >= 0xdc00 && next <= 0xdfff) {
            output += stringSlice(value, index, index + 2);
            index += 1;
          } else {
            output += unicodeEscape(code);
          }
        } else if (code >= 0xdc00 && code <= 0xdfff) {
          output += unicodeEscape(code);
        } else {
          output += stringSlice(value, index, index + 1);
        }
    }
  }
  return output + "\"";
}

function encodeInteger(value: number): string {
  // Branded state already contains canonical numbers. Keeping the assertion
  // here makes the encoder safe if its call graph is changed later.
  canonicalInteger(value, "Serialized progression integer");
  return numberToString(value);
}

function encodeNullableInteger(value: number | null): string {
  return value === null ? "null" : encodeInteger(value);
}

function encodeStringArray(values: readonly string[]): string {
  let output = "[";
  for (let index = 0; index < values.length; index += 1) {
    if (index !== 0) output += ",";
    output += encodeJsonString(values[index]!);
  }
  return output + "]";
}

function encodeProgressionState(state: ProgressionState): string {
  let commissions = "[";
  for (let index = 0; index < state.commissions.length; index += 1) {
    if (index !== 0) commissions += ",";
    const progress = state.commissions[index]!;
    commissions += "{\"id\":" + encodeJsonString(progress.id)
      + ",\"completionCount\":" + encodeInteger(progress.completionCount)
      + ",\"firstCompletedTick\":"
      + encodeNullableInteger(progress.firstCompletedTick)
      + ",\"lastCompletedTick\":"
      + encodeNullableInteger(progress.lastCompletedTick)
      + "}";
  }
  commissions += "]";
  return "{\"format\":" + encodeJsonString(state.format)
    + ",\"version\":" + encodeInteger(state.version)
    + ",\"mode\":" + encodeJsonString(state.mode)
    + ",\"revision\":" + encodeInteger(state.revision)
    + ",\"alloy\":" + encodeInteger(state.alloy)
    + ",\"lastCompletionTick\":"
    + encodeNullableInteger(state.lastCompletionTick)
    + ",\"selectedCommissionId\":"
    + (
      state.selectedCommissionId === null
        ? "null"
        : encodeJsonString(state.selectedCommissionId)
    )
    + ",\"unlockedBuildKinds\":"
    + encodeStringArray(state.unlockedBuildKinds)
    + ",\"unlockedRecipeIds\":"
    + encodeStringArray(state.unlockedRecipeIds)
    + ",\"commissions\":" + commissions
    + "}";
}

function encodeProgressionInventory(counts: Float64Array): string {
  let entries = "[";
  let first = true;
  for (let index = 0; index < PROGRESSION_ITEM_COUNT; index += 1) {
    const count = counts[index]!;
    if (count === 0) continue;
    if (!first) entries += ",";
    first = false;
    entries += "{\"item\":" + encodeJsonString(PROGRESSION_ITEM_IDS[index]!)
      + ",\"count\":" + encodeInteger(count)
      + "}";
  }
  entries += "]";
  return "{\"format\":" + encodeJsonString(PROGRESSION_INVENTORY_FORMAT)
    + ",\"version\":" + encodeInteger(PROGRESSION_INVENTORY_VERSION)
    + ",\"entries\":" + entries
    + "}";
}

function isJsonWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isJsonDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isJsonHexDigit(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39)
    || (code >= 0x41 && code <= 0x46)
    || (code >= 0x61 && code <= 0x66)
  );
}

/**
 * Native JSON parsing is intentionally retained for construction, but a
 * grammar pass first rejects duplicate members (including escape-equivalent
 * spellings), which native JSON.parse otherwise silently overwrites.
 */
function parseStrictJson(serialized: string): unknown {
  let cursor = 0;
  const length = serialized.length;

  const syntax = (message: string): never => {
    throw new SyntaxError(`Invalid progression JSON: ${message}.`);
  };
  const skipWhitespace = (): void => {
    while (
      cursor < length
      && isJsonWhitespace(stringCharCodeAt(serialized, cursor))
    ) {
      cursor += 1;
    }
  };
  const parseStringToken = (): string => {
    const start = cursor;
    if (stringCharCodeAt(serialized, cursor) !== 0x22) {
      return syntax("expected string");
    }
    cursor += 1;
    while (cursor < length) {
      const code = stringCharCodeAt(serialized, cursor);
      if (code === 0x22) {
        cursor += 1;
        const token = stringSlice(serialized, start, cursor);
        const decoded = REFLECT_APPLY(
          JSON_PARSE,
          undefined,
          [token],
        ) as unknown;
        if (typeof decoded !== "string") {
          return syntax("invalid string");
        }
        return decoded;
      }
      if (code < 0x20) return syntax("unescaped control character");
      if (code !== 0x5c) {
        cursor += 1;
        continue;
      }
      cursor += 1;
      if (cursor >= length) return syntax("unterminated escape");
      const escape = stringCharCodeAt(serialized, cursor);
      if (escape === 0x75) {
        for (let offset = 1; offset <= 4; offset += 1) {
          if (
            cursor + offset >= length
            || !isJsonHexDigit(
              stringCharCodeAt(serialized, cursor + offset),
            )
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
  const parseLiteral = (literal: string): void => {
    for (let index = 0; index < literal.length; index += 1) {
      if (
        cursor + index >= length
        || stringCharCodeAt(serialized, cursor + index)
          !== stringCharCodeAt(literal, index)
      ) {
        return syntax("invalid literal");
      }
    }
    cursor += literal.length;
  };
  const parseNumber = (): void => {
    if (stringCharCodeAt(serialized, cursor) === 0x2d) cursor += 1;
    if (cursor >= length) return syntax("incomplete number");
    const first = stringCharCodeAt(serialized, cursor);
    if (first === 0x30) {
      cursor += 1;
      if (
        cursor < length
        && isJsonDigit(stringCharCodeAt(serialized, cursor))
      ) {
        return syntax("leading zero");
      }
    } else if (first >= 0x31 && first <= 0x39) {
      cursor += 1;
      while (
        cursor < length
        && isJsonDigit(stringCharCodeAt(serialized, cursor))
      ) {
        cursor += 1;
      }
    } else {
      return syntax("invalid number");
    }
    if (
      cursor < length
      && stringCharCodeAt(serialized, cursor) === 0x2e
    ) {
      cursor += 1;
      if (
        cursor >= length
        || !isJsonDigit(stringCharCodeAt(serialized, cursor))
      ) {
        return syntax("invalid fraction");
      }
      while (
        cursor < length
        && isJsonDigit(stringCharCodeAt(serialized, cursor))
      ) {
        cursor += 1;
      }
    }
    if (cursor < length) {
      const exponent = stringCharCodeAt(serialized, cursor);
      if (exponent === 0x65 || exponent === 0x45) {
        cursor += 1;
        if (cursor < length) {
          const sign = stringCharCodeAt(serialized, cursor);
          if (sign === 0x2b || sign === 0x2d) cursor += 1;
        }
        if (
          cursor >= length
          || !isJsonDigit(stringCharCodeAt(serialized, cursor))
        ) {
          return syntax("invalid exponent");
        }
        while (
          cursor < length
          && isJsonDigit(stringCharCodeAt(serialized, cursor))
        ) {
          cursor += 1;
        }
      }
    }
  };

  let parseValue: () => void;
  const parseArray = (): void => {
    cursor += 1;
    skipWhitespace();
    if (
      cursor < length
      && stringCharCodeAt(serialized, cursor) === 0x5d
    ) {
      cursor += 1;
      return;
    }
    while (true) {
      parseValue();
      skipWhitespace();
      const separator = cursor < length
        ? stringCharCodeAt(serialized, cursor)
        : -1;
      if (separator === 0x5d) {
        cursor += 1;
        return;
      }
      if (separator !== 0x2c) return syntax("expected array separator");
      cursor += 1;
      skipWhitespace();
    }
  };
  const parseObject = (): void => {
    cursor += 1;
    skipWhitespace();
    if (
      cursor < length
      && stringCharCodeAt(serialized, cursor) === 0x7d
    ) {
      cursor += 1;
      return;
    }
    const keys: string[] = [];
    while (true) {
      const key = parseStringToken();
      for (let index = 0; index < keys.length; index += 1) {
        if (keys[index] === key) {
          return syntax(`duplicate member ${encodeJsonString(key)}`);
        }
      }
      keys[keys.length] = key;
      skipWhitespace();
      if (
        cursor >= length
        || stringCharCodeAt(serialized, cursor) !== 0x3a
      ) {
        return syntax("expected member colon");
      }
      cursor += 1;
      skipWhitespace();
      parseValue();
      skipWhitespace();
      const separator = cursor < length
        ? stringCharCodeAt(serialized, cursor)
        : -1;
      if (separator === 0x7d) {
        cursor += 1;
        return;
      }
      if (separator !== 0x2c) return syntax("expected object separator");
      cursor += 1;
      skipWhitespace();
    }
  };
  parseValue = (): void => {
    skipWhitespace();
    if (cursor >= length) return syntax("expected value");
    const code = stringCharCodeAt(serialized, cursor);
    if (code === 0x22) {
      parseStringToken();
    } else if (code === 0x7b) {
      parseObject();
    } else if (code === 0x5b) {
      parseArray();
    } else if (code === 0x74) {
      parseLiteral("true");
    } else if (code === 0x66) {
      parseLiteral("false");
    } else if (code === 0x6e) {
      parseLiteral("null");
    } else if (code === 0x2d || isJsonDigit(code)) {
      parseNumber();
    } else {
      return syntax("unexpected token");
    }
  };

  parseValue();
  skipWhitespace();
  if (cursor !== length) syntax("trailing content");
  return REFLECT_APPLY(JSON_PARSE, undefined, [serialized]) as unknown;
}

function requireRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== "object"
    || value === null
    || ARRAY_IS_ARRAY(value)
  ) {
    throw new TypeError(`${label} must be a plain record.`);
  }
  const prototype = OBJECT_GET_PROTOTYPE_OF(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must have a plain prototype.`);
  }
  if (OBJECT_GET_OWN_PROPERTY_SYMBOLS(value).length !== 0) {
    throw new TypeError(`${label} must not contain symbol fields.`);
  }
  const names = OBJECT_GET_OWN_PROPERTY_NAMES(value);
  let keysMatch = names.length === expectedKeys.length;
  for (
    let index = 0;
    keysMatch && index < expectedKeys.length;
    index += 1
  ) {
    keysMatch = arrayContains(names, expectedKeys[index]!);
  }
  if (!keysMatch) {
    throw new TypeError(
      `${label} must contain exactly: ${joinStrings(expectedKeys, ", ")}.`,
    );
  }
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys[index]!;
    const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
    if (
      !descriptor
      || !("value" in descriptor)
      || !descriptor.enumerable
    ) {
      throw new TypeError(`${label}.${key} must be an enumerable data field.`);
    }
  }
  return value as Record<string, unknown>;
}

function requireSubsetRecord(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== "object"
    || value === null
    || ARRAY_IS_ARRAY(value)
  ) {
    throw new TypeError(`${label} must be a plain record.`);
  }
  const prototype = OBJECT_GET_PROTOTYPE_OF(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must have a plain prototype.`);
  }
  if (OBJECT_GET_OWN_PROPERTY_SYMBOLS(value).length !== 0) {
    throw new TypeError(`${label} must not contain symbol fields.`);
  }
  const names = OBJECT_GET_OWN_PROPERTY_NAMES(value);
  for (let index = 0; index < names.length; index += 1) {
    const key = names[index]!;
    if (!arrayContains(allowedKeys, key)) {
      throw new TypeError(`${label} contains unknown field ${key}.`);
    }
    const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
    if (
      !descriptor
      || !("value" in descriptor)
      || !descriptor.enumerable
    ) {
      throw new TypeError(`${label}.${key} must be an enumerable data field.`);
    }
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): readonly unknown[] {
  if (
    !ARRAY_IS_ARRAY(value)
    || OBJECT_GET_PROTOTYPE_OF(value) !== ARRAY_PROTOTYPE
  ) {
    throw new TypeError(`${label} must be a plain array.`);
  }
  if (OBJECT_GET_OWN_PROPERTY_SYMBOLS(value).length !== 0) {
    throw new TypeError(`${label} must not contain symbol fields.`);
  }
  const names = OBJECT_GET_OWN_PROPERTY_NAMES(value);
  const length = value.length;
  if (
    names.length !== length + 1
    || !arrayContains(names, "length")
  ) {
    throw new TypeError(`${label} must be dense and contain no extra fields.`);
  }
  for (let index = 0; index < length; index += 1) {
    const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, `${index}`);
    if (
      !descriptor
      || !("value" in descriptor)
      || !descriptor.enumerable
    ) {
      throw new TypeError(`${label}[${index}] must be a data element.`);
    }
  }
  return value;
}

function freezeProgress(
  id: CommissionId,
  completionCount: number,
  firstCompletedTick: number | null,
  lastCompletedTick: number | null,
): CommissionProgress {
  return FREEZE_VALUE({
    id,
    completionCount,
    firstCompletedTick,
    lastCompletedTick,
  });
}

function emptyCommissionProgress(): readonly CommissionProgress[] {
  return FREEZE_VALUE(
    mapArray(COMMISSION_IDS, (id) =>
      freezeProgress(id, 0, null, null)
    ),
  );
}

function completed(
  records: readonly CommissionProgress[],
  id: CommissionId,
): boolean {
  return records[commissionIndex(id)]!.completionCount > 0;
}

function commissionAvailableFromRecords(
  mode: ProgressionMode,
  records: readonly CommissionProgress[],
  id: CommissionId,
): boolean {
  if (mode !== "campaign") return false;
  const index = commissionIndex(id);
  if (index < 0) return false;
  const definition = COMMISSION_DEFINITIONS[index]!;
  const record = records[index]!;
  if (!definition.repeatable && record.completionCount > 0) return false;
  for (
    let prerequisiteIndex = 0;
    prerequisiteIndex < definition.prerequisiteIds.length;
    prerequisiteIndex += 1
  ) {
    const prerequisiteId =
      definition.prerequisiteIds[prerequisiteIndex]!;
    if (!completed(records, prerequisiteId)) return false;
  }
  return true;
}

function availableFromRecords(
  mode: ProgressionMode,
  records: readonly CommissionProgress[],
): CommissionId[] {
  const available: CommissionId[] = [];
  for (let index = 0; index < COMMISSION_IDS.length; index += 1) {
    const id = COMMISSION_IDS[index]!;
    if (commissionAvailableFromRecords(mode, records, id)) {
      appendValue(available, id);
    }
  }
  return available;
}

function expectedBuildKinds(
  mode: ProgressionMode,
  records: readonly CommissionProgress[],
): readonly ProgressionBuildKind[] {
  if (mode === "legacySandbox") {
    return freezeArrayCopy(PROGRESSION_BUILD_KINDS);
  }
  const unlocked = copyArray<ProgressionBuildKind>(INITIAL_BUILD_KINDS);
  for (let index = 0; index < COMMISSION_DEFINITIONS.length; index += 1) {
    if (records[index]!.completionCount === 0) continue;
    const buildKinds = COMMISSION_DEFINITIONS[index]!.reward.buildKinds;
    for (
      let buildIndex = 0;
      buildIndex < buildKinds.length;
      buildIndex += 1
    ) {
      const kind = buildKinds[buildIndex]!;
      if (!arrayContains(unlocked, kind)) appendValue(unlocked, kind);
    }
  }
  const canonical: ProgressionBuildKind[] = [];
  for (let index = 0; index < PROGRESSION_BUILD_KINDS.length; index += 1) {
    const kind = PROGRESSION_BUILD_KINDS[index]!;
    if (arrayContains(unlocked, kind)) appendValue(canonical, kind);
  }
  return FREEZE_VALUE(canonical);
}

function expectedPreAdvancedBuildKinds(
  mode: ProgressionMode,
  records: readonly CommissionProgress[],
): readonly ProgressionBuildKind[] {
  const current = expectedBuildKinds(mode, records);
  const historical: ProgressionBuildKind[] = [];
  for (let index = 0; index < PRE_ADVANCED_BUILD_KINDS.length; index += 1) {
    const kind = PRE_ADVANCED_BUILD_KINDS[index]!;
    if (arrayContains(current, kind)) appendValue(historical, kind);
  }
  return FREEZE_VALUE(historical);
}

function expectedRecipeIds(
  mode: ProgressionMode,
  records: readonly CommissionProgress[],
): readonly ProgressionRecipeId[] {
  if (mode === "legacySandbox") {
    return freezeArrayCopy(PROGRESSION_RECIPE_IDS);
  }
  const unlocked = copyArray<ProgressionRecipeId>(INITIAL_RECIPE_IDS);
  for (let index = 0; index < COMMISSION_DEFINITIONS.length; index += 1) {
    const definition = COMMISSION_DEFINITIONS[index]!;
    if (records[index]!.completionCount > 0) {
      const rewardRecipeIds = definition.reward.recipeIds;
      for (
        let recipeIndex = 0;
        recipeIndex < rewardRecipeIds.length;
        recipeIndex += 1
      ) {
        const recipeId = rewardRecipeIds[recipeIndex]!;
        if (!arrayContains(unlocked, recipeId)) {
          appendValue(unlocked, recipeId);
        }
      }
    }
    let prerequisitesComplete = true;
    for (
      let prerequisiteIndex = 0;
      prerequisiteIndex < definition.prerequisiteIds.length;
      prerequisiteIndex += 1
    ) {
      const prerequisiteId =
        definition.prerequisiteIds[prerequisiteIndex]!;
      if (!completed(records, prerequisiteId)) {
        prerequisitesComplete = false;
        break;
      }
    }
    if (prerequisitesComplete) {
      for (
        let recipeIndex = 0;
        recipeIndex < definition.availabilityRecipeIds.length;
        recipeIndex += 1
      ) {
        const recipeId = definition.availabilityRecipeIds[recipeIndex]!;
        if (!arrayContains(unlocked, recipeId)) {
          appendValue(unlocked, recipeId);
        }
      }
    }
  }
  const canonical: ProgressionRecipeId[] = [];
  for (let index = 0; index < PROGRESSION_RECIPE_IDS.length; index += 1) {
    const recipeId = PROGRESSION_RECIPE_IDS[index]!;
    if (arrayContains(unlocked, recipeId)) {
      appendValue(canonical, recipeId);
    }
  }
  return FREEZE_VALUE(canonical);
}

function freezeState(fields: {
  readonly mode: ProgressionMode;
  readonly revision: number;
  readonly alloy: number;
  readonly lastCompletionTick: number | null;
  readonly selectedCommissionId: CommissionId | null;
  readonly unlockedBuildKinds: readonly ProgressionBuildKind[];
  readonly unlockedRecipeIds: readonly ProgressionRecipeId[];
  readonly commissions: readonly CommissionProgress[];
}): ProgressionState {
  const state: ProgressionState = FREEZE_VALUE({
    format: PROGRESSION_FORMAT,
    version: PROGRESSION_VERSION,
    mode: fields.mode,
    revision: fields.revision,
    alloy: fields.alloy,
    lastCompletionTick: fields.lastCompletionTick,
    selectedCommissionId: fields.selectedCommissionId,
    unlockedBuildKinds: fields.unlockedBuildKinds,
    unlockedRecipeIds: fields.unlockedRecipeIds,
    commissions: fields.commissions,
  });
  privateSetAdd(validProgressionStates, state);
  return state;
}

function assertProgressionState(state: ProgressionState): void {
  if (
    typeof state !== "object"
    || state === null
    || !privateSetHas(validProgressionStates, state)
  ) {
    throw new TypeError(
      "Progression state must be created or restored by this kernel.",
    );
  }
}

function assertInventory(inventory: ProgressionInventory): Float64Array {
  if (typeof inventory !== "object" || inventory === null) {
    throw new TypeError(
      "Progression inventory must be created or restored by this kernel.",
    );
  }
  const counts = privateMapGet(inventoryCounts, inventory);
  if (!counts) {
    throw new TypeError(
      "Progression inventory must be created or restored by this kernel.",
    );
  }
  return counts;
}

function arraysEqual(
  left: readonly unknown[],
  right: readonly unknown[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function createCampaignProgression(
  initialAlloy = CAMPAIGN_INITIAL_ALLOY,
): ProgressionState {
  const alloy = canonicalInteger(
    initialAlloy,
    "Campaign initial alloy",
  );
  const commissions = emptyCommissionProgress();
  return freezeState({
    mode: "campaign",
    revision: 0,
    alloy,
    lastCompletionTick: null,
    selectedCommissionId: "bootstrap",
    unlockedBuildKinds: freezeArrayCopy(INITIAL_BUILD_KINDS),
    unlockedRecipeIds: freezeArrayCopy(INITIAL_RECIPE_IDS),
    commissions,
  });
}

/**
 * Existing saves enter a non-campaign mode with all current capabilities and
 * no commission consumption. Their material reserve is preserved exactly.
 */
export function migrateLegacySandboxProgression(
  alloy: number,
): ProgressionState {
  const canonicalAlloy = canonicalInteger(
    alloy,
    "Legacy sandbox alloy",
  );
  return freezeState({
    mode: "legacySandbox",
    revision: 0,
    alloy: canonicalAlloy,
    lastCompletionTick: null,
    selectedCommissionId: null,
    unlockedBuildKinds: freezeArrayCopy(PROGRESSION_BUILD_KINDS),
    unlockedRecipeIds: freezeArrayCopy(PROGRESSION_RECIPE_IDS),
    commissions: emptyCommissionProgress(),
  });
}

function parseOrderedIds<Value extends string>(
  value: unknown,
  label: string,
  canonicalIds: readonly Value[],
  indexOf: (entry: unknown) => number,
): readonly Value[] {
  const input = requireArray(value, label);
  const output: Value[] = [];
  let previousIndex = -1;
  for (let index = 0; index < input.length; index += 1) {
    const entry = input[index];
    const canonicalIndex = indexOf(entry);
    if (
      typeof entry !== "string"
      || canonicalIndex < 0
      || canonicalIndex <= previousIndex
    ) {
      throw new TypeError(`${label} must be unique and canonically ordered.`);
    }
    appendValue(output, canonicalIds[canonicalIndex]!);
    previousIndex = canonicalIndex;
  }
  return FREEZE_VALUE(output);
}

function parseCommissionProgress(
  value: unknown,
): readonly CommissionProgress[] {
  const input = requireArray(value, "Progression commissions");
  if (input.length !== COMMISSION_DEFINITIONS.length) {
    throw new TypeError(
      "Progression commissions must contain every definition exactly once.",
    );
  }
  const records: CommissionProgress[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const record = requireRecord(
      input[index],
      [
        "id",
        "completionCount",
        "firstCompletedTick",
        "lastCompletedTick",
      ],
      `Progression commissions[${index}]`,
    );
    const expectedId = COMMISSION_IDS[index]!;
    if (record.id !== expectedId) {
      throw new TypeError(
        "Progression commissions must use canonical definition order.",
      );
    }
    const completionCount = canonicalInteger(
      record.completionCount,
      `${expectedId} completionCount`,
    );
    if (
      !COMMISSION_DEFINITIONS[index]!.repeatable
      && completionCount > 1
    ) {
      throw new RangeError(`${expectedId} cannot complete more than once.`);
    }
    const firstCompletedTick = optionalTick(
      record.firstCompletedTick,
      `${expectedId} firstCompletedTick`,
    );
    const lastCompletedTick = optionalTick(
      record.lastCompletedTick,
      `${expectedId} lastCompletedTick`,
    );
    if (
      (completionCount === 0
        && (firstCompletedTick !== null || lastCompletedTick !== null))
      || (completionCount > 0
        && (
          firstCompletedTick === null
          || lastCompletedTick === null
          || firstCompletedTick > lastCompletedTick
          || (
            !COMMISSION_DEFINITIONS[index]!.repeatable
            && firstCompletedTick !== lastCompletedTick
          )
        ))
    ) {
      throw new TypeError(
        `${expectedId} completion ticks do not match its count.`,
      );
    }
    appendValue(
      records,
      freezeProgress(
        expectedId,
        completionCount,
        firstCompletedTick,
        lastCompletedTick,
      ),
    );
  }
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (record.completionCount === 0) continue;
    const prerequisiteIds =
      COMMISSION_DEFINITIONS[index]!.prerequisiteIds;
    for (
      let prerequisiteIndex = 0;
      prerequisiteIndex < prerequisiteIds.length;
      prerequisiteIndex += 1
    ) {
      const prerequisiteId = prerequisiteIds[prerequisiteIndex]!;
      const prerequisite = records[commissionIndex(prerequisiteId)]!;
      if (
        prerequisite.completionCount === 0
        || prerequisite.lastCompletedTick === null
        || record.firstCompletedTick === null
        || record.firstCompletedTick < prerequisite.lastCompletedTick
      ) {
        throw new TypeError(
          `${record.id} completion violates prerequisite order.`,
        );
      }
    }
  }
  return FREEZE_VALUE(records);
}

function minimumReachableRevision(
  mode: ProgressionMode,
  records: readonly CommissionProgress[],
  selectedCommissionId: CommissionId | null,
): number {
  if (mode === "legacySandbox") return 0;
  let minimum = 0;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    minimum = safeAdd(
      minimum,
      record.completionCount,
      "Progression minimum reachable revision",
    );
  }
  // Bootstrap is selected by the campaign constructor. Every other completed
  // commission necessarily consumed one explicit selection mutation.
  for (let index = 1; index < records.length; index += 1) {
    if (records[index]!.completionCount > 0) {
      minimum = safeAdd(
        minimum,
        1,
        "Progression minimum reachable revision",
      );
    }
  }
  if (
    selectedCommissionId !== null
    && selectedCommissionId !== "bootstrap"
    && records[commissionIndex(selectedCommissionId)]!.completionCount === 0
  ) {
    minimum = safeAdd(
      minimum,
      1,
      "Progression minimum reachable revision",
    );
  }
  return minimum;
}

function restoreProgressionInternal(
  snapshot: unknown,
  reconcilePreAdvancedBuildCatalog: boolean,
): ProgressionState {
  const record = requireRecord(
    snapshot,
    [
      "format",
      "version",
      "mode",
      "revision",
      "alloy",
      "lastCompletionTick",
      "selectedCommissionId",
      "unlockedBuildKinds",
      "unlockedRecipeIds",
      "commissions",
    ],
    "Progression snapshot",
  );
  if (record.format !== PROGRESSION_FORMAT) {
    throw new TypeError("Unsupported progression format.");
  }
  if (record.version !== PROGRESSION_VERSION) {
    throw new RangeError("Unsupported progression version.");
  }
  if (record.mode !== "campaign" && record.mode !== "legacySandbox") {
    throw new TypeError("Unsupported progression mode.");
  }
  const mode = record.mode;
  const revision = canonicalInteger(record.revision, "Progression revision");
  const alloy = canonicalInteger(record.alloy, "Progression alloy");
  const lastCompletionTick = optionalTick(
    record.lastCompletionTick,
    "Progression lastCompletionTick",
  );
  const commissions = parseCommissionProgress(record.commissions);
  let actualLastCompletionTick: number | null = null;
  for (let index = 0; index < commissions.length; index += 1) {
    const commission = commissions[index]!;
    if (
      commission.lastCompletedTick !== null
      && (
        actualLastCompletionTick === null
        || commission.lastCompletedTick > actualLastCompletionTick
      )
    ) {
      actualLastCompletionTick = commission.lastCompletedTick;
    }
  }
  if (lastCompletionTick !== actualLastCompletionTick) {
    throw new TypeError(
      "Progression lastCompletionTick is not canonical.",
    );
  }

  const unlockedBuildKinds = parseOrderedIds(
    record.unlockedBuildKinds,
    "Progression unlockedBuildKinds",
    PROGRESSION_BUILD_KINDS,
    buildKindIndex,
  );
  const unlockedRecipeIds = parseOrderedIds(
    record.unlockedRecipeIds,
    "Progression unlockedRecipeIds",
    PROGRESSION_RECIPE_IDS,
    recipeIndex,
  );
  const expectedBuilds = expectedBuildKinds(mode, commissions);
  const expectedRecipes = expectedRecipeIds(mode, commissions);
  const reconcilesHistoricalBuilds =
    reconcilePreAdvancedBuildCatalog &&
    arraysEqual(
      unlockedBuildKinds,
      expectedPreAdvancedBuildKinds(mode, commissions),
    );
  if (
    !arraysEqual(unlockedBuildKinds, expectedBuilds) &&
    !reconcilesHistoricalBuilds
  ) {
    throw new TypeError(
      "Progression unlockedBuildKinds do not match completion state.",
    );
  }
  if (!arraysEqual(unlockedRecipeIds, expectedRecipes)) {
    throw new TypeError(
      "Progression unlockedRecipeIds do not match completion state.",
    );
  }

  const selectedValue = record.selectedCommissionId;
  let selectedCommissionId: CommissionId | null = null;
  if (selectedValue !== null) {
    const selectedIndex = commissionIndex(selectedValue);
    if (selectedIndex < 0) {
      throw new TypeError("Progression selected commission is unknown.");
    }
    selectedCommissionId = COMMISSION_IDS[selectedIndex]!;
  }
  if (
    selectedCommissionId !== null
    && !commissionAvailableFromRecords(
      mode,
      commissions,
      selectedCommissionId,
    )
  ) {
    throw new TypeError(
      "Progression selected commission is not currently available.",
    );
  }
  let hasCampaignCompletion = false;
  for (let index = 0; index < commissions.length; index += 1) {
    if (commissions[index]!.completionCount !== 0) {
      hasCampaignCompletion = true;
      break;
    }
  }
  if (
    mode === "legacySandbox"
    && (
      selectedCommissionId !== null
      || hasCampaignCompletion
      || lastCompletionTick !== null
    )
  ) {
    throw new TypeError(
      "Legacy sandbox progression cannot contain campaign progress.",
    );
  }
  const minimumRevision = minimumReachableRevision(
    mode,
    commissions,
    selectedCommissionId,
  );
  if (revision < minimumRevision) {
    throw new TypeError(
      "Progression revision is below its minimum reachable mutation count.",
    );
  }

  return freezeState({
    mode,
    revision,
    alloy,
    lastCompletionTick,
    selectedCommissionId,
    unlockedBuildKinds: reconcilesHistoricalBuilds
      ? expectedBuilds
      : unlockedBuildKinds,
    unlockedRecipeIds,
    commissions,
  });
}

export function restoreProgression(snapshot: unknown): ProgressionState {
  return restoreProgressionInternal(snapshot, false);
}

/**
 * Restores current progression or an exact pre-advanced-catalog unlock list.
 * Every non-derived field receives the same strict validation as a current
 * snapshot; accepted historical lists are deterministically rebuilt from
 * commission completion records and immediately serialize canonically.
 */
export function restoreProgressionWithBuildCatalogReconciliation(
  snapshot: unknown,
): ProgressionState {
  return restoreProgressionInternal(snapshot, true);
}

export function parseProgression(serialized: string): ProgressionState {
  if (typeof serialized !== "string") {
    throw new TypeError("Serialized progression must be a string.");
  }
  return restoreProgression(parseStrictJson(serialized));
}

export function snapshotProgression(
  state: ProgressionState,
): ProgressionState {
  assertProgressionState(state);
  return state;
}

export function serializeProgression(state: ProgressionState): string {
  assertProgressionState(state);
  return encodeProgressionState(state);
}

function freezeInventory(counts: Float64Array): ProgressionInventory {
  const entries: ProgressionInventoryEntry[] = [];
  for (let index = 0; index < PROGRESSION_ITEM_COUNT; index += 1) {
    const count = counts[index]!;
    canonicalInteger(
      count,
      `Progression private inventory ${PROGRESSION_ITEM_IDS[index]}`,
    );
    if (count === 0) continue;
    appendValue(
      entries,
      FREEZE_VALUE({
        item: PROGRESSION_ITEM_IDS[index]!,
        count,
      }),
    );
  }
  const inventory: ProgressionInventory = FREEZE_VALUE({
    format: PROGRESSION_INVENTORY_FORMAT,
    version: PROGRESSION_INVENTORY_VERSION,
    entries: FREEZE_VALUE(entries),
  });
  privateMapSet(inventoryCounts, inventory, counts);
  return inventory;
}

export function createProgressionInventory(
  input: Readonly<Partial<Record<ProgressionItemId, number>>> = {},
): ProgressionInventory {
  const record = requireSubsetRecord(
    input,
    PROGRESSION_ITEM_IDS,
    "Progression inventory input",
  );
  const counts = new FLOAT64_ARRAY_CONSTRUCTOR(PROGRESSION_ITEM_COUNT);
  const names = OBJECT_GET_OWN_PROPERTY_NAMES(record);
  for (let nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
    const key = names[nameIndex]!;
    const index = itemIndex(key);
    const count = canonicalInteger(
      record[key],
      `Progression inventory ${key}`,
    );
    counts[index] = count;
  }
  return freezeInventory(counts);
}

export function restoreProgressionInventory(
  snapshot: unknown,
): ProgressionInventory {
  const record = requireRecord(
    snapshot,
    ["format", "version", "entries"],
    "Progression inventory snapshot",
  );
  if (record.format !== PROGRESSION_INVENTORY_FORMAT) {
    throw new TypeError("Unsupported progression inventory format.");
  }
  if (record.version !== PROGRESSION_INVENTORY_VERSION) {
    throw new RangeError("Unsupported progression inventory version.");
  }
  const entries = requireArray(
    record.entries,
    "Progression inventory entries",
  );
  const counts = new FLOAT64_ARRAY_CONSTRUCTOR(PROGRESSION_ITEM_COUNT);
  let previousIndex = -1;
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = requireRecord(
      entries[entryIndex],
      ["item", "count"],
      `Progression inventory entries[${entryIndex}]`,
    );
    const index = itemIndex(entry.item);
    if (index < 0 || index <= previousIndex) {
      throw new TypeError(
        "Progression inventory entries must be unique and canonically ordered.",
      );
    }
    counts[index] = canonicalInteger(
      entry.count,
      `Progression inventory ${String(entry.item)}`,
      1,
    );
    previousIndex = index;
  }
  return freezeInventory(counts);
}

export function parseProgressionInventory(
  serialized: string,
): ProgressionInventory {
  if (typeof serialized !== "string") {
    throw new TypeError("Serialized progression inventory must be a string.");
  }
  return restoreProgressionInventory(parseStrictJson(serialized));
}

export function serializeProgressionInventory(
  inventory: ProgressionInventory,
): string {
  return encodeProgressionInventory(assertInventory(inventory));
}

export function progressionInventoryCount(
  inventory: ProgressionInventory,
  item: ProgressionItemId,
): number {
  const counts = assertInventory(inventory);
  const index = itemIndex(item);
  if (index < 0) throw new TypeError("Unknown progression item.");
  return counts[index]!;
}

export function addProgressionInventory(
  inventory: ProgressionInventory,
  item: ProgressionItemId,
  amount: number,
): ProgressionInventory {
  const currentCounts = assertInventory(inventory);
  const index = itemIndex(item);
  if (index < 0) throw new TypeError("Unknown progression item.");
  const canonicalAmount = canonicalInteger(
    amount,
    "Progression inventory delivery amount",
  );
  if (canonicalAmount === 0) return inventory;
  const updated = safeAdd(
    currentCounts[index]!,
    canonicalAmount,
    "Progression inventory count",
  );
  const nextCounts = new FLOAT64_ARRAY_CONSTRUCTOR(PROGRESSION_ITEM_COUNT);
  for (let cursor = 0; cursor < PROGRESSION_ITEM_COUNT; cursor += 1) {
    nextCounts[cursor] = currentCounts[cursor]!;
  }
  nextCounts[index] = updated;
  return freezeInventory(nextCounts);
}

export function availableCommissionIds(
  state: ProgressionState,
): readonly CommissionId[] {
  assertProgressionState(state);
  const available = availableFromRecords(state.mode, state.commissions);
  return available.length === 0
    ? EMPTY_COMMISSION_IDS
    : FREEZE_VALUE(available);
}

export function selectCommission(
  state: ProgressionState,
  commissionId: CommissionId,
): CommissionSelectionResult {
  assertProgressionState(state);
  const index = commissionIndex(commissionId);
  if (index < 0) throw new TypeError("Unknown commission.");
  if (mutationSourceConsumed(state)) {
    return FREEZE_VALUE({
      ok: false,
      reason: "sourceConsumed",
      state,
    });
  }
  if (state.mode === "legacySandbox") {
    return FREEZE_VALUE({
      ok: false,
      reason: "legacySandbox",
      state,
    });
  }
  if (
    !commissionAvailableFromRecords(
      state.mode,
      state.commissions,
      commissionId,
    )
  ) {
    return FREEZE_VALUE({ ok: false, reason: "unavailable", state });
  }
  if (state.selectedCommissionId === commissionId) {
    return FREEZE_VALUE({ ok: true, changed: false, state });
  }
  const revision = incrementOrNull(state.revision);
  if (revision === null) {
    return FREEZE_VALUE({
      ok: false,
      reason: "revisionOverflow",
      state,
    });
  }
  const next = freezeState({
    mode: state.mode,
    revision,
    alloy: state.alloy,
    lastCompletionTick: state.lastCompletionTick,
    selectedCommissionId: COMMISSION_IDS[index]!,
    unlockedBuildKinds: state.unlockedBuildKinds,
    unlockedRecipeIds: state.unlockedRecipeIds,
    commissions: state.commissions,
  });
  consumeMutationSource(state);
  return FREEZE_VALUE({ ok: true, changed: true, state: next });
}

function completionFailure(
  reason: CommissionCompletionFailureReason,
  state: ProgressionState,
  inventory: ProgressionInventory,
  missingItems: readonly MissingCommissionItem[] = EMPTY_MISSING_ITEMS,
): CommissionCompletionFailure {
  return FREEZE_VALUE({
    ok: false,
    reason,
    state,
    inventory,
    missingItems,
  });
}

function frozenDifference<Value extends string>(
  next: readonly Value[],
  previous: readonly Value[],
): readonly Value[] {
  const difference: Value[] = [];
  for (let index = 0; index < next.length; index += 1) {
    const entry = next[index]!;
    if (!arrayContains(previous, entry)) {
      appendValue(difference, entry);
    }
  }
  return difference.length === 0
    ? FREEZE_VALUE([]) as readonly Value[]
    : FREEZE_VALUE(difference);
}

export function preflightSelectedCommissionCompletion(
  state: ProgressionState,
  inventory: ProgressionInventory,
  tick: number,
): CommissionCompletionPreflight {
  assertProgressionState(state);
  const currentCounts = assertInventory(inventory);
  const canonicalTick = canonicalInteger(tick, "Commission completion tick");
  if (mutationSourceConsumed(state)) {
    return completionFailure("sourceConsumed", state, inventory);
  }
  const active = privateMapGet(activeMutationAuthorization, state);
  if (active) {
    const existing = privateMapGet(
      completionAuthorizationInternals,
      active as CommissionCompletionAuthorization,
    );
    if (
      existing
      && existing.state === state
      && existing.inventory === inventory
      && existing.result.event.tick === canonicalTick
    ) {
      return FREEZE_VALUE({
        ok: true,
        authorization: active as CommissionCompletionAuthorization,
      });
    }
  }
  const selectedId = state.selectedCommissionId;
  if (selectedId === null) {
    return completionFailure("noSelection", state, inventory);
  }
  const definitionIndex = commissionIndex(selectedId);
  const definition = COMMISSION_DEFINITIONS[definitionIndex]!;
  const missing: MissingCommissionItem[] = [];
  for (
    let requirementIndex = 0;
    requirementIndex < definition.requirements.length;
    requirementIndex += 1
  ) {
    const requirement = definition.requirements[requirementIndex]!;
    const available = currentCounts[itemIndex(requirement.item)]!;
    if (available < requirement.amount) {
      appendValue(
        missing,
        FREEZE_VALUE({
          item: requirement.item,
          required: requirement.amount,
          available,
        }),
      );
    }
  }
  if (missing.length > 0) {
    return completionFailure(
      "insufficientItems",
      state,
      inventory,
      FREEZE_VALUE(missing),
    );
  }
  if (
    state.lastCompletionTick !== null
    && canonicalTick < state.lastCompletionTick
  ) {
    return completionFailure("tickRegression", state, inventory);
  }
  const currentProgress = state.commissions[definitionIndex]!;
  const completionCountAfter = incrementOrNull(
    currentProgress.completionCount,
  );
  if (completionCountAfter === null) {
    return completionFailure("completionOverflow", state, inventory);
  }
  const alloyAfter = state.alloy + definition.reward.alloy;
  if (!NUMBER_IS_SAFE_INTEGER(alloyAfter)) {
    return completionFailure("alloyOverflow", state, inventory);
  }
  const revisionAfter = incrementOrNull(state.revision);
  if (revisionAfter === null) {
    return completionFailure("revisionOverflow", state, inventory);
  }

  const nextCounts = new FLOAT64_ARRAY_CONSTRUCTOR(PROGRESSION_ITEM_COUNT);
  for (let index = 0; index < PROGRESSION_ITEM_COUNT; index += 1) {
    nextCounts[index] = currentCounts[index]!;
  }
  for (
    let requirementIndex = 0;
    requirementIndex < definition.requirements.length;
    requirementIndex += 1
  ) {
    const requirement = definition.requirements[requirementIndex]!;
    const index = itemIndex(requirement.item);
    nextCounts[index] = nextCounts[index]! - requirement.amount;
  }
  const nextInventory = freezeInventory(nextCounts);

  const nextCommissionRecords = copyArray(state.commissions);
  nextCommissionRecords[definitionIndex] = freezeProgress(
    selectedId,
    completionCountAfter,
    currentProgress.firstCompletedTick ?? canonicalTick,
    canonicalTick,
  );
  const frozenCommissionRecords = FREEZE_VALUE(nextCommissionRecords);
  const nextBuildKinds = expectedBuildKinds(
    state.mode,
    frozenCommissionRecords,
  );
  const nextRecipeIds = expectedRecipeIds(
    state.mode,
    frozenCommissionRecords,
  );
  const nextSelectedId = definition.repeatable ? selectedId : null;
  const nextState = freezeState({
    mode: state.mode,
    revision: revisionAfter,
    alloy: alloyAfter,
    lastCompletionTick: canonicalTick,
    selectedCommissionId: nextSelectedId,
    unlockedBuildKinds: nextBuildKinds,
    unlockedRecipeIds: nextRecipeIds,
    commissions: frozenCommissionRecords,
  });

  const availableBefore = availableFromRecords(
    state.mode,
    state.commissions,
  );
  const availableAfter = availableFromRecords(
    nextState.mode,
    nextState.commissions,
  );
  const event: CommissionCompletedEvent = FREEZE_VALUE({
    type: "commissionCompleted",
    eventOrder: definitionIndex,
    sequence: revisionAfter,
    commissionId: selectedId,
    completionCount: completionCountAfter,
    tick: canonicalTick,
    consumed: FREEZE_VALUE(
      mapArray(definition.requirements, (requirement) =>
        frozenRequirement(requirement.item, requirement.amount)
      ),
    ),
    alloyBefore: state.alloy,
    alloyAwarded: definition.reward.alloy,
    alloyAfter,
    unlockedBuildKinds: frozenDifference(
      nextBuildKinds,
      state.unlockedBuildKinds,
    ),
    unlockedRecipeIds: frozenDifference(
      nextRecipeIds,
      state.unlockedRecipeIds,
    ),
    unlockedCommissionIds: frozenDifference(
      availableAfter,
      availableBefore,
    ),
  });
  const events = FREEZE_VALUE([event]) as readonly [
    CommissionCompletedEvent,
  ];
  const result: CommissionCompletionSuccess = FREEZE_VALUE({
    ok: true,
    state: nextState,
    inventory: nextInventory,
    event,
    events,
  });
  const authorization: CommissionCompletionAuthorization = FREEZE_VALUE({
    commissionId: selectedId,
    stateRevision: state.revision,
    tick: canonicalTick,
    alloyAfter,
    completionCountAfter,
  });
  privateMapSet(
    completionAuthorizationInternals,
    authorization,
    FREEZE_VALUE({ state, inventory, result }),
  );
  activateAuthorization(state, authorization);
  return FREEZE_VALUE({ ok: true, authorization });
}

export function commitSelectedCommissionCompletion(
  state: ProgressionState,
  inventory: ProgressionInventory,
  authorization: CommissionCompletionAuthorization,
): CommissionCompletionSuccess {
  assertProgressionState(state);
  assertInventory(inventory);
  if (typeof authorization !== "object" || authorization === null) {
    throw new TypeError("Commission authorization is invalid.");
  }
  const internal = privateMapGet(
    completionAuthorizationInternals,
    authorization,
  );
  if (!internal) {
    throw new TypeError("Commission authorization was not issued here.");
  }
  if (internal.state !== state || internal.inventory !== inventory) {
    throw new TypeError(
      "Commission authorization does not match state and inventory.",
    );
  }
  if (
    privateMapGet(activeMutationAuthorization, state) !== authorization
  ) {
    throw new TypeError("Commission authorization was superseded.");
  }
  // Consume only after every fallible validation. Returning the already-staged
  // immutable result cannot fail, and failed forged/cross-state attempts do
  // not invalidate the legitimate caller's authorization.
  consumeMutationSource(state);
  return internal.result;
}

export function completeSelectedCommission(
  state: ProgressionState,
  inventory: ProgressionInventory,
  tick: number,
): CommissionCompletionResult {
  const preflight = preflightSelectedCommissionCompletion(
    state,
    inventory,
    tick,
  );
  if (!preflight.ok) return preflight;
  return commitSelectedCommissionCompletion(
    state,
    inventory,
    preflight.authorization,
  );
}

export function compareProgressionEvents(
  left: CommissionCompletedEvent,
  right: CommissionCompletedEvent,
): number {
  return (
    left.tick - right.tick
    || left.eventOrder - right.eventOrder
    || left.completionCount - right.completionCount
    || left.sequence - right.sequence
  );
}

export function prepareSelectedCommissionProbe(
  state: ProgressionState,
): PreparedCommissionProbe {
  assertProgressionState(state);
  const selectedId = state.selectedCommissionId;
  if (selectedId === null) {
    throw new TypeError("Cannot prepare a probe without a selected commission.");
  }
  const definition = COMMISSION_DEFINITIONS[commissionIndex(selectedId)]!;
  const requirementItemIndices: number[] = [];
  const requirementAmounts: number[] = [];
  for (
    let requirementIndex = 0;
    requirementIndex < definition.requirements.length;
    requirementIndex += 1
  ) {
    const requirement = definition.requirements[requirementIndex]!;
    appendValue(requirementItemIndices, itemIndex(requirement.item));
    appendValue(requirementAmounts, requirement.amount);
  }
  const probe: PreparedCommissionProbe = FREEZE_VALUE({
    commissionId: selectedId,
    stateRevision: state.revision,
    requirementCount: definition.requirements.length,
  });
  privateMapSet(
    preparedProbeInternals,
    probe,
    FREEZE_VALUE({
      state,
      requirementItemIndices: FREEZE_VALUE(requirementItemIndices),
      requirementAmounts: FREEZE_VALUE(requirementAmounts),
      definition,
    }),
  );
  return probe;
}

/**
 * Allocation-free readiness check for an already-selected commission. It is
 * intended to run only after the Uplink inventory changes, not every entity
 * tick. A state transition invalidates the probe and requires a new one.
 */
export function isPreparedCommissionReady(
  probe: PreparedCommissionProbe,
  state: ProgressionState,
  inventory: ProgressionInventory,
  tick: number,
): boolean {
  assertProgressionState(state);
  const counts = assertInventory(inventory);
  const canonicalTick = canonicalInteger(
    tick,
    "Prepared commission completion tick",
  );
  if (typeof probe !== "object" || probe === null) {
    throw new TypeError("Prepared commission probe is invalid.");
  }
  const internal = privateMapGet(preparedProbeInternals, probe);
  if (!internal) {
    throw new TypeError("Prepared commission probe was not issued here.");
  }
  if (internal.state !== state) {
    throw new TypeError("Prepared commission probe is stale.");
  }
  if (
    state.lastCompletionTick !== null
    && canonicalTick < state.lastCompletionTick
  ) {
    return false;
  }
  if (mutationSourceConsumed(state)) return false;
  if (
    state.revision === NUMBER_MAX_SAFE_INTEGER
    || state.alloy
      > NUMBER_MAX_SAFE_INTEGER - internal.definition.reward.alloy
  ) {
    return false;
  }
  const progress =
    state.commissions[commissionIndex(internal.definition.id)]!;
  if (progress.completionCount === NUMBER_MAX_SAFE_INTEGER) {
    return false;
  }
  for (
    let index = 0;
    index < internal.requirementItemIndices.length;
    index += 1
  ) {
    if (
      counts[internal.requirementItemIndices[index]!]!
      < internal.requirementAmounts[index]!
    ) {
      return false;
    }
  }
  return true;
}

function isBuildUnlocked(
  state: ProgressionState,
  buildKind: ProgressionBuildKind,
): boolean {
  for (
    let index = 0;
    index < state.unlockedBuildKinds.length;
    index += 1
  ) {
    if (state.unlockedBuildKinds[index] === buildKind) return true;
  }
  return false;
}

function freezeProvenance(
  source: "paid" | "granted",
  buildKind: ProgressionBuildKind,
  paidCost: number,
): ConstructionProvenance {
  const provenance: ConstructionProvenance = FREEZE_VALUE({
    format: CONSTRUCTION_PROVENANCE_FORMAT,
    version: CONSTRUCTION_PROVENANCE_VERSION,
    source,
    buildKind,
    paidCost,
  });
  privateSetAdd(validConstructionProvenance, provenance);
  return provenance;
}

export function grantedConstructionProvenance(
  buildKind: ProgressionBuildKind,
): ConstructionProvenance {
  const index = buildKindIndex(buildKind);
  if (index < 0) throw new TypeError("Unknown progression build kind.");
  return freezeProvenance(
    "granted",
    PROGRESSION_BUILD_KINDS[index]!,
    0,
  );
}

export function restoreConstructionProvenance(
  snapshot: unknown,
): ConstructionProvenance {
  const record = requireRecord(
    snapshot,
    ["format", "version", "source", "buildKind", "paidCost"],
    "Construction provenance",
  );
  if (record.format !== CONSTRUCTION_PROVENANCE_FORMAT) {
    throw new TypeError("Unsupported construction provenance format.");
  }
  if (record.version !== CONSTRUCTION_PROVENANCE_VERSION) {
    throw new RangeError("Unsupported construction provenance version.");
  }
  if (record.source !== "paid" && record.source !== "granted") {
    throw new TypeError("Unsupported construction provenance source.");
  }
  const index = buildKindIndex(record.buildKind);
  if (index < 0) throw new TypeError("Unknown construction build kind.");
  const buildKind = PROGRESSION_BUILD_KINDS[index]!;
  const paidCost = canonicalInteger(
    record.paidCost,
    "Construction paidCost",
  );
  const expectedCost =
    record.source === "paid" ? PROGRESSION_BUILD_COSTS[buildKind] : 0;
  if (paidCost !== expectedCost) {
    throw new TypeError(
      "Construction paidCost does not match its source and build kind.",
    );
  }
  return freezeProvenance(record.source, buildKind, paidCost);
}

export function constructionRefundAmount(
  provenance: ConstructionProvenance,
): number {
  if (
    typeof provenance !== "object"
    || provenance === null
    || !privateSetHas(validConstructionProvenance, provenance)
  ) {
    throw new TypeError(
      "Construction provenance must be created or restored by this kernel.",
    );
  }
  if (provenance.source === "granted") return 0;
  const quotient = MATH_FLOOR(provenance.paidCost / 100);
  const remainder = provenance.paidCost % 100;
  const refund = quotient * CONSTRUCTION_REFUND_PERCENT
    + MATH_FLOOR(remainder * CONSTRUCTION_REFUND_PERCENT / 100);
  return MATH_MIN(provenance.paidCost, refund);
}

/**
 * Consumes one extant entity's provenance and credits its bounded refund.
 * Both the source state and provenance are single-use, matching placement and
 * commission transactions across undo/save boundaries.
 */
export function refundConstruction(
  state: ProgressionState,
  provenance: ConstructionProvenance,
): ConstructionRefundResult {
  assertProgressionState(state);
  if (
    typeof provenance !== "object"
    || provenance === null
    || !privateSetHas(validConstructionProvenance, provenance)
  ) {
    throw new TypeError(
      "Construction provenance must be created or restored by this kernel.",
    );
  }
  if (mutationSourceConsumed(state)) {
    return FREEZE_VALUE({
      ok: false,
      reason: "sourceConsumed",
      state,
      provenance,
    });
  }
  if (privateSetHas(consumedConstructionProvenance, provenance)) {
    return FREEZE_VALUE({
      ok: false,
      reason: "provenanceConsumed",
      state,
      provenance,
    });
  }
  const revision = incrementOrNull(state.revision);
  if (revision === null) {
    return FREEZE_VALUE({
      ok: false,
      reason: "revisionOverflow",
      state,
      provenance,
    });
  }
  const refund = constructionRefundAmount(provenance);
  const alloy = state.alloy + refund;
  if (!NUMBER_IS_SAFE_INTEGER(alloy)) {
    return FREEZE_VALUE({
      ok: false,
      reason: "alloyOverflow",
      state,
      provenance,
    });
  }
  const nextState = freezeState({
    mode: state.mode,
    revision,
    alloy,
    lastCompletionTick: state.lastCompletionTick,
    selectedCommissionId: state.selectedCommissionId,
    unlockedBuildKinds: state.unlockedBuildKinds,
    unlockedRecipeIds: state.unlockedRecipeIds,
    commissions: state.commissions,
  });
  consumeMutationSource(state);
  privateSetAdd(consumedConstructionProvenance, provenance);
  return FREEZE_VALUE({
    ok: true,
    state: nextState,
    provenance,
    refund,
  });
}

export function preflightPlacement(
  state: ProgressionState,
  buildKind: ProgressionBuildKind,
): PlacementPreflight {
  assertProgressionState(state);
  const index = buildKindIndex(buildKind);
  if (index < 0) throw new TypeError("Unknown progression build kind.");
  const canonicalBuildKind = PROGRESSION_BUILD_KINDS[index]!;
  const cost = PROGRESSION_BUILD_COSTS[canonicalBuildKind];
  if (mutationSourceConsumed(state)) {
    return FREEZE_VALUE({
      ok: false,
      reason: "sourceConsumed",
      state,
      buildKind: canonicalBuildKind,
      cost,
    });
  }
  const active = privateMapGet(activeMutationAuthorization, state);
  if (active) {
    const existing = privateMapGet(
      placementAuthorizationInternals,
      active as PlacementAuthorization,
    );
    if (
      existing
      && existing.state === state
      && existing.result.buildKind === canonicalBuildKind
    ) {
      return FREEZE_VALUE({
        ok: true,
        authorization: active as PlacementAuthorization,
      });
    }
  }
  if (!isBuildUnlocked(state, canonicalBuildKind)) {
    return FREEZE_VALUE({
      ok: false,
      reason: "locked",
      state,
      buildKind: canonicalBuildKind,
      cost,
    });
  }
  if (state.alloy < cost) {
    return FREEZE_VALUE({
      ok: false,
      reason: "insufficientAlloy",
      state,
      buildKind: canonicalBuildKind,
      cost,
    });
  }
  const revision = incrementOrNull(state.revision);
  if (revision === null) {
    return FREEZE_VALUE({
      ok: false,
      reason: "revisionOverflow",
      state,
      buildKind: canonicalBuildKind,
      cost,
    });
  }
  const nextState = freezeState({
    mode: state.mode,
    revision,
    alloy: state.alloy - cost,
    lastCompletionTick: state.lastCompletionTick,
    selectedCommissionId: state.selectedCommissionId,
    unlockedBuildKinds: state.unlockedBuildKinds,
    unlockedRecipeIds: state.unlockedRecipeIds,
    commissions: state.commissions,
  });
  const provenance = freezeProvenance("paid", canonicalBuildKind, cost);
  const result: PlacementPurchaseSuccess = FREEZE_VALUE({
    ok: true,
    state: nextState,
    buildKind: canonicalBuildKind,
    cost,
    provenance,
  });
  const authorization: PlacementAuthorization = FREEZE_VALUE({
    buildKind: canonicalBuildKind,
    stateRevision: state.revision,
    cost,
    alloyAfter: nextState.alloy,
  });
  privateMapSet(
    placementAuthorizationInternals,
    authorization,
    FREEZE_VALUE({ state, result }),
  );
  activateAuthorization(state, authorization);
  return FREEZE_VALUE({ ok: true, authorization });
}

export function commitPlacement(
  state: ProgressionState,
  authorization: PlacementAuthorization,
): PlacementPurchaseSuccess {
  assertProgressionState(state);
  if (typeof authorization !== "object" || authorization === null) {
    throw new TypeError("Placement authorization is invalid.");
  }
  const internal = privateMapGet(
    placementAuthorizationInternals,
    authorization,
  );
  if (!internal) {
    throw new TypeError("Placement authorization was not issued here.");
  }
  if (internal.state !== state) {
    throw new TypeError("Placement authorization is stale.");
  }
  if (
    privateMapGet(activeMutationAuthorization, state) !== authorization
  ) {
    throw new TypeError("Placement authorization was superseded.");
  }
  consumeMutationSource(state);
  return internal.result;
}

export function purchasePlacement(
  state: ProgressionState,
  buildKind: ProgressionBuildKind,
): PlacementPurchaseResult {
  const preflight = preflightPlacement(state, buildKind);
  if (!preflight.ok) return preflight;
  return commitPlacement(state, preflight.authorization);
}

function railBuildKindIndex(value: unknown): number {
  for (let index = 0; index < RAIL_BUILD_KINDS.length; index += 1) {
    if (RAIL_BUILD_KINDS[index] === value) return index;
  }
  return -1;
}

function canonicalRailBuildKinds(
  values: readonly RailBuildKind[],
): readonly RailBuildKind[] {
  if (
    !ARRAY_IS_ARRAY(values) ||
    values.length === 0 ||
    values.length > 1_024
  ) {
    throw new TypeError(
      "Rail alloy transaction requires 1–1024 build kinds.",
    );
  }
  const kinds: RailBuildKind[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const kindIndex = railBuildKindIndex(values[index]);
    if (kindIndex < 0) {
      throw new TypeError("Unknown rail build kind.");
    }
    appendValue(kinds, RAIL_BUILD_KINDS[kindIndex]!);
  }
  for (let index = 1; index < kinds.length; index += 1) {
    const value = kinds[index]!;
    const valueIndex = railBuildKindIndex(value);
    let cursor = index - 1;
    while (
      cursor >= 0 &&
      railBuildKindIndex(kinds[cursor]) > valueIndex
    ) {
      kinds[cursor + 1] = kinds[cursor]!;
      cursor -= 1;
    }
    kinds[cursor + 1] = value;
  }
  return FREEZE_VALUE(kinds);
}

function railBuildKindsEqual(
  left: readonly RailBuildKind[],
  right: readonly RailBuildKind[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * Rail construction becomes available after the one-shot Autonomy directive.
 * Legacy sandbox states retain every authoring capability.
 */
export function isRailAuthoringUnlocked(
  state: ProgressionState,
): boolean {
  assertProgressionState(state);
  return (
    state.mode === "legacySandbox" ||
    state.commissions[commissionIndex("autonomy")]!.completionCount > 0
  );
}

function preflightRailAlloy(
  state: ProgressionState,
  buildKinds: readonly RailBuildKind[],
  direction: "purchase" | "refund",
): RailAlloyPreflight {
  assertProgressionState(state);
  const canonicalKinds = canonicalRailBuildKinds(buildKinds);
  let amount = 0;
  for (let index = 0; index < canonicalKinds.length; index += 1) {
    amount = safeAdd(
      amount,
      RAIL_BUILD_COSTS[canonicalKinds[index]!],
      "Rail alloy transaction amount",
    );
  }
  if (mutationSourceConsumed(state)) {
    return FREEZE_VALUE({
      ok: false,
      reason: "sourceConsumed",
      state,
      direction,
      buildKinds: canonicalKinds,
      amount,
    });
  }
  const active = privateMapGet(activeMutationAuthorization, state);
  if (active) {
    const existing = privateMapGet(
      railAlloyAuthorizationInternals,
      active as RailAlloyAuthorization,
    );
    if (
      existing &&
      existing.state === state &&
      existing.result.direction === direction &&
      railBuildKindsEqual(
        existing.result.buildKinds,
        canonicalKinds,
      )
    ) {
      return FREEZE_VALUE({
        ok: true,
        authorization: active as RailAlloyAuthorization,
      });
    }
  }
  if (!isRailAuthoringUnlocked(state)) {
    return FREEZE_VALUE({
      ok: false,
      reason: "locked",
      state,
      direction,
      buildKinds: canonicalKinds,
      amount,
    });
  }
  if (direction === "purchase" && state.alloy < amount) {
    return FREEZE_VALUE({
      ok: false,
      reason: "insufficientAlloy",
      state,
      direction,
      buildKinds: canonicalKinds,
      amount,
    });
  }
  const revision = incrementOrNull(state.revision);
  if (revision === null) {
    return FREEZE_VALUE({
      ok: false,
      reason: "revisionOverflow",
      state,
      direction,
      buildKinds: canonicalKinds,
      amount,
    });
  }
  const alloy =
    direction === "purchase"
      ? state.alloy - amount
      : state.alloy + amount;
  if (!NUMBER_IS_SAFE_INTEGER(alloy) || alloy < 0) {
    return FREEZE_VALUE({
      ok: false,
      reason: "alloyOverflow",
      state,
      direction,
      buildKinds: canonicalKinds,
      amount,
    });
  }
  const nextState = freezeState({
    mode: state.mode,
    revision,
    alloy,
    lastCompletionTick: state.lastCompletionTick,
    selectedCommissionId: state.selectedCommissionId,
    unlockedBuildKinds: state.unlockedBuildKinds,
    unlockedRecipeIds: state.unlockedRecipeIds,
    commissions: state.commissions,
  });
  const result: RailAlloyCommit = FREEZE_VALUE({
    ok: true,
    state: nextState,
    direction,
    buildKinds: canonicalKinds,
    amount,
  });
  const authorization: RailAlloyAuthorization = FREEZE_VALUE({
    direction,
    buildKinds: canonicalKinds,
    stateRevision: state.revision,
    amount,
    alloyAfter: alloy,
    stagedState: nextState,
  });
  privateMapSet(
    railAlloyAuthorizationInternals,
    authorization,
    FREEZE_VALUE({ state, result }),
  );
  activateAuthorization(state, authorization);
  return FREEZE_VALUE({ ok: true, authorization });
}

export function preflightRailPurchase(
  state: ProgressionState,
  buildKinds: readonly RailBuildKind[],
): RailAlloyPreflight {
  return preflightRailAlloy(state, buildKinds, "purchase");
}

export function preflightRailRefund(
  state: ProgressionState,
  buildKinds: readonly RailBuildKind[],
): RailAlloyPreflight {
  return preflightRailAlloy(state, buildKinds, "refund");
}

/**
 * Commits only after the caller's rail topology/consist transaction succeeds.
 * A rejected rail mutation can discard the authorization without consuming
 * either the progression source state or any undo history.
 */
export function commitRailAlloy(
  state: ProgressionState,
  authorization: RailAlloyAuthorization,
): RailAlloyCommit {
  assertProgressionState(state);
  if (typeof authorization !== "object" || authorization === null) {
    throw new TypeError("Rail alloy authorization is invalid.");
  }
  const internal = privateMapGet(
    railAlloyAuthorizationInternals,
    authorization,
  );
  if (!internal) {
    throw new TypeError("Rail alloy authorization was not issued here.");
  }
  if (internal.state !== state) {
    throw new TypeError("Rail alloy authorization is stale.");
  }
  if (
    privateMapGet(activeMutationAuthorization, state) !== authorization
  ) {
    throw new TypeError("Rail alloy authorization was superseded.");
  }
  consumeMutationSource(state);
  return internal.result;
}

function assertBenchmarkCount(value: number, label: string): void {
  if (
    !NUMBER_IS_SAFE_INTEGER(value)
    || OBJECT_IS(value, -0)
    || value <= 0
    || value > 100_000
  ) {
    throw new RangeError(
      `${label} must be a positive safe integer <= 100000.`,
    );
  }
}

function percentile(samples: readonly number[], proportion: number): number {
  const sorted = copyArray(samples);
  for (let index = 1; index < sorted.length; index += 1) {
    const value = sorted[index]!;
    let cursor = index - 1;
    while (cursor >= 0 && sorted[cursor]! > value) {
      sorted[cursor + 1] = sorted[cursor]!;
      cursor -= 1;
    }
    sorted[cursor + 1] = value;
  }
  const index = MATH_MIN(
    sorted.length - 1,
    MATH_MAX(0, MATH_CEIL(sorted.length * proportion) - 1),
  );
  return sorted[index] ?? 0;
}

/**
 * Measures the allocation-free prepared readiness probe. The nominal entity
 * count is reported to make the 5,000-entity integration budget explicit; it
 * cannot influence timing because this kernel has no entity input or scan.
 */
export function benchmarkPreparedCommissionProbe(
  probe: PreparedCommissionProbe,
  state: ProgressionState,
  inventory: ProgressionInventory,
  tick: number,
  options: ProgressionBenchmarkOptions = {},
): ProgressionBenchmark {
  const warmupSamples = options.warmupSamples ?? 1_000;
  const samples = options.samples ?? 5_000;
  const nominalEntityCount = options.nominalEntityCount ?? 5_000;
  assertBenchmarkCount(warmupSamples, "Progression benchmark warmupSamples");
  assertBenchmarkCount(samples, "Progression benchmark samples");
  assertBenchmarkCount(
    nominalEntityCount,
    "Progression benchmark nominalEntityCount",
  );

  let ready = false;
  for (let index = 0; index < warmupSamples; index += 1) {
    ready = isPreparedCommissionReady(probe, state, inventory, tick);
  }
  const timings: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now();
    ready = isPreparedCommissionReady(probe, state, inventory, tick);
    appendValue(timings, performance.now() - startedAt);
  }
  return FREEZE_VALUE({
    commissionDefinitionCount: COMMISSION_DEFINITIONS.length,
    maximumCommissionDefinitionCount: MAX_COMMISSION_DEFINITIONS,
    nominalEntityCount,
    requirementCount: probe.requirementCount,
    samples,
    ready,
    p50Ms: percentile(timings, 0.5),
    p95Ms: percentile(timings, 0.95),
  });
}
