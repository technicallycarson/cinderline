import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type {
  AdaptedRenderSnapshot,
  CircuitRenderEntity,
} from "../game/adapters";
import type {
  CircuitArithmeticOperator,
  CircuitFrame,
  CircuitMachineControl,
  CircuitOperand,
  CircuitSelector,
  CircuitSignal,
} from "../game/circuit-network";
import type {
  CircuitConnector,
  CircuitEntityKind,
  CircuitSimulationSnapshot,
  CircuitWireColor,
  Direction,
  EntityStatus,
} from "../game/types";

export type CircuitVisualFrame = Pick<
  AdaptedRenderSnapshot,
  "elapsed" | "circuit" | "circuitEntities"
>;

export interface CircuitRendererOptions {
  /** Full mechanical cabinets retained at once; overflow uses three batches. */
  readonly maxDetailedDevices?: number;
  /** Canonical leading signals represented on restrained cabinet meters. */
  readonly maxSignalsPerDevice?: number;
  /**
   * Retained for save/API compatibility. Presentation never renders packets or
   * arrows; the value only bounds deterministic route analysis.
   */
  readonly maxPulses?: number;
  readonly maxRenderedEndpoints?: number;
  readonly maxRenderedWires?: number;
  /** High keeps more authored cabinets; low moves earlier to the overview LOD. */
  readonly quality?: "high" | "low";
}

export interface CircuitRenderDebug {
  readonly disposed: boolean;
  readonly topologySignature: string;
  readonly stateSignature: string;
  readonly tick: number;
  readonly entities: number;
  readonly detailedDevices: number;
  readonly overviewDevices: number;
  readonly constants: number;
  readonly arithmetic: number;
  readonly deciders: number;
  readonly endpoints: number;
  readonly omittedEndpoints: number;
  readonly wires: number;
  readonly omittedWires: number;
  readonly redWires: number;
  readonly greenWires: number;
  readonly junctions: number;
  readonly machinePorts: number;
  readonly configuredMachinePorts: number;
  readonly activeDevices: number;
  readonly signalIndicators: number;
  readonly directionalWires: number;
  readonly pulses: number;
  readonly omittedPulses: number;
  /** Circuit pulses traverse a complete route once per fixed simulation tick. */
  readonly pulsePeriodTicks: 1;
  readonly quality: "high" | "low";
  /** Presentation intentionally uses physical cable state, never packet pips. */
  readonly presentationPulses: 0;
  readonly connectorModules: number;
  readonly actuatedMachinePorts: number;
  readonly servicePads: number;
  readonly cableSupports: number;
  readonly causalMeters: number;
  readonly machineProcessRigs: number;
  readonly enabledMachineResponses: number;
  readonly districtModules: number;
  readonly districtTraySegments: number;
  readonly wireSag: {
    readonly minimum: number;
    readonly maximum: number;
    readonly spanScaled: true;
  };
  readonly drawBatches: number;
  readonly triangles: number;
  readonly capacities: {
    readonly endpoints: number;
    readonly redWires: number;
    readonly greenWires: number;
    readonly pulses: number;
  };
  readonly resources: {
    readonly ownedGeometries: number;
    readonly ownedMaterials: number;
    readonly liveInstancedMeshes: number;
    readonly disposedGeometries: number;
    readonly disposedMaterials: number;
    readonly ownedTextures: number;
    readonly disposedTextures: number;
    readonly disposedInstancedMeshes: number;
  };
}

interface NormalizedOptions {
  readonly maxDetailedDevices: number;
  readonly maxSignalsPerDevice: number;
  readonly maxPulses: number;
  readonly maxRenderedEndpoints: number;
  readonly maxRenderedWires: number;
  readonly quality: "high" | "low";
}

interface CircuitMaterials {
  readonly foundation: THREE.MeshStandardMaterial;
  readonly armor: THREE.MeshStandardMaterial;
  readonly darkMetal: THREE.MeshStandardMaterial;
  readonly titanium: THREE.MeshStandardMaterial;
  readonly bronze: THREE.MeshStandardMaterial;
  readonly copper: THREE.MeshStandardMaterial;
  readonly rust: THREE.MeshStandardMaterial;
  readonly rubber: THREE.MeshStandardMaterial;
  readonly ceramic: THREE.MeshStandardMaterial;
  readonly meterGlass: THREE.MeshPhysicalMaterial;
  readonly meterFace: THREE.MeshStandardMaterial;
  readonly constantHousing: THREE.MeshStandardMaterial;
  readonly arithmeticHousing: THREE.MeshStandardMaterial;
  readonly deciderHousing: THREE.MeshStandardMaterial;
  readonly constantAccent: THREE.MeshStandardMaterial;
  readonly arithmeticAccent: THREE.MeshStandardMaterial;
  readonly deciderAccent: THREE.MeshStandardMaterial;
  readonly wireRed: THREE.MeshStandardMaterial;
  readonly wireGreen: THREE.MeshStandardMaterial;
  readonly tracerRed: THREE.MeshStandardMaterial;
  readonly tracerGreen: THREE.MeshStandardMaterial;
  readonly signalItem: THREE.MeshStandardMaterial;
  readonly signalFluid: THREE.MeshStandardMaterial;
  readonly signalVirtual: THREE.MeshStandardMaterial;
  readonly active: THREE.MeshStandardMaterial;
  readonly idle: THREE.MeshStandardMaterial;
  readonly warning: THREE.MeshStandardMaterial;
  readonly disabled: THREE.MeshStandardMaterial;
  readonly guardClosed: THREE.MeshStandardMaterial;
  readonly serviceConcrete: THREE.MeshStandardMaterial;
  readonly safetyPaint: THREE.MeshStandardMaterial;
  readonly groundWear: THREE.MeshStandardMaterial;
  readonly instrumentAmber: THREE.MeshStandardMaterial;
  readonly instrumentGreen: THREE.MeshStandardMaterial;
  readonly instrumentRed: THREE.MeshStandardMaterial;
  readonly processHot: THREE.MeshStandardMaterial;
  readonly processCold: THREE.MeshStandardMaterial;
  readonly processProduct: THREE.MeshStandardMaterial;
  readonly districtEnamel: THREE.MeshStandardMaterial;
  readonly districtCoolant: THREE.MeshStandardMaterial;
  readonly districtGuard: THREE.MeshStandardMaterial;
  readonly processVapor: THREE.SpriteMaterial;
  readonly all: readonly THREE.Material[];
  readonly textures: readonly THREE.Texture[];
}

interface CircuitGeometries {
  readonly rigBase: THREE.BufferGeometry;
  readonly constantHousing: THREE.BufferGeometry;
  readonly constantMetal: THREE.BufferGeometry;
  readonly arithmeticHousing: THREE.BufferGeometry;
  readonly arithmeticMetal: THREE.BufferGeometry;
  readonly deciderHousing: THREE.BufferGeometry;
  readonly deciderMetal: THREE.BufferGeometry;
  readonly overviewConstant: THREE.BufferGeometry;
  readonly overviewArithmetic: THREE.BufferGeometry;
  readonly overviewDecider: THREE.BufferGeometry;
  readonly indexingDrum: THREE.BufferGeometry;
  readonly signalKey: THREE.BufferGeometry;
  readonly gear: THREE.BufferGeometry;
  readonly operatorArm: THREE.BufferGeometry;
  readonly balanceBeam: THREE.BufferGeometry;
  readonly gateLeaf: THREE.BufferGeometry;
  readonly cabinetFaceHardware: THREE.BufferGeometry;
  readonly statusLens: THREE.BufferGeometry;
  readonly meterWell: THREE.BufferGeometry;
  readonly meterScreen: THREE.BufferGeometry;
  readonly endpointBase: THREE.BufferGeometry;
  readonly endpointCollar: THREE.BufferGeometry;
  readonly endpointInsulator: THREE.BufferGeometry;
  readonly endpointStrainRelief: THREE.BufferGeometry;
  readonly endpointFerrule: THREE.BufferGeometry;
  readonly junction: THREE.BufferGeometry;
  readonly machineClamp: THREE.BufferGeometry;
  readonly machineLever: THREE.BufferGeometry;
  readonly routeLamp: THREE.BufferGeometry;
  readonly wireOuter: THREE.BufferGeometry;
  readonly machineUmbilical: THREE.BufferGeometry;
  readonly servicePad: THREE.BufferGeometry;
  readonly serviceStripe: THREE.BufferGeometry;
  readonly cableSupport: THREE.BufferGeometry;
  readonly cableClip: THREE.BufferGeometry;
  readonly groundWear: THREE.BufferGeometry;
  readonly districtGrating: THREE.BufferGeometry;
  readonly districtDeckSlab: THREE.BufferGeometry;
  readonly districtDeckGrating: THREE.BufferGeometry;
  readonly districtPipeRack: THREE.BufferGeometry;
  readonly districtPowerModule: THREE.BufferGeometry;
  readonly districtCableTray: THREE.BufferGeometry;
  readonly districtProcessHeader: THREE.BufferGeometry;
  readonly districtFieldDeck: THREE.BufferGeometry;
  readonly districtFieldGrating: THREE.BufferGeometry;
  readonly districtProcessPod: THREE.BufferGeometry;
  readonly districtProcessPodTrim: THREE.BufferGeometry;
  readonly districtCoolingModule: THREE.BufferGeometry;
  readonly districtCoolingRotor: THREE.BufferGeometry;
  readonly districtPerimeterRail: THREE.BufferGeometry;
  readonly districtValveCluster: THREE.BufferGeometry;
  readonly machineProcessSkid: THREE.BufferGeometry;
  readonly machineFlywheel: THREE.BufferGeometry;
  readonly machineCrank: THREE.BufferGeometry;
  readonly machinePiston: THREE.BufferGeometry;
  readonly machineProductChute: THREE.BufferGeometry;
  readonly machineProduct: THREE.BufferGeometry;
  readonly machineExhaustStack: THREE.BufferGeometry;
  readonly machineHeatBank: THREE.BufferGeometry;
  readonly machineProcessCore: THREE.BufferGeometry;
  readonly machineGuardShutter: THREE.BufferGeometry;
  readonly machineOutputRoller: THREE.BufferGeometry;
  readonly all: readonly THREE.BufferGeometry[];
}

interface DetailedRig {
  readonly entityId: number;
  readonly kind: CircuitEntityKind;
  readonly root: THREE.Group;
  readonly status: THREE.Mesh;
  readonly moving: readonly THREE.Object3D[];
  readonly operatorArms: readonly THREE.Object3D[];
  readonly toggles: readonly THREE.Object3D[];
  readonly gateLeaves: readonly THREE.Object3D[];
  readonly meterDisplay: THREE.Mesh;
  readonly meterTexture: THREE.Texture;
  readonly meterMaterial: THREE.MeshStandardMaterial;
  readonly workingLight: THREE.PointLight;
  active: boolean;
  warning: boolean;
  operatorIndex: number;
  signalCount: number;
  meterLines: readonly string[];
}

interface MachineProcessRig {
  readonly portId: string;
  readonly entityId: number;
  readonly root: THREE.Group;
  readonly flywheel: THREE.Object3D;
  readonly crank: THREE.Object3D;
  readonly piston: THREE.Object3D;
  readonly products: readonly THREE.Object3D[];
  readonly heatBanks: readonly THREE.Mesh[];
  readonly vapor: readonly THREE.Sprite[];
  readonly processCore: THREE.Mesh;
  readonly guardShutters: readonly THREE.Mesh[];
  readonly outputRollers: readonly THREE.Object3D[];
  readonly statusLens: THREE.Mesh;
  readonly workingLight: THREE.PointLight;
  enabled: boolean;
  configured: boolean;
}

interface InstancedBatch {
  readonly key: string;
  readonly mesh: THREE.InstancedMesh;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly parent: THREE.Object3D;
  readonly capacity: number;
}

interface VisualEndpoint {
  readonly endpointId: string;
  readonly entityId: number;
  readonly connector: CircuitConnector;
  readonly x: number;
  readonly z: number;
  readonly nativeX: number;
  readonly nativeZ: number;
  readonly height: number;
  readonly yaw: number;
  readonly attachmentScale: number;
  readonly signals: CircuitFrame;
  readonly isCircuitDevice: boolean;
}

interface VisualWire {
  readonly key: string;
  readonly color: CircuitWireColor;
  readonly endpointA: VisualEndpoint;
  readonly endpointB: VisualEndpoint;
}

interface PulseRoute {
  readonly key: string;
  readonly color: CircuitWireColor;
  readonly from: VisualEndpoint;
  readonly to: VisualEndpoint;
  readonly signal: CircuitSignal;
  readonly signalValue: number;
  readonly phaseOffset: number;
}

interface DeviceVisualState {
  readonly definition:
    | CircuitSimulationSnapshot["devices"][number]
    | undefined;
  readonly input: CircuitFrame;
  readonly output: CircuitFrame;
  readonly display: CircuitFrame;
  readonly active: boolean;
  readonly warning: boolean;
  readonly operatorIndex: number;
  readonly meter: DeviceMeterState;
}

interface DeviceMeterState {
  readonly inputValue: number;
  readonly operandValue: number;
  readonly outputValue: number;
  readonly operator: string;
  readonly lines: readonly string[];
}

interface MachinePortVisual {
  readonly port: CircuitSimulationSnapshot["machinePorts"][number];
  readonly endpoint: VisualEndpoint;
  readonly control: CircuitMachineControl | undefined;
  readonly configured: boolean;
}

interface SignalIndicator {
  readonly entityId: number;
  readonly signal: CircuitSignal;
  readonly value: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  readonly source: "device" | "machine-filter";
}

const DEFAULT_OPTIONS: NormalizedOptions = Object.freeze({
  maxDetailedDevices: 48,
  maxSignalsPerDevice: 3,
  maxPulses: 2_048,
  maxRenderedEndpoints: 8_192,
  maxRenderedWires: 8_192,
  quality: "high",
});

const EMPTY_DEBUG: CircuitRenderDebug = Object.freeze({
  disposed: false,
  topologySignature: "circuit-topology-00000000",
  stateSignature: "circuit-state-00000000",
  tick: 0,
  entities: 0,
  detailedDevices: 0,
  overviewDevices: 0,
  constants: 0,
  arithmetic: 0,
  deciders: 0,
  endpoints: 0,
  omittedEndpoints: 0,
  wires: 0,
  omittedWires: 0,
  redWires: 0,
  greenWires: 0,
  junctions: 0,
  machinePorts: 0,
  configuredMachinePorts: 0,
  activeDevices: 0,
  signalIndicators: 0,
  directionalWires: 0,
  pulses: 0,
  omittedPulses: 0,
  pulsePeriodTicks: 1,
  quality: "high",
  presentationPulses: 0,
  connectorModules: 0,
  actuatedMachinePorts: 0,
  servicePads: 0,
  cableSupports: 0,
  causalMeters: 0,
  machineProcessRigs: 0,
  enabledMachineResponses: 0,
  districtModules: 0,
  districtTraySegments: 0,
  wireSag: Object.freeze({
    minimum: 0,
    maximum: 0,
    spanScaled: true,
  }),
  drawBatches: 0,
  triangles: 0,
  capacities: Object.freeze({
    endpoints: 0,
    redWires: 0,
    greenWires: 0,
    pulses: 0,
  }),
  resources: Object.freeze({
    ownedGeometries: 0,
    ownedMaterials: 0,
    liveInstancedMeshes: 0,
    disposedGeometries: 0,
    disposedMaterials: 0,
    ownedTextures: 0,
    disposedTextures: 0,
    disposedInstancedMeshes: 0,
  }),
});

const KIND_ORDER: Readonly<Record<CircuitEntityKind, number>> =
  Object.freeze({
    constantCombinator: 0,
    arithmeticCombinator: 1,
    deciderCombinator: 2,
  });

const ARITHMETIC_OPERATOR_ORDER = Object.freeze([
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
] as const);

const COMPARISON_OPERATOR_ORDER = Object.freeze([
  "<",
  "<=",
  "==",
  "!=",
  ">=",
  ">",
] as const);

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const WIRE_REFERENCE_SAG = 0.1;
const WIRE_MINIMUM_SAG = 0.055;
const WIRE_MAXIMUM_SAG = 0.28;
const RED_ANCHOR_HEIGHT_OFFSET = 0.01;
const GREEN_ANCHOR_HEIGHT_OFFSET = 0.095;
const CONNECTOR_LATERAL_SPACING = 0.11;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function meterInteger(value: number, digits: number): string {
  const rounded = Number.isFinite(value) ? Math.trunc(value) : 0;
  const maximum = 10 ** digits - 1;
  if (rounded < 0) {
    return `-${Math.min(maximum, Math.abs(rounded))
      .toString()
      .padStart(Math.max(1, digits - 1), "0")}`;
  }
  return Math.min(maximum, rounded).toString().padStart(digits, "0");
}

function selectorValue(
  frame: CircuitFrame,
  selector: CircuitSelector,
): number {
  if ("wildcard" in selector) {
    return strongestSignalEntry(frame)?.value ?? 0;
  }
  return (
    frame.find(
      (entry) =>
        entry.signal.type === selector.type &&
        entry.signal.name === selector.name,
    )?.value ?? 0
  );
}

function operandValue(
  frame: CircuitFrame,
  operand: CircuitOperand,
): number {
  return operand.kind === "constant"
    ? operand.value
    : selectorValue(frame, operand.selector);
}

function arithmeticGlyph(
  operator: CircuitArithmeticOperator,
): string {
  switch (operator) {
    case "add":
      return "+";
    case "subtract":
      return "-";
    case "multiply":
      return "X";
    case "divide":
      return "/";
    case "modulo":
      return "%";
    case "power":
      return "^";
    case "leftShift":
      return "<";
    case "rightShift":
      return ">";
    case "bitAnd":
      return "&";
    case "bitOr":
      return "|";
    case "bitXor":
      return "X";
  }
}

function compareEntity(
  left: CircuitRenderEntity,
  right: CircuitRenderEntity,
): number {
  return (
    left.z - right.z ||
    left.x - right.x ||
    KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
    left.id - right.id
  );
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const candidate = value ?? fallback;
  if (
    !Number.isSafeInteger(candidate) ||
    candidate < 1 ||
    candidate > maximum
  ) {
    throw new Error(
      `${label} must be a positive safe integer no greater than ${maximum}.`,
    );
  }
  return candidate;
}

function normalizeOptions(
  options: CircuitRendererOptions,
): NormalizedOptions {
  if (
    options.quality !== undefined &&
    options.quality !== "high" &&
    options.quality !== "low"
  ) {
    throw new Error('quality must be either "high" or "low".');
  }
  const quality = options.quality ?? DEFAULT_OPTIONS.quality;
  const requestedDetail = normalizePositiveInteger(
    options.maxDetailedDevices,
    DEFAULT_OPTIONS.maxDetailedDevices,
    256,
    "maxDetailedDevices",
  );
  return Object.freeze({
    maxDetailedDevices:
      quality === "low" ? Math.min(requestedDetail, 12) : requestedDetail,
    maxSignalsPerDevice: normalizePositiveInteger(
      options.maxSignalsPerDevice,
      DEFAULT_OPTIONS.maxSignalsPerDevice,
      8,
      "maxSignalsPerDevice",
    ),
    maxPulses: normalizePositiveInteger(
      options.maxPulses,
      DEFAULT_OPTIONS.maxPulses,
      16_384,
      "maxPulses",
    ),
    maxRenderedEndpoints: normalizePositiveInteger(
      options.maxRenderedEndpoints,
      DEFAULT_OPTIONS.maxRenderedEndpoints,
      16_384,
      "maxRenderedEndpoints",
    ),
    maxRenderedWires: normalizePositiveInteger(
      options.maxRenderedWires,
      DEFAULT_OPTIONS.maxRenderedWires,
      16_384,
      "maxRenderedWires",
    ),
    quality,
  });
}

function transformGeometry(
  geometry: THREE.BufferGeometry,
  position: readonly [number, number, number],
  scale: readonly [number, number, number],
  rotation: readonly [number, number, number] = [0, 0, 0],
): THREE.BufferGeometry {
  const transformed =
    geometry.index === null ? geometry : geometry.toNonIndexed();
  if (transformed !== geometry) geometry.dispose();
  for (const attribute of Object.keys(transformed.attributes)) {
    if (
      attribute !== "position" &&
      attribute !== "normal" &&
      attribute !== "uv"
    ) {
      transformed.deleteAttribute(attribute);
    }
  }
  transformed.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(...rotation),
      ),
      new THREE.Vector3(...scale),
    ),
  );
  return transformed;
}

function roundedBox(
  position: readonly [number, number, number],
  scale: readonly [number, number, number],
  radius = 0.08,
  rotation: readonly [number, number, number] = [0, 0, 0],
): THREE.BufferGeometry {
  return transformGeometry(
    new RoundedBoxGeometry(1, 1, 1, 2, radius),
    position,
    scale,
    rotation,
  );
}

function box(
  position: readonly [number, number, number],
  scale: readonly [number, number, number],
  rotation: readonly [number, number, number] = [0, 0, 0],
): THREE.BufferGeometry {
  return transformGeometry(
    new THREE.BoxGeometry(1, 1, 1),
    position,
    scale,
    rotation,
  );
}

function cylinder(
  position: readonly [number, number, number],
  scale: readonly [number, number, number],
  radialSegments = 12,
  rotation: readonly [number, number, number] = [0, 0, 0],
): THREE.BufferGeometry {
  return transformGeometry(
    new THREE.CylinderGeometry(0.5, 0.5, 1, radialSegments),
    position,
    scale,
    rotation,
  );
}

function torus(
  position: readonly [number, number, number],
  scale: readonly [number, number, number],
  rotation: readonly [number, number, number] = [
    Math.PI / 2,
    0,
    0,
  ],
): THREE.BufferGeometry {
  return transformGeometry(
    new THREE.TorusGeometry(0.5, 0.105, 6, 18),
    position,
    scale,
    rotation,
  );
}

function mergeOwned(
  pieces: readonly THREE.BufferGeometry[],
  label: string,
): THREE.BufferGeometry {
  const merged = mergeGeometries([...pieces], false);
  for (const piece of pieces) piece.dispose();
  if (!merged) throw new Error(`Could not merge ${label} geometry.`);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  merged.name = label;
  return merged;
}

function createSaggingWireGeometry(
  radius: number,
  name: string,
): THREE.BufferGeometry {
  const longitudinalSegments = 16;
  const radialSegments = 8;
  const positions: number[] = [];
  const indices: number[] = [];
  for (
    let longitudinal = 0;
    longitudinal <= longitudinalSegments;
    longitudinal += 1
  ) {
    const t = longitudinal / longitudinalSegments;
    const z = t - 0.5;
    const sag = -WIRE_REFERENCE_SAG * 4 * t * (1 - t);
    const derivative = -WIRE_REFERENCE_SAG * 4 * (1 - 2 * t);
    const tangent = new THREE.Vector3(0, derivative, 1).normalize();
    const normal = new THREE.Vector3(1, 0, 0);
    const binormal = new THREE.Vector3()
      .crossVectors(tangent, normal)
      .normalize();
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const angle = (radial / radialSegments) * Math.PI * 2;
      const radialOffset = normal
        .clone()
        .multiplyScalar(Math.cos(angle) * radius)
        .addScaledVector(binormal, Math.sin(angle) * radius);
      positions.push(
        radialOffset.x,
        sag + radialOffset.y,
        z + radialOffset.z,
      );
    }
  }
  for (
    let longitudinal = 0;
    longitudinal < longitudinalSegments;
    longitudinal += 1
  ) {
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const next = (radial + 1) % radialSegments;
      const currentBase = longitudinal * radialSegments;
      const nextBase = (longitudinal + 1) * radialSegments;
      indices.push(
        currentBase + radial,
        nextBase + radial,
        nextBase + next,
        currentBase + radial,
        nextBase + next,
        currentBase + next,
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = name;
  return geometry;
}

function createGearGeometry(): THREE.BufferGeometry {
  return mergeOwned(
    [
      cylinder([0, 0, 0], [0.19, 0.06, 0.19], 20),
      cylinder([0, 0.038, 0], [0.082, 0.045, 0.082], 14),
      box([0, 0.066, -0.055], [0.025, 0.018, 0.07]),
      box([0, 0.066, 0.055], [0.025, 0.018, 0.07]),
    ],
    "circuit-contained-differential-register-rotor-geometry",
  );
}

function createIndexingDrumGeometry(): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [
    cylinder([0, 0, 0], [0.235, 0.075, 0.235], 20),
    cylinder([0, 0.045, 0], [0.135, 0.05, 0.135], 16),
    box([0, 0.076, -0.095], [0.04, 0.03, 0.08]),
  ];
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    pieces.push(
      box(
        [
          Math.cos(angle) * 0.125,
          0.025,
          Math.sin(angle) * 0.125,
        ],
        [0.022, 0.082, 0.04],
        [0, -angle, 0],
      ),
    );
  }
  return mergeOwned(
    pieces,
    "circuit-constant-knurled-solid-setpoint-drum-geometry",
  );
}

function createGeometries(): CircuitGeometries {
  const rigBase = mergeOwned(
    [
      roundedBox([0, 0.04, -0.31], [0.86, 0.08, 0.13], 0.025),
      roundedBox([0, 0.04, 0.31], [0.86, 0.08, 0.13], 0.025),
      box([-0.38, 0.065, 0], [0.085, 0.055, 0.56]),
      box([0.38, 0.065, 0], [0.085, 0.055, 0.56]),
      box([-0.34, 0.015, -0.31], [0.16, 0.03, 0.14]),
      box([0.34, 0.015, -0.31], [0.16, 0.03, 0.14]),
      box([-0.34, 0.015, 0.31], [0.16, 0.03, 0.14]),
      box([0.34, 0.015, 0.31], [0.16, 0.03, 0.14]),
    ],
    "circuit-bolted-cast-foundation-and-mounting-feet-geometry",
  );
  const constantHousing = mergeOwned(
    [
      roundedBox([0, 0.245, 0.08], [0.52, 0.29, 0.49], 0.05),
      cylinder([0, 0.445, -0.105], [0.46, 0.18, 0.46], 24),
      roundedBox([0, 0.26, 0.365], [0.44, 0.19, 0.18], 0.035),
      box([-0.285, 0.24, 0.095], [0.08, 0.22, 0.37]),
      box([0.285, 0.24, 0.095], [0.08, 0.22, 0.37]),
    ],
    "circuit-constant-compact-terminal-and-drum-source-geometry",
  );
  const constantMetal = mergeOwned(
    [
      torus([0, 0.545, -0.105], [0.48, 0.12, 0.48]),
      cylinder([0, 0.552, -0.105], [0.13, 0.035, 0.13], 16),
      box([0, 0.575, -0.105], [0.38, 0.025, 0.035]),
      box([0, 0.575, -0.105], [0.035, 0.025, 0.38]),
      box([0, 0.385, 0.445], [0.39, 0.055, 0.052]),
      cylinder([-0.155, 0.42, 0.445], [0.048, 0.05, 0.048], 10),
      cylinder([0, 0.42, 0.445], [0.048, 0.05, 0.048], 10),
      cylinder([0.155, 0.42, 0.445], [0.048, 0.05, 0.048], 10),
      cylinder([-0.225, 0.39, 0.285], [0.035, 0.035, 0.035], 10),
      cylinder([0.225, 0.39, 0.285], [0.035, 0.035, 0.035], 10),
    ],
    "circuit-constant-drum-rim-terminal-block-and-fasteners-geometry",
  );
  const arithmeticHousing = mergeOwned(
    [
      roundedBox([0, 0.235, 0.105], [0.78, 0.26, 0.47], 0.045),
      cylinder([-0.23, 0.445, -0.11], [0.34, 0.2, 0.34], 20),
      cylinder([0.23, 0.445, -0.11], [0.34, 0.2, 0.34], 20),
      roundedBox([0, 0.28, 0.38], [0.56, 0.18, 0.16], 0.035),
      box([-0.43, 0.31, -0.05], [0.07, 0.37, 0.5]),
      box([0.43, 0.31, -0.05], [0.07, 0.37, 0.5]),
    ],
    "circuit-arithmetic-guarded-twin-register-adder-geometry",
  );
  const arithmeticMetal = mergeOwned(
    [
      torus([-0.23, 0.555, -0.11], [0.36, 0.1, 0.36]),
      torus([0.23, 0.555, -0.11], [0.36, 0.1, 0.36]),
      box([0, 0.64, -0.315], [0.78, 0.04, 0.04]),
      box([0, 0.64, 0.095], [0.78, 0.04, 0.04]),
      box([-0.39, 0.49, -0.11], [0.04, 0.3, 0.45]),
      box([0.39, 0.49, -0.11], [0.04, 0.3, 0.45]),
      box([0, 0.405, 0.46], [0.5, 0.055, 0.052]),
      cylinder([-0.34, 0.655, -0.305], [0.038, 0.035, 0.038], 10),
      cylinder([0.34, 0.655, -0.305], [0.038, 0.035, 0.038], 10),
      cylinder([-0.34, 0.655, 0.09], [0.038, 0.035, 0.038], 10),
      cylinder([0.34, 0.655, 0.09], [0.038, 0.035, 0.038], 10),
    ],
    "circuit-arithmetic-register-rims-guard-cage-and-fasteners-geometry",
  );
  const deciderHousing = mergeOwned(
    [
      roundedBox([0, 0.245, 0.08], [0.6, 0.28, 0.61], 0.045),
      roundedBox([0, 0.43, -0.31], [0.72, 0.22, 0.2], 0.035),
      roundedBox([-0.2, 0.44, -0.08], [0.16, 0.26, 0.34], 0.035),
      roundedBox([0, 0.44, -0.08], [0.16, 0.26, 0.34], 0.035),
      roundedBox([0.2, 0.44, -0.08], [0.16, 0.26, 0.34], 0.035),
      box([-0.34, 0.34, 0.18], [0.065, 0.34, 0.47]),
      box([0.34, 0.34, 0.18], [0.065, 0.34, 0.47]),
    ],
    "circuit-decider-relay-bank-comparator-crowned-geometry",
  );
  const deciderMetal = mergeOwned(
    [
      box([0, 0.62, -0.4], [0.82, 0.055, 0.06]),
      box([-0.33, 0.52, -0.29], [0.05, 0.22, 0.24]),
      box([0.33, 0.52, -0.29], [0.05, 0.22, 0.24]),
      cylinder([-0.2, 0.585, -0.08], [0.11, 0.08, 0.11], 14),
      cylinder([0, 0.585, -0.08], [0.11, 0.08, 0.11], 14),
      cylinder([0.2, 0.585, -0.08], [0.11, 0.08, 0.11], 14),
      box([0, 0.62, 0.04], [0.52, 0.045, 0.045]),
      box([0, 0.42, 0.455], [0.46, 0.055, 0.052]),
      cylinder([-0.27, 0.62, 0.31], [0.038, 0.035, 0.038], 10),
      cylinder([0.27, 0.62, 0.31], [0.038, 0.035, 0.038], 10),
    ],
    "circuit-decider-relay-coils-crown-pivot-and-fasteners-geometry",
  );
  const overviewConstant = mergeOwned(
    [
      roundedBox([0, 0.23, 0], [0.8, 0.42, 0.7], 0.055),
      cylinder([0, 0.49, 0], [0.34, 0.1, 0.34], 14),
      box([0, 0.51, 0.22], [0.5, 0.035, 0.06]),
    ],
    "circuit-overview-constant-cabinet-geometry",
  );
  const overviewArithmetic = mergeOwned(
    [
      roundedBox([0, 0.23, 0], [0.8, 0.42, 0.7], 0.055),
      cylinder([-0.19, 0.49, 0], [0.27, 0.1, 0.27], 12),
      cylinder([0.19, 0.49, 0], [0.27, 0.1, 0.27], 12),
      box([0, 0.51, -0.23], [0.54, 0.035, 0.05]),
    ],
    "circuit-overview-arithmetic-cabinet-geometry",
  );
  const overviewDecider = mergeOwned(
    [
      roundedBox([0, 0.23, 0], [0.8, 0.42, 0.7], 0.055),
      box([-0.19, 0.49, 0], [0.25, 0.1, 0.46]),
      box([0.19, 0.49, 0], [0.25, 0.1, 0.46]),
      box([0, 0.55, 0], [0.58, 0.035, 0.055]),
    ],
    "circuit-overview-decider-cabinet-geometry",
  );
  const endpointBase = mergeOwned(
    [
      roundedBox([0, 0, 0], [0.3, 0.075, 0.2], 0.025),
      box([-0.125, -0.045, 0], [0.055, 0.075, 0.16]),
      box([0.125, -0.045, 0], [0.055, 0.075, 0.16]),
      cylinder([-0.11, 0.045, -0.07], [0.025, 0.035, 0.025], 8),
      cylinder([0.11, 0.045, -0.07], [0.025, 0.035, 0.025], 8),
      cylinder([-0.11, 0.045, 0.07], [0.025, 0.035, 0.025], 8),
      cylinder([0.11, 0.045, 0.07], [0.025, 0.035, 0.025], 8),
    ],
    "circuit-bolted-read-write-connector-module-geometry",
  );
  const junction = mergeOwned(
    [
      roundedBox([0, 0, 0], [0.17, 0.07, 0.14], 0.02),
      cylinder([0, 0.055, 0], [0.06, 0.045, 0.06], 10),
      box([-0.065, -0.045, 0], [0.035, 0.07, 0.11]),
      box([0.065, -0.045, 0], [0.035, 0.07, 0.11]),
    ],
    "circuit-covered-branch-terminal-geometry",
  );
  const machineClamp = mergeOwned(
    [
      roundedBox([0, 0, 0], [0.46, 0.15, 0.34], 0.035),
      box([0, -0.095, 0], [0.55, 0.055, 0.42]),
      box([-0.24, -0.14, 0], [0.08, 0.12, 0.27]),
      box([0.24, -0.14, 0], [0.08, 0.12, 0.27]),
      cylinder([-0.185, 0.095, -0.12], [0.035, 0.035, 0.035], 8),
      cylinder([0.185, 0.095, -0.12], [0.035, 0.035, 0.035], 8),
      cylinder([-0.185, 0.095, 0.12], [0.035, 0.035, 0.035], 8),
      cylinder([0.185, 0.095, 0.12], [0.035, 0.035, 0.035], 8),
    ],
    "circuit-machine-bolted-control-junction-geometry",
  );
  const geometriesWithoutList = {
    rigBase,
    constantHousing,
    constantMetal,
    arithmeticHousing,
    arithmeticMetal,
    deciderHousing,
    deciderMetal,
    overviewConstant,
    overviewArithmetic,
    overviewDecider,
    indexingDrum: createIndexingDrumGeometry(),
    signalKey: mergeOwned(
      [
        roundedBox([0, 0, 0], [0.07, 0.15, 0.07], 0.018),
        cylinder([0, 0.095, 0], [0.085, 0.04, 0.085], 10),
      ],
      "circuit-constant-recessed-setpoint-key-geometry",
    ),
    gear: createGearGeometry(),
    operatorArm: mergeOwned(
      [
        roundedBox([0, 0, 0], [0.18, 0.03, 0.038], 0.01),
        cylinder([0.075, 0.014, 0], [0.046, 0.024, 0.046], 10),
      ],
      "circuit-arithmetic-meter-needle-geometry",
    ),
    balanceBeam: mergeOwned(
      [
        roundedBox([0, 0, 0], [0.54, 0.045, 0.065], 0.018),
        box([-0.235, -0.052, 0], [0.11, 0.085, 0.11]),
        box([0.235, -0.052, 0], [0.11, 0.085, 0.11]),
        cylinder([0, -0.04, 0], [0.07, 0.09, 0.07], 10),
      ],
      "circuit-decider-armature-balance-beam-geometry",
    ),
    gateLeaf: mergeOwned(
      [
        roundedBox([0, 0, 0], [0.2, 0.06, 0.25], 0.025),
        box([0, 0.035, 0], [0.14, 0.018, 0.19]),
      ],
      "circuit-decider-macro-readable-comparator-gate-leaf-geometry",
    ),
    cabinetFaceHardware: mergeOwned(
      [
        box([0, 0, -0.235], [0.58, 0.024, 0.026]),
        box([0, 0, 0.235], [0.58, 0.024, 0.026]),
        box([-0.29, 0, 0], [0.026, 0.024, 0.47]),
        box([0.29, 0, 0], [0.026, 0.024, 0.47]),
        box([0, 0.014, -0.105], [0.21, 0.026, 0.026]),
        box([0, 0.014, 0.105], [0.21, 0.026, 0.026]),
        box([-0.105, 0.014, 0], [0.026, 0.026, 0.21]),
        box([0.105, 0.014, 0], [0.026, 0.026, 0.21]),
        cylinder([0.245, 0.018, 0.18], [0.045, 0.025, 0.045], 10),
        box([0.235, 0.034, 0.1], [0.045, 0.026, 0.14]),
        cylinder([-0.245, 0.018, -0.18], [0.032, 0.024, 0.032], 8),
        cylinder([0.245, 0.018, -0.18], [0.032, 0.024, 0.032], 8),
      ],
      "circuit-engraved-inspection-bezel-latch-and-fasteners-geometry",
    ),
    statusLens: new THREE.SphereGeometry(0.033, 12, 8),
    meterWell: mergeOwned(
      [
        roundedBox([0, 0, 0], [0.69, 0.038, 0.3], 0.025),
        box([0, 0.018, -0.154], [0.71, 0.032, 0.025]),
        box([0, 0.018, 0.154], [0.71, 0.032, 0.025]),
        box([-0.355, 0.018, 0], [0.025, 0.032, 0.28]),
        box([0.355, 0.018, 0], [0.025, 0.032, 0.28]),
      ],
      "circuit-integrated-electromechanical-readout-well-geometry",
    ),
    meterScreen: box(
      [0, 0, 0],
      [0.64, 0.012, 0.25],
    ),
    endpointBase,
    endpointCollar: mergeOwned(
      [
        cylinder([0, 0, 0], [0.095, 0.075, 0.095], 10),
        cylinder([0, 0.04, 0], [0.116, 0.025, 0.116], 10),
        box([0, 0.06, 0], [0.13, 0.026, 0.065]),
      ],
      "circuit-color-coded-cable-gland-geometry",
    ),
    endpointInsulator: mergeOwned(
      [
        cylinder([0, 0, 0], [0.125, 0.045, 0.125], 12),
        cylinder([0, 0.035, 0], [0.105, 0.038, 0.105], 12),
        cylinder([0, 0.068, 0], [0.086, 0.034, 0.086], 12),
      ],
      "circuit-stepped-ceramic-terminal-insulator-geometry",
    ),
    endpointStrainRelief: mergeOwned(
      [
        cylinder([0, 0, 0], [0.06, 0.085, 0.06], 10),
        cylinder([0, 0.04, 0], [0.071, 0.025, 0.071], 10),
        cylinder([0, -0.04, 0], [0.077, 0.022, 0.077], 10),
      ],
      "circuit-flexible-cable-strain-relief-geometry",
    ),
    endpointFerrule: mergeOwned(
      [
        cylinder([0, 0, 0], [0.074, 0.045, 0.074], 12),
        cylinder([0, 0.028, 0], [0.054, 0.032, 0.054], 12),
        box([-0.052, -0.002, 0], [0.024, 0.058, 0.088]),
        box([0.052, -0.002, 0], [0.024, 0.058, 0.088]),
      ],
      "circuit-positive-cable-ferrule-and-clamp-jaw-geometry",
    ),
    junction,
    machineClamp,
    machineLever: mergeOwned(
      [
        roundedBox([0, 0, 0], [0.38, 0.055, 0.075], 0.018),
        cylinder([0.17, 0.04, 0], [0.095, 0.08, 0.095], 12),
        cylinder([-0.17, -0.02, 0], [0.075, 0.06, 0.075], 10),
      ],
      "circuit-machine-positive-action-switch-geometry",
    ),
    routeLamp: new THREE.SphereGeometry(0.026, 10, 7),
    wireOuter: createSaggingWireGeometry(
      0.0155,
      "circuit-thin-span-scaled-insulated-cable-geometry",
    ),
    machineUmbilical: createSaggingWireGeometry(
      0.037,
      "circuit-machine-armored-control-umbilical-geometry",
    ),
    servicePad: mergeOwned(
      [
        roundedBox([0, 0.018, -0.43], [1.12, 0.036, 0.13], 0.025),
        roundedBox([0, 0.018, 0.43], [1.12, 0.036, 0.13], 0.025),
        box([-0.49, 0.035, 0], [0.09, 0.035, 0.74]),
        box([0.49, 0.035, 0], [0.09, 0.035, 0.74]),
        box([0, 0.028, 0], [0.32, 0.045, 0.12]),
      ],
      "circuit-grounded-service-sleeper-and-drain-frame-geometry",
    ),
    serviceStripe: mergeOwned(
      [
        box([-0.48, 0.06, -0.47], [0.15, 0.018, 0.055]),
        box([-0.16, 0.06, -0.47], [0.15, 0.018, 0.055]),
        box([0.16, 0.06, -0.47], [0.15, 0.018, 0.055]),
        box([0.48, 0.06, -0.47], [0.15, 0.018, 0.055]),
      ],
      "circuit-worn-service-pad-safety-stripe-geometry",
    ),
    cableSupport: mergeOwned(
      [
        roundedBox([0, 0.025, 0], [0.28, 0.05, 0.22], 0.025),
        box([-0.065, 0.24, 0], [0.045, 0.43, 0.045], [0, 0, -0.17]),
        box([0.065, 0.24, 0], [0.045, 0.43, 0.045], [0, 0, 0.17]),
        box([0, 0.455, 0], [0.34, 0.055, 0.09]),
      ],
      "circuit-grounded-twin-saddle-cable-support-geometry",
    ),
    cableClip: mergeOwned(
      [
        box([0, -0.018, 0], [0.18, 0.026, 0.05]),
        box([-0.075, 0.025, 0], [0.028, 0.085, 0.05]),
        box([0.075, 0.025, 0], [0.028, 0.085, 0.05]),
      ],
      "circuit-color-keyed-midspan-cable-seat-clip-geometry",
    ),
    groundWear: transformGeometry(
      new THREE.CircleGeometry(0.5, 24),
      [0, 0, 0],
      [1, 1, 1],
      [-Math.PI / 2, 0, 0],
    ),
    districtGrating: mergeOwned(
      [
        box([0, 0.045, -0.46], [1.08, 0.055, 0.055]),
        box([0, 0.045, 0.46], [1.08, 0.055, 0.055]),
        box([-0.51, 0.045, 0], [0.055, 0.055, 0.92]),
        box([0.51, 0.045, 0], [0.055, 0.055, 0.92]),
        ...Array.from({ length: 9 }, (_, index) =>
          box(
            [-0.4 + index * 0.1, 0.052, 0],
            [0.025, 0.035, 0.82],
          ),
        ),
      ],
      "circuit-district-open-steel-service-grating-geometry",
    ),
    districtDeckSlab: mergeOwned(
      [
        roundedBox([0, 0, 0], [1.08, 0.055, 1], 0.035),
        box([-0.5, 0.04, 0], [0.07, 0.035, 1]),
        box([0.5, 0.04, 0], [0.07, 0.035, 1]),
      ],
      "circuit-continuous-bolted-control-cell-deck-slab-geometry",
    ),
    districtDeckGrating: mergeOwned(
      [
        ...Array.from({ length: 7 }, (_, index) =>
          box(
            [0, 0, -0.45 + index * 0.15],
            [0.94, 0.026, 0.045],
          ),
        ),
        box([-0.45, 0, 0], [0.035, 0.03, 1]),
        box([0.45, 0, 0], [0.035, 0.03, 1]),
      ],
      "circuit-continuous-control-cell-drain-grating-geometry",
    ),
    districtPipeRack: mergeOwned(
      [
        box([-0.48, 0.09, -0.43], [0.055, 0.14, 0.055]),
        box([0.48, 0.09, -0.43], [0.055, 0.14, 0.055]),
        box([0, 0.16, -0.43], [1.02, 0.055, 0.055]),
        cylinder(
          [-0.18, 0.2, -0.43],
          [0.06, 0.95, 0.06],
          12,
          [0, 0, Math.PI / 2],
        ),
        cylinder(
          [0.18, 0.25, -0.43],
          [0.052, 0.95, 0.052],
          12,
          [0, 0, Math.PI / 2],
        ),
        box([-0.48, 0.08, -0.43], [0.18, 0.08, 0.18]),
        box([0.48, 0.08, -0.43], [0.18, 0.08, 0.18]),
      ],
      "circuit-district-grounded-service-pipe-rack-geometry",
    ),
    districtPowerModule: mergeOwned(
      [
        roundedBox([0, 0.24, 0], [0.42, 0.34, 0.38], 0.04),
        cylinder([-0.15, 0.46, 0], [0.11, 0.18, 0.11], 12),
        cylinder([0.15, 0.46, 0], [0.11, 0.18, 0.11], 12),
        box([0, 0.06, 0], [0.56, 0.08, 0.5]),
        cylinder([-0.2, 0.1, -0.18], [0.045, 0.05, 0.045], 10),
        cylinder([0.2, 0.1, -0.18], [0.045, 0.05, 0.045], 10),
        cylinder([-0.2, 0.1, 0.18], [0.045, 0.05, 0.045], 10),
        cylinder([0.2, 0.1, 0.18], [0.045, 0.05, 0.045], 10),
      ],
      "circuit-district-oil-cooled-control-transformer-geometry",
    ),
    districtCableTray: mergeOwned(
      [
        box([-0.075, 0, 0], [0.025, 0.06, 1]),
        box([0.075, 0, 0], [0.025, 0.06, 1]),
        box([0, -0.02, 0], [0.16, 0.025, 1]),
      ],
      "circuit-district-perforated-cable-tray-route-geometry",
    ),
    districtProcessHeader: mergeOwned(
      [
        cylinder(
          [-0.075, 0, 0],
          [0.036, 1, 0.036],
          10,
          [Math.PI / 2, 0, 0],
        ),
        cylinder(
          [0.075, 0, 0],
          [0.028, 1, 0.028],
          10,
          [Math.PI / 2, 0, 0],
        ),
      ],
      "circuit-district-twin-process-service-header-geometry",
    ),
    districtFieldDeck: mergeOwned(
      [
        roundedBox([0, 0.026, 0], [1.72, 0.052, 1.08], 0.045),
        box([-0.79, 0.06, 0], [0.08, 0.034, 0.96]),
        box([0.79, 0.06, 0], [0.08, 0.034, 0.96]),
        box([0, 0.06, -0.48], [1.48, 0.034, 0.07]),
        box([0, 0.06, 0.48], [1.48, 0.034, 0.07]),
        ...[
          [-0.7, -0.42],
          [0.7, -0.42],
          [-0.7, 0.42],
          [0.7, 0.42],
        ].map(([x, z]) =>
          cylinder([x!, 0.085, z!], [0.055, 0.026, 0.055], 10),
        ),
      ],
      "circuit-district-interlocked-foundation-deck-geometry",
    ),
    districtFieldGrating: mergeOwned(
      [
        ...Array.from({ length: 9 }, (_, index) =>
          box(
            [-0.68 + index * 0.17, 0, 0],
            [0.035, 0.025, 0.8],
          ),
        ),
        box([0, 0.002, -0.42], [1.48, 0.03, 0.04]),
        box([0, 0.002, 0.42], [1.48, 0.03, 0.04]),
      ],
      "circuit-district-open-crossflow-grating-geometry",
    ),
    districtProcessPod: mergeOwned(
      [
        roundedBox([0, 0.09, 0], [1.08, 0.15, 0.72], 0.045),
        cylinder([-0.27, 0.34, 0], [0.34, 0.48, 0.34], 18),
        cylinder([0.27, 0.34, 0], [0.34, 0.48, 0.34], 18),
        cylinder([-0.27, 0.59, 0], [0.42, 0.07, 0.42], 18),
        cylinder([0.27, 0.59, 0], [0.42, 0.07, 0.42], 18),
        box([-0.5, 0.2, 0], [0.1, 0.3, 0.58]),
        box([0.5, 0.2, 0], [0.1, 0.3, 0.58]),
      ],
      "circuit-district-twin-accumulator-process-pod-geometry",
    ),
    districtProcessPodTrim: mergeOwned(
      [
        torus([-0.27, 0.605, 0], [0.42, 0.12, 0.42]),
        torus([0.27, 0.605, 0], [0.42, 0.12, 0.42]),
        cylinder(
          [0, 0.31, -0.24],
          [0.07, 0.62, 0.07],
          12,
          [0, 0, Math.PI / 2],
        ),
        cylinder(
          [0, 0.31, 0.24],
          [0.055, 0.62, 0.055],
          12,
          [0, 0, Math.PI / 2],
        ),
        box([0, 0.17, 0], [0.72, 0.05, 0.055]),
      ],
      "circuit-district-accumulator-bands-and-manifold-geometry",
    ),
    districtCoolingModule: mergeOwned(
      [
        roundedBox([0, 0.1, 0], [1.02, 0.16, 0.82], 0.05),
        cylinder([0, 0.23, 0], [0.72, 0.16, 0.72], 24),
        cylinder([0, 0.33, 0], [0.52, 0.08, 0.52], 24),
        box([-0.48, 0.2, 0], [0.09, 0.32, 0.66]),
        box([0.48, 0.2, 0], [0.09, 0.32, 0.66]),
        box([0, 0.2, -0.38], [0.82, 0.32, 0.07]),
        box([0, 0.2, 0.38], [0.82, 0.32, 0.07]),
      ],
      "circuit-district-ducted-cooling-cell-geometry",
    ),
    districtCoolingRotor: mergeOwned(
      [
        cylinder([0, 0, 0], [0.16, 0.065, 0.16], 14),
        ...Array.from({ length: 8 }, (_, index) =>
          box(
            [
              Math.cos((index / 8) * Math.PI * 2) * 0.21,
              0,
              Math.sin((index / 8) * Math.PI * 2) * 0.21,
            ],
            [0.32, 0.05, 0.095],
            [0, -(index / 8) * Math.PI * 2, 0],
          ),
        ),
      ],
      "circuit-district-eight-blade-cooling-rotor-geometry",
    ),
    districtPerimeterRail: mergeOwned(
      [
        box([-0.72, 0.25, 0], [0.055, 0.48, 0.055]),
        box([0.72, 0.25, 0], [0.055, 0.48, 0.055]),
        box([0, 0.48, 0], [1.48, 0.055, 0.055]),
        box([0, 0.27, 0], [1.48, 0.04, 0.04]),
        box([-0.72, 0.045, 0], [0.16, 0.07, 0.18]),
        box([0.72, 0.045, 0], [0.16, 0.07, 0.18]),
      ],
      "circuit-district-grounded-double-course-safety-rail-geometry",
    ),
    districtValveCluster: mergeOwned(
      [
        roundedBox([0, 0.075, 0], [0.58, 0.12, 0.46], 0.035),
        cylinder([-0.16, 0.25, 0], [0.15, 0.34, 0.15], 14),
        cylinder([0.16, 0.25, 0], [0.15, 0.34, 0.15], 14),
        torus([-0.16, 0.46, 0], [0.29, 0.08, 0.29]),
        torus([0.16, 0.46, 0], [0.29, 0.08, 0.29]),
        cylinder(
          [0, 0.2, 0],
          [0.065, 0.48, 0.065],
          12,
          [0, 0, Math.PI / 2],
        ),
      ],
      "circuit-district-twin-handwheel-valve-cluster-geometry",
    ),
    machineProcessSkid: mergeOwned(
      [
        box([0, 0.08, -0.73], [1.72, 0.1, 0.1]),
        box([0, 0.08, 0.73], [1.72, 0.1, 0.1]),
        box([-0.81, 0.08, 0], [0.1, 0.1, 1.36]),
        box([0.81, 0.08, 0], [0.1, 0.1, 1.36]),
        box([-0.72, 0.04, -0.65], [0.28, 0.07, 0.24]),
        box([0.72, 0.04, -0.65], [0.28, 0.07, 0.24]),
        box([-0.72, 0.04, 0.65], [0.28, 0.07, 0.24]),
        box([0.72, 0.04, 0.65], [0.28, 0.07, 0.24]),
      ],
      "circuit-machine-integrated-production-drive-skid-geometry",
    ),
    machineFlywheel: mergeOwned(
      [
        torus([0, 0, 0], [0.58, 0.12, 0.58]),
        cylinder([0, 0.04, 0], [0.13, 0.12, 0.13], 14),
        box([0, 0.07, 0], [0.52, 0.055, 0.065]),
        box([0, 0.07, 0], [0.065, 0.055, 0.52]),
        box([0, 0.07, 0], [0.42, 0.05, 0.055], [0, Math.PI / 4, 0]),
        box([0, 0.07, 0], [0.42, 0.05, 0.055], [0, -Math.PI / 4, 0]),
      ],
      "circuit-machine-authoritative-driven-flywheel-geometry",
    ),
    machineCrank: mergeOwned(
      [
        box([0.16, 0, 0], [0.36, 0.07, 0.08]),
        cylinder([0.34, 0.025, 0], [0.12, 0.09, 0.12], 12),
        cylinder([0, 0.025, 0], [0.1, 0.09, 0.1], 12),
      ],
      "circuit-machine-positive-drive-crank-geometry",
    ),
    machinePiston: mergeOwned(
      [
        cylinder(
          [0, 0, 0],
          [0.12, 0.68, 0.12],
          14,
          [0, 0, Math.PI / 2],
        ),
        cylinder(
          [-0.34, 0, 0],
          [0.2, 0.12, 0.2],
          14,
          [0, 0, Math.PI / 2],
        ),
      ],
      "circuit-machine-reciprocating-process-ram-geometry",
    ),
    machineProductChute: mergeOwned(
      [
        box([0, 0, 0], [0.58, 0.055, 0.72]),
        box([-0.31, 0.07, 0], [0.055, 0.14, 0.72]),
        box([0.31, 0.07, 0], [0.055, 0.14, 0.72]),
        ...Array.from({ length: 5 }, (_, index) =>
          cylinder(
            [0, 0.055, -0.28 + index * 0.14],
            [0.055, 0.54, 0.055],
            10,
            [0, 0, Math.PI / 2],
          ),
        ),
      ],
      "circuit-machine-open-material-output-chute-geometry",
    ),
    machineProduct: mergeOwned(
      [
        roundedBox([0, 0, 0], [0.22, 0.09, 0.16], 0.025),
        box([0, 0.055, 0], [0.15, 0.025, 0.1]),
      ],
      "circuit-machine-visible-hot-product-billet-geometry",
    ),
    machineExhaustStack: mergeOwned(
      [
        cylinder([0, 0.42, 0], [0.16, 0.82, 0.16], 14),
        cylinder([0, 0.83, 0], [0.23, 0.08, 0.23], 14),
        cylinder([0, 0.16, 0], [0.24, 0.09, 0.24], 14),
        box([0.09, 0.9, 0], [0.28, 0.045, 0.22], [0, 0, -0.24]),
      ],
      "circuit-machine-connected-process-exhaust-stack-geometry",
    ),
    machineHeatBank: mergeOwned(
      [
        roundedBox([0, 0, 0], [0.5, 0.08, 0.26], 0.025),
        ...Array.from({ length: 5 }, (_, index) =>
          box(
            [-0.18 + index * 0.09, 0.055, 0],
            [0.035, 0.035, 0.2],
          ),
        ),
      ],
      "circuit-machine-authoritative-process-heat-bank-geometry",
    ),
    machineProcessCore: mergeOwned(
      [
        cylinder([0, 0, 0], [0.82, 0.13, 0.82], 28),
        torus([0, 0.08, 0], [0.84, 0.16, 0.84]),
        cylinder([0, 0.12, 0], [0.34, 0.1, 0.34], 18),
        ...Array.from({ length: 8 }, (_, index) =>
          box(
            [
              Math.cos((index / 8) * Math.PI * 2) * 0.29,
              0.17,
              Math.sin((index / 8) * Math.PI * 2) * 0.29,
            ],
            [0.21, 0.055, 0.08],
            [0, -(index / 8) * Math.PI * 2, 0],
          ),
        ),
      ],
      "circuit-machine-large-open-process-core-geometry",
    ),
    machineGuardShutter: mergeOwned(
      [
        roundedBox([0, 0, 0], [0.5, 0.075, 0.72], 0.035),
        ...Array.from({ length: 4 }, (_, index) =>
          box(
            [-0.18 + index * 0.12, 0.052, 0],
            [0.045, 0.035, 0.58],
          ),
        ),
        box([0.2, 0.065, 0], [0.065, 0.045, 0.62]),
      ],
      "circuit-machine-macro-readable-sliding-guard-shutter-geometry",
    ),
    machineOutputRoller: mergeOwned(
      [
        cylinder(
          [0, 0, 0],
          [0.1, 0.54, 0.1],
          14,
          [0, 0, Math.PI / 2],
        ),
        cylinder(
          [-0.27, 0, 0],
          [0.15, 0.06, 0.15],
          14,
          [0, 0, Math.PI / 2],
        ),
        cylinder(
          [0.27, 0, 0],
          [0.15, 0.06, 0.15],
          14,
          [0, 0, Math.PI / 2],
        ),
      ],
      "circuit-machine-driven-output-roller-geometry",
    ),
  };
  const all = Object.freeze(
    Object.values(geometriesWithoutList) as THREE.BufferGeometry[],
  );
  for (const geometry of all) {
    if (!geometry.name) {
      geometry.name = `circuit-owned-${all.indexOf(geometry)}`;
    }
    geometry.computeBoundingSphere();
  }
  return Object.freeze({
    ...geometriesWithoutList,
    all,
  });
}

function standardMaterial(
  name: string,
  color: THREE.ColorRepresentation,
  roughness: number,
  metalness: number,
  emissive?: THREE.ColorRepresentation,
  emissiveIntensity = 0,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    ...(emissive === undefined
      ? {}
      : { emissive, emissiveIntensity }),
  });
  material.name = name;
  return material;
}

function createCircuitWearTexture(): THREE.Texture {
  let texture: THREE.Texture;
  if (typeof document !== "undefined") {
    texture = new THREE.TextureLoader().load(
      "/assets/cinder-painted-steel-aged-v2.png",
    );
  } else {
    // Node-based renderer tests have no Image element. The deterministic
    // fallback preserves ownership and material behavior without faking DOM.
    const pixels = new Uint8Array([
      77, 91, 88, 255, 65, 78, 76, 255,
      91, 101, 95, 255, 55, 69, 68, 255,
    ]);
    texture = new THREE.DataTexture(pixels, 2, 2, THREE.RGBAFormat);
    texture.needsUpdate = true;
  }
  texture.name = "circuit-authored-cinder-aged-painted-steel-surface";
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.65, 1.65);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.userData.authoredAsset =
    "/assets/cinder-painted-steel-aged-v2.png";
  texture.userData.presentationRole =
    "localized-aged-cast-control-cabinet-surface";
  return texture;
}

function createProcessVaporTexture(): THREE.DataTexture {
  const size = 48;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const normalizedX = (x + 0.5) / size * 2 - 1;
      const normalizedY = (y + 0.5) / size * 2 - 1;
      const radius = Math.hypot(normalizedX, normalizedY);
      const turbulence =
        Math.sin(x * 1.71 + y * 0.63) * 0.055 +
        Math.sin(x * 0.31 - y * 1.17) * 0.045;
      const alpha = THREE.MathUtils.clamp(
        1 - radius * 1.08 + turbulence,
        0,
        1,
      );
      const offset = (y * size + x) * 4;
      pixels[offset] = 218;
      pixels[offset + 1] = 226;
      pixels[offset + 2] = 216;
      pixels[offset + 3] = Math.round(alpha * alpha * 170);
    }
  }
  const texture = new THREE.DataTexture(
    pixels,
    size,
    size,
    THREE.RGBAFormat,
  );
  texture.name = "circuit-machine-soft-authoritative-process-vapor";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createMeterReadoutTexture(
  kind: CircuitEntityKind,
): THREE.Texture {
  let texture: THREE.Texture;
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width =
      kind === "constantCombinator"
        ? 600
        : kind === "arithmeticCombinator"
          ? 840
          : 1_050;
    canvas.height = 300;
    texture = new THREE.CanvasTexture(canvas);
    texture.userData.canvas = canvas;
  } else {
    const pixels = new Uint8Array([
      13, 18, 17, 255, 21, 28, 25, 255,
      18, 23, 21, 255, 10, 14, 13, 255,
    ]);
    texture = new THREE.DataTexture(pixels, 2, 2, THREE.RGBAFormat);
    texture.needsUpdate = true;
  }
  texture.name = "circuit-dynamic-authoritative-cabinet-readout";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 8;
  texture.userData.dynamicAuthoritativeInstrument = true;
  return texture;
}

function createMaterials(): CircuitMaterials {
  const cabinetWear = createCircuitWearTexture();
  const cabinetResponse = cabinetWear.clone();
  cabinetResponse.name =
    "circuit-authored-aged-painted-steel-roughness-and-bump-response";
  cabinetResponse.colorSpace = THREE.NoColorSpace;
  cabinetResponse.needsUpdate = true;
  cabinetResponse.userData = {
    ...cabinetWear.userData,
    presentationRole: "cabinet-scale-roughness-bump-response",
  };
  const processVaporTexture = createProcessVaporTexture();
  const materialsWithoutList = {
    foundation: standardMaterial(
      "circuit-oil-darkened-cast-foundation-material",
      0x58605d,
      0.83,
      0.38,
    ),
    armor: standardMaterial(
      "circuit-weathered-control-armor-material",
      0x515b57,
      0.68,
      0.58,
    ),
    darkMetal: standardMaterial(
      "circuit-blackened-cast-metal-material",
      0x202726,
      0.76,
      0.48,
    ),
    titanium: standardMaterial(
      "circuit-machined-edge-and-fastener-material",
      0x727b77,
      0.43,
      0.72,
    ),
    bronze: standardMaterial(
      "circuit-aged-bronze-mechanism-material",
      0x9c6738,
      0.54,
      0.67,
    ),
    copper: standardMaterial(
      "circuit-oxidized-copper-busbar-material",
      0x8f5537,
      0.57,
      0.7,
    ),
    rust: standardMaterial(
      "circuit-localized-rust-and-service-wear-material",
      0x6b3825,
      0.92,
      0.18,
    ),
    rubber: standardMaterial(
      "circuit-flexible-black-cable-boot-material",
      0x171b1b,
      0.96,
      0.03,
    ),
    ceramic: standardMaterial(
      "circuit-aged-ceramic-insulator-material",
      0xc6c2a9,
      0.86,
      0.05,
    ),
    meterGlass: Object.assign(
      new THREE.MeshPhysicalMaterial({
        color: 0x536a67,
        roughness: 0.22,
        metalness: 0.04,
        transmission: 0.08,
        thickness: 0.04,
        transparent: true,
        opacity: 0.3,
        clearcoat: 0.55,
        clearcoatRoughness: 0.3,
      }),
      { name: "circuit-smoked-meter-glass-material" },
    ),
    meterFace: standardMaterial(
      "circuit-recessed-meter-face-material",
      0x202a28,
      0.76,
      0.25,
    ),
    constantHousing: standardMaterial(
      "circuit-constant-aged-ochre-painted-cast-material",
      0x777044,
      0.78,
      0.3,
    ),
    arithmeticHousing: standardMaterial(
      "circuit-arithmetic-aged-oxide-painted-cast-material",
      0x7e4e34,
      0.76,
      0.33,
    ),
    deciderHousing: standardMaterial(
      "circuit-decider-aged-sage-painted-cast-material",
      0x436e68,
      0.76,
      0.31,
    ),
    constantAccent: standardMaterial(
      "circuit-constant-restrained-amber-indicator-material",
      0xd4bd65,
      0.42,
      0.27,
      0x5a4810,
      0.42,
    ),
    arithmeticAccent: standardMaterial(
      "circuit-arithmetic-restrained-orange-indicator-material",
      0xd2854d,
      0.42,
      0.28,
      0x632609,
      0.44,
    ),
    deciderAccent: standardMaterial(
      "circuit-decider-restrained-cyan-indicator-material",
      0x6eb6aa,
      0.4,
      0.25,
      0x164b43,
      0.46,
    ),
    wireRed: standardMaterial(
      "circuit-red-matte-insulated-cable-jacket-material",
      0x9a3438,
      0.82,
      0.08,
    ),
    wireGreen: standardMaterial(
      "circuit-green-matte-insulated-cable-jacket-material",
      0x287b50,
      0.82,
      0.08,
    ),
    tracerRed: standardMaterial(
      "circuit-red-connector-identification-band-material",
      0xa84945,
      0.72,
      0.08,
    ),
    tracerGreen: standardMaterial(
      "circuit-green-connector-identification-band-material",
      0x3f8b5d,
      0.72,
      0.08,
    ),
    signalItem: standardMaterial(
      "circuit-item-meter-marking-material",
      0xb78d56,
      0.52,
      0.18,
    ),
    signalFluid: standardMaterial(
      "circuit-fluid-meter-marking-material",
      0x548ba0,
      0.5,
      0.16,
    ),
    signalVirtual: standardMaterial(
      "circuit-virtual-meter-marking-material",
      0x826c95,
      0.5,
      0.16,
    ),
    active: standardMaterial(
      "circuit-active-restrained-green-lens-material",
      0x6bc497,
      0.38,
      0.08,
      0x155a38,
      0.75,
    ),
    idle: standardMaterial(
      "circuit-idle-restrained-amber-lens-material",
      0xc2924b,
      0.46,
      0.12,
      0x57330b,
      0.46,
    ),
    warning: standardMaterial(
      "circuit-warning-restrained-red-lens-material",
      0xbc5448,
      0.44,
      0.1,
      0x5b160f,
      0.8,
    ),
    disabled: standardMaterial(
      "circuit-disabled-cold-metal-material",
      0x424a48,
      0.82,
      0.32,
    ),
    guardClosed: standardMaterial(
      "circuit-dark-weathered-red-machine-guard-material",
      0x653932,
      0.9,
      0.36,
    ),
    serviceConcrete: standardMaterial(
      "circuit-oil-stained-service-pad-material",
      0x3f4442,
      0.94,
      0.18,
    ),
    safetyPaint: standardMaterial(
      "circuit-worn-ochre-safety-marking-material",
      0x75562b,
      0.84,
      0.16,
    ),
    groundWear: standardMaterial(
      "circuit-grounding-oil-and-foot-traffic-wear-material",
      0x211b16,
      1,
      0,
    ),
    instrumentAmber: standardMaterial(
      "circuit-electromechanical-amber-meter-pixel-material",
      0xf0c45f,
      0.34,
      0.18,
      0x9a540b,
      0.54,
    ),
    instrumentGreen: standardMaterial(
      "circuit-electromechanical-green-output-pixel-material",
      0x79d99e,
      0.32,
      0.14,
      0x1a7140,
      0.62,
    ),
    instrumentRed: standardMaterial(
      "circuit-electromechanical-red-trip-pixel-material",
      0xd16455,
      0.4,
      0.14,
      0x6d160f,
      0.72,
    ),
    processHot: standardMaterial(
      "circuit-machine-hot-working-process-bank-material",
      0xf09a45,
      0.42,
      0.42,
      0xb5410a,
      1.15,
    ),
    processCold: standardMaterial(
      "circuit-machine-cold-stopped-process-bank-material",
      0x2a302f,
      0.88,
      0.48,
    ),
    processProduct: standardMaterial(
      "circuit-machine-visible-copper-product-material",
      0xc56c35,
      0.48,
      0.68,
      0x4e1605,
      0.24,
    ),
    districtEnamel: standardMaterial(
      "circuit-district-deep-petrol-service-enamel-material",
      0x294c4c,
      0.8,
      0.38,
    ),
    districtCoolant: standardMaterial(
      "circuit-district-aged-coolant-pipe-material",
      0x39786e,
      0.6,
      0.48,
      0x0d312b,
      0.18,
    ),
    districtGuard: standardMaterial(
      "circuit-district-worn-ochre-guard-material",
      0x95602e,
      0.76,
      0.34,
    ),
    processVapor: Object.assign(
      new THREE.SpriteMaterial({
        map: processVaporTexture,
        color: 0xd9e1d8,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
        blending: THREE.NormalBlending,
      }),
      { name: "circuit-machine-soft-process-exhaust-material" },
    ),
  };
  materialsWithoutList.groundWear.transparent = true;
  materialsWithoutList.groundWear.opacity = 0.46;
  materialsWithoutList.groundWear.depthWrite = false;
  materialsWithoutList.groundWear.polygonOffset = true;
  materialsWithoutList.groundWear.polygonOffsetFactor = -1;
  for (const material of [
    materialsWithoutList.foundation,
    materialsWithoutList.armor,
    materialsWithoutList.guardClosed,
    materialsWithoutList.serviceConcrete,
    materialsWithoutList.districtEnamel,
    materialsWithoutList.districtCoolant,
    materialsWithoutList.districtGuard,
  ]) {
    material.bumpMap = cabinetResponse;
    material.roughnessMap = cabinetResponse;
    material.bumpScale = 0.022;
    material.userData.authoredSurface =
      "cinder-aged-painted-steel-v2-cabinet-scale";
    material.needsUpdate = true;
  }
  for (const material of [
    materialsWithoutList.constantHousing,
    materialsWithoutList.arithmeticHousing,
    materialsWithoutList.deciderHousing,
  ]) {
    material.bumpMap = cabinetResponse;
    material.roughnessMap = cabinetResponse;
    material.bumpScale = 0.028;
    material.roughness = 1;
    material.userData.authoredSurface =
      "cinder-aged-painted-steel-v2-cabinet-scale";
    material.needsUpdate = true;
  }
  materialsWithoutList.wireRed.emissive.set(0x000000);
  materialsWithoutList.wireRed.emissiveIntensity = 0;
  materialsWithoutList.wireGreen.emissive.set(0x000000);
  materialsWithoutList.wireGreen.emissiveIntensity = 0;
  return Object.freeze({
    ...materialsWithoutList,
    all: Object.freeze(
      Object.values(materialsWithoutList) as THREE.Material[],
    ),
    textures: Object.freeze([
      cabinetWear,
      cabinetResponse,
      processVaporTexture,
    ]),
  });
}

function fnv1a(parts: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= part.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function signalKey(signal: CircuitSignal): string {
  return `${signal.type}:${signal.name}`;
}

function strongestSignalEntry(
  frame: CircuitFrame,
): CircuitFrame[number] | null {
  return (
    [...frame].sort(
      (left, right) =>
        Math.abs(right.value) - Math.abs(left.value) ||
        compareText(signalKey(left.signal), signalKey(right.signal)),
    )[0] ?? null
  );
}

function machinePortConfigured(
  port: CircuitSimulationSnapshot["machinePorts"][number],
): boolean {
  return (
    port.enableCondition !== null ||
    port.powerSwitchCondition !== null ||
    port.filter !== null ||
    port.sorterRoutes.length > 0 ||
    port.sorterFallback !== null
  );
}

function entityWarning(status: EntityStatus): boolean {
  return (
    status === "noPower" ||
    status === "blocked" ||
    status === "unconfigured"
  );
}

function powerOfTwoCapacity(count: number): number {
  if (count <= 0) return 0;
  return Math.max(16, 2 ** Math.ceil(Math.log2(count)));
}

function directionYaw(direction: Direction): number {
  return -(Number(direction) * Math.PI) / 2;
}

function rotateLocal(
  centerX: number,
  centerZ: number,
  yaw: number,
  localX: number,
  localZ: number,
): { readonly x: number; readonly z: number } {
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  return {
    x: centerX + localX * cosine + localZ * sine,
    z: centerZ - localX * sine + localZ * cosine,
  };
}

function endpointAnchor(
  endpoint: VisualEndpoint,
  color: CircuitWireColor,
  target: THREE.Vector3,
): THREE.Vector3 {
  const lateral =
    color === "red"
      ? -CONNECTOR_LATERAL_SPACING
      : CONNECTOR_LATERAL_SPACING;
  const position = rotateLocal(
    endpoint.x,
    endpoint.z,
    endpoint.yaw,
    lateral,
    0,
  );
  return target.set(
    position.x,
    endpoint.height +
      (color === "red"
        ? RED_ANCHOR_HEIGHT_OFFSET
        : GREEN_ANCHOR_HEIGHT_OFFSET),
    position.z,
  );
}

function wireSagForSpan(start: THREE.Vector3, end: THREE.Vector3): number {
  const horizontalSpan = Math.hypot(end.x - start.x, end.z - start.z);
  return THREE.MathUtils.clamp(
    WIRE_MINIMUM_SAG + horizontalSpan * 0.034,
    WIRE_MINIMUM_SAG,
    WIRE_MAXIMUM_SAG,
  );
}

function visibleTriangleCount(root: THREE.Object3D): {
  readonly drawBatches: number;
  readonly triangles: number;
} {
  let drawBatches = 0;
  let triangles = 0;
  root.traverse((object) => {
    if (!object.visible || !(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.InstancedMesh && object.count === 0) {
      return;
    }
    drawBatches += 1;
    const geometry = object.geometry;
    const primitiveCount = geometry.index
      ? geometry.index.count / 3
      : (geometry.attributes.position?.count ?? 0) / 3;
    triangles +=
      primitiveCount *
      (object instanceof THREE.InstancedMesh ? object.count : 1);
  });
  return {
    drawBatches,
    triangles: Math.round(triangles),
  };
}

function deviceDefinitionForEntity(
  entityId: number,
  endpoints: ReadonlyMap<string, VisualEndpoint>,
  devices: readonly CircuitSimulationSnapshot["devices"][number][],
): CircuitSimulationSnapshot["devices"][number] | undefined {
  return devices.find(
    (device) => endpoints.get(device.outputEndpoint)?.entityId === entityId,
  );
}

function deviceVisualState(
  entity: CircuitRenderEntity,
  definition:
    | CircuitSimulationSnapshot["devices"][number]
    | undefined,
  endpoints: ReadonlyMap<string, VisualEndpoint>,
): DeviceVisualState {
  if (!definition) {
    return {
      definition,
      input: Object.freeze([]),
      output: Object.freeze([]),
      display: Object.freeze([]),
      active: false,
      warning: entityWarning(entity.status),
      operatorIndex: 0,
      meter: {
        inputValue: 0,
        operandValue: 0,
        outputValue: 0,
        operator: "",
        lines: Object.freeze(["IN000", "OUT00"]),
      },
    };
  }
  const input =
    definition.kind === "constant"
      ? Object.freeze([])
      : endpoints.get(definition.inputEndpoint)?.signals ??
        Object.freeze([]);
  const output =
    endpoints.get(definition.outputEndpoint)?.signals ??
    Object.freeze([]);
  const display =
    definition.kind === "constant"
      ? definition.signals
      : output.length > 0
        ? output
        : input;
  const enabled =
    definition.kind !== "constant" || definition.enabled;
  const active =
    enabled &&
    (definition.kind === "constant"
      ? output.length > 0 || display.length > 0
      : output.length > 0);
  const operatorIndex =
    definition.kind === "arithmetic"
      ? Math.max(
          0,
          ARITHMETIC_OPERATOR_ORDER.indexOf(definition.operator),
        )
      : definition.kind === "decider"
        ? Math.max(
            0,
            COMPARISON_OPERATOR_ORDER.indexOf(
              definition.condition.operator,
            ),
          )
        : definition.signals.length;
  let meter: DeviceMeterState;
  if (definition.kind === "constant") {
    const primarySignal = strongestSignalEntry(definition.signals);
    const inputValue = primarySignal?.value ?? 0;
    const outputValue = primarySignal
      ? selectorValue(output, primarySignal.signal)
      : 0;
    meter = {
      inputValue,
      operandValue: 0,
      outputValue,
      operator: "SET",
      lines: Object.freeze([
        `IN${meterInteger(inputValue, 3)}`,
        `OUT${meterInteger(outputValue, 2)}`,
      ]),
    };
  } else if (definition.kind === "arithmetic") {
    const inputValue = operandValue(input, definition.left);
    const rightValue = operandValue(input, definition.right);
    const outputValue = selectorValue(output, definition.output);
    const operator = arithmeticGlyph(definition.operator);
    meter = {
      inputValue,
      operandValue: rightValue,
      outputValue,
      operator,
      lines: Object.freeze([
        `${meterInteger(inputValue, 2)}${operator}${meterInteger(
          rightValue,
          2,
        )}`,
        `=${meterInteger(outputValue, 3)}`,
      ]),
    };
  } else {
    const inputValue = selectorValue(
      input,
      definition.condition.left,
    );
    const rightValue = operandValue(
      input,
      definition.condition.right,
    );
    const outputValue = selectorValue(output, definition.output);
    meter = {
      inputValue,
      operandValue: rightValue,
      outputValue,
      operator: definition.condition.operator,
      lines: Object.freeze([
        `${meterInteger(inputValue, 2)}${
          definition.condition.operator
        }${meterInteger(rightValue, 2)}`,
        `OUT${outputValue === 0 ? "0" : "1"}`,
      ]),
    };
  }
  return {
    definition,
    input,
    output,
    display,
    active,
    warning: entityWarning(entity.status),
    operatorIndex,
    meter,
  };
}

function buildPulseRoutes(
  wires: readonly VisualWire[],
  devices: readonly CircuitSimulationSnapshot["devices"][number][],
  machinePorts: readonly CircuitSimulationSnapshot["machinePorts"][number][],
  endpoints: ReadonlyMap<string, VisualEndpoint>,
): PulseRoute[] {
  const sourcePriority = new Map<string, number>();
  for (const device of devices) {
    const endpoint = endpoints.get(device.outputEndpoint);
    if (endpoint && endpoint.signals.length > 0) {
      sourcePriority.set(endpoint.endpointId, 2);
    }
  }
  for (const port of machinePorts) {
    if (port.outputEndpoint === null) continue;
    const endpoint = endpoints.get(port.outputEndpoint);
    if (endpoint && endpoint.signals.length > 0) {
      sourcePriority.set(
        endpoint.endpointId,
        Math.max(sourcePriority.get(endpoint.endpointId) ?? 0, 1),
      );
    }
  }

  const routes: PulseRoute[] = [];
  for (const color of ["green", "red"] as const) {
    const colorWires = wires.filter((wire) => wire.color === color);
    const adjacency = new Map<string, string[]>();
    for (const wire of colorWires) {
      const left = adjacency.get(wire.endpointA.endpointId) ?? [];
      left.push(wire.endpointB.endpointId);
      adjacency.set(wire.endpointA.endpointId, left);
      const right = adjacency.get(wire.endpointB.endpointId) ?? [];
      right.push(wire.endpointA.endpointId);
      adjacency.set(wire.endpointB.endpointId, right);
    }
    for (const neighbors of adjacency.values()) neighbors.sort(compareText);

    const distance = new Map<string, number>();
    const queue = [...sourcePriority.keys()]
      .filter((endpointId) => adjacency.has(endpointId))
      .sort(compareText);
    for (const endpointId of queue) distance.set(endpointId, 0);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const endpointId = queue[cursor]!;
      const nextDistance = distance.get(endpointId)! + 1;
      for (const neighbor of adjacency.get(endpointId) ?? []) {
        if (distance.has(neighbor)) continue;
        distance.set(neighbor, nextDistance);
        queue.push(neighbor);
      }
    }

    for (const wire of colorWires) {
      const distanceA = distance.get(wire.endpointA.endpointId);
      const distanceB = distance.get(wire.endpointB.endpointId);
      let from: VisualEndpoint | null = null;
      let to: VisualEndpoint | null = null;
      if (
        distanceA !== undefined &&
        distanceB !== undefined &&
        distanceA !== distanceB
      ) {
        from =
          distanceA < distanceB ? wire.endpointA : wire.endpointB;
        to = distanceA < distanceB ? wire.endpointB : wire.endpointA;
      } else if (distanceA === 0 && distanceB === 0) {
        const priorityA =
          sourcePriority.get(wire.endpointA.endpointId) ?? 0;
        const priorityB =
          sourcePriority.get(wire.endpointB.endpointId) ?? 0;
        if (priorityA !== priorityB) {
          from =
            priorityA > priorityB ? wire.endpointA : wire.endpointB;
          to =
            priorityA > priorityB ? wire.endpointB : wire.endpointA;
        }
      }
      if (!from || !to) continue;
      const signalEntry =
        strongestSignalEntry(from.signals) ??
        strongestSignalEntry(to.signals);
      if (!signalEntry) continue;
      routes.push({
        key: wire.key,
        color,
        from,
        to,
        signal: signalEntry.signal,
        signalValue: signalEntry.value,
        phaseOffset:
          Number.parseInt(fnv1a([wire.key]).slice(0, 6), 16) /
          0x1000000,
      });
    }
  }
  return routes.sort(
    (left, right) =>
      compareText(left.color, right.color) ||
      compareText(left.key, right.key),
  );
}

export class CircuitRenderer {
  readonly root = new THREE.Group();

  private readonly rigRoot = new THREE.Group();
  private readonly overviewRoot = new THREE.Group();
  private readonly contextRoot = new THREE.Group();
  private readonly wireRoot = new THREE.Group();
  private readonly endpointRoot = new THREE.Group();
  private readonly portRoot = new THREE.Group();
  private readonly signalRoot = new THREE.Group();
  private readonly pulseRoot = new THREE.Group();
  private readonly options: NormalizedOptions;
  private readonly materials: CircuitMaterials;
  private readonly geometries: CircuitGeometries;
  private readonly batches = new Map<string, InstancedBatch>();
  private readonly rigs = new Map<number, DetailedRig>();
  private readonly machineRigs = new Map<string, MachineProcessRig>();
  private readonly tempObject = new THREE.Object3D();
  private readonly tempStart = new THREE.Vector3();
  private readonly tempEnd = new THREE.Vector3();
  private readonly tempDirection = new THREE.Vector3();
  private disposed = false;
  private disposedGeometries = 0;
  private disposedMaterials = 0;
  private disposedTextures = 0;
  private disposedInstancedMeshes = 0;
  private createdDynamicMaterials = 0;
  private createdDynamicTextures = 0;
  private debug: CircuitRenderDebug = EMPTY_DEBUG;

  public constructor(
    parent: THREE.Object3D,
    options: CircuitRendererOptions = {},
  ) {
    this.options = normalizeOptions(options);
    this.materials = createMaterials();
    this.geometries = createGeometries();
    this.root.name = "circuit-world-system";
    this.rigRoot.name = "circuit-detailed-industrial-control-cabinets";
    this.overviewRoot.name = "circuit-overview-device-batches";
    this.contextRoot.name = "circuit-grounded-service-context";
    this.wireRoot.name = "circuit-physical-sagging-insulated-cables";
    this.endpointRoot.name = "circuit-bolted-read-write-connector-modules";
    this.portRoot.name = "circuit-physically-attached-machine-actuators";
    this.signalRoot.name = "circuit-recessed-cabinet-meter-state";
    this.pulseRoot.name = "circuit-presentation-packets-intentionally-disabled";
    this.pulseRoot.visible = false;
    this.root.add(
      this.wireRoot,
      this.contextRoot,
      this.endpointRoot,
      this.portRoot,
      this.overviewRoot,
      this.rigRoot,
      this.signalRoot,
      this.pulseRoot,
    );
    parent.add(this.root);
    this.refreshResourceDebug();
  }

  public sync(frame: CircuitVisualFrame): void {
    this.assertLive();
    const sortedEntities = [...frame.circuitEntities].sort(compareEntity);
    const circuitEntitiesById = new Map(
      sortedEntities.map((entity) => [entity.id, entity]),
    );
    const circuitEntityIds = new Set(
      sortedEntities.map((entity) => entity.id),
    );
    const sortedEndpointSnapshots = [...frame.circuit.endpoints].sort(
      (left, right) => compareText(left.endpointId, right.endpointId),
    );
    const connectedEndpointIds = new Set<string>();
    for (const wire of frame.circuit.wires) {
      connectedEndpointIds.add(wire.endpointA);
      connectedEndpointIds.add(wire.endpointB);
    }
    const configuredPortEndpoints = new Set(
      frame.circuit.machinePorts
        .filter(machinePortConfigured)
        .map((port) => port.inputEndpoint),
    );
    const relevantEndpointSnapshots = sortedEndpointSnapshots.filter(
      (endpoint) =>
        circuitEntityIds.has(endpoint.entityId) ||
        connectedEndpointIds.has(endpoint.endpointId) ||
        configuredPortEndpoints.has(endpoint.endpointId),
    );
    const renderedEndpointSnapshots = relevantEndpointSnapshots.slice(
      0,
      this.options.maxRenderedEndpoints,
    );
    const sceneEntityRoots = new Map<number, THREE.Object3D>();
    for (const child of this.root.parent?.children ?? []) {
      if (child === this.root) continue;
      const entityId = child.userData.entityId;
      if (typeof entityId === "number") {
        sceneEntityRoots.set(entityId, child);
      }
    }
    const endpoints = new Map<string, VisualEndpoint>(
      renderedEndpointSnapshots.map((endpoint) => [
        endpoint.endpointId,
        (() => {
          const circuitEntity = circuitEntitiesById.get(endpoint.entityId);
          const machineRoot = circuitEntity
            ? undefined
            : sceneEntityRoots.get(endpoint.entityId);
          const bounds = machineRoot
            ? new THREE.Box3().setFromObject(machineRoot)
            : null;
          const boundsAreFinite =
            bounds !== null &&
            Number.isFinite(bounds.min.x) &&
            Number.isFinite(bounds.max.x) &&
            !bounds.isEmpty();
          const machineWidth = boundsAreFinite
            ? bounds.max.x - bounds.min.x
            : 1;
          const machineDepth = boundsAreFinite
            ? bounds.max.z - bounds.min.z
            : 1;
          return {
          endpointId: endpoint.endpointId,
          entityId: endpoint.entityId,
          connector: endpoint.connector,
          nativeX: endpoint.x,
          nativeZ: endpoint.y,
          x: circuitEntity
            ? endpoint.x
            : boundsAreFinite
              ? THREE.MathUtils.lerp(
                  bounds.min.x,
                  bounds.max.x,
                  0.3,
                )
              : endpoint.x - 0.42,
          z: circuitEntity
            ? endpoint.y
            : boundsAreFinite
              ? THREE.MathUtils.lerp(
                  bounds.min.z,
                  bounds.max.z,
                  0.72,
                )
              : endpoint.y + 0.28,
          height: circuitEntity
            ? 0.43
            : boundsAreFinite
              ? THREE.MathUtils.clamp(
                  THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, 0.68),
                  0.42,
                  0.86,
                )
              : 0.48,
          yaw: circuitEntity ? directionYaw(circuitEntity.direction) : 0,
          attachmentScale: circuitEntity
            ? 1
            : THREE.MathUtils.clamp(
                Math.max(machineWidth, machineDepth) * 0.72,
                1,
                2.35,
              ),
          signals: endpoint.signals,
          isCircuitDevice: Boolean(circuitEntity),
          };
        })(),
      ]),
    );

    const sortedWires = [...frame.circuit.wires].sort(
      (left, right) =>
        compareText(left.color, right.color) ||
        compareText(left.endpointA, right.endpointA) ||
        compareText(left.endpointB, right.endpointB),
    );
    const eligibleWires: VisualWire[] = [];
    for (const wire of sortedWires) {
      const endpointA = endpoints.get(wire.endpointA);
      const endpointB = endpoints.get(wire.endpointB);
      if (!endpointA || !endpointB) continue;
      if (wire.color !== "red" && wire.color !== "green") continue;
      eligibleWires.push({
        key: `${wire.color}:${wire.endpointA}>${wire.endpointB}`,
        color: wire.color,
        endpointA,
        endpointB,
      });
      if (eligibleWires.length >= this.options.maxRenderedWires) break;
    }
    const redWires = eligibleWires.filter(
      (wire) => wire.color === "red",
    );
    const greenWires = eligibleWires.filter(
      (wire) => wire.color === "green",
    );
    const sortedDevices = [...frame.circuit.devices].sort(
      (left, right) => compareText(left.id, right.id),
    );
    const sortedMachinePorts = [...frame.circuit.machinePorts].sort(
      (left, right) => compareText(left.id, right.id),
    );
    const sortedMachineControls = [...frame.circuit.machineControls].sort(
      (left, right) => compareText(left.portId, right.portId),
    );

    const topologyParts = [
      ...sortedEntities.map(
        (entity) =>
          `e:${entity.id}:${entity.kind}:${entity.x}:${entity.z}:${entity.direction}`,
      ),
      ...renderedEndpointSnapshots.map(
        (endpoint) =>
          `p:${endpoint.endpointId}:${endpoint.entityId}:${endpoint.connector}:${endpoint.x}:${endpoint.y}`,
      ),
      ...eligibleWires.map((wire) => `w:${wire.key}`),
    ];
    const stateParts = [
      `tick:${frame.circuit.tick}`,
      ...renderedEndpointSnapshots.map(
        (endpoint) =>
          `s:${endpoint.endpointId}:${endpoint.signals
            .map(
              (entry) =>
                `${signalKey(entry.signal)}=${entry.value}`,
            )
            .join(",")}`,
      ),
      ...sortedDevices.map(
        (device) => `d:${device.id}:${JSON.stringify(device)}`,
      ),
      ...sortedMachinePorts.map(
        (port) => `m:${port.id}:${JSON.stringify(port)}`,
      ),
      ...sortedMachineControls.map(
        (control) =>
          `c:${control.portId}:${control.enabled ? 1 : 0}:${
            control.powerSwitchClosed ? 1 : 0
          }:${control.filterSignal ? signalKey(control.filterSignal) : "-"}:${
            control.sorterOutput ?? "-"
          }`,
      ),
    ];
    const topologySignature = `circuit-topology-${fnv1a(topologyParts)}`;
    const stateSignature = `circuit-state-${fnv1a(stateParts)}`;

    this.syncWires(redWires, greenWires);
    const degrees = this.syncEndpoints(
      [...endpoints.values()],
      eligibleWires,
    );
    const machinePorts = this.syncMachinePorts(
      frame.circuit,
      endpoints,
      connectedEndpointIds,
    );
    const detailEntities = sortedEntities.slice(
      0,
      this.options.maxDetailedDevices,
    );
    const overviewEntities = sortedEntities.slice(
      this.options.maxDetailedDevices,
    );
    const serviceContext = this.syncServiceContext(
      sortedEntities,
      eligibleWires,
      [...endpoints.values()],
    );
    const deviceStates = this.syncDetailedRigs(
      detailEntities,
      frame.circuit,
      endpoints,
      frame.elapsed ?? frame.circuit.tick / 60,
    );
    this.syncOverview(overviewEntities);
    const signalCount = this.syncSignalIndicators(
      detailEntities,
      deviceStates,
      machinePorts,
    );

    const routes = buildPulseRoutes(
      eligibleWires,
      sortedDevices,
      sortedMachinePorts,
      endpoints,
    );
    // Route direction remains audited from authoritative source roles, but
    // presentation uses cabinet mechanics and machine actuation rather than
    // floating arrows or packet particles.
    this.update(frame.elapsed ?? frame.circuit.tick / 60);
    const sagDepths = [
      ...((this.batches.get("wire-red-outer")?.mesh.userData
        .sagDepths as readonly number[] | undefined) ?? []),
      ...((this.batches.get("wire-green-outer")?.mesh.userData
        .sagDepths as readonly number[] | undefined) ?? []),
    ];
    const minimumSag =
      sagDepths.length > 0 ? Math.min(...sagDepths) : 0;
    const maximumSag =
      sagDepths.length > 0 ? Math.max(...sagDepths) : 0;

    const counts = visibleTriangleCount(this.root);
    this.root.visible =
      sortedEntities.length > 0 ||
      eligibleWires.length > 0 ||
      machinePorts.length > 0;
    this.debug = Object.freeze({
      disposed: false,
      topologySignature,
      stateSignature,
      tick: frame.circuit.tick,
      entities: sortedEntities.length,
      detailedDevices: detailEntities.length,
      overviewDevices: overviewEntities.length,
      constants: sortedEntities.filter(
        (entity) => entity.kind === "constantCombinator",
      ).length,
      arithmetic: sortedEntities.filter(
        (entity) => entity.kind === "arithmeticCombinator",
      ).length,
      deciders: sortedEntities.filter(
        (entity) => entity.kind === "deciderCombinator",
      ).length,
      endpoints: endpoints.size,
      omittedEndpoints:
        relevantEndpointSnapshots.length - endpoints.size,
      wires: eligibleWires.length,
      omittedWires:
        sortedWires.length - eligibleWires.length,
      redWires: redWires.length,
      greenWires: greenWires.length,
      junctions: degrees.junctions,
      machinePorts: machinePorts.length,
      configuredMachinePorts: machinePorts.filter(
        (entry) => entry.configured,
      ).length,
      activeDevices: [...deviceStates.values()].filter(
        (state) => state.active,
      ).length,
      signalIndicators: signalCount,
      directionalWires: routes.length,
      pulses: 0,
      omittedPulses: 0,
      pulsePeriodTicks: 1,
      quality: this.options.quality,
      presentationPulses: 0,
      connectorModules: endpoints.size,
      actuatedMachinePorts: machinePorts.filter(
        (entry) => entry.control !== undefined,
      ).length,
      servicePads: serviceContext.servicePads,
      cableSupports: serviceContext.cableSupports,
      causalMeters: this.rigs.size,
      machineProcessRigs: this.machineRigs.size,
      enabledMachineResponses: [...this.machineRigs.values()].filter(
        (rig) => rig.enabled,
      ).length,
      districtModules: serviceContext.districtModules,
      districtTraySegments: serviceContext.districtTraySegments,
      wireSag: Object.freeze({
        minimum: minimumSag,
        maximum: maximumSag,
        spanScaled: true,
      }),
      drawBatches: counts.drawBatches,
      triangles: counts.triangles,
      capacities: Object.freeze({
        endpoints: this.batchCapacity("endpoint-base"),
        redWires: this.batchCapacity("wire-red-outer"),
        greenWires: this.batchCapacity("wire-green-outer"),
        pulses: 0,
      }),
      resources: Object.freeze({
        ownedGeometries: this.geometries.all.length,
        ownedMaterials:
          this.materials.all.length + this.createdDynamicMaterials,
        liveInstancedMeshes: this.batches.size,
        disposedGeometries: this.disposedGeometries,
        disposedMaterials: this.disposedMaterials,
        ownedTextures:
          this.materials.textures.length + this.createdDynamicTextures,
        disposedTextures: this.disposedTextures,
        disposedInstancedMeshes: this.disposedInstancedMeshes,
      }),
    });
    this.root.userData.topologySignature = topologySignature;
    this.root.userData.stateSignature = stateSignature;
    this.root.userData.tick = frame.circuit.tick;
  }

  public update(elapsedSeconds: number): void {
    this.assertLive();
    if (!Number.isFinite(elapsedSeconds)) {
      throw new Error("Circuit renderer elapsed time must be finite.");
    }
    this.updateRigsOnly(elapsedSeconds);
    this.updateMachineRigsOnly(elapsedSeconds);
  }

  public getDebug(): CircuitRenderDebug {
    return this.debug;
  }

  public dispose(): void {
    if (this.disposed) return;
    for (const rig of this.rigs.values()) this.disposeDetailedRig(rig);
    this.rigs.clear();
    for (const rig of this.machineRigs.values()) {
      rig.root.removeFromParent();
    }
    this.machineRigs.clear();
    for (const batch of this.batches.values()) {
      batch.mesh.removeFromParent();
      batch.mesh.dispose();
      this.disposedInstancedMeshes += 1;
    }
    this.batches.clear();
    this.root.removeFromParent();
    for (const geometry of this.geometries.all) {
      geometry.dispose();
      this.disposedGeometries += 1;
    }
    for (const material of this.materials.all) {
      material.dispose();
      this.disposedMaterials += 1;
    }
    for (const texture of this.materials.textures) {
      texture.dispose();
      this.disposedTextures += 1;
    }
    this.disposed = true;
    this.debug = Object.freeze({
      ...this.debug,
      disposed: true,
      drawBatches: 0,
      resources: Object.freeze({
        ownedGeometries: this.geometries.all.length,
        ownedMaterials:
          this.materials.all.length + this.createdDynamicMaterials,
        liveInstancedMeshes: 0,
        disposedGeometries: this.disposedGeometries,
        disposedMaterials: this.disposedMaterials,
        ownedTextures:
          this.materials.textures.length + this.createdDynamicTextures,
        disposedTextures: this.disposedTextures,
        disposedInstancedMeshes: this.disposedInstancedMeshes,
      }),
    });
  }

  private syncWires(
    redWires: readonly VisualWire[],
    greenWires: readonly VisualWire[],
  ): void {
    this.fillWireBatch(
      "wire-red-outer",
      redWires,
      this.geometries.wireOuter,
      this.materials.wireRed,
    );
    this.fillWireBatch(
      "wire-green-outer",
      greenWires,
      this.geometries.wireOuter,
      this.materials.wireGreen,
    );
  }

  private fillWireBatch(
    key: string,
    wires: readonly VisualWire[],
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
  ): void {
    const mesh = this.ensureBatch(
      key,
      wires.length,
      geometry,
      material,
      this.wireRoot,
    );
    if (!mesh) return;
    const anchorPairs: {
      readonly from: readonly [number, number, number];
      readonly to: readonly [number, number, number];
    }[] = [];
    const sagDepths: number[] = [];
    for (let index = 0; index < wires.length; index += 1) {
      const wire = wires[index]!;
      endpointAnchor(wire.endpointA, wire.color, this.tempStart);
      endpointAnchor(wire.endpointB, wire.color, this.tempEnd);
      const sag = wireSagForSpan(this.tempStart, this.tempEnd);
      this.setRouteMatrix(
        mesh,
        index,
        this.tempStart,
        this.tempEnd,
        sag,
      );
      anchorPairs.push({
        from: [this.tempStart.x, this.tempStart.y, this.tempStart.z],
        to: [this.tempEnd.x, this.tempEnd.y, this.tempEnd.z],
      });
      sagDepths.push(sag);
    }
    mesh.count = wires.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.wires = wires.map((wire) => wire.key);
    mesh.userData.anchorPairs = anchorPairs;
    mesh.userData.sagDepths = sagDepths;
    mesh.userData.spanScaledSag = true;
    mesh.userData.presentation =
      "thin-non-emissive-insulated-physical-cable";
    mesh.userData.terminalOwnership =
      "physical-gland-to-physical-gland";
    mesh.userData.deviceDisplayClearance =
      "device-terminals-below-integrated-instrument-plane";
    mesh.userData.hasAnimatedPackets = false;
    mesh.userData.hasDirectionArrows = false;
  }

  private syncServiceContext(
    entities: readonly CircuitRenderEntity[],
    wires: readonly VisualWire[],
    endpoints: readonly VisualEndpoint[],
  ): {
    readonly servicePads: number;
    readonly cableSupports: number;
    readonly districtModules: number;
    readonly districtTraySegments: number;
  } {
    const pad = this.ensureBatch(
      "service-pad",
      entities.length,
      this.geometries.servicePad,
      this.materials.serviceConcrete,
      this.contextRoot,
    );
    const stripe = this.ensureBatch(
      "service-pad-stripe",
      entities.length,
      this.geometries.serviceStripe,
      this.materials.safetyPaint,
      this.contextRoot,
    );
    const wear = this.ensureBatch(
      "service-ground-wear",
      entities.length,
      this.geometries.groundWear,
      this.materials.groundWear,
      this.contextRoot,
    );
    const grating = this.ensureBatch(
      "district-open-service-grating",
      entities.length,
      this.geometries.districtGrating,
      this.materials.darkMetal,
      this.contextRoot,
    );
    const pipeRack = this.ensureBatch(
      "district-service-pipe-rack",
      entities.length,
      this.geometries.districtPipeRack,
      this.materials.armor,
      this.contextRoot,
    );
    const powerModule = this.ensureBatch(
      "district-control-transformer",
      entities.length,
      this.geometries.districtPowerModule,
      this.materials.foundation,
      this.contextRoot,
    );
    for (let index = 0; index < entities.length; index += 1) {
      const entity = entities[index]!;
      const yaw = directionYaw(entity.direction);
      this.tempObject.position.set(entity.x + 0.5, 0.002, entity.z + 0.5);
      this.tempObject.rotation.set(0, yaw, 0);
      this.tempObject.quaternion.setFromEuler(this.tempObject.rotation);
      this.tempObject.scale.set(
        entity.kind === "constantCombinator"
          ? 0.92
          : entity.kind === "arithmeticCombinator"
            ? 1.08
            : 0.98,
        1,
        entity.kind === "deciderCombinator" ? 1.1 : 1,
      );
      this.tempObject.updateMatrix();
      pad?.setMatrixAt(index, this.tempObject.matrix);
      stripe?.setMatrixAt(index, this.tempObject.matrix);
      grating?.setMatrixAt(index, this.tempObject.matrix);

      const rackPosition = rotateLocal(
        entity.x + 0.5,
        entity.z + 0.5,
        yaw,
        0,
        -0.44,
      );
      this.tempObject.position.set(rackPosition.x, 0, rackPosition.z);
      this.tempObject.rotation.set(0, yaw, 0);
      this.tempObject.quaternion.setFromEuler(this.tempObject.rotation);
      this.tempObject.scale.set(
        entity.kind === "arithmeticCombinator" ? 1.08 : 0.94,
        1,
        1,
      );
      this.tempObject.updateMatrix();
      pipeRack?.setMatrixAt(index, this.tempObject.matrix);

      const powerPosition = rotateLocal(
        entity.x + 0.5,
        entity.z + 0.5,
        yaw,
        entity.kind === "arithmeticCombinator" ? 0.64 : -0.62,
        0.03,
      );
      this.tempObject.position.set(
        powerPosition.x,
        0.005,
        powerPosition.z,
      );
      this.tempObject.rotation.set(0, yaw, 0);
      this.tempObject.quaternion.setFromEuler(this.tempObject.rotation);
      this.tempObject.scale.setScalar(
        entity.kind === "constantCombinator" ? 0.72 : 0.78,
      );
      this.tempObject.updateMatrix();
      powerModule?.setMatrixAt(index, this.tempObject.matrix);

      const wearSeed =
        Number.parseInt(fnv1a([`wear:${entity.id}`]).slice(0, 6), 16) /
        0x1000000;
      this.tempObject.position.set(
        entity.x + 0.5 + (wearSeed - 0.5) * 0.12,
        0.074,
        entity.z + 0.5 + (0.5 - wearSeed) * 0.1,
      );
      this.tempObject.rotation.set(0, wearSeed * Math.PI * 2, 0);
      this.tempObject.quaternion.setFromEuler(this.tempObject.rotation);
      this.tempObject.scale.set(
        1.18 + wearSeed * 0.25,
        1,
        0.82 + (1 - wearSeed) * 0.22,
      );
      this.tempObject.updateMatrix();
      wear?.setMatrixAt(index, this.tempObject.matrix);
    }
    for (const mesh of [
      pad,
      stripe,
      wear,
      grating,
      pipeRack,
      powerModule,
    ]) {
      if (!mesh) continue;
      mesh.count = entities.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.entityIds = entities.map((entity) => entity.id);
      mesh.userData.authoritativePlacement = true;
    }
    if (pad) {
      pad.userData.contextRole =
        "grounded-bolted-service-pad-and-drain-frame";
    }
    if (wear) {
      wear.userData.contextRole =
        "localized-oil-runoff-and-foot-traffic-wear";
    }
    if (grating) {
      grating.userData.contextRole =
        "continuous-maintenance-access-and-open-drainage";
    }
    if (pipeRack) {
      pipeRack.userData.contextRole =
        "grounded-power-and-service-infrastructure";
    }
    if (powerModule) {
      powerModule.userData.contextRole =
        "local-control-power-and-ceramic-isolation";
    }

    const externalNodes =
      entities.length === 0
        ? []
        : [...new Map(
            endpoints
              .filter((endpoint) => !endpoint.isCircuitDevice)
              .map((endpoint) => [endpoint.entityId, endpoint] as const),
          ).values()]
            .sort(
              (left, right) =>
                left.z - right.z ||
                left.x - right.x ||
                left.entityId - right.entityId,
            )
            .slice(0, Math.max(4, entities.length * 2));
    const primaryDistrictNodes = [
      ...entities.map((entity) => ({
        key: `device:${entity.id}`,
        entityId: entity.id,
        x: entity.x + 0.5,
        z: entity.z + 0.5,
        yaw: directionYaw(entity.direction),
        machine: false,
        infrastructureOnly: false,
      })),
      ...externalNodes.map((endpoint) => ({
        key: `machine:${endpoint.entityId}`,
        entityId: endpoint.entityId,
        x: endpoint.x,
        z: endpoint.z,
        yaw: endpoint.yaw,
        machine: true,
        infrastructureOnly: false,
      })),
    ];
    const districtExpansionNodes =
      this.options.quality === "high" &&
      primaryDistrictNodes.length >= 2
        ? (() => {
            const minimumX = Math.min(
              ...primaryDistrictNodes.map((node) => node.x),
            );
            const maximumX = Math.max(
              ...primaryDistrictNodes.map((node) => node.x),
            );
            const centerZ =
              primaryDistrictNodes.reduce(
                (sum, node) => sum + node.z,
                0,
              ) / primaryDistrictNodes.length;
            return [
              {
                key: "district:west-service-endcap",
                entityId: -1,
                x: minimumX - 1.7,
                z: centerZ,
                yaw: 0,
                machine: false,
                infrastructureOnly: true,
              },
              {
                key: "district:east-service-endcap",
                entityId: -2,
                x: maximumX + 1.7,
                z: centerZ,
                yaw: 0,
                machine: false,
                infrastructureOnly: true,
              },
            ];
          })()
        : [];
    const districtNodes = [
      ...primaryDistrictNodes,
      ...districtExpansionNodes,
    ].sort(
      (left, right) =>
        left.x - right.x ||
        left.z - right.z ||
        compareText(left.key, right.key),
    );
    const flankOffsets =
      this.options.quality === "high"
        ? [-2.35, -1.25, 1.25, 2.35]
        : [-1.25, 1.25];
    const fieldCells = districtNodes.flatMap((node, nodeIndex) =>
      flankOffsets.map((offset, offsetIndex) => ({
        ...node,
        nodeIndex,
        offsetIndex,
        offset,
        x: node.x,
        z: node.z + offset,
        outer: Math.abs(offset) > 2,
      })),
    );
    const fieldDeck = this.ensureBatch(
      "district-layered-field-deck",
      fieldCells.length,
      this.geometries.districtFieldDeck,
      this.materials.serviceConcrete,
      this.contextRoot,
    );
    const fieldGrating = this.ensureBatch(
      "district-layered-field-grating",
      fieldCells.length,
      this.geometries.districtFieldGrating,
      this.materials.darkMetal,
      this.contextRoot,
    );
    for (let index = 0; index < fieldCells.length; index += 1) {
      const cell = fieldCells[index]!;
      this.tempObject.position.set(cell.x, 0.003, cell.z);
      this.tempObject.rotation.set(
        0,
        cell.offset < 0 ? Math.PI : 0,
        0,
      );
      this.tempObject.quaternion.setFromEuler(this.tempObject.rotation);
      this.tempObject.scale.set(
        cell.machine ? 1 : 0.92,
        1,
        cell.outer ? 0.7 : 0.8,
      );
      this.tempObject.updateMatrix();
      fieldDeck?.setMatrixAt(index, this.tempObject.matrix);
      this.tempObject.position.y = 0.094;
      this.tempObject.updateMatrix();
      fieldGrating?.setMatrixAt(index, this.tempObject.matrix);
    }
    for (const mesh of [fieldDeck, fieldGrating]) {
      if (!mesh) continue;
      mesh.count = fieldCells.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.nodeKeys = fieldCells.map((cell) => cell.key);
      mesh.userData.rendererOwnedIndustrialContext = true;
      mesh.userData.contextRole =
        "layered-operational-district-field-around-causal-spine";
      mesh.userData.centralScanCorridorReserved = true;
    }

    const processPods = districtNodes.flatMap((node, index) =>
      index % 2 === 0
        ? [{
            ...node,
            districtIndex: index,
            x: node.x + (index % 4 === 0 ? -0.16 : 0.16),
            z: node.z - 1.25,
            scale: node.machine
              ? 1.08
              : node.infrastructureOnly
                ? 0.84
                : 0.94 + (index % 3) * 0.055,
          }]
        : [],
    );
    const processPod = this.ensureBatch(
      "district-operational-process-pod",
      processPods.length,
      this.geometries.districtProcessPod,
      this.materials.districtEnamel,
      this.contextRoot,
    );
    const processPodTrim = this.ensureBatch(
      "district-operational-process-pod-trim",
      processPods.length,
      this.geometries.districtProcessPodTrim,
      this.materials.copper,
      this.contextRoot,
    );
    for (let index = 0; index < processPods.length; index += 1) {
      const pod = processPods[index]!;
      this.tempObject.position.set(pod.x, 0.08, pod.z);
      this.tempObject.rotation.set(
        0,
        pod.yaw + (pod.districtIndex % 4 === 0 ? 0 : Math.PI / 2),
        0,
      );
      this.tempObject.quaternion.setFromEuler(this.tempObject.rotation);
      this.tempObject.scale.setScalar(pod.scale);
      this.tempObject.updateMatrix();
      processPod?.setMatrixAt(index, this.tempObject.matrix);
      processPodTrim?.setMatrixAt(index, this.tempObject.matrix);
    }
    for (const mesh of [processPod, processPodTrim]) {
      if (!mesh) continue;
      mesh.count = processPods.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.nodeKeys = processPods.map((pod) => pod.key);
      mesh.userData.contextRole =
        "operational-twin-accumulator-process-service";
      mesh.userData.centralScanCorridorReserved = true;
    }

    const coolingCells = districtNodes.flatMap((node, index) =>
      index % 2 === 1
        ? [{
            ...node,
            districtIndex: index,
            x: node.x + (index % 4 === 1 ? 0.18 : -0.18),
            z: node.z + 1.25,
            scale: node.machine
              ? 1.14
              : node.infrastructureOnly
                ? 0.86
                : 0.96 + ((index + 1) % 3) * 0.05,
          }]
        : [],
    );
    const coolingModule = this.ensureBatch(
      "district-ducted-cooling-cell",
      coolingCells.length,
      this.geometries.districtCoolingModule,
      this.materials.armor,
      this.contextRoot,
    );
    const coolingRotor = this.ensureBatch(
      "district-running-cooling-rotor",
      coolingCells.length,
      this.geometries.districtCoolingRotor,
      this.materials.districtCoolant,
      this.contextRoot,
    );
    for (let index = 0; index < coolingCells.length; index += 1) {
      const cooler = coolingCells[index]!;
      this.tempObject.position.set(cooler.x, 0.08, cooler.z);
      this.tempObject.rotation.set(
        0,
        cooler.yaw +
          (cooler.districtIndex % 4 === 1 ? 0 : Math.PI / 2),
        0,
      );
      this.tempObject.quaternion.setFromEuler(this.tempObject.rotation);
      this.tempObject.scale.setScalar(cooler.scale);
      this.tempObject.updateMatrix();
      coolingModule?.setMatrixAt(index, this.tempObject.matrix);
      this.tempObject.position.y = 0.48;
      this.tempObject.rotation.y +=
        (Number.parseInt(fnv1a([cooler.key]).slice(0, 4), 16) /
          0xffff) *
        Math.PI *
        2;
      this.tempObject.quaternion.setFromEuler(this.tempObject.rotation);
      this.tempObject.scale.setScalar(cooler.scale * 1.08);
      this.tempObject.updateMatrix();
      coolingRotor?.setMatrixAt(index, this.tempObject.matrix);
    }
    for (const mesh of [coolingModule, coolingRotor]) {
      if (!mesh) continue;
      mesh.count = coolingCells.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.nodeKeys = coolingCells.map((cooler) => cooler.key);
      mesh.userData.contextRole =
        "ducted-district-thermal-management-bank";
      mesh.userData.operational = true;
      mesh.userData.centralScanCorridorReserved = true;
    }

    const auxiliaryPowerCells = districtNodes.map((node, index) => ({
      ...node,
      x: node.x + (index % 2 === 0 ? 0.27 : -0.27),
      z: node.z + (index % 2 === 0 ? 1.25 : -1.25),
      districtIndex: index,
    }));
    const auxiliaryPower = this.ensureBatch(
      "district-auxiliary-control-power-bay",
      auxiliaryPowerCells.length,
      this.geometries.districtPowerModule,
      this.materials.foundation,
      this.contextRoot,
    );
    for (let index = 0; index < auxiliaryPowerCells.length; index += 1) {
      const bay = auxiliaryPowerCells[index]!;
      this.tempObject.position.set(bay.x, 0.075, bay.z);
      this.tempObject.rotation.set(
        0,
        bay.yaw + (bay.districtIndex % 3) * (Math.PI / 2),
        0,
      );
      this.tempObject.quaternion.setFromEuler(this.tempObject.rotation);
      this.tempObject.scale.setScalar(
        bay.machine ? 0.82 : bay.infrastructureOnly ? 0.62 : 0.7,
      );
      this.tempObject.updateMatrix();
      auxiliaryPower?.setMatrixAt(index, this.tempObject.matrix);
    }
    if (auxiliaryPower) {
      auxiliaryPower.count = auxiliaryPowerCells.length;
      auxiliaryPower.instanceMatrix.needsUpdate = true;
      auxiliaryPower.userData.nodeKeys = auxiliaryPowerCells.map(
        (bay) => bay.key,
      );
      auxiliaryPower.userData.contextRole =
        "distributed-local-control-power-and-isolation";
      auxiliaryPower.userData.centralScanCorridorReserved = true;
    }

    const outerRackCells = districtNodes.map((node, index) => ({
      ...node,
      x: node.x + (index % 3 === 0 ? -0.2 : 0.2),
      z: node.z + (index % 2 === 0 ? 2.35 : -2.35),
      districtIndex: index,
    }));
    const outerRacks = this.ensureBatch(
      "district-outer-process-rack-bay",
      outerRackCells.length,
      this.geometries.districtPipeRack,
      this.materials.armor,
      this.contextRoot,
    );
    for (let index = 0; index < outerRackCells.length; index += 1) {
      const rack = outerRackCells[index]!;
      this.tempObject.position.set(rack.x, 0.04, rack.z);
      this.tempObject.rotation.set(
        0,
        rack.districtIndex % 2 === 0 ? 0 : Math.PI,
        0,
      );
      this.tempObject.quaternion.setFromEuler(this.tempObject.rotation);
      this.tempObject.scale.set(
        rack.infrastructureOnly ? 0.78 : 0.9,
        1,
        0.9,
      );
      this.tempObject.updateMatrix();
      outerRacks?.setMatrixAt(index, this.tempObject.matrix);
    }
    if (outerRacks) {
      outerRacks.count = outerRackCells.length;
      outerRacks.instanceMatrix.needsUpdate = true;
      outerRacks.userData.nodeKeys = outerRackCells.map(
        (rack) => rack.key,
      );
      outerRacks.userData.contextRole =
        "layered-outer-process-and-utility-rack";
      outerRacks.userData.centralScanCorridorReserved = true;
    }

    const valveCells = districtNodes.map((node, index) => ({
      ...node,
      x: node.x + (index % 2 === 0 ? 0.38 : -0.38),
      z: node.z + (index % 2 === 0 ? -2.35 : 2.35),
    }));
    const valves = this.ensureBatch(
      "district-process-valve-cluster",
      valveCells.length,
      this.geometries.districtValveCluster,
      this.materials.bronze,
      this.contextRoot,
    );
    for (let index = 0; index < valveCells.length; index += 1) {
      const valve = valveCells[index]!;
      this.tempObject.position.set(valve.x, 0.1, valve.z);
      this.tempObject.rotation.set(0, valve.yaw + index * 0.37, 0);
      this.tempObject.quaternion.setFromEuler(this.tempObject.rotation);
      this.tempObject.scale.setScalar(valve.machine ? 1.08 : 0.9);
      this.tempObject.updateMatrix();
      valves?.setMatrixAt(index, this.tempObject.matrix);
    }
    if (valves) {
      valves.count = valveCells.length;
      valves.instanceMatrix.needsUpdate = true;
      valves.userData.nodeKeys = valveCells.map((valve) => valve.key);
      valves.userData.contextRole =
        "serviceable-process-isolation-and-crossfeed-control";
    }

    const perimeterRails = districtNodes.flatMap((node) =>
      [-2.9, 2.9].map((offset) => ({
        ...node,
        offset,
        z: node.z + offset,
      })),
    );
    const rails = this.ensureBatch(
      "district-grounded-perimeter-rail",
      perimeterRails.length,
      this.geometries.districtPerimeterRail,
      this.materials.districtGuard,
      this.contextRoot,
    );
    for (let index = 0; index < perimeterRails.length; index += 1) {
      const rail = perimeterRails[index]!;
      this.tempObject.position.set(rail.x, 0.01, rail.z);
      this.tempObject.rotation.set(
        0,
        rail.offset < 0 ? Math.PI : 0,
        0,
      );
      this.tempObject.quaternion.setFromEuler(this.tempObject.rotation);
      this.tempObject.scale.set(1.08, 1, 1);
      this.tempObject.updateMatrix();
      rails?.setMatrixAt(index, this.tempObject.matrix);
    }
    if (rails) {
      rails.count = perimeterRails.length;
      rails.instanceMatrix.needsUpdate = true;
      rails.userData.nodeKeys = perimeterRails.map((rail) => rail.key);
      rails.userData.contextRole =
        "outer-district-edge-protection-and-depth-frame";
    }

    const crossfeeds = districtNodes.flatMap((node) =>
      [-1, 1].map((side) => ({
        key: node.key,
        side,
        start: new THREE.Vector3(
          node.x,
          0.205,
          node.z + side * 0.62,
        ),
        end: new THREE.Vector3(
          node.x,
          0.205,
          node.z + side * 1.25,
        ),
      })),
    );
    const crossfeedPipes = this.ensureBatch(
      "district-process-crossfeed",
      crossfeeds.length,
      this.geometries.districtProcessHeader,
      this.materials.districtCoolant,
      this.contextRoot,
    );
    for (let index = 0; index < crossfeeds.length; index += 1) {
      const crossfeed = crossfeeds[index]!;
      if (crossfeedPipes) {
        this.setStraightRouteMatrix(
          crossfeedPipes,
          index,
          crossfeed.start,
          crossfeed.end,
        );
      }
    }
    if (crossfeedPipes) {
      crossfeedPipes.count = crossfeeds.length;
      crossfeedPipes.instanceMatrix.needsUpdate = true;
      crossfeedPipes.userData.nodeKeys = crossfeeds.map(
        (crossfeed) => crossfeed.key,
      );
      crossfeedPipes.userData.contextRole =
        "physical-process-crossfeed-from-control-spine-to-side-bays";
      crossfeedPipes.userData.notElectricalSupport = true;
    }

    const districtSpines =
      districtNodes.length === 0
        ? []
        : (() => {
            const minimumX =
              Math.min(...districtNodes.map((node) => node.x)) - 0.86;
            const maximumX =
              Math.max(...districtNodes.map((node) => node.x)) + 0.86;
            const centerZ =
              districtNodes.reduce((sum, node) => sum + node.z, 0) /
              districtNodes.length;
            return [-2.35, 2.35].map((offset) => ({
              offset,
              start: new THREE.Vector3(
                minimumX,
                0.215,
                centerZ + offset,
              ),
              end: new THREE.Vector3(
                maximumX,
                0.215,
                centerZ + offset,
              ),
            }));
          })();
    const spinePipes = this.ensureBatch(
      "district-parallel-process-spine",
      districtSpines.length,
      this.geometries.districtProcessHeader,
      this.materials.copper,
      this.contextRoot,
    );
    for (let index = 0; index < districtSpines.length; index += 1) {
      const spine = districtSpines[index]!;
      if (spinePipes) {
        this.setStraightRouteMatrix(
          spinePipes,
          index,
          spine.start,
          spine.end,
        );
      }
    }
    if (spinePipes) {
      spinePipes.count = districtSpines.length;
      spinePipes.instanceMatrix.needsUpdate = true;
      spinePipes.userData.contextRole =
        "continuous-district-process-spine-with-branch-bays";
      spinePipes.userData.notElectricalSupport = true;
    }

    const districtWires = wires
      .filter(
        (wire) =>
          wire.endpointA.isCircuitDevice &&
          wire.endpointB.isCircuitDevice,
      )
      .slice(0, Math.max(32, this.options.maxDetailedDevices * 4));
    const cableTray = this.ensureBatch(
      "district-cable-tray-segment",
      districtWires.length,
      this.geometries.districtCableTray,
      this.materials.darkMetal,
      this.contextRoot,
    );
    const deckSlab = this.ensureBatch(
      "district-control-cell-deck-slab",
      districtWires.length,
      this.geometries.districtDeckSlab,
      this.materials.serviceConcrete,
      this.contextRoot,
    );
    const deckGrating = this.ensureBatch(
      "district-control-cell-drain-grating",
      districtWires.length,
      this.geometries.districtDeckGrating,
      this.materials.darkMetal,
      this.contextRoot,
    );
    const processHeader = this.ensureBatch(
      "district-process-header-segment",
      districtWires.length,
      this.geometries.districtProcessHeader,
      this.materials.armor,
      this.contextRoot,
    );
    for (let index = 0; index < districtWires.length; index += 1) {
      const wire = districtWires[index]!;
      endpointAnchor(wire.endpointA, wire.color, this.tempStart);
      endpointAnchor(wire.endpointB, wire.color, this.tempEnd);
      this.tempStart.y = 0.035;
      this.tempEnd.y = 0.035;
      if (deckSlab) {
        this.setStraightRouteMatrix(
          deckSlab,
          index,
          this.tempStart,
          this.tempEnd,
        );
      }
      this.tempStart.y = 0.072;
      this.tempEnd.y = 0.072;
      if (deckGrating) {
        this.setStraightRouteMatrix(
          deckGrating,
          index,
          this.tempStart,
          this.tempEnd,
        );
      }
      this.tempStart.y = 0.115;
      this.tempEnd.y = 0.115;
      if (cableTray) {
        this.setStraightRouteMatrix(
          cableTray,
          index,
          this.tempStart,
          this.tempEnd,
        );
      }
      const deltaX = this.tempEnd.x - this.tempStart.x;
      const deltaZ = this.tempEnd.z - this.tempStart.z;
      const planarLength = Math.max(0.001, Math.hypot(deltaX, deltaZ));
      const offsetX = (-deltaZ / planarLength) * 0.17;
      const offsetZ = (deltaX / planarLength) * 0.17;
      this.tempStart.x += offsetX;
      this.tempStart.z += offsetZ;
      this.tempStart.y = 0.19;
      this.tempEnd.x += offsetX;
      this.tempEnd.z += offsetZ;
      this.tempEnd.y = 0.19;
      if (processHeader) {
        this.setStraightRouteMatrix(
          processHeader,
          index,
          this.tempStart,
          this.tempEnd,
        );
      }
    }
    for (const mesh of [
      deckSlab,
      deckGrating,
      cableTray,
      processHeader,
    ]) {
      if (!mesh) continue;
      mesh.count = districtWires.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.wires = districtWires.map((wire) => wire.key);
      mesh.userData.rendererOwnedIndustrialContext = true;
      mesh.userData.notElectricalSupport = true;
    }
    if (deckSlab) {
      deckSlab.userData.contextRole =
        "continuous-bolted-control-cell-service-deck";
    }
    if (deckGrating) {
      deckGrating.userData.contextRole =
        "continuous-open-drainage-grating-between-cabinets";
    }

    // Construction reach is short enough for suspended cabinet cable. The
    // earlier mid-span brackets read as diagram glyphs from the game camera;
    // presentation therefore leaves every route as one truthful catenary
    // between two physically bolted glands.
    const supportedWires: readonly VisualWire[] = Object.freeze([]);
    const supports = this.ensureBatch(
      "cable-support",
      supportedWires.length,
      this.geometries.cableSupport,
      this.materials.darkMetal,
      this.contextRoot,
    );
    if (supports) {
      const supportHeights: number[] = [];
      for (let index = 0; index < supportedWires.length; index += 1) {
        const wire = supportedWires[index]!;
        endpointAnchor(wire.endpointA, wire.color, this.tempStart);
        endpointAnchor(wire.endpointB, wire.color, this.tempEnd);
        const sag = wireSagForSpan(this.tempStart, this.tempEnd);
        const supportHeight = THREE.MathUtils.clamp(
          (this.tempStart.y + this.tempEnd.y) * 0.5 - sag,
          0.3,
          0.58,
        );
        this.tempObject.position
          .copy(this.tempStart)
          .add(this.tempEnd)
          .multiplyScalar(0.5);
        this.tempObject.position.y = 0.004;
        this.tempObject.rotation.set(
          0,
          Math.atan2(
            this.tempEnd.x - this.tempStart.x,
            this.tempEnd.z - this.tempStart.z,
          ),
          0,
        );
        this.tempObject.quaternion.setFromEuler(this.tempObject.rotation);
        this.tempObject.scale.set(1, supportHeight / 0.5, 1);
        this.tempObject.updateMatrix();
        supports.setMatrixAt(index, this.tempObject.matrix);
        supportHeights.push(supportHeight);
      }
      supports.count = supportedWires.length;
      supports.instanceMatrix.needsUpdate = true;
      supports.userData.wires = supportedWires.map((wire) => wire.key);
      supports.userData.supportHeights = supportHeights;
      supports.userData.grounded = true;
      supports.userData.cableContact = "midspan-saddle";
    }
    for (const color of ["red", "green"] as const) {
      const matching = supportedWires.filter(
        (wire) => wire.color === color,
      );
      const clips = this.ensureBatch(
        `cable-support-${color}-clip`,
        matching.length,
        this.geometries.cableClip,
        color === "red"
          ? this.materials.tracerRed
          : this.materials.tracerGreen,
        this.contextRoot,
      );
      if (!clips) continue;
      for (let index = 0; index < matching.length; index += 1) {
        const wire = matching[index]!;
        endpointAnchor(wire.endpointA, wire.color, this.tempStart);
        endpointAnchor(wire.endpointB, wire.color, this.tempEnd);
        const sag = wireSagForSpan(this.tempStart, this.tempEnd);
        const supportHeight = THREE.MathUtils.clamp(
          (this.tempStart.y + this.tempEnd.y) * 0.5 - sag,
          0.3,
          0.58,
        );
        this.tempObject.position
          .copy(this.tempStart)
          .add(this.tempEnd)
          .multiplyScalar(0.5);
        this.tempObject.position.y = supportHeight;
        this.tempObject.rotation.set(
          0,
          Math.atan2(
            this.tempEnd.x - this.tempStart.x,
            this.tempEnd.z - this.tempStart.z,
          ),
          0,
        );
        this.tempObject.quaternion.setFromEuler(this.tempObject.rotation);
        this.tempObject.scale.setScalar(1);
        this.tempObject.updateMatrix();
        clips.setMatrixAt(index, this.tempObject.matrix);
      }
      clips.count = matching.length;
      clips.instanceMatrix.needsUpdate = true;
      clips.userData.wires = matching.map((wire) => wire.key);
      clips.userData.physicalSeatContact = true;
      clips.userData.presentationRing = false;
    }
    return {
      servicePads: entities.length,
      cableSupports: supportedWires.length,
      districtModules: entities.length * 3,
      districtTraySegments: districtWires.length,
    };
  }

  private syncEndpoints(
    endpoints: readonly VisualEndpoint[],
    wires: readonly VisualWire[],
  ): { readonly junctions: number } {
    const degree = new Map<string, { red: number; green: number }>();
    for (const endpoint of endpoints) {
      degree.set(endpoint.endpointId, { red: 0, green: 0 });
    }
    for (const wire of wires) {
      for (const endpoint of [wire.endpointA, wire.endpointB]) {
        const counts = degree.get(endpoint.endpointId)!;
        counts[wire.color] += 1;
      }
    }

    this.fillEndpointBatch(
      "endpoint-base",
      endpoints,
      this.geometries.endpointBase,
      this.materials.armor,
      null,
      -0.045,
    );
    const redEndpoints = endpoints.filter(
      (endpoint) => (degree.get(endpoint.endpointId)?.red ?? 0) > 0,
    );
    const greenEndpoints = endpoints.filter(
      (endpoint) => (degree.get(endpoint.endpointId)?.green ?? 0) > 0,
    );
    const detailedTerminalHardware =
      endpoints.some((endpoint) => endpoint.isCircuitDevice) ||
      endpoints.length <= 256;
    this.fillEndpointBatch(
      "endpoint-red-collar",
      redEndpoints,
      this.geometries.endpointCollar,
      this.materials.tracerRed,
      "red",
      -0.065,
    );
    this.fillEndpointBatch(
      "endpoint-green-collar",
      greenEndpoints,
      this.geometries.endpointCollar,
      this.materials.tracerGreen,
      "green",
      -0.065,
    );
    this.fillEndpointBatch(
      "endpoint-red-insulator",
      detailedTerminalHardware ? redEndpoints : [],
      this.geometries.endpointInsulator,
      this.materials.ceramic,
      "red",
      -0.105,
    );
    this.fillEndpointBatch(
      "endpoint-green-insulator",
      detailedTerminalHardware ? greenEndpoints : [],
      this.geometries.endpointInsulator,
      this.materials.ceramic,
      "green",
      -0.105,
    );
    this.fillEndpointBatch(
      "endpoint-red-strain-relief",
      redEndpoints,
      this.geometries.endpointStrainRelief,
      this.materials.rubber,
      "red",
      -0.035,
    );
    this.fillEndpointBatch(
      "endpoint-green-strain-relief",
      greenEndpoints,
      this.geometries.endpointStrainRelief,
      this.materials.rubber,
      "green",
      -0.035,
    );
    this.fillEndpointBatch(
      "endpoint-red-positive-ferrule",
      redEndpoints,
      this.geometries.endpointFerrule,
      this.materials.tracerRed,
      "red",
      0,
    );
    this.fillEndpointBatch(
      "endpoint-green-positive-ferrule",
      greenEndpoints,
      this.geometries.endpointFerrule,
      this.materials.tracerGreen,
      "green",
      0,
    );

    const redJunctions = endpoints.filter(
      (endpoint) => (degree.get(endpoint.endpointId)?.red ?? 0) > 1,
    );
    const greenJunctions = endpoints.filter(
      (endpoint) => (degree.get(endpoint.endpointId)?.green ?? 0) > 1,
    );
    this.fillEndpointBatch(
      "junction-red",
      redJunctions,
      this.geometries.junction,
      this.materials.tracerRed,
      "red",
      0.055,
    );
    this.fillEndpointBatch(
      "junction-green",
      greenJunctions,
      this.geometries.junction,
      this.materials.tracerGreen,
      "green",
      0.055,
    );
    return { junctions: redJunctions.length + greenJunctions.length };
  }

  private fillEndpointBatch(
    key: string,
    endpoints: readonly VisualEndpoint[],
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    color: CircuitWireColor | null,
    yOffset: number,
  ): void {
    const mesh = this.ensureBatch(
      key,
      endpoints.length,
      geometry,
      material,
      this.endpointRoot,
    );
    if (!mesh) return;
    for (let index = 0; index < endpoints.length; index += 1) {
      const endpoint = endpoints[index]!;
      if (color) {
        endpointAnchor(endpoint, color, this.tempObject.position);
        this.tempObject.position.y += yOffset;
      } else {
        this.tempObject.position.set(
          endpoint.x,
          endpoint.height + yOffset,
          endpoint.z,
        );
      }
      this.tempObject.rotation.set(0, endpoint.yaw, 0);
      this.tempObject.quaternion.setFromEuler(this.tempObject.rotation);
      this.tempObject.scale.setScalar(
        (endpoint.connector === "io" ? 1.08 : 1) *
          Math.min(1.2, endpoint.attachmentScale),
      );
      this.tempObject.updateMatrix();
      mesh.setMatrixAt(index, this.tempObject.matrix);
    }
    mesh.count = endpoints.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.endpointIds = endpoints.map(
      (endpoint) => endpoint.endpointId,
    );
    mesh.userData.entityIds = endpoints.map(
      (endpoint) => endpoint.entityId,
    );
    mesh.userData.connectors = endpoints.map(
      (endpoint) => endpoint.connector,
    );
    mesh.userData.authoritativeFaces = endpoints.map((endpoint) => ({
      endpointId: endpoint.endpointId,
      connector: endpoint.connector,
      native: [endpoint.nativeX, endpoint.nativeZ],
      attachment: [endpoint.x, endpoint.z],
    }));
    mesh.userData.physicalAttachment = true;
    mesh.userData.presentationRing = false;
  }

  private syncDetailedRigs(
    entities: readonly CircuitRenderEntity[],
    circuit: CircuitSimulationSnapshot,
    endpoints: ReadonlyMap<string, VisualEndpoint>,
    elapsed: number,
  ): ReadonlyMap<number, DeviceVisualState> {
    const alive = new Set<number>();
    const states = new Map<number, DeviceVisualState>();
    for (const entity of entities) {
      alive.add(entity.id);
      const definition = deviceDefinitionForEntity(
        entity.id,
        endpoints,
        circuit.devices,
      );
      const state = deviceVisualState(
        entity,
        definition,
        endpoints,
      );
      states.set(entity.id, state);
      let rig = this.rigs.get(entity.id);
      if (!rig || rig.kind !== entity.kind) {
        if (rig) this.disposeDetailedRig(rig);
        rig = this.createDetailedRig(entity);
        this.rigs.set(entity.id, rig);
      }
      rig.root.position.set(entity.x + 0.5, 0, entity.z + 0.5);
      rig.root.rotation.y = directionYaw(entity.direction);
      rig.root.userData.entityId = entity.id;
      rig.root.userData.entityKind = entity.kind;
      rig.root.userData.deviceId = definition?.id ?? null;
      rig.root.userData.inputSignalCount = state.input.length;
      rig.root.userData.outputSignalCount = state.output.length;
      rig.root.userData.displaySignals = state.display.map((entry) => ({
        signal: signalKey(entry.signal),
        value: entry.value,
      }));
      rig.root.userData.operator =
        definition?.kind === "arithmetic"
          ? definition.operator
          : definition?.kind === "decider"
            ? definition.condition.operator
          : "constant";
      rig.root.userData.meterReadout = [...state.meter.lines];
      rig.root.userData.meterInputValue = state.meter.inputValue;
      rig.root.userData.meterOperandValue = state.meter.operandValue;
      rig.root.userData.meterOutputValue = state.meter.outputValue;
      rig.root.userData.visibleStateMapping =
        "authoritative-snapshot-to-integrated-electromechanical-meter";
      rig.active = state.active;
      rig.warning = state.warning;
      rig.operatorIndex = state.operatorIndex;
      rig.signalCount = state.display.length;
      rig.meterLines = state.meter.lines;
      this.syncMeterDisplay(rig, state);
      for (let index = 0; index < rig.operatorArms.length; index += 1) {
        const arm = rig.operatorArms[index]!;
        arm.rotation.y =
          (state.operatorIndex * Math.PI) / 12 +
          (index === 0 ? 0 : Math.PI / 2);
      }
    }
    for (const [entityId, rig] of this.rigs) {
      if (alive.has(entityId)) continue;
      this.disposeDetailedRig(rig);
      this.rigs.delete(entityId);
    }
    // Apply mechanics after every state assignment so a newly created rig is
    // already in the correct deterministic pose.
    this.updateRigsOnly(elapsed);
    return states;
  }

  private syncMeterDisplay(
    rig: DetailedRig,
    state: DeviceVisualState,
  ): void {
    const canvas = rig.meterTexture.userData.canvas as
      | HTMLCanvasElement
      | undefined;
    const context = canvas?.getContext("2d") ?? null;
    if (canvas && context) {
      const width = canvas.width;
      const height = canvas.height;
      const warning = rig.warning;
      const outputOn =
        rig.kind === "deciderCombinator" &&
        state.meter.outputValue !== 0;
      const accent = warning
        ? "#e16f5f"
        : outputOn
          ? "#8ce2ad"
          : "#f0c66a";
      const dimAccent = warning
        ? "#6b271f"
        : outputOn
          ? "#245e3c"
          : "#6a4b18";
      const gradient = context.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "#18201e");
      gradient.addColorStop(0.48, "#0d1312");
      gradient.addColorStop(1, "#080c0b");
      context.clearRect(0, 0, width, height);
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      context.strokeStyle = "#56605a";
      context.lineWidth = 10;
      context.strokeRect(8, 8, width - 16, height - 16);
      context.strokeStyle = "#252e2a";
      context.lineWidth = 3;
      for (let x = 40; x < width; x += 48) {
        context.beginPath();
        context.moveTo(x, 20);
        context.lineTo(x, height - 20);
        context.stroke();
      }
      for (const x of [26, width - 26]) {
        for (const y of [26, height - 26]) {
          context.fillStyle = "#9aa09a";
          context.beginPath();
          context.arc(x, y, 8, 0, Math.PI * 2);
          context.fill();
          context.strokeStyle = "#303633";
          context.lineWidth = 3;
          context.beginPath();
          context.moveTo(x - 5, y);
          context.lineTo(x + 5, y);
          context.stroke();
        }
      }
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.shadowBlur = 0;
      context.fillStyle = "#9aa59f";
      context.font =
        "800 38px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      const title =
        rig.kind === "constantCombinator"
          ? "SOURCE INPUT"
          : rig.kind === "arithmeticCombinator"
            ? "TWIN REGISTER ADDER"
            : "RELAY COMPARATOR";
      context.fillText(title, width * 0.5, 43);
      context.strokeStyle = dimAccent;
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(52, 70);
      context.lineTo(width - 52, 70);
      context.stroke();

      context.fillStyle = accent;
      context.font =
        "900 82px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      if (rig.kind === "constantCombinator") {
        context.fillText(
          `INPUT ${meterInteger(state.meter.inputValue, 3)}`,
          width * 0.5,
          133,
        );
        context.font =
          "900 98px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        context.fillText(
          `OUT ${meterInteger(state.meter.outputValue, 2)}`,
          width * 0.5,
          231,
        );
      } else if (rig.kind === "arithmeticCombinator") {
        context.fillText(
          `${meterInteger(state.meter.inputValue, 2)} ${
            state.meter.operator
          } ${meterInteger(state.meter.operandValue, 2)}`,
          width * 0.5,
          130,
        );
        context.font =
          "900 108px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        context.fillText(
          `= ${meterInteger(state.meter.outputValue, 3)}`,
          width * 0.5,
          230,
        );
      } else {
        context.fillText(
          `${meterInteger(state.meter.inputValue, 2)} ${
            state.meter.operator
          } ${meterInteger(state.meter.operandValue, 2)}`,
          width * 0.5,
          130,
        );
        context.font =
          "900 94px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        context.fillText(
          state.meter.outputValue === 0 ? "FALSE · OUT 0" : "TRUE · OUT 1",
          width * 0.5,
          232,
        );
      }
      rig.meterTexture.needsUpdate = true;
    }
    rig.meterDisplay.userData.entityId = rig.entityId;
    rig.meterDisplay.userData.readout = [...state.meter.lines];
    rig.meterDisplay.userData.inputValue = state.meter.inputValue;
    rig.meterDisplay.userData.operandValue = state.meter.operandValue;
    rig.meterDisplay.userData.outputValue = state.meter.outputValue;
    rig.meterDisplay.userData.operator = state.meter.operator;
    rig.meterDisplay.userData.authoritativeStateMapping = true;
    rig.meterDisplay.userData.integratedCabinetInstrument = true;
  }

  private disposeDetailedRig(rig: DetailedRig): void {
    rig.meterMaterial.dispose();
    rig.meterTexture.dispose();
    this.disposedMaterials += 1;
    this.disposedTextures += 1;
    rig.root.removeFromParent();
  }

  private updateRigsOnly(elapsedSeconds: number): void {
    for (const rig of this.rigs.values()) {
      const pace = rig.active ? 1 : 0.18;
      if (rig.kind === "constantCombinator") {
        const drum = rig.moving[0];
        if (drum) {
          drum.rotation.y =
            elapsedSeconds * pace * 2.2 +
            rig.signalCount * 0.37;
        }
        for (let index = 0; index < rig.toggles.length; index += 1) {
          rig.toggles[index]!.position.y =
            0.615 +
            (index < Math.min(3, rig.signalCount) ? 0.018 : 0);
        }
      } else if (rig.kind === "arithmeticCombinator") {
        if (rig.moving[0]) {
          rig.moving[0].rotation.y =
            elapsedSeconds * pace * 4.2 +
            rig.operatorIndex * 0.19;
        }
        if (rig.moving[1]) {
          rig.moving[1].rotation.y =
            -elapsedSeconds * pace * 4.2 -
            rig.operatorIndex * 0.19;
        }
        if (rig.moving[2]) {
          rig.moving[2].rotation.y =
            elapsedSeconds * pace * 6.3 +
            rig.operatorIndex * 0.27;
        }
      } else {
        if (rig.moving[0]) {
          rig.moving[0].rotation.z =
            rig.active
              ? Math.sin(elapsedSeconds * 2.4) * 0.045
              : (rig.operatorIndex - 2.5) * 0.018;
        }
        const opening = rig.active ? 0.055 : 0.012;
        if (rig.gateLeaves[0]) {
          rig.gateLeaves[0].position.x = -0.12 - opening;
        }
        if (rig.gateLeaves[1]) {
          rig.gateLeaves[1].position.x = 0.12 + opening;
        }
      }
      rig.status.material = rig.warning
        ? this.materials.warning
        : rig.active
          ? this.materials.active
          : this.materials.idle;
      rig.status.userData.state = rig.warning
        ? "warning"
        : rig.active
          ? "active"
          : "idle";
      rig.root.userData.macroMechanicalState = rig.warning
        ? "fault-latched"
        : rig.active
          ? rig.kind === "deciderCombinator"
            ? "comparator-relay-bank-pulled-in"
            : "register-mechanism-engaged"
          : rig.kind === "deciderCombinator"
            ? "comparator-relay-bank-released"
            : "register-mechanism-idle";
      rig.workingLight.intensity = rig.warning
        ? 0.34
        : rig.active
          ? 0.42
          : 0.035;
      rig.root.userData.panelDoorState =
        "sealed-weatherproof-meter-visible";
    }
  }

  private createDetailedRig(entity: CircuitRenderEntity): DetailedRig {
    const root = new THREE.Group();
    root.name = `circuit-${entity.kind}-rig`;
    const foundation = new THREE.Mesh(
      this.geometries.rigBase,
      this.materials.foundation,
    );
    foundation.name = "circuit-bolted-cast-foundation";
    foundation.scale.set(
      entity.kind === "constantCombinator"
        ? 0.92
        : entity.kind === "arithmeticCombinator"
          ? 1.12
          : 1.02,
      1,
      entity.kind === "constantCombinator"
        ? 0.98
        : entity.kind === "deciderCombinator"
          ? 1.2
          : 1.02,
    );
    foundation.castShadow = true;
    foundation.receiveShadow = true;
    root.add(foundation);

    const housingGeometry =
      entity.kind === "constantCombinator"
        ? this.geometries.constantHousing
        : entity.kind === "arithmeticCombinator"
          ? this.geometries.arithmeticHousing
          : this.geometries.deciderHousing;
    const housingMaterial =
      entity.kind === "constantCombinator"
        ? this.materials.constantHousing
        : entity.kind === "arithmeticCombinator"
          ? this.materials.arithmeticHousing
          : this.materials.deciderHousing;
    const metalGeometry =
      entity.kind === "constantCombinator"
        ? this.geometries.constantMetal
        : entity.kind === "arithmeticCombinator"
          ? this.geometries.arithmeticMetal
          : this.geometries.deciderMetal;
    const accentMaterial =
      entity.kind === "constantCombinator"
        ? this.materials.constantAccent
        : entity.kind === "arithmeticCombinator"
          ? this.materials.arithmeticAccent
          : this.materials.deciderAccent;
    const housing = new THREE.Mesh(housingGeometry, housingMaterial);
    housing.name = `circuit-${entity.kind}-weathered-cast-cabinet`;
    housing.scale.set(
      entity.kind === "constantCombinator"
        ? 0.96
        : entity.kind === "arithmeticCombinator"
          ? 1.07
          : 1,
      1,
      entity.kind === "constantCombinator"
        ? 0.98
        : entity.kind === "deciderCombinator"
          ? 1.13
          : 1.02,
    );
    housing.castShadow = true;
    housing.receiveShadow = true;
    const metal = new THREE.Mesh(metalGeometry, this.materials.titanium);
    metal.name = `circuit-${entity.kind}-panel-seams-bezels-fasteners`;
    metal.scale.copy(housing.scale);
    metal.castShadow = true;
    root.add(housing, metal);

    const meterZ =
      entity.kind === "constantCombinator"
        ? 0.24
        : entity.kind === "arithmeticCombinator"
          ? 0.4
          : -0.04;
    const meterAssembly = new THREE.Group();
    meterAssembly.name =
      `circuit-${entity.kind}-integrated-instrument-assembly`;
    meterAssembly.position.set(0, 0.685, meterZ);
    meterAssembly.rotation.y = -directionYaw(entity.direction);
    meterAssembly.scale.set(
      entity.kind === "constantCombinator"
        ? 0.88
        : entity.kind === "arithmeticCombinator"
          ? 1.06
          : 1.12,
      1,
      entity.kind === "constantCombinator"
        ? 1.02
        : entity.kind === "arithmeticCombinator"
          ? 0.94
          : 0.8,
    );
    meterAssembly.userData.panelForm =
      entity.kind === "constantCombinator"
        ? "narrow-source-setpoint-window"
        : entity.kind === "arithmeticCombinator"
          ? "wide-twin-register-window"
          : "shallow-relay-verdict-strip";
    const recessedMeter = new THREE.Mesh(
      this.geometries.meterWell,
      this.materials.meterFace,
    );
    recessedMeter.name =
      `circuit-${entity.kind}-integrated-electromechanical-meter-well`;
    recessedMeter.castShadow = true;
    recessedMeter.receiveShadow = true;
    meterAssembly.add(recessedMeter);
    const meterTexture = createMeterReadoutTexture(entity.kind);
    const meterMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: meterTexture,
      roughness: 0.48,
      metalness: 0.08,
      emissive: 0x241707,
      emissiveMap: meterTexture,
      emissiveIntensity: 0.08,
    });
    meterMaterial.name =
      `circuit-${entity.kind}-authoritative-instrument-face-material`;
    this.createdDynamicTextures += 1;
    this.createdDynamicMaterials += 1;
    const meterDisplay = new THREE.Mesh(
      this.geometries.meterScreen,
      meterMaterial,
    );
    meterDisplay.name =
      `circuit-${entity.kind}-authoritative-causal-meter-display`;
    meterDisplay.position.y = 0.034;
    meterDisplay.castShadow = false;
    meterDisplay.receiveShadow = false;
    meterAssembly.add(meterDisplay);
    const meterGlass = new THREE.Mesh(
      this.geometries.meterWell,
      this.materials.meterGlass,
    );
    meterGlass.name =
      `circuit-${entity.kind}-gasketed-inspection-meter-glass`;
    meterGlass.position.set(0, 0.052, 0);
    meterGlass.scale.set(0.965, 0.35, 0.9);
    meterGlass.castShadow = false;
    meterAssembly.add(meterGlass);
    const fastenerGrimePositions = [
      [-0.42, -0.17],
      [0.42, -0.17],
      [-0.42, 0.17],
      [0.42, 0.17],
    ] as const;
    for (const [index, [x, z]] of fastenerGrimePositions.entries()) {
      const fastenerGrime = new THREE.Mesh(
        this.geometries.groundWear,
        this.materials.groundWear,
      );
      fastenerGrime.name =
        `circuit-${entity.kind}-localized-fastener-grime-${index}`;
      fastenerGrime.position.set(x, 0.039, z);
      fastenerGrime.rotation.y =
        (entity.id * 0.41 + index * 0.93) % (Math.PI * 2);
      fastenerGrime.scale.set(0.085, 1, 0.034);
      fastenerGrime.castShadow = false;
      fastenerGrime.receiveShadow = false;
      fastenerGrime.userData.surfaceTreatment =
        "localized-fastener-oil-and-oxidation-halo";
      meterAssembly.add(fastenerGrime);
    }
    root.add(meterAssembly);
    const ventBank = new THREE.Mesh(
      this.geometries.endpointBase,
      this.materials.darkMetal,
    );
    ventBank.name = `circuit-${entity.kind}-recessed-service-vent-bank`;
    ventBank.position.set(0, 0.34, -0.405);
    ventBank.scale.set(
      entity.kind === "arithmeticCombinator" ? 1.48 : 1.15,
      0.72,
      0.46,
    );
    ventBank.castShadow = true;
    root.add(ventBank);

    const moving: THREE.Object3D[] = [];
    const operatorArms: THREE.Object3D[] = [];
    const toggles: THREE.Object3D[] = [];
    const gateLeaves: THREE.Object3D[] = [];
    if (entity.kind === "constantCombinator") {
      const drum = new THREE.Mesh(
        this.geometries.indexingDrum,
        this.materials.bronze,
      );
      drum.name = "circuit-constant-indexing-drum";
      drum.position.set(0, 0.555, -0.105);
      drum.scale.setScalar(0.68);
      moving.push(drum);
      root.add(drum);
      for (let index = 0; index < 3; index += 1) {
        const toggle = new THREE.Mesh(
          this.geometries.signalKey,
          index === 0 ? accentMaterial : this.materials.ceramic,
        );
        toggle.name = "circuit-constant-signal-key";
        toggle.position.set(-0.155 + index * 0.155, 0.615, -0.39);
        toggle.scale.setScalar(0.78);
        toggles.push(toggle);
        root.add(toggle);
      }
      for (const x of [-0.24, 0.24]) {
        const tower = new THREE.Mesh(
          this.geometries.signalKey,
          this.materials.ceramic,
        );
        tower.name =
          "circuit-constant-stepped-ceramic-source-terminal-tower";
        tower.position.set(x, 0.72, -0.34);
        tower.scale.set(1.28, 1.42, 1.28);
        tower.castShadow = true;
        root.add(tower);
        const crown = new THREE.Mesh(
          this.geometries.endpointFerrule,
          this.materials.copper,
        );
        crown.name =
          "circuit-constant-copper-terminal-crown-and-bus-link";
        crown.position.set(x, 0.86, -0.34);
        crown.scale.setScalar(0.82);
        crown.castShadow = true;
        root.add(crown);
      }
    } else if (entity.kind === "arithmeticCombinator") {
      for (const x of [-0.19, 0.19]) {
        const gear = new THREE.Mesh(
          this.geometries.gear,
          x < 0 ? this.materials.bronze : this.materials.titanium,
        );
        gear.name =
          x < 0
            ? "circuit-arithmetic-contained-register-rotor-a"
            : "circuit-arithmetic-contained-register-rotor-b";
        gear.position.set(x, 0.575, -0.11);
        gear.scale.setScalar(0.76);
        moving.push(gear);
        root.add(gear);
      }
      const differential = new THREE.Mesh(
        this.geometries.gear,
        this.materials.copper,
      );
      differential.name =
        "circuit-arithmetic-central-differential-transfer-gear";
      differential.position.set(0, 0.69, -0.11);
      differential.scale.setScalar(0.46);
      differential.castShadow = true;
      moving.push(differential);
      root.add(differential);
      for (const x of [-0.35, 0.35]) {
        const bearing = new THREE.Mesh(
          this.geometries.endpointInsulator,
          this.materials.ceramic,
        );
        bearing.name =
          "circuit-arithmetic-ceramic-register-shaft-bearing";
        bearing.position.set(x, 0.675, -0.11);
        bearing.scale.set(0.74, 0.86, 0.74);
        bearing.castShadow = true;
        root.add(bearing);
      }
      for (let index = 0; index < 2; index += 1) {
        const arm = new THREE.Mesh(
          this.geometries.operatorArm,
          accentMaterial,
        );
        arm.name = "circuit-arithmetic-operator-needle";
        arm.position.set(0, 0.69 + index * 0.012, -0.11);
        operatorArms.push(arm);
        root.add(arm);
      }
    } else {
      const beam = new THREE.Mesh(
        this.geometries.balanceBeam,
        this.materials.titanium,
      );
      beam.name = "circuit-decider-balance-beam";
      beam.position.set(0, 0.69, -0.25);
      beam.scale.set(0.78, 1, 0.72);
      moving.push(beam);
      root.add(beam);
      for (const x of [-0.12, 0.12]) {
        const leaf = new THREE.Mesh(
          this.geometries.gateLeaf,
          accentMaterial,
        );
        leaf.name = "circuit-decider-gate-leaf";
        leaf.position.set(x, 0.635, 0.035);
        leaf.scale.set(0.48, 1, 0.46);
        gateLeaves.push(leaf);
        root.add(leaf);
      }
      const solenoidRail = new THREE.Mesh(
        this.geometries.endpointBase,
        this.materials.darkMetal,
      );
      solenoidRail.name =
        "circuit-decider-bolted-relay-solenoid-mounting-rail";
      solenoidRail.position.set(0, 0.675, -0.36);
      solenoidRail.scale.set(1.38, 0.55, 0.54);
      solenoidRail.castShadow = true;
      root.add(solenoidRail);
      for (let index = 0; index < 3; index += 1) {
        const solenoid = new THREE.Mesh(
          this.geometries.signalKey,
          index === 1
            ? accentMaterial
            : index === 0
              ? this.materials.ceramic
              : this.materials.copper,
        );
        solenoid.name =
          "circuit-decider-exposed-comparator-solenoid-bank";
        solenoid.position.set(-0.2 + index * 0.2, 0.75, -0.36);
        solenoid.scale.set(0.78, 1.05, 0.78);
        solenoid.castShadow = true;
        root.add(solenoid);
      }
      for (const x of [-0.21, 0.21]) {
        const relayCrown = new THREE.Mesh(
          this.geometries.indexingDrum,
          x < 0 ? this.materials.bronze : this.materials.titanium,
        );
        relayCrown.name =
          "circuit-decider-crowned-mechanical-relay-drum";
        relayCrown.position.set(x, 0.665, -0.21);
        relayCrown.scale.set(0.42, 0.62, 0.42);
        relayCrown.castShadow = true;
        root.add(relayCrown);
      }
    }
    const faceHardware = new THREE.Mesh(
      this.geometries.cabinetFaceHardware,
      this.materials.titanium,
    );
    faceHardware.name =
      `circuit-${entity.kind}-engraved-bezel-latch-seams-fasteners`;
    faceHardware.position.set(0, 0.66, meterZ);
    faceHardware.scale.set(
      entity.kind === "constantCombinator"
        ? 0.76
        : entity.kind === "arithmeticCombinator"
          ? 0.96
          : 1,
      1,
      entity.kind === "constantCombinator"
        ? 0.68
        : entity.kind === "deciderCombinator"
          ? 0.5
          : 0.56,
    );
    faceHardware.castShadow = true;
    root.add(faceHardware);
    const wearPositions: readonly (readonly [
      number,
      number,
      number,
      number,
    ])[] =
      entity.kind === "constantCombinator"
        ? [
            [-0.22, -0.16, 0.14, 0.04],
            [0.18, 0.38, 0.09, 0.03],
            [-0.035, -0.3, 0.12, 0.028],
          ]
        : entity.kind === "arithmeticCombinator"
          ? [
              [0.2, -0.18, 0.13, 0.035],
              [-0.16, 0.45, 0.09, 0.03],
              [0.025, -0.32, 0.15, 0.032],
            ]
          : [
              [-0.19, 0.42, 0.13, 0.035],
              [0.2, -0.42, 0.09, 0.028],
              [0.045, 0.34, 0.12, 0.03],
            ];
    for (const [index, position] of wearPositions.entries()) {
      const wear = new THREE.Mesh(
        this.geometries.groundWear,
        index === 0 ? this.materials.rust : this.materials.groundWear,
      );
      wear.name = `circuit-${entity.kind}-localized-service-wear-${index}`;
      wear.position.set(position[0], 0.672 + index * 0.001, position[1]);
      wear.rotation.y =
        (entity.id * 0.73 + index * 1.81) % (Math.PI * 2);
      wear.scale.set(position[2], 1, position[3]);
      wear.castShadow = false;
      wear.receiveShadow = false;
      root.add(wear);
    }
    const status = new THREE.Mesh(
      this.geometries.statusLens,
      this.materials.idle,
    );
    status.name = "circuit-device-status-lens";
    status.position.set(
      entity.kind === "constantCombinator"
        ? -0.29
        : entity.kind === "arithmeticCombinator"
          ? 0.3
          : 0.285,
      0.775,
      entity.kind === "deciderCombinator" ? -0.27 : 0.26,
    );
    status.castShadow = false;
    root.add(status);
    const workingLight = new THREE.PointLight(
      entity.kind === "constantCombinator"
        ? 0xe4af50
        : entity.kind === "arithmeticCombinator"
          ? 0xee7d3c
          : 0x65c6a7,
      0,
      2,
      2,
    );
    workingLight.name =
      `circuit-${entity.kind}-localized-instrument-working-light`;
    workingLight.position.set(0, 1.02, meterZ);
    workingLight.castShadow = false;
    root.add(workingLight);
    root.userData.presentationProfile =
      "physical-industrial-cabinet-no-floating-signal-primitives";
    root.userData.authoredSurface =
      "/assets/cinder-painted-steel-aged-v2.png";
    root.userData.hasPanelSeams = true;
    root.userData.hasFasteners = true;
    root.userData.hasMountingFeet = true;
    root.userData.hasVents = true;
    root.userData.hasIntegratedCausalMeter = true;
    root.userData.silhouetteFamily =
      entity.kind === "constantCombinator"
        ? "compact-terminal-and-drum-source"
        : entity.kind === "arithmeticCombinator"
          ? "guarded-twin-register-mechanical-adder"
          : "relay-bank-comparator-with-crowned-profile";
    this.rigRoot.add(root);
    return {
      entityId: entity.id,
      kind: entity.kind,
      root,
      status,
      moving,
      operatorArms,
      toggles,
      gateLeaves,
      meterDisplay,
      meterTexture,
      meterMaterial,
      workingLight,
      active: false,
      warning: false,
      operatorIndex: 0,
      signalCount: 0,
      meterLines: Object.freeze([]),
    };
  }

  private syncOverview(
    entities: readonly CircuitRenderEntity[],
  ): void {
    for (const kind of Object.keys(KIND_ORDER) as CircuitEntityKind[]) {
      const matching = entities.filter((entity) => entity.kind === kind);
      const geometry =
        kind === "constantCombinator"
          ? this.geometries.overviewConstant
          : kind === "arithmeticCombinator"
            ? this.geometries.overviewArithmetic
            : this.geometries.overviewDecider;
      const material =
        kind === "constantCombinator"
          ? this.materials.constantHousing
          : kind === "arithmeticCombinator"
            ? this.materials.arithmeticHousing
            : this.materials.deciderHousing;
      const mesh = this.ensureBatch(
        `overview-${kind}`,
        matching.length,
        geometry,
        material,
        this.overviewRoot,
      );
      if (!mesh) continue;
      for (let index = 0; index < matching.length; index += 1) {
        const entity = matching[index]!;
        this.tempObject.position.set(
          entity.x + 0.5,
          0,
          entity.z + 0.5,
        );
        this.tempObject.rotation.set(
          0,
          directionYaw(entity.direction),
          0,
        );
        this.tempObject.quaternion.setFromEuler(this.tempObject.rotation);
        this.tempObject.scale.setScalar(1);
        this.tempObject.updateMatrix();
        mesh.setMatrixAt(index, this.tempObject.matrix);
      }
      mesh.count = matching.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.entityIds = matching.map((entity) => entity.id);
    }
  }

  private syncMachinePorts(
    circuit: CircuitSimulationSnapshot,
    endpoints: ReadonlyMap<string, VisualEndpoint>,
    connectedEndpointIds: ReadonlySet<string>,
  ): MachinePortVisual[] {
    const controls = new Map(
      circuit.machineControls.map((control) => [
        control.portId,
        control,
      ]),
    );
    const ports = [...circuit.machinePorts]
      .sort((left, right) => compareText(left.id, right.id))
      .flatMap((port): MachinePortVisual[] => {
        const endpoint = endpoints.get(port.inputEndpoint);
        const configured = machinePortConfigured(port);
        if (
          !endpoint ||
          (!configured &&
            !connectedEndpointIds.has(endpoint.endpointId))
        ) {
          return [];
        }
        return [{
          port,
          endpoint,
          control: controls.get(port.id),
          configured,
        }];
      });
    this.fillMachinePortBase(ports);
    this.fillMachineUmbilicals(ports);
    this.fillMachineControlBatches(ports);
    this.syncMachineProcessRigs(ports);
    return ports;
  }

  private fillMachineUmbilicals(
    ports: readonly MachinePortVisual[],
  ): void {
    const routed = ports.filter(
      (entry) =>
        Math.hypot(
          entry.endpoint.nativeX - entry.endpoint.x,
          entry.endpoint.nativeZ - entry.endpoint.z,
        ) > 0.08,
    );
    const mesh = this.ensureBatch(
      "machine-port-armored-umbilical",
      routed.length,
      this.geometries.machineUmbilical,
      this.materials.rubber,
      this.portRoot,
    );
    if (!mesh) return;
    for (let index = 0; index < routed.length; index += 1) {
      const endpoint = routed[index]!.endpoint;
      this.tempStart.set(
        endpoint.x,
        endpoint.height + 0.02,
        endpoint.z,
      );
      this.tempEnd.set(
        endpoint.nativeX,
        endpoint.height + 0.02,
        endpoint.nativeZ,
      );
      this.setRouteMatrix(
        mesh,
        index,
        this.tempStart,
        this.tempEnd,
        0.035,
      );
    }
    mesh.count = routed.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.portIds = routed.map((entry) => entry.port.id);
    mesh.userData.entityIds = routed.map(
      (entry) => entry.endpoint.entityId,
    );
    mesh.userData.physicalRoute =
      "bolted-port-to-authoritative-machine-work-bay";
    mesh.userData.hasAnimatedPackets = false;
  }

  private fillMachinePortBase(
    ports: readonly MachinePortVisual[],
  ): void {
    const clamp = this.ensureBatch(
      "machine-port-clamp",
      ports.length,
      this.geometries.machineClamp,
      this.materials.armor,
      this.portRoot,
    );
    if (!clamp) return;
    for (let index = 0; index < ports.length; index += 1) {
      const endpoint = ports[index]!.endpoint;
      this.tempObject.position.set(
        endpoint.x,
        endpoint.height - 0.055,
        endpoint.z,
      );
      this.tempObject.rotation.set(0, endpoint.yaw, 0);
      this.tempObject.quaternion.setFromEuler(this.tempObject.rotation);
      this.tempObject.scale.setScalar(
        0.94 * Math.min(1.2, endpoint.attachmentScale),
      );
      this.tempObject.updateMatrix();
      clamp.setMatrixAt(index, this.tempObject.matrix);
    }
    clamp.count = ports.length;
    clamp.instanceMatrix.needsUpdate = true;
    clamp.userData.portIds = ports.map((entry) => entry.port.id);
    clamp.userData.entityIds = ports.map(
      (entry) => entry.endpoint.entityId,
    );
    clamp.userData.physicalAttachment =
      "bolted-directly-to-machine-control-surface";
  }

  private fillMachineControlBatches(
    ports: readonly MachinePortVisual[],
  ): void {
    const enabled = ports.filter(
      (entry) => entry.control?.enabled === true,
    );
    const disabled = ports.filter(
      (entry) => entry.control?.enabled === false,
    );
    const unknown = ports.filter((entry) => !entry.control);
    this.fillPortStateBatch(
      "machine-port-enabled",
      enabled,
      this.materials.titanium,
      0.34,
    );
    this.fillPortStateBatch(
      "machine-port-disabled",
      disabled,
      this.materials.darkMetal,
      -0.34,
    );
    this.fillPortStateBatch(
      "machine-port-unresolved",
      unknown,
      this.materials.idle,
      0,
    );
    const powerClosed = ports.filter(
      (entry) =>
        entry.port.powerSwitchCondition !== null &&
        entry.control?.powerSwitchClosed === true,
    );
    const powerOpen = ports.filter(
      (entry) =>
        entry.port.powerSwitchCondition !== null &&
        entry.control?.powerSwitchClosed === false,
    );
    this.fillPortLampBatch(
      "machine-port-power-closed",
      powerClosed,
      this.materials.deciderAccent,
      -0.14,
    );
    this.fillPortLampBatch(
      "machine-port-power-open",
      powerOpen,
      this.materials.warning,
      -0.14,
    );

    const sorterA = ports.filter(
      (entry) => entry.control?.sorterOutput === "A",
    );
    const sorterB = ports.filter(
      (entry) => entry.control?.sorterOutput === "B",
    );
    this.fillPortLampBatch(
      "machine-port-sorter-a",
      sorterA,
      this.materials.constantAccent,
      0.14,
    );
    this.fillPortLampBatch(
      "machine-port-sorter-b",
      sorterB,
      this.materials.arithmeticAccent,
      0.14,
    );
  }

  private syncMachineProcessRigs(
    ports: readonly MachinePortVisual[],
  ): void {
    const represented = ports.filter(
      (entry) => entry.configured && entry.control !== undefined,
    );
    const alive = new Set<string>();
    for (const entry of represented) {
      alive.add(entry.port.id);
      let rig = this.machineRigs.get(entry.port.id);
      if (!rig || rig.entityId !== entry.endpoint.entityId) {
        rig?.root.removeFromParent();
        rig = this.createMachineProcessRig(entry);
        this.machineRigs.set(entry.port.id, rig);
      }
      rig.root.position.set(
        entry.endpoint.x,
        0,
        entry.endpoint.z,
      );
      rig.root.rotation.y = entry.endpoint.yaw;
      const scale = THREE.MathUtils.clamp(
        entry.endpoint.attachmentScale * 0.43,
        0.58,
        1.02,
      );
      rig.root.scale.setScalar(scale);
      rig.enabled =
        entry.control?.enabled === true &&
        entry.control.powerSwitchClosed === true;
      rig.configured = entry.configured;
      rig.root.userData.portId = entry.port.id;
      rig.root.userData.entityId = entry.endpoint.entityId;
      rig.root.userData.machineEntityId = entry.endpoint.entityId;
      rig.root.userData.enabled = rig.enabled;
      rig.root.userData.actualConnectedMachineResponse = true;
      rig.root.userData.responseChannels = rig.enabled
        ? Object.freeze([
            "driven-flywheel",
            "reciprocating-ram",
            "hot-process-bank",
            "visible-product-path",
            "localized-working-light",
            "process-exhaust",
            "opened-macro-process-guards",
            "incandescent-process-core",
            "driven-output-rollers",
          ])
        : Object.freeze([
            "parked-flywheel",
            "retracted-ram",
            "cold-process-bank",
            "empty-product-path",
            "dark-working-light",
            "no-exhaust",
            "closed-macro-process-guards",
            "cold-shuttered-process-core",
            "parked-output-rollers",
          ]);
    }
    for (const [portId, rig] of this.machineRigs) {
      if (alive.has(portId)) continue;
      rig.root.removeFromParent();
      this.machineRigs.delete(portId);
    }
  }

  private createMachineProcessRig(
    entry: MachinePortVisual,
  ): MachineProcessRig {
    const root = new THREE.Group();
    root.name = "circuit-machine-integrated-authoritative-process-response";
    const skid = new THREE.Mesh(
      this.geometries.machineProcessSkid,
      this.materials.foundation,
    );
    skid.name = "circuit-machine-load-bearing-production-drive-skid";
    skid.castShadow = true;
    skid.receiveShadow = true;
    root.add(skid);

    const flywheel = new THREE.Mesh(
      this.geometries.machineFlywheel,
      this.materials.bronze,
    );
    flywheel.name = "circuit-machine-driven-production-flywheel";
    flywheel.position.set(-0.68, 0.32, -0.18);
    flywheel.scale.setScalar(0.72);
    flywheel.castShadow = true;
    root.add(flywheel);

    const crank = new THREE.Mesh(
      this.geometries.machineCrank,
      this.materials.titanium,
    );
    crank.name = "circuit-machine-positive-drive-crank";
    crank.position.set(-0.5, 0.41, -0.18);
    crank.scale.setScalar(0.7);
    crank.castShadow = true;
    root.add(crank);

    const piston = new THREE.Mesh(
      this.geometries.machinePiston,
      this.materials.copper,
    );
    piston.name = "circuit-machine-reciprocating-process-ram";
    piston.position.set(-0.1, 0.36, -0.18);
    piston.scale.setScalar(0.72);
    piston.castShadow = true;
    root.add(piston);

    const processCore = new THREE.Mesh(
      this.geometries.machineProcessCore,
      this.materials.processCold,
    );
    processCore.name =
      "circuit-machine-macro-readable-authoritative-process-core";
    processCore.position.set(0.08, 0.8, -0.16);
    processCore.scale.setScalar(0.82);
    processCore.castShadow = true;
    root.add(processCore);

    const guardShutters: THREE.Mesh[] = [];
    for (const side of [-1, 1] as const) {
      const shutter = new THREE.Mesh(
        this.geometries.machineGuardShutter,
        this.materials.guardClosed,
      );
      shutter.name =
        "circuit-machine-authoritative-sliding-process-guard";
      shutter.position.set(side * 0.23, 0.94, -0.16);
      shutter.rotation.y = side < 0 ? Math.PI : 0;
      shutter.scale.set(0.94, 1, 0.92);
      shutter.castShadow = true;
      shutter.userData.side = side;
      guardShutters.push(shutter);
      root.add(shutter);
    }

    const chute = new THREE.Mesh(
      this.geometries.machineProductChute,
      this.materials.armor,
    );
    chute.name = "circuit-machine-physical-product-output-path";
    chute.position.set(0.62, 0.16, 0.46);
    chute.rotation.y = -0.12;
    chute.castShadow = true;
    chute.receiveShadow = true;
    root.add(chute);

    const outputRollers: THREE.Object3D[] = [];
    for (let index = 0; index < 5; index += 1) {
      const roller = new THREE.Mesh(
        this.geometries.machineOutputRoller,
        index % 2 === 0
          ? this.materials.titanium
          : this.materials.bronze,
      );
      roller.name = "circuit-machine-driven-output-roller";
      roller.position.set(0.62, 0.27, 0.19 + index * 0.135);
      roller.rotation.y = -0.12;
      roller.scale.setScalar(0.72);
      roller.castShadow = true;
      outputRollers.push(roller);
      root.add(roller);
    }

    const products: THREE.Object3D[] = [];
    for (let index = 0; index < 6; index += 1) {
      const product = new THREE.Mesh(
        this.geometries.machineProduct,
        this.materials.processProduct,
      );
      product.name = "circuit-machine-authoritative-visible-product";
      product.position.set(
        0.62,
        0.345,
        0.18 + index * 0.105,
      );
      product.rotation.y = -0.12;
      product.scale.setScalar(1.18);
      product.castShadow = true;
      products.push(product);
      root.add(product);
    }

    const stack = new THREE.Mesh(
      this.geometries.machineExhaustStack,
      this.materials.darkMetal,
    );
    stack.name = "circuit-machine-connected-process-exhaust-stack";
    stack.position.set(-0.68, 0, 0.48);
    stack.castShadow = true;
    stack.receiveShadow = true;
    root.add(stack);

    const heatBanks: THREE.Mesh[] = [];
    for (const z of [-0.58, -0.38, -0.18]) {
      const heatBank = new THREE.Mesh(
        this.geometries.machineHeatBank,
        this.materials.processCold,
      );
      heatBank.name = "circuit-machine-authoritative-process-heat-bank";
      heatBank.position.set(0.54, 0.38, z);
      heatBank.scale.setScalar(1.12);
      heatBank.castShadow = true;
      heatBanks.push(heatBank);
      root.add(heatBank);
    }

    const statusLens = new THREE.Mesh(
      this.geometries.statusLens,
      this.materials.disabled,
    );
    statusLens.name = "circuit-machine-integrated-working-contact-lens";
    statusLens.position.set(0.76, 0.72, -0.53);
    statusLens.scale.setScalar(3.2);
    root.add(statusLens);

    const vapor: THREE.Sprite[] = [];
    for (let index = 0; index < 3; index += 1) {
      const plume = new THREE.Sprite(this.materials.processVapor);
      plume.name = "circuit-machine-authoritative-process-exhaust";
      plume.position.set(
        -0.68 + index * 0.055,
        0.95 + index * 0.18,
        0.48 + index * 0.035,
      );
      plume.scale.setScalar(0.42 + index * 0.13);
      plume.visible = false;
      plume.raycast = () => {};
      plume.userData.plumeIndex = index;
      vapor.push(plume);
      root.add(plume);
    }

    const workingLight = new THREE.PointLight(
      0xff9b46,
      0,
      4.8,
      2,
    );
    workingLight.name =
      "circuit-machine-localized-authoritative-working-light";
    workingLight.position.set(0.46, 0.86, -0.42);
    workingLight.castShadow = false;
    root.add(workingLight);

    root.userData.portId = entry.port.id;
    root.userData.entityId = entry.endpoint.entityId;
    root.userData.physicallyIntegrated = true;
    root.userData.presentation =
      "actual-connected-machine-production-response-not-overlay";
    this.portRoot.add(root);
    return {
      portId: entry.port.id,
      entityId: entry.endpoint.entityId,
      root,
      flywheel,
      crank,
      piston,
      products,
      heatBanks,
      vapor,
      processCore,
      guardShutters,
      outputRollers,
      statusLens,
      workingLight,
      enabled: false,
      configured: true,
    };
  }

  private updateMachineRigsOnly(elapsedSeconds: number): void {
    for (const rig of this.machineRigs.values()) {
      if (rig.enabled) {
        const phase = elapsedSeconds * 5.2;
        rig.flywheel.rotation.y = phase;
        rig.crank.rotation.y = phase;
        rig.piston.position.x = -0.1 + Math.sin(phase) * 0.095;
        rig.processCore.material = this.materials.processHot;
        rig.processCore.rotation.y = phase * 0.42;
        rig.processCore.scale.setScalar(
          0.8 + Math.sin(phase * 0.5) * 0.025,
        );
        for (const shutter of rig.guardShutters) {
          const side = shutter.userData.side as number;
          shutter.position.x = side * 0.55;
          shutter.position.y = 0.88;
          shutter.position.z = -0.16 + side * 0.035;
          shutter.rotation.z = side * -0.08;
          shutter.material = this.materials.districtGuard;
        }
        for (let index = 0; index < rig.outputRollers.length; index += 1) {
          const roller = rig.outputRollers[index]!;
          roller.rotation.x = phase * 1.15 + index * 0.48;
        }
        for (let index = 0; index < rig.products.length; index += 1) {
          const product = rig.products[index]!;
          product.visible = true;
          product.position.z =
            0.16 +
            ((elapsedSeconds * 0.31 + index * 0.12) % 0.64);
        }
        for (const heatBank of rig.heatBanks) {
          heatBank.material = this.materials.processHot;
        }
        for (let index = 0; index < rig.vapor.length; index += 1) {
          const plume = rig.vapor[index]!;
          plume.visible = true;
          plume.position.y =
            0.94 +
            index * 0.16 +
            ((elapsedSeconds * 0.16 + index * 0.11) % 0.18);
          plume.position.x =
            -0.68 + Math.sin(elapsedSeconds * 0.8 + index) * 0.055;
          plume.scale.setScalar(
            0.56 +
              index * 0.17 +
              Math.sin(elapsedSeconds * 0.9 + index) * 0.045,
          );
        }
        rig.statusLens.material = this.materials.active;
        rig.workingLight.intensity = 2.65;
        rig.root.userData.mechanicalMotion = "running";
        rig.root.userData.processHeat = "hot";
        rig.root.userData.productPath = "occupied-moving";
        rig.root.userData.exhaust = "flowing";
        rig.root.userData.macroVisualState =
          "guards-open-core-incandescent-output-rollers-loaded";
      } else {
        rig.flywheel.rotation.y = 0.18;
        rig.crank.rotation.y = -0.35;
        rig.piston.position.x = -0.24;
        rig.processCore.material = this.materials.processCold;
        rig.processCore.rotation.y = 0;
        rig.processCore.scale.setScalar(0.72);
        for (const shutter of rig.guardShutters) {
          const side = shutter.userData.side as number;
          shutter.position.x = side * 0.22;
          shutter.position.y = 0.94;
          shutter.position.z = -0.16;
          shutter.rotation.z = 0;
          shutter.material = this.materials.guardClosed;
        }
        for (let index = 0; index < rig.outputRollers.length; index += 1) {
          rig.outputRollers[index]!.rotation.x = index * 0.12;
        }
        for (const product of rig.products) product.visible = false;
        for (const heatBank of rig.heatBanks) {
          heatBank.material = this.materials.processCold;
        }
        for (const plume of rig.vapor) plume.visible = false;
        rig.statusLens.material = this.materials.disabled;
        rig.workingLight.intensity = 0;
        rig.root.userData.mechanicalMotion = "parked";
        rig.root.userData.processHeat = "cold";
        rig.root.userData.productPath = "empty";
        rig.root.userData.exhaust = "stopped";
        rig.root.userData.macroVisualState =
          "guards-closed-core-cold-output-rollers-empty";
      }
    }
  }

  private fillPortStateBatch(
    key: string,
    ports: readonly MachinePortVisual[],
    material: THREE.Material,
    rotation: number,
  ): void {
    const mesh = this.ensureBatch(
      key,
      ports.length,
      this.geometries.machineLever,
      material,
      this.portRoot,
    );
    if (!mesh) return;
    for (let index = 0; index < ports.length; index += 1) {
      const endpoint = ports[index]!.endpoint;
      this.tempObject.position.set(
        endpoint.x,
        endpoint.height + 0.15,
        endpoint.z,
      );
      this.tempObject.rotation.set(0, endpoint.yaw + rotation, 0);
      this.tempObject.quaternion.setFromEuler(this.tempObject.rotation);
      this.tempObject.scale.setScalar(
        Math.min(1.2, endpoint.attachmentScale),
      );
      this.tempObject.updateMatrix();
      mesh.setMatrixAt(index, this.tempObject.matrix);
    }
    mesh.count = ports.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.portIds = ports.map((entry) => entry.port.id);
    mesh.userData.entityIds = ports.map(
      (entry) => entry.endpoint.entityId,
    );
    mesh.userData.positiveActionSwitch = true;
  }

  private fillPortLampBatch(
    key: string,
    ports: readonly MachinePortVisual[],
    material: THREE.Material,
    localX: number,
  ): void {
    const mesh = this.ensureBatch(
      key,
      ports.length,
      this.geometries.routeLamp,
      material,
      this.portRoot,
    );
    if (!mesh) return;
    for (let index = 0; index < ports.length; index += 1) {
      const endpoint = ports[index]!.endpoint;
      this.tempObject.position.set(
        endpoint.x + localX,
        endpoint.height + 0.19,
        endpoint.z + 0.1,
      );
      this.tempObject.quaternion.identity();
      this.tempObject.scale.setScalar(1);
      this.tempObject.updateMatrix();
      mesh.setMatrixAt(index, this.tempObject.matrix);
    }
    mesh.count = ports.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.portIds = ports.map((entry) => entry.port.id);
    mesh.userData.entityIds = ports.map(
      (entry) => entry.endpoint.entityId,
    );
  }

  private syncSignalIndicators(
    detailedEntities: readonly CircuitRenderEntity[],
    states: ReadonlyMap<number, DeviceVisualState>,
    machinePorts: readonly MachinePortVisual[],
  ): number {
    let representedSignals = 0;
    for (const entity of detailedEntities) {
      const state = states.get(entity.id);
      if (!state) continue;
      representedSignals += Math.min(
        state.display.length,
        this.options.maxSignalsPerDevice,
      );
    }
    for (const entry of machinePorts) {
      if (entry.control?.filterSignal) representedSignals += 1;
    }
    this.signalRoot.userData.presentation =
      "signals-contained-in-cabinet-mechanics-and-restrained-leds";
    this.signalRoot.userData.floatingPrimitives = false;
    this.signalRoot.userData.representedSignals = representedSignals;
    return representedSignals;
  }

  private setRouteMatrix(
    mesh: THREE.InstancedMesh,
    index: number,
    start: THREE.Vector3,
    end: THREE.Vector3,
    sag: number,
  ): void {
    this.tempDirection.copy(end).sub(start);
    const length = this.tempDirection.length();
    this.tempObject.position
      .copy(start)
      .add(end)
      .multiplyScalar(0.5);
    this.tempObject.quaternion.setFromUnitVectors(
      Z_AXIS,
      this.tempDirection.normalize(),
    );
    this.tempObject.scale.set(
      1,
      sag / WIRE_REFERENCE_SAG,
      Math.max(0.001, length),
    );
    this.tempObject.updateMatrix();
    mesh.setMatrixAt(index, this.tempObject.matrix);
  }

  private setStraightRouteMatrix(
    mesh: THREE.InstancedMesh,
    index: number,
    start: THREE.Vector3,
    end: THREE.Vector3,
  ): void {
    this.tempDirection.copy(end).sub(start);
    const length = this.tempDirection.length();
    this.tempObject.position
      .copy(start)
      .add(end)
      .multiplyScalar(0.5);
    this.tempObject.quaternion.setFromUnitVectors(
      Z_AXIS,
      this.tempDirection.normalize(),
    );
    this.tempObject.scale.set(1, 1, Math.max(0.001, length));
    this.tempObject.updateMatrix();
    mesh.setMatrixAt(index, this.tempObject.matrix);
  }

  private ensureBatch(
    key: string,
    count: number,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    parent: THREE.Object3D,
  ): THREE.InstancedMesh | null {
    const existing = this.batches.get(key);
    if (count === 0) {
      if (existing) {
        existing.mesh.count = 0;
        existing.mesh.userData = {};
      }
      return existing?.mesh ?? null;
    }
    if (
      existing &&
      existing.capacity >= count &&
      existing.geometry === geometry &&
      existing.material === material
    ) {
      return existing.mesh;
    }
    if (existing) {
      existing.mesh.removeFromParent();
      existing.mesh.dispose();
      this.disposedInstancedMeshes += 1;
      this.batches.delete(key);
    }
    const capacity = powerOfTwoCapacity(count);
    const mesh = new THREE.InstancedMesh(
      geometry,
      material,
      capacity,
    );
    mesh.name = `circuit-${key}`;
    mesh.castShadow =
      key.includes("overview") ||
      key.includes("wire-") ||
      key.includes("endpoint-base") ||
      key.includes("positive-ferrule") ||
      key.includes("machine-port-clamp") ||
      key.includes("process-pod") ||
      key.includes("cooling-cell") ||
      key.includes("cooling-rotor") ||
      key.includes("valve-cluster") ||
      key.includes("perimeter-rail");
    mesh.receiveShadow = !key.includes("pulse");
    mesh.frustumCulled = false;
    parent.add(mesh);
    this.batches.set(key, {
      key,
      mesh,
      geometry,
      material,
      parent,
      capacity,
    });
    return mesh;
  }

  private batchCapacity(key: string): number {
    return this.batches.get(key)?.capacity ?? 0;
  }

  private refreshResourceDebug(): void {
    this.debug = Object.freeze({
      ...this.debug,
      resources: Object.freeze({
        ownedGeometries: this.geometries.all.length,
        ownedMaterials:
          this.materials.all.length + this.createdDynamicMaterials,
        liveInstancedMeshes: this.batches.size,
        disposedGeometries: this.disposedGeometries,
        disposedMaterials: this.disposedMaterials,
        ownedTextures:
          this.materials.textures.length + this.createdDynamicTextures,
        disposedTextures: this.disposedTextures,
        disposedInstancedMeshes: this.disposedInstancedMeshes,
      }),
    });
  }

  private assertLive(): void {
    if (this.disposed) {
      throw new Error("Circuit renderer is disposed.");
    }
  }
}
