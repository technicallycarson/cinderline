import { describe, expect, it } from "vitest";

import {
  CIRCUIT_ARITHMETIC_OPERATORS,
  CIRCUIT_COMPARISON_OPERATORS,
  buildCircuitDeviceConfiguration,
  buildCircuitMachineConfiguration,
  buildCircuitSignal,
  circuitDeviceConfigurationFromSnapshot,
  circuitMachineConfigurationFromSnapshot,
  circuitPointForEndpoint,
  commitCircuitHistory,
  preflightCircuitWire,
  type CircuitConditionDraft,
  type CircuitMachineDraft,
} from "../src/game/circuitAuthoring";
import {
  circuitMachineCapabilities,
  circuitEndpointId,
} from "../src/game/circuit-integration";
import { FactorySimulation } from "../src/game/simulation";
import {
  Direction,
  type CircuitConnectionPoint,
  type EntityKind,
  type SerializedSimulation,
} from "../src/game/types";

const signal = (
  name: string,
  type: "item" | "fluid" | "virtual" = "virtual",
) => ({
  source: "signal" as const,
  type,
  name,
});

const constant = (value: number | string) => ({
  source: "constant" as const,
  type: "virtual" as const,
  name: "signal-A",
  value,
});

const condition = (
  name = "run",
  operator: CircuitConditionDraft["operator"] = ">",
  value: number | string = 0,
): CircuitConditionDraft => ({
  left: signal(name),
  operator,
  right: constant(value),
});

function blank(): FactorySimulation {
  return new FactorySimulation({
    width: 40,
    height: 28,
    seed: 0xc1a0_7e,
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
) {
  const result = simulation.place(kind, x, y, Direction.East);
  if (!result.ok) throw new Error(result.reason);
  return result.entity;
}

function point(
  entityId: number,
  connector: CircuitConnectionPoint["connector"],
): CircuitConnectionPoint {
  return { entityId, connector };
}

describe("player circuit authoring mappings", () => {
  it("maps typed catalog and virtual signals while rejecting invalid names", () => {
    expect(buildCircuitSignal({ type: "item", name: "ironPlate" })).toEqual({
      ok: true,
      value: { type: "item", name: "ironPlate" },
    });
    expect(buildCircuitSignal({ type: "fluid", name: "crudeOil" })).toEqual({
      ok: true,
      value: { type: "fluid", name: "crudeOil" },
    });
    expect(buildCircuitSignal({ type: "virtual", name: "line/run-2" })).toEqual({
      ok: true,
      value: { type: "virtual", name: "line/run-2" },
    });
    expect(buildCircuitSignal({ type: "item", name: "notAnItem" }).ok).toBe(
      false,
    );
    expect(buildCircuitSignal({ type: "virtual", name: "bad signal" }).ok).toBe(
      false,
    );
  });

  it("canonicalizes a multi-signal constant frame and preserves enabled state", () => {
    const result = buildCircuitDeviceConfiguration("constantCombinator", {
      kind: "constant",
      enabled: false,
      signals: [
        { type: "virtual", name: "run", value: "2" },
        { type: "item", name: "ironPlate", value: 4 },
        { type: "virtual", name: "run", value: -1 },
        { type: "fluid", name: "crudeOil", value: 0 },
      ],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        kind: "constant",
        enabled: false,
        signals: [
          {
            signal: { type: "item", name: "ironPlate" },
            value: 4,
          },
          { signal: { type: "virtual", name: "run" }, value: 1 },
        ],
      },
    });
  });

  it.each(CIRCUIT_ARITHMETIC_OPERATORS)(
    "maps arithmetic operator %s with concrete, constant, and Each operands",
    (operator) => {
      const result = buildCircuitDeviceConfiguration(
        "arithmeticCombinator",
        {
          kind: "arithmetic",
          left: {
            source: "each",
            type: "virtual",
            name: "ignored",
            value: 0,
          },
          operator,
          right: constant(2),
          output: {
            source: "each",
            type: "virtual",
            name: "ignored",
          },
        },
      );
      expect(result).toEqual({
        ok: true,
        value: {
          kind: "arithmetic",
          left: {
            kind: "signal",
            selector: { wildcard: "each" },
          },
          operator,
          right: { kind: "constant", value: 2 },
          output: { wildcard: "each" },
        },
      });
    },
  );

  it("rejects aggregate arithmetic selectors and unbound Each output", () => {
    expect(
      buildCircuitDeviceConfiguration("arithmeticCombinator", {
        kind: "arithmetic",
        left: {
          source: "any",
          type: "virtual",
          name: "ignored",
        },
        operator: "add",
        right: constant(1),
        output: signal("sum"),
      }).ok,
    ).toBe(false);
    expect(
      buildCircuitDeviceConfiguration("arithmeticCombinator", {
        kind: "arithmetic",
        left: signal("run"),
        operator: "add",
        right: constant(1),
        output: {
          source: "each",
          type: "virtual",
          name: "ignored",
        },
      }).ok,
    ).toBe(false);
  });

  it.each(CIRCUIT_COMPARISON_OPERATORS)(
    "maps decider comparison %s, wildcard selection, output, and count mode",
    (operator) => {
      const result = buildCircuitDeviceConfiguration("deciderCombinator", {
        kind: "decider",
        condition: {
          left: {
            source: "any",
            type: "virtual",
            name: "ignored",
          },
          operator,
          right: signal("threshold"),
        },
        output: signal("go"),
        outputMode: "inputCount",
      });
      expect(result).toEqual({
        ok: true,
        value: {
          kind: "decider",
          condition: {
            left: { wildcard: "any" },
            operator,
            right: {
              kind: "signal",
              selector: { type: "virtual", name: "threshold" },
            },
          },
          output: { type: "virtual", name: "go" },
          outputMode: "inputCount",
        },
      });
    },
  );

  it("rejects kind mismatches and non-integral numeric input", () => {
    expect(
      buildCircuitDeviceConfiguration("deciderCombinator", {
        kind: "constant",
        enabled: true,
        signals: [],
      }).ok,
    ).toBe(false);
    expect(
      buildCircuitDeviceConfiguration("constantCombinator", {
        kind: "constant",
        enabled: true,
        signals: [{ type: "virtual", name: "run", value: "1.5" }],
      }).ok,
    ).toBe(false);
  });
});

describe("machine capability gating", () => {
  const capabilityMatrix: readonly [
    EntityKind,
    boolean,
    boolean,
    boolean,
    boolean,
  ][] = [
    ["extractor", true, true, false, false],
    ["manifold", true, false, false, true],
    ["inserter", true, true, true, false],
    ["smelter", true, true, false, false],
    ["fabricator", true, true, false, false],
    ["generator", true, false, false, false],
    ["storage", false, false, false, false],
    ["beacon", true, true, false, false],
    ["fluidSource", false, false, false, false],
    ["fluidPump", false, true, false, false],
    ["fluidTank", false, false, false, false],
    ["fluidProcessor", false, true, false, false],
  ];

  it.each(capabilityMatrix)(
    "exposes only supported controls for %s",
    (kind, enable, powerSwitch, filter, sorter) => {
      expect(circuitMachineCapabilities(kind)).toEqual({
        enable,
        powerSwitch,
        filter,
        sorter,
      });
      const probes: readonly [
        "enableCondition" | "powerSwitchCondition" | "filter" | "sorterRoutes",
        CircuitMachineDraft,
      ][] = [
          ["enableCondition", { enableCondition: condition() }],
          ["powerSwitchCondition", { powerSwitchCondition: condition() }],
          [
            "filter",
            {
              filter: {
                candidates: [{ type: "item", name: "ironPlate" }],
                minimum: 1,
              },
            },
          ],
          [
            "sorterRoutes",
            {
              sorterRoutes: [
                {
                  priority: 0,
                  output: "A",
                  condition: condition(),
                },
              ],
              sorterFallback: "B",
            },
          ],
        ];
      const expected = { enableCondition: enable, powerSwitchCondition: powerSwitch, filter, sorterRoutes: sorter };
      for (const [field, draft] of probes) {
        expect(
          buildCircuitMachineConfiguration(kind, draft).ok,
          `${kind}.${field}`,
        ).toBe(expected[field]);
      }
    },
  );

  it("canonicalizes filter candidates and sorter priority, rejecting duplicate priorities", () => {
    const filter = buildCircuitMachineConfiguration("inserter", {
      filter: {
        candidates: [
          { type: "item", name: "ironPlate" },
          { type: "item", name: "copperPlate" },
          { type: "item", name: "ironPlate" },
        ],
        minimum: "3",
      },
    });
    expect(filter).toEqual({
      ok: true,
      value: {
        filter: {
          candidates: [
            { type: "item", name: "copperPlate" },
            { type: "item", name: "ironPlate" },
          ],
          minimum: 3,
        },
      },
    });

    const routes = buildCircuitMachineConfiguration("manifold", {
      sorterRoutes: [
        { priority: 5, output: "B", condition: condition("b") },
        { priority: 1, output: "A", condition: condition("a") },
      ],
      sorterFallback: "B",
    });
    expect(routes.ok && routes.value.sorterRoutes?.map((route) => route.priority))
      .toEqual([1, 5]);
    expect(
      buildCircuitMachineConfiguration("manifold", {
        sorterRoutes: [
          { priority: 1, output: "A", condition: condition("a") },
          { priority: 1, output: "B", condition: condition("b") },
        ],
      }).ok,
    ).toBe(false);
  });
});

describe("wire preflight and atomic history", () => {
  it("reports invalid, self, reach, duplicate, and accepted endpoints deterministically", () => {
    const simulation = blank();
    const first = place(simulation, "constantCombinator", 2, 2);
    const near = place(simulation, "arithmeticCombinator", 6, 2);
    const far = place(simulation, "deciderCombinator", 25, 2);
    const snapshot = () => simulation.circuitSnapshot();
    const center = (entityId: number) => {
      const entity = simulation.getEntity(entityId);
      return entity
        ? {
            x: entity.x + entity.width / 2,
            y: entity.y + entity.height / 2,
          }
        : null;
    };
    const source = point(first.id, "output");
    const target = point(near.id, "input");

    expect(
      preflightCircuitWire(
        snapshot(),
        "red",
        point(999, "io"),
        target,
        center,
      ),
    ).toEqual({ ok: false, reason: "invalid-endpoint" });
    expect(
      preflightCircuitWire(snapshot(), "red", source, source, center),
    ).toEqual({ ok: false, reason: "same-endpoint" });
    expect(
      preflightCircuitWire(
        snapshot(),
        "red",
        source,
        point(far.id, "input"),
        center,
      ),
    ).toEqual({ ok: false, reason: "out-of-reach" });
    expect(
      preflightCircuitWire(snapshot(), "red", source, target, center),
    ).toEqual({
      ok: true,
      endpointA: circuitEndpointId(first.id, "output"),
      endpointB: circuitEndpointId(near.id, "input"),
    });
    expect(simulation.connectCircuitWire("red", source, target)).toBe(true);
    expect(
      preflightCircuitWire(snapshot(), "red", source, target, center),
    ).toEqual({ ok: false, reason: "duplicate" });
    expect(
      circuitPointForEndpoint(
        snapshot(),
        circuitEndpointId(near.id, "input"),
      ),
    ).toEqual(target);
  });

  it("preserves undo and redo exactly on false/throw, then clears redo only on acceptance", () => {
    const undo = [{ revision: 1 }];
    const redo = [{ revision: 3 }];
    let revision = 2;
    const snapshot = () => ({ revision });

    expect(
      commitCircuitHistory({ undo, redo }, snapshot, () => false),
    ).toBe(false);
    expect({ undo, redo, revision }).toEqual({
      undo: [{ revision: 1 }],
      redo: [{ revision: 3 }],
      revision: 2,
    });
    const redoEntry = redo.pop();
    expect(redoEntry).toEqual({ revision: 3 });
    revision = redoEntry!.revision;
    redo.push({ revision: 4 });

    expect(
      commitCircuitHistory({ undo, redo }, snapshot, () => {
        throw new Error("authoritative rejection");
      }),
    ).toBe(false);
    expect(undo).toEqual([{ revision: 1 }]);
    expect(redo).toEqual([{ revision: 4 }]);

    expect(
      commitCircuitHistory({ undo, redo }, snapshot, () => {
        revision = 5;
        return true;
      }),
    ).toBe(true);
    expect(undo).toEqual([{ revision: 1 }, { revision: 3 }]);
    expect(redo).toEqual([]);
    expect(revision).toBe(5);
  });
});

describe("authored circuit causality and persistence", () => {
  it("maps combined inserter, manifold, and fluid-pump authoring into live capability decisions", () => {
    const simulation = blank();
    const source = place(simulation, "constantCombinator", 3, 7);
    const inserter = place(simulation, "inserter", 6, 6);
    const manifold = place(simulation, "manifold", 6, 8);
    const pump = place(simulation, "fluidPump", 8, 7);
    const sourceProgram = buildCircuitDeviceConfiguration(
      "constantCombinator",
      {
        kind: "constant",
        enabled: true,
        signals: [
          { type: "virtual", name: "run", value: 1 },
          { type: "virtual", name: "go", value: 1 },
          { type: "virtual", name: "routeA", value: 1 },
          { type: "virtual", name: "routeB", value: 1 },
          { type: "item", name: "ironPlate", value: 5 },
        ],
      },
    );
    const inserterProgram = buildCircuitMachineConfiguration("inserter", {
      enableCondition: condition("go", ">", 0),
      powerSwitchCondition: condition("run", ">", 0),
      filter: {
        candidates: [{ type: "item", name: "ironPlate" }],
        minimum: 2,
      },
    });
    const manifoldProgram = buildCircuitMachineConfiguration("manifold", {
      sorterRoutes: [
        {
          priority: 10,
          output: "A",
          condition: condition("routeA", ">", 0),
        },
        {
          priority: 20,
          output: "B",
          condition: condition("routeB", ">", 0),
        },
      ],
      sorterFallback: "A",
    });
    const pumpProgram = buildCircuitMachineConfiguration("fluidPump", {
      powerSwitchCondition: condition("run", ">", 0),
    });
    if (
      !sourceProgram.ok ||
      !inserterProgram.ok ||
      !manifoldProgram.ok ||
      !pumpProgram.ok
    ) {
      throw new Error("capability fixture authoring failed");
    }
    expect(
      simulation.configureCircuitDevice(source.id, sourceProgram.value),
    ).toBe(true);
    expect(
      simulation.configureCircuitMachinePort(
        inserter.id,
        inserterProgram.value,
      ),
    ).toBe(true);
    expect(
      simulation.configureCircuitMachinePort(
        manifold.id,
        manifoldProgram.value,
      ),
    ).toBe(true);
    expect(
      simulation.configureCircuitMachinePort(pump.id, pumpProgram.value),
    ).toBe(true);
    for (const [color, target] of [
      ["red", inserter],
      ["green", manifold],
      ["red", pump],
    ] as const) {
      expect(
        simulation.connectCircuitWire(
          color,
          point(source.id, "output"),
          point(target.id, "io"),
        ),
      ).toBe(true);
    }
    simulation.step(2);
    expect(simulation.getCircuitMachineControl(inserter.id)).toMatchObject({
      enabled: true,
      powerSwitchClosed: true,
      filterSignal: { type: "item", name: "ironPlate" },
    });
    expect(
      simulation.getCircuitMachineControl(manifold.id)?.sorterOutput,
    ).toBe("A");
    expect(
      simulation.getCircuitMachineControl(pump.id)?.powerSwitchClosed,
    ).toBe(true);

    const routeBProgram = buildCircuitDeviceConfiguration(
      "constantCombinator",
      {
        kind: "constant",
        enabled: true,
        signals: [
          { type: "virtual", name: "run", value: 1 },
          { type: "virtual", name: "go", value: 1 },
          { type: "virtual", name: "routeA", value: 0 },
          { type: "virtual", name: "routeB", value: 1 },
          { type: "item", name: "ironPlate", value: 5 },
        ],
      },
    );
    if (!routeBProgram.ok) throw new Error(routeBProgram.error);
    expect(
      simulation.configureCircuitDevice(source.id, routeBProgram.value),
    ).toBe(true);
    simulation.step(2);
    expect(
      simulation.getCircuitMachineControl(manifold.id)?.sorterOutput,
    ).toBe("B");

    const stoppedProgram = buildCircuitDeviceConfiguration(
      "constantCombinator",
      {
        kind: "constant",
        enabled: true,
        signals: [
          { type: "virtual", name: "run", value: 0 },
          { type: "virtual", name: "go", value: 0 },
        ],
      },
    );
    if (!stoppedProgram.ok) throw new Error(stoppedProgram.error);
    expect(
      simulation.configureCircuitDevice(source.id, stoppedProgram.value),
    ).toBe(true);
    simulation.step(2);
    expect(simulation.getCircuitMachineControl(inserter.id)).toMatchObject({
      enabled: false,
      powerSwitchClosed: false,
      filterSignal: null,
    });
    expect(
      simulation.getCircuitMachineControl(manifold.id)?.sorterOutput,
    ).toBe("A");
    expect(
      simulation.getCircuitMachineControl(pump.id)?.powerSwitchClosed,
    ).toBe(false);
  });

  it("drives a real machine through constant → arithmetic → decider, then restores exactly", () => {
    const simulation = blank();
    const source = place(simulation, "constantCombinator", 2, 5);
    const arithmetic = place(simulation, "arithmeticCombinator", 5, 5);
    const decider = place(simulation, "deciderCombinator", 8, 5);
    const inserter = place(simulation, "inserter", 10, 5);

    const sourceProgram = buildCircuitDeviceConfiguration(
      "constantCombinator",
      {
        kind: "constant",
        enabled: true,
        signals: [{ type: "virtual", name: "run", value: 1 }],
      },
    );
    const arithmeticProgram = buildCircuitDeviceConfiguration(
      "arithmeticCombinator",
      {
        kind: "arithmetic",
        left: signal("run"),
        operator: "multiply",
        right: constant(2),
        output: signal("scaled"),
      },
    );
    const deciderProgram = buildCircuitDeviceConfiguration(
      "deciderCombinator",
      {
        kind: "decider",
        condition: condition("scaled", ">=", 2),
        output: signal("go"),
        outputMode: "one",
      },
    );
    const machineProgram = buildCircuitMachineConfiguration("inserter", {
      enableCondition: condition("go", ">", 0),
    });
    if (
      !sourceProgram.ok ||
      !arithmeticProgram.ok ||
      !deciderProgram.ok ||
      !machineProgram.ok
    ) {
      throw new Error("fixture authoring failed");
    }
    expect(
      simulation.configureCircuitDevice(source.id, sourceProgram.value),
    ).toBe(true);
    expect(
      simulation.configureCircuitDevice(
        arithmetic.id,
        arithmeticProgram.value,
      ),
    ).toBe(true);
    expect(
      simulation.configureCircuitDevice(decider.id, deciderProgram.value),
    ).toBe(true);
    expect(
      simulation.configureCircuitMachinePort(
        inserter.id,
        machineProgram.value,
      ),
    ).toBe(true);
    expect(
      simulation.connectCircuitWire(
        "red",
        point(source.id, "output"),
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

    const enabled: boolean[] = [];
    for (let index = 0; index < 4; index += 1) {
      simulation.step();
      enabled.push(
        simulation.getCircuitMachineControl(inserter.id)!.enabled,
      );
    }
    expect(enabled).toEqual([false, false, false, true]);

    const serialized: SerializedSimulation = simulation.serialize();
    const restored = FactorySimulation.restore(serialized);
    expect(restored.serialize()).toEqual(serialized);
    expect(
      circuitDeviceConfigurationFromSnapshot(
        restored.circuitSnapshot(),
        source.id,
      ),
    ).toEqual(sourceProgram.value);
    expect(
      circuitMachineConfigurationFromSnapshot(
        restored.circuitSnapshot(),
        inserter.id,
      ),
    ).toEqual(machineProgram.value);

    const disabledProgram = buildCircuitDeviceConfiguration(
      "constantCombinator",
      {
        kind: "constant",
        enabled: false,
        signals: [{ type: "virtual", name: "run", value: 1 }],
      },
    );
    if (!disabledProgram.ok) throw new Error(disabledProgram.error);
    expect(
      restored.configureCircuitDevice(source.id, disabledProgram.value),
    ).toBe(true);
    for (let index = 0; index < 4; index += 1) restored.step();
    expect(restored.getCircuitMachineControl(inserter.id)?.enabled).toBe(
      false,
    );
  });
});
