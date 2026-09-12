import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import {
  RAIL_LIMITS,
  railSegmentLength,
  type RailCarSnapshot,
  type RailDirection,
  type RailGraphNode,
  type RailNetworkSnapshot,
  type RailSignalAspect,
  type RailSignalSnapshot,
  type RailStationSnapshot,
  type RailTrainSnapshot,
  type RailTrainStatus,
  type RailWaitCondition,
} from "../game/rail-network";
import type { RailBuildKind } from "../game/railAuthoring";

export interface RailVisualFrame {
  readonly elapsedSeconds: number;
  readonly rail: RailNetworkSnapshot | null;
}

/**
 * Structural adapter boundary for the ordinary world render loop.  The game
 * snapshot uses `elapsedSeconds`; WorldRenderer uses `elapsed`.  Accepting both
 * keeps rail presentation out of simulation custody while allowing the world
 * renderer to attach the subsystem without a QA-only bridge.
 */
export interface RailIntegratedSnapshot {
  readonly elapsedSeconds?: number;
  readonly elapsed?: number;
  readonly rail?: RailNetworkSnapshot | null;
}

export interface RailRendererOptions {
  readonly maxRenderedSegments?: number;
  readonly maxRenderedSignals?: number;
  readonly maxDetailedStations?: number;
  readonly maxDetailedTrains?: number;
  readonly maxDetailedCarsPerTrain?: number;
  readonly maxOverviewCars?: number;
  readonly maxRouteSegments?: number;
  /** Explicit diagnostics only; presentation captures keep topology marks off. */
  readonly showOperationalOverlays?: boolean;
}

export type RailPickTarget =
  | {
      readonly kind: "segment";
      readonly segmentId: string;
      readonly blockId: string;
    }
  | { readonly kind: "signal"; readonly signalId: string }
  | { readonly kind: "station"; readonly stationId: string }
  | {
      readonly kind: "train";
      readonly trainId: string;
      readonly carId?: string;
    };

export interface RailAuthoringPreview {
  readonly buildKind: RailBuildKind;
  readonly x: number;
  readonly z: number;
  readonly rotation: 0 | 1 | 2 | 3;
  readonly validity: "valid" | "blocked";
  readonly reason?: string;
}

export interface RailAuthoringOverlay {
  readonly selected: RailPickTarget | null;
  readonly sourceSegmentId: string | null;
  readonly preview: RailAuthoringPreview | null;
}

export interface RailRenderDebug {
  readonly disposed: boolean;
  readonly topologySignature: string;
  readonly stateSignature: string;
  readonly tick: number;
  readonly topologyRevision: number;
  readonly segments: number;
  readonly renderedSegments: number;
  readonly omittedSegments: number;
  readonly straightSegments: number;
  readonly curvedSegments: number;
  readonly junctionSegments: number;
  readonly blocks: number;
  readonly occupiedBlocks: number;
  readonly reservedBlocks: number;
  readonly routeSegments: number;
  readonly omittedRouteSegments: number;
  readonly signals: number;
  readonly omittedSignals: number;
  readonly regularSignals: number;
  readonly chainSignals: number;
  readonly redSignals: number;
  readonly greenSignals: number;
  readonly chainClearSignals: number;
  readonly stations: number;
  readonly detailedStations: number;
  readonly overviewStations: number;
  readonly activeStations: number;
  readonly trains: number;
  readonly detailedTrains: number;
  readonly overviewTrains: number;
  readonly detailedCars: number;
  readonly overviewCars: number;
  readonly omittedCars: number;
  readonly locomotives: number;
  readonly cargoWagons: number;
  readonly cargoUnits: number;
  readonly fuelMilli: number;
  readonly statusCounts: Readonly<Record<RailTrainStatus, number>>;
  readonly drawBatches: number;
  readonly triangles: number;
  readonly capacities: {
    readonly trackInstances: number;
    readonly signalInstances: number;
    readonly overlayInstances: number;
    readonly overviewInstances: number;
  };
  readonly resources: {
    readonly ownedGeometries: number;
    readonly ownedMaterials: number;
    readonly ownedTextures: number;
    readonly liveInstancedMeshes: number;
    readonly disposedGeometries: number;
    readonly disposedMaterials: number;
    readonly disposedTextures: number;
    readonly disposedInstancedMeshes: number;
  };
  readonly occupancyModel: "exclusive-block-atomic-consist";
}

interface NormalizedOptions {
  readonly maxRenderedSegments: number;
  readonly maxRenderedSignals: number;
  readonly maxDetailedStations: number;
  readonly maxDetailedTrains: number;
  readonly maxDetailedCarsPerTrain: number;
  readonly maxOverviewCars: number;
  readonly maxRouteSegments: number;
  readonly showOperationalOverlays: boolean;
}

interface RailMaterials {
  readonly ballast: THREE.MeshBasicMaterial;
  readonly ballastDark: THREE.MeshBasicMaterial;
  readonly junctionBallast: THREE.MeshBasicMaterial;
  readonly sleeper: THREE.MeshStandardMaterial;
  readonly sleeperAlt: THREE.MeshStandardMaterial;
  readonly junctionSleeper: THREE.MeshStandardMaterial;
  readonly junctionSleeperAlt: THREE.MeshStandardMaterial;
  readonly rail: THREE.MeshStandardMaterial;
  readonly railTop: THREE.MeshStandardMaterial;
  readonly junctionRailTop: THREE.MeshStandardMaterial;
  readonly fastener: THREE.MeshStandardMaterial;
  readonly switchMetal: THREE.MeshStandardMaterial;
  readonly turnoutLinkage: THREE.MeshStandardMaterial;
  readonly turnoutServiceConcrete: THREE.MeshStandardMaterial;
  readonly turnoutCableTrough: THREE.MeshStandardMaterial;
  readonly turnoutServiceHousing: THREE.MeshStandardMaterial;
  readonly blockOccupied: THREE.MeshBasicMaterial;
  readonly blockReserved: THREE.MeshBasicMaterial;
  readonly route: THREE.MeshBasicMaterial;
  readonly signalPost: THREE.MeshStandardMaterial;
  readonly signalHousing: THREE.MeshStandardMaterial;
  readonly signalBlack: THREE.MeshStandardMaterial;
  readonly lampRed: THREE.MeshStandardMaterial;
  readonly lampGreen: THREE.MeshStandardMaterial;
  readonly lampChain: THREE.MeshStandardMaterial;
  readonly platform: THREE.MeshStandardMaterial;
  readonly platformEdge: THREE.MeshStandardMaterial;
  readonly stationSteel: THREE.MeshStandardMaterial;
  readonly stationPaint: THREE.MeshStandardMaterial;
  readonly safety: THREE.MeshStandardMaterial;
  readonly locomotive: THREE.MeshStandardMaterial;
  readonly locomotiveAccent: THREE.MeshStandardMaterial;
  readonly locomotiveSecondary: THREE.MeshStandardMaterial;
  readonly locomotivePanel: THREE.MeshStandardMaterial;
  readonly locomotiveSoot: THREE.MeshStandardMaterial;
  readonly wagon: THREE.MeshStandardMaterial;
  readonly wagonSecondary: THREE.MeshStandardMaterial;
  readonly wagonRust: THREE.MeshStandardMaterial;
  readonly wagonInterior: THREE.MeshStandardMaterial;
  readonly wagonBasin: THREE.MeshStandardMaterial;
  readonly wagonOreResidue: THREE.MeshStandardMaterial;
  readonly oil: THREE.MeshStandardMaterial;
  readonly decal: THREE.MeshStandardMaterial;
  readonly conveyor: THREE.MeshStandardMaterial;
  readonly rubber: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshStandardMaterial;
  readonly cargoIron: THREE.MeshStandardMaterial;
  readonly cargoIronTransfer: THREE.MeshStandardMaterial;
  readonly cargoCopper: THREE.MeshStandardMaterial;
  readonly cargoCoal: THREE.MeshStandardMaterial;
  readonly cargoStone: THREE.MeshStandardMaterial;
  readonly cargoProduct: THREE.MeshStandardMaterial;
  readonly brake: THREE.MeshStandardMaterial;
  readonly brakeHot: THREE.MeshStandardMaterial;
  readonly active: THREE.MeshStandardMaterial;
  readonly warning: THREE.MeshStandardMaterial;
  readonly inactive: THREE.MeshStandardMaterial;
  readonly yardVegetation: THREE.MeshStandardMaterial;
  readonly smoke: THREE.MeshBasicMaterial;
  readonly all: readonly THREE.Material[];
}

interface RailGeometries {
  readonly straightBallast: THREE.BufferGeometry;
  readonly straightBallastDetail: THREE.BufferGeometry;
  readonly straightSleepers: THREE.BufferGeometry;
  readonly straightSleeperAccents: THREE.BufferGeometry;
  readonly straightRails: THREE.BufferGeometry;
  readonly straightRailTops: THREE.BufferGeometry;
  readonly straightFasteners: THREE.BufferGeometry;
  readonly curveBallast: THREE.BufferGeometry;
  readonly curveBallastDetail: THREE.BufferGeometry;
  readonly curveSleepers: THREE.BufferGeometry;
  readonly curveSleeperAccents: THREE.BufferGeometry;
  readonly curveRails: THREE.BufferGeometry;
  readonly curveRailTops: THREE.BufferGeometry;
  readonly curveFasteners: THREE.BufferGeometry;
  readonly junctionBallast: THREE.BufferGeometry;
  readonly junctionBallastDetail: THREE.BufferGeometry;
  readonly junctionSleepers: THREE.BufferGeometry;
  readonly junctionSleeperAccents: THREE.BufferGeometry;
  readonly junctionRails: THREE.BufferGeometry;
  readonly junctionRailTops: THREE.BufferGeometry;
  readonly junctionFasteners: THREE.BufferGeometry;
  readonly junctionHardware: THREE.BufferGeometry;
  readonly junctionRunningHardware: THREE.BufferGeometry;
  readonly junctionMotor: THREE.BufferGeometry;
  readonly integratedTurnoutWest: IntegratedTurnoutGeometries;
  readonly integratedTurnoutEast: IntegratedTurnoutGeometries;
  readonly integratedMainBed: IntegratedMainBedGeometries;
  readonly integratedBypass: IntegratedBypassGeometries;
  readonly overlayTile: THREE.BufferGeometry;
  readonly routeTile: THREE.BufferGeometry;
  readonly signalPost: THREE.BufferGeometry;
  readonly regularSignalHead: THREE.BufferGeometry;
  readonly chainSignalHead: THREE.BufferGeometry;
  readonly regularLens: THREE.BufferGeometry;
  readonly chainLens: THREE.BufferGeometry;
  readonly indicatorLens: THREE.BufferGeometry;
  readonly cabWindow: THREE.BufferGeometry;
  readonly stationPlatform: THREE.BufferGeometry;
  readonly stationPlatformGrating: THREE.BufferGeometry;
  readonly stationEdge: THREE.BufferGeometry;
  readonly stationCanopy: THREE.BufferGeometry;
  readonly stationCanopyStripe: THREE.BufferGeometry;
  readonly stationCanopyRibs: THREE.BufferGeometry;
  readonly stationSupport: THREE.BufferGeometry;
  readonly stationCrane: THREE.BufferGeometry;
  readonly stationServiceArm: THREE.BufferGeometry;
  readonly stationFuelTank: THREE.BufferGeometry;
  readonly stationPallet: THREE.BufferGeometry;
  readonly stationDial: THREE.BufferGeometry;
  readonly stationConveyor: THREE.BufferGeometry;
  readonly stationConveyorGuards: THREE.BufferGeometry;
  readonly stationRollers: THREE.BufferGeometry;
  readonly stationLoaderBase: THREE.BufferGeometry;
  readonly stationLoaderPortal: THREE.BufferGeometry;
  readonly stationLoaderArm: THREE.BufferGeometry;
  readonly stationLoaderJoint: THREE.BufferGeometry;
  readonly stationLoaderClaw: THREE.BufferGeometry;
  readonly stationLoadBoom: THREE.BufferGeometry;
  readonly stationLoadNozzle: THREE.BufferGeometry;
  readonly stationReceivingHopper: THREE.BufferGeometry;
  readonly stationTransferPayload: THREE.BufferGeometry;
  readonly stationTransferStream: THREE.BufferGeometry;
  readonly stationConveyorOreBed: THREE.BufferGeometry;
  readonly stationControlCabinet: THREE.BufferGeometry;
  readonly stationChute: THREE.BufferGeometry;
  readonly stationChuteBed: THREE.BufferGeometry;
  readonly stationChuteOre: THREE.BufferGeometry;
  readonly stationOreSourceBin: THREE.BufferGeometry;
  readonly stationServiceCartridge: THREE.BufferGeometry;
  readonly stationDistrict: StationDistrictGeometries;
  readonly underframe: THREE.BufferGeometry;
  readonly locomotiveBody: THREE.BufferGeometry;
  readonly locomotiveCab: THREE.BufferGeometry;
  readonly locomotiveNose: THREE.BufferGeometry;
  readonly locomotiveRoof: THREE.BufferGeometry;
  readonly locomotivePilot: THREE.BufferGeometry;
  readonly locomotiveBoilerBands: THREE.BufferGeometry;
  readonly locomotiveTopDetails: THREE.BufferGeometry;
  readonly cabSkylight: THREE.BufferGeometry;
  readonly locomotiveGrille: THREE.BufferGeometry;
  readonly locomotiveDeck: THREE.BufferGeometry;
  readonly locomotiveSidePanels: THREE.BufferGeometry;
  readonly locomotiveCooling: THREE.BufferGeometry;
  readonly locomotivePipework: THREE.BufferGeometry;
  readonly locomotiveSootPatch: THREE.BufferGeometry;
  readonly locomotiveDecals: THREE.BufferGeometry;
  readonly locomotiveHandrails: THREE.BufferGeometry;
  readonly chimney: THREE.BufferGeometry;
  readonly headlight: THREE.BufferGeometry;
  readonly bogie: THREE.BufferGeometry;
  readonly bogieSuspension: THREE.BufferGeometry;
  readonly wheel: THREE.BufferGeometry;
  readonly wheelFlange: THREE.BufferGeometry;
  readonly axle: THREE.BufferGeometry;
  readonly wheelHub: THREE.BufferGeometry;
  readonly sideRod: THREE.BufferGeometry;
  readonly coupler: THREE.BufferGeometry;
  readonly couplerHoses: THREE.BufferGeometry;
  readonly wagonBody: THREE.BufferGeometry;
  readonly wagonSidePanels: THREE.BufferGeometry;
  readonly wagonDischargeDoors: THREE.BufferGeometry;
  readonly wagonDoorBraces: THREE.BufferGeometry;
  readonly wagonBrakeRigging: THREE.BufferGeometry;
  readonly wagonBrakeStand: THREE.BufferGeometry;
  readonly wagonGrime: THREE.BufferGeometry;
  readonly wagonSlope: THREE.BufferGeometry;
  readonly wagonLadders: THREE.BufferGeometry;
  readonly wagonDecals: THREE.BufferGeometry;
  readonly wagonFloor: THREE.BufferGeometry;
  readonly wagonDischargeSpine: THREE.BufferGeometry;
  readonly wagonOreBedResidue: THREE.BufferGeometry;
  readonly wagonLip: THREE.BufferGeometry;
  readonly wagonCoveredShoulders: THREE.BufferGeometry;
  readonly wagonGondolaCrossTies: THREE.BufferGeometry;
  readonly wagonRimHardware: THREE.BufferGeometry;
  readonly wagonDraftSill: THREE.BufferGeometry;
  readonly wagonRibs: THREE.BufferGeometry;
  readonly wagonHazardPlate: THREE.BufferGeometry;
  readonly wagonServiceHatch: THREE.BufferGeometry;
  readonly cargoLoad: THREE.BufferGeometry;
  readonly fuelGauge: THREE.BufferGeometry;
  readonly routeDrum: THREE.BufferGeometry;
  readonly brakeShoe: THREE.BufferGeometry;
  readonly smokePuff: THREE.BufferGeometry;
  readonly overviewTrain: THREE.BufferGeometry;
  readonly overviewStation: THREE.BufferGeometry;
  readonly all: readonly THREE.BufferGeometry[];
}

interface IntegratedTurnoutGeometries {
  readonly ballast: THREE.BufferGeometry;
  readonly ballastDetail: THREE.BufferGeometry;
  readonly sleepers: THREE.BufferGeometry;
  readonly sleeperAccents: THREE.BufferGeometry;
  readonly rails: THREE.BufferGeometry;
  readonly railTops: THREE.BufferGeometry;
  readonly fasteners: THREE.BufferGeometry;
  readonly runningHardware: THREE.BufferGeometry;
  readonly linkage: THREE.BufferGeometry;
  readonly serviceApron: THREE.BufferGeometry;
  readonly cableTrough: THREE.BufferGeometry;
  readonly cableTroughHardware: THREE.BufferGeometry;
  readonly cableTroughGrime: THREE.BufferGeometry;
  readonly serviceCabinet: THREE.BufferGeometry;
  readonly switchLantern: THREE.BufferGeometry;
  readonly serviceSafety: THREE.BufferGeometry;
  readonly motor: THREE.BufferGeometry;
}

interface IntegratedBypassGeometries {
  readonly ballast: THREE.BufferGeometry;
  readonly ballastDetail: THREE.BufferGeometry;
  readonly sleepers: THREE.BufferGeometry;
  readonly sleeperAccents: THREE.BufferGeometry;
  readonly rails: THREE.BufferGeometry;
  readonly railTops: THREE.BufferGeometry;
  readonly fasteners: THREE.BufferGeometry;
}

interface IntegratedMainBedGeometries {
  readonly ballast: THREE.BufferGeometry;
  readonly ballastDetail: THREE.BufferGeometry;
}

interface StationDistrictGeometries {
  readonly ground: THREE.BufferGeometry;
  readonly steel: THREE.BufferGeometry;
  readonly paint: THREE.BufferGeometry;
  readonly safety: THREE.BufferGeometry;
  readonly props: THREE.BufferGeometry;
  readonly vegetation: THREE.BufferGeometry;
  readonly lights: THREE.BufferGeometry;
  readonly signBoard: THREE.BufferGeometry;
  readonly signName: THREE.BufferGeometry;
  readonly signLoad: THREE.BufferGeometry;
  readonly signUnload: THREE.BufferGeometry;
  readonly signService: THREE.BufferGeometry;
}

interface InstancedBatch {
  readonly key: string;
  readonly mesh: THREE.InstancedMesh;
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly parent: THREE.Object3D;
  readonly capacity: number;
}

interface TrainCarRig {
  readonly id: string;
  readonly kind: RailCarSnapshot["kind"];
  readonly root: THREE.Group;
  readonly longitudinalScale: number;
  readonly bogies: readonly THREE.Group[];
  readonly wheels: readonly THREE.Object3D[];
  readonly couplers: Readonly<{
    front: TrainCouplerRig;
    rear: TrainCouplerRig;
  }>;
  readonly rods: readonly THREE.Object3D[];
  readonly brakes: readonly THREE.Mesh[];
  readonly serviceHatches: readonly THREE.Mesh[];
  readonly servicePort?: THREE.Mesh;
  readonly cargoLoad?: THREE.Mesh;
  readonly fuelGauge?: THREE.Mesh;
  basePose: TrainPose;
}

interface TrainCouplerRig {
  readonly side: -1 | 1;
  readonly root: THREE.Group;
  readonly body: THREE.Mesh;
  readonly hoses: THREE.Mesh;
  readonly face: THREE.Object3D;
}

interface TrainPoseSample extends TrainPose {
  readonly distanceMilli: number;
}

interface TrainRig {
  readonly id: string;
  readonly root: THREE.Group;
  readonly carSignature: string;
  readonly cars: readonly TrainCarRig[];
  readonly statusLamp: THREE.Mesh;
  readonly routeDrum: THREE.Object3D;
  readonly smoke: readonly THREE.Mesh[];
  baseDistanceMilli: number;
  renderedDistanceMilli: number;
  baseX: number;
  baseZ: number;
  baseYaw: number;
  speedMilliPerTick: number;
  syncElapsedSeconds: number;
  status: RailTrainStatus;
  readonly poseHistory: TrainPoseSample[];
  poseHistoryResetCount: number;
  lastPoseHistoryResetReason: string | null;
  campaignWestTraversalDirection: -1 | 1 | null;
}

interface StationLoaderRig {
  readonly root: THREE.Group;
  readonly upperArm: THREE.Mesh;
  readonly forearm: THREE.Mesh;
  readonly claw: THREE.Mesh;
  readonly payload: THREE.Mesh;
  readonly wagonOffsetX: number;
}

interface StationLoadChuteRig {
  readonly root: THREE.Group;
  readonly boom: THREE.Mesh;
  readonly nozzle: THREE.Mesh;
  readonly gate: THREE.Mesh;
  readonly payload: THREE.Mesh;
  readonly serviceCartridge: THREE.Mesh;
  readonly wagonOffsetX: number;
}

interface StationRig {
  readonly id: string;
  readonly root: THREE.Group;
  readonly crane: THREE.Object3D;
  readonly serviceArm: THREE.Object3D;
  readonly statusLamp: THREE.Mesh;
  readonly cargoIndicator: THREE.Object3D;
  readonly scheduleDial: THREE.Object3D;
  readonly loadChainRoot: THREE.Group;
  readonly unloadChainRoot: THREE.Group;
  readonly loadChutes: readonly StationLoadChuteRig[];
  readonly loaders: readonly StationLoaderRig[];
  readonly beltPayloads: readonly THREE.Mesh[];
  readonly modeSigns: Readonly<{
    load: THREE.Mesh;
    unload: THREE.Mesh;
    service: THREE.Mesh;
  }>;
  readonly districtLight: THREE.PointLight;
  serviceActive: boolean;
  servicePhase: number;
  serviceMode: "load" | "unload" | "service";
  transferPhase: number;
  heroWagonIndex: number;
}

interface TrainPose {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

interface BatchEntry<T> {
  readonly value: T;
  readonly matrix: THREE.Matrix4;
}

const DEFAULT_OPTIONS: NormalizedOptions = Object.freeze({
  maxRenderedSegments: 8_192,
  maxRenderedSignals: 4_096,
  maxDetailedStations: 32,
  maxDetailedTrains: 24,
  maxDetailedCarsPerTrain: 8,
  maxOverviewCars: 8_192,
  maxRouteSegments: 4_096,
  showOperationalOverlays: false,
});

const EMPTY_STATUS_COUNTS: Readonly<Record<RailTrainStatus, number>> =
  Object.freeze({
    dwelling: 0,
    moving: 0,
    "waiting-signal": 0,
    "no-path": 0,
    "out-of-fuel": 0,
  });

const EMPTY_DEBUG: RailRenderDebug = Object.freeze({
  disposed: false,
  topologySignature: "rail-topology-00000000",
  stateSignature: "rail-state-00000000",
  tick: 0,
  topologyRevision: 0,
  segments: 0,
  renderedSegments: 0,
  omittedSegments: 0,
  straightSegments: 0,
  curvedSegments: 0,
  junctionSegments: 0,
  blocks: 0,
  occupiedBlocks: 0,
  reservedBlocks: 0,
  routeSegments: 0,
  omittedRouteSegments: 0,
  signals: 0,
  omittedSignals: 0,
  regularSignals: 0,
  chainSignals: 0,
  redSignals: 0,
  greenSignals: 0,
  chainClearSignals: 0,
  stations: 0,
  detailedStations: 0,
  overviewStations: 0,
  activeStations: 0,
  trains: 0,
  detailedTrains: 0,
  overviewTrains: 0,
  detailedCars: 0,
  overviewCars: 0,
  omittedCars: 0,
  locomotives: 0,
  cargoWagons: 0,
  cargoUnits: 0,
  fuelMilli: 0,
  statusCounts: EMPTY_STATUS_COUNTS,
  drawBatches: 0,
  triangles: 0,
  capacities: Object.freeze({
    trackInstances: 0,
    signalInstances: 0,
    overlayInstances: 0,
    overviewInstances: 0,
  }),
  resources: Object.freeze({
    ownedGeometries: 0,
    ownedMaterials: 0,
    ownedTextures: 0,
    liveInstancedMeshes: 0,
    disposedGeometries: 0,
    disposedMaterials: 0,
    disposedTextures: 0,
    disposedInstancedMeshes: 0,
  }),
  occupancyModel: "exclusive-block-atomic-consist",
});

const DIRECTION_VECTOR: Readonly<
  Record<RailDirection, readonly [number, number]>
> = Object.freeze({
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
});

const STATUS_ORDER: readonly RailTrainStatus[] = Object.freeze([
  "dwelling",
  "moving",
  "waiting-signal",
  "no-path",
  "out-of-fuel",
]);

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const WHEEL_RADIUS = 0.145;
const WHEEL_TRACK_Z = 0.19;
const CAR_SPACING = 2.56;
const COUPLER_CENTER_FROM_CAR = 1.1;
const COUPLER_KNUCKLE_FACE_FROM_CAR = 1.26;
const TRAIN_ROOT_Y = 0.485;
const CAMPAIGN_TURNOUT_START_X = -4.75;
const CAMPAIGN_TURNOUT_END_X = 3.25;
const CAMPAIGN_SIDING_SEPARATION = 1.62;
const CAMPAIGN_SIDING_START_X = 16.75;
const CAMPAIGN_SIDING_LENGTH = 4.5;

function normalizeBoundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const normalized = value ?? fallback;
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < 0 ||
    normalized > maximum
  ) {
    throw new Error(
      `Rail renderer ${label} must be an integer from 0 to ${maximum}.`,
    );
  }
  return normalized;
}

function normalizeOptions(options: RailRendererOptions): NormalizedOptions {
  return Object.freeze({
    maxRenderedSegments: normalizeBoundedInteger(
      options.maxRenderedSegments,
      DEFAULT_OPTIONS.maxRenderedSegments,
      RAIL_LIMITS.maxSegments,
      "maxRenderedSegments",
    ),
    maxRenderedSignals: normalizeBoundedInteger(
      options.maxRenderedSignals,
      DEFAULT_OPTIONS.maxRenderedSignals,
      RAIL_LIMITS.maxSignals,
      "maxRenderedSignals",
    ),
    maxDetailedStations: normalizeBoundedInteger(
      options.maxDetailedStations,
      DEFAULT_OPTIONS.maxDetailedStations,
      RAIL_LIMITS.maxStations,
      "maxDetailedStations",
    ),
    maxDetailedTrains: normalizeBoundedInteger(
      options.maxDetailedTrains,
      DEFAULT_OPTIONS.maxDetailedTrains,
      RAIL_LIMITS.maxTrains,
      "maxDetailedTrains",
    ),
    maxDetailedCarsPerTrain: normalizeBoundedInteger(
      options.maxDetailedCarsPerTrain,
      DEFAULT_OPTIONS.maxDetailedCarsPerTrain,
      RAIL_LIMITS.maxCarsPerTrain,
      "maxDetailedCarsPerTrain",
    ),
    maxOverviewCars: normalizeBoundedInteger(
      options.maxOverviewCars,
      DEFAULT_OPTIONS.maxOverviewCars,
      RAIL_LIMITS.maxTrains * RAIL_LIMITS.maxCarsPerTrain,
      "maxOverviewCars",
    ),
    maxRouteSegments: normalizeBoundedInteger(
      options.maxRouteSegments,
      DEFAULT_OPTIONS.maxRouteSegments,
      RAIL_LIMITS.maxSegments,
      "maxRouteSegments",
    ),
    showOperationalOverlays: options.showOperationalOverlays ?? false,
  });
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}

function fnv1a(parts: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= part.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function powerOfTwoCapacity(count: number): number {
  if (count <= 0) return 0;
  let capacity = 1;
  while (capacity < count) capacity *= 2;
  return capacity;
}

function nameMaterial<T extends THREE.Material>(material: T, name: string): T {
  material.name = `rail-${name}`;
  return material;
}

function createNoiseTexture(
  name: string,
  size: number,
  base: readonly [number, number, number],
  variation: number,
): THREE.DataTexture {
  const pixels = new Uint8Array(size * size * 4);
  let state = 0x7261_696c;
  for (let index = 0; index < size * size; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const noise = ((state >>> 16) / 0xffff - 0.5) * variation;
    const offset = index * 4;
    pixels[offset] = Math.max(0, Math.min(255, base[0] + noise));
    pixels[offset + 1] = Math.max(0, Math.min(255, base[1] + noise));
    pixels[offset + 2] = Math.max(0, Math.min(255, base[2] + noise));
    pixels[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.name = name;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createAgedSurfaceTexture(): THREE.Texture {
  if (typeof document === "undefined") {
    return createNoiseTexture(
      "rail-painted-metal-wear-surface",
      128,
      [188, 181, 166],
      96,
    );
  }
  const texture = new THREE.TextureLoader().load(
    "/assets/cinder-painted-steel-aged-v2.png",
  );
  texture.name = "rail-painted-metal-wear-surface";
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.35, 2.35);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.userData = {
    source: "/assets/cinder-painted-steel-aged-v2.png",
    sourceSha256:
      "ebf288d942b2f215f7c92c8ced8b138aaba393698b218e953bac455ae72e0893",
  };
  return texture;
}

function createAgedBallastTexture(): THREE.Texture {
  if (typeof document === "undefined") {
    const texture = createNoiseTexture(
      "rail-ballast-procedural-surface",
      128,
      [168, 158, 140],
      62,
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
  const texture = new THREE.TextureLoader().load(
    "/assets/cinder-rail-ballast-aged-v2.png",
  );
  texture.name = "rail-ballast-procedural-surface";
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.8, 2.8);
  // This is photographic albedo, not linear data. Decode it from sRGB once
  // before the physically lit material uses it; otherwise the mid-tones are
  // promoted into a pale, concrete-like roadbed.
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.userData = {
    source: "/assets/cinder-rail-ballast-aged-v2.png",
    sourceSha256:
      "e6c506cb0ae6e051ac059f52ffd4730f27c3ec6d092b5e079620877941f3e0d3",
  };
  return texture;
}

function createSmokeTexture(): THREE.DataTexture {
  const size = 48;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / (size / 2) - 1;
      const ny = (y + 0.5) / (size / 2) - 1;
      const radius = Math.sqrt(nx * nx + ny * ny);
      const turbulence =
        Math.sin(x * 0.47 + y * 0.21) * Math.cos(y * 0.39 - x * 0.17) * 0.08;
      const alpha = Math.max(0, 1 - radius + turbulence);
      const offset = (y * size + x) * 4;
      pixels[offset] = 194;
      pixels[offset + 1] = 203;
      pixels[offset + 2] = 198;
      pixels[offset + 3] = Math.round(alpha * alpha * 180);
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.name = "rail-exhaust-vapor";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createMaterials(
  ballastTexture: THREE.Texture,
  surfaceTexture: THREE.Texture,
  smokeTexture: THREE.DataTexture,
): RailMaterials {
  const ballast = nameMaterial(
    new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(0.82, 0.78, 0.7),
      map: ballastTexture,
    }),
    "continuous-graded-ballast-bed",
  );
  const ballastDark = nameMaterial(
    new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(0.64, 0.6, 0.54),
      map: ballastTexture,
    }),
    "ballast-compacted-shoulder-and-drainage",
  );
  const junctionBallast = nameMaterial(
    new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(0.76, 0.71, 0.63),
      map: ballastTexture,
    }),
    "turnout-continuous-graded-ballast-bed",
  );
  const sleeper = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x654936,
      bumpMap: surfaceTexture,
      bumpScale: 0.032,
      roughness: 0.92,
      metalness: 0.02,
      emissive: 0x1c120c,
      emissiveIntensity: 0.08,
    }),
    "creosote-sleeper-aged",
  );
  const sleeperAlt = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x7a563b,
      bumpMap: surfaceTexture,
      bumpScale: 0.028,
      roughness: 0.94,
      metalness: 0.01,
      emissive: 0x21150d,
      emissiveIntensity: 0.08,
    }),
    "creosote-sleeper-sunbleached",
  );
  const junctionSleeper = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x503525,
      bumpMap: surfaceTexture,
      bumpScale: 0.034,
      roughness: 0.96,
      metalness: 0.01,
    }),
    "turnout-creosote-timber-dark",
  );
  const junctionSleeperAlt = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x67452e,
      bumpMap: surfaceTexture,
      bumpScale: 0.03,
      roughness: 0.95,
      metalness: 0.01,
    }),
    "turnout-creosote-timber-weathered",
  );
  const rail = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x8b5b47,
      bumpMap: surfaceTexture,
      bumpScale: 0.012,
      roughness: 0.58,
      metalness: 0.84,
    }),
    "rusted-rolled-steel-base-and-web",
  );
  const railTop = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xc5cfcb,
      roughness: 0.31,
      metalness: 0.88,
      emissive: 0x26302e,
      emissiveIntensity: 0.16,
    }),
    "polished-running-surface",
  );
  const junctionRailTop = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xaeb9b4,
      roughness: 0.42,
      metalness: 0.82,
      emissive: 0x222a28,
      emissiveIntensity: 0.14,
    }),
    "turnout-weathered-running-surface",
  );
  const fastener = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x5d5851,
      roughness: 0.66,
      metalness: 0.8,
    }),
    "greased-rail-fastener",
  );
  const switchMetal = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xb0a18a,
      roughness: 0.42,
      metalness: 0.82,
      emissive: 0x241b13,
      emissiveIntensity: 0.12,
    }),
    "switch-actuator-bronze",
  );
  const turnoutLinkage = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xe0b665,
      roughness: 0.34,
      metalness: 0.78,
      emissive: 0x5a3112,
      emissiveIntensity: 0.3,
    }),
    "turnout-high-contrast-brass-linkage",
  );
  const turnoutServiceConcrete = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x77736a,
      roughness: 0.88,
      metalness: 0.08,
      emissive: 0x201e1a,
      emissiveIntensity: 0.16,
    }),
    "turnout-drained-service-concrete",
  );
  const turnoutCableTrough = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x3f4542,
      bumpMap: surfaceTexture,
      bumpScale: 0.026,
      roughness: 0.82,
      metalness: 0.46,
      emissive: 0x101613,
      emissiveIntensity: 0.12,
    }),
    "turnout-weathered-charcoal-oxide-cable-trough",
  );
  const turnoutServiceHousing = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x718985,
      roughness: 0.64,
      metalness: 0.5,
      emissive: 0x1b2c29,
      emissiveIntensity: 0.26,
    }),
    "turnout-weatherproof-service-housing",
  );
  const blockOccupied = nameMaterial(
    new THREE.MeshBasicMaterial({
      color: 0xff8a3d,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      blending: THREE.NormalBlending,
    }),
    "occupied-block-halo",
  );
  const blockReserved = nameMaterial(
    new THREE.MeshBasicMaterial({
      color: 0x4fa8d8,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.NormalBlending,
    }),
    "reserved-block-halo",
  );
  const route = nameMaterial(
    new THREE.MeshBasicMaterial({
      color: 0x7ce6c1,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.NormalBlending,
    }),
    "authoritative-route-inlay",
  );
  const signalPost = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x849397,
      roughness: 0.62,
      metalness: 0.7,
    }),
    "signal-galvanized-post",
  );
  const signalHousing = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x465458,
      roughness: 0.53,
      metalness: 0.58,
    }),
    "signal-armored-housing",
  );
  const signalBlack = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x222b2e,
      roughness: 0.82,
      metalness: 0.15,
    }),
    "signal-hood",
  );
  const emissive = (
    color: number,
    emissiveColor: number,
    name: string,
  ): THREE.MeshStandardMaterial =>
    nameMaterial(
      new THREE.MeshStandardMaterial({
        color,
        emissive: emissiveColor,
        emissiveIntensity: 2.15,
        roughness: 0.24,
        metalness: 0.04,
      }),
      name,
    );
  const lampRed = emissive(0xff6044, 0xe42412, "signal-red-lens");
  const lampGreen = emissive(0x80ffd2, 0x18d999, "signal-green-lens");
  const lampChain = emissive(0x7eeeff, 0x20bad8, "chain-signal-clear-lens");
  const platform = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x5f625c,
      bumpMap: surfaceTexture,
      bumpScale: 0.018,
      roughness: 0.88,
      metalness: 0.04,
      emissive: 0x171916,
      emissiveIntensity: 0.18,
    }),
    "station-cast-concrete",
  );
  const platformEdge = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xd58a30,
      roughness: 0.7,
      metalness: 0.24,
    }),
    "station-safety-edge",
  );
  const stationSteel = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x748481,
      bumpMap: surfaceTexture,
      bumpScale: 0.014,
      roughness: 0.49,
      metalness: 0.68,
      emissive: 0x152020,
      emissiveIntensity: 0.1,
    }),
    "station-structural-steel",
  );
  const stationPaint = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x3e817c,
      bumpMap: surfaceTexture,
      bumpScale: 0.026,
      roughness: 0.65,
      metalness: 0.4,
      emissive: 0x0a201f,
      emissiveIntensity: 0.08,
    }),
    "station-service-enamel",
  );
  const safety = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xe7a438,
      roughness: 0.52,
      metalness: 0.35,
    }),
    "industrial-safety-yellow",
  );
  const locomotive = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x8f4433,
      bumpMap: surfaceTexture,
      roughnessMap: surfaceTexture,
      bumpScale: 0.034,
      roughness: 0.68,
      metalness: 0.5,
    }),
    "locomotive-chipped-oxide-armor",
  );
  const locomotiveAccent = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xc48b35,
      bumpMap: surfaceTexture,
      bumpScale: 0.024,
      roughness: 0.66,
      metalness: 0.48,
    }),
    "locomotive-worn-brass-band",
  );
  const locomotiveSecondary = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x66706d,
      bumpMap: surfaceTexture,
      bumpScale: 0.034,
      roughness: 0.78,
      metalness: 0.55,
    }),
    "locomotive-heat-darkened-machinery",
  );
  const locomotivePanel = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xa65440,
      bumpMap: surfaceTexture,
      bumpScale: 0.026,
      roughness: 0.64,
      metalness: 0.54,
    }),
    "locomotive-replacement-panel",
  );
  const locomotiveSoot = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x252726,
      transparent: true,
      opacity: 0.84,
      roughness: 0.97,
      metalness: 0.08,
      depthWrite: false,
    }),
    "locomotive-soot-and-oil",
  );
  const wagon = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x8a5c47,
      bumpMap: surfaceTexture,
      bumpScale: 0.038,
      roughness: 0.82,
      metalness: 0.42,
    }),
    "wagon-oxide-brown-steel",
  );
  const wagonSecondary = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x718583,
      bumpMap: surfaceTexture,
      bumpScale: 0.038,
      roughness: 0.8,
      metalness: 0.46,
    }),
    "wagon-patched-blue-grey-steel",
  );
  const wagonRust = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x8f4e31,
      bumpMap: surfaceTexture,
      bumpScale: 0.025,
      roughness: 0.82,
      metalness: 0.38,
    }),
    "wagon-rust-streaks",
  );
  const wagonInterior = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x454b48,
      bumpMap: surfaceTexture,
      bumpScale: 0.03,
      roughness: 0.91,
      metalness: 0.38,
    }),
    "wagon-interior",
  );
  const wagonBasin = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x563629,
      bumpMap: surfaceTexture,
      bumpScale: 0.032,
      roughness: 0.93,
      metalness: 0.28,
      emissive: 0x150b07,
      emissiveIntensity: 0.08,
    }),
    "wagon-weathered-dark-rust-basin",
  );
  const wagonOreResidue = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x70451f,
      bumpMap: surfaceTexture,
      bumpScale: 0.036,
      roughness: 0.97,
      metalness: 0.05,
      emissive: 0x180b03,
      emissiveIntensity: 0.06,
    }),
    "wagon-low-ochre-ore-bed-residue-not-authoritative-cargo",
  );
  const oil = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x171a18,
      roughness: 0.22,
      metalness: 0.32,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    }),
    "rail-oil-contact-grime",
  );
  const decal = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xe1ce91,
      roughness: 0.76,
      metalness: 0.18,
    }),
    "rail-chipped-stencil-decal",
  );
  const conveyor = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x59615e,
      roughness: 0.84,
      metalness: 0.42,
    }),
    "station-greased-conveyor",
  );
  const rubber = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x2d3334,
      roughness: 0.92,
      metalness: 0.2,
    }),
    "wheel-dark-steel",
  );
  const glass = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x536a6d,
      emissive: 0x142225,
      emissiveIntensity: 0.18,
      roughness: 0.32,
      metalness: 0.12,
      transparent: false,
    }),
    "cab-laminated-glass",
  );
  const cargoMaterial = (
    color: number,
    name: string,
  ): THREE.MeshStandardMaterial =>
    nameMaterial(
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.78,
        metalness: 0.18,
      }),
      name,
    );
  const cargoIron = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x53656b,
      emissive: 0x12191b,
      emissiveIntensity: 0.1,
      roughness: 0.93,
      metalness: 0.06,
    }),
    "cargo-iron-ore",
  );
  const cargoIronTransfer = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xb96732,
      emissive: 0x321208,
      emissiveIntensity: 0.16,
      roughness: 0.88,
      metalness: 0.08,
    }),
    "cargo-fresh-fractured-iron-ore-transfer",
  );
  const cargoCopper = cargoMaterial(0xc87842, "cargo-copper");
  const cargoCoal = cargoMaterial(0x22292d, "cargo-coal");
  const cargoStone = cargoMaterial(0x9f9477, "cargo-stone");
  const cargoProduct = cargoMaterial(0x55b8ac, "cargo-product");
  const brake = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x4b3530,
      roughness: 0.72,
      metalness: 0.45,
    }),
    "brake-shoe",
  );
  const brakeHot = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xff8a3d,
      emissive: 0xe33f0d,
      emissiveIntensity: 2.1,
      roughness: 0.48,
      metalness: 0.38,
    }),
    "brake-shoe-hot",
  );
  const active = emissive(0xa7ffe6, 0x27d8ae, "service-active");
  const warning = emissive(0xffbb62, 0xe56c20, "service-warning");
  const inactive = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x536062,
      emissive: 0x10191a,
      emissiveIntensity: 0.2,
      roughness: 0.72,
      metalness: 0.34,
    }),
    "service-inactive",
  );
  const yardVegetation = nameMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x65774c,
      bumpMap: surfaceTexture,
      bumpScale: 0.02,
      roughness: 0.98,
      metalness: 0,
    }),
    "yard-dry-weeds",
  );
  const smoke = nameMaterial(
    new THREE.MeshBasicMaterial({
      map: smokeTexture,
      color: 0xb8c4c0,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    "locomotive-exhaust",
  );
  return {
    ballast,
    ballastDark,
    junctionBallast,
    sleeper,
    sleeperAlt,
    junctionSleeper,
    junctionSleeperAlt,
    rail,
    railTop,
    junctionRailTop,
    fastener,
    switchMetal,
    turnoutLinkage,
    turnoutServiceConcrete,
    turnoutCableTrough,
    turnoutServiceHousing,
    blockOccupied,
    blockReserved,
    route,
    signalPost,
    signalHousing,
    signalBlack,
    lampRed,
    lampGreen,
    lampChain,
    platform,
    platformEdge,
    stationSteel,
    stationPaint,
    safety,
    locomotive,
    locomotiveAccent,
    locomotiveSecondary,
    locomotivePanel,
    locomotiveSoot,
    wagon,
    wagonSecondary,
    wagonRust,
    wagonInterior,
    wagonBasin,
    wagonOreResidue,
    oil,
    decal,
    conveyor,
    rubber,
    glass,
    cargoIron,
    cargoIronTransfer,
    cargoCopper,
    cargoCoal,
    cargoStone,
    cargoProduct,
    brake,
    brakeHot,
    active,
    warning,
    inactive,
    yardVegetation,
    smoke,
    all: [
      ballast,
      ballastDark,
      junctionBallast,
      sleeper,
      sleeperAlt,
      junctionSleeper,
      junctionSleeperAlt,
      rail,
      railTop,
      junctionRailTop,
      fastener,
      switchMetal,
      turnoutLinkage,
      turnoutServiceConcrete,
      turnoutCableTrough,
      turnoutServiceHousing,
      blockOccupied,
      blockReserved,
      route,
      signalPost,
      signalHousing,
      signalBlack,
      lampRed,
      lampGreen,
      lampChain,
      platform,
      platformEdge,
      stationSteel,
      stationPaint,
      safety,
      locomotive,
      locomotiveAccent,
      locomotiveSecondary,
      locomotivePanel,
      locomotiveSoot,
      wagon,
      wagonSecondary,
      wagonRust,
      wagonInterior,
      wagonBasin,
      wagonOreResidue,
      oil,
      decal,
      conveyor,
      rubber,
      glass,
      cargoIron,
      cargoIronTransfer,
      cargoCopper,
      cargoCoal,
      cargoStone,
      cargoProduct,
      brake,
      brakeHot,
      active,
      warning,
      inactive,
      yardVegetation,
      smoke,
    ],
  };
}

function mergeOwned(
  pieces: THREE.BufferGeometry[],
  name: string,
): THREE.BufferGeometry {
  const normalized = pieces.map((piece) =>
    piece.index ? piece.toNonIndexed() : piece,
  );
  const merged = mergeGeometries(normalized, false);
  for (const geometry of normalized) geometry.dispose();
  for (const piece of pieces) {
    if (!normalized.includes(piece)) piece.dispose();
  }
  if (!merged) throw new Error(`Unable to build ${name}.`);
  merged.name = name;
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function mirroredX(
  source: THREE.BufferGeometry,
  name: string,
): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  geometry.scale(-1, 1, 1);
  // Mirroring reverses triangle winding. Swap the second and third vertex of
  // every triangle so the reflected turnout remains front-facing and keeps
  // correct normals without resorting to a costly double-sided material.
  for (const attribute of Object.values(geometry.attributes)) {
    for (let vertex = 0; vertex + 2 < attribute.count; vertex += 3) {
      const left = vertex + 1;
      const right = vertex + 2;
      if (attribute.itemSize === 2) {
        const x = attribute.getX(left);
        const y = attribute.getY(left);
        attribute.setXY(left, attribute.getX(right), attribute.getY(right));
        attribute.setXY(right, x, y);
      } else if (attribute.itemSize === 3) {
        const x = attribute.getX(left);
        const y = attribute.getY(left);
        const z = attribute.getZ(left);
        attribute.setXYZ(
          left,
          attribute.getX(right),
          attribute.getY(right),
          attribute.getZ(right),
        );
        attribute.setXYZ(right, x, y, z);
      } else if (attribute.itemSize === 4) {
        const x = attribute.getX(left);
        const y = attribute.getY(left);
        const z = attribute.getZ(left);
        const w = attribute.getW(left);
        attribute.setXYZW(
          left,
          attribute.getX(right),
          attribute.getY(right),
          attribute.getZ(right),
          attribute.getW(right),
        );
        attribute.setXYZW(right, x, y, z, w);
      }
      attribute.needsUpdate = true;
    }
  }
  geometry.name = name;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function transformedBox(
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  yaw = 0,
  bevel = 0,
): THREE.BufferGeometry {
  const geometry =
    bevel > 0
      ? new RoundedBoxGeometry(width, height, depth, 2, bevel)
      : new THREE.BoxGeometry(width, height, depth);
  geometry.rotateY(yaw);
  geometry.translate(x, y, z);
  return geometry;
}

function transformedBoxZ(
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  roll = 0,
  bevel = 0,
): THREE.BufferGeometry {
  const geometry =
    bevel > 0
      ? new RoundedBoxGeometry(width, height, depth, 2, bevel)
      : new THREE.BoxGeometry(width, height, depth);
  geometry.rotateZ(roll);
  geometry.translate(x, y, z);
  return geometry;
}

function transformedCylinder(
  radius: number,
  height: number,
  x: number,
  y: number,
  z: number,
  radialSegments = 10,
): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(
    radius,
    radius,
    height,
    radialSegments,
    1,
  );
  geometry.translate(x, y, z);
  return geometry;
}

function transformedRock(
  radius: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  scaleX = 1,
  scaleZ = 1,
): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, 0);
  geometry.scale(scaleX, 0.62, scaleZ);
  geometry.rotateY(yaw);
  geometry.translate(x, y, z);
  return geometry;
}

function prismFromOutline(
  outline: readonly (readonly [number, number])[],
  yMin: number,
  yMax: number,
  name: string,
): THREE.BufferGeometry {
  if (outline.length < 3) {
    throw new Error(`${name} requires at least three outline points.`);
  }
  const signedArea = outline.reduce((sum, point, index) => {
    const next = outline[(index + 1) % outline.length]!;
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  const points = signedArea <= 0 ? [...outline] : [...outline].reverse();
  const positions: number[] = [];
  const uvs: number[] = [];
  const xs = points.map(([x]) => x);
  const zs = points.map(([, z]) => z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const width = Math.max(0.0001, maxX - minX);
  const depth = Math.max(0.0001, maxZ - minZ);
  for (const y of [yMax, yMin]) {
    for (const [x, z] of points) {
      positions.push(x, y, z);
      uvs.push((x - minX) / width, (z - minZ) / depth);
    }
  }
  const indices: number[] = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    indices.push(0, index, index + 1);
    indices.push(
      points.length,
      points.length + index + 1,
      points.length + index,
    );
  }
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    const topA = index;
    const topB = next;
    const bottomA = points.length + index;
    const bottomB = points.length + next;
    indices.push(topA, bottomA, topB, topB, bottomA, bottomB);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = name;
  return geometry;
}

function prismFromSideOutline(
  outline: readonly (readonly [number, number])[],
  zMin: number,
  zMax: number,
  name: string,
): THREE.BufferGeometry {
  if (outline.length < 3) {
    throw new Error(`${name} requires at least three side-profile points.`);
  }
  const signedArea = outline.reduce((sum, point, index) => {
    const next = outline[(index + 1) % outline.length]!;
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  const points = signedArea >= 0 ? [...outline] : [...outline].reverse();
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(0.0001, maxX - minX);
  const height = Math.max(0.0001, maxY - minY);
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const z of [zMax, zMin]) {
    for (const [x, y] of points) {
      positions.push(x, y, z);
      uvs.push((x - minX) / width, (y - minY) / height);
    }
  }
  const indices: number[] = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    indices.push(0, index, index + 1);
    indices.push(
      points.length,
      points.length + index + 1,
      points.length + index,
    );
  }
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    const frontA = index;
    const frontB = next;
    const backA = points.length + index;
    const backB = points.length + next;
    indices.push(frontA, backA, frontB, frontB, backA, backB);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = name;
  return geometry;
}

function forwardFacingCylinder(
  radius: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  radialSegments = 12,
): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(
    radius,
    radius,
    depth,
    radialSegments,
    1,
  );
  geometry.rotateX(Math.PI / 2);
  geometry.translate(x, y, z);
  return geometry;
}

function pathBoxes(
  points: readonly THREE.Vector3[],
  width: number,
  height: number,
  y: number,
): THREE.BufferGeometry[] {
  const pieces: THREE.BufferGeometry[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.sqrt(dx * dx + dz * dz) + 0.025;
    const geometry = new THREE.BoxGeometry(length, height, width);
    geometry.rotateY(-Math.atan2(dz, dx));
    geometry.translate((start.x + end.x) / 2, y, (start.z + end.z) / 2);
    pieces.push(geometry);
  }
  return pieces;
}

function pathRibbon(
  points: readonly THREE.Vector3[],
  width: number,
  height: number,
  y: number,
  name: string,
  endWidth = width,
  widthModulation?: (index: number, progress: number) => number,
): THREE.BufferGeometry {
  if (points.length < 2) {
    throw new Error(`${name} requires at least two path points.`);
  }
  const halfHeight = height / 2;
  const positions: number[] = [];
  const uvs: number[] = [];
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    lengths.push(
      lengths[index - 1]! + points[index]!.distanceTo(points[index - 1]!),
    );
  }
  const totalLength = Math.max(0.0001, lengths.at(-1)!);
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const before = points[Math.max(0, index - 1)]!;
    const after = points[Math.min(points.length - 1, index + 1)]!;
    const tangentX = after.x - before.x;
    const tangentZ = after.z - before.z;
    const tangentLength = Math.max(0.0001, Math.hypot(tangentX, tangentZ));
    const normalX = -tangentZ / tangentLength;
    const normalZ = tangentX / tangentLength;
    const progress = lengths[index]! / totalLength;
    const modulation = widthModulation?.(index, progress) ?? 1;
    const halfWidth =
      ((width + (endWidth - width) * progress) * Math.max(0.72, modulation)) /
      2;
    const leftX = point.x + normalX * halfWidth;
    const leftZ = point.z + normalZ * halfWidth;
    const rightX = point.x - normalX * halfWidth;
    const rightZ = point.z - normalZ * halfWidth;
    const u = lengths[index]! / totalLength;
    positions.push(
      leftX,
      y + halfHeight,
      leftZ,
      rightX,
      y + halfHeight,
      rightZ,
      leftX,
      y - halfHeight,
      leftZ,
      rightX,
      y - halfHeight,
      rightZ,
    );
    uvs.push(u, 0, u, 1, u, 0, u, 1);
  }
  const indices: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = (index - 1) * 4;
    const current = index * 4;
    indices.push(
      previous,
      current,
      previous + 1,
      previous + 1,
      current,
      current + 1,
      previous + 2,
      previous + 3,
      current + 2,
      previous + 3,
      current + 3,
      current + 2,
      previous,
      previous + 2,
      current,
      previous + 2,
      current + 2,
      current,
      previous + 1,
      current + 1,
      previous + 3,
      previous + 3,
      current + 1,
      current + 3,
    );
  }
  const last = (points.length - 1) * 4;
  indices.push(
    0,
    1,
    2,
    1,
    3,
    2,
    last,
    last + 2,
    last + 1,
    last + 1,
    last + 2,
    last + 3,
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = name;
  return geometry;
}

function cubicTrackPoints(
  entry: readonly [number, number],
  entryControl: readonly [number, number],
  exitControl: readonly [number, number],
  exit: readonly [number, number],
  count: number,
  lateralOffset = 0,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    const inverse = 1 - t;
    const x =
      inverse * inverse * inverse * entry[0] +
      3 * inverse * inverse * t * entryControl[0] +
      3 * inverse * t * t * exitControl[0] +
      t * t * t * exit[0];
    const z =
      inverse * inverse * inverse * entry[1] +
      3 * inverse * inverse * t * entryControl[1] +
      3 * inverse * t * t * exitControl[1] +
      t * t * t * exit[1];
    const derivativeX =
      3 * inverse * inverse * (entryControl[0] - entry[0]) +
      6 * inverse * t * (exitControl[0] - entryControl[0]) +
      3 * t * t * (exit[0] - exitControl[0]);
    const derivativeZ =
      3 * inverse * inverse * (entryControl[1] - entry[1]) +
      6 * inverse * t * (exitControl[1] - entryControl[1]) +
      3 * t * t * (exit[1] - exitControl[1]);
    const length = Math.max(
      0.0001,
      Math.sqrt(derivativeX * derivativeX + derivativeZ * derivativeZ),
    );
    points.push(
      new THREE.Vector3(
        x + (-derivativeZ / length) * lateralOffset,
        0,
        z + (derivativeX / length) * lateralOffset,
      ),
    );
  }
  return points;
}

function minimumPolylineRadius(points: readonly THREE.Vector3[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length - 1; index += 1) {
    const left = points[index - 1]!;
    const center = points[index]!;
    const right = points[index + 1]!;
    const a = left.distanceTo(center);
    const b = center.distanceTo(right);
    const c = right.distanceTo(left);
    const twiceArea = Math.abs(
      (center.x - left.x) * (right.z - left.z) -
        (center.z - left.z) * (right.x - left.x),
    );
    if (twiceArea <= 1e-9) continue;
    const radius = (a * b * c) / (2 * twiceArea);
    minimum = Math.min(minimum, radius);
  }
  return minimum;
}

function campaignTurnoutMinimumEquivalentRadius(): number {
  return minimumPolylineRadius(
    cubicTrackPoints(
      [CAMPAIGN_TURNOUT_START_X, 0],
      [-1.75, CAMPAIGN_SIDING_SEPARATION * 0.00925],
      [0.25, CAMPAIGN_SIDING_SEPARATION * 0.9784],
      [CAMPAIGN_TURNOUT_END_X, CAMPAIGN_SIDING_SEPARATION],
      128,
    ),
  );
}

function quadraticTrackPoints(
  entry: readonly [number, number],
  exit: readonly [number, number],
  count: number,
  lateralOffset = 0,
): THREE.Vector3[] {
  const circularControlScale = 0.447715;
  return cubicTrackPoints(
    entry,
    [entry[0] * circularControlScale, entry[1] * circularControlScale],
    [exit[0] * circularControlScale, exit[1] * circularControlScale],
    exit,
    count,
    lateralOffset,
  );
}

function tubeAlong(
  points: readonly THREE.Vector3[],
  radius: number,
  y: number,
  name: string,
): THREE.BufferGeometry {
  const elevated = points.map(
    (point) => new THREE.Vector3(point.x, y, point.z),
  );
  const geometry = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(elevated),
    Math.max(8, points.length * 2),
    radius,
    6,
    false,
  );
  geometry.name = name;
  return geometry;
}

function createStraightGeometries(): {
  ballast: THREE.BufferGeometry;
  ballastDetail: THREE.BufferGeometry;
  sleepers: THREE.BufferGeometry;
  sleeperAccents: THREE.BufferGeometry;
  rails: THREE.BufferGeometry;
  railTops: THREE.BufferGeometry;
  fasteners: THREE.BufferGeometry;
} {
  const groundedShoulderStone: THREE.BufferGeometry[] = [];
  for (let index = 0; index < 12; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const lane = Math.floor(index / 2);
    const radius = 0.012 + (lane % 4) * 0.0025;
    groundedShoulderStone.push(
      transformedRock(
        radius,
        -0.455 + (lane % 6) * 0.182 + Math.sin(lane * 1.93) * 0.012,
        0.057 + radius * 0.28,
        side * (0.355 + (lane % 3) * 0.025),
        lane * 1.731 + side,
        1.18 + (lane % 3) * 0.11,
        0.7 + (lane % 2) * 0.13,
      ),
    );
  }
  const ballast = mergeOwned(
    [
      prismFromOutline(
        [
          [-0.53, -0.48],
          [-0.34, -0.55],
          [-0.12, -0.455],
          [0.08, -0.545],
          [0.31, -0.47],
          [0.53, -0.48],
          [0.53, 0.48],
          [0.34, 0.55],
          [0.12, 0.46],
          [-0.08, 0.545],
          [-0.31, 0.47],
          [-0.53, 0.48],
        ],
        0.006,
        0.035,
        "rail-straight-irregular-terrain-bleed-shoulder",
      ),
    ],
    "rail-straight-ballast-geometry",
  );
  const ballastDetail = mergeOwned(
    [
      transformedBox(1.06, 0.062, 0.82, 0, 0.064, 0, 0, 0.018),
      transformedBox(1.065, 0.022, 0.16, 0, 0.058, -0.47, 0, 0.014),
      transformedBox(1.065, 0.022, 0.16, 0, 0.058, 0.47, 0, 0.014),
      ...groundedShoulderStone,
    ],
    "rail-straight-compacted-shoulder-and-drainage-geometry",
  );
  const sleeperPieces: THREE.BufferGeometry[] = [];
  const sleeperAccentPieces: THREE.BufferGeometry[] = [];
  const fastenerPieces: THREE.BufferGeometry[] = [];
  const sleeperPositions = [-0.39, -0.13, 0.13, 0.39] as const;
  for (let index = 0; index < sleeperPositions.length; index += 1) {
    const x = sleeperPositions[index]!;
    const yaw = [0.01, -0.007, 0.006, -0.009][index]!;
    const sleeper = transformedBox(
      0.064 + (index % 3) * 0.006,
      0.058,
      0.68 + (index % 2) * 0.028,
      x,
      0.108,
      0,
      yaw,
      0.009,
    );
    (index === 1 ? sleeperAccentPieces : sleeperPieces).push(sleeper);
    for (const railZ of [-0.19, 0.19]) {
      fastenerPieces.push(
        transformedBox(0.078, 0.018, 0.122, x, 0.151, railZ, yaw, 0.005),
      );
      for (const clipOffset of [-0.052, 0.052]) {
        fastenerPieces.push(
          transformedBox(
            0.046,
            0.027,
            0.022,
            x,
            0.169,
            railZ + clipOffset,
            yaw,
            0.004,
          ),
        );
        fastenerPieces.push(
          transformedCylinder(
            0.011,
            0.033,
            x,
            0.171,
            railZ + clipOffset * 1.35,
            8,
          ),
        );
      }
    }
  }
  return {
    ballast,
    ballastDetail,
    sleepers: mergeOwned(sleeperPieces, "rail-straight-sleepers-geometry"),
    sleeperAccents: mergeOwned(
      sleeperAccentPieces,
      "rail-straight-sleeper-variation-geometry",
    ),
    rails: mergeOwned(
      [-0.19, 0.19].flatMap((railZ) => [
        transformedBox(1.07, 0.018, 0.09, 0, 0.155, railZ, 0, 0.004),
        transformedBox(1.07, 0.064, 0.03, 0, 0.19, railZ, 0, 0.004),
      ]),
      "rail-straight-rails-geometry",
    ),
    railTops: mergeOwned(
      [
        transformedBox(1.075, 0.018, 0.058, 0, 0.229, -0.19, 0, 0.004),
        transformedBox(1.075, 0.018, 0.058, 0, 0.229, 0.19, 0, 0.004),
      ],
      "rail-straight-running-surfaces-geometry",
    ),
    fasteners: mergeOwned(fastenerPieces, "rail-straight-fasteners-geometry"),
  };
}

function createCurveGeometries(): {
  ballast: THREE.BufferGeometry;
  ballastDetail: THREE.BufferGeometry;
  sleepers: THREE.BufferGeometry;
  sleeperAccents: THREE.BufferGeometry;
  rails: THREE.BufferGeometry;
  railTops: THREE.BufferGeometry;
  fasteners: THREE.BufferGeometry;
} {
  const centerline = quadraticTrackPoints([0, -0.5], [0.5, 0], 32);
  const inside = quadraticTrackPoints([0, -0.5], [0.5, 0], 32, -0.19);
  const outside = quadraticTrackPoints([0, -0.5], [0.5, 0], 32, 0.19);
  const innerShoulder = quadraticTrackPoints([0, -0.5], [0.5, 0], 32, -0.37);
  const outerShoulder = quadraticTrackPoints([0, -0.5], [0.5, 0], 32, 0.37);
  const curveShoulderStone: THREE.BufferGeometry[] = [];
  for (let index = 3; index < centerline.length - 1; index += 6) {
    const point = centerline[index]!;
    const before = centerline[index - 1]!;
    const after = centerline[index + 1]!;
    const tangentX = after.x - before.x;
    const tangentZ = after.z - before.z;
    const length = Math.max(0.0001, Math.hypot(tangentX, tangentZ));
    for (const side of [-1, 1]) {
      const shoulder = 0.345 + (index % 3) * 0.018;
      const radius = 0.012 + (index % 4) * 0.002;
      curveShoulderStone.push(
        transformedRock(
          radius,
          point.x + (-tangentZ / length) * side * shoulder,
          0.056 + radius * 0.3,
          point.z + (tangentX / length) * side * shoulder,
          index * 0.91 + side,
          1.18,
          0.72,
        ),
      );
    }
  }
  const ballast = mergeOwned(
    [pathRibbon(centerline, 1.04, 0.042, 0.025, "rail-curve-ballast-shoulder")],
    "rail-curve-ballast-geometry",
  );
  const ballastDetail = mergeOwned(
    [
      pathRibbon(centerline, 0.82, 0.062, 0.064, "rail-curve-ballast-crown"),
      pathRibbon(
        innerShoulder,
        0.16,
        0.022,
        0.058,
        "rail-curve-inner-compacted-drainage",
      ),
      pathRibbon(
        outerShoulder,
        0.16,
        0.022,
        0.058,
        "rail-curve-outer-compacted-drainage",
      ),
      ...curveShoulderStone,
    ],
    "rail-curve-compacted-shoulder-and-drainage-geometry",
  );
  const sleeperPieces: THREE.BufferGeometry[] = [];
  const sleeperAccentPieces: THREE.BufferGeometry[] = [];
  const fastenerPieces: THREE.BufferGeometry[] = [];
  for (let index = 0; index <= 4; index += 1) {
    const t = index / 4;
    const point = centerline[Math.round(t * (centerline.length - 1))]!;
    const sampleIndex = Math.round(t * (centerline.length - 1));
    const before = centerline[Math.max(0, sampleIndex - 1)]!;
    const after = centerline[Math.min(centerline.length - 1, sampleIndex + 1)]!;
    const tangentX = after.x - before.x;
    const tangentZ = after.z - before.z;
    const yaw = -Math.atan2(tangentZ, tangentX) + Math.PI / 2;
    const sleeper = transformedBox(
      0.68 + (index % 2) * 0.025,
      0.058,
      0.065 + (index % 3) * 0.004,
      point.x,
      0.108,
      point.z,
      yaw + (index % 2 === 0 ? 0.008 : -0.006),
      0.009,
    );
    (index === 1 ? sleeperAccentPieces : sleeperPieces).push(sleeper);
    for (const lateral of [-0.19, 0.19]) {
      const length = Math.max(
        0.0001,
        Math.sqrt(tangentX * tangentX + tangentZ * tangentZ),
      );
      fastenerPieces.push(
        transformedBox(
          0.12,
          0.018,
          0.078,
          point.x + (-tangentZ / length) * lateral,
          0.153,
          point.z + (tangentX / length) * lateral,
          yaw + Math.PI / 2,
          0.004,
        ),
      );
      for (const clipOffset of [-0.052, 0.052]) {
        fastenerPieces.push(
          transformedBox(
            0.038,
            0.026,
            0.022,
            point.x +
              (-tangentZ / length) * lateral +
              (tangentX / length) * clipOffset,
            0.169,
            point.z +
              (tangentX / length) * lateral +
              (tangentZ / length) * clipOffset,
            yaw + Math.PI / 2,
            0.004,
          ),
        );
      }
    }
  }
  return {
    ballast,
    ballastDetail,
    sleepers: mergeOwned(sleeperPieces, "rail-curve-sleepers-geometry"),
    sleeperAccents: mergeOwned(
      sleeperAccentPieces,
      "rail-curve-sleeper-variation-geometry",
    ),
    rails: mergeOwned(
      [
        ...pathBoxes(inside, 0.074, 0.018, 0.155),
        ...pathBoxes(outside, 0.074, 0.018, 0.155),
        ...pathBoxes(inside, 0.026, 0.064, 0.19),
        ...pathBoxes(outside, 0.026, 0.064, 0.19),
      ],
      "rail-curve-rails-geometry",
    ),
    railTops: mergeOwned(
      [
        ...pathBoxes(inside, 0.048, 0.018, 0.229),
        ...pathBoxes(outside, 0.048, 0.018, 0.229),
      ],
      "rail-curve-running-surfaces-geometry",
    ),
    fasteners: mergeOwned(fastenerPieces, "rail-curve-fasteners-geometry"),
  };
}

function createJunctionGeometries(
  straight: ReturnType<typeof createStraightGeometries>,
): {
  ballast: THREE.BufferGeometry;
  ballastDetail: THREE.BufferGeometry;
  sleepers: THREE.BufferGeometry;
  sleeperAccents: THREE.BufferGeometry;
  rails: THREE.BufferGeometry;
  railTops: THREE.BufferGeometry;
  fasteners: THREE.BufferGeometry;
  hardware: THREE.BufferGeometry;
  runningHardware: THREE.BufferGeometry;
  motor: THREE.BufferGeometry;
} {
  // A junction tile is rendered as one conventional left-hand turnout:
  // continuous east/west stock rails and one west-to-north diverging route.
  // The old art mirrored the diverging route through the same tile, producing
  // an impossible three-way knot of crossed rails and overlapping sleepers.
  const branchPath = (lateralOffset = 0): THREE.Vector3[] =>
    cubicTrackPoints(
      [-0.5, 0],
      [-0.13, 0],
      [-0.015, -0.17],
      [0, -0.5],
      64,
      lateralOffset,
    );
  const branch = branchPath();
  const branchInner = branchPath(-0.19);
  const branchOuter = branchPath(0.19);
  const branchGuardInner = branchPath(-0.105);
  const junctionSleeperPieces: THREE.BufferGeometry[] = [];
  const junctionSleeperAccentPieces: THREE.BufferGeometry[] = [];
  const mainFasteners: THREE.BufferGeometry[] = [];
  const branchFasteners: THREE.BufferGeometry[] = [];
  const mainSleeperX = [-0.44, -0.27, -0.1, 0.1, 0.28, 0.45];
  for (let index = 0; index < mainSleeperX.length; index += 1) {
    const x = mainSleeperX[index]!;
    const sleeper = transformedBox(
      0.068 + (index % 2) * 0.006,
      0.058,
      0.65 + Math.max(0, 3 - index) * 0.035,
      x,
      0.108,
      0.035 - Math.max(0, 3 - index) * 0.012,
      index % 2 === 0 ? 0.004 : -0.004,
      0.008,
    );
    (index === 1 || index === 4
      ? junctionSleeperAccentPieces
      : junctionSleeperPieces
    ).push(sleeper);
    for (const railZ of [-0.19, 0.19]) {
      mainFasteners.push(
        transformedBox(0.078, 0.018, 0.122, x, 0.151, railZ, 0, 0.005),
      );
      for (const clipOffset of [-0.052, 0.052]) {
        mainFasteners.push(
          transformedBox(
            0.046,
            0.027,
            0.022,
            x,
            0.169,
            railZ + clipOffset,
            0,
            0.004,
          ),
        );
      }
    }
  }
  // Only the far end of the lead needs branch-normal sleepers. They begin
  // beyond the ends of the stock-rail sleepers, so no timber intersects.
  const supportedIndices = [47, 55, 63];
  for (const [supportedIndex, index] of supportedIndices.entries()) {
    const point = branch[index]!;
    const before = branch[Math.max(0, index - 1)]!;
    const after = branch[Math.min(branch.length - 1, index + 1)]!;
    const tangentX = after.x - before.x;
    const tangentZ = after.z - before.z;
    const yaw = -Math.atan2(tangentZ, tangentX) + Math.PI / 2;
    const sleeper = transformedBox(
      0.73 + supportedIndex * 0.018,
      0.055,
      0.062 + (supportedIndex % 2) * 0.004,
      point.x,
      0.109,
      point.z,
      yaw,
      0.007,
    );
    (supportedIndex === 1
      ? junctionSleeperAccentPieces
      : junctionSleeperPieces
    ).push(sleeper);
  }
  for (const index of supportedIndices) {
    const point = branch[index]!;
    const before = branch[Math.max(0, index - 1)]!;
    const after = branch[Math.min(branch.length - 1, index + 1)]!;
    const tangentX = after.x - before.x;
    const tangentZ = after.z - before.z;
    const tangentLength = Math.max(0.0001, Math.hypot(tangentX, tangentZ));
    const railYaw = -Math.atan2(tangentZ, tangentX);
    for (const lateral of [-0.19, 0.19]) {
      branchFasteners.push(
        transformedBox(
          0.11,
          0.018,
          0.078,
          point.x + (-tangentZ / tangentLength) * lateral,
          0.154,
          point.z + (tangentX / tangentLength) * lateral,
          railYaw,
          0.004,
        ),
      );
      for (const clipOffset of [-0.05, 0.05]) {
        branchFasteners.push(
          transformedBox(
            0.038,
            0.025,
            0.021,
            point.x +
              (-tangentZ / tangentLength) * lateral +
              (tangentX / tangentLength) * clipOffset,
            0.169,
            point.z +
              (tangentX / tangentLength) * lateral +
              (tangentZ / tangentLength) * clipOffset,
            railYaw,
            0.004,
          ),
        );
      }
    }
  }
  const branchShoulderStone: THREE.BufferGeometry[] = [];
  for (let index = 3; index < branch.length - 1; index += 6) {
    const point = branch[index]!;
    const before = branch[index - 1]!;
    const after = branch[index + 1]!;
    const tangentX = after.x - before.x;
    const tangentZ = after.z - before.z;
    const tangentLength = Math.max(0.0001, Math.hypot(tangentX, tangentZ));
    for (const side of [-1, 1]) {
      const lateral = side * (0.35 + (index % 3) * 0.02);
      const radius = 0.011 + (index % 4) * 0.002;
      branchShoulderStone.push(
        transformedRock(
          radius,
          point.x + (-tangentZ / tangentLength) * lateral,
          0.056 + radius * 0.3,
          point.z + (tangentX / tangentLength) * lateral,
          index * 1.37 + side * 0.71,
          1.08 + (index % 4) * 0.1,
          0.72 + (index % 3) * 0.08,
        ),
      );
    }
  }
  const ballast = mergeOwned(
    [
      straight.ballast.clone(),
      pathRibbon(
        branch,
        1.04,
        0.042,
        0.025,
        "rail-junction-diverging-ballast-shoulder",
      ),
    ],
    "rail-junction-ballast-geometry",
  );
  const ballastDetail = mergeOwned(
    [
      straight.ballastDetail.clone(),
      pathRibbon(
        branch,
        0.82,
        0.062,
        0.064,
        "rail-junction-diverging-ballast-crown",
      ),
      pathRibbon(
        branchPath(-0.37),
        0.16,
        0.022,
        0.058,
        "rail-junction-inner-compacted-drainage",
      ),
      pathRibbon(
        branchPath(0.37),
        0.16,
        0.022,
        0.058,
        "rail-junction-outer-compacted-drainage",
      ),
      ...branchShoulderStone,
    ],
    "rail-junction-compacted-shoulder-and-drainage-geometry",
  );
  const sleepers = mergeOwned(
    junctionSleeperPieces,
    "rail-junction-sleepers-geometry",
  );
  const sleeperAccents = mergeOwned(
    junctionSleeperAccentPieces,
    "rail-junction-sleeper-variation-geometry",
  );
  const bladeEndIndex = 20;
  const branchRailStartIndex = 7;
  const frogIndex = branchOuter.reduce(
    (bestIndex, point, index) =>
      Math.abs(point.z + 0.19) < Math.abs(branchOuter[bestIndex]!.z + 0.19)
        ? index
        : bestIndex,
    1,
  );
  const frogGapStart = Math.max(bladeEndIndex + 2, frogIndex - 3);
  const frogGapEnd = Math.min(branchOuter.length - 2, frogIndex + 4);
  const rails = mergeOwned(
    [
      straight.rails.clone(),
      ...pathBoxes(
        branchInner.slice(branchRailStartIndex),
        0.074,
        0.018,
        0.155,
      ),
      ...pathBoxes(
        branchOuter.slice(branchRailStartIndex, frogGapStart + 1),
        0.074,
        0.018,
        0.155,
      ),
      ...pathBoxes(branchOuter.slice(frogGapEnd), 0.074, 0.018, 0.155),
      ...pathBoxes(branchInner.slice(branchRailStartIndex), 0.026, 0.064, 0.19),
      ...pathBoxes(
        branchOuter.slice(branchRailStartIndex, frogGapStart + 1),
        0.026,
        0.064,
        0.19,
      ),
      ...pathBoxes(branchOuter.slice(frogGapEnd), 0.026, 0.064, 0.19),
    ],
    "rail-junction-rails-geometry",
  );
  const railTops = mergeOwned(
    [
      straight.railTops.clone(),
      ...pathBoxes(branchInner.slice(bladeEndIndex), 0.048, 0.018, 0.229),
      ...pathBoxes(
        branchOuter.slice(bladeEndIndex, frogGapStart + 1),
        0.048,
        0.018,
        0.229,
      ),
      ...pathBoxes(branchOuter.slice(frogGapEnd), 0.048, 0.018, 0.229),
    ],
    "rail-junction-running-surfaces-geometry",
  );
  const fasteners = mergeOwned(
    [...mainFasteners, ...branchFasteners],
    "rail-junction-fasteners-geometry",
  );
  const frogPoint = branchOuter[frogIndex]!;
  const hardware = mergeOwned(
    [
      pathRibbon(
        branchOuter.slice(frogGapStart - 1, frogGapEnd + 1),
        0.082,
        0.026,
        0.224,
        "rail-junction-single-manganese-frog-casting",
        0.052,
      ),
      transformedBox(
        0.3,
        0.026,
        0.068,
        frogPoint.x + 0.012,
        0.224,
        -0.19,
        0,
        0.006,
      ),
      transformedBox(0.035, 0.028, 0.59, -0.355, 0.207, 0.045),
      transformedBox(0.28, 0.03, 0.03, -0.205, 0.224, 0.13, -0.1, 0.006),
    ],
    "rail-junction-single-frog-throw-bar-and-linkage-geometry",
  );
  const motor = mergeOwned(
    [
      transformedBox(0.31, 0.09, 0.22, -0.34, 0.15, 0.41, 0, 0.026),
      transformedBox(0.23, 0.07, 0.15, -0.34, 0.23, 0.41, 0, 0.018),
      transformedCylinder(0.035, 0.075, -0.43, 0.23, 0.41, 12),
      transformedCylinder(0.035, 0.075, -0.25, 0.23, 0.41, 12),
      transformedBox(0.2, 0.035, 0.035, -0.2, 0.22, 0.19, -0.13, 0.006),
      transformedBox(0.08, 0.15, 0.11, -0.5, 0.17, 0.42, 0, 0.016),
    ],
    "rail-junction-single-weatherproof-point-motor-geometry",
  );
  const runningHardware = mergeOwned(
    [
      pathRibbon(
        branchInner.slice(0, bladeEndIndex + 1),
        0.0015,
        0.02,
        0.236,
        "rail-junction-inner-tapered-switch-blade",
        0.041,
      ),
      pathRibbon(
        branchOuter.slice(0, bladeEndIndex + 1),
        0.0015,
        0.02,
        0.236,
        "rail-junction-outer-tapered-switch-blade",
        0.041,
      ),
      pathRibbon(
        branchGuardInner.slice(
          Math.max(bladeEndIndex, frogIndex - 9),
          Math.min(branchGuardInner.length, frogIndex + 4),
        ),
        0.026,
        0.024,
        0.234,
        "rail-junction-diverging-check-rail-opposite-frog",
      ),
      transformedBox(
        0.42,
        0.024,
        0.026,
        frogPoint.x + 0.03,
        0.234,
        0.105,
        0,
        0.005,
      ),
      transformedBox(0.34, 0.024, 0.026, -0.28, 0.234, -0.105, 0, 0.005),
    ],
    "rail-junction-single-turnout-continuous-blades-frog-and-check-rails-geometry",
  );
  return {
    ballast,
    ballastDetail,
    sleepers,
    sleeperAccents,
    rails,
    railTops,
    fasteners,
    hardware,
    runningHardware,
    motor,
  };
}

function createIntegratedTurnoutGeometries(
  direction: -1 | 1,
  profile: {
    readonly startX: number;
    readonly endX: number;
    readonly separation: number;
    readonly controlOneX: number;
    readonly controlTwoX: number;
    readonly label: string;
  } = {
    startX: CAMPAIGN_TURNOUT_START_X,
    endX: CAMPAIGN_TURNOUT_END_X,
    separation: CAMPAIGN_SIDING_SEPARATION,
    controlOneX: -1.75,
    controlTwoX: 0.25,
    label: "integrated",
  },
): IntegratedTurnoutGeometries {
  const { startX, endX, separation, controlOneX, controlTwoX, label } = profile;
  const branchSign = Math.sign(separation) || 1;
  const controlOneZ = separation * 0.00925;
  const controlTwoZ = separation * 0.9784;
  const centerline = cubicTrackPoints(
    [startX * direction, 0],
    [controlOneX * direction, controlOneZ],
    [controlTwoX * direction, controlTwoZ],
    [endX * direction, separation],
    128,
  );
  const nearRail = cubicTrackPoints(
    [startX * direction, 0],
    [controlOneX * direction, controlOneZ],
    [controlTwoX * direction, controlTwoZ],
    [endX * direction, separation],
    128,
    -0.19,
  );
  const farRail = cubicTrackPoints(
    [startX * direction, 0],
    [controlOneX * direction, controlOneZ],
    [controlTwoX * direction, controlTwoZ],
    [endX * direction, separation],
    128,
    0.19,
  );
  const guardNear = cubicTrackPoints(
    [startX * direction, 0],
    [controlOneX * direction, controlOneZ],
    [controlTwoX * direction, controlTwoZ],
    [endX * direction, separation],
    128,
    -0.11,
  );
  const guardFar = cubicTrackPoints(
    [startX * direction, 0],
    [controlOneX * direction, controlOneZ],
    [controlTwoX * direction, controlTwoZ],
    [endX * direction, separation],
    128,
    0.11,
  );
  const shoulderStone: THREE.BufferGeometry[] = [];
  for (let index = 3; index < centerline.length - 2; index += 4) {
    const point = centerline[index]!;
    const before = centerline[index - 1]!;
    const after = centerline[index + 1]!;
    const tangentX = after.x - before.x;
    const tangentZ = after.z - before.z;
    const tangentLength = Math.max(0.0001, Math.hypot(tangentX, tangentZ));
    for (const side of [-1, 1]) {
      const lateral =
        side * (0.48 + (index % 4) * 0.038 + Math.sin(index * 1.91) * 0.018);
      shoulderStone.push(
        transformedRock(
          0.014 + (index % 5) * 0.003,
          point.x + (-tangentZ / tangentLength) * lateral,
          0.03 + (index % 3) * 0.004,
          point.z + (tangentX / tangentLength) * lateral,
          index * 1.47 + side,
          1.12 + (index % 3) * 0.11,
          0.7 + (index % 2) * 0.16,
        ),
      );
    }
  }
  const sleeperPieces: THREE.BufferGeometry[] = [];
  const sleeperAccentPieces: THREE.BufferGeometry[] = [];
  const fastenerPieces: THREE.BufferGeometry[] = [];
  for (let index = 0; index <= 25; index += 1) {
    const sampleIndex = Math.min(
      centerline.length - 1,
      Math.round((index / 25) * (centerline.length - 1)),
    );
    const point = centerline[sampleIndex]!;
    const before = centerline[Math.max(0, sampleIndex - 1)]!;
    const after = centerline[Math.min(centerline.length - 1, sampleIndex + 1)]!;
    const tangentX = after.x - before.x;
    const tangentZ = after.z - before.z;
    const tangentLength = Math.max(0.0001, Math.hypot(tangentX, tangentZ));
    const yaw = -Math.atan2(tangentZ, tangentX) + Math.PI / 2;
    const sleeper = transformedBox(
      0.7 + Math.sin((index / 25) * Math.PI) * 0.12,
      0.058,
      0.066,
      point.x,
      0.109,
      point.z,
      yaw + (index % 2 === 0 ? 0.006 : -0.006),
      0.008,
    );
    (index === 5 || index === 18 ? sleeperAccentPieces : sleeperPieces).push(
      sleeper,
    );
    for (const lateral of [-0.19, 0.19]) {
      const x = point.x + (-tangentZ / tangentLength) * lateral;
      const z = point.z + (tangentX / tangentLength) * lateral;
      fastenerPieces.push(
        transformedBox(
          0.11,
          0.019,
          0.08,
          x,
          0.154,
          z,
          yaw + Math.PI / 2,
          0.004,
        ),
      );
    }
  }
  const nearRailStartsOppositeBranch =
    Math.abs(nearRail[0]!.z + 0.19 * branchSign) <
    Math.abs(farRail[0]!.z + 0.19 * branchSign);
  const crossingRail = nearRailStartsOppositeBranch ? nearRail : farRail;
  const continuousRail = nearRailStartsOppositeBranch ? farRail : nearRail;
  const crossingGuard = nearRailStartsOppositeBranch ? guardNear : guardFar;
  const continuousGuard = nearRailStartsOppositeBranch ? guardFar : guardNear;
  const switchBladeEnd = 24;
  const frogIndex = crossingRail.reduce(
    (bestIndex, point, index) =>
      Math.abs(point.z - 0.19 * branchSign) <
      Math.abs(crossingRail[bestIndex]!.z - 0.19 * branchSign)
        ? index
        : bestIndex,
    switchBladeEnd + 1,
  );
  const frogGapStart = Math.max(switchBladeEnd + 3, frogIndex - 3);
  const frogGapEnd = Math.min(crossingRail.length - 3, frogIndex + 4);
  const frogPoint = crossingRail[frogIndex]!;
  const frogBefore = crossingRail[Math.max(0, frogIndex - 2)]!;
  const frogAfter =
    crossingRail[Math.min(crossingRail.length - 1, frogIndex + 2)]!;
  const frogTangentLength = Math.max(
    0.0001,
    Math.hypot(
      frogAfter.x - frogBefore.x,
      frogAfter.z - frogBefore.z,
    ),
  );
  const frogTangentX = (frogAfter.x - frogBefore.x) / frogTangentLength;
  const frogTangentZ = (frogAfter.z - frogBefore.z) / frogTangentLength;
  const frogNormalX = -frogTangentZ;
  const frogNormalZ = frogTangentX;
  const bladePoint = centerline[14]!;
  const bladeBefore = centerline[13]!;
  const bladeAfter = centerline[15]!;
  const bladeYaw =
    -Math.atan2(
      bladeAfter.z - bladeBefore.z,
      bladeAfter.x - bladeBefore.x,
    ) +
    Math.PI / 2;
  const pointMotorX = (startX + 0.92) * direction;
  const pointMotorZ = -0.53 * branchSign;
  const cabinetX = pointMotorX + 0.75 * direction;
  const cabinetZ = pointMotorZ + 1.18 * branchSign;
  const lanternPoint = centerline[62]!;
  const cableTroughCenterline = centerline.map(
    (point) =>
      new THREE.Vector3(point.x, 0, point.z + 0.72 * branchSign),
  );
  const switchPlates = [4, 7, 10, 13, 16, 19, 22].map((index) => {
    const point = centerline[index]!;
    const before = centerline[Math.max(0, index - 1)]!;
    const after = centerline[Math.min(centerline.length - 1, index + 1)]!;
    const yaw =
      -Math.atan2(after.z - before.z, after.x - before.x) + Math.PI / 2;
    return transformedBox(
      0.78,
      0.032,
      0.115,
      point.x,
      0.205,
      point.z,
      yaw,
      0.004,
    );
  });
  const profileName = `${label}-${direction > 0 ? "west" : "east"}`;
  return {
    ballast: mergeOwned(
      [
        pathRibbon(
          centerline,
          1,
          0.014,
          0.012,
          `rail-${profileName}-turnout-irregular-shoulder`,
          1,
          (index, progress) =>
            progress < 0.025 || progress > 0.975
              ? 1
              : 0.975 +
                Math.sin(index * 12.9898 + direction * 4.13) * 0.022 +
                Math.sin(progress * Math.PI * 3.4 + direction) * 0.013,
        ),
      ],
      `rail-${profileName}-turnout-ballast-geometry`,
    ),
    ballastDetail: mergeOwned(
      [
        pathRibbon(
          centerline,
          0.74,
          0.038,
          0.032,
          `rail-${profileName}-turnout-crown`,
        ),
        ...shoulderStone,
      ],
      `rail-${profileName}-turnout-ballast-detail-geometry`,
    ),
    sleepers: mergeOwned(
      sleeperPieces,
      `rail-${profileName}-turnout-sleepers-geometry`,
    ),
    sleeperAccents: mergeOwned(
      sleeperAccentPieces,
      `rail-${profileName}-turnout-sleeper-accents-geometry`,
    ),
    rails: mergeOwned(
      [
        ...pathBoxes(continuousRail, 0.07, 0.018, 0.155),
        ...pathBoxes(
          crossingRail.slice(0, frogGapStart + 1),
          0.07,
          0.018,
          0.155,
        ),
        ...pathBoxes(crossingRail.slice(frogGapEnd), 0.07, 0.018, 0.155),
        ...pathBoxes(continuousRail, 0.025, 0.064, 0.19),
        ...pathBoxes(
          crossingRail.slice(0, frogGapStart + 1),
          0.025,
          0.064,
          0.19,
        ),
        ...pathBoxes(crossingRail.slice(frogGapEnd), 0.025, 0.064, 0.19),
      ],
      `rail-${profileName}-turnout-rails-geometry`,
    ),
    railTops: mergeOwned(
      [
        ...pathBoxes(continuousRail, 0.046, 0.018, 0.229),
        ...pathBoxes(
          crossingRail.slice(0, frogGapStart + 1),
          0.046,
          0.018,
          0.229,
        ),
        ...pathBoxes(crossingRail.slice(frogGapEnd), 0.046, 0.018, 0.229),
      ],
      `rail-${profileName}-turnout-running-surfaces-geometry`,
    ),
    fasteners: mergeOwned(
      fastenerPieces,
      `rail-${profileName}-turnout-fasteners-geometry`,
    ),
    runningHardware: mergeOwned(
      [
        ...switchPlates,
        pathRibbon(
          crossingRail.slice(1, switchBladeEnd + 1),
          0.004,
          0.025,
          0.237,
          "rail-integrated-turnout-crossing-tapered-switch-blade",
          0.032,
        ),
        pathRibbon(
          continuousRail.slice(1, switchBladeEnd + 1),
          0.004,
          0.025,
          0.237,
          "rail-integrated-turnout-stock-side-tapered-switch-blade",
          0.032,
        ),
        ...pathBoxes(
          crossingGuard.slice(
            Math.max(switchBladeEnd, frogIndex - 9),
            Math.min(crossingGuard.length, frogIndex + 4),
          ),
          0.025,
          0.024,
          0.235,
        ),
        ...pathBoxes(
          continuousGuard.slice(
            Math.max(switchBladeEnd, frogIndex - 7),
            Math.min(continuousGuard.length, frogIndex + 7),
          ),
          0.025,
          0.024,
          0.235,
        ),
        pathRibbon(
          crossingRail.slice(frogGapStart - 1, frogGapEnd + 1),
          0.075,
          0.028,
          0.224,
          "rail-integrated-turnout-compact-manganese-frog-casting",
          0.075,
        ),
        prismFromOutline(
          [
            [
              frogPoint.x -
                frogTangentX * 0.09 +
                frogNormalX * 0.034,
              frogPoint.z -
                frogTangentZ * 0.09 +
                frogNormalZ * 0.034,
            ],
            [
              frogPoint.x -
                frogTangentX * 0.09 -
                frogNormalX * 0.034,
              frogPoint.z -
                frogTangentZ * 0.09 -
                frogNormalZ * 0.034,
            ],
            [
              frogPoint.x + frogTangentX * 0.18,
              frogPoint.z + frogTangentZ * 0.18,
            ],
          ],
          0.216,
          0.245,
          "rail-integrated-turnout-short-frog-nose",
        ),
        transformedBox(
          0.56,
          0.026,
          0.024,
          frogPoint.x - 0.09 * direction,
          0.234,
          0.105 * branchSign,
          0,
          0.005,
        ),
        transformedBox(
          0.52,
          0.026,
          0.024,
          frogPoint.x - 0.16 * direction,
          0.234,
          -0.105 * branchSign,
          0,
          0.004,
        ),
        transformedBox(
          0.92,
          0.04,
          0.08,
          bladePoint.x,
          0.221,
          bladePoint.z,
          bladeYaw,
          0.004,
        ),
        transformedBox(
          0.08,
          0.045,
          0.64,
          pointMotorX,
          0.232,
          pointMotorZ + 0.31 * branchSign,
          0,
          0.006,
        ),
        transformedBox(
          0.46,
          0.045,
          0.075,
          (pointMotorX + bladePoint.x) * 0.5,
          0.232,
          bladePoint.z - 0.01 * branchSign,
          0,
          0.006,
        ),
        transformedCylinder(
          0.065,
          0.055,
          pointMotorX,
          0.255,
          bladePoint.z,
          12,
        ),
        transformedCylinder(
          0.055,
          0.052,
          bladePoint.x,
          0.254,
          bladePoint.z,
          12,
        ),
        transformedBox(
          0.24,
          0.052,
          0.11,
          bladePoint.x,
          0.24,
          bladePoint.z,
          bladeYaw,
          0.008,
        ),
      ],
      `rail-${profileName}-turnout-blades-frog-check-rails-geometry`,
    ),
    linkage: mergeOwned(
      [
        ...[4, 7, 10, 13, 16, 19, 22].map((index) => {
          const point = centerline[index]!;
          const before = centerline[Math.max(0, index - 1)]!;
          const after =
            centerline[Math.min(centerline.length - 1, index + 1)]!;
          const yaw =
            -Math.atan2(after.z - before.z, after.x - before.x) +
            Math.PI / 2;
          return transformedBox(
            0.78,
            0.025,
            0.115,
            point.x,
            0.235,
            point.z,
            yaw,
            0.004,
          );
        }),
        transformedBox(
          0.92,
          0.035,
          0.075,
          bladePoint.x,
          0.253,
          bladePoint.z,
          bladeYaw,
          0.004,
        ),
        transformedBox(
          0.075,
          0.04,
          0.64,
          pointMotorX,
          0.258,
          pointMotorZ + 0.31 * branchSign,
          0,
          0.006,
        ),
        transformedBox(
          0.46,
          0.04,
          0.075,
          (pointMotorX + bladePoint.x) * 0.5,
          0.258,
          bladePoint.z - 0.01 * branchSign,
          0,
          0.006,
        ),
        transformedCylinder(
          0.065,
          0.05,
          pointMotorX,
          0.282,
          bladePoint.z,
          12,
        ),
        transformedCylinder(
          0.055,
          0.048,
          bladePoint.x,
          0.28,
          bladePoint.z,
          12,
        ),
        transformedBox(
          0.24,
          0.046,
          0.11,
          bladePoint.x,
          0.269,
          bladePoint.z,
          bladeYaw,
          0.008,
        ),
      ],
      `rail-${profileName}-turnout-high-contrast-linkage-and-slide-plates-geometry`,
    ),
    serviceApron: mergeOwned(
      [
        transformedBox(
          0.86,
          0.04,
          0.48,
          cabinetX,
          0.05,
          cabinetZ,
          0,
          0.014,
        ),
        ...[-0.22, 0.22].map((offset) =>
          transformedBox(
            0.018,
            0.045,
            0.44,
            cabinetX + offset * direction,
            0.073,
            cabinetZ,
          ),
        ),
      ],
      `rail-${profileName}-turnout-drained-service-apron-geometry`,
    ),
    cableTrough: mergeOwned(
      [
        pathRibbon(
          cableTroughCenterline,
          0.14,
          0.055,
          0.095,
          `rail-${profileName}-turnout-covered-cable-trough`,
        ),
        ...[12, 28, 44, 60, 76, 92, 108, 124].map((index) => {
          const point = cableTroughCenterline[index]!;
          const before = cableTroughCenterline[index - 1]!;
          const after = cableTroughCenterline[index + 1]!;
          return transformedBox(
            0.025,
            0.018,
            0.16,
            point.x,
            0.132,
            point.z,
            -Math.atan2(after.z - before.z, after.x - before.x),
          );
        }),
      ],
      `rail-${profileName}-turnout-segmented-cable-trough-geometry`,
    ),
    cableTroughHardware: mergeOwned(
      [12, 28, 44, 60, 76, 92, 108, 124].flatMap((index) => {
        const point = cableTroughCenterline[index]!;
        const before = cableTroughCenterline[index - 1]!;
        const after = cableTroughCenterline[index + 1]!;
        const dx = after.x - before.x;
        const dz = after.z - before.z;
        const length = Math.max(0.0001, Math.hypot(dx, dz));
        const normalX = -dz / length;
        const normalZ = dx / length;
        return [-1, 1].map((side) =>
          transformedCylinder(
            0.014,
            0.022,
            point.x + normalX * side * 0.045,
            0.151,
            point.z + normalZ * side * 0.045,
            8,
          ),
        );
      }),
      `rail-${profileName}-turnout-cable-trough-lid-fasteners-geometry`,
    ),
    cableTroughGrime: mergeOwned(
      [20, 46, 73, 101, 118].map((index, patchIndex) => {
        const point = cableTroughCenterline[index]!;
        const before = cableTroughCenterline[index - 1]!;
        const after = cableTroughCenterline[index + 1]!;
        return transformedBox(
          0.13 + (patchIndex % 3) * 0.035,
          0.008,
          0.07 + (patchIndex % 2) * 0.018,
          point.x,
          0.148,
          point.z,
          -Math.atan2(after.z - before.z, after.x - before.x),
          0.003,
        );
      }),
      `rail-${profileName}-turnout-cable-trough-oxide-grime-patches-geometry`,
    ),
    serviceCabinet: mergeOwned(
      [
        transformedBox(
          0.38,
          0.06,
          0.32,
          cabinetX,
          0.06,
          cabinetZ,
          0,
          0.014,
        ),
        transformedBox(
          0.28,
          0.34,
          0.22,
          cabinetX,
          0.26,
          cabinetZ,
          0,
          0.018,
        ),
        transformedBox(
          0.34,
          0.04,
          0.28,
          cabinetX,
          0.45,
          cabinetZ,
          0,
          0.012,
        ),
        transformedCylinder(
          0.025,
          0.24,
          cabinetX - 0.18 * direction,
          0.2,
          cabinetZ,
          10,
        ),
      ],
      `rail-${profileName}-turnout-weatherproof-service-cabinet-geometry`,
    ),
    switchLantern: mergeOwned(
      [
        transformedCylinder(
          0.08,
          0.06,
          lanternPoint.x,
          0.06,
          lanternPoint.z + 0.72 * branchSign,
          12,
        ),
        transformedCylinder(
          0.028,
          0.34,
          lanternPoint.x,
          0.24,
          lanternPoint.z + 0.72 * branchSign,
          10,
        ),
        transformedBox(
          0.15,
          0.14,
          0.13,
          lanternPoint.x,
          0.48,
          lanternPoint.z + 0.72 * branchSign,
          0,
          0.014,
        ),
        transformedBox(
          0.19,
          0.03,
          0.16,
          lanternPoint.x,
          0.565,
          lanternPoint.z + 0.72 * branchSign,
          0,
          0.009,
        ),
      ],
      `rail-${profileName}-turnout-switch-lantern-and-post-geometry`,
    ),
    serviceSafety: mergeOwned(
      [
        transformedBox(
          0.09,
          0.06,
          0.09,
          lanternPoint.x,
          0.49,
          lanternPoint.z + 0.655 * branchSign,
          0,
          0.01,
        ),
        ...[-0.06, 0.06].map((offset) =>
          transformedBox(
            0.032,
            0.014,
            0.16,
            cabinetX + offset,
            0.472,
            cabinetZ,
          ),
        ),
      ],
      `rail-${profileName}-turnout-lantern-lens-and-cabinet-hazard-markers-geometry`,
    ),
    motor: mergeOwned(
      [
        transformedBox(
          0.58,
          0.08,
          0.42,
          pointMotorX,
          0.105,
          pointMotorZ,
          0,
          0.03,
        ),
        transformedBox(
          0.42,
          0.18,
          0.3,
          pointMotorX,
          0.22,
          pointMotorZ,
          0,
          0.035,
        ),
        transformedBox(
          0.5,
          0.035,
          0.035,
          pointMotorX,
          0.225,
          pointMotorZ + 0.21 * branchSign,
          0,
          0.006,
        ),
        transformedCylinder(
          0.052,
          0.19,
          pointMotorX - 0.15,
          0.3,
          pointMotorZ,
          12,
        ),
        transformedCylinder(
          0.052,
          0.19,
          pointMotorX + 0.15,
          0.3,
          pointMotorZ,
          12,
        ),
      ],
      `rail-${profileName}-turnout-point-motor-geometry`,
    ),
  };
}

function createIntegratedMainBedGeometries(): IntegratedMainBedGeometries {
  const length = 25;
  const centerline = Array.from(
    { length: 121 },
    (_, index) => new THREE.Vector3((index / 120) * length, 0, 0),
  );
  const edgeAggregate: THREE.BufferGeometry[] = [];
  for (let index = 0; index < 240; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const lane = Math.floor(index / 2);
    const progress = lane / 119;
    edgeAggregate.push(
      transformedRock(
        0.012 + (lane % 5) * 0.0028,
        progress * length + Math.sin(lane * 1.713 + side) * 0.07,
        0.024 + (lane % 4) * 0.003,
        side * (0.46 + (lane % 6) * 0.032 + Math.cos(lane * 1.337) * 0.018),
        lane * 1.419 + side,
        1.06 + (lane % 4) * 0.1,
        0.68 + (lane % 3) * 0.12,
      ),
    );
  }
  const restrainedEdge = (index: number, progress: number) =>
    progress < 0.01 || progress > 0.99
      ? 1
      : 0.982 +
        Math.sin(index * 12.9898 + 2.17) * 0.014 +
        Math.sin(progress * Math.PI * 4.3) * 0.008;
  return {
    ballast: mergeOwned(
      [
        pathRibbon(
          centerline,
          0.98,
          0.012,
          0.009,
          "rail-integrated-main-restrained-irregular-shoulder",
          0.98,
          restrainedEdge,
        ),
      ],
      "rail-integrated-main-continuous-ballast-geometry",
    ),
    ballastDetail: mergeOwned(
      [
        pathRibbon(
          centerline,
          0.74,
          0.034,
          0.027,
          "rail-integrated-main-compacted-crown",
        ),
        ...edgeAggregate,
      ],
      "rail-integrated-main-crown-and-ground-bleed-geometry",
    ),
  };
}

function createIntegratedBypassGeometries(
  length = CAMPAIGN_SIDING_LENGTH,
  label = "integrated",
): IntegratedBypassGeometries {
  const centerline = Array.from(
    { length: 49 },
    (_, index) => new THREE.Vector3((index / 48) * length, 0, 0),
  );
  // Only the gravel bed overlaps the adjoining eased turnout beds. Rail steel
  // and sleepers retain the exact tangent-to-tangent useful siding span.
  const bedCenterline = Array.from(
    { length: 53 },
    (_, index) =>
      new THREE.Vector3(-0.18 + (index / 52) * (length + 0.36), 0, 0),
  );
  const nearRail = centerline.map(
    (point) => new THREE.Vector3(point.x, 0, -0.19),
  );
  const farRail = centerline.map(
    (point) => new THREE.Vector3(point.x, 0, 0.19),
  );
  const sleeperPieces: THREE.BufferGeometry[] = [];
  const sleeperAccentPieces: THREE.BufferGeometry[] = [];
  const fastenerPieces: THREE.BufferGeometry[] = [];
  for (let index = 0; index <= 12; index += 1) {
    const x = (index / 12) * length;
    const sleeper = transformedBox(
      0.068 + (index % 3) * 0.004,
      0.058,
      0.7 + (index % 2) * 0.024,
      x,
      0.109,
      0,
      index % 2 === 0 ? 0.006 : -0.006,
      0.008,
    );
    (index === 3 || index === 9 ? sleeperAccentPieces : sleeperPieces).push(
      sleeper,
    );
    for (const z of [-0.19, 0.19]) {
      fastenerPieces.push(
        transformedBox(0.084, 0.019, 0.12, x, 0.154, z, 0, 0.004),
      );
    }
  }
  const aggregate: THREE.BufferGeometry[] = [];
  for (let index = 0; index < 48; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const lane = Math.floor(index / 2);
    aggregate.push(
      transformedRock(
        0.013 + (lane % 5) * 0.003,
        -0.12 +
          (lane / 23) * (length + 0.24) +
          Math.sin(lane * 1.7 + side) * 0.045,
        0.028 + (lane % 3) * 0.004,
        side * (0.48 + (lane % 5) * 0.036 + Math.cos(lane * 1.37) * 0.018),
        lane * 1.43 + side,
        1.08 + (lane % 4) * 0.1,
        0.68 + (lane % 3) * 0.12,
      ),
    );
  }
  const edgeModulation = (index: number, progress: number) =>
    progress < 0.015 || progress > 0.985
      ? 1
      : 0.975 +
        Math.sin(index * 12.9898 + 0.41) * 0.022 +
        Math.sin(progress * Math.PI * 3.7) * 0.013;
  return {
    ballast: mergeOwned(
      [
        pathRibbon(
          bedCenterline,
          0.98,
          0.014,
          0.012,
          `rail-${label}-bypass-irregular-aggregate-shoulder`,
          0.98,
          (_index, progress) =>
            edgeModulation(_index, progress) *
            (0.99 + Math.sin(_index * 7.173 + 0.7) * 0.012),
        ),
      ],
      `rail-${label}-bypass-ballast-geometry`,
    ),
    ballastDetail: mergeOwned(
      [
        pathRibbon(
          bedCenterline,
          0.74,
          0.038,
          0.032,
          `rail-${label}-bypass-compacted-crown`,
        ),
        ...aggregate,
      ],
      `rail-${label}-bypass-crown-and-loose-aggregate-geometry`,
    ),
    sleepers: mergeOwned(
      sleeperPieces,
      `rail-${label}-bypass-sleepers-geometry`,
    ),
    sleeperAccents: mergeOwned(
      sleeperAccentPieces,
      `rail-${label}-bypass-sleeper-accents-geometry`,
    ),
    rails: mergeOwned(
      [
        ...pathBoxes(nearRail, 0.07, 0.018, 0.155),
        ...pathBoxes(farRail, 0.07, 0.018, 0.155),
        ...pathBoxes(nearRail, 0.025, 0.064, 0.19),
        ...pathBoxes(farRail, 0.025, 0.064, 0.19),
      ],
      `rail-${label}-bypass-rails-geometry`,
    ),
    railTops: mergeOwned(
      [
        ...pathBoxes(nearRail, 0.046, 0.018, 0.229),
        ...pathBoxes(farRail, 0.046, 0.018, 0.229),
      ],
      `rail-${label}-bypass-running-surfaces-geometry`,
    ),
    fasteners: mergeOwned(
      fastenerPieces,
      `rail-${label}-bypass-fasteners-geometry`,
    ),
  };
}

const DOT_MATRIX_GLYPHS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    N: ["10001", "11001", "11001", "10101", "10011", "10011", "10001"],
    O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  });

function dotMatrixTextGeometry(
  text: string,
  name: string,
  cellSize = 0.052,
): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  const advance = cellSize * 6;
  for (
    let characterIndex = 0;
    characterIndex < text.length;
    characterIndex += 1
  ) {
    const glyph = DOT_MATRIX_GLYPHS[text[characterIndex] ?? ""];
    if (!glyph) continue;
    for (let row = 0; row < glyph.length; row += 1) {
      const cells = glyph[row]!;
      for (let column = 0; column < cells.length; column += 1) {
        if (cells[column] !== "1") continue;
        pieces.push(
          transformedBox(
            cellSize * 0.72,
            cellSize * 0.72,
            0.026,
            characterIndex * advance + column * cellSize,
            (6 - row) * cellSize,
            0,
            0,
            cellSize * 0.08,
          ),
        );
      }
    }
  }
  const geometry = mergeOwned(pieces, name);
  const width = Math.max(0, (text.length - 1) * advance + cellSize * 5);
  geometry.translate(-width / 2, -cellSize * 3, 0);
  return geometry;
}

function createStationDistrictGeometries(): StationDistrictGeometries {
  const fencePosts = Array.from({ length: 13 }, (_, index) =>
    transformedBox(
      0.055,
      0.8,
      0.055,
      -5.55 + index * 0.57,
      0.45,
      -4.42,
      0,
      0.012,
    ),
  );
  const southFencePosts = Array.from({ length: 13 }, (_, index) =>
    transformedBox(0.05, 0.62, 0.05, -5.55 + index * 0.57, 0.37, 4.46, 0, 0.01),
  );
  const lampPoles = [-4.85, -2.25, 0.35].flatMap((x) => [
    transformedCylinder(0.038, 1.5, x, 0.82, -3.92, 10),
    transformedBox(0.42, 0.045, 0.045, x + 0.18, 1.54, -3.92, 0, 0.01),
    transformedBox(0.045, 0.23, 0.045, x + 0.37, 1.44, -3.92, 0, 0.01),
  ]);
  const southLampPoles = [-4.15, -1.55, 0.75].flatMap((x) => [
    transformedCylinder(0.034, 1.14, x, 0.63, 3.92, 10),
    transformedBox(0.34, 0.04, 0.04, x + 0.14, 1.18, 3.92, 0, 0.008),
  ]);
  const pipeRuns = [-3.58, -3.74].flatMap((z, index) => {
    const pipe = new THREE.CylinderGeometry(
      0.045 - index * 0.01,
      0.045 - index * 0.01,
      6.1,
      10,
    );
    pipe.rotateZ(Math.PI / 2);
    pipe.translate(-2.3, 0.61 + index * 0.16, z);
    return [
      pipe,
      ...[-5.05, -3.45, -1.85, -0.25].map((x) =>
        transformedBox(0.055, 0.66 + index * 0.16, 0.055, x, 0.34, z, 0, 0.01),
      ),
    ];
  });
  const siloPieces: THREE.BufferGeometry[] = [];
  const siloHardware: THREE.BufferGeometry[] = [];
  for (const x of [-1.05, 0.18]) {
    const body = new THREE.CylinderGeometry(0.49, 0.49, 1.44, 24);
    body.translate(x, 0.83, -3.05);
    const roof = new THREE.ConeGeometry(0.51, 0.34, 24);
    roof.translate(x, 1.72, -3.05);
    siloPieces.push(
      body,
      roof,
      ...[-0.32, 0.32].map((offset) =>
        transformedBox(0.08, 0.58, 0.08, x + offset, 0.31, -3.05, 0, 0.012),
      ),
    );
    for (const y of [0.42, 0.88, 1.34]) {
      const band = new THREE.TorusGeometry(0.505, 0.018, 6, 28);
      band.rotateX(Math.PI / 2);
      band.translate(x, y, -3.05);
      siloHardware.push(band);
    }
    siloHardware.push(
      ...Array.from({ length: 8 }, (_, rung) =>
        transformedBox(
          0.32,
          0.022,
          0.022,
          x,
          0.32 + rung * 0.17,
          -2.548,
          0,
          0.004,
        ),
      ),
      transformedBox(0.025, 1.28, 0.025, x - 0.16, 0.91, -2.548),
      transformedBox(0.025, 1.28, 0.025, x + 0.16, 0.91, -2.548),
    );
  }
  const cratePieces = [
    [-5.05, 0.21, -2.4, 0.46, 0.33, 0.36],
    [-4.55, 0.16, -2.5, 0.32, 0.24, 0.34],
    [-4.18, 0.14, -2.46, 0.28, 0.21, 0.28],
    [-1.95, 0.13, -2.33, 0.26, 0.2, 0.26],
  ] as const;
  const props = cratePieces.flatMap(
    ([x, y, z, width, height, depth], index) => [
      transformedBox(
        width,
        height,
        depth,
        x,
        y,
        z,
        index % 2 === 0 ? 0.04 : -0.06,
        0.035,
      ),
      transformedBox(
        width * 0.88,
        0.035,
        depth * 1.03,
        x,
        y + height * 0.18,
        z,
      ),
      transformedBox(0.035, height * 1.03, depth * 1.04, x, y, z),
    ],
  );
  const drums = [-3.1, -2.78, -2.48].flatMap((x, index) => [
    transformedCylinder(0.09, 0.28, x, 0.17, -2.16 - (index % 2) * 0.12, 16),
    transformedCylinder(0.096, 0.024, x, 0.32, -2.16 - (index % 2) * 0.12, 16),
  ]);
  const roofWear = [
    ...Array.from({ length: 9 }, (_, index) =>
      transformedBox(
        0.17 + (index % 3) * 0.055,
        0.025,
        0.92,
        -5.35 + index * 0.22,
        1.452,
        -3.18,
        index % 2 === 0 ? 0.018 : -0.022,
        0.006,
      ),
    ),
    transformedCylinder(0.14, 0.18, -4.9, 1.54, -3.15, 14),
    transformedCylinder(0.11, 0.25, -4.15, 1.58, -3.37, 14),
    transformedBox(0.48, 0.055, 0.38, -3.62, 1.49, -3.02, 0.08, 0.012),
  ];
  const southProps = [
    transformedBox(0.68, 0.42, 0.48, -4.72, 0.26, 3.42, 0.04, 0.035),
    transformedBox(0.52, 0.31, 0.4, -3.98, 0.2, 3.58, -0.08, 0.028),
    transformedBox(1.1, 0.1, 0.58, -2.52, 0.12, 3.36, 0, 0.018),
    ...[-1.36, -1.08, -0.8].map((x) =>
      transformedCylinder(0.09, 0.28, x, 0.18, 3.56, 14),
    ),
    transformedBox(0.8, 0.44, 0.42, 0.3, 0.27, 3.5, 0.06, 0.035),
  ];
  const vegetation = Array.from({ length: 42 }, (_, index) => {
    const x = -5.75 + ((index % 21) / 20) * 7.25;
    const z =
      index < 21
        ? index % 2 === 0
          ? -4.62
          : -1.83
        : index % 2 === 0
          ? 4.72
          : 2.63;
    const geometry = new THREE.ConeGeometry(
      0.055 + (index % 4) * 0.012,
      0.16 + (index % 3) * 0.055,
      5,
    );
    geometry.rotateZ(Math.sin(index * 2.31) * 0.22);
    geometry.translate(
      x + Math.sin(index * 1.71) * 0.11,
      0.1,
      z + Math.cos(index * 1.37) * 0.12,
    );
    return geometry;
  });
  return {
    ground: mergeOwned(
      [
        transformedBox(7.25, 0.11, 2.72, -2.18, 0.055, -3.05, 0, 0.025),
        transformedBox(7.7, 0.035, 0.84, -2.18, 0.035, -4.72, 0, 0.012),
        transformedBox(7.18, 0.07, 0.26, -2.18, 0.105, -1.66, 0, 0.012),
        transformedBox(7.65, 0.085, 1.34, -2.18, 0.055, 3.62, 0, 0.025),
        transformedBox(7.35, 0.045, 0.28, -2.18, 0.08, 2.66, 0, 0.012),
        transformedBox(7.4, 0.028, 0.36, -2.18, 0.07, 4.72, 0, 0.01),
        ...[-4.92, -3.48, -2.04, -0.6].map((x) =>
          transformedBox(0.9, 0.025, 0.32, x, 0.125, -1.9, 0, 0.008),
        ),
      ],
      "rail-station-district-cracked-concrete-road-and-drainage-geometry",
    ),
    steel: mergeOwned(
      [
        ...fencePosts,
        ...southFencePosts,
        transformedBox(6.92, 0.035, 0.035, -2.13, 0.34, -4.42),
        transformedBox(6.92, 0.035, 0.035, -2.13, 0.67, -4.42),
        transformedBox(6.92, 0.032, 0.032, -2.13, 0.28, 4.46),
        transformedBox(6.92, 0.032, 0.032, -2.13, 0.54, 4.46),
        ...lampPoles,
        ...southLampPoles,
        ...pipeRuns,
        ...siloHardware,
        ...[-5.2, -4.55, -3.9].flatMap((x) => [
          transformedBox(0.045, 0.78, 0.045, x, 0.47, -2.98, 0, 0.008),
          transformedBox(0.7, 0.045, 0.045, x + 0.32, 0.84, -2.98, 0, 0.008),
        ]),
      ],
      "rail-station-district-fence-pipe-rack-and-lamp-steel-geometry",
    ),
    paint: mergeOwned(
      [
        transformedBox(2.22, 1.2, 1.16, -4.48, 0.68, -3.18, 0, 0.035),
        transformedBox(2.45, 0.18, 1.35, -4.48, 1.34, -3.18, 0, 0.025),
        transformedBox(0.74, 0.84, 0.055, -4.7, 0.56, -2.57, 0, 0.025),
        transformedBox(0.52, 0.52, 0.055, -3.82, 0.72, -2.57, 0, 0.018),
        ...siloPieces,
      ],
      "rail-station-district-workshop-and-silo-geometry",
    ),
    safety: mergeOwned(
      [
        ...Array.from({ length: 16 }, (_, index) =>
          transformedBox(
            0.26,
            0.018,
            0.11,
            -5.18 + index * 0.34,
            0.17,
            -1.77,
            index % 2 === 0 ? 0.48 : -0.48,
            0.004,
          ),
        ),
        ...Array.from({ length: 18 }, (_, index) =>
          transformedBox(
            0.28,
            0.016,
            0.065,
            -5.12 + index * 0.36,
            0.108,
            3.62,
            index % 2 === 0 ? 0.08 : -0.08,
            0.004,
          ),
        ),
        ...[-5.2, -2.18, 0.82].map((x) =>
          transformedBox(0.48, 0.022, 0.08, x, 0.11, 3.02, 0, 0.005),
        ),
        ...[-5.42, -3.34, -1.42, 0.72].map((x) =>
          transformedCylinder(0.055, 0.46, x, 0.29, -1.98, 10),
        ),
        transformedBox(1.62, 0.06, 0.08, -2.17, 0.75, -4.36, 0, 0.012),
      ],
      "rail-station-district-safety-stripes-bollards-and-gate-geometry",
    ),
    props: mergeOwned(
      [...props, ...drums, ...roofWear, ...southProps],
      "rail-station-district-crates-drums-tools-and-pallets-geometry",
    ),
    vegetation: mergeOwned(
      vegetation,
      "rail-station-district-trackside-weeds-geometry",
    ),
    lights: mergeOwned(
      [-4.48, -1.88, 0.72, -3.78, -1.18].map((x, index) => {
        const bulb = new THREE.SphereGeometry(0.095, 12, 8);
        bulb.scale(1.35, 0.58, 1);
        bulb.translate(x, index < 3 ? 1.38 : 1.16, index < 3 ? -3.92 : 3.92);
        return bulb;
      }),
      "rail-station-district-warm-work-lamps-geometry",
    ),
    signBoard: mergeOwned(
      [
        transformedBox(3.85, 0.58, 0.09, 0, 0, 0, 0, 0.035),
        transformedBox(0.08, 1.2, 0.08, -1.62, -0.65, 0),
        transformedBox(0.08, 1.2, 0.08, 1.62, -0.65, 0),
      ],
      "rail-station-district-nameboard-geometry",
    ),
    signName: dotMatrixTextGeometry(
      "CINDER",
      "rail-station-district-cinder-readable-name-geometry",
      0.072,
    ),
    signLoad: dotMatrixTextGeometry(
      "LOAD",
      "rail-station-district-load-status-geometry",
      0.062,
    ),
    signUnload: dotMatrixTextGeometry(
      "UNLOAD",
      "rail-station-district-unload-status-geometry",
      0.054,
    ),
    signService: dotMatrixTextGeometry(
      "SERVICE",
      "rail-station-district-service-status-geometry",
      0.047,
    ),
  };
}

function createGeometries(): RailGeometries {
  const straight = createStraightGeometries();
  const curve = createCurveGeometries();
  const junction = createJunctionGeometries(straight);
  const integratedTurnoutWest = createIntegratedTurnoutGeometries(1);
  const integratedTurnoutEast = createIntegratedTurnoutGeometries(-1);
  const integratedMainBed = createIntegratedMainBedGeometries();
  const integratedBypass = createIntegratedBypassGeometries();
  const stationDistrict = createStationDistrictGeometries();
  const signalPost = mergeOwned(
    [
      transformedBox(0.25, 0.08, 0.25, 0, 0.04, 0, 0, 0.02),
      transformedCylinder(0.045, 0.78, 0, 0.43, 0, 10),
      transformedBox(0.23, 0.16, 0.16, 0, 0.16, 0.03, 0, 0.025),
      transformedBox(0.28, 0.035, 0.08, 0, 0.7, 0),
      transformedBox(0.045, 0.6, 0.025, -0.085, 0.45, 0.02, 0, 0.006),
      transformedBox(0.045, 0.6, 0.025, 0.085, 0.45, 0.02, 0, 0.006),
      ...Array.from({ length: 6 }, (_, index) =>
        transformedBox(
          0.2,
          0.018,
          0.025,
          0,
          0.24 + index * 0.095,
          0.02,
          0,
          0.004,
        ),
      ),
      transformedBox(0.3, 0.11, 0.035, 0, 0.73, -0.055, 0, 0.01),
    ],
    "rail-signal-post-ladder-cabinet-and-id-plate-geometry",
  );
  const regularSignalHead = mergeOwned(
    [
      transformedBox(0.25, 0.46, 0.18, 0, 0.89, 0, 0, 0.04),
      transformedBox(0.34, 0.085, 0.3, 0, 1.11, -0.065, 0, 0.025),
      transformedBox(0.34, 0.085, 0.3, 0, 0.88, -0.065, 0, 0.025),
      transformedBox(0.29, 0.035, 0.22, 0, 0.995, -0.11, 0, 0.012),
    ],
    "rail-regular-signal-head-geometry",
  );
  const chainSignalHead = mergeOwned(
    [
      transformedBox(0.31, 0.31, 0.18, 0, 0.92, 0, Math.PI / 4, 0.035),
      transformedBox(0.12, 0.5, 0.13, 0, 0.92, 0.02, 0, 0.02),
      transformedBox(0.5, 0.12, 0.13, 0, 0.92, 0.02, 0, 0.02),
    ],
    "rail-chain-signal-head-geometry",
  );
  const regularLens = mergeOwned(
    [
      forwardFacingCylinder(0.078, 0.035, 0, 0.96, -0.1, 16),
      transformedCylinder(0.045, 0.024, 0, 1.15, 0, 14),
    ],
    "rail-regular-signal-lens-geometry",
  );
  const chainLens = mergeOwned(
    [
      forwardFacingCylinder(0.052, 0.038, 0, 1.03, -0.11, 12),
      forwardFacingCylinder(0.052, 0.038, -0.1, 0.92, -0.11, 12),
      forwardFacingCylinder(0.052, 0.038, 0.1, 0.92, -0.11, 12),
      forwardFacingCylinder(0.052, 0.038, 0, 0.81, -0.11, 12),
      transformedCylinder(0.052, 0.026, 0, 1.13, 0, 14),
    ],
    "rail-chain-signal-lenses-geometry",
  );
  const indicatorLens = forwardFacingCylinder(0.055, 0.03, 0, 0, 0, 16);
  indicatorLens.name = "rail-service-indicator-lens-geometry";
  const cabWindow = new RoundedBoxGeometry(0.145, 0.125, 0.022, 2, 0.014);
  cabWindow.name = "rail-locomotive-cab-window-geometry";

  const geometries: RailGeometries = {
    straightBallast: straight.ballast,
    straightBallastDetail: straight.ballastDetail,
    straightSleepers: straight.sleepers,
    straightSleeperAccents: straight.sleeperAccents,
    straightRails: straight.rails,
    straightRailTops: straight.railTops,
    straightFasteners: straight.fasteners,
    curveBallast: curve.ballast,
    curveBallastDetail: curve.ballastDetail,
    curveSleepers: curve.sleepers,
    curveSleeperAccents: curve.sleeperAccents,
    curveRails: curve.rails,
    curveRailTops: curve.railTops,
    curveFasteners: curve.fasteners,
    junctionBallast: junction.ballast,
    junctionBallastDetail: junction.ballastDetail,
    junctionSleepers: junction.sleepers,
    junctionSleeperAccents: junction.sleeperAccents,
    junctionRails: junction.rails,
    junctionRailTops: junction.railTops,
    junctionFasteners: junction.fasteners,
    junctionHardware: junction.hardware,
    junctionRunningHardware: junction.runningHardware,
    junctionMotor: junction.motor,
    integratedTurnoutWest,
    integratedTurnoutEast,
    integratedMainBed,
    integratedBypass,
    overlayTile: mergeOwned(
      [
        transformedBox(0.18, 0.01, 0.018, -0.38, 0.246, -0.3, 0, 0.004),
        transformedBox(0.18, 0.01, 0.018, 0.38, 0.246, -0.3, 0, 0.004),
        transformedBox(0.18, 0.01, 0.018, -0.38, 0.246, 0.3, 0, 0.004),
        transformedBox(0.18, 0.01, 0.018, 0.38, 0.246, 0.3, 0, 0.004),
        ...[-0.46, 0.46].flatMap((x) => [
          transformedCylinder(0.017, 0.014, x, 0.246, -0.3, 10),
          transformedCylinder(0.017, 0.014, x, 0.246, 0.3, 10),
        ]),
      ],
      "rail-block-state-gauge-brackets-geometry",
    ),
    routeTile: mergeOwned(
      [
        ...[-0.38, -0.13, 0.13, 0.38].map((x) =>
          transformedBox(0.14, 0.011, 0.024, x, 0.248, 0, 0, 0.004),
        ),
      ],
      "rail-authoritative-route-centerline-geometry",
    ),
    signalPost,
    regularSignalHead,
    chainSignalHead,
    regularLens,
    chainLens,
    indicatorLens,
    cabWindow,
    stationPlatform: mergeOwned(
      [
        transformedBox(3.9, 0.085, 0.72, 0, -0.09, -0.58, 0, 0.025),
        ...Array.from({ length: 10 }, (_, index) =>
          transformedBox(
            0.35,
            0.14,
            0.46,
            -1.755 + index * 0.39,
            0,
            0,
            index % 2 === 0 ? 0.004 : -0.004,
            0.018,
          ),
        ),
        transformedBox(3.86, 0.075, 0.09, 0, -0.07, -0.22, 0, 0.012),
        transformedBox(3.86, 0.075, 0.09, 0, -0.07, 0.22, 0, 0.012),
        ...[-1.45, -0.48, 0.49, 1.46].map((x) =>
          transformedBox(0.035, 0.012, 0.65, x, -0.04, -0.58, 0, 0.004),
        ),
      ],
      "rail-station-platform-and-service-road-geometry",
    ),
    stationPlatformGrating: mergeOwned(
      [
        ...[-1.16, 0.78].flatMap((centerX) => [
          transformedBox(0.66, 0.025, 0.18, centerX, 0, 0, 0, 0.006),
          ...Array.from({ length: 8 }, (_, index) =>
            transformedBox(
              0.018,
              0.018,
              0.16,
              centerX - 0.28 + index * 0.08,
              0.017,
              0,
            ),
          ),
        ]),
        ...[-1.72, -0.58, 0.58, 1.72].map((x) =>
          transformedCylinder(0.018, 0.025, x, 0.012, -0.17, 8),
        ),
        transformedBox(3.72, 0.024, 0.075, 0, 0.004, -0.47, 0, 0.008),
        ...Array.from({ length: 25 }, (_, index) =>
          transformedBox(0.018, 0.012, 0.07, -1.8 + index * 0.15, 0.018, -0.47),
        ),
      ],
      "rail-station-drainage-grating-geometry",
    ),
    stationEdge: mergeOwned(
      Array.from({ length: 13 }, (_, index) =>
        transformedBox(0.22, 0.055, 0.08, -1.8 + index * 0.3, 0, 0, 0, 0.012),
      ),
      "rail-station-segmented-safety-edge-geometry",
    ),
    stationCanopy: (() => {
      const geometry = new RoundedBoxGeometry(1.42, 0.07, 0.42, 2, 0.025);
      geometry.name = "rail-station-canopy-geometry";
      return geometry;
    })(),
    stationCanopyStripe: (() => {
      const geometry = new RoundedBoxGeometry(1.26, 0.022, 0.075, 2, 0.01);
      geometry.name = "rail-station-canopy-safety-stripe-geometry";
      return geometry;
    })(),
    stationCanopyRibs: mergeOwned(
      Array.from({ length: 5 }, (_, index) =>
        transformedBox(0.03, 0.025, 0.39, -0.58 + index * 0.29, 0, 0, 0, 0.006),
      ),
      "rail-station-canopy-ribs-geometry",
    ),
    stationSupport: (() => {
      const geometry = new THREE.BoxGeometry(0.055, 0.78, 0.055);
      geometry.name = "rail-station-support-geometry";
      return geometry;
    })(),
    stationCrane: mergeOwned(
      [
        transformedBox(0.16, 0.72, 0.16, -1.44, 0.36, 0, 0, 0.022),
        transformedBox(0.16, 0.72, 0.16, 1.44, 0.36, 0, 0, 0.022),
        transformedBox(3.08, 0.16, 0.18, 0, 0.73, 0, 0, 0.022),
        transformedBox(2.86, 0.06, 0.08, 0, 0.83, -0.13, 0, 0.01),
        transformedBox(0.3, 0.12, 0.28, -0.76, 0.76, -0.05, 0, 0.018),
        transformedBox(0.3, 0.12, 0.28, 0.76, 0.76, -0.05, 0, 0.018),
      ],
      "rail-station-clear-portal-cargo-gantry-geometry",
    ),
    stationServiceArm: mergeOwned(
      [
        transformedCylinder(0.035, 0.55, 0, 0.275, 0, 10),
        transformedBox(0.34, 0.055, 0.055, 0.16, 0.53, 0),
        transformedCylinder(0.065, 0.07, 0.34, 0.53, 0, 10),
      ],
      "rail-station-service-arm-geometry",
    ),
    stationFuelTank: mergeOwned(
      [
        transformedCylinder(0.18, 0.42, 0, 0.25, 0, 14),
        transformedBox(0.42, 0.06, 0.34, 0, 0.03, 0, 0, 0.015),
        transformedCylinder(0.04, 0.2, 0.11, 0.53, 0, 10),
      ],
      "rail-station-fuel-service-geometry",
    ),
    stationPallet: mergeOwned(
      [
        transformedBox(0.42, 0.06, 0.34, 0, 0.03, 0),
        transformedBox(0.16, 0.14, 0.14, -0.11, 0.13, -0.07, 0, 0.015),
        transformedBox(0.16, 0.14, 0.14, 0.09, 0.13, 0.07, 0, 0.015),
        transformedBox(0.14, 0.12, 0.14, 0.1, 0.25, -0.08, 0, 0.015),
      ],
      "rail-station-cargo-pallet-geometry",
    ),
    stationDial: (() => {
      const geometry = new THREE.CylinderGeometry(0.13, 0.13, 0.035, 16);
      geometry.rotateX(Math.PI / 2);
      geometry.name = "rail-station-schedule-dial-geometry";
      return geometry;
    })(),
    stationConveyor: mergeOwned(
      [
        transformedBox(3.18, 0.07, 0.34, 0, 0.035, 0, 0, 0.018),
        transformedBox(3.12, 0.035, 0.055, 0, 0.095, -0.17, 0, 0.008),
        transformedBox(3.12, 0.035, 0.055, 0, 0.095, 0.17, 0, 0.008),
        transformedBox(3.06, 0.2, 0.065, 0, -0.035, -0.205, 0, 0.014),
        transformedBox(3.06, 0.2, 0.065, 0, -0.035, 0.205, 0, 0.014),
        ...[-1.22, -0.4, 0.42, 1.24].flatMap((x) => [
          transformedBox(0.16, 0.42, 0.16, x, -0.21, -0.13, 0, 0.02),
          transformedBox(0.16, 0.42, 0.16, x, -0.21, 0.13, 0, 0.02),
          transformedBox(0.34, 0.06, 0.46, x, -0.42, 0, 0, 0.012),
        ]),
        ...[-1.48, 1.48].map((x) => {
          const geometry = new THREE.CylinderGeometry(0.13, 0.13, 0.38, 14);
          geometry.rotateX(Math.PI / 2);
          geometry.translate(x, 0.01, 0);
          return geometry;
        }),
        ...[-1.46, -0.98, -0.5, -0.02, 0.46, 0.94, 1.42].flatMap((x) => [
          transformedBox(0.045, 0.32, 0.045, x, -0.11, -0.13),
          transformedBox(0.045, 0.32, 0.045, x, -0.11, 0.13),
        ]),
      ],
      "rail-station-conveyor-frame-geometry",
    ),
    stationConveyorGuards: mergeOwned(
      [
        ...[-1.03, 0, 1.03].map((x) =>
          transformedBox(0.68, 0.22, 0.39, x, 0.21, 0, 0, 0.035),
        ),
        ...[-1.42, 1.42].map((x) =>
          transformedBox(0.24, 0.32, 0.42, x, 0.16, 0, 0, 0.035),
        ),
        ...[-1.03, 0, 1.03].flatMap((x) => [
          transformedBox(0.5, 0.025, 0.025, x, 0.335, -0.205, 0, 0.005),
          transformedBox(0.5, 0.025, 0.025, x, 0.335, 0.205, 0, 0.005),
        ]),
        transformedCylinder(0.11, 0.08, -1.42, 0.36, -0.23, 14),
        transformedCylinder(0.11, 0.08, 1.42, 0.36, -0.23, 14),
      ],
      "rail-station-armored-conveyor-guards-and-drive-casings-geometry",
    ),
    stationRollers: mergeOwned(
      Array.from({ length: 25 }, (_, index) => {
        const geometry = new THREE.CylinderGeometry(0.026, 0.026, 0.29, 10);
        geometry.rotateX(Math.PI / 2);
        geometry.translate(-1.5 + index * 0.125, 0.105, 0);
        return geometry;
      }),
      "rail-station-conveyor-rollers-geometry",
    ),
    stationLoaderBase: mergeOwned(
      [
        transformedBox(0.34, 0.11, 0.3, 0, 0.055, 0, 0, 0.026),
        transformedCylinder(0.135, 0.2, 0, 0.19, 0, 16),
        transformedBox(0.11, 0.6, 0.11, 0, 0.51, 0, 0, 0.016),
        transformedCylinder(0.115, 0.085, 0, 0.84, 0, 16),
      ],
      "rail-station-loader-pedestal-geometry",
    ),
    stationLoaderPortal: mergeOwned(
      [
        // Both foundations and uprights stay on the north-side service pad;
        // the railway and bypass below remain completely unobstructed.
        transformedBox(0.82, 0.12, 0.56, 0, 0.06, -0.16, 0, 0.035),
        transformedBox(0.17, 1.06, 0.17, -0.27, 0.61, -0.15, 0, 0.025),
        transformedBox(0.17, 1.06, 0.17, 0.27, 0.61, -0.15, 0, 0.025),
        transformedBox(0.72, 0.17, 0.34, 0, 1.14, -0.15, 0, 0.03),
        transformedBox(0.46, 0.48, 0.38, 0, 0.42, -0.19, 0, 0.045),
        transformedBox(0.6, 0.26, 0.42, 0, 0.86, -0.18, 0, 0.04),
        transformedBoxZ(
          0.07,
          0.54,
          0.07,
          -0.15,
          0.7,
          -0.39,
          -0.66,
          0.012,
        ),
        transformedBoxZ(
          0.07,
          0.54,
          0.07,
          0.15,
          0.7,
          -0.39,
          0.66,
          0.012,
        ),
        // Open twin-chord cantilever ends above the serviced wagon; it has no
        // south-side post or foundation inside either dynamic clearance.
        transformedBox(0.085, 0.095, 1.72, -0.25, 1.19, 0.69, 0, 0.016),
        transformedBox(0.085, 0.095, 1.72, 0.25, 1.19, 0.69, 0, 0.016),
        ...[-0.08, 0.25, 0.58, 0.91, 1.24, 1.48].map((z) =>
          transformedBox(0.58, 0.065, 0.065, 0, 1.16, z, 0, 0.012),
        ),
        transformedBox(0.1, 0.38, 0.1, -0.27, 0.32, 0.03, 0, 0.016),
        transformedBox(0.1, 0.38, 0.1, 0.27, 0.32, -0.29, 0, 0.016),
        transformedBox(0.66, 0.14, 0.3, 0, 1.13, 1.5, 0, 0.026),
      ],
      "rail-station-north-side-grounded-cantilever-loader-geometry",
    ),
    stationLoaderArm: mergeOwned(
      [
        transformedBox(0.035, 0.04, 0.5, -0.09, 0, 0, 0, 0.008),
        transformedBox(0.035, 0.04, 0.5, 0.09, 0, 0, 0, 0.008),
        transformedBox(0.035, 0.04, 0.5, 0, 0.105, 0, 0, 0.008),
        ...[-0.22, -0.07, 0.08, 0.23].flatMap((z) => [
          transformedBox(0.215, 0.032, 0.032, 0, 0, z, 0, 0.006),
          (() => {
            const geometry = new THREE.BoxGeometry(0.026, 0.13, 0.026);
            geometry.rotateZ(-Math.PI / 4);
            geometry.translate(0, 0.055, z + 0.04);
            return geometry;
          })(),
        ]),
      ],
      "rail-station-unloader-open-truss-arm-geometry",
    ),
    stationLoaderJoint: (() => {
      const geometry = new THREE.CylinderGeometry(0.085, 0.085, 0.12, 16);
      geometry.name = "rail-station-loader-joint-geometry";
      return geometry;
    })(),
    stationLoaderClaw: mergeOwned(
      [
        transformedBox(0.28, 0.075, 0.17, 0, 0, 0, 0, 0.018),
        transformedBox(0.055, 0.11, 0.22, -0.105, -0.06, -0.045, 0, 0.014),
        transformedBox(0.055, 0.11, 0.22, 0.105, -0.06, -0.045, 0, 0.014),
        transformedBox(0.065, 0.07, 0.1, -0.105, -0.1, -0.165, 0, 0.012),
        transformedBox(0.065, 0.07, 0.1, 0.105, -0.1, -0.165, 0, 0.012),
        transformedCylinder(0.045, 0.07, 0, 0.07, 0, 12),
      ],
      "rail-station-loader-ore-bucket-geometry",
    ),
    stationLoadBoom: mergeOwned(
      [
        transformedBox(0.035, 0.04, 0.5, -0.085, 0, 0, 0, 0.008),
        transformedBox(0.035, 0.04, 0.5, 0.085, 0, 0, 0, 0.008),
        transformedBox(0.035, 0.04, 0.5, 0, 0.115, 0, 0, 0.008),
        ...[-0.22, -0.07, 0.08, 0.23].flatMap((z) => [
          transformedBox(0.2, 0.032, 0.032, 0, 0, z, 0, 0.006),
          (() => {
            const geometry = new THREE.BoxGeometry(0.026, 0.13, 0.026);
            geometry.rotateZ(Math.PI / 4);
            geometry.translate(0, 0.058, z + 0.045);
            return geometry;
          })(),
        ]),
        ...[-0.085, 0.085].map((x) =>
          transformedCylinder(0.022, 0.06, x, 0.025, -0.27, 10),
        ),
      ],
      "rail-station-open-truss-load-cantilever-geometry",
    ),
    stationLoadNozzle: mergeOwned(
      [
        transformedBox(0.28, 0.15, 0.3, 0, 0.08, 0, 0, 0.025),
        transformedBox(0.19, 0.16, 0.2, 0, -0.07, 0, 0, 0.02),
        transformedBox(0.13, 0.14, 0.14, 0, -0.21, 0, 0, 0.016),
        transformedBox(0.32, 0.035, 0.34, 0, 0.17, 0, 0, 0.012),
      ],
      "rail-station-telescoping-load-nozzle-geometry",
    ),
    stationReceivingHopper: mergeOwned(
      [
        transformedBox(0.76, 0.08, 0.48, 0, 0.04, 0, 0, 0.022),
        (() => {
          const geometry = new THREE.BoxGeometry(0.7, 0.38, 0.06);
          geometry.rotateX(-0.28);
          geometry.translate(0, 0.24, -0.25);
          return geometry;
        })(),
        (() => {
          const geometry = new THREE.BoxGeometry(0.7, 0.38, 0.06);
          geometry.rotateX(0.28);
          geometry.translate(0, 0.24, 0.25);
          return geometry;
        })(),
        transformedBox(0.06, 0.38, 0.43, -0.35, 0.24, 0, 0, 0.014),
        transformedBox(0.06, 0.38, 0.43, 0.35, 0.24, 0, 0, 0.014),
        transformedBox(0.44, 0.25, 0.24, 0, -0.08, 0, 0, 0.018),
      ],
      "rail-station-unload-receiving-hopper-geometry",
    ),
    stationTransferPayload: mergeOwned(
      Array.from({ length: 18 }, (_, index) =>
        transformedRock(
          0.012 + (index % 4) * 0.003,
          ((index * 37) % 13) * 0.012 - 0.072,
          0.015 + ((index * 13) % 5) * 0.006,
          ((index * 23) % 11) * 0.011 - 0.055,
          index * 1.71,
          1.08 + (index % 3) * 0.12,
          0.78 + (index % 2) * 0.14,
        ),
      ),
      "rail-station-authoritative-carried-ore-geometry",
    ),
    stationTransferStream: mergeOwned(
      Array.from({ length: 36 }, (_, index) => {
        const row = Math.floor(index / 3);
        const lane = index % 3;
        const progress = row / 11;
        return transformedRock(
          0.03 + (index % 4) * 0.003,
          (lane - 1) * 0.145 + Math.sin(index * 2.41) * 0.038,
          -0.035 - progress * 0.62 + Math.sin(index * 1.31) * 0.012,
          -0.54 +
            progress * 0.64 +
            Math.cos(index * 1.87) * 0.045,
          index * 1.91,
          0.92 + (index % 4) * 0.1,
          0.82 + (index % 3) * 0.11,
        );
      }),
      "rail-station-thirty-six-spatially-separated-granule-cascade-geometry",
    ),
    stationConveyorOreBed: mergeOwned(
      Array.from({ length: 110 }, (_, index) => {
        const column = Math.floor(index / 5);
        const lane = index % 5;
        return transformedRock(
          0.021 + ((index * 7) % 5) * 0.004,
          -1.48 + column * 0.139 + Math.sin(index * 1.71) * 0.032,
          0.13 + ((index * 11) % 4) * 0.008,
          -0.118 + lane * 0.059 + Math.cos(index * 1.37) * 0.018,
          index * 1.93,
          0.82 + (index % 4) * 0.13,
          0.72 + ((index * 3) % 5) * 0.1,
        );
      }),
      "rail-station-continuous-irregular-aggregate-bed-geometry",
    ),
    stationControlCabinet: mergeOwned(
      [
        transformedBox(0.38, 0.52, 0.28, 0, 0.26, 0, 0, 0.035),
        transformedBox(0.31, 0.32, 0.022, 0, 0.28, -0.151, 0, 0.012),
        transformedBox(0.12, 0.05, 0.025, -0.07, 0.39, -0.166, 0, 0.008),
        transformedCylinder(0.035, 0.028, 0.09, 0.39, -0.166, 12),
        ...Array.from({ length: 5 }, (_, index) =>
          transformedBox(0.035, 0.12, 0.02, -0.1 + index * 0.05, 0.21, -0.168),
        ),
      ],
      "rail-station-control-cabinet-geometry",
    ),
    stationChute: mergeOwned(
      [
        ...[-0.17, 0.17].map((z) => {
          const geometry = new THREE.BoxGeometry(0.7, 0.1, 0.045);
          geometry.rotateZ(0.28);
          geometry.translate(0, 0.055, z);
          return geometry;
        }),
        ...[-0.3, 0.3].map((x) => {
          const geometry = new THREE.BoxGeometry(0.045, 0.11, 0.34);
          geometry.rotateZ(0.28);
          geometry.translate(x, x * Math.tan(0.28) + 0.035, 0);
          return geometry;
        }),
      ],
      "rail-station-sloped-transfer-chute-shell-geometry",
    ),
    stationChuteBed: (() => {
      const geometry = new THREE.BoxGeometry(0.7, 0.045, 0.3);
      geometry.rotateZ(0.28);
      geometry.name = "rail-station-sloped-transfer-chute-bed-geometry";
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      return geometry;
    })(),
    stationChuteOre: mergeOwned(
      Array.from({ length: 24 }, (_, index) => {
        const column = index % 12;
        const x = -0.29 + column * 0.053;
        return transformedRock(
          0.016 + (index % 4) * 0.003,
          x + Math.sin(index * 1.7) * 0.012,
          0.045 + x * Math.tan(0.28) + (index % 3) * 0.005,
          (index < 12 ? -0.065 : 0.065) + Math.cos(index) * 0.018,
          index * 1.73,
          0.82 + (index % 3) * 0.1,
          0.74 + (index % 4) * 0.08,
        );
      }),
      "rail-station-sloped-chute-aggregate-geometry",
    ),
    stationOreSourceBin: mergeOwned(
      [
        transformedBox(0.76, 0.08, 0.42, 0, 0.04, 0, 0, 0.025),
        (() => {
          const geometry = new THREE.BoxGeometry(0.94, 0.34, 0.065);
          geometry.rotateX(-0.18);
          geometry.translate(0, 0.25, -0.265);
          return geometry;
        })(),
        (() => {
          const geometry = new THREE.BoxGeometry(0.94, 0.34, 0.065);
          geometry.rotateX(0.18);
          geometry.translate(0, 0.25, 0.265);
          return geometry;
        })(),
        (() => {
          const geometry = new THREE.BoxGeometry(0.065, 0.34, 0.47);
          geometry.rotateZ(-0.18);
          geometry.translate(-0.43, 0.25, 0);
          return geometry;
        })(),
        (() => {
          const geometry = new THREE.BoxGeometry(0.065, 0.34, 0.47);
          geometry.rotateZ(0.18);
          geometry.translate(0.43, 0.25, 0);
          return geometry;
        })(),
        ...[-0.3, 0, 0.3].flatMap((x) => [
          transformedBox(0.035, 0.2, 0.045, x, 0.27, -0.323),
          transformedBox(0.035, 0.2, 0.045, x, 0.27, 0.323),
        ]),
        transformedBox(0.98, 0.035, 0.035, 0, 0.43, -0.315),
        transformedBox(0.98, 0.035, 0.035, 0, 0.43, 0.315),
        (() => {
          const geometry = new THREE.BoxGeometry(0.82, 0.08, 0.22);
          geometry.rotateZ(-0.24);
          geometry.translate(-0.02, 0.12, 0);
          return geometry;
        })(),
      ],
      "rail-station-compact-open-ore-bin-geometry",
    ),
    stationServiceCartridge: mergeOwned(
      [
        transformedBox(0.32, 0.11, 0.17, 0, 0, 0, 0, 0.025),
        transformedBox(0.2, 0.035, 0.195, -0.02, 0.068, 0, 0, 0.008),
        ...[-0.11, 0, 0.11].map((x) =>
          transformedBox(0.025, 0.025, 0.205, x, -0.062, 0, 0, 0.004),
        ),
        ...[-0.055, 0.055].map((z) =>
          transformedCylinder(0.023, 0.04, 0.17, 0, z, 8),
        ),
      ],
      "rail-station-keyed-service-cartridge-geometry",
    ),
    stationDistrict,
    underframe: mergeOwned(
      [
        transformedBox(1.46, 0.09, 0.12, 0, 0.03, -0.2, 0, 0.018),
        transformedBox(1.46, 0.09, 0.12, 0, 0.03, 0.2, 0, 0.018),
        ...[-0.56, -0.2, 0.2, 0.56].map((x) =>
          transformedBox(0.09, 0.085, 0.5, x, 0.035, 0, 0, 0.012),
        ),
        transformedBox(0.74, 0.14, 0.2, 0, -0.045, 0, 0, 0.035),
        transformedCylinder(0.055, 0.42, -0.16, -0.11, 0, 12),
        transformedCylinder(0.055, 0.42, 0.16, -0.11, 0, 12),
      ],
      "rail-train-ladder-underframe-and-air-reservoirs-geometry",
    ),
    locomotiveBody: mergeOwned(
      [
        prismFromOutline(
          [
            [-0.71, -0.27],
            [-0.71, 0.27],
            [-0.61, 0.31],
            [0.58, 0.31],
            [0.72, 0.23],
            [0.72, -0.23],
            [0.58, -0.31],
            [-0.61, -0.31],
          ],
          -0.14,
          0.07,
          "rail-locomotive-heavy-lower-frame",
        ),
        prismFromOutline(
          [
            [-0.08, -0.235],
            [-0.08, 0.235],
            [0.53, 0.225],
            [0.62, 0.17],
            [0.62, -0.17],
            [0.53, -0.225],
          ],
          0.04,
          0.33,
          "rail-locomotive-diesel-engine-hood",
        ),
        transformedBox(1.38, 0.09, 0.1, 0, -0.07, -0.29, 0, 0.016),
        transformedBox(1.38, 0.09, 0.1, 0, -0.07, 0.29, 0, 0.016),
        transformedBox(0.7, 0.055, 0.39, 0.27, 0.355, 0, 0, 0.018),
        transformedBox(0.12, 0.23, 0.47, 0.56, 0.15, 0, 0, 0.018),
      ],
      "rail-locomotive-heavy-diesel-hull-geometry",
    ),
    locomotiveCab: (() => {
      const geometry = prismFromOutline(
        [
          [-0.68, -0.265],
          [-0.68, 0.265],
          [-0.59, 0.29],
          [-0.17, 0.29],
          [-0.1, 0.22],
          [-0.1, -0.22],
          [-0.17, -0.29],
          [-0.59, -0.29],
        ],
        0,
        0.46,
        "rail-locomotive-armored-crew-cab",
      );
      geometry.name = "rail-locomotive-cab-geometry";
      return geometry;
    })(),
    locomotiveNose: (() => {
      const geometry = prismFromOutline(
        [
          [0.5, -0.23],
          [0.5, 0.23],
          [0.67, 0.2],
          [0.75, 0.13],
          [0.75, -0.13],
          [0.67, -0.2],
        ],
        -0.02,
        0.27,
        "rail-locomotive-square-armored-nose",
      );
      geometry.name = "rail-locomotive-rounded-nose-geometry";
      return geometry;
    })(),
    locomotiveRoof: (() => {
      const geometry = new RoundedBoxGeometry(0.58, 0.065, 0.575, 3, 0.035);
      geometry.name = "rail-locomotive-cab-roof-geometry";
      return geometry;
    })(),
    locomotivePilot: mergeOwned(
      [
        transformedBox(0.09, 0.09, 0.63, 0, 0, 0, 0, 0.018),
        transformedBox(0.34, 0.04, 0.035, 0.12, 0, -0.23, -0.58),
        transformedBox(0.34, 0.04, 0.035, 0.12, 0, 0.23, 0.58),
        transformedBox(0.29, 0.04, 0.035, 0.18, 0, -0.12, -0.31),
        transformedBox(0.29, 0.04, 0.035, 0.18, 0, 0.12, 0.31),
        transformedCylinder(0.045, 0.07, 0.03, 0.055, -0.25, 10),
        transformedCylinder(0.045, 0.07, 0.03, 0.055, 0.25, 10),
      ],
      "rail-locomotive-pilot-geometry",
    ),
    locomotiveBoilerBands: mergeOwned(
      [
        ...[0.02, 0.25, 0.48].flatMap((x) => [
          transformedBox(0.028, 0.035, 0.44, x, 0.365, 0, 0, 0.006),
          transformedCylinder(0.014, 0.035, x, 0.398, -0.215, 8),
          transformedCylinder(0.014, 0.035, x, 0.398, 0.215, 8),
        ]),
        transformedBox(0.5, 0.022, 0.026, 0.25, 0.402, -0.19, 0, 0.005),
        transformedBox(0.5, 0.022, 0.026, 0.25, 0.402, 0.19, 0, 0.005),
      ],
      "rail-locomotive-hood-seams-and-latches-geometry",
    ),
    locomotiveTopDetails: mergeOwned(
      [
        transformedBox(0.18, 0.035, 0.16, 0.02, 0.408, 0, 0, 0.018),
        transformedBox(0.2, 0.035, 0.16, 0.27, 0.408, 0, 0, 0.018),
        transformedBox(0.13, 0.032, 0.14, 0.49, 0.405, 0, 0, 0.016),
        ...[-0.15, 0.15].flatMap((z) =>
          Array.from({ length: 6 }, (_, index) =>
            transformedCylinder(0.008, 0.018, -0.02 + index * 0.1, 0.424, z, 8),
          ),
        ),
      ],
      "rail-locomotive-access-hatches-and-fasteners-geometry",
    ),
    cabSkylight: (() => {
      const geometry = new RoundedBoxGeometry(0.26, 0.025, 0.3, 2, 0.016);
      geometry.name = "rail-locomotive-cab-skylight-geometry";
      return geometry;
    })(),
    locomotiveGrille: mergeOwned(
      Array.from({ length: 9 }, (_, index) =>
        transformedBox(0.026, 0.19, 0.022, -0.11 + index * 0.028, 0, 0),
      ),
      "rail-locomotive-radiator-grille-geometry",
    ),
    locomotiveDeck: mergeOwned(
      [
        transformedBox(0.2, 0.045, 0.57, -0.61, 0.17, 0, 0, 0.012),
        transformedBox(0.16, 0.04, 0.55, 0.65, 0.16, 0, 0, 0.012),
        ...Array.from({ length: 10 }, (_, index) =>
          transformedBox(0.014, 0.018, 0.54, -0.67 + index * 0.15, 0.202, 0),
        ),
      ],
      "rail-locomotive-nonslip-maintenance-deck-geometry",
    ),
    locomotiveSidePanels: mergeOwned(
      [
        ...[-0.08, 0.15, 0.38].flatMap((x, index) => [
          transformedBox(
            0.18,
            0.16 + index * 0.018,
            0.025,
            x,
            0.3,
            -0.265,
            0,
            0.008,
          ),
          transformedBox(
            0.18,
            0.16 + index * 0.018,
            0.025,
            x,
            0.3,
            0.265,
            0,
            0.008,
          ),
        ]),
        transformedBox(0.19, 0.11, 0.028, -0.42, 0.25, -0.285, 0, 0.007),
        transformedBox(0.19, 0.11, 0.028, -0.42, 0.25, 0.285, 0, 0.007),
      ],
      "rail-locomotive-layered-side-panels-geometry",
    ),
    locomotiveCooling: mergeOwned(
      [
        ...[0.08, 0.31].map((x) => {
          const geometry = new THREE.TorusGeometry(0.07, 0.013, 6, 20);
          geometry.rotateX(Math.PI / 2);
          geometry.translate(x, 0.445, 0);
          return geometry;
        }),
        ...[0.08, 0.31].flatMap((x) => [
          transformedBox(0.115, 0.014, 0.014, x, 0.446, 0),
          transformedBox(0.014, 0.014, 0.115, x, 0.446, 0),
        ]),
        transformedBox(0.43, 0.022, 0.2, 0.195, 0.422, 0, 0, 0.012),
      ],
      "rail-locomotive-radiator-fans-geometry",
    ),
    locomotivePipework: mergeOwned(
      [
        (() => {
          const geometry = new THREE.CylinderGeometry(0.018, 0.018, 0.58, 8);
          geometry.rotateZ(Math.PI / 2);
          geometry.translate(0.1, 0.39, -0.235);
          return geometry;
        })(),
        (() => {
          const geometry = new THREE.CylinderGeometry(0.014, 0.014, 0.46, 8);
          geometry.rotateZ(Math.PI / 2);
          geometry.translate(0.16, 0.36, 0.235);
          return geometry;
        })(),
        transformedCylinder(0.032, 0.08, -0.21, 0.43, -0.235, 10),
        transformedCylinder(0.028, 0.075, 0.39, 0.42, 0.235, 10),
        transformedBox(0.03, 0.19, 0.03, 0.51, 0.31, -0.21, 0, 0.007),
      ],
      "rail-locomotive-asymmetric-pipework-geometry",
    ),
    locomotiveSootPatch: mergeOwned(
      [
        (() => {
          const geometry = new THREE.CircleGeometry(0.045, 18);
          geometry.rotateX(-Math.PI / 2);
          geometry.scale(2, 1, 0.65);
          geometry.translate(0.34, 0.454, -0.015);
          return geometry;
        })(),
      ],
      "rail-locomotive-soot-staining-geometry",
    ),
    locomotiveDecals: mergeOwned(
      [
        transformedBox(0.2, 0.018, 0.1, -0.42, 0.51, -0.13, 0, 0.008),
        transformedBox(0.035, 0.019, 0.075, -0.47, 0.52, -0.13),
        transformedBox(0.035, 0.019, 0.075, -0.4, 0.52, -0.13),
        transformedBox(0.035, 0.019, 0.075, -0.33, 0.52, -0.13),
        transformedBox(0.1, 0.018, 0.1, 0.52, 0.43, 0.14, Math.PI / 4),
      ],
      "rail-locomotive-chipped-stencils-geometry",
    ),
    locomotiveHandrails: mergeOwned(
      [
        ...[-0.27, 0.27].flatMap((z) => [
          transformedBox(0.56, 0.018, 0.018, 0.36, 0.37, z),
          transformedBox(0.018, 0.21, 0.018, 0.08, 0.28, z),
          transformedBox(0.018, 0.21, 0.018, 0.36, 0.28, z),
          transformedBox(0.018, 0.21, 0.018, 0.64, 0.28, z),
        ]),
      ],
      "rail-locomotive-maintenance-handrails-geometry",
    ),
    chimney: mergeOwned(
      [
        transformedCylinder(0.04, 0.12, 0, 0.06, -0.055, 12),
        transformedCylinder(0.052, 0.032, 0, 0.135, -0.055, 12),
        transformedCylinder(0.036, 0.105, -0.11, 0.052, 0.065, 10),
        transformedCylinder(0.048, 0.03, -0.11, 0.12, 0.065, 10),
        transformedBox(0.27, 0.035, 0.2, -0.055, 0.005, 0, 0, 0.012),
      ],
      "rail-locomotive-twin-diesel-exhaust-geometry",
    ),
    headlight: (() => {
      const geometry = new THREE.CylinderGeometry(0.07, 0.07, 0.045, 16);
      geometry.rotateZ(Math.PI / 2);
      geometry.name = "rail-locomotive-headlight-geometry";
      return geometry;
    })(),
    bogie: (() => {
      return mergeOwned(
        [
          transformedBox(0.46, 0.09, 0.07, 0, 0, -0.305, 0, 0.014),
          transformedBox(0.46, 0.09, 0.07, 0, 0, 0.305, 0, 0.014),
          transformedBox(0.09, 0.085, 0.4, 0, 0.02, 0, 0, 0.014),
          transformedBox(0.1, 0.075, 0.62, -0.16, -0.005, 0, 0, 0.012),
          transformedBox(0.1, 0.075, 0.62, 0.16, -0.005, 0, 0, 0.012),
        ],
        "rail-bogie-open-frame-geometry",
      );
    })(),
    bogieSuspension: mergeOwned(
      [
        ...[-0.15, 0.15].flatMap((x) =>
          [-0.325, 0.325].flatMap((z) => [
            transformedBox(0.105, 0.018, 0.026, x, -0.036, z, 0, 0.005),
            transformedBox(0.09, 0.018, 0.026, x, -0.008, z, 0, 0.005),
            transformedBox(0.074, 0.018, 0.026, x, 0.02, z, 0, 0.005),
            transformedCylinder(0.018, 0.07, x, 0.012, z, 8),
          ]),
        ),
        ...[-0.15, 0.15].flatMap((x) => [
          transformedBox(0.11, 0.105, 0.065, x, -0.01, -0.325, 0, 0.012),
          transformedBox(0.11, 0.105, 0.065, x, -0.01, 0.325, 0, 0.012),
        ]),
        transformedBox(0.38, 0.04, 0.055, 0, 0.025, -0.315, 0, 0.008),
        transformedBox(0.38, 0.04, 0.055, 0, 0.025, 0.315, 0, 0.008),
        transformedBox(0.055, 0.045, 0.4, 0, 0.01, 0, 0, 0.008),
      ],
      "rail-bogie-leaf-springs-dampers-and-axle-boxes-geometry",
    ),
    wheel: (() => {
      const geometry = new THREE.CylinderGeometry(
        WHEEL_RADIUS,
        WHEEL_RADIUS,
        0.07,
        16,
        1,
      );
      geometry.rotateX(Math.PI / 2);
      geometry.name = "rail-flanged-wheel-geometry";
      return geometry;
    })(),
    wheelFlange: (() => {
      const geometry = new THREE.CylinderGeometry(
        WHEEL_RADIUS + 0.026,
        WHEEL_RADIUS + 0.026,
        0.018,
        18,
        1,
      );
      geometry.rotateX(Math.PI / 2);
      geometry.name = "rail-wheel-inner-flange-ring-geometry";
      return geometry;
    })(),
    axle: (() => {
      const geometry = new THREE.CylinderGeometry(0.026, 0.026, 0.43, 10);
      geometry.rotateX(Math.PI / 2);
      geometry.name = "rail-bogie-through-axle-geometry";
      return geometry;
    })(),
    wheelHub: (() => {
      const geometry = new THREE.CylinderGeometry(0.065, 0.065, 0.082, 12, 1);
      geometry.rotateX(Math.PI / 2);
      geometry.name = "rail-wheel-hub-geometry";
      return geometry;
    })(),
    sideRod: (() => {
      const geometry = new RoundedBoxGeometry(1.08, 0.035, 0.028, 2, 0.01);
      geometry.name = "rail-locomotive-side-rod-geometry";
      return geometry;
    })(),
    coupler: mergeOwned(
      [
        transformedBox(0.25, 0.05, 0.05, 0, 0, 0),
        transformedBox(0.08, 0.12, 0.11, 0.12, 0, 0, 0, 0.012),
        transformedBox(0.09, 0.08, 0.17, -0.1, 0, 0, 0, 0.015),
      ],
      "rail-buffer-coupler-geometry",
    ),
    couplerHoses: mergeOwned(
      [
        (() => {
          const geometry = new THREE.TorusGeometry(
            0.11,
            0.014,
            6,
            14,
            Math.PI * 1.2,
          );
          geometry.rotateY(Math.PI / 2);
          geometry.translate(0.02, -0.04, -0.08);
          return geometry;
        })(),
        (() => {
          const geometry = new THREE.TorusGeometry(
            0.09,
            0.012,
            6,
            14,
            Math.PI * 1.1,
          );
          geometry.rotateY(Math.PI / 2);
          geometry.translate(0.02, -0.035, 0.08);
          return geometry;
        })(),
        transformedCylinder(0.025, 0.08, 0, 0.02, -0.17, 8),
        transformedCylinder(0.025, 0.08, 0, 0.02, 0.17, 8),
      ],
      "rail-coupler-brake-hoses-and-chains-geometry",
    ),
    wagonBody: mergeOwned(
      [
        prismFromOutline(
          [
            [-0.73, -0.21],
            [-0.65, 0.31],
            [0.65, 0.31],
            [0.73, 0.21],
            [0.73, -0.21],
            [0.65, -0.31],
            [-0.65, -0.31],
          ],
          -0.18,
          -0.055,
          "rail-wagon-long-chamfered-lower-frame",
        ),
        prismFromSideOutline(
          [
            [-0.66, -0.08],
            [0.66, -0.08],
            [0.6, 0.27],
            [0.46, 0.5],
            [-0.46, 0.5],
            [-0.6, 0.27],
          ],
          -0.46,
          -0.34,
          "rail-wagon-near-deep-sloped-tub-wall",
        ),
        prismFromSideOutline(
          [
            [-0.66, -0.08],
            [0.66, -0.08],
            [0.6, 0.27],
            [0.46, 0.5],
            [-0.46, 0.5],
            [-0.6, 0.27],
          ],
          0.34,
          0.46,
          "rail-wagon-far-deep-sloped-tub-wall",
        ),
        prismFromOutline(
          [
            [-0.74, -0.2],
            [-0.65, -0.34],
            [-0.51, -0.34],
            [-0.51, 0.34],
            [-0.65, 0.34],
            [-0.74, 0.2],
          ],
          -0.09,
          0.44,
          "rail-wagon-deep-ribbed-rear-bulkhead",
        ),
        prismFromOutline(
          [
            [0.51, -0.34],
            [0.65, -0.34],
            [0.74, -0.2],
            [0.74, 0.2],
            [0.65, 0.34],
            [0.51, 0.34],
          ],
          -0.09,
          0.44,
          "rail-wagon-deep-ribbed-front-bulkhead",
        ),
        transformedBox(1.42, 0.075, 0.63, 0, -0.135, 0, 0, 0.018),
      ],
      "rail-long-low-sloped-ore-hopper-body-geometry",
    ),
    wagonSidePanels: mergeOwned(
      [
        prismFromSideOutline(
          [
            [-0.565, 0],
            [0.565, 0],
            [0.53, 0.27],
            [0.36, 0.47],
            [-0.36, 0.47],
            [-0.53, 0.27],
          ],
          -0.414,
          -0.394,
          "rail-wagon-near-solid-raised-armor",
        ),
        prismFromSideOutline(
          [
            [-0.565, 0],
            [0.565, 0],
            [0.53, 0.27],
            [0.36, 0.47],
            [-0.36, 0.47],
            [-0.53, 0.27],
          ],
          0.394,
          0.414,
          "rail-wagon-far-solid-raised-armor",
        ),
        ...[-0.42, -0.14, 0.14, 0.42].flatMap((x, index) => [
          transformedBox(
            0.235,
            0.27 + (index % 2) * 0.014,
            0.014,
            x,
            0.18,
            -0.426,
            0,
            0.005,
          ),
          transformedBox(
            0.235,
            0.27 + (index % 2) * 0.014,
            0.014,
            x,
            0.18,
            0.426,
            0,
            0.005,
          ),
        ]),
        transformedBox(0.05, 0.5, 0.48, -0.665, 0.21, 0, 0, 0.009),
        transformedBox(0.05, 0.5, 0.48, 0.665, 0.21, 0, 0, 0.009),
      ],
      "rail-cargo-wagon-solid-exterior-armor-panels-geometry",
    ),
    wagonDischargeDoors: mergeOwned(
      [
        ...[-0.34, 0.34].flatMap((centerX, index) => [
          prismFromSideOutline(
            [
              [centerX - 0.25, 0.02],
              [centerX + 0.25, 0.02],
              [centerX + 0.2, 0.28],
              [centerX - 0.2, 0.28],
            ],
            -0.438,
            -0.421,
            `rail-wagon-near-discharge-door-${index}`,
          ),
          prismFromSideOutline(
            [
              [centerX - 0.25, 0.02],
              [centerX + 0.25, 0.02],
              [centerX + 0.2, 0.28],
              [centerX - 0.2, 0.28],
            ],
            0.421,
            0.438,
            `rail-wagon-far-discharge-door-${index}`,
          ),
          transformedBox(
            0.43,
            0.025,
            0.028,
            centerX,
            0.16,
            -0.449,
            index === 0 ? 0.1 : -0.1,
            0.005,
          ),
          transformedBox(
            0.43,
            0.025,
            0.028,
            centerX,
            0.16,
            0.449,
            index === 0 ? 0.1 : -0.1,
            0.005,
          ),
        ]),
        ...[-0.59, 0, 0.59].flatMap((x) => [
          transformedBox(0.035, 0.38, 0.035, x, 0.18, -0.452, 0, 0.007),
          transformedBox(0.035, 0.38, 0.035, x, 0.18, 0.452, 0, 0.007),
        ]),
      ],
      "rail-cargo-wagon-inset-discharge-doors-and-door-braces-geometry",
    ),
    wagonDoorBraces: mergeOwned(
      [
        ...[-0.452, 0.452].flatMap((z) => [
          ...[-0.59, 0, 0.59].map((x) =>
            transformedBox(0.038, 0.4, 0.028, x, 0.18, z, 0, 0.006),
          ),
          transformedBox(1.2, 0.035, 0.028, 0, 0.02, z, 0, 0.006),
          transformedBox(1.12, 0.035, 0.028, 0, 0.36, z, 0, 0.006),
          transformedBoxZ(0.56, 0.032, 0.028, -0.3, 0.19, z, 0.46, 0.005),
          transformedBoxZ(0.56, 0.032, 0.028, 0.3, 0.19, z, -0.46, 0.005),
        ]),
      ],
      "rail-cargo-wagon-door-frames-diagonal-braces-and-sill-geometry",
    ),
    wagonBrakeRigging: mergeOwned(
      [
        (() => {
          const geometry = new THREE.CylinderGeometry(0.075, 0.075, 0.48, 14);
          geometry.rotateZ(Math.PI / 2);
          geometry.translate(0.1, -0.17, -0.25);
          return geometry;
        })(),
        transformedBox(0.92, 0.025, 0.025, 0, -0.15, 0.29, 0, 0.005),
        transformedBox(0.025, 0.06, 0.5, -0.38, -0.14, 0, 0, 0.005),
        transformedBox(0.025, 0.06, 0.5, 0.38, -0.14, 0, 0, 0.005),
        (() => {
          const geometry = new THREE.TorusGeometry(0.105, 0.016, 7, 22);
          geometry.translate(0.53, 0.23, -0.455);
          return geometry;
        })(),
        transformedCylinder(0.018, 0.28, 0.53, 0.08, -0.455, 8),
      ],
      "rail-cargo-wagon-air-reservoir-brake-rods-and-handwheel-geometry",
    ),
    wagonBrakeStand: mergeOwned(
      [
        (() => {
          const geometry = new THREE.TorusGeometry(0.09, 0.015, 7, 24);
          geometry.rotateX(Math.PI / 2);
          geometry.translate(0.56, 0.12, -0.22);
          return geometry;
        })(),
        transformedCylinder(0.018, 0.2, 0.56, 0.015, -0.22, 9),
        transformedBox(0.2, 0.045, 0.14, 0.51, -0.03, -0.22, 0, 0.012),
        transformedBox(0.035, 0.12, 0.035, 0.44, 0.04, -0.22, 0, 0.006),
      ],
      "rail-open-gondola-deck-brake-stand-and-wheel-geometry",
    ),
    wagonGrime: mergeOwned(
      [
        ...[-0.42, 0.18, 0.47].flatMap((x, index) => {
          const near = new THREE.CircleGeometry(0.095 + index * 0.018, 18);
          near.scale(1.55, 0.62 + index * 0.08, 1);
          near.translate(x, 0.11 + index * 0.1, -0.457);
          const far = new THREE.CircleGeometry(0.08 + index * 0.017, 18);
          far.rotateY(Math.PI);
          far.scale(1.4, 0.58 + index * 0.08, 1);
          far.translate(-x, 0.13 + index * 0.08, 0.457);
          return [near, far];
        }),
        ...[-0.48, -0.12, 0.3].flatMap((x, index) => [
          transformedBox(0.025, 0.2 + index * 0.05, 0.012, x, 0.17, -0.463),
          transformedBox(0.025, 0.18 + index * 0.04, 0.012, -x, 0.15, 0.463),
        ]),
      ],
      "rail-cargo-wagon-soot-rust-rain-streak-and-wheel-spray-geometry",
    ),
    wagonSlope: mergeOwned(
      [
        (() => {
          const geometry = new THREE.BoxGeometry(1.12, 0.055, 0.25);
          geometry.rotateX(0.5);
          geometry.translate(0, -0.015, -0.145);
          return geometry;
        })(),
        (() => {
          const geometry = new THREE.BoxGeometry(1.12, 0.055, 0.25);
          geometry.rotateX(-0.5);
          geometry.translate(0, -0.015, 0.145);
          return geometry;
        })(),
        (() => {
          const geometry = new THREE.BoxGeometry(0.3, 0.055, 0.48);
          geometry.rotateZ(0.5);
          geometry.translate(-0.45, -0.015, 0);
          return geometry;
        })(),
        (() => {
          const geometry = new THREE.BoxGeometry(0.3, 0.055, 0.48);
          geometry.rotateZ(-0.5);
          geometry.translate(0.45, -0.015, 0);
          return geometry;
        })(),
      ],
      "rail-cargo-wagon-deep-trapezoidal-basin-slopes-geometry",
    ),
    wagonLadders: mergeOwned(
      [
        ...[-0.67, 0.67].flatMap((x) => [
          transformedBox(0.025, 0.28, 0.025, x, 0.08, -0.31),
          transformedBox(0.025, 0.28, 0.025, x, 0.08, -0.22),
          ...[-0.02, 0.06, 0.14, 0.22].map((y) =>
            transformedBox(0.025, 0.018, 0.11, x, y, -0.265),
          ),
        ]),
      ],
      "rail-cargo-wagon-end-ladders-geometry",
    ),
    wagonDecals: mergeOwned(
      [
        transformedBox(0.2, 0.018, 0.1, 0.27, 0.27, -0.311, 0, 0.007),
        transformedBox(0.12, 0.019, 0.12, -0.36, 0.27, 0.311, Math.PI / 4),
        ...Array.from({ length: 4 }, (_, index) =>
          transformedBox(
            0.03,
            0.019,
            0.075,
            0.22 + index * 0.045,
            0.278,
            -0.313,
          ),
        ),
      ],
      "rail-cargo-wagon-chipped-stencils-geometry",
    ),
    wagonFloor: mergeOwned(
      [
        transformedBox(0.96, 0.032, 0.28, 0, 0, 0, 0, 0.012),
        transformedBox(0.82, 0.018, 0.02, 0, 0.025, -0.09),
        transformedBox(0.82, 0.018, 0.02, 0, 0.025, 0),
        transformedBox(0.82, 0.018, 0.02, 0, 0.025, 0.09),
      ],
      "rail-cargo-wagon-drainage-floor-geometry",
    ),
    wagonDischargeSpine: mergeOwned(
      [
        transformedBox(1.02, 0.065, 0.095, 0, 0, 0, 0, 0.014),
        ...[-0.34, 0, 0.34].map((x) =>
          prismFromOutline(
            [
              [x - 0.13, -0.105],
              [x + 0.13, -0.105],
              [x + 0.17, 0],
              [x + 0.13, 0.105],
              [x - 0.13, 0.105],
              [x - 0.17, 0],
            ],
            0.035,
            0.095,
            `rail-gondola-center-discharge-gate-${x}`,
          ),
        ),
      ],
      "rail-open-gondola-visible-center-discharge-spine-geometry",
    ),
    wagonOreBedResidue: mergeOwned(
      Array.from({ length: 34 }, (_, index) => {
        const column = index % 7;
        const row = Math.floor(index / 7);
        return transformedRock(
          0.018 + (index % 4) * 0.004,
          -0.48 +
            column * 0.16 +
            Math.sin(index * 1.73) * 0.028,
          0.018 + (index % 3) * 0.006,
          -0.14 +
            row * 0.07 +
            Math.cos(index * 1.31) * 0.022,
          index * 1.417,
          1.2 + (index % 5) * 0.12,
          0.48 + (index % 3) * 0.1,
        );
      }),
      "rail-open-gondola-low-irregular-ochre-bed-residue-not-cargo-geometry",
    ),
    wagonLip: mergeOwned(
      [
        transformedBox(1.24, 0.07, 0.115, 0, 0, -0.36, 0, 0.014),
        transformedBox(1.24, 0.07, 0.115, 0, 0, 0.36, 0, 0.014),
        transformedBox(0.075, 0.068, 0.6, -0.68, 0, 0, 0, 0.014),
        transformedBox(0.075, 0.068, 0.6, 0.68, 0, 0, 0, 0.014),
        transformedBox(0.16, 0.068, 0.08, -0.615, 0, -0.315, -0.62, 0.012),
        transformedBox(0.16, 0.068, 0.08, -0.615, 0, 0.315, 0.62, 0.012),
        transformedBox(0.16, 0.068, 0.08, 0.615, 0, -0.315, 0.62, 0.012),
        transformedBox(0.16, 0.068, 0.08, 0.615, 0, 0.315, -0.62, 0.012),
      ],
      "rail-cargo-wagon-thick-octagonal-top-rim-geometry",
    ),
    wagonCoveredShoulders: mergeOwned(
      [
        (() => {
          const geometry = new THREE.BoxGeometry(1.14, 0.05, 0.22);
          geometry.rotateX(-0.32);
          geometry.translate(0, 0, -0.225);
          return geometry;
        })(),
        (() => {
          const geometry = new THREE.BoxGeometry(1.14, 0.05, 0.22);
          geometry.rotateX(0.32);
          geometry.translate(0, 0, 0.225);
          return geometry;
        })(),
        ...[-0.43, 0, 0.43].map((x) =>
          transformedBox(0.045, 0.055, 0.52, x, 0.035, 0, 0, 0.008),
        ),
      ],
      "rail-covered-hopper-sloped-roof-shoulders-geometry",
    ),
    wagonGondolaCrossTies: mergeOwned(
      [
        ...[-0.4, 0, 0.4].map((x) =>
          transformedBox(0.045, 0.055, 0.61, x, 0, 0, 0, 0.009),
        ),
        transformedBox(1.1, 0.025, 0.035, 0, -0.035, -0.24, 0, 0.006),
        transformedBox(1.1, 0.025, 0.035, 0, -0.035, 0.24, 0, 0.006),
      ],
      "rail-open-gondola-cross-ties-and-inner-ribs-geometry",
    ),
    wagonRimHardware: mergeOwned(
      [
        ...[-0.5, -0.25, 0, 0.25, 0.5].flatMap((x) => [
          transformedCylinder(0.017, 0.025, x, 0, -0.422, 8),
          transformedCylinder(0.017, 0.025, x, 0, 0.422, 8),
        ]),
        ...[-0.24, 0, 0.24].flatMap((z) => [
          transformedCylinder(0.017, 0.025, -0.72, 0, z, 8),
          transformedCylinder(0.017, 0.025, 0.72, 0, z, 8),
        ]),
      ],
      "rail-cargo-wagon-rim-rivets-and-tie-bolts-geometry",
    ),
    wagonDraftSill: mergeOwned(
      [
        transformedBox(0.28, 0.08, 0.18, -0.79, 0, 0, 0, 0.016),
        transformedBox(0.28, 0.08, 0.18, 0.79, 0, 0, 0, 0.016),
        transformedBox(0.2, 0.035, 0.3, -0.74, 0.055, 0, 0, 0.008),
        transformedBox(0.2, 0.035, 0.3, 0.74, 0.055, 0, 0, 0.008),
      ],
      "rail-cargo-wagon-visible-draft-sill-and-end-platform-geometry",
    ),
    wagonRibs: mergeOwned(
      [-0.48, -0.24, 0, 0.24, 0.48].flatMap((x) => [
        transformedBox(0.068, 0.48, 0.055, x, 0, -0.445, 0, 0.012),
        transformedBox(0.068, 0.48, 0.055, x, 0, 0.445, 0, 0.012),
      ]),
      "rail-cargo-wagon-heavy-external-side-ribs-geometry",
    ),
    wagonHazardPlate: (() => {
      const geometry = new RoundedBoxGeometry(0.18, 0.025, 0.14, 2, 0.012);
      geometry.name = "rail-cargo-wagon-hazard-plate-geometry";
      return geometry;
    })(),
    wagonServiceHatch: mergeOwned(
      [
        prismFromOutline(
          [
            [-0.43, -0.045],
            [-0.405, -0.07],
            [0.405, -0.07],
            [0.43, -0.045],
            [0.43, 0.045],
            [0.405, 0.07],
            [-0.405, 0.07],
            [-0.43, 0.045],
          ],
          -0.0225,
          0.0225,
          "rail-cargo-wagon-chamfered-sliding-hatch-panel",
        ),
        ...[-0.32, -0.16, 0, 0.16, 0.32].map((x) =>
          transformedBox(0.026, 0.025, 0.16, x, 0.032, 0, 0, 0.005),
        ),
        transformedBox(0.19, 0.035, 0.035, 0.22, 0.06, 0, 0, 0.006),
      ],
      "rail-cargo-wagon-sliding-service-hatch-geometry",
    ),
    cargoLoad: mergeOwned(
      Array.from({ length: 88 }, (_, index) => {
        const radius = Math.sqrt((index + 0.45) / 88);
        const angle = index * 2.399963 + Math.sin(index * 0.71) * 0.16;
        const x = Math.cos(angle) * radius * 0.46;
        const z = Math.sin(angle) * radius * 0.18;
        const mound = Math.max(0, 1 - radius);
        return transformedRock(
          0.018 + (index % 5) * 0.003,
          x,
          0.024 + mound * 0.12 + (index % 3) * 0.006,
          z,
          index * 1.319,
          1.05 + (index % 4) * 0.1,
          0.76 + (index % 3) * 0.09,
        );
      }),
      "rail-authoritative-cargo-load-geometry",
    ),
    fuelGauge: (() => {
      const geometry = new RoundedBoxGeometry(0.22, 0.045, 0.055, 2, 0.012);
      geometry.name = "rail-locomotive-fuel-gauge-geometry";
      return geometry;
    })(),
    routeDrum: (() => {
      const geometry = new THREE.CylinderGeometry(0.09, 0.09, 0.06, 14);
      geometry.rotateX(Math.PI / 2);
      geometry.name = "rail-locomotive-route-drum-geometry";
      return geometry;
    })(),
    brakeShoe: (() => {
      const geometry = new RoundedBoxGeometry(0.12, 0.035, 0.045, 2, 0.01);
      geometry.name = "rail-brake-shoe-geometry";
      return geometry;
    })(),
    smokePuff: (() => {
      const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
      geometry.rotateX(-Math.PI / 2);
      geometry.name = "rail-locomotive-exhaust-puff-geometry";
      return geometry;
    })(),
    overviewTrain: mergeOwned(
      [
        transformedBox(0.72, 0.24, 0.34, 0, 0.22, 0, 0, 0.04),
        transformedCylinder(0.11, 0.38, -0.22, 0.11, 0, 12),
        transformedCylinder(0.11, 0.38, 0.22, 0.11, 0, 12),
      ],
      "rail-overview-train-geometry",
    ),
    overviewStation: mergeOwned(
      [
        transformedBox(1.15, 0.14, 0.42, 0, 0.07, -0.55, 0, 0.03),
        transformedBox(0.9, 0.05, 0.48, 0, 0.72, -0.55, 0, 0.02),
        transformedBox(0.05, 0.62, 0.05, -0.34, 0.4, -0.55),
        transformedBox(0.05, 0.62, 0.05, 0.34, 0.4, -0.55),
      ],
      "rail-overview-station-geometry",
    ),
    all: [],
  };
  (geometries as { all: readonly THREE.BufferGeometry[] }).all = Object.freeze(
    Object.entries(geometries)
      .filter(([key]) => key !== "all")
      .flatMap(([, value]) =>
        value instanceof THREE.BufferGeometry
          ? [value]
          : Object.values(
              value as
                | IntegratedTurnoutGeometries
                | IntegratedMainBedGeometries
                | IntegratedBypassGeometries
                | StationDistrictGeometries,
            ),
      ),
  );
  return geometries;
}

function segmentYaw(node: RailGraphNode): number {
  if (node.kind === "straight") {
    return node.rotation % 2 === 1 ? 0 : Math.PI / 2;
  }
  return -node.rotation * (Math.PI / 2);
}

function nodeMatrix(node: RailGraphNode, y = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(node.x + 0.5, y, node.y + 0.5),
    new THREE.Quaternion().setFromAxisAngle(Y_AXIS, segmentYaw(node)),
    new THREE.Vector3(1, 1, 1),
  );
}

function directionBetween(
  from: RailGraphNode,
  to: RailGraphNode,
): RailDirection | null {
  const dx = to.x - from.x;
  const dz = to.y - from.y;
  if (dx === 1 && dz === 0) return "east";
  if (dx === -1 && dz === 0) return "west";
  if (dx === 0 && dz === 1) return "south";
  if (dx === 0 && dz === -1) return "north";
  return null;
}

function oppositeDirection(direction: RailDirection): RailDirection {
  switch (direction) {
    case "north":
      return "south";
    case "east":
      return "west";
    case "south":
      return "north";
    case "west":
      return "east";
  }
}

function waitConditionIndex(wait: RailWaitCondition): number {
  switch (wait.type) {
    case "time":
      return 0;
    case "cargo-empty":
      return 1;
    case "cargo-full":
      return 2;
    case "item-at-least":
      return 3;
    case "item-at-most":
      return 4;
  }
}

type StationServiceStage =
  "retracted" | "approach" | "contact" | "transfer" | "verify" | "return";

interface StationServiceMotion {
  readonly stage: StationServiceStage;
  readonly extension: number;
  readonly hatch: number;
  readonly transfer: number;
  readonly contact: number;
}

function stationServiceMotion(
  phase: number,
  active: boolean,
): StationServiceMotion {
  if (!active) {
    return {
      stage: "retracted",
      extension: 0,
      hatch: 0,
      transfer: 0,
      contact: 0,
    };
  }
  const normalized = ((phase % 1) + 1) % 1;
  if (normalized < 0.22) {
    const progress = smoothUnit(normalized / 0.22);
    return {
      stage: "approach",
      extension: progress,
      hatch: smoothUnit(Math.max(0, (progress - 0.48) / 0.52)),
      transfer: 0,
      contact: 0,
    };
  }
  if (normalized < 0.32) {
    const progress = smoothUnit((normalized - 0.22) / 0.1);
    return {
      stage: "contact",
      extension: 1,
      hatch: 1,
      transfer: 0,
      contact: progress,
    };
  }
  if (normalized < 0.68) {
    const progress = (normalized - 0.32) / 0.36;
    return {
      stage: "transfer",
      extension: 1,
      hatch: 1,
      transfer: Math.sin(progress * Math.PI) * 0.34 + 0.66,
      contact: 1,
    };
  }
  if (normalized < 0.78) {
    return {
      stage: "verify",
      extension: 1,
      hatch: 1,
      transfer: 0,
      contact: 1,
    };
  }
  const progress = smoothUnit((normalized - 0.78) / 0.22);
  return {
    stage: "return",
    extension: 1 - progress,
    hatch: 1 - smoothUnit(Math.max(0, (progress - 0.18) / 0.82)),
    transfer: 0,
    contact: 1 - progress,
  };
}

const CAMPAIGN_WEST_TURNOUT_TRAVERSAL = Object.freeze([
  "campaign-main-08",
  "campaign-main-09",
  "campaign-main-10",
  "campaign-main-11",
  "campaign-main-12",
  "campaign-main-13",
  "campaign-siding-west-curve",
  "campaign-siding-14",
  "campaign-siding-15",
  "campaign-siding-16",
]);

function inferredCampaignWestTraversalDirection(
  train: RailTrainSnapshot,
): -1 | 1 | null {
  if (!train.path.includes("campaign-siding-west-curve")) return null;
  for (let index = 1; index < train.path.length; index += 1) {
    const left = CAMPAIGN_WEST_TURNOUT_TRAVERSAL.indexOf(
      train.path[index - 1]!,
    );
    const right = CAMPAIGN_WEST_TURNOUT_TRAVERSAL.indexOf(train.path[index]!);
    if (left >= 0 && right >= 0 && left !== right) {
      return right > left ? 1 : -1;
    }
  }
  return null;
}

function campaignWestTurnoutPose(
  node: RailGraphNode,
  ratio: number,
  direction: -1 | 1 | null,
): TrainPose | null {
  const traversalIndex = CAMPAIGN_WEST_TURNOUT_TRAVERSAL.indexOf(
    node.segmentId,
  );
  if (traversalIndex < 0 || direction === null) return null;
  const points = cubicTrackPoints(
    [CAMPAIGN_TURNOUT_START_X, 0],
    [-1.75, CAMPAIGN_SIDING_SEPARATION * 0.00925],
    [0.25, CAMPAIGN_SIDING_SEPARATION * 0.9784],
    [CAMPAIGN_TURNOUT_END_X, CAMPAIGN_SIDING_SEPARATION],
    128,
  );
  const progress =
    (traversalIndex + (direction > 0 ? ratio : 1 - ratio)) /
    CAMPAIGN_WEST_TURNOUT_TRAVERSAL.length;
  const scaled = progress * (points.length - 1);
  const pointIndex = Math.min(points.length - 2, Math.floor(scaled));
  const local = points[pointIndex]!.clone().lerp(
    points[pointIndex + 1]!,
    scaled - pointIndex,
  );
  const tangent = points[pointIndex + 1]!.clone().sub(points[pointIndex]!);
  return {
    x: 13.5 + local.x,
    z: 16.5 + local.z,
    yaw: -Math.atan2(direction * tangent.z, direction * tangent.x),
  };
}

function trainPose(
  train: RailTrainSnapshot,
  nodes: ReadonlyMap<string, RailGraphNode>,
  campaignWestTraversalDirection = inferredCampaignWestTraversalDirection(
    train,
  ),
): TrainPose {
  const node = nodes.get(train.currentSegmentId);
  if (!node) return { x: 0, z: 0, yaw: 0 };
  const centerX = node.x + 0.5;
  const centerZ = node.y + 0.5;
  const next = train.path[1] ? nodes.get(train.path[1]) : undefined;
  const nextDirection = next ? directionBetween(node, next) : null;
  const ratio = Math.max(
    0,
    Math.min(1, train.progressMilli / railSegmentLength(node.kind)),
  );
  const authoredCampaignTurnoutPose = campaignWestTurnoutPose(
    node,
    ratio,
    campaignWestTraversalDirection,
  );
  if (authoredCampaignTurnoutPose) return authoredCampaignTurnoutPose;

  if (node.kind === "junction" && nextDirection) {
    const branchDirection = (["north", "east", "south", "west"] as const)[
      node.rotation
    ];
    if (nextDirection === branchDirection) {
      const points = cubicTrackPoints(
        [-0.5, 0],
        [-0.13, 0],
        [-0.015, -0.17],
        [0, -0.5],
        64,
      );
      const scaled = ratio * (points.length - 1);
      const index = Math.min(points.length - 2, Math.floor(scaled));
      const local = points[index]!.clone().lerp(
        points[index + 1]!,
        scaled - index,
      );
      const tangent = points[index + 1]!.clone().sub(points[index]!);
      const yaw = segmentYaw(node);
      local.applyAxisAngle(Y_AXIS, yaw);
      tangent.applyAxisAngle(Y_AXIS, yaw);
      return {
        x: centerX + local.x,
        z: centerZ + local.z,
        yaw: -Math.atan2(tangent.z, tangent.x),
      };
    }
  }

  if (node.kind === "curve" && nextDirection) {
    const exitVector = DIRECTION_VECTOR[nextDirection];
    const entryDirection =
      node.ports.find(
        (port) =>
          port !== nextDirection && port !== oppositeDirection(nextDirection),
      ) ?? node.ports.find((port) => port !== nextDirection);
    if (entryDirection) {
      const entryVector = DIRECTION_VECTOR[entryDirection];
      const points = quadraticTrackPoints(
        [entryVector[0] * 0.5, entryVector[1] * 0.5],
        [exitVector[0] * 0.5, exitVector[1] * 0.5],
        32,
      );
      const scaled = ratio * (points.length - 1);
      const index = Math.min(points.length - 2, Math.floor(scaled));
      const local = points[index]!.clone().lerp(
        points[index + 1]!,
        scaled - index,
      );
      const tangent = points[index + 1]!.clone().sub(points[index]!);
      return {
        x: centerX + local.x,
        z: centerZ + local.z,
        yaw: -Math.atan2(tangent.z, tangent.x),
      };
    }
  }

  let direction: RailDirection;
  if (nextDirection) {
    direction = nextDirection;
  } else if (node.kind === "straight") {
    direction = node.rotation % 2 === 1 ? "east" : "north";
  } else {
    direction = node.ports[0] ?? "east";
  }
  const [dx, dz] = DIRECTION_VECTOR[direction];
  const travel = train.status === "dwelling" ? 0 : ratio - 0.5;
  return {
    x: centerX + dx * travel,
    z: centerZ + dz * travel,
    yaw: -Math.atan2(dz, dx),
  };
}

function interpolateYaw(left: number, right: number, ratio: number): number {
  const delta = Math.atan2(Math.sin(right - left), Math.cos(right - left));
  return left + delta * ratio;
}

function extrapolateTrainPose(sample: TrainPose, metres: number): TrainPose {
  return {
    x: sample.x + Math.cos(sample.yaw) * metres,
    z: sample.z - Math.sin(sample.yaw) * metres,
    yaw: sample.yaw,
  };
}

function sampleTrainPoseHistory(
  history: readonly TrainPoseSample[],
  targetDistanceMilli: number,
  fallback: TrainPose,
): TrainPose {
  if (history.length === 0) {
    return extrapolateTrainPose(fallback, targetDistanceMilli / 1_000);
  }
  const first = history[0]!;
  if (targetDistanceMilli <= first.distanceMilli) {
    return extrapolateTrainPose(
      first,
      (targetDistanceMilli - first.distanceMilli) / 1_000,
    );
  }
  for (let index = 1; index < history.length; index += 1) {
    const right = history[index]!;
    if (targetDistanceMilli > right.distanceMilli) continue;
    const left = history[index - 1]!;
    const span = Math.max(1, right.distanceMilli - left.distanceMilli);
    const ratio = Math.max(
      0,
      Math.min(1, (targetDistanceMilli - left.distanceMilli) / span),
    );
    return {
      x: THREE.MathUtils.lerp(left.x, right.x, ratio),
      z: THREE.MathUtils.lerp(left.z, right.z, ratio),
      yaw: interpolateYaw(left.yaw, right.yaw, ratio),
    };
  }
  const last = history[history.length - 1]!;
  return extrapolateTrainPose(
    last,
    (targetDistanceMilli - last.distanceMilli) / 1_000,
  );
}

function carSignature(train: RailTrainSnapshot): string {
  return train.cars
    .map((car) => `${car.id}:${car.kind}:${car.capacity}`)
    .join("|");
}

function cargoMaterialFor(
  itemId: string | undefined,
  materials: RailMaterials,
): THREE.Material {
  if (!itemId) return materials.cargoProduct;
  if (itemId.includes("iron")) return materials.cargoIron;
  if (itemId.includes("copper")) return materials.cargoCopper;
  if (itemId === "coal") return materials.cargoCoal;
  if (itemId.includes("stone")) return materials.cargoStone;
  return materials.cargoProduct;
}

function visibleCost(root: THREE.Object3D): {
  drawBatches: number;
  triangles: number;
} {
  let drawBatches = 0;
  let triangles = 0;
  root.traverse((object) => {
    let ancestor: THREE.Object3D | null = object;
    while (ancestor && ancestor !== root.parent) {
      if (!ancestor.visible) return;
      if (ancestor === root) break;
      ancestor = ancestor.parent;
    }
    if (!(
      object instanceof THREE.Mesh ||
      object instanceof THREE.Sprite ||
      object instanceof THREE.Line
    )) {
      return;
    }
    if (object instanceof THREE.InstancedMesh && object.count === 0) {
      return;
    }
    drawBatches += 1;
    if (!(object instanceof THREE.Mesh)) return;
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

function setShadow(mesh: THREE.Mesh, cast = true): void {
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
}

function poseArticulatedMember(
  mesh: THREE.Mesh,
  start: THREE.Vector3,
  end: THREE.Vector3,
): void {
  const direction = end.clone().sub(start);
  const length = Math.max(0.001, direction.length());
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    direction.normalize(),
  );
  mesh.scale.set(1, 1, length / 0.5);
}

function smoothUnit(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

export class RailRenderer {
  readonly root = new THREE.Group();

  private readonly trackRoot = new THREE.Group();
  private readonly overlayRoot = new THREE.Group();
  private readonly signalRoot = new THREE.Group();
  private readonly stationRoot = new THREE.Group();
  private readonly trainRoot = new THREE.Group();
  private readonly overviewRoot = new THREE.Group();
  private readonly authoringRoot = new THREE.Group();
  private readonly authoringPreviewRoot = new THREE.Group();
  private authoringSelectedMarker!: THREE.Mesh;
  private authoringSourceMarker!: THREE.Mesh;
  private authoringValidMarker!: THREE.Group;
  private authoringBlockedMarker!: THREE.Group;
  private readonly authoringPreviewShapes = new Map<
    RailBuildKind,
    THREE.Object3D
  >();
  private readonly authoringOwnedGeometries: THREE.BufferGeometry[] = [];
  private readonly authoringOwnedMaterials: THREE.Material[] = [];
  private authoringOverlay: RailAuthoringOverlay | null = null;
  private lastRailSnapshot: RailNetworkSnapshot | null = null;
  private readonly options: NormalizedOptions;
  private readonly ballastTexture: THREE.Texture;
  private readonly surfaceTexture: THREE.Texture;
  private readonly smokeTexture: THREE.DataTexture;
  private readonly materials: RailMaterials;
  private readonly geometries: RailGeometries;
  private readonly batches = new Map<string, InstancedBatch>();
  private readonly trainRigs = new Map<string, TrainRig>();
  private readonly stationRigs = new Map<string, StationRig>();
  private readonly tempObject = new THREE.Object3D();
  private disposed = false;
  private disposedGeometries = 0;
  private disposedMaterials = 0;
  private disposedTextures = 0;
  private disposedInstancedMeshes = 0;
  private debug: RailRenderDebug = EMPTY_DEBUG;

  public constructor(
    parent: THREE.Object3D,
    options: RailRendererOptions = {},
  ) {
    this.options = normalizeOptions(options);
    this.ballastTexture = createAgedBallastTexture();
    this.surfaceTexture = createAgedSurfaceTexture();
    this.smokeTexture = createSmokeTexture();
    this.materials = createMaterials(
      this.ballastTexture,
      this.surfaceTexture,
      this.smokeTexture,
    );
    this.geometries = createGeometries();
    this.root.name = "rail-world-system";
    this.trackRoot.name = "rail-track-batches";
    this.overlayRoot.name = "rail-block-and-route-overlays";
    this.overlayRoot.visible = this.options.showOperationalOverlays;
    this.signalRoot.name = "rail-authoritative-signals";
    this.stationRoot.name = "rail-station-service-rigs";
    this.trainRoot.name = "rail-detailed-train-rigs";
    this.overviewRoot.name = "rail-overview-lod";
    this.authoringRoot.name = "rail-authoring-overlay";
    this.authoringPreviewRoot.name = "rail-authoring-preview";
    this.root.userData.occupancyModel = "exclusive-block-atomic-consist";
    this.root.userData.operationalOverlayMode = this.options
      .showOperationalOverlays
      ? "explicit-debug"
      : "physical-signals-only";
    this.root.add(
      this.overlayRoot,
      this.trackRoot,
      this.signalRoot,
      this.stationRoot,
      this.trainRoot,
      this.overviewRoot,
      this.authoringRoot,
    );
    this.setupAuthoringOverlay();
    parent.add(this.root);
    this.refreshResourceDebug();
  }

  public sync(frame: RailVisualFrame): void {
    this.assertLive();
    if (!Number.isFinite(frame.elapsedSeconds)) {
      throw new Error("Rail renderer elapsed time must be finite.");
    }
    if (!frame.rail) {
      this.lastRailSnapshot = null;
      this.authoringOverlay = null;
      this.syncAuthoringOverlay();
      this.clearVisualState();
      this.debug = Object.freeze({
        ...EMPTY_DEBUG,
        resources: this.resourceSnapshot(),
      });
      this.root.visible = false;
      return;
    }

    const rail = frame.rail;
    this.lastRailSnapshot = rail;
    const sortedNodes = [...rail.graph.nodes].sort((left, right) =>
      compareText(left.segmentId, right.segmentId),
    );
    const renderedNodes = sortedNodes.slice(
      0,
      this.options.maxRenderedSegments,
    );
    const renderedNodeIds = new Set(
      renderedNodes.map((node) => node.segmentId),
    );
    const nodeById = new Map(sortedNodes.map((node) => [node.segmentId, node]));
    const sortedSignals = [...rail.signals].sort((left, right) =>
      compareText(left.id, right.id),
    );
    const renderedSignals = sortedSignals
      .filter(
        (signal) =>
          renderedNodeIds.has(signal.fromSegmentId) &&
          renderedNodeIds.has(signal.toSegmentId),
      )
      .slice(0, this.options.maxRenderedSignals);
    const sortedStations = [...rail.stations].sort((left, right) =>
      compareText(left.id, right.id),
    );
    const sortedTrains = [...rail.trains].sort((left, right) =>
      compareText(left.id, right.id),
    );

    const sortedEdges = [...rail.graph.edges].sort((left, right) =>
      compareText(
        `${left.fromSegmentId}>${left.toSegmentId}`,
        `${right.fromSegmentId}>${right.toSegmentId}`,
      ),
    );
    const sortedBlocks = [...rail.graph.blocks].sort((left, right) =>
      compareText(left.id, right.id),
    );
    const sortedReservations = [...rail.reservations].sort((left, right) =>
      compareText(
        `${left.blockId}:${left.trainId}:${left.kind}`,
        `${right.blockId}:${right.trainId}:${right.kind}`,
      ),
    );
    const topologyParts = [
      `revision:${rail.topologyRevision}`,
      ...sortedNodes.map(
        (node) =>
          `n:${node.segmentId}:${node.x}:${node.y}:${node.kind}:${node.rotation}:${node.blockId}`,
      ),
      ...sortedEdges.map(
        (edge) =>
          `e:${edge.fromSegmentId}>${edge.toSegmentId}:${edge.costMilli}`,
      ),
      ...sortedBlocks.map(
        (block) =>
          `b:${block.id}:${[...block.segmentIds].sort(compareText).join(",")}`,
      ),
      ...sortedSignals.map(
        (signal) =>
          `s:${signal.id}:${signal.type}:${signal.fromSegmentId}>${signal.toSegmentId}`,
      ),
      ...sortedStations.map(
        (station) => `p:${station.id}:${station.segmentId}`,
      ),
      ...sortedTrains.map((train) => `c:${train.id}:${carSignature(train)}`),
    ];
    const stateParts = [
      `tick:${rail.tick}`,
      ...sortedSignals.map((signal) => `s:${signal.id}:${signal.aspect}`),
      ...sortedReservations.map(
        (reservation) =>
          `r:${reservation.blockId}:${reservation.trainId}:${reservation.kind}`,
      ),
      ...sortedTrains.map(
        (train) =>
          `t:${train.id}:${train.currentSegmentId}:${train.progressMilli}:${train.speedMilliPerTick}:${train.status}:${train.scheduleIndex}:${train.dwellTicks}:${train.reservationWaitTicks}:${train.fuelMilli}:${train.distanceTravelledMilli}:${train.path.join(",")}:${train.cargo.map((stack) => `${stack.itemId}=${stack.count}`).join(",")}`,
      ),
    ];
    const topologySignature = `rail-topology-${fnv1a(topologyParts)}`;
    const stateSignature = `rail-state-${fnv1a(stateParts)}`;

    this.syncTrack(renderedNodes);
    const overlayCounts = this.syncOverlays(
      rail,
      renderedNodes,
      renderedNodeIds,
    );
    this.syncSignals(renderedSignals, nodeById);
    const stationCounts = this.syncStations(
      sortedStations,
      sortedTrains,
      nodeById,
    );
    const trainCounts = this.syncTrains(
      sortedTrains,
      nodeById,
      frame.elapsedSeconds,
    );
    this.syncAuthoringOverlay();
    this.update(frame.elapsedSeconds);

    const statusCounts = {
      dwelling: 0,
      moving: 0,
      "waiting-signal": 0,
      "no-path": 0,
      "out-of-fuel": 0,
    } satisfies Record<RailTrainStatus, number>;
    for (const train of sortedTrains) statusCounts[train.status] += 1;
    const cost = visibleCost(this.root);
    this.root.visible = true;
    this.debug = Object.freeze({
      disposed: false,
      topologySignature,
      stateSignature,
      tick: rail.tick,
      topologyRevision: rail.topologyRevision,
      segments: sortedNodes.length,
      renderedSegments: renderedNodes.length,
      omittedSegments: sortedNodes.length - renderedNodes.length,
      straightSegments: renderedNodes.filter((node) => node.kind === "straight")
        .length,
      curvedSegments: renderedNodes.filter((node) => node.kind === "curve")
        .length,
      junctionSegments: renderedNodes.filter((node) => node.kind === "junction")
        .length,
      blocks: rail.graph.blocks.length,
      occupiedBlocks: rail.reservations.filter(
        (reservation) => reservation.kind === "occupied",
      ).length,
      reservedBlocks: rail.reservations.filter(
        (reservation) => reservation.kind === "reserved",
      ).length,
      routeSegments: overlayCounts.routeSegments,
      omittedRouteSegments: overlayCounts.omittedRouteSegments,
      signals: sortedSignals.length,
      omittedSignals: sortedSignals.length - renderedSignals.length,
      regularSignals: sortedSignals.filter(
        (signal) => signal.type === "regular",
      ).length,
      chainSignals: sortedSignals.filter((signal) => signal.type === "chain")
        .length,
      redSignals: sortedSignals.filter((signal) => signal.aspect === "red")
        .length,
      greenSignals: sortedSignals.filter((signal) => signal.aspect === "green")
        .length,
      chainClearSignals: sortedSignals.filter(
        (signal) => signal.aspect === "chain-clear",
      ).length,
      stations: sortedStations.length,
      detailedStations: stationCounts.detailed,
      overviewStations: stationCounts.overview,
      activeStations: stationCounts.active,
      trains: sortedTrains.length,
      detailedTrains: trainCounts.detailed,
      overviewTrains: trainCounts.overview,
      detailedCars: trainCounts.detailedCars,
      overviewCars: trainCounts.overviewCars,
      omittedCars: trainCounts.omittedCars,
      locomotives: sortedTrains.reduce(
        (sum, train) =>
          sum + train.cars.filter((car) => car.kind === "locomotive").length,
        0,
      ),
      cargoWagons: sortedTrains.reduce(
        (sum, train) =>
          sum + train.cars.filter((car) => car.kind === "cargo-wagon").length,
        0,
      ),
      cargoUnits: sortedTrains.reduce(
        (sum, train) => sum + train.cargoUnits,
        0,
      ),
      fuelMilli: sortedTrains.reduce((sum, train) => sum + train.fuelMilli, 0),
      statusCounts: Object.freeze(statusCounts),
      drawBatches: cost.drawBatches,
      triangles: cost.triangles,
      capacities: Object.freeze({
        trackInstances: this.capacityMatching("track-"),
        signalInstances: this.capacityMatching("signal-"),
        overlayInstances: this.capacityMatching("overlay-"),
        overviewInstances: this.capacityMatching("overview-"),
      }),
      resources: this.resourceSnapshot(),
      occupancyModel: "exclusive-block-atomic-consist",
    });
    this.root.userData.topologySignature = topologySignature;
    this.root.userData.stateSignature = stateSignature;
    this.root.userData.tick = rail.tick;
  }

  public update(elapsedSeconds: number): void {
    this.assertLive();
    if (!Number.isFinite(elapsedSeconds)) {
      throw new Error("Rail renderer elapsed time must be finite.");
    }
    for (const rig of this.trainRigs.values()) {
      const fractionalTick = Math.max(
        0,
        Math.min(1, (elapsedSeconds - rig.syncElapsedSeconds) * 60),
      );
      const visualDistance =
        rig.baseDistanceMilli + rig.speedMilliPerTick * fractionalTick;
      const wheelAngle = visualDistance / 1_000 / WHEEL_RADIUS;
      const visualTravel =
        rig.status === "moving"
          ? (rig.speedMilliPerTick * fractionalTick) / 1_000
          : 0;
      rig.root.position.x = rig.baseX + Math.cos(rig.baseYaw) * visualTravel;
      rig.root.position.z = rig.baseZ - Math.sin(rig.baseYaw) * visualTravel;
      for (const car of rig.cars) {
        const carX = car.basePose.x + Math.cos(car.basePose.yaw) * visualTravel;
        const carZ = car.basePose.z - Math.sin(car.basePose.yaw) * visualTravel;
        const local = new THREE.Vector3(
          carX - rig.root.position.x,
          0,
          carZ - rig.root.position.z,
        ).applyAxisAngle(Y_AXIS, -rig.baseYaw);
        car.root.position.set(local.x, 0, local.z);
        car.root.rotation.y = car.basePose.yaw - rig.baseYaw;
        for (let index = 0; index < car.wheels.length; index += 1) {
          car.wheels[index]!.rotation.z =
            wheelAngle + (index % 2 === 0 ? 0 : Math.PI);
        }
        for (let index = 0; index < car.rods.length; index += 1) {
          const phase = wheelAngle + index * Math.PI;
          car.rods[index]!.position.y = -0.09 + Math.sin(phase) * 0.018;
          car.rods[index]!.rotation.z = Math.sin(phase) * 0.055;
        }
        for (const hatch of car.serviceHatches) {
          const side = Number(hatch.userData.side ?? 1);
          hatch.position.set(0, 0.91, side * 0.145);
          hatch.rotation.set(0, 0, 0);
          hatch.userData.openRatio = 0;
          hatch.userData.serviceStage = "retracted";
        }
        if (car.servicePort) {
          car.servicePort.material = this.materials.inactive;
          car.servicePort.userData = {
            contact: false,
            serviceStage: "retracted",
          };
        }
      }
      rig.routeDrum.rotation.z =
        elapsedSeconds * 0.9 + rig.baseDistanceMilli * 0.0003;
      for (let index = 0; index < rig.smoke.length; index += 1) {
        const smoke = rig.smoke[index]!;
        const moving = rig.status === "moving";
        smoke.visible = moving;
        const phase = (((elapsedSeconds * 0.72 + index * 0.34) % 1) + 1) % 1;
        smoke.position.set(
          0.2 - phase * 0.14,
          1.12 + phase * 0.54,
          (index - 1) * 0.035,
        );
        smoke.scale.setScalar(0.1 + phase * 0.15);
        smoke.rotation.y = phase * 1.7;
      }
    }
    for (const rig of this.stationRigs.values()) {
      const phase = elapsedSeconds * 0.62 + rig.servicePhase;
      const transferPhase = ((phase % 1) + 1) % 1;
      rig.transferPhase = transferPhase;
      rig.crane.position.x = -1.97;
      rig.serviceArm.rotation.z = 0;
      rig.loadChainRoot.visible =
        rig.serviceMode === "load" ||
        (rig.serviceMode === "service" && rig.serviceActive);
      rig.unloadChainRoot.visible = rig.serviceMode === "unload";
      rig.cargoIndicator.position.y = rig.serviceActive
        ? 0.2 + Math.sin(phase * Math.PI * 2) * 0.018
        : 0.2;
      for (let index = 0; index < rig.beltPayloads.length; index += 1) {
        const payload = rig.beltPayloads[index]!;
        const unloadOutfeed = payload.userData.unloadOutfeed === true;
        const travel =
          (((elapsedSeconds * 0.28 + index / rig.beltPayloads.length) % 1) +
            1) %
          1;
        payload.position.x = unloadOutfeed
          ? -3.02 + travel * 2.94
          : -3.02 + (1 - travel) * 2.94;
        payload.position.y =
          (unloadOutfeed ? 0.43 : 0.46) +
          Math.sin((travel + index) * Math.PI * 2) * 0.006;
        payload.visible = unloadOutfeed
          ? rig.serviceMode === "unload"
          : rig.serviceMode === "load";
      }
      for (let index = 0; index < rig.loadChutes.length; index += 1) {
        const chute = rig.loadChutes[index]!;
        const offsetPhase = (((transferPhase - index * 0.12) % 1) + 1) % 1;
        const loading =
          rig.serviceActive &&
          index === rig.heroWagonIndex &&
          (rig.serviceMode === "load" || rig.serviceMode === "service");
        const motion = stationServiceMotion(offsetPhase, loading);
        const extension = THREE.MathUtils.lerp(0.12, 1.45, motion.extension);
        const nozzleY = THREE.MathUtils.lerp(1.54, 1.5, motion.extension);
        chute.nozzle.position.set(0, nozzleY, extension);
        chute.gate.position.set(0, nozzleY + 0.15, extension);
        chute.gate.rotation.z =
          THREE.MathUtils.lerp(-0.38, 0.38, motion.contact) +
          Math.sin(offsetPhase * Math.PI * 2) * 0.04 * motion.extension;
        poseArticulatedMember(
          chute.boom,
          new THREE.Vector3(0, 1.12, -0.04),
          new THREE.Vector3(0, nozzleY + 0.04, extension - 0.08),
        );
        const flowing =
          rig.serviceMode === "load" &&
          motion.stage === "transfer" &&
          motion.transfer > 0;
        chute.payload.visible = flowing;
        chute.payload.scale.set(
          1.08 + motion.transfer * 0.18,
          1.02 + motion.transfer * 0.15,
          1.08 + motion.transfer * 0.18,
        );
        chute.payload.position.set(0, nozzleY - 0.015, extension);
        chute.payload.rotation.y =
          Math.sin(offsetPhase * Math.PI * 4) * 0.08;
        const servicing =
          rig.serviceMode === "service" &&
          (motion.stage === "contact" ||
            motion.stage === "transfer" ||
            motion.stage === "verify");
        chute.serviceCartridge.visible = servicing;
        const cartridgeTravel =
          motion.stage === "contact" ? motion.contact : servicing ? 1 : 0;
        chute.serviceCartridge.position.set(
          0,
          nozzleY - 0.08 + Math.sin(offsetPhase * Math.PI * 8) * 0.012,
          THREE.MathUtils.lerp(0.18, extension, cartridgeTravel),
        );
        chute.serviceCartridge.rotation.y = offsetPhase * Math.PI * 2;
        const activeTrainId = rig.root.userData.activeTrainId as
          string | null | undefined;
        const activeTrainRig = activeTrainId
          ? this.trainRigs.get(activeTrainId)
          : undefined;
        const wagon = activeTrainRig?.cars.filter(
          (car) => car.kind === "cargo-wagon",
        )[index];
        if (wagon) {
          for (const hatch of wagon.serviceHatches) {
            const side = Number(hatch.userData.side ?? 1);
            const homeX = Number(hatch.userData.homeX ?? 0);
            const homeZ = Number(hatch.userData.homeZ ?? 0);
            hatch.position.set(
              homeX,
              0.91 + motion.hatch * 0.095,
              side * (homeZ + motion.hatch * 0.36),
            );
            hatch.rotation.x = side * motion.hatch * 0.86;
            hatch.userData.openRatio = motion.hatch;
            hatch.userData.serviceStage = motion.stage;
          }
          if (wagon.servicePort) {
            wagon.servicePort.material =
              motion.contact > 0.55
                ? this.materials.active
                : this.materials.inactive;
            wagon.servicePort.userData = {
              contact: motion.contact > 0.55,
              serviceStage: motion.stage,
              contactRatio: motion.contact,
              serviceMode: rig.serviceMode,
            };
          }
        }
        chute.root.userData = {
          serviceMode: rig.serviceMode === "service" ? "timed-service" : "load",
          heroLoader: index === rig.heroWagonIndex,
          transferPhase: offsetPhase,
          serviceStage: motion.stage,
          extensionRatio: motion.extension,
          hatchOpenRatio: motion.hatch,
          contactRatio: motion.contact,
          payloadVisible: flowing || servicing,
          payloadKind: flowing
            ? "authoritative-cargo-stream"
            : servicing
              ? "non-cargo-keyed-service-cartridge"
              : "none",
          visiblePayloadPieces: flowing ? 36 : servicing ? 1 : 0,
          source:
            rig.serviceMode === "service"
              ? "diagnostic-cartridge-magazine"
              : "metered-infeed-conveyor",
          destination:
            rig.serviceMode === "service"
              ? `keyed-wagon-service-port-${index + 1}`
              : `open-wagon-bay-${index + 1}`,
          contactHeight: nozzleY - 0.22,
          retractedOutsideGauge:
            motion.stage === "retracted" ||
            (motion.stage === "return" && motion.extension < 0.08),
        };
      }
      for (let index = 0; index < rig.loaders.length; index += 1) {
        const loader = rig.loaders[index]!;
        const offsetPhase = (((transferPhase - index * 0.1) % 1) + 1) % 1;
        const wagonContact = new THREE.Vector3(0, 1.22, 1.45);
        const receivingHopper = new THREE.Vector3(0, 0.9, -0.55);
        const home = new THREE.Vector3(0, 1.08, 0.1);
        let target = home.clone();
        let carrying = false;
        if (
          !rig.serviceActive ||
          rig.serviceMode !== "unload" ||
          index !== rig.heroWagonIndex
        ) {
          target.copy(home);
        } else if (offsetPhase < 0.16) {
          target.copy(wagonContact);
          carrying = offsetPhase > 0.06;
        } else if (offsetPhase < 0.58) {
          const progress = smoothUnit((offsetPhase - 0.16) / 0.42);
          target.copy(wagonContact).lerp(receivingHopper, progress);
          target.y += Math.sin(progress * Math.PI) * 0.32;
          carrying = true;
        } else if (offsetPhase < 0.7) {
          target.copy(receivingHopper);
          carrying = offsetPhase < 0.64;
        } else {
          const progress = smoothUnit((offsetPhase - 0.7) / 0.3);
          target.copy(receivingHopper).lerp(home, progress);
        }
        const shoulder = new THREE.Vector3(0, 1.04, -0.02);
        const midpoint = shoulder.clone().lerp(target, 0.48);
        midpoint.x += (index === 0 ? -1 : 1) * 0.24;
        midpoint.y += 0.26;
        poseArticulatedMember(loader.upperArm, shoulder, midpoint);
        poseArticulatedMember(loader.forearm, midpoint, target);
        loader.claw.position.copy(target);
        loader.claw.rotation.y = Math.sin(offsetPhase * Math.PI * 2) * 0.08;
        loader.payload.position
          .copy(target)
          .add(new THREE.Vector3(0, -0.09, 0));
        loader.payload.visible = carrying;
        loader.root.userData = {
          serviceMode: "unload",
          heroLoader: index === rig.heroWagonIndex,
          transferPhase: offsetPhase,
          payloadVisible: carrying,
          source: `open-wagon-bay-${index + 1}`,
          destination: "protected-receiving-hopper-and-outfeed",
          contactHeight: wagonContact.y,
          retractedOutsideGauge:
            (!rig.serviceActive ||
              rig.serviceMode !== "unload" ||
              index !== rig.heroWagonIndex) &&
            home.z <= 0.1,
        };
      }
      rig.root.userData.transferPhase = transferPhase;
      rig.root.userData.carriedPayloads =
        rig.loadChutes.filter((chute) => chute.payload.visible).length +
        rig.loadChutes.filter((chute) => chute.serviceCartridge.visible)
          .length +
        rig.loaders.filter((loader) => loader.payload.visible).length;
      rig.root.userData.visualTransferPath =
        rig.serviceMode === "load"
          ? "source-bin>metered-conveyor>cantilever>telescoping-nozzle>open-wagon"
          : rig.serviceMode === "unload"
            ? "open-wagon>overhead-grab>receiving-hopper>outfeed-conveyor"
            : "service-cartridge>keyed-wagon-port>diagnostic-return";
      rig.root.userData.protectedRetractionOutsideGauge = !rig.serviceActive;
    }
  }

  public resolvePick(
    object: THREE.Object3D,
    instanceId?: number,
  ): RailPickTarget | null {
    let current: THREE.Object3D | null = object;
    while (current && current !== this.root.parent) {
      const direct = current.userData.pickTarget as RailPickTarget | undefined;
      if (direct) return { ...direct };
      if (instanceId !== undefined && current instanceof THREE.InstancedMesh) {
        const targets = current.userData.pickTargets as
          readonly RailPickTarget[] | undefined;
        const target = targets?.[instanceId];
        if (target) return { ...target };
      }
      if (current === this.root) break;
      current = current.parent;
    }
    return null;
  }

  public setAuthoringOverlay(
    overlay: RailAuthoringOverlay | null,
  ): void {
    this.assertLive();
    if (overlay === null) {
      this.authoringOverlay = null;
    } else {
      const preview = overlay.preview;
      if (
        preview &&
        (
          !Number.isFinite(preview.x) ||
          !Number.isFinite(preview.z) ||
          !Number.isInteger(preview.rotation) ||
          preview.rotation < 0 ||
          preview.rotation > 3
        )
      ) {
        throw new TypeError("Rail authoring preview pose is invalid.");
      }
      this.authoringOverlay = Object.freeze({
        selected:
          overlay.selected === null
            ? null
            : Object.freeze({ ...overlay.selected }),
        sourceSegmentId: overlay.sourceSegmentId,
        preview:
          preview === null
            ? null
            : Object.freeze({ ...preview }),
      });
    }
    this.syncAuthoringOverlay();
  }

  public getDebug(): RailRenderDebug {
    return this.debug;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.clearRigs();
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
    for (const geometry of this.authoringOwnedGeometries) {
      geometry.dispose();
      this.disposedGeometries += 1;
    }
    for (const material of this.authoringOwnedMaterials) {
      material.dispose();
      this.disposedMaterials += 1;
    }
    this.ballastTexture.dispose();
    this.surfaceTexture.dispose();
    this.smokeTexture.dispose();
    this.disposedTextures += 3;
    this.disposed = true;
    this.debug = Object.freeze({
      ...this.debug,
      disposed: true,
      drawBatches: 0,
      resources: this.resourceSnapshot(),
    });
  }

  private setupAuthoringOverlay(): void {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const ring = new THREE.RingGeometry(0.43, 0.57, 32);
    const curve = new THREE.TorusGeometry(
      0.34,
      0.075,
      8,
      24,
      Math.PI / 2,
    );
    const cylinder = new THREE.CylinderGeometry(0.08, 0.08, 1, 10);
    const cone = new THREE.ConeGeometry(0.17, 0.34, 8);
    const sphere = new THREE.SphereGeometry(0.16, 10, 8);
    this.authoringOwnedGeometries.push(
      box,
      ring,
      curve,
      cylinder,
      cone,
      sphere,
    );

    const selectedMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd65a,
      transparent: true,
      opacity: 0.94,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    const sourceMaterial = new THREE.MeshBasicMaterial({
      color: 0x63d9ff,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
    });
    const validMaterial = new THREE.MeshBasicMaterial({
      color: 0x70f29a,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
    });
    const blockedMaterial = new THREE.MeshBasicMaterial({
      color: 0xff5d52,
      transparent: true,
      opacity: 0.86,
      depthTest: false,
      depthWrite: false,
    });
    this.authoringOwnedMaterials.push(
      selectedMaterial,
      sourceMaterial,
      validMaterial,
      blockedMaterial,
    );

    this.authoringSelectedMarker = new THREE.Mesh(
      ring,
      selectedMaterial,
    );
    this.authoringSelectedMarker.name =
      "rail-authoring-selected-target-ring";
    this.authoringSelectedMarker.rotation.x = -Math.PI / 2;
    this.authoringSelectedMarker.position.y = 0.12;
    this.authoringSelectedMarker.renderOrder = 120;

    this.authoringSourceMarker = new THREE.Mesh(box, sourceMaterial);
    this.authoringSourceMarker.name =
      "rail-authoring-directed-source-diamond";
    this.authoringSourceMarker.scale.set(0.56, 0.055, 0.56);
    this.authoringSourceMarker.rotation.y = Math.PI / 4;
    this.authoringSourceMarker.position.y = 0.18;
    this.authoringSourceMarker.renderOrder = 121;

    this.authoringValidMarker = new THREE.Group();
    this.authoringValidMarker.name =
      "rail-authoring-valid-ring-check";
    this.authoringValidMarker.position.y = 0.96;
    const validRing = new THREE.Mesh(ring, validMaterial);
    validRing.name = "rail-authoring-valid-ring";
    validRing.rotation.x = -Math.PI / 2;
    validRing.renderOrder = 123;
    const validCheckShort = new THREE.Mesh(box, validMaterial);
    validCheckShort.name = "rail-authoring-valid-check-short";
    validCheckShort.scale.set(0.34, 0.07, 0.11);
    validCheckShort.position.set(-0.2, 0.04, 0.12);
    validCheckShort.rotation.y = -0.64;
    validCheckShort.renderOrder = 123;
    const validCheckLong = new THREE.Mesh(box, validMaterial);
    validCheckLong.name = "rail-authoring-valid-check-long";
    validCheckLong.scale.set(0.62, 0.07, 0.11);
    validCheckLong.position.set(0.14, 0.04, -0.04);
    validCheckLong.rotation.y = 0.8;
    validCheckLong.renderOrder = 123;
    this.authoringValidMarker.add(
      validRing,
      validCheckShort,
      validCheckLong,
    );
    this.authoringValidMarker.visible = false;

    const shape = (
      kind: RailBuildKind,
      name: string,
      children: readonly THREE.Object3D[],
    ): void => {
      const group = new THREE.Group();
      group.name = `rail-authoring-preview-${name}`;
      for (const child of children) {
        child.renderOrder = 122;
        group.add(child);
      }
      group.visible = false;
      this.authoringPreviewShapes.set(kind, group);
      this.authoringPreviewRoot.add(group);
    };
    const boxMesh = (
      scaleX: number,
      scaleY: number,
      scaleZ: number,
      x = 0,
      y = 0.17,
      z = 0,
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(box, validMaterial);
      mesh.scale.set(scaleX, scaleY, scaleZ);
      mesh.position.set(x, y, z);
      return mesh;
    };

    shape("straight", "straight-track", [
      boxMesh(0.88, 0.08, 0.18),
      boxMesh(0.88, 0.035, 0.035, 0, 0.25, -0.1),
      boxMesh(0.88, 0.035, 0.035, 0, 0.25, 0.1),
    ]);
    const curveMesh = new THREE.Mesh(curve, validMaterial);
    curveMesh.rotation.x = Math.PI / 2;
    curveMesh.position.set(-0.34, 0.2, -0.34);
    shape("curve", "curve-track", [curveMesh]);
    shape("junction", "junction-track", [
      boxMesh(0.88, 0.08, 0.16),
      boxMesh(0.16, 0.08, 0.62, -0.28, 0.17, -0.22),
      boxMesh(0.16, 0.08, 0.62, 0.28, 0.17, -0.22),
    ]);

    const regularPost = new THREE.Mesh(cylinder, validMaterial);
    regularPost.scale.set(1, 0.62, 1);
    regularPost.position.y = 0.44;
    const regularHead = new THREE.Mesh(cone, validMaterial);
    regularHead.position.y = 0.86;
    shape("regularSignal", "regular-signal", [
      regularPost,
      regularHead,
    ]);
    const chainPost = new THREE.Mesh(cylinder, validMaterial);
    chainPost.scale.set(1, 0.62, 1);
    chainPost.position.y = 0.44;
    const chainHead = new THREE.Mesh(sphere, validMaterial);
    chainHead.scale.set(1.15, 0.72, 1);
    chainHead.position.y = 0.82;
    shape("chainSignal", "chain-signal", [chainPost, chainHead]);

    shape("station", "station", [
      boxMesh(0.92, 0.12, 0.46),
      boxMesh(0.12, 0.42, 0.12, -0.34, 0.4, 0),
      boxMesh(0.12, 0.42, 0.12, 0.34, 0.4, 0),
      boxMesh(0.78, 0.08, 0.18, 0, 0.66, 0),
    ]);
    const locomotiveChimney = new THREE.Mesh(cylinder, validMaterial);
    locomotiveChimney.scale.set(0.72, 0.3, 0.72);
    locomotiveChimney.position.set(0.2, 0.62, 0);
    shape("locomotive", "locomotive", [
      boxMesh(0.76, 0.3, 0.42, 0, 0.34, 0),
      boxMesh(0.28, 0.24, 0.38, -0.23, 0.62, 0),
      locomotiveChimney,
    ]);
    shape("cargoWagon", "cargo-wagon", [
      boxMesh(0.8, 0.13, 0.46, 0, 0.22, 0),
      boxMesh(0.08, 0.28, 0.08, -0.34, 0.43, -0.18),
      boxMesh(0.08, 0.28, 0.08, 0.34, 0.43, -0.18),
      boxMesh(0.08, 0.28, 0.08, -0.34, 0.43, 0.18),
      boxMesh(0.08, 0.28, 0.08, 0.34, 0.43, 0.18),
    ]);

    this.authoringBlockedMarker = new THREE.Group();
    this.authoringBlockedMarker.name = "rail-authoring-blocked-cross";
    const blockedA = new THREE.Mesh(box, blockedMaterial);
    blockedA.scale.set(0.78, 0.07, 0.11);
    blockedA.rotation.y = Math.PI / 4;
    const blockedB = new THREE.Mesh(box, blockedMaterial);
    blockedB.scale.set(0.78, 0.07, 0.11);
    blockedB.rotation.y = -Math.PI / 4;
    this.authoringBlockedMarker.position.y = 0.82;
    this.authoringBlockedMarker.add(blockedA, blockedB);
    this.authoringPreviewRoot.add(this.authoringBlockedMarker);
    this.authoringRoot.add(
      this.authoringSelectedMarker,
      this.authoringSourceMarker,
      this.authoringPreviewRoot,
      this.authoringValidMarker,
    );
    this.authoringRoot.visible = false;
  }

  private syncAuthoringOverlay(): void {
    const overlay = this.authoringOverlay;
    const rail = this.lastRailSnapshot;
    this.authoringSelectedMarker.visible = false;
    this.authoringSourceMarker.visible = false;
    this.authoringPreviewRoot.visible = false;
    this.authoringValidMarker.visible = false;
    this.authoringBlockedMarker.visible = false;
    for (const shape of this.authoringPreviewShapes.values()) {
      shape.visible = false;
    }
    if (!overlay || !rail) {
      this.authoringRoot.visible = false;
      this.authoringRoot.userData = {
        active: false,
        selectedCue: "ring",
        sourceCue: "diamond",
        blockedCue: "shape-plus-cross",
      };
      return;
    }

    const nodeById = new Map(
      rail.graph.nodes.map((node) => [node.segmentId, node]),
    );
    const positionForTarget = (
      target: RailPickTarget,
    ): { x: number; z: number } | null => {
      if (target.kind === "segment") {
        const node = nodeById.get(target.segmentId);
        return node ? { x: node.x, z: node.y } : null;
      }
      if (target.kind === "signal") {
        const signal = rail.signals.find(
          (candidate) => candidate.id === target.signalId,
        );
        const from = signal
          ? nodeById.get(signal.fromSegmentId)
          : undefined;
        const to = signal
          ? nodeById.get(signal.toSegmentId)
          : undefined;
        return from && to
          ? { x: (from.x + to.x) / 2, z: (from.y + to.y) / 2 }
          : null;
      }
      if (target.kind === "station") {
        const station = rail.stations.find(
          (candidate) => candidate.id === target.stationId,
        );
        const node = station
          ? nodeById.get(station.segmentId)
          : undefined;
        return node ? { x: node.x, z: node.y } : null;
      }
      const train = rail.trains.find(
        (candidate) => candidate.id === target.trainId,
      );
      const node = train
        ? nodeById.get(train.currentSegmentId)
        : undefined;
      return node ? { x: node.x, z: node.y } : null;
    };

    const selectedPosition = overlay.selected
      ? positionForTarget(overlay.selected)
      : null;
    if (selectedPosition) {
      this.authoringSelectedMarker.position.x = selectedPosition.x;
      this.authoringSelectedMarker.position.z = selectedPosition.z;
      this.authoringSelectedMarker.visible = true;
    }
    const sourceNode = overlay.sourceSegmentId
      ? nodeById.get(overlay.sourceSegmentId)
      : undefined;
    if (sourceNode) {
      this.authoringSourceMarker.position.x = sourceNode.x;
      this.authoringSourceMarker.position.z = sourceNode.y;
      this.authoringSourceMarker.visible = true;
    }
    const preview = overlay.preview;
    if (preview) {
      const previewShape = this.authoringPreviewShapes.get(
        preview.buildKind,
      );
      if (previewShape) {
        const material =
          this.authoringOwnedMaterials[
            preview.validity === "valid" ? 2 : 3
          ]!;
        previewShape.traverse((object) => {
          if (object instanceof THREE.Mesh) object.material = material;
        });
        previewShape.visible = true;
      }
      this.authoringPreviewRoot.position.set(preview.x, 0, preview.z);
      this.authoringPreviewRoot.rotation.y =
        -preview.rotation * Math.PI / 2;
      this.authoringPreviewRoot.visible = true;
      this.authoringValidMarker.position.x = preview.x;
      this.authoringValidMarker.position.z = preview.z;
      this.authoringValidMarker.visible =
        preview.validity === "valid";
      this.authoringBlockedMarker.visible =
        preview.validity === "blocked";
    }
    this.authoringRoot.visible =
      this.authoringSelectedMarker.visible ||
      this.authoringSourceMarker.visible ||
      this.authoringPreviewRoot.visible;
    this.authoringRoot.userData = {
      active: this.authoringRoot.visible,
      selected: overlay.selected,
      sourceSegmentId: overlay.sourceSegmentId,
      preview,
      selectedCue: "amber-ring",
      sourceCue: "cyan-diamond",
      validCue: "green-tool-shape-plus-raised-ring-check",
      blockedCue: "red-tool-shape-plus-cross",
    };
  }

  private syncTrack(nodes: readonly RailGraphNode[]): void {
    const integratedJunctionIds = new Set([
      "campaign-main-13",
      "campaign-main-24",
    ]);
    const campaignMainNodes = nodes
      .filter((node) => /^campaign-main-\d{2}$/.test(node.segmentId))
      .sort((left, right) => left.x - right.x);
    const hasIntegratedMainBed =
      campaignMainNodes.length === 25 &&
      campaignMainNodes.every(
        (node, index) =>
          node.x === 8 + index &&
          node.y === 16 &&
          node.rotation === (index + 8 === 13 || index + 8 === 24 ? 2 : 1),
      );
    const integratedHiddenIds = new Set([
      "campaign-siding-west-curve",
      "campaign-siding-east-curve",
      "campaign-siding-14",
      "campaign-siding-15",
      "campaign-siding-16",
      "campaign-siding-17",
      "campaign-siding-18",
      "campaign-siding-19",
      "campaign-siding-20",
      "campaign-siding-21",
      "campaign-siding-22",
      "campaign-siding-23",
    ]);
    const integratedJunctions = nodes.filter((node) =>
      integratedJunctionIds.has(node.segmentId),
    );
    const byKind = {
      straight: nodes.filter(
        (node) =>
          !integratedHiddenIds.has(node.segmentId) &&
          (node.kind === "straight" ||
            integratedJunctionIds.has(node.segmentId)),
      ),
      curve: nodes.filter(
        (node) =>
          node.kind === "curve" && !integratedHiddenIds.has(node.segmentId),
      ),
      junction: nodes.filter(
        (node) =>
          node.kind === "junction" &&
          !integratedJunctionIds.has(node.segmentId),
      ),
    };
    const components = [
      {
        suffix: "ballast",
        material: this.materials.ballast,
        geometry: (kind: RailGraphNode["kind"]) =>
          kind === "straight"
            ? this.geometries.straightBallast
            : kind === "curve"
              ? this.geometries.curveBallast
              : this.geometries.junctionBallast,
      },
      {
        suffix: "ballast-detail",
        material: this.materials.ballastDark,
        geometry: (kind: RailGraphNode["kind"]) =>
          kind === "straight"
            ? this.geometries.straightBallastDetail
            : kind === "curve"
              ? this.geometries.curveBallastDetail
              : this.geometries.junctionBallastDetail,
      },
      {
        suffix: "sleepers",
        material: this.materials.sleeper,
        geometry: (kind: RailGraphNode["kind"]) =>
          kind === "straight"
            ? this.geometries.straightSleepers
            : kind === "curve"
              ? this.geometries.curveSleepers
              : this.geometries.junctionSleepers,
      },
      {
        suffix: "sleeper-variation",
        material: this.materials.sleeperAlt,
        geometry: (kind: RailGraphNode["kind"]) =>
          kind === "straight"
            ? this.geometries.straightSleeperAccents
            : kind === "curve"
              ? this.geometries.curveSleeperAccents
              : this.geometries.junctionSleeperAccents,
      },
      {
        suffix: "rails",
        material: this.materials.rail,
        geometry: (kind: RailGraphNode["kind"]) =>
          kind === "straight"
            ? this.geometries.straightRails
            : kind === "curve"
              ? this.geometries.curveRails
              : this.geometries.junctionRails,
      },
      {
        suffix: "running-surfaces",
        material: this.materials.railTop,
        geometry: (kind: RailGraphNode["kind"]) =>
          kind === "straight"
            ? this.geometries.straightRailTops
            : kind === "curve"
              ? this.geometries.curveRailTops
              : this.geometries.junctionRailTops,
      },
      {
        suffix: "fasteners",
        material: this.materials.fastener,
        geometry: (kind: RailGraphNode["kind"]) =>
          kind === "straight"
            ? this.geometries.straightFasteners
            : kind === "curve"
              ? this.geometries.curveFasteners
              : this.geometries.junctionFasteners,
      },
    ] as const;
    for (const kind of ["straight", "curve", "junction"] as const) {
      const entries = byKind[kind].map((node) => ({
        value: node,
        matrix: nodeMatrix(node),
      }));
      for (const component of components) {
        const componentEntries =
          hasIntegratedMainBed &&
          kind === "straight" &&
          (component.suffix === "ballast" ||
            component.suffix === "ballast-detail")
            ? entries.filter(
                ({ value }) => !value.segmentId.startsWith("campaign-main-"),
              )
            : entries;
        let material: THREE.Material = component.material;
        if (kind === "junction") {
          if (component.suffix === "ballast") {
            material = this.materials.junctionBallast;
          } else if (component.suffix === "sleepers") {
            material = this.materials.junctionSleeper;
          } else if (component.suffix === "sleeper-variation") {
            material = this.materials.junctionSleeperAlt;
          } else if (component.suffix === "running-surfaces") {
            material = this.materials.junctionRailTop;
          }
        }
        this.syncBatch(
          `track-${kind}-${component.suffix}`,
          componentEntries,
          component.geometry(kind),
          material,
          this.trackRoot,
          (node) => ({
            kind: "segment",
            segmentId: node.segmentId,
            blockId: node.blockId,
          }),
        );
      }
    }
    const mainStartNode = hasIntegratedMainBed
      ? campaignMainNodes[0]
      : undefined;
    const mainBedEntries = mainStartNode
      ? [
          {
            value: mainStartNode,
            matrix: new THREE.Matrix4().makeTranslation(
              mainStartNode.x,
              0,
              mainStartNode.y + 0.5,
            ),
          },
        ]
      : [];
    const mainBedPick = (node: RailGraphNode): RailPickTarget => ({
      kind: "segment",
      segmentId: node.segmentId,
      blockId: node.blockId,
    });
    this.syncBatch(
      "track-integrated-main-ballast",
      mainBedEntries,
      this.geometries.integratedMainBed.ballast,
      this.materials.ballast,
      this.trackRoot,
      mainBedPick,
    );
    this.syncBatch(
      "track-integrated-main-ballast-detail",
      mainBedEntries,
      this.geometries.integratedMainBed.ballastDetail,
      this.materials.ballastDark,
      this.trackRoot,
      mainBedPick,
    );
    const junctionEntries = byKind.junction.map((node) => ({
      value: node,
      matrix: nodeMatrix(node),
    }));
    this.syncBatch(
      "track-junction-switch-hardware",
      junctionEntries,
      this.geometries.junctionHardware,
      this.materials.switchMetal,
      this.trackRoot,
      (node) => ({
        kind: "segment",
        segmentId: node.segmentId,
        blockId: node.blockId,
      }),
    );
    this.syncBatch(
      "track-junction-blades-and-guards",
      junctionEntries,
      this.geometries.junctionRunningHardware,
      this.materials.junctionRailTop,
      this.trackRoot,
      (node) => ({
        kind: "segment",
        segmentId: node.segmentId,
        blockId: node.blockId,
      }),
    );
    this.syncBatch(
      "track-junction-point-motor",
      junctionEntries,
      this.geometries.junctionMotor,
      this.materials.stationPaint,
      this.trackRoot,
      (node) => ({
        kind: "segment",
        segmentId: node.segmentId,
        blockId: node.blockId,
      }),
    );
    const syncIntegratedTurnout = (
      side: "west" | "east",
      geometry: IntegratedTurnoutGeometries,
      node: RailGraphNode | undefined,
    ) => {
      const entries = node
        ? [
            {
              value: node,
              matrix: new THREE.Matrix4().makeTranslation(
                node.x + 0.5,
                0,
                node.y + 0.5,
              ),
            },
          ]
        : [];
      const pick = (entry: RailGraphNode): RailPickTarget => ({
        kind: "segment",
        segmentId: entry.segmentId,
        blockId: entry.blockId,
      });
      for (const component of [
        {
          suffix: "ballast",
          geometry: geometry.ballast,
          material: this.materials.ballast,
        },
        {
          suffix: "ballast-detail",
          geometry: geometry.ballastDetail,
          material: this.materials.ballastDark,
        },
        {
          suffix: "sleepers",
          geometry: geometry.sleepers,
          material: this.materials.junctionSleeper,
        },
        {
          suffix: "sleeper-variation",
          geometry: geometry.sleeperAccents,
          material: this.materials.junctionSleeperAlt,
        },
        {
          suffix: "rails",
          geometry: geometry.rails,
          material: this.materials.rail,
        },
        {
          suffix: "running-surfaces",
          geometry: geometry.railTops,
          material: this.materials.junctionRailTop,
        },
        {
          suffix: "fasteners",
          geometry: geometry.fasteners,
          material: this.materials.fastener,
        },
        {
          suffix: "blades-frog-check-rails",
          geometry: geometry.runningHardware,
          material: this.materials.switchMetal,
        },
        {
          suffix: "mechanical-linkage-and-slide-plates",
          geometry: geometry.linkage,
          material: this.materials.turnoutLinkage,
        },
        {
          suffix: "drained-service-apron",
          geometry: geometry.serviceApron,
          material: this.materials.turnoutServiceConcrete,
        },
        {
          suffix: "segmented-cable-trough",
          geometry: geometry.cableTrough,
          material: this.materials.turnoutCableTrough,
        },
        {
          suffix: "cable-trough-lid-fasteners",
          geometry: geometry.cableTroughHardware,
          material: this.materials.junctionRailTop,
        },
        {
          suffix: "cable-trough-oxide-grime",
          geometry: geometry.cableTroughGrime,
          material: this.materials.wagonRust,
        },
        {
          suffix: "weatherproof-service-cabinet",
          geometry: geometry.serviceCabinet,
          material: this.materials.turnoutServiceHousing,
        },
        {
          suffix: "switch-lantern-and-post",
          geometry: geometry.switchLantern,
          material: this.materials.turnoutServiceHousing,
        },
        {
          suffix: "service-safety-markers",
          geometry: geometry.serviceSafety,
          material: this.materials.warning,
        },
        {
          suffix: "point-motor",
          geometry: geometry.motor,
          material: this.materials.stationPaint,
        },
      ] as const) {
        this.syncBatch(
          `track-integrated-${side}-turnout-${component.suffix}`,
          entries,
          component.geometry,
          component.material,
          this.trackRoot,
          pick,
        );
        const batch = this.batches.get(
          `track-integrated-${side}-turnout-${component.suffix}`,
        );
        if (batch) {
          batch.mesh.userData.engineeredGeometry = {
            leadIn: Math.abs(CAMPAIGN_TURNOUT_START_X),
            tangentRun: CAMPAIGN_TURNOUT_END_X - CAMPAIGN_TURNOUT_START_X,
            sidingSeparation: CAMPAIGN_SIDING_SEPARATION,
            minimumEquivalentRadius: campaignTurnoutMinimumEquivalentRadius(),
            entranceTangent: 0,
            exitTangent: 0,
            form: "single-eased-shallow-turnout",
          };
        }
      }
    };
    syncIntegratedTurnout(
      "west",
      this.geometries.integratedTurnoutWest,
      integratedJunctions.find((node) => node.segmentId === "campaign-main-13"),
    );
    syncIntegratedTurnout(
      "east",
      this.geometries.integratedTurnoutEast,
      integratedJunctions.find((node) => node.segmentId === "campaign-main-24"),
    );
    const bypassNode = nodes.find(
      (node) => node.segmentId === "campaign-siding-16",
    );
    const bypassEntries = bypassNode
      ? [
          {
            value: bypassNode,
            matrix: new THREE.Matrix4().makeTranslation(
              CAMPAIGN_SIDING_START_X,
              0,
              16.5 + CAMPAIGN_SIDING_SEPARATION,
            ),
          },
        ]
      : [];
    const bypassPick = (node: RailGraphNode): RailPickTarget => ({
      kind: "segment",
      segmentId: node.segmentId,
      blockId: node.blockId,
    });
    for (const component of [
      {
        suffix: "ballast",
        geometry: this.geometries.integratedBypass.ballast,
        material: this.materials.ballast,
      },
      {
        suffix: "ballast-detail",
        geometry: this.geometries.integratedBypass.ballastDetail,
        material: this.materials.ballastDark,
      },
      {
        suffix: "sleepers",
        geometry: this.geometries.integratedBypass.sleepers,
        material: this.materials.sleeper,
      },
      {
        suffix: "sleeper-variation",
        geometry: this.geometries.integratedBypass.sleeperAccents,
        material: this.materials.sleeperAlt,
      },
      {
        suffix: "rails",
        geometry: this.geometries.integratedBypass.rails,
        material: this.materials.rail,
      },
      {
        suffix: "running-surfaces",
        geometry: this.geometries.integratedBypass.railTops,
        material: this.materials.railTop,
      },
      {
        suffix: "fasteners",
        geometry: this.geometries.integratedBypass.fasteners,
        material: this.materials.fastener,
      },
    ] as const) {
      this.syncBatch(
        `track-integrated-bypass-${component.suffix}`,
        bypassEntries,
        component.geometry,
        component.material,
        this.trackRoot,
        bypassPick,
      );
      const batch = this.batches.get(
        `track-integrated-bypass-${component.suffix}`,
      );
      if (batch) {
        batch.mesh.userData.engineeredGeometry = {
          usefulTangentLength: CAMPAIGN_SIDING_LENGTH,
          sidingSeparation: CAMPAIGN_SIDING_SEPARATION,
          form: "tangent-siding-between-eased-turnouts",
        };
      }
    }
  }

  private syncOverlays(
    rail: RailNetworkSnapshot,
    nodes: readonly RailGraphNode[],
    renderedNodeIds: ReadonlySet<string>,
  ): { routeSegments: number; omittedRouteSegments: number } {
    const reservationByBlock = new Map(
      rail.reservations.map((reservation) => [
        reservation.blockId,
        reservation,
      ]),
    );
    const occupied = nodes
      .filter(
        (node) => reservationByBlock.get(node.blockId)?.kind === "occupied",
      )
      .map((node) => ({ value: node, matrix: nodeMatrix(node) }));
    const reserved = nodes
      .filter(
        (node) => reservationByBlock.get(node.blockId)?.kind === "reserved",
      )
      .map((node) => ({ value: node, matrix: nodeMatrix(node) }));
    this.syncBatch(
      "overlay-block-occupied",
      occupied,
      this.geometries.overlayTile,
      this.materials.blockOccupied,
      this.overlayRoot,
      (node) => ({
        kind: "segment",
        segmentId: node.segmentId,
        blockId: node.blockId,
      }),
    );
    this.syncBatch(
      "overlay-block-reserved",
      reserved,
      this.geometries.overlayTile,
      this.materials.blockReserved,
      this.overlayRoot,
      (node) => ({
        kind: "segment",
        segmentId: node.segmentId,
        blockId: node.blockId,
      }),
    );
    const routeIds = [
      ...new Set(
        rail.trains
          .flatMap((train) => train.path)
          .filter((segmentId) => renderedNodeIds.has(segmentId)),
      ),
    ].sort(compareText);
    const renderedRouteIds = routeIds.slice(0, this.options.maxRouteSegments);
    const routeEntries = renderedRouteIds
      .map((segmentId) => nodes.find((node) => node.segmentId === segmentId))
      .filter((node): node is RailGraphNode => node !== undefined)
      .map((node) => ({
        value: node,
        matrix: nodeMatrix(node),
      }));
    this.syncBatch(
      "overlay-authoritative-route",
      routeEntries,
      this.geometries.routeTile,
      this.materials.route,
      this.overlayRoot,
      (node) => ({
        kind: "segment",
        segmentId: node.segmentId,
        blockId: node.blockId,
      }),
    );
    return {
      routeSegments: renderedRouteIds.length,
      omittedRouteSegments: routeIds.length - renderedRouteIds.length,
    };
  }

  private signalMatrix(
    signal: RailSignalSnapshot,
    nodes: ReadonlyMap<string, RailGraphNode>,
  ): THREE.Matrix4 | null {
    const from = nodes.get(signal.fromSegmentId);
    const to = nodes.get(signal.toSegmentId);
    if (!from || !to) return null;
    const dx = to.x - from.x;
    const dz = to.y - from.y;
    const length = Math.sqrt(dx * dx + dz * dz);
    if (length <= 0) return null;
    const nx = dx / length;
    const nz = dz / length;
    const rightX = -nz;
    const rightZ = nx;
    return new THREE.Matrix4().compose(
      new THREE.Vector3(
        from.x + 0.5 + nx * 0.38 + rightX * 0.38,
        0,
        from.y + 0.5 + nz * 0.38 + rightZ * 0.38,
      ),
      new THREE.Quaternion().setFromAxisAngle(
        Y_AXIS,
        -Math.atan2(nz, nx) - Math.PI / 2,
      ),
      new THREE.Vector3(1.18, 1.18, 1.18),
    );
  }

  private syncSignals(
    signals: readonly RailSignalSnapshot[],
    nodes: ReadonlyMap<string, RailGraphNode>,
  ): void {
    const entries = signals
      .map((signal) => {
        const matrix = this.signalMatrix(signal, nodes);
        return matrix ? { value: signal, matrix } : null;
      })
      .filter(
        (entry): entry is BatchEntry<RailSignalSnapshot> => entry !== null,
      );
    const pick = (signal: RailSignalSnapshot): RailPickTarget => ({
      kind: "signal",
      signalId: signal.id,
    });
    this.syncBatch(
      "signal-post-and-cabinet",
      entries,
      this.geometries.signalPost,
      this.materials.signalPost,
      this.signalRoot,
      pick,
    );
    this.syncBatch(
      "signal-regular-head",
      entries.filter((entry) => entry.value.type === "regular"),
      this.geometries.regularSignalHead,
      this.materials.signalHousing,
      this.signalRoot,
      pick,
    );
    this.syncBatch(
      "signal-chain-head",
      entries.filter((entry) => entry.value.type === "chain"),
      this.geometries.chainSignalHead,
      this.materials.signalBlack,
      this.signalRoot,
      pick,
    );
    for (const aspect of ["red", "green", "chain-clear"] as const) {
      const aspectEntries = entries.filter(
        (entry) => entry.value.aspect === aspect,
      );
      const regular = aspectEntries.filter(
        (entry) => entry.value.type === "regular",
      );
      const chain = aspectEntries.filter(
        (entry) => entry.value.type === "chain",
      );
      const material =
        aspect === "red"
          ? this.materials.lampRed
          : aspect === "green"
            ? this.materials.lampGreen
            : this.materials.lampChain;
      this.syncBatch(
        `signal-regular-lens-${aspect}`,
        regular,
        this.geometries.regularLens,
        material,
        this.signalRoot,
        pick,
      );
      this.syncBatch(
        `signal-chain-lens-${aspect}`,
        chain,
        this.geometries.chainLens,
        material,
        this.signalRoot,
        pick,
      );
    }
  }

  private syncStations(
    stations: readonly RailStationSnapshot[],
    trains: readonly RailTrainSnapshot[],
    nodes: ReadonlyMap<string, RailGraphNode>,
  ): { detailed: number; overview: number; active: number } {
    const detailed = stations.slice(0, this.options.maxDetailedStations);
    const detailedIds = new Set(detailed.map((station) => station.id));
    for (const [id, rig] of this.stationRigs) {
      if (detailedIds.has(id)) continue;
      rig.root.removeFromParent();
      this.stationRigs.delete(id);
    }
    let active = 0;
    for (const station of detailed) {
      const node = nodes.get(station.segmentId);
      if (!node) continue;
      let rig = this.stationRigs.get(station.id);
      if (!rig) {
        rig = this.createStationRig(station.id);
        this.stationRigs.set(station.id, rig);
      }
      rig.root.position.set(node.x + 0.5, 0, node.y + 0.5);
      rig.root.rotation.y = segmentYaw(node);
      const train = trains.find(
        (candidate) =>
          candidate.currentSegmentId === station.segmentId &&
          candidate.status === "dwelling",
      );
      const wait = train?.schedule[train.scheduleIndex]?.wait;
      const authoredWait =
        wait ??
        trains
          .flatMap((candidate) => candidate.schedule)
          .find((stop) => stop.stationId === station.id)?.wait;
      rig.serviceActive = train !== undefined;
      if (train) active += 1;
      rig.servicePhase =
        Number.parseInt(fnv1a([station.id]).slice(0, 6), 16) / 0x1000000;
      rig.statusLamp.material = train
        ? this.materials.active
        : this.materials.inactive;
      rig.serviceMode =
        authoredWait?.type === "cargo-full"
          ? "load"
          : authoredWait?.type === "cargo-empty"
            ? "unload"
            : "service";
      const serviceWagons =
        train?.cars.filter((car) => car.kind === "cargo-wagon") ?? [];
      const requestedHero =
        rig.serviceMode === "load"
          ? serviceWagons.findIndex((car) => car.stored < car.capacity)
          : rig.serviceMode === "unload"
            ? serviceWagons.findIndex((car) => car.stored > 0)
            : 0;
      rig.heroWagonIndex =
        requestedHero >= 0
          ? Math.min(requestedHero, Math.max(0, rig.loadChutes.length - 1))
          : 0;
      rig.modeSigns.load.visible = rig.serviceMode === "load";
      rig.modeSigns.unload.visible = rig.serviceMode === "unload";
      rig.modeSigns.service.visible = rig.serviceMode === "service";
      rig.districtLight.intensity = train ? 1.12 : 0.58;
      rig.scheduleDial.rotation.z =
        (authoredWait ? waitConditionIndex(authoredWait) : 0) * (Math.PI / 2.5);
      const cargoRatio =
        train && train.cargoCapacity > 0
          ? train.cargoUnits / train.cargoCapacity
          : 0;
      rig.cargoIndicator.scale.y = 0.2 + cargoRatio * 0.8;
      rig.root.userData = {
        pickTarget: {
          kind: "station",
          stationId: station.id,
        } satisfies RailPickTarget,
        stationId: station.id,
        displayName: `CINDER YARD // ${station.id.toUpperCase()}`,
        segmentId: station.segmentId,
        activeTrainId: train?.id ?? null,
        waitCondition: wait ? { ...wait } : null,
        serviceMode: rig.serviceMode,
        cargoRatio,
        stationOwnsCargo: false,
        visualTransferPath:
          rig.serviceMode === "load"
            ? "source-bin>metered-conveyor>cantilever>telescoping-nozzle>open-wagon"
            : rig.serviceMode === "unload"
              ? "open-wagon>overhead-grab>receiving-hopper>outfeed-conveyor"
              : "service-cartridge>keyed-wagon-port>diagnostic-return",
        independentlyRootedChains: true,
        districtFeatures:
          "workshop+silos+pipe-rack+fence+maintenance-road+drainage+lamps+props+weeds+live-signage",
        heroWagonIndex: rig.heroWagonIndex,
        concurrentActiveLoaders: train ? 1 : 0,
        protectedRetractionOutsideGauge: !rig.serviceActive,
      };
    }
    const overview = stations.slice(this.options.maxDetailedStations);
    const overviewEntries = overview
      .map((station) => {
        const node = nodes.get(station.segmentId);
        return node
          ? {
              value: station,
              matrix: nodeMatrix(node),
            }
          : null;
      })
      .filter(
        (entry): entry is BatchEntry<RailStationSnapshot> => entry !== null,
      );
    this.syncBatch(
      "overview-stations",
      overviewEntries,
      this.geometries.overviewStation,
      this.materials.stationSteel,
      this.overviewRoot,
      (station) => ({
        kind: "station",
        stationId: station.id,
      }),
    );
    return {
      detailed: detailed.length,
      overview: overview.length,
      active,
    };
  }

  private syncTrains(
    trains: readonly RailTrainSnapshot[],
    nodes: ReadonlyMap<string, RailGraphNode>,
    elapsedSeconds: number,
  ): {
    detailed: number;
    overview: number;
    detailedCars: number;
    overviewCars: number;
    omittedCars: number;
  } {
    const detailed = trains.slice(0, this.options.maxDetailedTrains);
    const detailedIds = new Set(detailed.map((train) => train.id));
    for (const [id, rig] of this.trainRigs) {
      if (detailedIds.has(id)) continue;
      rig.root.removeFromParent();
      this.trainRigs.delete(id);
    }
    for (const train of detailed) {
      const signature = carSignature(train);
      let rig = this.trainRigs.get(train.id);
      if (rig && rig.carSignature !== signature) {
        rig.root.removeFromParent();
        this.trainRigs.delete(train.id);
        rig = undefined;
      }
      if (!rig) {
        rig = this.createTrainRig(train);
        this.trainRigs.set(train.id, rig);
      }
      const inferredCampaignDirection =
        inferredCampaignWestTraversalDirection(train);
      if (inferredCampaignDirection !== null) {
        rig.campaignWestTraversalDirection = inferredCampaignDirection;
      } else if (
        !CAMPAIGN_WEST_TURNOUT_TRAVERSAL.includes(train.currentSegmentId)
      ) {
        rig.campaignWestTraversalDirection = null;
      }
      const pose = trainPose(train, nodes, rig.campaignWestTraversalDirection);
      const latestPoseSample = rig.poseHistory[rig.poseHistory.length - 1];
      let resetPoseHistory = false;
      if (latestPoseSample) {
        const distanceDeltaMilli =
          train.distanceTravelledMilli - rig.baseDistanceMilli;
        const spatialDelta = Math.hypot(
          pose.x - latestPoseSample.x,
          pose.z - latestPoseSample.z,
        );
        const yawDelta = Math.abs(
          Math.atan2(
            Math.sin(pose.yaw - latestPoseSample.yaw),
            Math.cos(pose.yaw - latestPoseSample.yaw),
          ),
        );
        let resetReason: string | null = null;
        if (rig.status === "dwelling" && train.status === "moving") {
          resetReason = "authoritative-departure-reseed";
        } else if (distanceDeltaMilli < 0) {
          resetReason = "distance-rewind";
        } else if (yawDelta > Math.PI * 0.65) {
          resetReason = "authoritative-direction-reversal";
        } else if (
          spatialDelta >
          Math.max(0.8, Math.max(0, distanceDeltaMilli) / 1_000 + 0.55)
        ) {
          resetReason = "authoritative-route-discontinuity";
        }
        if (resetReason) {
          rig.poseHistory.length = 0;
          rig.poseHistoryResetCount += 1;
          rig.lastPoseHistoryResetReason = resetReason;
          resetPoseHistory = true;
        }
      }
      if (latestPoseSample && !resetPoseHistory) {
        rig.renderedDistanceMilli +=
          Math.hypot(pose.x - latestPoseSample.x, pose.z - latestPoseSample.z) *
          1_000;
      }
      const sample: TrainPoseSample = {
        ...pose,
        distanceMilli: rig.renderedDistanceMilli,
      };
      const latest = rig.poseHistory[rig.poseHistory.length - 1];
      if (latest?.distanceMilli === sample.distanceMilli) {
        rig.poseHistory[rig.poseHistory.length - 1] = sample;
      } else {
        rig.poseHistory.push(sample);
      }
      const retainedDistanceMilli =
        rig.renderedDistanceMilli -
        (Math.max(1, rig.cars.length - 1) * CAR_SPACING + 4) * 1_000;
      while (
        rig.poseHistory.length > 2 &&
        rig.poseHistory[1]!.distanceMilli < retainedDistanceMilli
      ) {
        rig.poseHistory.shift();
      }
      if (rig.poseHistory.length > 512) {
        rig.poseHistory.splice(0, rig.poseHistory.length - 512);
      }
      rig.root.position.set(pose.x, TRAIN_ROOT_Y, pose.z);
      rig.root.rotation.y = pose.yaw;
      rig.baseDistanceMilli = train.distanceTravelledMilli;
      rig.baseX = pose.x;
      rig.baseZ = pose.z;
      rig.baseYaw = pose.yaw;
      rig.speedMilliPerTick = train.speedMilliPerTick;
      rig.syncElapsedSeconds = elapsedSeconds;
      rig.status = train.status;
      rig.statusLamp.material =
        train.status === "moving"
          ? this.materials.active
          : train.status === "waiting-signal"
            ? this.materials.warning
            : train.status === "out-of-fuel" || train.status === "no-path"
              ? this.materials.lampRed
              : this.materials.inactive;
      rig.routeDrum.rotation.z =
        train.scheduleIndex *
        ((Math.PI * 2) / Math.max(1, train.schedule.length));
      for (let index = 0; index < rig.cars.length; index += 1) {
        const carRig = rig.cars[index]!;
        const car = train.cars[index]!;
        const carDistanceMilli =
          rig.renderedDistanceMilli - index * CAR_SPACING * 1_000;
        const bogiePoses = carRig.bogies.map((bogie) => {
          const longitudinalOffset = Number(
            bogie.userData.longitudinalOffset ?? 0,
          );
          return {
            bogie,
            longitudinalOffset,
            pose: sampleTrainPoseHistory(
              rig.poseHistory,
              carDistanceMilli + longitudinalOffset * 1_000,
              pose,
            ),
          };
        });
        const rearBogiePose = bogiePoses[0]?.pose;
        const frontBogiePose = bogiePoses[bogiePoses.length - 1]?.pose;
        const centrePose = sampleTrainPoseHistory(
          rig.poseHistory,
          carDistanceMilli,
          pose,
        );
        const carPose =
          rearBogiePose && frontBogiePose
            ? {
                x: (rearBogiePose.x + frontBogiePose.x) * 0.5,
                z: (rearBogiePose.z + frontBogiePose.z) * 0.5,
                yaw:
                  Math.hypot(
                    frontBogiePose.x - rearBogiePose.x,
                    frontBogiePose.z - rearBogiePose.z,
                  ) > 0.000_001
                    ? -Math.atan2(
                        frontBogiePose.z - rearBogiePose.z,
                        frontBogiePose.x - rearBogiePose.x,
                      )
                    : centrePose.yaw,
              }
            : centrePose;
        carRig.basePose = carPose;
        const local = new THREE.Vector3(
          carPose.x - pose.x,
          0,
          carPose.z - pose.z,
        ).applyAxisAngle(Y_AXIS, -pose.yaw);
        carRig.root.position.set(local.x, 0, local.z);
        carRig.root.rotation.y = carPose.yaw - pose.yaw;
        for (const {
          bogie,
          longitudinalOffset,
          pose: bogiePose,
        } of bogiePoses) {
          const bogieLocal = new THREE.Vector3(
            bogiePose.x - carPose.x,
            0,
            bogiePose.z - carPose.z,
          ).applyAxisAngle(Y_AXIS, -carPose.yaw);
          bogie.position.set(bogieLocal.x, 0, bogieLocal.z);
          const relativeYaw = Math.atan2(
            Math.sin(bogiePose.yaw - carPose.yaw),
            Math.cos(bogiePose.yaw - carPose.yaw),
          );
          bogie.rotation.y = THREE.MathUtils.clamp(relativeYaw, -0.42, 0.42);
          bogie.userData.tangentYaw = bogie.rotation.y;
          bogie.userData.worldYaw = carPose.yaw + bogie.rotation.y;
          bogie.userData.articulationModel =
            "distance-sampled-independent-bogie-tangent";
          bogie.userData.expectedRailCentreWorld = [
            bogiePose.x,
            TRAIN_ROOT_Y,
            bogiePose.z,
          ];
          bogie.userData.expectedRailTangentYaw = bogiePose.yaw;
          for (const wheel of bogie.getObjectsByProperty(
            "name",
            "rail-flanged-wheel",
          )) {
            const axleOffset = Number(
              wheel.userData.axleOffsetFromBogie ?? 0,
            );
            const railPose = sampleTrainPoseHistory(
              rig.poseHistory,
              carDistanceMilli +
                (longitudinalOffset + axleOffset) * 1_000,
              bogiePose,
            );
            wheel.userData.expectedRailCentreWorld = [
              railPose.x,
              TRAIN_ROOT_Y,
              railPose.z,
            ];
            wheel.userData.expectedRailTangentYaw = railPose.yaw;
            wheel.userData.railCentreSource =
              "authoritative-rendered-centreline-history-sample";
          }
        }
        if (carRig.kind === "cargo-wagon" && carRig.cargoLoad) {
          const ratio =
            car.capacity > 0 ? Math.min(1, car.stored / car.capacity) : 0;
          carRig.cargoLoad.visible = ratio > 0;
          carRig.cargoLoad.scale.set(1.08, 0.38 + ratio * 0.86, 1.32);
          carRig.cargoLoad.position.y = 0.58 + ratio * 0.07;
          carRig.cargoLoad.material = cargoMaterialFor(
            car.cargo[0]?.itemId,
            this.materials,
          );
          carRig.cargoLoad.userData = {
            itemId: car.cargo[0]?.itemId ?? null,
            stored: car.stored,
            capacity: car.capacity,
            fillRatio: ratio,
          };
        }
        if (carRig.kind === "locomotive" && carRig.fuelGauge) {
          const ratio =
            car.fuelCapacityMilli > 0
              ? car.fuelMilli / car.fuelCapacityMilli
              : 0;
          carRig.fuelGauge.scale.x = Math.max(0.04, ratio);
          carRig.fuelGauge.material =
            ratio > 0.2 ? this.materials.active : this.materials.warning;
          carRig.fuelGauge.userData = {
            fuelMilli: car.fuelMilli,
            capacityMilli: car.fuelCapacityMilli,
            fillRatio: ratio,
          };
        }
        const braking =
          train.status === "waiting-signal" ||
          (train.status === "dwelling" && train.dwellTicks < 18);
        for (const brake of carRig.brakes) {
          brake.visible = true;
          brake.material = braking
            ? this.materials.brakeHot
            : this.materials.brake;
        }
        carRig.root.userData = {
          pickTarget: {
            kind: "train",
            trainId: train.id,
            carId: car.id,
          } satisfies RailPickTarget,
          trainId: train.id,
          carId: car.id,
          kind: car.kind,
        };
      }
      for (const carRig of rig.cars) {
        for (const coupler of [
          carRig.couplers.front,
          carRig.couplers.rear,
        ]) {
          coupler.root.rotation.y = 0;
          coupler.root.scale.x = 1;
          coupler.face.userData.targetWorld = null;
          coupler.face.userData.pairedCarId = null;
        }
      }
      const worldToCarLocal = (
        carPose: TrainPose,
        target: THREE.Vector3,
      ): THREE.Vector3 =>
        target
          .clone()
          .sub(new THREE.Vector3(carPose.x, TRAIN_ROOT_Y, carPose.z))
          .applyAxisAngle(Y_AXIS, -carPose.yaw);
      const setCouplerFaceTarget = (
        carRig: TrainCarRig,
        coupler: TrainCouplerRig,
        target: THREE.Vector3,
        pairedCarId: string,
      ): void => {
        const localTarget = worldToCarLocal(carRig.basePose, target);
        const outward = localTarget.multiplyScalar(coupler.side);
        const distance = Math.max(0.001, Math.hypot(outward.x, outward.z));
        coupler.root.rotation.y = -Math.atan2(outward.z, outward.x);
        coupler.root.scale.x =
          distance / COUPLER_KNUCKLE_FACE_FROM_CAR;
        coupler.face.userData.targetWorld = [target.x, target.y, target.z];
        coupler.face.userData.pairedCarId = pairedCarId;
        coupler.face.userData.draftGearExtension =
          distance - COUPLER_KNUCKLE_FACE_FROM_CAR;
      };
      const nominalCouplerFace = (
        carRig: TrainCarRig,
        side: -1 | 1,
      ): THREE.Vector3 =>
        new THREE.Vector3(
          side * COUPLER_KNUCKLE_FACE_FROM_CAR,
          0,
          0,
        )
          .applyAxisAngle(Y_AXIS, carRig.basePose.yaw)
          .add(
            new THREE.Vector3(
              carRig.basePose.x,
              TRAIN_ROOT_Y + 0.04,
              carRig.basePose.z,
            ),
          );
      for (let index = 0; index < rig.cars.length - 1; index += 1) {
        const leading = rig.cars[index]!;
        const trailing = rig.cars[index + 1]!;
        const leadingNominal = nominalCouplerFace(leading, -1);
        const trailingNominal = nominalCouplerFace(trailing, 1);
        const separation = trailingNominal.clone().sub(leadingNominal);
        const separationLength = separation.length();
        const axis =
          separationLength > 0.000_001
            ? separation.multiplyScalar(1 / separationLength)
            : new THREE.Vector3(
                -Math.cos(leading.basePose.yaw),
                0,
                Math.sin(leading.basePose.yaw),
              );
        const midpoint = leadingNominal
          .clone()
          .add(trailingNominal)
          .multiplyScalar(0.5);
        const leadingTarget = midpoint
          .clone()
          .addScaledVector(axis, -0.02);
        const trailingTarget = midpoint
          .clone()
          .addScaledVector(axis, 0.02);
        setCouplerFaceTarget(
          leading,
          leading.couplers.rear,
          leadingTarget,
          trailing.id,
        );
        setCouplerFaceTarget(
          trailing,
          trailing.couplers.front,
          trailingTarget,
          leading.id,
        );
      }
      rig.root.userData = {
        pickTarget: {
          kind: "train",
          trainId: train.id,
        } satisfies RailPickTarget,
        trainId: train.id,
        status: train.status,
        currentSegmentId: train.currentSegmentId,
        currentBlockId: train.currentBlockId,
        scheduleIndex: train.scheduleIndex,
        schedule: train.schedule.map((stop) => ({
          stationId: stop.stationId,
          wait: { ...stop.wait },
        })),
        cargoUnits: train.cargoUnits,
        cargoCapacity: train.cargoCapacity,
        fuelMilli: train.fuelMilli,
        occupancyModel: "exclusive-block-atomic-consist",
        articulationModel: "distance-sampled-per-car-pose-history",
        bogieArticulationModel: "distance-sampled-independent-bogie-tangent",
        poseDistanceMetric: "accumulated-rendered-centreline-arc",
        campaignWestTraversalDirection: rig.campaignWestTraversalDirection,
        poseHistoryResetCount: rig.poseHistoryResetCount,
        lastPoseHistoryResetReason: rig.lastPoseHistoryResetReason,
        carSpacing: CAR_SPACING,
        wheelRailCenters: {
          rail: [-0.19, 0.19],
          wheelTread: [-WHEEL_TRACK_Z, WHEEL_TRACK_Z],
        },
      };
    }
    const overview = trains.slice(this.options.maxDetailedTrains);
    const overviewCandidates = [
      ...detailed.flatMap((train) =>
        train.cars
          .slice(this.options.maxDetailedCarsPerTrain)
          .map((car, index) => ({
            train,
            car,
            carIndex: this.options.maxDetailedCarsPerTrain + index,
          })),
      ),
      ...overview.flatMap((train) =>
        train.cars.map((car, carIndex) => ({
          train,
          car,
          carIndex,
        })),
      ),
    ];
    const overviewCars = overviewCandidates.slice(
      0,
      this.options.maxOverviewCars,
    );
    const overviewEntries = overviewCars.map((entry) => {
      const pose = trainPose(entry.train, nodes);
      const offset = entry.carIndex * CAR_SPACING;
      return {
        value: entry,
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(
            pose.x - Math.cos(pose.yaw) * offset,
            TRAIN_ROOT_Y,
            pose.z + Math.sin(pose.yaw) * offset,
          ),
          new THREE.Quaternion().setFromAxisAngle(Y_AXIS, pose.yaw),
          new THREE.Vector3(1, 1, 1),
        ),
      };
    });
    this.syncBatch(
      "overview-locomotive-cars",
      overviewEntries.filter((entry) => entry.value.car.kind === "locomotive"),
      this.geometries.overviewTrain,
      this.materials.locomotive,
      this.overviewRoot,
      ({ train, car }) => ({
        kind: "train",
        trainId: train.id,
        carId: car.id,
      }),
    );
    this.syncBatch(
      "overview-cargo-wagon-cars",
      overviewEntries.filter((entry) => entry.value.car.kind === "cargo-wagon"),
      this.geometries.overviewTrain,
      this.materials.wagon,
      this.overviewRoot,
      ({ train, car }) => ({
        kind: "train",
        trainId: train.id,
        carId: car.id,
      }),
    );
    const detailedCars = detailed.reduce(
      (sum, train) =>
        sum + Math.min(train.cars.length, this.options.maxDetailedCarsPerTrain),
      0,
    );
    return {
      detailed: detailed.length,
      overview: overview.length,
      detailedCars,
      overviewCars: overviewCars.length,
      omittedCars: overviewCandidates.length - overviewCars.length,
    };
  }

  private createStationRig(id: string): StationRig {
    const root = new THREE.Group();
    root.name = "rail-station-rig";
    const loadChainRoot = new THREE.Group();
    loadChainRoot.name = "rail-station-independent-load-chain";
    const unloadChainRoot = new THREE.Group();
    unloadChainRoot.name = "rail-station-independent-unload-chain";
    root.add(loadChainRoot, unloadChainRoot);
    const addTo = (
      parent: THREE.Object3D,
      name: string,
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      position: readonly [number, number, number],
      rotation: readonly [number, number, number] = [0, 0, 0],
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.position.set(...position);
      mesh.rotation.set(...rotation);
      setShadow(mesh);
      parent.add(mesh);
      return mesh;
    };
    const add = (
      name: string,
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      position: readonly [number, number, number],
      rotation: readonly [number, number, number] = [0, 0, 0],
    ): THREE.Mesh => addTo(root, name, geometry, material, position, rotation);
    const districtGround = add(
      "rail-station-lived-in-district-ground",
      this.geometries.stationDistrict.ground,
      this.materials.platform,
      [0, 0, 0],
    );
    districtGround.userData = {
      clearanceEnvelope:
        "loader foundations north of main gauge; public maintenance road beyond siding gauge",
      nearestTrackEdgeZ: -1.53,
      southernContextStartsZ: 2.52,
      features: [
        "maintenance-road",
        "drainage",
        "equipment-pads",
        "weathered-concrete-apron",
      ],
    };
    const districtSteel = add(
      "rail-station-lived-in-district-steel",
      this.geometries.stationDistrict.steel,
      this.materials.stationSteel,
      [0, 0, 0],
    );
    const districtIndustry = add(
      "rail-station-lived-in-workshop-silos",
      this.geometries.stationDistrict.paint,
      this.materials.stationPaint,
      [0, 0, 0],
    );
    const districtSafety = add(
      "rail-station-lived-in-safety-markings",
      this.geometries.stationDistrict.safety,
      this.materials.safety,
      [0, 0, 0],
    );
    const districtProps = add(
      "rail-station-lived-in-crates-drums-and-tools",
      this.geometries.stationDistrict.props,
      this.materials.wagon,
      [0, 0, 0],
    );
    const districtVegetation = add(
      "rail-station-lived-in-trackside-weeds",
      this.geometries.stationDistrict.vegetation,
      this.materials.yardVegetation,
      [0, 0, 0],
    );
    const districtLamps = add(
      "rail-station-lived-in-work-lamps",
      this.geometries.stationDistrict.lights,
      this.materials.warning,
      [0, 0, 0],
    );
    const districtVariant =
      Number.parseInt(fnv1a([id, "district-variant"]).slice(0, 2), 16) % 2;
    if (districtVariant === 1) {
      districtIndustry.scale.set(0.9, 0.94, 0.92);
      districtIndustry.position.x = -0.18;
      districtProps.position.x = 0.34;
      districtProps.rotation.y = 0.025;
      districtVegetation.position.x = -0.24;
      districtSafety.scale.x = 0.95;
      districtLamps.position.x = 0.16;
      districtSteel.position.x = -0.08;
    }
    if (id.includes("east-service")) {
      districtGround.scale.x = 0.58;
      districtSteel.scale.x = 0.58;
      districtSafety.scale.x = 0.58;
      districtProps.scale.x = 0.58;
      districtVegetation.scale.x = 0.58;
      districtLamps.scale.x = 0.58;
      districtIndustry.visible = false;
    }
    const nameBoard = add(
      "rail-station-cinder-yard-nameboard",
      this.geometries.stationDistrict.signBoard,
      this.materials.signalHousing,
      [-4.48, 0.98, -2.555],
    );
    nameBoard.scale.set(0.68, 0.72, 0.72);
    add(
      "rail-station-cinder-readable-name",
      this.geometries.stationDistrict.signName,
      this.materials.warning,
      [-4.48, 1.01, -2.503],
    );
    add(
      "rail-station-cinder-roof-stencil",
      this.geometries.stationDistrict.signName,
      this.materials.decal,
      [-4.48, 1.495, -3.18],
      [-Math.PI / 2, 0, 0],
    );
    const modeBoard = add(
      "rail-station-live-mode-board",
      this.geometries.stationDistrict.signBoard,
      this.materials.signalHousing,
      [0.18, 0.94, -2.62],
    );
    modeBoard.scale.set(0.38, 0.64, 0.74);
    const modeLoad = add(
      "rail-station-mode-sign-load",
      this.geometries.stationDistrict.signLoad,
      this.materials.active,
      [0.18, 0.96, -2.568],
    );
    const modeUnload = add(
      "rail-station-mode-sign-unload",
      this.geometries.stationDistrict.signUnload,
      this.materials.active,
      [0.18, 0.96, -2.566],
    );
    const modeService = add(
      "rail-station-mode-sign-service",
      this.geometries.stationDistrict.signService,
      this.materials.warning,
      [0.18, 0.96, -2.564],
    );
    const districtLight = new THREE.PointLight(0xffc77c, 0.72, 4.8, 2);
    districtLight.name = "rail-station-lived-in-warm-work-light";
    districtLight.position.set(-2.1, 1.55, -3.48);
    districtLight.castShadow = false;
    root.add(districtLight);
    add(
      "rail-station-platform",
      this.geometries.stationPlatform,
      this.materials.platform,
      [-1.34, 0.13, -0.72],
    );
    add(
      "rail-station-drainage-grating",
      this.geometries.stationPlatformGrating,
      this.materials.conveyor,
      [-1.34, 0.215, -0.72],
    );
    add(
      "rail-station-safety-edge",
      this.geometries.stationEdge,
      this.materials.platformEdge,
      [-1.34, 0.235, -0.43],
    );
    add(
      "rail-station-canopy",
      this.geometries.stationCanopy,
      this.materials.stationPaint,
      [-0.25, 0.9, -1.08],
    );
    add(
      "rail-station-canopy-safety-stripe",
      this.geometries.stationCanopyStripe,
      this.materials.safety,
      [-0.25, 0.947, -1.08],
    );
    add(
      "rail-station-canopy-ribs",
      this.geometries.stationCanopyRibs,
      this.materials.railTop,
      [-0.25, 0.966, -1.08],
    );
    for (const x of [-0.82, 0.32]) {
      add(
        "rail-station-canopy-support",
        this.geometries.stationSupport,
        this.materials.stationSteel,
        [x, 0.51, -1.06],
      );
    }
    const crane = addTo(
      unloadChainRoot,
      "rail-station-unload-gantry",
      this.geometries.stationCrane,
      this.materials.locomotiveSecondary,
      [-1.97, 0.12, -0.76],
    );
    add(
      "rail-station-fuel-service-arm",
      this.geometries.stationServiceArm,
      this.materials.safety,
      [0.22, 0.2, -0.58],
    );
    add(
      "rail-station-fuel-tank",
      this.geometries.stationFuelTank,
      this.materials.stationPaint,
      [0.25, 0.16, -1.4],
    );
    const cargoIndicator = add(
      "rail-station-cargo-service-pallet",
      this.geometries.stationPallet,
      this.materials.cargoIron,
      [-2.85, 0.2, -1.52],
    );
    addTo(
      loadChainRoot,
      "rail-station-load-storage-transfer-chute",
      this.geometries.stationChute,
      this.materials.stationPaint,
      [0.12, 0.47, -1.38],
    );
    addTo(
      loadChainRoot,
      "rail-station-load-sloped-chute-bed",
      this.geometries.stationChuteBed,
      this.materials.conveyor,
      [0.12, 0.47, -1.38],
    );
    addTo(
      loadChainRoot,
      "rail-station-load-sloped-chute-ore",
      this.geometries.stationChuteOre,
      this.materials.cargoIron,
      [0.12, 0.47, -1.38],
    );
    addTo(
      loadChainRoot,
      "rail-station-load-source-bin",
      this.geometries.stationOreSourceBin,
      this.materials.locomotiveSecondary,
      [0.52, 0.18, -1.53],
    );
    const sourceBinOre = addTo(
      loadChainRoot,
      "rail-station-load-source-bin-ore",
      this.geometries.stationTransferPayload,
      this.materials.cargoIron,
      [0.52, 0.68, -1.53],
    );
    sourceBinOre.scale.setScalar(0.95);
    addTo(
      loadChainRoot,
      "rail-station-load-infeed-conveyor-frame",
      this.geometries.stationConveyor,
      this.materials.stationSteel,
      [-1.55, 0.28, -1.34],
    );
    addTo(
      loadChainRoot,
      "rail-station-load-infeed-conveyor-guards",
      this.geometries.stationConveyorGuards,
      this.materials.stationSteel,
      [-1.55, 0.28, -1.34],
    );
    addTo(
      loadChainRoot,
      "rail-station-load-infeed-conveyor-rollers",
      this.geometries.stationRollers,
      this.materials.conveyor,
      [-1.55, 0.28, -1.34],
    );
    addTo(
      loadChainRoot,
      "rail-station-load-metered-aggregate-bed",
      this.geometries.stationConveyorOreBed,
      this.materials.cargoIron,
      [-1.55, 0.28, -1.34],
    );
    addTo(
      unloadChainRoot,
      "rail-station-unload-outfeed-conveyor-frame",
      this.geometries.stationConveyor,
      this.materials.stationSteel,
      [-1.25, 0.25, -1.48],
    );
    addTo(
      unloadChainRoot,
      "rail-station-unload-outfeed-conveyor-guards",
      this.geometries.stationConveyorGuards,
      this.materials.stationSteel,
      [-1.25, 0.25, -1.48],
    );
    addTo(
      unloadChainRoot,
      "rail-station-unload-outfeed-conveyor-rollers",
      this.geometries.stationRollers,
      this.materials.conveyor,
      [-1.25, 0.25, -1.48],
    );
    add(
      "rail-station-control-cabinet",
      this.geometries.stationControlCabinet,
      this.materials.stationPaint,
      [0.34, 0.2, -1.24],
    );
    const scheduleDial = add(
      "rail-station-wait-condition-dial",
      this.geometries.stationDial,
      this.materials.signalHousing,
      [0.34, 0.58, -1.085],
    );
    const statusLamp = add(
      "rail-station-service-status",
      this.geometries.indicatorLens,
      this.materials.inactive,
      [0.23, 0.58, -1.085],
      [0, 0, 0],
    );
    const loadChutes: StationLoadChuteRig[] = [];
    const loaders: StationLoaderRig[] = [];
    for (const [index, wagonOffsetX] of [
      -CAR_SPACING,
      -CAR_SPACING * 2,
    ].entries()) {
      const loadChuteRoot = new THREE.Group();
      loadChuteRoot.name = "rail-station-telescoping-load-chute";
      loadChuteRoot.position.set(wagonOffsetX, 0, -1.45);
      loadChainRoot.add(loadChuteRoot);
      addTo(
        loadChuteRoot,
        "rail-station-load-chute-pedestal",
        this.geometries.stationLoaderBase,
        this.materials.stationPaint,
        [0, 0, -0.12],
      );
      addTo(
        loadChuteRoot,
        "rail-station-grounded-load-portal",
        this.geometries.stationLoaderPortal,
        this.materials.stationSteel,
        [0, 0, 0],
      );
      addTo(
        loadChuteRoot,
        "rail-station-load-chute-base-bearing",
        this.geometries.stationLoaderJoint,
        this.materials.fastener,
        [0, 0.12, -0.12],
      );
      const boom = addTo(
        loadChuteRoot,
        "rail-station-load-chute-cantilever",
        this.geometries.stationLoadBoom,
        index === 0 ? this.materials.safety : this.materials.stationSteel,
        [0, 1.18, 0.48],
      );
      const nozzle = addTo(
        loadChuteRoot,
        "rail-station-load-nozzle",
        this.geometries.stationLoadNozzle,
        this.materials.stationPaint,
        [0, 1.24, 1.45],
      );
      nozzle.scale.setScalar(0.48);
      const gate = addTo(
        loadChuteRoot,
        "rail-station-load-flow-gate",
        this.geometries.stationLoaderJoint,
        this.materials.safety,
        [0, 1.35, 1.45],
        [0, 0, Math.PI / 2],
      );
      gate.scale.setScalar(0.36);
      const loadPayload = addTo(
        loadChuteRoot,
        "rail-station-load-metered-ore-stream",
        this.geometries.stationTransferStream,
        this.materials.cargoIronTransfer,
        [0, 0.98, 1.45],
      );
      loadPayload.scale.setScalar(1.08);
      loadPayload.visible = false;
      const serviceCartridge = addTo(
        loadChuteRoot,
        "rail-station-timed-service-cartridge",
        this.geometries.stationServiceCartridge,
        this.materials.warning,
        [0, 1.05, 0.18],
      );
      serviceCartridge.scale.setScalar(0.72);
      serviceCartridge.visible = false;
      loadChutes.push({
        root: loadChuteRoot,
        boom,
        nozzle,
        gate,
        payload: loadPayload,
        serviceCartridge,
        wagonOffsetX,
      });

      const loaderRoot = new THREE.Group();
      loaderRoot.name = "rail-station-overhead-unloader";
      loaderRoot.position.set(wagonOffsetX, 0, -1.45);
      unloadChainRoot.add(loaderRoot);
      addTo(
        loaderRoot,
        "rail-station-unloader-pedestal",
        this.geometries.stationSupport,
        index === 0 ? this.materials.wagonRust : this.materials.stationPaint,
        [0, 0.51, -0.12],
      );
      addTo(
        loaderRoot,
        "rail-station-unloader-base-bearing",
        this.geometries.stationLoaderJoint,
        this.materials.fastener,
        [0, 0.12, -0.12],
      );
      addTo(
        loaderRoot,
        "rail-station-unload-receiving-hopper",
        this.geometries.stationReceivingHopper,
        this.materials.wagonInterior,
        [0, 0.3, -0.55],
      );
      const upperArm = addTo(
        loaderRoot,
        "rail-station-unloader-upper-arm",
        this.geometries.stationLoaderArm,
        this.materials.safety,
        [0, 1.06, 0.08],
      );
      const forearm = addTo(
        loaderRoot,
        "rail-station-unloader-forearm",
        this.geometries.stationLoaderArm,
        this.materials.stationSteel,
        [0, 1.05, 0.42],
      );
      addTo(
        loaderRoot,
        "rail-station-unloader-shoulder-joint",
        this.geometries.stationLoaderJoint,
        this.materials.fastener,
        [0, 1.04, -0.02],
      );
      const claw = addTo(
        loaderRoot,
        "rail-station-unloader-grab",
        this.geometries.stationLoaderClaw,
        this.materials.wagonRust,
        [0, 1.08, 0.72],
      );
      claw.scale.setScalar(0.6);
      const payload = addTo(
        loaderRoot,
        "rail-station-unloader-carried-ore",
        this.geometries.stationTransferPayload,
        this.materials.cargoIron,
        [0, 0.98, 0.72],
      );
      payload.scale.setScalar(0.64);
      payload.visible = false;
      loaders.push({
        root: loaderRoot,
        upperArm,
        forearm,
        claw,
        payload,
        wagonOffsetX,
      });
    }
    const beltPayloads = Array.from({ length: 9 }, (_, index) => {
      const payload = addTo(
        loadChainRoot,
        "rail-station-load-conveyor-ore",
        this.geometries.stationTransferPayload,
        this.materials.cargoIron,
        [-2.96 + index * 0.36, 0.46, -1.34],
      );
      payload.scale.setScalar(0.26 + (index % 3) * 0.035);
      return payload;
    });
    for (let index = 0; index < 9; index += 1) {
      const payload = addTo(
        unloadChainRoot,
        "rail-station-unload-conveyor-ore",
        this.geometries.stationTransferPayload,
        this.materials.cargoIron,
        [-2.96 + index * 0.36, 0.43, -1.48],
      );
      payload.scale.setScalar(0.24 + (index % 3) * 0.03);
      payload.userData.unloadOutfeed = true;
      beltPayloads.push(payload);
    }
    const serviceArm = loadChutes[0]!.root;
    root.userData.stationId = id;
    this.stationRoot.add(root);
    return {
      id,
      root,
      crane,
      serviceArm,
      statusLamp,
      cargoIndicator,
      scheduleDial,
      loadChainRoot,
      unloadChainRoot,
      loadChutes,
      loaders,
      beltPayloads,
      modeSigns: {
        load: modeLoad,
        unload: modeUnload,
        service: modeService,
      },
      districtLight,
      serviceActive: false,
      servicePhase: 0,
      serviceMode: "service",
      transferPhase: 0,
      heroWagonIndex: 0,
    };
  }

  private createTrainRig(train: RailTrainSnapshot): TrainRig {
    const root = new THREE.Group();
    root.name = "rail-train-rig";
    const cars: TrainCarRig[] = [];
    const detailedCars = train.cars.slice(
      0,
      this.options.maxDetailedCarsPerTrain,
    );
    for (let index = 0; index < detailedCars.length; index += 1) {
      const car = detailedCars[index]!;
      const carRoot = new THREE.Group();
      carRoot.name =
        car.kind === "locomotive"
          ? "rail-locomotive-car"
          : "rail-cargo-wagon-car";
      carRoot.position.x = -index * CAR_SPACING;
      const longitudinalScale = car.kind === "locomotive" ? 1.4 : 1.32;
      const bodyRoot = new THREE.Group();
      bodyRoot.name = "rail-car-scaled-body-shell";
      bodyRoot.scale.set(
        longitudinalScale,
        car.kind === "locomotive" ? 1.18 : 1,
        car.kind === "locomotive" ? 1 : 0.9,
      );
      carRoot.add(bodyRoot);
      const add = (
        name: string,
        geometry: THREE.BufferGeometry,
        material: THREE.Material,
        position: readonly [number, number, number],
        rotation: readonly [number, number, number] = [0, 0, 0],
      ): THREE.Mesh => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        mesh.position.set(...position);
        mesh.rotation.set(...rotation);
        setShadow(mesh);
        bodyRoot.add(mesh);
        return mesh;
      };
      add(
        "rail-car-underframe",
        this.geometries.underframe,
        this.materials.fastener,
        [0, 0.08, 0],
      );
      const bogies: THREE.Group[] = [];
      const wheels: THREE.Object3D[] = [];
      const rods: THREE.Object3D[] = [];
      const brakes: THREE.Mesh[] = [];
      const serviceHatches: THREE.Mesh[] = [];
      for (const bogieX of car.kind === "cargo-wagon"
        ? [-0.56, 0.56]
        : [-0.48, 0.48]) {
        const bogieRoot = new THREE.Group();
        bogieRoot.name = "rail-articulated-bogie-rig";
        bogieRoot.position.x = bogieX * longitudinalScale;
        bogieRoot.scale.set(longitudinalScale, 1.18, 1);
        bogieRoot.userData.longitudinalOffset =
          bogieX * longitudinalScale;
        carRoot.add(bogieRoot);
        bogies.push(bogieRoot);
        const addBogie = (
          name: string,
          geometry: THREE.BufferGeometry,
          material: THREE.Material,
          position: readonly [number, number, number],
        ): THREE.Mesh => {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.name = name;
          mesh.position.set(...position);
          setShadow(mesh);
          bogieRoot.add(mesh);
          return mesh;
        };
        addBogie(
          "rail-bogie-frame",
          this.geometries.bogie,
          car.kind === "cargo-wagon"
            ? this.materials.locomotiveSecondary
            : this.materials.fastener,
          [0, -0.015, 0],
        );
        addBogie(
          "rail-bogie-articulated-suspension",
          this.geometries.bogieSuspension,
          this.materials.switchMetal,
          [0, 0.012, 0],
        );
        for (const axleOffset of [-0.13, 0.13]) {
          addBogie(
            "rail-bogie-through-axle",
            this.geometries.axle,
            this.materials.switchMetal,
            [axleOffset, -0.08, 0],
          );
          for (const z of [-WHEEL_TRACK_Z, WHEEL_TRACK_Z]) {
            const wheel = addBogie(
              "rail-flanged-wheel",
              this.geometries.wheel,
              car.kind === "cargo-wagon"
                ? this.materials.junctionRailTop
                : this.materials.fastener,
              [axleOffset, -0.08, z],
            );
            if (car.kind === "cargo-wagon") {
              wheel.scale.set(1.18, 1.18, 1);
            }
            wheel.userData = {
              axleOffsetFromBogie: axleOffset * longitudinalScale,
              intendedRailOffset: z,
              railSide: Math.sign(z),
              carIndex: index,
              bogieLongitudinalOffset: bogieX * longitudinalScale,
            };
            wheels.push(wheel);
            const flange = addBogie(
              "rail-wheel-inner-flange-ring",
              this.geometries.wheelFlange,
              this.materials.railTop,
              [axleOffset, -0.08, z - Math.sign(z) * 0.038],
            );
            if (car.kind === "cargo-wagon") {
              flange.scale.set(1.16, 1.16, 1);
            }
            addBogie(
              "rail-wheel-machined-hub",
              this.geometries.wheelHub,
              this.materials.switchMetal,
              [axleOffset, -0.08, z + Math.sign(z) * 0.014],
            );
            const brake = addBogie(
              "rail-brake-arrival-cue",
              this.geometries.brakeShoe,
              this.materials.brake,
              [axleOffset + 0.075, -0.035, z],
            );
            brakes.push(brake);
          }
        }
      }
      if (car.kind === "locomotive") {
        for (const side of [-1, 1]) {
          const rod = add(
            "rail-locomotive-visible-side-rod",
            this.geometries.sideRod,
            this.materials.locomotiveAccent,
            [0, -0.09, side * 0.252],
          );
          rods.push(rod);
        }
      }
      const createCoupler = (side: -1 | 1): TrainCouplerRig => {
        const couplerRoot = new THREE.Group();
        couplerRoot.name =
          side > 0
            ? "rail-front-articulated-draft-gear"
            : "rail-rear-articulated-draft-gear";
        carRoot.add(couplerRoot);
        const coupler = new THREE.Mesh(
          this.geometries.coupler,
          car.kind === "cargo-wagon"
            ? this.materials.junctionRailTop
            : this.materials.fastener,
        );
        coupler.name =
          side > 0 ? "rail-front-coupler" : "rail-rear-coupler";
        coupler.position.set(side * COUPLER_CENTER_FROM_CAR, 0.04, 0);
        coupler.rotation.y = side > 0 ? 0 : Math.PI;
        setShadow(coupler);
        couplerRoot.add(coupler);
        const hoses = new THREE.Mesh(
          this.geometries.couplerHoses,
          this.materials.rubber,
        );
        hoses.name =
          side > 0 ? "rail-front-coupler-hoses" : "rail-rear-coupler-hoses";
        hoses.position.set(side * COUPLER_CENTER_FROM_CAR, 0.04, 0);
        hoses.rotation.y = side > 0 ? 0 : Math.PI;
        setShadow(hoses);
        couplerRoot.add(hoses);
        const face = new THREE.Object3D();
        face.name =
          side > 0
            ? "rail-front-coupler-knuckle-face"
            : "rail-rear-coupler-knuckle-face";
        face.position.set(
          side * COUPLER_KNUCKLE_FACE_FROM_CAR,
          0.04,
          0,
        );
        face.userData = {
          physicalReference: "outer-knuckle-face",
          distanceFromCarCenter: COUPLER_KNUCKLE_FACE_FROM_CAR,
          articulatedDraftGear: true,
        };
        couplerRoot.add(face);
        return {
          side,
          root: couplerRoot,
          body: coupler,
          hoses,
          face,
        };
      };
      const couplers = {
        front: createCoupler(1),
        rear: createCoupler(-1),
      } as const;

      let cargoLoad: THREE.Mesh | undefined;
      let fuelGauge: THREE.Mesh | undefined;
      let servicePort: THREE.Mesh | undefined;
      if (car.kind === "locomotive") {
        add(
          "rail-locomotive-engine-armor",
          this.geometries.locomotiveBody,
          this.materials.locomotive,
          [0, 0.34, 0],
        );
        add(
          "rail-locomotive-cab",
          this.geometries.locomotiveCab,
          this.materials.locomotive,
          [0, 0.34, 0],
        );
        add(
          "rail-locomotive-rounded-nose",
          this.geometries.locomotiveNose,
          this.materials.locomotive,
          [0, 0.34, 0],
        );
        add(
          "rail-locomotive-cab-roof",
          this.geometries.locomotiveRoof,
          this.materials.locomotivePanel,
          [-0.4, 0.82, 0],
        );
        const hoodCrown = add(
          "rail-locomotive-raised-engine-hood-crown",
          this.geometries.locomotiveRoof,
          this.materials.locomotive,
          [0.28, 0.75, 0],
        );
        hoodCrown.scale.set(1.02, 0.72, 0.7);
        add(
          "rail-locomotive-cab-skylight",
          this.geometries.cabSkylight,
          this.materials.glass,
          [-0.4, 0.865, 0],
        );
        add(
          "rail-locomotive-boiler-bands",
          this.geometries.locomotiveBoilerBands,
          this.materials.locomotiveAccent,
          [0, 0.34, 0],
        );
        add(
          "rail-locomotive-hatches-rivets-and-pipework",
          this.geometries.locomotiveTopDetails,
          this.materials.railTop,
          [0, 0.34, 0],
        );
        add(
          "rail-locomotive-maintenance-deck",
          this.geometries.locomotiveDeck,
          this.materials.locomotiveSecondary,
          [0, 0.34, 0],
        );
        add(
          "rail-locomotive-layered-side-panels",
          this.geometries.locomotiveSidePanels,
          this.materials.locomotivePanel,
          [0, 0.34, 0],
        );
        add(
          "rail-locomotive-radiator-fans",
          this.geometries.locomotiveCooling,
          this.materials.fastener,
          [0, 0.34, 0],
        );
        add(
          "rail-locomotive-asymmetric-pipework",
          this.geometries.locomotivePipework,
          this.materials.switchMetal,
          [0, 0.34, 0],
        );
        add(
          "rail-locomotive-soot-staining",
          this.geometries.locomotiveSootPatch,
          this.materials.locomotiveSoot,
          [0, 0.34, 0],
        );
        add(
          "rail-locomotive-chipped-stencils",
          this.geometries.locomotiveDecals,
          this.materials.decal,
          [0, 0.34, 0],
        );
        add(
          "rail-locomotive-maintenance-handrails",
          this.geometries.locomotiveHandrails,
          this.materials.locomotiveAccent,
          [0, 0.34, 0],
        );
        add(
          "rail-locomotive-pilot",
          this.geometries.locomotivePilot,
          this.materials.switchMetal,
          [0.72, 0.25, 0],
        );
        add(
          "rail-locomotive-radiator-grille",
          this.geometries.locomotiveGrille,
          this.materials.locomotiveSecondary,
          [0.17, 0.64, -0.275],
        );
        add(
          "rail-locomotive-cab-window-left",
          this.geometries.cabWindow,
          this.materials.glass,
          [-0.43, 0.65, -0.303],
          [0, 0, 0],
        );
        add(
          "rail-locomotive-cab-window-right",
          this.geometries.cabWindow,
          this.materials.glass,
          [-0.43, 0.65, 0.303],
          [0, Math.PI, 0],
        );
        add(
          "rail-locomotive-exhaust-stack",
          this.geometries.chimney,
          this.materials.fastener,
          [0.3, 0.69, 0],
        );
        add(
          "rail-locomotive-headlight",
          this.geometries.headlight,
          this.materials.warning,
          [0.77, 0.59, 0],
        );
        fuelGauge = add(
          "rail-locomotive-authoritative-fuel-gauge",
          this.geometries.fuelGauge,
          this.materials.active,
          [-0.43, 0.7, -0.323],
        );
        fuelGauge.scale.set(1, 0.55, 0.55);
        fuelGauge.geometry.computeBoundingBox();
      } else {
        const isCoveredHopper = index % 2 === 1;
        const bodyMaterial =
          index % 2 === 0
            ? this.materials.wagon
            : this.materials.wagonSecondary;
        const panelMaterial =
          index % 2 === 0
            ? this.materials.wagonRust
            : this.materials.locomotiveSecondary;
        add(
          "rail-cargo-wagon-body",
          this.geometries.wagonBody,
          bodyMaterial,
          [0, 0.34, 0],
        );
        add(
          "rail-cargo-wagon-patched-side-panels",
          this.geometries.wagonSidePanels,
          panelMaterial,
          [0, 0.34, 0],
        );
        add(
          "rail-cargo-wagon-inset-discharge-doors",
          this.geometries.wagonDischargeDoors,
          this.materials.wagonInterior,
          [0, 0.34, 0],
        );
        add(
          "rail-cargo-wagon-door-frames-and-diagonal-braces",
          this.geometries.wagonDoorBraces,
          this.materials.stationSteel,
          [0, 0.34, 0],
        );
        add(
          "rail-cargo-wagon-brake-rigging",
          this.geometries.wagonBrakeRigging,
          this.materials.stationSteel,
          [0, 0.34, 0],
        );
        if (!isCoveredHopper) {
          add(
            "rail-open-gondola-deck-brake-stand-and-wheel",
            this.geometries.wagonBrakeStand,
            this.materials.switchMetal,
            [0, 0.84, 0],
          );
        }
        const grime = add(
          "rail-cargo-wagon-wheel-spray-and-rain-streaks",
          this.geometries.wagonGrime,
          this.materials.locomotiveSoot,
          [0, 0.34, 0],
        );
        grime.scale.x = index % 2 === 0 ? 1 : 0.86;
        grime.scale.y = index % 2 === 0 ? 0.92 : 1.08;
        add(
          "rail-cargo-wagon-sloped-hopper",
          this.geometries.wagonSlope,
          isCoveredHopper
            ? this.materials.wagonInterior
            : this.materials.wagonBasin,
          [0, isCoveredHopper ? 0.47 : 0.65, 0],
        );
        add(
          "rail-cargo-wagon-interior-floor",
          this.geometries.wagonFloor,
          isCoveredHopper
            ? this.materials.wagonInterior
            : this.materials.wagonBasin,
          [0, isCoveredHopper ? 0.47 : 0.64, 0],
        );
        add(
          "rail-cargo-wagon-top-lip",
          this.geometries.wagonLip,
          index % 2 === 0
            ? this.materials.wagonRust
            : this.materials.wagonSecondary,
          [0, 0.84, 0],
        );
        if (isCoveredHopper) {
          add(
            "rail-covered-ore-hopper-roof-shoulders",
            this.geometries.wagonCoveredShoulders,
            this.materials.wagonSecondary,
            [0, 0.84, 0],
          );
        } else {
          add(
            "rail-open-ore-gondola-center-discharge-spine",
            this.geometries.wagonDischargeSpine,
            this.materials.wagonBasin,
            [0, 0.69, 0],
          );
          const bedResidue = add(
            "rail-open-gondola-low-irregular-ochre-bed-residue-not-cargo",
            this.geometries.wagonOreBedResidue,
            this.materials.wagonOreResidue,
            [0, 0.705, 0],
          );
          bedResidue.userData = {
            presentationRole: "weathered-bed-residue",
            authoritativeCargo: false,
          };
          add(
            "rail-open-ore-gondola-cross-ties",
            this.geometries.wagonGondolaCrossTies,
            this.materials.switchMetal,
            [0, 0.87, 0],
          );
        }
        add(
          "rail-cargo-wagon-visible-draft-sill-and-end-platform",
          this.geometries.wagonDraftSill,
          this.materials.junctionRailTop,
          [0, 0.38, 0],
        );
        for (const side of [-1, 1]) {
          const hatch = add(
            "rail-cargo-wagon-sliding-service-hatch",
            this.geometries.wagonServiceHatch,
            isCoveredHopper
              ? this.materials.wagonInterior
              : this.materials.locomotivePanel,
            [isCoveredHopper ? side * 0.3 : 0, 0.91, 0],
          );
          hatch.scale.set(
            isCoveredHopper ? 0.68 : 0.42,
            1,
            isCoveredHopper ? 0.92 : 0.72,
          );
          hatch.visible = isCoveredHopper;
          hatch.userData = {
            side,
            homeX: isCoveredHopper ? side * 0.3 : 0,
            homeZ: 0,
            freightForm: isCoveredHopper
              ? "covered-center-discharge-hopper"
              : "open-ribbed-ore-gondola",
          };
          serviceHatches.push(hatch);
        }
        servicePort = add(
          "rail-cargo-wagon-keyed-service-port",
          this.geometries.wagonHazardPlate,
          this.materials.inactive,
          [0, 0.952, 0],
        );
        servicePort.scale.set(0.72, 0.58, 0.72);
        add(
          "rail-cargo-wagon-rim-rivets-and-tie-bolts",
          this.geometries.wagonRimHardware,
          this.materials.switchMetal,
          [0, 0.885, 0],
        );
        add(
          "rail-cargo-wagon-external-ribs",
          this.geometries.wagonRibs,
          this.materials.stationSteel,
          [0, 0.58, 0],
        );
        add(
          "rail-cargo-wagon-end-ladders",
          this.geometries.wagonLadders,
          this.materials.switchMetal,
          [0, 0.43, 0],
        );
        add(
          "rail-cargo-wagon-chipped-stencils",
          this.geometries.wagonDecals,
          this.materials.decal,
          [0, 0.42, 0],
        );
        add(
          "rail-cargo-wagon-hazard-plate",
          this.geometries.wagonHazardPlate,
          this.materials.safety,
          [0.38, 0.69, -0.33],
        );
        cargoLoad = add(
          "rail-authoritative-wagon-cargo",
          this.geometries.cargoLoad,
          this.materials.cargoProduct,
          [0, 0.31, 0],
        );
        cargoLoad.rotation.y = index % 2 === 0 ? 0.13 : Math.PI + 0.31;
        cargoLoad.scale.x = index % 2 === 0 ? 0.94 : 1;
        cargoLoad.scale.z = index % 2 === 0 ? 1 : 0.9;
      }
      root.add(carRoot);
      cars.push({
        id: car.id,
        kind: car.kind,
        root: carRoot,
        longitudinalScale,
        bogies,
        wheels,
        couplers,
        rods,
        brakes,
        serviceHatches,
        servicePort,
        cargoLoad,
        fuelGauge,
        basePose: {
          x: -index * CAR_SPACING,
          z: 0,
          yaw: 0,
        },
      });
    }
    const statusLamp = new THREE.Mesh(
      this.geometries.indicatorLens,
      this.materials.inactive,
    );
    statusLamp.name = "rail-train-authoritative-status-lamp";
    statusLamp.position.set(-0.3, 0.78, 0.2);
    statusLamp.scale.setScalar(0.58);
    root.add(statusLamp);
    const routeDrum = new THREE.Mesh(
      this.geometries.routeDrum,
      this.materials.safety,
    );
    routeDrum.name = "rail-train-schedule-route-drum";
    routeDrum.position.set(-0.46, 0.78, 0.2);
    routeDrum.scale.setScalar(0.62);
    root.add(routeDrum);
    const smoke = Array.from({ length: 3 }, (_, index) => {
      const puff = new THREE.Mesh(
        this.geometries.smokePuff,
        this.materials.smoke,
      );
      puff.name = "rail-locomotive-exhaust-plume";
      puff.position.set(0.2, 1.12, (index - 1) * 0.04);
      puff.scale.setScalar(0.2);
      puff.visible = false;
      root.add(puff);
      return puff;
    });
    this.trainRoot.add(root);
    return {
      id: train.id,
      root,
      carSignature: carSignature(train),
      cars,
      statusLamp,
      routeDrum,
      smoke,
      baseDistanceMilli: train.distanceTravelledMilli,
      renderedDistanceMilli: train.distanceTravelledMilli,
      baseX: root.position.x,
      baseZ: root.position.z,
      baseYaw: root.rotation.y,
      speedMilliPerTick: train.speedMilliPerTick,
      syncElapsedSeconds: 0,
      status: train.status,
      poseHistory: [],
      poseHistoryResetCount: 0,
      lastPoseHistoryResetReason: null,
      campaignWestTraversalDirection: null,
    };
  }

  private syncBatch<T>(
    key: string,
    entries: readonly BatchEntry<T>[],
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    parent: THREE.Object3D,
    pickTarget: (value: T) => RailPickTarget,
  ): void {
    const mesh = this.ensureBatch(
      key,
      entries.length,
      geometry,
      material,
      parent,
    );
    if (!mesh) return;
    mesh.count = entries.length;
    const targets: RailPickTarget[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;
      mesh.setMatrixAt(index, entry.matrix);
      targets.push(pickTarget(entry.value));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.pickTargets = Object.freeze(targets);
    mesh.userData.instanceCount = entries.length;
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
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = `rail-${key}`;
    mesh.castShadow =
      key.includes("rails") ||
      key.includes("signal") ||
      key.includes("overview");
    mesh.receiveShadow = !key.includes("overlay");
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

  private capacityMatching(prefix: string): number {
    let capacity = 0;
    for (const [key, batch] of this.batches) {
      if (key.startsWith(prefix)) capacity += batch.capacity;
    }
    return capacity;
  }

  private clearVisualState(): void {
    this.clearRigs();
    for (const batch of this.batches.values()) {
      batch.mesh.count = 0;
      batch.mesh.userData = {};
    }
  }

  private clearRigs(): void {
    for (const rig of this.trainRigs.values()) rig.root.removeFromParent();
    for (const rig of this.stationRigs.values()) rig.root.removeFromParent();
    this.trainRigs.clear();
    this.stationRigs.clear();
  }

  private resourceSnapshot(): RailRenderDebug["resources"] {
    return Object.freeze({
      ownedGeometries:
        this.geometries.all.length +
        this.authoringOwnedGeometries.length,
      ownedMaterials:
        this.materials.all.length +
        this.authoringOwnedMaterials.length,
      ownedTextures: 3,
      liveInstancedMeshes: this.batches.size,
      disposedGeometries: this.disposedGeometries,
      disposedMaterials: this.disposedMaterials,
      disposedTextures: this.disposedTextures,
      disposedInstancedMeshes: this.disposedInstancedMeshes,
    });
  }

  private refreshResourceDebug(): void {
    this.debug = Object.freeze({
      ...EMPTY_DEBUG,
      resources: this.resourceSnapshot(),
    });
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("Rail renderer is disposed.");
  }
}

/**
 * Ordinary playable-surface attachment point.  This is intentionally thin:
 * simulation owns the RailNetworkSnapshot, RailRenderer owns GPU resources,
 * and the host world owns only this adapter's lifecycle.
 */
export class RailRendererIntegrationAdapter {
  readonly renderer: RailRenderer;
  readonly root: THREE.Group;

  public constructor(
    parent: THREE.Object3D,
    options: RailRendererOptions = {},
  ) {
    this.renderer = new RailRenderer(parent, options);
    this.root = this.renderer.root;
    this.root.userData.integrationSurface =
      "ordinary-world-render-loop-adapter";
  }

  public sync(snapshot: RailIntegratedSnapshot): void {
    const elapsedSeconds = snapshot.elapsedSeconds ?? snapshot.elapsed ?? 0;
    this.renderer.sync({
      elapsedSeconds,
      rail: snapshot.rail ?? null,
    });
  }

  public update(elapsedSeconds: number): void {
    this.renderer.update(elapsedSeconds);
  }

  public resolvePick(
    object: THREE.Object3D,
    instanceId?: number,
  ): RailPickTarget | null {
    return this.renderer.resolvePick(object, instanceId);
  }

  public setAuthoringOverlay(
    overlay: RailAuthoringOverlay | null,
  ): void {
    this.renderer.setAuthoringOverlay(overlay);
  }

  public getDebug(): RailRenderDebug {
    return this.renderer.getDebug();
  }

  public dispose(): void {
    this.renderer.dispose();
  }
}

export function attachRailRenderer(
  parent: THREE.Object3D,
  options: RailRendererOptions = {},
): RailRendererIntegrationAdapter {
  return new RailRendererIntegrationAdapter(parent, options);
}
