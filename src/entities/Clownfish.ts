import * as THREE from 'three';
import { fishMaterial } from '../render/materials';
import { View } from '../render/View';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import { SEA_SURFACE } from '../water/Water';
import { fishGeometry } from './fishModels';
import { swapToFish } from './creatureAssets';
import { habitatFit } from './Habitat';

/** A big anemone that a pair of clownfish lives in: where it stands and its scale. */
export interface AnemoneHost {
  x: number;
  z: number;
  s: number;
}

/** How far an anemone's tentacles reach from its middle, and a clownfish's length, at scale 1. */
const REACH = 0.2, LENGTH = 0.07;
/** Beyond this distance (squared) the fish are too small to see: neither moved nor drawn. */
const FAR2 = 42 * 42;

const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();

/**
 * Clownfish: two orange-and-white fish to each host anemone. They never leave it: each weaves
 * round and through the tentacles on its own wandering loop (the pair circling opposite ways),
 * rising and sinking among the tips. If the sea floor is reshaped so the anemone shrinks or goes,
 * its fish shrink or go with it.
 */
export class Clownfish {
  readonly mesh: THREE.InstancedMesh;
  /** How much of its full size each host has room for (0 = not there). */
  readonly fits: number[] = [];
  private base: number[] = [];
  private phase: number[] = [];
  private modelLen: number;
  private time = 0;

  constructor(private world: World, readonly hosts: AnemoneHost[], private top: number) {
    const geo = fishGeometry('clown', 'hi');
    geo.computeBoundingBox();
    this.modelLen = Math.max(0.01, geo.boundingBox!.max.z - geo.boundingBox!.min.z);
    const rng = new RNG(world.seed * 71 + 29);
    for (let i = 0; i < hosts.length * 2; i++) this.phase.push(rng.next());
    // Drawn after the sea's surface like the other reef fish, so their orange and white read
    // through the water instead of being greyed by it.
    const mat = fishMaterial(9, { transparent: true, opacity: 0.9 }, SEA_SURFACE);
    mat.depthWrite = false;
    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, hosts.length * 2));
    this.mesh.name = 'clownfish';
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    swapToFish('clownfish', this.modelLen, [this.mesh]);
    this.refresh();
  }

  /** The sea floor changed: work out again which anemones are there, and how big. */
  refresh(): void {
    this.hosts.forEach((h, i) => {
      this.fits[i] = habitatFit(this.world, h.x, h.z, this.top * h.s, 0.25 * h.s);
      this.base[i] = this.world.heightAt(h.x, h.z) - 0.02;
    });
  }

  /** Where fish `j` (0 or 1) of host `i` is at time `t`. */
  place(i: number, j: number, t: number, out = new THREE.Vector3()): THREE.Vector3 {
    const h = this.hosts[i], k = h.s * this.fits[i], ph = this.phase[i * 2 + j];
    const ang = ph * 6.283 + (j ? -1 : 1) * t * (0.7 + ph * 0.5) + 0.7 * Math.sin(t * 0.63 + ph * 11);
    const rad = REACH * k * (0.38 + 0.3 * Math.sin(t * 0.47 + ph * 23));
    const y = this.base[i] + this.top * k * (0.72 + 0.16 * Math.sin(t * 0.9 + ph * 31 + j * 2));
    return out.set(h.x + Math.cos(ang) * rad, Math.min(y, SEA_SURFACE - 0.06), h.z + Math.sin(ang) * rad);
  }

  update(dt: number): void {
    this.time += dt;
    let n = 0;
    for (let i = 0; i < this.hosts.length; i++) {
      const h = this.hosts[i];
      if (this.fits[i] <= 0 || View.dist2(h.x, this.base[i], h.z) > FAR2) continue;
      const scale = (LENGTH * h.s * this.fits[i]) / this.modelLen;
      for (let j = 0; j < 2; j++) {
        this.place(i, j, this.time, _p);
        this.place(i, j, this.time + 0.1, _n);
        // Nose along the way it is going (the model faces +z), tipped a little as it climbs or dives.
        const dx = _n.x - _p.x, dz = _n.z - _p.z;
        _e.set(-Math.atan2(_n.y - _p.y, Math.hypot(dx, dz) + 1e-4) * 0.6, Math.atan2(dx, dz), 0, 'YXZ');
        this.mesh.setMatrixAt(n++, _m.compose(_p, _q.setFromEuler(_e), _s.setScalar(scale)));
      }
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
