import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  InteractionController,
  type InteractionCallbacks,
} from "../src/game/input";

type Listener = EventListenerOrEventListenerObject;

class FakeEventTarget {
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(
    type: string,
    listener: Listener | null,
  ): void {
    if (!listener) return;
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    listener: Listener | null,
  ): void {
    if (listener) this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  }
}

interface FakeCanvas extends FakeEventTarget {
  style: { cursor: string };
  setPointerCapture(pointerId: number): void;
  releasePointerCapture(pointerId: number): void;
}

function createCanvas(): FakeCanvas {
  return Object.assign(new FakeEventTarget(), {
    style: { cursor: "crosshair" },
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  });
}

function createCallbacks(): InteractionCallbacks {
  return {
    screenToGrid: vi.fn(() => null),
    pickEntity: vi.fn(() => null),
    onHover: vi.fn(),
    onPrimary: vi.fn(),
    onPrimaryRelease: vi.fn(),
    onSelect: vi.fn(),
    onRemove: vi.fn(),
    onRotate: vi.fn(),
    onCancel: vi.fn(),
    onPan: vi.fn(),
    onZoom: vi.fn(),
    onFocus: vi.fn(),
    onPause: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onDismantle: vi.fn(),
    onToolHotkey: vi.fn(),
    onRailPalette: vi.fn(),
    onBlueprintCapture: vi.fn(),
    onBlueprintLibrary: vi.fn(),
    onBlueprintCopy: vi.fn(),
    onBlueprintPaste: vi.fn(),
    onBlueprintMirror: vi.fn(),
    canDragBuild: vi.fn(() => false),
    canTouchPan: vi.fn(() => false),
  };
}

function keyboardEvent(
  key: string,
  options: {
    repeat?: boolean;
    target?: EventTarget;
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
  } = {},
): KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> } {
  return {
    key,
    repeat: options.repeat ?? false,
    target:
      options.target ??
      ({
        isContentEditable: false,
        closest: () => null,
      } as unknown as EventTarget),
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent & {
    preventDefault: ReturnType<typeof vi.fn>;
  };
}

const globalWithWindow = globalThis as typeof globalThis & {
  window?: Window & typeof globalThis;
};
let previousWindow: (Window & typeof globalThis) | undefined;
let fakeWindow: FakeEventTarget;

beforeEach(() => {
  previousWindow = globalWithWindow.window;
  fakeWindow = new FakeEventTarget();
  Object.defineProperty(globalThis, "window", {
    value: fakeWindow,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  if (previousWindow) {
    Object.defineProperty(globalThis, "window", {
      value: previousWindow,
      configurable: true,
      writable: true,
    });
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

describe("InteractionController dismantle shortcuts", () => {
  it("handles Delete and Backspace once and suppresses browser navigation", () => {
    const canvas = createCanvas();
    const callbacks = createCallbacks();
    const controller = new InteractionController(
      canvas as unknown as HTMLCanvasElement,
      callbacks,
    );

    const deleteEvent = keyboardEvent("Delete");
    fakeWindow.dispatch("keydown", deleteEvent);
    expect(callbacks.onDismantle).toHaveBeenCalledTimes(1);
    expect(deleteEvent.preventDefault).toHaveBeenCalledOnce();

    const backspaceEvent = keyboardEvent("Backspace");
    fakeWindow.dispatch("keydown", backspaceEvent);
    expect(callbacks.onDismantle).toHaveBeenCalledTimes(2);
    expect(backspaceEvent.preventDefault).toHaveBeenCalledOnce();

    const repeatedBackspace = keyboardEvent("Backspace", { repeat: true });
    fakeWindow.dispatch("keydown", repeatedBackspace);
    expect(callbacks.onDismantle).toHaveBeenCalledTimes(2);
    expect(repeatedBackspace.preventDefault).toHaveBeenCalledOnce();

    controller.dispose();
  });

  it("leaves Delete and Backspace untouched inside editable controls", () => {
    const canvas = createCanvas();
    const callbacks = createCallbacks();
    const controller = new InteractionController(
      canvas as unknown as HTMLCanvasElement,
      callbacks,
    );
    const editable = {
      isContentEditable: false,
      closest: () => editable,
    } as unknown as EventTarget;

    const deleteEvent = keyboardEvent("Delete", { target: editable });
    const backspaceEvent = keyboardEvent("Backspace", { target: editable });
    fakeWindow.dispatch("keydown", deleteEvent);
    fakeWindow.dispatch("keydown", backspaceEvent);

    expect(callbacks.onDismantle).not.toHaveBeenCalled();
    expect(deleteEvent.preventDefault).not.toHaveBeenCalled();
    expect(backspaceEvent.preventDefault).not.toHaveBeenCalled();

    controller.dispose();
  });

  it("leaves game hotkeys untouched inside buttons and keyboard scopes", () => {
    const canvas = createCanvas();
    const callbacks = createCallbacks();
    const controller = new InteractionController(
      canvas as unknown as HTMLCanvasElement,
      callbacks,
    );
    const button = {
      isContentEditable: false,
      closest: (selector: string) =>
        selector.includes("button") ? button : null,
    } as unknown as EventTarget;
    const scopedCardChild = {
      isContentEditable: false,
      closest: (selector: string) =>
        selector.includes("[data-keyboard-scope]") ? scopedCardChild : null,
    } as unknown as EventTarget;

    const space = keyboardEvent(" ", { target: button });
    const number = keyboardEvent("4", { target: scopedCardChild });
    const undo = keyboardEvent("z", {
      target: scopedCardChild,
      ctrlKey: true,
    });
    fakeWindow.dispatch("keydown", space);
    fakeWindow.dispatch("keydown", number);
    fakeWindow.dispatch("keydown", undo);

    expect(callbacks.onPause).not.toHaveBeenCalled();
    expect(callbacks.onToolHotkey).not.toHaveBeenCalled();
    expect(callbacks.onUndo).not.toHaveBeenCalled();
    expect(space.preventDefault).not.toHaveBeenCalled();
    expect(undo.preventDefault).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("maps the zero key to the tenth construction tool", () => {
    const canvas = createCanvas();
    const callbacks = createCallbacks();
    const controller = new InteractionController(
      canvas as unknown as HTMLCanvasElement,
      callbacks,
    );

    fakeWindow.dispatch("keydown", keyboardEvent("0"));
    expect(callbacks.onToolHotkey).toHaveBeenCalledWith(9);
    controller.dispose();
  });

  it("routes the dedicated rail palette shortcut", () => {
    const canvas = createCanvas();
    const callbacks = createCallbacks();
    const controller = new InteractionController(
      canvas as unknown as HTMLCanvasElement,
      callbacks,
    );
    fakeWindow.dispatch("keydown", keyboardEvent("t"));
    expect(callbacks.onRailPalette).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("routes blueprint capture, copy, paste, and mirror shortcuts", () => {
    const canvas = createCanvas();
    const callbacks = createCallbacks();
    const controller = new InteractionController(
      canvas as unknown as HTMLCanvasElement,
      callbacks,
    );

    const copy = keyboardEvent("c", { ctrlKey: true });
    const paste = keyboardEvent("v", { metaKey: true });
    fakeWindow.dispatch("keydown", copy);
    fakeWindow.dispatch("keyup", keyboardEvent("c"));
    fakeWindow.dispatch("keydown", paste);
    fakeWindow.dispatch("keyup", keyboardEvent("v"));
    fakeWindow.dispatch("keydown", keyboardEvent("b"));
    fakeWindow.dispatch("keyup", keyboardEvent("b"));
    fakeWindow.dispatch(
      "keydown",
      keyboardEvent("b", { shiftKey: true }),
    );
    fakeWindow.dispatch("keyup", keyboardEvent("b"));
    fakeWindow.dispatch("keydown", keyboardEvent("m"));
    fakeWindow.dispatch("keyup", keyboardEvent("m"));
    fakeWindow.dispatch(
      "keydown",
      keyboardEvent("m", { shiftKey: true }),
    );

    expect(callbacks.onBlueprintCopy).toHaveBeenCalledOnce();
    expect(callbacks.onBlueprintPaste).toHaveBeenCalledOnce();
    expect(callbacks.onBlueprintCapture).toHaveBeenCalledOnce();
    expect(callbacks.onBlueprintLibrary).toHaveBeenCalledOnce();
    expect(callbacks.onBlueprintMirror).toHaveBeenNthCalledWith(
      1,
      "horizontal",
    );
    expect(callbacks.onBlueprintMirror).toHaveBeenNthCalledWith(
      2,
      "vertical",
    );
    expect(copy.preventDefault).toHaveBeenCalledOnce();
    expect(paste.preventDefault).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("routes both standard redo chords without also undoing", () => {
    const canvas = createCanvas();
    const callbacks = createCallbacks();
    const controller = new InteractionController(
      canvas as unknown as HTMLCanvasElement,
      callbacks,
    );

    const shiftZ = keyboardEvent("z", { ctrlKey: true, shiftKey: true });
    const commandY = keyboardEvent("y", { metaKey: true });
    fakeWindow.dispatch("keydown", shiftZ);
    fakeWindow.dispatch("keyup", keyboardEvent("z"));
    fakeWindow.dispatch("keydown", commandY);

    expect(callbacks.onRedo).toHaveBeenCalledTimes(2);
    expect(callbacks.onUndo).not.toHaveBeenCalled();
    expect(shiftZ.preventDefault).toHaveBeenCalledOnce();
    expect(commandY.preventDefault).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("preserves Shift+right-click removal through onRemove", () => {
    const canvas = createCanvas();
    const callbacks = createCallbacks();
    vi.mocked(callbacks.pickEntity).mockReturnValue(42);
    const controller = new InteractionController(
      canvas as unknown as HTMLCanvasElement,
      callbacks,
    );

    canvas.dispatch(
      "pointerdown",
      {
        button: 2,
        pointerId: 7,
        clientX: 120,
        clientY: 80,
        altKey: false,
      } as PointerEvent,
    );
    canvas.dispatch(
      "pointerup",
      {
        button: 2,
        pointerId: 7,
        clientX: 120,
        clientY: 80,
        shiftKey: true,
      } as PointerEvent,
    );

    expect(callbacks.onRemove).toHaveBeenCalledWith(42);
    expect(callbacks.onDismantle).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("reports a press-drag-release primary gesture for marquee tools", () => {
    const canvas = createCanvas();
    const callbacks = createCallbacks();
    vi.mocked(callbacks.screenToGrid)
      .mockReturnValueOnce({ x: 2, z: 3 })
      .mockReturnValueOnce({ x: 5, z: 7 })
      .mockReturnValueOnce({ x: 5, z: 7 });
    const controller = new InteractionController(
      canvas as unknown as HTMLCanvasElement,
      callbacks,
    );

    canvas.dispatch(
      "pointerdown",
      {
        type: "pointerdown",
        button: 0,
        pointerId: 4,
        clientX: 100,
        clientY: 120,
        altKey: false,
      } as PointerEvent,
    );
    canvas.dispatch(
      "pointermove",
      {
        type: "pointermove",
        button: 0,
        pointerId: 4,
        clientX: 150,
        clientY: 185,
      } as PointerEvent,
    );
    canvas.dispatch(
      "pointerup",
      {
        type: "pointerup",
        button: 0,
        pointerId: 4,
        clientX: 150,
        clientY: 185,
      } as PointerEvent,
    );

    expect(callbacks.onPrimary).toHaveBeenCalledWith(
      { x: 2, z: 3 },
      false,
      100,
      120,
    );
    expect(callbacks.onHover).toHaveBeenCalledWith(
      { x: 5, z: 7 },
      150,
      185,
    );
    expect(callbacks.onPrimaryRelease).toHaveBeenCalledWith(
      { x: 5, z: 7 },
      true,
    );
    controller.dispose();
  });

  it("propagates pointer coordinates through drag cells and skips no-cell presses", () => {
    const canvas = createCanvas();
    const callbacks = createCallbacks();
    vi.mocked(callbacks.canDragBuild).mockReturnValue(true);
    vi.mocked(callbacks.screenToGrid)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ x: 1, z: 1 })
      .mockReturnValueOnce({ x: 3, z: 1 });
    const controller = new InteractionController(
      canvas as unknown as HTMLCanvasElement,
      callbacks,
    );

    canvas.dispatch(
      "pointerdown",
      {
        type: "pointerdown",
        button: 0,
        pointerId: 1,
        clientX: 9,
        clientY: 11,
        altKey: false,
      } as PointerEvent,
    );
    expect(callbacks.onPrimary).not.toHaveBeenCalled();
    canvas.dispatch(
      "pointerup",
      {
        type: "pointerup",
        button: 0,
        pointerId: 1,
        clientX: 9,
        clientY: 11,
      } as PointerEvent,
    );

    canvas.dispatch(
      "pointerdown",
      {
        type: "pointerdown",
        button: 0,
        pointerId: 2,
        clientX: 20,
        clientY: 30,
        altKey: false,
      } as PointerEvent,
    );
    canvas.dispatch(
      "pointermove",
      {
        type: "pointermove",
        button: 0,
        pointerId: 2,
        clientX: 80,
        clientY: 45,
      } as PointerEvent,
    );
    expect(callbacks.onPrimary).toHaveBeenCalledWith(
      { x: 1, z: 1 },
      false,
      20,
      30,
    );
    expect(callbacks.onPrimary).toHaveBeenCalledWith(
      { x: 2, z: 1 },
      true,
      80,
      45,
    );
    expect(callbacks.onPrimary).toHaveBeenCalledWith(
      { x: 3, z: 1 },
      true,
      80,
      45,
    );
    controller.dispose();
  });

  it("keeps click-click area workflows distinguishable from drags", () => {
    const canvas = createCanvas();
    const callbacks = createCallbacks();
    vi.mocked(callbacks.screenToGrid)
      .mockReturnValueOnce({ x: 4, z: 4 })
      .mockReturnValueOnce({ x: 4, z: 4 });
    const controller = new InteractionController(
      canvas as unknown as HTMLCanvasElement,
      callbacks,
    );

    canvas.dispatch(
      "pointerdown",
      {
        type: "pointerdown",
        button: 0,
        pointerId: 8,
        clientX: 120,
        clientY: 120,
        altKey: false,
      } as PointerEvent,
    );
    canvas.dispatch(
      "pointerup",
      {
        type: "pointerup",
        button: 0,
        pointerId: 8,
        clientX: 120,
        clientY: 120,
      } as PointerEvent,
    );

    expect(callbacks.onPrimaryRelease).toHaveBeenCalledWith(
      { x: 4, z: 4 },
      false,
    );
    controller.dispose();
  });

  it("uses one-finger touch to tap-select or pan when no tool owns input", () => {
    const canvas = createCanvas();
    const callbacks = createCallbacks();
    vi.mocked(callbacks.canTouchPan!).mockReturnValue(true);
    vi.mocked(callbacks.pickEntity).mockReturnValue(42);
    const controller = new InteractionController(
      canvas as unknown as HTMLCanvasElement,
      callbacks,
    );
    const tapPreventDefault = vi.fn();

    canvas.dispatch(
      "pointerdown",
      {
        type: "pointerdown",
        pointerType: "touch",
        button: 0,
        pointerId: 10,
        clientX: 120,
        clientY: 90,
        preventDefault: tapPreventDefault,
      } as unknown as PointerEvent,
    );
    canvas.dispatch(
      "pointerup",
      {
        type: "pointerup",
        pointerType: "touch",
        button: 0,
        pointerId: 10,
        clientX: 120,
        clientY: 90,
        preventDefault: tapPreventDefault,
      } as unknown as PointerEvent,
    );

    expect(callbacks.onSelect).toHaveBeenCalledWith(42);
    expect(callbacks.onPrimary).not.toHaveBeenCalled();

    const panPreventDefault = vi.fn();
    canvas.dispatch(
      "pointerdown",
      {
        type: "pointerdown",
        pointerType: "touch",
        button: 0,
        pointerId: 11,
        clientX: 100,
        clientY: 100,
        preventDefault: panPreventDefault,
      } as unknown as PointerEvent,
    );
    canvas.dispatch(
      "pointermove",
      {
        type: "pointermove",
        pointerType: "touch",
        pointerId: 11,
        clientX: 140,
        clientY: 80,
        preventDefault: panPreventDefault,
      } as unknown as PointerEvent,
    );
    canvas.dispatch(
      "pointerup",
      {
        type: "pointerup",
        pointerType: "touch",
        button: 0,
        pointerId: 11,
        clientX: 140,
        clientY: 80,
        preventDefault: panPreventDefault,
      } as unknown as PointerEvent,
    );

    const [panX, panZ] = vi.mocked(callbacks.onPan).mock.calls[0]!;
    expect(panX).toBeCloseTo(-1.8);
    expect(panZ).toBeCloseTo(-0.9);
    expect(callbacks.onSelect).toHaveBeenCalledTimes(1);
    expect(panPreventDefault).toHaveBeenCalled();
    controller.dispose();
  });

  it("pinch-zooms around the live touch midpoint", () => {
    const canvas = createCanvas();
    const callbacks = createCallbacks();
    vi.mocked(callbacks.canTouchPan!).mockReturnValue(true);
    const controller = new InteractionController(
      canvas as unknown as HTMLCanvasElement,
      callbacks,
    );
    const preventDefault = vi.fn();
    const touch = (
      type: string,
      pointerId: number,
      clientX: number,
      clientY: number,
    ) => ({
      type,
      pointerType: "touch",
      button: 0,
      pointerId,
      clientX,
      clientY,
      preventDefault,
    }) as unknown as PointerEvent;

    canvas.dispatch("pointerdown", touch("pointerdown", 20, 100, 100));
    canvas.dispatch("pointerdown", touch("pointerdown", 21, 200, 100));
    canvas.dispatch("pointermove", touch("pointermove", 21, 240, 100));

    expect(callbacks.onZoom).toHaveBeenCalledOnce();
    const [delta, x, y] = vi.mocked(callbacks.onZoom).mock.calls[0]!;
    expect(delta).toBeLessThan(0);
    expect(x).toBe(170);
    expect(y).toBe(100);
    expect(callbacks.onSelect).not.toHaveBeenCalled();

    canvas.dispatch("pointerup", touch("pointerup", 21, 240, 100));
    canvas.dispatch("pointerup", touch("pointerup", 20, 100, 100));
    expect(callbacks.onSelect).not.toHaveBeenCalled();
    controller.dispose();
  });
});
