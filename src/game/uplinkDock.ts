import { Direction } from "./types";

export interface UplinkDockTile {
  readonly x: number;
  readonly z: number;
}

export interface UplinkDockGeometryInput {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly direction: Direction;
}

export interface UplinkDockDescriptor {
  /** The only cell that may contain a belt entering the Uplink. */
  readonly dockTile: UplinkDockTile;
  /** Neighboring rear lane used by the Phase-2 turn into the dock tile. */
  readonly legacyRearTile: UplinkDockTile;
  /** Direction that carries cargo from the neighboring lane into dockTile. */
  readonly approachDirection: Direction;
  /** Every perimeter cell protected from unrelated construction. */
  readonly reservedTiles: readonly UplinkDockTile[];
  readonly direction: Direction;
}

function directionAxes(direction: Direction): {
  readonly forward: UplinkDockTile;
  readonly right: UplinkDockTile;
} {
  switch (direction) {
    case Direction.North:
      return {
        forward: { x: 0, z: -1 },
        right: { x: 1, z: 0 },
      };
    case Direction.East:
      return {
        forward: { x: 1, z: 0 },
        right: { x: 0, z: 1 },
      };
    case Direction.South:
      return {
        forward: { x: 0, z: 1 },
        right: { x: -1, z: 0 },
      };
    case Direction.West:
      return {
        forward: { x: -1, z: 0 },
        right: { x: 0, z: -1 },
      };
  }
}

/**
 * Resolves the physical belt-to-carriage interface from the authoritative
 * Uplink footprint. The +0.5 right offset is the visibly offset cargo bridge;
 * the neighboring rear cell is intentionally reserved so a convincing but
 * nonfunctional second "dock" can never be built beside it.
 */
export function resolveUplinkDockDescriptor(
  uplink: UplinkDockGeometryInput,
): UplinkDockDescriptor {
  const centerX = uplink.x + uplink.width * 0.5;
  const centerZ = uplink.z + uplink.height * 0.5;
  const { forward, right } = directionAxes(uplink.direction);
  const tileAt = (
    forwardOffset: number,
    rightOffset: number,
  ): UplinkDockTile => ({
    x: Math.floor(
      centerX
      + forward.x * forwardOffset
      + right.x * rightOffset,
    ),
    z: Math.floor(
      centerZ
      + forward.z * forwardOffset
      + right.z * rightOffset,
    ),
  });
  const keyed = new Map<string, UplinkDockTile>();
  const reserve = (tile: UplinkDockTile): void => {
    keyed.set(`${tile.x}:${tile.z}`, tile);
  };

  for (const rightOffset of [-1.5, -0.5, 0.5, 1.5]) {
    reserve(tileAt(1.5, rightOffset));
  }
  for (const forwardOffset of [-0.5, 0.5]) {
    reserve(tileAt(forwardOffset, -1.5));
    reserve(tileAt(forwardOffset, 1.5));
  }
  // Protect both rear-adjacent footprint lanes. The canonical lane is later
  // granted only to a belt flowing in the Uplink's own direction.
  const legacyRearTile = tileAt(-1.5, -0.5);
  reserve(legacyRearTile);
  const dockTile = tileAt(-1.5, 0.5);
  reserve(dockTile);
  const approachDirection = (
    dockTile.x > legacyRearTile.x
      ? Direction.East
      : dockTile.x < legacyRearTile.x
        ? Direction.West
        : dockTile.z > legacyRearTile.z
          ? Direction.South
          : Direction.North
  );

  return {
    dockTile,
    legacyRearTile,
    approachDirection,
    reservedTiles: [...keyed.values()].sort(
      (left, rightTile) =>
        left.z - rightTile.z || left.x - rightTile.x,
    ),
    direction: uplink.direction,
  };
}

/**
 * The neighboring rear tile may carry a perpendicular approach that turns
 * onto the canonical dock belt. A belt facing the Uplink's own direction on
 * this tile is the old convincing-but-nonfunctional false dock instead.
 */
export function isUplinkDockApproachBelt(
  descriptor: UplinkDockDescriptor,
  belt: {
    readonly x: number;
    readonly z: number;
    readonly direction: Direction;
  },
): boolean {
  return (
    belt.x === descriptor.legacyRearTile.x
    && belt.z === descriptor.legacyRearTile.z
    && belt.direction === descriptor.approachDirection
  );
}

export function isLegacyUplinkRearBelt(
  descriptor: UplinkDockDescriptor,
  belt: {
    readonly x: number;
    readonly z: number;
    readonly direction: Direction;
  },
): boolean {
  return (
    belt.x === descriptor.legacyRearTile.x
    && belt.z === descriptor.legacyRearTile.z
    && belt.direction === descriptor.direction
  );
}

export function isCanonicalUplinkDockBelt(
  descriptor: UplinkDockDescriptor,
  belt: {
    readonly x: number;
    readonly z: number;
    readonly direction: Direction;
  },
): boolean {
  return (
    belt.x === descriptor.dockTile.x
    && belt.z === descriptor.dockTile.z
    && belt.direction === descriptor.direction
  );
}
