import { ENTITY_PROTOTYPES, ITEM_IDS } from "./catalog";
import {
  RAIL_LIMITS,
  createRailGraph,
  type RailNetworkSnapshot,
  type RailScheduleStop,
  type RailSegmentInput,
  type RailSignalType,
  type RailStationInput,
  type RailWaitCondition,
} from "./rail-network";
import type {
  EntityKind,
  ItemId,
  RailStationStorageInterface,
  RailStationTransferMode,
} from "./types";
import { Direction } from "./types";

export const RAIL_AUTHORING_FORMAT =
  "cinderline-rail-authoring" as const;
export const RAIL_AUTHORING_VERSION = 1 as const;

export const RAIL_BUILD_KINDS = Object.freeze([
  "straight",
  "curve",
  "junction",
  "regularSignal",
  "chainSignal",
  "station",
  "locomotive",
  "cargoWagon",
] as const);

export type RailBuildKind = (typeof RAIL_BUILD_KINDS)[number];

export const RAIL_BUILD_COSTS: Readonly<
  Record<RailBuildKind, number>
> = Object.freeze({
  straight: 2,
  curve: 3,
  junction: 6,
  regularSignal: 4,
  chainSignal: 6,
  station: 24,
  locomotive: 60,
  cargoWagon: 24,
});

export const RAIL_BUILD_LABELS: Readonly<
  Record<RailBuildKind, string>
> = Object.freeze({
  straight: "Straight track",
  curve: "Curve track",
  junction: "Junction",
  regularSignal: "Regular signal",
  chainSignal: "Chain signal",
  station: "Station",
  locomotive: "Locomotive / train",
  cargoWagon: "Cargo wagon",
});

export type RailLedgerTargetKind =
  | "segment"
  | "signal"
  | "station"
  | "train"
  | "car";

export type RailLedgerBuildKind = RailBuildKind | "trainShell";
export type RailConstructionSource = "paid" | "granted";

export interface RailConstructionEntry {
  readonly key: string;
  readonly targetKind: RailLedgerTargetKind;
  readonly id: string;
  readonly trainId: string | null;
  readonly buildKind: RailLedgerBuildKind;
  readonly source: RailConstructionSource;
  readonly paidCost: number;
}

export interface RailIdCursors {
  readonly segment: number;
  readonly signal: number;
  readonly station: number;
  readonly train: number;
  readonly car: number;
}

export type RailIdScope = keyof RailIdCursors;

export interface RailAuthoringState {
  readonly format: typeof RAIL_AUTHORING_FORMAT;
  readonly version: typeof RAIL_AUTHORING_VERSION;
  readonly nextIds: RailIdCursors;
  readonly entries: readonly RailConstructionEntry[];
}

export interface RailConstructionDraft {
  readonly targetKind: RailLedgerTargetKind;
  readonly id: string;
  readonly trainId?: string | null;
  readonly buildKind: RailLedgerBuildKind;
  readonly source: RailConstructionSource;
}

export interface RailStorageCandidate {
  readonly id: number;
  readonly kind: EntityKind;
  readonly x: number;
  readonly y: number;
  readonly direction: Direction;
}

export type RailAuthoringPreflight =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const PLAYER_ID_PREFIX: Readonly<Record<RailIdScope, string>> =
  Object.freeze({
    segment: "player-segment-",
    signal: "player-signal-",
    station: "player-station-",
    train: "player-train-",
    car: "player-car-",
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Reflect.ownKeys(value);
  return (
    actual.every((key) => typeof key === "string") &&
    actual.length === keys.length &&
    keys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key)
    )
  );
}

function canonicalInteger(
  value: unknown,
  label: string,
  minimum = 0,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < minimum
  ) {
    throw new TypeError(
      `${label} must be a canonical safe integer >= ${minimum}.`,
    );
  }
  return value;
}

function canonicalId(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > RAIL_LIMITS.maxIdLength ||
    !ID_PATTERN.test(value)
  ) {
    throw new TypeError(`${label} must be a canonical rail ID.`);
  }
  return value;
}

function isRailBuildKind(value: unknown): value is RailBuildKind {
  return RAIL_BUILD_KINDS.includes(value as RailBuildKind);
}

function isTargetKind(value: unknown): value is RailLedgerTargetKind {
  return (
    value === "segment" ||
    value === "signal" ||
    value === "station" ||
    value === "train" ||
    value === "car"
  );
}

function buildCost(
  buildKind: RailLedgerBuildKind,
  source: RailConstructionSource,
): number {
  if (source === "granted" || buildKind === "trainShell") return 0;
  return RAIL_BUILD_COSTS[buildKind];
}

export function railLedgerKey(
  targetKind: RailLedgerTargetKind,
  id: string,
  trainId: string | null = null,
): string {
  return targetKind === "car"
    ? `car:${trainId ?? ""}:${id}`
    : `${targetKind}:${id}`;
}

function freezeEntry(
  draft: RailConstructionDraft,
): RailConstructionEntry {
  const targetKind = draft.targetKind;
  const id = canonicalId(draft.id, "Rail provenance ID");
  const trainId =
    targetKind === "car"
      ? canonicalId(
          draft.trainId,
          "Rail car provenance trainId",
        )
      : null;
  if (targetKind !== "car" && draft.trainId != null) {
    throw new TypeError(
      "Only rail car provenance may contain a trainId.",
    );
  }
  const buildKind = draft.buildKind;
  if (buildKind !== "trainShell" && !isRailBuildKind(buildKind)) {
    throw new TypeError("Unknown rail provenance build kind.");
  }
  if (
    (targetKind === "train") !== (buildKind === "trainShell")
  ) {
    throw new TypeError(
      "Train provenance must use the structural trainShell build kind.",
    );
  }
  if (
    draft.source !== "paid" &&
    draft.source !== "granted"
  ) {
    throw new TypeError("Unknown rail provenance source.");
  }
  if (buildKind === "trainShell" && draft.source !== "granted") {
    throw new TypeError("Structural train provenance must be granted.");
  }
  const compatible =
    (targetKind === "segment" &&
      (buildKind === "straight" ||
        buildKind === "curve" ||
        buildKind === "junction")) ||
    (targetKind === "signal" &&
      (buildKind === "regularSignal" ||
        buildKind === "chainSignal")) ||
    (targetKind === "station" && buildKind === "station") ||
    (targetKind === "train" && buildKind === "trainShell") ||
    (targetKind === "car" &&
      (buildKind === "locomotive" || buildKind === "cargoWagon"));
  if (!compatible) {
    throw new TypeError(
      "Rail provenance build kind does not match its target kind.",
    );
  }
  return Object.freeze({
    key: railLedgerKey(targetKind, id, trainId),
    targetKind,
    id,
    trainId,
    buildKind,
    source: draft.source,
    paidCost: buildCost(buildKind, draft.source),
  });
}

function freezeCursors(nextIds: RailIdCursors): RailIdCursors {
  return Object.freeze({
    segment: canonicalInteger(
      nextIds.segment,
      "Rail next segment ID",
      1,
    ),
    signal: canonicalInteger(
      nextIds.signal,
      "Rail next signal ID",
      1,
    ),
    station: canonicalInteger(
      nextIds.station,
      "Rail next station ID",
      1,
    ),
    train: canonicalInteger(
      nextIds.train,
      "Rail next train ID",
      1,
    ),
    car: canonicalInteger(nextIds.car, "Rail next car ID", 1),
  });
}

function freezeState(
  nextIds: RailIdCursors,
  entries: readonly RailConstructionEntry[],
): RailAuthoringState {
  return Object.freeze({
    format: RAIL_AUTHORING_FORMAT,
    version: RAIL_AUTHORING_VERSION,
    nextIds: freezeCursors(nextIds),
    entries: Object.freeze(entries.slice()),
  });
}

function compareEntries(
  left: RailConstructionEntry,
  right: RailConstructionEntry,
): number {
  return left.key.localeCompare(right.key);
}

function idSequence(scope: RailIdScope, id: string): number {
  const prefix = PLAYER_ID_PREFIX[scope];
  if (!id.startsWith(prefix)) return 0;
  const suffix = id.slice(prefix.length);
  if (!/^[0-9]+$/.test(suffix)) return 0;
  const parsed = Number(suffix);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function scopeForTarget(
  targetKind: RailLedgerTargetKind,
): RailIdScope {
  return targetKind;
}

function bumpCursors(
  source: RailIdCursors,
  entries: readonly RailConstructionEntry[],
): RailIdCursors {
  const result: Record<RailIdScope, number> = {
    ...source,
  };
  for (const entry of entries) {
    const scope = scopeForTarget(entry.targetKind);
    const sequence = idSequence(scope, entry.id);
    if (sequence >= result[scope]) {
      if (sequence === Number.MAX_SAFE_INTEGER) {
        throw new RangeError("Rail ID sequence is exhausted.");
      }
      result[scope] = sequence + 1;
    }
  }
  return result;
}

export function nextRailId(
  state: RailAuthoringState,
  scope: RailIdScope,
): string {
  const value = state.nextIds[scope];
  const id = `${PLAYER_ID_PREFIX[scope]}${String(value).padStart(6, "0")}`;
  return canonicalId(id, `Next rail ${scope} ID`);
}

function expectedEntries(
  snapshot: RailNetworkSnapshot | null,
): RailConstructionDraft[] {
  if (!snapshot) return [];
  const drafts: RailConstructionDraft[] = [];
  for (const segment of snapshot.graph.nodes) {
    drafts.push({
      targetKind: "segment",
      id: segment.segmentId,
      buildKind: segment.kind,
      source: "granted",
    });
  }
  for (const signal of snapshot.signals) {
    drafts.push({
      targetKind: "signal",
      id: signal.id,
      buildKind:
        signal.type === "regular" ? "regularSignal" : "chainSignal",
      source: "granted",
    });
  }
  for (const station of snapshot.stations) {
    drafts.push({
      targetKind: "station",
      id: station.id,
      buildKind: "station",
      source: "granted",
    });
  }
  for (const train of snapshot.trains) {
    drafts.push({
      targetKind: "train",
      id: train.id,
      buildKind: "trainShell",
      source: "granted",
    });
    for (const car of train.cars) {
      drafts.push({
        targetKind: "car",
        id: car.id,
        trainId: train.id,
        buildKind:
          car.kind === "locomotive" ? "locomotive" : "cargoWagon",
        source: "granted",
      });
    }
  }
  return drafts;
}

export function createGrantedRailAuthoringState(
  snapshot: RailNetworkSnapshot | null,
): RailAuthoringState {
  const entries = expectedEntries(snapshot)
    .map(freezeEntry)
    .sort(compareEntries);
  return freezeState(
    bumpCursors(
      { segment: 1, signal: 1, station: 1, train: 1, car: 1 },
      entries,
    ),
    entries,
  );
}

function restoredEntry(
  value: unknown,
  index: number,
): RailConstructionEntry {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "key",
      "targetKind",
      "id",
      "trainId",
      "buildKind",
      "source",
      "paidCost",
    ])
  ) {
    throw new TypeError(
      `Rail provenance entry ${index} has an invalid shape.`,
    );
  }
  if (!isTargetKind(value.targetKind)) {
    throw new TypeError(
      `Rail provenance entry ${index} has an unknown target kind.`,
    );
  }
  const source = value.source;
  if (source !== "paid" && source !== "granted") {
    throw new TypeError(
      `Rail provenance entry ${index} has an unknown source.`,
    );
  }
  const buildKind = value.buildKind;
  if (buildKind !== "trainShell" && !isRailBuildKind(buildKind)) {
    throw new TypeError(
      `Rail provenance entry ${index} has an unknown build kind.`,
    );
  }
  const entry = freezeEntry({
    targetKind: value.targetKind,
    id: canonicalId(value.id, `Rail provenance entry ${index}.id`),
    trainId:
      value.trainId === null
        ? null
        : canonicalId(
            value.trainId,
            `Rail provenance entry ${index}.trainId`,
          ),
    buildKind,
    source,
  });
  if (
    value.key !== entry.key ||
    canonicalInteger(
      value.paidCost,
      `Rail provenance entry ${index}.paidCost`,
    ) !== entry.paidCost
  ) {
    throw new TypeError(
      `Rail provenance entry ${index} is not canonical.`,
    );
  }
  return entry;
}

function actualKindKey(entry: RailConstructionEntry): string {
  return `${entry.targetKind}\u0000${entry.id}\u0000${
    entry.trainId ?? ""
  }\u0000${entry.buildKind}`;
}

/**
 * Canonicalizes the persisted rail ledger without making any claim about a
 * particular live network. Command orchestration uses this before simulation
 * mutation so malformed entries or rewound cursors can never become a
 * post-success economy draft.
 */
export function canonicalRailAuthoringState(
  value: unknown,
): RailAuthoringState {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["format", "version", "nextIds", "entries"])
  ) {
    throw new TypeError("Rail authoring state has an invalid shape.");
  }
  if (value.format !== RAIL_AUTHORING_FORMAT) {
    throw new TypeError("Unsupported rail authoring format.");
  }
  if (value.version !== RAIL_AUTHORING_VERSION) {
    throw new RangeError("Unsupported rail authoring version.");
  }
  if (
    !isRecord(value.nextIds) ||
    !hasExactKeys(value.nextIds, [
      "segment",
      "signal",
      "station",
      "train",
      "car",
    ])
  ) {
    throw new TypeError("Rail authoring ID cursors are invalid.");
  }
  if (!Array.isArray(value.entries)) {
    throw new TypeError("Rail authoring entries must be an array.");
  }
  const nextIds = freezeCursors({
    segment: canonicalInteger(
      value.nextIds.segment,
      "Rail next segment ID",
      1,
    ),
    signal: canonicalInteger(
      value.nextIds.signal,
      "Rail next signal ID",
      1,
    ),
    station: canonicalInteger(
      value.nextIds.station,
      "Rail next station ID",
      1,
    ),
    train: canonicalInteger(
      value.nextIds.train,
      "Rail next train ID",
      1,
    ),
    car: canonicalInteger(
      value.nextIds.car,
      "Rail next car ID",
      1,
    ),
  });
  const entries = value.entries.map(restoredEntry);
  for (let index = 0; index < entries.length; index += 1) {
    if (
      index > 0 &&
      entries[index - 1]!.key >= entries[index]!.key
    ) {
      throw new TypeError(
        "Rail provenance entries must be unique and canonically ordered.",
      );
    }
  }
  const minimumCursors = bumpCursors(
    { segment: 1, signal: 1, station: 1, train: 1, car: 1 },
    entries,
  );
  for (const scope of [
    "segment",
    "signal",
    "station",
    "train",
    "car",
  ] as const) {
    if (nextIds[scope] < minimumCursors[scope]) {
      throw new TypeError(
        `Rail ${scope} ID cursor would reuse a live or retired ID.`,
      );
    }
  }
  return freezeState(nextIds, entries);
}

export function restoreRailAuthoringState(
  value: unknown,
  snapshot: RailNetworkSnapshot | null,
): RailAuthoringState {
  const state = canonicalRailAuthoringState(value);
  const expected = expectedEntries(snapshot)
    .map(freezeEntry)
    .sort(compareEntries);
  if (state.entries.length !== expected.length) {
    throw new TypeError(
      "Rail provenance must cover every live rail identity exactly once.",
    );
  }
  for (let index = 0; index < state.entries.length; index += 1) {
    if (
      actualKindKey(state.entries[index]!) !==
      actualKindKey(expected[index]!)
    ) {
      throw new TypeError(
        "Rail provenance does not match the live rail identities.",
      );
    }
  }
  return state;
}

export function snapshotRailAuthoringState(
  state: RailAuthoringState,
): RailAuthoringState {
  return state;
}

export function paidRailAlloy(state: RailAuthoringState): number {
  return state.entries.reduce(
    (total, entry) => total + entry.paidCost,
    0,
  );
}

export function recordRailConstructions(
  state: RailAuthoringState,
  drafts: readonly RailConstructionDraft[],
): RailAuthoringState {
  const additions = drafts.map(freezeEntry);
  const byKey = new Map(
    state.entries.map((entry) => [entry.key, entry]),
  );
  for (const entry of additions) {
    if (byKey.has(entry.key)) {
      throw new TypeError(
        `Rail provenance already contains ${entry.key}.`,
      );
    }
    byKey.set(entry.key, entry);
  }
  const entries = [...byKey.values()].sort(compareEntries);
  return freezeState(bumpCursors(state.nextIds, additions), entries);
}

export function removeRailConstructions(
  state: RailAuthoringState,
  keys: readonly string[],
): {
  readonly state: RailAuthoringState;
  readonly removed: readonly RailConstructionEntry[];
  readonly refund: number;
} {
  const requested = new Set(keys);
  if (requested.size !== keys.length) {
    throw new TypeError("Rail provenance removal keys must be unique.");
  }
  const removed: RailConstructionEntry[] = [];
  const retained: RailConstructionEntry[] = [];
  for (const entry of state.entries) {
    (requested.has(entry.key) ? removed : retained).push(entry);
  }
  if (removed.length !== keys.length) {
    throw new TypeError(
      "Rail provenance removal must name live ledger entries.",
    );
  }
  return Object.freeze({
    state: freezeState(state.nextIds, retained),
    removed: Object.freeze(removed),
    refund: removed.reduce(
      (total, entry) => total + entry.paidCost,
      0,
    ),
  });
}

export function railEntry(
  state: RailAuthoringState,
  targetKind: RailLedgerTargetKind,
  id: string,
  trainId: string | null = null,
): RailConstructionEntry | null {
  const key = railLedgerKey(targetKind, id, trainId);
  return state.entries.find((entry) => entry.key === key) ?? null;
}

export function railToolRotation(
  rotation: 0 | 1 | 2 | 3,
): 0 | 1 | 2 | 3 {
  return ((rotation + 1) % 4) as 0 | 1 | 2 | 3;
}

export function authoredSegment(
  id: string,
  kind: "straight" | "curve" | "junction",
  x: number,
  y: number,
  rotation: 0 | 1 | 2 | 3,
): RailSegmentInput {
  return Object.freeze({
    id: canonicalId(id, "Authored rail segment ID"),
    kind,
    x: canonicalInteger(x, "Authored rail x"),
    y: canonicalInteger(y, "Authored rail y"),
    rotation: kind === "straight"
      ? (rotation % 2) as 0 | 1
      : rotation,
  });
}

export function preflightTrackPlacement(
  snapshot: RailNetworkSnapshot | null,
  segment: RailSegmentInput,
): RailAuthoringPreflight {
  if (!snapshot) {
    return {
      ok: false,
      reason: "This world has no configured rail network.",
    };
  }
  if (snapshot.graph.nodes.length >= RAIL_LIMITS.maxSegments) {
    return { ok: false, reason: "The rail segment limit is reached." };
  }
  if (
    snapshot.graph.nodes.some(
      (node) =>
        node.segmentId === segment.id ||
        (node.x === segment.x && node.y === segment.y),
    )
  ) {
    return {
      ok: false,
      reason: "That rail ID or world tile is already occupied.",
    };
  }
  try {
    createRailGraph(
      [
        ...snapshot.graph.nodes.map((node) => ({
          id: node.segmentId,
          x: node.x,
          y: node.y,
          kind: node.kind,
          rotation: node.rotation,
        })),
        segment,
      ],
      snapshot.signals.map((signal) => ({
        id: signal.id,
        fromSegmentId: signal.fromSegmentId,
        toSegmentId: signal.toSegmentId,
        type: signal.type,
      })),
    );
    return { ok: true };
  } catch {
    return {
      ok: false,
      reason: "The proposed track would invalidate rail topology.",
    };
  }
}

export function preflightDirectedSignal(
  snapshot: RailNetworkSnapshot | null,
  fromSegmentId: string,
  toSegmentId: string,
  type: RailSignalType,
): RailAuthoringPreflight {
  if (!snapshot) {
    return {
      ok: false,
      reason: "This world has no configured rail network.",
    };
  }
  if (snapshot.signals.length >= RAIL_LIMITS.maxSignals) {
    return { ok: false, reason: "The rail signal limit is reached." };
  }
  const connected = snapshot.graph.edges.some(
    (edge) =>
      edge.fromSegmentId === fromSegmentId &&
      edge.toSegmentId === toSegmentId,
  );
  if (!connected) {
    return {
      ok: false,
      reason:
        "Choose two adjacent, port-connected segments in the guarded direction.",
    };
  }
  if (
    snapshot.signals.some(
      (signal) =>
        signal.fromSegmentId === fromSegmentId &&
        signal.toSegmentId === toSegmentId,
    )
  ) {
    return {
      ok: false,
      reason: "That directed transition already has a signal.",
    };
  }
  if (type !== "regular" && type !== "chain") {
    return { ok: false, reason: "Unknown rail signal type." };
  }
  return { ok: true };
}

export function preflightStationPlacement(
  snapshot: RailNetworkSnapshot | null,
  segmentId: string,
): RailAuthoringPreflight {
  if (!snapshot) {
    return {
      ok: false,
      reason: "This world has no configured rail network.",
    };
  }
  if (snapshot.stations.length >= RAIL_LIMITS.maxStations) {
    return { ok: false, reason: "The rail station limit is reached." };
  }
  if (
    !snapshot.graph.nodes.some((node) => node.segmentId === segmentId)
  ) {
    return { ok: false, reason: "Choose a live rail segment." };
  }
  if (
    snapshot.stations.some(
      (station) => station.segmentId === segmentId,
    )
  ) {
    return {
      ok: false,
      reason: "That segment already hosts a station.",
    };
  }
  return { ok: true };
}

export function preflightTrainPlacement(
  snapshot: RailNetworkSnapshot | null,
  segmentId: string,
): RailAuthoringPreflight {
  if (!snapshot) {
    return {
      ok: false,
      reason: "This world has no configured rail network.",
    };
  }
  if (snapshot.trains.length >= RAIL_LIMITS.maxTrains) {
    return { ok: false, reason: "The rail train limit is reached." };
  }
  if (snapshot.stations.length === 0) {
    return {
      ok: false,
      reason: "Place at least one station before spawning a train.",
    };
  }
  const node = snapshot.graph.nodes.find(
    (candidate) => candidate.segmentId === segmentId,
  );
  if (!node) return { ok: false, reason: "Choose a live rail segment." };
  if (
    snapshot.reservations.some(
      (reservation) => reservation.blockId === node.blockId,
    ) ||
    snapshot.trains.some(
      (train) => train.currentBlockId === node.blockId,
    )
  ) {
    return {
      ok: false,
      reason: "That rail block is already occupied or reserved.",
    };
  }
  return { ok: true };
}

function validItemFilter(
  filter: readonly ItemId[] | null | undefined,
): boolean {
  if (filter == null) return true;
  if (filter.length === 0 || new Set(filter).size !== filter.length) {
    return false;
  }
  return filter.every((item) => ITEM_IDS.includes(item));
}

/**
 * `null`/`undefined` mean no filter, an empty array is invalid, and a
 * nonempty filter is deduplicated by rejection then ordered by ItemId catalog.
 */
export function canonicalRailItemFilter(
  filter: readonly ItemId[] | null | undefined,
): readonly ItemId[] | undefined {
  if (filter == null) return undefined;
  if (!validItemFilter(filter)) {
    throw new TypeError(
      "Rail item filter must be null or a nonempty unique item list.",
    );
  }
  return Object.freeze(
    filter.slice().sort(
      (left, right) => ITEM_IDS.indexOf(left) - ITEM_IDS.indexOf(right),
    ),
  );
}

export function preflightStationBinding(
  snapshot: RailNetworkSnapshot | null,
  stationId: string,
  storageEntityId: number,
  mode: RailStationTransferMode,
  transferRate: number,
  itemFilter: readonly ItemId[] | null | undefined,
  entities: readonly RailStorageCandidate[],
  interfaces: readonly RailStationStorageInterface[],
): RailAuthoringPreflight {
  const station = snapshot?.stations.find(
    (candidate) => candidate.id === stationId,
  );
  const segment = snapshot?.graph.nodes.find(
    (node) => node.segmentId === station?.segmentId,
  );
  const storage = entities.find(
    (entity) => entity.id === storageEntityId,
  );
  if (!station || !segment) {
    return { ok: false, reason: "Choose a live rail station." };
  }
  if (!storage || storage.kind !== "storage") {
    return { ok: false, reason: "Choose a live storage entity." };
  }
  const base = ENTITY_PROTOTYPES.storage.footprint;
  const rotated =
    storage.direction === Direction.East ||
    storage.direction === Direction.West;
  const width = rotated ? base.height : base.width;
  const height = rotated ? base.width : base.height;
  let adjacentTileCount = 0;
  for (let y = storage.y; y < storage.y + height; y += 1) {
    for (let x = storage.x; x < storage.x + width; x += 1) {
      if (
        Math.abs(x - segment.x) + Math.abs(y - segment.y) === 1
      ) {
        adjacentTileCount += 1;
      }
    }
  }
  if (adjacentTileCount !== 1) {
    return {
      ok: false,
      reason:
        "Station storage must expose exactly one adjacent cardinal footprint tile.",
    };
  }
  if (
    interfaces.some(
      (binding) =>
        binding.storageEntityId === storageEntityId &&
        binding.stationId !== stationId,
    )
  ) {
    return {
      ok: false,
      reason: "That storage is already bound to another station.",
    };
  }
  if (mode !== "load" && mode !== "unload" && mode !== "both") {
    return { ok: false, reason: "Unknown station transfer mode." };
  }
  if (
    !Number.isSafeInteger(transferRate) ||
    transferRate <= 0 ||
    transferRate > RAIL_LIMITS.maxUnits
  ) {
    return {
      ok: false,
      reason: "Transfer rate must be a positive whole number.",
    };
  }
  if (!validItemFilter(itemFilter)) {
    return {
      ok: false,
      reason: "Item filter must be nonempty, unique, and known.",
    };
  }
  return { ok: true };
}

function validWait(wait: RailWaitCondition): boolean {
  if (wait.type === "time") {
    return (
      Number.isSafeInteger(wait.ticks) &&
      wait.ticks >= 0 &&
      wait.ticks <= RAIL_LIMITS.maxTicks
    );
  }
  if (wait.type === "cargo-empty" || wait.type === "cargo-full") {
    return true;
  }
  return (
    ITEM_IDS.includes(wait.itemId as ItemId) &&
    Number.isSafeInteger(wait.count) &&
    wait.count >= 0 &&
    wait.count <= RAIL_LIMITS.maxUnits
  );
}

export function preflightSchedule(
  snapshot: RailNetworkSnapshot | null,
  schedule: readonly RailScheduleStop[],
): RailAuthoringPreflight {
  if (!snapshot) {
    return {
      ok: false,
      reason: "This world has no configured rail network.",
    };
  }
  if (
    schedule.length === 0 ||
    schedule.length > RAIL_LIMITS.maxScheduleStops
  ) {
    return {
      ok: false,
      reason: `Schedules require 1–${RAIL_LIMITS.maxScheduleStops} stops.`,
    };
  }
  const stationIds = new Set(
    snapshot.stations.map((station) => station.id),
  );
  for (const stop of schedule) {
    if (!stationIds.has(stop.stationId)) {
      return {
        ok: false,
        reason: `Schedule station ${stop.stationId} is not live.`,
      };
    }
    if (!validWait(stop.wait)) {
      return {
        ok: false,
        reason: "Schedule contains an invalid wait condition.",
      };
    }
  }
  return { ok: true };
}

export function railDismantleBlockers(
  snapshot: RailNetworkSnapshot | null,
  targetKind: RailLedgerTargetKind,
  id: string,
  interfaces: readonly RailStationStorageInterface[] = [],
  trainId: string | null = null,
): readonly string[] {
  if (!snapshot) return Object.freeze(["Rail network is not configured."]);
  const blockers: string[] = [];
  if (targetKind === "segment") {
    for (const signal of snapshot.signals) {
      if (
        signal.fromSegmentId === id ||
        signal.toSegmentId === id
      ) {
        blockers.push(`signal ${signal.id}`);
      }
    }
    for (const station of snapshot.stations) {
      if (station.segmentId === id) blockers.push(`station ${station.id}`);
    }
    for (const train of snapshot.trains) {
      if (
        train.currentSegmentId === id ||
        train.path.includes(id)
      ) {
        blockers.push(`train ${train.id}`);
      }
    }
  } else if (targetKind === "station") {
    for (const binding of interfaces) {
      if (binding.stationId === id) {
        blockers.push(`storage binding ${binding.storageEntityId}`);
      }
    }
    for (const train of snapshot.trains) {
      if (train.schedule.some((stop) => stop.stationId === id)) {
        blockers.push(`schedule on train ${train.id}`);
      }
    }
  } else if (targetKind === "train") {
    const train = snapshot.trains.find((candidate) => candidate.id === id);
    if (!train) blockers.push("train no longer exists");
    if (
      train &&
      (train.status === "moving" || train.speedMilliPerTick !== 0)
    ) {
      blockers.push(`train ${train.id} is moving`);
    }
    if (train && train.fuelMilli > 0) {
      blockers.push(`${train.fuelMilli} locomotive fuel`);
    }
    if (train && train.cargoUnits > 0) {
      blockers.push(`${train.cargoUnits} cargo units`);
    }
  } else if (targetKind === "car") {
    const train = snapshot.trains.find(
      (candidate) => candidate.id === trainId,
    );
    const car = train?.cars.find((candidate) => candidate.id === id);
    if (!train || !car) blockers.push("car no longer exists");
    if (train && train.status !== "dwelling") {
      blockers.push(`train ${train.id} is not dwelling`);
    }
    if (train && train.cargoUnits > 0) {
      blockers.push(`${train.cargoUnits} cargo units on train ${train.id}`);
    }
    if (car?.kind === "locomotive" && car.fuelMilli > 0) {
      blockers.push(`${car.fuelMilli} locomotive fuel`);
    }
    if (car?.kind === "cargo-wagon" && car.stored > 0) {
      blockers.push(`${car.stored} cargo units`);
    }
    if (
      car?.kind === "locomotive" &&
      train?.cars.filter((candidate) => candidate.kind === "locomotive")
        .length === 1
    ) {
      blockers.push("a train requires at least one locomotive");
    }
  }
  return Object.freeze(
    [...new Set(blockers)].sort((left, right) =>
      left.localeCompare(right)
    ),
  );
}

export function explainRailMutationFailure(
  reason:
    | "alreadyConfigured"
    | "notConfigured"
    | "invalid"
    | "outOfBounds"
    | "water"
    | "occupied"
    | "storageBinding"
    | "tickLimit",
): string {
  switch (reason) {
    case "alreadyConfigured":
      return "A rail network is already configured.";
    case "notConfigured":
      return "This world has no configured rail network.";
    case "invalid":
      return "The rail command violates topology, occupancy, or custody.";
    case "outOfBounds":
      return "Rail must remain inside the world boundary.";
    case "water":
      return "Rail cannot be authored on water.";
    case "occupied":
      return "A factory entity or rail block occupies that target.";
    case "storageBinding":
      return "The station storage binding is invalid or already in use.";
    case "tickLimit":
      return "The rail revision limit is reached.";
  }
}

export function canonicalStationInput(
  id: string,
  segmentId: string,
): RailStationInput {
  return Object.freeze({
    id: canonicalId(id, "Authored station ID"),
    segmentId: canonicalId(segmentId, "Authored station segment ID"),
    capacity: 0,
  });
}
