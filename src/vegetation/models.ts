import * as THREE from 'three';
import { COLORS } from '../config';
import { GeoBuilder, M, P, doubleSide, lumpy, outward, ribbon, tube, type ColorFn } from '../render/GeoBuilder';
import { RNG } from '../world/rng';
import { angularRockGeometry, boulderGeometry, rockColor } from '../render/rocks';
import { BARK, FINE, barkColor, foliage, hangingVine, leafGeometry, liana, phash, roots } from './detail';
import { frondGeometry, leafClump } from './detail';
import { flowerHead } from './flowerParts';

const c = (h: number) => new THREE.Color(h);
const mix = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, THREE.MathUtils.clamp(t, 0, 1));

const PAL = {
  trunk: c(0x9c7a52),
  trunkDark: c(0x6e5236),
  frondBase: c(0x33602c),
  frondMid: c(0x557f38),
  frondTip: c(COLORS.frondTip),
  jungleDark: c(COLORS.jungleDark),
  jungleBright: c(COLORS.jungleBright),
  jungleSun: c(0x82a04a),
  bark: c(0x6b4a2e),
  fern: c(0x3e6d30),
  fernTip: c(0x7c9a46),
  bushDark: c(0x31592b),
  bushLight: c(0x63853c),
  apple: c(0xd8352a),
  banana: c(0xf2d33a),
  bananaLeaf: c(0x4d8038),
  bananaTip: c(0x8ca84a),
  stumpTop: c(0xdcbb8c),
};

/**
 * Palm: a ringed trunk swelling at the foot, under a crown of fronds in three ages: young ones
 * standing round the spear, full ones arching out, old ones hanging below, with coconuts tucked
 * under them. variant 0 near-straight, 1 leaning out and curving back up, 2 curved.
 */
export function palmGeometry(variant: number, lo: boolean, seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  /** Separate stream for fine detail, so leaving it out (mid LOD) never moves the main shapes. */
  const dr = new RNG(seed * 31 + 7);
  const b = new GeoBuilder();
  const H = 3.1 + variant * 0.2;
  const pts: THREE.Vector3[] = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let x = Math.sin(t * Math.PI) * 0.09, z = Math.sin(t * Math.PI * 2) * 0.04;
    if (variant === 1) { x = H * 0.38 * (1.55 * t - 0.55 * t * t); z = Math.sin(t * Math.PI) * 0.06; }
    if (variant === 2) { x = Math.sin(t * Math.PI * 0.9) * 0.45 + t * t * 0.5; z = Math.sin(t * Math.PI * 2) * 0.07; }
    pts.push(new THREE.Vector3(x, t * H, z));
  }
  const top = pts[n].clone();
  // Swollen foot, slow taper, and a slight thickening where the frond bases wrap the top.
  const rad = (t: number) => 0.074 + 0.04 * (1 - t) + 0.08 * Math.pow(1 - t, 8) + 0.024 * Math.exp(-Math.pow((t - 0.96) / 0.06, 2));
  b.add(tube(pts, rad, lo ? 5 : 7, lo ? 4 : 9), {
    color: (p) => {
      const band = (p.y * 4.2) % 1 < 0.22 ? 0.76 : 1;
      return mix(PAL.trunkDark, PAL.trunk, 0.42 + (p.y / H) * 0.58).multiplyScalar(band);
    },
    sway: (p) => (p.y / H) * 0.45,
    ao: { y0: 0, y1: 0.8, min: 0.7 },
  });
  const spearA = rng.range(0, Math.PI * 2);
  if (!lo) {
    // The crown's heart: the fibrous knot of frond bases, the unopened spear, and the coconuts.
    b.add(P.sphere(0.15, 0), { color: 0x6f6a38, sway: 0.45 }, M.t(top.x, top.y + 0.02, top.z, 0, spearA, 0, 1, 1.25, 1));
    const sd = new THREE.Vector3(Math.cos(spearA), 0, Math.sin(spearA));
    b.add(ribbon((t) => top.clone().add(new THREE.Vector3(sd.z * 0.08 * t * t, 0.08 + 0.36 * t, -sd.x * 0.08 * t * t)), (t) => 0.05 * (1 - t) + 0.006, 2, sd, 0.6), { color: mix(PAL.frondMid, PAL.frondTip, 0.6), leaf: 1, sway: (p) => 0.5 + (p.y - top.y) * 0.5 });
    const nuts = [0x6b4a26, 0x86913e, 0x5e4222, 0x94803a];
    for (let k = 0; k < 4; k++) {
      const a = spearA + (k / 4) * Math.PI * 2 + (k % 2) * 0.35, r = 0.15 + (k % 2) * 0.03;
      b.add(P.sphere(0.115, 0), { color: nuts[k], sway: 0.45 }, M.t(top.x + Math.cos(a) * r, top.y - 0.2 - (k % 2) * 0.08, top.z + Math.sin(a) * r, k, a, 0, 1, 1.15, 1));
    }
  }
  const N = 11;
  for (let f = 0; f < N; f++) {
    /** 0 young and upright, 1 full and arching, 2 old and hanging. */
    const tier = f < 3 ? 0 : f < 8 ? 1 : 2;
    const a = f * 2.39996 + spearA + rng.range(-0.22, 0.22);
    const L = tier === 0 ? rng.range(1.1, 1.35) : tier === 1 ? rng.range(1.6, 1.9) : rng.range(1.3, 1.55);
    const lift = tier === 0 ? rng.range(0.9, 1.1) : tier === 1 ? rng.range(0.45, 0.8) : rng.range(-0.1, 0.15);
    const droop = tier === 0 ? 1.1 : tier === 1 ? 1.3 : 1.2;
    const reach = L * (tier === 0 ? 0.7 : tier === 1 ? 1 : 0.85);
    // From afar a thinner crown, keeping some of each age.
    if (lo && (f === 2 || f === 7 || f === 10)) continue;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const segs = lo ? 3 : 6;
    const spine = (t: number) => top.clone().addScaledVector(dir, (reach * (t - 0.14 * t * t)) / 0.86).add(new THREE.Vector3(0, lift * t - droop * t * t, 0));
    const frondCol = (p: THREE.Vector3) => {
      const d = Math.hypot(p.x - top.x, p.z - top.z) / reach;
      const col = d < 0.5 ? mix(PAL.frondBase, PAL.frondMid, d * 2) : mix(PAL.frondMid, PAL.frondTip, (d - 0.5) * 1.6);
      if (tier === 0) return col.lerp(PAL.frondTip, 0.2);
      return tier === 2 ? col.lerp(PALM_DRY, 0.12 + d * 0.3) : col;
    };
    const frondSway = (p: THREE.Vector3) => 0.5 + (Math.hypot(p.x - top.x, p.z - top.z) / reach) * 0.9;
    if (lo || !FINE.on) {
      const wide = (lo ? 0.3 : 0.26) * (tier === 0 ? 0.8 : 1);
      b.add(ribbon(spine, (t) => wide * Math.sin(Math.PI * Math.pow(t, 0.75)) + 0.02, segs, side, 0.55), { color: frondCol, leaf: 1, sway: frondSway });
      continue;
    }
    // Close up: a thin midrib with separate leaflets hanging from both sides of it.
    b.add(ribbon(spine, (t) => 0.026 * (1 - t) + 0.006, segs, side, 0.2), { color: (p) => frondCol(p).multiplyScalar(0.8), leaf: 1, sway: frondSway });
    const nl = 10;
    for (let k = 0; k < nl; k++) {
      const t = 0.1 + (k / (nl - 1)) * 0.87;
      const p0 = spine(t);
      const tan = spine(Math.min(1, t + 0.02)).sub(spine(Math.max(0, t - 0.02))).normalize();
      const len = (0.46 * Math.sin(Math.PI * Math.pow(t, 0.8)) + 0.1) * (tier === 0 ? 0.8 : 1);
      for (const sd of [1, -1]) {
        const ax = side.clone().multiplyScalar(sd).addScaledVector(tan, 0.7).add(new THREE.Vector3(0, -0.3 - t * 0.4 - tier * 0.18, 0)).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), ax);
        const roll = new THREE.Quaternion().setFromAxisAngle(ax, sd * 0.5);
        b.add(leafGeometry(len, 0.058, 0.5), { color: frondCol(p0).multiplyScalar(0.9 + dr.next() * 0.2), leaf: 1, sway: frondSway(p0) + 0.15 }, new THREE.Matrix4().compose(p0, roll.multiply(q), new THREE.Vector3(1, 1, 1)));
      }
    }
  }
  return b.build();
}

/**
 * Tall jungle broadleaf: a flared, bowed trunk forking into limbs under a crown built of several
 * leafy masses at different heights. Variant 0 carries a low side limb; variant 1 is taller with
 * a wider, flatter crown, a vine up its trunk and more hanging from the crown.
 */
export function broadleafGeometry(variant: number, lo: boolean, seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  /** Separate stream for fine detail, so leaving it out (mid LOD) never moves the main shapes. */
  const dr = new RNG(seed * 31 + 7);
  const br = new RNG(seed * 53 + 1);
  const b = new GeoBuilder();
  const tall = variant !== 0;
  const trunkH = tall ? 2.5 : 1.9;
  const t = trunk(b, trunkH, 0.2, 0.11, lo, rng, 0.1, 0.95);
  if (!lo && tall) boleVine(b, t, trunkH + 0.3, dr, TREE.vine, TREE.lime);
  const cx = t.top.x * 0.6, cz = t.top.z * 0.6, cy = trunkH + 0.7;
  const sides = tall ? 4 : 3;
  const a0 = rng.range(0, Math.PI * 2);
  lobe(b, cx, cy + 0.42, cz, tall ? 1.0 : 0.95, 0.8, seed * 13, lo, LEAF.jungle);
  const tips: THREE.Vector3[] = [];
  for (let k = 0; k < sides; k++) {
    const a = a0 + (k / sides) * Math.PI * 2 + rng.range(-0.25, 0.25);
    const r = tall ? rng.range(0.7, 0.9) : rng.range(0.6, 0.85);
    const rad = rng.range(0.58, 0.78);
    // Staggered heights, so the crown steps up round the tree instead of sitting level.
    const y = cy + (tall ? 0.02 : -0.28) + ((k * 2) % sides) * (tall ? 0.1 : 0.24) + rng.range(-0.06, 0.06);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    lobe(b, x, y, z, rad, tall ? 0.64 : 0.76, seed * 13 + k + 1, lo, LEAF.jungle);
    const tip = new THREE.Vector3(cx + Math.cos(a) * r * 0.8, y - rad * 0.32, cz + Math.sin(a) * r * 0.8);
    if (!lo) limb(b, t.at(br.range(0.66, 0.92)), tip, 0.065, false, br, trunkH);
    tips.push(tip);
  }
  {
    // A lower limb: a small spray of leaves on its own bough (variant 0), or a bare snag (variant 1).
    const a = a0 + Math.PI / sides + rng.range(-0.2, 0.2);
    const from = t.at(tall ? 0.62 : 0.7);
    if (!tall) {
      const p = new THREE.Vector3(cx + Math.cos(a) * 0.98, trunkH - 0.02, cz + Math.sin(a) * 0.98);
      lobe(b, p.x, p.y, p.z, 0.44, 0.75, seed * 13 + 7, lo, LEAF.jungle, lo);
      limb(b, from, new THREE.Vector3(p.x - Math.cos(a) * 0.12, p.y - 0.08, p.z - Math.sin(a) * 0.12), 0.055, lo, br, trunkH);
    } else if (!lo) {
      limb(b, from, new THREE.Vector3(from.x + Math.cos(a) * 0.5, from.y + 0.42, from.z + Math.sin(a) * 0.5), 0.05, false, br, trunkH);
    }
  }
  if (!lo) {
    // Hanging vines under the crown and lianas slung between its limbs.
    const vr = new RNG(seed * 59 + 3);
    const nv = tall ? 5 : 2;
    for (let v = 0; v < nv; v++) hangingVine(b, new THREE.Vector3(cx + vr.range(-0.9, 0.9), cy - 0.3, cz + vr.range(-0.9, 0.9)), vr.range(0.6, tall ? 1.8 : 1.1), vr, TREE.vine, TREE.lime);
    for (let v = 0; v + 1 < tips.length; v += 2) liana(b, tips[v], tips[v + 1], vr.range(0.3, 0.7), vr, TREE.vine, TREE.lime);
  }
  return b.build();
}
/**
 * Forest-floor fern: a crown of arching fronds, each a row of pointed leaflets tapering to its tip,
 * with a couple of pale young fronds standing in the middle. Faces up only (drawn double-sided).
 */
export function fernGeometry(lo: boolean, seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  const deep = c(0x2c5a2a), young = c(0x9dc050);
  const frond = (a: number, L: number, up: number, down: number, pairs: number, w: number, roll: number, fresh: number, tone: number) => {
    const m = new THREE.Matrix4().makeRotationY(Math.PI / 2 - a).multiply(new THREE.Matrix4().makeRotationZ(roll));
    m.setPosition(Math.cos(a) * 0.015, 0.02, Math.sin(a) * 0.015);
    b.add(frondGeometry(L, up, down, pairs, w, seed * 13 + Math.round(a * 100)), {
      // Deep green at the heart, lighter along the frond, each leaflet its own shade.
      color: (p) => {
        const t = Math.hypot(p.x, p.z) / L;
        const j = Math.sin(p.x * 91.7 + p.z * 57.3 + p.y * 33.1) * 0.5 + 0.5;
        return mix(mix(deep, PAL.fern, t * 2.2 + tone), mix(PAL.fernTip, young, fresh), t * 1.1 - 0.25 + j * 0.3 + fresh * 0.4).multiplyScalar(0.94 + j * 0.12);
      },
      leaf: 1,
      facet: true,
      sway: (p) => Math.hypot(p.x, p.z) * 0.9,
    }, m);
  };
  const n = 6;
  for (let f = 0; f < n; f++) {
    const a = (f / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const L = rng.range(0.5, 0.7);
    const arch = rng.range(0.8, 1.2), roll = rng.range(-0.25, 0.25), tone = rng.range(-0.15, 0.25);
    frond(a, L, 0.7 * arch, 0.66 * arch, lo ? 2 : 7, lo ? 0.17 : 0.15, roll, 0, tone);
  }
  if (!lo) {
    // Young fronds, still half upright.
    for (let f = 0; f < 2; f++) {
      const a = rng.range(0, Math.PI * 2);
      frond(a, rng.range(0.26, 0.34), 0.4, 0.17, 4, 0.085, rng.range(-0.3, 0.3), 1, 0.3);
    }
  }
  return b.build();
}

/**
 * Rounded bush: a mound of three or four leafy clumps (a big one in the middle, smaller ones leaning
 * out round it, each its own shade of green) on woody stems, optionally in flower (red, coral and
 * orange blooms sitting on its sunlit side).
 */
export function bushGeometry(flowers: boolean, lo: boolean, seed: number, apple = false): THREE.BufferGeometry {
  const rng = new RNG(seed);
  /** Separate stream for fine detail, so leaving it out (mid LOD) never moves the main shapes. */
  const dr = new RNG(seed * 31 + 7);
  const b = new GeoBuilder();
  const blobs = 3 + (seed % 2);
  const light = apple ? c(0x5a8739) : PAL.bushLight;
  // The clumps first (the heart of each hides the leaves of its neighbours that would grow inside it).
  const clumps: number[][] = [];
  for (let k = 0; k < blobs; k++) {
    const a = (k / blobs) * Math.PI * 2 + (k ? rng.range(-0.25, 0.25) : 0);
    const r = k === 0 ? 0 : rng.range(0.25, 0.3);
    const rad = k === 0 ? 0.48 : rng.range(0.3, 0.4);
    clumps.push([Math.cos(a) * r, rad * 0.75 + (k === 0 ? 0.08 : rng.range(0, 0.05)), Math.sin(a) * r, rad]);
  }
  const sites: THREE.Vector3[] = [];
  clumps.forEach(([bx, by, bz, rad], k) => {
    // Each clump a little warmer or cooler than the next.
    const lt = mix(light, k % 2 ? c(0x86a03c) : c(0x4c8442), k === 0 ? 0 : 0.3);
    sites.push(...leafClump(b, bx, by, bz, rad, 0.8, seed + k * 7, lo, {
      dark: PAL.bushDark,
      light: lt,
      sun: mix(lt, c(0x9db455), 0.55),
      fresh: c(0xb4cc5c),
      len: 0.2,
      w: 0.09,
      sway: 0.12 + by * 0.25,
    }, clumps.filter((_, i) => i !== k)));
  });
  if (!lo) {
    // Woody stems at the base, showing between the leaves.
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + rng.next();
      b.add(tube([new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(Math.cos(a) * 0.12, 0.14, Math.sin(a) * 0.12), new THREE.Vector3(Math.cos(a) * 0.26, 0.3, Math.sin(a) * 0.26)], (t) => 0.03 * (1 - 0.6 * t), FINE.on ? 4 : 3, FINE.on ? 3 : 2), { color: BARK.mid, sway: (p) => p.y * 0.2 });
    }
  }
  if (flowers && !lo) {
    // Blooms on the sunlit side: mostly red and coral, the odd orange one, a few pale.
    const red = c(COLORS.flowerRed), coral = c(0xf2735e), orange = c(COLORS.flowerOrange), pale = c(0xffd0d8);
    for (let k = 0; k < 10 && sites.length; k++) {
      const at = sites.splice(dr.int(0, sites.length - 1), 1)[0];
      const roll = dr.next();
      const [c0, c1] = roll < 0.6 ? [red, coral] : roll < 0.8 ? [orange, c(0xffb45a)] : [coral, pale];
      flowerHead(b, at, dr.range(0.11, 0.14), c0, c1, dr, 5, 0.45, 0.2);
    }
  }
  return b.build();
}

/** Red apples dotted over the apple bush surface (separate mesh so they can be harvested). */
export function appleFruitGeometry(seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  for (let k = 0; k < 8; k++) {
    const th = rng.range(0, Math.PI * 2), ph = rng.range(0.4, 1.35);
    const r = 0.52;
    b.add(P.uvSphere(0.075, 7, 5), { color: (_p, nn) => mix(PAL.apple, c(0xff8a6a), Math.max(0, nn.y) * 0.5), sway: 0.2 }, M.t(Math.cos(th) * Math.sin(ph) * r, 0.42 + Math.cos(ph) * r * 0.75, Math.sin(th) * Math.sin(ph) * r));
  }
  return b.build();
}

/**
 * Banana plant: a sheathed pseudostem with broad paddle leaves, pale down the midrib: young ones
 * standing, full ones arching over, and old ones hanging, drying toward their tips.
 */
export function bananaGeometry(lo: boolean, seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  const h = 1.55;
  const stem = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.025, 0.5, 0.012), new THREE.Vector3(-0.03, 1.05, 0), new THREE.Vector3(0, h, 0)];
  b.add(tube(stem, (t) => 0.115 - 0.05 * t + 0.035 * Math.pow(1 - t, 5), lo ? 5 : 6, lo ? 2 : 3), {
    color: (p) => {
      // Overlapping leaf sheaths: green bands, dry and brown toward the foot.
      const band = (p.y * 3.1 + Math.atan2(p.z, p.x) * 0.25 + 9) % 1 < 0.3 ? 0.84 : 1;
      return mix(c(0x6f7a34), c(0x93a34a), p.y / h).lerp(BANANA_DRY, THREE.MathUtils.clamp(0.55 - p.y * 1.1, 0, 0.55)).multiplyScalar(band);
    },
    sway: (p) => p.y * 0.12,
    ao: { y0: 0, y1: 1, min: 0.7 },
  });
  const crown = new THREE.Vector3(0, h - 0.05, 0);
  const a0 = rng.range(0, Math.PI * 2);
  if (!lo) {
    // The new leaf, still rolled, standing in the middle.
    const sd = new THREE.Vector3(Math.cos(a0), 0, Math.sin(a0));
    b.add(ribbon((t) => crown.clone().add(new THREE.Vector3(-sd.z * 0.08 * t, 0.42 * t, sd.x * 0.08 * t)), (t) => 0.045 * (1 - t * t) + 0.004, 2, sd, 0.9), { color: PAL.bananaTip, leaf: 1, sway: (p) => 0.3 + (p.y - h) * 0.5 });
  }
  const N = 7;
  for (let f = 0; f < N; f++) {
    /** 0 young and standing, 1 arching, 2 old and hanging. */
    const age = f < 2 ? 0 : f < 5 ? 1 : 2;
    const a = a0 + f * 2.39996 + rng.range(-0.2, 0.2);
    const L = age === 0 ? rng.range(0.95, 1.1) : age === 1 ? rng.range(1.15, 1.4) : rng.range(1.0, 1.2);
    const lift = age === 0 ? rng.range(0.85, 1.0) : age === 1 ? rng.range(0.55, 0.8) : rng.range(0.15, 0.35);
    const droop = age === 0 ? 0.7 : age === 1 ? 0.95 : 1.15;
    if (lo && (f === 1 || f === 6)) continue;
    const reach = L * (age === 0 ? 0.6 : age === 1 ? 1 : 0.8);
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const spine = (t: number) => crown.clone().addScaledVector(dir, reach * t).add(new THREE.Vector3(0, lift * t - droop * t * t, 0));
    // A stalk, then the broad blade rounding off to its tip.
    const width = (t: number) => (t < 0.08 ? 0.035 : 0.25 * Math.pow(Math.sin(Math.PI * Math.pow((t - 0.08) / 0.92, 0.6)), 0.8) + 0.018) * (age === 0 ? 0.8 : 1);
    const paint = () => {
      let i = 0;
      // ribbon() lays its vertices edge, midrib, edge: every second of three is on the pale rib.
      return (p: THREE.Vector3) => {
        const d = Math.hypot(p.x, p.z) / reach;
        const col = mix(PAL.bananaLeaf, PAL.bananaTip, d * (age === 0 ? 1.1 : 0.65));
        if (age === 2) col.lerp(BANANA_DRY, d * 0.4);
        return i++ % 3 === 1 ? col.lerp(BANANA_RIB, 0.45) : col;
      };
    };
    const sway = (p: THREE.Vector3) => 0.3 + Math.hypot(p.x, p.z) * 0.6;
    b.add(ribbon(spine, width, lo ? 3 : 6, side, 0.25), { color: paint(), leaf: 1, sway });
  }
  return b.build();
}

/** Hanging yellow banana bunch (separate mesh, harvestable). */
export function bananaBunchGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  // The stalk arches out of the crown and hangs.
  b.add(tube([new THREE.Vector3(0.03, 1.5, 0), new THREE.Vector3(0.13, 1.49, 0), new THREE.Vector3(0.16, 1.3, 0), new THREE.Vector3(0.16, 1.0, 0)], () => 0.02, 4, 4), { color: 0x6f7a34, sway: 0.2 });
  for (let tier = 0; tier < 3; tier++) {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + tier * 0.6;
      const g = P.cyl(0.028, 0.035, 0.2, 4);
      b.add(g, { color: mix(PAL.banana, c(0xc8d44a), tier * 0.2), sway: 0.2 }, M.t(0.16 + Math.cos(a) * 0.07, 1.22 - tier * 0.09, Math.sin(a) * 0.07, Math.sin(a) * -0.6, 0, Math.cos(a) * 0.6));
    }
  }
  b.add(P.cone(0.05, 0.12, 6), { color: 0x7a2a4a, sway: 0.2 }, M.t(0.16, 0.9, 0, Math.PI, 0, 0));
  return b.build();
}

/** Tree stump: flared, mossy bark with root toes, a pale cut top (darker at the heart), a splinter and a shoot. */
export function stumpGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const top = 0.27;
  b.add(outward(tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.006, top * 0.5, 0.004), new THREE.Vector3(0, top, 0)], (t) => 0.152 + 0.075 * Math.pow(1 - t, 2.2), 7, 2)), { color: (p) => barkColor(p, 0.7), ao: { y0: 0, y1: 0.2, min: 0.7 } });
  const cap = new THREE.CircleGeometry(0.156, 7);
  cap.rotateX(-Math.PI / 2);
  b.add(cap, { color: (p) => mix(STUMP_HEART, PAL.stumpTop, Math.hypot(p.x, p.z) / 0.11) }, M.t(0, top - 0.004, 0));
  for (let k = 0; k < 3; k++) {
    const a = 0.5 + k * 2.2, ca = Math.cos(a), sa = Math.sin(a);
    b.add(outward(tube([new THREE.Vector3(ca * 0.13, 0.1, sa * 0.13), new THREE.Vector3(ca * 0.24, 0.03, sa * 0.24), new THREE.Vector3(ca * 0.32, -0.04, sa * 0.32)], (t) => 0.05 * (1 - 0.75 * t), 3, 1)), { color: (p) => mix(BARK.root, BARK.dark, THREE.MathUtils.clamp(0.4 - p.y * 2, 0, 1)) });
  }
  // Where the trunk tore instead of cutting clean.
  b.add(P.cone(0.035, 0.13, 3), { color: PAL.stumpTop }, M.t(-0.09, top + 0.05, -0.05, 0.12, 0.4, 0.1));
  // A shoot coming back from the side.
  b.add(P.cyl(0.008, 0.012, 0.16, 3, true), { color: 0x6f9a3e, sway: 0.4 }, M.t(0.13, top + 0.04, 0.03, 0.1, 0, -0.3));
  for (const s of [1, -1]) {
    const ax = new THREE.Vector3(s * 0.8, 0.45, 0.3 * s).normalize();
    b.add(leafGeometry(0.11, 0.04), { color: 0x7ab04a, leaf: 1, sway: 0.5 }, new THREE.Matrix4().compose(new THREE.Vector3(0.155, top + 0.11, 0.03), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), ax), new THREE.Vector3(1, 1, 1)));
  }
  return b.build();
}

/**
 * Boulders on land, in the island's faceted grey stone: weathered, irregular hulls bedded into
 * the ground, each face its own shade, lichen flecks and moss on the tops, small chips of stone
 * round the foot. Variant 0 is one stone, 1 two and 2 a cluster (their footprints match the
 * stone they hold); `alt` gives a second set of shapes: a tilted slab, a boulder split in two,
 * and one stone perched on another. Reef rocks are wet grey stone with weed.
 */
export function rockGeometry(variant: number, seed: number, reef = false, alt = false): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  // Rocks out on the reef: the same faceted grey stone as the sea rocks, dark and wet all over.
  if (reef) {
    const reefWeed = { y0: -0.3, y1: 0.45, amount: 0.55 };
    b.add(angularRockGeometry(seed * 7 + 5, { tilt: 0.25 }), { facet: true, color: rockColor(0.05, 10, reefWeed) }, M.t(0, 0.05, 0, 0, rng.next() * 6.28, 0, 0.6, 0.5, 0.52));
    for (let k = 0; k < variant; k++) {
      const a = rng.range(0, Math.PI * 2), sz = rng.range(0.24, 0.36);
      b.add(angularRockGeometry(seed * 7 + 9 + k), { facet: true, color: rockColor(0.05, 10, reefWeed) }, M.t(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55, 0, rng.next() * 6.28, 0, sz, sz * 0.9, sz * 0.85));
    }
    return b.build();
  }
  const stone = (moss: number) => ({ facet: true, color: rockColor(moss), ao: { y0: -0.12, y1: 0.42, min: 0.66 } });
  const put = (g: THREE.BufferGeometry, x: number, z: number, rx: number, rz: number, y = 0, moss = 0.32, tilt = 0) =>
    b.add(g, stone(moss), M.t(x, y, z, tilt * rng.range(-1, 1), rng.next() * 6.28, tilt * rng.range(-1, 1), rx, 1, rz));
  /** Chips and pebbles scattered round the foot. */
  const chips = (n: number, r0: number, r1: number) => {
    for (let k = 0; k < n; k++) {
      const a = rng.range(0, Math.PI * 2), d = rng.range(r0, r1), sz = rng.range(0.07, 0.15);
      put(boulderGeometry(seed * 13 + 40 + k, { points: 9, height: sz * 1.1, sink: 0.04 }), Math.cos(a) * d, Math.sin(a) * d, sz, sz * rng.range(0.7, 1), 0, 0.1);
    }
  };
  if (!alt) {
    if (variant === 0) {
      put(boulderGeometry(seed * 13 + 1, { height: 0.78, points: 17 }), 0, 0, 0.66, 0.58);
      chips(3, 0.62, 0.85);
    } else if (variant === 1) {
      put(boulderGeometry(seed * 13 + 1, { height: 0.72 }), -0.12, 0, 0.56, 0.5);
      const a = rng.range(0, Math.PI * 2);
      put(boulderGeometry(seed * 13 + 2, { height: 0.5, lean: [0.12, 0] }), Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.36, 0.32, 0, 0.25, 0.18);
      chips(3, 0.6, 0.95);
    } else {
      put(boulderGeometry(seed * 13 + 1, { height: 0.85 }), 0, 0, 0.5, 0.46);
      for (let k = 0; k < 2; k++) {
        const a = rng.range(0, Math.PI * 2) + k * 2.6, sz = rng.range(0.28, 0.4);
        put(boulderGeometry(seed * 13 + 2 + k, { height: sz * 1.4 }), Math.cos(a) * 0.58, Math.sin(a) * 0.58, sz, sz * 0.88, 0, 0.25, 0.15);
      }
      chips(5, 0.55, 1.0);
    }
  } else if (variant === 0) {
    // A tilted slab, its top sheared flat, with a thinner leaf of the same bed beside it.
    put(boulderGeometry(seed * 13 + 1, { height: 0.55, flat: 1, points: 14, lean: [0.1, 0] }), 0, 0, 0.74, 0.58, 0, 0.45, 0.08);
    put(boulderGeometry(seed * 13 + 2, { height: 0.24, flat: 1, points: 10 }), 0.5, 0.36, 0.34, 0.24, 0, 0.2, 0.1);
    chips(3, 0.7, 0.95);
  } else if (variant === 1) {
    // A boulder cracked in two, the halves just parted.
    const turn = rng.next() * 6.28, ca = Math.cos(turn), sa = Math.sin(turn);
    for (const half of [-1, 1] as const) {
      const g = boulderGeometry(seed * 13 + 1, { height: 0.8, half, gap: 0.04, points: 18, lean: [0, 0] });
      b.add(g, stone(0.32), M.t(ca * half * 0.05, 0, -sa * half * 0.05, 0, turn, half * 0.06, 0.62, 1, 0.55));
    }
    chips(4, 0.6, 0.9);
  } else {
    // One stone perched on another.
    put(boulderGeometry(seed * 13 + 1, { height: 0.5, flat: 0.8 }), 0, 0, 0.66, 0.6, 0, 0.3);
    put(boulderGeometry(seed * 13 + 2, { height: 0.46, sink: 0.04 }), rng.range(-0.1, 0.1), rng.range(-0.1, 0.1), 0.36, 0.32, 0.44, 0.4, 0.12);
    for (let k = 0; k < 2; k++) {
      const a = rng.range(0, Math.PI * 2) + k * 2.8, sz = rng.range(0.22, 0.3);
      put(boulderGeometry(seed * 13 + 3 + k, { height: sz * 1.3 }), Math.cos(a) * 0.7, Math.sin(a) * 0.7, sz, sz * 0.9, 0, 0.2, 0.12);
    }
    chips(4, 0.6, 1.0);
  }
  return b.build();
}

/** Sea rock: a chunky faceted block with one or two smaller ones beside it, wet low down. */
export function seaRockGeometry(seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  // One of the two shapes wears sea moss round its waterline.
  const weed = seed % 2 === 0 ? { y0: -0.2, y1: 0.24, amount: 0.7 } : undefined;
  b.add(angularRockGeometry(seed * 7 + 1, { tilt: 0.2 }), { facet: true, color: rockColor(0.18, 0.22, weed) }, M.t(0, -0.05, 0, 0, rng.next() * 6.28, 0, 0.62, 0.66, 0.55));
  const n = rng.int(1, 2);
  for (let k = 0; k < n; k++) {
    const a = rng.range(0, Math.PI * 2), sz = rng.range(0.25, 0.38);
    b.add(angularRockGeometry(seed * 7 + 3 + k), { facet: true, color: rockColor(0.1, 0.22, weed) }, M.t(Math.cos(a) * 0.62, -0.08, Math.sin(a) * 0.62, 0, rng.next() * 6.28, 0, sz, sz * 1.1, sz * 0.9));
  }
  return b.build();
}

/** Soft dark disc used as a fake contact shadow / ambient occlusion under objects. */
export function contactTexture(): THREE.Texture {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(20,30,40,0.55)');
  grd.addColorStop(0.55, 'rgba(20,30,40,0.25)');
  grd.addColorStop(1, 'rgba(20,30,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------- Tree catalogue (broadleaf variants 2–8, fruit tree) ----------------

const TREE = {
  lime: c(0x789a42),
  limeDark: c(0x4a7230),
  yellowGreen: c(0x93a34a),
  olive: c(0x667f35),
  deep: c(0x224823),
  deepLight: c(0x3c6831),
  pink: c(0xcf78a6),
  pinkLight: c(0xe6a6c6),
  vine: c(0x4c702f),
};

/** The weeping willow's yellow-green leaves. */
const WILLOW = { dark: c(0x6f9a22), light: c(0xa9d23c), tip: c(0xc6e35a) };
const PALM_DRY = c(0xa39a4c);
const BANANA_DRY = c(0x8a6f3c);
const BANANA_RIB = c(0xc3d074);
const STUMP_HEART = c(0xb98d5c);

/** A crown's leaves: shaded, lit and sunlit colours, leaf size, and how thickly the sprays are set. */
interface Leafy {
  dark: THREE.Color;
  light: THREE.Color;
  sun: THREE.Color;
  len?: number;
  w?: number;
  density?: number;
}
const sunOf = (light: THREE.Color) => mix(light, c(0xa6b566), 0.35);
const LEAF: Record<string, Leafy> = {
  jungle: { dark: PAL.jungleDark, light: PAL.jungleBright, sun: PAL.jungleSun, len: 0.34, w: 0.13 },
  lime: { dark: TREE.limeDark, light: TREE.lime, sun: sunOf(TREE.lime), density: 23 },
  poplar: { dark: TREE.olive, light: TREE.yellowGreen, sun: c(0xb4bd60), len: 0.27, w: 0.105, density: 25 },
  spread: { dark: TREE.deepLight, light: TREE.lime, sun: sunOf(TREE.lime) },
  giant: { dark: TREE.deep, light: TREE.deepLight, sun: c(0x5f8a3c) },
  blossom: { dark: c(0xc76a9c), light: TREE.pinkLight, sun: c(0xf6dbe7), len: 0.26, w: 0.12, density: 25 },
  willow: { dark: WILLOW.dark, light: WILLOW.light, sun: WILLOW.tip },
  citrus: { dark: c(0x2e5c2b), light: c(0x537e37), sun: c(0x7c9c48) },
};

/**
 * Colour a blob one flat facet at a time. The blobs keep their smooth normals (the tree material
 * draws its dark rim from them) but are built unshared, three vertices to a triangle in order, so
 * handing back each triangle's colour three times running paints whole facets.
 */
function perFacet(g: THREE.BufferGeometry, fn: (centre: THREE.Vector3, normal: THREE.Vector3) => THREE.Color): ColorFn {
  const pos = g.getAttribute('position');
  const cols: THREE.Color[] = [];
  const a = new THREE.Vector3(), b2 = new THREE.Vector3(), c2 = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i + 2 < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b2.fromBufferAttribute(pos, i + 1); c2.fromBufferAttribute(pos, i + 2);
    n.crossVectors(b2.clone().sub(a), c2.clone().sub(a)).normalize();
    a.add(b2).add(c2).multiplyScalar(1 / 3);
    cols.push(fn(a, n).clone());
  }
  let i = 0;
  return () => cols[Math.min(cols.length - 1, Math.floor(i++ / 3))];
}

const treeLeaves = new Map<string, THREE.BufferGeometry>();
function leafOf(len: number, w: number, fold = 0.35): THREE.BufferGeometry {
  const k = `${len.toFixed(3)}|${w.toFixed(3)}|${fold}`;
  let g = treeLeaves.get(k);
  if (!g) treeLeaves.set(k, (g = leafGeometry(len, w, fold)));
  return g;
}

const _d = new THREE.Vector3(), _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _ax = new THREE.Vector3(), _lp = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _z = new THREE.Vector3(0, 0, 1), _one = new THREE.Vector3(1, 1, 1);

/**
 * One leafy mass of a crown: a faceted body, flatter underneath, each facet its own shade (dark
 * below and inside, lit on the shoulders, the odd facet catching the sun on top), wrapped in
 * sprays of drooping leaves that break up its outline. Every level of detail lays out the same
 * sprays (each random number is always drawn), so nearer levels only add to the same shape:
 *   far  (lo)        - a coarse body under every fourth spray, with three big leaves each
 *   mid  (FINE off)  - every spray with four leaves
 *   near (FINE on)   - seven leaves a spray, and the twigs that carry them
 * `bare` leaves the sprays off (small masses seen from afar).
 */
function lobe(b: GeoBuilder, cx: number, cy: number, cz: number, R: number, squash: number, seed: number, lo: boolean, pal: Leafy, bare = false, sway0 = 0.12 + Math.max(0, cy - 1) * 0.12): void {
  const rng = new RNG(seed * 7 + 3);
  const shade = pal.dark.clone().multiplyScalar(0.66);
  const cr = R * 0.74;
  // (small masses are all but hidden by their leaves: a coarse body does)
  const core = P.sphere(cr, lo || R < 0.5 ? 0 : 1);
  const cp = core.getAttribute('position');
  for (let i = 0; i < cp.count; i++) if (cp.getY(i) < 0) cp.setY(i, cp.getY(i) * UNDER);
  lumpy(core, 0.2, seed, squash);
  b.add(core, {
    color: perFacet(core, (p, n) => {
      const j = phash(p.x * 7.1 + cx, p.y * 5.3 + cy, p.z * 6.7 + cz);
      const t = 0.4 + n.y * 0.42 + (p.y / cr) * 0.1 + (j - 0.5) * 0.32;
      const col = t < 0.4 ? mix(shade, pal.dark, t / 0.4) : mix(pal.dark, pal.light, ((t - 0.4) / 0.6) * 0.9);
      return n.y > 0.4 && j > 0.6 ? col.lerp(pal.sun, 0.4) : col;
    }),
    leaf: 1,
    sway: sway0,
    ao: { y0: cy - R * 0.7, y1: cy + R * 0.4, min: 0.6 },
  }, M.t(cx, cy, cz));
  if (bare) return;
  const fine = FINE.on && !lo;
  const len = pal.len ?? 0.3, w = pal.w ?? 0.12;
  const full = Math.max(5, Math.round(R * R * (pal.density ?? 19)));
  const step = lo ? 4 : 1;
  const sz = lo ? 1.9 : fine ? 1 : 1.22;
  for (let k = 0; k < full; k++) {
    // Spread over the top and sides (golden-angle spiral) with jitter; little goes underneath.
    const cph = THREE.MathUtils.clamp(0.96 - 1.5 * ((k + 0.5) / full) + rng.range(-0.08, 0.08), -0.6, 0.98);
    const th = k * 2.39996 + rng.range(-0.4, 0.4);
    const sph = Math.sqrt(1 - cph * cph);
    _d.set(Math.cos(th) * sph, cph, Math.sin(th) * sph);
    const reach = rng.range(0.8, 1.02);
    const sc = new THREE.Vector3(cx + _d.x * R * reach, cy + _d.y * R * squash * reach * (cph < 0 ? UNDER : 1), cz + _d.z * R * reach);
    const up = _d.y * 0.5 + 0.5;
    const tone = mix(pal.dark, pal.light, rng.range(0.25, 0.95) * (0.55 + up * 0.6));
    const sprayRoll = rng.range(0, Math.PI * 2);
    const droop = rng.range(0.25, 0.6);
    const tw = rng.range(0.3, 0.5);
    const sway = sway0 + Math.max(0, sc.y - cy + R) * 0.1;
    const show = k % step === 0;
    _t1.set(-_d.z, 0, _d.x);
    if (_t1.lengthSq() < 1e-4) _t1.set(1, 0, 0);
    _t1.normalize();
    _t2.crossVectors(_d, _t1).normalize();
    for (let j = 0; j < 7; j++) {
      const a = sprayRoll + (j / 7) * Math.PI * 2 + rng.range(-0.25, 0.25);
      const spread = rng.range(0.55, 1.0);
      const ls = rng.range(0.8, 1.2) * sz;
      const bright = rng.range(0.85, 1.12);
      const twist = rng.range(0, Math.PI * 2);
      const pick = lo ? j === 0 || j === 2 || j === 5 : fine || j % 2 === 0;
      if (!show || !pick) continue;
      _ax.copy(_d).multiplyScalar(0.55).addScaledVector(_t1, Math.cos(a) * spread).addScaledVector(_t2, Math.sin(a) * spread);
      _ax.y -= droop;
      _ax.normalize();
      _q.setFromUnitVectors(_z, _ax);
      _q2.setFromAxisAngle(_ax, twist);
      // (the big far leaves start further in, so the crown keeps its size)
      _lp.copy(sc).addScaledVector(_d, (lo ? -0.22 : -0.04) * R);
      let col = mix(tone, pal.sun, Math.max(0, up - 0.55) * 1.6 + Math.max(0, _ax.y) * 0.3);
      if (_d.y < -0.2) col = mix(col, shade, 0.35);
      col.multiplyScalar(bright);
      b.add(leafOf(len * ls, w * ls), { color: col, leaf: 1, sway }, new THREE.Matrix4().compose(_lp, _q2.multiply(_q), _one));
    }
    if (fine && k % 2 === 0) {
      // The twig carrying the spray, running back into the crown.
      const from = sc.clone().addScaledVector(_d, -R * tw);
      from.y -= R * 0.08;
      const mid = from.clone().lerp(sc, 0.5);
      mid.y += 0.03;
      const h = cy + R;
      b.add(tube([from, mid, sc], (t) => 0.018 * (1 - 0.6 * t) * Math.min(1.4, R + 0.3), 3, 2), { color: (p) => barkColor(p, h), sway: sway * 0.8 });
    }
  }
}
/** How much flatter a leafy mass is below its middle than above. */
const UNDER = 0.7;

/** A trunk as built: where its visible top is, and its centre line and radius by height (t = 1 at the top). */
interface Bole {
  h: number;
  top: THREE.Vector3;
  at: (t: number) => THREE.Vector3;
  rad: (t: number) => number;
}

/**
 * Trunk: flared at the foot, leaning a little and bowed, with bark ridges, and roots when close.
 * It carries on `into` the crown above its nominal height `h`, thinning, so no crown floats on a
 * cut-off pole. The same line at every level of detail (fewer sides far away).
 */
function trunk(b: GeoBuilder, h: number, r0: number, r1: number, lo: boolean, rng: RNG, lean = 0.12, into = 0.5): Bole {
  const dx = rng.range(-lean, lean), dz = rng.range(-lean, lean);
  const bow = rng.range(0.03, 0.08) * Math.min(1.5, h * 0.55), ba = rng.range(0, Math.PI * 2);
  const at = (t: number) => {
    const s = Math.sin(Math.min(1, t) * Math.PI) * bow;
    // Leaning more as it climbs; straight on from the top (inside the crown).
    const q = t <= 1 ? t * t : 2 * t - 1;
    return new THREE.Vector3(dx * q * h + Math.cos(ba) * s, t * h, dz * q * h + Math.sin(ba) * s);
  };
  const T = (h + into) / h;
  const rad = (t: number) => (t <= 1 ? (r0 + (r1 - r0) * t) * (1 + 0.6 * Math.pow(1 - t, 6)) : r1 * (1 - (0.6 * (t - 1)) / Math.max(0.01, T - 1)));
  const n = 6;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) pts.push(at((i / n) * T));
  b.add(outward(tube(pts, (u) => rad(u * T), lo ? 4 : 8, lo ? 2 : 8)), {
    color: (p) => barkColor(p, h),
    sway: (p) => (p.y / h) * 0.06,
    ao: { y0: 0, y1: h * 0.5, min: 0.62 },
  });
  if (!lo) roots(b, r0 > 0.17 ? 5 : 4, r0, r0 * 3.6, new RNG(Math.round(h * 977 + r0 * 1000)));
  return { h, top: at(1), at, rad };
}

/**
 * A limb from the trunk into the crown: out first, then turning up, with a side twig when close.
 * From afar (`lo`) a three-sided stick.
 */
function limb(b: GeoBuilder, from: THREE.Vector3, to: THREE.Vector3, r0: number, lo: boolean, rng: RNG, h: number): void {
  const mid = from.clone().lerp(to, 0.5);
  mid.x += (to.x - from.x) * 0.14;
  mid.z += (to.z - from.z) * 0.14;
  mid.y -= (to.y - from.y) * rng.range(0.04, 0.16);
  const tw = mid.clone().lerp(to, 0.4);
  const tip = tw.clone().add(new THREE.Vector3(rng.range(-0.4, 0.4), rng.range(0.1, 0.35), rng.range(-0.4, 0.4)));
  const fine = FINE.on && !lo;
  b.add(outward(tube([from, mid, to], (t) => r0 * (1 - 0.6 * t), lo ? 3 : fine ? 5 : 4, fine ? 4 : 2)), { color: (p) => barkColor(p, h), sway: (p) => 0.05 + Math.max(0, p.y - from.y) * 0.08 });
  if (!fine) return;
  b.add(tube([tw, tw.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, 0.05, 0)), tip], (t) => r0 * 0.35 * (1 - 0.7 * t), 4, 2), { color: BARK.mid, sway: 0.2 });
}

/** A vine spiralling up a trunk, following its lean, with small leaves (cord only at mid distance). */
function boleVine(b: GeoBuilder, t: Bole, h: number, rng: RNG, col: THREE.Color, leafCol: THREE.Color): void {
  const pts: THREE.Vector3[] = [];
  const a0 = rng.range(0, Math.PI * 2);
  const turns = rng.range(1.1, 1.8);
  for (let i = 0; i <= 10; i++) {
    const u = i / 10, y = 0.05 + u * h;
    const a = a0 + u * turns * Math.PI * 2;
    const rr = t.rad(Math.min(1, y / t.h)) + 0.022;
    const p = t.at(Math.min(1, y / t.h));
    pts.push(new THREE.Vector3(p.x + Math.cos(a) * rr, y, p.z + Math.sin(a) * rr));
  }
  b.add(tube(pts, () => (FINE.on ? 0.02 : 0.026), 3, FINE.on ? 18 : 9), { color: col, sway: (p) => (p.y / h) * 0.06 });
  for (let k = 1; k < 10; k++) {
    const tint = rng.next();
    if (!FINE.on) continue;
    const c0 = t.at(Math.min(1, pts[k].y / t.h));
    for (let s = 0; s < 2; s++) {
      const p = pts[k].clone().lerp(pts[k + 1], s * 0.5);
      _ax.set(p.x - c0.x, 0.25 - s * 0.4, p.z - c0.z).normalize();
      _q.setFromUnitVectors(_z, _ax);
      b.add(leafGeometry(0.12, 0.055), { color: mix(leafCol, col, tint * 0.5), leaf: 1, sway: (p.y / h) * 0.08 }, new THREE.Matrix4().compose(p, _q.clone(), new THREE.Vector3(1, 1, 1)));
    }
  }
}

/** A buttress: a thin fin of root sweeping from the trunk down and out along the ground. */
function buttress(b: GeoBuilder, a: number, r0: number, hb: number, out: number, hTrunk: number): void {
  const ca = Math.cos(a), sa = Math.sin(a), w = r0 * 0.42;
  const pos = [
    ca * r0 * 0.72, hb, sa * r0 * 0.72,
    ca * (r0 + out * 0.3), hb * 0.27, sa * (r0 + out * 0.3),
    ca * (r0 + out), -0.06, sa * (r0 + out),
    ca * r0 * 0.6 - sa * w, -0.06, sa * r0 * 0.6 + ca * w,
    ca * r0 * 0.6 + sa * w, -0.06, sa * r0 * 0.6 - ca * w,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex([0, 3, 1, 1, 3, 2, 0, 1, 4, 1, 2, 4]);
  g.computeVertexNormals();
  b.add(g, { color: (p) => barkColor(p, hTrunk).lerp(BARK.root, 0.35), ao: { y0: -0.05, y1: 0.5, min: 0.6 } });
}

/** Canopy height (centre, top) and radius per broadleaf variant, unscaled, for perching birds and monkeys. */
export const CANOPY: { mid: number; top: number; r: number }[] = [
  { mid: 2.6, top: 3.7, r: 1.4 },
  { mid: 3.2, top: 4.4, r: 1.5 },
  { mid: 1.8, top: 2.6, r: 0.9 },
  { mid: 3.2, top: 4.9, r: 0.6 },
  { mid: 3.0, top: 3.4, r: 2.0 },
  { mid: 4.3, top: 5.6, r: 2.0 },
  { mid: 3.0, top: 3.4, r: 2.0 },
  { mid: 1.9, top: 2.7, r: 1.0 },
  { mid: 3.0, top: 3.9, r: 1.8 },
];

/** A small round-headed tree: a short trunk forking low into limbs, one main mass of leaves and a few lesser ones round it. */
function roundTree(b: GeoBuilder, lo: boolean, seed: number, rng: RNG, br: RNG, h: number, r0: number, r1: number, pal: Leafy, o: { y: number; R: number; squash: number; ring: number; side: [number, number]; sideY: [number, number]; sides?: number; centred?: boolean }): void {
  const t = trunk(b, h, r0, r1, lo, rng, o.centred ? 0.04 : 0.1, o.y - h - 0.12);
  const cx = o.centred ? 0 : t.top.x * 0.6, cz = o.centred ? 0 : t.top.z * 0.6;
  lobe(b, cx, o.y, cz, o.R, o.squash, seed, lo, pal);
  const a0 = rng.range(0, Math.PI * 2);
  const sides = o.sides ?? 3;
  for (let k = 0; k < sides; k++) {
    const a = a0 + (k / sides) * Math.PI * 2 + rng.range(-0.25, 0.25);
    const R = rng.range(o.side[0], o.side[1]), y = rng.range(o.sideY[0], o.sideY[1]);
    const x = cx + Math.cos(a) * o.ring, z = cz + Math.sin(a) * o.ring;
    lobe(b, x, y, z, R, 0.8, seed + k + 1, lo, pal, lo);
    if (!lo) limb(b, t.at(br.range(0.55, 0.82)), new THREE.Vector3(cx + Math.cos(a) * o.ring * 0.8, y - R * 0.3, cz + Math.sin(a) * o.ring * 0.8), r0 * 0.42, false, br, h);
  }
}

/** The willow from afar: a ring of long hanging points of leaf, wide at the crown, ragged at their ends, with gaps between. */
function willowSkirt(): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  const n = 20;
  for (let s = 0; s < n; s++) {
    // Every third hangs from further in, and shorter: the curtain has some depth.
    const inner = s % 3 === 2;
    const a = (s / n) * Math.PI * 2, ht = (Math.PI / n) * (inner ? 1.5 : 1.25);
    const yb = inner ? 1.75 : s % 2 ? 1.0 : 1.4, rt = inner ? 1.0 : 1.42, rb = inner ? 1.2 : 1.74, yt = inner ? 2.9 : 3.05;
    pos.push(Math.cos(a - ht) * rt, yt, Math.sin(a - ht) * rt, Math.cos(a + ht) * rt, yt, Math.sin(a + ht) * rt, Math.cos(a) * rb, yb, Math.sin(a) * rb);
    idx.push(s * 3, s * 3 + 1, s * 3 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return doubleSide(g);
}

export function treeGeometry(variant: number, lo: boolean, seed: number): THREE.BufferGeometry {
  if (variant < 2) return broadleafGeometry(variant, lo, seed);
  const rng = new RNG(seed);
  /** Separate stream for fine detail, so leaving it out (mid LOD) never moves the main shapes. */
  const dr = new RNG(seed * 31 + 7);
  /** And one for limbs, which far trees mostly leave out. */
  const br = new RNG(seed * 53 + 1);
  const b = new GeoBuilder();
  switch (variant) {
    case 2:
      // small and round-headed, light green
      roundTree(b, lo, seed, rng, br, 1.2, 0.13, 0.085, LEAF.lime, { y: 1.86, R: 0.72, squash: 0.9, ring: 0.46, side: [0.42, 0.52], sideY: [1.5, 1.85] });
      break;
    case 3: {
      // tall and narrow, yellow-green: a column of leaf tapering to a point, winding a little round its leader
      const t = trunk(b, 1.8, 0.12, 0.08, lo, rng, 0.03, 2.5);
      const a0 = rng.range(0, Math.PI * 2);
      const radii = [0.5, 0.6, 0.56, 0.46, 0.34];
      for (let k = 0; k < 5; k++) {
        const y = 2.05 + k * 0.54, a = a0 + k * 2.4, off = k === 4 ? 0.03 : rng.range(0.07, 0.13);
        const p = t.at(y / 1.8);
        lobe(b, p.x + Math.cos(a) * off, y, p.z + Math.sin(a) * off, radii[k] + rng.range(-0.03, 0.03), 1.2, seed + k, lo, LEAF.poplar);
      }
      break;
    }
    case 4: // wide spreading: a forked trunk holding flat pads of leaf at different heights
    case 6: {
      // (6 = the same with hanging vines)
      const t = trunk(b, 1.6, 0.2, 0.14, lo, rng, 0.08, 1.5);
      if (!lo && variant === 6) boleVine(b, t, 1.8, dr, TREE.vine, TREE.lime);
      const cx = t.top.x * 0.6, cz = t.top.z * 0.6;
      const a0 = rng.range(0, Math.PI * 2);
      const arms3: THREE.Vector3[] = [];
      for (let k = 0; k < 3; k++) {
        const a = a0 + (k / 3) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const r = rng.range(1.0, 1.18), y = 2.85 + rng.next() * 0.4, R = rng.range(0.84, 0.97);
        const px = cx + Math.cos(a) * r, pz = cz + Math.sin(a) * r;
        // A smaller pad beyond and to one side of the main one, a step lower or higher.
        const a2 = a + rng.range(0.45, 0.8) * (k % 2 ? 1 : -1), y2 = y + (rng.next() < 0.6 ? -rng.range(0.3, 0.45) : rng.range(0.15, 0.25));
        const qx = cx + Math.cos(a2) * 1.42, qz = cz + Math.sin(a2) * 1.42;
        const fork = t.at(0.9);
        const hold = new THREE.Vector3(cx + Math.cos(a) * r * 0.82, y - 0.14, cz + Math.sin(a) * r * 0.82);
        limb(b, fork, hold, 0.1, lo, new RNG(seed * 53 + k), 1.6);
        if (!lo) limb(b, fork.clone().lerp(hold, 0.55), new THREE.Vector3(qx * 0.92, y2 - 0.08, qz * 0.92), 0.05, false, br, 1.6);
        if (!lo) arms3.push(new THREE.Vector3(cx + Math.cos(a) * r * 0.8, y - 0.3, cz + Math.sin(a) * r * 0.8));
        lobe(b, px, y, pz, R, 0.42, seed + k, lo, LEAF.spread);
        lobe(b, qx, y2, qz, 0.52, 0.5, seed + 20 + k, lo, LEAF.spread, lo);
        if (variant === 6 && !lo) {
          for (let v = 0; v < 3; v++) hangingVine(b, new THREE.Vector3(px + dr.range(-0.5, 0.5), y - 0.15, pz + dr.range(-0.5, 0.5)), dr.range(0.6, 1.3), dr, TREE.vine, TREE.lime);
        }
      }
      lobe(b, cx, 3.33, cz, 0.88, 0.4, seed + 9, lo, LEAF.spread);
      if (variant === 6 && !lo) for (let v = 0; v < arms3.length; v++) liana(b, arms3[v], arms3[(v + 1) % arms3.length], 0.55, dr, TREE.vine, TREE.lime);
      break;
    }
    case 5: {
      // jungle giant: a tall trunk on finned buttresses, a broad dark crown in tiers, vines
      const t = trunk(b, 3.3, 0.3, 0.18, lo, rng, 0.05, 1.1);
      const fa = rng.range(0, Math.PI * 2);
      for (let k = 0; k < 5; k++) buttress(b, fa + (k / 5) * Math.PI * 2 + rng.range(-0.25, 0.25), 0.3, rng.range(0.85, 1.5), rng.range(0.7, 1.05), 3.3);
      if (!lo) boleVine(b, t, 3.4, dr, TREE.vine, TREE.deepLight);
      const cx = t.top.x * 0.6, cz = t.top.z * 0.6;
      lobe(b, cx, 4.55, cz, 1.15, 0.75, seed, lo, LEAF.giant);
      const a0 = rng.range(0, Math.PI * 2);
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k < 5; k++) {
        const a = a0 + (k / 5) * Math.PI * 2 + rng.range(-0.2, 0.2);
        const r = rng.range(0.8, 1.05), R = rng.range(0.68, 0.88);
        const p = new THREE.Vector3(cx + Math.cos(a) * r, 4.0 + ((k * 2) % 5) * 0.13 + rng.range(-0.08, 0.08), cz + Math.sin(a) * r);
        pts.push(p);
        lobe(b, p.x, p.y, p.z, R, 0.72, seed + k + 1, lo, LEAF.giant);
        if (!lo) limb(b, t.at(br.range(0.78, 0.96)), new THREE.Vector3(cx + Math.cos(a) * r * 0.85, p.y - 0.2, cz + Math.sin(a) * r * 0.85), 0.09, false, br, 3.3);
      }
      {
        // One bough well below the crown, with its own leaves.
        const a = a0 + Math.PI / 5 + rng.range(-0.3, 0.3);
        const p = new THREE.Vector3(cx + Math.cos(a) * 1.15, 3.15, cz + Math.sin(a) * 1.15);
        lobe(b, p.x, p.y, p.z, 0.55, 0.7, seed + 8, lo, LEAF.giant, lo);
        limb(b, t.at(0.72), new THREE.Vector3(p.x - Math.cos(a) * 0.15, p.y - 0.1, p.z - Math.sin(a) * 0.15), 0.08, lo, br, 3.3);
      }
      if (!lo) for (let v = 0; v < 6; v++) {
        const p = pts[v % pts.length];
        hangingVine(b, new THREE.Vector3(cx + (p.x - cx) * 1.1, p.y - 0.4, cz + (p.z - cz) * 1.1), dr.range(0.8, 1.8), dr, TREE.vine, TREE.deepLight);
      }
      if (!lo) for (let v = 0; v + 2 < pts.length; v += 2) {
        const a = pts[v], z = pts[v + 2];
        liana(b, new THREE.Vector3(a.x * 0.8, a.y - 0.4, a.z * 0.8), new THREE.Vector3(z.x * 0.8, z.y - 0.4, z.z * 0.8), dr.range(0.5, 1.0), dr, TREE.vine, TREE.deepLight);
      }
      break;
    }
    case 8: {
      // weeping willow: a thick, leaning trunk, spreading arms under a domed crown, and curtains of
      // slim yellow-green leaves falling almost to the ground all round
      const t = trunk(b, 1.7, 0.27, 0.17, lo, rng, 0.1, 1.45);
      const a0 = rng.range(0, Math.PI * 2);
      for (let k = 0; k < 5; k++) {
        const a = a0 + (k / 5) * Math.PI * 2 + rng.range(-0.2, 0.2);
        const px = Math.cos(a) * 1.22, pz = Math.sin(a) * 1.22, py = 2.85 + rng.next() * 0.3;
        if (!lo) limb(b, t.at(0.88), new THREE.Vector3(px * 0.85, py - 0.12, pz * 0.85), 0.11, false, new RNG(seed * 59 + k), 1.7);
        lobe(b, px, py, pz, 0.78, 0.55, seed + k, lo, LEAF.willow, lo && k % 2 === 1);
      }
      lobe(b, 0, 3.35, 0, 1.0, 0.55, seed + 9, lo, LEAF.willow);
      if (lo) {
        b.add(willowSkirt(), { color: (p) => WILLOW.dark.clone().lerp(p.y < 1.6 ? WILLOW.tip : WILLOW.light, Math.min(1, Math.max(0, (3.1 - p.y) / 1.7))), leaf: 1, sway: (p) => 0.15 + Math.max(0, 3 - p.y) * 0.14 });
        break;
      }
      // Hanging strands: chains of slim leaves, an outer curtain from the crown's rim and a shorter
      // one inside it, swaying more toward their ends.
      const strands = 38;
      const fine = FINE.on;
      for (let s = 0; s < strands; s++) {
        const inner = s % 4 === 3;
        const a = (s / strands) * Math.PI * 2 + dr.range(-0.07, 0.07);
        const rr = (inner ? 0.95 : 1.5) + dr.range(-0.2, 0.2), y0 = (inner ? 2.85 : 3.05) + dr.range(-0.25, 0.3), n = Math.round(inner ? dr.range(6, 9) : dr.range(9, 13));
        const ca = Math.cos(a), sa = Math.sin(a);
        for (let j = 0; j < n; j++) {
          const u = j / n, y = y0 - j * 0.17, out = rr + Math.sin(u * Math.PI) * 0.1 + j * 0.012;
          const jx = dr.range(-0.04, 0.04), jz = dr.range(-0.04, 0.04), tw = dr.range(0, Math.PI * 2), tone = dr.next(), ls = dr.range(0.85, 1.2);
          const col = WILLOW.light.clone().lerp(j % 3 === 0 ? WILLOW.tip : WILLOW.dark, 0.2 + tone * 0.35 + u * 0.15);
          for (let m = 0; m < (fine ? 2 : 1); m++) {
            const sgn = m ? -1 : 1;
            _ax.set(ca * 0.16 - sa * 0.22 * sgn + jx * 3, -1, sa * 0.16 + ca * 0.22 * sgn + jz * 3).normalize();
            _q.setFromUnitVectors(_z, _ax);
            _q2.setFromAxisAngle(_ax, tw + m * 1.7);
            _lp.set(ca * out + jx, y - m * 0.085, sa * out + jz);
            b.add(leafOf(fine ? 0.25 : 0.3, fine ? 0.042 : 0.06, 0.4), { color: m ? col.clone().multiplyScalar(0.9) : col, leaf: 1, sway: 0.2 + u * 0.38 }, new THREE.Matrix4().compose(_lp, _q2.multiply(_q), _lp.clone().set(ls, ls, ls)));
          }
        }
      }
      break;
    }
    case 7:
      // blossom tree: clouds of pink, paler where the sun catches them
      roundTree(b, lo, seed, rng, br, 1.3, 0.12, 0.08, LEAF.blossom, { y: 1.98, R: 0.7, squash: 0.75, ring: 0.5, side: [0.42, 0.5], sideY: [1.7, 1.92] });
      break;
  }
  return b.build();
}

/** Fruit tree (apple variant 1): a dense, round, dark-leaved tree whose oranges are a separate, harvestable mesh. */
export function fruitTreeGeometry(lo: boolean, seed: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new RNG(seed);
  const br = new RNG(seed * 31 + 7);
  // Centred on its trunk, so the fruit (set round the same point) sits in the leaves.
  roundTree(b, lo, seed, rng, br, 1.1, 0.12, 0.08, LEAF.citrus, { y: 1.75, R: 0.82, squash: 0.9, ring: 0.44, side: [0.38, 0.44], sideY: [1.42, 1.58], sides: 2, centred: true });
  return b.build();
}

/** Oranges hanging round the sides of the fruit tree's crown. */
export function orangeFruitGeometry(seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  for (let k = 0; k < 10; k++) {
    const th = rng.range(0, Math.PI * 2), ph = rng.range(0.45, 1.8);
    b.add(P.uvSphere(0.075, 7, 5), { color: (_p, nn) => mix(c(0xe8701e), c(0xf6a040), Math.max(0, nn.y) * 0.5), sway: 0.15 }, M.t(Math.cos(th) * Math.sin(ph) * 0.82, 1.75 + Math.cos(ph) * 0.72, Math.sin(th) * Math.sin(ph) * 0.82));
  }
  return b.build();
}
