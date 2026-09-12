import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  BLUEPRINT_OVERLAY_COLORS,
  type BlueprintCaptureMarquee,
  type BlueprintOverlayLayout,
  type BlueprintOverlayState,
} from "./blueprintOverlay";

export interface BlueprintOverlayRenderDebug {
  readonly signature: string | null;
  readonly total: number;
  readonly detailed: number;
  readonly batches: number;
  readonly counts: Readonly<Record<BlueprintOverlayState, number>>;
  readonly captureIncluded: number;
}

const EMPTY_COUNTS: Readonly<Record<BlueprintOverlayState, number>> =
  Object.freeze({
    construct: 0,
    configure: 0,
    match: 0,
    blocked: 0,
  });

const STATE_ORDER: readonly BlueprintOverlayState[] = Object.freeze([
  "construct",
  "configure",
  "match",
  "blocked",
]);

const OVERLAY_Y = 0.115;
const DETAIL_Y = 0.185;

function primitive(
  source: THREE.BufferGeometry,
  position: readonly [number, number, number],
  scale: readonly [number, number, number],
  rotationY = 0,
): THREE.BufferGeometry {
  const geometry = source.clone();
  geometry.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0)),
      new THREE.Vector3(...scale),
    ),
  );
  return geometry;
}

function merged(
  pieces: THREE.BufferGeometry[],
): THREE.BufferGeometry {
  const result = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (!result) {
    throw new Error("Could not merge blueprint hologram geometry.");
  }
  result.computeBoundingSphere();
  return result;
}

/**
 * Compact, top-readable mechanical glyphs. They are deliberately built from
 * geometry instead of text so identity survives zoom, rotation, localization,
 * and a disabled HUD.
 */
function createKindGlyph(kind: string): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  const cone = new THREE.ConeGeometry(0.5, 1, 4);
  const torus = new THREE.TorusGeometry(0.5, 0.12, 6, 16);
  const pieces: THREE.BufferGeometry[] = [];
  const addBox = (
    position: readonly [number, number, number],
    scale: readonly [number, number, number],
    rotationY = 0,
  ): void => {
    pieces.push(primitive(box, position, scale, rotationY));
  };
  const addCylinder = (
    position: readonly [number, number, number],
    scale: readonly [number, number, number],
    rotationY = 0,
  ): void => {
    pieces.push(primitive(cylinder, position, scale, rotationY));
  };
  const addCone = (
    position: readonly [number, number, number],
    scale: readonly [number, number, number],
    rotationY = 0,
  ): void => {
    pieces.push(primitive(cone, position, scale, rotationY));
  };
  const addTorus = (
    position: readonly [number, number, number],
    scale: readonly [number, number, number],
    rotationY = 0,
  ): void => {
    pieces.push(primitive(torus, position, scale, rotationY));
  };

  switch (kind) {
    case "belt":
      addBox([-0.32, 0.05, 0], [0.13, 0.1, 0.88]);
      addBox([0.32, 0.05, 0], [0.13, 0.1, 0.88]);
      for (const z of [-0.28, 0, 0.28]) {
        addCone([0, 0.11, z], [0.28, 0.12, 0.28], Math.PI / 4);
      }
      break;
    case "manifold":
      addBox([0, 0.05, 0.2], [0.24, 0.1, 0.72]);
      addBox([-0.23, 0.05, -0.25], [0.2, 0.1, 0.56], -0.55);
      addBox([0.23, 0.05, -0.25], [0.2, 0.1, 0.56], 0.55);
      addCylinder([0, 0.13, 0], [0.4, 0.15, 0.4]);
      break;
    case "extractor":
      addTorus([0, 0.15, 0], [0.78, 0.35, 0.78]);
      addCylinder([0, 0.2, 0], [0.34, 0.35, 0.34]);
      for (const x of [-0.34, 0, 0.34]) {
        addCone([x, 0.1, -0.2], [0.24, 0.28, 0.24], Math.PI / 4);
      }
      break;
    case "inserter":
      addCylinder([0, 0.1, 0.28], [0.34, 0.2, 0.34]);
      addBox([0, 0.25, 0], [0.15, 0.13, 0.65]);
      addBox([-0.13, 0.24, -0.32], [0.12, 0.12, 0.25], -0.4);
      addBox([0.13, 0.24, -0.32], [0.12, 0.12, 0.25], 0.4);
      break;
    case "smelter":
      addCylinder([0, 0.17, 0], [0.72, 0.34, 0.72]);
      addTorus([0, 0.35, 0], [0.72, 0.28, 0.72]);
      for (const x of [-0.45, 0.45]) {
        addBox([x, 0.08, 0], [0.18, 0.16, 0.72]);
      }
      break;
    case "fabricator":
      addBox([0, 0.12, 0], [0.72, 0.24, 0.62]);
      addCylinder([0, 0.28, 0], [0.38, 0.23, 0.38]);
      addBox([-0.43, 0.25, 0], [0.16, 0.14, 0.72], -0.35);
      addBox([0.43, 0.25, 0], [0.16, 0.14, 0.72], 0.35);
      break;
    case "generator":
      addBox([0, 0.08, 0], [0.86, 0.16, 0.64]);
      addCylinder([-0.25, 0.22, 0], [0.36, 0.55, 0.36], Math.PI / 2);
      addCylinder([0.25, 0.22, 0], [0.36, 0.55, 0.36], Math.PI / 2);
      addBox([0, 0.26, -0.34], [0.18, 0.36, 0.18]);
      break;
    case "storage":
      addBox([0, 0.18, 0], [0.82, 0.36, 0.72]);
      addBox([0, 0.39, 0], [0.74, 0.08, 0.64]);
      for (const x of [-0.32, 0.32]) {
        addBox([x, 0.21, 0], [0.08, 0.45, 0.78]);
      }
      break;
    case "beacon":
      addTorus([0, 0.1, 0], [0.78, 0.24, 0.78]);
      addCylinder([0, 0.3, 0], [0.18, 0.55, 0.18]);
      addTorus([0, 0.48, 0], [0.38, 0.17, 0.38]);
      break;
    case "gridRelay":
      addCylinder([0, 0.22, 0], [0.16, 0.55, 0.16]);
      addBox([0, 0.46, 0], [0.8, 0.1, 0.12]);
      addCylinder([-0.31, 0.51, 0], [0.13, 0.18, 0.13]);
      addCylinder([0.31, 0.51, 0], [0.13, 0.18, 0.13]);
      break;
    case "pipe":
    case "fluidPipe":
      addCylinder([0, 0.15, 0], [0.25, 0.88, 0.25], Math.PI / 2);
      addTorus([0, 0.15, -0.38], [0.35, 0.25, 0.35]);
      addTorus([0, 0.15, 0.38], [0.35, 0.25, 0.35]);
      break;
    case "pump":
    case "fluidPump":
      addCylinder([0, 0.18, 0], [0.58, 0.38, 0.58]);
      addBox([0, 0.2, 0.38], [0.28, 0.25, 0.42]);
      addCone([0, 0.37, -0.12], [0.28, 0.22, 0.28], Math.PI / 4);
      break;
    case "fluidTank":
      addCylinder([0, 0.24, 0], [0.7, 0.48, 0.7]);
      addTorus([0, 0.42, 0], [0.72, 0.18, 0.72]);
      addBox([0.48, 0.18, 0], [0.18, 0.32, 0.18]);
      break;
    case "fluidProcessor":
      addBox([0, 0.11, 0], [0.84, 0.22, 0.7]);
      addCylinder([-0.24, 0.3, 0], [0.3, 0.38, 0.3]);
      addCylinder([0.24, 0.3, 0], [0.3, 0.38, 0.3]);
      addBox([0, 0.38, 0], [0.2, 0.12, 0.74]);
      break;
    case "fluidSource":
      addCylinder([0, 0.18, 0], [0.68, 0.36, 0.68]);
      addBox([0, 0.22, -0.38], [0.32, 0.28, 0.38]);
      addTorus([0, 0.39, 0], [0.46, 0.18, 0.46]);
      addCone([0, 0.5, 0], [0.25, 0.25, 0.25], Math.PI / 4);
      break;
    default:
      addBox([0, 0.13, 0], [0.72, 0.26, 0.72]);
      addTorus([0, 0.29, 0], [0.48, 0.18, 0.48]);
      break;
  }

  box.dispose();
  cylinder.dispose();
  cone.dispose();
  torus.dispose();
  return merged(pieces);
}

function createBoundaryGeometry(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  y: number,
): THREE.BufferGeometry {
  const positions = new Float32Array([
    minX, y, minZ, maxX, y, minZ,
    maxX, y, minZ, maxX, y, maxZ,
    maxX, y, maxZ, minX, y, maxZ,
    minX, y, maxZ, minX, y, minZ,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

export class BlueprintOverlayRenderer {
  readonly root = new THREE.Group();

  private readonly planRoot = new THREE.Group();
  private readonly captureRoot = new THREE.Group();
  private readonly tempObject = new THREE.Object3D();
  private readonly plateGeometry = new THREE.BoxGeometry(1, 0.045, 1);
  private readonly markerGeometry = new THREE.OctahedronGeometry(0.095, 0);
  private readonly stateMaterials = new Map<
    BlueprintOverlayState,
    { plate: THREE.MeshBasicMaterial; detail: THREE.MeshBasicMaterial }
  >();
  private readonly kindGeometries = new Map<string, THREE.BufferGeometry>();
  private readonly planDynamicGeometries = new Set<THREE.BufferGeometry>();
  private readonly captureDynamicGeometries = new Set<THREE.BufferGeometry>();
  private readonly captureFillMaterial = new THREE.MeshBasicMaterial({
    color: 0x59e4d3,
    transparent: true,
    opacity: 0.12,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  private readonly captureLineMaterial = new THREE.LineBasicMaterial({
    color: 0x9ffff2,
    transparent: true,
    opacity: 0.92,
    depthTest: true,
    depthWrite: false,
  });
  private readonly captureMarkerMaterial = new THREE.MeshBasicMaterial({
    color: 0xcafff5,
    transparent: true,
    opacity: 0.86,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  private planSignature: string | null = null;
  private captureSignature: string | null = null;
  private debug: BlueprintOverlayRenderDebug = Object.freeze({
    signature: null,
    total: 0,
    detailed: 0,
    batches: 0,
    counts: EMPTY_COUNTS,
    captureIncluded: 0,
  });
  private disposed = false;

  constructor(parent: THREE.Object3D) {
    this.root.name = "blueprint-world-overlay";
    this.planRoot.name = "blueprint-plan-hologram";
    this.captureRoot.name = "blueprint-capture-marquee";
    this.root.add(this.planRoot, this.captureRoot);
    this.root.renderOrder = 70;
    parent.add(this.root);

    for (const state of STATE_ORDER) {
      const color = new THREE.Color(BLUEPRINT_OVERLAY_COLORS[state]);
      this.stateMaterials.set(state, {
        plate: new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: state === "match" ? 0.13 : 0.22,
          depthTest: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
        detail: new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: state === "match" ? 0.58 : 0.9,
          depthTest: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      });
    }
  }

  setOverlay(layout: BlueprintOverlayLayout | null): void {
    this.assertLive();
    if (layout?.signature === this.planSignature) return;
    this.clearPlan();
    if (!layout) {
      this.refreshDebug();
      return;
    }

    for (const batch of layout.batches) {
      const material = this.stateMaterials.get(batch.state)!.plate;
      const mesh = new THREE.InstancedMesh(
        this.plateGeometry,
        material,
        batch.indices.length,
      );
      mesh.name = `blueprint-plate-${batch.key}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = 71;
      for (let slot = 0; slot < batch.indices.length; slot += 1) {
        const placement = layout.placements[batch.indices[slot]!]!;
        this.tempObject.position.set(
          placement.centerX,
          OVERLAY_Y,
          placement.centerZ,
        );
        this.tempObject.rotation.set(0, 0, 0);
        this.tempObject.scale.set(
          Math.max(0.12, placement.width - 0.08),
          1,
          Math.max(0.12, placement.height - 0.08),
        );
        this.tempObject.updateMatrix();
        mesh.setMatrixAt(slot, this.tempObject.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.planRoot.add(mesh);
    }

    const detailBatches = new Map<
      string,
      {
        readonly state: BlueprintOverlayState;
        readonly kind: string;
        readonly indices: number[];
      }
    >();
    for (const index of layout.detailIndices) {
      const placement = layout.placements[index]!;
      const key = `${placement.state}:${placement.kind}`;
      const batch = detailBatches.get(key) ?? {
        state: placement.state,
        kind: placement.kind,
        indices: [],
      };
      batch.indices.push(index);
      detailBatches.set(key, batch);
    }
    for (const [key, batch] of detailBatches) {
      const mesh = new THREE.InstancedMesh(
        this.kindGeometry(batch.kind),
        this.stateMaterials.get(batch.state)!.detail,
        batch.indices.length,
      );
      mesh.name = `blueprint-detail-${key}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = 72;
      for (let slot = 0; slot < batch.indices.length; slot += 1) {
        const placement = layout.placements[batch.indices[slot]!]!;
        const symbolScale =
          Math.max(0.55, Math.min(placement.width, placement.height) * 0.72);
        this.tempObject.position.set(
          placement.centerX,
          DETAIL_Y,
          placement.centerZ,
        );
        this.tempObject.rotation.set(
          0,
          -(Number(placement.direction) * Math.PI) / 2,
          0,
        );
        this.tempObject.scale.set(symbolScale, 1, symbolScale);
        this.tempObject.updateMatrix();
        mesh.setMatrixAt(slot, this.tempObject.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.planRoot.add(mesh);
    }

    const boundaryGeometry = createBoundaryGeometry(
      layout.boundary.minX,
      layout.boundary.minZ,
      layout.boundary.maxX,
      layout.boundary.maxZ,
      DETAIL_Y + 0.03,
    );
    this.planDynamicGeometries.add(boundaryGeometry);
    const boundaryMaterial =
      this.stateMaterials.get(
        layout.counts.blocked > 0 ? "blocked" : "construct",
      )!.detail;
    const boundary = new THREE.LineSegments(
      boundaryGeometry,
      boundaryMaterial,
    );
    boundary.name = "blueprint-plan-boundary";
    boundary.renderOrder = 73;
    this.planRoot.add(boundary);

    const pivot = new THREE.Mesh(
      this.markerGeometry,
      this.stateMaterials.get("configure")!.detail,
    );
    pivot.name = "blueprint-plan-pivot";
    pivot.position.set(layout.pivot.x, DETAIL_Y + 0.11, layout.pivot.z);
    pivot.scale.setScalar(1.25);
    pivot.renderOrder = 74;
    this.planRoot.add(pivot);

    this.planSignature = layout.signature;
    this.debug = Object.freeze({
      signature: layout.signature,
      total: layout.placements.length,
      detailed: layout.detailIndices.length,
      batches: layout.batches.length,
      counts: Object.freeze({ ...layout.counts }),
      captureIncluded: this.debug.captureIncluded,
    });
  }

  setCaptureMarquee(marquee: BlueprintCaptureMarquee | null): void {
    this.assertLive();
    const signature = marquee
      ? [
          marquee.boundary.minX,
          marquee.boundary.minZ,
          marquee.boundary.maxX,
          marquee.boundary.maxZ,
          marquee.includedIds.join(","),
        ].join(":")
      : null;
    if (signature === this.captureSignature) return;
    this.clearCapture();
    if (!marquee) {
      this.refreshDebug();
      return;
    }

    const fill = new THREE.Mesh(
      this.plateGeometry,
      this.captureFillMaterial,
    );
    fill.name = "blueprint-capture-inclusion-field";
    fill.position.set(
      (marquee.boundary.minX + marquee.boundary.maxX) * 0.5,
      OVERLAY_Y + 0.018,
      (marquee.boundary.minZ + marquee.boundary.maxZ) * 0.5,
    );
    fill.scale.set(
      Math.max(0.08, marquee.width - 0.04),
      1,
      Math.max(0.08, marquee.height - 0.04),
    );
    fill.renderOrder = 75;
    this.captureRoot.add(fill);

    const boundaryGeometry = createBoundaryGeometry(
      marquee.boundary.minX,
      marquee.boundary.minZ,
      marquee.boundary.maxX,
      marquee.boundary.maxZ,
      DETAIL_Y + 0.08,
    );
    this.captureDynamicGeometries.add(boundaryGeometry);
    const boundary = new THREE.LineSegments(
      boundaryGeometry,
      this.captureLineMaterial,
    );
    boundary.name = "blueprint-capture-boundary";
    boundary.renderOrder = 77;
    this.captureRoot.add(boundary);

    const visibleMarkerCount = Math.min(32, marquee.includedIds.length);
    if (visibleMarkerCount > 0) {
      const markers = new THREE.InstancedMesh(
        this.markerGeometry,
        this.captureMarkerMaterial,
        visibleMarkerCount,
      );
      markers.name = "blueprint-capture-included-entity-register";
      markers.frustumCulled = false;
      markers.renderOrder = 78;
      const span = Math.max(0.4, marquee.width - 0.3);
      for (let index = 0; index < visibleMarkerCount; index += 1) {
        const row = Math.floor(index / 16);
        const column = index % 16;
        const columns = Math.min(16, visibleMarkerCount - row * 16);
        const x =
          marquee.boundary.minX +
          0.15 +
          (columns <= 1 ? 0 : (column / (columns - 1)) * span);
        this.tempObject.position.set(
          x,
          DETAIL_Y + 0.12,
          marquee.boundary.minZ + 0.12 + row * 0.2,
        );
        this.tempObject.rotation.set(0, Math.PI / 4, 0);
        this.tempObject.scale.setScalar(index === 31 ? 1.35 : 1);
        this.tempObject.updateMatrix();
        markers.setMatrixAt(index, this.tempObject.matrix);
      }
      markers.instanceMatrix.needsUpdate = true;
      this.captureRoot.add(markers);
    }

    this.captureSignature = signature;
    this.debug = Object.freeze({
      ...this.debug,
      captureIncluded: marquee.includedIds.length,
    });
  }

  getDebug(): BlueprintOverlayRenderDebug {
    return this.debug;
  }

  dispose(): void {
    if (this.disposed) return;
    this.clearPlan();
    this.clearCapture();
    this.root.removeFromParent();
    this.plateGeometry.dispose();
    this.markerGeometry.dispose();
    for (const geometry of this.kindGeometries.values()) geometry.dispose();
    this.kindGeometries.clear();
    for (const materials of this.stateMaterials.values()) {
      materials.plate.dispose();
      materials.detail.dispose();
    }
    this.stateMaterials.clear();
    this.captureFillMaterial.dispose();
    this.captureLineMaterial.dispose();
    this.captureMarkerMaterial.dispose();
    this.disposed = true;
  }

  private kindGeometry(kind: string): THREE.BufferGeometry {
    const existing = this.kindGeometries.get(kind);
    if (existing) return existing;
    const geometry = createKindGlyph(kind);
    this.kindGeometries.set(kind, geometry);
    return geometry;
  }

  private clearPlan(): void {
    this.releaseInstancedMeshes(this.planRoot);
    this.planRoot.clear();
    this.planSignature = null;
    this.disposeDynamicGeometries(this.planDynamicGeometries);
    this.debug = Object.freeze({
      signature: null,
      total: 0,
      detailed: 0,
      batches: 0,
      counts: EMPTY_COUNTS,
      captureIncluded: this.debug.captureIncluded,
    });
  }

  private clearCapture(): void {
    this.releaseInstancedMeshes(this.captureRoot);
    this.captureRoot.clear();
    this.captureSignature = null;
    this.disposeDynamicGeometries(this.captureDynamicGeometries);
    this.debug = Object.freeze({
      ...this.debug,
      captureIncluded: 0,
    });
  }

  private disposeDynamicGeometries(
    geometries: Set<THREE.BufferGeometry>,
  ): void {
    for (const geometry of geometries) geometry.dispose();
    geometries.clear();
  }

  private releaseInstancedMeshes(root: THREE.Object3D): void {
    root.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
  }

  private refreshDebug(): void {
    this.debug = Object.freeze({
      signature: this.planSignature,
      total: this.debug.total,
      detailed: this.debug.detailed,
      batches: this.debug.batches,
      counts: this.debug.counts,
      captureIncluded: this.captureSignature
        ? this.debug.captureIncluded
        : 0,
    });
  }

  private assertLive(): void {
    if (this.disposed) {
      throw new Error("Blueprint overlay renderer is disposed.");
    }
  }
}
