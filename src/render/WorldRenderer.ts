import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
  BlueprintOverlayRenderer,
  type BlueprintOverlayRenderDebug,
} from './BlueprintOverlayRenderer';
import type {
  BlueprintCaptureMarquee,
  BlueprintOverlayLayout,
} from './blueprintOverlay';
import {
  FluidRenderer,
  type FluidRenderDebug,
  type FluidVisualEntity,
  type FluidVisualFrame,
} from './FluidRenderer';
import {
  CircuitRenderer,
  type CircuitRenderDebug,
  type CircuitVisualFrame,
} from './CircuitRenderer';
import type { RailNetworkSnapshot } from '../game/rail-network';
import {
  RailRendererIntegrationAdapter,
  type RailPickTarget,
  type RailRenderDebug,
} from './RailRenderer';

export type RenderEntityKind =
  | 'belt'
  | 'manifold'
  | 'extractor'
  | 'inserter'
  | 'smelter'
  | 'fabricator'
  | 'generator'
  | 'storage'
  | 'beacon'
  | 'gridRelay';

type MachineResponseKind = Exclude<
  RenderEntityKind,
  'belt' | 'manifold' | 'gridRelay'
>;

export type RenderDirection =
  | 0
  | 1
  | 2
  | 3
  | 'north'
  | 'east'
  | 'south'
  | 'west';

export type RenderEntityId = string | number;

export type RenderProcessState =
  | 'unconfigured'
  | 'starved'
  | 'working'
  | 'queued'
  | 'output-blocked'
  | 'no-power'
  | 'idle';

export interface RenderEntity {
  id: RenderEntityId;
  kind: RenderEntityKind;
  x: number;
  z: number;
  direction?: RenderDirection;
  active?: boolean;
  powered?: boolean;
  progress?: number;
  status?: 'idle' | 'working' | 'blocked' | 'unpowered' | 'damaged';
  tier?: number;
  health?: number;
  recipe?: string;
  /** Authoritative machine-process state; present only on production machines. */
  processState?: RenderProcessState;
  /** Current or in-flight process identity. Auto-smelt is the literal "auto". */
  processRecipe?: string;
  /** Queued process identity. Queued Auto-smelt is the literal "auto". */
  pendingRecipe?: string;
  /** Source-only transition inventory, rendered independently of process state. */
  reclaimCount?: number;
  resourceKind?: string;
  carriedItem?: string;
  carriedItemColor?: THREE.ColorRepresentation;
  armReturning?: boolean;
  /** Inserter pickup/drop contacts in local right/forward-plane coordinates. */
  pickupContact?: readonly [number, number];
  dropContact?: readonly [number, number];
  routingMode?: 'even' | 'favorA' | 'favorB' | 'extract';
  routingFilter?: string;
  routingSplitCursors?: readonly [0 | 1, 0 | 1];
  routingMergeCursors?: readonly [0 | 1, 0 | 1];
  routingActivePort?: 0 | 1;
  routingCommonCount?: number;
  routingPortCounts?: readonly [number, number];
  powerRelayId?: number | null;
  powerNetworkId?: number | null;
  uplink?: boolean;
  /**
   * Authoritative Uplink manifest entries. `kind` accepts the same stable item
   * identifiers as belt cargo; counts come from campaign custody, never from a
   * renderer-owned approximation.
   */
  uplinkCustodyManifest?: readonly {
    kind: string;
    count: number;
    target?: number;
  }[];
  /** Authoritative total units held in Uplink custody. */
  uplinkCustodyCount?: number;
  /**
   * Real delivery animation phase from exposed dock (0) to secured buffer (1).
   * The campaign owns this transient and advances it after itemTransferred.
   */
  uplinkTransferProgress?: number;
  /** ItemId-compatible identity currently owned by the transfer mechanism. */
  uplinkTransferItem?: string;
  /**
   * Empty-return leg: progress 0 starts latched inboard and progress 1 ends
   * ready at the belt interface. No transfer item is required on this leg.
   */
  uplinkTransferReturning?: boolean;
  /** Campaign readiness request; physical custody and interlock still gate it. */
  uplinkTransmissionActive?: boolean;
}

export interface RenderResource {
  id?: RenderEntityId;
  kind: string;
  x: number;
  z: number;
  amount?: number;
  radius?: number;
  depleted?: boolean;
}

export interface RenderBeltItem {
  id?: RenderEntityId;
  kind: string;
  x: number;
  z: number;
  direction?: RenderDirection;
  lane?: number;
  progress?: number;
  port?: 0 | 1;
  carrier?: 'belt' | 'manifold';
  color?: THREE.ColorRepresentation;
}

export interface RenderBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RenderPowerGridRelayCenter {
  relayId: number;
  x: number;
  z: number;
  networkId: number | null;
}

export interface RenderPowerGridLink {
  relayAId: number;
  relayBId: number;
}

export interface RenderPowerGridSnapshot {
  mode: 'global' | 'local';
  halfExtent: number;
  cableReach: number;
  relayCenters: readonly RenderPowerGridRelayCenter[];
  relayLinks: readonly RenderPowerGridLink[];
}

export interface RenderSnapshot {
  tick?: number;
  elapsed?: number;
  bounds?: RenderBounds;
  entities: readonly RenderEntity[];
  resources?: readonly RenderResource[];
  beltItems?: readonly RenderBeltItem[];
  powerGrid?: RenderPowerGridSnapshot;
  fluidEntities?: readonly FluidVisualEntity[];
  fluidNetwork?: FluidVisualFrame['fluidNetwork'];
  circuit?: CircuitVisualFrame['circuit'];
  circuitEntities?: CircuitVisualFrame['circuitEntities'];
  rail?: RailNetworkSnapshot | null;
}

export type RenderQuality = 'high' | 'performance';

export interface GridPoint {
  x: number;
  z: number;
}

const EMPTY_FLUID_NETWORK: FluidVisualFrame['fluidNetwork'] = {
  nodes: [],
  edges: [],
  components: [],
};

const EMPTY_CIRCUIT_NETWORK: CircuitVisualFrame['circuit'] = {
  tick: 0,
  workUnits: 0,
  topology: {
    components: [],
    wires: [],
    endpointComponents: [],
  },
  endpoints: [],
  wires: [],
  devices: [],
  machinePorts: [],
  machineControls: [],
};

type BeltTurn = 'straight' | 'left' | 'right';
type ItemVisualKind = 'ore' | 'ingot' | 'coil' | 'component';

interface GhostState {
  kind: RenderEntityKind;
  x: number;
  z: number;
  direction: RenderDirection;
  valid: boolean;
  reason?: string;
}

interface MaterialPalette {
  carbon: THREE.MeshStandardMaterial;
  carbonDark: THREE.MeshStandardMaterial;
  foundation: THREE.MeshStandardMaterial;
  uplinkApron: THREE.MeshStandardMaterial;
  titanium: THREE.MeshStandardMaterial;
  titaniumLight: THREE.MeshStandardMaterial;
  ceramic: THREE.MeshStandardMaterial;
  ceramicDark: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  amber: THREE.MeshStandardMaterial;
  copper: THREE.MeshStandardMaterial;
  copperBright: THREE.MeshStandardMaterial;
  industrialPanel: THREE.MeshStandardMaterial;
  fabricatorPanel: THREE.MeshStandardMaterial;
  agedCopper: THREE.MeshStandardMaterial;
  agedCeramic: THREE.MeshStandardMaterial;
  uplinkPainted: THREE.MeshStandardMaterial;
  uplinkCast: THREE.MeshStandardMaterial;
  uplinkConcrete: THREE.MeshStandardMaterial;
  signalTemplate: THREE.MeshStandardMaterial;
  heatTemplate: THREE.MeshStandardMaterial;
  violet: THREE.MeshStandardMaterial;
  groundRock: THREE.MeshStandardMaterial;
  stain: THREE.ShaderMaterial;
  scorch: THREE.ShaderMaterial;
  housing: Record<MachineResponseKind, THREE.MeshStandardMaterial>;
  housingMaterials: THREE.MeshStandardMaterial[];
  surfaceTextures: THREE.Texture[];
}

interface SurfaceMaps {
  color: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
}

interface MachineResponseMaps {
  normal: THREE.CanvasTexture;
  response: THREE.CanvasTexture;
}

interface BeltSurface {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  material: THREE.MeshStandardMaterial;
  turn: BeltTurn;
  active: boolean;
}

interface RigParts {
  surface?: THREE.Mesh;
  beltTurn?: BeltTurn;
  beltGridX?: number;
  beltGridZ?: number;
  beltDirectionIndex?: number;
  previousProgress?: number;
  previousAuxPhase?: number;
  cycleFlash?: number;
  carrying?: boolean;
  previousCarriedItem?: string;
  rollers?: THREE.Object3D[];
  beltRollerCaps?: THREE.Object3D[][];
  manifoldSurfaces?: THREE.Mesh[];
  manifoldRollers?: THREE.Object3D[];
  manifoldVane?: THREE.Object3D;
  manifoldShutters?: [THREE.Object3D, THREE.Object3D];
  manifoldShutterFaceMaterials?: [
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
  ];
  manifoldPortLamps?: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial];
  manifoldCoreMaterial?: THREE.MeshStandardMaterial;
  manifoldSelectorMaterial?: THREE.MeshStandardMaterial;
  manifoldFilterToken?: THREE.Mesh;
  manifoldFilterTokenMaterial?: THREE.MeshStandardMaterial;
  manifoldFilterMark?: THREE.Mesh;
  manifoldActuatorGear?: THREE.Object3D;
  manifoldSelectorTip?: THREE.Object3D;
  manifoldNeutralFork?: THREE.Object3D;
  manifoldDisplayedPort?: 0 | 1;
  manifoldTargetPort?: 0 | 1;
  manifoldSwitchProgress?: number;
  rotor?: THREE.Object3D;
  cutters?: THREE.Object3D[];
  outputChute?: THREE.Object3D;
  outputGlow?: THREE.Mesh;
  extractorFeet?: THREE.InstancedMesh;
  extractorCarriage?: THREE.Object3D;
  extractorMotor?: THREE.Object3D;
  extractorMotorRotor?: THREE.Object3D;
  extractorDrillLandmark?: THREE.Object3D;
  extractorContactAnchor?: THREE.Object3D;
  extractorFloorOpening?: THREE.Object3D;
  extractorChipCrown?: THREE.Object3D;
  extractorChipMaterial?: THREE.MeshStandardMaterial;
  extractorDustRing?: THREE.Mesh;
  extractorMovingMaterial?: THREE.MeshStandardMaterial;
  extractorGantryMaterial?: THREE.MeshStandardMaterial;
  extractorOutputContactAnchor?: THREE.Object3D;
  extractorChuteMouthAnchor?: THREE.Object3D;
  extractorChuteGateAnchor?: THREE.Object3D;
  extractorChuteLip?: THREE.Object3D;
  extractorStatusLamp?: THREE.Mesh;
  extractorUnloadLinkage?: THREE.Object3D;
  extractorWear?: THREE.InstancedMesh;
  armYaw?: THREE.Object3D;
  wristCarriage?: THREE.Object3D;
  wristExtension?: THREE.Object3D;
  gripper?: THREE.Object3D;
  gripperJaws?: [THREE.Object3D, THREE.Object3D];
  gripperHookTips?: [THREE.Object3D, THREE.Object3D];
  gripperTipAnchors?: [THREE.Object3D, THREE.Object3D];
  heldItem?: THREE.Object3D;
  heldItemVariants?: Partial<Record<ItemVisualKind, THREE.Object3D>>;
  heldItemMaterial?: THREE.MeshStandardMaterial;
  fans?: THREE.Object3D[];
  furnaceDoor?: THREE.Object3D;
  crucibleRing?: THREE.Mesh;
  crucibleGlow?: THREE.Mesh;
  doorGlow?: THREE.Mesh;
  heatVents?: THREE.Mesh[];
  dischargeGlow?: THREE.Mesh;
  flashCore?: THREE.Mesh;
  turntable?: THREE.Object3D;
  carriageA?: THREE.Object3D;
  carriageB?: THREE.Object3D;
  fabricatorGearTrain?: THREE.Object3D;
  fabricatorMotorRotor?: THREE.Object3D;
  fabricatorArc?: THREE.Mesh;
  heroCoreGlow?: THREE.Mesh;
  recipeMechanismRotor?: THREE.Object3D;
  recipeMechanismActuator?: THREE.Object3D;
  recipeFeedStock?: THREE.Object3D;
  recipeProductShuttle?: THREE.Object3D;
  processSignalRoot?: THREE.Group;
  processPlaque?: THREE.Object3D;
  processPendingPlaque?: THREE.Object3D;
  processGlyphRoot?: THREE.Group;
  processPendingGlyphRoot?: THREE.Group;
  processRecipeGlyphs?: Map<string, THREE.Object3D>;
  processPendingRecipeGlyphs?: Map<string, THREE.Object3D>;
  processGlyphIngot?: THREE.Object3D;
  processGlyphBars?: THREE.Object3D;
  processGlyphRing?: THREE.Object3D;
  processGlyphGearTeeth?: THREE.Object3D;
  processGlyphWireTails?: THREE.Object3D;
  processGlyphBoard?: THREE.Object3D;
  processGlyphBoardNodes?: THREE.Object3D;
  processGlyphCore?: THREE.Object3D;
  processGlyphCoreOrbit?: THREE.Object3D;
  processGlyphAuto?: THREE.Object3D;
  processUnconfigured?: THREE.Object3D;
  processInputLatch?: THREE.Object3D;
  processChamberPulse?: THREE.Object3D;
  processQueueBridge?: THREE.Object3D;
  processQueueShuttle?: THREE.Object3D;
  processOutputGate?: THREE.Object3D;
  processPowerBreaker?: THREE.Object3D;
  processIdleReady?: THREE.Object3D;
  processStateWitnessRoot?: THREE.Group;
  processStateWitnesses?: Map<RenderProcessState, THREE.Object3D>;
  processReclaimBin?: THREE.Object3D;
  processReclaimToken?: THREE.Object3D;
  processGlyphMaterial?: THREE.MeshStandardMaterial;
  processGlyphAccentMaterial?: THREE.MeshStandardMaterial;
  processAmberMaterial?: THREE.MeshStandardMaterial;
  processTealMaterial?: THREE.MeshStandardMaterial;
  processRedMaterial?: THREE.MeshStandardMaterial;
  flywheel?: THREE.Object3D;
  generatorCoil?: THREE.Mesh;
  exhaustCaps?: THREE.Object3D[];
  ringA?: THREE.Object3D;
  ringB?: THREE.Object3D;
  hatch?: THREE.Object3D;
  gridRelayCoil?: THREE.Object3D;
  gridRelayFluxRing?: THREE.Object3D;
  gridRelayLamp?: THREE.Mesh;
  gridRelayLampMaterial?: THREE.MeshStandardMaterial;
  uplinkAzimuthAssembly?: THREE.Object3D;
  uplinkElevationAssembly?: THREE.Object3D;
  uplinkAzimuthGear?: THREE.Object3D;
  uplinkSelectionIndicators?: THREE.Object3D[];
  uplinkSignalMaterial?: THREE.MeshStandardMaterial;
  uplinkLinkMaterial?: THREE.MeshStandardMaterial;
  uplinkFeedPulse?: THREE.Object3D;
  uplinkCargoGate?: THREE.Object3D;
  uplinkTransferCarriage?: THREE.Object3D;
  uplinkTransferArms?: [THREE.Object3D, THREE.Object3D];
  uplinkTransferJaws?: [THREE.Object3D, THREE.Object3D];
  uplinkTransferPayload?: THREE.Object3D;
  uplinkTransferPayloadVariants?: Map<string, THREE.Object3D>;
  uplinkTransferPayloadCarrier?: THREE.Object3D;
  uplinkTransferClamps?: [THREE.Object3D, THREE.Object3D];
  uplinkTransferActuatorRod?: THREE.Mesh;
  uplinkTransferRail?: THREE.Object3D;
  uplinkTransferScissors?: [THREE.Object3D, THREE.Object3D];
  uplinkIntakeCanopy?: THREE.Object3D;
  uplinkCustodyChamber?: THREE.Object3D;
  uplinkCustodyDoors?: [THREE.Object3D, THREE.Object3D];
  uplinkCustodySeal?: THREE.Object3D;
  uplinkCustodyLockingBars?: [THREE.Object3D, THREE.Object3D];
  uplinkCustodyVaultContents?: THREE.Object3D;
  uplinkCustodyPressureMaterial?: THREE.MeshStandardMaterial;
  uplinkCustodyFeed?: THREE.Object3D;
  uplinkCustodyFeedMaterial?: THREE.MeshStandardMaterial;
  uplinkOutgoingBeam?: THREE.Object3D;
  uplinkTransmissionPackets?: THREE.Object3D[];
  uplinkAcknowledgementBeam?: THREE.Object3D;
  uplinkAcknowledgementPackets?: THREE.Object3D[];
  uplinkTransmissionReceiver?: THREE.Object3D;
  uplinkTransmissionReceiverRings?: THREE.Object3D[];
  uplinkCarrierStatusMaterial?: THREE.MeshStandardMaterial;
  uplinkCavityLightMaterial?: THREE.MeshStandardMaterial;
  uplinkDockGuide?: THREE.Object3D;
  uplinkDockHoverChevrons?: THREE.Object3D;
  uplinkDockGuideMaterial?: THREE.MeshStandardMaterial;
  uplinkDockBeaconMaterial?: THREE.MeshStandardMaterial;
  uplinkDockBeaconLight?: THREE.PointLight;
  uplinkTransmissionCapacitor?: THREE.Object3D;
  uplinkTransmissionCapacitorMaterial?: THREE.MeshStandardMaterial;
  uplinkTransmissionStateLamps?: [
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
  ];
  uplinkTransmissionShutters?: [
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
  ];
  uplinkAcknowledgementLatch?: THREE.Object3D;
  uplinkCustodyBuffer?: THREE.Object3D;
  uplinkCustodySlots?: THREE.Object3D[];
  uplinkCustodySlotVariants?: Array<Map<string, THREE.Object3D>>;
  uplinkCustodyItems?: THREE.Object3D[];
  uplinkCustodyCountIndicators?: THREE.Object3D[];
  uplinkCustodyMaterial?: THREE.MeshStandardMaterial;
  uplinkEffectMaterial?: THREE.MeshStandardMaterial;
}

interface EntityRig {
  root: THREE.Group;
  kind: RenderEntityKind;
  variant: 'standard' | 'automation-core' | 'uplink';
  quality: RenderQuality;
  entity: RenderEntity;
  phaseOffset: number;
  parts: RigParts;
  lamps: THREE.MeshStandardMaterial[];
  processMaterials: THREE.MeshStandardMaterial[];
  ownedMaterials: THREE.Material[];
}

interface ResourceRig {
  group: THREE.Group;
  auraMaterial: THREE.MeshBasicMaterial;
  ownedMaterials: THREE.Material[];
}

interface Particle {
  alive: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
  age: number;
  life: number;
  startSize: number;
  endSize: number;
  drag: number;
  gravity: number;
}

interface ItemBucket {
  mesh: THREE.InstancedMesh;
  count: number;
}

interface InserterPerformanceBatches {
  root: THREE.Group;
  base: THREE.InstancedMesh;
  arm: THREE.InstancedMesh;
  wrist: THREE.InstancedMesh;
  jaws: THREE.InstancedMesh;
  signal: THREE.InstancedMesh;
  payloads: Record<ItemVisualKind, THREE.InstancedMesh>;
  entityIds: RenderEntityId[];
  jawEntityIds: RenderEntityId[];
  payloadEntityIds: Record<ItemVisualKind, RenderEntityId[]>;
}

interface ProcessSignalPerformanceBatches {
  root: THREE.Group;
  plaques: THREE.InstancedMesh;
  bars: THREE.InstancedMesh;
  rings: THREE.InstancedMesh;
  octahedra: THREE.InstancedMesh;
  tokens: THREE.InstancedMesh;
  entityIds: {
    plaques: RenderEntityId[];
    bars: RenderEntityId[];
    rings: RenderEntityId[];
    octahedra: RenderEntityId[];
    tokens: RenderEntityId[];
  };
  signatures: Map<RenderEntityId, {
    state: RenderProcessState;
    stateSignature: string | null;
    recipe: string | null;
    recipeSignature: string | null;
    pendingRecipe: string | null;
    pendingRecipeSignature: string | null;
    reclaim: boolean;
  }>;
}

interface GridRelayPerformanceBatches {
  root: THREE.Group;
  bases: THREE.InstancedMesh;
  masts: THREE.InstancedMesh;
  insulators: THREE.InstancedMesh;
  coils: THREE.InstancedMesh;
  lamps: THREE.InstancedMesh;
  entityIds: {
    bases: RenderEntityId[];
    masts: RenderEntityId[];
    insulators: RenderEntityId[];
    coils: RenderEntityId[];
    lamps: RenderEntityId[];
  };
}

interface PowerGridVisualLink {
  relayAId: number;
  relayBId: number;
  networkId: number | null;
  a: THREE.Vector3;
  b: THREE.Vector3;
  sag: number;
}

interface PowerGridBatches {
  root: THREE.Group;
  cables: THREE.InstancedMesh;
  cableShadows: THREE.InstancedMesh;
  pulses: THREE.InstancedMesh;
}

interface PowerGridSelectionVisuals {
  root: THREE.Group;
  coverageFill: THREE.Mesh;
  coverage: THREE.LineSegments;
  links: THREE.InstancedMesh;
}

interface DetailInstance {
  position: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number];
}

interface DetailBeam {
  from: [number, number, number];
  to: [number, number, number];
  radius: number;
}

const PROCESS_RECIPE_SIGNATURES: Readonly<Record<string, string>> = {
  auto: 'dual-ore-auto-furnace-selector',
  smeltIron: 'solid-silver-plate-die',
  smeltCopper: 'ribbed-copper-plate-die',
  fireBrick: 'five-brick-bond-die',
  ironGear: 'solid-eight-tooth-gear-die',
  copperWire: 'thick-copper-spool-die',
  circuit: 'green-three-node-board-die',
  automationCore: 'green-hex-cyan-rotor-core-die',
};

function processRecipeSignalSignature(
  recipe: string | null | undefined,
): string | null {
  return recipe === null || recipe === undefined
    ? null
    : PROCESS_RECIPE_SIGNATURES[recipe] ?? null;
}

const CAMERA_ELEVATION = Math.atan2(18, 9);
const CAMERA_DISTANCE = 34;
const DEFAULT_VIEW_WIDTH = 38;
const MIN_VIEW_WIDTH = 22;
const MAX_VIEW_WIDTH = 72;
// Keep close inspection authored, but collapse unselected overview signals
// into the shared five-batch vocabulary. The gap is deliberate hysteresis:
// small wheel deltas around the boundary must not flicker representation.
const PROCESS_SIGNAL_OVERVIEW_ENTER_WIDTH = 34;
const PROCESS_SIGNAL_OVERVIEW_EXIT_WIDTH = 30;
const HIGH_SHADOW_NEAR_HERO_ENTER_DISTANCE = 1.25;
const HIGH_SHADOW_NEAR_HERO_EXIT_DISTANCE = 1.75;
const MAX_HIGH_SHADOW_NEAR_HEROES = 2;
const PROCESS_RECIPE_STATION_X = 0.44;
const PROCESS_RECIPE_STATION_Z = -0.34;
const PROCESS_RECIPE_PLAQUE_Y = 0.84;
const PROCESS_RECIPE_GLYPH_Y = 0.946;
const PROCESS_RECIPE_PAIR_CURRENT_X = 0.285;
const PROCESS_RECIPE_PAIR_PENDING_X = 0.595;
const PROCESS_RECIPE_PAIR_SCALE = 0.58;
const WORLD_SIZE = 180;
const MAX_BELT_ITEMS = 4096;
const MAX_PARTICLES = 420;
const MAX_PERFORMANCE_INSERTERS = 2048;
const MAX_PERFORMANCE_PROCESS_MACHINES = 2048;
const MAX_PERFORMANCE_GRID_RELAYS = 2048;
const MAX_POWER_GRID_LINKS = 4096;
const POWER_GRID_CABLE_SEGMENTS = 12;
const MAX_POWER_GRID_SELECTED_LINKS = 128;
const POWER_GRID_TERMINAL_HEIGHT = 1.42;
const POWER_GRID_TERMINAL_OFFSET = 0.32;
const UNIT_Y = new THREE.Vector3(0, 1, 0);
const NORTH = new THREE.Vector2(0, -1);
const EAST = new THREE.Vector2(1, 0);
const SOUTH = new THREE.Vector2(0, 1);
const WEST = new THREE.Vector2(-1, 0);
const DIRECTION_VECTORS = [NORTH, EAST, SOUTH, WEST] as const;
const DIRECTION_ANGLES = [0, -Math.PI / 2, Math.PI, Math.PI / 2] as const;
const ENTITY_FOOTPRINTS: Record<RenderEntityKind, readonly [number, number]> = {
  belt: [1, 1],
  manifold: [1, 2],
  extractor: [2, 2],
  inserter: [1, 1],
  smelter: [2, 2],
  fabricator: [3, 2],
  generator: [2, 2],
  storage: [2, 2],
  beacon: [2, 2],
  gridRelay: [1, 1],
};

function directionIndex(direction: RenderDirection | undefined): number {
  if (typeof direction === 'number') return ((Math.round(direction) % 4) + 4) % 4;
  switch (direction) {
    case 'east':
      return 1;
    case 'south':
      return 2;
    case 'west':
      return 3;
    default:
      return 0;
  }
}

function directionVector(direction: RenderDirection | undefined): THREE.Vector2 {
  return DIRECTION_VECTORS[directionIndex(direction)] ?? NORTH;
}

function directionAngle(direction: RenderDirection | undefined): number {
  return DIRECTION_ANGLES[directionIndex(direction)] ?? 0;
}

function fract(value: number): number {
  return value - Math.floor(value);
}

const POWER_NETWORK_COLORS = [
  '#53d5c2',
  '#7ea8e8',
  '#a87bd8',
  '#d29a52',
  '#78bd7b',
] as const;

function powerNetworkColor(networkId: number | null): THREE.ColorRepresentation {
  if (networkId === null) return '#667274';
  return POWER_NETWORK_COLORS[
    Math.abs(Math.trunc(networkId)) % POWER_NETWORK_COLORS.length
  ] ?? POWER_NETWORK_COLORS[0];
}

function easeInOut(value: number): number {
  const x = THREE.MathUtils.clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(seed: number): number {
  let value = seed + 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function macroNoise(x: number, z: number): number {
  const broad = Math.sin(x * 0.081 + Math.cos(z * 0.047) * 1.7);
  const cross = Math.cos(z * 0.093 - Math.sin(x * 0.033) * 2.1);
  const fine = Math.sin((x + z) * 0.31) * 0.24;
  return (broad + cross + fine) / 2.24;
}

function makeCanvas(size: number): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A 2D canvas context is required for renderer utility maps.');
  return { canvas, context };
}

function createSurfaceMaps(
  profile: 'painted' | 'brushed' | 'ceramic',
  seed: number,
): SurfaceMaps {
  const size = 128;
  const colorSurface = makeCanvas(size);
  const roughnessSurface = makeCanvas(size);
  const colorContext = colorSurface.context;
  const roughnessContext = roughnessSurface.context;
  const colorBase = profile === 'ceramic'
    ? [235, 231, 221]
    : profile === 'brushed'
      ? [239, 241, 238]
      : [231, 234, 231];
  const roughnessBase = profile === 'ceramic' ? 245 : profile === 'brushed' ? 224 : 232;

  colorContext.fillStyle = `rgb(${colorBase.join(',')})`;
  colorContext.fillRect(0, 0, size, size);
  roughnessContext.fillStyle = `rgb(${roughnessBase},${roughnessBase},${roughnessBase})`;
  roughnessContext.fillRect(0, 0, size, size);

  // Keep the variation broad enough to read as panel character at gameplay
  // scale. Fine noise aliases under an orthographic camera and makes the
  // shared materials look flatter once mipmapped.
  const panelGradient = colorContext.createLinearGradient(0, 0, size, size);
  if (profile === 'ceramic') {
    panelGradient.addColorStop(0, 'rgba(89,78,59,0.11)');
    panelGradient.addColorStop(0.46, 'rgba(255,255,247,0)');
    panelGradient.addColorStop(1, 'rgba(255,248,229,0.075)');
  } else {
    panelGradient.addColorStop(0, 'rgba(24,34,35,0.125)');
    panelGradient.addColorStop(0.52, 'rgba(255,255,248,0)');
    panelGradient.addColorStop(1, 'rgba(255,255,248,0.085)');
  }
  colorContext.fillStyle = panelGradient;
  colorContext.fillRect(0, 0, size, size);

  const roughnessGradient = roughnessContext.createLinearGradient(0, size, size, 0);
  roughnessGradient.addColorStop(0, 'rgba(174,174,174,0.12)');
  roughnessGradient.addColorStop(0.5, `rgba(${roughnessBase},${roughnessBase},${roughnessBase},0)`);
  roughnessGradient.addColorStop(1, 'rgba(255,255,255,0.1)');
  roughnessContext.fillStyle = roughnessGradient;
  roughnessContext.fillRect(0, 0, size, size);

  const blotchCount = profile === 'ceramic' ? 18 : 22;
  for (let index = 0; index < blotchCount; index += 1) {
    const x = seededUnit(seed + index * 41) * size;
    const y = seededUnit(seed + index * 47 + 3) * size;
    const radius = 12 + seededUnit(seed + index * 53 + 7) * (profile === 'ceramic' ? 24 : 20);
    const shade = (seededUnit(seed + index * 59 + 11) - 0.5) * (profile === 'ceramic' ? 26 : 20);
    const gradient = colorContext.createRadialGradient(x, y, 0, x, y, radius);
    if (profile === 'ceramic') {
      const warmth = seededUnit(seed + index * 61 + 13);
      gradient.addColorStop(
        0,
        `rgba(${Math.round(126 + warmth * 18)},${Math.round(111 + warmth * 12)},${Math.round(84 + warmth * 9)},${0.07 + warmth * 0.075})`,
      );
    } else {
      const tone = Math.round(190 + shade);
      gradient.addColorStop(0, `rgba(${tone},${tone + 3},${tone + 2},0.16)`);
    }
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    colorContext.fillStyle = gradient;
    colorContext.fillRect(x - radius, y - radius, radius * 2, radius * 2);

    const roughTone = THREE.MathUtils.clamp(
      Math.round(roughnessBase + shade * 1.25),
      202,
      255,
    );
    const roughGradient = roughnessContext.createRadialGradient(x, y, 0, x, y, radius * 1.2);
    roughGradient.addColorStop(0, `rgba(${roughTone},${roughTone},${roughTone},0.38)`);
    roughGradient.addColorStop(1, `rgba(${roughnessBase},${roughnessBase},${roughnessBase},0)`);
    roughnessContext.fillStyle = roughGradient;
    roughnessContext.fillRect(x - radius * 1.2, y - radius * 1.2, radius * 2.4, radius * 2.4);
  }

  // Localized grease, oxidation, and fired-clay grime are deliberately few
  // and large. They survive minification as material history rather than
  // shimmering texture noise.
  const wearClusterCount = profile === 'ceramic' ? 4 : 6;
  for (let index = 0; index < wearClusterCount; index += 1) {
    const x = seededUnit(seed + 900 + index * 89) * size;
    const y = seededUnit(seed + 950 + index * 97) * size;
    const radius = 16 + seededUnit(seed + 1000 + index * 101) * 20;
    const aspect = 0.34 + seededUnit(seed + 1050 + index * 103) * 0.38;
    const angle = seededUnit(seed + 1100 + index * 107) * Math.PI;
    const grease = profile !== 'ceramic' && index % 3 === 0;
    const clusterColor = profile === 'ceramic'
      ? [91, 72, 48]
      : grease
        ? [20, 29, 29]
        : [126, 72, 39];
    const clusterAlpha = profile === 'brushed' ? 0.1 : profile === 'ceramic' ? 0.13 : 0.14;

    colorContext.save();
    colorContext.translate(x, y);
    colorContext.rotate(angle);
    colorContext.scale(1, aspect);
    const wearGradient = colorContext.createRadialGradient(0, 0, 0, 0, 0, radius);
    wearGradient.addColorStop(
      0,
      `rgba(${clusterColor[0]},${clusterColor[1]},${clusterColor[2]},${clusterAlpha})`,
    );
    wearGradient.addColorStop(0.56, `rgba(${clusterColor[0]},${clusterColor[1]},${clusterColor[2]},${clusterAlpha * 0.55})`);
    wearGradient.addColorStop(1, `rgba(${clusterColor[0]},${clusterColor[1]},${clusterColor[2]},0)`);
    colorContext.fillStyle = wearGradient;
    colorContext.fillRect(-radius, -radius, radius * 2, radius * 2);
    colorContext.restore();

    roughnessContext.save();
    roughnessContext.translate(x, y);
    roughnessContext.rotate(angle);
    roughnessContext.scale(1, aspect);
    const wearRoughness = grease ? 168 : 252;
    const wearRoughnessGradient = roughnessContext.createRadialGradient(0, 0, 0, 0, 0, radius);
    wearRoughnessGradient.addColorStop(
      0,
      `rgba(${wearRoughness},${wearRoughness},${wearRoughness},0.44)`,
    );
    wearRoughnessGradient.addColorStop(
      1,
      `rgba(${roughnessBase},${roughnessBase},${roughnessBase},0)`,
    );
    roughnessContext.fillStyle = wearRoughnessGradient;
    roughnessContext.fillRect(-radius, -radius, radius * 2, radius * 2);
    roughnessContext.restore();
  }

  const edgeTone = profile === 'ceramic'
    ? 'rgba(91,72,48,0.13)'
    : 'rgba(255,255,247,0.16)';
  colorContext.strokeStyle = edgeTone;
  colorContext.lineWidth = profile === 'brushed' ? 2 : 2.8;
  colorContext.strokeRect(3.5, 3.5, size - 7, size - 7);
  roughnessContext.strokeStyle = profile === 'ceramic'
    ? 'rgba(255,255,255,0.18)'
    : 'rgba(185,185,185,0.2)';
  roughnessContext.lineWidth = 3;
  roughnessContext.strokeRect(3.5, 3.5, size - 7, size - 7);

  const scratchCount = profile === 'brushed' ? 12 : profile === 'painted' ? 6 : 4;
  colorContext.lineCap = 'round';
  roughnessContext.lineCap = 'round';
  for (let index = 0; index < scratchCount; index += 1) {
    const x = seededUnit(seed + 2000 + index * 67) * size;
    const y = seededUnit(seed + 2100 + index * 71) * size;
    const length = 18 + seededUnit(seed + 2200 + index * 73) * (profile === 'brushed' ? 48 : 30);
    const angle = profile === 'brushed'
      ? (seededUnit(seed + 2300 + index * 79) - 0.5) * 0.12
      : profile === 'ceramic'
        ? Math.PI * 0.5 + (seededUnit(seed + 2300 + index * 79) - 0.5) * 0.22
        : seededUnit(seed + 2300 + index * 79) * Math.PI;
    const endX = x + Math.cos(angle) * length;
    const endY = y + Math.sin(angle) * length;
    const bright = seededUnit(seed + 2400 + index * 83) > 0.48;
    colorContext.strokeStyle = profile === 'ceramic'
      ? 'rgba(104,88,63,0.14)'
      : bright
        ? 'rgba(255,255,250,0.15)'
        : 'rgba(39,50,51,0.135)';
    colorContext.lineWidth = profile === 'brushed' ? 1 : 1.35;
    colorContext.beginPath();
    colorContext.moveTo(x, y);
    colorContext.lineTo(endX, endY);
    colorContext.stroke();

    const roughValue = bright ? 250 : 208;
    roughnessContext.strokeStyle = `rgba(${roughValue},${roughValue},${roughValue},0.22)`;
    roughnessContext.lineWidth = profile === 'brushed' ? 1.2 : 1.5;
    roughnessContext.beginPath();
    roughnessContext.moveTo(x, y);
    roughnessContext.lineTo(endX, endY);
    roughnessContext.stroke();
  }

  const colorTexture = new THREE.CanvasTexture(colorSurface.canvas);
  colorTexture.name = `${profile}-surface-color`;
  colorTexture.colorSpace = THREE.SRGBColorSpace;
  const roughnessTexture = new THREE.CanvasTexture(roughnessSurface.canvas);
  roughnessTexture.name = `${profile}-surface-roughness`;
  for (const texture of [colorTexture, roughnessTexture]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
  }
  return { color: colorTexture, roughness: roughnessTexture };
}

/**
 * Dedicated Commission Uplink surfaces. These maps are intentionally much
 * more authored than the shared palette: every tile combines a large-scale
 * material gradient, panel construction, chipped edges, local oxidation,
 * oil tracking, fastener shadows, and a matching roughness history. The
 * motifs are broad enough to survive the gameplay camera instead of
 * collapsing into undifferentiated texture noise.
 */
function createUplinkSurfaceMaps(
  profile: 'painted' | 'cast' | 'concrete',
  seed: number,
): SurfaceMaps {
  const size = 256;
  const colorSurface = makeCanvas(size);
  const roughnessSurface = makeCanvas(size);
  const color = colorSurface.context;
  const roughness = roughnessSurface.context;
  const base = profile === 'painted'
    ? [113, 139, 126]
    : profile === 'cast'
      ? [84, 99, 96]
      : [177, 169, 145];
  const dark = profile === 'concrete'
    ? [79, 70, 55]
    : [28, 39, 39];
  const exposed = profile === 'painted'
    ? [126, 69, 42]
    : profile === 'cast'
      ? [137, 91, 61]
      : [116, 83, 55];
  const roughBase = profile === 'concrete' ? 242 : profile === 'painted' ? 222 : 205;

  color.fillStyle = `rgb(${base.join(',')})`;
  color.fillRect(0, 0, size, size);
  roughness.fillStyle = `rgb(${roughBase},${roughBase},${roughBase})`;
  roughness.fillRect(0, 0, size, size);

  const broad = color.createLinearGradient(0, 0, size, size);
  broad.addColorStop(0, 'rgba(255,245,217,0.14)');
  broad.addColorStop(0.42, 'rgba(255,255,255,0)');
  broad.addColorStop(1, profile === 'concrete'
    ? 'rgba(67,47,31,0.22)'
    : 'rgba(18,29,30,0.26)');
  color.fillStyle = broad;
  color.fillRect(0, 0, size, size);

  // Construction scale: recessed panel breaks on metal, drained pours on
  // concrete. Offset double-lines read as a dark seam with a rubbed lip.
  // One broad construction break per major face is enough at gameplay scale.
  // Earlier, denser repeats read like plaid when the atlas wrapped around
  // cylinders instead of like authored fabrication.
  const seamSpacing = profile === 'concrete' ? 92 : 112;
  for (let coordinate = seamSpacing; coordinate < size; coordinate += seamSpacing) {
    const warp = (seededUnit(seed + coordinate * 17) - 0.5) * 5;
    color.strokeStyle = `rgba(${dark.join(',')},${profile === 'concrete' ? 0.46 : 0.38})`;
    color.lineWidth = profile === 'concrete' ? 4 : 3;
    color.beginPath();
    color.moveTo(coordinate + warp, 0);
    color.lineTo(coordinate - warp, size);
    color.stroke();
    color.strokeStyle = `rgba(236,228,198,${profile === 'concrete' ? 0.24 : 0.14})`;
    color.lineWidth = 1.2;
    color.beginPath();
    color.moveTo(coordinate + warp + 4, 0);
    color.lineTo(coordinate - warp + 4, size);
    color.stroke();
    roughness.strokeStyle = 'rgba(255,255,255,0.62)';
    roughness.lineWidth = profile === 'concrete' ? 6 : 4;
    roughness.beginPath();
    roughness.moveTo(coordinate + warp, 0);
    roughness.lineTo(coordinate - warp, size);
    roughness.stroke();
  }
  for (let coordinate = seamSpacing; coordinate < size; coordinate += seamSpacing) {
    const warp = (seededUnit(seed + coordinate * 23 + 5) - 0.5) * 4;
    color.strokeStyle = `rgba(${dark.join(',')},${profile === 'concrete' ? 0.4 : 0.32})`;
    color.lineWidth = profile === 'concrete' ? 3.5 : 2.5;
    color.beginPath();
    color.moveTo(0, coordinate + warp);
    color.lineTo(size, coordinate - warp);
    color.stroke();
    roughness.strokeStyle = 'rgba(255,255,255,0.52)';
    roughness.lineWidth = profile === 'concrete' ? 5 : 3.5;
    roughness.beginPath();
    roughness.moveTo(0, coordinate + warp);
    roughness.lineTo(size, coordinate - warp);
    roughness.stroke();
  }

  // Chipped paint and impact spalls expose dark primer and oxidized metal.
  const chipCount = profile === 'concrete' ? 38 : 62;
  for (let index = 0; index < chipCount; index += 1) {
    const x = seededUnit(seed + 3100 + index * 61) * size;
    const y = seededUnit(seed + 3300 + index * 67) * size;
    const radius = 1.8 + seededUnit(seed + 3500 + index * 71)
      * (profile === 'concrete' ? 7 : 5);
    const angle = seededUnit(seed + 3700 + index * 73) * Math.PI * 2;
    color.save();
    color.translate(x, y);
    color.rotate(angle);
    color.beginPath();
    color.moveTo(-radius, -radius * 0.22);
    color.lineTo(-radius * 0.18, -radius * 0.72);
    color.lineTo(radius, -radius * 0.18);
    color.lineTo(radius * 0.42, radius * 0.65);
    color.lineTo(-radius * 0.62, radius * 0.46);
    color.closePath();
    color.fillStyle = index % 3 === 0
      ? `rgba(${exposed.join(',')},0.82)`
      : `rgba(${dark.join(',')},0.68)`;
    color.fill();
    color.strokeStyle = 'rgba(235,226,197,0.34)';
    color.lineWidth = 0.9;
    color.stroke();
    color.restore();
    roughness.fillStyle = index % 3 === 0
      ? 'rgba(160,160,160,0.72)'
      : 'rgba(250,250,250,0.64)';
    roughness.beginPath();
    roughness.ellipse(x, y, radius, radius * 0.45, angle, 0, Math.PI * 2);
    roughness.fill();
  }

  // Gravity-led oil and oxidation histories connect service points to the
  // lower edge; they are deliberately asymmetric and non-tile-like.
  const streakCount = profile === 'concrete' ? 8 : 13;
  for (let index = 0; index < streakCount; index += 1) {
    const x = seededUnit(seed + 5100 + index * 83) * size;
    const startY = seededUnit(seed + 5300 + index * 89) * size * 0.62;
    const length = 24 + seededUnit(seed + 5500 + index * 97) * 88;
    const width = 2 + seededUnit(seed + 5700 + index * 101) * 8;
    const streak = color.createLinearGradient(x, startY, x, startY + length);
    streak.addColorStop(0, profile === 'painted'
      ? 'rgba(28,35,31,0.03)'
      : 'rgba(43,31,24,0.04)');
    streak.addColorStop(0.22, profile === 'painted'
      ? 'rgba(24,31,29,0.42)'
      : 'rgba(61,39,27,0.36)');
    streak.addColorStop(1, 'rgba(24,26,24,0)');
    color.fillStyle = streak;
    color.fillRect(x - width * 0.5, startY, width, length);
    roughness.fillStyle = profile === 'painted'
      ? 'rgba(118,118,118,0.28)'
      : 'rgba(252,252,252,0.24)';
    roughness.fillRect(x - width * 0.6, startY, width * 1.2, length * 0.82);
  }

  // Fastener fields and rubbed perimeter establish manufactured scale.
  if (profile !== 'concrete') {
    for (const x of [18, 128, 238]) {
      for (const y of [18, 128, 238]) {
        color.fillStyle = 'rgba(29,37,37,0.72)';
        color.beginPath();
        color.arc(x, y, 3.8, 0, Math.PI * 2);
        color.fill();
        color.fillStyle = 'rgba(216,213,188,0.58)';
        color.beginPath();
        color.arc(x - 0.8, y - 0.8, 1.45, 0, Math.PI * 2);
        color.fill();
        roughness.fillStyle = 'rgba(151,151,151,0.62)';
        roughness.beginPath();
        roughness.arc(x, y, 4.4, 0, Math.PI * 2);
        roughness.fill();
      }
    }
  }
  color.strokeStyle = profile === 'concrete'
    ? 'rgba(89,63,42,0.44)'
    : 'rgba(226,220,190,0.46)';
  color.lineWidth = profile === 'concrete' ? 7 : 4;
  color.strokeRect(4, 4, size - 8, size - 8);
  roughness.strokeStyle = profile === 'concrete'
    ? 'rgba(255,255,255,0.5)'
    : 'rgba(142,142,142,0.62)';
  roughness.lineWidth = profile === 'concrete' ? 8 : 5;
  roughness.strokeRect(4, 4, size - 8, size - 8);

  const colorTexture = new THREE.CanvasTexture(colorSurface.canvas);
  colorTexture.name = `uplink-${profile}-layered-color`;
  colorTexture.colorSpace = THREE.SRGBColorSpace;
  const roughnessTexture = new THREE.CanvasTexture(roughnessSurface.canvas);
  roughnessTexture.name = `uplink-${profile}-layered-roughness`;
  roughnessTexture.colorSpace = THREE.NoColorSpace;
  for (const texture of [colorTexture, roughnessTexture]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(profile === 'concrete' ? 1.16 : 1.08, profile === 'concrete' ? 1.16 : 1.08);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
  }
  return { color: colorTexture, roughness: roughnessTexture };
}

const MACHINE_RESPONSE_KINDS: readonly MachineResponseKind[] = [
  'extractor',
  'inserter',
  'smelter',
  'fabricator',
  'generator',
  'storage',
  'beacon',
];

function responseRidge(distance: number, width: number): number {
  const normalized = distance / Math.max(0.0001, width);
  return Math.exp(-normalized * normalized);
}

function responseLineDistance(value: number, spacing: number): number {
  const wrapped = ((value / spacing + 0.5) % 1 + 1) % 1 - 0.5;
  return Math.abs(wrapped) * spacing;
}

function machineResponseHeight(
  kind: MachineResponseKind,
  x: number,
  y: number,
  phase: number,
): { height: number; roughness: number; crevice: number } {
  const radius = Math.hypot(x, y);
  const angle = Math.atan2(y, x);
  const broadWarp = Math.sin(x * 4.2 + phase) * Math.cos(y * 3.6 - phase * 0.7);
  let height = broadWarp * 0.025;
  let roughness = 0.72 + broadWarp * 0.035;
  let crevice = 0;

  switch (kind) {
    case 'extractor': {
      const innerRing = responseRidge(Math.abs(radius - 0.28), 0.035);
      const outerRing = responseRidge(Math.abs(radius - 0.57), 0.045);
      const radialWeb = responseRidge(Math.abs(Math.sin(angle * 3 + phase)) * radius, 0.045);
      const impactWear = responseRidge(radius, 0.34);
      height += innerRing * 0.12 + outerRing * 0.075 + radialWeb * 0.06;
      roughness += impactWear * 0.13 - outerRing * 0.08;
      crevice = Math.max(innerRing * 0.58, outerRing * 0.42);
      break;
    }
    case 'inserter': {
      const diagonalA = responseRidge(responseLineDistance(x + y * 0.62, 0.34), 0.025);
      const diagonalB = responseRidge(responseLineDistance(x - y * 0.38 + 0.11, 0.52), 0.026);
      const pivotRing = responseRidge(Math.abs(radius - 0.38), 0.032);
      height += diagonalA * 0.075 - diagonalB * 0.045 + pivotRing * 0.1;
      roughness += diagonalB * 0.11 - pivotRing * 0.07;
      crevice = Math.max(diagonalB * 0.5, pivotRing * 0.44);
      break;
    }
    case 'smelter': {
      const plateJoint = responseRidge(responseLineDistance(x, 0.42), 0.027);
      const refractoryCourse = responseRidge(responseLineDistance(y + Math.sin(x * 3) * 0.035, 0.31), 0.022);
      const heatBloom = responseRidge(radius, 0.62);
      height += plateJoint * 0.08 - refractoryCourse * 0.055;
      roughness += heatBloom * 0.16 + refractoryCourse * 0.06;
      crevice = Math.max(plateJoint * 0.52, refractoryCourse * 0.64);
      break;
    }
    case 'fabricator': {
      const verticalJoint = responseRidge(responseLineDistance(x + 0.08, 0.48), 0.024);
      const horizontalJoint = responseRidge(responseLineDistance(y - 0.06, 0.4), 0.024);
      const inset = Math.max(Math.abs(x * 0.82), Math.abs(y)) - 0.52;
      const insetFrame = responseRidge(Math.abs(inset), 0.032);
      height += insetFrame * 0.105 - Math.max(verticalJoint, horizontalJoint) * 0.045;
      roughness += Math.max(verticalJoint, horizontalJoint) * 0.09 - insetFrame * 0.065;
      crevice = Math.max(verticalJoint, horizontalJoint) * 0.6;
      break;
    }
    case 'generator': {
      const louver = responseRidge(responseLineDistance(y + Math.sin(x * 2.6) * 0.025, 0.23), 0.026);
      const windingA = responseRidge(Math.abs(radius - 0.34), 0.033);
      const windingB = responseRidge(Math.abs(radius - 0.62), 0.036);
      height += louver * 0.085 + windingA * 0.075 + windingB * 0.05;
      roughness += louver * 0.075 - windingA * 0.09;
      crevice = Math.max(louver * 0.42, windingB * 0.48);
      break;
    }
    case 'storage': {
      const stave = responseRidge(responseLineDistance(x + Math.sin(y * 2.2) * 0.015, 0.29), 0.021);
      const band = responseRidge(responseLineDistance(y + 0.04, 0.56), 0.034);
      const settledWear = THREE.MathUtils.smoothstep(y, -0.72, 0.25);
      height += stave * 0.055 + band * 0.105;
      roughness += settledWear * 0.14 - band * 0.075;
      crevice = Math.max(stave * 0.57, band * 0.38);
      break;
    }
    case 'beacon': {
      const hexRadius = Math.max(
        Math.abs(x),
        Math.abs(x * 0.5 + y * 0.866),
        Math.abs(x * 0.5 - y * 0.866),
      );
      const hexFrame = responseRidge(Math.abs(hexRadius - 0.55), 0.03);
      const radialPanel = responseRidge(Math.abs(Math.sin(angle * 3 + phase * 0.4)) * radius, 0.038);
      const signalDish = responseRidge(Math.abs(radius - 0.3), 0.03);
      height += hexFrame * 0.095 + radialPanel * 0.055 + signalDish * 0.075;
      roughness += radialPanel * 0.07 - signalDish * 0.1;
      crevice = Math.max(hexFrame * 0.48, radialPanel * 0.42);
      break;
    }
  }

  return {
    height,
    roughness: THREE.MathUtils.clamp(roughness, 0.46, 0.96),
    crevice: THREE.MathUtils.clamp(crevice, 0, 1),
  };
}

function createMachineResponseMaps(
  kind: MachineResponseKind,
  seed: number,
): MachineResponseMaps {
  const size = 128;
  const phase = seededUnit(seed) * Math.PI * 2;
  const heights = new Float32Array(size * size);
  const roughness = new Float32Array(size * size);
  const crevices = new Float32Array(size * size);

  for (let pixelY = 0; pixelY < size; pixelY += 1) {
    for (let pixelX = 0; pixelX < size; pixelX += 1) {
      const x = (pixelX + 0.5) / size * 2 - 1;
      const y = (pixelY + 0.5) / size * 2 - 1;
      const sample = machineResponseHeight(kind, x, y, phase);
      const index = pixelY * size + pixelX;
      heights[index] = sample.height;
      roughness[index] = sample.roughness;
      crevices[index] = sample.crevice;
    }
  }

  const normalSurface = makeCanvas(size);
  const responseSurface = makeCanvas(size);
  const normalPixels = normalSurface.context.createImageData(size, size);
  const responsePixels = responseSurface.context.createImageData(size, size);
  const normalStrength = 9.5;

  for (let pixelY = 0; pixelY < size; pixelY += 1) {
    const upY = (pixelY - 1 + size) % size;
    const downY = (pixelY + 1) % size;
    for (let pixelX = 0; pixelX < size; pixelX += 1) {
      const leftX = (pixelX - 1 + size) % size;
      const rightX = (pixelX + 1) % size;
      const index = pixelY * size + pixelX;
      const pixelIndex = index * 4;
      const dx = (heights[pixelY * size + rightX]! - heights[pixelY * size + leftX]!) * normalStrength;
      const dy = (heights[downY * size + pixelX]! - heights[upY * size + pixelX]!) * normalStrength;
      const inverseLength = 1 / Math.hypot(dx, dy, 1);
      normalPixels.data[pixelIndex] = Math.round((-dx * inverseLength * 0.5 + 0.5) * 255);
      normalPixels.data[pixelIndex + 1] = Math.round((-dy * inverseLength * 0.5 + 0.5) * 255);
      normalPixels.data[pixelIndex + 2] = Math.round(inverseLength * 255);
      normalPixels.data[pixelIndex + 3] = 255;

      const ao = THREE.MathUtils.clamp(1 - crevices[index]! * 0.23, 0.72, 1);
      responsePixels.data[pixelIndex] = Math.round(ao * 255);
      responsePixels.data[pixelIndex + 1] = Math.round(roughness[index]! * 255);
      responsePixels.data[pixelIndex + 2] = 255;
      responsePixels.data[pixelIndex + 3] = 255;
    }
  }

  normalSurface.context.putImageData(normalPixels, 0, 0);
  responseSurface.context.putImageData(responsePixels, 0, 0);

  const normalTexture = new THREE.CanvasTexture(normalSurface.canvas);
  normalTexture.name = `${kind}-housing-normal`;
  const responseTexture = new THREE.CanvasTexture(responseSurface.canvas);
  responseTexture.name = `${kind}-housing-ao-roughness`;
  for (const texture of [normalTexture, responseTexture]) {
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
  }
  return { normal: normalTexture, response: responseTexture };
}

function cubicPoint(
  t: number,
  p0: THREE.Vector2,
  p1: THREE.Vector2,
  p2: THREE.Vector2,
  p3: THREE.Vector2,
): THREE.Vector2 {
  const oneMinus = 1 - t;
  return new THREE.Vector2(
    oneMinus ** 3 * p0.x
      + 3 * oneMinus ** 2 * t * p1.x
      + 3 * oneMinus * t ** 2 * p2.x
      + t ** 3 * p3.x,
    oneMinus ** 3 * p0.y
      + 3 * oneMinus ** 2 * t * p1.y
      + 3 * oneMinus * t ** 2 * p2.y
      + t ** 3 * p3.y,
  );
}

function cubicTangent(
  t: number,
  p0: THREE.Vector2,
  p1: THREE.Vector2,
  p2: THREE.Vector2,
  p3: THREE.Vector2,
): THREE.Vector2 {
  const oneMinus = 1 - t;
  return new THREE.Vector2(
    3 * oneMinus ** 2 * (p1.x - p0.x)
      + 6 * oneMinus * t * (p2.x - p1.x)
      + 3 * t ** 2 * (p3.x - p2.x),
    3 * oneMinus ** 2 * (p1.y - p0.y)
      + 6 * oneMinus * t * (p2.y - p1.y)
      + 3 * t ** 2 * (p3.y - p2.y),
  ).normalize();
}

function beltCurve(turn: BeltTurn): [THREE.Vector2, THREE.Vector2, THREE.Vector2, THREE.Vector2] {
  if (turn === 'left') {
    return [
      new THREE.Vector2(-24, 128),
      new THREE.Vector2(62, 128),
      new THREE.Vector2(128, 62),
      new THREE.Vector2(128, -24),
    ];
  }
  if (turn === 'right') {
    return [
      new THREE.Vector2(280, 128),
      new THREE.Vector2(194, 128),
      new THREE.Vector2(128, 62),
      new THREE.Vector2(128, -24),
    ];
  }
  return [
    new THREE.Vector2(128, 280),
    new THREE.Vector2(128, 190),
    new THREE.Vector2(128, 66),
    new THREE.Vector2(128, -24),
  ];
}

function drawBeltSurface(surface: BeltSurface): void {
  const { context: context, canvas, turn, active } = surface;
  const size = canvas.width;
  context.clearRect(0, 0, size, size);
  context.fillStyle = '#202a2d';
  context.fillRect(0, 0, size, size);

  // The carrier must read as one continuous machine when many cells meet.
  // Avoid a bright per-tile frame: it turned long transport runs into a wall
  // of repeated control panels in still screenshots.
  const gradient = context.createLinearGradient(0, 0, size, 0);
  gradient.addColorStop(0, '#303c40');
  gradient.addColorStop(0.18, '#556166');
  gradient.addColorStop(0.5, '#364347');
  gradient.addColorStop(0.82, '#556166');
  gradient.addColorStop(1, '#303c40');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const curve = beltCurve(turn);
  const laneOffsets = [-31, 31];
  for (const laneOffset of laneOffsets) {
    const samples: THREE.Vector2[] = [];
    for (let index = 0; index <= 36; index += 1) {
      const t = index / 36;
      const point = cubicPoint(t, ...curve);
      const tangent = cubicTangent(t, ...curve);
      const normal = new THREE.Vector2(-tangent.y, tangent.x);
      samples.push(point.addScaledVector(normal, laneOffset));
    }

    context.beginPath();
    samples.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.lineWidth = 52;
    context.strokeStyle = '#12191c';
    context.lineCap = 'butt';
    context.lineJoin = 'round';
    context.stroke();

    context.beginPath();
    samples.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.lineWidth = 38;
    context.strokeStyle = active ? '#4c5a5e' : '#394448';
    context.stroke();

    // Large forged chevrons survive minification and make travel direction
    // obvious even in a motionless QA capture. Their points, rather than a
    // row of amber rivets, establish an input-to-output reading.
    for (let marker = 0; marker < 3; marker += 1) {
      const t = 0.16 + marker * 0.34;
      const point = cubicPoint(t, ...curve);
      const tangent = cubicTangent(t, ...curve);
      const normal = new THREE.Vector2(-tangent.y, tangent.x);
      point.addScaledVector(normal, laneOffset);

      context.save();
      context.translate(point.x, point.y);
      context.rotate(Math.atan2(tangent.y, tangent.x) + Math.PI / 2);
      context.beginPath();
      context.moveTo(0, -14);
      context.lineTo(12, 9);
      context.lineTo(4, 7);
      context.lineTo(0, -1);
      context.lineTo(-4, 7);
      context.lineTo(-12, 9);
      context.closePath();
      context.fillStyle = active ? '#d58d35' : '#745f42';
      context.fill();
      context.strokeStyle = active
        ? 'rgba(255,210,130,.72)'
        : 'rgba(169,143,100,.38)';
      context.lineWidth = 2;
      context.stroke();
      context.restore();
    }
  }

  context.beginPath();
  for (let index = 0; index <= 36; index += 1) {
    const point = cubicPoint(index / 36, ...curve);
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.lineWidth = 4;
  context.strokeStyle = '#83908f';
  context.stroke();

  // Longitudinal wear bands continue cleanly through adjacent cells.
  context.strokeStyle = 'rgba(214,222,213,.12)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(9, 0);
  context.lineTo(9, size);
  context.moveTo(size - 9, 0);
  context.lineTo(size - 9, size);
  context.stroke();
}

function createBeltSurface(turn: BeltTurn, active: boolean): BeltSurface {
  const utility = makeCanvas(256);
  const texture = new THREE.CanvasTexture(utility.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: texture,
    roughness: 0.52,
    metalness: 0.48,
  });
  const surface: BeltSurface = {
    ...utility,
    texture,
    material,
    turn,
    active,
  };
  drawBeltSurface(surface);
  return surface;
}

/**
 * One product silhouette for drawn wire everywhere it can appear: three
 * compact copper laps secured by two dark shipping straps. Vertex colours
 * keep the straps distinct while the owning mesh's item tint still supplies
 * the recipe colour in instanced belt and inserter batches.
 */
function createStrappedCoilGeometry(
  radius = 0.095,
  tube = 0.019,
): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  const addVertexColor = (
    geometry: THREE.BufferGeometry,
    color: THREE.ColorRepresentation,
  ): THREE.BufferGeometry => {
    const compatibleGeometry = geometry.index
      ? geometry.toNonIndexed()
      : geometry;
    if (compatibleGeometry !== geometry) geometry.dispose();
    const position = compatibleGeometry.getAttribute('position');
    const value = new THREE.Color(color);
    const colors = new Float32Array(position.count * 3);
    for (let index = 0; index < position.count; index += 1) {
      colors[index * 3] = value.r;
      colors[index * 3 + 1] = value.g;
      colors[index * 3 + 2] = value.b;
    }
    compatibleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return compatibleGeometry;
  };

  // Keep the shipped bundle dense enough to survive the 10–15 px gameplay
  // footprint. Thick live-payload windings overlap slightly instead of
  // opening into the single orange "donut" silhouette they formerly made.
  const lapSpacing = Math.min(tube * 1.16, 0.018);
  for (const y of [-lapSpacing, 0, lapSpacing]) {
    const lap = new THREE.TorusGeometry(radius, tube, 8, 20);
    lap.rotateX(Math.PI / 2);
    lap.translate(0, y, 0);
    pieces.push(addVertexColor(lap, '#fff4e7'));
  }
  const stackTop = lapSpacing + tube;
  const primaryStrap = new RoundedBoxGeometry(
    Math.max(tube * 1.3, radius * 0.22),
    Math.max(tube * 0.5, 0.01),
    radius * 2.34,
    2,
    Math.max(tube * 0.16, 0.003),
  );
  primaryStrap.rotateY(0.34);
  primaryStrap.translate(
    -radius * 0.08,
    stackTop + Math.max(tube * 0.24, 0.005),
    radius * 0.02,
  );
  pieces.push(addVertexColor(primaryStrap, '#151c1e'));
  const secondaryStrap = new RoundedBoxGeometry(
    Math.max(tube * 0.78, radius * 0.12),
    Math.max(tube * 0.36, 0.007),
    radius * 1.94,
    2,
    Math.max(tube * 0.12, 0.0025),
  );
  secondaryStrap.rotateY(-1.08);
  secondaryStrap.translate(
    radius * 0.13,
    stackTop + Math.max(tube * 0.2, 0.004),
    -radius * 0.06,
  );
  pieces.push(addVertexColor(secondaryStrap, '#343c3d'));
  const endCap = new THREE.CylinderGeometry(
    radius * 0.18,
    radius * 0.18,
    Math.max(tube * 0.46, 0.009),
    12,
    1,
  );
  endCap.translate(
    0,
    stackTop + Math.max(tube * 0.28, 0.006),
    0,
  );
  pieces.push(addVertexColor(endCap, '#465152'));

  const geometry = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (!geometry) {
    throw new Error('Could not assemble the strapped wire-coil geometry.');
  }
  geometry.computeBoundingSphere();
  return geometry;
}

function createPalette(): MaterialPalette {
  const paintedSurface = createSurfaceMaps('painted', 0x31a7);
  const brushedSurface = createSurfaceMaps('brushed', 0x8b4d);
  const ceramicSurface = createSurfaceMaps('ceramic', 0xd271);
  const uplinkPaintedSurface = createUplinkSurfaceMaps('painted', 0x7a41);
  const uplinkCastSurface = createUplinkSurfaceMaps('cast', 0xc541);
  const uplinkConcreteSurface = createUplinkSurfaceMaps('concrete', 0x5ab7);
  const standard = (
    color: THREE.ColorRepresentation,
    roughness: number,
    metalness: number,
    surface?: SurfaceMaps,
  ): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    map: surface?.color ?? null,
    roughnessMap: surface?.roughness ?? null,
  });

  const carbon = standard('#3e4d50', 0.74, 0.46, paintedSurface);
  const carbonDark = standard('#232e31', 0.76, 0.4, paintedSurface);
  const titanium = standard('#7e8b8e', 0.38, 0.84, brushedSurface);
  const titaniumLight = standard('#abb4b1', 0.38, 0.76, brushedSurface);
  const ceramic = standard('#c6c1b4', 0.68, 0.04, ceramicSurface);
  const ceramicDark = standard('#68706b', 0.72, 0.08, ceramicSurface);
  const machineResponseMaps = Object.fromEntries(
    MACHINE_RESPONSE_KINDS.map((kind, index) => [
      kind,
      createMachineResponseMaps(kind, 0x52d1 + index * 0x1f3),
    ]),
  ) as Record<MachineResponseKind, MachineResponseMaps>;
  const housingBases: Record<MachineResponseKind, THREE.MeshStandardMaterial> = {
    extractor: carbon,
    inserter: ceramic,
    smelter: ceramic,
    fabricator: ceramic,
    generator: ceramic,
    storage: ceramicDark,
    beacon: carbonDark,
  };
  const housing = Object.fromEntries(
    MACHINE_RESPONSE_KINDS.map((kind) => {
      const maps = machineResponseMaps[kind];
      const material = housingBases[kind].clone();
      material.name = `${kind}-large-housing`;
      material.normalMap = maps.normal;
      material.normalScale.set(0.62, 0.62);
      material.roughnessMap = maps.response;
      material.aoMap = maps.response;
      material.aoMapIntensity = 0.52;
      return [kind, material];
    }),
  ) as Record<MachineResponseKind, THREE.MeshStandardMaterial>;
  const housingMaterials = MACHINE_RESPONSE_KINDS.map((kind) => housing[kind]);
  const machineResponseTextures = MACHINE_RESPONSE_KINDS.flatMap((kind) => [
    machineResponseMaps[kind].normal,
    machineResponseMaps[kind].response,
  ]);
  const fabricatorPanel = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    emissive: '#202826',
    emissiveIntensity: 0.02,
    map: paintedSurface.color,
    roughness: 0.9,
    metalness: 0.25,
  });
  fabricatorPanel.name = 'fabricator-bounded-weathered-panel-atlas';

  return {
    carbon,
    carbonDark,
    foundation: new THREE.MeshStandardMaterial({
      color: '#46504a',
      roughness: 0.94,
      metalness: 0.14,
      transparent: true,
      opacity: 0.48,
      map: paintedSurface.color,
      roughnessMap: paintedSurface.roughness,
    }),
    uplinkApron: new THREE.MeshStandardMaterial({
      color: '#55584f',
      roughness: 0.96,
      metalness: 0.04,
      map: uplinkConcreteSurface.color,
      normalMap: machineResponseMaps.smelter.normal,
      normalScale: new THREE.Vector2(0.56, 0.56),
      roughnessMap: uplinkConcreteSurface.roughness,
      aoMap: machineResponseMaps.smelter.response,
      aoMapIntensity: 0.62,
    }),
    titanium,
    titaniumLight,
    ceramic,
    ceramicDark,
    rubber: standard('#20282b', 0.88, 0.04, paintedSurface),
    amber: standard('#c98635', 0.46, 0.52, brushedSurface),
    copper: standard('#8f5638', 0.42, 0.72, brushedSurface),
    copperBright: standard('#d27a45', 0.34, 0.78, brushedSurface),
    // The color map is replaced with the authored panel atlas during init.
    // Keeping the procedural surface as a fallback makes offline QA and asset
    // load failures deterministic.
    industrialPanel: standard('#ffffff', 0.62, 0.58, paintedSurface),
    fabricatorPanel,
    agedCopper: standard('#ffffff', 0.46, 0.72, brushedSurface),
    agedCeramic: standard('#ffffff', 0.76, 0.03, ceramicSurface),
    uplinkPainted: new THREE.MeshStandardMaterial({
      color: '#ffffff',
      map: uplinkPaintedSurface.color,
      roughnessMap: uplinkPaintedSurface.roughness,
      normalMap: machineResponseMaps.fabricator.normal,
      normalScale: new THREE.Vector2(0.72, 0.72),
      aoMap: machineResponseMaps.fabricator.response,
      aoMapIntensity: 0.58,
      roughness: 0.7,
      metalness: 0.42,
    }),
    uplinkCast: new THREE.MeshStandardMaterial({
      color: '#ffffff',
      map: uplinkCastSurface.color,
      roughnessMap: uplinkCastSurface.roughness,
      normalMap: machineResponseMaps.storage.normal,
      normalScale: new THREE.Vector2(0.84, 0.84),
      aoMap: machineResponseMaps.storage.response,
      aoMapIntensity: 0.66,
      roughness: 0.64,
      metalness: 0.58,
    }),
    uplinkConcrete: new THREE.MeshStandardMaterial({
      color: '#ffffff',
      map: uplinkConcreteSurface.color,
      roughnessMap: uplinkConcreteSurface.roughness,
      normalMap: machineResponseMaps.smelter.normal,
      normalScale: new THREE.Vector2(0.58, 0.58),
      aoMap: machineResponseMaps.smelter.response,
      aoMapIntensity: 0.46,
      roughness: 0.94,
      metalness: 0.03,
    }),
    signalTemplate: new THREE.MeshStandardMaterial({
      color: '#43d7c4',
      emissive: '#43d7c4',
      emissiveIntensity: 1.8,
      roughness: 0.24,
      metalness: 0.18,
    }),
    heatTemplate: new THREE.MeshStandardMaterial({
      color: '#ffb23e',
      emissive: '#ff8a22',
      emissiveIntensity: 2.4,
      roughness: 0.28,
      metalness: 0.1,
    }),
    violet: standard('#765a91', 0.48, 0.38, paintedSurface),
    groundRock: standard('#343c3c', 0.95, 0.03),
    stain: new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        void main() {
          float radius = length((vUv - vec2(0.5)) * 2.0);
          float alpha = (1.0 - smoothstep(0.08, 1.0, radius)) * 0.34;
          if (alpha < 0.002) discard;
          gl_FragColor = vec4(0.015, 0.024, 0.026, alpha);
        }
      `,
    }),
    scorch: new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        void main() {
          vec2 p = (vUv - vec2(0.5)) * 2.0;
          float radius = length(p * vec2(0.82, 1.0));
          float edge = 1.0 - smoothstep(0.28, 1.0, radius);
          float charBand = 0.56 + sin(p.x * 17.0 + sin(p.y * 11.0) * 2.2) * 0.18;
          float alpha = edge * (0.14 + charBand * 0.13);
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(0.12, 0.045, 0.012, alpha);
        }
      `,
    }),
    housing,
    housingMaterials,
    surfaceTextures: [
      paintedSurface.color,
      paintedSurface.roughness,
      brushedSurface.color,
      brushedSurface.roughness,
      ceramicSurface.color,
      ceramicSurface.roughness,
      uplinkPaintedSurface.color,
      uplinkPaintedSurface.roughness,
      uplinkCastSurface.color,
      uplinkCastSurface.roughness,
      uplinkConcreteSurface.color,
      uplinkConcreteSurface.roughness,
      ...machineResponseTextures,
    ],
  };
}

export class WorldRenderer {
  readonly canvas: HTMLCanvasElement;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-20, 20, 12, -12, 0.1, 180);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly outputPass: OutputPass;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly worldRoot = new THREE.Group();
  private readonly infrastructureRoot = new THREE.Group();
  private readonly entityRoot = new THREE.Group();
  private readonly resourceRoot = new THREE.Group();
  private readonly itemRoot = new THREE.Group();
  private readonly effectsRoot = new THREE.Group();
  private readonly powerGridRoot = new THREE.Group();
  private readonly overlayRoot = new THREE.Group();
  private readonly blueprintOverlayRenderer =
    new BlueprintOverlayRenderer(this.overlayRoot);
  private readonly railIntegration =
    new RailRendererIntegrationAdapter(this.entityRoot);
  private readonly fluidRenderer = new FluidRenderer(this.entityRoot);
  private readonly circuitRenderer = new CircuitRenderer(this.entityRoot);
  private readonly powerGridSelectionRoot = new THREE.Group();
  private readonly entityObjects = new Map<RenderEntityId, EntityRig>();
  private readonly entityData = new Map<RenderEntityId, RenderEntity>();
  private readonly resourceObjects = new Map<string, ResourceRig>();
  private readonly materials: MaterialPalette;
  private readonly beltSurfaces: Record<BeltTurn, { active: BeltSurface; idle: BeltSurface }>;
  private readonly inserterPerformance: InserterPerformanceBatches;
  private readonly processSignalPerformance: ProcessSignalPerformanceBatches;
  private readonly gridRelayPerformance: GridRelayPerformanceBatches;
  private readonly powerGridBatches: PowerGridBatches;
  private readonly powerGridSelection: PowerGridSelectionVisuals;
  private readonly itemBuckets = new Map<ItemVisualKind, ItemBucket>();
  private readonly particles: Particle[] = [];
  private readonly particleGeometry = new THREE.BufferGeometry();
  private readonly particlePositions = new Float32Array(MAX_PARTICLES * 3);
  private readonly particleColors = new Float32Array(MAX_PARTICLES * 3);
  private readonly particleSizes = new Float32Array(MAX_PARTICLES);
  private readonly particleAlphas = new Float32Array(MAX_PARTICLES);
  private readonly particleMaterial: THREE.ShaderMaterial;
  private readonly particlePoints: THREE.Points;
  private readonly sun = new THREE.DirectionalLight('#ffe3bd', 4.1);
  private readonly sunTarget = new THREE.Object3D();
  private readonly hoverFrame = new THREE.LineSegments();
  private readonly selectionHalo: THREE.Mesh;
  private readonly ghostRoot = new THREE.Group();
  private readonly tempObject = new THREE.Object3D();
  private readonly tempVector = new THREE.Vector3();
  private readonly tempVectorB = new THREE.Vector3();
  private readonly tempQuaternion = new THREE.Quaternion();
  private readonly tempColor = new THREE.Color();

  private snapshot: RenderSnapshot = { entities: [] };
  private ground: THREE.Mesh | null = null;
  private terrainTexture: THREE.Texture | null = null;
  private viewWidth = DEFAULT_VIEW_WIDTH;
  private focusPoint = new THREE.Vector3(0, 0, 0);
  private quality: RenderQuality = 'high';
  private initialized = false;
  private disposed = false;
  private ghostState: GhostState | null = null;
  private ghostVisual: THREE.Group | null = null;
  private ghostKind: RenderEntityKind | null = null;
  private ghostTopologySignature = '';
  private hoveredCell: GridPoint | null = null;
  private selectedId: RenderEntityId | null = null;
  private readonly authoredCastShadow =
    new WeakMap<THREE.Object3D, boolean>();
  private readonly highShadowNearHeroIds =
    new Set<RenderEntityId>();
  private highShadowLodRevision = 0;
  private itemInstancesDirty = false;
  private hasProceduralItemMotion = false;
  private infrastructureSignature = -1;
  private infrastructureEntityCount = -1;
  private particleCursor = 0;
  private lastElapsed = 0;
  private processSignalOverviewLOD =
    DEFAULT_VIEW_WIDTH >= PROCESS_SIGNAL_OVERVIEW_ENTER_WIDTH;
  private powerGridSignature = '';
  private powerGridVisualLinks: PowerGridVisualLink[] = [];
  private powerGridRelayCenters = new Map<number, RenderPowerGridRelayCenter>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor('#101719', 1);

    this.materials = createPalette();
    this.inserterPerformance = this.createInserterPerformanceBatches();
    this.processSignalPerformance = this.createProcessSignalPerformanceBatches();
    this.gridRelayPerformance = this.createGridRelayPerformanceBatches();
    this.powerGridBatches = this.createPowerGridBatches();
    this.powerGridSelection = this.createPowerGridSelectionVisuals();
    const surfaceAnisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    for (const texture of this.materials.surfaceTextures) {
      texture.anisotropy = surfaceAnisotropy;
    }
    this.beltSurfaces = {
      straight: {
        active: createBeltSurface('straight', true),
        idle: createBeltSurface('straight', false),
      },
      left: {
        active: createBeltSurface('left', true),
        idle: createBeltSurface('left', false),
      },
      right: {
        active: createBeltSurface('right', true),
        idle: createBeltSurface('right', false),
      },
    };

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.24, 0.42, 1.28);
    this.outputPass = new OutputPass();
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);

    this.particleMaterial = this.createParticleMaterial();
    this.particlePoints = new THREE.Points(this.particleGeometry, this.particleMaterial);
    this.selectionHalo = this.createSelectionHalo();

    this.setupScene();
    this.setupItems();
    this.setupParticles();
    this.setupOverlays();
    this.positionCamera();
    this.resize();
  }

  async init(): Promise<void> {
    if (this.initialized || this.disposed) return;
    this.initialized = true;

    let texture: THREE.Texture;
    let panelTexture: THREE.Texture | null = null;
    let copperTexture: THREE.Texture | null = null;
    let ceramicTexture: THREE.Texture | null = null;
    let uplinkPaintedSteelTexture: THREE.Texture | null = null;
    let fabricatorPanelTexture: THREE.Texture | null = null;
    try {
      texture = await new THREE.TextureLoader().loadAsync('/assets/cinder-terrain.png');
    } catch {
      texture = this.createFallbackTerrain();
    }
    try {
      panelTexture = await new THREE.TextureLoader().loadAsync(
        '/assets/cinder-machine-panel-v2.jpg',
      );
    } catch {
      panelTexture = null;
    }
    try {
      [copperTexture, ceramicTexture] = await Promise.all([
        new THREE.TextureLoader().loadAsync(
          '/assets/cinder-copper-aged-v1.jpg',
        ),
        new THREE.TextureLoader().loadAsync(
          '/assets/cinder-ceramic-aged-v1.jpg',
        ),
      ]);
    } catch {
      copperTexture?.dispose();
      ceramicTexture?.dispose();
      copperTexture = null;
      ceramicTexture = null;
    }
    try {
      uplinkPaintedSteelTexture = await new THREE.TextureLoader().loadAsync(
        '/assets/cinder-painted-steel-aged-v2.png',
      );
    } catch {
      uplinkPaintedSteelTexture = null;
    }
    try {
      fabricatorPanelTexture = await new THREE.TextureLoader().loadAsync(
        '/assets/cinder-weathered-panel-aged-v3.png',
      );
    } catch {
      fabricatorPanelTexture = null;
    }
    if (this.disposed) {
      texture.dispose();
      panelTexture?.dispose();
      copperTexture?.dispose();
      ceramicTexture?.dispose();
      uplinkPaintedSteelTexture?.dispose();
      fabricatorPanelTexture?.dispose();
      return;
    }

    const applyAuthoredMap = (
      authoredTexture: THREE.Texture | null,
      material: THREE.MeshStandardMaterial,
      name: string,
    ): void => {
      if (!authoredTexture) return;
      authoredTexture.name = name;
      authoredTexture.colorSpace = THREE.SRGBColorSpace;
      // These close-up atlases are used on deliberately bounded components.
      // Clamping avoids advertising the higher opposite-edge error of the
      // aged copper/ceramic candidates as a repeated seam.
      authoredTexture.wrapS = THREE.ClampToEdgeWrapping;
      authoredTexture.wrapT = THREE.ClampToEdgeWrapping;
      authoredTexture.generateMipmaps = true;
      authoredTexture.minFilter = THREE.LinearMipmapLinearFilter;
      authoredTexture.magFilter = THREE.LinearFilter;
      authoredTexture.anisotropy = Math.min(
        4,
        this.renderer.capabilities.getMaxAnisotropy(),
      );
      authoredTexture.needsUpdate = true;
      material.map = authoredTexture;
      material.needsUpdate = true;
      this.materials.surfaceTextures.push(authoredTexture);
    };
    applyAuthoredMap(
      panelTexture,
      this.materials.industrialPanel,
      'authored-industrial-panel-wear-atlas',
    );
    applyAuthoredMap(
      copperTexture,
      this.materials.agedCopper,
      'authored-aged-copper-closeup-atlas',
    );
    applyAuthoredMap(
      ceramicTexture,
      this.materials.agedCeramic,
      'authored-aged-ceramic-closeup-atlas',
    );
    applyAuthoredMap(
      uplinkPaintedSteelTexture,
      this.materials.uplinkPainted,
      'authored-cinder-painted-steel-aged-v2-atlas',
    );
    applyAuthoredMap(
      fabricatorPanelTexture,
      this.materials.fabricatorPanel,
      'authored-cinder-weathered-panel-aged-v3-atlas',
    );
    this.materials.fabricatorPanel.userData.authoredAsset =
      '/assets/cinder-weathered-panel-aged-v3.png';
    this.materials.uplinkPainted.userData.authoredAsset =
      '/assets/cinder-painted-steel-aged-v2.png';
    this.materials.uplinkPainted.userData.authoredAssetHash =
      'ebf288d942b2f215f7c92c8ced8b138aaba393698b218e953bac455ae72e0893';

    texture = this.createLowPassTerrainTexture(texture);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(6, 6);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = Math.min(2, this.renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    this.terrainTexture = texture;
    this.createTerrain(texture);
  }

  sync(snapshot: RenderSnapshot): void {
    if (this.disposed) return;
    this.snapshot = snapshot;
    this.entityData.clear();
    const alive = new Set<RenderEntityId>();
    let beltTopologyDirty = false;
    let infrastructureHash = 2166136261;
    let infrastructureCount = 0;

    for (const entity of snapshot.entities) {
      alive.add(entity.id);
      this.entityData.set(entity.id, entity);
      if (entity.health === undefined || entity.health > 0) {
        infrastructureCount += 1;
        infrastructureHash = Math.imul(
          infrastructureHash ^ hashString(entity.kind),
          16777619,
        );
        infrastructureHash = Math.imul(
          infrastructureHash ^ Math.round(entity.x * 32),
          16777619,
        );
        infrastructureHash = Math.imul(
          infrastructureHash ^ Math.round(entity.z * 32),
          16777619,
        );
        infrastructureHash = Math.imul(
          infrastructureHash ^ directionIndex(entity.direction),
          16777619,
        );
        infrastructureHash = Math.imul(
          infrastructureHash ^ hashString(String(entity.id)),
          16777619,
        );
        infrastructureHash = Math.imul(
          infrastructureHash ^ hashString(entity.recipe ?? ''),
          16777619,
        );
        infrastructureHash = Math.imul(
          infrastructureHash ^ Number(entity.uplink === true),
          16777619,
        );
      }
      let rig = this.entityObjects.get(entity.id);
      const variant = this.entityVariant(entity);
      const inserterQualityChanged = rig?.kind === 'inserter'
        && rig.quality !== this.quality;
      const processSignalQualityChanged = (
        rig?.kind === 'smelter'
        || rig?.kind === 'fabricator'
      ) && rig.quality !== this.quality;
      const fabricatorToolingRecipeChanged = rig?.kind === 'fabricator'
        && (
          rig.entity.processRecipe
          ?? rig.entity.recipe
          ?? 'unconfigured'
        ) !== (
          entity.processRecipe
          ?? entity.recipe
          ?? 'unconfigured'
        );
      const gridRelayQualityChanged = rig?.kind === 'gridRelay'
        && rig.quality !== this.quality;
      const uplinkQualityChanged = rig?.variant === 'uplink'
        && rig.quality !== this.quality;
      if (
        !rig
        || rig.kind !== entity.kind
        || rig.variant !== variant
        || inserterQualityChanged
        || processSignalQualityChanged
        || fabricatorToolingRecipeChanged
        || gridRelayQualityChanged
        || uplinkQualityChanged
      ) {
        if (rig?.kind === 'belt') beltTopologyDirty = true;
        if (rig) this.removeEntityRig(entity.id, rig);
        rig = this.createEntityRig(entity);
        this.entityObjects.set(entity.id, rig);
      }
      if (entity.kind === 'belt') {
        const beltDirectionIndex = directionIndex(entity.direction);
        if (
          rig.parts.beltGridX !== entity.x
          || rig.parts.beltGridZ !== entity.z
          || rig.parts.beltDirectionIndex !== beltDirectionIndex
        ) {
          beltTopologyDirty = true;
          rig.parts.beltGridX = entity.x;
          rig.parts.beltGridZ = entity.z;
          rig.parts.beltDirectionIndex = beltDirectionIndex;
        }
      }
      rig.entity = entity;
      const footprint = this.entityFootprint(entity);
      rig.root.position.set(
        entity.x + footprint.worldWidth * 0.5,
        0,
        entity.z + footprint.worldHeight * 0.5,
      );
      rig.root.rotation.y = directionAngle(entity.direction);
      rig.root.scale.set(
        footprint.localWidth === 1 ? 1 : footprint.localWidth * 0.82,
        footprint.localWidth === 1 && footprint.localHeight === 1 ? 1 : 1.28,
        footprint.localHeight === 1 ? 1 : footprint.localHeight * 0.82,
      );
      rig.root.visible = (
        entity.health === undefined
        || entity.health > 0
      ) && (
        (
          entity.kind !== 'inserter'
          && entity.kind !== 'gridRelay'
        )
        || this.quality === 'high'
      );
    }

    for (const [id, rig] of this.entityObjects) {
      if (alive.has(id)) continue;
      if (rig.kind === 'belt') beltTopologyDirty = true;
      this.removeEntityRig(id, rig);
    }

    this.syncInfrastructure(
      snapshot.entities,
      infrastructureHash >>> 0,
      infrastructureCount,
    );
    this.syncUplinkApproachBeltVisuals();
    this.syncResources(snapshot.resources ?? []);
    if (beltTopologyDirty) this.updateBeltConnections();
    const beltItems = snapshot.beltItems ?? [];
    this.itemInstancesDirty = true;
    this.hasProceduralItemMotion = beltItems.some((item) => item.progress === undefined);
    this.updatePerformanceInserters();
    this.updatePerformanceGridRelays();
    this.refreshProcessSignalRepresentations(true);
    this.syncPowerGrid(snapshot.powerGrid);
    this.refreshHighShadowImportanceLOD();
    this.fluidRenderer.sync({
      elapsedSeconds: snapshot.elapsed ?? this.lastElapsed,
      fluidEntities: snapshot.fluidEntities ?? [],
      fluidNetwork: snapshot.fluidNetwork ?? EMPTY_FLUID_NETWORK,
    });
    this.circuitRenderer.sync({
      elapsed: snapshot.elapsed ?? this.lastElapsed,
      circuit: snapshot.circuit ?? EMPTY_CIRCUIT_NETWORK,
      circuitEntities: snapshot.circuitEntities ?? [],
    });
    this.railIntegration.sync({
      elapsed: snapshot.elapsed ?? this.lastElapsed,
      rail: snapshot.rail ?? null,
    });
    this.updateOverlays();
  }

  update(dt: number, elapsed: number): void {
    if (this.disposed) return;
    const safeDt = THREE.MathUtils.clamp(dt, 0, 0.1);
    this.lastElapsed = elapsed;

    for (const rig of this.entityObjects.values()) {
      if (
        this.quality === 'performance'
        && (rig.kind === 'inserter' || rig.kind === 'gridRelay')
      ) continue;
      this.animateRig(rig, safeDt, elapsed);
    }
    if (this.quality === 'performance') this.updatePerformanceInserters();
    this.updatePerformanceProcessSignals();
    this.updatePowerGridPulses(elapsed);
    this.circuitRenderer.update(elapsed);
    this.railIntegration.update(elapsed);

    if (this.itemInstancesDirty || this.hasProceduralItemMotion) {
      this.updateItemInstances(this.snapshot.beltItems ?? [], elapsed);
      this.itemInstancesDirty = false;
    }
    this.updateParticles(safeDt);
    this.updateOverlays(elapsed);
  }

  render(dt: number): void {
    if (this.disposed) return;
    if (this.itemInstancesDirty) {
      this.updateItemInstances(
        this.snapshot.beltItems ?? [],
        this.snapshot.elapsed ?? this.lastElapsed,
      );
      this.itemInstancesDirty = false;
    }
    if (this.quality === 'high') this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.canvas.clientWidth || this.canvas.width || 1);
    const height = Math.max(1, this.canvas.clientHeight || this.canvas.height || 1);
    const deviceRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const pixelRatio = Math.min(deviceRatio, this.quality === 'high' ? 2 : 1);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.particleMaterial.uniforms.uPixelRatio!.value = pixelRatio;

    const halfWidth = this.viewWidth * 0.5;
    const halfHeight = halfWidth / (width / height);
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
    this.refreshProcessSignalRepresentations();
  }

  screenToGrid(clientX: number, clientY: number): GridPoint | null {
    this.setPointer(clientX, clientY);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, point)) return null;
    return { x: Math.floor(point.x), z: Math.floor(point.z) };
  }

  pickEntity(clientX: number, clientY: number): RenderEntityId | null {
    this.setPointer(clientX, clientY);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.entityRoot.children, true);
    for (const hit of hits) {
      const instanceIds = hit.object.userData.entityIds as
        | readonly RenderEntityId[]
        | undefined;
      if (hit.instanceId !== undefined) {
        const instanceEntityId = instanceIds?.[hit.instanceId];
        if (instanceEntityId !== undefined) return instanceEntityId;
      }
      let current: THREE.Object3D | null = hit.object;
      while (current) {
        const id = current.userData.entityId as RenderEntityId | undefined;
        if (id !== undefined) return id;
        current = current.parent;
      }
    }
    return null;
  }

  pickRailTarget(clientX: number, clientY: number): RailPickTarget | null {
    this.setPointer(clientX, clientY);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.railIntegration.root.children,
      true,
    );
    for (const hit of hits) {
      const target = this.railIntegration.resolvePick(
        hit.object,
        hit.instanceId,
      );
      if (target) return target;
    }
    return null;
  }

  setBlueprintOverlay(layout: BlueprintOverlayLayout | null): void {
    if (this.disposed) return;
    this.blueprintOverlayRenderer.setOverlay(layout);
  }

  setBlueprintCaptureMarquee(
    marquee: BlueprintCaptureMarquee | null,
  ): void {
    if (this.disposed) return;
    this.blueprintOverlayRenderer.setCaptureMarquee(marquee);
  }

  getBlueprintOverlayDebug(): BlueprintOverlayRenderDebug {
    return this.blueprintOverlayRenderer.getDebug();
  }

  getFluidRenderDebug(): FluidRenderDebug {
    return this.fluidRenderer.getDebug();
  }

  getCircuitRenderDebug(): CircuitRenderDebug {
    return this.circuitRenderer.getDebug();
  }

  getRailRenderDebug(): RailRenderDebug {
    return this.railIntegration.getDebug();
  }

  getRailRendererIntegration(): RailRendererIntegrationAdapter {
    return this.railIntegration;
  }

  setGhost(
    kind: RenderEntityKind | null,
    x: number,
    z: number,
    dir: RenderDirection,
    valid: boolean,
    reason?: string,
  ): void {
    this.ghostState = kind
      ? {
          kind,
          x,
          z,
          direction: dir,
          valid,
          ...(reason === undefined ? {} : { reason }),
        }
      : null;
    this.updateGhost();
  }

  setHovered(x: number | null, z: number | null): void {
    this.hoveredCell = x === null || z === null ? null : { x, z };
    this.updateOverlays();
  }

  private resolveUplinkEndpointRelayIds(): Set<RenderEntityId> {
    const endpointIds = new Set<RenderEntityId>();
    const uplinks = [...this.entityObjects.values()].filter(
      (rig) => rig.variant === 'uplink' && rig.root.visible,
    );
    for (const uplink of uplinks) {
      let endpoint: EntityRig | undefined;
      let endpointDistanceSquared = Number.POSITIVE_INFINITY;
      for (const candidate of this.entityObjects.values()) {
        if (
          candidate.kind !== 'gridRelay'
          || !candidate.root.visible
          || candidate.entity.powered === false
          || candidate.entity.powerNetworkId === null
        ) continue;
        const dx = candidate.root.position.x - uplink.root.position.x;
        const dz = candidate.root.position.z - uplink.root.position.z;
        const distanceSquared = dx * dx + dz * dz;
        if (
          distanceSquared <= 144
          && distanceSquared < endpointDistanceSquared
        ) {
          endpoint = candidate;
          endpointDistanceSquared = distanceSquared;
        }
      }
      if (endpoint) endpointIds.add(endpoint.entity.id);
    }
    return endpointIds;
  }

  private refreshHighShadowImportanceLOD(): void {
    const endpointRelayIds = this.resolveUplinkEndpointRelayIds();
    const explicitHeroIds = new Set<RenderEntityId>(endpointRelayIds);
    if (this.selectedId !== null) explicitHeroIds.add(this.selectedId);
    for (const rig of this.entityObjects.values()) {
      if (rig.variant === 'uplink') explicitHeroIds.add(rig.entity.id);
    }

    for (const entityId of [...this.highShadowNearHeroIds]) {
      const rig = this.entityObjects.get(entityId);
      if (!rig || !rig.root.visible || explicitHeroIds.has(entityId)) {
        this.highShadowNearHeroIds.delete(entityId);
        continue;
      }
      const distance = Math.hypot(
        rig.root.position.x - this.focusPoint.x,
        rig.root.position.z - this.focusPoint.z,
      );
      if (distance > HIGH_SHADOW_NEAR_HERO_EXIT_DISTANCE) {
        this.highShadowNearHeroIds.delete(entityId);
      }
    }

    const nearCandidates = [...this.entityObjects.values()]
      .filter(
        (rig) =>
          rig.root.visible
          && !explicitHeroIds.has(rig.entity.id)
          && !this.highShadowNearHeroIds.has(rig.entity.id),
      )
      .map((rig) => ({
        entityId: rig.entity.id,
        distance: Math.hypot(
          rig.root.position.x - this.focusPoint.x,
          rig.root.position.z - this.focusPoint.z,
        ),
      }))
      .filter(
        ({ distance }) =>
          distance <= HIGH_SHADOW_NEAR_HERO_ENTER_DISTANCE,
      )
      .sort((left, right) => left.distance - right.distance);
    for (const candidate of nearCandidates) {
      if (
        this.highShadowNearHeroIds.size
        >= MAX_HIGH_SHADOW_NEAR_HEROES
      ) break;
      this.highShadowNearHeroIds.add(candidate.entityId);
    }

    if (
      this.highShadowNearHeroIds.size
      > MAX_HIGH_SHADOW_NEAR_HEROES
    ) {
      const retained = [...this.highShadowNearHeroIds]
        .map((entityId) => {
          const rig = this.entityObjects.get(entityId);
          return {
            entityId,
            distance: rig
              ? Math.hypot(
                  rig.root.position.x - this.focusPoint.x,
                  rig.root.position.z - this.focusPoint.z,
                )
              : Number.POSITIVE_INFINITY,
          };
        })
        .sort((left, right) => left.distance - right.distance)
        .slice(0, MAX_HIGH_SHADOW_NEAR_HEROES);
      this.highShadowNearHeroIds.clear();
      for (const { entityId } of retained) {
        this.highShadowNearHeroIds.add(entityId);
      }
    }

    let authoredShadowCount = 0;
    let activeShadowCount = 0;
    let suppressedShadowCount = 0;
    const managedRigIds: RenderEntityId[] = [];
    for (const rig of this.entityObjects.values()) {
      const importanceRole = rig.variant === 'uplink'
        ? 'uplink'
        : endpointRelayIds.has(rig.entity.id)
          ? 'uplink-endpoint-relay'
          : rig.entity.id === this.selectedId
            ? 'selected'
            : this.highShadowNearHeroIds.has(rig.entity.id)
              ? 'near-focus-hero'
              : 'background-nonhero';
      const shadowEnabled = (
        this.quality !== 'high'
        || importanceRole !== 'background-nonhero'
      );
      rig.root.userData.highShadowImportanceRole = importanceRole;
      rig.root.userData.highShadowSubmissionEnabled = shadowEnabled;
      managedRigIds.push(rig.entity.id);
      rig.root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (!this.authoredCastShadow.has(object)) {
          this.authoredCastShadow.set(object, object.castShadow);
        }
        const authored = this.authoredCastShadow.get(object) === true;
        if (authored) authoredShadowCount += 1;
        object.castShadow = authored && shadowEnabled;
        if (object.castShadow) activeShadowCount += 1;
        else if (authored) suppressedShadowCount += 1;
      });
    }
    this.highShadowLodRevision += 1;
    this.entityRoot.userData.highShadowImportanceLod = {
      revision: this.highShadowLodRevision,
      quality: this.quality,
      selectedId: this.selectedId,
      endpointRelayIds: [...endpointRelayIds],
      nearHeroIds: [...this.highShadowNearHeroIds],
      managedRigIds,
      managedRigCount: managedRigIds.length,
      authoredShadowCount,
      activeShadowCount,
      suppressedShadowCount,
      foreignAdapterTraversalCount: 0,
      authoredStateCache: 'weak-map-no-geometry-or-material-allocation',
      enterDistance: HIGH_SHADOW_NEAR_HERO_ENTER_DISTANCE,
      exitDistance: HIGH_SHADOW_NEAR_HERO_EXIT_DISTANCE,
      maxNearHeroes: MAX_HIGH_SHADOW_NEAR_HEROES,
    };
  }

  setSelected(id: RenderEntityId | null): void {
    this.selectedId = id;
    this.refreshProcessSignalRepresentations(true);
    this.refreshHighShadowImportanceLOD();
    this.updateOverlays();
  }

  pan(dx: number, dz: number): void {
    this.focusPoint.x += dx;
    this.focusPoint.z += dz;
    this.positionCamera();
    this.refreshHighShadowImportanceLOD();
  }

  zoom(delta: number): void {
    const normalized = THREE.MathUtils.clamp(delta, -4, 4);
    this.viewWidth = THREE.MathUtils.clamp(
      this.viewWidth * Math.exp(normalized * 0.12),
      MIN_VIEW_WIDTH,
      MAX_VIEW_WIDTH,
    );
    this.resize();
    this.refreshHighShadowImportanceLOD();
  }

  focus(x: number, z: number): void {
    this.focusPoint.set(x, 0, z);
    this.positionCamera();
    this.refreshHighShadowImportanceLOD();
  }

  toggleQuality(): RenderQuality {
    this.quality = this.quality === 'high' ? 'performance' : 'high';
    this.renderer.shadowMap.enabled = this.quality === 'high';
    this.bloomPass.enabled = this.quality === 'high';
    this.sun.shadow.mapSize.set(
      this.quality === 'high' ? 2048 : 1024,
      this.quality === 'high' ? 2048 : 1024,
    );
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    // Inserter and production-signal rigs are quality-specific. Performance
    // mode releases their close-up hardware and uses shared instancing;
    // returning to high recreates the authored rigs from authoritative state.
    this.sync(this.snapshot);
    this.resize();
    this.refreshHighShadowImportanceLOD();
    return this.quality;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.blueprintOverlayRenderer.dispose();
    this.railIntegration.dispose();
    this.fluidRenderer.dispose();
    this.circuitRenderer.dispose();

    const geometriesToDispose = new Set<THREE.BufferGeometry>();
    const materialsToDispose = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (
        object instanceof THREE.Mesh
        || object instanceof THREE.Points
        || object instanceof THREE.Line
        || object instanceof THREE.LineSegments
      ) {
        geometriesToDispose.add(object.geometry);
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) materialsToDispose.add(material);
      }
    });
    for (const material of this.materials.housingMaterials) materialsToDispose.add(material);
    for (const pair of Object.values(this.beltSurfaces)) {
      materialsToDispose.add(pair.active.material);
      materialsToDispose.add(pair.idle.material);
    }
    for (const geometry of geometriesToDispose) geometry.dispose();
    for (const material of materialsToDispose) material.dispose();
    this.terrainTexture?.dispose();
    for (const texture of this.materials.surfaceTextures) texture.dispose();
    for (const pair of Object.values(this.beltSurfaces)) {
      pair.active.texture.dispose();
      pair.idle.texture.dispose();
    }
    this.composer.dispose();
    this.renderer.dispose();
    this.entityObjects.clear();
    this.entityData.clear();
    this.resourceObjects.clear();
  }

  private createParticleMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: 1 } },
      vertexShader: `
        uniform float uPixelRatio;
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = aAlpha;
          gl_PointSize = aSize * uPixelRatio;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float radial = length(gl_PointCoord - vec2(0.5)) * 2.0;
          float alpha = (1.0 - smoothstep(0.35, 1.0, radial)) * vAlpha;
          if (alpha <= 0.002) discard;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });
  }

  private createSelectionHalo(): THREE.Mesh {
    const pieces: THREE.BufferGeometry[] = [];
    const addBox = (
      width: number,
      height: number,
      depth: number,
      x: number,
      y: number,
      z: number,
    ): void => {
      const geometry = new THREE.BoxGeometry(width, height, depth);
      geometry.translate(x, y, z);
      pieces.push(geometry);
    };
    const outer = 0.66;
    const rail = 0.024;
    const railHeight = 0.036;
    const arm = 0.22;
    for (const sideX of [-1, 1]) {
      for (const sideZ of [-1, 1]) {
        const x = sideX * outer;
        const z = sideZ * outer;
        addBox(
          arm,
          railHeight,
          rail,
          x - sideX * (arm * 0.5 - rail * 0.5),
          railHeight * 0.5,
          z,
        );
        addBox(
          rail,
          railHeight,
          arm,
          x,
          railHeight * 0.5,
          z - sideZ * (arm * 0.5 - rail * 0.5),
        );
        const post = new THREE.CylinderGeometry(0.035, 0.045, 0.22, 6, 1);
        post.translate(x, 0.11, z);
        pieces.push(post);
        const cap = new THREE.CylinderGeometry(0.058, 0.04, 0.038, 6, 1);
        cap.translate(x, 0.228, z);
        pieces.push(cap);
      }
    }
    const geometry = mergeGeometries(pieces, false);
    pieces.forEach((piece) => piece.dispose());
    if (!geometry) {
      throw new Error('Could not assemble selection footprint.');
    }
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: '#4f9188',
        emissive: '#35c9b5',
        emissiveIntensity: 0.82,
        metalness: 0.62,
        roughness: 0.34,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.name = 'selected-machine-ground-corner-brackets';
    mesh.frustumCulled = false;
    mesh.renderOrder = 1500;
    mesh.visible = false;
    return mesh;
  }

  private createInserterPerformanceBatches(): InserterPerformanceBatches {
    const root = new THREE.Group();
    root.name = 'performance-inserters';
    root.visible = false;

    const lowerDrum = new THREE.CylinderGeometry(0.28, 0.32, 0.22, 8, 1);
    lowerDrum.translate(0, 0.12, 0);
    const upperDrum = new THREE.CylinderGeometry(0.2, 0.24, 0.18, 8, 1);
    upperDrum.translate(0, 0.29, 0);
    const bearing = new THREE.CylinderGeometry(0.16, 0.16, 0.06, 12, 1);
    bearing.translate(0, 0.41, 0);
    const baseGeometry = mergeGeometries([lowerDrum, upperDrum, bearing], false);
    lowerDrum.dispose();
    upperDrum.dispose();
    bearing.dispose();
    if (!baseGeometry) {
      throw new Error('Could not assemble the performance inserter base.');
    }

    const baseMaterial = new THREE.MeshStandardMaterial({
      color: '#6e7570',
      roughness: 0.7,
      metalness: 0.36,
    });
    const armMaterial = new THREE.MeshStandardMaterial({
      color: '#3f4a49',
      roughness: 0.66,
      metalness: 0.48,
    });
    const wristMaterial = new THREE.MeshStandardMaterial({
      color: '#9e6738',
      roughness: 0.56,
      metalness: 0.42,
    });
    const jawMaterial = new THREE.MeshStandardMaterial({
      color: '#818984',
      roughness: 0.58,
      metalness: 0.52,
    });
    const signalMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff' });

    const makeBatch = (
      name: string,
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      capacity: number,
    ): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.name = name;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      root.add(mesh);
      return mesh;
    };

    const base = makeBatch(
      'performance-inserter-bases',
      baseGeometry,
      baseMaterial,
      MAX_PERFORMANCE_INSERTERS,
    );
    const arm = makeBatch(
      'performance-inserter-arms',
      new THREE.BoxGeometry(1, 1, 1),
      armMaterial,
      MAX_PERFORMANCE_INSERTERS,
    );
    const wrist = makeBatch(
      'performance-inserter-wrists',
      new THREE.BoxGeometry(0.32, 0.12, 0.16),
      wristMaterial,
      MAX_PERFORMANCE_INSERTERS,
    );
    const jaws = makeBatch(
      'performance-inserter-jaws',
      new THREE.BoxGeometry(0.065, 0.16, 0.08),
      jawMaterial,
      MAX_PERFORMANCE_INSERTERS * 2,
    );
    const signal = makeBatch(
      'performance-inserter-signals',
      new THREE.SphereGeometry(0.032, 7, 5),
      signalMaterial,
      MAX_PERFORMANCE_INSERTERS,
    );

    const payloadGeometries: Record<ItemVisualKind, THREE.BufferGeometry> = {
      ore: new THREE.DodecahedronGeometry(0.105, 0),
      ingot: new RoundedBoxGeometry(0.16, 0.075, 0.23, 2, 0.022),
      coil: createStrappedCoilGeometry(0.082, 0.027),
      component: new THREE.OctahedronGeometry(0.11, 0),
    };
    payloadGeometries.component.rotateY(Math.PI / 4);
    const payloads = {} as Record<ItemVisualKind, THREE.InstancedMesh>;
    for (const kind of Object.keys(payloadGeometries) as ItemVisualKind[]) {
      payloads[kind] = makeBatch(
        `performance-inserter-payloads-${kind}`,
        payloadGeometries[kind],
        new THREE.MeshStandardMaterial({
          color: '#ffffff',
          roughness: kind === 'ore' ? 0.76 : 0.33,
          metalness: kind === 'ore' ? 0.2 : 0.72,
          vertexColors: kind === 'coil',
        }),
        MAX_PERFORMANCE_INSERTERS,
      );
    }

    const entityIds: RenderEntityId[] = [];
    const jawEntityIds: RenderEntityId[] = [];
    const payloadEntityIds: Record<ItemVisualKind, RenderEntityId[]> = {
      ore: [],
      ingot: [],
      coil: [],
      component: [],
    };
    for (const mesh of [base, arm, wrist, signal]) {
      mesh.userData.entityIds = entityIds;
    }
    jaws.userData.entityIds = jawEntityIds;
    for (const kind of Object.keys(payloads) as ItemVisualKind[]) {
      payloads[kind].userData.entityIds = payloadEntityIds[kind];
    }

    this.entityRoot.add(root);
    return {
      root,
      base,
      arm,
      wrist,
      jaws,
      signal,
      payloads,
      entityIds,
      jawEntityIds,
      payloadEntityIds,
    };
  }

  private updatePerformanceInserters(): void {
    const batches = this.inserterPerformance;
    const enabled = this.quality === 'performance';
    batches.root.visible = enabled;
    if (!enabled) {
      batches.base.count = 0;
      batches.arm.count = 0;
      batches.wrist.count = 0;
      batches.jaws.count = 0;
      batches.signal.count = 0;
      for (const payload of Object.values(batches.payloads)) payload.count = 0;
      return;
    }

    batches.entityIds.length = 0;
    batches.jawEntityIds.length = 0;
    for (const ids of Object.values(batches.payloadEntityIds)) ids.length = 0;
    const payloadCounts: Record<ItemVisualKind, number> = {
      ore: 0,
      ingot: 0,
      coil: 0,
      component: 0,
    };
    let inserterCount = 0;
    let jawCount = 0;

    const setMatrix = (
      mesh: THREE.InstancedMesh,
      index: number,
      x: number,
      y: number,
      z: number,
      scaleX: number,
      scaleY: number,
      scaleZ: number,
      yaw: number,
    ): void => {
      this.tempObject.position.set(x, y, z);
      this.tempObject.rotation.set(0, yaw, 0);
      this.tempObject.scale.set(scaleX, scaleY, scaleZ);
      this.tempObject.updateMatrix();
      mesh.setMatrixAt(index, this.tempObject.matrix);
    };

    for (const entity of this.entityData.values()) {
      if (
        entity.kind !== 'inserter'
        || (entity.health !== undefined && entity.health <= 0)
        || inserterCount >= MAX_PERFORMANCE_INSERTERS
      ) continue;

      const progress = entity.progress === undefined
        ? fract(
            this.lastElapsed * this.rigCycleSpeed('inserter')
            + seededUnit(hashString(String(entity.id))),
          )
        : THREE.MathUtils.clamp(entity.progress, 0, 1);
      const carriedItem = entity.carriedItem;
      const pickupContact = entity.pickupContact ?? [0, 0.5];
      const dropContact = entity.dropContact ?? [0, -0.5];
      const swing = THREE.MathUtils.smoothstep(progress, 0.14, 0.86);
      const lift = THREE.MathUtils.smoothstep(progress, 0.04, 0.16)
        * (1 - THREE.MathUtils.smoothstep(progress, 0.84, 0.96));
      const releaseSnap = !carriedItem && entity.armReturning
        ? THREE.MathUtils.smoothstep(progress, 0.82, 0.99)
        : 0;
      const sourceWristX = -pickupContact[0];
      const sourceWristZ = -pickupContact[1];
      const wristX = THREE.MathUtils.lerp(sourceWristX, dropContact[0], swing);
      const wristZ = THREE.MathUtils.lerp(sourceWristZ, dropContact[1], swing)
        + 0.26 * releaseSnap;
      const rootYaw = directionAngle(entity.direction);
      const armYaw = rootYaw + Math.PI * (1 - swing);
      const armCos = Math.cos(armYaw);
      const armSin = Math.sin(armYaw);
      const centerX = entity.x + 0.5;
      const centerZ = entity.z + 0.5;
      const handX = centerX + armCos * wristX + armSin * wristZ;
      const handZ = centerZ - armSin * wristX + armCos * wristZ;
      const handY = 0.385 + 0.2 * lift + 0.12 * releaseSnap;
      const pivotY = 0.39;

      batches.entityIds.push(entity.id);
      setMatrix(
        batches.base,
        inserterCount,
        centerX,
        0,
        centerZ,
        1,
        1,
        1,
        rootYaw,
      );

      this.tempVector.set(centerX, pivotY, centerZ);
      this.tempVectorB.set(handX, handY + 0.015, handZ).sub(this.tempVector);
      const armLength = Math.max(0.08, this.tempVectorB.length());
      this.tempQuaternion.setFromUnitVectors(
        UNIT_Y,
        this.tempVectorB.normalize(),
      );
      this.tempObject.position.copy(this.tempVector).addScaledVector(
        this.tempVectorB,
        armLength * 0.5,
      );
      this.tempObject.quaternion.copy(this.tempQuaternion);
      this.tempObject.scale.set(0.105, armLength, 0.105);
      this.tempObject.updateMatrix();
      batches.arm.setMatrixAt(inserterCount, this.tempObject.matrix);

      setMatrix(
        batches.wrist,
        inserterCount,
        handX,
        handY,
        handZ,
        1,
        1,
        1,
        armYaw,
      );

      const closure = carriedItem
        ? 0.72 + 0.28 * THREE.MathUtils.smoothstep(progress, 0.01, 0.1)
        : 0;
      const jawOffset = THREE.MathUtils.lerp(0.17, 0.115, closure);
      for (const sign of [-1, 1]) {
        const lateral = sign * jawOffset;
        const jawX = handX + armCos * lateral - armSin * 0.045;
        const jawZ = handZ - armSin * lateral - armCos * 0.045;
        setMatrix(
          batches.jaws,
          jawCount,
          jawX,
          handY - 0.105,
          jawZ,
          1,
          1,
          1,
          armYaw,
        );
        batches.jawEntityIds.push(entity.id);
        jawCount += 1;
      }

      const rootCos = Math.cos(rootYaw);
      const rootSin = Math.sin(rootYaw);
      const signalX = centerX + rootCos * 0.19 + rootSin * 0.18;
      const signalZ = centerZ - rootSin * 0.19 + rootCos * 0.18;
      setMatrix(
        batches.signal,
        inserterCount,
        signalX,
        0.34,
        signalZ,
        1,
        1,
        1,
        rootYaw,
      );
      const signalColor = entity.powered === false || entity.status === 'unpowered'
        ? '#ff6550'
        : entity.status === 'blocked'
          ? '#ff6550'
          : entity.status === 'working'
            ? '#43d7c4'
            : '#d89a45';
      batches.signal.setColorAt(inserterCount, this.tempColor.set(signalColor));

      if (carriedItem) {
        const visualKind = this.itemVisualKind(carriedItem);
        const payloadIndex = payloadCounts[visualKind];
        const payload = batches.payloads[visualKind];
        const payloadX = handX - armSin * 0.06;
        const payloadZ = handZ - armCos * 0.06;
        setMatrix(
          payload,
          payloadIndex,
          payloadX,
          handY - 0.105,
          payloadZ,
          1,
          1,
          1,
          armYaw,
        );
        payload.setColorAt(
          payloadIndex,
          this.itemColor(
            carriedItem,
            entity.carriedItemColor,
            hashString(`inserter-performance-custody:${carriedItem}`),
          ),
        );
        batches.payloadEntityIds[visualKind].push(entity.id);
        payloadCounts[visualKind] += 1;
      }
      inserterCount += 1;
    }

    batches.base.count = inserterCount;
    batches.arm.count = inserterCount;
    batches.wrist.count = inserterCount;
    batches.jaws.count = jawCount;
    batches.signal.count = inserterCount;
    for (const mesh of [
      batches.base,
      batches.arm,
      batches.wrist,
      batches.jaws,
      batches.signal,
    ]) {
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (batches.signal.instanceColor) {
      batches.signal.instanceColor.needsUpdate = true;
    }
    for (const kind of Object.keys(batches.payloads) as ItemVisualKind[]) {
      const payload = batches.payloads[kind];
      payload.count = payloadCounts[kind];
      payload.instanceMatrix.needsUpdate = true;
      if (payload.instanceColor) payload.instanceColor.needsUpdate = true;
    }
  }

  private createProcessSignalPerformanceBatches(): ProcessSignalPerformanceBatches {
    const root = new THREE.Group();
    root.name = 'performance-process-signals';
    root.visible = false;

    // These marks only appear in the overview/performance representation.
    // Lambert shading keeps their physical volume under the scene lights while
    // avoiding five tiny PBR passes across a full 128-machine field.
    const plaqueMaterial = new THREE.MeshBasicMaterial({
      color: '#ffffff',
    });
    const partMaterial = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      side: THREE.DoubleSide,
    });
    const ringMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const tokenMaterial = new THREE.MeshBasicMaterial({
      color: '#ffffff',
    });
    const makeBatch = (
      name: string,
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      capacity: number,
    ): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(
        geometry,
        material,
        capacity,
      );
      mesh.name = name;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      root.add(mesh);
      return mesh;
    };

    const plaques = makeBatch(
      'performance-process-plaques',
      new THREE.CylinderGeometry(0.22, 0.21, 0.055, 6, 1),
      plaqueMaterial,
      MAX_PERFORMANCE_PROCESS_MACHINES * 4,
    );
    // Two crossed quads retain both deck-mounted glyph plates and upright
    // witness posts from the isometric camera. At overview scale this reads
    // identically to a tiny solid bar while cutting the dominant 4k-instance
    // batch from ten triangles per bar to four.
    const overviewHorizontal = new THREE.PlaneGeometry(1, 1);
    overviewHorizontal.rotateX(-Math.PI / 2);
    const overviewVertical = new THREE.PlaneGeometry(1, 1);
    const overviewBarGeometry = mergeGeometries(
      [overviewHorizontal, overviewVertical],
      false,
    );
    overviewHorizontal.dispose();
    overviewVertical.dispose();
    if (!overviewBarGeometry) {
      throw new Error('Could not assemble process overview crossed-quad bars.');
    }
    const bars = makeBatch(
      'performance-process-bars',
      overviewBarGeometry,
      partMaterial,
      MAX_PERFORMANCE_PROCESS_MACHINES * 72,
    );
    const ringGeometry = new THREE.TorusGeometry(0.1, 0.026, 3, 8);
    ringGeometry.rotateX(Math.PI / 2);
    const rings = makeBatch(
      'performance-process-rings',
      ringGeometry,
      ringMaterial,
      MAX_PERFORMANCE_PROCESS_MACHINES * 16,
    );
    const octahedra = makeBatch(
      'performance-process-octahedra',
      new THREE.OctahedronGeometry(0.095, 0),
      tokenMaterial,
      MAX_PERFORMANCE_PROCESS_MACHINES * 6,
    );
    const tokens = makeBatch(
      'performance-process-reclaim-tokens',
      new THREE.IcosahedronGeometry(0.058, 0),
      tokenMaterial.clone(),
      MAX_PERFORMANCE_PROCESS_MACHINES * 4,
    );
    const entityIds = {
      plaques: [] as RenderEntityId[],
      bars: [] as RenderEntityId[],
      rings: [] as RenderEntityId[],
      octahedra: [] as RenderEntityId[],
      tokens: [] as RenderEntityId[],
    };
    plaques.userData.entityIds = entityIds.plaques;
    bars.userData.entityIds = entityIds.bars;
    rings.userData.entityIds = entityIds.rings;
    octahedra.userData.entityIds = entityIds.octahedra;
    tokens.userData.entityIds = entityIds.tokens;
    this.entityRoot.add(root);
    return {
      root,
      plaques,
      bars,
      rings,
      octahedra,
      tokens,
      entityIds,
      signatures: new Map(),
    };
  }

  private createGridRelayPerformanceBatches(): GridRelayPerformanceBatches {
    const root = new THREE.Group();
    root.name = 'performance-grid-relays';
    root.visible = false;

    const baseLower = new THREE.BoxGeometry(0.72, 0.12, 0.72);
    baseLower.translate(0, 0.065, 0);
    const baseUpper = new THREE.BoxGeometry(0.53, 0.1, 0.53);
    baseUpper.rotateY(Math.PI / 4);
    baseUpper.translate(0, 0.16, 0);
    const baseFeet = ([
      [-0.33, -0.33, Math.PI / 4],
      [0.33, -0.33, -Math.PI / 4],
      [-0.33, 0.33, -Math.PI / 4],
      [0.33, 0.33, Math.PI / 4],
    ] as const).map(([x, z, rotationY]) => {
      const foot = new THREE.BoxGeometry(0.2, 0.08, 0.16);
      foot.rotateY(rotationY);
      foot.translate(x, 0.08, z);
      return foot;
    });
    const baseServiceBox = new THREE.BoxGeometry(0.22, 0.24, 0.18);
    baseServiceBox.translate(-0.32, 0.29, 0.12);
    const baseServiceLatch = new THREE.BoxGeometry(0.14, 0.035, 0.04);
    baseServiceLatch.rotateZ(-0.12);
    baseServiceLatch.translate(-0.32, 0.36, 0.015);
    const baseTransformerCan = new THREE.BoxGeometry(0.38, 0.38, 0.34);
    baseTransformerCan.translate(0, 0.47, 0);
    const baseBolts = ([
      [-0.31, -0.31],
      [0.31, -0.31],
      [-0.31, 0.31],
      [0.31, 0.31],
    ] as const).map(([x, z]) => {
      const bolt = new THREE.CylinderGeometry(0.027, 0.027, 0.035, 8, 1);
      bolt.translate(x, 0.225, z);
      return bolt;
    });
    const baseGeometry = mergeGeometries(
      [
        baseLower,
        baseUpper,
        ...baseFeet,
        baseServiceBox,
        baseServiceLatch,
        baseTransformerCan,
        ...baseBolts,
      ],
      false,
    );
    baseLower.dispose();
    baseUpper.dispose();
    for (const foot of baseFeet) foot.dispose();
    baseServiceBox.dispose();
    baseServiceLatch.dispose();
    baseTransformerCan.dispose();
    for (const bolt of baseBolts) bolt.dispose();
    if (!baseGeometry) throw new Error('Could not assemble grid relay LOD base.');

    const mastShaft = new THREE.CylinderGeometry(0.038, 0.052, 1.02, 10, 1);
    mastShaft.translate(0, 0.72, 0);
    const mastTerminal = new THREE.CylinderGeometry(0.09, 0.075, 0.09, 12, 1);
    mastTerminal.translate(0, 1.29, 0);
    const mastCrossX = new THREE.BoxGeometry(0.82, 0.07, 0.075);
    mastCrossX.translate(0, 1.17, -0.07);
    const mastCrossZ = new THREE.BoxGeometry(0.075, 0.07, 0.78);
    mastCrossZ.translate(-0.06, 1.17, 0);
    const mastFuseBox = new THREE.BoxGeometry(0.13, 0.14, 0.11);
    mastFuseBox.translate(0.21, 1.25, -0.07);
    const mastTerminalCaps = ([
      [-POWER_GRID_TERMINAL_OFFSET, -0.07],
      [POWER_GRID_TERMINAL_OFFSET, -0.07],
      [-0.06, -POWER_GRID_TERMINAL_OFFSET],
      [-0.06, POWER_GRID_TERMINAL_OFFSET],
    ] as const).map(([x, z]) => {
      const cap = new THREE.CylinderGeometry(0.064, 0.058, 0.06, 10, 1);
      cap.translate(x, POWER_GRID_TERMINAL_HEIGHT - 0.03, z);
      return cap;
    });
    const mastBraceA = new THREE.BoxGeometry(0.34, 0.032, 0.032);
    mastBraceA.rotateZ(-0.55);
    mastBraceA.translate(-0.18, 1.06, -0.07);
    const mastBraceB = new THREE.BoxGeometry(0.32, 0.032, 0.032);
    mastBraceB.rotateZ(0.58);
    mastBraceB.translate(0.17, 1.06, -0.07);
    const latticeLegs = ([
      [-0.1, -0.1],
      [0.1, -0.1],
      [-0.1, 0.1],
      [0.1, 0.1],
    ] as const).map(([x, z]) => {
      const leg = new THREE.BoxGeometry(0.038, 0.82, 0.038);
      leg.translate(x, 0.68, z);
      return leg;
    });
    const latticeBraces: THREE.BoxGeometry[] = [];
    for (const z of [-0.1, 0.1]) {
      for (const [y, rotation] of [[0.48, 0.74], [0.82, -0.74]] as const) {
        const brace = new THREE.BoxGeometry(0.32, 0.026, 0.026);
        brace.rotateZ(rotation);
        brace.translate(0, y, z);
        latticeBraces.push(brace);
      }
    }
    for (const x of [-0.1, 0.1]) {
      for (const [y, rotation] of [[0.48, 0.74], [0.82, -0.74]] as const) {
        const brace = new THREE.BoxGeometry(0.026, 0.026, 0.32);
        brace.rotateX(rotation);
        brace.translate(x, y, 0);
        latticeBraces.push(brace);
      }
    }
    const mastGeometry = mergeGeometries(
      [
        mastShaft,
        mastTerminal,
        mastCrossX,
        mastCrossZ,
        mastFuseBox,
        ...mastTerminalCaps,
        mastBraceA,
        mastBraceB,
        ...latticeLegs,
        ...latticeBraces,
      ],
      false,
    );
    mastShaft.dispose();
    mastTerminal.dispose();
    mastCrossX.dispose();
    mastCrossZ.dispose();
    mastFuseBox.dispose();
    for (const cap of mastTerminalCaps) cap.dispose();
    mastBraceA.dispose();
    mastBraceB.dispose();
    for (const leg of latticeLegs) leg.dispose();
    for (const brace of latticeBraces) brace.dispose();
    if (!mastGeometry) throw new Error('Could not assemble grid relay LOD mast.');

    const insulatorStem = new THREE.CylinderGeometry(0.032, 0.04, 0.36, 10, 1);
    insulatorStem.translate(0, 1.2, 0);
    const insulatorSkirts = [1.1, 1.21, 1.32].map((y, index) => {
      const skirt = new THREE.CylinderGeometry(
        0.085 - index * 0.007,
        0.062 - index * 0.005,
        0.055,
        12,
        1,
      );
      skirt.translate(0, y, 0);
      return skirt;
    });
    const insulatorGeometry = mergeGeometries(
      [insulatorStem, ...insulatorSkirts],
      false,
    );
    insulatorStem.dispose();
    for (const skirt of insulatorSkirts) skirt.dispose();
    if (!insulatorGeometry) {
      throw new Error('Could not assemble grid relay LOD insulator.');
    }

    const coilRing = new THREE.TorusGeometry(0.15, 0.024, 7, 18);
    coilRing.rotateX(Math.PI / 2);
    const coilTieX = new THREE.BoxGeometry(0.29, 0.024, 0.026);
    const coilTieZ = new THREE.BoxGeometry(0.026, 0.024, 0.29);
    const coilGeometry = mergeGeometries(
      [coilRing, coilTieX, coilTieZ],
      false,
    );
    coilRing.dispose();
    coilTieX.dispose();
    coilTieZ.dispose();
    if (!coilGeometry) throw new Error('Could not assemble grid relay LOD coil.');

    const makeBatch = (
      name: string,
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      capacity: number,
    ): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.name = name;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      root.add(mesh);
      return mesh;
    };

    const bases = makeBatch(
      'performance-grid-relay-bases',
      baseGeometry,
      this.materials.carbon,
      MAX_PERFORMANCE_GRID_RELAYS,
    );
    const masts = makeBatch(
      'performance-grid-relay-masts',
      mastGeometry,
      this.materials.titaniumLight,
      MAX_PERFORMANCE_GRID_RELAYS,
    );
    const insulators = makeBatch(
      'performance-grid-relay-insulators',
      insulatorGeometry,
      this.materials.agedCeramic,
      MAX_PERFORMANCE_GRID_RELAYS * 4,
    );
    const coils = makeBatch(
      'performance-grid-relay-copper-coils',
      coilGeometry,
      this.materials.agedCopper,
      MAX_PERFORMANCE_GRID_RELAYS * 3,
    );
    const lampMaterial = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      emissive: '#203b39',
      emissiveIntensity: 1.1,
      roughness: 0.28,
      metalness: 0.24,
      vertexColors: true,
    });
    const lamps = makeBatch(
      'performance-grid-relay-network-lamps',
      new THREE.OctahedronGeometry(0.055, 0),
      lampMaterial,
      MAX_PERFORMANCE_GRID_RELAYS,
    );
    const entityIds = {
      bases: [] as RenderEntityId[],
      masts: [] as RenderEntityId[],
      insulators: [] as RenderEntityId[],
      coils: [] as RenderEntityId[],
      lamps: [] as RenderEntityId[],
    };
    bases.userData.entityIds = entityIds.bases;
    masts.userData.entityIds = entityIds.masts;
    insulators.userData.entityIds = entityIds.insulators;
    coils.userData.entityIds = entityIds.coils;
    lamps.userData.entityIds = entityIds.lamps;
    this.entityRoot.add(root);
    return {
      root,
      bases,
      masts,
      insulators,
      coils,
      lamps,
      entityIds,
    };
  }

  private createPowerGridBatches(): PowerGridBatches {
    const root = this.powerGridRoot;
    root.name = 'local-power-grid';
    root.visible = false;

    const cableMaterial = new THREE.MeshStandardMaterial({
      color: '#855433',
      roughness: 0.46,
      metalness: 0.74,
      transparent: true,
      opacity: 1,
    });
    const cables = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 8, 1),
      cableMaterial,
      MAX_POWER_GRID_LINKS * POWER_GRID_CABLE_SEGMENTS,
    );
    cables.name = 'local-grid-overhead-cable-spans';
    cables.count = 0;
    cables.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    cables.castShadow = true;
    cables.receiveShadow = false;
    cables.frustumCulled = false;

    const cableShadows = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 6, 1),
      new THREE.MeshBasicMaterial({
        color: '#080b0b',
        transparent: true,
        opacity: 0.28,
        depthTest: true,
        depthWrite: false,
      }),
      MAX_POWER_GRID_LINKS * POWER_GRID_CABLE_SEGMENTS,
    );
    cableShadows.name = 'local-grid-sunward-wire-shadows';
    cableShadows.count = 0;
    cableShadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    cableShadows.castShadow = false;
    cableShadows.receiveShadow = false;
    cableShadows.frustumCulled = false;

    const pulseMaterial = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      emissive: '#b9fff4',
      emissiveIntensity: 1.65,
      roughness: 0.22,
      metalness: 0.14,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      vertexColors: true,
    });
    const pulses = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.042, 8, 6),
      pulseMaterial,
      MAX_POWER_GRID_LINKS,
    );
    pulses.name = 'local-grid-restrained-network-pulses';
    pulses.count = 0;
    pulses.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    pulses.castShadow = false;
    pulses.receiveShadow = false;
    pulses.frustumCulled = false;
    root.add(cableShadows, cables, pulses);
    return { root, cables, cableShadows, pulses };
  }

  private createPowerGridSelectionVisuals(): PowerGridSelectionVisuals {
    const root = this.powerGridSelectionRoot;
    root.name = 'selected-local-grid-coverage-and-links';
    root.visible = false;

    const coverageFill = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uColor: { value: new THREE.Color('#50e6d0') },
          uOpacity: { value: 0.16 },
          uCells: { value: 6 },
          uGlobal: { value: 0 },
        },
        vertexShader: `
          varying vec2 vCoverageUv;
          void main() {
            vCoverageUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uOpacity;
          uniform float uCells;
          uniform float uGlobal;
          varying vec2 vCoverageUv;
          void main() {
            vec2 tile = vCoverageUv * uCells;
            vec2 local = abs(fract(tile) - 0.5);
            float cellLine = 1.0 - smoothstep(0.455, 0.495, max(local.x, local.y));
            vec2 cellIndex = floor(tile);
            float checker = mod(cellIndex.x + cellIndex.y, 2.0);
            float sparseCell = mix(0.1, 0.24, checker);
            float boundaryDistance = min(
              min(vCoverageUv.x, 1.0 - vCoverageUv.x),
              min(vCoverageUv.y, 1.0 - vCoverageUv.y)
            );
            float feather = smoothstep(0.0, 0.055, boundaryDistance);
            float field = (0.025 + cellLine * 0.42) * sparseCell;
            field *= mix(1.0, 0.58, uGlobal);
            float alpha = uOpacity * field * feather;
            if (alpha < 0.004) discard;
            gl_FragColor = vec4(uColor, alpha);
          }
        `,
      }),
    );
    coverageFill.name = 'selected-grid-relay-tile-locked-coverage-cells';
    coverageFill.rotation.x = -Math.PI / 2;
    coverageFill.frustumCulled = false;
    coverageFill.renderOrder = 1509;

    const coverageGeometry = new THREE.BufferGeometry();
    coverageGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(48 * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    const coverage = new THREE.LineSegments(
      coverageGeometry,
      new THREE.LineBasicMaterial({
        color: '#50e6d0',
        transparent: true,
        opacity: 0.72,
        depthTest: false,
        depthWrite: false,
      }),
    );
    coverage.name = 'selected-grid-relay-axis-aligned-coverage-square';
    coverage.frustumCulled = false;
    coverage.renderOrder = 1510;

    const links = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 8, 1),
      new THREE.MeshBasicMaterial({
        color: '#70f2df',
        transparent: true,
        opacity: 0.62,
        depthTest: true,
        depthWrite: false,
      }),
      MAX_POWER_GRID_SELECTED_LINKS * POWER_GRID_CABLE_SEGMENTS,
    );
    links.name = 'selected-grid-relay-connected-cable-emphasis';
    links.count = 0;
    links.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    links.castShadow = false;
    links.receiveShadow = false;
    links.frustumCulled = false;
    links.renderOrder = 1512;
    root.add(coverageFill, coverage, links);
    return { root, coverageFill, coverage, links };
  }

  private usesAuthoredProcessSignals(rig: EntityRig): boolean {
    return (
      this.quality === 'high'
      && rig.parts.processSignalRoot !== undefined
      && (
        !this.processSignalOverviewLOD
        || rig.entity.id === this.selectedId
      )
    );
  }

  private updateProcessSignalLODState(): boolean {
    const previous = this.processSignalOverviewLOD;
    if (previous) {
      if (this.viewWidth <= PROCESS_SIGNAL_OVERVIEW_EXIT_WIDTH) {
        this.processSignalOverviewLOD = false;
      }
    } else if (this.viewWidth >= PROCESS_SIGNAL_OVERVIEW_ENTER_WIDTH) {
      this.processSignalOverviewLOD = true;
    }
    return previous !== this.processSignalOverviewLOD;
  }

  private refreshProcessSignalRepresentations(force = false): void {
    const changed = this.updateProcessSignalLODState();
    if (!force && !changed) return;

    for (const rig of this.entityObjects.values()) {
      if (rig.kind !== 'smelter' && rig.kind !== 'fabricator') continue;
      const signalRoot = rig.parts.processSignalRoot;
      if (!signalRoot) continue;
      const detailed = this.usesAuthoredProcessSignals(rig);
      signalRoot.visible = detailed;
      if (detailed) this.updateProcessSignals(rig, this.lastElapsed);
    }

    this.processSignalPerformance.root.userData.autoLOD =
      this.quality === 'high' && this.processSignalOverviewLOD;
    this.processSignalPerformance.root.userData.enterViewWidth =
      PROCESS_SIGNAL_OVERVIEW_ENTER_WIDTH;
    this.processSignalPerformance.root.userData.exitViewWidth =
      PROCESS_SIGNAL_OVERVIEW_EXIT_WIDTH;
    this.processSignalPerformance.root.userData.selectedException =
      this.quality === 'high' && this.processSignalOverviewLOD
        ? this.selectedId
        : null;
    this.updatePerformanceProcessSignals();
  }

  private updatePerformanceProcessSignals(): void {
    const batches = this.processSignalPerformance;
    const enabled = (
      this.quality === 'performance'
      || (this.quality === 'high' && this.processSignalOverviewLOD)
    );
    batches.root.visible = enabled;
    if (!enabled) {
      batches.plaques.count = 0;
      batches.bars.count = 0;
      batches.rings.count = 0;
      batches.octahedra.count = 0;
      batches.tokens.count = 0;
      for (const ids of Object.values(batches.entityIds)) ids.length = 0;
      batches.signatures.clear();
      return;
    }

    const meshes = {
      plaques: batches.plaques,
      bars: batches.bars,
      rings: batches.rings,
      octahedra: batches.octahedra,
      tokens: batches.tokens,
    };
    const counts = {
      plaques: 0,
      bars: 0,
      rings: 0,
      octahedra: 0,
      tokens: 0,
    };
    for (const ids of Object.values(batches.entityIds)) ids.length = 0;
    batches.signatures.clear();

    const rootTransform = new THREE.Object3D();
    const localTransform = new THREE.Object3D();
    const instanceMatrix = new THREE.Matrix4();
    const add = (
      key: keyof typeof meshes,
      entityId: RenderEntityId,
      position: readonly [number, number, number],
      scale: readonly [number, number, number],
      color: THREE.ColorRepresentation,
      rotation: readonly [number, number, number] = [0, 0, 0],
    ): void => {
      const mesh = meshes[key];
      const index = counts[key];
      if (index >= mesh.instanceMatrix.count) return;
      localTransform.position.set(...position);
      localTransform.rotation.set(...rotation);
      localTransform.scale.set(...scale);
      localTransform.updateMatrix();
      instanceMatrix.multiplyMatrices(
        rootTransform.matrix,
        localTransform.matrix,
      );
      mesh.setMatrixAt(index, instanceMatrix);
      mesh.setColorAt(index, this.tempColor.set(color));
      batches.entityIds[key].push(entityId);
      counts[key] += 1;
    };

    let machineCount = 0;
    for (const entity of this.entityData.values()) {
      if (
        (entity.kind !== 'smelter' && entity.kind !== 'fabricator')
        || (entity.health !== undefined && entity.health <= 0)
        || (
          this.quality === 'high'
          && this.processSignalOverviewLOD
          && entity.id === this.selectedId
        )
        || machineCount >= MAX_PERFORMANCE_PROCESS_MACHINES
      ) continue;
      const footprint = this.entityFootprint(entity);
      rootTransform.position.set(
        entity.x + footprint.worldWidth * 0.5,
        0,
        entity.z + footprint.worldHeight * 0.5,
      );
      rootTransform.rotation.set(0, directionAngle(entity.direction), 0);
      rootTransform.scale.set(
        footprint.localWidth === 1 ? 1 : footprint.localWidth * 0.82,
        footprint.localWidth === 1 && footprint.localHeight === 1 ? 1 : 1.28,
        footprint.localHeight === 1 ? 1 : footprint.localHeight * 0.82,
      );
      rootTransform.updateMatrix();

      const fallbackState: RenderProcessState = entity.status === 'blocked'
        ? 'output-blocked'
        : entity.active
          ? 'working'
          : entity.kind === 'fabricator' && !entity.recipe
            ? 'unconfigured'
            : 'starved';
      const state = entity.processState ?? fallbackState;
      const recipe = (
        entity.processRecipe
        ?? entity.recipe
        ?? (entity.kind === 'smelter' ? 'auto' : undefined)
      );
      const pendingRecipe = entity.pendingRecipe;
      const reclaim = Math.max(0, entity.reclaimCount ?? 0) > 0;
      const phase = this.lastElapsed
        + seededUnit(hashString(String(entity.id))) * Math.PI * 2;

      const queuedPair = state === 'queued' && pendingRecipe !== undefined;
      const dieScale = queuedPair ? PROCESS_RECIPE_PAIR_SCALE : 1;
      const dieX = queuedPair
        ? PROCESS_RECIPE_PAIR_CURRENT_X
        : PROCESS_RECIPE_STATION_X;
      add(
        'plaques',
        entity.id,
        [dieX, PROCESS_RECIPE_PLAQUE_Y + 0.025, PROCESS_RECIPE_STATION_Z],
        [dieScale, 1, dieScale],
        state === 'unconfigured' ? '#263033' : '#7f9092',
      );
      add(
        'plaques',
        entity.id,
        [dieX, PROCESS_RECIPE_PLAQUE_Y + 0.065, PROCESS_RECIPE_STATION_Z],
        [dieScale * 0.7, 0.8, dieScale * 0.7],
        '#11191b',
      );
      add(
        'rings',
        entity.id,
        [dieX, PROCESS_RECIPE_PLAQUE_Y + 0.11, PROCESS_RECIPE_STATION_Z],
        [1.9 * dieScale, 1, 1.9 * dieScale],
        state === 'unconfigured' ? '#384647' : '#607174',
      );
      for (const dx of [-0.15, 0.15]) {
        for (const dz of [-0.11, 0.11]) {
          add(
            'bars',
            entity.id,
            [
              dieX + dx * dieScale,
              PROCESS_RECIPE_PLAQUE_Y - 0.075,
              PROCESS_RECIPE_STATION_Z + dz * dieScale,
            ],
            [0.035, 0.25, 0.035],
            '#697879',
          );
        }
      }
      if (queuedPair) {
        add(
          'plaques',
          entity.id,
          [
            PROCESS_RECIPE_PAIR_PENDING_X,
            PROCESS_RECIPE_PLAQUE_Y + 0.025,
            PROCESS_RECIPE_STATION_Z,
          ],
          [dieScale, 1, dieScale],
          '#b47a2d',
        );
        add(
          'plaques',
          entity.id,
          [
            PROCESS_RECIPE_PAIR_PENDING_X,
            PROCESS_RECIPE_PLAQUE_Y + 0.065,
            PROCESS_RECIPE_STATION_Z,
          ],
          [dieScale * 0.7, 0.8, dieScale * 0.7],
          '#171b18',
        );
        add(
          'rings',
          entity.id,
          [
            PROCESS_RECIPE_PAIR_PENDING_X,
            PROCESS_RECIPE_PLAQUE_Y + 0.11,
            PROCESS_RECIPE_STATION_Z,
          ],
          [1.9 * dieScale, 1, 1.9 * dieScale],
          '#d99531',
        );
        for (const dx of [-0.15, 0.15]) {
          for (const dz of [-0.11, 0.11]) {
            add(
              'bars',
              entity.id,
              [
                PROCESS_RECIPE_PAIR_PENDING_X + dx * dieScale,
                PROCESS_RECIPE_PLAQUE_Y - 0.075,
                PROCESS_RECIPE_STATION_Z + dz * dieScale,
              ],
              [0.035, 0.25, 0.035],
              '#697879',
            );
          }
        }
      }

      const addRecipeGlyph = (
        identity: string | undefined,
        centerX: number,
        scale: number,
        centerZ = PROCESS_RECIPE_STATION_Z,
        recipeY = PROCESS_RECIPE_GLYPH_Y,
      ): string | null => {
        const bar = (
          dx: number,
          dy: number,
          dz: number,
          sx: number,
          sy: number,
          sz: number,
          color: THREE.ColorRepresentation,
          rotationY = 0,
        ): void => add(
          'bars',
          entity.id,
          [
            centerX + dx * scale,
            recipeY + dy * scale,
            centerZ + dz * scale,
          ],
          [sx * scale, sy * scale, sz * scale],
          color,
          [0, rotationY, 0],
        );
        switch (identity) {
          case 'auto':
            bar(0, 0.055, -0.105, 0.34, 0.09, 0.18, '#263033');
            bar(0, 0.108, -0.105, 0.235, 0.035, 0.1, '#ff9d38');
            for (const [x, color] of [
              [-0.14, '#eef4f2'],
              [0.14, '#b9592d'],
            ] as Array<[number, THREE.ColorRepresentation]>) {
              add(
                'tokens',
                entity.id,
                [
                  centerX + x * scale,
                  recipeY + 0.17 * scale,
                  centerZ + 0.11 * scale,
                ],
                [1.45 * scale, 1.45 * scale, 1.45 * scale],
                color,
              );
              bar(
                x * 0.62,
                0.132,
                0.055,
                0.16,
                0.025,
                0.025,
                '#e0a53d',
                x < 0 ? -0.58 : 0.58,
              );
            }
            bar(0, 0.132, -0.03, 0.15, 0.03, 0.03, '#e0a53d');
            bar(0, 0.17, 0.015, 0.07, 0.055, 0.07, '#d99531');
            for (let vane = 0; vane < 3; vane += 1) {
              const angle = vane * Math.PI * 2 / 3;
              bar(
                Math.sin(angle) * 0.055,
                0.195,
                0.015 + Math.cos(angle) * 0.055,
                0.035,
                0.025,
                0.09,
                '#f0b646',
                angle,
              );
            }
            break;
          case 'smeltIron':
            bar(-0.045, 0.055, 0.04, 0.285, 0.045, 0.17, '#879598', -0.08);
            bar(0, 0.107, 0, 0.285, 0.045, 0.17, '#cbd5d6');
            bar(0.045, 0.159, -0.04, 0.285, 0.045, 0.17, '#f1f5f3', 0.08);
            bar(0.09, 0.19, -0.055, 0.065, 0.018, 0.055, '#596b70', 0.18);
            break;
          case 'smeltCopper':
            bar(-0.055, 0.055, 0.045, 0.27, 0.045, 0.18, '#98451f', -0.08);
            bar(0, 0.107, 0, 0.27, 0.045, 0.18, '#d76c31');
            bar(0.055, 0.159, -0.045, 0.27, 0.045, 0.18, '#ff9a4c', 0.08);
            for (const z of [-0.1, 0.01]) {
              bar(0.055, 0.19, z, 0.225, 0.018, 0.018, '#ffc084');
            }
            break;
          case 'fireBrick':
            bar(0, 0.025, 0, 0.38, 0.03, 0.16, '#202829');
            for (const [index, x] of [-0.12, 0, 0.12].entries()) {
              bar(x, 0.095, 0.065, 0.108, 0.1, 0.1, index % 2 === 0 ? '#923c2d' : '#d47b4e');
              bar(x, 0.151, 0.065, 0.076, 0.012, 0.018, '#202829');
            }
            for (const [index, x] of [-0.06, 0.06].entries()) {
              bar(x, 0.095, -0.065, 0.15, 0.1, 0.1, index === 0 ? '#d47b4e' : '#923c2d');
              bar(x, 0.151, -0.065, 0.105, 0.012, 0.018, '#d7c4a0');
            }
            bar(0, 0.153, 0, 0.34, 0.014, 0.018, '#d7c4a0');
            bar(-0.06, 0.155, -0.065, 0.018, 0.014, 0.09, '#d7c4a0');
            bar(0.06, 0.155, 0.065, 0.018, 0.014, 0.09, '#d7c4a0');
            break;
          case 'ironGear':
            add(
              'rings',
              entity.id,
              [centerX, recipeY + 0.105 * scale, centerZ],
              [1.18 * scale, 1, 1.18 * scale],
              '#d0dbdc',
            );
            for (let tooth = 0; tooth < 8; tooth += 1) {
              const angle = tooth * Math.PI / 4;
              bar(
                Math.sin(angle) * 0.148,
                0.105,
                Math.cos(angle) * 0.148,
                0.055,
                0.07,
                0.082,
                '#d0dbdc',
                angle,
              );
            }
            bar(0, 0.085, 0, 0.075, 0.19, 0.075, '#526166');
            break;
          case 'copperWire':
            bar(0, 0.105, 0, 0.26, 0.07, 0.11, '#8f3d1e');
            for (const x of [-0.14, -0.07, 0, 0.07, 0.14]) {
              add(
                'rings',
                entity.id,
                [centerX + x * scale, recipeY + 0.105 * scale, centerZ],
                [(Math.abs(x) > 0.1 ? 1.25 : 0.82) * scale, 1, (Math.abs(x) > 0.1 ? 1.25 : 0.82) * scale],
                Math.abs(x) > 0.1 ? '#637276' : '#e97d36',
                [0, 0, Math.PI / 2],
              );
            }
            bar(-0.12, 0.105, 0.12, 0.16, 0.032, 0.032, '#ffad5c', -0.55);
            bar(0.12, 0.105, -0.12, 0.16, 0.032, 0.032, '#ffad5c', -0.55);
            break;
          case 'circuit':
            bar(0, 0.075, 0, 0.31, 0.055, 0.225, '#2c8b53', 0.08);
            bar(0.015, 0.13, 0, 0.105, 0.065, 0.09, '#182123', 0.08);
            bar(-0.09, 0.122, 0, 0.03, 0.026, 0.14, '#d9bb62');
            bar(0.075, 0.122, -0.07, 0.12, 0.026, 0.025, '#d9bb62');
            bar(0.075, 0.122, 0.07, 0.12, 0.026, 0.025, '#d9bb62');
            for (const [x, z] of [[-0.09, -0.07], [-0.09, 0.07], [0.115, 0]] as Array<[number, number]>) {
              bar(x, 0.15, z, 0.075, 0.05, 0.075, '#f0d67b');
            }
            break;
          case 'automationCore':
            add(
              'plaques',
              entity.id,
              [centerX, recipeY + 0.07 * scale, centerZ],
              [0.78 * scale, 0.65, 0.78 * scale],
              '#2e8e55',
            );
            add(
              'rings',
              entity.id,
              [centerX, recipeY + 0.12 * scale, centerZ],
              [0.95 * scale, 1, 0.95 * scale],
              '#172123',
            );
            add(
              'octahedra',
              entity.id,
              [centerX, recipeY + 0.18 * scale, centerZ],
              [0.68 * scale, 1.12 * scale, 0.68 * scale],
              '#49e1e0',
              [0, Math.PI / 4, 0],
            );
            for (let lock = 0; lock < 6; lock += 1) {
              const angle = lock * Math.PI / 3;
              bar(
                Math.sin(angle) * 0.155,
                0.13,
                Math.cos(angle) * 0.155,
                0.035,
                0.1,
                0.035,
                '#f0a54f',
              );
            }
            break;
        }
        return processRecipeSignalSignature(identity);
      };

      const recipeSignature = addRecipeGlyph(recipe, dieX, dieScale);
      const pendingRecipeSignature = queuedPair
        ? addRecipeGlyph(
          pendingRecipe,
          PROCESS_RECIPE_PAIR_PENDING_X,
          dieScale,
        )
        : null;

      const witnessX = -0.44;
      const witnessY = 1.08;
      const witnessZ = -0.34;
      const witnessBar = (
        dx: number,
        dy: number,
        dz: number,
        sx: number,
        sy: number,
        sz: number,
        color: THREE.ColorRepresentation,
        rotationY = 0,
      ): void => add(
        'bars',
        entity.id,
        [witnessX + dx, witnessY + dy, witnessZ + dz],
        [sx, sy, sz],
        color,
        [0, rotationY, 0],
      );
      witnessBar(0, -0.25, 0, 0.052, 0.5, 0.052, '#9aa7a7');
      witnessBar(0.065, -0.39, 0.065, 0.035, 0.24, 0.035, '#7d8a8b', -0.78);
      add(
        'plaques',
        entity.id,
        [witnessX, witnessY - 0.018, witnessZ],
        [0.55, 0.75, 0.55],
        '#526064',
      );

      let stateSignature: string | null = null;
      const pulse = 0.94 + Math.sin(phase * 4.8) * 0.06;
      if (state === 'unconfigured') {
        add('rings', entity.id, [0, 1.045, 0.1], [1.18, 1, 1.18], '#8a9798');
        for (let jaw = 0; jaw < 4; jaw += 1) {
          const angle = jaw * Math.PI / 2;
          add(
            'bars',
            entity.id,
            [Math.sin(angle) * 0.155, 1.055, 0.1 + Math.cos(angle) * 0.155],
            [0.105, 0.06, 0.07],
            '#d6a33f',
            [0, angle, 0],
          );
        }
        add(
          'rings',
          entity.id,
          [witnessX, witnessY, witnessZ],
          [0.82, 1, 0.82],
          '#899596',
        );
        for (let jaw = 0; jaw < 4; jaw += 1) {
          const angle = jaw * Math.PI / 2;
          witnessBar(
            Math.sin(angle) * 0.095,
            0.035,
            Math.cos(angle) * 0.095,
            0.064,
            0.04,
            0.04,
            '#d6a33f',
            angle,
          );
        }
        stateSignature = 'empty-open-tool-chuck';
      } else if (state === 'starved') {
        add('bars', entity.id, [0, 0.36, 0.29], [0.16, 0.14, 0.34], '#aebabc');
        add('bars', entity.id, [0, 0.42, 0.15], [0.2, 0.055, 0.09], '#68777a');
        add('bars', entity.id, [0, 0.43, 0.49], [0.28, 0.25, 0.25], '#3a4749');
        add('bars', entity.id, [0, 0.57, 0.49], [0.2, 0.06, 0.2], '#11191b');
        add('bars', entity.id, [0, 0.61, 0.29], [0.46, 0.07, 0.065], '#68777a');
        add('bars', entity.id, [-0.2, 0.6, 0.49], [0.065, 0.07, 0.4], '#68777a');
        add('bars', entity.id, [0.2, 0.6, 0.49], [0.065, 0.07, 0.4], '#68777a');
        add('bars', entity.id, [0, 0.59, 0.69], [0.46, 0.07, 0.065], '#68777a');
        add('bars', entity.id, [0, 0.73, 0.595], [0.07, 0.07, 0.57], '#ffbd42');
        add('bars', entity.id, [-0.07, 0.73, 0.4], [0.06, 0.07, 0.24], '#ffbd42', [0, -0.66, 0]);
        add('bars', entity.id, [0.07, 0.73, 0.4], [0.06, 0.07, 0.24], '#ffbd42', [0, 0.66, 0]);
        witnessBar(0, 0.035, 0, 0.22, 0.065, 0.185, '#20292b');
        witnessBar(0, 0.105, -0.105, 0.265, 0.04, 0.04, '#68777a');
        witnessBar(0, 0.105, 0.105, 0.265, 0.04, 0.04, '#68777a');
        witnessBar(-0.12, 0.105, 0, 0.04, 0.04, 0.21, '#68777a');
        witnessBar(0.12, 0.105, 0, 0.04, 0.04, 0.21, '#68777a');
        witnessBar(-0.035, 0.23, 0, 0.04, 0.045, 0.13, '#f0b646', -0.58);
        witnessBar(0.035, 0.23, 0, 0.04, 0.045, 0.13, '#f0b646', 0.58);
        stateSignature = 'rear-amber-empty-hopper';
      } else if (state === 'working') {
        add('bars', entity.id, [0, 0.69, 0.1], [0.51, 0.06, 0.51], '#253234');
        add('octahedra', entity.id, [0, 0.88, 0.1], [0.9 * pulse, 0.76, 0.9 * pulse], '#73dc62');
        for (let key = 0; key < 6; key += 1) {
          const angle = key * Math.PI / 3 + phase * 0.35;
          add(
            'bars',
            entity.id,
            [Math.sin(angle) * 0.12, 0.79, 0.1 + Math.cos(angle) * 0.12],
            [0.045, 0.055, 0.24],
            '#58bd50',
            [0, angle, 0],
          );
          add(
            'bars',
            entity.id,
            [Math.sin(angle) * 0.245, 0.81, 0.1 + Math.cos(angle) * 0.245],
            [0.12, 0.08, 0.055],
            '#8af06f',
            [0, angle + Math.PI / 2, 0],
          );
        }
        witnessBar(0, 0.05, 0, 0.08, 0.07, 0.08, '#58bd50');
        for (let key = 0; key < 3; key += 1) {
          const angle = key * Math.PI * 2 / 3 + phase * 0.4;
          witnessBar(
            Math.sin(angle) * 0.052,
            0.065,
            Math.cos(angle) * 0.052,
            0.035,
            0.04,
            0.105,
            '#58bd50',
            angle,
          );
          witnessBar(
            Math.sin(angle) * 0.105,
            0.07,
            Math.cos(angle) * 0.105,
            0.075,
            0.04,
            0.035,
            '#8af06f',
            angle + Math.PI / 2,
          );
        }
        stateSignature = 'green-driven-chamber-impeller';
      } else if (state === 'queued') {
        const queueCenterX = (
          PROCESS_RECIPE_PAIR_CURRENT_X + PROCESS_RECIPE_PAIR_PENDING_X
        ) * 0.5;
        add(
          'bars',
          entity.id,
          [queueCenterX - 0.015, 1.075, PROCESS_RECIPE_STATION_Z],
          [0.23, 0.05, 0.05],
          '#d99531',
        );
        add(
          'bars',
          entity.id,
          [queueCenterX + 0.085, 1.075, PROCESS_RECIPE_STATION_Z - 0.045],
          [0.11, 0.05, 0.05],
          '#f0b646',
          [0, Math.PI / 4, 0],
        );
        add(
          'bars',
          entity.id,
          [queueCenterX + 0.085, 1.075, PROCESS_RECIPE_STATION_Z + 0.045],
          [0.11, 0.05, 0.05],
          '#f0b646',
          [0, -Math.PI / 4, 0],
        );
        witnessBar(-0.085, 0.025, 0, 0.105, 0.06, 0.105, '#7d8c8e');
        witnessBar(0.085, 0.025, 0, 0.105, 0.06, 0.105, '#d99531');
        witnessBar(0, 0.085, 0, 0.145, 0.04, 0.04, '#f0b646');
        witnessBar(0.045, 0.085, -0.035, 0.095, 0.04, 0.04, '#f0b646', 0.7);
        witnessBar(0.045, 0.085, 0.035, 0.095, 0.04, 0.04, '#f0b646', -0.7);
        stateSignature = 'static-current-to-pending-tool-bridge';
      } else if (state === 'output-blocked') {
        add('bars', entity.id, [0, 0.44, -0.58], [0.5, 0.15, 0.22], '#252d2e');
        for (const [row, z] of [-0.045, 0.045].entries()) {
          for (const [column, x] of [-0.16, 0, 0.16].entries()) {
            add(
              'bars',
              entity.id,
              [x, 0.59 + ((row + column) % 2) * 0.018, -0.58 + z],
              [0.14, 0.095, 0.075],
              (row + column) % 2 === 0 ? '#d6dfde' : '#627174',
            );
          }
        }
        add('bars', entity.id, [-0.275, 0.64, -0.68], [0.07, 0.66, 0.07], '#ec4c40');
        add('bars', entity.id, [0.275, 0.64, -0.68], [0.07, 0.66, 0.07], '#ec4c40');
        add('bars', entity.id, [0, 0.94, -0.68], [0.62, 0.085, 0.085], '#ec4c40');
        add('bars', entity.id, [0, 0.78, -0.68], [0.55, 0.075, 0.075], '#ec4c40');
        for (const x of [-0.16, 0, 0.16]) {
          add('bars', entity.id, [x, 0.78, -0.72], [0.045, 0.31, 0.035], '#24292a', [0, 0, 0.48]);
        }
        witnessBar(0, 0, 0, 0.2, 0.06, 0.16, '#252d2e');
        for (const [index, x] of [-0.055, 0, 0.055].entries()) {
          witnessBar(
            x,
            0.075,
            0,
            0.05,
            0.055,
            0.07,
            index === 1 ? '#627174' : '#d6dfde',
          );
        }
        witnessBar(0, 0.16, -0.075, 0.25, 0.055, 0.05, '#ec4c40');
        stateSignature = 'front-red-full-output-crate';
      } else if (state === 'no-power') {
        add('bars', entity.id, [-0.28, 0.5, 0], [0.24, 0.44, 0.36], '#263033');
        add('bars', entity.id, [-0.6, 0.53, 0], [0.18, 0.16, 0.27], '#8e3430');
        for (const z of [-0.07, 0.07]) {
          add('bars', entity.id, [-0.485, 0.53, z], [0.08, 0.045, 0.045], '#d9e0df');
          add('bars', entity.id, [-0.415, 0.53, z], [0.025, 0.085, 0.065], '#11191b');
        }
        add('bars', entity.id, [-0.74, 0.48, -0.035], [0.2, 0.055, 0.055], '#252829', [0, -0.35, 0]);
        add('bars', entity.id, [-0.43, 0.82, 0.125], [0.22, 0.055, 0.07], '#ffc04c', [0, 0.75, 0]);
        add('bars', entity.id, [-0.385, 0.82, 0.01], [0.14, 0.055, 0.07], '#ffc04c', [0, 2.42, 0]);
        add('bars', entity.id, [-0.345, 0.82, -0.115], [0.24, 0.055, 0.07], '#ffc04c', [0, 0.78, 0]);
        witnessBar(0.07, 0.04, 0, 0.095, 0.07, 0.16, '#263033');
        witnessBar(-0.105, 0.04, 0, 0.09, 0.07, 0.14, '#b83e34');
        for (const z of [-0.035, 0.035]) {
          witnessBar(-0.035, 0.052, z, 0.055, 0.026, 0.026, '#d8dfdf');
          witnessBar(0.012, 0.052, z, 0.022, 0.045, 0.045, '#11191b');
        }
        witnessBar(-0.185, 0.025, -0.02, 0.11, 0.025, 0.025, '#252829', -0.38);
        witnessBar(-0.045, 0.16, 0.055, 0.12, 0.035, 0.04, '#ffc04c', 0.78);
        witnessBar(0, 0.16, -0.005, 0.085, 0.035, 0.04, '#ffc04c', 2.35);
        witnessBar(0.045, 0.16, -0.065, 0.13, 0.035, 0.04, '#ffc04c', 0.78);
        stateSignature = 'side-disconnected-power-plug';
      } else if (state === 'idle') {
        add('bars', entity.id, [0, 0.54, -0.43], [0.38, 0.09, 0.24], '#293536');
        add('bars', entity.id, [-0.11, 0.6, -0.43], [0.13, 0.18, 0.12], '#697879');
        add('bars', entity.id, [0.02, 0.64, -0.43], [0.24, 0.05, 0.05], '#566467');
        add('bars', entity.id, [0.155, 0.64, -0.43], [0.13, 0.065, 0.1], '#566467');
        add('bars', entity.id, [0.15, 0.565, -0.43], [0.09, 0.12, 0.14], '#697879');
        add('bars', entity.id, [-0.07, 0.745, -0.43], [0.065, 0.055, 0.19], '#eef4f2');
        add('bars', entity.id, [0.07, 0.745, -0.43], [0.065, 0.055, 0.19], '#eef4f2');
        witnessBar(0, 0.02, 0, 0.18, 0.045, 0.14, '#252d2e');
        witnessBar(-0.048, 0.095, 0, 0.052, 0.08, 0.14, '#eef4f2');
        witnessBar(0.048, 0.095, 0, 0.052, 0.08, 0.14, '#eef4f2');
        stateSignature = 'neutral-parked-control-lever';
      }
      if (reclaim) {
        // A fixed side skip with a three-arrow recycling crown survives
        // overview LOD without borrowing queue or transfer-arm language.
        const reclaimX = 0.72;
        const reclaimZ = 0.18;
        add(
          'bars',
          entity.id,
          [reclaimX, 0.37, reclaimZ],
          [0.46, 0.13, 0.44],
          '#6f2924',
          [0, 0, -0.08],
        );
        for (const z of [-0.18, 0.18]) {
          add(
            'bars',
            entity.id,
            [reclaimX, 0.56, reclaimZ + z],
            [0.46, 0.34, 0.045],
            '#c7d0cf',
            [0, 0, -0.08],
          );
        }
        add(
          'bars',
          entity.id,
          [reclaimX + 0.205, 0.56, reclaimZ],
          [0.045, 0.34, 0.44],
          '#c7d0cf',
          [0, 0, -0.08],
        );
        for (const x of [-0.155, 0, 0.155]) {
          add(
            'bars',
            entity.id,
            [reclaimX + x, 0.755, reclaimZ + 0.205],
            [0.075, 0.055, 0.045],
            x === 0 ? '#171b1b' : '#f0b646',
            [0, 0, -0.16],
          );
        }
        add(
          'bars',
          entity.id,
          [0.43, 0.62, 0.08],
          [0.42, 0.08, 0.13],
          '#c7d0cf',
          [0, -0.28, -0.28],
        );
        add(
          'bars',
          entity.id,
          [0.53, 0.68, 0.11],
          [0.22, 0.1, 0.18],
          '#f0b646',
          [0, -0.28, -0.28],
        );
        const recycleVertices = [
          new THREE.Vector2(0, -0.235),
          new THREE.Vector2(0.205, 0.12),
          new THREE.Vector2(-0.205, 0.12),
        ];
        const recycleBar = (
          start: THREE.Vector2,
          end: THREE.Vector2,
        ): void => {
          const deltaX = end.x - start.x;
          const deltaZ = end.y - start.y;
          add(
            'bars',
            entity.id,
            [
              reclaimX + (start.x + end.x) * 0.5,
              0.91,
              reclaimZ + (start.y + end.y) * 0.5,
            ],
            [Math.hypot(deltaX, deltaZ), 0.06, 0.06],
            '#62d991',
            [0, -Math.atan2(deltaZ, deltaX), 0],
          );
        };
        for (let index = 0; index < recycleVertices.length; index += 1) {
          const start = recycleVertices[index]!;
          const end = recycleVertices[(index + 1) % recycleVertices.length]!;
          const direction = end.clone().sub(start).normalize();
          const perpendicular = new THREE.Vector2(-direction.y, direction.x);
          const shaftEnd = end.clone().addScaledVector(direction, -0.045);
          recycleBar(start, shaftEnd);
          for (const sign of [-1, 1]) {
            recycleBar(
              end
                .clone()
                .addScaledVector(direction, -0.115)
                .addScaledVector(perpendicular, sign * 0.07),
              end,
            );
          }
        }
        const reclaimTokenPositions: Array<[number, number, number]> = [
          [reclaimX - 0.105, 0.67, reclaimZ - 0.055],
          [reclaimX + 0.045, 0.69, reclaimZ],
          [reclaimX - 0.015, 0.72, reclaimZ + 0.085],
        ];
        for (const [index, color] of ['#eef4f2', '#d36a31', '#a7462f'].entries()) {
          add(
            'tokens',
            entity.id,
            reclaimTokenPositions[index]!,
            [1.05, 0.82, 1.05],
            color,
            [0, phase * 0.1 + index, 0],
          );
        }
      }
      batches.signatures.set(entity.id, {
        state,
        stateSignature,
        recipe: recipe ?? null,
        recipeSignature,
        pendingRecipe: pendingRecipe ?? null,
        pendingRecipeSignature,
        reclaim,
      });
      machineCount += 1;
    }

    for (const key of Object.keys(meshes) as Array<keyof typeof meshes>) {
      const mesh = meshes[key];
      mesh.count = counts[key];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private updatePerformanceGridRelays(): void {
    const batches = this.gridRelayPerformance;
    const enabled = this.quality === 'performance';
    batches.root.visible = enabled;
    for (const ids of Object.values(batches.entityIds)) ids.length = 0;
    if (!enabled) {
      batches.bases.count = 0;
      batches.masts.count = 0;
      batches.insulators.count = 0;
      batches.coils.count = 0;
      batches.lamps.count = 0;
      return;
    }

    let relayCount = 0;
    let insulatorCount = 0;
    let coilCount = 0;
    const setInstance = (
      mesh: THREE.InstancedMesh,
      index: number,
      x: number,
      y: number,
      z: number,
      scale = 1,
      rotationY = 0,
    ): void => {
      this.tempObject.position.set(x, y, z);
      this.tempObject.rotation.set(0, rotationY, 0);
      this.tempObject.scale.setScalar(scale);
      this.tempObject.updateMatrix();
      mesh.setMatrixAt(index, this.tempObject.matrix);
    };

    for (const entity of this.entityData.values()) {
      if (
        entity.kind !== 'gridRelay'
        || (entity.health !== undefined && entity.health <= 0)
        || relayCount >= MAX_PERFORMANCE_GRID_RELAYS
      ) continue;
      const centerX = entity.x + 0.5;
      const centerZ = entity.z + 0.5;
      setInstance(batches.bases, relayCount, centerX, 0, centerZ);
      setInstance(batches.masts, relayCount, centerX, 0, centerZ);
      setInstance(
        batches.lamps,
        relayCount,
        centerX - 0.27,
        0.31,
        centerZ - 0.27,
      );
      batches.lamps.setColorAt(
        relayCount,
        this.tempColor.set(powerNetworkColor(entity.powerNetworkId ?? null)),
      );
      batches.entityIds.bases.push(entity.id);
      batches.entityIds.masts.push(entity.id);
      batches.entityIds.lamps.push(entity.id);

      for (const [offsetX, offsetZ] of [
        [-POWER_GRID_TERMINAL_OFFSET, -0.07],
        [POWER_GRID_TERMINAL_OFFSET, -0.07],
        [-0.06, -POWER_GRID_TERMINAL_OFFSET],
        [-0.06, POWER_GRID_TERMINAL_OFFSET],
      ] as const) {
        setInstance(
          batches.insulators,
          insulatorCount,
          centerX + offsetX,
          0,
          centerZ + offsetZ,
        );
        batches.entityIds.insulators.push(entity.id);
        insulatorCount += 1;
      }
      for (const y of [0.37, 0.45, 0.53]) {
        setInstance(batches.coils, coilCount, centerX, y, centerZ);
        batches.entityIds.coils.push(entity.id);
        coilCount += 1;
      }
      relayCount += 1;
    }

    batches.bases.count = relayCount;
    batches.masts.count = relayCount;
    batches.insulators.count = insulatorCount;
    batches.coils.count = coilCount;
    batches.lamps.count = relayCount;
    for (const mesh of [
      batches.bases,
      batches.masts,
      batches.insulators,
      batches.coils,
      batches.lamps,
    ]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
    }
    if (batches.lamps.instanceColor) {
      batches.lamps.instanceColor.needsUpdate = true;
    }
    batches.root.userData.relayCount = relayCount;
    batches.root.userData.drawCallContract = 5;
  }

  private setPowerGridBeamInstance(
    mesh: THREE.InstancedMesh,
    index: number,
    from: THREE.Vector3,
    to: THREE.Vector3,
    radius: number,
  ): void {
    this.tempVectorB.subVectors(to, from);
    const length = this.tempVectorB.length();
    if (length <= 0.0001) {
      this.tempObject.scale.setScalar(0);
      this.tempObject.updateMatrix();
      mesh.setMatrixAt(index, this.tempObject.matrix);
      return;
    }
    this.tempObject.position.copy(from).addScaledVector(this.tempVectorB, 0.5);
    this.tempObject.rotation.set(0, 0, 0);
    this.tempObject.quaternion.setFromUnitVectors(
      UNIT_Y,
      this.tempVectorB.normalize(),
    );
    this.tempObject.scale.set(radius, length, radius);
    this.tempObject.updateMatrix();
    mesh.setMatrixAt(index, this.tempObject.matrix);
  }

  private powerGridPoint(
    link: PowerGridVisualLink,
    t: number,
    target: THREE.Vector3,
  ): THREE.Vector3 {
    target.copy(link.a).lerp(link.b, t);
    target.y -= 4 * link.sag * t * (1 - t);
    return target;
  }

  private powerGridTerminalPoint(
    center: Pick<RenderPowerGridRelayCenter, 'x' | 'z'>,
    toward: Pick<RenderPowerGridRelayCenter, 'x' | 'z'>,
    target: THREE.Vector3,
  ): THREE.Vector3 {
    const dx = toward.x - center.x;
    const dz = toward.z - center.z;
    if (Math.abs(dx) >= Math.abs(dz)) {
      target.set(
        center.x + Math.sign(dx || 1) * POWER_GRID_TERMINAL_OFFSET,
        POWER_GRID_TERMINAL_HEIGHT,
        center.z - 0.07,
      );
    } else {
      target.set(
        center.x - 0.06,
        POWER_GRID_TERMINAL_HEIGHT,
        center.z + Math.sign(dz || 1) * POWER_GRID_TERMINAL_OFFSET,
      );
    }
    return target;
  }

  private syncPowerGrid(powerGrid: RenderPowerGridSnapshot | undefined): void {
    const signature = powerGrid
      ? [
          this.quality,
          powerGrid.mode,
          powerGrid.halfExtent,
          powerGrid.cableReach,
          ...powerGrid.relayCenters.flatMap((relay) => [
            relay.relayId,
            relay.x,
            relay.z,
            relay.networkId ?? 'n',
          ]),
          'links',
          ...powerGrid.relayLinks.flatMap((link) => [
            link.relayAId,
            link.relayBId,
          ]),
        ].join('|')
      : 'none';
    if (signature === this.powerGridSignature) {
      this.updatePowerGridSelectionVisuals();
      return;
    }
    this.powerGridSignature = signature;
    this.powerGridVisualLinks = [];
    this.powerGridRelayCenters.clear();
    const { cables, cableShadows, pulses, root } = this.powerGridBatches;

    if (!powerGrid) {
      cables.count = 0;
      cableShadows.count = 0;
      pulses.count = 0;
      root.visible = false;
      this.updatePowerGridSelectionVisuals();
      return;
    }
    for (const relay of powerGrid.relayCenters) {
      this.powerGridRelayCenters.set(relay.relayId, relay);
    }

    const localMode = powerGrid.mode === 'local';
    const segmentCount = this.quality === 'high'
      ? POWER_GRID_CABLE_SEGMENTS
      : 4;
    let cableInstance = 0;
    let cableShadowInstance = 0;
    for (
      let linkIndex = 0;
      linkIndex < powerGrid.relayLinks.length
        && this.powerGridVisualLinks.length < MAX_POWER_GRID_LINKS;
      linkIndex += 1
    ) {
        const link = powerGrid.relayLinks[linkIndex];
        if (!link) continue;
        const centerA = this.powerGridRelayCenters.get(link.relayAId);
        const centerB = this.powerGridRelayCenters.get(link.relayBId);
        if (!centerA || !centerB) continue;
        const a = this.powerGridTerminalPoint(
          centerA,
          centerB,
          new THREE.Vector3(),
        );
        const b = this.powerGridTerminalPoint(
          centerB,
          centerA,
          new THREE.Vector3(),
        );
        const distance = a.distanceTo(b);
        const visualLink: PowerGridVisualLink = {
          relayAId: link.relayAId,
          relayBId: link.relayBId,
          networkId: centerA.networkId ?? centerB.networkId,
          a,
          b,
          sag: THREE.MathUtils.clamp(distance * 0.072, 0.14, 0.46),
        };
        this.powerGridVisualLinks.push(visualLink);
        for (let segment = 0; segment < segmentCount; segment += 1) {
          const t0 = segment / segmentCount;
          const t1 = (segment + 1) / segmentCount;
          const from = this.powerGridPoint(visualLink, t0, this.tempVector);
          const to = this.powerGridPoint(
            visualLink,
            t1,
            new THREE.Vector3(),
          );
          this.setPowerGridBeamInstance(
            cables,
            cableInstance,
            from,
            to,
            this.quality === 'high' ? 0.038 : 0.03,
          );
          cableInstance += 1;
          const shadowFrom = new THREE.Vector3(
            from.x + from.y * 0.4,
            0.043,
            from.z - from.y * 0.3,
          );
          const shadowTo = new THREE.Vector3(
            to.x + to.y * 0.4,
            0.043,
            to.z - to.y * 0.3,
          );
          this.setPowerGridBeamInstance(
            cableShadows,
            cableShadowInstance,
            shadowFrom,
            shadowTo,
            this.quality === 'high' ? 0.028 : 0.022,
          );
          cableShadowInstance += 1;
        }
    }
    cables.count = cableInstance;
    cableShadows.count = cableShadowInstance;
    cables.castShadow = this.quality === 'high';
    cables.instanceMatrix.needsUpdate = true;
    cableShadows.instanceMatrix.needsUpdate = true;
    if (cables.material instanceof THREE.MeshStandardMaterial) {
      cables.material.color.set(localMode ? '#855433' : '#596363');
      cables.material.opacity = localMode ? 1 : 0.62;
    }
    if (cableShadows.material instanceof THREE.MeshBasicMaterial) {
      cableShadows.material.opacity = localMode ? 0.28 : 0.16;
    }
    pulses.count = localMode ? this.powerGridVisualLinks.length : 0;
    for (let index = 0; index < this.powerGridVisualLinks.length; index += 1) {
      const link = this.powerGridVisualLinks[index];
      if (!link) continue;
      pulses.setColorAt(
        index,
        this.tempColor.set(powerNetworkColor(link.networkId)),
      );
    }
    if (pulses.instanceColor) pulses.instanceColor.needsUpdate = true;
    root.visible = this.powerGridVisualLinks.length > 0;
    root.userData.mode = powerGrid.mode;
    root.userData.halfExtent = powerGrid.halfExtent;
    root.userData.cableReach = powerGrid.cableReach;
    root.userData.relayCount = powerGrid.relayCenters.length;
    root.userData.linkCount = this.powerGridVisualLinks.length;
    root.userData.cableDrawCalls = root.visible ? 1 : 0;
    root.userData.cableShadowDrawCalls = root.visible ? 1 : 0;
    root.userData.cableShadowSegments = cableShadowInstance;
    root.userData.pulseDrawCalls = root.visible && localMode ? 1 : 0;
    root.userData.truncatedLinks = Math.max(
      0,
      powerGrid.relayLinks.length - this.powerGridVisualLinks.length,
    );
    this.updatePowerGridPulses(this.lastElapsed);
    this.updatePowerGridSelectionVisuals();
  }

  private updatePowerGridPulses(elapsed: number): void {
    const { pulses, root } = this.powerGridBatches;
    if (!root.visible || pulses.count <= 0) return;
    for (let index = 0; index < this.powerGridVisualLinks.length; index += 1) {
      const link = this.powerGridVisualLinks[index];
      if (!link) continue;
      const seed = hashString(`${link.relayAId}:${link.relayBId}`);
      let t = fract(elapsed * 0.16 + seededUnit(seed));
      if ((seed & 1) === 1) t = 1 - t;
      this.powerGridPoint(link, t, this.tempVector);
      const swell = 0.82 + Math.sin(elapsed * 2.1 + index * 0.7) * 0.12;
      this.tempObject.position.copy(this.tempVector);
      this.tempObject.rotation.set(0, 0, 0);
      this.tempObject.scale.setScalar(swell);
      this.tempObject.updateMatrix();
      pulses.setMatrixAt(index, this.tempObject.matrix);
    }
    pulses.instanceMatrix.needsUpdate = true;
  }

  private updatePowerGridSelectionVisuals(): void {
    const visuals = this.powerGridSelection;
    const powerGrid = this.snapshot.powerGrid;
    const selected = this.selectedId === null
      ? undefined
      : this.entityObjects.get(this.selectedId);
    if (
      !powerGrid
      || selected?.kind !== 'gridRelay'
      || selected.entity.powerRelayId === undefined
      || selected.entity.powerRelayId === null
    ) {
      visuals.root.visible = false;
      visuals.links.count = 0;
      return;
    }
    const relayId = selected.entity.powerRelayId;
    const center = this.powerGridRelayCenters.get(relayId);
    if (!center) {
      visuals.root.visible = false;
      visuals.links.count = 0;
      return;
    }

    const halfExtent = Math.max(0.5, powerGrid.halfExtent);
    const minX = center.x - halfExtent;
    const maxX = center.x + halfExtent;
    const minZ = center.z - halfExtent;
    const maxZ = center.z + halfExtent;
    const y = 0.052;
    const coveragePoints: Array<[number, number, number]> = [];
    const addSegment = (
      ax: number,
      az: number,
      bx: number,
      bz: number,
    ): void => {
      coveragePoints.push([ax, y, az], [bx, y, bz]);
    };
    const localMode = powerGrid.mode === 'local';
    if (localMode) {
      for (const [ax, az, bx, bz] of [
        [minX, minZ, maxX, minZ],
        [maxX, minZ, maxX, maxZ],
        [maxX, maxZ, minX, maxZ],
        [minX, maxZ, minX, minZ],
      ] as const) {
        addSegment(ax, az, bx, bz);
      }
      // Four short inward ticks tie the service field to its selected source
      // without the former nested debug-box/corner-cut treatment.
      const tick = Math.min(0.3, halfExtent * 0.1);
      addSegment(center.x, minZ, center.x, minZ + tick);
      addSegment(maxX, center.z, maxX - tick, center.z);
      addSegment(center.x, maxZ, center.x, maxZ - tick);
      addSegment(minX, center.z, minX + tick, center.z);
    } else {
      // Retrofit/global candidates use an explicitly dashed perimeter, not a
      // recolored local coverage field. The non-color grammar remains legible
      // in screenshots and for color-deficient players.
      for (const [ax, az, bx, bz] of [
        [minX, minZ, maxX, minZ],
        [maxX, minZ, maxX, maxZ],
        [maxX, maxZ, minX, maxZ],
        [minX, maxZ, minX, minZ],
      ] as const) {
        for (let dash = 0; dash < 5; dash += 1) {
          const t0 = dash / 5;
          const t1 = Math.min(1, t0 + 0.105);
          addSegment(
            THREE.MathUtils.lerp(ax, bx, t0),
            THREE.MathUtils.lerp(az, bz, t0),
            THREE.MathUtils.lerp(ax, bx, t1),
            THREE.MathUtils.lerp(az, bz, t1),
          );
        }
      }
      const notch = Math.min(0.52, halfExtent * 0.18);
      addSegment(minX, minZ, minX + notch, minZ + notch);
      addSegment(maxX, minZ, maxX - notch, minZ + notch);
      addSegment(maxX, maxZ, maxX - notch, maxZ - notch);
      addSegment(minX, maxZ, minX + notch, maxZ - notch);
    }
    const coverageAttribute = visuals.coverage.geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    for (let index = 0; index < coverageAttribute.count; index += 1) {
      const point = coveragePoints[index] ?? [center.x, y, center.z];
      coverageAttribute.setXYZ(index, ...point);
    }
    coverageAttribute.needsUpdate = true;
    visuals.coverage.geometry.setDrawRange(0, coveragePoints.length);
    visuals.coverageFill.position.set(center.x, y - 0.006, center.z);
    visuals.coverageFill.scale.set(halfExtent * 2, halfExtent * 2, 1);

    const selectedLinks = this.powerGridVisualLinks
      .filter((link) => (
        link.relayAId === relayId || link.relayBId === relayId
      ))
      .slice(0, MAX_POWER_GRID_SELECTED_LINKS);
    let highlightIndex = 0;
    for (const link of selectedLinks) {
      const dx = link.b.x - link.a.x;
      const dz = link.b.z - link.a.z;
      const inverseLength = 1 / Math.max(0.0001, Math.hypot(dx, dz));
      const edgeOffset = new THREE.Vector3(
        -dz * inverseLength * 0.026,
        0.012,
        dx * inverseLength * 0.026,
      );
      for (let segment = 0; segment < POWER_GRID_CABLE_SEGMENTS; segment += 1) {
        const from = this.powerGridPoint(
          link,
          segment / POWER_GRID_CABLE_SEGMENTS,
          this.tempVector,
        ).add(edgeOffset);
        const to = this.powerGridPoint(
          link,
          (segment + 1) / POWER_GRID_CABLE_SEGMENTS,
          new THREE.Vector3(),
        ).add(edgeOffset);
        this.setPowerGridBeamInstance(
          visuals.links,
          highlightIndex,
          from,
          to,
          0.009,
        );
        highlightIndex += 1;
      }
    }
    visuals.links.count = highlightIndex;
    visuals.links.instanceMatrix.needsUpdate = true;
    if (visuals.links.material instanceof THREE.MeshBasicMaterial) {
      visuals.links.material.color.set(
        localMode ? '#78eadb' : '#d8c8a1',
      );
      visuals.links.material.opacity = localMode ? 0.72 : 0.54;
    }
    if (visuals.coverage.material instanceof THREE.LineBasicMaterial) {
      visuals.coverage.material.color.set(localMode ? '#78fff0' : '#e0c58f');
      visuals.coverage.material.opacity = localMode ? 0.98 : 0.9;
    }
    if (visuals.coverageFill.material instanceof THREE.ShaderMaterial) {
      const uniforms = visuals.coverageFill.material.uniforms;
      (uniforms.uColor?.value as THREE.Color | undefined)?.set(
        localMode ? '#42cfc0' : '#9c8b68',
      );
      if (uniforms.uOpacity) uniforms.uOpacity.value = localMode ? 0.18 : 0.11;
      if (uniforms.uCells) {
        uniforms.uCells.value = Math.max(1, Math.round(halfExtent * 2));
      }
      if (uniforms.uGlobal) uniforms.uGlobal.value = localMode ? 0 : 1;
    }
    visuals.root.visible = true;
    visuals.root.userData.relayId = relayId;
    visuals.root.userData.halfExtent = powerGrid.halfExtent;
    visuals.root.userData.cableReach = powerGrid.cableReach;
    visuals.root.userData.highlightedLinkCount = selectedLinks.length;
    visuals.root.userData.linkEmphasis =
      'continuous-conductor-parallel-edge-tracer';
  }

  private setupScene(): void {
    this.scene.background = new THREE.Color('#101719');
    this.scene.fog = new THREE.FogExp2('#101719', 0.012);
    this.scene.add(
      this.worldRoot,
      this.infrastructureRoot,
      this.entityRoot,
      this.resourceRoot,
      this.itemRoot,
      this.effectsRoot,
      this.powerGridRoot,
      this.overlayRoot,
    );
    this.infrastructureRoot.name = 'factory-infrastructure';
    this.scene.add(new THREE.HemisphereLight('#c9e0e5', '#3a4039', 1.25));
    this.scene.add(new THREE.AmbientLight('#9ca9a4', 0.34));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.025;
    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -32;
    shadowCamera.right = 32;
    shadowCamera.top = 28;
    shadowCamera.bottom = -28;
    shadowCamera.near = 1;
    shadowCamera.far = 100;
    this.sun.target = this.sunTarget;
    this.scene.add(this.sun, this.sunTarget);
    const fill = new THREE.DirectionalLight('#9bc5d3', 0.72);
    fill.position.set(24, 18, -28);
    this.scene.add(fill);
  }

  private setupItems(): void {
    const ingotLayers: THREE.BufferGeometry[] = [];
    for (let layer = 0; layer < 4; layer += 1) {
      const geometry = new RoundedBoxGeometry(
        0.2 - layer * 0.004,
        0.026,
        0.18,
        2,
        0.007,
      );
      geometry.translate(
        (layer % 2 === 0 ? -1 : 1) * 0.006,
        layer * 0.024,
        (layer - 1.5) * 0.004,
      );
      ingotLayers.push(geometry);
    }
    const ingotGeometry = mergeGeometries(ingotLayers, false)
      ?? new RoundedBoxGeometry(0.2, 0.105, 0.18, 2, 0.025);
    for (const layer of ingotLayers) layer.dispose();
    const geometries: Record<ItemVisualKind, THREE.BufferGeometry> = {
      ore: new THREE.DodecahedronGeometry(0.125, 0),
      ingot: ingotGeometry,
      coil: createStrappedCoilGeometry(0.09, 0.038),
      component: new THREE.OctahedronGeometry(0.135, 0),
    };
    geometries.component.rotateY(Math.PI / 4);

    for (const kind of Object.keys(geometries) as ItemVisualKind[]) {
      const material = new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: kind === 'ore' ? 0.76 : kind === 'ingot' ? 0.5 : 0.38,
        metalness: kind === 'ore' ? 0.2 : 0.72,
        vertexColors: kind === 'coil',
      });
      const mesh = new THREE.InstancedMesh(geometries[kind], material, MAX_BELT_ITEMS);
      mesh.name = `belt-items-${kind}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      this.itemRoot.add(mesh);
      this.itemBuckets.set(kind, { mesh, count: 0 });
    }
  }

  private setupParticles(): void {
    this.particleGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.particlePositions, 3),
    );
    this.particleGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(this.particleColors, 3),
    );
    this.particleGeometry.setAttribute('aSize', new THREE.BufferAttribute(this.particleSizes, 1));
    this.particleGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.particleAlphas, 1));
    this.particleGeometry.setDrawRange(0, MAX_PARTICLES);
    this.effectsRoot.add(this.particlePoints);
    for (let index = 0; index < MAX_PARTICLES; index += 1) {
      this.particles.push({
        alive: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        color: new THREE.Color(),
        age: 0,
        life: 1,
        startSize: 1,
        endSize: 1,
        drag: 1,
        gravity: 0,
      });
    }
  }

  private setupOverlays(): void {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.48, 0, -0.48),
      new THREE.Vector3(0.48, 0, -0.48),
      new THREE.Vector3(0.48, 0, -0.48),
      new THREE.Vector3(0.48, 0, 0.48),
      new THREE.Vector3(0.48, 0, 0.48),
      new THREE.Vector3(-0.48, 0, 0.48),
      new THREE.Vector3(-0.48, 0, 0.48),
      new THREE.Vector3(-0.48, 0, -0.48),
    ]);
    this.hoverFrame.geometry = geometry;
    this.hoverFrame.material = new THREE.LineBasicMaterial({
      color: '#e7e3d5',
      transparent: true,
      opacity: 0.44,
      depthTest: false,
    });
    this.hoverFrame.visible = false;
    this.overlayRoot.add(
      this.hoverFrame,
      this.selectionHalo,
      this.powerGridSelectionRoot,
      this.ghostRoot,
    );
  }

  private createFallbackTerrain(): THREE.Texture {
    const utility = makeCanvas(256);
    utility.context.fillStyle = '#252d2e';
    utility.context.fillRect(0, 0, 256, 256);
    for (let index = 0; index < 1200; index += 1) {
      const tone = 35 + Math.floor(seededUnit(index * 13) * 38);
      utility.context.fillStyle = `rgba(${tone + 18},${tone + 5},${tone},.3)`;
      const x = seededUnit(index * 31 + 4) * 256;
      const y = seededUnit(index * 47 + 9) * 256;
      const radius = 0.4 + seededUnit(index * 59 + 2) * 2.3;
      utility.context.fillRect(x, y, radius, radius);
    }
    const texture = new THREE.CanvasTexture(utility.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private createLowPassTerrainTexture(source: THREE.Texture): THREE.Texture {
    const image = source.image as (CanvasImageSource & {
      width?: number;
      height?: number;
    }) | undefined;
    const width = image?.width ?? 0;
    const height = image?.height ?? 0;
    if (!image || width <= 0 || height <= 0) return source;

    const utility = makeCanvas(768);
    utility.context.imageSmoothingEnabled = true;
    utility.context.imageSmoothingQuality = 'high';
    utility.context.drawImage(image, 0, 0, 768, 768);
    utility.context.fillStyle = 'rgba(63,65,59,0.10)';
    utility.context.fillRect(0, 0, 768, 768);
    const terrainPixels = utility.context.getImageData(0, 0, 768, 768);
    const sourcePixels = new Uint8ClampedArray(terrainPixels.data);
    const pixelOffset = (x: number, y: number): number => (y * 768 + x) * 4;
    for (let y = 1; y < 767; y += 1) {
      for (let x = 1; x < 767; x += 1) {
        const offset = pixelOffset(x, y);
        const red = sourcePixels[offset] ?? 0;
        const green = sourcePixels[offset + 1] ?? 0;
        const blue = sourcePixels[offset + 2] ?? 0;
        if (red < green + 10 || green < blue + 2) continue;

        const left = offset - 4;
        const right = offset + 4;
        const above = offset - 768 * 4;
        const below = offset + 768 * 4;
        const neighborRed = (
          (sourcePixels[left] ?? 0)
          + (sourcePixels[right] ?? 0)
          + (sourcePixels[above] ?? 0)
          + (sourcePixels[below] ?? 0)
        ) * 0.25;
        const neighborGreen = (
          (sourcePixels[left + 1] ?? 0)
          + (sourcePixels[right + 1] ?? 0)
          + (sourcePixels[above + 1] ?? 0)
          + (sourcePixels[below + 1] ?? 0)
        ) * 0.25;
        const neighborBlue = (
          (sourcePixels[left + 2] ?? 0)
          + (sourcePixels[right + 2] ?? 0)
          + (sourcePixels[above + 2] ?? 0)
          + (sourcePixels[below + 2] ?? 0)
        ) * 0.25;
        const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
        const neighborLuminance = (
          neighborRed * 0.299
          + neighborGreen * 0.587
          + neighborBlue * 0.114
        );
        const hotDifference = luminance - neighborLuminance;
        if (hotDifference <= 8) continue;

        const blend = THREE.MathUtils.clamp((hotDifference - 8) / 44, 0, 1) * 0.14;
        terrainPixels.data[offset] = THREE.MathUtils.lerp(red, neighborRed, blend);
        terrainPixels.data[offset + 1] = THREE.MathUtils.lerp(green, neighborGreen, blend);
        terrainPixels.data[offset + 2] = THREE.MathUtils.lerp(blue, neighborBlue, blend);
      }
    }
    utility.context.putImageData(terrainPixels, 0, 0);
    const filtered = new THREE.CanvasTexture(utility.canvas);
    filtered.name = 'cinder-terrain-low-pass';
    source.dispose();
    return filtered;
  }

  private createTerrain(texture: THREE.Texture): void {
    const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 56, 56);
    const positions = geometry.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    const base = new THREE.Color();
    for (let index = 0; index < positions.count; index += 1) {
      const noise = macroNoise(positions.getX(index), positions.getY(index));
      base.setHSL(0.12 + noise * 0.018, 0.06 + Math.abs(noise) * 0.03, 0.88 + noise * 0.05);
      colors[index * 3] = base.r;
      colors[index * 3 + 1] = base.g;
      colors[index * 3 + 2] = base.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      map: texture,
      bumpMap: texture,
      bumpScale: 0.012,
      roughness: 0.98,
      metalness: 0.02,
      vertexColors: true,
    });
    this.ground = new THREE.Mesh(geometry, material);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.018;
    this.ground.receiveShadow = true;
    this.worldRoot.add(this.ground);
  }

  private syncInfrastructure(
    entities: readonly RenderEntity[],
    signature: number,
    entityCount: number,
  ): void {
    if (
      signature === this.infrastructureSignature
      && entityCount === this.infrastructureEntityCount
    ) return;
    this.infrastructureSignature = signature;
    this.infrastructureEntityCount = entityCount;
    const visibleEntities = entities.filter(
      (entity) => entity.health === undefined || entity.health > 0,
    );

    this.infrastructureRoot.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    this.infrastructureRoot.clear();
    this.infrastructureRoot.userData.handoffDockCount = 0;
    this.infrastructureRoot.userData.handoffDockInstances = 0;
    this.infrastructureRoot.userData.uplinkApproachBeltCount = 0;
    this.infrastructureRoot.userData.uplinkApproachSupportCount = 0;
    this.infrastructureRoot.userData.uplinkApproachContinuousSpineCount = 0;
    this.infrastructureRoot.userData.uplinkApproachTreatment = null;
    this.infrastructureRoot.userData.uplinkApproachBeltIds = [];
    this.infrastructureRoot.userData.uplinkDockBeltIds = [];
    this.infrastructureRoot.userData.uplinkDockSites = [];
    this.infrastructureRoot.userData.uplinkDistrictApronCount = 0;
    this.infrastructureRoot.userData.uplinkDistrictEntityIds = [];
    this.infrastructureRoot.userData.uplinkDistrictConnectorCount = 0;
    if (visibleEntities.length === 0) return;

    const foundations: DetailInstance[] = [];
    const uplinkDistrictAprons: DetailInstance[] = [];
    const mountingSupports: DetailInstance[] = [];
    const structuralDetails: DetailInstance[] = [];
    const macroMasses: DetailInstance[] = [];
    const valueAccents: DetailInstance[] = [];
    const fasteners: DetailInstance[] = [];
    const oilWear: DetailInstance[] = [];
    const scorchWear: DetailInstance[] = [];
    const debris: DetailInstance[] = [];
    const conduitTrays: DetailBeam[] = [];
    const beltCells = new Set<string>();
    const beltByCell = new Map<
      string,
      { entity: RenderEntity; x: number; z: number }
    >();
    const footprintOwners = new Map<string, RenderEntity>();
    const handoffDockKinds = new Set<RenderEntityKind>([
      'extractor',
      'smelter',
      'fabricator',
      'generator',
      'storage',
    ]);
    let handoffDockCount = 0;
    const belts: Array<{ entity: RenderEntity; x: number; z: number }> = [];
    const machines: Array<{
      entity: RenderEntity;
      x: number;
      z: number;
      width: number;
      depth: number;
      seed: number;
    }> = [];
    const footprintPoint = (
      centerX: number,
      centerZ: number,
      forward: THREE.Vector2,
      forwardOffset: number,
      sideOffset: number,
    ): [number, number] => [
      centerX + forward.x * forwardOffset - forward.y * sideOffset,
      centerZ + forward.y * forwardOffset + forward.x * sideOffset,
    ];
    const footprintScale = (
      forward: THREE.Vector2,
      forwardLength: number,
      height: number,
      sideLength: number,
    ): [number, number, number] => (
      Math.abs(forward.x) > 0.5
        ? [forwardLength, height, sideLength]
        : [sideLength, height, forwardLength]
    );
    const footprintMarkScale = (
      forward: THREE.Vector2,
      forwardLength: number,
      sideLength: number,
    ): [number, number, number] => (
      Math.abs(forward.x) > 0.5
        ? [forwardLength, sideLength, 1]
        : [sideLength, forwardLength, 1]
    );

    for (const entity of visibleEntities) {
      if (entity.kind !== 'belt') continue;
      beltCells.add(`${entity.x},${entity.z}`);
      const belt = { entity, x: entity.x + 0.5, z: entity.z + 0.5 };
      belts.push(belt);
      beltByCell.set(`${entity.x},${entity.z}`, belt);
    }
    for (const entity of visibleEntities) {
      if (entity.kind === 'belt') continue;
      const footprint = this.entityFootprint(entity);
      for (let offsetZ = 0; offsetZ < footprint.worldHeight; offsetZ += 1) {
        for (let offsetX = 0; offsetX < footprint.worldWidth; offsetX += 1) {
          footprintOwners.set(
            `${entity.x + offsetX},${entity.z + offsetZ}`,
            entity,
          );
        }
      }
    }

    // Only the physical cargo-bridge tile may acquire the Uplink dock grammar.
    // Relative to the machine this is 1.5 cells behind its facing direction
    // and 0.5 cells to its right, matching the authoritative reservation and
    // the authored bridge's offset route. Merely terminating against the
    // adjacent rear footprint tile is not a dock connection.
    const uplinkDockSites = visibleEntities
      .filter((entity) => entity.kind === 'storage' && entity.uplink === true)
      .map((uplink) => {
        const footprint = this.entityFootprint(uplink);
        const centerX = uplink.x + footprint.worldWidth * 0.5;
        const centerZ = uplink.z + footprint.worldHeight * 0.5;
        const forward = directionVector(uplink.direction);
        const rightX = -forward.y;
        const rightZ = forward.x;
        return {
          uplinkId: uplink.id,
          dockTile: {
            x: Math.floor(centerX - forward.x * 1.5 + rightX * 0.5),
            z: Math.floor(centerZ - forward.y * 1.5 + rightZ * 0.5),
          },
          directionIndex: directionIndex(uplink.direction),
          beltId: null as RenderEntityId | null,
          connected: false,
        };
      });
    const uplinkDockSiteByCell = new Map(
      uplinkDockSites.map((site) => [
        `${site.dockTile.x},${site.dockTile.z}`,
        site,
      ]),
    );

    // The complete surveyed belt chain feeding the exact Uplink dock uses a
    // compact treatment. Trace its contiguous upstream chain, then replace
    // generic continuous service spines with short supported ties and visible
    // bearing caps.
    const uplinkApproachBelts = new Set<RenderEntityId>();
    const uplinkDockBelts = new Set<RenderEntityId>();
    for (const belt of belts) {
      const dockSite = uplinkDockSiteByCell.get(
        `${belt.entity.x},${belt.entity.z}`,
      );
      if (
        !dockSite
        || directionIndex(belt.entity.direction) !== dockSite.directionIndex
      ) continue;

      uplinkDockBelts.add(belt.entity.id);
      dockSite.beltId = belt.entity.id;
      dockSite.connected = true;
      let cursor: typeof belt | undefined = belt;
      const traced = new Set<RenderEntityId>();
      for (let depth = 0; depth < 12 && cursor; depth += 1) {
        uplinkApproachBelts.add(cursor.entity.id);
        traced.add(cursor.entity.id);
        const upstream = DIRECTION_VECTORS
          .map((offset) => beltByCell.get(
            `${cursor!.entity.x + offset.x},${cursor!.entity.z + offset.y}`,
          ))
          .find((candidate) => {
            if (!candidate || traced.has(candidate.entity.id)) return false;
            const output = directionVector(candidate.entity.direction);
            return (
              candidate.entity.x + output.x === cursor!.entity.x
              && candidate.entity.z + output.y === cursor!.entity.z
            );
          });
        cursor = upstream;
      }
    }
    this.infrastructureRoot.userData.uplinkApproachBeltCount =
      uplinkApproachBelts.size;
    this.infrastructureRoot.userData.uplinkApproachSupportCount =
      uplinkApproachBelts.size * 2;
    this.infrastructureRoot.userData.uplinkApproachContinuousSpineCount = 0;
    this.infrastructureRoot.userData.uplinkApproachTreatment =
      uplinkApproachBelts.size > 0
        ? 'short-supported-cross-ties-with-bearing-caps'
        : null;
    this.infrastructureRoot.userData.uplinkApproachBeltIds =
      [...uplinkApproachBelts];
    this.infrastructureRoot.userData.uplinkDockBeltIds =
      [...uplinkDockBelts];
    this.infrastructureRoot.userData.uplinkDockSites = uplinkDockSites.map(
      (site) => ({
        uplinkId: site.uplinkId,
        dockTile: { ...site.dockTile },
        directionIndex: site.directionIndex,
        beltId: site.beltId,
        connected: site.connected,
        classification:
          'canonical-rear-minus-1.5-right-plus-0.5-direction-matched',
      }),
    );

    // A Commission Uplink district uses service aprons beneath the actual
    // nearby logistics actors. The pads are derived one-for-one from live
    // entity footprints, so they visually consolidate the source route,
    // inserter handoffs, fuel spine and utility machines without inventing
    // duplicate production props or simulation state.
    const uplinkEntity = visibleEntities.find((entity) => entity.uplink === true);
    if (uplinkEntity) {
      const uplinkFootprint = this.entityFootprint(uplinkEntity);
      const uplinkCenterX =
        uplinkEntity.x + uplinkFootprint.worldWidth * 0.5;
      const uplinkCenterZ =
        uplinkEntity.z + uplinkFootprint.worldHeight * 0.5;
      const districtEntityIds: RenderEntityId[] = [];
      let districtMinX = Number.POSITIVE_INFINITY;
      let districtMaxX = Number.NEGATIVE_INFINITY;
      let districtMinZ = Number.POSITIVE_INFINITY;
      let districtMaxZ = Number.NEGATIVE_INFINITY;
      for (const entity of visibleEntities) {
        const footprint = this.entityFootprint(entity);
        const centerX = entity.x + footprint.worldWidth * 0.5;
        const centerZ = entity.z + footprint.worldHeight * 0.5;
        if (
          Math.abs(centerX - uplinkCenterX) > 10
          || centerZ < uplinkCenterZ - 3.2
          || centerZ > uplinkCenterZ + 9.2
        ) continue;
        districtEntityIds.push(entity.id);
        districtMinX = Math.min(districtMinX, entity.x);
        districtMaxX = Math.max(
          districtMaxX,
          entity.x + footprint.worldWidth,
        );
        districtMinZ = Math.min(districtMinZ, entity.z);
        districtMaxZ = Math.max(
          districtMaxZ,
          entity.z + footprint.worldHeight,
        );
        if (
          entity.uplink === true
          || entity.kind === 'gridRelay'
        ) continue;
        const apronMargin = entity.kind === 'belt' ? 0.1 : 0.18;
        uplinkDistrictAprons.push({
          position: [centerX, -0.012, centerZ],
          scale: [
            footprint.worldWidth + apronMargin,
            0.018,
            footprint.worldHeight + apronMargin,
          ],
        });
      }
      if (
        Number.isFinite(districtMinX)
        && Number.isFinite(districtMaxX)
        && Number.isFinite(districtMinZ)
        && Number.isFinite(districtMaxZ)
      ) {
        // One low continuous yard pour is derived strictly from the union
        // bounds of nearby real actors. Individual footprint pads remain
        // slightly raised above it, producing readable service bays without
        // inventing decorative machines. Expansion seams, edge drains, and a
        // central service lane share the same actor-derived extents.
        const yardMargin = 0.38;
        const yardWidth =
          districtMaxX - districtMinX + yardMargin * 2;
        const yardDepth =
          districtMaxZ - districtMinZ + yardMargin * 2;
        const yardCenterX =
          (districtMinX + districtMaxX) * 0.5;
        const yardCenterZ =
          (districtMinZ + districtMaxZ) * 0.5;
        const pourSize = 1.72;
        const pourColumns = Math.ceil(yardWidth / pourSize);
        const pourRows = Math.ceil(yardDepth / pourSize);
        const actualPourWidth = yardWidth / pourColumns;
        const actualPourDepth = yardDepth / pourRows;
        const yardPours: DetailInstance[] = [];
        for (let row = 0; row < pourRows; row += 1) {
          for (let column = 0; column < pourColumns; column += 1) {
            yardPours.push({
              position: [
                districtMinX - yardMargin
                  + actualPourWidth * (column + 0.5),
                -0.025,
                districtMinZ - yardMargin
                  + actualPourDepth * (row + 0.5),
              ],
              scale: [
                Math.max(0.2, actualPourWidth - 0.045),
                0.016,
                Math.max(0.2, actualPourDepth - 0.045),
              ],
            });
          }
        }
        uplinkDistrictAprons.unshift(...yardPours);
        const seamX = yardCenterX;
        const seamZ = yardCenterZ;
        structuralDetails.push(
          {
            position: [seamX, -0.006, yardCenterZ],
            scale: [0.022, 0.014, Math.max(0.6, yardDepth - 0.32)],
          },
          {
            position: [yardCenterX, -0.006, seamZ],
            scale: [Math.max(0.6, yardWidth - 0.32), 0.014, 0.022],
          },
          {
            position: [
              districtMinX + 0.14,
              -0.004,
              yardCenterZ,
            ],
            scale: [0.055, 0.018, Math.max(0.6, yardDepth - 0.5)],
          },
          {
            position: [
              districtMaxX - 0.14,
              -0.004,
              yardCenterZ,
            ],
            scale: [0.055, 0.018, Math.max(0.6, yardDepth - 0.5)],
          },
        );
        for (
          let serviceZ = districtMinZ + 1.65;
          serviceZ < districtMaxZ - 0.8;
          serviceZ += 2.35
        ) {
          for (
            let serviceX = districtMinX + 0.65;
            serviceX < districtMaxX - 0.45;
            serviceX += 1.05
          ) {
            valueAccents.push({
              position: [serviceX, 0.012, serviceZ],
              scale: [0.34, 0.012, 0.024],
            });
          }
        }
        this.infrastructureRoot.userData.uplinkDistrictPavedBounds = {
          minX: districtMinX,
          maxX: districtMaxX,
          minZ: districtMinZ,
          maxZ: districtMaxZ,
        };
      }
      let districtConnectorCount = 0;
      const districtBelts = visibleEntities.filter(
        (entity) => (
          entity.kind === 'belt'
          && districtEntityIds.includes(entity.id)
        ),
      );
      for (const approachId of uplinkApproachBelts) {
        const approach = districtBelts.find(
          (entity) => entity.id === approachId,
        );
        if (!approach) continue;
        const aligned = districtBelts
          .filter((candidate) => (
            !uplinkApproachBelts.has(candidate.id)
            && (
              candidate.x === approach.x
              || candidate.z === approach.z
            )
          ))
          .map((candidate) => ({
            candidate,
            distance: Math.hypot(
              candidate.x - approach.x,
              candidate.z - approach.z,
            ),
          }))
          .filter(({ distance }) => distance >= 2.5 && distance <= 3.2)
          .sort((left, right) => left.distance - right.distance);
        const bridge = aligned[0];
        if (!bridge) continue;
        const horizontal = bridge.candidate.z === approach.z;
        uplinkDistrictAprons.push({
          position: [
            (approach.x + bridge.candidate.x) * 0.5 + 0.5,
            -0.013,
            (approach.z + bridge.candidate.z) * 0.5 + 0.5,
          ],
          scale: horizontal
            ? [bridge.distance - 0.92, 0.018, 0.74]
            : [0.74, 0.018, bridge.distance - 0.92],
        });
        const connectorX =
          (approach.x + bridge.candidate.x) * 0.5 + 0.5;
        const connectorZ =
          (approach.z + bridge.candidate.z) * 0.5 + 0.5;
        const connectorLength = bridge.distance - 0.98;
        for (const side of [-1, 1]) {
          structuralDetails.push({
            position: horizontal
              ? [connectorX, 0.02, connectorZ + side * 0.29]
              : [connectorX + side * 0.29, 0.02, connectorZ],
            scale: horizontal
              ? [connectorLength, 0.04, 0.045]
              : [0.045, 0.04, connectorLength],
          });
        }
        for (const offset of [-0.58, 0, 0.58]) {
          structuralDetails.push({
            position: horizontal
              ? [connectorX + offset, 0.018, connectorZ]
              : [connectorX, 0.018, connectorZ + offset],
            scale: horizontal
              ? [0.05, 0.035, 0.54]
              : [0.54, 0.035, 0.05],
          });
        }
        valueAccents.push({
          position: [connectorX, 0.045, connectorZ],
          scale: horizontal
            ? [0.26, 0.014, 0.045]
            : [0.045, 0.014, 0.26],
        });
        districtConnectorCount += 1;
      }
      const districtStorages = visibleEntities
        .filter((entity) => (
          entity.kind === 'storage'
          && entity.uplink !== true
          && districtEntityIds.includes(entity.id)
        ))
        .map((entity) => {
          const footprint = this.entityFootprint(entity);
          return {
            entity,
            x: entity.x + footprint.worldWidth * 0.5,
            z: entity.z + footprint.worldHeight * 0.5,
          };
        });
      for (let leftIndex = 0; leftIndex < districtStorages.length; leftIndex += 1) {
        const left = districtStorages[leftIndex];
        if (!left) continue;
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < districtStorages.length;
          rightIndex += 1
        ) {
          const right = districtStorages[rightIndex];
          if (!right) continue;
          const dx = right.x - left.x;
          const dz = right.z - left.z;
          const distance = Math.hypot(dx, dz);
          if (
            distance < 2.4
            || distance > 3.4
            || (Math.abs(dx) > 0.2 && Math.abs(dz) > 0.2)
          ) continue;
          uplinkDistrictAprons.push({
            position: [
              (left.x + right.x) * 0.5,
              -0.013,
              (left.z + right.z) * 0.5,
            ],
            scale: Math.abs(dx) > Math.abs(dz)
              ? [Math.max(0.7, distance - 1.82), 0.018, 0.78]
              : [0.78, 0.018, Math.max(0.7, distance - 1.82)],
          });
          structuralDetails.push({
            position: [
              (left.x + right.x) * 0.5,
              0.018,
              (left.z + right.z) * 0.5,
            ],
            scale: Math.abs(dx) > Math.abs(dz)
              ? [Math.max(0.62, distance - 1.9), 0.035, 0.12]
              : [0.12, 0.035, Math.max(0.62, distance - 1.9)],
          });
          districtConnectorCount += 1;
        }
      }
      this.infrastructureRoot.userData.uplinkDistrictApronCount =
        uplinkDistrictAprons.length;
      this.infrastructureRoot.userData.uplinkDistrictEntityIds =
        districtEntityIds;
      this.infrastructureRoot.userData.uplinkDistrictTreatment =
        'authoritative-footprint-service-aprons-and-routed-utilities';
      this.infrastructureRoot.userData.uplinkDistrictConnectorCount =
        districtConnectorCount;
    }

    for (const entity of visibleEntities) {
      if (entity.kind === 'belt') continue;

      const footprint = this.entityFootprint(entity);
      const centerX = entity.x + footprint.worldWidth * 0.5;
      const centerZ = entity.z + footprint.worldHeight * 0.5;
      const seed = hashString(String(entity.id));
      const forward = directionVector(entity.direction);
      const sideX = -forward.y;
      const sideZ = forward.x;
      const halfForward = (
        Math.abs(forward.x) * footprint.worldWidth
        + Math.abs(forward.y) * footprint.worldHeight
      ) * 0.5;
      const halfSide = (
        Math.abs(sideX) * footprint.worldWidth
        + Math.abs(sideZ) * footprint.worldHeight
      ) * 0.5;

      // The manifold already contains a continuous transport plinth and side
      // sockets. Machine service clutter would obscure its three-port topology
      // and incorrectly imply that this passive transport device needs power.
      if (entity.kind === 'manifold') continue;
      // Grid relays provide their own grounded plinth, earth lugs, and cable
      // hardware. Generic machine oil/debris/service clutter would obscure
      // that compact 1x1 electrical silhouette.
      if (entity.kind === 'gridRelay') continue;

      // Inserters that hand cargo directly between two opposing belt cells sit
      // on a compact service bridge. The plate and paired guide rails remain
      // inside the inserter's own tile, meeting (but never covering) the belt
      // edges so transfer branches read as one physically continuous route.
      if (
        entity.kind === 'inserter'
        && beltCells.has(`${entity.x - forward.x},${entity.z - forward.y}`)
        && beltCells.has(`${entity.x + forward.x},${entity.z + forward.y}`)
      ) {
        foundations.push({
          position: [centerX, -0.004, centerZ],
          scale: footprintScale(forward, 1, 0.008, 0.62),
        });
        for (const guideSide of [-1, 1]) {
          const [guideX, guideZ] = footprintPoint(
            centerX,
            centerZ,
            forward,
            0,
            guideSide * 0.31,
          );
          structuralDetails.push({
            position: [guideX, 0.024, guideZ],
            scale: footprintScale(forward, 1, 0.048, 0.065),
          });
        }
      }

      // A machine-facing inserter terminates inside a compact U-shaped service
      // socket instead of sweeping across a terrain-colored gap. Adjacency is
      // derived from occupied footprint cells, so the dock follows rotation
      // and multi-tile machines without changing simulation coordinates.
      if (entity.kind === 'inserter') {
        for (const directionSign of [-1, 1]) {
          const towardMachine = forward.clone().multiplyScalar(directionSign);
          const neighbor = footprintOwners.get(
            `${entity.x + towardMachine.x},${entity.z + towardMachine.y}`,
          );
          if (!neighbor || !handoffDockKinds.has(neighbor.kind)) continue;

          const [deckX, deckZ] = footprintPoint(
            centerX,
            centerZ,
            towardMachine,
            0.64,
            0,
          );
          mountingSupports.push({
            position: [deckX, 0.12, deckZ],
            scale: footprintScale(towardMachine, 0.46, 0.2, 0.38),
          });
          for (const jawSide of [-1, 1]) {
            const [jawX, jawZ] = footprintPoint(
              centerX,
              centerZ,
              towardMachine,
              0.58,
              jawSide * 0.16,
            );
            mountingSupports.push({
              position: [jawX, 0.25, jawZ],
              scale: footprintScale(towardMachine, 0.16, 0.055, 0.1),
            });
          }
          handoffDockCount += 1;
        }
      }

      machines.push({
        entity,
        x: centerX,
        z: centerZ,
        width: footprint.worldWidth,
        depth: footprint.worldHeight,
        seed,
      });
      if (entity.kind === 'smelter' || entity.kind === 'fabricator') {
        if (entity.kind === 'smelter') {
          const sleeperLength = Math.max(0.66, halfSide * 1.45);
          const sleeperOffset = Math.max(0.24, halfForward * 0.38);
          for (const sign of [-1, 1]) {
            const [sleeperX, sleeperZ] = footprintPoint(
              centerX,
              centerZ,
              forward,
              sign * sleeperOffset,
              0,
            );
            mountingSupports.push({
              position: [sleeperX, 0.018, sleeperZ],
              scale: footprintScale(forward, 0.18, 0.055, sleeperLength),
            });
          }
        } else {
          const runnerLength = Math.max(0.84, halfForward * 1.48);
          const runnerSide = Math.max(0.28, halfSide * 0.52);
          for (const sign of [-1, 1]) {
            const [runnerX, runnerZ] = footprintPoint(
              centerX,
              centerZ,
              forward,
              0,
              sign * runnerSide,
            );
            mountingSupports.push({
              position: [runnerX, 0.018, runnerZ],
              scale: footprintScale(forward, runnerLength, 0.055, 0.17),
            });
          }
        }
      } else if (
        entity.kind === 'extractor'
        || entity.kind === 'generator'
        || entity.kind === 'storage'
        || entity.kind === 'beacon'
      ) {
        const footCount = entity.kind === 'generator' || entity.kind === 'beacon' ? 3 : 4;
        const supportForward = Math.min(0.38, Math.max(0.22, halfForward * 0.34));
        const supportSide = Math.min(0.38, Math.max(0.22, halfSide * 0.34));
        const phase = entity.kind === 'storage' ? Math.PI * 0.25 : 0;
        for (let index = 0; index < footCount; index += 1) {
          const angle = phase + index * Math.PI * 2 / footCount;
          const [footX, footZ] = footprintPoint(
            centerX,
            centerZ,
            forward,
            Math.cos(angle) * supportForward,
            Math.sin(angle) * supportSide,
          );
          mountingSupports.push({
            position: [footX, 0.018, footZ],
            scale: footprintScale(forward, 0.19, 0.055, 0.16),
            rotation: [0, -angle, 0],
          });
        }
      }

      if (entity.kind !== 'inserter') {
        const sideJitter = (seededUnit(seed + 193) - 0.5) * Math.min(0.5, halfSide);
        const wearX = centerX + forward.x * (halfForward + 0.18) + sideX * sideJitter;
        const wearZ = centerZ + forward.y * (halfForward + 0.18) + sideZ * sideJitter;
        const longAxis = entity.kind === 'extractor' ? 0.86 : entity.kind === 'smelter' ? 0.78 : 0.62;
        const shortAxis = entity.kind === 'extractor' ? 0.62 : 0.34;
        const wearScale: [number, number, number] = Math.abs(forward.x) > 0.5
          ? [longAxis, shortAxis, 1]
          : [shortAxis, longAxis, 1];
        const mark: DetailInstance = {
          position: [wearX, 0.003, wearZ],
          scale: wearScale,
          rotation: [-Math.PI / 2, 0, (seededUnit(seed + 211) - 0.5) * 0.24],
        };
        if (entity.kind === 'smelter' || entity.kind === 'extractor') {
          scorchWear.push(mark);
          if (entity.kind === 'smelter') {
            scorchWear.push({
              position: [
                wearX + sideX * 0.23,
                0.0035,
                wearZ + sideZ * 0.23,
              ],
              scale: [wearScale[0] * 0.56, wearScale[1] * 0.72, 1],
              rotation: [-Math.PI / 2, 0, (seededUnit(seed + 223) - 0.5) * 0.4],
            });
          }
        } else {
          oilWear.push(mark);
        }

        if (seededUnit(seed + 307) > 0.42) {
          const rearDistance = halfForward + 0.15;
          const looseSide = (seededUnit(seed + 311) - 0.5) * Math.max(0.35, halfSide);
          const debrisScale = 0.028 + seededUnit(seed + 313) * 0.035;
          debris.push({
            position: [
              centerX - forward.x * rearDistance + sideX * looseSide,
              0.027,
              centerZ - forward.y * rearDistance + sideZ * looseSide,
            ],
            scale: [debrisScale, debrisScale * 0.7, debrisScale * 1.15],
            rotation: [
              seededUnit(seed + 317) * 0.6,
              seededUnit(seed + 331) * Math.PI,
              seededUnit(seed + 337) * 0.5,
            ],
          });
        }
      }

      // Static service silhouettes make each occupied footprint read as part of a
      // maintained production line. They stay low, inside the owning cells, and
      // reuse the infrastructure batches so they never affect picking or cargo.
      const serviceSideSign = seededUnit(seed + 503) > 0.5 ? 1 : -1;
      const rearOffset = -Math.max(0.18, halfForward - 0.42);
      const edgeOffset = serviceSideSign * Math.max(0.16, halfSide - 0.5);
      const [serviceX, serviceZ] = footprintPoint(
        centerX,
        centerZ,
        forward,
        rearOffset,
        edgeOffset,
      );

      if (entity.kind === 'smelter') {
        // The authored furnace now owns its regulator, exhaust, and complete
        // intake-to-tap path. The old generic carbon service mass sat inside
        // that footprint as a featureless black block and visually detached
        // from the furnace, so infrastructure contributes only floor wear.
        scorchWear.push({
          position: [
            centerX - forward.x * 0.24,
            0.0025,
            centerZ - forward.y * 0.24,
          ],
          scale: footprintMarkScale(forward, 1.28, 0.78),
          rotation: [-Math.PI / 2, 0, (seededUnit(seed + 509) - 0.5) * 0.22],
        });
      } else if (entity.kind === 'generator') {
        macroMasses.push({
          position: [serviceX, 0.32, serviceZ],
          scale: footprintScale(forward, 0.48, 0.64, 0.58),
        });
        for (let fin = -1; fin <= 1; fin += 1) {
          const [finX, finZ] = footprintPoint(
            centerX,
            centerZ,
            forward,
            rearOffset + 0.08,
            edgeOffset - serviceSideSign * (0.3 + fin * 0.075),
          );
          macroMasses.push({
            position: [finX, 0.29, finZ],
            scale: footprintScale(forward, 0.42, 0.58, 0.12),
          });
        }
        valueAccents.push({
          position: [serviceX, 0.647, serviceZ],
          scale: footprintScale(forward, 0.09, 0.018, 0.36),
        });
        oilWear.push({
          position: [
            centerX - forward.x * 0.16,
            0.0025,
            centerZ - forward.y * 0.16,
          ],
          scale: footprintMarkScale(forward, 1.22, 0.72),
          rotation: [-Math.PI / 2, 0, (seededUnit(seed + 521) - 0.5) * 0.2],
        });
      } else if (entity.kind === 'fabricator') {
        const recipeSeed = hashString(entity.recipe ?? 'idle');
        // Recipe tooling, motor, gear train, magazines, and takeaway rollers
        // are all physically authored on the fabricator rig. Do not layer the
        // legacy generic black cabinet/canister over that causal mechanism.
        oilWear.push({
          position: [
            centerX - forward.x * 0.12,
            0.0025,
            centerZ - forward.y * 0.12,
          ],
          scale: footprintMarkScale(forward, 1.48, 0.82),
          rotation: [-Math.PI / 2, 0, (seededUnit(recipeSeed + 541) - 0.5) * 0.18],
        });
      } else if (entity.kind === 'storage') {
        for (let crate = -1; crate <= 1; crate += 2) {
          const [crateX, crateZ] = footprintPoint(
            centerX,
            centerZ,
            forward,
            rearOffset,
            crate * Math.max(0.22, halfSide - 0.5),
          );
          macroMasses.push({
            position: [crateX, 0.19, crateZ],
            scale: footprintScale(forward, 0.72, 0.38, 0.62),
          });
          fasteners.push({
            position: [
              crateX + forward.x * 0.11,
              0.392,
              crateZ + forward.y * 0.11,
            ],
            scale: [0.052, 0.025, 0.052],
          });
        }
        oilWear.push({
          position: [centerX, 0.0025, centerZ],
          scale: footprintMarkScale(forward, 1.08, 0.7),
          rotation: [-Math.PI / 2, 0, (seededUnit(seed + 557) - 0.5) * 0.18],
        });
      } else if (entity.kind === 'extractor') {
        const [binX, binZ] = footprintPoint(
          centerX,
          centerZ,
          forward,
          rearOffset + 0.02,
          edgeOffset - serviceSideSign * 0.32,
        );
        fasteners.push({
          position: [serviceX, 0.255, serviceZ],
          scale: [0.16, 0.49, 0.16],
        });
        macroMasses.push({
          position: [binX, 0.205, binZ],
          scale: footprintScale(forward, 0.58, 0.41, 0.68),
        });
        valueAccents.push({
          position: [binX, 0.417, binZ],
          scale: footprintScale(forward, 0.09, 0.018, 0.38),
        });
        scorchWear.push({
          position: [
            centerX + forward.x * 0.08,
            0.0025,
            centerZ + forward.y * 0.08,
          ],
          scale: footprintMarkScale(forward, 1.34, 0.86),
          rotation: [-Math.PI / 2, 0, (seededUnit(seed + 569) - 0.5) * 0.24],
        });
      }
    }

    for (const belt of belts) {
      const { entity, x, z } = belt;
      const neighbors = [
        beltCells.has(`${entity.x - 1},${entity.z}`),
        beltCells.has(`${entity.x + 1},${entity.z}`),
        beltCells.has(`${entity.x},${entity.z - 1}`),
        beltCells.has(`${entity.x},${entity.z + 1}`),
      ];
      const neighborCount = neighbors.filter(Boolean).length;
      if (neighborCount === 0) continue;

      const forward = directionVector(entity.direction);
      const sideX = -forward.y;
      const sideZ = forward.x;
      const horizontal = Math.abs(forward.x) > 0.5;
      const trayX = x + sideX * 0.545;
      const trayZ = z + sideZ * 0.545;
      const uplinkApproach = uplinkApproachBelts.has(entity.id);
      if (uplinkApproach) {
        for (const axialOffset of [-0.27, 0.27]) {
          const supportX = trayX + forward.x * axialOffset;
          const supportZ = trayZ + forward.y * axialOffset;
          structuralDetails.push({
            position: [supportX, 0.042, supportZ],
            scale: footprintScale(forward, 0.16, 0.084, 0.22),
          });
          valueAccents.push({
            position: [supportX, 0.091, supportZ],
            scale: footprintScale(forward, 0.2, 0.018, 0.115),
          });
          fasteners.push(
            {
              position: [
                supportX + sideX * 0.07,
                0.108,
                supportZ + sideZ * 0.07,
              ],
              scale: [0.029, 0.021, 0.029],
            },
            {
              position: [
                supportX - sideX * 0.07,
                0.108,
                supportZ - sideZ * 0.07,
              ],
              scale: [0.029, 0.021, 0.029],
            },
          );
        }
      } else {
        structuralDetails.push({
          position: [trayX, 0.045, trayZ],
          scale: horizontal ? [0.995, 0.09, 0.18] : [0.18, 0.09, 0.995],
        });
      }
      foundations.push({
        position: [x, -0.004, z],
        scale: horizontal ? [1.04, 0.008, 1.1] : [1.1, 0.008, 1.04],
      });

      const axialNeighbors = horizontal
        ? Number(neighbors[0]) + Number(neighbors[1])
        : Number(neighbors[2]) + Number(neighbors[3]);
      if (axialNeighbors > 0 && !uplinkApproach) {
        const spineX = x + sideX * 0.7;
        const spineZ = z + sideZ * 0.7;
        conduitTrays.push({
          from: horizontal
            ? [spineX - 0.5, 0.12, spineZ]
            : [spineX, 0.12, spineZ - 0.5],
          to: horizontal
            ? [spineX + 0.5, 0.12, spineZ]
            : [spineX, 0.12, spineZ + 0.5],
          radius: 0.055,
        });
        const spineSeed = hashString(`${entity.x}:${entity.z}:service-spine`);
        if (seededUnit(spineSeed) > 0.68) {
          fasteners.push({
            position: [spineX, 0.086, spineZ],
            scale: [0.035, 0.02, 0.035],
          });
        }
        if (seededUnit(spineSeed + 17) > 0.88) {
          valueAccents.push({
            position: [spineX, 0.084, spineZ],
            scale: horizontal ? [0.16, 0.012, 0.045] : [0.045, 0.012, 0.16],
          });
        }
      }

      const horizontalNeighbors = Number(neighbors[0]) + Number(neighbors[1]);
      const verticalNeighbors = Number(neighbors[2]) + Number(neighbors[3]);
      const isTurn = neighborCount === 2 && horizontalNeighbors === 1 && verticalNeighbors === 1;
      if (neighborCount !== 2 || isTurn) {
        fasteners.push(
          {
            position: [x - 0.49, 0.016, z - 0.49],
            scale: [0.02, 0.018, 0.02],
          },
          {
            position: [x + 0.49, 0.016, z + 0.49],
            scale: [0.02, 0.018, 0.02],
          },
        );
      }
      if (seededUnit(hashString(`${entity.x}:${entity.z}:tray`)) > 0.8) {
        valueAccents.push({
          position: [trayX, 0.039, trayZ],
          scale: horizontal ? [0.05, 0.014, 0.12] : [0.12, 0.014, 0.05],
        });
      }
    }

    // Broad, low-frequency industrial wear groups machine neighborhoods without
    // introducing empty tiled pads. The marks remain below every built surface.
    const machineDistricts = new Map<string, typeof machines>();
    for (const machine of machines) {
      if (machine.entity.kind === 'inserter' || machine.entity.kind === 'beacon') continue;
      const key = `${Math.floor(machine.x / 7)},${Math.floor(machine.z / 7)}`;
      const district = machineDistricts.get(key);
      if (district) district.push(machine);
      else machineDistricts.set(key, [machine]);
    }
    for (const [key, district] of machineDistricts) {
      if (district.length < 2) continue;
      let districtX = 0;
      let districtZ = 0;
      let hotProcessCount = 0;
      for (const machine of district) {
        districtX += machine.x;
        districtZ += machine.z;
        if (machine.entity.kind === 'smelter' || machine.entity.kind === 'extractor') {
          hotProcessCount += 1;
        }
      }
      districtX /= district.length;
      districtZ /= district.length;
      const districtSeed = hashString(`${key}:district-wear`);
      const districtMark: DetailInstance = {
        position: [
          districtX + (seededUnit(districtSeed + 3) - 0.5) * 0.34,
          0.0015,
          districtZ + (seededUnit(districtSeed + 5) - 0.5) * 0.34,
        ],
        scale: [
          Math.min(6.2, 4.25 + district.length * 0.38),
          Math.min(4.1, 2.65 + district.length * 0.28),
          1,
        ],
        rotation: [
          -Math.PI / 2,
          0,
          (seededUnit(districtSeed + 7) - 0.5) * 0.72,
        ],
      };
      if (hotProcessCount >= Math.ceil(district.length * 0.5)) {
        scorchWear.push(districtMark);
      } else {
        oilWear.push(districtMark);
      }
    }

    // A maximum of three deterministic, footprint-contained maintenance gantries
    // provides sparse landmarks without ever crossing a belt or cargo lane.
    const gantryMachines = machines
      .filter((machine) => (
        machine.entity.kind === 'fabricator'
        || machine.entity.kind === 'generator'
        || machine.entity.kind === 'smelter'
      ))
      .sort((a, b) => a.seed - b.seed)
      .slice(0, 3);
    for (const machine of gantryMachines) {
      const forward = directionVector(machine.entity.direction);
      const sideX = -forward.y;
      const sideZ = forward.x;
      const halfForward = (
        Math.abs(forward.x) * machine.width
        + Math.abs(forward.y) * machine.depth
      ) * 0.5;
      const halfSide = (
        Math.abs(sideX) * machine.width
        + Math.abs(sideZ) * machine.depth
      ) * 0.5;
      const gantryForward = -Math.max(0.24, halfForward - 0.19);
      const gantryHalfSpan = Math.max(0.18, Math.min(0.38, halfSide - 0.16));
      const [postAX, postAZ] = footprintPoint(
        machine.x,
        machine.z,
        forward,
        gantryForward,
        -gantryHalfSpan,
      );
      const [postBX, postBZ] = footprintPoint(
        machine.x,
        machine.z,
        forward,
        gantryForward,
        gantryHalfSpan,
      );
      conduitTrays.push(
        {
          from: [postAX, 0.035, postAZ],
          to: [postAX, 0.42, postAZ],
          radius: 0.045,
        },
        {
          from: [postBX, 0.035, postBZ],
          to: [postBX, 0.42, postBZ],
          radius: 0.045,
        },
        {
          from: [postAX, 0.42, postAZ],
          to: [postBX, 0.42, postBZ],
          radius: 0.045,
        },
      );
      valueAccents.push({
        position: [
          (postAX + postBX) * 0.5,
          0.444,
          (postAZ + postBZ) * 0.5,
        ],
        scale: footprintScale(forward, 0.075, 0.018, gantryHalfSpan * 1.4),
      });
    }

    const pushConduit = (
      fromX: number,
      fromZ: number,
      toX: number,
      toZ: number,
    ): boolean => {
      const deltaX = toX - fromX;
      const deltaZ = toZ - fromZ;
      const length = Math.hypot(deltaX, deltaZ);
      if (length < 0.08 || length > 1.6) return false;
      foundations.push({
        position: [(fromX + toX) * 0.5, -0.003, (fromZ + toZ) * 0.5],
        scale: [length + 0.12, 0.008, 0.2],
        rotation: [0, -Math.atan2(deltaZ, deltaX), 0],
      });
      conduitTrays.push({
        from: [fromX, 0.027, fromZ],
        to: [toX, 0.027, toZ],
        radius: 0.044,
      });
      return true;
    };

    for (const machine of machines) {
      if (
        machine.entity.kind === 'inserter'
        || machine.entity.kind === 'storage'
        || machine.entity.kind === 'beacon'
        || belts.length === 0
      ) continue;
      let nearestX = 0;
      let nearestZ = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const belt of belts) {
        const beltForward = directionVector(belt.entity.direction);
        const trunkX = belt.x - beltForward.y * 0.515;
        const trunkZ = belt.z + beltForward.x * 0.515;
        const distance = Math.hypot(trunkX - machine.x, trunkZ - machine.z);
        if (distance >= nearestDistance) continue;
        nearestX = trunkX;
        nearestZ = trunkZ;
        nearestDistance = distance;
      }
      if (!Number.isFinite(nearestDistance) || nearestDistance < 0.75) continue;

      const dx = nearestX - machine.x;
      const dz = nearestZ - machine.z;
      const routeJitter = (seededUnit(machine.seed + 419) - 0.5) * 0.14;
      let startX: number;
      let startZ: number;
      if (Math.abs(dx) >= Math.abs(dz)) {
        const sign = dx >= 0 ? 1 : -1;
        startX = machine.x + sign * (machine.width * 0.5 + 0.02);
        startZ = machine.z + routeJitter;
      } else {
        const sign = dz >= 0 ? 1 : -1;
        startX = machine.x + routeJitter;
        startZ = machine.z + sign * (machine.depth * 0.5 + 0.02);
      }
      if (!pushConduit(startX, startZ, nearestX, nearestZ)) continue;
      structuralDetails.push({
        position: [nearestX, 0.024, nearestZ],
        scale: [0.12, 0.035, 0.12],
      });
      valueAccents.push({
        position: [nearestX, 0.046, nearestZ],
        scale: [0.045, 0.012, 0.045],
      });
      fasteners.push(
        {
          position: [startX, 0.027, startZ],
          scale: [0.054, 0.027, 0.054],
        },
        {
          position: [nearestX, 0.023, nearestZ],
          scale: [0.048, 0.022, 0.048],
        },
      );
    }

    const settleMesh = (
      mesh: THREE.Mesh | THREE.InstancedMesh,
      name: string,
      receiveShadow = true,
    ): void => {
      mesh.name = name;
      mesh.castShadow = false;
      mesh.receiveShadow = receiveShadow;
    };
    if (uplinkDistrictAprons.length > 0) {
      const apronMesh = this.addInstanceBatch(
        this.infrastructureRoot,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.045),
        this.materials.uplinkApron,
        uplinkDistrictAprons,
        false,
      );
      apronMesh.userData.authoritativeFootprintCount =
        uplinkDistrictAprons.length;
      apronMesh.userData.integrationRole =
        'commission-source-fuel-and-utility-service-aprons';
      settleMesh(
        apronMesh,
        'commission-uplink-district-service-aprons',
      );
    }
    if (foundations.length > 0) {
      settleMesh(
        this.addInstanceBatch(
          this.infrastructureRoot,
          new THREE.BoxGeometry(1, 1, 1),
          this.materials.foundation,
          foundations,
          false,
        ),
        'infrastructure-foundations',
      );
    }
    if (mountingSupports.length > 0) {
      const supportMesh = this.addInstanceBatch(
        this.infrastructureRoot,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.07),
        this.materials.carbon,
        mountingSupports,
        false,
      );
      supportMesh.userData.handoffDockCount = handoffDockCount;
      supportMesh.userData.handoffDockInstances = handoffDockCount * 3;
      this.infrastructureRoot.userData.handoffDockCount = handoffDockCount;
      this.infrastructureRoot.userData.handoffDockInstances = handoffDockCount * 3;
      settleMesh(supportMesh, 'infrastructure-machine-supports');
    }
    if (structuralDetails.length > 0) {
      settleMesh(
        this.addInstanceBatch(
          this.infrastructureRoot,
          new THREE.BoxGeometry(1, 1, 1),
          this.materials.carbonDark,
          structuralDetails,
          false,
        ),
        'infrastructure-rails',
      );
    }
    if (macroMasses.length > 0) {
      settleMesh(
        this.addInstanceBatch(
          this.infrastructureRoot,
          new THREE.BoxGeometry(1, 1, 1),
          this.materials.carbon,
          macroMasses,
          false,
        ),
        'infrastructure-macro-masses',
      );
    }
    if (valueAccents.length > 0) {
      settleMesh(
        this.addInstanceBatch(
          this.infrastructureRoot,
          new THREE.BoxGeometry(1, 1, 1),
          this.materials.amber,
          valueAccents,
          false,
        ),
        'infrastructure-markers',
      );
    }
    if (fasteners.length > 0) {
      settleMesh(
        this.addInstanceBatch(
          this.infrastructureRoot,
          new THREE.CylinderGeometry(1, 1, 1, 8, 1),
          this.materials.titaniumLight,
          fasteners,
          false,
        ),
        'infrastructure-fasteners',
      );
    }
    if (conduitTrays.length > 0) {
      settleMesh(
        this.addInstancedBeams(
          this.infrastructureRoot,
          this.materials.carbonDark,
          conduitTrays,
          7,
        ),
        'infrastructure-conduit-trays',
      );
    }
    if (oilWear.length > 0) {
      const mesh = this.addInstanceBatch(
        this.infrastructureRoot,
        new THREE.CircleGeometry(0.5, 18),
        this.materials.stain,
        oilWear,
        false,
      );
      settleMesh(mesh, 'infrastructure-oil-wear', false);
      mesh.renderOrder = -2;
    }
    if (scorchWear.length > 0) {
      const mesh = this.addInstanceBatch(
        this.infrastructureRoot,
        new THREE.CircleGeometry(0.5, 18),
        this.materials.scorch,
        scorchWear,
        false,
      );
      settleMesh(mesh, 'infrastructure-scorch-wear', false);
      mesh.renderOrder = -2;
    }
    if (debris.length > 0) {
      settleMesh(
        this.addInstanceBatch(
          this.infrastructureRoot,
          new THREE.TetrahedronGeometry(1, 0),
          this.materials.ceramicDark,
          debris,
          false,
        ),
        'infrastructure-debris',
      );
    }
  }

  /**
   * Dock-bound belt end rollers are still physical, but use a non-shadowing
   * midtone finish so their repeated cross-lane rhythm reads as supported
   * transfer hardware rather than loose black bars across the cargo path.
   */
  private syncUplinkApproachBeltVisuals(): void {
    const approachIds = new Set<RenderEntityId>(
      this.infrastructureRoot.userData.uplinkApproachBeltIds ?? [],
    );
    const dockSites = (
      this.infrastructureRoot.userData.uplinkDockSites ?? []
    ) as Array<{
      uplinkId: RenderEntityId;
      dockTile: { x: number; z: number };
      directionIndex: number;
      beltId: RenderEntityId | null;
      connected: boolean;
      classification: string;
    }>;
    const dockSiteByUplink = new Map(
      dockSites.map((site) => [site.uplinkId, site]),
    );
    for (const [id, rig] of this.entityObjects) {
      if (rig.kind === 'belt') {
        this.setUplinkApproachBeltVisual(rig, approachIds.has(id));
        continue;
      }
      if (rig.variant !== 'uplink') continue;
      const dockSite = dockSiteByUplink.get(id);
      const connected = dockSite?.connected === true;
      rig.root.userData.uplinkDockConnected = connected;
      rig.root.userData.uplinkDockBeltId = dockSite?.beltId ?? null;
      rig.root.userData.uplinkDockTile = dockSite
        ? { ...dockSite.dockTile }
        : null;
      rig.root.userData.uplinkDockDirectionIndex =
        dockSite?.directionIndex ?? directionIndex(rig.entity.direction);
      rig.root.userData.uplinkDockClassification =
        dockSite?.classification
        ?? 'canonical-rear-minus-1.5-right-plus-0.5-direction-matched';
      if (rig.parts.uplinkDockGuide) {
        rig.parts.uplinkDockGuide.userData.connected = connected;
        rig.parts.uplinkDockGuide.userData.beltId = dockSite?.beltId ?? null;
        rig.parts.uplinkDockGuide.userData.dockTile = dockSite
          ? { ...dockSite.dockTile }
          : null;
      }
    }
  }

  private setUplinkApproachBeltVisual(
    rig: EntityRig,
    uplinkApproach: boolean,
  ): void {
    rig.root.userData.uplinkApproach = uplinkApproach;
    rig.root.userData.rollerTreatment = uplinkApproach
      ? 'continuous-route-rollers-replaced-by-supported-dock-cross-ties'
      : 'midtone-endpoint-only';
    for (const roller of rig.parts.rollers ?? []) {
      if (!(roller instanceof THREE.Mesh)) continue;
      roller.material = uplinkApproach
        ? this.materials.titanium
        : this.materials.carbon;
      roller.visible = !uplinkApproach;
      roller.castShadow = false;
      roller.receiveShadow = false;
      roller.userData.uplinkApproach = uplinkApproach;
    }
  }

  private createEntityRig(entity: RenderEntity): EntityRig {
    const root = new THREE.Group();
    root.name = `${entity.kind}-${String(entity.id)}`;
    const rig: EntityRig = {
      root,
      kind: entity.kind,
      variant: this.entityVariant(entity),
      quality: this.quality,
      entity,
      phaseOffset: seededUnit(hashString(String(entity.id))),
      parts: {},
      lamps: [],
      processMaterials: [],
      ownedMaterials: [],
    };
    const performanceInserter = (
      entity.kind === 'inserter'
      && this.quality === 'performance'
    );
    const performanceGridRelay = (
      entity.kind === 'gridRelay'
      && this.quality === 'performance'
    );
    if (
      entity.kind !== 'belt'
      && !performanceInserter
      && !performanceGridRelay
    ) this.addFootprint(root);
    switch (entity.kind) {
      case 'belt':
        this.buildBelt(rig);
        break;
      case 'manifold':
        this.buildManifold(rig);
        break;
      case 'extractor':
        this.buildExtractor(rig);
        break;
      case 'inserter':
        if (!performanceInserter) this.buildInserter(rig);
        break;
      case 'smelter':
        this.buildSmelter(rig);
        break;
      case 'fabricator':
        this.buildFabricator(rig);
        break;
      case 'generator':
        this.buildGenerator(rig);
        break;
      case 'storage':
        this.buildStorage(rig);
        break;
      case 'beacon':
        this.buildBeacon(rig);
        break;
      case 'gridRelay':
        if (!performanceGridRelay) this.buildGridRelay(rig);
        break;
    }
    if (
      this.quality === 'high'
      && (entity.kind === 'smelter' || entity.kind === 'fabricator')
    ) {
      this.buildProcessSignals(rig);
    }

    root.traverse((object) => {
      object.userData.entityId = entity.id;
    });
    this.entityRoot.add(root);
    return rig;
  }

  private addMesh(
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: [number, number, number] = [0, 0, 0],
    rotation: [number, number, number] = [0, 0, 0],
    castShadow = true,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = castShadow;
    parent.add(mesh);
    return mesh;
  }

  private addRoundedBox(
    parent: THREE.Object3D,
    size: [number, number, number],
    material: THREE.Material,
    position: [number, number, number] = [0, 0, 0],
    rotation: [number, number, number] = [0, 0, 0],
    radius = 0.025,
  ): THREE.Mesh {
    const safeRadius = Math.min(radius, Math.min(...size) * 0.42);
    return this.addMesh(
      parent,
      new RoundedBoxGeometry(size[0], size[1], size[2], 2, safeRadius),
      material,
      position,
      rotation,
    );
  }

  private addAtlasCroppedRoundedBox(
    parent: THREE.Object3D,
    size: [number, number, number],
    material: THREE.Material,
    uvCrop: readonly [number, number, number, number],
    position: [number, number, number] = [0, 0, 0],
    rotation: [number, number, number] = [0, 0, 0],
    radius = 0.025,
  ): THREE.Mesh {
    const safeRadius = Math.min(radius, Math.min(...size) * 0.42);
    const geometry = new RoundedBoxGeometry(
      size[0],
      size[1],
      size[2],
      2,
      safeRadius,
    );
    const uv = geometry.getAttribute('uv');
    const [uMin, uMax, vMin, vMax] = uvCrop;
    for (let index = 0; index < uv.count; index += 1) {
      uv.setXY(
        index,
        THREE.MathUtils.lerp(uMin, uMax, uv.getX(index)),
        THREE.MathUtils.lerp(vMin, vMax, uv.getY(index)),
      );
    }
    uv.needsUpdate = true;
    return this.addMesh(parent, geometry, material, position, rotation);
  }

  private addCylinder(
    parent: THREE.Object3D,
    radius: number,
    height: number,
    material: THREE.Material,
    position: [number, number, number] = [0, 0, 0],
    rotation: [number, number, number] = [0, 0, 0],
    radialSegments = 16,
  ): THREE.Mesh {
    return this.addMesh(
      parent,
      new THREE.CylinderGeometry(radius, radius * 0.96, height, radialSegments, 1),
      material,
      position,
      rotation,
    );
  }

  private addTorus(
    parent: THREE.Object3D,
    radius: number,
    tube: number,
    material: THREE.Material,
    position: [number, number, number] = [0, 0, 0],
    rotation: [number, number, number] = [Math.PI / 2, 0, 0],
    arc = Math.PI * 2,
  ): THREE.Mesh {
    return this.addMesh(
      parent,
      new THREE.TorusGeometry(radius, tube, 8, 24, arc),
      material,
      position,
      rotation,
    );
  }

  private addBeam(
    parent: THREE.Object3D,
    from: THREE.Vector3,
    to: THREE.Vector3,
    radius: number,
    material: THREE.Material,
    radialSegments = 8,
  ): THREE.Mesh {
    const delta = to.clone().sub(from);
    const geometry = new THREE.CylinderGeometry(radius, radius, delta.length(), radialSegments, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private addInstanceBatch(
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    instances: readonly DetailInstance[],
    castShadow = true,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
    for (let index = 0; index < instances.length; index += 1) {
      const instance = instances[index];
      if (!instance) continue;
      this.tempObject.position.set(...instance.position);
      this.tempObject.rotation.set(...(instance.rotation ?? [0, 0, 0]));
      this.tempObject.scale.set(...instance.scale);
      this.tempObject.updateMatrix();
      mesh.setMatrixAt(index, this.tempObject.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.castShadow = castShadow;
    mesh.receiveShadow = castShadow;
    parent.add(mesh);
    return mesh;
  }

  private addInstancedBeams(
    parent: THREE.Object3D,
    material: THREE.Material,
    beams: readonly DetailBeam[],
    radialSegments = 7,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, radialSegments, 1),
      material,
      beams.length,
    );
    const up = new THREE.Vector3(0, 1, 0);
    for (let index = 0; index < beams.length; index += 1) {
      const beam = beams[index];
      if (!beam) continue;
      const from = new THREE.Vector3(...beam.from);
      const delta = new THREE.Vector3(...beam.to).sub(from);
      this.tempObject.position.copy(from).addScaledVector(delta, 0.5);
      this.tempObject.rotation.set(0, 0, 0);
      this.tempObject.quaternion.setFromUnitVectors(up, delta.clone().normalize());
      this.tempObject.scale.set(beam.radius, delta.length(), beam.radius);
      this.tempObject.updateMatrix();
      mesh.setMatrixAt(index, this.tempObject.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private addFootprint(parent: THREE.Object3D): void {
    const footprint = this.addMesh(
      parent,
      new THREE.PlaneGeometry(1.18, 1.18),
      this.materials.stain,
      [0, 0.004, 0],
      [-Math.PI / 2, 0, 0],
      false,
    );
    footprint.name = 'contact-shadow';
    footprint.renderOrder = -1;
  }

  private addLamp(
    rig: EntityRig,
    parent: THREE.Object3D,
    position: [number, number, number],
    radius = 0.035,
  ): THREE.Mesh {
    const material = this.materials.signalTemplate.clone();
    rig.lamps.push(material);
    rig.ownedMaterials.push(material);
    return this.addMesh(
      parent,
      new THREE.SphereGeometry(radius, 10, 7),
      material,
      position,
      [0, 0, 0],
      false,
    );
  }

  private addProcessGlow(
    rig: EntityRig,
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    position: [number, number, number],
    rotation: [number, number, number] = [0, 0, 0],
    emissiveColor?: THREE.ColorRepresentation,
    surfaceColor?: THREE.ColorRepresentation,
  ): THREE.Mesh {
    const material = this.materials.heatTemplate.clone();
    if (emissiveColor !== undefined) {
      material.color.set(surfaceColor ?? emissiveColor);
      material.emissive.set(emissiveColor);
    }
    rig.processMaterials.push(material);
    rig.ownedMaterials.push(material);
    return this.addMesh(parent, geometry, material, position, rotation, false);
  }

  private addRivetCorners(
    parent: THREE.Object3D,
    width: number,
    depth: number,
    y: number,
  ): void {
    const rivets: DetailInstance[] = [
      {
        position: [0, y + 0.006, -depth * 0.5],
        scale: [0.014, width * 0.62, 0.014],
        rotation: [0, 0, Math.PI / 2],
      },
      {
        position: [0, y + 0.006, depth * 0.5],
        scale: [0.014, width * 0.62, 0.014],
        rotation: [0, 0, Math.PI / 2],
      },
      {
        position: [-width * 0.5, y + 0.006, 0],
        scale: [0.014, depth * 0.62, 0.014],
        rotation: [Math.PI / 2, 0, 0],
      },
      {
        position: [width * 0.5, y + 0.006, 0],
        scale: [0.014, depth * 0.62, 0.014],
        rotation: [Math.PI / 2, 0, 0],
      },
    ];
    for (const x of [-width * 0.5, width * 0.5]) {
      for (const z of [-depth * 0.5, depth * 0.5]) {
        rivets.push({
          position: [x, y, z],
          scale: [0.024, 0.014, 0.024],
        });
      }
    }
    this.addInstanceBatch(
      parent,
      new THREE.CylinderGeometry(1, 1, 1, 8, 1),
      this.materials.titaniumLight,
      rivets,
    );
  }

  private buildBelt(rig: EntityRig): void {
    const { root } = rig;
    this.addRoundedBox(root, [0.99, 0.11, 0.99], this.materials.carbonDark, [0, 0.06, 0], [0, 0, 0], 0.025);
    this.addRoundedBox(root, [0.05, 0.16, 0.99], this.materials.titanium, [-0.455, 0.14, 0], [0, 0, 0], 0.012);
    this.addRoundedBox(root, [0.05, 0.16, 0.99], this.materials.titanium, [0.455, 0.14, 0], [0, 0, 0], 0.012);
    this.addRoundedBox(root, [0.038, 0.045, 0.98], this.materials.titanium, [0, 0.16, 0], [0, 0, 0], 0.009);

    const surface = this.addMesh(
      root,
      new THREE.PlaneGeometry(0.86, 0.995),
      this.beltSurfaces.straight.active.material,
      [0, 0.137, 0],
      [-Math.PI / 2, 0, 0],
      false,
    );
    surface.receiveShadow = true;
    rig.parts.surface = surface;
    rig.parts.beltTurn = 'straight';

    const rollers: THREE.Object3D[] = [];
    const rollerCaps: THREE.Object3D[][] = [];
    for (const z of [-0.485, 0.485]) {
      const roller = this.addCylinder(
        root,
        0.038,
        0.78,
        this.materials.carbon,
        [0, 0.145, z],
        [0, 0, Math.PI / 2],
        12,
      );
      roller.castShadow = false;
      roller.receiveShadow = false;
      rollers.push(roller);
      const caps = [this.addCylinder(
        root,
        0.052,
        0.035,
        this.materials.amber,
        [-0.405, 0.145, z],
        [0, 0, Math.PI / 2],
        12,
      ), this.addCylinder(
        root,
        0.052,
        0.035,
        this.materials.amber,
        [0.405, 0.145, z],
        [0, 0, Math.PI / 2],
        12,
      )];
      for (const cap of caps) {
        cap.castShadow = false;
        cap.receiveShadow = false;
      }
      rollerCaps.push(caps);
    }
    rig.parts.rollers = rollers;
    rig.parts.beltRollerCaps = rollerCaps;
    this.addLamp(rig, root, [0.4, 0.245, -0.38], 0.025);
  }

  /**
   * A compact three-port transport switch. The north-facing prototype carries
   * material from the rear/common socket (+Z) into an exposed turnout
   * (-Z), where the two side throats become local A/B. The visible fork,
   * selector tongue, and actuator make each routing decision mechanically
   * causal while the compact plinth still occupies only two cells.
   */
  private buildManifold(rig: EntityRig): void {
    const { root } = rig;
    const castMaterial = this.materials.housing.inserter.clone();
    castMaterial.color.set('#72766f');
    castMaterial.normalScale.set(0.84, 0.84);
    castMaterial.roughness = 0.62;
    castMaterial.metalness = 0.42;
    rig.ownedMaterials.push(castMaterial);
    this.addRoundedBox(
      root,
      [0.96, 0.12, 1.16],
      this.materials.carbonDark,
      [0, 0.065, 0],
      [0, 0, 0],
      0.045,
    );
    this.addRoundedBox(
      root,
      [0.86, 0.055, 0.72],
      this.materials.ceramicDark,
      [0, 0.132, 0.2],
      [0, 0, 0],
      0.022,
    );
    this.addRoundedBox(
      root,
      [0.92, 0.055, 0.38],
      this.materials.carbon,
      [0, 0.132, -0.33],
      [0, 0, 0],
      0.022,
    );
    this.addRoundedBox(
      root,
      [0.76, 0.075, 0.035],
      this.materials.titanium,
      [0, 0.185, 0.535],
      [0, 0, 0],
      0.01,
    );

    // The common transport bed remains broad and mid-value so the flow path
    // does not disappear into the dark plinth at gameplay scale.
    for (const x of [-0.4, 0.4]) {
      this.addRoundedBox(
        root,
        [0.065, 0.17, 0.72],
        this.materials.titanium,
        [x, 0.15, 0.2],
        [0, 0, 0],
        0.017,
      );
    }

    const surfaces: THREE.Mesh[] = [];
    const commonSurface = this.addMesh(
      root,
      new THREE.PlaneGeometry(0.7, 0.98),
      this.beltSurfaces.straight.active.material,
      [0, 0.166, 0.06],
      [-Math.PI / 2, 0, 0],
      false,
    );
    commonSurface.receiveShadow = true;
    surfaces.push(commonSurface);
    for (const x of [-0.29, 0.29]) {
      const branchSurface = this.addMesh(
        root,
        new THREE.PlaneGeometry(0.42, 0.4),
        this.beltSurfaces.straight.active.material,
        [x, 0.166, -0.37],
        [-Math.PI / 2, 0, Math.PI / 2],
        false,
      );
      branchSurface.receiveShadow = true;
      surfaces.push(branchSurface);
    }
    rig.parts.manifoldSurfaces = surfaces;

    const rollers: THREE.Object3D[] = [];
    for (const z of [0.39, 0.08]) {
      const rollerPivot = new THREE.Group();
      rollerPivot.position.set(0, 0.17, z);
      root.add(rollerPivot);
      this.addCylinder(
        rollerPivot,
        0.047,
        0.58,
        this.materials.rubber,
        [0, 0, 0],
        [0, 0, Math.PI / 2],
        12,
      );
      this.addRoundedBox(
        rollerPivot,
        [0.22, 0.018, 0.026],
        this.materials.amber,
        [0, 0.052, 0],
        [0, 0, 0],
        0.006,
      );
      rollerPivot.userData.spinAxis = 'x';
      rollers.push(rollerPivot);
      for (const x of [-0.315, 0.315]) {
        this.addCylinder(
          root,
          0.061,
          0.032,
          this.materials.amber,
          [x, 0.17, z],
          [0, 0, Math.PI / 2],
          12,
        );
      }
    }
    for (const x of [-0.34, 0.34]) {
      const rollerPivot = new THREE.Group();
      rollerPivot.position.set(x, 0.175, -0.37);
      root.add(rollerPivot);
      this.addCylinder(
        rollerPivot,
        0.044,
        0.3,
        this.materials.rubber,
        [0, 0, 0],
        [Math.PI / 2, 0, 0],
        12,
      );
      this.addRoundedBox(
        rollerPivot,
        [0.024, 0.018, 0.16],
        this.materials.amber,
        [0, 0.049, 0],
        [0, 0, 0],
        0.006,
      );
      rollerPivot.userData.spinAxis = 'z';
      rollers.push(rollerPivot);
    }
    rig.parts.manifoldRollers = rollers;

    // Exposed guide rails form a legible Y beneath the selector. Cargo remains
    // visible through the center instead of vanishing behind an opaque box.
    for (const sign of [-1, 1]) {
      this.addBeam(
        root,
        new THREE.Vector3(sign * 0.08, 0.19, -0.08),
        new THREE.Vector3(sign * 0.42, 0.19, -0.29),
        0.02,
        this.materials.titaniumLight,
        7,
      );
      this.addBeam(
        root,
        new THREE.Vector3(sign * 0.08, 0.19, -0.27),
        new THREE.Vector3(sign * 0.42, 0.19, -0.46),
        0.02,
        this.materials.titanium,
        7,
      );
    }
    this.addCylinder(
      root,
      0.19,
      0.035,
      this.materials.carbonDark,
      [0, 0.17, -0.315],
      [0, 0, 0],
      20,
    );
    const coreMaterial = this.materials.signalTemplate.clone();
    coreMaterial.color.set('#3bcdbf');
    coreMaterial.emissive.set('#3bcdbf');
    coreMaterial.emissiveIntensity = 1.35;
    rig.ownedMaterials.push(coreMaterial);
    rig.parts.manifoldCoreMaterial = coreMaterial;
    this.addMesh(
      root,
      new THREE.TorusGeometry(0.155, 0.035, 8, 24),
      this.materials.titanium,
      [0, 0.195, -0.315],
      [Math.PI / 2, 0, 0],
      true,
    );
    for (const x of [-0.065, 0.065]) {
      this.addRoundedBox(
        root,
        [0.035, 0.035, 0.27],
        this.materials.titaniumLight,
        [x, 0.198, -0.155],
        [0, 0, 0],
        0.009,
      );
    }
    this.addRoundedBox(
      root,
      [0.29, 0.12, 0.74],
      this.materials.carbonDark,
      [0.405, 0.165, 0.18],
      [0, 0, 0],
      0.035,
    );
    this.addRoundedBox(
      root,
      [0.25, 0.24, 0.68],
      castMaterial,
      [0.405, 0.275, 0.18],
      [0, 0, 0],
      0.052,
    );
    this.addRoundedBox(
      root,
      [0.195, 0.038, 0.56],
      this.materials.titanium,
      [0.405, 0.414, 0.2],
      [0, 0, 0],
      0.016,
    );
    this.addRoundedBox(
      root,
      [0.062, 0.032, 0.48],
      coreMaterial,
      [0.405, 0.432, 0.23],
      [0, 0, 0],
      0.012,
    );
    // Broad material breaks survive minification as service wear instead of
    // becoming decorative noise, while the dark skirt anchors the pylon.
    this.addRoundedBox(
      root,
      [0.04, 0.135, 0.38],
      this.materials.carbon,
      [0.272, 0.285, 0.16],
      [0, 0, 0],
      0.012,
    );
    this.addRoundedBox(
      root,
      [0.265, 0.045, 0.21],
      this.materials.ceramicDark,
      [0.405, 0.205, 0.355],
      [0, 0, 0],
      0.016,
    );
    const filterGeometry = new THREE.BufferGeometry();
    filterGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([
        -0.13, 0.1, 0,
        0.13, 0.1, 0,
        0.05, 0.01, 0,
        0.05, -0.1, 0,
        -0.05, -0.1, 0,
        -0.05, 0.01, 0,
      ], 3),
    );
    filterGeometry.setIndex([
      0, 2, 1,
      0, 5, 2,
      5, 3, 2,
      5, 4, 3,
    ]);
    filterGeometry.computeVertexNormals();
    const filterMark = this.addMesh(
      root,
      filterGeometry,
      coreMaterial,
      [-0.27, 0.202, -0.315],
      [-Math.PI / 2, 0, 0],
      false,
    );
    filterMark.visible = false;
    rig.parts.manifoldFilterMark = filterMark;

    const selectorMaterial = this.materials.signalTemplate.clone();
    selectorMaterial.color.set('#43d7c4');
    selectorMaterial.emissive.set('#43d7c4');
    selectorMaterial.emissiveIntensity = 1.5;
    rig.ownedMaterials.push(selectorMaterial);
    rig.parts.manifoldSelectorMaterial = selectorMaterial;

    // A low C-shaped cast yoke establishes a unique silhouette without
    // standing over the decision point. Its state rails are broad enough to
    // carry Even/Favor/Extract/blocked color at normal gameplay zoom.
    this.addRoundedBox(
      root,
      [0.86, 0.15, 0.14],
      castMaterial,
      [0, 0.215, -0.535],
      [0, 0, 0],
      0.048,
    );
    this.addRoundedBox(
      root,
      [0.74, 0.035, 0.062],
      this.materials.titanium,
      [0, 0.31, -0.535],
      [0, 0, 0],
      0.013,
    );
    this.addRoundedBox(
      root,
      [0.72, 0.038, 0.055],
      selectorMaterial,
      [0, 0.331, -0.535],
      [0, 0, 0],
      0.012,
    );
    for (const x of [-0.32, 0.32]) {
      this.addRoundedBox(
        root,
        [0.24, 0.15, 0.19],
        castMaterial,
        [x, 0.215, -0.09],
        [0, 0, 0],
        0.048,
      );
      this.addRoundedBox(
        root,
        [0.17, 0.035, 0.115],
        this.materials.titanium,
        [x, 0.31, -0.09],
        [0, 0, 0],
        0.013,
      );
      this.addRoundedBox(
        root,
        [0.17, 0.038, 0.052],
        selectorMaterial,
        [x, 0.331, -0.09],
        [0, 0, 0],
        0.011,
      );
    }

    // The actuator lives on the off-lane service pylon; the low connecting
    // rod makes the mechanical relationship visible without masking cargo.
    const actuatorGear = new THREE.Group();
    actuatorGear.position.set(0.405, 0.465, -0.015);
    root.add(actuatorGear);
    rig.parts.manifoldActuatorGear = actuatorGear;
    this.addCylinder(
      actuatorGear,
      0.105,
      0.045,
      this.materials.titanium,
      [0, 0, 0],
      [0, 0, 0],
      12,
    );
    for (let tooth = 0; tooth < 4; tooth += 1) {
      const angle = tooth * Math.PI * 0.5;
      this.addRoundedBox(
        actuatorGear,
        [0.045, 0.04, 0.15],
        this.materials.amber,
        [Math.sin(angle) * 0.075, 0.025, Math.cos(angle) * 0.075],
        [0, angle, 0],
        0.008,
      );
    }
    this.addBeam(
      root,
      new THREE.Vector3(0.34, 0.345, -0.045),
      new THREE.Vector3(0.09, 0.215, -0.245),
      0.022,
      this.materials.titaniumLight,
      8,
    );

    const vane = new THREE.Group();
    vane.position.set(0, 0.165, -0.315);
    root.add(vane);
    rig.parts.manifoldVane = vane;
    this.addCylinder(
      vane,
      0.065,
      0.05,
      this.materials.carbonDark,
      [0, 0.015, 0],
      [0, 0, 0],
      16,
    );
    this.addRoundedBox(
      vane,
      [0.1, 0.035, 0.43],
      this.materials.titaniumLight,
      [0, 0.025, -0.19],
      [0, 0, 0],
      0.015,
    );
    this.addRoundedBox(
      vane,
      [0.045, 0.014, 0.31],
      selectorMaterial,
      [0, 0.048, -0.19],
      [0, 0, 0],
      0.006,
    );
    const selectorTipGeometry = new THREE.BufferGeometry();
    selectorTipGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([
        -0.08, 0, 0.09,
        0.08, 0, 0.09,
        0, 0, -0.09,
      ], 3),
    );
    selectorTipGeometry.setIndex([0, 1, 2]);
    selectorTipGeometry.computeVertexNormals();
    const selectorTip = this.addMesh(
      vane,
      selectorTipGeometry,
      this.materials.amber,
      [0, 0.06, -0.455],
      [0, 0, 0],
    );
    rig.parts.manifoldSelectorTip = selectorTip;

    // Even is a symmetric policy, not a third straight-through outlet.
    // Its fork replaces the one-way arrow and points at the two real mouths.
    const neutralFork = new THREE.Group();
    neutralFork.position.set(0, 0.06, -0.315);
    vane.add(neutralFork);
    rig.parts.manifoldNeutralFork = neutralFork;
    for (const sign of [-1, 1]) {
      this.addBeam(
        neutralFork,
        new THREE.Vector3(0, 0, 0.015),
        new THREE.Vector3(sign * 0.14, 0, -0.12),
        0.018,
        selectorMaterial,
        7,
      );
      const forkTip = new THREE.BufferGeometry();
      forkTip.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([
          -0.055, 0, 0.045,
          0.055, 0, 0.045,
          0, 0, -0.07,
        ], 3),
      );
      forkTip.setIndex([0, 1, 2]);
      forkTip.computeVertexNormals();
      this.addMesh(
        neutralFork,
        forkTip,
        this.materials.amber,
        [sign * 0.155, 0.004, -0.14],
        [0, sign * -0.72, 0],
      );
    }

    const portMaterials = [0, 1].map(() => {
      const material = this.materials.signalTemplate.clone();
      material.color.set('#43d7c4');
      material.emissive.set('#43d7c4');
      material.emissiveIntensity = 0.35;
      rig.ownedMaterials.push(material);
      return material;
    }) as [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial];
    rig.parts.manifoldPortLamps = portMaterials;
    const shutters: [THREE.Object3D, THREE.Object3D] = [
      new THREE.Group(),
      new THREE.Group(),
    ];
    const shutterFaceMaterials = [0, 1].map(() => {
      const material = castMaterial.clone();
      material.emissive.set('#000000');
      material.emissiveIntensity = 0;
      rig.ownedMaterials.push(material);
      return material;
    }) as [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial];
    rig.parts.manifoldShutterFaceMaterials = shutterFaceMaterials;
    rig.parts.manifoldShutters = shutters;
    for (const [index, x] of [-0.43, 0.43].entries()) {
      // Broad luminous throat collars remain readable even when the tiny
      // status details have minified away.
      this.addRoundedBox(
        root,
        [0.075, 0.055, 0.39],
        portMaterials[index]!,
        [x, 0.225, -0.365],
        [0, 0, 0],
        0.014,
      );
      this.addRoundedBox(
        root,
        [0.22, 0.045, 0.055],
        portMaterials[index]!,
        [index === 0 ? -0.365 : 0.365, 0.226, -0.545],
        [0, 0, 0],
        0.012,
      );
      this.addRoundedBox(
        root,
        [0.22, 0.045, 0.055],
        portMaterials[index]!,
        [index === 0 ? -0.365 : 0.365, 0.226, -0.185],
        [0, 0, 0],
        0.012,
      );
      for (const z of [-0.535, -0.195]) {
        this.addRoundedBox(
          root,
          [0.31, 0.075, 0.038],
          this.materials.titanium,
          [index === 0 ? -0.34 : 0.34, 0.19, z],
          [0, 0, 0],
          0.009,
        );
      }
      const shutter = shutters[index]!;
      shutter.position.set(x, 0.205, -0.365);
      root.add(shutter);
      this.addRoundedBox(
        shutter,
        [0.44, 0.095, 0.43],
        shutterFaceMaterials[index]!,
        [0, 0, 0],
        [0, 0, 0],
        0.038,
      );
      this.addRoundedBox(
        shutter,
        [0.38, 0.032, 0.105],
        portMaterials[index]!,
        [0, 0.064, 0],
        [0, 0, 0],
        0.013,
      );
      this.addRoundedBox(
        shutter,
        [0.055, 0.115, 0.405],
        this.materials.titanium,
        [index === 0 ? 0.195 : -0.195, 0, 0],
        [0, 0, 0],
        0.013,
      );
    }

    const tokenMaterial = this.materials.signalTemplate.clone();
    tokenMaterial.color.set('#c8753d');
    tokenMaterial.emissive.set('#c8753d');
    tokenMaterial.emissiveIntensity = 2;
    rig.ownedMaterials.push(tokenMaterial);
    rig.parts.manifoldFilterTokenMaterial = tokenMaterial;
    this.addRoundedBox(
      root,
      [0.22, 0.13, 0.2],
      this.materials.ceramicDark,
      [0.405, 0.235, 0.465],
      [0, 0, 0],
      0.035,
    );
    this.addTorus(
      root,
      0.115,
      0.022,
      this.materials.titaniumLight,
      [0.405, 0.335, 0.465],
    );
    for (const x of [0.315, 0.495]) {
      this.addRoundedBox(
        root,
        [0.025, 0.16, 0.025],
        this.materials.titanium,
        [x, 0.38, 0.465],
        [0, 0, 0],
        0.007,
      );
    }
    const filterToken = this.addMesh(
      root,
      new THREE.DodecahedronGeometry(0.09, 0),
      tokenMaterial,
      [0.405, 0.375, 0.465],
      [0, 0, 0],
      false,
    );
    filterToken.visible = false;
    rig.parts.manifoldFilterToken = filterToken;

    this.addLamp(rig, root, [-0.34, 0.285, 0.48], 0.028);
    this.addRivetCorners(root, 0.82, 1.02, 0.18);
  }

  private buildExtractor(rig: EntityRig): void {
    const { root } = rig;
    const oxidizedCast = this.materials.housing.extractor.clone();
    oxidizedCast.color.set('#485b5d');
    oxidizedCast.roughness = 0.74;
    oxidizedCast.metalness = 0.42;
    oxidizedCast.normalScale.set(0.86, 0.86);
    // A low, cool self-fill preserves cast-metal relief under the overhead
    // gantry's dense shadow without reading as emissive machinery.
    oxidizedCast.emissive.set('#172628');
    oxidizedCast.emissiveIntensity = 0.22;
    rig.ownedMaterials.push(oxidizedCast);
    const shadowDeck = oxidizedCast.clone();
    shadowDeck.name = 'extractor-shadow-deck';
    shadowDeck.color.set('#354749');
    shadowDeck.roughness = 0.86;
    shadowDeck.metalness = 0.34;
    shadowDeck.emissive.set('#10191a');
    shadowDeck.emissiveIntensity = 0.16;
    rig.ownedMaterials.push(shadowDeck);
    const wornSteel = this.materials.titanium.clone();
    wornSteel.name = 'extractor-worn-moving-steel';
    wornSteel.color.set('#929c98');
    wornSteel.roughness = 0.54;
    wornSteel.metalness = 0.64;
    rig.ownedMaterials.push(wornSteel);
    const copperWear = this.materials.amber.clone();
    copperWear.name = 'extractor-copper-abrasion';
    copperWear.color.set('#b36836');
    copperWear.roughness = 0.9;
    copperWear.metalness = 0.16;
    copperWear.emissive.set('#1b0904');
    copperWear.emissiveIntensity = 0.08;
    rig.ownedMaterials.push(copperWear);
    rig.parts.extractorGantryMaterial = oxidizedCast;
    rig.parts.extractorMovingMaterial = wornSteel;

    // Confine the dark contact patch to the physically open cutter pit. The
    // previous broad stain flattened the whole foundation into a pale basin.
    const contactShadow = root.getObjectByName('contact-shadow');
    if (contactShadow) {
      contactShadow.name = 'extractor-contact-shadow';
      contactShadow.position.z = -0.105;
      contactShadow.scale.set(0.43, 0.52, 1);
    }

    const skidRing = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      oxidizedCast,
      [
        { position: [-0.415, 0.065, 0], scale: [0.37, 0.105, 1.1] },
        { position: [0.415, 0.065, 0], scale: [0.37, 0.105, 1.1] },
        { position: [0, 0.065, 0.3525], scale: [0.46, 0.105, 0.395] },
        { position: [0, 0.065, -0.4575], scale: [0.46, 0.105, 0.185] },
      ],
    );
    skidRing.name = 'extractor-skid-ring';
    const deckRing = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      shadowDeck,
      [
        { position: [-0.37, 0.143, 0.015], scale: [0.3, 0.065, 0.91] },
        { position: [0.37, 0.143, 0.015], scale: [0.3, 0.065, 0.91] },
        { position: [0, 0.143, 0.3075], scale: [0.44, 0.065, 0.325] },
        { position: [0, 0.143, -0.3975], scale: [0.44, 0.065, 0.085] },
      ],
    );
    deckRing.name = 'extractor-deck-ring';
    const floorOpening = new THREE.Object3D();
    floorOpening.name = 'extractor-floor-opening';
    floorOpening.position.set(0, 0.01, -0.105);
    floorOpening.userData.width = 0.44;
    floorOpening.userData.depth = 0.5;
    root.add(floorOpening);
    rig.parts.extractorFloorOpening = floorOpening;

    const feet: DetailInstance[] = [];
    const fasteners: DetailInstance[] = [];
    for (const x of [-0.49, 0.49]) {
      for (const z of [-0.44, 0.44]) {
        feet.push({
          position: [x, 0.055, z],
          scale: [0.29, 0.11, 0.255],
        });
        fasteners.push({
          position: [x, 0.126, z],
          scale: [0.035, 0.026, 0.035],
        });
        fasteners.push({
          position: [x + Math.sign(x) * 0.035, 0.13, z - 0.025],
          scale: [0.075, 0.008, 0.04],
        });
      }
    }
    fasteners.push(
      { position: [-0.43, 0.225, -0.29], scale: [0.028, 0.022, 0.028] },
      { position: [-0.43, 0.225, 0.3], scale: [0.028, 0.022, 0.028] },
      { position: [0.39, 0.225, -0.3], scale: [0.028, 0.022, 0.028] },
      { position: [0.39, 0.225, 0.28], scale: [0.028, 0.022, 0.028] },
      {
        position: [0, 0.19, -0.325],
        scale: [0.018, 0.42, 0.018],
        rotation: [0, 0, Math.PI / 2],
      },
      {
        position: [0, 0.19, 0.315],
        scale: [0.018, 0.42, 0.018],
        rotation: [0, 0, Math.PI / 2],
      },
      { position: [-0.465, 0.315, -0.31], scale: [0.05, 0.04, 0.05] },
      { position: [0.42, 0.31, -0.28], scale: [0.045, 0.035, 0.045] },
    );
    const feetBatch = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      oxidizedCast,
      feet,
    );
    feetBatch.name = 'extractor-feet';
    rig.parts.extractorFeet = feetBatch;
    this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 1, 1, 8, 1),
      this.materials.titanium,
      fasteners,
    );
    const abrasionBatch = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      copperWear,
      [
        { position: [-0.51, 0.157, 0.08], scale: [0.11, 0.018, 0.035] },
        { position: [0.31, 0.785, 0.205], scale: [0.03, 0.155, 0.025] },
        { position: [-0.19, 0.824, -0.105], scale: [0.09, 0.018, 0.028] },
        { position: [-0.5, 0.12, -0.43], scale: [0.13, 0.012, 0.035], rotation: [0, 0.18, 0] },
        { position: [0.5, 0.12, -0.43], scale: [0.11, 0.012, 0.032], rotation: [0, -0.16, 0] },
        { position: [-0.49, 0.12, 0.43], scale: [0.105, 0.012, 0.03], rotation: [0, -0.12, 0] },
        { position: [0.49, 0.12, 0.43], scale: [0.11, 0.012, 0.032], rotation: [0, -0.2, 0] },
        { position: [-0.43, 0.31, -0.29], scale: [0.075, 0.012, 0.026], rotation: [0, 0, 0.72] },
        { position: [0.39, 0.3, -0.27], scale: [0.065, 0.011, 0.024], rotation: [0, 0, -0.68] },
        { position: [-0.28, 0.204, 0.29], scale: [0.13, 0.01, 0.024], rotation: [0, -0.08, 0] },
        { position: [-0.405, 0.152, -0.356], scale: [0.105, 0.009, 0.018], rotation: [0, 0.12, 0] },
        { position: [-0.16, 0.152, -0.356], scale: [0.075, 0.009, 0.017], rotation: [0, -0.18, 0] },
      ],
    );
    abrasionBatch.name = 'extractor-localized-abrasion';
    abrasionBatch.userData.wearCount = 12;
    abrasionBatch.userData.wearScopes = [
      'cutter',
      'rail',
      'braces',
      'feet',
      'chute',
    ];
    rig.parts.extractorWear = abrasionBatch;

    // Twin side-on A frames carry the tool head. Their different stance and
    // the offset drive pack intentionally break the old radial-token symmetry.
    const frameBeams: DetailBeam[] = [
      { from: [-0.5, 0.18, -0.39], to: [-0.31, 0.94, -0.1], radius: 0.07 },
      { from: [-0.5, 0.18, 0.38], to: [-0.31, 0.94, -0.1], radius: 0.07 },
      { from: [0.45, 0.18, -0.34], to: [0.29, 0.9, -0.09], radius: 0.058 },
      { from: [0.43, 0.18, 0.32], to: [0.29, 0.9, -0.09], radius: 0.058 },
      { from: [-0.32, 0.91, -0.1], to: [0.3, 0.91, -0.09], radius: 0.06 },
      { from: [-0.43, 0.37, 0.2], to: [-0.35, 0.68, -0.22], radius: 0.032 },
      { from: [0.36, 0.39, 0.16], to: [0.31, 0.68, -0.2], radius: 0.028 },
    ];
    this.addInstancedBeams(root, oxidizedCast, frameBeams, 8);
    this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.carbon,
      [
        { position: [-0.48, 0.2, -0.36], scale: [0.19, 0.15, 0.18], rotation: [0, -0.25, 0] },
        { position: [-0.47, 0.2, 0.35], scale: [0.19, 0.15, 0.18], rotation: [0, 0.22, 0] },
        { position: [0.43, 0.2, -0.32], scale: [0.16, 0.13, 0.16], rotation: [0, 0.2, 0] },
        { position: [0.42, 0.2, 0.3], scale: [0.16, 0.13, 0.16], rotation: [0, -0.18, 0] },
        { position: [0, 0.19, 0.28], scale: [0.72, 0.025, 0.08] },
        { position: [-0.29, 0.19, 0], scale: [0.07, 0.025, 0.48] },
        { position: [0.27, 0.19, 0], scale: [0.07, 0.025, 0.48] },
      ],
    );
    this.addInstancedBeams(
      root,
      this.materials.titanium,
      [
        { from: [-0.19, 0.35, -0.105], to: [-0.19, 0.91, -0.105], radius: 0.022 },
        { from: [0.19, 0.35, -0.105], to: [0.19, 0.91, -0.105], radius: 0.022 },
      ],
      8,
    );

    const motor = new THREE.Group();
    motor.position.set(0.34, 0.665, 0.19);
    motor.rotation.z = Math.PI / 2;
    root.add(motor);
    rig.parts.extractorMotor = motor;
    this.addCylinder(motor, 0.175, 0.3, oxidizedCast, [0, 0, 0], [0, 0, 0], 8);
    this.addCylinder(
      motor,
      0.135,
      0.045,
      this.materials.carbonDark,
      [0, 0.17, 0],
      [0, 0, 0],
      8,
    );
    this.addTorus(
      motor,
      0.151,
      0.018,
      this.materials.amber,
      [0, -0.105, 0],
    );
    const motorRotor = new THREE.Group();
    motorRotor.position.y = 0.205;
    motor.add(motorRotor);
    rig.parts.extractorMotorRotor = motorRotor;
    this.addCylinder(
      motorRotor,
      0.06,
      0.055,
      this.materials.titanium,
      [0, 0, 0],
      [0, 0, 0],
      10,
    );
    this.addRoundedBox(
      motorRotor,
      [0.075, 0.026, 0.04],
      this.materials.amber,
      [0.052, 0.03, 0],
      [0, 0, 0],
      0.009,
    );

    const carriage = new THREE.Group();
    carriage.position.set(0, 1.04, -0.105);
    root.add(carriage);
    rig.parts.extractorCarriage = carriage;
    this.addRoundedBox(
      carriage,
      [0.34, 0.22, 0.3],
      wornSteel,
      [0, 0, 0],
      [0, 0, 0],
      0.04,
    );
    this.addInstanceBatch(
      carriage,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.titanium,
      [
        { position: [-0.176, 0, 0], scale: [0.025, 0.165, 0.24] },
        { position: [0.176, 0, 0], scale: [0.025, 0.165, 0.24] },
        { position: [0, 0.105, -0.08], scale: [0.22, 0.022, 0.055] },
      ],
    );
    this.addCylinder(
      carriage,
      0.105,
      0.28,
      this.materials.carbonDark,
      [0, -0.155, 0],
      [0, 0, 0],
      12,
    );
    this.addCylinder(
      carriage,
      0.052,
      0.34,
      this.materials.titanium,
      [0, -0.305, 0],
      [0, 0, 0],
      12,
    );
    this.addTorus(
      carriage,
      0.082,
      0.018,
      this.materials.titanium,
      [0, -0.35, 0],
    );

    const rotor = new THREE.Group();
    rotor.position.set(0, -0.42, 0);
    carriage.add(rotor);
    rig.parts.rotor = rotor;
    this.addCylinder(
      rotor,
      0.135,
      0.12,
      wornSteel,
      [0, 0, 0],
      [0, 0, 0],
      8,
    );
    const teeth: DetailInstance[] = [];
    const toothEdges: DetailInstance[] = [];
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      teeth.push({
        position: [sin * 0.13, -0.086, cos * 0.13],
        scale: [0.052, 0.068, 0.042],
        rotation: [0, angle, -sin * 0.18],
      });
      toothEdges.push({
        position: [sin * 0.135, -0.119, cos * 0.135],
        scale: [0.055, 0.018, 0.046],
        rotation: [0, angle, -sin * 0.18],
      });
    }
    const teethBatch = this.addInstanceBatch(
      rotor,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.carbonDark,
      teeth,
    );
    this.addInstanceBatch(
      rotor,
      new THREE.BoxGeometry(1, 1, 1),
      copperWear,
      toothEdges,
    );
    rig.parts.cutters = [teethBatch];
    const drillLandmark = this.addRoundedBox(
      rotor,
      [0.19, 0.085, 0.135],
      this.materials.amber,
      [0.19, 0.045, -0.145],
      [0, -0.28, 0.1],
      0.022,
    );
    drillLandmark.name = 'extractor-drill-landmark';
    rig.parts.extractorDrillLandmark = drillLandmark;
    const contactAnchor = new THREE.Object3D();
    contactAnchor.name = 'extractor-bite-contact';
    contactAnchor.position.set(0, -0.545, 0);
    carriage.add(contactAnchor);
    rig.parts.extractorContactAnchor = contactAnchor;

    const chipMaterial = new THREE.MeshStandardMaterial({
      color: '#c8753d',
      roughness: 0.68,
      metalness: 0.18,
      emissive: '#3d1d12',
      emissiveIntensity: 0.34,
    });
    rig.ownedMaterials.push(chipMaterial);
    rig.parts.extractorChipMaterial = chipMaterial;
    const contactCrown = new THREE.Group();
    contactCrown.name = 'extractor-contact-crown';
    contactCrown.position.set(0, 0.018, -0.105);
    root.add(contactCrown);
    rig.parts.extractorChipCrown = contactCrown;
    const chipInstances: DetailInstance[] = [];
    for (let index = 0; index < 10; index += 1) {
      const angle = index * Math.PI * 2 / 10 + (index % 2) * 0.17;
      const radialStep = 0.78 + (index % 3) * 0.1;
      const size = 0.034 + (index % 4) * 0.006;
      chipInstances.push({
        position: [
          Math.sin(angle) * 0.13 * radialStep,
          0.075 + (index % 2) * 0.075,
          Math.cos(angle) * 0.18 * radialStep,
        ],
        scale: [size * 1.25, size * 0.82, size],
        rotation: [angle * 0.31, angle, -angle * 0.22],
      });
    }
    const chips = this.addInstanceBatch(
      contactCrown,
      new THREE.TetrahedronGeometry(1, 0),
      chipMaterial,
      chipInstances,
      false,
    );
    chips.name = 'extractor-resource-chips';
    const dustMaterial = new THREE.MeshBasicMaterial({
      color: '#c8753d',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    rig.ownedMaterials.push(dustMaterial);
    const dustRing = this.addMesh(
      contactCrown,
      new THREE.RingGeometry(0.075, 0.165, 24),
      dustMaterial,
      [0, 0.012, 0],
      [-Math.PI / 2, 0, 0],
      false,
    );
    dustRing.name = 'extractor-deterministic-dust';
    dustRing.renderOrder = 2;
    rig.parts.extractorDustRing = dustRing;
    contactCrown.visible = false;

    this.addInstancedBeams(
      root,
      this.materials.rubber,
      [
        { from: [0.38, 0.63, 0.12], to: [0.27, 0.75, -0.01], radius: 0.018 },
        { from: [0.27, 0.75, -0.01], to: [0.12, 0.75, -0.1], radius: 0.018 },
        { from: [-0.46, 0.25, 0.23], to: [-0.34, 0.55, 0.15], radius: 0.015 },
        { from: [-0.34, 0.55, 0.15], to: [-0.14, 0.71, -0.06], radius: 0.015 },
      ],
      7,
    );
    this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.amber,
      [
        { position: [0.273, 0.742, -0.008], scale: [0.03, 0.055, 0.06], rotation: [0, -0.55, 0] },
        { position: [-0.34, 0.55, 0.15], scale: [0.03, 0.052, 0.06], rotation: [0, 0.25, 0] },
      ],
    );

    // The open-topped trapezoidal tray terminates at the first lane of the
    // simulation's front belt contact. It contains no proxy payload: the only
    // material visible here is the authoritative belt item after transfer.
    const chutePositions = new Float32Array([
      -0.25, 0.2, -0.26,   0.02, 0.2, -0.26,
      -0.62, 0.125, -0.67, -0.1, 0.125, -0.67,
      -0.25, 0.145, -0.26,  0.02, 0.145, -0.26,
      -0.62, 0.07, -0.67,  -0.1, 0.07, -0.67,
    ]);
    const chuteGeometry = new THREE.BufferGeometry();
    chuteGeometry.setAttribute('position', new THREE.BufferAttribute(chutePositions, 3));
    chuteGeometry.setIndex([
      0, 2, 1, 1, 2, 3,
      4, 5, 6, 5, 7, 6,
      0, 4, 2, 2, 4, 6,
      1, 3, 5, 3, 7, 5,
      2, 6, 3, 3, 6, 7,
    ]);
    chuteGeometry.computeVertexNormals();
    const chuteBody = this.addMesh(root, chuteGeometry, oxidizedCast);
    chuteBody.name = 'extractor-output-chute';
    const throatRails = this.addInstancedBeams(
      root,
      wornSteel,
      [
        { from: [-0.22, 0.205, -0.285], to: [-0.5, 0.15, -0.62], radius: 0.018 },
        { from: [0, 0.205, -0.285], to: [-0.18, 0.15, -0.62], radius: 0.018 },
      ],
      7,
    );
    throatRails.name = 'extractor-v-throat';
    const chuteLip = this.addRoundedBox(
      root,
      [0.44, 0.025, 0.045],
      this.materials.titanium,
      [-0.28, 0.135, -0.355],
      [0, 0, 0],
      0.008,
    );
    chuteLip.name = 'extractor-chute-lip';
    chuteLip.userData.width = 0.44;
    rig.parts.extractorChuteLip = chuteLip;
    const chuteGate = new THREE.Group();
    chuteGate.position.set(-0.28, 0.205, -0.34);
    root.add(chuteGate);
    this.addRoundedBox(
      chuteGate,
      [0.42, 0.06, 0.1],
      wornSteel,
      [0, 0, -0.04],
      [0, 0, 0],
      0.018,
    );
    rig.parts.outputChute = chuteGate;
    const chuteMouthAnchor = new THREE.Object3D();
    chuteMouthAnchor.position.set(-0.3, 0.115, -0.555);
    root.add(chuteMouthAnchor);
    rig.parts.extractorChuteMouthAnchor = chuteMouthAnchor;
    const chuteGateAnchor = new THREE.Object3D();
    chuteGateAnchor.position.set(0, -0.03, -0.09);
    chuteGate.add(chuteGateAnchor);
    rig.parts.extractorChuteGateAnchor = chuteGateAnchor;
    const unloadMaterial = this.materials.heatTemplate.clone();
    unloadMaterial.name = 'extractor-retract-linkage-amber';
    unloadMaterial.color.set('#ffad45');
    unloadMaterial.emissive.set('#b94718');
    unloadMaterial.emissiveIntensity = 2.8;
    rig.ownedMaterials.push(unloadMaterial);
    const unloadLinkage = new THREE.Group();
    unloadLinkage.name = 'extractor-retract-linkage';
    root.add(unloadLinkage);
    const unloadBeams = this.addInstancedBeams(
      unloadLinkage,
      unloadMaterial,
      [
        { from: [-0.04, 0.47, -0.16], to: [-0.19, 0.36, -0.32], radius: 0.031 },
        { from: [-0.19, 0.36, -0.32], to: [-0.34, 0.27, -0.45], radius: 0.031 },
        { from: [-0.34, 0.27, -0.45], to: [-0.3, 0.22, -0.52], radius: 0.026 },
      ],
      8,
    );
    unloadBeams.name = 'extractor-unload-beams';
    unloadLinkage.visible = false;
    rig.parts.extractorUnloadLinkage = unloadLinkage;
    const outputContactAnchor = new THREE.Object3D();
    outputContactAnchor.position.set(-0.40854, 0.24219, -0.60976);
    root.add(outputContactAnchor);
    rig.parts.extractorOutputContactAnchor = outputContactAnchor;
    rig.parts.outputGlow = this.addProcessGlow(
      rig,
      root,
      new RoundedBoxGeometry(0.4, 0.035, 0.025, 2, 0.009),
      [-0.28, 0.145, -0.38],
      [0, 0, 0],
      '#dd7936',
      '#753f26',
    );

    const statusMaterial = this.materials.signalTemplate.clone();
    statusMaterial.color.set('#8d62c3');
    statusMaterial.emissive.set('#8d62c3');
    statusMaterial.emissiveIntensity = 1.2;
    rig.ownedMaterials.push(statusMaterial);
    const statusLamp = this.addMesh(
      root,
      new THREE.SphereGeometry(0.034, 10, 7),
      statusMaterial,
      [-0.285, 0.965, -0.11],
      [0, 0, 0],
      false,
    );
    statusLamp.name = 'extractor-violet-status';
    rig.parts.extractorStatusLamp = statusLamp;
  }

  private buildInserter(rig: EntityRig): void {
    const { root } = rig;
    const castMaterial = this.materials.housing.inserter.clone();
    castMaterial.color.set('#747872');
    castMaterial.normalScale.set(0.86, 0.86);
    castMaterial.roughness = 0.64;
    castMaterial.metalness = 0.38;
    const darkCastMaterial = this.materials.housing.inserter.clone();
    darkCastMaterial.color.set('#4f5959');
    darkCastMaterial.normalScale.set(0.82, 0.82);
    darkCastMaterial.roughness = 0.72;
    darkCastMaterial.metalness = 0.44;
    const jointMaterial = this.materials.amber.clone();
    jointMaterial.color.set('#a9652f');
    jointMaterial.roughness = 0.54;
    jointMaterial.metalness = 0.46;
    const boomShellMaterial = this.materials.titanium.clone();
    boomShellMaterial.color.set('#b67734');
    boomShellMaterial.normalScale.set(0.9, 0.9);
    boomShellMaterial.roughness = 0.56;
    boomShellMaterial.metalness = 0.56;
    const jawSteelMaterial = this.materials.titaniumLight.clone();
    jawSteelMaterial.color.set('#c1c8c4');
    jawSteelMaterial.normalScale.set(0.94, 0.94);
    jawSteelMaterial.roughness = 0.52;
    jawSteelMaterial.metalness = 0.68;
    rig.ownedMaterials.push(
      castMaterial,
      darkCastMaterial,
      jointMaterial,
      boomShellMaterial,
      jawSteelMaterial,
    );

    // A broad soft contact patch, four feet, and nested octagonal drums make
    // the base read as a bolted pedestal rather than another square belt tile.
    const contactShadow = this.addMesh(
      root,
      new THREE.CircleGeometry(0.42, 24),
      this.materials.stain,
      [0, 0.006, 0],
      [-Math.PI / 2, 0, 0],
      false,
    );
    contactShadow.name = 'inserter-contact-shadow';
    contactShadow.renderOrder = -1;
    const bearingShadow = this.addMesh(
      root,
      new THREE.PlaneGeometry(0.52, 0.48),
      this.materials.stain,
      [0, 0.007, 0],
      [-Math.PI / 2, 0, 0],
      false,
    );
    bearingShadow.name = 'inserter-bearing-shadow';
    bearingShadow.renderOrder = -1;
    const footPositions = [
      [-0.255, -0.225],
      [0.255, -0.225],
      [-0.255, 0.225],
      [0.255, 0.225],
    ] as const;
    for (const [index, [x, z]] of footPositions.entries()) {
      const foot = this.addRoundedBox(
        root,
        [0.18, 0.065, 0.16],
        this.materials.ceramicDark,
        [x, 0.055, z],
        [0, index < 2 ? 0.08 : -0.08, 0],
        0.032,
      );
      foot.name = `inserter-foot-${index}`;
      this.addCylinder(
        root,
        0.025,
        0.02,
        this.materials.titaniumLight,
        [x, 0.097, z],
        [0, 0, 0],
        8,
      );
    }
    this.addMesh(
      root,
      new THREE.CylinderGeometry(0.27, 0.3, 0.105, 8, 1),
      this.materials.carbonDark,
      [0, 0.1, 0],
      [0, 0, 0],
    );
    this.addMesh(
      root,
      new THREE.CylinderGeometry(0.31, 0.31, 0.055, 8, 1),
      castMaterial,
      [0, 0.155, 0],
      [0, 0, 0],
    );
    this.addTorus(
      root,
      0.19,
      0.032,
      this.materials.rubber,
      [0, 0.198, 0],
    );
    this.addCylinder(
      root,
      0.115,
      0.17,
      darkCastMaterial,
      [0, 0.275, 0],
      [0, 0, 0],
      16,
    );
    this.addCylinder(
      root,
      0.145,
      0.035,
      this.materials.titanium,
      [0, 0.37, 0],
      [0, 0, 0],
      16,
    );

    const armYaw = new THREE.Group();
    armYaw.name = 'inserter-arm-yaw';
    armYaw.position.y = 0.345;
    root.add(armYaw);
    rig.parts.armYaw = armYaw;

    // Two-stage load path: a dark lower fork carries the torque into a
    // substantial elbow, then a brighter upper linkage drives the wrist.
    // The stepped mass remains legible where the former rails minified into
    // one pale punctuation stroke.
    for (const x of [-0.07, 0.07]) {
      this.addBeam(
        armYaw,
        new THREE.Vector3(x, 0.025, 0.02),
        new THREE.Vector3(x, 0.105, -0.255),
        0.042,
        darkCastMaterial,
        9,
      );
      this.addBeam(
        armYaw,
        new THREE.Vector3(x, 0.15, -0.35),
        new THREE.Vector3(x * 0.786, 0.115, -0.5),
        0.042,
        boomShellMaterial,
        9,
      );
    }
    this.addRoundedBox(
      armYaw,
      [0.23, 0.145, 0.2],
      boomShellMaterial,
      [0, 0.135, -0.305],
      [0, 0, 0],
      0.045,
    );
    this.addRoundedBox(
      armYaw,
      [0.17, 0.055, 0.15],
      this.materials.carbonDark,
      [0, 0.09, -0.305],
      [0, 0, 0],
      0.022,
    );
    for (const x of [-0.095, 0.095]) {
      this.addRoundedBox(
        armYaw,
        [0.045, 0.04, 0.07],
        jointMaterial,
        [x, 0.17, -0.305],
        [0, 0, 0],
        0.012,
      );
    }
    // A single high-value edge catches the key light as the elbow swings.
    // Keeping it compact avoids turning the moving assembly into a bright icon.
    this.addRoundedBox(
      armYaw,
      [0.105, 0.024, 0.075],
      this.materials.titaniumLight,
      [0, 0.214, -0.305],
      [0, 0, 0],
      0.008,
    );
    this.addBeam(
      armYaw,
      new THREE.Vector3(0.115, 0.045, -0.035),
      new THREE.Vector3(0.11, 0.13, -0.47),
      0.015,
      this.materials.rubber,
      6,
    );

    const wristExtension = this.addRoundedBox(
      armYaw,
      [0.12, 0.055, 1],
      boomShellMaterial,
      [0, 0.105, -0.54],
      [0, 0, 0],
      0.018,
    );
    wristExtension.name = 'inserter-wrist-extension';
    rig.parts.wristExtension = wristExtension;

    const wristCarriage = new THREE.Group();
    wristCarriage.name = 'inserter-wrist-carriage';
    wristCarriage.position.set(0, 0, -0.62);
    armYaw.add(wristCarriage);
    rig.parts.wristCarriage = wristCarriage;
    this.addRoundedBox(
      wristCarriage,
      [0.4, 0.065, 0.11],
      boomShellMaterial,
      [0, 0.105, 0],
      [0, 0, 0],
      0.025,
    );
    this.addRoundedBox(
      wristCarriage,
      [0.28, 0.022, 0.075],
      this.materials.titanium,
      [0, 0.15, 0],
      [0, 0, 0],
      0.009,
    );

    const gripper = new THREE.Group();
    gripper.name = 'inserter-gripper';
    gripper.position.set(0, 0.04, 0);
    wristCarriage.add(gripper);
    rig.parts.gripper = gripper;
    this.addRoundedBox(
      gripper,
      [0.2, 0.075, 0.13],
      darkCastMaterial,
      [0, 0, 0.035],
      [0, 0, 0],
      0.025,
    );
    this.addCylinder(
      gripper,
      0.05,
      0.07,
      this.materials.titanium,
      [0, 0.025, 0.045],
      [0, 0, 0],
      12,
    );

    const jaws: [THREE.Object3D, THREE.Object3D] = [
      new THREE.Group(),
      new THREE.Group(),
    ];
    const tipAnchors: [THREE.Object3D, THREE.Object3D] = [
      new THREE.Object3D(),
      new THREE.Object3D(),
    ];
    const hookTips: [THREE.Object3D, THREE.Object3D] = [
      new THREE.Group(),
      new THREE.Group(),
    ];
    for (const [index, sign] of [-1, 1].entries()) {
      const jaw = jaws[index]!;
      jaw.name = `inserter-jaw-${index}`;
      jaw.position.x = sign * 0.195;
      gripper.add(jaw);
      // The pale vertical fingers stay outside the cargo envelope. Separate
      // hooked tips sweep over the top silhouette, so pickup remains legible
      // even when the source item and carried proxy occupy the same pixels.
      this.addRoundedBox(
        jaw,
        [0.035, 0.155, 0.09],
        jawSteelMaterial,
        [sign * 0.0475, -0.07, -0.015],
        [0, 0, 0],
        0.012,
      );

      const tip = hookTips[index]!;
      tip.name = `inserter-hook-tip-${index}`;
      tip.position.set(sign * 0.035, -0.003, -0.06);
      jaw.add(tip);
      const hookPlate = this.addRoundedBox(
        tip,
        [0.14, 0.03, 0.085],
        jawSteelMaterial,
        [0, 0, 0],
        [0, 0, 0],
        0.014,
      );
      hookPlate.name = `inserter-hook-plate-${index}`;
      hookPlate.renderOrder = 3;
      const hookNib = this.addRoundedBox(
        tip,
        [0.03, 0.062, 0.09],
        this.materials.titaniumLight,
        [-sign * 0.055, -0.018, 0],
        [0, 0, 0],
        0.009,
      );
      hookNib.name = `inserter-hook-nib-${index}`;
      hookNib.renderOrder = 4;
      const tipAnchor = tipAnchors[index]!;
      tipAnchor.name = `inserter-tip-anchor-${index}`;
      tipAnchor.position.x = -sign * 0.07;
      tip.add(tipAnchor);

      this.addCylinder(
        jaw,
        0.015,
        0.018,
        jointMaterial,
        [sign * 0.0475, 0.012, 0.025],
        [0, 0, 0],
        8,
      );
    }
    rig.parts.gripperJaws = jaws;
    rig.parts.gripperHookTips = hookTips;
    rig.parts.gripperTipAnchors = tipAnchors;

    const heldItemMaterial = new THREE.MeshStandardMaterial({
      color: '#b8c5c7',
      roughness: 0.76,
      metalness: 0.2,
      vertexColors: true,
    });
    heldItemMaterial.name = 'inserter-carried-item-material';
    rig.ownedMaterials.push(heldItemMaterial);
    rig.parts.heldItemMaterial = heldItemMaterial;
    const heldItem = new THREE.Group();
    heldItem.name = 'inserter-carried-item';
    heldItem.position.set(0, -0.105, -0.06);
    heldItem.visible = false;
    gripper.add(heldItem);
    rig.parts.heldItem = heldItem;
    const heldItemVariants: Record<ItemVisualKind, THREE.Object3D> = {
      ore: this.addMesh(
        heldItem,
        new THREE.DodecahedronGeometry(0.105, 0),
        heldItemMaterial,
      ),
      ingot: this.addMesh(
        heldItem,
        new RoundedBoxGeometry(0.16, 0.075, 0.23, 2, 0.022),
        heldItemMaterial,
      ),
      coil: this.addMesh(
        heldItem,
        createStrappedCoilGeometry(0.082, 0.027),
        heldItemMaterial,
      ),
      component: this.addMesh(
        heldItem,
        new THREE.OctahedronGeometry(0.11, 0),
        heldItemMaterial,
        [0, 0, 0],
        [0, Math.PI / 4, 0],
      ),
    };
    for (const variant of Object.values(heldItemVariants)) {
      variant.visible = false;
    }
    rig.parts.heldItemVariants = heldItemVariants;

    this.addLamp(rig, root, [0.19, 0.17, 0.18], 0.022);
  }

  /**
   * Physical, renderer-only process instrumentation for production machines.
   * Every signal is a child of the authored machine rig, so rotation and
   * footprint scaling remain exact and no billboard state can drift from it.
   */
  private buildProcessSignals(rig: EntityRig): void {
    const { root } = rig;
    const signalRoot = new THREE.Group();
    signalRoot.name = 'process-signals';
    signalRoot.userData.physicallyAttached = true;
    root.add(signalRoot);
    rig.parts.processSignalRoot = signalRoot;

    const ownSignalMaterial = (
      source: THREE.MeshStandardMaterial,
      color: THREE.ColorRepresentation,
      emissive: THREE.ColorRepresentation,
      roughness: number,
      metalness: number,
    ): THREE.MeshStandardMaterial => {
      const material = source.clone();
      material.color.set(color);
      material.emissive.set(emissive);
      material.emissiveIntensity = 0.35;
      material.roughness = roughness;
      material.metalness = metalness;
      rig.ownedMaterials.push(material);
      return material;
    };

    const steelDieMaterial = ownSignalMaterial(
      this.materials.titaniumLight,
      '#aeb8b5',
      '#273638',
      0.42,
      0.66,
    );
    const steelGrooveMaterial = ownSignalMaterial(
      this.materials.titanium,
      rig.kind === 'fabricator' ? '#5d6b6b' : '#48575a',
      '#151d1e',
      0.5,
      0.66,
    );
    const amberMaterial = ownSignalMaterial(
      this.materials.amber,
      '#a86f2d',
      '#7d430d',
      0.48,
      0.52,
    );
    const tealMaterial = ownSignalMaterial(
      this.materials.signalTemplate,
      rig.kind === 'fabricator' ? '#648b62' : '#4e7954',
      '#2b8d3a',
      0.44,
      0.48,
    );
    const reclaimMaterial = ownSignalMaterial(
      this.materials.signalTemplate,
      '#4c8363',
      '#2d8b53',
      0.45,
      0.44,
    );
    const redMaterial = ownSignalMaterial(
      this.materials.signalTemplate,
      '#8d4037',
      '#84251f',
      0.5,
      0.46,
    );
    const copperDieMaterial = ownSignalMaterial(
      this.materials.titanium,
      '#cf672f',
      '#74280e',
      0.38,
      0.62,
    );
    const copperHighlightMaterial = ownSignalMaterial(
      this.materials.titaniumLight,
      '#ffad59',
      '#8f3b15',
      0.3,
      0.64,
    );
    const brickMaterial = ownSignalMaterial(
      this.materials.ceramic,
      '#923c2d',
      '#4d1712',
      0.9,
      0.04,
    );
    const brickLightMaterial = ownSignalMaterial(
      this.materials.ceramic,
      '#d47b4e',
      '#6d2819',
      0.87,
      0.04,
    );
    const mortarMaterial = ownSignalMaterial(
      this.materials.ceramic,
      '#d7c4a0',
      '#4f3b25',
      0.96,
      0.02,
    );
    const boardMaterial = ownSignalMaterial(
      this.materials.ceramic,
      '#2e8e55',
      '#0b4a2a',
      0.58,
      0.2,
    );
    const boardTraceMaterial = ownSignalMaterial(
      this.materials.titaniumLight,
      '#efd477',
      '#725d1e',
      0.34,
      0.58,
    );
    const coreMaterial = ownSignalMaterial(
      this.materials.signalTemplate,
      '#4ce1df',
      '#1cc8ca',
      0.24,
      0.46,
    );
    rig.parts.processGlyphMaterial = steelDieMaterial;
    rig.parts.processGlyphAccentMaterial = steelGrooveMaterial;
    rig.parts.processAmberMaterial = amberMaterial;
    rig.parts.processTealMaterial = tealMaterial;
    rig.parts.processRedMaterial = redMaterial;
    steelDieMaterial.emissiveIntensity = 0.12;
    steelGrooveMaterial.emissiveIntensity = 0.04;
    copperDieMaterial.emissiveIntensity = 0.14;
    copperHighlightMaterial.emissiveIntensity = 0.18;
    brickMaterial.emissiveIntensity = 0.08;
    brickLightMaterial.emissiveIntensity = 0.12;
    reclaimMaterial.emissiveIntensity = 0.34;
    boardMaterial.emissiveIntensity = 0.12;
    boardTraceMaterial.emissiveIntensity = 0.18;
    coreMaterial.emissiveIntensity = 0.34;
    const instrumentShellMaterial = ownSignalMaterial(
      this.materials.housing[rig.kind === 'smelter' ? 'smelter' : 'fabricator'],
      rig.kind === 'smelter' ? '#70503d' : '#6b7c64',
      '#111514',
      0.67,
      0.42,
    );
    if (rig.kind === 'fabricator') {
      instrumentShellMaterial.color.set('#7f8f79');
      instrumentShellMaterial.emissive.set('#20281f');
      instrumentShellMaterial.emissiveIntensity = 0.11;
    } else {
      instrumentShellMaterial.emissiveIntensity = 0.02;
    }

    if (rig.kind === 'fabricator') {
      this.addInstanceBatch(
        signalRoot,
        new RoundedBoxGeometry(1, 1, 1, 3, 0.13),
        instrumentShellMaterial,
        [
          { position: [-0.44, 0.535, PROCESS_RECIPE_STATION_Z], scale: [0.22, 0.085, 0.3] },
          { position: [0.44, 0.535, PROCESS_RECIPE_STATION_Z], scale: [0.3, 0.095, 0.4] },
        ],
      ).name = 'fabricator-fixed-state-and-recipe-plaque-backing-hoods';
      this.addInstanceBatch(
        signalRoot,
        new THREE.BoxGeometry(1, 1, 1),
        steelDieMaterial,
        [
          { position: [-0.44, 0.582, PROCESS_RECIPE_STATION_Z - 0.115], scale: [0.15, 0.018, 0.018] },
          { position: [0.44, 0.582, PROCESS_RECIPE_STATION_Z - 0.115], scale: [0.15, 0.018, 0.018] },
        ],
      ).name = 'fabricator-plaque-hood-rubbed-load-edges';
      this.addInstanceBatch(
        signalRoot,
        new THREE.CylinderGeometry(1, 1, 1, 8, 1),
        this.materials.titaniumLight,
        [-0.49, -0.39, 0.39, 0.49].map((x) => ({
          position: [x, 0.59, PROCESS_RECIPE_STATION_Z + (x < 0 ? 0.09 : -0.09)] as [number, number, number],
          scale: [0.012, 0.009, 0.012] as [number, number, number],
        })),
      ).name = 'fabricator-plaque-hood-visible-fasteners';
    }

    // Recipe identity occupies a fixed right-hand physical tooling mast. The
    // opposite fixed mast carries state, so recipe and state remain separate
    // channels without becoming framed UI cards or floating roof decals.
    this.addInstancedBeams(
      signalRoot,
      this.materials.titaniumLight,
      [
        {
          from: [
            PROCESS_RECIPE_STATION_X,
            0.57,
            PROCESS_RECIPE_STATION_Z,
          ] as [number, number, number],
          to: [
            PROCESS_RECIPE_STATION_X,
            PROCESS_RECIPE_PLAQUE_Y,
            PROCESS_RECIPE_STATION_Z,
          ] as [number, number, number],
          radius: 0.032,
        },
        {
          from: [
            PROCESS_RECIPE_STATION_X,
            0.66,
            PROCESS_RECIPE_STATION_Z,
          ] as [number, number, number],
          to: [0.28, 0.54, -0.18] as [number, number, number],
          radius: 0.024,
        },
        {
          from: [-0.44, 0.57, -0.34] as [number, number, number],
          to: [
            PROCESS_RECIPE_STATION_X,
            0.57,
            PROCESS_RECIPE_STATION_Z,
          ] as [number, number, number],
          radius: 0.024,
        },
      ],
      8,
    ).name = 'process-plaque-stanchions';
    const instrumentBridge = new THREE.Group();
    instrumentBridge.name = 'process-integrated-instrument-bridge';
    signalRoot.add(instrumentBridge);
    // Keep the instrument station mechanically tied to the machine without
    // laying an opaque dashboard slab across the work cell. Twin cast rails
    // expose the material path beneath them; the brighter cap strips make the
    // load path read as steel hardware rather than a black rectangular void.
    this.addInstanceBatch(
      instrumentBridge,
      new RoundedBoxGeometry(1, 1, 1, 3, 0.16),
      instrumentShellMaterial,
      [-0.105, 0.105].map((zOffset) => ({
        position: [
          0,
          0.62,
          PROCESS_RECIPE_STATION_Z + zOffset,
        ] as [number, number, number],
        scale: [1.02, 0.09, 0.062] as [number, number, number],
      })),
    ).name = 'process-instrument-twin-cast-cross-rails';
    this.addInstanceBatch(
      instrumentBridge,
      new RoundedBoxGeometry(1, 1, 1, 2, 0.14),
      this.materials.titanium,
      [-0.105, 0.105].map((zOffset) => ({
        position: [
          0,
          0.682,
          PROCESS_RECIPE_STATION_Z + zOffset,
        ] as [number, number, number],
        scale: [0.94, 0.032, 0.042] as [number, number, number],
      })),
    ).name = 'process-instrument-brushed-steel-rail-caps';
    this.addInstancedBeams(
      instrumentBridge,
      this.materials.titanium,
      [
        { from: [-0.47, 0.59, -0.3], to: [-0.36, 0.38, -0.13], radius: 0.028 },
        { from: [0.47, 0.59, -0.3], to: [0.36, 0.38, -0.13], radius: 0.028 },
        { from: [-0.47, 0.59, -0.38], to: [-0.36, 0.38, -0.2], radius: 0.024 },
        { from: [0.47, 0.59, -0.38], to: [0.36, 0.38, -0.2], radius: 0.024 },
      ],
      8,
    ).name = 'process-instrument-four-load-bearing-machine-ties';
    this.addRoundedBox(
      instrumentBridge,
      [0.23, 0.48, 0.22],
      instrumentShellMaterial,
      [-0.44, 0.81, PROCESS_RECIPE_STATION_Z],
      [0, 0, 0],
      0.028,
    ).name = 'process-state-hardware-column';
    this.addRoundedBox(
      instrumentBridge,
      [0.23, 0.3, 0.22],
      instrumentShellMaterial,
      [PROCESS_RECIPE_STATION_X, 0.74, PROCESS_RECIPE_STATION_Z],
      [0, 0, 0],
      0.028,
    ).name = 'process-recipe-tooling-column';
    this.addInstanceBatch(
      instrumentBridge,
      new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
      this.materials.industrialPanel,
      [
        {
          position: [-0.44, 1.045, PROCESS_RECIPE_STATION_Z],
          scale: [0.165, 0.022, 0.165],
        },
        {
          position: [PROCESS_RECIPE_STATION_X, 0.895, PROCESS_RECIPE_STATION_Z],
          scale: [0.165, 0.022, 0.165],
        },
      ],
    ).name = 'process-instrument-authored-service-lids';
    this.addInstanceBatch(
      instrumentBridge,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.amber,
      [
        { position: [-0.44, 0.76, -0.445], scale: [0.095, 0.025, 0.02] },
        { position: [-0.44, 0.84, -0.445], scale: [0.095, 0.025, 0.02] },
        { position: [0.44, 0.72, -0.445], scale: [0.095, 0.025, 0.02] },
      ],
    ).name = 'process-instrument-service-latches';
    this.addInstancedBeams(
      instrumentBridge,
      this.materials.rubber,
      [
        {
          from: [-0.44, 0.58, -0.34],
          to: [-0.28, 0.48, -0.15],
          radius: 0.018,
        },
        {
          from: [0.44, 0.58, -0.34],
          to: [0.28, 0.48, -0.15],
          radius: 0.018,
        },
      ],
      7,
    ).name = 'process-instrument-hardwired-conduits';
    this.addInstanceBatch(
      instrumentBridge,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.titanium,
      [
        {
          position: [-0.44, 0.62, PROCESS_RECIPE_STATION_Z + 0.065],
          scale: [0.31, 0.07, 0.035],
          rotation: [0, 0, -0.58],
        },
        {
          position: [0.44, 0.62, PROCESS_RECIPE_STATION_Z + 0.065],
          scale: [0.31, 0.07, 0.035],
          rotation: [0, 0, 0.58],
        },
      ],
    ).name = 'process-instrument-load-bearing-gussets';
    this.addInstanceBatch(
      instrumentBridge,
      new THREE.CylinderGeometry(1, 1, 1, 8, 1),
      this.materials.titaniumLight,
      [
        [-0.51, 0.65, PROCESS_RECIPE_STATION_Z - 0.095],
        [-0.37, 0.65, PROCESS_RECIPE_STATION_Z - 0.095],
        [0.37, 0.65, PROCESS_RECIPE_STATION_Z - 0.095],
        [0.51, 0.65, PROCESS_RECIPE_STATION_Z - 0.095],
      ].map(([x, y, z]) => ({
        position: [x, y, z] as [number, number, number],
        scale: [0.014, 0.012, 0.014] as [number, number, number],
        rotation: [Math.PI / 2, 0, 0] as [number, number, number],
      })),
    ).name = 'process-instrument-visible-frame-fasteners';
    const buildPlaque = (name: string): THREE.Group => {
      const plaque = new THREE.Group();
      plaque.name = name;
      signalRoot.add(plaque);
      this.addCylinder(
        plaque,
        0.22,
        0.055,
        this.materials.titanium,
        [0, 0.015, 0],
        [0, 0, 0],
      );
      this.addCylinder(
        plaque,
        0.155,
        0.07,
        this.materials.carbonDark,
        [0, 0.052, 0],
        [0, 0, 0],
      );
      this.addTorus(
        plaque,
        0.19,
        0.026,
        this.materials.titaniumLight,
        [0, 0.096, 0],
        [Math.PI / 2, 0, 0],
      ).name = `${name}-open-spindle-ring`;
      this.addInstanceBatch(
        plaque,
        new THREE.BoxGeometry(1, 1, 1),
        this.materials.titanium,
        Array.from({ length: 4 }, (_, index) => {
          const angle = index * Math.PI / 2;
          return {
            position: [
              Math.sin(angle) * 0.19,
              0.115,
              Math.cos(angle) * 0.19,
            ] as [number, number, number],
            scale: [0.08, 0.055, 0.045] as [number, number, number],
            rotation: [0, angle, 0] as [number, number, number],
          };
        }),
      ).name = `${name}-tooling-clamps`;
      this.addCylinder(
        plaque,
        0.045,
        0.12,
        this.materials.amber,
        [0, 0.11, 0],
        [0, 0, 0],
        10,
      ).name = `${name}-drive-spindle`;
      return plaque;
    };

    const plaque = buildPlaque('process-recipe-plaque');
    plaque.position.set(
      PROCESS_RECIPE_STATION_X,
      PROCESS_RECIPE_PLAQUE_Y,
      PROCESS_RECIPE_STATION_Z,
    );
    rig.parts.processPlaque = plaque;
    const pendingPlaque = buildPlaque('process-pending-recipe-plaque');
    pendingPlaque.position.set(
      PROCESS_RECIPE_PAIR_PENDING_X,
      PROCESS_RECIPE_PLAQUE_Y,
      PROCESS_RECIPE_STATION_Z,
    );
    pendingPlaque.visible = false;
    rig.parts.processPendingPlaque = pendingPlaque;

    const buildGlyphSet = (
      name: string,
    ): { root: THREE.Group; variants: Map<string, THREE.Object3D> } => {
      const glyphRoot = new THREE.Group();
      glyphRoot.name = name;
      glyphRoot.userData.recipeIdentity = null;
      glyphRoot.userData.recipeSignature = null;
      signalRoot.add(glyphRoot);
      const variants = new Map<string, THREE.Object3D>();
      const variant = (identity: string): THREE.Group => {
        const group = new THREE.Group();
        group.name = `${name}-${identity}`;
        group.visible = false;
        group.userData.recipeIdentity = identity;
        group.userData.recipeSignature =
          processRecipeSignalSignature(identity);
        glyphRoot.add(group);
        variants.set(identity, group);
        return group;
      };

      const auto = variant('auto');
      // Automatic smelting is a bifurcated physical tool: unmistakably
      // different silver/copper ore chunks converge through one selector
      // rotor into a shared hot furnace mouth.
      this.addRoundedBox(
        auto,
        [0.34, 0.09, 0.18],
        this.materials.carbonDark,
        [0, 0.055, -0.105],
        [0, 0, 0],
        0.025,
      ).name = `${name}-auto-furnace-throat`;
      this.addRoundedBox(
        auto,
        [0.235, 0.035, 0.1],
        copperHighlightMaterial,
        [0, 0.108, -0.105],
        [0, 0, 0],
        0.012,
      ).name = `${name}-auto-molten-furnace-slot`;
      for (const [index, x] of [-0.14, 0.14].entries()) {
        this.addMesh(
          auto,
          new THREE.DodecahedronGeometry(0.09, 0),
          index === 0 ? steelDieMaterial : copperDieMaterial,
          [x, 0.17, 0.11],
          [index * 0.34, 0.4 + index * 0.5, index * 0.18],
        ).name = `${name}-auto-ore-input-${index}`;
      }
      this.addInstancedBeams(
        auto,
        amberMaterial,
        [
          {
            from: [-0.14, 0.135, 0.09] as [number, number, number],
            to: [-0.035, 0.12, 0.005] as [number, number, number],
            radius: 0.02,
          },
          {
            from: [0.14, 0.135, 0.09] as [number, number, number],
            to: [0.035, 0.12, 0.005] as [number, number, number],
            radius: 0.02,
          },
          {
            from: [0, 0.12, 0.015] as [number, number, number],
            to: [0, 0.12, -0.075] as [number, number, number],
            radius: 0.024,
          },
        ],
        8,
      ).name = `${name}-auto-converging-feed-rails`;
      this.addCylinder(
        auto,
        0.055,
        0.065,
        amberMaterial,
        [0, 0.135, 0.015],
        [0, 0, 0],
        10,
      ).name = `${name}-auto-selector-rotor`;
      this.addInstanceBatch(
        auto,
        new THREE.BoxGeometry(1, 1, 1),
        amberMaterial,
        Array.from({ length: 3 }, (_, index) => {
          const angle = index * Math.PI * 2 / 3;
          return {
            position: [
              Math.sin(angle) * 0.072,
              0.17,
              0.015 + Math.cos(angle) * 0.072,
            ] as [number, number, number],
            scale: [0.035, 0.035, 0.095] as [number, number, number],
            rotation: [0, angle, 0] as [number, number, number],
          };
        }),
      ).name = `${name}-auto-three-vane-selector`;

      const iron = variant('smeltIron');
      for (const [index, offset] of ([
        [-0.045, 0.04],
        [0, 0],
        [0.045, -0.04],
      ] as Array<[number, number]>).entries()) {
        this.addRoundedBox(
          iron,
          [0.285, 0.045, 0.17],
          index === 0 ? steelGrooveMaterial : steelDieMaterial,
          [offset[0], 0.055 + index * 0.052, offset[1]],
          [0, (index - 1) * 0.08, 0],
          0.018,
        ).name = `${name}-staggered-silver-plate-${index}`;
      }
      this.addRoundedBox(
        iron,
        [0.065, 0.018, 0.055],
        steelGrooveMaterial,
        [0.09, 0.19, -0.055],
        [0, 0.18, 0],
        0.007,
      ).name = `${name}-offset-foundry-stamp`;

      const copper = variant('smeltCopper');
      for (const [index, offset] of ([
        [-0.055, 0.045],
        [0, 0],
        [0.055, -0.045],
      ] as Array<[number, number]>).entries()) {
        this.addRoundedBox(
          copper,
          [0.27, 0.045, 0.18],
          index === 1 ? copperHighlightMaterial : copperDieMaterial,
          [offset[0], 0.055 + index * 0.052, offset[1]],
          [0, index === 1 ? 0 : (index - 1) * 0.08, 0],
          0.018,
        ).name = `${name}-stacked-copper-plate-${index}`;
      }
      this.addInstanceBatch(
        copper,
        new THREE.BoxGeometry(1, 1, 1),
        copperHighlightMaterial,
        [-0.055, 0.055].map((z) => ({
          position: [0.055, 0.188, z - 0.045] as [number, number, number],
          scale: [0.225, 0.018, 0.018] as [number, number, number],
        })),
      ).name = `${name}-polished-copper-plate-ribs`;

      const bricks = variant('fireBrick');
      this.addRoundedBox(
        bricks,
        [0.38, 0.03, 0.16],
        this.materials.carbonDark,
        [0, 0.025, 0],
        [0, 0, 0],
        0.012,
      );
      for (const [index, x] of [-0.12, 0, 0.12].entries()) {
        this.addRoundedBox(
          bricks,
          [0.108, 0.1, 0.1],
          index % 2 === 0 ? brickMaterial : brickLightMaterial,
          [x, 0.095, 0.065],
          [0, 0, 0],
          0.014,
        );
        this.addRoundedBox(
          bricks,
          [0.076, 0.012, 0.018],
          mortarMaterial,
          [x, 0.151, 0.065],
          [0, 0, 0],
          0.005,
        );
      }
      for (const [index, x] of [-0.06, 0.06].entries()) {
        this.addRoundedBox(
          bricks,
          [0.15, 0.1, 0.1],
          index === 0 ? brickLightMaterial : brickMaterial,
          [x, 0.095, -0.065],
          [0, 0, 0],
          0.014,
        );
        this.addRoundedBox(
          bricks,
          [0.105, 0.012, 0.018],
          mortarMaterial,
          [x, 0.151, -0.065],
          [0, 0, 0],
          0.005,
        );
      }
      this.addInstanceBatch(
        bricks,
        new THREE.BoxGeometry(1, 1, 1),
        mortarMaterial,
        [
          { position: [0, 0.153, 0], scale: [0.34, 0.014, 0.018] },
          { position: [-0.06, 0.155, -0.065], scale: [0.018, 0.014, 0.09] },
          { position: [0.06, 0.155, 0.065], scale: [0.018, 0.014, 0.09] },
        ],
      ).name = `${name}-firebrick-pale-mortar-bond`;

      const gear = variant('ironGear');
      const gearRing = this.addTorus(
        gear,
        0.108,
        0.038,
        steelDieMaterial,
        [0, 0.105, 0],
        [Math.PI / 2, 0, 0],
      );
      gearRing.name = `${name}-solid-gear-hub`;
      const gearTeeth = this.addInstanceBatch(
        gear,
        new THREE.BoxGeometry(1, 1, 1),
        steelDieMaterial,
        Array.from({ length: 8 }, (_, index) => {
          const angle = index * Math.PI / 4;
          return {
            position: [
              Math.sin(angle) * 0.148,
              0.105,
              Math.cos(angle) * 0.148,
            ] as [number, number, number],
            scale: [0.055, 0.07, 0.082] as [number, number, number],
            rotation: [0, angle, 0] as [number, number, number],
          };
        }),
      );
      gearTeeth.name = `${name}-solid-gear-teeth`;
      this.addCylinder(
        gear,
        0.043,
        0.19,
        steelGrooveMaterial,
        [0, 0.085, 0],
        [0, 0, 0],
        14,
      ).name = `${name}-gear-drive-shaft`;

      const wire = variant('copperWire');
      this.addCylinder(
        wire,
        0.072,
        0.26,
        copperDieMaterial,
        [0, 0.105, 0],
        [0, 0, Math.PI / 2],
        18,
      );
      for (const x of [-0.145, 0.145]) {
        this.addCylinder(
          wire,
          0.135,
          0.032,
          steelGrooveMaterial,
          [x, 0.105, 0],
          [0, 0, Math.PI / 2],
          20,
        );
      }
      for (const x of [-0.075, -0.025, 0.025, 0.075]) {
        this.addTorus(
          wire,
          0.074,
          0.021,
          copperDieMaterial,
          [x, 0.105, 0],
          [0, Math.PI / 2, 0],
        );
      }
      const board = variant('circuit');
      this.addRoundedBox(
        board,
        [0.31, 0.055, 0.225],
        boardMaterial,
        [0, 0.075, 0],
        [0, 0.08, 0],
        0.018,
      ).name = `${name}-green-board`;
      this.addRoundedBox(
        board,
        [0.105, 0.065, 0.09],
        this.materials.carbonDark,
        [0.015, 0.13, 0],
        [0, 0.08, 0],
        0.014,
      ).name = `${name}-raised-controller-chip`;
      this.addInstanceBatch(
        board,
        new THREE.BoxGeometry(1, 1, 1),
        boardTraceMaterial,
        [
          { position: [-0.09, 0.122, 0], scale: [0.03, 0.026, 0.14] },
          { position: [0.075, 0.122, -0.07], scale: [0.12, 0.026, 0.025] },
          { position: [0.075, 0.122, 0.07], scale: [0.12, 0.026, 0.025] },
        ],
      ).name = `${name}-board-traces`;
      const boardNodes = this.addInstanceBatch(
        board,
        new THREE.CylinderGeometry(1, 1, 1, 12, 1),
        boardTraceMaterial,
        [
          { position: [-0.09, 0.148, -0.07], scale: [0.04, 0.027, 0.04] },
          { position: [-0.09, 0.148, 0.07], scale: [0.04, 0.027, 0.04] },
          { position: [0.115, 0.148, 0], scale: [0.04, 0.027, 0.04] },
        ],
      );
      boardNodes.name = `${name}-three-large-board-nodes`;

      const core = variant('automationCore');
      this.addCylinder(
        core,
        0.17,
        0.055,
        boardMaterial,
        [0, 0.065, 0],
        [0, 0, 0],
        6,
      ).name = `${name}-green-hex-core-housing`;
      this.addCylinder(
        core,
        0.105,
        0.07,
        this.materials.carbonDark,
        [0, 0.11, 0],
        [0, 0, 0],
        18,
      ).name = `${name}-core-dark-stator`;
      this.addCylinder(
        core,
        0.058,
        0.13,
        coreMaterial,
        [0, 0.16, 0],
        [0, 0, 0],
        16,
      ).name = `${name}-cyan-core-rotor`;
      this.addInstancedBeams(
        core,
        boardTraceMaterial,
        Array.from({ length: 4 }, (_, index) => {
          const angle = index * Math.PI / 2;
          return {
            from: [
              Math.sin(angle) * 0.062,
              0.155,
              Math.cos(angle) * 0.062,
            ] as [number, number, number],
            to: [
              Math.sin(angle) * 0.145,
              0.115,
              Math.cos(angle) * 0.145,
            ] as [number, number, number],
            radius: 0.018,
          };
        }),
        8,
      ).name = `${name}-four-core-conductors`;
      this.addInstanceBatch(
        core,
        new THREE.CylinderGeometry(1, 1, 1, 10, 1),
        copperHighlightMaterial,
        Array.from({ length: 6 }, (_, index) => {
          const angle = index * Math.PI / 3;
          return {
            position: [
              Math.sin(angle) * 0.165,
              0.12,
              Math.cos(angle) * 0.165,
            ] as [number, number, number],
            scale: [0.025, 0.1, 0.025] as [number, number, number],
          };
        }),
      ).name = `${name}-six-core-locks`;

      return { root: glyphRoot, variants };
    };

    const currentGlyphs = buildGlyphSet('process-recipe-glyph');
    currentGlyphs.root.position.set(
      PROCESS_RECIPE_STATION_X,
      PROCESS_RECIPE_GLYPH_Y,
      PROCESS_RECIPE_STATION_Z,
    );
    rig.parts.processGlyphRoot = currentGlyphs.root;
    rig.parts.processRecipeGlyphs = currentGlyphs.variants;
    const pendingGlyphs = buildGlyphSet('process-pending-recipe-glyph');
    pendingGlyphs.root.position.set(
      PROCESS_RECIPE_PAIR_PENDING_X,
      PROCESS_RECIPE_GLYPH_Y,
      PROCESS_RECIPE_STATION_Z,
    );
    pendingGlyphs.root.visible = false;
    rig.parts.processPendingGlyphRoot = pendingGlyphs.root;
    rig.parts.processPendingRecipeGlyphs = pendingGlyphs.variants;
    rig.parts.processGlyphAuto = currentGlyphs.variants.get('auto');
    rig.parts.processGlyphIngot = currentGlyphs.variants.get('smeltIron');
    rig.parts.processGlyphBars = currentGlyphs.variants.get('fireBrick');
    rig.parts.processGlyphRing = currentGlyphs.variants.get('ironGear');
    rig.parts.processGlyphGearTeeth = currentGlyphs.variants.get('ironGear');
    rig.parts.processGlyphWireTails =
      currentGlyphs.variants.get('copperWire');
    rig.parts.processGlyphBoard = currentGlyphs.variants.get('circuit');
    rig.parts.processGlyphBoardNodes = currentGlyphs.variants.get('circuit');
    rig.parts.processGlyphCore =
      currentGlyphs.variants.get('automationCore');
    rig.parts.processGlyphCoreOrbit =
      currentGlyphs.variants.get('automationCore');

    // Empty open chuck: the pulled-back jaws expose a dark missing-tool
    // socket without introducing a crossed glyph that can read as a recipe.
    const unconfigured = new THREE.Group();
    unconfigured.name = 'process-state-unconfigured';
    unconfigured.position.set(0, 0.99, 0.1);
    signalRoot.add(unconfigured);
    this.addCylinder(
      unconfigured,
      0.085,
      0.32,
      instrumentShellMaterial,
      [0, -0.16, 0],
      [0, 0, 0],
      16,
    ).name = 'process-empty-tool-retracted-quill';
    this.addRoundedBox(
      unconfigured,
      [0.36, 0.075, 0.25],
      instrumentShellMaterial,
      [0, -0.015, 0],
      [0, 0, 0],
      0.022,
    ).name = 'process-empty-tool-load-bearing-head';
    this.addCylinder(
      unconfigured,
      0.105,
      0.07,
      this.materials.carbonDark,
      [0, 0.035, 0],
      [0, 0, 0],
      18,
    ).name = 'process-empty-tool-socket';
    this.addTorus(
      unconfigured,
      0.155,
      0.022,
      steelGrooveMaterial,
      [0, 0.075, 0],
      [Math.PI / 2, 0, 0],
    ).name = 'process-empty-tool-socket-ring';
    this.addInstanceBatch(
      unconfigured,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.titanium,
      Array.from({ length: 4 }, (_, index) => {
        const angle = index * Math.PI / 2;
        return {
          position: [
            Math.sin(angle) * 0.155,
            0.1,
            Math.cos(angle) * 0.155,
          ] as [number, number, number],
          scale: [0.105, 0.055, 0.065] as [number, number, number],
          rotation: [0, angle, 0] as [number, number, number],
        };
      }),
    ).name = 'process-empty-tool-open-jaws';
    this.addInstanceBatch(
      unconfigured,
      new THREE.CylinderGeometry(1, 1, 1, 8, 1),
      amberMaterial,
      Array.from({ length: 4 }, (_, index) => {
        const angle = index * Math.PI / 2;
        return {
          position: [
            Math.sin(angle) * 0.205,
            0.095,
            Math.cos(angle) * 0.205,
          ] as [number, number, number],
          scale: [0.018, 0.025, 0.018] as [number, number, number],
        };
      }),
    ).name = 'process-empty-tool-pulled-back-jaw-stops';
    rig.parts.processUnconfigured = unconfigured;

    // Rear input port: neutral steel makes the empty socket causal hardware,
    // while the sole amber mark is a horizontal arrow travelling from the
    // external rear contact into the machine. This prevents an empty-input
    // condition from borrowing the gold chute/claw language used by reclaim.
    const inputLatch = new THREE.Group();
    inputLatch.name = 'process-state-starved-empty-hopper';
    inputLatch.position.set(0, 0.25, 0.49);
    signalRoot.add(inputLatch);
    this.addMesh(
      inputLatch,
      new THREE.CylinderGeometry(0.245, 0.105, 0.23, 4, 1, true),
      instrumentShellMaterial,
      [0, 0.18, 0],
      [0, Math.PI / 4, 0],
    ).name = 'process-starved-open-funnel';
    this.addCylinder(
      inputLatch,
      0.085,
      0.035,
      this.materials.carbonDark,
      [0, 0.075, 0],
      [0, Math.PI / 4, 0],
      4,
    ).name = 'process-starved-visible-empty-hopper-floor';
    this.addInstanceBatch(
      inputLatch,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.titaniumLight,
      [
        { position: [0, 0.098, 0], scale: [0.18, 0.018, 0.025] },
        { position: [0, 0.1, 0], scale: [0.025, 0.018, 0.18] },
      ],
    ).name = 'process-starved-empty-hopper-floor-grate';
    this.addRoundedBox(
      inputLatch,
      [0.16, 0.14, 0.34],
      this.materials.titaniumLight,
      [0, 0.1, -0.2],
      [0, 0, 0],
      0.024,
    ).name = 'process-starved-intake-throat';
    this.addRoundedBox(
      inputLatch,
      [0.2, 0.055, 0.09],
      steelGrooveMaterial,
      [0, 0.16, -0.34],
      [0, 0, 0],
      0.015,
    ).name = 'process-starved-intake-coupler';
    this.addCylinder(
      inputLatch,
      0.115,
      0.06,
      this.materials.carbonDark,
      [0, 0.295, 0],
      [0, 0, 0],
      4,
    );
    this.addInstanceBatch(
      inputLatch,
      new THREE.CylinderGeometry(1, 1, 1, 12, 1),
      this.materials.titanium,
      [-0.095, 0.095].map((x) => ({
        position: [x, 0.19, -0.325] as [number, number, number],
        scale: [0.055, 0.035, 0.055] as [number, number, number],
        rotation: [0, 0, Math.PI / 2] as [number, number, number],
      })),
    ).name = 'process-starved-motionless-input-rollers';
    this.addInstanceBatch(
      inputLatch,
      new THREE.BoxGeometry(1, 1, 1),
      steelGrooveMaterial,
      [
        { position: [0, 0.33, -0.2], scale: [0.46, 0.07, 0.065] },
        { position: [-0.2, 0.32, 0], scale: [0.065, 0.07, 0.4] },
        { position: [0.2, 0.32, 0], scale: [0.065, 0.07, 0.4] },
        { position: [0, 0.31, 0.2], scale: [0.46, 0.07, 0.065] },
      ],
    ).name = 'process-empty-hopper-rim';
    this.addInstancedBeams(
      inputLatch,
      amberMaterial,
      [
        {
          from: [0.205, 0.35, 0.075] as [number, number, number],
          to: [0.205, 0.35, 0.005] as [number, number, number],
          radius: 0.01,
        },
        {
          from: [0.18, 0.35, 0.03] as [number, number, number],
          to: [0.205, 0.35, -0.005] as [number, number, number],
          radius: 0.01,
        },
        {
          from: [0.23, 0.35, 0.03] as [number, number, number],
          to: [0.205, 0.35, -0.005] as [number, number, number],
          radius: 0.01,
        },
      ],
      8,
    ).name = 'process-starved-rear-to-center-demand-arrow';
    rig.parts.processInputLatch = inputLatch;

    // The working pose is an actual driven chamber: a guarded steel rotor,
    // shaft, reduction wheel, and belt all share one load path. Green survives
    // only as a narrow inspection ring, so the mechanism—not a propeller
    // pictogram—carries the state.
    const chamberPulse = new THREE.Group();
    chamberPulse.name = 'process-state-working-driven-impeller';
    chamberPulse.position.set(0, 0.67, 0.1);
    signalRoot.add(chamberPulse);
    const isFabricatorWorkingChamber = rig.kind === 'fabricator';
    const workingRecipe = rig.entity.processRecipe ?? rig.entity.recipe ?? null;
    this.addRoundedBox(
      chamberPulse,
      isFabricatorWorkingChamber ? [0.6, 0.115, 0.5] : [0.56, 0.1, 0.48],
      instrumentShellMaterial,
      [0, -0.035, 0],
      [0, 0, 0],
      0.035,
    ).name = 'process-working-load-bearing-chamber-cradle';
    if (isFabricatorWorkingChamber) {
      this.addInstanceBatch(
        chamberPulse,
        new RoundedBoxGeometry(1, 1, 1, 3, 0.12),
        instrumentShellMaterial,
        [
          { position: [-0.245, 0.13, 0], scale: [0.085, 0.085, 0.35] },
          { position: [0.245, 0.13, 0.015], scale: [0.085, 0.085, 0.32] },
          { position: [0, 0.13, 0.205], scale: [0.43, 0.085, 0.075] },
        ],
      ).name = 'fabricator-working-u-shaped-captured-chamber-shroud';
      this.addInstanceBatch(
        chamberPulse,
        new THREE.BoxGeometry(1, 1, 1),
        this.materials.titaniumLight,
        [
          { position: [-0.205, 0.18, 0.165], scale: [0.018, 0.014, 0.04] },
          { position: [0.205, 0.18, 0.165], scale: [0.018, 0.014, 0.04] },
          { position: [-0.245, 0.18, -0.12], scale: [0.035, 0.014, 0.018] },
          { position: [0.245, 0.18, -0.1], scale: [0.035, 0.014, 0.018] },
        ],
      ).name = 'fabricator-working-shroud-rubbed-fastener-tabs';
    }
    this.addCylinder(
      chamberPulse,
      isFabricatorWorkingChamber ? 0.218 : 0.245,
      0.105,
      isFabricatorWorkingChamber
        ? steelGrooveMaterial
        : this.materials.carbonDark,
      [0, 0.025, 0],
      [0, 0, 0],
      20,
    ).name = 'process-working-guarded-driven-chamber';
    this.addTorus(
      chamberPulse,
      isFabricatorWorkingChamber ? 0.205 : 0.222,
      isFabricatorWorkingChamber ? 0.026 : 0.022,
      this.materials.titanium,
      [0, 0.085, 0],
      isFabricatorWorkingChamber
        ? [Math.PI / 2, 0, -0.68]
        : [Math.PI / 2, 0, 0],
      isFabricatorWorkingChamber ? Math.PI * 1.52 : Math.PI * 2,
    ).name = 'process-working-bolted-chamber-guard-ring';
    const drivenRotor = new THREE.Group();
    drivenRotor.name = 'process-working-driven-rotor';
    drivenRotor.position.y = 0.09;
    chamberPulse.add(drivenRotor);
    this.addInstancedBeams(
      drivenRotor,
      this.materials.titaniumLight,
      Array.from({ length: isFabricatorWorkingChamber ? 5 : 6 }, (_, index) => {
        const vaneCount = isFabricatorWorkingChamber ? 5 : 6;
        const angle = index * Math.PI * 2 / vaneCount;
        return {
          from: [0, 0, 0] as [number, number, number],
          to: [
            Math.sin(angle) * 0.155,
            0,
            Math.cos(angle) * 0.155,
          ] as [number, number, number],
          radius: 0.021,
        };
      }),
      8,
    ).name = 'process-working-open-impeller-spokes';
    this.addInstanceBatch(
      drivenRotor,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.titaniumLight,
      Array.from({ length: isFabricatorWorkingChamber ? 5 : 6 }, (_, index) => {
        const vaneCount = isFabricatorWorkingChamber ? 5 : 6;
        const angle = index * Math.PI * 2 / vaneCount;
        return {
          position: [
            Math.sin(angle) * 0.165,
            0,
            Math.cos(angle) * 0.165,
          ] as [number, number, number],
          scale: [0.075, 0.045, 0.05] as [number, number, number],
          rotation: [0, angle + Math.PI / 2, 0] as [number, number, number],
        };
      }),
    ).name = 'process-working-six-driven-vanes';
    const workingCoreMaterial =
      workingRecipe === 'ironGear'
        ? steelDieMaterial
        : workingRecipe === 'copperWire'
          ? this.materials.copperBright
          : workingRecipe === 'circuit'
            ? boardMaterial
            : workingRecipe === 'automationCore'
              ? coreMaterial
              : this.materials.copperBright;
    this.addCylinder(
      drivenRotor,
      isFabricatorWorkingChamber && workingRecipe === 'copperWire'
        ? 0.045
        : isFabricatorWorkingChamber
          ? 0.072
          : 0.065,
      0.055,
      workingCoreMaterial,
      [0, 0.02, 0],
      [0, 0, 0],
      14,
    ).name = 'process-working-driven-core';
    if (isFabricatorWorkingChamber && workingRecipe === 'ironGear') {
      this.addInstanceBatch(
        drivenRotor,
        new THREE.BoxGeometry(1, 1, 1),
        steelDieMaterial,
        Array.from({ length: 8 }, (_, index) => {
          const angle = index * Math.PI / 4;
          return {
            position: [
              Math.sin(angle) * 0.092,
              0.052,
              Math.cos(angle) * 0.092,
            ] as [number, number, number],
            scale: [0.035, 0.025, 0.045] as [number, number, number],
            rotation: [0, angle, 0] as [number, number, number],
          };
        }),
      ).name = 'fabricator-working-steel-gear-blank-eight-index-teeth';
    } else if (isFabricatorWorkingChamber && workingRecipe === 'copperWire') {
      this.addCylinder(
        drivenRotor,
        0.052,
        0.15,
        copperHighlightMaterial,
        [0, 0.052, 0],
        [0, 0, Math.PI / 2],
        16,
      ).name = 'fabricator-working-copper-draw-pack-barrel';
      for (const x of [-0.068, 0.068]) {
        this.addTorus(
          drivenRotor,
          0.065,
          0.014,
          copperHighlightMaterial,
          [x, 0.052, 0],
          [0, Math.PI / 2, 0],
        ).name = 'fabricator-working-copper-draw-pack-flange';
      }
      this.addInstancedBeams(
        drivenRotor,
        copperHighlightMaterial,
        [
          { from: [0.07, 0.052, 0.015], to: [0.16, 0.052, -0.11], radius: 0.012 },
        ],
        8,
      ).name = 'fabricator-working-copper-strand-to-die';
    } else if (isFabricatorWorkingChamber && workingRecipe === 'circuit') {
      this.addRoundedBox(
        drivenRotor,
        [0.15, 0.025, 0.11],
        boardMaterial,
        [0, 0.052, 0],
        [0, 0.14, 0],
        0.015,
      ).name = 'fabricator-working-circuit-index-board';
    } else if (
      isFabricatorWorkingChamber
      && workingRecipe === 'automationCore'
    ) {
      this.addMesh(
        drivenRotor,
        new THREE.OctahedronGeometry(0.085, 0),
        coreMaterial,
        [0, 0.075, 0],
        [0, Math.PI / 4, 0],
      ).name = 'fabricator-working-automation-core-witness';
    }
    this.addTorus(
      chamberPulse,
      isFabricatorWorkingChamber ? 0.17 : 0.185,
      0.011,
      tealMaterial,
      [0, 0.123, 0],
      isFabricatorWorkingChamber
        ? [Math.PI / 2, 0, -0.48]
        : [Math.PI / 2, 0, 0],
      isFabricatorWorkingChamber ? Math.PI * 1.38 : Math.PI * 2,
    ).name = 'process-working-narrow-live-inspection-ring';
    this.addCylinder(
      chamberPulse,
      0.078,
      0.075,
      this.materials.titanium,
      [0.29, 0.055, 0.04],
      [0, 0, 0],
      14,
    ).name = 'process-working-reduction-wheel';
    this.addTorus(
      chamberPulse,
      0.075,
      0.014,
      this.materials.copper,
      [0.29, 0.098, 0.04],
      [Math.PI / 2, 0, 0],
    ).name = 'process-working-reduction-wheel-band';
    this.addInstancedBeams(
      chamberPulse,
      this.materials.rubber,
      [
        { from: [0.185, 0.115, -0.035], to: [0.29, 0.115, -0.035], radius: 0.012 },
        { from: [0.185, 0.115, 0.115], to: [0.29, 0.115, 0.115], radius: 0.012 },
      ],
      7,
    ).name = 'process-working-visible-drive-belt';
    rig.parts.processChamberPulse = chamberPulse;

    // Queue port: the two recipe spindles are joined by one static one-way
    // transfer bridge. It states current -> pending without motion that could
    // be mistaken for active production.
    const queueBridge = new THREE.Group();
    queueBridge.name = 'process-state-queued-static-tool-bridge';
    queueBridge.position.set(
      (PROCESS_RECIPE_PAIR_CURRENT_X + PROCESS_RECIPE_PAIR_PENDING_X) * 0.5,
      1.075,
      PROCESS_RECIPE_STATION_Z,
    );
    signalRoot.add(queueBridge);
    this.addRoundedBox(
      queueBridge,
      [0.43, 0.07, 0.18],
      instrumentShellMaterial,
      [0, -0.055, 0],
      [0, 0, 0],
      0.02,
    ).name = 'process-queue-two-station-cast-bridge';
    this.addInstanceBatch(
      queueBridge,
      new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
      this.materials.titanium,
      [
        { position: [-0.155, -0.005, 0], scale: [0.12, 0.065, 0.16] },
        { position: [0.155, -0.005, 0], scale: [0.12, 0.065, 0.16] },
      ],
    ).name = 'process-queue-current-and-pending-tool-saddles';
    this.addInstanceBatch(
      queueBridge,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.titaniumLight,
      [
        { position: [0, 0.045, 0], scale: [0.25, 0.035, 0.045] },
        {
          position: [0.075, 0.055, 0],
          scale: [0.055, 0.06, 0.09],
        },
      ],
    ).name = 'process-queue-static-one-way-rail';
    const queueShuttle = this.addRoundedBox(
      queueBridge,
      [0.065, 0.06, 0.12],
      steelGrooveMaterial,
      [-0.145, 0.005, 0],
      [0, 0, 0],
      0.014,
    );
    queueShuttle.name = 'process-queue-current-tool-stop';
    this.addRoundedBox(
      queueBridge,
      [0.065, 0.08, 0.12],
      amberMaterial,
      [0.145, 0.055, 0],
      [0, 0, 0],
      0.014,
    ).name = 'process-queue-pending-tool-stop';
    this.addInstancedBeams(
      queueBridge,
      this.materials.titaniumLight,
      [
        { from: [-0.155, -0.04, 0], to: [-0.155, -0.25, 0], radius: 0.018 },
        { from: [0.155, -0.04, 0], to: [0.155, -0.25, 0], radius: 0.018 },
      ],
      8,
    ).name = 'process-queue-bridge-load-posts';
    this.addInstanceBatch(
      queueBridge,
      new THREE.BoxGeometry(1, 1, 1),
      amberMaterial,
      [-0.075, 0, 0.075].map((x) => ({
        position: [x, 0.082, 0] as [number, number, number],
        scale: [0.028, 0.025, 0.065] as [number, number, number],
      })),
    ).name = 'process-queue-three-indexing-dogs';
    queueBridge.userData.pendingRecipe = null;
    rig.parts.processQueueBridge = queueBridge;
    rig.parts.processQueueShuttle = queueShuttle;

    // Front output port: a visibly full crate lifted above the belt behind a
    // red overhead stop gate. The obstruction cannot be hidden by transport.
    const outputGate = new THREE.Group();
    outputGate.name = 'process-state-output-blocked-full-crate';
    outputGate.position.set(0, 0.28, -0.58);
    signalRoot.add(outputGate);
    this.addRoundedBox(
      outputGate,
      [0.52, 0.11, 0.34],
      instrumentShellMaterial,
      [0, 0.135, 0.06],
      [0, 0, 0],
      0.024,
    ).name = 'process-output-full-discharge-chute';
    this.addInstanceBatch(
      outputGate,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.titanium,
      [
        { position: [-0.245, 0.23, 0.06], scale: [0.045, 0.19, 0.34] },
        { position: [0.245, 0.23, 0.06], scale: [0.045, 0.19, 0.34] },
      ],
    ).name = 'process-output-full-chute-side-rails';
    const outputContents: Array<{
      x: number;
      z: number;
      material: THREE.MeshStandardMaterial;
    }> = [];
    for (const [row, z] of [-0.045, 0.045].entries()) {
      for (const [column, x] of [-0.16, 0, 0.16].entries()) {
        outputContents.push({
          x,
          z,
          material: (row + column) % 2 === 0
            ? steelDieMaterial
            : steelGrooveMaterial,
        });
      }
    }
    for (const [index, content] of outputContents.entries()) {
      this.addRoundedBox(
        outputGate,
        [0.14, 0.085, 0.075],
        content.material,
        [content.x, 0.26 + (index % 2) * 0.014, content.z + 0.06],
        [0, (index - 1) * 0.12, 0],
        0.018,
      ).name = `process-output-full-token-${index}`;
    }
    this.addInstanceBatch(
      outputGate,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.titanium,
      [
        { position: [-0.275, 0.36, -0.1], scale: [0.06, 0.54, 0.06] },
        { position: [0.275, 0.36, -0.1], scale: [0.06, 0.54, 0.06] },
        { position: [0, 0.61, -0.1], scale: [0.61, 0.07, 0.07] },
      ],
    ).name = 'process-output-overhead-stop-gate';
    this.addRoundedBox(
      outputGate,
      [0.57, 0.085, 0.09],
      redMaterial,
      [0, 0.43, -0.1],
      [0, 0, 0],
      0.012,
    ).name = 'process-output-lowered-guillotine';
    this.addInstanceBatch(
      outputGate,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.carbonDark,
      [-0.16, 0, 0.16].map((x) => ({
        position: [x, 0.43, -0.148] as [number, number, number],
        scale: [0.04, 0.11, 0.026] as [number, number, number],
        rotation: [0, 0, 0.42] as [number, number, number],
      })),
    ).name = 'process-output-full-gate-stripes';
    rig.parts.processOutputGate = outputGate;

    const powerBreaker = new THREE.Group();
    powerBreaker.name = 'process-state-no-power-disconnected-plug';
    powerBreaker.position.set(-0.36, 0.25, 0);
    signalRoot.add(powerBreaker);
    this.addRoundedBox(
      powerBreaker,
      [0.24, 0.44, 0.36],
      instrumentShellMaterial,
      [0.08, 0.25, 0],
      [0, 0, 0],
      0.035,
    ).name = 'process-power-wall-socket';
    this.addRoundedBox(
      powerBreaker,
      [0.045, 0.27, 0.25],
      this.materials.ceramicDark,
      [-0.055, 0.28, 0],
      [0, 0, 0],
      0.014,
    ).name = 'process-power-insulated-socket-bezel';
    this.addRoundedBox(
      powerBreaker,
      [0.18, 0.16, 0.27],
      this.materials.titanium,
      [-0.24, 0.28, 0],
      [0, 0, -0.16],
      0.028,
    ).name = 'process-power-disconnected-plug-body';
    this.addRoundedBox(
      powerBreaker,
      [0.08, 0.045, 0.18],
      redMaterial,
      [-0.27, 0.375, 0],
      [0, 0, -0.16],
      0.012,
    ).name = 'process-power-dead-plug-lockout-tab';
    this.addInstanceBatch(
      powerBreaker,
      new THREE.BoxGeometry(1, 1, 1),
      steelDieMaterial,
      [
        {
          position: [-0.125, 0.28, -0.07],
          scale: [0.08, 0.045, 0.045],
        },
        {
          position: [-0.125, 0.28, 0.07],
          scale: [0.08, 0.045, 0.045],
        },
      ],
    ).name = 'process-power-separated-prongs';
    this.addInstanceBatch(
      powerBreaker,
      new THREE.CylinderGeometry(1, 1, 1, 12, 1),
      this.materials.rubber,
      [
        {
          position: [-0.055, 0.28, -0.07],
          scale: [0.045, 0.026, 0.045],
          rotation: [0, 0, Math.PI / 2],
        },
        {
          position: [-0.055, 0.28, 0.07],
          scale: [0.045, 0.026, 0.045],
          rotation: [0, 0, Math.PI / 2],
        },
      ],
    ).name = 'process-power-open-socket-holes';
    this.addInstancedBeams(
      powerBreaker,
      this.materials.rubber,
      [
        {
          from: [-0.33, 0.28, 0] as [number, number, number],
          to: [-0.43, 0.25, -0.08] as [number, number, number],
          radius: 0.035,
        },
        {
          from: [-0.43, 0.28, -0.09] as [number, number, number],
          to: [-0.5, 0.2, -0.01] as [number, number, number],
          radius: 0.035,
        },
      ],
      8,
    ).name = 'process-power-dead-cable';
    this.addInstancedBeams(
      powerBreaker,
      steelGrooveMaterial,
      [
        {
          from: [0.015, 0.52, 0.11] as [number, number, number],
          to: [0.08, 0.52, 0.03] as [number, number, number],
          radius: 0.018,
        },
        {
          from: [0.08, 0.52, 0.03] as [number, number, number],
          to: [0.08, 0.52, -0.03] as [number, number, number],
          radius: 0.018,
        },
        {
          from: [0.08, 0.52, -0.03] as [number, number, number],
          to: [0.145, 0.52, -0.11] as [number, number, number],
          radius: 0.018,
        },
      ],
      8,
    ).name = 'process-no-power-broken-lightning-bolt';
    this.addRoundedBox(
      powerBreaker,
      [0.22, 0.04, 0.055],
      redMaterial,
      [0.015, 0.555, 0],
      [0, -0.42, 0],
      0.009,
    ).name = 'process-no-power-lightning-break';
    this.addCylinder(
      powerBreaker,
      0.038,
      0.065,
      this.materials.titaniumLight,
      [0.11, 0.55, 0.1],
      [0, 0, 0],
      10,
    ).name = 'process-power-open-knife-breaker-pivot';
    rig.parts.processPowerBreaker = powerBreaker;

    // Idle is one mechanically parked control lever in a hard detent. A single
    // neutral silhouette avoids the twin-node/green-lamp language reserved
    // for queues and live production.
    const idleReady = new THREE.Group();
    idleReady.name = 'process-state-idle-parked-control-lever';
    idleReady.position.set(0, 0.42, -0.43);
    signalRoot.add(idleReady);
    this.addRoundedBox(
      idleReady,
      [0.38, 0.09, 0.24],
      instrumentShellMaterial,
      [0, 0.08, 0],
      [0, 0, 0],
      0.026,
    );
    this.addRoundedBox(
      idleReady,
      [0.3, 0.035, 0.16],
      this.materials.carbonDark,
      [0.01, 0.135, 0],
      [0, 0, 0],
      0.012,
    ).name = 'process-idle-neutral-lever-slot';
    this.addRoundedBox(
      idleReady,
      [0.13, 0.18, 0.12],
      this.materials.titanium,
      [-0.11, 0.18, 0],
      [0, 0, 0],
      0.018,
    ).name = 'process-idle-lever-detent';
    this.addInstancedBeams(
      idleReady,
      this.materials.titaniumLight,
      [
        {
          from: [-0.1, 0.22, -0.06] as [number, number, number],
          to: [0.14, 0.22, 0.07] as [number, number, number],
          radius: 0.03,
        },
      ],
      10,
    ).name = 'process-idle-horizontal-docked-lever-arm';
    this.addRoundedBox(
      idleReady,
      [0.13, 0.065, 0.1],
      amberMaterial,
      [0.155, 0.22, 0.078],
      [0, -0.5, 0],
      0.016,
    ).name = 'process-idle-dark-docked-handle';
    this.addRoundedBox(
      idleReady,
      [0.09, 0.12, 0.14],
      this.materials.titanium,
      [0.15, 0.145, 0.078],
      [0, 0, 0],
      0.016,
    ).name = 'process-idle-handle-catch';
    this.addCylinder(
      idleReady,
      0.055,
      0.08,
      this.materials.titaniumLight,
      [-0.1, 0.22, -0.06],
      [Math.PI / 2, 0, 0],
      12,
    ).name = 'process-idle-lever-pivot';
    this.addInstanceBatch(
      idleReady,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.titanium,
      [0.02, 0.135].map((z) => ({
        position: [0.15, 0.315, z] as [number, number, number],
        scale: [0.08, 0.045, 0.045] as [number, number, number],
      })),
    ).name = 'process-idle-twin-parked-stop-bars';
    this.addInstancedBeams(
      idleReady,
      this.materials.rubber,
      [
        { from: [-0.1, 0.18, 0.08], to: [-0.1, -0.05, 0.16], radius: 0.014 },
        { from: [-0.1, -0.05, 0.16], to: [0, -0.16, 0.18], radius: 0.014 },
      ],
      7,
    ).name = 'process-idle-parked-clutch-linkage';
    rig.parts.processIdleReady = idleReady;

    // Every state also drives one compact mechanical witness at a fixed
    // machine-relative mast. Port hardware remains causal and full-size, while
    // this shared anchor keeps the seven mutually exclusive poses readable
    // through belts, recipe tooling, queue pairs, and reclaim overlays.
    this.addInstancedBeams(
      signalRoot,
      this.materials.titaniumLight,
      [
        {
          from: [-0.44, 0.58, -0.34] as [number, number, number],
          to: [-0.44, 1.08, -0.34] as [number, number, number],
          radius: 0.032,
        },
        {
          from: [-0.44, 0.68, -0.34] as [number, number, number],
          to: [-0.3, 0.58, -0.2] as [number, number, number],
          radius: 0.024,
        },
      ],
      8,
    ).name = 'process-state-witness-mast';
    const witnessRoot = new THREE.Group();
    witnessRoot.name = 'process-state-fixed-witness-root';
    witnessRoot.position.set(-0.44, 1.08, -0.34);
    signalRoot.add(witnessRoot);
    this.addCylinder(
      witnessRoot,
      0.14,
      0.055,
      instrumentShellMaterial,
      [0, -0.018, 0],
      [0, 0, 0],
      16,
    ).name = 'process-state-witness-physical-pedestal';
    this.addRoundedBox(
      witnessRoot,
      [0.3, 0.065, 0.25],
      instrumentShellMaterial,
      [0, -0.07, 0],
      [0, 0, 0],
      0.02,
    ).name = 'process-state-witness-integrated-cast-housing';
    this.addInstancedBeams(
      witnessRoot,
      this.materials.titanium,
      [
        { from: [-0.14, -0.04, -0.11], to: [-0.14, 0.19, -0.11], radius: 0.014 },
        { from: [0.14, -0.04, -0.11], to: [0.14, 0.19, -0.11], radius: 0.014 },
        { from: [-0.14, 0.19, -0.11], to: [0.14, 0.19, -0.11], radius: 0.014 },
      ],
      8,
    ).name = 'process-state-witness-protective-guard';
    const witnesses = new Map<RenderProcessState, THREE.Object3D>();
    const witness = (state: RenderProcessState): THREE.Group => {
      const group = new THREE.Group();
      group.name = `process-state-witness-${state}`;
      group.visible = false;
      witnessRoot.add(group);
      witnesses.set(state, group);
      return group;
    };

    const emptyWitness = witness('unconfigured');
    this.addCylinder(
      emptyWitness,
      0.074,
      0.045,
      this.materials.carbonDark,
      [0, 0.02, 0],
      [0, 0, 0],
      14,
    );
    this.addTorus(
      emptyWitness,
      0.1,
      0.018,
      steelGrooveMaterial,
      [0, 0.05, 0],
      [Math.PI / 2, 0, 0],
    );
    this.addInstanceBatch(
      emptyWitness,
      new THREE.BoxGeometry(1, 1, 1),
      amberMaterial,
      Array.from({ length: 4 }, (_, index) => {
        const angle = index * Math.PI / 2;
        return {
          position: [
            Math.sin(angle) * 0.095,
            0.072,
            Math.cos(angle) * 0.095,
          ] as [number, number, number],
          scale: [0.064, 0.035, 0.04] as [number, number, number],
          rotation: [0, angle, 0] as [number, number, number],
        };
      }),
    );

    const starvedWitness = witness('starved');
    this.addRoundedBox(
      starvedWitness,
      [0.19, 0.055, 0.16],
      instrumentShellMaterial,
      [0, 0.03, 0],
      [0, 0, 0],
      0.014,
    );
    this.addMesh(
      starvedWitness,
      new THREE.CylinderGeometry(0.13, 0.06, 0.12, 4, 1, true),
      this.materials.titanium,
      [0, 0.145, 0],
      [0, Math.PI / 4, 0],
    ).name = 'process-starved-witness-open-square-funnel';
    this.addInstanceBatch(
      starvedWitness,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.titaniumLight,
      [
        { position: [0, 0.09, -0.09], scale: [0.23, 0.035, 0.035] },
        { position: [0, 0.09, 0.09], scale: [0.23, 0.035, 0.035] },
        { position: [-0.105, 0.09, 0], scale: [0.035, 0.035, 0.18] },
        { position: [0.105, 0.09, 0], scale: [0.035, 0.035, 0.18] },
      ],
    ).name = 'process-starved-witness-open-hopper-rim';
    this.addCylinder(
      starvedWitness,
      0.052,
      0.022,
      this.materials.carbonDark,
      [0, 0.085, 0],
      [0, Math.PI / 4, 0],
      4,
    ).name = 'process-starved-witness-visible-empty-floor';
    this.addInstancedBeams(
      starvedWitness,
      amberMaterial,
      [
        {
          from: [0.092, 0.175, 0.025] as [number, number, number],
          to: [0.092, 0.175, -0.025] as [number, number, number],
          radius: 0.009,
        },
        {
          from: [0.074, 0.175, -0.005] as [number, number, number],
          to: [0.092, 0.175, -0.03] as [number, number, number],
          radius: 0.009,
        },
      ],
      8,
    ).name = 'process-starved-witness-empty-hopper-chevron';
    starvedWitness.scale.setScalar(1.12);

    const workingWitness = witness('working');
    this.addCylinder(
      workingWitness,
      0.045,
      0.065,
      this.materials.copperBright,
      [0, 0.045, 0],
      [0, 0, 0],
      12,
    );
    this.addInstancedBeams(
      workingWitness,
      this.materials.titaniumLight,
      Array.from({ length: 3 }, (_, index) => {
        const angle = index * Math.PI * 2 / 3;
        return {
          from: [0, 0.07, 0] as [number, number, number],
          to: [
            Math.sin(angle) * 0.105,
            0.07,
            Math.cos(angle) * 0.105,
          ] as [number, number, number],
          radius: 0.018,
        };
      }),
      8,
    );
    this.addInstanceBatch(
      workingWitness,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.titaniumLight,
      Array.from({ length: 3 }, (_, index) => {
        const angle = index * Math.PI * 2 / 3;
        return {
          position: [
            Math.sin(angle) * 0.105,
            0.07,
            Math.cos(angle) * 0.105,
          ] as [number, number, number],
          scale: [0.075, 0.04, 0.035] as [number, number, number],
          rotation: [0, angle + Math.PI / 2, 0] as [number, number, number],
        };
      }),
    ).name = 'process-working-witness-open-three-vane-rotor';
    this.addTorus(
      workingWitness,
      0.11,
      0.011,
      tealMaterial,
      [0, 0.09, 0],
      [Math.PI / 2, 0, 0],
    ).name = 'process-working-witness-narrow-live-ring';

    const queuedWitness = witness('queued');
    this.addRoundedBox(
      queuedWitness,
      [0.09, 0.06, 0.09],
      steelGrooveMaterial,
      [-0.075, 0.03, 0],
      [0, 0, 0],
      0.012,
    );
    this.addRoundedBox(
      queuedWitness,
      [0.09, 0.06, 0.09],
      amberMaterial,
      [0.075, 0.03, 0],
      [0, 0, 0],
      0.012,
    );
    this.addInstancedBeams(
      queuedWitness,
      amberMaterial,
      [
        {
          from: [-0.02, 0.075, 0] as [number, number, number],
          to: [0.035, 0.075, 0] as [number, number, number],
          radius: 0.018,
        },
        {
          from: [0.005, 0.075, -0.04] as [number, number, number],
          to: [0.045, 0.075, 0] as [number, number, number],
          radius: 0.018,
        },
        {
          from: [0.005, 0.075, 0.04] as [number, number, number],
          to: [0.045, 0.075, 0] as [number, number, number],
          radius: 0.018,
        },
      ],
      8,
    ).name = 'process-queued-witness-square-current-to-pending-arrow';
    queuedWitness.scale.setScalar(1.2);

    const blockedWitness = witness('output-blocked');
    this.addRoundedBox(
      blockedWitness,
      [0.2, 0.06, 0.16],
      this.materials.carbonDark,
      [0, 0.03, 0],
      [0, 0, 0],
      0.014,
    );
    for (const x of [-0.055, 0, 0.055]) {
      this.addRoundedBox(
        blockedWitness,
        [0.05, 0.055, 0.07],
        x === 0 ? steelGrooveMaterial : steelDieMaterial,
        [x, 0.085, 0],
        [0, 0, 0],
        0.008,
      );
    }
    this.addRoundedBox(
      blockedWitness,
      [0.25, 0.055, 0.05],
      redMaterial,
      [0, 0.16, -0.075],
      [0, 0, 0],
      0.01,
    );

    const noPowerWitness = witness('no-power');
    this.addRoundedBox(
      noPowerWitness,
      [0.095, 0.07, 0.16],
      this.materials.carbonDark,
      [0.07, 0.04, 0],
      [0, 0, 0],
      0.014,
    );
    this.addRoundedBox(
      noPowerWitness,
      [0.09, 0.07, 0.14],
      redMaterial,
      [-0.105, 0.04, 0],
      [0, 0, 0],
      0.014,
    );
    this.addInstanceBatch(
      noPowerWitness,
      new THREE.BoxGeometry(1, 1, 1),
      steelDieMaterial,
      [-0.035, 0.035].map((z) => ({
        position: [-0.035, 0.052, z] as [number, number, number],
        scale: [0.055, 0.026, 0.026] as [number, number, number],
      })),
    ).name = 'process-no-power-witness-separated-prongs';
    this.addInstanceBatch(
      noPowerWitness,
      new THREE.CylinderGeometry(1, 1, 1, 10, 1),
      this.materials.rubber,
      [-0.035, 0.035].map((z) => ({
        position: [0.012, 0.052, z] as [number, number, number],
        scale: [0.027, 0.02, 0.027] as [number, number, number],
        rotation: [0, 0, Math.PI / 2] as [number, number, number],
      })),
    ).name = 'process-no-power-witness-empty-socket-holes';
    this.addInstancedBeams(
      noPowerWitness,
      this.materials.rubber,
      [
        {
          from: [-0.145, 0.04, 0] as [number, number, number],
          to: [-0.225, 0.025, -0.04] as [number, number, number],
          radius: 0.018,
        },
      ],
      8,
    ).name = 'process-no-power-witness-trailing-cable';
    this.addInstancedBeams(
      noPowerWitness,
      amberMaterial,
      [
        {
          from: [-0.075, 0.16, 0.1] as [number, number, number],
          to: [0.025, 0.16, 0.02] as [number, number, number],
          radius: 0.022,
        },
        {
          from: [0.025, 0.16, 0.02] as [number, number, number],
          to: [-0.025, 0.16, -0.02] as [number, number, number],
          radius: 0.022,
        },
        {
          from: [-0.025, 0.16, -0.02] as [number, number, number],
          to: [0.075, 0.16, -0.1] as [number, number, number],
          radius: 0.022,
        },
      ],
      8,
    ).name = 'process-no-power-witness-broken-lightning';
    noPowerWitness.scale.setScalar(1.18);

    const idleWitness = witness('idle');
    this.addRoundedBox(
      idleWitness,
      [0.18, 0.045, 0.14],
      this.materials.carbonDark,
      [0, 0.02, 0],
      [0, 0, 0],
      0.012,
    );
    this.addInstanceBatch(
      idleWitness,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.titanium,
      [-0.005, 0.085].map((z) => ({
        position: [0.075, 0.095, z] as [number, number, number],
        scale: [0.05, 0.065, 0.035] as [number, number, number],
      })),
    ).name = 'process-idle-witness-twin-parked-stop-bars';
    this.addInstancedBeams(
      idleWitness,
      this.materials.titaniumLight,
      [
        {
          from: [-0.075, 0.105, -0.06] as [number, number, number],
          to: [0.065, 0.105, 0.055] as [number, number, number],
          radius: 0.018,
        },
      ],
      8,
    ).name = 'process-idle-witness-parked-lever';
    this.addRoundedBox(
      idleWitness,
      [0.065, 0.045, 0.07],
      amberMaterial,
      [0.09, 0.105, 0.075],
      [0, -0.45, 0],
      0.01,
    ).name = 'process-idle-witness-docked-handle';
    this.addCylinder(
      idleWitness,
      0.03,
      0.045,
      this.materials.titaniumLight,
      [-0.075, 0.105, -0.06],
      [0, 0, 0],
      10,
    ).name = 'process-idle-witness-lever-pivot';
    idleWitness.scale.setScalar(1.15);
    rig.parts.processStateWitnessRoot = witnessRoot;
    rig.parts.processStateWitnesses = witnesses;

    // Reclaim remains orthogonal: a fixed red scrap skip receives a short
    // reverse-flow chute and separated extraction claw. The recycling mark is
    // a small stamped plate on the bin, never a floating roof-sized emblem.
    const reclaimBin = new THREE.Group();
    reclaimBin.name = 'process-reclaim-loose-material-bin';
    reclaimBin.position.set(0.72, 0.18, 0.18);
    signalRoot.add(reclaimBin);
    this.addRoundedBox(
      reclaimBin,
      [0.46, 0.13, 0.44],
      redMaterial,
      [0, 0.095, 0],
      [0, 0, -0.08],
      0.024,
    );
    this.addInstanceBatch(
      reclaimBin,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.titaniumLight,
      [-0.18, 0.18].map((z) => ({
        position: [0, 0.25, z] as [number, number, number],
        scale: [0.46, 0.34, 0.045] as [number, number, number],
        rotation: [0, 0, -0.08] as [number, number, number],
      })),
    );
    this.addRoundedBox(
      reclaimBin,
      [0.045, 0.34, 0.44],
      this.materials.titaniumLight,
      [0.205, 0.25, 0],
      [0, 0, -0.08],
      0.012,
    );
    this.addInstanceBatch(
      reclaimBin,
      new THREE.BoxGeometry(1, 1, 1),
      steelGrooveMaterial,
      [
        { position: [0, 0.18, -0.18], scale: [0.42, 0.03, 0.04] },
        { position: [0, 0.18, 0.18], scale: [0.42, 0.03, 0.04] },
        { position: [0.195, 0.18, 0], scale: [0.04, 0.03, 0.4] },
      ],
    ).name = 'process-reclaim-bin-rim';
    this.addInstanceBatch(
      reclaimBin,
      new THREE.BoxGeometry(1, 1, 1),
      amberMaterial,
      [-0.155, 0, 0.155].map((x, index) => ({
        position: [x, 0.39, 0.205] as [number, number, number],
        scale: [0.075, 0.055, 0.045] as [number, number, number],
        rotation: [
          0,
          0,
          index % 2 === 0 ? -0.16 : 0.16,
        ] as [number, number, number],
      })),
    ).name = 'process-reclaim-hazard-rim';
    this.addRoundedBox(
      reclaimBin,
      [0.42, 0.08, 0.13],
      this.materials.titaniumLight,
      [-0.29, 0.44, -0.1],
      [0, -0.28, -0.28],
      0.018,
    ).name = 'process-reclaim-reverse-flow-chute';
    this.addRoundedBox(
      reclaimBin,
      [0.22, 0.1, 0.18],
      amberMaterial,
      [-0.19, 0.5, -0.07],
      [0, -0.28, -0.28],
      0.02,
    ).name = 'process-reclaim-chute-direction-collar';
    this.addInstancedBeams(
      reclaimBin,
      this.materials.titaniumLight,
      [
        {
          from: [0.205, 0.18, 0.16] as [number, number, number],
          to: [0.205, 0.65, 0.16] as [number, number, number],
          radius: 0.027,
        },
        {
          from: [0.205, 0.65, 0.16] as [number, number, number],
          to: [-0.03, 0.65, 0.06] as [number, number, number],
          radius: 0.027,
        },
        {
          from: [-0.03, 0.65, 0.06] as [number, number, number],
          to: [-0.03, 0.48, 0.06] as [number, number, number],
          radius: 0.022,
        },
      ],
      8,
    ).name = 'process-reclaim-steel-crane-support';
    this.addInstancedBeams(
      reclaimBin,
      amberMaterial,
      [
        {
          from: [-0.03, 0.48, 0.06] as [number, number, number],
          to: [-0.13, 0.35, -0.045] as [number, number, number],
          radius: 0.025,
        },
        {
          from: [-0.13, 0.35, -0.045] as [number, number, number],
          to: [-0.055, 0.29, 0.015] as [number, number, number],
          radius: 0.025,
        },
        {
          from: [-0.03, 0.48, 0.06] as [number, number, number],
          to: [0.07, 0.35, 0.165] as [number, number, number],
          radius: 0.025,
        },
        {
          from: [0.07, 0.35, 0.165] as [number, number, number],
          to: [0.005, 0.29, 0.085] as [number, number, number],
          radius: 0.025,
        },
      ],
      8,
    ).name = 'process-reclaim-separated-grab-jaws';
    this.addCylinder(
      reclaimBin,
      0.05,
      0.065,
      steelGrooveMaterial,
      [-0.03, 0.48, 0.06],
      [0, 0, 0],
      12,
    ).name = 'process-reclaim-claw-wrist';
    this.addRoundedBox(
      reclaimBin,
      [0.28, 0.035, 0.23],
      this.materials.carbonDark,
      [0, 0.515, 0],
      [0, 0, 0],
      0.014,
    ).name = 'process-reclaim-bolted-recycling-stamp-plate';
    const recycleVertices = [
      new THREE.Vector2(0, -0.115),
      new THREE.Vector2(0.1, 0.06),
      new THREE.Vector2(-0.1, 0.06),
    ];
    const recycleBeams: DetailBeam[] = [];
    for (let index = 0; index < recycleVertices.length; index += 1) {
      const start = recycleVertices[index]!;
      const end = recycleVertices[(index + 1) % recycleVertices.length]!;
      const direction = end.clone().sub(start).normalize();
      const perpendicular = new THREE.Vector2(-direction.y, direction.x);
      const shaftEnd = end.clone().addScaledVector(direction, -0.024);
      recycleBeams.push({
        from: [start.x, 0.54, start.y],
        to: [shaftEnd.x, 0.54, shaftEnd.y],
        radius: 0.012,
      });
      for (const sign of [-1, 1]) {
        const wing = end
          .clone()
          .addScaledVector(direction, -0.055)
          .addScaledVector(perpendicular, sign * 0.033);
        recycleBeams.push({
          from: [wing.x, 0.54, wing.y],
          to: [end.x, 0.54, end.y],
          radius: 0.012,
        });
      }
    }
    this.addInstancedBeams(
      reclaimBin,
      reclaimMaterial,
      recycleBeams,
      8,
    ).name = 'process-reclaim-three-arrow-recycling-triad';
    const reclaimToken = new THREE.Group();
    reclaimToken.name = 'process-reclaim-loose-scraps';
    reclaimBin.add(reclaimToken);
    const scrapMaterials = [
      steelDieMaterial,
      copperDieMaterial,
      brickMaterial,
    ];
    for (const [index, material] of scrapMaterials.entries()) {
      this.addMesh(
        reclaimToken,
        index === 2
          ? new RoundedBoxGeometry(0.09, 0.075, 0.065, 2, 0.012)
          : new THREE.DodecahedronGeometry(0.07, 0),
        material,
        ([
          [-0.105, 0.34, -0.055],
          [0.045, 0.36, 0],
          [-0.015, 0.39, 0.085],
        ] as Array<[number, number, number]>)[index],
        [0.2 * index, 0.6 * index, 0.1],
      ).name = `process-reclaim-loose-scrap-${index}`;
    }
    reclaimBin.userData.reclaimCount = 0;
    rig.parts.processReclaimBin = reclaimBin;
    rig.parts.processReclaimToken = reclaimToken;

    if (rig.kind === 'fabricator') {
      // The process station is lightweight instrumentation carried by the
      // already-shadowing enclosure. Prevent its tall mast and thin hoops
      // from doubling the machine's projected silhouette while retaining
      // contact shadows from the actual bed, shoulders, and tooling.
      signalRoot.traverse((object) => {
        if (object instanceof THREE.Mesh) object.castShadow = false;
      });
    }

    this.updateProcessSignals(rig, 0);
  }

  private buildSmelter(rig: EntityRig): void {
    const { root } = rig;
    const highDetail = rig.quality === 'high';
    this.addRoundedBox(root, [0.88, 0.13, 0.88], this.materials.carbon, [0, 0.08, 0], [0, 0, 0], 0.065);
    this.addRoundedBox(root, [0.72, 0.07, 0.72], this.materials.titanium, [0, 0.155, 0], [0, Math.PI / 4, 0], 0.035);
    this.addCylinder(root, 0.225, 0.45, this.materials.carbonDark, [0, 0.38, 0], [0, 0, 0], 20);
    this.addCylinder(root, 0.17, 0.37, this.materials.ceramicDark, [0, 0.41, 0], [0, 0, 0], 18);
    rig.parts.crucibleRing = this.addProcessGlow(
      rig,
      root,
      new THREE.TorusGeometry(0.2, 0.035, 10, 28),
      [0, 0.615, 0],
      [Math.PI / 2, 0, 0],
      '#ff6a25',
      '#5f2b16',
    );
    rig.parts.crucibleGlow = this.addProcessGlow(
      rig,
      root,
      new THREE.CylinderGeometry(0.145, 0.13, 0.026, 24, 1),
      [0, 0.622, 0],
      [0, 0, 0],
      '#ffc15a',
      '#6d4726',
    );
    rig.parts.flashCore = this.addProcessGlow(
      rig,
      root,
      new THREE.CylinderGeometry(0.065, 0.058, 0.036, 18, 1),
      [0, 0.647, 0],
      [0, 0, 0],
      '#fff1bd',
      '#302a24',
    );
    for (const x of [-0.285, 0.285]) {
      this.addRoundedBox(
        root,
        [0.22, 0.48, 0.6],
        this.materials.housing.smelter,
        [x, 0.39, 0],
        [0, 0, x < 0 ? -0.05 : 0.05],
        0.07,
      );
      this.addRoundedBox(
        root,
        [0.06, 0.32, 0.48],
        this.materials.titanium,
        [x * 1.07, 0.4, 0],
        [0, 0, 0],
        0.018,
      );
    }

    // The furnace reads as a maintained industrial assembly from the play
    // camera, not a clean cylinder with a status badge. The asymmetric
    // regulator, hard-piped manifold, heat shields, and fasteners all have a
    // plausible service path back into the crucible.
    if (highDetail) {
      const shellMaterial = this.materials.housing.smelter.clone();
      shellMaterial.name = 'smelter-weathered-painted-shell';
      shellMaterial.color.set('#7b503a');
      shellMaterial.roughness = 0.68;
      shellMaterial.metalness = 0.42;
      rig.ownedMaterials.push(shellMaterial);

      // The crucible sits inside a continuous, load-bearing shell. Deep
      // shoulders and aprons establish one machine-sized mass while leaving
      // the hot chamber visible through intentional service openings.
      const enclosure = new THREE.Group();
      enclosure.name = 'smelter-load-bearing-painted-steel-enclosure';
      root.add(enclosure);
      this.addInstanceBatch(
        enclosure,
        new RoundedBoxGeometry(1, 1, 1, 3, 0.11),
        shellMaterial,
        [
          { position: [-0.39, 0.31, -0.31], scale: [0.17, 0.38, 0.2] },
          { position: [0.39, 0.31, -0.31], scale: [0.17, 0.38, 0.2] },
          { position: [-0.39, 0.31, 0.31], scale: [0.17, 0.38, 0.2] },
          { position: [0.39, 0.31, 0.31], scale: [0.17, 0.38, 0.2] },
          { position: [0, 0.22, 0.39], scale: [0.65, 0.22, 0.11] },
          { position: [-0.25, 0.19, -0.39], scale: [0.18, 0.18, 0.11] },
          { position: [0.25, 0.19, -0.39], scale: [0.18, 0.18, 0.11] },
        ],
      ).name = 'smelter-deep-cast-corner-shoulders-and-aprons';
      this.addInstanceBatch(
        enclosure,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
        this.materials.industrialPanel,
        [
          { position: [-0.438, 0.43, 0], scale: [0.028, 0.28, 0.34] },
          { position: [0.438, 0.43, 0], scale: [0.028, 0.28, 0.34] },
          { position: [0, 0.36, 0.438], scale: [0.38, 0.22, 0.028] },
        ],
      ).name = 'smelter-thick-bolted-service-cheeks';
      this.addInstancedBeams(
        enclosure,
        this.materials.titanium,
        [
          { from: [-0.41, 0.64, -0.29], to: [-0.41, 0.64, 0.3], radius: 0.026 },
          { from: [0.41, 0.64, -0.29], to: [0.41, 0.64, 0.3], radius: 0.026 },
          { from: [-0.41, 0.64, 0.3], to: [0.41, 0.64, 0.3], radius: 0.026 },
          { from: [-0.41, 0.64, -0.29], to: [-0.27, 0.67, -0.18], radius: 0.022 },
          { from: [0.41, 0.64, -0.29], to: [0.27, 0.67, -0.18], radius: 0.022 },
        ],
        8,
      ).name = 'smelter-continuous-upper-frame-and-door-braces';
      this.addInstanceBatch(
        enclosure,
        new THREE.BoxGeometry(1, 1, 1),
        this.materials.amber,
        [
          { position: [-0.438, 0.43, -0.12], scale: [0.018, 0.2, 0.025] },
          { position: [-0.438, 0.43, 0.12], scale: [0.018, 0.2, 0.025] },
          { position: [0.438, 0.43, -0.12], scale: [0.018, 0.2, 0.025] },
          { position: [0.438, 0.43, 0.12], scale: [0.018, 0.2, 0.025] },
        ],
      ).name = 'smelter-service-panel-recess-seams';

      // Close the old black "tray" around the crucible with a real hearth
      // deck. Four removable plates leave only the refractory chamber open;
      // they also give the intake and tap hardware something load-bearing to
      // meet instead of appearing to hover over the foundation.
      this.addRoundedBox(
        enclosure,
        [0.76, 0.055, 0.76],
        shellMaterial,
        [0, 0.195, 0],
        [0, 0, 0],
        0.04,
      ).name = 'smelter-solid-painted-hearth-pan';
      this.addInstanceBatch(
        enclosure,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.07),
        this.materials.industrialPanel,
        [
          { position: [-0.285, 0.225, 0], scale: [0.23, 0.055, 0.62] },
          { position: [0.285, 0.225, 0], scale: [0.23, 0.055, 0.62] },
          { position: [0, 0.225, 0.285], scale: [0.34, 0.055, 0.2] },
          { position: [0, 0.225, -0.285], scale: [0.34, 0.055, 0.2] },
        ],
      ).name = 'smelter-four-piece-bolted-hearth-deck';
      this.addInstanceBatch(
        enclosure,
        new THREE.BoxGeometry(1, 1, 1),
        this.materials.titanium,
        [
          { position: [-0.19, 0.26, 0], scale: [0.025, 0.035, 0.5] },
          { position: [0.19, 0.26, 0], scale: [0.025, 0.035, 0.5] },
          { position: [0, 0.26, -0.19], scale: [0.34, 0.035, 0.025] },
          { position: [0, 0.26, 0.19], scale: [0.34, 0.035, 0.025] },
        ],
      ).name = 'smelter-hearth-deck-recess-joints';

      const sootMaterial = this.materials.titanium.clone();
      sootMaterial.name = 'smelter-function-specific-soot-and-heat-scale';
      sootMaterial.color.set('#3f322b');
      sootMaterial.roughness = 0.9;
      sootMaterial.metalness = 0.24;
      rig.ownedMaterials.push(sootMaterial);
      const hotPathMaterial = this.materials.agedCopper.clone();
      hotPathMaterial.name = 'smelter-heat-discolored-tap-hardware';
      hotPathMaterial.color.set('#76503a');
      hotPathMaterial.roughness = 0.73;
      hotPathMaterial.metalness = 0.55;
      rig.ownedMaterials.push(hotPathMaterial);
      const blastHoodMaterial = this.materials.titanium.clone();
      blastHoodMaterial.name = 'smelter-midtone-blast-hood-shell';
      blastHoodMaterial.color.set('#66777a');
      blastHoodMaterial.roughness = 0.62;
      blastHoodMaterial.metalness = 0.66;
      rig.ownedMaterials.push(blastHoodMaterial);

      // One continuous material route is readable from the play camera:
      // rear hopper -> refractory throat -> crucible -> guarded front tap.
      const materialPath = new THREE.Group();
      materialPath.name = 'smelter-rear-input-through-crucible-to-front-output';
      enclosure.add(materialPath);
      this.addRoundedBox(
        materialPath,
        [0.38, 0.18, 0.18],
        shellMaterial,
        [0, 0.43, 0.46],
        [0, 0, 0],
        0.035,
      ).name = 'smelter-permanent-raised-feed-hopper';
      this.addMesh(
        materialPath,
        new THREE.CylinderGeometry(0.19, 0.085, 0.18, 4, 1, true),
        this.materials.agedCeramic,
        [0, 0.54, 0.46],
        [0, Math.PI / 4, 0],
      ).name = 'smelter-refractory-feed-funnel';
      this.addRoundedBox(
        materialPath,
        [0.25, 0.1, 0.34],
        this.materials.titanium,
        [0, 0.38, 0.32],
        [-0.24, 0, 0],
        0.022,
      ).name = 'smelter-enclosed-sloped-intake-duct';
      this.addInstanceBatch(
        materialPath,
        new THREE.BoxGeometry(1, 1, 1),
        this.materials.titaniumLight,
        [
          { position: [-0.13, 0.415, 0.32], scale: [0.025, 0.08, 0.33], rotation: [-0.24, 0, 0] },
          { position: [0.13, 0.415, 0.32], scale: [0.025, 0.08, 0.33], rotation: [-0.24, 0, 0] },
        ],
      ).name = 'smelter-intake-duct-bolted-side-flanges';
      this.addRoundedBox(
        materialPath,
        [0.34, 0.095, 0.36],
        hotPathMaterial,
        [0, 0.295, -0.32],
        [0.17, 0, 0],
        0.022,
      ).name = 'smelter-heat-scaled-front-tap-chute';
      this.addInstanceBatch(
        materialPath,
        new THREE.BoxGeometry(1, 1, 1),
        this.materials.titaniumLight,
        [
          { position: [-0.17, 0.335, -0.32], scale: [0.026, 0.095, 0.35], rotation: [0.17, 0, 0] },
          { position: [0.17, 0.335, -0.32], scale: [0.026, 0.095, 0.35], rotation: [0.17, 0, 0] },
          { position: [0, 0.35, -0.49], scale: [0.39, 0.08, 0.04] },
        ],
      ).name = 'smelter-front-tap-guard-rails-and-lip';
      this.addTorus(
        materialPath,
        0.255,
        0.028,
        sootMaterial,
        [0, 0.655, 0],
        [Math.PI / 2, 0, 0],
      ).name = 'smelter-soot-darkened-crucible-hood';

      // The smelting program changes the actual tooling at the hot path, not
      // merely a roof ornament.
      const smeltTooling = new THREE.Group();
      smeltTooling.name = 'smelter-recipe-specific-working-tooling';
      materialPath.add(smeltTooling);
      const smeltRecipe = rig.entity.processRecipe ?? rig.entity.recipe ?? 'auto';
      smeltTooling.userData.recipeIdentity = smeltRecipe;
      const productShuttle = new THREE.Group();
      productShuttle.name = `smelter-${smeltRecipe}-visible-output-product-shuttle`;
      productShuttle.position.set(0, 0.39, -0.43);
      productShuttle.userData.baseZ = -0.43;
      productShuttle.userData.recipeIdentity = smeltRecipe;
      materialPath.add(productShuttle);
      rig.parts.recipeProductShuttle = productShuttle;
      if (smeltRecipe === 'fireBrick') {
        this.addInstanceBatch(
          smeltTooling,
          new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
          this.materials.agedCeramic,
          [
            { position: [-0.14, 0.7, -0.02], scale: [0.2, 0.14, 0.34] },
            { position: [0.14, 0.7, -0.02], scale: [0.2, 0.14, 0.34] },
          ],
        ).name = 'smelter-fire-brick-twin-refractory-moulds';
        const pressHead = this.addRoundedBox(
          smeltTooling,
          [0.44, 0.15, 0.24],
          this.materials.titanium,
          [0, 0.88, -0.02],
          [0, 0, 0],
          0.025,
        );
        pressHead.name = 'smelter-fire-brick-press-head';
        pressHead.userData.baseY = 0.88;
        pressHead.userData.actuation = 'hydraulic-press';
        rig.parts.recipeMechanismActuator = pressHead;
        this.addInstancedBeams(
          smeltTooling,
          this.materials.titaniumLight,
          [
            { from: [-0.23, 0.65, -0.18], to: [-0.23, 0.97, -0.18], radius: 0.026 },
            { from: [0.23, 0.65, -0.18], to: [0.23, 0.97, -0.18], radius: 0.026 },
            { from: [-0.23, 0.97, -0.18], to: [0.23, 0.97, -0.18], radius: 0.026 },
          ],
          8,
        ).name = 'smelter-fire-brick-box-press-load-frame';
        this.addInstanceBatch(
          productShuttle,
          new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
          this.materials.agedCeramic,
          [
            { position: [-0.13, 0, 0], scale: [0.19, 0.09, 0.13] },
            { position: [0.08, 0, 0], scale: [0.19, 0.09, 0.13] },
            { position: [-0.025, 0.105, 0], scale: [0.19, 0.09, 0.13] },
          ],
        ).name = 'smelter-fire-brick-three-brick-output-bond';
      } else if (smeltRecipe === 'smeltCopper') {
        const ladleRotor = new THREE.Group();
        ladleRotor.name = 'smelter-copper-tilting-ladle-assembly';
        smeltTooling.add(ladleRotor);
        this.addTorus(
          ladleRotor,
          0.27,
          0.035,
          this.materials.agedCopper,
          [0, 0.69, 0],
          [Math.PI / 2, 0, 0],
        ).name = 'smelter-copper-ladle-trunnion';
        this.addMesh(
          ladleRotor,
          new THREE.CylinderGeometry(0.21, 0.16, 0.17, 16, 1, true),
          hotPathMaterial,
          [0, 0.72, 0],
          [0, 0, 0],
        ).name = 'smelter-copper-deep-tilting-ladle-bowl';
        this.addTorus(
          ladleRotor,
          0.205,
          0.022,
          this.materials.copperBright,
          [0, 0.815, 0],
          [Math.PI / 2, 0, 0],
        ).name = 'smelter-copper-molten-ladle-rim';
        this.addRoundedBox(
          ladleRotor,
          [0.13, 0.1, 0.38],
          hotPathMaterial,
          [0.17, 0.7, -0.15],
          [0, -0.34, 0],
          0.025,
        ).name = 'smelter-copper-pour-spout';
        ladleRotor.userData.actuation = 'tilting-ladle';
        rig.parts.recipeMechanismRotor = ladleRotor;
        this.addInstancedBeams(
          smeltTooling,
          this.materials.copper,
          [
            { from: [-0.3, 0.68, 0], to: [-0.4, 0.83, 0.17], radius: 0.026 },
            { from: [0.3, 0.68, 0], to: [0.4, 0.83, 0.17], radius: 0.026 },
          ],
          8,
        ).name = 'smelter-copper-ladle-trunnion-supports';
        this.addInstanceBatch(
          productShuttle,
          new RoundedBoxGeometry(1, 1, 1, 2, 0.1),
          this.materials.copperBright,
          [-0.13, 0, 0.13].map((x, index) => ({
            position: [x, index * 0.028, 0] as [number, number, number],
            scale: [0.18, 0.055, 0.24] as [number, number, number],
            rotation: [0, index === 1 ? 0.06 : -0.04, 0] as [number, number, number],
          })),
        ).name = 'smelter-copper-ribbed-plate-output-stack';
      } else if (smeltRecipe === 'smeltIron') {
        const ironRake = new THREE.Group();
        ironRake.name = 'smelter-iron-slag-rake-assembly';
        smeltTooling.add(ironRake);
        this.addTorus(
          ironRake,
          0.245,
          0.04,
          this.materials.titaniumLight,
          [0, 0.69, 0],
          [Math.PI / 2, 0, 0],
        ).name = 'smelter-iron-slag-skimming-ring';
        this.addInstancedBeams(
          ironRake,
          this.materials.titanium,
          [
            { from: [-0.23, 0.7, 0], to: [0.23, 0.7, 0], radius: 0.025 },
            { from: [0, 0.7, -0.23], to: [0, 0.7, 0.23], radius: 0.025 },
          ],
          8,
        ).name = 'smelter-iron-slag-rake';
        this.addMesh(
          ironRake,
          new THREE.CylinderGeometry(0.18, 0.235, 0.26, 12, 1, true),
          blastHoodMaterial,
          [0, 0.8, 0.08],
          [0, 0, 0],
        ).name = 'smelter-iron-tall-blast-hood';
        this.addTorus(
          ironRake,
          0.185,
          0.026,
          this.materials.titaniumLight,
          [0, 0.935, 0.08],
          [Math.PI / 2, 0, 0],
        ).name = 'smelter-iron-blast-hood-highlighted-rim';
        this.addCylinder(
          ironRake,
          0.125,
          0.022,
          hotPathMaterial,
          [0, 0.932, 0.08],
          [0, 0, 0],
          12,
        ).name = 'smelter-iron-blast-hood-exhaust-damper';
        this.addInstancedBeams(
          ironRake,
          this.materials.titaniumLight,
          [
            { from: [-0.11, 0.948, 0.08], to: [0.11, 0.948, 0.08], radius: 0.018 },
            { from: [0, 0.948, -0.03], to: [0, 0.948, 0.19], radius: 0.018 },
          ],
          8,
        ).name = 'smelter-iron-blast-hood-damper-cross-brace';
        this.addInstanceBatch(
          ironRake,
          new THREE.CylinderGeometry(1, 0.82, 1, 10, 1),
          this.materials.titaniumLight,
          [-0.15, 0.15].map((x) => ({
            position: [x, 0.9, 0.16] as [number, number, number],
            scale: [0.065, 0.22, 0.065] as [number, number, number],
          })),
        ).name = 'smelter-iron-twin-oxygen-lances';
        ironRake.userData.actuation = 'slag-rake';
        rig.parts.recipeMechanismActuator = ironRake;
        this.addInstanceBatch(
          productShuttle,
          new RoundedBoxGeometry(1, 1, 1, 2, 0.12),
          this.materials.titaniumLight,
          [-0.14, 0, 0.14].map((x, index) => ({
            position: [x, index === 1 ? 0.045 : 0, 0] as [number, number, number],
            scale: [0.18, 0.09, 0.22] as [number, number, number],
            rotation: [0, index * 0.08 - 0.08, 0] as [number, number, number],
          })),
        ).name = 'smelter-iron-three-ingot-output-stack';
      } else {
        const selector = new THREE.Group();
        selector.name = 'smelter-auto-dual-charge-selector-assembly';
        smeltTooling.add(selector);
        this.addRoundedBox(
          selector,
          [0.34, 0.09, 0.18],
          this.materials.titanium,
          [0, 0.72, 0.16],
          [0, 0, 0],
          0.022,
        ).name = 'smelter-auto-feed-selector-body';
        for (const [index, x] of [-0.19, 0.19].entries()) {
          this.addMesh(
            selector,
            new THREE.CylinderGeometry(0.14, 0.085, 0.22, 6, 1, true),
            index === 0
              ? this.materials.titaniumLight
              : this.materials.agedCopper,
            [x, 0.84, 0.2],
            [0, 0, 0],
          ).name = `smelter-auto-charge-bin-${index}`;
          this.addMesh(
            selector,
            new THREE.DodecahedronGeometry(0.075, 0),
            index === 0
              ? this.materials.titaniumLight
              : this.materials.copperBright,
            [x, 0.98, 0.2],
            [0.2, index * 0.7, 0.1],
          ).name = `smelter-auto-visible-ore-charge-${index}`;
        }
        this.addInstancedBeams(
          selector,
          this.materials.agedCopper,
          [
            { from: [0, 0.76, 0.08], to: [-0.15, 0.76, -0.08], radius: 0.022 },
            { from: [0, 0.76, 0.08], to: [0.15, 0.76, -0.08], radius: 0.022 },
          ],
          8,
        ).name = 'smelter-auto-dual-charge-gates';
        selector.userData.actuation = 'selector';
        rig.parts.recipeMechanismRotor = selector;
        this.addInstanceBatch(
          productShuttle,
          new RoundedBoxGeometry(1, 1, 1, 2, 0.1),
          this.materials.titaniumLight,
          [
            { position: [-0.12, 0, 0], scale: [0.17, 0.07, 0.22] },
            { position: [0.12, 0.025, 0], scale: [0.17, 0.07, 0.22] },
          ],
        ).name = 'smelter-auto-mixed-plate-output-pair';
        this.addRoundedBox(
          productShuttle,
          [0.15, 0.055, 0.2],
          this.materials.copperBright,
          [0, 0.095, 0],
          [0, 0.08, 0],
          0.018,
        ).name = 'smelter-auto-copper-output-witness';
      }
      const recipeWearMaterial =
        smeltRecipe === 'fireBrick'
          ? this.materials.agedCeramic
          : smeltRecipe === 'smeltCopper'
            ? this.materials.agedCopper
            : smeltRecipe === 'smeltIron'
              ? sootMaterial
              : hotPathMaterial;
      const recipeWear: DetailInstance[] =
        smeltRecipe === 'fireBrick'
          ? [
              { position: [-0.25, 0.272, -0.22], scale: [0.16, 0.012, 0.055], rotation: [0, 0.16, 0] },
              { position: [0.23, 0.272, -0.15], scale: [0.13, 0.012, 0.045], rotation: [0, -0.2, 0] },
              { position: [0.06, 0.272, 0.28], scale: [0.09, 0.012, 0.04], rotation: [0, 0.34, 0] },
            ]
          : smeltRecipe === 'smeltCopper'
            ? [
                { position: [0.24, 0.674, -0.1], scale: [0.17, 0.014, 0.04], rotation: [0, -0.24, 0] },
                { position: [0.31, 0.31, -0.28], scale: [0.08, 0.012, 0.12], rotation: [0, 0.12, 0] },
                { position: [-0.22, 0.272, 0.18], scale: [0.13, 0.012, 0.045], rotation: [0, -0.3, 0] },
              ]
            : smeltRecipe === 'smeltIron'
              ? [
                  { position: [-0.22, 0.67, 0.03], scale: [0.16, 0.014, 0.055], rotation: [0, 0.2, 0] },
                  { position: [0.19, 0.67, 0.12], scale: [0.14, 0.014, 0.05], rotation: [0, -0.18, 0] },
                  { position: [0, 0.272, -0.26], scale: [0.2, 0.012, 0.045], rotation: [0, 0.04, 0] },
                ]
              : [
                  { position: [-0.23, 0.272, 0.23], scale: [0.12, 0.012, 0.045], rotation: [0, 0.22, 0] },
                  { position: [0.23, 0.272, 0.23], scale: [0.12, 0.012, 0.045], rotation: [0, -0.22, 0] },
                  { position: [0, 0.272, -0.24], scale: [0.15, 0.012, 0.045], rotation: [0, 0.08, 0] },
                ];
      this.addInstanceBatch(
        materialPath,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.12),
        recipeWearMaterial,
        recipeWear,
      ).name = `smelter-${smeltRecipe}-localized-process-wear`;

      // Permanent, captionless port docks make the state poses causal: input
      // at the rear, discharge at the front, power on the left, reclaim on
      // the right. State hardware plugs into these exact machine faces.
      this.addRoundedBox(
        enclosure,
        [0.34, 0.1, 0.18],
        this.materials.titanium,
        [0, 0.31, 0.45],
        [0, 0, 0],
        0.022,
      ).name = 'smelter-permanent-rear-input-flange';
      this.addRoundedBox(
        enclosure,
        [0.3, 0.095, 0.17],
        hotPathMaterial,
        [0.2, 0.255, -0.445],
        [0, -0.08, 0],
        0.02,
      ).name = 'smelter-permanent-front-discharge-throat';
      this.addRoundedBox(
        enclosure,
        [0.12, 0.24, 0.28],
        this.materials.industrialPanel,
        [-0.455, 0.3, 0.02],
        [0, 0, 0],
        0.025,
      ).name = 'smelter-permanent-left-power-junction';
      this.addInstanceBatch(
        enclosure,
        new THREE.CylinderGeometry(1, 1, 1, 12, 1),
        this.materials.ceramicDark,
        [-0.06, 0.06].map((z) => ({
          position: [-0.478, 0.33, z] as [number, number, number],
          scale: [0.04, 0.035, 0.04] as [number, number, number],
          rotation: [0, 0, Math.PI / 2] as [number, number, number],
        })),
      ).name = 'smelter-power-junction-twin-insulators';
      this.addRoundedBox(
        enclosure,
        [0.14, 0.13, 0.3],
        this.materials.titanium,
        [0.455, 0.24, 0.16],
        [0, 0, 0],
        0.024,
      ).name = 'smelter-permanent-right-reclaim-dock';
      this.addInstanceBatch(
        enclosure,
        new THREE.CylinderGeometry(1, 1, 1, 8, 1),
        this.materials.titaniumLight,
        [
          [-0.438, 0.3, -0.13],
          [-0.438, 0.56, -0.13],
          [-0.438, 0.3, 0.13],
          [-0.438, 0.56, 0.13],
          [0.438, 0.3, -0.13],
          [0.438, 0.56, -0.13],
          [0.438, 0.3, 0.13],
          [0.438, 0.56, 0.13],
        ].map(([x, y, z]) => ({
          position: [x, y, z] as [number, number, number],
          scale: [0.015, 0.014, 0.015] as [number, number, number],
        })),
      ).name = 'smelter-shell-visible-fastener-lines';

      const serviceDetail = new THREE.Group();
      serviceDetail.name = 'smelter-authored-service-detail';
      root.add(serviceDetail);
      this.addRoundedBox(
        serviceDetail,
        [0.23, 0.19, 0.25],
        this.materials.carbonDark,
        [-0.355, 0.58, 0.2],
        [0, -0.08, 0],
        0.032,
      ).name = 'smelter-asymmetric-regulator-housing';
      this.addRoundedBox(
        serviceDetail,
        [0.17, 0.035, 0.18],
        this.materials.industrialPanel,
        [-0.355, 0.69, 0.2],
        [0, -0.08, 0],
        0.012,
      ).name = 'smelter-regulator-bolted-lid';
      this.addCylinder(
        serviceDetail,
        0.068,
        0.055,
        this.materials.ceramicDark,
        [-0.355, 0.735, 0.2],
        [0, 0, 0],
        14,
      ).name = 'smelter-pressure-gauge-body';
      this.addTorus(
        serviceDetail,
        0.07,
        0.012,
        this.materials.copperBright,
        [-0.355, 0.77, 0.2],
      ).name = 'smelter-pressure-gauge-bezel';
      this.addInstancedBeams(
        serviceDetail,
        this.materials.copper,
        [
          { from: [-0.245, 0.61, 0.2], to: [-0.12, 0.61, 0.2], radius: 0.022 },
          { from: [-0.12, 0.61, 0.2], to: [-0.12, 0.63, 0.08], radius: 0.022 },
          { from: [-0.12, 0.63, 0.08], to: [0, 0.63, 0.08], radius: 0.022 },
        ],
        8,
      ).name = 'smelter-regulator-hard-pipe';
      this.addInstanceBatch(
        serviceDetail,
        new THREE.CylinderGeometry(1, 1, 1, 10, 1),
        this.materials.titaniumLight,
        [
          { position: [-0.12, 0.61, 0.2], scale: [0.035, 0.03, 0.035] },
          { position: [-0.12, 0.63, 0.08], scale: [0.035, 0.03, 0.035] },
        ],
      ).name = 'smelter-manifold-pipe-collars';

      const heatScaleMaterial = this.materials.titanium.clone();
      heatScaleMaterial.name = 'smelter-heat-scaled-steel';
      heatScaleMaterial.color.set('#6a4738');
      heatScaleMaterial.roughness = 0.68;
      heatScaleMaterial.metalness = 0.54;
      rig.ownedMaterials.push(heatScaleMaterial);
      this.addInstanceBatch(
        serviceDetail,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
        heatScaleMaterial,
        [
          { position: [-0.18, 0.655, -0.09], scale: [0.15, 0.025, 0.22], rotation: [0, -0.08, 0] },
          { position: [0.18, 0.655, -0.09], scale: [0.15, 0.025, 0.22], rotation: [0, 0.08, 0] },
          { position: [-0.18, 0.65, 0.08], scale: [0.13, 0.022, 0.11], rotation: [0, 0.1, 0] },
          { position: [0.18, 0.65, 0.08], scale: [0.13, 0.022, 0.11], rotation: [0, -0.1, 0] },
        ],
      ).name = 'smelter-quadrant-heat-scaled-shields';
      this.addInstanceBatch(
        serviceDetail,
        new THREE.CylinderGeometry(1, 1, 1, 8, 1),
        this.materials.titaniumLight,
        [
          [-0.445, 0.69, 0.115],
          [-0.27, 0.69, 0.115],
          [-0.445, 0.69, 0.285],
          [-0.27, 0.69, 0.285],
          [-0.235, 0.681, -0.19],
          [0.235, 0.681, -0.19],
          [-0.235, 0.681, 0.17],
          [0.235, 0.681, 0.17],
        ].map(([x, y, z]) => ({
          position: [x, y, z] as [number, number, number],
          scale: [0.018, 0.016, 0.018] as [number, number, number],
        })),
      ).name = 'smelter-visible-service-fasteners';
      const valve = new THREE.Group();
      valve.name = 'smelter-offset-hand-valve';
      valve.position.set(-0.47, 0.61, 0.2);
      serviceDetail.add(valve);
      this.addTorus(
        valve,
        0.075,
        0.012,
        this.materials.amber,
      );
      this.addInstancedBeams(
        valve,
        this.materials.amber,
        [
          { from: [-0.065, 0, 0], to: [0.065, 0, 0], radius: 0.009 },
          { from: [0, 0, -0.065], to: [0, 0, 0.065], radius: 0.009 },
        ],
        7,
      );
      this.addCylinder(
        valve,
        0.018,
        0.06,
        this.materials.titaniumLight,
        [0, -0.025, 0],
        [0, 0, 0],
        8,
      );
    }
    rig.parts.heatVents = [-0.285, 0.285].map((x) => this.addProcessGlow(
      rig,
      root,
      new RoundedBoxGeometry(0.052, 0.024, 0.22, 2, 0.008),
      [x, 0.677, -0.055],
      [0, 0, 0],
      '#ff6422',
      '#422116',
    ));
    const furnaceDoor = this.addRoundedBox(
      root,
      [0.31, 0.28, 0.045],
      this.materials.carbonDark,
      [0, 0.405, -0.338],
      [0, 0, 0],
      0.018,
    );
    rig.parts.furnaceDoor = furnaceDoor;
    const smelterPanels: DetailInstance[] = [
      {
        position: [0, 0.6, -0.29],
        scale: [0.3, 0.06, 0.1],
      },
      {
        position: [-0.285, 0.64, -0.095],
        scale: [0.145, 0.028, 0.2],
      },
      {
        position: [0.285, 0.64, -0.095],
        scale: [0.145, 0.028, 0.2],
      },
    ];
    for (const x of [-0.285, 0.285]) {
      for (const y of [0.305, 0.395, 0.485]) {
        smelterPanels.push({
          position: [x, y, -0.316],
          scale: [0.13, 0.026, 0.025],
        });
      }
    }
    this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.carbonDark,
      smelterPanels,
    );
    const smelterStraps: DetailInstance[] = [
      { position: [-0.17, 0.405, -0.365], scale: [0.022, 0.31, 0.025] },
      { position: [0.17, 0.405, -0.365], scale: [0.022, 0.31, 0.025] },
      { position: [0, 0.25, -0.365], scale: [0.36, 0.022, 0.025] },
      { position: [0, 0.56, -0.365], scale: [0.36, 0.022, 0.025] },
      { position: [-0.395, 0.41, -0.29], scale: [0.024, 0.34, 0.035] },
      { position: [0.395, 0.41, -0.29], scale: [0.024, 0.34, 0.035] },
      { position: [-0.285, 0.662, -0.095], scale: [0.17, 0.018, 0.034] },
      { position: [0.285, 0.662, -0.095], scale: [0.17, 0.018, 0.034] },
    ];
    this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.amber,
      smelterStraps,
    );
    const exhaustLinks: DetailBeam[] = [];
    for (const x of [-0.2, 0.2]) {
      const outerX = x < 0 ? -0.285 : 0.285;
      exhaustLinks.push(
        {
          from: [outerX, 0.57, 0.12],
          to: [outerX, 0.64, 0.26],
          radius: 0.028,
        },
        {
          from: [outerX, 0.64, 0.26],
          to: [x, 0.66, 0.26],
          radius: 0.028,
        },
      );
    }
    this.addInstancedBeams(root, this.materials.carbonDark, exhaustLinks, 8);
    this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 1, 1, 12, 1),
      this.materials.amber,
      [-0.2, 0.2].map((x) => ({
        position: [x, 0.545, 0.26],
        scale: [0.085, 0.035, 0.085],
      })),
    );

    const fans: THREE.Object3D[] = [];
    for (const x of [-0.22, 0.22]) {
      const fan = new THREE.Group();
      fan.position.set(x, 0.3, -0.34);
      root.add(fan);
      this.addTorus(fan, 0.095, 0.018, this.materials.titaniumLight, [0, 0, 0], [0, 0, 0]);
      this.addCylinder(fan, 0.03, 0.06, this.materials.carbonDark, [0, 0, 0], [Math.PI / 2, 0, 0], 10);
      const fanBlades: DetailInstance[] = [];
      for (let bladeIndex = 0; bladeIndex < 5; bladeIndex += 1) {
        const angle = bladeIndex * Math.PI * 2 / 5;
        fanBlades.push({
          position: [Math.sin(angle) * 0.045, Math.cos(angle) * 0.045, -0.006],
          scale: [0.025, 0.075, 0.016],
          rotation: [0, 0, -angle],
        });
      }
      this.addInstanceBatch(
        fan,
        new THREE.BoxGeometry(1, 1, 1),
        this.materials.amber,
        fanBlades,
      );
      fans.push(fan);
    }
    rig.parts.fans = fans;

    for (const x of [-0.2, 0.2]) {
      this.addCylinder(root, 0.075, 0.32, this.materials.titanium, [x, 0.68, 0.26], [0, 0, 0], 14);
      this.addTorus(root, 0.075, 0.013, this.materials.ceramic, [x, 0.83, 0.26]);
      this.addCylinder(root, 0.05, 0.08, this.materials.carbonDark, [x, 0.86, 0.26], [0, 0, 0], 12);
    }
    this.addRoundedBox(root, [0.42, 0.08, 0.16], this.materials.ceramic, [0, 0.66, 0], [0, 0, 0], 0.026);
    rig.parts.doorGlow = this.addProcessGlow(
      rig,
      root,
      new RoundedBoxGeometry(0.19, 0.055, 0.02, 2, 0.012),
      [0, 0.405, -0.365],
      [0, 0, 0],
      '#ff7828',
      '#3d2118',
    );
    this.addRoundedBox(
      root,
      [0.22, 0.06, 0.15],
      this.materials.carbonDark,
      [0.245, 0.23, -0.29],
      [0, -0.16, 0],
      0.014,
    );
    rig.parts.dischargeGlow = this.addProcessGlow(
      rig,
      root,
      new RoundedBoxGeometry(0.145, 0.026, 0.075, 2, 0.009),
      [0.245, 0.265, -0.345],
      [0, -0.16, 0],
      '#ff8b2b',
      '#38251b',
    );
    this.addLamp(rig, root, [0.36, 0.31, -0.31], 0.03);
    this.addRivetCorners(root, 0.72, 0.72, 0.17);
  }

  private buildFabricator(rig: EntityRig): void {
    const { root } = rig;
    const highDetail = rig.quality === 'high';
    const fabricatorRecipe =
      rig.entity.processRecipe ?? rig.entity.recipe ?? 'unconfigured';
    const genericContactShadow = root.getObjectByName('contact-shadow');
    if (genericContactShadow) {
      genericContactShadow.visible = !highDetail;
      if (!highDetail) genericContactShadow.scale.set(0.78, 0.82, 1);
    }
    // The fabricator is the first genuinely heavy machine the campaign asks
    // the player to commission. Give it a broad, planted cast bed before any
    // tooling is attached; the earlier narrow black tray made the otherwise
    // detailed mechanism read like loose parts sitting directly on terrain.
    this.addRoundedBox(
      root,
      [0.96, 0.16, 0.94],
      this.materials.carbon,
      [0, 0.09, 0],
      [0, 0, 0],
      0.065,
    ).name = 'fabricator-one-piece-heavy-cast-bed';
    this.addRoundedBox(
      root,
      [0.84, 0.075, 0.82],
      this.materials.ceramicDark,
      [0, 0.175, 0],
      [0, Math.PI / 4, 0],
      0.035,
    ).name = 'fabricator-recessed-machine-bed-wear-plate';
    if (!highDetail) {
      this.addInstanceBatch(
        root,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.12),
        this.materials.titanium,
        [
          { position: [-0.39, 0.035, -0.34], scale: [0.19, 0.07, 0.17] },
          { position: [0.39, 0.035, -0.34], scale: [0.19, 0.07, 0.17] },
          { position: [-0.39, 0.035, 0.34], scale: [0.19, 0.07, 0.17] },
          { position: [0.39, 0.035, 0.34], scale: [0.19, 0.07, 0.17] },
        ],
      ).name = 'fabricator-four-anchored-machinery-feet';
      this.addInstanceBatch(
        root,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.14),
        this.materials.carbon,
        [
          { position: [-0.35, 0.022, 0], scale: [0.16, 0.044, 0.78] },
          { position: [0.35, 0.022, 0], scale: [0.16, 0.044, 0.78] },
        ],
      ).name = 'fabricator-continuous-ground-contact-skid-rails';
    }
    const turntable = new THREE.Group();
    turntable.position.y = 0.225;
    root.add(turntable);
    rig.parts.turntable = turntable;
    this.addCylinder(
      turntable,
      0.225,
      0.08,
      highDetail ? this.materials.ceramicDark : this.materials.titanium,
      [0, 0, 0],
      [0, 0, 0],
      24,
    );
    if (!highDetail) {
      this.addTorus(turntable, 0.19, 0.025, this.materials.violet, [0, 0.045, 0]);
      const turntableTeeth: DetailInstance[] = [];
      for (let tooth = 0; tooth < 10; tooth += 1) {
        const angle = tooth * Math.PI * 2 / 10;
        turntableTeeth.push({
          position: [Math.sin(angle) * 0.25, 0.015, Math.cos(angle) * 0.25],
          scale: [0.035, 0.055, 0.085],
          rotation: [0, angle, 0],
        });
      }
      this.addInstanceBatch(
        turntable,
        new THREE.BoxGeometry(1, 1, 1),
        this.materials.titaniumLight,
        turntableTeeth,
      );
    }
    this.addInstanceBatch(
      turntable,
      new THREE.BoxGeometry(1, 1, 1),
      highDetail ? this.materials.ceramicDark : this.materials.carbonDark,
      [
        { position: [-0.115, 0.095, 0], scale: [0.075, 0.1, 0.18] },
        { position: [0.115, 0.095, 0], scale: [0.075, 0.1, 0.18] },
      ],
    );
    this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.titanium,
      [
        { position: [0, 0.205, -0.3], scale: [0.5, 0.035, 0.11] },
        { position: [0, 0.205, 0.3], scale: [0.5, 0.035, 0.11] },
      ],
    );

    const topA = new THREE.Vector3(-0.28, 0.68, 0.12);
    const topB = new THREE.Vector3(0.28, 0.68, 0.12);
    if (!highDetail) {
      for (const x of [-0.35, 0.35]) {
        this.addRoundedBox(root, [0.13, 0.5, 0.16], this.materials.housing.fabricator, [x, 0.42, 0.22], [0, 0, 0], 0.045);
        this.addRoundedBox(root, [0.07, 0.42, 0.11], this.materials.titanium, [x, 0.42, -0.2], [0, 0, 0], 0.018);
      }
    }

    // A visible drive train and offset service cassette give the fabricator a
    // causal assembly hierarchy: motor -> gears -> overhead tooling. The
    // authored panel atlas is confined to a deliberate access plate so its
    // seams do not smear across every primitive or repeat as wallpaper.
    if (highDetail) {
      const shellMaterial = this.materials.housing.fabricator.clone();
      shellMaterial.name = 'fabricator-weathered-sage-painted-shell';
      shellMaterial.color.set('#758270');
      shellMaterial.color.offsetHSL((rig.phaseOffset - 0.5) * 0.025, 0, 0);
      shellMaterial.emissive.set('#202820');
      shellMaterial.emissiveIntensity = 0.02;
      shellMaterial.roughness = 0.86;
      shellMaterial.metalness = 0.25;
      rig.ownedMaterials.push(shellMaterial);
      const castBedMaterial = this.materials.carbon.clone();
      castBedMaterial.name = 'fabricator-oiled-graphite-cast-structure';
      castBedMaterial.color.set('#435154');
      castBedMaterial.emissive.set('#141c1d');
      castBedMaterial.emissiveIntensity = 0.055;
      castBedMaterial.roughness = 0.8;
      castBedMaterial.metalness = 0.5;
      rig.ownedMaterials.push(castBedMaterial);
      const rubbedEdgeMaterial = this.materials.titanium.clone();
      rubbedEdgeMaterial.name = 'fabricator-rubbed-load-edge-steel';
      rubbedEdgeMaterial.color.set('#aeb9b5');
      rubbedEdgeMaterial.roughness = 0.44;
      rubbedEdgeMaterial.metalness = 0.8;
      rig.ownedMaterials.push(rubbedEdgeMaterial);
      const safetyPaintMaterial = this.materials.amber.clone();
      safetyPaintMaterial.name = 'fabricator-worn-safety-ochre';
      safetyPaintMaterial.color.set('#a87532');
      safetyPaintMaterial.roughness = 0.78;
      safetyPaintMaterial.metalness = 0.2;
      rig.ownedMaterials.push(safetyPaintMaterial);
      const readableShellTopMaterial = this.materials.housing.fabricator.clone();
      readableShellTopMaterial.name =
        'fabricator-readable-aged-sage-horizontal-surfaces';
      readableShellTopMaterial.color.set('#929e88');
      readableShellTopMaterial.emissive.set('#20271f');
      readableShellTopMaterial.emissiveIntensity = 0.025;
      readableShellTopMaterial.roughness = 0.86;
      readableShellTopMaterial.metalness = 0.2;
      rig.ownedMaterials.push(readableShellTopMaterial);
      const workDeckMaterial = this.materials.housing.fabricator.clone();
      workDeckMaterial.name = 'fabricator-medium-value-bolted-work-deck';
      workDeckMaterial.color.set('#596669');
      workDeckMaterial.emissive.set('#182122');
      workDeckMaterial.emissiveIntensity = 0.05;
      workDeckMaterial.roughness = 0.62;
      workDeckMaterial.metalness = 0.5;
      rig.ownedMaterials.push(workDeckMaterial);
      const processGrimeMaterial = this.materials.carbon.clone();
      processGrimeMaterial.name = 'fabricator-localized-oil-and-process-grime';
      processGrimeMaterial.color.set('#3b3029');
      processGrimeMaterial.roughness = 0.96;
      processGrimeMaterial.metalness = 0.08;
      rig.ownedMaterials.push(processGrimeMaterial);
      const fabricatorRubberMaterial = this.materials.rubber.clone();
      fabricatorRubberMaterial.name = 'fabricator-matte-vibration-rubber';
      fabricatorRubberMaterial.color.set('#1b2324');
      fabricatorRubberMaterial.roughness = 0.97;
      fabricatorRubberMaterial.metalness = 0.015;
      rig.ownedMaterials.push(fabricatorRubberMaterial);
      const fabricatorCopperMaterial = this.materials.copperBright.clone();
      fabricatorCopperMaterial.name = 'fabricator-drawn-copper-working-stock';
      fabricatorCopperMaterial.color.set('#bd6d3c');
      fabricatorCopperMaterial.emissive.set('#1d0d07');
      fabricatorCopperMaterial.emissiveIntensity = 0.015;
      fabricatorCopperMaterial.roughness = 0.46;
      fabricatorCopperMaterial.metalness = 0.72;
      fabricatorCopperMaterial.vertexColors = true;
      rig.ownedMaterials.push(fabricatorCopperMaterial);
      const rustedAccessMaterial = this.materials.fabricatorPanel.clone();
      rustedAccessMaterial.name =
        'fabricator-dark-warm-non-emissive-rusted-access-field';
      rustedAccessMaterial.color.set('#b87850');
      rustedAccessMaterial.emissive.set('#000000');
      rustedAccessMaterial.emissiveIntensity = 0;
      rustedAccessMaterial.roughness = 0.94;
      rustedAccessMaterial.metalness = 0.2;
      rig.ownedMaterials.push(rustedAccessMaterial);
      const rustChipMaterial = new THREE.MeshStandardMaterial({
        color: '#673522',
        roughness: 0.96,
        metalness: 0.12,
      });
      rustChipMaterial.name =
        'fabricator-authored-dark-warm-macro-rust-chip-material';
      rig.ownedMaterials.push(rustChipMaterial);

      // The machine's cast bed now terminates in a visible installation
      // plinth instead of disappearing into its own projected shadow. Keep
      // the center open for the existing heavy bed and instance only the
      // perimeter shoes, anchor collars, and rubbed datum edges.
      this.addInstanceBatch(
        root,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.14),
        castBedMaterial,
        [
          { position: [-0.49, 0.03, 0], scale: [0.1, 0.055, 0.88] },
          { position: [0.49, 0.03, 0], scale: [0.1, 0.055, 0.88] },
          { position: [0, 0.03, -0.47], scale: [0.9, 0.055, 0.1] },
          { position: [0, 0.03, 0.47], scale: [0.9, 0.055, 0.1] },
        ],
      ).name = 'fabricator-four-piece-grounded-installation-plinth';
      this.addInstanceBatch(
        root,
        new RoundedBoxGeometry(1, 1, 1, 3, 0.16),
        castBedMaterial,
        [
          { position: [-0.51, 0.07, -0.46], scale: [0.22, 0.115, 0.21] },
          { position: [0.51, 0.07, -0.46], scale: [0.22, 0.115, 0.21] },
          { position: [-0.51, 0.07, 0.46], scale: [0.22, 0.115, 0.21] },
          { position: [0.51, 0.07, 0.46], scale: [0.22, 0.115, 0.21] },
        ],
      ).name = 'fabricator-four-articulated-outer-corner-foot-castings';
      this.addInstanceBatch(
        root,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.16),
        fabricatorRubberMaterial,
        [
          { position: [-0.51, 0.014, -0.46], scale: [0.165, 0.028, 0.155] },
          { position: [0.51, 0.014, -0.46], scale: [0.165, 0.028, 0.155] },
          { position: [-0.51, 0.014, 0.46], scale: [0.165, 0.028, 0.155] },
          { position: [0.51, 0.014, 0.46], scale: [0.165, 0.028, 0.155] },
        ],
      ).name = 'fabricator-four-visible-matte-rubber-foot-isolators';
      this.addInstanceBatch(
        root,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.16),
        rubbedEdgeMaterial,
        [
          [-0.51, 0.137, -0.46],
          [0.51, 0.137, -0.46],
          [-0.51, 0.137, 0.46],
          [0.51, 0.137, 0.46],
        ].map(([x, y, z]) => ({
          position: [x, y, z] as [number, number, number],
          scale: [0.12, 0.025, 0.11] as [number, number, number],
        })),
      ).name = 'fabricator-four-bright-rectangular-foot-anchor-plates';
      this.addInstanceBatch(
        root,
        new THREE.CylinderGeometry(1, 1, 1, 8, 1),
        fabricatorRubberMaterial,
        [
          [-0.51, 0.158, -0.46],
          [0.51, 0.158, -0.46],
          [-0.51, 0.158, 0.46],
          [0.51, 0.158, 0.46],
        ].map(([x, y, z]) => ({
          position: [x, y, z] as [number, number, number],
          scale: [0.034, 0.018, 0.034] as [number, number, number],
        })),
      ).name = 'fabricator-four-dark-hex-anchor-fasteners';
      this.addInstanceBatch(
        root,
        new THREE.BoxGeometry(1, 1, 1),
        rubbedEdgeMaterial,
        [
          { position: [-0.49, 0.061, 0], scale: [0.018, 0.016, 0.69] },
          { position: [0.49, 0.061, 0], scale: [0.018, 0.016, 0.69] },
          { position: [0, 0.061, -0.47], scale: [0.7, 0.016, 0.018] },
          { position: [0, 0.061, 0.47], scale: [0.7, 0.016, 0.018] },
        ],
      ).name = 'fabricator-rubbed-foundation-datum-edges';
      const fabricatorGroundWear = this.addInstanceBatch(
        root,
        new THREE.CircleGeometry(0.5, 20),
        this.materials.stain,
        [
          { position: [-0.51, 0.004, -0.46], scale: [0.31, 0.22, 1], rotation: [-Math.PI / 2, 0, 0.22] },
          { position: [0.51, 0.004, -0.46], scale: [0.29, 0.21, 1], rotation: [-Math.PI / 2, 0, -0.18] },
          { position: [-0.51, 0.004, 0.46], scale: [0.28, 0.2, 1], rotation: [-Math.PI / 2, 0, -0.3] },
          { position: [0.51, 0.004, 0.46], scale: [0.32, 0.22, 1], rotation: [-Math.PI / 2, 0, 0.12] },
        ],
        false,
      );
      fabricatorGroundWear.name = 'fabricator-four-tight-foot-contact-ao-marks';
      fabricatorGroundWear.renderOrder = -2;
      const fabricatorOutwardSoil = this.addInstanceBatch(
        root,
        new THREE.CircleGeometry(0.5, 20),
        this.materials.scorch,
        [
          { position: [-0.595, 0.003, -0.52], scale: [0.34, 0.19, 1], rotation: [-Math.PI / 2, 0, 0.34] },
          { position: [0.6, 0.003, -0.515], scale: [0.31, 0.18, 1], rotation: [-Math.PI / 2, 0, -0.24] },
          { position: [-0.59, 0.003, 0.53], scale: [0.3, 0.17, 1], rotation: [-Math.PI / 2, 0, -0.38] },
          { position: [0.605, 0.003, 0.525], scale: [0.33, 0.185, 1], rotation: [-Math.PI / 2, 0, 0.18] },
        ],
        false,
      );
      fabricatorOutwardSoil.name = 'fabricator-four-outward-service-soil-disturbances';
      fabricatorOutwardSoil.renderOrder = -3;
      this.addInstanceBatch(
        root,
        new THREE.DodecahedronGeometry(1, 0),
        this.materials.groundRock,
        [
          { position: [-0.61, 0.022, -0.39], scale: [0.035, 0.022, 0.028], rotation: [0.2, 0.1, -0.3] },
          { position: [0.58, 0.018, -0.6], scale: [0.027, 0.018, 0.032], rotation: [-0.2, 0.4, 0.15] },
          { position: [-0.63, 0.02, 0.53], scale: [0.03, 0.02, 0.025], rotation: [0.3, -0.2, 0.2] },
          { position: [0.62, 0.019, 0.41], scale: [0.026, 0.019, 0.035], rotation: [-0.15, 0.3, -0.2] },
        ],
        false,
      ).name = 'fabricator-four-deterministic-foot-edge-debris-chips';

      // A continuous perimeter frame turns the exposed drive parts into one
      // protected machine. The shoulders carry the gantry; the open central
      // bay preserves a readable tool path from motor to chuck to turntable.
      const enclosure = new THREE.Group();
      enclosure.name = 'fabricator-load-bearing-painted-steel-enclosure';
      root.add(enclosure);
      // Broad outer cheeks and a split front/rear apron establish the primary
      // silhouette at ordinary play zoom. The middle stays open at both ends,
      // so ingredients, product, and inserter hand-offs remain physically
      // traceable instead of disappearing into a sealed decorative box.
      this.addInstanceBatch(
        enclosure,
        new RoundedBoxGeometry(1, 1, 1, 3, 0.11),
        shellMaterial,
        [
          { position: [-0.435, 0.405, 0], scale: [0.19, 0.48, 0.68] },
          { position: [0.435, 0.405, 0], scale: [0.19, 0.48, 0.68] },
          { position: [-0.27, 0.31, 0.405], scale: [0.3, 0.27, 0.13] },
          { position: [0.27, 0.31, 0.405], scale: [0.3, 0.27, 0.13] },
          { position: [-0.285, 0.275, -0.405], scale: [0.27, 0.22, 0.13] },
          { position: [0.285, 0.275, -0.405], scale: [0.27, 0.22, 0.13] },
        ],
      ).name = 'fabricator-continuous-armored-side-cheeks-and-split-aprons';
      this.addInstanceBatch(
        enclosure,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
        castBedMaterial,
        [
          { position: [-0.39, 0.205, 0], scale: [0.13, 0.15, 0.72] },
          { position: [0.39, 0.205, 0], scale: [0.13, 0.15, 0.72] },
          { position: [0, 0.205, 0.35], scale: [0.68, 0.15, 0.13] },
          { position: [0, 0.205, -0.35], scale: [0.68, 0.15, 0.13] },
        ],
      ).name = 'fabricator-boxed-cast-load-ring';
      this.addInstanceBatch(
        enclosure,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.1),
        workDeckMaterial,
        [
          { position: [-0.335, 0.405, 0], scale: [0.065, 0.31, 0.54] },
          { position: [0.335, 0.405, 0], scale: [0.065, 0.31, 0.54] },
          { position: [-0.19, 0.315, 0.345], scale: [0.25, 0.13, 0.075] },
          { position: [0.19, 0.315, 0.345], scale: [0.25, 0.13, 0.075] },
          { position: [-0.2, 0.305, -0.345], scale: [0.24, 0.11, 0.075] },
          { position: [0.2, 0.305, -0.345], scale: [0.24, 0.11, 0.075] },
        ],
      ).name = 'fabricator-closed-inner-service-bay-liners-and-bulkheads';
      this.addInstanceBatch(
        enclosure,
        new THREE.BoxGeometry(1, 1, 1),
        rubbedEdgeMaterial,
        [
          { position: [-0.484, 0.58, 0], scale: [0.022, 0.03, 0.56] },
          { position: [0.484, 0.58, 0], scale: [0.022, 0.03, 0.56] },
          { position: [-0.27, 0.46, 0.474], scale: [0.25, 0.025, 0.022] },
          { position: [0.27, 0.46, 0.474], scale: [0.25, 0.025, 0.022] },
          { position: [-0.285, 0.39, -0.474], scale: [0.23, 0.025, 0.022] },
          { position: [0.285, 0.39, -0.474], scale: [0.23, 0.025, 0.022] },
        ],
      ).name = 'fabricator-rubbed-silhouette-edge-catches';
      this.addInstanceBatch(
        enclosure,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
        workDeckMaterial,
        [
          { position: [-0.438, 0.49, 0], scale: [0.028, 0.26, 0.46] },
          { position: [0.438, 0.49, 0], scale: [0.028, 0.26, 0.46] },
          { position: [-0.27, 0.36, 0.442], scale: [0.2, 0.17, 0.026] },
          { position: [0.27, 0.36, 0.442], scale: [0.2, 0.17, 0.026] },
        ],
      ).name = 'fabricator-authored-service-skin-insets';
      this.addRoundedBox(
        enclosure,
        [0.014, 0.19, 0.32],
        rustChipMaterial,
        [0.552, 0.38, -0.07],
        [0, 0, 0],
        0.006,
      ).name = 'fabricator-near-cheek-dark-rust-hatch-border';
      this.addAtlasCroppedRoundedBox(
        enclosure,
        [0.014, 0.15, 0.27],
        rustedAccessMaterial,
        [0.515, 0.985, 0.015, 0.485],
        [0.562, 0.38, -0.07],
        [0, 0, 0],
        0.006,
      ).name = 'fabricator-near-cheek-readable-chipped-rust-access-field';
      this.addInstanceBatch(
        enclosure,
        new THREE.BoxGeometry(1, 1, 1),
        rustChipMaterial,
        [
          { position: [0.572, 0.345, -0.145], scale: [0.012, 0.042, 0.075], rotation: [0.12, 0, 0] },
          { position: [0.572, 0.405, 0.035], scale: [0.012, 0.032, 0.065], rotation: [-0.16, 0, 0] },
          { position: [0.572, 0.435, -0.035], scale: [0.012, 0.024, 0.045], rotation: [0.24, 0, 0] },
        ],
        false,
      ).name = 'fabricator-near-cheek-three-readable-irregular-rust-chips';
      this.addRoundedBox(
        enclosure,
        [0.015, 0.042, 0.23],
        rubbedEdgeMaterial,
        [0.577, 0.485, -0.04],
        [0, 0, 0.035],
        0.006,
      ).name = 'fabricator-near-cheek-single-readable-rubbed-edge-band';
      this.addAtlasCroppedRoundedBox(
        enclosure,
        [0.22, 0.17, 0.025],
        this.materials.fabricatorPanel,
        [0.015, 0.485, 0.515, 0.985],
        [-0.275, 0.31, -0.478],
        [0, 0, 0],
        0.02,
      ).name = 'fabricator-bounded-weathered-left-front-service-apron';
      this.addRoundedBox(
        enclosure,
        [0.22, 0.17, 0.025],
        readableShellTopMaterial,
        [0.275, 0.31, -0.478],
        [0, 0, 0],
        0.02,
      ).name = 'fabricator-readable-aged-sage-right-front-service-apron';
      this.addInstanceBatch(
        enclosure,
        new THREE.BoxGeometry(1, 1, 1),
        rubbedEdgeMaterial,
        [
          { position: [-0.275, 0.405, -0.495], scale: [0.21, 0.018, 0.012] },
          { position: [0.275, 0.405, -0.495], scale: [0.21, 0.018, 0.012] },
          { position: [-0.275, 0.215, -0.495], scale: [0.21, 0.018, 0.012] },
          { position: [0.275, 0.215, -0.495], scale: [0.21, 0.018, 0.012] },
        ],
      ).name = 'fabricator-front-apron-rubbed-steel-edges';
      this.addInstanceBatch(
        enclosure,
        new THREE.CylinderGeometry(1, 1, 1, 8, 1),
        this.materials.titaniumLight,
        [-0.38, -0.17, 0.17, 0.38].flatMap((x) =>
          [0.245, 0.375].map((y) => ({
            position: [x, y, -0.502] as [number, number, number],
            scale: [0.013, 0.012, 0.013] as [number, number, number],
            rotation: [Math.PI / 2, 0, 0] as [number, number, number],
          }))),
      ).name = 'fabricator-front-apron-visible-fastener-lines';
      this.addInstanceBatch(
        enclosure,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
        safetyPaintMaterial,
        [
          { position: [-0.275, 0.31, -0.506], scale: [0.075, 0.025, 0.012] },
          { position: [0.275, 0.31, -0.506], scale: [0.075, 0.025, 0.012] },
        ],
      ).name = 'fabricator-front-apron-recessed-safety-latches';
      this.addRoundedBox(
        enclosure,
        [0.115, 0.07, 0.012],
        processGrimeMaterial,
        [0.275, 0.335, -0.497],
        [0, 0, -0.08],
        0.012,
      ).name = 'fabricator-front-apron-broad-dark-service-wear';
      this.addRoundedBox(
        enclosure,
        [0.09, 0.018, 0.014],
        rubbedEdgeMaterial,
        [0.235, 0.385, -0.504],
        [0, 0, 0.16],
        0.006,
      ).name = 'fabricator-front-apron-single-rubbed-load-chip';
      this.addInstanceBatch(
        enclosure,
        new RoundedBoxGeometry(1, 1, 1, 3, 0.11),
        shellMaterial,
        [
          { position: [-0.355, 0.62, -0.26], scale: [0.24, 0.16, 0.22] },
          { position: [0.355, 0.62, -0.26], scale: [0.24, 0.16, 0.22] },
          { position: [-0.355, 0.62, 0.26], scale: [0.24, 0.16, 0.22] },
          { position: [0.355, 0.62, 0.26], scale: [0.24, 0.16, 0.22] },
        ],
      ).name = 'fabricator-four-cast-gantry-shoulder-caps';
      this.addInstanceBatch(
        enclosure,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
        readableShellTopMaterial,
        [
          { position: [-0.355, 0.71, -0.26], scale: [0.17, 0.025, 0.15] },
          { position: [0.355, 0.71, -0.26], scale: [0.17, 0.025, 0.15] },
          { position: [-0.355, 0.71, 0.26], scale: [0.17, 0.025, 0.15] },
          { position: [0.355, 0.71, 0.26], scale: [0.17, 0.025, 0.15] },
        ],
      ).name = 'fabricator-four-authored-shoulder-service-lids';
      this.addRoundedBox(
        enclosure,
        [0.135, 0.014, 0.115],
        readableShellTopMaterial,
        [-0.355, 0.731, 0.26],
        [0, -0.11, 0],
        0.018,
      ).name = 'fabricator-single-broad-weathered-shoulder-access-hatch';
      this.addRoundedBox(
        enclosure,
        [0.13, 0.012, 0.09],
        processGrimeMaterial,
        [0.355, 0.731, -0.26],
        [0, 0.2, 0],
        0.018,
      ).name = 'fabricator-single-broad-shoulder-oil-service-smear';
      this.addInstanceBatch(
        enclosure,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.16),
        rubbedEdgeMaterial,
        [
          { position: [-0.355, 0.729, -0.26], scale: [0.145, 0.012, 0.085], rotation: [0, 0.16, 0] },
          { position: [0.355, 0.729, 0.26], scale: [0.11, 0.012, 0.065], rotation: [0, -0.24, 0] },
        ],
      ).name = 'fabricator-two-broad-rubbed-shoulder-paint-loss-scars';
      this.addInstanceBatch(
        enclosure,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.16),
        processGrimeMaterial,
        [
          { position: [-0.438, 0.653, 0.09], scale: [0.105, 0.012, 0.22], rotation: [0, 0.08, 0] },
          { position: [0.438, 0.653, -0.18], scale: [0.085, 0.012, 0.15], rotation: [0, -0.12, 0] },
        ],
      ).name = 'fabricator-two-broad-asymmetric-shoulder-oil-darkening-zones';
      this.addInstanceBatch(
        enclosure,
        new RoundedBoxGeometry(1, 1, 1, 3, 0.12),
        shellMaterial,
        [
          { position: [-0.305, 0.505, 0], scale: [0.13, 0.085, 0.5] },
          { position: [0.305, 0.505, 0], scale: [0.13, 0.085, 0.5] },
        ],
      ).name = 'fabricator-stepped-inner-shoulder-fairings-closing-voids';
      this.addInstanceBatch(
        enclosure,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.09),
        readableShellTopMaterial,
        [
          { position: [-0.305, 0.556, 0], scale: [0.095, 0.022, 0.41] },
          { position: [0.305, 0.556, 0], scale: [0.095, 0.022, 0.41] },
        ],
      ).name = 'fabricator-aged-sage-inner-shoulder-wear-panels';
      this.addInstanceBatch(
        enclosure,
        new THREE.BoxGeometry(1, 1, 1),
        rubbedEdgeMaterial,
        [
          { position: [-0.235, 0.554, 0], scale: [0.018, 0.018, 0.43] },
          { position: [0.235, 0.554, 0], scale: [0.018, 0.018, 0.43] },
        ],
      ).name = 'fabricator-polished-inner-shoulder-tool-clearance-edges';
      this.addRoundedBox(
        enclosure,
        [0.15, 0.15, 0.57],
        shellMaterial,
        [-0.27, 0.535, 0],
        [0, 0, 0],
        0.035,
      ).name = 'fabricator-left-captured-service-trunk-closing-cavity';
      this.addRoundedBox(
        enclosure,
        [0.13, 0.018, 0.49],
        readableShellTopMaterial,
        [-0.27, 0.62, 0],
        [0, 0, 0],
        0.012,
      ).name = 'fabricator-readable-left-service-trunk-lid';
      this.addAtlasCroppedRoundedBox(
        enclosure,
        [0.1, 0.014, 0.2],
        this.materials.fabricatorPanel,
        [0.015, 0.485, 0.015, 0.485],
        [-0.27, 0.639, -0.115],
        [0, 0.07, 0],
        0.009,
      ).name = 'fabricator-left-service-trunk-broad-weathered-top-scar';
      this.addRoundedBox(
        enclosure,
        [0.07, 0.012, 0.2],
        readableShellTopMaterial,
        [-0.27, 0.637, 0.1],
        [0, 0, 0],
        0.009,
      ).name = 'fabricator-bounded-weathered-service-trunk-inspection-strip';
      this.addInstanceBatch(
        enclosure,
        new THREE.CylinderGeometry(1, 1, 1, 8, 1),
        this.materials.titaniumLight,
        [-0.19, -0.06, 0.1, 0.2].map((z, index) => ({
          position: [
            -0.265 + (index % 2 === 0 ? -0.025 : 0.025),
            0.628,
            z,
          ] as [number, number, number],
          scale: [0.012, 0.008, 0.012] as [number, number, number],
        })),
      ).name = 'fabricator-service-trunk-asymmetric-lid-fasteners';
      this.addRoundedBox(
        enclosure,
        [0.085, 0.025, 0.095],
        safetyPaintMaterial,
        [-0.265, 0.63, -0.12],
        [0, 0, 0],
        0.012,
      ).name = 'fabricator-service-trunk-recessed-ochre-release';
      this.addInstanceBatch(
        enclosure,
        new RoundedBoxGeometry(1, 1, 1, 3, 0.12),
        workDeckMaterial,
        [
          { position: [-0.205, 0.455, 0.315], scale: [0.18, 0.22, 0.065] },
          { position: [0.205, 0.455, 0.315], scale: [0.18, 0.22, 0.065] },
          { position: [-0.205, 0.415, -0.315], scale: [0.18, 0.16, 0.065] },
          { position: [0.205, 0.415, -0.315], scale: [0.18, 0.16, 0.065] },
        ],
      ).name = 'fabricator-split-mid-value-input-output-bay-backing-bulkheads';
      this.addInstanceBatch(
        enclosure,
        new THREE.BoxGeometry(1, 1, 1),
        rubbedEdgeMaterial,
        [
          { position: [-0.205, 0.575, 0.277], scale: [0.15, 0.018, 0.014] },
          { position: [0.205, 0.575, 0.277], scale: [0.15, 0.018, 0.014] },
          { position: [-0.205, 0.505, -0.353], scale: [0.15, 0.018, 0.014] },
          { position: [0.205, 0.505, -0.353], scale: [0.15, 0.018, 0.014] },
        ],
      ).name = 'fabricator-bulkhead-four-rubbed-bearing-ledges';
      this.addRoundedBox(
        enclosure,
        [0.14, 0.025, 0.16],
        castBedMaterial,
        [0.355, 0.738, 0.26],
        [0, 0, 0],
        0.018,
      ).name = 'fabricator-single-asymmetric-shoulder-vent-housing';
      this.addInstanceBatch(
        enclosure,
        new THREE.BoxGeometry(1, 1, 1),
        processGrimeMaterial,
        [0.215, 0.245, 0.275, 0.305].map((z) => ({
          position: [0.355, 0.754, z] as [number, number, number],
          scale: [0.095, 0.009, 0.011] as [number, number, number],
        })),
      ).name = 'fabricator-single-service-vent-four-recessed-louvers';
      this.addInstanceBatch(
        enclosure,
        new THREE.CylinderGeometry(1, 1, 1, 8, 1),
        this.materials.titaniumLight,
        [
          { position: [0.305, 0.755, 0.2], scale: [0.011, 0.008, 0.011] },
          { position: [0.405, 0.755, 0.32], scale: [0.011, 0.008, 0.011] },
        ],
      ).name = 'fabricator-vent-two-asymmetric-fasteners';
      this.addInstancedBeams(
        enclosure,
        this.materials.titanium,
        [
          { from: [-0.41, 0.66, -0.3], to: [-0.41, 0.66, 0.3], radius: 0.027 },
          { from: [0.41, 0.66, -0.3], to: [0.41, 0.66, 0.3], radius: 0.027 },
          { from: [-0.41, 0.66, 0.3], to: [0.41, 0.66, 0.3], radius: 0.027 },
          { from: [-0.41, 0.66, -0.3], to: [-0.27, 0.72, -0.14], radius: 0.022 },
          { from: [0.41, 0.66, -0.3], to: [0.27, 0.72, -0.14], radius: 0.022 },
          { from: [-0.27, 0.72, -0.14], to: [0.27, 0.72, -0.14], radius: 0.024 },
        ],
        8,
      ).name = 'fabricator-continuous-gantry-load-path';
      this.addTorus(
        enclosure,
        0.285,
        0.022,
        this.materials.titanium,
        [0, 0.235, 0],
        [Math.PI / 2, 0, 0],
      ).name = 'fabricator-guarded-turntable-well';
      this.addInstanceBatch(
        enclosure,
        new THREE.BoxGeometry(1, 1, 1),
        this.materials.amber,
        [
          { position: [-0.438, 0.44, -0.12], scale: [0.018, 0.21, 0.025] },
          { position: [-0.438, 0.44, 0.12], scale: [0.018, 0.21, 0.025] },
          { position: [0.438, 0.44, -0.12], scale: [0.018, 0.21, 0.025] },
          { position: [0.438, 0.44, 0.12], scale: [0.018, 0.21, 0.025] },
        ],
      ).name = 'fabricator-service-panel-recess-seams';

      // Replace the former black central tray with removable machine-tool
      // decking. The circular opening now reads as a guarded turntable well
      // cut into a solid enclosure, with supported lanes continuing to both
      // external ports.
      this.addRoundedBox(
        enclosure,
        [0.76, 0.055, 0.76],
        shellMaterial,
        [0, 0.195, 0],
        [0, 0, 0],
        0.04,
      ).name = 'fabricator-solid-painted-machine-pan';
      this.addInstanceBatch(
        enclosure,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.07),
        workDeckMaterial,
        [
          { position: [-0.285, 0.23, 0], scale: [0.23, 0.055, 0.62] },
          { position: [0.285, 0.23, 0], scale: [0.23, 0.055, 0.62] },
          { position: [0, 0.23, 0.285], scale: [0.34, 0.055, 0.2] },
          { position: [0, 0.23, -0.285], scale: [0.34, 0.055, 0.2] },
        ],
      ).name = 'fabricator-four-piece-bolted-machine-deck';
      this.addInstanceBatch(
        enclosure,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
        workDeckMaterial,
        [
          { position: [-0.305, 0.325, 0], scale: [0.095, 0.025, 0.5] },
          { position: [0.305, 0.325, 0], scale: [0.095, 0.025, 0.5] },
        ],
      ).name = 'fabricator-two-shallow-inner-work-cell-cavity-liners';
      this.addAtlasCroppedRoundedBox(
        enclosure,
        [0.23, 0.012, 0.12],
        rustedAccessMaterial,
        [0.515, 0.985, 0.015, 0.485],
        [0.08, 0.266, -0.285],
        [0, -0.08, 0],
        0.012,
      ).name = 'fabricator-lower-work-deck-asymmetric-chipped-access-field';
      this.addRoundedBox(
        enclosure,
        [0.2, 0.014, 0.032],
        rubbedEdgeMaterial,
        [0.075, 0.274, -0.218],
        [0, 0.09, 0],
        0.008,
      ).name = 'fabricator-lower-work-deck-single-readable-rubbed-edge-band';
      this.addInstanceBatch(
        enclosure,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.16),
        rustChipMaterial,
        [
          { position: [-0.24, 0.19, 0.387], scale: [0.07, 0.03, 0.01], rotation: [0, 0, 0.08] },
          { position: [-0.08, 0.21, 0.389], scale: [0.095, 0.04, 0.009], rotation: [0, 0, -0.07] },
          { position: [0.09, 0.185, 0.388], scale: [0.055, 0.027, 0.011], rotation: [0, 0, 0.1] },
          { position: [0.25, 0.205, 0.386], scale: [0.08, 0.035, 0.01], rotation: [0, 0, -0.06] },
        ],
        false,
      ).name = 'fabricator-visible-front-wall-four-readable-rust-losses';
      this.addRoundedBox(
        enclosure,
        [0.22, 0.018, 0.01],
        rubbedEdgeMaterial,
        [0, 0.225, 0.39],
        [0, 0, 0],
        0.007,
      ).name = 'fabricator-visible-front-wall-bright-rubbed-horizontal-edge';
      this.addInstanceBatch(
        enclosure,
        new THREE.BoxGeometry(1, 1, 1),
        this.materials.titanium,
        [
          { position: [-0.19, 0.27, 0], scale: [0.025, 0.025, 0.5] },
          { position: [0.19, 0.27, 0], scale: [0.025, 0.025, 0.5] },
          { position: [0, 0.27, -0.19], scale: [0.34, 0.025, 0.025] },
          { position: [0, 0.27, 0.19], scale: [0.34, 0.025, 0.025] },
        ],
      ).name = 'fabricator-machine-deck-recess-joints';

      const oiledSteelMaterial = this.materials.titanium.clone();
      oiledSteelMaterial.name = 'fabricator-function-specific-oiled-steel';
      oiledSteelMaterial.color.set('#7f8b87');
      oiledSteelMaterial.emissive.set('#151b1a');
      oiledSteelMaterial.emissiveIntensity = 0.015;
      oiledSteelMaterial.roughness = 0.46;
      oiledSteelMaterial.metalness = 0.74;
      rig.ownedMaterials.push(oiledSteelMaterial);
      const mechanismGreenMaterial = this.materials.signalTemplate.clone();
      mechanismGreenMaterial.name = 'fabricator-non-emissive-board-tooling';
      mechanismGreenMaterial.color.set('#356044');
      mechanismGreenMaterial.emissive.set('#07150d');
      mechanismGreenMaterial.emissiveIntensity = 0.04;
      mechanismGreenMaterial.roughness = 0.58;
      mechanismGreenMaterial.metalness = 0.22;
      rig.ownedMaterials.push(mechanismGreenMaterial);
      const coreToolMaterial = this.materials.signalTemplate.clone();
      coreToolMaterial.name = 'fabricator-core-electromechanical-tooling';
      coreToolMaterial.color.set('#4f9b98');
      coreToolMaterial.emissive.set('#153f43');
      coreToolMaterial.emissiveIntensity = 0.18;
      coreToolMaterial.roughness = 0.42;
      coreToolMaterial.metalness = 0.46;
      rig.ownedMaterials.push(coreToolMaterial);

      // A single supported route makes fabrication causal in one glance:
      // rear magazine rollers feed the indexed table, then a guarded takeaway
      // conveyor exits at the front. Every moving part terminates on a bearing
      // or enclosure face.
      const materialPath = new THREE.Group();
      materialPath.name = 'fabricator-rear-input-through-toolhead-to-front-output';
      enclosure.add(materialPath);
      this.addRoundedBox(
        materialPath,
        [0.4, 0.18, 0.19],
        shellMaterial,
        [0, 0.42, 0.46],
        [0, 0, 0],
        0.035,
      ).name = 'fabricator-permanent-raised-input-magazine';
      this.addRoundedBox(
        materialPath,
        [0.5, 0.22, 0.12],
        workDeckMaterial,
        [0, 0.375, 0.49],
        [0, 0, 0],
        0.032,
      ).name = 'fabricator-broad-mid-value-rear-input-throat-load-skirt';
      this.addRoundedBox(
        materialPath,
        [0.42, 0.018, 0.055],
        rubbedEdgeMaterial,
        [0, 0.495, 0.535],
        [0, 0, 0],
        0.01,
      ).name = 'fabricator-rear-throat-rubbed-transfer-lip';
      this.addInstanceBatch(
        materialPath,
        new RoundedBoxGeometry(1, 1, 1, 3, 0.12),
        workDeckMaterial,
        [
          { position: [-0.22, 0.48, 0.545], scale: [0.16, 0.38, 0.085] },
          { position: [0.22, 0.48, 0.545], scale: [0.16, 0.38, 0.085] },
          { position: [0, 0.31, 0.545], scale: [0.28, 0.12, 0.085] },
          { position: [0, 0.665, 0.545], scale: [0.28, 0.09, 0.085] },
        ],
      ).name = 'fabricator-mid-value-rear-port-four-piece-structural-surround';
      this.addInstanceBatch(
        materialPath,
        new THREE.BoxGeometry(1, 1, 1),
        rubbedEdgeMaterial,
        [
          { position: [-0.132, 0.49, 0.496], scale: [0.018, 0.24, 0.014] },
          { position: [0.132, 0.49, 0.496], scale: [0.018, 0.24, 0.014] },
          { position: [0, 0.61, 0.496], scale: [0.245, 0.018, 0.014] },
        ],
      ).name = 'fabricator-rear-port-three-rubbed-opening-edges';
      this.addRoundedBox(
        materialPath,
        [0.32, 0.08, 0.38],
        oiledSteelMaterial,
        [0, 0.34, 0.32],
        [-0.12, 0, 0],
        0.02,
      ).name = 'fabricator-enclosed-input-indexing-bed';
      const inputRollers = [0.22, 0.34, 0.46].map((z) =>
        this.addCylinder(
          materialPath,
          0.038,
          0.3,
          this.materials.titaniumLight,
          [0, 0.39, z],
          [0, 0, Math.PI / 2],
          12,
        ));
      inputRollers.forEach((roller) => {
        roller.name = 'fabricator-supported-input-indexing-roller';
      });
      this.addInstanceBatch(
        materialPath,
        new THREE.BoxGeometry(1, 1, 1),
        castBedMaterial,
        [
          { position: [-0.17, 0.38, 0.34], scale: [0.03, 0.12, 0.38] },
          { position: [0.17, 0.38, 0.34], scale: [0.03, 0.12, 0.38] },
        ],
      ).name = 'fabricator-input-magazine-guide-rails';
      this.addRoundedBox(
        materialPath,
        [0.38, 0.09, 0.4],
        oiledSteelMaterial,
        [0, 0.29, -0.33],
        [0.12, 0, 0],
        0.02,
      ).name = 'fabricator-guarded-front-takeaway-bed';
      this.addRoundedBox(
        materialPath,
        [0.46, 0.17, 0.11],
        castBedMaterial,
        [0, 0.32, -0.48],
        [0, 0, 0],
        0.03,
      ).name = 'fabricator-broad-front-output-throat-load-skirt';
      const outputRollers = [-0.22, -0.34, -0.46].map((z) =>
        this.addCylinder(
          materialPath,
          0.04,
          0.34,
          this.materials.titaniumLight,
          [0, 0.345, z],
          [0, 0, Math.PI / 2],
          12,
        ));
      outputRollers.forEach((roller) => {
        roller.name = 'fabricator-supported-output-takeaway-roller';
      });
      this.addInstanceBatch(
        materialPath,
        new THREE.BoxGeometry(1, 1, 1),
        castBedMaterial,
        [
          { position: [-0.2, 0.34, -0.34], scale: [0.03, 0.13, 0.4] },
          { position: [0.2, 0.34, -0.34], scale: [0.03, 0.13, 0.4] },
          { position: [0, 0.38, -0.51], scale: [0.43, 0.09, 0.04] },
        ],
      ).name = 'fabricator-output-guard-rails-and-stop-lip';
      this.addInstancedBeams(
        materialPath,
        rubbedEdgeMaterial,
        [
          { from: [-0.155, 0.38, 0.49], to: [-0.155, 0.38, -0.49], radius: 0.024 },
          { from: [0.155, 0.38, 0.49], to: [0.155, 0.38, -0.49], radius: 0.024 },
        ],
        10,
      ).name = 'fabricator-unbroken-rear-tool-front-polished-guide-rails';
      this.addInstanceBatch(
        materialPath,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.12),
        castBedMaterial,
        [
          { position: [-0.155, 0.38, -0.49], scale: [0.085, 0.085, 0.075] },
          { position: [0.155, 0.38, -0.49], scale: [0.085, 0.085, 0.075] },
          { position: [-0.155, 0.38, 0.49], scale: [0.085, 0.085, 0.075] },
          { position: [0.155, 0.38, 0.49], scale: [0.085, 0.085, 0.075] },
        ],
      ).name = 'fabricator-four-captured-guide-rail-terminal-blocks';
      this.addInstanceBatch(
        materialPath,
        new THREE.CylinderGeometry(1, 1, 1, 12, 1),
        rubbedEdgeMaterial,
        [
          [-0.155, 0.427, -0.49],
          [0.155, 0.427, -0.49],
          [-0.155, 0.427, 0.49],
          [0.155, 0.427, 0.49],
        ].map(([x, y, z]) => ({
          position: [x, y, z] as [number, number, number],
          scale: [0.028, 0.014, 0.028] as [number, number, number],
        })),
      ).name = 'fabricator-four-guide-rail-terminal-bearing-caps';
      this.addInstanceBatch(
        materialPath,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.09),
        workDeckMaterial,
        [-0.43, -0.24, 0.24, 0.43].map((z) => ({
          position: [0, 0.335, z] as [number, number, number],
          scale: [0.38, 0.035, 0.045] as [number, number, number],
        })),
      ).name = 'fabricator-four-supported-transfer-rail-sleepers';
      this.addInstanceBatch(
        materialPath,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.09),
        workDeckMaterial,
        [
          { position: [-0.19, 0.305, 0], scale: [0.18, 0.035, 0.5] },
          { position: [0.19, 0.305, 0], scale: [0.18, 0.035, 0.5] },
          { position: [0, 0.305, 0.19], scale: [0.22, 0.035, 0.14] },
          { position: [0, 0.305, -0.19], scale: [0.22, 0.035, 0.14] },
        ],
      ).name = 'fabricator-raised-four-piece-swarf-tray-closing-black-pockets';
      // A segmented mid-value backplane sits immediately beneath the
      // transfer hardware. It removes the remaining terrain-black cavities
      // without turning the work cell into one broad flat slab; each panel
      // has an independent seam, load edge, and fastener rhythm.
      this.addInstanceBatch(
        materialPath,
        new RoundedBoxGeometry(1, 1, 1, 3, 0.11),
        readableShellTopMaterial,
        [
          { position: [-0.205, 0.342, 0.02], scale: [0.19, 0.04, 0.52] },
          { position: [0.205, 0.342, 0.02], scale: [0.19, 0.04, 0.52] },
          { position: [0, 0.342, 0.205], scale: [0.22, 0.04, 0.15] },
          { position: [0, 0.342, -0.205], scale: [0.22, 0.04, 0.15] },
        ],
      ).name = 'fabricator-segmented-mid-value-machinery-backplane';
      this.addInstanceBatch(
        materialPath,
        new THREE.BoxGeometry(1, 1, 1),
        rubbedEdgeMaterial,
        [
          { position: [-0.105, 0.367, 0], scale: [0.018, 0.012, 0.5] },
          { position: [0.105, 0.367, 0], scale: [0.018, 0.012, 0.5] },
          { position: [0, 0.367, -0.105], scale: [0.2, 0.012, 0.018] },
          { position: [0, 0.367, 0.105], scale: [0.2, 0.012, 0.018] },
        ],
      ).name = 'fabricator-backplane-four-rubbed-service-seams';
      this.addInstanceBatch(
        materialPath,
        new THREE.CylinderGeometry(1, 1, 1, 8, 1),
        this.materials.titaniumLight,
        [
          [-0.28, 0.371, -0.2],
          [0.28, 0.371, -0.2],
          [-0.28, 0.371, 0.2],
          [0.28, 0.371, 0.2],
          [-0.11, 0.371, -0.29],
          [0.11, 0.371, 0.29],
        ].map(([x, y, z]) => ({
          position: [x, y, z] as [number, number, number],
          scale: [0.013, 0.008, 0.013] as [number, number, number],
        })),
      ).name = 'fabricator-backplane-asymmetric-visible-fasteners';
      this.addInstancedBeams(
        materialPath,
        oiledSteelMaterial,
        [
          { from: [-0.26, 0.445, -0.14], to: [0.26, 0.445, -0.14], radius: 0.025 },
          { from: [-0.26, 0.445, 0.14], to: [0.26, 0.445, 0.14], radius: 0.025 },
        ],
        10,
      ).name = 'fabricator-two-dominant-tooling-cross-ties';
      this.addInstanceBatch(
        materialPath,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.12),
        castBedMaterial,
        [
          { position: [-0.21, 0.455, 0.14], scale: [0.09, 0.055, 0.095] },
          { position: [0.21, 0.455, -0.14], scale: [0.09, 0.055, 0.095] },
        ],
      ).name = 'fabricator-two-asymmetric-captured-tooling-bearings';
      this.addInstanceBatch(
        materialPath,
        new THREE.CylinderGeometry(1, 1, 1, 12, 1),
        rubbedEdgeMaterial,
        [
          { position: [-0.21, 0.492, 0.14], scale: [0.034, 0.02, 0.034] },
          { position: [0.21, 0.492, -0.14], scale: [0.034, 0.02, 0.034] },
        ],
      ).name = 'fabricator-two-visible-bearing-caps';
      this.addInstanceBatch(
        materialPath,
        new THREE.CylinderGeometry(1, 1, 1, 12, 1),
        this.materials.titaniumLight,
        [-0.42, -0.25, 0.25, 0.42].map((z) => ({
          position: [0, 0.382, z] as [number, number, number],
          scale: [0.026, 0.29, 0.026] as [number, number, number],
          rotation: [0, 0, Math.PI / 2] as [number, number, number],
        })),
      ).name = 'fabricator-four-causal-transfer-spine-rollers';
      this.addInstanceBatch(
        materialPath,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.12),
        safetyPaintMaterial,
        [
          { position: [0, 0.397, 0.285], scale: [0.35, 0.018, 0.035] },
          { position: [0, 0.397, -0.285], scale: [0.35, 0.018, 0.035] },
        ],
      ).name = 'fabricator-two-physical-transfer-spine-clamp-bands';
      this.addTorus(
        materialPath,
        0.255,
        0.018,
        oiledSteelMaterial,
        [0, 0.285, 0],
        [Math.PI / 2, 0, 0],
      ).name = 'fabricator-bearing-polish-and-oil-wear-ring';

      const processTooling = new THREE.Group();
      processTooling.name = 'fabricator-recipe-specific-working-tooling';
      processTooling.position.set(0, 0.43, 0);
      materialPath.add(processTooling);
      const processRecipe = fabricatorRecipe;
      processTooling.userData.recipeIdentity = processRecipe;
      const feedStock = new THREE.Group();
      feedStock.name = `fabricator-${processRecipe}-visible-rear-feed-stock`;
      feedStock.position.set(0, 0.53, 0.4);
      feedStock.userData.baseY = 0.53;
      feedStock.userData.baseZ = 0.4;
      feedStock.userData.recipeIdentity = processRecipe;
      materialPath.add(feedStock);
      rig.parts.recipeFeedStock = feedStock;
      this.addRoundedBox(
        feedStock,
        [0.4, 0.045, 0.27],
        workDeckMaterial,
        [0, -0.05, 0],
        [0, 0, 0],
        0.025,
      ).name = 'fabricator-supported-rear-feed-carrier';
      this.addRoundedBox(
        feedStock,
        [0.34, 0.1, 0.2],
        castBedMaterial,
        [0, -0.105, 0],
        [0, 0, 0],
        0.025,
      ).name = 'fabricator-rear-feed-carrier-visible-load-skirt';
      this.addInstanceBatch(
        feedStock,
        new THREE.BoxGeometry(1, 1, 1),
        rubbedEdgeMaterial,
        [
          { position: [-0.15, -0.015, 0], scale: [0.022, 0.025, 0.23] },
          { position: [0.15, -0.015, 0], scale: [0.022, 0.025, 0.23] },
        ],
      ).name = 'fabricator-rear-feed-carrier-twin-retaining-rails';
      const productShuttle = new THREE.Group();
      productShuttle.name =
        `fabricator-${processRecipe}-visible-output-product-shuttle`;
      productShuttle.position.set(0.34, 0.49, -0.34);
      productShuttle.userData.baseY = 0.49;
      productShuttle.userData.baseZ = -0.34;
      productShuttle.userData.recipeIdentity = processRecipe;
      materialPath.add(productShuttle);
      rig.parts.recipeProductShuttle = productShuttle;
      this.addRoundedBox(
        productShuttle,
        [0.42, 0.045, 0.27],
        workDeckMaterial,
        [0, -0.07, 0],
        [0, 0, 0],
        0.025,
      ).name = 'fabricator-supported-front-product-pallet';
      this.addRoundedBox(
        productShuttle,
        [0.35, 0.065, 0.13],
        castBedMaterial,
        [0, -0.12, 0],
        [0, 0, 0],
        0.022,
      ).name = 'fabricator-product-pallet-visible-crossmember-skirt';
      this.addInstanceBatch(
        productShuttle,
        new THREE.BoxGeometry(1, 1, 1),
        rubbedEdgeMaterial,
        [
          { position: [-0.15, -0.035, 0], scale: [0.025, 0.025, 0.23] },
          { position: [0.15, -0.035, 0], scale: [0.025, 0.025, 0.23] },
        ],
      ).name = 'fabricator-product-pallet-twin-retaining-rails';
      this.addInstanceBatch(
        productShuttle,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.11),
        castBedMaterial,
        [
          { position: [-0.15, -0.115, 0], scale: [0.055, 0.09, 0.09] },
          { position: [0.15, -0.115, 0], scale: [0.055, 0.09, 0.09] },
        ],
      ).name = 'fabricator-product-pallet-two-load-bearing-pedestals';
      if (processRecipe === 'ironGear') {
        this.addInstanceBatch(
          feedStock,
          new RoundedBoxGeometry(1, 1, 1, 2, 0.12),
          rubbedEdgeMaterial,
          [
            { position: [-0.11, 0, 0.02], scale: [0.12, 0.035, 0.17] },
            { position: [0, 0.025, 0], scale: [0.12, 0.035, 0.17] },
            { position: [0.11, 0.05, -0.02], scale: [0.12, 0.035, 0.17] },
          ],
        ).name = 'fabricator-gear-three-stacked-steel-feed-plates';
        const hob = new THREE.Group();
        hob.name = 'fabricator-gear-hobbing-head';
        hob.position.set(0, 0.15, 0);
        processTooling.add(hob);
        // Only the cutter rotates. The headstock, guards, bearings, and work
        // clamp stay tied to the bed so the animation reads as a powered
        // machine operation instead of the whole prop pirouetting in place.
        const hobRotor = new THREE.Group();
        hobRotor.name = 'fabricator-gear-rotating-hob-cutter';
        hobRotor.userData.actuation = 'gear-hob';
        hob.add(hobRotor);
        this.addTorus(
          hobRotor,
          0.19,
          0.045,
          this.materials.titaniumLight,
          [0, 0, 0],
          [Math.PI / 2, 0, 0],
        );
        this.addInstanceBatch(
          hobRotor,
          new THREE.BoxGeometry(1, 1, 1),
          this.materials.titaniumLight,
          Array.from({ length: 12 }, (_, index) => {
            const angle = index * Math.PI / 6;
            return {
              position: [Math.sin(angle) * 0.245, 0, Math.cos(angle) * 0.245] as [number, number, number],
              scale: [0.055, 0.06, 0.085] as [number, number, number],
              rotation: [0, angle, 0] as [number, number, number],
            };
          }),
        ).name = 'fabricator-gear-hob-twelve-cutters';
        this.addCylinder(
          hobRotor,
          0.065,
          0.24,
          this.materials.agedCopper,
          [0, 0.12, 0],
          [0, 0, 0],
          14,
        ).name = 'fabricator-gear-hob-driven-arbor';
        this.addInstanceBatch(
          hob,
          new RoundedBoxGeometry(1, 1, 1, 2, 0.1),
          castBedMaterial,
          [
            { position: [-0.285, -0.14, 0.11], scale: [0.095, 0.25, 0.15] },
            { position: [0.285, -0.14, 0.11], scale: [0.095, 0.25, 0.15] },
          ],
        ).name = 'fabricator-gear-hob-twin-bearing-pedestals';
        this.addInstanceBatch(
          hob,
          new THREE.CylinderGeometry(1, 1, 1, 14, 1),
          oiledSteelMaterial,
          [-0.285, 0.285].map((x) => ({
            position: [x, -0.015, 0.035] as [number, number, number],
            scale: [0.078, 0.055, 0.078] as [number, number, number],
          })),
        ).name = 'fabricator-gear-hob-twin-captured-bearings';
        this.addCylinder(
          hob,
          0.112,
          0.055,
          oiledSteelMaterial,
          [0, -0.083, 0],
          [0, 0, 0],
          18,
        ).name = 'fabricator-gear-clamped-workpiece-blank';
        this.addCylinder(
          hob,
          0.045,
          0.09,
          this.materials.carbonDark,
          [0, -0.145, 0],
          [0, 0, 0],
          12,
        ).name = 'fabricator-gear-workpiece-table-collet';
        this.addRoundedBox(
          hob,
          [0.62, 0.13, 0.18],
          oiledSteelMaterial,
          [0, 0.19, 0.2],
          [0, 0, 0],
          0.035,
        ).name = 'fabricator-gear-heavy-hob-headstock';
        this.addInstanceBatch(
          hob,
          new THREE.BoxGeometry(1, 1, 1),
          safetyPaintMaterial,
          [
            { position: [-0.27, 0.22, 0.12], scale: [0.035, 0.16, 0.24] },
            { position: [0.27, 0.22, 0.12], scale: [0.035, 0.16, 0.24] },
          ],
        ).name = 'fabricator-gear-hob-safety-cheeks';
        rig.parts.recipeMechanismRotor = hobRotor;
        const outputGear = new THREE.Group();
        outputGear.name = 'fabricator-gear-machined-output-wheel';
        productShuttle.add(outputGear);
        this.addTorus(
          outputGear,
          0.115,
          0.035,
          this.materials.titaniumLight,
          [0, 0, 0],
          [Math.PI / 2, 0, 0],
        );
        this.addInstanceBatch(
          outputGear,
          new THREE.BoxGeometry(1, 1, 1),
          this.materials.titaniumLight,
          Array.from({ length: 10 }, (_, index) => {
            const angle = index * Math.PI / 5;
            return {
              position: [
                Math.sin(angle) * 0.155,
                0,
                Math.cos(angle) * 0.155,
              ] as [number, number, number],
              scale: [0.045, 0.055, 0.065] as [number, number, number],
              rotation: [0, angle, 0] as [number, number, number],
            };
          }),
        ).name = 'fabricator-gear-output-ten-cut-teeth';
        this.addInstancedBeams(
          outputGear,
          this.materials.titaniumLight,
          Array.from({ length: 5 }, (_, index) => {
            const angle = index * Math.PI * 2 / 5;
            return {
              from: [0, 0.018, 0] as [number, number, number],
              to: [
                Math.sin(angle) * 0.105,
                0.018,
                Math.cos(angle) * 0.105,
              ] as [number, number, number],
              radius: 0.018,
            };
          }),
          8,
        ).name = 'fabricator-gear-output-five-load-bearing-spokes';
        this.addCylinder(
          outputGear,
          0.045,
          0.075,
          oiledSteelMaterial,
          [0, 0.025, 0],
          [0, 0, 0],
          14,
        ).name = 'fabricator-gear-output-keyed-center-hub';
      } else if (processRecipe === 'copperWire') {
        const drawnWireRouteMaterial = fabricatorCopperMaterial.clone();
        drawnWireRouteMaterial.name =
          'fabricator-single-readable-drawn-wire-route-material';
        drawnWireRouteMaterial.color.set('#d78a52');
        drawnWireRouteMaterial.emissive.set('#351307');
        drawnWireRouteMaterial.emissiveIntensity = 0.025;
        drawnWireRouteMaterial.roughness = 0.4;
        drawnWireRouteMaterial.metalness = 0.76;
        drawnWireRouteMaterial.vertexColors = false;
        rig.ownedMaterials.push(drawnWireRouteMaterial);
        this.addInstanceBatch(
          feedStock,
          new RoundedBoxGeometry(1, 1, 1, 2, 0.12),
          this.materials.agedCopper,
          [
            { position: [-0.095, 0, 0.02], scale: [0.14, 0.03, 0.18] },
            { position: [0.045, 0.025, -0.015], scale: [0.14, 0.03, 0.18] },
          ],
        ).name = 'fabricator-wire-two-stacked-copper-feed-plates';
        const spool = new THREE.Group();
        spool.name = 'fabricator-wire-drawing-spool-and-die';
        spool.position.set(-0.015, 0.005, 0.015);
        processTooling.add(spool);
        const spoolRotor = new THREE.Group();
        spoolRotor.name = 'fabricator-wire-rotating-takeup-spool';
        spoolRotor.position.set(-0.14, 0.14, 0.04);
        spoolRotor.userData.actuation = 'wire-spool';
        spool.add(spoolRotor);
        for (const z of [-0.06, 0.06]) {
          this.addTorus(
            spoolRotor,
            0.16,
            0.035,
            oiledSteelMaterial,
            [0, 0, z],
            [0, 0, 0],
          );
        }
        this.addCylinder(
          spoolRotor,
          0.055,
          0.17,
          this.materials.titanium,
          [0, 0, 0],
          [Math.PI / 2, 0, 0],
          12,
        ).name = 'fabricator-wire-spool-supported-arbor';
        this.addCylinder(
          spoolRotor,
          0.11,
          0.105,
          fabricatorCopperMaterial,
          [0, 0, 0],
          [Math.PI / 2, 0, 0],
          18,
        ).name = 'fabricator-wire-visible-winding-pack';
        this.addInstanceBatch(
          spool,
          new RoundedBoxGeometry(1, 1, 1, 2, 0.09),
          castBedMaterial,
          [
            { position: [-0.14, 0.015, -0.085], scale: [0.1, 0.23, 0.07] },
            { position: [-0.14, 0.015, 0.165], scale: [0.1, 0.23, 0.07] },
          ],
        ).name = 'fabricator-wire-spool-twin-bearing-cradle';
        this.addInstanceBatch(
          spool,
          new THREE.CylinderGeometry(1, 1, 1, 12, 1),
          safetyPaintMaterial,
          [-0.085, 0.165].map((z) => ({
            position: [-0.14, 0.14, z] as [number, number, number],
            scale: [0.055, 0.035, 0.055] as [number, number, number],
            rotation: [Math.PI / 2, 0, 0] as [number, number, number],
          })),
        ).name = 'fabricator-wire-spool-ochre-bearing-caps';
        this.addRoundedBox(
          spool,
          [0.26, 0.13, 0.29],
          castBedMaterial,
          [0.16, -0.045, -0.04],
          [0, 0, 0],
          0.03,
        ).name = 'fabricator-wire-die-load-bearing-plinth';
        this.addRoundedBox(
          spool,
          [0.19, 0.16, 0.18],
          this.materials.agedCeramic,
          [0.16, 0.08, -0.04],
          [0, 0, 0],
          0.025,
        ).name = 'fabricator-wire-drawing-die-block';
        this.addInstancedBeams(
          spool,
          drawnWireRouteMaterial,
          [
            { from: [-0.02, 0.13, 0.04], to: [0.16, 0.13, -0.04], radius: 0.012 },
          ],
          10,
        ).name = 'fabricator-wire-through-die-strand';
        this.addRoundedBox(
          spool,
          [0.22, 0.2, 0.24],
          oiledSteelMaterial,
          [0.2, 0.11, -0.05],
          [0, 0, 0],
          0.035,
        ).name = 'fabricator-wire-drawing-die-housing';
        const continuousWireRoute = new THREE.CatmullRomCurve3(
          [
            new THREE.Vector3(0, 0.62, 0.4),
            new THREE.Vector3(-0.19, 0.75, 0.29),
            new THREE.Vector3(-0.24, 0.79, 0.1),
            new THREE.Vector3(-0.23, 0.79, -0.08),
            new THREE.Vector3(-0.12, 0.76, -0.2),
            new THREE.Vector3(0.12, 0.7, -0.28),
            new THREE.Vector3(0.34, 0.545, -0.34),
          ],
          false,
          'centripetal',
        );
        this.addMesh(
          materialPath,
          new THREE.TubeGeometry(continuousWireRoute, 28, 0.012, 8, false),
          drawnWireRouteMaterial,
        ).name = 'fabricator-wire-one-joined-stock-draw-throat-route';
        this.addInstanceBatch(
          materialPath,
          new RoundedBoxGeometry(1, 1, 1, 2, 0.12),
          castBedMaterial,
          [
            { position: [0, 0.575, 0.4], scale: [0.12, 0.07, 0.085] },
            { position: [-0.24, 0.735, 0.1], scale: [0.105, 0.07, 0.09] },
            { position: [-0.23, 0.735, -0.08], scale: [0.11, 0.075, 0.09] },
            { position: [0.12, 0.645, -0.28], scale: [0.105, 0.07, 0.085] },
          ],
        ).name = 'fabricator-wire-four-visible-route-guide-saddles';
        this.addInstanceBatch(
          materialPath,
          new THREE.CylinderGeometry(1, 1, 1, 12, 1),
          rubbedEdgeMaterial,
          [
            [0, 0.625, 0.4],
            [-0.24, 0.78, 0.1],
            [-0.23, 0.78, -0.08],
            [0.12, 0.69, -0.28],
          ].map(([x, y, z]) => ({
            position: [x, y, z] as [number, number, number],
            scale: [0.032, 0.018, 0.032] as [number, number, number],
          })),
        ).name = 'fabricator-wire-four-polished-route-guide-caps';
        rig.parts.recipeMechanismRotor = spoolRotor;
        this.addMesh(
          productShuttle,
          createStrappedCoilGeometry(0.082, 0.014),
          fabricatorCopperMaterial,
          [0, 0.035, 0],
          [0, 0, Math.PI / 2],
        ).name = 'fabricator-wire-single-finished-strapped-output-coil';
      } else if (processRecipe === 'circuit') {
        this.addRoundedBox(
          processTooling,
          [0.5, 0.07, 0.34],
          mechanismGreenMaterial,
          [0, 0.06, 0],
          [0, 0.08, 0],
          0.025,
        ).name = 'fabricator-circuit-indexing-carrier';
        const pickHeads = this.addInstanceBatch(
          processTooling,
          new THREE.CylinderGeometry(1, 1, 1, 12, 1),
          this.materials.titaniumLight,
          [-0.14, 0, 0.14].map((x) => ({
            position: [x, 0.2, 0] as [number, number, number],
            scale: [0.045, 0.24, 0.045] as [number, number, number],
          })),
        );
        pickHeads.name = 'fabricator-circuit-three-pick-heads';
        pickHeads.userData.baseY = 0;
        pickHeads.userData.actuation = 'pick-and-place';
        rig.parts.recipeMechanismActuator = pickHeads;
        this.addInstanceBatch(
          processTooling,
          new THREE.BoxGeometry(1, 1, 1),
          this.materials.agedCopper,
          [
            { position: [0, 0.11, -0.08], scale: [0.32, 0.025, 0.025] },
            { position: [0, 0.11, 0.08], scale: [0.32, 0.025, 0.025] },
          ],
        ).name = 'fabricator-circuit-carrier-contact-rails';
        this.addRoundedBox(
          processTooling,
          [0.58, 0.11, 0.16],
          oiledSteelMaterial,
          [0, 0.31, 0.13],
          [0, 0, 0],
          0.03,
        ).name = 'fabricator-circuit-pick-head-gantry';
        this.addInstanceBatch(
          processTooling,
          new THREE.CylinderGeometry(1, 1, 1, 10, 1),
          this.materials.agedCopper,
          [
            { position: [-0.22, 0.12, 0.2], scale: [0.07, 0.09, 0.07] },
            { position: [0.22, 0.12, 0.2], scale: [0.07, 0.09, 0.07] },
          ],
        ).name = 'fabricator-circuit-component-feed-bins';
        this.addRoundedBox(
          productShuttle,
          [0.38, 0.065, 0.26],
          mechanismGreenMaterial,
          [0, 0, 0],
          [0, 0.06, 0],
          0.025,
        ).name = 'fabricator-circuit-finished-board-output';
        this.addInstanceBatch(
          productShuttle,
          new THREE.CylinderGeometry(1, 1, 1, 8, 1),
          this.materials.copperBright,
          [-0.12, 0, 0.12].map((x) => ({
            position: [x, 0.055, 0] as [number, number, number],
            scale: [0.032, 0.045, 0.032] as [number, number, number],
          })),
        ).name = 'fabricator-circuit-finished-board-components';
      } else if (processRecipe === 'automationCore') {
        const stator = this.addCylinder(
          processTooling,
          0.23,
          0.15,
          oiledSteelMaterial,
          [0, 0.09, 0],
          [0, 0, 0],
          18,
        );
        stator.name = 'fabricator-core-winding-stator';
        stator.userData.actuation = 'core-stator';
        rig.parts.recipeMechanismRotor = stator;
        this.addCylinder(
          processTooling,
          0.105,
          0.22,
          coreToolMaterial,
          [0, 0.2, 0],
          [0, 0, 0],
          14,
        ).name = 'fabricator-core-visible-cyan-rotor';
        this.addTorus(
          processTooling,
          0.18,
          0.035,
          this.materials.agedCopper,
          [0, 0.19, 0],
          [Math.PI / 2, 0, 0],
        ).name = 'fabricator-core-winding-pack';
        for (const x of [-0.17, 0.17]) {
          this.addTorus(
            processTooling,
            0.16,
            0.035,
            this.materials.agedCopper,
            [x, 0.22, 0],
            [0, Math.PI / 2, 0],
          ).name = 'fabricator-core-twin-winding-yokes';
        }
        this.addInstancedBeams(
          processTooling,
          this.materials.titaniumLight,
          [
            { from: [-0.17, 0.18, 0], to: [0, 0.3, 0], radius: 0.026 },
            { from: [0.17, 0.18, 0], to: [0, 0.3, 0], radius: 0.026 },
          ],
          10,
        ).name = 'fabricator-core-yoke-load-path';
        this.addRoundedBox(
          processTooling,
          [0.62, 0.12, 0.18],
          oiledSteelMaterial,
          [0, 0.36, 0.14],
          [0, 0, 0],
          0.03,
        ).name = 'fabricator-core-winding-headstock';
        const coreOutput = this.addCylinder(
          productShuttle,
          0.13,
          0.13,
          coreToolMaterial,
          [0, 0, 0],
          [0, 0, 0],
          6,
        );
        coreOutput.name = 'fabricator-core-finished-hex-rotor-output';
        this.addTorus(
          productShuttle,
          0.15,
          0.03,
          this.materials.agedCopper,
          [0, 0.075, 0],
          [Math.PI / 2, 0, 0],
        ).name = 'fabricator-core-finished-copper-winding-output';
      } else {
        this.addRoundedBox(
          processTooling,
          [0.32, 0.1, 0.26],
          this.materials.titanium,
          [0, 0.08, 0],
          [0, 0, 0],
          0.025,
        ).name = 'fabricator-empty-tooling-carrier';
        this.addCylinder(
          processTooling,
          0.11,
          0.07,
          this.materials.carbonDark,
          [0, 0.16, 0],
          [0, 0, 0],
          16,
        ).name = 'fabricator-empty-tool-socket';
      }
      const recipeWearMaterial =
        processRecipe === 'copperWire'
          ? fabricatorCopperMaterial
          : processRecipe === 'circuit'
            ? mechanismGreenMaterial
            : processRecipe === 'automationCore'
              ? this.materials.agedCopper
              : rubbedEdgeMaterial;
      const wearMirror = rig.phaseOffset >= 0.5 ? 1 : -1;
      const recipeWear: DetailInstance[] =
        processRecipe === 'ironGear'
          ? [
              { position: [-0.24 * wearMirror, 0.379, -0.12], scale: [0.07, 0.012, 0.035], rotation: [0, 0.42 * wearMirror, 0] },
              { position: [0.2 * wearMirror, 0.379, 0.08], scale: [0.055, 0.012, 0.03], rotation: [0, -0.36 * wearMirror, 0] },
              { position: [0.08 * wearMirror, 0.379, -0.24], scale: [0.045, 0.012, 0.028], rotation: [0, 0.14 * wearMirror, 0] },
              { position: [-0.08 * wearMirror, 0.379, 0.24], scale: [0.04, 0.012, 0.025], rotation: [0, -0.22 * wearMirror, 0] },
            ]
          : processRecipe === 'copperWire'
            ? [
                { position: [-0.27 * wearMirror, 0.379, 0.08], scale: [0.16, 0.012, 0.025], rotation: [0, 0.24 * wearMirror, 0] },
                { position: [0.19 * wearMirror, 0.379, -0.16], scale: [0.13, 0.012, 0.022], rotation: [0, -0.3 * wearMirror, 0] },
                { position: [0, 0.379, -0.28], scale: [0.12, 0.012, 0.02], rotation: [0, 0.05 * wearMirror, 0] },
              ]
            : processRecipe === 'circuit'
              ? [
                  { position: [-0.22 * wearMirror, 0.379, 0.2], scale: [0.12, 0.012, 0.035], rotation: [0, -0.1 * wearMirror, 0] },
                  { position: [0.21 * wearMirror, 0.379, 0.12], scale: [0.1, 0.012, 0.03], rotation: [0, 0.18 * wearMirror, 0] },
                  { position: [0.02 * wearMirror, 0.379, -0.25], scale: [0.14, 0.012, 0.028], rotation: [0, -0.08 * wearMirror, 0] },
                ]
              : [
                  { position: [-0.23 * wearMirror, 0.379, -0.16], scale: [0.13, 0.012, 0.035], rotation: [0, 0.2 * wearMirror, 0] },
                  { position: [0.23 * wearMirror, 0.379, -0.08], scale: [0.12, 0.012, 0.032], rotation: [0, -0.24 * wearMirror, 0] },
                  { position: [0, 0.379, 0.25], scale: [0.15, 0.012, 0.03], rotation: [0, 0.06 * wearMirror, 0] },
                ];
      this.addInstanceBatch(
        materialPath,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.14),
        recipeWearMaterial,
        recipeWear,
      ).name = `fabricator-${processRecipe}-localized-process-wear`;
      this.addInstanceBatch(
        materialPath,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.15),
        processGrimeMaterial,
        [
          { position: [-0.18 * wearMirror, 0.376, 0.31], scale: [0.14, 0.009, 0.028], rotation: [0, 0.22 * wearMirror, 0] },
          { position: [0.16 * wearMirror, 0.376, 0.22], scale: [0.09, 0.009, 0.022], rotation: [0, -0.3 * wearMirror, 0] },
          { position: [-0.12 * wearMirror, 0.376, -0.25], scale: [0.12, 0.009, 0.025], rotation: [0, -0.12 * wearMirror, 0] },
          { position: [0.19 * wearMirror, 0.376, -0.36], scale: [0.08, 0.009, 0.02], rotation: [0, 0.28 * wearMirror, 0] },
        ],
      ).name = 'fabricator-asymmetric-bearing-oil-and-transfer-grime';
      this.addInstanceBatch(
        enclosure,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.12),
        processGrimeMaterial,
        [
          { position: [-0.37, 0.3, -0.511], scale: [0.018, 0.11, 0.009] },
          { position: [0.19, 0.275, -0.511], scale: [0.014, 0.075, 0.009] },
          { position: [0.34, 0.34, 0.481], scale: [0.012, 0.08, 0.009] },
        ],
      ).name = 'fabricator-localized-apron-seep-and-service-streaks';

      this.addRoundedBox(
        enclosure,
        [0.34, 0.1, 0.18],
        this.materials.titanium,
        [0, 0.31, 0.455],
        [0, 0, 0],
        0.022,
      ).name = 'fabricator-permanent-rear-input-flange';
      this.addRoundedBox(
        enclosure,
        [0.32, 0.095, 0.18],
        oiledSteelMaterial,
        [0, 0.255, -0.45],
        [0, 0, 0],
        0.02,
      ).name = 'fabricator-permanent-front-output-throat';
      this.addRoundedBox(
        enclosure,
        [0.16, 0.28, 0.32],
        workDeckMaterial,
        [-0.465, 0.33, 0.04],
        [0, 0, 0],
        0.025,
      ).name = 'fabricator-permanent-left-power-junction';
      this.addAtlasCroppedRoundedBox(
        enclosure,
        [0.13, 0.025, 0.26],
        this.materials.fabricatorPanel,
        [0.515, 0.985, 0.515, 0.985],
        [-0.465, 0.485, 0.04],
        [0, 0, 0],
        0.014,
      ).name = 'fabricator-offset-power-pod-weathered-service-cap';
      this.addInstanceBatch(
        enclosure,
        new THREE.CylinderGeometry(1, 1, 1, 12, 1),
        this.materials.ceramicDark,
        [-0.06, 0.06].map((z) => ({
          position: [-0.478, 0.33, z] as [number, number, number],
          scale: [0.04, 0.035, 0.04] as [number, number, number],
          rotation: [0, 0, Math.PI / 2] as [number, number, number],
        })),
      ).name = 'fabricator-power-junction-twin-insulators';
      this.addRoundedBox(
        enclosure,
        [0.14, 0.13, 0.3],
        this.materials.titanium,
        [0.455, 0.24, 0.16],
        [0, 0, 0],
        0.024,
      ).name = 'fabricator-permanent-right-reclaim-dock';
      this.addInstanceBatch(
        enclosure,
        new THREE.CylinderGeometry(1, 1, 1, 8, 1),
        this.materials.titaniumLight,
        [
          [-0.438, 0.31, -0.13],
          [-0.438, 0.57, -0.13],
          [-0.438, 0.31, 0.13],
          [-0.438, 0.57, 0.13],
          [0.438, 0.31, -0.13],
          [0.438, 0.57, -0.13],
          [0.438, 0.31, 0.13],
          [0.438, 0.57, 0.13],
        ].map(([x, y, z]) => ({
          position: [x, y, z] as [number, number, number],
          scale: [0.015, 0.014, 0.015] as [number, number, number],
        })),
      ).name = 'fabricator-shell-visible-fastener-lines';

      const serviceDetail = new THREE.Group();
      serviceDetail.name = 'fabricator-authored-drive-and-service-detail';
      root.add(serviceDetail);
      this.addAtlasCroppedRoundedBox(
        serviceDetail,
        [0.29, 0.055, 0.25],
        this.materials.fabricatorPanel,
        [0.515, 0.985, 0.015, 0.485],
        [-0.255, 0.685, 0.255],
        [0, -0.06, 0],
        0.016,
      ).name = 'fabricator-authored-bolted-access-cassette';
      this.addRoundedBox(
        serviceDetail,
        [0.32, 0.035, 0.045],
        this.materials.amber,
        [-0.255, 0.722, 0.14],
        [0, -0.06, 0],
        0.009,
      ).name = 'fabricator-access-cassette-latch';
      this.addCylinder(
        serviceDetail,
        0.095,
        0.3,
        this.materials.housing.fabricator,
        [0.285, 0.715, 0.245],
        [0, 0, Math.PI / 2],
        16,
      ).name = 'fabricator-offset-drive-motor';
      this.addTorus(
        serviceDetail,
        0.096,
        0.013,
        this.materials.agedCopper,
        [0.285, 0.715, 0.245],
        [0, Math.PI / 2, 0],
      ).name = 'fabricator-motor-single-muted-drive-band';
      const motorRotor = this.addCylinder(
        serviceDetail,
        0.04,
        0.09,
        this.materials.titaniumLight,
        [0.105, 0.715, 0.245],
        [0, 0, Math.PI / 2],
        12,
      );
      motorRotor.name = 'fabricator-visible-drive-shaft';
      rig.parts.fabricatorMotorRotor = motorRotor;
      this.addInstancedBeams(
        serviceDetail,
        fabricatorRubberMaterial,
        [
          { from: [0.39, 0.71, 0.2], to: [0.45, 0.6, 0.05], radius: 0.015 },
          { from: [0.41, 0.69, 0.27], to: [0.44, 0.52, 0.12], radius: 0.013 },
          { from: [-0.38, 0.68, 0.27], to: [-0.42, 0.54, 0.08], radius: 0.014 },
        ],
        7,
      ).name = 'fabricator-service-cable-bundle';

      const gearTrain = new THREE.Group();
      gearTrain.name = 'fabricator-exposed-offset-gear-train';
      serviceDetail.add(gearTrain);
      rig.parts.fabricatorGearTrain = gearTrain;
      const gearDefinitions = [
        { x: -0.06, z: 0.27, radius: 0.11, teeth: 10, phase: 0 },
        { x: 0.095, z: 0.18, radius: 0.075, teeth: 8, phase: 0.25 },
      ] as const;
      for (const [gearIndex, gear] of gearDefinitions.entries()) {
        const gearRoot = new THREE.Group();
        gearRoot.name = `fabricator-drive-gear-${gearIndex}`;
        gearRoot.position.set(gear.x, 0.735, gear.z);
        gearTrain.add(gearRoot);
        this.addTorus(
          gearRoot,
          gear.radius * 0.62,
          gear.radius * 0.24,
          gearIndex === 0
            ? this.materials.titaniumLight
            : fabricatorCopperMaterial,
        );
        this.addInstanceBatch(
          gearRoot,
          new THREE.BoxGeometry(1, 1, 1),
          gearIndex === 0
            ? this.materials.titaniumLight
            : fabricatorCopperMaterial,
          Array.from({ length: gear.teeth }, (_, tooth) => {
            const angle = tooth * Math.PI * 2 / gear.teeth + gear.phase;
            return {
              position: [
                Math.sin(angle) * gear.radius,
                0,
                Math.cos(angle) * gear.radius,
              ] as [number, number, number],
              scale: [
                gear.radius * 0.28,
                0.045,
                gear.radius * 0.42,
              ] as [number, number, number],
              rotation: [0, angle, 0] as [number, number, number],
            };
          }),
        );
        this.addCylinder(
          gearRoot,
          gear.radius * 0.2,
          0.075,
          this.materials.carbonDark,
          [0, 0.025, 0],
          [0, 0, 0],
          10,
        );
      }
      this.addInstanceBatch(
        serviceDetail,
        new THREE.CylinderGeometry(1, 1, 1, 8, 1),
        this.materials.titaniumLight,
        [
          [-0.37, 0.723, 0.145],
          [-0.14, 0.723, 0.145],
          [-0.37, 0.723, 0.355],
          [-0.14, 0.723, 0.355],
          [0.19, 0.715, 0.245],
          [0.38, 0.715, 0.245],
        ].map(([x, y, z]) => ({
          position: [x, y, z] as [number, number, number],
          scale: [0.017, 0.016, 0.017] as [number, number, number],
        })),
      ).name = 'fabricator-service-fastener-set';
    }
    this.addBeam(root, new THREE.Vector3(-0.35, 0.61, 0.22), topA, 0.035, this.materials.titaniumLight);
    this.addBeam(root, new THREE.Vector3(0.35, 0.61, 0.22), topB, 0.035, this.materials.titaniumLight);
    this.addBeam(root, topA, new THREE.Vector3(0, 0.79, 0.12), 0.035, this.materials.titaniumLight);
    this.addBeam(root, topB, new THREE.Vector3(0, 0.79, 0.12), 0.035, this.materials.titaniumLight);
    this.addRoundedBox(
      root,
      [0.72, 0.08, 0.11],
      this.materials.titanium,
      [0, 0.62, -0.08],
      [0, 0, 0],
      0.025,
    ).name = 'fabricator-visible-overhead-gantry-rail';
    this.addRoundedBox(root, [0.65, 0.035, 0.055], this.materials.amber, [0, 0.62, -0.14], [0, 0, 0], 0.012);
    this.addInstancedBeams(
      root,
      this.materials.titanium,
      [
        { from: [-0.42, 0.18, -0.32], to: [-0.35, 0.45, -0.2], radius: 0.022 },
        { from: [0.42, 0.18, -0.32], to: [0.35, 0.45, -0.2], radius: 0.022 },
        { from: [-0.42, 0.18, 0.32], to: [-0.35, 0.45, 0.22], radius: 0.022 },
        { from: [0.42, 0.18, 0.32], to: [0.35, 0.45, 0.22], radius: 0.022 },
      ],
      7,
    );
    if (!highDetail) {
      this.addInstancedBeams(
        root,
        this.materials.rubber,
        [
          { from: [-0.28, 0.72, 0.12], to: [-0.28, 0.68, -0.08], radius: 0.015 },
          { from: [-0.28, 0.68, -0.08], to: [-0.2, 0.64, -0.08], radius: 0.015 },
          { from: [0.28, 0.72, 0.12], to: [0.28, 0.68, -0.08], radius: 0.015 },
          { from: [0.28, 0.68, -0.08], to: [0.2, 0.64, -0.08], radius: 0.015 },
        ],
        6,
      );
      const cableChain: DetailInstance[] = [];
      for (let link = 0; link < 9; link += 1) {
        cableChain.push({
          position: [-0.28 + link * 0.07, 0.675 + (link % 2) * 0.012, -0.145],
          scale: [0.042, 0.04, 0.065],
          rotation: [0, 0, link % 2 === 0 ? 0.18 : -0.18],
        });
      }
      this.addInstanceBatch(
        root,
        new THREE.BoxGeometry(1, 1, 1),
        this.materials.carbonDark,
        cableChain,
      );
      this.addRoundedBox(
        root,
        [0.17, 0.22, 0.075],
        this.materials.carbonDark,
        [0.355, 0.405, -0.285],
        [0, 0, 0],
        0.018,
      );
      this.addInstanceBatch(
        root,
        new THREE.BoxGeometry(1, 1, 1),
        this.materials.amber,
        [0.34, 0.405, 0.47].map((y) => ({
          position: [0.355, y, -0.326],
          scale: [0.11, 0.018, 0.014],
        })),
        false,
      );
    }

    if (rig.variant === 'automation-core') {
      this.addRoundedBox(
        root,
        [0.18, 0.78, 0.22],
        this.materials.carbonDark,
        [-0.43, 0.59, 0.18],
        [0, 0, 0],
        0.035,
      );
      this.addRoundedBox(
        root,
        [0.29, 0.11, 0.3],
        this.materials.titanium,
        [-0.41, 1.015, 0.17],
        [0, -0.08, 0],
        0.028,
      );
      this.addCylinder(
        root,
        0.065,
        0.38,
        this.materials.ceramicDark,
        [0, 0.78, 0.04],
        [0, 0, 0],
        12,
      );
      this.addTorus(
        root,
        0.21,
        0.022,
        this.materials.titaniumLight,
        [0, 0.76, 0.04],
      );
      this.addTorus(
        root,
        0.135,
        0.02,
        this.materials.amber,
        [0, 0.79, 0.04],
        [Math.PI / 2 + 0.2, 0, 0],
      );
      this.addInstancedBeams(
        root,
        this.materials.titaniumLight,
        [
          { from: [-0.49, 0.2, 0.28], to: [-0.43, 0.92, 0.22], radius: 0.024 },
          { from: [-0.35, 0.955, 0.12], to: [0.16, 0.91, -0.015], radius: 0.028 },
          { from: [-0.32, 0.79, 0.13], to: [0.16, 0.91, -0.015], radius: 0.018 },
          { from: [-0.29, 0.81, 0.04], to: [0, 0.97, 0.04], radius: 0.017 },
          { from: [0.29, 0.81, 0.04], to: [0, 0.97, 0.04], radius: 0.017 },
        ],
        8,
      );
      this.addInstancedBeams(
        root,
        this.materials.rubber,
        [
          { from: [-0.42, 0.86, 0.06], to: [-0.16, 0.72, -0.08], radius: 0.014 },
          { from: [-0.42, 0.75, 0.06], to: [0.08, 0.36, -0.23], radius: 0.014 },
        ],
        6,
      );
      this.addInstanceBatch(
        root,
        new THREE.CylinderGeometry(1, 1, 1, 12, 1),
        this.materials.ceramicDark,
        [0.5, 0.73].map((y) => ({
          position: [-0.43, y, 0.052],
          scale: [0.063, 0.034, 0.063],
          rotation: [Math.PI / 2, 0, 0],
        })),
      );
      for (const y of [0.5, 0.73]) {
        this.addTorus(
          root,
          0.074,
          0.014,
          this.materials.titaniumLight,
          [-0.43, y, 0.028],
          [0, 0, 0],
        );
      }
      this.addInstanceBatch(
        root,
        new THREE.BoxGeometry(1, 1, 1),
        this.materials.amber,
        [
          { position: [-0.49, 0.93, 0.024], scale: [0.085, 0.025, 0.02] },
          { position: [-0.37, 0.93, 0.024], scale: [0.055, 0.025, 0.02] },
          { position: [-0.41, 1.08, 0.17], scale: [0.2, 0.025, 0.12] },
        ],
      );
      this.addCylinder(
        root,
        0.025,
        0.25,
        this.materials.titaniumLight,
        [-0.41, 1.19, 0.17],
        [0, 0, 0],
        8,
      );
      this.addTorus(
        root,
        0.065,
        0.014,
        this.materials.amber,
        [-0.41, 1.065, 0.17],
      );
      this.addProcessGlow(
        rig,
        root,
        new RoundedBoxGeometry(0.052, 0.42, 0.018, 2, 0.009),
        [-0.43, 0.69, 0.014],
        [0, 0, 0],
        '#53ddd2',
      );
      rig.parts.heroCoreGlow = this.addProcessGlow(
        rig,
        root,
        new THREE.OctahedronGeometry(0.095, 0),
        [0, 0.87, 0.04],
        [0, Math.PI / 4, 0],
        '#53ddd2',
      );
    }

    const carriageA = new THREE.Group();
    const carriageB = new THREE.Group();
    carriageA.position.set(-0.2, 0.62, -0.08);
    carriageB.position.set(0.2, 0.62, -0.08);
    root.add(carriageA, carriageB);
    rig.parts.carriageA = carriageA;
    rig.parts.carriageB = carriageB;
    for (const carriage of [carriageA, carriageB]) {
      this.addRoundedBox(carriage, [0.14, 0.13, 0.16], this.materials.ceramic, [0, 0, 0], [0, 0, 0], 0.035);
      this.addCylinder(carriage, 0.045, 0.32, this.materials.titaniumLight, [0, -0.19, 0], [0, 0, 0], 10);
      this.addCylinder(carriage, 0.065, 0.08, this.materials.carbonDark, [0, -0.36, 0], [0, 0, 0], 12);
    }
    const fabricatorProcessColor =
      rig.variant === 'automation-core' || fabricatorRecipe === 'automationCore'
        ? '#53cfc7'
        : fabricatorRecipe === 'copperWire'
          ? '#c8753f'
          : fabricatorRecipe === 'ironGear'
            ? '#d0a264'
            : fabricatorRecipe === 'circuit'
              ? '#62a984'
              : '#7fa4a0';
    const fabricatorProcessSurface =
      fabricatorRecipe === 'copperWire'
        ? '#5a3324'
        : fabricatorRecipe === 'ironGear'
          ? '#554735'
          : '#29413d';
    rig.parts.fabricatorArc = this.addProcessGlow(
      rig,
      turntable,
      new THREE.TorusGeometry(0.1, 0.025, 8, 20),
      [0, 0.09, 0],
      [Math.PI / 2, 0, 0],
      fabricatorProcessColor,
      fabricatorProcessSurface,
    );
    rig.parts.outputGlow = this.addProcessGlow(
      rig,
      root,
      new RoundedBoxGeometry(0.18, 0.035, 0.018, 2, 0.008),
      [0, 0.225, -0.44],
      [0, 0, 0],
      fabricatorProcessColor,
      fabricatorProcessSurface,
    );
    this.addLamp(rig, root, [0.39, 0.28, -0.27], 0.03);
    this.addRivetCorners(root, 0.72, 0.72, 0.18);
  }

  private buildGenerator(rig: EntityRig): void {
    const { root } = rig;
    this.addRoundedBox(root, [0.86, 0.14, 0.86], this.materials.carbon, [0, 0.085, 0], [0, 0, 0], 0.06);
    for (const x of [-0.33, 0.33]) {
      this.addRoundedBox(root, [0.19, 0.52, 0.56], this.materials.housing.generator, [x, 0.4, 0], [0, 0, 0], 0.065);
      this.addRoundedBox(root, [0.055, 0.37, 0.42], this.materials.titanium, [x * 1.04, 0.4, 0], [0, 0, 0], 0.016);
    }
    const flywheelRoot = new THREE.Group();
    flywheelRoot.position.set(0, 0.43, 0);
    root.add(flywheelRoot);
    rig.parts.flywheel = flywheelRoot;
    this.addCylinder(flywheelRoot, 0.235, 0.2, this.materials.carbonDark, [0, 0, 0], [0, 0, Math.PI / 2], 28);
    this.addTorus(flywheelRoot, 0.235, 0.038, this.materials.titaniumLight, [0, 0, 0], [0, Math.PI / 2, 0]);
    this.addCylinder(flywheelRoot, 0.075, 0.28, this.materials.amber, [0, 0, 0], [0, 0, Math.PI / 2], 18);
    const flywheelSpokes: DetailInstance[] = [];
    for (let spoke = 0; spoke < 6; spoke += 1) {
      const angle = spoke * Math.PI / 3;
      flywheelSpokes.push({
        position: [0, Math.sin(angle) * 0.105, Math.cos(angle) * 0.105],
        scale: [0.22, 0.025, 0.035],
        rotation: [angle, 0, 0],
      });
    }
    this.addInstanceBatch(
      flywheelRoot,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.titanium,
      flywheelSpokes,
    );
    this.addRoundedBox(
      flywheelRoot,
      [0.075, 0.075, 0.045],
      this.materials.amber,
      [0, 0.17, 0],
      [0, 0, Math.PI / 4],
      0.015,
    );
    const exhaustCaps: THREE.Object3D[] = [];
    for (const x of [-0.24, 0.24]) {
      this.addTorus(root, 0.135, 0.025, this.materials.violet, [x, 0.45, -0.3], [0, 0, 0]);
      this.addCylinder(root, 0.055, 0.26, this.materials.titanium, [x, 0.66, 0.24], [0, 0, 0], 12);
      exhaustCaps.push(
        this.addTorus(root, 0.055, 0.012, this.materials.ceramic, [x, 0.79, 0.24]),
      );
    }
    rig.parts.exhaustCaps = exhaustCaps;
    this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 1, 1, 14, 1),
      this.materials.carbonDark,
      [-0.24, 0.24].map((x) => ({
        position: [x, 0.45, -0.314],
        scale: [0.105, 0.025, 0.105],
        rotation: [Math.PI / 2, 0, 0],
      })),
    );
    const generatorGrille: DetailInstance[] = [];
    for (const x of [-0.24, 0.24]) {
      for (const y of [0.395, 0.45, 0.505]) {
        generatorGrille.push({
          position: [x, y, -0.338],
          scale: [0.13, 0.018, 0.016],
        });
      }
    }
    for (const x of [-0.33, 0.33]) {
      for (const z of [-0.15, 0, 0.15]) {
        generatorGrille.push({
          position: [x, 0.67, z],
          scale: [0.19, 0.026, 0.035],
        });
      }
    }
    this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.amber,
      generatorGrille,
    );
    this.addInstancedBeams(
      root,
      this.materials.amber,
      [
        { from: [-0.35, 0.26, 0.32], to: [0.35, 0.26, 0.32], radius: 0.022 },
        { from: [-0.33, 0.26, 0.32], to: [-0.33, 0.36, 0.25], radius: 0.022 },
        { from: [0.33, 0.26, 0.32], to: [0.33, 0.36, 0.25], radius: 0.022 },
      ],
      8,
    );
    this.addInstancedBeams(
      root,
      this.materials.carbonDark,
      [
        { from: [-0.33, 0.58, 0.16], to: [-0.24, 0.64, 0.24], radius: 0.026 },
        { from: [0.33, 0.58, 0.16], to: [0.24, 0.64, 0.24], radius: 0.026 },
      ],
      8,
    );
    this.addRoundedBox(
      root,
      [0.18, 0.16, 0.08],
      this.materials.carbonDark,
      [0, 0.255, -0.35],
      [0, 0, 0],
      0.018,
    );
    this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 1, 1, 8, 1),
      this.materials.titaniumLight,
      [
        {
          position: [-0.05, 0.255, -0.396],
          scale: [0.018, 0.018, 0.018],
          rotation: [Math.PI / 2, 0, 0],
        },
        {
          position: [0.05, 0.255, -0.396],
          scale: [0.018, 0.018, 0.018],
          rotation: [Math.PI / 2, 0, 0],
        },
      ],
    );
    rig.parts.generatorCoil = this.addProcessGlow(
      rig,
      root,
      new THREE.TorusGeometry(0.15, 0.018, 8, 24),
      [0, 0.43, -0.115],
      [Math.PI / 2, 0, 0],
    );
    this.addLamp(rig, root, [0.38, 0.25, -0.3], 0.03);
    this.addRivetCorners(root, 0.7, 0.7, 0.18);
  }

  private buildStorage(rig: EntityRig): void {
    const { root } = rig;
    if (rig.variant === 'uplink') {
      this.buildUplinkIdentity(rig);
      return;
    }
    this.addRoundedBox(root, [0.84, 0.13, 0.84], this.materials.carbon, [0, 0.08, 0], [0, 0, 0], 0.065);
    this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.carbonDark,
      [
        { position: [-0.34, 0.1, -0.34], scale: [0.16, 0.13, 0.16] },
        { position: [0.34, 0.1, -0.34], scale: [0.16, 0.13, 0.16] },
        { position: [-0.34, 0.1, 0.34], scale: [0.16, 0.13, 0.16] },
        { position: [0.34, 0.1, 0.34], scale: [0.16, 0.13, 0.16] },
      ],
    );
    this.addCylinder(root, 0.31, 0.48, this.materials.titanium, [0, 0.39, 0], [0, 0, 0], 24);
    this.addCylinder(root, 0.265, 0.43, this.materials.housing.storage, [0, 0.4, 0], [0, 0, 0], 24);
    const dome = this.addMesh(
      root,
      new THREE.SphereGeometry(0.31, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      this.materials.ceramic,
      [0, 0.63, 0],
    );
    dome.scale.y = 0.58;
    for (let rib = 0; rib < 8; rib += 1) {
      const angle = rib * Math.PI / 4;
      this.addRoundedBox(
        root,
        [0.035, 0.47, 0.055],
        this.materials.titaniumLight,
        [Math.sin(angle) * 0.285, 0.4, Math.cos(angle) * 0.285],
        [0, angle, 0],
        0.008,
      );
    }
    this.addTorus(root, 0.31, 0.03, this.materials.carbonDark, [0, 0.22, 0]);
    this.addTorus(root, 0.31, 0.027, this.materials.amber, [0, 0.54, 0]);
    this.addInstancedBeams(
      root,
      this.materials.titanium,
      [
        { from: [-0.215, 0.24, -0.315], to: [-0.215, 0.57, -0.315], radius: 0.026 },
        { from: [-0.215, 0.36, -0.315], to: [-0.47, 0.36, -0.315], radius: 0.026 },
        { from: [-0.215, 0.57, -0.315], to: [-0.06, 0.62, -0.25], radius: 0.022 },
      ],
      8,
    );
    this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 1, 1, 10, 1),
      this.materials.amber,
      [
        { position: [-0.215, 0.32, -0.315], scale: [0.046, 0.035, 0.046] },
        { position: [-0.215, 0.5, -0.315], scale: [0.046, 0.035, 0.046] },
        {
          position: [-0.455, 0.36, -0.315],
          scale: [0.046, 0.035, 0.046],
          rotation: [0, 0, Math.PI / 2],
        },
      ],
    );
    this.addTorus(
      root,
      0.085,
      0.014,
      this.materials.titaniumLight,
      [-0.47, 0.36, -0.35],
      [0, 0, 0],
    );
    this.addInstancedBeams(
      root,
      this.materials.amber,
      [
        { from: [-0.54, 0.36, -0.355], to: [-0.4, 0.36, -0.355], radius: 0.012 },
        { from: [-0.47, 0.29, -0.355], to: [-0.47, 0.43, -0.355], radius: 0.012 },
      ],
      6,
    );
    const hatch = new THREE.Group();
    hatch.position.set(0, 0.81, 0);
    root.add(hatch);
    rig.parts.hatch = hatch;
    this.addCylinder(hatch, 0.12, 0.055, this.materials.carbonDark, [0, 0, 0], [0, 0, 0], 18);
    this.addTorus(hatch, 0.11, 0.018, this.materials.titaniumLight, [0, 0.032, 0]);
    this.addInstanceBatch(
      hatch,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.amber,
      [
        { position: [0, 0.075, 0], scale: [0.21, 0.025, 0.035] },
        { position: [0, 0.075, 0], scale: [0.035, 0.025, 0.21] },
      ],
    );
    this.addRoundedBox(
      root,
      [0.16, 0.07, 0.025],
      this.materials.carbonDark,
      [0, 0.66, -0.323],
      [0, 0, 0],
      0.012,
    );
    this.addRoundedBox(root, [0.11, 0.26, 0.025], this.materials.carbonDark, [0.2, 0.41, -0.326], [0, 0, 0], 0.012);
    this.addProcessGlow(
      rig,
      root,
      new RoundedBoxGeometry(0.055, 0.2, 0.014, 2, 0.01),
      [0.2, 0.41, -0.342],
    );
    this.addLamp(rig, root, [-0.28, 0.26, -0.27], 0.03);
    this.addRivetCorners(root, 0.68, 0.68, 0.17);
  }

  private buildUplinkIdentity(rig: EntityRig): void {
    // PASS 6 is a structural re-author. Keep the historical implementation
    // below as a source-level comparison until the independent jury freeze,
    // but never instantiate it: the new assembly deliberately has one clear
    // foundation -> pedestal -> azimuth bearing -> yoke -> dish load path and
    // a separate, unobstructed cargo line.
    this.buildUplinkPass6Identity(rig);
    return;

    const { root } = rig;
    const highDetail = rig.quality === 'high';

    const signalMaterial = this.materials.signalTemplate.clone();
    signalMaterial.name = 'commission-uplink-hardware-status-material';
    signalMaterial.color.set('#6da59b');
    signalMaterial.emissive.set('#2f8f82');
    signalMaterial.emissiveIntensity = 0.07;
    signalMaterial.transparent = true;
    signalMaterial.opacity = 0.64;
    signalMaterial.depthWrite = false;
    rig.ownedMaterials.push(signalMaterial);
    rig.parts.uplinkSignalMaterial = signalMaterial;

    const linkMaterial = signalMaterial.clone();
    linkMaterial.name = 'commission-uplink-powered-feed-lock-material';
    linkMaterial.color.set('#79b9ad');
    linkMaterial.emissive.set('#2a9787');
    linkMaterial.emissiveIntensity = 0.42;
    linkMaterial.opacity = 0.56;
    linkMaterial.depthTest = true;
    linkMaterial.depthWrite = false;
    rig.ownedMaterials.push(linkMaterial);
    rig.parts.uplinkLinkMaterial = linkMaterial;

    const effectMaterial = signalMaterial.clone();
    effectMaterial.name = 'commission-uplink-subordinate-selection-material';
    effectMaterial.color.set('#78928f');
    effectMaterial.emissive.set('#587d78');
    effectMaterial.opacity = 0.18;
    effectMaterial.emissiveIntensity = 0.1;
    effectMaterial.depthTest = true;
    effectMaterial.depthWrite = false;
    rig.ownedMaterials.push(effectMaterial);
    rig.parts.uplinkEffectMaterial = effectMaterial;

    const reflectorMaterial = this.materials.agedCeramic.clone();
    reflectorMaterial.name = 'commission-uplink-clean-reflector-material';
    reflectorMaterial.color.set('#d8cda9');
    reflectorMaterial.emissive.set('#000000');
    reflectorMaterial.emissiveIntensity = 0;
    reflectorMaterial.roughness = 0.78;
    reflectorMaterial.metalness = 0.04;
    reflectorMaterial.side = THREE.DoubleSide;
    rig.ownedMaterials.push(reflectorMaterial);

    const jointWearMaterial = this.materials.agedCopper.clone();
    jointWearMaterial.name = 'commission-uplink-joint-oxidation-material';
    jointWearMaterial.color.set('#92674e');
    jointWearMaterial.roughness = 0.68;
    jointWearMaterial.metalness = 0.5;
    rig.ownedMaterials.push(jointWearMaterial);

    const concreteMaterial = this.materials.uplinkConcrete.clone();
    concreteMaterial.name =
      'commission-uplink-layered-drained-concrete-material';
    concreteMaterial.color.set('#817866');
    // The pass-4 concrete color atlas advertised its square repeat as a plaid
    // at the enlarged Uplink footprint. Keep the response/normal history, but
    // let the new radial pour joints and repair geometry carry construction
    // scale without a repeated color pattern.
    concreteMaterial.map = null;
    concreteMaterial.needsUpdate = true;
    concreteMaterial.roughness = 0.96;
    concreteMaterial.metalness = 0.03;
    concreteMaterial.userData.authoredSurface =
      'uplink-concrete-v4-pours-spalls-runoff-aggregate';
    rig.ownedMaterials.push(concreteMaterial);

    // Pass-5 surfaces deliberately separate material families at first glance:
    // cool painted armor uses the validated authored steel atlas, cast load
    // paths stay darker and more metallic, warm ceramic remains non-metallic,
    // and copper/rubber retain their own specular response. The existing
    // normal/roughness/ao stacks preserve chips, oil and fabrication scale.
    const structuralSteelMaterial = this.materials.uplinkCast.clone();
    structuralSteelMaterial.name =
      'commission-uplink-layered-welded-cast-steel-material';
    structuralSteelMaterial.color.set('#9daaa3');
    structuralSteelMaterial.roughness = 0.7;
    structuralSteelMaterial.metalness = 0.68;
    structuralSteelMaterial.userData.authoredSurface =
      'uplink-cast-v4-seams-welds-oil-heat-edge-rub';
    rig.ownedMaterials.push(structuralSteelMaterial);

    const paintedArmorMaterial = this.materials.uplinkPainted.clone();
    paintedArmorMaterial.name =
      'commission-uplink-layered-chipped-seafoam-armor-material';
    paintedArmorMaterial.color.set('#d6e8dc');
    paintedArmorMaterial.roughness = 0.78;
    paintedArmorMaterial.metalness = 0.32;
    paintedArmorMaterial.userData.authoredSurface =
      'uplink-painted-v5-validated-v2-aged-steel-chips-grime';
    paintedArmorMaterial.userData.authoredAsset =
      this.materials.uplinkPainted.userData.authoredAsset;
    paintedArmorMaterial.userData.authoredAssetHash =
      this.materials.uplinkPainted.userData.authoredAssetHash;
    rig.ownedMaterials.push(paintedArmorMaterial);

    const darkLinerMaterial = this.materials.uplinkCast.clone();
    darkLinerMaterial.name =
      'commission-uplink-authored-readable-cavity-liner-material';
    darkLinerMaterial.color.set('#afbeb5');
    darkLinerMaterial.emissive.set('#263f3b');
    darkLinerMaterial.emissiveIntensity = 0.16;
    darkLinerMaterial.normalScale.set(0.74, 0.74);
    darkLinerMaterial.aoMapIntensity = 0.48;
    darkLinerMaterial.roughness = 0.76;
    darkLinerMaterial.metalness = 0.34;
    darkLinerMaterial.userData.authoredSurface =
      'uplink-cast-v4-lit-cavity-seams-service-wear';
    rig.ownedMaterials.push(darkLinerMaterial);

    const groundWear = this.addMesh(
      root,
      new THREE.CircleGeometry(0.5, highDetail ? 28 : 18),
      this.materials.stain,
      [0.03, 0.007, 0.02],
      [-Math.PI / 2, 0, 0],
      false,
    );
    groundWear.name = 'commission-uplink-localized-ground-bearing-stain';
    groundWear.scale.set(3.25, 2.85, 1);
    groundWear.renderOrder = -1;
    groundWear.userData.wearScope = 'foundation-runoff-and-bearing-service';
    groundWear.userData.localized = true;
    const actuatorWear = this.addMesh(
      root,
      new THREE.CircleGeometry(0.5, highDetail ? 20 : 14),
      this.materials.scorch,
      [0.28, 0.009, -0.22],
      [-Math.PI / 2, 0, 0],
      false,
    );
    actuatorWear.name = 'commission-uplink-localized-actuator-grease-stain';
    actuatorWear.scale.set(0.44, 0.3, 1);
    actuatorWear.renderOrder = -1;
    actuatorWear.userData.localized = true;

    const foundation = this.addMesh(
      root,
      new THREE.CylinderGeometry(
        1,
        1.04,
        1,
        highDetail ? 12 : 8,
        1,
      ),
      concreteMaterial,
      [0, 0.11, -0.34],
    );
    foundation.scale.set(1.48, 0.22, 1.27);
    foundation.name = 'commission-uplink-reinforced-foundation';
    foundation.receiveShadow = false;
    foundation.userData.visualRole = 'load-bearing-reinforced-foundation';
    foundation.userData.construction =
      'weathered-concrete-with-steel-perimeter-straps';
    const foundationOutline: DetailBeam[] = [];
    const foundationOutlineCount = highDetail ? 12 : 8;
    for (let index = 0; index < foundationOutlineCount; index += 1) {
      const angleA = index * Math.PI * 2 / foundationOutlineCount;
      const angleB = (index + 1) * Math.PI * 2 / foundationOutlineCount;
      foundationOutline.push({
        from: [
          Math.sin(angleA) * 1.43,
          0.225,
          -0.34 + Math.cos(angleA) * 1.21,
        ],
        to: [
          Math.sin(angleB) * 1.43,
          0.225,
          -0.34 + Math.cos(angleB) * 1.21,
        ],
        radius: 0.033,
      });
    }
    const foundationStraps = this.addInstancedBeams(
      root,
      this.materials.titanium,
      foundationOutline,
      highDetail ? 10 : 7,
    );
    foundationStraps.name =
      'commission-uplink-foundation-steel-edge-straps';
    foundationStraps.userData.loadPath = 'slab-edge-to-anchor-grid';
    const slabJoints = this.addInstancedBeams(
      root,
      this.materials.carbonDark,
      [
        { from: [0, 0.232, -0.34], to: [-1.05, 0.232, 0.26], radius: 0.012 },
        { from: [0, 0.232, -0.34], to: [0.96, 0.232, 0.37], radius: 0.012 },
        { from: [0, 0.232, -0.34], to: [0.14, 0.232, -1.32], radius: 0.012 },
      ],
      5,
    );
    slabJoints.name = 'commission-uplink-foundation-expansion-joints';
    slabJoints.userData.surfaceBreakup =
      'three-load-led-pours-with-drained-seams';
    const safetyZoning = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.amber,
      Array.from({ length: highDetail ? 9 : 6 }, (_, index) => ({
        position: [
          0.54 + index * 0.072,
          0.198,
          0.48,
        ] as [number, number, number],
        scale: [0.042, 0.014, 0.3] as [number, number, number],
        rotation: [0, index % 2 === 0 ? 0.42 : -0.42, 0] as [
          number,
          number,
          number,
        ],
      })),
      false,
    );
    safetyZoning.name =
      'commission-uplink-painted-cargo-interface-safety-zoning';
    safetyZoning.userData.zone = 'moving-carriage-and-belt-dock';
    const slabDrainage = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      jointWearMaterial,
      [
        { position: [-0.98, 0.197, 0.36], scale: [0.22, 0.018, 0.035] },
        { position: [-0.98, 0.197, 0.27], scale: [0.22, 0.018, 0.035] },
        { position: [-0.98, 0.197, 0.18], scale: [0.22, 0.018, 0.035] },
      ],
      false,
    );
    slabDrainage.name =
      'commission-uplink-foundation-copper-drainage-grate';
    slabDrainage.userData.groundIntegration =
      'service-runoff-to-localized-bearing-stain';
    const pouredRepairPatches = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      concreteMaterial,
      [
        { position: [-1.02, 0.236, -1.18], scale: [0.36, 0.018, 0.2], rotation: [0, 0.12, 0] },
        { position: [0.98, 0.236, 0.48], scale: [0.28, 0.018, 0.16], rotation: [0, -0.18, 0] },
        { position: [0.86, 0.236, -1.22], scale: [0.22, 0.018, 0.14], rotation: [0, 0.26, 0] },
      ],
      false,
    );
    pouredRepairPatches.name =
      'commission-uplink-foundation-hand-troweled-repair-patches';
    pouredRepairPatches.userData.weathering =
      'old-anchor-spalls-repaired-after-heavy-service';
    const foundationTrackWear = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      jointWearMaterial,
      [
        { position: [-0.16, 0.241, 0.67], scale: [0.48, 0.012, 0.038], rotation: [0, -0.05, 0] },
        { position: [0.58, 0.241, 0.69], scale: [0.36, 0.012, 0.032], rotation: [0, 0.09, 0] },
        { position: [1.17, 0.241, -0.58], scale: [0.16, 0.012, 0.035], rotation: [0, -0.2, 0] },
      ],
      false,
    );
    foundationTrackWear.name =
      'commission-uplink-foundation-cargo-and-service-wear-tracks';
    const outriggerFootings = this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 0.9, 1, highDetail ? 12 : 8, 1),
      this.materials.carbon,
      [
        { position: [-1.17, 0.28, -1.32], scale: [0.16, 0.13, 0.16] },
        { position: [1.17, 0.28, -1.32], scale: [0.16, 0.13, 0.16] },
        { position: [-1.17, 0.28, 0.64], scale: [0.16, 0.13, 0.16] },
        { position: [1.17, 0.28, 0.64], scale: [0.16, 0.13, 0.16] },
      ],
    );
    outriggerFootings.name =
      'commission-uplink-cast-outrigger-load-footings';
    outriggerFootings.userData.loadPath =
      'primary-frame-through-four-cast-feet-into-repaired-slab';
    const plinth = this.addMesh(
      root,
      new THREE.CylinderGeometry(
        1,
        1.08,
        1,
        highDetail ? 10 : 8,
        1,
      ),
      structuralSteelMaterial,
      [-0.43, 0.29, -0.43],
    );
    plinth.scale.set(0.83, 0.34, 0.78);
    plinth.name = 'commission-uplink-anchored-machinery-plinth';
    plinth.userData.visualRole = 'anchored-azimuth-load-plinth';
    const deckPanelPositions: DetailInstance[] = [
      { position: [-0.76, 0.465, -0.74], scale: [0.26, 0.022, 0.2], rotation: [0, -0.16, 0] },
      { position: [-0.12, 0.465, -0.74], scale: [0.26, 0.022, 0.2], rotation: [0, 0.16, 0] },
      { position: [-0.78, 0.465, -0.18], scale: [0.24, 0.022, 0.18], rotation: [0, 0.18, 0] },
      { position: [-0.08, 0.465, -0.18], scale: [0.24, 0.022, 0.18], rotation: [0, -0.18, 0] },
      { position: [-0.62, 0.465, 0.16], scale: [0.18, 0.022, 0.13], rotation: [0, -0.28, 0] },
      { position: [-0.24, 0.465, 0.16], scale: [0.18, 0.022, 0.13], rotation: [0, 0.28, 0] },
    ];
    const deckPanels = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      paintedArmorMaterial,
      deckPanelPositions.slice(0, highDetail ? 6 : 4),
    );
    deckPanels.name = 'commission-uplink-segmented-service-deck-panels';
    deckPanels.userData.accessPanelCount = highDetail ? 6 : 4;
    deckPanels.userData.authoredSurface =
      'paint-wear-normal-roughness-ao-service-cassettes';
    const deckPanelSeamInstances: DetailInstance[] = [
      { position: [-0.45, 0.431, -0.75], scale: [0.024, 0.012, 0.24] },
      { position: [-0.45, 0.431, -0.25], scale: [0.024, 0.012, 0.22] },
      { position: [-0.45, 0.431, 0.18], scale: [0.024, 0.012, 0.18] },
      { position: [-0.82, 0.431, -0.5], scale: [0.34, 0.012, 0.018] },
      { position: [-0.08, 0.431, -0.5], scale: [0.34, 0.012, 0.018] },
    ];
    const deckPanelSeams = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.carbonDark,
      deckPanelSeamInstances.slice(0, highDetail ? 5 : 3),
      false,
    );
    deckPanelSeams.name =
      'commission-uplink-service-deck-recessed-panel-seams';
    const panelFasteners: DetailInstance[] = [];
    for (const x of [-0.92, -0.68, -0.18, 0.06]) {
      for (const z of [-0.92, 0.18]) {
        panelFasteners.push({
          position: [x, 0.418, z],
          scale: [0.024, 0.018, 0.024],
        });
      }
    }
    const panelFastenerBatch = this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 0.82, 1, 8, 1),
      jointWearMaterial,
      panelFasteners.slice(0, highDetail ? 8 : 4),
    );
    panelFastenerBatch.name =
      'commission-uplink-service-deck-fastener-rhythm';

    const anchorBolts: DetailInstance[] = [];
    const anchorCount = highDetail ? 8 : 4;
    for (let index = 0; index < anchorCount; index += 1) {
      const angle = index * Math.PI * 2 / anchorCount + Math.PI / 4;
      anchorBolts.push({
        position: [
          Math.sin(angle) * 1.02,
          0.205,
          -0.3 + Math.cos(angle) * 0.75,
        ],
        scale: [0.052, 0.045, 0.052],
      });
    }
    const boltBatch = this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 0.86, 1, 8, 1),
      this.materials.titaniumLight,
      anchorBolts,
    );
    boltBatch.name = 'commission-uplink-foundation-anchor-bolts';
    boltBatch.userData.loadPath = 'foundation-to-terrain';

    const foundationGussets = this.addInstancedBeams(
      root,
      this.materials.titanium,
      [
        { from: [-1.02, 0.18, -1.02], to: [-0.83, 0.39, -0.8], radius: 0.045 },
        { from: [0.16, 0.18, -1.02], to: [-0.02, 0.39, -0.8], radius: 0.045 },
        { from: [-1.02, 0.18, 0.16], to: [-0.83, 0.39, -0.06], radius: 0.045 },
        { from: [0.16, 0.18, 0.16], to: [-0.02, 0.39, -0.06], radius: 0.045 },
      ],
      8,
    );
    foundationGussets.name = 'commission-uplink-plinth-load-gussets';

    // Primary lower-body mass: a faceted cast drive barrel visibly carries
    // the dish into the slab. It replaces the former impression of a thin
    // dish perched over an undifferentiated rectangular frame.
    const driveBarrel = new THREE.Group();
    driveBarrel.name = 'commission-uplink-primary-cast-rotary-drive-barrel';
    driveBarrel.position.set(-0.43, 0.42, -0.43);
    driveBarrel.userData.formHierarchy = 'primary-lower-body-mass';
    root.add(driveBarrel);
    this.addCylinder(
      driveBarrel,
      0.58,
      0.48,
      structuralSteelMaterial,
      [0, 0.19, 0],
      [0, 0, 0],
      highDetail ? 16 : 10,
    ).name = 'commission-uplink-drive-barrel-faceted-casting';
    this.addTorus(
      driveBarrel,
      0.52,
      0.042,
      jointWearMaterial,
      [0, 0.055, 0],
      [Math.PI / 2, 0, 0],
    ).name = 'commission-uplink-drive-barrel-lower-weld-race';
    this.addTorus(
      driveBarrel,
      0.52,
      0.036,
      this.materials.titaniumLight,
      [0, 0.41, 0],
      [Math.PI / 2, 0, 0],
    ).name = 'commission-uplink-drive-barrel-rubbed-upper-lip';
    const driveBarrelRibs = this.addInstanceBatch(
      driveBarrel,
      new THREE.BoxGeometry(1, 1, 1),
      paintedArmorMaterial,
      Array.from({ length: highDetail ? 10 : 6 }, (_, index) => {
        const angle = index * Math.PI * 2 / (highDetail ? 10 : 6);
        return {
          position: [
            Math.sin(angle) * 0.535,
            0.22,
            Math.cos(angle) * 0.535,
          ] as [number, number, number],
          scale: [0.055, 0.3, 0.1] as [number, number, number],
          rotation: [0, angle, 0] as [number, number, number],
        };
      }),
    );
    driveBarrelRibs.name =
      'commission-uplink-drive-barrel-bolted-vertical-ribs';
    const barrelBolts = this.addInstanceBatch(
      driveBarrel,
      new THREE.CylinderGeometry(1, 0.82, 1, 8, 1),
      this.materials.titaniumLight,
      Array.from({ length: highDetail ? 12 : 6 }, (_, index) => {
        const angle = index * Math.PI * 2 / (highDetail ? 12 : 6);
        return {
          position: [
            Math.sin(angle) * 0.555,
            0.43,
            Math.cos(angle) * 0.555,
          ] as [number, number, number],
          scale: [0.025, 0.026, 0.025] as [number, number, number],
        };
      }),
      false,
    );
    barrelBolts.name =
      'commission-uplink-drive-barrel-upper-flange-fasteners';

    // Secondary mass: a dedicated power-conditioning sponson makes the
    // underside read as a purpose-built communications machine. Cooling
    // drums, armor cassettes, louvers, and service hoses remain individually
    // legible from the normal camera.
    const powerSponson = new THREE.Group();
    powerSponson.name =
      'commission-uplink-secondary-armored-power-conditioning-sponson';
    powerSponson.position.set(0.78, 0.25, -0.7);
    powerSponson.userData.formHierarchy = 'secondary-service-mass';
    root.add(powerSponson);
    const powerSponsonShell = this.addMesh(
      powerSponson,
      new THREE.CylinderGeometry(
        1,
        0.92,
        1,
        highDetail ? 10 : 8,
        1,
      ),
      paintedArmorMaterial,
      [0, 0.31, 0],
      [0, 0.14, 0],
    );
    powerSponsonShell.scale.set(0.44, 0.58, 0.5);
    powerSponsonShell.name =
      'commission-uplink-power-sponson-chipped-armor-shell';
    const powerSponsonAccess = this.addMesh(
      powerSponson,
      new THREE.CylinderGeometry(1, 1, 1, highDetail ? 12 : 8, 1),
      structuralSteelMaterial,
      [0, 0.615, 0.02],
      [0, 0.14, 0],
    );
    powerSponsonAccess.scale.set(0.29, 0.045, 0.34);
    powerSponsonAccess.name =
      'commission-uplink-power-sponson-bolted-access-cassette';
    const conditioningDrum = this.addCylinder(
      powerSponson,
      0.19,
      0.62,
      this.materials.agedCopper,
      [0, 0.33, 0.03],
      [Math.PI / 2, 0, 0],
      highDetail ? 18 : 11,
    );
    conditioningDrum.name =
      'commission-uplink-power-conditioning-oil-cooled-drum';
    const drumBands = this.addInstanceBatch(
      powerSponson,
      new THREE.TorusGeometry(0.2, 0.028, 7, highDetail ? 18 : 12),
      structuralSteelMaterial,
      [-0.23, 0, 0.23].map((z) => ({
        position: [0, 0.33, z + 0.03] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      })),
    );
    drumBands.name =
      'commission-uplink-conditioning-drum-retaining-bands';
    const sponsonLouvers = this.addInstanceBatch(
      powerSponson,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.carbonDark,
      Array.from({ length: highDetail ? 7 : 4 }, (_, index) => ({
        position: [
          -0.22 + index * 0.073,
          0.4,
          0.448,
        ] as [number, number, number],
        scale: [0.045, 0.16, 0.018] as [number, number, number],
        rotation: [0, 0, -0.14] as [number, number, number],
      })),
      false,
    );
    sponsonLouvers.name =
      'commission-uplink-power-sponson-deep-cooling-louvers';
    const sponsonFasteners = this.addInstanceBatch(
      powerSponson,
      new THREE.CylinderGeometry(1, 0.8, 1, 8, 1),
      jointWearMaterial,
      [
        { position: [-0.26, 0.18, 0.452], scale: [0.028, 0.018, 0.028], rotation: [Math.PI / 2, 0, 0] },
        { position: [0.26, 0.18, 0.452], scale: [0.028, 0.018, 0.028], rotation: [Math.PI / 2, 0, 0] },
        { position: [-0.26, 0.46, 0.452], scale: [0.028, 0.018, 0.028], rotation: [Math.PI / 2, 0, 0] },
        { position: [0.26, 0.46, 0.452], scale: [0.028, 0.018, 0.028], rotation: [Math.PI / 2, 0, 0] },
      ],
      false,
    );
    sponsonFasteners.name =
      'commission-uplink-power-sponson-weathered-fasteners';
    const powerHoseBundle = this.addInstancedBeams(
      root,
      this.materials.rubber,
      [
        { from: [0.52, 0.57, -0.58], to: [0.32, 0.66, -0.36], radius: 0.026 },
        { from: [0.32, 0.66, -0.36], to: [0.08, 0.58, -0.24], radius: 0.026 },
        { from: [0.57, 0.5, -0.7], to: [0.34, 0.48, -0.54], radius: 0.018 },
        { from: [0.34, 0.48, -0.54], to: [0.08, 0.52, -0.4], radius: 0.018 },
        { from: [0.69, 0.66, -0.86], to: [0.38, 0.78, -0.7], radius: 0.02 },
        { from: [0.38, 0.78, -0.7], to: [-0.08, 0.83, -0.53], radius: 0.02 },
      ],
      highDetail ? 10 : 7,
    );
    powerHoseBundle.name =
      'commission-uplink-routed-power-coolant-hose-bundle';
    const powerHoseClips = this.addInstanceBatch(
      root,
      new THREE.TorusGeometry(0.042, 0.009, 6, 10),
      jointWearMaterial,
      [
        { position: [0.32, 0.66, -0.36], rotation: [0.6, 0.2, 0.7], scale: [1, 1, 1] },
        { position: [0.34, 0.48, -0.54], rotation: [0.5, -0.2, 0.8], scale: [0.8, 0.8, 0.8] },
        { position: [0.38, 0.78, -0.7], rotation: [0.4, 0.3, 0.6], scale: [0.9, 0.9, 0.9] },
      ],
      false,
    );
    powerHoseClips.name =
      'commission-uplink-power-hose-retaining-clips';

    const fixedBearing = new THREE.Group();
    fixedBearing.name = 'commission-uplink-fixed-azimuth-bearing';
    fixedBearing.position.set(-0.43, 0.43, -0.43);
    root.add(fixedBearing);
    this.addCylinder(
      fixedBearing,
      0.49,
      0.15,
      this.materials.carbon,
      [0, 0, 0],
      [0, 0, 0],
      highDetail ? 24 : 14,
    );
    this.addTorus(
      fixedBearing,
      0.455,
      0.035,
      jointWearMaterial,
      [0, 0.065, 0],
      [Math.PI / 2, 0, 0],
    ).name = 'commission-uplink-azimuth-bearing-wear-race';

    const azimuthAssembly = new THREE.Group();
    azimuthAssembly.name = 'commission-uplink-azimuth-rotor-assembly';
    azimuthAssembly.position.set(-0.43, 0.48, -0.43);
    azimuthAssembly.scale.setScalar(1.42);
    azimuthAssembly.userData.mechanism = 'bearing-driven-azimuth';
    azimuthAssembly.userData.baseYaw = -0.16;
    azimuthAssembly.userData.presentationScale = 1.42;
    root.add(azimuthAssembly);
    rig.parts.uplinkAzimuthAssembly = azimuthAssembly;

    this.addCylinder(
      azimuthAssembly,
      0.3,
      0.11,
      this.materials.industrialPanel,
      [0, 0.035, 0],
      [0, 0, 0],
      highDetail ? 24 : 14,
    ).name = 'commission-uplink-azimuth-turntable';
    const azimuthGear = new THREE.Group();
    azimuthGear.name = 'commission-uplink-exposed-azimuth-ring-gear';
    azimuthGear.userData.wearScope = 'azimuth-moving-joint';
    azimuthAssembly.add(azimuthGear);
    this.addTorus(
      azimuthGear,
      0.31,
      0.022,
      jointWearMaterial,
      [0, 0.105, 0],
      [Math.PI / 2, 0, 0],
    );
    const azimuthTeeth: DetailInstance[] = [];
    const toothCount = highDetail ? 18 : 10;
    for (let index = 0; index < toothCount; index += 1) {
      const angle = index * Math.PI * 2 / toothCount;
      azimuthTeeth.push({
        position: [
          Math.sin(angle) * 0.335,
          0.105,
          Math.cos(angle) * 0.335,
        ],
        scale: [0.052, 0.035, 0.028],
        rotation: [0, angle, 0],
      });
    }
    const azimuthToothBatch = this.addInstanceBatch(
      azimuthGear,
      new THREE.BoxGeometry(1, 1, 1),
      jointWearMaterial,
      azimuthTeeth,
    );
    azimuthToothBatch.name = 'commission-uplink-azimuth-gear-teeth';
    rig.parts.uplinkAzimuthGear = azimuthGear;

    const forkYoke = new THREE.Group();
    forkYoke.name = 'commission-uplink-stout-fork-yoke';
    forkYoke.userData.loadPath = 'turntable-to-elevation-trunnions';
    azimuthAssembly.add(forkYoke);
    for (const x of [-0.3, 0.3]) {
      this.addRoundedBox(
        forkYoke,
        [0.13, 0.6, 0.2],
        structuralSteelMaterial,
        [x, 0.4, 0],
        [0, 0, 0],
        0.028,
      );
    }
    this.addRoundedBox(
      forkYoke,
      [0.7, 0.12, 0.24],
      this.materials.carbon,
      [0, 0.12, 0],
      [0, 0, 0],
      0.03,
    );
    this.addInstancedBeams(
      forkYoke,
      this.materials.titanium,
      [
        { from: [-0.29, 0.13, 0.08], to: [-0.29, 0.68, 0], radius: 0.04 },
        { from: [0.29, 0.13, 0.08], to: [0.29, 0.68, 0], radius: 0.04 },
        { from: [-0.29, 0.24, -0.09], to: [-0.29, 0.68, 0], radius: 0.03 },
        { from: [0.29, 0.24, -0.09], to: [0.29, 0.68, 0], radius: 0.03 },
      ],
      8,
    ).name = 'commission-uplink-yoke-load-braces';

    const trunnions = new THREE.Group();
    trunnions.name = 'commission-uplink-elevation-trunnions';
    trunnions.userData.mechanism = 'paired-horizontal-pivot';
    forkYoke.add(trunnions);
    for (const x of [-0.37, 0.37]) {
      this.addCylinder(
        trunnions,
        0.11,
        0.18,
        x < 0 ? jointWearMaterial : this.materials.titanium,
        [x, 0.69, 0],
        [0, 0, Math.PI / 2],
        highDetail ? 16 : 10,
      );
      this.addTorus(
        trunnions,
        0.105,
        0.018,
        jointWearMaterial,
        [x + Math.sign(x) * 0.095, 0.69, 0],
        [0, Math.PI / 2, 0],
      );
    }

    const elevationGear = new THREE.Group();
    elevationGear.name = 'commission-uplink-geared-elevation-sector';
    elevationGear.position.set(0.415, 0.69, 0);
    forkYoke.add(elevationGear);
    this.addTorus(
      elevationGear,
      0.145,
      0.021,
      jointWearMaterial,
      [0, 0, 0],
      [0, Math.PI / 2, 0],
      Math.PI * 1.35,
    );
    elevationGear.rotation.x = -0.25;

    const elevationAssembly = new THREE.Group();
    elevationAssembly.name = 'commission-uplink-elevation-cradle';
    elevationAssembly.position.set(0, 0.69, 0);
    elevationAssembly.rotation.x = -0.56;
    elevationAssembly.userData.mechanism = 'trunnion-driven-elevation';
    elevationAssembly.userData.baseElevation = -0.56;
    azimuthAssembly.add(elevationAssembly);
    rig.parts.uplinkElevationAssembly = elevationAssembly;

    const reflector = this.addMesh(
      elevationAssembly,
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.018, 0.115),
          new THREE.Vector2(0.1, 0.1),
          new THREE.Vector2(0.22, 0.045),
          new THREE.Vector2(0.34, -0.045),
          new THREE.Vector2(0.435, -0.16),
        ],
        highDetail ? 32 : 20,
      ),
      reflectorMaterial,
      [0, 0, 0],
      [-Math.PI / 2, 0, 0],
    );
    reflector.name = 'commission-uplink-clean-parabolic-reflector';
    reflector.castShadow = false;
    reflector.receiveShadow = false;
    reflector.userData.opticalAxis = [0, 0, 1];
    reflector.userData.surfaceTreatment = 'matte-weathered-no-face-ribs';
    this.addTorus(
      elevationAssembly,
      0.435,
      0.024,
      this.materials.titaniumLight,
      [0, 0, 0.16],
      [0, 0, 0],
    ).name = 'commission-uplink-reflector-reinforced-rim';
    const reflectorRimFasteners = this.addInstanceBatch(
      elevationAssembly,
      new THREE.CylinderGeometry(1, 0.78, 1, 8, 1),
      jointWearMaterial,
      Array.from({ length: highDetail ? 12 : 6 }, (_, index) => {
        const angle = index * Math.PI * 2 / (highDetail ? 12 : 6);
        return {
          position: [
            Math.cos(angle) * 0.435,
            Math.sin(angle) * 0.435,
            0.171,
          ] as [number, number, number],
          scale: [0.018, 0.012, 0.018] as [number, number, number],
          rotation: [Math.PI / 2, 0, 0] as [number, number, number],
        };
      }),
      false,
    );
    reflectorRimFasteners.name =
      'commission-uplink-reflector-rim-weathered-fasteners';
    reflectorRimFasteners.userData.detailRole =
      'authored-edge-wear-and-panel-scale-cue';
    this.addCylinder(
      elevationAssembly,
      0.075,
      0.18,
      jointWearMaterial,
      [0, 0, -0.14],
      [Math.PI / 2, 0, 0],
      highDetail ? 16 : 10,
    ).name = 'commission-uplink-reflector-rear-drive-hub';

    const rearStiffeners: DetailBeam[] = [];
    const stiffenerCount = highDetail ? 4 : 2;
    for (let index = 0; index < stiffenerCount; index += 1) {
      const angle = index * Math.PI * 2 / stiffenerCount + Math.PI / 4;
      rearStiffeners.push({
        from: [0, 0, -0.15],
        to: [
          Math.cos(angle) * 0.39,
          Math.sin(angle) * 0.39,
          0.12,
        ],
        radius: 0.016,
      });
    }
    const stiffenerBatch = this.addInstancedBeams(
      elevationAssembly,
      this.materials.titanium,
      rearStiffeners,
      8,
    );
    stiffenerBatch.name = 'commission-uplink-reflector-rear-stiffeners';
    stiffenerBatch.userData.faceRibCount = 0;

    const feedStruts: DetailBeam[] = [];
    for (let index = 0; index < 3; index += 1) {
      const angle = index * Math.PI * 2 / 3 - Math.PI / 2;
      feedStruts.push({
        from: [
          Math.cos(angle) * 0.405,
          Math.sin(angle) * 0.405,
          0.145,
        ],
        to: [
          Math.cos(angle) * 0.055,
          Math.sin(angle) * 0.055,
          0.48,
        ],
        radius: 0.014,
      });
    }
    const strutBatch = this.addInstancedBeams(
      elevationAssembly,
      this.materials.titaniumLight,
      feedStruts,
      8,
    );
    strutBatch.name = 'commission-uplink-three-point-feed-struts';
    strutBatch.userData.attachmentCount = 3;

    const feedHorn = this.addMesh(
      elevationAssembly,
      new THREE.CylinderGeometry(0.028, 0.072, 0.14, 16, 1, false),
      this.materials.titanium,
      [0, 0, 0.535],
      [Math.PI / 2, 0, 0],
    );
    feedHorn.name = 'commission-uplink-prime-focus-feed-horn';
    feedHorn.userData.aimsAtReflector = true;
    feedHorn.userData.opticalAxis = [0, 0, -1];
    this.addTorus(
      elevationAssembly,
      0.073,
      0.012,
      jointWearMaterial,
      [0, 0, 0.465],
      [0, 0, 0],
    ).name = 'commission-uplink-feed-horn-aperture-ring';
    this.addCylinder(
      elevationAssembly,
      0.044,
      0.018,
      this.materials.carbonDark,
      [0, 0, 0.458],
      [Math.PI / 2, 0, 0],
      12,
    ).name = 'commission-uplink-feed-horn-dark-throat';
    const feedPulse = new THREE.Group();
    feedPulse.name = 'commission-uplink-physical-feed-lock-emitter';
    feedPulse.userData.physicalIntegration =
      'recessed-feed-throat-and-waveguide-endpoints';
    elevationAssembly.add(feedPulse);
    this.addMesh(
      feedPulse,
      new THREE.CircleGeometry(0.05, highDetail ? 16 : 10),
      linkMaterial,
      [0, 0, 0.447],
      [0, 0, 0],
      false,
    ).name = 'commission-uplink-feed-lock-emitter-disk';
    this.addTorus(
      feedPulse,
      0.07,
      0.01,
      linkMaterial,
      [0, 0, 0.451],
      [0, 0, 0],
    ).name = 'commission-uplink-feed-lock-emitter-collar';
    const calibrationPath = this.addCylinder(
      feedPulse,
      0.014,
      0.24,
      linkMaterial,
      [0, 0, 0.325],
      [Math.PI / 2, 0, 0],
      highDetail ? 12 : 8,
    );
    calibrationPath.name =
      'commission-uplink-feed-to-reflector-calibration-path';
    calibrationPath.userData.signalExtent =
      'within-feed-horn-and-reflector-volume';
    this.addTorus(
      feedPulse,
      0.045,
      0.009,
      linkMaterial,
      [0, 0, 0.195],
      [0, 0, 0],
    ).name = 'commission-uplink-reflector-focus-lock-target';
    feedPulse.userData.maxSignalRadius = 0.07;
    feedPulse.userData.calibrationPathLength = 0.24;
    rig.parts.uplinkFeedPulse = feedPulse;
    this.addCylinder(
      elevationAssembly,
      0.026,
      0.13,
      this.materials.titanium,
      [0, 0, 0.64],
      [Math.PI / 2, 0, 0],
      12,
    ).name = 'commission-uplink-feed-coaxial-neck';

    const receiverCabinet = this.addRoundedBox(
      elevationAssembly,
      [0.22, 0.18, 0.15],
      paintedArmorMaterial,
      [0.34, 0.08, -0.22],
      [0, -0.08, 0],
      0.025,
    );
    receiverCabinet.name = 'commission-uplink-dish-receiver-cabinet';
    receiverCabinet.userData.attachedTo = 'elevation-cradle';
    const waveguide = this.addInstancedBeams(
      elevationAssembly,
      this.materials.copper,
      [
        { from: [0.018, -0.025, 0.65], to: [0.048, 0.028, 0.48], radius: 0.018 },
        { from: [0.048, 0.028, 0.48], to: [0.351, 0.202, 0.145], radius: 0.018 },
        { from: [0.351, 0.202, 0.145], to: [0.42, 0.15, -0.06], radius: 0.018 },
        { from: [0.42, 0.15, -0.06], to: [0.34, 0.08, -0.22], radius: 0.018 },
      ],
      8,
    );
    waveguide.name = 'commission-uplink-rigid-copper-waveguide';
    waveguide.userData.path = 'feed-horn-to-receiver-cabinet';
    waveguide.userData.routing =
      'clipped-to-upper-feed-strut-then-behind-reflector';
    waveguide.userData.endpoints = [
      'feed-coaxial-neck-flange',
      'receiver-cabinet-bulkhead',
    ];
    this.addTorus(
      elevationAssembly,
      0.038,
      0.012,
      jointWearMaterial,
      [0.018, -0.025, 0.65],
      [0, 0, 0],
    ).name = 'commission-uplink-waveguide-feed-flange';
    this.addCylinder(
      elevationAssembly,
      0.045,
      0.028,
      jointWearMaterial,
      [0.34, 0.08, -0.235],
      [Math.PI / 2, 0, 0],
      10,
    ).name = 'commission-uplink-waveguide-receiver-bulkhead';
    for (const [index, position] of (
      [
        [0.351, 0.202, 0.145],
        [0.42, 0.15, -0.06],
      ] as const
    ).entries()) {
      this.addTorus(
        elevationAssembly,
        0.034,
        0.008,
        index === 0 ? jointWearMaterial : linkMaterial,
        [...position],
        [0.9, 0.2, -0.65],
      ).name = `commission-uplink-waveguide-support-clip-${index + 1}`;
    }
    this.addMesh(
      elevationAssembly,
      new THREE.SphereGeometry(0.026, highDetail ? 12 : 8, highDetail ? 8 : 6),
      linkMaterial,
      [0.34, 0.08, -0.25],
      [0, 0, 0],
      false,
    ).name = 'commission-uplink-receiver-lock-node';

    const counterweight = this.addRoundedBox(
      elevationAssembly,
      [0.3, 0.22, 0.2],
      this.materials.carbon,
      [0, 0, -0.38],
      [0, 0, 0],
      0.04,
    );
    counterweight.name = 'commission-uplink-rear-elevation-counterweight';
    counterweight.userData.balanceRole = 'reflector-and-feed-counterbalance';
    this.addInstancedBeams(
      elevationAssembly,
      this.materials.titanium,
      [
        { from: [-0.09, 0, -0.14], to: [-0.09, 0, -0.35], radius: 0.025 },
        { from: [0.09, 0, -0.14], to: [0.09, 0, -0.35], radius: 0.025 },
      ],
      8,
    ).name = 'commission-uplink-counterweight-tie-rods';

    const actuator = new THREE.Group();
    actuator.name = 'commission-uplink-elevation-linear-actuator';
    actuator.userData.mechanism = 'fork-to-elevation-sector';
    forkYoke.add(actuator);
    this.addInstancedBeams(
      actuator,
      this.materials.carbonDark,
      [
        { from: [0.37, 0.2, -0.16], to: [0.37, 0.48, -0.12], radius: 0.045 },
      ],
      12,
    );
    this.addInstancedBeams(
      actuator,
      this.materials.titaniumLight,
      [
        { from: [0.37, 0.48, -0.12], to: [0.39, 0.65, -0.03], radius: 0.022 },
      ],
      10,
    );
    this.addCylinder(
      actuator,
      0.052,
      0.075,
      jointWearMaterial,
      [0.37, 0.19, -0.16],
      [Math.PI / 2, 0, 0],
      10,
    );

    const serviceCabinet = this.addRoundedBox(
      root,
      [0.25, 0.35, 0.22],
      paintedArmorMaterial,
      [-0.42, 0.34, 0.28],
      [0, -0.04, 0],
      0.035,
    );
    serviceCabinet.name = 'commission-uplink-dedicated-service-cabinet';
    serviceCabinet.userData.serviceScope = 'drive-receiver-and-waveguide';
    this.addRoundedBox(
      root,
      [0.18, 0.22, 0.018],
      this.materials.carbon,
      [-0.42, 0.36, 0.397],
      [0, -0.04, 0],
      0.012,
    ).name = 'commission-uplink-service-cabinet-door';
    this.addInstancedBeams(
      root,
      this.materials.titanium,
      [
        { from: [-0.505, 0.255, 0.411], to: [-0.505, 0.465, 0.411], radius: 0.009 },
        { from: [-0.335, 0.255, 0.411], to: [-0.335, 0.465, 0.411], radius: 0.009 },
        { from: [-0.505, 0.255, 0.411], to: [-0.335, 0.255, 0.411], radius: 0.009 },
        { from: [-0.505, 0.465, 0.411], to: [-0.335, 0.465, 0.411], radius: 0.009 },
      ],
      6,
    ).name = 'commission-uplink-service-door-reinforced-frame';
    this.addRoundedBox(
      root,
      [0.025, 0.1, 0.025],
      this.materials.titaniumLight,
      [-0.35, 0.35, 0.425],
      [0, 0, 0],
      0.008,
    ).name = 'commission-uplink-service-door-handle';
    this.addRoundedBox(
      root,
      [0.095, 0.025, 0.012],
      this.materials.amber,
      [-0.45, 0.315, 0.424],
      [0, -0.04, -0.22],
      0.006,
    ).name = 'commission-uplink-service-door-hazard-mark-upper';
    this.addRoundedBox(
      root,
      [0.095, 0.025, 0.012],
      this.materials.amber,
      [-0.4, 0.355, 0.424],
      [0, -0.04, -0.22],
      0.006,
    ).name = 'commission-uplink-service-door-hazard-mark-lower';
    const cabinetLouvers = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      jointWearMaterial,
      [-0.015, 0.025, 0.065].map((offsetY) => ({
        position: [-0.45, 0.36 + offsetY, 0.425] as [
          number,
          number,
          number,
        ],
        scale: [0.105, 0.012, 0.018] as [number, number, number],
        rotation: [0.08, -0.04, 0] as [number, number, number],
      })),
      false,
    );
    cabinetLouvers.name =
      'commission-uplink-service-cabinet-weathered-cooling-louvers';
    const serviceStep = this.addRoundedBox(
      root,
      [0.42, 0.055, 0.24],
      structuralSteelMaterial,
      [-0.43, 0.22, 0.55],
      [0, 0, 0],
      0.014,
    );
    serviceStep.name = 'commission-uplink-bolted-service-access-step';
    serviceStep.userData.serviceAccess =
      'cabinet-door-and-azimuth-bearing-inspection';
    const serviceGrating = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.titaniumLight,
      Array.from({ length: highDetail ? 7 : 4 }, (_, index) => ({
        position: [
          -0.58 + index * 0.05,
          0.252,
          0.55,
        ] as [number, number, number],
        scale: [0.018, 0.018, 0.205] as [number, number, number],
      })),
      false,
    );
    serviceGrating.name = 'commission-uplink-service-step-open-grating';
    this.addInstancedBeams(
      root,
      structuralSteelMaterial,
      [
        { from: [-0.66, 0.23, 0.65], to: [-0.66, 0.68, 0.65], radius: 0.018 },
        { from: [-0.2, 0.23, 0.65], to: [-0.2, 0.68, 0.65], radius: 0.018 },
        { from: [-0.66, 0.68, 0.65], to: [-0.2, 0.68, 0.65], radius: 0.018 },
        { from: [-0.66, 0.48, 0.65], to: [-0.2, 0.48, 0.65], radius: 0.012 },
      ],
      8,
    ).name = 'commission-uplink-service-access-guardrail';
    for (const x of [-0.66, -0.2]) {
      this.addCylinder(
        root,
        0.034,
        0.045,
        jointWearMaterial,
        [x, 0.235, 0.65],
        [0, 0, 0],
        10,
      ).name = x < -0.4
        ? 'commission-uplink-guardrail-port-foot'
        : 'commission-uplink-guardrail-starboard-foot';
    }
    const cabinetLamps = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      signalMaterial,
      [
        { position: [-0.465, 0.43, 0.41], scale: [0.045, 0.03, 0.014] },
        { position: [-0.395, 0.43, 0.41], scale: [0.045, 0.03, 0.014] },
      ],
      false,
    );
    cabinetLamps.name = 'commission-uplink-receiver-lock-status-lamps';
    const serviceConduit = this.addInstancedBeams(
      root,
      this.materials.rubber,
      [
        { from: [-0.34, 0.48, 0.27], to: [-0.24, 0.43, 0.17], radius: 0.018 },
        { from: [-0.24, 0.43, 0.17], to: [-0.2, 0.43, 0.02], radius: 0.018 },
        { from: [-0.2, 0.43, 0.02], to: [-0.28, 0.49, -0.08], radius: 0.016 },
      ],
      8,
    );
    serviceConduit.name = 'commission-uplink-service-cabinet-conduit';
    serviceConduit.userData.path = 'cabinet-to-azimuth-drive';

    const custodyMaterial = signalMaterial.clone();
    custodyMaterial.name = 'commission-uplink-custody-interlock-material';
    custodyMaterial.color.set('#d5aa55');
    custodyMaterial.emissive.set('#d58c38');
    custodyMaterial.emissiveIntensity = 0.28;
    custodyMaterial.opacity = 0.9;
    custodyMaterial.depthWrite = false;
    rig.ownedMaterials.push(custodyMaterial);
    rig.parts.uplinkCustodyMaterial = custodyMaterial;

    const intakeCavityMaterial = new THREE.MeshStandardMaterial({
      name: 'commission-uplink-authored-lit-midtone-intake-cavity-material',
      color: '#87958e',
      emissive: '#526d63',
      emissiveIntensity: 0.56,
      roughness: 0.8,
      metalness: 0.26,
    });
    intakeCavityMaterial.userData.authoredSurface =
      'cinder-machine-panel-v2-lit-cavity-liner';
    rig.ownedMaterials.push(intakeCavityMaterial);

    const cavityLightMaterial = custodyMaterial.clone();
    cavityLightMaterial.name =
      'commission-uplink-custody-cavity-worklight-material';
    cavityLightMaterial.color.set('#f3d58d');
    cavityLightMaterial.emissive.set('#f0a94f');
    cavityLightMaterial.emissiveIntensity = 0.58;
    cavityLightMaterial.opacity = 0.78;
    rig.ownedMaterials.push(cavityLightMaterial);
    rig.parts.uplinkCavityLightMaterial = cavityLightMaterial;

    const custodyGlassMaterial = darkLinerMaterial.clone();
    custodyGlassMaterial.name =
      'commission-uplink-custody-smoked-armored-glass-material';
    custodyGlassMaterial.color.set('#496863');
    custodyGlassMaterial.emissive.set('#173a35');
    custodyGlassMaterial.emissiveIntensity = 0.16;
    custodyGlassMaterial.roughness = 0.32;
    custodyGlassMaterial.metalness = 0.08;
    custodyGlassMaterial.transparent = true;
    custodyGlassMaterial.opacity = 0.2;
    custodyGlassMaterial.depthWrite = false;
    rig.ownedMaterials.push(custodyGlassMaterial);

    const carrierStatusMaterial = custodyMaterial.clone();
    carrierStatusMaterial.name =
      'commission-uplink-carriage-phase-witness-material';
    carrierStatusMaterial.color.set('#cf8237');
    carrierStatusMaterial.emissive.set('#9e4d1f');
    carrierStatusMaterial.emissiveIntensity = 0.22;
    carrierStatusMaterial.opacity = 0.9;
    rig.ownedMaterials.push(carrierStatusMaterial);
    rig.parts.uplinkCarrierStatusMaterial = carrierStatusMaterial;

    const cargoCassetteMaterial = new THREE.MeshStandardMaterial({
      name: 'commission-uplink-painted-orange-cargo-cassette-material',
      color: '#d4772f',
      emissive: '#4a1c0a',
      emissiveIntensity: 0.34,
      roughness: 0.56,
      metalness: 0.46,
    });
    const cargoInspectionMaterial = new THREE.MeshStandardMaterial({
      name: 'commission-uplink-machined-cargo-saddle-material',
      color: '#cbd1ca',
      emissive: '#58625e',
      emissiveIntensity: 0.24,
      roughness: 0.42,
      metalness: 0.72,
    });
    const gateLeafMaterial = new THREE.MeshStandardMaterial({
      name: 'commission-uplink-midtone-gate-leaf-material',
      color: '#668477',
      emissive: '#4b6a5e',
      emissiveIntensity: 0.42,
      roughness: 0.74,
      metalness: 0.32,
    });
    rig.ownedMaterials.push(
      cargoCassetteMaterial,
      cargoInspectionMaterial,
      gateLeafMaterial,
    );

    const cargoRoute = new THREE.Group();
    cargoRoute.name = 'commission-uplink-front-cargo-custody-route';
    cargoRoute.userData.route =
      'belt-interface-over-exposed-rail-carriage-into-locking-custody-chamber';
    cargoRoute.userData.gridFacing = 'forward-z';
    cargoRoute.userData.custodySlots = 3;
    cargoRoute.userData.transmissionThreshold =
      'selected-commission-manifest-complete';
    root.add(cargoRoute);

    const unloadingBridge = new THREE.Group();
    unloadingBridge.name = 'commission-uplink-engineered-unloading-bridge';
    unloadingBridge.userData.bridgeExtent = [0.78, 0.58];
    cargoRoute.add(unloadingBridge);
    for (const x of [-0.09, 0.49]) {
      this.addRoundedBox(
        unloadingBridge,
        [0.09, 0.12, 0.58],
        structuralSteelMaterial,
        [x, 0.17, 0.68],
        [0, 0, 0],
        0.022,
      );
    }
    const bridgeCrossTies = this.addInstanceBatch(
      unloadingBridge,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.titanium,
      [0.48, 0.68, 0.88].map((z) => ({
        position: [0.2, 0.195, z] as [number, number, number],
        scale: [0.62, 0.052, 0.068] as [number, number, number],
      })),
    );
    bridgeCrossTies.name = 'commission-uplink-unloading-bridge-cross-ties';
    bridgeCrossTies.userData.crossTieCount = 3;
    const dockRollers = this.addInstanceBatch(
      unloadingBridge,
      new THREE.CylinderGeometry(1, 1, 1, highDetail ? 12 : 8, 1),
      this.materials.titaniumLight,
      [0.5, 0.69, 0.87]
        .slice(0, highDetail ? 3 : 2)
        .map((z) => ({
          position: [0.2, 0.225, z] as [number, number, number],
          scale: [0.036, 0.46, 0.036] as [number, number, number],
          rotation: [0, 0, Math.PI / 2] as [number, number, number],
        })),
    );
    dockRollers.name = 'commission-uplink-cargo-dock-transfer-rollers';
    dockRollers.userData.rollerCount = highDetail ? 3 : 2;
    const rollerBearings = this.addInstanceBatch(
      unloadingBridge,
      new THREE.CylinderGeometry(1, 1, 1, highDetail ? 12 : 8, 1),
      this.materials.amber,
      [0.5, 0.69, 0.87]
        .slice(0, highDetail ? 3 : 2)
        .flatMap((z) => [-0.055, 0.455].map((x) => ({
          position: [x, 0.225, z] as [number, number, number],
          scale: [0.052, 0.028, 0.052] as [number, number, number],
          rotation: [0, 0, Math.PI / 2] as [number, number, number],
        }))),
    );
    rollerBearings.name = 'commission-uplink-cargo-dock-roller-bearing-caps';
    rollerBearings.userData.bearingCount = highDetail ? 6 : 4;
    const beltContact = this.addCylinder(
      unloadingBridge,
      0.052,
      0.62,
      custodyMaterial,
      [0.2, 0.23, 0.64],
      [0, 0, Math.PI / 2],
      highDetail ? 14 : 9,
    );
    beltContact.name = 'commission-uplink-belt-interface-contact';
    beltContact.userData.endpoint =
      'eastbound-minus-lane-to-transfer-carriage';

    const transferRail = new THREE.Group();
    transferRail.name = 'commission-uplink-exposed-load-bearing-transfer-rail';
    transferRail.userData.forcePath =
      'belt-contact-through-twin-rails-cross-ties-and-actuator-to-chamber-stop';
    cargoRoute.add(transferRail);
    for (const x of [-0.15, 0.55]) {
      this.addRoundedBox(
        transferRail,
        [0.11, 0.15, 2.4],
        structuralSteelMaterial,
        [x, 0.23, -0.15],
        [0, 0, 0],
        0.024,
      );
    }
    const railCrossTies = this.addInstanceBatch(
      transferRail,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.titaniumLight,
      [0.92, 0.64, 0.36, 0.08, -0.2, -0.48, -0.76, -1.04, -1.3]
        .map((z) => ({
        position: [0.2, 0.205, z] as [number, number, number],
        scale: [0.78, 0.055, 0.09] as [number, number, number],
      })),
      false,
    );
    railCrossTies.name =
      'commission-uplink-transfer-rail-supported-cross-ties';
    railCrossTies.userData.crossTieCount = 9;
    const railRollers = this.addInstanceBatch(
      transferRail,
      new THREE.CylinderGeometry(1, 1, 1, highDetail ? 14 : 9, 1),
      this.materials.titaniumLight,
      [0.88, 0.6, 0.32, 0.04, -0.24, -0.52, -0.8, -1.08, -1.28]
        .slice(0, highDetail ? 9 : 5)
        .map((z) => ({
          position: [0.2, 0.255, z] as [number, number, number],
          scale: [0.045, 0.55, 0.045] as [number, number, number],
          rotation: [0, 0, Math.PI / 2] as [number, number, number],
        })),
      false,
    );
    railRollers.name = 'commission-uplink-exposed-transfer-roller-train';
    railRollers.userData.rollerCount = highDetail ? 9 : 5;
    const railBearingCaps = this.addInstanceBatch(
      transferRail,
      new THREE.CylinderGeometry(1, 1, 1, highDetail ? 12 : 8, 1),
      this.materials.amber,
      [0.88, 0.6, 0.32, 0.04, -0.24, -0.52, -0.8, -1.08, -1.28]
        .slice(0, highDetail ? 9 : 5)
        .flatMap((z) => [-0.11, 0.51].map((x) => ({
          position: [x, 0.255, z] as [number, number, number],
          scale: [0.064, 0.032, 0.064] as [number, number, number],
          rotation: [0, 0, Math.PI / 2] as [number, number, number],
        }))),
      false,
    );
    railBearingCaps.name =
      'commission-uplink-exposed-transfer-roller-bearing-caps';
    railBearingCaps.userData.bearingCount = highDetail ? 18 : 10;
    for (const z of [1.02, -1.4]) {
      this.addRoundedBox(
        transferRail,
        [0.76, 0.2, 0.11],
        this.materials.amber,
        [0.2, 0.25, z],
        [0, 0, 0],
        0.018,
      ).name = z > 0
        ? 'commission-uplink-outboard-carriage-hard-stop'
        : 'commission-uplink-inboard-chamber-hard-stop';
    }
    rig.parts.uplinkTransferRail = transferRail;

    const bayHousing = new THREE.Group();
    bayHousing.name = 'commission-uplink-midtone-unloading-bay-housing';
    bayHousing.userData.visualRole =
      'open-frame-load-bearing-buffer-and-transfer-enclosure';
    cargoRoute.add(bayHousing);
    this.addInstancedBeams(
      bayHousing,
      structuralSteelMaterial,
      [
        { from: [-0.31, 0.2, -0.38], to: [-0.31, 0.88, -0.38], radius: 0.055 },
        { from: [0.71, 0.2, -0.38], to: [0.71, 0.88, -0.38], radius: 0.055 },
        { from: [-0.31, 0.2, -1.44], to: [-0.31, 0.88, -1.44], radius: 0.055 },
        { from: [0.71, 0.2, -1.44], to: [0.71, 0.88, -1.44], radius: 0.055 },
        { from: [-0.31, 0.88, -0.38], to: [0.71, 0.88, -0.38], radius: 0.05 },
        { from: [-0.31, 0.88, -1.44], to: [0.71, 0.88, -1.44], radius: 0.05 },
        { from: [-0.31, 0.88, -0.38], to: [-0.31, 0.88, -1.44], radius: 0.045 },
        { from: [0.71, 0.88, -0.38], to: [0.71, 0.88, -1.44], radius: 0.045 },
      ],
      10,
    ).name = 'commission-uplink-open-bay-primary-load-cage';
    for (const x of [-0.27, 0.67]) {
      this.addRoundedBox(
        bayHousing,
        [0.11, 0.5, 1.0],
        intakeCavityMaterial,
        [x, 0.52, -0.92],
        [0, 0, 0],
        0.025,
      ).name = x < 0
        ? 'commission-uplink-cutaway-bay-port-side-panel'
        : 'commission-uplink-cutaway-bay-starboard-side-panel';
    }
    const bayInspectionDeck = this.addRoundedBox(
      bayHousing,
      [0.82, 0.075, 0.82],
      intakeCavityMaterial,
      [0.2, 0.315, -0.79],
      [0, 0, 0],
      0.02,
    );
    bayInspectionDeck.name =
      'commission-uplink-open-bay-illuminated-inspection-deck';
    bayInspectionDeck.castShadow = false;
    bayInspectionDeck.receiveShadow = false;
    const bayWorklights = this.addInstanceBatch(
      bayHousing,
      new THREE.BoxGeometry(1, 1, 1),
      cavityLightMaterial,
      [
        { position: [-0.235, 0.665, -0.58], scale: [0.045, 0.22, 0.045] },
        { position: [0.635, 0.665, -0.58], scale: [0.045, 0.22, 0.045] },
        { position: [-0.235, 0.665, -1.2], scale: [0.045, 0.22, 0.045] },
        { position: [0.635, 0.665, -1.2], scale: [0.045, 0.22, 0.045] },
      ],
      false,
    );
    bayWorklights.name =
      'commission-uplink-open-bay-four-point-physical-worklights';
    bayWorklights.userData.worklightCount = 4;
    const cargoThroat = this.addRoundedBox(
      cargoRoute,
      [0.66, 0.36, 0.1],
      intakeCavityMaterial,
      [0.2, 0.38, 0.51],
      [0, 0, 0],
      0.012,
    );
    cargoThroat.name = 'commission-uplink-recessed-cargo-intake-throat';
    cargoThroat.userData.accepts = 'finished-goods-manifest';
    cargoThroat.userData.articulatedEndpoint =
      'bridge-carriage-buffer-continuum';
    this.addInstancedBeams(
      cargoRoute,
      this.materials.titaniumLight,
      [
        { from: [-0.17, 0.16, 0.56], to: [0.57, 0.16, 0.56], radius: 0.04 },
        { from: [-0.17, 0.62, 0.56], to: [0.57, 0.62, 0.56], radius: 0.04 },
        { from: [-0.17, 0.16, 0.56], to: [-0.17, 0.62, 0.56], radius: 0.04 },
        { from: [0.57, 0.16, 0.56], to: [0.57, 0.62, 0.56], radius: 0.04 },
      ],
      9,
    ).name = 'commission-uplink-cargo-intake-load-frame';
    const intakeLockStrip = this.addRoundedBox(
      cargoRoute,
      [0.54, 0.055, 0.035],
      custodyMaterial,
      [0.2, 0.645, 0.57],
      [0, 0, 0],
      0.008,
    );
    intakeLockStrip.name = 'commission-uplink-intake-interlock-status-strip';

    const custodyChamber = new THREE.Group();
    custodyChamber.name =
      'commission-uplink-physical-locking-custody-receiver-chamber';
    custodyChamber.userData.receiverState = 'open-empty';
    custodyChamber.userData.forcePath =
      'rail-stop-through-door-latches-into-secured-count-rack';
    cargoRoute.add(custodyChamber);
    const chamberInterior = new THREE.Group();
    custodyChamber.add(chamberInterior);
    chamberInterior.name =
      'commission-uplink-custody-chamber-lifted-midtone-interior';
    chamberInterior.userData.cutaway =
      'open-top-and-front-reveal-secured-cargo';
    this.addRoundedBox(
      chamberInterior,
      [0.96, 0.11, 0.72],
      intakeCavityMaterial,
      [0.2, 0.35, -1.08],
      [0, 0, 0],
      0.025,
    ).name = 'commission-uplink-custody-chamber-midtone-floor-pan';
    this.addRoundedBox(
      chamberInterior,
      [0.96, 0.58, 0.1],
      intakeCavityMaterial,
      [0.2, 0.61, -1.42],
      [0, 0, 0],
      0.025,
    ).name = 'commission-uplink-custody-chamber-midtone-rear-bulkhead';
    const chamberWorklights = this.addInstanceBatch(
      chamberInterior,
      new THREE.BoxGeometry(1, 1, 1),
      cavityLightMaterial,
      [
        { position: [-0.08, 0.82, -1.362], scale: [0.26, 0.05, 0.026] },
        { position: [0.48, 0.82, -1.362], scale: [0.26, 0.05, 0.026] },
      ],
      false,
    );
    chamberWorklights.name =
      'commission-uplink-custody-chamber-recessed-worklights';
    chamberWorklights.userData.lightingRole =
      'readable-cargo-cavity-and-door-travel';
    const chamberRibs = this.addInstanceBatch(
      chamberInterior,
      new THREE.BoxGeometry(1, 1, 1),
      jointWearMaterial,
      [
        { position: [-0.2, 0.58, -1.363], scale: [0.04, 0.46, 0.026] },
        { position: [0.2, 0.58, -1.363], scale: [0.04, 0.46, 0.026] },
        { position: [0.6, 0.58, -1.363], scale: [0.04, 0.46, 0.026] },
      ],
      false,
    );
    chamberRibs.name =
      'commission-uplink-custody-bulkhead-reinforcing-ribs';
    const chamberFloor = this.addRoundedBox(
      custodyChamber,
      [0.88, 0.08, 0.68],
      this.materials.ceramic,
      [0.2, 0.29, -1.08],
      [0, 0, 0],
      0.018,
    );
    chamberFloor.name = 'commission-uplink-custody-receiver-keyed-floor';
    const chamberFloorRails = this.addInstanceBatch(
      custodyChamber,
      new THREE.BoxGeometry(1, 1, 1),
      structuralSteelMaterial,
      [-0.14, 0.2, 0.54].map((x) => ({
        position: [x, 0.345, -1.08] as [number, number, number],
        scale: [0.04, 0.028, 0.62] as [number, number, number],
      })),
      false,
    );
    chamberFloorRails.name =
      'commission-uplink-custody-keyed-load-rails';
    const custodyClamps = this.addInstanceBatch(
      custodyChamber,
      new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
      this.materials.amber,
      [
        { position: [-0.2, 0.47, -0.83], scale: [0.16, 0.13, 0.08], rotation: [0, -0.24, 0] },
        { position: [0.6, 0.47, -0.83], scale: [0.16, 0.13, 0.08], rotation: [0, 0.24, 0] },
        { position: [-0.2, 0.47, -1.25], scale: [0.16, 0.13, 0.08], rotation: [0, 0.24, 0] },
        { position: [0.6, 0.47, -1.25], scale: [0.16, 0.13, 0.08], rotation: [0, -0.24, 0] },
      ],
      false,
    );
    custodyClamps.name =
      'commission-uplink-custody-four-point-physical-load-clamps';
    custodyClamps.userData.clampCount = 4;
    this.addInstancedBeams(
      custodyChamber,
      this.materials.titaniumLight,
      [
        { from: [-0.36, 0.24, -0.64], to: [-0.36, 0.98, -0.64], radius: 0.05 },
        { from: [0.76, 0.24, -0.64], to: [0.76, 0.98, -0.64], radius: 0.05 },
        { from: [-0.36, 0.98, -0.64], to: [0.76, 0.98, -0.64], radius: 0.05 },
        { from: [-0.36, 0.24, -1.48], to: [-0.36, 0.98, -1.48], radius: 0.05 },
        { from: [0.76, 0.24, -1.48], to: [0.76, 0.98, -1.48], radius: 0.05 },
        { from: [-0.36, 0.98, -1.48], to: [0.76, 0.98, -1.48], radius: 0.05 },
      ],
      10,
    ).name = 'commission-uplink-custody-chamber-load-frame';
    const custodyDoors: [THREE.Group, THREE.Group] = [
      new THREE.Group(),
      new THREE.Group(),
    ];
    for (const [index, sign] of [-1, 1].entries()) {
      const door = custodyDoors[index]!;
      door.name = `commission-uplink-custody-sliding-door-${index + 1}`;
      door.position.set(0.2 + sign * 0.78, 0.6, -0.61);
      door.userData.side = sign;
      door.userData.openX = 0.2 + sign * 0.78;
      door.userData.closedX = 0.2 + sign * 0.245;
      door.userData.travel = 0.535;
      custodyChamber.add(door);
      this.addRoundedBox(
        door,
        [0.49, 0.68, 0.1],
        paintedArmorMaterial,
        [0, 0, 0],
        [0, 0, 0],
        0.035,
      );
      this.addRoundedBox(
        door,
        [0.27, 0.4, 0.112],
        custodyGlassMaterial,
        [0, 0.02, 0.006],
        [0, 0, 0],
        0.02,
      );
      this.addRoundedBox(
        door,
        [0.22, 0.06, 0.122],
        custodyMaterial,
        [0, 0.18, 0.016],
        [0, 0, 0],
        0.009,
      ).name =
        `commission-uplink-custody-door-status-bar-${index + 1}`;
      this.addRoundedBox(
        door,
        [0.034, 0.57, 0.122],
        this.materials.rubber,
        [-sign * 0.228, 0, 0.016],
        [0, 0, 0],
        0.008,
      ).name =
        `commission-uplink-custody-door-compression-gasket-${index + 1}`;
      const doorFasteners = this.addInstanceBatch(
        door,
        new THREE.CylinderGeometry(1, 0.78, 1, 8, 1),
        jointWearMaterial,
        [
          [-0.19, -0.27],
          [0.19, -0.27],
          [-0.19, 0.27],
          [0.19, 0.27],
        ].map(([x, y]) => ({
          position: [x ?? 0, y ?? 0, 0.064] as [number, number, number],
          scale: [0.025, 0.018, 0.025] as [number, number, number],
          rotation: [Math.PI / 2, 0, 0] as [number, number, number],
        })),
        false,
      );
      doorFasteners.name =
        `commission-uplink-custody-door-fasteners-${index + 1}`;
      this.addCylinder(
        door,
        0.055,
        0.06,
        this.materials.amber,
        [-sign * 0.16, 0, 0.065],
        [Math.PI / 2, 0, 0],
        highDetail ? 12 : 8,
      ).name =
        `commission-uplink-custody-door-latch-bearing-${index + 1}`;
    }
    const custodyPressureMaterial = custodyMaterial.clone();
    custodyPressureMaterial.name =
      'commission-uplink-vault-pressure-and-seal-material';
    custodyPressureMaterial.color.set('#c98b43');
    custodyPressureMaterial.emissive.set('#8f4e24');
    custodyPressureMaterial.emissiveIntensity = 0.16;
    custodyPressureMaterial.opacity = 0.84;
    rig.ownedMaterials.push(custodyPressureMaterial);
    rig.parts.uplinkCustodyPressureMaterial = custodyPressureMaterial;

    const custodyVaultContents = new THREE.Group();
    custodyVaultContents.name =
      'commission-uplink-visible-secured-custody-pressure-capsule';
    custodyVaultContents.position.set(0.2, 0.43, -1.08);
    custodyVaultContents.visible = false;
    custodyChamber.add(custodyVaultContents);
    this.addCylinder(
      custodyVaultContents,
      0.32,
      0.62,
      custodyGlassMaterial,
      [0, 0.2, 0],
      [0, 0, Math.PI / 2],
      highDetail ? 16 : 10,
    ).name = 'commission-uplink-custody-capsule-armored-drum';
    for (const x of [-0.25, 0, 0.25]) {
      this.addTorus(
        custodyVaultContents,
        0.326,
        0.026,
        jointWearMaterial,
        [x, 0.2, 0],
        [0, Math.PI / 2, 0],
      ).name = x === 0
        ? 'commission-uplink-custody-capsule-energized-center-band'
        : 'commission-uplink-custody-capsule-rubbed-retaining-band';
    }
    this.addRoundedBox(
      custodyVaultContents,
      [0.56, 0.13, 0.22],
      custodyGlassMaterial,
      [0, 0.25, 0.2],
      [-0.12, 0, 0],
      0.025,
    ).name = 'commission-uplink-custody-capsule-manifest-window';
    this.addRoundedBox(
      custodyVaultContents,
      [0.1, 0.045, 0.025],
      custodyPressureMaterial,
      [0.18, 0.34, 0.325],
      [-0.12, 0, 0],
      0.008,
    ).name = 'commission-uplink-custody-capsule-pressure-lamp';
    const capsuleFasteners = this.addInstanceBatch(
      custodyVaultContents,
      new THREE.CylinderGeometry(1, 0.8, 1, 8, 1),
      this.materials.titaniumLight,
      [-0.21, -0.07, 0.07, 0.21].map((x) => ({
        position: [x, 0.32, 0.245] as [number, number, number],
        scale: [0.022, 0.018, 0.022] as [number, number, number],
        rotation: [Math.PI / 2, 0, 0] as [number, number, number],
      })),
      false,
    );
    capsuleFasteners.name =
      'commission-uplink-custody-capsule-window-fasteners';
    rig.parts.uplinkCustodyVaultContents = custodyVaultContents;

    const custodySeal = new THREE.Group();
    custodySeal.name = 'commission-uplink-hinged-armored-custody-seal';
    custodySeal.position.set(0.2, 0.9, -1.46);
    custodySeal.rotation.x = -1.12;
    custodySeal.userData.openRotationX = -1.12;
    custodySeal.userData.closedRotationX = 0;
    custodySeal.userData.mechanism =
      'rear-hinged-pressure-lid-over-visible-custody-capsule';
    custodyChamber.add(custodySeal);
    const custodySealShell = this.addMesh(
      custodySeal,
      new THREE.CapsuleGeometry(
        0.17,
        0.64,
        highDetail ? 8 : 5,
        highDetail ? 16 : 10,
      ),
      paintedArmorMaterial,
      [0, 0, 0.39],
      [0, 0, Math.PI / 2],
    );
    custodySealShell.scale.set(0.48, 1, 2.05);
    custodySealShell.name =
      'commission-uplink-custody-seal-chipped-armor-lid';
    const custodySealInner = this.addMesh(
      custodySeal,
      new THREE.CapsuleGeometry(
        0.14,
        0.42,
        highDetail ? 7 : 4,
        highDetail ? 14 : 9,
      ),
      structuralSteelMaterial,
      [0, 0.086, 0.39],
      [0, 0, Math.PI / 2],
    );
    custodySealInner.scale.set(0.24, 1, 1.5);
    custodySealInner.name =
      'commission-uplink-custody-seal-cast-inner-pressure-panel';
    this.addTorus(
      custodySeal,
      0.115,
      0.021,
      jointWearMaterial,
      [0, 0.13, 0.39],
      [Math.PI / 2, 0, 0],
    ).name = 'commission-uplink-custody-seal-large-pressure-witness';
    this.addCylinder(
      custodySeal,
      0.035,
      0.018,
      custodyPressureMaterial,
      [0, 0.145, 0.39],
      [0, 0, 0],
      highDetail ? 12 : 8,
    ).name = 'commission-uplink-custody-seal-pressure-gauge-lamp';
    const sealRibs = this.addInstancedBeams(
      custodySeal,
      jointWearMaterial,
      [
        { from: [-0.42, 0.1, 0.08], to: [-0.22, 0.1, 0.68], radius: 0.025 },
        { from: [0.42, 0.1, 0.08], to: [0.22, 0.1, 0.68], radius: 0.025 },
        { from: [-0.22, 0.1, 0.68], to: [0.22, 0.1, 0.68], radius: 0.025 },
      ],
      8,
    );
    sealRibs.name =
      'commission-uplink-custody-seal-external-welded-ribs';
    rig.parts.uplinkCustodySeal = custodySeal;

    const custodyLockingBars: [THREE.Group, THREE.Group] = [
      new THREE.Group(),
      new THREE.Group(),
    ];
    for (const [index, sign] of [-1, 1].entries()) {
      const lockingBar = custodyLockingBars[index]!;
      lockingBar.name =
        `commission-uplink-custody-swing-locking-bar-${index + 1}`;
      lockingBar.position.set(0.2 + sign * 0.43, 0.91, -0.62);
      lockingBar.rotation.z = sign * 1.08;
      lockingBar.userData.side = sign;
      lockingBar.userData.openRotationZ = sign * 1.08;
      lockingBar.userData.closedRotationZ = sign * 0.13;
      custodyChamber.add(lockingBar);
      this.addRoundedBox(
        lockingBar,
        [0.12, 0.68, 0.12],
        structuralSteelMaterial,
        [0, -0.25, 0],
        [0, 0, 0],
        0.028,
      );
      this.addCylinder(
        lockingBar,
        0.095,
        0.13,
        jointWearMaterial,
        [0, 0.08, 0],
        [Math.PI / 2, 0, 0],
        highDetail ? 14 : 9,
      ).name =
        `commission-uplink-custody-swing-lock-bearing-${index + 1}`;
      this.addRoundedBox(
        lockingBar,
        [0.18, 0.14, 0.15],
        custodyPressureMaterial,
        [0, -0.57, 0],
        [0, 0, 0],
        0.025,
      ).name =
        `commission-uplink-custody-swing-lock-shoe-${index + 1}`;
    }
    rig.parts.uplinkCustodyLockingBars = custodyLockingBars;
    rig.parts.uplinkCustodyChamber = custodyChamber;
    rig.parts.uplinkCustodyDoors = custodyDoors;

    const actuatorMotor = this.addRoundedBox(
      cargoRoute,
      [0.42, 0.46, 0.5],
      paintedArmorMaterial,
      [0.92, 0.46, -1.18],
      [0, 0, 0],
      0.055,
    );
    actuatorMotor.name = 'commission-uplink-carriage-linear-actuator-motor';
    this.addCylinder(
      cargoRoute,
      0.13,
      0.16,
      jointWearMaterial,
      [0.92, 0.47, -0.9],
      [Math.PI / 2, 0, 0],
      highDetail ? 16 : 10,
    ).name = 'commission-uplink-carriage-actuator-thrust-bearing';
    const actuatorRod = this.addCylinder(
      cargoRoute,
      0.045,
      1,
      this.materials.titaniumLight,
      [0.92, 0.47, -0.04],
      [Math.PI / 2, 0, 0],
      highDetail ? 14 : 9,
    );
    actuatorRod.name = 'commission-uplink-carriage-exposed-actuator-rod';
    actuatorRod.castShadow = false;
    actuatorRod.userData.anchorZ = -0.96;
    rig.parts.uplinkTransferActuatorRod = actuatorRod;

    const transmissionCapacitorMaterial = signalMaterial.clone();
    transmissionCapacitorMaterial.name =
      'commission-uplink-physical-custody-conversion-capacitor-material';
    transmissionCapacitorMaterial.color.set('#799b93');
    transmissionCapacitorMaterial.emissive.set('#2f8e82');
    transmissionCapacitorMaterial.emissiveIntensity = 0.08;
    transmissionCapacitorMaterial.opacity = 0.88;
    transmissionCapacitorMaterial.depthWrite = true;
    rig.ownedMaterials.push(transmissionCapacitorMaterial);
    rig.parts.uplinkTransmissionCapacitorMaterial =
      transmissionCapacitorMaterial;
    const transmissionCapacitor = new THREE.Group();
    transmissionCapacitor.name =
      'commission-uplink-three-stage-custody-conversion-capacitor';
    transmissionCapacitor.position.set(-0.72, 0.3, -1.02);
    transmissionCapacitor.userData.causalRole =
      'sealed-custody-to-waveguide-power-conversion';
    root.add(transmissionCapacitor);
    this.addRoundedBox(
      transmissionCapacitor,
      [0.62, 0.54, 0.46],
      structuralSteelMaterial,
      [0, 0.3, 0],
      [0, 0, 0],
      0.075,
    ).name = 'commission-uplink-capacitor-cast-armored-cradle';
    for (const [index, x] of [-0.19, 0, 0.19].entries()) {
      this.addCylinder(
        transmissionCapacitor,
        0.105,
        0.38,
        index === 1
          ? transmissionCapacitorMaterial
          : this.materials.agedCopper,
        [x, 0.37, 0.15],
        [0, 0, 0],
        highDetail ? 14 : 9,
      ).name =
        `commission-uplink-capacitor-oil-can-${index + 1}`;
      this.addTorus(
        transmissionCapacitor,
        0.11,
        0.018,
        jointWearMaterial,
        [x, 0.56, 0.15],
        [Math.PI / 2, 0, 0],
      ).name =
        `commission-uplink-capacitor-can-retaining-ring-${index + 1}`;
    }
    const capacitorBus = this.addInstancedBeams(
      transmissionCapacitor,
      this.materials.copperBright,
      [
        { from: [-0.19, 0.58, 0.15], to: [0, 0.68, 0.15], radius: 0.025 },
        { from: [0, 0.68, 0.15], to: [0.19, 0.58, 0.15], radius: 0.025 },
        { from: [0, 0.68, 0.15], to: [0, 0.76, -0.04], radius: 0.022 },
      ],
      10,
    );
    capacitorBus.name =
      'commission-uplink-capacitor-exposed-copper-buswork';
    const capacitorWitness = this.addTorus(
      transmissionCapacitor,
      0.105,
      0.015,
      jointWearMaterial,
      [0, 0.76, -0.04],
      [Math.PI / 2, 0, 0],
    );
    capacitorWitness.name =
      'commission-uplink-capacitor-large-conversion-witness-ring';
    transmissionCapacitor.userData.witnessRing = capacitorWitness;
    rig.parts.uplinkTransmissionCapacitor = transmissionCapacitor;

    const custodyFeedMaterial = linkMaterial.clone();
    custodyFeedMaterial.name =
      'commission-uplink-shielded-custody-waveguide-material';
    custodyFeedMaterial.color.set('#6bb9b0');
    custodyFeedMaterial.emissive.set('#2aa99a');
    custodyFeedMaterial.emissiveIntensity = 0.05;
    custodyFeedMaterial.opacity = 0.24;
    rig.ownedMaterials.push(custodyFeedMaterial);
    rig.parts.uplinkCustodyFeedMaterial = custodyFeedMaterial;
    const custodyFeed = this.addInstancedBeams(
      root,
      custodyFeedMaterial,
      [
        { from: [0.2, 0.92, -1.08], to: [-0.32, 0.98, -1.02], radius: 0.026 },
        { from: [-0.32, 0.98, -1.02], to: [-0.72, 1.06, -1.02], radius: 0.026 },
        { from: [-0.72, 1.06, -1.02], to: [-0.68, 1.18, -0.66], radius: 0.024 },
        { from: [-0.68, 1.18, -0.66], to: [-0.43, 1.32, -0.43], radius: 0.022 },
        { from: [-0.43, 1.32, -0.43], to: [-0.43, 1.52, -0.43], radius: 0.019 },
      ],
      highDetail ? 12 : 8,
    );
    custodyFeed.name =
      'commission-uplink-custody-origin-to-transmitter-feed';
    custodyFeed.userData.origin = 'locking-custody-chamber';
    custodyFeed.userData.destination = 'dish-receiver-and-feed-horn';
    custodyFeed.castShadow = false;
    rig.parts.uplinkCustodyFeed = custodyFeed;

    // The transmission path is authored as a causal, destination-aware
    // assembly.  Its base is repositioned at the physical feed horn and its
    // axis is solved against the nearest powered grid receiver every frame.
    // Packet witnesses and a mast collar make custody conversion traceable;
    // this is never a straight, undestinationed "lightsaber".
    const outgoingBeam = new THREE.Group();
    outgoingBeam.name = 'commission-uplink-outgoing-transmission-beam';
    outgoingBeam.visible = false;
    outgoingBeam.userData.origin = 'dish-feed-horn';
    outgoingBeam.userData.destination =
      'nearest-powered-grid-relay-transmission-receiver';
    outgoingBeam.userData.causalChain =
      'secured-custody-through-waveguide-and-feed-horn-to-powered-relay';
    root.add(outgoingBeam);
    const packetTrailMaterial = linkMaterial.clone();
    packetTrailMaterial.name =
      'commission-uplink-subordinate-packet-guide-material';
    packetTrailMaterial.color.set('#628f88');
    packetTrailMaterial.emissive.set('#236f65');
    packetTrailMaterial.emissiveIntensity = 0.38;
    packetTrailMaterial.opacity = 0.14;
    packetTrailMaterial.depthWrite = false;
    rig.ownedMaterials.push(packetTrailMaterial);
    const outgoingBeamCore = this.addCylinder(
      outgoingBeam,
      0.0045,
      1,
      packetTrailMaterial,
      [0, 0.5, 0],
      [0, 0, 0],
      highDetail ? 12 : 8,
    );
    outgoingBeamCore.name =
      'commission-uplink-packet-stream-directional-core';
    outgoingBeamCore.castShadow = false;
    outgoingBeamCore.renderOrder = 9;
    rig.parts.uplinkOutgoingBeam = outgoingBeam;

    const transmissionPackets: THREE.Object3D[] = [];
    const packetCount = highDetail ? 3 : 2;
    for (let index = 0; index < packetCount; index += 1) {
      const packet = this.addMesh(
        root,
        new THREE.OctahedronGeometry(
          index === 0 ? 0.026 : 0.019,
          0,
        ),
        linkMaterial,
        [0, 0, 0],
        [0, index * 0.3, 0],
        false,
      );
      packet.name =
        `commission-uplink-transmission-packet-witness-${index + 1}`;
      packet.visible = false;
      packet.renderOrder = 10;
      packet.userData.packetIndex = index;
      packet.userData.custodyConversion = 'serialized-manifest-packet';
      transmissionPackets.push(packet);
    }
    rig.parts.uplinkTransmissionPackets = transmissionPackets;

    const transmissionReceiver = new THREE.Group();
    transmissionReceiver.name =
      'commission-uplink-physical-relay-transmission-receiver';
    transmissionReceiver.visible = false;
    transmissionReceiver.userData.receiverRole =
      'powered-grid-relay-packet-sink';
    root.add(transmissionReceiver);
    const receiverRings: THREE.Object3D[] = [];
    for (const [index, radius] of [0.11, 0.17].entries()) {
      const ring = this.addTorus(
        transmissionReceiver,
        radius,
        index === 0 ? 0.014 : 0.008,
        index === 1 ? jointWearMaterial : this.materials.titanium,
        [0, index * 0.045, 0],
        [Math.PI / 2, 0, 0],
      );
      ring.name =
        `commission-uplink-relay-receiver-collar-${index + 1}`;
      ring.renderOrder = 10;
      receiverRings.push(ring);
    }
    this.addMesh(
      transmissionReceiver,
      new THREE.OctahedronGeometry(0.052, 0),
      linkMaterial,
      [0, 0.1, 0],
      [0, Math.PI / 4, 0],
      false,
    ).name = 'commission-uplink-relay-packet-capture-node';
    rig.parts.uplinkTransmissionReceiver = transmissionReceiver;
    rig.parts.uplinkTransmissionReceiverRings = receiverRings;

    const custodyBuffer = new THREE.Group();
    custodyBuffer.name = 'commission-uplink-midtone-keyed-custody-buffer';
    custodyBuffer.position.z = -0.34;
    const commissionCargoKinds = [
      'ironOre',
      'copperOre',
      'coal',
      'stone',
      'ironPlate',
      'copperPlate',
      'stoneBrick',
      'ironGear',
      'copperWire',
      'circuit',
      'automationCore',
    ] as const;
    custodyBuffer.userData.slotKinds = [...commissionCargoKinds];
    cargoRoute.add(custodyBuffer);
    rig.parts.uplinkCustodyBuffer = custodyBuffer;

    const cargoBrickMaterial = this.materials.agedCeramic.clone();
    cargoBrickMaterial.name = 'commission-uplink-cargo-firebrick-material';
    cargoBrickMaterial.color.set('#a6543e');
    cargoBrickMaterial.roughness = 0.88;
    cargoBrickMaterial.metalness = 0.05;
    rig.ownedMaterials.push(cargoBrickMaterial);
    const cargoBrickLightMaterial = cargoBrickMaterial.clone();
    cargoBrickLightMaterial.name =
      'commission-uplink-cargo-firebrick-highlight-material';
    cargoBrickLightMaterial.color.set('#d37b58');
    rig.ownedMaterials.push(cargoBrickLightMaterial);
    const cargoBoardMaterial = this.materials.industrialPanel.clone();
    cargoBoardMaterial.name = 'commission-uplink-cargo-circuit-board-material';
    cargoBoardMaterial.color.set('#317a50');
    cargoBoardMaterial.roughness = 0.58;
    cargoBoardMaterial.metalness = 0.22;
    rig.ownedMaterials.push(cargoBoardMaterial);
    const cargoCoreMaterial = signalMaterial.clone();
    cargoCoreMaterial.name = 'commission-uplink-cargo-automation-core-material';
    cargoCoreMaterial.color.set('#4fd8aa');
    cargoCoreMaterial.emissive.set('#1bbf9f');
    cargoCoreMaterial.emissiveIntensity = 0.5;
    cargoCoreMaterial.opacity = 0.96;
    cargoCoreMaterial.depthWrite = true;
    rig.ownedMaterials.push(cargoCoreMaterial);
    const ironOreMaterial = this.materials.groundRock.clone();
    ironOreMaterial.name = 'commission-uplink-cargo-iron-ore-material';
    ironOreMaterial.color.set('#82969d');
    ironOreMaterial.roughness = 0.82;
    rig.ownedMaterials.push(ironOreMaterial);
    const copperOreMaterial = ironOreMaterial.clone();
    copperOreMaterial.name = 'commission-uplink-cargo-copper-ore-material';
    copperOreMaterial.color.set('#b56a46');
    rig.ownedMaterials.push(copperOreMaterial);
    const coalMaterial = ironOreMaterial.clone();
    coalMaterial.name = 'commission-uplink-cargo-coal-material';
    coalMaterial.color.set('#3e4649');
    coalMaterial.roughness = 0.92;
    rig.ownedMaterials.push(coalMaterial);
    const stoneMaterial = ironOreMaterial.clone();
    stoneMaterial.name = 'commission-uplink-cargo-stone-material';
    stoneMaterial.color.set('#a49778');
    stoneMaterial.roughness = 0.95;
    rig.ownedMaterials.push(stoneMaterial);
    const cargoIronPlateMaterial = this.materials.titaniumLight.clone();
    cargoIronPlateMaterial.name =
      'commission-uplink-cargo-machined-iron-plate-material';
    cargoIronPlateMaterial.color.set('#c3cbc5');
    cargoIronPlateMaterial.map = null;
    cargoIronPlateMaterial.normalMap = null;
    cargoIronPlateMaterial.roughnessMap = null;
    cargoIronPlateMaterial.metalnessMap = null;
    cargoIronPlateMaterial.aoMap = null;
    cargoIronPlateMaterial.emissive.set('#66706c');
    cargoIronPlateMaterial.emissiveIntensity = 0.32;
    cargoIronPlateMaterial.roughness = 0.46;
    cargoIronPlateMaterial.metalness = 0.78;
    rig.ownedMaterials.push(cargoIronPlateMaterial);

    const cargoSlugs: Record<(typeof commissionCargoKinds)[number], string> = {
      ironOre: 'iron-ore',
      copperOre: 'copper-ore',
      coal: 'coal',
      stone: 'stone',
      ironPlate: 'iron-plate',
      copperPlate: 'copper-plate',
      stoneBrick: 'stone-brick',
      ironGear: 'iron-gear',
      copperWire: 'copper-wire',
      circuit: 'circuit',
      automationCore: 'automation-core',
    };
    const cargoPrototypes = new Map<string, THREE.Group>();
    for (const kind of commissionCargoKinds) {
      const item = new THREE.Group();
      item.name = `commission-uplink-cargo-prototype-${cargoSlugs[kind]}`;
      item.userData.itemKind = kind;
      item.userData.recognizableSilhouette = true;
      switch (kind) {
        case 'ironOre':
        case 'copperOre':
        case 'coal':
        case 'stone': {
          const rawMaterial = kind === 'ironOre'
            ? ironOreMaterial
            : kind === 'copperOre'
              ? copperOreMaterial
              : kind === 'coal'
                ? coalMaterial
                : stoneMaterial;
          const rockLayout = kind === 'coal'
            ? [
                [-0.05, 0.032, -0.02, 0.052],
                [0.005, 0.042, 0.025, 0.061],
                [0.055, 0.028, -0.015, 0.045],
                [-0.015, 0.025, -0.052, 0.04],
              ] as const
            : kind === 'stone'
              ? [
                  [-0.04, 0.038, 0.005, 0.063],
                  [0.045, 0.032, -0.01, 0.055],
                ] as const
              : [
                  [-0.048, 0.032, -0.018, 0.053],
                  [0.005, 0.043, 0.025, 0.062],
                  [0.052, 0.027, -0.02, 0.046],
                ] as const;
          for (const [index, [x, y, z, radius]] of rockLayout.entries()) {
            this.addMesh(
              item,
              new THREE.DodecahedronGeometry(radius, 0),
              rawMaterial,
              [x, y, z],
              [
                0.12 + index * 0.17,
                0.24 + index * 0.51,
                -0.08 + index * 0.11,
              ],
            );
          }
          break;
        }
        case 'ironPlate': {
          // A strapped stack remains recognizably "iron plate" while reading
          // as a physically consequential paid shipment at gameplay scale.
          for (let layer = 0; layer < 4; layer += 1) {
            this.addRoundedBox(
              item,
              [0.15 - layer * 0.004, 0.018, 0.1],
              cargoIronPlateMaterial,
              [
                (layer % 2 === 0 ? -1 : 1) * 0.004,
                0.01 + layer * 0.02,
                (layer - 1.5) * 0.004,
              ],
              [0, (layer % 2 === 0 ? 1 : -1) * 0.035, 0],
              0.005,
            );
          }
          this.addInstancedBeams(
            item,
            this.materials.copperBright,
            [
              { from: [-0.078, 0.086, -0.026], to: [0.078, 0.086, -0.026], radius: 0.006 },
              { from: [-0.078, 0.086, 0.026], to: [0.078, 0.086, 0.026], radius: 0.006 },
            ],
            6,
          ).name = 'commission-uplink-iron-plate-copper-shipping-straps';
          break;
        }
        case 'copperPlate':
          this.addRoundedBox(
            item,
            [0.14, 0.027, 0.092],
            this.materials.copperBright,
            [0, 0.014, 0],
            [0, -0.06, 0],
            0.006,
          );
          this.addInstancedBeams(
            item,
            jointWearMaterial,
            [
              { from: [-0.05, 0.032, -0.025], to: [0.05, 0.032, -0.025], radius: 0.006 },
              { from: [-0.05, 0.032, 0.025], to: [0.05, 0.032, 0.025], radius: 0.006 },
            ],
            6,
          );
          break;
        case 'stoneBrick':
          for (const [index, x] of [-0.048, 0, 0.048].entries()) {
            this.addRoundedBox(
              item,
              [0.043, 0.045, 0.085],
              index % 2 === 0
                ? cargoBrickMaterial
                : cargoBrickLightMaterial,
              [x, 0.023, 0.015],
              [0, index % 2 === 0 ? 0.07 : -0.07, 0],
              0.005,
            );
          }
          this.addRoundedBox(
            item,
            [0.082, 0.037, 0.075],
            cargoBrickLightMaterial,
            [0, 0.064, -0.02],
            [0, -0.04, 0],
            0.005,
          );
          break;
        case 'ironGear':
          this.addTorus(
            item,
            0.056,
            0.018,
            this.materials.titaniumLight,
            [0, 0.03, 0],
            [Math.PI / 2, 0, 0],
          );
          this.addInstanceBatch(
            item,
            new THREE.BoxGeometry(1, 1, 1),
            this.materials.titaniumLight,
            Array.from({ length: 8 }, (_, index) => {
              const angle = index * Math.PI / 4;
              return {
                position: [
                  Math.sin(angle) * 0.075,
                  0.03,
                  Math.cos(angle) * 0.075,
                ] as [number, number, number],
                scale: [0.026, 0.032, 0.038] as [number, number, number],
                rotation: [0, angle, 0] as [number, number, number],
              };
            }),
          );
          this.addCylinder(
            item,
            0.018,
            0.05,
            this.materials.carbonDark,
            [0, 0.03, 0],
            [0, 0, 0],
            12,
          );
          break;
        case 'copperWire':
          this.addCylinder(
            item,
            0.043,
            0.11,
            jointWearMaterial,
            [0, 0.04, 0],
            [0, 0, Math.PI / 2],
            highDetail ? 16 : 10,
          );
          for (const x of [-0.06, -0.03, 0, 0.03, 0.06]) {
            this.addTorus(
              item,
              Math.abs(x) > 0.05 ? 0.052 : 0.039,
              Math.abs(x) > 0.05 ? 0.01 : 0.013,
              Math.abs(x) > 0.05
                ? this.materials.titanium
                : this.materials.copperBright,
              [x, 0.04, 0],
              [0, Math.PI / 2, 0],
            );
          }
          this.addInstancedBeams(
            item,
            this.materials.copperBright,
            [
              { from: [-0.045, 0.04, 0.04], to: [-0.09, 0.04, 0.075], radius: 0.007 },
              { from: [0.045, 0.04, -0.04], to: [0.09, 0.04, -0.075], radius: 0.007 },
            ],
            6,
          );
          break;
        case 'circuit':
          this.addRoundedBox(
            item,
            [0.145, 0.025, 0.105],
            cargoBoardMaterial,
            [0, 0.015, 0],
            [0, 0.08, 0],
            0.006,
          );
          this.addRoundedBox(
            item,
            [0.05, 0.028, 0.04],
            this.materials.carbonDark,
            [0.01, 0.04, 0],
            [0, 0.08, 0],
            0.005,
          );
          this.addInstanceBatch(
            item,
            new THREE.CylinderGeometry(1, 1, 1, 8, 1),
            this.materials.copperBright,
            [
              { position: [-0.045, 0.039, -0.025], scale: [0.012, 0.012, 0.012] },
              { position: [-0.045, 0.039, 0.025], scale: [0.012, 0.012, 0.012] },
              { position: [0.055, 0.039, 0], scale: [0.012, 0.012, 0.012] },
            ],
          );
          break;
        case 'automationCore':
          this.addCylinder(
            item,
            0.063,
            0.045,
            cargoBoardMaterial,
            [0, 0.025, 0],
            [0, 0, 0],
            6,
          );
          this.addTorus(
            item,
            0.054,
            0.011,
            this.materials.copperBright,
            [0, 0.052, 0],
            [Math.PI / 2, 0, 0],
          );
          this.addMesh(
            item,
            new THREE.OctahedronGeometry(0.034, 0),
            cargoCoreMaterial,
            [0, 0.073, 0],
            [0, Math.PI / 4, 0],
            false,
          );
          break;
      }
      cargoPrototypes.set(kind, item);
    }

    const mountCargoVariants = (
      host: THREE.Object3D,
      mountLabel: string,
      scale: number,
    ): Map<string, THREE.Object3D> => {
      const variants = new Map<string, THREE.Object3D>();
      for (const kind of commissionCargoKinds) {
        const variant = cargoPrototypes.get(kind)!.clone(true);
        variant.name =
          `commission-uplink-${mountLabel}-${cargoSlugs[kind]}-silhouette`;
        variant.userData.itemKind = kind;
        variant.userData.recognizableSilhouette = true;
        variant.userData.mountScale = scale;
        variant.userData.mountBaseY =
          mountLabel === 'transfer-payload' ? 0.045 : 0;
        variant.scale.setScalar(scale);
        variant.position.y = variant.userData.mountBaseY;
        variant.visible = false;
        host.add(variant);
        variants.set(kind, variant);
      }
      return variants;
    };

    const custodySlots: THREE.Object3D[] = [];
    const custodySlotVariants: Array<Map<string, THREE.Object3D>> = [];
    const custodyCountIndicators: THREE.Object3D[] = [];
    const slotCenters = [-0.08, 0.2, 0.48];
    for (const [slotIndex, x] of slotCenters.entries()) {
      const slot = this.addRoundedBox(
        custodyBuffer,
        [0.28, 0.07, 0.34],
        this.materials.ceramicDark,
        [x, 0.48, -0.52],
        [0, 0, 0],
        0.012,
      );
      slot.name =
        `commission-uplink-custody-slot-${slotIndex + 1}-midtone-saddle`;
      slot.userData.slotIndex = slotIndex;
      const itemHost = new THREE.Group();
      itemHost.name =
        `commission-uplink-custody-slot-${slotIndex + 1}-item-host`;
      itemHost.position.set(x, 0.63, -0.52);
      custodyBuffer.add(itemHost);
      const indicatorHousing = this.addRoundedBox(
        custodyBuffer,
        [0.17, 0.1, 0.055],
        this.materials.carbon,
        [x, 0.88, -0.7],
        [-0.18, 0, 0],
        0.01,
      );
      indicatorHousing.name =
        `commission-uplink-custody-count-housing-${slotIndex + 1}`;
      const countIndicator = this.addRoundedBox(
        custodyBuffer,
        [0.145, 0.07, 0.065],
        custodyMaterial,
        [x, 0.89, -0.665],
        [-0.18, 0, 0],
        0.008,
      );
      countIndicator.name =
        `commission-uplink-custody-count-cue-${slotIndex + 1}`;
      countIndicator.visible = false;
      countIndicator.userData.slotIndex = slotIndex;
      custodyCountIndicators.push(countIndicator);
      custodySlots.push(itemHost);
      custodySlotVariants.push(
        mountCargoVariants(
          itemHost,
          `custody-slot-${slotIndex + 1}`,
          3.2,
        ),
      );
    }
    rig.parts.uplinkCustodySlots = custodySlots;
    rig.parts.uplinkCustodySlotVariants = custodySlotVariants;
    rig.parts.uplinkCustodyItems = [];
    rig.parts.uplinkCustodyCountIndicators = custodyCountIndicators;

    const transferCarriage = new THREE.Group();
    transferCarriage.name = 'commission-uplink-articulated-transfer-carriage';
    transferCarriage.position.set(0.2, 0.34, 0.92);
    transferCarriage.userData.outboardZ = 0.92;
    transferCarriage.userData.inboardZ = -1.18;
    transferCarriage.userData.strokeLength = 2.1;
    cargoRoute.add(transferCarriage);
    rig.parts.uplinkTransferCarriage = transferCarriage;
    this.addRoundedBox(
      transferCarriage,
      [0.82, 0.16, 0.5],
      structuralSteelMaterial,
      [0, 0, 0],
      [0, 0, 0],
      0.02,
    ).name = 'commission-uplink-transfer-carriage-saddle';
    this.addRoundedBox(
      transferCarriage,
      [0.68, 0.06, 0.36],
      cargoInspectionMaterial,
      [0, 0.11, 0],
      [0, 0, 0],
      0.008,
    ).name = 'commission-uplink-transfer-carriage-item-bed';
    const transferArms: [THREE.Group, THREE.Group] = [
      new THREE.Group(),
      new THREE.Group(),
    ];
    const transferJaws: [THREE.Group, THREE.Group] = [
      new THREE.Group(),
      new THREE.Group(),
    ];
    for (const [index, sign] of [-1, 1].entries()) {
      const arm = transferArms[index]!;
      arm.name = `commission-uplink-transfer-arm-${index + 1}`;
      arm.position.set(sign * 0.36, 0.17, 0.09);
      arm.userData.side = sign;
      arm.userData.motionEnvelope =
        'short-link-alongside-carriage-clear-of-cargo-lanes';
      transferCarriage.add(arm);
      const armPivot = this.addCylinder(
        arm,
        0.085,
        0.09,
        this.materials.amber,
        [0, 0, 0.02],
        [0, 0, 0],
        highDetail ? 12 : 8,
      );
      armPivot.name =
        `commission-uplink-transfer-arm-supported-bearing-${index + 1}`;
      armPivot.castShadow = false;
      armPivot.receiveShadow = false;
      const armLink = this.addRoundedBox(
        arm,
        [0.11, 0.15, 0.28],
        this.materials.titaniumLight,
        [0, 0, -0.07],
        [0, 0, 0],
        0.012,
      );
      armLink.name =
        `commission-uplink-transfer-short-midtone-link-${index + 1}`;
      armLink.castShadow = false;
      armLink.receiveShadow = false;
      const jaw = transferJaws[index]!;
      jaw.name = `commission-uplink-transfer-jaw-${index + 1}`;
      jaw.position.set(-sign * 0.09, 0.04, -0.24);
      arm.add(jaw);
      const jawBlock = this.addRoundedBox(
        jaw,
        [0.18, 0.18, 0.15],
        this.materials.amber,
        [0, 0, 0],
        [0, 0, 0],
        0.01,
      );
      jawBlock.name =
        `commission-uplink-transfer-high-visibility-jaw-block-${index + 1}`;
      jawBlock.castShadow = false;
      jawBlock.receiveShadow = false;
    }
    rig.parts.uplinkTransferArms = transferArms;
    rig.parts.uplinkTransferJaws = transferJaws;
    const transferScissors: [THREE.Group, THREE.Group] = [
      new THREE.Group(),
      new THREE.Group(),
    ];
    for (const [index, sign] of [-1, 1].entries()) {
      const scissor = transferScissors[index]!;
      scissor.name =
        `commission-uplink-carriage-lift-scissor-${index + 1}`;
      scissor.position.set(sign * 0.27, -0.03, 0);
      scissor.userData.side = sign;
      transferCarriage.add(scissor);
      this.addInstancedBeams(
        scissor,
        jointWearMaterial,
        [
          { from: [0, -0.08, -0.2], to: [0, 0.14, 0.2], radius: 0.025 },
          { from: [0, -0.08, 0.2], to: [0, 0.14, -0.2], radius: 0.025 },
        ],
        8,
      );
      this.addCylinder(
        scissor,
        0.05,
        0.06,
        this.materials.amber,
        [0, 0.03, 0],
        [0, 0, Math.PI / 2],
        highDetail ? 12 : 8,
      ).name =
        `commission-uplink-carriage-lift-scissor-pivot-${index + 1}`;
    }
    rig.parts.uplinkTransferScissors = transferScissors;

    const payloadCarrier = new THREE.Group();
    payloadCarrier.name = 'commission-uplink-high-visibility-payload-carrier';
    payloadCarrier.position.set(0, 0.15, 0);
    payloadCarrier.userData.occupied = false;
    transferCarriage.add(payloadCarrier);
    const carrierKeyedBed = this.addRoundedBox(
      payloadCarrier,
      [0.88, 0.1, 0.5],
      cargoInspectionMaterial,
      [0, 0, 0],
      [0, 0, 0],
      0.018,
    );
    carrierKeyedBed.name =
      'commission-uplink-payload-carrier-keyed-bed';
    carrierKeyedBed.castShadow = false;
    carrierKeyedBed.receiveShadow = false;
    for (const x of [-0.43, 0.43]) {
      this.addRoundedBox(
        payloadCarrier,
        [0.075, 0.33, 0.5],
        this.materials.amber,
        [x, 0.165, 0],
        [0, 0, 0],
        0.015,
      );
    }
    const carrierCage = this.addInstancedBeams(
      payloadCarrier,
      structuralSteelMaterial,
      [
        { from: [-0.42, 0.1, -0.23], to: [-0.42, 0.55, -0.23], radius: 0.022 },
        { from: [0.42, 0.1, -0.23], to: [0.42, 0.55, -0.23], radius: 0.022 },
        { from: [-0.42, 0.1, 0.23], to: [-0.42, 0.55, 0.23], radius: 0.022 },
        { from: [0.42, 0.1, 0.23], to: [0.42, 0.55, 0.23], radius: 0.022 },
        { from: [-0.42, 0.55, -0.23], to: [0.42, 0.55, -0.23], radius: 0.019 },
        { from: [-0.42, 0.55, 0.23], to: [0.42, 0.55, 0.23], radius: 0.019 },
      ],
      7,
    );
    carrierCage.name =
      'commission-uplink-payload-carrier-visible-retention-cage';
    carrierCage.userData.phaseCue =
      'large-moving-outline-readable-at-normal-camera';
    const carrierPhaseFlags = this.addInstanceBatch(
      payloadCarrier,
      new THREE.BoxGeometry(1, 1, 1),
      carrierStatusMaterial,
      [
        { position: [-0.47, 0.49, -0.19], scale: [0.1, 0.18, 0.045], rotation: [0, 0, -0.18] },
        { position: [0.47, 0.49, -0.19], scale: [0.1, 0.18, 0.045], rotation: [0, 0, 0.18] },
      ],
      false,
    );
    carrierPhaseFlags.name =
      'commission-uplink-payload-carrier-phase-flags';
    this.addRoundedBox(
      payloadCarrier,
      [0.74, 0.075, 0.06],
      carrierStatusMaterial,
      [0, 0.34, -0.275],
      [0, 0, 0],
      0.016,
    ).name = 'commission-uplink-payload-carrier-occupied-witness';
    for (const x of [-0.42, 0.42]) {
      this.addCylinder(
        payloadCarrier,
        0.065,
        0.09,
        carrierStatusMaterial,
        [x, 0.35, -0.17],
        [0, 0, 0],
        highDetail ? 12 : 8,
      ).name = x < 0
        ? 'commission-uplink-payload-carrier-port-witness-beacon'
        : 'commission-uplink-payload-carrier-starboard-witness-beacon';
    }
    rig.parts.uplinkTransferPayloadCarrier = payloadCarrier;

    const transferPayload = new THREE.Group();
    transferPayload.name = 'commission-uplink-transfer-payload-host';
    transferPayload.position.set(0, 0.4, -0.01);
    payloadCarrier.add(transferPayload);
    transferPayload.visible = false;
    const cargoCassette = this.addRoundedBox(
      transferPayload,
      [0.8, 0.13, 0.43],
      cargoCassetteMaterial,
      [0, 0.04, 0],
      [0, 0, 0],
      0.028,
    );
    cargoCassette.name =
      'commission-uplink-transfer-paid-cargo-cassette';
    cargoCassette.castShadow = false;
    cargoCassette.receiveShadow = false;
    cargoCassette.userData.cargoRepresentation =
      'single-authoritative-item-shipping-cassette';
    const cassetteSaddle = this.addRoundedBox(
      transferPayload,
      [0.68, 0.045, 0.33],
      cargoInspectionMaterial,
      [0, 0.105, 0],
      [0, 0, 0],
      0.012,
    );
    cassetteSaddle.name =
      'commission-uplink-transfer-cassette-ceramic-inspection-saddle';
    cassetteSaddle.castShadow = false;
    cassetteSaddle.receiveShadow = false;
    this.addInstancedBeams(
      transferPayload,
      this.materials.copperBright,
      [
        { from: [-0.34, 0.13, -0.18], to: [-0.34, 0.13, 0.18], radius: 0.018 },
        { from: [0.34, 0.13, -0.18], to: [0.34, 0.13, 0.18], radius: 0.018 },
      ],
      7,
    ).name = 'commission-uplink-transfer-cassette-retaining-straps';
    rig.parts.uplinkTransferPayload = transferPayload;
    const transferPayloadVariants = mountCargoVariants(
      transferPayload,
      'transfer-payload',
      5,
    );
    for (const variant of transferPayloadVariants.values()) {
      variant.traverse((object) => {
        if (object instanceof THREE.Mesh) object.receiveShadow = false;
      });
    }
    rig.parts.uplinkTransferPayloadVariants = transferPayloadVariants;

    const intakeCanopy = new THREE.Group();
    intakeCanopy.name =
      'commission-uplink-hinged-armored-belt-capture-canopy';
    intakeCanopy.position.set(0.2, 0.84, 0.5);
    intakeCanopy.rotation.x = -1.12;
    intakeCanopy.userData.openRotationX = -1.12;
    intakeCanopy.userData.closedRotationX = -0.08;
    intakeCanopy.userData.mechanism =
      'belt-contact-capture-hood-coupled-to-carriage-interlock';
    cargoRoute.add(intakeCanopy);
    const canopyShell = this.addMesh(
      intakeCanopy,
      new THREE.CapsuleGeometry(
        0.17,
        0.62,
        highDetail ? 8 : 5,
        highDetail ? 16 : 10,
      ),
      paintedArmorMaterial,
      [0, 0, 0.31],
      [0, 0, Math.PI / 2],
    );
    canopyShell.scale.set(0.45, 1, 1.72);
    canopyShell.name =
      'commission-uplink-capture-canopy-chipped-armor';
    const canopyInner = this.addMesh(
      intakeCanopy,
      new THREE.CapsuleGeometry(
        0.13,
        0.4,
        highDetail ? 7 : 4,
        highDetail ? 14 : 9,
      ),
      intakeCavityMaterial,
      [0, 0.084, 0.31],
      [0, 0, Math.PI / 2],
    );
    canopyInner.scale.set(0.26, 1, 1.32);
    canopyInner.name =
      'commission-uplink-capture-canopy-recessed-inner-panel';
    this.addInstancedBeams(
      intakeCanopy,
      this.materials.amber,
      [
        { from: [-0.43, 0.105, 0.11], to: [-0.2, 0.105, 0.51], radius: 0.026 },
        { from: [-0.12, 0.105, 0.11], to: [0.11, 0.105, 0.51], radius: 0.026 },
        { from: [0.19, 0.105, 0.11], to: [0.42, 0.105, 0.51], radius: 0.026 },
      ],
      8,
    ).name = 'commission-uplink-capture-canopy-worn-hazard-ribs';
    rig.parts.uplinkIntakeCanopy = intakeCanopy;

    const cargoGate = new THREE.Group();
    cargoGate.name = 'commission-uplink-interlocked-cargo-intake-gate';
    cargoGate.position.set(0.2, 0.92, -0.58);
    cargoGate.rotation.x = -1.02;
    cargoGate.userData.interlock =
      'authoritative-selected-manifest-and-custody-latch';
    cargoRoute.add(cargoGate);
    for (const x of [-0.15, 0.15]) {
      const gateLeaf = this.addRoundedBox(
        cargoGate,
        [0.31, 0.23, 0.065],
        gateLeafMaterial,
        [x * 1.35, 0, 0],
        [0, 0, 0],
        0.012,
      );
      gateLeaf.receiveShadow = false;
    }
    this.addInstancedBeams(
      cargoGate,
      this.materials.amber,
      [
        { from: [-0.39, 0.11, 0.055], to: [-0.11, -0.1, 0.055], radius: 0.026 },
        { from: [0.11, 0.11, 0.055], to: [0.39, -0.1, 0.055], radius: 0.026 },
      ],
      6,
    ).name = 'commission-uplink-cargo-gate-hazard-chevrons';
    rig.parts.uplinkCargoGate = cargoGate;

    const cableTrench = this.addRoundedBox(
      root,
      [0.22, 0.032, 0.56],
      this.materials.rubber,
      [-0.42, 0.025, 0.53],
      [0, 0, 0],
      0.012,
    );
    cableTrench.name = 'commission-uplink-recessed-cable-trench';
    cableTrench.userData.path = 'service-cabinet-to-site-grid';
    const trenchCovers = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.titanium,
      [0.33, 0.48, 0.63].map((z) => ({
        position: [-0.42, 0.048, z] as [number, number, number],
        scale: [0.25, 0.024, 0.1] as [number, number, number],
      })),
    );
    trenchCovers.name = 'commission-uplink-cable-trench-removable-covers';
    trenchCovers.userData.coverCount = 3;
    this.addInstancedBeams(
      root,
      this.materials.rubber,
      [
        {
          from: [-0.42, 0.055, 0.3],
          to: [-0.42, 0.22, 0.31],
          radius: 0.022,
        },
      ],
      8,
    ).name = 'commission-uplink-cabinet-trench-cable-rise';

    const localizedWear = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      jointWearMaterial,
      [
        { position: [-0.48, 0.12, -0.4], scale: [0.13, 0.012, 0.035], rotation: [0, 0.12, 0] },
        { position: [0.46, 0.12, 0.39], scale: [0.11, 0.012, 0.032], rotation: [0, -0.14, 0] },
        { position: [-0.48, 0.29, 0.4], scale: [0.035, 0.09, 0.012], rotation: [0, 0, 0.08] },
        { position: [0.33, 0.465, -0.02], scale: [0.07, 0.012, 0.026], rotation: [0, 0.28, 0] },
      ],
    );
    localizedWear.name = 'commission-uplink-function-specific-joint-wear';
    localizedWear.userData.wearScopes = [
      'foundation-fasteners',
      'azimuth-bearing',
      'service-latch',
      'elevation-drive',
    ];

    const selectionIndicators: THREE.Object3D[] = [];
    const cornerBeams: DetailBeam[] = [];
    for (const x of [-1.24, 1.24]) {
      for (const z of [-1.48, 1.18]) {
        cornerBeams.push(
          {
            from: [x, 0.03, z],
            to: [x - Math.sign(x) * 0.18, 0.03, z],
            radius: 0.012,
          },
          {
            from: [x, 0.03, z],
            to: [x, 0.03, z - Math.sign(z) * 0.18],
            radius: 0.012,
          },
        );
      }
    }
    const cornerIndicators = this.addInstancedBeams(
      root,
      effectMaterial,
      cornerBeams,
      6,
    );
    cornerIndicators.name = 'commission-uplink-selected-corner-brackets';
    cornerIndicators.userData.selectionRole =
      'restrained-clear-of-hardware-footprint-corners';
    cornerIndicators.userData.maxRadius = 1.92;
    cornerIndicators.userData.dockClearanceZ = 1.18;
    cornerIndicators.userData.minimumHardwareClearance = 0.04;
    cornerIndicators.castShadow = false;
    cornerIndicators.receiveShadow = false;
    cornerIndicators.visible = rig.entity.id === this.selectedId;
    selectionIndicators.push(cornerIndicators);

    if (highDetail) {
      const azimuthScale = new THREE.Group();
      azimuthScale.name = 'commission-uplink-selected-azimuth-scale';
      azimuthScale.userData.selectionRole = 'restrained-bearing-readout';
      azimuthScale.userData.arcRadians = Math.PI * 0.42;
      root.add(azimuthScale);
      const arc = this.addMesh(
        azimuthScale,
        new THREE.TorusGeometry(0.61, 0.009, 5, 16, Math.PI * 0.42),
        effectMaterial,
        [0, 0.032, 0],
        [Math.PI / 2, 0, -Math.PI * 0.25],
        false,
      );
      arc.renderOrder = 12;
      this.addInstancedBeams(
        azimuthScale,
        effectMaterial,
        [
          { from: [0.39, 0.032, -0.46], to: [0.43, 0.032, -0.51], radius: 0.011 },
          { from: [0.43, 0.032, -0.51], to: [0.365, 0.032, -0.505], radius: 0.011 },
        ],
        6,
      );
      azimuthScale.visible = rig.entity.id === this.selectedId;
      selectionIndicators.push(azimuthScale);
    }
    rig.parts.uplinkSelectionIndicators = selectionIndicators;
  }

  /**
   * PASS 6 Commission Uplink.
   *
   * The authored hierarchy is intentionally compact and literal:
   *
   * terrain -> poured slab -> four anchored feet -> cast pedestal
   * -> azimuth bearing -> fork yoke -> trunnions -> reflector.
   *
   * Cargo, service power, and transmission conditioning are separately
   * mounted subordinate systems. No brace, hose, or conduit is allowed to
   * cross the exposed belt-to-vault cargo corridor.
   */
  private buildUplinkPass6Identity(rig: EntityRig): void {
    const { root } = rig;
    const highDetail = rig.quality === 'high';

    const paintedSteel = this.materials.uplinkPainted.clone();
    paintedSteel.name =
      'commission-uplink-pass7-aged-painted-structural-steel';
    paintedSteel.color.set('#a7b2ab');
    paintedSteel.emissive.set('#6b7971');
    paintedSteel.emissiveIntensity = 0.5;
    paintedSteel.roughness = 0.76;
    paintedSteel.metalness = 0.46;
    paintedSteel.normalScale.set(0.82, 0.82);
    paintedSteel.aoMapIntensity = 0.48;
    paintedSteel.userData.authoredSurface =
      'cinder-painted-steel-aged-v2-dark-industrial-panel-scale';
    paintedSteel.userData.authoredAsset =
      this.materials.uplinkPainted.userData.authoredAsset;
    paintedSteel.userData.authoredAssetHash =
      this.materials.uplinkPainted.userData.authoredAssetHash;

    const darkPaint = paintedSteel.clone();
    darkPaint.name = 'commission-uplink-pass7-dark-aged-service-paint';
    darkPaint.color.set('#7b8881');
    darkPaint.emissive.set('#5b6861');
    darkPaint.emissiveIntensity = 0.47;
    darkPaint.roughness = 0.94;
    darkPaint.metalness = 0.28;

    const castSteel = this.materials.titanium.clone();
    castSteel.name = 'commission-uplink-pass7-oiled-load-bearing-cast-steel';
    castSteel.color.set('#89958f');
    castSteel.emissive.set('#4a5750');
    castSteel.emissiveIntensity = 0.24;
    castSteel.roughness = 0.56;
    castSteel.metalness = 0.72;
    castSteel.normalScale.set(0.9, 0.9);
    castSteel.aoMapIntensity = 0.58;
    castSteel.userData.authoredSurface =
      'brushed-load-steel-with-weld-seams-oil-and-edge-rub';

    const rubbedSteel = this.materials.titaniumLight.clone();
    rubbedSteel.name = 'commission-uplink-pass7-rubbed-machined-joint-steel';
    rubbedSteel.color.set('#8d9892');
    rubbedSteel.emissive.set('#0b0f0d');
    rubbedSteel.emissiveIntensity = 0.012;
    rubbedSteel.roughness = 0.42;
    rubbedSteel.metalness = 0.9;

    const oxidizedSteel = this.materials.agedCopper.clone();
    oxidizedSteel.name = 'commission-uplink-pass7-localized-oxidized-welds';
    oxidizedSteel.color.set('#754a35');
    oxidizedSteel.emissive.set('#100705');
    oxidizedSteel.emissiveIntensity = 0.01;
    oxidizedSteel.roughness = 0.8;
    oxidizedSteel.metalness = 0.56;

    const concrete = this.materials.uplinkConcrete.clone();
    concrete.name = 'commission-uplink-pass7-drained-repaired-concrete';
    concrete.color.set('#797568');
    concrete.emissive.set('#0f0e0b');
    concrete.emissiveIntensity = 0.012;
    concrete.roughness = 0.97;
    concrete.metalness = 0.02;
    concrete.userData.authoredSurface =
      'separate-pours-spalled-edges-runoff-and-bearing-grime';

    const reflectorMaterial = paintedSteel.clone();
    reflectorMaterial.name =
      'commission-uplink-pass6-dark-reflector-seam-underlay';
    reflectorMaterial.map = null;
    reflectorMaterial.color.set('#71857b');
    reflectorMaterial.emissive.set('#17251e');
    reflectorMaterial.emissiveIntensity = 0.04;
    reflectorMaterial.roughness = 0.62;
    reflectorMaterial.metalness = 0.62;
    reflectorMaterial.side = THREE.DoubleSide;

    const cavityMaterial = new THREE.MeshStandardMaterial();
    cavityMaterial.name =
      'commission-uplink-pass6-readable-dark-cargo-cavity';
    cavityMaterial.color.set('#707c75');
    cavityMaterial.emissive.set('#4a5750');
    cavityMaterial.emissiveIntensity = 0.31;
    cavityMaterial.roughness = 0.97;
    cavityMaterial.metalness = 0.1;

    const serviceRubber = this.materials.rubber.clone();
    serviceRubber.name =
      'commission-uplink-pass6-aged-readable-service-rubber';
    serviceRubber.color.set('#4a5550');
    serviceRubber.emissive.set('#1e2823');
    serviceRubber.emissiveIntensity = 0.075;
    serviceRubber.roughness = 0.95;

    const carriageSteel = new THREE.MeshStandardMaterial({
      color: '#9ba7a0',
      emissive: '#202923',
      emissiveIntensity: 0.04,
      roughness: 0.54,
      metalness: 0.76,
    });
    carriageSteel.name =
      'commission-uplink-pass7-rubbed-bare-shuttle-steel';
    carriageSteel.normalMap = paintedSteel.normalMap;
    carriageSteel.roughnessMap = paintedSteel.roughnessMap;
    carriageSteel.aoMap = paintedSteel.aoMap;
    carriageSteel.normalScale.set(0.58, 0.58);
    carriageSteel.aoMapIntensity = 0.7;
    const serviceDeckPanel = new THREE.MeshStandardMaterial({
      color: '#808d85',
      emissive: '#46534d',
      emissiveIntensity: 0.25,
      roughness: 0.89,
      metalness: 0.32,
    });
    serviceDeckPanel.name =
      'commission-uplink-pass7-segmented-weathered-service-deck';
    serviceDeckPanel.normalMap = paintedSteel.normalMap;
    serviceDeckPanel.roughnessMap = paintedSteel.roughnessMap;
    serviceDeckPanel.aoMap = paintedSteel.aoMap;
    serviceDeckPanel.normalScale.set(0.62, 0.62);
    serviceDeckPanel.aoMapIntensity = 0.46;
    const serviceDeckPanelLight = serviceDeckPanel.clone();
    serviceDeckPanelLight.name =
      'commission-uplink-pass6-shadowless-repaired-service-deck';
    serviceDeckPanelLight.color.set('#96a39b');
    serviceDeckPanelLight.emissive.set('#505d56');
    serviceDeckPanelLight.emissiveIntensity = 0.25;
    serviceDeckPanelLight.roughness = 0.68;
    serviceDeckPanelLight.metalness = 0.52;
    const serviceDeckHatch = serviceDeckPanel.clone();
    serviceDeckHatch.name =
      'commission-uplink-pass6-bolted-midvalue-service-hatch';
    serviceDeckHatch.color.set('#707d75');
    serviceDeckHatch.emissive.set('#424f48');
    serviceDeckHatch.emissiveIntensity = 0.24;
    serviceDeckHatch.roughness = 0.82;
    serviceDeckHatch.metalness = 0.24;
    const districtWeedMaterial = new THREE.MeshStandardMaterial({
      color: '#697044',
      roughness: 0.96,
      metalness: 0,
    });
    districtWeedMaterial.name =
      'commission-uplink-pass6-drainage-joint-weed-material';

    const safetyPaint = this.materials.amber.clone();
    safetyPaint.name = 'commission-uplink-pass7-worn-safety-paint';
    safetyPaint.color.set('#d08c2f');
    safetyPaint.emissive.set('#3b1d08');
    safetyPaint.emissiveIntensity = 0.055;
    safetyPaint.roughness = 0.74;
    safetyPaint.metalness = 0.36;

    const signalMaterial = this.materials.signalTemplate.clone();
    signalMaterial.name = 'commission-uplink-hardware-status-material';
    signalMaterial.color.set('#7d9b91');
    signalMaterial.emissive.set('#2b685f');
    signalMaterial.emissiveIntensity = 0.055;
    signalMaterial.transparent = true;
    signalMaterial.opacity = 0.72;
    signalMaterial.depthWrite = false;
    rig.parts.uplinkSignalMaterial = signalMaterial;

    const linkMaterial = signalMaterial.clone();
    linkMaterial.name = 'commission-uplink-powered-feed-lock-material';
    linkMaterial.color.set('#b7fff4');
    linkMaterial.emissive.set('#35d7c3');
    linkMaterial.emissiveIntensity = 1.35;
    linkMaterial.opacity = 0.72;
    linkMaterial.side = THREE.DoubleSide;
    linkMaterial.depthTest = true;
    linkMaterial.depthWrite = false;
    rig.parts.uplinkLinkMaterial = linkMaterial;

    const effectMaterial = signalMaterial.clone();
    effectMaterial.name = 'commission-uplink-subordinate-selection-material';
    effectMaterial.color.set('#74847f');
    effectMaterial.emissive.set('#3c5d56');
    effectMaterial.emissiveIntensity = 0.025;
    effectMaterial.opacity = 0.16;
    effectMaterial.depthTest = true;
    effectMaterial.depthWrite = false;
    rig.parts.uplinkEffectMaterial = effectMaterial;

    const dockGuideMaterial = signalMaterial.clone();
    dockGuideMaterial.name =
      'commission-uplink-canonical-dock-guide-emissive-material';
    dockGuideMaterial.color.set('#b6fff3');
    dockGuideMaterial.emissive.set('#2bdcc7');
    dockGuideMaterial.emissiveIntensity = 1.65;
    dockGuideMaterial.opacity = 0.88;
    dockGuideMaterial.side = THREE.DoubleSide;
    dockGuideMaterial.depthTest = true;
    dockGuideMaterial.depthWrite = false;
    rig.parts.uplinkDockGuideMaterial = dockGuideMaterial;

    const dockBeaconMaterial = dockGuideMaterial.clone();
    dockBeaconMaterial.name =
      'commission-uplink-canonical-dock-beacon-emissive-material';
    dockBeaconMaterial.emissiveIntensity = 0.78;
    dockBeaconMaterial.opacity = 0.86;
    rig.parts.uplinkDockBeaconMaterial = dockBeaconMaterial;

    rig.ownedMaterials.push(
      paintedSteel,
      darkPaint,
      castSteel,
      rubbedSteel,
      oxidizedSteel,
      concrete,
      reflectorMaterial,
      cavityMaterial,
      serviceRubber,
      carriageSteel,
      serviceDeckPanel,
      serviceDeckPanelLight,
      serviceDeckHatch,
      districtWeedMaterial,
      safetyPaint,
      signalMaterial,
      linkMaterial,
      effectMaterial,
      dockGuideMaterial,
      dockBeaconMaterial,
    );

    // Broad but localized contact history sits beneath the slab and each
    // actual foot. The dark perimeter remains visible around all four edges.
    const groundWear = this.addMesh(
      root,
      new THREE.CircleGeometry(0.5, highDetail ? 32 : 20),
      this.materials.stain,
      [0, 0.003, -0.18],
      [-Math.PI / 2, 0, 0],
      false,
    );
    groundWear.name = 'commission-uplink-localized-ground-bearing-stain';
    groundWear.scale.set(3.25, 3.45, 1);
    groundWear.renderOrder = -2;
    groundWear.userData.localized = true;
    groundWear.userData.wearScope =
      'four-feet-slab-runoff-and-cargo-service-history';

    const foundation = this.addRoundedBox(
      root,
      [2.72, 0.2, 3.02],
      concrete,
      [0, 0.1, -0.18],
      [0, 0, 0],
      0.09,
    );
    foundation.name = 'commission-uplink-reinforced-foundation';
    foundation.userData.visualRole = 'load-bearing-reinforced-foundation';
    foundation.userData.construction =
      'six-drained-pours-over-four-machine-footings';

    // Six slightly varied pours keep the slab from reading as one pristine
    // pale polygon. Their gaps are real expansion joints, not surface noise.
    const pourMaterialA = concrete.clone();
    pourMaterialA.name = 'commission-uplink-pass7-old-concrete-pour';
    pourMaterialA.color.set('#6d695f');
    const pourMaterialB = concrete.clone();
    pourMaterialB.name = 'commission-uplink-pass7-repaired-concrete-pour';
    pourMaterialB.color.set('#8b8371');
    rig.ownedMaterials.push(pourMaterialA, pourMaterialB);
    const pourLayout = [
      [-0.69, -0.91, 1.24, 0.86, -0.008],
      [0.69, -0.91, 1.24, 0.86, 0.006],
      [-0.69, 0, 1.24, 0.82, 0.004],
      [0.69, 0, 1.24, 0.82, -0.006],
      [-0.69, 0.87, 1.24, 0.76, -0.005],
      [0.69, 0.87, 1.24, 0.76, 0.007],
    ] as const;
    for (const [index, [x, z, width, depth, yaw]] of (
      pourLayout.entries()
    )) {
      const pour = this.addRoundedBox(
        root,
        [width, 0.025, depth],
        index === 1 || index === 4 ? pourMaterialB : pourMaterialA,
        [x, 0.213, z - 0.18],
        [0, yaw, 0],
        0.035,
      );
      pour.name = `commission-uplink-foundation-pour-${index + 1}`;
      pour.castShadow = false;
      pour.receiveShadow = false;
    }
    const deckFastenerInstances: DetailInstance[] = [];
    for (const [index, [x, z, width, depth]] of (
      pourLayout.entries()
    )) {
      for (const [dx, dz] of [
        [-0.44, -0.3],
        [0.44, -0.3],
        [-0.44, 0.3],
        [0.44, 0.3],
      ] as const) {
        deckFastenerInstances.push({
          position: [
            x + dx,
            0.256,
            z - 0.18 + dz,
          ],
          scale: [0.024, 0.018, 0.024],
        });
      }
      const deckSkin = this.addRoundedBox(
        root,
        [width - 0.1, 0.018, depth - 0.08],
        index === 1 || index === 4
          ? serviceDeckPanelLight
          : serviceDeckPanel,
        [x, 0.239, z - 0.18],
        [0, 0, 0],
        0.018,
      );
      deckSkin.name =
        `commission-uplink-segmented-shadowless-service-deck-panel-${index + 1}`;
      deckSkin.castShadow = false;
      deckSkin.receiveShadow = false;
    }
    const deckFasteners = this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 0.82, 1, 8, 1),
      rubbedSteel,
      deckFastenerInstances,
      false,
    );
    deckFasteners.name =
      'commission-uplink-service-deck-four-fasteners-per-panel';
    deckFasteners.userData.fastenerCount = deckFastenerInstances.length;
    const serviceHatchLayout = [
      {
        x: -1.01,
        z: 0.72,
        width: 0.48,
        depth: 0.34,
        yaw: -0.04,
        kind: 'sealed',
      },
      {
        x: -1.04,
        z: -1.22,
        width: 0.44,
        depth: 0.32,
        yaw: 0.035,
        kind: 'grille',
      },
      {
        x: 1.08,
        z: 0.62,
        width: 0.34,
        depth: 0.46,
        yaw: -0.025,
        kind: 'grille',
      },
    ] as const;
    const serviceHatchBolts: DetailInstance[] = [];
    for (const [index, hatch] of serviceHatchLayout.entries()) {
      const hatchBody = this.addRoundedBox(
        root,
        [hatch.width, 0.028, hatch.depth],
        serviceDeckHatch,
        [hatch.x, 0.266, hatch.z],
        [0, hatch.yaw, 0],
        0.022,
      );
      hatchBody.name =
        `commission-uplink-midvalue-service-hatch-${index + 1}`;
      hatchBody.castShadow = false;
      hatchBody.receiveShadow = false;
      for (const [dx, dz] of [
        [-0.38, -0.34],
        [0.38, -0.34],
        [-0.38, 0.34],
        [0.38, 0.34],
      ] as const) {
        serviceHatchBolts.push({
          position: [
            hatch.x + dx * hatch.width,
            0.286,
            hatch.z + dz * hatch.depth,
          ],
          scale: [0.018, 0.014, 0.018],
        });
      }
      if (hatch.kind === 'grille') {
        const louverInstances = [-0.22, 0, 0.22].map((offset) => ({
          position: [
            hatch.x,
            0.286,
            hatch.z + offset * hatch.depth,
          ] as [number, number, number],
          scale: [
            hatch.width * 0.72,
            0.018,
            hatch.depth * 0.12,
          ] as [number, number, number],
          rotation: [0, hatch.yaw, 0] as [number, number, number],
        }));
        const louvers = this.addInstanceBatch(
          root,
          new THREE.BoxGeometry(1, 1, 1),
          castSteel,
          louverInstances,
          false,
        );
        louvers.name =
          `commission-uplink-service-hatch-${index + 1}-three-wide-louvers`;
        louvers.userData.louverCount = 3;
      } else {
        const recessedHandle = this.addRoundedBox(
          root,
          [hatch.width * 0.32, 0.025, hatch.depth * 0.16],
          rubbedSteel,
          [hatch.x, 0.286, hatch.z],
          [0, hatch.yaw, 0],
          0.009,
        );
        recessedHandle.name =
          'commission-uplink-sealed-service-hatch-recessed-handle';
        recessedHandle.castShadow = false;
        recessedHandle.receiveShadow = false;
      }
    }
    const serviceHatchFasteners = this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 0.82, 1, 8, 1),
      rubbedSteel,
      serviceHatchBolts,
      false,
    );
    serviceHatchFasteners.name =
      'commission-uplink-three-service-hatches-four-bolt-fasteners';
    serviceHatchFasteners.userData.fastenerCount =
      serviceHatchBolts.length;
    const slabJoints = this.addInstancedBeams(
      root,
      this.materials.carbonDark,
      [
        { from: [0, 0.229, -1.63], to: [0, 0.229, 1.27], radius: 0.014 },
        { from: [-1.28, 0.229, -0.64], to: [1.28, 0.229, -0.64], radius: 0.014 },
        { from: [-1.28, 0.229, 0.25], to: [1.28, 0.229, 0.25], radius: 0.014 },
      ],
      6,
    );
    slabJoints.name = 'commission-uplink-foundation-expansion-joints';
    slabJoints.userData.jointCount = 3;
    slabJoints.castShadow = false;

    const drain = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      oxidizedSteel,
      Array.from({ length: highDetail ? 8 : 5 }, (_, index) => ({
        position: [
          -1.17 + index * (highDetail ? 0.095 : 0.15),
          0.235,
          1.14,
        ] as [number, number, number],
        scale: [0.055, 0.018, 0.28] as [number, number, number],
      })),
      false,
    );
    drain.name = 'commission-uplink-foundation-copper-drainage-grate';
    drain.userData.groundIntegration =
      'slab-fall-to-visible-service-drain';
    const edgeGutter = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      oxidizedSteel,
      Array.from({ length: highDetail ? 10 : 6 }, (_, index) => ({
        position: [
          1.19,
          0.256,
          -1.28 + index * (highDetail ? 0.23 : 0.38),
        ] as [number, number, number],
        scale: [0.24, 0.018, 0.055] as [number, number, number],
      })),
      false,
    );
    edgeGutter.name =
      'commission-uplink-camera-edge-runoff-gutter-slots';
    edgeGutter.userData.groundIntegration =
      'right-foundation-edge-runoff-to-district-soil';
    const foundationEarthBond = this.addInstancedBeams(
      root,
      this.materials.copper,
      [
        { from: [0.97, 0.29, 0.86], to: [1.16, 0.18, 1.04], radius: 0.018 },
        { from: [1.16, 0.18, 1.04], to: [1.38, 0.05, 1.18], radius: 0.018 },
      ],
      8,
    );
    foundationEarthBond.name =
      'commission-uplink-visible-foundation-to-district-earth-braid';
    foundationEarthBond.castShadow = false;
    foundationEarthBond.receiveShadow = true;
    const drainageWeeds = this.addInstanceBatch(
      root,
      new THREE.ConeGeometry(1, 1, 5, 1),
      districtWeedMaterial,
      [
        [1.39, -1.23, 0.8],
        [1.43, -0.64, 1.05],
        [1.4, 0.1, 0.72],
        [1.44, 0.78, 0.92],
        [-1.39, 1.08, 0.68],
      ].map(([x, z, scale]) => ({
        position: [x ?? 0, 0.055, z ?? 0] as [number, number, number],
        scale: [
          0.045 * (scale ?? 1),
          0.11 * (scale ?? 1),
          0.045 * (scale ?? 1),
        ] as [number, number, number],
        rotation: [0.08, (x ?? 0) * 0.7, 0.14] as [
          number,
          number,
          number,
        ],
      })),
      false,
    );
    drainageWeeds.name =
      'commission-uplink-drainage-joint-restrained-weed-tufts';

    const spalls = this.addInstanceBatch(
      root,
      new THREE.TetrahedronGeometry(1, 0),
      oxidizedSteel,
      [
        { position: [-1.22, 0.236, -1.23], scale: [0.08, 0.018, 0.05] },
        { position: [1.16, 0.236, 0.84], scale: [0.07, 0.016, 0.06] },
        { position: [0.96, 0.236, -1.36], scale: [0.06, 0.014, 0.04] },
      ],
      false,
    );
    spalls.name = 'commission-uplink-foundation-exposed-spall-aggregate';

    // Four unmistakable feet, sole plates and bolt pairs establish contact.
    const footCenters = [
      [-0.98, -0.98],
      [-0.18, -0.98],
      [-0.98, 0.06],
      [-0.18, 0.06],
    ] as const;
    const footings: DetailInstance[] = [];
    const feet: DetailInstance[] = [];
    const anchorBolts: DetailInstance[] = [];
    for (const [x, z] of footCenters) {
      footings.push({
        position: [x, 0.255, z],
        scale: [0.42, 0.07, 0.42],
      });
      feet.push({
        position: [x, 0.34, z],
        scale: [0.26, 0.18, 0.26],
      });
      for (const boltX of [-0.14, 0.14]) {
        anchorBolts.push({
          position: [x + boltX, 0.305, z + 0.145],
          scale: [0.035, 0.035, 0.035],
        });
      }
    }
    const footingBatch = this.addInstanceBatch(
      root,
      new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
      rubbedSteel,
      footings,
    );
    footingBatch.name =
      'commission-uplink-four-cast-sole-plates';
    footingBatch.userData.loadPath = 'pedestal-to-concrete-pours';
    const footBatch = this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 0.86, 1, highDetail ? 12 : 8, 1),
      castSteel,
      feet,
    );
    footBatch.name = 'commission-uplink-cast-outrigger-load-footings';
    footBatch.userData.loadPath =
      'pedestal-through-four-visible-feet-into-slab';
    const boltBatch = this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 0.82, 1, 8, 1),
      rubbedSteel,
      anchorBolts,
    );
    boltBatch.name = 'commission-uplink-foundation-anchor-bolts';
    boltBatch.userData.loadPath = 'sole-plates-to-concrete';

    // The pedestal is a broad cast mass directly above the four feet.
    const plinth = this.addRoundedBox(
      root,
      [1.18, 0.3, 1.24],
      castSteel,
      [-0.58, 0.46, -0.46],
      [0, 0, 0],
      0.08,
    );
    plinth.name = 'commission-uplink-anchored-machinery-plinth';
    plinth.userData.visualRole = 'four-foot-anchored-azimuth-pedestal';
    plinth.userData.authoredSurface = castSteel.userData.authoredSurface;
    const plinthAccessPanels = this.addInstanceBatch(
      root,
      new RoundedBoxGeometry(1, 1, 1, 2, 0.06),
      darkPaint,
      [
        [-0.98, -0.91],
        [-0.18, -0.91],
        [-0.98, -0.01],
        [-0.18, -0.01],
      ].map(([x, z]) => ({
        position: [x ?? 0, 0.618, z ?? 0] as [number, number, number],
        scale: [0.19, 0.022, 0.2] as [number, number, number],
      })),
      false,
    );
    plinthAccessPanels.name =
      'commission-uplink-plinth-four-recessed-inspection-panels';
    plinthAccessPanels.userData.surfaceBreakup =
      'dark-insets-at-four-cast-plinth-corners';
    const plinthCrossBands = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      oxidizedSteel,
      [
        {
          position: [-0.58, 0.632, -0.91],
          scale: [0.94, 0.012, 0.025],
        },
        {
          position: [-0.58, 0.632, -0.01],
          scale: [0.94, 0.012, 0.025],
        },
        {
          position: [-0.98, 0.632, -0.46],
          scale: [0.025, 0.012, 0.94],
        },
        {
          position: [-0.18, 0.632, -0.46],
          scale: [0.025, 0.012, 0.94],
        },
      ],
      false,
    );
    plinthCrossBands.name =
      'commission-uplink-plinth-oxidized-cast-section-seams';
    const plinthPanelBolts = this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 0.82, 1, 8, 1),
      rubbedSteel,
      [
        [-1.08, -1.03],
        [-0.08, -1.03],
        [-1.08, 0.11],
        [-0.08, 0.11],
        [-1.08, -0.46],
        [-0.08, -0.46],
        [-0.58, -1.03],
        [-0.58, 0.11],
      ].map(([x, z]) => ({
        position: [x ?? 0, 0.647, z ?? 0] as [number, number, number],
        scale: [0.028, 0.022, 0.028] as [number, number, number],
      })),
      false,
    );
    plinthPanelBolts.name =
      'commission-uplink-plinth-restrained-perimeter-bolts';
    const pedestalUpper = this.addMesh(
      root,
      new THREE.CylinderGeometry(
        0.48,
        0.56,
        0.5,
        highDetail ? 14 : 9,
        1,
      ),
      castSteel,
      [-0.58, 0.77, -0.46],
    );
    pedestalUpper.name = 'commission-uplink-pass6-faceted-azimuth-pedestal';
    pedestalUpper.userData.loadPath = 'sole-plates-to-bearing-seat';
    const pedestalSeams = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      oxidizedSteel,
      [
        { position: [-0.58, 0.57, 0.086], scale: [0.72, 0.025, 0.018] },
        { position: [-0.58, 0.57, -1.006], scale: [0.72, 0.025, 0.018] },
        { position: [-1.126, 0.57, -0.46], scale: [0.018, 0.025, 0.72] },
        { position: [-0.034, 0.57, -0.46], scale: [0.018, 0.025, 0.72] },
      ],
      false,
    );
    pedestalSeams.name =
      'commission-uplink-pedestal-continuous-weld-seams';
    const pedestalFasteners = this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 0.82, 1, 8, 1),
      rubbedSteel,
      Array.from({ length: highDetail ? 12 : 8 }, (_, index) => {
        const count = highDetail ? 12 : 8;
        const angle = index * Math.PI * 2 / count;
        return {
          position: [
            -0.58 + Math.sin(angle) * 0.49,
            1.025,
            -0.46 + Math.cos(angle) * 0.49,
          ] as [number, number, number],
          scale: [0.027, 0.025, 0.027] as [number, number, number],
        };
      }),
      false,
    );
    pedestalFasteners.name =
      'commission-uplink-pedestal-bearing-fastener-rhythm';
    const bearingOilWear = this.addMesh(
      root,
      new THREE.RingGeometry(0.28, 0.46, highDetail ? 30 : 18),
      this.materials.stain,
      [-0.58, 1.087, -0.46],
      [-Math.PI / 2, 0, 0],
      false,
    );
    bearingOilWear.name =
      'commission-uplink-azimuth-bearing-localized-oil-wear-ring';
    bearingOilWear.renderOrder = 1;
    bearingOilWear.userData.wearScope =
      'only-under-machined-azimuth-turntable';

    const fixedBearing = new THREE.Group();
    fixedBearing.name = 'commission-uplink-fixed-azimuth-bearing';
    fixedBearing.position.set(-0.58, 1.02, -0.46);
    root.add(fixedBearing);
    this.addCylinder(
      fixedBearing,
      0.52,
      0.13,
      castSteel,
      [0, 0, 0],
      [0, 0, 0],
      highDetail ? 24 : 14,
    );
    this.addTorus(
      fixedBearing,
      0.5,
      0.034,
      rubbedSteel,
      [0, 0.07, 0],
      [Math.PI / 2, 0, 0],
    ).name = 'commission-uplink-azimuth-bearing-wear-race';
    this.addTorus(
      fixedBearing,
      0.59,
      0.045,
      paintedSteel,
      [0, 0.015, 0],
      [Math.PI / 2, 0, 0],
    ).name = 'commission-uplink-clear-outer-azimuth-load-ring';
    const raisedBearingCollar = this.addCylinder(
      fixedBearing,
      0.37,
      0.18,
      castSteel,
      [0, 0.15, 0],
      [0, 0, 0],
      highDetail ? 22 : 13,
    );
    raisedBearingCollar.name =
      'commission-uplink-raised-azimuth-bearing-load-collar';
    raisedBearingCollar.userData.loadPath =
      'fixed-pedestal-race-to-elevated-rotor-clear-of-cargo-lane';
    const azimuthRingWitnesses = this.addInstanceBatch(
      fixedBearing,
      new THREE.BoxGeometry(1, 1, 1),
      safetyPaint,
      Array.from({ length: highDetail ? 12 : 8 }, (_, index) => {
        const count = highDetail ? 12 : 8;
        const angle = index * Math.PI * 2 / count;
        return {
          position: [
            Math.sin(angle) * 0.59,
            0.03,
            Math.cos(angle) * 0.59,
          ] as [number, number, number],
          scale: [0.055, 0.025, 0.025] as [number, number, number],
          rotation: [0, angle, 0] as [number, number, number],
        };
      }),
      false,
    );
    azimuthRingWitnesses.name =
      'commission-uplink-azimuth-ring-restrained-safety-witnesses';

    const azimuthAssembly = new THREE.Group();
    azimuthAssembly.name = 'commission-uplink-azimuth-rotor-assembly';
    azimuthAssembly.position.set(-0.58, 1.2, -0.46);
    azimuthAssembly.scale.setScalar(1.05);
    azimuthAssembly.userData.mechanism = 'bearing-driven-azimuth';
    azimuthAssembly.userData.baseYaw = -0.52;
    azimuthAssembly.userData.presentationScale = 1.05;
    root.add(azimuthAssembly);
    rig.parts.uplinkAzimuthAssembly = azimuthAssembly;
    this.addCylinder(
      azimuthAssembly,
      0.46,
      0.12,
      rubbedSteel,
      [0, 0.03, 0],
      [0, 0, 0],
      highDetail ? 22 : 13,
    ).name = 'commission-uplink-azimuth-turntable';
    const azimuthGear = new THREE.Group();
    azimuthGear.name = 'commission-uplink-exposed-azimuth-ring-gear';
    azimuthGear.userData.wearScope = 'greased-bearing-only';
    azimuthAssembly.add(azimuthGear);
    this.addTorus(
      azimuthGear,
      0.49,
      0.028,
      safetyPaint,
      [0, 0.095, 0],
      [Math.PI / 2, 0, 0],
    );
    const toothCount = highDetail ? 20 : 12;
    const gearTeeth = this.addInstanceBatch(
      azimuthGear,
      new THREE.BoxGeometry(1, 1, 1),
      safetyPaint,
      Array.from({ length: toothCount }, (_, index) => {
        const angle = index * Math.PI * 2 / toothCount;
        return {
          position: [
            Math.sin(angle) * 0.52,
            0.095,
            Math.cos(angle) * 0.52,
          ] as [number, number, number],
          scale: [0.055, 0.035, 0.03] as [number, number, number],
          rotation: [0, angle, 0] as [number, number, number],
        };
      }),
    );
    gearTeeth.name = 'commission-uplink-azimuth-gear-teeth';
    rig.parts.uplinkAzimuthGear = azimuthGear;

    const forkYoke = new THREE.Group();
    forkYoke.name = 'commission-uplink-stout-fork-yoke';
    forkYoke.userData.loadPath =
      'turntable-crosshead-to-paired-elevation-trunnions';
    azimuthAssembly.add(forkYoke);
    this.addRoundedBox(
      forkYoke,
      [1.3, 0.16, 0.34],
      castSteel,
      [0, 0.18, 0],
      [0, 0, 0],
      0.05,
    ).name = 'commission-uplink-yoke-lower-crosshead';
    for (const x of [-0.55, 0.55]) {
      const arm = this.addRoundedBox(
        forkYoke,
        [0.18, 0.75, 0.28],
        paintedSteel,
        [x, 0.5, 0],
        [0, 0, 0],
        0.05,
      );
      arm.name = x < 0
        ? 'commission-uplink-yoke-port-load-arm'
        : 'commission-uplink-yoke-starboard-load-arm';
      this.addRoundedBox(
        forkYoke,
        [0.24, 0.18, 0.38],
        castSteel,
        [x, 0.78, 0],
        [0, 0, 0],
        0.04,
      ).name = x < 0
        ? 'commission-uplink-yoke-port-trunnion-box'
        : 'commission-uplink-yoke-starboard-trunnion-box';
    }
    const yokeGussets = this.addInstancedBeams(
      forkYoke,
      castSteel,
      [
        { from: [-0.55, 0.2, -0.13], to: [-0.55, 0.58, -0.13], radius: 0.045 },
        { from: [0.55, 0.2, -0.13], to: [0.55, 0.58, -0.13], radius: 0.045 },
      ],
      highDetail ? 10 : 7,
    );
    yokeGussets.name = 'commission-uplink-yoke-load-braces';

    const trunnions = new THREE.Group();
    trunnions.name = 'commission-uplink-elevation-trunnions';
    trunnions.userData.mechanism = 'paired-horizontal-pivot';
    forkYoke.add(trunnions);
    for (const x of [-0.66, 0.66]) {
      this.addCylinder(
        trunnions,
        0.13,
        0.2,
        rubbedSteel,
        [x, 0.79, 0],
        [0, 0, Math.PI / 2],
        highDetail ? 18 : 11,
      ).name = x < 0
        ? 'commission-uplink-port-trunnion-pin'
        : 'commission-uplink-starboard-trunnion-pin';
      this.addTorus(
        trunnions,
        0.13,
        0.022,
        oxidizedSteel,
        [x + Math.sign(x) * 0.11, 0.79, 0],
        [0, Math.PI / 2, 0],
      );
    }

    const elevationAssembly = new THREE.Group();
    elevationAssembly.name = 'commission-uplink-elevation-cradle';
    elevationAssembly.position.set(0, 0.82, 0);
    elevationAssembly.rotation.x = -0.3;
    elevationAssembly.userData.mechanism = 'trunnion-driven-elevation';
    elevationAssembly.userData.baseElevation = -0.3;
    azimuthAssembly.add(elevationAssembly);
    rig.parts.uplinkElevationAssembly = elevationAssembly;
    this.addRoundedBox(
      elevationAssembly,
      [0.2, 0.16, 0.58],
      castSteel,
      [0, -0.11, -0.5],
      [0, 0, 0],
      0.045,
    ).name =
      'commission-uplink-single-clear-reflector-counterweight-backbone';

    const reflector = this.addMesh(
      elevationAssembly,
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.02, 0.11),
          new THREE.Vector2(0.12, 0.09),
          new THREE.Vector2(0.28, 0.025),
          new THREE.Vector2(0.43, -0.08),
          new THREE.Vector2(0.52, -0.18),
        ],
        highDetail ? 36 : 22,
      ),
      reflectorMaterial,
      [0, 0, 0],
      [-Math.PI / 2, 0, 0],
    );
    reflector.name = 'commission-uplink-clean-parabolic-reflector';
    reflector.userData.opticalAxis = [0, 0, 1];
    reflector.userData.surfaceTreatment =
      'light-stepped-panels-over-dark-weathered-seams';
    const reflectorPanelLight = new THREE.MeshStandardMaterial({
      color: '#b8c4be',
      emissive: '#53675e',
      emissiveIntensity: 0.24,
      roughness: 0.78,
      metalness: 0.24,
      side: THREE.DoubleSide,
    });
    reflectorPanelLight.name =
      'commission-uplink-reflector-light-weathered-panel';
    const reflectorPanelMid = reflectorPanelLight.clone();
    reflectorPanelMid.name =
      'commission-uplink-reflector-mid-weathered-panel';
    reflectorPanelMid.color.set('#9eafa6');
    reflectorPanelMid.emissive.set('#465950');
    reflectorPanelMid.emissiveIntensity = 0.22;
    const reflectorPanelDark = reflectorPanelLight.clone();
    reflectorPanelDark.name =
      'commission-uplink-reflector-dark-weathered-panel';
    reflectorPanelDark.color.set('#879b90');
    reflectorPanelDark.emissive.set('#394c43');
    reflectorPanelDark.emissiveIntensity = 0.2;
    rig.ownedMaterials.push(
      reflectorPanelLight,
      reflectorPanelMid,
      reflectorPanelDark,
    );
    const reflectorPanelMaterials = [
      reflectorPanelLight,
      reflectorPanelMid,
      reflectorPanelDark,
    ] as const;
    const reflectorSectors = highDetail ? 8 : 6;
    const reflectorPanelGroup = new THREE.Group();
    reflectorPanelGroup.name =
      'commission-uplink-true-stepped-concave-segmented-reflector-face';
    reflectorPanelGroup.userData.segmentCount = reflectorSectors * 3;
    reflectorPanelGroup.userData.depthProfile = [
      { radius: 0.17, z: -0.06 },
      { radius: 0.34, z: 0.06 },
      { radius: 0.495, z: 0.2 },
    ];
    elevationAssembly.add(reflectorPanelGroup);
    const sectorArc = Math.PI * 2 / reflectorSectors;
    for (let index = 0; index < reflectorSectors; index += 1) {
      const start = index * sectorArc + 0.024;
      const length = sectorArc - 0.048;
      const material = reflectorPanelMaterials[
        index % reflectorPanelMaterials.length
      ]!;
      const innerPanel = this.addMesh(
        reflectorPanelGroup,
        new THREE.CircleGeometry(0.17, 5, start, length),
        material,
        [0, 0, -0.06],
        [0, 0, 0],
        false,
      );
      innerPanel.name =
        `commission-uplink-reflector-inner-sector-${index + 1}`;
      innerPanel.receiveShadow = false;
      const middlePanel = this.addMesh(
        reflectorPanelGroup,
        new THREE.RingGeometry(0.18, 0.34, 5, 1, start, length),
        reflectorPanelMaterials[(index + 1) % 3]!,
        [0, 0, 0.06],
        [0, 0, 0],
        false,
      );
      middlePanel.name =
        `commission-uplink-reflector-middle-sector-${index + 1}`;
      middlePanel.receiveShadow = false;
      const outerPanel = this.addMesh(
        reflectorPanelGroup,
        new THREE.RingGeometry(0.35, 0.495, 5, 1, start, length),
        reflectorPanelMaterials[(index + 2) % 3]!,
        [0, 0, 0.2],
        [0, 0, 0],
        false,
      );
      outerPanel.name =
        `commission-uplink-reflector-outer-sector-${index + 1}`;
      outerPanel.receiveShadow = false;
    }
    this.addTorus(
      elevationAssembly,
      0.52,
      0.024,
      castSteel,
      [0, 0, 0.23],
      [0, 0, 0],
    ).name = 'commission-uplink-reflector-reinforced-rim';
    const reflectorSeams = new THREE.Group();
    elevationAssembly.add(reflectorSeams);
    reflectorSeams.name = 'commission-uplink-reflector-rear-stiffeners';
    reflectorSeams.userData.faceRibCount = 0;
    reflectorSeams.userData.design =
      'clean-bowl-loads-through-one-central-backbone-not-radial-clutter';
    const rimFasteners = this.addInstanceBatch(
      elevationAssembly,
      new THREE.CylinderGeometry(1, 0.8, 1, 8, 1),
      oxidizedSteel,
      Array.from({ length: highDetail ? 14 : 8 }, (_, index) => {
        const count = highDetail ? 14 : 8;
        const angle = index * Math.PI * 2 / count;
        return {
          position: [
            Math.cos(angle) * 0.52,
            Math.sin(angle) * 0.52,
            0.235,
          ] as [number, number, number],
          scale: [0.019, 0.013, 0.019] as [number, number, number],
          rotation: [Math.PI / 2, 0, 0] as [number, number, number],
        };
      }),
      false,
    );
    rimFasteners.name =
      'commission-uplink-reflector-rim-weathered-fasteners';

    const feedStruts: DetailBeam[] = [
      {
        from: [-0.4, -0.24, 0.24],
        to: [-0.07, -0.03, 0.57],
        radius: 0.014,
      },
      {
        from: [0.4, -0.24, 0.24],
        to: [0.07, -0.03, 0.57],
        radius: 0.014,
      },
    ];
    const feedStrutBatch = this.addInstancedBeams(
      elevationAssembly,
      castSteel,
      feedStruts,
      highDetail ? 9 : 7,
    );
    feedStrutBatch.name =
      'commission-uplink-separated-twin-feed-support-struts';
    feedStrutBatch.userData.attachmentCount = 2;
    const feedHorn = this.addMesh(
      elevationAssembly,
      new THREE.CylinderGeometry(0.035, 0.085, 0.17, 16, 1, false),
      safetyPaint,
      [0, 0, 0.65],
      [Math.PI / 2, 0, 0],
    );
    feedHorn.name = 'commission-uplink-prime-focus-feed-horn';
    feedHorn.userData.aimsAtReflector = true;
    feedHorn.userData.opticalAxis = [0, 0, -1];
    this.addTorus(
      elevationAssembly,
      0.085,
      0.014,
      oxidizedSteel,
      [0, 0, 0.565],
      [0, 0, 0],
    ).name = 'commission-uplink-feed-horn-aperture-ring';
    const feedPulse = new THREE.Group();
    feedPulse.name = 'commission-uplink-physical-feed-lock-emitter';
    feedPulse.userData.physicalIntegration =
      'recessed-feed-throat-with-bolted-waveguide-flange';
    feedPulse.userData.maxSignalRadius = 0.075;
    feedPulse.userData.calibrationPathLength = 0.18;
    elevationAssembly.add(feedPulse);
    this.addMesh(
      feedPulse,
      new THREE.CircleGeometry(0.052, highDetail ? 16 : 10),
      linkMaterial,
      [0, 0, 0.562],
      [0, 0, 0],
      false,
    ).name = 'commission-uplink-feed-lock-emitter-disk';
    const feedEmissionCrown = this.addTorus(
      feedPulse,
      0.115,
      0.018,
      linkMaterial,
      [0, 0, 0.568],
      [0, 0, 0],
    );
    feedEmissionCrown.name =
      'commission-uplink-feed-strong-transmission-emission-crown';
    feedEmissionCrown.castShadow = false;
    feedEmissionCrown.receiveShadow = false;
    const calibrationPath = this.addCylinder(
      feedPulse,
      0.012,
      0.18,
      linkMaterial,
      [0, 0, 0.47],
      [Math.PI / 2, 0, 0],
      highDetail ? 10 : 7,
    );
    calibrationPath.name =
      'commission-uplink-feed-to-reflector-calibration-path';
    calibrationPath.userData.signalExtent =
      'within-feed-horn-and-reflector-volume';
    rig.parts.uplinkFeedPulse = feedPulse;

    const receiverCabinet = this.addRoundedBox(
      elevationAssembly,
      [0.28, 0.2, 0.18],
      castSteel,
      [0.59, -0.12, -0.28],
      [0, -0.08, 0],
      0.035,
    );
    receiverCabinet.name = 'commission-uplink-dish-receiver-cabinet';
    receiverCabinet.userData.attachedTo = 'elevation-cradle';
    const waveguide = this.addInstancedBeams(
      elevationAssembly,
      oxidizedSteel,
      [
        { from: [0.02, -0.03, 0.58], to: [0.18, -0.18, 0.34], radius: 0.015 },
        { from: [0.18, -0.18, 0.34], to: [0.38, -0.2, -0.05], radius: 0.015 },
        { from: [0.38, -0.2, -0.05], to: [0.59, -0.12, -0.28], radius: 0.015 },
      ],
      8,
    );
    waveguide.name = 'commission-uplink-rigid-copper-waveguide';
    waveguide.userData.path = 'feed-horn-to-receiver-cabinet';
    waveguide.userData.routing =
      'three-short-segment-run-confined-to-lower-starboard-quadrant';
    waveguide.userData.endpoints = [
      'feed-horn-bolted-flange',
      'receiver-cabinet-bulkhead',
    ];
    for (const [index, position] of (
      [
        [0.02, -0.03, 0.58],
        [0.59, -0.12, -0.28],
      ] as const
    ).entries()) {
      this.addTorus(
        elevationAssembly,
        0.039,
        0.009,
        rubbedSteel,
        [...position],
        [0.8, 0.2, -0.5],
      ).name =
        `commission-uplink-waveguide-mounted-joint-${index + 1}`;
    }
    this.addCylinder(
      elevationAssembly,
      0.12,
      0.3,
      rubbedSteel,
      [0, 0, -0.17],
      [0, 0, Math.PI / 2],
      highDetail ? 16 : 10,
    ).name = 'commission-uplink-counterweight-backbone-pivot-boss';
    const counterweight = this.addRoundedBox(
      elevationAssembly,
      [0.4, 0.28, 0.24],
      castSteel,
      [0, -0.28, -0.88],
      [0, 0, 0],
      0.05,
    );
    counterweight.name = 'commission-uplink-rear-elevation-counterweight';
    counterweight.userData.balanceRole =
      'reflector-feed-and-receiver-counterbalance';
    counterweight.userData.attachment =
      'integral-central-backbone-and-machined-pivot-boss';
    this.addRoundedBox(
      elevationAssembly,
      [0.31, 0.04, 0.25],
      safetyPaint,
      [0, -0.13, -0.88],
      [0, 0, 0],
      0.012,
    ).name =
      'commission-uplink-counterweight-worn-balance-identity-band';

    // A single elevation ram terminates in visible fork and cradle pins.
    const elevationRam = new THREE.Group();
    elevationRam.name = 'commission-uplink-elevation-linear-actuator';
    elevationRam.userData.mechanism =
      'pedestal-clevis-to-starboard-cradle-pin';
    forkYoke.add(elevationRam);
    this.addBeam(
      elevationRam,
      new THREE.Vector3(0.69, 0.24, -0.19),
      new THREE.Vector3(0.69, 0.57, -0.12),
      0.055,
      safetyPaint,
      highDetail ? 12 : 8,
    ).name = 'commission-uplink-elevation-ram-barrel';
    this.addBeam(
      elevationRam,
      new THREE.Vector3(0.69, 0.57, -0.12),
      new THREE.Vector3(0.66, 0.75, -0.02),
      0.028,
      rubbedSteel,
      highDetail ? 10 : 7,
    ).name = 'commission-uplink-elevation-ram-polished-rod';
    for (const [index, point] of (
      [
        [0.69, 0.24, -0.19],
        [0.66, 0.75, -0.02],
      ] as const
    ).entries()) {
      this.addCylinder(
        elevationRam,
        0.07,
        0.1,
        oxidizedSteel,
        [...point],
        [Math.PI / 2, 0, 0],
        highDetail ? 12 : 8,
      ).name =
        `commission-uplink-elevation-ram-clevis-pin-${index + 1}`;
    }

    // Separately mounted power and service modules stay below the dish and
    // outside the cargo corridor. Every conduit ends in a visible gland.
    const powerModule = new THREE.Group();
    powerModule.name =
      'commission-uplink-secondary-armored-power-conditioning-sponson';
    powerModule.position.set(-1.02, 0.28, -1.05);
    root.add(powerModule);
    const powerShell = this.addRoundedBox(
      powerModule,
      [0.52, 0.64, 0.62],
      paintedSteel,
      [0, 0.34, 0],
      [0, 0, 0],
      0.07,
    );
    powerShell.name =
      'commission-uplink-power-sponson-chipped-armor-shell';
    powerShell.userData.mount =
      'four-bolt-independent-foundation-sole-plate';
    const powerAccessPanel = this.addRoundedBox(
      powerModule,
      [0.4, 0.38, 0.04],
      darkPaint,
      [0, 0.37, 0.33],
      [0, 0, 0],
      0.025,
    );
    powerAccessPanel.name =
      'commission-uplink-power-module-access-panel';
    powerAccessPanel.castShadow = false;
    powerAccessPanel.receiveShadow = false;
    const powerLouvers = this.addInstanceBatch(
      powerModule,
      new THREE.BoxGeometry(1, 1, 1),
      oxidizedSteel,
      Array.from({ length: highDetail ? 6 : 4 }, (_, index) => ({
        position: [
          -0.16 + index * (highDetail ? 0.065 : 0.1),
          0.4,
          0.355,
        ] as [number, number, number],
        scale: [0.04, 0.24, 0.018] as [number, number, number],
        rotation: [0, 0, -0.1] as [number, number, number],
      })),
      false,
    );
    powerLouvers.name =
      'commission-uplink-power-sponson-deep-cooling-louvers';
    this.addCylinder(
      powerModule,
      0.13,
      0.48,
      oxidizedSteel,
      [0, 0.36, -0.04],
      [Math.PI / 2, 0, 0],
      highDetail ? 16 : 10,
    ).name = 'commission-uplink-power-conditioning-oil-cooled-drum';
    const powerFeet = this.addInstanceBatch(
      powerModule,
      new RoundedBoxGeometry(1, 1, 1, 2, 0.06),
      castSteel,
      [
        { position: [-0.19, 0.03, -0.22], scale: [0.16, 0.08, 0.16] },
        { position: [0.19, 0.03, -0.22], scale: [0.16, 0.08, 0.16] },
        { position: [-0.19, 0.03, 0.22], scale: [0.16, 0.08, 0.16] },
        { position: [0.19, 0.03, 0.22], scale: [0.16, 0.08, 0.16] },
      ],
    );
    powerFeet.name = 'commission-uplink-power-module-four-mounted-feet';

    const serviceCabinet = this.addRoundedBox(
      root,
      [0.5, 0.58, 0.45],
      paintedSteel,
      [-1.02, 0.54, 0.43],
      [0, 0, 0],
      0.06,
    );
    serviceCabinet.name = 'commission-uplink-dedicated-service-cabinet';
    serviceCabinet.userData.serviceScope =
      'azimuth-servo-elevation-drive-and-interlocks';
    const serviceDoor = this.addRoundedBox(
      root,
      [0.38, 0.42, 0.035],
      darkPaint,
      [-1.02, 0.55, 0.673],
      [0, 0, 0],
      0.022,
    );
    serviceDoor.name = 'commission-uplink-service-cabinet-door';
    serviceDoor.castShadow = false;
    serviceDoor.receiveShadow = false;
    this.addRoundedBox(
      root,
      [0.04, 0.16, 0.04],
      rubbedSteel,
      [-0.88, 0.55, 0.7],
      [0, 0, 0],
      0.01,
    ).name = 'commission-uplink-service-door-handle';
    const serviceConduit = this.addInstancedBeams(
      root,
      serviceRubber,
      [
        { from: [-1.02, 0.34, 0.18], to: [-1.02, 0.29, -0.04], radius: 0.022 },
        { from: [-1.02, 0.29, -0.04], to: [-0.85, 0.32, -0.28], radius: 0.022 },
        { from: [-0.85, 0.32, -0.28], to: [-0.76, 0.47, -0.34], radius: 0.02 },
      ],
      8,
    );
    serviceConduit.name = 'commission-uplink-service-cabinet-conduit';
    serviceConduit.userData.path =
      'cabinet-gland-to-pedestal-terminal-box';
    const serviceConduitClips = this.addInstanceBatch(
      root,
      new THREE.TorusGeometry(0.036, 0.009, 8, 24),
      oxidizedSteel,
      (
        [
        [-1.02, 0.34, 0.18],
        [-1.02, 0.29, -0.04],
        [-0.85, 0.32, -0.28],
        [-0.76, 0.47, -0.34],
        ] as const
      ).map((position) => ({
        position: [...position] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        rotation: [0.7, 0.1, 0.4] as [number, number, number],
      })),
    );
    serviceConduitClips.name =
      'commission-uplink-four-batched-service-conduit-clips';
    serviceConduitClips.userData.clipCount = 4;
    serviceConduitClips.castShadow = false;
    serviceConduitClips.receiveShadow = true;
    const serviceStep = this.addRoundedBox(
      root,
      [0.52, 0.07, 0.32],
      castSteel,
      [-1.02, 0.27, 0.82],
      [0, 0, 0],
      0.025,
    );
    serviceStep.name = 'commission-uplink-bolted-service-access-step';
    serviceStep.userData.serviceAccess =
      'cabinet-and-bearing-inspection-clearance';
    const serviceGuardrail = this.addInstancedBeams(
      root,
      castSteel,
      [
        { from: [-1.29, 0.27, 0.96], to: [-1.29, 0.72, 0.96], radius: 0.018 },
        { from: [-0.75, 0.27, 0.96], to: [-0.75, 0.72, 0.96], radius: 0.018 },
        { from: [-1.29, 0.72, 0.96], to: [-0.75, 0.72, 0.96], radius: 0.018 },
      ],
      8,
    );
    serviceGuardrail.name = 'commission-uplink-service-access-guardrail';
    serviceGuardrail.castShadow = false;
    serviceGuardrail.receiveShadow = true;

    // Cargo uses one legible right-hand force path: belt rollers, two recessed
    // wheel runs, a hollow carriage, then the armored vault. Cross-members are
    // kept below the payload silhouette so no stray bar can masquerade as
    // custody hardware.
    const custodyMaterial = signalMaterial.clone();
    custodyMaterial.name = 'commission-uplink-custody-interlock-material';
    custodyMaterial.color.set('#b48a48');
    custodyMaterial.emissive.set('#7a4a1d');
    custodyMaterial.emissiveIntensity = 0.12;
    custodyMaterial.opacity = 0.9;
    rig.ownedMaterials.push(custodyMaterial);
    rig.parts.uplinkCustodyMaterial = custodyMaterial;

    const cavityLightMaterial = custodyMaterial.clone();
    cavityLightMaterial.name =
      'commission-uplink-custody-cavity-worklight-material';
    cavityLightMaterial.color.set('#c9ae71');
    cavityLightMaterial.emissive.set('#8b5c2b');
    cavityLightMaterial.emissiveIntensity = 0.24;
    cavityLightMaterial.opacity = 0.78;
    rig.ownedMaterials.push(cavityLightMaterial);
    rig.parts.uplinkCavityLightMaterial = cavityLightMaterial;

    const carrierStatusMaterial = safetyPaint.clone();
    carrierStatusMaterial.name =
      'commission-uplink-carriage-phase-witness-material';
    carrierStatusMaterial.map = null;
    carrierStatusMaterial.emissive.set('#5a2f12');
    carrierStatusMaterial.emissiveIntensity = 0.08;
    rig.ownedMaterials.push(carrierStatusMaterial);
    rig.parts.uplinkCarrierStatusMaterial = carrierStatusMaterial;

    const cargoRoute = new THREE.Group();
    cargoRoute.name = 'commission-uplink-front-cargo-custody-route';
    cargoRoute.position.x = 0.47;
    cargoRoute.userData.route =
      'unobstructed-belt-contact-to-hollow-carriage-to-visible-vault';
    cargoRoute.userData.gridFacing = 'forward-z';
    cargoRoute.userData.custodySlots = 3;
    cargoRoute.userData.transmissionThreshold =
      'selected-commission-manifest-complete';
    root.add(cargoRoute);

    const unloadingBridge = new THREE.Group();
    unloadingBridge.name = 'commission-uplink-engineered-unloading-bridge';
    unloadingBridge.userData.bridgeExtent = [0.86, 0.78];
    cargoRoute.add(unloadingBridge);
    for (const x of [-0.3, 0.3]) {
      this.addRoundedBox(
        unloadingBridge,
        [0.1, 0.13, 0.78],
        castSteel,
        [x, 0.23, 0.9],
        [0, 0, 0],
        0.025,
      ).name = x < 0
        ? 'commission-uplink-dock-port-girder'
        : 'commission-uplink-dock-starboard-girder';
    }
    const bridgeCrossTies = this.addInstanceBatch(
      unloadingBridge,
      new THREE.BoxGeometry(1, 1, 1),
      oxidizedSteel,
      [0.67, 1.1].map((z) => ({
        position: [0, 0.235, z] as [number, number, number],
        scale: [0.69, 0.045, 0.065] as [number, number, number],
      })),
    );
    bridgeCrossTies.name = 'commission-uplink-unloading-bridge-cross-ties';
    bridgeCrossTies.userData.crossTieCount = 2;
    const dockRollers = this.addInstanceBatch(
      unloadingBridge,
      new THREE.CylinderGeometry(1, 1, 1, highDetail ? 14 : 9, 1),
      rubbedSteel,
      [0.7, 1.12]
        .slice(0, highDetail ? 2 : 1)
        .map((z) => ({
          position: [0, 0.285, z] as [number, number, number],
          scale: [0.048, 0.56, 0.048] as [number, number, number],
          rotation: [0, 0, Math.PI / 2] as [number, number, number],
        })),
      false,
    );
    dockRollers.name = 'commission-uplink-cargo-dock-transfer-rollers';
    dockRollers.userData.rollerCount = highDetail ? 2 : 1;
    const dockBearings = this.addInstanceBatch(
      unloadingBridge,
      new THREE.CylinderGeometry(1, 0.82, 1, 8, 1),
      oxidizedSteel,
      [0.7, 1.12]
        .slice(0, highDetail ? 2 : 1)
        .flatMap((z) => [-0.27, 0.27].map((x) => ({
          position: [x, 0.285, z] as [number, number, number],
          scale: [0.065, 0.034, 0.065] as [number, number, number],
          rotation: [0, 0, Math.PI / 2] as [number, number, number],
        }))),
      false,
    );
    dockBearings.name =
      'commission-uplink-cargo-dock-roller-bearing-caps';
    dockBearings.userData.bearingCount = highDetail ? 4 : 2;
    const beltContact = this.addCylinder(
      unloadingBridge,
      0.055,
      0.66,
      carriageSteel,
      [0, 0.3, 1.24],
      [0, 0, Math.PI / 2],
      highDetail ? 14 : 9,
    );
    beltContact.name = 'commission-uplink-belt-interface-contact';
    beltContact.userData.endpoint =
      'real-eastbound-dock-belt-to-exposed-capture-rollers';
    const beltContactLamp = this.addRoundedBox(
      unloadingBridge,
      [0.11, 0.045, 0.075],
      carrierStatusMaterial,
      [0.25, 0.35, 1.24],
      [0, 0, 0],
      0.012,
    );
    beltContactLamp.name =
      'commission-uplink-belt-contact-local-lamp-housing';
    beltContactLamp.castShadow = false;
    beltContactLamp.receiveShadow = false;

    // A permanent, physical landing guide makes the one authoritative input
    // tile readable before a belt exists. The guide is centered on the same
    // rear -1.5 / right +0.5 reservation used by gameplay, while its luminous
    // rails and bollards stay outside the belt/item lane. Ground chevrons sit
    // below a connected belt so they cannot paint over moving cargo.
    const renderedUplinkPlanScale = ENTITY_FOOTPRINTS.storage[0] * 0.82;
    const dockGuide = new THREE.Group();
    dockGuide.name = 'commission-uplink-canonical-dock-landing-guide';
    dockGuide.position.set(
      0.5 / renderedUplinkPlanScale,
      0,
      1.5 / renderedUplinkPlanScale,
    );
    dockGuide.userData.canonicalOffset = {
      forward: -1.5,
      right: 0.5,
    };
    dockGuide.userData.gridFlowLocal = 'negative-z-toward-uplink';
    dockGuide.userData.requiredBeltDirection =
      'matches-uplink-facing-direction';
    dockGuide.userData.visualState = 'awaiting-canonical-dock-belt';
    dockGuide.userData.connected = false;
    dockGuide.userData.clearCargoLane = {
      luminousEdgesOutsideWorldHalfWidth: 0.54,
      chevronsBelowBeltSurface: true,
      overheadGeometry:
        'raised-guidance-only-while-unconnected-hidden-on-belt-lock',
    };
    root.add(dockGuide);

    const dockLandingPlate = this.addRoundedBox(
      dockGuide,
      [0.58, 0.025, 0.58],
      darkPaint,
      [0, 0.025, 0],
      [0, 0, 0],
      0.045,
    );
    dockLandingPlate.name =
      'commission-uplink-canonical-dock-recessed-landing-plate';
    dockLandingPlate.userData.visibility =
      'dark-contrast-bed-when-empty-authoritative-belt-covers-when-connected';
    dockLandingPlate.castShadow = false;
    dockLandingPlate.receiveShadow = true;

    const dockEdgeStrips = this.addInstancedBeams(
      dockGuide,
      dockGuideMaterial,
      [
        { from: [-0.34, 0.052, -0.35], to: [-0.34, 0.052, 0.37], radius: 0.026 },
        { from: [0.34, 0.052, -0.35], to: [0.34, 0.052, 0.37], radius: 0.026 },
        { from: [-0.34, 0.052, 0.37], to: [0.34, 0.052, 0.37], radius: 0.026 },
      ],
      highDetail ? 10 : 7,
    );
    dockEdgeStrips.name =
      'commission-uplink-canonical-dock-luminous-edge-strips';
    dockEdgeStrips.userData.worldLaneClearance =
      'both-long-edges-outside-one-cell-belt-cargo-envelope';
    dockEdgeStrips.castShadow = false;
    dockEdgeStrips.receiveShadow = false;

    const dockChevrons = this.addInstancedBeams(
      dockGuide,
      dockGuideMaterial,
      [-0.37, 0.37].flatMap((x) => [-0.13, 0.12].flatMap((z) => [
        {
          from: [x - 0.075, 0.058, z + 0.1] as [number, number, number],
          to: [x, 0.058, z - 0.1] as [number, number, number],
          radius: 0.024,
        },
        {
          from: [x + 0.075, 0.058, z + 0.1] as [number, number, number],
          to: [x, 0.058, z - 0.1] as [number, number, number],
          radius: 0.024,
        },
      ])),
      highDetail ? 10 : 7,
    );
    dockChevrons.name =
      'commission-uplink-canonical-dock-inbound-direction-chevrons';
    dockChevrons.userData.chevronCount = 4;
    dockChevrons.userData.direction = 'negative-local-z-into-cargo-bridge';
    dockChevrons.userData.occlusionPolicy =
      'paired-outside-both-belt-edges-never-over-authoritative-cargo';
    dockChevrons.castShadow = false;
    dockChevrons.receiveShadow = false;

    const dockHoverChevrons = this.addInstancedBeams(
      dockGuide,
      dockGuideMaterial,
      [-0.12, 0.15].flatMap((z) => [
        {
          from: [-0.22, 0.46, z + 0.12] as [number, number, number],
          to: [0, 0.46, z - 0.12] as [number, number, number],
          radius: 0.032,
        },
        {
          from: [0.22, 0.46, z + 0.12] as [number, number, number],
          to: [0, 0.46, z - 0.12] as [number, number, number],
          radius: 0.032,
        },
      ]),
      highDetail ? 12 : 8,
    );
    dockHoverChevrons.name =
      'commission-uplink-canonical-dock-raised-holographic-chevrons';
    dockHoverChevrons.userData.chevronCount = 2;
    dockHoverChevrons.userData.direction =
      'negative-local-z-into-cargo-bridge';
    dockHoverChevrons.userData.projectionSource =
      'paired-canonical-dock-beacon-bollards';
    dockHoverChevrons.userData.cargoOcclusionPolicy =
      'visible-only-unconnected-hidden-immediately-on-exact-belt-lock';
    dockHoverChevrons.castShadow = false;
    dockHoverChevrons.receiveShadow = false;
    rig.parts.uplinkDockHoverChevrons = dockHoverChevrons;

    for (const [index, x] of [-0.39, 0.39].entries()) {
      const side = index === 0 ? 'port' : 'starboard';
      const bollard = new THREE.Group();
      bollard.name =
        `commission-uplink-canonical-dock-${side}-beacon-bollard`;
      bollard.position.set(x, 0, 0.3);
      bollard.userData.cargoLanePosition = 'outside-one-cell-belt-envelope';
      dockGuide.add(bollard);
      const base = this.addCylinder(
        bollard,
        0.095,
        0.16,
        oxidizedSteel,
        [0, 0.085, 0],
        [0, 0, 0],
        highDetail ? 12 : 8,
      );
      base.name =
        `commission-uplink-canonical-dock-${side}-bollard-base`;
      const guard = this.addTorus(
        bollard,
        0.1,
        0.018,
        rubbedSteel,
        [0, 0.155, 0],
        [Math.PI / 2, 0, 0],
      );
      guard.name =
        `commission-uplink-canonical-dock-${side}-beacon-guard-ring`;
      const luminousCap = this.addCylinder(
        bollard,
        0.072,
        0.085,
        dockBeaconMaterial,
        [0, 0.205, 0],
        [0, 0, 0],
        highDetail ? 14 : 9,
      );
      luminousCap.name =
        `commission-uplink-canonical-dock-${side}-luminous-beacon-cap`;
      luminousCap.castShadow = false;
      luminousCap.receiveShadow = false;
      const crown = this.addMesh(
        bollard,
        new THREE.OctahedronGeometry(0.082, 0),
        dockBeaconMaterial,
        [0, 0.295, 0],
        [0, Math.PI / 4, 0],
        false,
      );
      crown.name =
        `commission-uplink-canonical-dock-${side}-directional-beacon-crown`;
      crown.castShadow = false;
      crown.receiveShadow = false;
    }

    const dockBeaconLight = new THREE.PointLight(
      '#39e5cf',
      0.8,
      1.65,
      2,
    );
    dockBeaconLight.name =
      'commission-uplink-canonical-dock-contained-point-light';
    dockBeaconLight.position.set(0, 0.28, 0.32);
    dockBeaconLight.castShadow = false;
    dockBeaconLight.userData.containment = {
      distance: 1.65,
      decay: 2,
      role: 'local-dock-ground-and-bollard-separation-only',
    };
    dockGuide.add(dockBeaconLight);
    rig.parts.uplinkDockGuide = dockGuide;
    rig.parts.uplinkDockBeaconLight = dockBeaconLight;

    const transferRail = new THREE.Group();
    transferRail.name = 'commission-uplink-exposed-load-bearing-transfer-rail';
    transferRail.userData.forcePath =
      'dock-girders-through-twin-rails-and-cross-ties-to-vault-stop';
    cargoRoute.add(transferRail);
    for (const x of [-0.31, 0.31]) {
      this.addRoundedBox(
        transferRail,
        [0.095, 0.12, 2.46],
        castSteel,
        [x, 0.25, -0.03],
        [0, 0, 0],
        0.022,
      ).name = x < 0
        ? 'commission-uplink-port-transfer-rail'
        : 'commission-uplink-starboard-transfer-rail';
      this.addRoundedBox(
        transferRail,
        [0.045, 0.022, 2.34],
        rubbedSteel,
        [x, 0.325, -0.03],
        [0, 0, 0],
        0.01,
      ).name = x < 0
        ? 'commission-uplink-port-polished-wheel-run'
        : 'commission-uplink-starboard-polished-wheel-run';
    }
    const tieZ = [0.68, -0.72];
    const railCrossTies = this.addInstanceBatch(
      transferRail,
      new THREE.BoxGeometry(1, 1, 1),
      oxidizedSteel,
      tieZ.map((z) => ({
        position: [0, 0.215, z] as [number, number, number],
        scale: [0.7, 0.05, 0.09] as [number, number, number],
      })),
      false,
    );
    railCrossTies.name =
      'commission-uplink-transfer-rail-supported-cross-ties';
    railCrossTies.userData.crossTieCount = tieZ.length;
    const visibleRailRollerZ = highDetail
      ? [0.52, -0.82]
      : [-0.45];
    const railRollers = this.addInstanceBatch(
      transferRail,
      new THREE.CylinderGeometry(1, 1, 1, highDetail ? 12 : 8, 1),
      carriageSteel,
      visibleRailRollerZ.map((z) => ({
        position: [0, 0.335, z] as [number, number, number],
        scale: [0.036, 0.5, 0.036] as [number, number, number],
        rotation: [0, 0, Math.PI / 2] as [number, number, number],
      })),
      false,
    );
    railRollers.name = 'commission-uplink-exposed-transfer-roller-train';
    railRollers.userData.rollerCount = visibleRailRollerZ.length;
    const railBearings = this.addInstanceBatch(
      transferRail,
      new THREE.CylinderGeometry(1, 0.82, 1, 8, 1),
      oxidizedSteel,
      visibleRailRollerZ
        .flatMap((z) => [-0.29, 0.29].map((x) => ({
          position: [x, 0.335, z] as [number, number, number],
          scale: [0.055, 0.03, 0.055] as [number, number, number],
          rotation: [0, 0, Math.PI / 2] as [number, number, number],
        }))),
      false,
    );
    railBearings.name =
      'commission-uplink-exposed-transfer-roller-bearing-caps';
    railBearings.userData.bearingCount = visibleRailRollerZ.length * 2;
    const shuttleRack = this.addRoundedBox(
      transferRail,
      [0.08, 0.055, 2.22],
      castSteel,
      [0.48, 0.35, -0.06],
      [0, 0, 0],
      0.014,
    );
    shuttleRack.name =
      'commission-uplink-visible-side-mounted-shuttle-drive-rack';
    shuttleRack.userData.forcePath =
      'side-actuator-pinion-through-rack-to-carriage-clevis';
    const shuttleRackTeeth = this.addInstanceBatch(
      transferRail,
      new THREE.BoxGeometry(1, 1, 1),
      safetyPaint,
      Array.from({ length: highDetail ? 5 : 4 }, (_, index) => {
        const count = highDetail ? 5 : 4;
        return {
          position: [
            0.48,
            0.385,
            0.98 - index * (2.08 / (count - 1)),
          ] as [number, number, number],
          scale: [0.18, 0.045, 0.1] as [number, number, number],
        };
      }),
      false,
    );
    shuttleRackTeeth.name =
      'commission-uplink-visible-shuttle-rack-drive-teeth';
    const shuttlePinion = this.addTorus(
      transferRail,
      0.13,
      0.028,
      safetyPaint,
      [0.48, 0.42, -1.18],
      [0, Math.PI / 2, 0],
    );
    shuttlePinion.name =
      'commission-uplink-actuator-to-shuttle-rack-pinion';
    shuttlePinion.userData.drive =
      'side-mounted-motor-to-rack-to-four-wheel-shuttle';
    transferRail.userData.shuttlePinion = shuttlePinion;
    rig.parts.uplinkTransferRail = transferRail;
    const protectedTravelPath = this.addInstancedBeams(
      transferRail,
      paintedSteel,
      [
        { from: [-0.46, 0.25, -0.88], to: [-0.46, 0.48, -0.88], radius: 0.032 },
        { from: [0.46, 0.25, -0.88], to: [0.46, 0.48, -0.88], radius: 0.032 },
      ],
      highDetail ? 10 : 7,
    );
    protectedTravelPath.name =
      'commission-uplink-paired-custody-entry-positive-stops';
    protectedTravelPath.userData.protection =
      'two-large-entry-stops-leave-rails-rack-wheels-and-payload-visible';

    // The chamber is a broad retained volume at the visible end of the rails.
    const custodyChamber = new THREE.Group();
    custodyChamber.name =
      'commission-uplink-physical-locking-custody-receiver-chamber';
    custodyChamber.userData.receiverState = 'open-empty';
    custodyChamber.userData.forcePath =
      'rail-stop-to-vault-frame-to-sliding-doors-and-crossbar';
    cargoRoute.add(custodyChamber);
    const chamberInterior = new THREE.Group();
    chamberInterior.name =
      'commission-uplink-custody-chamber-lifted-midtone-interior';
    chamberInterior.userData.cutaway =
      'open-roof-and-wide-front-window-preserve-retained-item-silhouette';
    custodyChamber.add(chamberInterior);
    const chamberFloorPan = this.addRoundedBox(
      chamberInterior,
      [1.28, 0.12, 0.74],
      cavityMaterial,
      [0, 0.35, -1.08],
      [0, 0, 0],
      0.025,
    );
    chamberFloorPan.name =
      'commission-uplink-custody-chamber-midtone-floor-pan';
    chamberFloorPan.receiveShadow = false;
    for (const [index, x] of [-0.38, 0, 0.38].entries()) {
      const floorSkin = this.addRoundedBox(
        chamberInterior,
        [0.3, 0.026, 0.65],
        index === 1 ? paintedSteel : darkPaint,
        [x, 0.417, -1.08],
        [0, 0, 0],
        0.012,
      );
      floorSkin.name =
        `commission-uplink-custody-floor-service-skin-${index + 1}`;
      floorSkin.castShadow = false;
      floorSkin.receiveShadow = false;
    }
    const chamberRearBulkhead = this.addRoundedBox(
      chamberInterior,
      [1.28, 0.64, 0.12],
      serviceDeckPanel,
      [0, 0.66, -1.43],
      [0, 0, 0],
      0.025,
    );
    chamberRearBulkhead.name =
      'commission-uplink-custody-chamber-midtone-rear-bulkhead';
    chamberRearBulkhead.receiveShadow = false;
    const chamberRearPanel = this.addRoundedBox(
      chamberInterior,
      [0.82, 0.45, 0.035],
      cavityMaterial,
      [0, 0.66, -1.36],
      [0, 0, 0],
      0.018,
    );
    chamberRearPanel.name =
      'commission-uplink-custody-rear-segmented-load-stop-panel';
    chamberRearPanel.receiveShadow = false;
    const loadStopStripes = this.addInstanceBatch(
      chamberInterior,
      new THREE.BoxGeometry(1, 1, 1),
      safetyPaint,
      [-0.31, -0.16, 0, 0.16, 0.31].map((x, index) => ({
        position: [x, 0.66, -1.338] as [number, number, number],
        scale: [0.07, 0.34, 0.018] as [number, number, number],
        rotation: [0, 0, index % 2 === 0 ? 0.42 : -0.42] as [
          number,
          number,
          number,
        ],
      })),
      false,
    );
    loadStopStripes.name =
      'commission-uplink-custody-rear-worn-hazard-load-stop-stripes';
    for (const x of [-0.62, 0.62]) {
      const loadWall = this.addRoundedBox(
        chamberInterior,
        [0.12, 0.64, 0.76],
        serviceDeckPanel,
        [x, 0.66, -1.08],
        [0, 0, 0],
        0.03,
      );
      loadWall.receiveShadow = false;
      loadWall.name = x < 0
        ? 'commission-uplink-vault-port-side-load-wall'
        : 'commission-uplink-vault-starboard-side-load-wall';
    }
    const chamberWorklights = this.addInstanceBatch(
      chamberInterior,
      new THREE.BoxGeometry(1, 1, 1),
      cavityLightMaterial,
      [
        { position: [-0.28, 0.88, -1.365], scale: [0.14, 0.035, 0.02] },
        { position: [0.28, 0.88, -1.365], scale: [0.14, 0.035, 0.02] },
      ],
      false,
    );
    chamberWorklights.name =
      'commission-uplink-custody-chamber-recessed-worklights';
    chamberWorklights.userData.worklightCount = 2;
    const chamberLoadFrame = this.addInstancedBeams(
      custodyChamber,
      castSteel,
      [
        { from: [-0.7, 0.25, -0.68], to: [-0.7, 1.02, -0.68], radius: 0.052 },
        { from: [0.7, 0.25, -0.68], to: [0.7, 1.02, -0.68], radius: 0.052 },
        { from: [-0.7, 0.25, -1.5], to: [-0.7, 1.02, -1.5], radius: 0.052 },
        { from: [0.7, 0.25, -1.5], to: [0.7, 1.02, -1.5], radius: 0.052 },
        { from: [-0.7, 1.02, -0.68], to: [0.7, 1.02, -0.68], radius: 0.052 },
        { from: [-0.7, 1.02, -1.5], to: [0.7, 1.02, -1.5], radius: 0.052 },
      ],
      highDetail ? 10 : 7,
    );
    chamberLoadFrame.name = 'commission-uplink-custody-chamber-load-frame';
    for (const [index, z] of [-0.68, -1.48].entries()) {
      const retentionHoop = this.addTorus(
        custodyChamber,
        0.64,
        0.045,
        index === 0 ? castSteel : paintedSteel,
        [0, 0.68, z],
        [0, 0, 0],
      );
      retentionHoop.name =
        `commission-uplink-custody-circular-load-hoop-${index + 1}`;
      retentionHoop.userData.structuralRole =
        'circular-pressure-frame-bounds-cavity-without-rectangular-black-mass';
    }

    const inspectionGlassMaterial = signalMaterial.clone();
    inspectionGlassMaterial.name =
      'commission-uplink-dark-custody-inspection-glass';
    inspectionGlassMaterial.color.set('#7da59c');
    inspectionGlassMaterial.emissive.set('#244d45');
    inspectionGlassMaterial.emissiveIntensity = 0.12;
    inspectionGlassMaterial.transparent = true;
    inspectionGlassMaterial.opacity = 0.5;
    inspectionGlassMaterial.depthWrite = false;
    inspectionGlassMaterial.side = THREE.DoubleSide;
    rig.ownedMaterials.push(inspectionGlassMaterial);

    const custodyDoors: [THREE.Group, THREE.Group] = [
      new THREE.Group(),
      new THREE.Group(),
    ];
    for (const [index, sign] of [-1, 1].entries()) {
      const door = custodyDoors[index]!;
      door.name = `commission-uplink-custody-sliding-door-${index + 1}`;
      door.position.set(sign * 1.04, 0.66, -0.66);
      door.userData.side = sign;
      door.userData.openX = sign * 1.04;
      door.userData.closedX = sign * 0.325;
      door.userData.travel = 0.715;
      custodyChamber.add(door);
      const armoredLeaf = this.addRoundedBox(
        door,
        [0.65, 0.7, 0.14],
        serviceDeckPanelLight,
        [0, 0, -0.006],
        [0, 0, 0],
        0.032,
      );
      armoredLeaf.receiveShadow = false;
      armoredLeaf.name =
        `commission-uplink-custody-door-${index + 1}-opaque-armored-leaf`;
      armoredLeaf.userData.closedRead =
        'solid-overlapping-armor-with-narrow-witness-slit';
      const doorLoadFrame = this.addInstanceBatch(
        door,
        new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
        darkPaint,
        (
          [
          [-0.3, 0, 0.1, 0.76],
          [0.3, 0, 0.1, 0.76],
          [0, -0.33, 0.56, 0.1],
          [0, 0.33, 0.56, 0.1],
          ] as const
        ).map(([x, y, width, height]) => ({
          position: [x, y, 0] as [number, number, number],
          scale: [width, height, 0.1] as [number, number, number],
        })),
      );
      doorLoadFrame.name =
        `commission-uplink-custody-door-${index + 1}-four-member-load-frame`;
      doorLoadFrame.userData.memberCount = 4;
      const window = this.addRoundedBox(
        door,
        [0.3, 0.06, 0.024],
        inspectionGlassMaterial,
        [0, 0.13, 0.065],
        [0, 0, 0],
        0.012,
      );
      window.name =
        `commission-uplink-custody-door-narrow-armored-witness-slit-${index + 1}`;
      window.castShadow = false;
      window.receiveShadow = false;
      window.userData.retainedPayloadVisibleThroughWindow = false;
      this.addRoundedBox(
        door,
        [0.44, 0.055, 0.145],
        custodyMaterial,
        [0, 0.25, 0.018],
        [0, 0, 0],
        0.01,
      ).name =
        `commission-uplink-custody-door-status-bar-${index + 1}`;
      this.addRoundedBox(
        door,
        [0.16, 0.28, 0.18],
        rubbedSteel,
        [-sign * 0.25, 0, 0.095],
        [0, 0, 0],
        0.022,
      ).name =
        `commission-uplink-custody-door-centerline-deadbolt-${index + 1}`;
      const doorFasteners = this.addInstanceBatch(
        door,
        new THREE.CylinderGeometry(1, 0.8, 1, 8, 1),
        oxidizedSteel,
        [
          [-0.28, -0.31],
          [0.28, -0.31],
          [-0.28, 0.31],
          [0.28, 0.31],
        ].map(([x, y]) => ({
          position: [x ?? 0, y ?? 0, 0.06] as [number, number, number],
          scale: [0.025, 0.018, 0.025] as [number, number, number],
          rotation: [Math.PI / 2, 0, 0] as [number, number, number],
        })),
        false,
      );
      doorFasteners.name =
        `commission-uplink-custody-door-fasteners-${index + 1}`;
    }
    rig.parts.uplinkCustodyDoors = custodyDoors;

    const custodyPressureMaterial = custodyMaterial.clone();
    custodyPressureMaterial.name =
      'commission-uplink-vault-pressure-and-seal-material';
    custodyPressureMaterial.color.set('#ba8742');
    custodyPressureMaterial.emissive.set('#703b18');
    custodyPressureMaterial.emissiveIntensity = 0.1;
    rig.ownedMaterials.push(custodyPressureMaterial);
    rig.parts.uplinkCustodyPressureMaterial = custodyPressureMaterial;

    const custodyVaultContents = new THREE.Group();
    custodyVaultContents.name =
      'commission-uplink-visible-secured-custody-pressure-capsule';
    custodyVaultContents.position.set(0, 0.43, -1.08);
    custodyVaultContents.visible = false;
    custodyChamber.add(custodyVaultContents);
    for (const z of [-0.28, 0.28]) {
      this.addTorus(
        custodyVaultContents,
        0.43,
        0.025,
        oxidizedSteel,
        [0, 0.24, z],
        [0, 0, 0],
      ).name = z < 0
        ? 'commission-uplink-vault-rear-retention-hoop'
        : 'commission-uplink-vault-front-retention-hoop';
    }
    this.addRoundedBox(
      custodyVaultContents,
      [0.74, 0.08, 0.62],
      castSteel,
      [0, 0.04, 0],
      [0, 0, 0],
      0.018,
    ).name = 'commission-uplink-vault-retained-volume-saddle';
    rig.parts.uplinkCustodyVaultContents = custodyVaultContents;

    const custodySeal = new THREE.Group();
    custodySeal.name = 'commission-uplink-hinged-armored-custody-seal';
    custodySeal.position.set(0, 0.9, -1.5);
    custodySeal.rotation.x = -1.12;
    custodySeal.userData.openRotationX = -1.12;
    custodySeal.userData.closedRotationX = 0;
    custodySeal.userData.mechanism =
      'rear-hinged-opaque-armored-pressure-seal';
    custodyChamber.add(custodySeal);
    const sealFrame = new THREE.Group();
    sealFrame.name =
      'commission-uplink-custody-seal-chipped-armor-load-frame';
    sealFrame.userData.retainedPayloadVisibleWhenClosed = false;
    custodySeal.add(sealFrame);
    const sealFrameMembers = this.addInstanceBatch(
      sealFrame,
      new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
      darkPaint,
      (
        [
        [-0.58, 0.41, 0.12, 0.82],
        [0.58, 0.41, 0.12, 0.82],
        [0, 0.05, 1.05, 0.12],
        [0, 0.77, 1.05, 0.12],
        ] as const
      ).map(([x, z, width, depth]) => ({
        position: [x, 0, z] as [number, number, number],
        scale: [width, 0.12, depth] as [number, number, number],
      })),
    );
    sealFrameMembers.name =
      'commission-uplink-custody-seal-four-member-load-frame';
    sealFrameMembers.userData.memberCount = 4;
    const sealWindow = this.addRoundedBox(
      sealFrame,
      [1.04, 0.075, 0.65],
      serviceDeckPanelLight,
      [0, 0.012, 0.41],
      [0, 0, 0],
      0.02,
    );
    sealWindow.name =
      'commission-uplink-custody-seal-opaque-armored-pressure-plate';
    sealWindow.castShadow = false;
    sealWindow.receiveShadow = false;
    sealWindow.userData.retainedPayloadVisibleWhenClosed = false;
    const sealWitnessSlit = this.addRoundedBox(
      sealFrame,
      [0.28, 0.018, 0.065],
      inspectionGlassMaterial,
      [0, 0.055, 0.41],
      [0, 0, 0],
      0.01,
    );
    sealWitnessSlit.name =
      'commission-uplink-custody-seal-narrow-pressure-witness-slit';
    sealWitnessSlit.castShadow = false;
    sealWitnessSlit.receiveShadow = false;
    const sealRibs = this.addInstancedBeams(
      custodySeal,
      rubbedSteel,
      [
        { from: [-0.43, 0.07, 0.1], to: [-0.43, 0.07, 0.72], radius: 0.022 },
        { from: [0, 0.07, 0.1], to: [0, 0.07, 0.72], radius: 0.022 },
        { from: [0.43, 0.07, 0.1], to: [0.43, 0.07, 0.72], radius: 0.022 },
      ],
      8,
    );
    sealRibs.name =
      'commission-uplink-custody-seal-external-welded-ribs';
    rig.parts.uplinkCustodySeal = custodySeal;

    const custodyLockingBars: [THREE.Group, THREE.Group] = [
      new THREE.Group(),
      new THREE.Group(),
    ];
    for (const [index, sign] of [-1, 1].entries()) {
      const lockingBar = custodyLockingBars[index]!;
      lockingBar.name =
        `commission-uplink-custody-swing-locking-bar-${index + 1}`;
      lockingBar.position.set(sign * 0.42, 0.96, -0.56);
      lockingBar.rotation.z = sign * 1.08;
      lockingBar.userData.side = sign;
      lockingBar.userData.openRotationZ = sign * 1.08;
      lockingBar.userData.closedRotationZ = -sign * 1.43;
      custodyChamber.add(lockingBar);
      const lockingBarBody = this.addRoundedBox(
        lockingBar,
        [0.16, 0.9, 0.18],
        safetyPaint,
        [0, -0.25, 0],
        [0, 0, 0],
        0.03,
      );
      lockingBarBody.name =
        `commission-uplink-custody-swing-lock-painted-body-${index + 1}`;
      lockingBarBody.receiveShadow = false;
      this.addCylinder(
        lockingBar,
        0.1,
        0.14,
        oxidizedSteel,
        [0, 0.1, 0],
        [Math.PI / 2, 0, 0],
        highDetail ? 14 : 9,
      ).name =
        `commission-uplink-custody-swing-lock-bearing-${index + 1}`;
    }
    rig.parts.uplinkCustodyLockingBars = custodyLockingBars;
    rig.parts.uplinkCustodyChamber = custodyChamber;

    // Side-mounted drive: motor -> thrust bearing -> exposed polished rod ->
    // carriage clevis. It never crosses the payload volume.
    const actuatorMotor = this.addRoundedBox(
      cargoRoute,
      [0.42, 0.48, 0.52],
      paintedSteel,
      [0.75, 0.48, -1.18],
      [0, 0, 0],
      0.06,
    );
    actuatorMotor.name = 'commission-uplink-carriage-linear-actuator-motor';
    actuatorMotor.userData.mount = 'side-foundation-four-bolt-bracket';
    const actuatorMotorFace = this.addRoundedBox(
      cargoRoute,
      [0.32, 0.025, 0.38],
      darkPaint,
      [0.75, 0.735, -1.18],
      [0, 0, 0],
      0.012,
    );
    actuatorMotorFace.name =
      'commission-uplink-carriage-actuator-shadowless-service-face';
    actuatorMotorFace.castShadow = false;
    actuatorMotorFace.receiveShadow = false;
    const actuatorFaceBolts = this.addInstanceBatch(
      cargoRoute,
      new THREE.CylinderGeometry(1, 0.8, 1, 8, 1),
      rubbedSteel,
      [
        [0.63, -1.32],
        [0.87, -1.32],
        [0.63, -1.04],
        [0.87, -1.04],
      ].map(([x, z]) => ({
        position: [x ?? 0, 0.756, z ?? 0] as [number, number, number],
        scale: [0.022, 0.018, 0.022] as [number, number, number],
      })),
      false,
    );
    actuatorFaceBolts.name =
      'commission-uplink-carriage-actuator-four-face-bolts';
    this.addCylinder(
      cargoRoute,
      0.13,
      0.15,
      oxidizedSteel,
      [0.75, 0.48, -0.88],
      [Math.PI / 2, 0, 0],
      highDetail ? 16 : 10,
    ).name = 'commission-uplink-carriage-actuator-thrust-bearing';
    actuatorMotor.userData.drive =
      'enclosed-side-rack-driving-the-visible-rail-bogies';
    rig.parts.uplinkTransferActuatorRod = undefined;

    const transferCarriage = new THREE.Group();
    transferCarriage.name = 'commission-uplink-articulated-transfer-carriage';
    transferCarriage.position.set(0, 0.34, 0.92);
    transferCarriage.userData.outboardZ = 0.92;
    transferCarriage.userData.inboardZ = -1.18;
    transferCarriage.userData.strokeLength = 2.1;
    cargoRoute.add(transferCarriage);
    rig.parts.uplinkTransferCarriage = transferCarriage;
    // Hollow U-frame: two runner beams and a rear clevis leave the center
    // visibly empty whenever no authoritative transfer variant is present.
    const carriageWheelInstances: DetailInstance[] = [];
    const carriageWheelHubInstances: DetailInstance[] = [];
    for (const x of [-0.4, 0.4]) {
      this.addRoundedBox(
        transferCarriage,
        [0.17, 0.17, 0.78],
        carriageSteel,
        [x, 0, 0],
        [0, 0, 0],
        0.025,
      ).name = x < 0
        ? 'commission-uplink-hollow-carriage-port-runner'
        : 'commission-uplink-hollow-carriage-starboard-runner';
      for (const z of [-0.24, 0.24]) {
        carriageWheelInstances.push({
          position: [x, -0.08, z],
          scale: [0.075, 0.09, 0.075],
          rotation: [0, 0, Math.PI / 2],
        });
        carriageWheelHubInstances.push({
          position: [x, -0.08, z],
          scale: [0.035, 0.1, 0.035],
          rotation: [0, 0, Math.PI / 2],
        });
      }
    }
    const carriageWheels = this.addInstanceBatch(
      transferCarriage,
      new THREE.CylinderGeometry(
        1,
        0.96,
        1,
        highDetail ? 12 : 8,
        1,
      ),
      rubbedSteel,
      carriageWheelInstances,
    );
    carriageWheels.name =
      'commission-uplink-carriage-four-batched-rail-wheels';
    carriageWheels.userData.wheelCount = 4;
    const carriageWheelHubs = this.addInstanceBatch(
      transferCarriage,
      new THREE.CylinderGeometry(
        1,
        0.96,
        1,
        highDetail ? 10 : 7,
        1,
      ),
      oxidizedSteel,
      carriageWheelHubInstances,
    );
    carriageWheelHubs.name =
      'commission-uplink-carriage-four-batched-wheel-hubs';
    carriageWheelHubs.userData.hubCount = 4;
    this.addRoundedBox(
      transferCarriage,
      [0.96, 0.17, 0.13],
      carriageSteel,
      [0, 0, -0.34],
      [0, 0, 0],
      0.025,
    ).name = 'commission-uplink-hollow-carriage-rear-clevis';
    this.addRoundedBox(
      transferCarriage,
      [0.14, 0.06, 0.15],
      oxidizedSteel,
      [0.75, 0.13, -0.08],
      [0, 0, 0],
      0.018,
    ).name = 'commission-uplink-actuator-to-carriage-clevis';

    const pickupFork = new THREE.Group();
    pickupFork.name =
      'commission-uplink-visible-belt-end-pickup-fork-and-lift-table';
    pickupFork.userData.causalSequence =
      'belt-end-rollers-to-fork-tines-to-clamped-cassette-to-rail-carriage';
    transferCarriage.add(pickupFork);
    for (const x of [-0.22, 0.22]) {
      this.addRoundedBox(
        pickupFork,
        [0.12, 0.07, 0.92],
        carriageSteel,
        [x, 0.04, 0.16],
        [0, 0, 0],
        0.018,
      ).name = x < 0
        ? 'commission-uplink-pickup-fork-port-polished-tine'
        : 'commission-uplink-pickup-fork-starboard-polished-tine';
      this.addRoundedBox(
        pickupFork,
        [0.15, 0.09, 0.12],
        safetyPaint,
        [x, 0.075, 0.6],
        [0, 0, 0],
        0.018,
      ).name = x < 0
        ? 'commission-uplink-pickup-fork-port-belt-contact-toe'
        : 'commission-uplink-pickup-fork-starboard-belt-contact-toe';
    }
    const pickupHeel = this.addRoundedBox(
      pickupFork,
      [0.72, 0.14, 0.1],
      safetyPaint,
      [0, 0.09, -0.25],
      [0, 0, 0],
      0.022,
    );
    pickupHeel.name =
      'commission-uplink-pickup-fork-positive-lift-heel';
    pickupHeel.userData.liftWith = 'authoritative-transfer-carriage';

    // Two short translating pads close around the cassette. They are not
    // robotic arms: each stays wholly inside the carriage side envelope.
    const transferClamps: [THREE.Group, THREE.Group] = [
      new THREE.Group(),
      new THREE.Group(),
    ];
    for (const [index, sign] of [-1, 1].entries()) {
      const clamp = transferClamps[index]!;
      clamp.name =
        `commission-uplink-bounded-translating-side-clamp-${index + 1}`;
      clamp.position.set(sign * 0.47, 0.17, -0.05);
      clamp.userData.side = sign;
      clamp.userData.openX = sign * 0.47;
      clamp.userData.closedX = sign * 0.39;
      clamp.userData.motionEnvelope =
        'short-linear-pad-entirely-within-carriage-width';
      transferCarriage.add(clamp);
      this.addRoundedBox(
        clamp,
        [0.12, 0.26, 0.28],
        safetyPaint,
        [0, 0.08, 0],
        [0, 0, 0],
        0.026,
      ).name =
        `commission-uplink-side-clamp-${index + 1}-worn-pressure-pad`;
      this.addCylinder(
        clamp,
        0.07,
        0.13,
        oxidizedSteel,
        [0, -0.05, -0.1],
        [Math.PI / 2, 0, 0],
        highDetail ? 12 : 8,
      ).name =
        `commission-uplink-side-clamp-${index + 1}-short-slide-bearing`;
    }
    rig.parts.uplinkTransferClamps = transferClamps;
    rig.parts.uplinkTransferArms = undefined;
    rig.parts.uplinkTransferJaws = undefined;
    rig.parts.uplinkTransferScissors = undefined;

    const payloadCarrier = new THREE.Group();
    payloadCarrier.name = 'commission-uplink-high-visibility-payload-carrier';
    payloadCarrier.position.set(0, 0.13, 0);
    payloadCarrier.userData.occupied = false;
    payloadCarrier.userData.emptySilhouette =
      'open-center-u-frame-with-visible-ground-through-carriage';
    transferCarriage.add(payloadCarrier);
    // Four low corner sockets retain cargo without forming a bright cassette.
    for (const [x, z] of (
      [
        [-0.4, -0.24],
        [0.4, -0.24],
        [-0.4, 0.24],
        [0.4, 0.24],
      ] as const
    )) {
      this.addRoundedBox(
        payloadCarrier,
        [0.14, 0.16, 0.14],
        darkPaint,
        [x, 0.08, z],
        [0, 0, 0],
        0.02,
      ).name =
        `commission-uplink-carrier-corner-socket-${x}-${z}`;
    }
    const carrierCage = this.addInstancedBeams(
      payloadCarrier,
      carriageSteel,
      [
        { from: [-0.44, 0.08, -0.28], to: [-0.44, 0.21, -0.28], radius: 0.017 },
        { from: [0.44, 0.08, -0.28], to: [0.44, 0.21, -0.28], radius: 0.017 },
        { from: [-0.44, 0.08, 0.28], to: [-0.44, 0.21, 0.28], radius: 0.017 },
        { from: [0.44, 0.08, 0.28], to: [0.44, 0.21, 0.28], radius: 0.017 },
      ],
      7,
    );
    carrierCage.name =
      'commission-uplink-payload-carrier-visible-retention-cage';
    carrierCage.userData.phaseCue =
      'four-low-corner-posts-never-obscure-item-silhouette';
    const phaseFlags = this.addInstanceBatch(
      payloadCarrier,
      new THREE.BoxGeometry(1, 1, 1),
      carrierStatusMaterial,
      [
        { position: [-0.47, 0.22, -0.24], scale: [0.075, 0.1, 0.04] },
        { position: [0.47, 0.22, -0.24], scale: [0.075, 0.1, 0.04] },
      ],
      false,
    );
    phaseFlags.name = 'commission-uplink-payload-carrier-phase-flags';
    rig.parts.uplinkTransferPayloadCarrier = payloadCarrier;

    const transferPayload = new THREE.Group();
    transferPayload.name = 'commission-uplink-transfer-payload-host';
    transferPayload.position.set(0, 0.2, 0);
    transferPayload.visible = false;
    transferPayload.userData.visualEnvelope = {
      width: 0.86,
      height: 0.42,
      depth: 0.56,
      entirelyWithinCarriage: true,
    };
    transferPayload.userData.loadedOnly =
      'open-steel-carrier-and-marked-item-share-authoritative-visibility';
    payloadCarrier.add(transferPayload);
    rig.parts.uplinkTransferPayload = transferPayload;

    // The low carrier is part of the authoritative payload group, not
    // permanent carriage scenery. Its open top makes the metallic item the
    // dominant loaded-state read and keeps EMPTY visibly hollow.
    const cassettePanel = paintedSteel.clone();
    cassettePanel.name =
      'commission-uplink-loaded-carrier-weathered-painted-steel';
    cassettePanel.color.set('#52615a');
    cassettePanel.emissive.set('#0d1511');
    cassettePanel.emissiveIntensity = 0.012;
    cassettePanel.roughness = 0.86;
    cassettePanel.metalness = 0.54;
    cassettePanel.userData.authoredSurface =
      'open-low-steel-tray-with-chipped-edges-and-oiled-floor';
    const cassetteInset = paintedSteel.clone();
    cassetteInset.name =
      'commission-uplink-loaded-carrier-bare-steel-floor-inset';
    cassetteInset.color.set('#84918a');
    cassetteInset.emissive.set('#101713');
    cassetteInset.emissiveIntensity = 0.012;
    cassetteInset.roughness = 0.56;
    cassetteInset.metalness = 0.78;
    rig.ownedMaterials.push(cassettePanel, cassetteInset);
    const loadedCassette = new THREE.Group();
    loadedCassette.name =
      'commission-uplink-loaded-only-open-steel-payload-carrier';
    loadedCassette.userData.loadedOnly = true;
    loadedCassette.userData.identity =
      'low-open-painted-steel-tray-with-bare-floor-four-corner-dogs-and-fe-marked-physical-payload';
    loadedCassette.userData.bounds = {
      width: 0.84,
      height: 0.22,
      depth: 0.52,
    };
    transferPayload.add(loadedCassette);
    const cassetteBody = this.addRoundedBox(
      loadedCassette,
      [0.84, 0.055, 0.52],
      cassettePanel,
      [0, -0.002, 0],
      [0, 0, 0],
      0.028,
    );
    cassetteBody.name =
      'commission-uplink-open-carrier-chipped-floor-pan';
    cassetteBody.receiveShadow = false;
    const cassetteInsetPanels = this.addInstanceBatch(
      loadedCassette,
      new RoundedBoxGeometry(1, 1, 1, 2, 0.06),
      cassetteInset,
      [
        {
          position: [-0.195, 0.058, 0],
          scale: [0.32, 0.022, 0.38],
        },
        {
          position: [0.195, 0.058, 0],
          scale: [0.32, 0.022, 0.38],
        },
      ],
      false,
    );
    cassetteInsetPanels.name =
      'commission-uplink-open-carrier-two-oiled-bare-floor-insets';
    cassetteInsetPanels.userData.panelCount = 2;
    for (const z of [-0.273, 0.273]) {
      const sideIdentityPanel = this.addRoundedBox(
        loadedCassette,
        [0.56, 0.058, 0.025],
        cassetteInset,
        [0, 0.022, z],
        [0, 0, 0],
        0.01,
      );
      sideIdentityPanel.name = z < 0
        ? 'commission-uplink-open-carrier-rear-steel-retaining-lip'
        : 'commission-uplink-open-carrier-camera-facing-steel-retaining-lip';
      sideIdentityPanel.castShadow = false;
      sideIdentityPanel.receiveShadow = false;
    }
    const cassetteBands = this.addInstanceBatch(
      loadedCassette,
      new THREE.BoxGeometry(1, 1, 1),
      safetyPaint,
      [
        { position: [-0.4, 0.075, 0], scale: [0.035, 0.035, 0.5] },
        { position: [0.4, 0.075, 0], scale: [0.035, 0.035, 0.5] },
        { position: [0, 0.082, -0.24], scale: [0.76, 0.025, 0.035] },
        { position: [0, 0.082, 0.24], scale: [0.76, 0.025, 0.035] },
      ],
      false,
    );
    cassetteBands.name =
      'commission-uplink-open-carrier-worn-safety-edge-bands';
    cassetteBands.userData.crossBandCount = 0;
    const cassetteLocks = this.addInstanceBatch(
      loadedCassette,
      new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
      rubbedSteel,
      [
        [-0.34, -0.18],
        [0.34, -0.18],
        [-0.34, 0.18],
        [0.34, 0.18],
      ].map(([x, z]) => ({
        position: [x ?? 0, 0.082, z ?? 0] as [number, number, number],
        scale: [0.09, 0.07, 0.08] as [number, number, number],
        rotation: [0, (x ?? 0) < 0 ? -0.18 : 0.18, 0] as [
          number,
          number,
          number,
        ],
      })),
      false,
    );
    cassetteLocks.name =
      'commission-uplink-open-carrier-four-positive-corner-dogs';
    cassetteLocks.userData.lockCount = 4;
    this.addInstancedBeams(
      loadedCassette,
      rubbedSteel,
      [
        { from: [-0.18, 0.08, -0.2], to: [-0.18, 0.17, -0.2], radius: 0.014 },
        { from: [-0.18, 0.17, -0.2], to: [0.18, 0.17, -0.2], radius: 0.014 },
        { from: [0.18, 0.17, -0.2], to: [0.18, 0.08, -0.2], radius: 0.014 },
      ],
      7,
    ).name = 'commission-uplink-open-carrier-single-folded-handle';
    const hazardId = this.addRoundedBox(
      loadedCassette,
      [0.3, 0.022, 0.09],
      safetyPaint,
      [0.2, 0.095, 0.13],
      [0, 0.08, 0],
      0.008,
    );
    hazardId.name =
      'commission-uplink-open-carrier-single-worn-load-plate';
    hazardId.userData.markingScope =
      'one-restrained-loaded-cassette-identity-plate';
    const cassetteHazardStripes = this.addInstanceBatch(
      loadedCassette,
      new THREE.BoxGeometry(1, 1, 1),
      darkPaint,
      [
        { position: [0.13, 0.109, 0.13], scale: [0.035, 0.009, 0.08], rotation: [0, 0.58, 0] },
        { position: [0.2, 0.109, 0.13], scale: [0.035, 0.009, 0.08], rotation: [0, 0.58, 0] },
        { position: [0.27, 0.109, 0.13], scale: [0.035, 0.009, 0.08], rotation: [0, 0.58, 0] },
      ],
      false,
    );
    cassetteHazardStripes.name =
      'commission-uplink-loaded-cassette-restrained-hazard-stripes';

    // Eleven catalog silhouettes are built once and cloned into transfer and
    // custody mounts. Plate, brick, spool, gear, board, core, and raw chunks
    // remain recognizably different at native gameplay pixels.
    const cargoKinds = [
      'ironOre',
      'copperOre',
      'coal',
      'stone',
      'ironPlate',
      'copperPlate',
      'stoneBrick',
      'ironGear',
      'copperWire',
      'circuit',
      'automationCore',
    ] as const;
    const cargoSlugs: Record<(typeof cargoKinds)[number], string> = {
      ironOre: 'iron-ore',
      copperOre: 'copper-ore',
      coal: 'coal',
      stone: 'stone',
      ironPlate: 'iron-plate',
      copperPlate: 'copper-plate',
      stoneBrick: 'stone-brick',
      ironGear: 'iron-gear',
      copperWire: 'copper-wire',
      circuit: 'circuit',
      automationCore: 'automation-core',
    };
    const ironCargo = rubbedSteel.clone();
    ironCargo.name = 'commission-uplink-cargo-physical-machined-iron';
    ironCargo.map = null;
    ironCargo.color.set('#b9c2bd');
    ironCargo.emissive.set('#050706');
    ironCargo.emissiveIntensity = 0.006;
    ironCargo.roughness = 0.34;
    ironCargo.metalness = 0.96;
    ironCargo.envMapIntensity = 1.2;
    const copperCargo = oxidizedSteel.clone();
    copperCargo.name = 'commission-uplink-cargo-aged-copper';
    copperCargo.map = null;
    copperCargo.color.set('#d48a5d');
    copperCargo.emissive.set('#683924');
    copperCargo.emissiveIntensity = 0.24;
    const brickCargo = this.materials.agedCeramic.clone();
    brickCargo.name = 'commission-uplink-cargo-fired-stone-brick';
    brickCargo.color.set('#bd654e');
    brickCargo.emissive.set('#452017');
    brickCargo.emissiveIntensity = 0.11;
    brickCargo.roughness = 0.9;
    const boardCargo = this.materials.industrialPanel.clone();
    boardCargo.name = 'commission-uplink-cargo-circuit-board';
    boardCargo.color.set('#315f45');
    boardCargo.roughness = 0.66;
    const rawIron = this.materials.groundRock.clone();
    rawIron.name = 'commission-uplink-cargo-iron-ore';
    rawIron.color.set('#748287');
    const rawCopper = rawIron.clone();
    rawCopper.name = 'commission-uplink-cargo-copper-ore';
    rawCopper.color.set('#9b5b3e');
    const rawCoal = rawIron.clone();
    rawCoal.name = 'commission-uplink-cargo-coal';
    rawCoal.color.set('#252b2b');
    const rawStone = rawIron.clone();
    rawStone.name = 'commission-uplink-cargo-stone';
    rawStone.color.set('#8a806a');
    const coreCargo = linkMaterial.clone();
    coreCargo.name = 'commission-uplink-cargo-automation-core';
    coreCargo.color.set('#4c9d8e');
    coreCargo.emissive.set('#23665b');
    coreCargo.emissiveIntensity = 0.18;
    coreCargo.opacity = 1;
    coreCargo.depthWrite = true;
    rig.ownedMaterials.push(
      ironCargo,
      copperCargo,
      brickCargo,
      boardCargo,
      rawIron,
      rawCopper,
      rawCoal,
      rawStone,
      coreCargo,
    );

    const prototypes = new Map<string, THREE.Group>();
    for (const kind of cargoKinds) {
      const item = new THREE.Group();
      item.name = `commission-uplink-cargo-prototype-${cargoSlugs[kind]}`;
      item.userData.itemKind = kind;
      item.userData.recognizableSilhouette = true;
      if (
        kind === 'ironOre'
        || kind === 'copperOre'
        || kind === 'coal'
        || kind === 'stone'
      ) {
        const material = kind === 'ironOre'
          ? rawIron
          : kind === 'copperOre'
            ? rawCopper
            : kind === 'coal'
              ? rawCoal
              : rawStone;
        for (const [index, [x, y, z, radius]] of (
          [
            [-0.055, 0.04, -0.025, 0.062],
            [0.015, 0.055, 0.025, 0.075],
            [0.075, 0.035, -0.02, 0.052],
          ] as const
        ).entries()) {
          this.addMesh(
            item,
            new THREE.DodecahedronGeometry(radius, 0),
            material,
            [x, y, z],
            [index * 0.21, index * 0.47, index * 0.13],
          );
        }
      } else if (kind === 'ironPlate' || kind === 'copperPlate') {
        const material = kind === 'ironPlate' ? ironCargo : copperCargo;
        const plateLayers = this.addInstanceBatch(
          item,
          new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
          material,
          Array.from({ length: 6 }, (_, layer) => ({
            position: [
              (layer - 2.5) * 0.006,
              0.01 + layer * 0.018,
              (layer - 2.5) * 0.005,
            ] as [number, number, number],
            scale: [
              0.285 - layer * 0.006,
              0.014,
              0.195 - layer * 0.004,
            ] as [number, number, number],
            rotation: [
              0,
              (layer % 2 === 0 ? 1 : -1) * 0.012,
              0,
            ] as [number, number, number],
          })),
        );
        plateLayers.name =
          `commission-uplink-${cargoSlugs[kind]}-six-layer-batched-stack`;
        plateLayers.userData.layerCount = 6;
        if (kind === 'copperPlate') {
          this.addInstancedBeams(
            item,
            darkPaint,
            [
              { from: [-0.13, 0.15, -0.052], to: [0.13, 0.15, -0.052], radius: 0.007 },
              { from: [-0.13, 0.15, 0.052], to: [0.13, 0.15, 0.052], radius: 0.007 },
            ],
            6,
          );
        }
        if (kind === 'ironPlate') {
          const ironStraps = this.addInstanceBatch(
            item,
            new THREE.BoxGeometry(1, 1, 1),
            safetyPaint,
            [
              {
                position: [-0.118, 0.118, 0],
                scale: [0.018, 0.01, 0.18],
              },
              {
                position: [0.118, 0.118, 0],
                scale: [0.018, 0.01, 0.18],
              },
            ],
            false,
          );
          ironStraps.name =
            'commission-uplink-iron-plate-two-visible-retaining-straps';
          const ironStamp = this.addInstanceBatch(
            item,
            new THREE.BoxGeometry(1, 1, 1),
            darkPaint,
            [
              { position: [-0.066, 0.116, 0], scale: [0.014, 0.008, 0.082] },
              { position: [-0.036, 0.116, -0.034], scale: [0.048, 0.008, 0.014] },
              { position: [-0.044, 0.116, 0], scale: [0.034, 0.008, 0.014] },
              { position: [0.025, 0.116, 0], scale: [0.014, 0.008, 0.082] },
              { position: [0.06, 0.116, -0.034], scale: [0.058, 0.008, 0.014] },
              { position: [0.06, 0.116, 0], scale: [0.058, 0.008, 0.014] },
              { position: [0.06, 0.116, 0.034], scale: [0.058, 0.008, 0.014] },
            ],
            false,
          );
          ironStamp.name =
            'commission-uplink-iron-plate-embossed-fe-identity-stamp';
          item.userData.visibleMarking = 'FE / IRON PLATE';
          item.userData.materialIdentity =
            'stacked-machined-ferrous-plate-with-embossed-fe-stamp';
        }
      } else if (kind === 'stoneBrick') {
        const brickStack = this.addInstanceBatch(
          item,
          new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
          brickCargo,
          [
            ...[-0.065, 0, 0.065].map((x, index) => ({
              position: [x, 0.03, 0.018] as [number, number, number],
              scale: [0.058, 0.055, 0.11] as [number, number, number],
              rotation: [
                0,
                index % 2 === 0 ? 0.06 : -0.06,
                0,
              ] as [number, number, number],
            })),
            ...[-0.034, 0.034].map((x) => ({
              position: [x, 0.085, -0.018] as [
                number,
                number,
                number,
              ],
              scale: [0.062, 0.052, 0.105] as [
                number,
                number,
                number,
              ],
              rotation: [0, x < 0 ? -0.05 : 0.05, 0] as [
                number,
                number,
                number,
              ],
            })),
          ],
        );
        brickStack.name =
          'commission-uplink-stone-brick-five-piece-batched-stack';
        brickStack.userData.brickCount = 5;
      } else if (kind === 'ironGear') {
        this.addTorus(
          item,
          0.075,
          0.022,
          ironCargo,
          [0, 0.04, 0],
          [Math.PI / 2, 0, 0],
        );
        this.addInstanceBatch(
          item,
          new THREE.BoxGeometry(1, 1, 1),
          ironCargo,
          Array.from({ length: 10 }, (_, index) => {
            const angle = index * Math.PI * 2 / 10;
            return {
              position: [
                Math.sin(angle) * 0.1,
                0.04,
                Math.cos(angle) * 0.1,
              ] as [number, number, number],
              scale: [0.032, 0.04, 0.04] as [number, number, number],
              rotation: [0, angle, 0] as [number, number, number],
            };
          }),
        );
      } else if (kind === 'copperWire') {
        this.addCylinder(
          item,
          0.056,
          0.14,
          darkPaint,
          [0, 0.055, 0],
          [0, 0, Math.PI / 2],
          highDetail ? 16 : 10,
        );
        for (const x of [-0.075, -0.038, 0, 0.038, 0.075]) {
          this.addTorus(
            item,
            Math.abs(x) > 0.07 ? 0.07 : 0.052,
            0.012,
            Math.abs(x) > 0.07 ? rubbedSteel : copperCargo,
            [x, 0.055, 0],
            [0, Math.PI / 2, 0],
          );
        }
      } else if (kind === 'circuit') {
        this.addRoundedBox(
          item,
          [0.19, 0.03, 0.14],
          boardCargo,
          [0, 0.02, 0],
          [0, 0.08, 0],
          0.007,
        );
        this.addRoundedBox(
          item,
          [0.065, 0.035, 0.052],
          darkPaint,
          [0.012, 0.052, 0],
          [0, 0.08, 0],
          0.006,
        );
        this.addInstanceBatch(
          item,
          new THREE.CylinderGeometry(1, 1, 1, 8, 1),
          copperCargo,
          [
            { position: [-0.06, 0.05, -0.035], scale: [0.014, 0.014, 0.014] },
            { position: [-0.06, 0.05, 0.035], scale: [0.014, 0.014, 0.014] },
            { position: [0.07, 0.05, 0], scale: [0.014, 0.014, 0.014] },
          ],
        );
      } else {
        this.addCylinder(
          item,
          0.075,
          0.055,
          boardCargo,
          [0, 0.03, 0],
          [0, 0, 0],
          6,
        );
        this.addTorus(
          item,
          0.066,
          0.014,
          copperCargo,
          [0, 0.064, 0],
          [Math.PI / 2, 0, 0],
        );
        this.addMesh(
          item,
          new THREE.OctahedronGeometry(0.045, 0),
          coreCargo,
          [0, 0.09, 0],
          [0, Math.PI / 4, 0],
          false,
        );
      }
      item.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = false;
          object.receiveShadow = false;
        }
      });
      prototypes.set(kind, item);
    }

    const mountVariants = (
      host: THREE.Object3D,
      mountLabel: string,
      scale: number,
    ): Map<string, THREE.Object3D> => {
      const variants = new Map<string, THREE.Object3D>();
      for (const kind of cargoKinds) {
        const variant = prototypes.get(kind)!.clone(true);
        variant.name =
          `commission-uplink-${mountLabel}-${cargoSlugs[kind]}-silhouette`;
        variant.userData.itemKind = kind;
        variant.userData.recognizableSilhouette = true;
        variant.userData.mountScale = scale;
        variant.scale.setScalar(scale);
        variant.visible = false;
        host.add(variant);
        variants.set(kind, variant);
      }
      return variants;
    };
    const transferPayloadVariants = mountVariants(
      transferPayload,
      'transfer-payload',
      2.42,
    );
    for (const variant of transferPayloadVariants.values()) {
      variant.userData.mountBaseY = 0.08;
      variant.position.y = 0.08;
    }
    const transferIronPlate =
      transferPayloadVariants.get('ironPlate');
    if (transferIronPlate) {
      transferIronPlate.userData.mountScale = 2.25;
      transferIronPlate.userData.mountVerticalScale = 1.15;
      transferIronPlate.scale.set(2.25, 1.15, 2.25);
      transferIronPlate.rotation.set(0, Math.PI / 2, 0);
      transferIronPlate.userData.nativeGameplayIdentity =
        'flat-carrier-aligned-six-layer-fe-stamped-two-strap-iron-plate-stack';
    }
    rig.parts.uplinkTransferPayloadVariants = transferPayloadVariants;

    const custodyBuffer = new THREE.Group();
    custodyBuffer.name = 'commission-uplink-midtone-keyed-custody-buffer';
    custodyBuffer.userData.slotKinds = [...cargoKinds];
    cargoRoute.add(custodyBuffer);
    rig.parts.uplinkCustodyBuffer = custodyBuffer;
    const custodySlots: THREE.Object3D[] = [];
    const custodySlotVariants: Array<Map<string, THREE.Object3D>> = [];
    const custodyCountIndicators: THREE.Object3D[] = [];
    for (const [slotIndex, x] of [-0.31, 0, 0.31].entries()) {
      const saddle = this.addRoundedBox(
        custodyBuffer,
        [0.28, 0.08, 0.48],
        castSteel,
        [x, 0.48, -1.08],
        [0, 0, 0],
        0.015,
      );
      saddle.name =
        `commission-uplink-custody-slot-${slotIndex + 1}-midtone-saddle`;
      const host = new THREE.Group();
      host.name =
        `commission-uplink-custody-slot-${slotIndex + 1}-item-host`;
      host.position.set(x, 0.58, -1.08);
      custodyBuffer.add(host);
      const indicator = this.addRoundedBox(
        custodyBuffer,
        [0.16, 0.055, 0.055],
        custodyMaterial,
        [x, 0.9, -1.385],
        [-0.12, 0, 0],
        0.008,
      );
      indicator.name =
        `commission-uplink-custody-count-cue-${slotIndex + 1}`;
      indicator.visible = false;
      indicator.userData.slotIndex = slotIndex;
      custodySlots.push(host);
      custodySlotVariants.push(
        mountVariants(host, `custody-slot-${slotIndex + 1}`, 1.65),
      );
      custodyCountIndicators.push(indicator);
    }
    rig.parts.uplinkCustodySlots = custodySlots;
    rig.parts.uplinkCustodySlotVariants = custodySlotVariants;
    rig.parts.uplinkCustodyItems = [];
    rig.parts.uplinkCustodyCountIndicators = custodyCountIndicators;

    // Open capture wings flank the item; there is no roof over the decisive
    // belt-to-carriage handoff.
    const intakeCanopy = new THREE.Group();
    intakeCanopy.name =
      'commission-uplink-hinged-armored-belt-capture-canopy';
    intakeCanopy.position.set(0, 0.72, 0.58);
    intakeCanopy.rotation.x = -1.12;
    intakeCanopy.userData.openRotationX = -1.12;
    intakeCanopy.userData.closedRotationX = -0.08;
    intakeCanopy.userData.mechanism =
      'paired-side-capture-wings-with-open-centerline';
    cargoRoute.add(intakeCanopy);
    for (const x of [-0.37, 0.37]) {
      this.addRoundedBox(
        intakeCanopy,
        [0.16, 0.12, 0.58],
        paintedSteel,
        [x, 0, 0.28],
        [0, 0, 0],
        0.03,
      ).name = x < 0
        ? 'commission-uplink-port-capture-wing'
        : 'commission-uplink-starboard-capture-wing';
      this.addCylinder(
        intakeCanopy,
        0.06,
        0.12,
        oxidizedSteel,
        [x, 0, 0],
        [0, 0, Math.PI / 2],
        highDetail ? 12 : 8,
      ).name = x < 0
        ? 'commission-uplink-port-capture-wing-hinge'
        : 'commission-uplink-starboard-capture-wing-hinge';
    }
    rig.parts.uplinkIntakeCanopy = intakeCanopy;

    const cargoGate = new THREE.Group();
    cargoGate.name = 'commission-uplink-interlocked-cargo-intake-gate';
    cargoGate.position.set(0, 0.93, -0.61);
    cargoGate.rotation.x = -1.02;
    cargoGate.userData.interlock =
      'authoritative-selected-manifest-and-custody-latch';
    cargoRoute.add(cargoGate);
    this.addRoundedBox(
      cargoGate,
      [0.96, 0.15, 0.13],
      castSteel,
      [0, 0, 0],
      [0, 0, 0],
      0.025,
    ).name = 'commission-uplink-cargo-gate-physical-crossbar';
    for (const x of [-0.36, 0.36]) {
      this.addCylinder(
        cargoGate,
        0.09,
        0.14,
        oxidizedSteel,
        [x, 0, 0],
        [Math.PI / 2, 0, 0],
        highDetail ? 12 : 8,
      ).name = x < 0
        ? 'commission-uplink-cargo-gate-port-bearing'
        : 'commission-uplink-cargo-gate-starboard-bearing';
    }
    rig.parts.uplinkCargoGate = cargoGate;

    // Relay acknowledgement is witnessed by a short mechanical pawl at the
    // custody control box. It changes pose only during the ACK stroke; there
    // is no large emissive wash and no geometry beyond the local machine.
    const acknowledgementBox = this.addRoundedBox(
      cargoRoute,
      [0.36, 0.36, 0.28],
      darkPaint,
      [0.78, 0.78, -0.48],
      [0, 0, 0],
      0.035,
    );
    acknowledgementBox.name =
      'commission-uplink-local-relay-acknowledgement-control-box';
    acknowledgementBox.userData.mount =
      'bolted-to-custody-chamber-load-frame';
    const acknowledgementFace = this.addRoundedBox(
      cargoRoute,
      [0.28, 0.2, 0.026],
      paintedSteel,
      [0.78, 0.78, -0.328],
      [0, 0, 0],
      0.018,
    );
    acknowledgementFace.name =
      'commission-uplink-acknowledgement-box-shadowless-face-panel';
    acknowledgementFace.castShadow = false;
    acknowledgementFace.receiveShadow = false;

    const acquireLampMaterial = signalMaterial.clone();
    acquireLampMaterial.name =
      'commission-uplink-local-acquire-servo-witness-material';
    acquireLampMaterial.color.set('#b48745');
    acquireLampMaterial.emissive.set('#6b3e16');
    acquireLampMaterial.emissiveIntensity = 0.08;
    acquireLampMaterial.opacity = 1;
    acquireLampMaterial.depthWrite = true;
    const transmitLampMaterial = signalMaterial.clone();
    transmitLampMaterial.name =
      'commission-uplink-local-transmit-witness-material';
    transmitLampMaterial.color.set('#60988d');
    transmitLampMaterial.emissive.set('#1f5c51');
    transmitLampMaterial.emissiveIntensity = 0.08;
    transmitLampMaterial.opacity = 1;
    transmitLampMaterial.depthWrite = true;
    const acknowledgeLampMaterial = signalMaterial.clone();
    acknowledgeLampMaterial.name =
      'commission-uplink-local-acknowledgement-witness-material';
    acknowledgeLampMaterial.color.set('#d0a258');
    acknowledgeLampMaterial.emissive.set('#754619');
    acknowledgeLampMaterial.emissiveIntensity = 0.08;
    acknowledgeLampMaterial.opacity = 1;
    acknowledgeLampMaterial.depthWrite = true;
    rig.ownedMaterials.push(
      acquireLampMaterial,
      transmitLampMaterial,
      acknowledgeLampMaterial,
    );
    rig.parts.uplinkTransmissionStateLamps = [
      acquireLampMaterial,
      transmitLampMaterial,
      acknowledgeLampMaterial,
    ];
    for (const x of [-0.24, 0.24]) {
      const servoWitness = this.addRoundedBox(
        fixedBearing,
        [0.1, 0.045, 0.08],
        acquireLampMaterial,
        [x, 0.13, 0.5],
        [0, x < 0 ? -0.18 : 0.18, 0],
        0.012,
      );
      servoWitness.name = x < 0
        ? 'commission-uplink-azimuth-port-acquire-witness-lamp'
        : 'commission-uplink-azimuth-starboard-acquire-witness-lamp';
      servoWitness.castShadow = false;
      servoWitness.receiveShadow = false;
    }
    const transmissionShutters: [
      THREE.Object3D,
      THREE.Object3D,
      THREE.Object3D,
    ] = [new THREE.Group(), new THREE.Group(), new THREE.Group()];
    const shutterMaterials = [
      acquireLampMaterial,
      transmitLampMaterial,
      acknowledgeLampMaterial,
    ] as const;
    for (const [index, shutter] of transmissionShutters.entries()) {
      shutter.name =
        `commission-uplink-local-transmission-state-shutter-${index + 1}`;
      shutter.position.set(0.68 + index * 0.1, 0.99, -0.47);
      shutter.userData.baseY = 0.99;
      shutter.userData.phase = ['servo-acquire', 'packets-in-transit', 'relay-acknowledged'][index];
      cargoRoute.add(shutter);
      this.addRoundedBox(
        shutter,
        [0.075, 0.035, 0.13],
        shutterMaterials[index]!,
        [0, 0, 0],
        [0, 0, 0],
        0.012,
      ).name =
        `commission-uplink-local-state-lamp-${index + 1}`;
      this.addCylinder(
        shutter,
        0.035,
        0.09,
        rubbedSteel,
        [0, -0.03, -0.055],
        [Math.PI / 2, 0, 0],
        highDetail ? 10 : 7,
      ).name =
        `commission-uplink-local-state-shutter-hinge-${index + 1}`;
    }
    rig.parts.uplinkTransmissionShutters = transmissionShutters;

    const acknowledgementPivotPlate = this.addRoundedBox(
      cargoRoute,
      [0.34, 0.44, 0.1],
      serviceDeckPanelLight,
      [-0.58, 0.82, -0.64],
      [0, 0, 0],
      0.03,
    );
    acknowledgementPivotPlate.name =
      'commission-uplink-chamber-post-acknowledgement-pivot-plate';
    acknowledgementPivotPlate.userData.mount =
      'camera-facing-port-post-of-receiving-chamber';
    const acknowledgementLatch = new THREE.Group();
    acknowledgementLatch.name =
      'commission-uplink-physical-relay-acknowledgement-latch';
    acknowledgementLatch.position.set(-0.55, 0.82, -0.62);
    acknowledgementLatch.rotation.z = 1.05;
    acknowledgementLatch.userData.standbyRotationZ = 1.05;
    acknowledgementLatch.userData.acknowledgedRotationZ = -1.05;
    acknowledgementLatch.userData.mechanicalState = 'standby-unlatched';
    acknowledgementLatch.userData.causalRole =
      'real-relay-response-drives-local-custody-pawl';
    cargoRoute.add(acknowledgementLatch);
    this.addCylinder(
      acknowledgementLatch,
      0.12,
      0.2,
      rubbedSteel,
      [0, 0, 0],
      [Math.PI / 2, 0, 0],
      highDetail ? 14 : 9,
    ).name = 'commission-uplink-acknowledgement-latch-hinge-pin';
    this.addRoundedBox(
      acknowledgementLatch,
      [0.15, 0.64, 0.14],
      safetyPaint,
      [0, 0.3, 0],
      [0, 0, 0],
      0.028,
    ).name = 'commission-uplink-acknowledgement-latch-pawl';
    this.addRoundedBox(
      acknowledgementLatch,
      [0.5, 0.2, 0.12],
      safetyPaint,
      [0, 0.68, 0],
      [0, 0, 0],
      0.022,
    ).name = 'commission-uplink-acknowledgement-latch-identity-flag';
    this.addCylinder(
      acknowledgementLatch,
      0.115,
      0.18,
      rubbedSteel,
      [0, 0.81, 0],
      [0, 0, Math.PI / 2],
      highDetail ? 14 : 9,
    ).name =
      'commission-uplink-acknowledgement-latch-large-painted-grip';
    const acknowledgementChevron = this.addInstancedBeams(
      acknowledgementLatch,
      acknowledgeLampMaterial,
      [
        { from: [-0.2, 0.66, 0.075], to: [0, 0.77, 0.075], radius: 0.026 },
        { from: [0, 0.77, 0.075], to: [0.2, 0.66, 0.075], radius: 0.026 },
      ],
      highDetail ? 10 : 7,
    );
    acknowledgementChevron.name =
      'commission-uplink-acknowledgement-latch-large-return-chevron';
    const acknowledgementCatch = this.addRoundedBox(
      cargoRoute,
      [0.26, 0.22, 0.22],
      rubbedSteel,
      [0.02, 1.18, -0.64],
      [0, 0, 0],
      0.035,
    );
    acknowledgementCatch.name =
      'commission-uplink-acknowledgement-latch-fixed-catch';
    acknowledgementCatch.userData.engagedBy =
      'physical-relay-acknowledgement-latch';
    rig.parts.uplinkAcknowledgementLatch = acknowledgementLatch;

    // Conversion module and its shielded feed route around the rear of the
    // pedestal. The conduit has four mounted sections and terminal glands.
    const transmissionCapacitorMaterial = signalMaterial.clone();
    transmissionCapacitorMaterial.name =
      'commission-uplink-physical-custody-conversion-capacitor-material';
    transmissionCapacitorMaterial.color.set('#70877f');
    transmissionCapacitorMaterial.emissive.set('#285f56');
    transmissionCapacitorMaterial.emissiveIntensity = 0.055;
    transmissionCapacitorMaterial.opacity = 0.88;
    transmissionCapacitorMaterial.depthWrite = true;
    rig.ownedMaterials.push(transmissionCapacitorMaterial);
    rig.parts.uplinkTransmissionCapacitorMaterial =
      transmissionCapacitorMaterial;
    const transmissionCapacitor = new THREE.Group();
    transmissionCapacitor.name =
      'commission-uplink-three-stage-custody-conversion-capacitor';
    transmissionCapacitor.position.set(-0.98, 0.28, -0.36);
    transmissionCapacitor.userData.causalRole =
      'sealed-vault-to-dish-waveguide-power-conversion';
    root.add(transmissionCapacitor);
    this.addRoundedBox(
      transmissionCapacitor,
      [0.58, 0.58, 0.48],
      castSteel,
      [0, 0.32, 0],
      [0, 0, 0],
      0.07,
    ).name = 'commission-uplink-capacitor-cast-armored-cradle';
    const capacitorServiceFace = this.addRoundedBox(
      transmissionCapacitor,
      [0.46, 0.028, 0.36],
      darkPaint,
      [0, 0.625, 0],
      [0, 0, 0],
      0.014,
    );
    capacitorServiceFace.name =
      'commission-uplink-capacitor-shadowless-segmented-service-face';
    capacitorServiceFace.castShadow = false;
    capacitorServiceFace.receiveShadow = false;
    for (const [index, x] of [-0.18, 0, 0.18].entries()) {
      this.addCylinder(
        transmissionCapacitor,
        0.095,
        0.34,
        index === 1
          ? transmissionCapacitorMaterial
          : oxidizedSteel,
        [x, 0.4, 0.18],
        [0, 0, 0],
        highDetail ? 14 : 9,
      ).name = `commission-uplink-capacitor-oil-can-${index + 1}`;
    }
    const witnessRing = this.addTorus(
      transmissionCapacitor,
      0.11,
      0.016,
      oxidizedSteel,
      [0, 0.72, 0],
      [Math.PI / 2, 0, 0],
    );
    witnessRing.name =
      'commission-uplink-capacitor-large-conversion-witness-ring';
    transmissionCapacitor.userData.witnessRing = witnessRing;
    rig.parts.uplinkTransmissionCapacitor = transmissionCapacitor;

    const custodyFeedMaterial = linkMaterial.clone();
    custodyFeedMaterial.name =
      'commission-uplink-shielded-custody-waveguide-material';
    custodyFeedMaterial.color.set('#6b9188');
    custodyFeedMaterial.emissive.set('#276f64');
    custodyFeedMaterial.emissiveIntensity = 0.035;
    custodyFeedMaterial.opacity = 0.26;
    rig.ownedMaterials.push(custodyFeedMaterial);
    rig.parts.uplinkCustodyFeedMaterial = custodyFeedMaterial;
    const custodyFeed = this.addInstancedBeams(
      root,
      custodyFeedMaterial,
      [
        { from: [0.47, 0.96, -1.42], to: [0.04, 1.03, -1.48], radius: 0.024 },
        { from: [0.04, 1.03, -1.48], to: [-0.62, 1.04, -1.45], radius: 0.024 },
        { from: [-0.62, 1.04, -1.45], to: [-1.0, 1.01, -1.0], radius: 0.022 },
        { from: [-1.0, 1.01, -1.0], to: [-0.78, 1.18, -0.66], radius: 0.021 },
        { from: [-0.78, 1.18, -0.66], to: [-0.58, 1.36, -0.46], radius: 0.019 },
      ],
      highDetail ? 10 : 7,
    );
    custodyFeed.name =
      'commission-uplink-custody-origin-to-transmitter-feed';
    custodyFeed.userData.origin = 'locking-custody-chamber';
    custodyFeed.userData.destination = 'dish-receiver-and-feed-horn';
    custodyFeed.userData.routing =
      'rear-perimeter-clear-of-cargo-and-service-lanes';
    rig.parts.uplinkCustodyFeed = custodyFeed;
    const custodyFeedJoints = this.addInstanceBatch(
      root,
      new THREE.TorusGeometry(0.038, 0.009, 8, 24),
      oxidizedSteel,
      (
        [
        [0.47, 0.96, -1.42],
        [0.04, 1.03, -1.48],
        [-0.62, 1.04, -1.45],
        [-1, 1.01, -1],
        [-0.78, 1.18, -0.66],
        [-0.58, 1.36, -0.46],
        ] as const
      ).map((position) => ({
        position: [...position] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        rotation: [0.7, 0.2, 0.5] as [number, number, number],
      })),
    );
    custodyFeedJoints.name =
      'commission-uplink-six-batched-custody-feed-mounted-joints';
    custodyFeedJoints.userData.jointCount = 6;
    custodyFeedJoints.castShadow = false;
    custodyFeedJoints.receiveShadow = true;

    const outgoingBeamMaterial = new THREE.MeshBasicMaterial({
      color: '#3ebdab',
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      toneMapped: true,
    });
    outgoingBeamMaterial.name =
      'commission-uplink-pass7-continuous-transmit-beam-material';
    const acknowledgementBeamMaterial = new THREE.MeshBasicMaterial({
      color: '#c8752c',
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      toneMapped: true,
    });
    acknowledgementBeamMaterial.name =
      'commission-uplink-pass7-return-acknowledgement-beam-material';
    rig.ownedMaterials.push(
      outgoingBeamMaterial,
      acknowledgementBeamMaterial,
    );

    const outgoingBeam = new THREE.Group();
    outgoingBeam.name = 'commission-uplink-outgoing-transmission-beam';
    outgoingBeam.visible = false;
    outgoingBeam.userData.origin = 'dish-feed-horn';
    outgoingBeam.userData.destination =
      'nearest-powered-grid-relay-transmission-receiver';
    outgoingBeam.userData.causalChain =
      'sealed-vault-through-capacitor-waveguide-feed-and-reflector-to-relay';
    outgoingBeam.userData.visualEnvelope =
      'single-saturated-world-space-beam-with-directional-packets';
    root.add(outgoingBeam);
    const outgoingBeamSleeve = this.addCylinder(
      outgoingBeam,
      0.017,
      1,
      outgoingBeamMaterial,
      [0, 0.5, 0],
      [0, 0, 0],
      highDetail ? 10 : 7,
    );
    outgoingBeamSleeve.name =
      'commission-uplink-continuous-transmit-beam-sleeve';
    outgoingBeamSleeve.castShadow = false;
    outgoingBeamSleeve.receiveShadow = false;
    rig.parts.uplinkOutgoingBeam = outgoingBeam;

    const transmissionPackets: THREE.Object3D[] = [];
    const transmissionPacketGeometries = [
      new THREE.OctahedronGeometry(0.056, 0),
      new THREE.OctahedronGeometry(0.044, 0),
    ] as const;
    for (let index = 0; index < (highDetail ? 3 : 2); index += 1) {
      const packet = this.addMesh(
        root,
        transmissionPacketGeometries[index % 2]!,
        outgoingBeamMaterial,
        [0, 0, 0],
        [0, index * 0.37, 0],
        false,
      );
      packet.name =
        `commission-uplink-directional-transmit-packet-${index + 1}`;
      packet.visible = false;
      packet.userData.sequenceIndex = index;
      transmissionPackets.push(packet);
    }
    rig.parts.uplinkTransmissionPackets = transmissionPackets;

    const acknowledgementBeam = new THREE.Group();
    acknowledgementBeam.name =
      'commission-uplink-relay-return-acknowledgement-beam';
    acknowledgementBeam.visible = false;
    acknowledgementBeam.userData.origin =
      'real-powered-grid-relay-receiver';
    acknowledgementBeam.userData.destination =
      'dish-feed-horn-and-custody-interlock';
    acknowledgementBeam.userData.causalChain =
      'relay-capture-to-return-pulse-to-mechanical-vault-latch';
    root.add(acknowledgementBeam);
    const acknowledgementBeamSleeve = this.addCylinder(
      acknowledgementBeam,
      0.019,
      1,
      acknowledgementBeamMaterial,
      [0, 0.5, 0],
      [0, 0, 0],
      highDetail ? 10 : 7,
    );
    acknowledgementBeamSleeve.name =
      'commission-uplink-return-acknowledgement-beam-sleeve';
    acknowledgementBeamSleeve.castShadow = false;
    acknowledgementBeamSleeve.receiveShadow = false;
    rig.parts.uplinkAcknowledgementBeam = acknowledgementBeam;

    const acknowledgementPackets: THREE.Object3D[] = [];
    const acknowledgementPacketGeometries = [
      new THREE.TetrahedronGeometry(0.064, 0),
      new THREE.TetrahedronGeometry(0.052, 0),
    ] as const;
    for (let index = 0; index < (highDetail ? 3 : 2); index += 1) {
      const packet = this.addMesh(
        root,
        acknowledgementPacketGeometries[index % 2]!,
        acknowledgementBeamMaterial,
        [0, 0, 0],
        [0, index * 0.42, 0],
        false,
      );
      packet.name =
        `commission-uplink-return-acknowledgement-packet-${index + 1}`;
      packet.visible = false;
      packet.userData.sequenceIndex = index;
      acknowledgementPackets.push(packet);
    }
    rig.parts.uplinkAcknowledgementPackets = acknowledgementPackets;

    const transmissionReceiver = new THREE.Group();
    transmissionReceiver.name =
      'commission-uplink-physical-relay-transmission-receiver';
    transmissionReceiver.visible = false;
    transmissionReceiver.userData.receiverRole =
      'powered-grid-relay-packet-sink-and-acknowledgement-origin';
    root.add(transmissionReceiver);
    const receiverRings: THREE.Object3D[] = [];
    const receiverRingSpecs = [
      { radius: 0.1, tube: 0.018, rotation: [Math.PI / 2, 0, 0] },
      { radius: 0.16, tube: 0.012, rotation: [0, 0, 0] },
    ] as const;
    for (const [index, spec] of receiverRingSpecs.entries()) {
      const ring = this.addTorus(
        transmissionReceiver,
        spec.radius,
        spec.tube,
        index === 0
          ? rubbedSteel
          : acknowledgeLampMaterial,
        [0, 0.1 + index * 0.022, 0],
        [...spec.rotation],
      );
      ring.name =
        `commission-uplink-relay-receiver-field-ring-${index + 1}`;
      ring.castShadow = false;
      ring.receiveShadow = false;
      receiverRings.push(ring);
    }
    const receiverNode = this.addMesh(
      transmissionReceiver,
      new THREE.OctahedronGeometry(0.065, 0),
      transmitLampMaterial,
      [0, 0.1, 0],
      [0, Math.PI / 4, 0],
      false,
    );
    receiverNode.name = 'commission-uplink-relay-packet-capture-node';
    const receiverBackplate = this.addCylinder(
      transmissionReceiver,
      0.2,
      0.075,
      serviceDeckPanelLight,
      [0, -0.03, 0],
      [0, 0, 0],
      highDetail ? 14 : 9,
    );
    receiverBackplate.name =
      'commission-uplink-relay-receiver-physical-mounting-backplate';
    const receiverMast = this.addCylinder(
      transmissionReceiver,
      0.065,
      0.5,
      rubbedSteel,
      [0, -0.24, 0],
      [0, 0, 0],
      highDetail ? 12 : 8,
    );
    receiverMast.name =
      'commission-uplink-relay-receiver-grounded-capture-mast';
    rig.parts.uplinkTransmissionReceiver = transmissionReceiver;
    rig.parts.uplinkTransmissionReceiverRings = receiverRings;

    // Localized grease/rub histories follow only moving joints and rails.
    const actuatorWear = this.addMesh(
      root,
      new THREE.CircleGeometry(0.5, highDetail ? 20 : 14),
      this.materials.scorch,
      [1.22, 0.01, -0.88],
      [-Math.PI / 2, 0, 0],
      false,
    );
    actuatorWear.name =
      'commission-uplink-localized-actuator-grease-stain';
    actuatorWear.scale.set(0.42, 0.28, 1);
    actuatorWear.renderOrder = -1;
    actuatorWear.userData.localized = true;
    const cargoSafetyZoning = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      safetyPaint,
      Array.from({ length: highDetail ? 8 : 5 }, (_, index) => ({
        position: [
          0.72 + index * (highDetail ? 0.075 : 0.12),
          0.235,
          1.05,
        ] as [number, number, number],
        scale: [0.045, 0.012, 0.28] as [number, number, number],
        rotation: [0, index % 2 === 0 ? 0.35 : -0.35, 0] as [
          number,
          number,
          number,
        ],
      })),
      false,
    );
    cargoSafetyZoning.name =
      'commission-uplink-painted-cargo-interface-safety-zoning';
    cargoSafetyZoning.userData.zone =
      'real-dock-carriage-swept-clearance';

    const cableTrench = this.addRoundedBox(
      root,
      [0.24, 0.035, 0.72],
      serviceRubber,
      [-1.02, 0.026, 0.78],
      [0, 0, 0],
      0.012,
    );
    cableTrench.name = 'commission-uplink-recessed-cable-trench';
    cableTrench.userData.path =
      'service-cabinet-to-real-district-grid';
    const trenchCovers = this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      rubbedSteel,
      [0.5, 0.72, 0.94].map((z) => ({
        position: [-1.02, 0.05, z] as [number, number, number],
        scale: [0.27, 0.025, 0.13] as [number, number, number],
      })),
    );
    trenchCovers.name =
      'commission-uplink-cable-trench-removable-covers';
    trenchCovers.userData.coverCount = 3;
    trenchCovers.castShadow = false;
    trenchCovers.receiveShadow = true;

    const selectionIndicators: THREE.Object3D[] = [];
    const cornerBeams: DetailBeam[] = [];
    for (const x of [-1.35, 1.35]) {
      for (const z of [-1.68, 1.34]) {
        cornerBeams.push(
          {
            from: [x, 0.035, z],
            to: [x - Math.sign(x) * 0.19, 0.035, z],
            radius: 0.011,
          },
          {
            from: [x, 0.035, z],
            to: [x, 0.035, z - Math.sign(z) * 0.19],
            radius: 0.011,
          },
        );
      }
    }
    const cornerIndicators = this.addInstancedBeams(
      root,
      effectMaterial,
      cornerBeams,
      6,
    );
    cornerIndicators.name = 'commission-uplink-selected-corner-brackets';
    cornerIndicators.userData.selectionRole =
      'restrained-clear-of-foundation-and-dock';
    cornerIndicators.userData.minimumHardwareClearance = 0.06;
    cornerIndicators.visible = rig.entity.id === this.selectedId;
    cornerIndicators.castShadow = false;
    cornerIndicators.receiveShadow = false;
    selectionIndicators.push(cornerIndicators);
    rig.parts.uplinkSelectionIndicators = selectionIndicators;
  }

  private buildBeacon(rig: EntityRig): void {
    const { root } = rig;
    this.addCylinder(root, 0.4, 0.14, this.materials.carbon, [0, 0.09, 0], [0, 0, 0], 6);
    this.addCylinder(root, 0.32, 0.1, this.materials.ceramicDark, [0, 0.18, 0], [0, 0, 0], 12);
    const beaconPanels: DetailInstance[] = [];
    const beaconCables: DetailBeam[] = [];
    const apex = new THREE.Vector3(0, 0.88, 0);
    for (let index = 0; index < 3; index += 1) {
      const angle = index * Math.PI * 2 / 3;
      const foot = new THREE.Vector3(Math.sin(angle) * 0.3, 0.2, Math.cos(angle) * 0.3);
      const shoulder = new THREE.Vector3(Math.sin(angle) * 0.16, 0.68, Math.cos(angle) * 0.16);
      this.addBeam(root, foot, shoulder, 0.055, this.materials.titanium, 10);
      this.addBeam(root, shoulder, apex, 0.035, this.materials.ceramic, 10);
      this.addCylinder(root, 0.07, 0.08, this.materials.amber, [foot.x, 0.17, foot.z], [0, 0, 0], 10);
      beaconPanels.push({
        position: [Math.sin(angle) * 0.295, 0.255, Math.cos(angle) * 0.295],
        scale: [0.17, 0.12, 0.055],
        rotation: [0, angle, 0],
      });
      beaconCables.push({
        from: [Math.sin(angle) * 0.255, 0.225, Math.cos(angle) * 0.255],
        to: [Math.sin(angle) * 0.125, 0.66, Math.cos(angle) * 0.125],
        radius: 0.014,
      });
    }
    this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.housing.beacon,
      beaconPanels,
    );
    this.addInstancedBeams(root, this.materials.rubber, beaconCables, 6);
    this.addCylinder(root, 0.055, 0.53, this.materials.carbonDark, [0, 0.46, 0], [0, 0, 0], 10);
    this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 1, 1, 12, 1),
      this.materials.amber,
      [0.31, 0.46, 0.72].map((y) => ({
        position: [0, y, 0],
        scale: [0.078, 0.025, 0.078],
      })),
    );
    const crystalMaterial = this.materials.signalTemplate.clone();
    crystalMaterial.emissiveIntensity = 2.7;
    rig.lamps.push(crystalMaterial);
    rig.ownedMaterials.push(crystalMaterial);
    this.addMesh(root, new THREE.OctahedronGeometry(0.13, 0), crystalMaterial, [0, 0.57, 0]);

    const ringA = new THREE.Group();
    const ringB = new THREE.Group();
    ringA.position.y = 0.46;
    ringB.position.y = 0.66;
    ringB.rotation.x = 0.45;
    root.add(ringA, ringB);
    rig.parts.ringA = ringA;
    rig.parts.ringB = ringB;
    this.addTorus(ringA, 0.26, 0.025, this.materials.titaniumLight, [0, 0, 0]);
    this.addTorus(ringB, 0.19, 0.022, this.materials.amber, [0, 0, 0]);
    const ringNodes: DetailInstance[] = [];
    for (let node = 0; node < 4; node += 1) {
      const angle = node * Math.PI / 2;
      ringNodes.push({
        position: [Math.sin(angle) * 0.26, 0, Math.cos(angle) * 0.26],
        scale: [0.035, 0.06, 0.035],
      });
    }
    this.addInstanceBatch(
      ringA,
      new THREE.CylinderGeometry(1, 1, 1, 10, 1),
      this.materials.ceramic,
      ringNodes,
    );
    this.addCylinder(root, 0.016, 0.28, this.materials.titaniumLight, [0, 1.01, 0], [0, 0, 0], 8);
    this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.amber,
      [
        { position: [-0.09, 0.84, 0], scale: [0.14, 0.035, 0.045], rotation: [0, -0.35, 0] },
        { position: [0.09, 0.84, 0], scale: [0.14, 0.035, 0.045], rotation: [0, 0.35, 0] },
      ],
    );
    this.addLamp(rig, root, [0, 1.16, 0], 0.025);
    this.addLamp(rig, root, [0.28, 0.24, -0.2], 0.03);
    this.addRivetCorners(root, 0.52, 0.52, 0.19);
  }

  private buildGridRelayPlacementGhost(rig: EntityRig): void {
    const { root } = rig;
    this.addRoundedBox(
      root,
      [0.72, 0.13, 0.72],
      this.materials.carbonDark,
      [0, 0.07, 0],
      [0, 0, 0],
      0.055,
    ).name = 'grid-relay-grounded-octagonal-foundation';
    this.addCylinder(
      root,
      0.31,
      0.11,
      this.materials.titanium,
      [0, 0.17, 0],
      [0, 0, 0],
      12,
    ).name = 'grid-relay-ghost-solid-plinth-silhouette';
    this.addCylinder(
      root,
      0.045,
      1.06,
      this.materials.carbonDark,
      [0, 0.72, 0],
      [0, 0, 0],
      10,
    ).name = 'grid-relay-ghost-mast-silhouette';
    this.addInstancedBeams(
      root,
      this.materials.titaniumLight,
      [
        { from: [-0.4, 1.17, -0.07], to: [0.42, 1.17, -0.07], radius: 0.038 },
        { from: [-0.06, 1.17, -0.39], to: [-0.06, 1.17, 0.39], radius: 0.038 },
        { from: [-0.2, 0.2, -0.2], to: [-0.08, 1.08, -0.08], radius: 0.026 },
        { from: [0.2, 0.2, -0.2], to: [0.08, 1.08, -0.08], radius: 0.026 },
        { from: [-0.2, 0.2, 0.2], to: [-0.08, 1.08, 0.08], radius: 0.026 },
        { from: [0.2, 0.2, 0.2], to: [0.08, 1.08, 0.08], radius: 0.026 },
      ],
      7,
    ).name = 'grid-relay-ghost-engineered-terminal-crossarms';
    this.addRoundedBox(
      root,
      [0.38, 0.38, 0.34],
      this.materials.industrialPanel,
      [0, 0.47, 0],
      [0, 0, 0],
      0.045,
    ).name = 'grid-relay-ghost-enclosed-ground-transformer-can';
    this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 0.82, 1, 10, 1),
      this.materials.ceramic,
      ([
        [-POWER_GRID_TERMINAL_OFFSET, -0.07],
        [POWER_GRID_TERMINAL_OFFSET, -0.07],
        [-0.06, -POWER_GRID_TERMINAL_OFFSET],
        [-0.06, POWER_GRID_TERMINAL_OFFSET],
      ] as const).map(([x, z]) => ({
        position: [x, 1.2, z] as [number, number, number],
        scale: [0.06, 0.36, 0.06] as [number, number, number],
      })),
    ).name = 'grid-relay-ghost-four-terminal-insulators';
    this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 0.92, 1, 10, 1),
      this.materials.copper,
      ([
        [-POWER_GRID_TERMINAL_OFFSET, -0.07],
        [POWER_GRID_TERMINAL_OFFSET, -0.07],
        [-0.06, -POWER_GRID_TERMINAL_OFFSET],
        [-0.06, POWER_GRID_TERMINAL_OFFSET],
      ] as const).map(([x, z]) => ({
        position: [x, POWER_GRID_TERMINAL_HEIGHT - 0.03, z] as [number, number, number],
        scale: [0.074, 0.06, 0.074] as [number, number, number],
      })),
    ).name = 'grid-relay-ghost-four-real-terminal-caps';
    this.addRoundedBox(
      root,
      [0.23, 0.24, 0.18],
      this.materials.carbon,
      [-0.31, 0.3, 0.12],
      [0, -0.08, 0],
      0.028,
    ).name = 'grid-relay-ghost-asymmetric-service-box';
  }

  private buildGridRelay(rig: EntityRig): void {
    const { root } = rig;
    root.userData.powerRelayId = rig.entity.powerRelayId ?? null;
    root.userData.powerNetworkId = rig.entity.powerNetworkId ?? null;
    const patinaMaterial = this.materials.copper.clone();
    patinaMaterial.color.set('#52766e');
    patinaMaterial.roughness = 0.58;
    patinaMaterial.metalness = 0.62;
    rig.ownedMaterials.push(patinaMaterial);
    const relayPorcelainMaterial = this.materials.agedCeramic.clone();
    relayPorcelainMaterial.name = 'grid-relay-dirty-load-insulator-porcelain';
    relayPorcelainMaterial.color.set('#999889');
    relayPorcelainMaterial.roughness = 0.84;
    relayPorcelainMaterial.metalness = 0.04;
    rig.ownedMaterials.push(relayPorcelainMaterial);

    this.addRoundedBox(
      root,
      [0.72, 0.12, 0.72],
      this.materials.carbonDark,
      [0, 0.065, 0],
      [0, 0, 0],
      0.055,
    ).name = 'grid-relay-grounded-octagonal-foundation';
    this.addCylinder(
      root,
      0.31,
      0.11,
      this.materials.titanium,
      [0, 0.16, 0],
      [0, 0, 0],
      12,
    ).name = 'grid-relay-grounded-bus-plinth';
    this.addRoundedBox(
      root,
      [0.53, 0.035, 0.53],
      this.materials.titaniumLight,
      [0, 0.225, 0],
      [0, Math.PI / 4, 0],
      0.012,
    ).name = 'grid-relay-bolted-square-mast-seat';
    this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.carbon,
      [
        { position: [-0.33, 0.08, -0.33], scale: [0.18, 0.08, 0.14], rotation: [0, Math.PI / 4, 0] },
        { position: [0.33, 0.08, -0.33], scale: [0.18, 0.08, 0.14], rotation: [0, -Math.PI / 4, 0] },
        { position: [-0.33, 0.08, 0.33], scale: [0.18, 0.08, 0.14], rotation: [0, -Math.PI / 4, 0] },
        { position: [0.33, 0.08, 0.33], scale: [0.18, 0.08, 0.14], rotation: [0, Math.PI / 4, 0] },
      ],
    ).name = 'grid-relay-four-grounding-feet';
    this.addInstancedBeams(
      root,
      this.materials.copper,
      [
        { from: [0, 0.22, 0], to: [0.33, 0.16, 0.27], radius: 0.02 },
        { from: [0.33, 0.16, 0.27], to: [0.42, 0.08, 0.34], radius: 0.02 },
      ],
      8,
    ).name = 'grid-relay-visible-earth-bond';
    this.addCylinder(
      root,
      0.04,
      0.035,
      this.materials.copperBright,
      [0.34, 0.18, 0.275],
      [0, 0, 0],
      10,
    ).name = 'grid-relay-earth-bond-fastener';
    this.addRoundedBox(
      root,
      [0.23, 0.24, 0.18],
      this.materials.industrialPanel,
      [-0.31, 0.3, 0.12],
      [0, -0.08, 0],
      0.028,
    ).name = 'grid-relay-asymmetric-service-switch-box';
    this.addRoundedBox(
      root,
      [0.15, 0.035, 0.04],
      this.materials.amber,
      [-0.31, 0.36, 0.015],
      [0.18, 0, -0.12],
      0.01,
    ).name = 'grid-relay-service-isolator-handle';
    this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 1, 1, 10, 1),
      patinaMaterial,
      [
        { position: [-POWER_GRID_TERMINAL_OFFSET, POWER_GRID_TERMINAL_HEIGHT - 0.035, -0.07], scale: [0.072, 0.028, 0.072] },
        { position: [POWER_GRID_TERMINAL_OFFSET, POWER_GRID_TERMINAL_HEIGHT - 0.035, -0.07], scale: [0.072, 0.028, 0.072] },
      ],
    ).name = 'grid-relay-oxidized-terminal-clamps';
    const latticeBeams: DetailBeam[] = [
      { from: [-0.14, 0.2, -0.14], to: [-0.08, 1.08, -0.08], radius: 0.018 },
      { from: [0.14, 0.2, -0.14], to: [0.08, 1.08, -0.08], radius: 0.018 },
      { from: [-0.14, 0.2, 0.14], to: [-0.08, 1.08, 0.08], radius: 0.018 },
      { from: [0.14, 0.2, 0.14], to: [0.08, 1.08, 0.08], radius: 0.018 },
    ];
    for (const z of [-0.115, 0.115]) {
      latticeBeams.push(
        { from: [-0.13, 0.28, z], to: [0.1, 0.58, z], radius: 0.011 },
        { from: [0.1, 0.58, z], to: [-0.1, 0.86, z], radius: 0.011 },
        { from: [-0.1, 0.86, z], to: [0.08, 1.06, z], radius: 0.011 },
      );
    }
    for (const x of [-0.115, 0.115]) {
      latticeBeams.push(
        { from: [x, 0.28, -0.13], to: [x, 0.58, 0.1], radius: 0.011 },
        { from: [x, 0.58, 0.1], to: [x, 0.86, -0.1], radius: 0.011 },
        { from: [x, 0.86, -0.1], to: [x, 1.06, 0.08], radius: 0.011 },
      );
    }
    this.addInstancedBeams(
      root,
      this.materials.titanium,
      latticeBeams,
      6,
    ).name = 'grid-relay-open-lattice-load-bearing-mast';

    const insulatorOffsets = [
      [-POWER_GRID_TERMINAL_OFFSET, -0.07],
      [POWER_GRID_TERMINAL_OFFSET, -0.07],
      [-0.06, -POWER_GRID_TERMINAL_OFFSET],
      [-0.06, POWER_GRID_TERMINAL_OFFSET],
    ] as const;
    const insulatorPosts: DetailInstance[] = [];
    const insulatorSkirts: DetailInstance[] = [];
    const conductorCaps: DetailInstance[] = [];
    for (const [x, z] of insulatorOffsets) {
      insulatorPosts.push({
        position: [x, 1.2, z],
        scale: [0.04, 0.36, 0.04],
      });
      for (const y of [1.1, 1.21, 1.32]) {
        insulatorSkirts.push({
          position: [x, y, z],
          scale: [0.09, 0.045, 0.09],
        });
      }
      conductorCaps.push({
        position: [x, POWER_GRID_TERMINAL_HEIGHT - 0.03, z],
        scale: [0.068, 0.06, 0.068],
      });
    }
    this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 0.9, 1, 10, 1),
      this.materials.titaniumLight,
      insulatorPosts,
    ).name = 'grid-relay-insulator-steel-cores';
    this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 0.68, 1, 12, 1),
      relayPorcelainMaterial,
      insulatorSkirts,
    ).name = 'grid-relay-stacked-porcelain-insulators';
    this.addInstanceBatch(
      root,
      new THREE.CylinderGeometry(1, 0.92, 1, 12, 1),
      this.materials.agedCopper,
      conductorCaps,
    ).name = 'grid-relay-copper-insulator-caps';

    this.addCylinder(
      root,
      0.06,
      1.06,
      this.materials.carbonDark,
      [0, 0.72, 0],
      [0, 0, 0],
      12,
    ).name = 'grid-relay-grounded-center-mast';
    this.addCylinder(
      root,
      0.1,
      0.11,
      this.materials.ceramicDark,
      [0, 1.27, 0],
      [0, 0, 0],
      12,
    ).name = 'grid-relay-terminal-neck';
    this.addCylinder(
      root,
      0.085,
      0.085,
      this.materials.agedCopper,
      [0, 1.36, 0],
      [0, 0, 0],
      14,
    ).name = 'grid-relay-overhead-cable-terminal';
    this.addTorus(
      root,
      0.105,
      0.018,
      this.materials.copper,
      [0, POWER_GRID_TERMINAL_HEIGHT, 0],
    ).name = 'grid-relay-terminal-corona-ring';

    const conductorLeads = insulatorOffsets.map(([x, z]) => ({
      from: [x, POWER_GRID_TERMINAL_HEIGHT - 0.03, z] as [number, number, number],
      to: [x * 0.18, 1.19, z * 0.18] as [number, number, number],
      radius: 0.016,
    }));
    this.addInstancedBeams(
      root,
      this.materials.agedCopper,
      conductorLeads,
      8,
    ).name = 'grid-relay-four-copper-bus-leads';
    this.addInstancedBeams(
      root,
      this.materials.titaniumLight,
      [
        { from: [-0.4, 1.17, -0.07], to: [0.42, 1.17, -0.07], radius: 0.038 },
        { from: [-0.06, 1.17, -0.39], to: [-0.06, 1.17, 0.39], radius: 0.038 },
        { from: [-0.34, 1.17, -0.07], to: [-0.11, 0.95, -0.03], radius: 0.023 },
        { from: [0.34, 1.17, -0.07], to: [0.11, 0.95, -0.03], radius: 0.023 },
        { from: [-0.06, 1.17, -0.33], to: [-0.03, 0.95, -0.11], radius: 0.021 },
        { from: [-0.06, 1.17, 0.33], to: [-0.03, 0.95, 0.11], radius: 0.021 },
      ],
      8,
    ).name = 'grid-relay-offset-terminal-crossarms';
    this.addRoundedBox(
      root,
      [0.13, 0.14, 0.11],
      this.materials.carbonDark,
      [0.21, 1.25, -0.07],
      [0, 0, 0],
      0.018,
    ).name = 'grid-relay-offset-fuse-service-box';
    this.addCylinder(
      root,
      0.033,
      0.15,
      this.materials.agedCeramic,
      [0.21, 1.39, -0.07],
      [0, 0, 0],
      10,
    ).name = 'grid-relay-visible-fuse-cartridge';

    const coil = new THREE.Group();
    coil.name = 'grid-relay-induction-coil-rotor';
    root.add(coil);
    rig.parts.gridRelayCoil = coil;
    for (const y of [0.37, 0.45, 0.53]) {
      this.addTorus(
        coil,
        0.15,
        0.024,
        this.materials.agedCopper,
        [0, y, 0],
      );
    }
    this.addInstanceBatch(
      coil,
      new THREE.BoxGeometry(1, 1, 1),
      patinaMaterial,
      [
        { position: [-0.12, 0.45, 0], scale: [0.04, 0.1, 0.065] },
        { position: [0.12, 0.45, 0], scale: [0.04, 0.1, 0.065] },
      ],
    ).name = 'grid-relay-coil-patina-clamping-shoes';
    this.addInstancedBeams(
      coil,
      this.materials.copper,
      Array.from({ length: 3 }, (_, index) => {
        const angle = index * Math.PI / 3;
        return {
          from: [
            Math.sin(angle) * -0.14,
            0.45,
            Math.cos(angle) * -0.14,
          ] as [number, number, number],
          to: [
            Math.sin(angle) * 0.14,
            0.45,
            Math.cos(angle) * 0.14,
          ] as [number, number, number],
          radius: 0.014,
        };
      }),
      8,
    ).name = 'grid-relay-coil-tie-bars';
    this.addRoundedBox(
      root,
      [0.38, 0.38, 0.34],
      this.materials.industrialPanel,
      [0, 0.47, 0],
      [0, 0, 0],
      0.045,
    ).name = 'grid-relay-enclosed-ground-transformer-can';
    this.addInstanceBatch(
      root,
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.carbonDark,
      [-0.1, 0, 0.1].map((x) => ({
        position: [x, 0.48, -0.178] as [number, number, number],
        scale: [0.045, 0.2, 0.018] as [number, number, number],
      })),
      false,
    ).name = 'grid-relay-transformer-cooling-slots';
    this.addInstancedBeams(
      root,
      this.materials.titanium,
      [
        { from: [-0.21, 0.3, -0.21], to: [-0.1, 0.95, -0.1], radius: 0.028 },
        { from: [0.21, 0.3, -0.21], to: [0.1, 0.95, -0.1], radius: 0.028 },
        { from: [-0.21, 0.3, 0.21], to: [-0.1, 0.95, 0.1], radius: 0.028 },
        { from: [0.21, 0.3, 0.21], to: [0.1, 0.95, 0.1], radius: 0.028 },
      ],
      8,
    ).name = 'grid-relay-visible-transformer-to-crossarm-load-frame';

    const networkMaterial = this.materials.signalTemplate.clone();
    const networkColor = powerNetworkColor(rig.entity.powerNetworkId ?? null);
    networkMaterial.color.set(networkColor);
    networkMaterial.emissive.set(networkColor);
    networkMaterial.emissiveIntensity =
      rig.entity.powerNetworkId === null ? 0.12 : 0.72;
    rig.ownedMaterials.push(networkMaterial);
    const fluxRing = this.addTorus(
      root,
      0.19,
      0.01,
      networkMaterial,
      [0, 0.68, 0],
    );
    fluxRing.name = 'grid-relay-restrained-network-flux-ring';
    rig.parts.gridRelayFluxRing = fluxRing;
    const lamp = this.addMesh(
      root,
      new THREE.OctahedronGeometry(0.058, 0),
      networkMaterial,
      [-0.29, 0.27, -0.29],
      [0, Math.PI / 4, 0],
      false,
    );
    lamp.name = 'grid-relay-network-identity-lamp';
    rig.parts.gridRelayLamp = lamp;
    rig.parts.gridRelayLampMaterial = networkMaterial;
    this.addRoundedBox(
      root,
      [0.16, 0.12, 0.12],
      this.materials.carbon,
      [-0.29, 0.23, -0.29],
      [0, Math.PI / 4, 0],
      0.025,
    ).name = 'grid-relay-network-lamp-housing';
    this.addRivetCorners(root, 0.68, 0.68, 0.19);
  }

  private removeEntityRig(id: RenderEntityId, rig: EntityRig): void {
    rig.root.removeFromParent();
    rig.root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    for (const material of rig.ownedMaterials) material.dispose();
    this.entityObjects.delete(id);
  }

  private syncResources(resources: readonly RenderResource[]): void {
    const alive = new Set<string>();
    for (const resource of resources) {
      const key = this.resourceKey(resource);
      alive.add(key);
      let rig = this.resourceObjects.get(key);
      if (!rig) {
        rig = this.createResourceRig(resource, key);
        this.resourceObjects.set(key, rig);
      }
      const coveredByExtractor = this.resourceCoveredByExtractor(resource);
      // Keep the authoritative resource rig under an extractor and lower it
      // beneath the steel deck. Its inner rocks remain visible through the
      // cutter aperture instead of being replaced by a decorative proxy.
      rig.group.position.set(
        resource.x + 0.5,
        coveredByExtractor ? -0.055 : 0.012,
        resource.z + 0.5,
      );
      rig.group.visible = true;
      const amount = resource.depleted
        ? 0.18
        : resource.amount === undefined
          ? 1
          : THREE.MathUtils.clamp(resource.amount / 100, 0.2, 1);
      rig.group.scale.setScalar(0.72 + amount * 0.28);
      rig.auraMaterial.opacity = 0;
    }

    for (const [key, rig] of this.resourceObjects) {
      if (alive.has(key)) continue;
      rig.group.removeFromParent();
      rig.group.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh) {
          object.geometry.dispose();
        }
      });
      for (const material of rig.ownedMaterials) material.dispose();
      this.resourceObjects.delete(key);
    }
  }

  private updateBeltConnections(): void {
    const byCell = new Map<string, RenderEntity>();
    for (const entity of this.entityData.values()) {
      if (entity.kind === 'belt') byCell.set(`${entity.x},${entity.z}`, entity);
    }

    for (const rig of this.entityObjects.values()) {
      if (rig.kind !== 'belt' || !rig.parts.surface) continue;
      const entity = rig.entity;
      const output = directionVector(entity.direction);
      const straightUpstream = byCell.get(`${entity.x - output.x},${entity.z - output.y}`);
      let upstream: RenderEntity | undefined;
      if (
        straightUpstream
        && directionVector(straightUpstream.direction).x === output.x
        && directionVector(straightUpstream.direction).y === output.y
      ) {
        upstream = straightUpstream;
      } else {
        for (const offset of DIRECTION_VECTORS) {
          const candidate = byCell.get(`${entity.x + offset.x},${entity.z + offset.y}`);
          if (!candidate) continue;
          const candidateOutput = directionVector(candidate.direction);
          if (
            candidate.x + candidateOutput.x === entity.x
            && candidate.z + candidateOutput.y === entity.z
          ) {
            upstream = candidate;
            break;
          }
        }
      }

      let turn: BeltTurn = 'straight';
      if (upstream) {
        const inputX = upstream.x - entity.x;
        const inputZ = upstream.z - entity.z;
        const straightX = -output.x;
        const straightZ = -output.y;
        if (inputX !== straightX || inputZ !== straightZ) {
          const cross = output.x * inputZ - output.y * inputX;
          turn = cross > 0 ? 'left' : 'right';
        }
      }
      rig.parts.beltTurn = turn;
      const active = this.rigIsActive(rig);
      rig.parts.surface.material = this.beltSurfaces[turn][active ? 'active' : 'idle'].material;
      const downstream = byCell.get(`${entity.x + output.x},${entity.z + output.y}`);
      const visibleEnds = rig.root.userData.uplinkApproach === true
        ? [false, false]
        : [!downstream, !upstream];
      rig.parts.rollers?.forEach((roller, index) => {
        roller.visible = visibleEnds[index] ?? true;
      });
      rig.parts.beltRollerCaps?.forEach((caps, index) => {
        for (const cap of caps) cap.visible = visibleEnds[index] ?? true;
      });
    }
  }

  private updateItemInstances(items: readonly RenderBeltItem[], elapsed: number): void {
    for (const bucket of this.itemBuckets.values()) bucket.count = 0;
    const uplinkApproachCells = new Set<string>();
    const uplinkDockCells = new Set<string>();
    for (const id of (
      this.infrastructureRoot.userData.uplinkApproachBeltIds ?? []
    ) as RenderEntityId[]) {
      const entity = this.entityData.get(id);
      if (!entity) continue;
      uplinkApproachCells.add(`${entity.x}:${entity.z}`);
    }
    for (const id of (
      this.infrastructureRoot.userData.uplinkDockBeltIds ?? []
    ) as RenderEntityId[]) {
      const entity = this.entityData.get(id);
      if (!entity) continue;
      uplinkDockCells.add(`${entity.x}:${entity.z}`);
    }

    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const item = items[itemIndex];
      if (!item) continue;
      const visualKind = this.itemVisualKind(item.kind);
      const bucket = this.itemBuckets.get(visualKind);
      if (!bucket || bucket.count >= MAX_BELT_ITEMS) continue;

      const direction = directionVector(item.direction);
      const rightX = -direction.y;
      const rightZ = direction.x;
      const seed = hashString(String(item.id ?? `${item.kind}:${item.x}:${item.z}:${itemIndex}`));
      const rawLane = item.lane ?? (seededUnit(seed) > 0.5 ? 1 : -1);
      const laneSide = rawLane === 0 ? -1 : rawLane > 0 ? 1 : -1;
      const laneOffset = laneSide * 0.17;
      const progress = fract(
        item.progress === undefined
          ? elapsed * 0.42 + seededUnit(seed + 11)
          : item.progress,
      );

      const itemHeight = visualKind === 'ore' || visualKind === 'component'
        ? 0.31
        : visualKind === 'coil'
          ? 0.285
          : 0.26;
      if (item.carrier === 'manifold') {
        const rotated = directionIndex(item.direction) % 2 === 1;
        const centerX = item.x + (rotated ? 2 : 1) * 0.5;
        const centerZ = item.z + (rotated ? 1 : 2) * 0.5;
        const junctionX = centerX + direction.x * 0.5;
        const junctionZ = centerZ + direction.y * 0.5;
        const rearX = centerX - direction.x * 0.5;
        const rearZ = centerZ - direction.y * 0.5;
        let pathX: number;
        let pathZ: number;
        let pathDirectionX: number;
        let pathDirectionZ: number;

        if (item.port === undefined) {
          pathX = THREE.MathUtils.lerp(rearX, junctionX, progress);
          pathZ = THREE.MathUtils.lerp(rearZ, junctionZ, progress);
          pathDirectionX = direction.x;
          pathDirectionZ = direction.y;
        } else {
          const branchSign = item.port === 0 ? -1 : 1;
          const sideX = rightX * branchSign;
          const sideZ = rightZ * branchSign;
          const branchEnd = 0.36;
          if (progress < branchEnd) {
            const branchProgress = progress / branchEnd;
            pathX = THREE.MathUtils.lerp(
              junctionX + sideX * 0.48,
              junctionX,
              branchProgress,
            );
            pathZ = THREE.MathUtils.lerp(
              junctionZ + sideZ * 0.48,
              junctionZ,
              branchProgress,
            );
            pathDirectionX = -sideX;
            pathDirectionZ = -sideZ;
          } else {
            const commonProgress = (progress - branchEnd) / (1 - branchEnd);
            pathX = THREE.MathUtils.lerp(junctionX, rearX, commonProgress);
            pathZ = THREE.MathUtils.lerp(junctionZ, rearZ, commonProgress);
            pathDirectionX = -direction.x;
            pathDirectionZ = -direction.y;
          }
        }

        const pathRightX = -pathDirectionZ;
        const pathRightZ = pathDirectionX;
        this.tempObject.position.set(
          pathX + pathRightX * laneOffset * 0.72,
          itemHeight,
          pathZ + pathRightZ * laneOffset * 0.72,
        );
        this.tempObject.rotation.set(
          0,
          Math.atan2(-pathDirectionX, -pathDirectionZ),
          0,
        );
      } else {
        const dockInspectionLift = uplinkDockCells.has(`${item.x}:${item.z}`)
          ? 0.08
          : 0;
        this.tempObject.position.set(
          item.x + 0.5 + direction.x * (progress - 0.5) + rightX * laneOffset,
          itemHeight + dockInspectionLift,
          item.z + 0.5 + direction.y * (progress - 0.5) + rightZ * laneOffset,
        );
        this.tempObject.rotation.set(0, directionAngle(item.direction), 0);
      }
      if (visualKind === 'coil') {
        // A slight shipping tilt exposes the three wound front edges and the
        // asymmetric restraints at native play scale; lying perfectly flat
        // collapses the same bundle into a misleading single-ring token.
        this.tempObject.rotateZ(THREE.MathUtils.degToRad(35));
      }
      const variation = visualKind === 'ore'
        ? 0.86 + seededUnit(seed + 23) * 0.28
        : 1;
      // Keep every authoritative belt item inside its physical lane envelope.
      // The Uplink's readability comes from the bounded carriage payload, not
      // from scaling live belt instances until they intersect adjacent cells.
      const isUplinkDockItem = (
        item.carrier !== 'manifold'
        && uplinkDockCells.has(`${item.x}:${item.z}`)
      );
      const inspectionScale = (
        item.carrier !== 'manifold'
        && uplinkApproachCells.has(`${item.x}:${item.z}`)
      )
        ? isUplinkDockItem
          ? 1.14
          : 1
        : 1;
      this.tempObject.scale.setScalar(variation * inspectionScale);
      this.tempObject.updateMatrix();
      bucket.mesh.setMatrixAt(bucket.count, this.tempObject.matrix);
      bucket.mesh.setColorAt(bucket.count, this.itemColor(item.kind, item.color, seed));
      bucket.count += 1;
    }

    for (const bucket of this.itemBuckets.values()) {
      bucket.mesh.count = bucket.count;
      if (bucket.count === 0) continue;
      bucket.mesh.instanceMatrix.needsUpdate = true;
      if (bucket.mesh.instanceColor) bucket.mesh.instanceColor.needsUpdate = true;
    }
  }

  private resourceKey(resource: RenderResource): string {
    return String(resource.id ?? `${resource.kind}:${resource.x}:${resource.z}`);
  }

  private resourceCoveredByExtractor(resource: RenderResource): boolean {
    for (const entity of this.entityData.values()) {
      if (
        entity.kind !== 'extractor'
        || (entity.health !== undefined && entity.health <= 0)
      ) continue;
      const footprint = this.entityFootprint(entity);
      if (
        resource.x >= entity.x
        && resource.x < entity.x + footprint.worldWidth
        && resource.z >= entity.z
        && resource.z < entity.z + footprint.worldHeight
      ) return true;
    }
    return false;
  }

  private createResourceRig(resource: RenderResource, key: string): ResourceRig {
    const group = new THREE.Group();
    group.name = `resource-${resource.kind}`;
    const seed = hashString(key);
    const color = this.resourceColor(resource.kind);
    const radius = THREE.MathUtils.clamp(resource.radius ?? 0.58, 0.35, 1.8);
    const auraMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const auraGeometry = new THREE.CircleGeometry(radius, 32);
    auraGeometry.rotateX(-Math.PI / 2);
    const aura = new THREE.Mesh(auraGeometry, auraMaterial);
    aura.position.y = 0.006;
    group.add(aura);

    const rockMaterial = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.74,
      metalness: resource.kind.toLowerCase().includes('crystal') ? 0.46 : 0.2,
    });
    const rockGeometry = resource.kind.toLowerCase().includes('crystal')
      ? new THREE.OctahedronGeometry(0.13, 0)
      : new THREE.DodecahedronGeometry(0.12, 0);
    const count = Math.max(5, Math.min(14, Math.round(radius * 10)));
    const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, count);
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    for (let index = 0; index < count; index += 1) {
      const angle = seededUnit(seed + index * 17) * Math.PI * 2;
      const distance = Math.sqrt(seededUnit(seed + index * 31 + 9)) * radius * 0.56;
      const scale = 0.58 + seededUnit(seed + index * 43 + 2) * 0.67;
      this.tempObject.position.set(
        Math.cos(angle) * distance,
        0.055 + scale * 0.035,
        Math.sin(angle) * distance,
      );
      this.tempObject.rotation.set(
        seededUnit(seed + index * 19) * 0.6,
        seededUnit(seed + index * 29) * Math.PI * 2,
        seededUnit(seed + index * 37) * 0.45,
      );
      this.tempObject.scale.set(scale, scale * (0.72 + seededUnit(seed + index * 7) * 0.75), scale);
      this.tempObject.updateMatrix();
      rocks.setMatrixAt(index, this.tempObject.matrix);
      const instanceColor = color.clone().offsetHSL(
        (seededUnit(seed + index * 53) - 0.5) * 0.035,
        0,
        (seededUnit(seed + index * 61) - 0.5) * 0.12,
      );
      rocks.setColorAt(index, instanceColor);
    }
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    group.add(rocks);
    this.resourceRoot.add(group);
    return {
      group,
      auraMaterial,
      ownedMaterials: [auraMaterial, rockMaterial],
    };
  }

  private resourceColor(kind: string): THREE.Color {
    const normalized = kind.toLowerCase();
    if (normalized.includes('copper') || normalized.includes('cinder')) {
      return new THREE.Color('#cf7440');
    }
    if (normalized.includes('crystal') || normalized.includes('silica')) {
      return new THREE.Color('#58c8b8');
    }
    if (normalized.includes('carbon') || normalized.includes('coal')) {
      return new THREE.Color('#596164');
    }
    if (normalized.includes('violet') || normalized.includes('rare')) {
      return new THREE.Color('#a869e8');
    }
    return new THREE.Color('#aebcc0');
  }

  private itemVisualKind(kind: string): ItemVisualKind {
    const normalized = kind.toLowerCase();
    // "automationCore" ends in the letters "ore"; semantic manufactured
    // classes must win before raw-material substring matching.
    if (
      normalized.includes('core')
      || normalized.includes('circuit')
      || normalized.includes('component')
    ) return 'component';
    if (
      normalized.includes('ore')
      || normalized.includes('cinder')
      || normalized.includes('crystal')
      || normalized.includes('raw')
    ) return 'ore';
    if (
      normalized.includes('ingot')
      || normalized.includes('plate')
      || normalized.includes('bar')
      || normalized.includes('brick')
    ) return 'ingot';
    if (
      normalized.includes('coil')
      || normalized.includes('wire')
      || normalized.includes('cable')
    ) return 'coil';
    return 'component';
  }

  private itemColor(
    kind: string,
    explicit: THREE.ColorRepresentation | undefined,
    seed: number,
  ): THREE.Color {
    if (explicit !== undefined) return this.tempColor.set(explicit);
    const normalized = kind.toLowerCase();
    if (normalized.includes('brick')) {
      this.tempColor.set('#b96750');
    } else if (normalized.includes('copper') || normalized.includes('cinder')) {
      this.tempColor.set('#c8753d');
    } else if (normalized.includes('coal')) {
      this.tempColor.set('#333a3a');
    } else if (normalized.includes('stone')) {
      this.tempColor.set('#8b816d');
    } else if (normalized.includes('iron') || normalized.includes('ore')) {
      this.tempColor.set('#aab8b8');
    } else if (normalized.includes('coil') || normalized.includes('wire')) {
      this.tempColor.set('#a869e8');
    } else if (normalized.includes('circuit') || normalized.includes('component')) {
      this.tempColor.set('#47b7d5');
    } else if (normalized.includes('crystal')) {
      this.tempColor.set('#43d7c4');
    } else {
      this.tempColor.set('#b8c5c7');
    }
    return this.tempColor.offsetHSL(
      (seededUnit(seed + 71) - 0.5) * 0.025,
      0,
      (seededUnit(seed + 83) - 0.5) * 0.08,
    );
  }

  private entityVariant(
    entity: Pick<RenderEntity, 'kind' | 'recipe' | 'uplink'>,
  ): EntityRig['variant'] {
    if (entity.kind === 'fabricator' && entity.recipe === 'automationCore') {
      return 'automation-core';
    }
    if (entity.kind === 'storage' && entity.uplink) return 'uplink';
    return 'standard';
  }

  private entityFootprint(
    entity: Pick<RenderEntity, 'kind' | 'direction'>,
  ): {
    localWidth: number;
    localHeight: number;
    worldWidth: number;
    worldHeight: number;
  } {
    const size = ENTITY_FOOTPRINTS[entity.kind];
    const localWidth = size[0];
    const localHeight = size[1];
    const rotated = directionIndex(entity.direction) % 2 === 1;
    return {
      localWidth,
      localHeight,
      worldWidth: rotated ? localHeight : localWidth,
      worldHeight: rotated ? localWidth : localHeight,
    };
  }

  private updateOverlays(elapsed = this.lastElapsed): void {
    if (this.hoveredCell) {
      this.hoverFrame.visible = true;
      this.hoverFrame.position.set(
        this.hoveredCell.x + 0.5,
        0.035,
        this.hoveredCell.z + 0.5,
      );
    } else {
      this.hoverFrame.visible = false;
    }

    const selected = this.selectedId === null ? undefined : this.entityObjects.get(this.selectedId);
    const uplinkUsesAuthoredSelection =
      selected?.variant === 'uplink';
    this.selectionHalo.visible = Boolean(selected) && !uplinkUsesAuthoredSelection;
    if (selected) {
      this.selectionHalo.position.set(
        selected.root.position.x,
        0.08,
        selected.root.position.z,
      );
      const pulse = 1 + Math.sin(elapsed * 3.4) * 0.025;
      const footprint = this.entityFootprint(selected.entity);
      this.selectionHalo.scale.set(
        footprint.worldWidth * pulse,
        1,
        footprint.worldHeight * pulse,
      );
    }
    this.updatePowerGridSelectionVisuals();
  }

  private progressCrossed(
    previous: number | undefined,
    current: number,
    threshold: number,
  ): boolean {
    if (previous === undefined) return false;
    if (current >= previous) return previous < threshold && current >= threshold;
    if (previous < 0.72 || current > 0.28) return false;
    return threshold > previous || threshold <= current;
  }

  private setProcessIntensity(mesh: THREE.Mesh | undefined, intensity: number): void {
    if (mesh?.material instanceof THREE.MeshStandardMaterial) {
      mesh.material.emissiveIntensity = Math.min(3.2, intensity);
    }
  }

  private emitAtPart(
    rig: EntityRig,
    part: THREE.Object3D | undefined,
    kind: 'dust' | 'smoke' | 'spark' | 'steam' | 'mote',
  ): void {
    if (!part) return;
    part.getWorldPosition(this.tempVector);
    rig.root.worldToLocal(this.tempVector);
    this.emitAtRig(
      rig,
      kind,
      [this.tempVector.x, this.tempVector.y, this.tempVector.z],
    );
  }

  private updateProcessSignals(rig: EntityRig, elapsed: number): void {
    const signalRoot = rig.parts.processSignalRoot;
    const glyphRoot = rig.parts.processGlyphRoot;
    if (!signalRoot || !glyphRoot) return;

    const fallbackState: RenderProcessState = rig.entity.status === 'blocked'
      ? 'output-blocked'
      : rig.entity.active
        ? 'working'
        : rig.kind === 'fabricator' && !rig.entity.recipe
          ? 'unconfigured'
          : 'starved';
    const state = rig.entity.processState ?? fallbackState;
    const recipeIdentity = (
      rig.entity.processRecipe
      ?? rig.entity.recipe
      ?? (rig.kind === 'smelter' ? 'auto' : undefined)
    );
    const pendingRecipe = rig.entity.pendingRecipe;
    const reclaimCount = Math.max(0, rig.entity.reclaimCount ?? 0);

    signalRoot.userData.processState = state;
    signalRoot.userData.recipeIdentity = recipeIdentity ?? null;
    signalRoot.userData.pendingRecipe = pendingRecipe ?? null;
    signalRoot.userData.reclaimCount = reclaimCount;
    signalRoot.userData.visiblePrimarySignature = null;
    signalRoot.userData.visiblePrimaryPort = null;

    const primarySignals: Array<{
      state: RenderProcessState;
      part: THREE.Object3D | undefined;
      signature: string;
      port: string;
    }> = [
      {
        state: 'unconfigured',
        part: rig.parts.processUnconfigured,
        signature: 'empty-open-tool-chuck',
        port: 'recipe-socket',
      },
      {
        state: 'starved',
        part: rig.parts.processInputLatch,
        signature: 'rear-amber-empty-hopper',
        port: 'input',
      },
      {
        state: 'working',
        part: rig.parts.processChamberPulse,
        signature: 'green-driven-chamber-impeller',
        port: 'chamber',
      },
      {
        state: 'queued',
        part: rig.parts.processQueueBridge,
        signature: 'static-current-to-pending-tool-bridge',
        port: 'queue',
      },
      {
        state: 'output-blocked',
        part: rig.parts.processOutputGate,
        signature: 'front-red-full-output-crate',
        port: 'output',
      },
      {
        state: 'no-power',
        part: rig.parts.processPowerBreaker,
        signature: 'side-disconnected-power-plug',
        port: 'power',
      },
      {
        state: 'idle',
        part: rig.parts.processIdleReady,
        signature: 'neutral-parked-control-lever',
        port: 'operator-clutch',
      },
    ];
    for (const signal of primarySignals) {
      if (!signal.part) continue;
      signal.part.visible = state === signal.state;
      signal.part.userData.authoritativeState = signal.state;
      signal.part.userData.signalSignature = signal.signature;
      signal.part.userData.physicalPort = signal.port;
      if (signal.part.visible) {
        signalRoot.userData.visiblePrimarySignature = signal.signature;
        signalRoot.userData.visiblePrimaryPort = signal.port;
      }
    }
    if (rig.parts.processStateWitnesses) {
      for (const [witnessState, stateWitness] of rig.parts.processStateWitnesses) {
        stateWitness.visible = witnessState === state;
        stateWitness.userData.authoritativeState = witnessState;
        stateWitness.userData.fixedStateAnchor = true;
      }
      rig.parts.processStateWitnessRoot!.userData.authoritativeState = state;
      rig.parts.processStateWitnessRoot!.userData.fixedStateAnchor = true;
    }

    const queuedPair = state === 'queued' && pendingRecipe !== undefined;
    // The fabricator's 3x2 footprint stretches local X considerably. Keep
    // its physical recipe die subordinate to the working chamber while
    // retaining a generous gameplay-readable silhouette; otherwise the die
    // becomes the machine's largest apparent component at play zoom.
    const dieScale = rig.kind === 'fabricator'
      ? queuedPair ? 0.5 : 0.68
      : queuedPair ? PROCESS_RECIPE_PAIR_SCALE + 0.08 : 0.9;
    const dieX = queuedPair
      ? PROCESS_RECIPE_PAIR_CURRENT_X
      : PROCESS_RECIPE_STATION_X;
    if (rig.parts.processPlaque) {
      rig.parts.processPlaque.visible = state !== 'unconfigured';
      rig.parts.processPlaque.position.set(
        dieX,
        PROCESS_RECIPE_PLAQUE_Y,
        PROCESS_RECIPE_STATION_Z,
      );
      rig.parts.processPlaque.scale.set(dieScale, 1, dieScale);
    }
    glyphRoot.position.set(
      dieX,
      PROCESS_RECIPE_GLYPH_Y,
      PROCESS_RECIPE_STATION_Z,
    );
    glyphRoot.scale.setScalar(dieScale);
    glyphRoot.visible =
      state !== 'unconfigured' && recipeIdentity !== undefined;

    const showGlyph = (
      rootPart: THREE.Group | undefined,
      variants: Map<string, THREE.Object3D> | undefined,
      identity: string | undefined,
      visible: boolean,
    ): string | null => {
      if (!rootPart || !variants) return null;
      for (const variant of variants.values()) variant.visible = false;
      const selected = identity === undefined
        ? undefined
        : variants.get(identity);
      rootPart.visible = visible && selected !== undefined;
      if (rootPart.visible && selected) selected.visible = true;
      const signature = rootPart.visible
        ? processRecipeSignalSignature(identity)
        : null;
      rootPart.userData.recipeIdentity = identity ?? null;
      rootPart.userData.recipeSignature = signature;
      return signature;
    };
    const recipeSignature = showGlyph(
      glyphRoot,
      rig.parts.processRecipeGlyphs,
      recipeIdentity,
      state !== 'unconfigured',
    );
    const pendingGlyphRoot = rig.parts.processPendingGlyphRoot;
    if (rig.parts.processPendingPlaque) {
      rig.parts.processPendingPlaque.visible = queuedPair;
      rig.parts.processPendingPlaque.position.set(
        PROCESS_RECIPE_PAIR_PENDING_X,
        PROCESS_RECIPE_PLAQUE_Y,
        PROCESS_RECIPE_STATION_Z,
      );
      rig.parts.processPendingPlaque.scale.set(dieScale, 1, dieScale);
      rig.parts.processPendingPlaque.userData.recipeIdentity =
        pendingRecipe ?? null;
    }
    if (pendingGlyphRoot) {
      pendingGlyphRoot.position.set(
        PROCESS_RECIPE_PAIR_PENDING_X,
        PROCESS_RECIPE_GLYPH_Y,
        PROCESS_RECIPE_STATION_Z,
      );
      pendingGlyphRoot.scale.setScalar(dieScale);
    }
    const pendingRecipeSignature = showGlyph(
      pendingGlyphRoot,
      rig.parts.processPendingRecipeGlyphs,
      pendingRecipe,
      queuedPair,
    );

    glyphRoot.userData.recipeIdentity = recipeIdentity ?? null;
    glyphRoot.userData.recipeSignature = recipeSignature;
    glyphRoot.userData.standardizedDie = true;
    if (pendingGlyphRoot) {
      pendingGlyphRoot.userData.recipeIdentity = pendingRecipe ?? null;
      pendingGlyphRoot.userData.recipeSignature = pendingRecipeSignature;
      pendingGlyphRoot.userData.standardizedDie = true;
    }
    if (rig.parts.processQueueBridge) {
      rig.parts.processQueueBridge.userData.pendingRecipe =
        pendingRecipe ?? null;
      rig.parts.processQueueBridge.userData.pendingRecipeSignature =
        pendingRecipeSignature;
      rig.parts.processQueueBridge.userData.currentRecipe =
        recipeIdentity ?? null;
      rig.parts.processQueueBridge.userData.currentRecipeSignature =
        recipeSignature;
    }
    if (rig.parts.processReclaimBin) {
      rig.parts.processReclaimBin.visible = reclaimCount > 0;
      rig.parts.processReclaimBin.userData.reclaimCount = reclaimCount;
      rig.parts.processReclaimBin.userData.signalSignature =
        'side-scrap-tray-separated-extraction-claw';
      rig.parts.processReclaimBin.userData.physicalPort = 'reclaim';
    }

    const pulse = 0.88 + Math.sin(elapsed * 5.4 + rig.phaseOffset * 5) * 0.12;
    if (rig.parts.processGlyphMaterial) {
      rig.parts.processGlyphMaterial.emissiveIntensity = 0.12;
    }
    if (rig.parts.processGlyphAccentMaterial) {
      rig.parts.processGlyphAccentMaterial.emissiveIntensity = 0.04;
    }
    if (rig.parts.processAmberMaterial) {
      rig.parts.processAmberMaterial.emissiveIntensity =
        (
          state === 'unconfigured'
          || state === 'starved'
          || state === 'queued'
          || reclaimCount > 0
        )
          ? 0.34 * pulse
          : 0.06;
    }
    if (rig.parts.processTealMaterial) {
      rig.parts.processTealMaterial.emissiveIntensity =
        state === 'working' ? 0.48 * pulse : 0.04;
    }
    if (rig.parts.processRedMaterial) {
      rig.parts.processRedMaterial.emissiveIntensity =
        state === 'output-blocked' || state === 'no-power'
          ? 0.62 * pulse
          : 0.04;
    }

    if (rig.parts.processChamberPulse?.visible) {
      const drivenRotor = rig.parts.processChamberPulse.getObjectByName(
        'process-working-driven-rotor',
      );
      if (drivenRotor) drivenRotor.rotation.y = elapsed * 1.65;
    }
    if (rig.parts.processInputLatch?.visible) {
      rig.parts.processInputLatch.scale.set(1, 1, 1);
    }
    if (rig.parts.processOutputGate?.visible) {
      const loweredGate = rig.parts.processOutputGate.getObjectByName(
        'process-output-lowered-guillotine',
      );
      if (loweredGate) {
        loweredGate.position.y = 0.43 + (pulse - 0.88) * 0.01;
      }
    }
    if (rig.parts.processUnconfigured?.visible) {
      rig.parts.processUnconfigured.rotation.y = 0;
    }
    const workingWitness = rig.parts.processStateWitnesses?.get('working');
    if (workingWitness?.visible) workingWitness.rotation.y = elapsed * 0.7;
  }

  private animateRig(rig: EntityRig, dt: number, elapsed: number): void {
    const active = this.rigIsActive(rig);
    const progress = rig.entity.progress === undefined
      ? fract(elapsed * this.rigCycleSpeed(rig.kind) + rig.phaseOffset)
      : THREE.MathUtils.clamp(rig.entity.progress, 0, 1);
    const previousProgress = rig.parts.previousProgress;
    const progressDelta = previousProgress === undefined ? 0 : progress - previousProgress;
    const wrapped = previousProgress !== undefined
      && previousProgress > 0.72
      && progress < 0.28;
    rig.parts.previousProgress = progress;
    rig.parts.cycleFlash = Math.max(0, (rig.parts.cycleFlash ?? 0) - dt * 3.4);
    if (wrapped) rig.parts.cycleFlash = 1;
    const pulse = 0.86 + Math.sin(elapsed * 5.2 + rig.phaseOffset * Math.PI * 2) * 0.14;
    this.updateRigMaterials(rig, active, pulse);
    if (
      (rig.kind === 'smelter' || rig.kind === 'fabricator')
      && this.usesAuthoredProcessSignals(rig)
    ) {
      this.updateProcessSignals(rig, elapsed);
    }

    if (rig.kind === 'belt') {
      const turn = rig.parts.beltTurn ?? 'straight';
      if (rig.parts.surface) {
        rig.parts.surface.material = this.beltSurfaces[turn][active ? 'active' : 'idle'].material;
      }
      if (active) {
        for (const roller of rig.parts.rollers ?? []) roller.rotation.y -= dt * 6;
      }
      return;
    }

    if (rig.kind === 'manifold') {
      const hasCargo = (rig.entity.routingPortCounts?.[0] ?? 0)
        + (rig.entity.routingPortCounts?.[1] ?? 0) > 0;
      for (const surface of rig.parts.manifoldSurfaces ?? []) {
        surface.material = this.beltSurfaces.straight[
          active || hasCargo ? 'active' : 'idle'
        ].material;
      }
      if (active || hasCargo) {
        for (const roller of rig.parts.manifoldRollers ?? []) {
          if (roller.userData.spinAxis === 'z') roller.rotation.z -= dt * 7.2;
          else roller.rotation.x -= dt * 7.2;
        }
      }

      const mode = rig.entity.routingMode ?? 'even';
      const evenCursor = hasCargo
        ? rig.entity.routingMergeCursors?.[0]
        : rig.entity.routingSplitCursors?.[0];
      const selectedPort: 0 | 1 = mode === 'favorA'
        ? 0
        : mode === 'favorB'
          ? 1
          : mode === 'extract'
            ? 0
            : evenCursor ?? 0;
      const requestedPort = rig.entity.routingActivePort ?? selectedPort;
      if (rig.parts.manifoldDisplayedPort === undefined) {
        rig.parts.manifoldDisplayedPort = requestedPort;
        rig.parts.manifoldTargetPort = requestedPort;
        rig.parts.manifoldSwitchProgress = 1;
      }
      if (rig.parts.manifoldTargetPort !== requestedPort) {
        rig.parts.manifoldTargetPort = requestedPort;
        rig.parts.manifoldSwitchProgress = 0;
        rig.parts.cycleFlash = 1;
        if (active) {
          this.emitAtRig(
            rig,
            'mote',
            [requestedPort === 0 ? -0.28 : 0.28, 0.43, -0.43],
          );
        }
      }
      const fromPort = rig.parts.manifoldDisplayedPort ?? requestedPort;
      const targetPort = rig.parts.manifoldTargetPort ?? requestedPort;
      let switchProgress = rig.parts.manifoldSwitchProgress ?? 1;
      if (switchProgress < 1) {
        switchProgress = Math.min(1, switchProgress + dt / 0.34);
        rig.parts.manifoldSwitchProgress = switchProgress;
        if (switchProgress >= 1) {
          rig.parts.manifoldDisplayedPort = targetPort;
        }
      }
      const switchTurn = THREE.MathUtils.smoothstep(
        switchProgress,
        0.28,
        0.72,
      );
      const portAngle = (port: 0 | 1): number => (
        port === 0 ? Math.PI * 0.48 : -Math.PI * 0.48
      );
      const neutralEven = mode === 'even';
      const targetAngle = neutralEven
        ? 0
        : THREE.MathUtils.lerp(
            portAngle(fromPort),
            portAngle(targetPort),
            switchTurn,
          );
      if (rig.parts.manifoldVane) {
        rig.parts.manifoldVane.rotation.y = THREE.MathUtils.lerp(
          rig.parts.manifoldVane.rotation.y,
          targetAngle,
          1 - Math.exp(-dt * 18),
        );
      }
      if (rig.parts.manifoldSelectorTip) {
        rig.parts.manifoldSelectorTip.visible = mode !== 'even';
      }
      if (rig.parts.manifoldNeutralFork) {
        rig.parts.manifoldNeutralFork.visible = mode === 'even';
      }
      if (rig.parts.manifoldActuatorGear) {
        rig.parts.manifoldActuatorGear.rotation.y = THREE.MathUtils.lerp(
          rig.parts.manifoldActuatorGear.rotation.y,
          -targetAngle * 0.72,
          1 - Math.exp(-dt * 14),
        );
      }
      const visualPort = switchProgress < 0.55 ? fromPort : targetPort;

      const blocked = rig.entity.status === 'blocked';
      for (const port of [0, 1] as const) {
        const lamp = rig.parts.manifoldPortLamps?.[port];
        if (!lamp) continue;
        const chosen = port === visualPort;
        const color = blocked && chosen
          ? '#ff6550'
          : mode === 'even'
            ? '#43d7c4'
          : mode === 'extract' && port === 0
            ? '#a869e8'
            : mode === 'extract'
              ? '#43d7c4'
            : mode.startsWith('favor') && chosen
              ? '#f0a934'
              : mode.startsWith('favor')
                ? '#314346'
                : '#43d7c4';
        lamp.color.set(color);
        lamp.emissive.set(color);
        lamp.emissiveIntensity = blocked && chosen
          ? 2.8
          : mode === 'even'
            ? 1.55 * pulse
          : mode === 'extract'
            ? 1.75 * pulse
            : chosen
              ? 2.15 * pulse
              : 0.12;

        const shutter = rig.parts.manifoldShutters?.[port];
        if (shutter) {
          const restingOther = mode === 'extract'
            ? 1
            : mode === 'even'
              ? 1
              : 0.28;
          let openness = mode === 'even' ? 1 : chosen ? 1 : restingOther;
          if (
            mode !== 'extract'
            && switchProgress < 1
            && fromPort !== targetPort
          ) {
            if (switchProgress < 0.28) {
              const priorOpenness = port === fromPort ? 1 : 0.28;
              openness = priorOpenness * (1 - switchProgress / 0.28);
            } else if (switchProgress <= 0.72) {
              openness = 0;
            } else {
              openness = (mode === 'even' || port === targetPort
                ? 1
                : restingOther) * ((switchProgress - 0.72) / 0.28);
            }
          }
          if (blocked && port === visualPort) openness = 0;
          const sign = port === 0 ? -1 : 1;
          shutter.position.x = THREE.MathUtils.lerp(
            shutter.position.x,
            sign * THREE.MathUtils.lerp(0.255, 0.455, openness),
            1 - Math.exp(-dt * 14),
          );
          shutter.scale.x = THREE.MathUtils.lerp(
            shutter.scale.x,
            THREE.MathUtils.lerp(1, 0.18, openness),
            1 - Math.exp(-dt * 14),
          );
          const targetScale = THREE.MathUtils.lerp(1, 0.78, openness);
          shutter.scale.z = THREE.MathUtils.lerp(
            shutter.scale.z,
            targetScale,
            1 - Math.exp(-dt * 12),
          );

          const face = rig.parts.manifoldShutterFaceMaterials?.[port];
          if (face) {
            if (blocked && port === visualPort) {
              face.color.set('#b9372d');
              face.emissive.set('#ff352b');
              face.emissiveIntensity = 1.9 * pulse;
            } else if (openness < 0.4) {
              face.color.set('#a8936f');
              face.emissive.set('#2a1d0f');
              face.emissiveIntensity = 0.18;
            } else {
              face.color.set('#777b72');
              face.emissive.set('#000000');
              face.emissiveIntensity = 0;
            }
          }
        }
      }
      const core = rig.parts.manifoldCoreMaterial;
      const coreColor = mode === 'extract'
        ? '#a869e8'
        : mode === 'even'
          ? '#43d7c4'
          : '#f0a934';
      if (core) {
        core.color.set(coreColor);
        core.emissive.set(coreColor);
        core.emissiveIntensity = blocked ? 1.05 : active ? 1.7 * pulse : 0.72;
      }
      const selector = rig.parts.manifoldSelectorMaterial;
      if (selector) {
        const selectorColor = blocked ? '#ff6550' : coreColor;
        selector.color.set(selectorColor);
        selector.emissive.set(selectorColor);
        selector.emissiveIntensity = blocked ? 2.8 : 1.85 * pulse;
      }
      const filterToken = rig.parts.manifoldFilterToken;
      const filterTokenMaterial = rig.parts.manifoldFilterTokenMaterial;
      if (filterToken) {
        filterToken.visible = mode === 'extract';
        if (filterToken.visible) {
          filterToken.rotation.y += dt * 2.4;
          filterToken.rotation.x = Math.sin(elapsed * 2.8) * 0.18;
          const tokenPulse = 0.94 + Math.sin(elapsed * 5.2) * 0.08;
          filterToken.scale.setScalar(tokenPulse);
        }
      }
      if (filterTokenMaterial && mode === 'extract') {
        const item = rig.entity.routingFilter ?? 'ironOre';
        const itemColor = this.itemColor(
          item,
          undefined,
          hashString(`manifold-filter:${item}`),
        );
        filterTokenMaterial.color.copy(itemColor);
        filterTokenMaterial.emissive.copy(itemColor);
        filterTokenMaterial.emissiveIntensity = 2.2 * pulse;
      }
      const filterMark = rig.parts.manifoldFilterMark;
      if (filterMark) {
        filterMark.visible = mode === 'extract';
        if (filterMark.visible) {
          const markPulse = 1.02 + Math.sin(elapsed * 5.2) * 0.045;
          filterMark.scale.setScalar(markPulse);
        }
      }
      return;
    }

    if (rig.kind === 'extractor') {
      const motorEngage = active
        ? THREE.MathUtils.smoothstep(progress, 0.04, 0.16)
        : 0;
      const plunge = active
        ? THREE.MathUtils.smoothstep(progress, 0.17, 0.38)
        : 0;
      const retract = active
        ? THREE.MathUtils.smoothstep(progress, 0.7, 0.9)
        : 1;
      const penetration = plunge * (1 - retract);
      const fullTorque = active
        ? THREE.MathUtils.smoothstep(progress, 0.5, 0.58)
          * (1 - THREE.MathUtils.smoothstep(progress, 0.66, 0.76))
        : 0;
      const vibration = fullTorque * Math.sin(progress * Math.PI * 40) * 0.006;
      if (rig.parts.extractorCarriage) {
        rig.parts.extractorCarriage.position.y = 1.04 - penetration * 0.47;
        rig.parts.extractorCarriage.position.x = vibration;
        rig.parts.extractorCarriage.rotation.z = vibration * 0.8;
      }
      if (rig.parts.rotor) {
        rig.parts.rotor.rotation.y = active
          ? -progress * Math.PI * 10 * motorEngage
          : 0;
      }
      if (rig.parts.extractorMotorRotor) {
        rig.parts.extractorMotorRotor.rotation.y = active
          ? progress * Math.PI * 8 * motorEngage
          : 0;
      }
      if (rig.parts.extractorMotor) {
        rig.parts.extractorMotor.rotation.x =
          fullTorque * Math.sin(progress * Math.PI * 32) * 0.018;
      }
      const ejectFlash = rig.parts.cycleFlash ?? 0;
      const discharge = active
        ? THREE.MathUtils.smoothstep(progress, 0.91, 0.975)
        : 0;
      const chuteOpen = Math.max(discharge, ejectFlash);
      if (rig.parts.outputChute) {
        rig.parts.outputChute.rotation.x = chuteOpen;
        rig.parts.outputChute.rotation.z = chuteOpen * 0.28;
        rig.parts.outputChute.position.y = 0.205 + chuteOpen * 0.075;
        rig.parts.outputChute.position.z = -0.34 + chuteOpen * 0.14;
      }
      if (rig.parts.outputGlow) {
        rig.parts.outputGlow.scale.set(
          1 + chuteOpen * 0.55,
          1 + chuteOpen * 1.45,
          1,
        );
      }
      this.setProcessIntensity(
        rig.parts.outputGlow,
        active ? 0.22 + discharge * 3 + ejectFlash * 6.2 : 0.06,
      );
      const contactResponse = active
        ? THREE.MathUtils.smoothstep(progress, 0.38, 0.46)
          * (1 - THREE.MathUtils.smoothstep(progress, 0.69, 0.76))
        : 0;
      const contactCrown = rig.parts.extractorChipCrown;
      if (contactCrown) {
        contactCrown.visible = contactResponse > 0.02;
        contactCrown.position.y = 0.018 + fullTorque * 0.065;
        contactCrown.rotation.y = progress * Math.PI * 6;
        const crownScale = 0.74 + fullTorque * 0.78;
        contactCrown.scale.setScalar(crownScale);
        contactCrown.userData.response = contactResponse;
        contactCrown.userData.torqueExpansion = fullTorque;
      }
      const resourceColor = this.resourceColor(
        rig.entity.resourceKind ?? 'stone',
      );
      if (rig.parts.extractorChipMaterial) {
        rig.parts.extractorChipMaterial.color.copy(resourceColor);
        rig.parts.extractorChipMaterial.emissive
          .copy(resourceColor)
          .multiplyScalar(0.65);
      }
      if (
        rig.parts.extractorDustRing?.material
        instanceof THREE.MeshBasicMaterial
      ) {
        const dustMaterial = rig.parts.extractorDustRing.material;
        dustMaterial.color.copy(resourceColor);
        dustMaterial.opacity = contactResponse * (0.32 + fullTorque * 0.5);
        const ringScale = 0.72 + fullTorque * 0.8;
        rig.parts.extractorDustRing.scale.set(
          ringScale * 0.74,
          ringScale * 1.28,
          ringScale,
        );
      }
      const readySignal = active
        ? THREE.MathUtils.smoothstep(progress, 0.025, 0.065)
          * (1 - THREE.MathUtils.smoothstep(progress, 0.14, 0.19))
        : 1;
      const unloadSignal = active
        ? THREE.MathUtils.smoothstep(progress, 0.72, 0.78)
          * (1 - THREE.MathUtils.smoothstep(progress, 0.88, 0.93))
        : 0;
      if (rig.parts.extractorStatusLamp) {
        rig.parts.extractorStatusLamp.visible = readySignal > 0.02;
        rig.parts.extractorStatusLamp.userData.readySignal = readySignal;
      }
      if (
        rig.parts.extractorStatusLamp?.material
        instanceof THREE.MeshStandardMaterial
      ) {
        const statusMaterial = rig.parts.extractorStatusLamp.material;
        statusMaterial.emissiveIntensity = !rig.entity.powered
          ? 0.16
          : rig.entity.status === 'blocked'
            ? 0.48 + pulse * 0.25
            : active
              ? 1.9 * readySignal
              : 0.72;
      }
      if (rig.parts.extractorUnloadLinkage) {
        rig.parts.extractorUnloadLinkage.visible = unloadSignal > 0.02;
        rig.parts.extractorUnloadLinkage.userData.unloadSignal = unloadSignal;
        const linkagePulse = 0.96 + unloadSignal * 0.1;
        rig.parts.extractorUnloadLinkage.scale.setScalar(linkagePulse);
      }
      const cuttingWindow = active && progress > 0.3 && progress < 0.72;
      if (
        cuttingWindow
        && Math.random() < dt * (this.quality === 'high' ? 7 : 2.4)
      ) {
        this.emitAtRig(rig, 'dust', [0, 0.04, -0.105]);
      }
      if (active && this.progressCrossed(previousProgress, progress, 0.4)) {
        this.emitAtRig(rig, 'dust', [-0.13, 0.035, -0.11]);
        this.emitAtRig(rig, 'dust', [0.13, 0.035, -0.11]);
      }
      if (active && wrapped) {
        this.emitAtRig(rig, 'dust', [-0.36, 0.16, -0.66]);
        this.emitAtRig(rig, 'mote', [-0.36, 0.19, -0.69]);
      }
      return;
    }

    if (rig.kind === 'inserter') {
      const carriedItem = rig.entity.carriedItem;
      const pickupContact = rig.entity.pickupContact ?? [0, 0.5];
      const dropContact = rig.entity.dropContact ?? [0, -0.5];
      const swing = THREE.MathUtils.smoothstep(progress, 0.14, 0.86);
      const lift = THREE.MathUtils.smoothstep(progress, 0.04, 0.16)
        * (1 - THREE.MathUtils.smoothstep(progress, 0.84, 0.96));
      // The boom is authored toward local -Z. Rotating it by PI at p=0
      // reaches the simulation's rear/source cell; p=1 reaches front/target.
      if (rig.parts.armYaw) {
        rig.parts.armYaw.rotation.y = Math.PI * (1 - swing);
      }
      const sourceWristX = -pickupContact[0];
      const sourceWristZ = -pickupContact[1];
      const targetWristX = dropContact[0];
      const targetWristZ = dropContact[1];
      const wristX = THREE.MathUtils.lerp(sourceWristX, targetWristX, swing);
      let wristZ = THREE.MathUtils.lerp(sourceWristZ, targetWristZ, swing);
      const releaseSnap = !carriedItem && rig.entity.armReturning
        ? THREE.MathUtils.smoothstep(progress, 0.82, 0.99)
        : 0;
      wristZ += 0.26 * releaseSnap;
      if (rig.parts.wristCarriage) {
        rig.parts.wristCarriage.position.z = wristZ;
      }
      if (rig.parts.wristExtension) {
        const boomEndZ = -0.46;
        const extensionLength = Math.max(0.04, Math.abs(wristZ - boomEndZ));
        rig.parts.wristExtension.position.z = (boomEndZ + wristZ) * 0.5;
        rig.parts.wristExtension.scale.z = extensionLength;
      }
      if (rig.parts.gripper) {
        rig.parts.gripper.position.x = wristX;
        rig.parts.gripper.position.y = 0.04 + 0.2 * lift + 0.12 * releaseSnap;
      }
      const closure = carriedItem
        ? 1
        : 0;
      for (const [index, sign] of [-1, 1].entries()) {
        const jaw = rig.parts.gripperJaws?.[index];
        if (jaw) {
          jaw.position.x = sign * THREE.MathUtils.lerp(0.195, 0.08, closure);
          // The opposing snap both closes and raises the inner silver hooks,
          // keeping them visibly on top of the orange payload at acquisition.
          jaw.rotation.z = -sign * 0.18 * closure;
        }
        const hookTip = rig.parts.gripperHookTips?.[index];
        if (hookTip) {
          hookTip.position.x = sign * THREE.MathUtils.lerp(0.035, -0.04, closure);
        }
      }
      if (rig.parts.heldItem) {
        rig.parts.heldItem.visible = Boolean(carriedItem);
      }
      for (const variant of Object.values(rig.parts.heldItemVariants ?? {})) {
        if (variant) variant.visible = false;
      }
      if (carriedItem) {
        const visualKind = this.itemVisualKind(carriedItem);
        const variant = rig.parts.heldItemVariants?.[visualKind];
        if (variant) variant.visible = true;
        const material = rig.parts.heldItemMaterial;
        if (material) {
          material.color.copy(this.itemColor(
            carriedItem,
            rig.entity.carriedItemColor,
            hashString(`inserter-custody:${carriedItem}`),
          ));
          const ore = visualKind === 'ore';
          material.roughness = ore ? 0.76 : 0.33;
          material.metalness = ore ? 0.2 : 0.72;
        }
      }

      const previousCarriedItem = rig.parts.previousCarriedItem;
      if (!previousCarriedItem && carriedItem) {
        this.emitAtPart(rig, rig.parts.gripper, 'mote');
      } else if (previousCarriedItem && !carriedItem && progress > 0.9) {
        this.emitAtPart(rig, rig.parts.gripper, 'spark');
      }
      rig.parts.previousCarriedItem = carriedItem;
      return;
    }

    if (rig.kind === 'smelter') {
      for (const fan of rig.parts.fans ?? []) {
        if (active) fan.rotation.z -= dt * 8.5;
      }
      const cycleFlash = rig.parts.cycleFlash ?? 0;
      const heat = active
        ? THREE.MathUtils.smoothstep(progress, 0.04, 0.9)
        : 0;
      const soak = active
        ? THREE.MathUtils.smoothstep(progress, 0.42, 0.62)
          * (1 - THREE.MathUtils.smoothstep(progress, 0.67, 0.78))
        : 0;
      const doorOpen = active
        ? THREE.MathUtils.smoothstep(progress, 0.72, 0.94)
        : 0;
      const discharge = active
        ? THREE.MathUtils.smoothstep(progress, 0.9, 0.97)
        : 0;
      if (rig.parts.recipeProductShuttle) {
        const baseZ =
          rig.parts.recipeProductShuttle.userData.baseZ ?? -0.43;
        const reveal = active
          ? THREE.MathUtils.smoothstep(progress, 0.62, 0.9)
          : 0.28;
        rig.parts.recipeProductShuttle.position.z =
          baseZ - reveal * 0.13;
        rig.parts.recipeProductShuttle.position.y =
          0.39 + reveal * 0.025;
        rig.parts.recipeProductShuttle.scale.setScalar(0.9 + reveal * 0.1);
        rig.parts.recipeProductShuttle.visible =
          active || rig.entity.processState === 'output-blocked';
      }
      if (rig.parts.recipeMechanismActuator) {
        const actuation =
          rig.parts.recipeMechanismActuator.userData.actuation;
        if (actuation === 'hydraulic-press') {
          const baseY =
            rig.parts.recipeMechanismActuator.userData.baseY ?? 0.88;
          rig.parts.recipeMechanismActuator.position.y =
            baseY - soak * 0.085;
        } else if (actuation === 'slag-rake' && active) {
          rig.parts.recipeMechanismActuator.rotation.y =
            Math.sin(progress * Math.PI * 2) * 0.18;
        }
      }
      if (rig.parts.recipeMechanismRotor) {
        const rotorRate =
          rig.parts.recipeMechanismRotor.userData.actuation === 'tilting-ladle'
            ? 0.22
            : 0.48;
        rig.parts.recipeMechanismRotor.rotation.y =
          active
            ? Math.sin(progress * Math.PI * 2) * rotorRate
            : 0;
      }
      if (rig.parts.crucibleRing) {
        const ringScale = 0.94 + heat * 0.1 + cycleFlash * 0.14;
        rig.parts.crucibleRing.scale.set(ringScale, ringScale, ringScale);
      }
      this.setProcessIntensity(
        rig.parts.crucibleRing,
        active ? 0.26 + heat * 1.6 + soak * 0.25 + cycleFlash * 1.25 : 0.1,
      );
      if (rig.parts.crucibleGlow) {
        const swell = 1 + heat * 0.08 + soak * 0.05;
        rig.parts.crucibleGlow.scale.set(swell, 0.78 + heat * 0.32, swell);
      }
      this.setProcessIntensity(
        rig.parts.crucibleGlow,
        active
          ? 0.3 + heat * 1.45 + soak * 0.35 + cycleFlash * 0.35
          : 0.12,
      );
      if (rig.parts.flashCore) {
        const flashScale = 0.84 + heat * 0.08 + cycleFlash * 0.92;
        rig.parts.flashCore.scale.set(flashScale, 0.86 + cycleFlash * 0.7, flashScale);
      }
      this.setProcessIntensity(
        rig.parts.flashCore,
        active ? 0.05 + heat * 0.15 + soak * 0.1 + cycleFlash * 3.4 : 0.04,
      );
      for (const vent of rig.parts.heatVents ?? []) {
        vent.scale.set(1 + soak * 0.12, 1, 0.88 + soak * 0.42);
        this.setProcessIntensity(
          vent,
          active
            ? 0.1 + heat * 0.25 + soak * 1.8 + doorOpen * 0.15 + cycleFlash * 0.3
            : 0.05,
        );
      }
      if (rig.parts.furnaceDoor) {
        rig.parts.furnaceDoor.position.x = doorOpen * 0.18;
        rig.parts.furnaceDoor.position.y = 0.405 + doorOpen * 0.1;
        rig.parts.furnaceDoor.rotation.x = -doorOpen * 0.12;
        rig.parts.furnaceDoor.rotation.y = doorOpen * 0.08;
      }
      if (rig.parts.doorGlow) {
        rig.parts.doorGlow.scale.set(
          1 + doorOpen * 1.25 + discharge * 0.35,
          1 + doorOpen * 0.6,
          1 + doorOpen * 0.8 + discharge * 0.35,
        );
      }
      this.setProcessIntensity(
        rig.parts.doorGlow,
        active
          ? 0.15 + heat * 0.28 + doorOpen * 1.55 + discharge * 0.55 + cycleFlash * 0.25
          : 0.1,
      );
      if (rig.parts.dischargeGlow) {
        rig.parts.dischargeGlow.scale.set(
          0.88 + discharge * 0.55 + cycleFlash * 0.18,
          0.9 + discharge * 0.45,
          0.85 + discharge * 1.4 + cycleFlash * 0.25,
        );
      }
      this.setProcessIntensity(
        rig.parts.dischargeGlow,
        active
          ? 0.08 + heat * 0.12 + doorOpen * 0.25 + discharge * 2.65 + cycleFlash * 0.55
          : 0.04,
      );
      if (
        active
        && progress > 0.16
        && Math.random() < dt * (this.quality === 'high' ? 1.6 : 0.55)
      ) {
        const stackX = Math.sin(elapsed * 3 + rig.phaseOffset * 8) > 0 ? 0.2 : -0.2;
        this.emitAtRig(rig, 'smoke', [stackX, 0.91, 0.26]);
      }
      if (
        active
        && (
          this.progressCrossed(previousProgress, progress, 0.56)
          || this.progressCrossed(previousProgress, progress, 0.84)
        )
      ) {
        this.emitAtRig(rig, 'spark', [0, 0.43, -0.25]);
      }
      if (active && wrapped) {
        this.emitAtRig(rig, 'spark', [0, 0.42, -0.38]);
        this.emitAtRig(rig, 'mote', [0, 0.3, -0.46]);
        this.emitAtRig(rig, 'smoke', [-0.2, 0.91, 0.26]);
        this.emitAtRig(rig, 'smoke', [0.2, 0.91, 0.26]);
      }
      return;
    }

    if (rig.kind === 'fabricator') {
      if (rig.parts.turntable && active) rig.parts.turntable.rotation.y += dt * 2.8;
      if (rig.parts.fabricatorGearTrain && active) {
        for (const [index, gear] of rig.parts.fabricatorGearTrain.children.entries()) {
          gear.rotation.y += dt * (index % 2 === 0 ? 2.4 : -3.4);
        }
      }
      if (rig.parts.fabricatorMotorRotor && active) {
        rig.parts.fabricatorMotorRotor.rotateY(dt * 5.6);
      }
      const approach = active ? THREE.MathUtils.smoothstep(progress, 0.03, 0.24) : 0;
      const retract = active ? THREE.MathUtils.smoothstep(progress, 0.72, 0.93) : 1;
      const engaged = approach * (1 - retract);
      const spread = 0.28 - engaged * 0.13;
      const traverse = Math.sin(progress * Math.PI * 4) * 0.075 * engaged;
      const toolStroke = engaged * (
        0.16 + Math.max(0, Math.sin(progress * Math.PI * 8)) * 0.045
      );
      if (rig.parts.carriageA) {
        rig.parts.carriageA.position.x = -spread + traverse;
        rig.parts.carriageA.position.y = 0.62 - toolStroke;
        rig.parts.carriageA.rotation.z = engaged * 0.055;
      }
      if (rig.parts.carriageB) {
        rig.parts.carriageB.position.x = spread + traverse;
        rig.parts.carriageB.position.y = 0.62 - toolStroke * 0.88;
        rig.parts.carriageB.rotation.z = -engaged * 0.055;
      }
      const arcFlicker = active
        ? engaged * (0.62 + Math.sin(elapsed * 27 + rig.phaseOffset * 11) ** 2 * 0.38)
        : 0;
      const fabricatorRecipe =
        rig.entity.processRecipe ?? rig.entity.recipe ?? 'unconfigured';
      const effectWeight =
        fabricatorRecipe === 'copperWire'
          ? 0.28
          : fabricatorRecipe === 'ironGear'
            ? 0.52
            : 0.72;
      if (rig.parts.fabricatorArc) {
        const arcScale = 0.76 + arcFlicker * 0.34 * effectWeight;
        rig.parts.fabricatorArc.scale.set(arcScale, arcScale, arcScale);
      }
      this.setProcessIntensity(
        rig.parts.fabricatorArc,
        active ? 0.12 + arcFlicker * 1.9 * effectWeight : 0.04,
      );
      const outputFlash = rig.parts.cycleFlash ?? 0;
      if (rig.parts.recipeFeedStock) {
        const baseY = rig.parts.recipeFeedStock.userData.baseY ?? 0.53;
        const baseZ = rig.parts.recipeFeedStock.userData.baseZ ?? 0.4;
        const feedAdvance = active
          ? THREE.MathUtils.smoothstep(progress, 0.03, 0.34)
          : 0;
        const feedConsume = active
          ? THREE.MathUtils.smoothstep(progress, 0.4, 0.64)
          : 0;
        rig.parts.recipeFeedStock.position.z =
          baseZ - feedAdvance * 0.25;
        rig.parts.recipeFeedStock.position.y =
          baseY - feedAdvance * 0.018;
        rig.parts.recipeFeedStock.scale.setScalar(
          1 - feedConsume * 0.38,
        );
        rig.parts.recipeFeedStock.visible = active && feedConsume < 0.98;
      }
      if (rig.parts.recipeProductShuttle) {
        const baseY =
          rig.parts.recipeProductShuttle.userData.baseY ?? 0.49;
        const baseZ =
          rig.parts.recipeProductShuttle.userData.baseZ ?? -0.34;
        const reveal = active
          ? THREE.MathUtils.smoothstep(progress, 0.58, 0.9)
          : 0.25;
        rig.parts.recipeProductShuttle.position.z =
          baseZ - reveal * 0.14;
        rig.parts.recipeProductShuttle.position.y =
          baseY + reveal * 0.025;
        rig.parts.recipeProductShuttle.scale.setScalar(0.9 + reveal * 0.1);
        rig.parts.recipeProductShuttle.visible =
          active || rig.entity.processState === 'output-blocked';
      }
      if (rig.parts.recipeMechanismActuator) {
        const actuation =
          rig.parts.recipeMechanismActuator.userData.actuation;
        if (actuation === 'pick-and-place') {
          const baseY =
            rig.parts.recipeMechanismActuator.userData.baseY ?? 0;
          rig.parts.recipeMechanismActuator.position.y =
            baseY - engaged * 0.09;
        }
      }
      if (rig.parts.recipeMechanismRotor) {
        const actuation =
          rig.parts.recipeMechanismRotor.userData.actuation;
        if (actuation === 'wire-spool') {
          rig.parts.recipeMechanismRotor.rotation.z =
            active ? progress * Math.PI * 2 : 0;
        } else {
          rig.parts.recipeMechanismRotor.rotation.y =
            active ? progress * Math.PI * 2 : 0;
        }
      }
      if (rig.parts.outputGlow) {
        rig.parts.outputGlow.scale.set(
          1 + outputFlash * 0.75,
          1 + outputFlash * 1.5,
          1,
        );
      }
      this.setProcessIntensity(
        rig.parts.outputGlow,
        active ? 0.12 + outputFlash * 1.9 : 0.04,
      );
      if (rig.parts.heroCoreGlow) {
        rig.parts.heroCoreGlow.rotation.y += dt * (active ? 2.2 : 0.35);
        const corePulse = 0.92 + arcFlicker * 0.16 + outputFlash * 0.12;
        rig.parts.heroCoreGlow.scale.setScalar(corePulse);
        this.setProcessIntensity(
          rig.parts.heroCoreGlow,
          active ? 0.65 + arcFlicker * 2.25 + outputFlash * 0.55 : 0.16,
        );
      }
      if (
        active
        && fabricatorRecipe !== 'copperWire'
        && (
          this.progressCrossed(previousProgress, progress, 0.4)
          || this.progressCrossed(previousProgress, progress, 0.66)
        )
      ) {
        this.emitAtRig(rig, 'spark', [0, 0.3, 0]);
      }
      if (active && wrapped) {
        this.emitAtRig(rig, 'spark', [0, 0.28, -0.38]);
        this.emitAtRig(rig, 'mote', [0, 0.24, -0.46]);
      }
      return;
    }

    if (rig.kind === 'generator') {
      const enginePhase = fract(elapsed * 1.7 + rig.phaseOffset);
      const previousEnginePhase = rig.parts.previousAuxPhase;
      rig.parts.previousAuxPhase = enginePhase;
      const crank = Math.sin(enginePhase * Math.PI * 2);
      const compression = Math.abs(crank);
      if (rig.parts.flywheel) {
        if (active) rig.parts.flywheel.rotation.x += dt * 9.4;
        rig.parts.flywheel.position.y = 0.43 + (active ? crank * 0.034 : 0);
        const flywheelPulse = active ? 1 + compression * 0.035 : 1;
        rig.parts.flywheel.scale.setScalar(flywheelPulse);
      }
      const caps = rig.parts.exhaustCaps ?? [];
      const leftLift = active ? Math.max(0, crank) * 0.1 : 0;
      const rightLift = active ? Math.max(0, -crank) * 0.1 : 0;
      if (caps[0]) caps[0].position.y = 0.79 + leftLift;
      if (caps[1]) caps[1].position.y = 0.79 + rightLift;
      if (rig.parts.generatorCoil) {
        const coilScale = active ? 0.94 + compression * 0.16 : 0.94;
        rig.parts.generatorCoil.scale.setScalar(coilScale);
      }
      this.setProcessIntensity(
        rig.parts.generatorCoil,
        active ? 1.15 + compression * 4.9 : 0.1,
      );
      if (
        active
        && this.progressCrossed(previousEnginePhase, enginePhase, 0.08)
      ) {
        this.emitAtRig(rig, 'steam', [-0.24, 0.84, 0.24]);
      }
      if (
        active
        && this.progressCrossed(previousEnginePhase, enginePhase, 0.58)
      ) {
        this.emitAtRig(rig, 'steam', [0.24, 0.84, 0.24]);
      }
      return;
    }

    if (rig.kind === 'storage') {
      if (rig.parts.hatch && active) rig.parts.hatch.rotation.y = Math.sin(elapsed * 0.7 + rig.phaseOffset) * 0.12;
      for (const material of rig.processMaterials) {
        material.emissiveIntensity *= 0.55 + progress * 0.8;
      }
      if (rig.variant === 'uplink') {
        const uplinkSelected = rig.entity.id === this.selectedId;
        const uplinkDockConnected =
          rig.root.userData.uplinkDockConnected === true;
        const dockAttentionPulse =
          0.5
          + Math.sin(elapsed * 2.35 + rig.phaseOffset * Math.PI * 2) * 0.5;
        if (rig.parts.uplinkAzimuthAssembly) {
          const baseYaw =
            rig.parts.uplinkAzimuthAssembly.userData.baseYaw ?? -0.16;
          rig.parts.uplinkAzimuthAssembly.rotation.y = baseYaw;
          rig.parts.uplinkAzimuthAssembly.userData.servoState =
            'parked-awaiting-authorized-manifest';
        }
        if (rig.parts.uplinkElevationAssembly) {
          const baseElevation =
            rig.parts.uplinkElevationAssembly.userData.baseElevation ?? -0.56;
          rig.parts.uplinkElevationAssembly.rotation.x = baseElevation;
          rig.parts.uplinkElevationAssembly.userData.servoState =
            'parked-awaiting-authorized-manifest';
        }
        const normalizeCustodyCount = (value: number | undefined): number => (
          Number.isFinite(value)
            ? THREE.MathUtils.clamp(
                Math.floor(value ?? 0),
                0,
                Number.MAX_SAFE_INTEGER,
              )
            : 0
        );
        const manifestProvided =
          rig.entity.uplinkCustodyManifest !== undefined;
        const custodyManifest = (
          rig.entity.uplinkCustodyManifest ?? []
        ).map((entry) => ({
          kind: entry.kind,
          count: normalizeCustodyCount(entry.count),
          target: entry.target === undefined
            ? undefined
            : normalizeCustodyCount(entry.target),
        }));
        const manifestedCustodyCount = custodyManifest.reduce(
          (total, entry) => Math.min(
            Number.MAX_SAFE_INTEGER,
            total + entry.count,
          ),
          0,
        );
        const custodyCount = manifestProvided
          ? manifestedCustodyCount
          : normalizeCustodyCount(rig.entity.uplinkCustodyCount);
        const transferProgress = THREE.MathUtils.clamp(
          rig.entity.uplinkTransferProgress ?? 0,
          0,
          1,
        );
        const transferKind = rig.entity.uplinkTransferItem;
        const transferReturning =
          rig.entity.uplinkTransferReturning === true;
        const transferPhaseProvided = (
          rig.entity.uplinkTransferProgress !== undefined
          && (transferKind !== undefined || transferReturning)
        );
        const transferSettled = (
          !transferPhaseProvided
          || (!transferReturning && transferProgress >= 0.98)
        );
        const pendingCustodyUnit = (
          transferPhaseProvided
          && !transferReturning
          && transferProgress < 0.88
          && custodyManifest.some(
            (entry) => entry.kind === transferKind && entry.count > 0,
          )
        )
          ? 1
          : 0;
        const securedCustodyCount = Math.max(
          0,
          custodyCount - pendingCustodyUnit,
        );
        const targetedManifest = custodyManifest.filter(
          (entry) => entry.target !== undefined && entry.target > 0,
        );
        const manifestReady = (
          targetedManifest.length > 0
          && targetedManifest.every((entry) => (
            entry.count >= (entry.target ?? Number.MAX_SAFE_INTEGER)
          ))
        );
        const transmissionRequested =
          rig.entity.uplinkTransmissionActive === true;
        const transmissionActive = (
          rig.entity.powered !== false
          && securedCustodyCount >= 1
          && transmissionRequested
          && transferSettled
          && (!manifestProvided || manifestReady)
        );
        // A complete authorization repeats as an authored four-stroke
        // exchange: acquire the real relay, transmit a short packet train,
        // hold for the relay's physical acknowledgement, then return the
        // reflector to park. This gives stable before/on/after witnesses
        // without turning the link into a permanent neon beam.
        const transmissionCycle = transmissionActive
          ? fract((elapsed + rig.phaseOffset * 0.41) / 4.2)
          : 0;
        const transmissionPhase = !transmissionActive
          ? 'standby'
          : transmissionCycle < 0.22
            ? 'servo-acquire'
            : transmissionCycle < 0.68
              ? 'packets-in-transit'
              : transmissionCycle < 0.9
                ? 'relay-acknowledged'
                : 'servo-return';
        const packetsInTransit =
          transmissionPhase === 'packets-in-transit';
        const relayAcknowledged =
          transmissionPhase === 'relay-acknowledged';
        const acknowledgementHeld = (
          relayAcknowledged || transmissionPhase === 'servo-return'
        );
        const linkEnergized = packetsInTransit || acknowledgementHeld;
        rig.root.userData.uplinkTransmissionPhase = transmissionPhase;
        rig.root.userData.uplinkTransmissionCycle = transmissionCycle;
        if (rig.parts.uplinkAcknowledgementLatch) {
          const latch = rig.parts.uplinkAcknowledgementLatch;
          const standbyRotationZ =
            latch.userData.standbyRotationZ ?? 0.5;
          const acknowledgedRotationZ =
            latch.userData.acknowledgedRotationZ ?? -0.5;
          const latchProgress = relayAcknowledged
            ? THREE.MathUtils.smoothstep(transmissionCycle, 0.68, 0.735)
            : acknowledgementHeld
              ? 1
              : 0;
          latch.rotation.z = THREE.MathUtils.lerp(
            standbyRotationZ,
            acknowledgedRotationZ,
            latchProgress,
          );
          latch.userData.acknowledgementProgress = latchProgress;
          latch.userData.transmissionPhase = transmissionPhase;
          latch.userData.mechanicalState = latchProgress >= 0.92
            ? 'physically-engaged-persistent-relay-acknowledged'
            : latchProgress > 0
              ? 'pawl-moving-to-catch'
              : 'standby-unlatched';
        }
        const transmissionStateIndex = transmissionPhase === 'servo-acquire'
          ? 0
          : transmissionPhase === 'packets-in-transit'
            ? 1
            : transmissionPhase === 'relay-acknowledged'
              ? 2
              : -1;
        for (const [index, material] of (
          rig.parts.uplinkTransmissionStateLamps ?? []
        ).entries()) {
          const activeState = index === transmissionStateIndex;
          material.emissiveIntensity = activeState
            ? index === 2
              ? 1.35 + pulse * 0.42
              : 0.72 + pulse * 0.22
            : transmissionActive
              ? 0.11
              : 0.065;
          material.userData.activeState = activeState;
          material.userData.transmissionPhase = transmissionPhase;
        }
        for (const [index, shutter] of (
          rig.parts.uplinkTransmissionShutters ?? []
        ).entries()) {
          const activeState = index === transmissionStateIndex;
          const baseY = shutter.userData.baseY ?? shutter.position.y;
          shutter.position.y = baseY + (activeState ? 0.075 : 0);
          shutter.rotation.z = activeState
            ? (index === 1 ? -0.42 : 0.42)
            : 0;
          shutter.userData.activeState = activeState;
          shutter.userData.transmissionPhase = transmissionPhase;
        }
        if (rig.parts.uplinkAzimuthGear) {
          rig.parts.uplinkAzimuthGear.rotation.y = transmissionPhase
              === 'servo-acquire'
            ? elapsed * 1.45
            : transmissionPhase === 'servo-return'
              ? -elapsed * 0.72
              : transmissionActive
                ? transmissionCycle * 0.38
                : 0;
          rig.parts.uplinkAzimuthGear.userData.servoWitnessPhase =
            transmissionPhase;
        }
        if (rig.parts.uplinkFeedPulse) {
          const feedScale = packetsInTransit
            ? 1.2 + pulse * 0.13
            : relayAcknowledged
              ? 1.32 + pulse * 0.16
            : transmissionActive
              ? 1.06 + pulse * 0.035
              : uplinkSelected || !uplinkDockConnected
                ? 1.04 + dockAttentionPulse * 0.045
                : 0.98 + dockAttentionPulse * 0.025;
          rig.parts.uplinkFeedPulse.scale.setScalar(feedScale);
          rig.parts.uplinkFeedPulse.userData.transmissionActive =
            transmissionActive;
          rig.parts.uplinkFeedPulse.userData.transmissionPhase =
            transmissionPhase;
          rig.parts.uplinkFeedPulse.userData.custodyCount = custodyCount;
          rig.parts.uplinkFeedPulse.userData.securedCustodyCount =
            securedCustodyCount;
          rig.parts.uplinkFeedPulse.userData.manifestReady = manifestReady;
        }
        const mechanicalProgress = transferPhaseProvided
          ? transferReturning
            ? 1 - transferProgress
            : transferProgress
          : 0;
        if (rig.parts.uplinkTransferCarriage) {
          const outboardZ =
            rig.parts.uplinkTransferCarriage.userData.outboardZ ?? 0.92;
          const inboardZ =
            rig.parts.uplinkTransferCarriage.userData.inboardZ ?? -1.18;
          rig.parts.uplinkTransferCarriage.position.z = THREE.MathUtils.lerp(
            outboardZ,
            inboardZ,
            mechanicalProgress,
          );
          const liftArc = Math.sin(mechanicalProgress * Math.PI);
          rig.parts.uplinkTransferCarriage.position.y =
            0.34 + liftArc * (transferReturning ? 0.16 : 0.28);
          rig.parts.uplinkTransferCarriage.rotation.x =
            (transferReturning ? -1 : 1) * liftArc * 0.055;
          rig.parts.uplinkTransferCarriage.userData.transferProgress =
            mechanicalProgress;
          rig.parts.uplinkTransferCarriage.userData.mechanicalState =
            transferReturning
              ? transferProgress >= 0.98
                ? 'ready-at-belt-interface'
                : 'returning-empty-to-belt-interface'
              : mechanicalProgress < 0.15
                ? 'accepting-at-belt-interface'
                : mechanicalProgress < 0.72
                  ? 'payload-seated-in-bounded-cradle'
                  : mechanicalProgress < 0.88
                    ? 'carriage-entering-custody-chamber'
                  : 'seated-inside-interlock';
          rig.parts.uplinkTransferCarriage.userData.returning =
            transferReturning;
        }
        const carriageZ =
          rig.parts.uplinkTransferCarriage?.position.z ?? 0.55;
        const shuttlePinion =
          rig.parts.uplinkTransferRail?.userData.shuttlePinion;
        if (shuttlePinion instanceof THREE.Object3D) {
          shuttlePinion.rotation.x =
            mechanicalProgress * Math.PI * 4.4;
          shuttlePinion.userData.transferProgress = mechanicalProgress;
        }
        if (rig.parts.uplinkTransferActuatorRod) {
          const anchorZ =
            rig.parts.uplinkTransferActuatorRod.userData.anchorZ ?? -0.55;
          const rodLength = Math.max(0.08, Math.abs(carriageZ - anchorZ));
          rig.parts.uplinkTransferActuatorRod.position.z =
            (anchorZ + carriageZ) * 0.5;
          rig.parts.uplinkTransferActuatorRod.scale.y = rodLength;
          rig.parts.uplinkTransferActuatorRod.userData.extension =
            rodLength;
          rig.parts.uplinkTransferActuatorRod.userData.carriageZ =
            carriageZ;
        }
        const jawClosure = THREE.MathUtils.smoothstep(
          mechanicalProgress,
          0.08,
          0.55,
        );
        const clampClosure = transferReturning
          ? 0
          : transferPhaseProvided
            ? THREE.MathUtils.smoothstep(transferProgress, 0.035, 0.16)
            : 0;
        for (const clamp of rig.parts.uplinkTransferClamps ?? []) {
          const openX = clamp.userData.openX ?? clamp.position.x;
          const closedX = clamp.userData.closedX ?? clamp.position.x;
          clamp.position.x = THREE.MathUtils.lerp(
            openX,
            closedX,
            clampClosure,
          );
          const side = clamp.userData.side ?? 1;
          clamp.rotation.z = side * (1 - clampClosure) * 0.28;
          clamp.userData.closure = clampClosure;
          clamp.userData.mechanicalState = clampClosure >= 0.92
            ? 'cassette-clamped-for-transfer'
            : clampClosure > 0.08
              ? 'closing-on-belt-end-cassette'
              : 'open-at-belt-end';
        }
        const [leftArm, rightArm] = rig.parts.uplinkTransferArms ?? [];
        if (leftArm) {
          leftArm.rotation.y = 0.62 * (1 - jawClosure);
          leftArm.rotation.z = -0.18 * jawClosure;
        }
        if (rightArm) {
          rightArm.rotation.y = -0.62 * (1 - jawClosure);
          rightArm.rotation.z = 0.18 * jawClosure;
        }
        const [leftJaw, rightJaw] = rig.parts.uplinkTransferJaws ?? [];
        if (leftJaw) leftJaw.position.x = 0.16 - jawClosure * 0.11;
        if (rightJaw) rightJaw.position.x = -0.16 + jawClosure * 0.11;
        for (const scissor of rig.parts.uplinkTransferScissors ?? []) {
          scissor.scale.y = 0.76 + Math.sin(mechanicalProgress * Math.PI) * 0.72;
          scissor.rotation.z =
            (scissor.userData.side ?? 1)
            * (0.08 + Math.sin(mechanicalProgress * Math.PI) * 0.11);
        }
        for (const variant of (
          rig.parts.uplinkTransferPayloadVariants?.values() ?? []
        )) {
          variant.visible = false;
          variant.position.set(
            0,
            variant.userData.mountBaseY ?? 0,
            0,
          );
          variant.rotation.set(0, 0, 0);
        }
        const transferVariant = transferKind === undefined
          ? undefined
          : rig.parts.uplinkTransferPayloadVariants?.get(transferKind);
        const transferPayloadVisible = (
          transferPhaseProvided
          && !transferReturning
          && transferProgress >= 0.04
          && transferVariant !== undefined
        );
        if (rig.parts.uplinkTransferPayloadCarrier) {
          rig.parts.uplinkTransferPayloadCarrier.userData.occupied =
            transferPayloadVisible;
          rig.parts.uplinkTransferPayloadCarrier.userData.itemKind =
            transferPayloadVisible ? transferKind : null;
          rig.parts.uplinkTransferPayloadCarrier.userData.carriageZ =
            carriageZ;
          rig.parts.uplinkTransferPayloadCarrier.userData.mechanicalState =
            rig.parts.uplinkTransferCarriage?.userData.mechanicalState
            ?? 'accepting-at-belt-interface';
        }
        if (rig.parts.uplinkTransferPayload) {
          rig.parts.uplinkTransferPayload.visible = transferPayloadVisible;
          rig.parts.uplinkTransferPayload.userData.itemKind =
            transferPayloadVisible ? transferKind : null;
          rig.parts.uplinkTransferPayload.userData.transferProgress =
            transferProgress;
          rig.parts.uplinkTransferPayload.userData.returning =
            transferReturning;
        }
        if (transferVariant) transferVariant.visible = transferPayloadVisible;
        if (transferVariant && transferPayloadVisible) {
          const mountBaseY = transferVariant.userData.mountBaseY ?? 0;
          const payloadSettle = THREE.MathUtils.smoothstep(
            transferProgress,
            0.04,
            0.2,
          );
          const carrierAlignedIronPlate =
            transferKind === 'ironPlate';
          transferVariant.rotation.x =
            carrierAlignedIronPlate ? 0 : -0.08;
          transferVariant.rotation.y = carrierAlignedIronPlate
            ? Math.PI / 2
            : 0.14
              + (1 - payloadSettle) * 0.24
              + Math.sin(elapsed * 2.4 + rig.phaseOffset) * 0.018;
          transferVariant.position.y =
            mountBaseY
            + (1 - payloadSettle)
              * (carrierAlignedIronPlate ? 0.05 : 0.16)
            + Math.sin(mechanicalProgress * Math.PI)
              * (carrierAlignedIronPlate ? 0.025 : 0.06);
          transferVariant.userData.carrierAligned =
            carrierAlignedIronPlate;
        }
        if (rig.parts.uplinkCarrierStatusMaterial) {
          const carrierPhase = transferReturning
            ? 'empty-return-blue'
            : !transferPhaseProvided
              ? securedCustodyCount >= 1
                ? 'custody-secured-teal'
                : 'dock-ready-amber'
              : transferProgress < 0.15
                ? 'approach-amber'
                : transferProgress < 0.88
                  ? 'loaded-travel-orange'
                  : 'interlock-cyan';
          const carrierColor = carrierPhase === 'empty-return-blue'
            ? '#75b9e8'
            : carrierPhase === 'custody-secured-teal'
                || carrierPhase === 'interlock-cyan'
              ? '#76e1d2'
              : carrierPhase === 'loaded-travel-orange'
                ? '#f4a23c'
                : '#e9bf5f';
          const carrierEmissive = carrierPhase === 'empty-return-blue'
            ? '#2b7fc4'
            : carrierPhase === 'custody-secured-teal'
                || carrierPhase === 'interlock-cyan'
              ? '#2fd6c0'
              : '#df7d28';
          rig.parts.uplinkCarrierStatusMaterial.color.set(carrierColor);
          rig.parts.uplinkCarrierStatusMaterial.emissive.set(
            carrierEmissive,
          );
          rig.parts.uplinkCarrierStatusMaterial.emissiveIntensity =
            transferPhaseProvided
              ? 0.46 + pulse * 0.18
              : 0.2 + pulse * 0.08;
          rig.parts.uplinkCarrierStatusMaterial.userData.phase =
            carrierPhase;
          rig.parts.uplinkCarrierStatusMaterial.userData.loaded =
            transferPayloadVisible;
        }
        if (rig.parts.uplinkCavityLightMaterial) {
          const receiving = (
            transferPhaseProvided
            && !transferReturning
            && transferProgress >= 0.15
            && transferProgress < 0.98
          );
          const openingEmpty = transferReturning && transferProgress < 0.98;
          rig.parts.uplinkCavityLightMaterial.color.set(
            receiving
              ? '#ffd17a'
              : openingEmpty
                ? '#8fc9e8'
                : securedCustodyCount >= 1
                  ? '#8de4d4'
                  : '#d9bd82',
          );
          rig.parts.uplinkCavityLightMaterial.emissive.set(
            receiving
              ? '#f18a2c'
              : openingEmpty
                ? '#327eaf'
                : securedCustodyCount >= 1
                  ? '#32c7b6'
                  : '#b17a35',
          );
          rig.parts.uplinkCavityLightMaterial.emissiveIntensity =
            receiving || openingEmpty
              ? 0.26 + pulse * 0.08
              : 0.16 + pulse * 0.05;
          rig.parts.uplinkCavityLightMaterial.userData.phase = receiving
            ? 'receiving-lit-amber'
            : openingEmpty
              ? 'opening-empty-blue'
              : securedCustodyCount >= 1
                ? 'secured-teal'
                : 'standby-warm';
        }

        const securedManifest = custodyManifest
          .map((entry) => ({
            ...entry,
            count: entry.kind === transferKind
              ? Math.max(
                  0,
                  entry.count - Math.max(
                    pendingCustodyUnit,
                    transferPayloadVisible ? 1 : 0,
                  ),
                )
              : entry.count,
          }))
          .filter((entry) => entry.count > 0);
        const activeCustodyItems: THREE.Object3D[] = [];
        for (const [
          slotIndex,
          variants,
        ] of (rig.parts.uplinkCustodySlotVariants ?? []).entries()) {
          for (const variant of variants.values()) {
            variant.visible = false;
            variant.position.set(0, 0, 0);
            variant.scale.setScalar(variant.userData.mountScale ?? 2.8);
          }
          const manifestEntries = securedManifest.filter(
            (_, entryIndex) => entryIndex % 3 === slotIndex,
          );
          const slot = rig.parts.uplinkCustodySlots?.[slotIndex];
          if (slot) {
            slot.userData.itemKind = manifestEntries[0]?.kind ?? null;
            slot.userData.itemKinds =
              manifestEntries.map((entry) => entry.kind);
            slot.userData.count = manifestEntries.reduce(
              (total, entry) => Math.min(
                Number.MAX_SAFE_INTEGER,
                total + entry.count,
              ),
              0,
            );
            slot.userData.counts =
              manifestEntries.map((entry) => entry.count);
            slot.userData.target = manifestEntries[0]?.target ?? null;
          }
          const countIndicator =
            rig.parts.uplinkCustodyCountIndicators?.[slotIndex];
          if (countIndicator) {
            const slotCount = manifestEntries.reduce(
              (total, entry) => Math.min(
                Number.MAX_SAFE_INTEGER,
                total + entry.count,
              ),
              0,
            );
            countIndicator.visible = slotCount > 0;
            countIndicator.userData.count = slotCount;
            countIndicator.userData.itemKinds =
              manifestEntries.map((entry) => entry.kind);
            countIndicator.userData.custodySecured = slotCount > 0;
          }
          const occupancy = manifestEntries.length;
          for (const [entryIndex, manifestEntry] of (
            manifestEntries.slice(0, 4)
          ).entries()) {
            const activeVariant = variants.get(manifestEntry.kind);
            if (!activeVariant) continue;
            const crowdedScale = occupancy <= 1
              ? 1.65
              : occupancy === 2
                ? 0.96
                : occupancy === 3
                  ? 0.68
                  : 0.52;
            const offsets = occupancy <= 1
              ? [[0, 0]]
              : occupancy === 2
                ? [[-0.06, 0], [0.06, 0]]
                : occupancy === 3
                  ? [[-0.055, 0.04], [0.055, 0.04], [0, -0.05]]
                  : [
                      [-0.056, 0.045],
                      [0.056, 0.045],
                      [-0.056, -0.045],
                      [0.056, -0.045],
                    ];
            const offset = offsets[entryIndex] ?? [0, 0];
            activeVariant.position.set(offset[0] ?? 0, 0, offset[1] ?? 0);
            activeVariant.scale.setScalar(crowdedScale);
            activeVariant.visible = true;
            activeVariant.userData.count = manifestEntry.count;
            activeVariant.userData.target = manifestEntry.target ?? null;
            activeCustodyItems.push(activeVariant);
          }
        }
        rig.parts.uplinkCustodyItems = activeCustodyItems;
        const chamberClosure = transferReturning
          ? 1 - THREE.MathUtils.smoothstep(transferProgress, 0.04, 0.45)
          : transferPhaseProvided
            ? THREE.MathUtils.smoothstep(mechanicalProgress, 0.72, 0.98)
            : securedCustodyCount >= 1
              ? 1
              : 0;
        if (rig.parts.uplinkCustodyBuffer) {
          rig.parts.uplinkCustodyBuffer.visible = chamberClosure < 0.94;
          rig.parts.uplinkCustodyBuffer.userData.contentsOccludedByArmor =
            chamberClosure >= 0.94;
          rig.parts.uplinkCustodyBuffer.userData.authoritativeItemCount =
            activeCustodyItems.length;
        }
        for (const door of rig.parts.uplinkCustodyDoors ?? []) {
          const openX = door.userData.openX ?? door.position.x;
          const closedX = door.userData.closedX ?? door.position.x;
          door.position.x = THREE.MathUtils.lerp(
            openX,
            closedX,
            chamberClosure,
          );
          door.userData.closure = chamberClosure;
          door.userData.interlockEngaged = chamberClosure >= 0.98;
        }
        if (rig.parts.uplinkCustodySeal) {
          const openRotationX =
            rig.parts.uplinkCustodySeal.userData.openRotationX ?? -1.12;
          const closedRotationX =
            rig.parts.uplinkCustodySeal.userData.closedRotationX ?? 0;
          rig.parts.uplinkCustodySeal.rotation.x = THREE.MathUtils.lerp(
            openRotationX,
            closedRotationX,
            chamberClosure,
          );
          rig.parts.uplinkCustodySeal.position.y =
            0.9 + Math.sin(chamberClosure * Math.PI) * 0.08;
          rig.parts.uplinkCustodySeal.userData.closure = chamberClosure;
          rig.parts.uplinkCustodySeal.userData.pressureState =
            chamberClosure >= 0.98 && securedCustodyCount >= 1
              ? 'sealed-and-pressurized'
              : chamberClosure <= 0.08
                ? 'open-for-carriage'
                : 'cycling-pressure-lid';
        }
        for (const lockingBar of (
          rig.parts.uplinkCustodyLockingBars ?? []
        )) {
          const openRotationZ =
            lockingBar.userData.openRotationZ ?? lockingBar.rotation.z;
          const closedRotationZ =
            lockingBar.userData.closedRotationZ ?? 0;
          lockingBar.rotation.z = THREE.MathUtils.lerp(
            openRotationZ,
            closedRotationZ,
            chamberClosure,
          );
          lockingBar.userData.closure = chamberClosure;
        }
        if (rig.parts.uplinkCustodyVaultContents) {
          const capsuleVisible = (
            securedCustodyCount >= 1
            && chamberClosure >= 0.62
          );
          rig.parts.uplinkCustodyVaultContents.visible = capsuleVisible;
          rig.parts.uplinkCustodyVaultContents.scale.setScalar(
            capsuleVisible
              ? 0.96 + pulse * 0.025
              : 0.88,
          );
          rig.parts.uplinkCustodyVaultContents.userData.securedCount =
            securedCustodyCount;
          rig.parts.uplinkCustodyVaultContents.userData.pressurized =
            capsuleVisible && chamberClosure >= 0.98;
        }
        if (rig.parts.uplinkCustodyPressureMaterial) {
          const pressurized = (
            chamberClosure >= 0.98
            && securedCustodyCount >= 1
          );
          rig.parts.uplinkCustodyPressureMaterial.color.set(
            pressurized ? '#79ead3' : '#e0ad53',
          );
          rig.parts.uplinkCustodyPressureMaterial.emissive.set(
            pressurized ? '#2fd6be' : '#bd6b27',
          );
          rig.parts.uplinkCustodyPressureMaterial.emissiveIntensity =
            pressurized
              ? 0.48 + pulse * 0.16
              : 0.14 + pulse * 0.06;
          rig.parts.uplinkCustodyPressureMaterial.userData.pressurized =
            pressurized;
        }
        const canopyClosure = transferReturning
          ? 1 - THREE.MathUtils.smoothstep(transferProgress, 0.08, 0.82)
          : transferPhaseProvided
            ? THREE.MathUtils.smoothstep(transferProgress, 0.08, 0.82)
            : securedCustodyCount >= 1
              ? 1
              : 0;
        if (rig.parts.uplinkIntakeCanopy) {
          const openRotationX =
            rig.parts.uplinkIntakeCanopy.userData.openRotationX ?? -1.12;
          const closedRotationX =
            rig.parts.uplinkIntakeCanopy.userData.closedRotationX ?? -0.08;
          rig.parts.uplinkIntakeCanopy.rotation.x = THREE.MathUtils.lerp(
            openRotationX,
            closedRotationX,
            canopyClosure,
          );
          rig.parts.uplinkIntakeCanopy.userData.closure = canopyClosure;
          rig.parts.uplinkIntakeCanopy.userData.captureState =
            canopyClosure >= 0.92
              ? 'closed-over-captured-payload'
              : canopyClosure <= 0.08
                ? 'open-to-belt-contact'
                : 'closing-over-transfer-carriage';
        }
        if (rig.parts.uplinkCustodyChamber) {
          rig.parts.uplinkCustodyChamber.userData.receiverState =
            chamberClosure >= 0.98 && securedCustodyCount >= 1
              ? 'closed-occupied-custody-secured'
              : transferReturning
                ? transferProgress >= 0.98
                  ? 'open-empty-ready'
                  : 'opening-empty-return'
                : transferPhaseProvided
                  ? transferProgress < 0.15
                    ? 'open-accepting-from-belt'
                    : 'open-receiving-payload'
                  : securedCustodyCount >= 1
                    ? 'closed-occupied-custody-secured'
                    : 'open-empty-ready';
          rig.parts.uplinkCustodyChamber.userData.doorClosure =
            chamberClosure;
          rig.parts.uplinkCustodyChamber.userData.securedCustodyCount =
            securedCustodyCount;
        }
        if (rig.parts.uplinkCargoGate) {
          const gateLatch = transferReturning
            ? 1 - THREE.MathUtils.smoothstep(transferProgress, 0.05, 0.42)
            : (
                securedCustodyCount >= 1
                && transferPhaseProvided
                && transferProgress >= 0.98
              )
              ? 1
              : THREE.MathUtils.smoothstep(
                  mechanicalProgress,
                  0.7,
                  1,
                );
          rig.parts.uplinkCargoGate.rotation.x = THREE.MathUtils.lerp(
            -1.02,
            -0.02,
            gateLatch,
          );
          rig.parts.uplinkCargoGate.userData.interlockState =
            transferReturning
              ? transferProgress >= 0.98
                ? 'open-ready'
                : 'open-empty-return'
              : securedCustodyCount >= 1
                && transferPhaseProvided
                && transferProgress >= 0.98
              ? 'latched-custody-secured'
              : transferPhaseProvided
                && transferProgress >= 0.18
                && transferProgress < 0.88
                ? 'open-transfer-in-progress'
                : 'open-ready';
        }
        for (const indicator of rig.parts.uplinkSelectionIndicators ?? []) {
          indicator.visible = uplinkSelected;
        }
        if (rig.parts.uplinkEffectMaterial) {
          rig.parts.uplinkEffectMaterial.emissiveIntensity = uplinkSelected
            ? 1.25 + dockAttentionPulse * 0.38
            : 0.025;
          rig.parts.uplinkEffectMaterial.opacity = uplinkSelected
            ? 0.76
            : 0.16;
        }
        if (rig.parts.uplinkDockGuideMaterial) {
          const connectedColor = '#a7f1b7';
          const awaitingColor = '#b6fff3';
          const connectedEmissive = '#39cb78';
          const awaitingEmissive = '#2bdcc7';
          rig.parts.uplinkDockGuideMaterial.color.set(
            uplinkDockConnected ? connectedColor : awaitingColor,
          );
          rig.parts.uplinkDockGuideMaterial.emissive.set(
            uplinkDockConnected ? connectedEmissive : awaitingEmissive,
          );
          rig.parts.uplinkDockGuideMaterial.emissiveIntensity =
            uplinkDockConnected
              ? uplinkSelected
                ? 1.45 + dockAttentionPulse * 0.25
                : 0.88 + dockAttentionPulse * 0.08
              : uplinkSelected
                ? 1.65 + dockAttentionPulse * 0.3
                : 1.32 + dockAttentionPulse * 0.16;
          rig.parts.uplinkDockGuideMaterial.opacity =
            uplinkDockConnected
              ? uplinkSelected ? 0.94 : 0.78
              : 0.94;
          rig.parts.uplinkDockGuideMaterial.userData.visualState =
            uplinkDockConnected
              ? 'connected-secured-route-green'
              : 'awaiting-canonical-dock-belt-cyan';
        }
        if (rig.parts.uplinkDockBeaconMaterial) {
          rig.parts.uplinkDockBeaconMaterial.color.set(
            uplinkDockConnected ? '#9be7ad' : '#9cecdf',
          );
          rig.parts.uplinkDockBeaconMaterial.emissive.set(
            uplinkDockConnected ? '#2eb86b' : '#25bfae',
          );
          rig.parts.uplinkDockBeaconMaterial.emissiveIntensity =
            uplinkDockConnected
              ? uplinkSelected
                ? 0.92 + dockAttentionPulse * 0.16
                : 0.48 + dockAttentionPulse * 0.06
              : uplinkSelected
                ? 1.08 + dockAttentionPulse * 0.18
                : 0.72 + dockAttentionPulse * 0.1;
          rig.parts.uplinkDockBeaconMaterial.opacity =
            uplinkSelected ? 0.9 : 0.82;
          rig.parts.uplinkDockBeaconMaterial.userData.visualState =
            uplinkDockConnected
              ? 'connected-secured-route-green-subordinate-beacons'
              : 'awaiting-canonical-dock-belt-cyan-subordinate-beacons';
        }
        if (rig.parts.uplinkDockGuide) {
          rig.parts.uplinkDockGuide.userData.visualState =
            uplinkDockConnected
              ? 'connected-secured-route-green'
              : 'awaiting-canonical-dock-belt-cyan';
          rig.parts.uplinkDockGuide.userData.selected = uplinkSelected;
          rig.parts.uplinkDockGuide.userData.attentionPulse =
            dockAttentionPulse;
          rig.parts.uplinkDockGuide.userData.readabilityMode =
            uplinkSelected || !uplinkDockConnected
              ? 'attention-bright'
              : 'connected-steady';
        }
        if (rig.parts.uplinkDockHoverChevrons) {
          rig.parts.uplinkDockHoverChevrons.visible = !uplinkDockConnected;
          rig.parts.uplinkDockHoverChevrons.userData.visualState =
            uplinkDockConnected
              ? 'hidden-for-authoritative-belt-cargo'
              : 'raised-cyan-inbound-guidance';
          rig.parts.uplinkDockHoverChevrons.userData.connected =
            uplinkDockConnected;
        }
        if (rig.parts.uplinkDockBeaconLight) {
          rig.parts.uplinkDockBeaconLight.color.set(
            uplinkDockConnected ? '#51dd8a' : '#39e5cf',
          );
          rig.parts.uplinkDockBeaconLight.intensity =
            uplinkDockConnected
              ? uplinkSelected
                ? 1.05 + dockAttentionPulse * 0.18
                : 0.42 + dockAttentionPulse * 0.08
              : uplinkSelected
                ? 1.45 + dockAttentionPulse * 0.25
                : 0.78 + dockAttentionPulse * 0.16;
          rig.parts.uplinkDockBeaconLight.userData.visualState =
            uplinkDockConnected
              ? 'connected-secured-route-green'
              : 'awaiting-canonical-dock-belt-cyan';
        }
        if (rig.parts.uplinkSignalMaterial) {
          rig.parts.uplinkSignalMaterial.emissiveIntensity =
            uplinkSelected ? 0.72 + pulse * 0.22 : 0.28;
        }
        if (rig.parts.uplinkLinkMaterial) {
          rig.parts.uplinkLinkMaterial.emissiveIntensity =
            packetsInTransit
              ? 3.1 + pulse * 0.68
              : relayAcknowledged
                ? 2.55 + pulse * 0.5
                : transmissionActive
                  ? 1.95 + pulse * 0.34
                  : uplinkSelected || !uplinkDockConnected
                    ? 1.65 + dockAttentionPulse * 0.3
                    : 1.08 + dockAttentionPulse * 0.12;
          rig.parts.uplinkLinkMaterial.opacity =
            packetsInTransit
              ? 0.96
              : relayAcknowledged
                ? 0.9
                : transmissionActive
                  ? 0.84
                  : uplinkSelected || !uplinkDockConnected
                    ? 0.76
                    : 0.62;
          rig.parts.uplinkLinkMaterial.userData.readabilityState =
            transmissionActive
              ? transmissionPhase
              : uplinkSelected || !uplinkDockConnected
                ? 'standby-attention-visible'
                : 'standby-connected-visible';
        }
        if (rig.parts.uplinkCustodyFeed) {
          rig.parts.uplinkCustodyFeed.userData.transmissionActive =
            transmissionActive;
          rig.parts.uplinkCustodyFeed.userData.transmissionPhase =
            transmissionPhase;
          rig.parts.uplinkCustodyFeed.userData.coupling =
            packetsInTransit
              ? 'custody-to-dish-discharging-packets'
              : relayAcknowledged
                ? 'custody-to-dish-relay-acknowledged'
                : transmissionActive
                  ? 'custody-to-dish-servo-authorized'
              : 'custody-to-dish-standby';
        }
        if (rig.parts.uplinkCustodyFeedMaterial) {
          rig.parts.uplinkCustodyFeedMaterial.emissiveIntensity =
            packetsInTransit
              ? 0.34 + pulse * 0.14
              : relayAcknowledged
                ? 0.2 + pulse * 0.06
                : transmissionActive
                  ? 0.09 + pulse * 0.025
                  : 0.035;
          rig.parts.uplinkCustodyFeedMaterial.opacity =
            packetsInTransit
              ? 0.38
              : relayAcknowledged
                ? 0.3
                : transmissionActive
                  ? 0.24
                  : 0.2;
        }
        if (rig.parts.uplinkTransmissionCapacitorMaterial) {
          rig.parts.uplinkTransmissionCapacitorMaterial.color.set(
            packetsInTransit
              ? '#87f3dd'
              : relayAcknowledged
                ? '#87c9bd'
                : transmissionActive
                  ? '#87aa9f'
                  : '#799b93',
          );
          rig.parts.uplinkTransmissionCapacitorMaterial.emissive.set(
            packetsInTransit
              ? '#2fe2c7'
              : relayAcknowledged
                ? '#2a9b89'
                : transmissionActive
                  ? '#2a7469'
                  : '#2f8e82',
          );
          rig.parts.uplinkTransmissionCapacitorMaterial.emissiveIntensity =
            packetsInTransit
              ? 0.66 + pulse * 0.22
              : relayAcknowledged
                ? 0.36 + pulse * 0.1
                : transmissionActive
                  ? 0.24 + pulse * 0.06
              : securedCustodyCount >= 1
                ? 0.2 + pulse * 0.07
                : 0.055;
          rig.parts.uplinkTransmissionCapacitorMaterial.userData
            .transmissionActive = transmissionActive;
          rig.parts.uplinkTransmissionCapacitorMaterial.userData
            .transmissionPhase = transmissionPhase;
        }
        if (rig.parts.uplinkTransmissionCapacitor) {
          const witnessRing =
            rig.parts.uplinkTransmissionCapacitor.userData.witnessRing;
          if (witnessRing instanceof THREE.Object3D) {
            const witnessBaseY =
              witnessRing.userData.transmissionWitnessBaseY
              ?? witnessRing.position.y;
            witnessRing.userData.transmissionWitnessBaseY = witnessBaseY;
            witnessRing.position.y = witnessBaseY
              + (packetsInTransit ? 0.11 : relayAcknowledged ? 0.045 : 0);
            witnessRing.rotation.y = packetsInTransit
              ? elapsed * 2.8
              : relayAcknowledged
                ? elapsed * 0.7
                : elapsed * 0.16;
            const chargeScale = packetsInTransit
              ? 0.94 + pulse * 0.08
              : relayAcknowledged
                ? 1.04 + pulse * 0.035
                : 0.94;
            witnessRing.scale.setScalar(chargeScale);
          }
          rig.parts.uplinkTransmissionCapacitor.userData.conversionState =
            packetsInTransit
              ? 'discharging-secured-manifest-to-waveguide'
              : relayAcknowledged
                ? 'relay-acknowledged-holding-sealed-custody'
                : transmissionActive
                  ? 'authorized-and-servo-acquiring'
              : securedCustodyCount >= 1
                ? 'charged-awaiting-complete-manifest'
                : 'standby-empty';
          rig.parts.uplinkTransmissionCapacitor.userData.transmissionPhase =
            transmissionPhase;
        }
        let receiverRig: EntityRig | undefined;
        let receiverDistanceSquared = Number.POSITIVE_INFINITY;
        const uplinkWorld = rig.root.getWorldPosition(new THREE.Vector3());
        for (const candidate of this.entityObjects.values()) {
          if (candidate.kind === 'gridRelay') {
            candidate.root.userData.uplinkReceptionActive = false;
            candidate.root.userData.uplinkReceptionPhase = 'standby';
            candidate.root.userData.uplinkReceptionSourceEntityId = null;
            candidate.root.userData.uplinkReceptionProgress = 0;
            candidate.root.userData.uplinkAcknowledgementHeld = false;
          }
          if (
            candidate === rig
            || candidate.kind !== 'gridRelay'
            || candidate.entity.powered === false
            || candidate.entity.powerNetworkId === null
          ) continue;
          const candidateWorld = candidate.root.getWorldPosition(
            new THREE.Vector3(),
          );
          const dx = candidateWorld.x - uplinkWorld.x;
          const dz = candidateWorld.z - uplinkWorld.z;
          const distanceSquared = dx * dx + dz * dz;
          if (
            distanceSquared <= 144
            && distanceSquared < receiverDistanceSquared
          ) {
            receiverRig = candidate;
            receiverDistanceSquared = distanceSquared;
          }
        }
        let receiverWorld: THREE.Vector3 | undefined;
        if (receiverRig) {
          receiverWorld = receiverRig.root.localToWorld(
            new THREE.Vector3(0, POWER_GRID_TERMINAL_HEIGHT + 0.3, 0),
          );
          receiverRig.root.userData.uplinkReceptionActive = linkEnergized;
          receiverRig.root.userData.uplinkReceptionPhase =
            transmissionPhase;
          receiverRig.root.userData.uplinkReceptionSourceEntityId =
            rig.entity.id;
            receiverRig.root.userData.uplinkReceptionProgress =
            packetsInTransit
              ? THREE.MathUtils.clamp(
                  (transmissionCycle - 0.22) / 0.46,
                  0,
                  1,
                )
              : relayAcknowledged
                ? THREE.MathUtils.clamp(
                    (transmissionCycle - 0.68) / 0.22,
                    0,
                    1,
                  )
                : 0;
          receiverRig.root.userData.uplinkAcknowledgementHeld =
            acknowledgementHeld;
        }
        if (
          transmissionActive
          && receiverWorld
          && receiverRig
          && rig.parts.uplinkAzimuthAssembly
          && rig.parts.uplinkElevationAssembly
        ) {
          // Solve the two physical axes so the reflector visibly commits to
          // the same receiver that terminates the packet stream.
          const targetInRoot = rig.root.worldToLocal(receiverWorld.clone());
          const azimuth = rig.parts.uplinkAzimuthAssembly;
          const elevation = rig.parts.uplinkElevationAssembly;
          const pivotInRoot = new THREE.Vector3(
            azimuth.position.x,
            azimuth.position.y
              + elevation.position.y * azimuth.scale.y,
            azimuth.position.z,
          );
          const aimX = targetInRoot.x - pivotInRoot.x;
          const aimZ = targetInRoot.z - pivotInRoot.z;
          const aimYaw = Math.atan2(aimX, aimZ);
          const pivotWorld = elevation.getWorldPosition(new THREE.Vector3());
          const horizontalWorld = Math.max(
            0.01,
            Math.hypot(
              receiverWorld.x - pivotWorld.x,
              receiverWorld.z - pivotWorld.z,
            ),
          );
          const verticalWorld = receiverWorld.y - pivotWorld.y;
          const targetElevation = THREE.MathUtils.clamp(
            -Math.atan2(verticalWorld, horizontalWorld),
            -0.74,
            0.52,
          );
          const servoBlend = transmissionCycle < 0.22
            ? THREE.MathUtils.smoothstep(transmissionCycle, 0.025, 0.2)
            : transmissionCycle < 0.9
              ? 1
              : 1 - THREE.MathUtils.smoothstep(
                  transmissionCycle,
                  0.91,
                  0.99,
                );
          const baseYaw = azimuth.userData.baseYaw ?? -0.52;
          const baseElevation =
            elevation.userData.baseElevation ?? -0.42;
          azimuth.rotation.y = THREE.MathUtils.lerp(
            baseYaw,
            aimYaw,
            servoBlend,
          );
          elevation.rotation.x = THREE.MathUtils.lerp(
            baseElevation,
            targetElevation,
            servoBlend,
          );
          azimuth.userData.targetEntityId = receiverRig.entity.id;
          azimuth.userData.servoBlend = servoBlend;
          azimuth.userData.servoState = transmissionPhase;
          elevation.userData.targetElevation = targetElevation;
          elevation.userData.servoBlend = servoBlend;
          elevation.userData.servoState = transmissionPhase;
        }
        if (rig.parts.uplinkOutgoingBeam) {
          const outgoingBeam = rig.parts.uplinkOutgoingBeam;
          outgoingBeam.visible = packetsInTransit;
          outgoingBeam.userData.transmissionActive =
            transmissionActive;
          outgoingBeam.userData.transmissionPhase =
            transmissionPhase;
          outgoingBeam.userData.packetsInTransit = packetsInTransit;
          outgoingBeam.userData.relayAcknowledged = relayAcknowledged;
          outgoingBeam.userData.custodyAuthorized =
            securedCustodyCount >= 1;
          const feedEmitter = rig.parts.uplinkFeedPulse?.getObjectByName(
            'commission-uplink-feed-lock-emitter-disk',
          ) ?? rig.parts.uplinkFeedPulse;
          const emitterWorld = feedEmitter?.getWorldPosition(
            new THREE.Vector3(),
          );
          if (!receiverWorld && rig.parts.uplinkElevationAssembly) {
            receiverWorld = rig.parts.uplinkElevationAssembly.localToWorld(
              new THREE.Vector3(0, 0, 3.15),
            );
          }
          if (emitterWorld && receiverWorld) {
            const emitterLocal = rig.root.worldToLocal(emitterWorld.clone());
            const receiverLocal = rig.root.worldToLocal(receiverWorld.clone());
            const path = receiverLocal.clone().sub(emitterLocal);
            const pathLength = Math.max(0.01, path.length());
            const beamPulse = packetsInTransit
              ? 0.94 + pulse * 0.1
              : 1;
            outgoingBeam.position.copy(emitterLocal);
            outgoingBeam.quaternion.setFromUnitVectors(
              UNIT_Y,
              path.normalize(),
            );
            outgoingBeam.scale.set(beamPulse, pathLength, beamPulse);
            outgoingBeam.userData.pathLength = pathLength;
            outgoingBeam.userData.destinationEntityId =
              receiverRig?.entity.id ?? null;
            outgoingBeam.userData.destinationKind = receiverRig
              ? 'powered-grid-relay'
              : 'integrated-fallback-packet-sink';
            outgoingBeam.userData.originWorld = emitterWorld.toArray();
            outgoingBeam.userData.destinationWorld =
              receiverWorld.toArray();

            for (const [index, packet] of (
              rig.parts.uplinkTransmissionPackets ?? []
            ).entries()) {
              const packetProgress = (
                (transmissionCycle - 0.22) / 0.46
                - index * 0.19
              );
              packet.visible = (
                packetsInTransit
                && packetProgress >= 0
                && packetProgress <= 1
              );
              packet.position.lerpVectors(
                emitterLocal,
                receiverLocal,
                THREE.MathUtils.clamp(packetProgress, 0, 1),
              );
              const packetScale =
                0.76
                + Math.sin(
                    THREE.MathUtils.clamp(packetProgress, 0, 1) * Math.PI,
                  ) * 0.5;
              packet.scale.setScalar(packetScale);
              packet.rotation.y =
                elapsed * 2.8 + index * Math.PI * 0.41;
              packet.userData.pathProgress = packetProgress;
              packet.userData.transmissionPhase = transmissionPhase;
              packet.userData.destinationEntityId =
                receiverRig?.entity.id ?? null;
            }
            if (rig.parts.uplinkAcknowledgementBeam) {
              const acknowledgementBeam =
                rig.parts.uplinkAcknowledgementBeam;
              const returnPath = emitterLocal.clone().sub(receiverLocal);
              const returnLength = Math.max(0.01, returnPath.length());
              const returnPulse = relayAcknowledged
                ? 1 + pulse * 0.055
                : 1;
              acknowledgementBeam.visible = relayAcknowledged;
              acknowledgementBeam.position.copy(receiverLocal);
              acknowledgementBeam.quaternion.setFromUnitVectors(
                UNIT_Y,
                returnPath.normalize(),
              );
              acknowledgementBeam.scale.set(
                returnPulse,
                returnLength,
                returnPulse,
              );
              acknowledgementBeam.userData.pathLength = returnLength;
              acknowledgementBeam.userData.transmissionPhase =
                transmissionPhase;
              acknowledgementBeam.userData.relayAcknowledged =
                relayAcknowledged;
              acknowledgementBeam.userData.originEntityId =
                receiverRig?.entity.id ?? null;
              acknowledgementBeam.userData.destinationEntityId =
                rig.entity.id ?? null;
              acknowledgementBeam.userData.originWorld =
                receiverWorld.toArray();
              acknowledgementBeam.userData.destinationWorld =
                emitterWorld.toArray();
            }
            for (const [index, packet] of (
              rig.parts.uplinkAcknowledgementPackets ?? []
            ).entries()) {
              const acknowledgementProgress = (
                (transmissionCycle - 0.68) / 0.22
                - index * 0.14
              );
              packet.visible = (
                relayAcknowledged
                && acknowledgementProgress >= 0
                && acknowledgementProgress <= 1
              );
              packet.position.lerpVectors(
                receiverLocal,
                emitterLocal,
                THREE.MathUtils.clamp(acknowledgementProgress, 0, 1),
              );
              const packetScale =
                0.78
                + Math.sin(
                    THREE.MathUtils.clamp(
                      acknowledgementProgress,
                      0,
                      1,
                  ) * Math.PI,
                  ) * 0.3;
              packet.scale.setScalar(packetScale);
              packet.rotation.x =
                elapsed * 3.8 + index * Math.PI * 0.36;
              packet.rotation.y =
                -elapsed * 2.6 + index * Math.PI * 0.28;
              packet.userData.pathProgress = acknowledgementProgress;
              packet.userData.transmissionPhase = transmissionPhase;
              packet.userData.originEntityId =
                receiverRig?.entity.id ?? null;
              packet.userData.destinationEntityId = rig.entity.id ?? null;
            }
            if (rig.parts.uplinkTransmissionReceiver) {
              const receiver = rig.parts.uplinkTransmissionReceiver;
              receiver.visible = packetsInTransit || acknowledgementHeld;
              receiver.position.copy(receiverLocal);
              receiver.userData.destinationEntityId =
                receiverRig?.entity.id ?? null;
              receiver.userData.destinationKind = receiverRig
                ? 'powered-grid-relay'
                : 'integrated-fallback-packet-sink';
              receiver.userData.powerNetworkId =
                receiverRig?.entity.powerNetworkId ?? null;
              receiver.userData.custodyAuthorized =
                securedCustodyCount >= 1;
              receiver.userData.transmissionPhase =
                transmissionPhase;
              receiver.userData.realRelayResponse =
                acknowledgementHeld;
            }
            for (const [index, ring] of (
              rig.parts.uplinkTransmissionReceiverRings ?? []
            ).entries()) {
              ring.rotation.z =
                (index % 2 === 0 ? 1 : -1)
                * (
                  elapsed
                  * (
                    relayAcknowledged
                      ? 1.45 + index * 0.28
                      : 0.72 + index * 0.18
                  )
                );
              const capturePulse =
                relayAcknowledged
                  ? 1.08
                    + Math.sin(elapsed * 5.4 - index * 0.9) * 0.055
                    + index * 0.035
                  : 0.94
                    + Math.sin(elapsed * 4.8 - index * 0.9) * 0.045
                    + index * 0.025;
              ring.scale.setScalar(capturePulse);
            }
          }
        }
        if (!packetsInTransit) {
          for (const packet of (
            rig.parts.uplinkTransmissionPackets ?? []
          )) packet.visible = false;
        }
        if (!relayAcknowledged) {
          if (rig.parts.uplinkAcknowledgementBeam) {
            rig.parts.uplinkAcknowledgementBeam.visible = false;
          }
          for (const packet of (
            rig.parts.uplinkAcknowledgementPackets ?? []
          )) packet.visible = false;
        }
        if (!packetsInTransit && !acknowledgementHeld) {
          if (rig.parts.uplinkTransmissionReceiver) {
            rig.parts.uplinkTransmissionReceiver.visible = false;
          }
        }
        if (rig.parts.uplinkCustodyMaterial) {
          const custodySecured = securedCustodyCount >= 1;
          rig.parts.uplinkCustodyMaterial.color.set(
            custodySecured ? '#70dec9' : '#d5aa55',
          );
          rig.parts.uplinkCustodyMaterial.emissive.set(
            custodySecured ? '#35d9c4' : '#d58c38',
          );
          rig.parts.uplinkCustodyMaterial.emissiveIntensity =
            custodySecured
              ? 0.24 + pulse * 0.06
              : 0.1 + Math.min(3, custodyCount) * 0.035;
          rig.parts.uplinkCustodyMaterial.userData.custodyCount =
            custodyCount;
          rig.parts.uplinkCustodyMaterial.userData.securedCustodyCount =
            securedCustodyCount;
          rig.parts.uplinkCustodyMaterial.userData.custodySecured =
            custodySecured;
          rig.parts.uplinkCustodyMaterial.userData.bufferFull =
            manifestReady;
          rig.parts.uplinkCustodyMaterial.userData.manifestReady =
            manifestReady;
          rig.parts.uplinkCustodyMaterial.userData.manifestKinds =
            custodyManifest.map((entry) => entry.kind);
          rig.parts.uplinkCustodyMaterial.userData.visibleCustodyKinds =
            activeCustodyItems.map((item) => item.userData.itemKind);
          rig.parts.uplinkCustodyMaterial.userData.transferPending =
            pendingCustodyUnit === 1;
          rig.parts.uplinkCustodyMaterial.userData.transferReturning =
            transferReturning;
          rig.parts.uplinkCustodyMaterial.userData.transmissionActive =
            transmissionActive;
        }
        if (rig.parts.uplinkEffectMaterial) {
          rig.parts.uplinkEffectMaterial.emissiveIntensity =
            uplinkSelected ? 0.08 + pulse * 0.05 : 0.025;
        }
      }
      return;
    }

    if (rig.kind === 'gridRelay') {
      const uplinkReceptionPhase =
        rig.root.userData.uplinkReceptionPhase ?? 'standby';
      const uplinkPacketArrival =
        uplinkReceptionPhase === 'packets-in-transit';
      const uplinkAcknowledgement =
        uplinkReceptionPhase === 'relay-acknowledged'
        || rig.root.userData.uplinkAcknowledgementHeld === true;
      const uplinkReceptionActive =
        rig.root.userData.uplinkReceptionActive === true;
      if (rig.parts.gridRelayCoil) {
        const baseCoilY =
          rig.parts.gridRelayCoil.userData.uplinkReceptionBaseY
          ?? rig.parts.gridRelayCoil.position.y;
        rig.parts.gridRelayCoil.userData.uplinkReceptionBaseY = baseCoilY;
        rig.parts.gridRelayCoil.rotation.y =
          elapsed
            * (
              uplinkAcknowledgement
                ? 1.62
                : uplinkPacketArrival
                  ? 0.82
                  : 0.16
            )
          + rig.phaseOffset * Math.PI * 2;
        rig.parts.gridRelayCoil.position.y =
          baseCoilY
          + (
            uplinkAcknowledgement
              ? 0.24
              : uplinkPacketArrival
                ? 0.09
                : 0
          );
        rig.parts.gridRelayCoil.scale.setScalar(
          uplinkAcknowledgement
            ? 1.5 + pulse * 0.09
            : uplinkPacketArrival
              ? 1.2 + pulse * 0.05
              : 1,
        );
        rig.parts.gridRelayCoil.userData.uplinkReceptionPhase =
          uplinkReceptionPhase;
      }
      if (rig.parts.gridRelayFluxRing) {
        const fluxScale = uplinkAcknowledgement
          ? 1.82 + Math.sin(elapsed * 5.1 + rig.phaseOffset * 5) * 0.16
          : uplinkPacketArrival
            ? 1.28 + Math.sin(elapsed * 3.5 + rig.phaseOffset * 5) * 0.08
            : 0.98
              + Math.sin(elapsed * 1.8 + rig.phaseOffset * 5) * 0.025;
        rig.parts.gridRelayFluxRing.scale.setScalar(fluxScale);
        rig.parts.gridRelayFluxRing.rotation.y =
          -elapsed
          * (
            uplinkAcknowledgement
              ? 1.45
              : uplinkPacketArrival
                ? 0.7
                : 0.11
          );
        rig.parts.gridRelayFluxRing.userData.uplinkReceptionPhase =
          uplinkReceptionPhase;
      }
      const networkId = rig.entity.powerNetworkId ?? null;
      if (rig.parts.gridRelayLampMaterial) {
        const color = powerNetworkColor(networkId);
        rig.parts.gridRelayLampMaterial.color.set(color);
        rig.parts.gridRelayLampMaterial.emissive.set(color);
        rig.parts.gridRelayLampMaterial.emissiveIntensity = networkId === null
          ? 0.14
          : uplinkAcknowledgement
            ? 3.1 + pulse * 0.82
            : uplinkPacketArrival
              ? 1.95 + pulse * 0.58
              : 1.18 + pulse * 0.42;
        rig.parts.gridRelayLampMaterial.userData.uplinkReceptionPhase =
          uplinkReceptionPhase;
      }
      rig.root.userData.uplinkVisibleRelayResponse =
        uplinkReceptionActive
        && (uplinkPacketArrival || uplinkAcknowledgement);
      return;
    }

    if (rig.kind === 'beacon') {
      if (rig.parts.ringA && active) rig.parts.ringA.rotation.y += dt * 0.9;
      if (rig.parts.ringB && active) rig.parts.ringB.rotation.y -= dt * 1.35;
      if (active && Math.random() < dt * (this.quality === 'high' ? 1.2 : 0.35)) {
        this.emitAtRig(rig, 'mote', [0, 0.58, 0]);
      }
    }
  }

  private updateParticles(dt: number): void {
    const positionAttribute = this.particleGeometry.getAttribute('position') as THREE.BufferAttribute;
    const colorAttribute = this.particleGeometry.getAttribute('color') as THREE.BufferAttribute;
    const sizeAttribute = this.particleGeometry.getAttribute('aSize') as THREE.BufferAttribute;
    const alphaAttribute = this.particleGeometry.getAttribute('aAlpha') as THREE.BufferAttribute;

    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      if (!particle) continue;
      if (particle.alive) {
        particle.age += dt;
        if (particle.age >= particle.life) {
          particle.alive = false;
        } else {
          const damping = Math.exp(-particle.drag * dt);
          particle.velocity.multiplyScalar(damping);
          particle.velocity.y -= particle.gravity * dt;
          particle.position.addScaledVector(particle.velocity, dt);
        }
      }

      if (!particle.alive) {
        this.particleAlphas[index] = 0;
        continue;
      }
      const normalizedAge = particle.age / particle.life;
      const fade = Math.sin(Math.PI * THREE.MathUtils.clamp(normalizedAge, 0, 1));
      this.particlePositions[index * 3] = particle.position.x;
      this.particlePositions[index * 3 + 1] = particle.position.y;
      this.particlePositions[index * 3 + 2] = particle.position.z;
      this.particleColors[index * 3] = particle.color.r;
      this.particleColors[index * 3 + 1] = particle.color.g;
      this.particleColors[index * 3 + 2] = particle.color.b;
      this.particleSizes[index] = THREE.MathUtils.lerp(
        particle.startSize,
        particle.endSize,
        normalizedAge,
      );
      this.particleAlphas[index] = fade * 0.76;
    }

    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
    sizeAttribute.needsUpdate = true;
    alphaAttribute.needsUpdate = true;
  }

  private rigIsActive(rig: EntityRig): boolean {
    if (rig.entity.active !== undefined) return rig.entity.active;
    if (rig.entity.powered === false) return false;
    if (rig.entity.status) return rig.entity.status === 'working';
    return true;
  }

  private rigCycleSpeed(kind: RenderEntityKind): number {
    switch (kind) {
      case 'belt':
        return 0.65;
      case 'manifold':
        return 0.65;
      case 'extractor':
        return 0.18;
      case 'inserter':
        return 0.42;
      case 'smelter':
        return 0.13;
      case 'fabricator':
        return 0.3;
      case 'generator':
        return 0.48;
      case 'storage':
        return 0.05;
      case 'beacon':
        return 0.1;
      case 'gridRelay':
        return 0.08;
    }
  }

  private updateRigMaterials(rig: EntityRig, active: boolean, pulse: number): void {
    const damaged = rig.entity.status === 'damaged' || (rig.entity.health ?? 1) < 0.28;
    const blocked = rig.entity.status === 'blocked';
    const unpowered = rig.entity.status === 'unpowered' || rig.entity.powered === false;
    let color = '#43d7c4';
    let intensity = active ? 2.05 * pulse : 0.42;
    if (damaged || blocked) {
      color = '#ff6550';
      intensity = 2.35 * pulse;
    } else if (unpowered) {
      color = '#526267';
      intensity = 0.08;
    } else if (!active) {
      color = '#e0a347';
      intensity = 0.48;
    }
    for (const lamp of rig.lamps) {
      lamp.color.set(color);
      lamp.emissive.set(color);
      lamp.emissiveIntensity = intensity;
    }
    for (const process of rig.processMaterials) {
      process.emissiveIntensity = active ? 2.3 * pulse : 0.16;
    }
  }

  private emitAtRig(
    rig: EntityRig,
    kind: 'dust' | 'smoke' | 'spark' | 'steam' | 'mote',
    localPosition: [number, number, number],
  ): void {
    this.tempVector.set(...localPosition);
    rig.root.localToWorld(this.tempVector);
    const random = Math.random;
    if (kind === 'dust') {
      this.spawnParticle(
        this.tempVector,
        new THREE.Vector3((random() - 0.5) * 0.24, 0.08 + random() * 0.12, (random() - 0.5) * 0.24),
        new THREE.Color('#776b59'),
        0.55 + random() * 0.45,
        7 + random() * 4,
        18 + random() * 7,
        0.12,
        2.8,
      );
      return;
    }
    if (kind === 'smoke') {
      this.spawnParticle(
        this.tempVector,
        new THREE.Vector3(0.045 + (random() - 0.5) * 0.04, 0.17 + random() * 0.07, -0.025),
        new THREE.Color('#687070'),
        1.25 + random() * 0.8,
        8 + random() * 3,
        27 + random() * 9,
        0,
        1.7,
      );
      return;
    }
    if (kind === 'steam') {
      this.spawnParticle(
        this.tempVector,
        new THREE.Vector3(0.08 + random() * 0.05, 0.2 + random() * 0.08, (random() - 0.5) * 0.04),
        new THREE.Color('#c1d9d7'),
        0.8 + random() * 0.55,
        7 + random() * 3,
        24 + random() * 7,
        0,
        1.35,
      );
      return;
    }
    if (kind === 'mote') {
      this.spawnParticle(
        this.tempVector,
        new THREE.Vector3((random() - 0.5) * 0.08, 0.1 + random() * 0.06, (random() - 0.5) * 0.08),
        new THREE.Color('#43d7c4'),
        0.85 + random() * 0.35,
        4 + random() * 2,
        2,
        0,
        1,
      );
      return;
    }
    for (let sparkIndex = 0; sparkIndex < 2; sparkIndex += 1) {
      this.spawnParticle(
        this.tempVector,
        new THREE.Vector3((random() - 0.5) * 0.52, 0.28 + random() * 0.32, (random() - 0.5) * 0.42),
        new THREE.Color(sparkIndex === 0 ? '#ffb23e' : '#ffe1a0'),
        0.32 + random() * 0.3,
        4 + random() * 2,
        1.5,
        1.5,
        0.72,
      );
    }
  }

  private spawnParticle(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    color: THREE.Color,
    life: number,
    startSize: number,
    endSize: number,
    gravity: number,
    drag: number,
  ): void {
    const available = this.quality === 'high' ? MAX_PARTICLES : Math.floor(MAX_PARTICLES * 0.45);
    const index = this.particleCursor % available;
    this.particleCursor = (this.particleCursor + 1) % available;
    const particle = this.particles[index];
    if (!particle) return;
    particle.alive = true;
    particle.position.copy(position);
    particle.velocity.copy(velocity);
    particle.color.copy(color);
    particle.age = 0;
    particle.life = life;
    particle.startSize = startSize;
    particle.endSize = endSize;
    particle.gravity = gravity;
    particle.drag = drag;
  }

  private updateGhost(): void {
    const state = this.ghostState;
    this.ghostRoot.visible = Boolean(state);
    if (!state) return;

    const ghostTopologySignature = state.kind === 'gridRelay'
      ? [
          state.kind,
          state.x,
          state.z,
          this.powerGridSignature,
        ].join('|')
      : state.kind;
    if (
      !this.ghostVisual
      || this.ghostKind !== state.kind
      || this.ghostTopologySignature !== ghostTopologySignature
    ) {
      if (this.ghostVisual) {
        const ghostMaterials = new Set<THREE.Material>();
        this.ghostVisual.traverse((object) => {
          if (
            object instanceof THREE.Mesh
            || object instanceof THREE.LineSegments
          ) {
            object.geometry.dispose();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            for (const material of materials) ghostMaterials.add(material);
          }
        });
        for (const material of ghostMaterials) material.dispose();
        this.ghostVisual.removeFromParent();
      }

      const fakeEntity: RenderEntity = {
        id: '__placement-ghost__',
        kind: state.kind,
        x: state.x,
        z: state.z,
        direction: state.direction,
        active: false,
      };
      const rig: EntityRig = {
        root: new THREE.Group(),
        kind: state.kind,
        variant: 'standard',
        quality: 'high',
        entity: fakeEntity,
        phaseOffset: 0,
        parts: {},
        lamps: [],
        processMaterials: [],
        ownedMaterials: [],
      };
      switch (state.kind as string) {
        case 'belt':
          this.buildBelt(rig);
          break;
        case 'manifold':
          this.addFootprint(rig.root);
          this.buildManifold(rig);
          break;
        case 'extractor':
          this.addFootprint(rig.root);
          this.buildExtractor(rig);
          break;
        case 'inserter':
          this.addFootprint(rig.root);
          this.buildInserter(rig);
          break;
        case 'smelter':
          this.addFootprint(rig.root);
          this.buildSmelter(rig);
          break;
        case 'fabricator':
          this.addFootprint(rig.root);
          this.buildFabricator(rig);
          break;
        case 'generator':
          this.addFootprint(rig.root);
          this.buildGenerator(rig);
          break;
        case 'storage':
          this.addFootprint(rig.root);
          this.buildStorage(rig);
          break;
        case 'beacon':
          this.addFootprint(rig.root);
          this.buildBeacon(rig);
          break;
        case 'gridRelay':
          this.addFootprint(rig.root);
          this.buildGridRelayPlacementGhost(rig);
          break;
        case 'fluidSource': {
          this.addFootprint(rig.root);
          this.addRoundedBox(
            rig.root,
            [0.92, 0.12, 0.92],
            this.materials.foundation,
            [0, 0.07, 0],
          ).name = 'fluid-source-ghost-foundation';
          this.addCylinder(
            rig.root,
            0.22,
            0.52,
            this.materials.titanium,
            [0, 0.38, 0],
          ).name = 'fluid-source-ghost-wellhead';
          this.addTorus(
            rig.root,
            0.28,
            0.055,
            this.materials.copper,
            [0, 0.48, 0],
          ).name = 'fluid-source-ghost-pressure-ring';
          for (const side of [-1, 1]) {
            this.addBeam(
              rig.root,
              new THREE.Vector3(side * 0.34, 0.13, -0.32),
              new THREE.Vector3(side * 0.17, 0.8, 0.12),
              0.045,
              this.materials.titanium,
            ).name = 'fluid-source-ghost-derrick';
          }
          break;
        }
        case 'fluidPump': {
          this.addFootprint(rig.root);
          this.addRoundedBox(
            rig.root,
            [0.92, 0.11, 0.68],
            this.materials.foundation,
            [0, 0.065, 0],
          ).name = 'fluid-pump-ghost-foundation';
          this.addCylinder(
            rig.root,
            0.22,
            0.7,
            this.materials.titanium,
            [0, 0.32, 0],
            [0, 0, Math.PI / 2],
          ).name = 'fluid-pump-ghost-body';
          this.addTorus(
            rig.root,
            0.25,
            0.055,
            this.materials.copper,
            [0, 0.32, 0],
            [0, Math.PI / 2, 0],
          ).name = 'fluid-pump-ghost-impeller';
          this.addRoundedBox(
            rig.root,
            [0.28, 0.2, 0.32],
            this.materials.ceramic,
            [0, 0.6, 0],
          ).name = 'fluid-pump-ghost-motor';
          break;
        }
        case 'fluidPipe': {
          this.addFootprint(rig.root);
          this.addCylinder(
            rig.root,
            0.12,
            0.92,
            this.materials.titanium,
            [0, 0.24, 0],
            [0, 0, Math.PI / 2],
          ).name = 'fluid-pipe-ghost-run';
          for (const side of [-1, 1]) {
            this.addTorus(
              rig.root,
              0.17,
              0.045,
              this.materials.copper,
              [side * 0.39, 0.24, 0],
              [0, Math.PI / 2, 0],
            ).name = 'fluid-pipe-ghost-flange';
          }
          break;
        }
        case 'fluidTank': {
          this.addFootprint(rig.root);
          this.addRoundedBox(
            rig.root,
            [0.92, 0.1, 0.92],
            this.materials.foundation,
            [0, 0.06, 0],
          ).name = 'fluid-tank-ghost-foundation';
          this.addCylinder(
            rig.root,
            0.4,
            0.86,
            this.materials.titanium,
            [0, 0.55, 0],
          ).name = 'fluid-tank-ghost-reservoir';
          for (const height of [0.25, 0.54, 0.83]) {
            this.addTorus(
              rig.root,
              0.41,
              0.035,
              this.materials.copper,
              [0, height, 0],
            ).name = 'fluid-tank-ghost-rivet-band';
          }
          break;
        }
        case 'fluidProcessor': {
          this.addFootprint(rig.root);
          this.addRoundedBox(
            rig.root,
            [0.96, 0.11, 0.9],
            this.materials.foundation,
            [0, 0.065, 0],
          ).name = 'fluid-processor-ghost-skid';
          for (const [x, height, radius] of [
            [-0.25, 0.92, 0.18],
            [0.22, 0.7, 0.24],
          ] as const) {
            this.addCylinder(
              rig.root,
              radius,
              height,
              this.materials.titanium,
              [x, 0.14 + height * 0.5, 0.05],
            ).name = 'fluid-processor-ghost-column';
            this.addTorus(
              rig.root,
              radius + 0.015,
              0.025,
              this.materials.copper,
              [x, 0.42, 0.05],
            ).name = 'fluid-processor-ghost-column-band';
          }
          this.addBeam(
            rig.root,
            new THREE.Vector3(-0.25, 0.48, 0.05),
            new THREE.Vector3(0.22, 0.48, 0.05),
            0.045,
            this.materials.copper,
          ).name = 'fluid-processor-ghost-transfer-pipe';
          break;
        }
        case 'constantCombinator': {
          this.addFootprint(rig.root);
          this.addRoundedBox(
            rig.root,
            [0.72, 0.12, 0.62],
            this.materials.foundation,
            [0, 0.07, 0],
          ).name = 'constant-combinator-ghost-foundation';
          this.addRoundedBox(
            rig.root,
            [0.58, 0.52, 0.16],
            this.materials.ceramic,
            [0, 0.39, 0],
          ).name = 'constant-combinator-ghost-terminal';
          for (const x of [-0.18, 0, 0.18]) {
            this.addCylinder(
              rig.root,
              0.035,
              0.12,
              this.materials.copper,
              [x, 0.25, 0.15],
              [Math.PI / 2, 0, 0],
              8,
            ).name = 'constant-combinator-ghost-signal-pin';
          }
          break;
        }
        case 'arithmeticCombinator': {
          this.addFootprint(rig.root);
          this.addRoundedBox(
            rig.root,
            [0.82, 0.12, 0.62],
            this.materials.foundation,
            [0, 0.07, 0],
          ).name = 'arithmetic-combinator-ghost-foundation';
          this.addRoundedBox(
            rig.root,
            [0.65, 0.38, 0.4],
            this.materials.ceramic,
            [0, 0.32, 0],
          ).name = 'arithmetic-combinator-ghost-engine';
          this.addRoundedBox(
            rig.root,
            [0.3, 0.055, 0.055],
            this.materials.copper,
            [0, 0.34, -0.22],
          ).name = 'arithmetic-combinator-ghost-plus-horizontal';
          this.addRoundedBox(
            rig.root,
            [0.055, 0.3, 0.055],
            this.materials.copper,
            [0, 0.34, -0.22],
          ).name = 'arithmetic-combinator-ghost-plus-vertical';
          break;
        }
        case 'deciderCombinator': {
          this.addFootprint(rig.root);
          this.addRoundedBox(
            rig.root,
            [0.82, 0.12, 0.62],
            this.materials.foundation,
            [0, 0.07, 0],
          ).name = 'decider-combinator-ghost-foundation';
          this.addRoundedBox(
            rig.root,
            [0.48, 0.48, 0.25],
            this.materials.ceramic,
            [0, 0.39, 0],
            [0, 0, Math.PI / 4],
          ).name = 'decider-combinator-ghost-diamond';
          this.addCylinder(
            rig.root,
            0.07,
            0.22,
            this.materials.copper,
            [0, 0.72, 0],
          ).name = 'decider-combinator-ghost-output';
          break;
        }
      }
      for (const material of rig.ownedMaterials) material.dispose();

      const ghostMaterial = new THREE.MeshBasicMaterial({
        color: state.valid ? '#b4f06a' : '#ff6550',
        transparent: true,
        opacity: state.valid ? 0.52 : 0.58,
        depthWrite: true,
        depthTest: true,
        wireframe: false,
        side: THREE.FrontSide,
      });
      ghostMaterial.alphaHash = false;
      ghostMaterial.polygonOffset = true;
      ghostMaterial.polygonOffsetFactor = -0.45;
      ghostMaterial.polygonOffsetUnits = -0.45;
      ghostMaterial.userData.placementGhostOcclusion =
        'depth-writing-alpha-blend';
      const ghostFoundationMaterial = ghostMaterial.clone();
      ghostFoundationMaterial.opacity = state.valid ? 0.18 : 0.24;
      ghostFoundationMaterial.depthWrite = false;
      ghostFoundationMaterial.userData.placementGhostOcclusion =
        'subordinate-foundation-alpha-blend';
      const footprintMaterial = new THREE.MeshBasicMaterial({
        color: state.valid ? '#b4f06a' : '#ff6550',
        transparent: true,
        opacity: state.valid ? 0.12 : 0.18,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      rig.root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (object.name === 'contact-shadow') {
          object.visible = false;
          object.material = footprintMaterial;
          object.renderOrder = 39;
          return;
        }
        object.material = (
          object.name.includes('foundation')
          || object.name.includes('plinth')
        )
          ? ghostFoundationMaterial
          : ghostMaterial;
        object.castShadow = false;
        object.receiveShadow = false;
        object.renderOrder = 40;
      });
      if (state.kind === 'gridRelay') {
        const halfExtent = Math.max(
          0.5,
          this.snapshot.powerGrid?.halfExtent ?? 3,
        );
        const rangeGeometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-halfExtent, 0.02, -halfExtent),
          new THREE.Vector3(halfExtent, 0.02, -halfExtent),
          new THREE.Vector3(halfExtent, 0.02, -halfExtent),
          new THREE.Vector3(halfExtent, 0.02, halfExtent),
          new THREE.Vector3(halfExtent, 0.02, halfExtent),
          new THREE.Vector3(-halfExtent, 0.02, halfExtent),
          new THREE.Vector3(-halfExtent, 0.02, halfExtent),
          new THREE.Vector3(-halfExtent, 0.02, -halfExtent),
        ]);
        const footprintGeometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-0.5, 0.035, -0.5),
          new THREE.Vector3(0.5, 0.035, -0.5),
          new THREE.Vector3(0.5, 0.035, -0.5),
          new THREE.Vector3(0.5, 0.035, 0.5),
          new THREE.Vector3(0.5, 0.035, 0.5),
          new THREE.Vector3(-0.5, 0.035, 0.5),
          new THREE.Vector3(-0.5, 0.035, 0.5),
          new THREE.Vector3(-0.5, 0.035, -0.5),
        ]);
        const rangeMaterial = new THREE.LineBasicMaterial({
          color: state.valid ? '#c8ff82' : '#ff6b55',
          transparent: true,
          opacity: state.valid ? 0.34 : 0.46,
          depthTest: false,
          depthWrite: false,
        });
        const range = new THREE.LineSegments(rangeGeometry, rangeMaterial);
        range.name = 'grid-relay-ghost-subordinate-coverage-boundary';
        range.renderOrder = 41;
        range.frustumCulled = false;
        rig.root.add(range);
        const footprintLineMaterial = new THREE.LineBasicMaterial({
          color: state.valid ? '#dcff9d' : '#ff7a64',
          transparent: true,
          opacity: state.valid ? 0.96 : 1,
          depthTest: false,
          depthWrite: false,
        });
        const footprintLine = new THREE.LineSegments(
          footprintGeometry,
          footprintLineMaterial,
        );
        footprintLine.name = 'grid-relay-ghost-crisp-one-tile-footprint';
        footprintLine.renderOrder = 43;
        footprintLine.frustumCulled = false;
        rig.root.add(footprintLine);
        const invalidCueGeometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-0.38, 0.05, -0.38),
          new THREE.Vector3(0.38, 0.05, 0.38),
          new THREE.Vector3(-0.38, 0.05, 0.38),
          new THREE.Vector3(0.38, 0.05, -0.38),
          new THREE.Vector3(-0.48, 0.05, -0.14),
          new THREE.Vector3(0.14, 0.05, 0.48),
          new THREE.Vector3(-0.14, 0.05, -0.48),
          new THREE.Vector3(0.48, 0.05, 0.14),
        ]);
        const invalidCueMaterial = new THREE.LineBasicMaterial({
          color: '#fff1dc',
          transparent: true,
          opacity: 0.96,
          depthTest: false,
          depthWrite: false,
        });
        const invalidCue = new THREE.LineSegments(
          invalidCueGeometry,
          invalidCueMaterial,
        );
        invalidCue.name =
          'grid-relay-ghost-invalid-collision-crosshatching';
        invalidCue.visible = !state.valid;
        invalidCue.renderOrder = 44;
        invalidCue.frustumCulled = false;
        rig.root.add(invalidCue);

        const cableReach = Math.max(
          0,
          this.snapshot.powerGrid?.cableReach ?? 0,
        );
        const ghostCenterX = state.x + 0.5;
        const ghostCenterZ = state.z + 0.5;
        const prospectiveBeams: DetailBeam[] = [];
        const ghostCenter = { x: ghostCenterX, z: ghostCenterZ };
        for (const relay of this.powerGridRelayCenters.values()) {
          const dx = relay.x - ghostCenterX;
          const dz = relay.z - ghostCenterZ;
          const distance = Math.hypot(dx, dz);
          if (
            distance > cableReach
            || distance < 0.01
          ) continue;
          const from = this.powerGridTerminalPoint(
            ghostCenter,
            relay,
            new THREE.Vector3(),
          );
          const to = this.powerGridTerminalPoint(
            relay,
            ghostCenter,
            new THREE.Vector3(),
          );
          const sag = THREE.MathUtils.clamp(distance * 0.055, 0.08, 0.32);
          for (let segment = 0; segment < POWER_GRID_CABLE_SEGMENTS; segment += 1) {
            const t0 = segment / POWER_GRID_CABLE_SEGMENTS;
            const t1 = (segment + 1) / POWER_GRID_CABLE_SEGMENTS;
            const point = (t: number): [number, number, number] => [
              THREE.MathUtils.lerp(from.x, to.x, t) - ghostCenterX,
              THREE.MathUtils.lerp(from.y, to.y, t)
                - 4 * sag * t * (1 - t),
              THREE.MathUtils.lerp(from.z, to.z, t) - ghostCenterZ,
            ];
            prospectiveBeams.push({
              from: point(t0),
              to: point(t1),
              radius: 0.014,
            });
          }
        }
        if (prospectiveBeams.length > 0) {
          const prospectiveMaterial = new THREE.MeshBasicMaterial({
            color: '#c78b4f',
            transparent: true,
            opacity: 0.82,
            depthTest: true,
            depthWrite: false,
          });
          const prospective = this.addInstancedBeams(
            rig.root,
            prospectiveMaterial,
            prospectiveBeams,
            6,
          );
          prospective.name =
            'grid-relay-ghost-sagging-terminal-to-terminal-conductors';
          prospective.renderOrder = 42;
          prospective.frustumCulled = false;
          prospective.castShadow = false;
          prospective.receiveShadow = false;
          rig.root.userData.ghostProspectiveMaterial = prospectiveMaterial;
        }
        this.ghostVisual = rig.root;
        this.ghostVisual.userData.ghostRangeMaterial = rangeMaterial;
        this.ghostVisual.userData.ghostFootprintLineMaterial =
          footprintLineMaterial;
        this.ghostVisual.userData.ghostInvalidCue = invalidCue;
      }
      this.ghostVisual = rig.root;
      this.ghostVisual.userData.ghostMaterial = ghostMaterial;
      this.ghostVisual.userData.ghostFoundationMaterial =
        ghostFoundationMaterial;
      this.ghostVisual.userData.ghostFootprintMaterial = footprintMaterial;
      this.ghostKind = state.kind;
      this.ghostTopologySignature = ghostTopologySignature;
      this.ghostRoot.clear();
      this.ghostRoot.add(this.ghostVisual);
    }

    const material = this.ghostVisual.userData.ghostMaterial as THREE.MeshBasicMaterial | undefined;
    if (material) {
      material.color.set(state.valid ? '#b4f06a' : '#ff6550');
      material.opacity = state.valid ? 0.52 : 0.58;
    }
    const foundationMaterial = this.ghostVisual.userData
      .ghostFoundationMaterial as THREE.MeshBasicMaterial | undefined;
    if (foundationMaterial) {
      foundationMaterial.color.set(state.valid ? '#b4f06a' : '#ff6550');
      foundationMaterial.opacity = state.valid ? 0.18 : 0.24;
    }
    const footprintMaterial = this.ghostVisual.userData
      .ghostFootprintMaterial as THREE.MeshBasicMaterial | undefined;
    if (footprintMaterial) {
      footprintMaterial.color.set(state.valid ? '#b4f06a' : '#ff6550');
      footprintMaterial.opacity = state.valid ? 0.12 : 0.2;
    }
    const rangeMaterial = this.ghostVisual.userData
      .ghostRangeMaterial as THREE.LineBasicMaterial | undefined;
    if (rangeMaterial) {
      rangeMaterial.color.set(state.valid ? '#c8ff82' : '#ff6b55');
      rangeMaterial.opacity = state.valid ? 0.34 : 0.46;
    }
    const footprintLineMaterial = this.ghostVisual.userData
      .ghostFootprintLineMaterial as THREE.LineBasicMaterial | undefined;
    if (footprintLineMaterial) {
      footprintLineMaterial.color.set(state.valid ? '#dcff9d' : '#ff7a64');
      footprintLineMaterial.opacity = state.valid ? 0.96 : 1;
    }
    const prospectiveMaterial = this.ghostVisual.userData
      .ghostProspectiveMaterial as THREE.MeshBasicMaterial | undefined;
    if (prospectiveMaterial) {
      prospectiveMaterial.color.set('#c78b4f');
      prospectiveMaterial.opacity = 0.82;
    }
    const invalidCue = this.ghostVisual.userData
      .ghostInvalidCue as THREE.Object3D | undefined;
    if (invalidCue) invalidCue.visible = !state.valid;
    const advancedFootprint = {
      fluidSource: [2, 2],
      fluidPump: [1, 1],
      fluidPipe: [1, 1],
      fluidTank: [3, 3],
      fluidProcessor: [3, 3],
      constantCombinator: [1, 1],
      arithmeticCombinator: [1, 1],
      deciderCombinator: [1, 1],
    }[state.kind as string] as readonly [number, number] | undefined;
    const footprint = advancedFootprint
      ? {
          localWidth: advancedFootprint[0],
          localHeight: advancedFootprint[1],
          worldWidth:
            directionIndex(state.direction) % 2 === 1
              ? advancedFootprint[1]
              : advancedFootprint[0],
          worldHeight:
            directionIndex(state.direction) % 2 === 1
              ? advancedFootprint[0]
              : advancedFootprint[1],
        }
      : this.entityFootprint({
          kind: state.kind,
          direction: state.direction,
        });
    this.ghostVisual.position.set(
      state.x + footprint.worldWidth * 0.5,
      0.035,
      state.z + footprint.worldHeight * 0.5,
    );
    this.ghostVisual.rotation.y = directionAngle(state.direction);
    this.ghostVisual.scale.set(
      footprint.localWidth === 1 ? 1 : footprint.localWidth * 0.82,
      footprint.localWidth === 1 && footprint.localHeight === 1 ? 1 : 1.28,
      footprint.localHeight === 1 ? 1 : footprint.localHeight * 0.82,
    );
  }

  private setPointer(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
  }

  private positionCamera(): void {
    const horizontalDistance = Math.cos(CAMERA_ELEVATION) * CAMERA_DISTANCE;
    const height = Math.sin(CAMERA_ELEVATION) * CAMERA_DISTANCE;
    this.camera.position.set(
      this.focusPoint.x,
      height,
      this.focusPoint.z + horizontalDistance,
    );
    this.camera.lookAt(this.focusPoint);
    this.camera.updateMatrixWorld();

    this.sun.position.set(
      this.focusPoint.x - 26,
      45,
      this.focusPoint.z + 20,
    );
    this.sunTarget.position.copy(this.focusPoint);
    this.sunTarget.updateMatrixWorld();
  }
}

export default WorldRenderer;
