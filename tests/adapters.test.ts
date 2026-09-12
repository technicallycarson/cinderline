import { describe, expect, it } from "vitest";

import {
  toHUDMapEntities,
  toInspector,
  toRenderSnapshot,
} from "../src/game/adapters";
import { FactorySimulation } from "../src/game/simulation";
import { Direction, ManifoldMode } from "../src/game/types";

function blankSimulation(): FactorySimulation {
  return new FactorySimulation({
    width: 20,
    height: 14,
    seed: 0xc01150,
    generateTerrain: false,
    generateResources: false,
    powerMode: "legacyGlobal",
  });
}

describe("machine process-console adapter", () => {
  it("publishes four unconfigured Fabricator cards with exact formulas", () => {
    const simulation = blankSimulation();
    const placed = simulation.place(
      "fabricator",
      3,
      4,
      Direction.East,
    );
    if (!placed.ok) throw new Error(placed.reason);

    const process = toInspector(
      simulation.getEntity(placed.entity.id),
    )?.machineProcess;
    expect(process).toMatchObject({
      kind: "fabricator",
      state: "unconfigured",
      configured: null,
      active: null,
      pending: null,
      condition: {
        text: "Select a recipe to arm this fabricator.",
      },
    });
    expect(process?.recipes.map((option) => option.recipeId)).toEqual([
      "ironGear",
      "copperWire",
      "circuit",
      "automationCore",
    ]);
    expect(
      process?.recipes.find((option) => option.recipeId === "circuit")
        ?.formulas[0],
    ).toMatchObject({
      durationSeconds: 0.5,
      ingredients: [
        { id: "ironPlate", amount: 1 },
        { id: "copperWire", amount: 3 },
      ],
      products: [{ id: "circuit", amount: 1 }],
    });
    expect(
      toRenderSnapshot(simulation.getRenderSnapshot()).entities.find(
        (entity) => entity.id === placed.entity.id,
      ),
    ).toMatchObject({
      processState: "unconfigured",
      reclaimCount: 0,
    });
  });

  it("filters recipe controls to the campaign's unlocked recipe set", () => {
    const simulation = blankSimulation();
    const fabricator = simulation.place(
      "fabricator",
      3,
      4,
      Direction.East,
    );
    const smelter = simulation.place(
      "smelter",
      10,
      4,
      Direction.East,
    );
    if (!fabricator.ok || !smelter.ok) {
      throw new Error("Fixture placement failed.");
    }

    expect(
      toInspector(
        simulation.getEntity(fabricator.entity.id),
        ["ironGear", "circuit"],
      )?.machineProcess?.recipes.map((option) => option.recipeId),
    ).toEqual(["ironGear", "circuit"]);
    expect(
      toInspector(
        simulation.getEntity(smelter.entity.id),
        ["smeltIron", "fireBrick"],
      )?.machineProcess?.recipes.map((option) => ({
        id: option.recipeId,
        formulas: option.formulas.map((formula) => formula.id),
      })),
    ).toEqual([
      {
        id: null,
        formulas: ["smeltIron", "fireBrick"],
      },
      {
        id: "smeltIron",
        formulas: ["smeltIron"],
      },
      {
        id: "fireBrick",
        formulas: ["fireBrick"],
      },
    ]);
  });

  it("publishes Auto-smelt as a distinct configured target with three rows", () => {
    const simulation = blankSimulation();
    const placed = simulation.place("smelter", 3, 4, Direction.East);
    if (!placed.ok) throw new Error(placed.reason);

    const process = toInspector(
      simulation.getEntity(placed.entity.id),
    )?.machineProcess;
    expect(process?.configured).toEqual({ mode: "auto" });
    expect(process?.recipes.map((option) => option.recipeId)).toEqual([
      null,
      "smeltIron",
      "smeltCopper",
      "fireBrick",
    ]);
    expect(process?.recipes[0]).toMatchObject({
      configured: true,
      targeted: true,
      active: false,
      pending: false,
    });
    expect(process?.recipes[0]?.formulas.map((formula) => formula.id)).toEqual([
      "smeltIron",
      "smeltCopper",
      "fireBrick",
    ]);
    expect(process?.condition.text).toBe(
      "Auto-smelt armed — waiting for iron ore, copper ore, or stone.",
    );
    expect(
      toRenderSnapshot(simulation.getRenderSnapshot()).entities.find(
        (entity) => entity.id === placed.entity.id,
      ),
    ).toMatchObject({
      processState: "starved",
      processRecipe: "auto",
      reclaimCount: 0,
    });
  });

  it("keeps configured, active, and queued targets causally distinct", () => {
    const simulation = blankSimulation();
    const machine = simulation.place(
      "fabricator",
      3,
      4,
      Direction.East,
      { recipeId: "copperWire" },
    );
    const generator = simulation.place(
      "generator",
      13,
      4,
      Direction.East,
    );
    if (!machine.ok || !generator.ok) throw new Error("Fixture placement failed.");
    simulation.receive(generator.entity.id, "coal", 1, "fuel");
    simulation.receive(machine.entity.id, "copperPlate", 2, "input");
    simulation.step();
    expect(
      simulation.requestRecipeChange(machine.entity.id, "circuit"),
    ).toMatchObject({ ok: true, outcome: "queued" });

    const process = toInspector(
      simulation.getEntity(machine.entity.id),
    )?.machineProcess;
    expect(process?.state).toBe("queued");
    expect(process?.recipes.find((option) => option.recipeId === "copperWire"))
      .toMatchObject({
        configured: true,
        active: true,
        pending: false,
        targeted: false,
      });
    expect(process?.recipes.find((option) => option.recipeId === "circuit"))
      .toMatchObject({
        configured: false,
        active: false,
        pending: true,
        targeted: true,
      });
    expect(process?.condition.text).toBe(
      "Change queued — finishing Copper wire before Logic circuit; leftover input will move to RECLAIM.",
    );
    expect(
      toRenderSnapshot(simulation.getRenderSnapshot()).entities.find(
        (entity) => entity.id === machine.entity.id,
      ),
    ).toMatchObject({
      processState: "queued",
      processRecipe: "copperWire",
      pendingRecipe: "circuit",
      reclaimCount: 0,
    });
  });

  it("keeps input-ready idle and grid-offline states semantically distinct", () => {
    const simulation = blankSimulation();
    const placed = simulation.place(
      "fabricator",
      3,
      4,
      Direction.East,
      { recipeId: "ironGear" },
    );
    if (!placed.ok) throw new Error(placed.reason);

    expect(
      simulation.receive(placed.entity.id, "ironPlate", 2, "input"),
    ).toBe(2);
    expect(
      toInspector(simulation.getEntity(placed.entity.id))?.machineProcess,
    ).toMatchObject({
      state: "idle",
      condition: {
        text: "Inputs ready — batch armed for chamber commit.",
      },
    });
    expect(
      toRenderSnapshot(simulation.getRenderSnapshot()).entities.find(
        (entity) => entity.id === placed.entity.id,
      ),
    ).toMatchObject({
      processState: "idle",
      processRecipe: "ironGear",
    });

    simulation.step();
    expect(
      toInspector(simulation.getEntity(placed.entity.id))?.machineProcess,
    ).toMatchObject({
      state: "no-power",
      condition: {
        tone: "error",
      },
    });
    expect(
      toRenderSnapshot(simulation.getRenderSnapshot()).entities.find(
        (entity) => entity.id === placed.entity.id,
      ),
    ).toMatchObject({
      processState: "no-power",
      processRecipe: "ironGear",
    });
  });

  it("labels legacy relay assignments as retrofit previews, not active grids", () => {
    const simulation = blankSimulation();
    const relay = simulation.place("gridRelay", 3, 3, Direction.North);
    const beacon = simulation.place("beacon", 5, 3, Direction.North);
    if (!relay.ok || !beacon.ok) throw new Error("Fixture placement failed.");
    simulation.step();
    const rendered = simulation
      .getRenderSnapshot()
      .entities.find((entity) => entity.id === beacon.entity.id);

    expect(
      toInspector(rendered, undefined, "legacyGlobal")?.stats?.find(
        (stat) => stat.id === "candidate-network",
      ),
    ).toEqual({
      id: "candidate-network",
      label: "Retrofit grid",
      value: `N-${relay.entity.id}`,
    });
    expect(
      toInspector(rendered, undefined, "legacyGlobal")?.stats?.find(
        (stat) => stat.id === "network",
      ),
    ).toBeUndefined();
  });
});

describe("dispatch manifold Extract adapter", () => {
  it.each([
    [0, "copperOre", 0, "A"],
    [0, "ironOre", 1, "A"],
    [1, "copperOre", 1, "B"],
    [1, "ironOre", 0, "B"],
  ] as const)(
    "publishes matching port %i and previews %s on local port %i",
    (extractPort, payload, expectedActivePort, portLabel) => {
      const simulation = blankSimulation();
      const placed = simulation.place(
        "manifold",
        5,
        5,
        Direction.East,
      );
      if (!placed.ok) throw new Error(placed.reason);
      expect(
        simulation.setManifoldRouting(placed.entity.id, {
          mode: ManifoldMode.Extract,
          filter: "copperOre",
          extractPort,
        }),
      ).toBe(true);

      const idleEntity = simulation.getEntity(placed.entity.id);
      expect(toInspector(idleEntity)).toMatchObject({
        recipe: {
          label: `Extract to local ${portLabel}`,
        },
        manifoldRouting: {
          mode: ManifoldMode.Extract,
          filter: "copperOre",
          extractPort,
        },
      });
      expect(
        toInspector(idleEntity)?.manifoldRouting?.filterOptions.some(
          (option) => option.id === "copperOre",
        ),
      ).toBe(true);
      expect(
        toRenderSnapshot(simulation.getRenderSnapshot()).entities.find(
          (entity) => entity.id === placed.entity.id,
        )?.routingActivePort,
      ).toBe(extractPort);

      expect(
        simulation.receive(placed.entity.id, payload, 1, "belt", 0),
      ).toBe(1);
      const preview = toRenderSnapshot(
        simulation.getRenderSnapshot(),
      ).entities.find((entity) => entity.id === placed.entity.id);
      expect(preview).toMatchObject({
        routingMode: ManifoldMode.Extract,
        routingFilter: "copperOre",
        routingActivePort: expectedActivePort,
        routingCommonCount: 1,
      });
    },
  );

  it("keeps a B selector in the HUD read model while Extract mode is latent", () => {
    const simulation = blankSimulation();
    const placed = simulation.place(
      "manifold",
      5,
      5,
      Direction.East,
    );
    if (!placed.ok) throw new Error(placed.reason);
    expect(
      simulation.setManifoldRouting(placed.entity.id, {
        mode: ManifoldMode.Even,
        extractPort: 1,
      }),
    ).toBe(true);
    expect(
      toInspector(simulation.getEntity(placed.entity.id))?.manifoldRouting,
    ).toMatchObject({
      mode: ManifoldMode.Even,
      extractPort: 1,
    });
  });
});

describe("advanced-system HUD adapters", () => {
  it.each([
    ["fluidSource", "FLUID SOURCE"],
    ["fluidPump", "FLUID PUMP"],
    ["fluidPipe", "FLUID PIPE"],
    ["fluidTank", "FLUID TANK"],
    ["fluidProcessor", "FLUID PROCESSOR"],
    ["constantCombinator", "CONSTANT COMBINATOR"],
    ["arithmeticCombinator", "ARITHMETIC COMBINATOR"],
    ["deciderCombinator", "DECIDER COMBINATOR"],
  ] as const)(
    "humanizes the %s inspector type label",
    (kind, expectedLabel) => {
      const simulation = blankSimulation();
      const options =
        kind === "fluidSource"
          ? { fluidId: "crudeOil" as const }
          : kind === "fluidProcessor"
            ? { fluidRecipeId: "refineCrude" as const }
            : {};
      const placed = simulation.place(
        kind,
        3,
        4,
        Direction.East,
        options,
      );
      if (!placed.ok) throw new Error(placed.reason);

      expect(toInspector(simulation.getEntity(placed.entity.id))?.type)
        .toBe(
          `${expectedLabel} // UNIT ${String(placed.entity.id).padStart(3, "0")}`,
        );
    },
  );

  it("publishes truthful fluid volume telemetry instead of item payload stats", () => {
    const simulation = blankSimulation();
    const source = simulation.place(
      "fluidSource",
      2,
      8,
      Direction.East,
      { fluidId: "crudeOil" },
    );
    if (!source.ok) throw new Error(source.reason);
    simulation.step(12);

    const inspector = toInspector(
      simulation.getEntity(source.entity.id),
    );
    expect(inspector?.recipe).toMatchObject({
      icon: "WL",
      label: "Crude oil wellhead",
    });
    expect(inspector?.stats).toEqual(
      expect.arrayContaining([
        {
          id: "fluid-medium",
          label: "Medium",
          value: "Crude oil",
        },
        expect.objectContaining({
          id: "fluid-volume",
          label: "Volume",
          unit: "units",
        }),
        expect.objectContaining({
          id: "fluid-fill",
          label: "Fill",
          unit: "%",
        }),
      ]),
    );
    expect(
      inspector?.stats?.some(
        (stat) => stat.id === "buffer" && stat.unit === "items",
      ),
    ).toBe(false);
  });

  it("keeps fluid and circuit participants visible and selectable on the tactical map", () => {
    const simulation = blankSimulation();
    const pipe = simulation.place(
      "fluidPipe",
      2,
      8,
      Direction.East,
    );
    const combinator = simulation.place(
      "constantCombinator",
      6,
      8,
      Direction.East,
    );
    if (!pipe.ok || !combinator.ok) {
      throw new Error("Advanced-system fixture placement failed.");
    }

    const entities = toHUDMapEntities(
      simulation.getRenderSnapshot(),
      combinator.entity.id,
    );
    expect(
      entities.find((entity) => entity.kind === "fluidPipe"),
    ).toMatchObject({
      kind: "fluidPipe",
      active: false,
      selected: false,
    });
    expect(
      entities.find(
        (entity) => entity.kind === "constantCombinator",
      ),
    ).toMatchObject({
      kind: "constantCombinator",
      active: false,
      selected: true,
    });
  });

  it("publishes live combinator kernel, signal, and wiring telemetry", () => {
    const simulation = blankSimulation();
    const constant = simulation.place(
      "constantCombinator",
      4,
      8,
      Direction.East,
    );
    if (!constant.ok) throw new Error(constant.reason);
    expect(
      simulation.configureCircuitDevice(constant.entity.id, {
        kind: "constant",
        signals: [
          {
            signal: { type: "item", name: "ironPlate" },
            value: 24,
          },
        ],
      }),
    ).toBe(true);
    simulation.step(2);
    const snapshot = simulation.getRenderSnapshot();
    const entity = snapshot.entities.find(
      (candidate) => candidate.id === constant.entity.id,
    );
    const inspector = toInspector(
      entity,
      undefined,
      "legacyGlobal",
      snapshot.circuit,
    );

    expect(inspector).toMatchObject({
      status: "SIGNAL ACTIVE",
      statusTone: "online",
      recipe: {
        icon: "CN",
        label: "Constant broadcast",
      },
    });
    expect(inspector?.recipe?.detail).toContain("Iron Plate 24");
    expect(inspector?.stats).toEqual(
      expect.arrayContaining([
        {
          id: "circuit-kernel",
          label: "Kernel",
          value: "CONSTANT",
        },
        {
          id: "circuit-output",
          label: "Output",
          value: 1,
          unit: "signal",
        },
        {
          id: "circuit-links",
          label: "Links",
          value: 0,
          unit: "wires",
        },
      ]),
    );
  });
});
