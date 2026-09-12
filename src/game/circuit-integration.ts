import {
  canonicalCircuitFrame,
  circuitConstant,
  circuitOperand,
  circuitSignal,
  evaluateCircuitCondition,
  type CircuitDeviceDefinition,
  type CircuitFrame,
  type CircuitMachineControl,
  type CircuitMachinePortDefinition,
  type CircuitSignalValue,
  type SerializedCircuitNetwork,
} from "./circuit-network";
import { ITEM_IDS } from "./catalog";
import {
  Direction,
  type CircuitConnector,
  type CircuitDeviceConfiguration,
  type CircuitEntityKind,
  type CircuitMachinePortConfiguration,
  type EntityKind,
  type EntityState,
  type GridPoint,
  type ItemId,
} from "./types";

export const CIRCUIT_WIRE_REACH_TILES = 9;
export const CIRCUIT_SORTER_OUTPUT_A = "A";
export const CIRCUIT_SORTER_OUTPUT_B = "B";

export interface CircuitEndpointBinding {
  readonly endpointId: string;
  readonly entityId: number;
  readonly connector: CircuitConnector;
}

export interface CircuitMachineCapabilities {
  readonly enable: boolean;
  readonly powerSwitch: boolean;
  readonly filter: boolean;
  readonly sorter: boolean;
}

const MACHINE_CAPABILITIES: Readonly<
  Partial<Record<EntityKind, CircuitMachineCapabilities>>
> = Object.freeze({
  extractor: Object.freeze({
    enable: true,
    powerSwitch: true,
    filter: false,
    sorter: false,
  }),
  manifold: Object.freeze({
    enable: true,
    powerSwitch: false,
    filter: false,
    sorter: true,
  }),
  inserter: Object.freeze({
    enable: true,
    powerSwitch: true,
    filter: true,
    sorter: false,
  }),
  smelter: Object.freeze({
    enable: true,
    powerSwitch: true,
    filter: false,
    sorter: false,
  }),
  fabricator: Object.freeze({
    enable: true,
    powerSwitch: true,
    filter: false,
    sorter: false,
  }),
  generator: Object.freeze({
    enable: true,
    powerSwitch: false,
    filter: false,
    sorter: false,
  }),
  storage: Object.freeze({
    enable: false,
    powerSwitch: false,
    filter: false,
    sorter: false,
  }),
  beacon: Object.freeze({
    enable: true,
    powerSwitch: true,
    filter: false,
    sorter: false,
  }),
  fluidSource: Object.freeze({
    enable: false,
    powerSwitch: false,
    filter: false,
    sorter: false,
  }),
  fluidPump: Object.freeze({
    enable: false,
    powerSwitch: true,
    filter: false,
    sorter: false,
  }),
  fluidTank: Object.freeze({
    enable: false,
    powerSwitch: false,
    filter: false,
    sorter: false,
  }),
  fluidProcessor: Object.freeze({
    enable: false,
    powerSwitch: true,
    filter: false,
    sorter: false,
  }),
});

export function circuitDeviceId(entityId: number): string {
  return `entity:${entityId}:device`;
}

export function circuitMachinePortId(entityId: number): string {
  return `entity:${entityId}:machine`;
}

export function circuitEndpointId(
  entityId: number,
  connector: CircuitConnector,
): string {
  return `entity:${entityId}:${connector}`;
}

export function isCircuitMachineKind(
  kind: EntityKind,
): boolean {
  return MACHINE_CAPABILITIES[kind] !== undefined;
}

export function circuitMachineCapabilities(
  kind: EntityKind,
): CircuitMachineCapabilities | null {
  return MACHINE_CAPABILITIES[kind] ?? null;
}

export function circuitEndpointBindings(
  entityId: number,
  kind: EntityKind,
): readonly CircuitEndpointBinding[] {
  if (kind === "constantCombinator") {
    return Object.freeze([
      Object.freeze({
        endpointId: circuitEndpointId(entityId, "output"),
        entityId,
        connector: "output" as const,
      }),
    ]);
  }
  if (
    kind === "arithmeticCombinator" ||
    kind === "deciderCombinator"
  ) {
    return Object.freeze([
      Object.freeze({
        endpointId: circuitEndpointId(entityId, "input"),
        entityId,
        connector: "input" as const,
      }),
      Object.freeze({
        endpointId: circuitEndpointId(entityId, "output"),
        entityId,
        connector: "output" as const,
      }),
    ]);
  }
  if (isCircuitMachineKind(kind)) {
    return Object.freeze([
      Object.freeze({
        endpointId: circuitEndpointId(entityId, "io"),
        entityId,
        connector: "io" as const,
      }),
    ]);
  }
  return Object.freeze([]);
}

export function circuitEndpointBinding(
  entityId: number,
  kind: EntityKind,
  connector: CircuitConnector,
): CircuitEndpointBinding | null {
  return (
    circuitEndpointBindings(entityId, kind).find(
      (binding) => binding.connector === connector,
    ) ?? null
  );
}

export function defaultCircuitDeviceConfiguration(
  kind: CircuitEntityKind,
): CircuitDeviceConfiguration {
  const signalA = circuitSignal("virtual", "signal-A");
  if (kind === "constantCombinator") {
    return Object.freeze({
      kind: "constant" as const,
      signals: Object.freeze([]),
      enabled: true,
    });
  }
  if (kind === "arithmeticCombinator") {
    return Object.freeze({
      kind: "arithmetic" as const,
      left: circuitOperand(signalA),
      operator: "add" as const,
      right: circuitConstant(0),
      output: signalA,
    });
  }
  return Object.freeze({
    kind: "decider" as const,
    condition: Object.freeze({
      left: signalA,
      operator: ">" as const,
      right: circuitConstant(0),
    }),
    output: signalA,
    outputMode: "inputCount" as const,
  });
}

export function circuitDeviceDefinition(
  entityId: number,
  entityKind: CircuitEntityKind,
  configuration: CircuitDeviceConfiguration,
): CircuitDeviceDefinition | null {
  if (
    entityKind === "constantCombinator" &&
    configuration.kind === "constant"
  ) {
    return {
      kind: "constant",
      id: circuitDeviceId(entityId),
      outputEndpoint: circuitEndpointId(entityId, "output"),
      signals: configuration.signals,
      enabled: configuration.enabled,
    };
  }
  if (
    entityKind === "arithmeticCombinator" &&
    configuration.kind === "arithmetic"
  ) {
    return {
      kind: "arithmetic",
      id: circuitDeviceId(entityId),
      inputEndpoint: circuitEndpointId(entityId, "input"),
      outputEndpoint: circuitEndpointId(entityId, "output"),
      left: configuration.left,
      operator: configuration.operator,
      right: configuration.right,
      output: configuration.output,
    };
  }
  if (
    entityKind === "deciderCombinator" &&
    configuration.kind === "decider"
  ) {
    return {
      kind: "decider",
      id: circuitDeviceId(entityId),
      inputEndpoint: circuitEndpointId(entityId, "input"),
      outputEndpoint: circuitEndpointId(entityId, "output"),
      condition: configuration.condition,
      output: configuration.output,
      outputMode: configuration.outputMode,
    };
  }
  return null;
}

export function isValidCircuitMachineConfiguration(
  kind: EntityKind,
  configuration: CircuitMachinePortConfiguration,
): boolean {
  const capabilities = circuitMachineCapabilities(kind);
  if (!capabilities) return false;
  if (
    configuration.enableCondition !== undefined &&
    !capabilities.enable
  ) {
    return false;
  }
  if (
    configuration.powerSwitchCondition !== undefined &&
    !capabilities.powerSwitch
  ) {
    return false;
  }
  if (configuration.filter !== undefined) {
    if (!capabilities.filter) return false;
    if (
      configuration.filter.candidates?.some(
        (signal) =>
          signal.type !== "item" ||
          !ITEM_IDS.includes(signal.name as ItemId),
      )
    ) {
      return false;
    }
  }
  if (
    (configuration.sorterRoutes !== undefined ||
      configuration.sorterFallback !== undefined) &&
    !capabilities.sorter
  ) {
    return false;
  }
  if (
    configuration.sorterRoutes?.some(
      (route) =>
        route.output !== CIRCUIT_SORTER_OUTPUT_A &&
        route.output !== CIRCUIT_SORTER_OUTPUT_B,
    )
  ) {
    return false;
  }
  if (
    configuration.sorterFallback !== undefined &&
    configuration.sorterFallback !== CIRCUIT_SORTER_OUTPUT_A &&
    configuration.sorterFallback !== CIRCUIT_SORTER_OUTPUT_B
  ) {
    return false;
  }
  return true;
}

export function circuitMachinePortDefinition(
  entityId: number,
  kind: EntityKind,
  configuration: CircuitMachinePortConfiguration = {},
): CircuitMachinePortDefinition | null {
  if (!isValidCircuitMachineConfiguration(kind, configuration)) {
    return null;
  }
  const endpoint = circuitEndpointId(entityId, "io");
  return {
    id: circuitMachinePortId(entityId),
    inputEndpoint: endpoint,
    outputEndpoint: endpoint,
    ...configuration,
  };
}

export function circuitMachineConfigurationFromSerialized(
  port: SerializedCircuitNetwork["machinePorts"][number],
): CircuitMachinePortConfiguration {
  return Object.freeze({
    ...(port.enableCondition === null
      ? {}
      : { enableCondition: port.enableCondition }),
    ...(port.powerSwitchCondition === null
      ? {}
      : { powerSwitchCondition: port.powerSwitchCondition }),
    ...(port.filter === null
      ? {}
      : {
          filter: Object.freeze({
            ...(port.filter.candidates === null
              ? {}
              : { candidates: port.filter.candidates }),
            minimum: port.filter.minimum,
          }),
        }),
    ...(port.sorterRoutes.length === 0
      ? {}
      : { sorterRoutes: port.sorterRoutes }),
    ...(port.sorterFallback === null
      ? {}
      : { sorterFallback: port.sorterFallback }),
  });
}

function compareCircuitSignals(
  left: { readonly type: string; readonly name: string },
  right: { readonly type: string; readonly name: string },
): number {
  if (left.type !== right.type) {
    return left.type < right.type ? -1 : 1;
  }
  return left.name === right.name
    ? 0
    : left.name < right.name
      ? -1
      : 1;
}

/**
 * Machine controls are a pure projection of the kernel's persisted last
 * endpoint frames. The kernel intentionally serializes feedback state rather
 * than this cache, so integration restores the cache without advancing a tick.
 */
export function deriveCircuitMachineControls(
  serialized: SerializedCircuitNetwork,
): readonly CircuitMachineControl[] {
  if (serialized.tick === 0) return Object.freeze([]);
  const frames = new Map(
    serialized.state.lastEndpointFrames.map((entry) => [
      entry.endpointId,
      entry.signals,
    ]),
  );
  return Object.freeze(
    serialized.machinePorts.map((port) => {
      const input =
        frames.get(port.inputEndpoint) ?? Object.freeze([]);
      let filterSignal = null;
      if (port.filter !== null) {
        const candidates =
          port.filter.candidates === null
            ? null
            : new Set(
                port.filter.candidates.map(
                  (signal) => `${signal.type}\u0000${signal.name}`,
                ),
              );
        filterSignal =
          input
            .filter(
              (entry) =>
                entry.value >= port.filter!.minimum &&
                (candidates === null ||
                  candidates.has(
                    `${entry.signal.type}\u0000${entry.signal.name}`,
                  )),
            )
            .sort(
              (left, right) =>
                right.value - left.value ||
                compareCircuitSignals(left.signal, right.signal),
            )[0]?.signal ?? null;
      }

      let sorterOutput: string | null = null;
      for (const route of port.sorterRoutes) {
        if (evaluateCircuitCondition(input, route.condition)) {
          sorterOutput = route.output;
          break;
        }
      }
      sorterOutput ??= port.sorterFallback;
      return Object.freeze({
        portId: port.id,
        input,
        enabled:
          port.enableCondition === null ||
          evaluateCircuitCondition(input, port.enableCondition),
        powerSwitchClosed:
          port.powerSwitchCondition === null ||
          evaluateCircuitCondition(
            input,
            port.powerSwitchCondition,
          ),
        filterSignal,
        sorterOutput,
      });
    }),
  );
}

function pushInventorySignals(
  entries: CircuitSignalValue[],
  inventory: EntityState["inventory"],
): void {
  for (const itemId of ITEM_IDS) {
    const amount = inventory[itemId] ?? 0;
    if (amount > 0) {
      entries.push({
        signal: circuitSignal("item", itemId),
        value: amount,
      });
    }
  }
}

/**
 * Sensor values are exact integers. Fluid signals use authoritative
 * milli-units, while progress and power virtual signals use integer percent.
 */
export function circuitSensorFrame(entity: EntityState): CircuitFrame {
  const entries: CircuitSignalValue[] = [];
  pushInventorySignals(entries, entity.inventory);
  pushInventorySignals(entries, entity.input);
  pushInventorySignals(entries, entity.output);
  pushInventorySignals(entries, entity.reclaim);
  pushInventorySignals(entries, entity.fuel);
  for (const item of entity.beltItems) {
    entries.push({
      signal: circuitSignal("item", item.item),
      value: 1,
    });
  }
  if (entity.heldItem) {
    entries.push({
      signal: circuitSignal("item", entity.heldItem),
      value: 1,
    });
  }

  const fluidState = entity.fluidState;
  for (const box of [
    fluidState?.buffer,
    fluidState?.input,
    fluidState?.output,
  ]) {
    if (box?.fluidId && box.amountMilli > 0) {
      entries.push({
        signal: circuitSignal("fluid", box.fluidId),
        value: box.amountMilli,
      });
    }
  }

  entries.push(
    {
      signal: circuitSignal("virtual", "entity-id"),
      value: entity.id,
    },
    {
      signal: circuitSignal("virtual", "power-percent"),
      value: Math.round(entity.powerSatisfaction * 100),
    },
    {
      signal: circuitSignal("virtual", "progress-percent"),
      value: Math.round(entity.progress * 100),
    },
    {
      signal: circuitSignal("virtual", "working"),
      value:
        entity.status === "working" ||
        entity.status === "changingRecipe"
          ? 1
          : 0,
    },
  );
  if (entity.fuelEnergyKJ > 0) {
    entries.push({
      signal: circuitSignal("virtual", "fuel-energy-kj"),
      value: Math.floor(entity.fuelEnergyKJ),
    });
  }
  if (entity.generatedPowerKW > 0) {
    entries.push({
      signal: circuitSignal("virtual", "generated-kw"),
      value: Math.floor(entity.generatedPowerKW),
    });
  }
  return canonicalCircuitFrame(entries);
}

function directionVector(direction: Direction): GridPoint {
  switch (direction) {
    case Direction.North:
      return { x: 0, y: -1 };
    case Direction.East:
      return { x: 1, y: 0 };
    case Direction.South:
      return { x: 0, y: 1 };
    case Direction.West:
      return { x: -1, y: 0 };
  }
}

export function circuitEndpointPosition(
  entity: EntityState,
  connector: CircuitConnector,
): GridPoint {
  const center = {
    x: entity.x + entity.width / 2,
    y: entity.y + entity.height / 2,
  };
  if (connector === "io") return center;
  const forward = directionVector(entity.direction);
  const polarity = connector === "output" ? 0.38 : -0.38;
  return {
    x: center.x + forward.x * polarity,
    y: center.y + forward.y * polarity,
  };
}

export function isCircuitWireWithinReach(
  firstEntity: EntityState,
  _firstConnector: CircuitConnector,
  secondEntity: EntityState,
  _secondConnector: CircuitConnector,
): boolean {
  // Construction reach is measured between stable entity centers so rotating
  // a placed combinator cannot silently invalidate an existing wire.
  const first = {
    x: firstEntity.x + firstEntity.width / 2,
    y: firstEntity.y + firstEntity.height / 2,
  };
  const second = {
    x: secondEntity.x + secondEntity.width / 2,
    y: secondEntity.y + secondEntity.height / 2,
  };
  return (
    Math.hypot(first.x - second.x, first.y - second.y) <=
    CIRCUIT_WIRE_REACH_TILES
  );
}
