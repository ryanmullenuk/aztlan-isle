import * as THREE from 'three';
import { GeoBuilder, M, P } from './GeoBuilder';
import { stylisedMaterial } from './materials';
import { SEA_SURFACE } from '../water/Water';
import { RNG } from '../world/rng';
import type { World } from '../world/World';

type Fish = { cx: number; cz: number; r: number; a: number; speed: number; y: number; wig: number };

/**
 * The willow glade lake's freshwater fish (carp and golden orfe, not reef fish): a few small shoals
 * circling slowly just under the surface among the lily pads. One instanced mesh.
 */
export class LakeFish {
  readonly mesh: THREE.InstancedMesh | null = null;
  private fish: Fish[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);

  constructor(w: World) {
    const g = w.glade;
    if (!g) return;
    const rng = new RNG(w.seed * 13 + 29);
    // Deep enough all the way round the loop for a fish to swim under the surface.
    const deep = (x: number, z: number) => w.heightAt(x, z) < SEA_SURFACE - 0.22;
    for (let k = 0, shoals = 0; k < 120 && shoals < 4; k++) {
      const a0 = rng.range(0, Math.PI * 2), d0 = Math.sqrt(rng.next()) * (g.r + 2);
      const cx = g.x + Math.cos(a0) * d0, cz = g.z + Math.sin(a0) * d0, r = rng.range(0.9, 2.2);
      let ok = true;
      for (let j = 0; j < 12 && ok; j++) ok = deep(cx + Math.cos(j * 0.524) * (r + 0.3), cz + Math.sin(j * 0.524) * (r + 0.3));
      if (!ok) continue;
      shoals++;
      // Three or four fish to a shoal, following one another round, each its own pace and depth.
      const dir = rng.chance(0.5) ? 1 : -1, n = rng.int(3, 4), a = rng.range(0, Math.PI * 2);
      for (let f = 0; f < n; f++) {
        this.fish.push({ cx, cz, r: r + rng.range(-0.15, 0.15), a: a - f * dir * rng.range(0.28, 0.45), speed: dir * rng.range(0.32, 0.42) / r, y: SEA_SURFACE - rng.range(0.07, 0.13), wig: rng.range(0, 6.28) });
      }
    }
    if (!this.fish.length) return;
    const geo = fishGeometry(), mat = stylisedMaterial();
    const mesh = new THREE.InstancedMesh(geo, mat, this.fish.length);
    // Orange, gold and dusky olive.
    const tints = [0xffffff, 0xffd27a, 0x8a9a6a];
    this.fish.forEach((_, i) => mesh.setColorAt(i, new THREE.Color(tints[i % 3])));
    mesh.name = 'lake fish';
    mesh.frustumCulled = false;
    this.mesh = mesh;
    this.update(0);
  }

  update(time: number): void {
    const mesh = this.mesh;
    if (!mesh) return;
    this.fish.forEach((f, i) => {
      const a = f.a + time * f.speed, wob = Math.sin(time * 0.7 + f.wig) * 0.12;
      const x = f.cx + Math.cos(a) * (f.r + wob), z = f.cz + Math.sin(a) * (f.r + wob);
      // Facing along the circle, the body flexing a little side to side as it swims.
      const heading = Math.atan2(-Math.sin(a) * Math.sign(f.speed), Math.cos(a) * Math.sign(f.speed));
      this.e.set(0, heading + Math.sin(time * 6 + f.wig) * 0.12, 0, 'YXZ');
      mesh.setMatrixAt(i, this.m.compose(this.p.set(x, f.y, z), this.q.setFromEuler(this.e), this.s));
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
}

/** A small carp: a plump body tapering to a forked tail, a fin on its back, orange with a pale belly. */
function fishGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder(), body = new THREE.Color(0xf07a24), belly = new THREE.Color(0xf8d9a8);
  b.add(P.sphere(1, 1), { color: (p) => body.clone().lerp(belly, THREE.MathUtils.smoothstep(-p.y, -0.005, 0.02)) }, M.t(0, 0, 0, 0, 0, 0, 0.045, 0.034, 0.12));
  b.add(P.cone(0.035, 0.07, 4), { color: 0xe86a1c }, M.t(0, 0, -0.14, Math.PI / 2, 0, 0, 0.3, 1, 1));
  b.add(P.cone(0.018, 0.05, 3), { color: 0xd8601a }, M.t(0, 0.035, 0.0, -0.4, 0, 0, 0.4, 1, 1));
  return b.build();
}
