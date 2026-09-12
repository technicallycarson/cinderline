/**
 * Pure, deterministic power-grid topology and dispatch.
 *
 * This module deliberately has no dependency on EntityState, the catalog, or
 * the simulation. Its public values are JSON-shaped and deeply frozen so they
 * can be serialized, compared, and handed to untrusted consumers without
 * exposing mutable Maps or input object references.
 */

export const POWER_SUPPLY_HALF_EXTENT_TILES = 5;
export const POWER_SUPPLY_RADIUS_TILES = POWER_SUPPLY_HALF_EXTENT_TILES;
export const POWER_CABLE_REACH_TILES = 7.5;
export const POWER_MAX_LINKS_PER_RELAY = 5;

const POWER_CABLE_REACH_SQUARED =
  POWER_CABLE_REACH_TILES * POWER_CABLE_REACH_TILES;
const MAX_SAFE_SCALAR = Number.MAX_SAFE_INTEGER;
/**
 * Two representable-number steps cover ordinary last-bit drift from
 * trigonometric construction and decimal addition. This is deliberately not a
 * world-space/gameplay epsilon: at the squared 7.5-tile cable radius it is
 * about 1.4e-14.
 */
const NUMERIC_EQUALITY_ULPS = 2;
const MIN_NORMAL_NUMBER = 2 ** -1022;
const POWER_LINEAR_BOUNDARY_TOLERANCE = 2 ** (2 - 52)
  * NUMERIC_EQUALITY_ULPS;
const POWER_SQUARED_BOUNDARY_TOLERANCE = 2 ** (5 - 52)
  * NUMERIC_EQUALITY_ULPS;
const POWER_TOLERANT_SUPPLY_HALF_EXTENT =
  POWER_SUPPLY_HALF_EXTENT_TILES + POWER_LINEAR_BOUNDARY_TOLERANCE;

// Capture the mutation/brand-check intrinsics before application or test code
// can monkeypatch public prototypes. Prepared dispatch never invokes an
// instance method or a caller-controlled getter during its commit phase.
const OBJECT_GET_OWN_PROPERTY_DESCRIPTOR =
  Object.getOwnPropertyDescriptor;
const OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const OBJECT_IS_EXTENSIBLE = Object.isExtensible;
const OBJECT_FREEZE = Object.freeze;
const REFLECT_APPLY_INTRINSIC = Reflect.apply;
const WEAK_MAP_GET_INTRINSIC = WeakMap.prototype.get;
const WEAK_MAP_SET_INTRINSIC = WeakMap.prototype.set;
const FLOAT64_ARRAY_CONSTRUCTOR = Float64Array;
const FLOAT64_ARRAY_PROTOTYPE = FLOAT64_ARRAY_CONSTRUCTOR.prototype;
const FLOAT64_ARRAY_SET = FLOAT64_ARRAY_PROTOTYPE.set;
const FLOAT64_ARRAY_FILL = FLOAT64_ARRAY_PROTOTYPE.fill;
const FLOAT64_ARRAY_BYTES_PER_ELEMENT =
  FLOAT64_ARRAY_CONSTRUCTOR.BYTES_PER_ELEMENT;
const TYPED_ARRAY_PROTOTYPE = OBJECT_GET_PROTOTYPE_OF(
  FLOAT64_ARRAY_PROTOTYPE,
);
const TYPED_ARRAY_LENGTH_GETTER = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
  TYPED_ARRAY_PROTOTYPE,
  "length",
)!.get!;
const TYPED_ARRAY_BYTE_LENGTH_GETTER =
  OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
    TYPED_ARRAY_PROTOTYPE,
    "byteLength",
  )!.get!;
const TYPED_ARRAY_BYTE_OFFSET_GETTER =
  OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
    TYPED_ARRAY_PROTOTYPE,
    "byteOffset",
  )!.get!;
const TYPED_ARRAY_BUFFER_GETTER = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
)!.get!;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER =
  OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
    ArrayBuffer.prototype,
    "byteLength",
  )!.get!;
const FLOAT64_ARRAY_SET_CALL = Function.prototype.call.bind(
  FLOAT64_ARRAY_SET,
) as (
  target: Float64Array,
  source: ArrayLike<number>,
  offset?: number,
) => void;
const FLOAT64_ARRAY_FILL_CALL = Function.prototype.call.bind(
  FLOAT64_ARRAY_FILL,
) as (
  target: Float64Array,
  value: number,
  start?: number,
  end?: number,
) => Float64Array;
const TYPED_ARRAY_LENGTH_GET = Function.prototype.call.bind(
  TYPED_ARRAY_LENGTH_GETTER,
) as (target: ArrayBufferView) => number;
const TYPED_ARRAY_BYTE_LENGTH_GET = Function.prototype.call.bind(
  TYPED_ARRAY_BYTE_LENGTH_GETTER,
) as (target: ArrayBufferView) => number;
const TYPED_ARRAY_BYTE_OFFSET_GET = Function.prototype.call.bind(
  TYPED_ARRAY_BYTE_OFFSET_GETTER,
) as (target: ArrayBufferView) => number;
const TYPED_ARRAY_BUFFER_GET = Function.prototype.call.bind(
  TYPED_ARRAY_BUFFER_GETTER,
) as (target: ArrayBufferView) => ArrayBufferLike;
const ARRAY_BUFFER_BYTE_LENGTH_GET = Function.prototype.call.bind(
  ARRAY_BUFFER_BYTE_LENGTH_GETTER,
) as (target: ArrayBufferLike) => number;

export interface PowerCenter {
  readonly x: number;
  readonly y: number;
}

export interface PowerRelayNode {
  readonly id: number;
  readonly center: PowerCenter;
}

export interface PowerParticipantCoverage {
  /** Distance from center to the outer occupied tile centers. */
  readonly coverageHalfWidthTiles?: number;
  readonly coverageHalfHeightTiles?: number;
}

export interface PowerGeneratorParticipant extends PowerParticipantCoverage {
  readonly id: number;
  readonly center: PowerCenter;
  readonly role: "generator";
  readonly capacity: number;
}

export interface PowerConsumerParticipant extends PowerParticipantCoverage {
  readonly id: number;
  readonly center: PowerCenter;
  readonly role: "consumer";
  readonly demand: number;
}

export interface PowerPassiveParticipant extends PowerParticipantCoverage {
  readonly id: number;
  readonly center: PowerCenter;
  readonly role: "passive";
}

export type PowerParticipant =
  | PowerGeneratorParticipant
  | PowerConsumerParticipant
  | PowerPassiveParticipant;

export type PowerParticipantRole = PowerParticipant["role"];

/**
 * Canonical, serializable map representation. Entries are always sorted by ID.
 */
export type CanonicalIdMap<Value> = readonly (
  readonly [id: number, value: Value]
)[];

/**
 * One undirected link. relayAId is always lower than relayBId.
 */
export interface PowerRelayLink {
  readonly relayAId: number;
  readonly relayBId: number;
  readonly distanceSquared: number;
}

export interface PowerTopologyComponent {
  /** The lowest relay ID in this component. */
  readonly networkId: number;
  readonly relayIds: readonly number[];
  /** Canonical low-ID/high-ID link pairs contained in the component. */
  readonly links: readonly (readonly [number, number])[];
}

export interface PowerTopology {
  /** Sorted by distanceSquared, relayAId, then relayBId. */
  readonly links: readonly PowerRelayLink[];
  /** Symmetric adjacency, sorted by relay ID and then neighbor ID. */
  readonly relayAdjacency: CanonicalIdMap<readonly number[]>;
  readonly relayToNetwork: CanonicalIdMap<number>;
  readonly participantRoles: CanonicalIdMap<PowerParticipantRole>;
  readonly participantToRelay: CanonicalIdMap<number | null>;
  readonly participantToNetwork: CanonicalIdMap<number | null>;
  readonly components: readonly PowerTopologyComponent[];
  /** All in-reach relay pairs considered by the graph passes. */
  readonly candidatePairCount: number;
}

export interface PowerNetworkDispatch {
  readonly networkId: number;
  readonly demand: number;
  readonly availableCapacity: number;
  readonly usedCapacity: number;
  readonly satisfaction: number;
}

export interface PowerDispatch {
  readonly networks: readonly PowerNetworkDispatch[];
  readonly consumerSatisfaction: CanonicalIdMap<number>;
  readonly generatorOutput: CanonicalIdMap<number>;
  /** Includes covered and uncovered consumers. */
  readonly totalDemand: number;
  /** Includes covered and uncovered generators. */
  readonly totalGeneratorCapacity: number;
  readonly totalUsedCapacity: number;
  readonly disconnectedDemand: number;
  readonly disconnectedGeneratorCapacity: number;
  /** totalUsedCapacity / totalDemand, or 1 when totalDemand is zero. */
  readonly globalSatisfaction: number;
}

export interface PowerTopologyBenchmarkOptions {
  readonly warmupSamples?: number;
  readonly samples?: number;
}

export interface PowerTopologyBenchmark {
  readonly relayCount: number;
  readonly participantCount: number;
  readonly candidatePairCount: number;
  readonly linkCount: number;
  readonly topologyHash: string;
  readonly samples: number;
  readonly topologyP50Ms: number;
  readonly topologyP95Ms: number;
  readonly dispatchP50Ms: number;
  readonly dispatchP95Ms: number;
}

export interface PowerDispatchParticipantIdentity {
  readonly id: number;
  readonly role: PowerParticipantRole;
}

/**
 * Detached, canonical dispatch structure prepared after topology/roles change.
 * Consumer and generator scalar slots are ordered by their corresponding ID
 * arrays. A prepared plan is immutable and contains no topology/input refs.
 */
export interface PreparedPowerDispatchPlan {
  readonly participantIds: readonly number[];
  readonly participantRoles: readonly PowerParticipantRole[];
  readonly networkIds: readonly number[];
  readonly consumerIds: readonly number[];
  readonly consumerNetworkIndices: readonly number[];
  readonly generatorIds: readonly number[];
  readonly generatorNetworkIndices: readonly number[];
}

/**
 * Dynamic scalars use plan slot order exactly: consumerDemands[index] belongs
 * to plan.consumerIds[index], and likewise for generatorCapacities.
 */
export interface PreparedPowerDynamicScalars {
  readonly consumerDemands: ArrayLike<number>;
  readonly generatorCapacities: ArrayLike<number>;
}

/**
 * Caller-owned reusable output. Values are ephemeral and overwritten by the
 * next successful dispatch. Keep the factory-created outer properties and
 * typed-array references structurally intact; sealed, frozen, detached, or
 * redefined workspaces are rejected before commit. Own/prototype method
 * shadows on the arrays are harmless because commits use captured intrinsics.
 * Use dispatchPower when a retained immutable snapshot is required.
 */
export interface PreparedPowerDispatchWorkspace {
  readonly networkDemand: Float64Array;
  readonly networkAvailableCapacity: Float64Array;
  readonly networkUsedCapacity: Float64Array;
  readonly networkSatisfaction: Float64Array;
  readonly consumerSatisfaction: Float64Array;
  readonly generatorOutput: Float64Array;
  totalDemand: number;
  totalGeneratorCapacity: number;
  totalUsedCapacity: number;
  disconnectedDemand: number;
  disconnectedGeneratorCapacity: number;
  globalSatisfaction: number;
}

export interface PreparedPowerDispatchBenchmark {
  readonly relayCount: number;
  readonly participantCount: number;
  readonly consumerCount: number;
  readonly generatorCount: number;
  readonly networkCount: number;
  readonly topologyHash: string;
  readonly samples: number;
  readonly strictP50Ms: number;
  readonly strictP95Ms: number;
  readonly preparedP50Ms: number;
  readonly preparedP95Ms: number;
}

interface NormalizedRelay {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  index: number;
}

interface NormalizedParticipantColumns {
  readonly ids: readonly number[];
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  readonly coverageHalfWidths: readonly number[];
  readonly coverageHalfHeights: readonly number[];
  readonly roles: readonly PowerParticipantRole[];
  /** Null when input IDs were already ascending. */
  readonly canonicalOrder: readonly number[] | null;
}

interface NormalizedDispatchParticipant {
  readonly id: number;
  readonly role: PowerParticipantRole;
  readonly demand: number;
  readonly capacity: number;
}

interface RelayCandidate {
  readonly relayAId: number;
  readonly relayBId: number;
  readonly relayAIndex: number;
  readonly relayBIndex: number;
  readonly distanceSquared: number;
}

interface NetworkAccumulator {
  readonly networkId: number;
  demand: number;
  availableCapacity: number;
  readonly consumerOutputIndices: number[];
  readonly generators: {
    readonly id: number;
    readonly capacity: number;
    readonly outputIndex: number;
  }[];
}

type MutableDispatchOutput = [id: number, value: number];

interface PreparedWorkspaceInternal {
  readonly planToken: object;
  readonly workspacePrototype: object | null;
  readonly networkCount: number;
  readonly consumerCount: number;
  readonly generatorCount: number;
  readonly networkDemand: Float64Array;
  readonly networkDemandBuffer: ArrayBufferLike;
  readonly networkAvailableCapacity: Float64Array;
  readonly networkAvailableCapacityBuffer: ArrayBufferLike;
  readonly networkUsedCapacity: Float64Array;
  readonly networkUsedCapacityBuffer: ArrayBufferLike;
  readonly networkSatisfaction: Float64Array;
  readonly networkSatisfactionBuffer: ArrayBufferLike;
  readonly consumerSatisfaction: Float64Array;
  readonly consumerSatisfactionBuffer: ArrayBufferLike;
  readonly generatorOutput: Float64Array;
  readonly generatorOutputBuffer: ArrayBufferLike;
  readonly stagedConsumerDemand: Float64Array;
  readonly stagedConsumerDemandBuffer: ArrayBufferLike;
  readonly stagedGeneratorCapacity: Float64Array;
  readonly stagedGeneratorCapacityBuffer: ArrayBufferLike;
  readonly stagedNetworkDemand: Float64Array;
  readonly stagedNetworkDemandBuffer: ArrayBufferLike;
  readonly stagedNetworkAvailableCapacity: Float64Array;
  readonly stagedNetworkAvailableCapacityBuffer: ArrayBufferLike;
  readonly stagedNetworkUsedCapacity: Float64Array;
  readonly stagedNetworkUsedCapacityBuffer: ArrayBufferLike;
  readonly stagedNetworkSatisfaction: Float64Array;
  readonly stagedNetworkSatisfactionBuffer: ArrayBufferLike;
  readonly stagedConsumerSatisfaction: Float64Array;
  readonly stagedConsumerSatisfactionBuffer: ArrayBufferLike;
  readonly stagedGeneratorOutput: Float64Array;
  readonly stagedGeneratorOutputBuffer: ArrayBufferLike;
  readonly remainingGeneratorDemand: Float64Array;
  readonly remainingGeneratorDemandBuffer: ArrayBufferLike;
}

const preparedPlanTokens = new WeakMap<PreparedPowerDispatchPlan, object>();
const preparedWorkspaceInternals = new WeakMap<
  PreparedPowerDispatchWorkspace,
  PreparedWorkspaceInternal
>();

function trustedWeakMapGet<Key extends object, Value>(
  map: WeakMap<Key, Value>,
  key: Key,
): Value | undefined {
  return REFLECT_APPLY_INTRINSIC(
    WEAK_MAP_GET_INTRINSIC,
    map,
    [key],
  ) as Value | undefined;
}

function trustedWeakMapSet<Key extends object, Value>(
  map: WeakMap<Key, Value>,
  key: Key,
  value: Value,
): void {
  REFLECT_APPLY_INTRINSIC(
    WEAK_MAP_SET_INTRINSIC,
    map,
    [key, value],
  );
}

function compareNumber(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCandidate(
  left: RelayCandidate,
  right: RelayCandidate,
): number {
  return (
    compareNumber(left.distanceSquared, right.distanceSquared)
    || compareNumber(left.relayAId, right.relayAId)
    || compareNumber(left.relayBId, right.relayBId)
  );
}

function canonicalZero(value: number): number {
  return value === 0 ? 0 : value;
}

function numericUlp(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude < MIN_NORMAL_NUMBER) return Number.MIN_VALUE;
  return 2 ** (Math.floor(Math.log2(magnitude)) - 52);
}

function equalWithinNumericUlps(left: number, right: number): boolean {
  return (
    left === right
    || Math.abs(left - right) <= Math.max(
      numericUlp(left),
      numericUlp(right),
    ) * NUMERIC_EQUALITY_ULPS
  );
}

function demandIsNumericallySatisfied(
  usedCapacity: number,
  demand: number,
): boolean {
  if (usedCapacity === demand) return true;
  // Any safe-integer operand is exact. Do not erase a real sub-unit brownout
  // beside a large integer merely because that integer's ULP is coarse. The
  // clamp is reserved for two decimal operands/sums.
  if (
    Number.isSafeInteger(usedCapacity)
    || Number.isSafeInteger(demand)
  ) {
    return false;
  }
  return equalWithinNumericUlps(usedCapacity, demand);
}

function withinInclusiveNumericLimit(
  value: number,
  limit: number,
  tolerance: number,
): boolean {
  return value <= limit || value - limit <= tolerance;
}

function assertPositiveSafeId(id: unknown, label: string): asserts id is number {
  if (
    typeof id !== "number"
    || !Number.isSafeInteger(id)
    || id <= 0
  ) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
}

function assertFiniteCoordinate(
  coordinate: unknown,
  label: string,
): asserts coordinate is number {
  if (typeof coordinate !== "number" || !Number.isFinite(coordinate)) {
    throw new RangeError(`${label} must be finite.`);
  }
}

function assertSafeNonnegativeScalar(
  value: unknown,
  label: string,
): asserts value is number {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < 0
    || value > MAX_SAFE_SCALAR
  ) {
    throw new RangeError(
      `${label} must be finite, nonnegative, and no greater than Number.MAX_SAFE_INTEGER.`,
    );
  }
}

function safeAdd(left: number, right: number, label: string): number {
  if (
    right > MAX_SAFE_SCALAR - left
    || left > MAX_SAFE_SCALAR - right
  ) {
    throw new RangeError(`${label} exceeds the safe numeric range.`);
  }
  const result = left + right;
  if (!Number.isFinite(result) || result > MAX_SAFE_SCALAR) {
    throw new RangeError(`${label} exceeds the safe numeric range.`);
  }
  return canonicalZero(result);
}

function normalizeRelay(
  relay: PowerRelayNode,
  index: number,
): NormalizedRelay {
  if (typeof relay !== "object" || relay === null) {
    throw new TypeError(`Relay at index ${index} must be an object.`);
  }
  const relayId = relay.id;
  assertPositiveSafeId(relayId, `Relay id at index ${index}`);
  const center = relay.center;
  if (typeof center !== "object" || center === null) {
    throw new TypeError(`Relay center for id ${relayId} must be an object.`);
  }
  const x = center.x;
  const y = center.y;
  assertFiniteCoordinate(x, `Relay ${relayId} center.x`);
  assertFiniteCoordinate(y, `Relay ${relayId} center.y`);
  return {
    id: relayId,
    x: canonicalZero(x),
    y: canonicalZero(y),
    index: -1,
  };
}

function normalizeDispatchParticipant(
  participant: PowerParticipant,
  index: number,
): NormalizedDispatchParticipant {
  if (typeof participant !== "object" || participant === null) {
    throw new TypeError(`Participant at index ${index} must be an object.`);
  }
  const participantId = participant.id;
  assertPositiveSafeId(
    participantId,
    `Participant id at index ${index}`,
  );
  const center = participant.center;
  if (typeof center !== "object" || center === null) {
    throw new TypeError(
      `Participant center for id ${participantId} must be an object.`,
    );
  }
  const x = center.x;
  const y = center.y;
  assertFiniteCoordinate(
    x,
    `Participant ${participantId} center.x`,
  );
  assertFiniteCoordinate(
    y,
    `Participant ${participantId} center.y`,
  );

  const role = participant.role;
  if (
    role !== "generator"
    && role !== "consumer"
    && role !== "passive"
  ) {
    throw new TypeError(
      `Participant ${participantId} has an invalid power role.`,
    );
  }

  let demand = 0;
  let capacity = 0;
  if (role === "generator") {
    const rawCapacity = participant.capacity;
    assertSafeNonnegativeScalar(
      rawCapacity,
      `Generator ${participantId} capacity`,
    );
    capacity = canonicalZero(rawCapacity);
  } else if (role === "consumer") {
    const rawDemand = participant.demand;
    assertSafeNonnegativeScalar(
      rawDemand,
      `Consumer ${participantId} demand`,
    );
    demand = canonicalZero(rawDemand);
  }

  return {
    id: participantId,
    role,
    demand,
    capacity,
  };
}

function sortByAscendingIdIfNeeded<Value extends { readonly id: number }>(
  values: Value[],
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]!.id > values[index]!.id) {
      values.sort((left, right) => compareNumber(left.id, right.id));
      return;
    }
  }
}

function normalizeInputs(
  relays: readonly PowerRelayNode[],
  participants: readonly PowerParticipant[],
): {
  readonly relays: readonly NormalizedRelay[];
  readonly participants: NormalizedParticipantColumns;
} {
  if (!Array.isArray(relays)) {
    throw new TypeError("Relays must be an array.");
  }
  if (!Array.isArray(participants)) {
    throw new TypeError("Power participants must be an array.");
  }

  const seenIds = new Set<number>();
  const relayCount = relays.length;
  const normalizedRelays = new Array<NormalizedRelay>(relayCount);
  for (let index = 0; index < relayCount; index += 1) {
    const normalized = normalizeRelay(relays[index]!, index);
    if (seenIds.has(normalized.id)) {
      throw new Error(`Duplicate power node id ${normalized.id}.`);
    }
    seenIds.add(normalized.id);
    normalizedRelays[index] = normalized;
  }
  const participantCount = participants.length;
  const participantIds = new Array<number>(participantCount);
  const participantXs = new Array<number>(participantCount);
  const participantYs = new Array<number>(participantCount);
  const participantCoverageHalfWidths = new Array<number>(participantCount);
  const participantCoverageHalfHeights = new Array<number>(participantCount);
  const participantRoles =
    new Array<PowerParticipantRole>(participantCount);
  let participantIdsAscending = true;
  let previousParticipantId = 0;
  for (let index = 0; index < participantCount; index += 1) {
    const participant = participants[index]!;
    if (typeof participant !== "object" || participant === null) {
      throw new TypeError(
        `Participant at index ${index} must be an object.`,
      );
    }
    const participantId = participant.id;
    assertPositiveSafeId(
      participantId,
      `Participant id at index ${index}`,
    );
    const center = participant.center;
    if (typeof center !== "object" || center === null) {
      throw new TypeError(
        `Participant center for id ${participantId} must be an object.`,
      );
    }
    const x = center.x;
    const y = center.y;
    assertFiniteCoordinate(x, `Participant ${participantId} center.x`);
    assertFiniteCoordinate(y, `Participant ${participantId} center.y`);
    const coverageHalfWidth = participant.coverageHalfWidthTiles ?? 0;
    const coverageHalfHeight = participant.coverageHalfHeightTiles ?? 0;
    assertSafeNonnegativeScalar(
      coverageHalfWidth,
      `Participant ${participantId} coverage half-width`,
    );
    assertSafeNonnegativeScalar(
      coverageHalfHeight,
      `Participant ${participantId} coverage half-height`,
    );
    const role = participant.role;
    if (
      role !== "generator"
      && role !== "consumer"
      && role !== "passive"
    ) {
      throw new TypeError(
        `Participant ${participantId} has an invalid power role.`,
      );
    }
    if (role === "generator") {
      const capacity = participant.capacity;
      assertSafeNonnegativeScalar(
        capacity,
        `Generator ${participantId} capacity`,
      );
    } else if (role === "consumer") {
      const demand = participant.demand;
      assertSafeNonnegativeScalar(
        demand,
        `Consumer ${participantId} demand`,
      );
    }
    if (seenIds.has(participantId)) {
      throw new Error(`Duplicate power node id ${participantId}.`);
    }
    seenIds.add(participantId);
    if (index > 0 && participantId < previousParticipantId) {
      participantIdsAscending = false;
    }
    previousParticipantId = participantId;
    participantIds[index] = participantId;
    participantXs[index] = canonicalZero(x);
    participantYs[index] = canonicalZero(y);
    participantCoverageHalfWidths[index] = canonicalZero(coverageHalfWidth);
    participantCoverageHalfHeights[index] = canonicalZero(coverageHalfHeight);
    participantRoles[index] = role;
  }

  sortByAscendingIdIfNeeded(normalizedRelays);
  for (let index = 0; index < normalizedRelays.length; index += 1) {
    normalizedRelays[index]!.index = index;
  }
  let canonicalOrder: number[] | null = null;
  if (!participantIdsAscending) {
    canonicalOrder = new Array<number>(participantCount);
    for (let index = 0; index < canonicalOrder.length; index += 1) {
      canonicalOrder[index] = index;
    }
    canonicalOrder.sort((left, right) =>
      compareNumber(participantIds[left]!, participantIds[right]!)
    );
  }
  return {
    relays: normalizedRelays,
    participants: {
      ids: participantIds,
      xs: participantXs,
      ys: participantYs,
      coverageHalfWidths: participantCoverageHalfWidths,
      coverageHalfHeights: participantCoverageHalfHeights,
      roles: participantRoles,
      canonicalOrder,
    },
  };
}

function normalizeDispatchParticipants(
  participants: readonly PowerParticipant[],
): readonly NormalizedDispatchParticipant[] {
  if (!Array.isArray(participants)) {
    throw new TypeError("Power participants must be an array.");
  }
  const normalized = new Array<NormalizedDispatchParticipant>(
    participants.length,
  );
  let ascending = true;
  let previousId = 0;
  for (let index = 0; index < participants.length; index += 1) {
    const participant = normalizeDispatchParticipant(
      participants[index]!,
      index,
    );
    normalized[index] = participant;
    const participantId = participant.id;
    if (index > 0 && participantId === previousId) {
      throw new Error(`Duplicate power participant id ${participantId}.`);
    }
    if (index > 0 && participantId < previousId) ascending = false;
    previousId = participantId;
  }
  if (!ascending) {
    const seenIds = new Set<number>();
    for (const participant of normalized) {
      if (seenIds.has(participant.id)) {
        throw new Error(
          `Duplicate power participant id ${participant.id}.`,
        );
      }
      seenIds.add(participant.id);
    }
    normalized.sort((left, right) => compareNumber(left.id, right.id));
  }
  return normalized;
}

class RelaySpatialHash {
  private readonly columns = new Map<
    number,
    Map<number, NormalizedRelay[]>
  >();
  private readonly relays: readonly NormalizedRelay[];

  constructor(
    relays: readonly NormalizedRelay[],
    private readonly cellSize: number,
  ) {
    this.relays = relays;
    for (const relay of relays) {
      const cellX = Math.floor(relay.x / cellSize);
      const cellY = Math.floor(relay.y / cellSize);
      let column = this.columns.get(cellX);
      if (!column) {
        column = new Map();
        this.columns.set(cellX, column);
      }
      const bucket = column.get(cellY);
      if (bucket) bucket.push(relay);
      else column.set(cellY, [relay]);
    }
  }

  forEachInAxisAlignedRange(
    x: number,
    y: number,
    halfExtent: number,
    visit: (relay: NormalizedRelay) => void,
  ): void {
    const tolerantHalfExtent =
      halfExtent + POWER_LINEAR_BOUNDARY_TOLERANCE;
    const minimumCellX = Math.floor(
      (x - tolerantHalfExtent) / this.cellSize,
    );
    const maximumCellX = Math.floor(
      (x + tolerantHalfExtent) / this.cellSize,
    );
    const minimumCellY = Math.floor(
      (y - tolerantHalfExtent) / this.cellSize,
    );
    const maximumCellY = Math.floor(
      (y + tolerantHalfExtent) / this.cellSize,
    );
    const xCellSpan = maximumCellX - minimumCellX;
    const yCellSpan = maximumCellY - minimumCellY;
    const xSlotCount = xCellSpan <= 0
      ? 1
      : xCellSpan === 1
        ? 2
        : xCellSpan === 2
          ? 3
          : 4;
    const ySlotCount = yCellSpan <= 0
      ? 1
      : yCellSpan === 1
        ? 2
        : yCellSpan === 2
          ? 3
          : 4;
    // Cable queries can straddle four cells when their tolerant interval lies
    // on a hash boundary. These fixed slots enumerate the complete contiguous
    // range without unsafe-integer increment loops; equality de-duplication
    // handles shorter spans and extreme finite coordinates.
    let previousCellX = Number.NaN;
    for (let xSlot = 0; xSlot < xSlotCount; xSlot += 1) {
      const cellX = xSlot === xSlotCount - 1
        ? maximumCellX
        : minimumCellX + xSlot;
      if (cellX === previousCellX) continue;
      previousCellX = cellX;
      const column = this.columns.get(cellX);
      if (!column) continue;
      let previousCellY = Number.NaN;
      for (let ySlot = 0; ySlot < ySlotCount; ySlot += 1) {
        const cellY = ySlot === ySlotCount - 1
          ? maximumCellY
          : minimumCellY + ySlot;
        if (cellY === previousCellY) continue;
        previousCellY = cellY;
        const bucket = column.get(cellY);
        if (!bucket) continue;
        for (const relay of bucket) visit(relay);
      }
    }
  }

  closestSupplyRelayId(
    x: number,
    y: number,
    coverageHalfWidth = 0,
    coverageHalfHeight = 0,
  ): number | null {
    const tolerantHalfWidth =
      POWER_TOLERANT_SUPPLY_HALF_EXTENT + coverageHalfWidth;
    const tolerantHalfHeight =
      POWER_TOLERANT_SUPPLY_HALF_EXTENT + coverageHalfHeight;
    const minimumCellX = Math.floor(
      (x - tolerantHalfWidth) / this.cellSize,
    );
    const maximumCellX = Math.floor(
      (x + tolerantHalfWidth) / this.cellSize,
    );
    const minimumCellY = Math.floor(
      (y - tolerantHalfHeight) / this.cellSize,
    );
    const maximumCellY = Math.floor(
      (y + tolerantHalfHeight) / this.cellSize,
    );
    const xCellSpan = maximumCellX - minimumCellX;
    const yCellSpan = maximumCellY - minimumCellY;
    const xSlotCount = xCellSpan <= 0
      ? 1
      : xCellSpan === 1
        ? 2
        : xCellSpan === 2
          ? 3
          : 4;
    const ySlotCount = yCellSpan <= 0
      ? 1
      : yCellSpan === 1
        ? 2
        : yCellSpan === 2
          ? 3
          : 4;
    let closestRelayId: number | null = null;
    let closestDistanceSquared = Number.POSITIVE_INFINITY;
    const considerRelay = (relay: NormalizedRelay): void => {
      const deltaX = relay.x - x;
      const deltaY = relay.y - y;
      if (
        !withinInclusiveNumericLimit(
          Math.abs(deltaX),
          POWER_SUPPLY_HALF_EXTENT_TILES + coverageHalfWidth,
          POWER_LINEAR_BOUNDARY_TOLERANCE,
        )
        || !withinInclusiveNumericLimit(
          Math.abs(deltaY),
          POWER_SUPPLY_HALF_EXTENT_TILES + coverageHalfHeight,
          POWER_LINEAR_BOUNDARY_TOLERANCE,
        )
      ) {
        return;
      }
      const distanceSquared = canonicalZero(
        deltaX * deltaX + deltaY * deltaY,
      );
      if (
        distanceSquared < closestDistanceSquared
        || (
          distanceSquared === closestDistanceSquared
          && (
            closestRelayId === null
            || relay.id < closestRelayId
          )
        )
      ) {
        closestRelayId = relay.id;
        closestDistanceSquared = distanceSquared;
      }
    };
    // Oversized external participants can span more hash cells than the
    // fixed fast path. They are uncommon, so preserve correctness by scanning
    // the relay set instead of incrementing potentially unsafe cell indices.
    if (xCellSpan > 3 || yCellSpan > 3) {
      for (const relay of this.relays) considerRelay(relay);
      return closestRelayId;
    }
    let previousCellX = Number.NaN;
    for (let xSlot = 0; xSlot < xSlotCount; xSlot += 1) {
      const cellX = xSlot === xSlotCount - 1
        ? maximumCellX
        : minimumCellX + xSlot;
      if (cellX === previousCellX) continue;
      previousCellX = cellX;
      const column = this.columns.get(cellX);
      if (!column) continue;
      let previousCellY = Number.NaN;
      for (let ySlot = 0; ySlot < ySlotCount; ySlot += 1) {
        const cellY = ySlot === ySlotCount - 1
          ? maximumCellY
          : minimumCellY + ySlot;
        if (cellY === previousCellY) continue;
        previousCellY = cellY;
        const bucket = column.get(cellY);
        if (!bucket) continue;
        for (const relay of bucket) considerRelay(relay);
      }
    }
    return closestRelayId;
  }
}

class UnionFind {
  private readonly parent: Int32Array;
  private readonly rank: Uint8Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    this.rank = new Uint8Array(size);
    for (let index = 0; index < size; index += 1) {
      this.parent[index] = index;
    }
  }

  find(index: number): number {
    let root = index;
    while (this.parent[root] !== root) {
      root = this.parent[root]!;
    }
    let current = index;
    while (this.parent[current] !== current) {
      const next = this.parent[current]!;
      this.parent[current] = root;
      current = next;
    }
    return root;
  }

  union(left: number, right: number): void {
    let leftRoot = this.find(left);
    let rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    const leftRank = this.rank[leftRoot]!;
    const rightRank = this.rank[rightRoot]!;
    if (leftRank < rightRank) {
      [leftRoot, rightRoot] = [rightRoot, leftRoot];
    }
    this.parent[rightRoot] = leftRoot;
    if (leftRank === rightRank) this.rank[leftRoot] = leftRank + 1;
  }
}

function collectCandidates(
  relays: readonly NormalizedRelay[],
  spatialHash: RelaySpatialHash,
): RelayCandidate[] {
  const candidates: RelayCandidate[] = [];
  let activeRelay: NormalizedRelay | undefined;
  const visitCandidate = (other: NormalizedRelay): void => {
    if (!activeRelay || other.id <= activeRelay.id) return;
    const deltaX = other.x - activeRelay.x;
    const deltaY = other.y - activeRelay.y;
    // The axis checks avoid overflow when two finite centers are extremely
    // far apart. Squaring only occurs after both deltas are reach-bounded.
    if (
      !withinInclusiveNumericLimit(
        Math.abs(deltaX),
        POWER_CABLE_REACH_TILES,
        POWER_LINEAR_BOUNDARY_TOLERANCE,
      )
      || !withinInclusiveNumericLimit(
        Math.abs(deltaY),
        POWER_CABLE_REACH_TILES,
        POWER_LINEAR_BOUNDARY_TOLERANCE,
      )
    ) {
      return;
    }
    const distanceSquared = canonicalZero(
      deltaX * deltaX + deltaY * deltaY,
    );
    if (
      !withinInclusiveNumericLimit(
        distanceSquared,
        POWER_CABLE_REACH_SQUARED,
        POWER_SQUARED_BOUNDARY_TOLERANCE,
      )
    ) {
      return;
    }
    candidates.push({
      relayAId: activeRelay.id,
      relayBId: other.id,
      relayAIndex: activeRelay.index,
      relayBIndex: other.index,
      distanceSquared,
    });
  };
  for (const currentRelay of relays) {
    // Reuse one synchronous visitor rather than allocate per-relay closures.
    // The spatial hash never retains or re-enters the callback.
    activeRelay = currentRelay;
    spatialHash.forEachInAxisAlignedRange(
      currentRelay.x,
      currentRelay.y,
      POWER_CABLE_REACH_TILES,
      visitCandidate,
    );
  }
  candidates.sort(compareCandidate);
  return candidates;
}

function createsTriangle(
  leftNeighbors: ReadonlySet<number>,
  rightNeighbors: ReadonlySet<number>,
): boolean {
  const [smaller, larger] = leftNeighbors.size <= rightNeighbors.size
    ? [leftNeighbors, rightNeighbors]
    : [rightNeighbors, leftNeighbors];
  for (const neighbor of smaller) {
    if (larger.has(neighbor)) return true;
  }
  return false;
}

function freezeEntry<Value>(
  id: number,
  value: Value,
): readonly [number, Value] {
  return Object.freeze([id, value]) as readonly [number, Value];
}

function freezeIdMap<Value>(
  entries: (readonly [number, Value])[],
): CanonicalIdMap<Value> {
  return Object.freeze(entries);
}

function freezeMutableNumberMap(
  entries: MutableDispatchOutput[],
): CanonicalIdMap<number> {
  for (const entry of entries) Object.freeze(entry);
  return Object.freeze(entries) as CanonicalIdMap<number>;
}

function freezeNumberArray(values: number[]): readonly number[] {
  return Object.freeze(values);
}

/**
 * Rebuilds the complete relay topology and participant assignments.
 *
 * IDs share one namespace: duplicates within or across relays/participants
 * throw before any result becomes observable. Supply coverage is an inclusive
 * axis-aligned square that intersects a participant's occupied tile centers.
 * Cable reach is an inclusive Euclidean radius.
 */
export function rebuildPowerTopology(
  relayInputs: readonly PowerRelayNode[],
  participantInputs: readonly PowerParticipant[],
): PowerTopology {
  const { relays, participants } = normalizeInputs(
    relayInputs,
    participantInputs,
  );
  const spatialHash = new RelaySpatialHash(
    relays,
    POWER_CABLE_REACH_TILES,
  );
  const candidates = collectCandidates(relays, spatialHash);
  const adjacency = new Array<Set<number>>(relays.length);
  for (let index = 0; index < relays.length; index += 1) {
    adjacency[index] = new Set();
  }

  const unionFind = new UnionFind(relays.length);
  const degree = new Uint8Array(relays.length);
  const selected: RelayCandidate[] = [];
  const selectedCandidates = new Set<RelayCandidate>();
  const addSelected = (candidate: RelayCandidate): void => {
    const leftIndex = candidate.relayAIndex;
    const rightIndex = candidate.relayBIndex;
    selected.push(candidate);
    selectedCandidates.add(candidate);
    degree[leftIndex] = degree[leftIndex]! + 1;
    degree[rightIndex] = degree[rightIndex]! + 1;
    adjacency[leftIndex]!.add(candidate.relayBId);
    adjacency[rightIndex]!.add(candidate.relayAId);
  };

  // Degree-constrained Kruskal: all connectivity edges are selected before
  // optional cycles, so a short decorative cycle can never consume a bridge's
  // link budget.
  for (const candidate of candidates) {
    const leftIndex = candidate.relayAIndex;
    const rightIndex = candidate.relayBIndex;
    if (unionFind.find(leftIndex) === unionFind.find(rightIndex)) continue;
    if (
      degree[leftIndex]! >= POWER_MAX_LINKS_PER_RELAY
      || degree[rightIndex]! >= POWER_MAX_LINKS_PER_RELAY
    ) {
      continue;
    }
    addSelected(candidate);
    unionFind.union(leftIndex, rightIndex);
  }

  // Add deterministic, useful redundancy only inside an already connected
  // component. A shared neighbor would close a three-edge triangle, which is
  // intentionally forbidden.
  for (const candidate of candidates) {
    if (selectedCandidates.has(candidate)) continue;
    const leftIndex = candidate.relayAIndex;
    const rightIndex = candidate.relayBIndex;
    if (unionFind.find(leftIndex) !== unionFind.find(rightIndex)) continue;
    if (
      degree[leftIndex]! >= POWER_MAX_LINKS_PER_RELAY
      || degree[rightIndex]! >= POWER_MAX_LINKS_PER_RELAY
    ) {
      continue;
    }
    const leftNeighbors = adjacency[leftIndex]!;
    const rightNeighbors = adjacency[rightIndex]!;
    if (createsTriangle(leftNeighbors, rightNeighbors)) continue;
    addSelected(candidate);
  }

  selected.sort(compareCandidate);
  const mutableLinks = new Array<PowerRelayLink>(selected.length);
  for (let index = 0; index < selected.length; index += 1) {
    const candidate = selected[index]!;
    mutableLinks[index] = Object.freeze({
      relayAId: candidate.relayAId,
      relayBId: candidate.relayBId,
      distanceSquared: candidate.distanceSquared,
    });
  }
  const links = Object.freeze(mutableLinks);

  const minimumIdByRoot = new Map<number, number>();
  for (let index = 0; index < relays.length; index += 1) {
    const root = unionFind.find(index);
    const relayId = relays[index]!.id;
    const current = minimumIdByRoot.get(root);
    if (current === undefined || relayId < current) {
      minimumIdByRoot.set(root, relayId);
    }
  }

  const relayToNetworkEntries: (readonly [number, number])[] = [];
  const networkByRelayId = new Map<number, number>();
  const componentRelays = new Map<number, number[]>();
  for (let index = 0; index < relays.length; index += 1) {
    const relayId = relays[index]!.id;
    const networkId = minimumIdByRoot.get(unionFind.find(index));
    if (networkId === undefined) {
      throw new Error("Internal relay component is missing a network id.");
    }
    networkByRelayId.set(relayId, networkId);
    relayToNetworkEntries.push(freezeEntry(relayId, networkId));
    const component = componentRelays.get(networkId);
    if (component) component.push(relayId);
    else componentRelays.set(networkId, [relayId]);
  }

  const componentLinks = new Map<
    number,
    (readonly [number, number])[]
  >();
  for (const link of links) {
    const networkId = networkByRelayId.get(link.relayAId);
    if (networkId === undefined) {
      throw new Error("Internal relay link is missing a network id.");
    }
    const pair = Object.freeze([
      link.relayAId,
      link.relayBId,
    ]) as readonly [number, number];
    const existing = componentLinks.get(networkId);
    if (existing) existing.push(pair);
    else componentLinks.set(networkId, [pair]);
  }

  const sortedComponentEntries = [...componentRelays.entries()]
    .sort(([left], [right]) => compareNumber(left, right));
  const mutableComponents = new Array<PowerTopologyComponent>(
    sortedComponentEntries.length,
  );
  for (let index = 0; index < sortedComponentEntries.length; index += 1) {
    const [networkId, relayIds] = sortedComponentEntries[index]!;
    mutableComponents[index] = Object.freeze({
      networkId,
      relayIds: freezeNumberArray(relayIds),
      links: Object.freeze(componentLinks.get(networkId) ?? []),
    });
  }
  const components = Object.freeze(mutableComponents);

  const participantRoleEntries = new Array<
    readonly [number, PowerParticipantRole]
  >(participants.ids.length);
  const participantToRelayEntries = new Array<
    readonly [number, number | null]
  >(participants.ids.length);
  const participantToNetworkEntries = new Array<
    readonly [number, number | null]
  >(participants.ids.length);
  for (
    let canonicalIndex = 0;
    canonicalIndex < participants.ids.length;
    canonicalIndex += 1
  ) {
    const participantIndex = participants.canonicalOrder === null
      ? canonicalIndex
      : participants.canonicalOrder[canonicalIndex]!;
    const participantId = participants.ids[participantIndex]!;
    const participantRole = participants.roles[participantIndex]!;
    participantRoleEntries[canonicalIndex] =
      freezeEntry(participantId, participantRole);
    const closestRelayId = participantRole === "passive"
      ? null
      : spatialHash.closestSupplyRelayId(
        participants.xs[participantIndex]!,
        participants.ys[participantIndex]!,
        participants.coverageHalfWidths[participantIndex]!,
        participants.coverageHalfHeights[participantIndex]!,
      );
    const networkId = closestRelayId === null
      ? null
      : networkByRelayId.get(closestRelayId) ?? null;
    participantToRelayEntries[canonicalIndex] =
      freezeEntry(participantId, closestRelayId);
    participantToNetworkEntries[canonicalIndex] =
      freezeEntry(participantId, networkId);
  }

  const relayAdjacencyEntries = new Array<
    readonly [number, readonly number[]]
  >(relays.length);
  for (let index = 0; index < relays.length; index += 1) {
    const relay = relays[index]!;
    const neighbors = [...adjacency[index]!].sort(compareNumber);
    relayAdjacencyEntries[index] =
      freezeEntry(relay.id, freezeNumberArray(neighbors));
  }

  return Object.freeze({
    links,
    relayAdjacency: freezeIdMap(relayAdjacencyEntries),
    relayToNetwork: freezeIdMap(relayToNetworkEntries),
    participantRoles: freezeIdMap(participantRoleEntries),
    participantToRelay: freezeIdMap(participantToRelayEntries),
    participantToNetwork: freezeIdMap(participantToNetworkEntries),
    components,
    candidatePairCount: candidates.length,
  });
}

/**
 * Allocates available generation without mutating the topology or inputs.
 *
 * The participant ID set and roles must match the topology. Demand/capacity
 * may change between dispatches. Rebuild topology after positions or roles
 * change.
 */
export function dispatchPower(
  topology: PowerTopology,
  participantInputs: readonly PowerParticipant[],
): PowerDispatch {
  if (typeof topology !== "object" || topology === null) {
    throw new TypeError("Power topology must be an object.");
  }
  const participants = normalizeDispatchParticipants(participantInputs);
  if (
    topology.participantRoles.length !== participants.length
    || topology.participantToRelay.length !== participants.length
    || topology.participantToNetwork.length !== participants.length
  ) {
    throw new Error(
      "Power dispatch participant set does not match the topology.",
    );
  }

  const accumulators = new Map<number, NetworkAccumulator>();
  for (const component of topology.components) {
    assertPositiveSafeId(component.networkId, "Power network id");
    if (accumulators.has(component.networkId)) {
      throw new Error(`Duplicate power network id ${component.networkId}.`);
    }
    accumulators.set(component.networkId, {
      networkId: component.networkId,
      demand: 0,
      availableCapacity: 0,
      consumerOutputIndices: [],
      generators: [],
    });
  }

  const consumerOutputs: MutableDispatchOutput[] = [];
  const generatorOutputs: MutableDispatchOutput[] = [];
  let totalDemand = 0;
  let totalGeneratorCapacity = 0;
  let disconnectedDemand = 0;
  let disconnectedGeneratorCapacity = 0;
  for (let participantIndex = 0;
    participantIndex < participants.length;
    participantIndex += 1) {
    const participant = participants[participantIndex]!;
    const roleEntry = topology.participantRoles[participantIndex];
    const relayEntry = topology.participantToRelay[participantIndex];
    const networkEntry = topology.participantToNetwork[participantIndex];
    if (
      !roleEntry
      || !relayEntry
      || !networkEntry
      || roleEntry[0] !== participant.id
      || relayEntry[0] !== participant.id
      || networkEntry[0] !== participant.id
      || roleEntry[1] !== participant.role
    ) {
      throw new Error(
        "Power dispatch participant set or roles do not match the topology.",
      );
    }
    const networkId = networkEntry[1];
    if (participant.role === "consumer") {
      const demand = canonicalZero(participant.demand);
      const outputIndex = consumerOutputs.length;
      consumerOutputs.push([participant.id, 0]);
      totalDemand = safeAdd(
        totalDemand,
        demand,
        "Total power demand",
      );
      if (networkId === null) {
        disconnectedDemand = safeAdd(
          disconnectedDemand,
          demand,
          "Disconnected power demand",
        );
        continue;
      }
      const accumulator = accumulators.get(networkId);
      if (!accumulator) {
        throw new Error(
          `Participant ${participant.id} references unknown network ${networkId}.`,
        );
      }
      accumulator.demand = safeAdd(
        accumulator.demand,
        demand,
        `Power network ${networkId} demand`,
      );
      accumulator.consumerOutputIndices.push(outputIndex);
    } else if (participant.role === "generator") {
      const capacity = canonicalZero(participant.capacity);
      const outputIndex = generatorOutputs.length;
      generatorOutputs.push([participant.id, 0]);
      totalGeneratorCapacity = safeAdd(
        totalGeneratorCapacity,
        capacity,
        "Total generator capacity",
      );
      if (networkId === null) {
        disconnectedGeneratorCapacity = safeAdd(
          disconnectedGeneratorCapacity,
          capacity,
          "Disconnected generator capacity",
        );
        continue;
      }
      const accumulator = accumulators.get(networkId);
      if (!accumulator) {
        throw new Error(
          `Participant ${participant.id} references unknown network ${networkId}.`,
        );
      }
      accumulator.availableCapacity = safeAdd(
        accumulator.availableCapacity,
        capacity,
        `Power network ${networkId} capacity`,
      );
      accumulator.generators.push({
        id: participant.id,
        capacity,
        outputIndex,
      });
    }
  }

  const networkRows: PowerNetworkDispatch[] = [];
  let totalUsedCapacity = 0;
  for (const component of topology.components) {
    const accumulator = accumulators.get(component.networkId)!;
    const usedCapacity = canonicalZero(
      Math.min(
        accumulator.demand,
        accumulator.availableCapacity,
      ),
    );
    const satisfaction = accumulator.demand === 0
      ? 1
      : demandIsNumericallySatisfied(usedCapacity, accumulator.demand)
        ? 1
        : canonicalZero(usedCapacity / accumulator.demand);
    for (const outputIndex of accumulator.consumerOutputIndices) {
      consumerOutputs[outputIndex]![1] = satisfaction;
    }

    let remaining = usedCapacity;
    // Participants are normalized once into ascending ID order, so each
    // network's filtered generator list is already canonical.
    for (const generator of accumulator.generators) {
      const output = canonicalZero(
        Math.min(generator.capacity, remaining),
      );
      generatorOutputs[generator.outputIndex]![1] = output;
      remaining = canonicalZero(Math.max(0, remaining - output));
    }
    totalUsedCapacity = safeAdd(
      totalUsedCapacity,
      usedCapacity,
      "Total used generator capacity",
    );
    networkRows.push(Object.freeze({
      networkId: component.networkId,
      demand: accumulator.demand,
      availableCapacity: accumulator.availableCapacity,
      usedCapacity,
      satisfaction,
    }));
  }

  return Object.freeze({
    networks: Object.freeze(networkRows),
    consumerSatisfaction: freezeMutableNumberMap(consumerOutputs),
    generatorOutput: freezeMutableNumberMap(generatorOutputs),
    totalDemand,
    totalGeneratorCapacity,
    totalUsedCapacity,
    disconnectedDemand,
    disconnectedGeneratorCapacity,
    globalSatisfaction: totalDemand === 0
      ? 1
      : demandIsNumericallySatisfied(totalUsedCapacity, totalDemand)
        ? 1
        : canonicalZero(totalUsedCapacity / totalDemand),
  });
}

function normalizeDispatchIdentities(
  identityInputs: readonly PowerDispatchParticipantIdentity[],
): readonly PowerDispatchParticipantIdentity[] {
  if (!Array.isArray(identityInputs)) {
    throw new TypeError("Power dispatch identities must be an array.");
  }
  const identityCount = identityInputs.length;
  const identities = new Array<PowerDispatchParticipantIdentity>(
    identityCount,
  );
  for (let index = 0; index < identityCount; index += 1) {
    const identity = identityInputs[index]!;
    if (typeof identity !== "object" || identity === null) {
      throw new TypeError(
        `Power dispatch identity at index ${index} must be an object.`,
      );
    }
    const id = identity.id;
    assertPositiveSafeId(
      id,
      `Power dispatch identity id at index ${index}`,
    );
    const role = identity.role;
    if (
      role !== "generator"
      && role !== "consumer"
      && role !== "passive"
    ) {
      throw new TypeError(`Power dispatch identity ${id} has an invalid role.`);
    }
    identities[index] = { id, role };
  }
  const seenIds = new Set<number>();
  for (const identity of identities) {
    if (seenIds.has(identity.id)) {
      throw new Error(`Duplicate power dispatch identity id ${identity.id}.`);
    }
    seenIds.add(identity.id);
  }
  sortByAscendingIdIfNeeded(identities);
  return identities;
}

/**
 * Prepares immutable participant/network indices after topology or roles
 * change. Input order is accepted but detached and canonicalized by ID.
 */
export function preparePowerDispatch(
  topology: PowerTopology,
  identityInputs: readonly PowerDispatchParticipantIdentity[],
): PreparedPowerDispatchPlan {
  if (typeof topology !== "object" || topology === null) {
    throw new TypeError("Power topology must be an object.");
  }
  const identities = normalizeDispatchIdentities(identityInputs);
  if (
    topology.participantRoles.length !== identities.length
    || topology.participantToRelay.length !== identities.length
    || topology.participantToNetwork.length !== identities.length
  ) {
    throw new Error(
      "Prepared dispatch identities do not match the topology.",
    );
  }

  const networkIds: number[] = [];
  const networkIndexById = new Map<number, number>();
  let previousNetworkId = 0;
  for (let index = 0; index < topology.components.length; index += 1) {
    const networkId = topology.components[index]!.networkId;
    assertPositiveSafeId(networkId, "Prepared power network id");
    if (
      networkIndexById.has(networkId)
      || (index > 0 && networkId <= previousNetworkId)
    ) {
      throw new Error(
        "Prepared power topology has duplicate or noncanonical networks.",
      );
    }
    previousNetworkId = networkId;
    networkIndexById.set(networkId, index);
    networkIds.push(networkId);
  }

  const networkByRelayId = new Map<number, number>();
  for (const [relayId, networkId] of topology.relayToNetwork) {
    assertPositiveSafeId(relayId, "Prepared relay id");
    assertPositiveSafeId(networkId, "Prepared relay network id");
    if (
      networkByRelayId.has(relayId)
      || !networkIndexById.has(networkId)
    ) {
      throw new Error("Prepared power topology has invalid relay mappings.");
    }
    networkByRelayId.set(relayId, networkId);
  }

  const participantIds: number[] = [];
  const participantRoles: PowerParticipantRole[] = [];
  const consumerIds: number[] = [];
  const consumerNetworkIndices: number[] = [];
  const generatorIds: number[] = [];
  const generatorNetworkIndices: number[] = [];
  for (let index = 0; index < identities.length; index += 1) {
    const identity = identities[index]!;
    const roleEntry = topology.participantRoles[index];
    const relayEntry = topology.participantToRelay[index];
    const networkEntry = topology.participantToNetwork[index];
    if (
      !roleEntry
      || !relayEntry
      || !networkEntry
      || roleEntry[0] !== identity.id
      || relayEntry[0] !== identity.id
      || networkEntry[0] !== identity.id
      || roleEntry[1] !== identity.role
    ) {
      throw new Error(
        "Prepared dispatch identities or roles do not match the topology.",
      );
    }
    const relayId = relayEntry[1];
    const networkId = networkEntry[1];
    if ((relayId === null) !== (networkId === null)) {
      throw new Error(
        `Prepared participant ${identity.id} has inconsistent assignment.`,
      );
    }
    let networkIndex = -1;
    if (relayId !== null && networkId !== null) {
      if (
        networkByRelayId.get(relayId) !== networkId
        || !networkIndexById.has(networkId)
      ) {
        throw new Error(
          `Prepared participant ${identity.id} has an invalid assignment.`,
        );
      }
      networkIndex = networkIndexById.get(networkId)!;
    }
    if (identity.role === "passive" && networkIndex !== -1) {
      throw new Error(
        `Prepared passive participant ${identity.id} cannot be assigned.`,
      );
    }

    participantIds.push(identity.id);
    participantRoles.push(identity.role);
    if (identity.role === "consumer") {
      consumerIds.push(identity.id);
      consumerNetworkIndices.push(networkIndex);
    } else if (identity.role === "generator") {
      generatorIds.push(identity.id);
      generatorNetworkIndices.push(networkIndex);
    }
  }

  const plan = OBJECT_FREEZE({
    participantIds: OBJECT_FREEZE(participantIds),
    participantRoles: OBJECT_FREEZE(participantRoles),
    networkIds: OBJECT_FREEZE(networkIds),
    consumerIds: OBJECT_FREEZE(consumerIds),
    consumerNetworkIndices: OBJECT_FREEZE(consumerNetworkIndices),
    generatorIds: OBJECT_FREEZE(generatorIds),
    generatorNetworkIndices: OBJECT_FREEZE(generatorNetworkIndices),
  });
  const token = OBJECT_FREEZE({});
  trustedWeakMapSet(preparedPlanTokens, plan, token);
  return plan;
}

function preparedPlanToken(plan: PreparedPowerDispatchPlan): object {
  if (typeof plan !== "object" || plan === null) {
    throw new TypeError("Prepared power dispatch plan must be an object.");
  }
  const token = trustedWeakMapGet(preparedPlanTokens, plan);
  if (!token) {
    throw new Error(
      "Power dispatch plan was not created by preparePowerDispatch.",
    );
  }
  return token;
}

/**
 * Allocates one reusable workspace for a prepared plan.
 */
export function createPowerDispatchWorkspace(
  plan: PreparedPowerDispatchPlan,
): PreparedPowerDispatchWorkspace {
  const planToken = preparedPlanToken(plan);
  const networkDemand =
    new FLOAT64_ARRAY_CONSTRUCTOR(plan.networkIds.length);
  const networkAvailableCapacity =
    new FLOAT64_ARRAY_CONSTRUCTOR(plan.networkIds.length);
  const networkUsedCapacity =
    new FLOAT64_ARRAY_CONSTRUCTOR(plan.networkIds.length);
  const networkSatisfaction =
    new FLOAT64_ARRAY_CONSTRUCTOR(plan.networkIds.length);
  FLOAT64_ARRAY_FILL_CALL(networkSatisfaction, 1);
  const consumerSatisfaction =
    new FLOAT64_ARRAY_CONSTRUCTOR(plan.consumerIds.length);
  const generatorOutput =
    new FLOAT64_ARRAY_CONSTRUCTOR(plan.generatorIds.length);
  const stagedConsumerDemand =
    new FLOAT64_ARRAY_CONSTRUCTOR(plan.consumerIds.length);
  const stagedGeneratorCapacity =
    new FLOAT64_ARRAY_CONSTRUCTOR(plan.generatorIds.length);
  const stagedNetworkDemand =
    new FLOAT64_ARRAY_CONSTRUCTOR(plan.networkIds.length);
  const stagedNetworkAvailableCapacity =
    new FLOAT64_ARRAY_CONSTRUCTOR(plan.networkIds.length);
  const stagedNetworkUsedCapacity =
    new FLOAT64_ARRAY_CONSTRUCTOR(plan.networkIds.length);
  const stagedNetworkSatisfaction =
    new FLOAT64_ARRAY_CONSTRUCTOR(plan.networkIds.length);
  const stagedConsumerSatisfaction =
    new FLOAT64_ARRAY_CONSTRUCTOR(plan.consumerIds.length);
  const stagedGeneratorOutput =
    new FLOAT64_ARRAY_CONSTRUCTOR(plan.generatorIds.length);
  const remainingGeneratorDemand =
    new FLOAT64_ARRAY_CONSTRUCTOR(plan.networkIds.length);
  const workspace: PreparedPowerDispatchWorkspace = {
    networkDemand,
    networkAvailableCapacity,
    networkUsedCapacity,
    networkSatisfaction,
    consumerSatisfaction,
    generatorOutput,
    totalDemand: 0,
    totalGeneratorCapacity: 0,
    totalUsedCapacity: 0,
    disconnectedDemand: 0,
    disconnectedGeneratorCapacity: 0,
    globalSatisfaction: 1,
  };
  const internal: PreparedWorkspaceInternal = OBJECT_FREEZE({
    planToken,
    workspacePrototype: OBJECT_GET_PROTOTYPE_OF(workspace),
    networkCount: plan.networkIds.length,
    consumerCount: plan.consumerIds.length,
    generatorCount: plan.generatorIds.length,
    networkDemand,
    networkDemandBuffer: TYPED_ARRAY_BUFFER_GET(networkDemand),
    networkAvailableCapacity,
    networkAvailableCapacityBuffer:
      TYPED_ARRAY_BUFFER_GET(networkAvailableCapacity),
    networkUsedCapacity,
    networkUsedCapacityBuffer:
      TYPED_ARRAY_BUFFER_GET(networkUsedCapacity),
    networkSatisfaction,
    networkSatisfactionBuffer:
      TYPED_ARRAY_BUFFER_GET(networkSatisfaction),
    consumerSatisfaction,
    consumerSatisfactionBuffer:
      TYPED_ARRAY_BUFFER_GET(consumerSatisfaction),
    generatorOutput,
    generatorOutputBuffer:
      TYPED_ARRAY_BUFFER_GET(generatorOutput),
    stagedConsumerDemand,
    stagedConsumerDemandBuffer:
      TYPED_ARRAY_BUFFER_GET(stagedConsumerDemand),
    stagedGeneratorCapacity,
    stagedGeneratorCapacityBuffer:
      TYPED_ARRAY_BUFFER_GET(stagedGeneratorCapacity),
    stagedNetworkDemand,
    stagedNetworkDemandBuffer:
      TYPED_ARRAY_BUFFER_GET(stagedNetworkDemand),
    stagedNetworkAvailableCapacity,
    stagedNetworkAvailableCapacityBuffer:
      TYPED_ARRAY_BUFFER_GET(stagedNetworkAvailableCapacity),
    stagedNetworkUsedCapacity,
    stagedNetworkUsedCapacityBuffer:
      TYPED_ARRAY_BUFFER_GET(stagedNetworkUsedCapacity),
    stagedNetworkSatisfaction,
    stagedNetworkSatisfactionBuffer:
      TYPED_ARRAY_BUFFER_GET(stagedNetworkSatisfaction),
    stagedConsumerSatisfaction,
    stagedConsumerSatisfactionBuffer:
      TYPED_ARRAY_BUFFER_GET(stagedConsumerSatisfaction),
    stagedGeneratorOutput,
    stagedGeneratorOutputBuffer:
      TYPED_ARRAY_BUFFER_GET(stagedGeneratorOutput),
    remainingGeneratorDemand,
    remainingGeneratorDemandBuffer:
      TYPED_ARRAY_BUFFER_GET(remainingGeneratorDemand),
  });
  trustedWeakMapSet(preparedWorkspaceInternals, workspace, internal);
  return workspace;
}

function assertPreparedScalarArray(
  values: ArrayLike<number>,
  expectedLength: number,
  label: string,
): void {
  if (
    (typeof values !== "object" && typeof values !== "function")
    || values === null
  ) {
    throw new TypeError(`${label} must be an array-like numeric collection.`);
  }
  const length = values.length;
  if (
    !Number.isSafeInteger(length)
    || length !== expectedLength
  ) {
    throw new RangeError(
      `${label} length must exactly match its prepared plan slots.`,
    );
  }
}

function assertTrustedFloat64Array(
  value: Float64Array,
  expectedBuffer: ArrayBufferLike,
  expectedLength: number,
  label: string,
): void {
  let actualLength: number;
  let actualByteLength: number;
  let actualByteOffset: number;
  let actualBuffer: ArrayBufferLike;
  let actualBufferByteLength: number;
  try {
    if (OBJECT_GET_PROTOTYPE_OF(value) !== FLOAT64_ARRAY_PROTOTYPE) {
      throw new Error("wrong prototype");
    }
    actualLength = TYPED_ARRAY_LENGTH_GET(value);
    actualByteLength = TYPED_ARRAY_BYTE_LENGTH_GET(value);
    actualByteOffset = TYPED_ARRAY_BYTE_OFFSET_GET(value);
    actualBuffer = TYPED_ARRAY_BUFFER_GET(value);
    actualBufferByteLength = ARRAY_BUFFER_BYTE_LENGTH_GET(actualBuffer);
  } catch {
    throw new Error(`${label} is not a live trusted Float64Array.`);
  }
  const expectedByteLength = expectedLength
    * FLOAT64_ARRAY_BYTES_PER_ELEMENT;
  if (
    actualBuffer !== expectedBuffer
    || actualLength !== expectedLength
    || actualByteLength !== expectedByteLength
    || actualByteOffset !== 0
    || actualBufferByteLength !== expectedByteLength
  ) {
    throw new Error(
      `${label} has a detached, resized, or mismatched buffer.`,
    );
  }
}

function assertOwnWritableDataProperty(
  workspace: PreparedPowerDispatchWorkspace,
  property: keyof PreparedPowerDispatchWorkspace,
  expectedValue?: unknown,
): void {
  const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
    workspace,
    property,
  );
  if (
    !descriptor
    || !("value" in descriptor)
    || descriptor.writable !== true
    || descriptor.enumerable !== true
    || descriptor.configurable !== true
    || (
      arguments.length >= 3
      && descriptor.value !== expectedValue
    )
  ) {
    throw new Error(
      `Prepared power dispatch workspace property ${property} was redefined.`,
    );
  }
}

function assertWorkspaceIntegrity(
  workspace: PreparedPowerDispatchWorkspace,
  internal: PreparedWorkspaceInternal,
): void {
  if (
    !OBJECT_IS_EXTENSIBLE(workspace)
    || OBJECT_GET_PROTOTYPE_OF(workspace) !== internal.workspacePrototype
  ) {
    throw new Error(
      "Prepared power dispatch workspace was frozen, sealed, or re-prototyped.",
    );
  }

  assertOwnWritableDataProperty(
    workspace,
    "networkDemand",
    internal.networkDemand,
  );
  assertOwnWritableDataProperty(
    workspace,
    "networkAvailableCapacity",
    internal.networkAvailableCapacity,
  );
  assertOwnWritableDataProperty(
    workspace,
    "networkUsedCapacity",
    internal.networkUsedCapacity,
  );
  assertOwnWritableDataProperty(
    workspace,
    "networkSatisfaction",
    internal.networkSatisfaction,
  );
  assertOwnWritableDataProperty(
    workspace,
    "consumerSatisfaction",
    internal.consumerSatisfaction,
  );
  assertOwnWritableDataProperty(
    workspace,
    "generatorOutput",
    internal.generatorOutput,
  );
  assertOwnWritableDataProperty(workspace, "totalDemand");
  assertOwnWritableDataProperty(workspace, "totalGeneratorCapacity");
  assertOwnWritableDataProperty(workspace, "totalUsedCapacity");
  assertOwnWritableDataProperty(workspace, "disconnectedDemand");
  assertOwnWritableDataProperty(
    workspace,
    "disconnectedGeneratorCapacity",
  );
  assertOwnWritableDataProperty(workspace, "globalSatisfaction");

  assertTrustedFloat64Array(
    internal.networkDemand,
    internal.networkDemandBuffer,
    internal.networkCount,
    "Prepared workspace networkDemand",
  );
  assertTrustedFloat64Array(
    internal.networkAvailableCapacity,
    internal.networkAvailableCapacityBuffer,
    internal.networkCount,
    "Prepared workspace networkAvailableCapacity",
  );
  assertTrustedFloat64Array(
    internal.networkUsedCapacity,
    internal.networkUsedCapacityBuffer,
    internal.networkCount,
    "Prepared workspace networkUsedCapacity",
  );
  assertTrustedFloat64Array(
    internal.networkSatisfaction,
    internal.networkSatisfactionBuffer,
    internal.networkCount,
    "Prepared workspace networkSatisfaction",
  );
  assertTrustedFloat64Array(
    internal.consumerSatisfaction,
    internal.consumerSatisfactionBuffer,
    internal.consumerCount,
    "Prepared workspace consumerSatisfaction",
  );
  assertTrustedFloat64Array(
    internal.generatorOutput,
    internal.generatorOutputBuffer,
    internal.generatorCount,
    "Prepared workspace generatorOutput",
  );
  assertTrustedFloat64Array(
    internal.stagedConsumerDemand,
    internal.stagedConsumerDemandBuffer,
    internal.consumerCount,
    "Prepared private stagedConsumerDemand",
  );
  assertTrustedFloat64Array(
    internal.stagedGeneratorCapacity,
    internal.stagedGeneratorCapacityBuffer,
    internal.generatorCount,
    "Prepared private stagedGeneratorCapacity",
  );
  assertTrustedFloat64Array(
    internal.stagedNetworkDemand,
    internal.stagedNetworkDemandBuffer,
    internal.networkCount,
    "Prepared private stagedNetworkDemand",
  );
  assertTrustedFloat64Array(
    internal.stagedNetworkAvailableCapacity,
    internal.stagedNetworkAvailableCapacityBuffer,
    internal.networkCount,
    "Prepared private stagedNetworkAvailableCapacity",
  );
  assertTrustedFloat64Array(
    internal.stagedNetworkUsedCapacity,
    internal.stagedNetworkUsedCapacityBuffer,
    internal.networkCount,
    "Prepared private stagedNetworkUsedCapacity",
  );
  assertTrustedFloat64Array(
    internal.stagedNetworkSatisfaction,
    internal.stagedNetworkSatisfactionBuffer,
    internal.networkCount,
    "Prepared private stagedNetworkSatisfaction",
  );
  assertTrustedFloat64Array(
    internal.stagedConsumerSatisfaction,
    internal.stagedConsumerSatisfactionBuffer,
    internal.consumerCount,
    "Prepared private stagedConsumerSatisfaction",
  );
  assertTrustedFloat64Array(
    internal.stagedGeneratorOutput,
    internal.stagedGeneratorOutputBuffer,
    internal.generatorCount,
    "Prepared private stagedGeneratorOutput",
  );
  assertTrustedFloat64Array(
    internal.remainingGeneratorDemand,
    internal.remainingGeneratorDemandBuffer,
    internal.networkCount,
    "Prepared private remainingGeneratorDemand",
  );
}

/**
 * Validates dynamic scalars and writes a complete dispatch into a caller-owned
 * reusable workspace. Public workspace state is committed only after every
 * validation and overflow preflight succeeds, so failures are atomic.
 */
export function dispatchPreparedPowerInto(
  plan: PreparedPowerDispatchPlan,
  dynamicScalars: PreparedPowerDynamicScalars,
  workspace: PreparedPowerDispatchWorkspace,
): PreparedPowerDispatchWorkspace {
  const planToken = preparedPlanToken(plan);
  if (typeof workspace !== "object" || workspace === null) {
    throw new TypeError("Prepared power dispatch workspace must be an object.");
  }
  const internal = trustedWeakMapGet(
    preparedWorkspaceInternals,
    workspace,
  );
  if (!internal || internal.planToken !== planToken) {
    throw new Error(
      "Prepared power dispatch plan and workspace do not match.",
    );
  }
  assertWorkspaceIntegrity(workspace, internal);
  if (typeof dynamicScalars !== "object" || dynamicScalars === null) {
    throw new TypeError("Prepared power dynamic scalars must be an object.");
  }
  const consumerDemands = dynamicScalars.consumerDemands;
  const generatorCapacities = dynamicScalars.generatorCapacities;
  assertPreparedScalarArray(
    consumerDemands,
    plan.consumerIds.length,
    "Prepared consumerDemands",
  );
  assertPreparedScalarArray(
    generatorCapacities,
    plan.generatorIds.length,
    "Prepared generatorCapacities",
  );

  const stagedNetworkDemand = internal.stagedNetworkDemand;
  const stagedNetworkCapacity = internal.stagedNetworkAvailableCapacity;
  FLOAT64_ARRAY_FILL_CALL(stagedNetworkDemand, 0);
  FLOAT64_ARRAY_FILL_CALL(stagedNetworkCapacity, 0);
  let totalDemand = 0;
  let totalGeneratorCapacity = 0;
  let disconnectedDemand = 0;
  let disconnectedGeneratorCapacity = 0;
  for (let index = 0; index < plan.consumerIds.length; index += 1) {
    const rawDemand = consumerDemands[index];
    assertSafeNonnegativeScalar(rawDemand, "Prepared consumer demand");
    const demand = canonicalZero(rawDemand);
    internal.stagedConsumerDemand[index] = demand;
    totalDemand = safeAdd(
      totalDemand,
      demand,
      "Prepared total power demand",
    );
    const networkIndex = plan.consumerNetworkIndices[index]!;
    if (networkIndex === -1) {
      disconnectedDemand = safeAdd(
        disconnectedDemand,
        demand,
        "Prepared disconnected power demand",
      );
    } else {
      stagedNetworkDemand[networkIndex] = safeAdd(
        stagedNetworkDemand[networkIndex]!,
        demand,
        "Prepared network power demand",
      );
    }
  }
  for (let index = 0; index < plan.generatorIds.length; index += 1) {
    const rawCapacity = generatorCapacities[index];
    assertSafeNonnegativeScalar(rawCapacity, "Prepared generator capacity");
    const capacity = canonicalZero(rawCapacity);
    internal.stagedGeneratorCapacity[index] = capacity;
    totalGeneratorCapacity = safeAdd(
      totalGeneratorCapacity,
      capacity,
      "Prepared total generator capacity",
    );
    const networkIndex = plan.generatorNetworkIndices[index]!;
    if (networkIndex === -1) {
      disconnectedGeneratorCapacity = safeAdd(
        disconnectedGeneratorCapacity,
        capacity,
        "Prepared disconnected generator capacity",
      );
    } else {
      stagedNetworkCapacity[networkIndex] = safeAdd(
        stagedNetworkCapacity[networkIndex]!,
        capacity,
        "Prepared network generator capacity",
      );
    }
  }

  let totalUsedCapacity = 0;
  for (let index = 0; index < plan.networkIds.length; index += 1) {
    const demand = stagedNetworkDemand[index]!;
    const capacity = stagedNetworkCapacity[index]!;
    const usedCapacity = canonicalZero(Math.min(demand, capacity));
    const satisfaction = demand === 0
      ? 1
      : demandIsNumericallySatisfied(usedCapacity, demand)
        ? 1
        : canonicalZero(usedCapacity / demand);
    internal.stagedNetworkUsedCapacity[index] = usedCapacity;
    internal.stagedNetworkSatisfaction[index] = satisfaction;
    internal.remainingGeneratorDemand[index] = usedCapacity;
    totalUsedCapacity = safeAdd(
      totalUsedCapacity,
      usedCapacity,
      "Prepared total used generator capacity",
    );
  }

  for (let index = 0; index < plan.consumerIds.length; index += 1) {
    const networkIndex = plan.consumerNetworkIndices[index]!;
    internal.stagedConsumerSatisfaction[index] = networkIndex === -1
      ? 0
      : internal.stagedNetworkSatisfaction[networkIndex]!;
  }
  for (let index = 0; index < plan.generatorIds.length; index += 1) {
    const networkIndex = plan.generatorNetworkIndices[index]!;
    let output = 0;
    if (networkIndex !== -1) {
      const remaining = internal.remainingGeneratorDemand[networkIndex]!;
      output = canonicalZero(
        Math.min(internal.stagedGeneratorCapacity[index]!, remaining),
      );
      internal.remainingGeneratorDemand[networkIndex] = canonicalZero(
        Math.max(0, remaining - output),
      );
    }
    internal.stagedGeneratorOutput[index] = output;
  }
  const globalSatisfaction = totalDemand === 0
    ? 1
    : demandIsNumericallySatisfied(totalUsedCapacity, totalDemand)
      ? 1
      : canonicalZero(totalUsedCapacity / totalDemand);

  // Dynamic collections may contain arbitrary getters. Revalidate only after
  // every one has run, then commit through captured intrinsics and the private
  // references. From this point onward there are no user callbacks, fallible
  // arithmetic operations, or dynamic property/method lookups.
  assertWorkspaceIntegrity(workspace, internal);
  FLOAT64_ARRAY_SET_CALL(internal.networkDemand, stagedNetworkDemand);
  FLOAT64_ARRAY_SET_CALL(
    internal.networkAvailableCapacity,
    stagedNetworkCapacity,
  );
  FLOAT64_ARRAY_SET_CALL(
    internal.networkUsedCapacity,
    internal.stagedNetworkUsedCapacity,
  );
  FLOAT64_ARRAY_SET_CALL(
    internal.networkSatisfaction,
    internal.stagedNetworkSatisfaction,
  );
  FLOAT64_ARRAY_SET_CALL(
    internal.consumerSatisfaction,
    internal.stagedConsumerSatisfaction,
  );
  FLOAT64_ARRAY_SET_CALL(
    internal.generatorOutput,
    internal.stagedGeneratorOutput,
  );
  workspace.totalDemand = totalDemand;
  workspace.totalGeneratorCapacity = totalGeneratorCapacity;
  workspace.totalUsedCapacity = totalUsedCapacity;
  workspace.disconnectedDemand = disconnectedDemand;
  workspace.disconnectedGeneratorCapacity =
    disconnectedGeneratorCapacity;
  workspace.globalSatisfaction = globalSatisfaction;
  return workspace;
}

/**
 * Stable lightweight fingerprint for canonical topology JSON.
 */
export function canonicalPowerTopologyHash(topology: PowerTopology): string {
  const serialized = JSON.stringify(topology);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash = Math.imul(hash ^ serialized.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function percentile(samples: readonly number[], proportion: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort(compareNumber);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * proportion) - 1),
  );
  return sorted[index]!;
}

function assertBenchmarkCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 10_000) {
    throw new RangeError(`${label} must be a positive safe integer <= 10000.`);
  }
}

/**
 * Optional synchronous benchmark helper. It performs complete validation,
 * topology construction, assignment, and dispatch in every measured sample.
 * No thresholds are enforced because timing assertions are not portable.
 */
export function benchmarkPowerTopology(
  relays: readonly PowerRelayNode[],
  participants: readonly PowerParticipant[],
  options: PowerTopologyBenchmarkOptions = {},
): PowerTopologyBenchmark {
  const warmupSamples = options.warmupSamples ?? 5;
  const sampleCount = options.samples ?? 25;
  assertBenchmarkCount(warmupSamples, "Power benchmark warmupSamples");
  assertBenchmarkCount(sampleCount, "Power benchmark samples");

  let topology = rebuildPowerTopology(relays, participants);
  dispatchPower(topology, participants);
  for (let sample = 0; sample < warmupSamples; sample += 1) {
    topology = rebuildPowerTopology(relays, participants);
    dispatchPower(topology, participants);
  }

  const topologySamples: number[] = [];
  const dispatchSamples: number[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const topologyStart = performance.now();
    topology = rebuildPowerTopology(relays, participants);
    const topologyEnd = performance.now();
    dispatchPower(topology, participants);
    const dispatchEnd = performance.now();
    topologySamples.push(topologyEnd - topologyStart);
    dispatchSamples.push(dispatchEnd - topologyEnd);
  }

  return Object.freeze({
    relayCount: relays.length,
    participantCount: participants.length,
    candidatePairCount: topology.candidatePairCount,
    linkCount: topology.links.length,
    topologyHash: canonicalPowerTopologyHash(topology),
    samples: sampleCount,
    topologyP50Ms: percentile(topologySamples, 0.5),
    topologyP95Ms: percentile(topologySamples, 0.95),
    dispatchP50Ms: percentile(dispatchSamples, 0.5),
    dispatchP95Ms: percentile(dispatchSamples, 0.95),
  });
}

/**
 * Measures the retained immutable dispatch contract beside the reusable
 * prepared path for one already-built topology. Plan, workspace, and scalar
 * slot construction are deliberately outside both timed regions.
 */
export function benchmarkPreparedPowerDispatch(
  topology: PowerTopology,
  participants: readonly PowerParticipant[],
  options: PowerTopologyBenchmarkOptions = {},
): PreparedPowerDispatchBenchmark {
  const warmupSamples = options.warmupSamples ?? 5;
  const sampleCount = options.samples ?? 25;
  assertBenchmarkCount(
    warmupSamples,
    "Prepared power benchmark warmupSamples",
  );
  assertBenchmarkCount(sampleCount, "Prepared power benchmark samples");

  const normalizedParticipants = normalizeDispatchParticipants(participants);
  const identities = new Array<PowerDispatchParticipantIdentity>(
    normalizedParticipants.length,
  );
  const participantById =
    new Map<number, NormalizedDispatchParticipant>();
  for (let index = 0; index < normalizedParticipants.length; index += 1) {
    const participant = normalizedParticipants[index]!;
    identities[index] = {
      id: participant.id,
      role: participant.role,
    };
    participantById.set(participant.id, participant);
  }
  const plan = preparePowerDispatch(
    topology,
    identities,
  );
  const workspace = createPowerDispatchWorkspace(plan);
  const consumerDemands =
    new FLOAT64_ARRAY_CONSTRUCTOR(plan.consumerIds.length);
  for (let index = 0; index < plan.consumerIds.length; index += 1) {
    const participant = participantById.get(plan.consumerIds[index]!);
    if (!participant || participant.role !== "consumer") {
      throw new Error(
        "Prepared benchmark consumer slots do not match participants.",
      );
    }
    consumerDemands[index] = participant.demand;
  }
  const generatorCapacities =
    new FLOAT64_ARRAY_CONSTRUCTOR(plan.generatorIds.length);
  for (let index = 0; index < plan.generatorIds.length; index += 1) {
    const participant = participantById.get(plan.generatorIds[index]!);
    if (!participant || participant.role !== "generator") {
      throw new Error(
        "Prepared benchmark generator slots do not match participants.",
      );
    }
    generatorCapacities[index] = participant.capacity;
  }
  const dynamicScalars = { consumerDemands, generatorCapacities };

  dispatchPower(topology, participants);
  dispatchPreparedPowerInto(plan, dynamicScalars, workspace);
  for (let sample = 0; sample < warmupSamples; sample += 1) {
    dispatchPower(topology, participants);
    dispatchPreparedPowerInto(plan, dynamicScalars, workspace);
  }

  const strictSamples: number[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const startedAt = performance.now();
    dispatchPower(topology, participants);
    strictSamples.push(performance.now() - startedAt);
  }

  // Strict dispatch intentionally allocates its immutable result. Re-warm the
  // allocation-free path before measuring it independently.
  for (let sample = 0; sample < warmupSamples; sample += 1) {
    dispatchPreparedPowerInto(plan, dynamicScalars, workspace);
  }
  const preparedSamples: number[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const startedAt = performance.now();
    dispatchPreparedPowerInto(plan, dynamicScalars, workspace);
    preparedSamples.push(performance.now() - startedAt);
  }

  return Object.freeze({
    relayCount: topology.relayAdjacency.length,
    participantCount: participants.length,
    consumerCount: plan.consumerIds.length,
    generatorCount: plan.generatorIds.length,
    networkCount: plan.networkIds.length,
    topologyHash: canonicalPowerTopologyHash(topology),
    samples: sampleCount,
    strictP50Ms: percentile(strictSamples, 0.5),
    strictP95Ms: percentile(strictSamples, 0.95),
    preparedP50Ms: percentile(preparedSamples, 0.5),
    preparedP95Ms: percentile(preparedSamples, 0.95),
  });
}
