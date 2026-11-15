import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, M, tube } from '../render/GeoBuilder';
import { stylisedMaterial } from '../render/materials';
import { View } from '../render/View';
import { RNG } from '../world/rng';
import { Simplex2 } from '../world/noise';
import { World } from '../world/World';
import { groundSeason } from '../terrain/groundFx';
import { addLeaf, curvedLeaf, leafGeometry, leafMatrix } from './detail';
import { fernGeometry } from './models';
import { flowerHead, LEAF, LEAF_LIGHT, STEM } from './flowerParts';

/** Tuning for the wildflowers. */
export const WILDFLOWERS = {
  /** Chance per suitable cell of a cluster starting there (scaled by the flower noise). */
  clusterChance: 0.13,
  /** Chance per suitable cell of a lone flower. */
  singleChance: 0.07,
  /** Plants per cluster. */
  clusterSize: [2, 7] as [number, number],
  /** Hide a chunk beyond this distance from the camera. */
  drawDistance: 70,
  /** Chance of each flower having a spring-only companion beside it (the meadow at its thickest). */
  springExtra: 0.55,
  /** Map chunks re-made per refresh as the season turns (each is a small hitch, so they go a few at a time). */
  seasonChunks: 2,
};

/** Flowers showing, in eighths: the season's density moves in steps, so chunks are not re-made every refresh. */
function seasonDensity(): number {
  return Math.round(groundSeason.look.flowers * 8) / 8;
}

/** Wild kinds, plus garden-only flower colours (white, blue). */
export type Kind = 'orchid' | 'red' | 'yellow' | 'orange' | 'purple' | 'pink' | 'fern' | 'tropical' | 'white' | 'blue';
const KINDS: { k: Kind; w: number }[] = [
  { k: 'orchid', w: 1.2 }, { k: 'red', w: 1.3 }, { k: 'yellow', w: 1.3 }, { k: 'orange', w: 1.0 },
  { k: 'purple', w: 0.9 }, { k: 'pink', w: 0.8 }, { k: 'fern', w: 1.6 }, { k: 'tropical', w: 1.2 },
];
const PETAL: Record<string, [number, number]> = {
  orchid: [0xd8233a, 0xf05a78], red: [0xc9272b, 0xe8483e], yellow: [0xf2c21c, 0xffe05a],
  orange: [0xe8701a, 0xffa13d], purple: [0x8e44c9, 0xb877e6], pink: [0xe0629e, 0xf59ac4],
  white: [0xeee9df, 0xffffff], blue: [0x3f6fd6, 0x7fa4f0],
};
export { flowerHead, LEAF, LEAF_LIGHT, STEM };

/** A low rosette of leaves round the base: each arches over, darker at the stalk and lighter along its midrib. */
function rosette(b: GeoBuilder, n: number, len: number, rng: RNG, up = 0.35, wide = 0.33): void {
  const a0 = rng.range(0, Math.PI * 2);
  for (let k = 0; k < n; k++) {
    const a = a0 + (k / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const l = len * rng.range(0.75, 1.25), w = l * wide;
    const tone = LEAF.clone().lerp(LEAF_LIGHT, rng.next() * 0.7), dark = tone.clone().multiplyScalar(0.7);
    const m = leafMatrix(new THREE.Vector3(0, 0.01, 0), a, Math.atan(up + rng.range(-0.1, 0.2)) + 0.2, rng.range(-0.25, 0.25));
    addLeaf(b, curvedLeaf(l, w, 0.4, 0.35, 2, 0.45, true), m, l, w, (t, e, top) => (top ? dark.clone().lerp(tone, Math.min(1, t * 2)).lerp(LEAF_LIGHT, (1 - e) * 0.35) : dark), 0.3);
  }
}

/** A flower's stalk from `foot` up to `top`, bowing out a little, with a small leaf part-way up it. */
function stalk(b: GeoBuilder, foot: THREE.Vector3, top: THREE.Vector3, rng: RNG): void {
  const midway = foot.clone().lerp(top, 0.55);
  midway.x = foot.x + (top.x - foot.x) * 0.3;
  midway.z = foot.z + (top.z - foot.z) * 0.3;
  b.add(tube([foot, midway, top], () => 0.005, 3, 2), { color: STEM, sway: (p) => p.y * 2.5 });
  const at = foot.clone().lerp(midway, rng.range(0.55, 0.9));
  b.add(leafGeometry(rng.range(0.035, 0.05), 0.013, 0.35), { color: LEAF.clone().lerp(LEAF_LIGHT, rng.range(0.3, 0.9)), leaf: 1, sway: at.y * 2.5 }, leafMatrix(at, rng.range(0, Math.PI * 2), rng.range(0.5, 0.9)));
}

export function plantGeometry(kind: Kind, seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  if (kind === 'fern') {
    const g = fernGeometry(false, seed).clone();
    g.scale(0.55, 0.55, 0.55);
    return g;
  }
  const b = new GeoBuilder();
  if (kind === 'tropical') {
    // Small broad-leaved plant: big glossy leaves arching out on short stalks, pale down the midrib
    // and deep green at the edge, round a young leaf still standing in the middle.
    const n = rng.int(4, 5), a0 = rng.range(0, Math.PI * 2);
    const deep = new THREE.Color(0x2b6230), young = new THREE.Color(0x9acb4e);
    for (let k = 0; k <= n; k++) {
      const inner = k === n;
      const a = a0 + (k / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const l = inner ? rng.range(0.11, 0.14) : rng.range(0.17, 0.24), w = l * (inner ? 0.28 : 0.4);
      const edge = inner ? LEAF_LIGHT.clone().lerp(young, 0.5) : deep.clone().lerp(LEAF, rng.next()), rib = edge.clone().lerp(inner ? young : new THREE.Color(0x86bb48), 0.65);
      const m = leafMatrix(new THREE.Vector3(0, 0.015, 0), a, inner ? 1.3 : rng.range(0.8, 1.05), rng.range(-0.3, 0.3));
      addLeaf(b, curvedLeaf(l, w, inner ? 0.15 : rng.range(0.5, 0.7), 0.4, 2, 0.56, true), m, l, w, (t, e, top) => (top ? rib.clone().lerp(edge, e * (0.6 + 0.4 * t)) : edge.clone().multiplyScalar(0.82)), 0.45);
    }
    return b.build();
  }
  const [h0, h1] = PETAL[kind];
  const c0 = new THREE.Color(h0), c1 = new THREE.Color(h1);
  if (kind === 'orchid') {
    // Red orchid: broad strap leaves and an arching spray of blooms, the last of it still in bud.
    rosette(b, 3, 0.14, rng, 0.2, 0.3);
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.02, 0.12, 0.01), new THREE.Vector3(0.07, 0.2, 0.03), new THREE.Vector3(0.13, 0.22, 0.05)];
    b.add(tube(pts, () => 0.005, 3, 3), { color: STEM, sway: (p) => p.y * 2.5 });
    const curve = new THREE.CatmullRomCurve3(pts);
    for (let k = 0; k < 4; k++) flowerHead(b, curve.getPoint(0.42 + k * 0.15), 0.037 - k * 0.002, c0, c1, rng, 5, 0.1);
    for (let k = 0; k < 2; k++) {
      const at = curve.getPoint(0.95 + k * 0.05);
      b.add(new THREE.OctahedronGeometry(0.011 - k * 0.003, 0), { color: c0.clone().multiplyScalar(0.85), leaf: 1, sway: 0.6 }, M.t(at.x + k * 0.012, at.y - k * 0.006, at.z + k * 0.004, 0, 0, 0, 1, 1.5, 1));
    }
    return b.build();
  }
  // Plain flower clump: leaves and two or three blooms on stalks of different heights.
  rosette(b, rng.int(4, 6), 0.1, rng);
  const n = rng.int(2, 3);
  for (let k = 0; k < n; k++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(0, 0.05);
    const top = new THREE.Vector3(Math.cos(a) * r * 2, rng.range(0.1, 0.18), Math.sin(a) * r * 2);
    stalk(b, new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), top, rng);
    flowerHead(b, top, rng.range(0.035, 0.05), c0, c1, rng, kind === 'purple' ? 6 : 5);
  }
  return b.build();
}

interface Bloom {
  kind: number;
  x: number;
  z: number;
  cell: number;
  rot: number;
  s: number;
  /**
   * How hardy it is: it shows while this is below the season's flower density. Ferns and leafy
   * plants are 0 (all year), the island's usual flowers 0..1 (all out by summer, the hardiest
   * few left in winter), spring's extra blooms 1..1.5.
   */
  hard: number;
}

interface Chunk {
  list: Bloom[];
  mesh: THREE.Mesh | null;
  /** Visibility key of the blooms in the current mesh (rebuilt when it changes). */
  key: string;
  cx: number;
  cz: number;
  /** The season's flower density this chunk was last built for. */
  season: number;
}

/**
 * Wildflowers and small plants scattered over the island: red orchids, red, yellow, orange,
 * purple and pink flowers, little ferns and broad-leaved plants, mostly in small clumps of one kind
 * with the odd one alone, placed by a patchy noise field so they bunch irregularly. Decoration only
 * (not saved, nothing harvests them). Clearings, beaches, cliffs, water and the village plain stay
 * open, and flowers under buildings, fields and paths drop out. Each map chunk is one merged mesh,
 * hidden when far away, so this costs a handful of draw calls.
 */
export class Wildflowers {
  readonly group = new THREE.Group();
  private chunks: Chunk[] = [];
  private variants: THREE.BufferGeometry[][] = [];
  private timer = 0;
  private C = 8;

  constructor(private world: World, density: number) {
    const w = world, N = w.N;
    const rng = new RNG(w.seed * 571 + 43);
    const noise = new Simplex2(rng);
    // Two shape variants of each kind.
    for (let k = 0; k < KINDS.length; k++) this.variants.push([plantGeometry(KINDS[k].k, 900 + k * 7), plantGeometry(KINDS[k].k, 901 + k * 7)]);
    for (let i = 0; i < this.C * this.C; i++) this.chunks.push({ list: [], mesh: null, key: '', cx: i % this.C, cz: Math.floor(i / this.C), season: -1 });
    const tot = KINDS.reduce((s, k) => s + k.w, 0);
    const pickKind = () => {
      let r = rng.next() * tot;
      for (let k = 0; k < KINDS.length; k++) if ((r -= KINDS[k].w) <= 0) return k;
      return 0;
    };
    const ok = (x: number, z: number) => {
      const i = w.cellIndexAt(x, z);
      if (i < 0 || !w.isLandCell(i) || w.sandy[i] > 0.4 || w.rocky[i] > 0.4 || w.swamp[i] > 0.3 || w.blocked(i)) return -1;
      if (Math.hypot(x - w.meadow.x, z - w.meadow.z) < w.meadow.r - 2) return -1;
      const y = w.heightAt(x, z);
      if (Math.abs(w.heightAt(x + 0.2, z) - y) > 0.06 || Math.abs(w.heightAt(x, z + 0.2) - y) > 0.06) return -1;
      return i;
    };
    const evergreen = (kind: number) => KINDS[kind].k === 'fern' || KINDS[kind].k === 'tropical';
    const add = (kind: number, x: number, z: number, s: number) => {
      const i = ok(x, z);
      if (i < 0) return;
      const cx = Math.min(this.C - 1, Math.floor(((x + w.half) / N) * this.C)), cz = Math.min(this.C - 1, Math.floor(((z + w.half) / N) * this.C));
      // Hardiness from where it stands (not from the placing dice, so the scatter is as it always was).
      const hard = evergreen(kind) ? 0 : Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
      this.chunks[cz * this.C + cx].list.push({ kind: kind * 2 + (rng.chance(0.5) ? 1 : 0), x, z, cell: i, rot: rng.range(0, 6.28), s, hard });
    };
    for (let cz = 1; cz < N - 1; cz++) {
      for (let cx = 1; cx < N - 1; cx++) {
        const x0 = w.centerX(cx), z0 = w.centerZ(cz);
        if (ok(x0, z0) < 0) continue;
        // Patchy: flowers gather where the noise is high, especially at woodland edges.
        const i = cz * N + cx;
        const patch = noise.noise(cx * 0.07, cz * 0.07) * 0.5 + 0.5;
        const edge = 1 - Math.abs(w.forest[i] - 0.45) * 1.4;
        const want = WILDFLOWERS.clusterChance * density * Math.max(0, patch * 1.6 - 0.35) * (0.5 + Math.max(0, edge));
        if (rng.chance(want)) {
          // A clump: mostly one kind, sometimes a second mixed in.
          const k1 = pickKind(), k2 = rng.chance(0.25) ? pickKind() : k1;
          const n = rng.int(WILDFLOWERS.clusterSize[0], WILDFLOWERS.clusterSize[1]);
          const r0 = rng.range(0.35, 1.1);
          for (let k = 0; k < n; k++) {
            const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * r0;
            add(rng.chance(0.8) ? k1 : k2, x0 + Math.cos(a) * d, z0 + Math.sin(a) * d, rng.range(0.75, 1.25));
          }
        } else if (rng.chance(WILDFLOWERS.singleChance * density * (0.4 + patch))) {
          add(pickKind(), x0 + rng.range(-0.45, 0.45), z0 + rng.range(-0.45, 0.45), rng.range(0.7, 1.15));
        }
      }
    }
    // Spring's extra blooms: a companion of the same kind beside many of the flowers, out only
    // while the season's density is above the usual (their own dice: the scatter above is untouched).
    const srng = new RNG(w.seed * 571 + 977);
    const chance = WILDFLOWERS.springExtra * Math.min(1, density);
    for (const c of this.chunks) {
      const base = c.list.length;
      for (let k = 0; k < base; k++) {
        const b = c.list[k];
        if (evergreen(b.kind >> 1) || !srng.chance(chance)) continue;
        const a = srng.range(0, Math.PI * 2), d = srng.range(0.14, 0.45);
        const x = b.x + Math.cos(a) * d, z = b.z + Math.sin(a) * d;
        const i = ok(x, z);
        if (i < 0) continue;
        c.list.push({ kind: b.kind ^ (srng.chance(0.5) ? 1 : 0), x, z, cell: i, rot: srng.range(0, 6.28), s: b.s * srng.range(0.7, 1), hard: 1 + srng.next() * 0.5 });
      }
    }
    this.refresh(Infinity);
  }

  /** The island's usual scatter (spring's extra blooms aside). */
  get count(): number {
    return this.chunks.reduce((s, c) => s + c.list.reduce((n, b) => n + (b.hard < 1 ? 1 : 0), 0), 0);
  }

  /** Every flowering plant (not the ferns and leafy plants): where it is and how high its blooms stand. */
  blooms(): { x: number; z: number; top: number }[] {
    const out: { x: number; z: number; top: number }[] = [];
    const fern = KINDS.findIndex((k) => k.k === 'fern'), tropical = KINDS.findIndex((k) => k.k === 'tropical');
    for (const c of this.chunks) {
      for (const b of c.list) {
        const k = b.kind >> 1;
        if (k === fern || k === tropical || b.hard >= 1) continue;
        out.push({ x: b.x, z: b.z, top: 0.16 * b.s });
      }
    }
    return out;
  }

  /**
   * Rebuild the chunks whose visible flowers changed (buildings, fields, paths, sculpting, and the
   * season: thick in spring, the usual scatter in summer, thinning through autumn to a hardy few
   * in winter). At most `seasonal` chunks take up a new season per call, so the turn of the season
   * spreads across the island over a minute or two instead of landing as one hitch.
   */
  refresh(seasonal: number = WILDFLOWERS.seasonChunks): void {
    const w = this.world;
    const want = seasonDensity();
    // Not the tree material: small plants never dither see-through like trees near the camera.
    const mat = stylisedMaterial();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const c of this.chunks) {
      if (!c.list.length) continue;
      // A chunk never built takes the season at once; the rest wait their turn.
      const turning = c.season !== want && (c.season < 0 || seasonal > 0);
      const dens = turning ? want : c.season;
      let key = '';
      const show: Bloom[] = [];
      for (const b of c.list) {
        const i = b.cell;
        const vis = b.hard < dens && w.occ[i] === 0 && !w.path[i] && w.wear[i] <= 0.3 && w.soil[i] <= 0.05 && w.isLandCell(i) && !w.blocked(i);
        key += vis ? '1' : '0';
        if (vis) show.push(b);
      }
      c.season = dens;
      if (key === c.key) continue;
      if (turning) seasonal--;
      c.key = key;
      if (c.mesh) {
        this.group.remove(c.mesh);
        c.mesh.geometry.dispose();
        c.mesh = null;
      }
      if (!show.length) continue;
      const parts = show.map((b) => {
        const g = this.variants[b.kind >> 1][b.kind & 1].clone();
        q.setFromAxisAngle(up, b.rot);
        g.applyMatrix4(m.compose(p.set(b.x, w.heightAt(b.x, b.z) - 0.01, b.z), q, s.setScalar(b.s)));
        return g;
      });
      const geo = mergeGeometries(parts)!;
      for (const g of parts) g.dispose();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      c.mesh = mesh;
      this.group.add(mesh);
    }
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 3;
      this.refresh();
    }
    // Far chunks drop out (small plants are invisible from high up anyway).
    const d2 = WILDFLOWERS.drawDistance * WILDFLOWERS.drawDistance;
    for (const c of this.chunks) {
      if (!c.mesh) continue;
      const bs = c.mesh.geometry.boundingSphere!;
      c.mesh.visible = View.dist2(bs.center.x, bs.center.y, bs.center.z) < d2 + bs.radius * bs.radius * 2;
    }
  }
}
