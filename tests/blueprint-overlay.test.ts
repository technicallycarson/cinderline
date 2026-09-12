import { describe, expect, it } from "vitest";

import { Direction } from "../src/game/types";
import {
  DEFAULT_BLUEPRINT_DETAIL_LIMIT,
  createBlueprintCaptureMarquee,
  createBlueprintOverlayLayout,
  type BlueprintOverlayPlacementInput,
} from "../src/render/blueprintOverlay";

describe("blueprint overlay layout", () => {
  it("retains every placement and partitions semantic render batches", () => {
    const placements: BlueprintOverlayPlacementInput[] = [
      {
        kind: "belt",
        x: 4,
        z: 7,
        direction: Direction.East,
        state: "construct",
      },
      {
        kind: "smelter",
        x: 5,
        z: 7,
        direction: Direction.North,
        state: "match",
      },
      {
        kind: "manifold",
        x: 7,
        z: 7,
        direction: Direction.South,
        state: "configure",
      },
      {
        kind: "gridRelay",
        x: 8,
        z: 7,
        direction: Direction.North,
        state: "blocked",
        reason: "occupied",
      },
    ];
    const layout = createBlueprintOverlayLayout({
      anchorX: 4,
      anchorZ: 7,
      width: 5,
      height: 3,
      placements,
    });

    expect(layout.placements).toHaveLength(4);
    expect(layout.detailIndices).toEqual([0, 1, 2, 3]);
    expect(layout.batches.flatMap((batch) => batch.indices).sort()).toEqual([
      0,
      1,
      2,
      3,
    ]);
    expect(layout.counts).toEqual({
      construct: 1,
      configure: 1,
      match: 1,
      blocked: 1,
    });
    expect(layout.boundary).toEqual({
      minX: 4,
      minZ: 7,
      maxX: 9,
      maxZ: 10,
    });
    expect(layout.pivot).toEqual({ x: 4.5, z: 7.5 });
  });

  it("uses rotated authoritative footprints", () => {
    const north = createBlueprintOverlayLayout({
      anchorX: 0,
      anchorZ: 0,
      width: 3,
      height: 2,
      placements: [
        {
          kind: "fabricator",
          x: 0,
          z: 0,
          direction: Direction.North,
          state: "construct",
        },
      ],
    }).placements[0]!;
    const east = createBlueprintOverlayLayout({
      anchorX: 0,
      anchorZ: 0,
      width: 2,
      height: 3,
      placements: [
        {
          kind: "fabricator",
          x: 0,
          z: 0,
          direction: Direction.East,
          state: "construct",
        },
      ],
    }).placements[0]!;

    expect({ width: north.width, height: north.height }).toEqual({
      width: 3,
      height: 2,
    });
    expect({ width: east.width, height: east.height }).toEqual({
      width: 2,
      height: 3,
    });
  });

  it("caps detailed rigs deterministically while every 4,096-unit silhouette remains batched", () => {
    const placements = Array.from(
      { length: 4_096 },
      (_, index): BlueprintOverlayPlacementInput => ({
        kind: index % 17 === 0 ? "smelter" : "belt",
        x: index % 64,
        z: Math.floor(index / 64),
        direction: (index % 4) as Direction,
        state:
          index % 29 === 0
            ? "blocked"
            : index % 19 === 0
              ? "match"
              : "construct",
      }),
    );
    const input = {
      anchorX: 0,
      anchorZ: 0,
      width: 64,
      height: 64,
      placements,
      focus: { x: 31.5, z: 31.5 },
    } as const;
    const first = createBlueprintOverlayLayout(input);
    const second = createBlueprintOverlayLayout(input);
    const batched = first.batches.flatMap((batch) => batch.indices);

    expect(first.placements).toHaveLength(4_096);
    expect(first.detailIndices).toHaveLength(DEFAULT_BLUEPRINT_DETAIL_LIMIT);
    expect(first.detailIndices).toEqual(second.detailIndices);
    expect(first.signature).toBe(second.signature);
    expect(new Set(batched).size).toBe(4_096);
    expect(Math.min(...batched)).toBe(0);
    expect(Math.max(...batched)).toBe(4_095);
    expect(first.placements.filter((placement) => placement.detailed)).toHaveLength(
      DEFAULT_BLUEPRINT_DETAIL_LIMIT,
    );
  });

  it("changes its render signature when detail policy or focus changes", () => {
    const placements = Array.from(
      { length: 120 },
      (_, index): BlueprintOverlayPlacementInput => ({
        kind: index % 9 === 0 ? "smelter" : "belt",
        x: index % 20,
        z: Math.floor(index / 20),
        direction: Direction.East,
        state: "construct",
      }),
    );
    const baseline = createBlueprintOverlayLayout({
      anchorX: 0,
      anchorZ: 0,
      width: 20,
      height: 8,
      placements,
      detailLimit: 12,
      focus: { x: 1, z: 1 },
    });
    const differentLimit = createBlueprintOverlayLayout({
      anchorX: 0,
      anchorZ: 0,
      width: 20,
      height: 8,
      placements,
      detailLimit: 13,
      focus: { x: 1, z: 1 },
    });
    const differentFocus = createBlueprintOverlayLayout({
      anchorX: 0,
      anchorZ: 0,
      width: 20,
      height: 8,
      placements,
      detailLimit: 12,
      focus: { x: 18, z: 6 },
    });

    expect(differentLimit.signature).not.toBe(baseline.signature);
    expect(differentFocus.signature).not.toBe(baseline.signature);
    expect(differentLimit.detailIndices).toHaveLength(13);
    expect(differentFocus.detailIndices).not.toEqual(baseline.detailIndices);
  });

  it("creates an order-independent inclusive drag marquee and intersecting entity tint set", () => {
    const entities = [
      { id: 1, x: 5, z: 4, width: 2, height: 2 },
      { id: 2, x: 9, z: 6, width: 1, height: 1 },
      { id: 3, x: 12, z: 12, width: 2, height: 2 },
    ];
    const forward = createBlueprintCaptureMarquee(
      { x: 5, z: 4 },
      { x: 9, z: 6 },
      entities,
    );
    const reverse = createBlueprintCaptureMarquee(
      { x: 9, z: 6 },
      { x: 5, z: 4 },
      entities,
    );

    expect(forward.boundary).toEqual({
      minX: 5,
      minZ: 4,
      maxX: 10,
      maxZ: 7,
    });
    expect(forward.tileCount).toBe(15);
    expect(forward.includedIds).toEqual([1, 2]);
    expect(reverse.boundary).toEqual(forward.boundary);
    expect(reverse.includedIds).toEqual(forward.includedIds);
    expect(forward.corners).toHaveLength(4);
  });

  it("rejects overlays beyond the construction kernel limits", () => {
    expect(() =>
      createBlueprintOverlayLayout({
        anchorX: 0,
        anchorZ: 0,
        width: 1_025,
        height: 1,
        placements: [],
      })
    ).toThrow(/span/);
    expect(() =>
      createBlueprintOverlayLayout({
        anchorX: 0,
        anchorZ: 0,
        width: 1,
        height: 1,
        placements: Array.from(
          { length: 4_097 },
          (): BlueprintOverlayPlacementInput => ({
            kind: "belt",
            x: 0,
            z: 0,
            direction: Direction.North,
            state: "construct",
          }),
        ),
      })
    ).toThrow(/4096/);
    expect(() =>
      createBlueprintOverlayLayout({
        anchorX: 0,
        anchorZ: 0,
        width: 1,
        height: 1,
        placements: [],
        focus: { x: Number.NaN, z: 0 },
      })
    ).toThrow(/focus\.x/);
  });
});
