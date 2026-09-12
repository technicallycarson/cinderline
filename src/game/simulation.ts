import {
  BELT_ITEM_SPACING,
  BELT_LANE_CAPACITY,
  CATALOG_VERSION,
  CIRCUIT_ENTITY_KINDS,
  COAL_ENERGY_KJ,
  ENTITY_PROTOTYPES,
  FLUID_IDS,
  FLUID_RECIPES,
  ITEMS,
  ITEM_IDS,
  OBJECTIVES,
  RECIPES,
  RECIPE_IDS,
  RESOURCE_IDS,
  RESOURCE_TO_ITEM,
  SIMULATION_ENTITY_KINDS,
  isCircuitEntityKind,
  isRecipeFor,
  recipesFor,
} from "./catalog";
import {
  POWER_CABLE_REACH_TILES,
  POWER_MAX_LINKS_PER_RELAY,
  POWER_SUPPLY_HALF_EXTENT_TILES,
  createPowerDispatchWorkspace,
  dispatchPreparedPowerInto,
  preparePowerDispatch,
  rebuildPowerTopology,
  type PowerParticipant,
  type PowerTopology,
  type PreparedPowerDispatchPlan,
  type PreparedPowerDispatchWorkspace,
} from "./power-topology";
import {
  buildFluidNetworkSnapshot,
  buildFluidStats,
  cloneFluidEntityState,
  createFluidEntityState,
  isCanonicalFluidEntityState,
  isFluidEntityKind,
  isFluidId,
  isFluidRecipeId,
  stepFluidNetwork,
} from "./fluid-network";
import {
  CircuitNetwork,
  type CircuitFrame,
  type CircuitMachineControl,
  type CircuitMachineWrite,
  type CircuitStepResult,
  type SerializedCircuitNetwork,
} from "./circuit-network";
import {
  RAIL_LIMITS,
  RAIL_MAX_SPEED,
  RailNetwork,
  restoreRailNetwork,
  type RailEvent,
  type RailNetworkInput,
  type RailNetworkSave,
  type RailNetworkSnapshot,
  type RailScheduleStop,
  type RailSegmentInput,
  type RailSignalInput,
  type RailStationInput,
  type RailTrainInput,
  type SerializedRailTrain,
} from "./rail-network";
import {
  CIRCUIT_SORTER_OUTPUT_A,
  CIRCUIT_SORTER_OUTPUT_B,
  circuitDeviceDefinition,
  circuitDeviceId,
  circuitEndpointBinding,
  circuitEndpointBindings,
  circuitEndpointId,
  circuitEndpointPosition,
  circuitMachineConfigurationFromSerialized,
  circuitMachinePortDefinition,
  circuitMachinePortId,
  circuitSensorFrame,
  defaultCircuitDeviceConfiguration,
  deriveCircuitMachineControls,
  isCircuitMachineKind,
  isCircuitWireWithinReach,
  isValidCircuitMachineConfiguration,
  type CircuitEndpointBinding,
} from "./circuit-integration";
import {
  type CircuitConnectionPoint,
  type CircuitDeviceConfiguration,
  type CircuitEndpointSnapshot,
  type CircuitEntityKind,
  type CircuitMachinePortConfiguration,
  type CircuitSimulationSnapshot,
  type CircuitWireColor,
  Direction,
  FIXED_TICK_RATE,
  FIXED_TICK_SECONDS,
  SIMULATION_VERSION,
  TerrainType,
  type BeltItemState,
  type EntityKind,
  type EntityState,
  type FluidBufferState,
  type FluidEntityKind,
  type FluidId,
  type FluidNetworkSnapshot,
  type FluidNodeRole,
  type GridPoint,
  type Inventory,
  type InventoryCompartment,
  type ItemId,
  type ManifoldRouting,
  type ManifoldRoutingState,
  type ObjectiveState,
  type PlaceOptions,
  type PlacementFailure,
  type PlacementResult,
  type PowerGridAssignmentState,
  type PowerGridSnapshot,
  type PowerMode,
  type PowerNetworkStats,
  type PowerRetrofitResult,
  type RailMutationFailure,
  type RailMutationResult,
  type RailStationStorageInterface,
  type PowerStats,
  type RecipeChangeResult,
  type RecipeId,
  type RenderEntityState,
  type RenderSnapshot,
  type ResourceCell,
  type ResourceId,
  type RotationResult,
  type SerializedSimulation,
  type SimulationEvent,
  type SimulationOptions,
  type SimulationRailConfiguration,
  type SimulationStats,
  type TransferResult,
} from "./types";

const EPSILON = 1e-9;
const ACCUMULATOR_FRACTION_SCALE = 1_000_000_000_000;
const BELT_END = 1 - 1e-7;
const BELT_OUTPUT_CONTACT = BELT_END;
const MAX_TICK_SECONDS = 60 * 60;
const DEFAULT_WIDTH = 64;
const DEFAULT_HEIGHT = 48;
const DEFAULT_SEED = 0xc1de_1eaf;
const MAX_ENTITY_ID = 0x7fff_ffff;
const MAX_UINT32 = 0xffff_ffff;
const MAX_WORLD_DIMENSION = 512;
const MAX_WORLD_AREA = MAX_WORLD_DIMENSION * MAX_WORLD_DIMENSION;
const RAIL_COAL_FUEL_MILLI = COAL_ENERGY_KJ;
const ENTITY_STATUSES = new Set([
  "idle",
  "working",
  "unconfigured",
  "changingRecipe",
  "noPower",
  "noFuel",
  "noResource",
  "missingInput",
  "outputFull",
  "blocked",
]);

interface PlacementCheckSuccess {
  ok: true;
  tiles: GridPoint[];
}

interface PlacementCheckFailure {
  ok: false;
  reason: PlacementFailure;
  tiles: GridPoint[];
}

type PlacementCheck = PlacementCheckSuccess | PlacementCheckFailure;

interface TakenItem {
  item: ItemId;
  compartment: InventoryCompartment;
  beltItem?: BeltItemState;
  heldItemSourceLane?: 0 | 1;
  inserterArmReturning?: boolean;
}

interface InserterPickupCandidate {
  source: EntityState;
  item: ItemId;
  sourceLane?: 0 | 1;
  ready: boolean;
}

type LegacyScalarManifoldRoutingState = ManifoldRouting & {
  splitCursor: 0 | 1;
  mergeCursor: 0 | 1;
};

type LegacyEntityState = Omit<
  EntityState,
  "manifoldRouting" | "reclaim" | "recipeChangeQueued" | "pendingRecipeId"
> & {
  manifoldRouting?: LegacyScalarManifoldRoutingState;
};

type LegacySerializedSimulationBase<T> = Omit<
  SerializedSimulation,
  | "version"
  | "catalogVersion"
  | "entities"
  | "powerMode"
  | "fluidProducedMilli"
  | "fluidProcessedMilli"
  | "fluidTransferredMilli"
  | "circuitNetwork"
  | "railNetwork"
  | "railStationInterfaces"
> & {
  entities: T[];
};

type LegacySerializedSimulationV1 =
  LegacySerializedSimulationBase<LegacyEntityState> & {
  version: 1;
  catalogVersion: "cinderline-1";
};

type LegacySerializedSimulationV2 =
  LegacySerializedSimulationBase<LegacyEntityState> & {
  version: 2;
  catalogVersion: "cinderline-2";
};

type LegacyEntityStateV3 = Omit<
  EntityState,
  "reclaim" | "recipeChangeQueued" | "pendingRecipeId"
>;

type LegacySerializedSimulationV3 =
  LegacySerializedSimulationBase<LegacyEntityStateV3> & {
    version: 3;
    catalogVersion: "cinderline-3";
  };

type LegacySerializedSimulationV4 =
  LegacySerializedSimulationBase<EntityState> & {
    version: 4;
    catalogVersion: "cinderline-4";
  };

type LegacyEntityStateV5 = Omit<
  EntityState,
  "kind" | "fluidState"
> & {
  kind: Exclude<EntityKind, FluidEntityKind>;
};

type LegacySerializedSimulationV5 =
  LegacySerializedSimulationBase<LegacyEntityStateV5> & {
    version: 5;
    catalogVersion: "cinderline-5";
    powerMode: PowerMode;
  };

type LegacyEntityStateV6 = Omit<EntityState, "kind"> & {
  kind: Exclude<EntityKind, CircuitEntityKind>;
};

type LegacySerializedSimulationV6 =
  Omit<
    SerializedSimulation,
    | "version"
    | "catalogVersion"
    | "entities"
    | "circuitNetwork"
    | "railNetwork"
    | "railStationInterfaces"
  > & {
    version: 6;
    catalogVersion: "cinderline-6";
    entities: LegacyEntityStateV6[];
  };

type LegacySerializedSimulationV7 = Omit<
  SerializedSimulation,
  "version" | "catalogVersion" | "railNetwork" | "railStationInterfaces"
> & {
  version: 7;
  catalogVersion: "cinderline-7";
};

type AnySimulationSnapshot =
  | SerializedSimulation
  | LegacySerializedSimulationV1
  | LegacySerializedSimulationV2
  | LegacySerializedSimulationV3
  | LegacySerializedSimulationV4
  | LegacySerializedSimulationV5
  | LegacySerializedSimulationV6
  | LegacySerializedSimulationV7
  | string;

interface LocalPowerCache {
  readonly topology: PowerTopology;
  readonly plan: PreparedPowerDispatchPlan;
  readonly workspace: PreparedPowerDispatchWorkspace;
  readonly consumerDemands: Float64Array;
  readonly generatorCapacities: Float64Array;
  readonly relayNetworkById: ReadonlyMap<number, number>;
  readonly assignmentByEntityId: ReadonlyMap<
    number,
    { readonly relayId: number | null; readonly networkId: number | null }
  >;
  readonly networkRelayCounts: ReadonlyMap<number, number>;
  readonly networkConsumerCounts: ReadonlyMap<number, number>;
  readonly networkGeneratorCounts: ReadonlyMap<number, number>;
}

interface StagedRailState {
  readonly network: RailNetwork;
  readonly interfaces: Map<string, RailStationStorageInterface>;
  readonly tiles: Set<string>;
}

class RailIntegrationError extends Error {
  constructor(
    readonly reason: RailMutationFailure,
    message: string,
  ) {
    super(message);
  }
}

type ManifoldEntry = "common" | 0 | 1;

const DEFAULT_MANIFOLD_ROUTING: Readonly<ManifoldRoutingState> = {
  mode: "even",
  extractPort: 0,
  splitCursors: [0, 1],
  mergeCursors: [0, 1],
};

export function directionVector(direction: Direction): GridPoint {
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

export function oppositeDirection(direction: Direction): Direction {
  return ((direction + 2) % 4) as Direction;
}

export function rotateDirection(
  direction: Direction,
  clockwise = true,
): Direction {
  return ((direction + (clockwise ? 1 : 3)) % 4) as Direction;
}

export function footprintFor(
  kind: EntityKind,
  direction: Direction,
): { width: number; height: number } {
  const base = ENTITY_PROTOTYPES[kind].footprint;
  if (direction === Direction.East || direction === Direction.West) {
    return { width: base.height, height: base.width };
  }
  return { width: base.width, height: base.height };
}

export function footprintTiles(
  kind: EntityKind,
  x: number,
  y: number,
  direction: Direction,
): GridPoint[] {
  const footprint = footprintFor(kind, direction);
  const tiles: GridPoint[] = [];
  for (let dy = 0; dy < footprint.height; dy += 1) {
    for (let dx = 0; dx < footprint.width; dx += 1) {
      tiles.push({ x: x + dx, y: y + dy });
    }
  }
  return tiles;
}

function emptyItemRecord(): Record<ItemId, number> {
  const record = {} as Record<ItemId, number>;
  for (const item of ITEM_IDS) record[item] = 0;
  return record;
}

function emptyResourceRecord(): Record<ResourceId, number> {
  const record = {} as Record<ResourceId, number>;
  for (const resource of RESOURCE_IDS) record[resource] = 0;
  return record;
}

function emptyFluidRecord(): Record<FluidId, number> {
  const record = {} as Record<FluidId, number>;
  for (const fluidId of FLUID_IDS) record[fluidId] = 0;
  return record;
}

function emptyEntityCountRecord(): Record<EntityKind, number> {
  const record = {} as Record<EntityKind, number>;
  for (const kind of SIMULATION_ENTITY_KINDS) record[kind] = 0;
  return record;
}

function emptyPowerStats(mode: PowerMode): PowerStats {
  return {
    mode,
    demandKW: 0,
    capacityKW: 0,
    usedKW: 0,
    satisfaction: 1,
    storedFuelKJ: 0,
    disconnectedDemandKW: 0,
    disconnectedCapacityKW: 0,
    networks: [],
  };
}

function clonePowerStats(power: PowerStats): PowerStats {
  return {
    ...power,
    networks: power.networks.map((network) => ({ ...network })),
  };
}

function cloneInventory(inventory: Inventory): Inventory {
  const clone: Inventory = {};
  for (const item of ITEM_IDS) {
    const amount = inventory[item] ?? 0;
    if (amount > 0) clone[item] = amount;
  }
  return clone;
}

function isSerializedInventory(inventory: unknown): inventory is Inventory {
  if (
    !inventory ||
    typeof inventory !== "object" ||
    Array.isArray(inventory)
  ) {
    return false;
  }
  return Object.entries(inventory).every(
    ([item, amount]) =>
      ITEM_IDS.includes(item as ItemId) &&
      typeof amount === "number" &&
      Number.isSafeInteger(amount) &&
      amount > 0,
  );
}

function isSerializedProducedRecord(
  produced: unknown,
): produced is Record<ItemId, number> {
  if (
    !produced ||
    typeof produced !== "object" ||
    Array.isArray(produced)
  ) {
    return false;
  }
  const keys = Reflect.ownKeys(produced);
  return (
    keys.length === ITEM_IDS.length &&
    keys.every((item) => {
      if (
        typeof item !== "string" ||
        !ITEM_IDS.includes(item as ItemId)
      ) {
        return false;
      }
      const amount = (produced as Record<string, unknown>)[item];
      return (
        typeof amount === "number" &&
        Number.isSafeInteger(amount) &&
        amount >= 0
      );
    })
  );
}

function isSerializedFluidRecord(
  value: unknown,
): value is Record<FluidId, number> {
  if (!isPlainRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === FLUID_IDS.length &&
    keys.every((fluidId) => {
      if (
        typeof fluidId !== "string" ||
        !FLUID_IDS.includes(fluidId as FluidId)
      ) {
        return false;
      }
      const amount = value[fluidId];
      return (
        typeof amount === "number" &&
        Number.isSafeInteger(amount) &&
        amount >= 0
      );
    })
  );
}

function isSafelyIncrementablePositiveInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    Number.isSafeInteger(value + 1)
  );
}

function isSafelyIncrementableNonNegativeInteger(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    Number.isSafeInteger(value + 1)
  );
}

function isPositiveUint32(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_UINT32
  );
}

function isUint32(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_UINT32
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isValidObjectiveCompletedTicks(
  value: unknown,
  tickCount: number,
): value is Record<string, number> {
  if (!isPlainRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length > OBJECTIVES.length ||
    keys.some((key) => typeof key !== "string")
  ) {
    return false;
  }

  const completed = new Set(keys as string[]);
  let previousTick = 0;
  for (let index = 0; index < OBJECTIVES.length; index += 1) {
    const objective = OBJECTIVES[index]!;
    const shouldBeCompleted = index < keys.length;
    if (completed.has(objective.id) !== shouldBeCompleted) return false;
    if (!shouldBeCompleted) continue;
    const completedTick = value[objective.id];
    if (
      typeof completedTick !== "number" ||
      !Number.isSafeInteger(completedTick) ||
      completedTick < 0 ||
      completedTick > tickCount ||
      completedTick < previousTick
    ) {
      return false;
    }
    previousTick = completedTick;
  }
  return true;
}

function checkedIntegerSum(
  left: number,
  right: number,
  message: string,
): number {
  const sum = left + right;
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    !Number.isSafeInteger(sum)
  ) {
    throw new Error(message);
  }
  return sum;
}

function checkedIntegerProduct(
  left: number,
  right: number,
  message: string,
): number {
  const product = left * right;
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    !Number.isSafeInteger(product)
  ) {
    throw new Error(message);
  }
  return product;
}

/**
 * Saves expose the sub-tick remainder, so mathematically equivalent frame
 * groupings must not differ by a few binary floating-point ulps. Quantizing a
 * trillionth of a fixed tick is more than 100,000× finer than the simulation's
 * step epsilon and occurs only at persistence boundaries; live step counts are
 * therefore unchanged.
 */
function canonicalAccumulatorSeconds(accumulatorSeconds: number): number {
  if (Math.abs(accumulatorSeconds) < EPSILON) return 0;
  const fixedTickFraction = accumulatorSeconds / FIXED_TICK_SECONDS;
  const canonicalFraction =
    Math.round(fixedTickFraction * ACCUMULATOR_FRACTION_SCALE) /
    ACCUMULATOR_FRACTION_SCALE;
  return canonicalFraction * FIXED_TICK_SECONDS;
}

function cloneEntity(entity: EntityState): EntityState {
  const { fluidState, ...base } = entity;
  return {
    ...base,
    inventory: cloneInventory(entity.inventory),
    input: cloneInventory(entity.input),
    output: cloneInventory(entity.output),
    reclaim: cloneInventory(entity.reclaim),
    fuel: cloneInventory(entity.fuel),
    beltItems: entity.beltItems.map((item) => ({ ...item })),
    manifoldRouting: entity.manifoldRouting
      ? {
          ...entity.manifoldRouting,
          splitCursors: [...entity.manifoldRouting.splitCursors],
          mergeCursors: [...entity.manifoldRouting.mergeCursors],
        }
      : undefined,
    ...(fluidState
      ? { fluidState: cloneFluidEntityState(fluidState) }
      : {}),
  };
}

function isBranch(value: unknown): value is 0 | 1 {
  return (
    (value === 0 && !Object.is(value, -0)) ||
    value === 1
  );
}

function isManifoldRouting(
  routing: unknown,
): routing is ManifoldRouting {
  if (!routing || typeof routing !== "object") return false;
  const candidate = routing as Partial<ManifoldRouting>;
  if (
    candidate.mode !== "even" &&
    candidate.mode !== "favorA" &&
    candidate.mode !== "favorB" &&
    candidate.mode !== "extract"
  ) {
    return false;
  }
  if (candidate.mode === "extract") {
    if (candidate.filter === undefined || !ITEM_IDS.includes(candidate.filter)) {
      return false;
    }
  } else if (candidate.filter !== undefined) {
    return false;
  }
  return (
    candidate.extractPort === undefined ||
    isBranch(candidate.extractPort)
  );
}

function isManifoldRoutingState(
  routing: unknown,
): routing is ManifoldRoutingState {
  if (!isManifoldRouting(routing)) return false;
  const candidate = routing as Partial<ManifoldRoutingState>;
  return (
    isBranch(candidate.extractPort) &&
    Array.isArray(candidate.splitCursors) &&
    candidate.splitCursors.length === 2 &&
    candidate.splitCursors.every(isBranch) &&
    Array.isArray(candidate.mergeCursors) &&
    candidate.mergeCursors.length === 2 &&
    candidate.mergeCursors.every(isBranch)
  );
}

/**
 * Version 5 shipped before Extract's matching branch became selectable. A
 * missing field is therefore a legitimate historical state and migrates to A.
 * An explicitly present invalid value remains untouched so strict restore
 * validation can reject it rather than silently repairing corruption.
 */
function withManifoldExtractPortDefault(
  entity: EntityState,
): EntityState {
  const routing = entity.manifoldRouting;
  if (
    entity.kind !== "manifold" ||
    !routing ||
    Object.prototype.hasOwnProperty.call(routing, "extractPort")
  ) {
    return entity;
  }
  return {
    ...entity,
    manifoldRouting: {
      ...routing,
      extractPort: 0,
    },
  };
}

function manifoldExtractPortForItem(
  routing: Pick<ManifoldRoutingState, "filter" | "extractPort">,
  item: ItemId,
): 0 | 1 {
  return item === routing.filter
    ? routing.extractPort
    : routing.extractPort === 0
      ? 1
      : 0;
}

function manifoldExtractItemBelongsOnPort(
  routing: Pick<ManifoldRoutingState, "filter" | "extractPort">,
  item: ItemId,
  port: 0 | 1,
): boolean {
  return manifoldExtractPortForItem(routing, item) === port;
}

function withRecipeTransitionDefaults<T extends object>(
  entity: T,
): Omit<T, "reclaim" | "recipeChangeQueued" | "pendingRecipeId"> & {
  reclaim: Inventory;
  recipeChangeQueued: false;
} {
  const {
    reclaim: _legacyReclaim,
    recipeChangeQueued: _legacyQueue,
    pendingRecipeId: _legacyPending,
    ...legacyEntity
  } = entity as T & {
    reclaim?: unknown;
    recipeChangeQueued?: unknown;
    pendingRecipeId?: unknown;
  };
  return {
    ...legacyEntity,
    reclaim: {},
    recipeChangeQueued: false,
  };
}

function legacyFluidFields(): Pick<
  SerializedSimulation,
  "fluidProducedMilli" | "fluidProcessedMilli" | "fluidTransferredMilli"
> {
  return {
    fluidProducedMilli: emptyFluidRecord(),
    fluidProcessedMilli: emptyFluidRecord(),
    fluidTransferredMilli: 0,
  };
}

function legacyRailFields(): Pick<
  SerializedSimulation,
  "railNetwork" | "railStationInterfaces"
> {
  return {
    railNetwork: null,
    railStationInterfaces: [],
  };
}

function legacyCircuitNetworkSnapshot(
  tick: number,
  entities: readonly {
    readonly id: number;
    readonly kind: EntityKind;
  }[],
): SerializedCircuitNetwork {
  const network = new CircuitNetwork();
  for (const entity of [...entities].sort(
    (left, right) => left.id - right.id,
  )) {
    for (const binding of circuitEndpointBindings(
      entity.id,
      entity.kind,
    )) {
      network.addEndpoint(binding.endpointId);
    }
    if (isCircuitMachineKind(entity.kind)) {
      const port = circuitMachinePortDefinition(
        entity.id,
        entity.kind,
      );
      if (!port) {
        throw new Error("Legacy circuit port migration failed.");
      }
      network.registerMachinePort(port);
    }
  }
  const empty = network.serialize();
  return CircuitNetwork.restore({
    ...empty,
    tick,
  }).serialize();
}

function assertLegacySnapshotHasNoFluidState(
  entities: readonly { readonly kind: EntityKind; readonly fluidState?: unknown }[],
): void {
  if (
    entities.some(
      (entity) =>
        isFluidEntityKind(entity.kind) ||
        Object.prototype.hasOwnProperty.call(entity, "fluidState"),
    )
  ) {
    throw new Error("Legacy saves cannot contain fluid entity state.");
  }
}

function migrateSimulationSnapshot(
  snapshot:
    | SerializedSimulation
    | LegacySerializedSimulationV1
    | LegacySerializedSimulationV2
    | LegacySerializedSimulationV3
    | LegacySerializedSimulationV4
    | LegacySerializedSimulationV5
    | LegacySerializedSimulationV6
    | LegacySerializedSimulationV7,
): SerializedSimulation {
  if (
    snapshot.version === SIMULATION_VERSION &&
    snapshot.catalogVersion === CATALOG_VERSION
  ) {
    return snapshot;
  }
  if (
    snapshot.version === 1 &&
    snapshot.catalogVersion === "cinderline-1"
  ) {
    assertLegacySnapshotHasNoFluidState(snapshot.entities);
    if (snapshot.entities.some((entity) => entity.kind === "gridRelay")) {
      throw new Error("Legacy saves cannot contain local grid relays.");
    }
    return {
      ...snapshot,
      version: SIMULATION_VERSION,
      catalogVersion: CATALOG_VERSION,
      powerMode: "legacyGlobal",
      ...legacyFluidFields(),
      ...legacyRailFields(),
      circuitNetwork: legacyCircuitNetworkSnapshot(
        snapshot.tickCount,
        snapshot.entities,
      ),
      entities: snapshot.entities.map((entity) => {
        const migrated = withRecipeTransitionDefaults(entity);
        return {
          ...migrated,
          beltItems: migrated.beltItems.map((item) => {
            const migratedItem: BeltItemState = {
              id: item.id,
              item: item.item,
              lane: item.lane,
              progress: item.progress,
            };
            return migratedItem;
          }),
          manifoldRouting: undefined,
        };
      }),
    };
  }
  if (
    snapshot.version === 2 &&
    snapshot.catalogVersion === "cinderline-2"
  ) {
    assertLegacySnapshotHasNoFluidState(snapshot.entities);
    if (snapshot.entities.some((entity) => entity.kind === "gridRelay")) {
      throw new Error("Legacy saves cannot contain local grid relays.");
    }
    return {
      ...snapshot,
      version: SIMULATION_VERSION,
      catalogVersion: CATALOG_VERSION,
      powerMode: "legacyGlobal",
      ...legacyFluidFields(),
      ...legacyRailFields(),
      circuitNetwork: legacyCircuitNetworkSnapshot(
        snapshot.tickCount,
        snapshot.entities,
      ),
      entities: snapshot.entities.map((entity) => {
        const migrated = withRecipeTransitionDefaults(entity);
        const routing = entity.manifoldRouting as
          | LegacyScalarManifoldRoutingState
          | undefined;
        if (entity.kind !== "manifold" || !routing) {
          return {
            ...migrated,
            manifoldRouting: undefined,
          };
        }
        const splitCursor = routing.splitCursor;
        const mergeCursor = routing.mergeCursor;
        return {
          ...migrated,
          manifoldRouting: {
            mode: routing.mode,
            ...(routing.mode === "extract" ? { filter: routing.filter } : {}),
            extractPort: 0,
            splitCursors: [
              splitCursor,
              splitCursor === 0 ? 1 : 0,
            ],
            mergeCursors: [
              mergeCursor,
              mergeCursor === 0 ? 1 : 0,
            ],
          },
        };
      }),
    } as SerializedSimulation;
  }
  if (
    snapshot.version === 3 &&
    snapshot.catalogVersion === "cinderline-3"
  ) {
    assertLegacySnapshotHasNoFluidState(snapshot.entities);
    if (snapshot.entities.some((entity) => entity.kind === "gridRelay")) {
      throw new Error("Legacy saves cannot contain local grid relays.");
    }
    return {
      ...snapshot,
      version: SIMULATION_VERSION,
      catalogVersion: CATALOG_VERSION,
      powerMode: "legacyGlobal",
      ...legacyFluidFields(),
      ...legacyRailFields(),
      circuitNetwork: legacyCircuitNetworkSnapshot(
        snapshot.tickCount,
        snapshot.entities,
      ),
      entities: snapshot.entities.map((entity) =>
        withManifoldExtractPortDefault(
          withRecipeTransitionDefaults(entity) as EntityState,
        ),
      ),
    };
  }
  if (
    snapshot.version === 4 &&
    snapshot.catalogVersion === "cinderline-4"
  ) {
    assertLegacySnapshotHasNoFluidState(snapshot.entities);
    if (snapshot.entities.some((entity) => entity.kind === "gridRelay")) {
      throw new Error("Legacy saves cannot contain local grid relays.");
    }
    return {
      ...snapshot,
      version: SIMULATION_VERSION,
      catalogVersion: CATALOG_VERSION,
      powerMode: "legacyGlobal",
      ...legacyFluidFields(),
      ...legacyRailFields(),
      circuitNetwork: legacyCircuitNetworkSnapshot(
        snapshot.tickCount,
        snapshot.entities,
      ),
      entities: snapshot.entities.map((entity) =>
        withManifoldExtractPortDefault(cloneEntity(entity)),
      ),
    };
  }
  if (
    snapshot.version === 5 &&
    snapshot.catalogVersion === "cinderline-5"
  ) {
    assertLegacySnapshotHasNoFluidState(
      snapshot.entities as readonly EntityState[],
    );
    return {
      ...snapshot,
      version: SIMULATION_VERSION,
      catalogVersion: CATALOG_VERSION,
      ...legacyFluidFields(),
      ...legacyRailFields(),
      circuitNetwork: legacyCircuitNetworkSnapshot(
        snapshot.tickCount,
        snapshot.entities as readonly EntityState[],
      ),
      entities: snapshot.entities.map((entity) =>
        withManifoldExtractPortDefault(
          cloneEntity(entity as EntityState),
        ),
      ),
    };
  }
  if (
    snapshot.version === 6 &&
    snapshot.catalogVersion === "cinderline-6"
  ) {
    if (
      snapshot.entities.some((entity) =>
        CIRCUIT_ENTITY_KINDS.includes(
          entity.kind as CircuitEntityKind,
        ),
      )
    ) {
      throw new Error("Version 6 saves cannot contain circuit entities.");
    }
    return {
      ...snapshot,
      version: SIMULATION_VERSION,
      catalogVersion: CATALOG_VERSION,
      ...legacyRailFields(),
      circuitNetwork: legacyCircuitNetworkSnapshot(
        snapshot.tickCount,
        snapshot.entities as readonly EntityState[],
      ),
      entities: snapshot.entities.map((entity) =>
        cloneEntity(entity as EntityState),
      ),
    };
  }
  if (
    snapshot.version === 7 &&
    snapshot.catalogVersion === "cinderline-7"
  ) {
    return {
      ...snapshot,
      version: SIMULATION_VERSION,
      catalogVersion: CATALOG_VERSION,
      ...legacyRailFields(),
    };
  }
  if (snapshot.version !== SIMULATION_VERSION) {
    throw new Error(`Unsupported simulation version: ${snapshot.version}.`);
  }
  throw new Error(
    `Save catalog ${snapshot.catalogVersion} does not match ${CATALOG_VERSION}.`,
  );
}

function inventoryCount(inventory: Inventory, item: ItemId): number {
  return inventory[item] ?? 0;
}

function inventoryTotal(inventory: Inventory): number {
  let total = 0;
  for (const item of ITEM_IDS) total += inventoryCount(inventory, item);
  return total;
}

function inventorySlotsUsed(inventory: Inventory): number {
  let slots = 0;
  for (const item of ITEM_IDS) {
    const amount = inventoryCount(inventory, item);
    if (amount > 0) slots += Math.ceil(amount / ITEMS[item].stackSize);
  }
  return slots;
}

function inventoryIsEmpty(inventory: Inventory): boolean {
  return Object.keys(inventory).length === 0;
}

function railTileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function cloneRailStationInterface(
  binding: RailStationStorageInterface,
): RailStationStorageInterface {
  return {
    stationId: binding.stationId,
    storageEntityId: binding.storageEntityId,
    mode: binding.mode,
    transferRate: binding.transferRate,
    ...(binding.itemFilter
      ? { itemFilter: Object.freeze([...binding.itemFilter]) }
      : {}),
  };
}

function normalizeRailStationInterfaces(
  bindings: readonly RailStationStorageInterface[],
): RailStationStorageInterface[] | null {
  if (bindings.length > RAIL_LIMITS.maxStations) return null;
  const normalized: RailStationStorageInterface[] = [];
  const stationIds = new Set<string>();
  const storageIds = new Set<number>();
  for (const binding of bindings) {
    if (
      !isPlainRecord(binding) ||
      typeof binding.stationId !== "string" ||
      binding.stationId.length === 0 ||
      !Number.isSafeInteger(binding.storageEntityId) ||
      binding.storageEntityId <= 0 ||
      (binding.mode !== "load" &&
        binding.mode !== "unload" &&
        binding.mode !== "both") ||
      !Number.isSafeInteger(binding.transferRate) ||
      binding.transferRate <= 0 ||
      binding.transferRate > RAIL_LIMITS.maxUnits ||
      stationIds.has(binding.stationId) ||
      storageIds.has(binding.storageEntityId)
    ) {
      return null;
    }
    let itemFilter: ItemId[] | undefined;
    if (binding.itemFilter !== undefined) {
      if (
        !Array.isArray(binding.itemFilter) ||
        binding.itemFilter.length === 0 ||
        binding.itemFilter.some(
          (itemId) => !ITEM_IDS.includes(itemId),
        )
      ) {
        return null;
      }
      itemFilter = [...new Set(binding.itemFilter)].sort();
    }
    stationIds.add(binding.stationId);
    storageIds.add(binding.storageEntityId);
    normalized.push({
      stationId: binding.stationId,
      storageEntityId: binding.storageEntityId,
      mode: binding.mode,
      transferRate: binding.transferRate,
      ...(itemFilter ? { itemFilter } : {}),
    });
  }
  normalized.sort((left, right) =>
    left.stationId.localeCompare(right.stationId),
  );
  return normalized;
}

function isCanonicalRailStationInterfaces(
  value: unknown,
): value is RailStationStorageInterface[] {
  if (!Array.isArray(value)) return false;
  const normalized = normalizeRailStationInterfaces(
    value as RailStationStorageInterface[],
  );
  if (!normalized || normalized.length !== value.length) return false;
  return value.every((binding, index) => {
    if (!isPlainRecord(binding)) return false;
    const required = [
      "stationId",
      "storageEntityId",
      "mode",
      "transferRate",
    ];
    const allowed = new Set([
      ...required,
      "itemFilter",
    ]);
    const keys = Reflect.ownKeys(binding);
    if (
      keys.some((key) => typeof key !== "string") ||
      required.some(
        (key) => !Object.prototype.hasOwnProperty.call(binding, key),
      ) ||
      keys.some((key) => !allowed.has(key as string))
    ) {
      return false;
    }
    const canonical = normalized[index]!;
    return (
      binding.stationId === canonical.stationId &&
      binding.storageEntityId === canonical.storageEntityId &&
      binding.mode === canonical.mode &&
      binding.transferRate === canonical.transferRate &&
      JSON.stringify(binding.itemFilter) ===
        JSON.stringify(canonical.itemFilter)
    );
  });
}

function validateEntityInventoryOwnership(entity: EntityState): void {
  const isMachine =
    entity.kind === "smelter" || entity.kind === "fabricator";
  const ownsInventory = entity.kind === "storage";
  const ownsInput = isMachine;
  const ownsOutput = entity.kind === "extractor" || isMachine;
  const ownsReclaim = isMachine;
  const ownsFuel = entity.kind === "generator";

  if (
    (!ownsInventory && !inventoryIsEmpty(entity.inventory)) ||
    (!ownsInput && !inventoryIsEmpty(entity.input)) ||
    (!ownsOutput && !inventoryIsEmpty(entity.output)) ||
    (!ownsReclaim && !inventoryIsEmpty(entity.reclaim)) ||
    (!ownsFuel && !inventoryIsEmpty(entity.fuel))
  ) {
    throw new Error("Save contains inventory state on another entity.");
  }

  const prototype = ENTITY_PROTOTYPES[entity.kind];
  if (
    (ownsInventory &&
      inventorySlotsUsed(entity.inventory) > prototype.inventorySlots) ||
    (ownsInput &&
      inventorySlotsUsed(entity.input) > prototype.inputSlots) ||
    (ownsOutput &&
      inventorySlotsUsed(entity.output) > prototype.outputSlots) ||
    (ownsFuel && inventorySlotsUsed(entity.fuel) > 1)
  ) {
    throw new Error("Save exceeds inventory compartment capacity.");
  }

  if (
    ownsFuel &&
    Object.keys(entity.fuel).some((item) => item !== "coal")
  ) {
    throw new Error("Save contains invalid generator fuel.");
  }
  // Reclaim intentionally has no slot cap: repeated legitimate recipe
  // transitions may accumulate more than one input compartment can hold.
}

function canInventoryAccept(
  inventory: Inventory,
  item: ItemId,
  amount: number,
  slots: number,
): boolean {
  if (amount <= 0 || slots <= 0) return false;
  const copy = cloneInventory(inventory);
  copy[item] = inventoryCount(copy, item) + amount;
  return inventorySlotsUsed(copy) <= slots;
}

function addToInventory(
  inventory: Inventory,
  item: ItemId,
  amount: number,
): void {
  if (amount <= 0) return;
  inventory[item] = checkedIntegerSum(
    inventoryCount(inventory, item),
    amount,
    "Inventory count exceeds safe integer range.",
  );
}

function removeFromInventory(
  inventory: Inventory,
  item: ItemId,
  amount: number,
): boolean {
  const current = inventoryCount(inventory, item);
  if (amount <= 0 || current < amount) return false;
  const remaining = current - amount;
  if (remaining > 0) inventory[item] = remaining;
  else delete inventory[item];
  return true;
}

function hasIngredients(
  inventory: Inventory,
  recipeId: RecipeId,
): boolean {
  return RECIPES[recipeId].ingredients.every(
    ({ item, amount }) => inventoryCount(inventory, item) >= amount,
  );
}

function inventoryToFullRecord(inventory: Inventory): Record<ItemId, number> {
  const record = emptyItemRecord();
  for (const item of ITEM_IDS) record[item] = inventoryCount(inventory, item);
  return record;
}

function normalizeSeed(seed: number): number {
  const normalized = Math.trunc(seed) >>> 0;
  return normalized === 0 ? DEFAULT_SEED : normalized;
}

function stableResourceSort(a: ResourceCell, b: ResourceCell): number {
  return a.y - b.y || a.x - b.x || a.type.localeCompare(b.type);
}

function stableBeltItemSort(a: BeltItemState, b: BeltItemState): number {
  return b.progress - a.progress || a.id - b.id;
}

function serializedRailTrainInput(
  train: SerializedRailTrain,
  schedule: readonly RailScheduleStop[] = train.schedule,
): RailTrainInput {
  return {
    id: train.id,
    currentSegmentId: train.currentSegmentId,
    cars: train.cars.map((car) =>
      car.kind === "locomotive"
        ? {
            id: car.id,
            kind: "locomotive" as const,
            fuelCapacityMilli: car.fuelCapacityMilli,
            fuelMilli: car.fuelMilli,
          }
        : {
            id: car.id,
            kind: "cargo-wagon" as const,
            capacity: car.capacity,
            cargo: car.cargo.map((stack) => ({ ...stack })),
          },
    ),
    schedule: schedule.map((stop) => ({
      stationId: stop.stationId,
      wait: { ...stop.wait },
    })),
  };
}

function railCarsContainCargo(
  cars: RailTrainInput["cars"],
): boolean {
  return cars.some(
    (car) =>
      car.kind === "cargo-wagon" &&
      (car.cargo?.some((stack) => stack.count > 0) ?? false),
  );
}

function railCarFuelTotal(cars: RailTrainInput["cars"]): number {
  return cars.reduce(
    (sum, car) =>
      car.kind === "locomotive" ? sum + car.fuelMilli : sum,
    0,
  );
}

export class FactorySimulation {
  readonly width: number;
  readonly height: number;
  readonly seed: number;

  private terrain: Uint8Array;
  private resources = new Map<string, ResourceCell>();
  private entities = new Map<number, EntityState>();
  private occupancy: Int32Array;

  private randomState: number;
  private _tickCount = 0;
  private accumulatorSeconds = 0;
  private nextEntityId = 1;
  private nextBeltItemId = 1;
  private nextEventId = 1;

  private produced: Record<ItemId, number> = emptyItemRecord();
  private fluidProducedMilli: Record<FluidId, number> = emptyFluidRecord();
  private fluidProcessedMilli: Record<FluidId, number> = emptyFluidRecord();
  private fluidTransferredMilli = 0;
  private fluidBackpressuredEntityIds: number[] = [];
  private circuitNetwork = new CircuitNetwork();
  private circuitControls = new Map<number, CircuitMachineControl>();
  private circuitPortConfigurations = new Map<
    number,
    CircuitMachinePortConfiguration
  >();
  private circuitWorkUnits = 0;
  private railNetwork: RailNetwork | null = null;
  private railStationInterfaces = new Map<
    string,
    RailStationStorageInterface
  >();
  private serializeCalls = 0;
  private railTiles = new Set<string>();
  private objectiveCompletedTicks = new Map<string, number>();
  private events: SimulationEvent[] = [];
  private powerMode: PowerMode;
  private power: PowerStats;
  private lastPowerSatisfaction = 1;
  private localPowerDirty = true;
  private localPowerCache: LocalPowerCache | null = null;
  private localPowerRebuildCount = 0;

  constructor(options: SimulationOptions = {}) {
    const width = Math.floor(options.width ?? DEFAULT_WIDTH);
    const height = Math.floor(options.height ?? DEFAULT_HEIGHT);
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 8 ||
      height < 8 ||
      width > MAX_WORLD_DIMENSION ||
      height > MAX_WORLD_DIMENSION ||
      width * height > MAX_WORLD_AREA
    ) {
      throw new Error(
        `FactorySimulation dimensions must be between 8 and ${MAX_WORLD_DIMENSION} tiles per side and at most ${MAX_WORLD_AREA} tiles total.`,
      );
    }

    this.width = width;
    this.height = height;
    this.seed = normalizeSeed(options.seed ?? DEFAULT_SEED);
    const powerMode = options.powerMode ?? "local";
    if (powerMode !== "local" && powerMode !== "legacyGlobal") {
      throw new Error("FactorySimulation powerMode is invalid.");
    }
    this.powerMode = powerMode;
    this.power = emptyPowerStats(powerMode);
    this.randomState = this.seed;
    this.terrain = new Uint8Array(width * height);
    this.occupancy = new Int32Array(width * height);

    if (options.generateTerrain !== false) this.generateTerrain();
    if (options.generateResources !== false) this.generateStarterResources();
  }

  get tickCount(): number {
    return this._tickCount;
  }

  get elapsedSeconds(): number {
    return this._tickCount / FIXED_TICK_RATE;
  }

  get fixedStepSeconds(): number {
    return FIXED_TICK_SECONDS;
  }

  get currentPowerMode(): PowerMode {
    return this.powerMode;
  }

  /**
   * Replaces one placed combinator's immutable kernel definition atomically.
   * Invalid signal/operator payloads are rejected by the frozen circuit
   * kernel; a kind/configuration mismatch returns false without mutation.
   */
  configureCircuitDevice(
    entityId: number,
    configuration: CircuitDeviceConfiguration,
  ): boolean {
    const entity = this.entities.get(entityId);
    if (!entity || !isCircuitEntityKind(entity.kind)) return false;
    const definition = circuitDeviceDefinition(
      entity.id,
      entity.kind,
      configuration,
    );
    if (!definition) return false;

    const staged = CircuitNetwork.restore(this.circuitNetwork.serialize());
    staged.removeDevice(circuitDeviceId(entity.id));
    staged.registerDevice(definition);
    this.circuitNetwork = staged;
    return true;
  }

  /**
   * Configures a circuit-capable machine port. Capability mismatches are
   * observationally atomic: for example a storage sensor cannot acquire an
   * enable condition and a smelter cannot acquire a sorter route.
   */
  configureCircuitMachinePort(
    entityId: number,
    configuration: CircuitMachinePortConfiguration,
  ): boolean {
    const entity = this.entities.get(entityId);
    if (
      !entity ||
      !isValidCircuitMachineConfiguration(entity.kind, configuration)
    ) {
      return false;
    }
    const definition = circuitMachinePortDefinition(
      entity.id,
      entity.kind,
      configuration,
    );
    if (!definition) return false;

    const staged = CircuitNetwork.restore(this.circuitNetwork.serialize());
    staged.removeMachinePort(circuitMachinePortId(entity.id));
    staged.registerMachinePort(definition);
    this.circuitNetwork = staged;
    this.refreshCircuitPortConfiguration(entity.id);
    this.refreshCircuitControlCacheFromState();
    return true;
  }

  connectCircuitWire(
    color: CircuitWireColor,
    first: CircuitConnectionPoint,
    second: CircuitConnectionPoint,
  ): boolean {
    if (color !== "red" && color !== "green") return false;
    const firstEntity = this.entities.get(first.entityId);
    const secondEntity = this.entities.get(second.entityId);
    if (!firstEntity || !secondEntity) return false;
    const firstBinding = circuitEndpointBinding(
      firstEntity.id,
      firstEntity.kind,
      first.connector,
    );
    const secondBinding = circuitEndpointBinding(
      secondEntity.id,
      secondEntity.kind,
      second.connector,
    );
    if (
      !firstBinding ||
      !secondBinding ||
      firstBinding.endpointId === secondBinding.endpointId ||
      !isCircuitWireWithinReach(
        firstEntity,
        first.connector,
        secondEntity,
        second.connector,
      )
    ) {
      return false;
    }
    return this.circuitNetwork.connect(
      color,
      firstBinding.endpointId,
      secondBinding.endpointId,
    );
  }

  disconnectCircuitWire(
    color: CircuitWireColor,
    first: CircuitConnectionPoint,
    second: CircuitConnectionPoint,
  ): boolean {
    if (color !== "red" && color !== "green") return false;
    const firstEntity = this.entities.get(first.entityId);
    const secondEntity = this.entities.get(second.entityId);
    if (!firstEntity || !secondEntity) return false;
    const firstBinding = circuitEndpointBinding(
      firstEntity.id,
      firstEntity.kind,
      first.connector,
    );
    const secondBinding = circuitEndpointBinding(
      secondEntity.id,
      secondEntity.kind,
      second.connector,
    );
    if (!firstBinding || !secondBinding) return false;
    return this.circuitNetwork.disconnect(
      color,
      firstBinding.endpointId,
      secondBinding.endpointId,
    );
  }

  readCircuitEndpoint(
    point: CircuitConnectionPoint,
  ): CircuitFrame | null {
    const entity = this.entities.get(point.entityId);
    if (!entity) return null;
    const binding = circuitEndpointBinding(
      entity.id,
      entity.kind,
      point.connector,
    );
    return binding
      ? this.circuitNetwork.readEndpoint(binding.endpointId)
      : null;
  }

  getCircuitMachineControl(
    entityId: number,
  ): CircuitMachineControl | null {
    return this.circuitControls.get(entityId) ?? null;
  }

  circuitSnapshot(): CircuitSimulationSnapshot {
    const endpoints: CircuitEndpointSnapshot[] = [];
    for (const entity of this.sortedEntities()) {
      for (const binding of circuitEndpointBindings(
        entity.id,
        entity.kind,
      )) {
        const position = circuitEndpointPosition(
          entity,
          binding.connector,
        );
        endpoints.push(
          Object.freeze({
            endpointId: binding.endpointId,
            entityId: entity.id,
            connector: binding.connector,
            x: position.x,
            y: position.y,
            signals: this.circuitNetwork.readEndpoint(
              binding.endpointId,
            ),
          }),
        );
      }
    }
    endpoints.sort(
      (left, right) =>
        left.entityId - right.entityId ||
        left.connector.localeCompare(right.connector),
    );
    const serialized = this.circuitNetwork.serialize();
    const topology = this.circuitNetwork.topology();
    return Object.freeze({
      tick: this.circuitNetwork.tickCount,
      workUnits: this.circuitWorkUnits,
      topology,
      endpoints: Object.freeze(endpoints),
      wires: topology.wires,
      devices: serialized.devices,
      machinePorts: serialized.machinePorts,
      machineControls: Object.freeze(
        [...this.circuitControls.values()].sort((left, right) =>
          left.portId.localeCompare(right.portId),
        ),
      ),
    });
  }

  railSnapshot(): RailNetworkSnapshot | null {
    return this.railNetwork?.snapshot() ?? null;
  }

  railStationInterfacesSnapshot(): readonly RailStationStorageInterface[] {
    return Object.freeze(this.sortedRailStationInterfaces());
  }

  /** Read-only diagnostic used to prove pointer/HUD paths do not clone saves. */
  serializationCount(): number {
    return this.serializeCalls;
  }

  /**
   * Installs the one authoritative rail network. Reconfiguration that could
   * silently destroy wagon custody is deliberately rejected; use the focused
   * topology, signal, station, and consist APIs below.
   */
  configureRailNetwork(
    configuration: SimulationRailConfiguration,
  ): RailMutationResult {
    if (this.railNetwork) {
      return { ok: false, reason: "alreadyConfigured" };
    }
    if (this._tickCount > RAIL_LIMITS.maxTicks) {
      return { ok: false, reason: "tickLimit" };
    }
    if (
      configuration.network.trains?.some((train) =>
        railCarsContainCargo(train.cars),
      )
    ) {
      return { ok: false, reason: "invalid" };
    }
    const interfaces = normalizeRailStationInterfaces(
      configuration.stationInterfaces ?? [],
    );
    if (!interfaces) return { ok: false, reason: "storageBinding" };
    try {
      const initial = new RailNetwork(configuration.network).serialize();
      const aligned = restoreRailNetwork({
        ...initial,
        tick: this._tickCount,
      }).serialize();
      const staged = this.stageRailState(
        aligned,
        interfaces,
        this._tickCount,
      );
      this.assertCanEmitEvents(1);
      this.commitRailState(staged);
      this.emit({
        type: "railTopologyChanged",
        railRevision: staged.network.topologyRevision,
      });
      return { ok: true };
    } catch (error) {
      return this.railMutationFailure(error);
    }
  }

  replaceRailSegments(
    segments: readonly RailSegmentInput[],
  ): RailMutationResult {
    if (!this.railNetwork) {
      return { ok: false, reason: "notConfigured" };
    }
    try {
      const previous = this.railNetwork.snapshot();
      const candidate = restoreRailNetwork(this.railNetwork.serialize());
      candidate.replaceSegments(segments);
      const staged = this.stageRailState(
        candidate.serialize(),
        this.sortedRailStationInterfaces(),
        this._tickCount,
      );
      this.commitRailTopologyState(staged, previous);
      return { ok: true };
    } catch (error) {
      return this.railMutationFailure(error);
    }
  }

  replaceRailSignals(
    signals: readonly RailSignalInput[],
  ): RailMutationResult {
    if (!this.railNetwork) {
      return { ok: false, reason: "notConfigured" };
    }
    try {
      const previous = this.railNetwork.snapshot();
      const current = this.railNetwork.serialize();
      if (current.topologyRevision >= RAIL_LIMITS.maxTicks) {
        return { ok: false, reason: "tickLimit" };
      }
      const save: RailNetworkSave = {
        ...current,
        topologyRevision: current.topologyRevision + 1,
        signals: [...signals].sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
      };
      const staged = this.stageRailState(
        save,
        this.sortedRailStationInterfaces(),
        this._tickCount,
      );
      this.commitRailTopologyState(staged, previous);
      return { ok: true };
    } catch (error) {
      return this.railMutationFailure(error);
    }
  }

  replaceRailStations(
    stations: readonly RailStationInput[],
    stationInterfaces: readonly RailStationStorageInterface[] =
      this.sortedRailStationInterfaces(),
  ): RailMutationResult {
    if (!this.railNetwork) {
      return { ok: false, reason: "notConfigured" };
    }
    const interfaces = normalizeRailStationInterfaces(stationInterfaces);
    if (!interfaces) return { ok: false, reason: "storageBinding" };
    try {
      const previous = this.railNetwork.snapshot();
      const current = this.railNetwork.serialize();
      if (current.topologyRevision >= RAIL_LIMITS.maxTicks) {
        return { ok: false, reason: "tickLimit" };
      }
      const rebuilt = new RailNetwork({
        segments: current.segments,
        signals: current.signals,
        stations,
        trains: current.trains.map((train) =>
          serializedRailTrainInput(train),
        ),
      }).serialize();
      const distanceByTrain = new Map(
        current.trains.map((train) => [
          train.id,
          train.distanceTravelledMilli,
        ]),
      );
      const save: RailNetworkSave = {
        ...rebuilt,
        tick: current.tick,
        topologyRevision: current.topologyRevision + 1,
        trains: rebuilt.trains.map((train) => ({
          ...train,
          distanceTravelledMilli: distanceByTrain.get(train.id) ?? 0,
        })),
      };
      const staged = this.stageRailState(
        save,
        interfaces,
        this._tickCount,
      );
      this.commitRailTopologyState(staged, previous);
      return { ok: true };
    } catch (error) {
      return this.railMutationFailure(error);
    }
  }

  addRailTrain(train: RailTrainInput): RailMutationResult {
    if (!this.railNetwork) {
      return { ok: false, reason: "notConfigured" };
    }
    if (
      railCarsContainCargo(train.cars) ||
      railCarFuelTotal(train.cars) !== 0
    ) {
      return { ok: false, reason: "invalid" };
    }
    try {
      const current = this.railNetwork.serialize();
      const canonical = new RailNetwork({
        segments: current.segments,
        signals: current.signals,
        stations: current.stations,
        trains: [train],
      }).serialize().trains[0]!;
      const save: RailNetworkSave = {
        ...current,
        trains: [...current.trains, canonical].sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
      };
      const staged = this.stageRailState(
        save,
        this.sortedRailStationInterfaces(),
        this._tickCount,
      );
      this.assertCanEmitEvents(1);
      this.commitRailState(staged);
      this.emit({ type: "railTrainAdded", railTrainId: train.id });
      return { ok: true };
    } catch (error) {
      return this.railMutationFailure(error);
    }
  }

  /**
   * Replaces the physical cars of a stopped or moving train only while its
   * wagons are empty. New wagons must also be empty, so this construction API
   * cannot manufacture or discard authoritative item mass.
   */
  replaceRailTrainConsist(
    trainId: string,
    cars: RailTrainInput["cars"],
  ): RailMutationResult {
    if (!this.railNetwork) {
      return { ok: false, reason: "notConfigured" };
    }
    const current = this.railNetwork.serialize();
    const existing = current.trains.find((train) => train.id === trainId);
    const existingSnapshot = this.railNetwork
      .snapshot()
      .trains.find((train) => train.id === trainId);
    if (
      !existing ||
      !existingSnapshot ||
      existingSnapshot.status !== "dwelling" ||
      existingSnapshot.cargoUnits !== 0 ||
      railCarsContainCargo(cars) ||
      railCarFuelTotal(cars) !==
        railCarFuelTotal(existing.cars)
    ) {
      return { ok: false, reason: "invalid" };
    }
    try {
      const reset = new RailNetwork({
        segments: current.segments,
        signals: current.signals,
        stations: current.stations,
        trains: [
          {
            id: existing.id,
            currentSegmentId: existing.currentSegmentId,
            cars,
            schedule: existing.schedule,
          },
        ],
      }).serialize().trains[0]!;
      const staged = this.stageRailState(
        {
          ...current,
          trains: current.trains.map((train) =>
            train.id === trainId
              ? {
                  ...reset,
                  distanceTravelledMilli:
                    existing.distanceTravelledMilli,
                }
              : train,
          ),
        },
        this.sortedRailStationInterfaces(),
        this._tickCount,
      );
      this.assertCanEmitEvents(1);
      this.commitRailState(staged);
      this.emit({ type: "railConsistChanged", railTrainId: trainId });
      return { ok: true };
    } catch (error) {
      return this.railMutationFailure(error);
    }
  }

  removeRailTrain(trainId: string): RailMutationResult {
    if (!this.railNetwork) {
      return { ok: false, reason: "notConfigured" };
    }
    const current = this.railNetwork.serialize();
    const train = this.railNetwork
      .snapshot()
      .trains.find((candidate) => candidate.id === trainId);
    if (
      !train ||
      train.cargoUnits !== 0 ||
      train.fuelMilli !== 0 ||
      train.status === "moving" ||
      train.speedMilliPerTick !== 0
    ) {
      return { ok: false, reason: "invalid" };
    }
    try {
      const staged = this.stageRailState(
        {
          ...current,
          trains: current.trains.filter(
            (candidate) => candidate.id !== trainId,
          ),
        },
        this.sortedRailStationInterfaces(),
        this._tickCount,
      );
      this.assertCanEmitEvents(1);
      this.commitRailState(staged);
      this.emit({ type: "railTrainRemoved", railTrainId: trainId });
      return { ok: true };
    } catch (error) {
      return this.railMutationFailure(error);
    }
  }

  setRailTrainSchedule(
    trainId: string,
    schedule: readonly RailScheduleStop[],
  ): RailMutationResult {
    if (!this.railNetwork) {
      return { ok: false, reason: "notConfigured" };
    }
    const current = this.railNetwork.serialize();
    const existing = current.trains.find((train) => train.id === trainId);
    if (!existing) return { ok: false, reason: "invalid" };
    try {
      const reset = new RailNetwork({
        segments: current.segments,
        signals: current.signals,
        stations: current.stations,
        trains: [serializedRailTrainInput(existing, schedule)],
      }).serialize().trains[0]!;
      const staged = this.stageRailState(
        {
          ...current,
          trains: current.trains
            .map((train) =>
              train.id === trainId
                ? {
                    ...reset,
                    distanceTravelledMilli:
                      existing.distanceTravelledMilli,
                  }
                : train,
            )
            .sort((left, right) => left.id.localeCompare(right.id)),
        },
        this.sortedRailStationInterfaces(),
        this._tickCount,
      );
      this.assertCanEmitEvents(1);
      this.commitRailState(staged);
      this.emit({ type: "railScheduleChanged", railTrainId: trainId });
      return { ok: true };
    } catch (error) {
      return this.railMutationFailure(error);
    }
  }

  transferRailCargo(
    stationId: string,
    trainId: string,
    wagonId: string,
    itemId: ItemId,
    amount: number,
  ): number {
    return this.transferRailCargoInternal(
      stationId,
      trainId,
      wagonId,
      itemId,
      amount,
      true,
    );
  }

  fuelRailLocomotiveFromStorage(
    stationId: string,
    trainId: string,
    locomotiveId: string,
    coalCount: number,
  ): number {
    if (
      !this.railNetwork ||
      !Number.isSafeInteger(coalCount) ||
      coalCount <= 0
    ) {
      return 0;
    }
    const binding = this.railStationInterfaces.get(stationId);
    const storage = binding
      ? this.entities.get(binding.storageEntityId)
      : undefined;
    const snapshot = this.railNetwork.snapshot();
    const station = snapshot.stations.find(
      (candidate) => candidate.id === stationId,
    );
    const train = snapshot.trains.find(
      (candidate) => candidate.id === trainId,
    );
    const locomotive = train?.cars.find(
      (car) => car.id === locomotiveId && car.kind === "locomotive",
    );
    if (
      !binding ||
      binding.mode === "unload" ||
      storage?.kind !== "storage" ||
      !station ||
      !train ||
      (
        train.status !== "dwelling" &&
        train.status !== "out-of-fuel"
      ) ||
      train.speedMilliPerTick !== 0 ||
      train.currentSegmentId !== station.segmentId ||
      !locomotive ||
      (binding.itemFilter &&
        !binding.itemFilter.includes("coal"))
    ) {
      return 0;
    }
    const availableCoal = inventoryCount(storage.inventory, "coal");
    const fuelRoom =
      locomotive.fuelCapacityMilli - locomotive.fuelMilli;
    const consumed = Math.min(
      coalCount,
      availableCoal,
      Math.floor(fuelRoom / RAIL_COAL_FUEL_MILLI),
    );
    if (consumed <= 0) return 0;
    this.assertCanEmitEvents(1);
    const accepted = this.railNetwork.addFuel(
      trainId,
      locomotiveId,
      checkedIntegerProduct(
        consumed,
        RAIL_COAL_FUEL_MILLI,
        "Rail fuel transfer exceeds safe integer range.",
      ),
    );
    if (accepted !== consumed * RAIL_COAL_FUEL_MILLI) {
      throw new Error("Rail fuel transaction failed atomicity.");
    }
    if (!removeFromInventory(storage.inventory, "coal", consumed)) {
      throw new Error("Rail fuel transaction lost authoritative custody.");
    }
    this.emit({
      type: "railFueled",
      railTrainId: trainId,
      railStationId: stationId,
      item: "coal",
      amount: consumed,
      value: accepted,
    });
    return consumed;
  }

  railFieldPrimeStorageIds(trainId: string): readonly number[] {
    const snapshot = this.railNetwork?.snapshot();
    const train = snapshot?.trains.find(
      (candidate) => candidate.id === trainId,
    );
    const node = snapshot?.graph.nodes.find(
      (candidate) =>
        candidate.segmentId === train?.currentSegmentId,
    );
    if (
      !train ||
      !node ||
      train.status !== "out-of-fuel" ||
      train.speedMilliPerTick !== 0
    ) {
      return Object.freeze([]);
    }
    return Object.freeze(
      this.sortedEntities()
        .filter(
          (entity) =>
            entity.kind === "storage" &&
            inventoryCount(entity.inventory, "coal") > 0,
        )
        .map((entity) => {
          const nearestX = Math.max(
            entity.x,
            Math.min(node.x, entity.x + entity.width - 1),
          );
          const nearestY = Math.max(
            entity.y,
            Math.min(node.y, entity.y + entity.height - 1),
          );
          return {
            id: entity.id,
            distance:
              Math.abs(node.x - nearestX) +
              Math.abs(node.y - nearestY),
          };
        })
        .filter((candidate) => candidate.distance <= 4)
        .sort(
          (left, right) =>
            left.distance - right.distance || left.id - right.id,
        )
        .map((candidate) => candidate.id),
    );
  }

  /**
   * Physical breakdown recovery. Exactly stationary out-of-fuel trains may
   * take coal from an authoritative storage footprint within four cardinal
   * tiles of their current segment; no cargo or fuel is created.
   */
  fieldPrimeRailLocomotiveFromStorage(
    storageEntityId: number,
    trainId: string,
    locomotiveId: string,
    coalCount: number,
  ): number {
    if (
      !this.railNetwork ||
      !Number.isSafeInteger(coalCount) ||
      coalCount <= 0 ||
      !this.railFieldPrimeStorageIds(trainId).includes(storageEntityId)
    ) {
      return 0;
    }
    const storage = this.entities.get(storageEntityId);
    const train = this.railNetwork
      .snapshot()
      .trains.find((candidate) => candidate.id === trainId);
    const locomotive = train?.cars.find(
      (car) => car.id === locomotiveId && car.kind === "locomotive",
    );
    if (!storage || storage.kind !== "storage" || !train || !locomotive) {
      return 0;
    }
    const availableCoal = inventoryCount(storage.inventory, "coal");
    const fuelRoom =
      locomotive.fuelCapacityMilli - locomotive.fuelMilli;
    const consumed = Math.min(
      coalCount,
      availableCoal,
      Math.floor(fuelRoom / RAIL_COAL_FUEL_MILLI),
    );
    if (consumed <= 0) return 0;
    this.assertCanEmitEvents(1);
    const accepted = this.railNetwork.addFuel(
      trainId,
      locomotiveId,
      checkedIntegerProduct(
        consumed,
        RAIL_COAL_FUEL_MILLI,
        "Rail field-prime fuel exceeds safe integer range.",
      ),
    );
    if (accepted !== consumed * RAIL_COAL_FUEL_MILLI) {
      throw new Error("Rail field-prime transaction failed atomicity.");
    }
    if (!removeFromInventory(storage.inventory, "coal", consumed)) {
      throw new Error("Rail field-prime transaction lost authoritative custody.");
    }
    this.emit({
      type: "railFueled",
      railTrainId: trainId,
      item: "coal",
      amount: consumed,
      value: accepted,
    });
    return consumed;
  }

  powerDiagnostics(): {
    mode: PowerMode;
    topologyRebuildCount: number;
    topologyDirty: boolean;
  } {
    return Object.freeze({
      mode: this.powerMode,
      topologyRebuildCount: this.localPowerRebuildCount,
      topologyDirty: this.localPowerDirty,
    });
  }

  /**
   * Explicitly stages the complete local topology before changing a migrated
   * sandbox. Failure is observationally atomic: mode, fuel, events, entity
   * power, and serialized state remain untouched.
   */
  retrofitLocalPower(): PowerRetrofitResult {
    if (this.powerMode === "local") {
      return Object.freeze({ ok: true, outcome: "alreadyLocal" });
    }
    const cachedCandidate =
      !this.localPowerDirty ? this.localPowerCache : null;
    const candidate = cachedCandidate ?? this.buildLocalPowerCache();
    const uncoveredEntityIds: number[] = [];
    for (const [entityId, assignment] of candidate.assignmentByEntityId) {
      if (assignment.networkId === null) uncoveredEntityIds.push(entityId);
    }
    uncoveredEntityIds.sort((left, right) => left - right);
    if (uncoveredEntityIds.length > 0) {
      return Object.freeze({
        ok: false,
        outcome: "uncovered",
        uncoveredEntityIds: Object.freeze(uncoveredEntityIds),
      }) as PowerRetrofitResult;
    }

    this.powerMode = "local";
    this.localPowerCache = candidate;
    this.localPowerDirty = false;
    if (!cachedCandidate) this.localPowerRebuildCount += 1;
    this.refreshLocalPowerPreview();
    return Object.freeze({ ok: true, outcome: "applied" });
  }

  powerGridSnapshot(): PowerGridSnapshot {
    this.refreshLocalPowerPreviewIfDirty();
    const cache = this.ensureLocalPowerCache();
    const relays = this.sortedEntities()
      .filter((entity) => entity.kind === "gridRelay")
      .map((relay) => {
        const center = this.entityCenter(relay);
        return Object.freeze({
          id: relay.id,
          x: center.x,
          y: center.y,
          networkId: cache.relayNetworkById.get(relay.id)!,
        });
      });
    const links = cache.topology.links.map((link) =>
      Object.freeze({
        relayAId: link.relayAId,
        relayBId: link.relayBId,
      })
    );
    const assignments: PowerGridAssignmentState[] = [];
    for (
      let index = 0;
      index < cache.topology.participantRoles.length;
      index += 1
    ) {
      const [entityId, role] = cache.topology.participantRoles[index]!;
      if (role === "passive") continue;
      const relayId = cache.topology.participantToRelay[index]![1];
      const networkId = cache.topology.participantToNetwork[index]![1];
      assignments.push(
        Object.freeze({ entityId, role, relayId, networkId }),
      );
    }
    return Object.freeze({
      mode: this.powerMode,
      supplyHalfExtentTiles: POWER_SUPPLY_HALF_EXTENT_TILES,
      cableReachTiles: POWER_CABLE_REACH_TILES,
      maxLinksPerRelay: POWER_MAX_LINKS_PER_RELAY,
      relays: Object.freeze(relays),
      links: Object.freeze(links),
      assignments: Object.freeze(assignments),
    }) as PowerGridSnapshot;
  }

  tick(deltaSeconds: number): number {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new Error("tick(deltaSeconds) requires a finite, non-negative value.");
    }
    if (deltaSeconds > MAX_TICK_SECONDS) {
      throw new Error("Refusing to simulate more than one hour in a single tick call.");
    }

    const accumulatedSeconds = this.accumulatorSeconds + deltaSeconds;
    const steps = Math.floor(
      (accumulatedSeconds + EPSILON) / FIXED_TICK_SECONDS,
    );
    if (steps <= 0) {
      this.accumulatorSeconds = accumulatedSeconds;
      return 0;
    }

    this.preflightFixedSteps(steps);
    let remainderSeconds =
      accumulatedSeconds - steps * FIXED_TICK_SECONDS;
    if (Math.abs(remainderSeconds) < EPSILON) {
      remainderSeconds = 0;
    }
    this.accumulatorSeconds = remainderSeconds;
    for (let index = 0; index < steps; index += 1) this.stepFixed();
    return steps;
  }

  step(ticks = 1): void {
    if (!Number.isSafeInteger(ticks) || ticks < 0) {
      throw new Error("step(ticks) requires a non-negative integer.");
    }
    this.preflightFixedSteps(ticks);
    for (let i = 0; i < ticks; i += 1) this.stepFixed();
  }

  canPlace(
    kind: EntityKind,
    x: number,
    y: number,
    direction: Direction = Direction.East,
    options: PlaceOptions = {},
  ): PlacementCheck {
    if (!ENTITY_PROTOTYPES[kind]) {
      return { ok: false, reason: "outOfBounds", tiles: [] };
    }

    const gridX = Math.floor(x);
    const gridY = Math.floor(y);
    const tiles = footprintTiles(kind, gridX, gridY, direction);
    for (const tile of tiles) {
      if (!this.inBounds(tile.x, tile.y)) {
        return { ok: false, reason: "outOfBounds", tiles };
      }
      if (this.terrain[this.index(tile.x, tile.y)] === TerrainType.Water) {
        return { ok: false, reason: "water", tiles };
      }
      if (this.occupancy[this.index(tile.x, tile.y)] !== 0) {
        return { ok: false, reason: "occupied", tiles };
      }
      if (this.railTiles.has(railTileKey(tile.x, tile.y))) {
        return { ok: false, reason: "occupied", tiles };
      }
    }

    if (options.recipeId !== undefined) {
      const recipe = RECIPES[options.recipeId];
      const machine =
        kind === "smelter"
          ? "smelter"
          : kind === "fabricator"
            ? "fabricator"
            : undefined;
      if (!recipe || machine === undefined || recipe.machine !== machine) {
        return { ok: false, reason: "invalidRecipe", tiles };
      }
    }
    if (
      options.fluidId !== undefined &&
      (kind !== "fluidSource" || !isFluidId(options.fluidId))
    ) {
      return { ok: false, reason: "invalidRecipe", tiles };
    }
    if (
      options.fluidRecipeId !== undefined &&
      (kind !== "fluidProcessor" ||
        !isFluidRecipeId(options.fluidRecipeId))
    ) {
      return { ok: false, reason: "invalidRecipe", tiles };
    }
    if (
      !isFluidEntityKind(kind) &&
      (options.fluidId !== undefined ||
        options.fluidRecipeId !== undefined)
    ) {
      return { ok: false, reason: "invalidRecipe", tiles };
    }

    if (kind === "extractor") {
      const footprint = footprintFor(kind, direction);
      const radius = ENTITY_PROTOTYPES.extractor.extractionRadius;
      if (
        this.resourcesInArea(
          gridX - radius,
          gridY - radius,
          footprint.width + radius * 2,
          footprint.height + radius * 2,
        ).length === 0
      ) {
        return { ok: false, reason: "requiresResource", tiles };
      }
    }

    return { ok: true, tiles };
  }

  place(
    kind: EntityKind,
    x: number,
    y: number,
    direction: Direction = Direction.East,
    options: PlaceOptions = {},
  ): PlacementResult {
    const check = this.canPlace(kind, x, y, direction, options);
    if (!check.ok) return check;
    this.assertCanAllocateEntityIds(1);
    this.assertCanEmitEvents(1);

    const footprint = footprintFor(kind, direction);
    const recipeId = options.recipeId;
    const entity: EntityState = {
      id: this.nextEntityId,
      kind,
      x: Math.floor(x),
      y: Math.floor(y),
      direction,
      width: footprint.width,
      height: footprint.height,
      status:
        kind === "generator"
          ? "noFuel"
          : kind === "fabricator" && recipeId === undefined
            ? "unconfigured"
            : "idle",

      progress: 0,
      animationPhase: 0,
      powerSatisfaction: 1,
      speedMultiplier: 1,

      inventory: {},
      input: {},
      output: {},
      reclaim: {},
      fuel: {},

      beltItems: [],
      manifoldRouting:
        kind === "manifold"
          ? {
              ...DEFAULT_MANIFOLD_ROUTING,
              splitCursors: [...DEFAULT_MANIFOLD_ROUTING.splitCursors],
              mergeCursors: [...DEFAULT_MANIFOLD_ROUTING.mergeCursors],
            }
          : undefined,
      armProgress: 0,
      armReturning: false,

      recipeId,
      recipeChangeQueued: false,
      fuelEnergyKJ: 0,
      generatedPowerKW: 0,
      fluidState: isFluidEntityKind(kind)
        ? createFluidEntityState(
            kind,
            options.fluidId ?? "crudeOil",
            options.fluidRecipeId ?? "refineCrude",
          )
        : undefined,
    };

    const stagedCircuitNetwork =
      this.stageCircuitParticipantPlacement(entity);
    this.nextEntityId += 1;
    this.entities.set(entity.id, entity);
    this.circuitNetwork = stagedCircuitNetwork;
    if (isCircuitMachineKind(entity.kind)) {
      this.refreshCircuitPortConfiguration(entity.id);
      this.refreshCircuitControlCacheFromState();
    }
    this.fillOccupancy(entity);
    this.invalidateLocalPower();
    this.emit({ type: "placed", entityId: entity.id, x: entity.x, y: entity.y });
    return { ok: true, entity: cloneEntity(entity) };
  }

  remove(x: number, y: number): EntityState | undefined {
    const entity = this.entityAtInternal(Math.floor(x), Math.floor(y));
    if (!entity) return undefined;
    if (
      [...this.railStationInterfaces.values()].some(
        (binding) => binding.storageEntityId === entity.id,
      )
    ) {
      return undefined;
    }
    this.assertCanEmitEvents(1);
    const stagedCircuitNetwork =
      this.stageCircuitParticipantRemoval(entity);

    this.clearOccupancy(entity);
    this.entities.delete(entity.id);
    this.circuitNetwork = stagedCircuitNetwork;
    this.circuitControls.delete(entity.id);
    this.circuitPortConfigurations.delete(entity.id);
    this.invalidateLocalPower();
    this.emit({
      type: "removed",
      entityId: entity.id,
      x: entity.x,
      y: entity.y,
    });
    return cloneEntity(entity);
  }

  rotate(
    x: number,
    y: number,
    clockwise = true,
  ): RotationResult {
    const entity = this.entityAtInternal(Math.floor(x), Math.floor(y));
    if (!entity) return { ok: false, reason: "notFound" };
    if (
      [...this.railStationInterfaces.values()].some(
        (binding) => binding.storageEntityId === entity.id,
      )
    ) {
      return { ok: false, reason: "occupied" };
    }
    // Rotation's placement check temporarily clears the entity's own
    // occupancy, so reserve its single event before that first mutation.
    this.assertCanEmitEvents(1);

    const oldDirection = entity.direction;
    const oldWidth = entity.width;
    const oldHeight = entity.height;
    this.clearOccupancy(entity);

    const direction = rotateDirection(entity.direction, clockwise);
    const check = this.canPlace(entity.kind, entity.x, entity.y, direction, {
      recipeId: entity.recipeId,
      fluidId: entity.fluidState?.sourceFluidId,
      fluidRecipeId: entity.fluidState?.recipeId,
    });
    if (!check.ok) {
      entity.direction = oldDirection;
      entity.width = oldWidth;
      entity.height = oldHeight;
      this.fillOccupancy(entity);
      return { ok: false, reason: check.reason };
    }

    const footprint = footprintFor(entity.kind, direction);
    entity.direction = direction;
    entity.width = footprint.width;
    entity.height = footprint.height;
    this.fillOccupancy(entity);
    this.invalidateLocalPower();
    this.emit({
      type: "rotated",
      entityId: entity.id,
      x: entity.x,
      y: entity.y,
    });
    return { ok: true, entity: cloneEntity(entity) };
  }

  setRecipe(entityId: number, recipeId: RecipeId): boolean {
    return this.requestRecipeChange(entityId, recipeId).ok;
  }

  /**
   * Requests a machine configuration change without destroying an in-flight
   * craft. Idle machines transition immediately. Busy machines finish the
   * already-consumed recipe exactly once, reject further input, then reclaim
   * every leftover input before the newest requested configuration becomes
   * active. A null recipe selects Auto-smelt and is valid only for smelters.
   */
  requestRecipeChange(
    entityId: number,
    recipeId: RecipeId | null,
  ): RecipeChangeResult {
    const entity = this.entities.get(entityId);
    if (!entity) {
      return { ok: false, outcome: "rejected", reason: "notFound" };
    }
    if (entity.kind !== "smelter" && entity.kind !== "fabricator") {
      return { ok: false, outcome: "rejected", reason: "notMachine" };
    }
    if (recipeId === null && entity.kind === "fabricator") {
      return { ok: false, outcome: "rejected", reason: "requiresRecipe" };
    }
    if (recipeId !== null && !isRecipeFor(recipeId, entity.kind)) {
      return { ok: false, outcome: "rejected", reason: "invalidRecipe" };
    }

    const currentRecipeId = entity.recipeId ?? null;
    const pendingRecipeId = entity.pendingRecipeId ?? null;
    if (entity.recipeChangeQueued && pendingRecipeId === recipeId) {
      return {
        ok: true,
        outcome: "unchanged",
        recipeId,
      };
    }
    if (!entity.recipeChangeQueued && currentRecipeId === recipeId) {
      return {
        ok: true,
        outcome: "unchanged",
        recipeId,
      };
    }

    if (entity.activeRecipeId !== undefined) {
      // Asking for the currently configured recipe cancels a prior queued
      // change. This is an applied state change even though the recipe itself
      // was already selected.
      if (currentRecipeId === recipeId) {
        entity.recipeChangeQueued = false;
        entity.pendingRecipeId = undefined;
        this.refreshActiveMachineStatus(entity, false);
        return { ok: true, outcome: "applied", recipeId };
      }
      entity.recipeChangeQueued = true;
      entity.pendingRecipeId = recipeId ?? undefined;
      this.refreshActiveMachineStatus(entity, true);
      return { ok: true, outcome: "queued", recipeId };
    }

    this.assertReclaimCanAcceptInput(entity);
    this.applyRecipeConfiguration(entity, recipeId);
    return { ok: true, outcome: "applied", recipeId };
  }

  private refreshActiveMachineStatus(
    machine: EntityState,
    changingRecipe: boolean,
  ): void {
    if (machine.powerSatisfaction <= EPSILON) {
      machine.status = "noPower";
      return;
    }
    if (
      machine.activeRecipeId !== undefined &&
      !this.canFitRecipeProducts(machine, machine.activeRecipeId)
    ) {
      machine.status = "outputFull";
      return;
    }
    machine.status = changingRecipe ? "changingRecipe" : "working";
  }

  /**
   * Atomically replaces a manifold's routing policy. Fairness cursors are
   * transport state rather than configuration, so a valid policy change keeps
   * every lane-local cursor exactly where its last successful handoff left it.
   */
  setManifoldRouting(
    entityId: number,
    routing: ManifoldRouting,
  ): boolean {
    const entity = this.entities.get(entityId);
    if (
      entity?.kind !== "manifold" ||
      !isManifoldRouting(routing) ||
      !entity.manifoldRouting
    ) {
      return false;
    }
    const extractPort = routing.extractPort ?? 0;
    if (
      routing.mode === "extract" &&
      entity.beltItems.some(
        (item) =>
          item.port !== undefined &&
          !manifoldExtractItemBelongsOnPort(
            { filter: routing.filter, extractPort },
            item.item,
            item.port,
          ),
      )
    ) {
      return false;
    }
    entity.manifoldRouting = {
      mode: routing.mode,
      ...(routing.mode === "extract" ? { filter: routing.filter } : {}),
      extractPort,
      splitCursors: [...entity.manifoldRouting.splitCursors],
      mergeCursors: [...entity.manifoldRouting.mergeCursors],
    };
    return true;
  }

  getEntity(entityId: number): EntityState | undefined {
    this.refreshLocalPowerPreviewIfDirty();
    const entity = this.entities.get(entityId);
    return entity ? cloneEntity(entity) : undefined;
  }

  getEntityAt(x: number, y: number): EntityState | undefined {
    this.refreshLocalPowerPreviewIfDirty();
    const entity = this.entityAtInternal(Math.floor(x), Math.floor(y));
    return entity ? cloneEntity(entity) : undefined;
  }

  getEntities(kind?: EntityKind): EntityState[] {
    this.refreshLocalPowerPreviewIfDirty();
    return this.sortedEntities()
      .filter((entity) => kind === undefined || entity.kind === kind)
      .map(cloneEntity);
  }

  getTerrainAt(x: number, y: number): TerrainType | undefined {
    if (!this.inBounds(x, y)) return undefined;
    return this.terrain[this.index(Math.floor(x), Math.floor(y))] as TerrainType;
  }

  setTerrain(x: number, y: number, terrain: TerrainType): boolean {
    const gridX = Math.floor(x);
    const gridY = Math.floor(y);
    if (
      !this.inBounds(gridX, gridY) ||
      (terrain !== TerrainType.Ground && terrain !== TerrainType.Water)
    ) {
      return false;
    }
    if (
      terrain === TerrainType.Water &&
      (this.occupancy[this.index(gridX, gridY)] !== 0 ||
        this.railTiles.has(railTileKey(gridX, gridY)))
    ) {
      return false;
    }
    this.terrain[this.index(gridX, gridY)] = terrain;
    if (terrain === TerrainType.Water) {
      this.resources.delete(this.resourceKey(gridX, gridY));
    }
    return true;
  }

  getResourceAt(x: number, y: number): ResourceCell | undefined {
    const resource = this.resources.get(
      this.resourceKey(Math.floor(x), Math.floor(y)),
    );
    return resource ? { ...resource } : undefined;
  }

  getResources(): ResourceCell[] {
    return [...this.resources.values()]
      .filter((resource) => resource.amount > 0)
      .sort(stableResourceSort)
      .map((resource) => ({ ...resource }));
  }

  setResource(
    x: number,
    y: number,
    type: ResourceId,
    amount: number,
  ): boolean {
    const gridX = Math.floor(x);
    const gridY = Math.floor(y);
    if (
      !this.inBounds(gridX, gridY) ||
      !RESOURCE_IDS.includes(type) ||
      !Number.isFinite(amount)
    ) {
      return false;
    }
    const key = this.resourceKey(gridX, gridY);
    const normalized = Math.max(0, Math.floor(amount));
    if (!Number.isSafeInteger(normalized)) return false;
    if (normalized === 0) {
      this.resources.delete(key);
      return true;
    }
    this.assertResourceReplacementSafe(key, type, normalized);
    this.terrain[this.index(gridX, gridY)] = TerrainType.Ground;
    this.resources.set(key, {
      x: gridX,
      y: gridY,
      type,
      amount: normalized,
    });
    return true;
  }

  receive(
    entityId: number,
    item: ItemId,
    amount = 1,
    compartment: InventoryCompartment = "auto",
    lane?: 0 | 1,
  ): number {
    const entity = this.entities.get(entityId);
    if (!entity || !ITEMS[item] || !Number.isFinite(amount)) return 0;
    const count = Math.max(0, Math.floor(amount));
    if (!Number.isSafeInteger(count) || count <= 0) return 0;
    if (!this.canReceiveOne(entity, item, compartment, lane)) return 0;
    this.assertStoredItemAdditions(
      new Map([
        [
          item,
          this.maximumPotentialReceiveCount(
            entity,
            item,
            count,
            compartment,
            lane,
          ),
        ],
      ]),
    );
    this.assertCanEmitEvents(1);
    if (entity.kind === "belt" || entity.kind === "manifold") {
      this.assertCanAllocateBeltItemIds(
        Math.min(count, BELT_LANE_CAPACITY * 2),
      );
    }
    let accepted = 0;
    for (let i = 0; i < count; i += 1) {
      if (!this.receiveOne(entity, item, compartment, lane)) break;
      accepted += 1;
    }
    if (accepted > 0) {
      this.emit({
        type: "itemTransferred",
        entityId,
        item,
        amount: accepted,
      });
    }
    return accepted;
  }

  /**
   * Removes material physically present in one steel depot without creating a
   * transfer event. The campaign Commission Uplink uses this after observing
   * a real inserter delivery, so submitted cargo cannot remain available to
   * the factory or be counted twice.
   */
  withdrawStorage(
    entityId: number,
    item: ItemId,
    amount = 1,
  ): number {
    const storage = this.entities.get(entityId);
    if (
      !storage ||
      storage.kind !== "storage" ||
      !ITEMS[item] ||
      !Number.isFinite(amount)
    ) {
      return 0;
    }
    const requested = Math.max(0, Math.floor(amount));
    if (!Number.isSafeInteger(requested) || requested <= 0) return 0;
    const withdrawn = Math.min(
      requested,
      inventoryCount(storage.inventory, item),
    );
    if (withdrawn <= 0) return 0;
    removeFromInventory(storage.inventory, item, withdrawn);
    return withdrawn;
  }

  /**
   * Removes one player-accessible payload without creating or destroying item
   * custody. The campaign uses this for a Factorio-style manual black start:
   * a player can take coal from a chest, belt, machine buffer, inserter hand,
   * or another generator and hand-load a dead generator. The caller is
   * responsible for an atomic rollback if the destination later rejects it.
   */
  withdrawAccessibleItem(entityId: number, item: ItemId): boolean {
    const entity = this.entities.get(entityId);
    if (!entity || !ITEMS[item]) return false;

    if (entity.kind === "belt" || entity.kind === "manifold") {
      let candidate = -1;
      for (let index = 0; index < entity.beltItems.length; index += 1) {
        const payload = entity.beltItems[index]!;
        if (payload.item !== item) continue;
        const selected = candidate < 0
          ? undefined
          : entity.beltItems[candidate]!;
        if (
          !selected ||
          payload.progress > selected.progress ||
          (
            payload.progress === selected.progress &&
            payload.id < selected.id
          )
        ) {
          candidate = index;
        }
      }
      if (candidate >= 0) {
        entity.beltItems.splice(candidate, 1);
        return true;
      }
    }

    if (entity.kind === "inserter" && entity.heldItem === item) {
      entity.heldItem = undefined;
      entity.heldItemSourceLane = undefined;
      entity.armReturning = entity.armProgress > 0;
      return true;
    }

    for (const inventory of [
      entity.inventory,
      entity.output,
      entity.reclaim,
      entity.input,
      entity.fuel,
    ]) {
      if (removeFromInventory(inventory, item, 1)) return true;
    }
    return false;
  }

  transfer(
    sourceId: number,
    targetId: number,
    item?: ItemId,
    amount = 1,
    sourceCompartment: InventoryCompartment = "auto",
    targetCompartment: InventoryCompartment = "auto",
  ): TransferResult {
    const source = this.entities.get(sourceId);
    const target = this.entities.get(targetId);
    if (!source || !target || !Number.isFinite(amount)) return { item, moved: 0 };
    // Dispatch manifolds expose transport topology rather than an inventory
    // contact. Belts are the explicit adapter for inserter custody.
    if (
      (source.kind === "inserter" && target.kind === "manifold") ||
      (source.kind === "manifold" && target.kind === "inserter")
    ) {
      return { item, moved: 0 };
    }

    const count = Math.max(0, Math.floor(amount));
    if (!Number.isSafeInteger(count) || count <= 0) {
      return { item, moved: 0 };
    }
    let moved = 0;
    let movedItem = item;
    const sourceCandidates = this.sourceItems(source, sourceCompartment);
    const firstCandidate = movedItem ?? sourceCandidates[0];
    if (
      !firstCandidate ||
      !sourceCandidates.includes(firstCandidate) ||
      !this.canReceiveOne(target, firstCandidate, targetCompartment)
    ) {
      return { item: movedItem, moved: 0 };
    }
    this.assertCanEmitEvents(1);
    if (target.kind === "belt" || target.kind === "manifold") {
      this.assertCanAllocateBeltItemIds(
        Math.min(count, BELT_LANE_CAPACITY * 2),
      );
    }
    for (let i = 0; i < count; i += 1) {
      const candidate =
        movedItem ?? this.sourceItems(source, sourceCompartment)[0];
      if (!candidate) break;
      if (!this.canReceiveOne(target, candidate, targetCompartment)) break;
      const taken = this.takeOne(source, candidate, sourceCompartment);
      if (!taken) break;
      if (!this.receiveOne(target, candidate, targetCompartment)) {
        this.restoreTaken(source, taken);
        break;
      }
      this.commitTaken(source, taken);
      movedItem = candidate;
      moved += 1;
    }

    if (moved > 0) {
      this.emit({
        type: "itemTransferred",
        entityId: targetId,
        item: movedItem,
        amount: moved,
      });
    }
    return { item: movedItem, moved };
  }

  productionLedger(): Record<ItemId, number> {
    return { ...this.produced };
  }

  /**
   * Deterministic external fluid ingress for scenario setup, debugging, and
   * future logistics adapters. The accepted amount is always an integer,
   * bounded by catalog capacity, and never mixes fluid identities.
   */
  receiveFluid(
    entityId: number,
    fluidId: FluidId,
    amountMilli: number,
    role: FluidNodeRole = "buffer",
  ): number {
    if (
      !Number.isSafeInteger(amountMilli) ||
      amountMilli < 0 ||
      !isFluidId(fluidId)
    ) {
      throw new Error(
        "receiveFluid requires a known fluid and a non-negative safe integer amount.",
      );
    }
    if (amountMilli === 0) return 0;
    const entity = this.entities.get(entityId);
    if (!entity || !isFluidEntityKind(entity.kind) || !entity.fluidState) {
      return 0;
    }
    const state = entity.fluidState;
    let buffer: FluidBufferState | undefined;
    if (role === "buffer") {
      buffer = state.buffer;
      if (
        entity.kind === "fluidSource" &&
        state.sourceFluidId !== fluidId
      ) {
        return 0;
      }
    } else if (entity.kind === "fluidProcessor") {
      const recipe = state.recipeId
        ? FLUID_RECIPES[state.recipeId]
        : undefined;
      if (
        !recipe ||
        (role === "input" && recipe.input !== fluidId) ||
        (role === "output" && recipe.output !== fluidId)
      ) {
        return 0;
      }
      buffer = role === "input" ? state.input : state.output;
    }
    if (
      !buffer ||
      (buffer.fluidId !== undefined && buffer.fluidId !== fluidId)
    ) {
      return 0;
    }
    const accepted = Math.min(
      amountMilli,
      buffer.capacityMilli - buffer.amountMilli,
    );
    if (accepted <= 0) return 0;
    buffer.amountMilli = checkedIntegerSum(
      buffer.amountMilli,
      accepted,
      "Fluid buffer exceeds safe integer range.",
    );
    buffer.fluidId ??= fluidId;
    return accepted;
  }

  fluidNetworkSnapshot(): FluidNetworkSnapshot {
    return buildFluidNetworkSnapshot(this.sortedEntities());
  }

  objectiveStates(): ObjectiveState[] {
    return OBJECTIVES.map((objective, index) => {
      const previousComplete =
        index === 0 ||
        this.objectiveCompletedTicks.has(OBJECTIVES[index - 1]?.id ?? "");
      const produced = this.produced[objective.item];
      const completedTick = this.objectiveCompletedTicks.get(objective.id);
      return {
        ...objective,
        index,
        progress: Math.min(objective.amount, produced),
        complete: completedTick !== undefined,
        locked: !previousComplete,
        completedTick,
      };
    });
  }

  stats(): SimulationStats {
    this.refreshLocalPowerPreviewIfDirty();
    const entityCounts = emptyEntityCountRecord();
    let beltItemCount = 0;
    const stored = this.storedItemTotalsChecked();

    for (const entity of this.entities.values()) {
      entityCounts[entity.kind] += 1;
      beltItemCount += entity.beltItems.length;
    }

    const resourcesRemaining = this.resourceTotalsChecked();
    const fluid = buildFluidStats(
      this.sortedEntities(),
      this.fluidProducedMilli,
      this.fluidProcessedMilli,
      this.fluidTransferredMilli,
      this.fluidBackpressuredEntityIds,
    );

    return {
      tick: this._tickCount,
      elapsedSeconds: this.elapsedSeconds,
      entityCount: this.entities.size,
      entityCounts,
      beltItemCount,
      resourcesRemaining,
      produced: { ...this.produced },
      stored,
      power: clonePowerStats(this.power),
      fluid,
      objectives: this.objectiveStates(),
    };
  }

  getRenderSnapshot(): RenderSnapshot {
    const entities: RenderEntityState[] = this.getEntities();
    const powerGrid = this.powerGridSnapshot();
    const cache = this.ensureLocalPowerCache();
    for (const entity of entities) {
      if (entity.kind === "gridRelay") {
        entity.powerRelayId = entity.id;
        entity.powerNetworkId =
          cache.relayNetworkById.get(entity.id) ?? null;
        continue;
      }
      const assignment = cache.assignmentByEntityId.get(entity.id);
      if (assignment) {
        entity.powerRelayId = assignment.relayId;
        entity.powerNetworkId = assignment.networkId;
      }
    }
    for (const entity of entities) {
      if (
        entity.kind !== "inserter" ||
        entity.heldItem !== undefined ||
        entity.armReturning
      ) {
        continue;
      }
      const authoritative = this.entities.get(entity.id);
      if (!authoritative) continue;
      const pickup = this.inserterPickupCandidate(authoritative);
      if (!pickup) continue;
      entity.inserterPickupItem = pickup.item;
      if (pickup.sourceLane !== undefined) {
        entity.inserterPickupLane = pickup.sourceLane;
      }
    }
    const fluidNetwork = buildFluidNetworkSnapshot(entities);
    const fluid = buildFluidStats(
      entities,
      this.fluidProducedMilli,
      this.fluidProcessedMilli,
      this.fluidTransferredMilli,
      this.fluidBackpressuredEntityIds,
      fluidNetwork,
    );
    return {
      tick: this._tickCount,
      elapsedSeconds: this.elapsedSeconds,
      width: this.width,
      height: this.height,
      entities,
      resources: this.getResources(),
      power: clonePowerStats(this.power),
      powerGrid,
      fluid,
      fluidNetwork,
      circuit: this.circuitSnapshot(),
      rail: this.railSnapshot(),
      objectives: this.objectiveStates(),
    };
  }

  peekEvents(): SimulationEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  drainEvents(): SimulationEvent[] {
    const events = this.peekEvents();
    this.events.length = 0;
    return events;
  }

  serialize(): SerializedSimulation {
    this.serializeCalls += 1;
    const objectiveCompletedTicks: Record<string, number> = {};
    for (const [id, tick] of [...this.objectiveCompletedTicks.entries()].sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      objectiveCompletedTicks[id] = tick;
    }

    return {
      version: SIMULATION_VERSION,
      catalogVersion: CATALOG_VERSION,
      width: this.width,
      height: this.height,
      seed: this.seed,
      randomState: this.randomState,
      tickCount: this._tickCount,
      accumulatorSeconds: canonicalAccumulatorSeconds(
        this.accumulatorSeconds,
      ),
      nextEntityId: this.nextEntityId,
      nextBeltItemId: this.nextBeltItemId,
      nextEventId: this.nextEventId,
      terrain: Array.from(this.terrain),
      resources: this.getResources(),
      entities: this.getEntities(),
      produced: { ...this.produced },
      objectiveCompletedTicks,
      lastPowerSatisfaction: this.lastPowerSatisfaction,
      powerMode: this.powerMode,
      fluidProducedMilli: { ...this.fluidProducedMilli },
      fluidProcessedMilli: { ...this.fluidProcessedMilli },
      fluidTransferredMilli: this.fluidTransferredMilli,
      circuitNetwork: this.circuitNetwork.serialize(),
      railNetwork: this.railNetwork?.serialize() ?? null,
      railStationInterfaces: this.sortedRailStationInterfaces(),
    };
  }

  serializeToString(): string {
    return JSON.stringify(this.serialize());
  }

  static restore(snapshot: AnySimulationSnapshot): FactorySimulation {
    const parsed: unknown =
      typeof snapshot === "string"
        ? JSON.parse(snapshot)
        : snapshot;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Simulation save must be an object.");
    }
    const data = migrateSimulationSnapshot(
      parsed as Exclude<AnySimulationSnapshot, string>,
    );
    if (
      !Number.isInteger(data.width) ||
      !Number.isInteger(data.height) ||
      data.width < 8 ||
      data.height < 8 ||
      data.width > MAX_WORLD_DIMENSION ||
      data.height > MAX_WORLD_DIMENSION ||
      data.width * data.height > MAX_WORLD_AREA ||
      !Array.isArray(data.terrain) ||
      !Array.isArray(data.resources) ||
      !Array.isArray(data.entities) ||
      !isPositiveUint32(data.seed) ||
      !isUint32(data.randomState) ||
      !isSafelyIncrementableNonNegativeInteger(data.tickCount) ||
      !Number.isFinite(data.accumulatorSeconds) ||
      data.accumulatorSeconds < 0 ||
      data.accumulatorSeconds + EPSILON >= FIXED_TICK_SECONDS ||
      !isSerializedProducedRecord(data.produced) ||
      !isSerializedFluidRecord(data.fluidProducedMilli) ||
      !isSerializedFluidRecord(data.fluidProcessedMilli) ||
      (data.railNetwork !== null &&
        !isPlainRecord(data.railNetwork)) ||
      !isCanonicalRailStationInterfaces(
        data.railStationInterfaces,
      ) ||
      (data.railNetwork === null &&
        data.railStationInterfaces.length !== 0) ||
      !isSafelyIncrementableNonNegativeInteger(
        data.fluidTransferredMilli,
      ) ||
      !isValidObjectiveCompletedTicks(
        data.objectiveCompletedTicks,
        data.tickCount,
      ) ||
      !Number.isFinite(data.lastPowerSatisfaction) ||
      data.lastPowerSatisfaction < 0 ||
      data.lastPowerSatisfaction > 1 ||
      (data.powerMode !== "local" && data.powerMode !== "legacyGlobal") ||
      !Number.isInteger(data.nextEntityId) ||
      data.nextEntityId <= 0 ||
      data.nextEntityId > MAX_ENTITY_ID ||
      !isSafelyIncrementablePositiveInteger(data.nextBeltItemId) ||
      !isSafelyIncrementablePositiveInteger(data.nextEventId)
    ) {
      throw new Error("Simulation save structure is corrupt.");
    }
    let restoredCircuitNetwork: CircuitNetwork;
    try {
      restoredCircuitNetwork = CircuitNetwork.restore(data.circuitNetwork);
    } catch (error) {
      throw new Error("Save contains invalid circuit network state.", {
        cause: error,
      });
    }
    if (restoredCircuitNetwork.tickCount !== data.tickCount) {
      throw new Error(
        "Save circuit tick does not match the simulation tick.",
      );
    }
    if (data.terrain.length !== data.width * data.height) {
      throw new Error("Save terrain dimensions are corrupt.");
    }
    for (let index = 0; index < data.terrain.length; index += 1) {
      const terrain = data.terrain[index];
      if (terrain !== TerrainType.Ground && terrain !== TerrainType.Water) {
        throw new Error("Save contains invalid terrain state.");
      }
    }
    if (data.entities.some((entity) => !isPlainRecord(entity))) {
      throw new Error("Save contains invalid entity state.");
    }

    const simulation = new FactorySimulation({
      width: data.width,
      height: data.height,
      seed: data.seed,
      generateTerrain: false,
      generateResources: false,
      powerMode: data.powerMode,
    });
    simulation.terrain = Uint8Array.from(data.terrain);
    simulation.resources.clear();
    const resourceKeys = new Set<string>();
    for (const resource of data.resources) {
      if (
        !isPlainRecord(resource) ||
        !Number.isSafeInteger(resource.x) ||
        !Number.isSafeInteger(resource.y) ||
        !simulation.inBounds(resource.x, resource.y) ||
        !RESOURCE_IDS.includes(resource.type as ResourceId) ||
        !Number.isSafeInteger(resource.amount) ||
        resource.amount <= 0 ||
        simulation.terrain[simulation.index(resource.x, resource.y)] !==
          TerrainType.Ground
      ) {
        throw new Error("Save contains invalid resource state.");
      }
      const key = simulation.resourceKey(resource.x, resource.y);
      if (resourceKeys.has(key)) {
        throw new Error("Save contains duplicate resource coordinates.");
      }
      resourceKeys.add(key);
      simulation.resources.set(key, { ...resource });
    }

    simulation.entities.clear();
    simulation.occupancy.fill(0);
    const entityIds = new Set<number>();
    const beltItemIds = new Set<number>();
    let maximumEntityId = 0;
    let maximumBeltItemId = 0;
    for (const serializedEntity of [...data.entities].sort(
      (a, b) => a.id - b.id,
    )) {
      if (!SIMULATION_ENTITY_KINDS.includes(serializedEntity.kind)) {
        throw new Error(`Unknown entity kind in save: ${serializedEntity.kind}.`);
      }
      if (
        !Number.isSafeInteger(serializedEntity.id) ||
        serializedEntity.id <= 0 ||
        serializedEntity.id >= MAX_ENTITY_ID ||
        entityIds.has(serializedEntity.id) ||
        !Number.isSafeInteger(serializedEntity.x) ||
        !Number.isSafeInteger(serializedEntity.y) ||
        !Number.isInteger(serializedEntity.direction) ||
        serializedEntity.direction < Direction.North ||
        serializedEntity.direction > Direction.West ||
        !Array.isArray(serializedEntity.beltItems)
      ) {
        throw new Error("Save contains invalid entity state.");
      }
      entityIds.add(serializedEntity.id);
      maximumEntityId = Math.max(maximumEntityId, serializedEntity.id);

      const expectedFootprint = footprintFor(
        serializedEntity.kind,
        serializedEntity.direction,
      );
      const ownsProgress =
        serializedEntity.kind === "extractor" ||
        serializedEntity.kind === "manifold" ||
        serializedEntity.kind === "smelter" ||
        serializedEntity.kind === "fabricator" ||
        serializedEntity.kind === "fluidProcessor";
      const ownsSpeedMultiplier =
        serializedEntity.kind === "extractor" ||
        serializedEntity.kind === "smelter" ||
        serializedEntity.kind === "fabricator";
      const maximumSpeedMultiplier =
        1 +
        MAX_WORLD_AREA *
          ENTITY_PROTOTYPES.beacon.beaconSpeedBonus;
      if (
        serializedEntity.width !== expectedFootprint.width ||
        serializedEntity.height !== expectedFootprint.height ||
        !ENTITY_STATUSES.has(serializedEntity.status) ||
        ((serializedEntity.kind === "gridRelay" ||
          isCircuitEntityKind(serializedEntity.kind)) &&
          serializedEntity.status !== "idle") ||
        !Number.isFinite(serializedEntity.progress) ||
        serializedEntity.progress < 0 ||
        serializedEntity.progress > 1 ||
        (!ownsProgress && serializedEntity.progress !== 0) ||
        !Number.isFinite(serializedEntity.animationPhase) ||
        serializedEntity.animationPhase < 0 ||
        serializedEntity.animationPhase > 1 ||
        ((serializedEntity.kind === "storage" ||
          serializedEntity.kind === "gridRelay" ||
          serializedEntity.kind === "fluidPipe" ||
          serializedEntity.kind === "fluidTank" ||
          isCircuitEntityKind(serializedEntity.kind)) &&
          serializedEntity.animationPhase !== 0) ||
        !Number.isFinite(serializedEntity.powerSatisfaction) ||
        serializedEntity.powerSatisfaction < 0 ||
        serializedEntity.powerSatisfaction > 1 ||
        ((serializedEntity.kind === "gridRelay" ||
          isCircuitEntityKind(serializedEntity.kind)) &&
          serializedEntity.powerSatisfaction !== 1) ||
        !Number.isFinite(serializedEntity.speedMultiplier) ||
        serializedEntity.speedMultiplier < 1 ||
        serializedEntity.speedMultiplier > maximumSpeedMultiplier ||
        (!ownsSpeedMultiplier && serializedEntity.speedMultiplier !== 1)
      ) {
        throw new Error("Save contains invalid entity scalar state.");
      }

      const isGenerator = serializedEntity.kind === "generator";
      if (
        !Number.isFinite(serializedEntity.fuelEnergyKJ) ||
        serializedEntity.fuelEnergyKJ < 0 ||
        (isGenerator
          ? serializedEntity.fuelEnergyKJ > COAL_ENERGY_KJ
          : serializedEntity.fuelEnergyKJ !== 0) ||
        !Number.isFinite(serializedEntity.generatedPowerKW) ||
        serializedEntity.generatedPowerKW < 0 ||
        (isGenerator
          ? serializedEntity.generatedPowerKW >
            ENTITY_PROTOTYPES.generator.generationCapacityKW
          : serializedEntity.generatedPowerKW !== 0)
      ) {
        throw new Error("Save contains invalid generator scalar state.");
      }
      if (
        serializedEntity.kind === "extractor"
          ? serializedEntity.miningResource !== undefined &&
            !RESOURCE_IDS.includes(serializedEntity.miningResource)
          : serializedEntity.miningResource !== undefined
      ) {
        throw new Error("Save contains mining state on another entity.");
      }

      if (
        !isSerializedInventory(serializedEntity.inventory) ||
        !isSerializedInventory(serializedEntity.input) ||
        !isSerializedInventory(serializedEntity.output) ||
        !isSerializedInventory(serializedEntity.reclaim) ||
        !isSerializedInventory(serializedEntity.fuel)
      ) {
        throw new Error("Save contains invalid inventory state.");
      }

      const machineKind =
        serializedEntity.kind === "smelter"
          ? "smelter"
          : serializedEntity.kind === "fabricator"
            ? "fabricator"
            : undefined;
      if (typeof serializedEntity.recipeChangeQueued !== "boolean") {
        throw new Error("Save contains invalid recipe transition state.");
      }
      if (machineKind !== undefined) {
        if (
          serializedEntity.recipeId !== undefined &&
          !isRecipeFor(serializedEntity.recipeId, machineKind)
        ) {
          throw new Error("Save contains invalid configured recipe.");
        }
        if (
          serializedEntity.activeRecipeId !== undefined &&
          !isRecipeFor(serializedEntity.activeRecipeId, machineKind)
        ) {
          throw new Error("Save contains invalid active recipe.");
        }
        if (
          serializedEntity.pendingRecipeId !== undefined &&
          !isRecipeFor(serializedEntity.pendingRecipeId, machineKind)
        ) {
          throw new Error("Save contains invalid pending recipe.");
        }
        if (
          !Number.isFinite(serializedEntity.progress) ||
          serializedEntity.progress < 0 ||
          serializedEntity.progress > 1 ||
          (serializedEntity.activeRecipeId === undefined &&
            serializedEntity.progress !== 0)
        ) {
          throw new Error("Save contains invalid machine craft state.");
        }
        if (
          serializedEntity.recipeChangeQueued &&
          (serializedEntity.activeRecipeId === undefined ||
            (serializedEntity.kind === "fabricator" &&
              serializedEntity.pendingRecipeId === undefined) ||
            (serializedEntity.pendingRecipeId ?? null) ===
              (serializedEntity.recipeId ?? null))
        ) {
          throw new Error("Save contains invalid recipe transition state.");
        }
        if (
          !serializedEntity.recipeChangeQueued &&
          serializedEntity.pendingRecipeId !== undefined
        ) {
          throw new Error("Save contains orphan pending recipe.");
        }
        if (
          serializedEntity.kind === "fabricator" &&
          serializedEntity.recipeId === undefined &&
          serializedEntity.activeRecipeId !== undefined
        ) {
          throw new Error(
            "Save contains an active craft on an unconfigured fabricator.",
          );
        }
        if (
          serializedEntity.activeRecipeId !== undefined &&
          serializedEntity.recipeId !== undefined &&
          serializedEntity.activeRecipeId !== serializedEntity.recipeId
        ) {
          throw new Error("Save active craft does not match its configuration.");
        }
      } else if (
        serializedEntity.recipeId !== undefined ||
        serializedEntity.activeRecipeId !== undefined ||
        serializedEntity.pendingRecipeId !== undefined ||
        serializedEntity.recipeChangeQueued ||
        inventoryTotal(serializedEntity.reclaim) > 0
      ) {
        throw new Error("Save contains recipe state on another entity.");
      }

      if (isFluidEntityKind(serializedEntity.kind)) {
        if (
          !isCanonicalFluidEntityState(
            serializedEntity.kind,
            serializedEntity.fluidState,
          )
        ) {
          throw new Error("Save contains invalid fluid entity state.");
        }
        if (serializedEntity.kind === "fluidProcessor") {
          const fluidState = serializedEntity.fluidState;
          const recipe = FLUID_RECIPES[fluidState.recipeId!];
          if (
            serializedEntity.progress !==
            fluidState.processTicks / recipe.durationTicks
          ) {
            throw new Error("Save contains inconsistent fluid process state.");
          }
        }
      } else if (serializedEntity.fluidState !== undefined) {
        throw new Error("Save contains fluid state on another entity.");
      }

      validateEntityInventoryOwnership(serializedEntity);

      if (serializedEntity.kind === "manifold") {
        if (!isManifoldRoutingState(serializedEntity.manifoldRouting)) {
          throw new Error("Save contains invalid manifold routing state.");
        }
      } else if (serializedEntity.manifoldRouting !== undefined) {
        throw new Error("Save contains manifold routing on another entity.");
      }
      const isInserter = serializedEntity.kind === "inserter";
      if (
        serializedEntity.heldItem !== undefined &&
        (!isInserter || !ITEM_IDS.includes(serializedEntity.heldItem))
      ) {
        throw new Error("Save contains invalid inserter custody state.");
      }
      if (
        serializedEntity.heldItemSourceLane !== undefined &&
        (!isInserter ||
          !isBranch(serializedEntity.heldItemSourceLane))
      ) {
        throw new Error("Save contains invalid inserter custody state.");
      }
      if (
        !Number.isFinite(serializedEntity.armProgress) ||
        serializedEntity.armProgress < 0 ||
        serializedEntity.armProgress > 1 ||
        typeof serializedEntity.armReturning !== "boolean"
      ) {
        throw new Error("Save contains invalid inserter phase state.");
      }
      if (!isInserter) {
        // Versions 1-3 wrote explicit zero/false defaults on every entity.
        // Preserve those saves while rejecting phase state owned by another
        // prototype.
        if (
          serializedEntity.armProgress !== 0 ||
          serializedEntity.armReturning
        ) {
          throw new Error("Save contains inserter phase state on another entity.");
        }
      } else {
        const hasHeldItem = serializedEntity.heldItem !== undefined;
        if (
          (hasHeldItem && serializedEntity.armReturning) ||
          (serializedEntity.armReturning &&
            serializedEntity.armProgress <= 0) ||
          (!hasHeldItem &&
            !serializedEntity.armReturning &&
            serializedEntity.armProgress !== 0) ||
          (serializedEntity.heldItemSourceLane !== undefined &&
            !hasHeldItem &&
            !serializedEntity.armReturning)
        ) {
          throw new Error("Save contains invalid inserter custody state.");
        }
      }

      for (const beltItem of serializedEntity.beltItems) {
        if (
          !Number.isSafeInteger(beltItem.id) ||
          beltItem.id <= 0 ||
          beltItemIds.has(beltItem.id) ||
          !ITEM_IDS.includes(beltItem.item) ||
          !isBranch(beltItem.lane) ||
          !Number.isFinite(beltItem.progress) ||
          beltItem.progress < 0 ||
          beltItem.progress > 1 ||
          (beltItem.port !== undefined && !isBranch(beltItem.port)) ||
          (serializedEntity.kind !== "manifold" &&
            beltItem.port !== undefined) ||
          (serializedEntity.kind !== "belt" &&
            serializedEntity.kind !== "manifold")
        ) {
          throw new Error("Save contains invalid transport payload state.");
        }
        beltItemIds.add(beltItem.id);
        maximumBeltItemId = Math.max(maximumBeltItemId, beltItem.id);
      }

      if (
        serializedEntity.kind === "belt" ||
        serializedEntity.kind === "manifold"
      ) {
        const ports =
          serializedEntity.kind === "manifold"
            ? ([undefined, 0, 1] as const)
            : ([undefined] as const);
        for (const lane of [0, 1] as const) {
          for (const port of ports) {
            const positions = serializedEntity.beltItems
              .filter(
                (item) => item.lane === lane && item.port === port,
              )
              .map((item) => item.progress)
              .sort((a, b) => b - a);
            if (positions.length > BELT_LANE_CAPACITY) {
              throw new Error("Save exceeds transport track capacity.");
            }
            for (let index = 1; index < positions.length; index += 1) {
              if (
                positions[index - 1]! - positions[index]! <
                BELT_ITEM_SPACING - EPSILON
              ) {
                throw new Error("Save violates transport payload spacing.");
              }
            }
          }
        }
      }

      if (serializedEntity.kind === "manifold") {
        const routing = serializedEntity.manifoldRouting!;
        if (
          routing.mode === "extract" &&
          serializedEntity.beltItems.some(
            (item) =>
              item.port !== undefined &&
              !manifoldExtractItemBelongsOnPort(
                routing,
                item.item,
                item.port,
              ),
          )
        ) {
          throw new Error("Save violates manifold extract purity.");
        }
      }

      const entity = cloneEntity(serializedEntity);
      for (const tile of footprintTiles(
        entity.kind,
        entity.x,
        entity.y,
        entity.direction,
      )) {
        if (
          !simulation.inBounds(tile.x, tile.y) ||
          simulation.terrain[simulation.index(tile.x, tile.y)] ===
            TerrainType.Water ||
          simulation.occupancy[simulation.index(tile.x, tile.y)] !== 0
        ) {
          throw new Error(
            "Save contains overlapping, flooded, or out-of-bounds entities.",
          );
        }
      }
      simulation.entities.set(entity.id, entity);
      simulation.fillOccupancy(entity);
    }

    simulation.validateRestoredCircuitNetwork(restoredCircuitNetwork);
    if (data.railNetwork !== null) {
      let stagedRail: StagedRailState;
      try {
        stagedRail = simulation.stageRailState(
          data.railNetwork,
          data.railStationInterfaces,
          data.tickCount,
        );
      } catch (error) {
        throw new Error("Save contains invalid rail integration state.", {
          cause: error,
        });
      }
      simulation.commitRailState(stagedRail);
    }
    simulation.storedItemTotalsChecked();
    simulation.resourceTotalsChecked();
    if (
      data.nextEntityId <= maximumEntityId ||
      data.nextBeltItemId <= maximumBeltItemId
    ) {
      throw new Error("Save id counters do not exceed allocated ids.");
    }

    simulation.randomState = data.randomState;
    simulation._tickCount = data.tickCount;
    simulation.accumulatorSeconds = data.accumulatorSeconds;
    simulation.nextEntityId = data.nextEntityId;
    simulation.nextBeltItemId = data.nextBeltItemId;
    simulation.nextEventId = data.nextEventId;
    simulation.produced = { ...data.produced };
    simulation.fluidProducedMilli = { ...data.fluidProducedMilli };
    simulation.fluidProcessedMilli = { ...data.fluidProcessedMilli };
    simulation.fluidTransferredMilli = data.fluidTransferredMilli;
    simulation.circuitNetwork = restoredCircuitNetwork;
    simulation.circuitPortConfigurations.clear();
    for (const entity of simulation.entities.values()) {
      if (isCircuitMachineKind(entity.kind)) {
        simulation.refreshCircuitPortConfiguration(entity.id);
      }
    }
    simulation.refreshCircuitControlCacheFromState();
    simulation.circuitWorkUnits = 0;
    simulation.fluidBackpressuredEntityIds = data.entities
      .filter(
        (entity) =>
          isFluidEntityKind(entity.kind) &&
          (entity.status === "blocked" ||
            entity.status === "outputFull"),
      )
      .map((entity) => entity.id)
      .sort((left, right) => left - right);
    simulation.objectiveCompletedTicks.clear();
    for (const [id, tick] of Object.entries(data.objectiveCompletedTicks)) {
      simulation.objectiveCompletedTicks.set(id, tick);
    }
    simulation.lastPowerSatisfaction = data.lastPowerSatisfaction;
    simulation.events.length = 0;
    simulation.refreshPowerPreview();
    return simulation;
  }

  private stageCircuitParticipantPlacement(
    entity: EntityState,
  ): CircuitNetwork {
    const bindings = circuitEndpointBindings(entity.id, entity.kind);
    if (bindings.length === 0) return this.circuitNetwork;
    const staged = CircuitNetwork.restore(this.circuitNetwork.serialize());
    for (const binding of bindings) {
      staged.addEndpoint(binding.endpointId);
    }
    if (isCircuitEntityKind(entity.kind)) {
      const definition = circuitDeviceDefinition(
        entity.id,
        entity.kind,
        defaultCircuitDeviceConfiguration(entity.kind),
      );
      if (!definition) {
        throw new Error("Circuit entity has no default device definition.");
      }
      staged.registerDevice(definition);
    } else {
      const port = circuitMachinePortDefinition(entity.id, entity.kind);
      if (!port) {
        throw new Error("Circuit machine has no default port definition.");
      }
      staged.registerMachinePort(port);
    }
    return staged;
  }

  private stageCircuitParticipantRemoval(
    entity: EntityState,
  ): CircuitNetwork {
    const bindings = circuitEndpointBindings(entity.id, entity.kind);
    if (bindings.length === 0) return this.circuitNetwork;
    const staged = CircuitNetwork.restore(this.circuitNetwork.serialize());
    if (isCircuitEntityKind(entity.kind)) {
      staged.removeDevice(circuitDeviceId(entity.id));
    } else {
      staged.removeMachinePort(circuitMachinePortId(entity.id));
    }
    for (const binding of bindings) {
      staged.removeEndpoint(binding.endpointId);
    }
    return staged;
  }

  private refreshCircuitPortConfiguration(entityId: number): void {
    const portId = circuitMachinePortId(entityId);
    const port = this.circuitNetwork
      .serialize()
      .machinePorts.find((candidate) => candidate.id === portId);
    if (!port) {
      throw new Error(`Circuit machine ${entityId} is missing its port.`);
    }
    this.circuitPortConfigurations.set(
      entityId,
      circuitMachineConfigurationFromSerialized(port),
    );
  }

  private refreshCircuitControlCacheFromState(): void {
    const entityIdByPort = new Map<string, number>();
    for (const entity of this.entities.values()) {
      if (isCircuitMachineKind(entity.kind)) {
        entityIdByPort.set(
          circuitMachinePortId(entity.id),
          entity.id,
        );
      }
    }
    const controls = new Map<number, CircuitMachineControl>();
    for (const control of deriveCircuitMachineControls(
      this.circuitNetwork.serialize(),
    )) {
      const entityId = entityIdByPort.get(control.portId);
      if (entityId === undefined || controls.has(entityId)) {
        throw new Error(
          "Circuit control cache references an invalid machine port.",
        );
      }
      controls.set(entityId, control);
    }
    this.circuitControls = controls;
  }

  private validateRestoredCircuitNetwork(
    network: CircuitNetwork,
  ): void {
    const serialized = network.serialize();
    const expectedEndpoints = new Map<
      string,
      { entity: EntityState; binding: CircuitEndpointBinding }
    >();
    const expectedDevices = new Map<string, EntityState>();
    const expectedPorts = new Map<string, EntityState>();
    for (const entity of this.entities.values()) {
      for (const binding of circuitEndpointBindings(
        entity.id,
        entity.kind,
      )) {
        expectedEndpoints.set(binding.endpointId, { entity, binding });
      }
      if (isCircuitEntityKind(entity.kind)) {
        expectedDevices.set(circuitDeviceId(entity.id), entity);
      } else if (isCircuitMachineKind(entity.kind)) {
        expectedPorts.set(circuitMachinePortId(entity.id), entity);
      }
    }

    if (
      serialized.endpoints.length !== expectedEndpoints.size ||
      serialized.endpoints.some(
        (endpointId) => !expectedEndpoints.has(endpointId),
      )
    ) {
      throw new Error(
        "Save circuit endpoints do not exactly match placed entities.",
      );
    }
    if (serialized.devices.length !== expectedDevices.size) {
      throw new Error(
        "Save circuit devices do not exactly match placed combinators.",
      );
    }
    for (const device of serialized.devices) {
      const entity = expectedDevices.get(device.id);
      if (!entity || !isCircuitEntityKind(entity.kind)) {
        throw new Error("Save contains an unbound circuit device.");
      }
      if (
        (entity.kind === "constantCombinator" &&
          (device.kind !== "constant" ||
            device.outputEndpoint !==
              circuitEndpointId(entity.id, "output"))) ||
        (entity.kind === "arithmeticCombinator" &&
          (device.kind !== "arithmetic" ||
            device.inputEndpoint !==
              circuitEndpointId(entity.id, "input") ||
            device.outputEndpoint !==
              circuitEndpointId(entity.id, "output"))) ||
        (entity.kind === "deciderCombinator" &&
          (device.kind !== "decider" ||
            device.inputEndpoint !==
              circuitEndpointId(entity.id, "input") ||
            device.outputEndpoint !==
              circuitEndpointId(entity.id, "output")))
      ) {
        throw new Error(
          "Save circuit device kind or connector binding is corrupt.",
        );
      }
    }

    if (serialized.machinePorts.length !== expectedPorts.size) {
      throw new Error(
        "Save circuit ports do not exactly match circuit-capable machines.",
      );
    }
    for (const port of serialized.machinePorts) {
      const entity = expectedPorts.get(port.id);
      if (!entity) {
        throw new Error("Save contains an unbound circuit machine port.");
      }
      const endpoint = circuitEndpointId(entity.id, "io");
      const configuration =
        circuitMachineConfigurationFromSerialized(port);
      if (
        port.inputEndpoint !== endpoint ||
        port.outputEndpoint !== endpoint ||
        !isValidCircuitMachineConfiguration(
          entity.kind,
          configuration,
        )
      ) {
        throw new Error(
          "Save circuit machine port binding or capability is corrupt.",
        );
      }
    }

    for (const wire of serialized.wires) {
      if (wire.color !== "red" && wire.color !== "green") {
        throw new Error("Save contains a non-canonical circuit wire color.");
      }
      const first = expectedEndpoints.get(wire.endpointA);
      const second = expectedEndpoints.get(wire.endpointB);
      if (
        !first ||
        !second ||
        !isCircuitWireWithinReach(
          first.entity,
          first.binding.connector,
          second.entity,
          second.binding.connector,
        )
      ) {
        throw new Error(
          "Save contains an unbound or over-reach circuit wire.",
        );
      }
    }
  }

  private stageRailState(
    save: RailNetworkSave,
    interfaces: readonly RailStationStorageInterface[],
    expectedTick: number,
  ): StagedRailState {
    let network: RailNetwork;
    try {
      network = restoreRailNetwork(save);
    } catch (error) {
      throw new RailIntegrationError(
        "invalid",
        error instanceof Error ? error.message : "Invalid rail state.",
      );
    }
    if (network.tick !== expectedTick) {
      throw new RailIntegrationError(
        "invalid",
        "Rail and simulation ticks are not aligned.",
      );
    }

    const snapshot = network.snapshot();
    const tiles = new Set<string>();
    for (const segment of save.segments) {
      if (!this.inBounds(segment.x, segment.y)) {
        throw new RailIntegrationError(
          "outOfBounds",
          "Rail segment is outside the simulation world.",
        );
      }
      if (
        this.terrain[this.index(segment.x, segment.y)] ===
        TerrainType.Water
      ) {
        throw new RailIntegrationError(
          "water",
          "Rail segment occupies water.",
        );
      }
      if (this.occupancy[this.index(segment.x, segment.y)] !== 0) {
        throw new RailIntegrationError(
          "occupied",
          "Rail segment overlaps an ordinary entity.",
        );
      }
      tiles.add(railTileKey(segment.x, segment.y));
    }

    for (const station of snapshot.stations) {
      if (
        station.capacity !== 0 ||
        station.inventory.length !== 0 ||
        station.storedUnits !== 0
      ) {
        throw new RailIntegrationError(
          "invalid",
          "Rail stations cannot own factory cargo.",
        );
      }
    }
    for (const train of snapshot.trains) {
      if (
        train.dwellTicks > expectedTick ||
        train.reservationWaitTicks > expectedTick ||
        train.distanceTravelledMilli >
          expectedTick * RAIL_MAX_SPEED
      ) {
        throw new RailIntegrationError(
          "invalid",
          "Rail runtime counters exceed their aligned tick horizon.",
        );
      }
      for (const cargo of train.cargo) {
        if (!ITEM_IDS.includes(cargo.itemId as ItemId)) {
          throw new RailIntegrationError(
            "invalid",
            "Rail wagon contains an unknown factory item.",
          );
        }
      }
      for (const stop of train.schedule) {
        if (
          (stop.wait.type === "item-at-least" ||
            stop.wait.type === "item-at-most") &&
          !ITEM_IDS.includes(stop.wait.itemId as ItemId)
        ) {
          throw new RailIntegrationError(
            "invalid",
            "Rail schedule references an unknown factory item.",
          );
        }
      }
    }

    const stationById = new Map(
      snapshot.stations.map((station) => [station.id, station]),
    );
    const segmentById = new Map(
      save.segments.map((segment) => [segment.id, segment]),
    );
    const interfaceMap = new Map<
      string,
      RailStationStorageInterface
    >();
    for (const binding of interfaces) {
      const station = stationById.get(binding.stationId);
      const segment = station
        ? segmentById.get(station.segmentId)
        : undefined;
      const storage = this.entities.get(binding.storageEntityId);
      if (
        !station ||
        !segment ||
        storage?.kind !== "storage" ||
        !footprintTiles(
          storage.kind,
          storage.x,
          storage.y,
          storage.direction,
        ).some(
          (tile) =>
            Math.abs(tile.x - segment.x) +
              Math.abs(tile.y - segment.y) ===
            1,
        )
      ) {
        throw new RailIntegrationError(
          "storageBinding",
          "Rail station interface is not bound to adjacent storage.",
        );
      }
      interfaceMap.set(
        binding.stationId,
        cloneRailStationInterface(binding),
      );
    }
    return { network, interfaces: interfaceMap, tiles };
  }

  private commitRailState(staged: StagedRailState): void {
    this.railNetwork = staged.network;
    this.railStationInterfaces = staged.interfaces;
    this.railTiles = staged.tiles;
  }

  private commitRailTopologyState(
    staged: StagedRailState,
    previous: RailNetworkSnapshot,
  ): void {
    const previousByTrain = new Map(
      previous.trains.map((train) => [train.id, train]),
    );
    const pathTransitions = staged.network
      .snapshot()
      .trains.map((train) => ({
        train,
        previous: previousByTrain.get(train.id),
      }))
      .filter(
        ({ train, previous: old }) =>
          old !== undefined &&
          (old.status === "no-path") !==
            (train.status === "no-path"),
      );
    this.assertCanEmitEvents(1 + pathTransitions.length);
    this.commitRailState(staged);
    this.emit({
      type: "railTopologyChanged",
      railRevision: staged.network.topologyRevision,
    });
    for (const { train } of pathTransitions) {
      this.emit({
        type:
          train.status === "no-path"
            ? "railPathLost"
            : "railPathRestored",
        railTrainId: train.id,
      });
    }
  }

  private sortedRailStationInterfaces(): RailStationStorageInterface[] {
    return [...this.railStationInterfaces.values()]
      .sort((left, right) =>
        left.stationId.localeCompare(right.stationId),
      )
      .map(cloneRailStationInterface);
  }

  private railMutationFailure(error: unknown): RailMutationResult {
    return {
      ok: false,
      reason:
        error instanceof RailIntegrationError
          ? error.reason
          : "invalid",
    };
  }

  private storageCapacityForItem(
    storage: EntityState,
    item: ItemId,
  ): number {
    if (storage.kind !== "storage") return 0;
    const withoutItem = cloneInventory(storage.inventory);
    delete withoutItem[item];
    const availableSlots =
      ENTITY_PROTOTYPES.storage.inventorySlots -
      inventorySlotsUsed(withoutItem);
    if (availableSlots <= 0) return 0;
    return Math.max(
      0,
      availableSlots * ITEMS[item].stackSize -
        inventoryCount(storage.inventory, item),
    );
  }

  private transferRailCargoInternal(
    stationId: string,
    trainId: string,
    wagonId: string,
    itemId: ItemId,
    amount: number,
    emitEvent: boolean,
  ): number {
    if (
      !this.railNetwork ||
      !ITEM_IDS.includes(itemId) ||
      !Number.isSafeInteger(amount) ||
      amount === 0 ||
      Math.abs(amount) > RAIL_LIMITS.maxUnits
    ) {
      return 0;
    }
    const binding = this.railStationInterfaces.get(stationId);
    const storage = binding
      ? this.entities.get(binding.storageEntityId)
      : undefined;
    const snapshot = this.railNetwork.snapshot();
    const station = snapshot.stations.find(
      (candidate) => candidate.id === stationId,
    );
    const train = snapshot.trains.find(
      (candidate) => candidate.id === trainId,
    );
    const wagon = train?.cars.find(
      (car) => car.id === wagonId && car.kind === "cargo-wagon",
    );
    const loading = amount > 0;
    if (
      !binding ||
      storage?.kind !== "storage" ||
      !station ||
      !train ||
      !wagon ||
      train.status !== "dwelling" ||
      train.currentSegmentId !== station.segmentId ||
      (loading && binding.mode === "unload") ||
      (!loading && binding.mode === "load") ||
      (binding.itemFilter &&
        !binding.itemFilter.includes(itemId))
    ) {
      return 0;
    }

    let requested: number;
    if (loading) {
      requested = Math.min(
        amount,
        inventoryCount(storage.inventory, itemId),
      );
    } else {
      requested = Math.min(
        -amount,
        this.storageCapacityForItem(storage, itemId),
      );
    }
    if (requested <= 0) return 0;
    if (emitEvent) this.assertCanEmitEvents(1);

    const transferred = this.railNetwork.transferWagonCargo(
      trainId,
      wagonId,
      itemId,
      loading ? requested : -requested,
    );
    if (transferred === 0) return 0;
    const absolute = Math.abs(transferred);
    if (loading) {
      if (!removeFromInventory(storage.inventory, itemId, absolute)) {
        this.railNetwork.transferWagonCargo(
          trainId,
          wagonId,
          itemId,
          -absolute,
        );
        throw new Error("Rail loading transaction lost custody.");
      }
    } else {
      addToInventory(storage.inventory, itemId, absolute);
    }
    if (emitEvent) {
      this.emit({
        type: loading ? "railCargoLoaded" : "railCargoUnloaded",
        railTrainId: trainId,
        railStationId: stationId,
        railWagonId: wagonId,
        item: itemId,
        amount: absolute,
      });
    }
    return loading ? absolute : -absolute;
  }

  private transferAtRailStations(): void {
    if (!this.railNetwork) return;
    for (const binding of this.sortedRailStationInterfaces()) {
      const snapshot = this.railNetwork.snapshot();
      const station = snapshot.stations.find(
        (candidate) => candidate.id === binding.stationId,
      );
      if (!station) continue;
      const train = snapshot.trains.find(
        (candidate) =>
          candidate.status === "dwelling" &&
          candidate.currentSegmentId === station.segmentId,
      );
      const storage = this.entities.get(binding.storageEntityId);
      if (!train || storage?.kind !== "storage") continue;
      const wagons = train.cars
        .filter((car) => car.kind === "cargo-wagon")
        .sort((left, right) => left.id.localeCompare(right.id));

      if (binding.mode !== "load") {
        let unloaded = false;
        for (const wagon of wagons) {
          for (const cargo of wagon.cargo) {
            const itemId = cargo.itemId as ItemId;
            if (
              !ITEM_IDS.includes(itemId) ||
              (binding.itemFilter &&
                !binding.itemFilter.includes(itemId))
            ) {
              continue;
            }
            if (
              this.transferRailCargoInternal(
                binding.stationId,
                train.id,
                wagon.id,
                itemId,
                -binding.transferRate,
                true,
              ) < 0
            ) {
              unloaded = true;
              break;
            }
          }
          if (unloaded) break;
        }
        if (unloaded) continue;
      }
      if (binding.mode === "unload") continue;

      const eligibleItems = (
        binding.itemFilter
          ? [...binding.itemFilter]
          : [...ITEM_IDS]
      ).sort();
      let loaded = false;
      for (const itemId of eligibleItems) {
        if (inventoryCount(storage.inventory, itemId) <= 0) continue;
        for (const wagon of wagons) {
          if (
            this.transferRailCargoInternal(
              binding.stationId,
              train.id,
              wagon.id,
              itemId,
              binding.transferRate,
              true,
            ) > 0
          ) {
            loaded = true;
            break;
          }
        }
        if (loaded) break;
      }
    }
  }

  private emitRailCoreEvent(event: RailEvent): void {
    switch (event.type) {
      case "train-departed":
        this.emit({
          type: "railTrainDeparted",
          railTrainId: event.trainId,
          railStationId: event.stationId,
        });
        break;
      case "train-arrived":
        this.emit({
          type: "railTrainArrived",
          railTrainId: event.trainId,
          railStationId: event.stationId,
        });
        break;
      case "path-lost":
      case "path-restored":
        this.emit({
          type:
            event.type === "path-lost"
              ? "railPathLost"
              : "railPathRestored",
          railTrainId: event.trainId,
        });
        break;
      case "fuel-exhausted":
        this.emit({
          type: "railFuelExhausted",
          railTrainId: event.trainId,
        });
        break;
      case "topology-changed":
        this.emit({
          type: "railTopologyChanged",
          railRevision: event.revision,
        });
        break;
      case "cargo-transferred":
        throw new Error(
          "Rail station-owned cargo is disabled in FactorySimulation.",
        );
    }
  }

  private updateRailNetwork(): void {
    if (!this.railNetwork) return;
    this.transferAtRailStations();
    const result = this.railNetwork.step(1);
    if (result.tick !== this._tickCount) {
      throw new Error("Rail and simulation ticks diverged.");
    }
    for (const event of result.events) this.emitRailCoreEvent(event);
  }

  /**
   * Reserves every numeric domain that a group of fixed steps can consume.
   * The bounds deliberately overestimate near the numeric ceiling: rejecting
   * an astronomically old simulation early is preferable to rollback or a
   * half-committed tick.
   */
  private preflightFixedSteps(ticks: number): void {
    if (ticks <= 0) return;

    const finalTick = checkedIntegerSum(
      this._tickCount,
      ticks,
      "Simulation tick counter exceeds safe integer range.",
    );
    if (!isSafelyIncrementableNonNegativeInteger(finalTick)) {
      throw new Error("Simulation tick counter exceeds safe integer range.");
    }
    if (this.railNetwork && finalTick > RAIL_LIMITS.maxTicks) {
      throw new Error("Rail tick counter exceeds its bounded horizon.");
    }

    let eventsPerStep = 1 + OBJECTIVES.length;
    if (this.railNetwork) {
      eventsPerStep = checkedIntegerSum(
        eventsPerStep,
        checkedIntegerSum(
          this.railStationInterfaces.size,
          this.railNetwork.snapshot().trains.length * 5,
          "Rail event budget exceeds safe integer range.",
        ),
        "Rail event budget exceeds safe integer range.",
      );
    }
    let beltItemIdsPerStep = 0;
    const productionAdditions = new Map<ItemId, number>();
    const fluidProductionPerStep = emptyFluidRecord();
    const fluidProcessingPerStep = emptyFluidRecord();
    let fluidTransferPerStep = 0;
    const addProductionBound = (item: ItemId, amount: number): void => {
      productionAdditions.set(
        item,
        checkedIntegerSum(
          productionAdditions.get(item) ?? 0,
          amount,
          "Production preflight exceeds safe integer range.",
        ),
      );
    };

    for (const entity of this.entities.values()) {
      if (isFluidEntityKind(entity.kind)) {
        fluidTransferPerStep = checkedIntegerSum(
          fluidTransferPerStep,
          ENTITY_PROTOTYPES[entity.kind]
            .fluidThroughputMilliPerTick ?? 0,
          "Fluid transfer preflight exceeds safe integer range.",
        );
        if (entity.kind === "fluidSource") {
          const fluidId =
            entity.fluidState?.sourceFluidId ?? "crudeOil";
          fluidProductionPerStep[fluidId] = checkedIntegerSum(
            fluidProductionPerStep[fluidId],
            ENTITY_PROTOTYPES.fluidSource
              .fluidSourceRateMilliPerTick ?? 0,
            "Fluid production preflight exceeds safe integer range.",
          );
        } else if (entity.kind === "fluidProcessor") {
          const recipeId =
            entity.fluidState?.recipeId ?? "refineCrude";
          const recipe = FLUID_RECIPES[recipeId];
          fluidProcessingPerStep[recipe.output] = checkedIntegerSum(
            fluidProcessingPerStep[recipe.output],
            recipe.batchMilli,
            "Fluid processing preflight exceeds safe integer range.",
          );
        }
      }

      if (entity.kind === "inserter") {
        eventsPerStep = checkedIntegerSum(
          eventsPerStep,
          1,
          "Simulation event budget exceeds safe integer range.",
        );
        beltItemIdsPerStep = checkedIntegerSum(
          beltItemIdsPerStep,
          1,
          "Transport id budget exceeds safe integer range.",
        );
        continue;
      }

      if (entity.kind === "extractor") {
        // One production event, one depletion event, and an output flush both
        // before and after extraction.
        eventsPerStep = checkedIntegerSum(
          eventsPerStep,
          4,
          "Simulation event budget exceeds safe integer range.",
        );
        beltItemIdsPerStep = checkedIntegerSum(
          beltItemIdsPerStep,
          2,
          "Transport id budget exceeds safe integer range.",
        );
        for (const resource of RESOURCE_IDS) {
          addProductionBound(
            RESOURCE_TO_ITEM[resource],
            ticks,
          );
        }
        continue;
      }

      if (entity.kind === "smelter" || entity.kind === "fabricator") {
        const compatibleRecipes = recipesFor(entity.kind);
        const maximumProductEvents = compatibleRecipes.reduce(
          (maximum, recipe) => Math.max(maximum, recipe.products.length),
          0,
        );
        eventsPerStep = checkedIntegerSum(
          eventsPerStep,
          maximumProductEvents,
          "Simulation event budget exceeds safe integer range.",
        );
        for (const recipe of compatibleRecipes) {
          for (const product of recipe.products) {
            addProductionBound(
              product.item,
              checkedIntegerProduct(
                product.amount,
                ticks,
                "Production preflight exceeds safe integer range.",
              ),
            );
          }
        }
        if (entity.recipeChangeQueued) {
          this.assertReclaimCanAcceptInput(entity);
        }
      }
    }

    for (const fluidId of FLUID_IDS) {
      checkedIntegerSum(
        this.fluidProducedMilli[fluidId],
        checkedIntegerProduct(
          fluidProductionPerStep[fluidId],
          ticks,
          "Fluid production preflight exceeds safe integer range.",
        ),
        "Fluid production ledger exceeds safe integer range.",
      );
      checkedIntegerSum(
        this.fluidProcessedMilli[fluidId],
        checkedIntegerProduct(
          fluidProcessingPerStep[fluidId],
          ticks,
          "Fluid processing preflight exceeds safe integer range.",
        ),
        "Fluid processing ledger exceeds safe integer range.",
      );
    }
    checkedIntegerSum(
      this.fluidTransferredMilli,
      checkedIntegerProduct(
        fluidTransferPerStep,
        ticks,
        "Fluid transfer preflight exceeds safe integer range.",
      ),
      "Fluid transfer ledger exceeds safe integer range.",
    );

    this.assertCanEmitEvents(
      checkedIntegerProduct(
        eventsPerStep,
        ticks,
        "Simulation event budget exceeds safe integer range.",
      ),
    );
    this.assertCanAllocateBeltItemIds(
      checkedIntegerProduct(
        beltItemIdsPerStep,
        ticks,
        "Transport id budget exceeds safe integer range.",
      ),
    );
    this.assertProductionLedgerAdditions(productionAdditions);
    this.assertStoredItemAdditions(productionAdditions);
  }

  private invalidateLocalPower(): void {
    this.localPowerDirty = true;
    this.localPowerCache = null;
  }

  private buildLocalPowerCache(): LocalPowerCache {
    const relays: { id: number; center: GridPoint }[] = [];
    const participants: PowerParticipant[] = [];
    for (const entity of this.sortedEntities()) {
      const center = this.entityCenter(entity);
      if (entity.kind === "gridRelay") {
        relays.push({ id: entity.id, center });
      } else if (entity.kind === "generator") {
        participants.push({
          id: entity.id,
          center,
          coverageHalfWidthTiles: (entity.width - 1) / 2,
          coverageHalfHeightTiles: (entity.height - 1) / 2,
          role: "generator",
          capacity: 0,
        });
      } else if (ENTITY_PROTOTYPES[entity.kind].powerDemandKW > 0) {
        participants.push({
          id: entity.id,
          center,
          coverageHalfWidthTiles: (entity.width - 1) / 2,
          coverageHalfHeightTiles: (entity.height - 1) / 2,
          role: "consumer",
          demand: 0,
        });
      } else {
        participants.push({ id: entity.id, center, role: "passive" });
      }
    }

    const topology = rebuildPowerTopology(relays, participants);
    const plan = preparePowerDispatch(
      topology,
      participants.map((participant) => ({
        id: participant.id,
        role: participant.role,
      })),
    );
    const workspace = createPowerDispatchWorkspace(plan);
    const relayNetworkById = new Map<number, number>(
      topology.relayToNetwork,
    );
    const assignmentByEntityId = new Map<
      number,
      { relayId: number | null; networkId: number | null }
    >();
    const networkRelayCounts = new Map<number, number>();
    const networkConsumerCounts = new Map<number, number>();
    const networkGeneratorCounts = new Map<number, number>();
    for (const networkId of plan.networkIds) {
      networkRelayCounts.set(networkId, 0);
      networkConsumerCounts.set(networkId, 0);
      networkGeneratorCounts.set(networkId, 0);
    }
    for (const [, networkId] of topology.relayToNetwork) {
      networkRelayCounts.set(
        networkId,
        (networkRelayCounts.get(networkId) ?? 0) + 1,
      );
    }
    for (
      let index = 0;
      index < topology.participantRoles.length;
      index += 1
    ) {
      const [entityId, role] = topology.participantRoles[index]!;
      if (role === "passive") continue;
      const relayId = topology.participantToRelay[index]![1];
      const networkId = topology.participantToNetwork[index]![1];
      assignmentByEntityId.set(entityId, { relayId, networkId });
      if (networkId === null) continue;
      if (role === "consumer") {
        networkConsumerCounts.set(
          networkId,
          (networkConsumerCounts.get(networkId) ?? 0) + 1,
        );
      } else {
        networkGeneratorCounts.set(
          networkId,
          (networkGeneratorCounts.get(networkId) ?? 0) + 1,
        );
      }
    }

    return {
      topology,
      plan,
      workspace,
      consumerDemands: new Float64Array(plan.consumerIds.length),
      generatorCapacities: new Float64Array(plan.generatorIds.length),
      relayNetworkById,
      assignmentByEntityId,
      networkRelayCounts,
      networkConsumerCounts,
      networkGeneratorCounts,
    };
  }

  private ensureLocalPowerCache(): LocalPowerCache {
    if (!this.localPowerDirty && this.localPowerCache) {
      return this.localPowerCache;
    }
    const cache = this.buildLocalPowerCache();
    this.localPowerCache = cache;
    this.localPowerDirty = false;
    this.localPowerRebuildCount += 1;
    return cache;
  }

  private localNetworkStats(cache: LocalPowerCache): PowerNetworkStats[] {
    const networks = new Array<PowerNetworkStats>(
      cache.plan.networkIds.length,
    );
    for (
      let index = 0;
      index < cache.plan.networkIds.length;
      index += 1
    ) {
      const networkId = cache.plan.networkIds[index]!;
      networks[index] = {
        networkId,
        relayCount: cache.networkRelayCounts.get(networkId) ?? 0,
        consumerCount: cache.networkConsumerCounts.get(networkId) ?? 0,
        generatorCount: cache.networkGeneratorCounts.get(networkId) ?? 0,
        demandKW: cache.workspace.networkDemand[index] ?? 0,
        capacityKW:
          cache.workspace.networkAvailableCapacity[index] ?? 0,
        usedKW: cache.workspace.networkUsedCapacity[index] ?? 0,
        satisfaction: cache.workspace.networkSatisfaction[index] ?? 1,
      };
    }
    return networks;
  }

  private emitPowerChangeIfNeeded(satisfaction: number): void {
    if (Math.abs(satisfaction - this.lastPowerSatisfaction) < 0.025) return;
    this.emit({ type: "powerChanged", value: satisfaction });
    this.lastPowerSatisfaction = satisfaction;
  }

  private updateCircuits(): void {
    if (this.circuitNetwork.tickCount !== this._tickCount) {
      throw new Error(
        "Circuit and simulation fixed-tick counters diverged.",
      );
    }
    const machineWrites: CircuitMachineWrite[] = [];
    const entityIdByPort = new Map<string, number>();
    for (const entity of this.sortedEntities()) {
      if (!isCircuitMachineKind(entity.kind)) continue;
      const portId = circuitMachinePortId(entity.id);
      entityIdByPort.set(portId, entity.id);
      machineWrites.push({
        portId,
        signals: circuitSensorFrame(entity),
      });
    }

    const result: CircuitStepResult =
      this.circuitNetwork.step(machineWrites);
    if (result.tick !== this._tickCount) {
      throw new Error("Circuit step completed an unexpected tick.");
    }
    const controls = new Map<number, CircuitMachineControl>();
    for (const control of result.machineControls) {
      const entityId = entityIdByPort.get(control.portId);
      if (entityId === undefined || controls.has(entityId)) {
        throw new Error(
          "Circuit step returned an invalid machine-control roster.",
        );
      }
      controls.set(entityId, control);
    }
    if (controls.size !== entityIdByPort.size) {
      throw new Error(
        "Circuit step omitted a registered machine control.",
      );
    }
    this.circuitControls = controls;
    this.circuitWorkUnits = result.workUnits;
  }

  private circuitEntityEnabled(entityId: number): boolean {
    return this.circuitControls.get(entityId)?.enabled ?? true;
  }

  private circuitPowerSwitchClosed(entityId: number): boolean {
    return (
      this.circuitControls.get(entityId)?.powerSwitchClosed ?? true
    );
  }

  private circuitInserterFilter(entityId: number): ItemId | null | undefined {
    if (!this.circuitPortConfigurations.get(entityId)?.filter) {
      return undefined;
    }
    const signal = this.circuitControls.get(entityId)?.filterSignal;
    if (
      !signal ||
      signal.type !== "item" ||
      !ITEM_IDS.includes(signal.name as ItemId)
    ) {
      return null;
    }
    return signal.name as ItemId;
  }

  private circuitManifoldOutput(
    entityId: number,
  ): 0 | 1 | undefined {
    const output = this.circuitControls.get(entityId)?.sorterOutput;
    return output === CIRCUIT_SORTER_OUTPUT_A
      ? 0
      : output === CIRCUIT_SORTER_OUTPUT_B
        ? 1
        : undefined;
  }

  private stepFixed(): void {
    this.updateCircuits();
    this._tickCount += 1;
    this.updateRailNetwork();
    this.updatePower(FIXED_TICK_SECONDS);
    this.updateFluids();
    const movedTransportItems = new Set<number>();
    this.updateBelts(FIXED_TICK_SECONDS, movedTransportItems);
    this.updateManifolds(FIXED_TICK_SECONDS, movedTransportItems);
    this.updateInserters(FIXED_TICK_SECONDS);
    this.updateExtractors(FIXED_TICK_SECONDS);
    this.updateMachines(FIXED_TICK_SECONDS);
    this.updateObjectives();
  }

  private updateFluids(): void {
    const result = stepFluidNetwork(this.sortedEntities());
    for (const fluidId of FLUID_IDS) {
      this.fluidProducedMilli[fluidId] = checkedIntegerSum(
        this.fluidProducedMilli[fluidId],
        result.producedMilli[fluidId],
        "Fluid production ledger exceeds safe integer range.",
      );
      this.fluidProcessedMilli[fluidId] = checkedIntegerSum(
        this.fluidProcessedMilli[fluidId],
        result.processedMilli[fluidId],
        "Fluid processing ledger exceeds safe integer range.",
      );
    }
    this.fluidTransferredMilli = checkedIntegerSum(
      this.fluidTransferredMilli,
      result.transferredMilli,
      "Fluid transfer ledger exceeds safe integer range.",
    );
    this.fluidBackpressuredEntityIds = [
      ...result.backpressuredEntityIds,
    ];
  }

  private updatePower(deltaSeconds: number): void {
    if (this.powerMode === "legacyGlobal") {
      this.updateLegacyGlobalPower(deltaSeconds);
      return;
    }
    this.updateLocalPower(deltaSeconds);
  }

  private updateLegacyGlobalPower(deltaSeconds: number): void {
    const consumers = new Map<number, number>();
    let demandKW = 0;
    for (const entity of this.sortedEntities()) {
      entity.speedMultiplier = 1;
      entity.generatedPowerKW = 0;
      const demand = this.entityDemand(entity);
      if (demand > 0) {
        consumers.set(entity.id, demand);
        demandKW += demand;
      } else {
        entity.powerSatisfaction = this.circuitPowerSwitchClosed(
          entity.id,
        )
          ? 1
          : 0;
      }
    }

    const generators = this.sortedEntities().filter(
      (entity) => entity.kind === "generator",
    );
    let capacityKW = 0;
    const generatorCapacity = new Map<number, number>();
    for (const generator of generators) {
      const enabled = this.circuitEntityEnabled(generator.id);
      if (enabled) this.refuelGenerator(generator);
      const capacity = enabled
        ? Math.min(
            ENTITY_PROTOTYPES.generator.generationCapacityKW,
            this.generatorAvailableFuelEnergyKJ(generator) / deltaSeconds,
          )
        : 0;
      generatorCapacity.set(generator.id, Math.max(0, capacity));
      capacityKW += Math.max(0, capacity);
    }

    const satisfaction =
      demandKW <= EPSILON ? 1 : Math.min(1, capacityKW / demandKW);
    const usedKW = demandKW * satisfaction;
    for (const [entityId] of consumers) {
      const entity = this.entities.get(entityId);
      if (entity) entity.powerSatisfaction = satisfaction;
    }

    let remainingGeneration = usedKW;
    for (const generator of generators) {
      const available = generatorCapacity.get(generator.id) ?? 0;
      const generated = Math.min(available, remainingGeneration);
      generator.generatedPowerKW = generated;
      this.consumeGeneratorFuelEnergy(
        generator,
        generated * deltaSeconds,
      );
      remainingGeneration -= generated;
      if (!this.circuitEntityEnabled(generator.id)) {
        generator.status = "idle";
        generator.animationPhase = 0;
      } else if (generated > EPSILON) {
        generator.status = "working";
        generator.animationPhase =
          (generator.animationPhase + deltaSeconds * 1.7) % 1;
      } else if (
        generator.fuelEnergyKJ <= EPSILON &&
        inventoryCount(generator.fuel, "coal") === 0
      ) {
        generator.status = "noFuel";
      } else {
        generator.status = "idle";
      }
    }

    this.updateBeaconEffects(deltaSeconds);

    let storedFuelKJ = 0;
    for (const generator of generators) {
      storedFuelKJ +=
        generator.fuelEnergyKJ +
        inventoryCount(generator.fuel, "coal") * COAL_ENERGY_KJ;
    }
    const networks: PowerNetworkStats[] =
      consumers.size + generators.length === 0
        ? []
        : [
            {
              networkId: 0,
              relayCount: 0,
              consumerCount: consumers.size,
              generatorCount: generators.length,
              demandKW,
              capacityKW,
              usedKW,
              satisfaction,
            },
          ];
    this.power = {
      mode: "legacyGlobal",
      demandKW,
      capacityKW,
      usedKW,
      satisfaction,
      storedFuelKJ,
      disconnectedDemandKW: 0,
      disconnectedCapacityKW: 0,
      networks,
    };

    this.emitPowerChangeIfNeeded(satisfaction);
  }

  private updateLocalPower(deltaSeconds: number): void {
    const cache = this.ensureLocalPowerCache();
    for (const entity of this.entities.values()) {
      entity.speedMultiplier = 1;
      entity.generatedPowerKW = 0;
      if (
        entity.kind === "gridRelay" ||
        ENTITY_PROTOTYPES[entity.kind].powerDemandKW <= 0
      ) {
        entity.powerSatisfaction = 1;
      }
    }

    for (
      let index = 0;
      index < cache.plan.consumerIds.length;
      index += 1
    ) {
      const entity = this.entities.get(cache.plan.consumerIds[index]!);
      if (!entity) {
        throw new Error("Local power cache references a missing consumer.");
      }
      cache.consumerDemands[index] = this.entityDemand(entity);
    }
    for (
      let index = 0;
      index < cache.plan.generatorIds.length;
      index += 1
    ) {
      const generator = this.entities.get(cache.plan.generatorIds[index]!);
      if (!generator || generator.kind !== "generator") {
        throw new Error("Local power cache references a missing generator.");
      }
      const enabled = this.circuitEntityEnabled(generator.id);
      if (enabled) this.refuelGenerator(generator);
      cache.generatorCapacities[index] = enabled
        ? Math.max(
            0,
            Math.min(
              ENTITY_PROTOTYPES.generator.generationCapacityKW,
              this.generatorAvailableFuelEnergyKJ(generator) / deltaSeconds,
            ),
          )
        : 0;
    }

    const dispatch = dispatchPreparedPowerInto(
      cache.plan,
      {
        consumerDemands: cache.consumerDemands,
        generatorCapacities: cache.generatorCapacities,
      },
      cache.workspace,
    );
    for (
      let index = 0;
      index < cache.plan.consumerIds.length;
      index += 1
    ) {
      const consumer = this.entities.get(cache.plan.consumerIds[index]!);
      if (consumer) {
        consumer.powerSatisfaction =
          this.circuitPowerSwitchClosed(consumer.id)
            ? dispatch.consumerSatisfaction[index] ?? 0
            : 0;
      }
    }
    for (
      let index = 0;
      index < cache.plan.generatorIds.length;
      index += 1
    ) {
      const generator = this.entities.get(cache.plan.generatorIds[index]!);
      if (!generator || generator.kind !== "generator") continue;
      const generated = dispatch.generatorOutput[index] ?? 0;
      generator.generatedPowerKW = generated;
      this.consumeGeneratorFuelEnergy(
        generator,
        generated * deltaSeconds,
      );
      if (!this.circuitEntityEnabled(generator.id)) {
        generator.status = "idle";
        generator.animationPhase = 0;
      } else if (generated > EPSILON) {
        generator.status = "working";
        generator.animationPhase =
          (generator.animationPhase + deltaSeconds * 1.7) % 1;
      } else if (
        generator.fuelEnergyKJ <= EPSILON &&
        inventoryCount(generator.fuel, "coal") === 0
      ) {
        generator.status = "noFuel";
      } else {
        generator.status = "idle";
      }
    }

    this.updateBeaconEffects(deltaSeconds);

    let storedFuelKJ = 0;
    for (const generatorId of cache.plan.generatorIds) {
      const generator = this.entities.get(generatorId);
      if (!generator || generator.kind !== "generator") continue;
      storedFuelKJ +=
        generator.fuelEnergyKJ +
        inventoryCount(generator.fuel, "coal") * COAL_ENERGY_KJ;
    }
    const networks = this.localNetworkStats(cache);
    this.power = {
      mode: "local",
      demandKW: dispatch.totalDemand,
      capacityKW: dispatch.totalGeneratorCapacity,
      usedKW: dispatch.totalUsedCapacity,
      satisfaction: dispatch.globalSatisfaction,
      storedFuelKJ,
      disconnectedDemandKW: dispatch.disconnectedDemand,
      disconnectedCapacityKW: dispatch.disconnectedGeneratorCapacity,
      networks,
    };
    this.emitPowerChangeIfNeeded(dispatch.globalSatisfaction);
  }

  private updateBeaconEffects(deltaSeconds: number): void {
    for (const beacon of this.sortedEntities()) {
      if (
        beacon.kind !== "beacon" ||
        !this.circuitEntityEnabled(beacon.id) ||
        beacon.powerSatisfaction <= EPSILON
      ) {
        if (beacon.kind === "beacon") {
          beacon.status = this.circuitEntityEnabled(beacon.id)
            ? "noPower"
            : "idle";
          beacon.animationPhase = 0;
        }
        continue;
      }
      beacon.status = "working";
      beacon.animationPhase =
        (beacon.animationPhase +
          deltaSeconds * (0.7 + beacon.powerSatisfaction)) %
        1;
      const prototype = ENTITY_PROTOTYPES.beacon;
      const center = this.entityCenter(beacon);
      for (const target of this.entities.values()) {
        if (
          target.id === beacon.id ||
          !(
            target.kind === "extractor" ||
            target.kind === "smelter" ||
            target.kind === "fabricator"
          )
        ) {
          continue;
        }
        const targetCenter = this.entityCenter(target);
        if (
          Math.hypot(
            center.x - targetCenter.x,
            center.y - targetCenter.y,
          ) <=
          prototype.beaconRadius + EPSILON
        ) {
          target.speedMultiplier +=
            prototype.beaconSpeedBonus * beacon.powerSatisfaction;
        }
      }
    }
  }

  private refreshPowerPreview(): void {
    if (this.powerMode === "local") {
      this.refreshLocalPowerPreview();
      return;
    }
    let demandKW = 0;
    let capacityKW = 0;
    let storedFuelKJ = 0;
    let consumerCount = 0;
    let generatorCount = 0;
    for (const entity of this.entities.values()) {
      const demand = this.entityDemand(entity);
      demandKW += demand;
      if (ENTITY_PROTOTYPES[entity.kind].powerDemandKW > 0) {
        consumerCount += 1;
      }
      if (entity.kind === "generator") {
        generatorCount += 1;
        const stored =
          entity.fuelEnergyKJ +
          inventoryCount(entity.fuel, "coal") * COAL_ENERGY_KJ;
        storedFuelKJ += stored;
        if (
          stored > EPSILON &&
          this.circuitEntityEnabled(entity.id)
        ) {
          capacityKW += ENTITY_PROTOTYPES.generator.generationCapacityKW;
        }
      }
    }
    const satisfaction =
      demandKW <= EPSILON ? 1 : Math.min(1, capacityKW / demandKW);
    const usedKW = demandKW * satisfaction;
    this.power = {
      mode: "legacyGlobal",
      demandKW,
      capacityKW,
      usedKW,
      satisfaction,
      storedFuelKJ,
      disconnectedDemandKW: 0,
      disconnectedCapacityKW: 0,
      networks:
        consumerCount + generatorCount === 0
          ? []
          : [
              {
                networkId: 0,
                relayCount: 0,
                consumerCount,
                generatorCount,
                demandKW,
                capacityKW,
                usedKW,
                satisfaction,
              },
            ],
    };
  }

  private refreshLocalPowerPreview(): void {
    const cache = this.ensureLocalPowerCache();
    let storedFuelKJ = 0;
    for (
      let index = 0;
      index < cache.plan.consumerIds.length;
      index += 1
    ) {
      const entity = this.entities.get(cache.plan.consumerIds[index]!);
      if (!entity) {
        throw new Error("Local power cache references a missing consumer.");
      }
      cache.consumerDemands[index] = this.entityDemand(entity);
    }
    for (
      let index = 0;
      index < cache.plan.generatorIds.length;
      index += 1
    ) {
      const generator = this.entities.get(cache.plan.generatorIds[index]!);
      if (!generator || generator.kind !== "generator") {
        throw new Error("Local power cache references a missing generator.");
      }
      const stored =
        generator.fuelEnergyKJ +
        inventoryCount(generator.fuel, "coal") * COAL_ENERGY_KJ;
      storedFuelKJ += stored;
      cache.generatorCapacities[index] =
        stored > EPSILON &&
        this.circuitEntityEnabled(generator.id)
          ? ENTITY_PROTOTYPES.generator.generationCapacityKW
          : 0;
    }
    const dispatch = dispatchPreparedPowerInto(
      cache.plan,
      {
        consumerDemands: cache.consumerDemands,
        generatorCapacities: cache.generatorCapacities,
      },
      cache.workspace,
    );
    for (const entity of this.entities.values()) {
      if (
        entity.kind === "gridRelay" ||
        ENTITY_PROTOTYPES[entity.kind].powerDemandKW <= 0
      ) {
        entity.powerSatisfaction = 1;
      }
    }
    for (
      let index = 0;
      index < cache.plan.consumerIds.length;
      index += 1
    ) {
      const consumer = this.entities.get(cache.plan.consumerIds[index]!);
      if (consumer) {
        const satisfaction =
          this.circuitPowerSwitchClosed(consumer.id)
            ? dispatch.consumerSatisfaction[index] ?? 0
            : 0;
        consumer.powerSatisfaction = satisfaction;
        if (satisfaction <= EPSILON) {
          consumer.status = "noPower";
        } else if (consumer.status === "noPower") {
          consumer.status =
            consumer.kind === "beacon" ? "working" : "idle";
        }
      }
    }
    for (
      let index = 0;
      index < cache.plan.generatorIds.length;
      index += 1
    ) {
      const generator = this.entities.get(cache.plan.generatorIds[index]!);
      if (!generator || generator.kind !== "generator") continue;
      const generated = dispatch.generatorOutput[index] ?? 0;
      const stored =
        generator.fuelEnergyKJ +
        inventoryCount(generator.fuel, "coal") * COAL_ENERGY_KJ;
      generator.generatedPowerKW = generated;
      generator.status =
        generated > EPSILON
          ? "working"
          : stored <= EPSILON
            ? "noFuel"
            : "idle";
    }
    this.power = {
      mode: "local",
      demandKW: dispatch.totalDemand,
      capacityKW: dispatch.totalGeneratorCapacity,
      usedKW: dispatch.totalUsedCapacity,
      satisfaction: dispatch.globalSatisfaction,
      storedFuelKJ,
      disconnectedDemandKW: dispatch.disconnectedDemand,
      disconnectedCapacityKW: dispatch.disconnectedGeneratorCapacity,
      networks: this.localNetworkStats(cache),
    };
  }

  private refreshLocalPowerPreviewIfDirty(): void {
    if (this.powerMode === "local" && this.localPowerDirty) {
      this.refreshLocalPowerPreview();
    }
  }

  private entityDemand(entity: EntityState): number {
    const prototype = ENTITY_PROTOTYPES[entity.kind];
    if (prototype.powerDemandKW <= 0) return 0;
    if (!this.circuitPowerSwitchClosed(entity.id)) return 0;
    if (!this.circuitEntityEnabled(entity.id)) {
      return prototype.idlePowerKW;
    }

    let active = false;
    switch (entity.kind) {
      case "extractor":
        active =
          this.extractorResources(entity).length > 0 &&
          this.inventoryCanAcceptOutput(entity, RESOURCE_TO_ITEM[
            entity.miningResource ??
              this.extractorResources(entity)[0]?.type ??
              "iron"
          ]);
        break;
      case "smelter":
      case "fabricator":
        active =
          entity.activeRecipeId !== undefined ||
          this.availableRecipe(entity) !== undefined;
        break;
      case "inserter":
        active =
          entity.heldItem !== undefined ||
          this.entityAtPoint(this.backPoint(entity)) !== undefined;
        break;
      case "beacon":
        active = true;
        break;
      case "fluidPump":
        active = (entity.fluidState?.buffer?.amountMilli ?? 0) > 0;
        break;
      case "fluidProcessor":
        active =
          (entity.fluidState?.processTicks ?? 0) > 0 ||
          (entity.fluidState?.input?.amountMilli ?? 0) > 0;
        break;
      default:
        active = false;
    }
    return active ? prototype.powerDemandKW : prototype.idlePowerKW;
  }

  private refuelGenerator(generator: EntityState): void {
    if (
      generator.fuelEnergyKJ <= EPSILON &&
      removeFromInventory(generator.fuel, "coal", 1)
    ) {
      generator.fuelEnergyKJ = COAL_ENERGY_KJ;
    }
  }

  private generatorAvailableFuelEnergyKJ(generator: EntityState): number {
    return (
      generator.fuelEnergyKJ +
      inventoryCount(generator.fuel, "coal") * COAL_ENERGY_KJ
    );
  }

  /**
   * Burns an exact dispatched energy quantity across coal boundaries.
   *
   * Capacity planning includes coal waiting in the hopper, so a generator
   * with a fractional active coal must be able to ignite the next unit during
   * the same fixed tick. Otherwise every coal boundary creates a fictitious
   * one-tick brownout despite a stocked hopper.
   */
  private consumeGeneratorFuelEnergy(
    generator: EntityState,
    requestedEnergyKJ: number,
  ): void {
    let remainingEnergyKJ = Math.max(0, requestedEnergyKJ);
    while (remainingEnergyKJ > 0) {
      if (generator.fuelEnergyKJ >= remainingEnergyKJ) {
        generator.fuelEnergyKJ -= remainingEnergyKJ;
        return;
      }
      remainingEnergyKJ -= generator.fuelEnergyKJ;
      generator.fuelEnergyKJ = 0;
      if (!removeFromInventory(generator.fuel, "coal", 1)) {
        if (remainingEnergyKJ <= EPSILON) return;
        throw new Error(
          "Power dispatch exceeded the generator's available fuel energy.",
        );
      }
      generator.fuelEnergyKJ = COAL_ENERGY_KJ;
    }
  }

  private updateBelts(
    deltaSeconds: number,
    movedItems: Set<number>,
  ): void {
    const beltStates = new Map<number, 0 | 1 | 2>();
    const belts = this.sortedEntities().filter(
      (entity) => entity.kind === "belt",
    );
    for (const belt of belts) {
      if ((beltStates.get(belt.id) ?? 0) === 0) {
        this.moveBeltRecursive(
          belt,
          deltaSeconds,
          beltStates,
          movedItems,
        );
      }
    }
  }

  private moveBeltRecursive(
    belt: EntityState,
    deltaSeconds: number,
    states: Map<number, 0 | 1 | 2>,
    movedItems: Set<number>,
  ): void {
    const state = states.get(belt.id) ?? 0;
    if (state !== 0) return;
    states.set(belt.id, 1);

    const destination = this.entityAtPoint(this.frontPoint(belt));
    if (
      destination?.kind === "belt" &&
      (states.get(destination.id) ?? 0) === 0
    ) {
      this.moveBeltRecursive(
        destination,
        deltaSeconds,
        states,
        movedItems,
      );
    }

    const speed = ENTITY_PROTOTYPES.belt.beltSpeed;
    let blocked = false;
    let moving = false;
    for (const lane of [0, 1] as const) {
      const laneItems = belt.beltItems
        .filter((item) => item.lane === lane)
        .sort(stableBeltItemSort);
      let leaderProgress: number | undefined;

      for (const item of laneItems) {
        if (movedItems.has(item.id)) {
          leaderProgress = item.progress;
          continue;
        }

        const originalProgress = item.progress;
        const desired = item.progress + speed * deltaSeconds;
        if (leaderProgress === undefined && desired >= 1) {
          const overshoot = desired - 1;
          const transferred =
            destination?.kind === "belt"
              ? this.insertExistingBeltItem(
                  destination,
                  item,
                  lane,
                  overshoot,
                )
              : destination?.kind === "manifold"
                ? this.insertExistingManifoldItem(
                    destination,
                    item,
                    lane,
                    overshoot,
                    this.manifoldEntryFromBelt(destination, belt),
                  )
                : false;
          if (transferred) {
            const index = belt.beltItems.findIndex(
              (candidate) => candidate.id === item.id,
            );
            if (index >= 0) belt.beltItems.splice(index, 1);
            movedItems.add(item.id);
            moving = true;
            continue;
          }
          item.progress = BELT_END;
          blocked = true;
        } else {
          const limit =
            leaderProgress === undefined
              ? BELT_END
              : Math.max(0, leaderProgress - BELT_ITEM_SPACING);
          item.progress = Math.min(desired, limit);
        }

        movedItems.add(item.id);
        if (item.progress > originalProgress + EPSILON) moving = true;
        leaderProgress = item.progress;
      }
    }

    belt.animationPhase =
      (belt.animationPhase + speed * deltaSeconds) % 1;
    belt.status = blocked ? "blocked" : moving ? "working" : "idle";
    states.set(belt.id, 2);
  }

  private updateManifolds(
    deltaSeconds: number,
    movedItems: Set<number>,
  ): void {
    const speed = ENTITY_PROTOTYPES.manifold.beltSpeed;
    for (const manifold of this.sortedEntities()) {
      if (manifold.kind !== "manifold") continue;
      if (!this.circuitEntityEnabled(manifold.id)) {
        manifold.status = "idle";
        continue;
      }
      const routing = manifold.manifoldRouting;
      if (!routing || !isManifoldRoutingState(routing)) {
        manifold.status = "blocked";
        continue;
      }

      let blocked = false;
      let moving = false;
      for (const lane of [0, 1] as const) {
        const split = this.moveManifoldSplitLane(
          manifold,
          routing,
          lane,
          speed * deltaSeconds,
          movedItems,
        );
        const merge = this.moveManifoldMergeLane(
          manifold,
          routing,
          lane,
          speed * deltaSeconds,
          movedItems,
        );
        blocked ||= split.blocked || merge.blocked;
        moving ||= split.moving || merge.moving;
      }

      manifold.animationPhase =
        (manifold.animationPhase + speed * deltaSeconds) % 1;
      manifold.progress = manifold.beltItems.reduce(
        (maximum, item) => Math.max(maximum, item.progress),
        0,
      );
      manifold.status = blocked ? "blocked" : moving ? "working" : "idle";
    }
  }

  private moveManifoldSplitLane(
    manifold: EntityState,
    routing: ManifoldRoutingState,
    lane: 0 | 1,
    distance: number,
    movedItems: Set<number>,
  ): { blocked: boolean; moving: boolean } {
    const items = manifold.beltItems
      .filter((item) => item.lane === lane && item.port === undefined)
      .sort(stableBeltItemSort);
    let leaderProgress: number | undefined;
    let blocked = false;
    let moving = false;

    for (const item of items) {
      if (movedItems.has(item.id)) {
        leaderProgress = item.progress;
        continue;
      }

      const originalProgress = item.progress;
      const desired = item.progress + distance;
      if (leaderProgress === undefined && desired >= 1) {
        const dispatchedPort = this.dispatchManifoldSplitItem(
          manifold,
          routing,
          item,
          lane,
          desired - 1,
        );
        if (dispatchedPort !== undefined) {
          const index = manifold.beltItems.findIndex(
            (candidate) => candidate.id === item.id,
          );
          if (index >= 0) manifold.beltItems.splice(index, 1);
          movedItems.add(item.id);
          if (routing.mode === "even") {
            routing.splitCursors[lane] = dispatchedPort === 0 ? 1 : 0;
          }
          moving = true;
          continue;
        }
        item.progress = BELT_END;
        blocked = true;
      } else {
        const limit =
          leaderProgress === undefined
            ? BELT_END
            : Math.max(0, leaderProgress - BELT_ITEM_SPACING);
        item.progress = Math.min(desired, limit);
      }

      movedItems.add(item.id);
      if (item.progress > originalProgress + EPSILON) moving = true;
      leaderProgress = item.progress;
    }
    return { blocked, moving };
  }

  private moveManifoldMergeLane(
    manifold: EntityState,
    routing: ManifoldRoutingState,
    lane: 0 | 1,
    distance: number,
    movedItems: Set<number>,
  ): { blocked: boolean; moving: boolean } {
    const tracks = ([0, 1] as const).map((port) => ({
      port,
      items: manifold.beltItems
        .filter((item) => item.lane === lane && item.port === port)
        .sort(stableBeltItemSort),
    }));
    const readyPorts = tracks
      .filter(({ items }) => {
        const leader = items[0];
        return (
          leader !== undefined &&
          !movedItems.has(leader.id) &&
          leader.progress + distance >= 1
        );
      })
      .map(({ port }) => port);

    let blocked = false;
    let moving = false;
    let mergedSuccessfully = false;
    if (readyPorts.length > 0) {
      const preferred = routing.mergeCursors[lane];
      const selected = readyPorts.includes(preferred)
        ? preferred
        : readyPorts[0]!;
      const item = tracks[selected]!.items[0]!;
      const output = this.entityAtPoint(this.manifoldCommonDock(manifold));
      if (
        output?.kind === "belt" &&
        this.manifoldEntryFromBelt(manifold, output) === undefined &&
        this.insertExistingBeltItem(
          output,
          item,
          lane,
          item.progress + distance - 1,
        )
      ) {
        const index = manifold.beltItems.findIndex(
          (candidate) => candidate.id === item.id,
        );
        if (index >= 0) manifold.beltItems.splice(index, 1);
        movedItems.add(item.id);
        routing.mergeCursors[lane] = selected === 0 ? 1 : 0;
        moving = true;
        mergedSuccessfully = true;
      } else {
        blocked = true;
      }
    }

    for (const { port } of tracks) {
      const remaining = manifold.beltItems
        .filter((item) => item.lane === lane && item.port === port)
        .sort(stableBeltItemSort);
      let leaderProgress: number | undefined;
      for (const item of remaining) {
        if (movedItems.has(item.id)) {
          leaderProgress = item.progress;
          continue;
        }
        const originalProgress = item.progress;
        const desired = item.progress + distance;
        if (leaderProgress === undefined && desired >= 1) {
          item.progress = BELT_END;
          if (!mergedSuccessfully) blocked = true;
        } else {
          const limit =
            leaderProgress === undefined
              ? BELT_END
              : Math.max(0, leaderProgress - BELT_ITEM_SPACING);
          item.progress = Math.min(desired, limit);
        }
        movedItems.add(item.id);
        if (item.progress > originalProgress + EPSILON) moving = true;
        leaderProgress = item.progress;
      }
    }
    return { blocked, moving };
  }

  private dispatchManifoldSplitItem(
    manifold: EntityState,
    routing: ManifoldRoutingState,
    item: BeltItemState,
    lane: 0 | 1,
    overshoot: number,
  ): 0 | 1 | undefined {
    let ports: readonly (0 | 1)[];
    const controlledPort = this.circuitManifoldOutput(manifold.id);
    if (controlledPort !== undefined) {
      ports = [controlledPort];
    } else {
      switch (routing.mode) {
        case "even":
          ports =
            routing.splitCursors[lane] === 0
              ? ([0, 1] as const)
              : ([1, 0] as const);
          break;
        case "favorA":
          ports = [0, 1];
          break;
        case "favorB":
          ports = [1, 0];
          break;
        case "extract":
          ports = [manifoldExtractPortForItem(routing, item.item)];
          break;
      }
    }

    for (const port of ports) {
      const output = this.entityAtPoint(
        this.manifoldBranchDock(manifold, port),
      );
      if (
        output?.kind === "belt" &&
        this.manifoldEntryFromBelt(manifold, output) === undefined &&
        this.insertExistingBeltItem(output, item, lane, overshoot)
      ) {
        return port;
      }
    }
    return undefined;
  }

  private updateInserters(deltaSeconds: number): void {
    for (const inserter of this.sortedEntities()) {
      if (inserter.kind !== "inserter") continue;
      if (!this.circuitEntityEnabled(inserter.id)) {
        inserter.status = "idle";
        continue;
      }
      const power = inserter.powerSatisfaction;
      if (power <= EPSILON) {
        inserter.status = "noPower";
        continue;
      }

      const swing =
        ENTITY_PROTOTYPES.inserter.workSpeed * power * deltaSeconds;
      if (inserter.heldItem) {
        if (inserter.armProgress < 1 - EPSILON) {
          inserter.armProgress = Math.min(1, inserter.armProgress + swing);
          inserter.status = "working";
        } else {
          const target = this.entityAtPoint(this.frontPoint(inserter));
          const beltLane = target?.kind === "belt" ? 1 : undefined;
          if (
            target &&
            target.kind !== "manifold" &&
            this.canReceiveOne(target, inserter.heldItem, "auto", beltLane) &&
            this.receiveOne(
              target,
              inserter.heldItem,
              "auto",
              beltLane,
            )
          ) {
            this.emit({
              type: "itemTransferred",
              entityId: target.id,
              item: inserter.heldItem,
              amount: 1,
            });
            inserter.heldItem = undefined;
            inserter.armReturning = true;
            inserter.status = "working";
          } else {
            inserter.status = "blocked";
          }
        }
      } else if (inserter.armReturning || inserter.armProgress > EPSILON) {
        inserter.armProgress = Math.max(0, inserter.armProgress - swing);
        inserter.armReturning = inserter.armProgress > EPSILON;
        if (!inserter.armReturning) {
          inserter.heldItemSourceLane = undefined;
        }
        inserter.status = "working";
      } else {
        let pickedUp = false;
        const pickup = this.inserterPickupCandidate(inserter);
        if (pickup?.ready) {
          const taken = this.takeOne(pickup.source, pickup.item, "auto");
          if (taken) {
            this.commitTaken(pickup.source, taken);
            inserter.heldItem = pickup.item;
            inserter.heldItemSourceLane = taken.beltItem?.lane;
            inserter.armReturning = false;
            inserter.status = "working";
            pickedUp = true;
          }
        }
        if (!pickedUp) inserter.status = "idle";
      }

      inserter.animationPhase = inserter.armProgress;
    }
  }

  /**
   * Selects the exact candidate the next pickup will claim. The renderer uses
   * this same decision before contact, preventing a lane snap when an
   * incompatible leading payload is skipped for compatible traffic.
   */
  private inserterPickupCandidate(
    inserter: EntityState,
  ): InserterPickupCandidate | undefined {
    const circuitFilter = this.circuitInserterFilter(inserter.id);
    if (circuitFilter === null) return undefined;
    const filterAccepts = (item: ItemId): boolean =>
      circuitFilter === undefined || item === circuitFilter;
    const source = this.entityAtPoint(this.backPoint(inserter));
    const target = this.entityAtPoint(this.frontPoint(inserter));
    if (
      !source ||
      !target ||
      source.kind === "manifold" ||
      target.kind === "manifold"
    ) {
      return undefined;
    }

    const targetLane = target.kind === "belt" ? 1 : undefined;
    if (source.kind === "belt") {
      const pickupContact = this.inserterBeltPickupContact(
        source,
        inserter,
      );
      const beltItem = source.beltItems
        .slice()
        .sort(stableBeltItemSort)
        .find(
          (candidate) =>
            filterAccepts(candidate.item) &&
            this.canReceiveOne(
              target,
              candidate.item,
              "auto",
              targetLane,
            ),
        );
      if (!beltItem) return undefined;
      return {
        source,
        item: beltItem.item,
        sourceLane: beltItem.lane,
        ready: beltItem.progress >= pickupContact - EPSILON,
      };
    }

    if (source.kind === "inserter") {
      const sourceDrop = this.frontPoint(source);
      if (
        sourceDrop.x !== inserter.x ||
        sourceDrop.y !== inserter.y ||
        !source.heldItem ||
        !filterAccepts(source.heldItem) ||
        !this.canReceiveOne(target, source.heldItem, "auto", targetLane)
      ) {
        return undefined;
      }
      return {
        source,
        item: source.heldItem,
        ready: source.armProgress >= 1 - EPSILON,
      };
    }

    const item = this.sourceItems(source, "auto").find(
      (candidate) =>
        filterAccepts(candidate) &&
        this.canReceiveOne(target, candidate, "auto", targetLane),
    );
    return item === undefined
      ? undefined
      : { source, item, ready: true };
  }

  /**
   * Belt progress is measured along the belt's own forward axis. An inserter
   * therefore meets cargo at the belt exit when the belt points toward the
   * arm, at mid-tile for a perpendicular side pickup, and just after entry
   * when the belt points away. This geometric contact lets a side inserter
   * claim moving cargo without requiring downstream congestion, while the
   * established end-of-belt custody boundary remains unchanged.
   */
  private inserterBeltPickupContact(
    source: EntityState,
    inserter: EntityState,
  ): number {
    const beltForward = directionVector(source.direction);
    const sourceToInserterX = inserter.x - source.x;
    const sourceToInserterY = inserter.y - source.y;
    const alignment =
      beltForward.x * sourceToInserterX +
      beltForward.y * sourceToInserterY;
    if (alignment > 0) return BELT_OUTPUT_CONTACT;
    if (alignment < 0) return 1 - BELT_OUTPUT_CONTACT;
    return 0.5;
  }

  private updateExtractors(deltaSeconds: number): void {
    for (const extractor of this.sortedEntities()) {
      if (extractor.kind !== "extractor") continue;
      if (!this.circuitEntityEnabled(extractor.id)) {
        extractor.status = "idle";
        continue;
      }
      this.flushExtractorOutput(extractor);

      const resources = this.extractorResources(extractor);
      if (extractor.miningResource) {
        const stillAvailable = resources.some(
          (resource) => resource.type === extractor.miningResource,
        );
        if (!stillAvailable) extractor.miningResource = undefined;
      }
      extractor.miningResource ??= resources[0]?.type;
      const resource = resources.find(
        (candidate) => candidate.type === extractor.miningResource,
      );

      if (!resource) {
        extractor.status = "noResource";
        extractor.progress = 0;
        continue;
      }
      const product = RESOURCE_TO_ITEM[resource.type];
      if (!this.inventoryCanAcceptOutput(extractor, product)) {
        extractor.status = "outputFull";
        continue;
      }
      if (extractor.powerSatisfaction <= EPSILON) {
        extractor.status = "noPower";
        continue;
      }

      const speed =
        ENTITY_PROTOTYPES.extractor.workSpeed *
        extractor.speedMultiplier *
        extractor.powerSatisfaction;
      const nextProgress = extractor.progress + speed * deltaSeconds;
      if (nextProgress + EPSILON >= 1) {
        this.assertProductionCanCommit(
          [{ item: product, amount: 1 }],
          resource.amount <= 1 ? 1 : 0,
        );
      }
      extractor.progress = nextProgress;
      extractor.animationPhase =
        (extractor.animationPhase + speed * deltaSeconds * 1.8) % 1;
      extractor.status = "working";

      if (extractor.progress + EPSILON >= 1) {
        extractor.progress = Math.max(0, extractor.progress - 1);
        resource.amount -= 1;
        addToInventory(extractor.output, product, 1);
        this.recordProduction(extractor, product, 1);
        if (resource.amount <= 0) {
          this.resources.delete(this.resourceKey(resource.x, resource.y));
          this.emit({
            type: "resourceDepleted",
            entityId: extractor.id,
            x: resource.x,
            y: resource.y,
          });
        }
        this.flushExtractorOutput(extractor);
      }
    }
  }

  private flushExtractorOutput(extractor: EntityState): boolean {
    const target = this.entityAtPoint(this.frontPoint(extractor));
    if (!target) return false;
    for (const item of ITEM_IDS) {
      if (inventoryCount(extractor.output, item) <= 0) continue;
      if (!this.canReceiveOne(target, item, "auto")) return false;
      if (!this.receiveOne(target, item, "auto")) return false;
      removeFromInventory(extractor.output, item, 1);
      this.emit({
        type: "itemTransferred",
        entityId: target.id,
        item,
        amount: 1,
      });
      return true;
    }
    return false;
  }

  private updateMachines(deltaSeconds: number): void {
    for (const machine of this.sortedEntities()) {
      if (machine.kind !== "smelter" && machine.kind !== "fabricator") {
        continue;
      }
      if (!this.circuitEntityEnabled(machine.id)) {
        machine.status = "idle";
        continue;
      }

      let recipeId = machine.activeRecipeId;
      if (!recipeId) {
        // A valid queued state always owns an active craft. Keep this fallback
        // deterministic for forward-compatible restores and future machine
        // implementations: no new craft may begin before the boundary.
        if (machine.recipeChangeQueued) {
          this.applyRecipeConfiguration(
            machine,
            machine.pendingRecipeId ?? null,
          );
        }
        recipeId = this.availableRecipe(machine);
        if (!recipeId) {
          machine.status =
            machine.kind === "fabricator" &&
            machine.recipeId === undefined
              ? "unconfigured"
              : "missingInput";
          machine.progress = 0;
          continue;
        }
        if (!this.canFitRecipeProducts(machine, recipeId)) {
          machine.status = "outputFull";
          continue;
        }
        this.consumeRecipeIngredients(machine, recipeId);
        machine.activeRecipeId = recipeId;
        machine.progress = 0;
      }

      if (machine.powerSatisfaction <= EPSILON) {
        machine.status = "noPower";
        continue;
      }
      if (!this.canFitRecipeProducts(machine, recipeId)) {
        machine.status = "outputFull";
        machine.progress = Math.min(1, machine.progress);
        continue;
      }

      const prototype = ENTITY_PROTOTYPES[machine.kind];
      const recipe = RECIPES[recipeId];
      const effectiveSpeed =
        prototype.workSpeed *
        machine.speedMultiplier *
        machine.powerSatisfaction;
      const nextProgress =
        machine.progress +
        (effectiveSpeed * deltaSeconds) / recipe.durationSeconds;
      if (nextProgress + EPSILON >= 1) {
        this.assertProductionCanCommit(recipe.products);
      }
      machine.progress = nextProgress;
      machine.animationPhase =
        (machine.animationPhase + effectiveSpeed * deltaSeconds) % 1;
      machine.status = machine.recipeChangeQueued
        ? "changingRecipe"
        : "working";

      if (machine.progress + EPSILON >= 1) {
        machine.progress = 0;
        machine.activeRecipeId = undefined;
        for (const product of recipe.products) {
          addToInventory(machine.output, product.item, product.amount);
          this.recordProduction(machine, product.item, product.amount);
        }
        if (machine.recipeChangeQueued) {
          this.applyRecipeConfiguration(
            machine,
            machine.pendingRecipeId ?? null,
          );
        }
      }
    }
  }

  private availableRecipe(machine: EntityState): RecipeId | undefined {
    if (machine.kind !== "smelter" && machine.kind !== "fabricator") {
      return undefined;
    }
    if (machine.recipeId) {
      return hasIngredients(machine.input, machine.recipeId)
        ? machine.recipeId
        : undefined;
    }
    if (machine.kind !== "smelter") return undefined;
    return recipesFor("smelter").find((recipe) =>
      hasIngredients(machine.input, recipe.id),
    )?.id;
  }

  private applyRecipeConfiguration(
    machine: EntityState,
    recipeId: RecipeId | null,
  ): void {
    this.assertReclaimCanAcceptInput(machine);
    for (const item of ITEM_IDS) {
      const amount = inventoryCount(machine.input, item);
      if (amount <= 0) continue;
      addToInventory(machine.reclaim, item, amount);
      delete machine.input[item];
    }
    machine.recipeId = recipeId ?? undefined;
    machine.activeRecipeId = undefined;
    machine.recipeChangeQueued = false;
    machine.pendingRecipeId = undefined;
    machine.progress = 0;
    machine.status = "changingRecipe";
  }

  private assertReclaimCanAcceptInput(machine: EntityState): void {
    for (const item of ITEM_IDS) {
      checkedIntegerSum(
        inventoryCount(machine.reclaim, item),
        inventoryCount(machine.input, item),
        "Reclaim inventory exceeds safe integer range.",
      );
    }
  }

  private consumeRecipeIngredients(
    machine: EntityState,
    recipeId: RecipeId,
  ): void {
    for (const ingredient of RECIPES[recipeId].ingredients) {
      removeFromInventory(machine.input, ingredient.item, ingredient.amount);
    }
  }

  private canFitRecipeProducts(
    machine: EntityState,
    recipeId: RecipeId,
  ): boolean {
    const prototype = ENTITY_PROTOTYPES[machine.kind];
    const inventory = cloneInventory(machine.output);
    for (const product of RECIPES[recipeId].products) {
      if (
        !canInventoryAccept(
          inventory,
          product.item,
          product.amount,
          prototype.outputSlots,
        )
      ) {
        return false;
      }
      addToInventory(inventory, product.item, product.amount);
    }
    return true;
  }

  private updateObjectives(): void {
    for (let index = 0; index < OBJECTIVES.length; index += 1) {
      const objective = OBJECTIVES[index];
      if (!objective || this.objectiveCompletedTicks.has(objective.id)) continue;
      const previous = OBJECTIVES[index - 1];
      if (
        previous &&
        !this.objectiveCompletedTicks.has(previous.id)
      ) {
        break;
      }
      if (this.produced[objective.item] < objective.amount) break;
      this.assertCanEmitEvents(1);
      this.objectiveCompletedTicks.set(objective.id, this._tickCount);
      this.emit({
        type: "objectiveCompleted",
        objectiveId: objective.id,
        item: objective.item,
        amount: objective.amount,
      });
    }
  }

  private recordProduction(
    entity: EntityState,
    item: ItemId,
    amount: number,
  ): void {
    // The payload has already been inserted into machine output. Every caller
    // reserves stored-item headroom before that mutation, so the backstop here
    // must cover only the still-pending ledger and event additions.
    this.assertProductionCanCommit([{ item, amount }], 0, false);
    this.produced[item] += amount;
    this.emit({
      type: "itemProduced",
      entityId: entity.id,
      item,
      amount,
      x: entity.x,
      y: entity.y,
    });
  }

  private assertProductionCanCommit(
    products: readonly { item: ItemId; amount: number }[],
    additionalEventCount = 0,
    includeStoredItemAdditions = true,
  ): void {
    const additions = new Map<ItemId, number>();
    for (const product of products) {
      if (
        !Number.isSafeInteger(product.amount) ||
        product.amount <= 0
      ) {
        throw new Error("Production amount must be a positive safe integer.");
      }
      additions.set(
        product.item,
        (additions.get(product.item) ?? 0) + product.amount,
      );
    }
    this.assertProductionLedgerAdditions(additions);
    if (includeStoredItemAdditions) {
      this.assertStoredItemAdditions(additions);
    }
    this.assertCanEmitEvents(products.length + additionalEventCount);
  }

  private assertProductionLedgerAdditions(
    additions: ReadonlyMap<ItemId, number>,
  ): void {
    for (const [item, amount] of additions) {
      checkedIntegerSum(
        this.produced[item],
        amount,
        "Production ledger exceeds safe integer range.",
      );
    }
  }

  private storedItemTotalsChecked(): Record<ItemId, number> {
    const totals = emptyItemRecord();
    const add = (item: ItemId, amount: number): void => {
      totals[item] = checkedIntegerSum(
        totals[item],
        amount,
        "Stored item totals exceed safe integer range.",
      );
    };

    for (const entity of this.entities.values()) {
      for (const inventory of [
        entity.inventory,
        entity.input,
        entity.output,
        entity.reclaim,
        entity.fuel,
      ]) {
        for (const item of ITEM_IDS) {
          add(item, inventoryCount(inventory, item));
        }
      }
      for (const beltItem of entity.beltItems) add(beltItem.item, 1);
      if (entity.heldItem) add(entity.heldItem, 1);
    }
    for (const train of this.railNetwork?.snapshot().trains ?? []) {
      for (const cargo of train.cargo) {
        add(cargo.itemId as ItemId, cargo.count);
      }
    }
    return totals;
  }

  private assertStoredItemAdditions(
    additions: ReadonlyMap<ItemId, number>,
  ): void {
    const totals = this.storedItemTotalsChecked();
    for (const [item, amount] of additions) {
      totals[item] = checkedIntegerSum(
        totals[item],
        amount,
        "Stored item totals exceed safe integer range.",
      );
    }
  }

  private resourceTotalsChecked(): Record<ResourceId, number> {
    const totals = emptyResourceRecord();
    for (const resource of this.resources.values()) {
      totals[resource.type] = checkedIntegerSum(
        totals[resource.type],
        resource.amount,
        "Resource totals exceed safe integer range.",
      );
    }
    return totals;
  }

  private assertResourceReplacementSafe(
    key: string,
    type: ResourceId,
    amount: number,
  ): void {
    const totals = this.resourceTotalsChecked();
    const existing = this.resources.get(key);
    const withoutExisting =
      existing?.type === type
        ? totals[type] - existing.amount
        : totals[type];
    checkedIntegerSum(
      withoutExisting,
      amount,
      "Resource totals exceed safe integer range.",
    );
  }

  private assertCanEmitEvents(eventCount: number): void {
    let finalNextEventId: number;
    try {
      finalNextEventId = checkedIntegerSum(
        this.nextEventId,
        eventCount,
        "Simulation event id exceeds safe integer range.",
      );
    } catch {
      throw new Error("Simulation event id exceeds safe integer range.");
    }
    if (
      eventCount < 0 ||
      !isSafelyIncrementablePositiveInteger(this.nextEventId) ||
      !isSafelyIncrementablePositiveInteger(finalNextEventId)
    ) {
      throw new Error("Simulation event id exceeds safe integer range.");
    }
  }

  private assertCanAllocateEntityIds(entityCount: number): void {
    const finalNextEntityId = checkedIntegerSum(
      this.nextEntityId,
      entityCount,
      "Entity id exceeds signed occupancy range.",
    );
    if (
      !Number.isSafeInteger(entityCount) ||
      entityCount < 0 ||
      !Number.isInteger(this.nextEntityId) ||
      this.nextEntityId <= 0 ||
      finalNextEntityId > MAX_ENTITY_ID
    ) {
      throw new Error("Entity id exceeds signed occupancy range.");
    }
  }

  private assertCanAllocateBeltItemIds(itemCount: number): void {
    let finalNextItemId: number;
    try {
      finalNextItemId = checkedIntegerSum(
        this.nextBeltItemId,
        itemCount,
        "Transport payload id exceeds safe integer range.",
      );
    } catch {
      throw new Error("Transport payload id exceeds safe integer range.");
    }
    if (
      itemCount < 0 ||
      !isSafelyIncrementablePositiveInteger(this.nextBeltItemId) ||
      !isSafelyIncrementablePositiveInteger(finalNextItemId)
    ) {
      throw new Error("Transport payload id exceeds safe integer range.");
    }
  }

  private maximumPotentialReceiveCount(
    entity: EntityState,
    item: ItemId,
    requestedCount: number,
    compartment: InventoryCompartment,
    lane?: 0 | 1,
  ): number {
    if (entity.kind === "belt" || entity.kind === "manifold") {
      // A public receive inserts at progress zero. At most one payload can
      // occupy each preserved lane at that contact during the call.
      return Math.min(requestedCount, lane === undefined ? 2 : 1);
    }
    const resolved = this.resolveReceiveCompartment(
      entity,
      item,
      compartment,
    );
    if (!resolved) return 0;
    const maximumCompartmentUnits = checkedIntegerProduct(
      this.compartmentSlots(entity, resolved),
      ITEMS[item].stackSize,
      "Inventory capacity exceeds safe integer range.",
    );
    return Math.min(requestedCount, maximumCompartmentUnits);
  }

  private canReceiveOne(
    entity: EntityState,
    item: ItemId,
    compartment: InventoryCompartment,
    lane?: 0 | 1,
  ): boolean {
    if (entity.kind === "belt") {
      if (compartment !== "auto" && compartment !== "belt") return false;
      return this.findBeltLane(entity, 0, lane) !== undefined;
    }
    if (entity.kind === "manifold") {
      if (compartment !== "auto" && compartment !== "belt") return false;
      return this.findManifoldLane(entity, 0, lane) !== undefined;
    }
    if (
      (entity.kind === "smelter" || entity.kind === "fabricator") &&
      entity.recipeChangeQueued &&
      (compartment === "auto" || compartment === "input")
    ) {
      return false;
    }

    const resolved = this.resolveReceiveCompartment(entity, item, compartment);
    if (!resolved) return false;
    const inventory = this.inventoryForCompartment(entity, resolved);
    if (!inventory) return false;
    const slots = this.compartmentSlots(entity, resolved);
    if (!canInventoryAccept(inventory, item, 1, slots)) return false;

    if (
      (entity.kind === "smelter" || entity.kind === "fabricator") &&
      resolved === "input" &&
      compartment === "auto"
    ) {
      const relevantRecipes = entity.recipeId
        ? [RECIPES[entity.recipeId]]
        : recipesFor(entity.kind);
      const ingredient = relevantRecipes
        .flatMap((recipe) => recipe.ingredients)
        .find((candidate) => candidate.item === item);
      if (!ingredient) return false;
      const insertionLimit = Math.max(ingredient.amount * 4, ingredient.amount);
      if (inventoryCount(entity.input, item) >= insertionLimit) return false;
    }
    return true;
  }

  private receiveOne(
    entity: EntityState,
    item: ItemId,
    compartment: InventoryCompartment,
    lane?: 0 | 1,
  ): boolean {
    if (!this.canReceiveOne(entity, item, compartment, lane)) return false;
    if (entity.kind === "belt") {
      const selectedLane = this.findBeltLane(entity, 0, lane);
      if (selectedLane === undefined) return false;
      entity.beltItems.push({
        id: this.nextBeltItemId,
        item,
        lane: selectedLane,
        progress: 0,
      });
      this.nextBeltItemId += 1;
      return true;
    }
    if (entity.kind === "manifold") {
      const selectedLane = this.findManifoldLane(entity, 0, lane);
      if (selectedLane === undefined) return false;
      entity.beltItems.push({
        id: this.nextBeltItemId,
        item,
        lane: selectedLane,
        progress: 0,
      });
      this.nextBeltItemId += 1;
      return true;
    }

    const resolved = this.resolveReceiveCompartment(entity, item, compartment);
    if (!resolved) return false;
    const inventory = this.inventoryForCompartment(entity, resolved);
    if (!inventory) return false;
    addToInventory(inventory, item, 1);
    return true;
  }

  private resolveReceiveCompartment(
    entity: EntityState,
    item: ItemId,
    requested: InventoryCompartment,
  ): InventoryCompartment | undefined {
    if (requested !== "auto") {
      if (
        requested === "inventory" &&
        entity.kind === "storage"
      ) {
        return requested;
      }
      if (requested === "fuel" && entity.kind === "generator" && item === "coal") {
        return requested;
      }
      if (
        requested === "input" &&
        (entity.kind === "smelter" || entity.kind === "fabricator")
      ) {
        return requested;
      }
      if (
        requested === "output" &&
        (entity.kind === "extractor" ||
          entity.kind === "smelter" ||
          entity.kind === "fabricator")
      ) {
        return requested;
      }
      return undefined;
    }

    switch (entity.kind) {
      case "storage":
        return "inventory";
      case "generator":
        return item === "coal" ? "fuel" : undefined;
      case "smelter": {
        const recipes = entity.recipeId
          ? [RECIPES[entity.recipeId]]
          : recipesFor("smelter");
        return recipes.some((recipe) =>
          recipe.ingredients.some((ingredient) => ingredient.item === item),
        )
          ? "input"
          : undefined;
      }
      case "fabricator":
        return entity.recipeId &&
          RECIPES[entity.recipeId].ingredients.some(
            (ingredient) => ingredient.item === item,
          )
          ? "input"
          : undefined;
      default:
        return undefined;
    }
  }

  private inventoryForCompartment(
    entity: EntityState,
    compartment: InventoryCompartment,
  ): Inventory | undefined {
    switch (compartment) {
      case "inventory":
        return entity.inventory;
      case "input":
        return entity.input;
      case "output":
        return entity.output;
      case "reclaim":
        return entity.reclaim;
      case "fuel":
        return entity.fuel;
      default:
        return undefined;
    }
  }

  private compartmentSlots(
    entity: EntityState,
    compartment: InventoryCompartment,
  ): number {
    const prototype = ENTITY_PROTOTYPES[entity.kind];
    switch (compartment) {
      case "inventory":
        return prototype.inventorySlots;
      case "input":
        return prototype.inputSlots;
      case "output":
        return prototype.outputSlots;
      case "reclaim":
        // Reclaim is source-only. Its contents originate in the bounded input
        // compartment and cannot be inserted into directly.
        return 0;
      case "fuel":
        return entity.kind === "generator" ? 1 : 0;
      default:
        return 0;
    }
  }

  private sourceItems(
    entity: EntityState,
    compartment: InventoryCompartment,
  ): ItemId[] {
    if (entity.kind === "belt" || entity.kind === "manifold") {
      if (compartment !== "auto" && compartment !== "belt") return [];
      return entity.beltItems
        .slice()
        .sort(stableBeltItemSort)
        .map((beltItem) => beltItem.item);
    }
    if (entity.kind === "inserter" && entity.heldItem) {
      return [entity.heldItem];
    }
    if (
      compartment === "auto" &&
      (entity.kind === "smelter" || entity.kind === "fabricator")
    ) {
      const reclaimItems = ITEM_IDS.filter(
        (item) => inventoryCount(entity.reclaim, item) > 0,
      );
      const productItems = ITEM_IDS.filter(
        (item) =>
          inventoryCount(entity.output, item) > 0 &&
          inventoryCount(entity.reclaim, item) === 0,
      );
      return [...reclaimItems, ...productItems];
    }

    let inventory: Inventory | undefined;
    if (compartment !== "auto") {
      inventory = this.inventoryForCompartment(entity, compartment);
    } else {
      switch (entity.kind) {
        case "storage":
          inventory = entity.inventory;
          break;
        case "extractor":
        case "smelter":
        case "fabricator":
          inventory = entity.output;
          break;
        case "generator":
          inventory = entity.fuel;
          break;
      }
    }
    if (!inventory) return [];
    return ITEM_IDS.filter((item) => inventoryCount(inventory, item) > 0);
  }

  private takeOne(
    entity: EntityState,
    item: ItemId,
    compartment: InventoryCompartment,
  ): TakenItem | undefined {
    if (entity.kind === "belt" || entity.kind === "manifold") {
      if (compartment !== "auto" && compartment !== "belt") return undefined;
      const beltItem = entity.beltItems
        .filter((candidate) => candidate.item === item)
        .sort(stableBeltItemSort)[0];
      if (!beltItem) return undefined;
      const index = entity.beltItems.findIndex(
        (candidate) => candidate.id === beltItem.id,
      );
      if (index < 0) return undefined;
      entity.beltItems.splice(index, 1);
      return {
        item,
        compartment: "belt",
        beltItem: { ...beltItem },
      };
    }
    if (entity.kind === "inserter" && entity.heldItem === item) {
      const heldItemSourceLane = entity.heldItemSourceLane;
      const inserterArmReturning = entity.armReturning;
      entity.heldItem = undefined;
      return {
        item,
        compartment: "auto",
        ...(heldItemSourceLane === undefined ? {} : { heldItemSourceLane }),
        inserterArmReturning,
      };
    }

    let resolved = compartment;
    if (resolved === "auto") {
      if (
        (entity.kind === "smelter" || entity.kind === "fabricator") &&
        inventoryCount(entity.reclaim, item) > 0
      ) {
        resolved = "reclaim";
      } else {
        resolved =
          entity.kind === "storage"
            ? "inventory"
            : entity.kind === "generator"
              ? "fuel"
              : "output";
      }
    }
    const inventory = this.inventoryForCompartment(entity, resolved);
    if (!inventory || !removeFromInventory(inventory, item, 1)) return undefined;
    return { item, compartment: resolved };
  }

  private restoreTaken(entity: EntityState, taken: TakenItem): void {
    if (taken.beltItem) {
      entity.beltItems.push({ ...taken.beltItem });
      return;
    }
    if (entity.kind === "inserter" && taken.compartment === "auto") {
      entity.heldItem = taken.item;
      entity.heldItemSourceLane = taken.heldItemSourceLane;
      entity.armReturning = taken.inserterArmReturning ?? false;
      return;
    }
    const inventory = this.inventoryForCompartment(
      entity,
      taken.compartment,
    );
    if (inventory) addToInventory(inventory, taken.item, 1);
  }

  private commitTaken(entity: EntityState, taken: TakenItem): void {
    if (
      entity.kind !== "inserter" ||
      taken.compartment !== "auto" ||
      taken.inserterArmReturning === undefined
    ) {
      return;
    }
    if (entity.armProgress > EPSILON) {
      entity.armReturning = true;
      entity.status = "working";
      // Keep heldItemSourceLane authoritative until the retract reaches home.
      return;
    }
    entity.armProgress = 0;
    entity.animationPhase = 0;
    entity.armReturning = false;
    entity.heldItemSourceLane = undefined;
  }

  private findBeltLane(
    belt: EntityState,
    progress: number,
    preferred?: 0 | 1,
  ): 0 | 1 | undefined {
    const lanes =
      preferred === undefined
        ? ([0, 1] as const).slice().sort((a, b) => {
            const countA = belt.beltItems.filter((item) => item.lane === a).length;
            const countB = belt.beltItems.filter((item) => item.lane === b).length;
            return countA - countB || a - b;
          })
        : [preferred];
    return lanes.find((lane) =>
      this.canInsertBeltAt(belt, lane, progress),
    );
  }

  private canInsertBeltAt(
    belt: EntityState,
    lane: 0 | 1,
    progress: number,
  ): boolean {
    const items = belt.beltItems
      .filter((item) => item.lane === lane)
      .sort((a, b) => a.progress - b.progress || a.id - b.id);
    if (items.length >= BELT_LANE_CAPACITY) return false;
    const nearest = items[0];
    return (
      nearest === undefined ||
      nearest.progress - progress >= BELT_ITEM_SPACING - EPSILON
    );
  }

  private insertExistingBeltItem(
    belt: EntityState,
    item: BeltItemState,
    lane: 0 | 1,
    progress: number,
  ): boolean {
    const clamped = Math.max(0, Math.min(BELT_END, progress));
    if (!this.canInsertBeltAt(belt, lane, clamped)) return false;
    // `port` is meaningful only while a payload is inside a manifold. Strip
    // it at the belt boundary so local A/B identity cannot leak through the
    // downstream transport graph or invalidate a serialized save.
    const { port: _manifoldPort, ...beltItem } = item;
    belt.beltItems.push({ ...beltItem, lane, progress: clamped });
    return true;
  }

  private insertExistingManifoldItem(
    manifold: EntityState,
    item: BeltItemState,
    lane: 0 | 1,
    progress: number,
    entry: ManifoldEntry | undefined,
  ): boolean {
    if (entry === undefined || manifold.kind !== "manifold") return false;
    const routing = manifold.manifoldRouting;
    if (!routing || !isManifoldRoutingState(routing)) return false;
    const port = entry === "common" ? undefined : entry;
    if (
      routing.mode === "extract" &&
      port !== undefined &&
      !manifoldExtractItemBelongsOnPort(routing, item.item, port)
    ) {
      return false;
    }
    const clamped = Math.max(0, Math.min(BELT_END, progress));
    if (!this.canInsertManifoldAt(manifold, lane, clamped, port)) return false;
    const inserted: BeltItemState = {
      id: item.id,
      item: item.item,
      lane,
      progress: clamped,
      ...(port === undefined ? {} : { port }),
    };
    manifold.beltItems.push(inserted);
    return true;
  }

  private canInsertManifoldAt(
    manifold: EntityState,
    lane: 0 | 1,
    progress: number,
    port?: 0 | 1,
  ): boolean {
    const items = manifold.beltItems
      .filter(
        (item) =>
          item.lane === lane &&
          item.port === port,
      )
      .sort((a, b) => a.progress - b.progress || a.id - b.id);
    if (items.length >= BELT_LANE_CAPACITY) return false;
    const nearest = items[0];
    return (
      nearest === undefined ||
      nearest.progress - progress >= BELT_ITEM_SPACING - EPSILON
    );
  }

  private findManifoldLane(
    manifold: EntityState,
    progress: number,
    preferred?: 0 | 1,
  ): 0 | 1 | undefined {
    const lanes =
      preferred === undefined
        ? ([0, 1] as const).slice().sort((a, b) => {
            const countA = manifold.beltItems.filter(
              (item) => item.lane === a && item.port === undefined,
            ).length;
            const countB = manifold.beltItems.filter(
              (item) => item.lane === b && item.port === undefined,
            ).length;
            return countA - countB || a - b;
          })
        : [preferred];
    return lanes.find((lane) =>
      this.canInsertManifoldAt(manifold, lane, progress),
    );
  }

  private inventoryCanAcceptOutput(
    entity: EntityState,
    item: ItemId,
  ): boolean {
    return canInventoryAccept(
      entity.output,
      item,
      1,
      ENTITY_PROTOTYPES[entity.kind].outputSlots,
    );
  }

  private extractorResources(extractor: EntityState): ResourceCell[] {
    const radius = ENTITY_PROTOTYPES.extractor.extractionRadius;
    return this.resourcesInArea(
      extractor.x - radius,
      extractor.y - radius,
      extractor.width + radius * 2,
      extractor.height + radius * 2,
    );
  }

  private resourcesInArea(
    x: number,
    y: number,
    width: number,
    height: number,
  ): ResourceCell[] {
    const resources: ResourceCell[] = [];
    for (let dy = 0; dy < height; dy += 1) {
      for (let dx = 0; dx < width; dx += 1) {
        const resource = this.resources.get(
          this.resourceKey(x + dx, y + dy),
        );
        if (resource && resource.amount > 0) resources.push(resource);
      }
    }
    return resources.sort(stableResourceSort);
  }

  private frontPoint(entity: EntityState): GridPoint {
    switch (entity.direction) {
      case Direction.North:
        return {
          x: entity.x + Math.floor((entity.width - 1) / 2),
          y: entity.y - 1,
        };
      case Direction.East:
        return {
          x: entity.x + entity.width,
          y: entity.y + Math.floor((entity.height - 1) / 2),
        };
      case Direction.South:
        return {
          x: entity.x + Math.floor((entity.width - 1) / 2),
          y: entity.y + entity.height,
        };
      case Direction.West:
        return {
          x: entity.x - 1,
          y: entity.y + Math.floor((entity.height - 1) / 2),
        };
    }
  }

  private backPoint(entity: EntityState): GridPoint {
    switch (entity.direction) {
      case Direction.North:
        return {
          x: entity.x + Math.floor((entity.width - 1) / 2),
          y: entity.y + entity.height,
        };
      case Direction.East:
        return {
          x: entity.x - 1,
          y: entity.y + Math.floor((entity.height - 1) / 2),
        };
      case Direction.South:
        return {
          x: entity.x + Math.floor((entity.width - 1) / 2),
          y: entity.y - 1,
        };
      case Direction.West:
        return {
          x: entity.x + entity.width,
          y: entity.y + Math.floor((entity.height - 1) / 2),
        };
    }
  }

  private manifoldJunctionTile(manifold: EntityState): GridPoint {
    switch (manifold.direction) {
      case Direction.North:
        return { x: manifold.x, y: manifold.y };
      case Direction.East:
        return {
          x: manifold.x + manifold.width - 1,
          y: manifold.y,
        };
      case Direction.South:
        return {
          x: manifold.x,
          y: manifold.y + manifold.height - 1,
        };
      case Direction.West:
        return { x: manifold.x, y: manifold.y };
    }
  }

  private manifoldRearTile(manifold: EntityState): GridPoint {
    const junction = this.manifoldJunctionTile(manifold);
    const forward = directionVector(manifold.direction);
    return {
      x: junction.x - forward.x,
      y: junction.y - forward.y,
    };
  }

  private manifoldCommonDock(manifold: EntityState): GridPoint {
    const rear = this.manifoldRearTile(manifold);
    const forward = directionVector(manifold.direction);
    return {
      x: rear.x - forward.x,
      y: rear.y - forward.y,
    };
  }

  private manifoldBranchDock(
    manifold: EntityState,
    port: 0 | 1,
  ): GridPoint {
    const junction = this.manifoldJunctionTile(manifold);
    const branchDirection = rotateDirection(
      manifold.direction,
      port === 1,
    );
    const branch = directionVector(branchDirection);
    return {
      x: junction.x + branch.x,
      y: junction.y + branch.y,
    };
  }

  private manifoldEntryFromBelt(
    manifold: EntityState,
    belt: EntityState,
  ): ManifoldEntry | undefined {
    const common = this.manifoldCommonDock(manifold);
    if (
      belt.x === common.x &&
      belt.y === common.y &&
      belt.direction === manifold.direction
    ) {
      return "common";
    }
    for (const port of [0, 1] as const) {
      const dock = this.manifoldBranchDock(manifold, port);
      const outwardDirection = rotateDirection(
        manifold.direction,
        port === 1,
      );
      if (
        belt.x === dock.x &&
        belt.y === dock.y &&
        belt.direction === oppositeDirection(outwardDirection)
      ) {
        return port;
      }
    }
    return undefined;
  }

  private entityCenter(entity: EntityState): GridPoint {
    return {
      x: entity.x + entity.width / 2,
      y: entity.y + entity.height / 2,
    };
  }

  private entityAtPoint(point: GridPoint): EntityState | undefined {
    return this.entityAtInternal(point.x, point.y);
  }

  private entityAtInternal(x: number, y: number): EntityState | undefined {
    if (!this.inBounds(x, y)) return undefined;
    const entityId = this.occupancy[this.index(x, y)] ?? 0;
    return entityId === 0 ? undefined : this.entities.get(entityId);
  }

  private sortedEntities(): EntityState[] {
    return [...this.entities.values()].sort((a, b) => a.id - b.id);
  }

  private fillOccupancy(entity: EntityState): void {
    for (const tile of footprintTiles(
      entity.kind,
      entity.x,
      entity.y,
      entity.direction,
    )) {
      this.occupancy[this.index(tile.x, tile.y)] = entity.id;
    }
  }

  private clearOccupancy(entity: EntityState): void {
    for (const tile of footprintTiles(
      entity.kind,
      entity.x,
      entity.y,
      entity.direction,
    )) {
      if (
        this.inBounds(tile.x, tile.y) &&
        this.occupancy[this.index(tile.x, tile.y)] === entity.id
      ) {
        this.occupancy[this.index(tile.x, tile.y)] = 0;
      }
    }
  }

  private emit(
    event: Omit<SimulationEvent, "id" | "tick">,
  ): void {
    this.assertCanEmitEvents(1);
    const eventId = this.nextEventId;
    const nextEventId = eventId + 1;
    this.events.push({
      id: eventId,
      tick: this._tickCount,
      ...event,
    });
    this.nextEventId = nextEventId;
  }

  private inBounds(x: number, y: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < this.width &&
      y < this.height
    );
  }

  private index(x: number, y: number): number {
    return y * this.width + x;
  }

  private resourceKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  private random(): number {
    this.randomState = (this.randomState + 0x6d2b_79f5) >>> 0;
    let value = this.randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  private generateTerrain(): void {
    this.terrain.fill(TerrainType.Ground);
    const lakeCount = Math.max(1, Math.floor((this.width * this.height) / 1_800));
    for (let lake = 0; lake < lakeCount; lake += 1) {
      const centerX = Math.floor(this.random() * this.width);
      const centerY = Math.floor(this.random() * this.height);
      const radiusX = 2 + Math.floor(this.random() * 4);
      const radiusY = 2 + Math.floor(this.random() * 3);
      for (let y = centerY - radiusY; y <= centerY + radiusY; y += 1) {
        for (let x = centerX - radiusX; x <= centerX + radiusX; x += 1) {
          if (!this.inBounds(x, y)) continue;
          const distance =
            ((x - centerX) * (x - centerX)) / (radiusX * radiusX) +
            ((y - centerY) * (y - centerY)) / (radiusY * radiusY);
          if (distance <= 1 + (this.random() - 0.5) * 0.18) {
            this.terrain[this.index(x, y)] = TerrainType.Water;
          }
        }
      }
    }
  }

  private generateStarterResources(): void {
    const patches: Array<{
      type: ResourceId;
      x: number;
      y: number;
      radius: number;
      amount: number;
    }> = [
      {
        type: "iron",
        x: Math.floor(this.width * 0.26),
        y: Math.floor(this.height * 0.55),
        radius: 4,
        amount: 520,
      },
      {
        type: "copper",
        x: Math.floor(this.width * 0.58),
        y: Math.floor(this.height * 0.28),
        radius: 4,
        amount: 470,
      },
      {
        type: "coal",
        x: Math.floor(this.width * 0.68),
        y: Math.floor(this.height * 0.68),
        radius: 3,
        amount: 650,
      },
      {
        type: "stone",
        x: Math.floor(this.width * 0.39),
        y: Math.floor(this.height * 0.8),
        radius: 3,
        amount: 390,
      },
    ];
    for (const patch of patches) this.paintResourcePatch(patch);
  }

  private paintResourcePatch(patch: {
    type: ResourceId;
    x: number;
    y: number;
    radius: number;
    amount: number;
  }): void {
    for (let y = patch.y - patch.radius; y <= patch.y + patch.radius; y += 1) {
      for (let x = patch.x - patch.radius; x <= patch.x + patch.radius; x += 1) {
        if (!this.inBounds(x, y)) continue;
        const distance = Math.hypot(x - patch.x, y - patch.y);
        if (distance > patch.radius + (this.random() - 0.5) * 0.65) continue;
        const richness = Math.max(0.2, 1 - distance / (patch.radius + 1));
        const amount = Math.max(
          40,
          Math.floor(patch.amount * (0.45 + richness * 0.55) * (0.9 + this.random() * 0.2)),
        );
        this.setResource(x, y, patch.type, amount);
      }
    }
  }
}

export function restoreSimulation(
  snapshot: AnySimulationSnapshot,
): FactorySimulation {
  return FactorySimulation.restore(snapshot);
}

export function createDemoSimulation(seed = 0xc1de_2026): FactorySimulation {
  const simulation = new FactorySimulation({
    width: 40,
    height: 27,
    seed,
    generateTerrain: false,
    generateResources: false,
  });

  const mustPlace = (
    ...args: Parameters<FactorySimulation["place"]>
  ): EntityState => {
    const placed = simulation.place(...args);
    if (!placed.ok) {
      throw new Error(
        `Failed to build demo ${args[0]} at ${args[1]},${args[2]}: ${placed.reason}.`,
      );
    }
    return placed.entity;
  };
  const mustRemove = (x: number, y: number, kind: EntityKind): void => {
    const removed = simulation.remove(x, y);
    if (!removed || removed.kind !== kind) {
      throw new Error(
        `Failed to remove demo ${kind} at ${x},${y}.`,
      );
    }
  };

  const paintPatch = (
    type: ResourceId,
    centerY: number,
    amount: number,
  ): void => {
    for (let y = centerY - 1; y <= centerY + 2; y += 1) {
      for (let x = 5; x <= 8; x += 1) {
        simulation.setResource(x, y, type, amount);
      }
    }
  };

  interface ShowcaseLine {
    firstBelt: EntityState;
    outputBelt: EntityState;
    smelter: EntityState;
    resourceItem: ItemId;
    productItem: ItemId;
  }

  const addSmeltingLine = (
    y: number,
    resource: ResourceId,
    recipeId: RecipeId,
  ): ShowcaseLine => {
    paintPatch(resource, y, 360);
    mustPlace("extractor", 6, y, Direction.East);
    let firstBelt: EntityState | undefined;
    for (let x = 8; x <= 14; x += 1) {
      const belt = mustPlace("belt", x, y, Direction.East);
      firstBelt ??= belt;
    }
    mustPlace("inserter", 15, y, Direction.East);
    const smelter = mustPlace("smelter", 16, y, Direction.East, {
      recipeId,
    });
    mustPlace("inserter", 18, y, Direction.East);
    let outputBelt: EntityState | undefined;
    for (let x = 19; x <= 22; x += 1) {
      const belt = mustPlace("belt", x, y, Direction.East);
      outputBelt ??= belt;
    }
    mustPlace("belt", 23, y, Direction.South);

    const recipe = RECIPES[recipeId];
    return {
      firstBelt: firstBelt!,
      outputBelt: outputBelt!,
      smelter,
      resourceItem: RESOURCE_TO_ITEM[resource],
      productItem: recipe.products[0]!.item,
    };
  };

  const ironLine = addSmeltingLine(5, "iron", "smeltIron");
  const copperLine = addSmeltingLine(11, "copper", "smeltCopper");
  const stoneLine = addSmeltingLine(17, "stone", "fireBrick");

  // A southbound main bus visually and mechanically unifies all three
  // smelting rows, then turns east into a staged mixed-material depot.
  for (let y = 6; y <= 18; y += 1) {
    if (y === 11 || y === 17) continue;
    mustPlace("belt", 23, y, Direction.South);
  }
  mustPlace("belt", 23, 19, Direction.East);
  for (let x = 24; x <= 26; x += 1) {
    mustPlace("belt", x, 19, Direction.East);
  }
  mustPlace("inserter", 27, 19, Direction.East);
  const busStorage = mustPlace("storage", 28, 18, Direction.East);

  const gearFabricator = mustPlace(
    "fabricator",
    25,
    4,
    Direction.East,
    { recipeId: "ironGear" },
  );
  mustPlace("inserter", 24, 5, Direction.East);
  mustPlace("inserter", 27, 5, Direction.East);
  mustPlace("storage", 28, 4, Direction.East);

  // An iron cross-feed branches from the main bus into a return spine.
  // Copper wire joins the same spine below, giving the circuit cell two
  // visibly converging supply streams without hidden teleportation.
  mustPlace("inserter", 24, 8, Direction.East);
  for (let x = 25; x <= 27; x += 1) {
    mustPlace("belt", x, 8, Direction.East);
  }
  let returnSpineEntry: EntityState | undefined;
  for (let y = 8; y <= 17; y += 1) {
    const belt = mustPlace("belt", 28, y, Direction.South);
    returnSpineEntry ??= belt;
  }

  const wireFabricator = mustPlace(
    "fabricator",
    25,
    10,
    Direction.East,
    { recipeId: "copperWire" },
  );
  mustPlace("inserter", 24, 11, Direction.East);
  mustPlace("inserter", 27, 11, Direction.East);

  const automationFabricator = mustPlace(
    "fabricator",
    30,
    10,
    Direction.East,
    { recipeId: "automationCore" },
  );
  mustPlace("inserter", 29, 11, Direction.East);
  mustPlace("inserter", 32, 11, Direction.East);
  const automationStorage = mustPlace(
    "storage",
    33,
    10,
    Direction.East,
  );

  const circuitFabricator = mustPlace(
    "fabricator",
    30,
    16,
    Direction.East,
    { recipeId: "circuit" },
  );
  mustPlace("inserter", 29, 17, Direction.East);
  mustPlace("inserter", 32, 17, Direction.East);
  mustPlace("storage", 33, 16, Direction.East);

  // Coal occupies a compact lower staging row with ample clearance from the
  // screen-edge build dock rather than stretching along the world boundary.
  for (let y = 20; y <= 23; y += 1) {
    for (let x = 7; x <= 10; x += 1) {
      simulation.setResource(x, y, "coal", 520);
    }
  }
  mustPlace("extractor", 8, 21, Direction.East);
  let coalFirstBelt: EntityState | undefined;
  for (let x = 10; x <= 15; x += 1) {
    const belt = mustPlace("belt", x, 21, Direction.East);
    coalFirstBelt ??= belt;
  }
  mustPlace("inserter", 16, 21, Direction.East);
  mustPlace("storage", 17, 20, Direction.East);

  const generatorA = mustPlace("generator", 31, 3, Direction.East);
  const generatorB = mustPlace("generator", 2, 21, Direction.East);
  const generatorC = mustPlace("generator", 25, 21, Direction.East);
  simulation.receive(generatorA.id, "coal", 60, "fuel");
  simulation.receive(generatorB.id, "coal", 60, "fuel");
  simulation.receive(generatorC.id, "coal", 60, "fuel");

  mustPlace("beacon", 18, 6, Direction.East);
  mustPlace("beacon", 19, 14, Direction.East);

  // Close the coal district's service gap with a physical fuel feed. The
  // storage remains a visible buffer while this live branch replenishes the
  // adjacent generator through ordinary belt, inserter, and fuel rules.
  mustPlace("inserter", 19, 21, Direction.East);
  for (let x = 20; x <= 23; x += 1) {
    mustPlace("belt", x, 21, Direction.East);
  }
  mustPlace("inserter", 24, 21, Direction.East);

  // A pair of real dispatch manifolds turns the busiest warm-material line
  // into a visible split/process/merge chain. The first T-junction alternates
  // raw copper between two smelters; the second fairly recombines both plate
  // streams beneath an enclosed selector before they rejoin the main bus.
  mustRemove(12, 11, "belt");
  mustRemove(13, 11, "belt");
  mustRemove(20, 11, "belt");
  mustRemove(21, 11, "belt");

  mustPlace("belt", 12, 11, Direction.North);
  mustPlace("belt", 12, 10, Direction.East);
  const copperSplitter = mustPlace(
    "manifold",
    13,
    10,
    Direction.East,
  );
  if (!simulation.setManifoldRouting(copperSplitter.id, { mode: "even" })) {
    throw new Error("Failed to configure the demo copper splitter.");
  }
  mustPlace("belt", 14, 9, Direction.North);
  mustPlace("belt", 14, 8, Direction.East);
  mustPlace("inserter", 15, 8, Direction.East);
  mustPlace("smelter", 16, 8, Direction.East, {
    recipeId: "smeltCopper",
  });
  mustPlace("inserter", 18, 8, Direction.East);
  mustPlace("belt", 19, 8, Direction.East);
  mustPlace("belt", 20, 8, Direction.South);
  mustPlace("belt", 20, 9, Direction.South);
  mustPlace("belt", 20, 11, Direction.North);
  const copperMerger = mustPlace(
    "manifold",
    20,
    10,
    Direction.West,
  );
  if (!simulation.setManifoldRouting(copperMerger.id, { mode: "even" })) {
    throw new Error("Failed to configure the demo copper merger.");
  }
  mustPlace("belt", 22, 10, Direction.South);

  // Close one visible transformation loop in the central courtyard. Real
  // copper plates leave the shared output lane, travel west into a dedicated
  // wire fabricator, and terminate in a physical buffer whose inventory grows
  // only through ordinary transfer and recipe rules.
  mustPlace("inserter", 19, 12, Direction.South);
  mustPlace("belt", 19, 13, Direction.West);
  mustPlace("inserter", 18, 13, Direction.West);
  mustPlace("fabricator", 16, 13, Direction.East, {
    recipeId: "copperWire",
  });
  mustPlace("inserter", 15, 14, Direction.West);
  mustPlace("storage", 13, 13, Direction.East);

  simulation.receive(ironLine.smelter.id, "ironOre", 4, "input");
  simulation.receive(copperLine.smelter.id, "copperOre", 4, "input");
  simulation.receive(stoneLine.smelter.id, "stone", 8, "input");
  simulation.receive(gearFabricator.id, "ironPlate", 40, "input");
  simulation.receive(wireFabricator.id, "copperPlate", 40, "input");
  simulation.receive(circuitFabricator.id, "ironPlate", 30, "input");
  simulation.receive(circuitFabricator.id, "copperWire", 90, "input");
  simulation.receive(automationFabricator.id, "ironGear", 4, "input");
  simulation.receive(automationFabricator.id, "circuit", 4, "input");
  simulation.receive(automationFabricator.id, "copperPlate", 2, "input");
  // The hero buffer starts visibly stocked while live bus deliveries continue.
  simulation.receive(busStorage.id, "ironPlate", 6, "inventory");

  // Two deliberately disconnected local grids make power routing visible.
  // The broad foundry lattice terminates at x=24; the automation district
  // begins at x=32, leaving an eight-tile cable gap while their five-tile
  // supply squares overlap enough to cover the handoff machines.
  const relayCells = [
    [4, 4],
    [11, 4],
    [18, 4],
    [24, 4],
    [4, 10],
    [11, 10],
    [18, 10],
    [24, 10],
    [4, 17],
    [11, 18],
    [18, 18],
    [24, 17],
    [32, 8],
    [32, 13],
    [32, 18],
  ] as const;
  for (const [x, y] of relayCells) {
    mustPlace("gridRelay", x, y, Direction.North);
  }
  const demoGrid = simulation.powerGridSnapshot();
  const demoNetworkIds = new Set(
    demoGrid.relays.map((relay) => relay.networkId),
  );
  if (
    demoNetworkIds.size !== 2 ||
    demoGrid.assignments.some((assignment) =>
      assignment.networkId === null
    )
  ) {
    throw new Error("Automation showcase local-grid layout is invalid.");
  }

  const lines = [ironLine, copperLine, stoneLine];
  const returnSpineCargo: readonly ItemId[] = [
    "ironPlate",
    "ironGear",
    "copperWire",
    "circuit",
    "copperPlate",
    "ironGear",
    "circuit",
  ];
  // Sixteen quarter-tile-spaced pulses establish compressed twin-lane cargo
  // waves. They enter through real line heads and continue through normal
  // belt, inserter, recipe, and backpressure rules during the warm-up.
  for (let pulse = 0; pulse < 16; pulse += 1) {
    for (const line of lines) {
      simulation.receive(
        line.firstBelt.id,
        line.resourceItem,
        2,
        "belt",
      );
      simulation.receive(
        line.outputBelt.id,
        line.productItem,
        2,
        "belt",
      );
    }
    simulation.receive(coalFirstBelt!.id, "coal", 2, "belt");
    simulation.receive(
      returnSpineEntry!.id,
      returnSpineCargo[pulse % returnSpineCargo.length]!,
      2,
      "belt",
    );
    simulation.step(8);
  }

  // Warm the deterministic showcase so the first rendered frame already has
  // moving cargo, hot smelters, swinging inserters, and fabricated products.
  simulation.step(FIXED_TICK_RATE * 6);
  if (
    inventoryCount(
      simulation.getEntity(automationStorage.id)?.inventory ?? {},
      "automationCore",
    ) === 0
  ) {
    throw new Error("Automation showcase failed to deliver its first core.");
  }
  simulation.drainEvents();
  return simulation;
}
