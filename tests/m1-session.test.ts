import { describe, expect, it, vi } from "vitest";

import {
  commissionGuidance,
  MOBILE_POWER_RELAY_GUIDANCE,
  readStorage,
  removeStorage,
  sessionStartupNotice,
  writeVerifiedStorage,
  type BrowserStorage,
} from "../src/ui/m1Session";

function memoryStorage(): BrowserStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("M1 session storage boundaries", () => {
  it("returns explicit read, write, verify, and remove failures", () => {
    const denied = {
      getItem: vi.fn(() => {
        throw new DOMException("denied", "SecurityError");
      }),
      setItem: vi.fn(() => {
        throw new DOMException("full", "QuotaExceededError");
      }),
      removeItem: vi.fn(() => {
        throw new DOMException("denied", "SecurityError");
      }),
    } satisfies BrowserStorage;

    expect(readStorage(denied, "save")).toMatchObject({
      ok: false,
      operation: "read",
      key: "save",
    });
    expect(writeVerifiedStorage(denied, "save", "bytes")).toMatchObject({
      ok: false,
      operation: "write",
      key: "save",
    });
    expect(removeStorage(denied, "save")).toMatchObject({
      ok: false,
      operation: "remove",
      key: "save",
    });

    const discarded = {
      ...memoryStorage(),
      setItem: vi.fn(),
    } satisfies BrowserStorage;
    expect(writeVerifiedStorage(discarded, "save", "bytes")).toMatchObject({
      ok: false,
      operation: "verify",
      key: "save",
    });
  });

  it("only reports a verified write after the exact bytes round-trip", () => {
    const storage = memoryStorage();
    expect(writeVerifiedStorage(storage, "save", "exact-bytes")).toEqual({
      ok: true,
      value: undefined,
    });
    expect(readStorage(storage, "save")).toEqual({
      ok: true,
      value: "exact-bytes",
    });
    expect(removeStorage(storage, "save")).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("surfaces degraded and recovered persistence without blocking play", () => {
    expect(sessionStartupNotice("volatile")).toMatchObject({
      label: "LOCAL SAVE OFFLINE",
    });
    expect(sessionStartupNotice("recovered").detail).toContain("preserved");
  });
});

describe("M1 first-contract guidance", () => {
  it("gives explicit small-screen power recovery and relay guidance", () => {
    expect(MOBILE_POWER_RELAY_GUIDANCE).toContain("No power");
    expect(MOBILE_POWER_RELAY_GUIDANCE).toContain("Grid relays");
    expect(MOBILE_POWER_RELAY_GUIDANCE).toContain("fueled generator");
    expect(MOBILE_POWER_RELAY_GUIDANCE).toContain("hand-prime coal");
  });

  it("names the missing starter handoff before any cargo arrives", () => {
    expect(
      commissionGuidance({
        commissionId: "bootstrap",
        objectiveCurrent: [0, 0, 0],
        objectiveTargets: [24, 12, 12],
      }),
    ).toContain("smelter output");
    expect(
      commissionGuidance({
        commissionId: "bootstrap",
        objectiveCurrent: [0, 0, 0],
        objectiveTargets: [24, 12, 12],
      }),
    ).toContain("pulsing cyan DOCK tile");
    expect(
      commissionGuidance({
        commissionId: "bootstrap",
        objectiveCurrent: [0, 0, 0],
        objectiveTargets: [24, 12, 12],
      }),
    ).toContain("X21 Z12");
    expect(
      commissionGuidance({
        commissionId: "bootstrap",
        objectiveCurrent: [0, 0, 0],
        objectiveTargets: [24, 12, 12],
      }),
    ).toContain("auto-aligns eastbound");
  });

  it("switches from routing to transmit guidance at authoritative counts", () => {
    expect(
      commissionGuidance({
        commissionId: "bootstrap",
        objectiveCurrent: [3, 0, 0],
        objectiveTargets: [24, 12, 12],
      }),
    ).toContain("receiving cargo");
    expect(
      commissionGuidance({
        commissionId: "bootstrap",
        objectiveCurrent: [24, 12, 12],
        objectiveTargets: [24, 12, 12],
      }),
    ).toContain("Transmit manifest");
  });
});

describe("M1 earned-alloy Phase-2 guidance", () => {
  it("turns the post-Bootstrap pause into an explicit Throughput build order", () => {
    const guidance = commissionGuidance({
      commissionId: null,
      objectiveCurrent: [],
      objectiveTargets: [],
    });
    expect(guidance).toContain("choose Throughput");
    expect(guidance).toContain("automatic coal");
    expect(guidance).toContain("Precision Fabricator");
  });

  it("stages automatic fuel, gears, wire, and the next-tier reveal", () => {
    expect(
      commissionGuidance({
        commissionId: "throughput",
        objectiveCurrent: [0, 0],
        objectiveTargets: [20, 40],
      }),
    ).toContain("automate coal");
    expect(
      commissionGuidance({
        commissionId: "throughput",
        objectiveCurrent: [0, 0],
        objectiveTargets: [20, 40],
      }),
    ).toContain("configure Iron gear");

    const wireStage = commissionGuidance({
      commissionId: "throughput",
      objectiveCurrent: [20, 0],
      objectiveTargets: [20, 40],
    });
    expect(wireStage).toContain("Switch the same Precision Fabricator");
    expect(wireStage).toContain("Copper wire");
    expect(wireStage).toContain("mixed plate traffic");

    const ready = commissionGuidance({
      commissionId: "throughput",
      objectiveCurrent: [20, 40],
      objectiveTargets: [20, 40],
    });
    expect(ready).toContain("Dispatch manifolds");
    expect(ready).toContain("fluid-processing tier");
  });

  it("replaces the completed Throughput instruction with the unlocked next tier", () => {
    const guidance = commissionGuidance({
      commissionId: null,
      objectiveCurrent: [],
      objectiveTargets: [],
      completedCommissionIds: ["bootstrap", "throughput"],
    });
    expect(guidance).toContain("Throughput transmitted");
    expect(guidance).toContain("Dispatch manifolds");
    expect(guidance).toContain("fluid-processing tier");
    expect(guidance).not.toContain("choose Throughput");
  });
});
