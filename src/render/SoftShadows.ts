import * as THREE from 'three';

/**
 * Soft round shadows straight below, as if the sun were overhead: what islanders, animals, boats
 * and other small things use instead of sun shadows. The sun's shadow sits a step off a small
 * caster's base (its depth bias), which makes them look as if they hover; a soft dark patch under
 * them keeps them on the ground at any hour, and they cost the shadow pass nothing.
 * (Trees, buildings and the land itself keep their real sun shadows.)
 */

let material: THREE.MeshBasicMaterial | null = null;
let plane: THREE.PlaneGeometry | null = null;

/** The shared soft-edged dark disc (unit size, flat on the ground). */
function shared(): { mat: THREE.MeshBasicMaterial; geo: THREE.PlaneGeometry } {
  if (!material || !plane) {
    const R = 32, fade = new Uint8Array(R * R * 4);
    for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
      const d = Math.hypot(x + 0.5 - R / 2, y + 0.5 - R / 2) / (R / 2);
      // A dark core easing out to a soft edge.
      const k = Math.min(1, Math.max(0, (d - 0.35) / 0.65));
      fade[(y * R + x) * 4 + 3] = Math.round(255 * (1 - k * k * (3 - 2 * k)));
    }
    const tex = new THREE.DataTexture(fade, R, R);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    material = new THREE.MeshBasicMaterial({ color: 0x000000, map: tex, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  }
  return { mat: material, geo: plane };
}

/** Lifted this far off the ground (world units): the drawn ground sits a little above its height map in places. */
const LIFT = 0.04;

/** One soft shadow, for a single object (a child of it, at its feet). `w` across, `l` along its z. */
export function softShadowMesh(w: number, l = w): THREE.Mesh {
  const { mat, geo } = shared();
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(w, 1, l);
  m.position.y = LIFT;
  m.renderOrder = 4;
  return m;
}

const _m = new THREE.Matrix4(), _s = new THREE.Vector3();

/** Many soft shadows in one draw: begin(), add() each, end() (once per frame, like the other instanced meshes). */
export class SoftShadows {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;

  constructor(cap: number) {
    const { mat, geo } = shared();
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  begin(): void {
    this.n = 0;
  }

  /** A shadow on the ground at (x, y, z): `w` across, `l` along the heading `yaw`. */
  add(x: number, y: number, z: number, w: number, l = w, yaw = 0): void {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    _m.makeRotationY(yaw).scale(_s.set(w, 1, l)).setPosition(x, y + LIFT, z);
    this.mesh.setMatrixAt(this.n++, _m);
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (!this.n) return;
    const a = this.mesh.instanceMatrix;
    a.clearUpdateRanges();
    a.addUpdateRange(0, this.n * 16);
    a.needsUpdate = true;
  }
}

/** A soft shadow under a mesh's geometry (in its own units, at y = 0: a hull's waterline, a shell's base), a little wider than it. */
export function hullShadow(geo: THREE.BufferGeometry): THREE.Mesh {
  if (!geo.boundingBox) geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const m = softShadowMesh((b.max.x - b.min.x) * 1.35, (b.max.z - b.min.z) * 1.12);
  m.position.x = (b.min.x + b.max.x) / 2;
  m.position.z = (b.min.z + b.max.z) / 2;
  m.name = 'softShadow';
  return m;
}

/**
 * Soft shadows that follow another instanced mesh: one per instance, sharing its instance matrices
 * (so each sits under its plant, scaled and turned with it). `geo` is what it shades the ground under.
 * Keep `count` in step with the source's.
 */
export function followerShadows(source: THREE.InstancedMesh, geo: THREE.BufferGeometry): THREE.InstancedMesh {
  if (!geo.boundingBox) geo.computeBoundingBox();
  const b = geo.boundingBox!, { mat } = shared();
  const disc = new THREE.PlaneGeometry((b.max.x - b.min.x) * 1.3, (b.max.z - b.min.z) * 1.3)
    .rotateX(-Math.PI / 2)
    .translate((b.min.x + b.max.x) / 2, LIFT + 0.01, (b.min.z + b.max.z) / 2);
  const m = new THREE.InstancedMesh(disc, mat, 1);
  m.instanceMatrix = source.instanceMatrix;
  m.count = source.count;
  m.frustumCulled = false;
  m.renderOrder = 4;
  return m;
}
