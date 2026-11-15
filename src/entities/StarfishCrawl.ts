import * as THREE from 'three';
import type { World } from '../world/World';
import { STARFISH, habitatFit } from './Habitat';

interface StarSet {
  mesh: THREE.InstancedMesh;
  crawl: THREE.InstancedBufferAttribute;
  phase: THREE.InstancedBufferAttribute;
  homeX: Float32Array;
  homeZ: Float32Array;
  /** When each starfish next sets off (shader time). */
  next: Float64Array;
  version: number;
}

/**
 * Starfish creeping over the sand. Each lies still for a while, then creeps a hand's breadth in
 * some direction (never far from where it was put down), over and over.
 *
 * The motion itself is drawn by the habitat shader (`habitatMaterial(true, true)`): an instance's
 * matrix says where a stretch of crawling begins, `aCrawl` where it leads (following the seabed)
 * and when it began, and the shader eases the starfish along it and works its arms. So nothing is
 * written for a starfish while it moves or rests: only when it sets off again, a few times a
 * minute each, and at most `STARFISH.budget` of them in any one frame over the whole sea.
 */
export class StarfishCrawl {
  private sets: StarSet[] = [];
  private cursor = 0;
  private last = -Infinity;
  private seed: number;

  /** `blocked`: places a starfish must not creep into (under a reef, say). */
  constructor(private world: World, private blocked?: (x: number, z: number) => boolean, seed = 1) {
    this.seed = (seed * 2246822519) >>> 0 || 1;
  }

  private rnd(): number {
    return (this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  }

  private range(r: [number, number]): number {
    return r[0] + this.rnd() * (r[1] - r[0]);
  }

  /** The starfish geometry with one mesh's own per-instance attributes (the vertex buffers are shared). */
  private static wrap(base: THREE.BufferGeometry, set: { crawl: THREE.InstancedBufferAttribute; phase: THREE.InstancedBufferAttribute }): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setIndex(base.index);
    for (const [key, a] of Object.entries(base.attributes)) if (key !== 'aCrawl' && key !== 'aStar') g.setAttribute(key, a);
    g.setAttribute('aCrawl', set.crawl);
    g.setAttribute('aStar', set.phase);
    if (!base.boundingBox) base.computeBoundingBox();
    if (!base.boundingSphere) base.computeBoundingSphere();
    g.boundingBox = base.boundingBox!.clone();
    g.boundingSphere = base.boundingSphere!.clone();
    return g;
  }

  /** Take charge of a mesh of starfish (drawn with the starfish material). Call before its instances are fitted. */
  add(mesh: THREE.InstancedMesh): void {
    const n = mesh.instanceMatrix.count;
    const crawl = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    const phase = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    crawl.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) phase.array[i] = this.rnd();
    const set: StarSet = { mesh, crawl, phase, homeX: new Float32Array(n), homeZ: new Float32Array(n), next: new Float64Array(n), version: -1 };
    mesh.geometry = StarfishCrawl.wrap(mesh.geometry, set);
    // They wander off their matrices: keep the bounds (culling) wide enough for anywhere they may be.
    mesh.userData.habitatPad = STARFISH.roam * 2 + 0.3;
    this.sets.push(set);
  }

  /** Swap the shape every starfish is drawn with (the artist's model arriving). */
  setGeometry(base: THREE.BufferGeometry): void {
    for (const set of this.sets) set.mesh.geometry = StarfishCrawl.wrap(base, set);
  }

  /** Starfish under this crawler's care (drawn or not). */
  get size(): number {
    return this.sets.reduce((t, s) => t + s.mesh.count, 0);
  }

  /** Where starfish `i` of a mesh is at time `now`, as the shader draws it. */
  static positionAt(mesh: THREE.InstancedMesh, i: number, now: number, out = new THREE.Vector3()): THREE.Vector3 {
    const M = mesh.instanceMatrix.array, C = mesh.geometry.getAttribute('aCrawl').array, o = i * 16, c = i * 4;
    const len = Math.hypot(C[c], C[c + 2]);
    const p = len > 1e-4 ? THREE.MathUtils.clamp(((now - C[c + 3]) * STARFISH.speed) / len, 0, 1) : 1, e = p * p * (3 - 2 * p);
    return out.set(M[o + 12] + C[c] * e, M[o + 13] + C[c + 1] * e, M[o + 14] + C[c + 2] * e);
  }

  /** The instance list was rebuilt (terrain edit, detail level): everyone starts from where they were put. */
  private reset(set: StarSet, now: number): void {
    const M = set.mesh.instanceMatrix.array;
    set.crawl.array.fill(0);
    for (let i = 0; i < set.mesh.count; i++) {
      set.homeX[i] = M[i * 16 + 12];
      set.homeZ[i] = M[i * 16 + 14];
      set.next[i] = now + this.rnd() * STARFISH.pause[1];
    }
    set.crawl.needsUpdate = true;
    set.version = set.mesh.userData.habitatVersion ?? 0;
  }

  /** Starfish `i` has finished its stretch and rested: it sets off on the next. */
  private step(set: StarSet, i: number, now: number): void {
    const M = set.mesh.instanceMatrix.array, C = set.crawl.array, o = i * 16, c = i * 4;
    // It is now where the last stretch ended: that becomes its matrix.
    const x = M[o + 12] + C[c], y = M[o + 13] + C[c + 1], z = M[o + 14] + C[c + 2];
    M[o + 12] = x; M[o + 13] = y; M[o + 14] = z;
    C[c] = C[c + 1] = C[c + 2] = 0;
    C[c + 3] = now;
    set.next[i] = now + this.range(STARFISH.pause);
    const hx = set.homeX[i], hz = set.homeZ[i];
    const wide = Math.hypot(M[o], M[o + 1], M[o + 2]), tall = Math.hypot(M[o + 4], M[o + 5], M[o + 6]);
    for (let tries = 0; tries < 3; tries++) {
      const len = this.range(STARFISH.step);
      let a = this.rnd() * Math.PI * 2;
      let tx = x + Math.sin(a) * len, tz = z + Math.cos(a) * len;
      // Straying too far: head back towards home instead.
      if (Math.hypot(tx - hx, tz - hz) > STARFISH.roam) {
        a = Math.atan2(hx - x, hz - z) + (this.rnd() - 0.5) * 1.2;
        tx = x + Math.sin(a) * len; tz = z + Math.cos(a) * len;
        if (Math.hypot(tx - hx, tz - hz) > STARFISH.roam) continue;
      }
      // Only over sand it could have been put down on: open sea floor, gently sloping, well under the surface.
      if (this.blocked?.(tx, tz) || habitatFit(this.world, tx, tz, 0.05 * tall, STARFISH.reach * wide) < 0.999) continue;
      C[c] = tx - x;
      C[c + 1] = this.world.heightAt(tx, tz) - 0.02 - y;
      C[c + 2] = tz - z;
      set.next[i] += len / STARFISH.speed;
      break;
    }
    set.mesh.instanceMatrix.needsUpdate = true;
    set.crawl.needsUpdate = true;
  }

  /**
   * Once a frame, with the shader's clock (`FX.uTime`). Sends off the starfish whose rest is over,
   * `budget` at most; the meshes hidden for distance are left alone. Returns how many set off.
   */
  update(now: number, budget = STARFISH.budget): number {
    // The clock went back (a loaded game): begin again.
    if (now < this.last) for (const s of this.sets) s.version = -1;
    this.last = now;
    let done = 0;
    const n = this.sets.length;
    for (let k = 0; k < n; k++) {
      const at = (this.cursor + k) % n, set = this.sets[at];
      if (set.version !== (set.mesh.userData.habitatVersion ?? 0)) this.reset(set, now);
      if (!set.mesh.visible) continue;
      for (let i = 0; i < set.mesh.count; i++) {
        if (set.next[i] > now) continue;
        if (done >= budget) { this.cursor = at; return done; }
        this.step(set, i, now);
        done++;
      }
    }
    return done;
  }
}
