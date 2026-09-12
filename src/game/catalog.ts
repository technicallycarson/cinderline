import type {
  CircuitEntityKind,
  EntityKind,
  EntityPrototype,
  FluidEntityKind,
  FluidId,
  FluidPrototype,
  FluidRecipeId,
  FluidRecipePrototype,
  ItemId,
  ItemPrototype,
  ObjectiveDefinition,
  RecipeId,
  RecipePrototype,
  ResourceId,
} from "./types";

export const CATALOG_VERSION = "cinderline-8";
export const COAL_ENERGY_KJ = 4_000;
export const BELT_LANE_CAPACITY = 4;
export const BELT_ITEM_SPACING = 0.25;

export const ITEM_IDS: readonly ItemId[] = [
  "ironOre",
  "copperOre",
  "coal",
  "stone",
  "ironPlate",
  "copperPlate",
  "stoneBrick",
  "ironGear",
  "copperWire",
  "circuit",
  "automationCore",
];

export const RESOURCE_IDS: readonly ResourceId[] = [
  "iron",
  "copper",
  "coal",
  "stone",
];

/**
 * Blueprint-format entity catalog. Advanced fluid and circuit construction is
 * intentionally exposed through PLAYER_BUILD_KINDS without changing the
 * existing blueprint formats in this pass.
 */
export const ENTITY_KINDS: readonly Exclude<
  EntityKind,
  FluidEntityKind
>[] = [
  "extractor",
  "belt",
  "manifold",
  "inserter",
  "smelter",
  "fabricator",
  "generator",
  "storage",
  "beacon",
  "gridRelay",
];

export const FLUID_ENTITY_KINDS: readonly FluidEntityKind[] = [
  "fluidSource",
  "fluidPump",
  "fluidPipe",
  "fluidTank",
  "fluidProcessor",
];

/** Authoritative circuit construction entities. */
export const CIRCUIT_ENTITY_KINDS: readonly CircuitEntityKind[] = [
  "constantCombinator",
  "arithmeticCombinator",
  "deciderCombinator",
];

/**
 * Complete player construction catalog. Its order preserves the ordinary
 * 1–9/0 palette first, followed by the Shift+1…8 advanced palette.
 */
export const PLAYER_BUILD_KINDS: readonly EntityKind[] = [
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
  ...FLUID_ENTITY_KINDS,
  ...CIRCUIT_ENTITY_KINDS,
];

export const SIMULATION_ENTITY_KINDS: readonly EntityKind[] =
  PLAYER_BUILD_KINDS;

export const FLUID_IDS: readonly FluidId[] = [
  "crudeOil",
  "refinedFuel",
];

export const FLUID_RECIPE_IDS: readonly FluidRecipeId[] = [
  "refineCrude",
];

export const FLUIDS: Record<FluidId, FluidPrototype> = {
  crudeOil: {
    id: "crudeOil",
    name: "Crude oil",
    color: "#33281f",
  },
  refinedFuel: {
    id: "refinedFuel",
    name: "Refined fuel",
    color: "#d99b45",
  },
};

export const FLUID_RECIPES: Record<
  FluidRecipeId,
  FluidRecipePrototype
> = {
  refineCrude: {
    id: "refineCrude",
    name: "Refine crude",
    input: "crudeOil",
    output: "refinedFuel",
    batchMilli: 5_000,
    durationTicks: 60,
  },
};

export const ITEMS: Record<ItemId, ItemPrototype> = {
  ironOre: {
    id: "ironOre",
    name: "Iron ore",
    stackSize: 100,
    color: "#7892a2",
    resource: "iron",
  },
  copperOre: {
    id: "copperOre",
    name: "Copper ore",
    stackSize: 100,
    color: "#c87842",
    resource: "copper",
  },
  coal: {
    id: "coal",
    name: "Coal",
    stackSize: 100,
    color: "#262b31",
    resource: "coal",
  },
  stone: {
    id: "stone",
    name: "Stone",
    stackSize: 100,
    color: "#a79a7a",
    resource: "stone",
  },
  ironPlate: {
    id: "ironPlate",
    name: "Iron plate",
    stackSize: 100,
    color: "#b6c5cb",
  },
  copperPlate: {
    id: "copperPlate",
    name: "Copper plate",
    stackSize: 100,
    color: "#e38a50",
  },
  stoneBrick: {
    id: "stoneBrick",
    name: "Fire brick",
    stackSize: 100,
    color: "#8e6754",
  },
  ironGear: {
    id: "ironGear",
    name: "Iron gear",
    stackSize: 100,
    color: "#8ea1aa",
  },
  copperWire: {
    id: "copperWire",
    name: "Copper wire",
    stackSize: 200,
    color: "#f29a57",
  },
  circuit: {
    id: "circuit",
    name: "Logic circuit",
    stackSize: 200,
    color: "#64bf70",
  },
  automationCore: {
    id: "automationCore",
    name: "Automation core",
    stackSize: 50,
    color: "#62d8e8",
  },
};

export const RESOURCE_TO_ITEM: Record<ResourceId, ItemId> = {
  iron: "ironOre",
  copper: "copperOre",
  coal: "coal",
  stone: "stone",
};

export const RECIPES: Record<RecipeId, RecipePrototype> = {
  smeltIron: {
    id: "smeltIron",
    name: "Smelt iron",
    machine: "smelter",
    durationSeconds: 3.2,
    ingredients: [{ item: "ironOre", amount: 1 }],
    products: [{ item: "ironPlate", amount: 1 }],
  },
  smeltCopper: {
    id: "smeltCopper",
    name: "Smelt copper",
    machine: "smelter",
    durationSeconds: 3.2,
    ingredients: [{ item: "copperOre", amount: 1 }],
    products: [{ item: "copperPlate", amount: 1 }],
  },
  fireBrick: {
    id: "fireBrick",
    name: "Fire brick",
    machine: "smelter",
    durationSeconds: 3.2,
    ingredients: [{ item: "stone", amount: 2 }],
    products: [{ item: "stoneBrick", amount: 1 }],
  },
  ironGear: {
    id: "ironGear",
    name: "Iron gear",
    machine: "fabricator",
    durationSeconds: 0.5,
    ingredients: [{ item: "ironPlate", amount: 2 }],
    products: [{ item: "ironGear", amount: 1 }],
  },
  copperWire: {
    id: "copperWire",
    name: "Copper wire",
    machine: "fabricator",
    durationSeconds: 0.5,
    ingredients: [{ item: "copperPlate", amount: 1 }],
    products: [{ item: "copperWire", amount: 2 }],
  },
  circuit: {
    id: "circuit",
    name: "Logic circuit",
    machine: "fabricator",
    durationSeconds: 0.5,
    ingredients: [
      { item: "ironPlate", amount: 1 },
      { item: "copperWire", amount: 3 },
    ],
    products: [{ item: "circuit", amount: 1 }],
  },
  automationCore: {
    id: "automationCore",
    name: "Automation core",
    machine: "fabricator",
    durationSeconds: 4,
    ingredients: [
      { item: "ironGear", amount: 2 },
      { item: "circuit", amount: 2 },
      { item: "copperPlate", amount: 1 },
    ],
    products: [{ item: "automationCore", amount: 1 }],
  },
};

export const RECIPE_IDS: readonly RecipeId[] = Object.freeze(
  Object.keys(RECIPES) as RecipeId[],
);

export const ENTITY_PROTOTYPES: Record<EntityKind, EntityPrototype> = {
  extractor: {
    id: "extractor",
    name: "Arc extractor",
    footprint: { width: 2, height: 2 },
    color: "#466675",
    accentColor: "#f3a83b",
    inventorySlots: 0,
    inputSlots: 0,
    outputSlots: 2,
    powerDemandKW: 90,
    idlePowerKW: 3,
    generationCapacityKW: 0,
    workSpeed: 0.5,
    beltSpeed: 0,
    extractionRadius: 1,
    beaconRadius: 0,
    beaconSpeedBonus: 0,
  },
  belt: {
    id: "belt",
    name: "Transport belt",
    footprint: { width: 1, height: 1 },
    color: "#4c5559",
    accentColor: "#e5a82d",
    inventorySlots: 0,
    inputSlots: 0,
    outputSlots: 0,
    powerDemandKW: 0,
    idlePowerKW: 0,
    generationCapacityKW: 0,
    workSpeed: 0,
    beltSpeed: 1.875,
    extractionRadius: 0,
    beaconRadius: 0,
    beaconSpeedBonus: 0,
  },
  manifold: {
    id: "manifold",
    name: "Dispatch manifold",
    // The prototype is north-facing; east/west placement presents as 2×1.
    footprint: { width: 1, height: 2 },
    color: "#3f4b50",
    accentColor: "#f0a934",
    inventorySlots: 0,
    inputSlots: 0,
    outputSlots: 0,
    powerDemandKW: 0,
    idlePowerKW: 0,
    generationCapacityKW: 0,
    workSpeed: 0,
    beltSpeed: 1.875,
    extractionRadius: 0,
    beaconRadius: 0,
    beaconSpeedBonus: 0,
  },
  inserter: {
    id: "inserter",
    name: "Servo inserter",
    footprint: { width: 1, height: 1 },
    color: "#b68527",
    accentColor: "#ffd15a",
    inventorySlots: 0,
    inputSlots: 0,
    outputSlots: 0,
    powerDemandKW: 15,
    idlePowerKW: 0.4,
    generationCapacityKW: 0,
    workSpeed: 1.72,
    beltSpeed: 0,
    extractionRadius: 0,
    beaconRadius: 0,
    beaconSpeedBonus: 0,
  },
  smelter: {
    id: "smelter",
    name: "Induction smelter",
    footprint: { width: 2, height: 2 },
    color: "#424a4e",
    accentColor: "#ff6b24",
    inventorySlots: 0,
    inputSlots: 3,
    outputSlots: 2,
    powerDemandKW: 90,
    idlePowerKW: 3,
    generationCapacityKW: 0,
    workSpeed: 1,
    beltSpeed: 0,
    extractionRadius: 0,
    beaconRadius: 0,
    beaconSpeedBonus: 0,
  },
  fabricator: {
    id: "fabricator",
    name: "Precision fabricator",
    footprint: { width: 3, height: 2 },
    color: "#345c63",
    accentColor: "#40d3c4",
    inventorySlots: 0,
    inputSlots: 8,
    outputSlots: 4,
    powerDemandKW: 150,
    idlePowerKW: 5,
    generationCapacityKW: 0,
    workSpeed: 0.75,
    beltSpeed: 0,
    extractionRadius: 0,
    beaconRadius: 0,
    beaconSpeedBonus: 0,
  },
  generator: {
    id: "generator",
    name: "Combustion generator",
    footprint: { width: 2, height: 2 },
    color: "#4b5357",
    accentColor: "#f2d156",
    inventorySlots: 0,
    inputSlots: 0,
    outputSlots: 0,
    powerDemandKW: 0,
    idlePowerKW: 0,
    generationCapacityKW: 900,
    workSpeed: 0,
    beltSpeed: 0,
    extractionRadius: 0,
    beaconRadius: 0,
    beaconSpeedBonus: 0,
  },
  storage: {
    id: "storage",
    name: "Steel depot",
    footprint: { width: 2, height: 2 },
    color: "#6e777a",
    accentColor: "#c6d0cf",
    inventorySlots: 24,
    inputSlots: 0,
    outputSlots: 0,
    powerDemandKW: 0,
    idlePowerKW: 0,
    generationCapacityKW: 0,
    workSpeed: 0,
    beltSpeed: 0,
    extractionRadius: 0,
    beaconRadius: 0,
    beaconSpeedBonus: 0,
  },
  beacon: {
    id: "beacon",
    name: "Overclock beacon",
    footprint: { width: 2, height: 2 },
    color: "#3d5668",
    accentColor: "#7ce8ff",
    inventorySlots: 0,
    inputSlots: 0,
    outputSlots: 0,
    powerDemandKW: 200,
    idlePowerKW: 10,
    generationCapacityKW: 0,
    workSpeed: 0,
    beltSpeed: 0,
    extractionRadius: 0,
    beaconRadius: 4.5,
    beaconSpeedBonus: 0.25,
  },
  gridRelay: {
    id: "gridRelay",
    name: "Local grid relay",
    footprint: { width: 1, height: 1 },
    color: "#39474d",
    accentColor: "#75e6ff",
    inventorySlots: 0,
    inputSlots: 0,
    outputSlots: 0,
    powerDemandKW: 0,
    idlePowerKW: 0,
    generationCapacityKW: 0,
    workSpeed: 0,
    beltSpeed: 0,
    extractionRadius: 0,
    beaconRadius: 0,
    beaconSpeedBonus: 0,
  },
  fluidSource: {
    id: "fluidSource",
    name: "Pressure wellhead",
    footprint: { width: 2, height: 2 },
    color: "#3f4a4a",
    accentColor: "#d08d43",
    inventorySlots: 0,
    inputSlots: 0,
    outputSlots: 0,
    powerDemandKW: 0,
    idlePowerKW: 0,
    generationCapacityKW: 0,
    workSpeed: 1,
    beltSpeed: 0,
    extractionRadius: 0,
    beaconRadius: 0,
    beaconSpeedBonus: 0,
    fluidCapacityMilli: 20_000,
    fluidThroughputMilliPerTick: 1_500,
    fluidSourceRateMilliPerTick: 250,
  },
  fluidPump: {
    id: "fluidPump",
    name: "Powered inline pump",
    footprint: { width: 1, height: 1 },
    color: "#41545a",
    accentColor: "#66d9d0",
    inventorySlots: 0,
    inputSlots: 0,
    outputSlots: 0,
    powerDemandKW: 45,
    idlePowerKW: 3,
    generationCapacityKW: 0,
    workSpeed: 1,
    beltSpeed: 0,
    extractionRadius: 0,
    beaconRadius: 0,
    beaconSpeedBonus: 0,
    fluidCapacityMilli: 8_000,
    fluidThroughputMilliPerTick: 1_500,
  },
  fluidPipe: {
    id: "fluidPipe",
    name: "Directional process pipe",
    footprint: { width: 1, height: 1 },
    color: "#566367",
    accentColor: "#d08d43",
    inventorySlots: 0,
    inputSlots: 0,
    outputSlots: 0,
    powerDemandKW: 0,
    idlePowerKW: 0,
    generationCapacityKW: 0,
    workSpeed: 0,
    beltSpeed: 0,
    extractionRadius: 0,
    beaconRadius: 0,
    beaconSpeedBonus: 0,
    fluidCapacityMilli: 8_000,
    fluidThroughputMilliPerTick: 1_000,
  },
  fluidTank: {
    id: "fluidTank",
    name: "Riveted fluid reservoir",
    footprint: { width: 3, height: 3 },
    color: "#4d5658",
    accentColor: "#c9b06b",
    inventorySlots: 0,
    inputSlots: 0,
    outputSlots: 0,
    powerDemandKW: 0,
    idlePowerKW: 0,
    generationCapacityKW: 0,
    workSpeed: 0,
    beltSpeed: 0,
    extractionRadius: 0,
    beaconRadius: 0,
    beaconSpeedBonus: 0,
    fluidCapacityMilli: 250_000,
    fluidThroughputMilliPerTick: 3_000,
  },
  fluidProcessor: {
    id: "fluidProcessor",
    name: "Fractionation skid",
    footprint: { width: 3, height: 3 },
    color: "#4c5051",
    accentColor: "#f0a34c",
    inventorySlots: 0,
    inputSlots: 0,
    outputSlots: 0,
    powerDemandKW: 180,
    idlePowerKW: 6,
    generationCapacityKW: 0,
    workSpeed: 1,
    beltSpeed: 0,
    extractionRadius: 0,
    beaconRadius: 0,
    beaconSpeedBonus: 0,
    fluidInputCapacityMilli: 50_000,
    fluidOutputCapacityMilli: 50_000,
    fluidThroughputMilliPerTick: 1_500,
  },
  constantCombinator: {
    id: "constantCombinator",
    name: "Constant signal terminal",
    footprint: { width: 1, height: 1 },
    color: "#4d563f",
    accentColor: "#d9dc73",
    inventorySlots: 0,
    inputSlots: 0,
    outputSlots: 0,
    powerDemandKW: 0,
    idlePowerKW: 0,
    generationCapacityKW: 0,
    workSpeed: 0,
    beltSpeed: 0,
    extractionRadius: 0,
    beaconRadius: 0,
    beaconSpeedBonus: 0,
  },
  arithmeticCombinator: {
    id: "arithmeticCombinator",
    name: "Arithmetic signal engine",
    footprint: { width: 1, height: 1 },
    color: "#4e463a",
    accentColor: "#f0a45a",
    inventorySlots: 0,
    inputSlots: 0,
    outputSlots: 0,
    powerDemandKW: 0,
    idlePowerKW: 0,
    generationCapacityKW: 0,
    workSpeed: 0,
    beltSpeed: 0,
    extractionRadius: 0,
    beaconRadius: 0,
    beaconSpeedBonus: 0,
  },
  deciderCombinator: {
    id: "deciderCombinator",
    name: "Decider signal engine",
    footprint: { width: 1, height: 1 },
    color: "#3c4e50",
    accentColor: "#69d8d3",
    inventorySlots: 0,
    inputSlots: 0,
    outputSlots: 0,
    powerDemandKW: 0,
    idlePowerKW: 0,
    generationCapacityKW: 0,
    workSpeed: 0,
    beltSpeed: 0,
    extractionRadius: 0,
    beaconRadius: 0,
    beaconSpeedBonus: 0,
  },
};

export const OBJECTIVES: readonly ObjectiveDefinition[] = [
  {
    id: "wake-the-line",
    title: "Wake the line",
    description: "Extract five pieces of iron ore.",
    item: "ironOre",
    amount: 5,
  },
  {
    id: "first-heat",
    title: "First heat",
    description: "Smelt five iron plates.",
    item: "ironPlate",
    amount: 5,
  },
  {
    id: "moving-parts",
    title: "Moving parts",
    description: "Fabricate four iron gears.",
    item: "ironGear",
    amount: 4,
  },
  {
    id: "autonomous",
    title: "Autonomous",
    description: "Complete one automation core.",
    item: "automationCore",
    amount: 1,
  },
];

export function isRecipeFor(
  recipeId: unknown,
  machine: "smelter" | "fabricator",
): recipeId is RecipeId {
  return (
    typeof recipeId === "string" &&
    RECIPE_IDS.includes(recipeId as RecipeId) &&
    RECIPES[recipeId as RecipeId].machine === machine
  );
}

export function recipesFor(
  machine: "smelter" | "fabricator",
): RecipePrototype[] {
  return RECIPE_IDS.map((id) => RECIPES[id]).filter(
    (recipe) => recipe.machine === machine,
  );
}

export function isCircuitEntityKind(
  kind: EntityKind,
): kind is CircuitEntityKind {
  return CIRCUIT_ENTITY_KINDS.includes(kind as CircuitEntityKind);
}
