export interface BrowserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type StorageOperation = "read" | "write" | "remove" | "verify";

export type StorageResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly operation: StorageOperation;
      readonly key: string;
      readonly error: unknown;
    };

export function readStorage(
  storage: BrowserStorage,
  key: string,
): StorageResult<string | null> {
  try {
    return { ok: true, value: storage.getItem(key) };
  } catch (error) {
    return { ok: false, operation: "read", key, error };
  }
}

/**
 * Writes and rereads the exact bytes. Some privacy/storage implementations
 * accept setItem while silently discarding the value, so success is only
 * reported after the round trip matches.
 */
export function writeVerifiedStorage(
  storage: BrowserStorage,
  key: string,
  value: string,
): StorageResult<void> {
  try {
    storage.setItem(key, value);
  } catch (error) {
    return { ok: false, operation: "write", key, error };
  }
  let reread: string | null;
  try {
    reread = storage.getItem(key);
  } catch (error) {
    return { ok: false, operation: "verify", key, error };
  }
  if (reread !== value) {
    return {
      ok: false,
      operation: "verify",
      key,
      error: new Error("Stored bytes did not survive verification."),
    };
  }
  return { ok: true, value: undefined };
}

export function removeStorage(
  storage: BrowserStorage,
  key: string,
): StorageResult<void> {
  try {
    storage.removeItem(key);
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, operation: "remove", key, error };
  }
}

export type SessionStartupKind =
  | "new"
  | "continued"
  | "recovered"
  | "volatile";

export interface SessionStartupNotice {
  readonly kind: SessionStartupKind;
  readonly label: string;
  readonly detail: string;
}

export function sessionStartupNotice(
  kind: SessionStartupKind,
): SessionStartupNotice {
  switch (kind) {
    case "continued":
      return {
        kind,
        label: "CONTINUED",
        detail: "Local autosave restored. Progress saves every 30 seconds and on exit.",
      };
    case "recovered":
      return {
        kind,
        label: "RECOVERED",
        detail: "An older valid save was restored. The unreadable save was preserved for safety.",
      };
    case "volatile":
      return {
        kind,
        label: "LOCAL SAVE OFFLINE",
        detail: "Browser storage is unavailable. This run remains playable but cannot persist.",
      };
    case "new":
      return {
        kind,
        label: "NEW CAMPAIGN",
        detail: "Autosave is ready. Progress saves every 30 seconds and on exit.",
      };
  }
}

export interface CommissionGuidanceInput {
  readonly commissionId: string | null;
  readonly objectiveCurrent: readonly number[];
  readonly objectiveTargets: readonly number[];
  readonly completedCommissionIds?: readonly string[];
}

export const MOBILE_POWER_RELAY_GUIDANCE =
  "If a machine reports No power, place Grid relays between it and a fueled generator. If the whole grid is dark, tap the generator and hand-prime coal.";

/** Immediate, action-oriented copy for the playable campaign slice. */
export function commissionGuidance(
  input: CommissionGuidanceInput,
): string {
  if (input.commissionId === null) {
    if (input.completedCommissionIds?.includes("throughput")) {
      return "Throughput transmitted. Dispatch manifolds and the fluid-processing tier are now unlocked for the next production district.";
    }
    return "Select an available shipment contract. After Bootstrap, choose Throughput and spend the Bootstrap reward on automatic coal plus a Precision Fabricator line.";
  }
  if (input.commissionId === "throughput") {
    const gears = input.objectiveCurrent[0] ?? 0;
    const gearTarget = input.objectiveTargets[0] ?? 0;
    const wire = input.objectiveCurrent[1] ?? 0;
    const wireTarget = input.objectiveTargets[1] ?? 0;
    if (
      gearTarget > 0 &&
      wireTarget > 0 &&
      gears >= gearTarget &&
      wire >= wireTarget
    ) {
      return "Throughput cargo is secured. Transmit it to reveal Dispatch manifolds and the fluid-processing tier.";
    }
    if (gearTarget > 0 && gears >= gearTarget) {
      return "Iron gears are secured. Switch the same Precision Fabricator to Copper wire; its side inserter will take copper from mixed plate traffic while the output keeps feeding the Uplink.";
    }
    return "Spend the Bootstrap alloy: automate coal first, build a powered Precision Fabricator beside the mixed plate belt, configure Iron gear, and route its output to the Uplink.";
  }
  if (input.commissionId !== "bootstrap") {
    return "Route finished goods into the Uplink’s pulsing cyan DOCK tile. The final belt auto-aligns with the cargo bridge; transmitted cargo is consumed from its secure manifest.";
  }
  const ready =
    input.objectiveTargets.length > 0 &&
    input.objectiveTargets.every(
      (target, index) => target > 0 && (input.objectiveCurrent[index] ?? 0) >= target,
    );
  if (ready) {
    return "Bootstrap cargo is secured. Press Transmit manifest to earn alloy and unlock the Precision Fabricator, then select Throughput.";
  }
  const received = input.objectiveCurrent.some((amount) => amount > 0);
  if (received) {
    return "The Uplink is receiving cargo. Keep iron plate, copper plate, and fire brick flowing through the pulsing cyan DOCK lane until every counter is full.";
  }
  return "Use an inserter and belts to route smelter output into the Uplink’s pulsing cyan DOCK tile (X21 Z12); the final belt auto-aligns eastbound. Add copper plate and fire brick.";
}
