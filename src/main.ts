import "./style.css";

import { AudioEngine } from "./game/audio";
import {
  captureBlueprint,
  planBlueprintPlacement,
  restoreBlueprint,
  serializeBlueprint,
  transformBlueprint,
  type Blueprint,
  type BlueprintPlacement,
  type BlueprintPlacementPlan,
} from "./game/blueprints";
import {
  BlueprintLibraryOperationError,
  createBlueprintLibrary,
  createBlueprintLibraryEntry,
  deleteBlueprintLibraryEntry,
  duplicateBlueprintLibraryEntry,
  moveBlueprintLibraryEntry,
  restoreBlueprintLibrary,
  selectBlueprintLibraryEntry,
  serializeBlueprintLibrary,
  updateBlueprintLibraryEntry,
  type BlueprintLibrary,
  type BlueprintLibraryEntry,
} from "./game/blueprintLibrary";
import {
  ENTITY_PROTOTYPES,
  COAL_ENERGY_KJ,
  FLUIDS,
  FLUID_IDS,
  ITEMS,
  ITEM_IDS,
  RECIPES,
  isCircuitEntityKind,
} from "./game/catalog";
import {
  CIRCUIT_VIRTUAL_SIGNAL_SUGGESTIONS,
  buildCircuitDeviceConfiguration,
  buildCircuitMachineConfiguration,
  commitCircuitHistory,
  circuitConfigurationKey,
  circuitDeviceConfigurationFromSnapshot,
  circuitMachineConfigurationFromSnapshot,
  circuitPointForEndpoint,
  preflightCircuitWire,
  type CircuitDeviceDraft,
  type CircuitMachineDraft,
} from "./game/circuitAuthoring";
import {
  circuitEndpointBindings,
  circuitMachineCapabilities,
  isCircuitMachineKind,
} from "./game/circuit-integration";
import {
  toHUDMapEntities,
  toHUDMapResources,
  toInspector,
  toMission,
  toRenderSnapshot,
} from "./game/adapters";
import {
  InteractionController,
  isEditableShortcutTarget,
  type GridPoint,
} from "./game/input";
import {
  CAMPAIGN_INITIAL_ALLOY,
  COMMISSION_DEFINITIONS,
  COMMISSION_IDS,
  PROGRESSION_ITEM_IDS,
  PROGRESSION_BUILD_COSTS,
  addProgressionInventory,
  availableCommissionIds,
  commitRailAlloy,
  commitPlacement,
  completeSelectedCommission,
  createCampaignProgression,
  createProgressionInventory,
  grantedConstructionProvenance,
  isRailAuthoringUnlocked,
  migrateLegacySandboxProgression,
  preflightPlacement,
  preflightRailPurchase,
  preflightRailRefund,
  progressionInventoryCount,
  refundConstruction,
  restoreConstructionProvenance,
  restoreProgression,
  restoreProgressionWithBuildCatalogReconciliation,
  restoreProgressionInventory,
  selectCommission,
  serializeProgression,
  serializeProgressionInventory,
  type CommissionId,
  type ConstructionProvenance,
  type ProgressionInventory,
  type ProgressionState,
  type RailAlloyAuthorization,
} from "./game/progression";
import { FactorySimulation, createDemoSimulation } from "./game/simulation";
import {
  RAIL_LIMITS,
  type RailCarInput,
  type RailNetworkInput,
  type RailScheduleStop,
  type RailSegmentInput,
  type RailSignalInput,
  type RailStationInput,
  type RailTrainInput,
} from "./game/rail-network";
import {
  RAIL_BUILD_COSTS,
  RAIL_BUILD_KINDS,
  RAIL_BUILD_LABELS,
  authoredSegment,
  canonicalRailAuthoringState,
  canonicalRailItemFilter,
  canonicalStationInput,
  createGrantedRailAuthoringState,
  explainRailMutationFailure,
  nextRailId,
  paidRailAlloy,
  preflightDirectedSignal,
  preflightSchedule,
  preflightStationBinding,
  preflightStationPlacement,
  preflightTrackPlacement,
  preflightTrainPlacement,
  railDismantleBlockers,
  railEntry,
  railLedgerKey,
  railToolRotation,
  recordRailConstructions,
  removeRailConstructions,
  restoreRailAuthoringState,
  type RailAuthoringState,
  type RailBuildKind,
  type RailConstructionDraft,
  type RailLedgerTargetKind,
} from "./game/railAuthoring";
import {
  Direction,
  TerrainType,
  type CircuitConnectionPoint,
  type CircuitWireColor,
  type EntityState,
  type ItemId,
  type ManifoldRouting,
  type PlaceOptions,
  type PlacementFailure,
  type RecipeId,
  type RenderEntityState,
  type RailStationStorageInterface,
  type RailMutationResult,
  type SerializedSimulation,
  type SimulationEvent,
  type SimulationStats,
} from "./game/types";
import {
  isCanonicalUplinkDockBelt,
  isLegacyUplinkRearBelt,
  isUplinkDockApproachBelt,
  resolveUplinkDockDescriptor,
  type UplinkDockDescriptor,
} from "./game/uplinkDock";
import { WorldRenderer } from "./render/WorldRenderer";
import type {
  RailAuthoringPreview,
  RailPickTarget,
} from "./render/RailRenderer";
import {
  createBlueprintCaptureMarquee,
  createBlueprintOverlayLayout,
  type BlueprintCaptureMarquee,
  type BlueprintOverlayLayout,
} from "./render/blueprintOverlay";
import {
  HUD,
  HUD_ADVANCED_BUILD_ORDER,
  HUD_BUILD_ORDER,
  HUD_PRIMARY_BUILD_ORDER,
  type BuildKind,
  type HUDBlueprint,
  type HUDBlueprintLibrary,
  type HUDInspector,
  type HUDCircuitEditor,
  type HUDModel,
  type HUDRailAuthoring,
  type HUDSession,
} from "./ui/HUD";
import {
  commissionGuidance,
  readStorage,
  removeStorage,
  sessionStartupNotice,
  writeVerifiedStorage,
  type SessionStartupKind,
  type StorageResult,
} from "./ui/m1Session";

const canvas = document.querySelector<HTMLCanvasElement>("#world");
const hudRoot = document.querySelector<HTMLElement>("#hud");
if (!canvas || !hudRoot) throw new Error("Cinderline shell did not initialize.");

const SESSION_VERSION = 6;
const SAVE_KEY = "cinderline.autosave.v6";
const PREVIOUS_SESSION_KEY = "cinderline.autosave.v5";
const PREVIOUS_V4_SESSION_KEY = "cinderline.autosave.v4";
const LEGACY_SESSION_KEY = "cinderline.autosave.v3";
const LEGACY_SAVE_KEY = "cinderline.autosave.v2";
const RESET_BACKUP_KEY = "cinderline.autosave.pre-reset.v6";
const LEGACY_DEFAULT_ALLOY = 3_200;
const PRE_REBALANCE_COMMISSION_ALLOY: Readonly<
  Record<CommissionId, number>
> = Object.freeze({
  bootstrap: 160,
  throughput: 160,
  control: 200,
  autonomy: 300,
  "frontier-shipment": 120,
});
const BLUEPRINT_CLIPBOARD_KEY = "cinderline.blueprint.v2";
const LEGACY_BLUEPRINT_CLIPBOARD_KEY = "cinderline.blueprint.v1";
const BLUEPRINT_LIBRARY_KEY = "cinderline.blueprint-library.v2";
const LEGACY_BLUEPRINT_LIBRARY_KEY = "cinderline.blueprint-library.v1";

function isBuildKind(kind: EntityState["kind"]): kind is BuildKind {
  return HUD_BUILD_ORDER.includes(kind as BuildKind);
}

function requireBuildKind(kind: EntityState["kind"]): BuildKind {
  if (!isBuildKind(kind)) {
    throw new TypeError(
      `Entity kind ${kind} has no campaign construction integration.`,
    );
  }
  return kind;
}

interface AtomicSession {
  origin: "campaign" | "legacySandbox";
  coreGeneratorEntityId: number | null;
  simulation: SerializedSimulation;
  progression: ProgressionState;
  uplinkInventory: ProgressionInventory;
  construction: Array<{
    entityId: number;
    provenance: ConstructionProvenance;
  }>;
  railConstruction: RailAuthoringState;
  uplinkEntityId: number | null;
}

interface PersistedSession extends AtomicSession {
  format: "cinderline-session";
  version: typeof SESSION_VERSION;
}

interface LoadedSession {
  origin: AtomicSession["origin"];
  coreGeneratorEntityId: number | null;
  simulation: FactorySimulation;
  progression: ProgressionState;
  uplinkInventory: ProgressionInventory;
  constructionProvenance: Map<number, ConstructionProvenance>;
  railConstruction: RailAuthoringState;
  uplinkEntityId: number | null;
}

const BUILD_COSTS: Record<BuildKind, number> = {
  ...PROGRESSION_BUILD_COSTS,
};

function playerPlacementOptions(kind: BuildKind): PlaceOptions {
  if (kind === "fluidSource") return { fluidId: "crudeOil" };
  if (kind === "fluidProcessor") {
    return { fluidRecipeId: "refineCrude" };
  }
  return {};
}

function placementGhostKind(
  kind: BuildKind,
): NonNullable<Parameters<WorldRenderer["setGhost"]>[0]> {
  // WorldRenderer routes advanced live entities through dedicated renderers;
  // its placement-ghost path intentionally accepts the same runtime kinds.
  return kind as NonNullable<Parameters<WorldRenderer["setGhost"]>[0]>;
}

const CAMPAIGN_STARTER_LEDGER = new Map<
  number,
  { readonly kind: BuildKind; readonly x: number; readonly y: number }
>([
  [1, { kind: "generator", x: 18, y: 3 }],
  [2, { kind: "gridRelay", x: 16, y: 6 }],
  [3, { kind: "gridRelay", x: 9, y: 8 }],
  [4, { kind: "extractor", x: 5, y: 5 }],
  [5, { kind: "belt", x: 7, y: 5 }],
  [6, { kind: "belt", x: 8, y: 5 }],
  [7, { kind: "belt", x: 9, y: 5 }],
  [8, { kind: "belt", x: 10, y: 5 }],
  [9, { kind: "inserter", x: 11, y: 5 }],
  [10, { kind: "smelter", x: 12, y: 4 }],
  [11, { kind: "storage", x: 22, y: 11 }],
]);
const CAMPAIGN_UPLINK_ENTITY_ID = 11;
const CAMPAIGN_CORE_GENERATOR_ID = 1;
const CAMPAIGN_STARTER_COAL = 12;
const CAMPAIGN_STARTER_COAL_RESOURCE = 5_376;

const PLACEMENT_MESSAGES: Record<PlacementFailure, string> = {
  outOfBounds: "Outside the surveyed construction perimeter.",
  occupied: "Footprint intersects existing infrastructure.",
  water: "This foundation cannot be anchored in a flooded cell.",
  requiresResource: "Extractors must overlap a viable mineral seam.",
  invalidRecipe: "Selected process is incompatible with this unit.",
};
const UPLINK_SITE_CLEARANCE_MESSAGE =
  "Uplink clearance reserved. Belts connect only at the pulsing cyan DOCK tile; the final belt auto-aligns.";

type UplinkSiteReservation = UplinkDockDescriptor;

function entityFootprintTiles(
  kind: EntityState["kind"],
  x: number,
  y: number,
  direction: Direction,
): GridPoint[] {
  const base = ENTITY_PROTOTYPES[kind].footprint;
  const width =
    direction === Direction.East || direction === Direction.West
      ? base.height
      : base.width;
  const height =
    direction === Direction.East || direction === Direction.West
      ? base.width
      : base.height;
  const tiles: GridPoint[] = [];
  for (let offsetY = 0; offsetY < height; offsetY += 1) {
    for (let offsetX = 0; offsetX < width; offsetX += 1) {
      tiles.push({
        x: Math.floor(x) + offsetX,
        z: Math.floor(y) + offsetY,
      });
    }
  }
  return tiles;
}

function resolveUplinkSiteReservation(
  target: FactorySimulation,
  targetUplinkId: number | null,
): UplinkSiteReservation | null {
  if (targetUplinkId === null) return null;
  const uplink = target.getEntity(targetUplinkId);
  if (!uplink || uplink.kind !== "storage") return null;
  return resolveUplinkDockDescriptor({
    x: uplink.x,
    z: uplink.y,
    width: uplink.width,
    height: uplink.height,
    direction: uplink.direction,
  });
}

function isUplinkDockTile(
  reservation: UplinkSiteReservation | null,
  point: GridPoint,
): boolean {
  return Boolean(
    reservation
    && point.x === reservation.dockTile.x
    && point.z === reservation.dockTile.z,
  );
}

function effectivePlacementDirection(
  kind: EntityState["kind"],
  point: GridPoint,
  direction: Direction,
): Direction {
  const reservation = resolveUplinkSiteReservation(
    simulation,
    uplinkEntityId,
  );
  return kind === "belt" && isUplinkDockTile(reservation, point)
    ? reservation!.direction
    : direction;
}

const DIRECTION_LABELS: Record<Direction, string> = {
  [Direction.North]: "NORTHBOUND ↑",
  [Direction.East]: "EASTBOUND →",
  [Direction.South]: "SOUTHBOUND ↓",
  [Direction.West]: "WESTBOUND ←",
};

function resolveConnectedUplinkDockBelt(
  target: FactorySimulation,
  targetUplinkId: number | null,
): EntityState | null {
  const reservation = resolveUplinkSiteReservation(
    target,
    targetUplinkId,
  );
  if (!reservation) return null;
  const candidate = target.getEntityAt(
    reservation.dockTile.x,
    reservation.dockTile.z,
  );
  return candidate?.kind === "belt"
    && isCanonicalUplinkDockBelt(reservation, {
      x: candidate.x,
      z: candidate.y,
      direction: candidate.direction,
    })
    ? candidate
    : null;
}

function resolveDeliveringUplinkDockBelt(
  target: FactorySimulation,
  targetUplinkId: number | null,
): EntityState | null {
  const canonical = resolveConnectedUplinkDockBelt(
    target,
    targetUplinkId,
  );
  if (canonical) return canonical;
  const reservation = resolveUplinkSiteReservation(
    target,
    targetUplinkId,
  );
  if (!reservation) return null;
  const legacy = target.getEntityAt(
    reservation.legacyRearTile.x,
    reservation.legacyRearTile.z,
  );
  return legacy?.kind === "belt"
    && isLegacyUplinkRearBelt(reservation, {
      x: legacy.x,
      z: legacy.y,
      direction: legacy.direction,
    })
    ? legacy
    : null;
}

function checkUplinkSiteClearance(
  target: FactorySimulation,
  targetUplinkId: number | null,
  kind: EntityState["kind"],
  x: number,
  y: number,
  direction: Direction,
): {
  readonly ok: boolean;
  readonly reason?: "uplinkSiteReserved";
  readonly tiles: readonly GridPoint[];
  readonly reservation: UplinkSiteReservation | null;
} {
  const tiles = entityFootprintTiles(kind, x, y, direction);
  const reservation = resolveUplinkSiteReservation(
    target,
    targetUplinkId,
  );
  if (!reservation) return { ok: true, tiles, reservation };
  const reserved = new Set(
    reservation.reservedTiles.map((tile) => `${tile.x}:${tile.z}`),
  );
  const entersReservedEnvelope = tiles.some(
    (tile) => reserved.has(`${tile.x}:${tile.z}`),
  );
  const entersDock = tiles.some(
    (tile) =>
      tile.x === reservation.dockTile.x
      && tile.z === reservation.dockTile.z,
  );
  const validDockBelt = (
    kind === "belt"
    && direction === reservation.direction
    && tiles.length === 1
    && entersDock
  );
  const validDockApproachBelt = (
    kind === "belt"
    && tiles.length === 1
    && isUplinkDockApproachBelt(reservation, {
      x: tiles[0]!.x,
      z: tiles[0]!.z,
      direction,
    })
  );
  if (
    (entersReservedEnvelope && !validDockBelt && !validDockApproachBelt)
    || (entersDock && !validDockBelt)
  ) {
    return {
      ok: false,
      reason: "uplinkSiteReserved",
      tiles,
      reservation,
    };
  }
  return { ok: true, tiles, reservation };
}

let persistenceAvailable = true;
let sessionStartupKind: SessionStartupKind = "new";
let sessionLoadWarning: string | null = null;
let lastSavedAt: number | null = null;
let preResetBackupAvailable = false;

const initialSession = loadSession();
preResetBackupAvailable = safeStorageRead(RESET_BACKUP_KEY) !== null;
let simulation = initialSession.simulation;
let sessionOrigin = initialSession.origin;
let coreGeneratorEntityId = initialSession.coreGeneratorEntityId;
let selectedBuild: BuildKind | null = null;
let selectedDirection = Direction.East;
let blueprintMode: "capture" | "paste" | null = null;
let blueprintCaptureAnchor: GridPoint | null = null;
let blueprintClipboard = loadBlueprintClipboard();
let blueprintLibrary = loadBlueprintLibrary();
let blueprintLibraryOpen = false;
let blueprintLibraryDeleteUndo: BlueprintLibrary | null = null;
type BlueprintTransformMatrix = readonly [
  number,
  number,
  number,
  number,
];
const BLUEPRINT_IDENTITY: BlueprintTransformMatrix = [1, 0, 0, 1];
const BLUEPRINT_ROTATE_CW: BlueprintTransformMatrix = [0, -1, 1, 0];
const BLUEPRINT_MIRROR_H: BlueprintTransformMatrix = [-1, 0, 0, 1];
const BLUEPRINT_MIRROR_V: BlueprintTransformMatrix = [1, 0, 0, -1];
let blueprintTransformMatrix: BlueprintTransformMatrix = BLUEPRINT_IDENTITY;
let selectedEntityId: number | null = null;
interface PendingCircuitWire {
  readonly color: CircuitWireColor;
  readonly source: CircuitConnectionPoint;
}
let pendingCircuitWire: PendingCircuitWire | null = null;
let hoveredCell: GridPoint | null = null;
let lastBeltCell: GridPoint | null = null;
let paused = false;
let progression = initialSession.progression;
let uplinkInventory = initialSession.uplinkInventory;
let constructionProvenance = initialSession.constructionProvenance;
let railConstruction = initialSession.railConstruction;
let railConsoleOpen = false;
let selectedRailTool: RailBuildKind | null = null;
let selectedRailTarget: RailPickTarget | null = null;
let pendingRailSignalSourceId: string | null = null;
let railAuthoringRotation: 0 | 1 | 2 | 3 = 0;
let railAuthoringStatus =
  "Open the console, choose a tool, then author directly in the world.";
let hoveredRailTarget: RailPickTarget | null = null;
type RailHoverContext = "general" | "station" | "train";
const railHoverDurations: Record<RailHoverContext, number[]> = {
  general: [],
  station: [],
  train: [],
};
let uplinkEntityId = initialSession.uplinkEntityId;
let cameraFocus = getFactoryCenter();
let cameraViewWidth = simulation.railSnapshot() ? 28 : 38;
let elapsedReal = 0;
let nextHUDRefresh = 0;
let nextSaveAt = 18;
let lastProducedTotal = 0;
let lastThroughputSample = 0;
let throughputPerMinute = 0;
let previousObjectiveCompletion = new Set<string>();
let recipeCommandSequence = 0;
const queuedRecipeToastIds = new Map<number, string>();
const undoStack: AtomicSession[] = [];
const redoStack: AtomicSession[] = [];
interface UplinkTransferVisual {
  readonly item: ItemId;
  readonly startedAt: number;
}
const UPLINK_TRANSFER_INBOUND_SECONDS = 0.56;
const UPLINK_TRANSFER_SETTLE_SECONDS = 0.12;
const UPLINK_TRANSFER_RETURN_SECONDS = 0.38;
const UPLINK_TRANSFER_VISUAL_QUEUE_LIMIT = 64;
const uplinkTransferVisualQueue: ItemId[] = [];
let activeUplinkTransferVisual: UplinkTransferVisual | null = null;

const renderer = new WorldRenderer(canvas);
const blueprintRenderer = renderer as WorldRenderer & {
  setBlueprintOverlay?(layout: BlueprintOverlayLayout | null): void;
  setBlueprintCaptureMarquee?(marquee: BlueprintCaptureMarquee | null): void;
};
// AudioEngine owns the reviewed shipping mix so gameplay cannot silently drift
// back to an older, quieter set of per-entrypoint overrides.
const audio = new AudioEngine();
const initialPower = simulation.stats().power;
audio.setPowerLoad(
  initialPower.capacityKW - initialPower.disconnectedCapacityKW > 0
    ? initialPower.satisfaction
    : 0,
);

const hud = new HUD(hudRoot, {
  onBuildSelect: selectBuild,
  onRotate: rotateBuild,
  onRemove: removeSelectedEntity,
  onCancel: cancelBuild,
  onPauseToggle: togglePause,
  onFocus: focusFactory,
  onSessionSave: () => saveSession(true),
  onSessionReset: resetCampaign,
  onSessionRestore: restorePreResetSession,
  onMuteToggle: () => {
    const muted = audio.toggleMute();
    hud.update({ muted });
    hud.showToast({
      title: muted ? "AUDIO MUTED" : "AUDIO ONLINE",
      message: muted
        ? "Factory telemetry audio has been suspended."
        : "Industrial ambience restored.",
      duration: 1800,
    });
  },
  onPowerRetrofit: retrofitPowerGrid,
  onCommissionSelect: chooseCommission,
  onCommissionSubmit: submitCommission,
  onInspectorAction: handleInspectorAction,
  onHelp: showHelp,
  onInspectorClose: closeInspector,
  onManifoldRoutingChange: (entityId, routing) => {
    configureManifoldRouting(Number(entityId), routing);
  },
  onRecipeChange: (entityId, recipeId) => {
    configureMachineRecipe(Number(entityId), recipeId);
  },
  onCircuitDeviceConfigure: configureCircuitDeviceFromHUD,
  onCircuitMachineConfigure: configureCircuitMachineFromHUD,
  onCircuitWireStart: beginCircuitWire,
  onCircuitWireFinish: finishCircuitWire,
  onCircuitWireCancel: cancelCircuitWire,
  onCircuitWireDisconnect: removeCircuitWire,
  onUndo: undo,
  onRedo: redo,
  onBlueprintMirror: mirrorBlueprint,
  onBlueprintLibraryToggle: toggleBlueprintLibrary,
  onBlueprintLibrarySave: saveClipboardToBlueprintLibrary,
  onBlueprintLibraryCreateBook: createBlueprintLibraryBook,
  onBlueprintLibrarySelect: selectBlueprintLibraryRecord,
  onBlueprintLibraryLoad: loadSelectedBlueprintLibraryRecord,
  onBlueprintLibraryUpdate: updateSelectedBlueprintLibraryRecord,
  onBlueprintLibraryReassign: reassignSelectedBlueprintLibraryRecord,
  onBlueprintLibraryDuplicate: duplicateSelectedBlueprintLibraryRecord,
  onBlueprintLibraryMove: moveSelectedBlueprintLibraryRecord,
  onBlueprintLibraryDelete: deleteSelectedBlueprintLibraryRecord,
  onBlueprintLibraryRestoreDelete: restoreDeletedBlueprintLibraryRecord,
  onBlueprintLibraryExport: exportBlueprintLibrary,
  onBlueprintLibraryImport: importBlueprintLibrary,
  onRailToggle: toggleRailConsole,
  onRailToolSelect: selectRailTool,
  onRailRotate: rotateRailTool,
  onRailCancel: cancelRailAuthoring,
  onRailDismantle: dismantleSelectedRail,
  onRailStationApply: applyRailStationInterface,
  onRailScheduleApply: applyRailSchedule,
  onRailConsistAdd: addRailConsistCar,
  onRailCarRemove: removeRailConsistCar,
  onRailLocomotiveFuel: fuelRailLocomotive,
});

const input = new InteractionController(canvas, {
  screenToGrid: (x, y) => renderer.screenToGrid(x, y),
  pickEntity: (x, y) => {
    // Touch selection should resolve the same occupied cell as desktop
    // direct manipulation. Large authored meshes (especially the Uplink
    // dish) overhang neighboring belt cells and can otherwise steal taps
    // from infrastructure that is authoritatively present under the finger.
    const cell = renderer.screenToGrid(x, y);
    const cellEntity = cell
      ? simulation.getEntityAt(cell.x, cell.z)
      : undefined;
    if (cellEntity) return cellEntity.id;
    const id = renderer.pickEntity(x, y);
    if (typeof id === "number") return id;
    if (id !== null) return Number(id);
    return null;
  },
  onHover: handleHover,
  onPrimary: handlePrimary,
  onPrimaryRelease: handlePrimaryRelease,
  onSelect: selectEntity,
  onRemove: removeEntity,
  onRotate: rotateBuild,
  onCancel: cancelBuild,
  onPan: (dx, dz) => {
    renderer.pan(dx, dz);
    cameraFocus.x += dx;
    cameraFocus.z += dz;
  },
  onZoom: (delta, clientX, clientY) => {
    const before = renderer.screenToGrid(clientX, clientY);
    const scaledDelta = clamp(delta, -4, 4);
    renderer.zoom(scaledDelta);
    cameraViewWidth = clamp(
      cameraViewWidth * Math.exp(scaledDelta * 0.12),
      22,
      72,
    );
    const after = renderer.screenToGrid(clientX, clientY);
    if (before && after) {
      const dx = before.x - after.x;
      const dz = before.z - after.z;
      renderer.pan(dx, dz);
      cameraFocus.x += dx;
      cameraFocus.z += dz;
    }
  },
  onFocus: focusFactory,
  onPause: togglePause,
  onUndo: undo,
  onRedo: redo,
  onDismantle: dismantleSelectedOrHovered,
  onBlueprintCapture: beginBlueprintCapture,
  onBlueprintLibrary: toggleBlueprintLibrary,
  onBlueprintCopy: copySelectedBlueprint,
  onBlueprintPaste: beginBlueprintPaste,
  onBlueprintMirror: mirrorBlueprint,
  onToolHotkey: (index) => {
    if (railConsoleOpen) {
      const kind = RAIL_BUILD_KINDS[index];
      if (kind) selectRailTool(kind);
      return;
    }
    const kind = HUD_PRIMARY_BUILD_ORDER[index];
    if (kind) selectBuild(kind);
  },
  onRailPalette: toggleRailConsole,
  canDragBuild: () => selectedBuild === "belt",
  canTouchPan: () =>
    !railConsoleOpen &&
    !pendingCircuitWire &&
    blueprintMode === null &&
    selectedBuild === null,
});

window.addEventListener(
  "keydown",
  (event) => {
    if (
      railConsoleOpen ||
      !event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.repeat ||
      isEditableShortcutTarget(event.target)
    ) {
      return;
    }
    const match = /^Digit([1-8])$/.exec(event.code);
    if (!match) return;
    const kind = HUD_ADVANCED_BUILD_ORDER[Number(match[1]) - 1];
    if (!kind) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selectBuild(kind);
  },
  { capture: true },
);

await renderer.init();
renderer.focus(cameraFocus.x, cameraFocus.z);
if (cameraViewWidth !== 38) {
  renderer.zoom(Math.log(cameraViewWidth / 38) / 0.12);
}
syncRenderer();
refreshHUD(true);
updateBlueprintLibraryHUD();

const app = document.querySelector<HTMLElement>("#app");
const boot = document.querySelector<HTMLElement>("#boot");

const showStartupToast = (): void => {
  const startup = createSessionHUD();
  hud.showToast({
    title: startup.label,
    message:
      progression.mode === "campaign"
        ? `${campaignMission().description} Open the Field Manual from the save menu for mouse and touch controls.`
        : "Select a unit below or press 1–9/0. Drag belts, rotate with R, inspect any machine.",
    tone: startup.state === "volatile" ? "error" : "info",
    duration: 4400,
  });
  const connectedDock = resolveConnectedUplinkDockBelt(
    simulation,
    uplinkEntityId,
  );
  const deliveringDock = resolveDeliveringUplinkDockBelt(
    simulation,
    uplinkEntityId,
  );
  if (!connectedDock && deliveringDock) {
    hud.showToast({
      dedupeKey: "uplink-legacy-rear-lane",
      title: "LEGACY UPLINK LANE",
      message:
        "This older rear belt remains operational. New routes should use the pulsing cyan DOCK at X21 Z12; dismantling the old belt refunds it normally.",
      tone: "info",
      duration: 7200,
    });
  }
};

let hudRevealed = false;
const revealHUD = (): void => {
  if (hudRevealed) return;
  hudRevealed = true;

  // Remove the boot layer before making the populated HUD visible. Keeping
  // these mutations in this order guarantees there is no cross-fade frame.
  if (boot) {
    boot.hidden = true;
    boot.setAttribute("aria-hidden", "true");
  }
  app?.classList.add("is-hud-ready");
  showStartupToast();
};

const beginBootExit = (): void => {
  if (!boot) {
    revealHUD();
    return;
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    boot.classList.add("is-done");
    revealHUD();
    return;
  }

  let fallback = 0;
  const finish = (): void => {
    window.clearTimeout(fallback);
    boot.removeEventListener("transitionend", onTransitionEnd);
    boot.removeEventListener("transitioncancel", finish);
    revealHUD();
  };
  const onTransitionEnd = (event: TransitionEvent): void => {
    if (event.target === boot && event.propertyName === "opacity") finish();
  };

  boot.addEventListener("transitionend", onTransitionEnd);
  boot.addEventListener("transitioncancel", finish, { once: true });
  boot.classList.add("is-done");
  // A backgrounded tab may not dispatch transitionend. The fallback preserves
  // the same ordering without leaving the interface permanently unavailable.
  fallback = window.setTimeout(finish, 850);
};

window.setTimeout(beginBootExit, 420);

const resizeObserver = new ResizeObserver(() => renderer.resize());
resizeObserver.observe(canvas);
window.addEventListener("beforeunload", () => saveSession());
window.addEventListener("pagehide", () => saveSession());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveSession();
});

let lastFrame = performance.now();
let elapsedRender = 0;
function frame(now: number): void {
  const dt = Math.min(0.08, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  elapsedReal += dt;
  elapsedRender += dt;

  input.update(dt);
  if (!paused) {
    simulation.tick(dt);
    transferDockedUplinkCargo();
  }

  const events = simulation.drainEvents();
  if (events.length > 0) handleSimulationEvents(events);

  syncRenderer();
  renderer.update(dt, elapsedRender);
  renderer.render(dt);

  if (elapsedReal >= nextHUDRefresh) {
    refreshHUD(false);
    nextHUDRefresh = elapsedReal + 0.18;
  }
  if (elapsedReal >= nextSaveAt) {
    saveSession();
    nextSaveAt = elapsedReal + 30;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/**
 * The simulation's belts intentionally hand off only to belt/manifold
 * topology. The Commission Uplink's surveyed dock is the campaign adapter
 * that turns a payload physically waiting at the end of its aligned belt into
 * an atomic storage transfer. That preserves real belt custody and emits the
 * same itemTransferred event as every other simulation transfer.
 */
function transferDockedUplinkCargo(): void {
  if (progression.mode !== "campaign" || uplinkEntityId === null) return;
  const reservation = resolveUplinkSiteReservation(simulation, uplinkEntityId);
  if (!reservation) return;
  // Pre-fix saves could contain one eastbound belt in the neighboring rear
  // lane. New construction can no longer create it, but allowing its cargo to
  // drain preserves an in-progress campaign instead of stranding the player.
  const dock = resolveDeliveringUplinkDockBelt(simulation, uplinkEntityId);
  if (!dock) return;
  const contactItem = dock.beltItems
    .filter((item) => item.progress >= 0.999)
    .sort(
      (left, right) =>
        right.progress - left.progress || left.id - right.id,
    )[0];
  if (!contactItem) return;
  simulation.transfer(
    dock.id,
    uplinkEntityId,
    contactItem.item,
    1,
    "belt",
    "inventory",
  );
}

/**
 * Scoped browser-QA accelerator for the paid Uplink showcase. It advances the
 * exact same simulation tick, surveyed-dock transfer, event handler, custody
 * queue, renderer sync, and renderer update used by the live frame loop. It
 * cannot create cargo or bypass storage custody, and is unavailable outside
 * `?uplinkShowcase`; its sole purpose is proving the complete 49-item
 * manifest without a minute of wall-clock waiting or a direct-fill shortcut.
 */
function advanceUplinkShowcase(
  requestedSeconds: number,
): {
  readonly advancedSeconds: number;
  readonly steps: number;
  readonly sourceInventory: number;
  readonly sourceBeltItems: number;
  readonly custodyCount: number;
  readonly queueDepth: number;
  readonly activeTransfer: boolean;
  readonly manifestComplete: boolean;
} {
  if (!new URLSearchParams(location.search).has("uplinkShowcase")) {
    throw new Error("Uplink showcase acceleration is not available.");
  }
  const duration = clamp(requestedSeconds, 0, 120);
  const fixedStep = 0.08;
  let advancedSeconds = 0;
  let steps = 0;
  const count = (item: (typeof PROGRESSION_ITEM_IDS)[number]) =>
    progressionInventoryCount(uplinkInventory, item);
  const manifestComplete = () =>
    count("ironPlate") >= 24
    && count("copperPlate") >= 12
    && count("stoneBrick") >= 12
    && count("ironOre") >= 1;
  while (advancedSeconds + 1e-9 < duration) {
    const step = Math.min(fixedStep, duration - advancedSeconds);
    elapsedReal += step;
    elapsedRender += step;
    simulation.tick(step);
    transferDockedUplinkCargo();
    const events = simulation.drainEvents();
    if (events.length > 0) handleSimulationEvents(events);
    syncRenderer();
    renderer.update(step, elapsedRender);
    advancedSeconds += step;
    steps += 1;
    if (
      manifestComplete()
      && uplinkTransferVisualQueue.length === 0
      && activeUplinkTransferVisual === null
    ) break;
  }
  renderer.render(0);
  const source = simulation.getEntity(12);
  const sourceBelts = simulation.getEntities().filter(
    (entity) => entity.id >= 14 && entity.id <= 21 && entity.kind === "belt",
  );
  return {
    advancedSeconds,
    steps,
    sourceInventory: source
      ? Object.values(source.inventory).reduce(
          (total, value) => total + (value ?? 0),
          0,
        )
      : 0,
    sourceBeltItems: sourceBelts.reduce(
      (total, belt) => total + belt.beltItems.length,
      0,
    ),
    custodyCount: PROGRESSION_ITEM_IDS.reduce(
      (total, item) => total + progressionInventoryCount(uplinkInventory, item),
      0,
    ),
    queueDepth: uplinkTransferVisualQueue.length,
    activeTransfer: activeUplinkTransferVisual !== null,
    manifestComplete: manifestComplete(),
  };
}

function freshSession(): LoadedSession {
  const parameters = new URLSearchParams(location.search);
  if (parameters.has("showcase")) return showcaseSession();

  const freshSimulation = new FactorySimulation({
    width: 40,
    height: 27,
    seed: 0xc1de5,
    generateTerrain: false,
    generateResources: false,
    powerMode: "local",
  });
  paintStarterPatch(freshSimulation, "iron", 4, 4);
  paintStarterPatch(freshSimulation, "copper", 4, 11);
  paintStarterPatch(freshSimulation, "stone", 4, 18);
  paintStarterPatch(freshSimulation, "coal", 26, 4);

  const grantedIds: number[] = [];
  const placeGranted = (
    kind: BuildKind,
    x: number,
    y: number,
    direction = Direction.East,
    recipeId?: RecipeId,
  ) => {
    const result = freshSimulation.place(
      kind,
      x,
      y,
      direction,
      recipeId === undefined ? {} : { recipeId },
    );
    if (!result.ok) {
      throw new Error(`Starter ${kind} could not be placed: ${result.reason}.`);
    }
    grantedIds.push(result.entity.id);
    return result.entity;
  };

  const generator = placeGranted("generator", 18, 3);
  placeGranted("gridRelay", 16, 6);
  placeGranted("gridRelay", 9, 8);
  placeGranted("extractor", 5, 5);
  for (let x = 7; x <= 10; x += 1) {
    placeGranted("belt", x, 5);
  }
  placeGranted("inserter", 11, 5);
  placeGranted("smelter", 12, 4, Direction.East, "smeltIron");
  const uplink = placeGranted("storage", 22, 11);
  freshSimulation.receive(
    generator.id,
    "coal",
    CAMPAIGN_STARTER_COAL,
    "fuel",
  );

  const provenance = new Map<number, ConstructionProvenance>();
  for (const id of grantedIds) {
    const entity = freshSimulation.getEntity(id);
    if (!entity) throw new Error("Starter construction ledger lost an entity.");
    provenance.set(
      id,
      grantedConstructionProvenance(requireBuildKind(entity.kind)),
    );
  }
  let campaignProgression = createCampaignProgression();
  if (parameters.has("uplinkShowcase")) {
    const placePaidShowcase = (
      kind: BuildKind,
      x: number,
      y: number,
      direction = Direction.East,
      recipeId?: RecipeId,
    ) => {
      const purchase = preflightPlacement(campaignProgression, kind);
      if (!purchase.ok) {
        throw new Error(
          `Uplink showcase ${kind} purchase was rejected: ${purchase.reason}.`,
        );
      }
      const siteClearance = checkUplinkSiteClearance(
        freshSimulation,
        uplink.id,
        kind,
        x,
        y,
        direction,
      );
      if (!siteClearance.ok) {
        throw new Error(
          `Uplink showcase ${kind} entered the reserved machinery envelope.`,
        );
      }
      const placed = freshSimulation.place(
        kind,
        x,
        y,
        direction,
        recipeId === undefined ? {} : { recipeId },
      );
      if (!placed.ok) {
        throw new Error(
          `Uplink showcase ${kind} could not be placed: ${placed.reason}.`,
        );
      }
      const committed = commitPlacement(
        campaignProgression,
        purchase.authorization,
      );
      campaignProgression = committed.state;
      provenance.set(placed.entity.id, committed.provenance);
      return placed.entity;
    };

    // PASS 6 keeps the exact audited 49-unit route and replaces the former
    // repeated-storage demonstration yard with one compact, differentiated
    // production/logistics block. Every visible machine, belt, inserter,
    // generator, and relay below is placed by the authoritative simulation,
    // paid by preflightPlacement/commitPlacement, and recorded in the same
    // construction-provenance ledger as live campaign construction.
    //
    // The Uplink itself remains the starter-granted entity 11. Only this
    // staged support district is paid; that qualification is non-optional.
    const sourceStorage = placePaidShowcase("storage", 15, 11);
    placePaidShowcase("inserter", 17, 12, Direction.East);
    const sourceBeltRoute = [
      [18, 12, Direction.North],
      [18, 11, Direction.North],
      [18, 10, Direction.East],
      [19, 10, Direction.East],
      [20, 10, Direction.South],
      [20, 11, Direction.South],
      [20, 12, Direction.East],
      [21, 12, Direction.East],
    ] as const;
    for (const [x, y, direction] of sourceBeltRoute) {
      placePaidShowcase("belt", x, y, direction);
    }
    // Relay 23 is both a real powered network endpoint and the physical
    // transmission destination. The pair is close enough to read as routed
    // utility infrastructure while covering the production block below.
    placePaidShowcase("gridRelay", 17, 14);
    placePaidShowcase("gridRelay", 21, 14);

    // Three actually simulated, recipe-distinct furnaces make the support
    // district production rather than decoration. Their output sides face
    // real paid inserters and belt handoffs; the lower belt returns along the
    // service edge instead of terminating as an isolated prop.
    const ironFurnace = placePaidShowcase(
      "smelter",
      15,
      15,
      Direction.East,
      "smeltIron",
    );
    const brickFurnace = placePaidShowcase(
      "smelter",
      19,
      15,
      Direction.East,
      "fireBrick",
    );
    const copperFurnace = placePaidShowcase(
      "smelter",
      15,
      18,
      Direction.East,
      "smeltCopper",
    );
    placePaidShowcase("inserter", 17, 16, Direction.East);
    placePaidShowcase("inserter", 17, 19, Direction.East);
    placePaidShowcase("belt", 18, 16, Direction.East);
    placePaidShowcase("belt", 18, 19, Direction.East);
    for (let x = 14; x <= 21; x += 1) {
      placePaidShowcase("belt", x, 20, Direction.East);
    }
    for (let y = 18; y <= 20; y += 1) {
      placePaidShowcase("belt", 22, y, Direction.North);
    }
    const districtGenerator = placePaidShowcase("generator", 19, 18);
    freshSimulation.receive(
      districtGenerator.id,
      "coal",
      CAMPAIGN_STARTER_COAL,
      "fuel",
    );
    freshSimulation.receive(ironFurnace.id, "ironOre", 12, "input");
    freshSimulation.receive(brickFurnace.id, "stone", 24, "input");
    freshSimulation.receive(copperFurnace.id, "copperOre", 12, "input");
    freshSimulation.receive(
      sourceStorage.id,
      "ironPlate",
      24,
      "inventory",
    );
    freshSimulation.receive(
      sourceStorage.id,
      "copperPlate",
      12,
      "inventory",
    );
    freshSimulation.receive(
      sourceStorage.id,
      "stoneBrick",
      12,
      "inventory",
    );
    // Prime a visibly occupied source line without allowing any cargo to
    // arrive at the Uplink before the browser can observe its real event.
    freshSimulation.tick(1.6);
    // Add the untargeted ore after priming so the first witnessed custody
    // cycle is the commission's iron-plate payload. The ore still originates
    // in the same paid source storage and must traverse the identical real
    // line during the full-manifest proof.
    freshSimulation.receive(
      sourceStorage.id,
      "ironOre",
      1,
      "inventory",
    );
  }
  // The paid Uplink showcase is a narrowly scoped custody/ledger fixture.
  // Keep it isolated so its dense y=14–20 support block cannot displace the
  // normal campaign railway or alter the previously sealed showcase frame.
  if (
    !parameters.has("railFixture") &&
    !parameters.has("uplinkShowcase")
  ) {
    configureStarterRail(freshSimulation);
  }
  freshSimulation.drainEvents();
  return {
    origin: "campaign",
    coreGeneratorEntityId: generator.id,
    simulation: freshSimulation,
    progression: campaignProgression,
    uplinkInventory: createProgressionInventory(),
    constructionProvenance: provenance,
    railConstruction: createGrantedRailAuthoringState(
      freshSimulation.railSnapshot(),
    ),
    uplinkEntityId: uplink.id,
  };
}

/**
 * The campaign rail district is simulation-authored infrastructure, not a
 * construction entity. It therefore participates in ticks, save/restore,
 * signals, schedules, picking, and rendering without minting an entity ID or
 * changing the audited construction/alloy ledger.
 */
function configureStarterRail(target: FactorySimulation): void {
  const mainId = (x: number) =>
    `campaign-main-${String(x).padStart(2, "0")}`;
  const westJunctionX = 13;
  const eastJunctionX = 24;
  const mainSegments: RailNetworkInput["segments"] = Array.from(
    { length: 25 },
    (_, offset) => {
      const x = offset + 8;
      return {
        id: mainId(x),
        x,
        y: 16,
        kind:
          x === westJunctionX || x === eastJunctionX
            ? ("junction" as const)
            : ("straight" as const),
        rotation:
          x === westJunctionX || x === eastJunctionX
            ? (2 as const)
            : (1 as const),
      };
    },
  );
  const sidingSegments: RailNetworkInput["segments"] = [
    {
      id: "campaign-siding-west-curve",
      x: westJunctionX,
      y: 17,
      kind: "curve",
      rotation: 0,
    },
    ...Array.from(
      { length: eastJunctionX - westJunctionX - 1 },
      (_, offset) => ({
        id: `campaign-siding-${String(
          westJunctionX + 1 + offset,
        ).padStart(2, "0")}`,
        x: westJunctionX + 1 + offset,
        y: 17,
        kind: "straight" as const,
        rotation: 1 as const,
      }),
    ),
    {
      id: "campaign-siding-east-curve",
      x: eastJunctionX,
      y: 17,
      kind: "curve",
      rotation: 3,
    },
  ];
  const network: RailNetworkInput = {
    segments: [...mainSegments, ...sidingSegments],
    signals: [
      {
        id: "campaign-west-home",
        fromSegmentId: mainId(9),
        toSegmentId: mainId(10),
        type: "regular",
      },
      {
        id: "campaign-west-chain",
        fromSegmentId: mainId(12),
        toSegmentId: mainId(13),
        type: "chain",
      },
      {
        id: "campaign-yard-entry",
        fromSegmentId: mainId(13),
        toSegmentId: mainId(14),
        type: "regular",
      },
      {
        id: "campaign-east-chain",
        fromSegmentId: mainId(23),
        toSegmentId: mainId(24),
        type: "chain",
      },
      {
        id: "campaign-yard-exit",
        fromSegmentId: mainId(24),
        toSegmentId: mainId(25),
        type: "regular",
      },
      {
        id: "campaign-east-home",
        fromSegmentId: mainId(28),
        toSegmentId: mainId(29),
        type: "regular",
      },
    ],
    stations: [
      {
        id: "campaign-central-service",
        segmentId: mainId(20),
        capacity: 0,
      },
      {
        id: "campaign-east-service",
        segmentId: mainId(29),
        capacity: 0,
      },
    ],
    trains: [
      {
        id: "campaign-ore-runner",
        currentSegmentId: mainId(20),
        cars: [
          {
            id: "campaign-locomotive",
            kind: "locomotive",
            fuelCapacityMilli: 240_000,
            fuelMilli: 180_000,
          },
          {
            id: "campaign-wagon-a",
            kind: "cargo-wagon",
            capacity: 6,
          },
          {
            id: "campaign-wagon-b",
            kind: "cargo-wagon",
            capacity: 6,
          },
        ],
        schedule: [
          {
            stationId: "campaign-central-service",
            wait: { type: "time", ticks: 180 },
          },
          {
            stationId: "campaign-east-service",
            wait: { type: "time", ticks: 180 },
          },
        ],
      },
    ],
  };
  const configured = target.configureRailNetwork({ network });
  if (!configured.ok) {
    throw new Error(
      `Campaign rail district could not be configured: ${configured.reason}.`,
    );
  }
}

function showcaseSession(): LoadedSession {
  if (
    new URLSearchParams(location.search).has(
      "railAuthoringDense",
    )
  ) {
    return denseRailAuthoringSession();
  }
  const showcase = createDemoSimulation(0xc1de2);
  const provenance = new Map<number, ConstructionProvenance>();
  for (const entity of showcase.getEntities()) {
    provenance.set(
      entity.id,
      grantedConstructionProvenance(requireBuildKind(entity.kind)),
    );
  }
  return {
    origin: "legacySandbox",
    coreGeneratorEntityId: null,
    simulation: showcase,
    progression: migrateLegacySandboxProgression(LEGACY_DEFAULT_ALLOY),
    uplinkInventory: createProgressionInventory(),
    constructionProvenance: provenance,
    railConstruction: createGrantedRailAuthoringState(
      showcase.railSnapshot(),
    ),
    uplinkEntityId: null,
  };
}

function denseRailAuthoringSession(): LoadedSession {
  const dense = new FactorySimulation({
    width: 72,
    height: 40,
    seed: 0xc1de12,
    generateTerrain: false,
    generateResources: false,
  });
  const segmentId = (row: number, column: number) =>
    `dense-${String(row).padStart(2, "0")}-${String(column).padStart(2, "0")}`;
  const segments: RailSegmentInput[] = [];
  for (let row = 0; row < 32; row += 1) {
    for (let column = 0; column < 64; column += 1) {
      if (
        (
          (row === 16 || row === 17) &&
          (column === 27 || column === 28)
        ) ||
        (row === 18 && column >= 34 && column <= 36)
      ) {
        continue;
      }
      segments.push({
        id: segmentId(row, column),
        x: column + 4,
        y: row + 4,
        kind: "straight",
        rotation: 1,
      });
    }
  }
  for (let column = 0; column < 7; column += 1) {
    segments.push({
      id: segmentId(32, column),
      x: column + 4,
      y: 36,
      kind: "straight",
      rotation: 1,
    });
  }
  const storageResult = dense.place(
    "storage",
    31,
    20,
    Direction.East,
  );
  if (!storageResult.ok) {
    throw new Error(
      `Dense rail fuel storage could not initialize: ${storageResult.reason}.`,
    );
  }
  dense.receive(
    storageResult.entity.id,
    "coal",
    40,
    "inventory",
  );
  const westStationId = "dense-west-service";
  const eastStationId = "dense-east-service";
  const fuelStationId = "dense-fuel-service";
  const routeStationId = "dense-route-service";
  const network: RailNetworkInput = {
    segments,
    signals: [
      {
        id: "dense-regular-east",
        fromSegmentId: segmentId(12, 20),
        toSegmentId: segmentId(12, 21),
        type: "regular",
      },
      {
        id: "dense-chain-west",
        fromSegmentId: segmentId(18, 42),
        toSegmentId: segmentId(18, 41),
        type: "chain",
      },
    ],
    stations: [
      {
        id: westStationId,
        segmentId: segmentId(20, 22),
        capacity: 0,
      },
      {
        id: eastStationId,
        segmentId: segmentId(20, 46),
        capacity: 0,
      },
      {
        id: fuelStationId,
        segmentId: segmentId(15, 28),
        capacity: 0,
      },
      {
        id: routeStationId,
        segmentId: segmentId(15, 46),
        capacity: 0,
      },
    ],
    trains: [{
      id: "dense-service-train",
      currentSegmentId: segmentId(20, 22),
      cars: [
        {
          id: "dense-service-locomotive",
          kind: "locomotive",
          fuelCapacityMilli: 240_000,
          fuelMilli: 0,
        },
        {
          id: "dense-service-wagon",
          kind: "cargo-wagon",
          capacity: 6,
        },
      ],
      schedule: [
        {
          stationId: westStationId,
          wait: { type: "time", ticks: 60 },
        },
        {
          stationId: eastStationId,
          wait: { type: "time", ticks: 60 },
        },
      ],
    }],
  };
  const configured = dense.configureRailNetwork({ network });
  if (!configured.ok) {
    throw new Error(
      `Dense rail authoring fixture could not initialize: ${configured.reason}.`,
    );
  }
  dense.drainEvents();
  return {
    origin: "legacySandbox",
    coreGeneratorEntityId: null,
    simulation: dense,
    progression: migrateLegacySandboxProgression(1_000_000),
    uplinkInventory: createProgressionInventory(),
    constructionProvenance: new Map([
      [
        storageResult.entity.id,
        grantedConstructionProvenance("storage"),
      ],
    ]),
    railConstruction: createGrantedRailAuthoringState(
      dense.railSnapshot(),
    ),
    uplinkEntityId: null,
  };
}

function paintStarterPatch(
  target: FactorySimulation,
  resource: "iron" | "copper" | "coal" | "stone",
  originX: number,
  originY: number,
): void {
  for (let y = originY; y < originY + 4; y += 1) {
    for (let x = originX; x < originX + 4; x += 1) {
      const falloff = Math.abs(x - originX - 1.5) + Math.abs(y - originY - 1.5);
      if (!target.setResource(x, y, resource, Math.round(420 - falloff * 42))) {
        throw new Error(`Starter ${resource} seam could not be surveyed.`);
      }
    }
  }
}

function reportStorageFailure(result: StorageResult<unknown>): void {
  if (result.ok) return;
  persistenceAvailable = false;
  sessionStartupKind = "volatile";
  sessionLoadWarning =
    "Browser storage is unavailable. This run remains playable but cannot persist.";
  console.warn(
    `Local storage ${result.operation} failed for ${result.key}.`,
    result.error,
  );
}

function safeStorageRead(key: string): string | null {
  try {
    const result = readStorage(window.localStorage, key);
    if (!result.ok) {
      reportStorageFailure(result);
      return null;
    }
    return result.value;
  } catch (error) {
    reportStorageFailure({
      ok: false,
      operation: "read",
      key,
      error,
    });
    return null;
  }
}

function safeStorageWrite(key: string, bytes: string): boolean {
  try {
    const result = writeVerifiedStorage(window.localStorage, key, bytes);
    if (!result.ok) {
      reportStorageFailure(result);
      return false;
    }
    return true;
  } catch (error) {
    reportStorageFailure({
      ok: false,
      operation: "write",
      key,
      error,
    });
    return false;
  }
}

function safeStorageRemove(key: string): boolean {
  try {
    const result = removeStorage(window.localStorage, key);
    if (!result.ok) {
      reportStorageFailure(result);
      return false;
    }
    return true;
  } catch (error) {
    reportStorageFailure({
      ok: false,
      operation: "remove",
      key,
      error,
    });
    return false;
  }
}

function loadBlueprintClipboard(): Blueprint | null {
  const candidates = [
    {
      key: BLUEPRINT_CLIPBOARD_KEY,
      value: safeStorageRead(BLUEPRINT_CLIPBOARD_KEY),
    },
    {
      key: LEGACY_BLUEPRINT_CLIPBOARD_KEY,
      value: safeStorageRead(LEGACY_BLUEPRINT_CLIPBOARD_KEY),
    },
  ];
  for (const candidate of candidates) {
    if (!candidate.value) continue;
    try {
      const restored = restoreBlueprint(candidate.value);
      if (candidate.key === LEGACY_BLUEPRINT_CLIPBOARD_KEY) {
        try {
          const migrated = safeStorageWrite(
            BLUEPRINT_CLIPBOARD_KEY,
            serializeBlueprint(restored),
          );
          if (migrated) safeStorageRemove(LEGACY_BLUEPRINT_CLIPBOARD_KEY);
        } catch (error) {
          console.warn("Blueprint clipboard migration could not persist.", error);
        }
      }
      return restored;
    } catch (error) {
      console.warn(
        `Blueprint clipboard ${candidate.key} could not be restored.`,
        error,
      );
    }
  }
  return null;
}

function loadBlueprintLibrary(): BlueprintLibrary {
  const candidates = [
    {
      key: BLUEPRINT_LIBRARY_KEY,
      value: safeStorageRead(BLUEPRINT_LIBRARY_KEY),
    },
    {
      key: LEGACY_BLUEPRINT_LIBRARY_KEY,
      value: safeStorageRead(LEGACY_BLUEPRINT_LIBRARY_KEY),
    },
  ];
  for (const candidate of candidates) {
    if (!candidate.value) continue;
    try {
      const restored = restoreBlueprintLibrary(candidate.value);
      if (candidate.key === LEGACY_BLUEPRINT_LIBRARY_KEY) {
        try {
          const migrated = safeStorageWrite(
            BLUEPRINT_LIBRARY_KEY,
            serializeBlueprintLibrary(restored),
          );
          if (migrated) safeStorageRemove(LEGACY_BLUEPRINT_LIBRARY_KEY);
        } catch (error) {
          console.warn("Blueprint library migration could not persist.", error);
        }
      }
      return restored;
    } catch (error) {
      console.warn(
        `Blueprint library ${candidate.key} could not be restored.`,
        error,
      );
    }
  }
  return createBlueprintLibrary();
}

function loadSession(): LoadedSession {
  const parameters = new URLSearchParams(location.search);
  if (parameters.has("fresh") || parameters.has("showcase")) {
    sessionStartupKind = persistenceAvailable ? "new" : "volatile";
    return freshSession();
  }

  let malformedCurrentSave = false;
  for (const key of [
    SAVE_KEY,
    PREVIOUS_SESSION_KEY,
    PREVIOUS_V4_SESSION_KEY,
    LEGACY_SESSION_KEY,
    LEGACY_SAVE_KEY,
  ]) {
    const saved = safeStorageRead(key);
    if (!persistenceAvailable) break;
    if (!saved) continue;
    try {
      const value: unknown = JSON.parse(saved);
      if (key === SAVE_KEY) {
        const restored = restoreCurrentSession(value);
        sessionStartupKind = "continued";
        return restored;
      }
      if (key === PREVIOUS_SESSION_KEY) {
        const migrated = migrateVersion5Session(value);
        persistMigratedSession(migrated, key, malformedCurrentSave);
        if (persistenceAvailable) {
          sessionStartupKind = malformedCurrentSave
            ? "recovered"
            : "continued";
        }
        return migrated;
      }
      if (key === PREVIOUS_V4_SESSION_KEY) {
        const migrated = migrateVersion4Session(value);
        persistMigratedSession(migrated, key, malformedCurrentSave);
        if (persistenceAvailable) {
          sessionStartupKind = malformedCurrentSave
            ? "recovered"
            : "continued";
        }
        return migrated;
      }
      const migrated = migrateLegacySession(value);
      if (persistenceAvailable) {
        sessionStartupKind = malformedCurrentSave
          ? "recovered"
          : "continued";
      }
      return migrated;
    } catch (error) {
      console.warn(`Autosave ${key} could not be restored.`, error);
      if (key === SAVE_KEY) {
        malformedCurrentSave = true;
        sessionLoadWarning =
          "The newest save was unreadable and has been preserved. A safe fallback was used when available.";
      }
    }
  }
  if (persistenceAvailable) sessionStartupKind = "new";
  return freshSession();
}

function restoreCurrentSession(value: unknown): LoadedSession {
  const restored = restoreAtomicSession(value, true, true);
  if (restored.progression.mode === "campaign") {
    const expected = expectedCampaignAlloy(
      restored.progression,
      restored.constructionProvenance,
      restored.railConstruction,
    );
    if (restored.progression.alloy !== expected) {
      const preRebalanceExpected = expectedCampaignAlloy(
        restored.progression,
        restored.constructionProvenance,
        restored.railConstruction,
        PRE_REBALANCE_COMMISSION_ALLOY,
      );
      if (restored.progression.alloy !== preRebalanceExpected) {
        throw new TypeError(
          "Campaign alloy does not match the current or pre-rebalance economy.",
        );
      }
      const progressionRecord = JSON.parse(
        serializeProgression(restored.progression),
      ) as ProgressionState;
      Object.assign(progressionRecord, { alloy: expected });
      restored.progression = restoreProgression(progressionRecord);
    }
  }
  validateLoadedSession(restored);
  return restored;
}

function restoreAtomicSession(
  value: unknown,
  requirePersistedWrapper = false,
  skipSemanticValidation = false,
): LoadedSession {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Session payload must be an object.");
  }
  const session = value as Partial<PersistedSession>;
  if (
    requirePersistedWrapper &&
    (session.format !== "cinderline-session" ||
      session.version !== SESSION_VERSION)
  ) {
    throw new Error("Autosave is not a supported Cinderline v6 session.");
  }
  if (
    "format" in session &&
    (session.format !== "cinderline-session" ||
      session.version !== SESSION_VERSION)
  ) {
    throw new Error(`Unsupported session version: ${String(session.version)}.`);
  }
  if (
    !session.simulation ||
    !session.progression ||
    !session.uplinkInventory ||
    !Array.isArray(session.construction) ||
    !session.railConstruction ||
    (session.origin !== "campaign" &&
      session.origin !== "legacySandbox") ||
    !(
      session.coreGeneratorEntityId === null ||
      Number.isSafeInteger(session.coreGeneratorEntityId)
    ) ||
    !(
      session.uplinkEntityId === null ||
      Number.isSafeInteger(session.uplinkEntityId)
    )
  ) {
    throw new TypeError("Session campaign data is incomplete.");
  }

  const restoredSimulation = FactorySimulation.restore(session.simulation);
  const restoredProgression =
    restoreProgressionWithBuildCatalogReconciliation(
      session.progression,
    );
  const restoredInventory = restoreProgressionInventory(
    session.uplinkInventory,
  );
  const restoredRailConstruction = restoreRailAuthoringState(
    session.railConstruction,
    restoredSimulation.railSnapshot(),
  );
  const entities = new Map(
    restoredSimulation.getEntities().map((entity) => [entity.id, entity]),
  );
  const restoredProvenance = new Map<number, ConstructionProvenance>();
  for (const raw of session.construction) {
    if (
      typeof raw !== "object" ||
      raw === null ||
      !Number.isSafeInteger(raw.entityId) ||
      restoredProvenance.has(raw.entityId)
    ) {
      throw new TypeError("Construction ledger contains an invalid entity ID.");
    }
    const entity = entities.get(raw.entityId);
    if (!entity) {
      throw new TypeError("Construction ledger references a missing entity.");
    }
    const provenance = restoreConstructionProvenance(raw.provenance);
    if (provenance.buildKind !== entity.kind) {
      throw new TypeError("Construction provenance does not match its entity.");
    }
    restoredProvenance.set(raw.entityId, provenance);
  }
  if (restoredProvenance.size !== entities.size) {
    throw new TypeError("Construction ledger does not cover every entity.");
  }

  const restoredUplinkId = session.uplinkEntityId ?? null;
  if (restoredUplinkId !== null) {
    const uplink = entities.get(restoredUplinkId);
    if (!uplink || uplink.kind !== "storage") {
      throw new TypeError("Commission Uplink must reference a steel depot.");
    }
  } else if (restoredProgression.mode === "campaign") {
    throw new TypeError("Campaign session is missing its Commission Uplink.");
  }
  if (!skipSemanticValidation) {
    validateSessionSemantics(
      session.origin,
      session.coreGeneratorEntityId ?? null,
      restoredSimulation,
      restoredProgression,
      restoredInventory,
      restoredProvenance,
      restoredRailConstruction,
      restoredUplinkId,
    );
  }
  return {
    origin: session.origin,
    coreGeneratorEntityId: session.coreGeneratorEntityId ?? null,
    simulation: restoredSimulation,
    progression: restoredProgression,
    uplinkInventory: restoredInventory,
    constructionProvenance: restoredProvenance,
    railConstruction: restoredRailConstruction,
    uplinkEntityId: restoredUplinkId,
  };
}

function validateSessionSemantics(
  origin: AtomicSession["origin"],
  restoredCoreGeneratorId: number | null,
  restoredSimulation: FactorySimulation,
  restoredProgression: ProgressionState,
  restoredInventory: ProgressionInventory,
  restoredProvenance: ReadonlyMap<number, ConstructionProvenance>,
  restoredRailConstruction: RailAuthoringState,
  restoredUplinkId: number | null,
): void {
  if (origin !== restoredProgression.mode) {
    throw new TypeError(
      "Session origin cannot change between campaign and legacy sandbox.",
    );
  }
  if (restoredProgression.mode === "legacySandbox") {
    if (
      restoredCoreGeneratorId !== null ||
      restoredUplinkId !== null ||
      restoredInventory.entries.length !== 0
    ) {
      throw new TypeError(
        "Legacy sandbox sessions cannot contain campaign Uplink state.",
      );
    }
    return;
  }

  const stats = restoredSimulation.stats();
  if (stats.power.mode !== "local") {
    throw new TypeError("Campaign power dispatch must use local relay grids.");
  }
  if (
    restoredProgression.lastCompletionTick !== null &&
    restoredProgression.lastCompletionTick > restoredSimulation.tickCount
  ) {
    throw new TypeError("Campaign completion tick is ahead of the simulation.");
  }
  if (restoredUplinkId !== CAMPAIGN_UPLINK_ENTITY_ID) {
    throw new TypeError("Campaign Uplink identity is not canonical.");
  }
  if (!Number.isSafeInteger(restoredCoreGeneratorId)) {
    throw new TypeError("Campaign is missing its bootstrap generator anchor.");
  }

  for (const entity of restoredSimulation.getEntities()) {
    if (entity.id === restoredUplinkId) continue;
    const clearance = checkUplinkSiteClearance(
      restoredSimulation,
      restoredUplinkId,
      entity.kind,
      entity.x,
      entity.y,
      entity.direction,
    );
    if (!clearance.ok) {
      const grandfatheredRearBelt = (
        entity.kind === "belt"
        && clearance.reservation !== null
        && isLegacyUplinkRearBelt(clearance.reservation, {
          x: entity.x,
          z: entity.y,
          direction: entity.direction,
        })
      );
      if (!grandfatheredRearBelt) {
        throw new TypeError(
          "Campaign construction intersects the Commission Uplink machinery envelope.",
        );
      }
    }
  }

  let livePaidCost = 0;
  let livePaidEntityCount = 0;
  for (const entity of restoredSimulation.getEntities()) {
    if (!isBuildKind(entity.kind)) {
      throw new TypeError(
        `Campaign contains unsupported construction kind ${entity.kind}.`,
      );
    }
    const provenance = restoredProvenance.get(entity.id);
    if (!provenance) {
      throw new TypeError("Campaign entity is missing construction provenance.");
    }
    const starter = CAMPAIGN_STARTER_LEDGER.get(entity.id);
    if (provenance.source === "granted") {
      const isRecoveredCoreGenerator =
        entity.id === restoredCoreGeneratorId &&
        entity.kind === "generator" &&
        !starter;
      if (
        !isRecoveredCoreGenerator &&
        (
          !starter ||
          starter.kind !== entity.kind ||
          starter.x !== entity.x ||
          starter.y !== entity.y
        )
      ) {
        throw new TypeError(
          "Granted construction does not match the campaign starter ledger.",
        );
      }
    } else {
      if (starter || entity.id <= CAMPAIGN_UPLINK_ENTITY_ID) {
        throw new TypeError(
          "Paid construction cannot impersonate starter infrastructure.",
        );
      }
      livePaidCost = safeCampaignAdd(
        livePaidCost,
        provenance.paidCost,
        "live construction cost",
      );
      livePaidEntityCount = safeCampaignAdd(
        livePaidEntityCount,
        1,
        "live paid construction count",
      );
    }
    if (!restoredProgression.unlockedBuildKinds.includes(entity.kind)) {
      throw new TypeError(
        `Campaign contains locked construction kind ${entity.kind}.`,
      );
    }
    for (const recipeId of [
      entity.recipeId,
      entity.activeRecipeId,
      entity.pendingRecipeId,
    ]) {
      if (
        recipeId !== undefined &&
        !restoredProgression.unlockedRecipeIds.includes(recipeId)
      ) {
        throw new TypeError(
          `Campaign machine contains locked recipe ${recipeId}.`,
        );
      }
    }
  }
  const livePaidRailCost = paidRailAlloy(restoredRailConstruction);
  const livePaidRailCount = restoredRailConstruction.entries.filter(
    (entry) => entry.source === "paid",
  ).length;
  if (
    livePaidRailCount > 0 &&
    !isRailAuthoringUnlocked(restoredProgression)
  ) {
    throw new TypeError(
      "Campaign contains paid rail construction before Autonomy.",
    );
  }

  const coreGenerator = restoredSimulation.getEntity(
    restoredCoreGeneratorId as number,
  );
  if (
    !coreGenerator ||
    coreGenerator.kind !== "generator" ||
    restoredProvenance.get(coreGenerator.id)?.source !== "granted"
  ) {
    throw new TypeError(
      "Campaign bootstrap generator is missing or not a granted unit.",
    );
  }

  const missingStarterGrantCount = [...CAMPAIGN_STARTER_LEDGER.keys()].filter(
    (entityId) => !restoredSimulation.getEntity(entityId),
  ).length;
  const minimumCampaignRevision = safeCampaignAdd(
    minimumProgressionRevision(restoredProgression),
    safeCampaignAdd(
      livePaidEntityCount,
      safeCampaignAdd(
        missingStarterGrantCount,
        livePaidRailCount,
        "rail construction mutation floor",
      ),
      "construction mutation floor",
    ),
    "campaign mutation floor",
  );
  if (restoredProgression.revision < minimumCampaignRevision) {
    throw new TypeError(
      "Campaign revision is below its construction mutation floor.",
    );
  }

  const uplink = restoredSimulation.getEntity(CAMPAIGN_UPLINK_ENTITY_ID);
  const uplinkProvenance = restoredProvenance.get(
    CAMPAIGN_UPLINK_ENTITY_ID,
  );
  if (
    !uplink ||
    uplink.kind !== "storage" ||
    uplink.x !== 22 ||
    uplink.y !== 11 ||
    uplinkProvenance?.source !== "granted" ||
    Object.values(uplink.inventory).some((amount) => (amount ?? 0) !== 0)
  ) {
    throw new TypeError(
      "Campaign Commission Uplink is missing, moved, paid, or not drained.",
    );
  }

  let earnedAlloy = CAMPAIGN_INITIAL_ALLOY;
  const consumed = Object.fromEntries(
    PROGRESSION_ITEM_IDS.map((item) => [item, 0]),
  ) as Record<(typeof PROGRESSION_ITEM_IDS)[number], number>;
  for (const progress of restoredProgression.commissions) {
    const definition = commissionDefinition(progress.id);
    earnedAlloy = safeCampaignAdd(
      earnedAlloy,
      safeCampaignMultiply(
        progress.completionCount,
        definition.reward.alloy,
        `${definition.id} alloy rewards`,
      ),
      "campaign alloy rewards",
    );
    for (const requirement of definition.requirements) {
      consumed[requirement.item] = safeCampaignAdd(
        consumed[requirement.item],
        safeCampaignMultiply(
          progress.completionCount,
          requirement.amount,
          `${definition.id} consumed cargo`,
        ),
        `${requirement.item} consumed cargo`,
      );
    }
  }
  const expectedAlloy =
    earnedAlloy - livePaidCost - livePaidRailCost;
  if (
    !Number.isSafeInteger(expectedAlloy) ||
    expectedAlloy < 0 ||
    restoredProgression.alloy !== expectedAlloy
  ) {
    throw new TypeError(
      "Campaign alloy does not reconcile with rewards and live construction.",
    );
  }

  for (const item of PROGRESSION_ITEM_IDS) {
    const secured = progressionInventoryCount(restoredInventory, item);
    const accounted = safeCampaignAdd(
      secured,
      consumed[item],
      `${item} Uplink accounting`,
    );
    const totalCustody = safeCampaignAdd(
      stats.stored[item],
      accounted,
      `${item} physical and Uplink custody`,
    );
    const authoritativeProduced =
      item === "coal"
        ? campaignCoalCustodyBound(stats)
        : stats.produced[item];
    if (totalCustody > authoritativeProduced) {
      throw new TypeError(
        `Campaign ${item} custody exceeds authoritative production.`,
      );
    }
  }
}

function safeCampaignAdd(
  left: number,
  right: number,
  label: string,
): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RangeError(`Campaign ${label} exceeds safe integer bounds.`);
  }
  return result;
}

function safeCampaignMultiply(
  left: number,
  right: number,
  label: string,
): number {
  const result = left * right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RangeError(`Campaign ${label} exceeds safe integer bounds.`);
  }
  return result;
}

function minimumProgressionRevision(state: ProgressionState): number {
  let minimum = 0;
  for (const commission of state.commissions) {
    minimum = safeCampaignAdd(
      minimum,
      commission.completionCount,
      "progression mutation floor",
    );
  }
  for (let index = 1; index < state.commissions.length; index += 1) {
    if (state.commissions[index]!.completionCount > 0) {
      minimum = safeCampaignAdd(
        minimum,
        1,
        "progression selection floor",
      );
    }
  }
  if (
    state.selectedCommissionId !== null &&
    state.selectedCommissionId !== "bootstrap" &&
    state.commissions.find(
      (commission) => commission.id === state.selectedCommissionId,
    )?.completionCount === 0
  ) {
    minimum = safeCampaignAdd(
      minimum,
      1,
      "progression selection floor",
    );
  }
  return minimum;
}

function campaignCoalCustodyBound(stats: SimulationStats): number {
  const extractedCoal =
    CAMPAIGN_STARTER_COAL_RESOURCE - stats.resourcesRemaining.coal;
  if (
    !Number.isSafeInteger(extractedCoal) ||
    extractedCoal < 0 ||
    stats.produced.coal > extractedCoal
  ) {
    throw new TypeError(
      "Campaign coal extraction exceeds its surveyed starter seam.",
    );
  }
  return safeCampaignAdd(
    CAMPAIGN_STARTER_COAL,
    extractedCoal,
    "coal custody bound",
  );
}

function migrateVersion5Session(value: unknown): LoadedSession {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Cinderline v5 session payload must be an object.");
  }
  const previous = value as {
    format?: unknown;
    version?: unknown;
    origin?: unknown;
    coreGeneratorEntityId?: unknown;
    simulation?: SerializedSimulation;
    progression?: ProgressionState;
    uplinkInventory?: ProgressionInventory;
    construction?: AtomicSession["construction"];
    uplinkEntityId?: unknown;
  };
  if (
    previous.format !== "cinderline-session" ||
    previous.version !== 5 ||
    !previous.simulation ||
    !previous.progression ||
    !previous.uplinkInventory ||
    !Array.isArray(previous.construction) ||
    (previous.origin !== "campaign" &&
      previous.origin !== "legacySandbox") ||
    !(
      previous.coreGeneratorEntityId === null ||
      Number.isSafeInteger(previous.coreGeneratorEntityId)
    ) ||
    !(
      previous.uplinkEntityId === null ||
      Number.isSafeInteger(previous.uplinkEntityId)
    )
  ) {
    throw new TypeError("Autosave is not a supported Cinderline v5 session.");
  }
  const restoredSimulation = FactorySimulation.restore(
    previous.simulation,
  );
  const migrationBody: AtomicSession = {
    origin: previous.origin,
    coreGeneratorEntityId:
      (previous.coreGeneratorEntityId as number | null) ?? null,
    simulation: previous.simulation,
    progression: previous.progression,
    uplinkInventory: previous.uplinkInventory,
    construction: previous.construction,
    railConstruction: createGrantedRailAuthoringState(
      restoredSimulation.railSnapshot(),
    ),
    uplinkEntityId: (previous.uplinkEntityId as number | null) ?? null,
  };
  return restoreAtomicSession(migrationBody);
}

function atomicSessionFromLoaded(session: LoadedSession): AtomicSession {
  return {
    origin: session.origin,
    coreGeneratorEntityId: session.coreGeneratorEntityId,
    simulation: session.simulation.serialize(),
    progression: JSON.parse(
      serializeProgression(session.progression),
    ) as ProgressionState,
    uplinkInventory: JSON.parse(
      serializeProgressionInventory(session.uplinkInventory),
    ) as ProgressionInventory,
    construction: [...session.constructionProvenance.entries()]
      .sort(([left], [right]) => left - right)
      .map(([entityId, provenance]) => ({
        entityId,
        provenance: JSON.parse(
          JSON.stringify(provenance),
        ) as ConstructionProvenance,
      })),
    railConstruction: session.railConstruction,
    uplinkEntityId: session.uplinkEntityId,
  };
}

/**
 * Migration is storage-atomic: validate canonical v6 bytes, write and reread
 * the new key, then—and only then—remove the previous key. When recovery was
 * triggered by malformed current bytes, the valid fallback is preserved.
 */
function persistMigratedSession(
  migrated: LoadedSession,
  previousKey: string,
  preservePrevious = false,
): boolean {
  const persisted: PersistedSession = {
    format: "cinderline-session",
    version: SESSION_VERSION,
    ...atomicSessionFromLoaded(migrated),
  };
  const bytes = JSON.stringify(persisted);
  restoreAtomicSession(JSON.parse(bytes), true);
  if (!safeStorageWrite(SAVE_KEY, bytes)) return false;
  const reread = safeStorageRead(SAVE_KEY);
  if (reread !== bytes) return false;
  restoreAtomicSession(JSON.parse(reread), true);
  // If the current-format save was malformed, keep the fallback source as a
  // second recovery path instead of destructively consuming it.
  if (!preservePrevious) safeStorageRemove(previousKey);
  return true;
}

function migrateVersion4Session(value: unknown): LoadedSession {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Cinderline v4 session payload must be an object.");
  }
  const previous = value as {
    format?: unknown;
    version?: unknown;
    origin?: unknown;
    simulation?: SerializedSimulation;
    progression?: ProgressionState;
    uplinkInventory?: ProgressionInventory;
    construction?: AtomicSession["construction"];
    uplinkEntityId?: unknown;
  };
  if (
    previous.format !== "cinderline-session" ||
    previous.version !== 4 ||
    !previous.progression ||
    !previous.simulation ||
    !previous.uplinkInventory ||
    !Array.isArray(previous.construction)
  ) {
    throw new TypeError("Autosave is not a supported Cinderline v4 session.");
  }
  if (
    previous.uplinkEntityId !== null &&
    !Number.isSafeInteger(previous.uplinkEntityId)
  ) {
    throw new TypeError("Cinderline v4 Uplink identity is invalid.");
  }

  const restoredProgression =
    restoreProgressionWithBuildCatalogReconciliation(
      previous.progression,
    );
  if (
    previous.origin !== undefined &&
    previous.origin !== restoredProgression.mode
  ) {
    throw new TypeError("Cinderline v4 origin conflicts with progression mode.");
  }
  const hasCanonicalCore = previous.simulation.entities?.some(
    (entity) =>
      entity.id === CAMPAIGN_CORE_GENERATOR_ID &&
      entity.kind === "generator",
  );
  const migrationBody: AtomicSession = {
    origin: restoredProgression.mode,
    coreGeneratorEntityId:
      restoredProgression.mode === "campaign" && hasCanonicalCore
        ? CAMPAIGN_CORE_GENERATOR_ID
        : null,
    simulation: previous.simulation,
    progression: previous.progression,
    uplinkInventory: previous.uplinkInventory,
    construction: previous.construction,
    railConstruction: createGrantedRailAuthoringState(
      FactorySimulation.restore(previous.simulation).railSnapshot(),
    ),
    uplinkEntityId: (previous.uplinkEntityId as number | null) ?? null,
  };
  const migrated = restoreAtomicSession(migrationBody, false, true);
  if (migrated.progression.mode === "legacySandbox") {
    validateLoadedSession(migrated);
    return migrated;
  }

  if (migrated.coreGeneratorEntityId === null) {
    recoverMigratedCoreGenerator(migrated);
  }
  const expectedAlloy = expectedCampaignAlloy(
    migrated.progression,
    migrated.constructionProvenance,
    migrated.railConstruction,
  );
  if (migrated.progression.alloy > expectedAlloy) {
    throw new TypeError(
      "Cinderline v4 campaign alloy exceeds the recoverable economy.",
    );
  }
  if (migrated.progression.alloy !== expectedAlloy) {
    const progressionRecord = JSON.parse(
      serializeProgression(migrated.progression),
    ) as ProgressionState;
    Object.assign(progressionRecord, { alloy: expectedAlloy });
    migrated.progression = restoreProgression(progressionRecord);
  }
  validateLoadedSession(migrated);
  return migrated;
}

function validateLoadedSession(session: LoadedSession): void {
  validateSessionSemantics(
    session.origin,
    session.coreGeneratorEntityId,
    session.simulation,
    session.progression,
    session.uplinkInventory,
    session.constructionProvenance,
    session.railConstruction,
    session.uplinkEntityId,
  );
}

function recoverMigratedCoreGenerator(session: LoadedSession): void {
  const existing = session.simulation
    .getEntities()
    .filter((entity) => entity.kind === "generator")
    .sort((left, right) => left.id - right.id)[0];
  if (existing) {
    session.constructionProvenance.set(
      existing.id,
      grantedConstructionProvenance("generator"),
    );
    session.coreGeneratorEntityId = existing.id;
    return;
  }

  const snapshot = session.simulation.getRenderSnapshot();
  const candidates: Array<{ x: number; y: number; distance: number }> = [];
  for (let y = 0; y < snapshot.height; y += 1) {
    for (let x = 0; x < snapshot.width; x += 1) {
      candidates.push({
        x,
        y,
        distance:
          (x - 18) * (x - 18) +
          (y - 3) * (y - 3),
      });
    }
  }
  candidates.sort(
    (left, right) =>
      left.distance - right.distance ||
      left.y - right.y ||
      left.x - right.x,
  );
  for (const candidate of candidates) {
    const placed = session.simulation.place(
      "generator",
      candidate.x,
      candidate.y,
      Direction.East,
    );
    if (!placed.ok) continue;
    session.simulation.drainEvents();
    session.constructionProvenance.set(
      placed.entity.id,
      grantedConstructionProvenance("generator"),
    );
    session.coreGeneratorEntityId = placed.entity.id;
    return;
  }
  throw new Error(
    "Cinderline v4 campaign has no viable bootstrap generator foundation.",
  );
}

function expectedCampaignAlloy(
  state: ProgressionState,
  provenance: ReadonlyMap<number, ConstructionProvenance>,
  railState: RailAuthoringState,
  rewardAlloy: Readonly<Record<CommissionId, number>> | null = null,
): number {
  let expected = CAMPAIGN_INITIAL_ALLOY;
  for (const commission of state.commissions) {
    const reward = rewardAlloy?.[commission.id]
      ?? commissionDefinition(commission.id).reward.alloy;
    expected = safeCampaignAdd(
      expected,
      safeCampaignMultiply(
        commission.completionCount,
        reward,
        `${commission.id} alloy rewards`,
      ),
      "campaign alloy rewards",
    );
  }
  for (const record of provenance.values()) {
    if (record.source === "paid") {
      expected -= record.paidCost;
      if (!Number.isSafeInteger(expected) || expected < 0) {
        throw new TypeError("Campaign live construction exceeds earned alloy.");
      }
    }
  }
  expected -= paidRailAlloy(railState);
  if (!Number.isSafeInteger(expected) || expected < 0) {
    throw new TypeError("Campaign live rail exceeds earned alloy.");
  }
  return expected;
}

function migrateLegacySession(value: unknown): LoadedSession {
  let serialized = value as SerializedSimulation;
  let legacyAlloy = LEGACY_DEFAULT_ALLOY;
  if (
    typeof value === "object" &&
    value !== null &&
    "format" in value &&
    value.format === "cinderline-session"
  ) {
    const legacy = value as {
      version?: unknown;
      simulation?: SerializedSimulation;
      alloy?: unknown;
    };
    if (
      legacy.version !== 3 ||
      !legacy.simulation ||
      !Number.isSafeInteger(legacy.alloy) ||
      (legacy.alloy as number) < 0
    ) {
      throw new TypeError("Legacy session economy data is invalid.");
    }
    serialized = legacy.simulation;
    legacyAlloy = legacy.alloy as number;
  }
  const restoredSimulation = FactorySimulation.restore(serialized);
  const provenance = new Map<number, ConstructionProvenance>();
  for (const entity of restoredSimulation.getEntities()) {
    provenance.set(
      entity.id,
      grantedConstructionProvenance(requireBuildKind(entity.kind)),
    );
  }
  return {
    origin: "legacySandbox",
    coreGeneratorEntityId: null,
    simulation: restoredSimulation,
    progression: migrateLegacySandboxProgression(legacyAlloy),
    uplinkInventory: createProgressionInventory(),
    constructionProvenance: provenance,
    railConstruction: createGrantedRailAuthoringState(
      restoredSimulation.railSnapshot(),
    ),
    uplinkEntityId: null,
  };
}

function snapshotSession(): AtomicSession {
  return {
    origin: sessionOrigin,
    coreGeneratorEntityId,
    simulation: simulation.serialize(),
    progression: JSON.parse(serializeProgression(progression)) as ProgressionState,
    uplinkInventory: JSON.parse(
      serializeProgressionInventory(uplinkInventory),
    ) as ProgressionInventory,
    construction: [...constructionProvenance.entries()]
      .sort(([left], [right]) => left - right)
      .map(([entityId, provenance]) => ({
        entityId,
        provenance: JSON.parse(
          JSON.stringify(provenance),
        ) as ConstructionProvenance,
      })),
    railConstruction,
    uplinkEntityId,
  };
}

function persistedSessionBytes(body: AtomicSession): string {
  const session: PersistedSession = {
    format: "cinderline-session",
    version: SESSION_VERSION,
    ...body,
  };
  const bytes = JSON.stringify(session);
  // Never advertise or persist bytes that our own restore path rejects.
  restoreAtomicSession(JSON.parse(bytes), true);
  return bytes;
}

function createSessionHUD(): HUDSession {
  const startup = sessionStartupNotice(
    persistenceAvailable ? sessionStartupKind : "volatile",
  );
  if (persistenceAvailable && lastSavedAt !== null) {
    const time = new Date(lastSavedAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return {
      state: "saved",
      label: "SAVED LOCALLY",
      detail: `Verified at ${time}. Autosave remains active every 30 seconds and on exit.`,
      canSave: true,
      canRestoreBackup: preResetBackupAvailable,
    };
  }
  return {
    state: startup.kind,
    label: startup.label,
    detail: sessionLoadWarning ?? startup.detail,
    canSave: persistenceAvailable,
    canRestoreBackup:
      persistenceAvailable && preResetBackupAvailable,
  };
}

function saveSession(showFeedback = false): boolean {
  try {
    const bytes = persistedSessionBytes(snapshotSession());
    if (!safeStorageWrite(SAVE_KEY, bytes)) {
      if (showFeedback) {
        hud.showToast({
          title: "SAVE UNAVAILABLE",
          message:
            "Browser storage rejected the save. This run remains playable but progress is volatile.",
          tone: "error",
          duration: 4200,
        });
      }
      hud.update({ session: createSessionHUD() });
      return false;
    }
    lastSavedAt = Date.now();
    sessionLoadWarning = null;
    hud.update({ session: createSessionHUD() });
    if (showFeedback) {
      hud.showToast({
        title: "SESSION SAVED",
        message: "Verified local save complete.",
        tone: "success",
        duration: 1800,
      });
    }
    return true;
  } catch (error) {
    console.warn("Autosave skipped.", error);
    if (showFeedback) {
      hud.showToast({
        title: "SAVE FAILED",
        message: "The current session did not pass save validation.",
        tone: "error",
        duration: 3600,
      });
    }
    return false;
  }
}

function resetCampaign(): void {
  const storageWasAvailable = persistenceAvailable;
  let backupStored = false;
  if (storageWasAvailable) {
    let currentBytes: string;
    try {
      currentBytes = persistedSessionBytes(snapshotSession());
    } catch (error) {
      console.warn("Campaign reset backup validation failed.", error);
      hud.showToast({
        title: "RESET CANCELED",
        message: "The current run could not be validated for a recovery backup.",
        tone: "error",
        duration: 4200,
      });
      return;
    }
    backupStored = safeStorageWrite(RESET_BACKUP_KEY, currentBytes);
    if (!backupStored) {
      hud.update({ session: createSessionHUD() });
      hud.showToast({
        title: "RESET CANCELED",
        message:
          "A recoverable backup could not be verified, so the current campaign was left untouched.",
        tone: "error",
        duration: 4600,
      });
      return;
    }
  }

  const replacement = freshSession();
  if (storageWasAvailable) {
    const replacementBytes = persistedSessionBytes(
      atomicSessionFromLoaded(replacement),
    );
    if (!safeStorageWrite(SAVE_KEY, replacementBytes)) {
      hud.update({ session: createSessionHUD() });
      hud.showToast({
        title: "RESET CANCELED",
        message:
          "The fresh campaign could not be verified in local storage. Your current run and recovery backup remain intact.",
        tone: "error",
        duration: 4600,
      });
      return;
    }
    lastSavedAt = Date.now();
  } else {
    lastSavedAt = null;
  }

  applyAtomicSession(replacement);
  resetSessionViewState();
  preResetBackupAvailable = backupStored;
  sessionStartupKind = persistenceAvailable ? "new" : "volatile";
  sessionLoadWarning = null;
  syncRenderer();
  refreshHUD(true);
  hud.showToast({
    title: "CAMPAIGN RESET",
    message: backupStored
      ? "Fresh campaign online. The previous session can be restored from the save menu."
      : "Fresh volatile campaign online. Browser storage remains unavailable.",
    tone: "success",
    duration: 4200,
  });
}

function restorePreResetSession(): void {
  const bytes = safeStorageRead(RESET_BACKUP_KEY);
  if (!bytes) {
    preResetBackupAvailable = false;
    hud.update({ session: createSessionHUD() });
    hud.showToast({
      title: "BACKUP UNAVAILABLE",
      message: "No valid pre-reset session is available in local storage.",
      tone: "error",
      duration: 3200,
    });
    return;
  }
  let restored: LoadedSession;
  try {
    restored = restoreAtomicSession(JSON.parse(bytes), true);
  } catch (error) {
    console.warn("Pre-reset session could not be restored.", error);
    hud.showToast({
      title: "RESTORE CANCELED",
      message: "The backup failed integrity validation and was left untouched.",
      tone: "error",
      duration: 4200,
    });
    return;
  }
  if (!safeStorageWrite(SAVE_KEY, bytes)) {
    hud.update({ session: createSessionHUD() });
    hud.showToast({
      title: "RESTORE CANCELED",
      message: "The backup could not be verified as the active save.",
      tone: "error",
      duration: 4200,
    });
    return;
  }
  applyAtomicSession(restored);
  resetSessionViewState();
  lastSavedAt = Date.now();
  sessionStartupKind = "continued";
  sessionLoadWarning = null;
  syncRenderer();
  refreshHUD(true);
  hud.showToast({
    title: "SESSION RESTORED",
    message: "The pre-reset campaign is active and verified as the local save.",
    tone: "success",
    duration: 3800,
  });
}

function resetSessionViewState(): void {
  selectedBuild = null;
  selectedDirection = Direction.East;
  blueprintMode = null;
  blueprintCaptureAnchor = null;
  selectedEntityId = null;
  hoveredCell = null;
  lastBeltCell = null;
  paused = false;
  undoStack.length = 0;
  redoStack.length = 0;
  renderer.setSelected(null);
  renderer.setGhost(null, 0, 0, selectedDirection, true);
  blueprintRenderer.setBlueprintOverlay?.(null);
  blueprintRenderer.setBlueprintCaptureMarquee?.(null);
  cameraFocus = getFactoryCenter();
  renderer.focus(cameraFocus.x, cameraFocus.z);
}

function syncRenderer(): void {
  const snapshot = toRenderSnapshot(simulation.getRenderSnapshot());
  if (uplinkEntityId !== null) {
    const uplink = snapshot.entities.find(
      (entity) => entity.id === uplinkEntityId,
    );
    if (uplink) {
      uplink.uplink = true;
      const selectedCommission =
        progression.selectedCommissionId === null
          ? null
          : commissionDefinition(progression.selectedCommissionId);
      const targetedManifest = selectedCommission?.requirements.map(
        (requirement) => ({
            kind: requirement.item,
            count: progressionInventoryCount(
              uplinkInventory,
              requirement.item,
            ),
            target: requirement.amount,
          }),
      ) ?? [];
      const targetedKinds = new Set(
        targetedManifest.map((entry) => entry.kind),
      );
      const untargetedManifest = PROGRESSION_ITEM_IDS
        .filter(
          (item) =>
            !targetedKinds.has(item) &&
            progressionInventoryCount(uplinkInventory, item) > 0,
        )
        .map((item) => ({
          kind: item,
          count: progressionInventoryCount(uplinkInventory, item),
          target: undefined,
        }));
      const manifest = [...targetedManifest, ...untargetedManifest];
      const targetedEntries = manifest.filter(
        (entry) => entry.target !== undefined,
      );
      const custodyCount = PROGRESSION_ITEM_IDS.reduce(
        (total, item) =>
          total + progressionInventoryCount(uplinkInventory, item),
        0,
      );
      uplink.uplinkCustodyManifest = manifest;
      uplink.uplinkCustodyCount = custodyCount;
      uplink.uplinkTransmissionActive =
        targetedEntries.length > 0 &&
        targetedEntries.every(
          (entry) =>
            entry.target !== undefined &&
            entry.target > 0 &&
            entry.count >= entry.target,
        );
      const transfer = currentUplinkTransferVisual();
      if (transfer) {
        uplink.uplinkTransferProgress = transfer.progress;
        uplink.uplinkTransferReturning = transfer.returning;
        if (transfer.item !== undefined) {
          uplink.uplinkTransferItem = transfer.item;
        }
      }
    }
  }
  renderer.sync(snapshot);
}

function queueUplinkTransferVisual(item: ItemId): void {
  if (uplinkTransferVisualQueue.length >= UPLINK_TRANSFER_VISUAL_QUEUE_LIMIT) {
    uplinkTransferVisualQueue.shift();
  }
  uplinkTransferVisualQueue.push(item);
}

function clearUplinkTransferVisuals(): void {
  uplinkTransferVisualQueue.length = 0;
  activeUplinkTransferVisual = null;
}

function currentUplinkTransferVisual(): {
  readonly item?: ItemId;
  readonly progress: number;
  readonly returning: boolean;
} | null {
  const totalSeconds =
    UPLINK_TRANSFER_INBOUND_SECONDS +
    UPLINK_TRANSFER_SETTLE_SECONDS +
    UPLINK_TRANSFER_RETURN_SECONDS;
  for (;;) {
    if (activeUplinkTransferVisual === null) {
      const item = uplinkTransferVisualQueue.shift();
      if (item === undefined) return null;
      activeUplinkTransferVisual = {
        item,
        startedAt: elapsedReal,
      };
    }
    const elapsed = Math.max(
      0,
      elapsedReal - activeUplinkTransferVisual.startedAt,
    );
    if (elapsed >= totalSeconds) {
      activeUplinkTransferVisual = null;
      continue;
    }
    if (elapsed < UPLINK_TRANSFER_INBOUND_SECONDS) {
      return {
        item: activeUplinkTransferVisual.item,
        progress: elapsed / UPLINK_TRANSFER_INBOUND_SECONDS,
        returning: false,
      };
    }
    if (
      elapsed <
      UPLINK_TRANSFER_INBOUND_SECONDS + UPLINK_TRANSFER_SETTLE_SECONDS
    ) {
      return {
        item: activeUplinkTransferVisual.item,
        progress: 1,
        returning: false,
      };
    }
    return {
      progress:
        (elapsed -
          UPLINK_TRANSFER_INBOUND_SECONDS -
          UPLINK_TRANSFER_SETTLE_SECONDS) /
        UPLINK_TRANSFER_RETURN_SECONDS,
      returning: true,
    };
  }
}

function multiplyBlueprintTransform(
  left: BlueprintTransformMatrix,
  right: BlueprintTransformMatrix,
): BlueprintTransformMatrix {
  return [
    left[0] * right[0] + left[1] * right[2],
    left[0] * right[1] + left[1] * right[3],
    left[2] * right[0] + left[3] * right[2],
    left[2] * right[1] + left[3] * right[3],
  ];
}

function applyBlueprintTransformIndicator(
  action: BlueprintTransformMatrix,
): void {
  blueprintTransformMatrix = multiplyBlueprintTransform(
    action,
    blueprintTransformMatrix,
  );
}

function sameBlueprintTransform(
  left: BlueprintTransformMatrix,
  right: BlueprintTransformMatrix,
): boolean {
  return left.every((value, index) => value === right[index]);
}

function blueprintTransformLabel(): string {
  const rotations: BlueprintTransformMatrix[] = [BLUEPRINT_IDENTITY];
  for (let turn = 1; turn < 4; turn += 1) {
    rotations.push(
      multiplyBlueprintTransform(
        BLUEPRINT_ROTATE_CW,
        rotations[turn - 1]!,
      ),
    );
  }
  const candidates: Array<{
    matrix: BlueprintTransformMatrix;
    label: string;
    priority: number;
  }> = [];
  const turnPriority = [0, 1, 3, 2];
  for (const turn of turnPriority) {
    const degrees = turn * 90;
    const rotation = rotations[turn]!;
    candidates.push({
      matrix: rotation,
      label: `ROT ${degrees}°`,
      priority: candidates.length,
    });
    candidates.push({
      matrix: multiplyBlueprintTransform(rotation, BLUEPRINT_MIRROR_H),
      label: `ROT ${degrees}° · MIRROR H`,
      priority: candidates.length,
    });
    candidates.push({
      matrix: multiplyBlueprintTransform(rotation, BLUEPRINT_MIRROR_V),
      label: `ROT ${degrees}° · MIRROR V`,
      priority: candidates.length,
    });
  }
  candidates.sort((left, right) => left.priority - right.priority);
  return candidates.find((candidate) =>
    sameBlueprintTransform(candidate.matrix, blueprintTransformMatrix)
  )?.label ?? "TRANSFORMED";
}

function blueprintConstructionCost(blueprint: Blueprint): number {
  return blueprint.entities.reduce(
    (total, entity) => total + BUILD_COSTS[entity.kind as BuildKind],
    0,
  );
}

function createBlueprintHUD(
  point: GridPoint | null = hoveredCell,
  previewOverride?: ReturnType<typeof previewBlueprintPlacement>,
): HUDBlueprint | null {
  if (blueprintMode === null) return null;
  if (blueprintMode === "capture") {
    if (!blueprintCaptureAnchor) {
      return {
        mode: "capture",
        units: 0,
        width: 0,
        height: 0,
        cost: 0,
        availableAlloy: progression.alloy,
        transform: "CORNER A",
        valid: true,
        conflictCount: 0,
        status: "Select the first corner of the factory area.",
      };
    }
    if (!point) {
      return {
        mode: "capture",
        units: 0,
        width: 1,
        height: 1,
        cost: 0,
        availableAlloy: progression.alloy,
        transform: "CORNER B",
        valid: true,
        conflictCount: 0,
        status:
          `Corner A locked at ${blueprintCaptureAnchor.x},${blueprintCaptureAnchor.z}.`,
      };
    }
    const x = Math.min(blueprintCaptureAnchor.x, point.x);
    const y = Math.min(blueprintCaptureAnchor.z, point.z);
    const width = Math.abs(point.x - blueprintCaptureAnchor.x) + 1;
    const height = Math.abs(point.z - blueprintCaptureAnchor.z) + 1;
    try {
      const captured = captureBlueprint(simulation.getEntities(), {
        x,
        y,
        width,
        height,
      });
      const units = captured.entities.length;
      return {
        mode: "capture",
        units,
        width,
        height,
        cost: blueprintConstructionCost(captured),
        availableAlloy: progression.alloy,
        transform: "CORNER B",
        valid: units > 0,
        conflictCount: units > 0 ? 0 : 1,
        status:
          units > 0
            ? `${units} units included · choose the opposite corner.`
            : "No construction intersects this area yet.",
      };
    } catch (error) {
      return {
        mode: "capture",
        units: 0,
        width,
        height,
        cost: 0,
        availableAlloy: progression.alloy,
        transform: "CORNER B",
        valid: false,
        conflictCount: 1,
        status:
          error instanceof Error
            ? error.message
            : "This capture area is invalid.",
      };
    }
  }

  const clipboard = blueprintClipboard;
  if (!clipboard || clipboard.entities.length === 0) {
    return {
      mode: "paste",
      units: 0,
      width: 0,
      height: 0,
      cost: 0,
      availableAlloy: progression.alloy,
      transform: blueprintTransformLabel(),
      valid: false,
      conflictCount: 1,
      status: "Blueprint clipboard is empty.",
    };
  }
  const cost = blueprintConstructionCost(clipboard);
  if (!point) {
    return {
      mode: "paste",
      units: clipboard.entities.length,
      width: clipboard.width,
      height: clipboard.height,
      cost,
      availableAlloy: progression.alloy,
      transform: blueprintTransformLabel(),
      valid: true,
      conflictCount: 0,
      constructionCount: clipboard.entities.length,
      status: "Move the plan over surveyed terrain to validate it.",
    };
  }
  const preview = previewOverride ?? previewBlueprintPlacement(point);
  const constructionCount = preview.diagnostics.filter(
    (diagnostic) => diagnostic.action === "construct",
  ).length;
  const configurationCount = preview.diagnostics.filter(
    (diagnostic) => diagnostic.action === "configure",
  ).length;
  const matchCount = preview.diagnostics.filter(
    (diagnostic) => diagnostic.action === "match",
  ).length;
  return {
    mode: "paste",
    units: clipboard.entities.length,
    width: clipboard.width,
    height: clipboard.height,
    cost: preview.cost,
    availableAlloy: progression.alloy,
    transform: blueprintTransformLabel(),
    valid: preview.ok,
    conflictCount: preview.conflictCount,
    constructionCount,
    configurationCount,
    matchCount,
    status: preview.ok
      ? constructionCount === 0 && configurationCount === 0
        ? `EXACT MATCH · ${matchCount} existing units already satisfy this plan.`
        : `READY · ${constructionCount} new · ${configurationCount} configure · ${matchCount} matched.`
      : `${preview.conflictCount} blocked · ${
          preview.reason ?? "placement is invalid"
        }`,
  };
}

function createBlueprintWorldOverlay(
  point: GridPoint,
  preview: ReturnType<typeof previewBlueprintPlacement>,
): BlueprintOverlayLayout {
  return createBlueprintOverlayLayout({
    anchorX: point.x,
    anchorZ: point.z,
    width: preview.plan.width,
    height: preview.plan.height,
    focus: { x: point.x + 0.5, z: point.z + 0.5 },
    placements: preview.diagnostics.map((diagnostic) => ({
      kind: diagnostic.placement.kind,
      x: diagnostic.placement.x,
      z: diagnostic.placement.y,
      direction: diagnostic.placement.direction,
      state: diagnostic.ok ? diagnostic.action : "blocked",
      ...(diagnostic.reason === undefined
        ? {}
        : { reason: diagnostic.reason }),
    })),
  });
}

function createBlueprintWorldCapture(
  point: GridPoint,
): BlueprintCaptureMarquee {
  const anchor = blueprintCaptureAnchor ?? point;
  return createBlueprintCaptureMarquee(
    { x: anchor.x, z: anchor.z },
    point,
    simulation.getEntities().map((entity) => ({
      id: entity.id,
      x: entity.x,
      z: entity.y,
      width: entity.width,
      height: entity.height,
    })),
  );
}

interface PreparedRailEconomy {
  readonly authorization: RailAlloyAuthorization | null;
  readonly progression: ProgressionState;
  readonly ledger: RailAuthoringState;
}

function rejectRailCommand(message: string): void {
  railAuthoringStatus = message;
  audio.error(worldPan(hoveredCell?.x ?? cameraFocus.x));
  hud.showToast({
    title: "RAIL COMMAND REJECTED",
    message,
    tone: "error",
    duration: 2600,
  });
  syncRailAuthoringOverlay();
  refreshHUD(true);
}

function prepareRailPurchase(
  buildKinds: readonly RailBuildKind[],
  drafts: readonly RailConstructionDraft[],
): PreparedRailEconomy | null {
  const preflight = preflightRailPurchase(progression, buildKinds);
  if (!preflight.ok) {
    const messages = {
      locked: "Complete Autonomy before authoring paid rail.",
      insufficientAlloy: `Requires ${preflight.amount} alloy; ${progression.alloy} available.`,
      revisionOverflow: "The progression revision limit is reached.",
      alloyOverflow: "The rail alloy transaction exceeds safe bounds.",
      sourceConsumed: "The economy changed; retry this rail command.",
    } as const;
    rejectRailCommand(messages[preflight.reason]);
    return null;
  }
  try {
    return {
      authorization: preflight.authorization,
      progression: preflight.authorization.stagedState,
      ledger: recordRailConstructions(railConstruction, drafts),
    };
  } catch (error) {
    console.error("Rail purchase staging failed.", error);
    rejectRailCommand("Rail provenance could not be staged canonically.");
    return null;
  }
}

function prepareRailRemoval(
  keys: readonly string[],
): (PreparedRailEconomy & { readonly refund: number }) | null {
  try {
    const removed = removeRailConstructions(railConstruction, keys);
    const paidKinds = removed.removed
      .filter(
        (entry) =>
          entry.source === "paid" &&
          entry.buildKind !== "trainShell",
      )
      .map((entry) => entry.buildKind as RailBuildKind);
    if (paidKinds.length === 0) {
      return {
        authorization: null,
        progression,
        ledger: removed.state,
        refund: 0,
      };
    }
    const preflight = preflightRailRefund(progression, paidKinds);
    if (!preflight.ok) {
      const messages = {
        locked: "Complete Autonomy before dismantling paid rail.",
        insufficientAlloy: "Rail refund preflight was rejected.",
        revisionOverflow: "The progression revision limit is reached.",
        alloyOverflow: "The refund would exceed safe alloy bounds.",
        sourceConsumed: "The economy changed; retry this rail command.",
      } as const;
      rejectRailCommand(messages[preflight.reason]);
      return null;
    }
    if (preflight.authorization.amount !== removed.refund) {
      throw new Error("Rail refund does not match paid provenance.");
    }
    return {
      authorization: preflight.authorization,
      progression: preflight.authorization.stagedState,
      ledger: removed.state,
      refund: removed.refund,
    };
  } catch (error) {
    console.error("Rail removal staging failed.", error);
    rejectRailCommand("Rail refund provenance could not be staged.");
    return null;
  }
}

function executeRailMutation(
  economy: PreparedRailEconomy,
  mutate: () => RailMutationResult,
  successMessage: string,
): boolean {
  const before = snapshotSession();
  let rollback: LoadedSession;
  try {
    // Canonical rollback and every post-success economy/ledger value exist
    // before the authoritative simulation is allowed to mutate.
    rollback = restoreAtomicSession(before);
    canonicalRailAuthoringState(economy.ledger);
    restoreProgression(economy.progression);
  } catch (error) {
    console.error("Rail command staging validation failed.", error);
    rejectRailCommand("The staged rail session is not canonical.");
    return false;
  }
  const beforeSessionBytes = JSON.stringify(before);
  let result: RailMutationResult;
  try {
    result = mutate();
  } catch (error) {
    applyAtomicSession(rollback);
    syncRenderer();
    console.error("Rail simulation command threw.", error);
    rejectRailCommand("The simulation rejected the rail transaction.");
    return false;
  }
  if (!result.ok) {
    if (JSON.stringify(snapshotSession()) !== beforeSessionBytes) {
      applyAtomicSession(rollback);
      syncRenderer();
    }
    rejectRailCommand(explainRailMutationFailure(result.reason));
    return false;
  }
  try {
    const reconciledLedger = restoreRailAuthoringState(
      economy.ledger,
      simulation.railSnapshot(),
    );
    const validatedPost = restoreAtomicSession({
      ...before,
      simulation: simulation.serialize(),
      progression: economy.progression,
      railConstruction: reconciledLedger,
    });
    if (economy.authorization) {
      const committed = commitRailAlloy(
        progression,
        economy.authorization,
      );
      if (
        serializeProgression(committed.state) !==
        serializeProgression(validatedPost.progression)
      ) {
        throw new Error("Rail alloy staged state changed during commit.");
      }
    }
    progression = validatedPost.progression;
    railConstruction = validatedPost.railConstruction;
  } catch (error) {
    applyAtomicSession(rollback);
    syncRenderer();
    console.error("Rail economy commit failed after simulation success.", error);
    rejectRailCommand(
      "The rail economy commit failed; the world was rolled back exactly.",
    );
    return false;
  }
  redoStack.length = 0;
  undoStack.push(before);
  if (undoStack.length > 20) undoStack.shift();
  railAuthoringStatus = successMessage;
  audio.placed(worldPan(hoveredCell?.x ?? cameraFocus.x), 0.82);
  syncRenderer();
  syncRailAuthoringOverlay();
  refreshHUD(true);
  saveSession();
  return true;
}

function executeFreeRailMutation(
  mutate: () => RailMutationResult,
  successMessage: string,
): boolean {
  return executeRailMutation(
    {
      authorization: null,
      progression,
      ledger: railConstruction,
    },
    mutate,
    successMessage,
  );
}

function railTargetSegmentId(
  target: RailPickTarget | null,
): string | null {
  return target?.kind === "segment" ? target.segmentId : null;
}

function railPreviewAt(
  point: GridPoint,
  target: RailPickTarget | null,
): RailAuthoringPreview | null {
  const buildKind = selectedRailTool;
  if (!railConsoleOpen || !buildKind) return null;
  const snapshot = simulation.railSnapshot();
  const affordable = progression.alloy >= RAIL_BUILD_COSTS[buildKind];
  const unlocked = isRailAuthoringUnlocked(progression);
  let x = point.x;
  let z = point.z;
  let check:
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: string };

  if (
    buildKind === "straight" ||
    buildKind === "curve" ||
    buildKind === "junction"
  ) {
    const terrain = simulation.getTerrainAt(point.x, point.z);
    if (terrain === undefined) {
      check = { ok: false, reason: "Outside the world boundary." };
    } else if (terrain === TerrainType.Water) {
      check = { ok: false, reason: "Track cannot be placed on water." };
    } else if (simulation.getEntityAt(point.x, point.z)) {
      check = {
        ok: false,
        reason: "A factory entity occupies this track tile.",
      };
    } else {
      try {
        const candidate = authoredSegment(
          nextRailId(railConstruction, "segment"),
          buildKind,
          point.x,
          point.z,
          railAuthoringRotation,
        );
        check = preflightTrackPlacement(snapshot, candidate);
      } catch {
        check = {
          ok: false,
          reason: "The proposed rail tile is outside canonical bounds.",
        };
      }
    }
  } else {
    const segmentId = railTargetSegmentId(target);
    const node = segmentId
      ? snapshot?.graph.nodes.find(
          (candidate) => candidate.segmentId === segmentId,
        )
      : undefined;
    if (node) {
      x = node.x;
      z = node.y;
    }
    if (buildKind === "regularSignal" || buildKind === "chainSignal") {
      check =
        pendingRailSignalSourceId && segmentId
          ? preflightDirectedSignal(
              snapshot,
              pendingRailSignalSourceId,
              segmentId,
              buildKind === "regularSignal" ? "regular" : "chain",
            )
          : {
              ok: false,
              reason: pendingRailSignalSourceId
                ? "Choose the adjacent destination segment."
                : "Choose the directed source segment.",
            };
    } else if (buildKind === "station") {
      check = segmentId
        ? preflightStationPlacement(snapshot, segmentId)
        : { ok: false, reason: "Choose a live rail segment." };
    } else if (buildKind === "locomotive") {
      if (target?.kind === "train") {
        const train = snapshot?.trains.find(
          (candidate) => candidate.id === target.trainId,
        );
        const trainNode = train
          ? snapshot?.graph.nodes.find(
              (node) => node.segmentId === train.currentSegmentId,
            )
          : undefined;
        if (trainNode) {
          x = trainNode.x;
          z = trainNode.y;
        }
        check =
          train?.status === "dwelling" &&
          train.cargoUnits === 0 &&
          (train.cars.length ?? 0) < 64
            ? { ok: true }
            : {
                ok: false,
                reason: "Consist edits require a dwelling, empty train.",
              };
      } else {
        const station = segmentId
          ? snapshot?.stations.find(
              (candidate) => candidate.segmentId === segmentId,
            )
          : undefined;
        check = !segmentId
          ? { ok: false, reason: "Choose an unoccupied station segment." }
          : !station
            ? {
                ok: false,
                reason:
                  "New locomotives must spawn at a station for physical fueling.",
              }
            : preflightTrainPlacement(snapshot, segmentId);
      }
    } else {
      const trainId =
        target?.kind === "train" ? target.trainId : null;
      const train = snapshot?.trains.find(
        (candidate) => candidate.id === trainId,
      );
      const trainNode = train
        ? snapshot?.graph.nodes.find(
            (node) => node.segmentId === train.currentSegmentId,
          )
        : undefined;
      if (trainNode) {
        x = trainNode.x;
        z = trainNode.y;
      }
      check =
        train?.status === "dwelling" &&
        train.cargoUnits === 0 &&
        train.cars.length < 64
          ? { ok: true }
          : {
              ok: false,
              reason: "Choose a dwelling, empty train.",
            };
    }
  }
  const valid = check.ok && unlocked && affordable;
  return {
    buildKind,
    x,
    z,
    rotation: railAuthoringRotation,
    validity: valid ? "valid" : "blocked",
    ...(
      valid
        ? {}
        : {
            reason: !unlocked
              ? "Rail authoring unlocks after Autonomy."
              : !affordable
                ? `Requires ${RAIL_BUILD_COSTS[buildKind]} alloy.`
                : check.ok
                  ? "Blocked."
                  : check.reason,
          }
    ),
  };
}

function syncRailAuthoringOverlay(
  preview: RailAuthoringPreview | null = null,
): void {
  const adapter = renderer.getRailRendererIntegration();
  if (!railConsoleOpen) {
    adapter.setAuthoringOverlay(null);
    return;
  }
  adapter.setAuthoringOverlay({
    selected: selectedRailTarget,
    sourceSegmentId: pendingRailSignalSourceId,
    preview,
  });
}

function currentRailSave(): SerializedSimulation["railNetwork"] {
  return simulation.serialize().railNetwork;
}

function liveRailInterfaces(): readonly RailStationStorageInterface[] {
  return simulation.railStationInterfacesSnapshot();
}

function rejectRailPreflight(
  result: { readonly ok: true } | { readonly ok: false; readonly reason: string },
): result is { readonly ok: false; readonly reason: string } {
  if (result.ok) return false;
  rejectRailCommand(result.reason);
  return true;
}

function railTargetIdentity(
  target: RailPickTarget,
): { kind: RailLedgerTargetKind; id: string; trainId: string | null } {
  if (target.kind === "segment") {
    return { kind: "segment", id: target.segmentId, trainId: null };
  }
  if (target.kind === "signal") {
    return { kind: "signal", id: target.signalId, trainId: null };
  }
  if (target.kind === "station") {
    return { kind: "station", id: target.stationId, trainId: null };
  }
  if (target.carId) {
    return {
      kind: "car",
      id: target.carId,
      trainId: target.trainId,
    };
  }
  return { kind: "train", id: target.trainId, trainId: null };
}

function selectRailTarget(target: RailPickTarget | null): void {
  selectedRailTarget = target;
  selectedEntityId = null;
  renderer.setSelected(null);
  railAuthoringStatus = target
    ? "Rail target selected. Inspect, edit, or dismantle from the console."
    : "No rail target selected.";
  syncRailAuthoringOverlay(
    hoveredCell ? railPreviewAt(hoveredCell, hoveredRailTarget) : null,
  );
  refreshHUD(true);
}

function closeRailAuthoringForModeSwitch(
  suppressReturnFocus = true,
): void {
  const changed =
    railConsoleOpen ||
    selectedRailTool !== null ||
    selectedRailTarget !== null ||
    pendingRailSignalSourceId !== null ||
    hoveredRailTarget !== null;
  railConsoleOpen = false;
  selectedRailTool = null;
  selectedRailTarget = null;
  pendingRailSignalSourceId = null;
  hoveredRailTarget = null;
  railAuthoringStatus =
    "Open the console, choose a tool, then author directly in the world.";
  renderer.getRailRendererIntegration().setAuthoringOverlay(null);
  if (changed) {
    hud.update({
      railAuthoring: createRailAuthoringHUD(
        null,
        suppressReturnFocus,
      ),
    });
  }
}

function toggleRailConsole(): void {
  const opening = !railConsoleOpen;
  if (opening && blueprintLibraryOpen) {
    blueprintLibraryOpen = false;
    updateBlueprintLibraryHUD();
  }
  railConsoleOpen = opening;
  pendingCircuitWire = null;
  blueprintMode = null;
  blueprintCaptureAnchor = null;
  blueprintRenderer.setBlueprintOverlay?.(null);
  blueprintRenderer.setBlueprintCaptureMarquee?.(null);
  selectedBuild = null;
  lastBeltCell = null;
  selectedEntityId = null;
  renderer.setSelected(null);
  if (!railConsoleOpen) {
    closeRailAuthoringForModeSwitch(false);
    renderer.setGhost(null, 0, 0, selectedDirection, true);
  } else {
    railAuthoringStatus = simulation.railSnapshot()
      ? isRailAuthoringUnlocked(progression)
        ? "Choose one of eight construction tools, or select live rail hardware."
        : "Complete Autonomy to unlock paid rail authoring."
      : "This world has no configured rail network.";
    syncRailAuthoringOverlay(
      hoveredCell ? railPreviewAt(hoveredCell, hoveredRailTarget) : null,
    );
  }
  hud.update({
    selectedBuild: null,
    inspector: null,
    blueprint: null,
    railAuthoring: createRailAuthoringHUD(),
  });
}

function selectRailTool(kind: RailBuildKind): void {
  if (!railConsoleOpen) {
    toggleRailConsole();
  }
  if (!simulation.railSnapshot()) {
    rejectRailCommand("This world has no configured rail network.");
    return;
  }
  if (!isRailAuthoringUnlocked(progression)) {
    rejectRailCommand("Complete Autonomy before authoring paid rail.");
    return;
  }
  if (progression.alloy < RAIL_BUILD_COSTS[kind]) {
    rejectRailCommand(
      `Requires ${RAIL_BUILD_COSTS[kind]} alloy; ${progression.alloy} available.`,
    );
    return;
  }
  if (selectedRailTool === kind) {
    cancelRailAuthoring();
    return;
  }
  selectedRailTool = kind;
  pendingRailSignalSourceId = null;
  railAuthoringStatus =
    kind === "regularSignal" || kind === "chainSignal"
      ? "Choose the directed source segment, then its adjacent destination."
      : `${RAIL_BUILD_LABELS[kind]} armed. Choose a valid world target.`;
  syncRailAuthoringOverlay(
    hoveredCell ? railPreviewAt(hoveredCell, hoveredRailTarget) : null,
  );
  refreshHUD(true);
}

function rotateRailTool(): void {
  if (!railConsoleOpen || !selectedRailTool) {
    rejectRailCommand("Choose a rail construction tool before rotating.");
    return;
  }
  railAuthoringRotation = railToolRotation(railAuthoringRotation);
  railAuthoringStatus = `Rail authoring rotation ${railAuthoringRotation * 90}°.`;
  audio.rotate(worldPan(hoveredCell?.x ?? cameraFocus.x));
  syncRailAuthoringOverlay(
    hoveredCell ? railPreviewAt(hoveredCell, hoveredRailTarget) : null,
  );
  refreshHUD(true);
}

function cancelRailAuthoring(): void {
  selectedRailTool = null;
  selectedRailTarget = null;
  pendingRailSignalSourceId = null;
  hoveredRailTarget = null;
  railAuthoringStatus =
    "Rail authoring cancelled. Choose a tool or select live hardware.";
  syncRailAuthoringOverlay();
  refreshHUD(true);
}

function placeRailTrack(
  point: GridPoint,
  buildKind: "straight" | "curve" | "junction",
): void {
  const snapshot = simulation.railSnapshot();
  const save = currentRailSave();
  if (!snapshot || !save) {
    rejectRailCommand("This world has no configured rail network.");
    return;
  }
  const terrain = simulation.getTerrainAt(point.x, point.z);
  if (terrain === undefined) {
    rejectRailCommand("Outside the world boundary.");
    return;
  }
  if (terrain === TerrainType.Water) {
    rejectRailCommand("Track cannot be placed on water.");
    return;
  }
  if (simulation.getEntityAt(point.x, point.z)) {
    rejectRailCommand("A factory entity occupies this track tile.");
    return;
  }
  let candidate: RailSegmentInput;
  try {
    candidate = authoredSegment(
      nextRailId(railConstruction, "segment"),
      buildKind,
      point.x,
      point.z,
      railAuthoringRotation,
    );
  } catch (error) {
    console.error("Rail track draft failed.", error);
    rejectRailCommand("The proposed rail tile is not canonical.");
    return;
  }
  const preflight = preflightTrackPlacement(snapshot, candidate);
  if (rejectRailPreflight(preflight)) return;
  const economy = prepareRailPurchase(
    [buildKind],
    [{
      targetKind: "segment",
      id: candidate.id,
      buildKind,
      source: "paid",
    }],
  );
  if (!economy) return;
  if (
    executeRailMutation(
      economy,
      () => simulation.replaceRailSegments([...save.segments, candidate]),
      `${RAIL_BUILD_LABELS[buildKind]} ${candidate.id} commissioned for ${RAIL_BUILD_COSTS[buildKind]} alloy.`,
    )
  ) {
    selectedRailTarget = {
      kind: "segment",
      segmentId: candidate.id,
      blockId:
        simulation.railSnapshot()?.graph.nodes.find(
          (node) => node.segmentId === candidate.id,
        )?.blockId ?? "",
    };
  }
}

function placeRailSignal(
  target: RailPickTarget | null,
  buildKind: "regularSignal" | "chainSignal",
): void {
  const segmentId = railTargetSegmentId(target);
  const snapshot = simulation.railSnapshot();
  const save = currentRailSave();
  if (!snapshot || !save) {
    rejectRailCommand("This world has no configured rail network.");
    return;
  }
  if (!segmentId) {
    rejectRailCommand("Choose a live rail segment.");
    return;
  }
  if (!pendingRailSignalSourceId) {
    if (
      !snapshot.graph.nodes.some((node) => node.segmentId === segmentId)
    ) {
      rejectRailCommand("Choose a live rail segment.");
      return;
    }
    pendingRailSignalSourceId = segmentId;
    selectedRailTarget = target;
    railAuthoringStatus =
      `Source ${segmentId} armed. Choose its adjacent destination segment.`;
    syncRailAuthoringOverlay();
    refreshHUD(true);
    return;
  }
  const sourceId = pendingRailSignalSourceId;
  const type = buildKind === "regularSignal" ? "regular" : "chain";
  const preflight = preflightDirectedSignal(
    snapshot,
    sourceId,
    segmentId,
    type,
  );
  if (rejectRailPreflight(preflight)) return;
  const candidate: RailSignalInput = {
    id: nextRailId(railConstruction, "signal"),
    fromSegmentId: sourceId,
    toSegmentId: segmentId,
    type,
  };
  const economy = prepareRailPurchase(
    [buildKind],
    [{
      targetKind: "signal",
      id: candidate.id,
      buildKind,
      source: "paid",
    }],
  );
  if (!economy) return;
  if (
    executeRailMutation(
      economy,
      () => simulation.replaceRailSignals([...save.signals, candidate]),
      `${RAIL_BUILD_LABELS[buildKind]} ${candidate.id} now guards ${sourceId} → ${segmentId}.`,
    )
  ) {
    pendingRailSignalSourceId = null;
    selectedRailTarget = {
      kind: "signal",
      signalId: candidate.id,
    };
    syncRailAuthoringOverlay();
  }
}

function placeRailStation(target: RailPickTarget | null): void {
  const segmentId = railTargetSegmentId(target);
  const snapshot = simulation.railSnapshot();
  const save = currentRailSave();
  if (!snapshot || !save || !segmentId) {
    rejectRailCommand(
      snapshot
        ? "Choose a live rail segment."
        : "This world has no configured rail network.",
    );
    return;
  }
  const preflight = preflightStationPlacement(snapshot, segmentId);
  if (rejectRailPreflight(preflight)) return;
  const candidate = canonicalStationInput(
    nextRailId(railConstruction, "station"),
    segmentId,
  );
  const economy = prepareRailPurchase(
    ["station"],
    [{
      targetKind: "station",
      id: candidate.id,
      buildKind: "station",
      source: "paid",
    }],
  );
  if (!economy) return;
  if (
    executeRailMutation(
      economy,
      () => simulation.replaceRailStations(
        [...save.stations, candidate],
        liveRailInterfaces(),
      ),
      `Station ${candidate.id} commissioned on ${segmentId}.`,
    )
  ) {
    selectedRailTarget = {
      kind: "station",
      stationId: candidate.id,
    };
  }
}

function placeRailTrain(target: RailPickTarget | null): void {
  if (target?.kind === "train") {
    addRailConsistCar(target.trainId, "locomotive");
    return;
  }
  const segmentId = railTargetSegmentId(target);
  const snapshot = simulation.railSnapshot();
  if (!snapshot || !segmentId) {
    rejectRailCommand(
      snapshot
        ? "Choose an unoccupied rail segment."
        : "This world has no configured rail network.",
    );
    return;
  }
  const preflight = preflightTrainPlacement(snapshot, segmentId);
  if (rejectRailPreflight(preflight)) return;
  const station =
    snapshot.stations.find(
      (candidate) => candidate.segmentId === segmentId,
    );
  if (!station) {
    rejectRailCommand(
      "New locomotives must spawn at a station for physical fueling.",
    );
    return;
  }
  const reachable = new Set<string>([segmentId]);
  const queue = [segmentId];
  while (queue.length > 0) {
    const source = queue.shift()!;
    for (const edge of snapshot.graph.edges) {
      if (
        edge.fromSegmentId !== source ||
        reachable.has(edge.toSegmentId)
      ) {
        continue;
      }
      reachable.add(edge.toSegmentId);
      queue.push(edge.toSegmentId);
    }
  }
  const otherStation = snapshot.stations.find(
    (candidate) =>
      candidate.id !== station.id &&
      reachable.has(candidate.segmentId),
  );
  const trainId = nextRailId(railConstruction, "train");
  const carId = nextRailId(railConstruction, "car");
  const candidate: RailTrainInput = {
    id: trainId,
    currentSegmentId: segmentId,
    cars: [{
      id: carId,
      kind: "locomotive",
      fuelCapacityMilli: 240_000,
      fuelMilli: 0,
    }],
    schedule: [{
      stationId: station.id,
      wait: { type: "time", ticks: 60 },
    }, ...(
      otherStation
        ? [{
            stationId: otherStation.id,
            wait: { type: "time" as const, ticks: 60 },
          }]
        : []
    )],
  };
  const economy = prepareRailPurchase(
    ["locomotive"],
    [
      {
        targetKind: "train",
        id: trainId,
        buildKind: "trainShell",
        source: "granted",
      },
      {
        targetKind: "car",
        id: carId,
        trainId,
        buildKind: "locomotive",
        source: "paid",
      },
    ],
  );
  if (!economy) return;
  if (
    executeRailMutation(
      economy,
      () => simulation.addRailTrain(candidate),
      `Train ${trainId} commissioned with one unfueled locomotive.`,
    )
  ) {
    selectedRailTarget = { kind: "train", trainId };
  }
}

function addRailConsistCar(
  trainId: string,
  kind: "locomotive" | "cargo-wagon",
): void {
  const snapshot = simulation.railSnapshot();
  const save = currentRailSave();
  const train = snapshot?.trains.find(
    (candidate) => candidate.id === trainId,
  );
  const serializedTrain = save?.trains.find(
    (candidate) => candidate.id === trainId,
  );
  if (!train || !serializedTrain) {
    rejectRailCommand("Choose a live train.");
    return;
  }
  if (
    train.status !== "dwelling" ||
    train.cargoUnits !== 0 ||
    train.cars.length >= RAIL_LIMITS.maxCarsPerTrain
  ) {
    rejectRailCommand(
      "Consist edits require a dwelling, empty train below the 64-car limit.",
    );
    return;
  }
  const carId = nextRailId(railConstruction, "car");
  const buildKind =
    kind === "locomotive" ? "locomotive" : "cargoWagon";
  const car: RailCarInput =
    kind === "locomotive"
      ? {
          id: carId,
          kind,
          fuelCapacityMilli: 240_000,
          fuelMilli: 0,
        }
      : {
          id: carId,
          kind,
          capacity: 6,
        };
  const economy = prepareRailPurchase(
    [buildKind],
    [{
      targetKind: "car",
      id: carId,
      trainId,
      buildKind,
      source: "paid",
    }],
  );
  if (!economy) return;
  if (
    executeRailMutation(
      economy,
      () => simulation.replaceRailTrainConsist(
        trainId,
        [...serializedTrain.cars, car],
      ),
      `${kind === "locomotive" ? "Locomotive" : "Cargo wagon"} ${carId} coupled to ${trainId}.`,
    )
  ) {
    selectedRailTarget = { kind: "train", trainId, carId };
    syncRailAuthoringOverlay();
    refreshHUD(true);
  }
}

function removeRailConsistCar(trainId: string, carId: string): void {
  const snapshot = simulation.railSnapshot();
  const save = currentRailSave();
  const train = snapshot?.trains.find(
    (candidate) => candidate.id === trainId,
  );
  const serializedTrain = save?.trains.find(
    (candidate) => candidate.id === trainId,
  );
  if (!train || !serializedTrain) {
    rejectRailCommand("Choose a live train.");
    return;
  }
  const blockers = railDismantleBlockers(
    snapshot,
    "car",
    carId,
    liveRailInterfaces(),
    trainId,
  );
  if (blockers.length > 0) {
    rejectRailCommand(`Car removal blocked by ${blockers.join(", ")}.`);
    return;
  }
  const nextCars = serializedTrain.cars.filter(
    (car) => car.id !== carId,
  );
  if (nextCars.length === serializedTrain.cars.length) {
    rejectRailCommand("That rail car no longer exists.");
    return;
  }
  const economy = prepareRailRemoval([
    railLedgerKey("car", carId, trainId),
  ]);
  if (!economy) return;
  if (
    executeRailMutation(
      economy,
      () => simulation.replaceRailTrainConsist(trainId, nextCars),
      `Car ${carId} dismantled; ${economy.refund} alloy refunded from paid provenance.`,
    )
  ) {
    selectedRailTarget = { kind: "train", trainId };
    syncRailAuthoringOverlay();
    refreshHUD(true);
  }
}

function fuelRailLocomotive(trainId: string, locomotiveId: string): void {
  const snapshot = simulation.railSnapshot();
  const train = snapshot?.trains.find(
    (candidate) => candidate.id === trainId,
  );
  const locomotive = train?.cars.find(
    (car) =>
      car.id === locomotiveId && car.kind === "locomotive",
  );
  const station = snapshot?.stations.find(
    (candidate) =>
      candidate.segmentId === train?.currentSegmentId,
  );
  const binding = station
    ? liveRailInterfaces().find(
        (candidate) => candidate.stationId === station.id,
      )
    : undefined;
  const boundStorage = binding
    ? simulation.getEntity(binding.storageEntityId)
    : undefined;
  if (!snapshot || !train || !locomotive) {
    rejectRailCommand("Choose a live locomotive.");
    return;
  }
  const canUseBoundStation =
    Boolean(station) &&
    (train.status === "dwelling" ||
      train.status === "out-of-fuel") &&
    train.speedMilliPerTick === 0 &&
    Boolean(binding) &&
    binding?.mode !== "unload" &&
    (!binding?.itemFilter ||
      binding.itemFilter.includes("coal")) &&
    boundStorage?.kind === "storage";
  const fieldStorageId = canUseBoundStation
    ? undefined
    : simulation.railFieldPrimeStorageIds(train.id)[0];
  const storage = canUseBoundStation
    ? boundStorage
    : fieldStorageId === undefined
      ? undefined
      : simulation.getEntity(fieldStorageId);
  if (!storage || storage.kind !== "storage") {
    rejectRailCommand(
      train.status === "out-of-fuel"
        ? "Field prime requires physical coal storage within four cardinal tiles."
        : "Dwell at a LOAD/BOTH station whose bound storage permits coal.",
    );
    return;
  }
  const availableCoal = storage.inventory.coal ?? 0;
  const fuelRoom =
    locomotive.fuelCapacityMilli - locomotive.fuelMilli;
  const transferCount = Math.min(
    canUseBoundStation ? availableCoal : 1,
    Math.floor(fuelRoom / COAL_ENERGY_KJ),
  );
  if (transferCount <= 0) {
    rejectRailCommand(
      availableCoal <= 0
        ? "The bound station storage contains no physical coal."
        : "This locomotive has no room for another whole coal unit.",
    );
    return;
  }
  executeFreeRailMutation(
    () => {
      const consumed =
        canUseBoundStation && station
          ? simulation.fuelRailLocomotiveFromStorage(
              station.id,
              train.id,
              locomotive.id,
              transferCount,
            )
          : simulation.fieldPrimeRailLocomotiveFromStorage(
              storage.id,
              train.id,
              locomotive.id,
              transferCount,
            );
      return consumed === transferCount
        ? { ok: true }
        : { ok: false, reason: "invalid" };
    },
    `${canUseBoundStation ? transferCount : 1} physical coal ${
      canUseBoundStation ? "loaded" : "field-primed"
    } into ${locomotive.id} from storage #${storage.id}.`,
  );
}

function handleRailPrimary(
  point: GridPoint,
  dragging: boolean,
  clientX: number,
  clientY: number,
): void {
  if (dragging) return;
  const target = renderer.pickRailTarget(clientX, clientY);
  hoveredRailTarget = target;
  if (!selectedRailTool) {
    selectRailTarget(target);
    return;
  }
  if (
    selectedRailTool === "straight" ||
    selectedRailTool === "curve" ||
    selectedRailTool === "junction"
  ) {
    placeRailTrack(point, selectedRailTool);
  } else if (
    selectedRailTool === "regularSignal" ||
    selectedRailTool === "chainSignal"
  ) {
    placeRailSignal(target, selectedRailTool);
  } else if (selectedRailTool === "station") {
    placeRailStation(target);
  } else if (selectedRailTool === "locomotive") {
    placeRailTrain(target);
  } else {
    if (target?.kind !== "train") {
      rejectRailCommand("Choose a dwelling, empty train.");
      return;
    }
    addRailConsistCar(target.trainId, "cargo-wagon");
  }
  syncRailAuthoringOverlay(
    hoveredCell ? railPreviewAt(hoveredCell, hoveredRailTarget) : null,
  );
  refreshHUD(true);
}

function applyRailStationInterface(
  stationId: string,
  draft: {
    readonly storageEntityId: number | null;
    readonly mode: "load" | "unload" | "both";
    readonly transferRate: number;
    readonly itemFilter: readonly ItemId[] | null;
  },
): void {
  const snapshot = simulation.railSnapshot();
  const save = currentRailSave();
  const station = snapshot?.stations.find(
    (candidate) => candidate.id === stationId,
  );
  if (!snapshot || !save || !station) {
    rejectRailCommand("Choose a live rail station.");
    return;
  }
  const current = [...liveRailInterfaces()];
  let next: RailStationStorageInterface[];
  if (draft.storageEntityId === null) {
    next = current.filter(
      (binding) => binding.stationId !== stationId,
    );
  } else {
    let itemFilter: readonly ItemId[] | undefined;
    try {
      itemFilter = canonicalRailItemFilter(draft.itemFilter);
    } catch {
      rejectRailCommand(
        "Choose “No filter” or at least one unique known item.",
      );
      return;
    }
    const entities = simulation.getEntities().map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      x: entity.x,
      y: entity.y,
      direction: entity.direction,
    }));
    const preflight = preflightStationBinding(
      snapshot,
      stationId,
      draft.storageEntityId,
      draft.mode,
      draft.transferRate,
      itemFilter,
      entities,
      current,
    );
    if (rejectRailPreflight(preflight)) return;
    const binding: RailStationStorageInterface = {
      stationId,
      storageEntityId: draft.storageEntityId,
      mode: draft.mode,
      transferRate: draft.transferRate,
      ...(itemFilter === undefined ? {} : { itemFilter }),
    };
    next = [
      ...current.filter(
        (candidate) => candidate.stationId !== stationId,
      ),
      binding,
    ].sort((left, right) =>
      left.stationId.localeCompare(right.stationId)
    );
  }
  if (JSON.stringify(current) === JSON.stringify(next)) {
    railAuthoringStatus = "Station interface is already canonical; no command recorded.";
    refreshHUD(true);
    return;
  }
  executeFreeRailMutation(
    () => simulation.replaceRailStations(save.stations, next),
    draft.storageEntityId === null
      ? `Station ${stationId} storage interface removed.`
      : `Station ${stationId} now uses storage #${draft.storageEntityId}.`,
  );
}

function applyRailSchedule(
  trainId: string,
  schedule: readonly RailScheduleStop[],
): void {
  const snapshot = simulation.railSnapshot();
  const train = snapshot?.trains.find(
    (candidate) => candidate.id === trainId,
  );
  if (!snapshot || !train) {
    rejectRailCommand("Choose a live train.");
    return;
  }
  const preflight = preflightSchedule(snapshot, schedule);
  if (rejectRailPreflight(preflight)) return;
  if (JSON.stringify(train.schedule) === JSON.stringify(schedule)) {
    railAuthoringStatus = "Train schedule is unchanged; no command recorded.";
    refreshHUD(true);
    return;
  }
  executeFreeRailMutation(
    () => simulation.setRailTrainSchedule(trainId, schedule),
    `Schedule for ${trainId} updated with ${schedule.length} stop${schedule.length === 1 ? "" : "s"}.`,
  );
}

function dismantleSelectedRail(): void {
  const target = selectedRailTarget;
  const snapshot = simulation.railSnapshot();
  const save = currentRailSave();
  if (!target || !snapshot || !save) {
    rejectRailCommand(
      snapshot
        ? "Select a rail target before dismantling."
        : "This world has no configured rail network.",
    );
    return;
  }
  const identity = railTargetIdentity(target);
  const interfaces = liveRailInterfaces();
  const blockers = railDismantleBlockers(
    snapshot,
    identity.kind,
    identity.id,
    interfaces,
    identity.trainId,
  );
  if (blockers.length > 0) {
    rejectRailCommand(
      `Dismantle blocked by ${blockers.join(", ")}.`,
    );
    return;
  }

  if (identity.kind === "car") {
    removeRailConsistCar(identity.trainId!, identity.id);
    return;
  }

  let keys: string[];
  let mutate: () => RailMutationResult;
  if (identity.kind === "segment") {
    keys = [railLedgerKey("segment", identity.id)];
    mutate = () => simulation.replaceRailSegments(
      save.segments.filter((segment) => segment.id !== identity.id),
    );
  } else if (identity.kind === "signal") {
    keys = [railLedgerKey("signal", identity.id)];
    mutate = () => simulation.replaceRailSignals(
      save.signals.filter((signal) => signal.id !== identity.id),
    );
  } else if (identity.kind === "station") {
    keys = [railLedgerKey("station", identity.id)];
    mutate = () => simulation.replaceRailStations(
      save.stations.filter((station) => station.id !== identity.id),
      interfaces.filter((binding) => binding.stationId !== identity.id),
    );
  } else {
    const train = snapshot.trains.find(
      (candidate) => candidate.id === identity.id,
    );
    if (!train) {
      rejectRailCommand("That train no longer exists.");
      return;
    }
    keys = [
      railLedgerKey("train", train.id),
      ...train.cars.map((car) =>
        railLedgerKey("car", car.id, train.id)
      ),
    ];
    mutate = () => simulation.removeRailTrain(train.id);
  }
  const economy = prepareRailRemoval(keys);
  if (!economy) return;
  if (
    executeRailMutation(
      economy,
      mutate,
      `${identity.kind} ${identity.id} dismantled; ${economy.refund} alloy refunded from paid provenance.`,
    )
  ) {
    selectedRailTarget = null;
    pendingRailSignalSourceId = null;
    syncRailAuthoringOverlay();
    refreshHUD(true);
  }
}

function railStorageCandidates(): readonly {
  readonly id: number;
  readonly kind: EntityState["kind"];
  readonly x: number;
  readonly y: number;
  readonly direction: Direction;
}[] {
  return simulation.getEntities()
    .filter((entity) => entity.kind === "storage")
    .map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      x: entity.x,
      y: entity.y,
      direction: entity.direction,
    }));
}

function createRailAuthoringHUD(
  previewStatus: string | null = null,
  suppressReturnFocus = false,
): HUDRailAuthoring {
  const snapshot = simulation.railSnapshot();
  const interfaces = liveRailInterfaces();
  const networkConfigured = snapshot !== null;
  const unlocked = isRailAuthoringUnlocked(progression);
  const tools = RAIL_BUILD_KINDS.map((kind, index) => {
    const cost = RAIL_BUILD_COSTS[kind];
    const affordable = progression.alloy >= cost;
    return {
      kind,
      label: RAIL_BUILD_LABELS[kind],
      key: String(index + 1),
      cost,
      available: networkConfigured,
      affordable,
      status: !networkConfigured
        ? "No rail network"
        : !unlocked
          ? "Autonomy required"
          : !affordable
            ? `Need ${cost - progression.alloy} alloy`
            : "Ready",
    };
  });

  let selected: HUDRailAuthoring["selected"] = null;
  let stationEditor: HUDRailAuthoring["stationEditor"];
  let trainEditor: HUDRailAuthoring["trainEditor"];
  const target = selectedRailTarget;
  if (snapshot && target?.kind === "segment") {
    const segment = snapshot.graph.nodes.find(
      (node) => node.segmentId === target.segmentId,
    );
    if (segment) {
      selected = {
        kind: "segment",
        id: segment.segmentId,
        label: `${segment.kind.toUpperCase()} · ${segment.segmentId}`,
        detail:
          `Tile ${segment.x}, ${segment.y} · rotation ${segment.rotation * 90}° · block ${segment.blockId}`,
        dismantleBlockers: railDismantleBlockers(
          snapshot,
          "segment",
          segment.segmentId,
          interfaces,
        ),
      };
    }
  } else if (snapshot && target?.kind === "signal") {
    const signal = snapshot.signals.find(
      (candidate) => candidate.id === target.signalId,
    );
    if (signal) {
      selected = {
        kind: "signal",
        id: signal.id,
        label: `${signal.type.toUpperCase()} SIGNAL · ${signal.id}`,
        detail:
          `${signal.fromSegmentId} → ${signal.toSegmentId} · ${signal.aspect.toUpperCase()}`,
        dismantleBlockers: railDismantleBlockers(
          snapshot,
          "signal",
          signal.id,
          interfaces,
        ),
      };
    }
  } else if (snapshot && target?.kind === "station") {
    const station = snapshot.stations.find(
      (candidate) => candidate.id === target.stationId,
    );
    if (station) {
      selected = {
        kind: "station",
        id: station.id,
        label: `STATION · ${station.id}`,
        detail:
          `Segment ${station.segmentId} · ${station.storedUnits}/${station.capacity} station inventory`,
        dismantleBlockers: railDismantleBlockers(
          snapshot,
          "station",
          station.id,
          interfaces,
        ),
      };
      const binding = interfaces.find(
        (candidate) => candidate.stationId === station.id,
      );
      const storageEntities = railStorageCandidates();
      const storageOptions = storageEntities
        .filter((storage) =>
          preflightStationBinding(
            snapshot,
            station.id,
            storage.id,
            binding?.mode ?? "both",
            binding?.transferRate ?? 1,
            binding?.itemFilter ?? null,
            storageEntities,
            interfaces,
          ).ok
        )
        .map((storage) => ({
          entityId: storage.id,
          label: `Storage #${storage.id} · ${storage.x}, ${storage.y}`,
        }));
      stationEditor = {
        stationId: station.id,
        segmentId: station.segmentId,
        storageEntityId: binding?.storageEntityId ?? null,
        storageOptions,
        mode: binding?.mode ?? "both",
        transferRate: binding?.transferRate ?? 1,
        itemFilter: binding?.itemFilter ?? null,
        itemOptions: ITEM_IDS.map((id) => ({
          id,
          label: ITEMS[id].name,
        })),
      };
    }
  } else if (snapshot && target?.kind === "train") {
    const train = snapshot.trains.find(
      (candidate) => candidate.id === target.trainId,
    );
    if (train) {
      const selectedCar = target.carId
        ? train.cars.find((car) => car.id === target.carId)
        : undefined;
      const identityKind = selectedCar ? "car" : "train";
      const identityId = selectedCar?.id ?? train.id;
      const blockers = railDismantleBlockers(
        snapshot,
        identityKind,
        identityId,
        interfaces,
        selectedCar ? train.id : null,
      );
      selected = {
        kind: identityKind,
        id: identityId,
        ...(selectedCar ? { parentTrainId: train.id } : {}),
        label: selectedCar
          ? `${selectedCar.kind === "locomotive" ? "LOCOMOTIVE" : "CARGO WAGON"} · ${selectedCar.id}`
          : `TRAIN · ${train.id}`,
        detail: selectedCar
          ? selectedCar.kind === "locomotive"
            ? `${selectedCar.fuelMilli}/${selectedCar.fuelCapacityMilli} fuel · train ${train.id}`
            : `${selectedCar.stored}/${selectedCar.capacity} cargo · train ${train.id}`
          : `Dismantles shell + ${train.cars.length} car${train.cars.length === 1 ? "" : "s"} · ${train.status} · ${train.distanceTravelledMilli} distance`,
        dismantleBlockers: blockers,
      };
      const canEditConsist =
        train.status === "dwelling" &&
        train.cargoUnits === 0 &&
        train.cars.length < RAIL_LIMITS.maxCarsPerTrain;
      const fuelStation = snapshot.stations.find(
        (station) => station.segmentId === train.currentSegmentId,
      );
      const fuelBinding = fuelStation
        ? interfaces.find(
            (binding) => binding.stationId === fuelStation.id,
          )
        : undefined;
      const fuelStorage = fuelBinding
        ? simulation.getEntity(fuelBinding.storageEntityId)
        : undefined;
      const canUseBoundFuel =
        Boolean(fuelStation) &&
        (train.status === "dwelling" ||
          train.status === "out-of-fuel") &&
        train.speedMilliPerTick === 0 &&
        Boolean(fuelBinding) &&
        fuelBinding?.mode !== "unload" &&
        (!fuelBinding?.itemFilter ||
          fuelBinding.itemFilter.includes("coal")) &&
        fuelStorage?.kind === "storage";
      const fieldPrimeStorageId = canUseBoundFuel
        ? undefined
        : simulation.railFieldPrimeStorageIds(train.id)[0];
      const availableFuelStorage = canUseBoundFuel
        ? fuelStorage
        : fieldPrimeStorageId === undefined
          ? undefined
          : simulation.getEntity(fieldPrimeStorageId);
      trainEditor = {
        trainId: train.id,
        status: train.status,
        cars: train.cars.map((car) => {
          const carBlockers = railDismantleBlockers(
            snapshot,
            "car",
            car.id,
            interfaces,
            train.id,
          );
          const fuelRoom =
            car.kind === "locomotive"
              ? car.fuelCapacityMilli - car.fuelMilli
              : 0;
          const fuelable =
            car.kind === "locomotive" &&
            Boolean(availableFuelStorage) &&
            (availableFuelStorage?.inventory.coal ?? 0) > 0 &&
            fuelRoom >= COAL_ENERGY_KJ;
          return {
            id: car.id,
            kind: car.kind,
            label:
              `${car.kind === "locomotive" ? "Locomotive" : "Cargo wagon"} · ${car.id}`,
            fuelMilli: car.fuelMilli,
            cargoUnits: car.stored,
            selected: car.id === target.carId,
            removable: carBlockers.length === 0,
            removeReason:
              carBlockers.length === 0
                ? "Ready to remove with exact paid-provenance refund."
                : `Blocked by ${carBlockers.join(", ")}.`,
            fuelable,
            fuelReason:
              car.kind !== "locomotive"
                ? "Only locomotives accept fuel."
                : fuelRoom < COAL_ENERGY_KJ
                  ? "No room for another whole coal unit."
                  : canUseBoundFuel && availableFuelStorage
                    ? `Load physical coal from storage #${availableFuelStorage.id}.`
                    : train.status === "out-of-fuel" &&
                        availableFuelStorage
                      ? `Field prime one coal from nearby storage #${availableFuelStorage.id}.`
                      : train.status !== "dwelling"
                        ? "Dwell at a station, or stop out of fuel near coal storage."
                        : "Station needs LOAD/BOTH bound storage that permits coal.",
          };
        }),
        schedule: train.schedule,
        stationOptions: snapshot.stations.map((station) => ({
          id: station.id,
          label: `${station.id} · ${station.segmentId}`,
        })),
        itemOptions: ITEM_IDS.map((id) => ({
          id,
          label: ITEMS[id].name,
        })),
        canEditConsist,
        consistStatus: canEditConsist
          ? "Dwelling and empty · consist edits available."
          : train.status !== "dwelling"
            ? "Train must be dwelling before consist edits."
            : train.cargoUnits > 0
              ? `Unload ${train.cargoUnits} cargo units before consist edits.`
              : "The consist has reached the 64-car limit.",
      };
    }
  }

  return {
    open: railConsoleOpen,
    unlocked,
    networkConfigured,
    alloy: progression.alloy,
    selectedTool: selectedRailTool,
    rotation: railAuthoringRotation,
    status: networkConfigured
      ? railAuthoringStatus
      : "This world has no configured rail network.",
    previewStatus,
    suppressReturnFocus,
    sourceSegmentId: pendingRailSignalSourceId,
    tools,
    selected,
    ...(stationEditor ? { stationEditor } : {}),
    ...(trainEditor ? { trainEditor } : {}),
  };
}

function handleHover(
  point: GridPoint | null,
  clientX?: number,
  clientY?: number,
): void {
  const railHoverStarted =
    railConsoleOpen &&
    clientX !== undefined &&
    clientY !== undefined
      ? performance.now()
      : null;
  hoveredCell = point;
  if (!point) {
    hoveredRailTarget = null;
  } else if (clientX !== undefined && clientY !== undefined) {
    hoveredRailTarget = renderer.pickRailTarget(clientX, clientY);
  }
  renderer.setHovered(point?.x ?? null, point?.z ?? null);
  if (!point) {
    syncRailAuthoringOverlay();
    blueprintRenderer.setBlueprintOverlay?.(null);
    blueprintRenderer.setBlueprintCaptureMarquee?.(null);
    renderer.setGhost(null, 0, 0, selectedDirection, true);
    hud.update({ blueprint: createBlueprintHUD(null) });
    return;
  }

  if (railConsoleOpen) {
    blueprintRenderer.setBlueprintOverlay?.(null);
    blueprintRenderer.setBlueprintCaptureMarquee?.(null);
    renderer.setGhost(null, point.x, point.z, selectedDirection, true);
    const preview = railPreviewAt(point, hoveredRailTarget);
    syncRailAuthoringOverlay(preview);
    hud.update({
      coordinates: { x: point.x, z: point.z },
      blueprint: null,
      railAuthoring: createRailAuthoringHUD(preview?.reason ?? null),
    });
    if (railHoverStarted !== null) {
      const context: RailHoverContext =
        selectedRailTarget?.kind === "station"
          ? "station"
          : selectedRailTarget?.kind === "train"
            ? "train"
            : "general";
      const samples = railHoverDurations[context];
      samples.push(performance.now() - railHoverStarted);
      if (samples.length > 512) samples.shift();
    }
    return;
  }

  const blueprintPreview =
    blueprintMode === "paste" && blueprintClipboard
      ? previewBlueprintPlacement(point)
      : null;
  if (blueprintMode === "paste" && blueprintClipboard) {
    const preview = blueprintPreview!;
    blueprintRenderer.setBlueprintCaptureMarquee?.(null);
    if (blueprintRenderer.setBlueprintOverlay) {
      blueprintRenderer.setBlueprintOverlay(
        createBlueprintWorldOverlay(point, preview),
      );
      renderer.setGhost(null, point.x, point.z, selectedDirection, preview.ok);
    } else {
      const first = preview.plan.placements[0];
      renderer.setGhost(
        first && isBuildKind(first.kind)
          ? placementGhostKind(first.kind)
          : null,
        first?.x ?? point.x,
        first?.y ?? point.z,
        first?.direction ?? selectedDirection,
        preview.ok,
        preview.ok ? undefined : preview.reason,
      );
    }
  } else if (blueprintMode === "capture") {
    blueprintRenderer.setBlueprintOverlay?.(null);
    blueprintRenderer.setBlueprintCaptureMarquee?.(
      createBlueprintWorldCapture(point),
    );
    renderer.setGhost(null, point.x, point.z, selectedDirection, true);
  } else if (selectedBuild) {
    blueprintRenderer.setBlueprintOverlay?.(null);
    blueprintRenderer.setBlueprintCaptureMarquee?.(null);
    const previewDirection = effectivePlacementDirection(
      selectedBuild,
      point,
      selectedDirection,
    );
    const placement = simulation.canPlace(
      selectedBuild,
      point.x,
      point.z,
      previewDirection,
      playerPlacementOptions(selectedBuild),
    );
    const siteClearance = placement.ok
      ? checkUplinkSiteClearance(
          simulation,
          uplinkEntityId,
          selectedBuild,
          point.x,
          point.z,
          previewDirection,
        )
      : null;
    const unlocked = progression.unlockedBuildKinds.includes(selectedBuild);
    const affordable = progression.alloy >= BUILD_COSTS[selectedBuild];
    renderer.setGhost(
      placementGhostKind(selectedBuild),
      point.x,
      point.z,
      previewDirection,
      placement.ok && siteClearance?.ok !== false && unlocked && affordable,
      !unlocked
        ? "Complete a Commission Uplink contract to unlock this unit"
        : placement.ok
          ? siteClearance?.ok === false
            ? UPLINK_SITE_CLEARANCE_MESSAGE
            : affordable
              ? undefined
              : "Insufficient construction alloy"
          : PLACEMENT_MESSAGES[placement.reason],
    );
  } else {
    blueprintRenderer.setBlueprintOverlay?.(null);
    blueprintRenderer.setBlueprintCaptureMarquee?.(null);
    renderer.setGhost(null, point.x, point.z, selectedDirection, true);
  }

  hud.update({
    coordinates: { x: point.x, z: point.z },
    blueprint: createBlueprintHUD(
      point,
      blueprintPreview ?? undefined,
    ),
  });
}

function handlePrimary(
  point: GridPoint,
  dragging: boolean,
  clientX: number,
  clientY: number,
): void {
  if (railConsoleOpen) {
    handleRailPrimary(point, dragging, clientX, clientY);
    return;
  }
  if (pendingCircuitWire) {
    if (dragging) return;
    const destination = simulation.getEntityAt(point.x, point.z);
    if (!destination) {
      hud.showToast({
        dedupeKey: "circuit-wire-empty-target",
        title: "NO CIRCUIT ENDPOINT",
        message:
          "Select a combinator or circuit-capable machine within 9 tiles.",
        tone: "error",
        duration: 2200,
      });
      return;
    }
    const bindings = circuitEndpointBindings(
      destination.id,
      destination.kind,
    );
    if (bindings.length === 0) {
      hud.showToast({
        dedupeKey: "circuit-wire-invalid-target",
        title: "NO CIRCUIT ENDPOINT",
        message: `${ENTITY_PROTOTYPES[destination.kind].name} cannot carry circuit wires.`,
        tone: "error",
        duration: 2200,
      });
      return;
    }
    selectEntity(destination.id);
    hud.showToast({
      dedupeKey: `circuit-wire-target-${destination.id}`,
      title: "DESTINATION SELECTED",
      message:
        bindings.length === 1
          ? `Choose ${bindings[0]!.connector.toUpperCase()} to connect the ${pendingCircuitWire.color} wire.`
          : "Choose INPUT or OUTPUT in the patchbay to finish the wire.",
      duration: 1900,
    });
    return;
  }
  if (blueprintMode === "capture") {
    captureBlueprintCorner(point);
    return;
  }
  if (blueprintMode === "paste") {
    placeBlueprint(point);
    return;
  }
  if (!selectedBuild) {
    selectEntity(simulation.getEntityAt(point.x, point.z)?.id ?? null);
    return;
  }

  if (selectedBuild === "belt") {
    if (!dragging) {
      lastBeltCell = point;
    } else if (lastBeltCell) {
      const direction = directionBetween(lastBeltCell, point);
      if (direction !== null) {
        selectedDirection = direction;
        orientEntityAt(lastBeltCell, direction);
      }
    }
  }

  const placementDirection = effectivePlacementDirection(
    selectedBuild,
    point,
    selectedDirection,
  );
  const dockAutoAligned = (
    selectedBuild === "belt"
    && placementDirection !== selectedDirection
  );
  if (dockAutoAligned) selectedDirection = placementDirection;

  if (!progression.unlockedBuildKinds.includes(selectedBuild)) {
    rejectPlacement("That unit is locked behind a Commission Uplink contract.");
    return;
  }

  const validation = simulation.canPlace(
    selectedBuild,
    point.x,
    point.z,
    placementDirection,
    playerPlacementOptions(selectedBuild),
  );
  if (!validation.ok) {
    if (!dragging) rejectPlacement(PLACEMENT_MESSAGES[validation.reason]);
    return;
  }
  const siteClearance = checkUplinkSiteClearance(
    simulation,
    uplinkEntityId,
    selectedBuild,
    point.x,
    point.z,
    placementDirection,
  );
  if (!siteClearance.ok) {
    if (!dragging) rejectPlacement(UPLINK_SITE_CLEARANCE_MESSAGE);
    return;
  }

  const purchase = preflightPlacement(progression, selectedBuild);
  if (!purchase.ok) {
    const messages = {
      locked: "That unit is locked behind a Commission Uplink contract.",
      insufficientAlloy: "Construction alloy reserve exhausted.",
      revisionOverflow: "Construction ledger revision limit reached.",
      sourceConsumed: "Construction ledger changed; retry the command.",
    } as const;
    rejectPlacement(messages[purchase.reason]);
    return;
  }

  rememberUndo();
  const placed = simulation.place(
    selectedBuild,
    point.x,
    point.z,
    placementDirection,
    playerPlacementOptions(selectedBuild),
  );
  if (!placed.ok) {
    undoStack.pop();
    if (!dragging) rejectPlacement(PLACEMENT_MESSAGES[placed.reason]);
    return;
  }

  try {
    const committed = commitPlacement(progression, purchase.authorization);
    progression = committed.state;
    constructionProvenance.set(placed.entity.id, committed.provenance);
  } catch (error) {
    const rollback = undoStack.pop();
    if (rollback) applyAtomicSession(restoreAtomicSession(rollback));
    console.error("Construction purchase could not be committed.", error);
    rejectPlacement("Construction ledger rejected the purchase.");
    return;
  }
  selectedEntityId = placed.entity.id;
  renderer.setSelected(placed.entity.id);
  audio.placed(worldPan(point.x), selectedBuild === "belt" ? 0.55 : 1);
  const reservation = resolveUplinkSiteReservation(
    simulation,
    uplinkEntityId,
  );
  if (
    selectedBuild === "belt"
    && isUplinkDockTile(reservation, point)
  ) {
    hud.showToast({
      dedupeKey: "uplink-dock-connected",
      title: "UPLINK DOCK CONNECTED",
      message: dockAutoAligned
        ? "Final belt auto-aligned with the cyan cargo bridge. Route goods into this lane."
        : "Cargo lane locked to the cyan bridge. Route goods into this belt.",
      tone: "success",
      duration: 3600,
    });
  }
  lastBeltCell = point;
  handleHover(point);
  refreshHUD(true);
}

function handlePrimaryRelease(
  point: GridPoint | null,
  dragged: boolean,
): void {
  if (
    blueprintMode !== "capture" ||
    !blueprintCaptureAnchor ||
    !point ||
    !dragged ||
    (
      point.x === blueprintCaptureAnchor.x &&
      point.z === blueprintCaptureAnchor.z
    )
  ) {
    return;
  }
  captureBlueprintCorner(point);
}

function selectBuild(kind: BuildKind): void {
  pendingCircuitWire = null;
  if (!progression.unlockedBuildKinds.includes(kind)) {
    rejectPlacement("Complete the required Commission Uplink contract first.");
    return;
  }
  if (selectedBuild === kind) {
    cancelBuild();
    return;
  }
  blueprintMode = null;
  blueprintCaptureAnchor = null;
  closeRailAuthoringForModeSwitch();
  selectedBuild = kind;
  selectedEntityId = null;
  lastBeltCell = null;
  renderer.setSelected(null);
  blueprintRenderer.setBlueprintOverlay?.(null);
  blueprintRenderer.setBlueprintCaptureMarquee?.(null);
  hud.update({ selectedBuild: kind, inspector: null, blueprint: null });
  audio.rotate(0);
  if (hoveredCell) handleHover(hoveredCell);
}

function cancelBuild(): void {
  if (railConsoleOpen) {
    cancelRailAuthoring();
    return;
  }
  if (blueprintLibraryOpen) {
    blueprintLibraryOpen = false;
    updateBlueprintLibraryHUD();
    return;
  }
  if (pendingCircuitWire) {
    cancelCircuitWire();
    return;
  }
  blueprintMode = null;
  blueprintCaptureAnchor = null;
  selectedBuild = null;
  lastBeltCell = null;
  blueprintRenderer.setBlueprintOverlay?.(null);
  blueprintRenderer.setBlueprintCaptureMarquee?.(null);
  renderer.setGhost(null, 0, 0, selectedDirection, true);
  hud.update({ selectedBuild: null, blueprint: null });
}

function rotateBuild(): void {
  if (railConsoleOpen) {
    rotateRailTool();
    return;
  }
  if (blueprintMode === "paste" && blueprintClipboard) {
    try {
      blueprintClipboard = transformBlueprint(blueprintClipboard, {
        quarterTurns: 1,
      });
      applyBlueprintTransformIndicator(BLUEPRINT_ROTATE_CW);
      persistBlueprintClipboard();
      if (hoveredCell) handleHover(hoveredCell);
      else hud.update({ blueprint: createBlueprintHUD(null) });
    } catch (error) {
      console.warn("Blueprint rotation was rejected.", error);
      rejectPlacement("This blueprint cannot be rotated exactly.");
      return;
    }
  } else if (!selectedBuild && selectedEntityId !== null) {
    const entity = simulation.getEntity(selectedEntityId);
    if (!entity) return;
    if (entity.id === uplinkEntityId) {
      rejectPlacement(
        "Commission Uplink orientation is fixed to its surveyed cargo dock.",
      );
      return;
    }
    const nextDirection = ((entity.direction + 1) % 4) as Direction;
    const siteClearance = checkUplinkSiteClearance(
      simulation,
      uplinkEntityId,
      entity.kind,
      entity.x,
      entity.y,
      nextDirection,
    );
    if (!siteClearance.ok) {
      rejectPlacement(UPLINK_SITE_CLEARANCE_MESSAGE);
      return;
    }
    rememberUndo();
    const result = simulation.rotate(entity.x, entity.y, true);
    if (!result.ok) {
      undoStack.pop();
      rejectPlacement("This unit cannot rotate within its current footprint.");
      return;
    }
  } else {
    selectedDirection = ((selectedDirection + 1) % 4) as Direction;
    if (hoveredCell) handleHover(hoveredCell);
  }
  audio.rotate(worldPan(hoveredCell?.x ?? cameraFocus.x));
  refreshHUD(true);
}

function beginBlueprintCapture(): void {
  pendingCircuitWire = null;
  closeRailAuthoringForModeSwitch();
  if (blueprintLibraryOpen) {
    blueprintLibraryOpen = false;
    updateBlueprintLibraryHUD();
  }
  blueprintMode = "capture";
  blueprintCaptureAnchor = null;
  selectedBuild = null;
  selectedEntityId = null;
  lastBeltCell = null;
  renderer.setSelected(null);
  blueprintRenderer.setBlueprintOverlay?.(null);
  blueprintRenderer.setBlueprintCaptureMarquee?.(
    hoveredCell ? createBlueprintWorldCapture(hoveredCell) : null,
  );
  renderer.setGhost(null, 0, 0, selectedDirection, true);
  hud.update({
    selectedBuild: null,
    inspector: null,
    blueprint: createBlueprintHUD(hoveredCell),
  });
  hud.showToast({
    title: "BLUEPRINT CAPTURE",
    message:
      "Select the first and opposite corners of the factory area to copy.",
    duration: 3400,
  });
}

function copySelectedBlueprint(): void {
  const entity =
    selectedEntityId === null
      ? undefined
      : simulation.getEntity(selectedEntityId);
  if (!entity) {
    beginBlueprintCapture();
    return;
  }
  try {
    const captured = captureBlueprint(simulation.getEntities(), {
      x: entity.x,
      y: entity.y,
      width: entity.width,
      height: entity.height,
    });
    armBlueprintClipboard(captured);
  } catch (error) {
    console.error("Selected blueprint capture failed.", error);
    rejectPlacement("The selected construction could not be copied.");
  }
}

function beginBlueprintPaste(): void {
  if (!blueprintClipboard || blueprintClipboard.entities.length === 0) {
    hud.showToast({
      title: "BLUEPRINT CLIPBOARD EMPTY",
      message: "Press B to capture an area, or select a unit and copy it.",
      tone: "error",
      duration: 2600,
    });
    hud.update({ blueprint: null });
    return;
  }
  closeRailAuthoringForModeSwitch();
  blueprintMode = "paste";
  blueprintCaptureAnchor = null;
  selectedBuild = null;
  selectedEntityId = null;
  lastBeltCell = null;
  renderer.setSelected(null);
  blueprintRenderer.setBlueprintCaptureMarquee?.(null);
  if (!hoveredCell) blueprintRenderer.setBlueprintOverlay?.(null);
  if (hoveredCell) {
    hud.update({ selectedBuild: null, inspector: null });
    handleHover(hoveredCell);
  } else {
    hud.update({
      selectedBuild: null,
      inspector: null,
      blueprint: createBlueprintHUD(null),
    });
  }
  hud.showToast({
    title: "BLUEPRINT ARMED",
    message:
      `${blueprintClipboard.entities.length} units · ${blueprintClipboard.width}×${blueprintClipboard.height} tiles · R rotate · M / Shift+M mirror H / V`,
    duration: 3200,
  });
}

function mirrorBlueprint(
  axis: "horizontal" | "vertical" = "horizontal",
): void {
  if (blueprintMode !== "paste" || !blueprintClipboard) return;
  try {
    blueprintClipboard = transformBlueprint(blueprintClipboard, {
      mirror: axis,
    });
    applyBlueprintTransformIndicator(
      axis === "horizontal"
        ? BLUEPRINT_MIRROR_H
        : BLUEPRINT_MIRROR_V,
    );
    persistBlueprintClipboard();
    if (hoveredCell) handleHover(hoveredCell);
    else hud.update({ blueprint: createBlueprintHUD(null) });
    audio.rotate(worldPan(hoveredCell?.x ?? cameraFocus.x));
  } catch (error) {
    console.warn("Blueprint mirror was rejected.", error);
    rejectPlacement("This blueprint transform could not be applied exactly.");
  }
}

function captureBlueprintCorner(point: GridPoint): void {
  if (!blueprintCaptureAnchor) {
    blueprintCaptureAnchor = { ...point };
    hud.showToast({
      title: "BLUEPRINT CORNER A",
      message: `Anchor locked at X ${point.x}, Z ${point.z}. Select the opposite corner.`,
      duration: 2600,
    });
    handleHover(point);
    return;
  }
  const x = Math.min(blueprintCaptureAnchor.x, point.x);
  const y = Math.min(blueprintCaptureAnchor.z, point.z);
  const width = Math.abs(point.x - blueprintCaptureAnchor.x) + 1;
  const height = Math.abs(point.z - blueprintCaptureAnchor.z) + 1;
  blueprintCaptureAnchor = null;
  try {
    const captured = captureBlueprint(simulation.getEntities(), {
      x,
      y,
      width,
      height,
    });
    if (captured.entities.length === 0) {
      hud.showToast({
        title: "BLUEPRINT AREA EMPTY",
        message: "No construction intersects the selected factory area.",
        tone: "error",
        duration: 2500,
      });
      handleHover(point);
      return;
    }
    armBlueprintClipboard(captured);
  } catch (error) {
    console.error("Area blueprint capture failed.", error);
    rejectPlacement("The selected area could not be captured.");
  }
}

function armBlueprintClipboard(blueprint: Blueprint): void {
  closeRailAuthoringForModeSwitch();
  blueprintClipboard = blueprint;
  blueprintTransformMatrix = BLUEPRINT_IDENTITY;
  persistBlueprintClipboard();
  blueprintMode = "paste";
  selectedBuild = null;
  selectedEntityId = null;
  lastBeltCell = null;
  renderer.setSelected(null);
  blueprintRenderer.setBlueprintCaptureMarquee?.(null);
  if (!hoveredCell) blueprintRenderer.setBlueprintOverlay?.(null);
  if (hoveredCell) {
    hud.update({ selectedBuild: null, inspector: null });
    handleHover(hoveredCell);
  } else {
    hud.update({
      selectedBuild: null,
      inspector: null,
      blueprint: createBlueprintHUD(null),
    });
  }
  hud.showToast({
    title: "BLUEPRINT CAPTURED",
    message:
      `${blueprint.entities.length} units · ${blueprint.width}×${blueprint.height} tiles · choose a destination`,
    tone: "success",
    duration: 3300,
  });
}

function persistBlueprintClipboard(): void {
  if (!blueprintClipboard) return;
  try {
    const persisted = safeStorageWrite(
      BLUEPRINT_CLIPBOARD_KEY,
      serializeBlueprint(blueprintClipboard),
    );
    if (!persisted) {
      hud.update({ session: createSessionHUD() });
    }
  } catch (error) {
    console.warn("Blueprint clipboard could not be persisted.", error);
  }
}

function findBlueprintLibraryEntry(
  id: string | null,
  entries: readonly BlueprintLibraryEntry[] = blueprintLibrary.entries,
): BlueprintLibraryEntry | null {
  if (id === null) return null;
  for (const entry of entries) {
    if (entry.id === id) return entry;
    if (entry.kind === "book") {
      const nested = findBlueprintLibraryEntry(id, entry.entries);
      if (nested) return nested;
    }
  }
  return null;
}

interface BlueprintLibraryLocation {
  readonly entry: BlueprintLibraryEntry;
  readonly parentId: string | null;
  readonly index: number;
  readonly siblingCount: number;
}

function findBlueprintLibraryLocation(
  id: string | null,
  entries: readonly BlueprintLibraryEntry[] = blueprintLibrary.entries,
  parentId: string | null = null,
): BlueprintLibraryLocation | null {
  if (id === null) return null;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.id === id) {
      return { entry, parentId, index, siblingCount: entries.length };
    }
    if (entry.kind === "book") {
      const nested = findBlueprintLibraryLocation(
        id,
        entry.entries,
        entry.id,
      );
      if (nested) return nested;
    }
  }
  return null;
}

function blueprintLibraryEntityCount(entry: BlueprintLibraryEntry): number {
  if (entry.kind === "blueprint") return entry.blueprint.entities.length;
  return entry.entries.reduce(
    (total, child) => total + blueprintLibraryEntityCount(child),
    0,
  );
}

function blueprintLibraryIcons(entry: BlueprintLibraryEntry): string[] {
  const icons: string[] = [];
  const seen = new Set<string>();
  const add = (id: string): void => {
    if (icons.length >= 4 || seen.has(id)) return;
    seen.add(id);
    icons.push(id);
  };
  for (const icon of entry.icons) add(icon.id);
  if (icons.length > 0) return icons;
  if (entry.kind === "blueprint") {
    for (const entity of entry.blueprint.entities) add(entity.kind);
  } else {
    for (const child of entry.entries) {
      for (const icon of blueprintLibraryIcons(child)) add(icon);
      if (icons.length >= 4) break;
    }
  }
  return icons;
}

function blueprintLibraryPreview(
  entry: BlueprintLibraryEntry,
): HUDBlueprintLibrary["entries"][number]["preview"] {
  if (entry.kind !== "blueprint") return [];
  const source = entry.blueprint.entities;
  const limit = 48;
  const sampled = (() => {
    if (source.length <= limit) return source;
    const indices = new Set<number>();
    const add = (index: number): void => {
      if (indices.size < limit && index >= 0 && index < source.length) {
        indices.add(index);
      }
    };
    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    for (let index = 1; index < source.length; index += 1) {
      if (source[index]!.x < source[minX]!.x) minX = index;
      if (source[index]!.x > source[maxX]!.x) maxX = index;
      if (source[index]!.y < source[minY]!.y) minY = index;
      if (source[index]!.y > source[maxY]!.y) maxY = index;
    }
    add(minX);
    add(maxX);
    add(minY);
    add(maxY);

    const represented = new Set<string>();
    for (let index = 0; index < source.length && indices.size < limit; index += 1) {
      const entity = source[index]!;
      const semanticKey =
        `${entity.kind}:${entity.recipeId ?? ""}:${
          entity.manifoldRouting?.mode ?? ""
        }:${entity.manifoldRouting?.filter ?? ""}`;
      if (represented.has(semanticKey)) continue;
      represented.add(semanticKey);
      add(index);
    }
    for (let slot = 0; slot < limit && indices.size < limit; slot += 1) {
      add(Math.floor((slot * source.length) / limit));
    }
    for (let index = 0; index < source.length && indices.size < limit; index += 1) {
      add(index);
    }
    return [...indices]
      .sort((left, right) => left - right)
      .map((index) => source[index]!);
  })();
  return sampled.map((entity) => {
    const base = ENTITY_PROTOTYPES[entity.kind].footprint;
    const sideways =
      entity.direction === Direction.East ||
      entity.direction === Direction.West;
    return {
      x: entity.x,
      z: entity.y,
      width: sideways ? base.height : base.width,
      height: sideways ? base.width : base.height,
      kind: entity.kind as BuildKind,
      direction: entity.direction,
      recipeId: entity.recipeId,
      manifoldMode: entity.manifoldRouting?.mode ?? null,
      manifoldFilter: entity.manifoldRouting?.filter ?? null,
    };
  });
}

function createBlueprintLibraryHUD(): HUDBlueprintLibrary {
  const entries: HUDBlueprintLibrary["entries"][number][] = [];
  const append = (
    source: readonly BlueprintLibraryEntry[],
    depth: number,
  ): void => {
    for (const entry of source) {
      entries.push({
        id: entry.id,
        kind: entry.kind,
        name: entry.name,
        description: entry.description,
        depth,
        selected: blueprintLibrary.selectedId === entry.id,
        units: blueprintLibraryEntityCount(entry),
        width: entry.kind === "blueprint" ? entry.blueprint.width : 0,
        height: entry.kind === "blueprint" ? entry.blueprint.height : 0,
        icons: blueprintLibraryIcons(entry),
        preview: blueprintLibraryPreview(entry),
      });
      if (entry.kind === "book") append(entry.entries, depth + 1);
    }
  };
  append(blueprintLibrary.entries, 0);
  const selectedLocation = findBlueprintLibraryLocation(
    blueprintLibrary.selectedId,
  );
  return {
    open: blueprintLibraryOpen,
    entries,
    selectedId: blueprintLibrary.selectedId,
    clipboardAvailable:
      blueprintClipboard !== null && blueprintClipboard.entities.length > 0,
    clipboardUnits: blueprintClipboard?.entities.length ?? 0,
    clipboardWidth: blueprintClipboard?.width ?? 0,
    clipboardHeight: blueprintClipboard?.height ?? 0,
    canRestoreDelete: blueprintLibraryDeleteUndo !== null,
    canUpdate: selectedLocation !== null,
    canReassign:
      selectedLocation?.entry.kind === "blueprint" &&
      blueprintClipboard !== null &&
      blueprintClipboard.entities.length > 0,
    canDuplicate: selectedLocation !== null,
    canMoveUp: (selectedLocation?.index ?? 0) > 0,
    canMoveDown:
      selectedLocation !== null &&
      selectedLocation.index < selectedLocation.siblingCount - 1,
  };
}

function updateBlueprintLibraryHUD(): void {
  hud.update({ blueprintLibrary: createBlueprintLibraryHUD() });
}

function toggleBlueprintLibrary(): void {
  const opening = !blueprintLibraryOpen;
  if (opening) closeRailAuthoringForModeSwitch();
  blueprintLibraryOpen = opening;
  updateBlueprintLibraryHUD();
  if (opening) refreshHUD(false);
}

function blueprintLibraryId(reserved: ReadonlySet<string> = new Set()): string {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const id = crypto.randomUUID().toLowerCase();
    if (!reserved.has(id) && !findBlueprintLibraryEntry(id)) return id;
  }
  throw new Error("Could not allocate a unique blueprint library record id.");
}

function commitBlueprintLibrary(next: BlueprintLibrary): void {
  const serialized = serializeBlueprintLibrary(next);
  if (!safeStorageWrite(BLUEPRINT_LIBRARY_KEY, serialized)) {
    hud.update({ session: createSessionHUD() });
    throw new Error("Blueprint library storage is unavailable.");
  }
  blueprintLibrary = next;
  updateBlueprintLibraryHUD();
}

function blueprintLibraryName(
  requested: string,
  fallback: string,
): string {
  const normalized = requested.trim().normalize("NFC");
  return normalized.length > 0 ? normalized : fallback;
}

function saveClipboardToBlueprintLibrary(requestedName: string): void {
  if (!blueprintClipboard || blueprintClipboard.entities.length === 0) {
    rejectPlacement("Capture or load a blueprint before saving a library record.");
    return;
  }
  const selected = findBlueprintLibraryEntry(blueprintLibrary.selectedId);
  const parentId = selected?.kind === "book" ? selected.id : null;
  const insertionIndex =
    selected?.kind === "book"
      ? selected.entries.length
      : blueprintLibrary.entries.length;
  const id = blueprintLibraryId();
  const name = blueprintLibraryName(
    requestedName,
    `Plan ${blueprintClipboard.width}×${blueprintClipboard.height}`,
  );
  const seenIcons = new Set<string>();
  const icons: Array<{ type: "entity"; id: BuildKind }> = [];
  for (const entity of blueprintClipboard.entities) {
    const kind = entity.kind as BuildKind;
    if (seenIcons.has(kind)) continue;
    seenIcons.add(kind);
    icons.push({ type: "entity", id: kind });
    if (icons.length === 4) break;
  }
  try {
    let next = createBlueprintLibraryEntry(
      blueprintLibrary,
      parentId,
      insertionIndex,
      {
        kind: "blueprint",
        id,
        name,
        description:
          `${blueprintClipboard.entities.length} construction units across ${blueprintClipboard.width}×${blueprintClipboard.height} tiles.`,
        icons,
        blueprint: blueprintClipboard,
      },
    );
    next = selectBlueprintLibraryEntry(next, id);
    commitBlueprintLibrary(next);
    blueprintLibraryDeleteUndo = null;
    updateBlueprintLibraryHUD();
    hud.showToast({
      title: "PLAN ARCHIVED",
      message: `${name} saved as canonical local blueprint intent.`,
      tone: "success",
      duration: 2600,
    });
  } catch (error) {
    reportBlueprintLibraryError("Plan could not be archived", error);
  }
}

function createBlueprintLibraryBook(requestedName: string): void {
  const id = blueprintLibraryId();
  const name = blueprintLibraryName(requestedName, "New blueprint book");
  const selected = findBlueprintLibraryEntry(blueprintLibrary.selectedId);
  const parentId = selected?.kind === "book" ? selected.id : null;
  const insertionIndex =
    selected?.kind === "book"
      ? selected.entries.length
      : blueprintLibrary.entries.length;
  try {
    let next = createBlueprintLibraryEntry(
      blueprintLibrary,
      parentId,
      insertionIndex,
      {
        kind: "book",
        id,
        name,
        description: "Ordered frontier construction plans.",
        icons: [],
      },
    );
    next = selectBlueprintLibraryEntry(next, id);
    commitBlueprintLibrary(next);
    blueprintLibraryDeleteUndo = null;
    updateBlueprintLibraryHUD();
    hud.showToast({
      title: "BLUEPRINT BOOK CREATED",
      message: `${name} is ready to receive plans.`,
      tone: "success",
      duration: 2300,
    });
  } catch (error) {
    reportBlueprintLibraryError("Blueprint book could not be created", error);
  }
}

function selectBlueprintLibraryRecord(id: string): void {
  try {
    blueprintLibrary = selectBlueprintLibraryEntry(blueprintLibrary, id);
    updateBlueprintLibraryHUD();
  } catch (error) {
    reportBlueprintLibraryError("Library selection failed", error);
  }
}

function updateSelectedBlueprintLibraryRecord(requestedName: string): void {
  const selected = findBlueprintLibraryEntry(blueprintLibrary.selectedId);
  if (!selected) {
    reportBlueprintLibraryError(
      "No record selected",
      new Error("Choose a blueprint or book before updating metadata."),
    );
    return;
  }
  const name = blueprintLibraryName(requestedName, selected.name);
  try {
    const next = updateBlueprintLibraryEntry(
      blueprintLibrary,
      selected.id,
      { name },
    );
    commitBlueprintLibrary(next);
    blueprintLibraryDeleteUndo = null;
    updateBlueprintLibraryHUD();
    hud.showToast({
      title: "LIBRARY METADATA UPDATED",
      message: `${name} retained its stable record identity and contents.`,
      tone: "success",
      duration: 2400,
    });
  } catch (error) {
    reportBlueprintLibraryError("Library metadata update failed", error);
  }
}

function reassignSelectedBlueprintLibraryRecord(): void {
  const selected = findBlueprintLibraryEntry(blueprintLibrary.selectedId);
  if (
    !selected ||
    selected.kind !== "blueprint" ||
    !blueprintClipboard ||
    blueprintClipboard.entities.length === 0
  ) {
    reportBlueprintLibraryError(
      "Plan reassign failed",
      new Error("Select a blueprint record and arm a non-empty clipboard."),
    );
    return;
  }
  try {
    const next = updateBlueprintLibraryEntry(
      blueprintLibrary,
      selected.id,
      { blueprint: blueprintClipboard },
    );
    commitBlueprintLibrary(next);
    blueprintLibraryDeleteUndo = null;
    updateBlueprintLibraryHUD();
    hud.showToast({
      title: "PLAN REASSIGNED",
      message:
        `${selected.name} kept its identity, metadata, and archive position while receiving current construction intent.`,
      tone: "success",
      duration: 3000,
    });
  } catch (error) {
    reportBlueprintLibraryError("Plan reassign failed", error);
  }
}

function blueprintLibrarySubtreeSize(entry: BlueprintLibraryEntry): number {
  return entry.kind === "blueprint"
    ? 1
    : 1 + entry.entries.reduce(
        (total, child) => total + blueprintLibrarySubtreeSize(child),
        0,
      );
}

function duplicateSelectedBlueprintLibraryRecord(): void {
  const location = findBlueprintLibraryLocation(blueprintLibrary.selectedId);
  if (!location) {
    reportBlueprintLibraryError(
      "No record selected",
      new Error("Choose a blueprint or book before duplicating."),
    );
    return;
  }
  const ids: string[] = [];
  const idSet = new Set<string>();
  while (ids.length < blueprintLibrarySubtreeSize(location.entry)) {
    const id = blueprintLibraryId(idSet);
    idSet.add(id);
    ids.push(id);
  }
  try {
    let next = duplicateBlueprintLibraryEntry(
      blueprintLibrary,
      location.entry.id,
      ids,
      location.parentId,
      location.index + 1,
    );
    next = selectBlueprintLibraryEntry(next, ids[0]!);
    commitBlueprintLibrary(next);
    blueprintLibraryDeleteUndo = null;
    updateBlueprintLibraryHUD();
    hud.showToast({
      title: "LIBRARY RECORD DUPLICATED",
      message:
        `${location.entry.name} was copied with fresh stable identity across its complete subtree.`,
      tone: "success",
      duration: 2800,
    });
  } catch (error) {
    reportBlueprintLibraryError("Library duplication failed", error);
  }
}

function moveSelectedBlueprintLibraryRecord(
  direction: "up" | "down",
): void {
  const location = findBlueprintLibraryLocation(blueprintLibrary.selectedId);
  if (!location) return;
  const index =
    direction === "up" ? location.index - 1 : location.index + 1;
  if (index < 0 || index >= location.siblingCount) return;
  try {
    const next = moveBlueprintLibraryEntry(
      blueprintLibrary,
      location.entry.id,
      location.parentId,
      index,
    );
    commitBlueprintLibrary(next);
    blueprintLibraryDeleteUndo = null;
    updateBlueprintLibraryHUD();
    audio.rotate();
  } catch (error) {
    reportBlueprintLibraryError("Library reorder failed", error);
  }
}

function loadSelectedBlueprintLibraryRecord(): void {
  const selected = findBlueprintLibraryEntry(blueprintLibrary.selectedId);
  if (!selected || selected.kind !== "blueprint") {
    reportBlueprintLibraryError(
      "No plan selected",
      new Error("Select a blueprint record before loading."),
    );
    return;
  }
  blueprintClipboard = selected.blueprint;
  persistBlueprintClipboard();
  blueprintLibraryOpen = false;
  updateBlueprintLibraryHUD();
  armBlueprintClipboard(selected.blueprint);
  hud.showToast({
    title: "LIBRARY PLAN ARMED",
    message:
      `${selected.name} · ${selected.blueprint.entities.length} units · repeat-paste ready`,
    tone: "success",
    duration: 3000,
  });
}

function deleteSelectedBlueprintLibraryRecord(): void {
  const selected = findBlueprintLibraryEntry(blueprintLibrary.selectedId);
  if (!selected) {
    reportBlueprintLibraryError(
      "No record selected",
      new Error("Choose a blueprint or book before deleting."),
    );
    return;
  }
  try {
    const previous = blueprintLibrary;
    const next = deleteBlueprintLibraryEntry(
      blueprintLibrary,
      selected.id,
    );
    commitBlueprintLibrary(next);
    blueprintLibraryDeleteUndo = previous;
    updateBlueprintLibraryHUD();
    hud.showToast({
      title: selected.kind === "book" ? "BOOK DELETED" : "PLAN DELETED",
      message:
        `${selected.name} was removed from local storage · Restore Delete is armed.`,
      duration: 3300,
    });
  } catch (error) {
    reportBlueprintLibraryError("Library deletion failed", error);
  }
}

function restoreDeletedBlueprintLibraryRecord(): void {
  const previous = blueprintLibraryDeleteUndo;
  if (!previous) {
    reportBlueprintLibraryError(
      "Nothing to restore",
      new Error("No recent library deletion is available."),
    );
    return;
  }
  try {
    blueprintLibraryDeleteUndo = null;
    commitBlueprintLibrary(previous);
    hud.showToast({
      title: "LIBRARY DELETE RESTORED",
      message: "The last removed blueprint record or book has been recovered.",
      tone: "success",
      duration: 2600,
    });
  } catch (error) {
    blueprintLibraryDeleteUndo = previous;
    updateBlueprintLibraryHUD();
    reportBlueprintLibraryError("Deleted record could not be restored", error);
  }
}

function exportBlueprintLibrary(): string | void {
  try {
    const serialized = serializeBlueprintLibrary(blueprintLibrary);
    hud.showToast({
      title: "LIBRARY SHARE STRING READY",
      message:
        `${blueprintLibrary.entries.length} root records encoded; clipboard copy requested.`,
      tone: "success",
      duration: 2400,
    });
    return serialized;
  } catch (error) {
    reportBlueprintLibraryError("Library export failed", error);
  }
}

function importBlueprintLibrary(serialized: string): void {
  if (serialized.length === 0) {
    reportBlueprintLibraryError(
      "Library import failed",
      new Error("Paste a canonical blueprint library share string first."),
    );
    return;
  }
  try {
    const restored = restoreBlueprintLibrary(serialized);
    commitBlueprintLibrary(restored);
    blueprintLibraryDeleteUndo = null;
    updateBlueprintLibraryHUD();
    hud.showToast({
      title: "LIBRARY IMPORTED",
      message:
        `${restored.entries.length} root records replaced the local archive atomically.`,
      tone: "success",
      duration: 3000,
    });
  } catch (error) {
    reportBlueprintLibraryError("Library import rejected", error);
  }
}

function reportBlueprintLibraryError(
  title: string,
  error: unknown,
): void {
  const detail =
    error instanceof BlueprintLibraryOperationError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : "Unknown blueprint library error.";
  hud.showToast({
    title: title.toUpperCase(),
    message: detail,
    tone: "error",
    duration: 3800,
  });
}

type BlueprintDiagnosticAction = "construct" | "configure" | "match";

interface BlueprintPlacementDiagnostic {
  readonly placement: BlueprintPlacement;
  readonly action: BlueprintDiagnosticAction;
  readonly ok: boolean;
  readonly entityId?: number;
  readonly reason?: string;
}

function exactBlueprintEntity(
  placement: BlueprintPlacement,
): EntityState | null {
  const entity = simulation.getEntityAt(placement.x, placement.y);
  return entity &&
      entity.x === placement.x &&
      entity.y === placement.y &&
      entity.kind === placement.kind &&
      entity.direction === placement.direction
    ? entity
    : null;
}

function blueprintTargetRecipe(entity: EntityState): RecipeId | null {
  if (entity.kind !== "smelter" && entity.kind !== "fabricator") return null;
  return entity.recipeChangeQueued
    ? (entity.pendingRecipeId ?? null)
    : (entity.recipeId ?? null);
}

function blueprintRouting(
  placement: BlueprintPlacement,
): ManifoldRouting | null {
  const routing = placement.manifoldRouting;
  if (!routing) return null;
  return routing.filter === null
    ? {
        mode: routing.mode,
        extractPort: routing.extractPort,
      }
    : {
        mode: routing.mode,
        filter: routing.filter,
        extractPort: routing.extractPort,
      };
}

function blueprintConfigurationDiffers(
  entity: EntityState,
  placement: BlueprintPlacement,
): boolean {
  if (
    (entity.kind === "smelter" || entity.kind === "fabricator") &&
    blueprintTargetRecipe(entity) !== placement.recipeId
  ) {
    return true;
  }
  const routing = placement.manifoldRouting;
  if (!routing) return false;
  const current = entity.manifoldRouting;
  return (
    current?.mode !== routing.mode ||
    (current?.filter ?? null) !== routing.filter ||
    (current?.extractPort ?? 0) !== routing.extractPort
  );
}

function blueprintConfigurationConflict(
  entity: EntityState,
  placement: BlueprintPlacement,
): string | null {
  if (
    (entity.kind === "smelter" || entity.kind === "fabricator") &&
    blueprintTargetRecipe(entity) !== placement.recipeId &&
    placement.recipeId !== null &&
    !progression.unlockedRecipeIds.includes(placement.recipeId)
  ) {
    return `${RECIPES[placement.recipeId].name} is not unlocked`;
  }
  const routing = placement.manifoldRouting;
  if (routing?.mode !== "extract" || routing.filter === null) return null;
  const extractPort = routing.extractPort;
  const incompatiblePayload = entity.beltItems.some((item) => {
    if (item.port === undefined) return false;
    const expectedPort =
      item.item === routing.filter
        ? extractPort
        : extractPort === 0
          ? 1
          : 0;
    return item.port !== expectedPort;
  });
  return incompatiblePayload
    ? "Existing manifold payloads conflict with the captured Extract routing"
    : null;
}

function previewBlueprintPlacement(point: GridPoint): {
  readonly ok: boolean;
  readonly reason?: string;
  readonly cost: number;
  readonly conflictCount: number;
  readonly diagnostics: readonly BlueprintPlacementDiagnostic[];
  readonly plan: BlueprintPlacementPlan;
} {
  if (!blueprintClipboard || blueprintClipboard.entities.length === 0) {
    return {
      ok: false,
      reason: "Blueprint clipboard is empty",
      cost: 0,
      conflictCount: 0,
      diagnostics: [],
      plan: { width: 0, height: 0, placements: [] },
    };
  }
  const plan = planBlueprintPlacement(blueprintClipboard, {
    x: point.x,
    y: point.z,
  });
  let cost = 0;
  const diagnostics: BlueprintPlacementDiagnostic[] = [];
  for (const placement of plan.placements) {
    const kind = placement.kind as BuildKind;
    const matchingEntity = exactBlueprintEntity(placement);
    if (matchingEntity) {
      const conflict = blueprintConfigurationConflict(
        matchingEntity,
        placement,
      );
      const action = blueprintConfigurationDiffers(
          matchingEntity,
          placement,
        )
        ? "configure"
        : "match";
      diagnostics.push({
        placement,
        action,
        ok: conflict === null,
        entityId: matchingEntity.id,
        ...(conflict === null ? {} : { reason: conflict }),
      });
      continue;
    }
    cost += BUILD_COSTS[kind];
    if (!Number.isSafeInteger(cost)) {
      const reason = "Blueprint construction cost exceeds safe bounds";
      return {
        ok: false,
        reason,
        cost,
        conflictCount: plan.placements.length,
        diagnostics: plan.placements.map((candidate) => ({
          placement: candidate,
          action: "construct",
          ok: false,
          reason,
        })),
        plan,
      };
    }
    if (!progression.unlockedBuildKinds.includes(kind)) {
      diagnostics.push({
        placement,
        action: "construct",
        ok: false,
        reason: `${kind} is locked behind a Commission Uplink contract`,
      });
      continue;
    }
    if (
      placement.recipeId !== null &&
      !progression.unlockedRecipeIds.includes(placement.recipeId)
    ) {
      diagnostics.push({
        placement,
        action: "construct",
        ok: false,
        reason: `${RECIPES[placement.recipeId].name} is not unlocked`,
      });
      continue;
    }
    const placementCheck = simulation.canPlace(
      kind,
      placement.x,
      placement.y,
      placement.direction,
      placement.recipeId === null
        ? {}
        : { recipeId: placement.recipeId },
    );
    if (!placementCheck.ok) {
      diagnostics.push({
        placement,
        action: "construct",
        ok: false,
        reason: PLACEMENT_MESSAGES[placementCheck.reason],
      });
      continue;
    }
    const siteClearance = checkUplinkSiteClearance(
      simulation,
      uplinkEntityId,
      kind,
      placement.x,
      placement.y,
      placement.direction,
    );
    if (!siteClearance.ok) {
      diagnostics.push({
        placement,
        action: "construct",
        ok: false,
        reason: UPLINK_SITE_CLEARANCE_MESSAGE,
      });
      continue;
    }
    diagnostics.push({ placement, action: "construct", ok: true });
  }
  if (progression.alloy < cost) {
    const reason = `Requires ${cost} construction alloy`;
    const unaffordable = diagnostics.map((diagnostic) =>
      diagnostic.ok && diagnostic.action === "construct"
        ? {
            ...diagnostic,
            ok: false as const,
            reason,
          }
        : diagnostic,
    );
    return {
      ok: false,
      reason,
      cost,
      conflictCount: unaffordable.filter((entry) => !entry.ok).length,
      diagnostics: unaffordable,
      plan,
    };
  }
  const conflicts = diagnostics.filter((entry) => !entry.ok);
  return {
    ok: conflicts.length === 0,
    ...(conflicts[0]?.reason === undefined
      ? {}
      : { reason: conflicts[0].reason }),
    cost,
    conflictCount: conflicts.length,
    diagnostics,
    plan,
  };
}

function placeBlueprint(point: GridPoint): void {
  const preview = previewBlueprintPlacement(point);
  if (!preview.ok) {
    rejectPlacement(preview.reason ?? "Blueprint placement is invalid.");
    return;
  }
  const actionable = preview.diagnostics.filter(
    (diagnostic) => diagnostic.action !== "match",
  );
  if (actionable.length === 0) {
    audio.rotate(worldPan(point.x));
    hud.showToast({
      title: "PLAN ALREADY SATISFIED",
      message:
        `${preview.plan.placements.length} existing units match construction and configuration exactly.`,
      tone: "success",
      duration: 2400,
    });
    handleHover(point);
    return;
  }
  rememberUndo();
  const placedIds: number[] = [];
  const configuredIds: number[] = [];
  try {
    for (const diagnostic of preview.diagnostics) {
      const placement = diagnostic.placement;
      if (diagnostic.action === "match") continue;
      if (diagnostic.action === "configure") {
        const entityId = diagnostic.entityId;
        if (entityId === undefined) {
          throw new Error("Blueprint configuration target was lost.");
        }
        if (
          placement.kind === "smelter" ||
          placement.kind === "fabricator"
        ) {
          const result = simulation.requestRecipeChange(
            entityId,
            placement.recipeId,
          );
          if (!result.ok) {
            throw new Error(
              `Blueprint recipe configuration was rejected: ${result.reason}.`,
            );
          }
        }
        const routing = blueprintRouting(placement);
        if (routing && !simulation.setManifoldRouting(entityId, routing)) {
          throw new Error("Blueprint manifold routing was rejected.");
        }
        configuredIds.push(entityId);
        continue;
      }
      const kind = placement.kind as BuildKind;
      const siteClearance = checkUplinkSiteClearance(
        simulation,
        uplinkEntityId,
        kind,
        placement.x,
        placement.y,
        placement.direction,
      );
      if (!siteClearance.ok) {
        throw new Error("Blueprint entered the Commission Uplink site.");
      }
      const purchase = preflightPlacement(progression, kind);
      if (!purchase.ok) {
        throw new Error(`Blueprint purchase rejected: ${purchase.reason}.`);
      }
      const placed = simulation.place(
        kind,
        placement.x,
        placement.y,
        placement.direction,
        placement.recipeId === null
          ? {}
          : { recipeId: placement.recipeId },
      );
      if (!placed.ok) {
        throw new Error(`Blueprint placement rejected: ${placed.reason}.`);
      }
      const committed = commitPlacement(
        progression,
        purchase.authorization,
      );
      progression = committed.state;
      constructionProvenance.set(placed.entity.id, committed.provenance);
      const routing = blueprintRouting(placement);
      if (routing && !simulation.setManifoldRouting(placed.entity.id, routing)) {
        throw new Error("Blueprint manifold routing was rejected.");
      }
      placedIds.push(placed.entity.id);
    }
  } catch (error) {
    const rollback = undoStack.pop();
    if (rollback) applyAtomicSession(restoreAtomicSession(rollback));
    console.error("Blueprint transaction rolled back.", error);
    rejectPlacement("Blueprint construction could not be committed atomically.");
    return;
  }

  selectedEntityId = null;
  renderer.setSelected(null);
  audio.placed(
    worldPan(point.x),
    Math.min(1.4, 0.72 + (placedIds.length + configuredIds.length) * 0.04),
  );
  hud.showToast({
    title: "BLUEPRINT DEPLOYED",
    message:
      `${placedIds.length} built · ${configuredIds.length} configured · ${preview.cost} alloy · one-step undo armed`,
    tone: "success",
    duration: 3000,
  });
  handleHover(point);
  refreshHUD(true);
  saveSession();
}

function configureManifoldRouting(
  entityId: number,
  routing: ManifoldRouting,
): void {
  if (!Number.isSafeInteger(entityId)) return;
  const entity = simulation.getEntity(entityId);
  if (!entity || entity.kind !== "manifold") return;

  const current = entity.manifoldRouting;
  if (
    current?.mode === routing.mode &&
    current.filter === routing.filter &&
    current.extractPort === (routing.extractPort ?? 0)
  ) {
    return;
  }

  rememberUndo();
  if (!simulation.setManifoldRouting(entityId, routing)) {
    undoStack.pop();
    rejectPlacement("Dispatch routing command was rejected.");
    return;
  }

  selectedEntityId = entityId;
  audio.rotate(worldPan(entity.x));
  refreshHUD(false);
}

function configureMachineRecipe(
  entityId: number,
  recipeId: RecipeId | null,
): void {
  if (!Number.isSafeInteger(entityId)) return;
  if (
    recipeId !== null &&
    !progression.unlockedRecipeIds.includes(recipeId)
  ) {
    audio.error();
    hud.showToast({
      title: "RECIPE LOCKED",
      message: "Complete the required Commission Uplink contract first.",
      tone: "error",
      duration: 2500,
    });
    return;
  }
  const entity = simulation.getEntity(entityId);
  if (
    !entity ||
    (entity.kind !== "smelter" && entity.kind !== "fabricator")
  ) {
    audio.error();
    hud.showToast({
      title: "RECIPE REJECTED",
      message: "The selected unit cannot accept a process recipe.",
      tone: "error",
      duration: 2300,
    });
    return;
  }

  const activeName = entity.activeRecipeId
    ? RECIPES[entity.activeRecipeId].name
    : recipeTargetName(entity.recipeId ?? null);
  const targetName = recipeTargetName(recipeId);
  const pan = worldPan(entity.x);
  rememberUndo();
  const result = simulation.requestRecipeChange(entityId, recipeId);
  if (!result.ok) {
    undoStack.pop();
    audio.error(pan);
    const reasons = {
      notFound: "The selected unit no longer exists.",
      notMachine: "The selected unit cannot accept a process recipe.",
      invalidRecipe: "That process is incompatible with this machine.",
      requiresRecipe: "Fabricators require an explicit process recipe.",
    } as const;
    hud.showToast({
      title: "RECIPE REJECTED",
      message: reasons[result.reason],
      tone: "error",
      duration: 2300,
    });
    refreshHUD(false);
    return;
  }

  selectedEntityId = entityId;
  if (result.outcome === "unchanged") {
    undoStack.pop();
    audio.rotate(pan);
    hud.showToast({
      dedupeKey: `recipe-unchanged-${entityId}-${targetName}`,
      title: "RECIPE ALREADY TARGETED",
      message: `${targetName} is already the command target.`,
      duration: 1500,
    });
  } else if (result.outcome === "queued") {
    audio.rotate(pan);
    const previousToast = queuedRecipeToastIds.get(entityId);
    if (previousToast) hud.dismissToast(previousToast);
    const toastId = hud.showToast({
      id: `recipe-queued-${++recipeCommandSequence}`,
      title: "CHANGE QUEUED",
      message: `${activeName} will finish before ${targetName}; leftover input moves to RECLAIM.`,
      duration: 3600,
    });
    queuedRecipeToastIds.set(entityId, toastId);
  } else {
    const previousToast = queuedRecipeToastIds.get(entityId);
    if (previousToast) {
      hud.dismissToast(previousToast);
      queuedRecipeToastIds.delete(entityId);
    }
    audio.machineAccent(entity.kind, 0.45, pan);
    hud.showToast({
      title: "RECIPE ARMED",
      message: `${targetName} is now the configured process target.`,
      tone: "success",
      duration: 2200,
    });
  }
  refreshHUD(false);
}

function recipeTargetName(recipeId: RecipeId | null): string {
  return recipeId === null ? "Auto-smelt" : RECIPES[recipeId].name;
}

function selectEntity(entityId: number | null): void {
  closeRailAuthoringForModeSwitch();
  blueprintMode = null;
  blueprintCaptureAnchor = null;
  selectedBuild = null;
  lastBeltCell = null;
  selectedEntityId = entityId;
  blueprintRenderer.setBlueprintOverlay?.(null);
  blueprintRenderer.setBlueprintCaptureMarquee?.(null);
  renderer.setGhost(null, 0, 0, selectedDirection, true);
  renderer.setSelected(entityId);
  hud.update({
    selectedBuild: null,
    blueprint: null,
    inspector: createInspectorModel(
      entityId === null
        ? undefined
        : simulation
            .getRenderSnapshot()
            .entities.find((entity) => entity.id === entityId),
    ),
  });
}

function circuitEndpointLabel(point: CircuitConnectionPoint): string {
  const entity = simulation.getEntity(point.entityId);
  const unit = entity
    ? ENTITY_PROTOTYPES[entity.kind].name
    : "Missing unit";
  const connector =
    point.connector === "io"
      ? "I/O"
      : point.connector === "input"
        ? "Input"
        : "Output";
  return `${unit} ${String(point.entityId).padStart(3, "0")} · ${connector}`;
}

function createCircuitEditor(
  entity: RenderEntityState,
): HUDCircuitEditor | undefined {
  const bindings = circuitEndpointBindings(entity.id, entity.kind);
  if (bindings.length === 0) return undefined;

  const snapshot = simulation.circuitSnapshot();
  const endpointIds = new Set(
    bindings.map((binding) => binding.endpointId),
  );
  const endpoints = bindings.map((binding) => ({
    connector: binding.connector,
    label:
      binding.connector === "io"
        ? "Machine I/O"
        : binding.connector === "input"
          ? "Logic input"
          : "Logic output",
    signals: (
      simulation.readCircuitEndpoint({
        entityId: entity.id,
        connector: binding.connector,
      }) ?? []
    ).map((entry) => ({
      type: entry.signal.type,
      name: entry.signal.name,
      value: entry.value,
    })),
  }));
  const wires = snapshot.wires.flatMap((wire) => {
    if (
      !endpointIds.has(wire.endpointA) &&
      !endpointIds.has(wire.endpointB)
    ) {
      return [];
    }
    const first = circuitPointForEndpoint(snapshot, wire.endpointA);
    const second = circuitPointForEndpoint(snapshot, wire.endpointB);
    if (!first || !second) return [];
    return [{
      color: wire.color as CircuitWireColor,
      first,
      second,
      firstLabel: circuitEndpointLabel(first),
      secondLabel: circuitEndpointLabel(second),
    }];
  });

  let pending = pendingCircuitWire;
  if (
    pending &&
    !circuitEndpointBindings(
      pending.source.entityId,
      simulation.getEntity(pending.source.entityId)?.kind ?? "belt",
    ).some(
      (binding) => binding.connector === pending!.source.connector,
    )
  ) {
    pendingCircuitWire = null;
    pending = null;
  }

  const mode = isCircuitEntityKind(entity.kind)
    ? entity.kind === "constantCombinator"
      ? "constant"
      : entity.kind === "arithmeticCombinator"
        ? "arithmetic"
        : "decider"
    : "machine";
  return {
    entityId: entity.id,
    entityKind: entity.kind,
    mode,
    ...(isCircuitEntityKind(entity.kind)
      ? {
          device:
            circuitDeviceConfigurationFromSnapshot(snapshot, entity.id) ??
            undefined,
        }
      : {
          machine:
            circuitMachineConfigurationFromSnapshot(snapshot, entity.id) ??
            {},
          capabilities:
            circuitMachineCapabilities(entity.kind) ?? undefined,
          control:
            simulation.getCircuitMachineControl(entity.id) ?? undefined,
        }),
    endpoints,
    wires,
    ...(pending
      ? {
          pendingWire: {
            color: pending.color,
            source: pending.source,
            sourceLabel: circuitEndpointLabel(pending.source),
          },
        }
      : {}),
    signalOptions: {
      item: ITEM_IDS.map((id) => ({ id, label: ITEMS[id].name })),
      fluid: FLUID_IDS.map((id) => ({ id, label: FLUIDS[id].name })),
      virtual: CIRCUIT_VIRTUAL_SIGNAL_SUGGESTIONS.map((id) => ({
        id,
        label: id
          .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (letter) => letter.toUpperCase()),
      })),
    },
  };
}

function createInspectorModel(
  entity: RenderEntityState | undefined,
): HUDInspector | null {
  const base = toInspector(
    entity,
    progression.unlockedRecipeIds,
    simulation.stats().power.mode,
    simulation.circuitSnapshot(),
  );
  if (!base || !entity) return base;

  let inspector =
    entity.id === uplinkEntityId
      ? {
          ...base,
          name: "Commission Uplink",
          type: `MISSION DEPOT // UNIT ${String(entity.id).padStart(3, "0")}`,
          ...(() => {
            const reservation = resolveUplinkSiteReservation(
              simulation,
              uplinkEntityId,
            );
            const dockConnected = resolveConnectedUplinkDockBelt(
              simulation,
              uplinkEntityId,
            ) !== null;
            return {
              status: dockConnected
                ? "CARGO DOCK LINKED"
                : "CYAN DOCK OPEN",
              statusTone: (
                dockConnected ? "online" : "warning"
              ) as HUDInspector["statusTone"],
              stats: [
                ...(base.stats ?? []),
                ...(reservation
                  ? [
                      {
                        id: "uplink-dock-tile",
                        label: "CYAN DOCK TILE",
                        value: `X${reservation.dockTile.x} Z${reservation.dockTile.z}`,
                      },
                      {
                        id: "uplink-dock-flow",
                        label: "BELT FLOW",
                        value: DIRECTION_LABELS[reservation.direction],
                      },
                    ]
                  : []),
              ],
            };
          })(),
        }
      : base;
  const circuit = createCircuitEditor(entity);
  if (circuit) {
    inspector = {
      ...inspector,
      circuit,
    };
  }
  if (progression.mode === "campaign" && entity.kind === "generator") {
    const physicalCoalAvailable =
      accessibleCoalSources(entity.id).length > 0;
    const coalAvailable = simulation
      .getResources()
      .some((resource) => resource.type === "coal" && resource.amount > 0);
    const fuelFull = (entity.fuel.coal ?? 0) >= ITEMS.coal.stackSize;
    inspector = {
      ...inspector,
      actions: [
        {
          id: "hand-prime-coal",
          label: !physicalCoalAvailable && !coalAvailable
            ? "NO ACCESSIBLE COAL"
            : fuelFull
              ? "FUEL HOPPER FULL"
              : physicalCoalAvailable
                ? "HAND-TRANSFER + PRIME 1 COAL"
                : "HAND-MINE + PRIME 1 COAL",
          disabled:
            (!physicalCoalAvailable && !coalAvailable) || fuelFull,
        },
      ],
    };
  }
  return inspector;
}

function showCircuitError(title: string, message: string): void {
  audio.error(worldPan(hoveredCell?.x ?? cameraFocus.x));
  hud.showToast({
    title,
    message,
    tone: "error",
    duration: 2800,
  });
}

function commitCircuitMutation(
  entityId: number,
  mutation: () => boolean,
  successTitle: string,
  successMessage: string,
): boolean {
  const accepted = commitCircuitHistory(
    { undo: undoStack, redo: redoStack },
    snapshotSession,
    mutation,
  );
  if (!accepted) {
    showCircuitError(
      "CIRCUIT COMMAND REJECTED",
      "The authoritative circuit kernel rejected this command without changing the factory.",
    );
    refreshHUD(false);
    return false;
  }
  selectedEntityId = simulation.getEntity(entityId) ? entityId : selectedEntityId;
  renderer.setSelected(selectedEntityId);
  syncRenderer();
  refreshHUD(true);
  saveSession();
  audio.rotate(worldPan(simulation.getEntity(entityId)?.x ?? cameraFocus.x));
  hud.showToast({
    title: successTitle,
    message: successMessage,
    tone: "success",
    duration: 2400,
  });
  return true;
}

function configureCircuitDeviceFromHUD(
  entityId: number,
  draft: CircuitDeviceDraft,
): void {
  const entity = simulation.getEntity(entityId);
  if (!entity || !isCircuitEntityKind(entity.kind)) {
    showCircuitError(
      "PROGRAM UNAVAILABLE",
      "The selected combinator no longer exists.",
    );
    return;
  }
  const result = buildCircuitDeviceConfiguration(entity.kind, draft);
  if (!result.ok) {
    showCircuitError("PROGRAM REJECTED", result.error);
    return;
  }
  const snapshot = simulation.circuitSnapshot();
  const current = circuitDeviceConfigurationFromSnapshot(
    snapshot,
    entityId,
  );
  if (
    current &&
    circuitConfigurationKey(current) ===
      circuitConfigurationKey(result.value)
  ) {
    hud.showToast({
      title: "PROGRAM UNCHANGED",
      message: "The combinator already has this exact program.",
      duration: 1700,
    });
    return;
  }
  commitCircuitMutation(
    entityId,
    () => simulation.configureCircuitDevice(entityId, result.value),
    "PROGRAM APPLIED",
    `${ENTITY_PROTOTYPES[entity.kind].name} will publish the new program on the next fixed circuit tick.`,
  );
}

function configureCircuitMachineFromHUD(
  entityId: number,
  draft: CircuitMachineDraft,
): void {
  const entity = simulation.getEntity(entityId);
  if (!entity || !isCircuitMachineKind(entity.kind)) {
    showCircuitError(
      "CONTROL PORT UNAVAILABLE",
      "The selected unit no longer has a circuit machine port.",
    );
    return;
  }
  const result = buildCircuitMachineConfiguration(entity.kind, draft);
  if (!result.ok) {
    showCircuitError("CONTROL PROGRAM REJECTED", result.error);
    return;
  }
  const snapshot = simulation.circuitSnapshot();
  const current =
    circuitMachineConfigurationFromSnapshot(snapshot, entityId) ?? {};
  if (
    circuitConfigurationKey(current) ===
    circuitConfigurationKey(result.value)
  ) {
    hud.showToast({
      title: "CONTROLS UNCHANGED",
      message: "The machine port already has this exact control program.",
      duration: 1700,
    });
    return;
  }
  commitCircuitMutation(
    entityId,
    () => simulation.configureCircuitMachinePort(entityId, result.value),
    "MACHINE CONTROLS APPLIED",
    `${ENTITY_PROTOTYPES[entity.kind].name} now reads its enable, power, filter, and routing decisions from the authoritative circuit tick.`,
  );
}

function beginCircuitWire(
  color: CircuitWireColor,
  source: CircuitConnectionPoint,
): void {
  const entity = simulation.getEntity(source.entityId);
  const valid =
    entity &&
    circuitEndpointBindings(entity.id, entity.kind).some(
      (binding) => binding.connector === source.connector,
    );
  if (!valid) {
    showCircuitError(
      "SOURCE UNAVAILABLE",
      "Choose a visible connector on a circuit-capable unit.",
    );
    return;
  }
  blueprintMode = null;
  blueprintCaptureAnchor = null;
  selectedBuild = null;
  lastBeltCell = null;
  blueprintRenderer.setBlueprintOverlay?.(null);
  blueprintRenderer.setBlueprintCaptureMarquee?.(null);
  renderer.setGhost(null, 0, 0, selectedDirection, true);
  pendingCircuitWire = { color, source };
  selectEntity(source.entityId);
  hud.showToast({
    title: `${color.toUpperCase()} WIRE ARMED`,
    message:
      "Select a destination unit in the world, then choose its INPUT, OUTPUT, or I/O connector.",
    duration: 3200,
  });
}

function finishCircuitWire(target: CircuitConnectionPoint): void {
  const pending = pendingCircuitWire;
  if (!pending) {
    showCircuitError(
      "NO WIRE ARMED",
      "Choose Red or Green on a source connector first.",
    );
    return;
  }
  const snapshot = simulation.circuitSnapshot();
  const preflight = preflightCircuitWire(
    snapshot,
    pending.color,
    pending.source,
    target,
    (entityId) => {
      const entity = simulation.getEntity(entityId);
      return entity
        ? {
            x: entity.x + entity.width / 2,
            y: entity.y + entity.height / 2,
          }
        : null;
    },
  );
  if (!preflight.ok) {
    const messages = {
      "invalid-endpoint":
        "The source or destination connector no longer exists.",
      "same-endpoint":
        "A wire needs two different connectors. Choose another destination.",
      duplicate:
        "Those connectors already share a wire of this color.",
      "out-of-reach":
        "Circuit wire reach is 9 tiles. Choose a closer destination.",
    } as const;
    showCircuitError("WIRE NOT CONNECTED", messages[preflight.reason]);
    refreshHUD(false);
    return;
  }
  const source = pending.source;
  const color = pending.color;
  if (
    commitCircuitMutation(
      target.entityId,
      () => simulation.connectCircuitWire(color, source, target),
      `${color.toUpperCase()} WIRE CONNECTED`,
      `${circuitEndpointLabel(source)} ↔ ${circuitEndpointLabel(target)}.`,
    )
  ) {
    pendingCircuitWire = null;
    refreshHUD(true);
  }
}

function cancelCircuitWire(): void {
  if (!pendingCircuitWire) return;
  pendingCircuitWire = null;
  refreshHUD(false);
  hud.showToast({
    title: "WIRE AUTHORING CANCELED",
    message: "No circuit topology or history entry was changed.",
    duration: 1800,
  });
}

function removeCircuitWire(
  color: CircuitWireColor,
  first: CircuitConnectionPoint,
  second: CircuitConnectionPoint,
): void {
  const snapshot = simulation.circuitSnapshot();
  const firstId = snapshot.endpoints.find(
    (endpoint) =>
      endpoint.entityId === first.entityId &&
      endpoint.connector === first.connector,
  )?.endpointId;
  const secondId = snapshot.endpoints.find(
    (endpoint) =>
      endpoint.entityId === second.entityId &&
      endpoint.connector === second.connector,
  )?.endpointId;
  const exists =
    firstId &&
    secondId &&
    snapshot.wires.some(
      (wire) =>
        wire.color === color &&
        ((wire.endpointA === firstId && wire.endpointB === secondId) ||
          (wire.endpointA === secondId && wire.endpointB === firstId)),
    );
  if (!exists) {
    showCircuitError(
      "WIRE ALREADY ABSENT",
      "That circuit link no longer exists; history was not changed.",
    );
    return;
  }
  commitCircuitMutation(
    selectedEntityId ?? first.entityId,
    () => simulation.disconnectCircuitWire(color, first, second),
    `${color.toUpperCase()} WIRE REMOVED`,
    `${circuitEndpointLabel(first)} and ${circuitEndpointLabel(second)} are electrically isolated.`,
  );
}

function closeInspector(): void {
  pendingCircuitWire = null;
  selectEntity(null);
}

function handleInspectorAction(entityId: string, actionId: string): void {
  const numericId = Number(entityId);
  const generator = simulation.getEntity(numericId);
  if (
    actionId !== "hand-prime-coal" ||
    progression.mode !== "campaign" ||
    !Number.isSafeInteger(numericId) ||
    !generator ||
    generator.kind !== "generator"
  ) {
    rejectPlacement("This field action is unavailable for the selected unit.");
    return;
  }
  if ((generator.fuel.coal ?? 0) >= ITEMS.coal.stackSize) {
    rejectPlacement("The generator fuel hopper is already full.");
    return;
  }

  const physicalSource = accessibleCoalSources(generator.id)[0];
  const source = simulation
    .getResources()
    .filter((resource) => resource.type === "coal" && resource.amount > 0)
    .sort((left, right) => {
      const generatorX = generator.x + generator.width * 0.5;
      const generatorY = generator.y + generator.height * 0.5;
      const leftDistance =
        (left.x + 0.5 - generatorX) ** 2 +
        (left.y + 0.5 - generatorY) ** 2;
      const rightDistance =
        (right.x + 0.5 - generatorX) ** 2 +
        (right.y + 0.5 - generatorY) ** 2;
      return (
        leftDistance - rightDistance ||
        left.y - right.y ||
        left.x - right.x
      );
    })[0];
  if (!physicalSource && !source) {
    rejectPlacement(
      "No accessible factory coal or surveyed seam remains for emergency priming.",
    );
    return;
  }

  rememberUndo();
  try {
    const withdrawn = physicalSource
      ? simulation.withdrawAccessibleItem(physicalSource.id, "coal")
      : simulation.setResource(
          source!.x,
          source!.y,
          "coal",
          source!.amount - 1,
        );
    const accepted = withdrawn
      ? simulation.receive(generator.id, "coal", 1, "fuel")
      : 0;
    if (!withdrawn || accepted !== 1) {
      throw new Error("Generator rejected emergency coal.");
    }
  } catch (error) {
    const rollback = undoStack.pop();
    if (rollback) applyAtomicSession(restoreAtomicSession(rollback));
    console.warn("Emergency coal priming rolled back.", error);
    rejectPlacement("Emergency coal priming could not be completed atomically.");
    return;
  }

  audio.transfer("inserter", worldPan(generator.x), 0.62);
  hud.showToast({
    title: "BLACK-START FUEL PRIMED",
    message:
      physicalSource
        ? "Hand-transferred 1 coal from nearby factory custody and loaded the generator hopper."
        : "Hand-mined 1 coal from the nearest surveyed seam and loaded the generator hopper.",
    tone: "success",
    duration: 3200,
  });
  refreshHUD(true);
  saveSession();
}

function accessibleCoalSources(targetEntityId: number): EntityState[] {
  const target = simulation.getEntity(targetEntityId);
  if (!target) return [];
  const targetX = target.x + target.width * 0.5;
  const targetY = target.y + target.height * 0.5;
  return simulation
    .getEntities()
    .filter(
      (entity) =>
        entity.id !== targetEntityId &&
        accessibleItemCount(entity, "coal") > 0,
    )
    .sort((left, right) => {
      const leftDistance =
        (left.x + left.width * 0.5 - targetX) ** 2 +
        (left.y + left.height * 0.5 - targetY) ** 2;
      const rightDistance =
        (right.x + right.width * 0.5 - targetX) ** 2 +
        (right.y + right.height * 0.5 - targetY) ** 2;
      return leftDistance - rightDistance || left.id - right.id;
    });
}

function accessibleItemCount(entity: EntityState, item: keyof typeof ITEMS): number {
  const inventoryCount =
    (entity.inventory[item] ?? 0) +
    (entity.output[item] ?? 0) +
    (entity.reclaim[item] ?? 0) +
    (entity.input[item] ?? 0) +
    (entity.fuel[item] ?? 0);
  const beltCount = entity.beltItems.filter(
    (payload) => payload.item === item,
  ).length;
  const heldCount = entity.heldItem === item ? 1 : 0;
  return inventoryCount + beltCount + heldCount;
}

function removeSelectedEntity(): void {
  if (railConsoleOpen && selectedRailTarget) {
    dismantleSelectedRail();
    return;
  }
  if (selectedEntityId !== null) removeEntity(selectedEntityId);
  else cancelBuild();
}

function dismantleSelectedOrHovered(): void {
  if (railConsoleOpen) {
    if (!selectedRailTarget && hoveredRailTarget) {
      selectedRailTarget = hoveredRailTarget;
    }
    dismantleSelectedRail();
    return;
  }
  const selected =
    selectedEntityId === null
      ? undefined
      : simulation.getEntity(selectedEntityId);
  const hovered =
    selected === undefined && hoveredCell
      ? simulation.getEntityAt(hoveredCell.x, hoveredCell.z)
      : undefined;
  const target = selected ?? hovered;

  if (target) {
    removeEntity(target.id);
  } else if (selectedEntityId !== null) {
    // Clear a stale renderer/UI selection without manufacturing an undo entry.
    selectEntity(null);
  }
}

function removeEntity(entityId: number): void {
  const entity = simulation.getEntity(entityId);
  if (!entity) return;
  if (entityId === uplinkEntityId) {
    rejectPlacement("The Commission Uplink is mission-critical and cannot be dismantled.");
    return;
  }
  if (
    progression.mode === "campaign" &&
    entityId === coreGeneratorEntityId
  ) {
    rejectPlacement(
      "The bootstrap generator carries the colony's only hand-loaded fuel reserve and cannot be dismantled.",
    );
    return;
  }
  const provenance = constructionProvenance.get(entityId);
  if (!provenance) {
    rejectPlacement("Construction provenance is missing; dismantle was cancelled.");
    return;
  }
  rememberUndo();
  const removed = simulation.remove(entity.x, entity.y);
  if (!removed) {
    undoStack.pop();
    rejectPlacement("Dismantle command was rejected.");
    return;
  }
  const refunded = refundConstruction(progression, provenance);
  if (!refunded.ok) {
    const rollback = undoStack.pop();
    if (rollback) applyAtomicSession(restoreAtomicSession(rollback));
    rejectPlacement("Construction ledger rejected the recovery transaction.");
    return;
  }
  progression = refunded.state;
  constructionProvenance.delete(entityId);
  audio.removed(worldPan(entity.x), entity.kind === "belt" ? 0.55 : 1);
  selectEntity(null);
  hud.showToast({
    title: "UNIT DISMANTLED",
    message:
      refunded.refund > 0
        ? `Recovered ${refunded.refund} construction alloy.`
        : "Starter infrastructure removed; no alloy was credited.",
    tone: "success",
    duration: 1800,
  });
  refreshHUD(true);
}

function orientEntityAt(point: GridPoint, direction: Direction): void {
  const entity = simulation.getEntityAt(point.x, point.z);
  if (!entity || entity.kind !== "belt" || entity.direction === direction) return;
  let guard = 0;
  while (entity.direction !== direction && guard++ < 4) {
    const nextDirection = ((entity.direction + 1) % 4) as Direction;
    if (
      !checkUplinkSiteClearance(
        simulation,
        uplinkEntityId,
        entity.kind,
        entity.x,
        entity.y,
        nextDirection,
      ).ok
    ) {
      break;
    }
    const rotated = simulation.rotate(entity.x, entity.y, true);
    if (!rotated.ok) break;
    entity.direction = nextDirection;
  }
}

function directionBetween(from: GridPoint, to: GridPoint): Direction | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.abs(dx) > Math.abs(dz)) {
    return dx > 0 ? Direction.East : Direction.West;
  }
  if (dz !== 0) return dz > 0 ? Direction.South : Direction.North;
  return null;
}

function togglePause(): void {
  paused = !paused;
  hud.update({ paused });
  hud.showToast({
    title: paused ? "SIMULATION PAUSED" : "SIMULATION RESUMED",
    message: paused
      ? "Construction remains available while production is held."
      : "Deterministic production clock restored.",
    duration: 1600,
  });
}

function focusFactory(): void {
  const overviewWidth = simulation.railSnapshot() ? 28 : 38;
  cameraFocus = getFactoryCenter();
  renderer.focus(cameraFocus.x, cameraFocus.z);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const delta = clamp(
      Math.log(overviewWidth / cameraViewWidth) / 0.12,
      -4,
      4,
    );
    if (Math.abs(delta) < 0.01) break;
    renderer.zoom(delta);
    cameraViewWidth = clamp(
      cameraViewWidth * Math.exp(delta * 0.12),
      22,
      72,
    );
  }
  cameraViewWidth = overviewWidth;
}

function retrofitPowerGrid(): void {
  rememberUndo();
  const result = simulation.retrofitLocalPower();
  if (!result.ok) {
    undoStack.pop();
    audio.error();
    hud.showToast({
      title: "RETROFIT BLOCKED",
      message:
        `${result.uncoveredEntityIds.length} powered unit${
          result.uncoveredEntityIds.length === 1 ? "" : "s"
        } remain outside every relay's 11 × 11 supply square.`,
      tone: "error",
      duration: 4800,
    });
    return;
  }
  if (result.outcome === "alreadyLocal") {
    undoStack.pop();
    return;
  }
  audio.powerGrid(simulation.stats().power.satisfaction);
  hud.showToast({
    title: "LOCAL GRID RETROFIT COMPLETE",
    message:
      "Generators and consumers now dispatch only through their connected relay networks.",
    tone: "success",
    duration: 4600,
  });
  syncRenderer();
  refreshHUD(true);
  saveSession();
}

function chooseCommission(rawCommissionId: string): void {
  if (!COMMISSION_IDS.includes(rawCommissionId as CommissionId)) {
    rejectPlacement("Unknown Commission Uplink contract.");
    return;
  }
  rememberUndo();
  const result = selectCommission(
    progression,
    rawCommissionId as CommissionId,
  );
  if (!result.ok) {
    undoStack.pop();
    rejectPlacement(
      result.reason === "unavailable"
        ? "That contract's prerequisite shipment is incomplete."
        : "Commission selection is not available in this session.",
    );
    return;
  }
  if (!result.changed) {
    undoStack.pop();
    return;
  }
  progression = result.state;
  audio.rotate();
  hud.showToast({
    title: "CONTRACT TARGETED",
    message: `${commissionDefinition(rawCommissionId as CommissionId).title} is now receiving manifest priority.`,
    duration: 2200,
  });
  refreshHUD(false);
  saveSession();
}

function submitCommission(): void {
  rememberUndo();
  const result = completeSelectedCommission(
    progression,
    uplinkInventory,
    simulation.tickCount,
  );
  if (!result.ok) {
    undoStack.pop();
    const missing = result.missingItems
      .map(
        ({ item, required, available }) =>
          `${ITEMS[item].name} ${available}/${required}`,
      )
      .join(" · ");
    rejectPlacement(
      missing.length > 0
        ? `Manifest incomplete: ${missing}.`
        : "Select an available commission before transmitting.",
    );
    return;
  }
  progression = result.state;
  uplinkInventory = result.inventory;
  clearUplinkTransferVisuals();
  audio.complete(
    worldPan(simulation.getEntity(uplinkEntityId ?? -1)?.x ?? cameraFocus.x),
  );
  const unlocked = [
    ...result.event.unlockedBuildKinds.map((kind) => kind.toUpperCase()),
    ...result.event.unlockedRecipeIds.map(
      (recipeId) => RECIPES[recipeId].name,
    ),
  ];
  hud.showToast({
    title: "COMMISSION TRANSMITTED",
    message:
      `${commissionDefinition(result.event.commissionId).title} accepted · +${result.event.alloyAwarded} alloy` +
      (unlocked.length > 0 ? ` · Unlocked ${unlocked.join(", ")}` : ""),
    tone: "success",
    duration: 6200,
  });
  refreshHUD(true);
  saveSession();
}

function commissionDefinition(id: CommissionId) {
  const definition = COMMISSION_DEFINITIONS.find(
    (candidate) => candidate.id === id,
  );
  if (!definition) throw new Error(`Unknown commission ${id}.`);
  return definition;
}

function showHelp(): void {
  hud.setFieldManualOpen(true);
}

function undo(): void {
  const session = undoStack.pop();
  if (!session) {
    hud.showToast({
      title: "UNDO BUFFER EMPTY",
      message: "No recent construction command can be reversed.",
      tone: "error",
      duration: 1800,
    });
    return;
  }
  const selectedBeforeUndo = selectedEntityId;
  pendingCircuitWire = null;
  const redoSession = snapshotSession();
  const repeatBlueprintPaste =
    blueprintMode === "paste" &&
    blueprintClipboard !== null &&
    blueprintClipboard.entities.length > 0;
  try {
    applyAtomicSession(restoreAtomicSession(session));
  } catch (error) {
    undoStack.push(session);
    console.error("Undo snapshot could not be restored.", error);
    rejectPlacement("Undo snapshot failed integrity validation.");
    return;
  }
  redoStack.push(redoSession);
  if (redoStack.length > 20) redoStack.shift();
  if (repeatBlueprintPaste) {
    blueprintMode = "paste";
    blueprintCaptureAnchor = null;
    selectedBuild = null;
    selectedEntityId = null;
    lastBeltCell = null;
    renderer.setSelected(null);
    hud.update({ selectedBuild: null, inspector: null });
    if (hoveredCell) handleHover(hoveredCell);
  } else {
    selectEntity(
      selectedBeforeUndo !== null && simulation.getEntity(selectedBeforeUndo)
        ? selectedBeforeUndo
        : null,
    );
  }
  audio.rotate();
  hud.showToast({
    title: "COMMAND REVERSED",
    message: "The previous construction state has been restored · redo armed.",
    duration: 1700,
  });
  syncRenderer();
  refreshHUD(true);
  saveSession();
}

function redo(): void {
  const session = redoStack.pop();
  if (!session) {
    hud.showToast({
      title: "REDO BUFFER EMPTY",
      message: "No reversed construction command can be reapplied.",
      tone: "error",
      duration: 1800,
    });
    return;
  }
  const selectedBeforeRedo = selectedEntityId;
  pendingCircuitWire = null;
  const undoSession = snapshotSession();
  const repeatBlueprintPaste =
    blueprintMode === "paste" &&
    blueprintClipboard !== null &&
    blueprintClipboard.entities.length > 0;
  try {
    applyAtomicSession(restoreAtomicSession(session));
  } catch (error) {
    redoStack.push(session);
    console.error("Redo snapshot could not be restored.", error);
    rejectPlacement("Redo snapshot failed integrity validation.");
    return;
  }
  undoStack.push(undoSession);
  if (undoStack.length > 20) undoStack.shift();
  if (repeatBlueprintPaste) {
    blueprintMode = "paste";
    blueprintCaptureAnchor = null;
    selectedBuild = null;
    selectedEntityId = null;
    lastBeltCell = null;
    renderer.setSelected(null);
    hud.update({ selectedBuild: null, inspector: null });
    if (hoveredCell) handleHover(hoveredCell);
  } else {
    selectEntity(
      selectedBeforeRedo !== null && simulation.getEntity(selectedBeforeRedo)
        ? selectedBeforeRedo
        : null,
    );
  }
  audio.rotate();
  hud.showToast({
    title: "COMMAND REAPPLIED",
    message: "The reversed construction state has been restored.",
    tone: "success",
    duration: 1700,
  });
  syncRenderer();
  refreshHUD(true);
  saveSession();
}

function applyAtomicSession(session: LoadedSession): void {
  pendingCircuitWire = null;
  railConsoleOpen = false;
  selectedRailTool = null;
  selectedRailTarget = null;
  pendingRailSignalSourceId = null;
  hoveredRailTarget = null;
  renderer.getRailRendererIntegration().setAuthoringOverlay(null);
  sessionOrigin = session.origin;
  coreGeneratorEntityId = session.coreGeneratorEntityId;
  simulation = session.simulation;
  progression = session.progression;
  uplinkInventory = session.uplinkInventory;
  constructionProvenance = session.constructionProvenance;
  railConstruction = session.railConstruction;
  uplinkEntityId = session.uplinkEntityId;
  clearUplinkTransferVisuals();
}

function rememberUndo(): void {
  redoStack.length = 0;
  undoStack.push(snapshotSession());
  if (undoStack.length > 20) undoStack.shift();
}

function rejectPlacement(message: string): void {
  audio.error(worldPan(hoveredCell?.x ?? cameraFocus.x));
  hud.showToast({
    title: "PLACEMENT REJECTED",
    message,
    tone: "error",
    duration: 2200,
  });
}

function handleSimulationEvents(events: readonly SimulationEvent[]): void {
  for (const event of events) {
    if (event.type === "objectiveCompleted" && event.objectiveId) {
      if (progression.mode !== "legacySandbox") continue;
      if (previousObjectiveCompletion.has(event.objectiveId)) continue;
      previousObjectiveCompletion.add(event.objectiveId);
      if (event.item !== "automationCore") {
        audio.complete(worldPan(event.x ?? cameraFocus.x));
      }
      hud.showToast({
        title: "PROTOCOL MILESTONE",
        message: "Production objective complete. The next autonomy directive is unlocked.",
        tone: "success",
        duration: 4400,
      });
    } else if (event.type === "resourceDepleted") {
      hud.showToast({
        title: "SEAM EXHAUSTED",
        message: "An extractor has depleted its local mineral reserve.",
        tone: "error",
        duration: 2600,
      });
    } else if (event.type === "itemProduced" && event.entityId) {
      const entity = simulation.getEntity(event.entityId);
      if (!entity) continue;
      const pan = worldPan(entity.x);
      if (event.item === "automationCore") {
        audio.automationCore(pan);
      } else if (entity.kind === "extractor") {
        audio.extraction(pan);
      } else if (entity.kind === "smelter") {
        audio.smelter("complete", pan);
      } else if (entity.kind === "fabricator") {
        audio.fabricator("complete", pan);
      }
    } else if (event.type === "itemTransferred" && event.entityId) {
      if (
        progression.mode === "campaign" &&
        event.entityId === uplinkEntityId &&
        event.item &&
        event.amount
      ) {
        const withdrawn = simulation.withdrawStorage(
          event.entityId,
          event.item,
          event.amount,
        );
        if (withdrawn > 0) {
          uplinkInventory = addProgressionInventory(
            uplinkInventory,
            event.item,
            withdrawn,
          );
          queueUplinkTransferVisual(event.item);
          hud.showToast({
            dedupeKey: `uplink-cargo-${event.item}`,
            title: "UPLINK CARGO RECEIVED",
            message: `${ITEMS[event.item].name} +${withdrawn} secured for transmission.`,
            tone: "success",
            duration: 1500,
          });
        }
      }
      const target = simulation.getEntity(event.entityId);
      if (!target) continue;
      const pan = worldPan(target.x);
      if (target.kind === "belt") {
        audio.transfer("belt", pan);
      } else if (target.kind === "smelter") {
        audio.smelter("ignite", pan);
      } else if (target.kind === "fabricator") {
        audio.fabricator("arc", pan);
      } else {
        audio.transfer("inserter", pan);
      }
    } else if (event.type === "powerChanged") {
      audio.powerGrid(event.value ?? 1);
    }
  }
}

function refreshHUD(forceMinimap: boolean): void {
  const stats = simulation.stats();
  const snapshot = simulation.getRenderSnapshot();
  for (const [entityId, toastId] of queuedRecipeToastIds) {
    const entity = snapshot.entities.find(
      (candidate) => candidate.id === entityId,
    );
    if (entity?.recipeChangeQueued) continue;
    hud.dismissToast(toastId);
    queuedRecipeToastIds.delete(entityId);
  }
  const producedTotal = Object.values(stats.produced).reduce(
    (sum, value) => sum + value,
    0,
  );
  if (stats.elapsedSeconds - lastThroughputSample >= 1.5) {
    const sampleDuration = Math.max(0.001, stats.elapsedSeconds - lastThroughputSample);
    throughputPerMinute =
      ((producedTotal - lastProducedTotal) / sampleDuration) * 60;
    lastProducedTotal = producedTotal;
    lastThroughputSample = stats.elapsedSeconds;
  }

  const activeMachines = snapshot.entities.filter((entity) =>
    ["extractor", "smelter", "fabricator", "inserter"].includes(entity.kind),
  );
  const working = activeMachines.filter(
    (entity) => entity.status === "working",
  ).length;
  const efficiency =
    activeMachines.length === 0
      ? stats.power.satisfaction
      : (working / activeMachines.length) * 0.62 +
        stats.power.satisfaction * 0.38;

  const inspectorEntity =
    selectedEntityId === null
      ? undefined
      : snapshot.entities.find((entity) => entity.id === selectedEntityId);
  const inspector = createInspectorModel(inspectorEntity);

  const model: HUDModel = {
    factoryName: "CINDERLINE",
    sectorName: "AUTONOMOUS FRONTIER // KHEPRI-7",
    telemetry: {
      material: progression.alloy,
      materialLabel: "CONSTRUCTION ALLOY",
      powerGenerated:
        (stats.power.capacityKW - stats.power.disconnectedCapacityKW) / 1000,
      powerDemand: stats.power.demandKW / 1000,
      throughput: throughputPerMinute,
      efficiency,
    },
    mission:
      progression.mode === "campaign"
        ? campaignMission()
        : toMission(stats),
    selectedBuild,
    buildCosts: BUILD_COSTS,
    buildAvailability: Object.fromEntries(
      HUD_BUILD_ORDER.map((kind) => [
        kind,
        progression.unlockedBuildKinds.includes(kind),
      ]),
    ),
    buildAffordability: Object.fromEntries(
      HUD_BUILD_ORDER.map((kind) => [
        kind,
        progression.alloy >= BUILD_COSTS[kind],
      ]),
    ),
    buildStatus: Object.fromEntries(
      HUD_BUILD_ORDER.map((kind) => {
        if (!progression.unlockedBuildKinds.includes(kind)) {
          const commission = COMMISSION_DEFINITIONS.find((definition) =>
            definition.reward.buildKinds.includes(kind)
          );
          return [
            kind,
            commission
              ? `Complete ${commission.title}`
              : "Campaign locked",
          ];
        }
        const missing = Math.max(
          0,
          BUILD_COSTS[kind] - progression.alloy,
        );
        return [
          kind,
          missing > 0 ? `Need ${missing} alloy` : "Ready",
        ];
      }),
    ),
    inspector,
    coordinates: {
      x: hoveredCell?.x ?? Math.round(cameraFocus.x),
      z: hoveredCell?.z ?? Math.round(cameraFocus.z),
    },
    paused,
    powerMode: stats.power.mode,
    session: createSessionHUD(),
    blueprint: createBlueprintHUD(hoveredCell),
    railAuthoring: createRailAuthoringHUD(),
  };

  if (forceMinimap || elapsedReal >= nextHUDRefresh - 0.02) {
    model.minimap = {
      bounds: { minX: 0, minZ: 0, maxX: snapshot.width, maxZ: snapshot.height },
      resources: toHUDMapResources(snapshot),
      entities: toHUDMapEntities(
        snapshot,
        selectedEntityId,
        uplinkEntityId,
      ),
      view: {
        x: cameraFocus.x,
        z: cameraFocus.z,
        heading: 0,
        width: cameraViewWidth,
        depth:
          cameraViewWidth *
          (canvas!.clientHeight / Math.max(1, canvas!.clientWidth)),
      },
    };
  }
  hud.update(model);
}

function campaignMission(): NonNullable<HUDModel["mission"]> {
  const available = new Set(availableCommissionIds(progression));
  const selected = progression.selectedCommissionId;
  const definition =
    selected === null ? undefined : commissionDefinition(selected);
  const progressById = new Map(
    progression.commissions.map((entry) => [entry.id, entry]),
  );
  const objectives = (definition?.requirements ?? []).map((requirement) => {
    const current = progressionInventoryCount(
      uplinkInventory,
      requirement.item,
    );
    return {
      id: `commission-${definition!.id}-${requirement.item}`,
      label: ITEMS[requirement.item].name,
      current,
      target: requirement.amount,
      complete: current >= requirement.amount,
    };
  });
  const selectedIndex =
    selected === null ? -1 : COMMISSION_IDS.indexOf(selected);
  return {
    chapter: "COMMISSION UPLINK",
    code:
      selectedIndex < 0
        ? "SELECT CONTRACT"
        : `CONTRACT ${selectedIndex + 1} / ${COMMISSION_IDS.length}`,
    title: definition?.title ?? "Awaiting commission",
    description: commissionGuidance({
      commissionId: definition?.id ?? null,
      objectiveCurrent: objectives.map((objective) => objective.current),
      objectiveTargets: objectives.map((objective) => objective.target),
      completedCommissionIds: progression.commissions
        .filter((entry) => entry.completionCount > 0)
        .map((entry) => entry.id),
    }),
    objectives,
    complete: false,
    commissions: COMMISSION_DEFINITIONS.map((candidate) => {
      const completions =
        progressById.get(candidate.id)?.completionCount ?? 0;
      return {
        id: candidate.id,
        label:
          candidate.repeatable && completions > 0
            ? `${candidate.title} ×${completions}`
            : candidate.title,
        available: available.has(candidate.id),
        selected: candidate.id === selected,
        complete: !candidate.repeatable && completions > 0,
      };
    }),
    canSubmit:
      definition !== undefined &&
      objectives.length > 0 &&
      objectives.every((objective) => objective.complete),
  };
}

function getFactoryCenter(): { x: number; z: number } {
  const entities = simulation.getEntities();
  const renderSnapshot = simulation.getRenderSnapshot();
  const rail = simulation.railSnapshot();
  if (entities.length === 0 && !rail) {
    return {
      x: renderSnapshot.width / 2,
      z: renderSnapshot.height / 2,
    };
  }
  const bounds = entities.reduce(
    (box, entity) => ({
      minX: Math.min(box.minX, entity.x),
      maxX: Math.max(box.maxX, entity.x + entity.width),
      minZ: Math.min(box.minZ, entity.y),
      maxZ: Math.max(box.maxZ, entity.y + entity.height),
    }),
    {
      minX: Infinity,
      maxX: -Infinity,
      minZ: Infinity,
      maxZ: -Infinity,
    },
  );
  for (const segment of rail?.graph.nodes ?? []) {
    bounds.minX = Math.min(bounds.minX, segment.x);
    bounds.maxX = Math.max(bounds.maxX, segment.x + 1);
    bounds.minZ = Math.min(bounds.minZ, segment.y);
    bounds.maxZ = Math.max(bounds.maxZ, segment.y + 1);
  }
  if (!Number.isFinite(bounds.minX)) {
    return {
      x: renderSnapshot.width / 2,
      z: renderSnapshot.height / 2,
    };
  }
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    // The normal HUD reserves the lower and upper corners. A modest
    // rail-aware southward bias keeps the complete train and service stop in
    // the unobstructed playable band on untouched campaign load.
    z: Math.min(
      renderSnapshot.height - 3,
      (bounds.minZ + bounds.maxZ) / 2 + (rail ? 1 : 0),
    ),
  };
}

function worldPan(worldX: number): number {
  return clamp((worldX - cameraFocus.x) / Math.max(12, cameraViewWidth * 0.5), -1, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function railHoverPerformance(): Record<
  RailHoverContext,
  {
    readonly samples: number;
    readonly p95Milliseconds: number;
    readonly p99Milliseconds: number;
    readonly maximumMilliseconds: number;
  }
> {
  return Object.fromEntries(
    (["general", "station", "train"] as const).map((context) => {
      const sorted = railHoverDurations[context]
        .slice()
        .sort((left, right) => left - right);
      const percentile = (value: number) =>
        sorted.length === 0
          ? 0
          : sorted[
              Math.min(
                sorted.length - 1,
                Math.floor(sorted.length * value),
              )
            ]!;
      return [
        context,
        {
          samples: sorted.length,
          p95Milliseconds: percentile(0.95),
          p99Milliseconds: percentile(0.99),
          maximumMilliseconds: sorted.at(-1) ?? 0,
        },
      ];
    }),
  ) as ReturnType<typeof railHoverPerformance>;
}

// Deliberate QA hook: read-only helpers plus safe, scoped reset.
Object.assign(window, {
  __CINDERLINE__: {
    get simulation(): FactorySimulation {
      return simulation;
    },
    get alloy(): number {
      return progression.alloy;
    },
    get progression(): ProgressionState {
      return progression;
    },
    get uplinkInventory(): ProgressionInventory {
      return uplinkInventory;
    },
    get uplinkEntityId(): number | null {
      return uplinkEntityId;
    },
    get coreGeneratorEntityId(): number | null {
      return coreGeneratorEntityId;
    },
    get blueprint(): {
      mode: typeof blueprintMode;
      captureAnchor: GridPoint | null;
      clipboard: Blueprint | null;
    } {
      return {
        mode: blueprintMode,
        captureAnchor: blueprintCaptureAnchor
          ? { ...blueprintCaptureAnchor }
          : null,
        clipboard: blueprintClipboard,
      };
    },
    get blueprintLibrary(): BlueprintLibrary {
      return blueprintLibrary;
    },
    renderer,
    audio,
    stats: (): SimulationStats => simulation.stats(),
    snapshot: () => simulation.getRenderSnapshot(),
    constructionLedger: () =>
      [...constructionProvenance.entries()]
        .sort(([left], [right]) => left - right)
        .map(([entityId, provenance]) => ({
          entityId,
          provenance: JSON.parse(
            JSON.stringify(provenance),
          ) as ConstructionProvenance,
        })),
    circuitAuthoringState: () => ({
      undoDepth: undoStack.length,
      redoDepth: redoStack.length,
      pendingWire: pendingCircuitWire
        ? {
            color: pendingCircuitWire.color,
            source: { ...pendingCircuitWire.source },
          }
        : null,
    }),
    railAuthoringState: () => ({
      open: railConsoleOpen,
      selectedTool: selectedRailTool,
      selectedTarget: selectedRailTarget
        ? { ...selectedRailTarget }
        : null,
      sourceSegmentId: pendingRailSignalSourceId,
      rotation: railAuthoringRotation,
      status: railAuthoringStatus,
      undoDepth: undoStack.length,
      redoDepth: redoStack.length,
      ledger: JSON.parse(JSON.stringify(railConstruction)) as RailAuthoringState,
      network: simulation.railSnapshot(),
      stationInterfaces: simulation.railStationInterfacesSnapshot(),
      serializationCount: simulation.serializationCount(),
    }),
    railHoverPerformance,
    refreshHUD: () => refreshHUD(false),
    selectEntity: (entityId: number | null) => selectEntity(entityId),
    previewBlueprint: (x: number, z: number) =>
      previewBlueprintPlacement({ x, z }),
    uplinkSiteClearance: () =>
      resolveUplinkSiteReservation(simulation, uplinkEntityId),
    advanceUplinkShowcase: (seconds: number) =>
      advanceUplinkShowcase(seconds),
    probeUplinkPlacement: (
      kind: BuildKind,
      x: number,
      z: number,
      direction: Direction = Direction.East,
    ) => {
      const simulationCheck = simulation.canPlace(
        kind,
        x,
        z,
        direction,
        playerPlacementOptions(kind),
      );
      const siteCheck = checkUplinkSiteClearance(
        simulation,
        uplinkEntityId,
        kind,
        x,
        z,
        direction,
      );
      return {
        simulationCheck,
        siteCheck,
        directPlacementOk: simulationCheck.ok && siteCheck.ok,
        blueprintPreflightOk: simulationCheck.ok && siteCheck.ok,
      };
    },
    dismissToasts: () => {
      for (const toast of hudRoot.querySelectorAll<HTMLElement>(
        "[data-toast-id]",
      )) {
        const id = toast.dataset.toastId;
        if (id) hud.dismissToast(id);
      }
    },
    fresh: () => {
      safeStorageRemove(SAVE_KEY);
      safeStorageRemove(PREVIOUS_SESSION_KEY);
      safeStorageRemove(PREVIOUS_V4_SESSION_KEY);
      safeStorageRemove(LEGACY_SESSION_KEY);
      safeStorageRemove(LEGACY_SAVE_KEY);
      safeStorageRemove(RESET_BACKUP_KEY);
      safeStorageRemove(BLUEPRINT_CLIPBOARD_KEY);
      safeStorageRemove(LEGACY_BLUEPRINT_CLIPBOARD_KEY);
      safeStorageRemove(BLUEPRINT_LIBRARY_KEY);
      safeStorageRemove(LEGACY_BLUEPRINT_LIBRARY_KEY);
      location.reload();
    },
  },
});

declare global {
  interface Window {
    __CINDERLINE__?: {
      readonly simulation: FactorySimulation;
      readonly alloy: number;
      readonly progression: ProgressionState;
      readonly uplinkInventory: ProgressionInventory;
      readonly uplinkEntityId: number | null;
      readonly coreGeneratorEntityId: number | null;
      readonly blueprint: {
        mode: "capture" | "paste" | null;
        captureAnchor: GridPoint | null;
        clipboard: Blueprint | null;
      };
      readonly blueprintLibrary: BlueprintLibrary;
      readonly renderer: WorldRenderer;
      readonly audio: AudioEngine;
      stats(): SimulationStats;
      snapshot(): ReturnType<FactorySimulation["getRenderSnapshot"]>;
      constructionLedger(): readonly {
        readonly entityId: number;
        readonly provenance: ConstructionProvenance;
      }[];
      circuitAuthoringState(): {
        readonly undoDepth: number;
        readonly redoDepth: number;
        readonly pendingWire: PendingCircuitWire | null;
      };
      railAuthoringState(): {
        readonly open: boolean;
        readonly selectedTool: RailBuildKind | null;
        readonly selectedTarget: RailPickTarget | null;
        readonly sourceSegmentId: string | null;
        readonly rotation: 0 | 1 | 2 | 3;
        readonly status: string;
        readonly undoDepth: number;
        readonly redoDepth: number;
        readonly ledger: RailAuthoringState;
        readonly network: ReturnType<FactorySimulation["railSnapshot"]>;
        readonly stationInterfaces: readonly RailStationStorageInterface[];
        readonly serializationCount: number;
      };
      railHoverPerformance(): ReturnType<typeof railHoverPerformance>;
      refreshHUD(): void;
      selectEntity(entityId: number | null): void;
      previewBlueprint(
        x: number,
        z: number,
      ): ReturnType<typeof previewBlueprintPlacement>;
      uplinkSiteClearance(): UplinkSiteReservation | null;
      advanceUplinkShowcase(
        seconds: number,
      ): ReturnType<typeof advanceUplinkShowcase>;
      probeUplinkPlacement(
        kind: BuildKind,
        x: number,
        z: number,
        direction?: Direction,
      ): {
        readonly simulationCheck: ReturnType<FactorySimulation["canPlace"]>;
        readonly siteCheck: ReturnType<typeof checkUplinkSiteClearance>;
        readonly directPlacementOk: boolean;
        readonly blueprintPreflightOk: boolean;
      };
      dismissToasts(): void;
      fresh(): void;
    };
  }
}
