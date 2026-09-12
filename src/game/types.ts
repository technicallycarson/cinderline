import type {
  CircuitArithmeticOperator,
  CircuitCondition,
  CircuitFrame,
  CircuitMachineControl,
  CircuitMachineFilter,
  CircuitSelector,
  CircuitSignal,
  CircuitSorterRoute,
  CircuitTopology,
  CircuitWire,
  SerializedCircuitNetwork,
} from "./circuit-network";
import type {
  RailNetworkInput,
  RailNetworkSave,
  RailNetworkSnapshot,
} from "./rail-network";

export const SIMULATION_VERSION = 8;
export const FIXED_TICK_RATE = 60;
export const FIXED_TICK_SECONDS = 1 / FIXED_TICK_RATE;

export enum Direction {
  North = 0,
  East = 1,
  South = 2,
  West = 3,
}

export enum TerrainType {
  Ground = 0,
  Water = 1,
}

export type EntityKind =
  | "extractor"
  | "belt"
  | "manifold"
  | "inserter"
  | "smelter"
  | "fabricator"
  | "generator"
  | "storage"
  | "beacon"
  | "gridRelay"
  | "fluidSource"
  | "fluidPump"
  | "fluidPipe"
  | "fluidTank"
  | "fluidProcessor"
  | "constantCombinator"
  | "arithmeticCombinator"
  | "deciderCombinator";

export type FluidEntityKind =
  | "fluidSource"
  | "fluidPump"
  | "fluidPipe"
  | "fluidTank"
  | "fluidProcessor";

export type CircuitEntityKind =
  | "constantCombinator"
  | "arithmeticCombinator"
  | "deciderCombinator";

export type CircuitWireColor = "red" | "green";
export type CircuitConnector = "input" | "output" | "io";

export interface CircuitConnectionPoint {
  readonly entityId: number;
  readonly connector: CircuitConnector;
}

export type CircuitDeviceConfiguration =
  | {
      readonly kind: "constant";
      readonly signals: CircuitFrame;
      readonly enabled?: boolean;
    }
  | {
      readonly kind: "arithmetic";
      readonly left:
        | { readonly kind: "constant"; readonly value: number }
        | { readonly kind: "signal"; readonly selector: CircuitSelector };
      readonly operator: CircuitArithmeticOperator;
      readonly right:
        | { readonly kind: "constant"; readonly value: number }
        | { readonly kind: "signal"; readonly selector: CircuitSelector };
      readonly output: CircuitSignal | { readonly wildcard: "each" };
    }
  | {
      readonly kind: "decider";
      readonly condition: CircuitCondition;
      readonly output: CircuitSignal | { readonly wildcard: "each" };
      readonly outputMode: "one" | "inputCount";
    };

export interface CircuitMachinePortConfiguration {
  readonly enableCondition?: CircuitCondition;
  readonly powerSwitchCondition?: CircuitCondition;
  readonly filter?: CircuitMachineFilter;
  readonly sorterRoutes?: readonly CircuitSorterRoute[];
  readonly sorterFallback?: string;
}

export interface CircuitEndpointSnapshot {
  readonly endpointId: string;
  readonly entityId: number;
  readonly connector: CircuitConnector;
  readonly x: number;
  readonly y: number;
  readonly signals: CircuitFrame;
}

export interface CircuitSimulationSnapshot {
  readonly tick: number;
  readonly workUnits: number;
  readonly topology: CircuitTopology;
  readonly endpoints: readonly CircuitEndpointSnapshot[];
  readonly wires: readonly CircuitWire[];
  readonly devices: SerializedCircuitNetwork["devices"];
  readonly machinePorts: SerializedCircuitNetwork["machinePorts"];
  readonly machineControls: readonly CircuitMachineControl[];
}

/**
 * Fluids use integer milli-units throughout the authoritative simulation.
 * One displayed unit is exactly 1,000 milli-units; no binary floating-point
 * quantity participates in storage, transfer, or recipe conservation.
 */
export type FluidId = "crudeOil" | "refinedFuel";
export type FluidRecipeId = "refineCrude";

export interface FluidBufferState {
  fluidId?: FluidId;
  amountMilli: number;
  capacityMilli: number;
}

export interface FluidEntityState {
  /** Shared transport reservoir used by sources, pumps, pipes, and tanks. */
  buffer?: FluidBufferState;
  /** Processor-only input reservoir. */
  input?: FluidBufferState;
  /** Processor-only product reservoir. */
  output?: FluidBufferState;
  /** Source-only immutable production identity. */
  sourceFluidId?: FluidId;
  /** Processor-only recipe identity. */
  recipeId?: FluidRecipeId;
  /** Integer fixed-step progress owned only by a fluid processor. */
  processTicks: number;
}

export type ResourceId = "iron" | "copper" | "coal" | "stone";

export type ItemId =
  | "ironOre"
  | "copperOre"
  | "coal"
  | "stone"
  | "ironPlate"
  | "copperPlate"
  | "stoneBrick"
  | "ironGear"
  | "copperWire"
  | "circuit"
  | "automationCore";

export type RecipeId =
  | "smeltIron"
  | "smeltCopper"
  | "fireBrick"
  | "ironGear"
  | "copperWire"
  | "circuit"
  | "automationCore";

export type EntityStatus =
  | "idle"
  | "working"
  | "unconfigured"
  | "changingRecipe"
  | "noPower"
  | "noFuel"
  | "noResource"
  | "missingInput"
  | "outputFull"
  | "blocked";

export type Inventory = Partial<Record<ItemId, number>>;
export type InventoryCompartment =
  | "auto"
  | "input"
  | "output"
  | "reclaim"
  | "fuel"
  | "inventory"
  | "belt";

export interface GridPoint {
  x: number;
  y: number;
}

export interface Footprint {
  width: number;
  height: number;
}

export interface ResourceCell extends GridPoint {
  type: ResourceId;
  amount: number;
}

export interface BeltItemState {
  id: number;
  item: ItemId;
  lane: 0 | 1;
  /**
   * Local manifold branch. `0` is A (left of forward), `1` is B (right).
   * Undefined identifies an item entering from the common port.
   */
  port?: 0 | 1;
  /** Normalized distance through this belt tile, from 0 at intake to 1 at exit. */
  progress: number;
}

export const ManifoldMode = {
  Even: "even",
  FavorA: "favorA",
  FavorB: "favorB",
  Extract: "extract",
} as const;

export type ManifoldMode =
  (typeof ManifoldMode)[keyof typeof ManifoldMode];

export interface ManifoldRouting {
  mode: ManifoldMode;
  /**
   * Required only in Extract mode.
   */
  filter?: ItemId;
  /**
   * Local branch that receives matching payloads in Extract mode. Commands may
   * omit this field for backwards compatibility, in which case A (`0`) is
   * selected. Authoritative `ManifoldRoutingState` always stores it.
   */
  extractPort?: 0 | 1;
}

export interface ManifoldRoutingState extends ManifoldRouting {
  /**
   * Canonical Extract output. Matching payloads route exclusively here and
   * every unmatched payload routes exclusively to the opposite local branch.
   */
  extractPort: 0 | 1;
  /**
   * Next preferred split branch for each preserved belt lane. Factorio-style
   * splitter fairness is lane-local: unrelated traffic on one lane must never
   * change the other lane's arbitration.
   */
  splitCursors: [0 | 1, 0 | 1];
  /** Next preferred branch input for each lane when merging to common. */
  mergeCursors: [0 | 1, 0 | 1];
}

/**
 * Serializable authoritative state plus renderer-facing animation values.
 * Inventories are split so animations and information panels never need to
 * infer which part of a machine an item belongs to.
 */
export interface EntityState extends GridPoint {
  id: number;
  kind: EntityKind;
  direction: Direction;
  width: number;
  height: number;
  status: EntityStatus;

  progress: number;
  animationPhase: number;
  powerSatisfaction: number;
  speedMultiplier: number;

  inventory: Inventory;
  input: Inventory;
  output: Inventory;
  /**
   * Ingredients reclaimed during a recipe transition. Reclaim is kept
   * separate from products so source extraction can return stranded materials
   * before normal output without confusing the machine's input gate.
   */
  reclaim: Inventory;
  fuel: Inventory;

  beltItems: BeltItemState[];
  manifoldRouting?: ManifoldRoutingState;
  heldItem?: ItemId;
  /**
   * The transport lane from which an inserter took its current payload.
   * This remains authoritative during the empty return stroke so the arm can
   * retract to the exact pickup contact instead of snapping to tile center.
   */
  heldItemSourceLane?: 0 | 1;
  armProgress: number;
  armReturning: boolean;

  recipeId?: RecipeId;
  activeRecipeId?: RecipeId;
  /**
   * True while an in-flight craft is finishing before a recipe boundary.
   * A missing pendingRecipeId while this is true means queued Auto-smelt.
   */
  recipeChangeQueued: boolean;
  pendingRecipeId?: RecipeId;
  miningResource?: ResourceId;
  fuelEnergyKJ: number;
  generatedPowerKW: number;
  fluidState?: FluidEntityState;
}

export interface ItemPrototype {
  id: ItemId;
  name: string;
  stackSize: number;
  color: string;
  resource?: ResourceId;
}

export interface Ingredient {
  item: ItemId;
  amount: number;
}

export interface RecipePrototype {
  id: RecipeId;
  name: string;
  machine: "smelter" | "fabricator";
  durationSeconds: number;
  ingredients: readonly Ingredient[];
  products: readonly Ingredient[];
}

export interface EntityPrototype {
  id: EntityKind;
  name: string;
  footprint: Footprint;
  color: string;
  accentColor: string;
  inventorySlots: number;
  inputSlots: number;
  outputSlots: number;
  powerDemandKW: number;
  idlePowerKW: number;
  generationCapacityKW: number;
  workSpeed: number;
  beltSpeed: number;
  extractionRadius: number;
  beaconRadius: number;
  beaconSpeedBonus: number;
  fluidCapacityMilli?: number;
  fluidInputCapacityMilli?: number;
  fluidOutputCapacityMilli?: number;
  fluidThroughputMilliPerTick?: number;
  fluidSourceRateMilliPerTick?: number;
}

export interface FluidPrototype {
  id: FluidId;
  name: string;
  color: string;
}

export interface FluidRecipePrototype {
  id: FluidRecipeId;
  name: string;
  input: FluidId;
  output: FluidId;
  batchMilli: number;
  durationTicks: number;
}

export interface ObjectiveDefinition {
  id: string;
  title: string;
  description: string;
  item: ItemId;
  amount: number;
}

export interface ObjectiveState extends ObjectiveDefinition {
  index: number;
  /** Current produced-item count, capped at the objective amount. */
  progress: number;
  complete: boolean;
  locked: boolean;
  completedTick?: number;
}

export type PlacementFailure =
  | "outOfBounds"
  | "occupied"
  | "water"
  | "requiresResource"
  | "invalidRecipe";

export type PlacementResult =
  | { ok: true; entity: EntityState }
  | { ok: false; reason: PlacementFailure; tiles: GridPoint[] };

export type RotationResult =
  | { ok: true; entity: EntityState }
  | { ok: false; reason: "notFound" | PlacementFailure };

export interface TransferResult {
  item?: ItemId;
  moved: number;
}

export type SimulationEventType =
  | "placed"
  | "removed"
  | "rotated"
  | "itemProduced"
  | "itemTransferred"
  | "resourceDepleted"
  | "objectiveCompleted"
  | "powerChanged"
  | "railTopologyChanged"
  | "railTrainAdded"
  | "railTrainRemoved"
  | "railConsistChanged"
  | "railScheduleChanged"
  | "railTrainDeparted"
  | "railTrainArrived"
  | "railPathLost"
  | "railPathRestored"
  | "railFuelExhausted"
  | "railCargoLoaded"
  | "railCargoUnloaded"
  | "railFueled";

export interface SimulationEvent {
  id: number;
  tick: number;
  type: SimulationEventType;
  entityId?: number;
  item?: ItemId;
  amount?: number;
  x?: number;
  y?: number;
  objectiveId?: string;
  value?: number;
  railTrainId?: string;
  railStationId?: string;
  railWagonId?: string;
  railRevision?: number;
}

export interface PowerStats {
  mode: PowerMode;
  demandKW: number;
  capacityKW: number;
  usedKW: number;
  satisfaction: number;
  storedFuelKJ: number;
  disconnectedDemandKW: number;
  disconnectedCapacityKW: number;
  networks: PowerNetworkStats[];
}

export type PowerMode = "local" | "legacyGlobal";

export interface PowerNetworkStats {
  readonly networkId: number;
  readonly relayCount: number;
  readonly consumerCount: number;
  readonly generatorCount: number;
  readonly demandKW: number;
  readonly capacityKW: number;
  readonly usedKW: number;
  readonly satisfaction: number;
}

export interface PowerGridRelayState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly networkId: number;
}

export interface PowerGridLinkState {
  readonly relayAId: number;
  readonly relayBId: number;
}

export interface PowerGridAssignmentState {
  readonly entityId: number;
  readonly role: "consumer" | "generator";
  readonly relayId: number | null;
  readonly networkId: number | null;
}

export interface PowerGridSnapshot {
  readonly mode: PowerMode;
  readonly supplyHalfExtentTiles: number;
  readonly cableReachTiles: number;
  readonly maxLinksPerRelay: number;
  readonly relays: readonly PowerGridRelayState[];
  readonly links: readonly PowerGridLinkState[];
  readonly assignments: readonly PowerGridAssignmentState[];
}

export type PowerRetrofitResult =
  | { ok: true; outcome: "applied" | "alreadyLocal" }
  | {
      ok: false;
      outcome: "uncovered";
      uncoveredEntityIds: readonly number[];
    };

export interface SimulationStats {
  tick: number;
  elapsedSeconds: number;
  entityCount: number;
  entityCounts: Record<EntityKind, number>;
  beltItemCount: number;
  resourcesRemaining: Record<ResourceId, number>;
  produced: Record<ItemId, number>;
  stored: Record<ItemId, number>;
  power: PowerStats;
  fluid: FluidStats;
  objectives: ObjectiveState[];
}

export interface FluidComponentStats {
  componentId: number;
  nodeCount: number;
  storedMilli: number;
  capacityMilli: number;
  fluidIds: FluidId[];
}

export interface FluidStats {
  componentCount: number;
  nodeCount: number;
  storedMilli: Record<FluidId, number>;
  producedMilli: Record<FluidId, number>;
  processedMilli: Record<FluidId, number>;
  transferredMilli: number;
  backpressuredEntityIds: number[];
  components: FluidComponentStats[];
}

export type FluidNodeRole = "buffer" | "input" | "output";

export interface FluidNetworkNodeSnapshot {
  entityId: number;
  role: FluidNodeRole;
  componentId: number;
  x: number;
  y: number;
  fluidId?: FluidId;
  amountMilli: number;
  capacityMilli: number;
  incomingEdgeCount: number;
  outgoingEdgeCount: number;
}

export interface FluidNetworkEdgeSnapshot {
  sourceEntityId: number;
  sourceRole: FluidNodeRole;
  targetEntityId: number;
  targetRole: FluidNodeRole;
  throughputMilliPerTick: number;
}

export interface FluidNetworkSnapshot {
  nodes: FluidNetworkNodeSnapshot[];
  edges: FluidNetworkEdgeSnapshot[];
  components: FluidComponentStats[];
}

export interface RenderSnapshot {
  tick: number;
  elapsedSeconds: number;
  width: number;
  height: number;
  entities: RenderEntityState[];
  resources: ResourceCell[];
  power: PowerStats;
  powerGrid: PowerGridSnapshot;
  fluid: FluidStats;
  fluidNetwork: FluidNetworkSnapshot;
  circuit: CircuitSimulationSnapshot;
  /**
   * Structural authoritative rail state. Presentation may consume this
   * snapshot, but no renderer state is persisted in the simulation.
   */
  rail: RailNetworkSnapshot | null;
  objectives: ObjectiveState[];
}

/**
 * Simulation-authored, renderer-only state. Pickup intent is deliberately not
 * serialized: it is derived from the same compatibility and ordering rules
 * used by the next inserter pickup, so a waiting arm cannot point at a payload
 * the simulation would skip.
 */
export interface RenderEntityState extends EntityState {
  inserterPickupItem?: ItemId;
  inserterPickupLane?: 0 | 1;
  /** Derived assignment; never serialized as authoritative entity state. */
  powerRelayId?: number | null;
  /** A relay's own component ID or a participant's assigned component ID. */
  powerNetworkId?: number | null;
}

export interface SimulationOptions {
  width?: number;
  height?: number;
  seed?: number;
  generateTerrain?: boolean;
  generateResources?: boolean;
  /** Fresh simulations use local relay networks unless explicitly migrated. */
  powerMode?: PowerMode;
}

export type RailStationTransferMode = "load" | "unload" | "both";

/**
 * A rail station never owns factory cargo. This binding identifies the one
 * adjacent authoritative storage entity whose inventory is exchanged with
 * dwelling wagons.
 */
export interface RailStationStorageInterface {
  readonly stationId: string;
  readonly storageEntityId: number;
  readonly mode: RailStationTransferMode;
  readonly transferRate: number;
  readonly itemFilter?: readonly ItemId[];
}

export interface SimulationRailConfiguration {
  readonly network: RailNetworkInput;
  readonly stationInterfaces?: readonly RailStationStorageInterface[];
}

export type RailMutationFailure =
  | "alreadyConfigured"
  | "notConfigured"
  | "invalid"
  | "outOfBounds"
  | "water"
  | "occupied"
  | "storageBinding"
  | "tickLimit";

export type RailMutationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: RailMutationFailure };

export interface PlaceOptions {
  recipeId?: RecipeId;
  fluidId?: FluidId;
  fluidRecipeId?: FluidRecipeId;
}

export type RecipeChangeResult =
  | {
      ok: true;
      outcome: "applied" | "queued" | "unchanged";
      recipeId: RecipeId | null;
    }
  | {
      ok: false;
      outcome: "rejected";
      reason: "notFound" | "notMachine" | "invalidRecipe" | "requiresRecipe";
    };

export interface SerializedSimulation {
  version: number;
  catalogVersion: string;
  width: number;
  height: number;
  seed: number;
  randomState: number;
  tickCount: number;
  accumulatorSeconds: number;
  nextEntityId: number;
  nextBeltItemId: number;
  nextEventId: number;
  terrain: number[];
  resources: ResourceCell[];
  entities: EntityState[];
  produced: Record<ItemId, number>;
  objectiveCompletedTicks: Record<string, number>;
  lastPowerSatisfaction: number;
  powerMode: PowerMode;
  fluidProducedMilli: Record<FluidId, number>;
  fluidProcessedMilli: Record<FluidId, number>;
  fluidTransferredMilli: number;
  circuitNetwork: SerializedCircuitNetwork;
  railNetwork: RailNetworkSave | null;
  railStationInterfaces: RailStationStorageInterface[];
}
