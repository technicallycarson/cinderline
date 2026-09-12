import {
  ITEMS,
  ITEM_IDS,
  ENTITY_PROTOTYPES,
  FLUIDS,
  FLUID_RECIPES,
  RECIPES,
  isCircuitEntityKind,
  recipesFor,
} from "./catalog";
import { isFluidEntityKind } from "./fluid-network";
import type {
  CircuitEntityKind,
  CircuitSimulationSnapshot,
  EntityState,
  EntityStatus,
  FluidEntityKind,
  FluidBufferState,
  FluidEntityState,
  Ingredient,
  Inventory,
  ItemId,
  PowerMode,
  RecipeId,
  RenderEntityState,
  RenderSnapshot as SimulationSnapshot,
  ResourceId,
  SimulationStats,
} from "./types";
import type {
  RenderBeltItem,
  RenderEntity,
  RenderEntityKind,
  RenderResource,
  RenderSnapshot,
} from "../render/WorldRenderer";
import type {
  HUDBuffer,
  HUDInspector,
  HUDInspectorStat,
  HUDItemQuantity,
  HUDMachineProcess,
  HUDMapEntity,
  HUDMapResource,
  HUDMission,
  HUDProcessTarget,
  HUDRecipeFormula,
  HUDRecipeOption,
} from "../ui/HUD";

export interface FluidRenderEntity {
  readonly id: number;
  readonly kind: FluidEntityKind;
  readonly x: number;
  readonly z: number;
  readonly direction: EntityState["direction"];
  readonly status: EntityStatus;
  readonly powerSatisfaction: number;
  readonly fluidState: FluidEntityState;
}

export interface CircuitRenderEntity {
  readonly id: number;
  readonly kind: CircuitEntityKind;
  readonly x: number;
  readonly z: number;
  readonly direction: EntityState["direction"];
  readonly status: EntityStatus;
}

export interface AdaptedRenderSnapshot extends RenderSnapshot {
  readonly fluid: SimulationSnapshot["fluid"];
  readonly fluidNetwork: SimulationSnapshot["fluidNetwork"];
  readonly fluidEntities: readonly FluidRenderEntity[];
  readonly circuit: SimulationSnapshot["circuit"];
  readonly circuitEntities: readonly CircuitRenderEntity[];
  readonly rail: SimulationSnapshot["rail"];
}

function isRendererEntity(
  entity: RenderEntityState,
): entity is RenderEntityState & { kind: RenderEntityKind } {
  return (
    !isFluidEntityKind(entity.kind) &&
    !isCircuitEntityKind(entity.kind)
  );
}

const RESOURCE_COLORS: Record<ResourceId, string> = {
  iron: "#7595a5",
  copper: "#d57a40",
  coal: "#43484c",
  stone: "#a99b78",
};

const MANIFOLD_FILTER_OPTIONS = ITEM_IDS.map((id) => ({
  id,
  label: ITEMS[id].name,
}));

function inspectorEntityType(kind: EntityState["kind"]): string {
  return kind
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toUpperCase();
}

function directionVector(direction: EntityState["direction"]): readonly [number, number] {
  switch (direction) {
    case 0:
      return [0, -1];
    case 1:
      return [1, 0];
    case 2:
      return [0, 1];
    case 3:
      return [-1, 0];
    default:
      return [0, -1];
  }
}

function inserterContacts(
  entity: RenderEntityState,
  entityAtCell: (x: number, y: number) => RenderEntityState | undefined,
): {
  pickupContact: readonly [number, number];
  dropContact: readonly [number, number];
} {
  const [forwardX, forwardY] = directionVector(entity.direction);
  const rightX = -forwardY;
  const rightY = forwardX;
  let pickupX = -forwardX * 0.5;
  let pickupY = -forwardY * 0.5;
  let dropX = forwardX * 0.5;
  let dropY = forwardY * 0.5;

  const source = entityAtCell(entity.x - forwardX, entity.y - forwardY);
  if (source?.kind === "belt") {
    const sourceLane =
      entity.heldItemSourceLane ?? entity.inserterPickupLane;
    const [beltForwardX, beltForwardY] = directionVector(source.direction);
    const contactAlignment =
      beltForwardX * forwardX + beltForwardY * forwardY;
    const beltContactOffset = contactAlignment * 0.5;
    pickupX = -forwardX + beltForwardX * beltContactOffset;
    pickupY = -forwardY + beltForwardY * beltContactOffset;
    if (sourceLane !== undefined) {
      const laneOffset = sourceLane === 0 ? -0.17 : 0.17;
      pickupX += -beltForwardY * laneOffset;
      pickupY += beltForwardX * laneOffset;
    }
  }

  const target = entityAtCell(entity.x + forwardX, entity.y + forwardY);
  if (target?.kind === "belt") {
    const [beltForwardX, beltForwardY] = directionVector(target.direction);
    dropX = forwardX - beltForwardX * 0.5 - beltForwardY * 0.17;
    dropY = forwardY - beltForwardY * 0.5 + beltForwardX * 0.17;
  }

  const toLocal = (
    worldX: number,
    worldY: number,
  ): readonly [number, number] => [
    worldX * rightX + worldY * rightY,
    -(worldX * forwardX + worldY * forwardY),
  ];
  return {
    pickupContact: toLocal(pickupX, pickupY),
    dropContact: toLocal(dropX, dropY),
  };
}

function renderStatus(
  status: EntityStatus,
): NonNullable<RenderEntity["status"]> {
  switch (status) {
    case "working":
    case "changingRecipe":
      return "working";
    case "noPower":
      return "unpowered";
    case "blocked":
    case "outputFull":
      return "blocked";
    default:
      return "idle";
  }
}

export function toRenderSnapshot(
  snapshot: SimulationSnapshot,
): AdaptedRenderSnapshot {
  const renderableEntities = snapshot.entities.filter(isRendererEntity);
  const entityCells = new Map<string, RenderEntityState>();
  for (const entity of renderableEntities) {
    for (let y = entity.y; y < entity.y + entity.height; y += 1) {
      for (let x = entity.x; x < entity.x + entity.width; x += 1) {
        entityCells.set(`${x},${y}`, entity);
      }
    }
  }
  const entityAtCell = (x: number, y: number): RenderEntityState | undefined =>
    entityCells.get(`${x},${y}`);

  const entities: RenderEntity[] = renderableEntities.map((entity) => {
    const routing = entity.manifoldRouting;
    const portCounts = routing
      ? ([
          entity.beltItems.filter((item) => item.port === 0).length,
          entity.beltItems.filter((item) => item.port === 1).length,
        ] as const)
      : undefined;
    const commonLeader = routing
      ? entity.beltItems
          .filter((item) => item.port === undefined)
          .sort((a, b) => b.progress - a.progress || a.id - b.id)[0]
      : undefined;
    const branchLeader = routing
      ? entity.beltItems
          .filter((item) => item.port !== undefined)
          .sort((a, b) => b.progress - a.progress || a.id - b.id)[0]
      : undefined;
    const routingActivePort = routing
      ? commonLeader
        ? routing.mode === "extract"
          ? commonLeader.item === routing.filter
            ? routing.extractPort
            : routing.extractPort === 0
              ? 1
              : 0
          : routing.mode === "favorA" ? 0
            : routing.mode === "favorB" ? 1
              : routing.splitCursors[commonLeader.lane]
        : branchLeader
          ? routing.mergeCursors[branchLeader.lane]
          : routing.mode === "extract"
            ? routing.extractPort
            : routing.mode === "favorB" ? 1 : 0
      : undefined;
    const contacts =
      entity.kind === "inserter"
        ? inserterContacts(entity, entityAtCell)
        : undefined;
    const machineProcessState =
      entity.kind === "smelter" || entity.kind === "fabricator"
        ? processState(
            entity as EntityState & { kind: "smelter" | "fabricator" },
          )
        : undefined;
    return {
      id: entity.id,
      kind: entity.kind,
      x: entity.x,
      z: entity.y,
      direction: entity.direction,
      active:
        entity.status === "working" ||
        entity.status === "changingRecipe",
      powered:
        entity.powerSatisfaction > 0.01 ||
        entity.kind === "generator" ||
        entity.kind === "gridRelay",
      progress:
        entity.kind === "inserter"
          ? entity.armProgress
          : entity.progress,
      status: renderStatus(entity.status),
      tier: entity.speedMultiplier > 1.01 ? 2 : 1,
      health: 1,
      recipe: entity.recipeId ?? entity.activeRecipeId,
      ...(entity.powerRelayId === undefined
        ? {}
        : { powerRelayId: entity.powerRelayId }),
      ...(entity.powerNetworkId === undefined
        ? {}
        : { powerNetworkId: entity.powerNetworkId }),
      ...(machineProcessState
        ? {
            processState: machineProcessState,
            processRecipe:
              entity.activeRecipeId ??
              entity.recipeId ??
              (entity.kind === "smelter" ? "auto" : undefined),
            ...(entity.recipeChangeQueued
              ? {
                  pendingRecipe: entity.pendingRecipeId ?? "auto",
                }
              : {}),
            reclaimCount: sumInventory(entity.reclaim),
          }
        : {}),
      ...(entity.kind === "extractor" && entity.miningResource
        ? { resourceKind: entity.miningResource }
        : {}),
      ...(contacts
        ? {
            ...(entity.heldItem
              ? {
                  carriedItem: entity.heldItem,
                  carriedItemColor: ITEMS[entity.heldItem].color,
                }
              : {}),
            armReturning: entity.armReturning,
            pickupContact: contacts.pickupContact,
            dropContact: contacts.dropContact,
          }
        : {}),
      ...(routing && portCounts
        ? {
            routingMode: routing.mode,
            ...(routing.filter ? { routingFilter: routing.filter } : {}),
            routingSplitCursors: routing.splitCursors,
            routingMergeCursors: routing.mergeCursors,
            routingActivePort,
            routingCommonCount: entity.beltItems.filter(
              (item) => item.port === undefined,
            ).length,
            routingPortCounts: portCounts,
          }
        : {}),
    };
  });

  const resources: RenderResource[] = snapshot.resources.map((resource, index) => ({
    id: `resource-${index}-${resource.x}-${resource.y}`,
    kind: resource.type,
    x: resource.x,
    z: resource.y,
    amount: resource.amount,
    radius: 0.46,
    depleted: resource.amount <= 0,
  }));

  const beltItems: RenderBeltItem[] = [];
  for (const entity of snapshot.entities) {
    if (entity.kind !== "belt" && entity.kind !== "manifold") continue;
    for (const beltItem of entity.beltItems) {
      beltItems.push({
        id: beltItem.id,
        kind: beltItem.item,
        x: entity.x,
        z: entity.y,
        direction: entity.direction,
        lane: beltItem.lane,
        progress: beltItem.progress,
        ...(beltItem.port === undefined ? {} : { port: beltItem.port }),
        carrier: entity.kind,
        color: ITEMS[beltItem.item].color,
      });
    }
  }

  return {
    tick: snapshot.tick,
    elapsed: snapshot.elapsedSeconds,
    bounds: {
      minX: 0,
      minZ: 0,
      maxX: snapshot.width,
      maxZ: snapshot.height,
    },
    entities,
    resources,
    beltItems,
    fluid: snapshot.fluid,
    fluidNetwork: snapshot.fluidNetwork,
    fluidEntities: snapshot.entities
      .filter(
        (
          entity,
        ): entity is RenderEntityState & {
          kind: FluidEntityKind;
          fluidState: FluidEntityState;
        } =>
          isFluidEntityKind(entity.kind) &&
          entity.fluidState !== undefined,
      )
      .map((entity) => ({
        id: entity.id,
        kind: entity.kind,
        x: entity.x,
        z: entity.y,
        direction: entity.direction,
        status: entity.status,
        powerSatisfaction: entity.powerSatisfaction,
        fluidState: entity.fluidState,
      })),
    circuit: snapshot.circuit,
    circuitEntities: snapshot.entities
      .filter(
        (
          entity,
        ): entity is RenderEntityState & {
          kind: CircuitEntityKind;
        } => isCircuitEntityKind(entity.kind),
      )
      .map((entity) => ({
        id: entity.id,
        kind: entity.kind,
        x: entity.x,
        z: entity.y,
        direction: entity.direction,
        status: entity.status,
      })),
    rail: snapshot.rail,
    powerGrid: {
      mode:
        snapshot.powerGrid.mode === "legacyGlobal" ? "global" : "local",
      halfExtent: snapshot.powerGrid.supplyHalfExtentTiles,
      cableReach: snapshot.powerGrid.cableReachTiles,
      relayCenters: snapshot.powerGrid.relays.map((relay) => ({
        relayId: relay.id,
        x: relay.x,
        z: relay.y,
        networkId: relay.networkId,
      })),
      relayLinks: snapshot.powerGrid.links.map((link) => ({
        relayAId: link.relayAId,
        relayBId: link.relayBId,
      })),
    },
  };
}

export function toMission(stats: SimulationStats): HUDMission {
  const active =
    stats.objectives.find((objective) => !objective.complete && !objective.locked) ??
    stats.objectives.at(-1);
  return {
    chapter: "RESTORATION PROTOCOL",
    code: active?.complete ? "SECTOR ONLINE" : `PHASE ${Math.max(1, (active?.index ?? 0) + 1)}`,
    title: active?.complete ? "Autonomy achieved" : (active?.title ?? "Wake the line"),
    description:
      active?.complete
        ? "The frontier foundry is sustaining a complete autonomous production cycle."
        : (active?.description ??
          "Bring dormant extraction and materials systems back online."),
    objectives: stats.objectives.map((objective) => ({
      id: objective.id,
      label: objective.title,
      current: Math.min(objective.amount, Math.round(objective.progress)),
      target: objective.amount,
      complete: objective.complete,
    })),
  };
}

export function toInspector(
  entity: RenderEntityState | undefined,
  unlockedRecipeIds?: readonly RecipeId[],
  powerMode: PowerMode = "local",
  circuit?: CircuitSimulationSnapshot,
): HUDInspector | null {
  if (!entity) return null;
  const prototype = ENTITY_PROTOTYPES[entity.kind];
  const recipeName = entity.recipeId ?? entity.activeRecipeId;
  const stored =
    sumInventory(entity.inventory) +
    sumInventory(entity.input) +
    sumInventory(entity.output) +
    entity.beltItems.length +
    (entity.heldItem ? 1 : 0);

  const statusTone: HUDInspector["statusTone"] =
    entity.status === "working"
      ? "online"
      : entity.status === "changingRecipe" ||
          entity.status === "unconfigured"
        ? "warning"
      : entity.status === "noPower" || entity.status === "noFuel"
        ? "error"
        : entity.status === "outputFull" || entity.status === "blocked"
          ? "warning"
          : "offline";
  const manifoldRouting = entity.manifoldRouting;
  const manifoldPortCounts = manifoldRouting
    ? ([
        entity.beltItems.filter((item) => item.port === 0).length,
        entity.beltItems.filter((item) => item.port === 1).length,
      ] as const)
    : undefined;
  const commonPayloads = manifoldRouting
    ? entity.beltItems.filter((item) => item.port === undefined).length
    : 0;
  const machineProcess =
    entity.kind === "smelter" || entity.kind === "fabricator"
      ? toMachineProcess(
          entity as EntityState & { kind: "smelter" | "fabricator" },
          unlockedRecipeIds,
        )
      : undefined;
  const fluidPresentation = fluidInspectorPresentation(entity);
  const circuitPresentation = circuitInspectorPresentation(
    entity,
    circuit,
  );
  const specializedPresentation =
    fluidPresentation ?? circuitPresentation;

  return {
    id: String(entity.id),
    name: prototype.name,
    type: `${inspectorEntityType(entity.kind)} // UNIT ${String(entity.id).padStart(3, "0")}`,
    status:
      circuitPresentation === null
        ? humanizeStatus(entity.status)
        : circuitPresentation.active
          ? "SIGNAL ACTIVE"
          : "SIGNAL QUIET",
    statusTone:
      circuitPresentation === null
        ? statusTone
        : circuitPresentation.active
          ? "online"
          : "offline",
    stats: specializedPresentation?.stats ?? [
      ...(entity.powerNetworkId === undefined
        ? []
        : [
            {
              id:
                powerMode === "legacyGlobal"
                  ? "candidate-network"
                  : "network",
              label:
                powerMode === "legacyGlobal"
                  ? "Retrofit grid"
                  : "Network",
              value:
                entity.powerNetworkId === null
                  ? powerMode === "legacyGlobal"
                    ? "UNCOVERED"
                    : "DISCONNECTED"
                  : `N-${entity.powerNetworkId}`,
            },
          ]),
      {
        id: "cycle",
        label: entity.kind === "gridRelay" ? "Coverage" : "Cycle",
        value:
          entity.kind === "gridRelay"
            ? "11 × 11"
            : `${Math.round(entity.progress * 100)}`,
        unit: entity.kind === "gridRelay" ? "tiles" : "%",
      },
      {
        id: "power",
        label: "Power",
        value: Math.round(entity.powerSatisfaction * 100),
        unit: "%",
      },
      {
        id: "buffer",
        label: "Payload",
        value: stored,
        unit: "items",
      },
      {
        id: "speed",
        label: "Clock",
        value: entity.speedMultiplier.toFixed(2),
        unit: "×",
      },
    ],
    recipe: specializedPresentation?.recipe ?? {
      icon: recipeName ? recipeName.slice(0, 2).toUpperCase() : entity.kind.slice(0, 2).toUpperCase(),
      label: manifoldRouting
        ? manifoldModeLabel(
            manifoldRouting.mode,
            manifoldRouting.extractPort,
          )
        : recipeName
          ? humanizeCamel(recipeName)
          : "Autonomous routing",
      detail:
        entity.kind === "belt"
          ? `${entity.beltItems.length} payloads in twin lanes`
          : manifoldRouting && manifoldPortCounts
            ? `${commonPayloads} common · ${manifoldPortCounts[0]} A · ${manifoldPortCounts[1]} B`
            : describeBuffer(entity),
    },
    ...(manifoldRouting && manifoldPortCounts
      ? {
          manifoldRouting: {
            mode: manifoldRouting.mode,
            extractPort: manifoldRouting.extractPort,
            ...(manifoldRouting.filter
              ? { filter: manifoldRouting.filter }
              : {}),
            filterOptions: MANIFOLD_FILTER_OPTIONS,
            portCounts: manifoldPortCounts,
            splitCursors: manifoldRouting.splitCursors,
            mergeCursors: manifoldRouting.mergeCursors,
          },
        }
      : {}),
    ...(machineProcess ? { machineProcess } : {}),
  };
}

function toMachineProcess(
  entity: EntityState & { kind: "smelter" | "fabricator" },
  unlockedRecipeIds?: readonly RecipeId[],
): HUDMachineProcess {
  const prototype = ENTITY_PROTOTYPES[entity.kind];
  const configured = configuredTarget(entity);
  const activeRecipeId = entity.activeRecipeId;
  const pending = entity.recipeChangeQueued
    ? recipeTarget(entity.pendingRecipeId ?? null)
    : null;
  const activeRecipe = activeRecipeId ? RECIPES[activeRecipeId] : undefined;
  const timingRecipeId = activeRecipeId ?? entity.recipeId;
  const timingRecipe = timingRecipeId ? RECIPES[timingRecipeId] : undefined;
  const effectiveSpeed =
    prototype.workSpeed * entity.speedMultiplier * entity.powerSatisfaction;
  const effectiveSeconds =
    timingRecipe && effectiveSpeed > 0
      ? timingRecipe.durationSeconds / effectiveSpeed
      : null;
  const progress = activeRecipe ? Math.max(0, Math.min(1, entity.progress)) : 0;
  const state = processState(entity);

  return {
    entityId: String(entity.id),
    kind: entity.kind,
    state,
    configured,
    active: activeRecipe
      ? {
          recipeId: activeRecipe.id,
          label: activeRecipe.name,
          committedInputs: quantitiesFromIngredients(activeRecipe.ingredients),
          projectedOutputs: quantitiesFromIngredients(activeRecipe.products),
          progress,
        }
      : null,
    pending,
    recipes: recipeOptions(entity, unlockedRecipeIds),
    buffers: {
      input: inventoryBuffer(entity.input, prototype.inputSlots),
      output: inventoryBuffer(entity.output, prototype.outputSlots),
      reclaim: inventoryBuffer(entity.reclaim),
    },
    timing: {
      progress,
      baseSeconds: timingRecipe?.durationSeconds ?? null,
      effectiveSeconds,
      remainingSeconds:
        effectiveSeconds === null ? null : effectiveSeconds * (1 - progress),
    },
    power: {
      demandKW: prototype.powerDemandKW,
      satisfaction: entity.powerSatisfaction,
    },
    speed: {
      base: prototype.workSpeed,
      beaconMultiplier: entity.speedMultiplier,
      effective: prototype.workSpeed * entity.speedMultiplier,
    },
    condition: {
      tone:
        state === "working"
          ? "online"
          : state === "output-blocked" || state === "no-power"
            ? "error"
            : state === "idle"
              ? "offline"
              : "warning",
      text: processCondition(entity, state),
    },
  };
}

function processState(
  entity: EntityState & { kind: "smelter" | "fabricator" },
): HUDMachineProcess["state"] {
  if (entity.kind === "fabricator" && entity.recipeId === undefined) {
    return "unconfigured";
  }
  if (entity.status === "outputFull") return "output-blocked";
  if (entity.status === "noPower") return "no-power";
  if (entity.recipeChangeQueued) return "queued";
  if (entity.activeRecipeId !== undefined) return "working";
  if (entity.status === "idle") {
    const readyRecipes = entity.recipeId
      ? [RECIPES[entity.recipeId]]
      : entity.kind === "smelter"
        ? recipesFor("smelter")
        : [];
    if (
      readyRecipes.some((recipe) =>
        recipe.ingredients.every(
          ({ item, amount }) => (entity.input[item] ?? 0) >= amount,
        )
      )
    ) {
      return "idle";
    }
  }
  if (
    entity.status === "missingInput" ||
    entity.activeRecipeId === undefined
  ) {
    return "starved";
  }
  return "idle";
}

function configuredTarget(
  entity: EntityState & { kind: "smelter" | "fabricator" },
): HUDProcessTarget | null {
  if (entity.recipeId) return recipeTarget(entity.recipeId);
  return entity.kind === "smelter" ? { mode: "auto" } : null;
}

function recipeTarget(recipeId: RecipeId | null): HUDProcessTarget {
  return recipeId === null
    ? { mode: "auto" }
    : { mode: "recipe", recipeId };
}

function recipeOptions(
  entity: EntityState & { kind: "smelter" | "fabricator" },
  unlockedRecipeIds?: readonly RecipeId[],
): HUDRecipeOption[] {
  const explicit = recipesFor(entity.kind).filter(
    (recipe) =>
      unlockedRecipeIds === undefined ||
      unlockedRecipeIds.includes(recipe.id),
  );
  const options: Array<{
    recipeId: RecipeId | null;
    label: string;
    icon: string;
    formulas: readonly HUDRecipeFormula[];
  }> = [
    ...(entity.kind === "smelter"
      ? [
          {
            recipeId: null,
            label: "Auto-smelt",
            icon: "AU",
            formulas: explicit.map((recipe) => recipeFormula(recipe.id)),
          },
        ]
      : []),
    ...explicit.map((recipe) => ({
      recipeId: recipe.id,
      label: recipe.name,
      icon: recipeIcon(recipe.id),
      formulas: [recipeFormula(recipe.id)],
    })),
  ];
  const pendingRecipeId = entity.pendingRecipeId ?? null;
  return options.map((option) => {
    const configured =
      option.recipeId === null
        ? entity.kind === "smelter" && entity.recipeId === undefined
        : entity.recipeId === option.recipeId;
    const pending =
      entity.recipeChangeQueued && pendingRecipeId === option.recipeId;
    return {
      ...option,
      configured,
      active:
        option.recipeId !== null &&
        entity.activeRecipeId === option.recipeId,
      pending,
      targeted: entity.recipeChangeQueued ? pending : configured,
    };
  });
}

function recipeFormula(recipeId: RecipeId): HUDRecipeFormula {
  const recipe = RECIPES[recipeId];
  return {
    id: recipe.id,
    durationSeconds: recipe.durationSeconds,
    ingredients: quantitiesFromIngredients(recipe.ingredients),
    products: quantitiesFromIngredients(recipe.products),
  };
}

function inventoryBuffer(
  inventory: Inventory,
  capacitySlots?: number,
): HUDBuffer {
  const items = ITEM_IDS.flatMap((id) => {
    const amount = inventory[id] ?? 0;
    return amount > 0 ? [itemQuantity(id, amount)] : [];
  });
  const usedSlots = items.reduce(
    (total, item) =>
      total + Math.ceil(item.amount / ITEMS[item.id].stackSize),
    0,
  );
  return {
    items,
    usedSlots,
    ...(capacitySlots === undefined ? {} : { capacitySlots }),
  };
}

function quantitiesFromIngredients(
  ingredients: readonly Ingredient[],
): HUDItemQuantity[] {
  return ingredients.map((ingredient) =>
    itemQuantity(ingredient.item, ingredient.amount),
  );
}

function itemQuantity(id: ItemId, amount: number): HUDItemQuantity {
  return {
    id,
    label: ITEMS[id].name,
    amount,
    color: ITEMS[id].color,
  };
}

function processCondition(
  entity: EntityState & { kind: "smelter" | "fabricator" },
  state: HUDMachineProcess["state"],
): string {
  const prototype = ENTITY_PROTOTYPES[entity.kind];
  if (state === "unconfigured") {
    return "Select a recipe to arm this fabricator.";
  }
  if (state === "no-power") {
    return `Grid offline — this unit requires ${formatWhole(prototype.powerDemandKW)} kW; supply is ${Math.round(entity.powerSatisfaction * 100)}%.`;
  }
  if (state === "output-blocked") {
    const recipeId = entity.activeRecipeId ?? entity.recipeId;
    const product = recipeId ? RECIPES[recipeId].products[0] : undefined;
    const capacity = product
      ? `${formatWhole(product.amount)} ${ITEMS[product.item].name}`
      : "the committed product";
    return `Output blocked — clear capacity for ${capacity}. RECLAIM has extraction priority.`;
  }
  if (state === "queued") {
    const active = entity.activeRecipeId
      ? RECIPES[entity.activeRecipeId].name
      : "the committed batch";
    const next = entity.pendingRecipeId
      ? RECIPES[entity.pendingRecipeId].name
      : "Auto-smelt";
    return `Change queued — finishing ${active} before ${next}; leftover input will move to RECLAIM.`;
  }
  if (state === "working") {
    return "Process nominal — the committed batch is in the chamber.";
  }
  if (state === "idle") {
    return "Inputs ready — batch armed for chamber commit.";
  }
  if (state === "starved") {
    if (entity.kind === "smelter" && entity.recipeId === undefined) {
      return "Auto-smelt armed — waiting for iron ore, copper ore, or stone.";
    }
    if (entity.recipeId) {
      const deficits = RECIPES[entity.recipeId].ingredients
        .map((ingredient) => ({
          ...ingredient,
          loaded: Math.min(
            ingredient.amount,
            entity.input[ingredient.item] ?? 0,
          ),
        }))
        .filter((ingredient) => ingredient.loaded < ingredient.amount)
        .map(
          (ingredient) =>
            `${ITEMS[ingredient.item].name} — ${formatWhole(ingredient.loaded)} / ${formatWhole(ingredient.amount)} loaded`,
        );
      if (deficits.length > 0) return `Waiting for ${deficits.join("; ")}.`;
    }
  }
  return "Unit armed — awaiting the next committed batch.";
}

function recipeIcon(recipeId: RecipeId): string {
  const icons: Record<RecipeId, string> = {
    smeltIron: "FE",
    smeltCopper: "CU",
    fireBrick: "BR",
    ironGear: "GR",
    copperWire: "WR",
    circuit: "LC",
    automationCore: "AC",
  };
  return icons[recipeId];
}

function formatWhole(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

export function toHUDMapResources(
  snapshot: SimulationSnapshot,
): HUDMapResource[] {
  const stride = Math.max(1, Math.floor(snapshot.resources.length / 600));
  const points: HUDMapResource[] = [];
  for (let index = 0; index < snapshot.resources.length; index += stride) {
    const resource = snapshot.resources[index];
    if (!resource || resource.amount <= 0) continue;
    points.push({
      x: resource.x + 0.5,
      z: resource.y + 0.5,
      kind: resource.type,
      amount: Math.min(1, resource.amount / 1800),
      radius: 1.5,
      color: RESOURCE_COLORS[resource.type],
    });
  }
  return points;
}

export function toHUDMapEntities(
  snapshot: SimulationSnapshot,
  selectedId: number | null,
  uplinkId: number | null = null,
): HUDMapEntity[] {
  return snapshot.entities
    .map((entity) => ({
      x: entity.x + entity.width * 0.5,
      z: entity.y + entity.height * 0.5,
      kind: entity.id === uplinkId ? "uplink" : entity.kind,
      rotation: -entity.direction * (Math.PI / 2),
      active:
        entity.id === uplinkId ||
        entity.status === "working" ||
        entity.status === "changingRecipe" ||
        entity.kind === "belt" ||
        entity.kind === "manifold" ||
        (
          isFluidEntityKind(entity.kind) &&
          [
            entity.fluidState?.buffer,
            entity.fluidState?.input,
            entity.fluidState?.output,
          ].some((buffer) => (buffer?.amountMilli ?? 0) > 0)
        ) ||
        (
          isCircuitEntityKind(entity.kind) &&
          (
            snapshot.circuit.endpoints.some(
              (endpoint) =>
                endpoint.entityId === entity.id &&
                endpoint.signals.some((signal) => signal.value !== 0),
            ) ||
            snapshot.circuit.devices.some(
              (device) =>
                device.id === `entity:${entity.id}:device` &&
                device.kind === "constant" &&
                device.enabled !== false &&
                device.signals.some((signal) => signal.value !== 0),
            )
          )
        ),
      selected: entity.id === selectedId,
      ...(entity.id === uplinkId ? { color: "#73f2d2" } : {}),
    }));
}

function fluidInspectorPresentation(
  entity: RenderEntityState,
): {
  readonly stats: readonly HUDInspectorStat[];
  readonly recipe: NonNullable<HUDInspector["recipe"]>;
} | null {
  if (!isFluidEntityKind(entity.kind) || !entity.fluidState) return null;
  const state = entity.fluidState;
  const buffers = [
    state.buffer,
    state.input,
    state.output,
  ].filter((buffer): buffer is FluidBufferState => buffer !== undefined);
  const amountMilli = buffers.reduce(
    (total, buffer) => total + buffer.amountMilli,
    0,
  );
  const capacityMilli = buffers.reduce(
    (total, buffer) => total + buffer.capacityMilli,
    0,
  );
  const fluidIds = [
    ...new Set(
      buffers.flatMap((buffer) =>
        buffer.fluidId === undefined ? [] : [buffer.fluidId],
      ),
    ),
  ];
  const medium =
    fluidIds.length === 0
      ? "EMPTY"
      : fluidIds.map((fluidId) => FLUIDS[fluidId].name).join(" → ");
  const fillPercent =
    capacityMilli <= 0
      ? 0
      : Math.round((amountMilli / capacityMilli) * 100);
  const recipe =
    state.recipeId === undefined
      ? undefined
      : FLUID_RECIPES[state.recipeId];
  const processPercent =
    recipe === undefined
      ? fillPercent
      : Math.round(
          Math.min(1, state.processTicks / recipe.durationTicks) * 100,
        );
  const bufferDetail = buffers
    .map((buffer, index) => {
      const role =
        state.input === buffer
          ? "IN"
          : state.output === buffer
            ? "OUT"
            : "BUFFER";
      const fluid =
        buffer.fluidId === undefined
          ? "empty"
          : FLUIDS[buffer.fluidId].name;
      return `${role} ${fluid} ${(buffer.amountMilli / 1_000).toFixed(1)} / ${(buffer.capacityMilli / 1_000).toFixed(1)}`;
    })
    .join(" · ");

  return {
    stats: [
      {
        id: "fluid-medium",
        label: "Medium",
        value: medium,
      },
      {
        id: "fluid-volume",
        label: "Volume",
        value: (amountMilli / 1_000).toFixed(1),
        unit: "units",
      },
      {
        id: "fluid-fill",
        label: "Fill",
        value: fillPercent,
        unit: "%",
      },
      {
        id: recipe ? "fluid-batch" : "fluid-power",
        label: recipe ? "Batch" : "Power",
        value: recipe
          ? processPercent
          : Math.round(entity.powerSatisfaction * 100),
        unit: "%",
      },
    ],
    recipe: {
      icon:
        recipe === undefined
          ? entity.kind === "fluidSource"
            ? "WL"
            : "FL"
          : "RF",
      label:
        recipe?.name ??
        (state.sourceFluidId === undefined
          ? "Fluid transport"
          : `${FLUIDS[state.sourceFluidId].name} wellhead`),
      detail:
        bufferDetail ||
        (state.sourceFluidId === undefined
          ? "Dry line — awaiting a compatible fluid."
          : `Producing ${FLUIDS[state.sourceFluidId].name}.`),
    },
  };
}

function circuitInspectorPresentation(
  entity: RenderEntityState,
  circuit: CircuitSimulationSnapshot | undefined,
): {
  readonly active: boolean;
  readonly stats: readonly HUDInspectorStat[];
  readonly recipe: NonNullable<HUDInspector["recipe"]>;
} | null {
  if (!isCircuitEntityKind(entity.kind) || circuit === undefined) {
    return null;
  }
  const device = circuit.devices.find(
    (candidate) => candidate.id === `entity:${entity.id}:device`,
  );
  const endpoints = circuit.endpoints.filter(
    (endpoint) => endpoint.entityId === entity.id,
  );
  const endpointIds = new Set(
    endpoints.map((endpoint) => endpoint.endpointId),
  );
  const inputSignals =
    endpoints.find((endpoint) => endpoint.connector === "input")
      ?.signals ?? [];
  const outputSignals =
    endpoints.find((endpoint) => endpoint.connector === "output")
      ?.signals ?? [];
  const configuredOutputSignals =
    device?.kind === "constant" && device.enabled !== false
      ? device.signals
      : [];
  const presentedOutputSignals =
    outputSignals.length > 0
      ? outputSignals
      : configuredOutputSignals;
  const active = endpoints.some((endpoint) =>
    endpoint.signals.some((signal) => signal.value !== 0),
  ) || configuredOutputSignals.some((signal) => signal.value !== 0);
  const wires = circuit.wires.filter(
    (wire) =>
      endpointIds.has(wire.endpointA) ||
      endpointIds.has(wire.endpointB),
  ).length;
  const signalPreview = [...presentedOutputSignals, ...inputSignals]
    .filter((entry) => entry.value !== 0)
    .filter(
      (entry, index, entries) =>
        entries.findIndex(
          (candidate) =>
            candidate.signal.type === entry.signal.type &&
            candidate.signal.name === entry.signal.name,
        ) === index,
    )
    .slice(0, 3)
    .map(
      (entry) =>
        `${humanizeCamel(entry.signal.name)} ${formatWhole(entry.value)}`,
    )
    .join(" · ");
  const kernel =
    device?.kind ??
    (entity.kind === "constantCombinator"
      ? "constant"
      : entity.kind === "arithmeticCombinator"
        ? "arithmetic"
        : "decider");
  const operation =
    device?.kind === "arithmetic"
      ? humanizeCamel(device.operator)
      : device?.kind === "decider"
        ? `Compare ${device.condition.operator}`
        : device?.kind === "constant"
          ? device.enabled === false
            ? "Broadcast disabled"
            : "Constant broadcast"
          : "Awaiting configuration";

  return {
    active,
    stats: [
      {
        id: "circuit-kernel",
        label: "Kernel",
        value: kernel.toUpperCase(),
      },
      {
        id: "circuit-input",
        label: "Input",
        value: inputSignals.length,
        unit: inputSignals.length === 1 ? "signal" : "signals",
      },
      {
        id: "circuit-output",
        label: "Output",
        value: presentedOutputSignals.length,
        unit:
          presentedOutputSignals.length === 1
            ? "signal"
            : "signals",
      },
      {
        id: "circuit-links",
        label: "Links",
        value: wires,
        unit: wires === 1 ? "wire" : "wires",
      },
    ],
    recipe: {
      icon:
        kernel === "constant"
          ? "CN"
          : kernel === "arithmetic"
            ? "AR"
            : "DC",
      label: operation,
      detail:
        signalPreview ||
        `Tick ${formatWhole(circuit.tick)} · no non-zero signal`,
    },
  };
}

function sumInventory(inventory: Partial<Record<ItemId, number>>): number {
  return Object.values(inventory).reduce<number>(
    (total, amount) => total + (amount ?? 0),
    0,
  );
}

function describeBuffer(entity: EntityState): string {
  const parts = Object.entries({ ...entity.input, ...entity.output })
    .filter(([, amount]) => (amount ?? 0) > 0)
    .slice(0, 2)
    .map(([item, amount]) => `${amount} ${humanizeCamel(item)}`);
  return parts.length > 0 ? parts.join(" · ") : "Buffers awaiting material";
}

function humanizeStatus(status: EntityStatus): string {
  const labels: Record<EntityStatus, string> = {
    idle: "Standby",
    working: "Operating",
    unconfigured: "Recipe required",
    changingRecipe: "Changing recipe",
    noPower: "Grid offline",
    noFuel: "Fuel required",
    noResource: "Seam depleted",
    missingInput: "Input starved",
    outputFull: "Output blocked",
    blocked: "Transfer blocked",
  };
  return labels[status];
}

function humanizeCamel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function manifoldModeLabel(
  mode: NonNullable<EntityState["manifoldRouting"]>["mode"],
  extractPort: 0 | 1,
): string {
  switch (mode) {
    case "favorA":
      return "Favor local A";
    case "favorB":
      return "Favor local B";
    case "extract":
      return `Extract to local ${extractPort === 0 ? "A" : "B"}`;
    default:
      return "Even dispatch";
  }
}
