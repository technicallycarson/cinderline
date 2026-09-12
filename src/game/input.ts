export interface GridPoint {
  x: number;
  z: number;
}

export interface InteractionCallbacks {
  screenToGrid(clientX: number, clientY: number): GridPoint | null;
  pickEntity(clientX: number, clientY: number): number | null;
  onHover(
    point: GridPoint | null,
    clientX?: number,
    clientY?: number,
  ): void;
  onPrimary(
    point: GridPoint,
    dragging: boolean,
    clientX: number,
    clientY: number,
  ): void;
  /**
   * Completes a primary-pointer gesture. This remains distinct from onPrimary
   * so area tools can support both click-click and press-drag-release input.
   */
  onPrimaryRelease(point: GridPoint | null, dragged: boolean): void;
  onSelect(entityId: number | null): void;
  onRemove(entityId: number): void;
  onRotate(): void;
  onCancel(): void;
  /** World-tile translation. Positive dx/dz move the camera focus. */
  onPan(dx: number, dz: number): void;
  onZoom(delta: number, clientX: number, clientY: number): void;
  onFocus(): void;
  onPause(): void;
  onUndo(): void;
  onRedo(): void;
  onDismantle(): void;
  onToolHotkey(index: number): void;
  onRailPalette(): void;
  onBlueprintCapture(): void;
  onBlueprintLibrary(): void;
  onBlueprintCopy(): void;
  onBlueprintPaste(): void;
  onBlueprintMirror(axis: "horizontal" | "vertical"): void;
  canDragBuild(): boolean;
  /**
   * Enables direct-manipulation navigation for touch pointers. The host keeps
   * this disabled while a construction or area tool owns primary input.
   */
  canTouchPan?(): boolean;
}

const EDITABLE_SELECTOR =
  "input, textarea, select, button, [role='textbox'], [role='button'], [data-keyboard-scope], [contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only']";

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as Partial<HTMLElement>;
  if (element.isContentEditable) return true;
  if (typeof element.closest === "function") {
    return element.closest(EDITABLE_SELECTOR) !== null;
  }
  if (typeof element.matches === "function") {
    return element.matches(EDITABLE_SELECTOR);
  }
  return false;
}

export function isDismantleShortcut(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === "delete" || normalized === "backspace";
}

/**
 * Pointer and keyboard interaction kept separate from renderer/simulation state.
 * Coordinates are always client-space; the renderer owns world projection.
 */
export class InteractionController {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: InteractionCallbacks;
  private readonly keys = new Set<string>();
  private pointerDown = false;
  private panPointer: number | null = null;
  private lastPointer = { x: 0, y: 0 };
  private lastBuildCell: GridPoint | null = null;
  private movedDuringPointer = false;
  private readonly touchPointers = new Map<
    number,
    { x: number; y: number }
  >();
  private touchGestureWasMulti = false;
  private pinchDistance: number | null = null;
  private pinchMidpoint = { x: 0, y: 0 };
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, callbacks: InteractionCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  update(dt: number): void {
    if (this.disposed) return;
    const speed = (this.keys.has("shift") ? 18 : 10) * dt;
    let dx = 0;
    let dy = 0;
    if (this.keys.has("w") || this.keys.has("arrowup")) dy += speed;
    if (this.keys.has("s") || this.keys.has("arrowdown")) dy -= speed;
    if (this.keys.has("a") || this.keys.has("arrowleft")) dx += speed;
    if (this.keys.has("d") || this.keys.has("arrowright")) dx -= speed;
    if (dx !== 0 || dy !== 0) this.callbacks.onPan(dx, dy);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.keys.clear();
    this.touchPointers.clear();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (
      event.pointerType === "touch" &&
      (this.callbacks.canTouchPan?.() ?? false)
    ) {
      event.preventDefault();
      this.touchPointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      this.canvas.setPointerCapture(event.pointerId);
      this.canvas.style.cursor = "grabbing";
      if (this.touchPointers.size === 1) {
        this.panPointer = event.pointerId;
        this.movedDuringPointer = false;
        this.touchGestureWasMulti = false;
        this.pinchDistance = null;
        this.lastPointer = { x: event.clientX, y: event.clientY };
      } else {
        this.touchGestureWasMulti = true;
        this.movedDuringPointer = true;
        const pinch = this.touchPinch();
        this.pinchDistance = pinch?.distance ?? null;
        if (pinch) this.pinchMidpoint = pinch.midpoint;
      }
      return;
    }

    if (event.button === 1 || event.button === 2 || (event.button === 0 && event.altKey)) {
      this.panPointer = event.pointerId;
      this.movedDuringPointer = false;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture(event.pointerId);
      this.canvas.style.cursor = "grabbing";
      return;
    }

    if (event.button !== 0) return;
    this.pointerDown = true;
    this.movedDuringPointer = false;
    this.lastPointer = { x: event.clientX, y: event.clientY };
    this.canvas.setPointerCapture(event.pointerId);

    const cell = this.callbacks.screenToGrid(event.clientX, event.clientY);
    if (!cell) return;
    this.lastBuildCell = cell;
    this.callbacks.onPrimary(
      cell,
      false,
      event.clientX,
      event.clientY,
    );
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.touchPointers.has(event.pointerId)) {
      event.preventDefault();
      this.touchPointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      if (this.touchPointers.size >= 2) {
        const pinch = this.touchPinch();
        if (!pinch) return;
        const midpointDx = pinch.midpoint.x - this.pinchMidpoint.x;
        const midpointDy = pinch.midpoint.y - this.pinchMidpoint.y;
        if (Math.abs(midpointDx) + Math.abs(midpointDy) > 0.5) {
          this.callbacks.onPan(-midpointDx * 0.045, midpointDy * 0.045);
        }
        if (
          this.pinchDistance !== null &&
          this.pinchDistance > 0 &&
          pinch.distance > 0
        ) {
          const zoomDelta = Math.log(this.pinchDistance / pinch.distance) / 0.12;
          if (Math.abs(zoomDelta) > 0.001) {
            this.callbacks.onZoom(
              zoomDelta,
              pinch.midpoint.x,
              pinch.midpoint.y,
            );
          }
        }
        this.pinchDistance = pinch.distance;
        this.pinchMidpoint = pinch.midpoint;
        this.movedDuringPointer = true;
        return;
      }

      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.movedDuringPointer = true;
      if (dx !== 0 || dy !== 0) {
        this.callbacks.onPan(-dx * 0.045, dy * 0.045);
      }
      this.lastPointer = { x: event.clientX, y: event.clientY };
      return;
    }

    const dx = event.clientX - this.lastPointer.x;
    const dy = event.clientY - this.lastPointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) this.movedDuringPointer = true;

    if (this.panPointer === event.pointerId) {
      // Roughly 22 screen pixels per tile at the widest supported zoom.
      this.callbacks.onPan(-dx * 0.045, dy * 0.045);
      this.lastPointer = { x: event.clientX, y: event.clientY };
      return;
    }

    const cell = this.callbacks.screenToGrid(event.clientX, event.clientY);
    this.callbacks.onHover(cell, event.clientX, event.clientY);
    this.lastPointer = { x: event.clientX, y: event.clientY };

    if (!this.pointerDown || !cell || !this.callbacks.canDragBuild()) return;
    if (this.lastBuildCell?.x === cell.x && this.lastBuildCell.z === cell.z) return;

    const from = this.lastBuildCell ?? cell;
    const cells = this.rasterizeManhattan(from, cell);
    for (const next of cells) {
      if (next.x === from.x && next.z === from.z) continue;
      this.callbacks.onPrimary(
        next,
        true,
        event.clientX,
        event.clientY,
      );
    }
    this.lastBuildCell = cell;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.touchPointers.has(event.pointerId)) {
      event.preventDefault();
      const wasTap =
        event.type !== "pointercancel" &&
        this.touchPointers.size === 1 &&
        !this.touchGestureWasMulti &&
        !this.movedDuringPointer;
      this.touchPointers.delete(event.pointerId);
      try {
        this.canvas.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already be released by the user agent.
      }

      if (this.touchPointers.size === 0) {
        this.panPointer = null;
        this.pinchDistance = null;
        this.touchGestureWasMulti = false;
        this.canvas.style.cursor = "crosshair";
        if (wasTap) {
          this.callbacks.onSelect(
            this.callbacks.pickEntity(event.clientX, event.clientY),
          );
        }
      } else {
        const [remainingId, remaining] = this.touchPointers.entries().next()
          .value as [number, { x: number; y: number }];
        this.panPointer = remainingId;
        this.lastPointer = { ...remaining };
        this.pinchDistance = null;
        this.movedDuringPointer = true;
      }
      return;
    }

    if (this.panPointer === event.pointerId) {
      const wasClick = !this.movedDuringPointer;
      this.panPointer = null;
      this.canvas.style.cursor = "crosshair";
      try {
        this.canvas.releasePointerCapture(event.pointerId);
      } catch {
        // The browser may release capture first when leaving the document.
      }

      if (event.button === 2 && wasClick) {
        const entity = this.callbacks.pickEntity(event.clientX, event.clientY);
        if ((event.shiftKey || this.keys.has("shift")) && entity !== null) {
          this.callbacks.onRemove(entity);
        }
        else this.callbacks.onCancel();
      }
      return;
    }

    if (event.button !== 0) return;
    const wasDragging = this.movedDuringPointer;
    const releaseCell =
      event.type === "pointercancel"
        ? null
        : this.callbacks.screenToGrid(event.clientX, event.clientY);
    this.pointerDown = false;
    this.lastBuildCell = null;
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Harmless when pointer capture was already lost.
    }
    this.callbacks.onPrimaryRelease(releaseCell, wasDragging);
  };

  private readonly onPointerLeave = (): void => {
    if (!this.pointerDown && this.panPointer === null) this.callbacks.onHover(null);
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const normalized = Math.sign(event.deltaY) * Math.min(2.5, Math.abs(event.deltaY) / 100);
    this.callbacks.onZoom(normalized, event.clientX, event.clientY);
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isEditableShortcutTarget(event.target)) return;

    const key = event.key.toLowerCase();
    this.keys.add(key);
    if (isDismantleShortcut(key)) {
      // Backspace can navigate away from the game in some browsers. Suppress
      // that default for the game surface even when there is nothing to remove.
      event.preventDefault();
      if (!event.repeat) this.callbacks.onDismantle();
      return;
    }
    if (event.repeat) return;

    if ((event.metaKey || event.ctrlKey) && key === "c") {
      event.preventDefault();
      this.callbacks.onBlueprintCopy();
    } else if ((event.metaKey || event.ctrlKey) && key === "v") {
      event.preventDefault();
      this.callbacks.onBlueprintPaste();
    } else if (/^[1-9]$/.test(key)) {
      this.callbacks.onToolHotkey(Number(key) - 1);
    }
    else if (key === "0") this.callbacks.onToolHotkey(9);
    else if (key === "t") this.callbacks.onRailPalette();
    else if (key === "b") {
      if (event.shiftKey) this.callbacks.onBlueprintLibrary();
      else this.callbacks.onBlueprintCapture();
    }
    else if (key === "m") {
      this.callbacks.onBlueprintMirror(
        event.shiftKey ? "vertical" : "horizontal",
      );
    }
    else if (key === "r") this.callbacks.onRotate();
    else if (key === "escape" || key === "q") this.callbacks.onCancel();
    else if (key === "f" || key === "home") this.callbacks.onFocus();
    else if (key === " ") {
      event.preventDefault();
      this.callbacks.onPause();
    } else if (
      (event.metaKey || event.ctrlKey) &&
      (key === "y" || (key === "z" && event.shiftKey))
    ) {
      event.preventDefault();
      this.callbacks.onRedo();
    } else if ((event.metaKey || event.ctrlKey) && key === "z") {
      event.preventDefault();
      this.callbacks.onUndo();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.pointerDown = false;
    this.panPointer = null;
    this.lastBuildCell = null;
    this.touchPointers.clear();
    this.touchGestureWasMulti = false;
    this.pinchDistance = null;
    this.canvas.style.cursor = "crosshair";
  };

  private touchPinch(): {
    readonly distance: number;
    readonly midpoint: { x: number; y: number };
  } | null {
    const points = [...this.touchPointers.values()];
    const first = points[0];
    const second = points[1];
    if (!first || !second) return null;
    return {
      distance: Math.hypot(second.x - first.x, second.y - first.y),
      midpoint: {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      },
    };
  }

  private rasterizeManhattan(from: GridPoint, to: GridPoint): GridPoint[] {
    const result: GridPoint[] = [{ ...from }];
    let x = from.x;
    let z = from.z;
    const sx = Math.sign(to.x - x);
    const sz = Math.sign(to.z - z);

    // Follow the dominant axis first. This makes rapid belt drags predictable.
    if (Math.abs(to.x - x) >= Math.abs(to.z - z)) {
      while (x !== to.x) {
        x += sx;
        result.push({ x, z });
      }
      while (z !== to.z) {
        z += sz;
        result.push({ x, z });
      }
    } else {
      while (z !== to.z) {
        z += sz;
        result.push({ x, z });
      }
      while (x !== to.x) {
        x += sx;
        result.push({ x, z });
      }
    }
    return result;
  }
}
