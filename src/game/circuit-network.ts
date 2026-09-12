/**
 * Deterministic, fixed-tick circuit/signal network kernel.
 *
 * This module deliberately does not import the simulation, entity catalog, or
 * renderer. Integrators provide stable endpoint/device IDs and machine sensor
 * frames. Wire colors remain electrically isolated: an endpoint can read the
 * sum of all color-components touching it, but it never repeats a signal from
 * one color onto another. A combinator or machine output is the only bridge,
 * and every output becomes visible on the following tick.
 */

export const CIRCUIT_NETWORK_FORMAT = "cinderline-circuit-network";
export const CIRCUIT_NETWORK_VERSION = 1;

export const CIRCUIT_SIGNAL_TYPES = [
  "item",
  "fluid",
  "virtual",
] as const;

export type CircuitSignalType = (typeof CIRCUIT_SIGNAL_TYPES)[number];
export type CircuitWildcard = "each" | "any" | "every";

export interface CircuitSignal {
  readonly type: CircuitSignalType;
  readonly name: string;
}

export interface CircuitWildcardSelector {
  readonly wildcard: CircuitWildcard;
}

export type CircuitSelector = CircuitSignal | CircuitWildcardSelector;

export interface CircuitSignalValue {
  readonly signal: CircuitSignal;
  readonly value: number;
}

export type CircuitFrame = readonly CircuitSignalValue[];

export interface CircuitConstantOperand {
  readonly kind: "constant";
  readonly value: number;
}

export interface CircuitSignalOperand {
  readonly kind: "signal";
  readonly selector: CircuitSelector;
}

export type CircuitOperand =
  | CircuitConstantOperand
  | CircuitSignalOperand;

export type CircuitArithmeticOperator =
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "modulo"
  | "power"
  | "leftShift"
  | "rightShift"
  | "bitAnd"
  | "bitOr"
  | "bitXor";

export type CircuitComparisonOperator =
  | "<"
  | "<="
  | "=="
  | "!="
  | ">="
  | ">";

export interface CircuitCondition {
  /**
   * `any` is existential and false for an empty frame; `every` is universal
   * and true for an empty frame; `each` evaluates per signal in a decider and
   * is existential when used as a machine enable/sorter condition.
   */
  readonly left: CircuitSelector;
  readonly operator: CircuitComparisonOperator;
  readonly right: CircuitOperand;
}

export interface CircuitConstantDevice {
  readonly kind: "constant";
  readonly id: string;
  readonly outputEndpoint: string;
  readonly signals: CircuitFrame;
  readonly enabled?: boolean;
}

export interface CircuitArithmeticDevice {
  readonly kind: "arithmetic";
  readonly id: string;
  readonly inputEndpoint: string;
  readonly outputEndpoint: string;
  readonly left: CircuitOperand;
  readonly operator: CircuitArithmeticOperator;
  readonly right: CircuitOperand;
  readonly output: CircuitSignal | { readonly wildcard: "each" };
}

export interface CircuitDeciderDevice {
  readonly kind: "decider";
  readonly id: string;
  readonly inputEndpoint: string;
  readonly outputEndpoint: string;
  readonly condition: CircuitCondition;
  readonly output: CircuitSignal | { readonly wildcard: "each" };
  readonly outputMode: "one" | "inputCount";
}

export type CircuitDeviceDefinition =
  | CircuitConstantDevice
  | CircuitArithmeticDevice
  | CircuitDeciderDevice;

export interface CircuitMachineFilter {
  /**
   * If omitted, every non-zero input signal is eligible. The greatest value
   * wins; equal values use canonical type/name ordering.
   */
  readonly candidates?: readonly CircuitSignal[];
  readonly minimum?: number;
}

export interface CircuitSorterRoute {
  /** Explicit priority makes configuration-array insertion order irrelevant. */
  readonly priority: number;
  readonly output: string;
  readonly condition: CircuitCondition;
}

export interface CircuitMachinePortDefinition {
  readonly id: string;
  readonly inputEndpoint: string;
  /** A missing output endpoint makes this a read-only control port. */
  readonly outputEndpoint?: string;
  readonly enableCondition?: CircuitCondition;
  readonly powerSwitchCondition?: CircuitCondition;
  readonly filter?: CircuitMachineFilter;
  readonly sorterRoutes?: readonly CircuitSorterRoute[];
  readonly sorterFallback?: string;
}

export interface CircuitMachineWrite {
  readonly portId: string;
  readonly signals: CircuitFrame;
}

export interface CircuitMachineControl {
  readonly portId: string;
  readonly input: CircuitFrame;
  readonly enabled: boolean;
  readonly powerSwitchClosed: boolean;
  readonly filterSignal: CircuitSignal | null;
  readonly sorterOutput: string | null;
}

export interface CircuitWire {
  readonly color: string;
  readonly endpointA: string;
  readonly endpointB: string;
}

export interface CircuitComponent {
  /** Stable across insertion history: `${color}@${lowest endpoint ID}`. */
  readonly id: string;
  readonly color: string;
  readonly endpoints: readonly string[];
}

export interface CircuitTopology {
  readonly components: readonly CircuitComponent[];
  readonly wires: readonly CircuitWire[];
  readonly endpointComponents: readonly {
    readonly endpointId: string;
    readonly componentIds: readonly string[];
  }[];
}

export interface CircuitComponentFrame {
  readonly componentId: string;
  readonly signals: CircuitFrame;
}

export interface CircuitEndpointFrame {
  readonly endpointId: string;
  readonly signals: CircuitFrame;
}

export interface CircuitStepResult {
  /** Tick whose inputs were just read. The network tick is this value + 1. */
  readonly tick: number;
  readonly topology: CircuitTopology;
  readonly componentFrames: readonly CircuitComponentFrame[];
  readonly endpointFrames: readonly CircuitEndpointFrame[];
  readonly machineControls: readonly CircuitMachineControl[];
  readonly workUnits: number;
}

export interface CircuitNetworkLimits {
  readonly maxEndpoints: number;
  readonly maxWires: number;
  readonly maxDevices: number;
  readonly maxMachinePorts: number;
  readonly maxSignalsPerFrame: number;
  readonly maxSignalVisitsPerTick: number;
}

export interface CircuitNetworkOptions {
  readonly limits?: Partial<CircuitNetworkLimits>;
}

interface NormalizedConstantDevice {
  readonly kind: "constant";
  readonly id: string;
  readonly outputEndpoint: string;
  readonly signals: CircuitFrame;
  readonly enabled: boolean;
}

interface NormalizedArithmeticDevice {
  readonly kind: "arithmetic";
  readonly id: string;
  readonly inputEndpoint: string;
  readonly outputEndpoint: string;
  readonly left: CircuitOperand;
  readonly operator: CircuitArithmeticOperator;
  readonly right: CircuitOperand;
  readonly output: CircuitSignal | { readonly wildcard: "each" };
}

interface NormalizedDeciderDevice {
  readonly kind: "decider";
  readonly id: string;
  readonly inputEndpoint: string;
  readonly outputEndpoint: string;
  readonly condition: CircuitCondition;
  readonly output: CircuitSignal | { readonly wildcard: "each" };
  readonly outputMode: "one" | "inputCount";
}

type NormalizedDevice =
  | NormalizedConstantDevice
  | NormalizedArithmeticDevice
  | NormalizedDeciderDevice;

interface NormalizedMachineFilter {
  readonly candidates: readonly CircuitSignal[] | null;
  readonly minimum: number;
}

interface NormalizedSorterRoute {
  readonly priority: number;
  readonly output: string;
  readonly condition: CircuitCondition;
}

interface NormalizedMachinePort {
  readonly id: string;
  readonly inputEndpoint: string;
  readonly outputEndpoint: string | null;
  readonly enableCondition: CircuitCondition | null;
  readonly powerSwitchCondition: CircuitCondition | null;
  readonly filter: NormalizedMachineFilter | null;
  readonly sorterRoutes: readonly NormalizedSorterRoute[];
  readonly sorterFallback: string | null;
}

interface ActiveOutput {
  readonly sourceId: string;
  readonly endpointId: string;
  readonly signals: CircuitFrame;
}

interface InternalTopology {
  readonly publicValue: CircuitTopology;
  readonly endpointComponentIds: ReadonlyMap<string, readonly string[]>;
}

export interface SerializedCircuitNetwork {
  readonly format: typeof CIRCUIT_NETWORK_FORMAT;
  readonly version: typeof CIRCUIT_NETWORK_VERSION;
  readonly limits: CircuitNetworkLimits;
  readonly tick: number;
  readonly endpoints: readonly string[];
  readonly wires: readonly CircuitWire[];
  readonly devices: readonly NormalizedDevice[];
  readonly machinePorts: readonly NormalizedMachinePort[];
  readonly state: {
    readonly activeOutputs: readonly ActiveOutput[];
    readonly lastEndpointFrames: readonly CircuitEndpointFrame[];
  };
}

const DEFAULT_LIMITS: CircuitNetworkLimits = Object.freeze({
  maxEndpoints: 4_096,
  maxWires: 8_192,
  maxDevices: 2_048,
  maxMachinePorts: 2_048,
  maxSignalsPerFrame: 256,
  maxSignalVisitsPerTick: 2_000_000,
});

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,95}$/;
const SIGNAL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;
const COLOR_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const OUTPUT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;
const ARITHMETIC_OPERATORS: readonly CircuitArithmeticOperator[] = [
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
];
const COMPARISON_OPERATORS: readonly CircuitComparisonOperator[] = [
  "<",
  "<=",
  "==",
  "!=",
  ">=",
  ">",
];
const WILDCARDS: readonly CircuitWildcard[] = [
  "each",
  "any",
  "every",
];

export class CircuitValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CircuitValidationError";
  }
}

export class CircuitCapacityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CircuitCapacityError";
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSignal(left: CircuitSignal, right: CircuitSignal): number {
  return (
    compareText(left.type, right.type) ||
    compareText(left.name, right.name)
  );
}

function signalKey(value: CircuitSignal): string {
  const prefix =
    value.type === "item" ? "i" : value.type === "fluid" ? "f" : "v";
  return `${prefix}:${value.name}`;
}

function freezeSignal(value: CircuitSignal): CircuitSignal {
  return Object.freeze({ type: value.type, name: value.name });
}

function freezeWildcard(
  wildcard: CircuitWildcard,
): CircuitWildcardSelector {
  return Object.freeze({ wildcard });
}

function assertSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new CircuitValidationError(`${label} must be a safe integer`);
  }
  return value as number;
}

function assertIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new CircuitValidationError(`${label} is not a canonical ID`);
  }
  return value;
}

function assertColor(value: unknown): string {
  if (typeof value !== "string" || !COLOR_PATTERN.test(value)) {
    throw new CircuitValidationError("wire color is not canonical");
  }
  return value;
}

function assertOutputName(value: unknown, label: string): string {
  if (typeof value !== "string" || !OUTPUT_PATTERN.test(value)) {
    throw new CircuitValidationError(`${label} is not canonical`);
  }
  return value;
}

function normalizeSignal(value: CircuitSignal): CircuitSignal {
  if (
    !value ||
    typeof value !== "object" ||
    !CIRCUIT_SIGNAL_TYPES.includes(value.type) ||
    typeof value.name !== "string" ||
    !SIGNAL_NAME_PATTERN.test(value.name)
  ) {
    throw new CircuitValidationError("invalid circuit signal");
  }
  return freezeSignal(value);
}

function normalizeSelector(value: CircuitSelector): CircuitSelector {
  if (
    value &&
    typeof value === "object" &&
    "wildcard" in value
  ) {
    if (!WILDCARDS.includes(value.wildcard)) {
      throw new CircuitValidationError("invalid circuit wildcard");
    }
    return freezeWildcard(value.wildcard);
  }
  return normalizeSignal(value as CircuitSignal);
}

function isWildcard(
  value: CircuitSelector | CircuitSignal | { readonly wildcard: "each" },
): value is CircuitWildcardSelector {
  return "wildcard" in value;
}

function normalizeOperand(value: CircuitOperand): CircuitOperand {
  if (!value || typeof value !== "object") {
    throw new CircuitValidationError("invalid circuit operand");
  }
  if (value.kind === "constant") {
    return Object.freeze({
      kind: "constant" as const,
      value: assertSafeInteger(value.value, "operand constant"),
    });
  }
  if (value.kind === "signal") {
    return Object.freeze({
      kind: "signal" as const,
      selector: normalizeSelector(value.selector),
    });
  }
  throw new CircuitValidationError("invalid circuit operand kind");
}

function normalizeCondition(value: CircuitCondition): CircuitCondition {
  if (
    !value ||
    typeof value !== "object" ||
    !COMPARISON_OPERATORS.includes(value.operator)
  ) {
    throw new CircuitValidationError("invalid circuit condition");
  }
  const left = normalizeSelector(value.left);
  const right = normalizeOperand(value.right);
  if (
    right.kind === "signal" &&
    isWildcard(right.selector)
  ) {
    throw new CircuitValidationError(
      "condition right operand must be concrete",
    );
  }
  return Object.freeze({
    left,
    operator: value.operator,
    right,
  });
}

function clampBigInt(value: bigint): number {
  if (value > MAX_SAFE_BIGINT) return Number.MAX_SAFE_INTEGER;
  if (value < MIN_SAFE_BIGINT) return Number.MIN_SAFE_INTEGER;
  return Number(value);
}

function frameFromBigInts(
  values: ReadonlyMap<string, { signal: CircuitSignal; value: bigint }>,
  maxSignals: number,
): CircuitFrame {
  const entries = [...values.values()]
    .filter((entry) => entry.value !== 0n)
    .sort((left, right) => compareSignal(left.signal, right.signal));
  if (entries.length > maxSignals) {
    throw new CircuitCapacityError(
      `frame has ${entries.length} signals; limit is ${maxSignals}`,
    );
  }
  return Object.freeze(
    entries.map((entry) =>
      Object.freeze({
        signal: freezeSignal(entry.signal),
        value: clampBigInt(entry.value),
      })
    ),
  );
}

/**
 * Canonicalizes a frame by summing duplicate typed signals exactly with
 * BigInt, saturating only once after the sum. Zero signals are omitted.
 */
export function canonicalCircuitFrame(
  entries: readonly CircuitSignalValue[],
  maxSignals = DEFAULT_LIMITS.maxSignalsPerFrame,
): CircuitFrame {
  if (!Array.isArray(entries)) {
    throw new CircuitValidationError("circuit frame must be an array");
  }
  assertSafeInteger(maxSignals, "maximum frame signal count");
  if (maxSignals < 1) {
    throw new CircuitValidationError(
      "maximum frame signal count must be positive",
    );
  }
  if (entries.length > maxSignals) {
    throw new CircuitCapacityError(
      `frame has ${entries.length} entries; limit is ${maxSignals}`,
    );
  }
  const values = new Map<
    string,
    { signal: CircuitSignal; value: bigint }
  >();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      throw new CircuitValidationError("invalid circuit frame entry");
    }
    const signal = normalizeSignal(entry.signal);
    const value = assertSafeInteger(entry.value, "signal value");
    const key = signalKey(signal);
    const prior = values.get(key);
    values.set(key, {
      signal,
      value: (prior?.value ?? 0n) + BigInt(value),
    });
  }
  return frameFromBigInts(values, maxSignals);
}

function frameMap(frame: CircuitFrame): ReadonlyMap<string, number> {
  return new Map(frame.map((entry) => [signalKey(entry.signal), entry.value]));
}

export function circuitSignalValue(
  frame: CircuitFrame,
  signal: CircuitSignal,
): number {
  const key = signalKey(normalizeSignal(signal));
  for (const entry of frame) {
    if (signalKey(entry.signal) === key) return entry.value;
  }
  return 0;
}

export function circuitSignal(
  type: CircuitSignalType,
  name: string,
): CircuitSignal {
  return normalizeSignal({ type, name });
}

export function circuitWildcard(
  wildcard: CircuitWildcard,
): CircuitWildcardSelector {
  return normalizeSelector({ wildcard }) as CircuitWildcardSelector;
}

export function circuitConstant(value: number): CircuitConstantOperand {
  return normalizeOperand({
    kind: "constant",
    value,
  }) as CircuitConstantOperand;
}

export function circuitOperand(
  selector: CircuitSelector,
): CircuitSignalOperand {
  return normalizeOperand({
    kind: "signal",
    selector,
  }) as CircuitSignalOperand;
}

function operandValue(
  operand: CircuitOperand,
  values: ReadonlyMap<string, number>,
  eachSignal?: CircuitSignal,
): number {
  if (operand.kind === "constant") return operand.value;
  if (isWildcard(operand.selector)) {
    if (operand.selector.wildcard !== "each" || !eachSignal) {
      throw new CircuitValidationError(
        "wildcard operand has no per-signal context",
      );
    }
    return values.get(signalKey(eachSignal)) ?? 0;
  }
  return values.get(signalKey(operand.selector)) ?? 0;
}

function arithmeticPower(left: bigint, right: bigint): bigint {
  if (right < 0n) {
    if (left === 1n) return 1n;
    if (left === -1n) return (-right & 1n) === 0n ? 1n : -1n;
    return 0n;
  }
  if (right === 0n) return 1n;
  if (left === 0n || left === 1n) return left;
  if (left === -1n) return (right & 1n) === 0n ? 1n : -1n;
  if (right > 53n) {
    return left < 0n && (right & 1n) === 1n
      ? MIN_SAFE_BIGINT
      : MAX_SAFE_BIGINT;
  }
  let base = left;
  let exponent = right;
  let result = 1n;
  while (exponent > 0n) {
    if ((exponent & 1n) === 1n) {
      result *= base;
      if (result > MAX_SAFE_BIGINT) return MAX_SAFE_BIGINT;
      if (result < MIN_SAFE_BIGINT) return MIN_SAFE_BIGINT;
    }
    exponent >>= 1n;
    if (exponent > 0n) {
      base *= base;
      if (base > MAX_SAFE_BIGINT) base = MAX_SAFE_BIGINT;
      if (base < MIN_SAFE_BIGINT) base = MIN_SAFE_BIGINT;
    }
  }
  return result;
}

function arithmeticShift(
  left: bigint,
  right: bigint,
  direction: "left" | "right",
): bigint {
  if (right < 0n) {
    return arithmeticShift(
      left,
      -right,
      direction === "left" ? "right" : "left",
    );
  }
  if (direction === "right") {
    if (right >= 54n) return left < 0n ? -1n : 0n;
    return left >> right;
  }
  if (left === 0n) return 0n;
  if (right >= 54n) {
    return left < 0n ? MIN_SAFE_BIGINT : MAX_SAFE_BIGINT;
  }
  const shifted = left << right;
  if (shifted > MAX_SAFE_BIGINT) return MAX_SAFE_BIGINT;
  if (shifted < MIN_SAFE_BIGINT) return MIN_SAFE_BIGINT;
  return shifted;
}

/**
 * Integer arithmetic is exact before a final safe-integer saturation.
 * Division truncates toward zero; divide/modulo by zero return zero. Shifts
 * are signed BigInt shifts, negative counts reverse direction, and excessive
 * left shifts saturate.
 */
export function applyCircuitArithmetic(
  operator: CircuitArithmeticOperator,
  left: number,
  right: number,
): number {
  assertSafeInteger(left, "left arithmetic value");
  assertSafeInteger(right, "right arithmetic value");
  if (!ARITHMETIC_OPERATORS.includes(operator)) {
    throw new CircuitValidationError("invalid arithmetic operator");
  }
  const a = BigInt(left);
  const b = BigInt(right);
  let result: bigint;
  switch (operator) {
    case "add":
      result = a + b;
      break;
    case "subtract":
      result = a - b;
      break;
    case "multiply":
      result = a * b;
      break;
    case "divide":
      result = b === 0n ? 0n : a / b;
      break;
    case "modulo":
      result = b === 0n ? 0n : a % b;
      break;
    case "power":
      result = arithmeticPower(a, b);
      break;
    case "leftShift":
      result = arithmeticShift(a, b, "left");
      break;
    case "rightShift":
      result = arithmeticShift(a, b, "right");
      break;
    case "bitAnd":
      result = a & b;
      break;
    case "bitOr":
      result = a | b;
      break;
    case "bitXor":
      result = a ^ b;
      break;
  }
  return clampBigInt(result);
}

export function applyCircuitComparison(
  operator: CircuitComparisonOperator,
  left: number,
  right: number,
): boolean {
  assertSafeInteger(left, "left comparison value");
  assertSafeInteger(right, "right comparison value");
  switch (operator) {
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case ">=":
      return left >= right;
    case ">":
      return left > right;
    default:
      throw new CircuitValidationError("invalid comparison operator");
  }
}

function conditionMatchingEntries(
  frame: CircuitFrame,
  condition: CircuitCondition,
): {
  readonly result: boolean;
  readonly matching: CircuitFrame;
} {
  const values = frameMap(frame);
  const right = operandValue(condition.right, values);
  if (!isWildcard(condition.left)) {
    const value = values.get(signalKey(condition.left)) ?? 0;
    const result = applyCircuitComparison(
      condition.operator,
      value,
      right,
    );
    const matching =
      result && value !== 0
        ? canonicalCircuitFrame(
            [{ signal: condition.left, value }],
            Math.max(1, frame.length),
          )
        : Object.freeze([]);
    return { result, matching };
  }

  const matching = frame.filter((entry) =>
    applyCircuitComparison(condition.operator, entry.value, right)
  );
  if (condition.left.wildcard === "each") {
    return {
      result: matching.length > 0,
      matching: Object.freeze([...matching]),
    };
  }
  if (condition.left.wildcard === "any") {
    return {
      result: matching.length > 0,
      matching: Object.freeze([...matching]),
    };
  }
  // Mathematical universal quantification: `every` over an empty frame is
  // true. Its matching set is the whole frame only when the predicate holds.
  const result = matching.length === frame.length;
  return {
    result,
    matching: result ? Object.freeze([...frame]) : Object.freeze([]),
  };
}

export function evaluateCircuitCondition(
  frame: CircuitFrame,
  condition: CircuitCondition,
): boolean {
  const canonical = canonicalCircuitFrame(
    frame,
    Math.max(1, frame.length),
  );
  return conditionMatchingEntries(
    canonical,
    normalizeCondition(condition),
  ).result;
}

function normalizeArithmeticOutput(
  output: CircuitArithmeticDevice["output"],
): CircuitSignal | { readonly wildcard: "each" } {
  if (
    output &&
    typeof output === "object" &&
    "wildcard" in output
  ) {
    if (output.wildcard !== "each") {
      throw new CircuitValidationError(
        "arithmetic output wildcard must be each",
      );
    }
    return Object.freeze({ wildcard: "each" as const });
  }
  return normalizeSignal(output as CircuitSignal);
}

function normalizeDeciderOutput(
  output: CircuitDeciderDevice["output"],
): CircuitSignal | { readonly wildcard: "each" } {
  return normalizeArithmeticOutput(output);
}

function operandUsesEach(operand: CircuitOperand): boolean {
  return (
    operand.kind === "signal" &&
    isWildcard(operand.selector) &&
    operand.selector.wildcard === "each"
  );
}

function operandUsesAggregateWildcard(operand: CircuitOperand): boolean {
  return (
    operand.kind === "signal" &&
    isWildcard(operand.selector) &&
    operand.selector.wildcard !== "each"
  );
}

function evaluateArithmeticDevice(
  frame: CircuitFrame,
  device: NormalizedArithmeticDevice,
  maxSignals: number,
): CircuitFrame {
  const values = frameMap(frame);
  const usesEach =
    operandUsesEach(device.left) || operandUsesEach(device.right);
  if (!usesEach) {
    const value = applyCircuitArithmetic(
      device.operator,
      operandValue(device.left, values),
      operandValue(device.right, values),
    );
    if (isWildcard(device.output)) {
      throw new CircuitValidationError(
        "each output requires an each arithmetic operand",
      );
    }
    return canonicalCircuitFrame(
      [{ signal: device.output, value }],
      maxSignals,
    );
  }

  const outputValues = new Map<
    string,
    { signal: CircuitSignal; value: bigint }
  >();
  for (const entry of frame) {
    const value = applyCircuitArithmetic(
      device.operator,
      operandValue(device.left, values, entry.signal),
      operandValue(device.right, values, entry.signal),
    );
    const outputSignal = isWildcard(device.output)
      ? entry.signal
      : device.output;
    const key = signalKey(outputSignal);
    const prior = outputValues.get(key);
    outputValues.set(key, {
      signal: outputSignal,
      value: (prior?.value ?? 0n) + BigInt(value),
    });
  }
  return frameFromBigInts(outputValues, maxSignals);
}

function deciderFixedCount(
  device: NormalizedDeciderDevice,
  matching: CircuitFrame,
): number {
  if (device.outputMode === "one") return 1;
  if (!isWildcard(device.condition.left)) {
    return matching[0]?.value ?? 0;
  }
  let sum = 0n;
  for (const entry of matching) sum += BigInt(entry.value);
  return clampBigInt(sum);
}

function evaluateDeciderDevice(
  frame: CircuitFrame,
  device: NormalizedDeciderDevice,
  maxSignals: number,
): CircuitFrame {
  const evaluation = conditionMatchingEntries(frame, device.condition);
  if (isWildcard(device.condition.left) &&
      device.condition.left.wildcard === "each") {
    if (isWildcard(device.output)) {
      return canonicalCircuitFrame(
        evaluation.matching.map((entry) => ({
          signal: entry.signal,
          value:
            device.outputMode === "inputCount" ? entry.value : 1,
        })),
        maxSignals,
      );
    }
    return canonicalCircuitFrame(
      [{
        signal: device.output,
        value: deciderFixedCount(device, evaluation.matching),
      }],
      maxSignals,
    );
  }

  if (!evaluation.result) return Object.freeze([]);
  if (isWildcard(device.output)) {
    return canonicalCircuitFrame(
      frame.map((entry) => ({
        signal: entry.signal,
        value:
          device.outputMode === "inputCount" ? entry.value : 1,
      })),
      maxSignals,
    );
  }
  return canonicalCircuitFrame(
    [{
      signal: device.output,
      value: deciderFixedCount(device, evaluation.matching),
    }],
    maxSignals,
  );
}

function normalizeDevice(
  value: CircuitDeviceDefinition,
  maxSignals: number,
): NormalizedDevice {
  if (!value || typeof value !== "object") {
    throw new CircuitValidationError("invalid circuit device");
  }
  const id = assertIdentifier(value.id, "device ID");
  if (value.kind === "constant") {
    if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
      throw new CircuitValidationError(
        "constant enabled flag must be boolean",
      );
    }
    return Object.freeze({
      kind: "constant" as const,
      id,
      outputEndpoint: assertIdentifier(
        value.outputEndpoint,
        "constant output endpoint",
      ),
      signals: canonicalCircuitFrame(value.signals, maxSignals),
      enabled: value.enabled ?? true,
    });
  }
  if (value.kind === "arithmetic") {
    if (!ARITHMETIC_OPERATORS.includes(value.operator)) {
      throw new CircuitValidationError("invalid arithmetic operator");
    }
    const left = normalizeOperand(value.left);
    const right = normalizeOperand(value.right);
    if (
      operandUsesAggregateWildcard(left) ||
      operandUsesAggregateWildcard(right)
    ) {
      throw new CircuitValidationError(
        "arithmetic operands support only the each wildcard",
      );
    }
    const output = normalizeArithmeticOutput(value.output);
    if (
      isWildcard(output) &&
      !operandUsesEach(left) &&
      !operandUsesEach(right)
    ) {
      throw new CircuitValidationError(
        "each output requires an each arithmetic operand",
      );
    }
    return Object.freeze({
      kind: "arithmetic" as const,
      id,
      inputEndpoint: assertIdentifier(
        value.inputEndpoint,
        "arithmetic input endpoint",
      ),
      outputEndpoint: assertIdentifier(
        value.outputEndpoint,
        "arithmetic output endpoint",
      ),
      left,
      operator: value.operator,
      right,
      output,
    });
  }
  if (value.kind === "decider") {
    return Object.freeze({
      kind: "decider" as const,
      id,
      inputEndpoint: assertIdentifier(
        value.inputEndpoint,
        "decider input endpoint",
      ),
      outputEndpoint: assertIdentifier(
        value.outputEndpoint,
        "decider output endpoint",
      ),
      condition: normalizeCondition(value.condition),
      output: normalizeDeciderOutput(value.output),
      outputMode:
        value.outputMode === "one" ||
        value.outputMode === "inputCount"
          ? value.outputMode
          : (() => {
              throw new CircuitValidationError(
                "invalid decider output mode",
              );
            })(),
    });
  }
  throw new CircuitValidationError("invalid circuit device kind");
}

function normalizeMachinePort(
  value: CircuitMachinePortDefinition,
  maxSignals = DEFAULT_LIMITS.maxSignalsPerFrame,
): NormalizedMachinePort {
  if (!value || typeof value !== "object") {
    throw new CircuitValidationError("invalid machine port");
  }
  let filter: NormalizedMachineFilter | null = null;
  if (value.filter) {
    const minimum = assertSafeInteger(
      value.filter.minimum ?? 1,
      "filter minimum",
    );
    const candidates = value.filter.candidates
      ? [...value.filter.candidates]
          .map(normalizeSignal)
          .sort(compareSignal)
      : null;
    if (candidates && candidates.length > maxSignals) {
      throw new CircuitCapacityError(
        "machine filter candidate capacity exceeded",
      );
    }
    if (
      candidates &&
      candidates.some(
        (candidate, index) =>
          index > 0 &&
          compareSignal(candidates[index - 1]!, candidate) === 0,
      )
    ) {
      throw new CircuitValidationError(
        "filter candidates must be unique",
      );
    }
    filter = Object.freeze({
      candidates: candidates ? Object.freeze(candidates) : null,
      minimum,
    });
  }

  if ((value.sorterRoutes?.length ?? 0) > maxSignals) {
    throw new CircuitCapacityError(
      "machine sorter-route capacity exceeded",
    );
  }
  const sorterRoutes = [...(value.sorterRoutes ?? [])]
    .map((route) => {
      const priority = assertSafeInteger(
        route.priority,
        "sorter route priority",
      );
      return Object.freeze({
        priority,
        output: assertOutputName(route.output, "sorter output"),
        condition: normalizeCondition(route.condition),
      });
    })
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        compareText(left.output, right.output),
    );
  if (
    sorterRoutes.some(
      (route, index) =>
        index > 0 &&
        route.priority === sorterRoutes[index - 1]!.priority,
    )
  ) {
    throw new CircuitValidationError(
      "sorter route priorities must be unique",
    );
  }

  return Object.freeze({
    id: assertIdentifier(value.id, "machine port ID"),
    inputEndpoint: assertIdentifier(
      value.inputEndpoint,
      "machine input endpoint",
    ),
    outputEndpoint:
      value.outputEndpoint === undefined
        ? null
        : assertIdentifier(
            value.outputEndpoint,
            "machine output endpoint",
          ),
    enableCondition: value.enableCondition
      ? normalizeCondition(value.enableCondition)
      : null,
    powerSwitchCondition: value.powerSwitchCondition
      ? normalizeCondition(value.powerSwitchCondition)
      : null,
    filter,
    sorterRoutes: Object.freeze(sorterRoutes),
    sorterFallback:
      value.sorterFallback === undefined
        ? null
        : assertOutputName(value.sorterFallback, "sorter fallback"),
  });
}

function machineControl(
  port: NormalizedMachinePort,
  frame: CircuitFrame,
): CircuitMachineControl {
  let filterSignal: CircuitSignal | null = null;
  if (port.filter) {
    const allowed = port.filter.candidates
      ? new Set(port.filter.candidates.map(signalKey))
      : null;
    const eligible = frame
      .filter(
        (entry) =>
          entry.value >= port.filter!.minimum &&
          (!allowed || allowed.has(signalKey(entry.signal))),
      )
      .sort(
        (left, right) =>
          right.value - left.value ||
          compareSignal(left.signal, right.signal),
      );
    filterSignal = eligible[0]?.signal ?? null;
  }

  let sorterOutput: string | null = null;
  for (const route of port.sorterRoutes) {
    if (conditionMatchingEntries(frame, route.condition).result) {
      sorterOutput = route.output;
      break;
    }
  }
  if (sorterOutput === null) sorterOutput = port.sorterFallback;

  return Object.freeze({
    portId: port.id,
    input: frame,
    enabled: port.enableCondition
      ? conditionMatchingEntries(frame, port.enableCondition).result
      : true,
    powerSwitchClosed: port.powerSwitchCondition
      ? conditionMatchingEntries(
          frame,
          port.powerSwitchCondition,
        ).result
      : true,
    filterSignal: filterSignal ? freezeSignal(filterSignal) : null,
    sorterOutput,
  });
}

function normalizeLimits(
  options: CircuitNetworkOptions = {},
): CircuitNetworkLimits {
  const supplied = options.limits ?? {};
  const result: CircuitNetworkLimits = {
    maxEndpoints:
      supplied.maxEndpoints ?? DEFAULT_LIMITS.maxEndpoints,
    maxWires: supplied.maxWires ?? DEFAULT_LIMITS.maxWires,
    maxDevices: supplied.maxDevices ?? DEFAULT_LIMITS.maxDevices,
    maxMachinePorts:
      supplied.maxMachinePorts ?? DEFAULT_LIMITS.maxMachinePorts,
    maxSignalsPerFrame:
      supplied.maxSignalsPerFrame ??
      DEFAULT_LIMITS.maxSignalsPerFrame,
    maxSignalVisitsPerTick:
      supplied.maxSignalVisitsPerTick ??
      DEFAULT_LIMITS.maxSignalVisitsPerTick,
  };
  for (const [key, value] of Object.entries(result)) {
    assertSafeInteger(value, key);
    if (value < 1 || value > 10_000_000) {
      throw new CircuitValidationError(
        `${key} must be between 1 and 10000000`,
      );
    }
  }
  return Object.freeze(result);
}

function wireKey(wire: CircuitWire): string {
  return `${wire.color}\u0000${wire.endpointA}\u0000${wire.endpointB}`;
}

function canonicalWire(
  color: string,
  endpointA: string,
  endpointB: string,
): CircuitWire {
  const normalizedColor = assertColor(color);
  const a = assertIdentifier(endpointA, "wire endpoint");
  const b = assertIdentifier(endpointB, "wire endpoint");
  if (a === b) {
    throw new CircuitValidationError(
      "a wire cannot connect an endpoint to itself",
    );
  }
  return Object.freeze({
    color: normalizedColor,
    endpointA: compareText(a, b) < 0 ? a : b,
    endpointB: compareText(a, b) < 0 ? b : a,
  });
}

function compareWire(left: CircuitWire, right: CircuitWire): number {
  return (
    compareText(left.color, right.color) ||
    compareText(left.endpointA, right.endpointA) ||
    compareText(left.endpointB, right.endpointB)
  );
}

class DisjointSet {
  readonly #parent = new Map<string, string>();

  public add(value: string): void {
    if (!this.#parent.has(value)) this.#parent.set(value, value);
  }

  public find(value: string): string {
    const parent = this.#parent.get(value);
    if (parent === undefined) {
      throw new CircuitValidationError("unknown disjoint-set endpoint");
    }
    if (parent === value) return value;
    const root = this.find(parent);
    this.#parent.set(value, root);
    return root;
  }

  public union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    if (compareText(leftRoot, rightRoot) < 0) {
      this.#parent.set(rightRoot, leftRoot);
    } else {
      this.#parent.set(leftRoot, rightRoot);
    }
  }
}

function freezeTopology(
  components: CircuitComponent[],
  wires: CircuitWire[],
  endpointComponentIds: Map<string, string[]>,
): InternalTopology {
  const frozenComponents = Object.freeze(
    components.map((component) =>
      Object.freeze({
        id: component.id,
        color: component.color,
        endpoints: Object.freeze([...component.endpoints]),
      })
    ),
  );
  const frozenWires = Object.freeze([...wires]);
  const endpointComponents = Object.freeze(
    [...endpointComponentIds]
      .sort((left, right) => compareText(left[0], right[0]))
      .map(([endpointId, componentIds]) =>
        Object.freeze({
          endpointId,
          componentIds: Object.freeze([...componentIds].sort(compareText)),
        })
      ),
  );
  return {
    publicValue: Object.freeze({
      components: frozenComponents,
      wires: frozenWires,
      endpointComponents,
    }),
    endpointComponentIds: new Map(
      endpointComponents.map((entry) => [
        entry.endpointId,
        entry.componentIds,
      ]),
    ),
  };
}

function cloneOutput(output: ActiveOutput): ActiveOutput {
  return Object.freeze({
    sourceId: output.sourceId,
    endpointId: output.endpointId,
    signals: output.signals,
  });
}

function componentId(color: string, firstEndpoint: string): string {
  return `${color}@${firstEndpoint}`;
}

function sourceIdForDevice(id: string): string {
  return `device:${id}`;
}

function sourceIdForMachine(id: string): string {
  return `machine:${id}`;
}

/**
 * Mutable topology/configuration with deterministic, atomic fixed ticks.
 * Public snapshots and frames never expose the module's Maps.
 */
export class CircuitNetwork {
  readonly #limits: CircuitNetworkLimits;
  readonly #endpoints = new Set<string>();
  readonly #wires = new Map<string, CircuitWire>();
  readonly #devices = new Map<string, NormalizedDevice>();
  readonly #machinePorts = new Map<string, NormalizedMachinePort>();
  #activeOutputs = new Map<string, ActiveOutput>();
  #lastEndpointFrames = new Map<string, CircuitFrame>();
  #lastMachineControls = new Map<string, CircuitMachineControl>();
  #topologyCache: InternalTopology | null = null;
  #tick = 0;

  public constructor(options: CircuitNetworkOptions = {}) {
    this.#limits = normalizeLimits(options);
  }

  public get tickCount(): number {
    return this.#tick;
  }

  public get limits(): CircuitNetworkLimits {
    return this.#limits;
  }

  public addEndpoint(endpointId: string): void {
    const id = assertIdentifier(endpointId, "endpoint ID");
    if (this.#endpoints.has(id)) {
      throw new CircuitValidationError(`duplicate endpoint ${id}`);
    }
    if (this.#endpoints.size >= this.#limits.maxEndpoints) {
      throw new CircuitCapacityError("endpoint capacity exceeded");
    }
    this.#endpoints.add(id);
    this.#topologyCache = null;
  }

  public removeEndpoint(endpointId: string): void {
    const id = assertIdentifier(endpointId, "endpoint ID");
    if (!this.#endpoints.has(id)) {
      throw new CircuitValidationError(`unknown endpoint ${id}`);
    }
    for (const device of this.#devices.values()) {
      if (
        device.outputEndpoint === id ||
        (device.kind !== "constant" && device.inputEndpoint === id)
      ) {
        throw new CircuitValidationError(
          `endpoint ${id} is used by device ${device.id}`,
        );
      }
    }
    for (const port of this.#machinePorts.values()) {
      if (
        port.inputEndpoint === id ||
        port.outputEndpoint === id
      ) {
        throw new CircuitValidationError(
          `endpoint ${id} is used by machine port ${port.id}`,
        );
      }
    }
    for (const [key, wire] of this.#wires) {
      if (wire.endpointA === id || wire.endpointB === id) {
        this.#wires.delete(key);
      }
    }
    this.#endpoints.delete(id);
    this.#lastEndpointFrames.delete(id);
    this.#topologyCache = null;
  }

  public connect(
    color: string,
    endpointA: string,
    endpointB: string,
  ): boolean {
    const wire = canonicalWire(color, endpointA, endpointB);
    if (
      !this.#endpoints.has(wire.endpointA) ||
      !this.#endpoints.has(wire.endpointB)
    ) {
      throw new CircuitValidationError(
        "both wire endpoints must be registered",
      );
    }
    const key = wireKey(wire);
    if (this.#wires.has(key)) return false;
    if (this.#wires.size >= this.#limits.maxWires) {
      throw new CircuitCapacityError("wire capacity exceeded");
    }
    this.#wires.set(key, wire);
    this.#topologyCache = null;
    return true;
  }

  public disconnect(
    color: string,
    endpointA: string,
    endpointB: string,
  ): boolean {
    const wire = canonicalWire(color, endpointA, endpointB);
    const deleted = this.#wires.delete(wireKey(wire));
    if (deleted) this.#topologyCache = null;
    return deleted;
  }

  public registerDevice(definition: CircuitDeviceDefinition): void {
    const device = normalizeDevice(
      definition,
      this.#limits.maxSignalsPerFrame,
    );
    if (
      this.#devices.has(device.id) ||
      this.#machinePorts.has(device.id)
    ) {
      throw new CircuitValidationError(
        `duplicate circuit participant ${device.id}`,
      );
    }
    if (this.#devices.size >= this.#limits.maxDevices) {
      throw new CircuitCapacityError("device capacity exceeded");
    }
    if (
      !this.#endpoints.has(device.outputEndpoint) ||
      (device.kind !== "constant" &&
        !this.#endpoints.has(device.inputEndpoint))
    ) {
      throw new CircuitValidationError(
        `device ${device.id} references an unknown endpoint`,
      );
    }
    this.#devices.set(device.id, device);
  }

  public removeDevice(deviceId: string): void {
    const id = assertIdentifier(deviceId, "device ID");
    if (!this.#devices.delete(id)) {
      throw new CircuitValidationError(`unknown device ${id}`);
    }
    this.#activeOutputs.delete(sourceIdForDevice(id));
  }

  public registerMachinePort(
    definition: CircuitMachinePortDefinition,
  ): void {
    const port = normalizeMachinePort(
      definition,
      this.#limits.maxSignalsPerFrame,
    );
    if (
      this.#machinePorts.has(port.id) ||
      this.#devices.has(port.id)
    ) {
      throw new CircuitValidationError(
        `duplicate circuit participant ${port.id}`,
      );
    }
    if (
      this.#machinePorts.size >= this.#limits.maxMachinePorts
    ) {
      throw new CircuitCapacityError("machine-port capacity exceeded");
    }
    if (
      !this.#endpoints.has(port.inputEndpoint) ||
      (port.outputEndpoint !== null &&
        !this.#endpoints.has(port.outputEndpoint))
    ) {
      throw new CircuitValidationError(
        `machine port ${port.id} references an unknown endpoint`,
      );
    }
    this.#machinePorts.set(port.id, port);
  }

  public removeMachinePort(portId: string): void {
    const id = assertIdentifier(portId, "machine port ID");
    if (!this.#machinePorts.delete(id)) {
      throw new CircuitValidationError(`unknown machine port ${id}`);
    }
    this.#activeOutputs.delete(sourceIdForMachine(id));
    this.#lastMachineControls.delete(id);
  }

  public topology(): CircuitTopology {
    return this.#internalTopology().publicValue;
  }

  #internalTopology(): InternalTopology {
    if (this.#topologyCache) return this.#topologyCache;
    const wires = [...this.#wires.values()].sort(compareWire);
    const byColor = new Map<string, CircuitWire[]>();
    for (const wire of wires) {
      const colorWires = byColor.get(wire.color) ?? [];
      colorWires.push(wire);
      byColor.set(wire.color, colorWires);
    }
    const components: CircuitComponent[] = [];
    const endpointComponentIds = new Map<string, string[]>();
    for (const color of [...byColor.keys()].sort(compareText)) {
      const colorWires = byColor.get(color)!;
      const set = new DisjointSet();
      for (const wire of colorWires) {
        set.add(wire.endpointA);
        set.add(wire.endpointB);
      }
      for (const wire of colorWires) {
        set.union(wire.endpointA, wire.endpointB);
      }
      const groups = new Map<string, string[]>();
      const colorEndpoints = new Set<string>();
      for (const wire of colorWires) {
        colorEndpoints.add(wire.endpointA);
        colorEndpoints.add(wire.endpointB);
      }
      for (const endpoint of [...colorEndpoints].sort(compareText)) {
        const root = set.find(endpoint);
        const group = groups.get(root) ?? [];
        group.push(endpoint);
        groups.set(root, group);
      }
      for (const endpoints of [...groups.values()].map((group) =>
        group.sort(compareText)
      ).sort((left, right) => compareText(left[0]!, right[0]!))) {
        const id = componentId(color, endpoints[0]!);
        components.push({
          id,
          color,
          endpoints,
        });
        for (const endpoint of endpoints) {
          const ids = endpointComponentIds.get(endpoint) ?? [];
          ids.push(id);
          endpointComponentIds.set(endpoint, ids);
        }
      }
    }
    components.sort(
      (left, right) =>
        compareText(left.color, right.color) ||
        compareText(left.endpoints[0]!, right.endpoints[0]!),
    );
    this.#topologyCache = freezeTopology(
      components,
      wires,
      endpointComponentIds,
    );
    return this.#topologyCache;
  }

  public readEndpoint(endpointId: string): CircuitFrame {
    const id = assertIdentifier(endpointId, "endpoint ID");
    if (!this.#endpoints.has(id)) {
      throw new CircuitValidationError(`unknown endpoint ${id}`);
    }
    return this.#lastEndpointFrames.get(id) ?? Object.freeze([]);
  }

  public getMachineControl(
    portId: string,
  ): CircuitMachineControl | null {
    const id = assertIdentifier(portId, "machine port ID");
    if (!this.#machinePorts.has(id)) {
      throw new CircuitValidationError(`unknown machine port ${id}`);
    }
    return this.#lastMachineControls.get(id) ?? null;
  }

  public step(
    machineWrites: readonly CircuitMachineWrite[] = [],
  ): CircuitStepResult {
    // A writable machine port publishes exactly the frame supplied for this
    // step. Omitting that port publishes an empty frame, so stale sensor
    // readings can never latch accidentally.
    if (!Array.isArray(machineWrites)) {
      throw new CircuitValidationError(
        "machine writes must be an array",
      );
    }
    if (machineWrites.length > this.#limits.maxMachinePorts) {
      throw new CircuitCapacityError(
        "machine-write capacity exceeded",
      );
    }
    const normalizedWrites = new Map<string, CircuitFrame>();
    for (const write of machineWrites) {
      if (!write || typeof write !== "object") {
        throw new CircuitValidationError("invalid machine write");
      }
      const portId = assertIdentifier(
        write.portId,
        "machine write port ID",
      );
      const port = this.#machinePorts.get(portId);
      if (!port || port.outputEndpoint === null) {
        throw new CircuitValidationError(
          `machine port ${portId} is not writable`,
        );
      }
      if (normalizedWrites.has(portId)) {
        throw new CircuitValidationError(
          `duplicate machine write ${portId}`,
        );
      }
      normalizedWrites.set(
        portId,
        canonicalCircuitFrame(
          write.signals,
          this.#limits.maxSignalsPerFrame,
        ),
      );
    }

    const topology = this.#internalTopology();
    let workUnits =
      this.#endpoints.size +
      this.#wires.size +
      this.#devices.size +
      this.#machinePorts.size;
    const consumeWork = (amount: number): void => {
      workUnits += amount;
      if (workUnits > this.#limits.maxSignalVisitsPerTick) {
        throw new CircuitCapacityError(
          "per-tick circuit work budget exceeded",
        );
      }
    };

    const componentAccumulators = new Map<
      string,
      Map<string, { signal: CircuitSignal; value: bigint }>
    >();
    for (const component of topology.publicValue.components) {
      componentAccumulators.set(component.id, new Map());
    }
    for (const output of [...this.#activeOutputs.values()].sort(
      (left, right) => compareText(left.sourceId, right.sourceId),
    )) {
      const componentIds =
        topology.endpointComponentIds.get(output.endpointId) ?? [];
      consumeWork(output.signals.length * componentIds.length);
      for (const id of componentIds) {
        const accumulator = componentAccumulators.get(id)!;
        for (const entry of output.signals) {
          const key = signalKey(entry.signal);
          const prior = accumulator.get(key);
          accumulator.set(key, {
            signal: entry.signal,
            value: (prior?.value ?? 0n) + BigInt(entry.value),
          });
        }
      }
    }

    const componentFrames = new Map<string, CircuitFrame>();
    for (const component of topology.publicValue.components) {
      componentFrames.set(
        component.id,
        frameFromBigInts(
          componentAccumulators.get(component.id)!,
          this.#limits.maxSignalsPerFrame,
        ),
      );
    }

    const endpointFrames = new Map<string, CircuitFrame>();
    for (const endpointId of [...this.#endpoints].sort(compareText)) {
      const ids =
        topology.endpointComponentIds.get(endpointId) ?? [];
      const accumulator = new Map<
        string,
        { signal: CircuitSignal; value: bigint }
      >();
      for (const id of ids) {
        const frame = componentFrames.get(id)!;
        consumeWork(frame.length);
        for (const entry of frame) {
          const key = signalKey(entry.signal);
          const prior = accumulator.get(key);
          accumulator.set(key, {
            signal: entry.signal,
            value: (prior?.value ?? 0n) + BigInt(entry.value),
          });
        }
      }
      const frame = frameFromBigInts(
        accumulator,
        this.#limits.maxSignalsPerFrame,
      );
      if (frame.length > 0) endpointFrames.set(endpointId, frame);
    }

    const nextOutputs = new Map<string, ActiveOutput>();
    for (const device of [...this.#devices.values()].sort(
      (left, right) => compareText(left.id, right.id),
    )) {
      let signals: CircuitFrame;
      if (device.kind === "constant") {
        signals = device.enabled
          ? device.signals
          : Object.freeze([]);
      } else {
        const input =
          endpointFrames.get(device.inputEndpoint) ??
          Object.freeze([]);
        consumeWork(input.length);
        signals =
          device.kind === "arithmetic"
            ? evaluateArithmeticDevice(
                input,
                device,
                this.#limits.maxSignalsPerFrame,
              )
            : evaluateDeciderDevice(
                input,
                device,
                this.#limits.maxSignalsPerFrame,
              );
      }
      const sourceId = sourceIdForDevice(device.id);
      nextOutputs.set(
        sourceId,
        cloneOutput({
          sourceId,
          endpointId: device.outputEndpoint,
          signals,
        }),
      );
    }

    const controls = new Map<string, CircuitMachineControl>();
    for (const port of [...this.#machinePorts.values()].sort(
      (left, right) => compareText(left.id, right.id),
    )) {
      const input =
        endpointFrames.get(port.inputEndpoint) ?? Object.freeze([]);
      consumeWork(
        input.length *
          (1 + port.sorterRoutes.length),
      );
      controls.set(port.id, machineControl(port, input));
      if (port.outputEndpoint !== null) {
        const sourceId = sourceIdForMachine(port.id);
        nextOutputs.set(
          sourceId,
          cloneOutput({
            sourceId,
            endpointId: port.outputEndpoint,
            signals:
              normalizedWrites.get(port.id) ?? Object.freeze([]),
          }),
        );
      }
    }

    // Commit only after topology, evaluation, and the work-budget gate all
    // succeed. A rejected step cannot partially advance feedback state.
    const completedTick = this.#tick;
    this.#activeOutputs = nextOutputs;
    this.#lastEndpointFrames = endpointFrames;
    this.#lastMachineControls = controls;
    this.#tick += 1;

    return Object.freeze({
      tick: completedTick,
      topology: topology.publicValue,
      componentFrames: Object.freeze(
        [...componentFrames]
          .sort((left, right) => compareText(left[0], right[0]))
          .map(([componentId, signals]) =>
            Object.freeze({ componentId, signals })
          ),
      ),
      endpointFrames: Object.freeze(
        [...endpointFrames]
          .sort((left, right) => compareText(left[0], right[0]))
          .map(([endpointId, signals]) =>
            Object.freeze({ endpointId, signals })
          ),
      ),
      machineControls: Object.freeze([...controls.values()]),
      workUnits,
    });
  }

  public serialize(): SerializedCircuitNetwork {
    const devices = [...this.#devices.values()].sort(
      (left, right) => compareText(left.id, right.id),
    );
    const machinePorts = [...this.#machinePorts.values()].sort(
      (left, right) => compareText(left.id, right.id),
    );
    return deepFreeze({
      format: CIRCUIT_NETWORK_FORMAT,
      version: CIRCUIT_NETWORK_VERSION,
      limits: {
        maxEndpoints: this.#limits.maxEndpoints,
        maxWires: this.#limits.maxWires,
        maxDevices: this.#limits.maxDevices,
        maxMachinePorts: this.#limits.maxMachinePorts,
        maxSignalsPerFrame: this.#limits.maxSignalsPerFrame,
        maxSignalVisitsPerTick:
          this.#limits.maxSignalVisitsPerTick,
      },
      tick: this.#tick,
      endpoints: [...this.#endpoints].sort(compareText),
      wires: [...this.#wires.values()].sort(compareWire),
      devices,
      machinePorts,
      state: {
        activeOutputs: [...this.#activeOutputs.values()]
          .sort((left, right) =>
            compareText(left.sourceId, right.sourceId)
          )
          .map(cloneOutput),
        lastEndpointFrames: [...this.#lastEndpointFrames]
          .sort((left, right) => compareText(left[0], right[0]))
          .map(([endpointId, signals]) => ({
            endpointId,
            signals,
          })),
      },
    }) as SerializedCircuitNetwork;
  }

  public canonicalString(): string {
    return JSON.stringify(this.serialize());
  }

  public canonicalBytes(): Uint8Array {
    return new TextEncoder().encode(this.canonicalString());
  }

  public static restore(value: unknown): CircuitNetwork {
    return restoreCircuitNetwork(value);
  }

  /** @internal Used only after hostile-save validation has completed. */
  public static _restoreValidated(
    value: SerializedCircuitNetwork,
  ): CircuitNetwork {
    const network = new CircuitNetwork({ limits: value.limits });
    for (const endpoint of value.endpoints) network.addEndpoint(endpoint);
    for (const wire of value.wires) {
      network.connect(
        wire.color,
        wire.endpointA,
        wire.endpointB,
      );
    }
    for (const device of value.devices) {
      network.registerDevice(device);
    }
    for (const port of value.machinePorts) {
      network.registerMachinePort({
        id: port.id,
        inputEndpoint: port.inputEndpoint,
        ...(port.outputEndpoint === null
          ? {}
          : { outputEndpoint: port.outputEndpoint }),
        ...(port.enableCondition === null
          ? {}
          : { enableCondition: port.enableCondition }),
        ...(port.powerSwitchCondition === null
          ? {}
          : { powerSwitchCondition: port.powerSwitchCondition }),
        ...(port.filter === null
          ? {}
          : {
              filter: {
                ...(port.filter.candidates === null
                  ? {}
                  : { candidates: port.filter.candidates }),
                minimum: port.filter.minimum,
              },
            }),
        sorterRoutes: port.sorterRoutes,
        ...(port.sorterFallback === null
          ? {}
          : { sorterFallback: port.sorterFallback }),
      });
    }
    network.#tick = value.tick;
    network.#activeOutputs = new Map(
      value.state.activeOutputs.map((output) => [
        output.sourceId,
        cloneOutput(output),
      ]),
    );
    network.#lastEndpointFrames = new Map(
      value.state.lastEndpointFrames.map((entry) => [
        entry.endpointId,
        entry.signals,
      ]),
    );
    network.#lastMachineControls = new Map(
      [...network.#machinePorts.values()]
        .sort((left, right) => compareText(left.id, right.id))
        .map((port) => {
          const frame =
            network.#lastEndpointFrames.get(port.inputEndpoint) ??
            Object.freeze([]);
          return [port.id, machineControl(port, frame)] as const;
        }),
    );
    return network;
  }
}

function deepFreeze<T>(value: T): T {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.isFrozen(value)
  ) {
    return value;
  }
  for (const key of Reflect.ownKeys(value as object)) {
    const descriptor = Object.getOwnPropertyDescriptor(
      value as object,
      key,
    );
    if (descriptor && "value" in descriptor) {
      deepFreeze(descriptor.value);
    }
  }
  return Object.freeze(value);
}

type DataRecord = Record<string, unknown>;

function strictDataRecord(
  value: unknown,
  exactKeys: readonly string[],
): DataRecord | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return null;
  }
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (
    keys.length !== exactKeys.length ||
    keys.some((key) => typeof key !== "string") ||
    exactKeys.some((key) => !keys.includes(key))
  ) {
    return null;
  }
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return null;
    }
    if (
      !descriptor ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      return null;
    }
  }
  return value as DataRecord;
}

function dataValue(record: DataRecord, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)!.value;
}

function strictDataArray(
  value: unknown,
  maxLength = 10_000_000,
): readonly unknown[] | null {
  if (!Array.isArray(value)) return null;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(
      value,
      "length",
    );
    if (!lengthDescriptor || !("value" in lengthDescriptor)) return null;
    const length = lengthDescriptor.value as number;
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > maxLength
    ) {
      return null;
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || !keys.includes("length")) {
      return null;
    }
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(
        value,
        String(index),
      );
      if (
        !descriptor ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        return null;
      }
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return null;
  }
}

function strictString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new CircuitValidationError(`${label} must be a string`);
  }
  return value;
}

function strictSignal(value: unknown): CircuitSignal {
  const record = strictDataRecord(value, ["type", "name"]);
  if (!record) {
    throw new CircuitValidationError("signal must be plain data");
  }
  return normalizeSignal({
    type: dataValue(record, "type") as CircuitSignalType,
    name: strictString(dataValue(record, "name"), "signal name"),
  });
}

function strictSelector(value: unknown): CircuitSelector {
  const wildcard = strictDataRecord(value, ["wildcard"]);
  if (wildcard) {
    return normalizeSelector({
      wildcard: dataValue(wildcard, "wildcard") as CircuitWildcard,
    });
  }
  return strictSignal(value);
}

function strictOperand(value: unknown): CircuitOperand {
  const constant = strictDataRecord(value, ["kind", "value"]);
  if (constant && dataValue(constant, "kind") === "constant") {
    return normalizeOperand({
      kind: "constant",
      value: dataValue(constant, "value") as number,
    });
  }
  const signal = strictDataRecord(value, ["kind", "selector"]);
  if (signal && dataValue(signal, "kind") === "signal") {
    return normalizeOperand({
      kind: "signal",
      selector: strictSelector(dataValue(signal, "selector")),
    });
  }
  throw new CircuitValidationError("operand must be plain canonical data");
}

function strictCondition(value: unknown): CircuitCondition {
  const record = strictDataRecord(value, [
    "left",
    "operator",
    "right",
  ]);
  if (!record) {
    throw new CircuitValidationError(
      "condition must be plain canonical data",
    );
  }
  return normalizeCondition({
    left: strictSelector(dataValue(record, "left")),
    operator: dataValue(record, "operator") as CircuitComparisonOperator,
    right: strictOperand(dataValue(record, "right")),
  });
}

function strictFrame(
  value: unknown,
  maxSignals: number,
): CircuitFrame {
  const array = strictDataArray(value, maxSignals);
  if (!array) {
    throw new CircuitValidationError("frame must be a dense plain array");
  }
  const entries = array.map((entry) => {
    const record = strictDataRecord(entry, ["signal", "value"]);
    if (!record) {
      throw new CircuitValidationError(
        "frame entry must be plain canonical data",
      );
    }
    return {
      signal: strictSignal(dataValue(record, "signal")),
      value: assertSafeInteger(
        dataValue(record, "value"),
        "signal value",
      ),
    };
  });
  const canonical = canonicalCircuitFrame(entries, maxSignals);
  if (
    canonical.length !== entries.length ||
    canonical.some(
      (entry, index) =>
        compareSignal(entry.signal, entries[index]!.signal) !== 0 ||
        entry.value !== entries[index]!.value,
    )
  ) {
    throw new CircuitValidationError("frame is not canonical");
  }
  return canonical;
}

function strictOutputSelector(
  value: unknown,
): CircuitSignal | { readonly wildcard: "each" } {
  const wildcard = strictDataRecord(value, ["wildcard"]);
  if (wildcard) {
    if (dataValue(wildcard, "wildcard") !== "each") {
      throw new CircuitValidationError("output wildcard must be each");
    }
    return Object.freeze({ wildcard: "each" as const });
  }
  return strictSignal(value);
}

function strictDevice(
  value: unknown,
  maxSignals: number,
): NormalizedDevice {
  const base = strictDataRecord(value, [
    "kind",
    "id",
    "outputEndpoint",
    "signals",
    "enabled",
  ]);
  if (base && dataValue(base, "kind") === "constant") {
    return normalizeDevice(
      {
        kind: "constant",
        id: strictString(dataValue(base, "id"), "device ID"),
        outputEndpoint: strictString(
          dataValue(base, "outputEndpoint"),
          "output endpoint",
        ),
        signals: strictFrame(
          dataValue(base, "signals"),
          maxSignals,
        ),
        enabled: dataValue(base, "enabled") as boolean,
      },
      maxSignals,
    );
  }
  const arithmetic = strictDataRecord(value, [
    "kind",
    "id",
    "inputEndpoint",
    "outputEndpoint",
    "left",
    "operator",
    "right",
    "output",
  ]);
  if (
    arithmetic &&
    dataValue(arithmetic, "kind") === "arithmetic"
  ) {
    return normalizeDevice(
      {
        kind: "arithmetic",
        id: strictString(dataValue(arithmetic, "id"), "device ID"),
        inputEndpoint: strictString(
          dataValue(arithmetic, "inputEndpoint"),
          "input endpoint",
        ),
        outputEndpoint: strictString(
          dataValue(arithmetic, "outputEndpoint"),
          "output endpoint",
        ),
        left: strictOperand(dataValue(arithmetic, "left")),
        operator: dataValue(
          arithmetic,
          "operator",
        ) as CircuitArithmeticOperator,
        right: strictOperand(dataValue(arithmetic, "right")),
        output: strictOutputSelector(dataValue(arithmetic, "output")),
      },
      maxSignals,
    );
  }
  const decider = strictDataRecord(value, [
    "kind",
    "id",
    "inputEndpoint",
    "outputEndpoint",
    "condition",
    "output",
    "outputMode",
  ]);
  if (decider && dataValue(decider, "kind") === "decider") {
    return normalizeDevice(
      {
        kind: "decider",
        id: strictString(dataValue(decider, "id"), "device ID"),
        inputEndpoint: strictString(
          dataValue(decider, "inputEndpoint"),
          "input endpoint",
        ),
        outputEndpoint: strictString(
          dataValue(decider, "outputEndpoint"),
          "output endpoint",
        ),
        condition: strictCondition(
          dataValue(decider, "condition"),
        ),
        output: strictOutputSelector(dataValue(decider, "output")),
        outputMode: dataValue(
          decider,
          "outputMode",
        ) as CircuitDeciderDevice["outputMode"],
      },
      maxSignals,
    );
  }
  throw new CircuitValidationError(
    "device must be plain canonical data",
  );
}

function strictMachinePort(
  value: unknown,
  maxSignals = DEFAULT_LIMITS.maxSignalsPerFrame,
): NormalizedMachinePort {
  const record = strictDataRecord(value, [
    "id",
    "inputEndpoint",
    "outputEndpoint",
    "enableCondition",
    "powerSwitchCondition",
    "filter",
    "sorterRoutes",
    "sorterFallback",
  ]);
  if (!record) {
    throw new CircuitValidationError(
      "machine port must be plain canonical data",
    );
  }
  const outputEndpoint = dataValue(record, "outputEndpoint");
  const enableCondition = dataValue(record, "enableCondition");
  const powerSwitchCondition = dataValue(
    record,
    "powerSwitchCondition",
  );
  const filterValue = dataValue(record, "filter");
  let filter: CircuitMachineFilter | undefined;
  if (filterValue !== null) {
    const filterRecord = strictDataRecord(filterValue, [
      "candidates",
      "minimum",
    ]);
    if (!filterRecord) {
      throw new CircuitValidationError(
        "machine filter must be plain canonical data",
      );
    }
    const candidatesValue = dataValue(filterRecord, "candidates");
    let candidates: CircuitSignal[] | undefined;
    if (candidatesValue !== null) {
      const array = strictDataArray(candidatesValue, maxSignals);
      if (!array) {
        throw new CircuitValidationError(
          "filter candidates must be a dense plain array",
        );
      }
      candidates = array.map(strictSignal);
      if (!strictlyIncreasing(candidates, compareSignal)) {
        throw new CircuitValidationError(
          "filter candidates are not canonical and unique",
        );
      }
    }
    filter = {
      ...(candidates ? { candidates } : {}),
      minimum: assertSafeInteger(
        dataValue(filterRecord, "minimum"),
        "filter minimum",
      ),
    };
  }
  const routesValue = strictDataArray(
    dataValue(record, "sorterRoutes"),
    maxSignals,
  );
  if (!routesValue) {
    throw new CircuitValidationError(
      "sorter routes must be a dense plain array",
    );
  }
  const sorterRoutes = routesValue.map((route) => {
    const routeRecord = strictDataRecord(route, [
      "priority",
      "output",
      "condition",
    ]);
    if (!routeRecord) {
      throw new CircuitValidationError(
        "sorter route must be plain canonical data",
      );
    }
    return {
      priority: assertSafeInteger(
        dataValue(routeRecord, "priority"),
        "sorter route priority",
      ),
      output: strictString(
        dataValue(routeRecord, "output"),
        "sorter output",
      ),
      condition: strictCondition(
        dataValue(routeRecord, "condition"),
      ),
    };
  });
  if (
    !strictlyIncreasing(
      sorterRoutes,
      (left, right) =>
        left.priority - right.priority ||
        compareText(left.output, right.output),
    )
  ) {
    throw new CircuitValidationError(
      "sorter routes are not canonical and unique",
    );
  }
  const sorterFallback = dataValue(record, "sorterFallback");
  return normalizeMachinePort(
    {
      id: strictString(dataValue(record, "id"), "machine port ID"),
      inputEndpoint: strictString(
        dataValue(record, "inputEndpoint"),
        "machine input endpoint",
      ),
      ...(outputEndpoint === null
        ? {}
        : {
            outputEndpoint: strictString(
              outputEndpoint,
              "machine output endpoint",
            ),
          }),
      ...(enableCondition === null
        ? {}
        : { enableCondition: strictCondition(enableCondition) }),
      ...(powerSwitchCondition === null
        ? {}
        : {
            powerSwitchCondition: strictCondition(
              powerSwitchCondition,
            ),
          }),
      ...(filter ? { filter } : {}),
      sorterRoutes,
      ...(sorterFallback === null
        ? {}
        : {
            sorterFallback: strictString(
              sorterFallback,
              "sorter fallback",
            ),
          }),
    },
    maxSignals,
  );
}

function strictlyIncreasing<T>(
  values: readonly T[],
  compare: (left: T, right: T) => number,
): boolean {
  return values.every(
    (value, index) =>
      index === 0 || compare(values[index - 1]!, value) < 0,
  );
}

/**
 * Restores only dense plain arrays and Object/null-prototype records with
 * enumerable own data properties. Accessors, symbols, class instances,
 * inherited fields, unknown keys, sparse arrays, and non-canonical ordering
 * are rejected before any network state is committed.
 */
export function restoreCircuitNetwork(value: unknown): CircuitNetwork {
  try {
    const root = strictDataRecord(value, [
      "format",
      "version",
      "limits",
      "tick",
      "endpoints",
      "wires",
      "devices",
      "machinePorts",
      "state",
    ]);
    if (
      !root ||
      dataValue(root, "format") !== CIRCUIT_NETWORK_FORMAT ||
      dataValue(root, "version") !== CIRCUIT_NETWORK_VERSION
    ) {
      throw new CircuitValidationError(
        "unsupported circuit save format/version",
      );
    }

    const limitsRecord = strictDataRecord(dataValue(root, "limits"), [
      "maxEndpoints",
      "maxWires",
      "maxDevices",
      "maxMachinePorts",
      "maxSignalsPerFrame",
      "maxSignalVisitsPerTick",
    ]);
    if (!limitsRecord) {
      throw new CircuitValidationError(
        "limits must be plain canonical data",
      );
    }
    const limits = normalizeLimits({
      limits: {
        maxEndpoints: dataValue(limitsRecord, "maxEndpoints") as number,
        maxWires: dataValue(limitsRecord, "maxWires") as number,
        maxDevices: dataValue(limitsRecord, "maxDevices") as number,
        maxMachinePorts: dataValue(
          limitsRecord,
          "maxMachinePorts",
        ) as number,
        maxSignalsPerFrame: dataValue(
          limitsRecord,
          "maxSignalsPerFrame",
        ) as number,
        maxSignalVisitsPerTick: dataValue(
          limitsRecord,
          "maxSignalVisitsPerTick",
        ) as number,
      },
    });
    const tick = assertSafeInteger(dataValue(root, "tick"), "tick");
    if (tick < 0) {
      throw new CircuitValidationError("tick cannot be negative");
    }

    const endpointsValue = strictDataArray(
      dataValue(root, "endpoints"),
      limits.maxEndpoints,
    );
    if (!endpointsValue) {
      throw new CircuitValidationError(
        "endpoints must be a dense plain array",
      );
    }
    const endpoints = endpointsValue.map((endpoint) =>
      assertIdentifier(endpoint, "endpoint ID")
    );
    if (!strictlyIncreasing(endpoints, compareText)) {
      throw new CircuitValidationError(
        "endpoints are not canonical and unique",
      );
    }

    const wiresValue = strictDataArray(
      dataValue(root, "wires"),
      limits.maxWires,
    );
    if (!wiresValue) {
      throw new CircuitValidationError(
        "wires must be a dense plain array",
      );
    }
    const wires = wiresValue.map((wire) => {
      const record = strictDataRecord(wire, [
        "color",
        "endpointA",
        "endpointB",
      ]);
      if (!record) {
        throw new CircuitValidationError(
          "wire must be plain canonical data",
        );
      }
      const canonical = canonicalWire(
        strictString(dataValue(record, "color"), "wire color"),
        strictString(
          dataValue(record, "endpointA"),
          "wire endpoint",
        ),
        strictString(
          dataValue(record, "endpointB"),
          "wire endpoint",
        ),
      );
      if (
        canonical.endpointA !== dataValue(record, "endpointA") ||
        canonical.endpointB !== dataValue(record, "endpointB")
      ) {
        throw new CircuitValidationError(
          "wire endpoints are not canonical",
        );
      }
      return canonical;
    });
    if (!strictlyIncreasing(wires, compareWire)) {
      throw new CircuitValidationError(
        "wires are not canonical and unique",
      );
    }

    const devicesValue = strictDataArray(
      dataValue(root, "devices"),
      limits.maxDevices,
    );
    if (!devicesValue) {
      throw new CircuitValidationError(
        "devices must be a dense plain array",
      );
    }
    const devices = devicesValue.map((device) =>
      strictDevice(device, limits.maxSignalsPerFrame)
    );
    if (
      !strictlyIncreasing(
        devices,
        (left, right) => compareText(left.id, right.id),
      )
    ) {
      throw new CircuitValidationError(
        "devices are not canonical and unique",
      );
    }

    const portsValue = strictDataArray(
      dataValue(root, "machinePorts"),
      limits.maxMachinePorts,
    );
    if (!portsValue) {
      throw new CircuitValidationError(
        "machine ports must be a dense plain array",
      );
    }
    const machinePorts = portsValue.map((port) =>
      strictMachinePort(port, limits.maxSignalsPerFrame)
    );
    if (
      !strictlyIncreasing(
        machinePorts,
        (left, right) => compareText(left.id, right.id),
      )
    ) {
      throw new CircuitValidationError(
        "machine ports are not canonical and unique",
      );
    }

    const stateRecord = strictDataRecord(dataValue(root, "state"), [
      "activeOutputs",
      "lastEndpointFrames",
    ]);
    if (!stateRecord) {
      throw new CircuitValidationError(
        "state must be plain canonical data",
      );
    }
    const activeValue = strictDataArray(
      dataValue(stateRecord, "activeOutputs"),
      limits.maxDevices + limits.maxMachinePorts,
    );
    const framesValue = strictDataArray(
      dataValue(stateRecord, "lastEndpointFrames"),
      limits.maxEndpoints,
    );
    if (!activeValue || !framesValue) {
      throw new CircuitValidationError(
        "state arrays must be dense plain arrays",
      );
    }
    const activeOutputs = activeValue.map((output) => {
      const record = strictDataRecord(output, [
        "sourceId",
        "endpointId",
        "signals",
      ]);
      if (!record) {
        throw new CircuitValidationError(
          "active output must be plain canonical data",
        );
      }
      return Object.freeze({
        sourceId: assertIdentifier(
          dataValue(record, "sourceId"),
          "active source ID",
        ),
        endpointId: assertIdentifier(
          dataValue(record, "endpointId"),
          "active endpoint ID",
        ),
        signals: strictFrame(
          dataValue(record, "signals"),
          limits.maxSignalsPerFrame,
        ),
      });
    });
    if (
      !strictlyIncreasing(
        activeOutputs,
        (left, right) =>
          compareText(left.sourceId, right.sourceId),
      )
    ) {
      throw new CircuitValidationError(
        "active outputs are not canonical and unique",
      );
    }
    const lastEndpointFrames = framesValue.map((entry) => {
      const record = strictDataRecord(entry, [
        "endpointId",
        "signals",
      ]);
      if (!record) {
        throw new CircuitValidationError(
          "endpoint frame must be plain canonical data",
        );
      }
      const signals = strictFrame(
        dataValue(record, "signals"),
        limits.maxSignalsPerFrame,
      );
      if (signals.length === 0) {
        throw new CircuitValidationError(
          "empty endpoint frames must be omitted",
        );
      }
      return Object.freeze({
        endpointId: assertIdentifier(
          dataValue(record, "endpointId"),
          "endpoint frame ID",
        ),
        signals,
      });
    });
    if (
      !strictlyIncreasing(
        lastEndpointFrames,
        (left, right) =>
          compareText(left.endpointId, right.endpointId),
      )
    ) {
      throw new CircuitValidationError(
        "endpoint frames are not canonical and unique",
      );
    }

    const endpointSet = new Set(endpoints);
    const expectedSources = new Map<string, string>();
    for (const device of devices) {
      expectedSources.set(
        sourceIdForDevice(device.id),
        device.outputEndpoint,
      );
    }
    for (const port of machinePorts) {
      if (port.outputEndpoint !== null) {
        expectedSources.set(
          sourceIdForMachine(port.id),
          port.outputEndpoint,
        );
      }
    }
    for (const output of activeOutputs) {
      if (
        expectedSources.get(output.sourceId) !== output.endpointId
      ) {
        throw new CircuitValidationError(
          "active output does not match a configured source",
        );
      }
    }
    if (
      tick === 0 &&
      (activeOutputs.length > 0 || lastEndpointFrames.length > 0)
    ) {
      throw new CircuitValidationError(
        "tick-zero state must not contain propagated signals",
      );
    }
    for (const frame of lastEndpointFrames) {
      if (!endpointSet.has(frame.endpointId)) {
        throw new CircuitValidationError(
          "state references an unknown endpoint",
        );
      }
    }

    const normalized: SerializedCircuitNetwork = {
      format: CIRCUIT_NETWORK_FORMAT,
      version: CIRCUIT_NETWORK_VERSION,
      limits,
      tick,
      endpoints: Object.freeze(endpoints),
      wires: Object.freeze(wires),
      devices: Object.freeze(devices),
      machinePorts: Object.freeze(machinePorts),
      state: Object.freeze({
        activeOutputs: Object.freeze(activeOutputs),
        lastEndpointFrames: Object.freeze(lastEndpointFrames),
      }),
    };
    return CircuitNetwork._restoreValidated(normalized);
  } catch (error) {
    if (error instanceof CircuitValidationError) throw error;
    throw new CircuitValidationError(
      `invalid circuit save: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
}

export function canonicalCircuitNetworkString(
  value: CircuitNetwork | SerializedCircuitNetwork,
): string {
  const network =
    value instanceof CircuitNetwork
      ? value
      : restoreCircuitNetwork(value);
  return network.canonicalString();
}

export function canonicalCircuitNetworkBytes(
  value: CircuitNetwork | SerializedCircuitNetwork,
): Uint8Array {
  return new TextEncoder().encode(canonicalCircuitNetworkString(value));
}
