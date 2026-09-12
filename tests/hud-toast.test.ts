import { describe, expect, it } from "vitest";

import { hudToastDedupeKey } from "../src/ui/HUD";

describe("HUD toast deduplication", () => {
  it("keeps different messages with the same title independently observable", () => {
    const unsafeFilter = hudToastDedupeKey({
      title: "CONTROL PROGRAM REJECTED",
      message: "Filter minimum must be a whole number.",
    });
    const duplicatePriority = hudToastDedupeKey({
      title: "CONTROL PROGRAM REJECTED",
      message: "Sorter route priorities must be unique.",
    });

    expect(unsafeFilter).not.toBe(duplicatePriority);
    expect(
      hudToastDedupeKey({
        title: " control program rejected ",
        message: "  Filter minimum must be a whole number. ",
      }),
    ).toBe(unsafeFilter);
  });

  it("preserves explicit semantic keys and IDs", () => {
    expect(
      hudToastDedupeKey({
        dedupeKey: "placement-rejected",
        title: "First title",
        message: "First reason",
      }),
    ).toBe(
      hudToastDedupeKey({
        dedupeKey: "PLACEMENT-REJECTED",
        title: "Second title",
        message: "Second reason",
      }),
    );
    expect(
      hudToastDedupeKey({
        id: "stable-notice",
        message: "First copy",
      }),
    ).toBe(
      hudToastDedupeKey({
        id: "STABLE-NOTICE",
        message: "Second copy",
      }),
    );
  });
});
