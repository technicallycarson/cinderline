import { FLUID_IDS, ITEM_IDS } from "./catalog";
import {
  canonicalCircuitFrame,
  type CircuitArithmeticOperator,
  type CircuitComparisonOperator,
  type CircuitCondition,
  type CircuitOperand,
  type CircuitSelector,
  type CircuitSignal,
  type CircuitSignalType,
  type CircuitWildcard,
} from "./circuit-network";
import {
  CIRCUIT_SORTER_OUTPUT_A,
  CIRCUIT_SORTER_OUTPUT_B,
  CIRCUIT_WIRE_REACH_TILES,
  circuitDeviceId,
  circuitEndpointId,
  circuitMachineCapabilities,
  circuitMachineConfigurationFromSerialized,
  circuitMachinePortId,
  isValidCircuitMachineConfiguration,
} from "./circuit-integration";
import type {
  CircuitConnectionPoint,
  CircuitDeviceConfiguration,
  CircuitEntityKind,
  CircuitMachinePortConfiguration,
  CircuitSimulationSnapshot,
  CircuitWireColor,
  EntityKind,
} from "./types";

export const CIRCUIT_ARITHMETIC_OPERATORS: readonly CircuitArithmeticOperator[] =
  [
    "add",
    "subtract",
    "multiply",
    "divide",
    "modulo",
    "power",
    "leftShift",
    "rightShift",
    "bitAnd",
    "bitOr",
    "bitXor",
  ] as const;

export const CIRCUIT_COMPARISON_OPERATORS: readonly CircuitComparisonOperator[] =
  ["<", "<=", "==", "!=", ">=", ">"] as const;

export const CIRCUIT_SELECTOR_SOURCES = [
  "signal",
  "each",
  "any",
  "every",
] as const;

export const CIRCUIT_OPERAND_SOURCES = [
  "constant",
  ...CIRCUIT_SELECTOR_SOURCES,
] as const;

export const CIRCUIT_VIRTUAL_SIGNAL_SUGGESTIONS = [
  "signal-A",
  "signal-B",
  "signal-C",
  "run",
  "go",
  "scaled",
  "enabled",
  "threshold",
] as const;

export const CIRCUIT_SIGNAL_CATALOG = Object.freeze({
  item: ITEM_IDS,
  fluid: FLUID_IDS,
  virtual: CIRCUIT_VIRTUAL_SIGNAL_SUGGESTIONS,
});

export type CircuitAuthoringResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export interface CircuitSignalDraft {
  readonly type: CircuitSignalType;
  readonly name: string;
}

export interface CircuitSelectorDraft extends CircuitSignalDraft {
  readonly source: (typeof CIRCUIT_SELECTOR_SOURCES)[number];
}

export interface CircuitOperandDraft extends CircuitSignalDraft {
  readonly source: (typeof CIRCUIT_OPERAND_SOURCES)[number];
  readonly value?: number | string;
}

export interface CircuitConditionDraft {
  readonly left: CircuitSelectorDraft;
  readonly operator: CircuitComparisonOperator;
  readonly right: CircuitOperandDraft;
}

export type CircuitDeviceDraft =
  | {
      readonly kind: "constant";
      readonly enabled: boolean;
      readonly signals: readonly (CircuitSignalDraft & {
        readonly value: number | string;
      })[];
    }
  | {
      readonly kind: "arithmetic";
      readonly left: CircuitOperandDraft;
      readonly operator: CircuitArithmeticOperator;
      readonly right: CircuitOperandDraft;
      readonly output: CircuitSelectorDraft;
    }
  | {
      readonly kind: "decider";
      readonly condition: CircuitConditionDraft;
      readonly output: CircuitSelectorDraft;
      readonly outputMode: "one" | "inputCount";
    };

export interface CircuitMachineDraft {
  readonly enableCondition?: CircuitConditionDraft;
  readonly powerSwitchCondition?: CircuitConditionDraft;
  readonly filter?: {
    readonly candidates?: readonly CircuitSignalDraft[];
    readonly minimum?: number | string;
  };
  readonly sorterRoutes?: readonly {
    readonly priority: number | string;
    readonly output: "A" | "B";
    readonly condition: CircuitConditionDraft;
  }[];
  readonly sorterFallback?: "A" | "B";
}

const SIGNAL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

function fail<T>(error: string): CircuitAuthoringResult<T> {
  return { ok: false, error };
}

function safeInteger(
  value: number | string | undefined,
  label: string,
): CircuitAuthoringResult<number> {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed)
    ? { ok: true, value: parsed }
    : fail(`${label} must be a whole number.`);
}

export function buildCircuitSignal(
  draft: CircuitSignalDraft,
): CircuitAuthoringResult<CircuitSignal> {
  if (
    !["item", "fluid", "virtual"].includes(draft.type) ||
    !SIGNAL_NAME_PATTERN.test(draft.name.trim())
  ) {
    return fail(
      "Choose a signal type and enter a canonical signal name (letters, numbers, dots, slashes, underscores, or hyphens).",
    );
  }
  const name = draft.name.trim();
  if (
    draft.type === "item" &&
    !ITEM_IDS.includes(name as (typeof ITEM_IDS)[number])
  ) {
    return fail("Item signals must use an item from the factory catalog.");
  }
  if (
    draft.type === "fluid" &&
    !FLUID_IDS.includes(name as (typeof FLUID_IDS)[number])
  ) {
    return fail("Fluid signals must use a fluid from the factory catalog.");
  }
  return {
    ok: true,
    value: Object.freeze({ type: draft.type, name }),
  };
}

export function buildCircuitSelector(
  draft: CircuitSelectorDraft,
  options: {
    readonly allowEach?: boolean;
    readonly allowAggregate?: boolean;
  } = {},
): CircuitAuthoringResult<CircuitSelector> {
  if (draft.source === "signal") return buildCircuitSignal(draft);
  if (draft.source === "each" && options.allowEach === false) {
    return fail("The Each wildcard is unavailable in this field.");
  }
  if (
    (draft.source === "any" || draft.source === "every") &&
    options.allowAggregate === false
  ) {
    return fail("Any and Every are unavailable in this field.");
  }
  if (!CIRCUIT_SELECTOR_SOURCES.includes(draft.source)) {
    return fail("Choose a valid signal selector.");
  }
  return {
    ok: true,
    value: Object.freeze({ wildcard: draft.source as CircuitWildcard }),
  };
}

export function buildCircuitOperand(
  draft: CircuitOperandDraft,
  options: {
    readonly allowEach?: boolean;
    readonly allowAggregate?: boolean;
  } = {},
): CircuitAuthoringResult<CircuitOperand> {
  if (draft.source === "constant") {
    const value = safeInteger(draft.value, "Constant");
    return value.ok
      ? {
          ok: true,
          value: Object.freeze({
            kind: "constant" as const,
            value: value.value,
          }),
        }
      : value;
  }
  const selector = buildCircuitSelector(
    draft as CircuitSelectorDraft,
    options,
  );
  return selector.ok
    ? {
        ok: true,
        value: Object.freeze({
          kind: "signal" as const,
          selector: selector.value,
        }),
      }
    : selector;
}

export function buildCircuitCondition(
  draft: CircuitConditionDraft,
): CircuitAuthoringResult<CircuitCondition> {
  if (!CIRCUIT_COMPARISON_OPERATORS.includes(draft.operator)) {
    return fail("Choose a valid comparison operator.");
  }
  const left = buildCircuitSelector(draft.left);
  if (!left.ok) return left;
  const right = buildCircuitOperand(draft.right, {
    allowEach: false,
    allowAggregate: false,
  });
  if (!right.ok) return right;
  return {
    ok: true,
    value: Object.freeze({
      left: left.value,
      operator: draft.operator,
      right: right.value,
    }),
  };
}

export function buildCircuitDeviceConfiguration(
  entityKind: CircuitEntityKind,
  draft: CircuitDeviceDraft,
): CircuitAuthoringResult<CircuitDeviceConfiguration> {
  const expectedKind =
    entityKind === "constantCombinator"
      ? "constant"
      : entityKind === "arithmeticCombinator"
        ? "arithmetic"
        : "decider";
  if (draft.kind !== expectedKind) {
    return fail("This program does not match the selected combinator.");
  }

  if (draft.kind === "constant") {
    const entries = [];
    for (const [index, entry] of draft.signals.entries()) {
      const signal = buildCircuitSignal(entry);
      if (!signal.ok) return fail(`Signal ${index + 1}: ${signal.error}`);
      const value = safeInteger(entry.value, `Signal ${index + 1} value`);
      if (!value.ok) return value;
      entries.push({ signal: signal.value, value: value.value });
    }
    try {
      return {
        ok: true,
        value: Object.freeze({
          kind: "constant" as const,
          signals: canonicalCircuitFrame(entries),
          enabled: draft.enabled,
        }),
      };
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : "Invalid constant frame.",
      );
    }
  }

  if (draft.kind === "arithmetic") {
    if (!CIRCUIT_ARITHMETIC_OPERATORS.includes(draft.operator)) {
      return fail("Choose a valid arithmetic operator.");
    }
    const left = buildCircuitOperand(draft.left, {
      allowAggregate: false,
    });
    if (!left.ok) return left;
    const right = buildCircuitOperand(draft.right, {
      allowAggregate: false,
    });
    if (!right.ok) return right;
    const output = buildCircuitSelector(draft.output, {
      allowAggregate: false,
    });
    if (!output.ok) return output;
    if (
      "wildcard" in output.value &&
      !(
        (left.value.kind === "signal" &&
          "wildcard" in left.value.selector &&
          left.value.selector.wildcard === "each") ||
        (right.value.kind === "signal" &&
          "wildcard" in right.value.selector &&
          right.value.selector.wildcard === "each")
      )
    ) {
      return fail("Each output requires an Each input operand.");
    }
    return {
      ok: true,
      value: Object.freeze({
        kind: "arithmetic" as const,
        left: left.value,
        operator: draft.operator,
        right: right.value,
        output: output.value as
          | CircuitSignal
          | { readonly wildcard: "each" },
      }),
    };
  }

  const condition = buildCircuitCondition(draft.condition);
  if (!condition.ok) return condition;
  const output = buildCircuitSelector(draft.output, {
    allowAggregate: false,
  });
  if (!output.ok) return output;
  return {
    ok: true,
    value: Object.freeze({
      kind: "decider" as const,
      condition: condition.value,
      output: output.value as
        | CircuitSignal
        | { readonly wildcard: "each" },
      outputMode: draft.outputMode,
    }),
  };
}

export function buildCircuitMachineConfiguration(
  entityKind: EntityKind,
  draft: CircuitMachineDraft,
): CircuitAuthoringResult<CircuitMachinePortConfiguration> {
  const capabilities = circuitMachineCapabilities(entityKind);
  if (!capabilities) return fail("This unit has no circuit machine port.");
  if (draft.enableCondition && !capabilities.enable) {
    return fail("This unit does not support an enable condition.");
  }
  if (draft.powerSwitchCondition && !capabilities.powerSwitch) {
    return fail("This unit does not support a circuit power switch.");
  }
  if (draft.filter && !capabilities.filter) {
    return fail("This unit does not support a circuit item filter.");
  }
  if (
    (draft.sorterRoutes || draft.sorterFallback) &&
    !capabilities.sorter
  ) {
    return fail("This unit does not support circuit sorter routes.");
  }

  const enableCondition = draft.enableCondition
    ? buildCircuitCondition(draft.enableCondition)
    : undefined;
  if (enableCondition && !enableCondition.ok) return enableCondition;
  const powerSwitchCondition = draft.powerSwitchCondition
    ? buildCircuitCondition(draft.powerSwitchCondition)
    : undefined;
  if (powerSwitchCondition && !powerSwitchCondition.ok) {
    return powerSwitchCondition;
  }

  let filter: CircuitMachinePortConfiguration["filter"];
  if (draft.filter) {
    const minimum = safeInteger(draft.filter.minimum ?? 1, "Filter minimum");
    if (!minimum.ok) return minimum;
    const candidates: CircuitSignal[] = [];
    for (const candidate of draft.filter.candidates ?? []) {
      const signal = buildCircuitSignal(candidate);
      if (!signal.ok) return signal;
      if (signal.value.type !== "item") {
        return fail("Machine filter candidates must be item signals.");
      }
      if (
        candidates.some(
          (existing) =>
            existing.type === signal.value.type &&
            existing.name === signal.value.name,
        )
      ) {
        continue;
      }
      candidates.push(signal.value);
    }
    candidates.sort(
      (left, right) =>
        left.type.localeCompare(right.type) ||
        left.name.localeCompare(right.name),
    );
    filter = Object.freeze({
      ...(candidates.length > 0
        ? { candidates: Object.freeze(candidates) }
        : {}),
      minimum: minimum.value,
    });
  }

  let sorterRoutes: CircuitMachinePortConfiguration["sorterRoutes"];
  if (draft.sorterRoutes) {
    const routes = [];
    const priorities = new Set<number>();
    for (const [index, route] of draft.sorterRoutes.entries()) {
      const priority = safeInteger(route.priority, `Route ${index + 1} priority`);
      if (!priority.ok) return priority;
      if (priorities.has(priority.value)) {
        return fail("Sorter route priorities must be unique.");
      }
      priorities.add(priority.value);
      const condition = buildCircuitCondition(route.condition);
      if (!condition.ok) return condition;
      routes.push(
        Object.freeze({
          priority: priority.value,
          output: route.output,
          condition: condition.value,
        }),
      );
    }
    routes.sort(
      (left, right) =>
        left.priority - right.priority ||
        left.output.localeCompare(right.output),
    );
    sorterRoutes = Object.freeze(routes);
  }

  const configuration: CircuitMachinePortConfiguration = Object.freeze({
    ...(enableCondition?.ok
      ? { enableCondition: enableCondition.value }
      : {}),
    ...(powerSwitchCondition?.ok
      ? { powerSwitchCondition: powerSwitchCondition.value }
      : {}),
    ...(filter ? { filter } : {}),
    ...(sorterRoutes && sorterRoutes.length > 0 ? { sorterRoutes } : {}),
    ...(draft.sorterFallback
      ? { sorterFallback: draft.sorterFallback }
      : {}),
  });
  return isValidCircuitMachineConfiguration(entityKind, configuration)
    ? { ok: true, value: configuration }
    : fail("The selected unit rejected this circuit configuration.");
}

export function circuitDeviceConfigurationFromSnapshot(
  snapshot: CircuitSimulationSnapshot,
  entityId: number,
): CircuitDeviceConfiguration | null {
  const device = snapshot.devices.find(
    (candidate) => candidate.id === circuitDeviceId(entityId),
  );
  if (!device) return null;
  if (device.kind === "constant") {
    return {
      kind: "constant",
      signals: device.signals,
      enabled: device.enabled,
    };
  }
  if (device.kind === "arithmetic") {
    return {
      kind: "arithmetic",
      left: device.left,
      operator: device.operator,
      right: device.right,
      output: device.output,
    };
  }
  return {
    kind: "decider",
    condition: device.condition,
    output: device.output,
    outputMode: device.outputMode,
  };
}

export function circuitMachineConfigurationFromSnapshot(
  snapshot: CircuitSimulationSnapshot,
  entityId: number,
): CircuitMachinePortConfiguration | null {
  const port = snapshot.machinePorts.find(
    (candidate) => candidate.id === circuitMachinePortId(entityId),
  );
  return port ? circuitMachineConfigurationFromSerialized(port) : null;
}

export function circuitConfigurationKey(
  configuration:
    | CircuitDeviceConfiguration
    | CircuitMachinePortConfiguration,
): string {
  return JSON.stringify(configuration);
}

export function circuitPointForEndpoint(
  snapshot: CircuitSimulationSnapshot,
  endpointId: string,
): CircuitConnectionPoint | null {
  const endpoint = snapshot.endpoints.find(
    (candidate) => candidate.endpointId === endpointId,
  );
  return endpoint
    ? { entityId: endpoint.entityId, connector: endpoint.connector }
    : null;
}

export type CircuitWirePreflightReason =
  | "invalid-endpoint"
  | "same-endpoint"
  | "duplicate"
  | "out-of-reach";

export type CircuitWirePreflight =
  | {
      readonly ok: true;
      readonly endpointA: string;
      readonly endpointB: string;
    }
  | {
      readonly ok: false;
      readonly reason: CircuitWirePreflightReason;
    };

export function preflightCircuitWire(
  snapshot: CircuitSimulationSnapshot,
  color: CircuitWireColor,
  first: CircuitConnectionPoint,
  second: CircuitConnectionPoint,
  centerForEntity: (
    entityId: number,
  ) => { readonly x: number; readonly y: number } | null,
): CircuitWirePreflight {
  const endpointA = circuitEndpointId(first.entityId, first.connector);
  const endpointB = circuitEndpointId(second.entityId, second.connector);
  const known = new Set(
    snapshot.endpoints.map((endpoint) => endpoint.endpointId),
  );
  if (!known.has(endpointA) || !known.has(endpointB)) {
    return { ok: false, reason: "invalid-endpoint" };
  }
  if (endpointA === endpointB) {
    return { ok: false, reason: "same-endpoint" };
  }
  if (
    snapshot.wires.some(
      (wire) =>
        wire.color === color &&
        ((wire.endpointA === endpointA && wire.endpointB === endpointB) ||
          (wire.endpointA === endpointB && wire.endpointB === endpointA)),
    )
  ) {
    return { ok: false, reason: "duplicate" };
  }
  const firstCenter = centerForEntity(first.entityId);
  const secondCenter = centerForEntity(second.entityId);
  if (
    !firstCenter ||
    !secondCenter ||
    Math.hypot(
      firstCenter.x - secondCenter.x,
      firstCenter.y - secondCenter.y,
    ) > CIRCUIT_WIRE_REACH_TILES
  ) {
    return { ok: false, reason: "out-of-reach" };
  }
  return { ok: true, endpointA, endpointB };
}

export function circuitSorterOutputLabel(value: string | undefined): string {
  return value === CIRCUIT_SORTER_OUTPUT_A
    ? "Port A"
    : value === CIRCUIT_SORTER_OUTPUT_B
      ? "Port B"
      : "No fallback";
}

/**
 * Commits a boolean-returning authoritative mutation into snapshot history.
 * A rejected or throwing mutation leaves both history stacks byte-for-byte
 * unchanged; only an accepted mutation invalidates redo.
 */
export function commitCircuitHistory<T>(
  history: {
    readonly undo: T[];
    readonly redo: T[];
  },
  snapshot: () => T,
  mutation: () => boolean,
  limit = 20,
): boolean {
  const before = snapshot();
  let accepted = false;
  try {
    accepted = mutation();
  } catch {
    return false;
  }
  if (!accepted) return false;
  history.redo.length = 0;
  history.undo.push(before);
  if (history.undo.length > limit) history.undo.shift();
  return true;
}
