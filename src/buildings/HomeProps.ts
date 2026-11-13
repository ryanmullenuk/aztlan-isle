import * as THREE from 'three';
import { GeoBuilder, M, P } from '../render/GeoBuilder';
import { RNG } from '../world/rng';

/** A cloth on a washing line (local to the house): the middle of its top edge, its turn, size and colour. */
export interface Cloth { x: number; y: number; z: number; ry: number; w: number; h: number; color: number }

/** The things a household keeps about its house: one geometry to merge into the model, and its washing. */
export interface HomeProps { geo: THREE.BufferGeometry | null; cloths: Cloth[] }

const c = (h: number) => new THREE.Color(h);
const TIMBER = c(0x7a5434), TIMBER_D = c(0x553722), ROPE = c(0xc9a86a), CLAY = c(0xb9623c), CLAY_D = c(0x8c4428), STONE = c(0x9a9084), STONE_D = c(0x6f675c);
const REED = c(0xcdb075), REED_D = c(0xa98a52), MAIZE = c(0xf0c23c), MAIZE_D = c(0xdf9f28), CHILLI = c(0xb5301f), FISH = c(0x8c9ca6), ASH = c(0x4a4038);
/** Washing: undyed cotton mostly, with the odd dyed piece. */
const CLOTHS = [0xf1e8d2, 0xe9dcc0, 0xf6f0e2, 0xb5463a, 0x3f8f86, 0xd9a441, 0xe6d3b0, 0x7a8fb5];

/**
 * What can stand in a place:
 *  J water jars · B baskets · M a sleeping mat with a bowl · G a grinding stone · C a griddle on
 *  three hearth stones · R a drying rack (maize, chillies or fish) · T tools leaning on the wall
 *  behind · W firewood stacked by the wall behind · H strings of maize and chillies hung on
 *  the wall behind · L a washing line.
 */
type Kind = 'J' | 'B' | 'M' | 'G' | 'C' | 'R' | 'T' | 'W' | 'H' | 'L';
/** A place for one thing: where (local, y = the floor there), which way its front faces (0 = +z), what fits, and a line's length. */
interface Slot { x: number; z: number; y?: number; ry?: number; kinds: string; len?: number; front?: boolean }

const R = Math.PI / 2;
/**
 * Places round each house, inside its own plot and clear of its doorway and the way to it, of
 * its torches, awning and plants (see hutModel and homeModel for what stands where). Places
 * marked `front` are left empty on houses whose district style already dresses the front.
 */
const SLOTS: Record<string, Slot[]> = {
  hut: [
    { x: 0.6, z: -0.08, ry: R, kinds: 'TWJ' },
    { x: 0.7, z: 0.5, kinds: 'JBG' },
    { x: -0.6, z: 0.05, ry: -R, kinds: 'TWJ' },
    { x: -0.74, z: 0.55, kinds: 'BJG' },
    { x: 0, z: -0.86, ry: Math.PI, kinds: 'LR', len: 1.2 },
    { x: -0.62, z: 0.78, kinds: 'MCB', front: true },
    { x: 0.62, z: 0.78, kinds: 'CMJ', front: true },
  ],
  home1: [
    { x: 0.975, z: -0.6, ry: R, kinds: 'TWJH' },
    { x: 1.3, z: -0.1, ry: R, kinds: 'L', len: 1.3 },
    { x: -0.975, z: -0.3, ry: -R, kinds: 'TWJG' },
    { x: -1.22, z: 0.42, kinds: 'JBG' },
    { x: 0.75, z: -0.93, ry: Math.PI, kinds: 'WTJ' },
    { x: -0.2, z: -1.3, ry: Math.PI, kinds: 'LR', len: 1.6 },
    { x: 1.2, z: 1.05, kinds: 'JBC', front: true },
    { x: 0.5, z: 0.93, kinds: 'MG' },
  ],
  // (Its foot band stands out as a low step in front of the right-hand block: things there stand on it.)
  home2: [
    { x: 0.68, z: 0.47, y: 0.16, kinds: 'TWHJ' },
    { x: 0.68, z: 1.15, kinds: 'MGCB' },
    { x: 1.225, z: -0.4, ry: R, kinds: 'TH' },
    { x: 0, z: -1.27, ry: Math.PI, kinds: 'LR', len: 1.8 },
    { x: -0.5, z: -0.98, ry: Math.PI, kinds: 'WJ' },
    { x: -1.225, z: -0.2, ry: -R, kinds: 'TH' },
    { x: -0.5, z: 0.4, y: 1.07, kinds: 'JBM' },
  ],
  // Level 4 and 5 houses fill their plots: the household lives on the roof terraces.
  home3: [
    { x: 0.7, z: 1.05, kinds: 'BJ' },
    { x: -0.55, z: 0.42, y: 1.12, kinds: 'L', len: 1.1 },
    { x: -0.3, z: 0.2, y: 1.12, kinds: 'JB' },
    { x: 0.6, z: -0.3, y: 1.12, kinds: 'MBJR' },
    { x: -0.6, z: -1.18, ry: Math.PI, kinds: 'TW' },
    { x: -0.12, z: 0.67, y: 0.16, kinds: 'THJ' },
  ],
  home4: [
    { x: -0.95, z: 0.62, y: 1.02, kinds: 'MJBG' },
    { x: -0.5, z: 0.88, y: 1.02, kinds: 'L', len: 1.3 },
    { x: -0.15, z: 0.55, y: 1.02, kinds: 'JB' },
    { x: 1.0, z: -0.3, y: 1.02, kinds: 'RBM' },
    { x: 0.25, z: -0.45, y: 2.02, kinds: 'JB' },
    { x: 0.5, z: -1.33, ry: Math.PI, kinds: 'T' },
  ],
};

/** How many things a household has gathered: a couple round a hut, more with every level of house. */
export function propCount(key: string, tier: number): number {
  return key === 'hut' ? 3 : key === 'home' ? 3 + Math.min(4, Math.max(1, tier)) : 0;
}

function jar(b: GeoBuilder, m: THREE.Matrix4, x: number, z: number, s: number, lid: boolean): void {
  b.add(P.uvSphere(0.075 * s, 7, 5), { color: (p) => (p.y % 0.09 < 0.02 ? CLAY_D : CLAY) }, m.clone().multiply(M.t(x, 0.085 * s, z, 0, 0, 0, 1, 1.2, 1)));
  b.add(P.cyl(0.04 * s, 0.03 * s, 0.05 * s, 6), { color: CLAY_D }, m.clone().multiply(M.t(x, 0.185 * s, z)));
  if (lid) b.add(P.cyl(0.05 * s, 0.05 * s, 0.012, 6), { color: REED_D }, m.clone().multiply(M.t(x, 0.215 * s, z)));
}

function basket(b: GeoBuilder, m: THREE.Matrix4, x: number, z: number, s: number, fill: THREE.Color | null): void {
  b.add(P.cyl(0.075 * s, 0.058 * s, 0.1 * s, 8), { color: (p) => ((p.y * 55) % 1 < 0.5 ? REED : REED_D) }, m.clone().multiply(M.t(x, 0.05 * s, z)));
  if (fill) b.add(P.sphere(0.066 * s, 0), { color: fill }, m.clone().multiply(M.t(x, 0.095 * s, z, 0, 0, 0, 1, 0.5, 1)));
}

/** Build one thing at a place (its front along the place's +z, any wall behind it at −z). */
function prop(b: GeoBuilder, kind: Kind, m: THREE.Matrix4, rng: RNG, slot: Slot, cloths: Cloth[]): void {
  const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => m.clone().multiply(M.t(x, y, z, rx, ry, rz, sx, sy, sz));
  switch (kind) {
    case 'J': {
      // Water jars: one big, perhaps a smaller one or two beside it, one with a reed lid.
      const n = rng.int(1, 3);
      jar(b, m, 0, 0.02, rng.range(1, 1.25), rng.chance(0.5));
      if (n > 1) jar(b, m, 0.15, 0.08, rng.range(0.7, 0.9), false);
      if (n > 2) jar(b, m, -0.14, 0.1, rng.range(0.6, 0.8), true);
      break;
    }
    case 'B': {
      const fills = [MAIZE, c(0x8a5a30), c(0xc0452c), c(0x6f9a3c), null];
      basket(b, m, 0, 0.02, rng.range(1, 1.3), rng.pick(fills));
      if (rng.chance(0.7)) basket(b, m, 0.17, 0.09, rng.range(0.75, 0.95), rng.pick(fills));
      if (rng.chance(0.35)) basket(b, m, -0.15, 0.1, 0.8, null);
      break;
    }
    case 'M': {
      // A woven reed mat with dyed bands, a bowl left on it.
      const band = rng.pick([c(0xa64032), c(0x327879), c(0x8a5a30)]);
      b.add(P.box(0.4, 0.012, 0.27), { color: REED }, at(0, 0.008, 0));
      for (const x of [-0.14, 0, 0.14]) b.add(P.box(0.035, 0.014, 0.272), { color: band }, at(x, 0.008, 0));
      b.add(P.cyl(0.05, 0.03, 0.03, 7), { color: CLAY }, at(rng.range(-0.1, 0.1), 0.03, rng.range(-0.05, 0.05)));
      break;
    }
    case 'G': {
      // The grinding stone: a sloping slab on stub feet, its roller across it and a heap of meal, a bowl of soaked maize beside.
      b.add(P.box(0.2, 0.035, 0.13), { color: STONE }, at(0, 0.06, 0, 0, 0, 0.16));
      for (const x of [-0.07, 0.07]) b.add(P.box(0.03, 0.06 + x * 0.2, 0.1), { color: STONE_D }, at(x, 0.025 + x * 0.1, 0));
      b.add(P.cyl(0.02, 0.02, 0.17, 6), { color: STONE_D }, at(0.02, 0.1, 0, R, 0, 0));
      b.add(P.sphere(0.035, 0), { color: c(0xeeddaa) }, at(-0.05, 0.075, 0, 0, 0, 0, 1, 0.5, 1));
      b.add(P.cyl(0.055, 0.035, 0.04, 7), { color: CLAY }, at(0.2, 0.02, 0.05));
      b.add(P.cyl(0.046, 0.046, 0.006, 7), { color: MAIZE }, at(0.2, 0.038, 0.05));
      break;
    }
    case 'C': {
      // The outdoor hearth: three stones, ash and charred sticks between them, a clay griddle on top with a tortilla or two.
      b.add(P.cyl(0.13, 0.15, 0.012, 8), { color: ASH }, at(0, 0.008, 0));
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.4;
        b.add(P.sphere(0.045, 0), { color: k % 2 ? STONE : STONE_D }, at(Math.cos(a) * 0.085, 0.035, Math.sin(a) * 0.085, 0, a, 0, 1, 0.9, 1));
      }
      for (let k = 0; k < 2; k++) b.add(P.cyl(0.012, 0.012, 0.16, 4), { color: c(0x2c2019) }, at(0, 0.025, 0, R, k * 1.1, 0));
      b.add(P.cyl(0.12, 0.11, 0.014, 9), { color: CLAY_D }, at(0, 0.082, 0));
      for (let k = 0; k < rng.int(1, 2); k++) b.add(P.cyl(0.04, 0.04, 0.006, 7), { color: c(0xf0dca0) }, at(-0.04 + k * 0.08, 0.093, 0.01 * k));
      break;
    }
    case 'R': {
      // A drying rack: two forked posts and a pole, hung with maize, chillies or split fish.
      const what = rng.pick(['maize', 'chilli', 'fish'] as const), half = 0.3, h = 0.5;
      for (const s of [-1, 1]) b.add(P.cyl(0.014, 0.018, h, 5), { color: TIMBER_D }, at(s * half, h / 2, 0, 0, 0, s * 0.05));
      b.add(P.cyl(0.011, 0.011, half * 2 + 0.1, 5), { color: TIMBER }, at(0, h - 0.02, 0, 0, 0, R));
      for (let k = 0; k < 6; k++) {
        const x = -half + 0.06 + k * ((half * 2 - 0.12) / 5), drop = rng.range(0, 0.03);
        if (what === 'maize') b.add(P.cyl(0.02, 0.012, 0.11, 5), { color: k % 3 ? MAIZE : MAIZE_D }, at(x, h - 0.09 - drop, 0));
        else if (what === 'chilli') b.add(P.cone(0.02, 0.12, 5), { color: CHILLI.clone().multiplyScalar(rng.range(0.8, 1.15)) }, at(x, h - 0.09 - drop, 0, Math.PI, 0, 0));
        else b.add(P.sphere(0.04, 0), { color: FISH.clone().multiplyScalar(rng.range(0.85, 1.1)) }, at(x, h - 0.1 - drop, 0, 0, 0, 0, 0.45, 1.5, 0.8));
      }
      break;
    }
    case 'T': {
      // Tools leaning on the wall: a digging stick with its broad blade, a hoe or a fishing spear, and a broom.
      const lean = (x: number, len: number, col: THREE.Color, tilt: number) => {
        // Foot out from the wall, top resting against it.
        const a = 0.22;
        b.add(P.cyl(0.011, 0.013, len, 5), { color: col }, at(x, (len / 2) * Math.cos(a), 0.02 + (len / 2) * Math.sin(a), -a, 0, tilt));
      };
      lean(-0.08, 0.5, TIMBER, 0.04);
      b.add(P.box(0.05, 0.11, 0.012), { color: TIMBER_D }, at(-0.08, 0.06, 0.125, -0.22, 0, 0.04));
      if (rng.chance(0.6)) {
        lean(0.05, 0.56, TIMBER_D, -0.06);
        b.add(P.cone(0.016, 0.07, 4), { color: STONE_D }, at(0.083, 0.575, 0.02, -0.22, 0, -0.06));
      }
      if (rng.chance(0.6)) {
        lean(0.17, 0.4, TIMBER, 0.02);
        b.add(P.cone(0.045, 0.12, 6), { color: REED_D }, at(0.17, 0.065, 0.1, -0.22, 0, 0));
      }
      break;
    }
    case 'W': {
      // Firewood, split and stacked against the wall, the cut ends pale.
      const rows = rng.int(2, 3);
      for (let r = 0; r < rows; r++) for (let k = 0; k < 4 - r; k++) {
        b.add(P.cyl(0.04, 0.04, rng.range(0.2, 0.26), 6), { color: (k + r) % 3 === 0 ? c(0x9a7248) : k % 2 ? TIMBER : TIMBER_D },
          at(-0.13 + (k + r * 0.5) * 0.086, 0.04 + r * 0.07, 0.13, R, 0, 0));
      }
      break;
    }
    case 'H': {
      // Strings hung from a peg on the wall: maize cobs by their husks, and a ristra of chillies.
      const y = 0.62;
      b.add(P.box(0.3, 0.018, 0.02), { color: TIMBER_D }, at(0, y, 0.015));
      for (let k = 0; k < 3; k++) b.add(P.cyl(0.02, 0.013, 0.11, 5), { color: k % 2 ? MAIZE : MAIZE_D }, at(-0.11 + k * 0.035, y - 0.07 - (k % 2) * 0.02, 0.03));
      for (let k = 0; k < 5; k++) b.add(P.cone(0.016, 0.07, 4), { color: CHILLI.clone().multiplyScalar(0.85 + (k % 3) * 0.12) }, at(0.08 + (k % 2) * 0.025, y - 0.05 - k * 0.035, 0.03, Math.PI, 0, (k % 2 ? 1 : -1) * 0.4));
      break;
    }
    case 'L': {
      // The washing line: two posts, a cord sagging between them, cloths pegged along it (drawn by Washing, so they can stir).
      const len = slot.len ?? 1.2, half = len / 2, h = 0.56, sag = 0.045;
      for (const s of [-1, 1]) {
        b.add(P.cyl(0.014, 0.019, h + 0.04, 5), { color: TIMBER_D }, at(s * half, (h + 0.04) / 2, 0, 0, 0, s * -0.04));
        // The cord, in two straight runs down to the middle.
        const run = Math.hypot(half, sag);
        b.add(P.box(run, 0.008, 0.008), { color: ROPE }, at(s * half / 2, h - sag / 2, 0, 0, 0, s * Math.atan2(sag, half)));
      }
      const n = Math.max(2, Math.round(len / 0.34)), gap = (len - 0.2) / n;
      const p = new THREE.Vector3();
      for (let k = 0; k < n; k++) {
        if (rng.chance(0.18)) continue;
        const w = Math.min(gap - 0.04, rng.range(0.17, 0.3)), x = -half + 0.1 + gap * (k + 0.5) + rng.range(-0.02, 0.02);
        const y = h - sag * (1 - Math.abs(x) / half) - 0.004;
        p.set(x, y, 0).applyMatrix4(m);
        cloths.push({ x: p.x, y: p.y, z: p.z, ry: slot.ry ?? 0, w, h: rng.range(0.2, 0.34), color: rng.chance(0.6) ? CLOTHS[rng.int(0, 2)] : rng.pick(CLOTHS) });
      }
      break;
    }
  }
}

/**
 * The things round a house, from a seed: the same house (the same seed) always has the same
 * things in the same places, and no two houses quite match. A better house has gathered more.
 * `plain` is false for houses in a district style that already dresses its front.
 */
export function homeProps(key: string, tier: number, seed: number, plain = true): HomeProps {
  const slots = SLOTS[key === 'hut' ? 'hut' : key === 'home' ? `home${Math.min(4, Math.max(1, tier))}` : ''];
  const cloths: Cloth[] = [];
  if (!slots) return { geo: null, cloths };
  const rng = new RNG((seed ^ 0x40e5) + tier * 977);
  const free = slots.filter((s) => plain || !s.front);
  // A seeded shuffle of the places; the first few are filled.
  for (let i = free.length - 1; i > 0; i--) { const j = rng.int(0, i); [free[i], free[j]] = [free[j], free[i]]; }
  const b = new GeoBuilder(), used = new Set<string>();
  for (const s of free.slice(0, propCount(key, tier))) {
    // The first thing that fits here and is not already somewhere else (jars and baskets can repeat).
    const kinds = s.kinds.split('') as Kind[];
    const start = rng.int(0, kinds.length - 1);
    let kind: Kind | null = null;
    for (let k = 0; k < kinds.length && !kind; k++) {
      const t = kinds[(start + k) % kinds.length];
      if (!used.has(t) || t === 'J' || t === 'B') kind = t;
    }
    if (!kind) continue;
    used.add(kind);
    prop(b, kind, M.t(s.x, s.y ?? 0, s.z, 0, s.ry ?? 0, 0), rng, s, cloths);
  }
  return { geo: b.vertexCount ? b.build() : null, cloths };
}
