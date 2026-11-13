import * as THREE from 'three';
import { patchStylised } from '../render/materials';
import { View } from '../render/View';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import { bakeCreature, loadCreature } from './creatureAssets';

/** Tuning for the bumblebees. */
export const BUMBLEBEES = {
  /** How many at most (fewer on an island with few flowers). */
  max: 16,
  /** Nose-to-tail length in world units (an islander is ~0.62 tall). */
  length: 0.07,
  /** Simulate and draw only bees this close to the camera. */
  drawDistance: 45,
  /** Dart away from the cursor within this ground distance. */
  fleeRadius: 0.8,
  /** How far a bee looks for its next flower. */
  reach: 6,
  /** Bloom height above the ground when the flower doesn't say. */
  top: 0.3,
};

/** A flower to visit: x, z and (optionally) the height of its bloom above the ground. */
export interface BeeFlower {
  x: number;
  z: number;
  top?: number;
}

const enum S {
  /** Hovering at a flower, meandering slowly round its bloom. */
  Sip = 0,
  /** Flying fast to the next flower. */
  Travel = 1,
}

interface Bee {
  /** The flower it is at or heading for. */
  at: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  state: S;
  timer: number;
  /** Noise phase, size and whether it is fleeing (seconds left). */
  ph: number;
  size: number;
  flee: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function wrap(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** A stand-in bee (a fuzzy yellow and black lozenge) drawn until the model loads. */
function standInGeometry(): THREE.BufferGeometry {
  const g = new THREE.OctahedronGeometry(1, 1);
  g.scale(0.022, 0.02, BUMBLEBEES.length / 2);
  const P = g.getAttribute('position');
  const col = new Float32Array(P.count * 3);
  for (let i = 0; i < P.count; i++) {
    // Black head and tail tip, a yellow band in the middle.
    const band = Math.abs(P.getZ(i)) < BUMBLEBEES.length * 0.18;
    col.set(band ? [1, 0.78, 0.15] : [0.08, 0.07, 0.06], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Two frames of the model's Fly clip (wings out and wings raised), each centred on its body so
 * they line up, at unit size (`length` nose to tail; instances scale it).
 */
async function modelFrames(): Promise<[THREE.BufferGeometry, THREE.BufferGeometry]> {
  const asset = await loadCreature('bumblebee');
  const frame = (time: number) => {
    const g = bakeCreature(asset, { clip: 'Fly', time, length: BUMBLEBEES.length, centreY: true });
    // Centre on the mean vertex height (the body dominates it), not the wings' reach.
    const P = g.getAttribute('position');
    let y = 0;
    for (let i = 0; i < P.count; i++) y += P.getY(i);
    g.translate(0, -y / Math.max(1, P.count), 0);
    g.computeBoundingSphere();
    return g;
  };
  return [frame(0.15), frame(0.45)];
}

/**
 * Bumblebees buzzing between flowering bushes by day: a meandering hover round one bloom, then a
 * quick dash to another nearby. Gone at night and in the rain; they dart off from the cursor.
 *
 * Bees are tiny and their wings a blur, so rather than a rig each, the model's Fly clip is baked
 * into two poses (wings out, wings raised) drawn as two instanced meshes: each bee swaps between
 * them every frame, which reads as a buzzing blur for two draw calls in all.
 */
export class Bumblebees {
  readonly group = new THREE.Group();
  private meshes: [THREE.InstancedMesh, THREE.InstancedMesh];
  private flowers: { x: number; z: number; y: number }[] = [];
  /** Per flower, the other flowers within reach. */
  private near: number[][] = [];
  private list: Bee[] = [];
  private rng: RNG;
  private t = 0;
  private frame = 0;
  /** True once the model's two frames are in (until then only the stand-in mesh draws). */
  private modelled = false;
  /** 0..1: how many are out (daylight, no rain), eased. */
  private presence = 1;

  /** @param flowers flowering bushes (and wildflowers) to visit */
  constructor(private world: World, flowers: BeeFlower[]) {
    this.rng = new RNG(world.seed * 613 + 97);
    this.spawn(flowers);
    const n = Math.max(1, this.list.length);
    const mat = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide }), 0.5);
    const stand = standInGeometry();
    const make = () => {
      const m = new THREE.InstancedMesh(stand, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
      m.count = 0;
      this.group.add(m);
      return m;
    };
    this.meshes = [make(), make()];
    if (typeof document !== 'undefined') {
      modelFrames().then(([a, b]) => {
        this.meshes[0].geometry = a;
        this.meshes[1].geometry = b;
        this.modelled = true;
      }).catch(() => undefined);
    }
  }

  get count(): number {
    return this.list.length;
  }

  private spawn(flowers: BeeFlower[]): void {
    const w = this.world, rng = this.rng;
    for (const f of flowers) {
      const i = w.cellIndexAt(f.x, f.z);
      if (i < 0 || !w.isLandCell(i)) continue;
      this.flowers.push({ x: f.x, z: f.z, y: w.heightAt(f.x, f.z) + (f.top ?? BUMBLEBEES.top) + 0.03 });
    }
    const F = this.flowers, r2 = BUMBLEBEES.reach * BUMBLEBEES.reach;
    // Neighbours by a coarse grid (flowers can number in the hundreds).
    const cell = BUMBLEBEES.reach, grid = new Map<string, number[]>();
    const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    F.forEach((f, k) => {
      const kk = key(f.x, f.z);
      let l = grid.get(kk);
      if (!l) grid.set(kk, (l = []));
      l.push(k);
    });
    for (let k = 0; k < F.length; k++) {
      const f = F[k], out: number[] = [];
      const gx = Math.floor(f.x / cell), gz = Math.floor(f.z / cell);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        for (const o of grid.get(`${gx + dx},${gz + dz}`) ?? []) {
          if (o !== k && (F[o].x - f.x) ** 2 + (F[o].z - f.z) ** 2 < r2) out.push(o);
        }
      }
      this.near.push(out);
    }
    if (!F.length) return;
    // Favour flowers with company, so bees work a patch rather than a lone bush.
    const n = Math.min(BUMBLEBEES.max, Math.max(4, Math.round(F.length / 5)));
    for (let k = 0, tries = 0; k < n && tries < n * 6; tries++) {
      const at = Math.floor(rng.next() * F.length);
      if (this.near[at].length === 0 && tries < n * 4) continue;
      const f = F[at];
      this.list.push({
        at, x: f.x + rng.range(-0.1, 0.1), y: f.y + rng.range(0, 0.1), z: f.z + rng.range(-0.1, 0.1), heading: rng.range(0, Math.PI * 2),
        state: S.Sip, timer: rng.range(0.5, 4), ph: rng.range(0, 100), size: rng.range(0.85, 1.15), flee: 0,
      });
      k++;
    }
  }

  /** The next flower: a neighbour if it has any (any flower when fleeing far), else stay put. */
  private next(b: Bee, far: boolean): void {
    const n = this.near[b.at];
    if (far || !n.length) {
      if (far && this.flowers.length > 1) b.at = Math.floor(this.rng.next() * this.flowers.length);
      else if (n.length) b.at = n[Math.floor(this.rng.next() * n.length)];
    } else b.at = n[Math.floor(this.rng.next() * n.length)];
    b.state = S.Travel;
    b.timer = 12;
  }

  /**
   * Same inputs as Butterflies.update. dt: game step (frozen while paused); realDt: wall-clock
   * step (for fading); day: 0 night .. 1 daylight; cursor: the ground point under the pointer, or null.
   */
  update(dt: number, realDt: number, day: number, raining: boolean, cursor: THREE.Vector3 | null): void {
    const want = raining ? 0 : THREE.MathUtils.smoothstep(day, 0.35, 0.65);
    this.presence += (want - this.presence) * Math.min(1, realDt * 0.5);
    const [A, B] = this.meshes;
    if (this.presence < 0.02 || !this.list.length) {
      this.group.visible = false;
      A.count = B.count = 0;
      return;
    }
    this.group.visible = true;
    const step = Math.min(dt, realDt * 1.2, 0.1);
    this.t += step;
    if (step > 0) this.frame++;
    const far2 = BUMBLEBEES.drawDistance * BUMBLEBEES.drawDistance;
    const fr2 = BUMBLEBEES.fleeRadius * BUMBLEBEES.fleeRadius;
    const pres = this.presence;
    const arrA = A.instanceMatrix.array as Float32Array, arrB = B.instanceMatrix.array as Float32Array;
    let na = 0, nb = 0;
    for (let k = 0; k < this.list.length; k++) {
      const b = this.list[k];
      const d2 = View.dist2(b.x, b.y, b.z);
      if (d2 > far2) continue;
      const out = THREE.MathUtils.clamp(pres * 2.2 - ((k * 0.618) % 1) * 1.2, 0, 1);
      if (out <= 0) continue;
      if (step > 0) this.step(b, step, cursor, fr2);
      if (!View.sees(b.x, b.y, b.z, 0.1)) continue;
      // A fat body droning along: a slight nose-up hover, banked into turns when travelling.
      const travel = b.state === S.Travel;
      _p.set(b.x, b.y + Math.sin(this.t * 23 + b.ph) * 0.003, b.z);
      _e.set(travel ? 0.1 : -0.15 + Math.sin(this.t * 1.3 + b.ph) * 0.08, b.heading, 0);
      _q.setFromEuler(_e);
      _s.setScalar(b.size * out);
      _m.compose(_p, _q, _s);
      // Wings flicker between the two baked poses, out of step from bee to bee.
      if (this.modelled && ((this.frame + k) & 1)) _m.toArray(arrB, nb++ * 16);
      else _m.toArray(arrA, na++ * 16);
    }
    A.count = na;
    B.count = nb;
    if (na) A.instanceMatrix.needsUpdate = true;
    if (nb) B.instanceMatrix.needsUpdate = true;
  }

  private step(b: Bee, dt: number, cursor: THREE.Vector3 | null, fr2: number): void {
    const rng = this.rng, f = this.flowers[b.at];
    // Dart away from the cursor to a flower somewhere else.
    if (cursor && b.flee <= 0) {
      const cx = b.x - cursor.x, cz = b.z - cursor.z;
      if (cx * cx + cz * cz < fr2) {
        b.flee = 2;
        this.next(b, true);
      }
    }
    b.flee = Math.max(0, b.flee - dt);
    let tx: number, ty: number, tz: number, speed: number;
    if (b.state === S.Sip) {
      // A slow meander round the bloom, dipping in now and then.
      const a = this.t * 0.9 + b.ph;
      tx = f.x + Math.sin(a) * 0.08 + Math.sin(a * 2.3) * 0.04;
      tz = f.z + Math.cos(a * 1.3) * 0.08;
      ty = f.y + 0.03 + Math.sin(a * 1.7) * 0.03;
      speed = 0.12;
      b.timer -= dt;
      if (b.timer <= 0) {
        if (rng.chance(0.25)) b.timer = rng.range(1, 3);
        else this.next(b, false);
      }
    } else {
      tx = f.x;
      tz = f.z;
      const d = Math.hypot(f.x - b.x, f.z - b.z);
      // Rise a little over the gap, settling to the bloom height on arrival.
      ty = f.y + Math.min(0.4, d * 0.2);
      speed = b.flee > 0 ? 1.4 : 0.7;
      b.timer -= dt;
      if (d < 0.08 || b.timer <= 0) {
        b.state = S.Sip;
        b.timer = rng.range(1.5, 4.5);
      }
    }
    const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
    // A wobbling path: steer toward the target with a little noise in the heading.
    const wobble = Math.sin(this.t * 3.1 + b.ph) * 0.6 + Math.sin(this.t * 7.3 + b.ph * 1.7) * 0.3;
    if (d > 0.01) b.heading = wrap(b.heading + wrap(Math.atan2(dx, dz) + wobble * (b.state === S.Sip ? 1 : 0.35) - b.heading) * Math.min(1, dt * 6));
    const v = Math.min(speed, d * 3) * dt;
    b.x += Math.sin(b.heading) * v;
    b.z += Math.cos(b.heading) * v;
    b.y += (ty - b.y) * Math.min(1, dt * 3);
    const ground = this.world.heightAt(b.x, b.z) + 0.05;
    if (b.y < ground) b.y = ground;
  }
}
