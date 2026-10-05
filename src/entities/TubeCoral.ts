import * as THREE from 'three';
import { GeoBuilder, M, P } from '../render/GeoBuilder';
import { patchStylised } from '../render/materials';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import { SEA_SURFACE } from '../water/Water';

interface Palette { base: number; tip: number; rim: number; hole: number }
/** The tube corals' colours: violet, hot pink, golden orange, lime, sunny yellow and blush pink. */
export const CORAL_PALETTES: Record<string, Palette> = {
  purple: { base: 0x48107e, tip: 0x9a3fe0, rim: 0xdba2ff, hole: 0x1c0530 },
  pink: { base: 0xa8187e, tip: 0xff5cc8, rim: 0xffb6e8, hole: 0x3a0828 },
  orange: { base: 0xd05a00, tip: 0xffa000, rim: 0xffd060, hole: 0x3a1400 },
  lime: { base: 0x6aa800, tip: 0xd4ff00, rim: 0xf0ff90, hole: 0x1e2c00 },
  yellow: { base: 0xd8a800, tip: 0xfff000, rim: 0xfff8a0, hole: 0x302400 },
  blush: { base: 0xb07898, tip: 0xf2c4dc, rim: 0xfff0f6, hole: 0x3e2030 },
};
/** Shapes: leaning clumps, tall packed pipes, short stubby fingers. */
export type CoralShape = 'clump' | 'pipes' | 'stubs';
/** Height of a cluster's tallest tube at scale 1. */
const TALL = 0.62;

/**
 * Tube coral: clusters of fat, hollow tubes, deep colour low down and brighter at the tips, each
 * open mouth a pale rim round a dark hole. 'clump': two clumps leaning out from their bases;
 * 'pipes': a tight bundle of tall, nearly upright pipes; 'stubs': a scatter of short fat fingers.
 */
export function tubeCoralGeometry(seed: number, pal: Palette = CORAL_PALETTES.purple, shape: CoralShape = 'clump'): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  const base = new THREE.Color(pal.base), tip = new THREE.Color(pal.tip), rim = new THREE.Color(pal.rim), hole = new THREE.Color(pal.hole);
  const tube = (x: number, z: number, r: number, h: number, rx: number, rz: number) => {
    const m = M.t(x, -0.02, z, rx, 0, rz);
    b.add(P.cyl(r, r * 1.12, h, shape === 'pipes' ? 7 : 9), { color: (p) => base.clone().lerp(tip, Math.min(1, Math.max(0, p.y / TALL) * 0.95)), sway: 0.02 }, m.clone().multiply(M.t(0, h / 2, 0)));
    // The mouth: a pale lip round a dark hollow.
    b.add(P.torus(r * 0.82, r * 0.28, 5, 12), { color: rim, sway: 0.03 }, m.clone().multiply(M.t(0, h, 0, Math.PI / 2, 0, 0)));
    b.add(P.cyl(r * 0.66, r * 0.66, 0.006, 9), { color: hole }, m.clone().multiply(M.t(0, h + 0.002, 0)));
  };
  if (shape === 'pipes') {
    // A tight bundle: the middle ones tallest, all nearly upright.
    const n = rng.int(9, 14);
    for (let k = 0; k < n; k++) {
      const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * 0.17;
      const r = rng.range(0.045, 0.065), h = TALL * (1 - d * 2.2) * rng.range(0.75, 1);
      tube(Math.cos(a) * d, Math.sin(a) * d, r, Math.max(0.15, h), Math.sin(a) * 0.08, -Math.cos(a) * 0.08);
    }
  } else if (shape === 'stubs') {
    const n = rng.int(6, 10);
    for (let k = 0; k < n; k++) {
      const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * 0.24;
      tube(Math.cos(a) * d, Math.sin(a) * d, rng.range(0.06, 0.085), rng.range(0.12, 0.3), Math.sin(a) * 0.25, -Math.cos(a) * 0.25);
    }
  } else {
    for (const [cx, cz] of [[-0.13, 0.02], [0.14, -0.04]]) {
      const n = rng.int(5, 8);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
        const off = k === 0 ? 0 : rng.range(0.05, 0.11);
        const r = rng.range(0.05, 0.075);
        const h = (k === 0 ? rng.range(0.5, 0.62) : rng.range(0.22, 0.5)) * TALL / 0.62;
        // Leaning out from the middle of the clump, the outer ones more.
        const lean = k === 0 ? rng.range(0, 0.12) : rng.range(0.25, 0.6);
        tube(cx + Math.cos(a) * off, cz + Math.sin(a) * off, r, h, Math.sin(a) * lean, -Math.cos(a) * lean);
      }
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
  readonly spots: { x: number; z: number; s: number; g?: number }[] = [];

  /**
   * @param rocks rocks in the sea that coral grows round (centre and radius); `rich` ones (the
   * sea arch's feet) grow a dense, many-coloured garden, a little deeper too.
   */
  constructor(private world: World, rocks: { x: number; z: number; r: number; rich?: boolean }[]) {
    const w = world;
    const rng = new RNG(w.seed * 53 + 29);
    /** Sea floor depth that suits it, and the scale that keeps its tips under the water there. */
    const fit = (x: number, z: number, deep = -1.25): number => {
      const i = w.cellIndexAt(x, z);
      if (i < 0 || w.layer[i] > 0 || !Number.isNaN(w.riverY[i]) || w.canal[i] || w.blockFixed[i]) return 0;
      const bed = w.heightAt(x, z);
      if (bed > -0.3 || bed < deep) return 0;
      // Tips just under the surface, where the water hardly dulls their colour.
      const room = (SEA_SURFACE - 0.1 - bed) / TALL;
      return room >= 0.55 ? Math.min(room, rng.range(1.1, 1.8)) : 0;
    };
    const near = (x: number, z: number, d: number) => this.spots.some((p) => Math.hypot(p.x - x, p.z - z) < d);
    // Round the rocks: a few clusters each, tucked in close.
    for (const r of rocks) {
      const n = r.rich ? rng.int(4, 7) : rng.int(1, 4);
      for (let k = 0, tries = 0; k < n && tries < (r.rich ? 30 : 12); tries++) {
        const a = rng.range(0, Math.PI * 2), d = r.r + rng.range(0.25, r.rich ? 2.6 : 1.8);
        const x = r.x + Math.cos(a) * d, z = r.z + Math.sin(a) * d;
        const s = fit(x, z, r.rich ? -1.8 : -1.25);
        if (!s || near(x, z, r.rich ? 0.6 : 0.75)) continue;
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
    // Every colour in a few shapes; purple the most common, then pink and orange.
    const kinds: { pal: string; shape: CoralShape; w: number }[] = [
      { pal: 'purple', shape: 'clump', w: 5 }, { pal: 'purple', shape: 'stubs', w: 1.5 },
      { pal: 'pink', shape: 'clump', w: 2.5 }, { pal: 'pink', shape: 'pipes', w: 1.5 },
      { pal: 'orange', shape: 'pipes', w: 2.5 }, { pal: 'orange', shape: 'clump', w: 1 },
      { pal: 'lime', shape: 'clump', w: 1.5 }, { pal: 'lime', shape: 'stubs', w: 1 },
      { pal: 'yellow', shape: 'stubs', w: 1.5 }, { pal: 'yellow', shape: 'pipes', w: 0.8 },
      { pal: 'blush', shape: 'pipes', w: 1.2 }, { pal: 'blush', shape: 'clump', w: 0.8 },
    ];
    const totW = kinds.reduce((t, k) => t + k.w, 0);
    const geos = kinds.map((k, i) => tubeCoralGeometry(11 + i * 13, CORAL_PALETTES[k.pal], k.shape));
    const pick = () => { let r = rng.next() * totW; for (let i = 0; i < kinds.length; i++) if ((r -= kinds[i].w) <= 0) return i; return 0; };
    const mat = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 }), 0.2);
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
      list.push({ m, c, g: spot.g ?? pick() });
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
