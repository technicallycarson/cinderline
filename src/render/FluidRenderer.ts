import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ENTITY_PROTOTYPES } from "../game/catalog";
import {
  Direction,
  type EntityStatus,
  type FluidEntityKind,
  type FluidEntityState,
  type FluidId,
  type FluidNetworkSnapshot,
} from "../game/types";

export interface FluidVisualEntity {
  readonly id: number;
  readonly kind: FluidEntityKind;
  readonly x: number;
  readonly z: number;
  readonly direction: Direction;
  readonly status: EntityStatus;
  readonly powerSatisfaction: number;
  readonly fluidState: FluidEntityState;
}

export interface FluidVisualFrame {
  readonly elapsedSeconds: number;
  readonly fluidEntities: readonly FluidVisualEntity[];
  readonly fluidNetwork: FluidNetworkSnapshot;
}

export interface FluidRenderDebug {
  readonly entities: number;
  readonly pipes: number;
  readonly sources: number;
  readonly pumps: number;
  readonly tanks: number;
  readonly processors: number;
  readonly edges: number;
  readonly flowPulses: number;
  readonly drawBatches: number;
  readonly storedMilli: Readonly<Record<FluidId, number>>;
}

interface FluidRig {
  readonly kind: Exclude<FluidEntityKind, "fluidPipe">;
  readonly root: THREE.Group;
  readonly ownedGeometries: THREE.BufferGeometry[];
  readonly rotor?: THREE.Object3D;
  readonly secondaryRotor?: THREE.Object3D;
  readonly actuator?: THREE.Object3D;
  readonly polishedRod?: THREE.Object3D;
  readonly pitmanArm?: THREE.Object3D;
  readonly bridleRods?: readonly THREE.Object3D[];
  readonly bridleCarrier?: THREE.Object3D;
  readonly processStageIndicators?: readonly THREE.Mesh[];
  readonly processFeedSlug?: THREE.Mesh;
  readonly processProductSlug?: THREE.Mesh;
  readonly reliefSpring?: THREE.Object3D;
  readonly tankPressureSprings?: readonly THREE.Object3D[];
  readonly tankVentCaps?: readonly THREE.Object3D[];
  readonly valveHandles?: readonly THREE.Object3D[];
  readonly gaugeNeedles?: readonly THREE.Object3D[];
  readonly heatWindows?: readonly THREE.Mesh[];
  readonly reliefCap?: THREE.Object3D;
  readonly sight?: THREE.Mesh;
  readonly sightMirrors?: readonly THREE.Mesh[];
  readonly sightFrame?: THREE.Object3D;
  readonly levelIndicator?: THREE.Mesh;
  readonly levelNeedle?: THREE.Object3D;
  readonly roofLevelDisc?: THREE.Mesh;
  readonly status?: THREE.Mesh;
  readonly inputSight?: THREE.Mesh;
  readonly outputSight?: THREE.Mesh;
  readonly inputSightMirrors?: readonly THREE.Mesh[];
  readonly outputSightMirrors?: readonly THREE.Mesh[];
  readonly steamPlumes?: readonly THREE.Sprite[];
  readonly pressureValve?: THREE.Object3D;
  readonly shutdownGate?: THREE.Object3D;
  readonly statusLight?: THREE.PointLight;
  readonly heatLight?: THREE.PointLight;
  readonly statusHalo?: THREE.Mesh;
}

interface FluidMaterials {
  readonly steel: THREE.MeshStandardMaterial;
  readonly steelDark: THREE.MeshStandardMaterial;
  readonly titanium: THREE.MeshStandardMaterial;
  readonly copper: THREE.MeshStandardMaterial;
  readonly brass: THREE.MeshStandardMaterial;
  readonly paintedSteel: THREE.MeshStandardMaterial;
  readonly oxidizedSteel: THREE.MeshStandardMaterial;
  readonly structuralMid: THREE.MeshStandardMaterial;
  readonly nozzleSteel: THREE.MeshStandardMaterial;
  readonly rust: THREE.MeshStandardMaterial;
  readonly soot: THREE.MeshStandardMaterial;
  readonly weld: THREE.MeshStandardMaterial;
  readonly heatOxide: THREE.MeshStandardMaterial;
  readonly gaugeFace: THREE.MeshStandardMaterial;
  readonly foundation: THREE.MeshStandardMaterial;
  readonly serviceFloor: THREE.MeshStandardMaterial;
  readonly yardAggregate: THREE.MeshStandardMaterial;
  readonly safetyPaint: THREE.MeshStandardMaterial;
  readonly enamel: THREE.MeshStandardMaterial;
  readonly ceramic: THREE.MeshStandardMaterial;
  readonly rubber: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshPhysicalMaterial;
  readonly crude: THREE.MeshPhysicalMaterial;
  readonly refined: THREE.MeshPhysicalMaterial;
  readonly active: THREE.MeshStandardMaterial;
  readonly warning: THREE.MeshStandardMaterial;
  readonly inactive: THREE.MeshStandardMaterial;
  readonly groundStain: THREE.MeshStandardMaterial;
  readonly steam: THREE.SpriteMaterial;
  readonly steamTexture: THREE.DataTexture;
  readonly all: readonly THREE.Material[];
}

const EMPTY_STORED: Readonly<Record<FluidId, number>> = Object.freeze({
  crudeOil: 0,
  refinedFuel: 0,
});

const UP = new THREE.Vector3(0, 1, 0);
const PIPE_SHELL_TINTS = Object.freeze({
  crudeOil: new THREE.Color(0xb6beb9),
  refinedFuel: new THREE.Color(0xb6beb9),
  empty: new THREE.Color(0xadb5b0),
  held: new THREE.Color(0x9c9186),
});
const PIPE_WINDOW_TINTS = Object.freeze({
  moving: new THREE.Color(0xffffff),
  pressureHeld: new THREE.Color(0xff8b3d),
});
const PIPE_FORWARD: Readonly<Record<Direction, THREE.Vector3>> = Object.freeze({
  [Direction.North]: new THREE.Vector3(0, 0, -1),
  [Direction.East]: new THREE.Vector3(1, 0, 0),
  [Direction.South]: new THREE.Vector3(0, 0, 1),
  [Direction.West]: new THREE.Vector3(-1, 0, 0),
});
const PIPE_CENTER_Y = 0.52;

function mergeOwnedGeometries(
  geometries: THREE.BufferGeometry[],
  label: string,
): THREE.BufferGeometry {
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  if (!merged) {
    throw new Error(`Unable to construct ${label}.`);
  }
  merged.name = label;
  return merged;
}

function createBoltedFlangeGeometry(): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [
    new THREE.CylinderGeometry(1, 1, 1, 20, 1),
  ];
  for (let index = 0; index < 8; index += 1) {
    const angle = (index * Math.PI * 2) / 8;
    const bolt = new THREE.CylinderGeometry(0.072, 0.072, 1.34, 8, 1);
    bolt.translate(Math.cos(angle) * 0.72, 0, Math.sin(angle) * 0.72);
    geometries.push(bolt);
  }
  return mergeOwnedGeometries(geometries, "fluid-bolted-flange-geometry");
}

function createPipeArmGeometry(): THREE.BufferGeometry {
  const shell = new THREE.CylinderGeometry(1, 1, 1, 18, 1, false);
  const seamA = new THREE.TorusGeometry(1.008, 0.026, 5, 18);
  seamA.rotateX(Math.PI / 2);
  seamA.translate(0, -0.29, 0);
  const seamB = seamA.clone();
  seamB.translate(0, 0.58, 0);
  return mergeOwnedGeometries(
    [shell, seamA, seamB],
    "fluid-welded-process-pipe-arm-geometry",
  );
}

function createPipeSupportGeometry(): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];
  for (const x of [-0.31, 0.31]) {
    const sleeper = new THREE.BoxGeometry(0.28, 0.055, 0.84);
    sleeper.translate(x, 0.0275, 0);
    geometries.push(sleeper);
    const column = new THREE.BoxGeometry(0.09, 0.39, 0.09);
    column.translate(x, 0.235, 0);
    geometries.push(column);
    for (const direction of [-1, 1]) {
      const gusset = new THREE.BoxGeometry(0.055, 0.38, 0.055);
      gusset.rotateZ(direction * 0.55);
      gusset.translate(x - direction * 0.095, 0.225, 0);
      geometries.push(gusset);
    }
  }
  const rackTie = new THREE.BoxGeometry(0.78, 0.075, 0.11);
  rackTie.translate(0, 0.44, 0);
  geometries.push(rackTie);
  const saddle = new THREE.TorusGeometry(0.205, 0.055, 7, 18, Math.PI);
  saddle.rotateZ(Math.PI);
  saddle.translate(0, 0.505, 0);
  geometries.push(saddle);
  const junction = new THREE.CylinderGeometry(0.245, 0.245, 0.31, 16, 1);
  junction.rotateZ(Math.PI / 2);
  junction.translate(0, 0.52, 0);
  geometries.push(junction);
  for (const x of [-0.28, 0.28]) {
    const collar = new THREE.TorusGeometry(0.252, 0.027, 6, 16);
    collar.rotateY(Math.PI / 2);
    collar.translate(x, 0.52, 0);
    geometries.push(collar);
  }
  const serviceClip = new THREE.BoxGeometry(0.32, 0.045, 0.62);
  serviceClip.translate(0, 0.105, 0);
  geometries.push(serviceClip);
  return mergeOwnedGeometries(
    geometries,
    "fluid-trussed-rack-saddle-and-junction-geometry",
  );
}

function createNetworkCouplingGeometry(): THREE.BufferGeometry {
  const shell = new THREE.CylinderGeometry(1, 1, 1, 18, 1, true);
  const flangeA = new THREE.CylinderGeometry(1.34, 1.34, 0.16, 20, 1);
  flangeA.translate(0, -0.46, 0);
  const flangeB = flangeA.clone();
  flangeB.translate(0, 0.92, 0);
  const geometries: THREE.BufferGeometry[] = [shell, flangeA, flangeB];
  for (const end of [-0.46, 0.46]) {
    for (let index = 0; index < 8; index += 1) {
      const angle = (index * Math.PI * 2) / 8;
      const bolt = new THREE.CylinderGeometry(0.1, 0.1, 0.21, 8, 1);
      bolt.translate(Math.cos(angle) * 0.95, end, Math.sin(angle) * 0.95);
      geometries.push(bolt);
    }
  }
  return mergeOwnedGeometries(
    geometries,
    "fluid-authoritative-boundary-coupling-geometry",
  );
}

function createMaterials(): FluidMaterials {
  const steel = new THREE.MeshStandardMaterial({
    color: 0x98a19b,
    emissive: 0x18201c,
    emissiveIntensity: 0.07,
    roughness: 0.56,
    metalness: 0.46,
  });
  const steelDark = new THREE.MeshStandardMaterial({
    color: 0x616b65,
    emissive: 0x111714,
    emissiveIntensity: 0.07,
    roughness: 0.7,
    metalness: 0.34,
  });
  const titanium = new THREE.MeshStandardMaterial({
    color: 0x929c96,
    emissive: 0x161b18,
    emissiveIntensity: 0.055,
    roughness: 0.39,
    metalness: 0.6,
  });
  const copper = new THREE.MeshStandardMaterial({
    color: 0xb77c5d,
    emissive: 0x160905,
    emissiveIntensity: 0.035,
    roughness: 0.7,
    metalness: 0.38,
  });
  const brass = new THREE.MeshStandardMaterial({
    color: 0xb4945d,
    emissive: 0x130e04,
    emissiveIntensity: 0.035,
    roughness: 0.58,
    metalness: 0.5,
  });
  const paintedSteel = new THREE.MeshStandardMaterial({
    color: 0x7c8e84,
    emissive: 0x122019,
    emissiveIntensity: 0.085,
    roughness: 0.62,
    metalness: 0.3,
  });
  const oxidizedSteel = new THREE.MeshStandardMaterial({
    color: 0x707a74,
    emissive: 0x121814,
    emissiveIntensity: 0.075,
    roughness: 0.78,
    metalness: 0.27,
  });
  const structuralMid = new THREE.MeshStandardMaterial({
    color: 0x717c76,
    emissive: 0x111a16,
    emissiveIntensity: 0.07,
    roughness: 0.64,
    metalness: 0.38,
  });
  const nozzleSteel = new THREE.MeshStandardMaterial({
    color: 0x858f89,
    emissive: 0x141916,
    emissiveIntensity: 0.06,
    roughness: 0.56,
    metalness: 0.48,
  });
  const rust = new THREE.MeshStandardMaterial({
    color: 0x8d4d37,
    emissive: 0x100503,
    emissiveIntensity: 0.025,
    roughness: 0.92,
    metalness: 0.12,
  });
  const soot = new THREE.MeshStandardMaterial({
    color: 0x2e302c,
    emissive: 0x060706,
    emissiveIntensity: 0.02,
    roughness: 0.94,
    metalness: 0.02,
  });
  const weld = new THREE.MeshStandardMaterial({
    color: 0x78827c,
    roughness: 0.52,
    metalness: 0.48,
  });
  const heatOxide = new THREE.MeshStandardMaterial({
    color: 0x713c30,
    emissive: 0x0e0403,
    emissiveIntensity: 0.025,
    roughness: 0.76,
    metalness: 0.3,
  });
  const gaugeFace = new THREE.MeshStandardMaterial({
    color: 0xd8d0b6,
    roughness: 0.82,
    metalness: 0.05,
  });
  const foundation = new THREE.MeshStandardMaterial({
    color: 0x514a3e,
    emissive: 0x080705,
    emissiveIntensity: 0.02,
    roughness: 0.94,
    metalness: 0.03,
  });
  const serviceFloor = new THREE.MeshStandardMaterial({
    color: 0x5c625b,
    emissive: 0x090a09,
    emissiveIntensity: 0.02,
    roughness: 0.86,
    metalness: 0.22,
  });
  const yardAggregate = new THREE.MeshStandardMaterial({
    color: 0xa99d83,
    roughness: 1,
    metalness: 0.01,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const safetyPaint = new THREE.MeshStandardMaterial({
    color: 0xb26a32,
    roughness: 0.72,
    metalness: 0.14,
  });
  const enamel = new THREE.MeshStandardMaterial({
    color: 0x667c72,
    emissive: 0x0b1411,
    emissiveIntensity: 0.04,
    roughness: 0.67,
    metalness: 0.18,
  });
  const ceramic = new THREE.MeshStandardMaterial({
    color: 0xb9b49f,
    emissive: 0x2d2a20,
    emissiveIntensity: 0.1,
    roughness: 0.78,
    metalness: 0.08,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x3d4844,
    emissive: 0x111715,
    emissiveIntensity: 0.22,
    roughness: 0.96,
    metalness: 0.01,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x9bc6c5,
    roughness: 0.15,
    metalness: 0,
    transmission: 0.32,
    thickness: 0.08,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });
  const crude = new THREE.MeshPhysicalMaterial({
    color: 0x7a3f20,
    emissive: 0x150600,
    emissiveIntensity: 0.02,
    roughness: 0.36,
    metalness: 0.08,
    transmission: 0.02,
    transparent: true,
    opacity: 0.74,
  });
  const refined = new THREE.MeshPhysicalMaterial({
    color: 0x72c2b2,
    emissive: 0x0a5147,
    emissiveIntensity: 0.1,
    roughness: 0.27,
    metalness: 0.03,
    transmission: 0.08,
    transparent: true,
    opacity: 0.8,
  });
  const active = new THREE.MeshStandardMaterial({
    color: 0x8ed6bd,
    emissive: 0x1f806f,
    emissiveIntensity: 0.7,
    roughness: 0.32,
    metalness: 0.1,
  });
  const warning = new THREE.MeshStandardMaterial({
    color: 0xf0a24b,
    emissive: 0x9c350d,
    emissiveIntensity: 0.85,
    roughness: 0.4,
    metalness: 0.1,
  });
  const inactive = new THREE.MeshStandardMaterial({
    color: 0x5b696a,
    emissive: 0x0d1717,
    emissiveIntensity: 0.18,
    roughness: 0.7,
    metalness: 0.25,
  });
  const groundStain = new THREE.MeshStandardMaterial({
    color: 0x302a23,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const steamPixels = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const nx = (x + 0.5) / 32 - 1;
      const vertical = y / 63;
      const plumeWidth = 0.2 + vertical * 0.42;
      const centerDrift = Math.sin(vertical * 8.4) * 0.075;
      const radialX = (nx - centerDrift) / plumeWidth;
      const radialY = (vertical - 0.46) / 0.58;
      const envelope = 1 - Math.sqrt(radialX * radialX + radialY * radialY);
      const edgeTaper =
        Math.min(1, vertical / 0.11) *
        Math.min(1, (1 - vertical) / 0.13);
      const turbulence =
        Math.sin(x * 0.63 + y * 0.21) *
          Math.sin(y * 0.49 - x * 0.17) *
          0.11;
      const alpha = Math.max(
        0,
        Math.min(1, (envelope * 1.38 + turbulence) * edgeTaper),
      );
      const offset = (y * 64 + x) * 4;
      steamPixels[offset] = 225;
      steamPixels[offset + 1] = 237;
      steamPixels[offset + 2] = 232;
      steamPixels[offset + 3] = Math.round(alpha * alpha * 255);
    }
  }
  const steamTexture = new THREE.DataTexture(
    steamPixels,
    64,
    64,
    THREE.RGBAFormat,
  );
  steamTexture.name = "fluid-soft-process-vapor";
  steamTexture.colorSpace = THREE.SRGBColorSpace;
  steamTexture.minFilter = THREE.LinearFilter;
  steamTexture.magFilter = THREE.LinearFilter;
  steamTexture.needsUpdate = true;
  const steam = new THREE.SpriteMaterial({
    color: 0xbacbc6,
    map: steamTexture,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  return {
    steel,
    steelDark,
    titanium,
    copper,
    brass,
    paintedSteel,
    oxidizedSteel,
    structuralMid,
    nozzleSteel,
    rust,
    soot,
    weld,
    heatOxide,
    gaugeFace,
    foundation,
    serviceFloor,
    yardAggregate,
    safetyPaint,
    enamel,
    ceramic,
    rubber,
    glass,
    crude,
    refined,
    active,
    warning,
    inactive,
    groundStain,
    steam,
    steamTexture,
    all: [
      steel,
      steelDark,
      titanium,
      copper,
      brass,
      paintedSteel,
      oxidizedSteel,
      structuralMid,
      nozzleSteel,
      rust,
      soot,
      weld,
      heatOxide,
      gaugeFace,
      foundation,
      serviceFloor,
      yardAggregate,
      safetyPaint,
      enamel,
      ceramic,
      rubber,
      glass,
      crude,
      refined,
      active,
      warning,
      inactive,
      groundStain,
      steam,
    ],
  };
}

function footprint(
  entity: FluidVisualEntity,
): { readonly width: number; readonly height: number } {
  const base = ENTITY_PROTOTYPES[entity.kind].footprint;
  return entity.direction === Direction.East ||
    entity.direction === Direction.West
    ? { width: base.height, height: base.width }
    : { width: base.width, height: base.height };
}

function oppositeDirection(direction: Direction): Direction {
  return ((direction + 2) % 4) as Direction;
}

function entityCenter(
  entity: FluidVisualEntity,
): { readonly x: number; readonly z: number } {
  const size = footprint(entity);
  return {
    x: entity.x + size.width * 0.5,
    z: entity.z + size.height * 0.5,
  };
}

function directionToward(
  source: FluidVisualEntity,
  target: FluidVisualEntity,
): Direction {
  const sourceSize = footprint(source);
  const targetSize = footprint(target);
  if (source.x + sourceSize.width <= target.x) return Direction.East;
  if (target.x + targetSize.width <= source.x) return Direction.West;
  if (source.z + sourceSize.height <= target.z) return Direction.South;
  if (target.z + targetSize.height <= source.z) return Direction.North;
  const sourceCenter = entityCenter(source);
  const targetCenter = entityCenter(target);
  const dx = targetCenter.x - sourceCenter.x;
  const dz = targetCenter.z - sourceCenter.z;
  if (Math.abs(dx) >= Math.abs(dz)) {
    return dx >= 0 ? Direction.East : Direction.West;
  }
  return dz >= 0 ? Direction.South : Direction.North;
}

function portAnchor(
  entity: FluidVisualEntity,
  direction: Direction,
  inset = 0,
): THREE.Vector3 {
  const size = footprint(entity);
  switch (direction) {
    case Direction.North:
      return new THREE.Vector3(
        entity.x + size.width * 0.5,
        PIPE_CENTER_Y,
        entity.z + inset,
      );
    case Direction.East:
      return new THREE.Vector3(
        entity.x + size.width - inset,
        PIPE_CENTER_Y,
        entity.z + size.height * 0.5,
      );
    case Direction.South:
      return new THREE.Vector3(
        entity.x + size.width * 0.5,
        PIPE_CENTER_Y,
        entity.z + size.height - inset,
      );
    case Direction.West:
      return new THREE.Vector3(
        entity.x + inset,
        PIPE_CENTER_Y,
        entity.z + size.height * 0.5,
      );
  }
}

function fluidOf(entity: FluidVisualEntity): {
  readonly id?: FluidId;
  readonly amount: number;
  readonly capacity: number;
} {
  const state = entity.fluidState;
  if (entity.kind === "fluidProcessor") {
    const output = state.output!;
    if (output.amountMilli > 0) {
      return {
        id: output.fluidId,
        amount: output.amountMilli,
        capacity: output.capacityMilli,
      };
    }
    const input = state.input!;
    return {
      id: input.fluidId,
      amount: input.amountMilli,
      capacity: input.capacityMilli,
    };
  }
  const buffer = state.buffer!;
  return {
    id: buffer.fluidId,
    amount: buffer.amountMilli,
    capacity: buffer.capacityMilli,
  };
}

function beamMatrix(
  object: THREE.Object3D,
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
): void {
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const direction = end.clone().sub(start);
  const length = direction.length();
  object.position.copy(midpoint);
  object.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  object.scale.set(radius, Math.max(0.001, length), radius);
  object.updateMatrix();
}

function disposeRig(rig: FluidRig): void {
  rig.root.removeFromParent();
  rig.root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) object.dispose();
  });
  for (const geometry of rig.ownedGeometries) geometry.dispose();
}

export class FluidRenderer {
  readonly root = new THREE.Group();

  private readonly districtRoot = new THREE.Group();
  private readonly pipeRoot = new THREE.Group();
  private readonly machineRoot = new THREE.Group();
  private readonly networkRoot = new THREE.Group();
  private readonly materials = createMaterials();
  private readonly surfaceTextures: THREE.Texture[] = [];
  private readonly rigs = new Map<number, FluidRig>();
  private readonly temp = new THREE.Object3D();
  private readonly tempStart = new THREE.Vector3();
  private readonly tempEnd = new THREE.Vector3();
  private readonly pipeOuterGeometry = createPipeArmGeometry();
  private readonly pipeInnerGeometry = new THREE.CylinderGeometry(
    1,
    1,
    1,
    14,
    1,
    true,
  );
  private readonly pipeFlangeGeometry = createBoltedFlangeGeometry();
  private readonly pipeSupportGeometry = createPipeSupportGeometry();
  private readonly networkBeamGeometry = createNetworkCouplingGeometry();
  private readonly pulseGeometry = new THREE.CylinderGeometry(
    1,
    1,
    1,
    14,
    1,
    true,
  );
  private pipeOuter: THREE.InstancedMesh | null = null;
  private pipeCrude: THREE.InstancedMesh | null = null;
  private pipeRefined: THREE.InstancedMesh | null = null;
  private pipeFlanges: THREE.InstancedMesh | null = null;
  private pipeSupports: THREE.InstancedMesh | null = null;
  private networkBeams: THREE.InstancedMesh | null = null;
  private crudePulses: THREE.InstancedMesh | null = null;
  private refinedPulses: THREE.InstancedMesh | null = null;
  private pipeCapacity = 0;
  private edgeCapacity = 0;
  private pulseCapacity = 0;
  private districtSignature = "";
  private districtYard: THREE.Mesh | null = null;
  private districtFoundation: THREE.Mesh | null = null;
  private districtDrainage: THREE.Mesh | null = null;
  private districtMarkings: THREE.Mesh | null = null;
  private districtSteelwork: THREE.Mesh | null = null;
  private districtPipework: THREE.Mesh | null = null;
  private districtVesselSpools: THREE.Mesh | null = null;
  private districtFittings: THREE.Mesh | null = null;
  private districtAccess: THREE.Mesh | null = null;
  private districtCladding: THREE.Mesh | null = null;
  private districtDebris: THREE.Mesh | null = null;
  private districtWear: THREE.Mesh | null = null;
  private disposed = false;
  private debug: FluidRenderDebug = Object.freeze({
    entities: 0,
    pipes: 0,
    sources: 0,
    pumps: 0,
    tanks: 0,
    processors: 0,
    edges: 0,
    flowPulses: 0,
    drawBatches: 0,
    storedMilli: EMPTY_STORED,
  });

  constructor(parent: THREE.Object3D) {
    this.root.name = "fluid-world-system";
    this.districtRoot.name = "fluid-refinery-district-service-floor-system";
    this.pipeRoot.name = "fluid-pipe-batches";
    this.machineRoot.name = "fluid-machine-rigs";
    this.networkRoot.name = "fluid-network-couplings";
    this.root.add(
      this.districtRoot,
      this.pipeRoot,
      this.machineRoot,
      this.networkRoot,
    );
    parent.add(this.root);
    this.loadAuthoredSurfaceMaps();
  }

  sync(frame: FluidVisualFrame): void {
    this.assertLive();
    const sorted = [...frame.fluidEntities].sort(
      (left, right) =>
        left.z - right.z ||
        left.x - right.x ||
        left.kind.localeCompare(right.kind) ||
        left.id - right.id,
    );
    const pipes = sorted.filter(
      (entity): entity is FluidVisualEntity & { kind: "fluidPipe" } =>
        entity.kind === "fluidPipe",
    );
    this.syncDistrict(sorted, frame.fluidNetwork);
    this.syncPipes(pipes, frame.elapsedSeconds, frame.fluidNetwork, sorted);
    this.syncMachines(
      sorted.filter(
        (
          entity,
        ): entity is FluidVisualEntity & {
          kind: Exclude<FluidEntityKind, "fluidPipe">;
        } => entity.kind !== "fluidPipe",
      ),
      frame.elapsedSeconds,
      frame.fluidNetwork,
    );
    const pulseCount = this.syncNetwork(frame, sorted);
    const systemBackpressured = sorted.some(
      (entity) =>
        entity.kind === "fluidProcessor" &&
        (entity.status === "blocked" || entity.status === "outputFull"),
    );
    if (this.districtPipework) {
      // Pressure is shown by owned gauges, valve travel, tank level and the
      // relief lift. Recoloring an entire process header made steel resemble
      // luminous fluid and obscured its physical continuity.
      this.districtPipework.material = this.materials.oxidizedSteel;
      this.districtPipework.userData.operatingState = systemBackpressured
        ? "pressure-held-header"
        : "available-capacity";
    }
    if (this.districtFittings) {
      this.districtFittings.material = this.materials.copper;
      this.districtFittings.userData.operatingState = systemBackpressured
        ? "relief-ready-flange-train"
        : "normal-transfer";
    }
    this.root.userData.systemPressureState = systemBackpressured
      ? "backpressured"
      : "normal";

    const storedMilli: Record<FluidId, number> = {
      crudeOil: 0,
      refinedFuel: 0,
    };
    for (const entity of sorted) {
      const state = entity.fluidState;
      for (const box of [state.buffer, state.input, state.output]) {
        if (box?.fluidId) storedMilli[box.fluidId] += box.amountMilli;
      }
    }
    this.root.visible = sorted.length > 0;
    this.debug = Object.freeze({
      entities: sorted.length,
      pipes: pipes.length,
      sources: sorted.filter(({ kind }) => kind === "fluidSource").length,
      pumps: sorted.filter(({ kind }) => kind === "fluidPump").length,
      tanks: sorted.filter(({ kind }) => kind === "fluidTank").length,
      processors: sorted.filter(({ kind }) => kind === "fluidProcessor").length,
      edges: frame.fluidNetwork.edges.length,
      flowPulses: pulseCount,
      drawBatches:
        [
          this.pipeOuter,
          this.pipeCrude,
          this.pipeRefined,
          this.pipeFlanges,
          this.pipeSupports,
          this.networkBeams,
          this.crudePulses,
          this.refinedPulses,
        ].filter((mesh) => mesh && mesh.count > 0).length + this.rigs.size,
      storedMilli: Object.freeze(storedMilli),
    });
  }

  getDebug(): FluidRenderDebug {
    return this.debug;
  }

  dispose(): void {
    if (this.disposed) return;
    for (const rig of this.rigs.values()) disposeRig(rig);
    this.rigs.clear();
    this.releaseDistrict();
    this.releasePipeBatches();
    this.releaseNetworkBatches();
    this.root.removeFromParent();
    this.pipeOuterGeometry.dispose();
    this.pipeInnerGeometry.dispose();
    this.pipeFlangeGeometry.dispose();
    this.pipeSupportGeometry.dispose();
    this.networkBeamGeometry.dispose();
    this.pulseGeometry.dispose();
    for (const texture of this.surfaceTextures) texture.dispose();
    this.surfaceTextures.length = 0;
    this.materials.steamTexture.dispose();
    for (const material of this.materials.all) material.dispose();
    this.disposed = true;
  }

  private syncDistrict(
    entities: readonly FluidVisualEntity[],
    network: FluidNetworkSnapshot,
  ): void {
    const signature = [
      ...entities.map(
        (entity) =>
          `${entity.id}:${entity.kind}:${entity.x}:${entity.z}:${entity.direction}`,
      ),
      "|",
      ...network.edges.map(
        (edge) => `${edge.sourceEntityId}>${edge.targetEntityId}`,
      ),
    ].join(",");
    if (signature === this.districtSignature) return;
    this.releaseDistrict();
    this.districtSignature = signature;
    if (entities.length === 0) return;

    const entityById = new Map(entities.map((entity) => [entity.id, entity]));
    const adjacency = new Map<number, Set<number>>(
      entities.map((entity) => [entity.id, new Set<number>()]),
    );
    for (const edge of network.edges) {
      if (
        !entityById.has(edge.sourceEntityId) ||
        !entityById.has(edge.targetEntityId)
      ) {
        continue;
      }
      adjacency.get(edge.sourceEntityId)?.add(edge.targetEntityId);
      adjacency.get(edge.targetEntityId)?.add(edge.sourceEntityId);
    }
    const components: FluidVisualEntity[][] = [];
    const visited = new Set<number>();
    for (const entity of entities) {
      if (visited.has(entity.id)) continue;
      const component: FluidVisualEntity[] = [];
      const pending = [entity.id];
      visited.add(entity.id);
      while (pending.length > 0) {
        const id = pending.pop();
        if (id === undefined) break;
        const member = entityById.get(id);
        if (member) component.push(member);
        for (const neighbor of adjacency.get(id) ?? []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          pending.push(neighbor);
        }
      }
      components.push(component);
    }

    const yard: THREE.BufferGeometry[] = [];
    const foundations: THREE.BufferGeometry[] = [];
    const drainage: THREE.BufferGeometry[] = [];
    const markings: THREE.BufferGeometry[] = [];
    const steelwork: THREE.BufferGeometry[] = [];
    const pipework: THREE.BufferGeometry[] = [];
    const vesselSpools: THREE.BufferGeometry[] = [];
    const fittings: THREE.BufferGeometry[] = [];
    const access: THREE.BufferGeometry[] = [];
    const cladding: THREE.BufferGeometry[] = [];
    const debris: THREE.BufferGeometry[] = [];
    const wear: THREE.BufferGeometry[] = [];
    const routeAudit: Array<{
      readonly sourceEntityId: number;
      readonly targetEntityId: number;
      readonly sourceKind: FluidEntityKind;
      readonly targetKind: FluidEntityKind;
      readonly start: readonly [number, number, number];
      readonly end: readonly [number, number, number];
      readonly radius: number;
      readonly sourceInset: number;
      readonly targetInset: number;
    }> = [];
    const supportAudit: Array<{
      readonly entityId: number;
      readonly center: readonly [number, number, number];
      readonly groundContactY: number;
      readonly saddleCenterY: number;
    }> = [];
    const addBox = (
      target: THREE.BufferGeometry[],
      width: number,
      height: number,
      depth: number,
      x: number,
      y: number,
      z: number,
    ): void => {
      const geometry = new THREE.BoxGeometry(width, height, depth);
      geometry.translate(x, y, z);
      target.push(geometry);
    };
    const addOrientedBox = (
      target: THREE.BufferGeometry[],
      width: number,
      height: number,
      depth: number,
      x: number,
      y: number,
      z: number,
      rotationY: number,
    ): void => {
      const geometry = new THREE.BoxGeometry(width, height, depth);
      geometry.rotateY(rotationY);
      geometry.translate(x, y, z);
      target.push(geometry);
    };
    const addRoundLoadPoint = (
      target: THREE.BufferGeometry[],
      radius: number,
      height: number,
      x: number,
      y: number,
      z: number,
    ): void => {
      const geometry = new THREE.CylinderGeometry(
        radius,
        radius * 1.08,
        height,
        14,
      );
      geometry.translate(x, y, z);
      target.push(geometry);
    };
    const addCylinderBetween = (
      target: THREE.BufferGeometry[],
      start: THREE.Vector3,
      end: THREE.Vector3,
      radius: number,
      radialSegments = 18,
    ): void => {
      const direction = end.clone().sub(start);
      const length = direction.length();
      if (length <= 0.001) return;
      const geometry = new THREE.CylinderGeometry(
        radius,
        radius,
        length,
        radialSegments,
        1,
      );
      geometry.applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(
          UP,
          direction.normalize(),
        ),
      );
      geometry.translate(
        (start.x + end.x) * 0.5,
        (start.y + end.y) * 0.5,
        (start.z + end.z) * 0.5,
      );
      target.push(geometry);
    };
    const addAxialFitting = (
      target: THREE.BufferGeometry[],
      center: THREE.Vector3,
      direction: THREE.Vector3,
      radius: number,
      depth: number,
    ): void => {
      const geometry = new THREE.CylinderGeometry(
        radius,
        radius,
        depth,
        18,
        1,
      );
      geometry.applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(
          UP,
          direction.clone().normalize(),
        ),
      );
      geometry.translate(center.x, center.y, center.z);
      target.push(geometry);
    };
    const addWear = (
      x: number,
      z: number,
      radius: number,
      stretchX: number,
      stretchZ: number,
    ): void => {
      const stain = new THREE.CircleGeometry(radius, 16);
      stain.rotateX(-Math.PI / 2);
      stain.scale(stretchX, 1, stretchZ);
      stain.translate(x, 0.069, z);
      wear.push(stain);
    };

    if (
      entities.length >= 6 &&
      entities.some(
        ({ kind }) =>
          kind === "fluidProcessor" || kind === "fluidTank",
      )
    ) {
      const addYardShape = (
        points: readonly (readonly [number, number])[],
        elevation: number,
      ): void => {
        const shape = new THREE.Shape();
        shape.moveTo(points[0]![0], -points[0]![1]);
        for (const [x, z] of points.slice(1)) shape.lineTo(x, -z);
        shape.closePath();
        const geometry = new THREE.ShapeGeometry(shape);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, elevation, 0);
        yard.push(geometry);
      };
      const addIrregularPatch = (
        centerX: number,
        centerZ: number,
        radiusX: number,
        radiusZ: number,
        seed: number,
        elevation: number,
      ): void => {
        const points: [number, number][] = [];
        for (let point = 0; point < 10; point += 1) {
          const angle = (point / 10) * Math.PI * 2;
          const variation =
            0.88 +
            ((Math.sin(seed * 1.71 + point * 2.39) + 1) * 0.5) * 0.22;
          points.push([
            centerX + Math.cos(angle) * radiusX * variation,
            centerZ + Math.sin(angle) * radiusZ * variation,
          ]);
        }
        addYardShape(points, elevation);
      };

      // The yard follows the real service topology. Small translucent gravel
      // patches overlap beneath machines and true edge corridors, allowing the
      // native terrain to remain dominant and dissolving every outer boundary.
      for (const entity of entities) {
        if (entity.kind === "fluidPipe" || entity.kind === "fluidTank") {
          continue;
        }
        const size = footprint(entity);
        const center = entityCenter(entity);
        const padding =
          entity.kind === "fluidProcessor"
            ? 0.22
            : entity.kind === "fluidSource"
              ? 0.16
              : 0.08;
        addIrregularPatch(
          center.x,
          center.z,
          size.width * 0.5 + padding,
          size.height * 0.5 + padding,
          entity.id,
          0.011 + (entity.id % 3) * 0.0004,
        );
      }
      network.edges.forEach((edge, edgeIndex) => {
        const source = entityById.get(edge.sourceEntityId);
        const target = entityById.get(edge.targetEntityId);
        if (!source || !target) return;
        const sourceCenter = entityCenter(source);
        const targetCenter = entityCenter(target);
        const dx = targetCenter.x - sourceCenter.x;
        const dz = targetCenter.z - sourceCenter.z;
        const length = Math.hypot(dx, dz);
        if (length <= 0.01) return;
        const alongX = dx / length;
        const alongZ = dz / length;
        const perpendicularX = -alongZ;
        const perpendicularZ = alongX;
        const halfWidth = 0.31 + (edgeIndex % 3) * 0.045;
        const startBias = 0.12 + (edgeIndex % 2) * 0.05;
        const endBias = 0.14 + ((edgeIndex + 1) % 2) * 0.05;
        addYardShape(
          [
            [
              sourceCenter.x - alongX * startBias + perpendicularX * halfWidth,
              sourceCenter.z - alongZ * startBias + perpendicularZ * halfWidth,
            ],
            [
              targetCenter.x + alongX * endBias + perpendicularX * halfWidth * 0.86,
              targetCenter.z + alongZ * endBias + perpendicularZ * halfWidth * 0.86,
            ],
            [
              targetCenter.x + alongX * endBias - perpendicularX * halfWidth * 1.08,
              targetCenter.z + alongZ * endBias - perpendicularZ * halfWidth * 1.08,
            ],
            [
              sourceCenter.x - alongX * startBias - perpendicularX * halfWidth * 0.9,
              sourceCenter.z - alongZ * startBias - perpendicularZ * halfWidth * 0.9,
            ],
          ],
          0.009 + (edgeIndex % 4) * 0.00035,
        );
      });

      const serviceAnchors = entities.filter(
        ({ kind }) => kind !== "fluidPipe",
      );
      serviceAnchors.forEach((entity, index) => {
        const center = entityCenter(entity);
        const phase = entity.id * 1.919;
        const x = center.x + Math.cos(phase) * 0.42;
        const z = center.z + Math.sin(phase) * 0.42;
        addWear(
          x,
          z,
          0.13 + (index % 3) * 0.035,
          0.78 + (index % 4) * 0.19,
          0.62 + ((index + 2) % 4) * 0.17,
        );
        if (index % 2 !== 0) return;
        const stone = new THREE.DodecahedronGeometry(
          0.034 + (index % 3) * 0.009,
          0,
        );
        stone.scale(1.35, 0.38, 0.72);
        stone.rotateY(phase);
        stone.translate(x + 0.13, 0.046, z - 0.1);
        debris.push(stone);
      });

    }

    // Equipment foundations are structural load points, not presentation
    // rectangles. Heavy machines sit on four isolated piers with a short
    // grated maintenance tongue; pumps use two narrow sole plates and pipe
    // spans rely on the interval shoes authored below.
    for (const entity of entities) {
      const size = footprint(entity);
      const center = entityCenter(entity);
      if (entity.kind === "fluidTank") continue;
      if (
        entity.kind === "fluidProcessor" ||
        entity.kind === "fluidSource"
      ) {
        const insetX = size.width * 0.5 - 0.31;
        const insetZ = size.height * 0.5 - 0.31;
        for (const sideX of [-1, 1]) {
          for (const sideZ of [-1, 1]) {
            addRoundLoadPoint(
              foundations,
              0.105,
              0.064,
              center.x + sideX * insetX,
              0.032,
              center.z + sideZ * insetZ,
            );
          }
        }
        for (let stripe = 0; stripe < 3; stripe += 1) {
          addBox(
            markings,
            0.16,
            0.012,
            0.038,
            center.x - 0.2 + stripe * 0.2,
            0.09,
            center.z + size.height * 0.42,
          );
        }
        addWear(
          center.x - size.width * 0.22,
          center.z + size.height * 0.17,
          entity.kind === "fluidProcessor" ? 0.34 : 0.24,
          1.5,
          0.62,
        );
        const rotationY = -(entity.direction * Math.PI) / 2;
        const localPoint = (
          localX: number,
          localZ: number,
        ): { readonly x: number; readonly z: number } => ({
          x:
            center.x +
            localX * Math.cos(rotationY) +
            localZ * Math.sin(rotationY),
          z:
            center.z -
            localX * Math.sin(rotationY) +
            localZ * Math.cos(rotationY),
        });
        if (entity.kind === "fluidProcessor") {
          for (const [localX, localZ, width, height, depth] of [
            [-0.72, 0.54, 0.28, 0.34, 0.08],
            [0.62, 0.48, 0.24, 0.28, 0.075],
            [0.56, -0.56, 0.3, 0.22, 0.08],
          ] as const) {
            const point = localPoint(localX, localZ);
            addOrientedBox(
              cladding,
              width,
              height,
              depth,
              point.x,
              0.56 + height * 0.18,
              point.z,
              rotationY,
            );
          }
          const drainPoint = localPoint(0, 1.02);
          addOrientedBox(
            drainage,
            0.72,
            0.014,
            0.065,
            drainPoint.x,
            0.039,
            drainPoint.z,
            rotationY,
          );
          for (let slot = -2; slot <= 2; slot += 1) {
            const slotPoint = localPoint(slot * 0.135, 1.02);
            addOrientedBox(
              drainage,
              0.026,
              0.012,
              0.13,
              slotPoint.x,
              0.048,
              slotPoint.z,
              rotationY,
            );
          }
        }
      } else if (entity.kind === "fluidPump") {
        const alongX =
          entity.direction === Direction.East ||
          entity.direction === Direction.West;
        for (const side of [-1, 1]) {
          addRoundLoadPoint(
            foundations,
            0.075,
            0.042,
            center.x + (alongX ? side * 0.28 : 0),
            0.021,
            center.z + (alongX ? 0 : side * 0.28),
          );
        }
      }
    }

    // Nearby tanks become genuine bank-scale containment cells. A five-tile
    // threshold joins compact banks but never spans a whole refinery field.
    const tanks = entities
      .filter(({ kind }) => kind === "fluidTank")
      .sort((left, right) => left.z - right.z || left.x - right.x);
    const ownerByTankId = new Map<number, number>();
    const processors = entities.filter(
      ({ kind }) => kind === "fluidProcessor",
    );
    const distancesByProcessor = new Map<number, Map<number, number>>();
    for (const processor of processors) {
      const distances = new Map<number, number>([[processor.id, 0]]);
      const pending = [processor.id];
      for (let cursor = 0; cursor < pending.length; cursor += 1) {
        const id = pending[cursor]!;
        const distance = distances.get(id)!;
        for (const neighbor of adjacency.get(id) ?? []) {
          if (distances.has(neighbor)) continue;
          distances.set(neighbor, distance + 1);
          pending.push(neighbor);
        }
      }
      distancesByProcessor.set(processor.id, distances);
    }
    for (const tank of tanks) {
      let ownerId = -tank.id;
      let ownerDistance = Number.POSITIVE_INFINITY;
      for (const processor of processors) {
        const distance =
          distancesByProcessor.get(processor.id)?.get(tank.id) ??
          Number.POSITIVE_INFINITY;
        if (
          distance < ownerDistance ||
          (distance === ownerDistance && processor.id < ownerId)
        ) {
          ownerId = processor.id;
          ownerDistance = distance;
        }
      }
      ownerByTankId.set(tank.id, ownerId);
    }
    const ungroupedTankIds = new Set(tanks.map(({ id }) => id));
    const tankGroups: FluidVisualEntity[][] = [];
    for (const tank of tanks) {
      if (!ungroupedTankIds.delete(tank.id)) continue;
      const group: FluidVisualEntity[] = [];
      const pending = [tank];
      while (pending.length > 0) {
        const member = pending.pop();
        if (!member) break;
        group.push(member);
        const memberCenter = entityCenter(member);
        for (const candidate of tanks) {
          if (!ungroupedTankIds.has(candidate.id)) continue;
          if (
            ownerByTankId.get(candidate.id) !==
            ownerByTankId.get(member.id)
          ) {
            continue;
          }
          const candidateCenter = entityCenter(candidate);
          if (
            Math.hypot(
              candidateCenter.x - memberCenter.x,
              candidateCenter.z - memberCenter.z,
            ) > 5
          ) {
            continue;
          }
          ungroupedTankIds.delete(candidate.id);
          pending.push(candidate);
        }
      }
      tankGroups.push(group);
    }
    for (const group of tankGroups) {
      let minX = Number.POSITIVE_INFINITY;
      let minZ = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxZ = Number.NEGATIVE_INFINITY;
      for (const tank of group) {
        const size = footprint(tank);
        minX = Math.min(minX, tank.x);
        minZ = Math.min(minZ, tank.z);
        maxX = Math.max(maxX, tank.x + size.width);
        maxZ = Math.max(maxZ, tank.z + size.height);
      }
      const margin = group.length > 1 ? 0.28 : 0.2;
      const width = maxX - minX + margin * 2;
      const depth = maxZ - minZ + margin * 2;
      // Tank families already own load-bearing saddles, legs, or skid rails.
      // A second district-level rectangle under those authored supports was
      // the source of the PASS4 "foundation island" veto, so the yard only
      // supplies blended aggregate and local wear around tank banks.

      const seed = group.reduce((sum, { id }) => sum + id, 0);
      addWear(
        minX + 0.42 + ((seed * 0.37) % Math.max(0.3, width - 0.84)),
        minZ + 0.48 + ((seed * 0.23) % Math.max(0.3, depth - 0.96)),
        group.length > 1 ? 0.42 : 0.3,
        1.55,
        0.58,
      );
      addWear(
        maxX - 0.52,
        minZ + 0.62,
        0.24,
        0.72,
        1.35,
      );
    }

    // The district owns a second, presentation-grade rendering of every true
    // boundary coupling. It uses machine-specific flange heights so source
    // and processor ports meet the header without the black clipping wedges
    // produced by one universal centerline.
    const edgeDegree = new Map<number, number>();
    for (const edge of network.edges) {
      edgeDegree.set(
        edge.sourceEntityId,
        (edgeDegree.get(edge.sourceEntityId) ?? 0) + 1,
      );
      edgeDegree.set(
        edge.targetEntityId,
        (edgeDegree.get(edge.targetEntityId) ?? 0) + 1,
      );
    }
    const districtPortHeight = (entity: FluidVisualEntity): number =>
      entity.kind === "fluidPipe"
        ? PIPE_CENTER_Y
        : entity.kind === "fluidPump"
          ? 0.46
          : entity.kind === "fluidTank"
            ? PIPE_CENTER_Y
            : 0.42;
    for (const edge of network.edges) {
      const source = entityById.get(edge.sourceEntityId);
      const target = entityById.get(edge.targetEntityId);
      if (!source || !target) continue;
      // Adjacent pipe cells already meet at their shared seam through the
      // instanced half-arms. The district mesh owns only machine boundary
      // spools, avoiding two coincident tubes over every pipe-to-pipe edge.
      if (
        source.kind === "fluidPipe" &&
        target.kind === "fluidPipe"
      ) {
        continue;
      }
      const direction = directionToward(source, target);
      const sourceInset =
        source.kind === "fluidPipe"
          ? 0.01
          : source.kind === "fluidPump"
            ? 0.05
            : 0.18;
      const targetInset =
        target.kind === "fluidPipe"
          ? 0.01
          : target.kind === "fluidPump"
            ? 0.05
            : 0.18;
      const start = portAnchor(source, direction, sourceInset);
      const end = portAnchor(
        target,
        oppositeDirection(direction),
        targetInset,
      );
      start.y = districtPortHeight(source);
      end.y = districtPortHeight(target);
      const header =
        source.kind === "fluidProcessor" ||
        target.kind === "fluidProcessor" ||
        source.kind === "fluidTank" ||
        target.kind === "fluidTank" ||
        (edgeDegree.get(source.id) ?? 0) >= 3 ||
        (edgeDegree.get(target.id) ?? 0) >= 3;
      const radius = header ? 0.18 : 0.145;
      routeAudit.push({
        sourceEntityId: source.id,
        targetEntityId: target.id,
        sourceKind: source.kind,
        targetKind: target.kind,
        start: [start.x, start.y, start.z],
        end: [end.x, end.y, end.z],
        radius,
        sourceInset,
        targetInset,
      });
      const axis = new THREE.Vector3(
        end.x - start.x,
        0,
        end.z - start.z,
      ).normalize();
      if (Math.abs(start.y - end.y) > 0.025) {
        const planarAxis = new THREE.Vector3(
          end.x - start.x,
          0,
          end.z - start.z,
        ).normalize();
        const planarLength = Math.hypot(
          end.x - start.x,
          end.z - start.z,
        );
        const inset = Math.min(0.24, planarLength * 0.42);
        const riserX = end.x - planarAxis.x * inset;
        const riserZ = end.z - planarAxis.z * inset;
        const lowerBend = new THREE.Vector3(
          riserX,
          start.y,
          riserZ,
        );
        const upperBend = new THREE.Vector3(riserX, end.y, riserZ);
        addCylinderBetween(
          pipework,
          start,
          lowerBend,
          radius,
          header ? 20 : 16,
        );
        addCylinderBetween(
          pipework,
          lowerBend,
          upperBend,
          radius,
          header ? 20 : 16,
        );
        addCylinderBetween(
          pipework,
          upperBend,
          end,
          radius,
          header ? 20 : 16,
        );
        for (const bend of [lowerBend, upperBend]) {
          const elbow = new THREE.SphereGeometry(
            radius * 1.08,
            14,
            9,
          );
          elbow.translate(bend.x, bend.y, bend.z);
          fittings.push(elbow);
        }
      } else {
        addCylinderBetween(
          pipework,
          start,
          end,
          radius,
          header ? 20 : 16,
        );
      }
      addAxialFitting(
        fittings,
        start.clone().addScaledVector(axis, 0.055),
        axis,
        radius * 1.22,
        0.08,
      );
      addAxialFitting(
        fittings,
        end.clone().addScaledVector(axis, -0.055),
        axis,
        radius * 1.22,
        0.08,
      );
      if (
        Math.abs(start.y - end.y) <= 0.025 &&
        start.distanceTo(end) >= 0.62
      ) {
        const courseBand = start.clone().lerp(
          end,
          0.43 + ((source.id + target.id) % 3) * 0.07,
        );
        addAxialFitting(
          fittings,
          courseBand,
          axis,
          radius * 1.075,
          0.045,
        );
      }
    }

    const pipeFaces = new Map<number, Set<Direction>>();
    for (const pipe of entities.filter(
      ({ kind }) => kind === "fluidPipe",
    )) {
      pipeFaces.set(pipe.id, new Set<Direction>());
    }
    for (const edge of network.edges) {
      const source = entityById.get(edge.sourceEntityId);
      const target = entityById.get(edge.targetEntityId);
      if (!source || !target) continue;
      if (source.kind === "fluidPipe") {
        pipeFaces.get(source.id)?.add(directionToward(source, target));
      }
      if (target.kind === "fluidPipe") {
        pipeFaces.get(target.id)?.add(directionToward(target, source));
      }
    }

    // Every vessel owns one short radial nozzle-to-header spool. PASS4 used
    // offset three-leg doglegs here; at gameplay zoom those legs overlapped
    // the header and read as black penetrations. The radial spool terminates
    // exactly at both the shell and authoritative footprint port instead.
    for (const tank of entities.filter(({ kind }) => kind === "fluidTank")) {
      const center = entityCenter(tank);
      const structuralVariant =
        (tank.id + tank.x * 3 + tank.z * 5 + tank.direction * 7) % 4;
      for (const neighborId of adjacency.get(tank.id) ?? []) {
        const neighbor = entityById.get(neighborId);
        if (!neighbor) continue;
        const direction = directionToward(tank, neighbor);
        const forward = PIPE_FORWARD[direction];
        const drumAxis = ((tank.direction + 1) % 4) as Direction;
        const shellRadius =
          structuralVariant === 0
            ? direction === drumAxis ||
              direction === oppositeDirection(drumAxis)
              ? 1.02
              : 0.62
            : structuralVariant === 1
              ? 1.02
              : structuralVariant === 2
                ? 0.54
                : 0.64;
        const nozzleY = PIPE_CENTER_Y;
        const nozzle = new THREE.Vector3(
          center.x + forward.x * shellRadius,
          nozzleY,
          center.z + forward.z * shellRadius,
        );
        const port = portAnchor(tank, direction, 0.18);
        port.y = PIPE_CENTER_Y;
        addCylinderBetween(vesselSpools, nozzle, port, 0.145, 18);
        addAxialFitting(
          fittings,
          nozzle.clone().addScaledVector(forward, 0.08),
          forward,
          0.235,
          0.12,
        );
        addAxialFitting(
          fittings,
          port.clone().addScaledVector(forward, -0.055),
          forward,
          0.19,
          0.08,
        );
      }
    }

    type RackSegment = {
      readonly sourceId: number;
      readonly targetId: number;
      readonly start: THREE.Vector3;
      readonly end: THREE.Vector3;
      readonly length: number;
      readonly horizontal: boolean;
    };
    const rackSegments: RackSegment[] = [];
    for (const edge of network.edges) {
      const source = entityById.get(edge.sourceEntityId);
      const target = entityById.get(edge.targetEntityId);
      if (!source || !target) continue;
      if (
        source.kind !== "fluidPipe" &&
        source.kind !== "fluidPump" &&
        target.kind !== "fluidPipe" &&
        target.kind !== "fluidPump"
      ) {
        continue;
      }
      const direction = directionToward(source, target);
      const sourcePoint =
        source.kind === "fluidPipe" || source.kind === "fluidPump"
          ? entityCenter(source)
          : portAnchor(source, direction, 0);
      const targetPoint =
        target.kind === "fluidPipe" || target.kind === "fluidPump"
          ? entityCenter(target)
          : portAnchor(target, oppositeDirection(direction), 0);
      const start = new THREE.Vector3(sourcePoint.x, 0.29, sourcePoint.z);
      const end = new THREE.Vector3(targetPoint.x, 0.29, targetPoint.z);
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.hypot(dx, dz);
      if (length <= 0.08 || length > 4.5) continue;
      rackSegments.push({
        sourceId: source.id,
        targetId: target.id,
        start,
        end,
        length,
        horizontal: Math.abs(dx) >= Math.abs(dz),
      });
    }

    const rackNodeIds = new Set<number>();
    for (const segment of rackSegments) {
      rackNodeIds.add(segment.sourceId);
      rackNodeIds.add(segment.targetId);
    }
    for (const entity of entities) {
      if (
        !rackNodeIds.has(entity.id) ||
        (entity.kind !== "fluidPipe" && entity.kind !== "fluidPump")
      ) {
        continue;
      }
      const center = entityCenter(entity);
      const segment = rackSegments.find(
        ({ sourceId, targetId }) =>
          sourceId === entity.id || targetId === entity.id,
      );
      if (!segment) continue;
      const dx = segment.end.x - segment.start.x;
      const dz = segment.end.z - segment.start.z;
      const inverseLength = 1 / segment.length;
      const perpendicular = new THREE.Vector3(
        -dz * inverseLength,
        0,
        dx * inverseLength,
      );
      const left = new THREE.Vector3(
        center.x + perpendicular.x * 0.29,
        0.35,
        center.z + perpendicular.z * 0.29,
      );
      const right = new THREE.Vector3(
        center.x - perpendicular.x * 0.29,
        0.35,
        center.z - perpendicular.z * 0.29,
      );
      supportAudit.push({
        entityId: entity.id,
        center: [center.x, 0.29, center.z],
        groundContactY: 0.034,
        saddleCenterY: PIPE_CENTER_Y,
      });
      addCylinderBetween(steelwork, left, right, 0.075, 12);
      for (const post of [left, right]) {
        addRoundLoadPoint(
          foundations,
          0.19,
          0.065,
          post.x,
          0.0325,
          post.z,
        );
        addCylinderBetween(
          steelwork,
          new THREE.Vector3(post.x, 0.068, post.z),
          post,
          0.085,
          12,
        );
        addBox(
          foundations,
          0.34,
          0.07,
          0.34,
          post.x,
          0.055,
          post.z,
        );
        // Bright bolted cap plates make the load transfer legible from the
        // normal strategic camera: saddle -> column -> shoe -> concrete.
        addBox(
          fittings,
          0.29,
          0.035,
          0.29,
          post.x,
          0.098,
          post.z,
        );
        for (const anchorX of [-0.085, 0.085]) {
          for (const anchorZ of [-0.085, 0.085]) {
            addRoundLoadPoint(
              fittings,
              0.018,
              0.045,
              post.x + anchorX,
              0.092,
              post.z + anchorZ,
            );
          }
        }
        for (const side of [-1, 1]) {
          addCylinderBetween(
            steelwork,
            new THREE.Vector3(post.x + side * 0.095, 0.078, post.z),
            new THREE.Vector3(post.x, 0.19, post.z),
            0.04,
            10,
          );
        }
        addWear(post.x, post.z, 0.14, 1.15, 0.72);
      }
      const faces = [...(pipeFaces.get(entity.id) ?? [])];
      const hasTurn = faces.some((first, firstIndex) =>
        faces.some(
          (second, secondIndex) =>
            secondIndex > firstIndex &&
            first !== second &&
            oppositeDirection(first) !== second,
        ),
      );
      if (hasTurn || (edgeDegree.get(entity.id) ?? 0) >= 3) {
        const teeBody = new THREE.SphereGeometry(0.205, 16, 10);
        teeBody.scale(1, 0.88, 1);
        teeBody.translate(center.x, PIPE_CENTER_Y, center.z);
        fittings.push(teeBody);
      }
    }

    // Select one real connected component for the sole maintenance catwalk.
    // It follows that component's dominant orientation and terminates in one
    // attached access stair rather than scattering ladders around every rig.
    let serviceSegments: RackSegment[] = [];
    let bestServiceLength = 0;
    const hasServiceableProcessEquipment =
      entities.length >= 6 &&
      entities.some(
        ({ kind }) =>
          kind === "fluidProcessor" || kind === "fluidTank",
      );
    for (const component of hasServiceableProcessEquipment
      ? components
      : []) {
      const memberIds = new Set(component.map(({ id }) => id));
      const candidates = rackSegments.filter(
        ({ sourceId, targetId }) =>
          memberIds.has(sourceId) && memberIds.has(targetId),
      );
      const horizontalLength = candidates
        .filter(({ horizontal }) => horizontal)
        .reduce((sum, { length }) => sum + length, 0);
      const verticalLength = candidates
        .filter(({ horizontal }) => !horizontal)
        .reduce((sum, { length }) => sum + length, 0);
      const horizontal = horizontalLength >= verticalLength;
      const dominant = candidates.filter(
        (segment) => segment.horizontal === horizontal,
      );
      const dominantLength = dominant.reduce(
        (sum, { length }) => sum + length,
        0,
      );
      if (dominantLength > bestServiceLength) {
        bestServiceLength = dominantLength;
        serviceSegments = dominant;
      }
    }
    for (const segment of serviceSegments) {
      const dx = segment.end.x - segment.start.x;
      const dz = segment.end.z - segment.start.z;
      const angle = -Math.atan2(dz, dx);
      const inverseLength = 1 / segment.length;
      const perpendicularX = -dz * inverseLength;
      const perpendicularZ = dx * inverseLength;
      const walkwayX =
        (segment.start.x + segment.end.x) * 0.5 + perpendicularX * 0.51;
      const walkwayZ =
        (segment.start.z + segment.end.z) * 0.5 + perpendicularZ * 0.51;
      addOrientedBox(
        access,
        segment.length + 0.08,
        0.038,
        0.34,
        walkwayX,
        0.242,
        walkwayZ,
        angle,
      );
      for (const side of [-1, 1]) {
        addOrientedBox(
          access,
          segment.length + 0.08,
          0.03,
          0.026,
          walkwayX + perpendicularX * side * 0.12,
          0.255,
          walkwayZ + perpendicularZ * side * 0.15,
          angle,
        );
      }
      const slatCount = Math.max(2, Math.ceil(segment.length / 0.24));
      for (let slat = 0; slat <= slatCount; slat += 1) {
        const progress = slat / slatCount;
        addOrientedBox(
          access,
          0.026,
          0.024,
          0.27,
          THREE.MathUtils.lerp(segment.start.x, segment.end.x, progress) +
            perpendicularX * 0.51,
          0.258,
          THREE.MathUtils.lerp(segment.start.z, segment.end.z, progress) +
            perpendicularZ * 0.51,
          angle,
        );
      }
      const outerStart = new THREE.Vector3(
        segment.start.x + perpendicularX * 0.65,
        0.64,
        segment.start.z + perpendicularZ * 0.69,
      );
      const outerEnd = new THREE.Vector3(
        segment.end.x + perpendicularX * 0.65,
        0.64,
        segment.end.z + perpendicularZ * 0.69,
      );
      addCylinderBetween(steelwork, outerStart, outerEnd, 0.022, 8);
      for (const post of [outerStart, outerEnd]) {
        addCylinderBetween(
          steelwork,
          new THREE.Vector3(post.x, 0.27, post.z),
          post,
          0.02,
          8,
        );
      }
    }
    const stairSegment = serviceSegments[0];
    if (stairSegment) {
      const dx = stairSegment.end.x - stairSegment.start.x;
      const dz = stairSegment.end.z - stairSegment.start.z;
      const inverseLength = 1 / stairSegment.length;
      const perpendicularX = -dz * inverseLength;
      const perpendicularZ = dx * inverseLength;
      const deck = new THREE.Vector3(
        stairSegment.start.x + perpendicularX * 0.51,
        0.27,
        stairSegment.start.z + perpendicularZ * 0.51,
      );
      const ground = new THREE.Vector3(
        deck.x + perpendicularX * 0.62,
        0.055,
        deck.z + perpendicularZ * 0.62,
      );
      for (const side of [-1, 1]) {
        const lateralX = (dx * inverseLength) * side * 0.16;
        const lateralZ = (dz * inverseLength) * side * 0.16;
        addCylinderBetween(
          steelwork,
          new THREE.Vector3(ground.x + lateralX, ground.y, ground.z + lateralZ),
          new THREE.Vector3(deck.x + lateralX, deck.y, deck.z + lateralZ),
          0.024,
          8,
        );
      }
      for (let tread = 0; tread < 4; tread += 1) {
        const progress = (tread + 0.5) / 4;
        addCylinderBetween(
          access,
          new THREE.Vector3(
            THREE.MathUtils.lerp(ground.x, deck.x, progress) -
              (dx * inverseLength) * 0.16,
            THREE.MathUtils.lerp(ground.y, deck.y, progress),
            THREE.MathUtils.lerp(ground.z, deck.z, progress) -
              (dz * inverseLength) * 0.16,
          ),
          new THREE.Vector3(
            THREE.MathUtils.lerp(ground.x, deck.x, progress) +
              (dx * inverseLength) * 0.16,
            THREE.MathUtils.lerp(ground.y, deck.y, progress),
            THREE.MathUtils.lerp(ground.z, deck.z, progress) +
              (dz * inverseLength) * 0.16,
          ),
          0.018,
          8,
        );
      }
    }

    if (yard.length > 0) {
      const yardGeometry = mergeOwnedGeometries(
        yard,
        "fluid-refinery-district-irregular-aggregate-service-yard-geometry",
      );
      this.districtYard = new THREE.Mesh(
        yardGeometry,
        this.materials.yardAggregate,
      );
      this.districtYard.name =
        "fluid-refinery-district-irregular-stained-aggregate-service-yard";
      this.districtYard.receiveShadow = true;
      this.districtRoot.add(this.districtYard);
    }

    if (foundations.length > 0) {
      const foundationGeometry = mergeOwnedGeometries(
        foundations,
        "fluid-refinery-district-modular-pours-and-service-strips-geometry",
      );
      this.districtFoundation = new THREE.Mesh(
        foundationGeometry,
        this.materials.foundation,
      );
      this.districtFoundation.name =
        "fluid-refinery-district-modular-equipment-pours-and-service-strips";
      this.districtFoundation.visible = true;
      this.districtFoundation.userData.presentation =
        "isolated-load-feet-pipe-shoes-and-anchor-plates";
      this.districtFoundation.castShadow = true;
      this.districtFoundation.receiveShadow = true;
      this.districtRoot.add(this.districtFoundation);
    }

    if (drainage.length > 0) {
      const drainageGeometry = mergeOwnedGeometries(
        drainage,
        "fluid-refinery-district-local-drains-and-sumps-geometry",
      );
      this.districtDrainage = new THREE.Mesh(
        drainageGeometry,
        this.materials.steelDark,
      );
      this.districtDrainage.name =
        "fluid-refinery-district-local-drain-grates-and-catch-sumps";
      this.districtDrainage.receiveShadow = true;
      this.districtRoot.add(this.districtDrainage);
    }
    if (markings.length > 0) {
      const markingGeometry = mergeOwnedGeometries(
        markings,
        "fluid-refinery-district-local-safety-marking-geometry",
      );
      this.districtMarkings = new THREE.Mesh(
        markingGeometry,
        this.materials.safetyPaint,
      );
      this.districtMarkings.name =
        "fluid-refinery-district-local-physical-safety-markings";
      this.districtMarkings.visible = false;
      this.districtMarkings.userData.retiredReason =
        "removed-loose-ground-dashes";
      this.districtMarkings.receiveShadow = true;
      this.districtRoot.add(this.districtMarkings);
    }
    if (pipework.length > 0) {
      const pipeworkGeometry = mergeOwnedGeometries(
        pipework,
        "fluid-refinery-district-authoritative-header-and-branch-pipework-geometry",
      );
      this.districtPipework = new THREE.Mesh(
        pipeworkGeometry,
        this.materials.oxidizedSteel,
      );
      this.districtPipework.name =
        "fluid-refinery-district-authoritative-main-headers-and-branches";
      this.districtPipework.castShadow = true;
      this.districtPipework.receiveShadow = true;
      this.districtRoot.add(this.districtPipework);
    }
    if (vesselSpools.length > 0) {
      const vesselSpoolGeometry = mergeOwnedGeometries(
        vesselSpools,
        "fluid-refinery-district-dark-vessel-nozzle-spool-geometry",
      );
      this.districtVesselSpools = new THREE.Mesh(
        vesselSpoolGeometry,
        this.materials.oxidizedSteel,
      );
      this.districtVesselSpools.name =
        "fluid-refinery-district-supported-radial-vessel-nozzle-spools";
      this.districtVesselSpools.castShadow = true;
      this.districtVesselSpools.receiveShadow = true;
      this.districtRoot.add(this.districtVesselSpools);
    }
    if (fittings.length > 0) {
      const fittingsGeometry = mergeOwnedGeometries(
        fittings,
        "fluid-refinery-district-flanges-and-elbow-fittings-geometry",
      );
      this.districtFittings = new THREE.Mesh(
        fittingsGeometry,
        this.materials.nozzleSteel,
      );
      this.districtFittings.name =
        "fluid-refinery-district-real-flanges-and-elbow-fittings";
      this.districtFittings.castShadow = true;
      this.districtFittings.receiveShadow = true;
      this.districtRoot.add(this.districtFittings);
    }
    if (access.length > 0) {
      const accessGeometry = mergeOwnedGeometries(
        access,
        "fluid-refinery-district-connected-access-grating-geometry",
      );
      this.districtAccess = new THREE.Mesh(
        accessGeometry,
        this.materials.oxidizedSteel,
      );
      this.districtAccess.name =
        "fluid-refinery-district-connected-catwalks-and-access-grating";
      this.districtAccess.visible = true;
      this.districtAccess.userData.presentation =
        "one-connected-maintenance-catwalk-with-grounded-access-stair";
      this.districtAccess.castShadow = true;
      this.districtAccess.receiveShadow = true;
      this.districtRoot.add(this.districtAccess);
    }
    if (cladding.length > 0) {
      const claddingGeometry = mergeOwnedGeometries(
        cladding,
        "fluid-refinery-district-readable-machine-cladding-geometry",
      );
      this.districtCladding = new THREE.Mesh(
        claddingGeometry,
        this.materials.oxidizedSteel,
      );
      this.districtCladding.name =
        "fluid-refinery-district-readable-source-and-processor-cladding";
      this.districtCladding.castShadow = true;
      this.districtCladding.receiveShadow = true;
      this.districtRoot.add(this.districtCladding);
    }
    if (steelwork.length > 0) {
      const steelworkGeometry = mergeOwnedGeometries(
        steelwork,
        "fluid-refinery-district-structural-pipe-rack-geometry",
      );
      this.districtSteelwork = new THREE.Mesh(
        steelworkGeometry,
        this.materials.structuralMid,
      );
      this.districtSteelwork.name =
        "fluid-refinery-district-structural-pipe-racks-and-service-bridges";
      this.districtSteelwork.castShadow = true;
      this.districtSteelwork.receiveShadow = true;
      this.districtRoot.add(this.districtSteelwork);
    }
    if (debris.length > 0) {
      const debrisGeometry = mergeOwnedGeometries(
        debris,
        "fluid-refinery-district-grounded-debris-geometry",
      );
      this.districtDebris = new THREE.Mesh(
        debrisGeometry,
        this.materials.steelDark,
      );
      this.districtDebris.name =
        "fluid-refinery-district-grounded-aggregate-and-maintenance-debris";
      this.districtDebris.visible = true;
      this.districtDebris.userData.presentation =
        "sparse-contact-grounded-aggregate";
      this.districtDebris.castShadow = true;
      this.districtDebris.receiveShadow = true;
      this.districtRoot.add(this.districtDebris);
    }
    if (wear.length > 0) {
      const wearGeometry = mergeOwnedGeometries(
        wear,
        "fluid-refinery-district-local-oil-and-rust-wear-geometry",
      );
      this.districtWear = new THREE.Mesh(
        wearGeometry,
        this.materials.groundStain,
      );
      this.districtWear.name =
        "fluid-refinery-district-localized-oil-and-rust-wear";
      this.districtWear.visible = true;
      this.districtWear.userData.presentation =
        "localized-equipment-contact-and-drainage-wear";
      this.districtRoot.add(this.districtWear);
    }
    this.districtRoot.userData.componentCount = components.length;
    this.districtRoot.userData.entityCount = entities.length;
    this.districtRoot.userData.tankBankCount = tankGroups.length;
    this.districtRoot.userData.rackFrameCount = Math.floor(
      steelwork.length / 6,
    );
    this.districtRoot.userData.routeAudit = routeAudit;
    this.districtRoot.userData.supportAudit = supportAudit;
    this.districtRoot.userData.routeAuthority =
      "machine-boundary-spools-plus-instanced-shared-seam-pipe-arms";
    this.districtRoot.userData.presentation =
      "connected-irregular-aggregate-yard-modular-load-points-local-drains-wear-and-real-pipe-racks";
  }

  private releaseDistrict(): void {
    for (const mesh of [
      this.districtYard,
      this.districtFoundation,
      this.districtDrainage,
      this.districtMarkings,
      this.districtSteelwork,
      this.districtPipework,
      this.districtVesselSpools,
      this.districtFittings,
      this.districtAccess,
      this.districtCladding,
      this.districtDebris,
      this.districtWear,
    ]) {
      if (!mesh) continue;
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.districtYard = null;
    this.districtFoundation = null;
    this.districtDrainage = null;
    this.districtMarkings = null;
    this.districtSteelwork = null;
    this.districtPipework = null;
    this.districtVesselSpools = null;
    this.districtFittings = null;
    this.districtAccess = null;
    this.districtCladding = null;
    this.districtDebris = null;
    this.districtWear = null;
    this.districtSignature = "";
  }

  private syncPipes(
    pipes: readonly FluidVisualEntity[],
    elapsed: number,
    network: FluidNetworkSnapshot,
    entities: readonly FluidVisualEntity[],
  ): void {
    this.ensurePipeCapacity(pipes.length);
    if (
      !this.pipeOuter ||
      !this.pipeCrude ||
      !this.pipeRefined ||
      !this.pipeFlanges ||
      !this.pipeSupports
    ) {
      return;
    }
    const entityById = new Map(entities.map((entity) => [entity.id, entity]));
    const connectedFaces = new Map<number, Set<Direction>>();
    const registerFace = (
      pipe: FluidVisualEntity,
      neighbor: FluidVisualEntity,
    ): void => {
      let faces = connectedFaces.get(pipe.id);
      if (!faces) {
        faces = new Set<Direction>();
        connectedFaces.set(pipe.id, faces);
      }
      faces.add(directionToward(pipe, neighbor));
    };
    for (const edge of network.edges) {
      const source = entityById.get(edge.sourceEntityId);
      const target = entityById.get(edge.targetEntityId);
      if (!source || !target) continue;
      if (source.kind === "fluidPipe") registerFace(source, target);
      if (target.kind === "fluidPipe") registerFace(target, source);
    }
    const nodeByKey = new Map(
      network.nodes.map((node) => [
        `${node.entityId}:${node.role}`,
        node,
      ]),
    );
    const pressureHeldEntityIds = new Set<number>();
    for (const edge of network.edges) {
      const source = entityById.get(edge.sourceEntityId);
      const target = entityById.get(edge.targetEntityId);
      if (!source || !target) continue;
      const targetNode = nodeByKey.get(
        `${edge.targetEntityId}:${edge.targetRole}`,
      );
      const held =
        source.status === "blocked" ||
        source.status === "outputFull" ||
        target.status === "blocked" ||
        target.status === "outputFull" ||
        Boolean(
          targetNode &&
            targetNode.capacityMilli > 0 &&
            targetNode.amountMilli / targetNode.capacityMilli >= 0.985,
        );
      if (held) {
        pressureHeldEntityIds.add(source.id);
        pressureHeldEntityIds.add(target.id);
      }
    }
    let shellCount = 0;
    let flangeCount = 0;
    let wearBandCount = 0;
    let crudeCount = 0;
    let refinedCount = 0;
    const shellEntityIds: number[] = [];
    const flangeEntityIds: number[] = [];
    const crudeEntityIds: number[] = [];
    const refinedEntityIds: number[] = [];
    for (let index = 0; index < pipes.length; index += 1) {
      const entity = pipes[index]!;
      const centerX = entity.x + 0.5;
      const centerZ = entity.z + 0.5;
      const connected = connectedFaces.get(entity.id);
      const faces =
        connected && connected.size > 0
          ? new Set<Direction>(connected)
          : new Set<Direction>([
              entity.direction,
              oppositeDirection(entity.direction),
            ]);
      const sortedFaces = [...faces].sort((left, right) => left - right);

      this.temp.position.set(centerX, 0, centerZ);
      this.temp.rotation.set(
        0,
        entity.direction === Direction.East ||
          entity.direction === Direction.West
          ? Math.PI / 2
          : 0,
        0,
      );
      this.temp.scale.set(1, 1, 1);
      this.temp.updateMatrix();
      this.pipeSupports.setMatrixAt(index, this.temp.matrix);

      const fluid = fluidOf(entity);
      const fill =
        fluid.capacity <= 0
          ? 0
          : THREE.MathUtils.clamp(fluid.amount / fluid.capacity, 0, 1);
      const shellPressureHeld =
        fill >= 0.985 ||
        entity.status === "blocked" ||
        entity.status === "outputFull" ||
        pressureHeldEntityIds.has(entity.id);
      for (const face of sortedFaces) {
        const forward = PIPE_FORWARD[face];
        this.temp.position.set(
          centerX + forward.x * 0.24,
          PIPE_CENTER_Y,
          centerZ + forward.z * 0.24,
        );
        this.temp.quaternion.setFromUnitVectors(UP, forward);
        this.temp.scale.set(0.205, 0.49, 0.205);
        this.temp.updateMatrix();
        this.pipeOuter.setMatrixAt(shellCount, this.temp.matrix);
        this.pipeOuter.setColorAt(
          shellCount,
          shellPressureHeld
            ? PIPE_SHELL_TINTS.held
            : fluid.id === "crudeOil"
            ? PIPE_SHELL_TINTS.crudeOil
            : fluid.id === "refinedFuel"
              ? PIPE_SHELL_TINTS.refinedFuel
              : PIPE_SHELL_TINTS.empty,
        );
        shellEntityIds[shellCount] = entity.id;
        shellCount += 1;

        this.temp.position.set(
          centerX + forward.x * 0.43,
          PIPE_CENTER_Y,
          centerZ + forward.z * 0.43,
        );
        this.temp.quaternion.setFromUnitVectors(UP, forward);
        this.temp.scale.set(0.255, 0.075, 0.255);
        this.temp.updateMatrix();
        this.pipeFlanges.setMatrixAt(flangeCount, this.temp.matrix);
        flangeEntityIds.push(entity.id);
        flangeCount += 1;

        // One thin, aged clamp on every authored half-arm breaks the long
        // process tube into believable shop-welded courses. It shares the
        // existing flange batch, so the added material read has no draw-call
        // cost and remains subordinate to the true boundary flange.
        this.temp.position.set(
          centerX + forward.x * 0.17,
          PIPE_CENTER_Y,
          centerZ + forward.z * 0.17,
        );
        this.temp.quaternion.setFromUnitVectors(UP, forward);
        this.temp.scale.set(0.218, 0.026, 0.218);
        this.temp.updateMatrix();
        this.pipeFlanges.setMatrixAt(flangeCount, this.temp.matrix);
        flangeCount += 1;
        wearBandCount += 1;

        if (!fluid.id || fill <= 0) continue;
        const mesh =
          fluid.id === "crudeOil" ? this.pipeCrude : this.pipeRefined;
        const slot =
          fluid.id === "crudeOil" ? crudeCount++ : refinedCount++;
        if (fluid.id === "crudeOil") {
          crudeEntityIds[slot] = entity.id;
        } else {
          refinedEntityIds[slot] = entity.id;
        }
        const held =
          fill >= 0.985 ||
          entity.status === "blocked" ||
          entity.status === "outputFull" ||
          pressureHeldEntityIds.has(entity.id);
        mesh.setColorAt(
          slot,
          held
            ? PIPE_WINDOW_TINTS.pressureHeld
            : PIPE_WINDOW_TINTS.moving,
        );
        const windowTravel = held
          ? 0.09
          : 0.06 +
            ((elapsed * 0.72 + entity.id * 0.173) % 1) * 0.24;
        this.temp.position.set(
          centerX + forward.x * windowTravel,
          PIPE_CENTER_Y,
          centerZ + forward.z * windowTravel,
        );
        this.temp.quaternion.setFromUnitVectors(UP, forward);
        this.temp.scale.set(
          0.095,
          held ? 0.12 : 0.18,
          0.095,
        );
        this.temp.updateMatrix();
        mesh.setMatrixAt(slot, this.temp.matrix);
      }

    }
    this.pipeOuter.count = shellCount;
    this.pipeSupports.count = pipes.length;
    this.pipeFlanges.count = flangeCount;
    this.pipeCrude.count = crudeCount;
    this.pipeRefined.count = refinedCount;
    this.pipeOuter.userData.entityIds = shellEntityIds;
    this.pipeSupports.userData.entityIds = pipes.map(({ id }) => id);
    this.pipeFlanges.userData.entityIds = flangeEntityIds;
    this.pipeFlanges.userData.wearBandCount = wearBandCount;
    this.pipeFlanges.userData.presentation =
      "bolted-boundary-flanges-plus-aged-shop-weld-collars";
    this.pipeSupports.userData.topologyFaces = pipes.map((pipe) => ({
      entityId: pipe.id,
      faces:
        connectedFaces.get(pipe.id)?.size
          ? [...connectedFaces.get(pipe.id)!]
          : [pipe.direction, oppositeDirection(pipe.direction)],
    }));
    this.pipeCrude.userData.entityIds = crudeEntityIds;
    this.pipeRefined.userData.entityIds = refinedEntityIds;
    this.pipeOuter.instanceMatrix.needsUpdate = true;
    if (this.pipeOuter.instanceColor) {
      this.pipeOuter.instanceColor.needsUpdate = true;
    }
    this.pipeSupports.instanceMatrix.needsUpdate = true;
    this.pipeFlanges.instanceMatrix.needsUpdate = true;
    this.pipeCrude.instanceMatrix.needsUpdate = true;
    this.pipeRefined.instanceMatrix.needsUpdate = true;
    if (this.pipeCrude.instanceColor) {
      this.pipeCrude.instanceColor.needsUpdate = true;
    }
    if (this.pipeRefined.instanceColor) {
      this.pipeRefined.instanceColor.needsUpdate = true;
    }
  }

  private syncMachines(
    entities: readonly (
      FluidVisualEntity & {
        kind: Exclude<FluidEntityKind, "fluidPipe">;
      }
    )[],
    elapsed: number,
    network: FluidNetworkSnapshot,
  ): void {
    const alive = new Set<number>();
    for (const entity of entities) {
      alive.add(entity.id);
      let rig = this.rigs.get(entity.id);
      if (!rig || rig.kind !== entity.kind) {
        if (rig) disposeRig(rig);
        rig = this.createRig(entity.kind);
        this.rigs.set(entity.id, rig);
      }
      const size = footprint(entity);
      rig.root.position.set(
        entity.x + size.width * 0.5,
        0,
        entity.z + size.height * 0.5,
      );
      rig.root.rotation.y = -(entity.direction * Math.PI) / 2;
      rig.root.userData.entityId = entity.id;
      rig.root.userData.entityKind = entity.kind;
      if (
        entity.kind === "fluidTank" &&
        rig.root.userData.finishVariant !== entity.id % 4
      ) {
        const finishVariant = entity.id % 4;
        const middleCourseMaterials = [
          this.materials.paintedSteel,
          this.materials.oxidizedSteel,
          this.materials.enamel,
          this.materials.steel,
        ] as const;
        const upperCourseMaterials = [
          this.materials.enamel,
          this.materials.steel,
          this.materials.paintedSteel,
          this.materials.oxidizedSteel,
        ] as const;
        const roofMaterials = [
          this.materials.paintedSteel,
          this.materials.enamel,
          this.materials.oxidizedSteel,
          this.materials.steel,
        ] as const;
        rig.root.traverse((object) => {
          if (typeof object.userData.finishVariantIndex === "number") {
            object.visible =
              object.userData.finishVariantIndex === finishVariant;
          }
          if (!(object instanceof THREE.Mesh)) return;
          if (object.name === "fluid-tank-chipped-middle-course") {
            object.material = middleCourseMaterials[finishVariant]!;
          } else if (object.name === "fluid-tank-weathered-upper-course") {
            object.material = upperCourseMaterials[finishVariant]!;
          } else if (object.name === "fluid-tank-domed-roof") {
            object.material = roofMaterials[finishVariant]!;
          }
        });
        rig.root.userData.finishVariant = finishVariant;
        rig.root.userData.finishVariationSource = "stable-entity-id";
      }
      if (entity.kind === "fluidTank") {
        const structuralVariant =
          (entity.id +
            entity.x * 3 +
            entity.z * 5 +
            entity.direction * 7) %
          4;
        rig.root.traverse((object) => {
          if (
            object.name.startsWith("fluid-tank-family-") &&
            typeof object.userData.finishVariantIndex === "number"
          ) {
            object.visible =
              object.userData.finishVariantIndex === structuralVariant;
          }
        });
        rig.root.userData.structuralVariant = structuralVariant;
        if (structuralVariant === 3) {
          rig.root.scale.set(1, 1, 1);
          rig.root.userData.structuralFamily =
            "compact-buffer-vessel-on-authoritative-three-tile-skid";
        } else {
          rig.root.scale.set(1, 1, 1);
          rig.root.userData.structuralFamily =
            structuralVariant === 0
              ? "steam-traced-storage-vessel"
              : structuralVariant === 1
                ? "catwalk-custody-storage-vessel"
                : "tall-vent-instrumented-storage-vessel";
        }
      } else {
        rig.root.scale.set(1, 1, 1);
      }
      if (
        entity.kind === "fluidPump" &&
        rig.root.userData.presentationVariant !== entity.id % 3
      ) {
        const presentationVariant = entity.id % 3;
        const voluteFinishes = [
          this.materials.paintedSteel,
          this.materials.oxidizedSteel,
          this.materials.enamel,
        ] as const;
        rig.root.traverse((object) => {
          if (object.name.includes("fluid-pump-pressure-gauge")) {
            object.visible = presentationVariant === 0;
          } else if (
            object.name === "fluid-pump-discharge-valve-position"
          ) {
            object.visible = presentationVariant !== 2;
          } else if (
            object.name === "fluid-pump-suction-valve-position"
          ) {
            object.visible = presentationVariant === 1;
          }
          if (
            object instanceof THREE.Mesh &&
            object.name === "fluid-pump-volute"
          ) {
            object.material = voluteFinishes[presentationVariant]!;
          }
        });
        rig.root.userData.presentationVariant = presentationVariant;
        rig.root.userData.presentationVariantSource = "stable-entity-id";
        rig.root.userData.presentation =
          presentationVariant === 0
            ? "instrumented-discharge-pump"
            : presentationVariant === 1
              ? "dual-isolation-transfer-pump"
              : "compact-uninstrumented-booster-pump";
      }
      if (
        entity.kind === "fluidProcessor" &&
        rig.root.userData.presentationVariant !== entity.id % 2
      ) {
        const presentationVariant = entity.id % 2;
        const sweptNames = [
          "fluid-processor-swept-overhead-fraction-line",
          "fluid-processor-overhead-line-bolted-flange",
          "fluid-processor-asymmetric-knockout-drum",
          "fluid-processor-knockout-drum-course-ring",
          "fluid-processor-knockout-drum-saddle",
        ];
        const firedNames = [
          "fluid-processor-combustion-exhaust-stack",
          "fluid-processor-exhaust-stack-course-ring",
          "fluid-processor-exhaust-rain-hood",
        ];
        rig.root.traverse((object) => {
          if (sweptNames.includes(object.name)) {
            object.visible = presentationVariant === 1;
          } else if (firedNames.includes(object.name)) {
            object.visible = presentationVariant === 0;
          }
          if (
            object instanceof THREE.Mesh &&
            object.name === "fluid-processor-fractionation-tower"
          ) {
            object.material =
              presentationVariant === 0
                ? this.materials.paintedSteel
                : this.materials.oxidizedSteel;
          }
        });
        rig.root.userData.presentationVariant = presentationVariant;
        rig.root.userData.presentationVariantSource = "stable-entity-id";
        rig.root.userData.presentation =
          presentationVariant === 0
            ? "fired-primary-fractionator-with-exhaust"
            : "condenser-knockout-fractionator-with-swept-overhead";
      }
      const active =
        entity.status === "working" && entity.powerSatisfaction > 0;
      const blocked =
        entity.status === "blocked" || entity.status === "outputFull";
      const fluid = fluidOf(entity);
      const fill =
        fluid.capacity <= 0
          ? 0
          : THREE.MathUtils.clamp(fluid.amount / fluid.capacity, 0, 1);
      const rate =
        entity.kind === "fluidSource"
          ? active
            ? 4.7
            : blocked
              ? 0
              : 0.38
          : entity.kind === "fluidPump"
            ? active
              ? 8.6
              : blocked
                ? 0
                : 0.7
            : active
              ? 6.4
              : blocked
                ? 0
                : 0.55;
      const mechanismPhase = elapsed * rate + entity.id * 0.071;
      const setRotorRotation = (
        rotor: THREE.Object3D | undefined,
        rotation: number,
      ): void => {
        if (!rotor) return;
        const axis = rotor.userData.rotationAxis;
        if (axis === "x") rotor.rotation.x = rotation;
        else if (axis === "z") rotor.rotation.z = rotation;
        else rotor.rotation.y = rotation;
        rotor.userData.mechanismPhase = rotation;
        rotor.userData.authoritativeActive = active;
      };
      setRotorRotation(rig.rotor, mechanismPhase);
      setRotorRotation(rig.secondaryRotor, mechanismPhase * 1.37);

      if (
        entity.kind === "fluidSource" &&
        rig.actuator &&
        rig.polishedRod &&
        rig.pitmanArm
      ) {
        const beamAngle = active
          ? Math.cos(mechanismPhase) * 0.38
          : blocked
            ? 0.16 + Math.sin(mechanismPhase) * 0.018
            : -0.08 + Math.sin(mechanismPhase) * 0.06;
        const motionPlane = rig.actuator.userData.motionPlane;
        if (motionPlane === "yz") {
          rig.actuator.rotation.x = beamAngle;
          rig.actuator.rotation.z = 0;
        } else {
          rig.actuator.rotation.z = beamAngle;
        }
        rig.actuator.userData.beamAngle = beamAngle;
        rig.actuator.userData.crankPhase = mechanismPhase;
        const pivotX = rig.actuator.position.x;
        const pivotY = rig.actuator.position.y;
        const pivotZ = rig.actuator.position.z;
        const rodRadius = Number(rig.polishedRod.userData.beamRadius ?? 0.87);
        const rodLateralOffset = Number(
          rig.polishedRod.userData.lateralOffset ?? 0,
        );
        const carrierLocalY = Number(
          rig.polishedRod.userData.carrierLocalY ?? -0.12,
        );
        const rodBottom = Number(rig.polishedRod.userData.bottomY ?? 0.31);
        const rodTopX =
          motionPlane === "yz"
            ? pivotX + rodLateralOffset
            : pivotX + Math.cos(beamAngle) * rodRadius;
        const rodTopY =
          pivotY +
          (motionPlane === "yz"
            ? carrierLocalY * Math.cos(beamAngle) -
              Math.sin(beamAngle) * rodRadius
            : Math.sin(beamAngle) * rodRadius);
        const rodTopZ =
          motionPlane === "yz"
            ? pivotZ +
              carrierLocalY * Math.sin(beamAngle) +
              Math.cos(beamAngle) * rodRadius
            : rig.polishedRod.position.z;
        const rodLength = Math.max(0.16, rodTopY - rodBottom);
        rig.polishedRod.position.x = rodTopX;
        rig.polishedRod.position.y = rodBottom + rodLength * 0.5;
        rig.polishedRod.position.z = rodTopZ;
        rig.polishedRod.scale.y = rodLength;
        rig.polishedRod.userData.stroke =
          rodTopY - (pivotY - 0.12);
        rig.polishedRod.userData.crankPhase = mechanismPhase;
        if (rig.bridleCarrier) {
          rig.bridleCarrier.position.set(rodTopX, rodTopY, rodTopZ);
          rig.bridleCarrier.userData.polishedRodContact = [
            rodTopX,
            rodTopY,
            rodTopZ,
          ];
          rig.bridleCarrier.userData.contactError = 0;
        }
        for (const bridle of rig.bridleRods ?? []) {
          const noseLocal = bridle.userData.noseLocal as
            | readonly [number, number, number]
            | undefined;
          if (!noseLocal) continue;
          const carrierLateralOffset = Number(
            bridle.userData.carrierLateralOffset ?? 0,
          );
          if (motionPlane === "yz") {
            this.tempStart.set(
              pivotX + noseLocal[0],
              pivotY +
                noseLocal[1] * Math.cos(beamAngle) -
                noseLocal[2] * Math.sin(beamAngle),
              pivotZ +
                noseLocal[1] * Math.sin(beamAngle) +
                noseLocal[2] * Math.cos(beamAngle),
            );
          } else {
            this.tempStart.set(
              pivotX +
                noseLocal[0] * Math.cos(beamAngle) -
                noseLocal[1] * Math.sin(beamAngle),
              pivotY +
                noseLocal[0] * Math.sin(beamAngle) +
                noseLocal[1] * Math.cos(beamAngle),
              pivotZ + noseLocal[2],
            );
          }
          this.tempEnd.set(
            rodTopX + carrierLateralOffset,
            rodTopY,
            rodTopZ,
          );
          beamMatrix(bridle, this.tempStart, this.tempEnd, 0.043);
          bridle.userData.nosePinContact = this.tempStart.toArray();
          bridle.userData.carrierContact = this.tempEnd.toArray();
          bridle.userData.contactError = 0;
          bridle.userData.beamAngle = beamAngle;
        }

        const crankCenter = rig.pitmanArm.userData.crankCenter as
          | readonly [number, number, number]
          | undefined;
        const beamAttachment = rig.pitmanArm.userData.beamAttachment as
          | readonly [number, number, number]
          | undefined;
        const crankRadius = Number(
          rig.pitmanArm.userData.crankRadius ?? 0.26,
        );
        if (crankCenter && beamAttachment) {
          if (motionPlane === "yz") {
            if (rig.pitmanArm.userData.crankPlane === "xy") {
              this.tempStart.set(
                crankCenter[0] + Math.cos(mechanismPhase) * crankRadius,
                crankCenter[1] + Math.sin(mechanismPhase) * crankRadius,
                crankCenter[2],
              );
            } else {
              this.tempStart.set(
                crankCenter[0],
                crankCenter[1] + Math.sin(mechanismPhase) * crankRadius,
                crankCenter[2] + Math.cos(mechanismPhase) * crankRadius,
              );
            }
            this.tempEnd.set(
              pivotX + beamAttachment[0],
              pivotY +
                beamAttachment[1] * Math.cos(beamAngle) -
                beamAttachment[2] * Math.sin(beamAngle),
              pivotZ +
                beamAttachment[1] * Math.sin(beamAngle) +
                beamAttachment[2] * Math.cos(beamAngle),
            );
          } else {
            this.tempStart.set(
              crankCenter[0] + Math.cos(mechanismPhase) * crankRadius,
              crankCenter[1] + Math.sin(mechanismPhase) * crankRadius,
              crankCenter[2],
            );
            const attachmentX =
              pivotX +
              beamAttachment[0] * Math.cos(beamAngle) -
              beamAttachment[1] * Math.sin(beamAngle);
            const attachmentY =
              pivotY +
              beamAttachment[0] * Math.sin(beamAngle) +
              beamAttachment[1] * Math.cos(beamAngle);
            this.tempEnd.set(
              attachmentX,
              attachmentY,
              beamAttachment[2],
            );
          }
          beamMatrix(
            rig.pitmanArm,
            this.tempStart,
            this.tempEnd,
            0.035,
          );
          rig.pitmanArm.userData.crankPhase = mechanismPhase;
          rig.pitmanArm.userData.beamAngle = beamAngle;
        }
      }
      for (const [index, valve] of (rig.valveHandles ?? []).entries()) {
        const openRatio = blocked ? 0.05 : active ? 0.86 : 0.4;
        valve.scale.setScalar(blocked ? 1.55 : active ? 1 : 1.12);
        valve.rotation.z =
          THREE.MathUtils.lerp(0.62, -0.72, openRatio) +
          (blocked ? Math.sin(elapsed * 1.8 + index) * 0.006 : 0);
        valve.userData.openRatio = openRatio;
        valve.userData.operatingState = blocked
          ? "mechanically-closed"
          : active
            ? "open"
            : "standby";
      }
      const input = entity.fluidState.input;
      const output = entity.fluidState.output;
      const inputFill =
        input && input.capacityMilli > 0
          ? THREE.MathUtils.clamp(
              input.amountMilli / input.capacityMilli,
              0,
              1,
            )
          : fill;
      const outputFill =
        output && output.capacityMilli > 0
          ? THREE.MathUtils.clamp(
              output.amountMilli / output.capacityMilli,
              0,
              1,
            )
          : fill;
      for (const [index, needle] of (rig.gaugeNeedles ?? []).entries()) {
        const pressure =
          blocked
            ? 1
            : index === 0
              ? inputFill
              : outputFill;
        const needleAngle = THREE.MathUtils.lerp(-1.3, 1.3, pressure);
        if (needle.userData.rotationAxis === "y") {
          needle.rotation.y = needleAngle;
        } else {
          needle.rotation.z = needleAngle;
        }
        needle.userData.pressureRatio = pressure;
        needle.userData.backpressured = blocked;
      }
      for (const window of rig.heatWindows ?? []) {
        window.visible = active;
        window.userData.authoritativeState = active
          ? "firing"
          : blocked
            ? "pressure-limited"
            : "cold";
      }
      if (rig.heatLight) {
        const workingIntensity =
          entity.kind === "fluidProcessor" ? 1.08 : 0.34;
        const residualIntensity =
          entity.kind === "fluidProcessor" ? 0.12 : 0.06;
        rig.heatLight.intensity = active
          ? workingIntensity
          : blocked
            ? residualIntensity
            : 0;
        rig.heatLight.userData.authoritativeState = active
          ? "firing"
          : blocked
            ? "afterheat"
            : "cold";
      }
      if (rig.reliefCap) {
        const baseY = Number(rig.reliefCap.userData.baseY ?? 2.79);
        rig.reliefCap.position.y =
          baseY +
          (blocked
            ? 0.095 + Math.sin(elapsed * 4.2) * 0.009
            : active
              ? 0.006
              : 0);
        rig.reliefCap.userData.lift =
          rig.reliefCap.position.y - baseY;
        rig.reliefCap.userData.backpressured = blocked;
        rig.reliefCap.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          if (
            object.name ===
            "fluid-processor-relief-cap-weather-shield"
          ) {
            object.material = blocked
              ? this.materials.heatOxide
              : this.materials.oxidizedSteel;
          } else if (
            object.name === "fluid-processor-relief-cap-seated-edge"
          ) {
            object.material = blocked
              ? this.materials.safetyPaint
              : this.materials.copper;
          }
        });
      }
      if (rig.reliefSpring) {
        rig.reliefSpring.scale.y = blocked ? 0.68 : active ? 0.94 : 1;
        rig.reliefSpring.userData.compressionRatio = blocked
          ? 0.32
          : active
            ? 0.06
            : 0;
        rig.reliefSpring.userData.operatingState = blocked
          ? "compressed-before-relief"
          : active
            ? "loaded"
            : "seated";
      }
      const tankPressureHeld =
        entity.kind === "fluidTank" && fill >= 0.985;
      for (const spring of rig.tankPressureSprings ?? []) {
        spring.scale.y = tankPressureHeld ? 0.7 : 1;
        spring.userData.compressionRatio = tankPressureHeld ? 0.3 : 0;
        spring.userData.operatingState = tankPressureHeld
          ? "compressed-full-tank"
          : "available-capacity";
      }
      for (const cap of rig.tankVentCaps ?? []) {
        const baseY = Number(cap.userData.baseY ?? cap.position.y);
        cap.position.y =
          baseY +
          (tankPressureHeld
            ? 0.075 + Math.sin(elapsed * 2.2) * 0.004
            : 0);
        cap.userData.lift = cap.position.y - baseY;
        cap.userData.operatingState = tankPressureHeld
          ? "pressure-ready"
          : "seated";
        if (cap instanceof THREE.Mesh) {
          cap.material = tankPressureHeld
            ? this.materials.safetyPaint
            : this.materials.heatOxide;
        }
      }
      if (entity.kind === "fluidTank") {
        rig.root.userData.pressureMechanismState = tankPressureHeld
          ? "full-gauge-high-spring-compressed-cap-lifted"
          : "capacity-available-gauge-tracking-cap-seated";
      }
      rig.root.userData.mechanismPhase = mechanismPhase;
      rig.root.userData.authoritativeStatus = entity.status;
      rig.root.userData.authoritativeFillRatio = fill;
      rig.root.userData.processTicks = entity.fluidState.processTicks;
      if (rig.status instanceof THREE.Mesh) {
        const statusMaterial = active
          ? this.materials.active
          : blocked
            ? this.materials.warning
            : this.materials.inactive;
        rig.status.material = statusMaterial;
        rig.status.userData.operatingState = active
          ? "working"
          : blocked
            ? "backpressured"
            : entity.status;
        if (rig.statusHalo) {
          rig.statusHalo.material = statusMaterial;
          const pulse = blocked
            ? 1.08 + Math.sin(elapsed * 5.2) * 0.13
            : active
              ? 0.96 + Math.sin(elapsed * 2.7) * 0.045
              : 0.82;
          rig.statusHalo.scale.setScalar(pulse);
          rig.statusHalo.rotation.y = elapsed * (blocked ? 1.8 : 0.35);
          rig.statusHalo.userData.operatingState =
            rig.status.userData.operatingState;
        }
      }
      if (rig.statusLight) {
        rig.statusLight.color.setHex(blocked ? 0xff7a2f : 0x57ead3);
        rig.statusLight.intensity = blocked ? 0.38 : active ? 0.24 : 0;
        rig.statusLight.userData.operatingState = blocked
          ? "backpressured"
          : active
            ? "working"
            : entity.status;
      }
      if (rig.pressureValve) {
        rig.pressureValve.scale.setScalar(blocked ? 1.55 : 1.12);
        rig.pressureValve.rotation.z =
          blocked
            ? 0.86 + Math.sin(elapsed * 4.1) * 0.055
            : active
              ? -0.26
              : 0.08;
        rig.pressureValve.userData.backpressured = blocked;
        rig.pressureValve.userData.openRatio = blocked
          ? 1
          : active
            ? 0.18
            : 0.35;
        rig.pressureValve.traverse((object) => {
          if (
            object instanceof THREE.Mesh &&
            object.name ===
              "fluid-processor-backpressure-handwheel-rim"
          ) {
            object.material = this.materials.safetyPaint;
          }
        });
      }
      if (rig.shutdownGate) {
        const gateTravel = blocked ? 0 : active ? 0.48 : 0.24;
        rig.shutdownGate.scale.setScalar(blocked ? 1.22 : 1);
        rig.shutdownGate.position.x = -0.52;
        rig.shutdownGate.rotation.z = blocked
          ? 0
          : active
            ? -0.92
            : -0.38;
        rig.shutdownGate.userData.operatingState = blocked
          ? "trip-gate-seated"
          : active
            ? "trip-gate-clear"
            : "trip-gate-standby";
        rig.shutdownGate.userData.travelRatio = blocked
          ? 0
          : active
            ? 1
            : 0.5;
        rig.shutdownGate.traverse((object) => {
          if (
            object instanceof THREE.Mesh &&
            object.name === "fluid-processor-shutdown-gate-crossbar"
          ) {
            object.material = this.materials.safetyPaint;
          }
        });
      }
      for (const [plumeIndex, plume] of (
        rig.steamPlumes ?? []
      ).entries()) {
        plume.visible = blocked && plumeIndex === 0;
        if (!plume.visible) continue;
        const phase =
          (elapsed * 0.24 +
            Number(plume.userData.phase ?? 0)) %
          1;
        const baseY = Number(plume.userData.baseY ?? 3.22);
        plume.position.y =
          baseY + Math.sin(elapsed * 0.78 + phase * 4.2) * 0.028;
        const baseX = Number(plume.userData.baseX ?? -0.5);
        const processBaseZ = Number(
          plume.userData.processBaseZ ?? plume.position.z,
        );
        plume.position.x =
          baseX + Math.sin(elapsed * 0.61 + phase * 6) * 0.018;
        plume.position.z = Number(
          plume.userData.baseZ ?? processBaseZ,
        );
        const spread = 0.39 + phase * 0.07;
        plume.scale.set(
          spread,
          0.8 + phase * 0.11,
          1,
        );
        plume.userData.emissionPhase = phase;
        plume.userData.operatingState = "relieving-backpressure";
        plume.userData.presentation = "restrained-primary-relief";
      }
      this.updateSight(rig, entity, network);
      if (entity.kind === "fluidProcessor") {
        const visibleInputFill = Number(
          rig.inputSight?.userData.fillRatio ?? inputFill,
        );
        const visibleOutputFill = Number(
          rig.outputSight?.userData.fillRatio ?? outputFill,
        );
        const processStage = blocked
          ? 4
          : active && visibleOutputFill >= 0.25
            ? 3
            : active
              ? 2
              : visibleInputFill > 0
                ? 1
                : 0;
        const processStageName = [
          "cold-and-empty",
          "crude-feed-primed",
          "fired-fractionation",
          "product-transfer",
          "storage-backpressure",
        ][processStage]!;
        const engagedStageCount =
          processStage === 0
            ? 0
            : processStage === 1
              ? 1
              : rig.processStageIndicators?.length ?? 0;
        for (const [index, stage] of (
          rig.processStageIndicators ?? []
        ).entries()) {
          const engaged = index < engagedStageCount;
          const stagePulse =
            active && engaged
              ? 0.88 +
                Math.sin(elapsed * 3.1 - index * 0.72) * 0.08
              : blocked && engaged
                ? 0.68
                : engaged
                  ? 0.56
                  : 0.34;
          stage.scale.setScalar(stagePulse);
          stage.position.z =
            Number(stage.userData.baseZ ?? 0.182) +
            (engaged ? 0.028 : 0);
          stage.material = engaged
            ? blocked
              ? this.materials.heatOxide
              : active
                ? this.materials.warning
                : this.materials.copper
            : this.materials.soot;
          stage.userData.stageEngaged = engaged;
          stage.userData.processStage = processStageName;
          stage.userData.authoritativeProcessTicks =
            entity.fluidState.processTicks;
        }
        if (rig.processFeedSlug) {
          rig.processFeedSlug.visible = visibleInputFill > 0;
          rig.processFeedSlug.position.x =
            -0.02 + Math.sin(mechanismPhase * 0.43) * 0.08;
          rig.processFeedSlug.scale.setScalar(
            0.72 + Math.min(1, visibleInputFill) * 0.34,
          );
          rig.processFeedSlug.userData.fillRatio = visibleInputFill;
          rig.processFeedSlug.userData.operatingState =
            processStage === 1
              ? "feed-arriving"
              : blocked
                ? "feed-held"
                : active
                  ? "metered-feed"
                  : "empty";
        }
        if (rig.processProductSlug) {
          rig.processProductSlug.visible = visibleOutputFill > 0;
          rig.processProductSlug.position.y =
            blocked
              ? 1.28
              : 0.98 +
                ((elapsed * 0.34 + entity.id * 0.17) % 1) * 0.28;
          rig.processProductSlug.scale.setScalar(
            blocked
              ? 1.18
              : 0.74 + Math.min(1, visibleOutputFill) * 0.32,
          );
          rig.processProductSlug.userData.fillRatio = visibleOutputFill;
          rig.processProductSlug.userData.operatingState = blocked
            ? "pressure-held-product"
            : active
              ? "condensate-transfer"
              : visibleOutputFill > 0
                ? "downstream-custody"
                : "empty";
        }
        rig.root.userData.processStage = processStage;
        rig.root.userData.processStageName = processStageName;
        rig.root.userData.engagedFractionationStages = engagedStageCount;
        rig.root.userData.inputCustodyFillRatio = visibleInputFill;
        rig.root.userData.outputCustodyFillRatio = visibleOutputFill;
        rig.root.userData.lifecycleCausality =
          "input-custody>feed-slug>valve-and-metering-rotor>burner>five-stage-tower>condenser>product-slug>output-custody";
      }
    }
    for (const [id, rig] of this.rigs) {
      if (alive.has(id)) continue;
      disposeRig(rig);
      this.rigs.delete(id);
    }
  }

  private syncNetwork(
    frame: FluidVisualFrame,
    entities: readonly FluidVisualEntity[],
  ): number {
    const edges = frame.fluidNetwork.edges;
    this.ensureEdgeCapacity(edges.length);
    if (
      !this.networkBeams ||
      !this.crudePulses ||
      !this.refinedPulses
    ) {
      return 0;
    }
    const entityById = new Map(entities.map((entity) => [entity.id, entity]));
    const nodeByKey = new Map(
      frame.fluidNetwork.nodes.map((node) => [
        `${node.entityId}:${node.role}`,
        node,
      ]),
    );
    const edgeEntityIds: Array<readonly [number, number]> = [];
    let crudeCount = 0;
    let refinedCount = 0;
    for (let index = 0; index < edges.length; index += 1) {
      const edge = edges[index]!;
      const sourceEntity = entityById.get(edge.sourceEntityId);
      const targetEntity = entityById.get(edge.targetEntityId);
      if (!sourceEntity || !targetEntity) continue;
      const sourceDirection = directionToward(sourceEntity, targetEntity);
      const targetDirection = oppositeDirection(sourceDirection);
      this.tempStart.copy(portAnchor(sourceEntity, sourceDirection, 0.17));
      this.tempEnd.copy(portAnchor(targetEntity, targetDirection, 0.17));
      beamMatrix(this.temp, this.tempStart, this.tempEnd, 0.18);
      this.networkBeams.setMatrixAt(index, this.temp.matrix);
      edgeEntityIds[index] = [sourceEntity.id, targetEntity.id];

      const sourceNode = nodeByKey.get(
        `${edge.sourceEntityId}:${edge.sourceRole}`,
      );
      const targetNode = nodeByKey.get(
        `${edge.targetEntityId}:${edge.targetRole}`,
      );
      const sourceStopped =
        sourceEntity.status === "blocked" ||
        sourceEntity.status === "outputFull";
      const targetStopped =
        targetEntity.status === "blocked" ||
        targetEntity.status === "outputFull" ||
        Boolean(
          targetNode &&
            targetNode.capacityMilli > 0 &&
            targetNode.amountMilli / targetNode.capacityMilli >= 0.985,
        );
      const expectedFluid: FluidId | undefined =
        sourceNode?.fluidId ??
        (sourceEntity.kind === "fluidSource"
          ? sourceEntity.fluidState.sourceFluidId
          : sourceEntity.kind === "fluidProcessor" &&
              edge.sourceRole === "output"
            ? "refinedFuel"
            : targetEntity.kind === "fluidProcessor" &&
                edge.targetRole === "input"
              ? "crudeOil"
              : undefined);
      this.networkBeams.setColorAt(
        index,
        sourceStopped || targetStopped
          ? PIPE_SHELL_TINTS.held
          : expectedFluid === "crudeOil"
          ? PIPE_SHELL_TINTS.crudeOil
          : expectedFluid === "refinedFuel"
            ? PIPE_SHELL_TINTS.refinedFuel
            : PIPE_SHELL_TINTS.empty,
      );
      if (!sourceNode?.fluidId || sourceNode.amountMilli <= 0) continue;
      if (sourceStopped || targetStopped) continue;
      const pulseMesh =
        sourceNode.fluidId === "crudeOil"
          ? this.crudePulses
          : this.refinedPulses;
      const slot =
        sourceNode.fluidId === "crudeOil" ? crudeCount++ : refinedCount++;
      const pulseProgress =
        0.18 +
        ((frame.elapsedSeconds * 0.76 + index * 0.173) % 1) * 0.48;
      const coreStart = this.tempStart
        .clone()
        .lerp(this.tempEnd, pulseProgress);
      const coreEnd = this.tempStart
        .clone()
        .lerp(this.tempEnd, Math.min(0.86, pulseProgress + 0.16));
      coreStart.y +=
        0.215 + Math.sin(frame.elapsedSeconds * 1.8 + index) * 0.002;
      coreEnd.y = coreStart.y;
      beamMatrix(this.temp, coreStart, coreEnd, 0.048);
      pulseMesh.setMatrixAt(slot, this.temp.matrix);
    }
    this.networkBeams.count = edges.length;
    this.crudePulses.count = crudeCount;
    this.refinedPulses.count = refinedCount;
    this.networkBeams.userData.edgeEntityIds = edgeEntityIds;
    this.networkBeams.userData.topologySource = "authoritative-fluid-edges";
    this.networkBeams.instanceMatrix.needsUpdate = true;
    if (this.networkBeams.instanceColor) {
      this.networkBeams.instanceColor.needsUpdate = true;
    }
    this.crudePulses.instanceMatrix.needsUpdate = true;
    this.refinedPulses.instanceMatrix.needsUpdate = true;
    return crudeCount + refinedCount;
  }

  private ensurePipeCapacity(count: number): void {
    if (count <= this.pipeCapacity) return;
    this.releasePipeBatches();
    this.pipeCapacity = Math.max(16, 2 ** Math.ceil(Math.log2(count)));
    this.pipeOuter = new THREE.InstancedMesh(
      this.pipeOuterGeometry,
      this.materials.steel,
      this.pipeCapacity * 4,
    );
    this.pipeCrude = new THREE.InstancedMesh(
      this.pipeInnerGeometry,
      this.materials.crude,
      this.pipeCapacity * 4,
    );
    this.pipeRefined = new THREE.InstancedMesh(
      this.pipeInnerGeometry,
      this.materials.refined,
      this.pipeCapacity * 4,
    );
    this.pipeFlanges = new THREE.InstancedMesh(
      this.pipeFlangeGeometry,
      this.materials.copper,
      this.pipeCapacity * 8,
    );
    this.pipeSupports = new THREE.InstancedMesh(
      this.pipeSupportGeometry,
      this.materials.steelDark,
      this.pipeCapacity,
    );
    // Retained as the exact locked-lifecycle fallback. Normal district
    // presentation uses the interval forged shoes authored in districtRoot.
    this.pipeSupports.visible = false;
    for (const [name, mesh] of [
      ["fluid-pipe-shells", this.pipeOuter],
      ["fluid-pipe-crude-contents", this.pipeCrude],
      ["fluid-pipe-refined-contents", this.pipeRefined],
      ["fluid-pipe-flanges", this.pipeFlanges],
      ["fluid-pipe-load-bearing-saddles", this.pipeSupports],
    ] as const) {
      mesh.name = name;
      mesh.castShadow = name === "fluid-pipe-shells";
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.pipeRoot.add(mesh);
    }
  }

  private ensureEdgeCapacity(count: number): void {
    if (count <= this.edgeCapacity && count <= this.pulseCapacity) return;
    this.releaseNetworkBatches();
    this.edgeCapacity = Math.max(16, 2 ** Math.ceil(Math.log2(count)));
    this.pulseCapacity = this.edgeCapacity;
    this.networkBeams = new THREE.InstancedMesh(
      this.networkBeamGeometry,
      this.materials.steel,
      this.edgeCapacity,
    );
    this.crudePulses = new THREE.InstancedMesh(
      this.pulseGeometry,
      this.materials.crude,
      this.pulseCapacity,
    );
    this.refinedPulses = new THREE.InstancedMesh(
      this.pulseGeometry,
      this.materials.refined,
      this.pulseCapacity,
    );
    this.networkBeams.name = "fluid-network-coupling-hoses";
    // Retained for the byte-locked lifecycle proof. The normal district uses
    // the height-correct authored header/branch mesh from syncDistrict.
    this.networkBeams.visible = false;
    this.crudePulses.name = "fluid-network-crude-flow-pulses";
    this.refinedPulses.name = "fluid-network-refined-flow-pulses";
    this.networkBeams.userData.presentation =
      "authoritative-boundary-pressure-coupling";
    this.crudePulses.userData.presentation = "contained-crude-sight-core";
    this.refinedPulses.userData.presentation = "contained-refined-sight-core";
    for (const mesh of [
      this.networkBeams,
      this.crudePulses,
      this.refinedPulses,
    ]) {
      mesh.frustumCulled = false;
      this.networkRoot.add(mesh);
    }
  }

  private releasePipeBatches(): void {
    for (const mesh of [
      this.pipeOuter,
      this.pipeCrude,
      this.pipeRefined,
      this.pipeFlanges,
      this.pipeSupports,
    ]) {
      if (!mesh) continue;
      mesh.removeFromParent();
      mesh.dispose();
    }
    this.pipeOuter = null;
    this.pipeCrude = null;
    this.pipeRefined = null;
    this.pipeFlanges = null;
    this.pipeSupports = null;
    this.pipeCapacity = 0;
  }

  private releaseNetworkBatches(): void {
    for (const mesh of [
      this.networkBeams,
      this.crudePulses,
      this.refinedPulses,
    ]) {
      if (!mesh) continue;
      mesh.removeFromParent();
      mesh.dispose();
    }
    this.networkBeams = null;
    this.crudePulses = null;
    this.refinedPulses = null;
    this.edgeCapacity = 0;
    this.pulseCapacity = 0;
  }

  private createRig(
    kind: Exclude<FluidEntityKind, "fluidPipe">,
  ): FluidRig {
    const root = new THREE.Group();
    root.name = `fluid-${kind}-rig`;
    const ownedGeometries: THREE.BufferGeometry[] = [];
    const add = <T extends THREE.BufferGeometry>(
      geometry: T,
      material: THREE.Material,
      position: readonly [number, number, number],
      rotation: readonly [number, number, number] = [0, 0, 0],
      scale: readonly [number, number, number] = [1, 1, 1],
      name?: string,
    ): THREE.Mesh<T, THREE.Material> => {
      ownedGeometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.rotation.set(...rotation);
      mesh.scale.set(...scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (name) mesh.name = name;
      root.add(mesh);
      return mesh;
    };
    const addTo = <T extends THREE.BufferGeometry>(
      parent: THREE.Object3D,
      geometry: T,
      material: THREE.Material,
      position: readonly [number, number, number],
      rotation: readonly [number, number, number] = [0, 0, 0],
      name?: string,
    ): THREE.Mesh<T, THREE.Material> => {
      ownedGeometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.rotation.set(...rotation);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (name) mesh.name = name;
      parent.add(mesh);
      return mesh;
    };
    const addBeam = (
      start: readonly [number, number, number],
      end: readonly [number, number, number],
      width: number,
      material: THREE.Material,
      name: string,
    ): THREE.Mesh => {
      const startVector = new THREE.Vector3(...start);
      const endVector = new THREE.Vector3(...end);
      const delta = endVector.clone().sub(startVector);
      const mesh = add(
        new THREE.BoxGeometry(width, 1, width),
        material,
        [
          (start[0] + end[0]) * 0.5,
          (start[1] + end[1]) * 0.5,
          (start[2] + end[2]) * 0.5,
        ],
        [0, 0, 0],
        [1, 1, 1],
        name,
      );
      mesh.quaternion.setFromUnitVectors(UP, delta.normalize());
      mesh.scale.y = delta.length();
      return mesh;
    };
    const addRoundPipe = (
      start: readonly [number, number, number],
      end: readonly [number, number, number],
      radius: number,
      material: THREE.Material,
      name: string,
      radialSegments = 12,
    ): THREE.Mesh => {
      const startVector = new THREE.Vector3(...start);
      const endVector = new THREE.Vector3(...end);
      const delta = endVector.clone().sub(startVector);
      const mesh = add(
        new THREE.CylinderGeometry(
          radius,
          radius,
          delta.length(),
          radialSegments,
          1,
        ),
        material,
        [
          (start[0] + end[0]) * 0.5,
          (start[1] + end[1]) * 0.5,
          (start[2] + end[2]) * 0.5,
        ],
        [0, 0, 0],
        [1, 1, 1],
        name,
      );
      mesh.quaternion.setFromUnitVectors(UP, delta.normalize());
      return mesh;
    };
    const addBentPipe = (
      points: readonly (readonly [number, number, number])[],
      radius: number,
      material: THREE.Material,
      name: string,
    ): THREE.Mesh => {
      const curve = new THREE.CatmullRomCurve3(
        points.map((point) => new THREE.Vector3(...point)),
        false,
        "centripetal",
        0.32,
      );
      return add(
        new THREE.TubeGeometry(
          curve,
          Math.max(18, points.length * 8),
          radius,
          12,
          false,
        ),
        material,
        [0, 0, 0],
        [0, 0, 0],
        [1, 1, 1],
        name,
      );
    };
    const foundationSize: readonly [number, number, number] =
      kind === "fluidTank"
        ? [2.82, 0.16, 2.82]
        : kind === "fluidProcessor"
          ? [2.82, 0.16, 2.72]
          : kind === "fluidSource"
            ? [1.82, 0.16, 1.82]
            : [0.92, 0.14, 0.92];
    const [foundationWidth, foundationHeight, foundationDepth] =
      foundationSize;
    add(
      kind === "fluidTank"
        ? new THREE.CylinderGeometry(
            foundationWidth * 0.5,
            foundationWidth * 0.52,
            foundationHeight,
            24,
          )
        : new RoundedBoxGeometry(
            foundationWidth,
            foundationHeight,
            foundationDepth,
            2,
            0.055,
          ),
      this.materials.foundation,
      [0, foundationHeight * 0.5, 0],
      [0, 0, 0],
      [1, 1, 1],
      `fluid-${kind}-foundation`,
    );
    add(
      kind === "fluidTank"
        ? new THREE.CylinderGeometry(
            foundationWidth * 0.46,
            foundationWidth * 0.47,
            0.045,
            24,
          )
        : new RoundedBoxGeometry(
            foundationWidth - 0.16,
            0.045,
            foundationDepth - 0.16,
            2,
            0.028,
      ),
      kind === "fluidProcessor"
        ? this.materials.steel
        : this.materials.paintedSteel,
      [0, foundationHeight + 0.012, 0],
      [0, 0, 0],
      [1, 1, 1],
      `fluid-${kind}-service-deck`,
    );
    if (kind === "fluidTank") {
      add(
        new THREE.TorusGeometry(
          foundationWidth * 0.455,
          0.055,
          7,
          28,
        ),
        this.materials.rust,
        [0, foundationHeight + 0.035, 0],
        [Math.PI / 2, 0, 0],
        [1, 1, 1],
        "fluid-tank-circular-spill-containment-curb",
      );
      for (const [position, size] of [
        [[0, 0.255, -1.38], [2.3, 0.2, 0.12]],
        [[0, 0.255, 1.38], [2.3, 0.2, 0.12]],
        [[-1.38, 0.255, 0], [0.12, 0.2, 2.3]],
        [[1.38, 0.255, 0], [0.12, 0.2, 2.3]],
      ] as const) {
        add(
          new RoundedBoxGeometry(size[0], size[1], size[2], 2, 0.025),
          this.materials.foundation,
          position,
          [0, 0, 0],
          [1, 1, 1],
          "fluid-tank-segmented-containment-dike",
        );
      }
      add(
        new RoundedBoxGeometry(0.42, 0.08, 0.34, 2, 0.035),
        this.materials.soot,
        [0.86, 0.205, 1.17],
        [0, -0.08, 0],
        [1, 1, 1],
        "fluid-tank-containment-drain-sump",
      );
      for (const x of [-0.96, 0.96]) {
        for (const z of [-0.96, 0.96]) {
          add(
            new RoundedBoxGeometry(0.34, 0.13, 0.34, 2, 0.035),
            this.materials.foundation,
            [x, 0.18, z],
            [0, 0, 0],
            [1, 1, 1],
            "fluid-tank-load-spreading-pier",
          );
        }
      }
    } else {
      for (const x of [
        -foundationWidth * 0.5 + 0.24,
        foundationWidth * 0.5 - 0.24,
      ]) {
        for (const z of [
          -foundationDepth * 0.5 + 0.2,
          foundationDepth * 0.5 - 0.2,
        ]) {
          add(
            new RoundedBoxGeometry(0.3, 0.12, 0.26, 2, 0.035),
            this.materials.foundation,
            [x, 0.18, z],
            [0, 0, 0],
            [1, 1, 1],
            `fluid-${kind}-load-spreading-pier`,
          );
        }
      }
    }
    const contactStains: THREE.BufferGeometry[] = [];
    for (const [x, z, radius, stretchX, stretchZ] of [
      [-foundationWidth * 0.34, foundationDepth * 0.22, 0.38, 1.45, 0.66],
      [foundationWidth * 0.24, -foundationDepth * 0.31, 0.3, 0.84, 1.5],
      [foundationWidth * 0.38, foundationDepth * 0.36, 0.22, 1.25, 0.58],
    ] as const) {
      const stain = new THREE.CircleGeometry(radius, 18);
      stain.rotateX(-Math.PI / 2);
      stain.scale(stretchX, 1, stretchZ);
      stain.translate(x, 0.008, z);
      contactStains.push(stain);
    }
    add(
      mergeOwnedGeometries(
        contactStains,
        `fluid-${kind}-terrain-contact-stain-geometry`,
      ),
      this.materials.groundStain,
      [0, 0, 0],
      [0, 0, 0],
      [1, 1, 1],
      `fluid-${kind}-terrain-contact-staining`,
    );
    const grateCount = Math.max(
      2,
      Math.min(9, Math.floor(foundationWidth / 0.3)),
    );
    for (let index = 0; index < grateCount; index += 1) {
      const normalized =
        grateCount === 1 ? 0.5 : index / (grateCount - 1);
      add(
        new RoundedBoxGeometry(
          0.035,
          0.022,
          foundationDepth - 0.24,
          1,
          0.008,
        ),
        this.materials.steelDark,
        [
          -foundationWidth * 0.5 +
            0.14 +
            normalized * (foundationWidth - 0.28),
          foundationHeight + 0.043,
          0,
        ],
        [0, 0, 0],
        [1, 1, 1],
        `fluid-${kind}-service-deck-grate`,
      );
    }
    for (const x of [
      -foundationWidth * 0.5 + 0.25,
      foundationWidth * 0.5 - 0.25,
    ]) {
      for (const z of [
        -foundationDepth * 0.5 + 0.105,
        foundationDepth * 0.5 - 0.105,
      ]) {
        add(
          new RoundedBoxGeometry(0.3, 0.03, 0.055, 2, 0.012),
          this.materials.safetyPaint,
          [x, foundationHeight + 0.061, z],
          [0, 0, x * z > 0 ? -0.18 : 0.18],
          [1, 1, 1],
          `fluid-${kind}-deck-hazard-marker`,
        );
      }
    }
    for (const [x, z, width, depth, rotation] of [
      [-0.31, -0.22, 0.44, 0.19, -0.13],
      [0.34, 0.28, 0.32, 0.16, 0.21],
      [0.08, -0.43, 0.2, 0.1, -0.08],
    ] as const) {
      add(
        new RoundedBoxGeometry(width, 0.018, depth, 1, 0.012),
        Math.abs(x) > 0.32 ? this.materials.rust : this.materials.soot,
        [
          x * Math.min(1.9, foundationWidth),
          foundationHeight + 0.061,
          z * Math.min(1.7, foundationDepth),
        ],
        [0, rotation, 0],
        [1, 1, 1],
        `fluid-${kind}-localized-deck-grime`,
      );
    }
    const anchorInset = kind === "fluidPump" ? 0.27 : 0.22;
    for (const x of [
      -foundationWidth * 0.5 + anchorInset,
      foundationWidth * 0.5 - anchorInset,
    ]) {
      for (const z of [
        -foundationDepth * 0.5 + anchorInset,
        foundationDepth * 0.5 - anchorInset,
      ]) {
        add(
          new THREE.CylinderGeometry(0.045, 0.052, 0.07, 8),
          this.materials.brass,
          [x, foundationHeight + 0.06, z],
          [0, 0, 0],
          [1, 1, 1],
          `fluid-${kind}-foundation-anchor`,
        );
      }
    }

    let rotor: THREE.Object3D | undefined;
    let secondaryRotor: THREE.Object3D | undefined;
    let actuator: THREE.Object3D | undefined;
    let polishedRod: THREE.Object3D | undefined;
    let pitmanArm: THREE.Object3D | undefined;
    const bridleRods: THREE.Object3D[] = [];
    let bridleCarrier: THREE.Object3D | undefined;
    const processStageIndicators: THREE.Mesh[] = [];
    let processFeedSlug: THREE.Mesh | undefined;
    let processProductSlug: THREE.Mesh | undefined;
    let reliefSpring: THREE.Object3D | undefined;
    const tankPressureSprings: THREE.Object3D[] = [];
    const tankVentCaps: THREE.Object3D[] = [];
    const valveHandles: THREE.Object3D[] = [];
    const gaugeNeedles: THREE.Object3D[] = [];
    const heatWindows: THREE.Mesh[] = [];
    let reliefCap: THREE.Object3D | undefined;
    let sight: THREE.Mesh | undefined;
    const sightMirrors: THREE.Mesh[] = [];
    let sightFrame: THREE.Object3D | undefined;
    let levelIndicator: THREE.Mesh | undefined;
    let levelNeedle: THREE.Object3D | undefined;
    let roofLevelDisc: THREE.Mesh | undefined;
    let inputSight: THREE.Mesh | undefined;
    let outputSight: THREE.Mesh | undefined;
    const inputSightMirrors: THREE.Mesh[] = [];
    const outputSightMirrors: THREE.Mesh[] = [];
    const steamPlumes: THREE.Sprite[] = [];
    let pressureValve: THREE.Object3D | undefined;
    let shutdownGate: THREE.Object3D | undefined;
    let heatLight: THREE.PointLight | undefined;

    if (kind === "fluidSource") {
      for (const z of [-0.42, 0.42]) {
        addRoundPipe(
          [-0.46, 0.23, z],
          [0.46, 0.23, z],
          0.034,
          this.materials.structuralMid,
          "fluid-source-load-skid",
          10,
        );
      }
      for (const x of [-0.42, 0, 0.42]) {
        addRoundPipe(
          [x, 0.23, -0.42],
          [x, 0.23, 0.42],
          0.026,
          this.materials.structuralMid,
          "fluid-source-load-skid-cross-tie",
          10,
        );
      }
      for (const x of [-0.42, 0.42]) {
        for (const z of [-0.42, 0.42]) {
          add(
            new RoundedBoxGeometry(0.22, 0.05, 0.18, 2, 0.016),
            this.materials.structuralMid,
            [x, 0.205, z],
            [0, 0, 0],
            [1, 1, 1],
            "fluid-source-load-skid-foot",
          );
        }
      }
      add(
        new THREE.CylinderGeometry(0.25, 0.34, 0.4, 18),
        this.materials.structuralMid,
        [0.5, 0.42, -0.13],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-source-wellhead",
      );
      for (const y of [0.28, 0.47, 0.6]) {
        add(
          new THREE.TorusGeometry(
            y < 0.4 ? 0.335 : 0.255,
            y > 0.55 ? 0.028 : 0.045,
            7,
            20,
          ),
          y > 0.55 ? this.materials.weld : this.materials.copper,
          [0.5, y, -0.13],
          [Math.PI / 2, 0, 0],
          [1, 1, 1],
          y > 0.55
            ? "fluid-source-wellhead-weld-bead"
            : "fluid-source-wellhead-load-ring",
        );
      }
      for (const z of [-0.42, 0.42]) {
        addBeam(
          [-0.7, 0.24, z],
          [-0.04, 1.26, z * 0.27],
          0.075,
          this.materials.structuralMid,
          "fluid-source-a-frame-brace",
        );
        addBeam(
          [0.31, 0.24, z],
          [-0.04, 1.26, z * 0.27],
          0.075,
          this.materials.structuralMid,
          "fluid-source-a-frame-brace",
        );
      }
      for (let rung = 0; rung < 6; rung += 1) {
        const progress = (rung + 0.45) / 6;
        const y = THREE.MathUtils.lerp(0.24, 1.2, progress);
        const x = THREE.MathUtils.lerp(-0.7, -0.04, progress);
        const halfSpan = THREE.MathUtils.lerp(0.42, 0.13, progress);
        addBeam(
          [x, y, -halfSpan],
          [x, y, halfSpan],
          0.026,
          this.materials.structuralMid,
          "fluid-source-a-frame-integrated-ladder-rung",
        );
      }
      for (const z of [-0.46, 0.46]) {
        addBeam(
          [-0.61, 0.38, z],
          [0.14, 0.98, z],
          0.032,
          this.materials.rust,
          "fluid-source-frame-gusset-brace",
        );
      }
      add(
        new THREE.CylinderGeometry(0.13, 0.13, 0.42, 16),
        this.materials.brass,
        [-0.04, 1.26, 0],
        [Math.PI / 2, 0, 0],
        [1, 1, 1],
        "fluid-source-beam-pivot",
      );
      actuator = new THREE.Group();
      actuator.name = "fluid-source-reciprocating-beam";
      actuator.position.set(-0.04, 1.26, 0);
      actuator.userData.mechanism = "walking-beam-from-crank";
      root.add(actuator);
      addTo(
        actuator,
        new RoundedBoxGeometry(1.18, 0.16, 0.26, 3, 0.045),
        this.materials.structuralMid,
        [0.04, 0, 0],
        [0, 0, 0],
        "fluid-source-load-bearing-walking-beam-body",
      );
      addTo(
        actuator,
        new THREE.CylinderGeometry(0.17, 0.21, 0.3, 16),
        this.materials.rust,
        [-0.5, -0.02, 0],
        [Math.PI / 2, 0, 0],
        "fluid-source-walking-beam-counterweight",
      );
      for (const z of [-0.18, 0.18]) {
        addTo(
          actuator,
          new THREE.CylinderGeometry(0.026, 0.03, 0.62, 10),
          this.materials.structuralMid,
          [0.16, 0, z],
          [0, 0, Math.PI / 2],
          "fluid-source-walking-beam-ladder-rail",
        );
      }
      for (const x of [-0.1, 0.16, 0.42]) {
        addTo(
          actuator,
          new THREE.CylinderGeometry(0.023, 0.023, 0.36, 8),
          this.materials.safetyPaint,
          [x, 0, 0],
          [Math.PI / 2, 0, 0],
          "fluid-source-walking-beam-ladder-rung",
        );
      }
      const horseheadGeometry = new RoundedBoxGeometry(
        0.28,
        0.42,
        0.5,
        3,
        0.075,
      );
      ownedGeometries.push(horseheadGeometry);
      const horsehead = new THREE.Mesh(
        horseheadGeometry,
        this.materials.structuralMid,
      );
      horsehead.name = "fluid-source-loaded-horsehead";
      horsehead.position.set(0.62, -0.11, 0);
      horsehead.rotation.z = -0.21;
      horsehead.castShadow = true;
      actuator.add(horsehead);
      const noseGeometry = new THREE.TorusGeometry(
        0.27,
        0.06,
        8,
        18,
        Math.PI * 1.25,
      );
      ownedGeometries.push(noseGeometry);
      const nose = new THREE.Mesh(noseGeometry, this.materials.weld);
      nose.name = "fluid-source-horsehead-rod-guide";
      nose.position.set(0.72, -0.24, 0);
      nose.rotation.z = -0.2;
      actuator.add(nose);

      polishedRod = add(
        new THREE.CylinderGeometry(1, 1, 1, 10),
        this.materials.titanium,
        [0.82, 0.72, 0],
        [0, 0, 0],
        [0.034, 0.9, 0.034],
        "fluid-source-polished-rod",
      );
      polishedRod.userData.bottomY = 0.31;
      polishedRod.userData.beamRadius = 0.68;
      add(
        new THREE.CylinderGeometry(0.12, 0.15, 0.18, 14),
        this.materials.weld,
        [0.82, 0.32, 0],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-source-stuffing-box",
      );

      rotor = new THREE.Group();
      rotor.name = "fluid-source-crank-flywheel";
      rotor.userData.rotationAxis = "z";
      rotor.userData.mechanism = "prime-mover-crank";
      rotor.position.set(-0.57, 0.56, 0.44);
      root.add(rotor);
      const rimGeometry = new THREE.TorusGeometry(0.31, 0.057, 8, 22);
      ownedGeometries.push(rimGeometry);
      const rim = new THREE.Mesh(rimGeometry, this.materials.copper);
      rim.name = "fluid-source-crank-rim";
      rim.castShadow = true;
      rotor.add(rim);
      for (let index = 0; index < 6; index += 1) {
        const angle = (index * Math.PI) / 3;
        const spokeGeometry = new RoundedBoxGeometry(
          0.05,
          0.52,
          0.05,
          1,
          0.01,
        );
        ownedGeometries.push(spokeGeometry);
        const spoke = new THREE.Mesh(spokeGeometry, this.materials.weld);
        spoke.rotation.z = angle;
        spoke.castShadow = true;
        rotor.add(spoke);
      }
      for (const z of [-0.075, 0.075]) {
        const weightGeometry = new THREE.CylinderGeometry(
          0.16,
          0.19,
          0.09,
          16,
        );
        ownedGeometries.push(weightGeometry);
        const weight = new THREE.Mesh(weightGeometry, this.materials.rust);
        weight.name = "fluid-source-crank-counterweight";
        weight.position.set(-0.17, -0.11, z);
        weight.rotation.x = Math.PI / 2;
        rotor.add(weight);
      }
      const pinGeometry = new THREE.CylinderGeometry(0.055, 0.055, 0.16, 10);
      ownedGeometries.push(pinGeometry);
      const pin = new THREE.Mesh(pinGeometry, this.materials.brass);
      pin.name = "fluid-source-crank-pin";
      pin.position.set(0.26, 0, 0.11);
      pin.rotation.x = Math.PI / 2;
      rotor.add(pin);

      pitmanArm = add(
        new THREE.CylinderGeometry(1, 1, 1, 10),
        this.materials.brass,
        [-0.5, 0.88, 0.28],
        [0, 0, 0],
        [0.035, 0.7, 0.035],
        "fluid-source-crank-pitman-link",
      );
      pitmanArm.userData.crankCenter = [-0.57, 0.56, 0.44];
      pitmanArm.userData.crankRadius = 0.26;
      pitmanArm.userData.beamAttachment = [-0.12, 0.02, 0.12];

      add(
        new RoundedBoxGeometry(0.5, 0.36, 0.34, 3, 0.055),
        this.materials.oxidizedSteel,
        [-0.54, 0.39, -0.28],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-source-reduction-gearbox",
      );
      add(
        new THREE.CylinderGeometry(0.18, 0.18, 0.45, 16),
        this.materials.paintedSteel,
        [-0.55, 0.38, -0.53],
        [Math.PI / 2, 0, 0],
        [1, 1, 1],
        "fluid-source-drive-motor",
      );
      for (const z of [-0.7, -0.61, -0.52, -0.43, -0.34]) {
        add(
          new THREE.TorusGeometry(0.182, 0.014, 6, 14),
          this.materials.titanium,
          [-0.55, 0.38, z],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-source-motor-cooling-fin",
        );
      }
      heatLight = new THREE.PointLight(0xffa84a, 0, 1.9, 2.3);
      heatLight.name = "fluid-source-authoritative-work-light";
      heatLight.position.set(0.2, 1.15, 0.52);
      root.add(heatLight);

      addBentPipe(
        [
          [0.5, 0.42, -0.22],
          [0.5, 0.67, -0.38],
          [0.5, 0.67, -0.64],
          [0.5, 0.42, -0.82],
        ],
        0.145,
        this.materials.paintedSteel,
        "fluid-source-gooseneck-discharge-with-elbow",
      );
      add(
        new THREE.CylinderGeometry(0.22, 0.22, 0.16, 16),
        this.materials.titanium,
        [0.5, 0.42, -0.82],
        [Math.PI / 2, 0, 0],
        [1, 1, 1],
        "fluid-source-output-flange",
      );
      const sourceValve = new THREE.Group();
      sourceValve.name = "fluid-source-discharge-valve-position";
      sourceValve.position.set(0.5, 0.68, -0.53);
      sourceValve.rotation.x = Math.PI / 2;
      root.add(sourceValve);
      valveHandles.push(sourceValve);
      const sourceValveRimGeometry = new THREE.TorusGeometry(
        0.14,
        0.025,
        7,
        16,
      );
      ownedGeometries.push(sourceValveRimGeometry);
      const sourceValveRim = new THREE.Mesh(
        sourceValveRimGeometry,
        this.materials.safetyPaint,
      );
      sourceValve.add(sourceValveRim);
      for (let index = 0; index < 4; index += 1) {
        const spokeGeometry = new RoundedBoxGeometry(
          0.025,
          0.22,
          0.025,
          1,
          0.006,
        );
        ownedGeometries.push(spokeGeometry);
        const spoke = new THREE.Mesh(spokeGeometry, this.materials.brass);
        spoke.rotation.z = (index * Math.PI) / 2;
        sourceValve.add(spoke);
      }
      add(
        new RoundedBoxGeometry(0.34, 0.045, 0.22, 2, 0.015),
        this.materials.rust,
        [-0.15, 0.255, -0.61],
        [0, 0.16, 0],
        [1, 1, 1],
        "fluid-source-chipped-skid-patch",
      );

      // PASS5 source reauthor. The previous source accumulated decorative
      // processor hardware and multiple overlapping braces over several
      // passes. Retire that visual tree, then author one literal load path:
      // grounded skid -> crank/counterweight -> pitman -> walking beam and
      // horsehead -> polished rod -> wellhead -> flanged discharge.
      root.clear();
      valveHandles.length = 0;
      gaugeNeedles.length = 0;
      heatWindows.length = 0;
      sightMirrors.length = 0;
      inputSightMirrors.length = 0;
      outputSightMirrors.length = 0;
      steamPlumes.length = 0;
      rotor = undefined;
      secondaryRotor = undefined;
      actuator = undefined;
      polishedRod = undefined;
      pitmanArm = undefined;
      bridleRods.length = 0;
      bridleCarrier = undefined;
      processStageIndicators.length = 0;
      processFeedSlug = undefined;
      processProductSlug = undefined;
      reliefSpring = undefined;
      tankPressureSprings.length = 0;
      tankVentCaps.length = 0;
      sight = undefined;
      sightFrame = undefined;
      levelIndicator = undefined;
      levelNeedle = undefined;
      roofLevelDisc = undefined;
      inputSight = undefined;
      outputSight = undefined;
      pressureValve = undefined;
      shutdownGate = undefined;
      reliefCap = undefined;
      heatLight = undefined;

      for (const x of [-0.48, 0.48]) {
        add(
          new RoundedBoxGeometry(0.18, 0.14, 2.02, 3, 0.045),
          this.materials.steelDark,
          [x, 0.16, 0.03],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-source-pass5-grounded-skid-rail",
        );
      }
      for (const z of [-0.78, -0.22, 0.38, 0.86]) {
        add(
          new RoundedBoxGeometry(1.08, 0.1, 0.16, 3, 0.035),
          this.materials.weld,
          [0, 0.2, z],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-source-pass5-skid-crossmember",
        );
      }
      for (const x of [-0.38, 0.38]) {
        addBeam(
          [x, 0.25, -0.58],
          [x * 0.28, 1.18, 0],
          0.075,
          this.materials.structuralMid,
          "fluid-source-pass5-a-frame-rear-leg",
        );
        addBeam(
          [x, 0.25, 0.34],
          [x * 0.28, 1.18, 0],
          0.075,
          this.materials.structuralMid,
          "fluid-source-pass5-a-frame-front-leg",
        );
      }
      add(
        new THREE.CylinderGeometry(0.13, 0.13, 0.42, 18),
        this.materials.copper,
        [0, 1.18, 0],
        [0, 0, Math.PI / 2],
        [1, 1, 1],
        "fluid-source-pass5-walking-beam-pivot",
      );
      for (const x of [-0.26, 0.26]) {
        add(
          new THREE.TorusGeometry(0.145, 0.03, 8, 18),
          this.materials.brass,
          [x, 1.18, 0],
          [0, Math.PI / 2, 0],
          [1, 1, 1],
          "fluid-source-pass5-exposed-saddle-bearing",
        );
      }

      actuator = new THREE.Group();
      actuator.name = "fluid-source-reciprocating-beam";
      actuator.position.set(0, 1.18, 0);
      actuator.userData.mechanism =
        "crank-linked-walking-beam-and-horsehead";
      actuator.userData.motionPlane = "yz";
      root.add(actuator);
      addTo(
        actuator,
        new RoundedBoxGeometry(0.28, 0.21, 1.9, 3, 0.045),
        this.materials.paintedSteel,
        [0, 0, 0.08],
        [0, 0, 0],
        "fluid-source-pass5-walking-beam-body",
      );
      const horseheadShape = new THREE.Shape();
      horseheadShape.moveTo(0.72, 0.19);
      horseheadShape.lineTo(1.01, 0.15);
      horseheadShape.bezierCurveTo(1.27, 0.03, 1.26, -0.33, 1.03, -0.56);
      horseheadShape.lineTo(0.79, -0.48);
      horseheadShape.bezierCurveTo(0.98, -0.24, 0.96, -0.02, 0.72, 0.06);
      horseheadShape.closePath();
      const horseheadSlab = new THREE.ExtrudeGeometry(horseheadShape, {
        depth: 0.3,
        steps: 1,
        bevelEnabled: true,
        bevelSegments: 2,
        bevelSize: 0.024,
        bevelThickness: 0.024,
      });
      horseheadSlab.rotateY(-Math.PI / 2);
      horseheadSlab.translate(0.15, 0, 0);
      addTo(
        actuator,
        horseheadSlab,
        this.materials.heatOxide,
        [0, 0, 0],
        [0, 0, 0],
        "fluid-source-pass5-broad-crescent-horsehead",
      );
      addTo(
        actuator,
        new RoundedBoxGeometry(0.34, 0.06, 0.48, 3, 0.025),
        this.materials.copper,
        [-0.17, -0.28, 1.03],
        [0, 0, 0],
        "fluid-source-pass5-horsehead-face-wear-rail",
      );
      addTo(
        actuator,
        new RoundedBoxGeometry(0.38, 0.11, 0.24, 3, 0.035),
        this.materials.brass,
        [0, -0.51, 0.98],
        [0, 0, 0],
        "fluid-source-pass5-horsehead-polished-rod-clamp",
      );
      addTo(
        actuator,
        new THREE.CylinderGeometry(0.19, 0.23, 0.28, 16),
        this.materials.rust,
        [0, -0.04, -0.72],
        [0, 0, Math.PI / 2],
        "fluid-source-pass5-beam-counterweight",
      );

      polishedRod = add(
        new THREE.CylinderGeometry(1, 1, 1, 12),
        this.materials.titanium,
        [0, 0.73, 0.94],
        [0, 0, 0],
        [0.038, 0.9, 0.038],
        "fluid-source-polished-rod",
      );
      polishedRod.userData.bottomY = 0.31;
      polishedRod.userData.beamRadius = 1.06;

      add(
        new THREE.CylinderGeometry(0.24, 0.31, 0.34, 18),
        this.materials.oxidizedSteel,
        [0, 0.4, 0.94],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-source-pass5-wellhead-body",
      );
      for (const y of [0.27, 0.48, 0.59]) {
        add(
          new THREE.TorusGeometry(
            y < 0.4 ? 0.31 : 0.245,
            0.04,
            7,
            20,
          ),
          y < 0.4 ? this.materials.rust : this.materials.copper,
          [0, y, 0.94],
          [Math.PI / 2, 0, 0],
          [1, 1, 1],
          "fluid-source-pass5-wellhead-load-ring",
        );
      }
      add(
        new THREE.CylinderGeometry(0.12, 0.15, 0.18, 14),
        this.materials.weld,
        [0, 0.32, 0.94],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-source-pass5-stuffing-box",
      );

      rotor = new THREE.Group();
      rotor.name = "fluid-source-crank-flywheel";
      rotor.userData.rotationAxis = "z";
      rotor.userData.mechanism = "prime-mover-crank";
      rotor.position.set(-0.52, 0.55, -0.62);
      root.add(rotor);
      addTo(
        rotor,
        new THREE.TorusGeometry(0.38, 0.06, 8, 22),
        this.materials.copper,
        [0, 0, 0],
        [0, 0, 0],
        "fluid-source-pass5-crank-rim",
      );
      for (let index = 0; index < 6; index += 1) {
        addTo(
          rotor,
          new RoundedBoxGeometry(0.05, 0.68, 0.05, 1, 0.01),
          this.materials.weld,
          [0, 0, 0],
          [0, 0, (index * Math.PI) / 3],
          "fluid-source-pass5-crank-spoke",
        );
      }
      addTo(
        rotor,
        new THREE.CylinderGeometry(0.11, 0.11, 0.12, 14),
        this.materials.brass,
        [0, 0, 0],
        [Math.PI / 2, 0, 0],
        "fluid-source-pass5-crank-hub",
      );
      addTo(
        rotor,
        new THREE.CylinderGeometry(0.16, 0.2, 0.1, 14),
        this.materials.rust,
        [-0.16, -0.12, 0.02],
        [Math.PI / 2, 0, 0],
        "fluid-source-pass5-crank-counterweight",
      );

      pitmanArm = add(
        new THREE.CylinderGeometry(1, 1, 1, 10),
        this.materials.brass,
        [-0.28, 0.86, -0.38],
        [0, 0, 0],
        [0.035, 0.7, 0.035],
        "fluid-source-crank-pitman-link",
      );
      pitmanArm.userData.motionPlane = "yz";
      pitmanArm.userData.crankPlane = "xy";
      pitmanArm.userData.crankCenter = [-0.52, 0.55, -0.62];
      pitmanArm.userData.crankRadius = 0.33;
      pitmanArm.userData.beamAttachment = [-0.16, 0, -0.58];

      add(
        new RoundedBoxGeometry(0.48, 0.34, 0.38, 3, 0.055),
        this.materials.oxidizedSteel,
        [-0.52, 0.38, -0.3],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-source-pass5-crank-gearbox",
      );
      add(
        new THREE.CylinderGeometry(0.16, 0.16, 0.44, 16),
        this.materials.paintedSteel,
        [-0.52, 0.37, -0.58],
        [0, 0, Math.PI / 2],
        [1, 1, 1],
        "fluid-source-pass5-drive-motor",
      );

      addRoundPipe(
        [0, 0.34, 0.74],
        [0, 0.34, -0.82],
        0.07,
        this.materials.oxidizedSteel,
        "fluid-source-gooseneck-discharge-with-elbow",
      );
      add(
        new THREE.CylinderGeometry(0.22, 0.22, 0.14, 18),
        this.materials.copper,
        [0, 0.42, -0.84],
        [Math.PI / 2, 0, 0],
        [1, 1, 1],
        "fluid-source-output-flange",
      );
      const pass5SourceValve = new THREE.Group();
      pass5SourceValve.name = "fluid-source-discharge-valve-position";
      pass5SourceValve.position.set(0, 0.48, -0.4);
      pass5SourceValve.rotation.x = Math.PI / 2;
      root.add(pass5SourceValve);
      valveHandles.push(pass5SourceValve);
      addTo(
        pass5SourceValve,
        new THREE.TorusGeometry(0.13, 0.024, 7, 16),
        this.materials.safetyPaint,
        [0, 0, 0],
        [0, 0, 0],
        "fluid-source-pass5-discharge-handwheel",
      );
      for (let index = 0; index < 4; index += 1) {
        addTo(
          pass5SourceValve,
          new RoundedBoxGeometry(0.018, 0.2, 0.018, 1, 0.004),
          this.materials.brass,
          [0, 0, 0],
          [0, 0, (index * Math.PI) / 2],
          "fluid-source-pass5-discharge-handwheel-spoke",
        );
      }
      // PASS6 source reauthor. Keep one deliberately oversized, mechanically
      // legible silhouette inside the two-tile gameplay footprint. Every
      // visible member belongs to the extraction load path and the discharge
      // terminates on the same local centerline used by portAnchor().
      root.clear();
      valveHandles.length = 0;
      gaugeNeedles.length = 0;
      heatWindows.length = 0;
      sightMirrors.length = 0;
      inputSightMirrors.length = 0;
      outputSightMirrors.length = 0;
      steamPlumes.length = 0;
      rotor = undefined;
      secondaryRotor = undefined;
      actuator = undefined;
      polishedRod = undefined;
      pitmanArm = undefined;
      sight = undefined;
      sightFrame = undefined;
      levelIndicator = undefined;
      levelNeedle = undefined;
      roofLevelDisc = undefined;
      inputSight = undefined;
      outputSight = undefined;
      pressureValve = undefined;
      shutdownGate = undefined;
      reliefCap = undefined;
      heatLight = undefined;

      add(
        new RoundedBoxGeometry(1.78, 0.14, 2.34, 4, 0.07),
        this.materials.foundation,
        [0, 0.07, 0.08],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-source-pass6-integral-oil-stained-foundation",
      );
      add(
        new RoundedBoxGeometry(1.6, 0.055, 2.16, 3, 0.035),
        this.materials.oxidizedSteel,
        [0, 0.162, 0.08],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-source-pass6-drained-service-deck",
      );
      // The service plate is a real drained grating, not an unarticulated
      // black rectangle. Raised longitudinal bearing bars catch the work
      // light while leaving the oil-dark plate visible between them.
      for (const x of [
        -0.52,
        -0.39,
        -0.26,
        -0.13,
        0,
        0.13,
        0.26,
        0.39,
        0.52,
      ]) {
        add(
          new RoundedBoxGeometry(0.035, 0.025, 1.96, 2, 0.008),
          x === -0.52 || x === 0.52
            ? this.materials.copper
            : this.materials.weld,
          [x, 0.202, 0.08],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-source-pass6-drained-deck-bearing-bar",
        );
      }
      for (const z of [-0.71, -0.19, 0.34, 0.86]) {
        add(
          new RoundedBoxGeometry(1.34, 0.028, 0.045, 2, 0.009),
          this.materials.heatOxide,
          [0, 0.207, z],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-source-pass6-drained-deck-cross-tie",
        );
      }
      for (const x of [-0.61, 0.61]) {
        add(
          new RoundedBoxGeometry(0.19, 0.17, 2.05, 3, 0.045),
          this.materials.steelDark,
          [x, 0.245, 0.08],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-source-pass6-grounded-skid-rail",
        );
        for (const z of [-0.79, -0.25, 0.32, 0.88]) {
          add(
            new THREE.CylinderGeometry(0.055, 0.064, 0.085, 10),
            this.materials.brass,
            [x, 0.36, z],
            [0, 0, 0],
            [1, 1, 1],
            "fluid-source-pass6-skid-anchor-bolt",
          );
        }
      }
      for (const z of [-0.82, -0.28, 0.33, 0.91]) {
        add(
          new RoundedBoxGeometry(1.42, 0.11, 0.17, 3, 0.035),
          this.materials.weld,
          [0, 0.295, z],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-source-pass6-skid-crossmember",
        );
      }
      for (const x of [-0.52, 0.52]) {
        addBeam(
          [x, 0.33, -0.43],
          [x * 0.16, 1.78, 0.02],
          0.12,
          this.materials.oxidizedSteel,
          "fluid-source-pass6-samson-rear-leg",
        );
        addBeam(
          [x, 0.33, 0.5],
          [x * 0.16, 1.78, 0.02],
          0.12,
          this.materials.oxidizedSteel,
          "fluid-source-pass6-samson-front-leg",
        );
        addBeam(
          [x, 0.67, -0.31],
          [x, 0.67, 0.37],
          0.055,
          this.materials.rust,
          "fluid-source-pass6-samson-cross-brace",
        );
      }
      for (const x of [-0.1, 0.1]) {
        add(
          new RoundedBoxGeometry(0.21, 0.2, 0.48, 3, 0.04),
          this.materials.heatOxide,
          [x, 1.55, 0.02],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-source-pass6-samson-saddle-cheek",
        );
      }
      add(
        new THREE.CylinderGeometry(0.15, 0.15, 0.56, 20),
        this.materials.brass,
        [0, 1.8, 0.02],
        [0, 0, Math.PI / 2],
        [1, 1, 1],
        "fluid-source-pass6-walking-beam-pivot-pin",
      );
      for (const x of [-0.3, 0.3]) {
        add(
          new THREE.TorusGeometry(0.17, 0.034, 8, 20),
          this.materials.copper,
          [x, 1.8, 0.02],
          [0, Math.PI / 2, 0],
          [1, 1, 1],
          "fluid-source-pass6-exposed-saddle-bearing",
        );
      }

      actuator = new THREE.Group();
      actuator.name = "fluid-source-reciprocating-beam";
      actuator.position.set(0, 1.8, 0.02);
      actuator.userData.mechanism =
        "walking-beam-horsehead-driven-by-crank-and-pitman";
      actuator.userData.motionPlane = "yz";
      actuator.userData.nominalBeamLength = 2.65;
      actuator.userData.maximumWorkingAngleRadians = 0.36;
      root.add(actuator);
      addTo(
        actuator,
        new RoundedBoxGeometry(0.34, 0.23, 2.15, 4, 0.05),
        this.materials.steelDark,
        [0, 0, 0.495],
        [0, 0, 0],
        "fluid-source-pass6-long-pitched-walking-beam",
      );
      for (const y of [-0.145, 0.145]) {
        addTo(
          actuator,
          new RoundedBoxGeometry(0.48, 0.055, 2.05, 2, 0.015),
          this.materials.oxidizedSteel,
          [0, y, 0.515],
          [0, 0, 0],
          "fluid-source-pass6-walking-beam-i-flange",
        );
      }
      for (const [z, rotationY, material] of [
        [-0.24, -0.055, this.materials.weld],
        [0.34, 0.035, this.materials.titanium],
        [0.91, -0.04, this.materials.weld],
      ] as const) {
        addTo(
          actuator,
          new RoundedBoxGeometry(0.285, 0.016, 0.37, 2, 0.008),
          material,
          [0, 0.181, z],
          [0, rotationY, 0],
          "fluid-source-pass6-beam-top-specular-wear-panel",
        );
      }
      for (const x of [-0.244, 0.244]) {
        addTo(
          actuator,
          new RoundedBoxGeometry(0.026, 0.022, 1.72, 2, 0.008),
          this.materials.titanium,
          [x, 0.148, 0.5],
          [0, 0, 0],
          "fluid-source-pass6-beam-polished-edge-wear",
        );
      }
      for (const x of [-0.205, 0.205]) {
        addTo(
          actuator,
          new RoundedBoxGeometry(0.035, 0.095, 1.92, 2, 0.014),
          this.materials.rust,
          [x, -0.03, 0.53],
          [0, 0, 0],
          "fluid-source-pass6-chipped-beam-edge",
        );
      }
      for (const z of [-0.42, -0.15, 0.2, 0.55, 0.9]) {
        addTo(
          actuator,
          new THREE.CylinderGeometry(0.037, 0.037, 0.46, 10),
          this.materials.brass,
          [0, 0.015, z],
          [0, 0, Math.PI / 2],
          "fluid-source-pass6-beam-through-fastener",
        );
      }
      const pass6HorseheadShape = new THREE.Shape();
      pass6HorseheadShape.moveTo(0.76, 0.18);
      pass6HorseheadShape.lineTo(1.35, 0.14);
      pass6HorseheadShape.bezierCurveTo(
        1.72,
        0.05,
        1.78,
        -0.48,
        1.42,
        -0.88,
      );
      pass6HorseheadShape.lineTo(1.03, -0.88);
      pass6HorseheadShape.bezierCurveTo(
        1.24,
        -0.58,
        1.27,
        -0.19,
        0.76,
        -0.04,
      );
      pass6HorseheadShape.closePath();
      const pass6HorseheadRelief = new THREE.Path();
      pass6HorseheadRelief.moveTo(1.08, 0);
      pass6HorseheadRelief.bezierCurveTo(
        1.44,
        -0.07,
        1.5,
        -0.46,
        1.2,
        -0.69,
      );
      pass6HorseheadRelief.lineTo(1.35, -0.72);
      pass6HorseheadRelief.bezierCurveTo(
        1.62,
        -0.45,
        1.6,
        -0.02,
        1.1,
        0.07,
      );
      pass6HorseheadRelief.closePath();
      pass6HorseheadShape.holes.push(pass6HorseheadRelief);
      const pass6Horsehead = new THREE.ExtrudeGeometry(
        pass6HorseheadShape,
        {
          depth: 0.4,
          steps: 1,
          bevelEnabled: true,
          bevelSegments: 3,
          bevelSize: 0.035,
          bevelThickness: 0.035,
        },
      );
      pass6Horsehead.rotateY(-Math.PI / 2);
      pass6Horsehead.translate(0.2, 0, 0);
      addTo(
        actuator,
        pass6Horsehead,
        this.materials.heatOxide,
        [0, 0, 0],
        [0, 0, 0],
        "fluid-source-pass6-broad-curved-horsehead",
      );
      for (const [x, y, z, tilt, material] of [
        [-0.236, -0.31, 1.34, 0.18, this.materials.weld],
        [0.236, -0.38, 1.38, -0.12, this.materials.steelDark],
      ] as const) {
        addTo(
          actuator,
          new RoundedBoxGeometry(0.032, 0.31, 0.7, 2, 0.018),
          material,
          [x, y, z],
          [tilt, 0, 0],
          "fluid-source-pass6-horsehead-field-wear-cheek",
        );
        for (const localY of [-0.055, 0.055]) {
          addTo(
            actuator,
            new THREE.SphereGeometry(0.026, 8, 5),
            this.materials.brass,
            [x < 0 ? x - 0.018 : x + 0.018, y + localY, z],
            [0, 0, 0],
            "fluid-source-pass6-horsehead-wear-rivet",
          );
        }
      }
      addTo(
        actuator,
        new RoundedBoxGeometry(0.43, 0.075, 0.76, 3, 0.026),
        this.materials.copper,
        [0, -0.48, 1.48],
        [0, 0, 0],
        "fluid-source-pass6-horsehead-polished-wear-face",
      );
      addTo(
        actuator,
        new RoundedBoxGeometry(0.48, 0.13, 0.28, 3, 0.035),
        this.materials.brass,
        [0, -0.84, 1.55],
        [0, 0, 0],
        "fluid-source-pass6-horsehead-rod-clamp",
      );
      for (const x of [-0.46, 0.46]) {
        addTo(
          actuator,
          new THREE.CylinderGeometry(0.052, 0.052, 0.26, 12),
          this.materials.brass,
          [x, 0.05, 1.68],
          [0, 0, Math.PI / 2],
          "fluid-source-pass6-horsehead-nose-pin",
        );
        addTo(
          actuator,
          new THREE.TorusGeometry(0.064, 0.018, 7, 14),
          this.materials.copper,
          [x < 0 ? x - 0.135 : x + 0.135, 0.05, 1.68],
          [0, Math.PI / 2, 0],
          "fluid-source-pass6-horsehead-nose-pin-head",
        );
      }
      const initialBridleCarrier = new THREE.Vector3(0, 1.16, 1.59);
      bridleCarrier = add(
        new RoundedBoxGeometry(0.96, 0.12, 0.2, 3, 0.03),
        this.materials.brass,
        [
          initialBridleCarrier.x,
          initialBridleCarrier.y,
          initialBridleCarrier.z,
        ],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-source-pass6-bridle-polished-rod-carrier",
      );
      addTo(
        bridleCarrier,
        new THREE.CylinderGeometry(0.075, 0.075, 0.16, 12),
        this.materials.titanium,
        [0, -0.075, 0],
        [0, 0, 0],
        "fluid-source-pass6-carrier-polished-rod-coupling",
      );
      for (const [noseX, carrierX] of [
        [-0.46, -0.32],
        [0.46, 0.32],
      ] as const) {
        const bridle = add(
          new THREE.CylinderGeometry(1, 1, 1, 10),
          this.materials.titanium,
          [0, 0, 0],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-source-pass6-exposed-horsehead-bridle",
        );
        bridle.userData.noseLocal = [noseX, 0.05, 1.68];
        bridle.userData.carrierLateralOffset = carrierX;
        bridle.userData.contactTolerance = 0.001;
        beamMatrix(
          bridle,
          new THREE.Vector3(noseX, 1.85, 1.7),
          initialBridleCarrier.clone().add(new THREE.Vector3(carrierX, 0, 0)),
          0.043,
        );
        bridleRods.push(bridle);
      }
      for (const x of [-0.34, 0.34]) {
        add(
          new THREE.TorusGeometry(0.145, 0.022, 7, 18),
          this.materials.soot,
          [x, 1.8, 0.02],
          [0, Math.PI / 2, 0],
          [1, 1, 1],
          "fluid-source-pass6-pivot-grease-collar",
        );
      }
      for (const [x, z, rotationZ] of [
        [-0.185, 0.19, -0.08],
        [0.185, 0.66, 0.06],
      ] as const) {
        addTo(
          actuator,
          new RoundedBoxGeometry(0.028, 0.13, 0.42, 2, 0.014),
          this.materials.rust,
          [x, -0.025, z],
          [0, 0, rotationZ],
          "fluid-source-pass6-beam-worn-side-repair",
        );
        for (const localZ of [z - 0.14, z + 0.14]) {
          addTo(
            actuator,
            new THREE.SphereGeometry(0.028, 8, 5),
            this.materials.brass,
            [x * 1.08, -0.025, localZ],
            [0, 0, 0],
            "fluid-source-pass6-beam-repair-rivet",
          );
        }
      }
      addTo(
        actuator,
        new THREE.CylinderGeometry(0.13, 0.17, 0.34, 18),
        this.materials.oxidizedSteel,
        [0, -0.03, -0.43],
        [0, 0, Math.PI / 2],
        "fluid-source-pass6-rear-beam-counterweight",
      );

      polishedRod = add(
        new THREE.CylinderGeometry(1, 1, 1, 14),
        this.materials.titanium,
        [0, 0.78, 1.57],
        [0, 0, 0],
        [0.046, 1.08, 0.046],
        "fluid-source-polished-rod",
      );
      polishedRod.userData.bottomY = 0.34;
      polishedRod.userData.beamRadius = 1.57;
      polishedRod.userData.lateralOffset = 0;
      polishedRod.userData.carrierLocalY = -0.64;
      polishedRod.userData.nominalStrokeMeters = 1.05;
      add(
        new THREE.CylinderGeometry(0.31, 0.4, 0.42, 22),
        this.materials.oxidizedSteel,
        [0, 0.44, 1.57],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-source-pass6-wellhead-body",
      );
      for (const [y, radius, height, material] of [
        [0.255, 0.42, 0.09, this.materials.rust],
        [0.47, 0.34, 0.075, this.materials.copper],
        [0.625, 0.245, 0.065, this.materials.brass],
      ] as const) {
        add(
          new THREE.CylinderGeometry(radius, radius, height, 22),
          material,
          [0, y, 1.57],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-source-pass6-wellhead-solid-bolted-flange-course",
        );
        for (let bolt = 0; bolt < 8; bolt += 1) {
          const angle = (bolt * Math.PI * 2) / 8;
          add(
            new THREE.CylinderGeometry(0.025, 0.028, 0.045, 8),
            this.materials.steelDark,
            [
              Math.cos(angle) * radius * 0.77,
              y + height * 0.67,
              1.57 + Math.sin(angle) * radius * 0.77,
            ],
            [0, 0, 0],
            [1, 1, 1],
            "fluid-source-pass6-wellhead-flange-bolt",
          );
        }
      }
      add(
        new THREE.CylinderGeometry(0.14, 0.18, 0.22, 16),
        this.materials.weld,
        [0, 0.55, 1.57],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-source-pass6-stuffing-box",
      );

      rotor = new THREE.Group();
      rotor.name = "fluid-source-crank-flywheel";
      rotor.userData.rotationAxis = "x";
      rotor.userData.mechanism = "motor-driven-crank-and-counterweight";
      rotor.position.set(0.63, 0.72, -0.92);
      root.add(rotor);
      addTo(
        rotor,
        new THREE.TorusGeometry(0.43, 0.052, 9, 30),
        this.materials.heatOxide,
        [0, 0, 0],
        [0, Math.PI / 2, 0],
        "fluid-source-pass6-large-single-crank-rim",
      );
      for (let index = 0; index < 6; index += 1) {
        addTo(
          rotor,
          new RoundedBoxGeometry(0.105, 0.05, 0.7, 2, 0.012),
          this.materials.weld,
          [0, 0, 0],
          [index * Math.PI / 3, 0, 0],
          "fluid-source-pass6-crank-spoke",
        );
      }
      addTo(
        rotor,
        new THREE.CylinderGeometry(0.13, 0.13, 0.28, 16),
        this.materials.brass,
        [0, 0, 0],
        [0, 0, Math.PI / 2],
        "fluid-source-pass6-crank-hub",
      );
      addTo(
        rotor,
        new RoundedBoxGeometry(0.29, 0.36, 0.19, 3, 0.065),
        this.materials.rust,
        [0, -0.25, -0.18],
        [-0.42, 0, 0],
        "fluid-source-pass6-large-rotating-counterweight",
      );
      addTo(
        rotor,
        new THREE.CylinderGeometry(0.075, 0.075, 0.31, 12),
        this.materials.brass,
        [0, 0, 0.39],
        [0, 0, Math.PI / 2],
        "fluid-source-pass6-eccentric-crank-pin",
      );

      pitmanArm = add(
        new THREE.CylinderGeometry(1, 1, 1, 12),
        this.materials.brass,
        [0.63, 1.1, -0.82],
        [0, 0, 0],
        [0.055, 0.92, 0.055],
        "fluid-source-crank-pitman-link",
      );
      pitmanArm.userData.motionPlane = "yz";
      pitmanArm.userData.crankPlane = "yz";
      pitmanArm.userData.crankCenter = [0.63, 0.72, -0.92];
      pitmanArm.userData.crankRadius = 0.39;
      pitmanArm.userData.beamAttachment = [0.16, 0, -0.46];
      pitmanArm.userData.minimumPinContactTolerance = 0.001;

      add(
        new RoundedBoxGeometry(0.58, 0.43, 0.52, 4, 0.065),
        this.materials.oxidizedSteel,
        [0.5, 0.48, -0.72],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-source-pass6-reduction-gearbox",
      );
      add(
        new THREE.CylinderGeometry(0.22, 0.22, 0.66, 20),
        this.materials.paintedSteel,
        [0.54, 0.45, -0.28],
        [Math.PI / 2, 0, 0],
        [1, 1, 1],
        "fluid-source-pass6-electric-drive-motor",
      );
      for (const z of [-0.55, -0.43, -0.31, -0.19, -0.07]) {
        add(
          new THREE.TorusGeometry(0.225, 0.018, 7, 18),
          this.materials.titanium,
          [0.54, 0.45, z],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-source-pass6-motor-cooling-fin",
        );
      }

      const dischargeSegments = [
        [
          new THREE.Vector3(-0.24, 0.34, 1.57),
          new THREE.Vector3(-0.72, 0.34, 1.57),
        ],
        [
          new THREE.Vector3(-0.72, 0.34, 1.57),
          new THREE.Vector3(-0.72, 0.29, -1.02),
        ],
        [
          new THREE.Vector3(-0.72, 0.29, -1.02),
          new THREE.Vector3(-0.28, 0.29, -1.02),
        ],
        [
          new THREE.Vector3(-0.28, 0.29, -1.02),
          new THREE.Vector3(-0.28, 0.42, -1.02),
        ],
        [
          new THREE.Vector3(-0.28, 0.42, -1.02),
          new THREE.Vector3(-0.28, 0.42, -0.82),
        ],
        [
          new THREE.Vector3(-0.28, 0.42, -0.82),
          new THREE.Vector3(0, 0.42, -0.82),
        ],
      ] as const;
      for (const [start, end] of dischargeSegments) {
        addRoundPipe(
          [start.x, start.y, start.z],
          [end.x, end.y, end.z],
          0.072,
          this.materials.oxidizedSteel,
          "fluid-source-gooseneck-discharge-with-elbow",
          16,
        );
      }
      for (const center of [
        new THREE.Vector3(-0.72, 0.34, 1.57),
        new THREE.Vector3(-0.72, 0.29, -1.02),
        new THREE.Vector3(-0.28, 0.29, -1.02),
        new THREE.Vector3(-0.28, 0.42, -1.02),
        new THREE.Vector3(-0.28, 0.42, -0.82),
      ]) {
        add(
          new THREE.SphereGeometry(0.105, 16, 10),
          this.materials.nozzleSteel,
          [center.x, center.y, center.z],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-source-pass6-owned-discharge-elbow",
        );
      }
      for (const [x, z] of [
        [-0.72, 1.02],
        [-0.72, 0.2],
        [-0.72, -0.62],
      ] as const) {
        add(
          new RoundedBoxGeometry(0.26, 0.09, 0.24, 2, 0.025),
          this.materials.steelDark,
          [x, 0.215, z],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-source-pass6-discharge-support-shoe",
        );
        add(
          new THREE.TorusGeometry(0.09, 0.022, 7, 16, Math.PI),
          this.materials.rubber,
          [x, 0.285, z],
          [0, 0, Math.PI],
          [1, 1, 1],
          "fluid-source-pass6-discharge-support-saddle",
        );
      }
      add(
        new THREE.CylinderGeometry(0.19, 0.19, 0.12, 20),
        this.materials.copper,
        [0, 0.42, -0.82],
        [Math.PI / 2, 0, 0],
        [1, 1, 1],
        "fluid-source-output-flange",
      );
      const pass6SourceValve = new THREE.Group();
      pass6SourceValve.name = "fluid-source-discharge-valve-position";
      pass6SourceValve.position.set(-0.72, 0.54, -0.48);
      pass6SourceValve.rotation.x = Math.PI / 2;
      root.add(pass6SourceValve);
      valveHandles.push(pass6SourceValve);
      addTo(
        pass6SourceValve,
        new THREE.TorusGeometry(0.15, 0.025, 8, 18),
        this.materials.heatOxide,
        [0, 0, 0],
        [0, 0, 0],
        "fluid-source-pass6-discharge-handwheel",
      );
      for (let index = 0; index < 4; index += 1) {
        addTo(
          pass6SourceValve,
          new RoundedBoxGeometry(0.021, 0.24, 0.021, 1, 0.005),
          this.materials.brass,
          [0, 0, 0],
          [0, 0, (index * Math.PI) / 2],
          "fluid-source-pass6-discharge-handwheel-spoke",
        );
      }
      root.userData.physicalLoadPath =
        "anchored-skid>motor>gearbox>single-flywheel>counterweight>crank-pin>pitman>walking-beam>horsehead-nose-pins>tensioned-bridles>equalizer-carrier>polished-rod>stuffing-box>wellhead";
      root.userData.physicalFluidPath =
        "wellhead>owned-low-side-nozzle>supported-stationary-manifold>elbow>riser>isolation-valve>bolted-boundary-flange";
      root.userData.localOutputPort = [0, 0.42, -0.82];
      root.userData.portCenterlineTolerance = 0.001;
      root.userData.dischargeMovingEnvelopeClearance = 0.28;
      root.userData.presentation =
        "pass6-unmistakable-full-stroke-walking-beam-pumpjack";
    } else if (kind === "fluidPump") {
      for (const x of [-0.28, 0.28]) {
        add(
          new RoundedBoxGeometry(0.18, 0.12, 0.74, 2, 0.025),
          this.materials.oxidizedSteel,
          [x, 0.24, 0],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-pump-load-foot",
        );
      }
      add(
        new THREE.CylinderGeometry(0.35, 0.39, 0.32, 22),
        this.materials.paintedSteel,
        [-0.14, 0.47, -0.03],
        [Math.PI / 2, 0, 0],
        [1, 1, 1],
        "fluid-pump-volute",
      );
      add(
        new THREE.TorusGeometry(0.345, 0.052, 8, 22),
        this.materials.weld,
        [-0.14, 0.47, 0.145],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-pump-volute-service-ring",
      );
      for (let index = 0; index < 10; index += 1) {
        const angle = (index * Math.PI * 2) / 10;
        add(
          new THREE.CylinderGeometry(0.025, 0.025, 0.075, 8),
          index % 3 === 0 ? this.materials.rust : this.materials.brass,
          [
            -0.14 + Math.cos(angle) * 0.345,
            0.47 + Math.sin(angle) * 0.345,
            0.19,
          ],
          [Math.PI / 2, 0, 0],
          [1, 1, 1],
          "fluid-pump-volute-cover-bolt",
        );
      }
      rotor = new THREE.Group();
      rotor.name = "fluid-pump-visible-impeller";
      rotor.userData.rotationAxis = "z";
      rotor.userData.mechanism = "buffer-driven-impeller";
      rotor.position.set(-0.14, 0.47, 0.205);
      root.add(rotor);
      for (let index = 0; index < 7; index += 1) {
        const angle = (index * Math.PI * 2) / 7;
        const bladeGeometry = new RoundedBoxGeometry(
          0.065,
          0.3,
          0.045,
          2,
          0.015,
        );
        ownedGeometries.push(bladeGeometry);
        const blade = new THREE.Mesh(bladeGeometry, this.materials.brass);
        blade.position.set(
          Math.cos(angle) * 0.14,
          Math.sin(angle) * 0.14,
          0,
        );
        blade.rotation.z = angle + 0.56;
        blade.castShadow = true;
        rotor.add(blade);
      }
      const hubGeometry = new THREE.CylinderGeometry(0.09, 0.09, 0.08, 14);
      ownedGeometries.push(hubGeometry);
      const hub = new THREE.Mesh(hubGeometry, this.materials.titanium);
      hub.rotation.x = Math.PI / 2;
      hub.castShadow = true;
      rotor.add(hub);
      add(
        new THREE.CylinderGeometry(0.29, 0.29, 0.035, 20),
        this.materials.glass,
        [-0.14, 0.47, 0.252],
        [Math.PI / 2, 0, 0],
        [1, 1, 1],
        "fluid-pump-impeller-inspection-glass",
      );

      add(
        new THREE.CylinderGeometry(0.2, 0.2, 0.48, 18),
        this.materials.oxidizedSteel,
        [0.21, 0.42, -0.1],
        [0, 0, Math.PI / 2],
        [1, 1, 1],
        "fluid-pump-electric-motor",
      );
      for (const x of [0.03, 0.11, 0.19, 0.27, 0.35, 0.43]) {
        add(
          new THREE.TorusGeometry(0.205, 0.017, 6, 16),
          this.materials.titanium,
          [x, 0.42, -0.1],
          [0, Math.PI / 2, 0],
          [1, 1, 1],
          "fluid-pump-motor-cooling-fin",
        );
      }
      addRoundPipe(
        [-0.06, 0.47, -0.01],
        [0.47, 0.47, -0.01],
        0.065,
        this.materials.brass,
        "fluid-pump-visible-drive-shaft",
        12,
      );
      secondaryRotor = new THREE.Group();
      secondaryRotor.name = "fluid-pump-motor-cooling-fan";
      secondaryRotor.userData.rotationAxis = "x";
      secondaryRotor.position.set(0.48, 0.42, -0.1);
      secondaryRotor.rotation.y = Math.PI / 2;
      root.add(secondaryRotor);
      for (let index = 0; index < 5; index += 1) {
        const angle = (index * Math.PI * 2) / 5;
        const fanGeometry = new RoundedBoxGeometry(
          0.04,
          0.22,
          0.035,
          1,
          0.008,
        );
        ownedGeometries.push(fanGeometry);
        const fan = new THREE.Mesh(fanGeometry, this.materials.safetyPaint);
        fan.rotation.z = angle;
        secondaryRotor.add(fan);
      }

      addRoundPipe(
        [-0.14, 0.38, 0.45],
        [-0.14, 0.38, 0.12],
        0.15,
        this.materials.steel,
        "fluid-pump-suction-neck",
        16,
      );
      addRoundPipe(
        [-0.14, 0.38, -0.17],
        [-0.14, 0.38, -0.45],
        0.15,
        this.materials.steel,
        "fluid-pump-discharge-neck",
        16,
      );
      for (const z of [-0.44, 0.44]) {
        add(
          new THREE.CylinderGeometry(0.23, 0.23, 0.12, 16),
          this.materials.titanium,
          [-0.14, 0.38, z],
          [Math.PI / 2, 0, 0],
          [1, 1, 1],
          "fluid-pump-flange",
        );
      }
      addRoundPipe(
        [-0.2, 0.67, -0.03],
        [-0.2, 0.82, -0.03],
        0.055,
        this.materials.brass,
        "fluid-pump-pressure-gauge-riser",
      );
      add(
        new THREE.CylinderGeometry(0.14, 0.14, 0.055, 18),
        this.materials.gaugeFace,
        [-0.2, 0.84, -0.03],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-pump-pressure-gauge-face",
      );
      const pumpNeedle = new THREE.Group();
      pumpNeedle.name = "fluid-pump-pressure-gauge-needle";
      pumpNeedle.position.set(-0.2, 0.872, -0.03);
      pumpNeedle.userData.rotationAxis = "y";
      root.add(pumpNeedle);
      gaugeNeedles.push(pumpNeedle);
      const pumpNeedleGeometry = new RoundedBoxGeometry(
        0.025,
        0.025,
        0.1,
        1,
        0.006,
      );
      ownedGeometries.push(pumpNeedleGeometry);
      const pumpNeedleMesh = new THREE.Mesh(
        pumpNeedleGeometry,
        this.materials.warning,
      );
      pumpNeedleMesh.position.z = -0.045;
      pumpNeedle.add(pumpNeedleMesh);
      for (const z of [-0.3, 0.3]) {
        const valve = new THREE.Group();
        valve.name =
          z < 0
            ? "fluid-pump-discharge-valve-position"
            : "fluid-pump-suction-valve-position";
        valve.position.set(0.14, 0.67, z);
        valve.rotation.x = Math.PI / 2;
        root.add(valve);
        valveHandles.push(valve);
        const valveGeometry = new THREE.TorusGeometry(
          0.12,
          0.023,
          7,
          16,
        );
        ownedGeometries.push(valveGeometry);
        const valveRim = new THREE.Mesh(
          valveGeometry,
          z < 0 ? this.materials.safetyPaint : this.materials.brass,
        );
        valve.add(valveRim);
        for (let index = 0; index < 4; index += 1) {
          const spokeGeometry = new RoundedBoxGeometry(
            0.02,
            0.19,
            0.02,
            1,
            0.005,
          );
          ownedGeometries.push(spokeGeometry);
          const spoke = new THREE.Mesh(spokeGeometry, this.materials.weld);
          spoke.rotation.z = (index * Math.PI) / 2;
          valve.add(spoke);
        }
      }
      add(
        new THREE.TorusGeometry(0.355, 0.021, 6, 20),
        this.materials.rust,
        [-0.14, 0.47, -0.215],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-pump-volute-heat-corrosion-line",
      );
      add(
        new RoundedBoxGeometry(0.24, 0.03, 0.15, 2, 0.01),
        this.materials.rust,
        [0.21, 0.225, 0.22],
        [0, 0.17, 0],
        [1, 1, 1],
        "fluid-pump-chipped-motor-foot",
      );
      add(
        new THREE.TorusGeometry(0.1, 0.02, 6, 14),
        this.materials.safetyPaint,
        [-0.2, 0.84, -0.03],
        [Math.PI / 2, 0, 0],
        [1, 1, 1],
        "fluid-pump-gauge-protective-bezel",
      );
    } else if (kind === "fluidTank") {
      add(
        new THREE.CylinderGeometry(0.92, 0.96, 1.42, 28),
        this.materials.oxidizedSteel,
        [0, 0.9, 0],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-tank-shell",
      );
      for (const [y, height, material, name] of [
        [
          0.46,
          0.34,
          this.materials.rust,
          "fluid-tank-corroded-bottom-course",
        ],
        [
          0.82,
          0.34,
          this.materials.paintedSteel,
          "fluid-tank-chipped-middle-course",
        ],
        [
          1.18,
          0.34,
          this.materials.enamel,
          "fluid-tank-weathered-upper-course",
        ],
      ] as const) {
        add(
          new THREE.CylinderGeometry(0.925, 0.945, height, 28, 1, true),
          material,
          [0, y, 0],
          [0, 0, 0],
          [1, 1, 1],
          name,
        );
      }
      add(
        new THREE.SphereGeometry(
          0.92,
          28,
          12,
          0,
          Math.PI * 2,
          0,
          Math.PI / 2,
        ),
        this.materials.paintedSteel,
        [0, 1.58, 0],
        [0, 0, 0],
        [1, 0.32, 1],
        "fluid-tank-domed-roof",
      );
      for (const y of [0.3, 0.76, 1.2, 1.58]) {
        add(
          new THREE.TorusGeometry(
            y > 1.5 ? 0.88 : 0.94,
            0.045,
            8,
            28,
          ),
          y < 0.5 ? this.materials.rust : this.materials.weld,
          [0, y, 0],
          [Math.PI / 2, 0, 0],
          [1, 1, 1],
          "fluid-tank-load-band",
        );
      }
      for (let index = 0; index < 8; index += 1) {
        const angle = (index * Math.PI * 2) / 8;
        add(
          new RoundedBoxGeometry(0.055, 1.3, 0.08, 2, 0.012),
          index % 3 === 0
            ? this.materials.rust
            : this.materials.oxidizedSteel,
          [
            Math.sin(angle) * 0.94,
            0.87,
            Math.cos(angle) * 0.94,
          ],
          [0, angle, 0],
          [1, 1, 1],
          "fluid-tank-vertical-shell-stiffener",
        );
      }
      for (const [angle, y, width, height, material] of [
        [-0.7, 0.72, 0.42, 0.27, this.materials.rust],
        [0.18, 1.13, 0.34, 0.22, this.materials.steel],
        [1.42, 0.88, 0.38, 0.3, this.materials.oxidizedSteel],
        [2.55, 0.55, 0.3, 0.2, this.materials.rust],
      ] as const) {
        const radius = 0.966;
        add(
          new RoundedBoxGeometry(width, height, 0.045, 2, 0.016),
          material,
          [Math.sin(angle) * radius, y, Math.cos(angle) * radius],
          [0, angle, 0],
          [1, 1, 1],
          "fluid-tank-field-repair-patch",
        );
        for (const [dx, dy] of [
          [-width * 0.38, -height * 0.34],
          [width * 0.38, -height * 0.34],
          [-width * 0.38, height * 0.34],
          [width * 0.38, height * 0.34],
        ] as const) {
          const localX = Math.sin(angle) * radius + Math.cos(angle) * dx;
          const localZ = Math.cos(angle) * radius - Math.sin(angle) * dx;
          add(
            new THREE.SphereGeometry(0.026, 8, 5),
            this.materials.brass,
            [localX, y + dy, localZ],
            [0, 0, 0],
            [1, 1, 0.7],
            "fluid-tank-patch-rivet",
          );
        }
      }
      for (const y of [0.76, 1.2]) {
        for (let index = 0; index < 8; index += 1) {
          const angle = (index * Math.PI * 2) / 8;
          add(
            new THREE.SphereGeometry(0.024, 7, 5),
            index % 5 === 0 ? this.materials.rust : this.materials.brass,
            [Math.sin(angle) * 0.955, y, Math.cos(angle) * 0.955],
            [0, 0, 0],
            [1, 0.8, 1],
            "fluid-tank-course-rivet",
          );
        }
      }
      sightFrame = add(
        new RoundedBoxGeometry(0.46, 1.5, 0.15, 3, 0.035),
        this.materials.glass,
        [-0.5, 1.02, 1.01],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-tank-sight-glass",
      );
      sight = add(
        new RoundedBoxGeometry(0.32, 1.34, 0.06, 2, 0.018),
        this.materials.crude,
        [-0.5, 0.38, 1.085],
        [0, 0, 0],
        [1, 0.001, 1],
        "fluid-tank-visible-level",
      );
      sight.userData.baseY = 0.36;
      sight.userData.fullHeight = 1.32;
      for (const mirror of [
        {
          position: [-0.5, 0.38, -1.075] as const,
          rotation: [0, Math.PI, 0] as const,
        },
        {
          position: [1.075, 0.38, -0.5] as const,
          rotation: [0, Math.PI / 2, 0] as const,
        },
        {
          position: [-1.075, 0.38, -0.5] as const,
          rotation: [0, -Math.PI / 2, 0] as const,
        },
      ]) {
        add(
          new RoundedBoxGeometry(0.46, 1.5, 0.15, 3, 0.035),
          this.materials.glass,
          [mirror.position[0], 1.02, mirror.position[2]],
          mirror.rotation,
          [1, 1, 1],
          "fluid-tank-sight-glass-mirrored",
        );
        const mirroredLevel = add(
            new RoundedBoxGeometry(0.32, 1.34, 0.06, 2, 0.018),
            this.materials.crude,
            mirror.position,
            mirror.rotation,
            [1, 0.001, 1],
            "fluid-tank-visible-level-mirrored",
          );
        mirroredLevel.userData.baseY = 0.36;
        mirroredLevel.userData.fullHeight = 1.32;
        sightMirrors.push(mirroredLevel);
      }
      for (const y of [0.36, 1.68]) {
        addRoundPipe(
          [-0.5, y, 0.94],
          [-0.5, y, 1.13],
          0.045,
          this.materials.brass,
          "fluid-tank-sight-glass-isolation-line",
          10,
        );
        const valve = new THREE.Group();
        valve.name = "fluid-tank-sight-glass-isolation-valve";
        valve.position.set(-0.27, y, 1.12);
        root.add(valve);
        valveHandles.push(valve);
        const rimGeometry = new THREE.TorusGeometry(0.08, 0.016, 6, 14);
        ownedGeometries.push(rimGeometry);
        const rim = new THREE.Mesh(rimGeometry, this.materials.safetyPaint);
        valve.add(rim);
        for (let index = 0; index < 4; index += 1) {
          const spokeGeometry = new RoundedBoxGeometry(
            0.014,
            0.12,
            0.014,
            1,
            0.004,
          );
          ownedGeometries.push(spokeGeometry);
          const spoke = new THREE.Mesh(spokeGeometry, this.materials.weld);
          spoke.rotation.z = (index * Math.PI) / 2;
          valve.add(spoke);
        }
      }
      for (const x of [-0.72, -0.28]) {
        add(
          new RoundedBoxGeometry(0.04, 1.44, 0.04, 1, 0.008),
          this.materials.brass,
          [x, 1.02, 1.105],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-tank-sight-glass-protective-rail",
        );
      }
      for (const x of [0.44, 0.78]) {
        add(
          new THREE.BoxGeometry(0.045, 1.25, 0.045),
          this.materials.titanium,
          [x, 0.86, 1.02],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-tank-access-ladder-rail",
        );
      }
      for (let rung = 0; rung < 7; rung += 1) {
        add(
          new THREE.BoxGeometry(0.38, 0.035, 0.045),
          this.materials.brass,
          [0.61, 0.32 + rung * 0.19, 1.04],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-tank-access-ladder-rung",
        );
      }
      add(
        new RoundedBoxGeometry(0.34, 0.24, 0.065, 2, 0.025),
        this.materials.ceramic,
        [0.08, 1.14, 1.025],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-tank-contents-nameplate",
      );
      add(
        new RoundedBoxGeometry(0.22, 0.045, 0.074, 2, 0.012),
        this.materials.safetyPaint,
        [0.08, 1.15, 1.065],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-tank-contents-nameplate-stripe",
      );
      for (const [x, z, rotation] of [
        [0, -1.04, [Math.PI / 2, 0, 0]],
        [0, 1.04, [Math.PI / 2, 0, 0]],
        [-1.04, 0, [0, 0, Math.PI / 2]],
        [1.04, 0, [0, 0, Math.PI / 2]],
      ] as const) {
        add(
          new THREE.CylinderGeometry(0.21, 0.21, 0.24, 16),
          this.materials.titanium,
          [x, 0.4, z],
          rotation,
          [1, 1, 1],
          "fluid-tank-process-flange",
        );
      }
      add(
        new THREE.CylinderGeometry(0.25, 0.25, 0.16, 16),
        this.materials.ceramic,
        [0, 1.76, 0],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-tank-service-hatch",
      );
      for (let index = 0; index < 10; index += 1) {
        const angle = (index * Math.PI * 2) / 10;
        add(
          new THREE.CylinderGeometry(0.027, 0.027, 0.06, 8),
          index % 4 === 0 ? this.materials.rust : this.materials.brass,
          [Math.sin(angle) * 0.22, 1.86, Math.cos(angle) * 0.22],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-tank-manway-bolt",
        );
      }
      add(
        new THREE.TorusGeometry(0.62, 0.025, 6, 24),
        this.materials.titanium,
        [0, 1.88, 0],
        [Math.PI / 2, 0, 0],
        [1, 1, 1],
        "fluid-tank-roof-guardrail",
      );
      for (let index = 0; index < 6; index += 1) {
        const angle = (index * Math.PI * 2) / 6;
        addBeam(
          [
            Math.sin(angle) * 0.62,
            1.64,
            Math.cos(angle) * 0.62,
          ],
          [
            Math.sin(angle) * 0.62,
            1.88,
            Math.cos(angle) * 0.62,
          ],
          0.025,
          this.materials.titanium,
          "fluid-tank-roof-guardrail-stanchion",
        );
      }
      add(
        new THREE.CylinderGeometry(0.08, 0.1, 0.36, 12),
        this.materials.brass,
        [-0.38, 1.91, 0],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-tank-relief-vent",
      );
      add(
        new THREE.SphereGeometry(0.11, 12, 8),
        this.materials.safetyPaint,
        [-0.38, 2.1, 0],
        [0, 0, 0],
        [1, 0.68, 1],
        "fluid-tank-relief-cap",
      );
      for (let variant = 0; variant < 4; variant += 1) {
        const angle = variant * (Math.PI / 2) + 0.34;
        const servicePod = new THREE.Group();
        servicePod.name = "fluid-tank-finish-variant-hardware";
        servicePod.userData.finishVariantIndex = variant;
        servicePod.position.set(
          Math.sin(angle) * 0.58,
          1.76,
          Math.cos(angle) * 0.58,
        );
        servicePod.rotation.y = angle;
        root.add(servicePod);
        const podGeometry =
          variant % 2 === 0
            ? new THREE.CylinderGeometry(
                variant === 0 ? 0.13 : 0.1,
                0.15,
                variant === 0 ? 0.34 : 0.46,
                14,
              )
            : new RoundedBoxGeometry(
                variant === 1 ? 0.32 : 0.22,
                variant === 1 ? 0.24 : 0.42,
                0.22,
                2,
                0.04,
              );
        ownedGeometries.push(podGeometry);
        const pod = new THREE.Mesh(
          podGeometry,
          variant === 0
            ? this.materials.brass
            : variant === 1
              ? this.materials.oxidizedSteel
              : variant === 2
                ? this.materials.rust
                : this.materials.paintedSteel,
        );
        pod.name =
          variant === 0
            ? "fluid-tank-roof-breather-pot"
            : variant === 1
              ? "fluid-tank-roof-instrument-cabinet"
              : variant === 2
                ? "fluid-tank-roof-sampling-column"
                : "fluid-tank-roof-level-transmitter";
        pod.castShadow = true;
        servicePod.add(pod);
        const neckGeometry = new THREE.CylinderGeometry(
          0.038,
          0.045,
          0.36,
          9,
        );
        ownedGeometries.push(neckGeometry);
        const neck = new THREE.Mesh(neckGeometry, this.materials.weld);
        neck.position.set(0, 0.2, -0.14);
        neck.rotation.x = variant % 2 === 0 ? 0 : Math.PI / 2;
        servicePod.add(neck);
      }
      for (let variant = 0; variant < 4; variant += 1) {
        const family = new THREE.Group();
        family.name =
          variant === 0
            ? "fluid-tank-family-a-steam-traced-coil-package"
            : variant === 1
              ? "fluid-tank-family-b-ladder-catwalk-package"
              : variant === 2
                ? "fluid-tank-family-c-tall-vent-and-custody-package"
                : "fluid-tank-family-d-compact-buffer-vessel-package";
        family.userData.finishVariantIndex = variant;
        root.add(family);
        if (variant === 0) {
          const drumGeometry = new THREE.CylinderGeometry(
            0.64,
            0.64,
            1.9,
            26,
          );
          ownedGeometries.push(drumGeometry);
          const drum = new THREE.Mesh(
            drumGeometry,
            this.materials.enamel,
          );
          drum.name = "fluid-tank-family-a-horizontal-process-drum";
          drum.rotation.z = Math.PI / 2;
          drum.position.y = 0.94;
          drum.castShadow = true;
          family.add(drum);
          for (const x of [-0.96, 0.96]) {
            const headGeometry = new THREE.SphereGeometry(0.64, 22, 12);
            ownedGeometries.push(headGeometry);
            const head = new THREE.Mesh(
              headGeometry,
              this.materials.oxidizedSteel,
            );
            head.name = "fluid-tank-family-a-dished-drum-head";
            head.scale.x = 0.32;
            head.position.set(x, 0.94, 0);
            head.castShadow = true;
            family.add(head);
          }
          for (const x of [-0.58, 0, 0.58]) {
            const bandGeometry = new THREE.TorusGeometry(
              0.66,
              0.045,
              7,
              24,
            );
            ownedGeometries.push(bandGeometry);
            const band = new THREE.Mesh(
              bandGeometry,
              this.materials.copper,
            );
            band.name = "fluid-tank-family-a-drum-retaining-band";
            band.rotation.y = Math.PI / 2;
            band.position.set(x, 0.94, 0);
            family.add(band);
          }
          for (const x of [-0.56, 0.56]) {
            const saddleGeometry = new RoundedBoxGeometry(
              0.18,
              0.48,
              0.82,
              3,
              0.055,
            );
            ownedGeometries.push(saddleGeometry);
            const saddle = new THREE.Mesh(
              saddleGeometry,
              this.materials.steelDark,
            );
            saddle.name = "fluid-tank-family-a-drum-saddle";
            saddle.position.set(x, 0.36, 0);
            family.add(saddle);
          }
          const riserGeometry = new THREE.CylinderGeometry(
            0.055,
            0.055,
            1.2,
            10,
          );
          ownedGeometries.push(riserGeometry);
          const riser = new THREE.Mesh(
            riserGeometry,
            this.materials.brass,
          );
          riser.name = "fluid-tank-family-a-coil-supply-riser";
          riser.position.set(0.24, 1.72, 0.08);
          riser.castShadow = true;
          family.add(riser);
        } else if (variant === 1) {
          for (const [radius, tube, y, material] of [
            [1.1, 0.085, 1.22, this.materials.titanium],
            [1.12, 0.026, 1.54, this.materials.brass],
          ] as const) {
            const ringGeometry = new THREE.TorusGeometry(
              radius,
              tube,
              7,
              32,
            );
            ownedGeometries.push(ringGeometry);
            const ring = new THREE.Mesh(ringGeometry, material);
            ring.name =
              y < 1.4
                ? "fluid-tank-family-b-service-catwalk"
                : "fluid-tank-family-b-catwalk-guardrail";
            ring.position.y = y;
            ring.rotation.x = Math.PI / 2;
            ring.castShadow = true;
            family.add(ring);
          }
          for (let index = 0; index < 8; index += 1) {
            const angle = (index * Math.PI * 2) / 8;
            const stanchionGeometry = new THREE.CylinderGeometry(
              0.022,
              0.022,
              0.34,
              7,
            );
            ownedGeometries.push(stanchionGeometry);
            const stanchion = new THREE.Mesh(
              stanchionGeometry,
              this.materials.steelDark,
            );
            stanchion.name =
              "fluid-tank-family-b-catwalk-guard-stanchion";
            stanchion.position.set(
              Math.sin(angle) * 1.11,
              1.38,
              Math.cos(angle) * 1.11,
            );
            family.add(stanchion);
          }
          addTo(
            family,
            new RoundedBoxGeometry(0.52, 0.48, 0.34, 3, 0.055),
            this.materials.oxidizedSteel,
            [0.9, 1.32, 0.42],
            [0, -0.18, 0],
            "fluid-tank-family-b-asymmetric-sampling-cabinet",
          );
          addTo(
            family,
            new THREE.CylinderGeometry(0.17, 0.2, 0.46, 16),
            this.materials.copper,
            [0.78, 1.73, 0.34],
            [0, 0, 0],
            "fluid-tank-family-b-roof-sample-pot",
          );
          const sampleLine = new THREE.CatmullRomCurve3(
            [
              new THREE.Vector3(0.72, 1.72, 0.28),
              new THREE.Vector3(0.52, 1.94, 0.16),
              new THREE.Vector3(0.14, 2.02, 0.1),
              new THREE.Vector3(-0.08, 1.82, 0.08),
            ],
            false,
            "centripetal",
            0.34,
          );
          addTo(
            family,
            new THREE.TubeGeometry(sampleLine, 28, 0.055, 10, false),
            this.materials.brass,
            [0, 0, 0],
            [0, 0, 0],
            "fluid-tank-family-b-supported-roof-sampling-line",
          );
          for (const [x, z] of [
            [0.62, 0.25],
            [0.2, 0.1],
          ] as const) {
            addTo(
              family,
              new THREE.CylinderGeometry(0.075, 0.075, 0.12, 12),
              this.materials.weld,
              [x, 1.84, z],
              [0, 0, 0],
              "fluid-tank-family-b-sampling-line-support",
            );
          }
        } else if (variant === 2) {
          const accumulatorGeometry = new THREE.CylinderGeometry(
            0.54,
            0.62,
            2.12,
            24,
          );
          ownedGeometries.push(accumulatorGeometry);
          const accumulator = new THREE.Mesh(
            accumulatorGeometry,
            this.materials.paintedSteel,
          );
          accumulator.name =
            "fluid-tank-family-c-tall-narrow-accumulator-shell";
          accumulator.position.y = 1.3;
          accumulator.castShadow = true;
          family.add(accumulator);
          const crownGeometry = new THREE.SphereGeometry(0.54, 22, 12);
          ownedGeometries.push(crownGeometry);
          const crown = new THREE.Mesh(
            crownGeometry,
            this.materials.enamel,
          );
          crown.name = "fluid-tank-family-c-accumulator-crown";
          crown.scale.y = 0.38;
          crown.position.y = 2.37;
          family.add(crown);
          for (const angle of [
            Math.PI * 0.25,
            Math.PI * 0.75,
            Math.PI * 1.25,
            Math.PI * 1.75,
          ]) {
            const legGeometry = new RoundedBoxGeometry(
              0.12,
              0.72,
              0.12,
              2,
              0.025,
            );
            ownedGeometries.push(legGeometry);
            const leg = new THREE.Mesh(
              legGeometry,
              this.materials.steelDark,
            );
            leg.name = "fluid-tank-family-c-accumulator-leg";
            leg.position.set(
              Math.cos(angle) * 0.46,
              0.43,
              Math.sin(angle) * 0.46,
            );
            family.add(leg);
          }
          for (const y of [0.62, 1.18, 1.76]) {
            const bandGeometry = new THREE.TorusGeometry(
              0.585,
              0.042,
              7,
              24,
            );
            ownedGeometries.push(bandGeometry);
            const band = new THREE.Mesh(
              bandGeometry,
              this.materials.brass,
            );
            band.name = "fluid-tank-family-c-accumulator-course-band";
            band.rotation.x = Math.PI / 2;
            band.position.y = y;
            family.add(band);
          }
          const stackGeometry = new THREE.CylinderGeometry(
            0.1,
            0.13,
            0.82,
            14,
          );
          ownedGeometries.push(stackGeometry);
          const stack = new THREE.Mesh(
            stackGeometry,
            this.materials.oxidizedSteel,
          );
          stack.name = "fluid-tank-family-c-tall-breather-stack";
          stack.position.set(0.22, 2.64, -0.16);
          stack.castShadow = true;
          family.add(stack);
          const stackCapGeometry = new THREE.SphereGeometry(0.15, 12, 8);
          ownedGeometries.push(stackCapGeometry);
          const stackCap = new THREE.Mesh(
            stackCapGeometry,
            this.materials.safetyPaint,
          );
          stackCap.name = "fluid-tank-family-c-breather-weather-cap";
          stackCap.scale.y = 0.48;
          stackCap.position.set(0.22, 3.06, -0.16);
          family.add(stackCap);
          for (const x of [-0.67, -0.47]) {
            const custodyGeometry = new THREE.CylinderGeometry(
              0.035,
              0.035,
              1.32,
              9,
            );
            ownedGeometries.push(custodyGeometry);
            const custody = new THREE.Mesh(
              custodyGeometry,
              x < -0.6 ? this.materials.glass : this.materials.brass,
            );
            custody.name =
              "fluid-tank-family-c-dual-custody-column";
            custody.position.set(x * 0.72, 1.18, 0.63);
            family.add(custody);
          }
        } else {
          const bufferGeometry = new THREE.CylinderGeometry(
            0.64,
            0.7,
            1.08,
            22,
          );
          ownedGeometries.push(bufferGeometry);
          const bufferVessel = new THREE.Mesh(
            bufferGeometry,
            this.materials.oxidizedSteel,
          );
          bufferVessel.name =
            "fluid-tank-family-d-compact-buffer-shell";
          bufferVessel.position.y = 0.82;
          bufferVessel.castShadow = true;
          family.add(bufferVessel);
          const bufferRoofGeometry = new THREE.SphereGeometry(
            0.64,
            20,
            10,
          );
          ownedGeometries.push(bufferRoofGeometry);
          const bufferRoof = new THREE.Mesh(
            bufferRoofGeometry,
            this.materials.enamel,
          );
          bufferRoof.name = "fluid-tank-family-d-compact-buffer-dome";
          bufferRoof.scale.y = 0.34;
          bufferRoof.position.y = 1.37;
          family.add(bufferRoof);
          for (const x of [-0.72, 0.72]) {
            const skidGeometry = new RoundedBoxGeometry(
              0.18,
              0.14,
              2.2,
              2,
              0.025,
            );
            ownedGeometries.push(skidGeometry);
            const skid = new THREE.Mesh(
              skidGeometry,
              this.materials.steelDark,
            );
            skid.name = "fluid-tank-family-d-buffer-skid-rail";
            skid.position.set(x, 0.16, 0);
            skid.castShadow = true;
            family.add(skid);
          }
          for (const y of [0.48, 0.72, 0.96, 1.2, 1.44]) {
            const bandGeometry = new THREE.TorusGeometry(
              0.68,
              0.038,
              7,
              28,
            );
            ownedGeometries.push(bandGeometry);
            const band = new THREE.Mesh(
              bandGeometry,
              this.materials.heatOxide,
            );
            band.name = "fluid-tank-family-d-buffer-pressure-band";
            band.rotation.x = Math.PI / 2;
            band.position.y = y;
            family.add(band);
          }
        }

        // Every structural tank family carries the same large, authoritative
        // external custody station. It is parented to the selected family so
        // variant presentation cannot hide the actual level or pressure
        // mechanism in refinery views.
        addTo(
          family,
          new RoundedBoxGeometry(0.6, 1.66, 0.18, 3, 0.045),
          this.materials.glass,
          [-0.82, 1.15, 0.84],
          [0, 0, 0],
          "fluid-tank-pass6-authoritative-custody-column-frame",
        );
        const familyLevel = addTo(
          family,
          new RoundedBoxGeometry(0.42, 1.4, 0.072, 2, 0.022),
          this.materials.refined,
          [-0.82, 0.44, 0.94],
          [0, 0, 0],
          "fluid-tank-pass6-authoritative-custody-column-fill",
        );
        familyLevel.visible = false;
        familyLevel.scale.y = 0.001;
        familyLevel.userData.baseY = 0.42;
        familyLevel.userData.fullHeight = 1.38;
        familyLevel.userData.structuralFamilyIndex = variant;
        sightMirrors.push(familyLevel);
        for (const x of [-1.16, -0.48]) {
          addTo(
            family,
            new RoundedBoxGeometry(0.052, 1.72, 0.052, 1, 0.01),
            this.materials.brass,
            [x, 1.15, 0.94],
            [0, 0, 0],
            "fluid-tank-pass6-custody-column-protective-upright",
          );
        }
        for (const y of [0.42, 1.8]) {
          addTo(
            family,
            new THREE.CylinderGeometry(0.06, 0.06, 0.34, 10),
            this.materials.brass,
            [-0.82, y, 0.74],
            [Math.PI / 2, 0, 0],
            "fluid-tank-pass6-custody-column-isolation-spool",
          );
          addTo(
            family,
            new THREE.TorusGeometry(0.1, 0.02, 7, 16),
            this.materials.safetyPaint,
            [-0.61, y + 0.03, 0.91],
            [0, 0, 0],
            "fluid-tank-pass6-custody-column-isolation-wheel",
          );
        }
        for (const [index, y] of [0.58, 0.84, 1.1, 1.36, 1.62].entries()) {
          addTo(
            family,
            new RoundedBoxGeometry(0.5, 0.022, 0.04, 1, 0.006),
            index === 2
              ? this.materials.copper
              : this.materials.titanium,
            [-0.82, y, 1.0],
            [0, 0, 0],
            "fluid-tank-pass6-custody-column-readable-graduation",
          );
        }

        addTo(
          family,
          new THREE.CylinderGeometry(0.27, 0.27, 0.08, 22),
          this.materials.gaugeFace,
          [-0.82, 2.08, 0.86],
          [Math.PI / 2, 0, 0],
          "fluid-tank-pass6-large-pressure-gauge-face",
        );
        addTo(
          family,
          new THREE.TorusGeometry(0.275, 0.034, 8, 24),
          this.materials.copper,
          [-0.82, 2.08, 0.91],
          [0, 0, 0],
          "fluid-tank-pass6-large-pressure-gauge-bezel",
        );
        for (let tick = 0; tick < 9; tick += 1) {
          const angle = THREE.MathUtils.lerp(-1.2, 1.2, tick / 8);
          addTo(
            family,
            new RoundedBoxGeometry(0.016, 0.06, 0.014, 1, 0.003),
            this.materials.soot,
            [
              -0.82 + Math.sin(angle) * 0.2,
              2.08 + Math.cos(angle) * 0.2,
              0.918,
            ],
            [0, 0, -angle],
            "fluid-tank-pass6-pressure-gauge-tick",
          );
        }
        const familyGaugeNeedle = new THREE.Group();
        familyGaugeNeedle.name =
          "fluid-tank-pass6-large-pressure-gauge-needle";
        familyGaugeNeedle.position.set(-0.82, 2.08, 0.916);
        family.add(familyGaugeNeedle);
        gaugeNeedles.push(familyGaugeNeedle);
        addTo(
          familyGaugeNeedle,
          new RoundedBoxGeometry(0.03, 0.35, 0.024, 1, 0.006),
          this.materials.warning,
          [0, 0.13, 0],
          [0, 0, 0],
          "fluid-tank-pass6-pressure-gauge-needle-pointer",
        );

        const spring = new THREE.Group();
        spring.name = "fluid-tank-pass6-pressure-spring-cage";
        spring.position.set(-0.28, 1.9, 0.72);
        spring.userData.structuralFamilyIndex = variant;
        family.add(spring);
        for (const y of [-0.12, -0.06, 0, 0.06, 0.12]) {
          addTo(
            spring,
            new THREE.TorusGeometry(0.105, 0.018, 7, 16),
            this.materials.brass,
            [0, y, 0],
            [Math.PI / 2, 0, 0],
            "fluid-tank-pass6-pressure-spring-coil",
          );
        }
        for (const y of [-0.18, 0.18]) {
          addTo(
            spring,
            new THREE.CylinderGeometry(0.14, 0.14, 0.045, 16),
            this.materials.steelDark,
            [0, y, 0],
            [0, 0, 0],
            "fluid-tank-pass6-pressure-spring-seat",
          );
        }
        tankPressureSprings.push(spring);
        addTo(
          family,
          new THREE.CylinderGeometry(0.045, 0.045, 0.52, 10),
          this.materials.titanium,
          [-0.28, 1.93, 0.72],
          [0, 0, 0],
          "fluid-tank-pass6-pressure-valve-stem",
        );
        const ventCap = addTo(
          family,
          new THREE.SphereGeometry(0.13, 14, 8),
          this.materials.heatOxide,
          [-0.28, 2.21, 0.72],
          [0, 0, 0],
          "fluid-tank-pass6-pressure-vent-cap",
        );
        ventCap.scale.y = 0.5;
        ventCap.userData.baseY = 2.21;
        ventCap.userData.structuralFamilyIndex = variant;
        tankVentCaps.push(ventCap);
      }
      const retiredMirroredSightNames = new Set([
        "fluid-tank-sight-glass",
        "fluid-tank-visible-level",
        "fluid-tank-sight-glass-mirrored",
        "fluid-tank-visible-level-mirrored",
        "fluid-tank-sight-glass-isolation-line",
        "fluid-tank-sight-glass-isolation-valve",
        "fluid-tank-sight-glass-protective-rail",
      ]);
      root.traverse((object) => {
        if (!retiredMirroredSightNames.has(object.name)) return;
        object.visible = false;
        object.userData.presentationRetired = true;
        object.userData.retiredReason =
          "replaced-by-one-family-parented-authoritative-custody-station";
      });
      add(
        new THREE.CylinderGeometry(0.18, 0.18, 0.08, 16),
        this.materials.ceramic,
        [-0.67, 1.3, 0.78],
        [Math.PI / 2, 0, 0],
        [1, 1, 1],
        "fluid-tank-pressure-gauge",
      );
      roofLevelDisc = add(
        new THREE.CylinderGeometry(0.3, 0.3, 0.035, 28),
        this.materials.refined,
        [0, 1.835, 0],
        [0, 0, 0],
        [0.18, 1, 0.18],
        "fluid-tank-top-mechanical-float-disc",
      );
      roofLevelDisc.visible = false;
      roofLevelDisc.userData.presentation =
        "contained-roof-float-disc-driven-by-authoritative-fill";
      levelIndicator = add(
        new THREE.TorusGeometry(0.39, 0.068, 8, 28),
        this.materials.weld,
        [0, 1.82, 0],
        [Math.PI / 2, 0, 0],
        [1, 1, 1],
        "fluid-tank-top-contents-bezel",
      );
      for (let index = 0; index < 12; index += 1) {
        const angle = (index * Math.PI * 2) / 12;
        add(
          new RoundedBoxGeometry(0.035, 0.022, 0.11, 1, 0.006),
          index % 3 === 0
            ? this.materials.safetyPaint
            : this.materials.titanium,
          [
            Math.sin(angle) * 0.37,
            1.845,
            Math.cos(angle) * 0.37,
          ],
          [0, angle, 0],
          [1, 1, 1],
          "fluid-tank-top-level-graduation",
        );
      }
      levelNeedle = new THREE.Group();
      levelNeedle.name = "fluid-tank-top-level-needle";
      levelNeedle.position.set(0, 1.86, 0);
      root.add(levelNeedle);
      const needleGeometry = new RoundedBoxGeometry(
        0.1,
        0.06,
        0.7,
        2,
        0.018,
      );
      ownedGeometries.push(needleGeometry);
      const needle = new THREE.Mesh(
        needleGeometry,
        this.materials.warning,
      );
      needle.position.z = -0.27;
      needle.castShadow = true;
      levelNeedle.add(needle);
    } else {
      // The processor is intentionally a compact refinery cell rather than a
      // pair of generic cylinders: a fired fractionator, separator,
      // exchanger, condenser, metering pump, service steel, and live custody
      // windows all carry distinct visual and mechanical jobs.
      for (const x of [-1.13, 1.13]) {
        for (const z of [-1.08, 1.08]) {
          add(
            new RoundedBoxGeometry(0.16, 0.18, 0.16, 2, 0.025),
            this.materials.structuralMid,
            [x, 0.28, z],
            [0, 0, 0],
            [1, 1, 1],
            "fluid-processor-frame-load-foot",
          );
          addBeam(
            [x, 0.29, z],
            [x, 1.82, z],
            0.075,
            this.materials.structuralMid,
            "fluid-processor-service-frame-column",
          );
        }
      }
      for (const z of [-1.08, 1.08]) {
        addBeam(
          [-1.13, 1.79, z],
          [1.13, 1.79, z],
          0.07,
          this.materials.structuralMid,
          "fluid-processor-service-frame-header",
        );
        addBeam(
          [-1.13, 0.36, z],
          [-0.7, 1.24, z],
          0.055,
          this.materials.structuralMid,
          "fluid-processor-service-frame-crossbrace",
        );
        addBeam(
          [1.13, 0.36, z],
          [0.7, 1.24, z],
          0.055,
          this.materials.structuralMid,
          "fluid-processor-service-frame-crossbrace",
        );
      }

      // The fired box is a distinct refractory mass. Its burner windows and
      // local heat pool are authoritative working-state cues rather than a
      // screen-space halo.
      add(
        new RoundedBoxGeometry(0.98, 0.58, 0.76, 4, 0.09),
        this.materials.ceramic,
        [-0.54, 0.52, 0.46],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-processor-refractory-furnace",
      );
      for (const [index, x] of [-0.79, -0.54, -0.29].entries()) {
        add(
          new RoundedBoxGeometry(0.026, 0.014, 0.63, 1, 0.005),
          index === 1 ? this.materials.soot : this.materials.heatOxide,
          [x, 0.817, 0.46],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-processor-refractory-top-course-seam",
        );
        add(
          new RoundedBoxGeometry(0.024, 0.36, 0.016, 1, 0.004),
          index === 1 ? this.materials.soot : this.materials.rust,
          [x, 0.53, 0.861],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-processor-refractory-face-course-seam",
        );
      }
      for (const [x, z, width, depth, material] of [
        [-0.69, 0.34, 0.2, 0.16, this.materials.heatOxide],
        [-0.39, 0.57, 0.17, 0.12, this.materials.soot],
      ] as const) {
        add(
          new RoundedBoxGeometry(width, 0.012, depth, 2, 0.01),
          material,
          [x, 0.819, z],
          [0, 0.12, 0],
          [1, 1, 1],
          "fluid-processor-refractory-localized-fired-stain",
        );
      }
      add(
        new RoundedBoxGeometry(0.84, 0.4, 0.045, 3, 0.045),
        this.materials.heatOxide,
        [-0.54, 0.53, 0.855],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-processor-heat-discolored-firebox-face",
      );
      for (const x of [-0.82, -0.54, -0.26]) {
        const heatWindow = add(
          new THREE.CylinderGeometry(0.105, 0.105, 0.04, 16),
          this.materials.warning,
          [x, 0.52, 0.895],
          [Math.PI / 2, 0, 0],
          [1, 1, 1],
          "fluid-processor-authoritative-burner-window",
        );
        heatWindow.visible = false;
        heatWindows.push(heatWindow);
        add(
          new THREE.TorusGeometry(0.12, 0.022, 7, 16),
          this.materials.weld,
          [x, 0.52, 0.918],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-processor-burner-bolted-bezel",
        );
      }
      for (const x of [-0.93, -0.15]) {
        for (const y of [0.33, 0.7]) {
          add(
            new THREE.SphereGeometry(0.034, 8, 5),
            this.materials.rust,
            [x, y, 0.9],
            [0, 0, 0],
            [1, 1, 0.7],
            "fluid-processor-firebox-fastener",
          );
        }
      }
      heatLight = new THREE.PointLight(0xff6d2e, 0, 2.6, 2.2);
      heatLight.name = "fluid-processor-localized-furnace-light";
      heatLight.position.set(-0.54, 0.56, 0.96);
      root.add(heatLight);

      // Fired lower chamber and stepped fractionation tower.
      add(
        new THREE.CylinderGeometry(0.47, 0.54, 0.7, 26),
        this.materials.heatOxide,
        [-0.5, 0.62, -0.2],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-processor-fired-crude-chamber",
      );
      add(
        new THREE.CylinderGeometry(0.34, 0.4, 1.08, 24),
        this.materials.paintedSteel,
        [-0.5, 1.45, -0.2],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-processor-fractionation-tower",
      );
      add(
        new THREE.CylinderGeometry(0.2, 0.34, 0.32, 22),
        this.materials.ceramic,
        [-0.5, 2.15, -0.2],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-processor-fractionation-taper",
      );
      add(
        new THREE.SphereGeometry(
          0.2,
          20,
          9,
          0,
          Math.PI * 2,
          0,
          Math.PI / 2,
        ),
        this.materials.titanium,
        [-0.5, 2.3, -0.2],
        [0, 0, 0],
        [1, 0.55, 1],
        "fluid-processor-fractionation-dome",
      );
      // A real burner crown carries the process-state read at system scale.
      // Its cage remains part of the vessel; only the contained flame and
      // heat-soaked pressure course respond to authoritative work state.
      add(
        new THREE.TorusGeometry(0.25, 0.038, 7, 20),
        this.materials.weld,
        [-0.5, 2.45, -0.2],
        [Math.PI / 2, 0, 0],
        [1, 1, 1],
        "fluid-processor-burner-crown-ring",
      );
      for (let index = 0; index < 8; index += 1) {
        const angle = (index * Math.PI * 2) / 8;
        addBeam(
          [
            -0.5 + Math.sin(angle) * 0.22,
            2.4,
            -0.2 + Math.cos(angle) * 0.22,
          ],
          [
            -0.5 + Math.sin(angle) * 0.17,
            2.7,
            -0.2 + Math.cos(angle) * 0.17,
          ],
          0.026,
          index % 2 === 0 ? this.materials.rust : this.materials.weld,
          "fluid-processor-burner-crown-stanchion",
        );
      }
      add(
        new THREE.CylinderGeometry(0.095, 0.13, 0.16, 16),
        this.materials.nozzleSteel,
        [-0.5, 2.49, -0.2],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-processor-burner-crown-recessed-nozzle",
      );
      const processFlame = add(
        new THREE.ConeGeometry(0.14, 0.34, 16, 1, false),
        this.materials.warning,
        [-0.5, 2.66, -0.2],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-processor-authoritative-process-flame",
      );
      processFlame.visible = false;
      processFlame.userData.presentation =
        "contained-burner-flame-driven-by-working-state";
      heatWindows.push(processFlame);
      const heatCourse = add(
        new THREE.TorusGeometry(0.39, 0.065, 8, 24),
        this.materials.warning,
        [-0.5, 1.08, -0.2],
        [Math.PI / 2, 0, 0],
        [1, 1, 1],
        "fluid-processor-authoritative-hot-pressure-course",
      );
      heatCourse.visible = false;
      heatCourse.userData.presentation =
        "physical-heat-soaked-pressure-course-driven-by-working-state";
      heatWindows.push(heatCourse);
      for (const [radius, y] of [
        [0.5, 0.34],
        [0.48, 0.58],
        [0.44, 0.86],
        [0.38, 1.08],
        [0.36, 1.38],
        [0.35, 1.7],
        [0.31, 1.94],
        [0.21, 2.25],
      ] as const) {
        add(
          new THREE.TorusGeometry(radius, 0.038, 7, 24),
          y < 1 ? this.materials.copper : this.materials.brass,
          [-0.5, y, -0.2],
          [Math.PI / 2, 0, 0],
          [1, 1, 1],
          "fluid-processor-welded-pressure-course",
        );
      }
      for (const [stageIndex, y] of [
        0.98,
        1.22,
        1.46,
        1.7,
        1.94,
      ].entries()) {
        add(
          new THREE.TorusGeometry(0.125, 0.026, 8, 18),
          this.materials.copper,
          [-0.5, y, 0.165],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-processor-pass6-fractionation-stage-bezel",
        );
        const stage = add(
          new THREE.CylinderGeometry(0.098, 0.098, 0.052, 18),
          this.materials.soot,
          [-0.5, y, 0.182],
          [Math.PI / 2, 0, 0],
          [0.42, 0.42, 0.42],
          "fluid-processor-pass6-fractionation-stage-shutter",
        );
        stage.userData.stageIndex = stageIndex;
        stage.userData.baseZ = 0.182;
        stage.userData.stageEngaged = false;
        processStageIndicators.push(stage);
        for (const side of [-1, 1]) {
          add(
            new THREE.SphereGeometry(0.022, 8, 5),
            this.materials.brass,
            [-0.5 + side * 0.108, y, 0.19],
            [0, 0, 0],
            [1, 0.75, 1],
            "fluid-processor-pass6-fractionation-stage-bolt",
          );
        }
      }
      root.userData.causalProcessPath =
        "crude-custody-window>feed-isolation-valve>metering-pump>burner-firebox>five-stage-fractionation-tower>overhead-condenser>product-sight>refined-custody-window";
      for (let index = 0; index < 8; index += 1) {
        const angle = (index * Math.PI * 2) / 8;
        add(
          new RoundedBoxGeometry(0.052, 0.42, 0.07, 2, 0.012),
          index % 2 === 0
            ? this.materials.safetyPaint
            : this.materials.ceramic,
          [
            -0.5 + Math.sin(angle) * 0.49,
            0.59,
            -0.2 + Math.cos(angle) * 0.49,
          ],
          [0, angle, 0],
          [1, 1, 1],
          "fluid-processor-firebox-refractory-seam",
        );
      }
      add(
        new RoundedBoxGeometry(0.2, 0.72, 0.035, 2, 0.014),
        this.materials.soot,
        [-0.62, 1.35, 0.17],
        [0, -0.3, 0],
        [1, 1, 1],
        "fluid-processor-tower-localized-soot-streak",
      );
      add(
        new RoundedBoxGeometry(0.28, 0.25, 0.045, 2, 0.018),
        this.materials.rust,
        [-0.2, 1.22, -0.04],
        [0, 1.05, 0],
        [1, 1, 1],
        "fluid-processor-tower-field-patch",
      );
      for (const [x, y, z] of [
        [-0.08, 1.13, -0.1],
        [-0.08, 1.32, -0.1],
        [-0.31, 1.13, 0.09],
        [-0.31, 1.32, 0.09],
      ] as const) {
        add(
          new THREE.SphereGeometry(0.026, 8, 5),
          this.materials.brass,
          [x, y, z],
          [0, 0, 0],
          [1, 1, 0.7],
          "fluid-processor-tower-patch-rivet",
        );
      }

      // Secondary separator is deliberately shorter and offset so the plant
      // reads hierarchically even when viewed at gameplay zoom.
      add(
        new THREE.CylinderGeometry(0.34, 0.39, 0.82, 22),
        this.materials.ceramic,
        [0.68, 0.72, -0.16],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-processor-refined-vessel",
      );
      add(
        new THREE.SphereGeometry(
          0.34,
          22,
          10,
          0,
          Math.PI * 2,
          0,
          Math.PI / 2,
        ),
        this.materials.titanium,
        [0.68, 1.1, -0.16],
        [0, 0, 0],
        [1, 0.38, 1],
        "fluid-processor-separator-dome",
      );
      for (const y of [0.35, 0.7, 1.04]) {
        add(
          new THREE.TorusGeometry(0.36, 0.035, 7, 22),
          this.materials.copper,
          [0.68, y, -0.16],
          [Math.PI / 2, 0, 0],
          [1, 1, 1],
          "fluid-processor-separator-weld",
        );
      }

      // Horizontal shell-and-tube exchanger with individually legible fins.
      add(
        new THREE.CylinderGeometry(0.25, 0.25, 1.02, 20),
        this.materials.steel,
        [0.28, 0.47, 0.39],
        [0, 0, Math.PI / 2],
        [1, 1, 1],
        "fluid-processor-shell-tube-exchanger",
      );
      for (const x of [-0.21, 0, 0.21, 0.42, 0.63, 0.79]) {
        add(
          new THREE.TorusGeometry(0.26, 0.023, 7, 18),
          x === -0.21 || x === 0.79
            ? this.materials.copper
            : this.materials.titanium,
          [x, 0.47, 0.39],
          [0, Math.PI / 2, 0],
          [1, 1, 1],
          "fluid-processor-exchanger-cooling-fin",
        );
      }
      for (const x of [-0.26, 0.82]) {
        add(
          new THREE.CylinderGeometry(0.31, 0.31, 0.11, 18),
          this.materials.brass,
          [x, 0.47, 0.39],
          [0, 0, Math.PI / 2],
          [1, 1, 1],
          "fluid-processor-exchanger-bolted-head",
        );
      }

      // Structural catwalk, guard rails, and access ladder.
      for (const z of [-0.83, 0.88]) {
        for (const offset of [-0.11, 0.11]) {
          addRoundPipe(
            [-1.02, 1.18, z + offset],
            [1.02, 1.18, z + offset],
            0.026,
            this.materials.structuralMid,
            "fluid-processor-service-catwalk-stringer",
            8,
          );
        }
        for (let slat = 0; slat <= 8; slat += 1) {
          const x = THREE.MathUtils.lerp(-0.98, 0.98, slat / 8);
          addRoundPipe(
            [x, 1.18, z - 0.11],
            [x, 1.18, z + 0.11],
            0.018,
            slat % 2 === 0
              ? this.materials.structuralMid
              : this.materials.safetyPaint,
            "fluid-processor-service-catwalk-open-slat",
            8,
          );
        }
      }
      for (const z of [-0.98, 1.03]) {
        for (const x of [-0.96, -0.48, 0, 0.48, 0.96]) {
          addBeam(
            [x, 1.2, z],
            [x, 1.49, z],
            0.028,
            this.materials.structuralMid,
            "fluid-processor-catwalk-stanchion",
          );
        }
        addBeam(
          [-1, 1.49, z],
          [1, 1.49, z],
          0.032,
          this.materials.structuralMid,
          "fluid-processor-catwalk-handrail",
        );
      }
      for (const x of [0.94, 1.17]) {
        addBeam(
          [x, 0.26, 1.12],
          [x, 1.2, 1.12],
          0.035,
          this.materials.brass,
          "fluid-processor-access-ladder-rail",
        );
      }
      for (let rung = 0; rung < 6; rung += 1) {
        addBeam(
          [0.94, 0.34 + rung * 0.16, 1.12],
          [1.17, 0.34 + rung * 0.16, 1.12],
          0.027,
          this.materials.brass,
          "fluid-processor-access-ladder-rung",
        );
      }

      // Overhead fraction piping with explicit risers and elbows.
      addRoundPipe(
        [-0.5, 2.3, -0.2],
        [-0.5, 2.51, -0.2],
        0.085,
        this.materials.brass,
        "fluid-processor-overhead-riser",
      );
      addRoundPipe(
        [-0.5, 2.51, -0.2],
        [0.68, 2.51, -0.2],
        0.085,
        this.materials.brass,
        "fluid-processor-overhead-manifold",
      );
      addRoundPipe(
        [0.68, 2.51, -0.2],
        [0.68, 1.15, -0.2],
        0.085,
        this.materials.brass,
        "fluid-processor-separator-downcomer",
      );
      for (const point of [
        [-0.5, 2.51, -0.2],
        [0.68, 2.51, -0.2],
        [0.68, 1.15, -0.2],
      ] as const) {
        add(
          new THREE.TorusGeometry(0.13, 0.025, 7, 16),
          this.materials.copper,
          point,
          [Math.PI / 2, 0, 0],
          [1, 1, 1],
          "fluid-processor-manifold-bolted-collar",
        );
      }
      addRoundPipe(
        [-1.31, 0.42, 0],
        [-0.96, 0.42, 0],
        0.14,
        this.materials.safetyPaint,
        "fluid-processor-crude-inlet-manifold",
      );
      addRoundPipe(
        [0.97, 0.42, 0],
        [1.31, 0.42, 0],
        0.14,
        this.materials.enamel,
        "fluid-processor-refined-outlet-manifold",
      );
      for (const x of [-1.21, 1.21]) {
        add(
          new THREE.CylinderGeometry(0.22, 0.22, 0.14, 16),
          this.materials.titanium,
          [x, 0.42, 0],
          [0, 0, Math.PI / 2],
          [1, 1, 1],
          "fluid-processor-process-flange",
        );
      }
      for (const [z, material, name] of [
        [
          1.32,
          this.materials.safetyPaint,
          "fluid-processor-crude-line-coupling",
        ],
        [
          -1.32,
          this.materials.enamel,
          "fluid-processor-refined-line-coupling",
        ],
      ] as const) {
        addRoundPipe(
          [0, 0.42, z > 0 ? 0.58 : -0.58],
          [0, 0.42, z],
          0.14,
          material,
          name,
        );
        add(
          new THREE.CylinderGeometry(0.22, 0.22, 0.14, 16),
          this.materials.titanium,
          [0, 0.42, z],
          [Math.PI / 2, 0, 0],
          [1, 1, 1],
          "fluid-processor-directional-line-flange",
        );
      }
      for (const z of [-1.08, 1.08]) {
        add(
          new THREE.TorusGeometry(0.17, 0.032, 7, 18),
          this.materials.weld,
          [0, 0.42, z],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-processor-directional-expansion-bellows",
        );
        const valve = new THREE.Group();
        valve.name =
          z > 0
            ? "fluid-processor-feed-isolation-valve"
            : "fluid-processor-product-isolation-valve";
        valve.position.set(0.25, 0.68, z);
        root.add(valve);
        valveHandles.push(valve);
        const valveGeometry = new THREE.TorusGeometry(
          0.12,
          0.022,
          7,
          16,
        );
        ownedGeometries.push(valveGeometry);
        const rim = new THREE.Mesh(
          valveGeometry,
          z > 0 ? this.materials.safetyPaint : this.materials.brass,
        );
        valve.add(rim);
        for (let index = 0; index < 4; index += 1) {
          const spokeGeometry = new RoundedBoxGeometry(
            0.02,
            0.19,
            0.02,
            1,
            0.005,
          );
          ownedGeometries.push(spokeGeometry);
          const spoke = new THREE.Mesh(spokeGeometry, this.materials.weld);
          spoke.rotation.z = (index * Math.PI) / 2;
          valve.add(spoke);
        }
      }

      // The metering rotor is enclosed by a volute and service ring so its
      // rotation communicates a real pump rather than a floating icon.
      add(
        new THREE.CylinderGeometry(0.34, 0.34, 0.14, 20),
        this.materials.steelDark,
        [0.13, 0.78, 0.96],
        [Math.PI / 2, 0, 0],
        [1, 1, 1],
        "fluid-processor-metering-pump-volute",
      );
      add(
        new THREE.TorusGeometry(0.32, 0.055, 8, 20),
        this.materials.copper,
        [0.13, 0.78, 1.04],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-processor-metering-pump-service-ring",
      );
      rotor = new THREE.Group();
      rotor.name = "fluid-processor-metering-rotor";
      rotor.userData.rotationAxis = "z";
      rotor.userData.mechanism = "recipe-driven-metering-rotor";
      rotor.position.set(0.13, 0.78, 1.065);
      root.add(rotor);
      for (let index = 0; index < 6; index += 1) {
        const angle = (index * Math.PI * 2) / 6;
        const bladeGeometry = new RoundedBoxGeometry(
          0.055,
          0.29,
          0.045,
          2,
          0.012,
        );
        ownedGeometries.push(bladeGeometry);
        const blade = new THREE.Mesh(
          bladeGeometry,
          this.materials.titanium,
        );
        blade.position.set(
          Math.cos(angle) * 0.12,
          Math.sin(angle) * 0.12,
          0,
        );
        blade.rotation.z = angle + 0.5;
        blade.castShadow = true;
        rotor.add(blade);
      }
      const rotorHubGeometry = new THREE.CylinderGeometry(
        0.095,
        0.095,
        0.08,
        14,
      );
      ownedGeometries.push(rotorHubGeometry);
      const rotorHub = new THREE.Mesh(
        rotorHubGeometry,
        this.materials.safetyPaint,
      );
      rotorHub.rotation.x = Math.PI / 2;
      rotor.add(rotorHub);

      // A literal custody-to-process path wraps the existing metering rotor.
      // The contained slugs move only when the matching authoritative buffer
      // exists, making the lifecycle readable without tinting whole pipes.
      addBentPipe(
        [
          [-0.78, 0.72, 1.2],
          [-0.46, 0.84, 1.18],
          [-0.08, 0.84, 1.12],
          [0.13, 0.78, 1.07],
        ],
        0.065,
        this.materials.brass,
        "fluid-processor-pass6-supported-feed-custody-line",
      );
      addRoundPipe(
        [-0.1, 0.84, 1.12],
        [0.1, 0.8, 1.08],
        0.125,
        this.materials.glass,
        "fluid-processor-pass6-feed-sight-body",
        14,
      );
      processFeedSlug = add(
        new THREE.SphereGeometry(0.105, 16, 10),
        this.materials.crude,
        [0, 0.82, 1.1],
        [0, 0, 0],
        [1, 0.72, 1],
        "fluid-processor-pass6-authoritative-feed-slug",
      );
      processFeedSlug.visible = false;

      addBentPipe(
        [
          [0.68, 1.12, -0.16],
          [0.68, 1.42, 0.12],
          [0.68, 1.42, 0.52],
          [0.82, 1.18, 0.72],
        ],
        0.065,
        this.materials.brass,
        "fluid-processor-pass6-overhead-condensate-path",
      );
      addRoundPipe(
        [0.82, 1.36, 0.72],
        [0.82, 0.92, 0.72],
        0.14,
        this.materials.glass,
        "fluid-processor-pass6-product-sight-body",
        14,
      );
      for (const y of [0.92, 1.36]) {
        add(
          new THREE.TorusGeometry(0.145, 0.027, 8, 18),
          this.materials.copper,
          [0.82, y, 0.72],
          [Math.PI / 2, 0, 0],
          [1, 1, 1],
          "fluid-processor-pass6-product-sight-bolted-collar",
        );
      }
      addBentPipe(
        [
          [0.82, 0.92, 0.72],
          [0.8, 0.78, 0.98],
          [0.72, 0.72, 1.2],
        ],
        0.065,
        this.materials.brass,
        "fluid-processor-pass6-product-custody-line",
      );
      processProductSlug = add(
        new THREE.SphereGeometry(0.125, 16, 10),
        this.materials.refined,
        [0.82, 0.96, 0.72],
        [0, 0, 0],
        [1, 0.78, 1],
        "fluid-processor-pass6-authoritative-product-slug",
      );
      processProductSlug.visible = false;

      // Two broad, truthful custody windows make conversion state legible
      // without opening a menu.
      for (const x of [-0.78, 0.72]) {
        add(
          new RoundedBoxGeometry(0.56, 0.94, 0.12, 3, 0.045),
          this.materials.glass,
          [x, 0.82, 1.22],
          [0, 0, 0],
          [1, 1, 1],
          x < 0
            ? "fluid-processor-crude-custody-window-frame"
            : "fluid-processor-refined-custody-window-frame",
        );
        for (const y of [0.44, 0.6, 0.76, 0.92, 1.08, 1.18]) {
          add(
            new RoundedBoxGeometry(0.09, 0.018, 0.04, 1, 0.006),
            this.materials.titanium,
            [x + 0.19, y, 1.29],
            [0, 0, 0],
            [1, 1, 1],
            "fluid-processor-custody-window-graduation",
          );
        }
      }
      inputSight = add(
        new RoundedBoxGeometry(0.4, 0.78, 0.05, 2, 0.018),
        this.materials.crude,
        [-0.78, 0.4, 1.29],
        [0, 0, 0],
        [1, 0.001, 1],
        "fluid-processor-crude-input-window",
      );
      inputSight.userData.baseY = 0.4;
      inputSight.userData.fullHeight = 0.76;
      outputSight = add(
        new RoundedBoxGeometry(0.4, 0.78, 0.05, 2, 0.018),
        this.materials.refined,
        [0.72, 0.4, 1.29],
        [0, 0, 0],
        [1, 0.001, 1],
        "fluid-processor-refined-output-window",
      );
      outputSight.userData.baseY = 0.4;
      outputSight.userData.fullHeight = 0.76;
      for (const {
        x,
        z,
        fluidMaterial,
        frameName,
        levelName,
        levels,
      } of [
        {
          x: -1.22,
          z: 0.58,
          fluidMaterial: this.materials.crude,
          frameName: "fluid-processor-crude-side-custody-window-frame",
          levelName: "fluid-processor-crude-side-input-window",
          levels: inputSightMirrors,
        },
        {
          x: 1.22,
          z: -0.52,
          fluidMaterial: this.materials.refined,
          frameName: "fluid-processor-refined-side-custody-window-frame",
          levelName: "fluid-processor-refined-side-output-window",
          levels: outputSightMirrors,
        },
      ] as const) {
        add(
          new RoundedBoxGeometry(0.12, 0.94, 0.56, 3, 0.045),
          this.materials.glass,
          [x, 0.82, z],
          [0, 0, 0],
          [1, 1, 1],
          frameName,
        );
        for (const railZ of [z - 0.23, z + 0.23]) {
          add(
            new RoundedBoxGeometry(0.12, 0.99, 0.055, 2, 0.016),
            this.materials.steelDark,
            [x + Math.sign(x) * 0.015, 0.82, railZ],
            [0, 0, 0],
            [1, 1, 1],
            "fluid-processor-side-custody-window-bolted-upright",
          );
          add(
            new RoundedBoxGeometry(0.09, 0.36, 0.07, 2, 0.016),
            this.materials.structuralMid,
            [x, 0.3, railZ],
            [0, 0, 0],
            [1, 1, 1],
            "fluid-processor-side-custody-window-grounded-pedestal",
          );
          addBeam(
            [x, 0.16, railZ],
            [x - Math.sign(x) * 0.72, 0.16, railZ],
            0.065,
            this.materials.steelDark,
            "fluid-processor-side-custody-window-skid-tie",
          );
        }
        for (const railY of [0.35, 1.29]) {
          add(
            new RoundedBoxGeometry(0.12, 0.055, 0.52, 2, 0.016),
            railY > 1 ? this.materials.copper : this.materials.steelDark,
            [x + Math.sign(x) * 0.015, railY, z],
            [0, 0, 0],
            [1, 1, 1],
            "fluid-processor-side-custody-window-bolted-crossrail",
          );
        }
        for (const y of [0.44, 0.6, 0.76, 0.92, 1.08, 1.18]) {
          add(
            new RoundedBoxGeometry(0.04, 0.018, 0.08, 1, 0.006),
            this.materials.titanium,
            [x + Math.sign(x) * 0.07, y, z + 0.19],
            [0, 0, 0],
            [1, 1, 1],
            "fluid-processor-side-custody-window-graduation",
          );
        }
        const sideLevel = add(
            new RoundedBoxGeometry(0.05, 0.78, 0.4, 2, 0.018),
            fluidMaterial,
            [x + Math.sign(x) * 0.07, 0.4, z],
            [0, 0, 0],
            [1, 0.001, 1],
            levelName,
          );
        sideLevel.userData.baseY = 0.4;
        sideLevel.userData.fullHeight = 0.76;
        levels.push(sideLevel);
      }
      sight = outputSight;
      sightFrame = root.getObjectByName(
        "fluid-processor-refined-custody-window-frame",
      );

      // Condenser drum, fin pack, pressure instruments, and relief valve.
      add(
        new THREE.CylinderGeometry(0.22, 0.22, 0.78, 18),
        this.materials.steelDark,
        [0.63, 1.65, 0.52],
        [0, 0, Math.PI / 2],
        [1, 1, 1],
        "fluid-processor-condenser-drum",
      );
      for (const x of [0.29, 0.43, 0.57, 0.71, 0.85, 0.98]) {
        add(
          new THREE.TorusGeometry(0.23, 0.021, 7, 16),
          this.materials.titanium,
          [x, 1.65, 0.52],
          [0, Math.PI / 2, 0],
          [1, 1, 1],
          "fluid-processor-condenser-fin",
        );
      }
      for (const x of [-0.77, 0.75]) {
        add(
          new THREE.CylinderGeometry(0.205, 0.205, 0.075, 20),
          this.materials.gaugeFace,
          [x, 1.6, 1.14],
          [Math.PI / 2, 0, 0],
          [1, 1, 1],
          "fluid-processor-pressure-gauge",
        );
        add(
          new THREE.TorusGeometry(0.21, 0.03, 8, 22),
          this.materials.brass,
          [x, 1.6, 1.187],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-processor-pressure-gauge-bezel",
        );
        for (let index = 0; index < 9; index += 1) {
          const angle = THREE.MathUtils.lerp(-1.2, 1.2, index / 8);
          add(
            new RoundedBoxGeometry(0.014, 0.045, 0.012, 1, 0.003),
            this.materials.soot,
            [
              x + Math.sin(angle) * 0.155,
              1.6 + Math.cos(angle) * 0.155,
              1.193,
            ],
            [0, 0, -angle],
            [1, 1, 1],
            "fluid-processor-pressure-gauge-tick",
          );
        }
        const gaugeNeedle = new THREE.Group();
        gaugeNeedle.name = "fluid-processor-gauge-needle";
        gaugeNeedle.position.set(x, 1.6, 1.19);
        root.add(gaugeNeedle);
        gaugeNeedles.push(gaugeNeedle);
        const gaugeNeedleGeometry = new RoundedBoxGeometry(
          0.028,
          0.29,
          0.024,
          1,
          0.006,
        );
        ownedGeometries.push(gaugeNeedleGeometry);
        const gaugeNeedleMesh = new THREE.Mesh(
          gaugeNeedleGeometry,
          this.materials.warning,
        );
        gaugeNeedleMesh.position.y = 0.11;
        gaugeNeedle.add(gaugeNeedleMesh);
      }
      secondaryRotor = new THREE.Group();
      secondaryRotor.name = "fluid-processor-condenser-fan";
      secondaryRotor.userData.rotationAxis = "y";
      secondaryRotor.userData.mechanism = "recipe-driven-condenser-fan";
      secondaryRotor.position.set(0.67, 1.92, 0.52);
      root.add(secondaryRotor);
      const fanGuardGeometry = new THREE.TorusGeometry(0.31, 0.035, 8, 22);
      ownedGeometries.push(fanGuardGeometry);
      const fanGuard = new THREE.Mesh(
        fanGuardGeometry,
        this.materials.weld,
      );
      fanGuard.rotation.x = Math.PI / 2;
      secondaryRotor.add(fanGuard);
      for (let index = 0; index < 6; index += 1) {
        const angle = (index * Math.PI * 2) / 6;
        const fanGeometry = new RoundedBoxGeometry(
          0.065,
          0.028,
          0.35,
          2,
          0.012,
        );
        ownedGeometries.push(fanGeometry);
        const fan = new THREE.Mesh(fanGeometry, this.materials.titanium);
        fan.position.set(
          Math.cos(angle) * 0.1,
          0,
          Math.sin(angle) * 0.1,
        );
        fan.rotation.y = angle + 0.48;
        secondaryRotor.add(fan);
      }
      addRoundPipe(
        [-0.5, 2.37, -0.2],
        [-0.93, 2.37, -0.5],
        0.075,
        this.materials.steelDark,
        "fluid-processor-relief-offset-header",
      );
      addRoundPipe(
        [-0.93, 2.37, -0.5],
        [-0.93, 2.76, -0.5],
        0.075,
        this.materials.steelDark,
        "fluid-processor-relief-stack",
      );
      pressureValve = new THREE.Group();
      pressureValve.name = "fluid-processor-backpressure-handwheel";
      pressureValve.position.set(-0.93, 2.56, -0.26);
      pressureValve.rotation.x = Math.PI / 2;
      pressureValve.userData.rotationAxis = "y";
      root.add(pressureValve);
      const valveRimGeometry = new THREE.TorusGeometry(0.21, 0.036, 7, 18);
      ownedGeometries.push(valveRimGeometry);
      const valveRim = new THREE.Mesh(
        valveRimGeometry,
        this.materials.safetyPaint,
      );
      valveRim.name = "fluid-processor-backpressure-handwheel-rim";
      valveRim.castShadow = true;
      pressureValve.add(valveRim);
      for (let index = 0; index < 4; index += 1) {
        const spokeGeometry = new RoundedBoxGeometry(
          0.034,
          0.34,
          0.034,
          1,
          0.006,
        );
        ownedGeometries.push(spokeGeometry);
        const spoke = new THREE.Mesh(spokeGeometry, this.materials.brass);
        spoke.rotation.z = (index * Math.PI) / 2;
        pressureValve.add(spoke);
      }
      add(
        new THREE.CylinderGeometry(0.11, 0.11, 0.24, 12),
        this.materials.brass,
        [-0.52, 1.18, 1.26],
        [Math.PI / 2, 0, 0],
        [1, 1, 1],
        "fluid-processor-trip-gate-hinge",
      );
      shutdownGate = new THREE.Group();
      shutdownGate.name = "fluid-processor-mechanical-shutdown-trip-gate";
      shutdownGate.position.set(-0.52, 1.18, 1.34);
      shutdownGate.userData.hingeAnchor = [-0.52, 1.18, 1.34];
      shutdownGate.visible = false;
      shutdownGate.userData.retiredReason =
        "trip state is carried by the seated relief train without a detached warning bar";
      root.add(shutdownGate);
      addTo(
        shutdownGate,
        new RoundedBoxGeometry(1.08, 0.24, 0.1, 2, 0.035),
        this.materials.safetyPaint,
        [0.54, 0, 0],
        [0, 0, 0],
        "fluid-processor-shutdown-gate-crossbar",
      );
      for (const x of [-0.37, 0, 0.37]) {
        addTo(
          shutdownGate,
          new RoundedBoxGeometry(0.11, 0.26, 0.108, 1, 0.014),
          this.materials.soot,
          [x + 0.54, 0, 0.006],
          [0, 0, x === 0 ? 0 : x < 0 ? -0.34 : 0.34],
          "fluid-processor-shutdown-gate-warning-stripe",
        );
      }
      addTo(
        shutdownGate,
        new THREE.TorusGeometry(0.17, 0.03, 7, 18),
        this.materials.brass,
        [1.16, 0, 0],
        [0, 0, 0],
        "fluid-processor-shutdown-gate-pull-ring",
      );
      reliefSpring = new THREE.Group();
      reliefSpring.name = "fluid-processor-pass6-primary-relief-spring";
      reliefSpring.position.set(-0.93, 2.58, -0.5);
      reliefSpring.userData.baseScaleY = 1;
      root.add(reliefSpring);
      for (const y of [-0.12, -0.06, 0, 0.06, 0.12]) {
        addTo(
          reliefSpring,
          new THREE.TorusGeometry(0.11, 0.018, 7, 16),
          this.materials.brass,
          [0, y, 0],
          [Math.PI / 2, 0, 0],
          "fluid-processor-pass6-primary-relief-spring-coil",
        );
      }
      for (const y of [-0.18, 0.18]) {
        addTo(
          reliefSpring,
          new THREE.CylinderGeometry(0.145, 0.145, 0.045, 16),
          this.materials.steelDark,
          [0, y, 0],
          [0, 0, 0],
          "fluid-processor-pass6-primary-relief-spring-seat",
        );
      }
      add(
        new THREE.CylinderGeometry(0.045, 0.045, 0.5, 10),
        this.materials.titanium,
        [-0.93, 2.59, -0.5],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-processor-pass6-primary-relief-valve-stem",
      );
      reliefCap = new THREE.Group();
      reliefCap.name = "fluid-processor-relief-cap";
      reliefCap.position.set(-0.93, 2.79, -0.5);
      root.add(reliefCap);
      addTo(
        reliefCap,
        new THREE.CylinderGeometry(0.17, 0.2, 0.075, 18),
        this.materials.heatOxide,
        [0, 0, 0],
        [0, 0, 0],
        "fluid-processor-relief-cap-weather-shield",
      );
      addTo(
        reliefCap,
        new THREE.TorusGeometry(0.19, 0.026, 7, 20),
        this.materials.copper,
        [0, -0.025, 0],
        [Math.PI / 2, 0, 0],
        "fluid-processor-relief-cap-seated-edge",
      );
      addTo(
        reliefCap,
        new THREE.CylinderGeometry(0.07, 0.09, 0.09, 14),
        this.materials.nozzleSteel,
        [0, 0.065, 0],
        [0, 0, 0],
        "fluid-processor-relief-cap-vent-neck",
      );
      reliefCap.userData.baseY = 2.79;
      for (let index = 0; index < 1; index += 1) {
        const plume = new THREE.Sprite(this.materials.steam);
        plume.name = "fluid-processor-authoritative-steam-plume";
        plume.position.set(-0.93, 3.22, -0.5);
        plume.userData.baseX = -0.93;
        plume.userData.baseZ = -0.5;
        plume.userData.processBaseX = -0.98;
        plume.userData.processBaseZ = -0.7;
        plume.scale.set(0.42, 0.84, 1);
        plume.userData.baseY = 3.22;
        plume.userData.phase = 0;
        plume.userData.plumeIndex = index;
        plume.visible = false;
        root.add(plume);
        steamPlumes.push(plume);
      }
    }

    // Pass-five restraint layer: the official 2.1 pump language favors one
    // readable housing, drive, and instrument face. Earlier decorative cages,
    // duplicate goosenecks, and tangent safety rings have been removed.
    if (kind === "fluidPump") {
      for (let index = 0; index < 7; index += 1) {
        const angle = THREE.MathUtils.lerp(-1.05, 1.05, index / 6);
        add(
          new RoundedBoxGeometry(0.014, 0.014, 0.052, 1, 0.003),
          this.materials.soot,
          [
            -0.2 + Math.sin(angle) * 0.105,
            0.876,
            -0.03 - Math.cos(angle) * 0.105,
          ],
          [0, -angle, 0],
          [1, 1, 1],
          "fluid-pump-pressure-gauge-tick",
        );
      }
    } else if (kind === "fluidTank") {
      const variantGroups = Array.from({ length: 4 }, (_, variant) => {
        const group = new THREE.Group();
        group.name = `fluid-tank-retired-supplemental-family-${variant}`;
        group.userData.finishVariantIndex = variant;
        group.visible = false;
        root.add(group);
        return group;
      });
      const roofDeck = variantGroups[0]!;
      addTo(
        roofDeck,
        new RoundedBoxGeometry(1.48, 0.09, 0.48, 3, 0.035),
        this.materials.steel,
        [0, 1.72, 0.18],
        [0, 0, 0],
        "fluid-tank-family-a-roof-service-deck",
      );
      for (const x of [-0.68, -0.23, 0.23, 0.68]) {
        addTo(
          roofDeck,
          new RoundedBoxGeometry(0.035, 0.42, 0.035, 1, 0.008),
          this.materials.titanium,
          [x, 1.93, 0.39],
          [0, 0, 0],
          "fluid-tank-family-a-deck-stanchion",
        );
      }
      addTo(
        roofDeck,
        new RoundedBoxGeometry(1.48, 0.035, 0.035, 1, 0.008),
        this.materials.titanium,
        [0, 2.12, 0.39],
        [0, 0, 0],
        "fluid-tank-family-a-deck-handrail",
      );

      const bulletBank = variantGroups[1]!;
      for (const z of [-0.36, 0.36]) {
        addTo(
          bulletBank,
          new THREE.CapsuleGeometry(0.27, 1.05, 7, 18),
          z < 0 ? this.materials.ceramic : this.materials.paintedSteel,
          [0, 1.68, z],
          [0, 0, Math.PI / 2],
          "fluid-tank-family-b-horizontal-pressure-drum",
        );
        for (const x of [-0.52, 0.52]) {
          addTo(
            bulletBank,
            new THREE.TorusGeometry(0.28, 0.026, 6, 18),
            this.materials.copper,
            [x, 1.68, z],
            [0, Math.PI / 2, 0],
            "fluid-tank-family-b-drum-course-ring",
          );
        }
      }
      for (const x of [-0.48, 0.48]) {
        addTo(
          bulletBank,
          new RoundedBoxGeometry(0.16, 0.62, 1.02, 2, 0.03),
          this.materials.steelDark,
          [x, 1.3, 0],
          [0, 0, 0],
          "fluid-tank-family-b-drum-saddle",
        );
      }

      const accumulator = variantGroups[2]!;
      addTo(
        accumulator,
        new THREE.CapsuleGeometry(0.38, 0.82, 8, 20),
        this.materials.enamel,
        [0.1, 2.0, -0.08],
        [0, 0, 0],
        "fluid-tank-family-c-vertical-accumulator",
      );
      for (const y of [1.62, 1.92, 2.22, 2.52]) {
        addTo(
          accumulator,
          new THREE.TorusGeometry(0.39, 0.026, 6, 20),
          y === 1.62 ? this.materials.rust : this.materials.brass,
          [0.1, y, -0.08],
          [Math.PI / 2, 0, 0],
          "fluid-tank-family-c-pressure-course",
        );
      }
      for (const x of [-0.42, 0.62]) {
        addTo(
          accumulator,
          new RoundedBoxGeometry(0.08, 1.25, 0.1, 2, 0.02),
          this.materials.steel,
          [x, 1.73, -0.08],
          [0, 0, x < 0 ? -0.16 : 0.16],
          "fluid-tank-family-c-braced-leg",
        );
      }

      const coilTank = variantGroups[3]!;
      for (const y of [0.52, 0.76, 1, 1.24, 1.48]) {
        addTo(
          coilTank,
          new THREE.TorusGeometry(1.02, 0.045, 7, 30),
          y === 1.48
            ? this.materials.brass
            : y < 0.8
              ? this.materials.rust
              : this.materials.copper,
          [0, y, 0],
          [Math.PI / 2, 0, 0],
          "fluid-tank-family-d-external-heating-coil",
        );
      }
      for (const angle of [0.3, 1.3, 2.3, 3.3, 4.3, 5.3]) {
        addTo(
          coilTank,
          new RoundedBoxGeometry(0.055, 1.38, 0.08, 2, 0.012),
          this.materials.titanium,
          [Math.sin(angle) * 1.04, 0.95, Math.cos(angle) * 1.04],
          [0, angle, 0],
          "fluid-tank-family-d-coil-restraint",
        );
      }
      addTo(
        coilTank,
        new THREE.CapsuleGeometry(0.15, 0.45, 6, 16),
        this.materials.safetyPaint,
        [-0.48, 2.04, 0.04],
        [0, 0, 0],
        "fluid-tank-family-d-twin-roof-breather",
      );
      addTo(
        coilTank,
        new THREE.CapsuleGeometry(0.15, 0.32, 6, 16),
        this.materials.brass,
        [0.46, 1.96, -0.12],
        [0, 0, 0],
        "fluid-tank-family-d-twin-roof-breather",
      );
    } else if (kind === "fluidProcessor") {
      addBentPipe(
        [
          [-0.5, 2.28, -0.2],
          [-0.5, 2.62, -0.2],
          [-0.14, 2.76, -0.2],
          [0.52, 2.76, -0.2],
          [0.7, 2.45, -0.2],
          [0.7, 1.2, -0.2],
        ],
        0.095,
        this.materials.brass,
        "fluid-processor-swept-overhead-fraction-line",
      );
      for (const x of [-0.46, -0.14, 0.2, 0.52]) {
        add(
          new THREE.CylinderGeometry(0.145, 0.145, 0.075, 16),
          this.materials.copper,
          [x, 2.74, -0.2],
          [0, 0, Math.PI / 2],
          [1, 1, 1],
          "fluid-processor-overhead-line-bolted-flange",
        );
      }
      add(
        new THREE.CapsuleGeometry(0.28, 0.84, 8, 20),
        this.materials.paintedSteel,
        [0.72, 1.38, -0.56],
        [0, 0, Math.PI / 2],
        [1, 1, 1],
        "fluid-processor-asymmetric-knockout-drum",
      );
      for (const x of [0.34, 0.72, 1.1]) {
        add(
          new THREE.TorusGeometry(0.29, 0.028, 7, 20),
          this.materials.weld,
          [x, 1.38, -0.56],
          [0, Math.PI / 2, 0],
          [1, 1, 1],
          "fluid-processor-knockout-drum-course-ring",
        );
      }
      for (const x of [0.38, 1.05]) {
        add(
          new RoundedBoxGeometry(0.12, 0.72, 0.58, 2, 0.03),
          this.materials.steelDark,
          [x, 1.04, -0.56],
          [0, 0, 0],
          [1, 1, 1],
          "fluid-processor-knockout-drum-saddle",
        );
      }
      add(
        new THREE.CylinderGeometry(0.18, 0.22, 1.25, 18),
        this.materials.oxidizedSteel,
        [-0.98, 1.75, -0.7],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-processor-combustion-exhaust-stack",
      );
      for (const y of [1.2, 1.56, 1.92, 2.28]) {
        add(
          new THREE.TorusGeometry(0.205, 0.024, 6, 18),
          y < 1.4 ? this.materials.rust : this.materials.copper,
          [-0.98, y, -0.7],
          [Math.PI / 2, 0, 0],
          [1, 1, 1],
          "fluid-processor-exhaust-stack-course-ring",
        );
      }
      add(
        new THREE.CylinderGeometry(0.31, 0.18, 0.16, 18, 1, true),
        this.materials.safetyPaint,
        [-0.98, 2.42, -0.7],
        [0, 0, 0],
        [1, 1, 1],
        "fluid-processor-exhaust-rain-hood",
      );
    }

    const statusPosition: readonly [number, number, number] =
      kind === "fluidTank"
        ? [0.72, 1.43, 1.04]
        : kind === "fluidProcessor"
          ? [0.72, 1.12, 0.48]
          : kind === "fluidSource"
            ? [-0.66, 0.58, -0.22]
            : [0.31, 0.76, 0.29];
    const statusConsole = add(
      new RoundedBoxGeometry(
        kind === "fluidProcessor" ? 0.18 : 0.24,
        kind === "fluidProcessor" ? 0.16 : 0.2,
        0.055,
        2,
        0.025,
      ),
      kind === "fluidProcessor"
        ? this.materials.steelDark
        : this.materials.soot,
      [
        statusPosition[0],
        statusPosition[1],
        statusPosition[2] - 0.035,
      ],
      [0, 0, 0],
      [1, 1, 1],
      `fluid-${kind}-integrated-status-console`,
    );
    const status = add(
      new THREE.CylinderGeometry(
        kind === "fluidProcessor" ? 0.052 : 0.068,
        kind === "fluidProcessor" ? 0.052 : 0.068,
        0.035,
        14,
      ),
      this.materials.inactive,
      statusPosition,
      [Math.PI / 2, 0, 0],
      [1, 1, 1],
      `fluid-${kind}-status`,
    );
    const statusBezel = add(
      new THREE.TorusGeometry(
        kind === "fluidProcessor" ? 0.064 : 0.084,
        0.015,
        7,
        18,
      ),
      this.materials.weld,
      [
        statusPosition[0],
        statusPosition[1],
        statusPosition[2] + 0.022,
      ],
      [0, 0, 0],
      [1, 1, 1],
      `fluid-${kind}-status-lens-bezel`,
    );
    const statusHood = add(
      new RoundedBoxGeometry(
        kind === "fluidProcessor" ? 0.15 : 0.19,
        0.035,
        0.08,
        2,
        0.012,
      ),
      this.materials.steelDark,
      [
        statusPosition[0],
        statusPosition[1] + (kind === "fluidProcessor" ? 0.08 : 0.1),
        statusPosition[2] + 0.002,
      ],
      [0, 0, 0],
      [1, 1, 1],
      `fluid-${kind}-status-weather-hood`,
    );
    if (kind === "fluidProcessor") {
      statusConsole.visible = false;
      status.visible = false;
      statusBezel.visible = false;
      statusHood.visible = false;
      statusConsole.userData.retiredReason =
        "processor state is expressed through the connected relief train and process header";
      status.userData.retiredReason =
        "processor state is expressed through the connected relief train and process header";
    }
    let statusLight: THREE.PointLight | undefined;
    if (statusLight) {
      statusLight.name = "fluid-processor-operational-contact-light";
      statusLight.position.copy(status.position);
      statusLight.position.y += 0.08;
      root.add(statusLight);
    }
    // Thin access steel remains physically authored but does not cast the
    // long, aliased slab shadows that can visually replace its open rungs at
    // an orthographic gameplay angle. Machine masses and process pipework
    // continue to cast normally.
    const nonShadowingAccessNames = [
      "fluid-source-load-skid",
      "fluid-source-a-frame",
      "fluid-source-frame-gusset",
      "fluid-source-walking-beam-ladder",
      "fluid-processor-service-frame",
      "fluid-processor-service-catwalk",
      "fluid-processor-catwalk",
      "fluid-processor-access-ladder",
    ];
    root.traverse((object) => {
      if (
        object instanceof THREE.Mesh &&
        nonShadowingAccessNames.some((name) =>
          object.name.startsWith(name),
        )
      ) {
        object.castShadow = false;
      }
    });
    this.machineRoot.add(root);
    return {
      kind,
      root,
      ownedGeometries,
      ...(rotor ? { rotor } : {}),
      ...(secondaryRotor ? { secondaryRotor } : {}),
      ...(actuator ? { actuator } : {}),
      ...(polishedRod ? { polishedRod } : {}),
      ...(pitmanArm ? { pitmanArm } : {}),
      ...(bridleRods.length > 0 ? { bridleRods } : {}),
      ...(bridleCarrier ? { bridleCarrier } : {}),
      ...(processStageIndicators.length > 0
        ? { processStageIndicators }
        : {}),
      ...(processFeedSlug ? { processFeedSlug } : {}),
      ...(processProductSlug ? { processProductSlug } : {}),
      ...(reliefSpring ? { reliefSpring } : {}),
      ...(tankPressureSprings.length > 0
        ? { tankPressureSprings }
        : {}),
      ...(tankVentCaps.length > 0 ? { tankVentCaps } : {}),
      ...(valveHandles.length > 0 ? { valveHandles } : {}),
      ...(gaugeNeedles.length > 0 ? { gaugeNeedles } : {}),
      ...(heatWindows.length > 0 ? { heatWindows } : {}),
      ...(reliefCap ? { reliefCap } : {}),
      ...(sight ? { sight } : {}),
      ...(sightMirrors.length > 0 ? { sightMirrors } : {}),
      ...(sightFrame ? { sightFrame } : {}),
      ...(levelIndicator ? { levelIndicator } : {}),
      ...(levelNeedle ? { levelNeedle } : {}),
      ...(roofLevelDisc ? { roofLevelDisc } : {}),
      ...(inputSight ? { inputSight } : {}),
      ...(outputSight ? { outputSight } : {}),
      ...(inputSightMirrors.length > 0 ? { inputSightMirrors } : {}),
      ...(outputSightMirrors.length > 0 ? { outputSightMirrors } : {}),
      ...(steamPlumes.length > 0 ? { steamPlumes } : {}),
      ...(pressureValve ? { pressureValve } : {}),
      ...(shutdownGate ? { shutdownGate } : {}),
      ...(statusLight ? { statusLight } : {}),
      ...(heatLight ? { heatLight } : {}),
      status,
    };
  }

  private updateSight(
    rig: FluidRig,
    entity: FluidVisualEntity,
    network: FluidNetworkSnapshot,
  ): void {
    if (
      entity.kind === "fluidProcessor" &&
      rig.inputSight &&
      rig.outputSight
    ) {
      const updateProcessWindow = (
        level: THREE.Mesh,
        box: FluidEntityState["input"],
        expectedFluid: FluidId,
        custodySource: string,
        pressureHeld = false,
      ): number => {
        if (!box) return 0;
        const fill =
          box.capacityMilli <= 0
            ? 0
            : THREE.MathUtils.clamp(
                box.amountMilli / box.capacityMilli,
                0,
                1,
              );
        const fluidId = box.fluidId ?? expectedFluid;
        level.visible = box.amountMilli > 0;
        level.material =
          fluidId === "refinedFuel"
            ? this.materials.refined
            : this.materials.crude;
        const baseY = Number(level.userData.baseY ?? 0.4);
        const fullHeight = Number(level.userData.fullHeight ?? 0.54);
        level.scale.y = Math.max(0.001, fill);
        level.position.y = baseY + (fullHeight * fill) / 2;
        level.userData.fillRatio = fill;
        level.userData.fluidId = box.fluidId ?? null;
        level.userData.amountMilli = box.amountMilli;
        level.userData.capacityMilli = box.capacityMilli;
        level.userData.custodySource = custodySource;
        level.userData.operatingState = pressureHeld
          ? "pressure-held"
          : "moving-custody";
        return fill;
      };
      let inputFill = 0;
      for (const level of [
        rig.inputSight,
        ...(rig.inputSightMirrors ?? []),
      ]) {
        inputFill = updateProcessWindow(
          level,
          entity.fluidState.input,
          "crudeOil",
          "processor-input-buffer",
        );
      }
      const directOutput = entity.fluidState.output;
      const outputNode = network.nodes.find(
        (node) =>
          node.entityId === entity.id &&
          node.role === "output",
      );
      const outputTargets = network.nodes
        .filter(
          (
            node,
          ) =>
            node.entityId !== entity.id &&
            node.componentId === outputNode?.componentId &&
            node.fluidId === "refinedFuel",
        );
      const downstreamAmount = outputTargets.reduce(
        (total, node) => total + node.amountMilli,
        0,
      );
      const downstreamCapacity = outputTargets.reduce(
        (total, node) => total + node.capacityMilli,
        0,
      );
      const visibleOutput =
        directOutput && directOutput.amountMilli > 0
          ? directOutput
          : {
              ...(downstreamAmount > 0
                ? { fluidId: "refinedFuel" as const }
                : {}),
              amountMilli: downstreamAmount,
              capacityMilli: Math.max(1, downstreamCapacity),
            };
      let outputFill = 0;
      const processorPressureHeld =
        entity.status === "blocked" ||
        entity.status === "outputFull";
      for (const level of [
        rig.outputSight,
        ...(rig.outputSightMirrors ?? []),
      ]) {
        outputFill = updateProcessWindow(
          level,
          visibleOutput,
          "refinedFuel",
          directOutput && directOutput.amountMilli > 0
            ? "processor-output-buffer"
            : "authoritative-downstream-custody",
          processorPressureHeld,
        );
      }
      if (rig.sightFrame) {
        rig.sightFrame.userData.fillRatio = outputFill;
        rig.sightFrame.userData.inputFillRatio = inputFill;
        rig.sightFrame.userData.fluidId =
          entity.fluidState.output?.fluidId ?? null;
      }
      return;
    }
    if (!rig.sight) return;
    const fluid = fluidOf(entity);
    const fill =
      fluid.capacity <= 0
        ? 0
        : THREE.MathUtils.clamp(fluid.amount / fluid.capacity, 0, 1);
    const visibleLevels = [rig.sight, ...(rig.sightMirrors ?? [])];
    for (const level of visibleLevels) {
      const baseY = Number(
        level.userData.baseY ??
          (entity.kind === "fluidTank" ? 0.31 : 0.42),
      );
      const fullHeight = Number(
        level.userData.fullHeight ??
          (entity.kind === "fluidTank" ? 1 : 0.72),
      );
      level.visible =
        !Boolean(level.userData.presentationRetired) &&
        Boolean(fluid.id) &&
        fill > 0;
      level.material =
        fluid.id === "refinedFuel"
          ? this.materials.refined
          : this.materials.crude;
      level.scale.y = Math.max(0.001, fill);
      level.position.y = baseY + (fullHeight * fill) / 2;
      level.userData.fillRatio = fill;
      level.userData.fluidId = fluid.id ?? null;
      level.userData.amountMilli = fluid.amount;
      level.userData.capacityMilli = fluid.capacity;
      level.userData.operatingState =
        fill >= 0.985
          ? "pressure-held-full"
          : fill > 0
            ? "custody-rising"
            : "empty";
    }
    if (rig.levelIndicator) {
      rig.levelIndicator.material =
        fill >= 0.985
          ? this.materials.safetyPaint
          : fill > 0
            ? this.materials.copper
            : this.materials.weld;
      rig.levelIndicator.visible = true;
      rig.levelIndicator.userData.fillRatio = fill;
      rig.levelIndicator.userData.fluidId = fluid.id ?? null;
      rig.levelIndicator.userData.operatingState =
        fill >= 0.985 ? "pressure-held-full" : "available-capacity";
      rig.levelIndicator.userData.presentation =
        "mechanical-level-gauge-bezel";
    }
    if (rig.levelNeedle) {
      rig.levelNeedle.rotation.y =
        THREE.MathUtils.lerp(-Math.PI * 0.7, Math.PI * 0.7, fill);
      rig.levelNeedle.userData.fillRatio = fill;
    }
    if (rig.roofLevelDisc) {
      const floatRadius = 0.18 + Math.sqrt(fill) * 0.82;
      rig.roofLevelDisc.visible = Boolean(fluid.id) && fill > 0;
      rig.roofLevelDisc.material =
        fluid.id === "refinedFuel"
          ? this.materials.refined
          : this.materials.crude;
      rig.roofLevelDisc.scale.set(floatRadius, 1, floatRadius);
      rig.roofLevelDisc.userData.fillRatio = fill;
      rig.roofLevelDisc.userData.fluidId = fluid.id ?? null;
      rig.roofLevelDisc.userData.operatingState =
        fill >= 0.985
          ? "full-and-pressure-held"
          : fill > 0
            ? "custody-rising"
            : "empty";
    }
    if (rig.sightFrame) {
      rig.sightFrame.userData.fillRatio = fill;
      rig.sightFrame.userData.fluidId = fluid.id ?? null;
    }
  }

  private loadAuthoredSurfaceMaps(): void {
    if (typeof document === "undefined") return;
    const loader = new THREE.TextureLoader();
    const load = (
      url: string,
      name: string,
      targets: readonly THREE.MeshStandardMaterial[],
      repeat: readonly [number, number],
    ): void => {
      const texture = loader.load(url, (loaded) => {
        if (this.disposed) {
          loaded.dispose();
          return;
        }
        loaded.name = name;
        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.wrapS = THREE.RepeatWrapping;
        loaded.wrapT = THREE.RepeatWrapping;
        loaded.repeat.set(...repeat);
        loaded.generateMipmaps = true;
        loaded.minFilter = THREE.LinearMipmapLinearFilter;
        loaded.magFilter = THREE.LinearFilter;
        loaded.needsUpdate = true;
        for (const material of targets) {
          material.map = loaded;
          material.needsUpdate = true;
        }
      });
      this.surfaceTextures.push(texture);
    };
    const loadBump = (
      url: string,
      name: string,
      targets: readonly THREE.MeshStandardMaterial[],
      repeat: readonly [number, number],
    ): void => {
      const texture = loader.load(url, (loaded) => {
        if (this.disposed) {
          loaded.dispose();
          return;
        }
        loaded.name = name;
        loaded.colorSpace = THREE.NoColorSpace;
        loaded.wrapS = THREE.RepeatWrapping;
        loaded.wrapT = THREE.RepeatWrapping;
        loaded.repeat.set(...repeat);
        loaded.generateMipmaps = true;
        loaded.minFilter = THREE.LinearMipmapLinearFilter;
        loaded.magFilter = THREE.LinearFilter;
        loaded.needsUpdate = true;
        for (const material of targets) {
          material.bumpMap = loaded;
          material.bumpScale = 0.028;
          material.needsUpdate = true;
        }
      });
      this.surfaceTextures.push(texture);
    };
    load(
      "/assets/cinder-machine-panel-v2.jpg",
      "fluid-authored-service-grating-wear",
      [
        this.materials.serviceFloor,
      ],
      [2.4, 2.4],
    );
    load(
      "/assets/cinder-machine-surface-v1.png",
      "fluid-authored-brushed-machine-wear",
      [
        this.materials.steel,
        this.materials.structuralMid,
        this.materials.nozzleSteel,
        this.materials.weld,
      ],
      [2.1, 2.1],
    );
    load(
      "/assets/cinder-copper-aged-v1.jpg",
      "fluid-authored-copper-patina",
      [
        this.materials.copper,
        this.materials.brass,
        this.materials.rust,
        this.materials.heatOxide,
        this.materials.safetyPaint,
      ],
      [1.7, 1.7],
    );
    load(
      "/assets/cinder-ceramic-aged-v1.jpg",
      "fluid-authored-ceramic-wear",
      [
        this.materials.foundation,
        this.materials.steelDark,
        this.materials.ceramic,
        this.materials.gaugeFace,
      ],
      [1.25, 1.25],
    );
    load(
      "/assets/cinder-rail-ballast-aged-v2.png",
      "fluid-authored-dark-refinery-yard-aggregate",
      [this.materials.yardAggregate],
      [0.42, 0.42],
    );
    load(
      "/assets/cinder-painted-steel-aged-v2.png",
      "fluid-authored-painted-steel-aged-v2",
      [
        this.materials.paintedSteel,
        this.materials.enamel,
      ],
      [1.8, 1.8],
    );
    loadBump(
      "/assets/cinder-machine-surface-v1.png",
      "fluid-authored-industrial-micro-roughness",
      [
        this.materials.steel,
        this.materials.paintedSteel,
        this.materials.oxidizedSteel,
        this.materials.enamel,
      ],
      [3.2, 3.2],
    );
  }

  private assertLive(): void {
    if (this.disposed) {
      throw new Error("Fluid renderer is disposed.");
    }
  }
}
