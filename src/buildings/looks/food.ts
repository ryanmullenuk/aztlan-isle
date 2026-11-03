import * as THREE from 'three';
import { WORLD } from '../../config';
import { GeoBuilder, M, P, doubleSide, lumpy, tube } from '../../render/GeoBuilder';
import { RNG } from '../../world/rng';
import { CHINAMPA_BED_Y, FARM_PEN, chinampaBeds } from '../models';
import type { Look, Looks } from './types';

/**
 * How the food buildings' upgrades show: farms, gardens, pens, the smokehouse and slaughterhouse,
 * the stores, the fishing jetty and the fisherman's hut. Each look draws what its upgrade says
 * (irrigation ditches, a second drying rack, net racks on the pier) round the building's own model;
 * the coordinates follow that model in models.ts (door +z, footprint centred on the origin).
 */

// ---------------- Palette and small helpers (as models.ts) ----------------

const c = (h: number) => new THREE.Color(h);
const K = {
  thatch: c(0xbca06b), thatchDark: c(0x94794d), timber: c(0x866443), timberDark: c(0x5e3b22), timberPale: c(0xb89268), timberMid: c(0x9a7550),
  terracotta: c(0xa8583e), terracottaDark: c(0x9a3a26), stone: c(0xd5bea0), stoneDark: c(0xa69276), adobe: c(0xe2c79c), plaster: c(0xefe2c6),
  door: c(0x3a2a20), red: c(0xa74a39), cream: c(0xf3e3c6), teal: c(0x2f8f86), gold: c(0xd2a646), rope: c(0xc9a86a), soot: c(0x2a2220),
};
const CUT = { stone: c(0xdcb27a), stoneLight: c(0xe9c993), stoneDark: c(0xbf9864), mortar: c(0x9a7448) };
const PEN = { withy: c(0x8a6440), withyDark: c(0x6b4a2c), straw: c(0xd9b866), strawDark: c(0xb8913f), mud: c(0x5c412a), water: c(0x2f7fa0), grain: c(0xe0b33a), egg: c(0xf3e9d6) };
const LEAF = { dark: c(0x2f6e24), mid: c(0x4a8c30), light: c(0x6cae3e) };
const FISH = { gold: c(0xe0902a), silver: c(0x9aaab0), dried: c(0xc8a46a) };
const thatchColor = (p: THREE.Vector3) => ((p.y * 7) % 1 < 0.3 ? K.thatchDark : K.thatch).clone().lerp(K.thatch, 0.3);
const RIGID = 0;

type Col = number | THREE.Color | ((p: THREE.Vector3, n: THREE.Vector3) => THREE.Color);
/** A box of size w × h × d centred at (x, y, z), turned by rx, ry, rz. */
function box(b: GeoBuilder, w: number, h: number, d: number, color: Col, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, leaf = 0): void {
  b.add(P.box(w, h, d), { color, leaf, sway: RIGID }, M.t(x, y, z, rx, ry, rz));
}
/** An upright pole from y0 to y0 + h. */
function pole(b: GeoBuilder, x: number, z: number, h: number, r = 0.035, color: Col = K.timberDark, y0 = 0): void {
  b.add(P.cyl(r * 0.85, r, h, 6), { color }, M.t(x, y0 + h / 2, z));
}
const UP = new THREE.Vector3(0, 1, 0);
/** A y-axis primitive's placement running from a to b. */
function span(a: THREE.Vector3, bb: THREE.Vector3): { m: THREE.Matrix4; len: number } {
  const d = bb.clone().sub(a), len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
  return { m: new THREE.Matrix4().compose(a.clone().add(bb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)), len };
}
function rod(b: GeoBuilder, a: THREE.Vector3, bb: THREE.Vector3, r: number, color: Col): void {
  const { m, len } = span(a, bb);
  b.add(P.cyl(r, r, len, 5), { color }, m);
}
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A log: bark on its sides, pale sawn ends (along x, y or z). */
function log(b: GeoBuilder, x: number, y: number, z: number, r: number, len: number, axis: 'x' | 'z', bark: THREE.Color = K.timber): void {
  const ax = axis === 'x' ? v(1, 0, 0) : v(0, 0, 1), end = c(0xd9b88a);
  b.add(P.cyl(r, r, len, 7), { color: (_p, n) => (Math.abs(n.dot(ax)) > 0.7 ? end : bark).clone() }, M.t(x, y, z, axis === 'z' ? Math.PI / 2 : 0, 0, axis === 'x' ? Math.PI / 2 : 0));
}

/** Woven wattle between (x0, z0) and (x1, z1): rows of withies, alternately either side of the line. */
function wattleRun(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y0: number, h: number, rows: number, t = 0.03): void {
  const len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(x1 - x0, z1 - z0);
  const px = Math.cos(a), pz = -Math.sin(a), rh = h / rows;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2 ? 1 : -1) * 0.012;
    box(b, t, rh * 0.86, len, r % 2 ? PEN.withy : PEN.withyDark, (x0 + x1) / 2 + px * off, y0 + (r + 0.5) * rh, (z0 + z1) / 2 + pz * off, 0, a, 0);
  }
}

/** A gable of thatch with its ridge along x: courses, a ridge roll and a ragged fringe at the eaves. */
function gableThatch(b: GeoBuilder, x: number, eave: number, z: number, len: number, depth: number, rise: number, fringe = 6): void {
  const half = depth / 2, L = Math.hypot(half, rise), a = Math.atan2(rise, half);
  for (const s of [1, -1]) {
    box(b, len, 0.06, L + 0.04, K.thatch, x, eave + rise / 2 + 0.02, z + (s * half) / 2, s * a, 0, 0, 0.2);
    for (const f of [0.28, 0.66]) box(b, len + 0.04, 0.03, 0.09, K.thatchDark, x, eave + rise * f + 0.065, z + s * half * (1 - f), s * a, 0, 0, 0.2);
    for (let k = 0; k < fringe; k++) {
      const fx = x - len / 2 + ((k + 0.5) / fringe) * len;
      b.add(P.cone(0.05, 0.1, 4), { color: K.thatchDark, leaf: 0.2 }, M.t(fx, eave - 0.02, z + s * (half + 0.02), s * (Math.PI - 0.5), 0, 0));
    }
  }
  b.add(P.cyl(0.05, 0.05, len + 0.06, 6), { color: K.thatchDark, leaf: 0.2 }, M.t(x, eave + rise + 0.03, z, 0, 0, Math.PI / 2));
}

/** A four-sided thatched cap (a squat pyramid), `r` to its corners. */
function thatchCap(b: GeoBuilder, x: number, y: number, z: number, r: number, h: number): void {
  b.add(P.cone(r, h, 4), { color: thatchColor, leaf: 0.2 }, M.t(x, y + h / 2, z, 0, Math.PI / 4, 0));
}

/** A painted band with a running stepped fret; `m` places its centre (x along the band, +z out of the face). */
function fretBand(b: GeoBuilder, m: THREE.Matrix4, len: number, h: number, base: THREE.Color, ink: THREE.Color): void {
  const at = (x: number, y: number) => m.clone().multiply(M.t(x, y, 0.0075));
  b.add(P.box(len, h, 0.012), { color: base }, m);
  const u = h * 1.7, n = Math.max(1, Math.floor(len / u)), s = h * 0.15, x0 = -(n * u) / 2;
  for (let k = 0; k < n; k++) {
    const x = x0 + k * u;
    b.add(P.plane(s, h * 0.66), { color: ink }, at(x + s / 2 + u * 0.08, 0));
    b.add(P.plane(u * 0.6, s), { color: ink }, at(x + u * 0.38, h * 0.33 - s / 2));
    b.add(P.plane(s, h * 0.36), { color: ink }, at(x + u * 0.68 - s / 2, h * 0.15));
    b.add(P.plane(u * 0.3, s), { color: ink }, at(x + u * 0.53, -0.02 * h));
    b.add(P.plane(u * 0.82, s), { color: ink }, at(x + u * 0.49, -h * 0.33 + s / 2));
  }
}

/** A clay storage jar standing on y: a round body with a painted cream band, a neck and a rim. */
function jar(b: GeoBuilder, x: number, y: number, z: number, s: number, body = 0xb8562e): void {
  const col = c(body);
  b.add(P.uvSphere(0.1 * s, 9, 7), { color: (p) => (Math.abs(p.y - (y + 0.14 * s)) < 0.022 * s ? K.cream : col).clone() }, M.t(x, y + 0.115 * s, z, 0, 0, 0, 1, 1.15, 1));
  b.add(P.cyl(0.05 * s, 0.07 * s, 0.07 * s, 8), { color: col.clone().multiplyScalar(0.88) }, M.t(x, y + 0.24 * s, z));
  b.add(P.cyl(0.066 * s, 0.066 * s, 0.022 * s, 8), { color: col.clone().multiplyScalar(0.72) }, M.t(x, y + 0.285 * s, z));
}

/** A woven basket (fish, salt, grain) with a heap of its load. */
function basket(b: GeoBuilder, x: number, y: number, z: number, r: number, h: number, load?: THREE.Color, rng?: RNG, fish = false): void {
  b.add(P.cyl(r, r * 0.82, h, 9), { color: (p) => ((p.y * 60) % 1 < 0.5 ? K.rope : c(0xae8a50)).clone() }, M.t(x, y + h / 2, z));
  b.add(P.cyl(r * 1.04, r * 1.04, 0.022, 9), { color: c(0x9c7a44) }, M.t(x, y + h, z));
  if (!load) return;
  if (fish && rng) {
    for (let k = 0; k < 4; k++) b.add(P.sphere(r * 0.32, 0), { color: load }, M.t(x + (k - 1.5) * r * 0.4, y + h + 0.01, z + rng.range(-r * 0.3, r * 0.3), 0, rng.range(0, 3), 0, 0.6, 0.5, 1.8));
  } else b.add(P.sphere(r * 0.92, 1), { color: load }, M.t(x, y + h - r * 0.2, z, 0, 0, 0, 1, 0.45, 1));
}

/** A double-sided net: a mesh of light and dark cells (flat-shaded so the cells stay crisp). */
function net(b: GeoBuilder, w: number, h: number, m: THREE.Matrix4, cols = 10, rows = 5): void {
  const g = doubleSide(new THREE.PlaneGeometry(w, h, cols, rows));
  b.add(g, { color: (p) => ((Math.floor(p.x * 18) + Math.floor(p.y * 18) + Math.floor(p.z * 18)) % 2 ? c(0xc8b48a) : c(0x9a8460)), facet: true }, m);
}

/** A fish lying at y (its back above a water surface there), nose toward angle `a`. */
function fish(b: GeoBuilder, x: number, y: number, z: number, a: number, s: number, col: THREE.Color): void {
  const m = M.t(x, y, z, 0, a, 0);
  b.add(P.uvSphere(0.05 * s, 8, 5), { color: (p) => (p.y > y + 0.012 * s ? col.clone().multiplyScalar(0.72) : col.clone()) }, m.clone().multiply(M.t(0, 0, 0, 0, 0, 0, 0.42, 0.36, 1.45)));
  b.add(P.cone(0.03 * s, 0.05 * s, 4), { color: col.clone().multiplyScalar(0.8) }, m.clone().multiply(M.t(0, 0.004, -0.085 * s, -Math.PI / 2, 0, 0, 1, 1, 0.3)));
}

/** A sitting hen (facing +z before `ry`): round body, tail up behind, head with red comb and beak. */
function hen(b: GeoBuilder, x: number, y: number, z: number, ry: number, body: THREE.Color): void {
  const m = M.t(x, y, z, 0, ry, 0), at = (...a: number[]) => m.clone().multiply(M.t(...a));
  b.add(P.uvSphere(0.1, 8, 6), { color: body }, at(0, 0.07, 0, 0, 0, 0, 1, 0.75, 1.25));
  b.add(P.cone(0.06, 0.13, 5), { color: body.clone().multiplyScalar(0.8) }, at(0, 0.14, -0.11, -0.7, 0, 0));
  b.add(P.uvSphere(0.046, 7, 5), { color: body }, at(0, 0.17, 0.09));
  b.add(P.box(0.014, 0.04, 0.05), { color: c(0xd8322a) }, at(0, 0.22, 0.09));
  b.add(P.cone(0.015, 0.045, 4), { color: c(0xe8b23a) }, at(0, 0.165, 0.148, Math.PI / 2, 0, 0));
}
function chick(b: GeoBuilder, x: number, z: number, ry: number, y = 0.02): void {
  b.add(P.sphere(0.036, 1), { color: c(0xf2d24a) }, M.t(x, y + 0.036, z));
  b.add(P.sphere(0.024, 1), { color: c(0xf6dc62) }, M.t(x + Math.sin(ry) * 0.03, y + 0.075, z + Math.cos(ry) * 0.03));
  b.add(P.cone(0.009, 0.025, 4), { color: c(0xe8902a) }, M.t(x + Math.sin(ry) * 0.058, y + 0.073, z + Math.cos(ry) * 0.058, Math.PI / 2, ry, 0, 1, 1, 1));
}

/** A round pumpkin or squash with shallow lobes down its sides. */
function ribbedFruit(r: number, ribs = 8, depth = 0.12): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 10, 5);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 - depth * (0.5 - 0.5 * Math.cos(Math.atan2(z, x) * ribs)) * (1 - (y / r) ** 2);
    p.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  return g;
}
const FLOWER = new THREE.OctahedronGeometry(0.045, 0);

// ---------------- Vegetable farm (4 × 4) ----------------

/** The vegetable rows (as models.ts vegLayout): each row's x and the z extent of its ridge. */
function vegRidges(w: number, d: number): { x: number; z0: number; z1: number }[] {
  const ORDER = [0.46, 0.56, 0.34, 0.46, 0.4, 0.3];
  const rows = Math.max(3, Math.floor(w * 1.5)), out: { x: number; z0: number; z1: number }[] = [];
  for (let r = 0; r < rows; r++) {
    const x = -w / 2 + 0.6 + (r / Math.max(1, rows - 1)) * (w - 1.2), sp = ORDER[r % ORDER.length], n = Math.floor((d - 1.2) / sp);
    const zs: number[] = [];
    for (let k = 0; k <= n; k++) {
      const z = -(n * sp) / 2 + k * sp;
      if (z < -d / 2 + 1.1 && (x < -w / 2 + 1.1 || x > w / 2 - 0.9)) continue;
      if (z > d / 2 - FARM_PEN.size - 0.15 && x > w / 2 - FARM_PEN.size - 0.15) continue;
      zs.push(z);
    }
    if (zs.length) out.push({ x, z0: Math.min(...zs) - 0.2, z1: Math.max(...zs) + 0.2 });
  }
  return out;
}

const WATER = c(0x2f7fa0), WET = c(0x4a3322);
/**
 * The farm's ditches: a feeder along the back from a stone cistern, a cross ditch along the front
 * (bridged at the gate), and a ditch down between each pair of rows. Each is a run of axis-aligned
 * segments with the ends that meet another ditch marked (so kerbs leave the junction open).
 */
function farmDitches(w: number, d: number) {
  const rows = vegRidges(w, d), runX0 = w / 2 - 0.1 - FARM_PEN.size, runZ0 = d / 2 - 0.1 - FARM_PEN.size;
  const feederZ = -d / 2 + 0.32, frontZ = d / 2 - 0.32, cistern = { x: w / 2 - 0.45, z: -d / 2 + 0.42 };
  const mids: { x: number; z0: number; z1: number; back: boolean; front: boolean }[] = [];
  for (let k = 0; k + 1 < rows.length; k++) {
    const x = (rows[k].x + rows[k + 1].x) / 2;
    const back = x > -w / 2 + 1.1, front = x + 0.09 < runX0 - 0.05;
    mids.push({ x, z0: back ? feederZ : -d / 2 + 1.15, z1: front ? frontZ : runZ0 - 0.12, back, front });
  }
  const feederX0 = Math.min(...mids.filter((m) => m.back).map((m) => m.x)) - 0.05;
  return { rows, mids, feederZ, frontZ, cistern, feeder: [feederX0, cistern.x - 0.23] as const, cross: [-w / 2 + 0.3, runX0 - 0.1] as const };
}

/** One ditch segment along x or z: wet mud banked a little, the water a strip along its middle. */
function ditch(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number): void {
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0), len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  box(b, alongX ? len + 0.1 : 0.18, 0.035, alongX ? 0.18 : len + 0.1, WET, cx, 0.0175, cz);
  // (Ditches along x carry their water a little higher, so it never lies level with a crossing one.)
  box(b, alongX ? len : 0.1, 0.01, alongX ? 0.1 : len, (p) => WATER.clone().lerp(c(0x5d9a9a), Math.sin(p.x * 9 + p.z * 7) * 0.15 + 0.15), cx, alongX ? 0.058 : 0.045, cz);
}

const farmIrrigation: Look = (b, w, d) => {
  const D = farmDitches(w, d);
  for (const m of D.mids) ditch(b, m.x, m.z0, m.x, m.z1);
  ditch(b, D.feeder[0], D.feederZ, D.feeder[1], D.feederZ);
  ditch(b, D.cross[0], D.frontZ, D.cross[1], D.frontZ);
  // The stone cistern the feeder runs from, brimming, with a clay jar for dipping.
  const { x, z } = D.cistern, s = 0.42;
  for (const k of [-1, 1]) {
    box(b, s, 0.15, 0.06, (p) => CUT.stone.clone().lerp(CUT.stoneLight, p.y * 4), x, 0.075, z + k * (s / 2 - 0.03));
    box(b, 0.06, 0.15, s - 0.12, (p) => CUT.stone.clone().lerp(CUT.stoneLight, p.y * 4), x + k * (s / 2 - 0.03), 0.075, z);
  }
  box(b, s - 0.11, 0.01, s - 0.11, WATER, x, 0.115, z);
  jar(b, x + 0.05, 0, z + 0.32, 0.7, 0xa8583e);
  // A plank footbridge over the front ditch at the gate.
  for (const s2 of [-1, 1]) box(b, 0.56, 0.03, 0.04, K.timberDark, 0, 0.05, D.frontZ + s2 * 0.12);
  for (let k = 0; k < 4; k++) box(b, 0.12, 0.025, 0.34, k % 2 ? K.timber : K.timberMid, -0.2 + k * 0.135, 0.078, D.frontZ);
};

const farmFence: Look = (b, w, d) => {
  const hw = w / 2 - 0.1, hd = d / 2 - 0.1, inset = 0.07, runX0 = w / 2 - 0.1 - FARM_PEN.size, runZ0 = d / 2 - 0.1 - FARM_PEN.size;
  // Woven wattle panels just inside the rail fence, all round but the gate and the chicken run.
  const wx = hw - inset, wz = hd - inset, e = hw - 0.09;
  wattleRun(b, -e, -wz, e, -wz, 0.05, 0.36, 5);
  wattleRun(b, -wx, -e, -wx, e, 0.05, 0.36, 5);
  wattleRun(b, wx, -e, wx, runZ0 - 0.04, 0.05, 0.36, 5);
  wattleRun(b, -e, wz, -0.62, wz, 0.05, 0.36, 5);
  wattleRun(b, 0.62, wz, runX0 - 0.04, wz, 0.05, 0.36, 5);
  // A gateway: two tall red-banded posts and a lintel painted with a fret.
  for (const s of [-1, 1]) {
    pole(b, s * 0.6, hd, 1.08, 0.055, K.timberDark);
    b.add(P.cyl(0.06, 0.06, 0.08, 7), { color: K.red }, M.t(s * 0.6, 0.85, hd));
    b.add(P.cone(0.07, 0.14, 6), { color: K.thatchDark, leaf: 0.2 }, M.t(s * 0.6, 1.2, hd));
  }
  box(b, 1.42, 0.1, 0.1, K.timber, 0, 1.06, hd);
  fretBand(b, M.t(0, 1.06, hd + 0.05 + 0.006), 1.3, 0.075, K.red, K.cream);
  // The scarecrow dressed up: a red poncho with a cream band, sleeves, a broad straw hat, streamers.
  const sx = hw - 0.5, sz = -hd + 0.6;
  b.add(P.cyl(0.075, 0.17, 0.3, 8), { color: (p) => (Math.abs(p.y - 0.42) < 0.03 ? K.cream : K.red).clone() }, M.t(sx, 0.5, sz));
  box(b, 0.46, 0.07, 0.07, K.red, sx, 0.6, sz);
  for (const s of [-1, 1]) {
    b.add(P.cone(0.04, 0.09, 5), { color: K.thatch, leaf: 0.2 }, M.t(sx + s * 0.27, 0.6, sz, 0, 0, s * Math.PI / 2));
    box(b, 0.03, 0.22, 0.008, s > 0 ? K.teal : K.gold, sx + s * 0.2, 0.47, sz + 0.05);
  }
  b.add(P.cyl(0.19, 0.19, 0.02, 12), { color: K.thatch, leaf: 0.2 }, M.t(sx, 0.925, sz));
  b.add(P.cone(0.13, 0.15, 8), { color: K.thatchDark, leaf: 0.2 }, M.t(sx, 1.01, sz));
};

const farmTerraces: Look = (b, w, d) => {
  const D = farmDitches(w, d);
  const stone = (p: THREE.Vector3) => CUT.stoneDark.clone().lerp(CUT.stoneLight, Math.min(1, p.y * 9));
  // A low cut-stone kerb, 0.03 thick, between (x0, z0) and (x1, z1) (axis-aligned).
  const kerb = (x0: number, z0: number, x1: number, z1: number, h = 0.11) => {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0), len = Math.abs(alongX ? x1 - x0 : z1 - z0);
    if (len < 0.05) return;
    box(b, alongX ? len : 0.03, h, alongX ? 0.03 : len, stone, (x0 + x1) / 2, h / 2, (z0 + z1) / 2);
  };
  const o = 0.06, gap = 0.1;
  // Stone kerbs line every ditch, so each bed stands framed in stone between its channels.
  for (const m of D.mids) {
    // (The middle ditch runs under the footbridge: its kerbs stop short of the bridge's bearers.)
    const za = m.back || m.z0 === D.feederZ ? m.z0 + gap : m.z0, zb = m.front ? m.z1 - (Math.abs(m.x) < 0.35 ? 0.17 : gap) : m.z1;
    for (const s of [-1, 1]) kerb(m.x + s * o, za, m.x + s * o, zb);
  }
  // Along the feeder and the front ditch, kerbs break where a ditch joins and at the footbridge.
  const breaks = (x0: number, x1: number, cuts: [number, number][], z: number) => {
    let a = x0;
    for (const [x, g] of cuts.filter(([x]) => x > x0 && x < x1).sort((p, q) => p[0] - q[0])) {
      if (x - g > a) kerb(a, z, x - g, z);
      a = Math.max(a, x + g);
    }
    kerb(a, z, x1, z);
  };
  const joins = (ms: typeof D.mids) => ms.map((m) => [m.x, gap] as [number, number]);
  breaks(D.feeder[0] - 0.025, D.feeder[1], joins(D.mids.filter((m) => m.back)), D.feederZ + o);
  kerb(D.feeder[0] - 0.025, D.feederZ - o, D.feeder[1], D.feederZ - o);
  breaks(D.cross[0] - 0.025, D.cross[1], [...joins(D.mids.filter((m) => m.front)), [0, 0.33]], D.frontZ - o);
  breaks(D.cross[0] - 0.025, D.cross[1], [[0, 0.33]], D.frontZ + o);
  // Stone end walls where a bed stops short of a ditch, and kerbs along the outermost beds.
  for (const r of D.rows) {
    if (r.z0 > D.feederZ + 0.3) box(b, 0.36, 0.13, 0.06, stone, r.x, 0.065, r.z0 - 0.02);
    if (r.z1 < D.frontZ - 0.3) box(b, 0.36, 0.13, 0.06, stone, r.x, 0.065, r.z1 + 0.02);
  }
  const first = D.rows[0], last = D.rows[D.rows.length - 1];
  kerb(first.x - 0.25, first.z0, first.x - 0.25, D.frontZ - o - 0.06, 0.12);
  kerb(last.x + 0.25, last.z0, last.x + 0.25, Math.min(last.z1, d / 2 - 0.15 - FARM_PEN.size), 0.12);
  // The chicken run gets a perch, a nest basket with eggs and a feed dish for the wild chickens caught.
  const S = FARM_PEN.size, [px, pz] = FARM_PEN.centre(w, d), x0 = px - S / 2, z1 = pz + S / 2;
  for (const x of [x0 + 0.14, x0 + 0.6]) {
    for (const t of [-1, 1]) rod(b, v(x, 0, z1 - 0.2 + t * 0.07), v(x, 0.34, z1 - 0.2), 0.014, K.timberDark);
  }
  for (const y of [0.18, 0.3]) b.add(P.cyl(0.014, 0.014, 0.56, 5), { color: K.timber }, M.t(x0 + 0.37, y, z1 - 0.2, 0, 0, Math.PI / 2));
  basket(b, px + S / 2 - 0.2, 0, z1 - 0.18, 0.1, 0.08, PEN.straw);
  for (let k = 0; k < 3; k++) b.add(P.uvSphere(0.024, 6, 5), { color: PEN.egg }, M.t(px + S / 2 - 0.22 + k * 0.025, 0.1, z1 - 0.18 + (k % 2) * 0.03, 0, 0, 0, 1, 1.3, 1));
  b.add(P.cyl(0.09, 0.07, 0.035, 9), { color: K.terracotta }, M.t(x0 + 0.42, 0.018, pz - 0.05));
  b.add(P.cyl(0.075, 0.075, 0.01, 9), { color: PEN.grain }, M.t(x0 + 0.42, 0.043, pz - 0.05));
};

// ---------------- Maize farm (5 × 5) ----------------

/** Maize hills (as models.ts maizeLayout): each row's x and the z of its hills. */
function maizeHills(w: number, d: number): { x: number; zs: number[] }[] {
  const rows = Math.max(2, Math.floor(w * 1.4)), cols = Math.max(2, Math.floor(d * 1.9)), dz = (d - 1.3) / (cols - 1);
  const out: { x: number; zs: number[] }[] = [];
  for (let r = 0; r < rows; r++) {
    const x = -w / 2 + 0.55 + (r / (rows - 1)) * (w - 1.1), zs: number[] = [];
    for (let k = 0; k < cols; k++) {
      const z = -d / 2 + 0.55 + k * dz + (r % 2 ? dz * 0.5 : 0);
      if (z > d / 2 - 0.5) continue;
      if (z < -d / 2 + 1.15 && (x < -w / 2 + 1.25 || x > w / 2 - 1.05)) continue;
      if (Math.abs(x) < 0.3 && z < -d / 2 + 0.95) continue;
      zs.push(z);
    }
    out.push({ x, zs });
  }
  return out;
}
/** Where the maize farm's watch hut stands (between rows, left of middle) and its front scarecrow. */
const watchHut = (w: number, d: number) => {
  const xs = maizeHills(w, d).map((r) => r.x), x0 = (xs[0] + xs[1]) / 2, x1 = (xs[1] + xs[2]) / 2;
  return { x0, x1, z0: 0.3, z1: 0.3 + (x1 - x0), scare: { x: (xs[xs.length - 2] + xs[xs.length - 1]) / 2, z: d / 2 - 0.9 } };
};

const maizeCrib: Look = (b, w, d) => {
  const gx = -w / 2 + 0.1 + 0.6, gz = -d / 2 + 0.1 + 0.6;
  // A bigger cuexcomatl built round the old one: a broad stone base with a red band, a tall body of
  // woven cane bound with rope, a little door, and a deep thatched cap.
  b.add(P.cyl(0.53, 0.57, 0.26, 12), { color: (p) => CUT.stoneDark.clone().lerp(CUT.stone, p.y * 3) }, M.t(gx, 0.13, gz));
  b.add(P.cyl(0.58, 0.58, 0.05, 12), { color: K.red }, M.t(gx, 0.2, gz));
  b.add(P.cyl(0.48, 0.51, 1.02, 14, true), { color: (p) => ((p.y * 12) % 1 < 0.5 ? K.thatchDark : K.adobe).clone() }, M.t(gx, 0.77, gz));
  for (const y of [0.5, 0.9, 1.2]) b.add(P.cyl(0.505 - (y - 0.26) * 0.03, 0.505 - (y - 0.26) * 0.03, 0.035, 14, true), { color: K.timberDark }, M.t(gx, y, gz));
  b.add(P.cone(0.7, 0.55, 12), { color: thatchColor, leaf: 0.2 }, M.t(gx, 1.29 + 0.275, gz));
  b.add(P.sphere(0.07, 0), { color: K.thatchDark, leaf: 0.2 }, M.t(gx, 1.86, gz));
  // A small timber door on the field side, and a heap of cobs in a basket at its foot.
  const a = Math.PI / 4, dx = gx + Math.sin(a) * 0.5, dz = gz + Math.cos(a) * 0.5;
  box(b, 0.22, 0.3, 0.04, K.door, dx, 0.95, dz, 0, a, 0);
  box(b, 0.27, 0.04, 0.05, K.timberDark, dx, 1.12, dz, 0, a, 0);
  const rng = new RNG(551);
  basket(b, gx + 0.66, 0, gz + 0.18, 0.11, 0.1);
  for (let k = 0; k < 6; k++) {
    const t = rng.range(0, 6.28), r = rng.range(0, 0.06);
    b.add(P.cyl(0.018, 0.022, 0.09, 6), { color: k % 3 ? K.gold : c(0xe8a526) }, M.t(gx + 0.66 + Math.cos(t) * r, 0.12, gz + 0.18 + Math.sin(t) * r, Math.PI / 2, t, 0.3));
  }
};

const maizeThreeSisters: Look = (b, w, d) => {
  const rng = new RNG(4141), rows = maizeHills(w, d), hut = watchHut(w, d);
  const clear = (x: number, z: number) =>
    !(x < -w / 2 + 1.35 && z < -d / 2 + 1.45) && !(x > w / 2 - 1.15 && z < -d / 2 + 1.45) && !(Math.abs(x) < 0.5 && z < -d / 2 + 1.1) &&
    !(x > hut.x0 - 0.2 && x < hut.x1 + 0.2 && z > hut.z0 - 0.2 && z < hut.z1 + 0.65) && Math.hypot(x - hut.scare.x, z - hut.scare.z) > 0.35;
  // Squash sprawling between the rows: big low leaves in a mound, a pumpkin or two, a yellow flower.
  for (let k = 0; k + 1 < rows.length; k++) {
    const x = (rows[k].x + rows[k + 1].x) / 2;
    for (let z = -d / 2 + 0.75 + (k % 2) * 0.4; z < d / 2 - 0.55; z += rng.range(0.8, 0.95)) {
      if (!clear(x, z)) continue;
      for (let l = 0; l < 3; l++) {
        const a = (l / 3) * 6.28 + rng.range(-0.5, 0.5), o = rng.range(0.05, 0.09);
        b.add(lumpy(P.sphere(rng.range(0.13, 0.16), 0), 0.2, rng.int(1, 9999), 0.3), { color: (l % 2 ? LEAF.dark : LEAF.mid).clone().multiplyScalar(rng.range(0.9, 1.1)), leaf: 1 }, M.t(x + Math.cos(a) * o * 0.6, 0.07 + l * 0.012, z + Math.sin(a) * o * 1.6));
      }
      const r = rng.range(0.07, 0.095), fx = x + rng.range(-0.06, 0.06), fz = z + rng.range(0.1, 0.16);
      b.add(ribbedFruit(r), { color: rng.next() < 0.7 ? c(0xe8862a) : c(0xf0c43a) }, M.t(fx, r * 0.8, fz, 0, rng.range(0, 3), 0, 1.15, 0.82, 1.15));
      if (rng.next() < 0.5) b.add(P.cone(0.035, 0.06, 5), { color: c(0xf5b82a), leaf: 1 }, M.t(x - 0.04, 0.16, z - 0.08, Math.PI, 0, 0));
    }
  }
  // Beans twining up from the foot of the maize: a green spiral with leaves, red flowers and pods.
  for (const row of rows) for (const z of row.zs) {
    if (rng.next() > 0.3 || !clear(row.x, z)) continue;
    const ph = rng.range(0, 6.28), h = rng.range(0.4, 0.55), pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, a = ph + t * Math.PI * 3.2;
      pts.push(v(row.x + Math.cos(a) * 0.05, 0.02 + t * h, z + Math.sin(a) * 0.05));
    }
    b.add(tube(pts, () => 0.007, 3, 10), { color: c(0x4a8a2c) });
    for (let i = 2; i <= 8; i += 3) {
      const p = pts[i], a = ph + i;
      b.add(lumpy(P.sphere(0.035, 0), 0.2, i + 7, 0.4), { color: LEAF.light, leaf: 1 }, M.t(p.x + Math.cos(a) * 0.04, p.y, p.z + Math.sin(a) * 0.04));
      if (i === 5) b.add(FLOWER, { color: c(0xe0452c), leaf: 1 }, M.t(p.x, p.y + 0.03, p.z, 0, 0, 0, 0.6, 0.6, 0.6));
      else b.add(P.cyl(0.008, 0.006, 0.08, 4), { color: i === 2 ? c(0x8fc24a) : c(0x6a3a72) }, M.t(p.x - Math.cos(a) * 0.04, p.y - 0.04, p.z - Math.sin(a) * 0.04, 0.2, 0, 0));
    }
  }
};

const maizeSecondField: Look = (b, w, d) => {
  const H = watchHut(w, d), cx = (H.x0 + H.x1) / 2, cz = (H.z0 + H.z1) / 2, s = H.x1 - H.x0, fy = 1.45;
  // A watch hut on stilts for the second field's farmer, standing between the rows above the maize.
  for (const x of [H.x0, H.x1]) for (const z of [H.z0, H.z1]) pole(b, x, z, 2.05, 0.045, K.timberDark);
  for (const z of [H.z0, H.z1]) box(b, s + 0.12, 0.06, 0.06, K.timberDark, cx, fy - 0.06, z);
  for (let k = 0; k < 6; k++) box(b, (s + 0.14) / 6 - 0.01, 0.035, s + 0.14, k % 2 ? K.timber : K.timberMid, H.x0 - 0.07 + ((k + 0.5) * (s + 0.14)) / 6, fy, cz);
  for (const [x0, z0, x1, z1] of [[H.x0, H.z0, H.x1, H.z0], [H.x0, H.z0, H.x0, H.z1], [H.x1, H.z0, H.x1, H.z1]] as const) {
    box(b, Math.abs(x1 - x0) + 0.04, 0.035, Math.abs(z1 - z0) + 0.04, K.timber, (x0 + x1) / 2, fy + 0.32, (z0 + z1) / 2);
    wattleRun(b, x0, z0, x1, z1, fy + 0.03, 0.22, 3, 0.025);
  }
  thatchCap(b, cx, 2.02, cz, s * 0.95, 0.5);
  b.add(P.sphere(0.06, 0), { color: K.thatchDark, leaf: 0.2 }, M.t(cx, 2.53, cz));
  // Its ladder up from the row between, on the front side.
  const lx = H.x1, a = v(lx, 0, H.z1 + 0.42), top = v(lx, fy + 0.02, H.z1 + 0.02);
  for (const s2 of [-1, 1]) rod(b, a.clone().setX(lx + s2 * 0.08), top.clone().setX(lx + s2 * 0.08), 0.016, K.timber);
  for (let k = 1; k < 10; k++) {
    const p = a.clone().lerp(top, k / 10);
    box(b, 0.17, 0.018, 0.022, K.timberDark, lx, p.y, p.z);
  }
  // A tall scarecrow for the second field, high enough to stand above the maize, arms along the rows.
  const { x: sx, z: sz } = H.scare;
  pole(b, sx, sz, 1.55, 0.025, K.timber);
  b.add(P.cyl(0.016, 0.016, 0.6, 4), { color: K.timber }, M.t(sx, 1.22, sz, Math.PI / 2, 0, 0));
  b.add(P.cyl(0.075, 0.17, 0.32, 8), { color: (p) => (Math.abs(p.y - 1.06) < 0.03 ? K.cream : K.teal).clone() }, M.t(sx, 1.12, sz));
  box(b, 0.07, 0.07, 0.5, K.teal, sx, 1.22, sz);
  b.add(P.sphere(0.08, 1), { color: K.thatch, leaf: 0.2 }, M.t(sx, 1.42, sz));
  b.add(P.cyl(0.19, 0.19, 0.02, 12), { color: K.thatch, leaf: 0.2 }, M.t(sx, 1.49, sz));
  b.add(P.cone(0.12, 0.15, 8), { color: K.red }, M.t(sx, 1.57, sz));
};

// ---------------- Water garden (chinampa, 4 × 4) ----------------

const CH = { z0: -1.5, z1: 1.2, walkZ: 1.62, bedW: 1.0, wy: 0.06 };
const reedBand = (p: THREE.Vector3) => ((Math.floor((p.x + p.z) * 20) % 2 ? c(0xc9a35a) : c(0xa9853f))).clone();

const chinampaCanalBeds: Look = (b, w, d) => {
  const rng = new RNG(902);
  // A long seedbed along the back channel: a raised bed walled in woven reed, its mud cut into
  // squares (chapines), each sprouting seedlings ready to plant out.
  const x0 = -w / 2 + 0.45, x1 = w / 2 - 0.5, z0 = -d / 2 + 0.16, z1 = CH.z0 - 0.1, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, L = x1 - x0, D = z1 - z0, top = 0.15;
  box(b, L - 0.01, top, D - 0.01, c(0x3b2a1c), cx, top / 2, cz);
  for (const s of [-1, 1]) {
    b.add(new THREE.BoxGeometry(L + 0.05, top + 0.04, 0.03, 40, 1, 1), { color: reedBand, facet: true }, M.t(cx, (top + 0.04) / 2, cz + s * (D / 2 - 0.005)));
    b.add(new THREE.BoxGeometry(0.03, top + 0.04, D - 0.04, 1, 1, 4), { color: reedBand, facet: true }, M.t(cx + s * (L / 2 - 0.005), (top + 0.04) / 2, cz));
    box(b, L + 0.08, 0.014, 0.056, K.rope, cx, top - 0.02, cz + s * (D / 2 - 0.005));
  }
  for (const x of [x0, cx - L / 4, cx, cx + L / 4, x1]) for (const z of [z0, z1]) pole(b, x, z, top + 0.14, 0.032, K.timber);
  const n = Math.floor((L - 0.1) / 0.13);
  for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) {
    const x = x0 + 0.1 + i * 0.13, z = cz + (j - 0.5) * 0.11;
    box(b, 0.1, 0.03, 0.09, c(0x56402a), x, top + 0.017, z);
    b.add(lumpy(P.sphere(0.04, 0), 0.3, i * 3 + j, 1.3), { color: (j + i) % 3 ? LEAF.light : c(0x8ccc58), leaf: 1 }, M.t(x + rng.range(-0.01, 0.01), top + 0.06, z));
  }
};

const chinampaFish: Look = (b, w) => {
  const rng = new RNG(377), beds = chinampaBeds(w), wy = CH.wy;
  const channels = [0, 1].map((k) => (beds[k] + CH.bedW / 2 + beds[k + 1] - CH.bedW / 2) / 2);
  for (const x of channels) {
    // Woven fish traps lying in each channel, staked to the bank.
    for (const z of [-1.0, 0.82]) {
      const trap = doubleSide(new THREE.CylinderGeometry(0.075, 0.035, 0.34, 9, 1, true));
      b.add(trap, { color: (p) => ((Math.atan2(p.x - x, p.y - wy) * 3 + p.z * 30) % 2 < 1 ? c(0xb8935a) : c(0x8e6e40)).clone() }, M.t(x, wy + 0.02, z, Math.PI / 2, 0, 0));
      b.add(P.cyl(0.035, 0.035, 0.012, 9), { color: c(0x6a5030) }, M.t(x, wy + 0.02, z - 0.17, Math.PI / 2, 0, 0));
      pole(b, x + 0.07, z + 0.12, 0.3, 0.018, K.timberDark);
    }
    // A stake weir across the channel mouth, with wattle woven between.
    for (let k = 0; k < 4; k++) pole(b, x - 0.1 + k * 0.067, CH.z1 + 0.13, 0.3, 0.017, K.timberDark);
    wattleRun(b, x - 0.11, CH.z1 + 0.13, x + 0.11, CH.z1 + 0.13, 0.03, 0.16, 3, 0.022);
    // Fish rising in the channel, gold and silver, a ripple round some.
    for (const z of [-1.35, -0.62, -0.42, 0.35, 0.55, 1.08]) {
      const zz = z + rng.range(-0.05, 0.05), a = rng.range(-0.4, 0.4) + (rng.next() < 0.5 ? Math.PI : 0);
      fish(b, x + rng.range(-0.03, 0.03), wy, zz, a, rng.range(1.4, 1.7), rng.next() < 0.55 ? FISH.gold : FISH.silver);
      if (rng.next() < 0.5) b.add(P.torus(0.09, 0.004, 3, 14), { color: c(0x8fc3b4) }, M.t(x, wy + 0.004, zz, Math.PI / 2, 0, 0));
    }
  }
  // More fish in the open water before the boardwalk, and a basket of the catch on it.
  for (let k = 0; k < 6; k++) {
    const x = -1.6 + k * 0.62 + rng.range(-0.08, 0.08);
    if (channels.some((cx) => Math.abs(cx - x) < 0.2)) continue;
    fish(b, x, wy, CH.z1 + 0.13, rng.range(0, 6.28), 1.5, k % 2 ? FISH.gold : FISH.silver);
  }
  basket(b, -1.15, CHINAMPA_BED_Y + 0.02, CH.walkZ - 0.07, 0.1, 0.09, FISH.silver, rng, true);
};

const chinampaFlowers: Look = (b, w) => {
  const rng = new RNG(1517), y = CHINAMPA_BED_Y + 0.02;
  const cols = [0xf08a1c, 0xf4c430, 0xe0661a, 0xe86aa0, 0xd8322a, 0xf4eee0, 0x8a4ab0];
  const clump = (x: number, yy: number, z: number, s = 1) => {
    b.add(lumpy(P.sphere(0.045 * s, 0), 0.3, rng.int(1, 9999), 0.8), { color: LEAF.mid.clone().multiplyScalar(rng.range(0.85, 1.1)), leaf: 1 }, M.t(x, yy + 0.03 * s, z));
    for (let k = 0; k < 2; k++) {
      const col = c(rng.pick(cols));
      b.add(FLOWER, { color: (q) => (q.y > yy + 0.1 * s ? c(0xf2d04a) : col.clone()), leaf: 1 }, M.t(x + rng.range(-0.03, 0.03) * s, yy + (0.075 + k * 0.02) * s, z + rng.range(-0.03, 0.03) * s, 0, rng.range(0, 3), 0, s, 0.6 * s, s));
    }
  };
  // Borders of marigolds, dahlias and cosmos along both long edges of every bed.
  for (const bx of chinampaBeds(w)) for (const s of [-1, 1]) {
    for (let z = CH.z0 + 0.12; z < CH.z1 - 0.08; z += 0.2) clump(bx + s * 0.42 + rng.range(-0.015, 0.015), y, z + rng.range(-0.03, 0.03), 1.25);
  }
  // Pots of flowers along the boardwalk rail.
  for (const x of [-1.6, -0.4, 0.4, 1.05]) {
    b.add(P.cyl(0.075, 0.055, 0.11, 8), { color: (p) => (Math.abs(p.y - (y + 0.08)) < 0.015 ? K.cream : K.terracotta).clone() }, M.t(x, y + 0.055, CH.walkZ + 0.07));
    clump(x, y + 0.08, CH.walkZ + 0.07, 1.2);
  }
};

// ---------------- Smokehouse (3 × 3) ----------------

/** A drying rack as the smokehouse's own: splayed end frames, two poles hung with fish and meat. */
function dryingRack(b: GeoBuilder, rx: number, rz: number): void {
  for (const ox of [-0.5, 0.5]) for (const lean of [-0.28, 0.28]) b.add(P.cyl(0.022, 0.028, 1.05, 5), { color: K.timber }, M.t(rx + ox, 0.5, rz + lean * 0.5, lean, 0, 0));
  for (const y of [0.72, 0.92]) {
    b.add(P.cyl(0.018, 0.018, 1.1, 4), { color: K.timberDark }, M.t(rx, y, rz, 0, 0, Math.PI / 2));
    for (let k = 0; k < 7; k++) {
      const x = rx - 0.42 + k * 0.14;
      if ((k + (y > 0.8 ? 0 : 1)) % 2 === 0) {
        b.add(P.sphere(0.06, 0), { color: c(0xc8a46a).lerp(c(0x8a5a30), (k % 3) * 0.2) }, M.t(x, y - 0.13, rz, 0, 0, 0, 0.42, 1.55, 0.75));
        b.add(P.cone(0.04, 0.05, 3), { color: c(0x7a4a28) }, M.t(x, y - 0.03, rz, Math.PI, 0, 0, 1, 1, 0.4));
      } else box(b, 0.05, 0.17, 0.018, c(0x9a3a22).lerp(c(0x5a2a1a), (k % 2) * 0.4), x, y - 0.1, rz, 0, 0, ((k % 3) - 1) * 0.08);
    }
  }
}

const smokeSecondRack: Look = (b, w, d) => {
  // A third rack (the house had two) out at the front right, over its own smouldering pit.
  const rx = w / 2 - 0.7, rz = d / 2 - 0.42;
  dryingRack(b, rx, rz);
  b.add(P.cyl(0.22, 0.26, 0.06, 8), { color: K.stoneDark }, M.t(rx, 0.03, rz));
  for (let k = 0; k < 3; k++) b.add(P.cyl(0.028, 0.028, 0.34, 5), { color: c(0x3a2820) }, M.t(rx, 0.08, rz, 0, (k / 3) * Math.PI, Math.PI / 2));
  b.add(P.sphere(0.08, 0), { color: c(0xe8702a) }, M.t(rx, 0.1, rz, 0, 0, 0, 1.3, 0.5, 1.3));
};

const smokeChimney: Look = (b, w) => {
  // A tall clay flue on the house's stone chimney, banded and lipped...
  const hx = -w / 2 + 0.95, cx = hx + 0.35, cz = -0.15 - 0.3, y0 = 1.31;
  b.add(P.cyl(0.12, 0.15, 0.55, 10), { color: K.terracotta }, M.t(cx, y0 + 0.275, cz));
  for (const t of [0.15, 0.38]) b.add(P.cyl(0.152 - t * 0.055, 0.152 - t * 0.055, 0.035, 10, true), { color: K.cream }, M.t(cx, y0 + t, cz));
  b.add(P.cyl(0.155, 0.13, 0.07, 10), { color: K.terracottaDark }, M.t(cx, y0 + 0.585, cz));
  b.add(P.cyl(0.1, 0.1, 0.01, 10), { color: K.soot }, M.t(cx, y0 + 0.625, cz));
  // ...and a clay hood over the fire under the racks, so the smoke stays in among the fish.
  const rx = w / 2 - 0.7;
  b.add(new THREE.SphereGeometry(0.36, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), { color: (p) => K.terracotta.clone().lerp(c(0x6a3a28), Math.max(0, 0.18 - p.y) * 3) }, M.t(rx, 0.03, 0, 0, 0, 0, 1, 0.85, 1));
  box(b, 0.18, 0.14, 0.12, K.soot, rx, 0.1, 0.32);
  box(b, 0.24, 0.04, 0.05, K.terracottaDark, rx, 0.19, 0.35);
  b.add(P.cyl(0.05, 0.06, 0.28, 8), { color: K.terracotta }, M.t(rx, 0.42, 0));
  b.add(P.cyl(0.035, 0.035, 0.01, 8), { color: K.soot }, M.t(rx, 0.568, 0));
};

const smokeCellar: Look = (b, w, d) => {
  // A cool cellar dug in behind the racks: an earth mound grassed over, a stone doorway with steps
  // going down, a clay vent pipe on top, and big storage jars beside it.
  const cx = w / 2 - 0.68, cz = -d / 2 + 0.38;
  b.add(lumpy(new THREE.SphereGeometry(1, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0.06, 77), { color: (_p, n) => c(0x7a5c3c).lerp(c(0x6f8c45), THREE.MathUtils.smoothstep(n.y, 0.3, 0.8)) }, M.t(cx, 0, cz - 0.04, 0, 0, 0, 0.55, 0.34, 0.3));
  const fz = cz + 0.22;
  for (const s of [-1, 1]) box(b, 0.08, 0.32, 0.12, CUT.stone, cx + s * 0.16, 0.16, fz);
  box(b, 0.44, 0.07, 0.16, CUT.stoneLight, cx, 0.35, fz);
  box(b, 0.24, 0.29, 0.04, K.soot, cx, 0.145, fz + 0.03);
  for (let k = 0; k < 2; k++) box(b, 0.24, 0.03, 0.08, CUT.stoneDark, cx, 0.03 + k * 0.05, fz + 0.17 - k * 0.06);
  b.add(P.cyl(0.04, 0.05, 0.16, 8), { color: K.terracotta }, M.t(cx + 0.2, 0.38, cz - 0.08));
  for (const [x, z, s] of [[cx - 0.48, cz + 0.12, 1.15], [cx + 0.5, cz + 0.3, 1], [cx - 0.42, cz + 0.4, 0.85]] as const) jar(b, x, 0, z, s, s > 1 ? 0xb8562e : 0x9a5a34);
};

// ---------------- Slaughterhouse (4 × 3) ----------------

const butcherSecondTable: Look = (b, w) => {
  // A second butcher's table under its own striped canopy, in front of the counter.
  const x = -w / 4 - 0.35, z = 0.74, rng = new RNG(311);
  for (const s of [-1, 1]) for (const t of [-1, 1]) box(b, 0.04, 0.34, 0.04, K.timberDark, x + s * 0.3, 0.17, z + t * 0.11);
  box(b, 0.72, 0.05, 0.3, K.timber, x, 0.365, z);
  b.add(P.cyl(0.08, 0.08, 0.015, 9), { color: c(0x8a5a3a) }, M.t(x - 0.18, 0.4, z));
  for (let k = 0; k < 3; k++) box(b, 0.12, 0.035, 0.08, k % 2 ? c(0xb4483e) : c(0x9a3a2a), x + 0.05 + k * 0.1, 0.405 + k * 0.012, z + rng.range(-0.04, 0.04), 0, k, 0);
  box(b, 0.12, 0.012, 0.05, c(0x9a9a98), x - 0.18, 0.415, z + 0.02, 0, 0.5, 0);
  box(b, 0.05, 0.02, 0.025, K.timberDark, x - 0.1, 0.415, z + 0.05, 0, 0.5, 0);
  // The canopy: four posts, red and cream stripes, a valance.
  const cw = 0.86, cd = 0.5, cy = 0.78;
  for (const s of [-1, 1]) for (const t of [-1, 1]) pole(b, x + s * (cw / 2 - 0.03), z + t * (cd / 2 - 0.03), cy - 0.03, 0.025, c(0x7a4a2a));
  for (let k = 0; k < 6; k++) box(b, cw / 6, 0.025, cd, k % 2 ? K.cream : K.red, x - cw / 2 + (cw / 6) * (k + 0.5), cy + 0.02, z, 0.12, 0, 0);
  box(b, cw, 0.07, 0.02, K.red, x, cy - 0.04, z + cd / 2 + 0.01);
  // A stool for the second butcher.
  b.add(P.cyl(0.08, 0.09, 0.2, 8), { color: K.timberMid }, M.t(x + 0.12, 0.1, z + 0.36));
};

const butcherSalting: Look = (b, w, d) => {
  // A stone salting table heaped with salt, slabs of meat laid in it, a basket and a jar of salt.
  const x = -w / 4 - 0.25, z = d / 2 - 0.27, rng = new RNG(71);
  for (const s of [-1, 1]) box(b, 0.1, 0.3, 0.24, CUT.stoneDark, x + s * 0.22, 0.15, z);
  box(b, 0.66, 0.06, 0.32, CUT.stone, x, 0.33, z);
  for (let k = 0; k < 3; k++) {
    box(b, 0.15, 0.03, 0.11, c(0xd88a7a), x - 0.17 + k * 0.17, 0.375, z + rng.range(-0.05, 0.05), 0, rng.range(-0.3, 0.3), 0);
    b.add(lumpy(P.sphere(0.06, 1), 0.3, 40 + k, 0.45), { color: c(0xf4f0e6) }, M.t(x - 0.17 + k * 0.17 + 0.05, 0.37, z - 0.07));
  }
  basket(b, x + 0.45, 0, z - 0.02, 0.1, 0.12, c(0xf4f0e6));
  jar(b, x - 0.44, 0, z - 0.04, 0.75, 0xc4643a);
};

const butcherBlock: Look = (b, w) => {
  const x = -0.32, z = 0.72;
  // A great butcher's block: a thick round of hardwood on a stump, a cleaver bitten into it.
  b.add(P.cyl(0.17, 0.2, 0.22, 10), { color: K.timberDark }, M.t(x, 0.11, z));
  b.add(P.cyl(0.23, 0.23, 0.2, 12), { color: (_p, n) => (n.y > 0.7 ? c(0xd9b88a) : K.timber).clone() }, M.t(x, 0.32, z));
  for (const y of [0.26, 0.38]) b.add(P.cyl(0.245, 0.245, 0.02, 12), { color: c(0x4a3020) }, M.t(x, y, z));
  box(b, 0.15, 0.1, 0.012, c(0xa8a8a4), x + 0.05, 0.46, z + 0.02, 0, 0.6, 0.12);
  box(b, 0.025, 0.025, 0.16, K.timberDark, x + 0.12, 0.52, z + 0.07, 0.35, 0.6, 0);
  box(b, 0.14, 0.04, 0.1, c(0xb4483e), x - 0.08, 0.44, z - 0.06, 0, 0.4, 0);
  // A rack beside it with knives and a saw hung on pegs.
  const rx = w / 4 - 0.88;
  for (const s of [-1, 1]) pole(b, rx, z + s * 0.18, 0.7, 0.02, K.timberDark);
  box(b, 0.06, 0.04, 0.42, K.timber, rx, 0.66, z);
  for (let k = 0; k < 3; k++) box(b, 0.008, 0.16, 0.03, k === 1 ? c(0x9a9a98) : c(0xb0b0aa), rx - 0.02, 0.55, z - 0.1 + k * 0.1);
};

// ---------------- Pig pen (5 × 5) ----------------

const pigBiggerYard: Look = (b, w, d) => {
  const hw = w / 2 - 0.1, hd = d / 2 - 0.1, g0 = -0.1, g1 = 0.75, FH = 0.42, fresh = c(0xc49a6a);
  // The yard fenced higher all round to hold more animals: new pale posts on the old and a
  // fresh top board, the gate posts raised too.
  const runs: [number, number, number, number][] = [[-hw, -hd, hw, -hd], [hw, -hd, hw, hd], [-hw, -hd, -hw, hd], [-hw, hd, g0, hd], [g1, hd, hw, hd]];
  for (const [x0, z0, x1, z1] of runs) {
    const len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 0.55));
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n, z = z0 + ((z1 - z0) * k) / n;
      if (z === hd && (Math.abs(x - g0) < 0.01 || Math.abs(x - g1) < 0.01)) continue;
      box(b, 0.09, 0.3, 0.09, fresh, x, FH + 0.1 + 0.15, z);
    }
    box(b, 0.035, 0.1, len, fresh, (x0 + x1) / 2, FH + 0.24, (z0 + z1) / 2, 0, a, 0);
  }
  for (const x of [g0, g1]) box(b, 0.11, 0.26, 0.11, fresh, x, FH + 0.18 + 0.13, hd);
  // A hay rack for the bigger herd along the left fence, and fresh straw spread about.
  const rx = -hw + 0.16, z0 = -1.0, z1 = -0.2;
  for (const z of [z0, z1]) for (const s of [-1, 1]) rod(b, v(rx, 0, z), v(rx + s * 0.1, 0.5, z), 0.018, K.timberDark);
  for (const s of [-1, 1]) b.add(P.cyl(0.016, 0.016, z1 - z0 + 0.08, 4), { color: K.timber }, M.t(rx + s * 0.1, 0.5, (z0 + z1) / 2, Math.PI / 2, 0, 0));
  for (let k = 0; k < 7; k++) {
    const z = z0 + 0.05 + k * ((z1 - z0 - 0.1) / 6);
    for (const s of [-1, 1]) rod(b, v(rx, 0.12, z), v(rx + s * 0.1, 0.5, z), 0.008, K.timberMid);
  }
  b.add(lumpy(P.sphere(0.13, 1), 0.3, 91, 0.9), { color: c(0xd9c26a), leaf: 0.2 }, M.t(rx, 0.44, (z0 + z1) / 2, 0, 0, 0, 0.8, 0.8, 3));
};

const pigBreedingSty: Look = (b, _w, d) => {
  const rng = new RNG(66);
  // A small wattle sty with a thatched gable at the back of the yard, its door open on straw, and a
  // low hurdle in front where two piglets lie.
  const cx = 0.4, cz = -d / 2 + 0.43, sw = 1.1, sd = 0.5, h = 0.4;
  box(b, sw - 0.04, 0.03, sd - 0.04, PEN.straw, cx, 0.025, cz);
  for (const s of [-1, 1]) {
    wattleRun(b, cx - sw / 2, cz + s * (sd / 2), cx + sw / 2, cz + s * (sd / 2), 0.02, h, 5, 0.03);
    wattleRun(b, cx + s * (sw / 2), cz - sd / 2, cx + s * (sw / 2), cz + sd / 2, 0.02, h, 5, 0.03);
    for (const t of [-1, 1]) pole(b, cx + s * (sw / 2), cz + t * (sd / 2), h + 0.06, 0.045, K.timberDark);
  }
  box(b, 0.26, 0.3, 0.08, K.door, cx + 0.2, 0.17, cz + sd / 2);
  box(b, 0.32, 0.05, 0.11, K.timberDark, cx + 0.2, 0.34, cz + sd / 2);
  gableThatch(b, cx, h + 0.02, cz, sw + 0.18, sd + 0.24, 0.26, 6);
  // The hurdle and the piglets.
  wattleRun(b, cx - 0.5, cz + sd / 2 + 0.38, cx + 0.05, cz + sd / 2 + 0.38, 0.03, 0.2, 3, 0.025);
  for (const x of [cx - 0.5, cx + 0.05]) pole(b, x, cz + sd / 2 + 0.38, 0.26, 0.022, K.timberDark);
  for (let k = 0; k < 2; k++) {
    const px = cx - 0.32 + k * 0.2, pz = cz + sd / 2 + 0.2, a = rng.range(-0.6, 0.6);
    b.add(P.uvSphere(0.07, 8, 6), { color: c(0xe8a898) }, M.t(px, 0.06, pz, 0, a, 0, 0.9, 0.75, 1.3));
    b.add(P.uvSphere(0.04, 6, 5), { color: c(0xeab0a0) }, M.t(px + Math.sin(a) * 0.09, 0.07, pz + Math.cos(a) * 0.09));
    b.add(P.cyl(0.018, 0.018, 0.02, 6), { color: c(0xd88a80) }, M.t(px + Math.sin(a) * 0.13, 0.065, pz + Math.cos(a) * 0.13, Math.PI / 2, a, 0));
  }
};

const pigTroughsWallow: Look = (b, w, d) => {
  const hw = w / 2 - 0.1, hd = d / 2 - 0.1, wx = 0.3, wz = 0.15;
  const trough = (x: number, z: number, len: number, wid: number, alongX: boolean, fill: THREE.Color) => {
    const L = alongX ? len : wid, D = alongX ? wid : len, t = 0.05, h = 0.17;
    box(b, L - 0.04, 0.04, D - 0.04, CUT.stoneDark, x, 0.02, z);
    for (const s of [-1, 1]) {
      box(b, L, h, t, CUT.stone, x, h / 2, z + s * (D / 2 - t / 2));
      box(b, t, h, D - 2 * t, CUT.stone, x + s * (L / 2 - t / 2), h / 2, z);
    }
    box(b, L - 2 * t, 0.012, D - 2 * t, fill, x, h * 0.72, z);
  };
  // Two long stone troughs along the front and right fences: water, and mash.
  trough(1.5, hd - 0.17, 1.0, 0.24, true, PEN.water);
  trough(hw - 0.17, 0.8, 0.9, 0.24, false, c(0x9fb24a));
  // A shade over the wallow: four posts, a palm-thatch roof, mud splashed round its foot.
  const sw = 1.6, sd = 1.2, sy = 0.95;
  for (const s of [-1, 1]) for (const t of [-1, 1]) pole(b, wx + s * (sw / 2 - 0.05), wz - 0.1 + t * (sd / 2 - 0.05), sy, 0.04, K.timberDark);
  for (const t of [-1, 1]) box(b, sw + 0.04, 0.05, 0.05, K.timberDark, wx, sy - 0.02, wz - 0.1 + t * (sd / 2 - 0.05));
  for (let k = 0; k < 7; k++) {
    const z = wz - 0.1 - sd / 2 + 0.05 + (k + 0.5) * ((sd - 0.1) / 7);
    box(b, sw + 0.2 + (k % 2) * 0.04, 0.045, (sd - 0.1) / 7 + 0.03, k % 2 ? K.thatch : c(0x9aa04a), wx, sy + 0.04 + Math.sin((k / 6) * Math.PI) * 0.06 + (k % 2) * 0.035, z, (k - 3) * 0.06, 0, 0, 0.2);
  }
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + 0.3, r = 1.12;
    b.add(lumpy(P.sphere(0.07, 0), 0.4, 300 + k, 0.3), { color: PEN.mud }, M.t(wx + Math.cos(a) * r, 0.025, wz + Math.sin(a) * r * 0.85));
  }
};

// ---------------- Chicken pen (5 × 5) ----------------

const chickenBiggerCoop: Look = (b) => {
  // The coop extended on its left by a second room on stilts, daubed and woven like the first,
  // under a lower thatch, with its own pop hole and a ramp down.
  const cx = 0.07, cz = -1.62, cw = 0.66, cd = 0.74, fy = 0.38, ch = 0.4;
  for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) pole(b, cx + ox * (cw / 2 - 0.02), cz + oz * (cd / 2 - 0.02), fy + ch + 0.03, 0.045, K.timberDark);
  box(b, cw + 0.06, 0.04, cd + 0.06, K.timber, cx, fy, cz);
  box(b, cw - 0.04, ch * 0.6 - 0.03, cd - 0.04, K.adobe, cx, fy + 0.02 + (ch * 0.6 - 0.03) / 2, cz);
  const top = fy + ch * 0.62, hh = ch * 0.38, x0 = cx - cw / 2 + 0.02, x1 = cx + cw / 2 - 0.02, z0 = cz - cd / 2 + 0.02, z1 = cz + cd / 2 - 0.02;
  wattleRun(b, x0, z1, x1, z1, top, hh, 3);
  wattleRun(b, x0, z0, x1, z0, top, hh, 3);
  wattleRun(b, x0, z0, x0, z1, top, hh, 3);
  box(b, cw - 0.02, 0.03, 0.02, K.red, cx, fy + ch * 0.6 - 0.02, z1 + 0.01);
  box(b, 0.14, 0.18, 0.05, K.door, cx - 0.1, fy + 0.125, z1 + 0.01);
  gableThatch(b, cx - 0.02, fy + ch - 0.02, cz, cw + 0.14, cd + 0.24, 0.22, 4);
  const rl = 0.7, ra = Math.asin(fy / rl), r0 = z1 + 0.03;
  box(b, 0.16, 0.025, rl, K.timber, cx - 0.1, fy / 2 + 0.01, r0 + (Math.cos(ra) * rl) / 2, ra, 0, 0);
};

const chickenNestBoxes: Look = (b, w) => {
  const rng = new RNG(808);
  // A bank of nest boxes against the left fence: two tiers of straw-lined cubbies with eggs in
  // most, under a sloping thatch lid.
  const x = -w / 2 + 0.33, z0 = -0.12, z1 = 1.12, cols = 4, cw = (z1 - z0) / cols, dd = 0.26, h = 0.24;
  for (let t = 0; t < 2; t++) {
    const y = 0.06 + t * h;
    box(b, dd - 0.06, 0.025, z1 - z0, K.timber, x, y, (z0 + z1) / 2);
    for (let k = 0; k <= cols; k++) box(b, dd - 0.09, h - 0.02, 0.022, K.timberDark, x, y + h / 2, k === 0 ? z0 + 0.035 : k === cols ? z1 - 0.035 : z0 + k * cw);
    box(b, 0.025, 0.06, z1 - z0 - 0.06, K.timber, x + dd / 2 - 0.0005, y + 0.04, (z0 + z1) / 2);
    for (let k = 0; k < cols; k++) {
      const zz = z0 + (k + 0.5) * cw;
      b.add(P.cyl(0.09, 0.1, 0.04, 8), { color: PEN.straw }, M.t(x, y + 0.03, zz));
      if (rng.next() < 0.75) for (let e = 0; e < rng.int(1, 3); e++) b.add(P.uvSphere(0.026, 6, 5), { color: e % 2 ? c(0xe8d2b0) : PEN.egg }, M.t(x + rng.range(-0.04, 0.04), y + 0.07, zz + rng.range(-0.04, 0.04), 0, 0, 0, 1, 1.3, 1));
    }
  }
  box(b, dd - 0.05, 0.02, z1 - z0, K.timber, x, 0.06 + 2 * h, (z0 + z1) / 2);
  for (const z of [z0, z1]) for (const s of [-1, 1]) box(b, 0.04, 0.06 + 2 * h, 0.04, K.timberDark, x + s * (dd / 2 + 0.01), (0.06 + 2 * h) / 2, z);
  box(b, dd + 0.12, 0.035, z1 - z0 + 0.12, K.thatchDark, x - 0.01, 0.06 + 2 * h + 0.06, (z0 + z1) / 2, 0, 0, 0.32, 0.2);
};

const chickenBrooding: Look = (b, w, d) => {
  const rng = new RNG(29);
  // Broody hens on straw nests in the front right corner, sheltered by a woven windbreak and a
  // little thatch shade, their chicks out in front.
  const z = d / 2 - 0.42, xs = [w / 2 - 1.15, w / 2 - 0.75, w / 2 - 0.36], bodies = [c(0xf0ebe0), c(0xa0623a), c(0x5a4a40)];
  wattleRun(b, xs[0] - 0.24, z + 0.2, xs[2] + 0.18, z + 0.2, 0.03, 0.24, 3);
  for (const x of [xs[0] - 0.24, xs[2] + 0.18]) pole(b, x, z + 0.2, 0.9, 0.03, K.timberDark);
  box(b, xs[2] - xs[0] + 0.56, 0.035, 0.24, K.thatch, (xs[0] + xs[2]) / 2 - 0.03, 0.88, z + 0.2, 0.3, 0, 0, 0.2);
  xs.forEach((x, k) => {
    b.add(P.cyl(0.15, 0.13, 0.06, 10), { color: PEN.strawDark }, M.t(x, 0.03, z));
    b.add(P.torus(0.12, 0.035, 4, 10), { color: PEN.straw, leaf: 0.2 }, M.t(x, 0.07, z, Math.PI / 2, 0, 0));
    hen(b, x, 0.03, z, Math.PI + rng.range(-0.5, 0.5) + (k === 1 ? 0.4 : 0), bodies[k]);
  });
  for (let k = 0; k < 6; k++) chick(b, xs[0] - 0.1 + k * 0.17 + rng.range(-0.04, 0.04), z - 0.3 - rng.range(0, 0.2), rng.range(0, 6.28));
};

// ---------------- Wood and stone store (3 × 2) ----------------

const woodBiggerStacks: Look = (b, w, d) => {
  const rng = new RNG(5);
  // Logs stacked high against both side walls, outside, held by stakes at their ends.
  const r = 0.045, len = d - 0.2;
  for (const s of [-1, 1]) {
    const x = s * (w / 2 - 0.05);
    for (let row = 0; row < 8; row++) log(b, x + rng.range(-0.004, 0.004), r + row * r * 1.8, rng.range(-0.02, 0.02), r, len - rng.range(0, 0.12), 'z', row % 2 ? K.timber : c(0x7a5233));
    for (const z of [-len / 2 - 0.05, len / 2 + 0.05]) box(b, 0.03, 0.82, 0.03, K.timberDark, x, 0.41, z);
  }
};

const woodRoofedShed: Look = (b, w, d) => {
  // A terracotta tile roof laid over the slats (it won't catch from sparks in a storm): a bed of
  // clay under rows of curved tiles running down the slope, a ridge cap and a timber fascia.
  const H = 0.95, y = H + 0.08 + 0.085, tilt = 0.08, m = M.t(0, y, 0.0, tilt, 0, 0), L = w - 0.04, D = d - 0.09;
  b.add(P.box(L, 0.03, D), { color: K.terracottaDark }, m);
  const n = Math.floor(L / 0.12);
  for (let k = 0; k < n; k++) {
    const x = -L / 2 + (k + 0.5) * (L / n);
    b.add(P.cyl(0.05, 0.05, D - 0.03, 6, false), { color: k % 2 ? K.terracotta : c(0xb86a48) }, m.clone().multiply(M.t(x, 0.02, 0, Math.PI / 2, 0, 0, 1, 1, 0.5)));
  }
  b.add(P.box(L + 0.04, 0.08, 0.12), { color: K.terracottaDark }, m.clone().multiply(M.t(0, 0.05, -D / 2 + 0.04)));
  b.add(P.box(L + 0.04, 0.07, 0.06), { color: K.timberDark }, m.clone().multiply(M.t(0, -0.035, D / 2)));
};

const woodTimberYard: Look = (b, w, d) => {
  const pale = c(0xc8a070), rng = new RNG(19);
  // Squared beams stacked behind the shed on bearers, with sticks between the layers to dry them.
  const z = -d / 2 + 0.05, L = w - 0.3;
  for (let row = 0; row < 7; row++) {
    const y = 0.07 + row * 0.13;
    box(b, L - rng.range(0, 0.2), 0.09, 0.085, row % 2 ? pale : c(0xb08858), rng.range(-0.05, 0.05), y, z);
    if (row < 6) for (const x of [-L / 2 + 0.2, 0, L / 2 - 0.2]) box(b, 0.04, 0.04, 0.09, K.timberDark, x, y + 0.065, z);
  }
  for (const x of [-L / 2 - 0.02, L / 2 + 0.02]) box(b, 0.04, 0.98, 0.04, K.timberDark, x, 0.49, z);
  // At the front: a sawhorse with a beam on it, and a low stack of sawn boards.
  const fz = d / 2 - 0.08, sx = 0.78;
  for (const x of [sx - 0.25, sx + 0.25]) for (const t of [-1, 1]) rod(b, v(x + t * 0.08, 0, fz), v(x - t * 0.02, 0.32, fz), 0.016, K.timberDark);
  box(b, 0.8, 0.1, 0.09, pale, sx, 0.37, fz, 0, 0.04, 0);
  box(b, 0.03, 0.12, 0.004, c(0xa8a8a4), sx - 0.12, 0.47, fz, 0, 0, 0.2);
  for (let k = 0; k < 5; k++) box(b, 0.62 - k * 0.04, 0.05, 0.085, k % 2 ? pale : c(0xb08858), -sx, 0.025 + k * 0.06, fz, 0, rng.range(-0.04, 0.04), 0);
};

// ---------------- Food store (2 × 2) ----------------

const GRAIN = { gx: 0.02, gz: -0.12, yellow: c(0xe2b23a) };

const grainBiggerStores: Look = (b) => {
  // A third tier of cut stone over the old hatch, banded in yellow, with a new hatch on top.
  const { gx, gz, yellow } = GRAIN, y = 1.15, w = 0.46, d = 0.4, h = 0.3;
  b.add(P.box(w, h, d), { color: (p) => CUT.stone.clone().lerp(CUT.stoneLight, Math.min(1, Math.max(0, (p.y - y) / h)) * 0.5) }, M.t(gx, y + h / 2, gz));
  b.add(P.box(w + 0.024, 0.05, d + 0.024), { color: yellow }, M.t(gx, y + h * 0.55, gz));
  b.add(P.box(w + 0.04, 0.05, d + 0.04), { color: CUT.stoneLight }, M.t(gx, y + h - 0.01, gz));
  box(b, 0.1, 0.1, 0.02, c(0x4a3020), gx, y + h * 0.3, gz + d / 2 + 0.006);
  const ry = y + h + 0.02;
  box(b, 0.26, 0.03, 0.22, K.timber, gx, ry, gz);
  for (const s of [-1, 1]) box(b, 0.3, 0.04, 0.045, K.timberDark, gx, ry + 0.03, gz + s * 0.07);
};

/** A woven crib raised on stilts with rat guards, under a thatched cap. */
function stiltCrib(b: GeoBuilder, posts: [number, number][], h: number, y: number): void {
  const xs = posts.map((p) => p[0]), zs = posts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  for (const [x, z] of posts) {
    pole(b, x, z, y - h + 0.03, 0.026, K.timberDark, h - 0.03);
    b.add(P.cyl(0.075, 0.075, 0.015, 8), { color: CUT.stoneLight }, M.t(x, y - 0.1, z));
  }
  box(b, x1 - x0 + 0.08, 0.04, z1 - z0 + 0.08, K.timber, cx, y + 0.02, cz);
  b.add(new THREE.BoxGeometry(x1 - x0 - 0.02, 0.3, z1 - z0 - 0.02, 1, 6, 1), { color: (p) => ((p.y * 20) % 1 < 0.5 ? K.thatchDark : K.adobe).clone(), facet: true }, M.t(cx, y + 0.19, cz));
  box(b, 0.12, 0.14, 0.02, K.door, cx, y + 0.18, z1 - 0.01 + 0.006);
  // A hipped thatch cap overhanging the crib a little all round (a four-sided cone, squared to it).
  const hx = (x1 - x0) / 2 + 0.06, hz = (z1 - z0) / 2 + 0.06;
  const cap = new THREE.Matrix4().makeTranslation(cx, y + 0.34 + 0.15, cz).multiply(new THREE.Matrix4().makeScale(1, 1, hz / hx)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 4));
  b.add(P.cone(hx * Math.SQRT2, 0.3, 4), { color: thatchColor, leaf: 0.2 }, cap);
}

const grainStilts: Look = (b) => {
  // The lean-to and the pergola carry raised cribs on their posts, lifted clear of damp and sparks.
  stiltCrib(b, [[-0.9, -0.42], [-0.9, 0.42], [-0.5, -0.42], [-0.5, 0.42]], 0.58, 0.98);
  stiltCrib(b, [[0.6, 0.12], [0.92, 0.12], [0.6, 0.55], [0.92, 0.55]], 0.58, 0.98);
};

const grainClayJars: Look = (b) => {
  // Clay jars lined up on the granary's first-tier roof, round the second tier.
  const { gx, gz } = GRAIN, y = 0.86, rng = new RNG(88), bodies = [0xb8562e, 0x9a5a34, 0xc4643a, 0xa8583e];
  const spots: [number, number][] = [];
  for (const x of [-0.36, -0.12, 0.12, 0.36]) spots.push([gx + x, gz + 0.38]);
  for (const z of [-0.3, -0.05, 0.2]) spots.push([gx + 0.42, gz + z - 0.04]);
  for (const x of [-0.3, 0, 0.3]) spots.push([gx + x, gz - 0.35]);
  for (const [x, z] of spots) jar(b, x, y, z, rng.range(0.62, 0.72), rng.pick(bodies));
};

// ---------------- Fishing jetty (2 × 2 on the shore, pier along +z) ----------------

/** Where the jetty's land sits when the look isn't told (sea-level shore: layer 1). */
const SHORE_Y = 0.5 * WORLD.layerHeight;
const PIER = { z0: 1.2, len: 6 };
const plank = (z: number) => (Math.round(z * 4) % 2 ? c(0xa8784a) : c(0x94663c));

/** `landY` is the building's ground height (b.y): the pier deck stands at sea level just above the water. */
const jettyLongerPier = ((b: GeoBuilder, _w: number, _d: number, _t: THREE.Vector3[], landY = SHORE_Y) => {
  const deckY = 0.32 - landY, z1 = PIER.z0 + PIER.len, tz = z1 + 0.3;
  // The T-end lengthened a cell each way for another boat, on new piles, with a mooring post at each end.
  for (const s of [-1, 1]) {
    const xa = s < 0 ? -1.6 : 1.6, xb = s < 0 ? -0.6 : 2.6;
    for (let k = 0; k < 5; k++) box(b, 0.19, 0.05, 0.9, plank(k + (s > 0 ? 1 : 0)), xa + ((xb - xa) * (k + 0.5)) / 5, deckY, tz);
    for (const x of [s < 0 ? -1.5 : 2.5]) for (const z of [tz - 0.38, tz + 0.38]) b.add(P.cyl(0.05, 0.05, 2.6, 6), { color: K.timberDark }, M.t(x, deckY - 1.2, z));
    box(b, 0.96, 0.06, 0.06, K.timberDark, (xa + xb) / 2, deckY - 0.05, tz + 0.36);
    const mx = s < 0 ? -1.45 : 2.45;
    b.add(P.cyl(0.05, 0.06, 0.35, 6), { color: K.timberDark }, M.t(mx, deckY + 0.2, tz + 0.32));
    b.add(P.torus(0.07, 0.02, 4, 10), { color: K.rope }, M.t(mx, deckY + 0.3, tz + 0.32, Math.PI / 2, 0, 0));
  }
}) as Look;

const jettyNetRacks = ((b: GeoBuilder, _w: number, _d: number, _t: THREE.Vector3[], landY = SHORE_Y) => {
  const deckY = 0.32 - landY;
  // On land by the shed: an A-rack with nets hung over its bar to dry, floats along their hems.
  const rx = 0.64, z0 = -0.82, z1 = 0.02, bar = 0.92;
  for (const z of [z0, z1]) for (const s of [-1, 1]) rod(b, v(rx + s * 0.26, 0, z), v(rx, bar + 0.04, z), 0.025, K.timber);
  b.add(P.cyl(0.022, 0.022, z1 - z0 + 0.12, 5), { color: K.timberDark }, M.t(rx, bar, (z0 + z1) / 2, Math.PI / 2, 0, 0));
  for (const s of [-1, 1]) {
    const slope = Math.atan2(0.2, 0.6);
    net(b, z1 - z0 - 0.04, 0.62, M.t(rx + s * 0.09, bar - 0.31, (z0 + z1) / 2, 0, Math.PI / 2, 0).multiply(M.t(0, 0, 0, s * slope, 0, 0)), 10, 6);
    for (let k = 0; k < 5; k++) b.add(P.sphere(0.03, 0), { color: k % 2 ? c(0xb06a3a) : c(0x8e5a2e) }, M.t(rx + s * 0.2, bar - 0.6, z0 + 0.08 + k * ((z1 - z0 - 0.16) / 4)));
  }
  // Out on the pier: a long rack along its edge, a net hung full length, and a basket of floats.
  const px = 0.12, pz0 = PIER.z0 + 2.5, pz1 = PIER.z0 + 4.0, top = deckY + 0.85;
  for (const z of [pz0, pz1]) pole(b, px, z, 0.85, 0.03, K.timberDark, deckY);
  b.add(P.cyl(0.02, 0.02, pz1 - pz0 + 0.1, 5), { color: K.timberDark }, M.t(px, top - 0.03, (pz0 + pz1) / 2, Math.PI / 2, 0, 0));
  net(b, pz1 - pz0 - 0.06, 0.6, M.t(px + 0.03, top - 0.33, (pz0 + pz1) / 2, 0, Math.PI / 2, 0), 14, 6);
  for (let k = 0; k < 6; k++) b.add(P.sphere(0.03, 0), { color: k % 2 ? c(0xb06a3a) : c(0x8e5a2e) }, M.t(px + 0.035, top - 0.62, pz0 + 0.1 + k * ((pz1 - pz0 - 0.2) / 5)));
  basket(b, 0.75, deckY + 0.025, PIER.z0 + 3.2, 0.12, 0.12);
  for (let k = 0; k < 4; k++) b.add(P.sphere(0.035, 0), { color: c(0xb06a3a) }, M.t(0.72 + (k % 2) * 0.06, deckY + 0.16, PIER.z0 + 3.17 + (k > 1 ? 0.06 : 0)));
}) as Look;

/** A lantern hung from a crook-necked post: a timber cage with a fire inside (its flame is a torch). */
function lantern(b: GeoBuilder, torches: THREE.Vector3[], x: number, y0: number, z: number, h: number, ax: number, az: number): void {
  pole(b, x, z, h, 0.035, K.timberDark, y0);
  const hx = x + ax * 0.26, hz = z + az * 0.26, ly = y0 + h - 0.32;
  rod(b, v(x, y0 + h - 0.04, z), v(hx, y0 + h - 0.04, hz), 0.018, K.timberDark);
  b.add(P.cyl(0.005, 0.005, 0.08, 3), { color: K.rope }, M.t(hx, y0 + h - 0.1, hz));
  box(b, 0.16, 0.02, 0.16, K.timberDark, hx, ly - 0.09, hz);
  for (const s of [-1, 1]) for (const t of [-1, 1]) box(b, 0.018, 0.18, 0.018, K.timberDark, hx + s * 0.07, ly, hz + t * 0.07);
  b.add(P.cone(0.13, 0.1, 4), { color: K.terracotta }, M.t(hx, ly + 0.14, hz, 0, Math.PI / 4, 0));
  torches.push(v(hx, ly - 0.06, hz));
}

const jettyLantern = ((b: GeoBuilder, _w: number, _d: number, torches: THREE.Vector3[], landY = SHORE_Y) => {
  const deckY = 0.32 - landY, tz = PIER.z0 + PIER.len + 0.3;
  // Lanterns on tall crook posts at the ends of the T, halfway along the pier and at its foot on land.
  lantern(b, torches, -1.5, deckY, tz - 0.3, 1.35, 0, 1);
  lantern(b, torches, 2.5, deckY, tz - 0.3, 1.35, 0, 1);
  lantern(b, torches, 0.96, deckY, PIER.z0 + 3.0, 1.2, 1, 0);
  lantern(b, torches, -0.12, 0, 0.62, 1.3, 1, 0);
}) as Look;

// ---------------- Fisherman's hut (2 × 2 on stilts in the shallows) ----------------

/** Where the hut's base sits when the look isn't told (the sea bed of the shallows: layer 0). */
const SHALLOWS_Y = -0.5 * WORLD.layerHeight;
const HUT = { W: 1.1, D: 0.95, H: 0.62, zc: -0.32, rise: 0.42 };

const hutBigger = ((b: GeoBuilder, _w: number, _d: number, _t: THREE.Vector3[], landY = SHALLOWS_Y) => {
  const deck = 0.4 - landY, y0 = deck + 0.02;
  // A new room built out on the left side of the deck: plastered walls with timber corners, a red
  // foot, a fret band, a shuttered window and a lean-to of thatch against the old gable.
  const x0 = -0.93, x1 = -HUT.W / 2 - 0.02, z0 = HUT.zc - HUT.D / 2 + 0.02, z1 = 0.1, h = 0.5, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  b.add(P.box(x1 - x0, h, z1 - z0), { color: (p) => K.plaster.clone().lerp(c(0xd8c6a2), Math.max(0, 1 - (p.y - y0) / h) * 0.5) }, M.t(cx, y0 + h / 2, cz));
  box(b, x1 - x0 + 0.024, 0.05, z1 - z0 + 0.024, K.red, cx, y0 + 0.04, cz);
  for (const z of [z0, z1]) box(b, 0.06, h + 0.022, 0.06, K.timber, x0, y0 - 0.002 + (h + 0.022) / 2, z);
  fretBand(b, M.t(cx, y0 + h - 0.08, z1 + 0.007), x1 - x0 - 0.08, 0.06, K.teal, K.cream);
  fretBand(b, M.t(x0 - 0.007, y0 + h - 0.08, cz, 0, -Math.PI / 2, 0), z1 - z0 - 0.1, 0.06, K.teal, K.cream);
  box(b, 0.16, 0.14, 0.02, K.door, cx - 0.02, y0 + 0.26, z1 + 0.003);
  box(b, 0.02, 0.15, 0.2, K.door, x0 - 0.003, y0 + 0.26, cz + 0.05);
  const hi = y0 + h + 0.13, lo = y0 + h - 0.04, run = x1 + 0.01 - (x0 - 0.02), L = Math.hypot(run, hi - lo), a = Math.atan2(hi - lo, run);
  box(b, L, 0.07, z1 - z0 + 0.22, thatchColor, (x0 - 0.02 + x1 + 0.01) / 2, (hi + lo) / 2 + 0.04, cz, 0, 0, a, 0.2);
  for (let k = 0; k < 6; k++) box(b, 0.08, 0.06, (z1 - z0 + 0.22) / 6 - 0.03, K.thatchDark, x0 - 0.01, lo + 0.02, z0 - 0.11 + ((k + 0.5) * (z1 - z0 + 0.22)) / 6, 0, 0, a, 0.2);
}) as Look;

const hutNetLoft = ((b: GeoBuilder, _w: number, _d: number, _t: THREE.Vector3[], landY = SHALLOWS_Y) => {
  const deck = 0.4 - landY, fy = deck + 0.98, x0 = -0.48, x1 = 0.48, z0 = 0.2, z1 = 0.88;
  // An open drying loft built out over the porch on four posts: rolled nets piled on its floor,
  // more nets hung over its rails to dry with their floats.
  for (const x of [x0, x1]) for (const z of [z0, z1]) pole(b, x, z, fy - deck + 0.28, 0.03, K.timber, deck);
  for (const z of [z0, z1]) box(b, x1 - x0 + 0.08, 0.05, 0.05, K.timberDark, 0, fy - 0.04, z);
  for (let k = 0; k < 6; k++) box(b, (x1 - x0 + 0.1) / 6 - 0.01, 0.03, z1 - z0 + 0.06, k % 2 ? c(0x9a6c42) : c(0x865a36), x0 - 0.05 + ((k + 0.5) * (x1 - x0 + 0.1)) / 6, fy, (z0 + z1) / 2);
  box(b, x1 - x0 + 0.04, 0.03, 0.03, K.timberDark, 0, fy + 0.24, z1);
  for (const x of [x0, x1]) box(b, 0.02, 0.03, z1 - z0 + 0.04, K.timberDark, x, fy + 0.24, (z0 + z1) / 2);
  net(b, x1 - x0 - 0.06, 0.42, M.t(0, fy + 0.03, z1 + 0.06), 10, 4);
  net(b, z1 - z0 - 0.08, 0.36, M.t(x1 + 0.06, fy + 0.06, (z0 + z1) / 2, 0, Math.PI / 2, 0), 8, 4);
  for (let k = 0; k < 6; k++) b.add(P.sphere(0.032, 0), { color: k % 2 ? c(0xb06a3a) : c(0x8e5a2e) }, M.t(x0 + 0.08 + k * 0.16, fy - 0.19, z1 + 0.07));
  for (let k = 0; k < 4; k++) {
    b.add(P.cyl(0.075, 0.075, 0.4, 8), { color: (p) => ((Math.floor(p.x * 30) + Math.floor(p.y * 30) + Math.floor(p.z * 30)) % 2 ? c(0xc8b48a) : c(0xa89068)).clone(), facet: true }, M.t(-0.27 + k * 0.17, fy + 0.09, (z0 + z1) / 2 - 0.12 + (k % 2) * 0.14, Math.PI / 2, 0.15 * (k - 1.5), 0));
  }
  // A ladder up from the deck.
  const lx = 0.32, a = v(lx, deck, 0.97), top = v(lx, fy + 0.02, z1 + 0.04);
  for (const s of [-1, 1]) rod(b, a.clone().setX(lx + s * 0.07), top.clone().setX(lx + s * 0.07), 0.013, K.timber);
  for (let k = 1; k < 8; k++) {
    const p = a.clone().lerp(top, k / 8);
    box(b, 0.14, 0.015, 0.02, K.timberDark, lx, p.y, p.z);
  }
}) as Look;

const hutLarger = ((b: GeoBuilder, _w: number, _d: number, _t: THREE.Vector3[], landY = SHALLOWS_Y) => {
  const deck = 0.4 - landY, y0 = deck + 0.76, W = 0.78, D = 0.58, h = 0.48, zc = HUT.zc - 0.02;
  // An upper storey rising out of the old roof: plaster with timber corners and a teal fret, a
  // window to the shore, and its own steep thatch with a lashed ridge.
  b.add(P.box(W, h, D), { color: (p) => K.plaster.clone().lerp(c(0xd8c6a2), Math.max(0, 1 - (p.y - y0) / h) * 0.4) }, M.t(0, y0 + h / 2, zc));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(b, 0.06, h + 0.03, 0.06, K.timber, sx * (W / 2), y0 + h / 2, zc + sz * (D / 2));
  fretBand(b, M.t(0, y0 + h - 0.08, zc + D / 2 + 0.007), W - 0.1, 0.07, K.teal, K.cream);
  for (const s of [-1, 1]) fretBand(b, M.t(s * (W / 2 + 0.007), y0 + h - 0.08, zc, 0, s * Math.PI / 2, 0), D - 0.1, 0.07, K.teal, K.cream);
  box(b, 0.18, 0.16, 0.02, K.door, 0, y0 + 0.22, zc + D / 2 + 0.006);
  box(b, 0.24, 0.035, 0.05, K.timberDark, 0, y0 + 0.12, zc + D / 2 + 0.025);
  gableThatch(b, 0, y0 + h, zc, W + 0.3, D + 0.36, 0.36, 6);
  for (const s of [-1, 1]) for (const t of [-1, 1]) box(b, 0.03, 0.2, 0.03, K.timberDark, s * (W / 2 + 0.12), y0 + h + 0.36 + 0.08, zc + t * 0.05, t * 0.5, 0, 0);
}) as Look;

// ---------------- Wiring ----------------

export const FOOD_LOOKS: Looks = {
  farm: [farmIrrigation, farmFence, farmTerraces],
  maizefarm: [maizeCrib, maizeThreeSisters, maizeSecondField],
  chinampa: [chinampaCanalBeds, chinampaFish, chinampaFlowers],
  smokehouse: [smokeSecondRack, smokeChimney, smokeCellar],
  butcher: [butcherSecondTable, butcherSalting, butcherBlock],
  pigpen: [pigBiggerYard, pigBreedingSty, pigTroughsWallow],
  chickenpen: [chickenBiggerCoop, chickenNestBoxes, chickenBrooding],
  jetty: [jettyLongerPier, jettyNetRacks, jettyLantern],
  fishhut: [hutBigger, hutNetLoft, hutLarger],
  woodstore: [woodBiggerStacks, woodRoofedShed, woodTimberYard],
  grainstore: [grainBiggerStores, grainStilts, grainClayJars],
};
