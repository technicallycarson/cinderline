import { describe, expect, it } from "vitest";

import {
  POWER_CABLE_REACH_TILES,
  POWER_MAX_LINKS_PER_RELAY,
  POWER_SUPPLY_HALF_EXTENT_TILES,
  benchmarkPreparedPowerDispatch,
  benchmarkPowerTopology,
  canonicalPowerTopologyHash,
  createPowerDispatchWorkspace,
  dispatchPreparedPowerInto,
  dispatchPower,
  preparePowerDispatch,
  rebuildPowerTopology,
  type CanonicalIdMap,
  type PowerConsumerParticipant,
  type PowerDispatch,
  type PowerGeneratorParticipant,
  type PowerParticipant,
  type PowerPassiveParticipant,
  type PowerRelayNode,
  type PowerTopology,
  type PreparedPowerDispatchPlan,
  type PreparedPowerDispatchWorkspace,
  type PreparedPowerDynamicScalars,
} from "../src/game/power-topology";

function relay(id: number, x: number, y: number): PowerRelayNode {
  return { id, center: { x, y } };
}

function consumer(
  id: number,
  x: number,
  y: number,
  demand = 10,
): PowerConsumerParticipant {
  return { id, center: { x, y }, role: "consumer", demand };
}

function generator(
  id: number,
  x: number,
  y: number,
  capacity = 10,
): PowerGeneratorParticipant {
  return { id, center: { x, y }, role: "generator", capacity };
}

function passive(
  id: number,
  x: number,
  y: number,
): PowerPassiveParticipant {
  return { id, center: { x, y }, role: "passive" };
}

function mapValue<Value>(
  entries: CanonicalIdMap<Value>,
  id: number,
): Value | undefined {
  return entries.find(([entryId]) => entryId === id)?.[1];
}

function linkKey(left: number, right: number): string {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

function linkKeys(topology: PowerTopology): Set<string> {
  return new Set(
    topology.links.map((link) =>
      linkKey(link.relayAId, link.relayBId)
    ),
  );
}

function expectCanonicalSymmetricGraph(topology: PowerTopology): void {
  const keys = linkKeys(topology);
  expect(keys.size).toBe(topology.links.length);
  expect(topology.links).toEqual(
    [...topology.links].sort((left, right) =>
      left.distanceSquared - right.distanceSquared
      || left.relayAId - right.relayAId
      || left.relayBId - right.relayBId
    ),
  );
  for (const link of topology.links) {
    expect(link.relayAId).toBeLessThan(link.relayBId);
    expect(link.relayAId).not.toBe(link.relayBId);
  }

  for (const [relayId, neighbors] of topology.relayAdjacency) {
    expect(neighbors).toEqual([...neighbors].sort((a, b) => a - b));
    expect(new Set(neighbors).size).toBe(neighbors.length);
    expect(neighbors).not.toContain(relayId);
    expect(neighbors.length).toBeLessThanOrEqual(
      POWER_MAX_LINKS_PER_RELAY,
    );
    for (const neighbor of neighbors) {
      expect(mapValue(topology.relayAdjacency, neighbor)).toContain(relayId);
      expect(keys.has(linkKey(relayId, neighbor))).toBe(true);
    }
  }
}

function expectTriangleFree(topology: PowerTopology): void {
  const adjacency = new Map(topology.relayAdjacency);
  for (const [relayId, neighbors] of topology.relayAdjacency) {
    for (const neighbor of neighbors) {
      const neighborSet = new Set(adjacency.get(neighbor) ?? []);
      for (const third of neighbors) {
        if (third === neighbor) continue;
        expect(
          neighborSet.has(third),
          `triangle ${relayId}-${neighbor}-${third}`,
        ).toBe(false);
      }
    }
  }
}

function expectNoNegativeZero(value: unknown): void {
  if (typeof value === "number") {
    expect(Object.is(value, -0)).toBe(false);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) expectNoNegativeZero(entry);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) expectNoNegativeZero(entry);
  }
}

function bruteClosestRelay(
  relays: readonly PowerRelayNode[],
  participant: PowerParticipant,
): number | null {
  if (participant.role === "passive") return null;
  let closestId: number | null = null;
  let closestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const candidate of relays) {
    const deltaX = candidate.center.x - participant.center.x;
    const deltaY = candidate.center.y - participant.center.y;
    if (
      Math.abs(deltaX) > POWER_SUPPLY_HALF_EXTENT_TILES
      || Math.abs(deltaY) > POWER_SUPPLY_HALF_EXTENT_TILES
    ) {
      continue;
    }
    const distanceSquared = deltaX * deltaX + deltaY * deltaY;
    if (
      distanceSquared < closestDistanceSquared
      || (
        distanceSquared === closestDistanceSquared
        && (closestId === null || candidate.id < closestId)
      )
    ) {
      closestId = candidate.id;
      closestDistanceSquared = distanceSquared;
    }
  }
  return closestId;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffled<Value>(
  values: readonly Value[],
  seed: number,
): Value[] {
  const output = [...values];
  const random = mulberry32(seed);
  for (let index = output.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [output[index], output[target]] = [output[target]!, output[index]!];
  }
  return output;
}

function scaleFixture(): {
  readonly relays: readonly PowerRelayNode[];
  readonly participants: readonly PowerParticipant[];
} {
  const relays: PowerRelayNode[] = [];
  for (let row = 0; row < 16; row += 1) {
    for (let column = 0; column < 32; column += 1) {
      relays.push(relay(1 + row * 32 + column, column * 6, row * 6));
    }
  }

  const random = mulberry32(0x51a1e);
  const participants: PowerParticipant[] = [];
  for (let index = 0; index < 5_000; index += 1) {
    const x = -9 + random() * 204;
    const y = -9 + random() * 108;
    const id = 10_000 + index;
    switch (index % 5) {
      case 0:
        participants.push(generator(id, x, y, 4 + (index % 23)));
        break;
      case 1:
      case 2:
      case 3:
        participants.push(consumer(id, x, y, 1 + (index % 17)));
        break;
      case 4:
        participants.push(passive(id, x, y));
        break;
    }
  }
  return { relays, participants };
}

function dynamicScalarsFor(
  plan: PreparedPowerDispatchPlan,
  participants: readonly PowerParticipant[],
): PreparedPowerDynamicScalars {
  const participantById = new Map(
    participants.map((participant) => [participant.id, participant]),
  );
  const consumerDemands = new Float64Array(plan.consumerIds.length);
  for (let index = 0; index < plan.consumerIds.length; index += 1) {
    const participant = participantById.get(plan.consumerIds[index]!);
    if (!participant || participant.role !== "consumer") {
      throw new Error("Test fixture is missing a prepared consumer.");
    }
    consumerDemands[index] = participant.demand;
  }
  const generatorCapacities = new Float64Array(plan.generatorIds.length);
  for (let index = 0; index < plan.generatorIds.length; index += 1) {
    const participant = participantById.get(plan.generatorIds[index]!);
    if (!participant || participant.role !== "generator") {
      throw new Error("Test fixture is missing a prepared generator.");
    }
    generatorCapacities[index] = participant.capacity;
  }
  return { consumerDemands, generatorCapacities };
}

function preparedDispatchSnapshot(
  plan: PreparedPowerDispatchPlan,
  workspace: PreparedPowerDispatchWorkspace,
): PowerDispatch {
  return {
    networks: plan.networkIds.map((networkId, index) => ({
      networkId,
      demand: workspace.networkDemand[index]!,
      availableCapacity: workspace.networkAvailableCapacity[index]!,
      usedCapacity: workspace.networkUsedCapacity[index]!,
      satisfaction: workspace.networkSatisfaction[index]!,
    })),
    consumerSatisfaction: plan.consumerIds.map((id, index) =>
      [id, workspace.consumerSatisfaction[index]!] as const
    ),
    generatorOutput: plan.generatorIds.map((id, index) =>
      [id, workspace.generatorOutput[index]!] as const
    ),
    totalDemand: workspace.totalDemand,
    totalGeneratorCapacity: workspace.totalGeneratorCapacity,
    totalUsedCapacity: workspace.totalUsedCapacity,
    disconnectedDemand: workspace.disconnectedDemand,
    disconnectedGeneratorCapacity:
      workspace.disconnectedGeneratorCapacity,
    globalSatisfaction: workspace.globalSatisfaction,
  };
}

function rawWorkspaceSnapshot(
  workspace: PreparedPowerDispatchWorkspace,
): unknown {
  return {
    networkDemand: Array.from(workspace.networkDemand),
    networkAvailableCapacity:
      Array.from(workspace.networkAvailableCapacity),
    networkUsedCapacity: Array.from(workspace.networkUsedCapacity),
    networkSatisfaction: Array.from(workspace.networkSatisfaction),
    consumerSatisfaction: Array.from(workspace.consumerSatisfaction),
    generatorOutput: Array.from(workspace.generatorOutput),
    totalDemand: workspace.totalDemand,
    totalGeneratorCapacity: workspace.totalGeneratorCapacity,
    totalUsedCapacity: workspace.totalUsedCapacity,
    disconnectedDemand: workspace.disconnectedDemand,
    disconnectedGeneratorCapacity:
      workspace.disconnectedGeneratorCapacity,
    globalSatisfaction: workspace.globalSatisfaction,
  };
}

interface ExactWorkspaceSnapshot {
  readonly extensible: boolean;
  readonly sealed: boolean;
  readonly frozen: boolean;
  readonly prototype: object | null;
  readonly properties: ReadonlyMap<
    PropertyKey,
    {
      readonly configurable: boolean;
      readonly enumerable: boolean;
      readonly kind: "data" | "accessor";
      readonly writable?: boolean;
      readonly value?: unknown;
      readonly get?: (() => unknown) | undefined;
      readonly set?: ((value: unknown) => void) | undefined;
    }
  >;
  readonly arrays: readonly {
    readonly reference: ArrayBufferView;
    readonly byteLength: number | "detached";
    readonly bytes: readonly number[] | "detached";
  }[];
}

function safeTypedArrayBytes(
  value: ArrayBufferView,
): {
  readonly byteLength: number | "detached";
  readonly bytes: readonly number[] | "detached";
} {
  try {
    const byteLength = value.byteLength;
    return {
      byteLength,
      bytes: Array.from(
        new Uint8Array(value.buffer, value.byteOffset, byteLength),
      ),
    };
  } catch {
    return { byteLength: "detached", bytes: "detached" };
  }
}

function exactWorkspaceSnapshot(
  workspace: PreparedPowerDispatchWorkspace,
  arrayReferences: readonly ArrayBufferView[] = [
    workspace.networkDemand,
    workspace.networkAvailableCapacity,
    workspace.networkUsedCapacity,
    workspace.networkSatisfaction,
    workspace.consumerSatisfaction,
    workspace.generatorOutput,
  ],
): ExactWorkspaceSnapshot {
  const properties = new Map<
    PropertyKey,
    ExactWorkspaceSnapshot["properties"] extends ReadonlyMap<
      PropertyKey,
      infer Value
    > ? Value : never
  >();
  for (const property of Reflect.ownKeys(workspace)) {
    const descriptor = Object.getOwnPropertyDescriptor(workspace, property)!;
    if ("value" in descriptor) {
      properties.set(property, {
        configurable: descriptor.configurable ?? false,
        enumerable: descriptor.enumerable ?? false,
        kind: "data",
        writable: descriptor.writable ?? false,
        value: descriptor.value,
      });
    } else {
      properties.set(property, {
        configurable: descriptor.configurable ?? false,
        enumerable: descriptor.enumerable ?? false,
        kind: "accessor",
        get: descriptor.get,
        set: descriptor.set,
      });
    }
  }
  return {
    extensible: Object.isExtensible(workspace),
    sealed: Object.isSealed(workspace),
    frozen: Object.isFrozen(workspace),
    prototype: Object.getPrototypeOf(workspace),
    properties,
    arrays: arrayReferences.map((reference) => ({
      reference,
      ...safeTypedArrayBytes(reference),
    })),
  };
}

function expectExactWorkspaceUnchanged(
  workspace: PreparedPowerDispatchWorkspace,
  before: ExactWorkspaceSnapshot,
): void {
  const after = exactWorkspaceSnapshot(
    workspace,
    before.arrays.map(({ reference }) => reference),
  );
  expect(after.extensible).toBe(before.extensible);
  expect(after.sealed).toBe(before.sealed);
  expect(after.frozen).toBe(before.frozen);
  expect(after.prototype).toBe(before.prototype);
  expect([...after.properties.keys()]).toEqual([
    ...before.properties.keys(),
  ]);
  for (const [property, expected] of before.properties) {
    const actual = after.properties.get(property);
    expect(actual).toBeDefined();
    expect(actual?.configurable).toBe(expected.configurable);
    expect(actual?.enumerable).toBe(expected.enumerable);
    expect(actual?.kind).toBe(expected.kind);
    expect(actual?.writable).toBe(expected.writable);
    expect(actual?.get).toBe(expected.get);
    expect(actual?.set).toBe(expected.set);
    if (expected.kind === "data") {
      if (
        typeof expected.value === "object"
        && expected.value !== null
      ) {
        expect(actual?.value).toBe(expected.value);
      } else {
        expect(Object.is(actual?.value, expected.value)).toBe(true);
      }
    }
  }
  expect(after.arrays).toHaveLength(before.arrays.length);
  for (let index = 0; index < before.arrays.length; index += 1) {
    expect(after.arrays[index]?.reference).toBe(
      before.arrays[index]?.reference,
    );
    expect(after.arrays[index]?.byteLength).toBe(
      before.arrays[index]?.byteLength,
    );
    expect(after.arrays[index]?.bytes).toEqual(
      before.arrays[index]?.bytes,
    );
  }
}

function nextRepresentable(
  value: number,
  direction: -1 | 1,
): number {
  if (Number.isNaN(value)) return Number.NaN;
  if (
    (direction === 1 && value === Number.POSITIVE_INFINITY)
    || (direction === -1 && value === Number.NEGATIVE_INFINITY)
  ) {
    return value;
  }
  if (value === 0) {
    return direction === 1 ? Number.MIN_VALUE : -Number.MIN_VALUE;
  }
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value);
  let bits = view.getBigUint64(0);
  bits += (value > 0) === (direction > 0) ? 1n : -1n;
  view.setBigUint64(0, bits);
  return view.getFloat64(0);
}

function preparedWorkspaceFixture(): {
  readonly topology: PowerTopology;
  readonly participants: readonly PowerParticipant[];
  readonly plan: PreparedPowerDispatchPlan;
  readonly workspace: PreparedPowerDispatchWorkspace;
  readonly scalars: PreparedPowerDynamicScalars;
} {
  const participants = [
    generator(10, 0, 0, 20),
    consumer(11, 0, 0, 10),
    generator(12, 0, 0, 30),
    consumer(13, 0, 0, 15),
  ];
  const topology = rebuildPowerTopology([relay(1, 0, 0)], participants);
  const plan = preparePowerDispatch(
    topology,
    participants.map(({ id, role }) => ({ id, role })),
  );
  const workspace = createPowerDispatchWorkspace(plan);
  const scalars = dynamicScalarsFor(plan, participants);
  dispatchPreparedPowerInto(plan, scalars, workspace);
  return { topology, participants, plan, workspace, scalars };
}

describe("power topology geometry and assignment", () => {
  it("includes the cable reach boundary and excludes points beyond it", () => {
    const exact = rebuildPowerTopology(
      [
        relay(1, 0, 0),
        relay(2, POWER_CABLE_REACH_TILES, 0),
      ],
      [],
    );
    expect(exact.links).toHaveLength(1);
    expect(exact.links[0]).toMatchObject({
      relayAId: 1,
      relayBId: 2,
      distanceSquared:
        POWER_CABLE_REACH_TILES * POWER_CABLE_REACH_TILES,
    });

    const beyond = rebuildPowerTopology(
      [
        relay(1, 0, 0),
        relay(2, POWER_CABLE_REACH_TILES + 0.000_001, 0),
      ],
      [],
    );
    expect(beyond.links).toHaveLength(0);
    expect(beyond.components.map((component) => component.networkId)).toEqual([
      1,
      2,
    ]);
  });

  it("includes trig-constructed nominal cable boundaries by ULP, not epsilon", () => {
    const nominalBoundary = rebuildPowerTopology(
      [
        relay(1, 0, 0),
        relay(2, 7.499_999_763_129_496, 0.001_884_955_572_309_859),
      ],
      [],
    );
    expect(
      nominalBoundary.links[0]?.distanceSquared,
    ).toBe(56.250_000_000_000_014);
    expect(nominalBoundary.links).toHaveLength(1);

    const genuinelyOutside = rebuildPowerTopology(
      [
        relay(1, 0, 0),
        relay(2, POWER_CABLE_REACH_TILES + 0.000_000_001, 0),
      ],
      [],
    );
    expect(genuinelyOutside.links).toHaveLength(0);
  });

  it("uses an inclusive square supply area, including all four corners", () => {
    const extent = POWER_SUPPLY_HALF_EXTENT_TILES;
    const participants = [
      consumer(10, extent, extent),
      consumer(11, -extent, extent),
      consumer(12, extent, -extent),
      consumer(13, -extent, -extent),
      consumer(14, extent + 0.000_001, 0),
      consumer(15, 0, -extent - 0.000_001),
    ];
    const topology = rebuildPowerTopology([relay(1, 0, 0)], participants);
    for (const id of [10, 11, 12, 13]) {
      expect(mapValue(topology.participantToRelay, id)).toBe(1);
      expect(mapValue(topology.participantToNetwork, id)).toBe(1);
    }
    for (const id of [14, 15]) {
      expect(mapValue(topology.participantToRelay, id)).toBeNull();
      expect(mapValue(topology.participantToNetwork, id)).toBeNull();
    }
  });

  it("covers a participant when an occupied tile center reaches the square", () => {
    const topology = rebuildPowerTopology(
      [relay(1, 0, 0)],
      [
        {
          ...consumer(10, 6, 0),
          coverageHalfWidthTiles: 1,
          coverageHalfHeightTiles: 0.5,
        },
        {
          ...consumer(11, 6.000_001, 0),
          coverageHalfWidthTiles: 1,
          coverageHalfHeightTiles: 0.5,
        },
      ],
    );
    expect(topology.participantToRelay).toEqual([
      [10, 1],
      [11, null],
    ]);
  });

  it("uses only a few ULPs of tolerance at square coverage boundaries", () => {
    const topology = rebuildPowerTopology(
      [relay(1, 0, 0)],
      [
        consumer(10, 5.000_000_000_000_001, 0),
        consumer(11, 5.000_000_001, 0),
      ],
    );
    expect(topology.participantToRelay).toEqual([
      [10, 1],
      [11, null],
    ]);
  });

  it("visits tolerance-included relays across a lower hash boundary", () => {
    const oneStepBelowBoundary = nextRepresentable(0, -1);
    const cable = rebuildPowerTopology(
      [
        relay(1, POWER_CABLE_REACH_TILES, 0),
        relay(2, oneStepBelowBoundary, 0),
      ],
      [],
    );
    expect(cable.candidatePairCount).toBe(1);
    expect(cable.links).toHaveLength(1);

    const supply = rebuildPowerTopology(
      [relay(1, oneStepBelowBoundary, 0)],
      [consumer(10, POWER_SUPPLY_HALF_EXTENT_TILES, 0)],
    );
    expect(supply.participantToRelay).toEqual([[10, 1]]);

    const genuinelyOutsideCable = rebuildPowerTopology(
      [
        relay(1, POWER_CABLE_REACH_TILES, 0),
        relay(2, -0.000_000_001, 0),
      ],
      [],
    );
    expect(genuinelyOutsideCable.candidatePairCount).toBe(0);
    expect(genuinelyOutsideCable.links).toHaveLength(0);
    const genuinelyOutsideSupply = rebuildPowerTopology(
      [relay(1, -0.000_000_001, 0)],
      [consumer(10, POWER_SUPPLY_HALF_EXTENT_TILES, 0)],
    );
    expect(genuinelyOutsideSupply.participantToRelay).toEqual([[10, null]]);
  });

  it("matches brute geometry at positive and negative hash boundaries", () => {
    const linearTolerance = 2 ** (2 - 52) * 2;
    const squaredTolerance = 2 ** (5 - 52) * 2;
    const boundaries = [-22.5, -15, -7.5, 0, 7.5, 15, 22.5];
    for (const boundary of boundaries) {
      for (const axis of ["x", "y"] as const) {
        for (const side of [-1, 1] as const) {
          const candidateCoordinate = nextRepresentable(boundary, side);
          const cableQueryCoordinate = side === -1
            ? boundary + POWER_CABLE_REACH_TILES
            : boundary - POWER_CABLE_REACH_TILES;
          const query = axis === "x"
            ? relay(1, cableQueryCoordinate, 0)
            : relay(1, 0, cableQueryCoordinate);
          const candidate = axis === "x"
            ? relay(2, candidateCoordinate, 0)
            : relay(2, 0, candidateCoordinate);
          const delta = candidateCoordinate - cableQueryCoordinate;
          const cableExpected = (
            Math.abs(delta) <= POWER_CABLE_REACH_TILES
            || Math.abs(delta) - POWER_CABLE_REACH_TILES
              <= linearTolerance
          ) && (
            delta * delta
              <= POWER_CABLE_REACH_TILES * POWER_CABLE_REACH_TILES
            || delta * delta
                - POWER_CABLE_REACH_TILES * POWER_CABLE_REACH_TILES
              <= squaredTolerance
          );
          const cable = rebuildPowerTopology([query, candidate], []);
          expect(
            cable.candidatePairCount,
            `cable ${axis} boundary ${boundary} side ${side}`,
          ).toBe(cableExpected ? 1 : 0);
          expect(cable.links).toHaveLength(cableExpected ? 1 : 0);

          const supplyQueryCoordinate = side === -1
            ? boundary + POWER_SUPPLY_HALF_EXTENT_TILES
            : boundary - POWER_SUPPLY_HALF_EXTENT_TILES;
          const supplyRelay = axis === "x"
            ? relay(1, candidateCoordinate, 0)
            : relay(1, 0, candidateCoordinate);
          const supplied = axis === "x"
            ? consumer(10, supplyQueryCoordinate, 0)
            : consumer(10, 0, supplyQueryCoordinate);
          const supplyDelta =
            candidateCoordinate - supplyQueryCoordinate;
          const supplyExpected = (
            Math.abs(supplyDelta) <= POWER_SUPPLY_HALF_EXTENT_TILES
            || Math.abs(supplyDelta) - POWER_SUPPLY_HALF_EXTENT_TILES
              <= linearTolerance
          );
          const supply = rebuildPowerTopology(
            [supplyRelay],
            [supplied],
          );
          expect(
            mapValue(supply.participantToRelay, 10),
            `supply ${axis} boundary ${boundary} side ${side}`,
          ).toBe(supplyExpected ? 1 : null);
        }
      }
    }
  });

  it("assigns the nearest covering relay and breaks exact ties by relay ID", () => {
    const topology = rebuildPowerTopology(
      [
        relay(20, -2, 0),
        relay(10, 2, 0),
        relay(30, 0, 5),
      ],
      [
        consumer(100, 0, 0),
        generator(101, -1.8, 0),
        passive(102, 2, 0),
      ],
    );
    expect(mapValue(topology.participantToRelay, 100)).toBe(10);
    expect(mapValue(topology.participantToRelay, 101)).toBe(20);
    expect(mapValue(topology.participantToRelay, 102)).toBeNull();
    expect(mapValue(topology.participantToNetwork, 102)).toBeNull();
  });

  it("accepts extreme finite coincident centers without spatial overflow", () => {
    const coordinate = Number.MAX_VALUE;
    const topology = rebuildPowerTopology(
      [
        relay(2, coordinate, coordinate),
        relay(1, coordinate, coordinate),
      ],
      [consumer(10, coordinate, coordinate)],
    );
    expect(topology.links).toEqual([{
      relayAId: 1,
      relayBId: 2,
      distanceSquared: 0,
    }]);
    expect(topology.participantToRelay).toEqual([[10, 1]]);
  });

  it("returns canonical symmetric links with no self-links or duplicates", () => {
    const relays = Array.from({ length: 18 }, (_, index) => {
      const angle = index * Math.PI * 2 / 18;
      return relay(
        100 - index,
        Math.cos(angle) * 5.2,
        Math.sin(angle) * 5.2,
      );
    });
    const topology = rebuildPowerTopology(relays, []);
    expectCanonicalSymmetricGraph(topology);
    expectTriangleFree(topology);
  });

  it("adds a four-edge redundancy cycle but never closes a triangle", () => {
    const topology = rebuildPowerTopology(
      [
        relay(1, 0, 0),
        relay(2, 4, 0),
        relay(3, 0, 4),
        relay(4, 4, 4),
      ],
      [],
    );
    const keys = linkKeys(topology);
    expect(keys).toEqual(new Set(["1:2", "1:3", "2:4", "3:4"]));
    expectTriangleFree(topology);
  });

  it("builds connectivity bridges before spending degree on redundancy", () => {
    const topology = rebuildPowerTopology(
      [
        relay(40, 13, 0),
        relay(10, 0, 0),
        relay(30, 10, 0),
        relay(20, 3, 0),
      ],
      [],
    );
    expect(linkKeys(topology)).toEqual(
      new Set(["10:20", "20:30", "30:40"]),
    );
    expect(topology.components).toHaveLength(1);
    expect(topology.components[0]?.networkId).toBe(10);
    expect(topology.components[0]?.relayIds).toEqual([10, 20, 30, 40]);
  });

  it("gives isolated components their lowest relay ID", () => {
    const topology = rebuildPowerTopology(
      [
        relay(90, 31, 0),
        relay(20, 4, 0),
        relay(50, 27, 0),
        relay(10, 0, 0),
        relay(70, 100, 100),
      ],
      [
        consumer(101, 2, 0),
        consumer(102, 29, 0),
        consumer(103, 100, 100),
      ],
    );
    expect(topology.relayToNetwork).toEqual([
      [10, 10],
      [20, 10],
      [50, 50],
      [70, 70],
      [90, 50],
    ]);
    expect(topology.components.map((component) => component.networkId)).toEqual([
      10,
      50,
      70,
    ]);
    expect(topology.participantToNetwork).toEqual([
      [101, 10],
      [102, 50],
      [103, 70],
    ]);
  });

  it("recomputes removal/addition without retaining stale connectivity", () => {
    const relays = [
      relay(1, 0, 0),
      relay(2, 7, 0),
      relay(3, 14, 0),
    ];
    const participants = [consumer(10, 14, 0)];
    const before = rebuildPowerTopology(relays, participants);
    const removed = rebuildPowerTopology(
      [relays[2]!, relays[0]!],
      participants,
    );
    const restored = rebuildPowerTopology(
      [relays[1]!, relays[0]!, relays[2]!],
      [...participants],
    );
    expect(removed.links).toHaveLength(0);
    expect(removed.components).toHaveLength(2);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(before));
  });

  it("is byte-identical under shuffled relay and participant inputs", () => {
    const random = mulberry32(0xcab1e);
    const relays = Array.from({ length: 48 }, (_, index) =>
      relay(index + 1, random() * 72 - 12, random() * 52 - 8)
    );
    const participants = Array.from(
      { length: 180 },
      (_, index): PowerParticipant => {
        const id = 1_000 + index;
        const x = random() * 80 - 16;
        const y = random() * 60 - 12;
        if (index % 3 === 0) return generator(id, x, y, index % 19);
        if (index % 3 === 1) return consumer(id, x, y, index % 13);
        return passive(id, x, y);
      },
    );
    const canonical = JSON.stringify(
      rebuildPowerTopology(relays, participants),
    );
    for (let seed = 1; seed <= 64; seed += 1) {
      const shuffledJson = JSON.stringify(
        rebuildPowerTopology(
          shuffled(relays, seed * 17),
          shuffled(participants, seed * 31),
        ),
      );
      expect(shuffledJson).toBe(canonical);
    }
  });

  it("matches brute-force coverage while scanning only intersecting cells", () => {
    const relays: PowerRelayNode[] = [];
    for (let row = -3; row <= 3; row += 1) {
      for (let column = -4; column <= 4; column += 1) {
        relays.push(
          relay(
            1 + relays.length,
            column * 7.5 + (row % 2) * 0.37,
            row * 7.5 - (column % 3) * 0.29,
          ),
        );
      }
    }
    const random = mulberry32(0xce11);
    const participants: PowerParticipant[] = Array.from(
      { length: 500 },
      (_, index) => {
        const id = 2_000 + index;
        const x = random() * 82 - 41;
        const y = random() * 64 - 32;
        if (index % 7 === 0) return passive(id, x, y);
        if (index % 3 === 0) return generator(id, x, y, index % 11);
        return consumer(id, x, y, index % 13);
      },
    );
    const sorted = rebuildPowerTopology(relays, participants);
    const expected = participants
      .map((participant) => [
        participant.id,
        bruteClosestRelay(relays, participant),
      ] as const)
      .sort(([left], [right]) => left - right);
    expect(sorted.participantToRelay).toEqual(expected);

    const shuffledTopology = rebuildPowerTopology(
      shuffled(relays, 81),
      shuffled(participants, 91),
    );
    expect(JSON.stringify(shuffledTopology)).toBe(JSON.stringify(sorted));
  });
});

describe("power dispatch", () => {
  it("isolates brownouts between disconnected grids", () => {
    const participants = [
      generator(10, 0, 0, 100),
      consumer(11, 0, 0, 50),
      generator(20, 30, 0, 20),
      consumer(21, 30, 0, 100),
    ];
    const topology = rebuildPowerTopology(
      [relay(1, 0, 0), relay(2, 30, 0)],
      participants,
    );
    const dispatch = dispatchPower(topology, participants);
    expect(dispatch.networks).toEqual([
      {
        networkId: 1,
        demand: 50,
        availableCapacity: 100,
        usedCapacity: 50,
        satisfaction: 1,
      },
      {
        networkId: 2,
        demand: 100,
        availableCapacity: 20,
        usedCapacity: 20,
        satisfaction: 0.2,
      },
    ]);
    expect(dispatch.consumerSatisfaction).toEqual([
      [11, 1],
      [21, 0.2],
    ]);
    expect(dispatch.globalSatisfaction).toBe(70 / 150);
  });

  it("sets uncovered consumers and generators to exactly zero", () => {
    const participants = [
      consumer(10, 100, 100, 30),
      generator(11, -100, -100, 90),
      passive(12, 0, 0),
    ];
    const topology = rebuildPowerTopology([relay(1, 0, 0)], participants);
    const dispatch = dispatchPower(topology, participants);
    expect(topology.participantToRelay).toEqual([
      [10, null],
      [11, null],
      [12, null],
    ]);
    expect(dispatch.consumerSatisfaction).toEqual([[10, 0]]);
    expect(dispatch.generatorOutput).toEqual([[11, 0]]);
    expect(dispatch.disconnectedDemand).toBe(30);
    expect(dispatch.disconnectedGeneratorCapacity).toBe(90);
    expect(dispatch.globalSatisfaction).toBe(0);
  });

  it("dispatches generators by ascending ID regardless of input order", () => {
    const participants = [
      generator(30, 0, 0, 60),
      consumer(40, 0, 0, 70),
      generator(20, 0, 0, 50),
    ];
    const topology = rebuildPowerTopology([relay(1, 0, 0)], participants);
    const dispatch = dispatchPower(
      topology,
      [participants[1]!, participants[0]!, participants[2]!],
    );
    expect(dispatch.generatorOutput).toEqual([
      [20, 50],
      [30, 20],
    ]);
    expect(JSON.stringify(dispatch)).toBe(JSON.stringify(
      dispatchPower(topology, participants),
    ));
  });

  it("uses total used over all demand for global weighted satisfaction", () => {
    const participants = [
      generator(10, 0, 0, 200),
      consumer(11, 0, 0, 20),
      generator(20, 30, 0, 40),
      consumer(21, 30, 0, 80),
      consumer(30, 100, 100, 100),
    ];
    const topology = rebuildPowerTopology(
      [relay(1, 0, 0), relay(2, 30, 0)],
      participants,
    );
    const dispatch = dispatchPower(topology, participants);
    expect(mapValue(dispatch.consumerSatisfaction, 11)).toBe(1);
    expect(mapValue(dispatch.consumerSatisfaction, 21)).toBe(0.5);
    expect(mapValue(dispatch.consumerSatisfaction, 30)).toBe(0);
    expect(dispatch.totalUsedCapacity).toBe(60);
    expect(dispatch.totalDemand).toBe(200);
    expect(dispatch.globalSatisfaction).toBe(0.3);
  });

  it("reports full global satisfaction when total demand is zero", () => {
    const participants = [
      generator(10, 0, 0, 100),
      consumer(11, 0, 0, 0),
    ];
    const topology = rebuildPowerTopology([relay(1, 0, 0)], participants);
    const dispatch = dispatchPower(topology, participants);
    expect(dispatch.globalSatisfaction).toBe(1);
    expect(dispatch.totalUsedCapacity).toBe(0);
    expect(dispatch.generatorOutput).toEqual([[10, 0]]);
    expect(dispatch.consumerSatisfaction).toEqual([[11, 1]]);
  });

  it("canonicalizes decimal equality to exact full satisfaction", () => {
    const participants = [
      generator(10, 0, 0, 0.3),
      consumer(11, 0, 0, 0.1 + 0.2),
    ];
    const topology = rebuildPowerTopology([relay(1, 0, 0)], participants);
    const dispatch = dispatchPower(topology, participants);
    expect(dispatch.networks[0]?.satisfaction).toBe(1);
    expect(dispatch.consumerSatisfaction).toEqual([[11, 1]]);
    expect(dispatch.globalSatisfaction).toBe(1);

    const brownoutParticipants = [
      generator(20, 20, 0, 0.3 - 0.000_000_001),
      consumer(21, 20, 0, 0.3),
    ];
    const brownoutTopology = rebuildPowerTopology(
      [relay(2, 20, 0)],
      brownoutParticipants,
    );
    const brownout = dispatchPower(
      brownoutTopology,
      brownoutParticipants,
    );
    expect(brownout.networks[0]?.satisfaction).toBeLessThan(1);
    expect(brownout.globalSatisfaction).toBeLessThan(1);
    expect(brownout.globalSatisfaction).toBeCloseTo(
      (0.3 - 0.000_000_001) / 0.3,
      14,
    );

    const integerBrownoutParticipants = [
      generator(30, 40, 0, Number.MAX_SAFE_INTEGER - 1),
      consumer(31, 40, 0, Number.MAX_SAFE_INTEGER),
    ];
    const integerBrownoutTopology = rebuildPowerTopology(
      [relay(3, 40, 0)],
      integerBrownoutParticipants,
    );
    const integerBrownout = dispatchPower(
      integerBrownoutTopology,
      integerBrownoutParticipants,
    );
    expect(integerBrownout.globalSatisfaction).toBeLessThan(1);
    expect(integerBrownout.networks[0]?.satisfaction).toBeLessThan(1);
  });

  it("never ULP-clamps a deficit when either aggregate is an integer", () => {
    const cases = [
      {
        demand: 1_000_000_000_000_000,
        capacity: 999_999_999_999_999.9,
      },
      {
        demand: 1_000_000_000_000_000.1,
        capacity: 1_000_000_000_000_000,
      },
      {
        demand: 0.3,
        capacity: 0.3 - Number.EPSILON,
      },
    ];
    for (let index = 0; index < cases.length; index += 1) {
      const values = cases[index]!;
      const participants = [
        generator(10, 0, 0, values.capacity),
        consumer(11, 0, 0, values.demand),
      ];
      const topology = rebuildPowerTopology(
        [relay(1, 0, 0)],
        participants,
      );
      const strict = dispatchPower(topology, participants);
      expect(strict.networks[0]?.satisfaction).toBe(
        values.capacity / values.demand,
      );
      expect(strict.networks[0]?.satisfaction).toBeLessThan(1);
      expect(strict.globalSatisfaction).toBe(
        values.capacity / values.demand,
      );
      expect(strict.globalSatisfaction).toBeLessThan(1);

      const plan = preparePowerDispatch(
        topology,
        participants.map(({ id, role }) => ({ id, role })),
      );
      const workspace = createPowerDispatchWorkspace(plan);
      dispatchPreparedPowerInto(
        plan,
        dynamicScalarsFor(plan, participants),
        workspace,
      );
      expect(preparedDispatchSnapshot(plan, workspace)).toEqual(strict);
    }

    const decimalEqualityParticipants = [
      generator(20, 0, 0, 0.3),
      consumer(21, 0, 0, 0.1 + 0.2),
    ];
    const decimalEqualityTopology = rebuildPowerTopology(
      [relay(2, 0, 0)],
      decimalEqualityParticipants,
    );
    const decimalEqualityPlan = preparePowerDispatch(
      decimalEqualityTopology,
      decimalEqualityParticipants.map(({ id, role }) => ({ id, role })),
    );
    const decimalEqualityWorkspace =
      createPowerDispatchWorkspace(decimalEqualityPlan);
    dispatchPreparedPowerInto(
      decimalEqualityPlan,
      dynamicScalarsFor(
        decimalEqualityPlan,
        decimalEqualityParticipants,
      ),
      decimalEqualityWorkspace,
    );
    expect(
      decimalEqualityWorkspace.networkSatisfaction[0],
    ).toBe(1);
    expect(decimalEqualityWorkspace.globalSatisfaction).toBe(1);
  });

  it("canonicalizes negative-zero scalars and every runtime output", () => {
    const participants = [
      generator(10, -0, -0, -0),
      consumer(11, 0, 0, -0),
      generator(12, 100, 100, -0),
      consumer(13, -100, -100, -0),
    ];
    const topology = rebuildPowerTopology(
      [relay(1, -0, 0), relay(2, 0, -0)],
      participants,
    );
    const dispatch = dispatchPower(topology, participants);
    expectNoNegativeZero(topology);
    expectNoNegativeZero(dispatch);
    expect(dispatch.networks[0]).toMatchObject({
      demand: 0,
      availableCapacity: 0,
      usedCapacity: 0,
      satisfaction: 1,
    });
    expect(dispatch.consumerSatisfaction).toEqual([
      [11, 1],
      [13, 0],
    ]);
    expect(dispatch.generatorOutput).toEqual([
      [10, 0],
      [12, 0],
    ]);
    expect(dispatch.globalSatisfaction).toBe(1);
  });

  it("requires the dispatch participant set and roles to match topology", () => {
    const participants: PowerParticipant[] = [
      generator(10, 0, 0, 20),
      consumer(11, 0, 0, 10),
    ];
    const topology = rebuildPowerTopology([relay(1, 0, 0)], participants);
    expect(() => dispatchPower(topology, [participants[0]!])).toThrow(
      "does not match",
    );
    expect(() =>
      dispatchPower(topology, [
        generator(10, 0, 0, 20),
        passive(11, 0, 0),
      ])
    ).toThrow("roles do not match");
  });
});

describe("prepared power dispatch", () => {
  it("prepares canonical detached slots and a complete safe workspace", () => {
    const participants: PowerParticipant[] = [
      passive(40, 0, 0),
      consumer(31, 100, 100, 7),
      generator(30, 50, 0, 13),
      consumer(11, 0, 0, 5),
      generator(10, 0, 0, 9),
    ];
    const topology = rebuildPowerTopology(
      [relay(3, 50, 0), relay(2, 6, 0), relay(1, 0, 0)],
      participants,
    );
    const identityInputs = participants
      .map(({ id, role }) => ({ id, role }))
      .reverse();
    const identitiesBefore = structuredClone(identityInputs);
    const plan = preparePowerDispatch(topology, identityInputs);

    expect(plan).toEqual({
      participantIds: [10, 11, 30, 31, 40],
      participantRoles: [
        "generator",
        "consumer",
        "generator",
        "consumer",
        "passive",
      ],
      networkIds: [1, 3],
      consumerIds: [11, 31],
      consumerNetworkIndices: [0, -1],
      generatorIds: [10, 30],
      generatorNetworkIndices: [0, 1],
    });
    expect(Object.isFrozen(plan)).toBe(true);
    for (const slots of Object.values(plan)) {
      expect(Object.isFrozen(slots)).toBe(true);
    }
    expect(identityInputs).toEqual(identitiesBefore);
    (
      identityInputs[0] as {
        id: number;
        role: PowerParticipant["role"];
      }
    ).id = 999;
    expect(plan.participantIds).toEqual([10, 11, 30, 31, 40]);
    expect(() => {
      (plan.consumerIds as number[]).push(999);
    }).toThrow();

    const workspace = createPowerDispatchWorkspace(plan);
    expect(Object.isExtensible(workspace)).toBe(true);
    expect(Object.isSealed(workspace)).toBe(false);
    expect(rawWorkspaceSnapshot(workspace)).toEqual({
      networkDemand: [0, 0],
      networkAvailableCapacity: [0, 0],
      networkUsedCapacity: [0, 0],
      networkSatisfaction: [1, 1],
      consumerSatisfaction: [0, 0],
      generatorOutput: [0, 0],
      totalDemand: 0,
      totalGeneratorCapacity: 0,
      totalUsedCapacity: 0,
      disconnectedDemand: 0,
      disconnectedGeneratorCapacity: 0,
      globalSatisfaction: 1,
    });
  });

  it("matches immutable dispatch exactly across randomized dynamic updates", () => {
    for (let fixtureIndex = 0; fixtureIndex < 24; fixtureIndex += 1) {
      const random = mulberry32(0x7100 + fixtureIndex);
      const relays: PowerRelayNode[] = [];
      for (let index = 0; index < 12; index += 1) {
        const isolated = index >= 10;
        relays.push(relay(
          1 + index,
          isolated ? 70 + (index - 10) * 6 : (index % 5) * 6,
          isolated ? 18 : Math.floor(index / 5) * 6,
        ));
      }
      const baseParticipants: PowerParticipant[] = [];
      for (let index = 0; index < 42; index += 1) {
        const id = 1_000 + index;
        const x = -8 + random() * 100;
        const y = -8 + random() * 40;
        if (index % 5 === 0) {
          baseParticipants.push(passive(id, x, y));
        } else if (index % 3 === 0) {
          baseParticipants.push(generator(id, x, y, 1));
        } else {
          baseParticipants.push(consumer(id, x, y, 1));
        }
      }
      const topology = rebuildPowerTopology(
        shuffled(relays, 0x8100 + fixtureIndex),
        shuffled(baseParticipants, 0x8200 + fixtureIndex),
      );
      const identityInputs = shuffled(
        baseParticipants.map(({ id, role }) => ({ id, role })),
        0x8300 + fixtureIndex,
      );
      const plan = preparePowerDispatch(topology, identityInputs);
      const workspace = createPowerDispatchWorkspace(plan);

      for (let update = 0; update < 7; update += 1) {
        const dynamicParticipants = baseParticipants.map((participant) => {
          if (participant.role === "consumer") {
            const selector = (participant.id + update) % 7;
            const demand = selector === 0
              ? -0
              : selector === 1
                ? 0.1 + 0.2
                : ((participant.id * 3 + update * 5) % 29) / 4;
            return { ...participant, demand };
          }
          if (participant.role === "generator") {
            const selector = (participant.id + update) % 6;
            const capacity = selector === 0
              ? -0
              : selector === 1
                ? 0.3
                : ((participant.id * 5 + update * 7) % 31) / 4;
            return { ...participant, capacity };
          }
          return { ...participant };
        });
        const scalars = dynamicScalarsFor(plan, dynamicParticipants);
        const scalarSnapshot = {
          consumerDemands: Array.from(scalars.consumerDemands),
          generatorCapacities: Array.from(scalars.generatorCapacities),
        };
        const returned = dispatchPreparedPowerInto(
          plan,
          scalars,
          workspace,
        );
        const strict = dispatchPower(
          topology,
          shuffled(
            dynamicParticipants,
            fixtureIndex * 100 + update,
          ),
        );

        expect(returned).toBe(workspace);
        expect(preparedDispatchSnapshot(plan, workspace)).toEqual(strict);
        expect({
          consumerDemands: Array.from(scalars.consumerDemands),
          generatorCapacities: Array.from(scalars.generatorCapacities),
        }).toEqual(scalarSnapshot);
        expectNoNegativeZero(rawWorkspaceSnapshot(workspace));
      }
    }
  });

  it("fully overwrites one workspace across large, zero, and changed loads", () => {
    const participants: PowerParticipant[] = [
      generator(10, 0, 0, 90),
      consumer(11, 0, 0, 70),
      generator(20, 30, 0, 25),
      consumer(21, 30, 0, 100),
      consumer(22, 100, 100, 40),
      generator(23, -100, -100, 55),
    ];
    const topology = rebuildPowerTopology(
      [relay(1, 0, 0), relay(2, 30, 0)],
      participants,
    );
    const plan = preparePowerDispatch(
      topology,
      participants.map(({ id, role }) => ({ id, role })),
    );
    const workspace = createPowerDispatchWorkspace(plan);
    dispatchPreparedPowerInto(
      plan,
      dynamicScalarsFor(plan, participants),
      workspace,
    );
    expect(preparedDispatchSnapshot(plan, workspace)).toEqual(
      dispatchPower(topology, participants),
    );

    workspace.networkDemand.fill(999);
    workspace.networkAvailableCapacity.fill(999);
    workspace.networkUsedCapacity.fill(999);
    workspace.networkSatisfaction.fill(999);
    workspace.consumerSatisfaction.fill(999);
    workspace.generatorOutput.fill(999);
    workspace.totalDemand = 999;
    workspace.totalGeneratorCapacity = 999;
    workspace.totalUsedCapacity = 999;
    workspace.disconnectedDemand = 999;
    workspace.disconnectedGeneratorCapacity = 999;
    workspace.globalSatisfaction = 999;
    const zeroParticipants = participants.map((participant) => {
      if (participant.role === "consumer") {
        return { ...participant, demand: 0 };
      }
      if (participant.role === "generator") {
        return { ...participant, capacity: 0 };
      }
      return participant;
    });
    dispatchPreparedPowerInto(
      plan,
      dynamicScalarsFor(plan, zeroParticipants),
      workspace,
    );
    expect(preparedDispatchSnapshot(plan, workspace)).toEqual(
      dispatchPower(topology, zeroParticipants),
    );

    const changedParticipants = participants.map((participant) => {
      if (participant.role === "consumer") {
        return { ...participant, demand: participant.id % 9 };
      }
      if (participant.role === "generator") {
        return { ...participant, capacity: participant.id % 11 };
      }
      return participant;
    });
    dispatchPreparedPowerInto(
      plan,
      dynamicScalarsFor(plan, changedParticipants),
      workspace,
    );
    expect(preparedDispatchSnapshot(plan, workspace)).toEqual(
      dispatchPower(topology, changedParticipants),
    );
  });

  it("rejects foreign plans and workspaces without changing output", () => {
    const participants = [
      generator(10, 0, 0, 20),
      consumer(11, 0, 0, 10),
    ];
    const topology = rebuildPowerTopology([relay(1, 0, 0)], participants);
    const identities = participants.map(({ id, role }) => ({ id, role }));
    const planA = preparePowerDispatch(topology, identities);
    const planB = preparePowerDispatch(topology, identities);
    const workspaceA = createPowerDispatchWorkspace(planA);
    const workspaceB = createPowerDispatchWorkspace(planB);
    const scalarsA = dynamicScalarsFor(planA, participants);
    const scalarsB = dynamicScalarsFor(planB, participants);
    dispatchPreparedPowerInto(planA, scalarsA, workspaceA);
    const before = rawWorkspaceSnapshot(workspaceA);

    expect(() =>
      dispatchPreparedPowerInto(planB, scalarsB, workspaceA)
    ).toThrow("do not match");
    expect(rawWorkspaceSnapshot(workspaceA)).toEqual(before);
    expect(() =>
      dispatchPreparedPowerInto(planA, scalarsA, workspaceB)
    ).toThrow("do not match");
    expect(rawWorkspaceSnapshot(workspaceA)).toEqual(before);

    const forgedPlan = { ...planA };
    expect(() => createPowerDispatchWorkspace(forgedPlan)).toThrow(
      "was not created",
    );
    expect(() =>
      dispatchPreparedPowerInto(
        forgedPlan,
        scalarsA,
        workspaceA,
      )
    ).toThrow("was not created");
    expect(rawWorkspaceSnapshot(workspaceA)).toEqual(before);
  });

  it("makes every validation and overflow failure atomic", () => {
    const participants = [
      generator(10, 0, 0, 20),
      consumer(11, 0, 0, 10),
      generator(12, 0, 0, 30),
      consumer(13, 0, 0, 15),
    ];
    const topology = rebuildPowerTopology([relay(1, 0, 0)], participants);
    const plan = preparePowerDispatch(
      topology,
      participants.map(({ id, role }) => ({ id, role })),
    );
    const workspace = createPowerDispatchWorkspace(plan);
    const valid = dynamicScalarsFor(plan, participants);
    dispatchPreparedPowerInto(plan, valid, workspace);
    const before = rawWorkspaceSnapshot(workspace);

    const invalidCalls: (() => void)[] = [
      () => dispatchPreparedPowerInto(
        plan,
        {
          consumerDemands: [10],
          generatorCapacities: valid.generatorCapacities,
        },
        workspace,
      ),
      () => dispatchPreparedPowerInto(
        plan,
        {
          consumerDemands: [Number.NaN, 1],
          generatorCapacities: valid.generatorCapacities,
        },
        workspace,
      ),
      () => dispatchPreparedPowerInto(
        plan,
        {
          consumerDemands: [-1, 1],
          generatorCapacities: valid.generatorCapacities,
        },
        workspace,
      ),
      () => dispatchPreparedPowerInto(
        plan,
        {
          consumerDemands: [Number.POSITIVE_INFINITY, 1],
          generatorCapacities: valid.generatorCapacities,
        },
        workspace,
      ),
      () => dispatchPreparedPowerInto(
        plan,
        {
          consumerDemands: [Number.MAX_SAFE_INTEGER + 1, 0],
          generatorCapacities: valid.generatorCapacities,
        },
        workspace,
      ),
      () => dispatchPreparedPowerInto(
        plan,
        {
          consumerDemands: [Number.MAX_SAFE_INTEGER, 1],
          generatorCapacities: valid.generatorCapacities,
        },
        workspace,
      ),
      () => dispatchPreparedPowerInto(
        plan,
        {
          consumerDemands: valid.consumerDemands,
          generatorCapacities: [Number.MAX_SAFE_INTEGER, 1],
        },
        workspace,
      ),
      () => dispatchPreparedPowerInto(
        plan,
        null as unknown as PreparedPowerDynamicScalars,
        workspace,
      ),
    ];
    for (const invalidCall of invalidCalls) {
      expect(invalidCall).toThrow();
      expect(rawWorkspaceSnapshot(workspace)).toEqual(before);
    }

    let reads = 0;
    const throwingDemands: ArrayLike<number> = {
      length: 2,
      get 0() {
        reads += 1;
        return 10;
      },
      get 1(): number {
        reads += 1;
        throw new Error("synthetic scalar read failure");
      },
    };
    expect(() =>
      dispatchPreparedPowerInto(
        plan,
        {
          consumerDemands: throwingDemands,
          generatorCapacities: valid.generatorCapacities,
        },
        workspace,
      )
    ).toThrow("synthetic scalar read failure");
    expect(reads).toBe(2);
    expect(rawWorkspaceSnapshot(workspace)).toEqual(before);
  });

  it("commits through captured intrinsics despite benign array shadows", () => {
    const fixture = preparedWorkspaceFixture();
    const shadowed = fixture.workspace.networkDemand;
    let shadowCalls = 0;
    Object.defineProperties(shadowed, {
      set: {
        configurable: true,
        value() {
          shadowCalls += 1;
          throw new Error("shadowed set must never run");
        },
      },
      length: { configurable: true, value: 999 },
      byteLength: { configurable: true, value: 999 },
      buffer: { configurable: true, value: new ArrayBuffer(8) },
      constructor: { configurable: true, value: Float32Array },
    });
    fixture.workspace.networkDemand[0] = 999;

    expect(() =>
      dispatchPreparedPowerInto(
        fixture.plan,
        fixture.scalars,
        fixture.workspace,
      )
    ).not.toThrow();
    expect(shadowCalls).toBe(0);
    expect(
      preparedDispatchSnapshot(fixture.plan, fixture.workspace),
    ).toEqual(
      dispatchPower(fixture.topology, fixture.participants),
    );
  });

  it("rejects every detached output buffer before any commit byte changes", () => {
    const outputNames = [
      "networkDemand",
      "networkAvailableCapacity",
      "networkUsedCapacity",
      "networkSatisfaction",
      "consumerSatisfaction",
      "generatorOutput",
    ] as const;
    for (const outputName of outputNames) {
      const fixture = preparedWorkspaceFixture();
      const references = outputNames.map(
        (property) => fixture.workspace[property],
      );
      const target = fixture.workspace[outputName];
      structuredClone(target.buffer, { transfer: [target.buffer] });
      const before = exactWorkspaceSnapshot(
        fixture.workspace,
        references,
      );

      expect(() =>
        dispatchPreparedPowerInto(
          fixture.plan,
          fixture.scalars,
          fixture.workspace,
        )
      ).toThrow(/live trusted|detached/);
      expectExactWorkspaceUnchanged(fixture.workspace, before);
    }
  });

  it("rejects sealed and frozen outer workspaces byte-for-byte", () => {
    for (const harden of [
      Object.seal,
      Object.freeze,
      Object.preventExtensions,
    ]) {
      const fixture = preparedWorkspaceFixture();
      harden(fixture.workspace);
      const before = exactWorkspaceSnapshot(fixture.workspace);
      expect(() =>
        dispatchPreparedPowerInto(
          fixture.plan,
          fixture.scalars,
          fixture.workspace,
        )
      ).toThrow(/frozen, sealed, or re-prototyped/);
      expectExactWorkspaceUnchanged(fixture.workspace, before);
    }
  });

  it("rejects accessor and nonwritable scalar outputs without invoking them", () => {
    for (const variant of ["accessor", "nonwritable"] as const) {
      const fixture = preparedWorkspaceFixture();
      let accessorCalls = 0;
      if (variant === "accessor") {
        Object.defineProperty(fixture.workspace, "totalDemand", {
          configurable: true,
          enumerable: true,
          get() {
            accessorCalls += 1;
            throw new Error("workspace getter must never run");
          },
          set() {
            accessorCalls += 1;
            throw new Error("workspace setter must never run");
          },
        });
      } else {
        Object.defineProperty(fixture.workspace, "totalDemand", {
          configurable: true,
          enumerable: true,
          value: fixture.workspace.totalDemand,
          writable: false,
        });
      }
      const before = exactWorkspaceSnapshot(fixture.workspace);
      expect(() =>
        dispatchPreparedPowerInto(
          fixture.plan,
          fixture.scalars,
          fixture.workspace,
        )
      ).toThrow("property totalDemand was redefined");
      expect(accessorCalls).toBe(0);
      expectExactWorkspaceUnchanged(fixture.workspace, before);
    }
  });

  it("rejects wrong typed-array constructors, lengths, and references", () => {
    const replacements = [
      (length: number): ArrayBufferView => new Float32Array(length),
      (length: number): ArrayBufferView => new Float64Array(length + 1),
      (length: number): ArrayBufferView => new Float64Array(length),
    ];
    for (const replacementFactory of replacements) {
      const fixture = preparedWorkspaceFixture();
      const originalReferences = [
        fixture.workspace.networkDemand,
        fixture.workspace.networkAvailableCapacity,
        fixture.workspace.networkUsedCapacity,
        fixture.workspace.networkSatisfaction,
        fixture.workspace.consumerSatisfaction,
        fixture.workspace.generatorOutput,
      ];
      const replacement = replacementFactory(
        fixture.workspace.networkDemand.length,
      );
      Object.defineProperty(fixture.workspace, "networkDemand", {
        configurable: true,
        enumerable: true,
        value: replacement,
        writable: true,
      });
      const before = exactWorkspaceSnapshot(
        fixture.workspace,
        [...originalReferences, replacement],
      );
      expect(() =>
        dispatchPreparedPowerInto(
          fixture.plan,
          fixture.scalars,
          fixture.workspace,
        )
      ).toThrow("property networkDemand was redefined");
      expectExactWorkspaceUnchanged(fixture.workspace, before);
    }
  });

  it("rechecks workspace integrity after dynamic scalar getters run", () => {
    {
      const fixture = preparedWorkspaceFixture();
      const demands = Array.from(fixture.scalars.consumerDemands);
      const mutatingDemands: ArrayLike<number> = {
        length: demands.length,
        get 0() {
          fixture.workspace.networkDemand.fill(999);
          fixture.workspace.networkAvailableCapacity.fill(999);
          fixture.workspace.networkUsedCapacity.fill(999);
          fixture.workspace.networkSatisfaction.fill(999);
          fixture.workspace.consumerSatisfaction.fill(999);
          fixture.workspace.generatorOutput.fill(999);
          fixture.workspace.totalDemand = 999;
          return demands[0]!;
        },
        get 1() {
          return demands[1]!;
        },
      };
      dispatchPreparedPowerInto(
        fixture.plan,
        {
          consumerDemands: mutatingDemands,
          generatorCapacities: fixture.scalars.generatorCapacities,
        },
        fixture.workspace,
      );
      expect(
        preparedDispatchSnapshot(fixture.plan, fixture.workspace),
      ).toEqual(
        dispatchPower(fixture.topology, fixture.participants),
      );
    }

    {
      const fixture = preparedWorkspaceFixture();
      const references = [
        fixture.workspace.networkDemand,
        fixture.workspace.networkAvailableCapacity,
        fixture.workspace.networkUsedCapacity,
        fixture.workspace.networkSatisfaction,
        fixture.workspace.consumerSatisfaction,
        fixture.workspace.generatorOutput,
      ];
      let sabotaged: ExactWorkspaceSnapshot | undefined;
      const demands = Array.from(fixture.scalars.consumerDemands);
      const detachingDemands: ArrayLike<number> = {
        length: demands.length,
        get 0() {
          const buffer = fixture.workspace.generatorOutput.buffer;
          structuredClone(buffer, { transfer: [buffer] });
          sabotaged = exactWorkspaceSnapshot(
            fixture.workspace,
            references,
          );
          return demands[0]!;
        },
        get 1() {
          return demands[1]!;
        },
      };
      expect(() =>
        dispatchPreparedPowerInto(
          fixture.plan,
          {
            consumerDemands: detachingDemands,
            generatorCapacities: fixture.scalars.generatorCapacities,
          },
          fixture.workspace,
        )
      ).toThrow(/live trusted|detached/);
      expect(sabotaged).toBeDefined();
      expectExactWorkspaceUnchanged(fixture.workspace, sabotaged!);
    }

    {
      const fixture = preparedWorkspaceFixture();
      const references = [
        fixture.workspace.networkDemand,
        fixture.workspace.networkAvailableCapacity,
        fixture.workspace.networkUsedCapacity,
        fixture.workspace.networkSatisfaction,
        fixture.workspace.consumerSatisfaction,
        fixture.workspace.generatorOutput,
      ];
      let sabotaged: ExactWorkspaceSnapshot | undefined;
      let workspaceAccessorCalls = 0;
      const demands = Array.from(fixture.scalars.consumerDemands);
      const redefiningDemands: ArrayLike<number> = {
        length: demands.length,
        get 0() {
          Object.defineProperty(fixture.workspace, "totalDemand", {
            configurable: true,
            enumerable: true,
            get() {
              workspaceAccessorCalls += 1;
              return -1;
            },
            set() {
              workspaceAccessorCalls += 1;
            },
          });
          sabotaged = exactWorkspaceSnapshot(
            fixture.workspace,
            references,
          );
          return demands[0]!;
        },
        get 1() {
          return demands[1]!;
        },
      };
      expect(() =>
        dispatchPreparedPowerInto(
          fixture.plan,
          {
            consumerDemands: redefiningDemands,
            generatorCapacities: fixture.scalars.generatorCapacities,
          },
          fixture.workspace,
        )
      ).toThrow("property totalDemand was redefined");
      expect(workspaceAccessorCalls).toBe(0);
      expect(sabotaged).toBeDefined();
      expectExactWorkspaceUnchanged(fixture.workspace, sabotaged!);
    }
  });

  it("survives Float64Array prototype monkeypatches after import", () => {
    const fixture = preparedWorkspaceFixture();
    const dynamicScalars = {
      consumerDemands: Array.from(fixture.scalars.consumerDemands),
      generatorCapacities:
        Array.from(fixture.scalars.generatorCapacities),
    };
    const typedArrayPrototype = Object.getPrototypeOf(
      Float64Array.prototype,
    );
    const originalSet = Object.getOwnPropertyDescriptor(
      typedArrayPrototype,
      "set",
    )!;
    const originalFill = Object.getOwnPropertyDescriptor(
      typedArrayPrototype,
      "fill",
    )!;
    let monkeypatchCalls = 0;
    const throwing = () => {
      monkeypatchCalls += 1;
      throw new Error("post-import monkeypatch must never run");
    };
    try {
      Object.defineProperty(
        typedArrayPrototype,
        "set",
        { ...originalSet, value: throwing },
      );
      Object.defineProperty(
        typedArrayPrototype,
        "fill",
        { ...originalFill, value: throwing },
      );
      dispatchPreparedPowerInto(
        fixture.plan,
        dynamicScalars,
        fixture.workspace,
      );
    } finally {
      Object.defineProperty(
        typedArrayPrototype,
        "set",
        originalSet,
      );
      Object.defineProperty(
        typedArrayPrototype,
        "fill",
        originalFill,
      );
    }
    expect(monkeypatchCalls).toBe(0);
    expect(
      preparedDispatchSnapshot(fixture.plan, fixture.workspace),
    ).toEqual(
      dispatchPower(fixture.topology, fixture.participants),
    );
  });

  it("never exposes private staging through post-import WeakMap monkeypatches", () => {
    const weakMapPrototype = WeakMap.prototype;
    const originalGet = Object.getOwnPropertyDescriptor(
      weakMapPrototype,
      "get",
    )!;
    const originalSet = Object.getOwnPropertyDescriptor(
      weakMapPrototype,
      "set",
    )!;
    let monkeypatchCalls = 0;
    let leakedInternal: {
      stagedNetworkDemand?: Float64Array;
      networkDemand?: Float64Array;
    } | undefined;
    let workspace:
      | PreparedPowerDispatchWorkspace
      | undefined;
    let plan: PreparedPowerDispatchPlan | undefined;
    let invalidDispatchError: unknown;
    let beforeInvalid: ExactWorkspaceSnapshot | undefined;
    const originalGetFunction = originalGet.value as (
      this: WeakMap<object, unknown>,
      key: object,
    ) => unknown;
    const originalSetFunction = originalSet.value as (
      this: WeakMap<object, unknown>,
      key: object,
      value: unknown,
    ) => WeakMap<object, unknown>;

    try {
      Object.defineProperty(weakMapPrototype, "get", {
        ...originalGet,
        value(this: WeakMap<object, unknown>, key: object) {
          monkeypatchCalls += 1;
          const value = Reflect.apply(
            originalGetFunction,
            this,
            [key],
          );
          if (
            typeof value === "object"
            && value !== null
            && "stagedNetworkDemand" in value
          ) {
            leakedInternal = value as typeof leakedInternal;
          }
          return value;
        },
      });
      Object.defineProperty(weakMapPrototype, "set", {
        ...originalSet,
        value(
          this: WeakMap<object, unknown>,
          key: object,
          value: unknown,
        ) {
          monkeypatchCalls += 1;
          if (
            typeof value === "object"
            && value !== null
            && "stagedNetworkDemand" in value
          ) {
            leakedInternal = value as typeof leakedInternal;
          }
          return Reflect.apply(
            originalSetFunction,
            this,
            [key, value],
          );
        },
      });

      const participants = [
        generator(10, 0, 0, 20),
        consumer(11, 0, 0, 7),
        generator(12, 30, 0, 20),
        consumer(13, 30, 0, 5),
      ];
      const topology = rebuildPowerTopology(
        [relay(1, 0, 0), relay(2, 30, 0)],
        participants,
      );
      plan = preparePowerDispatch(
        topology,
        participants.map(({ id, role }) => ({ id, role })),
      );
      workspace = createPowerDispatchWorkspace(plan);
      const validScalars = dynamicScalarsFor(plan, participants);
      dispatchPreparedPowerInto(plan, validScalars, workspace);

      // This is the auditor's exact alias attempt. It can only run if a
      // monkeypatched WeakMap method receives the supposedly private record.
      if (leakedInternal) {
        try {
          leakedInternal.stagedNetworkDemand =
            leakedInternal.networkDemand;
        } catch {
          // Frozen metadata is the second line of defense.
        }
      }
      beforeInvalid = exactWorkspaceSnapshot(workspace);
      try {
        dispatchPreparedPowerInto(
          plan,
          {
            consumerDemands: [99, -1],
            generatorCapacities: validScalars.generatorCapacities,
          },
          workspace,
        );
      } catch (error) {
        invalidDispatchError = error;
      }
    } finally {
      Object.defineProperty(
        weakMapPrototype,
        "get",
        originalGet,
      );
      Object.defineProperty(
        weakMapPrototype,
        "set",
        originalSet,
      );
    }

    expect(monkeypatchCalls).toBe(0);
    expect(leakedInternal).toBeUndefined();
    expect(invalidDispatchError).toBeInstanceOf(RangeError);
    expect(plan).toBeDefined();
    expect(workspace).toBeDefined();
    expect(beforeInvalid).toBeDefined();
    expectExactWorkspaceUnchanged(workspace!, beforeInvalid!);
    expect(Array.from(workspace!.networkDemand)).toEqual([7, 5]);
    expect(workspace!.totalDemand).toBe(12);
  });

  it("validates identities once before preparing a plan", () => {
    const participants: PowerParticipant[] = [
      generator(10, 0, 0, 20),
      consumer(11, 0, 0, 10),
    ];
    const topology = rebuildPowerTopology([relay(1, 0, 0)], participants);
    expect(() =>
      preparePowerDispatch(topology, [
        { id: 10, role: "generator" },
      ])
    ).toThrow("do not match");
    expect(() =>
      preparePowerDispatch(topology, [
        { id: 10, role: "generator" },
        { id: 10, role: "consumer" },
      ])
    ).toThrow("Duplicate");
    expect(() =>
      preparePowerDispatch(topology, [
        { id: 10, role: "generator" },
        { id: 11, role: "passive" },
      ])
    ).toThrow("roles do not match");
  });

  it("snapshots identity and dynamic collection accessors exactly once", () => {
    const participants: PowerParticipant[] = [
      generator(10, 0, 0, 20),
      consumer(11, 0, 0, 10),
      passive(12, 0, 0),
    ];
    const topology = rebuildPowerTopology([relay(1, 0, 0)], participants);
    const reads = new Map<string, number>();
    const once = <Value>(label: string, value: Value): (() => Value) => () => {
      const count = (reads.get(label) ?? 0) + 1;
      reads.set(label, count);
      if (count > 1) throw new Error(`SECOND_READ:${label}`);
      return value;
    };
    const identity = (
      id: number,
      role: PowerParticipant["role"],
    ) => {
      const readId = once(`identity.${id}.id`, id);
      const readRole = once(`identity.${id}.role`, role);
      return {
        get id() {
          return readId();
        },
        get role() {
          return readRole();
        },
      };
    };
    const identityInputs = [
      identity(12, "passive"),
      identity(11, "consumer"),
      identity(10, "generator"),
    ];
    let hostileMapCalls = 0;
    Object.defineProperty(identityInputs, "map", {
      configurable: true,
      value() {
        hostileMapCalls += 1;
        throw new Error("CALLER_MAP_MUST_NOT_RUN");
      },
    });
    const plan = preparePowerDispatch(topology, identityInputs);

    const readConsumerLength = once("consumer.length", 1);
    const readConsumerValue = once("consumer.0", 10);
    const consumerDemands = {
      get length() {
        return readConsumerLength();
      },
      get 0() {
        return readConsumerValue();
      },
    };
    const readGeneratorLength = once("generator.length", 1);
    const readGeneratorValue = once("generator.0", 20);
    const generatorCapacities = {
      get length() {
        return readGeneratorLength();
      },
      get 0() {
        return readGeneratorValue();
      },
    };
    const readConsumerCollection = once(
      "dynamic.consumerDemands",
      consumerDemands,
    );
    const readGeneratorCollection = once(
      "dynamic.generatorCapacities",
      generatorCapacities,
    );
    const workspace = createPowerDispatchWorkspace(plan);
    dispatchPreparedPowerInto(
      plan,
      {
        get consumerDemands() {
          return readConsumerCollection();
        },
        get generatorCapacities() {
          return readGeneratorCollection();
        },
      },
      workspace,
    );

    expect(hostileMapCalls).toBe(0);
    expect(Object.fromEntries(reads)).toEqual({
      "identity.12.id": 1,
      "identity.12.role": 1,
      "identity.11.id": 1,
      "identity.11.role": 1,
      "identity.10.id": 1,
      "identity.10.role": 1,
      "consumer.length": 1,
      "consumer.0": 1,
      "generator.length": 1,
      "generator.0": 1,
      "dynamic.consumerDemands": 1,
      "dynamic.generatorCapacities": 1,
    });
    expect(workspace.totalDemand).toBe(10);
    expect(workspace.totalGeneratorCapacity).toBe(20);
    expect(workspace.totalUsedCapacity).toBe(10);
    expect(Array.from(workspace.consumerSatisfaction)).toEqual([1]);
    expect(Array.from(workspace.generatorOutput)).toEqual([10]);
  });
});

describe("power topology validation and immutability", () => {
  it("snapshots relay and strict-dispatch participant accessors exactly once", () => {
    const reads = new Map<string, number>();
    const once = <Value>(label: string, value: Value): (() => Value) => () => {
      const count = (reads.get(label) ?? 0) + 1;
      reads.set(label, count);
      if (count > 1) throw new Error(`SECOND_READ:${label}`);
      return value;
    };

    const readRelayId = once("relay.id", 1);
    const readRelayX = once("relay.center.x", 0);
    const readRelayY = once("relay.center.y", 0);
    const relayCenter = {
      get x() {
        return readRelayX();
      },
      get y() {
        return readRelayY();
      },
    };
    const readRelayCenter = once("relay.center", relayCenter);
    const accessorRelay = {
      get id() {
        return readRelayId();
      },
      get center() {
        return readRelayCenter();
      },
    };
    const plainParticipants: PowerParticipant[] = [
      generator(10, 0, 0, 20),
      consumer(11, 0, 0, 10),
      passive(12, 0, 0),
    ];
    const relayInputs = [accessorRelay];
    let hostileMapCalls = 0;
    Object.defineProperty(relayInputs, "map", {
      configurable: true,
      value() {
        hostileMapCalls += 1;
        throw new Error("CALLER_MAP_MUST_NOT_RUN");
      },
    });
    const topology = rebuildPowerTopology(relayInputs, plainParticipants);

    const accessorParticipant = (
      participant: PowerParticipant,
    ): PowerParticipant => {
      const prefix = `participant.${participant.id}`;
      const readId = once(`${prefix}.id`, participant.id);
      const readCenterX = once(`${prefix}.center.x`, participant.center.x);
      const readCenterY = once(`${prefix}.center.y`, participant.center.y);
      const center = {
        get x() {
          return readCenterX();
        },
        get y() {
          return readCenterY();
        },
      };
      const readCenter = once(`${prefix}.center`, center);
      const readRole = once(`${prefix}.role`, participant.role);
      const snapshot = {
        get id() {
          return readId();
        },
        get center() {
          return readCenter();
        },
        get role() {
          return readRole();
        },
      };
      if (participant.role === "consumer") {
        const readDemand = once(`${prefix}.demand`, participant.demand);
        Object.defineProperty(snapshot, "demand", {
          configurable: true,
          enumerable: true,
          get: readDemand,
        });
      } else if (participant.role === "generator") {
        const readCapacity = once(`${prefix}.capacity`, participant.capacity);
        Object.defineProperty(snapshot, "capacity", {
          configurable: true,
          enumerable: true,
          get: readCapacity,
        });
      }
      return snapshot as PowerParticipant;
    };
    const dispatchInputs = [
      accessorParticipant(plainParticipants[2]!),
      accessorParticipant(plainParticipants[1]!),
      accessorParticipant(plainParticipants[0]!),
    ];
    Object.defineProperty(dispatchInputs, "map", {
      configurable: true,
      value() {
        hostileMapCalls += 1;
        throw new Error("CALLER_MAP_MUST_NOT_RUN");
      },
    });
    const dispatch = dispatchPower(topology, dispatchInputs);

    expect(hostileMapCalls).toBe(0);
    expect(Object.fromEntries(reads)).toEqual({
      "relay.id": 1,
      "relay.center": 1,
      "relay.center.x": 1,
      "relay.center.y": 1,
      "participant.12.id": 1,
      "participant.12.center": 1,
      "participant.12.center.x": 1,
      "participant.12.center.y": 1,
      "participant.12.role": 1,
      "participant.11.id": 1,
      "participant.11.center": 1,
      "participant.11.center.x": 1,
      "participant.11.center.y": 1,
      "participant.11.role": 1,
      "participant.11.demand": 1,
      "participant.10.id": 1,
      "participant.10.center": 1,
      "participant.10.center.x": 1,
      "participant.10.center.y": 1,
      "participant.10.role": 1,
      "participant.10.capacity": 1,
    });
    expect(dispatch.totalDemand).toBe(10);
    expect(dispatch.totalGeneratorCapacity).toBe(20);
    expect(dispatch.totalUsedCapacity).toBe(10);
    expect(dispatch.consumerSatisfaction).toEqual([[11, 1]]);
    expect(dispatch.generatorOutput).toEqual([[10, 10]]);
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid IDs (%s)", (id) => {
    expect(() => rebuildPowerTopology([relay(id, 0, 0)], [])).toThrow(
      "positive safe integer",
    );
    expect(() =>
      rebuildPowerTopology(
        [],
        [consumer(id, 0, 0)],
      )
    ).toThrow("positive safe integer");
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])("rejects non-finite centers (%s)", (coordinate) => {
    expect(() =>
      rebuildPowerTopology([relay(1, coordinate, 0)], [])
    ).toThrow("finite");
    expect(() =>
      rebuildPowerTopology([], [consumer(2, 0, coordinate)])
    ).toThrow("finite");
  });

  it("rejects duplicate IDs within and across input collections", () => {
    expect(() =>
      rebuildPowerTopology(
        [relay(1, 0, 0), relay(1, 10, 0)],
        [],
      )
    ).toThrow("Duplicate power node id 1");
    expect(() =>
      rebuildPowerTopology(
        [relay(1, 0, 0)],
        [consumer(1, 0, 0)],
      )
    ).toThrow("Duplicate power node id 1");
    expect(() =>
      rebuildPowerTopology(
        [],
        [consumer(2, 0, 0), generator(2, 0, 0)],
      )
    ).toThrow("Duplicate power node id 2");
  });

  it.each([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid demand and capacity scalars (%s)", (value) => {
    expect(() =>
      rebuildPowerTopology(
        [],
        [consumer(1, 0, 0, value)],
      )
    ).toThrow("finite, nonnegative");
    expect(() =>
      rebuildPowerTopology(
        [],
        [generator(1, 0, 0, value)],
      )
    ).toThrow("finite, nonnegative");
  });

  it("rejects invalid runtime roles", () => {
    expect(() =>
      rebuildPowerTopology(
        [],
        [{
          id: 1,
          center: { x: 0, y: 0 },
          role: "battery",
        } as unknown as PowerParticipant],
      )
    ).toThrow("invalid power role");
  });

  it("rejects unsafe demand and capacity sums", () => {
    const demandParticipants = [
      consumer(10, 0, 0, Number.MAX_SAFE_INTEGER),
      consumer(11, 0, 0, 1),
    ];
    const demandTopology = rebuildPowerTopology(
      [relay(1, 0, 0)],
      demandParticipants,
    );
    expect(() =>
      dispatchPower(demandTopology, demandParticipants)
    ).toThrow("safe numeric range");

    const capacityParticipants = [
      generator(20, 0, 0, Number.MAX_SAFE_INTEGER),
      generator(21, 0, 0, 1),
    ];
    const capacityTopology = rebuildPowerTopology(
      [relay(2, 0, 0)],
      capacityParticipants,
    );
    expect(() =>
      dispatchPower(capacityTopology, capacityParticipants)
    ).toThrow("safe numeric range");
  });

  it("snapshots every participant field once before graph work", () => {
    const reads: string[] = [];
    const accessorParticipant = (
      id: number,
      role: PowerParticipant["role"],
      scalar: number,
    ): PowerParticipant => {
      const center = {
        get x() {
          reads.push(`${id}.center.x`);
          return id - 10;
        },
        get y() {
          reads.push(`${id}.center.y`);
          return 0;
        },
      };
      const participant = {
        get id() {
          reads.push(`${id}.id`);
          return id;
        },
        get center() {
          reads.push(`${id}.center`);
          return center;
        },
        get role() {
          reads.push(`${id}.role`);
          return role;
        },
      };
      if (role === "consumer") {
        Object.defineProperty(participant, "demand", {
          configurable: true,
          enumerable: true,
          get() {
            reads.push(`${id}.demand`);
            return scalar;
          },
        });
      } else if (role === "generator") {
        Object.defineProperty(participant, "capacity", {
          configurable: true,
          enumerable: true,
          get() {
            reads.push(`${id}.capacity`);
            return scalar;
          },
        });
      }
      return participant as PowerParticipant;
    };
    const participants = [
      accessorParticipant(10, "generator", 20),
      accessorParticipant(11, "consumer", 10),
      accessorParticipant(12, "passive", 0),
    ];
    const topology = rebuildPowerTopology(
      [relay(1, 0, 0), relay(2, 6, 0)],
      participants,
    );

    expect(reads).toEqual([
      "10.id",
      "10.center",
      "10.center.x",
      "10.center.y",
      "10.role",
      "10.capacity",
      "11.id",
      "11.center",
      "11.center.x",
      "11.center.y",
      "11.role",
      "11.demand",
      "12.id",
      "12.center",
      "12.center.x",
      "12.center.y",
      "12.role",
    ]);
    expect(topology.participantRoles).toEqual([
      [10, "generator"],
      [11, "consumer"],
      [12, "passive"],
    ]);
    expect(topology.participantToRelay).toEqual([
      [10, 1],
      [11, 1],
      [12, null],
    ]);
  });

  it("never mutates inputs and returns deeply frozen copy-safe output", () => {
    const relays = [
      relay(2, 4, 0),
      relay(1, 0, 0),
    ];
    const participants: PowerParticipant[] = [
      consumer(11, 1, 0, 8),
      generator(10, 0, 0, 12),
      passive(12, 2, 0),
    ];
    const relaysBefore = structuredClone(relays);
    const participantsBefore = structuredClone(participants);
    const topology = rebuildPowerTopology(relays, participants);
    const dispatch = dispatchPower(topology, participants);
    expect(relays).toEqual(relaysBefore);
    expect(participants).toEqual(participantsBefore);

    expect(Object.isFrozen(topology)).toBe(true);
    expect(Object.isFrozen(topology.links)).toBe(true);
    expect(Object.isFrozen(topology.links[0])).toBe(true);
    expect(Object.isFrozen(topology.relayAdjacency)).toBe(true);
    expect(Object.isFrozen(topology.relayAdjacency[0])).toBe(true);
    expect(Object.isFrozen(topology.relayAdjacency[0]?.[1])).toBe(true);
    expect(Object.isFrozen(topology.components[0])).toBe(true);
    expect(Object.isFrozen(topology.components[0]?.relayIds)).toBe(true);
    expect(Object.isFrozen(dispatch)).toBe(true);
    expect(Object.isFrozen(dispatch.networks)).toBe(true);
    expect(Object.isFrozen(dispatch.networks[0])).toBe(true);
    expect(() => {
      (topology.links as unknown as { pop(): unknown }).pop();
    }).toThrow();
    expect(() => {
      (
        topology.relayAdjacency[0]?.[1] as unknown as {
          push(value: number): number;
        }
      ).push(999);
    }).toThrow();
    expect(relays).toEqual(relaysBefore);
    expect(participants).toEqual(participantsBefore);
  });
});

describe("power topology scale proof", () => {
  it("handles 512 relays and 5,000 participants through the spatial index", () => {
    const fixture = scaleFixture();
    const topology = rebuildPowerTopology(
      fixture.relays,
      fixture.participants,
    );
    const dispatch = dispatchPower(topology, fixture.participants);
    const repeated = rebuildPowerTopology(
      shuffled(fixture.relays, 0x901),
      shuffled(fixture.participants, 0x902),
    );
    const repeatedDispatch = dispatchPower(
      repeated,
      shuffled(fixture.participants, 0x903),
    );

    expect(fixture.relays).toHaveLength(512);
    expect(fixture.participants).toHaveLength(5_000);
    const intersectingCoverageCells = fixture.participants.reduce(
      (total, participant) => {
        if (participant.role === "passive") return total;
        const axisCount = (coordinate: number): number => {
          const minimum = Math.floor(
            (coordinate - POWER_SUPPLY_HALF_EXTENT_TILES)
            / POWER_CABLE_REACH_TILES,
          );
          const center = Math.floor(
            coordinate / POWER_CABLE_REACH_TILES,
          );
          const maximum = Math.floor(
            (coordinate + POWER_SUPPLY_HALF_EXTENT_TILES)
            / POWER_CABLE_REACH_TILES,
          );
          return new Set([minimum, center, maximum]).size;
        };
        return total
          + axisCount(participant.center.x)
          * axisCount(participant.center.y);
      },
      0,
    );
    expect(intersectingCoverageCells).toBe(21_660);
    expect(intersectingCoverageCells).toBeLessThan(4_000 * 9);
    expect(topology.candidatePairCount).toBe(976);
    expect(topology.candidatePairCount).toBeLessThan(
      512 * 511 / 2 / 100,
    );
    expect(topology.links.length).toBe(976);
    expect(topology.links.length).toBeLessThanOrEqual(
      512 * POWER_MAX_LINKS_PER_RELAY / 2,
    );
    expectCanonicalSymmetricGraph(topology);
    expectTriangleFree(topology);
    expect(JSON.stringify(repeated)).toBe(JSON.stringify(topology));
    expect(JSON.stringify(repeatedDispatch)).toBe(JSON.stringify(dispatch));
    expect(canonicalPowerTopologyHash(repeated)).toBe(
      canonicalPowerTopologyHash(topology),
    );
    expect(canonicalPowerTopologyHash(topology)).toBe("7577e7d4");
    expect(dispatch.consumerSatisfaction).toHaveLength(3_000);
    expect(dispatch.generatorOutput).toHaveLength(1_000);

    const runtimeProcess = (
      globalThis as unknown as {
        process?: { env?: Record<string, string | undefined> };
      }
    ).process;
    if (runtimeProcess?.env?.POWER_TOPOLOGY_BENCHMARK === "1") {
      const metrics = benchmarkPowerTopology(
        fixture.relays,
        fixture.participants,
        { warmupSamples: 8, samples: 40 },
      );
      console.info(
        `[power-topology-benchmark] ${JSON.stringify(metrics)}`,
      );
      const preparedMetrics = benchmarkPreparedPowerDispatch(
        topology,
        fixture.participants,
        { warmupSamples: 8, samples: 40 },
      );
      console.info(
        `[prepared-power-dispatch-benchmark] ${
          JSON.stringify(preparedMetrics)
        }`,
      );
    }
  });
});
