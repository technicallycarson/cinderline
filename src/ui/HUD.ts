import type {
  CircuitConnectionPoint,
  CircuitDeviceConfiguration,
  CircuitMachinePortConfiguration,
  CircuitWireColor,
  EntityKind,
  ItemId,
  ManifoldMode,
  ManifoldRouting,
  RecipeId,
} from "../game/types";
import type {
  CircuitCondition,
  CircuitMachineControl,
  CircuitOperand,
  CircuitSelector,
  CircuitSignal,
  CircuitSignalType,
} from "../game/circuit-network";
import type { CircuitMachineCapabilities } from "../game/circuit-integration";
import type {
  RailScheduleStop,
  RailWaitCondition,
} from "../game/rail-network";
import {
  RAIL_BUILD_KINDS,
  type RailBuildKind,
} from "../game/railAuthoring";
import {
  CIRCUIT_ARITHMETIC_OPERATORS,
  CIRCUIT_COMPARISON_OPERATORS,
  type CircuitConditionDraft,
  type CircuitDeviceDraft,
  type CircuitMachineDraft,
  type CircuitOperandDraft,
  type CircuitSelectorDraft,
} from "../game/circuitAuthoring";
import { MOBILE_POWER_RELAY_GUIDANCE } from "./m1Session";

export type BuildKind = EntityKind;
export type BuildCategory = "factory" | "fluids" | "signals";

/** The 1–9,0 dock/hotkey order displayed by the HUD. */
export const HUD_PRIMARY_BUILD_ORDER: readonly BuildKind[] = [
  "belt",
  "extractor",
  "inserter",
  "smelter",
  "fabricator",
  "generator",
  "storage",
  "beacon",
  "manifold",
  "gridRelay",
] as const;

/** Shift+1–8 order for advanced construction without displacing 1–9,0. */
export const HUD_ADVANCED_BUILD_ORDER: readonly BuildKind[] = [
  "fluidSource",
  "fluidPump",
  "fluidPipe",
  "fluidTank",
  "fluidProcessor",
  "constantCombinator",
  "arithmeticCombinator",
  "deciderCombinator",
] as const;

/** Complete player construction order, kept independent of blueprint formats. */
export const HUD_BUILD_ORDER: readonly BuildKind[] = [
  ...HUD_PRIMARY_BUILD_ORDER,
  ...HUD_ADVANCED_BUILD_ORDER,
] as const;

export interface HUDTelemetry {
  /** Spendable construction material. */
  material?: number;
  materialLabel?: string;
  /** Current supply and demand in megawatts. */
  powerGenerated?: number;
  powerDemand?: number;
  /** Items produced per minute. */
  throughput?: number;
  /** Factory efficiency, expressed from 0–1 or 0–100. */
  efficiency?: number;
}

export interface HUDObjective {
  id: string;
  label: string;
  current: number;
  target: number;
  complete?: boolean;
}

export interface HUDMission {
  chapter?: string;
  code?: string;
  title: string;
  description?: string;
  objectives: readonly HUDObjective[];
  complete?: boolean;
  commissions?: readonly HUDCommissionOption[];
  canSubmit?: boolean;
}

export interface HUDCommissionOption {
  id: string;
  label: string;
  available: boolean;
  selected: boolean;
  complete?: boolean;
}

export interface HUDInspectorStat {
  id?: string;
  label: string;
  value: string | number;
  unit?: string;
}

export interface HUDManifoldFilterOption {
  id: ItemId;
  label: string;
}

export interface HUDManifoldRouting {
  mode: ManifoldMode;
  filter?: ItemId;
  extractPort: 0 | 1;
  filterOptions: readonly HUDManifoldFilterOption[];
  portCounts: readonly [number, number];
  splitCursors: readonly [0 | 1, 0 | 1];
  mergeCursors: readonly [0 | 1, 0 | 1];
}

export interface HUDItemQuantity {
  id: ItemId;
  label: string;
  amount: number;
  color: string;
}

export interface HUDRecipeFormula {
  id: RecipeId;
  durationSeconds: number;
  ingredients: readonly HUDItemQuantity[];
  products: readonly HUDItemQuantity[];
}

export interface HUDRecipeOption {
  /** `null` is the smelter-only Auto-smelt target. */
  recipeId: RecipeId | null;
  label: string;
  icon: string;
  formulas: readonly HUDRecipeFormula[];
  configured: boolean;
  active: boolean;
  pending: boolean;
  /** Pending target while queued; otherwise the configured target. */
  targeted: boolean;
}

export interface HUDBuffer {
  items: readonly HUDItemQuantity[];
  usedSlots: number;
  /** Undefined for source-only reclaim. */
  capacitySlots?: number;
}

export interface HUDProcessChamber {
  recipeId: RecipeId;
  label: string;
  committedInputs: readonly HUDItemQuantity[];
  projectedOutputs: readonly HUDItemQuantity[];
  progress: number;
}

export interface HUDProcessTarget {
  mode: "auto" | "recipe";
  recipeId?: RecipeId;
}

export interface HUDMachineProcess {
  entityId: string;
  kind: "smelter" | "fabricator";
  state:
    | "unconfigured"
    | "starved"
    | "working"
    | "queued"
    | "output-blocked"
    | "no-power"
    | "idle";
  configured: HUDProcessTarget | null;
  active: HUDProcessChamber | null;
  pending: HUDProcessTarget | null;
  recipes: readonly HUDRecipeOption[];
  buffers: {
    input: HUDBuffer;
    output: HUDBuffer;
    reclaim: HUDBuffer;
  };
  timing: {
    progress: number;
    baseSeconds: number | null;
    effectiveSeconds: number | null;
    remainingSeconds: number | null;
  };
  power: {
    demandKW: number;
    satisfaction: number;
  };
  speed: {
    base: number;
    beaconMultiplier: number;
    effective: number;
  };
  condition: {
    tone: "online" | "warning" | "error" | "offline";
    text: string;
  };
}

export interface HUDCircuitEndpoint {
  readonly connector: CircuitConnectionPoint["connector"];
  readonly label: string;
  readonly signals: readonly {
    readonly type: CircuitSignalType;
    readonly name: string;
    readonly value: number;
  }[];
}

export interface HUDCircuitWire {
  readonly color: CircuitWireColor;
  readonly first: CircuitConnectionPoint;
  readonly second: CircuitConnectionPoint;
  readonly firstLabel: string;
  readonly secondLabel: string;
}

export interface HUDCircuitEditor {
  readonly entityId: number;
  readonly entityKind: EntityKind;
  readonly mode: "constant" | "arithmetic" | "decider" | "machine";
  readonly device?: CircuitDeviceConfiguration;
  readonly machine?: CircuitMachinePortConfiguration;
  readonly capabilities?: CircuitMachineCapabilities;
  readonly control?: CircuitMachineControl;
  readonly endpoints: readonly HUDCircuitEndpoint[];
  readonly wires: readonly HUDCircuitWire[];
  readonly pendingWire?: {
    readonly color: CircuitWireColor;
    readonly source: CircuitConnectionPoint;
    readonly sourceLabel: string;
  };
  readonly signalOptions: {
    readonly item: readonly { readonly id: string; readonly label: string }[];
    readonly fluid: readonly { readonly id: string; readonly label: string }[];
    readonly virtual: readonly { readonly id: string; readonly label: string }[];
  };
}

export interface HUDInspector {
  id?: string;
  name: string;
  type?: string;
  status?: string;
  statusTone?: "online" | "warning" | "error" | "offline";
  stats?: readonly HUDInspectorStat[];
  recipe?: {
    icon?: string;
    label: string;
    detail?: string;
  };
  manifoldRouting?: HUDManifoldRouting;
  machineProcess?: HUDMachineProcess;
  circuit?: HUDCircuitEditor;
  actions?: readonly HUDInspectorAction[];
}

export interface HUDInspectorAction {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface HUDMapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface HUDMapResource {
  x: number;
  z: number;
  kind?: string;
  amount?: number;
  radius?: number;
  color?: string;
}

export interface HUDMapEntity {
  x: number;
  z: number;
  kind: string;
  rotation?: number;
  active?: boolean;
  selected?: boolean;
  color?: string;
}

export interface HUDMapView {
  x: number;
  z: number;
  heading?: number;
  width?: number;
  depth?: number;
}

export interface HUDMinimap {
  bounds: HUDMapBounds;
  resources?: readonly HUDMapResource[];
  entities?: readonly HUDMapEntity[];
  view?: HUDMapView;
}

export interface HUDToast {
  id?: string;
  /** Groups semantically equivalent notices into one visible toast. */
  dedupeKey?: string;
  title?: string;
  message: string;
  tone?: "info" | "success" | "error";
  duration?: number;
}

export interface HUDSession {
  state: "new" | "continued" | "recovered" | "saved" | "volatile";
  label: string;
  detail: string;
  canSave: boolean;
  canRestoreBackup: boolean;
}

export function hudToastDedupeKey(toast: HUDToast): string {
  const normalize = (value: string): string =>
    value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  if (toast.dedupeKey !== undefined) return normalize(toast.dedupeKey);
  if (toast.id !== undefined) return normalize(toast.id);
  return `${normalize(toast.title ?? "")}\u001f${normalize(toast.message)}`;
}

export interface HUDBlueprint {
  mode: "capture" | "paste";
  units: number;
  width: number;
  height: number;
  cost: number;
  availableAlloy: number;
  transform: string;
  valid: boolean;
  conflictCount: number;
  constructionCount?: number;
  configurationCount?: number;
  matchCount?: number;
  status: string;
}

export interface HUDBlueprintLibraryEntry {
  id: string;
  kind: "blueprint" | "book";
  name: string;
  description: string;
  depth: number;
  selected: boolean;
  units: number;
  width: number;
  height: number;
  icons: readonly string[];
  preview: readonly {
    x: number;
    z: number;
    width: number;
    height: number;
    kind: BuildKind;
    /** Cardinal Direction enum value; optional for older HUD publishers. */
    direction?: number;
    /** Captured construction configuration used by semantic miniatures. */
    recipeId?: RecipeId | null;
    manifoldMode?: ManifoldMode | null;
    manifoldFilter?: ItemId | null;
  }[];
}

export interface HUDBlueprintLibrary {
  open: boolean;
  entries: readonly HUDBlueprintLibraryEntry[];
  selectedId: string | null;
  clipboardAvailable: boolean;
  clipboardUnits: number;
  clipboardWidth: number;
  clipboardHeight: number;
  canRestoreDelete: boolean;
  canUpdate: boolean;
  canReassign: boolean;
  canDuplicate: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export interface HUDRailTool {
  readonly kind: RailBuildKind;
  readonly label: string;
  readonly key: string;
  readonly cost: number;
  readonly available: boolean;
  readonly affordable: boolean;
  readonly status: string;
}

export interface HUDRailSelection {
  readonly kind: "segment" | "signal" | "station" | "train" | "car";
  readonly id: string;
  readonly parentTrainId?: string;
  readonly label: string;
  readonly detail: string;
  readonly dismantleBlockers: readonly string[];
}

export interface HUDRailStationEditor {
  readonly stationId: string;
  readonly segmentId: string;
  readonly storageEntityId: number | null;
  readonly storageOptions: readonly {
    readonly entityId: number;
    readonly label: string;
  }[];
  readonly mode: "load" | "unload" | "both";
  readonly transferRate: number;
  /** `null` is intentionally distinct from an invalid empty selection. */
  readonly itemFilter: readonly ItemId[] | null;
  readonly itemOptions: readonly {
    readonly id: ItemId;
    readonly label: string;
  }[];
}

export interface HUDRailTrainEditor {
  readonly trainId: string;
  readonly status: string;
  readonly cars: readonly {
    readonly id: string;
    readonly kind: "locomotive" | "cargo-wagon";
    readonly label: string;
    readonly fuelMilli: number;
    readonly cargoUnits: number;
    readonly selected: boolean;
    readonly removable: boolean;
    readonly removeReason: string;
    readonly fuelable: boolean;
    readonly fuelReason: string;
  }[];
  readonly schedule: readonly RailScheduleStop[];
  readonly stationOptions: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly itemOptions: readonly {
    readonly id: ItemId;
    readonly label: string;
  }[];
  readonly canEditConsist: boolean;
  readonly consistStatus: string;
}

export interface HUDRailAuthoring {
  readonly open: boolean;
  readonly unlocked: boolean;
  readonly networkConfigured: boolean;
  readonly alloy: number;
  readonly selectedTool: RailBuildKind | null;
  readonly rotation: 0 | 1 | 2 | 3;
  readonly status: string;
  /** Ephemeral pointer validation; never participates in editor identity. */
  readonly previewStatus?: string | null;
  /** A mutually exclusive mode owns focus; do not restore the rail opener. */
  readonly suppressReturnFocus?: boolean;
  readonly sourceSegmentId: string | null;
  readonly tools: readonly HUDRailTool[];
  readonly selected: HUDRailSelection | null;
  readonly stationEditor?: HUDRailStationEditor;
  readonly trainEditor?: HUDRailTrainEditor;
}

/**
 * A deliberately portable read model. Every property is optional so a
 * simulation can publish small patches instead of allocating a complete HUD
 * snapshot every frame.
 */
export interface HUDModel {
  factoryName?: string;
  sectorName?: string;
  telemetry?: HUDTelemetry;
  mission?: HUDMission;
  selectedBuild?: BuildKind | null;
  buildCosts?: Partial<Record<BuildKind, number>>;
  /** Whether campaign progression has unlocked each construction unit. */
  buildAvailability?: Partial<Record<BuildKind, boolean>>;
  /** Whether the current construction stock can pay for each unlocked unit. */
  buildAffordability?: Partial<Record<BuildKind, boolean>>;
  /** Player-facing availability reason shown on cards and tooltips. */
  buildStatus?: Partial<Record<BuildKind, string>>;
  inspector?: HUDInspector | null;
  coordinates?: { x: number; z: number };
  minimap?: HUDMinimap;
  paused?: boolean;
  muted?: boolean;
  powerMode?: "local" | "legacyGlobal";
  blueprint?: HUDBlueprint | null;
  blueprintLibrary?: HUDBlueprintLibrary;
  railAuthoring?: HUDRailAuthoring;
  session?: HUDSession;
  toasts?: readonly HUDToast[];
}

export interface HUDCallbacks {
  onBuildSelect?: (kind: BuildKind) => void;
  onRotate?: () => void;
  onRemove?: () => void;
  onCancel?: () => void;
  onPauseToggle?: () => void;
  onMuteToggle?: () => void;
  onFocus?: () => void;
  onSessionSave?: () => void;
  onSessionReset?: () => void;
  onSessionRestore?: () => void;
  onPowerRetrofit?: () => void;
  onCommissionSelect?: (commissionId: string) => void;
  onCommissionSubmit?: () => void;
  onInspectorAction?: (entityId: string, actionId: string) => void;
  onHelp?: () => void;
  onInspectorClose?: () => void;
  onManifoldRoutingChange?: (
    entityId: string,
    routing: ManifoldRouting,
  ) => void;
  onRecipeChange?: (
    entityId: string,
    recipeId: RecipeId | null,
  ) => void;
  onCircuitDeviceConfigure?: (
    entityId: number,
    draft: CircuitDeviceDraft,
  ) => void;
  onCircuitMachineConfigure?: (
    entityId: number,
    draft: CircuitMachineDraft,
  ) => void;
  onCircuitWireStart?: (
    color: CircuitWireColor,
    source: CircuitConnectionPoint,
  ) => void;
  onCircuitWireFinish?: (target: CircuitConnectionPoint) => void;
  onCircuitWireCancel?: () => void;
  onCircuitWireDisconnect?: (
    color: CircuitWireColor,
    first: CircuitConnectionPoint,
    second: CircuitConnectionPoint,
  ) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onBlueprintMirror?: (axis: "horizontal" | "vertical") => void;
  onBlueprintLibraryToggle?: () => void;
  onBlueprintLibrarySave?: (name: string) => void;
  onBlueprintLibraryCreateBook?: (name: string) => void;
  onBlueprintLibrarySelect?: (id: string) => void;
  onBlueprintLibraryLoad?: () => void;
  onBlueprintLibraryUpdate?: (name: string) => void;
  onBlueprintLibraryReassign?: () => void;
  onBlueprintLibraryDuplicate?: () => void;
  onBlueprintLibraryMove?: (direction: "up" | "down") => void;
  onBlueprintLibraryDelete?: () => void;
  onBlueprintLibraryRestoreDelete?: () => void;
  onBlueprintLibraryExport?: () => string | void;
  onBlueprintLibraryImport?: (serialized: string) => void;
  onRailToggle?: () => void;
  onRailToolSelect?: (kind: RailBuildKind) => void;
  onRailRotate?: () => void;
  onRailCancel?: () => void;
  onRailDismantle?: () => void;
  onRailStationApply?: (
    stationId: string,
    draft: {
      readonly storageEntityId: number | null;
      readonly mode: "load" | "unload" | "both";
      readonly transferRate: number;
      readonly itemFilter: readonly ItemId[] | null;
    },
  ) => void;
  onRailScheduleApply?: (
    trainId: string,
    schedule: readonly RailScheduleStop[],
  ) => void;
  onRailConsistAdd?: (
    trainId: string,
    kind: "locomotive" | "cargo-wagon",
  ) => void;
  onRailCarRemove?: (trainId: string, carId: string) => void;
  onRailLocomotiveFuel?: (trainId: string, carId: string) => void;
}

export interface HUDOptions {
  /**
   * Opt-in keyboard bindings for standalone use. Keep disabled when the host
   * application already owns a global input router.
   */
  bindHotkeys?: boolean;
}

interface BuildDefinition {
  kind: BuildKind;
  name: string;
  key: string;
  cost: number;
  color: string;
  description: string;
  svg: string;
}

interface BuildCategoryDefinition {
  id: BuildCategory;
  label: string;
  shortLabel: string;
}

const BUILD_CATEGORIES: readonly BuildCategoryDefinition[] = [
  { id: "factory", label: "Factory machinery", shortLabel: "Factory" },
  { id: "fluids", label: "Fluid network", shortLabel: "Fluids" },
  { id: "signals", label: "Circuit signals", shortLabel: "Signals" },
] as const;

function buildCategoryForKind(kind: BuildKind): BuildCategory {
  if (
    kind === "fluidSource" ||
    kind === "fluidPump" ||
    kind === "fluidPipe" ||
    kind === "fluidTank" ||
    kind === "fluidProcessor"
  ) {
    return "fluids";
  }
  if (
    kind === "constantCombinator" ||
    kind === "arithmeticCombinator" ||
    kind === "deciderCombinator"
  ) {
    return "signals";
  }
  return "factory";
}

const BUILD_DEFINITIONS: readonly BuildDefinition[] = [
  {
    kind: "belt",
    name: "Belt",
    key: "1",
    cost: 2,
    color: "#73f2d2",
    description: "Moves resources continuously along its facing direction.",
    svg:
      '<svg viewBox="0 0 34 30" aria-hidden="true"><path d="M3 8h24l4 7-4 7H3z"/><circle cx="8" cy="15" r="2.5"/><circle cx="18" cy="15" r="2.5"/><path d="m21 11 5 4-5 4"/></svg>',
  },
  {
    kind: "extractor",
    name: "Extractor",
    key: "2",
    cost: 15,
    color: "#f5b84b",
    description: "Drills a resource seam and sends raw ore to an output port.",
    svg:
      '<svg viewBox="0 0 34 30" aria-hidden="true"><path d="M7 23h20M10 23V12l7-5 7 5v11M14 23v-8h6v8"/><path d="m17 4 3 5-3 4-3-4zM4 26h26"/></svg>',
  },
  {
    kind: "inserter",
    name: "Inserter",
    key: "3",
    cost: 8,
    color: "#e98b4b",
    description: "Transfers individual items between adjacent machines and belts.",
    svg:
      '<svg viewBox="0 0 34 30" aria-hidden="true"><circle cx="10" cy="23" r="4"/><path d="M10 19 15 9l8-2 3 5-7 4-3-3-3 8"/><path d="m25 11 3-1M24 8l2-3"/></svg>',
  },
  {
    kind: "smelter",
    name: "Smelter",
    key: "4",
    cost: 30,
    color: "#ef6f43",
    description: "Refines raw ore into construction-grade metal plate.",
    svg:
      '<svg viewBox="0 0 34 30" aria-hidden="true"><path d="M6 26h22L26 8H8zM8 8h18l-3-4H11z"/><path d="M13 22c-2-5 4-6 3-11 5 4 6 7 3 11-1 2-5 2-6 0z"/></svg>',
  },
  {
    kind: "fabricator",
    name: "Fabricator",
    key: "5",
    cost: 50,
    color: "#b58af3",
    description: "Assembles refined components into advanced automation parts.",
    svg:
      '<svg viewBox="0 0 34 30" aria-hidden="true"><path d="M5 7h24v18H5zM8 4h18v3M9 25v3m16-3v3"/><circle cx="17" cy="16" r="5"/><path d="M17 8v3m0 10v3m-8-8h3m10 0h3m-14-6 2 2m8 8 2 2m0-12-2 2m-8 8-2 2"/></svg>',
  },
  {
    kind: "generator",
    name: "Generator",
    key: "6",
    cost: 40,
    color: "#8ee18b",
    description: "Burns coal to feed the local relay network covering it.",
    svg:
      '<svg viewBox="0 0 34 30" aria-hidden="true"><circle cx="17" cy="15" r="11"/><circle cx="17" cy="15" r="3"/><path d="M17 4c4 4 4 7 0 8M7 20c5-1 7 0 8 4m12-4c-5-1-7 0-8 4"/><path d="m18 8-4 7h4l-2 7 5-8h-4z"/></svg>',
  },
  {
    kind: "storage",
    name: "Storage",
    key: "7",
    cost: 20,
    color: "#6fc7ee",
    description: "Buffers resources and balances intermittent production lines.",
    svg:
      '<svg viewBox="0 0 34 30" aria-hidden="true"><path d="m5 9 12-6 12 6v14l-12 5L5 23z"/><path d="m5 9 12 6 12-6M17 15v13M11 6l12 6"/></svg>',
  },
  {
    kind: "beacon",
    name: "Beacon",
    key: "8",
    cost: 75,
    color: "#f0d877",
    description: "Broadcasts an efficiency field to surrounding machinery.",
    svg:
      '<svg viewBox="0 0 34 30" aria-hidden="true"><path d="M17 11v15M11 27h12M14 11h6l-3-8z"/><path d="M10 7a10 10 0 0 0 0 12m14-12a10 10 0 0 1 0 12M7 4a15 15 0 0 0 0 18m20-18a15 15 0 0 1 0 18"/></svg>',
  },
  {
    kind: "manifold",
    name: "Manifold",
    key: "9",
    cost: 18,
    color: "#f0a934",
    description:
      "Splits, merges, prioritizes, or extracts physical belt payloads across local A/B ports.",
    svg:
      '<svg viewBox="0 0 34 30" aria-hidden="true"><path d="M3 15h9m10-7h9m-9 14h9M12 15h4c4 0 4-7 8-7m-12 7h4c4 0 4 7 8 7"/><path d="m27 5 4 3-4 3m0 8 4 3-4 3"/><rect x="12" y="10" width="10" height="10" rx="2"/></svg>',
  },
  {
    kind: "gridRelay",
    name: "Grid relay",
    key: "0",
    cost: 12,
    color: "#75e6ff",
    description:
      "Links generators and powered machines inside a five-tile local supply square.",
    svg:
      '<svg viewBox="0 0 34 30" aria-hidden="true"><path d="M17 4v21M10 26h14M12 9h10M11 14h12"/><circle cx="17" cy="9" r="3"/><path d="M5 8c3-4 6-5 9-5m15 5c-3-4-6-5-9-5M6 18c3 3 6 4 9 4m13-4c-3 3-6 4-9 4"/><path d="m18 11-4 6h4l-2 6 5-8h-4z"/></svg>',
  },
  {
    kind: "fluidSource",
    name: "Oil well",
    key: "⇧1",
    cost: 32,
    color: "#d9844f",
    description: "Produces crude oil for a connected fluid network.",
    svg:
      '<svg viewBox="0 0 34 30" aria-hidden="true"><path d="M6 25h22M10 25V11h14v14M13 11l4-7 4 7"/><path d="M8 17h18M17 11v14"/><path d="M24 6c4 4 4 7 0 9-4-2-4-5 0-9z"/></svg>',
  },
  {
    kind: "fluidPump",
    name: "Pump",
    key: "⇧2",
    cost: 14,
    color: "#69c8b0",
    description: "Drives fluid forward through the network in its facing direction.",
    svg:
      '<svg viewBox="0 0 34 30" aria-hidden="true"><circle cx="17" cy="15" r="8"/><path d="M2 15h7m16 0h7M17 7v16"/><path d="m13 11 8 4-8 4z"/></svg>',
  },
  {
    kind: "fluidPipe",
    name: "Pipe",
    key: "⇧3",
    cost: 3,
    color: "#86a9a0",
    description: "Carries fluid between adjacent fluid machines.",
    svg:
      '<svg viewBox="0 0 34 30" aria-hidden="true"><path d="M2 11h30v8H2zM8 9v12m18-12v12"/><circle cx="17" cy="15" r="2.5"/></svg>',
  },
  {
    kind: "fluidTank",
    name: "Tank",
    key: "⇧4",
    cost: 36,
    color: "#d2c580",
    description: "Stores fluid and smooths changing network demand.",
    svg:
      '<svg viewBox="0 0 34 30" aria-hidden="true"><ellipse cx="17" cy="7" rx="9" ry="4"/><path d="M8 7v16c0 2 4 4 9 4s9-2 9-4V7M8 16c0 2 4 4 9 4s9-2 9-4"/><path d="M14 3V1h6v2"/></svg>',
  },
  {
    kind: "fluidProcessor",
    name: "Refinery",
    key: "⇧5",
    cost: 64,
    color: "#e18450",
    description: "Refines crude oil into processed fuel for the fluid network.",
    svg:
      '<svg viewBox="0 0 34 30" aria-hidden="true"><path d="M4 26h26M7 26V10h10v16m3 0V5h7v21M9 10V6h6v4"/><path d="M10 16h4m-4 5h4m12-11h4M23 5l2-3 2 3"/><path d="M17 14h3"/></svg>',
  },
  {
    kind: "constantCombinator",
    name: "Constant",
    key: "⇧6",
    cost: 10,
    color: "#e1e87a",
    description: "Publishes a constant signal into a connected circuit network.",
    svg:
      '<svg viewBox="0 0 34 30" aria-hidden="true"><rect x="5" y="5" width="24" height="20" rx="3"/><path d="M10 11h14M10 16h8M10 21h11"/><circle cx="25" cy="20" r="2"/></svg>',
  },
  {
    kind: "arithmeticCombinator",
    name: "Arithmetic",
    key: "⇧7",
    cost: 16,
    color: "#f0aa61",
    description: "Performs an arithmetic operation on circuit signals.",
    svg:
      '<svg viewBox="0 0 34 30" aria-hidden="true"><path d="M4 15h7m12 0h7"/><rect x="10" y="5" width="14" height="20" rx="3"/><path d="M17 9v5m-3-2.5h6M13 18h8m-8 4h8"/></svg>',
  },
  {
    kind: "deciderCombinator",
    name: "Decider",
    key: "⇧8",
    cost: 18,
    color: "#70dfd9",
    description: "Compares circuit signals and conditionally publishes an output.",
    svg:
      '<svg viewBox="0 0 34 30" aria-hidden="true"><path d="M4 15h7m12 0h7"/><path d="m17 5 8 10-8 10-8-10z"/><path d="m14 13 3-3 3 3m-6 4 3 3 3-3"/></svg>',
  },
] as const;

const STATUS_COLORS: Readonly<Record<NonNullable<HUDInspector["statusTone"]>, string>> = {
  online: "#8ee18b",
  warning: "#f5b84b",
  error: "#ff6b55",
  offline: "#73817f",
};

const ENTITY_COLORS: Readonly<Record<string, string>> = {
  belt: "#55aa9e",
  manifold: "#df9a36",
  extractor: "#e2a745",
  inserter: "#db7945",
  smelter: "#d85b3d",
  fabricator: "#9872ce",
  generator: "#78c87b",
  storage: "#62abd0",
  beacon: "#d9c05e",
  gridRelay: "#63d8eb",
  fluidSource: "#b86f42",
  fluidPump: "#6bb8a7",
  fluidPipe: "#789a91",
  fluidTank: "#b9ad78",
  fluidProcessor: "#d37a4b",
  constantCombinator: "#d9dc73",
  arithmeticCombinator: "#f0a45a",
  deciderCombinator: "#69d8d3",
};

const ITEM_PICTOGRAMS: Readonly<Record<ItemId, string>> = {
  ironOre:
    '<path d="m4 9 4-5 7-1 5 4-1 8-6 5-8-3z"/><path d="m8 4 3 6 8-3M5 17l6-7 2 10"/>',
  copperOre:
    '<path d="m3 11 4-6 6 2 2 6-4 6-6-1z"/><path d="m13 5 5-2 3 4-2 5-4 1"/><circle cx="8" cy="11" r="1.5"/><circle cx="17.5" cy="7.5" r="1"/>',
  coal:
    '<path d="m3 10 4-6 8-2 6 6-2 9-8 4-7-5z"/><path d="m7 4 5 5 3-7m-3 7 7-1m-7 1-1 12"/>',
  stone:
    '<path d="M4 7 10 3h7l4 6-2 9-8 3-7-5z"/><path d="m4 7 7 5 10-3m-10 3v9m0-9 6-9"/>',
  ironPlate:
    '<path d="M4 7h14l2 3v9H6l-2-3z"/><path d="m4 7 2 3h14M8 14h8"/><circle cx="8" cy="14" r=".8"/><circle cx="16" cy="14" r=".8"/>',
  copperPlate:
    '<path d="M5 5h14v13H5z"/><path d="M8 2h13v13h-2M8 9h8m-8 4h5"/>',
  stoneBrick:
    '<path d="M3 5h18v14H3zM3 12h18M9 5v7m6 0v7M6 12v7m12-14v7"/>',
  ironGear:
    '<circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8 3 3m0-14-3 3M8 16l-3 3"/>',
  copperWire:
    '<path d="M7 5h10v14H7zM4 7h3m10 0h3M4 17h3m10 0h3"/><path d="M8 8h8M8 11h8M8 14h8M8 17h8"/>',
  circuit:
    '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M8 8h4v4h4m-8 4h3m5-8v3m-4 5h4"/><circle cx="8" cy="8" r="1"/><circle cx="16" cy="12" r="1"/><circle cx="12" cy="16" r="1"/><path d="M1 8h3m-3 4h3m-3 4h3m16-8h3m-3 4h3m-3 4h3"/>',
  automationCore:
    '<path d="m12 2 8 5v10l-8 5-8-5V7z"/><circle cx="12" cy="12" r="4"/><path d="M12 5v3m0 8v3M5 12h3m8 0h3"/><circle cx="12" cy="12" r="1.2"/>',
};

const AUTO_SMELT_PICTOGRAM =
  '<path d="M6 19c-3-5 3-7 3-12 3 2 4 4 3 7 2-1 3-3 3-6 5 5 5 10 1 13-3 2-8 1-10-2z"/><path d="M3 4h5L6 2m15 18h-5l2 2"/>';

const RECIPE_OUTPUT_PICTOGRAM: Readonly<Record<RecipeId, ItemId>> = {
  smeltIron: "ironPlate",
  smeltCopper: "copperPlate",
  fireBrick: "stoneBrick",
  ironGear: "ironGear",
  copperWire: "copperWire",
  circuit: "circuit",
  automationCore: "automationCore",
};

function formatInteger(value: number | undefined): string {
  return Math.max(0, Math.round(value ?? 0)).toLocaleString("en-US");
}

function formatDecimal(value: number | undefined, digits = 1): string {
  return Number.isFinite(value) ? (value ?? 0).toFixed(digits) : "0.0";
}

function normaliseEfficiency(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  const numeric = value ?? 0;
  return Math.min(100, Math.max(0, numeric <= 1 ? numeric * 100 : numeric));
}

function escapeSelector(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

function escapeMarkup(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function circuitLabel(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const LIBRARY_SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const LIBRARY_ITEM_COLORS: Readonly<Partial<Record<ItemId, string>>> = {
  ironOre: "#9ba8a6",
  copperOre: "#b96d47",
  coal: "#697171",
  stone: "#a28d70",
  ironPlate: "#c1cecb",
  copperPlate: "#e18a54",
  stoneBrick: "#c28d67",
  ironGear: "#aebcba",
  copperWire: "#e2a15a",
  circuit: "#6bc477",
  automationCore: "#b38bed",
};
const LIBRARY_ITEM_LABELS: Readonly<Partial<Record<ItemId, string>>> = {
  ironPlate: "Iron plate",
  copperPlate: "Copper plate",
  stoneBrick: "Fire brick",
  ironGear: "Iron gear",
  copperWire: "Copper wire",
  circuit: "Circuit",
  automationCore: "Automation core",
};
const LIBRARY_POWER_CONSUMERS = new Set<BuildKind>([
  "extractor",
  "inserter",
  "smelter",
  "fabricator",
  "beacon",
  "manifold",
]);

function librarySemanticKinds(
  cells: HUDBlueprintLibraryEntry["preview"],
  limit: number,
): BuildKind[] {
  const present = new Set(cells.map((cell) => cell.kind));
  const priority: readonly BuildKind[] = present.has("generator")
    ? [
        "generator",
        "gridRelay",
        "fabricator",
        "storage",
        "manifold",
        "smelter",
        "inserter",
        "belt",
        "beacon",
        "extractor",
      ]
    : [
        "extractor",
        "manifold",
        "smelter",
        "fabricator",
        "storage",
        "belt",
        "inserter",
        "gridRelay",
        "beacon",
        "generator",
      ];
  return priority.filter((kind) => present.has(kind)).slice(0, limit);
}

function buildDefinitionSvgInner(kind: BuildKind): string {
  const markup =
    BUILD_DEFINITIONS.find((definition) => definition.kind === kind)?.svg ?? "";
  const start = markup.indexOf(">");
  const end = markup.lastIndexOf("</svg>");
  return start >= 0 && end > start ? markup.slice(start + 1, end) : "";
}

function librarySvgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, string | number>> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(LIBRARY_SVG_NAMESPACE, tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  return element;
}

function appendBlueprintMechanicalDetail(
  group: SVGGElement,
  cell: HUDBlueprintLibraryEntry["preview"][number],
): void {
  const detail = librarySvgElement("g", {
    class: `blueprint-library-mechanical-detail is-${cell.kind}`,
  });
  const centerX = cell.x + cell.width / 2;
  const centerY = cell.z + cell.height / 2;
  const minimum = Math.min(cell.width, cell.height);
  const addPath = (d: string, className = ""): void => {
    detail.append(
      librarySvgElement("path", {
        d,
        class: className,
      }),
    );
  };
  const addCircle = (
    cx: number,
    cy: number,
    r: number,
    className = "",
  ): void => {
    detail.append(
      librarySvgElement("circle", {
        cx,
        cy,
        r,
        class: className,
      }),
    );
  };

  if (cell.kind === "smelter") {
    detail.append(
      librarySvgElement("rect", {
        x: cell.x + cell.width * 0.25,
        y: cell.z + cell.height * 0.27,
        width: cell.width * 0.5,
        height: cell.height * 0.46,
        rx: minimum * 0.12,
        class: "is-chamber",
      }),
    );
    for (const offset of [-0.14, 0, 0.14]) {
      addPath(
        `M ${centerX + cell.width * offset} ${
          cell.z + cell.height * 0.33
        } V ${cell.z + cell.height * 0.67}`,
        "is-vent",
      );
    }
  } else if (cell.kind === "fabricator") {
    addCircle(centerX, centerY, minimum * 0.25, "is-bearing");
    addCircle(centerX, centerY, minimum * 0.12, "is-bearing-core");
    addPath(
      `M ${centerX - minimum * 0.34} ${centerY} H ${
        centerX + minimum * 0.34
      } M ${centerX} ${centerY - minimum * 0.34} V ${
        centerY + minimum * 0.34
      }`,
      "is-spindle",
    );
  } else if (cell.kind === "generator") {
    addCircle(centerX, centerY, minimum * 0.3, "is-turbine");
    addCircle(centerX, centerY, minimum * 0.1, "is-bearing-core");
    for (const [x, y] of [
      [0.24, 0],
      [-0.24, 0],
      [0, 0.24],
      [0, -0.24],
    ] as const) {
      addPath(
        `M ${centerX + x * minimum * 0.35} ${
          centerY + y * minimum * 0.35
        } L ${centerX + x * minimum} ${centerY + y * minimum}`,
        "is-turbine-blade",
      );
    }
  } else if (cell.kind === "storage") {
    addPath(
      `M ${cell.x + cell.width * 0.2} ${
        cell.z + cell.height * 0.37
      } H ${cell.x + cell.width * 0.8} M ${
        cell.x + cell.width * 0.2
      } ${cell.z + cell.height * 0.63} H ${
        cell.x + cell.width * 0.8
      } M ${centerX} ${cell.z + cell.height * 0.2} V ${
        cell.z + cell.height * 0.8
      }`,
      "is-crate-band",
    );
    addPath(
      `M ${centerX - cell.width * 0.12} ${
        cell.z + cell.height * 0.22
      } Q ${centerX} ${cell.z + cell.height * 0.12} ${
        centerX + cell.width * 0.12
      } ${cell.z + cell.height * 0.22}`,
      "is-handle",
    );
  } else if (cell.kind === "manifold") {
    addPath(
      `M ${cell.x + cell.width * 0.16} ${centerY} H ${centerX} M ${
        centerX
      } ${centerY} L ${cell.x + cell.width * 0.84} ${
        cell.z + cell.height * 0.27
      } M ${centerX} ${centerY} L ${
        cell.x + cell.width * 0.84
      } ${cell.z + cell.height * 0.73}`,
      "is-routing-channel",
    );
    addCircle(centerX, centerY, minimum * 0.1, "is-valve");
  } else if (cell.kind === "gridRelay" || cell.kind === "beacon") {
    addCircle(centerX, centerY, minimum * 0.28, "is-field-ring");
    addCircle(centerX, centerY, minimum * 0.14, "is-field-core");
    addPath(
      `M ${centerX - minimum * 0.38} ${centerY} H ${
        centerX + minimum * 0.38
      } M ${centerX} ${centerY - minimum * 0.38} V ${
        centerY + minimum * 0.38
      }`,
      "is-field-cross",
    );
  } else if (cell.kind === "extractor") {
    addCircle(
      cell.x + cell.width * 0.36,
      centerY,
      minimum * 0.16,
      "is-drill-bearing",
    );
    addPath(
      `M ${cell.x + cell.width * 0.42} ${centerY} L ${
        cell.x + cell.width * 0.75
      } ${cell.z + cell.height * 0.28} L ${
        cell.x + cell.width * 0.69
      } ${cell.z + cell.height * 0.72} Z`,
      "is-drill-head",
    );
  } else if (cell.kind === "inserter") {
    addCircle(centerX, centerY, minimum * 0.2, "is-bearing");
    addCircle(centerX, centerY, minimum * 0.075, "is-bearing-core");
  }

  if (cell.kind !== "belt") {
    addPath(
      `M ${cell.x + cell.width * 0.18} ${
        cell.z + cell.height * 0.19
      } L ${cell.x + cell.width * 0.31} ${
        cell.z + cell.height * 0.16
      }`,
      "blueprint-library-material-band",
    );
    for (const [x, y] of [
      [0.29, 0.76],
      [0.57, 0.21],
      [0.73, 0.67],
    ] as const) {
      addCircle(
        cell.x + cell.width * x,
        cell.z + cell.height * y,
        Math.min(0.03, minimum * 0.022),
        "blueprint-library-unit-patina",
      );
    }
  }

  if (detail.childElementCount > 0) group.append(detail);
}

/**
 * Render a topology-first miniature instead of reducing a blueprint to colored
 * bars. The compact HUD read model does not carry direction, so belt flow is
 * inferred from the closest neighbour while each prototype keeps a distinct
 * plan-view silhouette.
 */
function createBlueprintLibraryGlyph(
  entry: HUDBlueprintLibraryEntry,
  expanded = false,
  descendantCount = 0,
): HTMLElement {
  const glyph = document.createElement("span");
  glyph.className = "blueprint-library-entry-glyph";
  glyph.classList.toggle("is-expanded", expanded);
  glyph.setAttribute("aria-hidden", "true");

  if (entry.kind === "book") {
    glyph.classList.add("is-book");
    const folio = document.createElement("span");
    folio.className = "blueprint-library-book-folio";
    const cover = document.createElement("span");
    cover.className = "blueprint-library-book-cover";
    const spine = document.createElement("i");
    spine.className = "blueprint-library-book-spine";
    const sheets = document.createElement("i");
    sheets.className = "blueprint-library-book-sheets";
    const iconRail = document.createElement("span");
    iconRail.className = "blueprint-library-book-icons";
    for (const icon of entry.icons.slice(0, expanded ? 4 : 3)) {
      const token = document.createElement("i");
      token.dataset.libraryIcon = icon;
      token.textContent =
        icon === "gridRelay"
          ? "GR"
          : icon.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase();
      iconRail.append(token);
    }
    if (iconRail.childElementCount === 0) {
      const token = document.createElement("i");
      token.textContent = "＋";
      iconRail.append(token);
    }
    const count = document.createElement("b");
    count.textContent = String(descendantCount);
    cover.append(spine, sheets, iconRail, count);
    folio.append(cover);
    glyph.append(folio);
    return glyph;
  }

  glyph.classList.add("is-plan");
  if (entry.preview.length === 0) {
    const empty = document.createElement("span");
    empty.className = "blueprint-library-map-empty";
    empty.textContent = "◇";
    glyph.append(empty);
    return glyph;
  }

  const pad = 0.65;
  const width = Math.max(1, entry.width);
  const height = Math.max(1, entry.height);
  const map = librarySvgElement("svg", {
    viewBox: `${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}`,
    preserveAspectRatio: "xMidYMid meet",
  });
  const grid = librarySvgElement("g", { class: "blueprint-library-map-grid" });
  for (let x = 0; x <= width; x += 1) {
    grid.append(
      librarySvgElement("line", { x1: x, y1: 0, x2: x, y2: height }),
    );
  }
  for (let y = 0; y <= height; y += 1) {
    grid.append(
      librarySvgElement("line", { x1: 0, y1: y, x2: width, y2: y }),
    );
  }
  map.append(grid);
  map.append(
    librarySvgElement("rect", {
      x: 0,
      y: 0,
      width,
      height,
      class: "blueprint-library-map-boundary",
    }),
  );

  const centres = entry.preview.map((cell) => ({
    x: cell.x + cell.width / 2,
    y: cell.z + cell.height / 2,
  }));
  const links = librarySvgElement("g", {
    class: "blueprint-library-map-links",
  });
  for (let index = 0; index < entry.preview.length; index += 1) {
    const cell = entry.preview[index]!;
    const a = centres[index]!;
    for (
      let peerIndex = index + 1;
      peerIndex < entry.preview.length;
      peerIndex += 1
    ) {
      const peer = entry.preview[peerIndex]!;
      const b = centres[peerIndex]!;
      const gapX = Math.max(
        0,
        Math.abs(a.x - b.x) - (cell.width + peer.width) / 2,
      );
      const gapY = Math.max(
        0,
        Math.abs(a.y - b.y) - (cell.height + peer.height) / 2,
      );
      if (gapX + gapY > 1.05) continue;
      links.append(
        librarySvgElement("path", {
          d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`,
        }),
      );
      links.append(
        librarySvgElement("circle", {
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
          r: 0.09,
        }),
      );
    }
  }
  map.append(links);

  const powerLinks = librarySvgElement("g", {
    class: "blueprint-library-power-links",
  });
  let powerLinkCount = 0;
  for (let relayIndex = 0; relayIndex < entry.preview.length; relayIndex += 1) {
    if (entry.preview[relayIndex]?.kind !== "gridRelay") continue;
    const relay = centres[relayIndex]!;
    const candidates = entry.preview
      .map((cell, index) => ({
        cell,
        index,
        distance: Math.hypot(
          centres[index]!.x - relay.x,
          centres[index]!.y - relay.y,
        ),
      }))
      .filter(
        ({ cell, index, distance }) =>
          index !== relayIndex &&
          distance <= 5.75 &&
          (cell.kind === "generator" ||
            LIBRARY_POWER_CONSUMERS.has(cell.kind)),
      )
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 12);
    for (const candidate of candidates) {
      const target = centres[candidate.index]!;
      const bendX = (relay.x + target.x) / 2;
      powerLinks.append(
        librarySvgElement("path", {
          d: `M ${relay.x} ${relay.y} L ${bendX} ${relay.y} L ${target.x} ${target.y}`,
        }),
      );
      powerLinkCount += 1;
    }
  }
  if (powerLinkCount > 0) map.append(powerLinks);

  for (let index = 0; index < entry.preview.length; index += 1) {
    const cell = entry.preview[index]!;
    const centre = centres[index]!;
    const group = librarySvgElement("g", {
      class: "blueprint-library-map-unit",
      "data-library-unit": cell.kind,
    });
    const inset = Math.min(0.1, cell.width * 0.08, cell.height * 0.08);
    const chassisClass =
      `blueprint-library-unit-chassis is-${cell.kind}`;
    if (
      cell.kind === "generator" ||
      cell.kind === "beacon" ||
      cell.kind === "gridRelay"
    ) {
      group.append(
        librarySvgElement("circle", {
          cx: centre.x,
          cy: centre.y,
          r: Math.max(0.12, Math.min(cell.width, cell.height) / 2 - inset),
          fill: ENTITY_COLORS[cell.kind] ?? "#73f2d2",
          class: chassisClass,
        }),
      );
    } else if (cell.kind === "storage" || cell.kind === "manifold") {
      const halfWidth = Math.max(0.12, cell.width / 2 - inset);
      const halfHeight = Math.max(0.12, cell.height / 2 - inset);
      const shoulder = cell.kind === "storage" ? 0.52 : 0.26;
      group.append(
        librarySvgElement("polygon", {
          points: [
            `${centre.x - halfWidth * shoulder},${centre.y - halfHeight}`,
            `${centre.x + halfWidth * shoulder},${centre.y - halfHeight}`,
            `${centre.x + halfWidth},${centre.y}`,
            `${centre.x + halfWidth * shoulder},${centre.y + halfHeight}`,
            `${centre.x - halfWidth * shoulder},${centre.y + halfHeight}`,
            `${centre.x - halfWidth},${centre.y}`,
          ].join(" "),
          fill: ENTITY_COLORS[cell.kind] ?? "#73f2d2",
          class: chassisClass,
        }),
      );
    } else if (
      cell.kind === "extractor" ||
      cell.kind === "smelter" ||
      cell.kind === "fabricator"
    ) {
      const left = cell.x + inset;
      const right = cell.x + cell.width - inset;
      const top = cell.z + inset;
      const bottom = cell.z + cell.height - inset;
      const cut = Math.min(0.24, cell.width * 0.12, cell.height * 0.12);
      group.append(
        librarySvgElement("path", {
          d: `M ${left + cut} ${top} H ${right - cut} L ${right} ${
            top + cut
          } V ${bottom - cut} L ${right - cut} ${bottom} H ${
            left + cut
          } L ${left} ${bottom - cut} V ${top + cut} Z`,
          fill: ENTITY_COLORS[cell.kind] ?? "#73f2d2",
          class: chassisClass,
        }),
      );
    } else if (cell.kind === "inserter") {
      group.append(
        librarySvgElement("rect", {
          x: cell.x + inset,
          y: cell.z + inset,
          width: Math.max(0.18, cell.width - inset * 2),
          height: Math.max(0.18, cell.height - inset * 2),
          rx: 0.45,
          fill: ENTITY_COLORS[cell.kind] ?? "#73f2d2",
          class: `${chassisClass} is-footprint`,
        }),
      );
    } else {
      group.append(
        librarySvgElement("rect", {
        x: cell.x + inset,
        y: cell.z + inset,
        width: Math.max(0.18, cell.width - inset * 2),
        height: Math.max(0.18, cell.height - inset * 2),
        rx: Math.min(0.16, cell.width * 0.12, cell.height * 0.12),
        fill: ENTITY_COLORS[cell.kind] ?? "#73f2d2",
          class: chassisClass,
        }),
      );
    }

    const chassis = group.querySelector<SVGGraphicsElement>(
      ".blueprint-library-unit-chassis",
    );
    if (chassis) {
      const underlay = chassis.cloneNode(true) as SVGGraphicsElement;
      underlay.setAttribute("class", "blueprint-library-unit-underlay");
      underlay.setAttribute("transform", "translate(0.055 0.07)");
      group.prepend(underlay);

      const bevel = chassis.cloneNode(true) as SVGGraphicsElement;
      bevel.setAttribute(
        "class",
        `blueprint-library-unit-bevel is-${cell.kind}`,
      );
      bevel.setAttribute(
        "transform",
        `translate(${centre.x} ${centre.y}) scale(0.76) translate(${
          -centre.x
        } ${-centre.y})`,
      );
      chassis.after(bevel);
    }
    if (cell.kind !== "belt" && cell.kind !== "inserter") {
      group.append(
        librarySvgElement("rect", {
          x: cell.x + cell.width * 0.2,
          y: cell.z + cell.height * 0.2,
          width: Math.max(0.14, cell.width * 0.6),
          height: Math.max(0.14, cell.height * 0.6),
          rx: Math.min(0.18, cell.width * 0.12, cell.height * 0.12),
          class: "blueprint-library-unit-deck",
        }),
      );
    }
    group.append(
      librarySvgElement("path", {
        d: `M ${cell.x + cell.width * 0.18} ${
          cell.z + cell.height * 0.13
        } H ${cell.x + cell.width * 0.82}`,
        class: "blueprint-library-unit-highlight",
      }),
    );
    group.append(
      librarySvgElement("path", {
        d: `M ${cell.x + cell.width * 0.16} ${
          cell.z + cell.height * 0.84
        } H ${cell.x + cell.width * 0.84} M ${
          cell.x + cell.width * 0.84
        } ${cell.z + cell.height * 0.22} V ${
          cell.z + cell.height * 0.84
        }`,
        class: "blueprint-library-unit-occlusion",
      }),
      librarySvgElement("path", {
        d: `M ${cell.x + cell.width * 0.19} ${
          cell.z + cell.height * 0.31
        } l ${cell.width * 0.13} ${-cell.height * 0.07} M ${
          cell.x + cell.width * 0.68
        } ${cell.z + cell.height * 0.72} l ${
          cell.width * 0.11
        } ${-cell.height * 0.055}`,
        class: "blueprint-library-unit-wear",
      }),
    );
    if (
      cell.kind !== "belt" &&
      cell.kind !== "inserter" &&
      cell.kind !== "gridRelay"
    ) {
      const rivetInsetX = Math.min(0.18, cell.width * 0.16);
      const rivetInsetY = Math.min(0.18, cell.height * 0.16);
      for (const [rivetX, rivetY] of [
        [cell.x + rivetInsetX, cell.z + rivetInsetY],
        [cell.x + cell.width - rivetInsetX, cell.z + rivetInsetY],
        [cell.x + rivetInsetX, cell.z + cell.height - rivetInsetY],
        [
          cell.x + cell.width - rivetInsetX,
          cell.z + cell.height - rivetInsetY,
        ],
      ] as const) {
        group.append(
          librarySvgElement("circle", {
            cx: rivetX,
            cy: rivetY,
            r: Math.min(0.055, Math.min(cell.width, cell.height) * 0.045),
            class: "blueprint-library-unit-rivet",
          }),
        );
      }
    }
    if (cell.kind !== "belt" && cell.kind !== "inserter") {
      group.append(
        librarySvgElement("circle", {
          cx: cell.x + cell.width * 0.77,
          cy: cell.z + cell.height * 0.25,
          r: Math.min(0.095, Math.min(cell.width, cell.height) * 0.075),
          class: `blueprint-library-unit-status is-${cell.kind}`,
        }),
      );
    }
    appendBlueprintMechanicalDetail(group, cell);

    let closestIndex = -1;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let peerIndex = 0; peerIndex < centres.length; peerIndex += 1) {
      if (peerIndex === index) continue;
      const peer = centres[peerIndex]!;
      const distance = Math.hypot(peer.x - centre.x, peer.y - centre.y);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = peerIndex;
      }
    }
    const closest = closestIndex >= 0 ? centres[closestIndex] : undefined;
    const inferredAngle = closest
      ? Math.atan2(closest.y - centre.y, closest.x - centre.x) * 180 / Math.PI
      : 0;
    const angle =
      cell.direction === undefined
        ? inferredAngle
        : ((cell.direction - 1) * 90);
    const symbol = librarySvgElement("g", {
      class: "blueprint-library-unit-symbol",
      transform: `translate(${centre.x} ${centre.y}) rotate(${angle})`,
    });
    const iconSize = Math.max(
      0.48,
      Math.min(cell.width, cell.height) *
        (cell.kind === "belt" || cell.kind === "inserter" ? 0.94 : 0.84),
    );
    const prototypeIcon = librarySvgElement("svg", {
      x: -iconSize / 2,
      y: -iconSize * 0.44,
      width: iconSize,
      height: iconSize * 0.88,
      viewBox: "0 0 34 30",
      preserveAspectRatio: "xMidYMid meet",
      class: "blueprint-library-prototype-icon",
    });
    prototypeIcon.innerHTML = buildDefinitionSvgInner(cell.kind);
    if (
      cell.kind === "smelter" ||
      cell.kind === "fabricator" ||
      cell.kind === "generator" ||
      cell.kind === "beacon" ||
      cell.kind === "gridRelay"
    ) {
      symbol.append(
        librarySvgElement("circle", {
          cx: 0,
          cy: 0,
          r: iconSize * (cell.kind === "fabricator" ? 0.29 : 0.23),
          class:
            `blueprint-library-process-core is-${cell.kind}`,
        }),
      );
    }
    symbol.append(prototypeIcon);
    if (cell.kind === "belt") {
      const lane = iconSize * 0.36;
      const halfLaneGap = iconSize * 0.17;
      symbol.append(
        librarySvgElement("path", {
          d: `M ${-lane} ${-halfLaneGap} H ${lane} M ${-lane} ${
            halfLaneGap
          } H ${lane}`,
          class: "blueprint-library-belt-lanes",
        }),
        librarySvgElement("path", {
          d: `M ${-iconSize * 0.03} ${
            -halfLaneGap - iconSize * 0.09
          } L ${iconSize * 0.18} ${-halfLaneGap} L ${
            -iconSize * 0.03
          } ${-halfLaneGap + iconSize * 0.09} M ${
            -iconSize * 0.03
          } ${halfLaneGap - iconSize * 0.09} L ${
            iconSize * 0.18
          } ${halfLaneGap} L ${-iconSize * 0.03} ${
            halfLaneGap + iconSize * 0.09
          }`,
          class: "blueprint-library-belt-arrows",
        }),
      );
      for (const rollerX of [-0.28, 0, 0.28]) {
        symbol.append(
          librarySvgElement("circle", {
            cx: rollerX * iconSize,
            cy: 0,
            r: iconSize * 0.075,
            class: "blueprint-library-belt-roller",
          }),
        );
      }
    } else if (cell.kind === "inserter") {
      symbol.prepend(
        librarySvgElement("path", {
          d: `M ${-iconSize * 0.44} 0 Q 0 ${-iconSize * 0.62} ${
            iconSize * 0.44
          } 0`,
          class: "blueprint-library-inserter-reach",
        }),
        librarySvgElement("circle", {
          cx: iconSize * 0.44,
          cy: 0,
          r: iconSize * 0.08,
          class: "blueprint-library-inserter-target",
        }),
      );
    }

    if (
      cell.kind === "extractor" ||
      cell.kind === "smelter" ||
      cell.kind === "fabricator" ||
      cell.kind === "storage"
    ) {
      const portOffset = Math.max(0.26, cell.width / 2 - 0.04);
      symbol.append(
        librarySvgElement("circle", {
          cx: portOffset,
          cy: 0,
          r: Math.min(0.13, iconSize * 0.13),
          class: "blueprint-library-machine-port is-output",
        }),
      );
      if (cell.kind !== "extractor") {
        symbol.append(
          librarySvgElement("circle", {
            cx: -portOffset,
            cy: 0,
            r: Math.min(0.13, iconSize * 0.13),
            class: "blueprint-library-machine-port is-input",
          }),
        );
      }
    }

    if (cell.kind === "manifold" && cell.manifoldMode) {
      const modeLabels: Readonly<Record<ManifoldMode, string>> = {
        even: "E",
        favorA: "A",
        favorB: "B",
        extract: "X",
      };
      const mode = librarySvgElement("text", {
        x: 0,
        y: iconSize * 0.1,
        class: "blueprint-library-manifold-mode",
      });
      mode.textContent = modeLabels[cell.manifoldMode];
      symbol.append(mode);
    }
    group.append(symbol);

    if (
      (cell.kind === "smelter" || cell.kind === "fabricator") &&
      cell.recipeId !== undefined
    ) {
      const badge = librarySvgElement("g", {
        class: "blueprint-library-recipe-badge",
        "data-recipe-id": cell.recipeId ?? "auto",
        transform: `translate(${
          cell.x + cell.width - Math.min(0.2, cell.width * 0.14)
        } ${cell.z + Math.min(0.2, cell.height * 0.14)})`,
      });
      badge.append(
        librarySvgElement("circle", {
          cx: 0,
          cy: 0,
          r: Math.min(0.3, Math.min(cell.width, cell.height) * 0.22),
          class: "blueprint-library-recipe-bezel",
        }),
        librarySvgElement("circle", {
          cx: 0,
          cy: 0,
          r: Math.min(0.235, Math.min(cell.width, cell.height) * 0.17),
          class: "blueprint-library-recipe-glass",
        }),
      );
      if (cell.recipeId) {
        const outputItem = RECIPE_OUTPUT_PICTOGRAM[cell.recipeId];
        const itemIcon = librarySvgElement("svg", {
          x: -0.18,
          y: -0.18,
          width: 0.36,
          height: 0.36,
          viewBox: "0 0 24 24",
          "data-output-item": outputItem,
          style: `--library-item-color:${
            LIBRARY_ITEM_COLORS[outputItem] ?? "#d8dfda"
          }`,
        });
        itemIcon.innerHTML = ITEM_PICTOGRAMS[outputItem];
        badge.append(itemIcon);
      } else {
        const auto = librarySvgElement("text", {
          x: 0,
          y: 0.08,
          class: "blueprint-library-auto-recipe",
        });
        auto.textContent = "A";
        badge.append(auto);
      }
      group.append(badge);
    }

    if (
      cell.kind === "manifold" &&
      cell.manifoldMode === "extract" &&
      cell.manifoldFilter
    ) {
      const filter = librarySvgElement("circle", {
        cx: cell.x + cell.width - 0.16,
        cy: cell.z + 0.16,
        r: 0.12,
        class: "blueprint-library-filter-badge",
        style: `--library-item-color:${
          LIBRARY_ITEM_COLORS[cell.manifoldFilter] ?? "#d8dfda"
        }`,
      });
      group.append(filter);
    }
    map.append(group);
  }

  map.append(
    librarySvgElement("path", {
      d: "M 0.15 0.52 V 0.15 H 0.52",
      class: "blueprint-library-map-origin",
    }),
  );
  glyph.append(map);
  return glyph;
}

function createBlueprintLibraryDossier(
  entry: HUDBlueprintLibraryEntry,
): HTMLElement {
  const dossier = document.createElement("section");
  dossier.className = "blueprint-library-vault-dossier-card";
  dossier.setAttribute(
    "aria-label",
    `Selected topology index for ${entry.name}`,
  );

  const heading = document.createElement("span");
  heading.className = "blueprint-library-dossier-heading";
  const eyebrow = document.createElement("small");
  eyebrow.textContent = "Selected topology";
  const name = document.createElement("strong");
  name.textContent = entry.name;
  heading.append(eyebrow, name);

  const representedKinds = librarySemanticKinds(entry.preview, 5);
  const topology = document.createElement("span");
  topology.className = "blueprint-library-dossier-topology";
  for (const kind of representedKinds) {
    if (topology.childElementCount > 0) {
      const connector = document.createElement("b");
      connector.textContent = "›";
      connector.setAttribute("aria-hidden", "true");
      topology.append(connector);
    }
    const node = document.createElement("i");
    node.dataset.libraryDossierKind = kind;
    node.style.setProperty(
      "--library-kind-color",
      ENTITY_COLORS[kind] ?? "#7f9a94",
    );
    node.title =
      BUILD_DEFINITIONS.find((definition) => definition.kind === kind)?.name ??
      kind;
    const icon = librarySvgElement("svg", {
      viewBox: "0 0 34 30",
      "aria-hidden": "true",
    });
    icon.innerHTML = buildDefinitionSvgInner(kind);
    node.append(icon);
    topology.append(node);
  }

  let adjacencyCount = 0;
  for (let index = 0; index < entry.preview.length; index += 1) {
    const cell = entry.preview[index]!;
    const centreX = cell.x + cell.width / 2;
    const centreZ = cell.z + cell.height / 2;
    for (
      let peerIndex = index + 1;
      peerIndex < entry.preview.length;
      peerIndex += 1
    ) {
      const peer = entry.preview[peerIndex]!;
      const peerX = peer.x + peer.width / 2;
      const peerZ = peer.z + peer.height / 2;
      const gapX = Math.max(
        0,
        Math.abs(centreX - peerX) - (cell.width + peer.width) / 2,
      );
      const gapZ = Math.max(
        0,
        Math.abs(centreZ - peerZ) - (cell.height + peer.height) / 2,
      );
      if (gapX + gapZ <= 1.05) adjacencyCount += 1;
    }
  }

  const poweredCount = entry.preview.filter((cell) =>
    LIBRARY_POWER_CONSUMERS.has(cell.kind)
  ).length;
  const configuredCount = entry.preview.filter(
    (cell) => cell.recipeId || cell.manifoldMode,
  ).length;
  const metrics = document.createElement("span");
  metrics.className = "blueprint-library-dossier-metrics";
  for (const [value, label] of [
    [adjacencyCount, "links"],
    [poweredCount, "powered"],
    [configuredCount, "configured"],
  ] as const) {
    const metric = document.createElement("span");
    const number = document.createElement("b");
    number.textContent = formatInteger(value);
    const caption = document.createElement("small");
    caption.textContent = label;
    metric.append(number, caption);
    metrics.append(metric);
  }

  const outputs = new Set<ItemId>();
  for (const cell of entry.preview) {
    if (cell.recipeId) outputs.add(RECIPE_OUTPUT_PICTOGRAM[cell.recipeId]);
  }
  const products = document.createElement("span");
  products.className = "blueprint-library-dossier-products";
  products.setAttribute("aria-label", "Configured products");
  for (const outputItem of [...outputs].slice(0, 3)) {
    const product = document.createElement("i");
    product.style.setProperty(
      "--library-item-color",
      LIBRARY_ITEM_COLORS[outputItem] ?? "#d8dfda",
    );
    product.title = LIBRARY_ITEM_LABELS[outputItem] ?? outputItem;
    const icon = librarySvgElement("svg", {
      viewBox: "0 0 24 24",
      "aria-hidden": "true",
    });
    icon.innerHTML = ITEM_PICTOGRAMS[outputItem];
    product.append(icon);
    products.append(product);
  }

  dossier.append(heading, topology, metrics);
  if (products.childElementCount > 0) dossier.append(products);
  return dossier;
}

function railToolIcon(kind: RailBuildKind): string {
  const paths: Readonly<Record<RailBuildKind, string>> = {
    straight:
      '<path d="M7 3v26M25 3v26M7 8h18M7 15h18M7 22h18"/><path class="rail-tool-icon-accent" d="M16 4v24"/>',
    curve:
      '<path d="M5 28c0-13 2-23 12-25M14 29c0-10 1-16 5-20 3-3 6-4 10-4"/><path d="M6 22l9 2M8 15l9 3M12 8l8 5M19 3l4 8"/>',
    junction:
      '<path d="M7 29V3M16 29V15L28 3M7 8h9M7 16h9M7 24h9M15 15l8 6M19 11l8 6"/><circle class="rail-tool-icon-accent" cx="16" cy="15" r="2.5"/>',
    regularSignal:
      '<path d="M8 28h17M16 28V9M16 18h9"/><circle class="rail-tool-icon-accent" cx="16" cy="7" r="4"/><path d="M22 14l5 4-5 4"/>',
    chainSignal:
      '<path d="M8 28h17M16 28V10M16 18h9"/><path class="rail-tool-icon-accent" d="m16 2 5 5-5 5-5-5z"/><path d="M22 14l5 4-5 4"/>',
    station:
      '<path d="M5 27h24M8 27V8h16v19M11 12h10M11 17h10M11 22h6"/><path class="rail-tool-icon-accent" d="M4 5h25M9 2h15v6H9z"/>',
    locomotive:
      '<path d="M5 22h24l-2-10h-7V7h-9v5H7zM8 22l-2 5h22l-3-5"/><circle cx="11" cy="25" r="3"/><circle cx="23" cy="25" r="3"/><path class="rail-tool-icon-accent" d="M14 10h4M8 16h18"/>',
    cargoWagon:
      '<path d="M4 9h26l-3 14H7zM8 23l-2 4h22l-2-4"/><circle cx="11" cy="25" r="3"/><circle cx="23" cy="25" r="3"/><path class="rail-tool-icon-accent" d="M8 13h18M11 9v14M23 9v14"/>',
  };
  return `<svg viewBox="0 0 34 32" aria-hidden="true">${paths[kind]}</svg>`;
}

export class HUD {
  private readonly root: HTMLElement;
  private callbacks: HUDCallbacks;
  private model: HUDModel = {};
  private readonly disposers: Array<() => void> = [];
  private readonly toastTimers = new Map<string, number>();
  private readonly toastIdsByKey = new Map<string, string>();
  private readonly toastKeysById = new Map<string, string>();
  private readonly toastCooldowns = new Map<string, number>();
  private readonly toastRepeatCounts = new Map<string, number>();
  private toastSequence = 0;
  private modelRenderSignature = "\u0000";
  private objectiveSignature = "";
  private commissionSignature = "";
  private inspectorRenderSignature = "\u0000";
  private inspectorIdentity: string | null | undefined;
  private inspectorStatSignature = "";
  private inspectorActionSignature = "";
  private circuitEditorSignature = "";
  private circuitLiveSignature = "";
  private blueprintLibrarySignature = "";
  private blueprintLibrarySelectedId: string | null | undefined;
  private railAuthoringShellSignature = "\u0000";
  private railAuthoringToolsSignature = "\u0000";
  private railAuthoringEditorSignature = "\u0000";
  private railConsoleReturnFocus: HTMLElement | null = null;
  private railConsoleCollapsed = false;
  private manifoldFilterSignature = "";
  private recipeDeckSignature = "";
  private processChamberSignature = "";
  private recipeRovingId = "";
  private activeBuildCategory: BuildCategory = "factory";
  private lastSelectedBuild: BuildKind | null | undefined;
  private readonly processBufferSignatures: Record<
    "input" | "output" | "reclaim",
    string
  > = {
    input: "",
    output: "",
    reclaim: "",
  };
  private lastMinimap?: HUDMinimap;
  private minimapRenderSignature = "\u0000";
  private resizeObserver?: ResizeObserver;
  private resetConfirmTimer?: number;
  private fieldManualReturnFocus: HTMLElement | null = null;

  private readonly materialValue: HTMLElement;
  private readonly materialLabel: HTMLElement;
  private readonly powerValue: HTMLElement;
  private readonly powerTrack: HTMLElement;
  private readonly throughputValue: HTMLElement;
  private readonly efficiencyValue: HTMLElement;
  private readonly factoryName: HTMLElement;
  private readonly sectorName: HTMLElement;
  private readonly missionPanel: HTMLElement;
  private readonly missionChapter: HTMLElement;
  private readonly missionCode: HTMLElement;
  private readonly missionTitle: HTMLElement;
  private readonly missionCopy: HTMLElement;
  private readonly objectiveList: HTMLElement;
  private readonly missionProgress: HTMLElement;
  private readonly missionCollapseButton: HTMLButtonElement;
  private readonly missionCollapseLabel: HTMLElement;
  private readonly missionCollapsedSummary: HTMLElement;
  private readonly commissionControls: HTMLElement;
  private readonly commissionOptions: HTMLElement;
  private readonly commissionSubmit: HTMLButtonElement;
  private readonly blueprintPanel: HTMLElement;
  private readonly blueprintMode: HTMLElement;
  private readonly blueprintTransform: HTMLElement;
  private readonly blueprintUnits: HTMLElement;
  private readonly blueprintDimensions: HTMLElement;
  private readonly blueprintCost: HTMLElement;
  private readonly blueprintStock: HTMLElement;
  private readonly blueprintStatus: HTMLElement;
  private readonly blueprintConstructCount: HTMLElement;
  private readonly blueprintConfigureCount: HTMLElement;
  private readonly blueprintMatchCount: HTMLElement;
  private readonly blueprintBlockedCount: HTMLElement;
  private readonly blueprintLibraryLayer: HTMLElement;
  private readonly blueprintLibraryTree: HTMLElement;
  private readonly blueprintLibraryVaultDossier: HTMLElement;
  private readonly blueprintLibraryIndexSummary: HTMLElement;
  private readonly blueprintLibraryCount: HTMLElement;
  private readonly blueprintLibraryName: HTMLInputElement;
  private readonly blueprintLibrarySelection: HTMLElement;
  private readonly blueprintLibraryDescription: HTMLElement;
  private readonly blueprintLibrarySelectedPreview: HTMLElement;
  private readonly blueprintLibrarySelectedIdentity: HTMLElement;
  private readonly blueprintLibrarySelectedPanel: HTMLElement;
  private readonly blueprintLibraryToolsToggle: HTMLButtonElement;
  private readonly blueprintLibraryLoad: HTMLButtonElement;
  private readonly blueprintLibraryUpdate: HTMLButtonElement;
  private readonly blueprintLibraryReassign: HTMLButtonElement;
  private readonly blueprintLibraryDuplicate: HTMLButtonElement;
  private readonly blueprintLibraryMoveUp: HTMLButtonElement;
  private readonly blueprintLibraryMoveDown: HTMLButtonElement;
  private readonly blueprintLibraryDelete: HTMLButtonElement;
  private readonly blueprintLibraryRestoreDelete: HTMLButtonElement;
  private readonly blueprintLibraryShare: HTMLTextAreaElement;
  private readonly blueprintLibrarySave: HTMLButtonElement;
  private readonly railConsole: HTMLElement;
  private readonly railTools: HTMLElement;
  private readonly railEditor: HTMLElement;
  private readonly railStatus: HTMLElement;
  private readonly railSelection: HTMLElement;
  private readonly railRotation: HTMLElement;
  private readonly railToggleButtons: readonly HTMLButtonElement[];
  private readonly inspector: HTMLElement;
  private readonly inspectorType: HTMLElement;
  private readonly inspectorName: HTMLElement;
  private readonly inspectorStatus: HTMLElement;
  private readonly inspectorStats: HTMLElement;
  private readonly inspectorActions: HTMLElement;
  private readonly recipeChip: HTMLElement;
  private readonly recipeIcon: HTMLElement;
  private readonly recipeLabel: HTMLElement;
  private readonly recipeDetail: HTMLElement;
  private readonly circuitConsole: HTMLElement;
  private readonly circuitLive: HTMLElement;
  private readonly circuitProgram: HTMLElement;
  private readonly circuitEndpoints: HTMLElement;
  private readonly circuitWires: HTMLElement;
  private readonly circuitWireStatus: HTMLElement;
  private readonly processConsole: HTMLElement;
  private readonly recipeGrid: HTMLElement;
  private readonly processCondition: HTMLElement;
  private readonly processChamberName: HTMLElement;
  private readonly processChamberFormula: HTMLElement;
  private readonly processProgress: HTMLElement;
  private readonly processProgressValue: HTMLElement;
  private readonly manifoldControls: HTMLElement;
  private readonly manifoldFilterField: HTMLElement;
  private readonly manifoldFilter: HTMLSelectElement;
  private readonly manifoldFilterHint: HTMLElement;
  private readonly manifoldExtractPorts: HTMLElement;
  private readonly manifoldPortA: HTMLElement;
  private readonly manifoldPortB: HTMLElement;
  private readonly manifoldNextSplit: HTMLElement;
  private readonly manifoldNextMerge: HTMLElement;
  private readonly coordinateX: HTMLElement;
  private readonly coordinateZ: HTMLElement;
  private readonly minimap: HTMLCanvasElement;
  private readonly pausePlate: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly muteButton: HTMLButtonElement;
  private readonly helpButton: HTMLButtonElement;
  private readonly sessionButton: HTMLButtonElement;
  private readonly sessionPanel: HTMLElement;
  private readonly sessionState: HTMLElement;
  private readonly sessionDetail: HTMLElement;
  private readonly sessionSaveButton: HTMLButtonElement;
  private readonly sessionRestoreButton: HTMLButtonElement;
  private readonly sessionResetButton: HTMLButtonElement;
  private readonly fieldManual: HTMLElement;
  private readonly powerRetrofitButton: HTMLButtonElement;
  private readonly tooltip: HTMLElement;
  private readonly toastStack: HTMLElement;
  private buildDockSnapFrame: number | undefined;
  private buildDockTouchStartX: number | undefined;
  private buildDockTouchStartScrollLeft = 0;

  constructor(
    root: HTMLElement | string = "#hud",
    callbacks: HUDCallbacks = {},
    options: HUDOptions = {},
  ) {
    const resolved =
      typeof root === "string" ? document.querySelector<HTMLElement>(root) : root;
    if (!resolved) {
      throw new Error(`HUD root "${String(root)}" was not found.`);
    }

    this.root = resolved;
    this.callbacks = callbacks;
    this.root.innerHTML = this.template();

    this.materialValue = this.requireElement("[data-ref='material-value']");
    this.materialLabel = this.requireElement("[data-ref='material-label']");
    this.powerValue = this.requireElement("[data-ref='power-value']");
    this.powerTrack = this.requireElement("[data-ref='power-track']");
    this.throughputValue = this.requireElement("[data-ref='throughput-value']");
    this.efficiencyValue = this.requireElement("[data-ref='efficiency-value']");
    this.factoryName = this.requireElement("[data-ref='factory-name']");
    this.sectorName = this.requireElement("[data-ref='sector-name']");
    this.missionPanel = this.requireElement("[data-ref='mission-panel']");
    this.missionChapter = this.requireElement("[data-ref='mission-chapter']");
    this.missionCode = this.requireElement("[data-ref='mission-code']");
    this.missionTitle = this.requireElement("[data-ref='mission-title']");
    this.missionCopy = this.requireElement("[data-ref='mission-copy']");
    this.objectiveList = this.requireElement("[data-ref='objective-list']");
    this.missionProgress = this.requireElement("[data-ref='mission-progress']");
    this.missionCollapseButton = this.requireElement<HTMLButtonElement>(
      "[data-action='mission-collapse']",
    );
    this.missionCollapseLabel = this.requireElement(
      "[data-ref='mission-collapse-label']",
    );
    this.missionCollapsedSummary = this.requireElement(
      "[data-ref='mission-collapsed-summary']",
    );
    this.commissionControls = this.requireElement(
      "[data-ref='commission-controls']",
    );
    this.commissionOptions = this.requireElement(
      "[data-ref='commission-options']",
    );
    this.commissionSubmit = this.requireElement<HTMLButtonElement>(
      "[data-action='commission-submit']",
    );
    this.blueprintPanel = this.requireElement("[data-ref='blueprint-panel']");
    this.blueprintMode = this.requireElement("[data-ref='blueprint-mode']");
    this.blueprintTransform = this.requireElement(
      "[data-ref='blueprint-transform']",
    );
    this.blueprintUnits = this.requireElement("[data-ref='blueprint-units']");
    this.blueprintDimensions = this.requireElement(
      "[data-ref='blueprint-dimensions']",
    );
    this.blueprintCost = this.requireElement("[data-ref='blueprint-cost']");
    this.blueprintStock = this.requireElement("[data-ref='blueprint-stock']");
    this.blueprintStatus = this.requireElement("[data-ref='blueprint-status']");
    this.blueprintConstructCount = this.requireElement(
      "[data-ref='blueprint-construct-count']",
    );
    this.blueprintConfigureCount = this.requireElement(
      "[data-ref='blueprint-configure-count']",
    );
    this.blueprintMatchCount = this.requireElement(
      "[data-ref='blueprint-match-count']",
    );
    this.blueprintBlockedCount = this.requireElement(
      "[data-ref='blueprint-blocked-count']",
    );
    this.blueprintLibraryLayer = this.requireElement(
      "[data-ref='blueprint-library-layer']",
    );
    this.blueprintLibraryTree = this.requireElement(
      "[data-ref='blueprint-library-tree']",
    );
    this.blueprintLibraryVaultDossier = this.requireElement(
      "[data-ref='blueprint-library-vault-dossier']",
    );
    this.blueprintLibraryIndexSummary = this.requireElement(
      "[data-ref='blueprint-library-index-summary']",
    );
    this.blueprintLibraryCount = this.requireElement(
      "[data-ref='blueprint-library-count']",
    );
    this.blueprintLibraryName = this.requireElement<HTMLInputElement>(
      "[data-ref='blueprint-library-name']",
    );
    this.blueprintLibrarySelection = this.requireElement(
      "[data-ref='blueprint-library-selection']",
    );
    this.blueprintLibraryDescription = this.requireElement(
      "[data-ref='blueprint-library-description']",
    );
    this.blueprintLibrarySelectedPreview = this.requireElement(
      "[data-ref='blueprint-library-selected-preview']",
    );
    this.blueprintLibrarySelectedIdentity = this.requireElement(
      "[data-ref='blueprint-library-selected-identity']",
    );
    this.blueprintLibrarySelectedPanel = this.requireElement(
      "[data-ref='blueprint-library-selected']",
    );
    this.blueprintLibraryToolsToggle = this.requireElement<HTMLButtonElement>(
      "[data-action='blueprint-library-tools-toggle']",
    );
    this.blueprintLibraryLoad = this.requireElement<HTMLButtonElement>(
      "[data-action='blueprint-library-load']",
    );
    this.blueprintLibraryUpdate = this.requireElement<HTMLButtonElement>(
      "[data-action='blueprint-library-update']",
    );
    this.blueprintLibraryReassign = this.requireElement<HTMLButtonElement>(
      "[data-action='blueprint-library-reassign']",
    );
    this.blueprintLibraryDuplicate = this.requireElement<HTMLButtonElement>(
      "[data-action='blueprint-library-duplicate']",
    );
    this.blueprintLibraryMoveUp = this.requireElement<HTMLButtonElement>(
      "[data-action='blueprint-library-move-up']",
    );
    this.blueprintLibraryMoveDown = this.requireElement<HTMLButtonElement>(
      "[data-action='blueprint-library-move-down']",
    );
    this.blueprintLibraryDelete = this.requireElement<HTMLButtonElement>(
      "[data-action='blueprint-library-delete']",
    );
    this.blueprintLibraryRestoreDelete =
      this.requireElement<HTMLButtonElement>(
        "[data-action='blueprint-library-restore-delete']",
      );
    this.blueprintLibraryShare = this.requireElement<HTMLTextAreaElement>(
      "[data-ref='blueprint-library-share']",
    );
    this.blueprintLibrarySave = this.requireElement<HTMLButtonElement>(
      "[data-action='blueprint-library-save']",
    );
    this.railConsole = this.requireElement("[data-ref='rail-console']");
    this.railTools = this.requireElement("[data-ref='rail-tools']");
    this.railEditor = this.requireElement("[data-ref='rail-editor']");
    this.railStatus = this.requireElement("[data-ref='rail-status']");
    this.railSelection = this.requireElement(
      "[data-ref='rail-selection']",
    );
    this.railRotation = this.requireElement("[data-ref='rail-rotation']");
    this.railToggleButtons = Object.freeze(
      [
        ...this.root.querySelectorAll<HTMLButtonElement>(
          "[data-action='rail-toggle']",
        ),
      ],
    );
    this.inspector = this.requireElement("[data-ref='inspector']");
    this.inspectorType = this.requireElement("[data-ref='inspector-type']");
    this.inspectorName = this.requireElement("[data-ref='inspector-name']");
    this.inspectorStatus = this.requireElement("[data-ref='inspector-status']");
    this.inspectorStats = this.requireElement("[data-ref='inspector-stats']");
    this.inspectorActions = this.requireElement(
      "[data-ref='inspector-actions']",
    );
    this.recipeChip = this.requireElement("[data-ref='recipe-chip']");
    this.recipeIcon = this.requireElement("[data-ref='recipe-icon']");
    this.recipeLabel = this.requireElement("[data-ref='recipe-label']");
    this.recipeDetail = this.requireElement("[data-ref='recipe-detail']");
    this.circuitConsole = this.requireElement("[data-ref='circuit-console']");
    this.circuitLive = this.requireElement("[data-ref='circuit-live']");
    this.circuitProgram = this.requireElement("[data-ref='circuit-program']");
    this.circuitEndpoints = this.requireElement(
      "[data-ref='circuit-endpoints']",
    );
    this.circuitWires = this.requireElement("[data-ref='circuit-wires']");
    this.circuitWireStatus = this.requireElement(
      "[data-ref='circuit-wire-status']",
    );
    this.processConsole = this.requireElement("[data-ref='process-console']");
    this.recipeGrid = this.requireElement("[data-ref='recipe-grid']");
    this.processCondition = this.requireElement("[data-process-condition]");
    this.processChamberName = this.requireElement(
      "[data-ref='process-chamber-name']",
    );
    this.processChamberFormula = this.requireElement(
      "[data-ref='process-chamber-formula']",
    );
    this.processProgress = this.requireElement("[data-ref='process-progress']");
    this.processProgressValue = this.requireElement(
      "[data-ref='process-progress-value']",
    );
    this.manifoldControls = this.requireElement("[data-ref='manifold-controls']");
    this.manifoldFilterField = this.requireElement(
      "[data-ref='manifold-filter-field']",
    );
    this.manifoldFilter = this.requireElement<HTMLSelectElement>(
      "[data-ref='manifold-filter']",
    );
    this.manifoldFilterHint = this.requireElement(
      "[data-ref='manifold-filter-hint']",
    );
    this.manifoldExtractPorts = this.requireElement(
      "[data-ref='manifold-extract-ports']",
    );
    this.manifoldPortA = this.requireElement("[data-ref='manifold-port-a']");
    this.manifoldPortB = this.requireElement("[data-ref='manifold-port-b']");
    this.manifoldNextSplit = this.requireElement(
      "[data-ref='manifold-next-split']",
    );
    this.manifoldNextMerge = this.requireElement(
      "[data-ref='manifold-next-merge']",
    );
    this.coordinateX = this.requireElement("[data-ref='coordinate-x']");
    this.coordinateZ = this.requireElement("[data-ref='coordinate-z']");
    this.minimap = this.requireElement<HTMLCanvasElement>("#minimap");
    this.pausePlate = this.requireElement("[data-ref='pause-plate']");
    this.pauseButton = this.requireElement<HTMLButtonElement>("[data-action='pause']");
    this.muteButton = this.requireElement<HTMLButtonElement>("[data-action='mute']");
    this.helpButton = this.requireElement<HTMLButtonElement>("[data-action='help']");
    this.sessionButton = this.requireElement<HTMLButtonElement>(
      "[data-action='session-toggle']",
    );
    this.sessionPanel = this.requireElement("[data-ref='session-panel']");
    this.sessionState = this.requireElement("[data-ref='session-state']");
    this.sessionDetail = this.requireElement("[data-ref='session-detail']");
    this.sessionSaveButton = this.requireElement<HTMLButtonElement>(
      "[data-action='session-save']",
    );
    this.sessionRestoreButton = this.requireElement<HTMLButtonElement>(
      "[data-action='session-restore']",
    );
    this.sessionResetButton = this.requireElement<HTMLButtonElement>(
      "[data-action='session-reset']",
    );
    this.fieldManual = this.requireElement("[data-ref='field-manual']");
    this.powerRetrofitButton = this.requireElement<HTMLButtonElement>(
      "[data-action='power-retrofit']",
    );
    this.tooltip = this.requireElement("[data-ref='tooltip']");
    this.toastStack = this.requireElement("[data-ref='toast-stack']");

    this.bindInteractions(options.bindHotkeys ?? false);
    if (this.isShortMobileViewport()) this.setMissionCollapsed(true);
    this.setBuildCategory("factory");
    this.resizeObserver =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => this.drawMinimap(this.lastMinimap));
    this.resizeObserver?.observe(this.minimap);
    this.update({});
  }

  setCallbacks(callbacks: HUDCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Applies a partial snapshot. Nested telemetry is merged, while mission,
   * inspector and minimap values replace their previous snapshots.
   */
  update(patch: HUDModel): void {
    this.model = {
      ...this.model,
      ...patch,
      telemetry: {
        ...this.model.telemetry,
        ...patch.telemetry,
      },
    };

    const renderSignature = JSON.stringify(this.model, (key, value) =>
      key === "minimap" || key === "toasts" ? undefined : value,
    );
    if (renderSignature !== this.modelRenderSignature) {
      this.modelRenderSignature = renderSignature;
      this.updateBrand();
      this.updateTelemetry();
      this.updateMission();
      this.updateBlueprint();
      this.updateBlueprintLibrary();
      this.updateRailAuthoring();
      this.updateBuildDock();
      this.updateInspector();
      this.updateCoordinates();
      this.updateStateButtons();
      this.updateSession();
    }

    if ("minimap" in patch) {
      this.lastMinimap = patch.minimap;
      this.drawMinimap(patch.minimap);
    }
    for (const toast of patch.toasts ?? []) {
      this.showToast(toast);
    }
  }

  setModel(model: HUDModel): void {
    this.update(model);
  }

  setFieldManualOpen(open: boolean): void {
    if (this.fieldManual.hidden === !open) return;
    if (open) {
      this.fieldManualReturnFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : this.helpButton;
      this.setSessionPanelOpen(false);
    }
    this.fieldManual.hidden = !open;
    this.helpButton.setAttribute("aria-expanded", String(open));
    if (open) {
      this.fieldManual
        .querySelector<HTMLButtonElement>("[data-action='manual-close']")
        ?.focus();
    } else {
      this.fieldManualReturnFocus?.focus();
      this.fieldManualReturnFocus = null;
    }
  }

  showToast(toast: HUDToast | string): string {
    const definition: HUDToast =
      typeof toast === "string" ? { message: toast } : toast;
    const duration = Math.max(900, definition.duration ?? 3400);
    const now = typeof performance === "undefined" ? Date.now() : performance.now();
    const dedupeKey = this.toastDedupeKey(definition);
    const activeId = this.toastIdsByKey.get(dedupeKey);
    const activeSelector = activeId
      ? `[data-toast-id="${escapeSelector(activeId)}"]`
      : "";
    const activeElement = activeSelector
      ? this.toastStack.querySelector<HTMLElement>(activeSelector)
      : null;

    if (!activeElement && (this.toastCooldowns.get(dedupeKey) ?? 0) > now) {
      return activeId ?? definition.id ?? `suppressed-${dedupeKey}`;
    }

    const id =
      activeElement?.dataset.toastId ??
      definition.id ??
      `hud-toast-${++this.toastSequence}`;
    const selector = `[data-toast-id="${escapeSelector(id)}"]`;
    const existing =
      activeElement ?? this.toastStack.querySelector<HTMLElement>(selector);
    const element = existing ?? document.createElement("div");
    element.className = "toast";
    element.style.borderLeftColor = "";
    if (definition.tone === "error") element.classList.add("is-error");
    if (definition.tone === "success") {
      element.style.borderLeftColor = "#8ee18b";
    }
    element.dataset.toastId = id;
    element.setAttribute("role", definition.tone === "error" ? "alert" : "status");

    element.replaceChildren();
    if (definition.title) {
      const title = document.createElement("b");
      title.textContent = definition.title;
      element.append(title);
    }
    element.append(document.createTextNode(definition.message));
    const repeatCount = existing
      ? Math.min(100, (this.toastRepeatCounts.get(id) ?? 1) + 1)
      : 1;
    this.toastRepeatCounts.set(id, repeatCount);
    if (repeatCount > 1) {
      const repeat = document.createElement("span");
      repeat.className = "toast-repeat";
      repeat.textContent = repeatCount >= 100 ? "×99+" : `×${repeatCount}`;
      repeat.setAttribute("aria-label", `Repeated ${repeatCount} times`);
      element.append(repeat);
    }

    if (!existing) {
      this.makeToastRoom();
      this.toastStack.append(element);
      this.toastIdsByKey.set(dedupeKey, id);
      this.toastKeysById.set(id, dedupeKey);
      this.toastCooldowns.set(dedupeKey, now + duration + 1200);
      const timer = window.setTimeout(() => this.dismissToast(id), duration);
      this.toastTimers.set(id, timer);
    }
    return id;
  }

  dismissToast(id: string): void {
    const selector = `[data-toast-id="${escapeSelector(id)}"]`;
    const element = this.toastStack.querySelector<HTMLElement>(selector);
    if (!element) return;
    const timer = this.toastTimers.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    this.toastTimers.delete(id);
    this.toastRepeatCounts.delete(id);
    const key = this.toastKeysById.get(id);
    if (key) {
      if (this.toastIdsByKey.get(key) === id) this.toastIdsByKey.delete(key);
      this.toastKeysById.delete(id);
    }
    element.classList.add("is-leaving");
    window.setTimeout(() => element.remove(), 310);
  }

  drawMinimap(data: HUDMinimap | undefined = this.lastMinimap): void {
    const rect = this.minimap.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.round(rect.width || 182));
    const cssHeight = Math.max(1, Math.round(rect.height || 142));
    const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const renderWidth = Math.round(cssWidth * pixelRatio);
    const renderHeight = Math.round(cssHeight * pixelRatio);
    const renderSignature = `${renderWidth}x${renderHeight}\u001f${
      data ? JSON.stringify(data) : "empty"
    }`;
    if (renderSignature === this.minimapRenderSignature) return;

    if (this.minimap.width !== renderWidth || this.minimap.height !== renderHeight) {
      this.minimap.width = renderWidth;
      this.minimap.height = renderHeight;
    }

    const context = this.minimap.getContext("2d");
    if (!context) return;
    this.minimapRenderSignature = renderSignature;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);

    const background = context.createRadialGradient(
      cssWidth * 0.5,
      cssHeight * 0.45,
      4,
      cssWidth * 0.5,
      cssHeight * 0.45,
      cssWidth * 0.7,
    );
    background.addColorStop(0, "#102526");
    background.addColorStop(1, "#061011");
    context.fillStyle = background;
    context.fillRect(0, 0, cssWidth, cssHeight);

    context.strokeStyle = "rgba(115, 242, 210, 0.07)";
    context.lineWidth = 0.5;
    for (let x = 10.5; x < cssWidth; x += 16) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, cssHeight);
      context.stroke();
    }
    for (let y = 10.5; y < cssHeight; y += 16) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(cssWidth, y);
      context.stroke();
    }

    if (!data) {
      context.fillStyle = "rgba(145, 165, 162, 0.46)";
      context.font = "7px monospace";
      context.textAlign = "center";
      context.fillText("AWAITING SURVEY DATA", cssWidth / 2, cssHeight / 2 + 3);
      return;
    }

    const { bounds } = data;
    const worldWidth = Math.max(0.001, bounds.maxX - bounds.minX);
    const worldDepth = Math.max(0.001, bounds.maxZ - bounds.minZ);
    const padding = 8;
    const usableWidth = cssWidth - padding * 2;
    const usableHeight = cssHeight - padding * 2;
    const project = (x: number, z: number): [number, number] => [
      padding + ((x - bounds.minX) / worldWidth) * usableWidth,
      padding + (1 - (z - bounds.minZ) / worldDepth) * usableHeight,
    ];

    context.save();
    context.beginPath();
    context.rect(padding, padding, usableWidth, usableHeight);
    context.clip();

    for (const resource of data.resources ?? []) {
      const [x, y] = project(resource.x, resource.z);
      const abundance = Math.min(1, Math.max(0.18, (resource.amount ?? 0.55)));
      const radius = Math.max(1.2, Math.min(5, resource.radius ?? 2.2));
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = resource.color ?? `rgba(226, 163, 70, ${0.28 + abundance * 0.42})`;
      context.fill();
    }

    for (const entity of data.entities ?? []) {
      const [x, y] = project(entity.x, entity.z);
      const heading = -(entity.rotation ?? 0);
      const color = entity.color ?? ENTITY_COLORS[entity.kind] ?? "#8ba8a4";
      context.save();
      context.translate(x, y);
      context.rotate(heading);
      context.globalAlpha = entity.active === false ? 0.38 : 0.92;
      context.fillStyle = color;
      if (entity.kind === "belt") {
        context.fillRect(-2.8, -0.8, 5.6, 1.6);
        context.fillStyle = "rgba(225, 255, 248, 0.75)";
        context.fillRect(1.2, -0.35, 1.3, 0.7);
      } else if (entity.kind === "fluidPipe") {
        context.fillRect(-3, -0.65, 6, 1.3);
        context.fillStyle = "rgba(220, 255, 244, 0.72)";
        context.beginPath();
        context.arc(2.45, 0, 0.8, 0, Math.PI * 2);
        context.fill();
      } else if (
        entity.kind === "fluidTank" ||
        entity.kind === "fluidSource"
      ) {
        context.beginPath();
        context.arc(0, 0, entity.kind === "fluidTank" ? 2.8 : 2.35, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "rgba(226, 255, 247, 0.72)";
        context.lineWidth = 0.75;
        context.beginPath();
        context.arc(0, 0, entity.kind === "fluidTank" ? 1.55 : 1.2, 0, Math.PI * 2);
        context.stroke();
      } else if (entity.kind === "fluidProcessor") {
        context.rotate(Math.PI / 4);
        context.fillRect(-2.5, -2.5, 5, 5);
        context.rotate(-Math.PI / 4);
        context.fillStyle = "rgba(242, 255, 250, 0.7)";
        context.fillRect(-0.55, -2.7, 1.1, 5.4);
      } else if (entity.kind === "fluidPump") {
        context.fillRect(-2.6, -1.5, 5.2, 3);
        context.fillStyle = "rgba(225, 255, 248, 0.76)";
        context.beginPath();
        context.arc(1.25, 0, 0.8, 0, Math.PI * 2);
        context.fill();
      } else if (
        entity.kind === "constantCombinator" ||
        entity.kind === "arithmeticCombinator" ||
        entity.kind === "deciderCombinator"
      ) {
        context.rotate(Math.PI / 4);
        context.fillRect(-1.75, -1.75, 3.5, 3.5);
        context.rotate(-Math.PI / 4);
        context.fillStyle = "rgba(237, 255, 248, 0.86)";
        context.fillRect(-0.55, -0.55, 1.1, 1.1);
      } else if (entity.kind === "uplink") {
        context.rotate(Math.PI / 4);
        context.fillRect(-2.5, -2.5, 5, 5);
        context.rotate(-Math.PI / 4);
        context.strokeStyle = "rgba(115, 242, 210, 0.82)";
        context.lineWidth = 0.9;
        context.beginPath();
        context.arc(0, 0, 4.2, 0, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.moveTo(0, -6);
        context.lineTo(0, 6);
        context.stroke();
      } else if (entity.kind === "beacon") {
        context.beginPath();
        context.arc(0, 0, 2.3, 0, Math.PI * 2);
        context.fill();
      } else {
        context.fillRect(-2.1, -2.1, 4.2, 4.2);
      }
      if (entity.selected) {
        context.globalAlpha = 1;
        context.strokeStyle = "#e7fff8";
        context.lineWidth = 0.8;
        context.strokeRect(-3.3, -3.3, 6.6, 6.6);
      }
      context.restore();
    }

    if (data.view) {
      const [x, y] = project(data.view.x, data.view.z);
      const viewWidth = ((data.view.width ?? worldWidth * 0.15) / worldWidth) * usableWidth;
      const viewHeight =
        ((data.view.depth ?? worldDepth * 0.15) / worldDepth) * usableHeight;
      context.save();
      context.translate(x, y);
      context.rotate(-(data.view.heading ?? 0));
      context.strokeStyle = "rgba(214, 255, 245, 0.8)";
      context.lineWidth = 0.8;
      context.strokeRect(-viewWidth / 2, -viewHeight / 2, viewWidth, viewHeight);
      context.beginPath();
      context.moveTo(0, -5);
      context.lineTo(-2.3, 0);
      context.lineTo(2.3, 0);
      context.closePath();
      context.fillStyle = "#e7fff8";
      context.fill();
      context.restore();
    }
    context.restore();

    context.strokeStyle = "rgba(115, 242, 210, 0.2)";
    context.lineWidth = 1;
    context.strokeRect(padding + 0.5, padding + 0.5, usableWidth - 1, usableHeight - 1);
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    for (const timer of this.toastTimers.values()) window.clearTimeout(timer);
    if (this.resetConfirmTimer !== undefined) {
      window.clearTimeout(this.resetConfirmTimer);
      this.resetConfirmTimer = undefined;
    }
    if (this.buildDockSnapFrame !== undefined) {
      window.cancelAnimationFrame(this.buildDockSnapFrame);
      this.buildDockSnapFrame = undefined;
    }
    this.toastTimers.clear();
    this.toastIdsByKey.clear();
    this.toastKeysById.clear();
    this.toastCooldowns.clear();
    this.toastRepeatCounts.clear();
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.root.replaceChildren();
  }

  private template(): string {
    const cards = BUILD_DEFINITIONS.map(
      (definition) => {
        const category = buildCategoryForKind(definition.kind);
        return `
        <button
          class="build-card"
          type="button"
          data-build="${definition.kind}"
          data-build-category="${category}"
          data-tooltip="${definition.description}"
          style="--card-color: ${definition.color}"
          aria-label="${definition.name}, hotkey ${definition.key}"
          aria-pressed="false"
          ${category === "factory" ? "" : "hidden"}
        >
          <span class="build-key">${definition.key}</span>
          <span class="build-pictogram">${definition.svg}</span>
          <span class="build-name">${definition.name}</span>
          <span class="build-cost"><em data-build-cost="${definition.kind}">${definition.cost}</em> alloy</span>
          <span class="build-state" data-build-state="${definition.kind}">Ready</span>
        </button>`;
      },
    ).join("");
    const categoryTabs = BUILD_CATEGORIES.map(
      (category, index) => `
        <button
          id="build-category-${category.id}"
          class="build-category-tab${index === 0 ? " is-selected" : ""}"
          type="button"
          role="tab"
          data-build-category-select="${category.id}"
          aria-controls="build-dock"
          aria-label="${category.label}"
          aria-selected="${index === 0 ? "true" : "false"}"
          tabindex="${index === 0 ? "0" : "-1"}"
        >${category.shortLabel}</button>`,
    ).join("");

    return `
      <header class="hud-topbar">
        <div class="brand-lockup">
          <span class="brand-glyph" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="brand-name">
            <strong data-ref="factory-name">CINDERLINE</strong>
            <span data-ref="sector-name">AUTONOMOUS FRONTIER // SECTOR 07</span>
          </span>
        </div>
        <div class="telemetry" aria-label="Factory telemetry">
          <div class="telemetry-item">
            <label>Construction stock</label>
            <span class="telemetry-value"><em data-ref="material-value">0</em><small data-ref="material-label">ALLOY</small></span>
          </div>
          <div class="telemetry-item">
            <label>Grid supply</label>
            <span class="telemetry-value"><em data-ref="power-value">0 / 0</em><small>MW</small></span>
            <span class="power-track"><i data-ref="power-track"></i></span>
          </div>
          <div class="telemetry-item">
            <label>Factory flow</label>
            <span class="telemetry-value"><em data-ref="throughput-value">0</em><small>ITEMS/M</small></span>
          </div>
          <div class="telemetry-item">
            <label>Efficiency</label>
            <span class="telemetry-value"><em data-ref="efficiency-value">0%</em><small>NETWORK</small></span>
          </div>
        </div>
        <nav class="top-actions" aria-label="System controls">
          <button class="icon-button rail-toggle-button" type="button" data-action="rail-toggle" aria-label="Open rail authoring console" aria-expanded="false" title="Rail authoring (T)">
            <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4 3h10v9H4zM6 12l-2 4m8-4 2 4M3 16h12M6 6h6M7 9h1m2 0h1"/><circle cx="6.5" cy="12" r="1.2"/><circle cx="11.5" cy="12" r="1.2"/></svg>
          </button>
          <button class="icon-button" type="button" data-action="blueprint-library-toggle" aria-label="Open blueprint library" aria-expanded="false" title="Blueprint library (Shift+B)">
            <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 3.5h5.5c1.3 0 2.5.7 2.5 2v9c0-1.2-1.2-2-2.5-2H3z"/><path d="M15 3.5h-4c-1.1 0-2 .7-2 2v9c0-1.2.9-2 2-2h4z"/></svg>
          </button>
          <button class="icon-button power-retrofit-button" type="button" data-action="power-retrofit" aria-label="Retrofit this legacy save to local relay grids" title="Retrofit to local relay grids" hidden>
            <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2v14M5 5h8M4 9h10M6 16h6"/><path d="m10 5-4 6h4l-2 5 5-8H9z"/></svg>
          </button>
          <button class="icon-button" type="button" data-action="mute" aria-label="Mute audio" title="Mute audio (M)">
            <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 7h3l4-3v10l-4-3H3zM13 6c1.5 1.7 1.5 4.3 0 6M15 4c2.7 2.7 2.7 7.3 0 10"/></svg>
          </button>
          <button class="icon-button" type="button" data-action="help" aria-label="Open field manual" aria-expanded="false" title="Field manual">
            <svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7"/><path d="M7.1 6.6A2.2 2.2 0 0 1 9.2 5c1.4 0 2.4.8 2.4 2 0 1.8-2.4 1.8-2.4 3.5M9.2 13.4v.2"/></svg>
          </button>
          <button class="icon-button session-toggle" type="button" data-action="session-toggle" aria-label="Open save and campaign menu" aria-expanded="false" title="Save & campaign">
            <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 3h10l2 2v10H3zM6 3v4h6V3M6 11h6v4H6z"/><circle cx="13.2" cy="5.2" r=".7"/></svg>
          </button>
          <button class="icon-button" type="button" data-action="pause" aria-label="Pause simulation" title="Pause (Space)">
            <svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7"/><path d="M7 6v6m4-6v6"/></svg>
          </button>
        </nav>
      </header>

      <section
        class="mission-panel"
        data-ref="mission-panel"
        aria-label="Mission objectives"
        aria-live="polite"
      >
        <div class="panel-eyebrow">
          <span data-ref="mission-chapter">PRIMARY DIRECTIVE</span>
          <span data-ref="mission-code">OPS–01</span>
          <button class="mission-collapse" type="button" data-action="mission-collapse" aria-expanded="true" aria-label="Hide mission objectives">
            <span data-ref="mission-collapse-label">HIDE BRIEF</span>
          </button>
        </div>
        <h2 data-ref="mission-title">Establish the line</h2>
        <button class="mission-collapsed-summary" type="button" data-action="mission-expand" aria-label="Show mission objectives">
          <strong data-ref="mission-collapsed-summary">0 / 0 TARGETS READY</strong>
          <span>SHOW OBJECTIVES</span>
        </button>
        <p class="mission-copy" data-ref="mission-copy">Deploy an autonomous production chain across the surveyed field.</p>
        <div class="commission-controls" data-ref="commission-controls" hidden>
          <div class="commission-options" data-ref="commission-options" aria-label="Available commissions"></div>
          <button class="commission-submit" type="button" data-action="commission-submit">Transmit manifest</button>
        </div>
        <div class="objective-list" data-ref="objective-list"></div>
        <div class="mission-progress" aria-hidden="true"><i data-ref="mission-progress"></i></div>
      </section>

      <aside
        class="session-panel"
        data-ref="session-panel"
        data-keyboard-scope
        aria-label="Save and campaign menu"
        hidden
      >
        <header>
          <span><small>LOCAL OPERATIONS</small><strong>SAVE & CAMPAIGN</strong></span>
          <button class="session-close" type="button" data-action="session-close" aria-label="Close save and campaign menu">×</button>
        </header>
        <div class="session-status" data-session-state="new" role="status">
          <i aria-hidden="true"></i>
          <span><strong data-ref="session-state">NEW CAMPAIGN</strong><small data-ref="session-detail">Autosave is ready.</small></span>
        </div>
        <div class="session-actions">
          <button type="button" data-action="session-save">SAVE NOW</button>
          <button type="button" data-action="manual-open">FIELD MANUAL</button>
          <button type="button" data-action="session-restore" hidden>RESTORE PRE-RESET</button>
          <button class="session-reset" type="button" data-action="session-reset">RESET CAMPAIGN</button>
        </div>
        <p>Reset requires confirmation and keeps the previous local session as a restorable backup.</p>
      </aside>

      <section
        class="field-manual"
        data-ref="field-manual"
        data-keyboard-scope
        role="dialog"
        aria-modal="true"
        aria-labelledby="field-manual-title"
        hidden
      >
        <article class="field-manual-card">
          <header>
            <span><small>OPERATOR BRIEF // M1</small><strong id="field-manual-title">FIELD MANUAL</strong></span>
            <button type="button" data-action="manual-close" aria-label="Close field manual">×</button>
          </header>
          <div class="field-manual-body">
            <section class="manual-objective">
              <span class="manual-kicker">FIRST CONTRACT</span>
              <h2>Feed the Commission Uplink</h2>
              <ol>
                <li><b>Finish iron.</b> Put an inserter on the starter smelter’s output, then drag belts into the pulsing cyan <em>DOCK</em> tile on the Uplink’s left-hand cargo bridge (X21 Z12). The final belt auto-aligns eastbound.</li>
                <li><b>Add copper and brick.</b> Mine the copper and stone seams, smelt each recipe, and merge their finished cargo into the same dock.</li>
                <li><b>Transmit.</b> When all three mission counters are full, press <em>Transmit manifest</em> to earn alloy and unlock the next tier.</li>
              </ol>
              <span class="manual-kicker manual-stage-kicker">SECOND CONTRACT</span>
              <h2>Commission Throughput</h2>
              <ol>
                <li><b>Automate coal first.</b> Spend the Bootstrap reward on a short powered coal spur into the original generator before adding the heavier process load.</li>
                <li><b>Build one Precision Fabricator.</b> Side-tap the moving mixed-plate belt, configure <em>Iron gear</em>, and return its output to the Uplink.</li>
                <li><b>Retool and transmit.</b> After 20 gears are secured, select that same Fabricator and switch it to <em>Copper wire</em>. Secure 40 wire, then transmit to reveal Dispatch manifolds and fluid processing.</li>
              </ol>
            </section>
            <section class="manual-controls" aria-label="Desktop controls">
              <span class="manual-kicker">DESKTOP</span>
              <dl>
                <div><dt>Move view</dt><dd>WASD / middle or Alt-drag</dd></div>
                <div><dt>Zoom</dt><dd>Mouse wheel</dd></div>
                <div><dt>Build</dt><dd>1–9/0, then click or drag belts</dd></div>
                <div><dt>Rotate / cancel</dt><dd>R / Esc or right-click</dd></div>
                <div><dt>Inspect</dt><dd>Click a machine</dd></div>
                <div><dt>Undo / redo</dt><dd>Ctrl/⌘ Z / Shift Z</dd></div>
              </dl>
            </section>
            <section class="manual-controls" aria-label="Touch controls">
              <span class="manual-kicker">TOUCH</span>
              <dl>
                <div><dt>Move view</dt><dd>Drag one finger with no tool armed</dd></div>
                <div><dt>Zoom</dt><dd>Pinch with two fingers</dd></div>
                <div><dt>Build</dt><dd>Tap a card, then tap the world</dd></div>
                <div><dt>Rotate / cancel</dt><dd>Use the controls above the build dock</dd></div>
                <div><dt>Inspect</dt><dd>Tap a machine with no tool armed</dd></div>
                <div><dt>Dismantle</dt><dd>Tap a machine, then tap Dismantle</dd></div>
                <div><dt>Power / relays</dt><dd>${MOBILE_POWER_RELAY_GUIDANCE}</dd></div>
                <div><dt>Refocus</dt><dd>Tap Center</dd></div>
              </dl>
            </section>
          </div>
          <footer><button type="button" data-action="manual-close">RETURN TO FACTORY</button></footer>
        </article>
      </section>

      <section
        class="blueprint-panel"
        data-ref="blueprint-panel"
        hidden
      >
        <header>
          <span data-ref="blueprint-mode">PLAN HOLOGRAM</span>
          <strong data-ref="blueprint-transform">ROT 0°</strong>
        </header>
        <div class="blueprint-metrics">
          <span><small>UNITS</small><b data-ref="blueprint-units">0</b></span>
          <span><small>FOOTPRINT</small><b data-ref="blueprint-dimensions">0×0</b></span>
          <span><small>PLAN COST</small><b data-ref="blueprint-cost">0</b><em> alloy</em></span>
          <span><small>STOCK</small><b data-ref="blueprint-stock">0</b><em> alloy</em></span>
        </div>
        <p class="blueprint-status" data-ref="blueprint-status" role="status" aria-live="polite">Choose a destination.</p>
        <div class="blueprint-legend" aria-label="Blueprint placement states">
          <span data-state="construct"><i aria-hidden="true"></i>NEW <b data-ref="blueprint-construct-count">0</b></span>
          <span data-state="configure"><i aria-hidden="true"></i>CONFIG <b data-ref="blueprint-configure-count">0</b></span>
          <span data-state="match"><i aria-hidden="true"></i>MATCH <b data-ref="blueprint-match-count">0</b></span>
          <span data-state="blocked"><i aria-hidden="true"></i>BLOCKED <b data-ref="blueprint-blocked-count">0</b></span>
        </div>
        <div class="blueprint-actions" aria-label="Blueprint controls">
          <button type="button" data-blueprint-transform data-action="blueprint-rotate" aria-label="Rotate blueprint clockwise">↻<span>ROTATE</span></button>
          <button type="button" data-blueprint-transform data-action="blueprint-mirror-h" aria-label="Mirror blueprint horizontally">↔<span>FLIP H</span></button>
          <button type="button" data-blueprint-transform data-action="blueprint-mirror-v" aria-label="Mirror blueprint vertically">↕<span>FLIP V</span></button>
          <button type="button" data-action="blueprint-undo" aria-label="Undo last construction command">↶<span>UNDO</span></button>
          <button type="button" data-action="blueprint-redo" aria-label="Redo the last reversed construction command">↷<span>REDO</span></button>
          <button type="button" data-action="blueprint-cancel" aria-label="Cancel blueprint tool">×<span>CANCEL</span></button>
        </div>
      </section>

      <div class="blueprint-library-layer" data-ref="blueprint-library-layer" hidden>
        <button class="blueprint-library-scrim" type="button" data-action="blueprint-library-toggle" aria-label="Close blueprint library"></button>
        <section class="blueprint-library-console" role="dialog" aria-modal="true" aria-labelledby="blueprint-library-title">
          <header class="blueprint-library-header">
            <span class="blueprint-library-mark" aria-hidden="true"><i></i><i></i><i></i></span>
            <div>
              <small>FIELD ENGINEERING ARCHIVE // LOCAL VAULT</small>
              <h2 id="blueprint-library-title">Blueprint Library</h2>
            </div>
            <span class="blueprint-library-count" data-ref="blueprint-library-count">0 RECORDS</span>
            <button class="icon-button" type="button" data-action="blueprint-library-toggle" aria-label="Close blueprint library">×</button>
          </header>
          <div class="blueprint-library-body">
            <section class="blueprint-library-browser" aria-label="Saved blueprint records">
              <div class="blueprint-library-subhead">
                <span>Plan vault</span>
                <small data-ref="blueprint-library-index-summary">0 plans · 0 books</small>
              </div>
              <div class="blueprint-library-tree" data-ref="blueprint-library-tree" role="tree" aria-label="Blueprint library"></div>
              <aside class="blueprint-library-vault-dossier" data-ref="blueprint-library-vault-dossier" aria-live="polite" hidden></aside>
              <footer class="blueprint-library-vault-status">
                <span aria-hidden="true"><i></i><i></i><i></i><i></i></span>
                <p><strong>Local archive</strong><small>Versioned plans remain available with this frontier save.</small></p>
                <b>V2</b>
              </footer>
            </section>
            <section class="blueprint-library-detail" aria-label="Selected blueprint details">
              <div class="blueprint-library-subhead">
                <span>Assembly desk</span>
                <small>Name · save · deploy</small>
              </div>
              <div class="blueprint-library-compose">
                <label class="blueprint-library-name">
                  <span>Record name</span>
                  <input data-ref="blueprint-library-name" maxlength="64" autocomplete="off" placeholder="New frontier plan">
                </label>
                <div class="blueprint-library-capture">
                  <span class="blueprint-library-clipboard-mark" aria-hidden="true">
                    <svg viewBox="0 0 28 28"><path d="M7 6h14v18H7zM10 6V3h8v3M10 11h8m-8 4h8m-8 4h5"/><path d="m18 18 2 2 4-5"/></svg>
                  </span>
                  <span><small>Clipboard ready</small><strong data-ref="blueprint-library-selection">No plan armed</strong></span>
                  <button class="is-primary" type="button" data-action="blueprint-library-save">
                    <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 3h10l2 2v10H3zM6 3v5h6V3M6 12h6"/></svg>
                    <span>Save plan</span>
                  </button>
                  <button type="button" data-action="blueprint-library-new-book">
                    <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 3h5.5c1.2 0 2.5.7 2.5 2v10c0-1.2-1.3-2-2.5-2H3zM15 3h-4c-1.1 0-2 .7-2 2v10c0-1.2.9-2 2-2h4z"/><path d="M5 8h3m-1.5-1.5v3"/></svg>
                    <span>New book</span>
                  </button>
                </div>
              </div>
              <div class="blueprint-library-selected" data-ref="blueprint-library-selected">
                <div class="blueprint-library-selected-heading">
                  <span><small>Selected record</small><b>Review topology before deployment</b></span>
                  <i aria-hidden="true"></i>
                </div>
                <div class="blueprint-library-selected-record">
                  <div class="blueprint-library-selected-preview" data-ref="blueprint-library-selected-preview" aria-hidden="true"></div>
                  <div class="blueprint-library-selected-copy">
                    <strong data-ref="blueprint-library-description">Choose a plan or book from the archive.</strong>
                    <div class="blueprint-library-selected-identity" data-ref="blueprint-library-selected-identity" aria-label="Selected blueprint production identity"></div>
                  </div>
                </div>
                <div class="blueprint-library-selected-actions">
                  <button class="is-deploy" type="button" data-action="blueprint-library-load" disabled>
                    <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 9h9m-4-4 4 4-4 4M15 3v12"/></svg>
                    <span>Load to cursor</span>
                  </button>
                  <button class="blueprint-library-tools-toggle" type="button" data-action="blueprint-library-tools-toggle" aria-expanded="false">
                    <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M10 3a4 4 0 0 0-4 5l-3 3 4 4 3-3a4 4 0 0 0 5-4l-3 2-2-2z"/></svg>
                    <span>Manage record</span><i aria-hidden="true">＋</i>
                  </button>
                  <div class="blueprint-library-secondary-actions" data-ref="blueprint-library-secondary-actions">
                    <div class="blueprint-library-edit-actions" aria-label="Edit selected record">
                      <button type="button" data-action="blueprint-library-update" disabled>
                        <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m3 13 1 2 2-1 8-8-3-3zM9 5l3 3M3 15h6"/></svg>
                        <span>Rename</span>
                      </button>
                      <button type="button" data-action="blueprint-library-reassign" disabled>
                        <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 4h8v8H3zM7 8h8v7H7z"/><path d="m11 3 2 2-2 2"/></svg>
                        <span>Replace</span>
                      </button>
                      <button type="button" data-action="blueprint-library-duplicate" disabled>
                        <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 3h9v9H3zM6 6h9v9H6z"/></svg>
                        <span>Duplicate</span>
                      </button>
                    </div>
                    <div class="blueprint-library-order-actions" aria-label="Reorder selected record">
                      <button type="button" data-action="blueprint-library-move-up" aria-label="Move selected record up" title="Move up" disabled>
                        <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m5 10 4-4 4 4M9 6v8"/></svg>
                        <span>Move up</span>
                      </button>
                      <button type="button" data-action="blueprint-library-move-down" aria-label="Move selected record down" title="Move down" disabled>
                        <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m5 8 4 4 4-4M9 4v8"/></svg>
                        <span>Move down</span>
                      </button>
                      <button class="is-danger" type="button" data-action="blueprint-library-delete" disabled>
                        <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4 5h10M7 5V3h4v2m2 0-1 10H6L5 5m3 3v4m2-4v4"/></svg>
                        <span>Delete</span>
                      </button>
                      <button class="is-restore" type="button" data-action="blueprint-library-restore-delete" disabled>
                        <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M5 6H2V3M3 6a6 6 0 1 1 0 6M6 9h6"/></svg>
                        <span>Restore</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <details class="blueprint-library-transfer">
                <summary>
                  <span>
                    <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M6 5 3 8l3 3M3 8h9m0-1 3 3-3 3m3-3H6"/></svg>
                    <b>Transfer &amp; recovery</b>
                  </span>
                  <small>Canonical share string · V2</small>
                </summary>
                <div class="blueprint-library-transfer-body">
                  <label class="blueprint-library-share">
                    <span>Share string</span>
                    <textarea data-ref="blueprint-library-share" spellcheck="false" placeholder="Export creates a canonical string. Paste one here to import a complete library."></textarea>
                  </label>
                  <div class="blueprint-library-share-actions">
                    <button type="button" data-action="blueprint-library-export">
                      <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 3v9m-3-3 3 3 3-3M3 14h12"/></svg>
                      <span>Export &amp; copy</span>
                    </button>
                    <button type="button" data-action="blueprint-library-import">
                      <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 15V6m-3 3 3-3 3 3M3 3h12"/></svg>
                      <span>Import safely</span>
                    </button>
                  </div>
                  <p class="blueprint-library-assurance">Catalog-bound · duplicate-key rejection · 16 MiB limit · atomic import</p>
                </div>
              </details>
            </section>
          </div>
        </section>
      </div>

      <section
        class="rail-console"
        data-ref="rail-console"
        data-keyboard-scope="rail"
        aria-labelledby="rail-console-title"
        aria-hidden="true"
        hidden
      >
        <header class="rail-console-header">
          <span>
            <small>NETWORK CONSTRUCTION</small>
            <strong id="rail-console-title">RAIL AUTHORING</strong>
          </span>
          <div class="rail-console-header-actions">
            <button type="button" data-action="rail-rotate" aria-label="Rotate active rail tool clockwise">↻ <span>ROTATE</span></button>
            <button type="button" data-action="rail-cancel" aria-label="Cancel active rail tool or signal source">× <span>CANCEL</span></button>
            <button type="button" class="rail-console-collapse" data-action="rail-collapse" aria-label="Collapse rail authoring to expose the map" aria-expanded="true">⌄ <span>MAP</span></button>
            <button type="button" data-action="rail-toggle" aria-label="Close rail authoring console">⌄ <span>CLOSE</span></button>
          </div>
        </header>
        <div class="rail-console-readout" aria-label="Rail authoring state">
          <span><small>ORIENTATION</small><b data-ref="rail-rotation">0°</b></span>
          <span class="rail-selection-readout"><small>TARGET</small><b data-ref="rail-selection">None</b></span>
        </div>
        <p class="rail-status" data-ref="rail-status" role="status" aria-live="polite" aria-atomic="true">Rail console closed.</p>
        <div class="rail-tools" data-ref="rail-tools" role="group" aria-label="Rail construction tools"></div>
        <div class="rail-editor" data-ref="rail-editor"></div>
        <footer class="rail-console-footer">
          <button type="button" class="rail-dismantle" data-action="rail-dismantle" disabled>DISMANTLE TARGET</button>
          <span><kbd>1–8</kbd> TOOL · <kbd>R</kbd> ROTATE · <kbd>ESC</kbd> CANCEL</span>
        </footer>
      </section>

      <aside class="inspector" data-ref="inspector" aria-label="Selected machine inspector" aria-hidden="true">
        <button class="icon-button inspector-close" type="button" data-action="close-inspector" aria-label="Close inspector">
          <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m5 5 8 8m0-8-8 8"/></svg>
        </button>
        <div class="panel-eyebrow"><span data-ref="inspector-type">MACHINE INSPECTOR</span><span>LIVE</span></div>
        <h2 data-ref="inspector-name">No selection</h2>
        <div class="inspector-status" data-ref="inspector-status"><i></i><span>OFFLINE</span></div>
        <div class="stat-grid" data-ref="inspector-stats"></div>
        <div class="inspector-actions" data-ref="inspector-actions" hidden></div>
        <div class="recipe-chip" data-ref="recipe-chip">
          <span class="recipe-icon" data-ref="recipe-icon">—</span>
          <span><b data-ref="recipe-label">No recipe</b><br><small data-ref="recipe-detail">Awaiting assignment</small></span>
        </div>
        <section
          class="circuit-console"
          data-ref="circuit-console"
          data-keyboard-scope="circuit"
          aria-labelledby="circuit-console-title"
          hidden
        >
          <header class="circuit-console-heading">
            <span><i aria-hidden="true"></i><b id="circuit-console-title">CIRCUIT AUTHORING</b></span>
            <small>RED / GREEN NETWORK</small>
          </header>
          <div class="circuit-live" data-ref="circuit-live" role="status" aria-live="polite" aria-atomic="false" aria-label="Live circuit values"></div>
          <div class="circuit-program" data-ref="circuit-program"></div>
          <section class="circuit-patchbay" aria-labelledby="circuit-patchbay-title">
            <header>
              <b id="circuit-patchbay-title">PATCHBAY</b>
              <small>9 TILE REACH</small>
            </header>
            <p class="circuit-wire-status" data-ref="circuit-wire-status" role="status" aria-live="polite"></p>
            <div class="circuit-endpoints" data-ref="circuit-endpoints"></div>
            <div class="circuit-wires" data-ref="circuit-wires"></div>
          </section>
        </section>
        <section
          class="process-console"
          data-ref="process-console"
          data-keyboard-scope="recipes"
          aria-labelledby="process-console-title"
          hidden
        >
          <div class="process-metrics" aria-label="Machine process telemetry">
            <span class="process-metric" data-process-metric="cycle"><small>CYCLE</small><strong>0%</strong><em>CHAMBER</em></span>
            <span class="process-metric" data-process-metric="timing"><small>TIMING</small><strong>—</strong><em>BASE / LIVE</em></span>
            <span class="process-metric" data-process-metric="power"><small>POWER</small><strong>0%</strong><em>0 kW</em></span>
            <span class="process-metric" data-process-metric="speed"><small>SPEED</small><strong>0.00×</strong><em>BASE 0.00×</em></span>
          </div>

          <div
            class="process-flow"
            role="group"
            aria-label="Material path: input, chamber, output, with reclaim priority"
          >
            <section class="process-stage" data-process-stage="input">
              <header><span>INPUT</span><small data-ref="process-input-slots">0 / 0 slots</small></header>
              <ul class="process-stack-list" data-ref="process-input-list"></ul>
            </section>
            <i class="process-arrow" aria-hidden="true">→</i>
            <section class="process-stage process-stage-chamber" data-process-stage="chamber">
              <header><span>CHAMBER</span><small>COMMITTED</small></header>
              <strong data-ref="process-chamber-name">Chamber clear</strong>
              <div class="process-chamber-formula" data-ref="process-chamber-formula">Awaiting committed batch</div>
              <div
                class="process-progress"
                data-ref="process-progress"
                role="progressbar"
                aria-label="Committed batch progress"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow="0"
              ><i></i><span data-ref="process-progress-value">0%</span></div>
            </section>
            <i class="process-arrow" aria-hidden="true">→</i>
            <section class="process-stage" data-process-stage="output">
              <header><span>OUTPUT</span><small data-ref="process-output-slots">0 / 0 slots</small></header>
              <ul class="process-stack-list" data-ref="process-output-list"></ul>
            </section>
          </div>

          <section
            class="process-reclaim"
            data-process-reclaim
            aria-label="Reclaim buffer, extraction priority"
          >
            <header><span>RECLAIM</span><small>EXTRACTION PRIORITY · <b data-ref="process-reclaim-slots">0 slots</b></small></header>
            <ul class="process-stack-list" data-ref="process-reclaim-list"></ul>
          </section>

          <p
            id="process-condition"
            class="process-condition"
            data-process-condition
            role="status"
            aria-live="polite"
            aria-atomic="true"
          ></p>

          <div class="recipe-console-heading">
            <span id="process-console-title">RECIPE TARGET</span>
            <small>ARROWS TO NAVIGATE · ENTER TO ARM</small>
          </div>
          <div
            class="recipe-grid"
            data-ref="recipe-grid"
            role="group"
            aria-label="Recipe target"
          ></div>
        </section>
        <section class="manifold-controls" data-ref="manifold-controls" aria-label="Dispatch routing controls" hidden>
          <div class="manifold-heading">
            <span>ROUTING POLICY</span>
            <svg class="manifold-local-map" viewBox="0 0 82 36" role="img" aria-label="Local ports: common feed branches left to A and right to B">
              <path class="manifold-map-rail" d="M41 34V18M41 18 13 5M41 18 69 5"/>
              <path class="manifold-map-flow" d="m37 29 4 5 4-5M20 5h-7l3 6M62 5h7l-3 6"/>
              <circle cx="41" cy="18" r="3"/>
              <text x="2" y="9">A</text>
              <text x="74" y="9">B</text>
            </svg>
          </div>
          <div class="manifold-modes" role="group" aria-label="Routing mode">
            <button type="button" data-manifold-mode="even" aria-pressed="false">Even</button>
            <button type="button" data-manifold-mode="favorA" aria-pressed="false">Favor A</button>
            <button type="button" data-manifold-mode="favorB" aria-pressed="false">Favor B</button>
            <button type="button" data-manifold-mode="extract" aria-pressed="false">Extract</button>
          </div>
          <div class="manifold-modes manifold-extract-ports" data-ref="manifold-extract-ports" role="group" aria-label="Extract matching output port" hidden>
            <button type="button" data-manifold-extract-port="0" aria-pressed="true" aria-label="Route matching payloads to local port A">Match → A</button>
            <button type="button" data-manifold-extract-port="1" aria-pressed="false" aria-label="Route matching payloads to local port B">Match → B</button>
          </div>
          <label class="manifold-filter" data-ref="manifold-filter-field">
            <span>Extract payload</span>
            <select data-ref="manifold-filter" aria-label="Payload extracted to local port A"></select>
            <small data-ref="manifold-filter-hint">Match → A · Remainder → B</small>
          </label>
          <div class="manifold-state" aria-label="Live manifold routing state">
            <span><b>A</b><em data-ref="manifold-port-a">0 queued</em></span>
            <span><b>B</b><em data-ref="manifold-port-b">0 queued</em></span>
            <span><small>Split</small><strong data-ref="manifold-next-split">L0:A · L1:B</strong></span>
            <span><small>Merge</small><strong data-ref="manifold-next-merge">L0:A · L1:B</strong></span>
          </div>
        </section>
      </aside>

      <aside class="minimap-shell" aria-label="Factory overview">
        <span class="minimap-title">TACTICAL OVERVIEW // LIVE</span>
        <canvas id="minimap"></canvas>
      </aside>

      <output class="coordinate-readout" aria-label="World coordinates">
        <span>X <b data-ref="coordinate-x">+000.0</b></span>
        <span>Z <b data-ref="coordinate-z">+000.0</b></span>
      </output>

      <section class="build-palette" aria-label="Construction palette">
        <nav class="mobile-world-controls" aria-label="Touch world controls">
          <button type="button" data-action="mobile-rotate">↻ <span>ROTATE</span></button>
          <button type="button" data-action="mobile-cancel">× <span>CANCEL TOOL</span></button>
          <button type="button" data-action="mobile-dismantle">⌫ <span>DISMANTLE</span></button>
          <button type="button" data-action="mobile-focus">◎ <span>CENTER</span></button>
        </nav>
        <div class="build-category-tabs" role="tablist" aria-label="Construction categories">${categoryTabs}</div>
        <nav
          id="build-dock"
          class="build-dock"
          role="tabpanel"
          aria-labelledby="build-category-factory"
        >${cards}</nav>
      </section>

      <div class="context-help" aria-label="Controls">
        <span><kbd>1–9/0</kbd> BUILD</span>
        <span><kbd>SHIFT+1–8</kbd> ADVANCED</span>
        <span><kbd>T</kbd> RAIL</span>
        <span><kbd>B</kbd> BLUEPRINT</span>
        <span><kbd>R</kbd> ROTATE</span>
        <span><kbd>DEL</kbd> DISMANTLE</span>
        <span><kbd>RMB</kbd> CANCEL</span>
        <span><kbd>WASD</kbd> PAN</span>
        <span><kbd>SCROLL</kbd> ZOOM</span>
      </div>

      <div class="toast-stack" data-ref="toast-stack" aria-live="polite"></div>
      <div class="tooltip" data-ref="tooltip" role="tooltip"></div>
      <div class="pause-plate" data-ref="pause-plate" aria-hidden="true">
        <strong>PAUSED</strong>
        <span>SPACE TO RESUME OPERATIONS</span>
      </div>
      <div class="scanlines" aria-hidden="true"></div>
    `;
  }

  private bindInteractions(bindHotkeys: boolean): void {
    for (const button of this.railToggleButtons) {
      this.listen(
        button,
        "click",
        () => this.callbacks.onRailToggle?.(),
      );
    }
    this.listen(
      this.requireElement<HTMLButtonElement>(
        "[data-action='rail-rotate']",
      ),
      "click",
      () => this.callbacks.onRailRotate?.(),
    );
    this.listen(
      this.requireElement<HTMLButtonElement>(
        "[data-action='rail-cancel']",
      ),
      "click",
      () => this.callbacks.onRailCancel?.(),
    );
    this.listen(
      this.requireElement<HTMLButtonElement>(
        "[data-action='rail-collapse']",
      ),
      "click",
      () => this.setRailConsoleCollapsed(!this.railConsoleCollapsed),
    );
    this.listen(
      this.requireElement<HTMLButtonElement>(
        "[data-action='rail-dismantle']",
      ),
      "click",
      () => this.callbacks.onRailDismantle?.(),
    );
    this.listen(this.railConsole, "keydown", (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          "input, select, textarea, [contenteditable='true'], [contenteditable='']",
        )
      ) {
        return;
      }
      const digit = /^Digit([1-8])$/.exec(event.code);
      const kind = digit
        ? RAIL_BUILD_KINDS[Number(digit[1]) - 1]
        : undefined;
      if (kind) {
        event.preventDefault();
        event.stopPropagation();
        this.callbacks.onRailToolSelect?.(kind);
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "r") {
        event.preventDefault();
        event.stopPropagation();
        this.callbacks.onRailRotate?.();
      } else if (key === "escape") {
        event.preventDefault();
        event.stopPropagation();
        this.callbacks.onRailCancel?.();
      } else if (key === "t") {
        event.preventDefault();
        event.stopPropagation();
        this.callbacks.onRailToggle?.();
      } else if (key === "delete" || key === "backspace") {
        event.preventDefault();
        event.stopPropagation();
        this.callbacks.onRailDismantle?.();
      }
    });
    this.listen(this.railTools, "click", (event) => {
      const button =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>("[data-rail-tool]")
          : null;
      const kind = button?.dataset.railTool as
        | RailBuildKind
        | undefined;
      if (kind && button?.dataset.railEnabled === "true") {
        this.callbacks.onRailToolSelect?.(kind);
      }
    });
    this.listen(this.railEditor, "submit", (event) => {
      event.preventDefault();
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.matches("[data-rail-station-form]")) {
        this.submitRailStationForm(form);
      } else if (form.matches("[data-rail-schedule-form]")) {
        this.submitRailScheduleForm(form);
      }
    });
    this.listen(this.railEditor, "change", (event) => {
      const target = event.target;
      if (
        target instanceof HTMLSelectElement &&
        target.matches("[data-rail-wait-type]")
      ) {
        const row = target.closest<HTMLElement>("[data-rail-stop]");
        if (row) this.syncRailWaitRow(row);
      }
      if (
        target instanceof HTMLInputElement &&
        target.matches("[data-rail-no-filter]")
      ) {
        const form = target.closest<HTMLFormElement>(
          "[data-rail-station-form]",
        );
        for (const checkbox of form?.querySelectorAll<HTMLInputElement>(
          "[data-rail-filter-item]",
        ) ?? []) {
          checkbox.disabled = target.checked;
        }
      }
    });
    this.listen(this.railEditor, "click", (event) => {
      const button =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>("[data-rail-editor-action]")
          : null;
      if (!button || button.disabled) return;
      this.handleRailEditorAction(button);
    });
    for (const card of this.root.querySelectorAll<HTMLButtonElement>("[data-build]")) {
      const kind = card.dataset.build as BuildKind;
      this.listen(card, "click", () => {
        const unlocked = this.model.buildAvailability?.[kind] ?? true;
        const affordable = this.model.buildAffordability?.[kind] ?? true;
        if (!unlocked || !affordable) return;
        if (this.isShortMobileViewport()) this.setMissionCollapsed(true);
        this.callbacks.onBuildSelect?.(kind);
      });
      this.listen(card, "pointerenter", (event) => this.showTooltip(card, event));
      this.listen(card, "pointermove", (event) => this.showTooltip(card, event));
      this.listen(card, "pointerleave", () => this.hideTooltip());
      this.listen(card, "focus", () => this.showTooltip(card));
      this.listen(card, "blur", () => this.hideTooltip());
    }
    const buildDock = this.requireElement<HTMLElement>("#build-dock");
    this.listen(buildDock, "touchstart", (event) =>
      this.beginBuildDockTouch(buildDock, event));
    this.listen(buildDock, "touchend", (event) =>
      this.endBuildDockTouch(buildDock, event));
    this.listen(buildDock, "touchcancel", () => this.cancelBuildDockTouch());
    const categoryTabs = Array.from(
      this.root.querySelectorAll<HTMLButtonElement>(
        "[data-build-category-select]",
      ),
    );
    for (const [index, tab] of categoryTabs.entries()) {
      this.listen(tab, "click", () => {
        const category = tab.dataset
          .buildCategorySelect as BuildCategory | undefined;
        if (category) this.setBuildCategory(category);
      });
      this.listen(tab, "keydown", (event) => {
        if (!(event instanceof KeyboardEvent)) return;
        let nextIndex: number | undefined;
        if (event.key === "ArrowLeft") nextIndex = index - 1;
        if (event.key === "ArrowRight") nextIndex = index + 1;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = categoryTabs.length - 1;
        if (nextIndex === undefined) return;
        event.preventDefault();
        const next =
          categoryTabs[
            (nextIndex + categoryTabs.length) % categoryTabs.length
          ];
        const category = next?.dataset
          .buildCategorySelect as BuildCategory | undefined;
        if (next && category) {
          this.setBuildCategory(category);
          next.focus();
        }
      });
    }
    this.listen(
      this.requireElement<HTMLButtonElement>(
        "[data-action='blueprint-rotate']",
      ),
      "click",
      () => this.callbacks.onRotate?.(),
    );
    this.listen(
      this.requireElement<HTMLButtonElement>(
        "[data-action='blueprint-mirror-h']",
      ),
      "click",
      () => this.callbacks.onBlueprintMirror?.("horizontal"),
    );
    this.listen(
      this.requireElement<HTMLButtonElement>(
        "[data-action='blueprint-mirror-v']",
      ),
      "click",
      () => this.callbacks.onBlueprintMirror?.("vertical"),
    );
    this.listen(
      this.requireElement<HTMLButtonElement>(
        "[data-action='blueprint-undo']",
      ),
      "click",
      () => this.callbacks.onUndo?.(),
    );
    this.listen(
      this.requireElement<HTMLButtonElement>(
        "[data-action='blueprint-redo']",
      ),
      "click",
      () => this.callbacks.onRedo?.(),
    );
    this.listen(
      this.requireElement<HTMLButtonElement>(
        "[data-action='blueprint-cancel']",
      ),
      "click",
      () => this.callbacks.onCancel?.(),
    );
    for (const button of this.root.querySelectorAll<HTMLButtonElement>(
      "[data-action='blueprint-library-toggle']",
    )) {
      this.listen(
        button,
        "click",
        () => this.callbacks.onBlueprintLibraryToggle?.(),
      );
    }
    this.listen(this.blueprintLibrarySave, "click", () => {
      this.callbacks.onBlueprintLibrarySave?.(
        this.blueprintLibraryName.value,
      );
    });
    this.listen(
      this.requireElement<HTMLButtonElement>(
        "[data-action='blueprint-library-new-book']",
      ),
      "click",
      () => this.callbacks.onBlueprintLibraryCreateBook?.(
        this.blueprintLibraryName.value,
      ),
    );
    this.listen(this.blueprintLibraryTree, "click", (event) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>("[data-library-id]")
          : null;
      const id = target?.dataset.libraryId;
      if (id) this.callbacks.onBlueprintLibrarySelect?.(id);
    });
    this.listen(
      this.blueprintLibraryLoad,
      "click",
      () => this.callbacks.onBlueprintLibraryLoad?.(),
    );
    this.listen(
      this.blueprintLibraryUpdate,
      "click",
      () => this.callbacks.onBlueprintLibraryUpdate?.(
        this.blueprintLibraryName.value,
      ),
    );
    this.listen(
      this.blueprintLibraryReassign,
      "click",
      () => this.callbacks.onBlueprintLibraryReassign?.(),
    );
    this.listen(
      this.blueprintLibraryDuplicate,
      "click",
      () => this.callbacks.onBlueprintLibraryDuplicate?.(),
    );
    this.listen(this.blueprintLibraryToolsToggle, "click", () => {
      const expanded =
        !this.blueprintLibrarySelectedPanel.classList.contains(
          "is-tools-open",
        );
      this.blueprintLibrarySelectedPanel.classList.toggle(
        "is-tools-open",
        expanded,
      );
      this.blueprintLibraryToolsToggle.setAttribute(
        "aria-expanded",
        String(expanded),
      );
      if (expanded && window.matchMedia("(max-width: 690px)").matches) {
        window.setTimeout(() => {
          this.blueprintLibrarySelectedPanel.scrollIntoView({
            block: "start",
          });
        }, 0);
      }
    });
    this.listen(
      this.blueprintLibraryMoveUp,
      "click",
      () => this.callbacks.onBlueprintLibraryMove?.("up"),
    );
    this.listen(
      this.blueprintLibraryMoveDown,
      "click",
      () => this.callbacks.onBlueprintLibraryMove?.("down"),
    );
    this.listen(
      this.blueprintLibraryDelete,
      "click",
      () => this.callbacks.onBlueprintLibraryDelete?.(),
    );
    this.listen(
      this.blueprintLibraryRestoreDelete,
      "click",
      () => this.callbacks.onBlueprintLibraryRestoreDelete?.(),
    );
    this.listen(
      this.requireElement<HTMLButtonElement>(
        "[data-action='blueprint-library-export']",
      ),
      "click",
      () => {
        const serialized = this.callbacks.onBlueprintLibraryExport?.();
        if (typeof serialized !== "string") return;
        this.blueprintLibraryShare.value = serialized;
        this.blueprintLibraryShare.focus();
        this.blueprintLibraryShare.select();
        this.blueprintLibraryShare.scrollTop = 0;
        this.blueprintLibraryShare.scrollLeft = 0;
        void navigator.clipboard?.writeText(serialized).catch(() => {
          // The selected textarea remains a complete manual-copy fallback.
        });
      },
    );
    this.listen(
      this.requireElement<HTMLButtonElement>(
        "[data-action='blueprint-library-import']",
      ),
      "click",
      () => {
        this.callbacks.onBlueprintLibraryImport?.(
          this.blueprintLibraryShare.value,
        );
        this.blueprintLibraryShare.setSelectionRange(0, 0);
        this.blueprintLibraryShare.scrollTop = 0;
        this.blueprintLibraryShare.scrollLeft = 0;
      },
    );
    this.listen(this.blueprintLibraryLayer, "keydown", (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        this.callbacks.onBlueprintLibraryToggle?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...this.blueprintLibraryLayer.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
        ),
      ].filter((element) => !element.hidden && element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    for (const button of this.root.querySelectorAll<HTMLButtonElement>(
      "[data-manifold-mode]",
    )) {
      this.listen(button, "click", () => {
        const mode = button.dataset.manifoldMode as ManifoldMode | undefined;
        if (mode) this.commitManifoldRouting(mode);
      });
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>(
      "[data-manifold-extract-port]",
    )) {
      this.listen(button, "click", () => {
        const port = Number(button.dataset.manifoldExtractPort);
        if (port === 0 || port === 1) {
          this.commitManifoldRouting("extract", undefined, port);
        }
      });
    }
    this.listen(this.manifoldFilter, "change", () => {
      this.commitManifoldRouting(
        "extract",
        this.manifoldFilter.value as ItemId,
        this.model.inspector?.manifoldRouting?.extractPort,
      );
    });
    this.listen(this.recipeGrid, "click", (event) => {
      const target = event.target;
      const button =
        target instanceof Element
          ? target.closest<HTMLButtonElement>("[data-recipe-choice]")
          : null;
      if (!button || !this.recipeGrid.contains(button)) return;
      this.activateRecipeButton(button);
    });
    this.listen(this.processConsole, "keydown", (event) => {
      this.handleProcessConsoleKeyDown(event as KeyboardEvent);
    });
    this.listen(this.circuitConsole, "submit", (event) => {
      event.preventDefault();
      this.commitCircuitForm(event.target);
    });
    this.listen(this.circuitConsole, "click", (event) => {
      this.handleCircuitConsoleClick(event);
    });
    this.listen(this.circuitConsole, "change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
        return;
      }
      if (
        target.matches("[data-circuit-source], [data-circuit-control-toggle]")
      ) {
        this.syncCircuitDraftVisibility();
      }
    });
    this.listen(this.circuitConsole, "keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key === "Escape") {
        const pending = this.model.inspector?.circuit?.pendingWire;
        if (pending) {
          keyboardEvent.preventDefault();
          this.callbacks.onCircuitWireCancel?.();
        }
      }
    });
    this.listen(this.commissionOptions, "click", (event) => {
      const target = event.target;
      const button =
        target instanceof Element
          ? target.closest<HTMLButtonElement>("[data-commission-id]")
          : null;
      const commissionId = button?.dataset.commissionId;
      if (commissionId && !button?.disabled) {
        this.callbacks.onCommissionSelect?.(commissionId);
      }
    });
    this.listen(this.commissionSubmit, "click", () =>
      this.callbacks.onCommissionSubmit?.()
    );
    this.listen(this.missionCollapseButton, "click", () =>
      this.setMissionCollapsed(
        !this.missionPanel.classList.contains("is-collapsed"),
      )
    );
    this.listen(
      this.requireElement("[data-action='mission-expand']"),
      "click",
      () => this.setMissionCollapsed(false),
    );
    this.listen(this.inspectorActions, "click", (event) => {
      const target = event.target;
      const button =
        target instanceof Element
          ? target.closest<HTMLButtonElement>("[data-inspector-action]")
          : null;
      const actionId = button?.dataset.inspectorAction;
      const entityId = this.model.inspector?.id;
      if (actionId && entityId && !button?.disabled) {
        this.callbacks.onInspectorAction?.(entityId, actionId);
      }
    });

    this.listen(this.root, "contextmenu", (event) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          "button, input, textarea, select, [role='button'], [data-keyboard-scope]",
        )
      ) {
        return;
      }
      event.preventDefault();
      this.callbacks.onCancel?.();
    });
    this.listen(this.muteButton, "click", () => this.callbacks.onMuteToggle?.());
    this.listen(this.powerRetrofitButton, "click", () =>
      this.callbacks.onPowerRetrofit?.()
    );
    this.listen(this.pauseButton, "click", () => this.callbacks.onPauseToggle?.());
    this.listen(this.helpButton, "click", () => {
      if (this.callbacks.onHelp) {
        this.callbacks.onHelp();
      } else {
        this.setFieldManualOpen(true);
      }
    });
    this.listen(this.sessionButton, "click", () => {
      this.setSessionPanelOpen(this.sessionPanel.hidden);
    });
    this.listen(
      this.requireElement("[data-action='session-close']"),
      "click",
      () => this.setSessionPanelOpen(false),
    );
    this.listen(this.sessionSaveButton, "click", () => {
      this.callbacks.onSessionSave?.();
    });
    this.listen(this.sessionRestoreButton, "click", () => {
      this.setSessionPanelOpen(false);
      this.callbacks.onSessionRestore?.();
    });
    this.listen(this.sessionResetButton, "click", () => {
      if (this.sessionResetButton.dataset.confirmReset !== "true") {
        this.armSessionReset();
        return;
      }
      this.clearSessionResetConfirmation();
      this.setSessionPanelOpen(false);
      this.callbacks.onSessionReset?.();
    });
    this.listen(
      this.requireElement("[data-action='manual-open']"),
      "click",
      () => this.setFieldManualOpen(true),
    );
    for (const close of this.root.querySelectorAll<HTMLElement>(
      "[data-action='manual-close']",
    )) {
      this.listen(close, "click", () => this.setFieldManualOpen(false));
    }
    this.listen(this.sessionPanel, "keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key !== "Escape") return;
      keyboardEvent.preventDefault();
      this.setSessionPanelOpen(false);
      this.sessionButton.focus();
    });
    this.listen(this.fieldManual, "keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key === "Escape") {
        keyboardEvent.preventDefault();
        this.setFieldManualOpen(false);
        return;
      }
      if (keyboardEvent.key !== "Tab") return;
      const controls = Array.from(
        this.fieldManual.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((control) => !control.hidden);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (keyboardEvent.shiftKey && document.activeElement === first) {
        keyboardEvent.preventDefault();
        last.focus();
      } else if (!keyboardEvent.shiftKey && document.activeElement === last) {
        keyboardEvent.preventDefault();
        first.focus();
      }
    });
    this.listen(
      this.requireElement("[data-action='mobile-rotate']"),
      "click",
      () => this.callbacks.onRotate?.(),
    );
    this.listen(
      this.requireElement("[data-action='mobile-cancel']"),
      "click",
      () => this.callbacks.onCancel?.(),
    );
    this.listen(
      this.requireElement("[data-action='mobile-dismantle']"),
      "click",
      () => this.callbacks.onRemove?.(),
    );
    this.listen(
      this.requireElement("[data-action='mobile-focus']"),
      "click",
      () => this.callbacks.onFocus?.(),
    );
    this.listen(this.requireElement("[data-action='close-inspector']"), "click", () =>
      this.callbacks.onInspectorClose?.(),
    );
    if (bindHotkeys) {
      const keyboardListener: EventListener = (event) =>
        this.handleKeyDown(event as KeyboardEvent);
      this.listen(window, "keydown", keyboardListener);
    }
  }

  private commitManifoldRouting(
    mode: ManifoldMode,
    requestedFilter?: ItemId,
    requestedExtractPort?: 0 | 1,
  ): void {
    const inspector = this.model.inspector;
    const routing = inspector?.manifoldRouting;
    if (!inspector?.id || !routing) return;

    const filter =
      requestedFilter ??
      routing.filter ??
      routing.filterOptions[0]?.id;
    const extractPort = requestedExtractPort ?? routing.extractPort;
    if (mode === "extract" && !filter) return;

    this.callbacks.onManifoldRoutingChange?.(
      inspector.id,
      mode === "extract"
        ? { mode, filter, extractPort }
        : { mode, extractPort },
    );
  }

  private activateRecipeButton(button: HTMLButtonElement): void {
    const inspector = this.model.inspector;
    const process = inspector?.machineProcess;
    const rawRecipeId = button.dataset.recipeId;
    if (!process || !rawRecipeId) return;
    this.recipeRovingId = rawRecipeId;
    this.updateRecipeTabStops();
    this.callbacks.onRecipeChange?.(
      process.entityId,
      rawRecipeId === "auto" ? null : (rawRecipeId as RecipeId),
    );
  }

  private handleProcessConsoleKeyDown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (!event.repeat) this.callbacks.onUndo?.();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.callbacks.onInspectorClose?.();
      document.querySelector<HTMLCanvasElement>("#world")?.focus();
      return;
    }

    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("[data-recipe-choice]")
        : null;
    if (!button || !this.recipeGrid.contains(button)) return;
    const buttons = Array.from(
      this.recipeGrid.querySelectorAll<HTMLButtonElement>(
        "[data-recipe-choice]",
      ),
    );
    const index = buttons.indexOf(button);
    if (index < 0 || buttons.length === 0) return;
    const computedColumns = getComputedStyle(this.recipeGrid)
      .gridTemplateColumns
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    const columns = Math.max(1, computedColumns);

    let nextIndex: number | undefined;
    switch (event.key) {
      case "ArrowLeft":
        nextIndex = index - 1;
        break;
      case "ArrowRight":
        nextIndex = index + 1;
        break;
      case "ArrowUp":
        nextIndex = index - columns;
        break;
      case "ArrowDown":
        nextIndex = index + columns;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = buttons.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = buttons[
      Math.max(0, Math.min(buttons.length - 1, nextIndex))
    ];
    if (!next) return;
    this.recipeRovingId = next.dataset.recipeId ?? "";
    this.updateRecipeTabStops();
    next.focus();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest(
            "button, [role='button'], [data-keyboard-scope]",
          ) !== null))
    ) {
      return;
    }

    const digitIndex =
      event.code === "Digit0"
        ? 9
        : /^Digit[1-9]$/.test(event.code)
          ? Number(event.code.slice(-1)) - 1
          : -1;
    const hotkeyKind =
      !event.altKey && !event.ctrlKey && !event.metaKey && digitIndex >= 0
        ? event.shiftKey
          ? HUD_ADVANCED_BUILD_ORDER[digitIndex]
          : HUD_PRIMARY_BUILD_ORDER[digitIndex]
        : undefined;
    if (hotkeyKind) {
      event.preventDefault();
      const unlocked =
        this.model.buildAvailability?.[hotkeyKind] ?? true;
      const affordable =
        this.model.buildAffordability?.[hotkeyKind] ?? true;
      if (unlocked && affordable) {
        this.callbacks.onBuildSelect?.(hotkeyKind);
      }
      return;
    }

    switch (event.code) {
      case "KeyR":
        if (!event.repeat) this.callbacks.onRotate?.();
        break;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        if (!event.repeat) this.callbacks.onRemove?.();
        break;
      case "Escape":
        this.callbacks.onCancel?.();
        break;
      case "Space":
        event.preventDefault();
        if (!event.repeat) this.callbacks.onPauseToggle?.();
        break;
      case "KeyM":
        if (!event.repeat) this.callbacks.onMuteToggle?.();
        break;
      default:
        break;
    }
  }

  private updateBrand(): void {
    this.setText(this.factoryName, this.model.factoryName ?? "CINDERLINE");
    this.setText(
      this.sectorName,
      this.model.sectorName ?? "AUTONOMOUS FRONTIER // SECTOR 07",
    );
  }

  private updateTelemetry(): void {
    const telemetry = this.model.telemetry;
    const generation = Math.max(0, telemetry?.powerGenerated ?? 0);
    const demand = Math.max(0, telemetry?.powerDemand ?? 0);
    this.setText(this.materialValue, formatInteger(telemetry?.material));
    this.setText(this.materialLabel, telemetry?.materialLabel ?? "ALLOY");
    this.setText(
      this.powerValue,
      `${formatDecimal(generation, generation < 10 ? 1 : 0)} / ${formatDecimal(demand, demand < 10 ? 1 : 0)}`,
    );
    const powerRatio = demand <= 0 ? (generation > 0 ? 1 : 0) : generation / demand;
    this.powerTrack.style.setProperty("--power", `${Math.min(100, powerRatio * 100)}%`);
    this.powerTrack.style.background =
      powerRatio < 0.75 ? "#ff6b55" : powerRatio < 1 ? "#f5b84b" : "";
    this.setText(this.throughputValue, formatInteger(telemetry?.throughput));
    this.setText(
      this.efficiencyValue,
      `${Math.round(normaliseEfficiency(telemetry?.efficiency))}%`,
    );
  }

  private updateMission(): void {
    const mission = this.model.mission;
    const objectives = mission?.objectives ?? [];
    const allComplete =
      mission?.complete ??
      (objectives.length > 0 &&
        objectives.every(
          (objective) =>
            objective.complete ??
            (objective.target > 0 && objective.current >= objective.target),
        ));
    this.missionPanel.classList.toggle("is-complete", allComplete);
    this.missionPanel.toggleAttribute("data-complete", allComplete);
    this.missionPanel.setAttribute(
      "aria-label",
      allComplete
        ? "Sector online. Autonomy achieved. All mission objectives complete."
        : "Mission objectives",
    );
    this.setText(
      this.missionChapter,
      allComplete ? "SECTOR ONLINE" : (mission?.chapter ?? "PRIMARY DIRECTIVE"),
    );
    this.setText(
      this.missionCode,
      allComplete ? "COMPLETE" : (mission?.code ?? "OPS–01"),
    );
    this.setText(
      this.missionTitle,
      allComplete ? "AUTONOMY ACHIEVED" : (mission?.title ?? "Establish the line"),
    );
    this.setText(
      this.missionCopy,
      mission?.description ??
        "Deploy an autonomous production chain across the surveyed field.",
    );

    const commissions = mission?.commissions ?? [];
    this.commissionControls.hidden = commissions.length === 0;
    const commissionSignature = commissions
      .map((commission) =>
        `${commission.id}:${commission.label}:${Number(commission.available)}:${
          Number(commission.selected)
        }:${Number(commission.complete ?? false)}`
      )
      .join("\u001f");
    if (commissionSignature !== this.commissionSignature) {
      this.commissionSignature = commissionSignature;
      this.commissionOptions.replaceChildren(
        ...commissions.map((commission) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "commission-option";
          button.dataset.commissionId = commission.id;
          button.disabled = !commission.available;
          button.classList.toggle("is-selected", commission.selected);
          button.classList.toggle(
            "is-complete",
            commission.complete ?? false,
          );
          button.setAttribute(
            "aria-pressed",
            String(commission.selected),
          );
          button.textContent = commission.label;
          return button;
        }),
      );
    }
    this.commissionSubmit.disabled = !(mission?.canSubmit ?? false);

    const signature = objectives.map((objective) => objective.id).join("\u001f");
    if (signature !== this.objectiveSignature) {
      this.objectiveSignature = signature;
      this.objectiveList.replaceChildren(
        ...objectives.map((objective) => {
          const row = document.createElement("div");
          row.className = "objective";
          row.dataset.objectiveId = objective.id;
          const check = document.createElement("span");
          check.className = "objective-check";
          check.textContent = "✓";
          const name = document.createElement("span");
          name.className = "objective-name";
          const count = document.createElement("span");
          count.className = "objective-count";
          row.append(check, name, count);
          return row;
        }),
      );
    }

    let progress = 0;
    for (const objective of objectives) {
      const selector = `[data-objective-id="${escapeSelector(objective.id)}"]`;
      const row = this.objectiveList.querySelector<HTMLElement>(selector);
      if (!row) continue;
      const complete =
        objective.complete ?? (objective.target > 0 && objective.current >= objective.target);
      row.classList.toggle("is-done", complete);
      const name = row.querySelector<HTMLElement>(".objective-name");
      const count = row.querySelector<HTMLElement>(".objective-count");
      if (name) this.setText(name, objective.label);
      if (count) {
        this.setText(
          count,
          `${Math.min(objective.target, Math.max(0, objective.current))}/${objective.target}`,
        );
      }
      const ratio =
        objective.target <= 0
          ? complete
            ? 1
            : 0
          : Math.min(1, Math.max(0, objective.current / objective.target));
      progress += ratio;
    }
    const percent = objectives.length > 0 ? (progress / objectives.length) * 100 : 0;
    this.missionProgress.style.setProperty("--mission", `${percent}%`);
    const readyCount = objectives.filter((objective) =>
      objective.complete ??
      (objective.target > 0 && objective.current >= objective.target)
    ).length;
    this.setText(
      this.missionCollapsedSummary,
      `${readyCount} / ${objectives.length} TARGETS READY`,
    );
  }

  private isShortMobileViewport(): boolean {
    return typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 690px) and (max-height: 640px)").matches;
  }

  private setMissionCollapsed(collapsed: boolean): void {
    this.missionPanel.classList.toggle("is-collapsed", collapsed);
    this.missionCollapseButton.setAttribute(
      "aria-expanded",
      String(!collapsed),
    );
    this.missionCollapseButton.setAttribute(
      "aria-label",
      collapsed ? "Show mission objectives" : "Hide mission objectives",
    );
    this.setText(
      this.missionCollapseLabel,
      collapsed ? "SHOW BRIEF" : "HIDE BRIEF",
    );
  }

  private updateBlueprint(): void {
    const blueprint = this.model.blueprint;
    this.blueprintPanel.hidden = blueprint === null || blueprint === undefined;
    if (!blueprint) return;

    const capture = blueprint.mode === "capture";
    this.blueprintPanel.dataset.mode = blueprint.mode;
    this.blueprintPanel.classList.toggle("is-valid", blueprint.valid);
    this.blueprintPanel.classList.toggle("is-invalid", !blueprint.valid);
    this.setText(
      this.blueprintMode,
      capture ? "AREA CAPTURE" : "PLAN HOLOGRAM",
    );
    this.setText(this.blueprintTransform, blueprint.transform);
    this.setText(this.blueprintUnits, formatInteger(blueprint.units));
    this.setText(
      this.blueprintDimensions,
      `${formatInteger(blueprint.width)}×${formatInteger(blueprint.height)}`,
    );
    this.setText(this.blueprintCost, formatInteger(blueprint.cost));
    this.setText(
      this.blueprintStock,
      formatInteger(blueprint.availableAlloy),
    );
    this.setText(this.blueprintStatus, blueprint.status);
    this.setText(
      this.blueprintConstructCount,
      formatInteger(blueprint.constructionCount),
    );
    this.setText(
      this.blueprintConfigureCount,
      formatInteger(blueprint.configurationCount),
    );
    this.setText(this.blueprintMatchCount, formatInteger(blueprint.matchCount));
    this.setText(
      this.blueprintBlockedCount,
      formatInteger(blueprint.conflictCount),
    );
    this.blueprintStatus.dataset.valid = String(blueprint.valid);
    this.blueprintPanel.setAttribute(
      "aria-label",
      `${capture ? "Blueprint area capture" : "Blueprint placement"}, `
        + `${blueprint.units} units, ${blueprint.width} by ${blueprint.height} tiles, `
        + `${blueprint.cost} alloy. `
        + `${blueprint.constructionCount ?? 0} new, `
        + `${blueprint.configurationCount ?? 0} to configure, `
        + `${blueprint.matchCount ?? 0} matched, `
        + `${blueprint.conflictCount} blocked. `
        + blueprint.status,
    );
    for (const button of this.blueprintPanel.querySelectorAll<HTMLButtonElement>(
      "[data-blueprint-transform]",
    )) {
      button.disabled = capture;
    }
  }

  private updateBlueprintLibrary(): void {
    const library = this.model.blueprintLibrary;
    const wasHidden = this.blueprintLibraryLayer.hidden;
    this.blueprintLibraryLayer.hidden = !library?.open;
    const topToggle = this.root.querySelector<HTMLButtonElement>(
      ".top-actions [data-action='blueprint-library-toggle']",
    );
    topToggle?.setAttribute("aria-expanded", String(Boolean(library?.open)));
    if (!library) return;

    const planCount = library.entries.filter(
      (entry) => entry.kind === "blueprint",
    ).length;
    const bookCount = library.entries.length - planCount;
    this.setText(
      this.blueprintLibraryCount,
      `${formatInteger(library.entries.length)} ${
        library.entries.length === 1 ? "RECORD" : "RECORDS"
      }`,
    );
    this.setText(
      this.blueprintLibraryIndexSummary,
      `${formatInteger(planCount)} ${
        planCount === 1 ? "PLAN" : "PLANS"
      } · ${formatInteger(bookCount)} ${
        bookCount === 1 ? "BOOK" : "BOOKS"
      }`,
    );
    this.setText(
      this.blueprintLibrarySelection,
      library.clipboardAvailable
        ? `${formatInteger(library.clipboardUnits)} units · ${
            formatInteger(library.clipboardWidth)
          }×${formatInteger(library.clipboardHeight)} tiles`
        : "No plan armed",
    );
    this.blueprintLibrarySave.disabled = !library.clipboardAvailable;

    const selected = library.entries.find((entry) => entry.selected);
    this.blueprintLibraryLoad.disabled = selected?.kind !== "blueprint";
    this.blueprintLibraryUpdate.disabled = !library.canUpdate;
    this.blueprintLibraryReassign.disabled = !library.canReassign;
    this.blueprintLibraryDuplicate.disabled = !library.canDuplicate;
    this.blueprintLibraryMoveUp.disabled = !library.canMoveUp;
    this.blueprintLibraryMoveDown.disabled = !library.canMoveDown;
    this.blueprintLibraryDelete.disabled = selected === undefined;
    this.blueprintLibraryRestoreDelete.disabled = !library.canRestoreDelete;
    if (this.blueprintLibrarySelectedId !== library.selectedId) {
      this.blueprintLibrarySelectedId = library.selectedId;
      this.blueprintLibraryName.value = selected?.name ?? "";
      this.blueprintLibrarySelectedPanel.classList.remove("is-tools-open");
      this.blueprintLibraryToolsToggle.setAttribute("aria-expanded", "false");
    }
    const selectedDescription = selected?.description.trim() ?? "";
    const generatedPlanDescription =
      /^\d+\s+construction units across\s+\d+×\d+\s+tiles\.?$/i.test(
        selectedDescription,
      );
    this.setText(
      this.blueprintLibraryDescription,
      selected
        ? selected.kind === "book"
          ? `Blueprint book · ${
              selectedDescription || "Ready for nested production plans."
            }`
          : `${formatInteger(selected.units)} units · ${
              formatInteger(selected.width)
            }×${formatInteger(selected.height)} tiles. ${
              selectedDescription && !generatedPlanDescription
                ? selectedDescription
                : "Directional topology and footprint verified."
            }`
        : "Choose a plan or book from the archive.",
    );

    const signature = library.entries
      .map((entry) =>
        [
          entry.id,
          entry.kind,
          entry.name,
          entry.depth,
          entry.selected,
          entry.units,
          entry.width,
          entry.height,
          entry.description,
          entry.icons.join(","),
          entry.preview
            .map((cell) =>
              `${cell.kind}:${cell.x}:${cell.z}:${cell.width}:${cell.height}:${cell.direction ?? "?"}:${cell.recipeId ?? "-"}:${cell.manifoldMode ?? "-"}:${cell.manifoldFilter ?? "-"}`
            )
            .join(","),
        ].join("\u001f")
      )
      .join("\u001e");
    if (signature !== this.blueprintLibrarySignature) {
      this.blueprintLibrarySignature = signature;
      this.blueprintLibraryTree.replaceChildren();
      if (library.entries.length === 0) {
        const empty = document.createElement("p");
        empty.className = "blueprint-library-empty";
        empty.textContent =
          "Archive empty. Capture a plan, name it, then save current.";
        this.blueprintLibraryTree.append(empty);
      }
      for (
        let entryIndex = 0;
        entryIndex < library.entries.length;
        entryIndex += 1
      ) {
        const entry = library.entries[entryIndex]!;
        let descendantCount = 0;
        for (
          let descendantIndex = entryIndex + 1;
          descendantIndex < library.entries.length;
          descendantIndex += 1
        ) {
          const descendant = library.entries[descendantIndex]!;
          if (descendant.depth <= entry.depth) break;
          descendantCount += 1;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.libraryId = entry.id;
        button.dataset.libraryKind = entry.kind;
        button.className = "blueprint-library-entry";
        button.classList.toggle("is-selected", entry.selected);
        button.style.setProperty("--library-depth", String(entry.depth));
        const signatureCell =
          entry.preview.find(
            (cell) => cell.kind !== "belt" && cell.kind !== "inserter",
          ) ?? entry.preview[0];
        button.style.setProperty(
          "--library-entry-accent",
          signatureCell
            ? ENTITY_COLORS[signatureCell.kind] ?? "#7f9a94"
            : "#a97944",
        );
        button.setAttribute("role", "treeitem");
        button.setAttribute("aria-level", String(entry.depth + 1));
        button.setAttribute("aria-selected", String(entry.selected));

        const hierarchy = document.createElement("span");
        hierarchy.className = "blueprint-library-entry-branch";
        hierarchy.setAttribute("aria-hidden", "true");
        const glyph = createBlueprintLibraryGlyph(
          entry,
          false,
          descendantCount,
        );
        const copy = document.createElement("span");
        copy.className = "blueprint-library-entry-copy";
        const heading = document.createElement("span");
        heading.className = "blueprint-library-entry-heading";
        const name = document.createElement("strong");
        name.textContent = entry.name;
        const kind = document.createElement("em");
        kind.textContent = entry.kind === "book" ? "BOOK" : "PLAN";
        heading.append(name, kind);
        const detail = document.createElement("small");
        detail.textContent =
          entry.kind === "book"
            ? `${formatInteger(descendantCount)} nested ${
                descendantCount === 1 ? "record" : "records"
              }`
            : `${formatInteger(entry.units)} units · ${
                formatInteger(entry.width)
              }×${formatInteger(entry.height)}`;
        const route = document.createElement("span");
        route.className = "blueprint-library-entry-route";
        route.textContent =
          entry.kind === "book"
            ? descendantCount > 0
              ? "CONTAINS"
              : "EMPTY FOLIO"
            : entry.preview.some((cell) => cell.kind === "belt")
              ? "FLOW MAPPED"
              : "GRID MAPPED";
        const contentMarks = document.createElement("span");
        contentMarks.className = "blueprint-library-entry-content";
        for (const representedKind of librarySemanticKinds(
          entry.preview,
          3,
        )) {
          const mark = document.createElement("i");
          mark.dataset.libraryKindMark = representedKind;
          mark.style.setProperty(
            "--library-kind-color",
            ENTITY_COLORS[representedKind] ?? "#7f9a94",
          );
          mark.title =
            BUILD_DEFINITIONS.find(
              (definition) => definition.kind === representedKind,
            )?.name ?? representedKind;
          const icon = librarySvgElement("svg", {
            viewBox: "0 0 34 30",
            "aria-hidden": "true",
          });
          icon.innerHTML = buildDefinitionSvgInner(representedKind);
          mark.append(icon);
          contentMarks.append(mark);
        }
        const representedProducts = new Set<ItemId>();
        for (const cell of entry.preview) {
          if (!cell.recipeId) continue;
          const outputItem = RECIPE_OUTPUT_PICTOGRAM[cell.recipeId];
          if (representedProducts.has(outputItem)) continue;
          representedProducts.add(outputItem);
          const product = document.createElement("b");
          product.dataset.libraryProduct = outputItem;
          product.style.setProperty(
            "--library-item-color",
            LIBRARY_ITEM_COLORS[outputItem] ?? "#d8dfda",
          );
          const icon = librarySvgElement("svg", {
            viewBox: "0 0 24 24",
            "aria-hidden": "true",
          });
          icon.innerHTML = ITEM_PICTOGRAMS[outputItem];
          product.append(icon);
          contentMarks.append(product);
          if (representedProducts.size >= 2) break;
        }
        if (
          entry.preview.some(
            (cell) => cell.kind === "smelter" && cell.recipeId === null,
          )
        ) {
          const autoProducts = document.createElement("b");
          autoProducts.className = "is-auto-products";
          autoProducts.dataset.libraryProduct = "auto-smelt";
          autoProducts.title =
            "Auto-smelt: iron plate, copper plate, or fire brick";
          for (const outputItem of [
            "ironPlate",
            "copperPlate",
            "stoneBrick",
          ] as const) {
            const swatch = document.createElement("i");
            swatch.style.setProperty(
              "--library-item-color",
              LIBRARY_ITEM_COLORS[outputItem] ?? "#d8dfda",
            );
            autoProducts.append(swatch);
          }
          contentMarks.append(autoProducts);
        }
        const identity = document.createElement("span");
        identity.className = "blueprint-library-entry-identity";
        identity.append(route, contentMarks);
        copy.append(heading, detail, identity);
        const chevron = document.createElement("span");
        chevron.className = "blueprint-library-entry-chevron";
        chevron.setAttribute("aria-hidden", "true");
        chevron.textContent = "›";
        button.append(hierarchy, glyph, copy, chevron);
        this.blueprintLibraryTree.append(button);
      }

      this.blueprintLibraryVaultDossier.replaceChildren();
      const showVaultDossier =
        library.entries.length > 0 &&
        library.entries.length <= 3 &&
        selected?.kind === "blueprint";
      this.blueprintLibraryVaultDossier.hidden = !showVaultDossier;
      if (showVaultDossier && selected) {
        this.blueprintLibraryVaultDossier.append(
          createBlueprintLibraryDossier(selected),
        );
      }
    }

    this.blueprintLibrarySelectedPreview.replaceChildren();
    if (selected) {
      const selectedIndex = library.entries.indexOf(selected);
      let descendantCount = 0;
      for (
        let index = selectedIndex + 1;
        index < library.entries.length;
        index += 1
      ) {
        const descendant = library.entries[index]!;
        if (descendant.depth <= selected.depth) break;
        descendantCount += 1;
      }
      this.blueprintLibrarySelectedPreview.append(
        createBlueprintLibraryGlyph(selected, true, descendantCount),
      );
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "blueprint-library-preview-placeholder";
      placeholder.textContent = "Select a record to inspect its factory layout.";
      this.blueprintLibrarySelectedPreview.append(placeholder);
    }

    this.blueprintLibrarySelectedIdentity.replaceChildren();
    if (selected?.kind === "blueprint") {
      const chain = document.createElement("div");
      chain.className = "blueprint-library-production-chain";
      const chainKinds = librarySemanticKinds(selected.preview, 4);
      for (const [kindIndex, kind] of chainKinds.entries()) {
        if (chain.childElementCount > 0) {
          const arrow = document.createElement("i");
          arrow.className = "blueprint-library-chain-arrow";
          arrow.textContent = "›";
          arrow.setAttribute("aria-hidden", "true");
          chain.append(arrow);
        }
        const node = document.createElement("span");
        node.className = "blueprint-library-chain-node";
        node.dataset.libraryChainKind = kind;
        node.dataset.libraryChainStep = String(kindIndex + 1).padStart(2, "0");
        node.style.setProperty(
          "--library-kind-color",
          ENTITY_COLORS[kind] ?? "#7f9a94",
        );
        const icon = librarySvgElement("svg", {
          viewBox: "0 0 34 30",
          "aria-hidden": "true",
        });
        icon.innerHTML = buildDefinitionSvgInner(kind);
        const label = document.createElement("small");
        label.textContent =
          BUILD_DEFINITIONS.find((definition) => definition.kind === kind)
            ?.name ?? kind;
        node.append(icon, label);
        chain.append(node);
      }

      const outputs = new Set<ItemId>();
      let autoSmelt = false;
      for (const cell of selected.preview) {
        if (cell.recipeId) {
          outputs.add(RECIPE_OUTPUT_PICTOGRAM[cell.recipeId]);
        } else if (cell.kind === "smelter") {
          autoSmelt = true;
        }
      }
      if (outputs.size > 0 || autoSmelt) {
        const arrow = document.createElement("i");
        arrow.className = "blueprint-library-chain-arrow";
        arrow.textContent = "›";
        arrow.setAttribute("aria-hidden", "true");
        chain.append(arrow);
        const outputNode = document.createElement("span");
        outputNode.className = "blueprint-library-chain-output";
        outputNode.title = autoSmelt
          ? "Automatic smelting outputs"
          : "Configured recipe outputs";
        const outputItems = autoSmelt
          ? (["ironPlate", "copperPlate", "stoneBrick"] as const)
          : [...outputs].slice(0, 3);
        for (const outputItem of outputItems) {
          const product = document.createElement("i");
          product.style.setProperty(
            "--library-item-color",
            LIBRARY_ITEM_COLORS[outputItem] ?? "#d8dfda",
          );
          product.title = LIBRARY_ITEM_LABELS[outputItem] ?? outputItem;
          const icon = librarySvgElement("svg", {
            viewBox: "0 0 24 24",
            "aria-hidden": "true",
          });
          icon.innerHTML = ITEM_PICTOGRAMS[outputItem];
          product.append(icon);
          outputNode.append(product);
        }
        const label = document.createElement("small");
        label.textContent = autoSmelt ? "Auto outputs" : "Products";
        outputNode.append(label);
        chain.append(outputNode);
      }

      const poweredCount = selected.preview.filter((cell) =>
        LIBRARY_POWER_CONSUMERS.has(cell.kind)
      ).length;
      if (poweredCount > 0) {
        const power = document.createElement("span");
        power.className = "blueprint-library-chain-power";
        power.innerHTML =
          '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="m10 2-6 9h5l-1 5 6-9H9z"/></svg>';
        const label = document.createElement("small");
        label.textContent = `${formatInteger(poweredCount)} powered`;
        power.append(label);
        chain.append(power);
      }
      this.blueprintLibrarySelectedIdentity.append(chain);
    }

    if (library.open && wasHidden) {
      window.setTimeout(() => {
        const selectedButton =
          this.blueprintLibraryTree.querySelector<HTMLButtonElement>(
            "[aria-selected='true']",
          );
        (selectedButton ?? this.blueprintLibraryName).focus();
      }, 0);
    } else if (!library.open && !wasHidden) {
      window.setTimeout(() => topToggle?.focus(), 0);
    }
  }

  private updateRailAuthoring(): void {
    const rail = this.model.railAuthoring;
    const open = Boolean(rail?.open);
    const shellSignature = String(open);
    if (shellSignature !== this.railAuthoringShellSignature) {
      const previousSignature = this.railAuthoringShellSignature;
      this.railAuthoringShellSignature = shellSignature;
      const active = document.activeElement;
      if (open) {
        this.setRailConsoleCollapsed(false);
        this.railConsoleReturnFocus =
          active instanceof HTMLElement &&
          active !== document.body &&
          !this.railConsole.contains(active)
            ? active
            : document.querySelector<HTMLCanvasElement>("#world");
      }
      this.railConsole.hidden = !open;
      this.railConsole.setAttribute("aria-hidden", String(!open));
      this.railConsole.toggleAttribute("inert", !open);
      for (const toggle of this.railToggleButtons) {
        toggle.setAttribute("aria-expanded", String(open));
        toggle.classList.toggle("is-active", open);
        toggle.setAttribute(
          "aria-label",
          open
            ? "Close rail authoring console"
            : "Open rail authoring console",
        );
      }
      if (previousSignature !== "\u0000") {
        window.setTimeout(() => {
          if (open) {
            this.railConsole
              .querySelector<HTMLButtonElement>(
                "[data-action='rail-toggle']",
              )
              ?.focus({ preventScroll: true });
      } else {
        this.setRailConsoleCollapsed(false);
        const active = document.activeElement;
            if (
              !rail?.suppressReturnFocus &&
              (
                active === document.body ||
                (
                  active instanceof Node &&
                  this.railConsole.contains(active)
                )
              )
            ) {
              const fallback = this.railToggleButtons.find(
                (toggle) => !this.railConsole.contains(toggle),
              );
              const destination =
                this.railConsoleReturnFocus?.isConnected &&
                !this.railConsoleReturnFocus.hidden
                  ? this.railConsoleReturnFocus
                  : fallback;
              destination?.focus({
                preventScroll: true,
              });
            }
            this.railConsoleReturnFocus = null;
          }
        }, 0);
      }
    }
    if (!rail) {
      if (this.railAuthoringToolsSignature !== "none") {
        this.railAuthoringToolsSignature = "none";
        this.railTools.replaceChildren();
      }
      if (this.railAuthoringEditorSignature !== "none") {
        this.railAuthoringEditorSignature = "none";
        this.railEditor.replaceChildren();
      }
      return;
    }
    this.setText(this.railRotation, `${rail.rotation * 90}°`);
    this.setText(
      this.railSelection,
      rail.selected?.label ?? "None",
    );
    const displayedStatus = rail.previewStatus ?? rail.status;
    this.setText(this.railStatus, displayedStatus);
    this.railStatus.dataset.tone =
      !rail.unlocked || !rail.networkConfigured
        ? "blocked"
        : displayedStatus.toLocaleLowerCase().includes("blocked") ||
            displayedStatus.toLocaleLowerCase().includes("reject")
          ? "blocked"
          : "ready";
    const toolsSignature = JSON.stringify({
      unlocked: rail.unlocked,
      networkConfigured: rail.networkConfigured,
      selectedTool: rail.selectedTool,
      tools: rail.tools,
    });
    if (toolsSignature !== this.railAuthoringToolsSignature) {
      this.railAuthoringToolsSignature = toolsSignature;
      const focusedTool =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
              .closest<HTMLButtonElement>("[data-rail-tool]")
              ?.dataset.railTool
          : undefined;
      this.railTools.innerHTML = rail.tools
        .map((tool) => {
          const selected = rail.selectedTool === tool.kind;
          const enabled =
            rail.unlocked &&
            rail.networkConfigured &&
            tool.available &&
            tool.affordable;
          return `
            <button
              type="button"
              class="rail-tool${selected ? " is-selected" : ""}${
                !tool.available ? " is-locked" : ""
              }${tool.available && !tool.affordable ? " is-unaffordable" : ""}"
              data-rail-tool="${tool.kind}"
              data-rail-enabled="${String(enabled)}"
              aria-pressed="${String(selected)}"
              aria-disabled="${String(!enabled)}"
              aria-label="${escapeMarkup(tool.label)}, hotkey ${
                escapeMarkup(tool.key)
              }, ${formatInteger(tool.cost)} alloy, ${
                escapeMarkup(tool.status)
              }"
            >
              <kbd>${escapeMarkup(tool.key)}</kbd>
              <span class="rail-tool-identity">
                <i class="rail-tool-icon">${railToolIcon(tool.kind)}</i>
                <b>${escapeMarkup(tool.label)}</b>
              </span>
              <small><b>${formatInteger(tool.cost)}</b> ALLOY</small>
              <em>${escapeMarkup(tool.status)}</em>
            </button>`;
        })
        .join("");
      if (focusedTool) {
        this.railTools
          .querySelector<HTMLButtonElement>(
            `[data-rail-tool="${focusedTool}"]`,
          )
          ?.focus({ preventScroll: true });
      }
    }

    const dismantle = this.requireElement<HTMLButtonElement>(
      "[data-action='rail-dismantle']",
    );
    const blockers = rail.selected?.dismantleBlockers ?? [];
    dismantle.disabled = !rail.selected || blockers.length > 0;
    dismantle.title =
      blockers.length > 0
        ? `Blocked by ${blockers.join(", ")}`
        : rail.selected
          ? `Dismantle ${rail.selected.label}`
          : "Select a rail target first";
    dismantle.textContent =
      blockers.length > 0
        ? `BLOCKED · ${blockers[0]}`
        : "DISMANTLE TARGET";

    const editorSignature = JSON.stringify({
      selected: rail.selected
        ? {
            kind: rail.selected.kind,
            id: rail.selected.id,
            parentTrainId: rail.selected.parentTrainId,
            label: rail.selected.label,
          }
        : null,
      stationEditor: rail.stationEditor,
      trainEditor: rail.trainEditor
        ? {
            trainId: rail.trainEditor.trainId,
            cars: rail.trainEditor.cars.map((car) => ({
              id: car.id,
              kind: car.kind,
              label: car.label,
              selected: car.selected,
            })),
            schedule: rail.trainEditor.schedule,
            stationOptions: rail.trainEditor.stationOptions,
            itemOptions: rail.trainEditor.itemOptions,
          }
        : null,
    });
    if (editorSignature !== this.railAuthoringEditorSignature) {
      this.railAuthoringEditorSignature = editorSignature;
      if (rail.stationEditor) {
        this.railEditor.innerHTML = this.renderRailStationEditor(
          rail.stationEditor,
        );
      } else if (rail.trainEditor) {
        this.railEditor.innerHTML = this.renderRailTrainEditor(
          rail.trainEditor,
        );
      } else if (rail.selected) {
        this.railEditor.innerHTML = `
          <section class="rail-target-summary" aria-label="Selected rail target">
            <small>${escapeMarkup(rail.selected.kind.toUpperCase())}</small>
            <strong>${escapeMarkup(rail.selected.label)}</strong>
            <p>${escapeMarkup(rail.selected.detail)}</p>
            ${
              blockers.length > 0
                ? `<p class="rail-blockers"><b>DEPENDENCIES</b>${blockers
                    .map((blocker) => `<span>${escapeMarkup(blocker)}</span>`)
                    .join("")}</p>`
                : "<p class=\"rail-clear\">No dismantle dependencies.</p>"
            }
          </section>`;
      } else {
        this.railEditor.innerHTML = `
          <section class="rail-empty-state">
            <strong>SELECT TRACKSIDE HARDWARE</strong>
            <p>Choose a tool, or select a segment, signal, station, train, or individual car in the world.</p>
          </section>`;
      }
      for (const row of this.railEditor.querySelectorAll<HTMLElement>(
        "[data-rail-stop]",
      )) {
        this.syncRailWaitRow(row);
      }
      const scheduleList = this.railEditor.querySelector<HTMLElement>(
        "[data-rail-schedule-list]",
      );
      if (scheduleList) this.syncRailScheduleControls(scheduleList);
    }
    if (rail.trainEditor) {
      this.updateRailTrainTelemetry(rail.trainEditor);
    }
  }

  private setRailConsoleCollapsed(collapsed: boolean): void {
    this.railConsoleCollapsed = collapsed;
    this.railConsole.classList.toggle("is-collapsed", collapsed);
    const button = this.railConsole.querySelector<HTMLButtonElement>(
      "[data-action='rail-collapse']",
    );
    if (!button) return;
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute(
      "aria-label",
      collapsed
        ? "Expand rail authoring editor"
        : "Collapse rail authoring to expose the map",
    );
    button.innerHTML = collapsed
      ? "⌃ <span>EDIT</span>"
      : "⌄ <span>MAP</span>";
  }

  private renderRailStationEditor(
    editor: HUDRailStationEditor,
  ): string {
    const noFilter = editor.itemFilter === null;
    const selectedFilter = new Set(editor.itemFilter ?? []);
    const storageOptions = editor.storageOptions
      .map(
        (option) =>
          `<option value="${option.entityId}" ${
            option.entityId === editor.storageEntityId ? "selected" : ""
          }>${escapeMarkup(option.label)}</option>`,
      )
      .join("");
    return `
      <form class="rail-station-editor" data-rail-station-form data-station-id="${
        escapeMarkup(editor.stationId)
      }">
        <header><span><small>STATION</small><strong>${
          escapeMarkup(editor.stationId)
        }</strong></span><em>SEGMENT ${
          escapeMarkup(editor.segmentId)
        }</em></header>
        <label>
          <span>Adjacent storage</span>
          <select data-rail-storage aria-label="Authoritative adjacent storage">
            <option value="" ${
              editor.storageEntityId === null ? "selected" : ""
            }>Unbound</option>
            ${storageOptions}
          </select>
        </label>
        <div class="rail-station-pair">
          <label>
            <span>Transfer mode</span>
            <select data-rail-mode>
              ${(["load", "unload", "both"] as const)
                .map(
                  (mode) =>
                    `<option value="${mode}" ${
                      editor.mode === mode ? "selected" : ""
                    }>${mode.toUpperCase()}</option>`,
                )
                .join("")}
            </select>
          </label>
          <label>
            <span>Rate / tick</span>
            <input data-rail-rate type="number" min="1" step="1" value="${
              editor.transferRate
            }" inputmode="numeric">
          </label>
        </div>
        <fieldset class="rail-filter-fieldset">
          <legend>Item filter</legend>
          <label class="rail-no-filter">
            <input type="checkbox" data-rail-no-filter ${
              noFilter ? "checked" : ""
            }>
            <span>No filter · all items</span>
          </label>
          <div class="rail-filter-items">
            ${editor.itemOptions
              .map(
                (option) => `
                  <label>
                    <input type="checkbox" data-rail-filter-item value="${
                      option.id
                    }" ${selectedFilter.has(option.id) ? "checked" : ""} ${
                      noFilter ? "disabled" : ""
                    }>
                    <span>${escapeMarkup(option.label)}</span>
                  </label>`,
              )
              .join("")}
          </div>
          <small>“No filter” is canonical null. An enabled but empty item list is rejected.</small>
        </fieldset>
        <div class="rail-editor-actions">
          <button type="submit" class="is-primary" data-rail-editor-apply>APPLY INTERFACE</button>
          <button type="button" data-rail-editor-action="station-unbind">UNBIND STORAGE</button>
        </div>
      </form>`;
  }

  private renderRailTrainEditor(editor: HUDRailTrainEditor): string {
    const cars = editor.cars
      .map(
        (car) => `
          <li class="${car.selected ? "is-selected" : ""}" data-rail-car-id="${
            escapeMarkup(car.id)
          }">
            <span><b>${escapeMarkup(car.label)}</b><small data-rail-car-telemetry>${
              car.kind === "locomotive"
                ? `${formatInteger(car.fuelMilli)} fuel`
                : `${formatInteger(car.cargoUnits)} cargo`
            }</small></span>
            <div class="rail-car-actions">
              ${
                car.kind === "locomotive"
                  ? `<button
                      type="button"
                      data-rail-editor-action="locomotive-fuel"
                      data-train-id="${escapeMarkup(editor.trainId)}"
                      data-car-id="${escapeMarkup(car.id)}"
                      ${car.fuelable ? "" : "disabled"}
                      title="${escapeMarkup(car.fuelReason)}"
                      aria-label="Fuel ${escapeMarkup(car.label)} from bound storage"
                    >LOAD COAL</button>`
                  : ""
              }
              <button
                type="button"
                data-rail-editor-action="car-remove"
                data-train-id="${escapeMarkup(editor.trainId)}"
                data-car-id="${escapeMarkup(car.id)}"
                ${car.removable ? "" : "disabled"}
                title="${escapeMarkup(car.removeReason)}"
                aria-label="Remove ${escapeMarkup(car.label)}"
              >REMOVE</button>
            </div>
          </li>`,
      )
      .join("");
    return `
      <section class="rail-train-editor">
        <header>
          <span><small>CONSIST</small><strong>${
            escapeMarkup(editor.trainId)
          }</strong></span>
          <em data-rail-train-status>${escapeMarkup(editor.status.toUpperCase())}</em>
        </header>
        <ul class="rail-car-list">${cars}</ul>
        <p class="rail-consist-status" data-rail-consist-status>${escapeMarkup(
          editor.consistStatus,
        )}</p>
        <div class="rail-consist-actions">
          <button type="button" data-rail-consist-add data-rail-editor-action="consist-locomotive" data-train-id="${
            escapeMarkup(editor.trainId)
          }" ${editor.canEditConsist ? "" : "disabled"}>+ LOCOMOTIVE · 60</button>
          <button type="button" data-rail-consist-add data-rail-editor-action="consist-wagon" data-train-id="${
            escapeMarkup(editor.trainId)
          }" ${editor.canEditConsist ? "" : "disabled"}>+ CARGO WAGON · 24</button>
        </div>
        <form class="rail-schedule-editor" data-rail-schedule-form data-train-id="${
          escapeMarkup(editor.trainId)
        }">
          <header><span><small>ROUTE PROGRAM</small><strong>SCHEDULE</strong></span><em>${
            editor.schedule.length
          } STOPS</em></header>
          <div class="rail-schedule-list" data-rail-schedule-list>
            ${editor.schedule
              .map((stop, index) =>
                this.renderRailScheduleRow(editor, stop, index)
              )
              .join("")}
          </div>
          <div class="rail-editor-actions">
            <button type="button" data-rail-editor-action="schedule-add">+ ADD STOP</button>
            <button type="submit" class="is-primary" data-rail-editor-apply>APPLY SCHEDULE</button>
          </div>
        </form>
      </section>`;
  }

  private updateRailTrainTelemetry(editor: HUDRailTrainEditor): void {
    const status = this.railEditor.querySelector<HTMLElement>(
      "[data-rail-train-status]",
    );
    const consistStatus = this.railEditor.querySelector<HTMLElement>(
      "[data-rail-consist-status]",
    );
    if (status) this.setText(status, editor.status.toUpperCase());
    if (consistStatus) {
      this.setText(consistStatus, editor.consistStatus);
    }
    for (const button of this.railEditor.querySelectorAll<HTMLButtonElement>(
      "[data-rail-consist-add]",
    )) {
      button.disabled = !editor.canEditConsist;
    }
    const carById = new Map(editor.cars.map((car) => [car.id, car]));
    for (const row of this.railEditor.querySelectorAll<HTMLElement>(
      "[data-rail-car-id]",
    )) {
      const car = carById.get(row.dataset.railCarId ?? "");
      if (!car) continue;
      const telemetry = row.querySelector<HTMLElement>(
        "[data-rail-car-telemetry]",
      );
      if (telemetry) {
        this.setText(
          telemetry,
          car.kind === "locomotive"
            ? `${formatInteger(car.fuelMilli)} fuel`
            : `${formatInteger(car.cargoUnits)} cargo`,
        );
      }
      const remove = row.querySelector<HTMLButtonElement>(
        "[data-rail-editor-action='car-remove']",
      );
      if (remove) {
        remove.disabled = !car.removable;
        remove.title = car.removeReason;
      }
      const fuel = row.querySelector<HTMLButtonElement>(
        "[data-rail-editor-action='locomotive-fuel']",
      );
      if (fuel) {
        fuel.disabled = !car.fuelable;
        fuel.title = car.fuelReason;
      }
    }
  }

  private renderRailScheduleRow(
    editor: HUDRailTrainEditor,
    stop: RailScheduleStop,
    index: number,
  ): string {
    const wait = stop.wait;
    const itemId =
      wait.type === "item-at-least" || wait.type === "item-at-most"
        ? wait.itemId
        : editor.itemOptions[0]?.id ?? "ironOre";
    const count =
      wait.type === "item-at-least" || wait.type === "item-at-most"
        ? wait.count
        : 1;
    const ticks = wait.type === "time" ? wait.ticks : 60;
    return `
      <fieldset class="rail-schedule-stop" data-rail-stop>
        <legend>STOP <span>${index + 1}</span></legend>
        <label>
          <span>Station</span>
          <select data-rail-stop-station>
            ${editor.stationOptions
              .map(
                (station) =>
                  `<option value="${escapeMarkup(station.id)}" ${
                    station.id === stop.stationId ? "selected" : ""
                  }>${escapeMarkup(station.label)}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label>
          <span>Wait condition</span>
          <select data-rail-wait-type>
            ${(
              [
                ["time", "Time"],
                ["cargo-empty", "Cargo empty"],
                ["cargo-full", "Cargo full"],
                ["item-at-least", "Item at least"],
                ["item-at-most", "Item at most"],
              ] as const
            )
              .map(
                ([type, label]) =>
                  `<option value="${type}" ${
                    type === wait.type ? "selected" : ""
                  }>${label}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label data-rail-time-field>
          <span>Ticks</span>
          <input data-rail-wait-ticks type="number" min="0" step="1" inputmode="numeric" value="${ticks}">
        </label>
        <div class="rail-wait-item-fields" data-rail-item-fields>
          <label>
            <span>Item</span>
            <select data-rail-wait-item>
              ${editor.itemOptions
                .map(
                  (item) =>
                    `<option value="${item.id}" ${
                      item.id === itemId ? "selected" : ""
                    }>${escapeMarkup(item.label)}</option>`,
                )
                .join("")}
            </select>
          </label>
          <label>
            <span>Count</span>
            <input data-rail-wait-count type="number" min="0" step="1" inputmode="numeric" value="${count}">
          </label>
        </div>
        <div class="rail-stop-actions" aria-label="Schedule stop order">
          <button type="button" data-rail-editor-action="schedule-up" aria-label="Move stop up">↑</button>
          <button type="button" data-rail-editor-action="schedule-down" aria-label="Move stop down">↓</button>
          <button type="button" data-rail-editor-action="schedule-remove" aria-label="Remove stop" ${
            editor.schedule.length <= 1 ? "disabled" : ""
          }>×</button>
        </div>
      </fieldset>`;
  }

  private syncRailWaitRow(row: HTMLElement): void {
    const type = row.querySelector<HTMLSelectElement>(
      "[data-rail-wait-type]",
    )?.value;
    const time = row.querySelector<HTMLElement>("[data-rail-time-field]");
    const item = row.querySelector<HTMLElement>("[data-rail-item-fields]");
    if (time) time.hidden = type !== "time";
    if (item) {
      item.hidden =
        type !== "item-at-least" && type !== "item-at-most";
    }
  }

  private syncRailScheduleControls(list: HTMLElement): void {
    const rows = [
      ...list.querySelectorAll<HTMLElement>("[data-rail-stop]"),
    ];
    rows.forEach((row, index) => {
      const legend = row.querySelector<HTMLElement>("legend span");
      if (legend) legend.textContent = String(index + 1);
      const up = row.querySelector<HTMLButtonElement>(
        "[data-rail-editor-action='schedule-up']",
      );
      const down = row.querySelector<HTMLButtonElement>(
        "[data-rail-editor-action='schedule-down']",
      );
      const remove = row.querySelector<HTMLButtonElement>(
        "[data-rail-editor-action='schedule-remove']",
      );
      const states = [
        [up, index === 0],
        [down, index === rows.length - 1],
        [remove, rows.length <= 1],
      ] as const;
      for (const [button, disabled] of states) {
        if (!button) continue;
        button.disabled = disabled;
        button.setAttribute("aria-disabled", String(disabled));
      }
    });
  }

  private submitRailStationForm(form: HTMLFormElement): void {
    const activeBeforeSubmit =
      document.activeElement instanceof HTMLElement &&
      form.contains(document.activeElement)
        ? document.activeElement
        : null;
    const stationId = form.dataset.stationId;
    const storage = form.querySelector<HTMLSelectElement>(
      "[data-rail-storage]",
    );
    const mode = form.querySelector<HTMLSelectElement>(
      "[data-rail-mode]",
    )?.value;
    const rate = Number(
      form.querySelector<HTMLInputElement>("[data-rail-rate]")?.value,
    );
    const noFilter = Boolean(
      form.querySelector<HTMLInputElement>(
        "[data-rail-no-filter]",
      )?.checked,
    );
    if (
      !stationId ||
      (mode !== "load" && mode !== "unload" && mode !== "both")
    ) {
      return;
    }
    const itemFilter = noFilter
      ? null
      : [
          ...form.querySelectorAll<HTMLInputElement>(
            "[data-rail-filter-item]:checked",
          ),
        ].map((input) => input.value as ItemId);
    this.callbacks.onRailStationApply?.(stationId, {
      storageEntityId:
        storage?.value ? Number(storage.value) : null,
      mode,
      transferRate: rate,
      itemFilter,
    });
    this.restoreRailEditorFocusAfterSubmit(
      form,
      activeBeforeSubmit,
      "[data-rail-station-form]",
    );
  }

  private submitRailScheduleForm(form: HTMLFormElement): void {
    const activeBeforeSubmit =
      document.activeElement instanceof HTMLElement &&
      form.contains(document.activeElement)
        ? document.activeElement
        : null;
    const trainId = form.dataset.trainId;
    if (!trainId) return;
    const schedule: RailScheduleStop[] = [];
    for (const row of form.querySelectorAll<HTMLElement>(
      "[data-rail-stop]",
    )) {
      const stationId =
        row.querySelector<HTMLSelectElement>(
          "[data-rail-stop-station]",
        )?.value ?? "";
      const type =
        row.querySelector<HTMLSelectElement>(
          "[data-rail-wait-type]",
        )?.value ?? "";
      let wait: RailWaitCondition;
      if (type === "time") {
        wait = {
          type,
          ticks: Number(
            row.querySelector<HTMLInputElement>(
              "[data-rail-wait-ticks]",
            )?.value,
          ),
        };
      } else if (type === "cargo-empty" || type === "cargo-full") {
        wait = { type };
      } else if (type === "item-at-least" || type === "item-at-most") {
        wait = {
          type,
          itemId:
            row.querySelector<HTMLSelectElement>(
              "[data-rail-wait-item]",
            )?.value ?? "",
          count: Number(
            row.querySelector<HTMLInputElement>(
              "[data-rail-wait-count]",
            )?.value,
          ),
        };
      } else {
        return;
      }
      schedule.push({ stationId, wait });
    }
    this.callbacks.onRailScheduleApply?.(trainId, schedule);
    this.restoreRailEditorFocusAfterSubmit(
      form,
      activeBeforeSubmit,
      "[data-rail-schedule-form]",
    );
  }

  private restoreRailEditorFocusAfterSubmit(
    submittedForm: HTMLFormElement,
    activeBeforeSubmit: HTMLElement | null,
    rebuiltFormSelector: string,
  ): void {
    if (submittedForm.isConnected) {
      if (
        activeBeforeSubmit?.isConnected &&
        document.activeElement !== activeBeforeSubmit
      ) {
        activeBeforeSubmit.focus({ preventScroll: true });
      }
      return;
    }
    window.setTimeout(() => {
      const rebuiltForm =
        this.railEditor.querySelector<HTMLFormElement>(
          rebuiltFormSelector,
        );
      rebuiltForm
        ?.querySelector<HTMLButtonElement>("[data-rail-editor-apply]")
        ?.focus({ preventScroll: true });
    }, 0);
  }

  private handleRailEditorAction(button: HTMLButtonElement): void {
    const action = button.dataset.railEditorAction;
    if (action === "station-unbind") {
      const form = button.closest<HTMLFormElement>(
        "[data-rail-station-form]",
      );
      const storage = form?.querySelector<HTMLSelectElement>(
        "[data-rail-storage]",
      );
      if (storage) storage.value = "";
      form?.requestSubmit();
      return;
    }
    if (action === "consist-locomotive" || action === "consist-wagon") {
      const trainId = button.dataset.trainId;
      if (trainId) {
        this.callbacks.onRailConsistAdd?.(
          trainId,
          action === "consist-locomotive"
            ? "locomotive"
            : "cargo-wagon",
        );
      }
      return;
    }
    if (action === "car-remove") {
      const trainId = button.dataset.trainId;
      const carId = button.dataset.carId;
      if (trainId && carId) {
        this.callbacks.onRailCarRemove?.(trainId, carId);
      }
      return;
    }
    if (action === "locomotive-fuel") {
      const trainId = button.dataset.trainId;
      const carId = button.dataset.carId;
      if (trainId && carId) {
        this.callbacks.onRailLocomotiveFuel?.(trainId, carId);
      }
      return;
    }
    const list = button.closest<HTMLFormElement>(
      "[data-rail-schedule-form]",
    )?.querySelector<HTMLElement>("[data-rail-schedule-list]");
    if (!list) return;
    if (action === "schedule-add") {
      const editor = this.model.railAuthoring?.trainEditor;
      const stationId = editor?.stationOptions[0]?.id;
      if (!editor || !stationId) return;
      list.insertAdjacentHTML(
        "beforeend",
        this.renderRailScheduleRow(
          editor,
          {
            stationId,
            wait: { type: "time", ticks: 60 },
          },
          list.querySelectorAll("[data-rail-stop]").length,
        ),
      );
      const row = list.lastElementChild;
      if (row instanceof HTMLElement) this.syncRailWaitRow(row);
      this.syncRailScheduleControls(list);
      return;
    }
    const row = button.closest<HTMLElement>("[data-rail-stop]");
    if (!row) return;
    if (action === "schedule-up" && row.previousElementSibling) {
      list.insertBefore(row, row.previousElementSibling);
    } else if (
      action === "schedule-down" &&
      row.nextElementSibling
    ) {
      list.insertBefore(row.nextElementSibling, row);
    } else if (
      action === "schedule-remove" &&
      list.querySelectorAll("[data-rail-stop]").length > 1
    ) {
      row.remove();
    }
    this.syncRailScheduleControls(list);
  }

  private setBuildCategory(category: BuildCategory): void {
    this.activeBuildCategory = category;
    const palette = this.root.querySelector<HTMLElement>(".build-palette");
    const dock = this.root.querySelector<HTMLElement>(".build-dock");
    const count = BUILD_DEFINITIONS.filter(
      (definition) => buildCategoryForKind(definition.kind) === category,
    ).length;
    palette?.style.setProperty("--build-card-count", String(count));
    dock?.setAttribute("aria-labelledby", `build-category-${category}`);
    for (const tab of this.root.querySelectorAll<HTMLButtonElement>(
      "[data-build-category-select]",
    )) {
      const selected = tab.dataset.buildCategorySelect === category;
      tab.classList.toggle("is-selected", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const card of this.root.querySelectorAll<HTMLButtonElement>(
      "[data-build-category]",
    )) {
      card.hidden = card.dataset.buildCategory !== category;
    }
  }

  private updateBuildDock(): void {
    if (
      this.model.selectedBuild !== this.lastSelectedBuild &&
      this.model.selectedBuild
    ) {
      this.setBuildCategory(
        buildCategoryForKind(this.model.selectedBuild),
      );
    }
    this.lastSelectedBuild = this.model.selectedBuild;

    for (const definition of BUILD_DEFINITIONS) {
      const card = this.root.querySelector<HTMLButtonElement>(
        `[data-build="${definition.kind}"]`,
      );
      if (!card) continue;
      const selected = this.model.selectedBuild === definition.kind;
      const unlocked =
        this.model.buildAvailability?.[definition.kind] ?? true;
      const affordable =
        this.model.buildAffordability?.[definition.kind] ?? true;
      card.classList.toggle("is-selected", selected);
      card.classList.toggle("is-locked", !unlocked);
      card.classList.toggle(
        "is-unaffordable",
        unlocked && !affordable,
      );
      card.setAttribute("aria-pressed", String(selected));
      card.disabled = false;
      card.setAttribute(
        "aria-disabled",
        String(!unlocked || !affordable),
      );
      const cost = this.model.buildCosts?.[definition.kind] ?? definition.cost;
      const costNode = card.querySelector<HTMLElement>(
        `[data-build-cost="${definition.kind}"]`,
      );
      if (costNode) this.setText(costNode, formatInteger(cost));
      const status =
        this.model.buildStatus?.[definition.kind] ??
        (!unlocked
          ? "Locked"
          : !affordable
            ? "Insufficient alloy"
            : "Ready");
      const stateNode = card.querySelector<HTMLElement>(
        `[data-build-state="${definition.kind}"]`,
      );
      if (stateNode) this.setText(stateNode, status);
      const tooltip = `${definition.description} ${formatInteger(cost)} alloy. ${status}.`;
      card.dataset.tooltip = tooltip;
      card.title = tooltip;
      card.setAttribute(
        "aria-label",
        `${definition.name}, hotkey ${definition.key}, ${formatInteger(cost)} alloy, ${status}`,
      );
    }
  }

  private updateInspector(): void {
    const inspector = this.model.inspector;
    const inspectorIdentity = inspector?.id ?? null;
    const inspectorChanged = inspectorIdentity !== this.inspectorIdentity;
    const renderSignature = inspector
      ? JSON.stringify(inspector)
      : "closed";
    if (renderSignature === this.inspectorRenderSignature) return;
    this.inspectorRenderSignature = renderSignature;
    this.inspectorIdentity = inspectorIdentity;

    // A newly selected unit starts at its identity and operating readout. A
    // prior machine's deeply scrolled circuit/process console must not strand
    // the next unit's power state above the mobile viewport.
    if (inspectorChanged) this.inspector.scrollTop = 0;

    const isOpen = inspector !== null && inspector !== undefined;
    this.inspector.classList.toggle("is-open", isOpen);
    this.inspector.setAttribute("aria-hidden", String(!isOpen));
    this.inspector.toggleAttribute("inert", !isOpen);
    if (!inspector) {
      this.inspector.classList.remove("has-process-console");
      this.inspector.classList.remove("has-circuit-console");
      this.processConsole.hidden = true;
      this.circuitConsole.hidden = true;
      this.circuitEditorSignature = "";
      this.circuitLiveSignature = "";
      this.inspectorStats.hidden = false;
      this.recipeChip.hidden = false;
      this.manifoldControls.hidden = true;
      this.inspectorActions.hidden = true;
      return;
    }

    this.setText(this.inspectorType, inspector.type ?? "MACHINE INSPECTOR");
    this.setText(this.inspectorName, inspector.name);
    const status = inspector.status ?? "ONLINE";
    const tone = inspector.statusTone ?? "online";
    this.inspectorStatus.style.color = STATUS_COLORS[tone];
    const statusLabel = this.inspectorStatus.querySelector<HTMLElement>("span");
    if (statusLabel) this.setText(statusLabel, status.toUpperCase());

    const stats = inspector.stats ?? [];
    const signature = stats
      .map((stat, index) => stat.id ?? `${index}:${stat.label}`)
      .join("\u001f");
    if (signature !== this.inspectorStatSignature) {
      this.inspectorStatSignature = signature;
      this.inspectorStats.replaceChildren(
        ...stats.map((stat, index) => {
          const cell = document.createElement("div");
          cell.className = "stat-cell";
          cell.dataset.statId = stat.id ?? String(index);
          const label = document.createElement("label");
          const value = document.createElement("strong");
          const unit = document.createElement("small");
          value.append(unit);
          cell.append(label, value);
          return cell;
        }),
      );
    }

    stats.forEach((stat, index) => {
      const id = stat.id ?? String(index);
      const selector = `[data-stat-id="${escapeSelector(id)}"]`;
      const cell = this.inspectorStats.querySelector<HTMLElement>(selector);
      if (!cell) return;
      const label = cell.querySelector<HTMLElement>("label");
      const value = cell.querySelector<HTMLElement>("strong");
      if (label) this.setText(label, stat.label);
      if (value) {
        const fullValue = stat.unit ? `${String(stat.value)} ${stat.unit}` : String(stat.value);
        this.setText(value, fullValue);
      }
    });

    const actions = inspector.actions ?? [];
    this.inspectorActions.hidden = actions.length === 0;
    const actionSignature = actions
      .map(
        (action) =>
          `${action.id}:${action.label}:${Number(action.disabled ?? false)}`,
      )
      .join("\u001f");
    if (actionSignature !== this.inspectorActionSignature) {
      this.inspectorActionSignature = actionSignature;
      this.inspectorActions.replaceChildren(
        ...actions.map((action) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "inspector-action";
          button.dataset.inspectorAction = action.id;
          button.disabled = action.disabled ?? false;
          button.textContent = action.label;
          return button;
        }),
      );
    }

    const recipe = inspector.recipe;
    const process = inspector.machineProcess;
    const circuit = inspector.circuit;
    this.inspector.classList.toggle("has-process-console", Boolean(process));
    this.inspector.classList.toggle("has-circuit-console", Boolean(circuit));
    // Circuit controls supplement the machine readout; they must not hide the
    // selected unit's power and local-network state, especially on mobile
    // where the global telemetry strip is intentionally removed.
    this.inspectorStats.hidden = Boolean(process);
    this.recipeChip.hidden = Boolean(process) || Boolean(circuit) || !recipe;
    if (recipe) {
      this.setText(this.recipeIcon, recipe.icon ?? "◆");
      this.setText(this.recipeLabel, recipe.label);
      this.setText(this.recipeDetail, recipe.detail ?? "ACTIVE RECIPE");
    }
    this.processConsole.hidden = !process;
    if (process) this.updateMachineProcess(process);
    this.circuitConsole.hidden = !circuit;
    if (circuit) this.updateCircuitEditor(circuit);

    const routing = inspector.manifoldRouting;
    this.manifoldControls.hidden = !routing;
    if (!routing) return;

    for (const button of this.manifoldControls.querySelectorAll<HTMLButtonElement>(
      "[data-manifold-mode]",
    )) {
      const selected = button.dataset.manifoldMode === routing.mode;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }

    const filterSignature = routing.filterOptions
      .map((option) => `${option.id}:${option.label}`)
      .join("\u001f");
    if (filterSignature !== this.manifoldFilterSignature) {
      this.manifoldFilterSignature = filterSignature;
      this.manifoldFilter.replaceChildren(
        ...routing.filterOptions.map((option) => {
          const element = document.createElement("option");
          element.value = option.id;
          element.textContent = option.label;
          return element;
        }),
      );
    }
    const selectedFilter = routing.filter ?? routing.filterOptions[0]?.id ?? "";
    if (this.manifoldFilter.value !== selectedFilter) {
      this.manifoldFilter.value = selectedFilter;
    }
    const extractMode = routing.mode === "extract";
    this.manifoldFilter.disabled = !extractMode;
    this.manifoldFilterField.classList.toggle("is-disabled", !extractMode);
    this.manifoldExtractPorts.hidden = !extractMode;
    for (const button of this.manifoldExtractPorts.querySelectorAll<HTMLButtonElement>(
      "[data-manifold-extract-port]",
    )) {
      const selected =
        Number(button.dataset.manifoldExtractPort) === routing.extractPort;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    const extractPortLabel = routing.extractPort === 0 ? "A" : "B";
    const remainderPortLabel = routing.extractPort === 0 ? "B" : "A";
    this.manifoldFilter.setAttribute(
      "aria-label",
      `Payload extracted to local port ${extractPortLabel}`,
    );
    this.setText(
      this.manifoldFilterHint,
      `Match → ${extractPortLabel} · Remainder → ${remainderPortLabel}`,
    );

    this.setText(
      this.manifoldPortA,
      `${formatInteger(routing.portCounts[0])} queued`,
    );
    this.setText(
      this.manifoldPortB,
      `${formatInteger(routing.portCounts[1])} queued`,
    );
    this.setText(
      this.manifoldNextSplit,
      routing.splitCursors
        .map((cursor, lane) => `L${lane}:${cursor === 0 ? "A" : "B"}`)
        .join(" · "),
    );
    this.manifoldNextSplit.setAttribute(
      "aria-label",
      routing.splitCursors
        .map((cursor, lane) => `Lane ${lane} ${cursor === 0 ? "A" : "B"}`)
        .join(", "),
    );
    this.setText(
      this.manifoldNextMerge,
      routing.mergeCursors
        .map((cursor, lane) => `L${lane}:${cursor === 0 ? "A" : "B"}`)
        .join(" · "),
    );
    this.manifoldNextMerge.setAttribute(
      "aria-label",
      routing.mergeCursors
        .map((cursor, lane) => `Lane ${lane} ${cursor === 0 ? "A" : "B"}`)
        .join(", "),
    );
  }

  private updateCircuitEditor(circuit: HUDCircuitEditor): void {
    const signature = JSON.stringify({
      entityId: circuit.entityId,
      entityKind: circuit.entityKind,
      mode: circuit.mode,
      device: circuit.device,
      machine: circuit.machine,
      capabilities: circuit.capabilities,
      endpoints: circuit.endpoints.map((endpoint) => ({
        connector: endpoint.connector,
        label: endpoint.label,
      })),
      wires: circuit.wires,
      pendingWire: circuit.pendingWire,
      signalOptions: circuit.signalOptions,
    });
    if (signature !== this.circuitEditorSignature) {
      this.circuitEditorSignature = signature;
      this.renderCircuitProgram(circuit);
      this.renderCircuitPatchbay(circuit);
      this.syncCircuitDraftVisibility();
    }
    this.updateCircuitLive(circuit);
  }

  private renderCircuitProgram(circuit: HUDCircuitEditor): void {
    const signalLists = this.circuitSignalDatalists(circuit);
    if (circuit.mode === "constant") {
      const configuration =
        circuit.device?.kind === "constant"
          ? circuit.device
          : { kind: "constant" as const, enabled: true, signals: [] };
      const rows = configuration.signals
        .map((entry) =>
          this.constantSignalRowMarkup(
            entry.signal.type,
            entry.signal.name,
            entry.value,
          )
        )
        .join("");
      this.circuitProgram.innerHTML = `
        <form class="circuit-form" data-circuit-form="constant">
          <fieldset>
            <legend>Broadcast frame</legend>
            <label class="circuit-toggle">
              <input type="checkbox" name="constant-enabled" ${configuration.enabled === false ? "" : "checked"}>
              <span>Broadcast enabled</span>
            </label>
            <div class="circuit-signal-rows" data-circuit-signal-rows>
              ${rows || '<p class="circuit-empty-row">No constants yet. Add a typed signal to begin broadcasting.</p>'}
            </div>
            <button class="circuit-secondary" type="button" data-circuit-action="add-signal">＋ Add signal</button>
          </fieldset>
          <button class="circuit-apply" type="submit">Apply constant frame</button>
        </form>${signalLists}`;
      return;
    }

    if (circuit.mode === "arithmetic") {
      const configuration =
        circuit.device?.kind === "arithmetic"
          ? circuit.device
          : undefined;
      const left = this.operandState(configuration?.left);
      const right = this.operandState(configuration?.right);
      const output = this.selectorState(configuration?.output);
      this.circuitProgram.innerHTML = `
        <form class="circuit-form" data-circuit-form="arithmetic">
          <fieldset>
            <legend>Arithmetic program</legend>
            <div class="circuit-equation">
              ${this.circuitExpressionMarkup("arith-left", "Left operand", left, ["constant", "signal", "each"])}
              <label class="circuit-field circuit-operator">
                <span>Operator</span>
                <select name="arith-operator" aria-label="Arithmetic operator">
                  ${CIRCUIT_ARITHMETIC_OPERATORS.map((operator) => `<option value="${operator}" ${configuration?.operator === operator ? "selected" : ""}>${escapeMarkup(circuitLabel(operator))}</option>`).join("")}
                </select>
              </label>
              ${this.circuitExpressionMarkup("arith-right", "Right operand", right, ["constant", "signal", "each"])}
            </div>
            ${this.circuitExpressionMarkup("arith-output", "Output signal", output, ["signal", "each"])}
            <p class="circuit-form-hint">Each output is valid when either operand also uses Each.</p>
          </fieldset>
          <button class="circuit-apply" type="submit">Apply arithmetic program</button>
        </form>${signalLists}`;
      return;
    }

    if (circuit.mode === "decider") {
      const configuration =
        circuit.device?.kind === "decider" ? circuit.device : undefined;
      this.circuitProgram.innerHTML = `
        <form class="circuit-form" data-circuit-form="decider">
          <fieldset>
            <legend>Decision program</legend>
            ${this.circuitConditionMarkup("decider", configuration?.condition)}
            <div class="circuit-output-row">
              ${this.circuitExpressionMarkup("decider-output", "Output signal", this.selectorState(configuration?.output), ["signal", "each"])}
              <label class="circuit-field">
                <span>Output value</span>
                <select name="decider-output-mode">
                  <option value="one" ${configuration?.outputMode === "one" ? "selected" : ""}>Fixed 1</option>
                  <option value="inputCount" ${configuration?.outputMode !== "one" ? "selected" : ""}>Input count</option>
                </select>
              </label>
            </div>
          </fieldset>
          <button class="circuit-apply" type="submit">Apply decision program</button>
        </form>${signalLists}`;
      return;
    }

    const capabilities = circuit.capabilities;
    const configuration = circuit.machine ?? {};
    if (!capabilities) {
      this.circuitProgram.innerHTML =
        '<p class="circuit-empty-row">This unit has no configurable circuit port.</p>';
      return;
    }
    const sections = [
      capabilities.enable
        ? this.circuitConditionToggleMarkup(
            "machine-enable",
            "Enable condition",
            configuration.enableCondition,
          )
        : "",
      capabilities.powerSwitch
        ? this.circuitConditionToggleMarkup(
            "machine-power",
            "Power switch condition",
            configuration.powerSwitchCondition,
          )
        : "",
      capabilities.filter
        ? this.circuitFilterMarkup(circuit, configuration)
        : "",
      capabilities.sorter
        ? this.circuitSorterMarkup(configuration)
        : "",
    ].join("");
    const configurable =
      capabilities.enable ||
      capabilities.powerSwitch ||
      capabilities.filter ||
      capabilities.sorter;
    this.circuitProgram.innerHTML = configurable
      ? `
        <form class="circuit-form circuit-machine-form" data-circuit-form="machine">
          ${sections}
          <button class="circuit-apply" type="submit">Apply machine controls</button>
        </form>${signalLists}`
      : `
        <section class="circuit-sensor-note">
          <b>Telemetry-only port</b>
          <p>This unit publishes live sensor values but has no writable control capability.</p>
        </section>${signalLists}`;
  }

  private circuitSignalDatalists(circuit: HUDCircuitEditor): string {
    const options = [
      ...circuit.signalOptions.item,
      ...circuit.signalOptions.fluid,
      ...circuit.signalOptions.virtual,
    ]
      .map(
        (option) =>
          `<option value="${escapeMarkup(option.id)}">${escapeMarkup(option.label)}</option>`,
      )
      .join("");
    return `<datalist id="circuit-signal-catalog">${options}</datalist>`;
  }

  private constantSignalRowMarkup(
    type: CircuitSignalType = "virtual",
    name = "signal-A",
    value: number | string = 1,
  ): string {
    return `
      <div class="circuit-signal-row" data-circuit-constant-row>
        <label class="circuit-field">
          <span>Type</span>
          ${this.signalTypeSelect("constant-signal-type", type)}
        </label>
        <label class="circuit-field circuit-signal-name">
          <span>Signal</span>
          <input name="constant-signal-name" list="circuit-signal-catalog" value="${escapeMarkup(name)}" autocomplete="off" aria-label="Constant signal name">
        </label>
        <label class="circuit-field circuit-signal-value">
          <span>Value</span>
          <input name="constant-signal-value" type="number" step="1" value="${escapeMarkup(String(value))}" aria-label="Constant signal value">
        </label>
        <button class="circuit-icon-action" type="button" data-circuit-action="remove-signal" aria-label="Remove this constant signal">×</button>
      </div>`;
  }

  private signalTypeSelect(
    name: string,
    selected: CircuitSignalType,
  ): string {
    return `<select name="${name}" aria-label="Signal type">
      ${(["item", "fluid", "virtual"] as const)
        .map(
          (type) =>
            `<option value="${type}" ${selected === type ? "selected" : ""}>${circuitLabel(type)}</option>`,
        )
        .join("")}
    </select>`;
  }

  private selectorState(
    selector:
      | CircuitSelector
      | CircuitSignal
      | { readonly wildcard: "each" }
      | undefined,
  ): CircuitSelectorDraft {
    if (selector && "wildcard" in selector) {
      return {
        source: selector.wildcard,
        type: "virtual",
        name: "signal-A",
      };
    }
    return {
      source: "signal",
      type: selector?.type ?? "virtual",
      name: selector?.name ?? "signal-A",
    };
  }

  private operandState(
    operand: CircuitOperand | undefined,
  ): CircuitOperandDraft {
    if (!operand || operand.kind === "constant") {
      return {
        source: "constant",
        type: "virtual",
        name: "signal-A",
        value: operand?.value ?? 0,
      };
    }
    const selector = this.selectorState(operand.selector);
    return { ...selector, value: 0 };
  }

  private circuitExpressionMarkup(
    prefix: string,
    label: string,
    draft: CircuitSelectorDraft | CircuitOperandDraft,
    sources: readonly (
      | "constant"
      | "signal"
      | "each"
      | "any"
      | "every"
    )[],
  ): string {
    const sourceLabels: Record<(typeof sources)[number], string> = {
      constant: "Constant",
      signal: "Signal",
      each: "Each",
      any: "Any",
      every: "Every",
    };
    return `
      <div class="circuit-expression" data-circuit-expression>
        <label class="circuit-field">
          <span>${escapeMarkup(label)}</span>
          <select name="${prefix}-source" data-circuit-source aria-label="${escapeMarkup(label)} source">
            ${sources.map((source) => `<option value="${source}" ${draft.source === source ? "selected" : ""}>${sourceLabels[source]}</option>`).join("")}
          </select>
        </label>
        <div class="circuit-signal-fields" data-circuit-signal-fields>
          <label class="circuit-field">
            <span>Type</span>
            ${this.signalTypeSelect(`${prefix}-type`, draft.type)}
          </label>
          <label class="circuit-field circuit-signal-name">
            <span>Name</span>
            <input name="${prefix}-name" list="circuit-signal-catalog" value="${escapeMarkup(draft.name)}" autocomplete="off" aria-label="${escapeMarkup(label)} signal name">
          </label>
        </div>
        <label class="circuit-field circuit-constant-field" data-circuit-constant-field>
          <span>Value</span>
          <input name="${prefix}-value" type="number" step="1" value="${escapeMarkup(String("value" in draft ? (draft.value ?? 0) : 0))}" aria-label="${escapeMarkup(label)} constant value">
        </label>
      </div>`;
  }

  private circuitConditionMarkup(
    prefix: string,
    condition: CircuitCondition | undefined,
  ): string {
    const left = this.selectorState(condition?.left);
    const right = this.operandState(condition?.right);
    return `
      <div class="circuit-condition" data-circuit-condition>
        ${this.circuitExpressionMarkup(`${prefix}-left`, "Left selector", left, ["signal", "each", "any", "every"])}
        <label class="circuit-field circuit-operator">
          <span>Compare</span>
          <select name="${prefix}-operator" aria-label="Comparison operator">
            ${CIRCUIT_COMPARISON_OPERATORS.map((operator) => `<option value="${escapeMarkup(operator)}" ${condition?.operator === operator ? "selected" : ""}>${escapeMarkup(operator)}</option>`).join("")}
          </select>
        </label>
        ${this.circuitExpressionMarkup(`${prefix}-right`, "Right operand", right, ["constant", "signal"])}
      </div>`;
  }

  private circuitConditionToggleMarkup(
    prefix: string,
    label: string,
    condition: CircuitCondition | undefined,
  ): string {
    return `
      <fieldset class="circuit-control" data-circuit-control>
        <legend>${escapeMarkup(label)}</legend>
        <label class="circuit-toggle">
          <input type="checkbox" name="${prefix}-active" data-circuit-control-toggle ${condition ? "checked" : ""}>
          <span>Use ${escapeMarkup(label.toLowerCase())}</span>
        </label>
        <div class="circuit-control-body" data-circuit-control-body>
          ${this.circuitConditionMarkup(prefix, condition)}
        </div>
      </fieldset>`;
  }

  private circuitFilterMarkup(
    circuit: HUDCircuitEditor,
    configuration: CircuitMachinePortConfiguration,
  ): string {
    const candidates = new Set(
      configuration.filter?.candidates?.map((signal) => signal.name) ?? [],
    );
    return `
      <fieldset class="circuit-control" data-circuit-control>
        <legend>Item filter</legend>
        <label class="circuit-toggle">
          <input type="checkbox" name="machine-filter-active" data-circuit-control-toggle ${configuration.filter ? "checked" : ""}>
          <span>Select item from input signals</span>
        </label>
        <div class="circuit-control-body" data-circuit-control-body>
          <label class="circuit-field">
            <span>Minimum signal value</span>
            <input type="number" step="1" name="machine-filter-minimum" value="${configuration.filter?.minimum ?? 1}">
          </label>
          <div class="circuit-item-candidates" role="group" aria-label="Eligible item signals">
            ${circuit.signalOptions.item.map((option) => `
              <label>
                <input type="checkbox" name="machine-filter-candidate" value="${escapeMarkup(option.id)}" ${candidates.has(option.id) ? "checked" : ""}>
                <span>${escapeMarkup(option.label)}</span>
              </label>`).join("")}
          </div>
          <p class="circuit-form-hint">No checked items means every non-zero input signal is eligible.</p>
        </div>
      </fieldset>`;
  }

  private circuitSorterMarkup(
    configuration: CircuitMachinePortConfiguration,
  ): string {
    const routes =
      configuration.sorterRoutes?.map((route) =>
        this.circuitSorterRouteMarkup(
          route.priority,
          route.output as "A" | "B",
          route.condition,
        )
      ).join("") ?? "";
    return `
      <fieldset class="circuit-control circuit-sorter-control">
        <legend>Sorter routes</legend>
        <div class="circuit-sorter-routes" data-circuit-sorter-routes>
          ${routes || '<p class="circuit-empty-row">No conditional routes. The fallback handles every payload.</p>'}
        </div>
        <button class="circuit-secondary" type="button" data-circuit-action="add-route">＋ Add route</button>
        <label class="circuit-field circuit-fallback">
          <span>Fallback output</span>
          <select name="machine-sorter-fallback">
            <option value="">No fallback</option>
            <option value="A" ${configuration.sorterFallback === "A" ? "selected" : ""}>Port A</option>
            <option value="B" ${configuration.sorterFallback === "B" ? "selected" : ""}>Port B</option>
          </select>
        </label>
      </fieldset>`;
  }

  private circuitSorterRouteMarkup(
    priority: number | string = 0,
    output: "A" | "B" = "A",
    condition?: CircuitCondition,
  ): string {
    return `
      <section class="circuit-sorter-route" data-circuit-sorter-route>
        <header>
          <label class="circuit-field">
            <span>Priority</span>
            <input type="number" step="1" name="route-priority" value="${escapeMarkup(String(priority))}">
          </label>
          <label class="circuit-field">
            <span>Output</span>
            <select name="route-output">
              <option value="A" ${output === "A" ? "selected" : ""}>Port A</option>
              <option value="B" ${output === "B" ? "selected" : ""}>Port B</option>
            </select>
          </label>
          <button class="circuit-icon-action" type="button" data-circuit-action="remove-route" aria-label="Remove this sorter route">×</button>
        </header>
        ${this.circuitConditionMarkup("route", condition)}
      </section>`;
  }

  private renderCircuitPatchbay(circuit: HUDCircuitEditor): void {
    const pending = circuit.pendingWire;
    this.circuitWireStatus.innerHTML = pending
      ? `<span class="wire-dot is-${pending.color}" aria-hidden="true"></span><b>${pending.color.toUpperCase()} source:</b> ${escapeMarkup(pending.sourceLabel)}. Select a destination unit in the world, then choose its connector. <button type="button" data-circuit-wire-action="cancel">Cancel</button>`
      : "Choose Red or Green on a connector, select a destination unit in the world, then choose its connector.";

    this.circuitEndpoints.innerHTML = circuit.endpoints
      .map((endpoint) => {
        const point = {
          entityId: circuit.entityId,
          connector: endpoint.connector,
        };
        return `
          <section class="circuit-endpoint" data-circuit-connector="${endpoint.connector}">
            <span>
              <b>${escapeMarkup(endpoint.label)}</b>
              <small>${endpoint.connector === "io" ? "BIDIRECTIONAL CONNECTOR" : `${endpoint.connector.toUpperCase()} CONNECTOR`}</small>
            </span>
            <div role="group" aria-label="${escapeMarkup(endpoint.label)} wire controls">
              ${(["red", "green"] as const).map((color) => {
                const isPendingColor = pending?.color === color;
                const label = pending
                  ? isPendingColor
                    ? `Connect ${color}`
                    : `${circuitLabel(color)} unavailable while ${pending.color} is armed`
                  : `Start ${color} wire`;
                return `<button
                  type="button"
                  class="circuit-wire-button is-${color}"
                  data-circuit-wire-action="${pending && isPendingColor ? "finish" : "start"}"
                  data-wire-color="${color}"
                  data-entity-id="${point.entityId}"
                  data-connector="${point.connector}"
                  aria-label="${escapeMarkup(label)}"
                  ${pending && !isPendingColor ? "disabled" : ""}
                ><i aria-hidden="true"></i>${pending && isPendingColor ? "CONNECT" : color.toUpperCase()}</button>`;
              }).join("")}
            </div>
          </section>`;
      })
      .join("");

    this.circuitWires.innerHTML =
      circuit.wires.length === 0
        ? '<p class="circuit-empty-row">No wires attached to this unit.</p>'
        : circuit.wires
            .map(
              (wire) => `
                <div class="circuit-wire-record">
                  <span class="wire-dot is-${wire.color}" aria-hidden="true"></span>
                  <span><b>${wire.color.toUpperCase()}</b><small>${escapeMarkup(wire.firstLabel)} ↔ ${escapeMarkup(wire.secondLabel)}</small></span>
                  <button
                    type="button"
                    data-circuit-wire-action="disconnect"
                    data-wire-color="${wire.color}"
                    data-first-entity="${wire.first.entityId}"
                    data-first-connector="${wire.first.connector}"
                    data-second-entity="${wire.second.entityId}"
                    data-second-connector="${wire.second.connector}"
                    aria-label="Remove ${wire.color} wire between ${escapeMarkup(wire.firstLabel)} and ${escapeMarkup(wire.secondLabel)}"
                  >Remove</button>
                </div>`,
            )
            .join("");
  }

  private updateCircuitLive(circuit: HUDCircuitEditor): void {
    const signature = JSON.stringify({
      entityId: circuit.entityId,
      endpoints: circuit.endpoints.map((endpoint) => ({
        connector: endpoint.connector,
        signals: endpoint.signals,
      })),
      control: circuit.control,
    });
    if (signature === this.circuitLiveSignature) return;
    this.circuitLiveSignature = signature;
    const endpointMarkup = circuit.endpoints
      .map((endpoint) => {
        const signals = endpoint.signals
          .filter((signal) => signal.value !== 0)
          .slice(0, 8);
        return `
          <section>
            <header><b>${escapeMarkup(endpoint.label)}</b><small>${signals.length === 0 ? "QUIET" : `${signals.length} ACTIVE`}</small></header>
            <div>
              ${signals.length === 0
                ? '<span class="circuit-live-empty">No non-zero signals</span>'
                : signals.map((signal) => `<span title="${escapeMarkup(`${signal.type}:${signal.name}`)}"><i>${escapeMarkup(signal.type.slice(0, 1).toUpperCase())}</i>${escapeMarkup(circuitLabel(signal.name))}<b>${signal.value.toLocaleString("en-US")}</b></span>`).join("")}
            </div>
          </section>`;
      })
      .join("");
    const control = circuit.control;
    const controlMarkup =
      circuit.mode === "machine" && control
        ? `<section class="circuit-control-live">
            <header><b>CONTROL RESULT</b><small>AUTHORITATIVE TICK</small></header>
            <div>
              <span><i>E</i>Enabled<b>${control.enabled ? "YES" : "NO"}</b></span>
              <span><i>P</i>Power switch<b>${control.powerSwitchClosed ? "CLOSED" : "OPEN"}</b></span>
              <span><i>F</i>Filter<b>${escapeMarkup(control.filterSignal?.name ?? "ANY")}</b></span>
              <span><i>S</i>Sorter<b>${escapeMarkup(control.sorterOutput ?? "—")}</b></span>
            </div>
          </section>`
        : "";
    this.circuitLive.innerHTML = endpointMarkup + controlMarkup;
  }

  private syncCircuitDraftVisibility(): void {
    for (const expression of this.circuitProgram.querySelectorAll<HTMLElement>(
      "[data-circuit-expression]",
    )) {
      const source =
        expression.querySelector<HTMLSelectElement>("[data-circuit-source]")
          ?.value ?? "signal";
      const signalFields = expression.querySelector<HTMLElement>(
        "[data-circuit-signal-fields]",
      );
      const constantField = expression.querySelector<HTMLElement>(
        "[data-circuit-constant-field]",
      );
      if (signalFields) signalFields.hidden = source !== "signal";
      if (constantField) constantField.hidden = source !== "constant";
    }
    for (const control of this.circuitProgram.querySelectorAll<HTMLElement>(
      "[data-circuit-control]",
    )) {
      const toggle = control.querySelector<HTMLInputElement>(
        "[data-circuit-control-toggle]",
      );
      const body = control.querySelector<HTMLElement>(
        "[data-circuit-control-body]",
      );
      if (toggle && body) body.hidden = !toggle.checked;
    }
  }

  private handleCircuitConsoleClick(event: Event): void {
    const target = event.target;
    const button =
      target instanceof Element
        ? target.closest<HTMLButtonElement>(
            "[data-circuit-action], [data-circuit-wire-action]",
          )
        : null;
    if (!button || !this.circuitConsole.contains(button)) return;

    const action = button.dataset.circuitAction;
    if (action === "add-signal") {
      const rows = this.circuitProgram.querySelector<HTMLElement>(
        "[data-circuit-signal-rows]",
      );
      if (!rows) return;
      if (
        rows.querySelectorAll("[data-circuit-constant-row]").length >= 32
      ) {
        this.showToast({
          title: "FRAME LIMIT",
          message: "The field editor supports up to 32 constant signal rows.",
          tone: "error",
        });
        return;
      }
      rows.querySelector(".circuit-empty-row")?.remove();
      rows.insertAdjacentHTML(
        "beforeend",
        this.constantSignalRowMarkup("virtual", "signal-A", 1),
      );
      rows
        .querySelector<HTMLInputElement>(
          "[data-circuit-constant-row]:last-child input[name='constant-signal-name']",
        )
        ?.focus();
      return;
    }
    if (action === "remove-signal") {
      button.closest("[data-circuit-constant-row]")?.remove();
      const rows = this.circuitProgram.querySelector<HTMLElement>(
        "[data-circuit-signal-rows]",
      );
      if (rows && !rows.querySelector("[data-circuit-constant-row]")) {
        rows.innerHTML =
          '<p class="circuit-empty-row">No constants yet. Add a typed signal to begin broadcasting.</p>';
      }
      return;
    }
    if (action === "add-route") {
      const routes = this.circuitProgram.querySelector<HTMLElement>(
        "[data-circuit-sorter-routes]",
      );
      if (!routes) return;
      const count = routes.querySelectorAll(
        "[data-circuit-sorter-route]",
      ).length;
      if (count >= 16) {
        this.showToast({
          title: "ROUTE LIMIT",
          message: "The field editor supports up to 16 sorter routes.",
          tone: "error",
        });
        return;
      }
      routes.querySelector(".circuit-empty-row")?.remove();
      routes.insertAdjacentHTML(
        "beforeend",
        this.circuitSorterRouteMarkup(count, count % 2 === 0 ? "A" : "B"),
      );
      this.syncCircuitDraftVisibility();
      routes
        .querySelector<HTMLInputElement>(
          "[data-circuit-sorter-route]:last-child input",
        )
        ?.focus();
      return;
    }
    if (action === "remove-route") {
      button.closest("[data-circuit-sorter-route]")?.remove();
      const routes = this.circuitProgram.querySelector<HTMLElement>(
        "[data-circuit-sorter-routes]",
      );
      if (routes && !routes.querySelector("[data-circuit-sorter-route]")) {
        routes.innerHTML =
          '<p class="circuit-empty-row">No conditional routes. The fallback handles every payload.</p>';
      }
      return;
    }

    const wireAction = button.dataset.circuitWireAction;
    if (!wireAction) return;
    if (wireAction === "cancel") {
      this.callbacks.onCircuitWireCancel?.();
      return;
    }
    if (wireAction === "disconnect") {
      const color = button.dataset.wireColor as CircuitWireColor;
      const firstEntity = Number(button.dataset.firstEntity);
      const secondEntity = Number(button.dataset.secondEntity);
      const firstConnector = button.dataset
        .firstConnector as CircuitConnectionPoint["connector"];
      const secondConnector = button.dataset
        .secondConnector as CircuitConnectionPoint["connector"];
      if (
        (color === "red" || color === "green") &&
        Number.isSafeInteger(firstEntity) &&
        Number.isSafeInteger(secondEntity)
      ) {
        this.callbacks.onCircuitWireDisconnect?.(
          color,
          { entityId: firstEntity, connector: firstConnector },
          { entityId: secondEntity, connector: secondConnector },
        );
      }
      return;
    }
    const color = button.dataset.wireColor as CircuitWireColor;
    const entityId = Number(button.dataset.entityId);
    const connector = button.dataset
      .connector as CircuitConnectionPoint["connector"];
    if (
      (color !== "red" && color !== "green") ||
      !Number.isSafeInteger(entityId) ||
      !["input", "output", "io"].includes(connector)
    ) {
      return;
    }
    const point = { entityId, connector };
    if (wireAction === "start") {
      this.callbacks.onCircuitWireStart?.(color, point);
    } else if (wireAction === "finish") {
      this.callbacks.onCircuitWireFinish?.(point);
    }
  }

  private commitCircuitForm(target: EventTarget | null): void {
    if (!(target instanceof HTMLFormElement)) return;
    const circuit = this.model.inspector?.circuit;
    if (!circuit) return;
    try {
      switch (target.dataset.circuitForm) {
        case "constant": {
          const signals = [
            ...target.querySelectorAll<HTMLElement>(
              "[data-circuit-constant-row]",
            ),
          ].map((row) => ({
            type: this.circuitInputValue(
              row,
              "constant-signal-type",
            ) as CircuitSignalType,
            name: this.circuitInputValue(row, "constant-signal-name"),
            value: this.circuitInputValue(row, "constant-signal-value"),
          }));
          const draft: CircuitDeviceDraft = {
            kind: "constant",
            enabled:
              target.querySelector<HTMLInputElement>(
                "[name='constant-enabled']",
              )?.checked ?? false,
            signals,
          };
          this.callbacks.onCircuitDeviceConfigure?.(
            circuit.entityId,
            draft,
          );
          break;
        }
        case "arithmetic": {
          const draft: CircuitDeviceDraft = {
            kind: "arithmetic",
            left: this.readCircuitOperand(target, "arith-left"),
            operator: this.circuitInputValue(
              target,
              "arith-operator",
            ) as Extract<
              CircuitDeviceDraft,
              { readonly kind: "arithmetic" }
            >["operator"],
            right: this.readCircuitOperand(target, "arith-right"),
            output: this.readCircuitSelector(target, "arith-output"),
          } as CircuitDeviceDraft;
          this.callbacks.onCircuitDeviceConfigure?.(
            circuit.entityId,
            draft,
          );
          break;
        }
        case "decider": {
          const draft: CircuitDeviceDraft = {
            kind: "decider",
            condition: this.readCircuitCondition(target, "decider"),
            output: this.readCircuitSelector(target, "decider-output"),
            outputMode: this.circuitInputValue(
              target,
              "decider-output-mode",
            ) as "one" | "inputCount",
          };
          this.callbacks.onCircuitDeviceConfigure?.(
            circuit.entityId,
            draft,
          );
          break;
        }
        case "machine": {
          const draft: CircuitMachineDraft = {
            ...(target.querySelector<HTMLInputElement>(
              "[name='machine-enable-active']",
            )?.checked
              ? {
                  enableCondition: this.readCircuitCondition(
                    target,
                    "machine-enable",
                  ),
                }
              : {}),
            ...(target.querySelector<HTMLInputElement>(
              "[name='machine-power-active']",
            )?.checked
              ? {
                  powerSwitchCondition: this.readCircuitCondition(
                    target,
                    "machine-power",
                  ),
                }
              : {}),
            ...(target.querySelector<HTMLInputElement>(
              "[name='machine-filter-active']",
            )?.checked
              ? {
                  filter: {
                    minimum: this.circuitInputValue(
                      target,
                      "machine-filter-minimum",
                    ),
                    candidates: [
                      ...target.querySelectorAll<HTMLInputElement>(
                        "[name='machine-filter-candidate']:checked",
                      ),
                    ].map((input) => ({
                      type: "item" as const,
                      name: input.value,
                    })),
                  },
                }
              : {}),
            ...(target.querySelector("[data-circuit-sorter-routes]")
              ? {
                  sorterRoutes: [
                    ...target.querySelectorAll<HTMLElement>(
                      "[data-circuit-sorter-route]",
                    ),
                  ].map((route) => ({
                    priority: this.circuitInputValue(
                      route,
                      "route-priority",
                    ),
                    output: this.circuitInputValue(
                      route,
                      "route-output",
                    ) as "A" | "B",
                    condition: this.readCircuitCondition(route, "route"),
                  })),
                  ...(this.circuitInputValue(
                    target,
                    "machine-sorter-fallback",
                    false,
                  )
                    ? {
                        sorterFallback: this.circuitInputValue(
                          target,
                          "machine-sorter-fallback",
                        ) as "A" | "B",
                      }
                    : {}),
                }
              : {}),
          };
          this.callbacks.onCircuitMachineConfigure?.(
            circuit.entityId,
            draft,
          );
          break;
        }
      }
    } catch (error) {
      this.showToast({
        title: "PROGRAM INCOMPLETE",
        message:
          error instanceof Error
            ? error.message
            : "Complete every visible circuit field.",
        tone: "error",
        duration: 2600,
      });
    }
  }

  private circuitInputValue(
    scope: ParentNode,
    name: string,
    required = true,
  ): string {
    const field = scope.querySelector<HTMLInputElement | HTMLSelectElement>(
      `[name="${escapeSelector(name)}"]`,
    );
    if (!field && required) {
      throw new Error(`The ${circuitLabel(name)} field is unavailable.`);
    }
    return field?.value ?? "";
  }

  private readCircuitSelector(
    scope: ParentNode,
    prefix: string,
  ): CircuitSelectorDraft {
    return {
      source: this.circuitInputValue(
        scope,
        `${prefix}-source`,
      ) as CircuitSelectorDraft["source"],
      type: this.circuitInputValue(
        scope,
        `${prefix}-type`,
      ) as CircuitSignalType,
      name: this.circuitInputValue(scope, `${prefix}-name`),
    };
  }

  private readCircuitOperand(
    scope: ParentNode,
    prefix: string,
  ): CircuitOperandDraft {
    const selector = this.readCircuitSelector(scope, prefix);
    return {
      ...selector,
      source: selector.source as CircuitOperandDraft["source"],
      value: this.circuitInputValue(scope, `${prefix}-value`),
    };
  }

  private readCircuitCondition(
    scope: ParentNode,
    prefix: string,
  ): CircuitConditionDraft {
    return {
      left: this.readCircuitSelector(scope, `${prefix}-left`),
      operator: this.circuitInputValue(
        scope,
        `${prefix}-operator`,
      ) as CircuitConditionDraft["operator"],
      right: this.readCircuitOperand(scope, `${prefix}-right`),
    };
  }

  private updateMachineProcess(process: HUDMachineProcess): void {
    this.processConsole.dataset.machineKind = process.kind;
    this.processConsole.dataset.processState = process.state;
    this.processConsole.dataset.stateSignature = {
      unconfigured: "chamber-disabled",
      starved: "input-warning",
      working: "chamber-running",
      queued: "target-bridge",
      "output-blocked": "output-gate",
      "no-power": "grid-lockout",
      idle: "armed-standby",
    }[process.state];
    this.processConsole.style.setProperty(
      "--machine-accent",
      process.kind === "smelter" ? "#ff7847" : "#55e0d0",
    );

    this.updateProcessMetric(
      "cycle",
      `${Math.round(process.timing.progress * 100)}%`,
      process.active ? "COMMITTED BATCH" : "CHAMBER CLEAR",
      {
        progress: process.timing.progress.toFixed(4),
      },
    );
    const base = this.formatProcessSeconds(process.timing.baseSeconds);
    const effective = this.formatProcessSeconds(process.timing.effectiveSeconds);
    const remaining = this.formatProcessSeconds(process.timing.remainingSeconds);
    this.updateProcessMetric(
      "timing",
      `${base} / ${effective}`,
      process.timing.remainingSeconds === null
        ? "BASE / LIVE"
        : `${remaining} REMAINING`,
      {
        baseSeconds:
          process.timing.baseSeconds === null
            ? ""
            : process.timing.baseSeconds.toFixed(4),
        effectiveSeconds:
          process.timing.effectiveSeconds === null
            ? ""
            : process.timing.effectiveSeconds.toFixed(4),
        remainingSeconds:
          process.timing.remainingSeconds === null
            ? ""
            : process.timing.remainingSeconds.toFixed(4),
      },
    );
    this.updateProcessMetric(
      "power",
      `${Math.round(process.power.satisfaction * 100)}%`,
      `${formatInteger(process.power.demandKW)} kW DEMAND`,
      {
        demandKw: String(process.power.demandKW),
        satisfaction: process.power.satisfaction.toFixed(4),
      },
    );
    this.updateProcessMetric(
      "speed",
      `${process.speed.effective.toFixed(2)}×`,
      `BASE ${this.compactDecimal(process.speed.base)}× · BEACON ${this.compactDecimal(process.speed.beaconMultiplier)}×`,
      {
        base: process.speed.base.toFixed(4),
        beaconMultiplier: process.speed.beaconMultiplier.toFixed(4),
        effective: process.speed.effective.toFixed(4),
      },
    );

    this.updateProcessBuffer("input", process.buffers.input);
    this.updateProcessBuffer("output", process.buffers.output);
    this.updateProcessBuffer("reclaim", process.buffers.reclaim);
    this.updateProcessChamber(process.active);
    this.updateRecipeDeck(process);

    this.processCondition.dataset.tone = process.condition.tone;
    this.setText(this.processCondition, process.condition.text);
  }

  private updateProcessMetric(
    id: "cycle" | "timing" | "power" | "speed",
    value: string,
    detail: string,
    data: Readonly<Record<string, string>>,
  ): void {
    const cell = this.processConsole.querySelector<HTMLElement>(
      `[data-process-metric="${id}"]`,
    );
    if (!cell) return;
    const valueElement = cell.querySelector<HTMLElement>("strong");
    const detailElement = cell.querySelector<HTMLElement>("em");
    if (valueElement) this.setText(valueElement, value);
    if (detailElement) this.setText(detailElement, detail);
    for (const [key, dataValue] of Object.entries(data)) {
      cell.dataset[key] = dataValue;
    }
  }

  private updateProcessBuffer(
    kind: "input" | "output" | "reclaim",
    buffer: HUDBuffer,
  ): void {
    const list = this.requireElement(
      `[data-ref="process-${kind}-list"]`,
    );
    const signature = buffer.items.map((item) => item.id).join("\u001f");
    if (signature !== this.processBufferSignatures[kind]) {
      this.processBufferSignatures[kind] = signature;
      if (buffer.items.length === 0) {
        const empty = document.createElement("li");
        empty.className = "process-empty";
        empty.textContent =
          kind === "reclaim" ? "No stranded material" : "Buffer empty";
        list.replaceChildren(empty);
      } else {
        list.replaceChildren(
          ...buffer.items.map((item) => {
            const row = document.createElement("li");
            row.className = "process-stack";
            row.dataset.processItem = "";
            row.dataset.itemId = item.id;
            const swatch = document.createElement("span");
            swatch.className = "process-item-icon";
            swatch.append(
              this.createPictogram(
                item.id,
                `${item.label} material pictogram`,
              ),
            );
            const label = document.createElement("span");
            label.className = "process-item-label";
            const amount = document.createElement("strong");
            row.append(swatch, label, amount);
            return row;
          }),
        );
      }
    }

    for (const item of buffer.items) {
      const row = list.querySelector<HTMLElement>(
        `[data-item-id="${escapeSelector(item.id)}"]`,
      );
      if (!row) continue;
      row.dataset.amount = String(item.amount);
      row.setAttribute("aria-label", `${item.label}, ${item.amount}`);
      const swatch = row.querySelector<HTMLElement>(".process-item-icon");
      const label = row.querySelector<HTMLElement>(".process-item-label");
      const amount = row.querySelector<HTMLElement>("strong");
      if (swatch) swatch.style.setProperty("--item-color", item.color);
      if (label) this.setText(label, item.label);
      if (amount) this.setText(amount, `×${formatInteger(item.amount)}`);
    }

    const slots = this.requireElement(`[data-ref="process-${kind}-slots"]`);
    this.setText(
      slots,
      buffer.capacitySlots === undefined
        ? `${formatInteger(buffer.usedSlots)} ${buffer.usedSlots === 1 ? "slot" : "slots"}`
        : `${formatInteger(buffer.usedSlots)} / ${formatInteger(buffer.capacitySlots)} slots`,
    );
    const section =
      kind === "reclaim"
        ? this.processConsole.querySelector<HTMLElement>("[data-process-reclaim]")
        : this.processConsole.querySelector<HTMLElement>(
            `[data-process-stage="${kind}"]`,
          );
    section?.classList.toggle("is-occupied", buffer.items.length > 0);
    section?.setAttribute("data-used-slots", String(buffer.usedSlots));
  }

  private updateProcessChamber(chamber: HUDProcessChamber | null): void {
    const signature = chamber?.recipeId ?? "";
    if (signature !== this.processChamberSignature) {
      this.processChamberSignature = signature;
      this.processChamberFormula.replaceChildren();
      if (chamber) {
        this.setText(this.processChamberName, chamber.label);
        const inputs = this.createQuantityVisual(chamber.committedInputs);
        const arrow = document.createElement("i");
        arrow.textContent = "→";
        arrow.setAttribute("aria-hidden", "true");
        const outputs = this.createQuantityVisual(chamber.projectedOutputs);
        this.processChamberFormula.append(inputs, arrow, outputs);
      } else {
        this.setText(this.processChamberName, "Chamber clear");
        this.processChamberFormula.textContent = "Awaiting committed batch";
      }
    }

    const progress = Math.max(0, Math.min(1, chamber?.progress ?? 0));
    const percent = Math.round(progress * 100);
    this.processProgress.style.setProperty("--process", `${percent}%`);
    this.processProgress.setAttribute("aria-valuenow", String(percent));
    this.processProgress.setAttribute(
      "aria-valuetext",
      chamber
        ? `${chamber.label}, ${percent} percent complete`
        : "No committed batch",
    );
    this.setText(this.processProgressValue, `${percent}%`);
    this.processProgress.classList.toggle("is-active", Boolean(chamber));
  }

  private updateRecipeDeck(process: HUDMachineProcess): void {
    const signature = [
      process.kind,
      ...process.recipes.map((option) =>
        [
          option.recipeId ?? "auto",
          option.label,
          option.icon,
          ...option.formulas.map((formula) =>
            [
              formula.id,
              formula.durationSeconds,
              this.formatQuantities(formula.ingredients),
              this.formatQuantities(formula.products),
            ].join(":"),
          ),
        ].join("|"),
      ),
    ].join("\u001f");

    if (signature !== this.recipeDeckSignature) {
      const focused =
        document.activeElement instanceof HTMLButtonElement &&
        document.activeElement.matches("[data-recipe-choice]")
          ? document.activeElement.dataset.recipeId
          : undefined;
      this.recipeDeckSignature = signature;
      this.recipeGrid.replaceChildren(
        ...process.recipes.map((option) => this.createRecipeButton(option)),
      );
      if (focused) this.recipeRovingId = focused;
    }

    for (const option of process.recipes) {
      const recipeId = option.recipeId ?? "auto";
      const button = this.recipeGrid.querySelector<HTMLButtonElement>(
        `[data-recipe-id="${escapeSelector(recipeId)}"]`,
      );
      if (!button) continue;
      button.dataset.current = String(option.configured);
      button.dataset.active = String(option.active);
      button.dataset.pending = String(option.pending);
      button.setAttribute("aria-current", String(option.configured));
      button.setAttribute("aria-pressed", String(option.targeted));
      button.classList.toggle("is-current", option.configured);
      button.classList.toggle("is-active", option.active);
      button.classList.toggle("is-pending", option.pending);
      for (const badge of button.querySelectorAll<HTMLElement>(
        "[data-recipe-badge]",
      )) {
        const badgeKind = badge.dataset.recipeBadge;
        badge.hidden =
          (badgeKind === "current" && !option.configured) ||
          (badgeKind === "active" && !option.active) ||
          (badgeKind === "queued" && !option.pending);
      }
      const states = [
        option.configured ? "current" : "",
        option.active ? "active batch" : "",
        option.pending ? "queued target" : "",
      ].filter(Boolean);
      const formulas = option.formulas
        .map(
          (formula) =>
            `${formula.durationSeconds.toFixed(2)} seconds: ${this.formatQuantities(formula.ingredients)} produces ${this.formatQuantities(formula.products)}`,
        )
        .join("; ");
      button.setAttribute(
        "aria-label",
        `${option.label}. ${formulas}. ${states.length > 0 ? states.join(", ") : "available recipe"}.`,
      );
    }

    const preferred =
      process.recipes.find((option) => option.targeted) ??
      process.recipes.find((option) => option.configured) ??
      process.recipes[0];
    if (
      !this.recipeRovingId ||
      !this.recipeGrid.querySelector(
        `[data-recipe-id="${escapeSelector(this.recipeRovingId)}"]`,
      )
    ) {
      this.recipeRovingId = preferred?.recipeId ?? "auto";
    }
    this.updateRecipeTabStops();
  }

  private createRecipeButton(option: HUDRecipeOption): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "recipe-option";
    button.type = "button";
    button.dataset.recipeChoice = "";
    button.dataset.recipeId = option.recipeId ?? "auto";

    const header = document.createElement("span");
    header.className = "recipe-option-header";
    const icon = document.createElement("span");
    icon.className = "recipe-option-icon";
    const pictogramId =
      option.recipeId === null
        ? "autoSmelt"
        : RECIPE_OUTPUT_PICTOGRAM[option.recipeId];
    const pictogramLabel =
      option.recipeId === null
        ? "Automatic smelting selector pictogram"
        : `${option.label} output pictogram`;
    icon.append(this.createPictogram(pictogramId, pictogramLabel));
    const productColor = option.formulas[0]?.products[0]?.color;
    if (productColor) {
      icon.style.setProperty("--item-color", productColor);
    }
    const name = document.createElement("strong");
    name.textContent = option.label;
    const duration = document.createElement("small");
    duration.textContent =
      option.recipeId === null
        ? `${option.formulas.length} INPUT ROUTES`
        : `${option.formulas[0]?.durationSeconds.toFixed(2) ?? "0.00"}s BASE`;
    header.append(icon, name, duration);

    const formulas = document.createElement("span");
    formulas.className = "recipe-formula";
    for (const formula of option.formulas) {
      const row = document.createElement("span");
      row.className = "recipe-formula-row";
      row.dataset.recipeFormula = formula.id;
      row.textContent = `${this.formatQuantities(formula.ingredients)} → ${this.formatQuantities(formula.products)}`;
      formulas.append(row);
    }

    const badges = document.createElement("span");
    badges.className = "recipe-option-badges";
    for (const [kind, label] of [
      ["current", "CURRENT"],
      ["active", "ACTIVE"],
      ["queued", "QUEUED"],
    ] as const) {
      const badge = document.createElement("span");
      badge.className = `recipe-badge is-${kind}`;
      badge.dataset.recipeBadge = kind;
      badge.textContent = label;
      badge.hidden = true;
      badges.append(badge);
    }
    button.append(header, formulas, badges);
    return button;
  }

  private updateRecipeTabStops(): void {
    for (const button of this.recipeGrid.querySelectorAll<HTMLButtonElement>(
      "[data-recipe-choice]",
    )) {
      button.tabIndex = button.dataset.recipeId === this.recipeRovingId ? 0 : -1;
    }
  }

  private formatQuantities(items: readonly HUDItemQuantity[]): string {
    return items
      .map((item) => `${item.label} ×${formatInteger(item.amount)}`)
      .join(" + ");
  }

  private createQuantityVisual(
    items: readonly HUDItemQuantity[],
  ): HTMLElement {
    const group = document.createElement("span");
    group.className = "item-quantity";
    group.setAttribute("aria-label", this.formatQuantities(items));
    items.forEach((item, index) => {
      if (index > 0) {
        const separator = document.createElement("b");
        separator.textContent = "+";
        separator.setAttribute("aria-hidden", "true");
        group.append(separator);
      }
      const token = document.createElement("span");
      token.className = "item-quantity-token";
      token.style.setProperty("--item-color", item.color);
      token.title = item.label;
      token.append(
        this.createPictogram(item.id, `${item.label} pictogram`),
        document.createTextNode(
          `×${formatInteger(item.amount)}`,
        ),
      );
      group.append(token);
    });
    return group;
  }

  private createPictogram(
    id: ItemId | "autoSmelt",
    accessibleName: string,
  ): SVGSVGElement {
    const svg = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    svg.classList.add("ui-pictogram");
    svg.dataset.pictogram = id;
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", accessibleName);
    svg.setAttribute("focusable", "false");
    svg.innerHTML =
      id === "autoSmelt"
        ? AUTO_SMELT_PICTOGRAM
        : ITEM_PICTOGRAMS[id];
    return svg;
  }

  private compactDecimal(value: number): string {
    const formatted = value.toFixed(2);
    return value > 0 && value < 1
      ? formatted.replace(/^0/, "")
      : formatted;
  }

  private formatProcessSeconds(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return "—";
    return `${value < 10 ? value.toFixed(2) : value.toFixed(1)}s`;
  }

  private updateCoordinates(): void {
    const coordinates = this.model.coordinates ?? { x: 0, z: 0 };
    this.setText(this.coordinateX, this.formatCoordinate(coordinates.x));
    this.setText(this.coordinateZ, this.formatCoordinate(coordinates.z));
  }

  private updateStateButtons(): void {
    const paused = this.model.paused ?? false;
    const muted = this.model.muted ?? false;
    this.pausePlate.classList.toggle("is-open", paused);
    this.pausePlate.setAttribute("aria-hidden", String(!paused));
    this.pauseButton.classList.toggle("is-active", paused);
    this.pauseButton.setAttribute(
      "aria-label",
      paused ? "Resume simulation" : "Pause simulation",
    );
    this.muteButton.classList.toggle("is-active", muted);
    this.muteButton.setAttribute("aria-pressed", String(muted));
    this.muteButton.setAttribute("aria-label", muted ? "Unmute audio" : "Mute audio");
    this.powerRetrofitButton.hidden =
      this.model.powerMode !== "legacyGlobal";
  }

  private updateSession(): void {
    const session = this.model.session;
    if (!session) return;
    this.setText(this.sessionState, session.label);
    this.setText(this.sessionDetail, session.detail);
    const status = this.sessionState.closest<HTMLElement>(".session-status");
    if (status) status.dataset.sessionState = session.state;
    this.sessionButton.dataset.sessionState = session.state;
    this.sessionButton.classList.toggle(
      "has-warning",
      session.state === "volatile" || session.state === "recovered",
    );
    this.sessionSaveButton.disabled = !session.canSave;
    this.sessionSaveButton.textContent = session.canSave
      ? "SAVE NOW"
      : "SAVE UNAVAILABLE";
    this.sessionRestoreButton.hidden = !session.canRestoreBackup;
  }

  private setSessionPanelOpen(open: boolean): void {
    if (this.sessionPanel.hidden === !open) return;
    this.clearSessionResetConfirmation();
    this.sessionPanel.hidden = !open;
    this.sessionButton.setAttribute("aria-expanded", String(open));
    if (open) {
      this.sessionPanel
        .querySelector<HTMLButtonElement>("[data-action='session-close']")
        ?.focus();
    }
  }

  private armSessionReset(): void {
    this.clearSessionResetConfirmation();
    this.sessionResetButton.dataset.confirmReset = "true";
    this.sessionResetButton.classList.add("is-armed");
    this.sessionResetButton.textContent = "CONFIRM RESET";
    this.sessionResetButton.setAttribute(
      "aria-label",
      "Confirm campaign reset and preserve a local backup",
    );
    this.resetConfirmTimer = window.setTimeout(
      () => this.clearSessionResetConfirmation(),
      5000,
    );
  }

  private clearSessionResetConfirmation(): void {
    if (this.resetConfirmTimer !== undefined) {
      window.clearTimeout(this.resetConfirmTimer);
      this.resetConfirmTimer = undefined;
    }
    delete this.sessionResetButton.dataset.confirmReset;
    this.sessionResetButton.classList.remove("is-armed");
    this.sessionResetButton.textContent = "RESET CAMPAIGN";
    this.sessionResetButton.setAttribute(
      "aria-label",
      "Reset campaign after a second confirmation",
    );
  }

  private showTooltip(card: HTMLButtonElement, event?: Event): void {
    const text = card.dataset.tooltip;
    if (!text) return;
    this.setText(this.tooltip, text);
    this.tooltip.style.removeProperty("max-width");
    const rect = card.getBoundingClientRect();
    const pointer =
      typeof PointerEvent !== "undefined" && event instanceof PointerEvent
        ? event
        : undefined;
    const desiredX = pointer?.clientX ?? rect.left + rect.width / 2;
    const horizontalMargin = 10;
    const consoleInspector = window.matchMedia("(min-width: 691px)").matches
      ? this.root.querySelector<HTMLElement>(
          ".inspector.is-open:is(.has-process-console, .has-circuit-console)",
        )
      : null;
    const inspectorRect = consoleInspector?.getBoundingClientRect();
    const safeRight = inspectorRect && inspectorRect.width > 0
      ? Math.min(window.innerWidth - horizontalMargin, inspectorRect.left - 10)
      : window.innerWidth - horizontalMargin;
    const availableWidth = Math.max(1, safeRight - horizontalMargin);
    if (availableWidth < 220) {
      this.tooltip.style.maxWidth = `${availableWidth}px`;
    }
    const tooltipWidth = Math.max(
      1,
      Math.min(220, this.tooltip.getBoundingClientRect().width || 220),
    );
    const minimumCenter = tooltipWidth / 2 + horizontalMargin;
    const maximumCenter = Math.max(
      minimumCenter,
      safeRight - tooltipWidth / 2,
    );
    const x = Math.min(
      maximumCenter,
      Math.max(minimumCenter, desiredX),
    );
    const controls = this.root.querySelector<HTMLElement>(".context-help");
    const controlsRect = controls?.getBoundingClientRect();
    const controlsTop =
      controlsRect && controlsRect.width > 0 && controlsRect.height > 0
        ? controlsRect.top
        : rect.top;
    const y = Math.min(rect.top, controlsTop);
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${y}px`;
    this.tooltip.classList.add("is-visible");
  }

  private beginBuildDockTouch(dock: HTMLElement, event: Event): void {
    if (
      typeof window.matchMedia !== "function" ||
      !window.matchMedia("(max-width: 540px)").matches
    ) {
      return;
    }
    if (this.buildDockSnapFrame !== undefined) {
      window.cancelAnimationFrame(this.buildDockSnapFrame);
      this.buildDockSnapFrame = undefined;
    }
    const touch = (event as TouchEvent).touches?.[0];
    if (!touch) return;
    this.buildDockTouchStartX = touch.clientX;
    this.buildDockTouchStartScrollLeft = dock.scrollLeft;
  }

  private endBuildDockTouch(dock: HTMLElement, event: Event): void {
    const startX = this.buildDockTouchStartX;
    this.buildDockTouchStartX = undefined;
    const touch = (event as TouchEvent).changedTouches?.[0];
    if (startX === undefined || !touch) return;
    const pointerDelta = touch.clientX - startX;
    if (Math.abs(pointerDelta) < 12) return;
    const direction: -1 | 1 = pointerDelta < 0 ? 1 : -1;
    const startScrollLeft = this.buildDockTouchStartScrollLeft;
    this.settleBuildDockAfterTouch(dock, direction, startScrollLeft);
  }

  private cancelBuildDockTouch(): void {
    this.buildDockTouchStartX = undefined;
  }

  private settleBuildDockAfterTouch(
    dock: HTMLElement,
    direction: -1 | 1,
    startScrollLeft: number,
  ): void {
    const cards = Array.from(
      dock.querySelectorAll<HTMLElement>(".build-card:not([hidden])"),
    );
    if (cards.length === 0 || dock.clientWidth <= 0) return;
    const maximum = Math.max(0, dock.scrollWidth - dock.clientWidth);
    const paddingStart = Number.parseFloat(
      window.getComputedStyle(dock).scrollPaddingInlineStart,
    ) || 0;
    const targets = cards.map((card) =>
      Math.min(maximum, Math.max(0, card.offsetLeft - paddingStart)));
    const anchorIndex = targets.reduce((nearestIndex, candidate, index) =>
      Math.abs(candidate - startScrollLeft) <
        Math.abs(targets[nearestIndex]! - startScrollLeft)
        ? index
        : nearestIndex,
    0);
    const targetIndex = Math.max(
      0,
      Math.min(targets.length - 1, anchorIndex + direction),
    );
    const target = targets[targetIndex] ?? 0;
    const holdUntil = window.performance.now() + 240;
    const holdTarget = (): void => {
      dock.scrollLeft = target;
      if (window.performance.now() < holdUntil) {
        this.buildDockSnapFrame = window.requestAnimationFrame(holdTarget);
      } else {
        this.buildDockSnapFrame = undefined;
      }
    };
    holdTarget();
  }

  private hideTooltip(): void {
    this.tooltip.classList.remove("is-visible");
  }

  private toastDedupeKey(toast: HUDToast): string {
    return hudToastDedupeKey(toast);
  }

  private makeToastRoom(): void {
    const visible = Array.from(
      this.toastStack.querySelectorAll<HTMLElement>(".toast:not(.is-leaving)"),
    );
    const maximumVisible = 1;
    while (visible.length >= maximumVisible) {
      const oldest = visible.shift();
      const id = oldest?.dataset.toastId;
      if (!oldest || !id) continue;
      const timer = this.toastTimers.get(id);
      if (timer !== undefined) window.clearTimeout(timer);
      this.toastTimers.delete(id);
      this.toastRepeatCounts.delete(id);
      const key = this.toastKeysById.get(id);
      if (key) {
        if (this.toastIdsByKey.get(key) === id) this.toastIdsByKey.delete(key);
        this.toastKeysById.delete(id);
      }
      oldest.remove();
    }
  }

  private formatCoordinate(value: number): string {
    const safe = Number.isFinite(value) ? value : 0;
    return `${safe >= 0 ? "+" : "−"}${Math.abs(safe).toFixed(1).padStart(5, "0")}`;
  }

  private setText(element: HTMLElement, value: string): void {
    if (element.textContent !== value) element.textContent = value;
  }

  private requireElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`HUD template is missing "${selector}".`);
    return element;
  }

  private listen(
    target: EventTarget,
    event: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    target.addEventListener(event, listener);
    this.disposers.push(() => target.removeEventListener(event, listener));
  }
}

export default HUD;
