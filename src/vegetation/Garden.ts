import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, tube } from '../render/GeoBuilder';
import { stylisedMaterial } from '../render/materials';
import { followerShadows } from '../render/SoftShadows';
import { Particles } from '../render/Particles';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import { addLeaf, curvedLeaf, leafGeometry, leafMatrix } from './detail';
import { bushGeometry, fernGeometry } from './models';
import { Kind, LEAF, STEM, flowerHead, plantGeometry } from './Wildflowers';
import { springPop } from './pop';
import type { PlantKind, Vegetation } from './Vegetation';

/** The planting brushes (and the one that digs plants up again). */
export type GardenBrush = 'flowers' | 'bushes' | 'shrubs' | 'trees' | 'unplant';
export const GARDEN_BRUSHES: GardenBrush[] = ['flowers', 'bushes', 'shrubs', 'trees', 'unplant'];

/** Tuning for the player's garden planting. */
export const GARDEN = {
  /** Brush radius (world units) for each brush. */
  radius: { flowers: 0.8, bushes: 1.0, shrubs: 0.9, trees: 1.6, unplant: 1.1 } as Record<GardenBrush, number>,
  /** Planting attempts per brush step (a step every ~0.4 units of drag). */
  tries: { flowers: 5, bushes: 1.4, shrubs: 2.2, trees: 0.7, unplant: 0 } as Record<GardenBrush, number>,
  /** Belief for each tree planted (garden plants are free). */
  treeCost: 4,
  /** Most plants on the island. */
  max: 5000,
  /** Seconds a plant takes to pop up (springing past full size and settling), or to shrink away. */
  pop: 0.8,
  shrink: 0.3,
};

/**
 * Trees the tree brush plants (real trees: chopped for wood, picked for fruit), by group: a stroke
 * favours one or two. Radius is the room each needs (at scale 1).
 */
export const TREE_GROUPS: Record<string, { kind: PlantKind; variants: number[]; s: [number, number]; r: number }[]> = {
  palms: [{ kind: 'palm', variants: [0, 1, 2], s: [0.8, 1.15], r: 0.75 }],
  jungle: [{ kind: 'broadleaf', variants: [0, 1, 5, 6], s: [0.85, 1.15], r: 1.05 }],
  meadow: [{ kind: 'broadleaf', variants: [2, 3, 4, 7], s: [0.8, 1.1], r: 0.95 }],
  fruit: [
    { kind: 'apple', variants: [1], s: [0.85, 1.05], r: 0.75 },
    { kind: 'banana', variants: [0], s: [0.85, 1.05], r: 0.6 },
  ],
};

interface Variant {
  brush: Exclude<GardenBrush, 'unplant' | 'trees'>;
  /** Plants of one group read as one kind (a stroke favours one or two groups). */
  group: string;
  geo: () => THREE.BufferGeometry;
  /** Scale range, and the ground it needs round it (radius at scale 1). */
  s: [number, number];
  r: number;
}

/**
 * A flowering shrub: a small bush with blooms of one colour sitting on its leaves, `n` sprays of
 * `cluster` blooms each (single big flowers for a hibiscus, hanging bunches for a bougainvillea).
 */
function bloomBush(seed: number, c0: number, c1: number, petals: number, size: number, n = 12, cluster = 1, cup = 0.35): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const bush = bushGeometry(false, false, seed);
  const b = new GeoBuilder();
  const col0 = new THREE.Color(c0), col1 = new THREE.Color(c1);
  // How far the leaves reach from the bush's middle in a direction: blooms sit on the foliage there.
  const P3 = bush.getAttribute('position'), mid = new THREE.Vector3(0, 0.4, 0), v = new THREE.Vector3(), dir = new THREE.Vector3();
  const reach = (d: THREE.Vector3) => {
    let best = 0.3;
    for (let i = 0; i < P3.count; i++) {
      v.fromBufferAttribute(P3, i).sub(mid);
      const along = v.dot(d);
      if (along > best && v.lengthSq() - along * along < 0.012) best = along;
    }
    return best;
  };
  for (let k = 0; k < n; k++) {
    const th = rng.range(0, Math.PI * 2), ph = rng.range(0.1, 1.3);
    for (let j = 0; j < cluster; j++) {
      // The rest of a bunch hangs just below and beside its first bloom.
      const t2 = th + (j ? rng.range(-0.28, 0.28) : 0), p2 = ph + (j ? rng.range(0.05, 0.3) : 0);
      dir.set(Math.cos(t2) * Math.sin(p2), Math.cos(p2), Math.sin(t2) * Math.sin(p2));
      const r = reach(dir) - size * 0.35;
      flowerHead(b, new THREE.Vector3(dir.x * r, mid.y + dir.y * r, dir.z * r), size * rng.range(0.85, 1.15) * (j ? 0.85 : 1), col0, col1, rng, petals, cup);
    }
  }
  const g = mergeGeometries([bush, b.build()])!;
  bush.dispose();
  return g;
}

/**
 * An agave: a spiral rosette of thick, pointed leaves, the outer ones splayed low and the young
 * ones standing in the heart, blue-green with pale edges and a dark spine at each tip (every other
 * shape is the striped kind, edged in cream).
 */
function agave(seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  const striped = seed % 2 === 0;
  const heart = new THREE.Color(0x52857a), body = new THREE.Color(striped ? 0x659c7e : 0x74a898), pale = new THREE.Color(striped ? 0xdcd890 : 0xa6ccb6);
  const under = new THREE.Color(0x4c7a70), spine = new THREE.Color(0x6a4636);
  const n = 22;
  for (let k = 0; k < n; k++) {
    // Oldest leaves first: low, wide and all round; each younger one stands a little straighter.
    const u = k / (n - 1);
    const a = k * 2.39996 + rng.range(-0.2, 0.2);
    const elev = 0.28 + 1.1 * Math.pow(u, 0.8) + rng.range(-0.06, 0.06);
    const len = (0.195 + 0.13 * u) * rng.range(0.92, 1.08), w = len * (0.2 - 0.05 * u), thick = w * 0.55;
    const tone = rng.range(-0.12, 0.12);
    const m = leafMatrix(new THREE.Vector3(Math.cos(a) * 0.012, 0.005, Math.sin(a) * 0.012), a, elev, rng.range(-0.12, 0.12));
    addLeaf(b, agaveLeaf(len, w, thick, 0.1 * (1 - u)), m, len, w, (t, edge, top) => {
      const c = top ? heart.clone().lerp(body, Math.min(1, t * 2.4)).lerp(pale, edge * 0.85) : under.clone().lerp(body, edge * 0.5);
      return c.lerp(spine, t > 0.9 ? 0.55 : 0).offsetHSL(0, 0, tone * 0.25);
    }, 0.05, 0);
  }
  return b.build();
}

/** One agave leaf along +z: a shallow channel on top, a keel underneath, curling up to its point (6 triangles). */
function agaveLeaf(len: number, w: number, thick: number, curl: number): THREE.BufferGeometry {
  const z1 = len * 0.36;
  const B = [0, 0, 0], T = [0, curl * len, len], L = [-w, w * 0.35, z1], R = [w, w * 0.35, z1], K = [0, -thick, z1 * 0.9];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([B, L, T, B, T, R, B, K, L, L, K, T, B, R, K, K, R, T].flat(), 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Ornamental grass: a fountain of fine blades arching over from a tight foot, green at the base and
 * straw-gold at the tips, with pale feathery plumes nodding above it on thin stalks.
 */
function grassClump(seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  const golden = seed % 2 === 0;
  const g0 = new THREE.Color(golden ? 0x7f9438 : 0x6f9a3c), g1 = new THREE.Color(golden ? 0xd2bf62 : 0xb9bd5e);
  const blades = 30;
  for (let k = 0; k < blades; k++) {
    // Inner blades stand tall, outer ones arch right over.
    const u = (k + 0.5) / blades;
    const a = k * 2.39996 + rng.range(-0.4, 0.4);
    const elev = 1.47 - 0.27 * u + rng.range(-0.06, 0.06);
    const len = rng.range(0.29, 0.4) * (1 - 0.25 * u);
    const tone = rng.next();
    const m = leafMatrix(new THREE.Vector3(Math.cos(a) * 0.025 * u, 0, Math.sin(a) * 0.025 * u), a, elev, rng.range(-0.5, 0.5));
    b.add(curvedLeaf(len, 0.013, 0.12 + 0.3 * u + rng.range(0, 0.1), 0.6, 2, 0.35), {
      color: (p) => g0.clone().lerp(g1, THREE.MathUtils.clamp(p.y * 2.6 - 0.15 + tone * 0.35, 0, 1)),
      leaf: 1,
      sway: (p) => 0.4 + p.y * 2,
    }, m);
  }
  const plume0 = new THREE.Color(0xf0dca6), plume1 = new THREE.Color(0xd9b98c);
  const plumes = golden ? 6 : 5;
  for (let k = 0; k < plumes; k++) {
    const a = (k / plumes) * Math.PI * 2 + rng.range(-0.5, 0.5), r = rng.range(0.01, 0.03);
    const h = rng.range(0.36, 0.46), lean = rng.range(0.03, 0.09);
    const foot = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    const top = new THREE.Vector3(Math.cos(a) * (r + lean), h, Math.sin(a) * (r + lean));
    b.add(tube([foot, foot.clone().lerp(top, 0.5).setY(h * 0.55), top], () => 0.004, 3, 2), { color: new THREE.Color(0xa8a060), sway: (p) => p.y * 2.5 });
    // The plume: two crossed feathers nodding outward, with barbs breaking from their sides.
    const elev = 1.2 - lean * 4;
    const shade = plume0.clone().lerp(plume1, rng.next());
    for (let j = 0; j < 2; j++) b.add(leafGeometry(0.12, 0.017, 0.5), { color: shade, sway: 1 }, leafMatrix(top, a, elev, j * Math.PI / 2));
    for (let j = 0; j < 4; j++) {
      const at = top.clone().add(new THREE.Vector3(Math.cos(a) * Math.cos(elev), Math.sin(elev), Math.sin(a) * Math.cos(elev)).multiplyScalar(0.012 + j * 0.02));
      b.add(leafGeometry(0.06 - j * 0.008, 0.011, 0.5), { color: shade.clone().lerp(plume0, 0.5), sway: 1 }, leafMatrix(at, a + (j % 2 ? 1.9 : -1.9) + j * 0.8, elev - 0.55, j));
    }
  }
  return b.build();
}

/**
 * Croton: a few leaning stems thick with broad glossy leaves, each stem's old leaves at the foot
 * deep red and maroon, turning orange and then green toward the young leaves standing at its tip,
 * every leaf splashed with yellow toward its edge.
 */
function croton(seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  const old = [0x7e2428, 0xb0301f, 0x8f2a36].map((h) => new THREE.Color(h));
  const mid = [0xd2602a, 0xb8341f, 0x47762a, 0xc8842a].map((h) => new THREE.Color(h));
  const young = [0x47762a, 0x5c8f2e, 0x86a834].map((h) => new THREE.Color(h));
  const splash = new THREE.Color(0xf2cf45);
  const stems = 3, a0 = rng.range(0, Math.PI * 2);
  for (let st = 0; st < stems; st++) {
    const sa = a0 + (st / stems) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const H = st === 0 ? 0.17 : rng.range(0.11, 0.15), out = st === 0 ? 0.01 : rng.range(0.03, 0.045);
    const top = new THREE.Vector3(Math.cos(sa) * out, H, Math.sin(sa) * out);
    b.add(tube([new THREE.Vector3(0, 0, 0), top], (t) => 0.008 * (1 - 0.4 * t), 3, 1), { color: STEM });
    const n = st === 0 ? 8 : 7, turn = rng.range(0, Math.PI * 2);
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1);
      const at = top.clone().multiplyScalar(0.3 + 0.7 * u);
      const len = (0.092 - 0.024 * u) * rng.range(0.88, 1.1), w = len * 0.4;
      const main = rng.pick(u < 0.3 ? old : u < 0.7 ? mid : young).clone().lerp(LEAF, rng.next() * 0.15);
      const edge = main.clone().lerp(splash, rng.range(0.15, 0.3 + 0.5 * u));
      // Old leaves hang level, young ones stand up round the tip.
      const m = leafMatrix(at, turn + k * 2.39996 + rng.range(-0.25, 0.25), 0.05 + 1.05 * u * u + rng.range(-0.1, 0.1), rng.range(-0.35, 0.35));
      addLeaf(b, curvedLeaf(len, w, 0.4 - 0.3 * u, 0.3, 2, 0.45, true), m, len, w, (_t, e, up) => (up ? main.clone().lerp(edge, e) : main.clone().multiplyScalar(0.7)), 0.35);
    }
  }
  return b.build();
}

/** A fern scaled for a garden bed. */
function gardenFern(seed: number): THREE.BufferGeometry {
  const g = fernGeometry(false, seed).clone();
  g.scale(0.6, 0.6, 0.6);
  return g;
}

/** A small bush trimmed for a garden (green). */
function greenBush(seed: number): THREE.BufferGeometry {
  return bushGeometry(false, false, seed);
}

const FLOWER_KINDS: Kind[] = ['red', 'yellow', 'orange', 'purple', 'pink', 'white', 'blue', 'orchid'];

/** Every plant the garden brushes can set, by brush and colour group (two shapes of most). */
export const VARIANTS: Variant[] = [
  ...FLOWER_KINDS.flatMap((k, i) =>
    [0, 1].map((n) => ({ brush: 'flowers' as const, group: k, geo: () => plantGeometry(k, 3100 + i * 11 + n), s: [1.5, 1.9] as [number, number], r: 0.1 })),
  ),
  ...[0, 1].map((n) => ({ brush: 'bushes' as const, group: 'green', geo: () => greenBush(61 + n * 2), s: [0.42, 0.62] as [number, number], r: 0.55 })),
  ...[0, 1].map((n) => ({ brush: 'bushes' as const, group: 'hibiscus', geo: () => bloomBush(71 + n, 0xd8263a, 0xf0566a, 5, 0.13, 9, 1, 0.3), s: [0.42, 0.6] as [number, number], r: 0.55 })),
  ...[0, 1].map((n) => ({ brush: 'bushes' as const, group: 'bougainvillea', geo: () => bloomBush(81 + n, 0xc8327e, 0xf06ab4, 4, 0.075, 8, 3, 0.45), s: [0.45, 0.62] as [number, number], r: 0.55 })),
  { brush: 'bushes', group: 'allamanda', geo: () => bloomBush(91, 0xf2c21c, 0xffe57a, 5, 0.1, 13, 1, 0.8), s: [0.42, 0.58], r: 0.55 },
  { brush: 'bushes', group: 'gardenia', geo: () => bloomBush(95, 0xf2eee4, 0xffffff, 6, 0.1, 11, 1, 0.4), s: [0.42, 0.58], r: 0.55 },
  ...[0, 1].map((n) => ({ brush: 'shrubs' as const, group: 'fern', geo: () => gardenFern(141 + n), s: [1.1, 1.45] as [number, number], r: 0.22 })),
  ...[0, 1].map((n) => ({ brush: 'shrubs' as const, group: 'tropical', geo: () => plantGeometry('tropical', 151 + n), s: [1.1, 1.4] as [number, number], r: 0.18 })),
  ...[0, 1].map((n) => ({ brush: 'shrubs' as const, group: 'croton', geo: () => croton(161 + n), s: [1.3, 1.6] as [number, number], r: 0.14 })),
  ...[0, 1].map((n) => ({ brush: 'shrubs' as const, group: 'agave', geo: () => agave(171 + n), s: [1.1, 1.5] as [number, number], r: 0.2 })),
  ...[0, 1].map((n) => ({ brush: 'shrubs' as const, group: 'grass', geo: () => grassClump(181 + n), s: [0.9, 1.25] as [number, number], r: 0.16 })),
];

interface Plant {
  v: number;
  x: number;
  z: number;
  y: number;
  rot: number;
  s: number;
  /** Seconds into its pop (negative while it waits its turn), or into shrinking away. */
  t: number;
  /** 0 settled, 1 popping up, 2 shrinking away. */
  state: 0 | 1 | 2;
  /** Its instance in its variant's mesh. */
  slot: number;
  cell: number;
}

interface Batch {
  mesh: THREE.InstancedMesh;
  /** Soft shadows under its plants (sharing its instance matrices). */
  shadow: THREE.InstancedMesh;
  plants: Plant[];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * The player's garden: flowers, flowering bushes, ferns, crotons, agaves and grasses planted by
 * dragging a brush over the ground, like laying a path. Each plant pops up out of the soil with a
 * springy bounce (overshooting, squashing and settling) and a puff of earth and leaves, in a quick
 * ripple along the stroke. A stroke favours one or two kinds so beds read as drifts of colour.
 * Plants keep their distance from each other (dragging over a bed again only fills its gaps), keep
 * off paths, water, fields and buildings (one built on top of them is cleared away), and are saved
 * with the island. Decoration only: nothing harvests them. One instanced mesh per plant shape.
 */
export class Garden {
  readonly group = new THREE.Group();
  private batches: Batch[];
  private plants: Plant[] = [];
  /** Plants by map cell, for spacing and digging up. */
  private grid = new Map<number, Plant[]>();
  private moving = new Set<Plant>();
  private rng: RNG;
  private stroke: { brush: GardenBrush; groups: string[] } | null = null;
  private dust = new Particles(260, 0xa88d66, 0.75);
  private flecks = new Particles(260, 0x86b850);
  private sweep = 0;
  private version = -1;
  private lastSound = 0;
  private clock = 0;
  sfx: ((name: string, x: number, z: number) => void) | null = null;
  /** The island's trees (the tree brush plants real ones). */
  veg: Vegetation | null = null;
  /** Pay Belief for a tree: false if there isn't enough. */
  pay: ((belief: number) => boolean) | null = null;
  /** The last tree stroke ran out of Belief. */
  short = false;
  /** Trees planted since the game was loaded. */
  treesPlanted = 0;

  constructor(private world: World) {
    this.rng = new RNG(world.seed * 97 + 31);
    const mat = stylisedMaterial();
    this.batches = VARIANTS.map((v) => {
      const mesh = new THREE.InstancedMesh(v.geo(), mat, 16);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      // No sun shadow: a soft shadow under each plant instead.
      const shadow = followerShadows(mesh, mesh.geometry);
      // Hidden while empty (most kinds aren't planted): empty meshes still cost a draw's setup.
      mesh.visible = shadow.visible = false;
      this.group.add(mesh, shadow);
      return { mesh, shadow, plants: [] };
    });
    this.group.add(this.dust.points, this.flecks.points);
    this.group.name = 'garden';
    this.version = world.version;
  }

  get count(): number {
    return this.plants.length;
  }

  /** Can a garden plant grow here (open, level land: no water, path, field, building or rock)? */
  canGrow(x: number, z: number): boolean {
    const w = this.world;
    const i = w.cellIndexAt(x, z);
    if (i < 0 || !w.isLandCell(i) || w.occ[i] || w.path[i] || w.canal[i] || w.bridge[i] || w.blocked(i) || w.soil[i] > 0.05) return false;
    if (!Number.isNaN(w.riverY[i])) return false;
    const y = w.heightAt(x, z);
    if (y < 0.05) return false;
    const sw = w.swampWaterY(x, z);
    if (!Number.isNaN(sw) && sw - y > 0.02) return false;
    return Math.abs(w.heightAt(x + 0.2, z) - y) < 0.1 && Math.abs(w.heightAt(x, z + 0.2) - y) < 0.1;
  }

  /** Is there room for a plant of this variant and size here (clear of its neighbours)? */
  private roomFor(v: number, x: number, z: number, s: number): boolean {
    const w = this.world;
    const r = VARIANTS[v].r * s;
    const [cx, cz] = w.cellOf(x, z);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!w.inBounds(cx + dx, cz + dz)) continue;
        const list = this.grid.get(w.idx(cx + dx, cz + dz));
        if (!list) continue;
        for (const p of list) {
          if (p.state === 2) continue;
          const need = (r + VARIANTS[p.v].r * p.s) * 0.9;
          if ((p.x - x) ** 2 + (p.z - z) ** 2 < need * need) return false;
        }
      }
    }
    return true;
  }

  /** Choose this stroke's kinds: one or two favourites, the odd one of any other. */
  private pickVariant(brush: Exclude<GardenBrush, 'unplant' | 'trees'>): number {
    const all = VARIANTS.map((v, i) => i).filter((i) => VARIANTS[i].brush === brush);
    const st = this.stroke!;
    if (!st.groups.length) {
      const groups = [...new Set(all.map((i) => VARIANTS[i].group))];
      st.groups.push(this.rng.pick(groups));
      if (this.rng.chance(0.55)) st.groups.push(this.rng.pick(groups));
    }
    const r = this.rng.next();
    const want = r < 0.68 ? st.groups[0] : r < 0.9 ? st.groups[st.groups.length - 1] : null;
    const pool = want ? all.filter((i) => VARIANTS[i].group === want) : all;
    return this.rng.pick(pool);
  }

  /**
   * One step of a brush stroke at (x, z): plants a few things round it (or digs them up). `start`
   * begins a new stroke, which picks its own favourite kinds. Returns how many plants changed.
   */
  paint(x: number, z: number, brush: GardenBrush, start: boolean): number {
    if (start || !this.stroke || this.stroke.brush !== brush) this.stroke = { brush, groups: [] };
    const R = GARDEN.radius[brush];
    if (brush === 'unplant') {
      let n = 0;
      for (const p of this.near(x, z, R)) {
        if (p.state === 2) continue;
        this.dig(p, this.rng.range(0, 0.12));
        n++;
      }
      // Trees the player planted come up too (never the island's own forest).
      n += this.veg?.digPlanted(x, z, R) ?? 0;
      if (n) this.sound('unplant', x, z);
      return n;
    }
    if (brush === 'trees') return this.paintTrees(x, z, R);
    let tries = Math.floor(GARDEN.tries[brush]) + (this.rng.chance(GARDEN.tries[brush] % 1) ? 1 : 0);
    let n = 0;
    while (tries-- > 0 && this.plants.length < GARDEN.max) {
      const a = this.rng.range(0, Math.PI * 2), d = Math.sqrt(this.rng.next()) * R;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      const v = this.pickVariant(brush);
      const s = this.rng.range(VARIANTS[v].s[0], VARIANTS[v].s[1]);
      if (!this.canGrow(px, pz) || !this.roomFor(v, px, pz, s)) continue;
      this.add(v, px, pz, this.rng.range(0, Math.PI * 2), s, -this.rng.range(0, 0.18));
      n++;
    }
    return n;
  }

  /**
   * Trees: one now and then along the stroke, each paid for in Belief, of the stroke's favourite
   * kinds (palms on sand), well spaced from other trees, rocks and bushes and off garden plants.
   */
  private paintTrees(x: number, z: number, R: number): number {
    const veg = this.veg;
    if (!veg) return 0;
    const st = this.stroke!;
    if (!st.groups.length) {
      const groups = Object.keys(TREE_GROUPS);
      st.groups.push(this.rng.pick(groups));
      if (this.rng.chance(0.5)) st.groups.push(this.rng.pick(groups));
    }
    let tries = Math.floor(GARDEN.tries.trees) + (this.rng.chance(GARDEN.tries.trees % 1) ? 1 : 0);
    let n = 0;
    while (tries-- > 0) {
      const a = this.rng.range(0, Math.PI * 2), d = Math.sqrt(this.rng.next()) * R;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (!this.canGrow(px, pz)) continue;
      const sandy = this.world.sandy[this.world.cellIndexAt(px, pz)] > 0.4;
      const g = sandy ? 'palms' : this.rng.chance(0.6) ? st.groups[0] : st.groups[st.groups.length - 1];
      const o = this.rng.pick(TREE_GROUPS[g]);
      const s = this.rng.range(o.s[0], o.s[1]);
      if (!veg.roomForTree(px, pz, o.r * s) || !this.clearOfGarden(px, pz, 0.35)) continue;
      if (this.pay && !this.pay(GARDEN.treeCost)) {
        this.short = true;
        return n;
      }
      this.short = false;
      veg.plantTree(o.kind, this.rng.pick(o.variants), px, pz, this.rng.range(0, Math.PI * 2), s, this.rng.range(0.02, 0.15));
      this.treesPlanted++;
      n++;
    }
    return n;
  }

  /** No garden plant within `r` of here. */
  private clearOfGarden(x: number, z: number, r: number): boolean {
    return this.near(x, z, r + 0.6).every((p) => p.state === 2 || Math.hypot(p.x - x, p.z - z) >= r + VARIANTS[p.v].r * p.s * 0.5);
  }

  /** Garden full (the player is told). */
  get full(): boolean {
    return this.plants.length >= GARDEN.max;
  }

  private near(x: number, z: number, R: number): Plant[] {
    const w = this.world, out: Plant[] = [];
    const [cx, cz] = w.cellOf(x, z), n = Math.ceil(R) + 1;
    for (let dz = -n; dz <= n; dz++) {
      for (let dx = -n; dx <= n; dx++) {
        if (!w.inBounds(cx + dx, cz + dz)) continue;
        for (const p of this.grid.get(w.idx(cx + dx, cz + dz)) ?? []) if ((p.x - x) ** 2 + (p.z - z) ** 2 < R * R) out.push(p);
      }
    }
    return out;
  }

  /** Set a plant in the ground: `t` < 0 pops it up after that delay, NaN places it fully grown. */
  private add(v: number, x: number, z: number, rot: number, s: number, t: number): Plant {
    const w = this.world;
    const cell = w.cellIndexAt(x, z);
    const p: Plant = { v, x, z, y: w.heightAt(x, z), rot, s, t: Number.isNaN(t) ? 0 : t, state: Number.isNaN(t) ? 0 : 1, slot: -1, cell };
    const b = this.batches[v];
    if (b.plants.length >= b.mesh.instanceMatrix.count) this.grow(v);
    p.slot = b.plants.length;
    b.plants.push(p);
    b.mesh.count = b.shadow.count = b.plants.length;
    b.mesh.visible = b.shadow.visible = b.plants.length > 0;
    this.plants.push(p);
    let list = this.grid.get(cell);
    if (!list) this.grid.set(cell, (list = []));
    list.push(p);
    if (p.state === 1) this.moving.add(p);
    this.place(p);
    return p;
  }

  /** Double a variant's instance capacity. */
  private grow(v: number): void {
    const b = this.batches[v];
    const old = b.mesh;
    const mesh = new THREE.InstancedMesh(old.geometry, old.material, old.instanceMatrix.count * 2);
    mesh.instanceMatrix.array.set(old.instanceMatrix.array as Float32Array);
    mesh.count = old.count;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    this.group.remove(old, b.shadow);
    old.dispose();
    b.shadow.geometry.dispose();
    b.shadow = followerShadows(mesh, mesh.geometry);
    mesh.visible = b.shadow.visible = mesh.count > 0;
    this.group.add(mesh, b.shadow);
    b.mesh = mesh;
  }

  /** Start shrinking a plant away (removed once gone). */
  private dig(p: Plant, delay = 0): void {
    p.state = 2;
    p.t = -delay;
    this.moving.add(p);
  }

  private remove(p: Plant): void {
    const b = this.batches[p.v];
    const last = b.plants.pop()!;
    if (last !== p) {
      b.plants[p.slot] = last;
      last.slot = p.slot;
      this.place(last);
    }
    b.mesh.count = b.shadow.count = b.plants.length;
    b.mesh.visible = b.shadow.visible = b.plants.length > 0;
    b.mesh.instanceMatrix.needsUpdate = true;
    const i = this.plants.indexOf(p);
    if (i >= 0) {
      this.plants[i] = this.plants[this.plants.length - 1];
      this.plants.pop();
    }
    const list = this.grid.get(p.cell);
    if (list) {
      list.splice(list.indexOf(p), 1);
      if (!list.length) this.grid.delete(p.cell);
    }
    this.moving.delete(p);
  }

  /** The plant's size now: springing up past full size and settling, or shrinking away. */
  static popScale(state: number, t: number): { s: number; sy: number } {
    if (state === 1) return springPop(t, GARDEN.pop, 13, 6.5);
    if (state === 2) {
      const u = Math.max(0, Math.min(1, t / GARDEN.shrink));
      const s = (1 - u) * (1 - u);
      return { s, sy: s };
    }
    return { s: 1, sy: 1 };
  }

  private place(p: Plant): void {
    const b = this.batches[p.v];
    const k = Garden.popScale(p.state, p.t);
    if (k.s <= 0.001) {
      b.mesh.setMatrixAt(p.slot, ZERO);
    } else {
      _q.setFromAxisAngle(UP, p.rot + (p.state === 2 ? p.t * 6 : 0));
      _m.compose(_p.set(p.x, p.y - 0.01, p.z), _q, _s.set(k.s * p.s, k.sy * p.s, k.s * p.s));
      b.mesh.setMatrixAt(p.slot, _m);
    }
    b.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Earth and a few leaves thrown up as a plant pops out of the ground. */
  private puff(p: Plant): void {
    const big = VARIANTS[p.v].brush === 'bushes' ? 1.6 : 1;
    for (let k = 0; k < 4; k++) {
      const a = this.rng.range(0, Math.PI * 2), sp = this.rng.range(0.4, 0.9) * big;
      this.dust.spawn(p.x, p.y + 0.03, p.z, Math.cos(a) * sp, this.rng.range(0.5, 1.0), Math.sin(a) * sp, this.rng.range(0.35, 0.6), 0.08 * big, 0.2);
    }
    for (let k = 0; k < 3; k++) {
      const a = this.rng.range(0, Math.PI * 2), sp = this.rng.range(0.3, 0.8);
      this.flecks.spawn(p.x, p.y + 0.1 * big, p.z, Math.cos(a) * sp, this.rng.range(1.0, 1.8), Math.sin(a) * sp, this.rng.range(0.5, 0.8), 0.035, 0);
    }
  }

  private sound(name: string, x: number, z: number): void {
    if (this.clock - this.lastSound < 0.07) return;
    this.lastSound = this.clock;
    this.sfx?.(name, x, z);
  }

  update(dt: number): void {
    this.clock += dt;
    // Planted trees bursting out of the ground: a big puff of earth and leaves, and a whump.
    if (this.veg) {
      for (const t of this.veg.updatePops(dt)) {
        for (let k = 0; k < 9; k++) {
          const a = this.rng.range(0, Math.PI * 2), sp = this.rng.range(0.6, 1.5);
          this.dust.spawn(t.x, t.y + 0.05, t.z, Math.cos(a) * sp, this.rng.range(0.6, 1.3), Math.sin(a) * sp, this.rng.range(0.5, 0.9), 0.16, 0.35);
        }
        for (let k = 0; k < 10; k++) {
          const a = this.rng.range(0, Math.PI * 2), sp = this.rng.range(0.4, 1.2);
          this.flecks.spawn(t.x + Math.cos(a) * 0.3, t.y + 1.2 * t.scale, t.z + Math.sin(a) * 0.3, Math.cos(a) * sp, this.rng.range(0.5, 1.6), Math.sin(a) * sp, this.rng.range(0.8, 1.4), 0.05, 0);
        }
        this.sfx?.('treepop', t.x, t.z);
      }
      // A felled tree's crown hits the ground: dust and a shower of leaves.
      for (const l of this.veg.takeLanded()) {
        for (let k = 0; k < 14; k++) {
          const a = this.rng.range(0, Math.PI * 2), sp = this.rng.range(0.8, 2);
          this.dust.spawn(l.x + Math.cos(a) * 0.6 * l.r, l.y + 0.1, l.z + Math.sin(a) * 0.6 * l.r, Math.cos(a) * sp, this.rng.range(0.3, 0.9), Math.sin(a) * sp, this.rng.range(0.6, 1.1), 0.2, 0.35);
        }
        for (let k = 0; k < 16; k++) {
          const a = this.rng.range(0, Math.PI * 2), sp = this.rng.range(0.5, 1.6);
          this.flecks.spawn(l.x + Math.cos(a) * 0.8 * l.r, l.y + 0.5, l.z + Math.sin(a) * 0.8 * l.r, Math.cos(a) * sp, this.rng.range(1, 2.2), Math.sin(a) * sp, this.rng.range(1, 1.8), 0.05, 0);
        }
      }
    }
    for (const p of [...this.moving]) {
      const before = p.t;
      p.t += dt;
      if (p.state === 1 && before <= 0 && p.t > 0) {
        this.puff(p);
        this.sound('plant', p.x, p.z);
      }
      if (p.state === 2 && p.t >= GARDEN.shrink) {
        this.remove(p);
        continue;
      }
      if (p.state === 1 && p.t >= GARDEN.pop) {
        p.state = 0;
        this.moving.delete(p);
      }
      this.place(p);
    }
    // The land changed (sculpting, paths, buildings, fields): follow the ground, clear what can't grow.
    this.sweep -= dt;
    if (this.world.version !== this.version || this.sweep <= 0) {
      const moved = this.world.version !== this.version;
      this.version = this.world.version;
      this.sweep = 1.5;
      for (const p of this.plants) {
        if (p.state === 2) continue;
        if (!this.canGrow(p.x, p.z)) this.dig(p, this.rng.range(0, 0.15));
        else if (moved) {
          p.y = this.world.heightAt(p.x, p.z);
          this.place(p);
        }
      }
    }
    this.dust.update(dt, 1.8);
    this.flecks.update(dt, 3.5);
  }

  /** Saved as [variant, x, z, rotation, scale] per plant (positions in hundredths). */
  serialize(): number[] {
    const out: number[] = [];
    for (const p of this.plants) {
      if (p.state === 2) continue;
      out.push(p.v, Math.round(p.x * 100), Math.round(p.z * 100), Math.round(p.rot * 100), Math.round(p.s * 100));
    }
    return out;
  }

  /** Replant a saved garden, fully grown (anything that no longer fits is left out). */
  restore(data: number[]): void {
    for (const p of [...this.plants]) this.remove(p);
    for (let i = 0; i + 4 < data.length && this.plants.length < GARDEN.max; i += 5) {
      const v = data[i];
      if (!Number.isInteger(v) || v < 0 || v >= VARIANTS.length) continue;
      const x = data[i + 1] / 100, z = data[i + 2] / 100, s = THREE.MathUtils.clamp(data[i + 4] / 100, 0.2, 3);
      if (!this.canGrow(x, z)) continue;
      this.add(v, x, z, data[i + 3] / 100, s, NaN);
    }
  }
}

