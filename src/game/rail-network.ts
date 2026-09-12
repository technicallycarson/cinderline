/**
 * Standalone deterministic rail and train core.
 *
 * The module intentionally has no dependency on FactorySimulation or the
 * rendering layer. All spatial topology, shortest-path tie breaks, signal
 * arbitration, cargo operations, and save ordering are canonical and depend
 * only on caller-owned stable IDs and tile geometry—not insertion order.
 *
 * Distances, speed, acceleration, fuel, and dwell time are integer fixed-point
 * values. A rail tile is RAIL_DISTANCE_SCALE units long (curves are longer).
 */

export const RAIL_SAVE_VERSION = 1;
export const RAIL_DISTANCE_SCALE = 1_000;
export const RAIL_STRAIGHT_LENGTH = RAIL_DISTANCE_SCALE;
export const RAIL_CURVE_LENGTH = 1_571;
export const RAIL_MAX_SPEED = 120;
export const RAIL_ACCELERATION = 8;
export const RAIL_BRAKING = 18;
export const RAIL_FUEL_PER_MOVING_TICK = 1;

export const RAIL_LIMITS = Object.freeze({
  maxSegments: 16_384,
  maxSignals: 16_384,
  maxStations: 4_096,
  maxTrains: 1_024,
  maxCarsPerTrain: 64,
  maxScheduleStops: 64,
  maxCargoKinds: 128,
  maxIdLength: 64,
  maxCoordinateMagnitude: 1_000_000,
  maxUnits: 1_000_000_000,
  maxTicks: 1_000_000_000,
});

export type RailDirection = "north" | "east" | "south" | "west";
export type RailSegmentKind = "straight" | "curve" | "junction";
export type RailSignalType = "regular" | "chain";
export type RailSignalAspect = "red" | "green" | "chain-clear";
export type RailTrainStatus =
  | "dwelling"
  | "moving"
  | "waiting-signal"
  | "no-path"
  | "out-of-fuel";

export interface RailCargoStack {
  readonly itemId: string;
  readonly count: number;
}

export interface RailSegmentInput {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly kind: RailSegmentKind;
  /** Clockwise quarter turns from the authored base orientation. */
  readonly rotation: 0 | 1 | 2 | 3;
}

export interface RailSignalInput {
  readonly id: string;
  readonly fromSegmentId: string;
  readonly toSegmentId: string;
  readonly type: RailSignalType;
}

export interface RailStationInput {
  readonly id: string;
  readonly segmentId: string;
  readonly capacity: number;
  readonly inventory?: readonly RailCargoStack[];
}

export type RailWaitCondition =
  | { readonly type: "time"; readonly ticks: number }
  | { readonly type: "cargo-empty" }
  | { readonly type: "cargo-full" }
  | {
      readonly type: "item-at-least";
      readonly itemId: string;
      readonly count: number;
    }
  | {
      readonly type: "item-at-most";
      readonly itemId: string;
      readonly count: number;
    };

export interface RailScheduleStop {
  readonly stationId: string;
  readonly wait: RailWaitCondition;
}

export interface RailLocomotiveInput {
  readonly id: string;
  readonly kind: "locomotive";
  readonly fuelCapacityMilli: number;
  readonly fuelMilli: number;
}

export interface RailCargoWagonInput {
  readonly id: string;
  readonly kind: "cargo-wagon";
  readonly capacity: number;
  readonly cargo?: readonly RailCargoStack[];
}

export type RailCarInput = RailLocomotiveInput | RailCargoWagonInput;

export interface RailTrainInput {
  readonly id: string;
  readonly currentSegmentId: string;
  readonly cars: readonly RailCarInput[];
  readonly schedule: readonly RailScheduleStop[];
  readonly scheduleIndex?: number;
}

export interface RailNetworkInput {
  readonly segments: readonly RailSegmentInput[];
  readonly signals?: readonly RailSignalInput[];
  readonly stations: readonly RailStationInput[];
  readonly trains?: readonly RailTrainInput[];
}

export interface RailGraphNode {
  readonly segmentId: string;
  readonly x: number;
  readonly y: number;
  readonly kind: RailSegmentKind;
  readonly rotation: 0 | 1 | 2 | 3;
  readonly ports: readonly RailDirection[];
  readonly blockId: string;
}

export interface RailGraphEdge {
  readonly fromSegmentId: string;
  readonly toSegmentId: string;
  /** Direction from the source tile to the target tile. */
  readonly direction: RailDirection;
  /** Cost of entering and traversing the target tile. */
  readonly costMilli: number;
}

export interface RailBlockSnapshot {
  readonly id: string;
  readonly segmentIds: readonly string[];
}

export interface RailGraph {
  readonly nodes: readonly RailGraphNode[];
  readonly edges: readonly RailGraphEdge[];
  readonly blocks: readonly RailBlockSnapshot[];
}

export interface RailSignalSnapshot extends RailSignalInput {
  readonly downstreamBlockId: string;
  readonly aspect: RailSignalAspect;
}

export interface RailStationSnapshot {
  readonly id: string;
  readonly segmentId: string;
  readonly capacity: number;
  readonly inventory: readonly RailCargoStack[];
  readonly storedUnits: number;
}

export interface RailCarSnapshot {
  readonly id: string;
  readonly kind: "locomotive" | "cargo-wagon";
  readonly capacity: number;
  readonly stored: number;
  readonly cargo: readonly RailCargoStack[];
  readonly fuelCapacityMilli: number;
  readonly fuelMilli: number;
}

export interface RailTrainSnapshot {
  readonly id: string;
  readonly currentSegmentId: string;
  readonly currentBlockId: string;
  readonly progressMilli: number;
  readonly speedMilliPerTick: number;
  readonly status: RailTrainStatus;
  readonly schedule: readonly RailScheduleStop[];
  readonly scheduleIndex: number;
  readonly destinationStationId: string;
  readonly dwellTicks: number;
  /** Deterministic fairness age for an ungranted block request. */
  readonly reservationWaitTicks: number;
  readonly path: readonly string[];
  readonly cars: readonly RailCarSnapshot[];
  readonly cargo: readonly RailCargoStack[];
  readonly cargoUnits: number;
  readonly cargoCapacity: number;
  readonly fuelMilli: number;
  readonly distanceTravelledMilli: number;
}

export interface RailReservationSnapshot {
  readonly blockId: string;
  readonly trainId: string;
  readonly kind: "occupied" | "reserved";
}

export interface RailNetworkSnapshot {
  readonly tick: number;
  readonly topologyRevision: number;
  readonly graph: RailGraph;
  readonly signals: readonly RailSignalSnapshot[];
  readonly stations: readonly RailStationSnapshot[];
  readonly trains: readonly RailTrainSnapshot[];
  readonly reservations: readonly RailReservationSnapshot[];
}

export type RailEvent =
  | {
      readonly type: "train-departed";
      readonly tick: number;
      readonly trainId: string;
      readonly stationId: string;
    }
  | {
      readonly type: "train-arrived";
      readonly tick: number;
      readonly trainId: string;
      readonly stationId: string;
    }
  | {
      readonly type: "cargo-transferred";
      readonly tick: number;
      readonly trainId: string;
      readonly stationId: string;
      readonly wagonId: string;
      readonly itemId: string;
      /** Positive loads a wagon, negative unloads it. */
      readonly amount: number;
    }
  | {
      readonly type: "path-lost" | "path-restored";
      readonly tick: number;
      readonly trainId: string;
    }
  | {
      readonly type: "fuel-exhausted";
      readonly tick: number;
      readonly trainId: string;
    }
  | {
      readonly type: "topology-changed";
      readonly tick: number;
      readonly revision: number;
    };

export interface RailStepResult {
  readonly tick: number;
  readonly events: readonly RailEvent[];
  readonly snapshot: RailNetworkSnapshot;
}

export interface RailTransferIntent {
  readonly wagonId: string;
  readonly itemId: string;
  /**
   * Positive loads from station inventory into the wagon; negative unloads
   * from the wagon into station inventory.
   */
  readonly amount: number;
}

export interface RailStationTransferContext {
  readonly tick: number;
  readonly trainId: string;
  readonly station: RailStationSnapshot;
  readonly cars: readonly RailCarSnapshot[];
  readonly cargo: readonly RailCargoStack[];
  readonly dwellTicks: number;
}

export interface RailNetworkHooks {
  /**
   * Called once per dwelling train per tick. Intents are aggregated by
   * wagon/item before capacity clamping, so callback array order cannot affect
   * the result.
   */
  readonly transferAtStation?: (
    context: RailStationTransferContext,
  ) => readonly RailTransferIntent[];
  readonly onEvent?: (event: RailEvent) => void;
}

interface MutableStation {
  id: string;
  segmentId: string;
  capacity: number;
  inventory: Map<string, number>;
}

interface MutableLocomotive {
  id: string;
  kind: "locomotive";
  fuelCapacityMilli: number;
  fuelMilli: number;
}

interface MutableCargoWagon {
  id: string;
  kind: "cargo-wagon";
  capacity: number;
  cargo: Map<string, number>;
}

type MutableCar = MutableLocomotive | MutableCargoWagon;

interface MutableTrain {
  id: string;
  currentSegmentId: string;
  progressMilli: number;
  speedMilliPerTick: number;
  status: RailTrainStatus;
  schedule: RailScheduleStop[];
  scheduleIndex: number;
  dwellTicks: number;
  reservationWaitTicks: number;
  path: string[];
  cars: MutableCar[];
  distanceTravelledMilli: number;
}

interface MutableGraph {
  publicGraph: RailGraph;
  segments: Map<string, RailSegmentInput>;
  adjacency: Map<string, RailGraphEdge[]>;
  blockBySegment: Map<string, string>;
  signalsByTransition: Map<string, RailSignalInput>;
}

export interface SerializedRailStation {
  readonly id: string;
  readonly segmentId: string;
  readonly capacity: number;
  readonly inventory: readonly RailCargoStack[];
}

export interface SerializedRailLocomotive {
  readonly id: string;
  readonly kind: "locomotive";
  readonly fuelCapacityMilli: number;
  readonly fuelMilli: number;
}

export interface SerializedRailCargoWagon {
  readonly id: string;
  readonly kind: "cargo-wagon";
  readonly capacity: number;
  readonly cargo: readonly RailCargoStack[];
}

export type SerializedRailCar =
  | SerializedRailLocomotive
  | SerializedRailCargoWagon;

export interface SerializedRailTrain {
  readonly id: string;
  readonly currentSegmentId: string;
  readonly progressMilli: number;
  readonly speedMilliPerTick: number;
  readonly status: RailTrainStatus;
  readonly schedule: readonly RailScheduleStop[];
  readonly scheduleIndex: number;
  readonly dwellTicks: number;
  readonly reservationWaitTicks: number;
  readonly cars: readonly SerializedRailCar[];
  readonly distanceTravelledMilli: number;
}

export interface RailNetworkSave {
  readonly version: typeof RAIL_SAVE_VERSION;
  readonly tick: number;
  readonly topologyRevision: number;
  readonly segments: readonly RailSegmentInput[];
  readonly signals: readonly RailSignalInput[];
  readonly stations: readonly SerializedRailStation[];
  readonly trains: readonly SerializedRailTrain[];
}

const DIRECTIONS: readonly RailDirection[] = [
  "north",
  "east",
  "south",
  "west",
];
const SEGMENT_KINDS: readonly RailSegmentKind[] = [
  "straight",
  "curve",
  "junction",
];
const SIGNAL_TYPES: readonly RailSignalType[] = ["regular", "chain"];
const TRAIN_STATUSES: readonly RailTrainStatus[] = [
  "dwelling",
  "moving",
  "waiting-signal",
  "no-path",
  "out-of-fuel",
];

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(`Invalid rail network: ${message}`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) return false;
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key)
    ) &&
    keys.every((key) => allowed.has(key as string))
  );
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= RAIL_LIMITS.maxIdLength &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

function validInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
  );
}

function cloneWait(wait: RailWaitCondition): RailWaitCondition {
  switch (wait.type) {
    case "time":
      return { type: "time", ticks: wait.ticks };
    case "cargo-empty":
      return { type: "cargo-empty" };
    case "cargo-full":
      return { type: "cargo-full" };
    case "item-at-least":
      return {
        type: "item-at-least",
        itemId: wait.itemId,
        count: wait.count,
      };
    case "item-at-most":
      return {
        type: "item-at-most",
        itemId: wait.itemId,
        count: wait.count,
      };
  }
}

function isWaitCondition(value: unknown): value is RailWaitCondition {
  if (!isPlainRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "time":
      return (
        hasExactKeys(value, ["type", "ticks"]) &&
        validInteger(value.ticks, 0, RAIL_LIMITS.maxTicks)
      );
    case "cargo-empty":
    case "cargo-full":
      return hasExactKeys(value, ["type"]);
    case "item-at-least":
    case "item-at-most":
      return (
        hasExactKeys(value, ["type", "itemId", "count"]) &&
        validId(value.itemId) &&
        validInteger(value.count, 0, RAIL_LIMITS.maxUnits)
      );
    default:
      return false;
  }
}

function isCargoStack(value: unknown): value is RailCargoStack {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, ["itemId", "count"]) &&
    validId(value.itemId) &&
    validInteger(value.count, 1, RAIL_LIMITS.maxUnits)
  );
}

function cargoMap(
  stacks: readonly RailCargoStack[] | undefined,
  label: string,
): Map<string, number> {
  const result = new Map<string, number>();
  if (!stacks) return result;
  assert(
    stacks.length <= RAIL_LIMITS.maxCargoKinds,
    `${label} has too many cargo kinds`,
  );
  for (const stack of stacks) {
    assert(isCargoStack(stack), `${label} contains invalid cargo`);
    assert(!result.has(stack.itemId), `${label} contains duplicate cargo`);
    result.set(stack.itemId, stack.count);
  }
  return result;
}

function cargoStacks(map: ReadonlyMap<string, number>): RailCargoStack[] {
  return [...map.entries()]
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([itemId, count]) => ({ itemId, count }));
}

function totalCargo(map: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const count of map.values()) total += count;
  return total;
}

function directionIndex(direction: RailDirection): number {
  return DIRECTIONS.indexOf(direction);
}

function rotateDirection(
  direction: RailDirection,
  rotation: number,
): RailDirection {
  return DIRECTIONS[
    (directionIndex(direction) + rotation) % DIRECTIONS.length
  ]!;
}

function opposite(direction: RailDirection): RailDirection {
  return rotateDirection(direction, 2);
}

function directionDelta(direction: RailDirection): readonly [number, number] {
  switch (direction) {
    case "north":
      return [0, -1];
    case "east":
      return [1, 0];
    case "south":
      return [0, 1];
    case "west":
      return [-1, 0];
  }
}

export function railSegmentPorts(
  segment: Pick<RailSegmentInput, "kind" | "rotation">,
): readonly RailDirection[] {
  const base: readonly RailDirection[] =
    segment.kind === "straight"
      ? ["north", "south"]
      : segment.kind === "curve"
        ? ["north", "east"]
        : ["north", "east", "west"];
  return base
    .map((direction) => rotateDirection(direction, segment.rotation))
    .sort((left, right) => directionIndex(left) - directionIndex(right));
}

export function railSegmentLength(kind: RailSegmentKind): number {
  return kind === "curve" ? RAIL_CURVE_LENGTH : RAIL_STRAIGHT_LENGTH;
}

function segmentSort(
  left: RailSegmentInput,
  right: RailSegmentInput,
): number {
  return (
    left.y - right.y ||
    left.x - right.x ||
    left.id.localeCompare(right.id)
  );
}

function transitionKey(fromSegmentId: string, toSegmentId: string): string {
  return `${fromSegmentId}\u0000${toSegmentId}`;
}

function undirectedTransitionKey(leftId: string, rightId: string): string {
  return leftId < rightId
    ? `${leftId}\u0000${rightId}`
    : `${rightId}\u0000${leftId}`;
}

function assertSegment(value: unknown): asserts value is RailSegmentInput {
  assert(
    isPlainRecord(value) &&
      hasExactKeys(value, ["id", "x", "y", "kind", "rotation"]) &&
      validId(value.id) &&
      validInteger(
        value.x,
        -RAIL_LIMITS.maxCoordinateMagnitude,
        RAIL_LIMITS.maxCoordinateMagnitude,
      ) &&
      validInteger(
        value.y,
        -RAIL_LIMITS.maxCoordinateMagnitude,
        RAIL_LIMITS.maxCoordinateMagnitude,
      ) &&
      typeof value.kind === "string" &&
      SEGMENT_KINDS.includes(value.kind as RailSegmentKind) &&
      validInteger(value.rotation, 0, 3),
    "invalid segment",
  );
}

function assertSignal(value: unknown): asserts value is RailSignalInput {
  assert(
    isPlainRecord(value) &&
      hasExactKeys(value, [
        "id",
        "fromSegmentId",
        "toSegmentId",
        "type",
      ]) &&
      validId(value.id) &&
      validId(value.fromSegmentId) &&
      validId(value.toSegmentId) &&
      typeof value.type === "string" &&
      SIGNAL_TYPES.includes(value.type as RailSignalType),
    "invalid signal",
  );
}

function cloneSegment(segment: RailSegmentInput): RailSegmentInput {
  return {
    id: segment.id,
    x: segment.x,
    y: segment.y,
    kind: segment.kind,
    rotation: segment.rotation,
  };
}

function cloneSignal(signal: RailSignalInput): RailSignalInput {
  return {
    id: signal.id,
    fromSegmentId: signal.fromSegmentId,
    toSegmentId: signal.toSegmentId,
    type: signal.type,
  };
}

function freezeGraph(graph: RailGraph): RailGraph {
  for (const node of graph.nodes) {
    Object.freeze(node.ports);
    Object.freeze(node);
  }
  for (const edge of graph.edges) Object.freeze(edge);
  for (const block of graph.blocks) {
    Object.freeze(block.segmentIds);
    Object.freeze(block);
  }
  Object.freeze(graph.nodes);
  Object.freeze(graph.edges);
  Object.freeze(graph.blocks);
  return Object.freeze(graph);
}

function buildMutableGraph(
  segmentInputs: readonly RailSegmentInput[],
  signalInputs: readonly RailSignalInput[],
): MutableGraph {
  assert(
    segmentInputs.length > 0 &&
      segmentInputs.length <= RAIL_LIMITS.maxSegments,
    "segment count is outside limits",
  );
  assert(
    signalInputs.length <= RAIL_LIMITS.maxSignals,
    "signal count is outside limits",
  );

  const segments = new Map<string, RailSegmentInput>();
  const byTile = new Map<string, RailSegmentInput>();
  const canonicalSegments = segmentInputs.map((input) => {
    assertSegment(input);
    return cloneSegment(input);
  }).sort(segmentSort);
  for (const segment of canonicalSegments) {
    assert(!segments.has(segment.id), `duplicate segment id ${segment.id}`);
    const tileKey = `${segment.x},${segment.y}`;
    assert(!byTile.has(tileKey), `duplicate rail tile ${tileKey}`);
    segments.set(segment.id, segment);
    byTile.set(tileKey, segment);
  }

  const adjacency = new Map<string, RailGraphEdge[]>();
  for (const segment of canonicalSegments) adjacency.set(segment.id, []);
  for (const segment of canonicalSegments) {
    for (const direction of railSegmentPorts(segment)) {
      const [dx, dy] = directionDelta(direction);
      const neighbor = byTile.get(`${segment.x + dx},${segment.y + dy}`);
      if (
        !neighbor ||
        !railSegmentPorts(neighbor).includes(opposite(direction))
      ) {
        continue;
      }
      adjacency.get(segment.id)!.push({
        fromSegmentId: segment.id,
        toSegmentId: neighbor.id,
        direction,
        costMilli: railSegmentLength(neighbor.kind),
      });
    }
  }
  for (const edges of adjacency.values()) {
    edges.sort(
      (left, right) =>
        left.costMilli - right.costMilli ||
        left.toSegmentId.localeCompare(right.toSegmentId) ||
        directionIndex(left.direction) - directionIndex(right.direction),
    );
  }

  const canonicalSignals = signalInputs.map((input) => {
    assertSignal(input);
    return cloneSignal(input);
  }).sort((left, right) => left.id.localeCompare(right.id));
  const signalsById = new Set<string>();
  const signalsByTransition = new Map<string, RailSignalInput>();
  const signalBoundaries = new Set<string>();
  for (const signal of canonicalSignals) {
    assert(!signalsById.has(signal.id), `duplicate signal id ${signal.id}`);
    signalsById.add(signal.id);
    const edgeExists = adjacency
      .get(signal.fromSegmentId)
      ?.some((edge) => edge.toSegmentId === signal.toSegmentId);
    assert(edgeExists, `signal ${signal.id} does not guard a connected edge`);
    const key = transitionKey(
      signal.fromSegmentId,
      signal.toSegmentId,
    );
    assert(!signalsByTransition.has(key), `duplicate signal transition ${key}`);
    signalsByTransition.set(key, signal);
    signalBoundaries.add(
      undirectedTransitionKey(
        signal.fromSegmentId,
        signal.toSegmentId,
      ),
    );
  }

  const blockBySegment = new Map<string, string>();
  const blocks: RailBlockSnapshot[] = [];
  for (const root of canonicalSegments) {
    if (blockBySegment.has(root.id)) continue;
    const memberIds: string[] = [];
    const queue = [root.id];
    const seen = new Set<string>([root.id]);
    while (queue.length > 0) {
      const segmentId = queue.shift()!;
      memberIds.push(segmentId);
      for (const edge of adjacency.get(segmentId) ?? []) {
        if (
          signalBoundaries.has(
            undirectedTransitionKey(segmentId, edge.toSegmentId),
          ) ||
          seen.has(edge.toSegmentId)
        ) {
          continue;
        }
        seen.add(edge.toSegmentId);
        queue.push(edge.toSegmentId);
      }
      queue.sort((left, right) => left.localeCompare(right));
    }
    memberIds.sort((left, right) => left.localeCompare(right));
    const id = `block:${memberIds[0]}`;
    for (const segmentId of memberIds) blockBySegment.set(segmentId, id);
    blocks.push({ id, segmentIds: memberIds });
  }
  blocks.sort((left, right) => left.id.localeCompare(right.id));

  const nodes: RailGraphNode[] = canonicalSegments.map((segment) => ({
    segmentId: segment.id,
    x: segment.x,
    y: segment.y,
    kind: segment.kind,
    rotation: segment.rotation,
    ports: [...railSegmentPorts(segment)],
    blockId: blockBySegment.get(segment.id)!,
  }));
  const edges = [...adjacency.values()]
    .flat()
    .map((edge) => ({ ...edge }))
    .sort(
      (left, right) =>
        left.fromSegmentId.localeCompare(right.fromSegmentId) ||
        left.toSegmentId.localeCompare(right.toSegmentId) ||
        directionIndex(left.direction) - directionIndex(right.direction),
    );

  return {
    publicGraph: freezeGraph({ nodes, edges, blocks }),
    segments,
    adjacency,
    blockBySegment,
    signalsByTransition,
  };
}

export function createRailGraph(
  segments: readonly RailSegmentInput[],
  signals: readonly RailSignalInput[] = [],
): RailGraph {
  return buildMutableGraph(segments, signals).publicGraph;
}

interface PathLabel {
  distance: number;
  key: string;
  path: string[];
}

/**
 * Canonical Dijkstra path. Equal-cost routes are broken by the lexicographic
 * sequence of stable segment IDs.
 */
export function findRailPath(
  graph: RailGraph,
  fromSegmentId: string,
  toSegmentId: string,
): readonly string[] | null {
  const nodeIds = new Set(graph.nodes.map((node) => node.segmentId));
  if (!nodeIds.has(fromSegmentId) || !nodeIds.has(toSegmentId)) return null;
  if (fromSegmentId === toSegmentId) return Object.freeze([fromSegmentId]);

  const adjacency = new Map<string, RailGraphEdge[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const edge of graph.edges) adjacency.get(edge.fromSegmentId)!.push(edge);
  for (const edges of adjacency.values()) {
    edges.sort(
      (left, right) =>
        left.costMilli - right.costMilli ||
        left.toSegmentId.localeCompare(right.toSegmentId),
    );
  }

  const labels = new Map<string, PathLabel>();
  labels.set(fromSegmentId, {
    distance: 0,
    key: fromSegmentId,
    path: [fromSegmentId],
  });
  const unsettled = new Set<string>([fromSegmentId]);
  while (unsettled.size > 0) {
    let currentId: string | undefined;
    let current: PathLabel | undefined;
    for (const id of unsettled) {
      const candidate = labels.get(id)!;
      if (
        !current ||
        candidate.distance < current.distance ||
        (candidate.distance === current.distance &&
          candidate.key.localeCompare(current.key) < 0)
      ) {
        currentId = id;
        current = candidate;
      }
    }
    if (!currentId || !current) break;
    unsettled.delete(currentId);
    if (currentId === toSegmentId) {
      return Object.freeze([...current.path]);
    }
    for (const edge of adjacency.get(currentId) ?? []) {
      const distance = current.distance + edge.costMilli;
      const path = [...current.path, edge.toSegmentId];
      const key = path.join("\u0000");
      const previous = labels.get(edge.toSegmentId);
      if (
        !previous ||
        distance < previous.distance ||
        (distance === previous.distance &&
          key.localeCompare(previous.key) < 0)
      ) {
        labels.set(edge.toSegmentId, { distance, key, path });
        unsettled.add(edge.toSegmentId);
      }
    }
  }
  return null;
}

function assertStationInput(
  value: unknown,
): asserts value is RailStationInput {
  assert(
    isPlainRecord(value) &&
      hasExactKeys(value, ["id", "segmentId", "capacity"], ["inventory"]) &&
      validId(value.id) &&
      validId(value.segmentId) &&
      validInteger(value.capacity, 0, RAIL_LIMITS.maxUnits) &&
      (value.inventory === undefined || Array.isArray(value.inventory)),
    "invalid station",
  );
}

function assertScheduleStop(
  value: unknown,
): asserts value is RailScheduleStop {
  assert(
    isPlainRecord(value) &&
      hasExactKeys(value, ["stationId", "wait"]) &&
      validId(value.stationId) &&
      isWaitCondition(value.wait),
    "invalid schedule stop",
  );
}

function assertCarInput(value: unknown): asserts value is RailCarInput {
  assert(
    isPlainRecord(value) && validId(value.id) && typeof value.kind === "string",
    "invalid train car",
  );
  if (value.kind === "locomotive") {
    assert(
      hasExactKeys(value, [
        "id",
        "kind",
        "fuelCapacityMilli",
        "fuelMilli",
      ]) &&
        validInteger(
          value.fuelCapacityMilli,
          1,
          RAIL_LIMITS.maxUnits,
        ) &&
        validInteger(value.fuelMilli, 0, value.fuelCapacityMilli as number),
      "invalid locomotive",
    );
    return;
  }
  assert(
    value.kind === "cargo-wagon" &&
      hasExactKeys(value, ["id", "kind", "capacity"], ["cargo"]) &&
      validInteger(value.capacity, 1, RAIL_LIMITS.maxUnits) &&
      (value.cargo === undefined || Array.isArray(value.cargo)),
    "invalid cargo wagon",
  );
}

function cloneSchedule(
  schedule: readonly RailScheduleStop[],
): RailScheduleStop[] {
  return schedule.map((stop) => ({
    stationId: stop.stationId,
    wait: cloneWait(stop.wait),
  }));
}

function cloneCarInput(car: RailCarInput): MutableCar {
  if (car.kind === "locomotive") {
    return {
      id: car.id,
      kind: "locomotive",
      fuelCapacityMilli: car.fuelCapacityMilli,
      fuelMilli: car.fuelMilli,
    };
  }
  const cargo = cargoMap(car.cargo, `wagon ${car.id}`);
  assert(
    totalCargo(cargo) <= car.capacity,
    `wagon ${car.id} exceeds capacity`,
  );
  return {
    id: car.id,
    kind: "cargo-wagon",
    capacity: car.capacity,
    cargo,
  };
}

function carSnapshot(car: MutableCar): RailCarSnapshot {
  if (car.kind === "locomotive") {
    return {
      id: car.id,
      kind: car.kind,
      capacity: 0,
      stored: 0,
      cargo: [],
      fuelCapacityMilli: car.fuelCapacityMilli,
      fuelMilli: car.fuelMilli,
    };
  }
  return {
    id: car.id,
    kind: car.kind,
    capacity: car.capacity,
    stored: totalCargo(car.cargo),
    cargo: cargoStacks(car.cargo),
    fuelCapacityMilli: 0,
    fuelMilli: 0,
  };
}

function combinedTrainCargo(train: MutableTrain): Map<string, number> {
  const cargo = new Map<string, number>();
  for (const car of train.cars) {
    if (car.kind !== "cargo-wagon") continue;
    for (const [itemId, count] of car.cargo) {
      cargo.set(itemId, (cargo.get(itemId) ?? 0) + count);
    }
  }
  return cargo;
}

function trainCargoCapacity(train: MutableTrain): number {
  return train.cars.reduce(
    (total, car) =>
      total + (car.kind === "cargo-wagon" ? car.capacity : 0),
    0,
  );
}

function trainFuel(train: MutableTrain): number {
  return train.cars.reduce(
    (total, car) =>
      total + (car.kind === "locomotive" ? car.fuelMilli : 0),
    0,
  );
}

function consumeTrainFuel(train: MutableTrain, amount: number): number {
  let remaining = amount;
  const locomotives = train.cars
    .filter(
      (car): car is MutableLocomotive => car.kind === "locomotive",
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const locomotive of locomotives) {
    const used = Math.min(remaining, locomotive.fuelMilli);
    locomotive.fuelMilli -= used;
    remaining -= used;
    if (remaining === 0) break;
  }
  return amount - remaining;
}

function stationSnapshot(station: MutableStation): RailStationSnapshot {
  return {
    id: station.id,
    segmentId: station.segmentId,
    capacity: station.capacity,
    inventory: cargoStacks(station.inventory),
    storedUnits: totalCargo(station.inventory),
  };
}

function sortedMapValues<T extends { id: string }>(
  map: ReadonlyMap<string, T>,
): T[] {
  return [...map.values()].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
}

function stationAtSegment(
  stations: ReadonlyMap<string, MutableStation>,
  segmentId: string,
): MutableStation | undefined {
  for (const station of stations.values()) {
    if (station.segmentId === segmentId) return station;
  }
  return undefined;
}

function waitSatisfied(train: MutableTrain, wait: RailWaitCondition): boolean {
  const cargo = combinedTrainCargo(train);
  const units = totalCargo(cargo);
  switch (wait.type) {
    case "time":
      return train.dwellTicks >= wait.ticks;
    case "cargo-empty":
      return units === 0;
    case "cargo-full": {
      const capacity = trainCargoCapacity(train);
      return capacity > 0 && units >= capacity;
    }
    case "item-at-least":
      return (cargo.get(wait.itemId) ?? 0) >= wait.count;
    case "item-at-most":
      return (cargo.get(wait.itemId) ?? 0) <= wait.count;
  }
}

function isTransferIntent(value: unknown): value is RailTransferIntent {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, ["wagonId", "itemId", "amount"]) &&
    validId(value.wagonId) &&
    validId(value.itemId) &&
    validInteger(
      value.amount,
      -RAIL_LIMITS.maxUnits,
      RAIL_LIMITS.maxUnits,
    ) &&
    value.amount !== 0
  );
}

function trainInputToMutable(
  input: RailTrainInput,
  graph: MutableGraph,
  stations: ReadonlyMap<string, MutableStation>,
): MutableTrain {
  assert(
    isPlainRecord(input) &&
      hasExactKeys(
        input,
        ["id", "currentSegmentId", "cars", "schedule"],
        ["scheduleIndex"],
      ) &&
      validId(input.id) &&
      validId(input.currentSegmentId) &&
      Array.isArray(input.cars) &&
      Array.isArray(input.schedule),
    "invalid train",
  );
  assert(
    graph.segments.has(input.currentSegmentId),
    `train ${input.id} is off rail`,
  );
  assert(
    input.cars.length > 0 &&
      input.cars.length <= RAIL_LIMITS.maxCarsPerTrain,
    `train ${input.id} car count is outside limits`,
  );
  const carIds = new Set<string>();
  const cars = input.cars.map((car) => {
    assertCarInput(car);
    assert(!carIds.has(car.id), `duplicate car id ${car.id}`);
    carIds.add(car.id);
    return cloneCarInput(car);
  }).sort((left, right) => left.id.localeCompare(right.id));
  assert(
    cars.some((car) => car.kind === "locomotive"),
    `train ${input.id} requires a locomotive`,
  );
  assert(
    input.schedule.length > 0 &&
      input.schedule.length <= RAIL_LIMITS.maxScheduleStops,
    `train ${input.id} schedule count is outside limits`,
  );
  for (const stop of input.schedule) {
    assertScheduleStop(stop);
    assert(
      stations.has(stop.stationId),
      `train ${input.id} references missing station ${stop.stationId}`,
    );
  }
  const scheduleIndex = input.scheduleIndex ?? 0;
  assert(
    validInteger(scheduleIndex, 0, input.schedule.length - 1),
    `train ${input.id} has invalid schedule index`,
  );
  const schedule = cloneSchedule(input.schedule);
  const target = stations.get(schedule[scheduleIndex]!.stationId)!;
  const atTarget = target.segmentId === input.currentSegmentId;
  return {
    id: input.id,
    currentSegmentId: input.currentSegmentId,
    progressMilli: 0,
    speedMilliPerTick: 0,
    status: atTarget ? "dwelling" : "moving",
    schedule,
    scheduleIndex,
    dwellTicks: 0,
    reservationWaitTicks: 0,
    path: [],
    cars,
    distanceTravelledMilli: 0,
  };
}

function cloneStationInput(input: RailStationInput): MutableStation {
  assertStationInput(input);
  const inventory = cargoMap(input.inventory, `station ${input.id}`);
  assert(
    totalCargo(inventory) <= input.capacity,
    `station ${input.id} exceeds capacity`,
  );
  return {
    id: input.id,
    segmentId: input.segmentId,
    capacity: input.capacity,
    inventory,
  };
}

function reservationSort(
  left: RailReservationSnapshot,
  right: RailReservationSnapshot,
): number {
  return (
    left.blockId.localeCompare(right.blockId) ||
    left.kind.localeCompare(right.kind) ||
    left.trainId.localeCompare(right.trainId)
  );
}

export class RailNetwork {
  private graphState: MutableGraph;
  private readonly signals = new Map<string, RailSignalInput>();
  private readonly stations = new Map<string, MutableStation>();
  private readonly trains = new Map<string, MutableTrain>();
  private readonly hooks: RailNetworkHooks;
  private reservations = new Map<string, string>();
  private occupiedBlocks = new Map<string, string>();
  private currentTick = 0;
  private revision = 0;

  public constructor(
    input: RailNetworkInput,
    hooks: RailNetworkHooks = {},
  ) {
    assert(
      isPlainRecord(input) &&
        hasExactKeys(input, ["segments", "stations"], ["signals", "trains"]) &&
        Array.isArray(input.segments) &&
        Array.isArray(input.stations) &&
        (input.signals === undefined || Array.isArray(input.signals)) &&
        (input.trains === undefined || Array.isArray(input.trains)),
      "invalid network input",
    );
    this.hooks = hooks;
    this.graphState = buildMutableGraph(input.segments, input.signals ?? []);

    const signalIds = new Set<string>();
    for (const signalInput of input.signals ?? []) {
      assertSignal(signalInput);
      assert(!signalIds.has(signalInput.id), `duplicate signal id ${signalInput.id}`);
      signalIds.add(signalInput.id);
      this.signals.set(signalInput.id, cloneSignal(signalInput));
    }

    assert(
      input.stations.length > 0 &&
        input.stations.length <= RAIL_LIMITS.maxStations,
      "station count is outside limits",
    );
    const stationSegments = new Set<string>();
    for (const stationInput of input.stations) {
      const station = cloneStationInput(stationInput);
      assert(!this.stations.has(station.id), `duplicate station id ${station.id}`);
      assert(
        this.graphState.segments.has(station.segmentId),
        `station ${station.id} is off rail`,
      );
      assert(
        !stationSegments.has(station.segmentId),
        `multiple stations occupy ${station.segmentId}`,
      );
      stationSegments.add(station.segmentId);
      this.stations.set(station.id, station);
    }

    assert(
      (input.trains?.length ?? 0) <= RAIL_LIMITS.maxTrains,
      "train count is outside limits",
    );
    for (const trainInput of input.trains ?? []) {
      const train = trainInputToMutable(
        trainInput,
        this.graphState,
        this.stations,
      );
      assert(!this.trains.has(train.id), `duplicate train id ${train.id}`);
      this.trains.set(train.id, train);
    }
    this.refreshRoutesAndOccupancy(false);
  }

  public get tick(): number {
    return this.currentTick;
  }

  public get topologyRevision(): number {
    return this.revision;
  }

  public graph(): RailGraph {
    return this.graphState.publicGraph;
  }

  /**
   * Replaces track tiles while retaining signals, stations, inventories,
   * trains, and schedules. Occupied/station tiles may not be removed; all
   * retained signals must still guard a connected edge.
   */
  public replaceSegments(nextSegments: readonly RailSegmentInput[]): void {
    assert(
      this.revision < RAIL_LIMITS.maxTicks,
      "topology revision limit reached",
    );
    const nextGraph = buildMutableGraph(
      nextSegments,
      sortedMapValues(this.signals),
    );
    for (const station of this.stations.values()) {
      assert(
        nextGraph.segments.has(station.segmentId),
        `topology removes station rail ${station.segmentId}`,
      );
    }
    for (const train of this.trains.values()) {
      assert(
        nextGraph.segments.has(train.currentSegmentId),
        `topology removes occupied rail ${train.currentSegmentId}`,
      );
    }
    this.assertUniqueOccupiedBlocks(nextGraph);
    this.graphState = nextGraph;
    this.revision += 1;
    for (const train of this.trains.values()) train.path = [];
    this.refreshRoutesAndOccupancy(true);
    this.emit({
      type: "topology-changed",
      tick: this.currentTick,
      revision: this.revision,
    });
  }

  public addFuel(
    trainId: string,
    locomotiveId: string,
    amount: number,
  ): number {
    assert(validInteger(amount, 0, RAIL_LIMITS.maxUnits), "invalid fuel amount");
    const train = this.trains.get(trainId);
    assert(train, `missing train ${trainId}`);
    const locomotive = train.cars.find(
      (car): car is MutableLocomotive =>
        car.id === locomotiveId && car.kind === "locomotive",
    );
    assert(locomotive, `missing locomotive ${locomotiveId}`);
    const accepted = Math.min(
      amount,
      locomotive.fuelCapacityMilli - locomotive.fuelMilli,
    );
    locomotive.fuelMilli += accepted;
    return accepted;
  }

  /**
   * Direct integration hook for inserters/loaders. Positive amounts load the
   * wagon from an external owner, negative amounts remove cargo. The caller
   * remains responsible for its external inventory transaction.
   */
  public transferWagonCargo(
    trainId: string,
    wagonId: string,
    itemId: string,
    amount: number,
  ): number {
    assert(validId(itemId), "invalid cargo item id");
    assert(
      validInteger(
        amount,
        -RAIL_LIMITS.maxUnits,
        RAIL_LIMITS.maxUnits,
      ),
      "invalid cargo amount",
    );
    const train = this.trains.get(trainId);
    assert(train, `missing train ${trainId}`);
    const wagon = train.cars.find(
      (car): car is MutableCargoWagon =>
        car.id === wagonId && car.kind === "cargo-wagon",
    );
    assert(wagon, `missing wagon ${wagonId}`);
    if (amount >= 0) {
      if (
        !wagon.cargo.has(itemId) &&
        wagon.cargo.size >= RAIL_LIMITS.maxCargoKinds
      ) {
        return 0;
      }
      const accepted = Math.min(
        amount,
        wagon.capacity - totalCargo(wagon.cargo),
      );
      if (accepted > 0) {
        wagon.cargo.set(itemId, (wagon.cargo.get(itemId) ?? 0) + accepted);
      }
      return accepted;
    }
    const removed = Math.min(-amount, wagon.cargo.get(itemId) ?? 0);
    if (removed > 0) {
      const remaining = (wagon.cargo.get(itemId) ?? 0) - removed;
      if (remaining === 0) wagon.cargo.delete(itemId);
      else wagon.cargo.set(itemId, remaining);
    }
    return -removed;
  }

  public step(ticks = 1): RailStepResult {
    assert(validInteger(ticks, 0, RAIL_LIMITS.maxTicks), "invalid step count");
    assert(
      this.currentTick + ticks <= RAIL_LIMITS.maxTicks,
      "step would exceed the bounded tick horizon",
    );
    const events: RailEvent[] = [];
    const previousSink = this.eventSink;
    this.eventSink = events;
    try {
      for (let index = 0; index < ticks; index += 1) this.stepOneTick();
    } finally {
      this.eventSink = previousSink;
    }
    return {
      tick: this.currentTick,
      events: Object.freeze(events.map((event) => Object.freeze(event))),
      snapshot: this.snapshot(),
    };
  }

  public signalAspect(
    signalId: string,
    forTrainId?: string,
  ): RailSignalAspect {
    const signal = this.signals.get(signalId);
    assert(signal, `missing signal ${signalId}`);
    return this.evaluateSignal(signal, forTrainId, new Set());
  }

  public snapshot(): RailNetworkSnapshot {
    const graph = this.graphState.publicGraph;
    const trains = sortedMapValues(this.trains).map((train) =>
      this.trainSnapshot(train)
    );
    const stations = sortedMapValues(this.stations).map((station) =>
      stationSnapshot(station)
    );
    const signals = sortedMapValues(this.signals).map((signal) => ({
      ...cloneSignal(signal),
      downstreamBlockId: this.graphState.blockBySegment.get(
        signal.toSegmentId,
      )!,
      aspect: this.signalAspect(signal.id),
    }));
    const reservations: RailReservationSnapshot[] = [];
    for (const [blockId, trainId] of this.occupiedBlocks) {
      reservations.push({
        blockId,
        trainId,
        kind: "occupied",
      });
    }
    for (const [blockId, trainId] of this.reservations) {
      if (this.occupiedBlocks.get(blockId) === trainId) continue;
      reservations.push({
        blockId,
        trainId,
        kind: "reserved",
      });
    }
    reservations.sort(reservationSort);
    return {
      tick: this.currentTick,
      topologyRevision: this.revision,
      graph,
      signals: Object.freeze(signals.map((signal) => Object.freeze(signal))),
      stations: Object.freeze(
        stations.map((station) => {
          Object.freeze(station.inventory);
          return Object.freeze(station);
        }),
      ),
      trains: Object.freeze(trains),
      reservations: Object.freeze(
        reservations.map((reservation) => Object.freeze(reservation)),
      ),
    };
  }

  public serialize(): RailNetworkSave {
    const segments = [...this.graphState.segments.values()]
      .sort(segmentSort)
      .map(cloneSegment);
    const signals = sortedMapValues(this.signals).map(cloneSignal);
    const stations: SerializedRailStation[] = sortedMapValues(
      this.stations,
    ).map((station) => ({
      id: station.id,
      segmentId: station.segmentId,
      capacity: station.capacity,
      inventory: cargoStacks(station.inventory),
    }));
    const trains: SerializedRailTrain[] = sortedMapValues(this.trains).map(
      (train) => ({
        id: train.id,
        currentSegmentId: train.currentSegmentId,
        progressMilli: train.progressMilli,
        speedMilliPerTick: train.speedMilliPerTick,
        status: train.status,
        schedule: cloneSchedule(train.schedule),
        scheduleIndex: train.scheduleIndex,
        dwellTicks: train.dwellTicks,
        reservationWaitTicks: train.reservationWaitTicks,
        cars: train.cars
          .map((car): SerializedRailCar =>
            car.kind === "locomotive"
              ? {
                  id: car.id,
                  kind: car.kind,
                  fuelCapacityMilli: car.fuelCapacityMilli,
                  fuelMilli: car.fuelMilli,
                }
              : {
                  id: car.id,
                  kind: car.kind,
                  capacity: car.capacity,
                  cargo: cargoStacks(car.cargo),
                }
          )
          .sort((left, right) => left.id.localeCompare(right.id)),
        distanceTravelledMilli: train.distanceTravelledMilli,
      }),
    );
    return {
      version: RAIL_SAVE_VERSION,
      tick: this.currentTick,
      topologyRevision: this.revision,
      segments,
      signals,
      stations,
      trains,
    };
  }

  private eventSink: RailEvent[] | undefined;

  private emit(event: RailEvent): void {
    this.eventSink?.push(event);
    this.hooks.onEvent?.(event);
  }

  private stepOneTick(): void {
    this.currentTick += 1;
    const orderedTrains = sortedMapValues(this.trains);

    for (const train of orderedTrains) {
      const destination = this.destinationFor(train);
      if (train.currentSegmentId !== destination.segmentId) continue;
      train.speedMilliPerTick = 0;
      train.progressMilli = 0;
      train.status = "dwelling";
      train.reservationWaitTicks = 0;
      this.applyStationTransfers(train, destination);
      train.dwellTicks += 1;
      const stop = train.schedule[train.scheduleIndex]!;
      if (waitSatisfied(train, stop.wait)) {
        const departedStationId = stop.stationId;
        train.scheduleIndex =
          (train.scheduleIndex + 1) % train.schedule.length;
        train.dwellTicks = 0;
        train.path = [];
        if (
          this.destinationFor(train).segmentId !== train.currentSegmentId
        ) {
          train.status = "moving";
          this.emit({
            type: "train-departed",
            tick: this.currentTick,
            trainId: train.id,
            stationId: departedStationId,
          });
        }
      }
    }

    const previousStatuses = new Map(
      orderedTrains.map((train) => [train.id, train.status] as const),
    );
    for (const train of orderedTrains) this.refreshTrainPath(train);
    this.computeReservations(true);

    const occupiedSegments = new Map(
      orderedTrains.map(
        (train) => [train.currentSegmentId, train.id] as const,
      ),
    );
    for (const train of orderedTrains) {
      if (train.status === "dwelling" || train.status === "no-path") continue;
      const path = train.path;
      const nextSegmentId = path[1];
      if (!nextSegmentId) {
        this.arriveIfAtDestination(train);
        continue;
      }
      const hasFuel = trainFuel(train) > 0;
      const targetBlock = this.graphState.blockBySegment.get(nextSegmentId)!;
      const currentBlock = this.graphState.blockBySegment.get(
        train.currentSegmentId,
      )!;
      const blockGranted =
        targetBlock === currentBlock ||
        this.reservations.get(targetBlock) === train.id;
      const targetOccupant = occupiedSegments.get(nextSegmentId);
      const segmentClear =
        targetOccupant === undefined || targetOccupant === train.id;
      const mayCross = blockGranted && segmentClear;
      const segment = this.graphState.segments.get(train.currentSegmentId)!;
      const segmentLength = railSegmentLength(segment.kind);
      const distanceToBoundary = segmentLength - train.progressMilli;
      const brakingDistance = Math.ceil(
        (train.speedMilliPerTick * train.speedMilliPerTick) /
          (2 * RAIL_BRAKING),
      );
      const mustBrake =
        !mayCross &&
        distanceToBoundary <=
          brakingDistance + train.speedMilliPerTick + RAIL_BRAKING;

      if (!hasFuel || mustBrake) {
        train.speedMilliPerTick = Math.max(
          0,
          train.speedMilliPerTick - RAIL_BRAKING,
        );
      } else {
        train.speedMilliPerTick = Math.min(
          RAIL_MAX_SPEED,
          train.speedMilliPerTick + RAIL_ACCELERATION,
        );
      }

      const distance = train.speedMilliPerTick;
      if (distance > 0 && hasFuel) {
        consumeTrainFuel(train, RAIL_FUEL_PER_MOVING_TICK);
      }
      if (distance === 0) {
        if (!hasFuel) {
          if (train.status !== "out-of-fuel") {
            this.emit({
              type: "fuel-exhausted",
              tick: this.currentTick,
              trainId: train.id,
            });
          }
          train.status = "out-of-fuel";
        } else if (!mayCross) {
          train.status = "waiting-signal";
        } else {
          train.status = "moving";
        }
        continue;
      }

      const proposedProgress = train.progressMilli + distance;
      if (proposedProgress < segmentLength) {
        train.progressMilli = proposedProgress;
        train.distanceTravelledMilli += distance;
        train.status = "moving";
        continue;
      }
      if (!mayCross) {
        const actualDistance = Math.max(
          0,
          segmentLength - train.progressMilli,
        );
        train.progressMilli = segmentLength;
        train.distanceTravelledMilli += actualDistance;
        train.speedMilliPerTick = 0;
        train.status = hasFuel ? "waiting-signal" : "out-of-fuel";
        continue;
      }

      const overflow = proposedProgress - segmentLength;
      occupiedSegments.delete(train.currentSegmentId);
      train.currentSegmentId = nextSegmentId;
      train.progressMilli = overflow;
      train.distanceTravelledMilli += distance;
      occupiedSegments.set(train.currentSegmentId, train.id);
      train.path = path.slice(1);
      if (this.destinationFor(train).segmentId === train.currentSegmentId) {
        train.progressMilli = 0;
        train.speedMilliPerTick = 0;
        train.status = "dwelling";
        train.dwellTicks = 0;
        train.reservationWaitTicks = 0;
        this.emit({
          type: "train-arrived",
          tick: this.currentTick,
          trainId: train.id,
          stationId: this.destinationFor(train).id,
        });
      } else {
        train.status = "moving";
      }
    }

    this.refreshOccupancyOnly();
    for (const train of orderedTrains) {
      const previous = previousStatuses.get(train.id);
      if (previous === "no-path" && train.status !== "no-path") {
        this.emit({
          type: "path-restored",
          tick: this.currentTick,
          trainId: train.id,
        });
      } else if (previous !== "no-path" && train.status === "no-path") {
        this.emit({
          type: "path-lost",
          tick: this.currentTick,
          trainId: train.id,
        });
      }
    }
  }

  private destinationFor(train: MutableTrain): MutableStation {
    return this.stations.get(
      train.schedule[train.scheduleIndex]!.stationId,
    )!;
  }

  private arriveIfAtDestination(train: MutableTrain): void {
    const destination = this.destinationFor(train);
    if (destination.segmentId !== train.currentSegmentId) return;
    train.progressMilli = 0;
    train.speedMilliPerTick = 0;
    train.status = "dwelling";
    train.reservationWaitTicks = 0;
  }

  private refreshTrainPath(train: MutableTrain): void {
    const destination = this.destinationFor(train);
    if (destination.segmentId === train.currentSegmentId) {
      train.path = [train.currentSegmentId];
      if (train.status !== "dwelling") train.status = "dwelling";
      return;
    }
    const path = findRailPath(
      this.graphState.publicGraph,
      train.currentSegmentId,
      destination.segmentId,
    );
    if (!path) {
      train.path = [];
      train.speedMilliPerTick = 0;
      train.status = "no-path";
      return;
    }
    train.path = [...path];
    if (
      train.status === "no-path" ||
      train.status === "waiting-signal" ||
      train.status === "out-of-fuel"
    ) {
      train.status = trainFuel(train) > 0 ? "moving" : "out-of-fuel";
    }
  }

  private refreshRoutesAndOccupancy(emitPathEvents: boolean): void {
    const previousStatuses = new Map(
      sortedMapValues(this.trains).map(
        (train) => [train.id, train.status] as const,
      ),
    );
    for (const train of sortedMapValues(this.trains)) {
      this.refreshTrainPath(train);
    }
    this.refreshOccupancyOnly();
    this.computeReservations(false);
    if (!emitPathEvents) return;
    for (const train of sortedMapValues(this.trains)) {
      const before = previousStatuses.get(train.id);
      if (before !== "no-path" && train.status === "no-path") {
        this.emit({
          type: "path-lost",
          tick: this.currentTick,
          trainId: train.id,
        });
      } else if (before === "no-path" && train.status !== "no-path") {
        this.emit({
          type: "path-restored",
          tick: this.currentTick,
          trainId: train.id,
        });
      }
    }
  }

  private refreshOccupancyOnly(): void {
    this.assertUniqueOccupiedBlocks(this.graphState);
    this.occupiedBlocks = new Map();
    for (const train of sortedMapValues(this.trains)) {
      this.occupiedBlocks.set(
        this.graphState.blockBySegment.get(train.currentSegmentId)!,
        train.id,
      );
    }
  }

  private assertUniqueOccupiedBlocks(graph: MutableGraph): void {
    const occupied = new Map<string, string>();
    const occupiedSegments = new Set<string>();
    for (const train of sortedMapValues(this.trains)) {
      assert(
        !occupiedSegments.has(train.currentSegmentId),
        `trains overlap on segment ${train.currentSegmentId}`,
      );
      occupiedSegments.add(train.currentSegmentId);
      const blockId = graph.blockBySegment.get(train.currentSegmentId)!;
      const owner = occupied.get(blockId);
      assert(
        owner === undefined,
        `trains ${owner} and ${train.id} occupy block ${blockId}`,
      );
      occupied.set(blockId, train.id);
    }
  }

  private requestedBlocks(train: MutableTrain): string[] {
    if (train.path.length < 2) return [];
    const currentBlock = this.graphState.blockBySegment.get(
      train.currentSegmentId,
    )!;
    const requested: string[] = [];
    let firstBoundarySignal: RailSignalInput | undefined;
    for (let index = 0; index < train.path.length - 1; index += 1) {
      const from = train.path[index]!;
      const to = train.path[index + 1]!;
      const fromBlock = this.graphState.blockBySegment.get(from)!;
      const toBlock = this.graphState.blockBySegment.get(to)!;
      if (fromBlock === toBlock) continue;
      const signal = this.graphState.signalsByTransition.get(
        transitionKey(from, to),
      );
      if (requested.length === 0) {
        firstBoundarySignal = signal;
        if (toBlock !== currentBlock) requested.push(toBlock);
        if (!signal || signal.type === "regular") break;
        continue;
      }
      if (toBlock !== currentBlock && !requested.includes(toBlock)) {
        requested.push(toBlock);
      }
      if (firstBoundarySignal?.type !== "chain" || signal?.type === "regular") {
        break;
      }
    }
    return requested;
  }

  private computeReservations(ageRequests: boolean): void {
    const claims = new Map(this.occupiedBlocks);
    const reservations = new Map<string, string>();
    const arbitrationOrder = sortedMapValues(this.trains).sort(
      (left, right) =>
        right.reservationWaitTicks - left.reservationWaitTicks ||
        left.id.localeCompare(right.id),
    );
    for (const train of arbitrationOrder) {
      const requested = this.requestedBlocks(train);
      if (requested.length === 0) {
        if (ageRequests) train.reservationWaitTicks = 0;
        continue;
      }
      if (
        requested.some((blockId) => {
          const owner = claims.get(blockId);
          return owner !== undefined && owner !== train.id;
        })
      ) {
        if (ageRequests) {
          train.reservationWaitTicks = Math.min(
            RAIL_LIMITS.maxTicks,
            train.reservationWaitTicks + 1,
          );
        }
        continue;
      }
      if (ageRequests) train.reservationWaitTicks = 0;
      for (const blockId of requested) {
        claims.set(blockId, train.id);
        reservations.set(blockId, train.id);
      }
    }
    this.reservations = reservations;
  }

  private evaluateSignal(
    signal: RailSignalInput,
    forTrainId: string | undefined,
    visiting: Set<string>,
  ): RailSignalAspect {
    if (visiting.has(signal.id)) return "red";
    visiting.add(signal.id);
    const downstreamBlock = this.graphState.blockBySegment.get(
      signal.toSegmentId,
    )!;
    const owner =
      this.occupiedBlocks.get(downstreamBlock) ??
      this.reservations.get(downstreamBlock);
    if (owner !== undefined && owner !== forTrainId) return "red";
    if (signal.type === "regular") return "green";

    const downstreamSegments =
      this.graphState.publicGraph.blocks.find(
        (block) => block.id === downstreamBlock,
      )?.segmentIds ?? [];
    const exits: RailSignalInput[] = [];
    for (const candidate of this.signals.values()) {
      if (
        downstreamSegments.includes(candidate.fromSegmentId) &&
        !downstreamSegments.includes(candidate.toSegmentId)
      ) {
        exits.push(candidate);
      }
    }
    exits.sort((left, right) => left.id.localeCompare(right.id));
    if (exits.length === 0) return "chain-clear";
    return exits.some(
      (exitSignal) =>
        this.evaluateSignal(exitSignal, forTrainId, new Set(visiting)) !==
        "red",
    )
      ? "chain-clear"
      : "red";
  }

  private applyStationTransfers(
    train: MutableTrain,
    station: MutableStation,
  ): void {
    if (!this.hooks.transferAtStation) return;
    const intents = this.hooks.transferAtStation({
      tick: this.currentTick,
      trainId: train.id,
      station: stationSnapshot(station),
      cars: Object.freeze(train.cars.map(carSnapshot)),
      cargo: Object.freeze(cargoStacks(combinedTrainCargo(train))),
      dwellTicks: train.dwellTicks,
    });
    assert(Array.isArray(intents), "station transfer hook returned non-array");
    assert(
      intents.length <= RAIL_LIMITS.maxCargoKinds * 2,
      "station transfer hook returned too many intents",
    );
    const aggregated = new Map<
      string,
      { wagonId: string; itemId: string; amount: number }
    >();
    for (const intent of intents) {
      assert(isTransferIntent(intent), "station transfer hook returned invalid intent");
      const key = `${intent.wagonId}\u0000${intent.itemId}`;
      const previous = aggregated.get(key);
      const amount = (previous?.amount ?? 0) + intent.amount;
      assert(
        Number.isSafeInteger(amount) &&
          Math.abs(amount) <= RAIL_LIMITS.maxUnits,
        "station transfer intent sum overflow",
      );
      aggregated.set(key, {
        wagonId: intent.wagonId,
        itemId: intent.itemId,
        amount,
      });
    }
    const canonicalIntents = [...aggregated.values()].sort(
      (left, right) =>
        left.wagonId.localeCompare(right.wagonId) ||
        left.itemId.localeCompare(right.itemId),
    );
    for (const intent of canonicalIntents) {
      if (intent.amount === 0) continue;
      const wagon = train.cars.find(
        (car): car is MutableCargoWagon =>
          car.kind === "cargo-wagon" && car.id === intent.wagonId,
      );
      assert(wagon, `transfer references missing wagon ${intent.wagonId}`);
      let applied = 0;
      if (intent.amount > 0) {
        const stationAvailable = station.inventory.get(intent.itemId) ?? 0;
        const wagonSpace = wagon.capacity - totalCargo(wagon.cargo);
        const kindSpace =
          wagon.cargo.has(intent.itemId) ||
          wagon.cargo.size < RAIL_LIMITS.maxCargoKinds;
        applied = kindSpace
          ? Math.min(intent.amount, stationAvailable, wagonSpace)
          : 0;
        if (applied > 0) {
          const stationRemaining = stationAvailable - applied;
          if (stationRemaining === 0) station.inventory.delete(intent.itemId);
          else station.inventory.set(intent.itemId, stationRemaining);
          wagon.cargo.set(
            intent.itemId,
            (wagon.cargo.get(intent.itemId) ?? 0) + applied,
          );
        }
      } else {
        const wagonAvailable = wagon.cargo.get(intent.itemId) ?? 0;
        const stationSpace =
          station.capacity - totalCargo(station.inventory);
        const kindSpace =
          station.inventory.has(intent.itemId) ||
          station.inventory.size < RAIL_LIMITS.maxCargoKinds;
        const unloaded = kindSpace
          ? Math.min(-intent.amount, wagonAvailable, stationSpace)
          : 0;
        applied = -unloaded;
        if (unloaded > 0) {
          const wagonRemaining = wagonAvailable - unloaded;
          if (wagonRemaining === 0) wagon.cargo.delete(intent.itemId);
          else wagon.cargo.set(intent.itemId, wagonRemaining);
          station.inventory.set(
            intent.itemId,
            (station.inventory.get(intent.itemId) ?? 0) + unloaded,
          );
        }
      }
      if (applied !== 0) {
        this.emit({
          type: "cargo-transferred",
          tick: this.currentTick,
          trainId: train.id,
          stationId: station.id,
          wagonId: wagon.id,
          itemId: intent.itemId,
          amount: applied,
        });
      }
    }
  }

  private trainSnapshot(train: MutableTrain): RailTrainSnapshot {
    const cargo = cargoStacks(combinedTrainCargo(train));
    const cars = train.cars.map(carSnapshot).sort((left, right) =>
      left.id.localeCompare(right.id)
    );
    for (const car of cars) {
      Object.freeze(car.cargo);
      Object.freeze(car);
    }
    const schedule = cloneSchedule(train.schedule);
    for (const stop of schedule) {
      Object.freeze(stop.wait);
      Object.freeze(stop);
    }
    return Object.freeze({
      id: train.id,
      currentSegmentId: train.currentSegmentId,
      currentBlockId: this.graphState.blockBySegment.get(
        train.currentSegmentId,
      )!,
      progressMilli: train.progressMilli,
      speedMilliPerTick: train.speedMilliPerTick,
      status: train.status,
      schedule: Object.freeze(schedule),
      scheduleIndex: train.scheduleIndex,
      destinationStationId:
        train.schedule[train.scheduleIndex]!.stationId,
      dwellTicks: train.dwellTicks,
      reservationWaitTicks: train.reservationWaitTicks,
      path: Object.freeze([...train.path]),
      cars: Object.freeze(cars),
      cargo: Object.freeze(cargo),
      cargoUnits: cargo.reduce((sum, stack) => sum + stack.count, 0),
      cargoCapacity: trainCargoCapacity(train),
      fuelMilli: trainFuel(train),
      distanceTravelledMilli: train.distanceTravelledMilli,
    });
  }

  private static restore(
    save: RailNetworkSave,
    hooks: RailNetworkHooks,
  ): RailNetwork {
    const network = new RailNetwork(
      {
        segments: save.segments,
        signals: save.signals,
        stations: save.stations,
        trains: save.trains.map((train) => ({
          id: train.id,
          currentSegmentId: train.currentSegmentId,
          cars: train.cars.map((car): RailCarInput =>
            car.kind === "locomotive"
              ? { ...car }
              : { ...car, cargo: car.cargo }
          ),
          schedule: train.schedule,
          scheduleIndex: train.scheduleIndex,
        })),
      },
      hooks,
    );
    network.currentTick = save.tick;
    network.revision = save.topologyRevision;
    for (const savedTrain of save.trains) {
      const train = network.trains.get(savedTrain.id)!;
      train.progressMilli = savedTrain.progressMilli;
      train.speedMilliPerTick = savedTrain.speedMilliPerTick;
      train.dwellTicks = savedTrain.dwellTicks;
      train.reservationWaitTicks = savedTrain.reservationWaitTicks;
      train.distanceTravelledMilli = savedTrain.distanceTravelledMilli;
    }
    network.refreshRoutesAndOccupancy(false);
    for (const savedTrain of save.trains) {
      network.trains.get(savedTrain.id)!.status = savedTrain.status;
    }
    return network;
  }

  public static fromSave(
    value: unknown,
    hooks: RailNetworkHooks = {},
  ): RailNetwork {
    assert(isCanonicalRailSave(value), "hostile or non-canonical save");
    return RailNetwork.restore(value, hooks);
  }
}

function isCanonicalSegment(value: unknown): value is RailSegmentInput {
  try {
    assertSegment(value);
    return true;
  } catch {
    return false;
  }
}

function isCanonicalSignal(value: unknown): value is RailSignalInput {
  try {
    assertSignal(value);
    return true;
  } catch {
    return false;
  }
}

function isCanonicalStation(
  value: unknown,
): value is SerializedRailStation {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ["id", "segmentId", "capacity", "inventory"]) ||
    !validId(value.id) ||
    !validId(value.segmentId) ||
    !validInteger(value.capacity, 0, RAIL_LIMITS.maxUnits) ||
    !Array.isArray(value.inventory)
  ) {
    return false;
  }
  const inventory = value.inventory;
  return (
    inventory.length <= RAIL_LIMITS.maxCargoKinds &&
    inventory.every(isCargoStack) &&
    inventory.every(
      (stack, index) =>
        index === 0 ||
        (inventory[index - 1] as RailCargoStack).itemId.localeCompare(
          stack.itemId,
        ) < 0,
    ) &&
    inventory.reduce(
      (sum, stack) => sum + (stack as RailCargoStack).count,
      0,
    ) <= value.capacity
  );
}

function isCanonicalSchedule(
  value: unknown,
): value is readonly RailScheduleStop[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= RAIL_LIMITS.maxScheduleStops &&
    value.every(
      (stop) =>
        isPlainRecord(stop) &&
        hasExactKeys(stop, ["stationId", "wait"]) &&
        validId(stop.stationId) &&
        isWaitCondition(stop.wait),
    )
  );
}

function isCanonicalSerializedCar(
  value: unknown,
): value is SerializedRailCar {
  if (!isPlainRecord(value) || !validId(value.id)) return false;
  if (value.kind === "locomotive") {
    return (
      hasExactKeys(value, [
        "id",
        "kind",
        "fuelCapacityMilli",
        "fuelMilli",
      ]) &&
      validInteger(value.fuelCapacityMilli, 1, RAIL_LIMITS.maxUnits) &&
      validInteger(value.fuelMilli, 0, value.fuelCapacityMilli as number)
    );
  }
  if (
    value.kind !== "cargo-wagon" ||
    !hasExactKeys(value, ["id", "kind", "capacity", "cargo"]) ||
    !validInteger(value.capacity, 1, RAIL_LIMITS.maxUnits) ||
    !Array.isArray(value.cargo)
  ) {
    return false;
  }
  const cargo = value.cargo;
  return (
    cargo.length <= RAIL_LIMITS.maxCargoKinds &&
    cargo.every(isCargoStack) &&
    cargo.every(
      (stack, index) =>
        index === 0 ||
        (cargo[index - 1] as RailCargoStack).itemId.localeCompare(
          stack.itemId,
        ) < 0,
    ) &&
    cargo.reduce(
      (sum, stack) => sum + (stack as RailCargoStack).count,
      0,
    ) <= value.capacity
  );
}

function isCanonicalSerializedTrain(
  value: unknown,
): value is SerializedRailTrain {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      "id",
      "currentSegmentId",
      "progressMilli",
      "speedMilliPerTick",
      "status",
      "schedule",
      "scheduleIndex",
      "dwellTicks",
      "reservationWaitTicks",
      "cars",
      "distanceTravelledMilli",
    ]) ||
    !validId(value.id) ||
    !validId(value.currentSegmentId) ||
    !validInteger(value.progressMilli, 0, RAIL_CURVE_LENGTH) ||
    !validInteger(value.speedMilliPerTick, 0, RAIL_MAX_SPEED) ||
    typeof value.status !== "string" ||
    !TRAIN_STATUSES.includes(value.status as RailTrainStatus) ||
    !isCanonicalSchedule(value.schedule) ||
    !validInteger(
      value.scheduleIndex,
      0,
      (value.schedule as readonly RailScheduleStop[]).length - 1,
    ) ||
    !validInteger(value.dwellTicks, 0, RAIL_LIMITS.maxTicks) ||
    !validInteger(
      value.reservationWaitTicks,
      0,
      RAIL_LIMITS.maxTicks,
    ) ||
    !Array.isArray(value.cars) ||
    value.cars.length === 0 ||
    value.cars.length > RAIL_LIMITS.maxCarsPerTrain ||
    !value.cars.every(isCanonicalSerializedCar) ||
    !value.cars.some(
      (car) =>
        (car as SerializedRailCar).kind === "locomotive",
    ) ||
    !validInteger(
      value.distanceTravelledMilli,
      0,
      Number.MAX_SAFE_INTEGER,
    )
  ) {
    return false;
  }
  const carIds = (value.cars as readonly SerializedRailCar[]).map(
    (car) => car.id,
  );
  return carIds.every(
    (id, index) =>
      (index === 0 || carIds[index - 1]!.localeCompare(id) < 0),
  );
}

/**
 * Exact-key hostile-input validator. In addition to scalar bounds it validates
 * cross references, topology connectivity, tile/ID uniqueness, canonical
 * ordering, block occupancy, capacities, and train positions.
 */
export function isCanonicalRailSave(value: unknown): value is RailNetworkSave {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "tick",
      "topologyRevision",
      "segments",
      "signals",
      "stations",
      "trains",
    ]) ||
    value.version !== RAIL_SAVE_VERSION ||
    !validInteger(value.tick, 0, RAIL_LIMITS.maxTicks) ||
    !validInteger(value.topologyRevision, 0, RAIL_LIMITS.maxTicks) ||
    !Array.isArray(value.segments) ||
    value.segments.length === 0 ||
    value.segments.length > RAIL_LIMITS.maxSegments ||
    !value.segments.every(isCanonicalSegment) ||
    !Array.isArray(value.signals) ||
    value.signals.length > RAIL_LIMITS.maxSignals ||
    !value.signals.every(isCanonicalSignal) ||
    !Array.isArray(value.stations) ||
    value.stations.length === 0 ||
    value.stations.length > RAIL_LIMITS.maxStations ||
    !value.stations.every(isCanonicalStation) ||
    !Array.isArray(value.trains) ||
    value.trains.length > RAIL_LIMITS.maxTrains ||
    !value.trains.every(isCanonicalSerializedTrain)
  ) {
    return false;
  }
  const save = value as unknown as RailNetworkSave;
  if (
    !save.segments.every(
      (segment, index) =>
        index === 0 ||
        segmentSort(save.segments[index - 1]!, segment) < 0,
    ) ||
    !save.signals.every(
      (signal, index) =>
        index === 0 ||
        save.signals[index - 1]!.id.localeCompare(signal.id) < 0,
    ) ||
    !save.stations.every(
      (station, index) =>
        index === 0 ||
        save.stations[index - 1]!.id.localeCompare(station.id) < 0,
    ) ||
    !save.trains.every(
      (train, index) =>
        index === 0 ||
        save.trains[index - 1]!.id.localeCompare(train.id) < 0,
    )
  ) {
    return false;
  }
  try {
    const graph = buildMutableGraph(save.segments, save.signals);
    const stationIds = new Set<string>();
    const stationSegments = new Set<string>();
    const stationById = new Map<string, SerializedRailStation>();
    for (const station of save.stations) {
      assert(!stationIds.has(station.id), "duplicate station");
      assert(!stationSegments.has(station.segmentId), "duplicate station tile");
      assert(graph.segments.has(station.segmentId), "station off rail");
      stationIds.add(station.id);
      stationSegments.add(station.segmentId);
      stationById.set(station.id, station);
    }
    const trainIds = new Set<string>();
    const occupiedSegments = new Set<string>();
    const occupiedBlocks = new Set<string>();
    for (const train of save.trains) {
      assert(!trainIds.has(train.id), "duplicate train");
      assert(graph.segments.has(train.currentSegmentId), "train off rail");
      assert(!occupiedSegments.has(train.currentSegmentId), "train overlap");
      const blockId = graph.blockBySegment.get(train.currentSegmentId)!;
      assert(!occupiedBlocks.has(blockId), "occupied block overlap");
      const segment = graph.segments.get(train.currentSegmentId)!;
      assert(
        train.progressMilli <= railSegmentLength(segment.kind),
        "train progress exceeds segment",
      );
      for (const stop of train.schedule) {
        assert(stationIds.has(stop.stationId), "missing schedule station");
      }
      const destination = stationById.get(
        train.schedule[train.scheduleIndex]!.stationId,
      )!;
      const path = findRailPath(
        graph.publicGraph,
        train.currentSegmentId,
        destination.segmentId,
      );
      if (train.currentSegmentId === destination.segmentId) {
        assert(train.status === "dwelling", "train at destination is not dwelling");
        assert(train.progressMilli === 0, "dwelling train has progress");
        assert(train.speedMilliPerTick === 0, "dwelling train has speed");
        assert(
          train.reservationWaitTicks === 0,
          "dwelling train retains arbitration age",
        );
      } else if (path === null) {
        assert(train.status === "no-path", "disconnected train is not no-path");
        assert(train.speedMilliPerTick === 0, "no-path train has speed");
      } else {
        assert(
          train.status !== "dwelling" && train.status !== "no-path",
          "routed train has inconsistent status",
        );
        assert(train.dwellTicks === 0, "moving train retains dwell time");
      }
      trainIds.add(train.id);
      occupiedSegments.add(train.currentSegmentId);
      occupiedBlocks.add(blockId);
    }
    return true;
  } catch {
    return false;
  }
}

export function restoreRailNetwork(
  value: unknown,
  hooks: RailNetworkHooks = {},
): RailNetwork {
  return RailNetwork.fromSave(value, hooks);
}

export function canonicalRailBytes(network: RailNetwork): string {
  const save = network.serialize();
  assert(isCanonicalRailSave(save), "runtime produced non-canonical save");
  return JSON.stringify(save);
}
