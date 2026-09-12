import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { toRenderSnapshot } from "../src/game/adapters";
import {
  circuitConstant,
  circuitOperand,
  circuitSignal,
} from "../src/game/circuit-network";
import { FactorySimulation } from "../src/game/simulation";
import {
  Direction,
  type CircuitConnectionPoint,
  type CircuitEndpointSnapshot,
  type CircuitSimulationSnapshot,
  type EntityKind,
} from "../src/game/types";
import {
  CircuitRenderer,
  type CircuitVisualFrame,
} from "../src/render/CircuitRenderer";

function blank(
  width = 28,
  height = 18,
): FactorySimulation {
  return new FactorySimulation({
    width,
    height,
    seed: 0xc1ac_017,
    generateTerrain: false,
    generateResources: false,
    powerMode: "legacyGlobal",
  });
}

function place(
  simulation: FactorySimulation,
  kind: EntityKind,
  x: number,
  y: number,
  direction = Direction.East,
) {
  const result = simulation.place(kind, x, y, direction);
  if (!result.ok) {
    throw new Error(`${kind} placement failed: ${result.reason}`);
  }
  return result.entity;
}

function point(
  entityId: number,
  connector: CircuitConnectionPoint["connector"],
): CircuitConnectionPoint {
  return { entityId, connector };
}

function realCircuitFixture() {
  const simulation = blank();
  const constant = place(
    simulation,
    "constantCombinator",
    2,
    4,
  );
  const arithmetic = place(
    simulation,
    "arithmeticCombinator",
    5,
    4,
  );
  const decider = place(
    simulation,
    "deciderCombinator",
    8,
    4,
  );
  const inserter = place(simulation, "inserter", 11, 4);
  const storage = place(simulation, "storage", 2, 7);
  const run = circuitSignal("virtual", "run");
  const iron = circuitSignal("item", "ironPlate");
  const scaled = circuitSignal("virtual", "scaled");
  const go = circuitSignal("virtual", "go");

  const configureSource = (enabled: boolean): void => {
    expect(
      simulation.configureCircuitDevice(constant.id, {
        kind: "constant",
        enabled,
        signals: [
          { signal: run, value: 1 },
          { signal: iron, value: 12 },
        ],
      }),
    ).toBe(true);
  };
  configureSource(true);
  expect(
    simulation.configureCircuitDevice(arithmetic.id, {
      kind: "arithmetic",
      left: circuitOperand(run),
      operator: "multiply",
      right: circuitConstant(2),
      output: scaled,
    }),
  ).toBe(true);
  expect(
    simulation.configureCircuitDevice(decider.id, {
      kind: "decider",
      condition: {
        left: scaled,
        operator: ">=",
        right: circuitConstant(2),
      },
      output: go,
      outputMode: "one",
    }),
  ).toBe(true);
  expect(
    simulation.configureCircuitMachinePort(inserter.id, {
      enableCondition: {
        left: go,
        operator: ">",
        right: circuitConstant(0),
      },
      filter: {
        candidates: [iron],
        minimum: 1,
      },
    }),
  ).toBe(true);

  expect(
    simulation.connectCircuitWire(
      "red",
      point(constant.id, "output"),
      point(arithmetic.id, "input"),
    ),
  ).toBe(true);
  expect(
    simulation.connectCircuitWire(
      "red",
      point(constant.id, "output"),
      point(storage.id, "io"),
    ),
  ).toBe(true);
  expect(
    simulation.connectCircuitWire(
      "green",
      point(arithmetic.id, "output"),
      point(decider.id, "input"),
    ),
  ).toBe(true);
  expect(
    simulation.connectCircuitWire(
      "red",
      point(decider.id, "output"),
      point(inserter.id, "io"),
    ),
  ).toBe(true);
  simulation.step(4);
  return {
    simulation,
    constant,
    arithmetic,
    decider,
    inserter,
    storage,
    configureSource,
    frame: toRenderSnapshot(simulation.getRenderSnapshot()),
  };
}

function reversedFrame(
  frame: CircuitVisualFrame,
): CircuitVisualFrame {
  return {
    elapsed: frame.elapsed,
    circuitEntities: [...frame.circuitEntities].reverse(),
    circuit: {
      ...frame.circuit,
      endpoints: [...frame.circuit.endpoints].reverse(),
      wires: [...frame.circuit.wires].reverse(),
      devices: [...frame.circuit.devices].reverse(),
      machinePorts: [...frame.circuit.machinePorts].reverse(),
      machineControls: [...frame.circuit.machineControls].reverse(),
    },
  };
}

function structuralScaleFrame(
  wireCount = 1_024,
): CircuitVisualFrame {
  const endpoints: CircuitEndpointSnapshot[] = [];
  for (let index = 0; index <= wireCount; index += 1) {
    endpoints.push({
      endpointId: `node-${String(index).padStart(4, "0")}`,
      entityId: index + 1,
      connector: "io",
      x: index === 0 ? 0 : 2 + ((index - 1) % 64) * 0.24,
      y:
        index === 0
          ? 0
          : 2 + Math.floor((index - 1) / 64) * 0.24,
      signals: [],
    });
  }
  const wires = endpoints.slice(1).map((endpoint) => ({
    color: "red" as const,
    endpointA: endpoints[0]!.endpointId,
    endpointB: endpoint.endpointId,
  }));
  const endpointIds = endpoints.map((endpoint) => endpoint.endpointId);
  const circuit: CircuitSimulationSnapshot = {
    tick: 0,
    workUnits: 0,
    topology: {
      components: [{
        id: "red@node-0000",
        color: "red",
        endpoints: endpointIds,
      }],
      wires,
      endpointComponents: endpointIds.map((endpointId) => ({
        endpointId,
        componentIds: ["red@node-0000"],
      })),
    },
    endpoints,
    wires,
    devices: [],
    machinePorts: [],
    machineControls: [],
  };
  return {
    elapsed: 0,
    circuit,
    circuitEntities: [],
  };
}

function manyDeviceFrame(count = 16): CircuitVisualFrame {
  const simulation = blank(40, 24);
  const signal = circuitSignal("virtual", "run");
  for (let index = 0; index < count; index += 1) {
    const entity = place(
      simulation,
      "constantCombinator",
      2 + (index % 8) * 4,
      3 + Math.floor(index / 8) * 5,
    );
    expect(
      simulation.configureCircuitDevice(entity.id, {
        kind: "constant",
        signals: [{ signal, value: index + 1 }],
      }),
    ).toBe(true);
  }
  return toRenderSnapshot(simulation.getRenderSnapshot());
}

function namesIn(root: THREE.Object3D): string[] {
  const names: string[] = [];
  root.traverse((object) => names.push(object.name));
  return names;
}

function matrixData(mesh: THREE.InstancedMesh): number[] {
  return Array.from(
    mesh.instanceMatrix.array.slice(0, mesh.count * 16),
  );
}

function resolvePickedEntity(
  hits: readonly THREE.Intersection[],
): number | null {
  for (const hit of hits) {
    if (hit.instanceId !== undefined) {
      const ids = hit.object.userData.entityIds;
      if (Array.isArray(ids) && typeof ids[hit.instanceId] === "number") {
        return ids[hit.instanceId] as number;
      }
    }
    let current: THREE.Object3D | null = hit.object;
    while (current) {
      if (typeof current.userData.entityId === "number") {
        return current.userData.entityId as number;
      }
      current = current.parent;
    }
  }
  return null;
}

describe("CircuitRenderer", () => {
  it("renders connected industrial cabinets and restrained physical cable state without diagnostic glyphs", () => {
    const fixture = realCircuitFixture();
    const parent = new THREE.Group();
    const renderer = new CircuitRenderer(parent);
    renderer.sync(fixture.frame);

    expect(parent.getObjectByName("circuit-world-system")).toBe(
      renderer.root,
    );
    const required = [
      "circuit-constantCombinator-rig",
      "circuit-arithmeticCombinator-rig",
      "circuit-deciderCombinator-rig",
      "circuit-constant-indexing-drum",
      "circuit-arithmetic-contained-register-rotor-a",
      "circuit-arithmetic-contained-register-rotor-b",
      "circuit-decider-balance-beam",
      "circuit-decider-bolted-relay-solenoid-mounting-rail",
      "circuit-decider-exposed-comparator-solenoid-bank",
      "circuit-constantCombinator-engraved-bezel-latch-seams-fasteners",
      "circuit-arithmeticCombinator-engraved-bezel-latch-seams-fasteners",
      "circuit-deciderCombinator-engraved-bezel-latch-seams-fasteners",
      "circuit-constantCombinator-authoritative-causal-meter-display",
      "circuit-arithmeticCombinator-authoritative-causal-meter-display",
      "circuit-deciderCombinator-authoritative-causal-meter-display",
      "circuit-wire-red-outer",
      "circuit-wire-green-outer",
      "circuit-endpoint-red-collar",
      "circuit-endpoint-green-collar",
      "circuit-endpoint-red-strain-relief",
      "circuit-endpoint-green-strain-relief",
      "circuit-machine-port-clamp",
      "circuit-machine-integrated-authoritative-process-response",
      "circuit-machine-driven-production-flywheel",
      "circuit-machine-authoritative-process-heat-bank",
      "circuit-machine-physical-product-output-path",
      "circuit-machine-authoritative-process-exhaust",
      "circuit-service-pad",
      "circuit-service-ground-wear",
      "circuit-district-open-service-grating",
      "circuit-district-control-cell-deck-slab",
      "circuit-district-control-cell-drain-grating",
      "circuit-district-cable-tray-segment",
      "circuit-district-process-header-segment",
    ];
    for (const name of required) {
      expect(
        parent.getObjectByName(name),
        `${name} should be present`,
      ).toBeDefined();
    }
    expect(
      parent.getObjectByName(
        "circuit-district-control-cell-deck-slab",
      )?.userData.contextRole,
    ).toBe("continuous-bolted-control-cell-service-deck");
    expect(
      parent.getObjectByName(
        "circuit-constantCombinator-localized-fastener-grime-0",
      )?.userData.surfaceTreatment,
    ).toBe("localized-fastener-oil-and-oxidation-halo");

    const arithmeticRig = parent.getObjectByName(
      "circuit-arithmeticCombinator-rig",
    )!;
    const deciderRig = parent.getObjectByName(
      "circuit-deciderCombinator-rig",
    )!;
    expect(arithmeticRig.userData).toMatchObject({
      entityId: fixture.arithmetic.id,
      operator: "multiply",
      panelDoorState: "sealed-weatherproof-meter-visible",
      presentationProfile:
        "physical-industrial-cabinet-no-floating-signal-primitives",
      meterInputValue: 1,
      meterOperandValue: 2,
      meterOutputValue: 2,
      meterReadout: ["01X02", "=002"],
    });
    expect(deciderRig.userData).toMatchObject({
      entityId: fixture.decider.id,
      operator: ">=",
      meterInputValue: 2,
      meterOperandValue: 2,
      meterOutputValue: 1,
      meterReadout: ["02>=02", "OUT1"],
    });
    const instrumentForms = [
      parent.getObjectByName(
        "circuit-constantCombinator-integrated-instrument-assembly",
      )!,
      parent.getObjectByName(
        "circuit-arithmeticCombinator-integrated-instrument-assembly",
      )!,
      parent.getObjectByName(
        "circuit-deciderCombinator-integrated-instrument-assembly",
      )!,
    ];
    expect(instrumentForms.map((instrument) =>
      instrument.userData.panelForm
    )).toEqual([
      "narrow-source-setpoint-window",
      "wide-twin-register-window",
      "shallow-relay-verdict-strip",
    ]);
    const aspectScales = instrumentForms.map(
      (instrument) => instrument.scale.x / instrument.scale.z,
    );
    expect(aspectScales[0]).toBeLessThan(aspectScales[1]!);
    expect(aspectScales[1]).toBeLessThan(aspectScales[2]!);

    const names = namesIn(renderer.root);
    expect(
      names.filter((name) =>
        /circuit-(?:pulse-|wire-.*tracer|signal-(?:item|fluid|virtual))/.test(
          name,
        ),
      ),
    ).toEqual([]);
    expect(
      renderer.root.getObjectByName(
        "circuit-presentation-packets-intentionally-disabled",
      )?.visible,
    ).toBe(false);

    const geometryNames: string[] = [];
    renderer.root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        geometryNames.push(object.geometry.name);
      }
    });
    expect(geometryNames.some((name) => /torus/i.test(name))).toBe(false);

    const redWire = parent.getObjectByName(
      "circuit-wire-red-outer",
    ) as THREE.InstancedMesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >;
    const greenWire = parent.getObjectByName(
      "circuit-wire-green-outer",
    ) as THREE.InstancedMesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >;
    expect(redWire.material.emissiveIntensity).toBe(0);
    expect(greenWire.material.emissiveIntensity).toBe(0);
    expect(greenWire.userData).toMatchObject({
      terminalOwnership: "physical-gland-to-physical-gland",
      deviceDisplayClearance:
        "device-terminals-below-integrated-instrument-plane",
    });
    expect(
      (
        greenWire.userData.anchorPairs as readonly {
          readonly from: readonly number[];
          readonly to: readonly number[];
        }[]
      ).flatMap((pair) => [pair.from[1], pair.to[1]]),
    ).toSatisfy((heights: number[]) =>
      heights.every((height) => height < 0.56)
    );

    const debug = renderer.getDebug();
    expect(debug).toMatchObject({
      disposed: false,
      tick: fixture.simulation.tickCount,
      entities: 3,
      detailedDevices: 3,
      overviewDevices: 0,
      constants: 1,
      arithmetic: 1,
      deciders: 1,
      endpoints: 7,
      omittedEndpoints: 0,
      wires: 4,
      omittedWires: 0,
      redWires: 3,
      greenWires: 1,
      junctions: 1,
      machinePorts: 2,
      configuredMachinePorts: 1,
      activeDevices: 3,
      directionalWires: 4,
      pulses: 0,
      presentationPulses: 0,
      connectorModules: 7,
      actuatedMachinePorts: 2,
      servicePads: 3,
      cableSupports: 0,
      causalMeters: 3,
      machineProcessRigs: 1,
      enabledMachineResponses: 1,
      districtModules: 9,
      districtTraySegments: 2,
      quality: "high",
    });
    expect(debug.signalIndicators).toBeGreaterThanOrEqual(4);
    expect(debug.wireSag).toMatchObject({
      spanScaled: true,
    });
    expect(debug.wireSag.minimum).toBeGreaterThanOrEqual(0.055);
    expect(debug.wireSag.maximum).toBeGreaterThan(
      debug.wireSag.minimum,
    );
    expect(debug.triangles).toBeGreaterThan(2_000);
    expect(debug.resources.ownedTextures).toBe(6);
    expect(debug.topologySignature).toMatch(
      /^circuit-topology-[0-9a-f]{8}$/,
    );
    expect(debug.stateSignature).toMatch(
      /^circuit-state-[0-9a-f]{8}$/,
    );
  });

  it("is order deterministic, keeps cable matrices static, and maps authoritative ticks to the same machine's physical process response", () => {
    const fixture = realCircuitFixture();
    const parent = new THREE.Group();
    const renderer = new CircuitRenderer(parent);
    renderer.sync(fixture.frame);
    const initialDebug = renderer.getDebug();
    const redWire = parent.getObjectByName(
      "circuit-wire-red-outer",
    ) as THREE.InstancedMesh;
    const initialMatrices = matrixData(redWire);

    renderer.sync(reversedFrame(fixture.frame));
    expect(renderer.getDebug()).toMatchObject({
      topologySignature: initialDebug.topologySignature,
      stateSignature: initialDebug.stateSignature,
    });
    expect(matrixData(redWire)).toEqual(initialMatrices);
    renderer.update((fixture.frame.elapsed ?? 0) + 120);
    expect(matrixData(redWire)).toEqual(initialMatrices);

    fixture.configureSource(false);
    fixture.simulation.step(12);
    const disabledFrame = toRenderSnapshot(
      fixture.simulation.getRenderSnapshot(),
    );
    expect(
      disabledFrame.circuit.machineControls.find(
        (control) =>
          control.portId ===
          `entity:${fixture.inserter.id}:machine`,
      )?.enabled,
    ).toBe(false);
    renderer.sync(disabledFrame);
    const disabledStateSignature =
      renderer.getDebug().stateSignature;
    expect(renderer.getDebug().topologySignature).toBe(
      initialDebug.topologySignature,
    );
    expect(renderer.getDebug().stateSignature).not.toBe(
      initialDebug.stateSignature,
    );
    const machineResponse = parent.getObjectByName(
      "circuit-machine-integrated-authoritative-process-response",
    )!;
    expect(machineResponse.userData).toMatchObject({
      entityId: fixture.inserter.id,
      machineEntityId: fixture.inserter.id,
      enabled: false,
      actualConnectedMachineResponse: true,
      mechanicalMotion: "parked",
      processHeat: "cold",
      productPath: "empty",
      exhaust: "stopped",
    });
    const product = machineResponse.getObjectByName(
      "circuit-machine-authoritative-visible-product",
    )!;
    const plume = machineResponse.getObjectByName(
      "circuit-machine-authoritative-process-exhaust",
    )!;
    const heatBank = machineResponse.getObjectByName(
      "circuit-machine-authoritative-process-heat-bank",
    ) as THREE.Mesh;
    expect(product.visible).toBe(false);
    expect(plume.visible).toBe(false);
    expect((heatBank.material as THREE.Material).name).toBe(
      "circuit-machine-cold-stopped-process-bank-material",
    );
    expect(renderer.getDebug().enabledMachineResponses).toBe(0);
    expect(
      parent.getObjectByName(
        "circuit-constantCombinator-rig",
      )?.userData.panelDoorState,
    ).toBe("sealed-weatherproof-meter-visible");

    fixture.configureSource(true);
    fixture.simulation.step(12);
    renderer.sync(
      toRenderSnapshot(fixture.simulation.getRenderSnapshot()),
    );
    expect(renderer.getDebug().stateSignature).not.toBe(
      disabledStateSignature,
    );
    expect(machineResponse.userData).toMatchObject({
      enabled: true,
      mechanicalMotion: "running",
      processHeat: "hot",
      productPath: "occupied-moving",
      exhaust: "flowing",
    });
    expect(product.visible).toBe(true);
    expect(plume.visible).toBe(true);
    expect((heatBank.material as THREE.Material).name).toBe(
      "circuit-machine-hot-working-process-bank-material",
    );
    expect(renderer.getDebug().enabledMachineResponses).toBe(1);

    expect(
      fixture.simulation.disconnectCircuitWire(
        "red",
        point(fixture.constant.id, "output"),
        point(fixture.storage.id, "io"),
      ),
    ).toBe(true);
    fixture.simulation.step();
    renderer.sync(
      toRenderSnapshot(fixture.simulation.getRenderSnapshot()),
    );
    expect(renderer.getDebug()).toMatchObject({
      wires: 3,
      junctions: 0,
    });
    expect(renderer.getDebug().topologySignature).not.toBe(
      initialDebug.topologySignature,
    );

    expect(
      fixture.simulation.connectCircuitWire(
        "red",
        point(fixture.constant.id, "output"),
        point(fixture.storage.id, "io"),
      ),
    ).toBe(true);
    fixture.simulation.step();
    renderer.sync(
      toRenderSnapshot(fixture.simulation.getRenderSnapshot()),
    );
    expect(renderer.getDebug()).toMatchObject({
      wires: 4,
      junctions: 1,
      topologySignature: initialDebug.topologySignature,
    });
  });

  it("renders source, operand, result, condition, and output values from authoritative device snapshots", () => {
    const fixture = realCircuitFixture();
    const parent = new THREE.Group();
    const renderer = new CircuitRenderer(parent);
    renderer.sync(fixture.frame);

    const constantRig = parent.getObjectByName(
      "circuit-constantCombinator-rig",
    )!;
    const arithmeticRig = parent.getObjectByName(
      "circuit-arithmeticCombinator-rig",
    )!;
    const deciderRig = parent.getObjectByName(
      "circuit-deciderCombinator-rig",
    )!;
    const arithmeticDisplay = arithmeticRig.getObjectByName(
      "circuit-arithmeticCombinator-authoritative-causal-meter-display",
    )!;

    expect(constantRig.userData).toMatchObject({
      meterInputValue: 12,
      meterOutputValue: 12,
      meterReadout: ["IN012", "OUT12"],
    });
    expect(arithmeticRig.userData).toMatchObject({
      meterInputValue: 1,
      meterOperandValue: 2,
      meterOutputValue: 2,
      meterReadout: ["01X02", "=002"],
    });
    expect(deciderRig.userData).toMatchObject({
      meterInputValue: 2,
      meterOperandValue: 2,
      meterOutputValue: 1,
      meterReadout: ["02>=02", "OUT1"],
    });
    expect(arithmeticDisplay.userData).toMatchObject({
      authoritativeStateMapping: true,
      integratedCabinetInstrument: true,
      inputValue: 1,
      operandValue: 2,
      outputValue: 2,
    });

    fixture.configureSource(false);
    fixture.simulation.step(12);
    renderer.sync(
      toRenderSnapshot(fixture.simulation.getRenderSnapshot()),
    );
    expect(constantRig.userData).toMatchObject({
      meterInputValue: 12,
      meterOutputValue: 0,
      meterReadout: ["IN012", "OUT00"],
    });
    expect(arithmeticRig.userData).toMatchObject({
      meterInputValue: 0,
      meterOperandValue: 2,
      meterOutputValue: 0,
      meterReadout: ["00X02", "=000"],
    });
    expect(deciderRig.userData).toMatchObject({
      meterInputValue: 0,
      meterOperandValue: 2,
      meterOutputValue: 0,
      meterReadout: ["00>=02", "OUT0"],
    });
    expect(arithmeticDisplay.userData).toMatchObject({
      inputValue: 0,
      operandValue: 2,
      outputValue: 0,
    });
  });

  it("keeps cabinet and connector instances pickable by authoritative entity id", () => {
    const fixture = realCircuitFixture();
    const parent = new THREE.Group();
    const renderer = new CircuitRenderer(parent);
    renderer.sync(fixture.frame);
    parent.updateMatrixWorld(true);

    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(2.5, 10, 4.5),
      new THREE.Vector3(0, -1, 0),
      0,
      20,
    );
    const picked = resolvePickedEntity(
      raycaster.intersectObject(renderer.root, true),
    );
    expect(picked).toBe(fixture.constant.id);

    const endpointBase = parent.getObjectByName(
      "circuit-endpoint-base",
    ) as THREE.InstancedMesh;
    expect(endpointBase.userData.entityIds).toContain(
      fixture.constant.id,
    );
    expect(endpointBase.userData.physicalAttachment).toBe(true);
  });

  it("batches 1,025 endpoints and 1,024 sagging wires with deterministic bounded repeat-sync cost", () => {
    const parent = new THREE.Group();
    const renderer = new CircuitRenderer(parent);
    const frame = structuralScaleFrame();
    renderer.sync(frame);
    const samples: number[] = [];
    for (let sample = 0; sample < 8; sample += 1) {
      const started = performance.now();
      renderer.sync(sample % 2 === 0 ? frame : reversedFrame(frame));
      samples.push(performance.now() - started);
    }
    const debug = renderer.getDebug();
    expect(debug).toMatchObject({
      entities: 0,
      endpoints: 1_025,
      omittedEndpoints: 0,
      wires: 1_024,
      omittedWires: 0,
      redWires: 1_024,
      greenWires: 0,
      pulses: 0,
      cableSupports: 0,
      capacities: {
        endpoints: 2_048,
        redWires: 1_024,
        greenWires: 0,
        pulses: 0,
      },
    });
    expect(debug.drawBatches).toBeLessThanOrEqual(6);
    expect(debug.triangles).toBeGreaterThan(100_000);
    expect(Math.max(...samples)).toBeLessThan(500);
    expect(
      (
        parent.getObjectByName(
          "circuit-wire-red-outer",
        ) as THREE.InstancedMesh
      ).count,
    ).toBe(1_024);
  });

  it("retains the full 8,192-endpoint and 8,191-wire contract without omission", () => {
    const parent = new THREE.Group();
    const renderer = new CircuitRenderer(parent, {
      maxRenderedEndpoints: 8_192,
      maxRenderedWires: 8_192,
    });
    renderer.sync(structuralScaleFrame(8_191));
    expect(renderer.getDebug()).toMatchObject({
      endpoints: 8_192,
      omittedEndpoints: 0,
      wires: 8_191,
      omittedWires: 0,
      redWires: 8_191,
      capacities: {
        endpoints: 8_192,
        redWires: 8_192,
      },
    });
    expect(
      (
        parent.getObjectByName(
          "circuit-wire-red-outer",
        ) as THREE.InstancedMesh
      ).count,
    ).toBe(8_191);
  }, 30_000);

  it("caps low-quality detail at twelve and disposes every owned geometry, material, texture, and batch exactly once", () => {
    const parent = new THREE.Group();
    const renderer = new CircuitRenderer(parent, {
      quality: "low",
      maxDetailedDevices: 256,
    });
    renderer.sync(manyDeviceFrame());
    expect(renderer.getDebug()).toMatchObject({
      quality: "low",
      entities: 16,
      detailedDevices: 12,
      overviewDevices: 4,
    });
    expect(
      parent.getObjectByName("circuit-overview-constantCombinator"),
    ).toBeDefined();

    const before = renderer.getDebug().resources;
    expect(before.ownedGeometries).toBeGreaterThan(30);
    expect(before.ownedMaterials).toBeGreaterThan(30);
    expect(before.ownedTextures).toBe(15);
    expect(before.liveInstancedMeshes).toBeGreaterThan(0);

    renderer.dispose();
    const disposed = renderer.getDebug();
    expect(parent.getObjectByName("circuit-world-system")).toBeUndefined();
    expect(disposed.disposed).toBe(true);
    expect(disposed.resources).toMatchObject({
      liveInstancedMeshes: 0,
      disposedGeometries: before.ownedGeometries,
      disposedMaterials: before.ownedMaterials,
      disposedTextures: before.ownedTextures,
    });
    expect(disposed.resources.disposedInstancedMeshes).toBeGreaterThanOrEqual(
      before.liveInstancedMeshes,
    );
    const afterFirstDispose = { ...disposed.resources };
    renderer.dispose();
    expect(renderer.getDebug().resources).toEqual(afterFirstDispose);
    expect(() => renderer.sync(manyDeviceFrame())).toThrow(
      "Circuit renderer is disposed.",
    );
    expect(() => renderer.update(1)).toThrow(
      "Circuit renderer is disposed.",
    );
  });
});
