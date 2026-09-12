/**
 * Deterministic fixed-point fluid topology and transport.
 *
 * The core is deliberately independent of FactorySimulation's maps and event
 * queue. Spatial ordering, connected-component IDs, split arbitration, merge
 * arbitration, and mass accounting depend only on canonical tile geometry.
 * Entity allocation/insertion order is never used as a tie-breaker.
 */
import {
  ENTITY_PROTOTYPES,
  FLUID_IDS,
  FLUID_RECIPES,
  FLUID_RECIPE_IDS,
} from "./catalog";
import {
  Direction,
  type EntityState,
  type FluidBufferState,
  type FluidComponentStats,
  type FluidEntityKind,
  type FluidEntityState,
  type FluidId,
  type FluidNetworkEdgeSnapshot,
  type FluidNetworkNodeSnapshot,
  type FluidNetworkSnapshot,
  type FluidNodeRole,
  type FluidRecipeId,
  type FluidStats,
  type GridPoint,
} from "./types";

export const FLUID_FIXED_SCALE = 1_000;

const FLUID_KINDS: readonly FluidEntityKind[] = [
  "fluidSource",
  "fluidPump",
  "fluidPipe",
  "fluidTank",
  "fluidProcessor",
];
const CARDINAL_DIRECTIONS: readonly Direction[] = [
  Direction.North,
  Direction.East,
  Direction.South,
  Direction.West,
];
const ROLE_ORDER: Readonly<Record<FluidNodeRole, number>> = {
  buffer: 0,
  input: 1,
  output: 2,
};

interface RuntimeNode {
  readonly entity: EntityState;
  readonly role: FluidNodeRole;
  readonly box: FluidBufferState;
  readonly maximumIn: number;
  readonly maximumOut: number;
  stableIndex: number;
  componentId: number;
}

interface RuntimeEdge {
  readonly source: RuntimeNode;
  readonly target: RuntimeNode;
  readonly throughput: number;
}

interface RuntimeTopology {
  readonly nodes: RuntimeNode[];
  readonly edges: RuntimeEdge[];
  readonly components: FluidComponentStats[];
}

interface Proposal {
  readonly edge: RuntimeEdge;
  readonly fluidId: FluidId;
  readonly amount: number;
}

export interface FluidStepResult {
  readonly producedMilli: Record<FluidId, number>;
  readonly processedMilli: Record<FluidId, number>;
  readonly transferredMilli: number;
  readonly backpressuredEntityIds: number[];
  readonly network: FluidNetworkSnapshot;
}

function emptyFluidRecord(): Record<FluidId, number> {
  return {
    crudeOil: 0,
    refinedFuel: 0,
  };
}

export function isFluidEntityKind(
  kind: EntityState["kind"],
): kind is FluidEntityKind {
  return FLUID_KINDS.includes(kind as FluidEntityKind);
}

export function isFluidId(value: unknown): value is FluidId {
  return typeof value === "string" && FLUID_IDS.includes(value as FluidId);
}

export function isFluidRecipeId(value: unknown): value is FluidRecipeId {
  return (
    typeof value === "string" &&
    FLUID_RECIPE_IDS.includes(value as FluidRecipeId)
  );
}

function emptyBuffer(capacityMilli: number): FluidBufferState {
  return { amountMilli: 0, capacityMilli };
}

export function createFluidEntityState(
  kind: FluidEntityKind,
  fluidId: FluidId = "crudeOil",
  recipeId: FluidRecipeId = "refineCrude",
): FluidEntityState {
  const prototype = ENTITY_PROTOTYPES[kind];
  if (kind === "fluidProcessor") {
    return {
      input: emptyBuffer(prototype.fluidInputCapacityMilli!),
      output: emptyBuffer(prototype.fluidOutputCapacityMilli!),
      recipeId,
      processTicks: 0,
    };
  }
  return {
    buffer: emptyBuffer(prototype.fluidCapacityMilli!),
    ...(kind === "fluidSource" ? { sourceFluidId: fluidId } : {}),
    processTicks: 0,
  };
}

function cloneBuffer(buffer: FluidBufferState): FluidBufferState {
  return {
    ...(buffer.fluidId === undefined ? {} : { fluidId: buffer.fluidId }),
    amountMilli: buffer.amountMilli,
    capacityMilli: buffer.capacityMilli,
  };
}

export function cloneFluidEntityState(
  state: FluidEntityState,
): FluidEntityState {
  return {
    ...(state.buffer ? { buffer: cloneBuffer(state.buffer) } : {}),
    ...(state.input ? { input: cloneBuffer(state.input) } : {}),
    ...(state.output ? { output: cloneBuffer(state.output) } : {}),
    ...(state.sourceFluidId
      ? { sourceFluidId: state.sourceFluidId }
      : {}),
    ...(state.recipeId ? { recipeId: state.recipeId } : {}),
    processTicks: state.processTicks,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) return false;
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key)
    ) &&
    keys.every((key) => allowed.has(key as string))
  );
}

function isCanonicalBuffer(
  value: unknown,
  expectedCapacity: number,
): value is FluidBufferState {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ["amountMilli", "capacityMilli"], ["fluidId"]) ||
    !Number.isSafeInteger(value.amountMilli) ||
    !Number.isSafeInteger(value.capacityMilli) ||
    value.capacityMilli !== expectedCapacity ||
    (value.amountMilli as number) < 0 ||
    (value.amountMilli as number) > expectedCapacity
  ) {
    return false;
  }
  const amount = value.amountMilli as number;
  if (amount === 0) return value.fluidId === undefined;
  return isFluidId(value.fluidId);
}

/**
 * Hostile-save validator for entity-owned fluid state. Capacities are derived
 * catalog invariants, empty boxes may not retain a stale identity, and no
 * unknown/accessory keys are accepted.
 */
export function isCanonicalFluidEntityState(
  kind: EntityState["kind"],
  value: unknown,
): value is FluidEntityState {
  if (!isFluidEntityKind(kind) || !isPlainRecord(value)) return false;
  const prototype = ENTITY_PROTOTYPES[kind];
  if (kind === "fluidProcessor") {
    if (
      !hasExactKeys(value, [
        "input",
        "output",
        "recipeId",
        "processTicks",
      ]) ||
      !isCanonicalBuffer(
        value.input,
        prototype.fluidInputCapacityMilli!,
      ) ||
      !isCanonicalBuffer(
        value.output,
        prototype.fluidOutputCapacityMilli!,
      ) ||
      !isFluidRecipeId(value.recipeId) ||
      !Number.isSafeInteger(value.processTicks)
    ) {
      return false;
    }
    const recipe = FLUID_RECIPES[value.recipeId];
    return (
      (value.processTicks as number) >= 0 &&
      (value.processTicks as number) < recipe.durationTicks &&
      ((value.input as FluidBufferState).fluidId === undefined ||
        (value.input as FluidBufferState).fluidId === recipe.input) &&
      ((value.output as FluidBufferState).fluidId === undefined ||
        (value.output as FluidBufferState).fluidId === recipe.output)
    );
  }

  const required =
    kind === "fluidSource"
      ? ["buffer", "sourceFluidId", "processTicks"]
      : ["buffer", "processTicks"];
  if (
    !hasExactKeys(value, required) ||
    !isCanonicalBuffer(value.buffer, prototype.fluidCapacityMilli!) ||
    value.processTicks !== 0
  ) {
    return false;
  }
  return kind !== "fluidSource" || isFluidId(value.sourceFluidId);
}

function directionVector(direction: Direction): GridPoint {
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

function opposite(direction: Direction): Direction {
  return ((direction + 2) % 4) as Direction;
}

function left(direction: Direction): Direction {
  return ((direction + 3) % 4) as Direction;
}

function right(direction: Direction): Direction {
  return ((direction + 1) % 4) as Direction;
}

function portPoint(entity: EntityState, direction: Direction): GridPoint {
  switch (direction) {
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

function outputDirections(entity: EntityState): readonly Direction[] {
  switch (entity.kind) {
    case "fluidSource":
    case "fluidPump":
    case "fluidProcessor":
      return [entity.direction];
    case "fluidPipe":
      return [
        entity.direction,
        left(entity.direction),
        right(entity.direction),
      ];
    case "fluidTank":
      return CARDINAL_DIRECTIONS;
    default:
      return [];
  }
}

function inputDirections(entity: EntityState): readonly Direction[] {
  switch (entity.kind) {
    case "fluidPump":
    case "fluidProcessor":
      return [opposite(entity.direction)];
    case "fluidPipe":
      return [
        opposite(entity.direction),
        left(entity.direction),
        right(entity.direction),
      ];
    case "fluidTank":
      return CARDINAL_DIRECTIONS;
    default:
      return [];
  }
}

function compareEntitiesSpatially(
  first: EntityState,
  second: EntityState,
): number {
  return (
    first.y - second.y ||
    first.x - second.x ||
    first.kind.localeCompare(second.kind) ||
    first.direction - second.direction ||
    first.height - second.height ||
    first.width - second.width
  );
}

function compareNodes(first: RuntimeNode, second: RuntimeNode): number {
  return (
    compareEntitiesSpatially(first.entity, second.entity) ||
    ROLE_ORDER[first.role] - ROLE_ORDER[second.role]
  );
}

function compareEdges(first: RuntimeEdge, second: RuntimeEdge): number {
  return (
    compareNodes(first.source, second.source) ||
    compareNodes(first.target, second.target)
  );
}

function fluidBoxes(entity: EntityState): Array<{
  role: FluidNodeRole;
  box: FluidBufferState;
}> {
  const state = entity.fluidState;
  if (!state) return [];
  if (entity.kind === "fluidProcessor") {
    return [
      { role: "input", box: state.input! },
      { role: "output", box: state.output! },
    ];
  }
  return [{ role: "buffer", box: state.buffer! }];
}

function nodeForRole(
  nodesByEntity: ReadonlyMap<number, ReadonlyMap<FluidNodeRole, RuntimeNode>>,
  entityId: number,
  role: FluidNodeRole,
): RuntimeNode | undefined {
  return nodesByEntity.get(entityId)?.get(role);
}

function buildRuntimeTopology(
  sourceEntities: readonly EntityState[],
): RuntimeTopology {
  const entities = sourceEntities
    .filter(
      (entity) =>
        isFluidEntityKind(entity.kind) &&
        entity.fluidState !== undefined,
    )
    .slice()
    .sort(compareEntitiesSpatially);
  const occupancy = new Map<string, EntityState>();
  for (const entity of entities) {
    for (let y = entity.y; y < entity.y + entity.height; y += 1) {
      for (let x = entity.x; x < entity.x + entity.width; x += 1) {
        occupancy.set(`${x},${y}`, entity);
      }
    }
  }

  const nodes: RuntimeNode[] = [];
  const nodesByEntity = new Map<
    number,
    Map<FluidNodeRole, RuntimeNode>
  >();
  for (const entity of entities) {
    const throughput =
      ENTITY_PROTOTYPES[entity.kind].fluidThroughputMilliPerTick ?? 0;
    const roleMap = new Map<FluidNodeRole, RuntimeNode>();
    for (const { role, box } of fluidBoxes(entity)) {
      const node: RuntimeNode = {
        entity,
        role,
        box,
        maximumIn: throughput,
        maximumOut: throughput,
        stableIndex: nodes.length,
        componentId: 0,
      };
      nodes.push(node);
      roleMap.set(role, node);
    }
    nodesByEntity.set(entity.id, roleMap);
  }
  nodes.sort(compareNodes);
  for (let index = 0; index < nodes.length; index += 1) {
    nodes[index]!.stableIndex = index;
  }

  const edges: RuntimeEdge[] = [];
  const edgeKeys = new Set<string>();
  for (const sourceEntity of entities) {
    const sourceRole: FluidNodeRole =
      sourceEntity.kind === "fluidProcessor" ? "output" : "buffer";
    const source = nodeForRole(
      nodesByEntity,
      sourceEntity.id,
      sourceRole,
    );
    if (!source) continue;
    for (const outputDirection of outputDirections(sourceEntity)) {
      const point = portPoint(sourceEntity, outputDirection);
      const targetEntity = occupancy.get(`${point.x},${point.y}`);
      if (
        !targetEntity ||
        targetEntity.id === sourceEntity.id ||
        !inputDirections(targetEntity).includes(opposite(outputDirection))
      ) {
        continue;
      }
      const targetRole: FluidNodeRole =
        targetEntity.kind === "fluidProcessor" ? "input" : "buffer";
      const target = nodeForRole(
        nodesByEntity,
        targetEntity.id,
        targetRole,
      );
      if (!target) continue;
      const edgeKey =
        `${sourceEntity.id}:${sourceRole}>${targetEntity.id}:${targetRole}`;
      if (edgeKeys.has(edgeKey)) continue;
      edgeKeys.add(edgeKey);
      edges.push({
        source,
        target,
        throughput: Math.min(source.maximumOut, target.maximumIn),
      });
    }
  }
  edges.sort(compareEdges);

  const parent = nodes.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[index] !== index) {
      const next = parent[index]!;
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (first: number, second: number): void => {
    const firstRoot = find(first);
    const secondRoot = find(second);
    if (firstRoot === secondRoot) return;
    const canonical = Math.min(firstRoot, secondRoot);
    parent[firstRoot] = canonical;
    parent[secondRoot] = canonical;
  };
  for (const edge of edges) {
    union(edge.source.stableIndex, edge.target.stableIndex);
  }

  const componentNodes = new Map<number, RuntimeNode[]>();
  for (const node of nodes) {
    const root = find(node.stableIndex);
    const members = componentNodes.get(root) ?? [];
    members.push(node);
    componentNodes.set(root, members);
  }
  const orderedComponents = [...componentNodes.values()].sort(
    (first, second) => compareNodes(first[0]!, second[0]!),
  );
  const components: FluidComponentStats[] = [];
  for (let index = 0; index < orderedComponents.length; index += 1) {
    const componentId = index + 1;
    const members = orderedComponents[index]!;
    let storedMilli = 0;
    let capacityMilli = 0;
    const present = new Set<FluidId>();
    for (const node of members) {
      node.componentId = componentId;
      storedMilli += node.box.amountMilli;
      capacityMilli += node.box.capacityMilli;
      if (node.box.fluidId) present.add(node.box.fluidId);
    }
    components.push({
      componentId,
      nodeCount: members.length,
      storedMilli,
      capacityMilli,
      fluidIds: FLUID_IDS.filter((fluidId) => present.has(fluidId)),
    });
  }
  return { nodes, edges, components };
}

function canReceiveFluid(
  node: RuntimeNode,
  fluidId: FluidId,
): boolean {
  if (
    node.box.fluidId !== undefined &&
    node.box.fluidId !== fluidId
  ) {
    return false;
  }
  if (node.entity.kind !== "fluidProcessor" || node.role !== "input") {
    return true;
  }
  const recipeId = node.entity.fluidState?.recipeId;
  return recipeId !== undefined && FLUID_RECIPES[recipeId].input === fluidId;
}

function shouldForceFlow(node: RuntimeNode): boolean {
  return (
    node.entity.kind === "fluidSource" ||
    node.entity.kind === "fluidPump" ||
    (node.entity.kind === "fluidProcessor" && node.role === "output")
  );
}

function isOutputEnabled(node: RuntimeNode): boolean {
  return (
    node.entity.kind !== "fluidPump" ||
    node.entity.powerSatisfaction > 0
  );
}

function hasPressureAdvantage(
  source: RuntimeNode,
  target: RuntimeNode,
): boolean {
  if (shouldForceFlow(source)) return true;
  return (
    source.box.amountMilli * target.box.capacityMilli >
    target.box.amountMilli * source.box.capacityMilli
  );
}

function allocateEvenly(
  total: number,
  capacities: readonly number[],
): number[] {
  const allocations = capacities.map(() => 0);
  const active = capacities
    .map((capacity, index) => ({ capacity, index }))
    .filter(({ capacity }) => capacity > 0);
  let remaining = total;
  while (remaining > 0 && active.length > 0) {
    const base = Math.floor(remaining / active.length);
    const remainder = remaining % active.length;
    let allocated = 0;
    for (let index = 0; index < active.length; index += 1) {
      const entry = active[index]!;
      const available =
        entry.capacity - allocations[entry.index]!;
      const share = base + (index < remainder ? 1 : 0);
      if (share <= 0) continue;
      const grant = Math.min(available, share);
      allocations[entry.index]! += grant;
      remaining -= grant;
      allocated += grant;
      if (remaining === 0) break;
    }
    for (let index = active.length - 1; index >= 0; index -= 1) {
      const entry = active[index]!;
      if (allocations[entry.index]! >= entry.capacity) {
        active.splice(index, 1);
      }
    }
    if (allocated === 0) break;
  }
  return allocations;
}

function totalStored(nodes: readonly RuntimeNode[]): number {
  let total = 0;
  for (const node of nodes) total += node.box.amountMilli;
  return total;
}

function normalizeBuffer(buffer: FluidBufferState): void {
  if (buffer.amountMilli === 0) delete buffer.fluidId;
}

function stepTransport(topology: RuntimeTopology): {
  transferredMilli: number;
  backpressuredEntityIds: number[];
  transferredBySource: ReadonlyMap<number, number>;
} {
  const storedBefore = totalStored(topology.nodes);
  const outgoingByNode = new Map<RuntimeNode, RuntimeEdge[]>();
  for (const edge of topology.edges) {
    const outgoing = outgoingByNode.get(edge.source) ?? [];
    outgoing.push(edge);
    outgoingByNode.set(edge.source, outgoing);
  }

  const proposals: Proposal[] = [];
  const offeredByNode = new Map<RuntimeNode, number>();
  for (const node of topology.nodes) {
    if (
      node.box.amountMilli <= 0 ||
      node.box.fluidId === undefined ||
      !isOutputEnabled(node)
    ) {
      continue;
    }
    const eligible = (outgoingByNode.get(node) ?? []).filter(
      (edge) =>
        canReceiveFluid(edge.target, node.box.fluidId!) &&
        edge.target.box.amountMilli < edge.target.box.capacityMilli &&
        hasPressureAdvantage(node, edge.target),
    );
    if (eligible.length === 0) continue;
    const offer = Math.min(node.box.amountMilli, node.maximumOut);
    const allocations = allocateEvenly(
      offer,
      eligible.map((edge) => edge.throughput),
    );
    let offered = 0;
    for (let index = 0; index < eligible.length; index += 1) {
      const amount = allocations[index]!;
      if (amount <= 0) continue;
      proposals.push({
        edge: eligible[index]!,
        fluidId: node.box.fluidId,
        amount,
      });
      offered += amount;
    }
    offeredByNode.set(node, offered);
  }

  const proposalsByTarget = new Map<RuntimeNode, Proposal[]>();
  for (const proposal of proposals) {
    const incoming = proposalsByTarget.get(proposal.edge.target) ?? [];
    incoming.push(proposal);
    proposalsByTarget.set(proposal.edge.target, incoming);
  }

  const accepted = new Map<Proposal, number>();
  for (const target of topology.nodes) {
    const incoming = proposalsByTarget.get(target);
    if (!incoming || incoming.length === 0) continue;
    let chosenFluid = target.box.fluidId;
    if (chosenFluid === undefined) {
      const totals = emptyFluidRecord();
      for (const proposal of incoming) {
        totals[proposal.fluidId] += proposal.amount;
      }
      chosenFluid = FLUID_IDS.slice().sort(
        (first, second) =>
          totals[second] - totals[first] ||
          FLUID_IDS.indexOf(first) - FLUID_IDS.indexOf(second),
      )[0]!;
    }
    const compatible = incoming
      .filter((proposal) => proposal.fluidId === chosenFluid)
      .sort((first, second) =>
        compareEdges(first.edge, second.edge)
      );
    const acceptLimit = Math.min(
      target.maximumIn,
      target.box.capacityMilli - target.box.amountMilli,
    );
    const allocations = allocateEvenly(
      acceptLimit,
      compatible.map((proposal) => proposal.amount),
    );
    for (let index = 0; index < compatible.length; index += 1) {
      accepted.set(compatible[index]!, allocations[index]!);
    }
  }

  let transferredMilli = 0;
  const transferredBySource = new Map<number, number>();
  for (const proposal of proposals.sort((first, second) =>
    compareEdges(first.edge, second.edge)
  )) {
    const amount = accepted.get(proposal) ?? 0;
    if (amount <= 0) continue;
    const { source, target } = proposal.edge;
    if (
      source.box.amountMilli < amount ||
      target.box.amountMilli + amount > target.box.capacityMilli
    ) {
      throw new Error("Fluid transfer allocation violated a box bound.");
    }
    source.box.amountMilli -= amount;
    target.box.amountMilli += amount;
    target.box.fluidId ??= proposal.fluidId;
    normalizeBuffer(source.box);
    transferredMilli += amount;
    transferredBySource.set(
      source.entity.id,
      (transferredBySource.get(source.entity.id) ?? 0) + amount,
    );
  }

  if (totalStored(topology.nodes) !== storedBefore) {
    throw new Error("Fluid transport violated fixed-point mass conservation.");
  }
  const backpressured = new Set<number>();
  for (const [node, offered] of offeredByNode) {
    const moved = transferredBySource.get(node.entity.id) ?? 0;
    if (moved < offered && node.box.amountMilli > 0) {
      backpressured.add(node.entity.id);
    }
  }
  return {
    transferredMilli,
    backpressuredEntityIds: [...backpressured].sort((a, b) => a - b),
    transferredBySource,
  };
}

function addFluid(
  buffer: FluidBufferState,
  fluidId: FluidId,
  requested: number,
): number {
  if (
    requested <= 0 ||
    (buffer.fluidId !== undefined && buffer.fluidId !== fluidId)
  ) {
    return 0;
  }
  const accepted = Math.min(
    requested,
    buffer.capacityMilli - buffer.amountMilli,
  );
  if (accepted <= 0) return 0;
  buffer.fluidId ??= fluidId;
  buffer.amountMilli += accepted;
  return accepted;
}

function stepSources(
  entities: readonly EntityState[],
): {
  producedMilli: Record<FluidId, number>;
  backpressuredEntityIds: number[];
} {
  const producedMilli = emptyFluidRecord();
  const backpressuredEntityIds: number[] = [];
  for (const entity of entities) {
    if (entity.kind !== "fluidSource" || !entity.fluidState?.buffer) continue;
    const fluidId = entity.fluidState.sourceFluidId!;
    const rate =
      ENTITY_PROTOTYPES.fluidSource.fluidSourceRateMilliPerTick!;
    const produced = addFluid(entity.fluidState.buffer, fluidId, rate);
    producedMilli[fluidId] += produced;
    const backpressured = produced < rate;
    entity.status = backpressured ? "blocked" : "working";
    if (produced > 0) {
      entity.animationPhase = (entity.animationPhase + 1 / 60) % 1;
    }
    if (backpressured) {
      backpressuredEntityIds.push(entity.id);
    }
  }
  return { producedMilli, backpressuredEntityIds };
}

function stepProcessors(
  entities: readonly EntityState[],
): Record<FluidId, number> {
  const processedMilli = emptyFluidRecord();
  for (const entity of entities) {
    if (entity.kind !== "fluidProcessor") continue;
    const state = entity.fluidState;
    const input = state?.input;
    const output = state?.output;
    const recipeId = state?.recipeId;
    if (!state || !input || !output || !recipeId) continue;
    const recipe = FLUID_RECIPES[recipeId];
    entity.progress = state.processTicks / recipe.durationTicks;
    if (entity.powerSatisfaction <= 0) {
      entity.status = "noPower";
      continue;
    }
    const outputAccepts =
      (output.fluidId === undefined ||
        output.fluidId === recipe.output) &&
      output.capacityMilli - output.amountMilli >=
        recipe.batchMilli;
    if (!outputAccepts) {
      entity.status = "outputFull";
      continue;
    }
    if (
      input.fluidId !== recipe.input ||
      input.amountMilli < recipe.batchMilli
    ) {
      entity.status = "missingInput";
      continue;
    }
    state.processTicks += 1;
    entity.status = "working";
    entity.progress = state.processTicks / recipe.durationTicks;
    entity.animationPhase = (entity.animationPhase + 1 / 60) % 1;
    if (state.processTicks < recipe.durationTicks) continue;

    input.amountMilli -= recipe.batchMilli;
    normalizeBuffer(input);
    const accepted = addFluid(
      output,
      recipe.output,
      recipe.batchMilli,
    );
    if (accepted !== recipe.batchMilli) {
      throw new Error("Fluid processor committed a partial conserved batch.");
    }
    processedMilli[recipe.output] += accepted;
    state.processTicks = 0;
    entity.progress = 0;
  }
  return processedMilli;
}

function updatePumpStates(
  entities: readonly EntityState[],
  transferredBySource: ReadonlyMap<number, number>,
  backpressured: Set<number>,
): void {
  for (const entity of entities) {
    if (entity.kind !== "fluidPump") continue;
    const amount = entity.fluidState?.buffer?.amountMilli ?? 0;
    const moved = transferredBySource.get(entity.id) ?? 0;
    if (entity.powerSatisfaction <= 0) {
      entity.status = "noPower";
      entity.animationPhase = 0;
    } else if (moved > 0) {
      entity.status = "working";
      entity.animationPhase =
        (entity.animationPhase +
          moved /
            ENTITY_PROTOTYPES.fluidPump.fluidThroughputMilliPerTick!) %
        1;
    } else if (amount > 0) {
      entity.status = "blocked";
      backpressured.add(entity.id);
    } else {
      entity.status = "idle";
    }
  }
}

function snapshotFromTopology(
  topology: RuntimeTopology,
): FluidNetworkSnapshot {
  const incomingCounts = new Map<RuntimeNode, number>();
  const outgoingCounts = new Map<RuntimeNode, number>();
  for (const edge of topology.edges) {
    incomingCounts.set(
      edge.target,
      (incomingCounts.get(edge.target) ?? 0) + 1,
    );
    outgoingCounts.set(
      edge.source,
      (outgoingCounts.get(edge.source) ?? 0) + 1,
    );
  }
  const nodes: FluidNetworkNodeSnapshot[] = topology.nodes.map((node) => ({
    entityId: node.entity.id,
    role: node.role,
    componentId: node.componentId,
    x: node.entity.x,
    y: node.entity.y,
    ...(node.box.fluidId ? { fluidId: node.box.fluidId } : {}),
    amountMilli: node.box.amountMilli,
    capacityMilli: node.box.capacityMilli,
    incomingEdgeCount: incomingCounts.get(node) ?? 0,
    outgoingEdgeCount: outgoingCounts.get(node) ?? 0,
  }));
  const edges: FluidNetworkEdgeSnapshot[] = topology.edges.map((edge) => ({
    sourceEntityId: edge.source.entity.id,
    sourceRole: edge.source.role,
    targetEntityId: edge.target.entity.id,
    targetRole: edge.target.role,
    throughputMilliPerTick: edge.throughput,
  }));
  return {
    nodes,
    edges,
    components: topology.components.map((component) => ({
      ...component,
      fluidIds: [...component.fluidIds],
    })),
  };
}

export function buildFluidNetworkSnapshot(
  entities: readonly EntityState[],
): FluidNetworkSnapshot {
  return snapshotFromTopology(buildRuntimeTopology(entities));
}

export function stepFluidNetwork(
  sourceEntities: readonly EntityState[],
): FluidStepResult {
  const entities = sourceEntities
    .filter((entity) => isFluidEntityKind(entity.kind))
    .slice()
    .sort(compareEntitiesSpatially);
  const storedBefore = entities.reduce(
    (total, entity) =>
      total +
      fluidBoxes(entity).reduce(
        (subtotal, { box }) => subtotal + box.amountMilli,
        0,
      ),
    0,
  );
  const sourceStep = stepSources(entities);
  const processedMilli = stepProcessors(entities);
  const topology = buildRuntimeTopology(entities);
  const transport = stepTransport(topology);
  const producedTotal = FLUID_IDS.reduce(
    (total, fluidId) => total + sourceStep.producedMilli[fluidId],
    0,
  );
  const storedAfter = totalStored(topology.nodes);
  if (storedAfter !== storedBefore + producedTotal) {
    throw new Error("Fluid step violated source-adjusted mass conservation.");
  }

  const backpressured = new Set<number>([
    ...sourceStep.backpressuredEntityIds,
    ...transport.backpressuredEntityIds,
  ]);
  updatePumpStates(entities, transport.transferredBySource, backpressured);
  return {
    producedMilli: sourceStep.producedMilli,
    processedMilli,
    transferredMilli: transport.transferredMilli,
    backpressuredEntityIds: [...backpressured].sort((a, b) => a - b),
    network: snapshotFromTopology(topology),
  };
}

export function buildFluidStats(
  entities: readonly EntityState[],
  producedMilli: Readonly<Record<FluidId, number>>,
  processedMilli: Readonly<Record<FluidId, number>>,
  transferredMilli: number,
  backpressuredEntityIds: readonly number[],
  network: FluidNetworkSnapshot = buildFluidNetworkSnapshot(entities),
): FluidStats {
  const storedMilli = emptyFluidRecord();
  for (const node of network.nodes) {
    if (node.fluidId) storedMilli[node.fluidId] += node.amountMilli;
  }
  return {
    componentCount: network.components.length,
    nodeCount: network.nodes.length,
    storedMilli,
    producedMilli: { ...producedMilli },
    processedMilli: { ...processedMilli },
    transferredMilli,
    backpressuredEntityIds: [...backpressuredEntityIds].sort(
      (first, second) => first - second,
    ),
    components: network.components.map((component) => ({
      ...component,
      fluidIds: [...component.fluidIds],
    })),
  };
}
