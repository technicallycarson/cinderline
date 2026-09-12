import { describe, expect, it } from "vitest";

import { toRenderSnapshot } from "../src/game/adapters";
import {
  CATALOG_VERSION,
  CIRCUIT_ENTITY_KINDS,
} from "../src/game/catalog";
import {
  circuitConstant,
  circuitOperand,
  circuitSignal,
} from "../src/game/circuit-network";
import { FactorySimulation } from "../src/game/simulation";
import {
  Direction,
  SIMULATION_VERSION,
  type CircuitConnectionPoint,
  type EntityKind,
} from "../src/game/types";

function blank(width = 32, height = 22): FactorySimulation {
  return new FactorySimulation({
    width,
    height,
    seed: 0xc17c_017,
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
  if (!result.ok) throw new Error(`placement failed: ${result.reason}`);
  return result.entity;
}

function point(
  entityId: number,
  connector: CircuitConnectionPoint["connector"],
): CircuitConnectionPoint {
  return { entityId, connector };
}

function poweredInserterFixture() {
  const simulation = blank();
  const source = place(simulation, "storage", 8, 9);
  const inserter = place(simulation, "inserter", 10, 9);
  const target = place(simulation, "storage", 11, 8);
  const generator = place(simulation, "generator", 20, 15);
  expect(simulation.receive(generator.id, "coal", 10, "fuel")).toBe(10);
  return { simulation, source, inserter, target };
}

describe("authoritative circuit integration", () => {
  it("places every combinator and preserves one fixed tick per logic stage through save/restore", () => {
    const { simulation, source, inserter } = poweredInserterFixture();
    const constant = place(simulation, "constantCombinator", 3, 5);
    const arithmetic = place(
      simulation,
      "arithmeticCombinator",
      5,
      5,
    );
    const decider = place(simulation, "deciderCombinator", 7, 5);
    expect(
      CIRCUIT_ENTITY_KINDS.map(
        (kind) => simulation.getEntities(kind).length,
      ),
    ).toEqual([1, 1, 1]);

    const run = circuitSignal("virtual", "run");
    const scaled = circuitSignal("virtual", "scaled");
    const go = circuitSignal("virtual", "go");
    expect(
      simulation.configureCircuitDevice(constant.id, {
        kind: "constant",
        signals: [{ signal: run, value: 1 }],
      }),
    ).toBe(true);
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
        point(arithmetic.id, "output"),
        point(decider.id, "input"),
      ),
    ).toBe(true);
    expect(
      simulation.connectCircuitWire(
        "green",
        point(decider.id, "output"),
        point(inserter.id, "io"),
      ),
    ).toBe(true);
    expect(simulation.receive(source.id, "ironPlate", 1)).toBe(1);

    const enabledByTick: boolean[] = [];
    simulation.step();
    enabledByTick.push(
      simulation.getCircuitMachineControl(inserter.id)!.enabled,
    );
    simulation.step();
    enabledByTick.push(
      simulation.getCircuitMachineControl(inserter.id)!.enabled,
    );

    const restored = FactorySimulation.restore(simulation.serialize());
    expect(restored.serialize()).toEqual(simulation.serialize());
    expect(restored.circuitSnapshot().machineControls).toEqual(
      simulation.circuitSnapshot().machineControls,
    );
    simulation.step();
    restored.step();
    enabledByTick.push(
      simulation.getCircuitMachineControl(inserter.id)!.enabled,
    );
    expect(restored.serialize()).toEqual(simulation.serialize());
    simulation.step();
    restored.step();
    enabledByTick.push(
      simulation.getCircuitMachineControl(inserter.id)!.enabled,
    );
    expect(enabledByTick).toEqual([false, false, false, true]);
    expect(simulation.getEntity(inserter.id)?.heldItem).toBe("ironPlate");
    expect(restored.serialize()).toEqual(simulation.serialize());

    const circuit = simulation.circuitSnapshot();
    expect(circuit.tick).toBe(simulation.tickCount);
    expect(circuit.wires.map((wire) => wire.color)).toEqual([
      "green",
      "red",
      "red",
    ]);
    expect(circuit.topology.components).toHaveLength(3);
    const adapted = toRenderSnapshot(simulation.getRenderSnapshot());
    expect(adapted.circuit).toEqual(circuit);
    expect(
      adapted.circuitEntities.map((entity) => entity.kind),
    ).toEqual([
      "constantCombinator",
      "arithmeticCombinator",
      "deciderCombinator",
    ]);
  });

  it("uses delayed filter and power-switch signals to change real inserter custody", () => {
    const { simulation, source, inserter } = poweredInserterFixture();
    const constant = place(simulation, "constantCombinator", 5, 5);
    const run = circuitSignal("virtual", "run");
    const iron = circuitSignal("item", "ironPlate");
    const copper = circuitSignal("item", "copperPlate");
    expect(
      simulation.configureCircuitDevice(constant.id, {
        kind: "constant",
        signals: [
          { signal: run, value: 1 },
          { signal: iron, value: 5 },
          { signal: copper, value: 20 },
        ],
      }),
    ).toBe(true);
    expect(
      simulation.configureCircuitMachinePort(inserter.id, {
        powerSwitchCondition: {
          left: run,
          operator: ">",
          right: circuitConstant(0),
        },
        filter: {
          candidates: [iron, copper],
          minimum: 1,
        },
      }),
    ).toBe(true);
    expect(
      simulation.connectCircuitWire(
        "green",
        point(constant.id, "output"),
        point(inserter.id, "io"),
      ),
    ).toBe(true);
    expect(simulation.receive(source.id, "ironPlate", 1)).toBe(1);
    expect(simulation.receive(source.id, "copperPlate", 1)).toBe(1);

    simulation.step();
    expect(simulation.getEntity(inserter.id)?.powerSatisfaction).toBe(0);
    expect(simulation.getEntity(inserter.id)?.heldItem).toBeUndefined();
    expect(
      simulation.getCircuitMachineControl(inserter.id)?.filterSignal,
    ).toBeNull();

    simulation.step();
    expect(
      simulation.getCircuitMachineControl(inserter.id)?.powerSwitchClosed,
    ).toBe(true);
    expect(
      simulation.getCircuitMachineControl(inserter.id)?.filterSignal,
    ).toEqual(copper);
    expect(simulation.getEntity(inserter.id)?.heldItem).toBe("copperPlate");
    expect(simulation.stats().power.demandKW).toBeGreaterThan(0);
  });

  it("publishes authoritative storage inventory through a writable machine port without same-tick leakage", () => {
    const { simulation, source, inserter } = poweredInserterFixture();
    const decider = place(simulation, "deciderCombinator", 6, 5);
    const iron = circuitSignal("item", "ironPlate");
    const release = circuitSignal("virtual", "release");
    expect(simulation.receive(source.id, "ironPlate", 1)).toBe(1);
    expect(
      simulation.configureCircuitDevice(decider.id, {
        kind: "decider",
        condition: {
          left: iron,
          operator: ">=",
          right: circuitConstant(1),
        },
        output: release,
        outputMode: "one",
      }),
    ).toBe(true);
    expect(
      simulation.configureCircuitMachinePort(inserter.id, {
        enableCondition: {
          left: release,
          operator: ">",
          right: circuitConstant(0),
        },
      }),
    ).toBe(true);
    expect(
      simulation.connectCircuitWire(
        "red",
        point(source.id, "io"),
        point(decider.id, "input"),
      ),
    ).toBe(true);
    expect(
      simulation.connectCircuitWire(
        "green",
        point(decider.id, "output"),
        point(inserter.id, "io"),
      ),
    ).toBe(true);

    simulation.step();
    expect(
      simulation.getCircuitMachineControl(inserter.id)?.enabled,
    ).toBe(false);
    simulation.step();
    expect(
      simulation.getCircuitMachineControl(inserter.id)?.enabled,
    ).toBe(false);
    simulation.step();
    expect(
      simulation.getCircuitMachineControl(inserter.id)?.enabled,
    ).toBe(true);
    expect(simulation.getEntity(inserter.id)?.heldItem).toBe("ironPlate");
  });

  it("opens a real fluid-pump power circuit without leaking downstream mass", () => {
    const simulation = blank(28, 18);
    const source = place(simulation, "fluidSource", 2, 8);
    const pump = place(simulation, "fluidPump", 4, 8);
    place(simulation, "fluidPipe", 5, 8);
    const tank = place(simulation, "fluidTank", 6, 7);
    const generator = place(simulation, "generator", 20, 3);
    const constant = place(simulation, "constantCombinator", 3, 4);
    expect(simulation.receive(generator.id, "coal", 10, "fuel")).toBe(10);
    const run = circuitSignal("virtual", "run");
    expect(
      simulation.configureCircuitMachinePort(pump.id, {
        powerSwitchCondition: {
          left: run,
          operator: ">",
          right: circuitConstant(0),
        },
      }),
    ).toBe(true);
    expect(
      simulation.connectCircuitWire(
        "red",
        point(constant.id, "output"),
        point(pump.id, "io"),
      ),
    ).toBe(true);

    simulation.step(80);
    expect(
      simulation.getEntity(source.id)?.fluidState?.buffer?.amountMilli,
    ).toBeGreaterThan(0);
    expect(
      simulation.getEntity(tank.id)?.fluidState?.buffer?.amountMilli,
    ).toBe(0);
    expect(simulation.getEntity(pump.id)?.powerSatisfaction).toBe(0);

    expect(
      simulation.configureCircuitDevice(constant.id, {
        kind: "constant",
        signals: [{ signal: run, value: 1 }],
      }),
    ).toBe(true);
    simulation.step(12);
    expect(
      simulation.getEntity(tank.id)?.fluidState?.buffer?.amountMilli,
    ).toBeGreaterThan(0);
    expect(simulation.getEntity(pump.id)?.powerSatisfaction).toBeGreaterThan(
      0,
    );
  });

  it("lets a decider-style sorter route materially override manifold output A/B", () => {
    const simulation = blank(18, 14);
    const manifold = place(simulation, "manifold", 6, 6);
    const outputA = place(
      simulation,
      "belt",
      7,
      5,
      Direction.North,
    );
    const outputB = place(
      simulation,
      "belt",
      7,
      7,
      Direction.South,
    );
    const constant = place(simulation, "constantCombinator", 2, 6);
    const run = circuitSignal("virtual", "run");
    expect(
      simulation.configureCircuitDevice(constant.id, {
        kind: "constant",
        signals: [{ signal: run, value: 1 }],
      }),
    ).toBe(true);
    expect(
      simulation.configureCircuitMachinePort(manifold.id, {
        sorterRoutes: [
          {
            priority: 0,
            output: "B",
            condition: {
              left: run,
              operator: ">",
              right: circuitConstant(0),
            },
          },
        ],
        sorterFallback: "A",
      }),
    ).toBe(true);
    expect(
      simulation.connectCircuitWire(
        "red",
        point(constant.id, "output"),
        point(manifold.id, "io"),
      ),
    ).toBe(true);
    simulation.step(2);
    expect(
      simulation.getCircuitMachineControl(manifold.id)?.sorterOutput,
    ).toBe("B");
    expect(simulation.receive(manifold.id, "ironOre", 1, "belt", 0)).toBe(1);
    simulation.step(90);
    expect(simulation.getEntity(outputA.id)?.beltItems).toHaveLength(0);
    expect(
      simulation.getEntity(outputB.id)?.beltItems.map((item) => item.item),
    ).toEqual(["ironOre"]);
  });

  it("enforces reach, connector ownership, atomic removal, and strict hostile-save binding", () => {
    const simulation = blank();
    const constant = place(simulation, "constantCombinator", 2, 2);
    const storage = place(simulation, "storage", 5, 2);
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
        point(constant.id, "input"),
        point(storage.id, "io"),
      ),
    ).toBe(false);

    const distant = place(simulation, "storage", 24, 2);
    expect(
      simulation.connectCircuitWire(
        "red",
        point(storage.id, "io"),
        point(distant.id, "io"),
      ),
    ).toBe(false);

    const pristine = simulation.serialize();
    expect(FactorySimulation.restore(pristine).serialize()).toEqual(
      pristine,
    );
    const corruptions: Array<(save: any) => void> = [
      (save) => {
        save.circuitNetwork.tick += 1;
      },
      (save) => {
        save.circuitNetwork.endpoints.push("phantom:endpoint");
      },
      (save) => {
        save.circuitNetwork.wires[0].color = "blue";
      },
      (save) => {
        save.circuitNetwork.devices[0].outputEndpoint =
          `entity:${storage.id}:io`;
      },
      (save) => {
        const port = save.circuitNetwork.machinePorts.find(
          (candidate: { id: string }) =>
            candidate.id === `entity:${storage.id}:machine`,
        );
        port.filter = {
          candidates: [
            { type: "item", name: "ironPlate" },
          ],
          minimum: 1,
        };
      },
    ];
    for (const corrupt of corruptions) {
      const hostile = structuredClone(pristine) as any;
      corrupt(hostile);
      expect(() => FactorySimulation.restore(hostile)).toThrow();
    }

    const overReach = structuredClone(pristine) as any;
    overReach.circuitNetwork.wires = [
      {
        color: "red",
        endpointA: `entity:${storage.id}:io`,
        endpointB: `entity:${distant.id}:io`,
      },
    ];
    expect(() => FactorySimulation.restore(overReach)).toThrow(
      "over-reach",
    );

    expect(simulation.remove(constant.x, constant.y)?.id).toBe(constant.id);
    const afterRemoval = simulation.circuitSnapshot();
    expect(afterRemoval.wires).toHaveLength(0);
    expect(
      afterRemoval.endpoints.some(
        (endpoint) => endpoint.entityId === constant.id,
      ),
    ).toBe(false);
  });

  it("migrates fluid-capable v6 saves explicitly and rejects impossible downgraded circuit entities", () => {
    const source = blank();
    const storage = place(source, "storage", 2, 2);
    const tank = place(source, "fluidTank", 8, 2);
    expect(source.receiveFluid(tank.id, "crudeOil", 12_345)).toBe(12_345);
    const legacy = structuredClone(source.serialize()) as any;
    legacy.version = 6;
    legacy.catalogVersion = "cinderline-6";
    delete legacy.circuitNetwork;
    const migrated = FactorySimulation.restore(legacy);
    expect(migrated.serialize().version).toBe(SIMULATION_VERSION);
    expect(migrated.serialize().catalogVersion).toBe(CATALOG_VERSION);
    expect(
      migrated.getEntity(tank.id)?.fluidState?.buffer?.amountMilli,
    ).toBe(12_345);
    expect(
      migrated.circuitSnapshot().endpoints.map(
        (endpoint) => endpoint.entityId,
      ),
    ).toEqual([storage.id, tank.id]);
    migrated.step();
    expect(migrated.circuitSnapshot().machineControls).toHaveLength(2);

    const impossible = blank();
    place(impossible, "constantCombinator", 2, 2);
    const downgraded = structuredClone(impossible.serialize()) as any;
    downgraded.version = 6;
    downgraded.catalogVersion = "cinderline-6";
    delete downgraded.circuitNetwork;
    expect(() => FactorySimulation.restore(downgraded)).toThrow(
      "cannot contain circuit entities",
    );
  });

  it("emits a deterministic integration proof payload", () => {
    const { simulation, inserter } = poweredInserterFixture();
    const constant = place(simulation, "constantCombinator", 5, 5);
    const run = circuitSignal("virtual", "run");
    expect(
      simulation.configureCircuitDevice(constant.id, {
        kind: "constant",
        signals: [{ signal: run, value: 1 }],
      }),
    ).toBe(true);
    expect(
      simulation.configureCircuitMachinePort(inserter.id, {
        enableCondition: {
          left: run,
          operator: ">",
          right: circuitConstant(0),
        },
      }),
    ).toBe(true);
    expect(
      simulation.connectCircuitWire(
        "red",
        point(constant.id, "output"),
        point(inserter.id, "io"),
      ),
    ).toBe(true);
    simulation.step();
    const disabledAtTick = simulation.tickCount;
    simulation.step();
    const enabledAtTick = simulation.tickCount;
    const restored = FactorySimulation.restore(simulation.serialize());
    simulation.step(12);
    restored.step(12);
    const exactRestoreContinuation =
      restored.serializeToString() === simulation.serializeToString();
    const circuit = simulation.circuitSnapshot();
    const proof = {
      format: "cinderline-circuit-simulation-proof",
      simulationVersion: SIMULATION_VERSION,
      catalogVersion: CATALOG_VERSION,
      disabledAtTick,
      enabledAtTick,
      oneTickPublication:
        enabledAtTick === disabledAtTick + 1 &&
        simulation.getCircuitMachineControl(inserter.id)?.enabled === true,
      exactRestoreContinuation,
      endpointCount: circuit.endpoints.length,
      wireCount: circuit.wires.length,
      componentCount: circuit.topology.components.length,
      workUnits: circuit.workUnits,
      authoritativeControl: {
        enabled:
          simulation.getCircuitMachineControl(inserter.id)?.enabled,
        powerSwitchClosed:
          simulation.getCircuitMachineControl(inserter.id)
            ?.powerSwitchClosed,
      },
    };
    expect(proof.oneTickPublication).toBe(true);
    expect(proof.exactRestoreContinuation).toBe(true);
    const proofEnabled = (
      globalThis as {
        process?: { env?: Record<string, string | undefined> };
      }
    ).process?.env?.CINDERLINE_CIRCUIT_SIMULATION_PROOF === "1";
    if (proofEnabled) {
      console.log(
        `[circuit-simulation-proof]${JSON.stringify(proof)}`,
      );
    }
  });
});
