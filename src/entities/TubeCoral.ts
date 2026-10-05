import * as THREE from 'three';
import { GeoBuilder, M, P } from '../render/GeoBuilder';
import { patchStylised } from '../render/materials';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import { SEA_SURFACE } from '../water/Water';

const COL = {
  base: new THREE.Color(0x48107e),
  tip: new THREE.Color(0x9a3fe0),
  rim: new THREE.Color(0xdba2ff),
  hole: new THREE.Color(0x1c0530),
};
/** Height of a cluster's tallest tube at scale 1. */
const TALL = 0.62;

/**
 * Purple tube coral: two clumps of fat, hollow tubes leaning out from their bases, violet low down
 * and pale lilac at the tips, each open mouth a pale rim round a dark hole.
 */
export function tubeCoralGeometry(seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  const clumps = [[-0.13, 0.02], [0.14, -0.04]];
  for (const [cx, cz] of clumps) {
    const n = rng.int(5, 8);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
      const off = k === 0 ? 0 : rng.range(0.05, 0.11);
      const r = rng.range(0.05, 0.075);
      const h = (k === 0 ? rng.range(0.5, 0.62) : rng.range(0.22, 0.5)) * TALL / 0.62;
      // Leaning out from the middle of the clump, the outer ones more.
      const lean = k === 0 ? rng.range(0, 0.12) : rng.range(0.25, 0.6);
      const rx = Math.sin(a) * lean, rz = -Math.cos(a) * lean;
      const base = M.t(cx + Math.cos(a) * off, -0.02, cz + Math.sin(a) * off, rx, 0, rz);
      b.add(P.cyl(r, r * 1.12, h, 9), { color: (p) => COL.base.clone().lerp(COL.tip, Math.min(1, Math.max(0, p.y / TALL) * 0.95)), sway: 0.02 }, base.clone().multiply(M.t(0, h / 2, 0)));
      // The mouth: a pale lip round a dark hollow.
      b.add(P.torus(r * 0.82, r * 0.28, 5, 12), { color: COL.rim, sway: 0.03 }, base.clone().multiply(M.t(0, h, 0, Math.PI / 2, 0, 0)));
      b.add(P.cyl(r * 0.66, r * 0.66, 0.006, 9), { color: COL.hole }, base.clone().multiply(M.t(0, h + 0.002, 0)));
    }
  }
  return b.build();
}

/**
 * Clusters of purple tube coral in the shallows round the island and round the rocks standing in
 * the sea (sea rocks, shore rocks, the sea stacks), always under the surface. Decoration only:
 * nothing steers round them.
 */
export class TubeCoral {
  readonly group = new THREE.Group();
  /** Where each cluster stands (for tests). */
  readonly spots: { x: number; z: number; s: number }[] = [];

  /** @param rocks rocks in the sea that coral grows round (centre and radius). */
  constructor(private world: World, rocks: { x: number; z: number; r: number }[]) {
    const w = world;
    const rng = new RNG(w.seed * 53 + 29);
    /** Sea floor depth that suits it, and the scale that keeps its tips under the water there. */
    const fit = (x: number, z: number): number => {
      const i = w.cellIndexAt(x, z);
      if (i < 0 || w.layer[i] > 0 || !Number.isNaN(w.riverY[i]) || w.canal[i]) return 0;
      const bed = w.heightAt(x, z);
      if (bed > -0.3 || bed < -1.25) return 0;
      // Tips just under the surface, where the water hardly dulls their colour.
      const room = (SEA_SURFACE - 0.1 - bed) / TALL;
      return room >= 0.55 ? Math.min(room, rng.range(1.1, 1.8)) : 0;
    };
    const near = (x: number, z: number, d: number) => this.spots.some((p) => Math.hypot(p.x - x, p.z - z) < d);
    // Round the rocks: a few clusters each, tucked in close.
    for (const r of rocks) {
      const n = rng.int(1, 4);
      for (let k = 0, tries = 0; k < n && tries < 12; tries++) {
        const a = rng.range(0, Math.PI * 2), d = r.r + rng.range(0.25, 1.8);
        const x = r.x + Math.cos(a) * d, z = r.z + Math.sin(a) * d;
        const s = fit(x, z);
        if (!s || near(x, z, 0.75)) continue;
        this.spots.push({ x, z, s });
        k++;
      }
    }
    // Scattered through the shallows.
    for (let tries = 0, made = 0; tries < 9000 && made < 140; tries++) {
      const x = w.centerX(rng.int(2, w.N - 3)) + rng.range(-0.5, 0.5), z = w.centerZ(rng.int(2, w.N - 3)) + rng.range(-0.5, 0.5);
      const s = fit(x, z);
      if (!s || near(x, z, 2.5)) continue;
      this.spots.push({ x, z, s });
      made++;
      // Often a second close by.
      if (rng.chance(0.5)) {
        const a = rng.range(0, 6.28), x2 = x + Math.cos(a) * rng.range(0.7, 1.4), z2 = z + Math.sin(a) * rng.range(0.7, 1.4);
        const s2 = fit(x2, z2);
        if (s2 && !near(x2, z2, 0.7)) this.spots.push({ x: x2, z: z2, s: s2 * 0.8 });
      }
    }
    // Clear water over each cluster (the sea shader lets more of the floor's colour through).
    for (const spot of this.spots) {
      const [cx, cz] = w.cellOf(spot.x, spot.z);
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        if (!w.inBounds(cx + dx, cz + dz)) continue;
        const d = Math.hypot(w.centerX(cx + dx) - spot.x, w.centerZ(cz + dz) - spot.z);
        const i = w.idx(cx + dx, cz + dz);
        w.clearWater[i] = Math.max(w.clearWater[i], THREE.MathUtils.clamp(1.3 - d / 1.6, 0, 1));
      }
    }
    const geos = [tubeCoralGeometry(11), tubeCoralGeometry(23), tubeCoralGeometry(37)];
    // A soft violet glow keeps them purple under the sea's teal tint (as they look in clear shallows).
    const mat = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, emissive: 0x3a0e66, emissiveIntensity: 0.3 }), 0.2);
    // Chunked so clusters off screen are culled.
    const CH = 24;
    const buckets = new Map<string, { m: THREE.Matrix4; c: THREE.Color; g: number }[]>();
    const q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), e = new THREE.Euler();
    for (const spot of this.spots) {
      e.set(rng.range(-0.08, 0.08), rng.range(0, Math.PI * 2), rng.range(-0.08, 0.08));
      const m = new THREE.Matrix4().compose(p.set(spot.x, w.heightAt(spot.x, spot.z), spot.z), q.setFromEuler(e), sc.setScalar(spot.s));
      // A little variety: some brighter, some a touch pinker.
      const c = new THREE.Color(1, rng.range(0.9, 1), 1).multiplyScalar(rng.range(0.85, 1.1));
      const key = `${Math.floor(spot.x / CH)},${Math.floor(spot.z / CH)}`;
      let list = buckets.get(key);
      if (!list) buckets.set(key, (list = []));
      list.push({ m, c, g: rng.int(0, geos.length - 1) });
    }
    for (const list of buckets.values()) {
      for (let gi = 0; gi < geos.length; gi++) {
        const items = list.filter((it) => it.g === gi);
        if (!items.length) continue;
        const mesh = new THREE.InstancedMesh(geos[gi], mat, items.length);
        items.forEach((it, i) => {
          mesh.setMatrixAt(i, it.m);
          mesh.setColorAt(i, it.c);
        });
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        mesh.name = 'tube coral';
        this.group.add(mesh);
      }
    }
  }
}
