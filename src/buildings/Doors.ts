import * as THREE from 'three';
import { patchStylised } from '../render/materials';
import type { Door } from './models';
import type { Cloth } from './HomeProps';

/** What the doors and the washing need to know of a building. */
export interface Dwelling {
  id: number;
  x: number;
  z: number;
  angle: number;
  group: THREE.Group;
  doors?: Door[];
  cloths?: Cloth[];
  /** How far each of its doors stands open (0 shut .. 1 open), eased each frame. */
  doorOpen?: number[];
}

const _m = new THREE.Matrix4(), _l = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/** One instanced mesh that grows as needed and only uploads what changed. */
class Bits {
  readonly mesh: THREE.InstancedMesh;
  private cap: number;
  private n = 0;
  private dirty = false;
  private tint = false;

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, name: string) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    this.mesh.name = name;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
  }

  begin(): void {
    this.n = 0;
  }

  /** The next instance: its matrix (model space of the village) and colour. */
  put(m: THREE.Matrix4, color: number): void {
    if (this.n >= this.cap) this.grow();
    const a = this.mesh.instanceMatrix.array as Float32Array, o = this.n * 16, e = m.elements;
    for (let k = 0; k < 16; k++) {
      const v = Math.fround(e[k]);
      if (a[o + k] !== v) { a[o + k] = v; this.dirty = true; }
    }
    const c = this.mesh.instanceColor!.array as Float32Array, o3 = this.n * 3;
    _c.setHex(color);
    const r = Math.fround(_c.r), g = Math.fround(_c.g), b = Math.fround(_c.b);
    if (c[o3] !== r || c[o3 + 1] !== g || c[o3 + 2] !== b) { c[o3] = r; c[o3 + 1] = g; c[o3 + 2] = b; this.tint = true; }
    this.n++;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (this.dirty) this.mesh.instanceMatrix.needsUpdate = true;
    if (this.tint) this.mesh.instanceColor!.needsUpdate = true;
    this.dirty = this.tint = false;
  }

  get count(): number {
    return this.n;
  }

  private grow(): void {
    const cap = this.cap * 2;
    const m = new Float32Array(cap * 16), c = new Float32Array(cap * 3).fill(1);
    m.set(this.mesh.instanceMatrix.array as Float32Array);
    c.set(this.mesh.instanceColor!.array as Float32Array);
    this.mesh.instanceMatrix = new THREE.InstancedBufferAttribute(m, 16);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(c, 3);
    this.cap = cap;
    this.dirty = this.tint = true;
  }
}

/** A building's place in the village as a matrix (its group's position and facing). */
function placeOf(b: Dwelling, out: THREE.Matrix4): THREE.Matrix4 {
  return out.compose(b.group.position, _q.setFromAxisAngle(UP, b.angle), _s.set(1, 1, 1));
}

/** A unit box with the attributes the stylised material reads (white, rigid). */
function unitBox(): THREE.BufferGeometry {
  // Hinged at its left edge, standing on its foot.
  const g = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0);
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  g.setAttribute('aVeg', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

/**
 * Every door in the village, in one draw. A timber door swings out on its hinge by day and is
 * pulled to at night; a hut's door curtain is rolled up under the lintel by day and let down at
 * night. Each house keeps its own hours (so the village shuts up one door at a time), empty
 * houses stay shut, and everyone shuts the door against the rain.
 */
export class Doors {
  private bits = new Bits(unitBox(), patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }), 0.35, false), 128, 'Doors');
  get mesh(): THREE.InstancedMesh {
    return this.bits.mesh;
  }

  /** How deep into the night (0..1) this house shuts its door. */
  static shutAt(id: number): number {
    const h = Math.sin(id * 53.3 + 7.7) * 43758.5453;
    return 0.3 + (h - Math.floor(h)) * 0.5;
  }

  /**
   * `shown` says whether a building's doors are drawn at all (it is standing and finished), and
   * `lived` whether anyone is about to open them. Doors ease open and shut over about a second.
   */
  update(list: readonly Dwelling[], dt: number, night: number, raining: boolean, shown: (b: Dwelling) => boolean, lived: (b: Dwelling) => boolean): void {
    this.bits.begin();
    const step = Math.min(1, Math.max(0, dt) * 1.4);
    for (const b of list) {
      const doors = b.doors;
      if (!doors?.length || !shown(b)) continue;
      const want = !raining && night < Doors.shutAt(b.id) && lived(b) ? 1 : 0;
      const open = (b.doorOpen ??= doors.map(() => want));
      placeOf(b, _m);
      for (let k = 0; k < doors.length; k++) {
        const d = doors[k];
        // The second door of a big house follows a moment behind the first.
        const o = (open[k] = open[k] === undefined ? want : open[k] + Math.sign(want - open[k]) * Math.min(Math.abs(want - open[k]), step * (k ? 0.7 : 1)));
        const e = o * o * (3 - 2 * o);
        if (d.curtain) {
          // Rolled up into a bundle under the lintel, or hanging to the floor.
          const h = d.h * (1 - 0.84 * e);
          _l.compose(_p.set(d.x - d.w / 2, d.y + d.h - h, d.z), _q.identity(), _s.set(d.w, h, 0.012 + 0.04 * e));
        } else {
          // Shut, it stands a little proud of its frame (walls are hand-built and never quite true).
          _l.compose(_p.set(d.x - d.w / 2, d.y, d.z + 0.012 * (1 - e)), _q.setFromAxisAngle(UP, -e * 1.9), _s.set(d.w, d.h, 0.05 - 0.028 * e));
        }
        this.bits.put(_l.premultiply(_m), d.color);
      }
    }
    this.bits.end();
  }
}

/** One cloth: a small panel hanging from its top edge, limp at the line and free at the hem. */
function clothGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, 2, 3).translate(0, -0.5, 0);
  const P = g.getAttribute('position'), n = P.count;
  const col = new Float32Array(n * 3), veg = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const down = -P.getY(i), edge = Math.abs(P.getX(i)) * 2;
    // Folds: a shade darker toward the hem and the edges.
    const shade = 1 - 0.16 * down - 0.08 * edge * edge;
    col.set([shade, shade, shade], i * 3);
    // The hem swings most; a slight belly so it is not a flat card.
    veg.set([down * down * 0.9, 0.95], i * 2);
    P.setZ(i, -0.035 * down * (1 - edge * edge * 0.6));
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aVeg', new THREE.BufferAttribute(veg, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * All the village's washing, in one draw: cloths pegged along the lines beside homes (the posts
 * and cords are part of each house's own model), stirring in the wind. It is taken in when it
 * rains and hung out again when the rain has passed.
 */
export class Washing {
  private bits = new Bits(clothGeometry(), patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }), 0.12), 256, 'Washing');
  /** How much of the washing is out (0 taken in .. 1 all hung). */
  private out = 1;
  get mesh(): THREE.InstancedMesh {
    return this.bits.mesh;
  }

  update(list: readonly Dwelling[], dt: number, raining: boolean, shown: (b: Dwelling) => boolean): void {
    this.out = Math.min(1, Math.max(0, this.out + (raining ? -1 : 1) * Math.max(0, dt) * 0.35));
    this.bits.begin();
    if (this.out > 0.01) {
      for (const b of list) {
        const cloths = b.cloths;
        if (!cloths?.length || !shown(b)) continue;
        placeOf(b, _m);
        for (let k = 0; k < cloths.length; k++) {
          const c = cloths[k];
          // Taken in one by one: each cloth is gathered up to the line in its turn.
          const mine = Math.min(1, Math.max(0, this.out * 1.6 - ((b.id * 7 + k * 3) % 10) * 0.06));
          if (mine <= 0.02) continue;
          _l.compose(_p.set(c.x, c.y, c.z), _q.setFromAxisAngle(UP, c.ry), _s.set(c.w, c.h * mine, 1));
          this.bits.put(_l.premultiply(_m), c.color);
        }
      }
    }
    this.bits.end();
  }
}
