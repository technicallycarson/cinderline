import { MAX_BLUEPRINT_ENTITIES, MAX_BLUEPRINT_SPAN } from "../game/blueprints";
import { ENTITY_PROTOTYPES } from "../game/catalog";
import { Direction, type EntityKind } from "../game/types";

export type BlueprintOverlayState =
  | "construct"
  | "configure"
  | "match"
  | "blocked";

export const BLUEPRINT_OVERLAY_COLORS: Readonly<
  Record<BlueprintOverlayState, string>
> = Object.freeze({
  construct: "#86d95b",
  configure: "#58d9d0",
  match: "#5a9bea",
  blocked: "#ef604f",
});

export const DEFAULT_BLUEPRINT_DETAIL_LIMIT = 96;

export interface BlueprintOverlayPlacementInput {
  readonly kind: EntityKind;
  readonly x: number;
  readonly z: number;
  readonly direction: Direction;
  readonly state: BlueprintOverlayState;
  readonly reason?: string;
}

export interface BlueprintOverlayInput {
  readonly anchorX: number;
  readonly anchorZ: number;
  readonly width: number;
  readonly height: number;
  readonly placements: readonly BlueprintOverlayPlacementInput[];
  readonly detailLimit?: number;
  readonly focus?: { readonly x: number; readonly z: number };
}

export interface BlueprintOverlayPlacement
  extends BlueprintOverlayPlacementInput {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly centerX: number;
  readonly centerZ: number;
  readonly detailed: boolean;
}

export interface BlueprintOverlayBatch {
  readonly key: string;
  readonly kind: EntityKind;
  readonly direction: Direction;
  readonly state: BlueprintOverlayState;
  readonly indices: readonly number[];
}

export interface BlueprintOverlayLayout {
  readonly signature: string;
  readonly anchor: { readonly x: number; readonly z: number };
  readonly boundary: {
    readonly minX: number;
    readonly minZ: number;
    readonly maxX: number;
    readonly maxZ: number;
  };
  readonly pivot: { readonly x: number; readonly z: number };
  readonly placements: readonly BlueprintOverlayPlacement[];
  readonly batches: readonly BlueprintOverlayBatch[];
  readonly detailIndices: readonly number[];
  readonly counts: Readonly<Record<BlueprintOverlayState, number>>;
}

export interface BlueprintCaptureEntityInput {
  readonly id: string | number;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
}

export interface BlueprintCaptureMarquee {
  readonly anchor: { readonly x: number; readonly z: number };
  readonly current: { readonly x: number; readonly z: number };
  readonly boundary: {
    readonly minX: number;
    readonly minZ: number;
    readonly maxX: number;
    readonly maxZ: number;
  };
  readonly width: number;
  readonly height: number;
  readonly tileCount: number;
  readonly corners: readonly {
    readonly x: number;
    readonly z: number;
  }[];
  readonly includedIds: readonly (string | number)[];
}

function safeCoordinate(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
    throw new TypeError(`${label} must be a canonical safe tile coordinate.`);
  }
  return value;
}

function safeSpan(value: number, label: string): number {
  if (
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < 0 ||
    value > MAX_BLUEPRINT_SPAN
  ) {
    throw new RangeError(
      `${label} must be a canonical span from 0 to ${MAX_BLUEPRINT_SPAN}.`,
    );
  }
  return value;
}

function safeFocusCoordinate(value: number, label: string): number {
  if (
    !Number.isFinite(value) ||
    Object.is(value, -0) ||
    Math.abs(value) > Number.MAX_SAFE_INTEGER
  ) {
    throw new TypeError(`${label} must be a canonical finite world coordinate.`);
  }
  return value;
}

function safeDetailLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_BLUEPRINT_DETAIL_LIMIT;
  if (
    !Number.isSafeInteger(limit) ||
    Object.is(limit, -0) ||
    limit < 0 ||
    limit > MAX_BLUEPRINT_ENTITIES
  ) {
    throw new RangeError(
      `Blueprint detail limit must be from 0 to ${MAX_BLUEPRINT_ENTITIES}.`,
    );
  }
  return limit;
}

function footprint(
  kind: EntityKind,
  direction: Direction,
): { readonly width: number; readonly height: number } {
  const base = ENTITY_PROTOTYPES[kind].footprint;
  return direction === Direction.East || direction === Direction.West
    ? { width: base.height, height: base.width }
    : { width: base.width, height: base.height };
}

function selectDetailedIndices(
  placements: readonly Omit<BlueprintOverlayPlacement, "detailed">[],
  limit: number,
  focus: BlueprintOverlayInput["focus"],
): readonly number[] {
  if (limit === 0 || placements.length === 0) return Object.freeze([]);
  if (placements.length <= limit) {
    return Object.freeze(placements.map((placement) => placement.index));
  }

  const selected = new Set<number>();
  const add = (index: number | undefined): void => {
    if (
      index !== undefined &&
      index >= 0 &&
      index < placements.length &&
      selected.size < limit
    ) {
      selected.add(index);
    }
  };

  const representatives = new Map<string, number>();
  let minX = 0;
  let maxX = 0;
  let minZ = 0;
  let maxZ = 0;
  let focusIndex = 0;
  let focusDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index]!;
    const key = `${placement.state}:${placement.kind}`;
    if (!representatives.has(key)) representatives.set(key, index);
    if (placement.centerX < placements[minX]!.centerX) minX = index;
    if (placement.centerX > placements[maxX]!.centerX) maxX = index;
    if (placement.centerZ < placements[minZ]!.centerZ) minZ = index;
    if (placement.centerZ > placements[maxZ]!.centerZ) maxZ = index;
    if (focus) {
      const distance =
        (placement.centerX - focus.x) ** 2 +
        (placement.centerZ - focus.z) ** 2;
      if (distance < focusDistance) {
        focusDistance = distance;
        focusIndex = index;
      }
    }
  }
  if (focus) add(focusIndex);
  add(minX);
  add(maxX);
  add(minZ);
  add(maxZ);
  for (const index of representatives.values()) add(index);

  for (let slot = 0; slot < limit && selected.size < limit; slot += 1) {
    add(Math.floor((slot * placements.length) / limit));
  }
  for (let index = 0; index < placements.length && selected.size < limit; index += 1) {
    add(index);
  }
  return Object.freeze([...selected].sort((left, right) => left - right));
}

function hashText(hash: number, value: string): number {
  let next = hash;
  for (let index = 0; index < value.length; index += 1) {
    next ^= value.charCodeAt(index);
    next = Math.imul(next, 0x01000193);
  }
  return next >>> 0;
}

export function createBlueprintOverlayLayout(
  input: BlueprintOverlayInput,
): BlueprintOverlayLayout {
  const anchorX = safeCoordinate(input.anchorX, "Blueprint overlay anchorX");
  const anchorZ = safeCoordinate(input.anchorZ, "Blueprint overlay anchorZ");
  const width = safeSpan(input.width, "Blueprint overlay width");
  const height = safeSpan(input.height, "Blueprint overlay height");
  const detailLimit = safeDetailLimit(input.detailLimit);
  const focus =
    input.focus === undefined
      ? undefined
      : {
          x: safeFocusCoordinate(input.focus.x, "Blueprint overlay focus.x"),
          z: safeFocusCoordinate(input.focus.z, "Blueprint overlay focus.z"),
        };
  if (input.placements.length > MAX_BLUEPRINT_ENTITIES) {
    throw new RangeError(
      `Blueprint overlay exceeds ${MAX_BLUEPRINT_ENTITIES} placements.`,
    );
  }
  if (
    !Number.isSafeInteger(anchorX + width) ||
    !Number.isSafeInteger(anchorZ + height)
  ) {
    throw new RangeError("Blueprint overlay boundary exceeds safe coordinates.");
  }

  const provisional: Omit<BlueprintOverlayPlacement, "detailed">[] = [];
  const counts: Record<BlueprintOverlayState, number> = {
    construct: 0,
    configure: 0,
    match: 0,
    blocked: 0,
  };
  let hash = 0x811c9dc5;
  hash = hashText(
    hash,
    `${anchorX},${anchorZ},${width},${height},${detailLimit},${
      focus?.x ?? ""
    },${focus?.z ?? ""}`,
  );
  for (let index = 0; index < input.placements.length; index += 1) {
    const source = input.placements[index]!;
    const x = safeCoordinate(source.x, `Blueprint overlay placement ${index}.x`);
    const z = safeCoordinate(source.z, `Blueprint overlay placement ${index}.z`);
    if (
      !Number.isSafeInteger(source.direction) ||
      source.direction < Direction.North ||
      source.direction > Direction.West
    ) {
      throw new TypeError(
        `Blueprint overlay placement ${index}.direction is invalid.`,
      );
    }
    if (!(source.state in counts)) {
      throw new TypeError(
        `Blueprint overlay placement ${index}.state is invalid.`,
      );
    }
    const size = footprint(source.kind, source.direction);
    provisional.push({
      ...source,
      index,
      x,
      z,
      width: size.width,
      height: size.height,
      centerX: x + size.width * 0.5,
      centerZ: z + size.height * 0.5,
    });
    counts[source.state] += 1;
    hash = hashText(
      hash,
      `${source.kind}:${x}:${z}:${source.direction}:${source.state};`,
    );
  }

  const detailIndices = selectDetailedIndices(
    provisional,
    detailLimit,
    focus,
  );
  const detailed = new Set(detailIndices);
  const placements = Object.freeze(
    provisional.map((placement) =>
      Object.freeze({
        ...placement,
        detailed: detailed.has(placement.index),
      })
    ),
  );
  const mutableBatches = new Map<
    string,
    {
      kind: EntityKind;
      direction: Direction;
      state: BlueprintOverlayState;
      indices: number[];
    }
  >();
  for (const placement of placements) {
    const key =
      `${placement.state}:${placement.kind}:${placement.direction}`;
    const batch = mutableBatches.get(key) ?? {
      kind: placement.kind,
      direction: placement.direction,
      state: placement.state,
      indices: [],
    };
    batch.indices.push(placement.index);
    mutableBatches.set(key, batch);
  }
  const batches = Object.freeze(
    [...mutableBatches.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, batch]) =>
        Object.freeze({
          key,
          kind: batch.kind,
          direction: batch.direction,
          state: batch.state,
          indices: Object.freeze([...batch.indices]),
        })
      ),
  );

  return Object.freeze({
    signature:
      `${placements.length}-${(hash >>> 0).toString(16).padStart(8, "0")}`,
    anchor: Object.freeze({ x: anchorX, z: anchorZ }),
    boundary: Object.freeze({
      minX: anchorX,
      minZ: anchorZ,
      maxX: anchorX + width,
      maxZ: anchorZ + height,
    }),
    pivot: Object.freeze({ x: anchorX + 0.5, z: anchorZ + 0.5 }),
    placements,
    batches,
    detailIndices,
    counts: Object.freeze(counts),
  });
}

export function createBlueprintCaptureMarquee(
  anchorValue: { readonly x: number; readonly z: number },
  currentValue: { readonly x: number; readonly z: number },
  entities: readonly BlueprintCaptureEntityInput[],
): BlueprintCaptureMarquee {
  const anchor = {
    x: safeCoordinate(anchorValue.x, "Blueprint capture anchor.x"),
    z: safeCoordinate(anchorValue.z, "Blueprint capture anchor.z"),
  };
  const current = {
    x: safeCoordinate(currentValue.x, "Blueprint capture current.x"),
    z: safeCoordinate(currentValue.z, "Blueprint capture current.z"),
  };
  const minX = Math.min(anchor.x, current.x);
  const minZ = Math.min(anchor.z, current.z);
  const maxX = Math.max(anchor.x, current.x) + 1;
  const maxZ = Math.max(anchor.z, current.z) + 1;
  const width = safeSpan(maxX - minX, "Blueprint capture width");
  const height = safeSpan(maxZ - minZ, "Blueprint capture height");
  const tileCount = width * height;
  if (!Number.isSafeInteger(tileCount)) {
    throw new RangeError("Blueprint capture tile count exceeds safe bounds.");
  }
  const includedIds: Array<string | number> = [];
  for (let index = 0; index < entities.length; index += 1) {
    const entity = entities[index]!;
    const x = safeCoordinate(entity.x, `Blueprint capture entity ${index}.x`);
    const z = safeCoordinate(entity.z, `Blueprint capture entity ${index}.z`);
    const entityWidth = safeSpan(
      entity.width,
      `Blueprint capture entity ${index}.width`,
    );
    const entityHeight = safeSpan(
      entity.height,
      `Blueprint capture entity ${index}.height`,
    );
    if (
      x + entityWidth > minX &&
      x < maxX &&
      z + entityHeight > minZ &&
      z < maxZ
    ) {
      includedIds.push(entity.id);
    }
  }
  return Object.freeze({
    anchor: Object.freeze(anchor),
    current: Object.freeze(current),
    boundary: Object.freeze({ minX, minZ, maxX, maxZ }),
    width,
    height,
    tileCount,
    corners: Object.freeze([
      Object.freeze({ x: minX, z: minZ }),
      Object.freeze({ x: maxX, z: minZ }),
      Object.freeze({ x: maxX, z: maxZ }),
      Object.freeze({ x: minX, z: maxZ }),
    ]),
    includedIds: Object.freeze(includedIds),
  });
}
