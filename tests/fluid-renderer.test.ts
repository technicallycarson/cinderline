import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  FluidRenderer,
  type FluidVisualEntity,
  type FluidVisualFrame,
} from "../src/render/FluidRenderer";
import {
  Direction,
  type FluidBufferState,
  type FluidEntityKind,
  type FluidEntityState,
  type FluidId,
  type FluidNetworkNodeSnapshot,
  type FluidNetworkSnapshot,
} from "../src/game/types";

function buffer(
  capacityMilli: number,
  fluidId?: FluidId,
  amountMilli = 0,
): FluidBufferState {
  return {
    ...(fluidId ? { fluidId } : {}),
    amountMilli,
    capacityMilli,
  };
}

function entity(
  id: number,
  kind: FluidEntityKind,
  x: number,
  z: number,
  fluidState: FluidEntityState,
  status: FluidVisualEntity["status"] = "working",
): FluidVisualEntity {
  return {
    id,
    kind,
    x,
    z,
    direction: Direction.East,
    status,
    powerSatisfaction: 1,
    fluidState,
  };
}

function node(
  entityId: number,
  role: FluidNetworkNodeSnapshot["role"],
  fluidId: FluidId | undefined,
  amountMilli: number,
  capacityMilli = 100_000,
): FluidNetworkNodeSnapshot {
  return {
    entityId,
    role,
    componentId: 1,
    x: entityId,
    y: 0,
    ...(fluidId ? { fluidId } : {}),
    amountMilli,
    capacityMilli,
    incomingEdgeCount: 1,
    outgoingEdgeCount: 1,
  };
}

function frame(
  fluidEntities: readonly FluidVisualEntity[],
  fluidNetwork: FluidNetworkSnapshot,
  elapsedSeconds = 2.5,
): FluidVisualFrame {
  return { elapsedSeconds, fluidEntities, fluidNetwork };
}

describe("FluidRenderer", () => {
  it("keeps processor-only fractionation hardware out of extraction rigs", () => {
    const parent = new THREE.Group();
    const renderer = new FluidRenderer(parent);
    const source = entity(41, "fluidSource", 0, 0, {
      sourceFluidId: "crudeOil",
      processTicks: 0,
      buffer: buffer(20_000, "crudeOil", 8_000),
    });
    renderer.sync(
      frame([source], {
        nodes: [node(41, "buffer", "crudeOil", 8_000, 20_000)],
        edges: [],
        components: [],
      }),
    );

    const sourceRig = parent.getObjectByName("fluid-fluidSource-rig");
    expect(sourceRig).toBeDefined();
    expect(
      sourceRig?.getObjectByName(
        "fluid-processor-swept-overhead-fraction-line",
      ),
    ).toBeUndefined();
    expect(
      sourceRig?.getObjectByName(
        "fluid-processor-asymmetric-knockout-drum",
      ),
    ).toBeUndefined();
    expect(
      sourceRig?.getObjectByName(
        "fluid-processor-combustion-exhaust-stack",
      ),
    ).toBeUndefined();
    expect(
      sourceRig?.getObjectByName("fluid-source-reciprocating-beam"),
    ).toBeDefined();
    expect(
      sourceRig?.getObjectByName("fluid-source-polished-rod"),
    ).toBeDefined();

    renderer.dispose();
  });

  it("renders every fluid machine family with truthful levels, flow, and lifecycle cleanup", () => {
    const parent = new THREE.Group();
    const renderer = new FluidRenderer(parent);
    const entities = [
      entity(1, "fluidSource", 0, 0, {
        sourceFluidId: "crudeOil",
        processTicks: 0,
        buffer: buffer(20_000, "crudeOil", 10_000),
      }),
      entity(2, "fluidPump", 2, 0, {
        processTicks: 0,
        buffer: buffer(20_000, "crudeOil", 8_000),
      }),
      entity(3, "fluidPipe", 3, 0, {
        processTicks: 0,
        buffer: buffer(10_000, "crudeOil", 7_000),
      }),
      entity(4, "fluidTank", 4, 0, {
        processTicks: 0,
        buffer: buffer(100_000, "crudeOil", 45_000),
      }),
      entity(5, "fluidProcessor", 7, 0, {
        recipeId: "refineCrude",
        processTicks: 18,
        input: buffer(30_000, "crudeOil", 6_000),
        output: buffer(30_000, "refinedFuel", 12_000),
      }),
      entity(6, "fluidPipe", 10, 0, {
        processTicks: 0,
        buffer: buffer(10_000, "refinedFuel", 5_000),
      }),
      entity(7, "fluidTank", 11, 0, {
        processTicks: 0,
        buffer: buffer(100_000, "refinedFuel", 26_000),
      }),
    ] as const;
    const nodes = [
      node(1, "buffer", "crudeOil", 10_000),
      node(2, "buffer", "crudeOil", 8_000),
      node(3, "buffer", "crudeOil", 7_000),
      node(4, "buffer", "crudeOil", 45_000),
      node(5, "input", "crudeOil", 6_000),
      node(5, "output", "refinedFuel", 12_000),
      node(6, "buffer", "refinedFuel", 5_000),
      node(7, "buffer", "refinedFuel", 26_000),
    ] as const;
    const network: FluidNetworkSnapshot = {
      nodes: [...nodes],
      edges: [
        {
          sourceEntityId: 1,
          sourceRole: "buffer",
          targetEntityId: 2,
          targetRole: "buffer",
          throughputMilliPerTick: 300,
        },
        {
          sourceEntityId: 2,
          sourceRole: "buffer",
          targetEntityId: 3,
          targetRole: "buffer",
          throughputMilliPerTick: 300,
        },
        {
          sourceEntityId: 3,
          sourceRole: "buffer",
          targetEntityId: 4,
          targetRole: "buffer",
          throughputMilliPerTick: 300,
        },
        {
          sourceEntityId: 4,
          sourceRole: "buffer",
          targetEntityId: 5,
          targetRole: "input",
          throughputMilliPerTick: 300,
        },
        {
          sourceEntityId: 5,
          sourceRole: "output",
          targetEntityId: 6,
          targetRole: "buffer",
          throughputMilliPerTick: 250,
        },
        {
          sourceEntityId: 6,
          sourceRole: "buffer",
          targetEntityId: 7,
          targetRole: "buffer",
          throughputMilliPerTick: 250,
        },
      ],
      components: [],
    };

    renderer.sync(frame(entities, network));

    expect(parent.getObjectByName("fluid-world-system")).toBe(renderer.root);
    expect(
      parent.getObjectByName(
        "fluid-refinery-district-modular-equipment-pours-and-service-strips",
      ),
    ).toBeDefined();
    expect(
      parent.getObjectByName(
        "fluid-refinery-district-local-drain-grates-and-catch-sumps",
      ),
    ).toBeDefined();
    expect(
      parent.getObjectByName(
        "fluid-refinery-district-local-physical-safety-markings",
      ),
    ).toBeDefined();
    expect(
      parent.getObjectByName(
        "fluid-refinery-district-structural-pipe-racks-and-service-bridges",
      ),
    ).toBeDefined();
    expect(
      parent.getObjectByName(
        "fluid-refinery-district-authoritative-main-headers-and-branches",
      ),
    ).toBeDefined();
    expect(
      parent.getObjectByName(
        "fluid-refinery-district-real-flanges-and-elbow-fittings",
      ),
    ).toBeDefined();
    expect(
      parent.getObjectByName(
        "fluid-refinery-district-connected-catwalks-and-access-grating",
      ),
    ).toBeDefined();
    expect(
      parent.getObjectByName(
        "fluid-refinery-district-readable-source-and-processor-cladding",
      ),
    ).toBeDefined();
    expect(
      parent.getObjectByName(
        "fluid-refinery-district-localized-oil-and-rust-wear",
      ),
    ).toBeDefined();
    expect(parent.getObjectByName("fluid-source-visible-level")).toBeUndefined();
    expect(parent.getObjectByName("fluid-fluidSource-rig")).toBeDefined();
    expect(parent.getObjectByName("fluid-fluidPump-rig")).toBeDefined();
    expect(parent.getObjectByName("fluid-fluidTank-rig")).toBeDefined();
    expect(parent.getObjectByName("fluid-fluidProcessor-rig")).toBeDefined();
    expect(
      parent.getObjectByName(
        "fluid-tank-family-a-steam-traced-coil-package",
      ),
    ).toBeDefined();
    expect(
      parent.getObjectByName(
        "fluid-tank-family-b-ladder-catwalk-package",
      ),
    ).toBeDefined();
    expect(
      parent.getObjectByName(
        "fluid-tank-family-c-tall-vent-and-custody-package",
      ),
    ).toBeDefined();
    expect(
      parent.getObjectByName(
        "fluid-tank-family-d-compact-buffer-vessel-package",
      ),
    ).toBeDefined();
    expect(parent.getObjectByName("fluid-network-crude-flow-pulses")).toBeDefined();
    expect(parent.getObjectByName("fluid-network-refined-flow-pulses")).toBeDefined();
    const mirroredLevels: THREE.Object3D[] = [];
    parent.traverse((object) => {
      if (object.name === "fluid-tank-visible-level-mirrored") {
        mirroredLevels.push(object);
      }
    });
    expect(mirroredLevels).toHaveLength(6);
    expect(
      parent.getObjectByName("fluid-fluidSource-rig")?.userData.entityId,
    ).toBe(1);
    expect(
      parent.getObjectByName("fluid-pipe-shells")?.userData.entityIds,
    ).toEqual([3, 3, 6, 6]);
    expect(
      parent.getObjectByName("fluid-pipe-flanges")?.userData.entityIds,
    ).toEqual([3, 3, 6, 6]);
    expect(
      parent.getObjectByName("fluid-pipe-load-bearing-saddles")?.userData
        .entityIds,
    ).toEqual([3, 6]);
    expect(
      parent.getObjectByName("fluid-tank-top-contents-bezel")?.userData
        .fillRatio,
    ).toBeCloseTo(0.45);
    expect(
      parent.getObjectByName("fluid-tank-top-level-needle")?.userData
        .fillRatio,
    ).toBeCloseTo(0.45);
    expect(renderer.getDebug()).toMatchObject({
      entities: 7,
      pipes: 2,
      sources: 1,
      pumps: 1,
      tanks: 2,
      processors: 1,
      edges: 6,
      flowPulses: 6,
      drawBatches: 13,
      storedMilli: {
        crudeOil: 76_000,
        refinedFuel: 43_000,
      },
    });

    const crudeSight = parent.getObjectByName(
      "fluid-tank-visible-level",
    ) as THREE.Mesh;
    expect(crudeSight.visible).toBe(false);
    expect(crudeSight.scale.y).toBeCloseTo(0.45);
    expect(crudeSight.userData).toMatchObject({
      presentationRetired: true,
      retiredReason:
        "replaced-by-one-family-parented-authoritative-custody-station",
    });
    const authoritativeTankLevels: THREE.Object3D[] = [];
    parent.traverse((object) => {
      if (
        object.name ===
        "fluid-tank-pass6-authoritative-custody-column-fill"
      ) {
        authoritativeTankLevels.push(object);
      }
    });
    const isEffectivelyVisible = (object: THREE.Object3D): boolean => {
      let current: THREE.Object3D | null = object;
      while (current) {
        if (!current.visible) return false;
        current = current.parent;
      }
      return true;
    };
    expect(
      authoritativeTankLevels.filter(isEffectivelyVisible),
    ).toHaveLength(2);
    expect(
      authoritativeTankLevels
        .filter(isEffectivelyVisible)
        .some(
          ({ userData }) =>
            Math.abs(Number(userData.fillRatio) - 0.45) < 0.0001,
        ),
    ).toBe(true);
    const status = parent.getObjectByName(
      "fluid-fluidProcessor-status",
    ) as THREE.Mesh;
    expect(status.material).toBeDefined();
    expect(
      parent.getObjectByName("fluid-processor-fractionation-tower"),
    ).toBeDefined();
    expect(
      parent.getObjectByName("fluid-processor-shell-tube-exchanger"),
    ).toBeDefined();
    expect(
      parent.getObjectByName("fluid-processor-crude-input-window")?.userData
        .fillRatio,
    ).toBeCloseTo(0.2);
    expect(
      parent.getObjectByName("fluid-processor-refined-output-window")?.userData
        .fillRatio,
    ).toBeCloseTo(0.4);
    expect(
      parent.getObjectByName("fluid-processor-crude-side-input-window")
        ?.userData.fillRatio,
    ).toBeCloseTo(0.2);
    expect(
      parent.getObjectByName("fluid-processor-refined-side-output-window")
        ?.userData.fillRatio,
    ).toBeCloseTo(0.4);
    expect(
      parent.getObjectByName("fluid-processor-authoritative-steam-plume")
        ?.visible,
    ).toBe(false);

    renderer.sync(frame([], { nodes: [], edges: [], components: [] }, 4));
    expect(renderer.root.visible).toBe(false);
    expect(renderer.getDebug()).toMatchObject({
      entities: 0,
      pipes: 0,
      sources: 0,
      pumps: 0,
      tanks: 0,
      processors: 0,
      edges: 0,
      flowPulses: 0,
      drawBatches: 0,
    });
    expect(parent.getObjectByName("fluid-fluidSource-rig")).toBeUndefined();

    renderer.dispose();
    renderer.dispose();
    expect(parent.getObjectByName("fluid-world-system")).toBeUndefined();
    expect(() =>
      renderer.sync(frame([], { nodes: [], edges: [], components: [] })),
    ).toThrow("Fluid renderer is disposed.");
  });

  it("holds a thousand-pipe refinery trunk to eight instanced draw batches", () => {
    const parent = new THREE.Group();
    const renderer = new FluidRenderer(parent);
    const count = 1_024;
    const entities: FluidVisualEntity[] = [];
    const nodes: FluidNetworkNodeSnapshot[] = [];
    const edges: FluidNetworkSnapshot["edges"] = [];
    for (let index = 0; index < count; index += 1) {
      const fluidId: FluidId =
        index < count / 2 ? "crudeOil" : "refinedFuel";
      entities.push(
        entity(index + 1, "fluidPipe", index, 0, {
          processTicks: 0,
          buffer: buffer(10_000, fluidId, 5_000),
        }),
      );
      nodes.push(node(index + 1, "buffer", fluidId, 5_000, 10_000));
      if (index > 0) {
        edges.push({
          sourceEntityId: index,
          sourceRole: "buffer",
          targetEntityId: index + 1,
          targetRole: "buffer",
          throughputMilliPerTick: 200,
        });
      }
    }

    renderer.sync(
      frame(entities, { nodes, edges, components: [] }, 12.25),
    );

    const instanced: THREE.InstancedMesh[] = [];
    renderer.root.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) instanced.push(object);
    });
    expect(instanced).toHaveLength(8);
    expect(renderer.getDebug()).toMatchObject({
      entities: count,
      pipes: count,
      edges: count - 1,
      flowPulses: count - 1,
      drawBatches: 8,
      storedMilli: {
        crudeOil: 2_560_000,
        refinedFuel: 2_560_000,
      },
    });
    expect(
      (
        parent.getObjectByName(
          "fluid-pipe-shells",
        ) as THREE.InstancedMesh
      ).count,
    ).toBe(count * 2 - 2);
    expect(
      (
        parent.getObjectByName(
          "fluid-network-coupling-hoses",
        ) as THREE.InstancedMesh
      ).count,
    ).toBe(count - 1);

    renderer.dispose();
  });

  it("derives pipe arms from authoritative branch topology and keeps couplings at footprint seams", () => {
    const parent = new THREE.Group();
    const renderer = new FluidRenderer(parent);
    const pipes = [
      entity(1, "fluidPipe", 1, 1, {
        processTicks: 0,
        buffer: buffer(10_000, "crudeOil", 5_000),
      }),
      entity(2, "fluidPipe", 2, 1, {
        processTicks: 0,
        buffer: buffer(10_000, "crudeOil", 5_000),
      }),
      {
        ...entity(3, "fluidPipe", 2, 2, {
          processTicks: 0,
          buffer: buffer(10_000, "crudeOil", 5_000),
        }),
        direction: Direction.North,
      },
    ] as const;
    const network: FluidNetworkSnapshot = {
      nodes: pipes.map(({ id }) =>
        node(id, "buffer", "crudeOil", 5_000, 10_000),
      ),
      edges: [
        {
          sourceEntityId: 1,
          sourceRole: "buffer",
          targetEntityId: 2,
          targetRole: "buffer",
          throughputMilliPerTick: 200,
        },
        {
          sourceEntityId: 2,
          sourceRole: "buffer",
          targetEntityId: 3,
          targetRole: "buffer",
          throughputMilliPerTick: 200,
        },
      ],
      components: [],
    };

    renderer.sync(frame(pipes, network));

    const supports = parent.getObjectByName(
      "fluid-pipe-load-bearing-saddles",
    ) as THREE.InstancedMesh;
    const centerTopology = (
      supports.userData.topologyFaces as Array<{
        entityId: number;
        faces: Direction[];
      }>
    ).find(({ entityId }) => entityId === 2);
    expect(new Set(centerTopology?.faces)).toEqual(
      new Set([Direction.South, Direction.West]),
    );
    const shells = parent.getObjectByName(
      "fluid-pipe-shells",
    ) as THREE.InstancedMesh;
    expect(
      (shells.userData.entityIds as number[]).filter((id) => id === 2),
    ).toHaveLength(2);

    const couplings = parent.getObjectByName(
      "fluid-network-coupling-hoses",
    ) as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    couplings.getMatrixAt(0, matrix);
    matrix.decompose(position, quaternion, scale);
    expect(position.x).toBeCloseTo(2);
    expect(position.y).toBeCloseTo(0.52);
    expect(position.z).toBeCloseTo(1.5);
    expect(scale.y).toBeCloseTo(0.34);
    expect(couplings.userData).toMatchObject({
      topologySource: "authoritative-fluid-edges",
      presentation: "authoritative-boundary-pressure-coupling",
      edgeEntityIds: [
        [1, 2],
        [2, 3],
      ],
    });

    renderer.dispose();
  });

  it("binds moving hardware to working and backpressure state", () => {
    const parent = new THREE.Group();
    const renderer = new FluidRenderer(parent);
    const source = entity(11, "fluidSource", 0, 0, {
      sourceFluidId: "crudeOil",
      processTicks: 7,
      buffer: buffer(20_000, "crudeOil", 12_000),
    });
    const pump = entity(12, "fluidPump", 3, 0, {
      processTicks: 7,
      buffer: buffer(20_000, "crudeOil", 9_000),
    });
    const processor = entity(13, "fluidProcessor", 6, 0, {
      recipeId: "refineCrude",
      processTicks: 7,
      input: buffer(30_000, "crudeOil", 15_000),
      output: buffer(30_000, "refinedFuel", 9_000),
    });
    const network: FluidNetworkSnapshot = {
      nodes: [
        node(11, "buffer", "crudeOil", 12_000, 20_000),
        node(12, "buffer", "crudeOil", 9_000, 20_000),
        node(13, "input", "crudeOil", 15_000, 30_000),
        node(13, "output", "refinedFuel", 9_000, 30_000),
      ],
      edges: [],
      components: [],
    };

    renderer.sync(frame([source, pump, processor], network, 0.2));
    const walkingBeam = parent.getObjectByName(
      "fluid-source-reciprocating-beam",
    )!;
    const polishedRod = parent.getObjectByName("fluid-source-polished-rod")!;
    const pitman = parent.getObjectByName(
      "fluid-source-crank-pitman-link",
    )!;
    const impeller = parent.getObjectByName(
      "fluid-pump-visible-impeller",
    )!;
    const firstBeamAngle = walkingBeam.userData.beamAngle as number;
    const firstStroke = polishedRod.userData.stroke as number;
    const firstImpellerRotation = impeller.rotation.z;

    renderer.sync(frame([source, pump, processor], network, 0.8));
    expect(walkingBeam.userData.beamAngle).not.toBeCloseTo(firstBeamAngle);
    expect(polishedRod.userData.stroke).not.toBeCloseTo(firstStroke);
    expect(pitman.userData).toMatchObject({
      beamAngle: walkingBeam.userData.beamAngle,
      crankPhase: walkingBeam.userData.crankPhase,
    });
    expect(impeller.rotation.z).not.toBeCloseTo(firstImpellerRotation);
    expect(
      parent.getObjectByName("fluid-pump-discharge-valve-position")?.userData
        .openRatio,
    ).toBeCloseTo(0.86);
    expect(
      parent.getObjectByName("fluid-processor-authoritative-burner-window")
        ?.visible,
    ).toBe(true);
    expect(
      (
        parent.getObjectByName(
          "fluid-processor-localized-furnace-light",
        ) as THREE.PointLight
      ).intensity,
    ).toBeCloseTo(1.08);
    expect(
      parent.getObjectByName("fluid-fluidProcessor-status-halo"),
    ).toBeUndefined();
    expect(
      parent.getObjectByName(
        "fluid-processor-mechanical-shutdown-trip-gate",
      )?.userData,
    ).toMatchObject({
      operatingState: "trip-gate-clear",
      travelRatio: 1,
    });

    const blockedProcessor = {
      ...processor,
      status: "outputFull" as const,
    };
    renderer.sync(frame([source, pump, blockedProcessor], network, 1.1));
    const blockedRotor = parent.getObjectByName(
      "fluid-processor-metering-rotor",
    )!;
    const blockedRotorRotation = blockedRotor.rotation.z;
    expect(
      parent.getObjectByName("fluid-processor-backpressure-handwheel")
        ?.userData,
    ).toMatchObject({ backpressured: true, openRatio: 1 });
    expect(
      parent.getObjectByName("fluid-processor-relief-cap")?.userData.lift,
    ).toBeGreaterThan(0.07);
    expect(
      parent.getObjectByName("fluid-processor-authoritative-steam-plume")
        ?.userData.operatingState,
    ).toBe("relieving-backpressure");
    expect(
      parent.getObjectByName("fluid-processor-gauge-needle")?.userData
        .pressureRatio,
    ).toBe(1);
    expect(
      parent.getObjectByName(
        "fluid-processor-mechanical-shutdown-trip-gate",
      )?.userData,
    ).toMatchObject({
      operatingState: "trip-gate-seated",
      travelRatio: 0,
    });
    expect(
      parent.getObjectByName("fluid-processor-product-isolation-valve")
        ?.userData,
    ).toMatchObject({
      operatingState: "mechanically-closed",
      openRatio: 0.05,
    });
    renderer.sync(frame([source, pump, blockedProcessor], network, 2.1));
    expect(blockedRotor.rotation.z).toBeCloseTo(blockedRotorRotation);

    renderer.dispose();
  });

  it("makes all five fractionation states mechanically and causally distinct", () => {
    const parent = new THREE.Group();
    const renderer = new FluidRenderer(parent);
    const processorId = 23;
    const syncProcessor = (
      status: FluidVisualEntity["status"],
      inputAmount: number,
      outputAmount: number,
      elapsedSeconds: number,
    ): THREE.Group => {
      const processor = entity(
        processorId,
        "fluidProcessor",
        0,
        0,
        {
          recipeId: "refineCrude",
          processTicks: Math.round(elapsedSeconds * 10),
          input: buffer(
            30_000,
            inputAmount > 0 ? "crudeOil" : undefined,
            inputAmount,
          ),
          output: buffer(
            30_000,
            outputAmount > 0 ? "refinedFuel" : undefined,
            outputAmount,
          ),
        },
        status,
      );
      renderer.sync(
        frame(
          [processor],
          {
            nodes: [
              node(
                processorId,
                "input",
                inputAmount > 0 ? "crudeOil" : undefined,
                inputAmount,
                30_000,
              ),
              node(
                processorId,
                "output",
                outputAmount > 0 ? "refinedFuel" : undefined,
                outputAmount,
                30_000,
              ),
            ],
            edges: [],
            components: [],
          },
          elapsedSeconds,
        ),
      );
      return parent.getObjectByName(
        "fluid-fluidProcessor-rig",
      ) as THREE.Group;
    };
    const namedObjects = (name: string): THREE.Object3D[] => {
      const matches: THREE.Object3D[] = [];
      parent.traverse((object) => {
        if (object.name === name) matches.push(object);
      });
      return matches;
    };

    let rig = syncProcessor("idle", 0, 0, 0);
    const stages = namedObjects(
      "fluid-processor-pass6-fractionation-stage-shutter",
    );
    const plumes = namedObjects(
      "fluid-processor-authoritative-steam-plume",
    );
    const feedSlug = parent.getObjectByName(
      "fluid-processor-pass6-authoritative-feed-slug",
    )!;
    const productSlug = parent.getObjectByName(
      "fluid-processor-pass6-authoritative-product-slug",
    )!;
    const reliefSpring = parent.getObjectByName(
      "fluid-processor-pass6-primary-relief-spring",
    )!;
    expect(stages).toHaveLength(5);
    expect(plumes).toHaveLength(1);
    expect(rig.userData).toMatchObject({
      processStage: 0,
      processStageName: "cold-and-empty",
      engagedFractionationStages: 0,
    });
    expect(stages.every(({ userData }) => !userData.stageEngaged)).toBe(true);
    expect(feedSlug.visible).toBe(false);
    expect(productSlug.visible).toBe(false);
    expect(plumes[0]?.visible).toBe(false);

    rig = syncProcessor("missingInput", 6_000, 0, 1);
    expect(rig.userData).toMatchObject({
      processStage: 1,
      processStageName: "crude-feed-primed",
      engagedFractionationStages: 1,
    });
    expect(
      stages.filter(({ userData }) => userData.stageEngaged),
    ).toHaveLength(1);
    expect(feedSlug.visible).toBe(true);
    expect(feedSlug.userData.operatingState).toBe("feed-arriving");
    expect(productSlug.visible).toBe(false);

    rig = syncProcessor("working", 24_000, 3_000, 2);
    expect(rig.userData).toMatchObject({
      processStage: 2,
      processStageName: "fired-fractionation",
      engagedFractionationStages: 5,
    });
    expect(stages.every(({ userData }) => userData.stageEngaged)).toBe(true);
    expect(feedSlug.userData.operatingState).toBe("metered-feed");
    expect(productSlug.userData.operatingState).toBe(
      "condensate-transfer",
    );

    rig = syncProcessor("working", 29_000, 12_000, 3);
    expect(rig.userData).toMatchObject({
      processStage: 3,
      processStageName: "product-transfer",
      engagedFractionationStages: 5,
    });
    expect(productSlug.visible).toBe(true);
    expect(productSlug.userData.fillRatio).toBeCloseTo(0.4);

    rig = syncProcessor("outputFull", 30_000, 30_000, 4);
    expect(rig.userData).toMatchObject({
      processStage: 4,
      processStageName: "storage-backpressure",
      engagedFractionationStages: 5,
      lifecycleCausality:
        "input-custody>feed-slug>valve-and-metering-rotor>burner>five-stage-tower>condenser>product-slug>output-custody",
    });
    expect(productSlug.userData.operatingState).toBe(
      "pressure-held-product",
    );
    expect(reliefSpring.scale.y).toBeCloseTo(0.68);
    expect(reliefSpring.userData.compressionRatio).toBeCloseTo(0.32);
    expect(plumes[0]?.visible).toBe(true);
    expect(plumes[0]?.userData).toMatchObject({
      operatingState: "relieving-backpressure",
      presentation: "restrained-primary-relief",
    });

    renderer.dispose();
  });

  it("ties every tank family custody column, gauge, spring, and vent to fill", () => {
    const parent = new THREE.Group();
    const renderer = new FluidRenderer(parent);
    const tankId = 29;
    const syncTank = (amountMilli: number, elapsedSeconds: number) => {
      const tank = entity(
        tankId,
        "fluidTank",
        0,
        0,
        {
          processTicks: 0,
          buffer: buffer(
            100_000,
            amountMilli > 0 ? "refinedFuel" : undefined,
            amountMilli,
          ),
        },
        amountMilli >= 100_000 ? "outputFull" : "idle",
      );
      renderer.sync(
        frame(
          [tank],
          {
            nodes: [
              node(
                tankId,
                "buffer",
                amountMilli > 0 ? "refinedFuel" : undefined,
                amountMilli,
                100_000,
              ),
            ],
            edges: [],
            components: [],
          },
          elapsedSeconds,
        ),
      );
      return parent.getObjectByName("fluid-fluidTank-rig") as THREE.Group;
    };
    const namedObjects = (name: string): THREE.Object3D[] => {
      const matches: THREE.Object3D[] = [];
      parent.traverse((object) => {
        if (object.name === name) matches.push(object);
      });
      return matches;
    };

    let rig = syncTank(0, 0);
    const levels = namedObjects(
      "fluid-tank-pass6-authoritative-custody-column-fill",
    );
    const needles = namedObjects(
      "fluid-tank-pass6-large-pressure-gauge-needle",
    );
    const springs = namedObjects(
      "fluid-tank-pass6-pressure-spring-cage",
    );
    const caps = namedObjects("fluid-tank-pass6-pressure-vent-cap");
    expect(levels).toHaveLength(4);
    expect(needles).toHaveLength(4);
    expect(springs).toHaveLength(4);
    expect(caps).toHaveLength(4);
    expect(levels.every(({ visible }) => !visible)).toBe(true);
    expect(springs.every(({ scale }) => scale.y === 1)).toBe(true);
    expect(caps.every(({ userData }) => userData.lift === 0)).toBe(true);
    expect(rig.userData.pressureMechanismState).toBe(
      "capacity-available-gauge-tracking-cap-seated",
    );

    rig = syncTank(50_000, 2);
    expect(
      levels.every(
        ({ visible, scale, userData }) =>
          visible &&
          Math.abs(scale.y - 0.5) < 0.0001 &&
          userData.operatingState === "custody-rising",
      ),
    ).toBe(true);
    expect(
      needles.every(({ userData }) => userData.pressureRatio === 0.5),
    ).toBe(true);
    expect(springs.every(({ scale }) => scale.y === 1)).toBe(true);
    expect(caps.every(({ userData }) => userData.lift === 0)).toBe(true);

    rig = syncTank(100_000, 4);
    expect(
      levels.every(
        ({ scale, userData }) =>
          scale.y === 1 &&
          userData.operatingState === "pressure-held-full",
      ),
    ).toBe(true);
    expect(
      needles.every(({ userData }) => userData.pressureRatio === 1),
    ).toBe(true);
    expect(springs.every(({ scale }) => scale.y === 0.7)).toBe(true);
    expect(
      caps.every(
        ({ userData }) =>
          userData.lift > 0.07 &&
          userData.operatingState === "pressure-ready",
      ),
    ).toBe(true);
    expect(rig.userData.pressureMechanismState).toBe(
      "full-gauge-high-spring-compressed-cap-lifted",
    );

    renderer.dispose();
  });

  it("keeps the PASS6 pumpjack linkage large, pinned, and port-owned at both working extrema", () => {
    const parent = new THREE.Group();
    const renderer = new FluidRenderer(parent);
    const source = entity(17, "fluidSource", 4, 6, {
      sourceFluidId: "crudeOil",
      processTicks: 3,
      buffer: buffer(20_000, "crudeOil", 8_000),
    });
    const pipe = entity(18, "fluidPipe", 6, 6, {
      processTicks: 0,
      buffer: buffer(8_000, "crudeOil", 2_000),
    });
    const network: FluidNetworkSnapshot = {
      nodes: [
        node(17, "buffer", "crudeOil", 8_000, 20_000),
        node(18, "buffer", "crudeOil", 2_000, 8_000),
      ],
      edges: [
        {
          sourceEntityId: 17,
          sourceRole: "buffer",
          targetEntityId: 18,
          targetRole: "buffer",
          throughputMilliPerTick: 300,
        },
      ],
      components: [],
    };
    const phaseBias = source.id * 0.071;
    const upElapsed = (Math.PI * 4 - phaseBias) / 4.7;
    const downElapsed = (Math.PI * 5 - phaseBias) / 4.7;
    const expectContinuousBridleChain = (): void => {
      renderer.root.updateWorldMatrix(true, true);
      const bridles: THREE.Object3D[] = [];
      const nosePins: THREE.Object3D[] = [];
      renderer.root.traverse((object) => {
        if (
          object.name ===
          "fluid-source-pass6-exposed-horsehead-bridle"
        ) {
          bridles.push(object);
        }
        if (
          object.name ===
          "fluid-source-pass6-horsehead-nose-pin"
        ) {
          nosePins.push(object);
        }
      });
      const carrier = parent.getObjectByName(
        "fluid-source-pass6-bridle-polished-rod-carrier",
      )!;
      const currentRod = parent.getObjectByName(
        "fluid-source-polished-rod",
      )!;
      expect(bridles).toHaveLength(2);
      expect(nosePins).toHaveLength(2);
      expect(
        carrier
          .localToWorld(new THREE.Vector3())
          .distanceTo(
            currentRod.localToWorld(new THREE.Vector3(0, 0.5, 0)),
          ),
      ).toBeLessThanOrEqual(0.001);
      for (const bridle of bridles) {
        const start = bridle.localToWorld(
          new THREE.Vector3(0, -0.5, 0),
        );
        const end = bridle.localToWorld(
          new THREE.Vector3(0, 0.5, 0),
        );
        expect(
          Math.min(
            ...nosePins.map((pin) =>
              start.distanceTo(pin.localToWorld(new THREE.Vector3())),
            ),
          ),
        ).toBeLessThanOrEqual(0.001);
        expect(
          end.distanceTo(
            carrier.localToWorld(
              new THREE.Vector3(
                Number(bridle.userData.carrierLateralOffset),
                0,
                0,
              ),
            ),
          ),
        ).toBeLessThanOrEqual(0.001);
        expect(bridle.scale.y).toBeGreaterThanOrEqual(0.6);
      }
    };

    renderer.sync(frame([source, pipe], network, upElapsed));
    const rig = parent.getObjectByName("fluid-fluidSource-rig")!;
    const beam = parent.getObjectByName(
      "fluid-source-reciprocating-beam",
    )!;
    const rod = parent.getObjectByName("fluid-source-polished-rod")!;
    const pitman = parent.getObjectByName(
      "fluid-source-crank-pitman-link",
    )!;
    const flange = parent.getObjectByName("fluid-source-output-flange")!;
    const upAngle = beam.userData.beamAngle as number;
    const upStroke = rod.userData.stroke as number;
    const upPitmanLength = pitman.scale.y;
    expectContinuousBridleChain();

    renderer.sync(frame([source, pipe], network, downElapsed));
    expectContinuousBridleChain();
    const downAngle = beam.userData.beamAngle as number;
    const downStroke = rod.userData.stroke as number;
    expect(Math.abs(upAngle - downAngle)).toBeGreaterThanOrEqual(0.4);
    expect(Math.abs(upStroke - downStroke)).toBeGreaterThanOrEqual(0.8);
    expect(upPitmanLength).toBeGreaterThan(0.4);
    expect(pitman.scale.y).toBeGreaterThan(0.4);
    expect(
      parent.getObjectByName(
        "fluid-source-pass6-broad-curved-horsehead",
      ),
    ).toBeDefined();
    expect(
      parent.getObjectByName(
        "fluid-source-pass6-exposed-horsehead-bridle",
      ),
    ).toBeDefined();
    expect(
      parent.getObjectByName("fluid-source-pass6-wellhead-body"),
    ).toBeDefined();
    expect(
      parent.getObjectByName("fluid-source-crank-flywheel"),
    ).toBeDefined();

    renderer.root.updateWorldMatrix(true, true);
    const declaredPort = rig.position
      .clone()
      .set(...(rig.userData.localOutputPort as [number, number, number]))
      .applyMatrix4(rig.matrixWorld);
    const flangeWorld = flange.getWorldPosition(flange.position.clone());
    expect(flangeWorld.distanceTo(declaredPort)).toBeLessThanOrEqual(0.001);
    const district = parent.getObjectByName(
      "fluid-refinery-district-service-floor-system",
    )!;
    const route = (
      district.userData.routeAudit as Array<{
        sourceEntityId: number;
        start: [number, number, number];
      }>
    ).find(({ sourceEntityId }) => sourceEntityId === source.id)!;
    expect(
      declaredPort.distanceTo(new THREE.Vector3(...route.start)),
    ).toBeLessThanOrEqual(0.03);

    renderer.dispose();
  });

  it("keeps a drained processor output window truthful through downstream custody", () => {
    const parent = new THREE.Group();
    const renderer = new FluidRenderer(parent);
    const processor = entity(1, "fluidProcessor", 0, 0, {
      recipeId: "refineCrude",
      processTicks: 12,
      input: buffer(50_000, "crudeOil", 8_000),
      output: buffer(50_000),
    });
    const productPipe = entity(2, "fluidPipe", 3, 0, {
      processTicks: 0,
      buffer: buffer(8_000, "refinedFuel", 6_000),
    });
    const network: FluidNetworkSnapshot = {
      nodes: [
        node(1, "input", "crudeOil", 8_000, 50_000),
        node(1, "output", undefined, 0, 50_000),
        node(2, "buffer", "refinedFuel", 6_000, 8_000),
      ],
      edges: [
        {
          sourceEntityId: 1,
          sourceRole: "output",
          targetEntityId: 2,
          targetRole: "buffer",
          throughputMilliPerTick: 1_000,
        },
      ],
      components: [],
    };

    renderer.sync(frame([processor, productPipe], network, 8));

    const outputWindow = parent.getObjectByName(
      "fluid-processor-refined-output-window",
    );
    expect(outputWindow?.userData).toMatchObject({
      amountMilli: 6_000,
      capacityMilli: 8_000,
      fillRatio: 0.75,
      fluidId: "refinedFuel",
      custodySource: "authoritative-downstream-custody",
    });
    expect(
      parent.getObjectByName("fluid-processor-refined-side-output-window")
        ?.userData,
    ).toMatchObject({
      amountMilli: 6_000,
      capacityMilli: 8_000,
      fillRatio: 0.75,
      fluidId: "refinedFuel",
      custodySource: "authoritative-downstream-custody",
    });
    renderer.dispose();
  });

  it("keeps pressure hardware physical while limiting warning emission to small indicators", () => {
    const parent = new THREE.Group();
    const renderer = new FluidRenderer(parent);
    const processor = entity(
      1,
      "fluidProcessor",
      0,
      0,
      {
        recipeId: "refineCrude",
        processTicks: 24,
        input: buffer(50_000, "crudeOil", 50_000),
        output: buffer(50_000, "refinedFuel", 50_000),
      },
      "outputFull",
    );
    const tank = entity(
      2,
      "fluidTank",
      3,
      0,
      {
        processTicks: 0,
        buffer: buffer(320_000, "refinedFuel", 320_000),
      },
      "outputFull",
    );
    renderer.sync(
      frame(
        [processor, tank],
        {
          nodes: [
            node(1, "input", "crudeOil", 50_000, 50_000),
            node(1, "output", "refinedFuel", 50_000, 50_000),
            node(2, "buffer", "refinedFuel", 320_000, 320_000),
          ],
          edges: [],
          components: [],
        },
        9,
      ),
    );

    const wheelRim = parent.getObjectByName(
      "fluid-processor-backpressure-handwheel-rim",
    ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const tripGate = parent.getObjectByName(
      "fluid-processor-shutdown-gate-crossbar",
    ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const tankBezel = parent.getObjectByName(
      "fluid-tank-top-contents-bezel",
    ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const tankNeedle = parent
      .getObjectByName("fluid-tank-top-level-needle")
      ?.children.find(
        (object): object is THREE.Mesh<
          THREE.BufferGeometry,
          THREE.MeshStandardMaterial
        > => object instanceof THREE.Mesh,
      );
    const processorLamp = parent.getObjectByName(
      "fluid-fluidProcessor-status",
    ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

    expect(wheelRim.material.emissive.getHex()).toBe(0);
    expect(tripGate.material.emissive.getHex()).toBe(0);
    expect(tankBezel.material.emissive.getHex()).toBe(0);
    expect(tankNeedle?.material.emissive.getHex()).not.toBe(0);
    expect(processorLamp.material.emissive.getHex()).not.toBe(0);
    expect(tankBezel.userData).toMatchObject({
      fillRatio: 1,
      operatingState: "pressure-held-full",
    });

    renderer.dispose();
  });

  it("disposes each owned geometry, material, texture, and instance batch exactly once", () => {
    const parent = new THREE.Group();
    const renderer = new FluidRenderer(parent);
    const entities = [
      entity(1, "fluidSource", 0, 0, {
        sourceFluidId: "crudeOil",
        processTicks: 0,
        buffer: buffer(20_000, "crudeOil", 10_000),
      }),
      entity(2, "fluidPump", 2, 0, {
        processTicks: 0,
        buffer: buffer(20_000, "crudeOil", 8_000),
      }),
      entity(3, "fluidPipe", 3, 0, {
        processTicks: 0,
        buffer: buffer(10_000, "crudeOil", 7_000),
      }),
      entity(4, "fluidTank", 4, 0, {
        processTicks: 0,
        buffer: buffer(100_000, "crudeOil", 45_000),
      }),
      entity(5, "fluidProcessor", 7, 0, {
        recipeId: "refineCrude",
        processTicks: 18,
        input: buffer(30_000, "crudeOil", 6_000),
        output: buffer(30_000, "refinedFuel", 12_000),
      }),
    ] as const;
    const network: FluidNetworkSnapshot = {
      nodes: [
        node(1, "buffer", "crudeOil", 10_000),
        node(2, "buffer", "crudeOil", 8_000),
        node(3, "buffer", "crudeOil", 7_000),
        node(4, "buffer", "crudeOil", 45_000),
        node(5, "input", "crudeOil", 6_000),
        node(5, "output", "refinedFuel", 12_000),
      ],
      edges: [
        {
          sourceEntityId: 2,
          sourceRole: "buffer",
          targetEntityId: 3,
          targetRole: "buffer",
          throughputMilliPerTick: 300,
        },
      ],
      components: [],
    };
    renderer.sync(frame(entities, network));

    const internals = renderer as unknown as {
      pipeOuterGeometry: THREE.BufferGeometry;
      pipeInnerGeometry: THREE.BufferGeometry;
      pipeFlangeGeometry: THREE.BufferGeometry;
      pipeSupportGeometry: THREE.BufferGeometry;
      networkBeamGeometry: THREE.BufferGeometry;
      pulseGeometry: THREE.BufferGeometry;
      districtFoundation: THREE.Mesh | null;
      districtYard: THREE.Mesh | null;
      districtDrainage: THREE.Mesh | null;
      districtMarkings: THREE.Mesh | null;
      districtSteelwork: THREE.Mesh | null;
      districtPipework: THREE.Mesh | null;
      districtVesselSpools: THREE.Mesh | null;
      districtFittings: THREE.Mesh | null;
      districtAccess: THREE.Mesh | null;
      districtCladding: THREE.Mesh | null;
      districtDebris: THREE.Mesh | null;
      districtWear: THREE.Mesh | null;
      rigs: Map<number, { ownedGeometries: THREE.BufferGeometry[] }>;
      materials: {
        all: THREE.Material[];
        steamTexture: THREE.Texture;
      };
      surfaceTextures: THREE.Texture[];
    };
    const resources = new Set<{ dispose(): void }>([
      internals.pipeOuterGeometry,
      internals.pipeInnerGeometry,
      internals.pipeFlangeGeometry,
      internals.pipeSupportGeometry,
      internals.networkBeamGeometry,
      internals.pulseGeometry,
      ...[...internals.rigs.values()].flatMap(
        ({ ownedGeometries }) => ownedGeometries,
      ),
      ...internals.materials.all,
      internals.materials.steamTexture,
      ...internals.surfaceTextures,
    ]);
    for (const districtMesh of [
      internals.districtYard,
      internals.districtFoundation,
      internals.districtDrainage,
      internals.districtMarkings,
      internals.districtSteelwork,
      internals.districtPipework,
      internals.districtVesselSpools,
      internals.districtFittings,
      internals.districtAccess,
      internals.districtCladding,
      internals.districtDebris,
      internals.districtWear,
    ]) {
      if (districtMesh) resources.add(districtMesh.geometry);
    }
    const instanceBatches: THREE.InstancedMesh[] = [];
    renderer.root.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) {
        instanceBatches.push(object);
        resources.add(object);
      }
    });
    expect(instanceBatches).toHaveLength(8);
    const disposeSpies = [...resources].map((resource) =>
      vi.spyOn(resource, "dispose"),
    );

    renderer.dispose();
    renderer.dispose();

    expect(parent.getObjectByName("fluid-world-system")).toBeUndefined();
    for (const disposeSpy of disposeSpies) {
      expect(disposeSpy).toHaveBeenCalledTimes(1);
    }
  });
});
