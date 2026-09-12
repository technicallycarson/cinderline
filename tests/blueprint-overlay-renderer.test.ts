import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createBlueprintCaptureMarquee,
  createBlueprintOverlayLayout,
} from "../src/render/blueprintOverlay";
import { BlueprintOverlayRenderer } from "../src/render/BlueprintOverlayRenderer";
import { Direction } from "../src/game/types";

describe("BlueprintOverlayRenderer", () => {
  it("renders cached semantic batches, bounded details, and capture evidence", () => {
    const parent = new THREE.Group();
    const renderer = new BlueprintOverlayRenderer(parent);
    const layout = createBlueprintOverlayLayout({
      anchorX: 10,
      anchorZ: 12,
      width: 8,
      height: 6,
      detailLimit: 3,
      focus: { x: 13, z: 14 },
      placements: [
        {
          kind: "belt",
          x: 10,
          z: 12,
          direction: Direction.East,
          state: "construct",
        },
        {
          kind: "inserter",
          x: 11,
          z: 12,
          direction: Direction.South,
          state: "configure",
        },
        {
          kind: "smelter",
          x: 12,
          z: 13,
          direction: Direction.West,
          state: "match",
        },
        {
          kind: "storage",
          x: 15,
          z: 14,
          direction: Direction.North,
          state: "blocked",
        },
      ],
    });

    renderer.setOverlay(layout);
    const plan = renderer.root.getObjectByName("blueprint-plan-hologram")!;
    const originalChildren = [...plan.children];
    expect(renderer.getDebug()).toEqual({
      signature: layout.signature,
      total: 4,
      detailed: 3,
      batches: 4,
      counts: {
        construct: 1,
        configure: 1,
        match: 1,
        blocked: 1,
      },
      captureIncluded: 0,
    });
    expect(
      plan.getObjectByName("blueprint-plan-boundary"),
    ).toBeInstanceOf(THREE.LineSegments);
    expect(
      plan.getObjectByName("blueprint-plan-pivot"),
    ).toBeInstanceOf(THREE.Mesh);
    expect(
      plan.children.filter((child) => child.name.startsWith("blueprint-detail-")),
    ).toHaveLength(3);

    renderer.setOverlay(layout);
    expect(plan.children).toEqual(originalChildren);

    const marquee = createBlueprintCaptureMarquee(
      { x: 9, z: 11 },
      { x: 15, z: 15 },
      [
        { id: 1, x: 10, z: 12, width: 1, height: 1 },
        { id: 2, x: 12, z: 13, width: 2, height: 2 },
        { id: 3, x: 30, z: 30, width: 1, height: 1 },
      ],
    );
    renderer.setCaptureMarquee(marquee);
    expect(renderer.getDebug().captureIncluded).toBe(2);
    expect(
      renderer.root.getObjectByName("blueprint-capture-boundary"),
    ).toBeInstanceOf(THREE.LineSegments);
    expect(
      renderer.root.getObjectByName(
        "blueprint-capture-included-entity-register",
      ),
    ).toBeInstanceOf(THREE.InstancedMesh);

    renderer.setOverlay(null);
    expect(renderer.getDebug()).toEqual({
      signature: null,
      total: 0,
      detailed: 0,
      batches: 0,
      counts: {
        construct: 0,
        configure: 0,
        match: 0,
        blocked: 0,
      },
      captureIncluded: 2,
    });
    renderer.setCaptureMarquee(null);
    expect(renderer.getDebug().captureIncluded).toBe(0);

    renderer.dispose();
    expect(parent.children).not.toContain(renderer.root);
    expect(() => renderer.setOverlay(layout)).toThrow(/disposed/i);
  });

  it("keeps the 4,096-placement contract instanced and detail-bounded", () => {
    const parent = new THREE.Group();
    const renderer = new BlueprintOverlayRenderer(parent);
    const placements = Array.from({ length: 4_096 }, (_, index) => ({
      kind: "belt" as const,
      x: index % 64,
      z: Math.floor(index / 64),
      direction: (index % 4) as Direction,
      state: index % 31 === 0 ? ("blocked" as const) : ("construct" as const),
    }));
    const layout = createBlueprintOverlayLayout({
      anchorX: 0,
      anchorZ: 0,
      width: 64,
      height: 64,
      detailLimit: 96,
      placements,
    });

    renderer.setOverlay(layout);
    const debug = renderer.getDebug();
    expect(debug.total).toBe(4_096);
    expect(debug.detailed).toBe(96);
    expect(debug.batches).toBeLessThanOrEqual(8);
    const plan = renderer.root.getObjectByName("blueprint-plan-hologram")!;
    const plateMeshes = plan.children.filter((child) =>
      child.name.startsWith("blueprint-plate-"),
    );
    expect(plateMeshes).toHaveLength(debug.batches);
    expect(
      plateMeshes.every((mesh) => mesh instanceof THREE.InstancedMesh),
    ).toBe(true);

    renderer.dispose();
  });
});
