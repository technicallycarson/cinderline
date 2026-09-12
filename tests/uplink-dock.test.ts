import { describe, expect, it } from "vitest";

import {
  isCanonicalUplinkDockBelt,
  isLegacyUplinkRearBelt,
  isUplinkDockApproachBelt,
  resolveUplinkDockDescriptor,
} from "../src/game/uplinkDock";
import { Direction } from "../src/game/types";

const DIRECTION_STEP: Readonly<
  Record<Direction, { readonly x: number; readonly z: number }>
> = {
  [Direction.North]: { x: 0, z: -1 },
  [Direction.East]: { x: 1, z: 0 },
  [Direction.South]: { x: 0, z: 1 },
  [Direction.West]: { x: -1, z: 0 },
};

describe("Commission Uplink dock geometry", () => {
  it.each([
    [Direction.North, { x: 11, z: 12 }, { x: 10, z: 12 }],
    [Direction.East, { x: 9, z: 11 }, { x: 9, z: 10 }],
    [Direction.South, { x: 10, z: 9 }, { x: 11, z: 9 }],
    [Direction.West, { x: 12, z: 10 }, { x: 12, z: 11 }],
  ])(
    "keeps one canonical dock and reserves the false rear lane for direction %s",
    (direction, expectedDock, falseRearLane) => {
      const descriptor = resolveUplinkDockDescriptor({
        x: 10,
        z: 10,
        width: 2,
        height: 2,
        direction,
      });

      expect(descriptor.dockTile).toEqual(expectedDock);
      expect(descriptor.reservedTiles).toContainEqual(expectedDock);
      expect(descriptor.reservedTiles).toContainEqual(falseRearLane);
      expect(descriptor.legacyRearTile).toEqual(falseRearLane);
      expect(isCanonicalUplinkDockBelt(descriptor, {
        ...expectedDock,
        direction,
      })).toBe(true);
      expect(isCanonicalUplinkDockBelt(descriptor, {
        ...falseRearLane,
        direction,
      })).toBe(false);
      expect(isLegacyUplinkRearBelt(descriptor, {
        ...falseRearLane,
        direction,
      })).toBe(true);
      expect(isCanonicalUplinkDockBelt(descriptor, {
        ...expectedDock,
        direction: ((direction + 1) % 4) as Direction,
      })).toBe(false);
    },
  );

  it("matches the campaign's physical eastbound bridge at X21 Z12", () => {
    expect(resolveUplinkDockDescriptor({
      x: 22,
      z: 11,
      width: 2,
      height: 2,
      direction: Direction.East,
    }).dockTile).toEqual({ x: 21, z: 12 });
  });

  it.each([
    [Direction.North, Direction.East],
    [Direction.East, Direction.South],
    [Direction.South, Direction.West],
    [Direction.West, Direction.North],
  ])(
    "distinguishes the valid side approach from the legacy decoy for direction %s",
    (uplinkDirection, approachDirection) => {
      const descriptor = resolveUplinkDockDescriptor({
        x: 10,
        z: 10,
        width: 2,
        height: 2,
        direction: uplinkDirection,
      });
      const approachStep = DIRECTION_STEP[approachDirection];

      // The neighboring reserved cell is also the only one-cell predecessor
      // of the canonical dock. Clearance must therefore be direction-aware:
      // permit this turn into the dock, but continue rejecting a belt flowing
      // straight into the Uplink's non-dock rear lane.
      expect({
        x: descriptor.legacyRearTile.x + approachStep.x,
        z: descriptor.legacyRearTile.z + approachStep.z,
      }).toEqual(descriptor.dockTile);
      expect(approachDirection).toBe(
        ((uplinkDirection + 1) % 4) as Direction,
      );
      expect(isLegacyUplinkRearBelt(descriptor, {
        ...descriptor.legacyRearTile,
        direction: approachDirection,
      })).toBe(false);
      expect(isUplinkDockApproachBelt(descriptor, {
        ...descriptor.legacyRearTile,
        direction: approachDirection,
      })).toBe(true);
      expect(isUplinkDockApproachBelt(descriptor, {
        ...descriptor.legacyRearTile,
        direction: uplinkDirection,
      })).toBe(false);
      expect(isLegacyUplinkRearBelt(descriptor, {
        ...descriptor.legacyRearTile,
        direction: uplinkDirection,
      })).toBe(true);
    },
  );

  it("keeps X21 Z11 southbound available as the campaign dock approach", () => {
    const descriptor = resolveUplinkDockDescriptor({
      x: 22,
      z: 11,
      width: 2,
      height: 2,
      direction: Direction.East,
    });

    expect(descriptor.legacyRearTile).toEqual({ x: 21, z: 11 });
    expect({
      x: descriptor.legacyRearTile.x + DIRECTION_STEP[Direction.South].x,
      z: descriptor.legacyRearTile.z + DIRECTION_STEP[Direction.South].z,
    }).toEqual({ x: 21, z: 12 });
    expect(isLegacyUplinkRearBelt(descriptor, {
      x: 21,
      z: 11,
      direction: Direction.South,
    })).toBe(false);
    expect(isUplinkDockApproachBelt(descriptor, {
      x: 21,
      z: 11,
      direction: Direction.South,
    })).toBe(true);
    expect(isLegacyUplinkRearBelt(descriptor, {
      x: 21,
      z: 11,
      direction: Direction.East,
    })).toBe(true);
  });
});
