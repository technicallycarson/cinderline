import { describe, expect, it } from "vitest";

import {
  CircuitCapacityError,
  CircuitNetwork,
  CircuitValidationError,
  applyCircuitArithmetic,
  canonicalCircuitFrame,
  canonicalCircuitNetworkBytes,
  circuitConstant,
  circuitOperand,
  circuitSignal,
  circuitSignalValue,
  circuitWildcard,
  evaluateCircuitCondition,
  restoreCircuitNetwork,
  type CircuitCondition,
  type CircuitDeviceDefinition,
  type CircuitFrame,
  type CircuitMachinePortDefinition,
  type CircuitSignal,
} from "../src/game/circuit-network";

const iron = circuitSignal("item", "iron-plate");
const copper = circuitSignal("item", "copper-plate");
const water = circuitSignal("fluid", "water");
const run = circuitSignal("virtual", "run");
const scaled = circuitSignal("virtual", "scaled");
const power = circuitSignal("virtual", "power");
const counter = circuitSignal("virtual", "counter");

function value(frame: CircuitFrame, signal: CircuitSignal): number {
  return circuitSignalValue(frame, signal);
}

function addEndpoints(
  network: CircuitNetwork,
  endpointIds: readonly string[],
): void {
  for (const endpointId of endpointIds) network.addEndpoint(endpointId);
}

function constant(
  id: string,
  outputEndpoint: string,
  signals: CircuitFrame,
): CircuitDeviceDefinition {
  return {
    kind: "constant",
    id,
    outputEndpoint,
    signals,
  };
}

function afterSignalPublication(network: CircuitNetwork): void {
  network.step();
  network.step();
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("circuit frame and integer semantics", () => {
  it("keeps signal types distinct and canonicalizes duplicate sums independent of insertion order", () => {
    const itemWater = circuitSignal("item", "water");
    const entries = [
      { signal: iron, value: Number.MAX_SAFE_INTEGER },
      { signal: water, value: 7 },
      { signal: iron, value: Number.MAX_SAFE_INTEGER },
      { signal: itemWater, value: 11 },
      { signal: iron, value: Number.MIN_SAFE_INTEGER },
      { signal: copper, value: 0 },
    ];
    const forward = canonicalCircuitFrame(entries);
    const reverse = canonicalCircuitFrame([...entries].reverse());

    expect(forward).toEqual(reverse);
    expect(value(forward, iron)).toBe(Number.MAX_SAFE_INTEGER);
    expect(value(forward, water)).toBe(7);
    expect(value(forward, itemWater)).toBe(11);
    expect(value(forward, copper)).toBe(0);
    expect(forward.map((entry) => entry.signal.type)).toEqual([
      "fluid",
      "item",
      "item",
    ]);
    expect(Object.isFrozen(forward)).toBe(true);
    expect(Object.isFrozen(forward[0]!)).toBe(true);
  });

  it("defines saturation, zero division/modulo, powers, shifts, and signed truncation exactly", () => {
    expect(
      applyCircuitArithmetic(
        "add",
        Number.MAX_SAFE_INTEGER,
        1,
      ),
    ).toBe(Number.MAX_SAFE_INTEGER);
    expect(
      applyCircuitArithmetic(
        "subtract",
        Number.MIN_SAFE_INTEGER,
        1,
      ),
    ).toBe(Number.MIN_SAFE_INTEGER);
    expect(
      applyCircuitArithmetic(
        "multiply",
        Number.MAX_SAFE_INTEGER,
        2,
      ),
    ).toBe(Number.MAX_SAFE_INTEGER);
    expect(applyCircuitArithmetic("divide", -7, 3)).toBe(-2);
    expect(applyCircuitArithmetic("divide", 7, 0)).toBe(0);
    expect(applyCircuitArithmetic("modulo", -7, 3)).toBe(-1);
    expect(applyCircuitArithmetic("modulo", 7, 0)).toBe(0);
    expect(applyCircuitArithmetic("power", 0, 0)).toBe(1);
    expect(applyCircuitArithmetic("power", -2, 3)).toBe(-8);
    expect(applyCircuitArithmetic("power", 2, 100)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(applyCircuitArithmetic("leftShift", 3, 2)).toBe(12);
    expect(applyCircuitArithmetic("leftShift", 16, -2)).toBe(4);
    expect(applyCircuitArithmetic("rightShift", -3, 1)).toBe(-2);
    expect(applyCircuitArithmetic("bitXor", 6, 3)).toBe(5);
  });
});

describe("deterministic colored-wire topology", () => {
  function equivalentNetwork(reverse: boolean): CircuitNetwork {
    const network = new CircuitNetwork();
    const endpoints = ["alpha", "beta", "gamma", "delta"];
    for (const endpoint of reverse ? [...endpoints].reverse() : endpoints) {
      network.addEndpoint(endpoint);
    }
    const wires = [
      ["red", "alpha", "beta"],
      ["red", "gamma", "beta"],
      ["green", "delta", "gamma"],
    ] as const;
    for (const wire of reverse ? [...wires].reverse() : wires) {
      network.connect(wire[0], wire[2], wire[1]);
    }
    const devices: CircuitDeviceDefinition[] = [
      constant(
        "source-a",
        "alpha",
        canonicalCircuitFrame([{ signal: iron, value: 4 }]),
      ),
      constant(
        "source-d",
        "delta",
        canonicalCircuitFrame([{ signal: copper, value: 9 }]),
      ),
    ];
    for (const device of reverse ? [...devices].reverse() : devices) {
      network.registerDevice(device);
    }
    return network;
  }

  it("forms byte-identical components and state independent of endpoint/wire/device insertion", () => {
    const forward = equivalentNetwork(false);
    const reverse = equivalentNetwork(true);

    expect(forward.topology()).toEqual(reverse.topology());
    expect(forward.canonicalString()).toBe(reverse.canonicalString());
    expect([...canonicalCircuitNetworkBytes(forward)]).toEqual([
      ...canonicalCircuitNetworkBytes(reverse),
    ]);

    forward.step();
    reverse.step();
    const forwardStep = forward.step();
    const reverseStep = reverse.step();
    expect(forwardStep).toEqual(reverseStep);
    expect(forward.canonicalString()).toBe(reverse.canonicalString());
    expect(
      forward.topology().components.map((component) => component.id),
    ).toEqual(["green@delta", "red@alpha"]);
  });

  it("keeps red and green isolated at a passive dual-color endpoint, then permits an explicit delayed bridge", () => {
    const network = new CircuitNetwork();
    addEndpoints(network, [
      "source.out",
      "hub.read",
      "red.sink",
      "bridge.out",
      "green.sink",
    ]);
    network.connect("red", "source.out", "hub.read");
    network.connect("red", "hub.read", "red.sink");
    network.connect("green", "hub.read", "green.sink");
    network.connect("green", "bridge.out", "green.sink");
    network.registerDevice(
      constant(
        "source",
        "source.out",
        canonicalCircuitFrame([{ signal: iron, value: 13 }]),
      ),
    );
    network.registerDevice({
      kind: "arithmetic",
      id: "intentional-bridge",
      inputEndpoint: "hub.read",
      outputEndpoint: "bridge.out",
      left: circuitOperand(iron),
      operator: "add",
      right: circuitConstant(0),
      output: copper,
    });

    network.step();
    expect(value(network.readEndpoint("green.sink"), iron)).toBe(0);
    network.step();
    expect(value(network.readEndpoint("hub.read"), iron)).toBe(13);
    expect(value(network.readEndpoint("red.sink"), iron)).toBe(13);
    expect(value(network.readEndpoint("green.sink"), iron)).toBe(0);
    expect(value(network.readEndpoint("green.sink"), copper)).toBe(0);

    network.step();
    expect(value(network.readEndpoint("green.sink"), iron)).toBe(0);
    expect(value(network.readEndpoint("green.sink"), copper)).toBe(13);
  });

  it("splits and merges components immediately after disconnect/connect without leaking stale component state", () => {
    const network = new CircuitNetwork();
    addEndpoints(network, ["a", "b", "c", "d"]);
    network.connect("red", "a", "b");
    network.connect("red", "b", "c");
    network.connect("red", "c", "d");
    network.registerDevice(
      constant(
        "source",
        "a",
        canonicalCircuitFrame([{ signal: iron, value: 21 }]),
      ),
    );
    afterSignalPublication(network);
    expect(value(network.readEndpoint("d"), iron)).toBe(21);
    expect(network.topology().components).toHaveLength(1);

    expect(network.disconnect("red", "b", "c")).toBe(true);
    network.step();
    expect(network.topology().components).toHaveLength(2);
    expect(value(network.readEndpoint("a"), iron)).toBe(21);
    expect(value(network.readEndpoint("b"), iron)).toBe(21);
    expect(value(network.readEndpoint("c"), iron)).toBe(0);
    expect(value(network.readEndpoint("d"), iron)).toBe(0);

    expect(network.connect("red", "c", "b")).toBe(true);
    network.step();
    expect(network.topology().components).toHaveLength(1);
    expect(value(network.readEndpoint("d"), iron)).toBe(21);
  });
});

describe("fixed-tick combinators and wildcards", () => {
  it("never allows a feedback loop to observe its own same-tick output", () => {
    const network = new CircuitNetwork();
    addEndpoints(network, ["loop.a", "loop.b"]);
    network.connect("red", "loop.a", "loop.b");
    network.registerDevice(
      constant(
        "seed",
        "loop.a",
        canonicalCircuitFrame([{ signal: counter, value: 1 }]),
      ),
    );
    network.registerDevice({
      kind: "arithmetic",
      id: "increment",
      inputEndpoint: "loop.a",
      outputEndpoint: "loop.b",
      left: circuitOperand(counter),
      operator: "add",
      right: circuitConstant(1),
      output: counter,
    });

    const observed: number[] = [];
    for (let tick = 0; tick < 6; tick += 1) {
      network.step();
      observed.push(value(network.readEndpoint("loop.a"), counter));
    }
    // Tick 0 has no active output. Thereafter each step can consume only the
    // prior increment, so this advances linearly instead of recursing.
    expect(observed).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it("implements any/every/each explicitly, including empty universal truth", () => {
    const frame = canonicalCircuitFrame([
      { signal: iron, value: 5 },
      { signal: copper, value: -2 },
      { signal: water, value: 10 },
    ]);
    const condition = (
      wildcard: "any" | "every" | "each",
      operator: CircuitCondition["operator"],
      threshold: number,
    ): CircuitCondition => ({
      left: circuitWildcard(wildcard),
      operator,
      right: circuitConstant(threshold),
    });

    expect(evaluateCircuitCondition(frame, condition("any", ">", 9))).toBe(
      true,
    );
    expect(
      evaluateCircuitCondition(frame, condition("every", "!=", 0)),
    ).toBe(true);
    expect(
      evaluateCircuitCondition(frame, condition("every", ">", 0)),
    ).toBe(false);
    expect(
      evaluateCircuitCondition([], condition("any", ">", 0)),
    ).toBe(false);
    expect(
      evaluateCircuitCondition([], condition("every", ">", 0)),
    ).toBe(true);
    // A machine-style condition treats `each` as existential.
    expect(
      evaluateCircuitCondition(frame, condition("each", "<", 0)),
    ).toBe(true);

    const network = new CircuitNetwork();
    addEndpoints(network, [
      "source",
      "each.in",
      "each.out",
      "each.sink",
      "any.out",
      "any.sink",
      "double.out",
      "double.sink",
    ]);
    network.connect("red", "source", "each.in");
    network.connect("red", "source", "each.sink");
    network.connect("green", "each.out", "each.sink");
    network.connect("green", "any.out", "any.sink");
    network.connect("telemetry", "double.out", "double.sink");
    network.registerDevice(constant("source", "source", frame));
    network.registerDevice({
      kind: "decider",
      id: "positive-filter",
      inputEndpoint: "each.in",
      outputEndpoint: "each.out",
      condition: condition("each", ">", 0),
      output: { wildcard: "each" },
      outputMode: "inputCount",
    });
    network.registerDevice({
      kind: "decider",
      id: "any-water",
      inputEndpoint: "each.in",
      outputEndpoint: "any.out",
      condition: condition("any", ">", 9),
      output: run,
      outputMode: "one",
    });
    network.registerDevice({
      kind: "arithmetic",
      id: "double-each",
      inputEndpoint: "each.in",
      outputEndpoint: "double.out",
      left: circuitOperand(circuitWildcard("each")),
      operator: "multiply",
      right: circuitConstant(2),
      output: { wildcard: "each" },
    });

    network.step();
    network.step();
    network.step();
    const eachFrame = network.readEndpoint("each.sink");
    expect(value(eachFrame, iron)).toBe(10);
    expect(value(eachFrame, copper)).toBe(-2);
    expect(value(eachFrame, water)).toBe(20);
    expect(value(network.readEndpoint("any.sink"), run)).toBe(1);
    const doubled = network.readEndpoint("double.sink");
    expect(value(doubled, iron)).toBe(10);
    expect(value(doubled, copper)).toBe(-4);
    expect(value(doubled, water)).toBe(20);
  });
});

describe("machine ports and a real delayed control chain", () => {
  it("runs sensor → arithmetic → decider → machine enable with exactly one tick per stage", () => {
    const network = new CircuitNetwork();
    addEndpoints(network, [
      "sensor.read",
      "sensor.out",
      "arith.in",
      "arith.out",
      "decider.in",
      "decider.out",
      "machine.in",
    ]);
    network.connect("red", "sensor.out", "arith.in");
    network.connect("green", "arith.out", "decider.in");
    network.connect("red", "decider.out", "machine.in");

    network.registerMachinePort({
      id: "ore-sensor",
      inputEndpoint: "sensor.read",
      outputEndpoint: "sensor.out",
    });
    network.registerDevice({
      kind: "arithmetic",
      id: "double-ore",
      inputEndpoint: "arith.in",
      outputEndpoint: "arith.out",
      left: circuitOperand(iron),
      operator: "multiply",
      right: circuitConstant(2),
      output: scaled,
    });
    network.registerDevice({
      kind: "decider",
      id: "enough-ore",
      inputEndpoint: "decider.in",
      outputEndpoint: "decider.out",
      condition: {
        left: scaled,
        operator: ">=",
        right: circuitConstant(10),
      },
      output: run,
      outputMode: "one",
    });
    network.registerMachinePort({
      id: "fabricator-control",
      inputEndpoint: "machine.in",
      enableCondition: {
        left: run,
        operator: ">",
        right: circuitConstant(0),
      },
    });

    const sensorFrame = canonicalCircuitFrame([
      { signal: iron, value: 6 },
    ]);
    const first = network.step([
      { portId: "ore-sensor", signals: sensorFrame },
    ]);
    expect(first.machineControls.find(
      (control) => control.portId === "fabricator-control",
    )?.enabled).toBe(false);
    expect(value(network.readEndpoint("arith.in"), iron)).toBe(0);

    const second = network.step();
    expect(value(network.readEndpoint("arith.in"), iron)).toBe(6);
    expect(value(network.readEndpoint("decider.in"), scaled)).toBe(0);
    expect(network.getMachineControl("fabricator-control")?.enabled).toBe(
      false,
    );

    const third = network.step();
    expect(value(network.readEndpoint("decider.in"), scaled)).toBe(12);
    expect(value(network.readEndpoint("machine.in"), run)).toBe(0);
    expect(network.getMachineControl("fabricator-control")?.enabled).toBe(
      false,
    );

    const fourth = network.step();
    expect(value(network.readEndpoint("machine.in"), run)).toBe(1);
    expect(network.getMachineControl("fabricator-control")?.enabled).toBe(
      true,
    );

    const proofEnvironment = (
      globalThis as {
        process?: { env?: Record<string, string | undefined> };
      }
    ).process?.env?.CINDERLINE_CIRCUIT_PROOF;
    if (proofEnvironment === "1") {
      const restored = restoreCircuitNetwork(
        cloneJson(network.serialize()),
      );
      const originalContinuation = network.step();
      const restoredContinuation = restored.step();
      console.log(
        `[circuit-core-proof]${JSON.stringify({
          format: "cinderline-circuit-core-proof",
          oneTickStages: {
            sensorPublishedAtTick: first.tick,
            arithmeticReadAtTick: second.tick,
            deciderReadAtTick: third.tick,
            machineEnabledAtTick: fourth.tick,
          },
          topology: {
            componentCount: fourth.topology.components.length,
            componentIds: fourth.topology.components.map(
              (component) => component.id,
            ),
          },
          finalControl:
            fourth.machineControls.find(
              (control) =>
                control.portId === "fabricator-control",
            ) ?? null,
          workUnits: [
            first.workUnits,
            second.workUnits,
            third.workUnits,
            fourth.workUnits,
          ],
          canonicalByteLength: network.canonicalBytes().length,
          exactRestoreContinuation:
            JSON.stringify(originalContinuation) ===
              JSON.stringify(restoredContinuation) &&
            network.canonicalString() === restored.canonicalString(),
        })}`,
      );
    }
  });

  it("provides deterministic enable, filter, sorter, and power-switch hooks", () => {
    const network = new CircuitNetwork();
    addEndpoints(network, ["source", "machine"]);
    network.connect("red", "source", "machine");
    network.registerDevice(
      constant(
        "control-signals",
        "source",
        canonicalCircuitFrame([
          { signal: iron, value: 8 },
          { signal: copper, value: 8 },
          { signal: power, value: 1 },
        ]),
      ),
    );
    const routes: CircuitMachinePortDefinition["sorterRoutes"] = [
      {
        priority: 20,
        output: "west",
        condition: {
          left: iron,
          operator: ">",
          right: circuitConstant(0),
        },
      },
      {
        priority: 10,
        output: "east",
        condition: {
          left: copper,
          operator: ">",
          right: circuitConstant(0),
        },
      },
    ];
    network.registerMachinePort({
      id: "sorter-control",
      inputEndpoint: "machine",
      enableCondition: {
        left: circuitWildcard("any"),
        operator: ">=",
        right: circuitConstant(8),
      },
      powerSwitchCondition: {
        left: power,
        operator: "==",
        right: circuitConstant(1),
      },
      filter: {
        // Deliberately reverse canonical order; ties must not use insertion.
        candidates: [iron, copper],
        minimum: 1,
      },
      sorterRoutes: routes,
      sorterFallback: "overflow",
    });

    afterSignalPublication(network);
    const control = network.getMachineControl("sorter-control");
    expect(control).toMatchObject({
      enabled: true,
      powerSwitchClosed: true,
      filterSignal: copper,
      sorterOutput: "east",
    });
    expect(Object.isFrozen(control)).toBe(true);
  });
});

describe("bounded work and hostile persistence", () => {
  function persistentNetwork(): CircuitNetwork {
    const network = new CircuitNetwork({
      limits: {
        maxEndpoints: 16,
        maxWires: 16,
        maxDevices: 16,
        maxMachinePorts: 16,
        maxSignalsPerFrame: 16,
        maxSignalVisitsPerTick: 2_000,
      },
    });
    addEndpoints(network, ["a", "b", "c"]);
    network.connect("red", "a", "b");
    network.connect("green", "b", "c");
    network.registerDevice(
      constant(
        "source",
        "a",
        canonicalCircuitFrame([
          { signal: iron, value: 4 },
          { signal: water, value: 2 },
        ]),
      ),
    );
    network.registerDevice({
      kind: "arithmetic",
      id: "bridge",
      inputEndpoint: "b",
      outputEndpoint: "c",
      left: circuitOperand(iron),
      operator: "add",
      right: circuitConstant(3),
      output: copper,
    });
    network.registerMachinePort({
      id: "reader",
      inputEndpoint: "c",
      enableCondition: {
        left: copper,
        operator: ">",
        right: circuitConstant(0),
      },
      filter: {
        candidates: [water, copper],
        minimum: 1,
      },
      sorterRoutes: [
        {
          priority: 20,
          output: "overflow",
          condition: {
            left: water,
            operator: ">",
            right: circuitConstant(0),
          },
        },
        {
          priority: 10,
          output: "product",
          condition: {
            left: copper,
            operator: ">",
            right: circuitConstant(0),
          },
        },
      ],
      sorterFallback: "idle",
    });
    network.step();
    network.step();
    network.step();
    return network;
  }

  it("round-trips canonical bytes and continues bit-identically", () => {
    const original = persistentNetwork();
    const bytes = [...original.canonicalBytes()];
    const restored = restoreCircuitNetwork(
      cloneJson(original.serialize()),
    );

    expect([...restored.canonicalBytes()]).toEqual(bytes);
    expect(restored.topology()).toEqual(original.topology());
    expect(restored.readEndpoint("c")).toEqual(
      original.readEndpoint("c"),
    );
    expect(restored.getMachineControl("reader")).toEqual(
      original.getMachineControl("reader"),
    );

    for (let tick = 0; tick < 6; tick += 1) {
      expect(restored.step()).toEqual(original.step());
      expect(restored.canonicalString()).toBe(
        original.canonicalString(),
      );
    }

    // Sources may be configured between ticks. Their absent active-output
    // entry is legitimate until the next step and must still round-trip.
    original.addEndpoint("late.output");
    original.registerDevice(
      constant(
        "late-source",
        "late.output",
        canonicalCircuitFrame([{ signal: run, value: 1 }]),
      ),
    );
    const lateRestore = restoreCircuitNetwork(
      cloneJson(original.serialize()),
    );
    expect(lateRestore.canonicalString()).toBe(
      original.canonicalString(),
    );
    expect(lateRestore.step()).toEqual(original.step());
  });

  it("rejects accessors, polluted prototypes, unknown keys, sparse arrays, unsafe values, and non-canonical order", () => {
    const save = persistentNetwork().serialize();

    const accessor = cloneJson(save) as unknown as Record<
      string,
      unknown
    >;
    Object.defineProperty(accessor, "tick", {
      enumerable: true,
      get: () => 3,
    });
    expect(() => restoreCircuitNetwork(accessor)).toThrow(
      CircuitValidationError,
    );

    const polluted = cloneJson(save) as object;
    Object.setPrototypeOf(polluted, { compromised: true });
    expect(() => restoreCircuitNetwork(polluted)).toThrow(
      CircuitValidationError,
    );

    const unknown = {
      ...cloneJson(save),
      surprise: true,
    };
    expect(() => restoreCircuitNetwork(unknown)).toThrow(
      CircuitValidationError,
    );

    const sparse = cloneJson(save) as unknown as {
      endpoints: unknown[];
    };
    sparse.endpoints = new Array(3);
    sparse.endpoints[0] = "a";
    expect(() => restoreCircuitNetwork(sparse)).toThrow(
      CircuitValidationError,
    );

    const unsafe = cloneJson(save) as unknown as {
      state: {
        activeOutputs: {
          signals: { value: number }[];
        }[];
      };
    };
    unsafe.state.activeOutputs[0]!.signals[0]!.value =
      Number.MAX_SAFE_INTEGER + 1;
    expect(() => restoreCircuitNetwork(unsafe)).toThrow(
      CircuitValidationError,
    );

    const reordered = cloneJson(save) as unknown as {
      endpoints: string[];
    };
    reordered.endpoints.reverse();
    expect(() => restoreCircuitNetwork(reordered)).toThrow(
      CircuitValidationError,
    );

    const nestedAccessor = cloneJson(save);
    Object.defineProperty(
      nestedAccessor.state.activeOutputs[0]!.signals[0]!,
      "value",
      { enumerable: true, get: () => 4 },
    );
    expect(() => restoreCircuitNetwork(nestedAccessor)).toThrow(
      CircuitValidationError,
    );

    const nestedOrder = cloneJson(save) as unknown as {
      machinePorts: {
        filter: { candidates: unknown[] } | null;
        sorterRoutes: unknown[];
      }[];
    };
    nestedOrder.machinePorts[0]!.filter!.candidates.reverse();
    expect(() => restoreCircuitNetwork(nestedOrder)).toThrow(
      CircuitValidationError,
    );

    const routeOrder = cloneJson(save) as unknown as {
      machinePorts: { sorterRoutes: unknown[] }[];
    };
    routeOrder.machinePorts[0]!.sorterRoutes.reverse();
    expect(() => restoreCircuitNetwork(routeOrder)).toThrow(
      CircuitValidationError,
    );

    const invalidBoolean = cloneJson(save) as unknown as {
      devices: { enabled?: unknown }[];
    };
    invalidBoolean.devices[0]!.enabled = "yes";
    expect(() => restoreCircuitNetwork(invalidBoolean)).toThrow(
      CircuitValidationError,
    );
  });

  it("enforces structural and per-tick limits without partially advancing state", () => {
    const endpointLimited = new CircuitNetwork({
      limits: { maxEndpoints: 1 },
    });
    endpointLimited.addEndpoint("only");
    expect(() => endpointLimited.addEndpoint("overflow")).toThrow(
      CircuitCapacityError,
    );
    expect(() =>
      canonicalCircuitFrame(
        [
          { signal: iron, value: 1 },
          { signal: iron, value: 2 },
        ],
        1,
      )
    ).toThrow(CircuitCapacityError);

    const workLimited = new CircuitNetwork({
      limits: {
        maxEndpoints: 8,
        maxWires: 8,
        maxDevices: 8,
        maxMachinePorts: 8,
        maxSignalsPerFrame: 8,
        maxSignalVisitsPerTick: 3,
      },
    });
    addEndpoints(workLimited, ["a", "b"]);
    workLimited.connect("red", "a", "b");
    workLimited.registerDevice(
      constant(
        "source",
        "a",
        canonicalCircuitFrame([{ signal: iron, value: 1 }]),
      ),
    );
    expect(() => workLimited.step()).toThrow(CircuitCapacityError);
    expect(workLimited.tickCount).toBe(0);
    expect(workLimited.canonicalString()).toContain('"tick":0');
  });

  it("keeps a 1,024-endpoint component inside its exact linear work budget", () => {
    const endpointCount = 1_024;
    const network = new CircuitNetwork({
      limits: {
        maxEndpoints: endpointCount,
        maxWires: endpointCount - 1,
        maxDevices: 1,
        maxMachinePorts: 1,
        maxSignalsPerFrame: 4,
        maxSignalVisitsPerTick: 4_000,
      },
    });
    for (let index = 0; index < endpointCount; index += 1) {
      network.addEndpoint(`node-${String(index).padStart(4, "0")}`);
    }
    for (let index = 1; index < endpointCount; index += 1) {
      network.connect(
        "red",
        "node-0000",
        `node-${String(index).padStart(4, "0")}`,
      );
    }
    network.registerDevice(
      constant(
        "source",
        "node-0000",
        canonicalCircuitFrame([{ signal: iron, value: 1 }]),
      ),
    );

    network.step();
    const propagated = network.step();
    expect(propagated.workUnits).toBe(3_073);
    expect(propagated.topology.components).toHaveLength(1);
    expect(
      value(network.readEndpoint("node-1023"), iron),
    ).toBe(1);
  });
});
