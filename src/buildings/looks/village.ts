import * as THREE from 'three';
import { GeoBuilder, M, P, lumpy } from '../../render/GeoBuilder';
import { RNG } from '../../world/rng';
import { HALL, OBS, PALACE } from '../models';
import type { Look, Looks } from './types';

/**
 * The village buildings' upgrades, each drawn as what it says: the campfire's stone ring, story
 * seats and eternal flame; drums and a feast at the bonfire; the firepit's oven, dance ring and
 * long table; the well's lining, bucket chain and fountain; the Great Hall's benches, bell tower
 * and feast; the palace's roof gardens, treasury and second throne; the firemaker's bigger kiln,
 * rocket rack and coloured powders; the market's stalls, canoe landing and scales; the trade dock's
 * second berth, warehouse and beacon; and the observatory's star charts, raised deck and third
 * watcher's post. Model-local, door facing +z (see types.ts). The campfire and bonfire light their
 * own fires, so their looks add no flames (any flame there burns as a whole village fire).
 */

const c = (h: number) => new THREE.Color(h);
/** The palettes of models.ts: timber, adobe, cut sandstone, red and cream paint, terracotta, gold. */
const K = {
  timber: c(0x866443), timberDark: c(0x5e3b22), bark: c(0x6b4a2c), wood: c(0xc49a6a), terracotta: c(0xa8583e), clay: c(0xb8774a),
  gold: c(0xc8a451), jade: c(0x427c73), red: c(0xa64032), redDeep: c(0x8e2a22), cream: c(0xf3e3c6), white: c(0xf4eee0),
  rope: c(0xc9a86a), door: c(0x3a2a20), thatch: c(0xbca06b), thatchDark: c(0x94794d), turquoise: c(0x227f80), teal: c(0x2f8f86),
  water: c(0x2f8a92), waterLight: c(0x8fcfdc), ember: c(0xf99026), coal: c(0x502619), char: c(0x2a1c14), grey: c(0x8d877c),
  leaf: c(0x3f8a34), leafDark: c(0x2f7a2e), leafLight: c(0x5ea43c), soil: c(0x4a3624),
};
const CUT = { stone: c(0xdcb27a), stoneLight: c(0xe9c993), stoneDark: c(0xbf9864), mortar: c(0x9a7448) };
const SAND = { sand: c(0xdcb57c), sandDark: c(0xc39a62), plaster: c(0xf0d6a6), adobe: c(0xcdb18a), adobeLight: c(0xe3ccb0) };
/** Bright festival colours: the coloured powders, garlands and pennants. */
const BRIGHT = [c(0xd8322a), c(0xf2c53a), c(0x3fae4a), c(0x2f6fd0), c(0x8a4fc0), c(0xef7a22)];

/** A transform at angle `a` round the middle, `r` out: local z points outward, local x along the ring. */
const onRing = (a: number, r: number, y: number) => M.t(Math.cos(a) * r, y, Math.sin(a) * r, 0, Math.PI / 2 - a, 0);
/** `m` followed by a local offset. */
const at = (m: THREE.Matrix4, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => m.clone().multiply(M.t(x, y, z, rx, ry, rz, sx, sy, sz));

// ---------------- Shared props ----------------

/** A log lying along local x (bark round the sides, pale cut ends). */
function log(b: GeoBuilder, m: THREE.Matrix4, len: number, r: number): void {
  const axis = new THREE.Vector3(1, 0, 0).transformDirection(m);
  b.add(P.cyl(r, r * 1.05, len, 8), { color: (_p, n) => (Math.abs(n.dot(axis)) > 0.9 ? K.wood : K.bark).clone() }, at(m, 0, 0, 0, 0, 0, Math.PI / 2));
}

/** A tree-stump stool. */
function stump(b: GeoBuilder, x: number, z: number, h: number, r: number, y = 0): void {
  b.add(P.cyl(r, r * 1.12, h, 8), { color: (_p, n) => (n.y > 0.9 ? K.wood : K.bark).clone() }, M.t(x, y + h / 2, z));
}

/** A painted clay pot (round body, neck and lip). */
function pot(b: GeoBuilder, x: number, y: number, z: number, s: number, body = 0xc4643a): void {
  b.add(P.uvSphere(0.1 * s, 8, 6), { color: (p) => (Math.abs(p.y - (y + 0.12 * s)) < 0.025 * s ? K.cream.clone() : c(body)) }, M.t(x, y + 0.12 * s, z, 0, 0, 0, 1, 1.2, 1));
  b.add(P.cyl(0.05 * s, 0.065 * s, 0.07 * s, 8), { color: c(body).multiplyScalar(0.85) }, M.t(x, y + 0.25 * s, z));
  b.add(P.cyl(0.066 * s, 0.066 * s, 0.015 * s, 8), { color: c(body).multiplyScalar(0.72) }, M.t(x, y + 0.29 * s, z));
}

/** A fire bowl on a short stand; returns where its flame burns. */
function fireBowl(b: GeoBuilder, x: number, y: number, z: number, s = 1): THREE.Vector3 {
  b.add(P.cyl(0.13 * s, 0.07 * s, 0.09 * s, 9), { color: c(0x8a7a68) }, M.t(x, y + 0.045 * s, z));
  b.add(P.cyl(0.115 * s, 0.115 * s, 0.01, 9), { color: c(0x3a2a20) }, M.t(x, y + 0.09 * s, z));
  return new THREE.Vector3(x, y + 0.13 * s, z);
}

/** A wooden bucket (hooped, water inside, a rope handle), standing on y. */
function bucket(b: GeoBuilder, x: number, y: number, z: number, s = 1, handle = true): void {
  const r = (f: number) => (0.056 + 0.014 * f) * s, h = 0.13 * s;
  b.add(P.cyl(r(1), r(0), h, 9, true), { color: K.timber }, M.t(x, y + h / 2, z));
  b.add(new THREE.CircleGeometry(r(0), 9).rotateX(-Math.PI / 2), { color: K.timberDark }, M.t(x, y + 0.004, z));
  b.add(new THREE.CircleGeometry(r(0.77), 9).rotateX(-Math.PI / 2), { color: K.water }, M.t(x, y + h * 0.77, z));
  for (const f of [0.2, 0.8]) b.add(P.cyl(r(f) + 0.012, r(f) + 0.012, 0.014 * s, 9, true), { color: K.timberDark }, M.t(x, y + h * f, z));
  if (handle) b.add(new THREE.TorusGeometry(r(1), 0.006, 3, 10, Math.PI), { color: K.rope }, M.t(x, y + h, z));
}

/** A low table along local x, `h` high, its top's centre returned. */
function table(b: GeoBuilder, m: THREE.Matrix4, len: number, dep: number, h: number, top = K.timber): THREE.Matrix4 {
  b.add(P.box(len, 0.04, dep), { color: top }, at(m, 0, h - 0.02, 0));
  for (const sx of [-1, 1]) b.add(P.box(0.05, h - 0.04, dep - 0.06), { color: K.timberDark }, at(m, sx * (len / 2 - 0.08), (h - 0.04) / 2, 0));
  return at(m, 0, h, 0);
}

/** A feast laid along a table top (`m` at the top's centre, local x along the table). */
function feast(b: GeoBuilder, m: THREE.Matrix4, len: number, seed: number): void {
  const rng = new RNG(seed);
  const n = Math.max(2, Math.round(len / 0.2));
  for (let k = 0; k < n; k++) {
    const x = -len / 2 + (len / n) * (k + 0.5), z = (k % 2 ? 1 : -1) * 0.03;
    const kind = k % 5;
    // A clay platter under each dish.
    b.add(P.cyl(0.085, 0.07, 0.025, 10), { color: K.terracotta }, at(m, x, 0.0125, z));
    const y = 0.025;
    if (kind === 0) {
      // A roast turkey, browned, with its legs up.
      b.add(P.sphere(0.06, 1), { color: c(0xb86a32) }, at(m, x, y + 0.04, z, 0, 0, 0, 1.25, 0.8, 1));
      for (const s of [-1, 1]) b.add(P.cyl(0.014, 0.02, 0.06, 5), { color: c(0x9a5028) }, at(m, x + 0.05, y + 0.06, z + s * 0.025, 0, 0, -0.9));
    } else if (kind === 1) {
      // Tamales in their husks.
      for (let j = 0; j < 4; j++) b.add(P.box(0.07, 0.025, 0.032), { color: j % 2 ? c(0xd8c08a) : c(0x9fb46a) }, at(m, x + rng.range(-0.02, 0.02), y + 0.0125 + (j > 2 ? 0.035 : 0), z - 0.04 + (j % 3) * 0.04, 0, rng.range(-0.1, 0.1), 0));
    } else if (kind === 2) {
      // A heap of fruit: papaya, mamey and limes.
      for (let j = 0; j < 5; j++) b.add(P.sphere(0.028, 0), { color: [c(0xef7a22), c(0xd8572a), c(0x8bbf3a), c(0xf2c53a)][j % 4] }, at(m, x + rng.range(-0.04, 0.04), y + 0.025 + (j === 4 ? 0.035 : 0), z + rng.range(-0.04, 0.04), rng.range(0, 6), rng.range(0, 6), 0));
    } else if (kind === 3) {
      // A stack of tortillas and a bowl of chillies.
      b.add(P.cyl(0.05, 0.05, 0.04, 10), { color: c(0xeed9a0) }, at(m, x - 0.02, y + 0.02, z));
      b.add(P.cyl(0.035, 0.025, 0.03, 8), { color: c(0x7a3420) }, at(m, x + 0.05, y + 0.015, z + 0.02));
      b.add(P.sphere(0.03, 0), { color: c(0xd8322a) }, at(m, x + 0.05, y + 0.03, z + 0.02, 0, 0, 0, 1, 0.5, 1));
    } else {
      // A jug of chocolate.
      b.add(P.cyl(0.03, 0.03, 0.06, 7), { color: c(0x8a4a2c) }, at(m, x, y + 0.03, z));
      b.add(P.uvSphere(0.045, 7, 5), { color: c(0x8a4a2c) }, at(m, x, y + 0.08, z, 0, 0, 0, 1, 1.15, 1));
      b.add(P.cyl(0.025, 0.03, 0.04, 7), { color: c(0x6e3a22) }, at(m, x, y + 0.14, z));
    }
  }
}

/** A basket heaped with maize cobs or fruit. */
function basket(b: GeoBuilder, x: number, y: number, z: number, r: number, fill: THREE.Color[], seed: number): void {
  const rng = new RNG(seed);
  b.add(P.cyl(r, r * 0.82, r * 1.1, 10), { color: (p) => ((p.y * 60) % 1 < 0.5 ? K.rope : c(0xae8a50)).clone() }, M.t(x, y + r * 0.55, z));
  b.add(P.sphere(r * 0.92, 0), { color: fill[0] }, M.t(x, y + r * 0.95, z, 0, 0, 0, 1, 0.45, 1));
  for (let k = 0; k < 5; k++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(0, r * 0.55);
    b.add(P.sphere(r * 0.26, 0), { color: fill[1 + (k % (fill.length - 1))] }, M.t(x + Math.cos(a) * d, y + r * 1.2, z + Math.sin(a) * d, rng.range(0, 6), rng.range(0, 6), 0));
  }
}

/** A string of marigold balls along a curve. */
function garland(b: GeoBuilder, from: THREE.Vector3, to: THREE.Vector3, sag: number, n: number): void {
  for (let k = 0; k <= n; k++) {
    const t = k / n, p = from.clone().lerp(to, t);
    p.y -= Math.sin(t * Math.PI) * sag;
    b.add(P.sphere(0.045, 0), { color: k % 3 === 1 ? c(0xf2c53a) : k % 3 ? c(0xd8322a) : c(0xef7a22) }, M.t(p.x, p.y, p.z));
  }
}

/** A bell hanging from (x, y, z), `s` times the Great Hall's. */
function bell(b: GeoBuilder, x: number, y: number, z: number, s: number): void {
  const pts = [[0.055, -0.08], [0.12, -0.1], [0.15, -0.2], [0.18, -0.38], [0.27, -0.52], [0.29, -0.55], [0.29, -0.59], [0.245, -0.59], [0.225, -0.53], [0.14, -0.36], [0.11, -0.19], [0.055, -0.15]].map(([px, py]) => new THREE.Vector2(px * s, py * s));
  b.add(new THREE.LatheGeometry(pts, 16), { color: c(0xb58a42) }, M.t(x, y, z));
  b.add(P.torus(0.255 * s, 0.018 * s, 4, 16), { color: K.gold }, M.t(x, y - 0.5 * s, z, Math.PI / 2));
  b.add(P.sphere(0.05 * s, 1), { color: c(0x65503a) }, M.t(x, y - 0.58 * s, z));
  b.add(P.cyl(0.016 * s, 0.016 * s, 0.48 * s, 5), { color: c(0x514535) }, M.t(x, y - 0.33 * s, z));
}

/** A painted, carved flame (for an eternal fire that burns day and night): tongues rising from y. */
function carvedFlame(b: GeoBuilder, x: number, y: number, z: number, s: number): void {
  const fire = (y0: number, h: number) => (p: THREE.Vector3) => c(0xd8432a).lerp(c(0xf2c53a), Math.min(1, Math.max(0, (p.y - y0) / h)));
  b.add(P.cone(0.09 * s, 0.34 * s, 7), { color: fire(y, 0.34 * s) }, M.t(x, y + 0.17 * s, z));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4, h = (k % 2 ? 0.2 : 0.24) * s;
    b.add(P.cone(0.05 * s, h, 6), { color: fire(y, h) }, M.t(x + Math.cos(a) * 0.06 * s, y + h / 2, z + Math.sin(a) * 0.06 * s, Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35));
  }
}

/** A string of pennants from `from` to `to`, sagging by `sag`, a coloured triangle hanging from each span. */
function pennants(b: GeoBuilder, from: THREE.Vector3, to: THREE.Vector3, sag: number, n: number, size: number): void {
  const pt = (t: number) => from.clone().lerp(to, t).setY(from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * sag);
  const ry = -Math.atan2(to.z - from.z, to.x - from.x);
  for (let k = 0; k < n; k++) {
    const a = pt(k / n), e = pt((k + 1) / n), mid = a.clone().add(e).multiplyScalar(0.5), dir = e.clone().sub(a);
    b.add(P.cyl(0.006, 0.006, dir.length(), 4), { color: K.rope }, M.t(mid.x, mid.y, mid.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()))));
    b.add(P.cone(size * 0.5, size, 3), { color: BRIGHT[k % BRIGHT.length] }, M.t(mid.x, mid.y - size / 2 - 0.006, mid.z, 0, ry, 0).multiply(M.t(0, 0, 0, Math.PI, 0, 0, 1, 1, 0.12)));
  }
}

/** A flowering tree: a timber trunk, round clumps of leaves and blossom. */
function floweringTree(b: GeoBuilder, x: number, y: number, z: number, s: number, seed: number, bloom: THREE.Color): void {
  const rng = new RNG(seed);
  b.add(P.cyl(0.045 * s, 0.075 * s, 0.75 * s, 6), { color: K.timberDark }, M.t(x, y + 0.375 * s, z));
  const greens = [K.leaf, K.leafDark, K.leafLight];
  const clumps: [number, number, number, number][] = [[0, 0.95, 0, 0.32], [0.2, 0.82, 0.12, 0.24], [-0.18, 0.85, -0.1, 0.25], [0.05, 1.12, -0.08, 0.22], [-0.1, 0.8, 0.18, 0.2]];
  clumps.forEach(([cx, cy, cz, r], k) => b.add(lumpy(P.sphere(r * s, 1), 0.25, seed + k, 0.85), { color: greens[k % 3], leaf: 1 }, M.t(x + cx * s, y + cy * s, z + cz * s)));
  for (let k = 0; k < 14; k++) {
    const a = rng.range(0, Math.PI * 2), e = rng.range(0.15, 1.2);
    b.add(new THREE.OctahedronGeometry(0.05 * s, 0), { color: k % 4 ? bloom : c(0xf2d04a), leaf: 1 }, M.t(x + Math.cos(a) * Math.cos(e) * 0.36 * s, y + (0.95 + Math.sin(e) * 0.3) * s, z + Math.sin(a) * Math.cos(e) * 0.36 * s));
  }
}

/** A cut-stone block (centred on x, z, standing on y) with mortar courses and a parapet round its flat roof. */
function stoneHouse(b: GeoBuilder, w: number, h: number, d: number, x: number, y: number, z: number): void {
  b.add(P.box(w, h, d), { color: (p) => CUT.stone.clone().lerp(CUT.stoneLight, Math.min(1, Math.max(0, (p.y - y) / h)) * 0.5) }, M.t(x, y + h / 2, z));
  for (const f of [0.3, 0.62]) b.add(P.box(w + 0.024, 0.014, d + 0.024), { color: CUT.mortar }, M.t(x, y + h * f, z));
  b.add(P.box(w + 0.05, 0.05, d + 0.05), { color: CUT.stoneLight }, M.t(x, y + h - 0.02, z));
  const t = 0.08, ph = 0.09;
  for (const s of [-1, 1]) {
    b.add(P.box(w + 0.02, ph, t), { color: CUT.stoneLight }, M.t(x, y + h + ph / 2, z + s * (d / 2 - t / 2 + 0.01)));
    b.add(P.box(t, ph, d - 2 * t + 0.04), { color: CUT.stoneLight }, M.t(x + s * (w / 2 - t / 2 + 0.01), y + h + ph / 2, z));
  }
  b.add(P.box(w - t * 2, 0.02, d - t * 2), { color: CUT.stoneDark }, M.t(x, y + h + 0.015, z));
}

/** A painted band with a running stepped fret, on a face (`m` at its centre, +z out of the face). */
function fretBand(b: GeoBuilder, m: THREE.Matrix4, len: number, h: number, base: THREE.Color, ink: THREE.Color): void {
  b.add(P.box(len, h, 0.012), { color: base }, m);
  const u = h * 1.7, n = Math.max(1, Math.floor(len / u)), s = h * 0.15, x0 = -(n * u) / 2;
  const q = (x: number, y: number, w: number, hh: number) => b.add(P.plane(w, hh), { color: ink }, at(m, x, y, 0.017));
  for (let k = 0; k < n; k++) {
    const x = x0 + k * u;
    q(x + s / 2 + u * 0.08, 0, s, h * 0.66);
    q(x + u * 0.38, h * 0.33 - s / 2, u * 0.6, s);
    q(x + u * 0.68 - s / 2, h * 0.15, s, h * 0.36);
    q(x + u * 0.49, -h * 0.33 + s / 2, u * 0.82, s);
  }
}

/** A gold sun disc with a turquoise eye and rays (facing +z of `m`). */
function sunDisc(b: GeoBuilder, m: THREE.Matrix4, r: number): void {
  b.add(P.cyl(r, r, 0.03, 16), { color: K.gold }, at(m, 0, 0, 0, Math.PI / 2));
  b.add(P.cyl(r * 0.55, r * 0.55, 0.03, 14), { color: K.turquoise }, at(m, 0, 0, 0.012, Math.PI / 2));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.add(P.cone(r * 0.2, r * 0.45, 4), { color: K.gold }, at(m, Math.cos(a) * r * 1.2, Math.sin(a) * r * 1.2, 0, 0, 0, a - Math.PI / 2));
  }
}

// ---------------- Tribal Fire (campfire: the bonfire's hearth at 0.72 × 0.85) ----------------

const campfire: Look[] = [
  // Stone hearth ring: dressed sandstone blocks round the fire, capped in pale stone.
  (b) => {
    const n = 14;
    for (let k = 0; k < n; k++) {
      const m = onRing(((k + 0.5) / n) * Math.PI * 2, 0.66, 0);
      b.add(P.box(0.2, 0.15, 0.13), { color: k % 2 ? CUT.stone : CUT.stoneDark }, at(m, 0, 0.075, 0));
      b.add(P.box(0.22, 0.03, 0.16), { color: CUT.stoneLight }, at(m, 0, 0.165, 0));
    }
  },
  // Storytelling circle: log benches either side, stump stools round the front and back, and the
  // storyteller's place on the left log with a jaguar pelt and a feathered staff.
  (b) => {
    for (const a of [0, Math.PI]) log(b, onRing(a, 0.84, 0.07), 0.46, 0.07);
    for (const deg of [60, 120, 240, 300]) {
      const a = (deg * Math.PI) / 180;
      stump(b, Math.cos(a) * 0.84, Math.sin(a) * 0.84, 0.16, 0.08);
    }
    const pelt = c(0xd9a441), spot = c(0x3a2a1c);
    b.add(P.box(0.16, 0.02, 0.3), { color: pelt }, M.t(-0.84, 0.145, 0));
    b.add(P.box(0.02, 0.1, 0.24), { color: pelt }, M.t(-0.765, 0.1, 0));
    for (const [sx, sz] of [[-0.03, -0.09], [0.04, -0.02], [-0.02, 0.05], [0.03, 0.11], [-0.05, 0.12]]) b.add(P.box(0.025, 0.012, 0.025), { color: spot }, M.t(-0.84 + sx, 0.162, sz, 0, sx * 20, 0));
    const staff = M.t(-0.9, 0.35, 0.13, 0.12, 0, -0.12);
    b.add(P.cyl(0.014, 0.018, 0.7, 5), { color: K.timberDark }, staff);
    for (let k = 0; k < 4; k++) b.add(P.box(0.03, 0.14, 0.008), { color: k % 2 ? c(0x1f8a5a) : K.red }, at(staff, 0, 0.34, -Math.abs(k - 1.5) * 0.012, 0, 0, (k - 1.5) * 0.3).multiply(M.t(0, 0.07, 0)));
  },
  // Eternal flame: a carved column at the back, its bowl holding a painted stone flame that never
  // goes out, a gold sun turned toward the fire.
  (b) => {
    const x = 0, z = -0.83;
    b.add(P.box(0.26, 0.08, 0.26), { color: CUT.stoneDark }, M.t(x, 0.04, z));
    b.add(P.cyl(0.085, 0.1, 0.5, 8), { color: CUT.stone }, M.t(x, 0.33, z));
    b.add(P.cyl(0.105, 0.105, 0.06, 8), { color: K.red }, M.t(x, 0.46, z));
    b.add(P.cyl(0.108, 0.108, 0.02, 8), { color: K.gold }, M.t(x, 0.5, z));
    b.add(P.cyl(0.16, 0.09, 0.1, 10), { color: c(0x8a7a68) }, M.t(x, 0.63, z));
    b.add(P.cyl(0.145, 0.145, 0.012, 10), { color: K.coal }, M.t(x, 0.677, z));
    carvedFlame(b, x, 0.68, z, 1);
    sunDisc(b, M.t(x, 0.3, z + 0.11), 0.055);
  },
];

// ---------------- Communal Bonfire ----------------

const bonfire: Look[] = [
  // Wider ring: a paved ring of sandstone slabs round the hearth, and standing stones out by the edge.
  (b) => {
    const n = 24;
    for (let k = 0; k < n; k++) b.add(P.box(0.2, 0.04, 0.2), { color: [CUT.stone, CUT.stoneDark, c(0xcfa874)][k % 3] }, onRing(((k + 0.5) / n) * Math.PI * 2, 0.97, 0.025));
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      b.add(lumpy(P.sphere(0.09, 1), 0.2, 700 + k, 1), { color: k % 2 ? c(0x9c9184) : c(0xb3a58e) }, M.t(Math.cos(a) * 1.36, 0.16, Math.sin(a) * 1.36, 0, a, 0, 0.9, 1.5, 0.8));
    }
  },
  // Drums and dancers: two tall drums with skin heads either side, a slit log drum on its stand at
  // the back, gourd rattles and the drummers' stools.
  (b) => {
    for (const s of [-1, 1]) {
      const x = s * 1.1;
      b.add(new THREE.CylinderGeometry(0.14, 0.12, 0.42, 12, 12), { color: (p) => (Math.abs(p.y - 0.3) < 0.04 ? K.red : Math.abs(p.y - 0.18) < 0.02 ? K.gold : K.timber).clone(), facet: true }, M.t(x, 0.045 + 0.21 + 0.06, 0));
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        b.add(P.box(0.05, 0.08, 0.05), { color: K.timberDark }, M.t(x + Math.cos(a) * 0.09, 0.085, Math.sin(a) * 0.09));
      }
      b.add(P.cyl(0.145, 0.145, 0.02, 12), { color: c(0xe8d6b0) }, M.t(x, 0.535, 0));
      b.add(P.cyl(0.15, 0.15, 0.03, 12), { color: K.redDeep }, M.t(x, 0.5, 0));
      stump(b, x, 0.3, 0.14, 0.07, 0.045);
    }
    // The teponaztli: a hollow log drum, H-slit on top, carved ends, on two trestles.
    const m = onRing(-Math.PI / 2, 1.13, 0);
    for (const sx of [-1, 1]) b.add(P.box(0.05, 0.16, 0.2), { color: K.timberDark }, at(m, sx * 0.18, 0.125, 0));
    log(b, at(m, 0, 0.27, 0), 0.52, 0.085);
    for (const sz of [-1, 1]) b.add(P.box(0.18, 0.012, 0.012), { color: K.char }, at(m, 0, 0.355, sz * 0.04));
    b.add(P.box(0.012, 0.012, 0.08), { color: K.char }, at(m, 0, 0.355, 0));
    for (const sx of [-1, 1]) b.add(P.cyl(0.1, 0.1, 0.04, 8), { color: K.red }, at(m, sx * 0.2, 0.27, 0, 0, 0, Math.PI / 2));
    // Gourd rattles beside the big drums.
    for (const s of [-1, 1]) {
      b.add(P.sphere(0.045, 1), { color: c(0xc9a050) }, M.t(s * 1.12, 0.09, -0.3, 0, 0, 0, 1, 1.2, 1));
      b.add(P.cyl(0.01, 0.012, 0.14, 4), { color: K.timberDark }, M.t(s * 1.12 + 0.06, 0.06, -0.28, 0, 0, Math.PI / 2 - 0.2));
    }
  },
  // Feast nights: a low table spread with food at the front, baskets of maize and fruit beside it.
  (b) => {
    const top = table(b, onRing(Math.PI / 2, 1.1, 0.045), 0.9, 0.26, 0.26);
    feast(b, top, 0.8, 31);
    basket(b, Math.cos(1.08) * 1.12, 0.045, Math.sin(1.08) * 1.12, 0.1, [c(0xe8a526), c(0xf2c53a), c(0xe8a526)], 41);
    basket(b, Math.cos(Math.PI - 1.08) * 1.12, 0.045, Math.sin(Math.PI - 1.08) * 1.12, 0.1, [c(0xd8572a), c(0xef7a22), c(0x8bbf3a)], 42);
  },
];

// ---------------- Cooking Firepit ----------------

const firepit: Look[] = [
  // Clay oven: a domed oven behind the pit, its glowing mouth toward the fire and a little flue.
  (b, _w, _d, torches) => {
    const x = 0, z = -0.76;
    b.add(P.cyl(0.225, 0.235, 0.06, 14), { color: CUT.stoneDark }, M.t(x, 0.03, z));
    b.add(new THREE.SphereGeometry(0.22, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), { color: (p) => K.clay.clone().lerp(c(0xd29a68), Math.min(1, Math.max(0, (p.y - 0.06) / 0.24)) * 0.6) }, M.t(x, 0.06, z, 0, 0, 0, 1, 1.1, 1));
    b.add(P.box(0.13, 0.12, 0.05), { color: K.char }, M.t(x, 0.13, z + 0.205));
    b.add(P.box(0.19, 0.035, 0.07), { color: K.terracotta }, M.t(x, 0.215, z + 0.2));
    b.add(P.cyl(0.04, 0.05, 0.08, 8), { color: K.terracotta }, M.t(x, 0.32, z - 0.04));
    b.add(P.cyl(0.03, 0.03, 0.01, 8), { color: K.char }, M.t(x, 0.37, z - 0.04));
    for (let k = 0; k < 3; k++) log(b, M.t(0.4 + (k === 2 ? 0.03 : k * 0.062), 0.03 + (k === 2 ? 0.052 : 0), -0.71, 0, Math.PI / 2, 0), 0.28, 0.03);
    torches.push(new THREE.Vector3(x, 0.1, z + 0.17));
  },
  // Dance ring: a trodden ring of pale earth round the pit, edged with red and cream stones, and two
  // feathered dance staffs.
  (b) => {
    b.add(new THREE.RingGeometry(0.82, 0.98, 32, 1), { color: c(0xb89c74) }, M.t(0, 0.016, 0, -Math.PI / 2));
    const clear = [[-0.75, 0.6, 0.22], [0.8, 0.6, 0.2], [0, -0.8, 0.32], [0.3, -0.8, 0.22]];
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2, x = Math.cos(a) * 1.0, z = Math.sin(a) * 1.0;
      if (clear.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r)) continue;
      b.add(lumpy(P.sphere(0.055, 0), 0.2, 800 + k, 0.6), { color: k % 2 ? K.red : K.cream }, M.t(x * 0.92, 0.03, z * 0.92));
    }
    for (const deg of [225, 315]) {
      const a = (deg * Math.PI) / 180, x = Math.cos(a) * 0.92, z = Math.sin(a) * 0.92;
      b.add(P.cyl(0.018, 0.024, 1.1, 5), { color: K.timberDark }, M.t(x, 0.55, z));
      b.add(P.cyl(0.026, 0.026, 0.06, 6), { color: K.red }, M.t(x, 0.9, z));
      for (let j = 0; j < 5; j++) b.add(P.box(0.035, 0.22, 0.008), { color: j % 2 ? c(0x1f8a5a) : c(0x3fb36e) }, M.t(x, 1.15, z, 0, a, 0).multiply(M.t(0, 0, -Math.abs(j - 2) * 0.014, 0, 0, (j - 2) * 0.28)).multiply(M.t(0, 0.08, 0)));
      for (let j = 0; j < 3; j++) b.add(P.box(0.03, 0.3, 0.006), { color: BRIGHT[j * 2] }, M.t(x + 0.025, 0.74, z, 0, a + j * 0.9, 0.12));
    }
  },
  // Long table: a long low table before the pit set with roast meat, tortillas, chillies and chocolate.
  (b) => {
    const top = table(b, M.t(0, 0, 0.8), 1.0, 0.24, 0.3);
    feast(b, top, 0.9, 52);
  },
];

// ---------------- Village Well (hollow shaft, timber frame and little roof) ----------------

const well: Look[] = [
  // Stone lining: dressed courses lining the shaft inside, and a stepped stone plinth round its foot.
  (b) => {
    const lining = (p: THREE.Vector3) => ((Math.floor((p.y - 0.12) / 0.06) + Math.floor(((Math.atan2(p.z, p.x) + Math.PI) / (Math.PI * 2)) * 16)) % 2 ? CUT.stoneLight : CUT.stone).clone().multiplyScalar(0.55 + 0.45 * Math.min(1, Math.max(0, (p.y - 0.12) / 0.36)));
    b.add(new THREE.CylinderGeometry(0.345, 0.345, 0.36, 16, 6, true), { color: lining, facet: true }, M.t(0, 0.3, 0, 0, 0, 0, -1, 1, 1));
    const block = (p: THREE.Vector3) => (Math.floor(((Math.atan2(p.z, p.x) + Math.PI) / (Math.PI * 2)) * 18) % 2 ? CUT.stone : CUT.stoneDark).clone();
    b.add(P.cyl(0.6, 0.62, 0.16, 18, true), { color: block, facet: true }, M.t(0, 0.08, 0));
    b.add(new THREE.RingGeometry(0.47, 0.6, 18, 1), { color: CUT.stoneLight }, M.t(0, 0.16, 0, -Math.PI / 2));
  },
  // Bucket chain: a chain of buckets on a second rope down into the shaft, and a rack of fire buckets.
  (b) => {
    b.add(P.cyl(0.008, 0.008, 0.66, 3), { color: K.rope }, M.t(0.07, 0.79, 0));
    for (const y of [0.52, 0.72, 0.92]) bucket(b, 0.07, y, 0, 0.75);
    const x0 = 0.12, x1 = 0.62, z = -0.74;
    for (const x of [x0, x1]) b.add(P.box(0.05, 0.64, 0.05), { color: K.timber }, M.t(x, 0.32, z));
    b.add(P.box(x1 - x0 + 0.12, 0.05, 0.07), { color: K.timberDark }, M.t((x0 + x1) / 2, 0.64, z));
    for (let k = 0; k < 3; k++) {
      const x = x0 + 0.1 + k * 0.15;
      b.add(P.cyl(0.005, 0.005, 0.12, 3), { color: K.rope }, M.t(x, 0.56, z));
      bucket(b, x, 0.38, z, 0.85);
    }
    bucket(b, 0.3, 0.05, -0.6, 0.85);
  },
  // Fountain: a round stone basin before the well with a carved bowl spilling water, fed from the
  // well by a stone channel, and flowers round it.
  (b) => {
    const x = 0.1, z = 0.77, r = 0.2;
    b.add(P.cyl(r, r + 0.01, 0.2, 16, true), { color: CUT.stone }, M.t(x, 0.1, z));
    b.add(P.cyl(r - 0.035, r - 0.035, 0.18, 16, true), { color: CUT.stoneDark }, M.t(x, 0.11, z, 0, 0, 0, -1, 1, 1));
    b.add(new THREE.RingGeometry(r - 0.035, r + 0.005, 16, 1), { color: CUT.stoneLight }, M.t(x, 0.2, z, -Math.PI / 2));
    b.add(P.cyl(r - 0.03, r - 0.03, 0.01, 16), { color: K.water }, M.t(x, 0.17, z));
    b.add(P.cyl(0.035, 0.05, 0.3, 8), { color: CUT.stoneLight }, M.t(x, 0.32, z));
    b.add(P.cyl(0.1, 0.05, 0.05, 12, true), { color: CUT.stone }, M.t(x, 0.49, z));
    b.add(new THREE.CircleGeometry(0.095, 12).rotateX(-Math.PI / 2), { color: K.water }, M.t(x, 0.505, z));
    // The jet and the water falling from the bowl's lip into the basin.
    b.add(P.cyl(0.012, 0.02, 0.16, 6), { color: K.waterLight }, M.t(x, 0.595, z));
    b.add(P.sphere(0.03, 1), { color: K.waterLight }, M.t(x, 0.67, z, 0, 0, 0, 1, 0.7, 1));
    b.add(P.cyl(0.1, 0.13, 0.31, 12, true), { color: (p) => K.waterLight.clone().lerp(K.water, Math.min(1, Math.max(0, (0.5 - p.y) / 0.32))) }, M.t(x, 0.335, z));
    // The channel from the well's foot to the basin.
    const dx = x, dz = z, len = Math.hypot(dx, dz) - 0.62 - r + 0.04, a = Math.atan2(dx, dz), mid = 0.62 + len / 2 - 0.02;
    b.add(P.box(0.1, 0.06, len), { color: CUT.stoneDark }, M.t(Math.sin(a) * mid, 0.145, Math.cos(a) * mid, 0, a, 0));
    b.add(P.box(0.05, 0.01, len), { color: K.water }, M.t(Math.sin(a) * mid, 0.18, Math.cos(a) * mid, 0, a, 0));
    const rng = new RNG(911);
    for (let k = 0; k < 7; k++) {
      const t = (k / 7) * Math.PI * 1.2 + 0.2, px = x + Math.cos(t) * 0.27, pz = z - Math.sin(t) * 0.04 + Math.abs(Math.sin(t)) * 0.12;
      if (Math.hypot(px, pz) > 0.98) continue;
      b.add(P.cyl(0.006, 0.008, 0.12, 3), { color: c(0x3c7a2e) }, M.t(px, 0.06, pz));
      b.add(new THREE.OctahedronGeometry(0.035, 0), { color: rng.next() < 0.6 ? c(0xd8322a) : c(0xf2c53a), leaf: 1 }, M.t(px, 0.13, pz, 0, k, 0, 1, 0.6, 1));
    }
  },
];

// ---------------- Great Hall ----------------

const H = HALL.h;
const greathall: Look[] = [
  // More benches: along both sides of the platform, at the front of the terrace and beside the dais
  // (where the extra fifty crowd in), and round the back of the court.
  (b) => {
    const bench = (x: number, z: number, len: number, alongZ: boolean, y = H) => {
      const m = M.t(x, y, z, 0, alongZ ? Math.PI / 2 : 0, 0);
      b.add(P.box(len, 0.04, 0.15), { color: K.timber }, at(m, 0, 0.13, 0));
      for (const f of [-0.4, 0.4]) b.add(P.box(0.05, 0.11, 0.12), { color: K.timberDark }, at(m, f * len, 0.055, 0));
    };
    for (const s of [-1, 1]) {
      for (const z of [-0.95, 0.95]) bench(s * 2.62, z, 1.5, true);
      bench(s * 1.06, 2.47, 0.95, false);
      bench(s * 1.45, -2.27, 0.6, true);
      bench(s * 1.75, -3.22, 1.75, false, 0.09);
      bench(s * 3.22, -2.15, 1.3, true, 0.09);
    }
  },
  // Bell tower: a sandstone tower behind the dais, an open belfry with a great bronze bell, a tiled
  // pyramid roof with a gold finial.
  (b) => {
    const z = -2.99, w = 0.9, d = 0.82, top = 3.0;
    b.add(P.box(1.04, 0.14, 0.84), { color: K.grey }, M.t(0, 0.07, z + 0.02));
    b.add(P.box(w, top - 0.14, d), { color: (p) => SAND.sand.clone().lerp(CUT.stoneLight, Math.min(1, p.y / top) * 0.4) }, M.t(0, 0.14 + (top - 0.14) / 2, z));
    for (const y of [0.8, 1.45, 2.1]) b.add(P.box(w + 0.024, 0.016, d + 0.024), { color: CUT.mortar }, M.t(0, y, z));
    b.add(P.box(w + 0.03, 0.14, d + 0.03), { color: K.red }, M.t(0, 2.72, z));
    for (const y of [2.63, 2.81]) b.add(P.box(w + 0.05, 0.03, d + 0.05), { color: K.gold }, M.t(0, y, z));
    sunDisc(b, M.t(0, 2.25, z + d / 2 + 0.02), 0.17);
    b.add(P.box(w + 0.08, 0.06, d + 0.08), { color: SAND.sandDark }, M.t(0, top + 0.03, z));
    // The belfry: corner piers, a beam carrying the bell.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(P.box(0.16, 0.74, 0.16), { color: SAND.sand }, M.t(sx * 0.37, top + 0.06 + 0.37, z + sz * 0.33));
    b.add(P.box(0.9, 0.1, 0.12), { color: K.timberDark }, M.t(0, top + 0.72, z));
    bell(b, 0, top + 0.67, z, 0.85);
    // Roof: a cap slab and a four-sided terracotta pyramid with a gold finial.
    b.add(P.box(1.04, 0.08, 0.96), { color: SAND.sandDark }, M.t(0, top + 0.84, z));
    b.add(P.cone(0.7, 0.62, 4), { color: (p) => ((p.y * 10) % 1 < 0.5 ? K.terracotta : c(0x9a3a26)).clone() }, M.t(0, top + 0.88 + 0.31, z, 0, Math.PI / 4, 0, 1, 1, 0.92));
    b.add(P.sphere(0.07, 1), { color: K.gold }, M.t(0, top + 1.56, z));
  },
  // Feast hall: feast tables laden with food either side of the court, jars of chocolate, marigold
  // garlands under the front beam and round the corner pillars.
  (b) => {
    for (const s of [-1, 1]) {
      const top = table(b, M.t(s * 3.2, 0.09, 2.0, 0, Math.PI / 2, 0), 1.3, 0.32, 0.3);
      feast(b, top, 1.18, 60 + s);
      pot(b, s * 3.2, 0.09, 2.85, 1.1, 0xb85a36);
      // Swags under the front canopy beam, clear of the bell.
      const CH = H + 1.3;
      garland(b, new THREE.Vector3(s * 0.75, CH - 0.12, 1.99), new THREE.Vector3(s * 2.35, CH - 0.12, 1.99), 0.22, 16);
      // A ring of marigolds round each corner pillar.
      for (const sz of [-1, 1]) {
        const px = s * 2.3, pz = sz * 2.3, y = H + 0.14 + 1.45 * 0.62;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2, r = 0.33;
          b.add(P.sphere(0.06, 0), { color: k % 2 ? c(0xef7a22) : c(0xf2c53a) }, M.t(px + Math.cos(a) * r, y, pz + Math.sin(a) * r, 0, a, 0));
        }
      }
    }
  },
];

// ---------------- Tlatoani's Palace ----------------

const PF = PALACE.h, PC = PALACE.court, ROOF = PF + PALACE.wallH + 0.16;
const palace: Look[] = [
  // Royal garden: roof gardens on both side ranges, with flowering trees, beds and vines trailing
  // over the outer walls, and two flowering trees at the back of the plaza.
  (b) => {
    for (const s of [-1, 1]) {
      const x = s * 4.4, z0 = PC.z0, z1 = PC.z1 - 0.25, len = z1 - z0, zc = (z0 + z1) / 2;
      b.add(P.box(1.4, 0.22, len), { color: SAND.sand }, M.t(x, ROOF + 0.11, zc));
      b.add(P.box(1.43, 0.05, len + 0.03), { color: K.red }, M.t(x, ROOF + 0.245, zc));
      b.add(P.box(1.32, 0.02, len - 0.08), { color: K.soil }, M.t(x, ROOF + 0.282, zc));
      const y = ROOF + 0.29;
      [-1.6, 0, 1.6].forEach((dz, k) => floweringTree(b, x + s * 0.1, y, zc + dz, 1.15, 900 + k + s * 10, [c(0xe86aa8), c(0x9a6ad8), c(0xd8322a)][k]));
      for (let k = 0; k < 6; k++) {
        const z = z0 + 0.4 + k * ((len - 0.8) / 5);
        b.add(lumpy(P.sphere(0.16, 1), 0.25, 950 + k, 0.7), { color: k % 2 ? K.leafLight : K.leaf, leaf: 1 }, M.t(x - s * 0.45, y + 0.08, z));
        b.add(new THREE.OctahedronGeometry(0.05, 0), { color: k % 2 ? c(0xd8322a) : c(0xf2d04a), leaf: 1 }, M.t(x - s * 0.45, y + 0.22, z));
      }
      // Vines spilling over the outer wall.
      for (let k = 0; k < 7; k++) {
        const z = z0 + 0.3 + k * ((len - 0.6) / 6), h = 0.5 + ((k * 37) % 5) * 0.08;
        b.add(P.box(0.03, h, 0.16), { color: k % 2 ? K.leaf : K.leafDark, leaf: 1 }, M.t(s * (PALACE.topW / 2 + 0.045), ROOF - h / 2 + 0.08, z));
        b.add(new THREE.OctahedronGeometry(0.045, 0), { color: c(0xe86aa8), leaf: 1 }, M.t(s * (PALACE.topW / 2 + 0.065), ROOF - h * 0.6, z));
      }
      floweringTree(b, s * 6.3, 0.07, -5.95, 1.15, 980 + s, c(0xe86aa8));
    }
  },
  // Treasury: a sandstone strongroom on the plaza's east flank, its door banded in gold, chests of
  // gold, jade and pearls open on its roof.
  (b) => {
    const x = 6.42, z = -0.3, w = 0.94, d = 1.3, h = 1.35;
    stoneHouse(b, w, h, d, x, 0.06, z);
    fretBand(b, M.t(x, 0.06 + h * 0.8, z + d / 2 + 0.006), w - 0.06, 0.12, K.red, K.gold);
    const fz = z + d / 2;
    const dy = 0.1;
    b.add(P.box(0.4, 0.7, 0.03), { color: K.door }, M.t(x, dy + 0.35, fz + 0.005));
    b.add(P.box(0.34, 0.64, 0.03), { color: c(0x6b4a2c) }, M.t(x, dy + 0.34, fz + 0.02));
    for (const y of [0.15, 0.34, 0.53]) b.add(P.box(0.36, 0.035, 0.03), { color: K.gold }, M.t(x, dy + y, fz + 0.04));
    b.add(P.box(0.54, 0.07, 0.1), { color: CUT.stoneLight }, M.t(x, dy + 0.72, fz + 0.03));
    sunDisc(b, M.t(x, 0.06 + h * 0.8, fz + 0.03), 0.07);
    const ry = 0.06 + h + 0.025, rng = new RNG(1441);
    // Chests on the roof, lids thrown back.
    for (const [cx, cz, fill] of [[x - 0.18, z - 0.25, [K.gold, c(0xe0bc5a)]], [x + 0.16, z + 0.15, [K.jade, c(0x5aa08f)]]] as const) {
      b.add(P.box(0.3, 0.16, 0.22), { color: K.timber }, M.t(cx, ry + 0.08, cz));
      for (const f of [-0.1, 0.1]) b.add(P.box(0.024, 0.17, 0.23), { color: K.gold }, M.t(cx + f, ry + 0.08, cz));
      b.add(P.box(0.3, 0.025, 0.22), { color: K.timberDark }, M.t(cx, ry + 0.16, cz - 0.11, 1.3, 0, 0).multiply(M.t(0, 0.0125, -0.11)));
      for (let k = 0; k < 7; k++) b.add(P.sphere(0.045, 0), { color: fill[k % 2] }, M.t(cx + rng.range(-0.1, 0.1), ry + 0.165, cz + rng.range(-0.07, 0.07), rng.range(0, 6), rng.range(0, 6), 0));
    }
    basket(b, x - 0.15, ry, z + 0.3, 0.09, [c(0xf4eee0), c(0xfaf6ec), c(0xe8e2d4)], 1442);
  },
  // Second throne: a turquoise-backed throne on its own dais beside the first, and royal feather
  // standards before the throne-hall loggia.
  (b) => {
    const tz = PALACE.cz - PALACE.topD / 2 + 0.75, x = 2.0, y = PF;
    b.add(P.box(1.1, 0.12, 1.0), { color: SAND.sandDark }, M.t(x, y + 0.06, tz + 0.2));
    b.add(P.box(0.8, 0.1, 0.7), { color: SAND.sand }, M.t(x, y + 0.17, tz + 0.12));
    b.add(P.box(0.6, 0.26, 0.44), { color: K.timber }, M.t(x, y + 0.35, tz + 0.12));
    b.add(P.box(0.62, 0.03, 0.46), { color: c(0x3fb36e) }, M.t(x, y + 0.495, tz + 0.12));
    b.add(P.box(0.74, 0.95, 0.08), { color: K.gold }, M.t(x, y + 0.72, tz - 0.12));
    b.add(P.box(0.54, 0.72, 0.09), { color: K.turquoise }, M.t(x, y + 0.74, tz - 0.12));
    sunDisc(b, M.t(x, y + 0.88, tz - 0.06), 0.13);
    for (const s of [-1, 1]) {
      const sx = s * 1.2, sz = PC.z0 + 0.3;
      b.add(P.box(0.24, 0.1, 0.24), { color: SAND.sandDark }, M.t(sx, y + 0.05, sz));
      b.add(P.cyl(0.03, 0.035, 2.3, 6), { color: K.timberDark }, M.t(sx, y + 1.2, sz));
      b.add(P.box(0.34, 0.5, 0.02), { color: K.turquoise }, M.t(sx, y + 1.95, sz + 0.03));
      b.add(P.box(0.24, 0.3, 0.02), { color: K.gold }, M.t(sx, y + 1.97, sz + 0.045));
      b.add(P.box(0.4, 0.04, 0.04), { color: K.gold }, M.t(sx, y + 2.22, sz + 0.03));
      b.add(P.cyl(0.05, 0.07, 0.08, 8), { color: K.gold }, M.t(sx, y + 2.39, sz));
      for (let k = 0; k < 7; k++) {
        const a = (k - 3) * 0.28;
        b.add(P.box(0.06, 0.5, 0.015), { color: k % 2 ? c(0x3fb36e) : c(0x1f8a5a), leaf: 1 }, M.t(sx, y + 2.43, sz - Math.abs(k - 3) * 0.02, 0, 0, a).multiply(M.t(0, 0.25, 0)));
      }
    }
  },
];

// ---------------- Firemaker's Workshop ----------------

const KX = -0.92, KZ = -0.42;
const firemaker: Look[] = [
  // Bigger kiln: a second fretted stone stage on the kiln and a tall sooty chimney.
  (b) => {
    const y0 = 1.67, h = 0.51;
    b.add(P.box(1.0, h, 1.0), { color: (p) => CUT.stone.clone().lerp(CUT.stoneLight, Math.min(1, Math.max(0, (p.y - y0) / h)) * 0.5) }, M.t(KX, y0 + h / 2, KZ));
    b.add(P.box(1.024, 0.014, 1.024), { color: CUT.mortar }, M.t(KX, y0 + 0.16, KZ));
    for (let k = 0; k < 5; k++) b.add(P.box(1.03 / 5 - 0.012, 0.1, 1.03), { color: k % 2 ? K.cream : K.red }, M.t(KX - 0.515 + (k + 0.5) * (1.03 / 5), y0 + 0.36, KZ));
    fretBand(b, M.t(KX, y0 + 0.2, KZ + 0.506), 0.9, 0.1, K.red, K.cream);
    b.add(P.box(1.12, 0.1, 1.12), { color: CUT.stone }, M.t(KX, y0 + h + 0.05, KZ));
    const cx = KX + 0.12, cz = KZ - 0.12, ch = 0.8, cy = y0 + h + 0.1;
    b.add(P.box(0.38, ch, 0.38), { color: (_p, n) => (n.y > 0.5 ? K.char : CUT.stoneDark).clone() }, M.t(cx, cy + ch / 2, cz));
    b.add(P.box(0.44, 0.07, 0.44), { color: K.terracotta }, M.t(cx, cy + ch - 0.12, cz));
    b.add(P.box(0.43, 0.05, 0.43), { color: K.terracotta }, M.t(cx, cy + 0.3, cz));
    // A glowing vent on the new stage's front.
    b.add(P.box(0.26, 0.14, 0.02), { color: K.char }, M.t(KX, y0 + 0.06 + 0.07 + 0.0, KZ + 0.512));
    b.add(P.box(0.18, 0.04, 0.02), { color: K.ember }, M.t(KX, y0 + 0.1, KZ + 0.524));
  },
  // Rocket rack: an A-framed rack by the kiln mouth holding a row of striped rockets on their sticks.
  (b) => {
    const x = -0.2, z0 = 0.58, z1 = 1.12, y = 0.1;
    for (const z of [z0, z1]) {
      for (const s of [-1, 1]) b.add(P.box(0.03, 0.82, 0.03), { color: K.timber }, M.t(x + s * 0.06, y + 0.4, z, 0, 0, s * 0.16));
    }
    b.add(P.box(0.04, 0.04, z1 - z0 + 0.1), { color: K.timberDark }, M.t(x, y + 0.78, (z0 + z1) / 2));
    b.add(P.box(0.12, 0.03, z1 - z0), { color: K.timberDark }, M.t(x, y + 0.3, (z0 + z1) / 2));
    const stripe = [K.red, K.teal, c(0xf2c53a), K.red, K.teal, c(0x8a4fc0)];
    for (let k = 0; k < 6; k++) {
      const z = z0 + 0.07 + k * ((z1 - z0 - 0.14) / 5), rx = 0.075, h = 0.3;
      b.add(P.cyl(0.006, 0.006, 0.62, 3), { color: K.timberDark }, M.t(x + rx, y + 0.33, z));
      b.add(new THREE.CylinderGeometry(0.04, 0.04, h, 7, 6), { color: (p) => (Math.floor((p.y - y - 0.66) / (h / 6)) % 2 ? K.cream : stripe[k]).clone(), facet: true }, M.t(x + rx, y + 0.66 + h / 2, z));
      b.add(P.cone(0.05, 0.12, 7), { color: K.red }, M.t(x + rx, y + 0.66 + h + 0.06, z));
      b.add(P.box(0.1, 0.06, 0.01), { color: K.timberDark }, M.t(x + rx, y + 0.69, z));
    }
  },
  // Coloured powders: shelves on the kiln's side lined with bowls of red, yellow, green, blue and
  // purple powder, more bowls set out at the front, and pennants in the same colours strung from the
  // chimney to the banner pole.
  (b) => {
    const sx = -0.04, zc = -0.35;
    for (const y of [0.5, 0.76]) {
      b.add(P.box(0.16, 0.03, 1.0), { color: K.timber }, M.t(sx, y, zc));
      for (const f of [-0.4, 0.4]) b.add(P.box(0.03, 0.08, 0.04), { color: K.timberDark }, M.t(sx + 0.05, y - 0.055, zc + f));
      for (let k = 0; k < 5; k++) {
        const z = zc - 0.4 + k * 0.2, col = BRIGHT[(k + (y > 0.6 ? 2 : 0)) % BRIGHT.length];
        b.add(P.cyl(0.06, 0.04, 0.05, 9), { color: K.terracotta }, M.t(sx, y + 0.04, z));
        b.add(P.sphere(0.055, 1), { color: col }, M.t(sx, y + 0.065, z, 0, 0, 0, 1, 0.5, 1));
      }
    }
    pennants(b, new THREE.Vector3(KX + 0.32, 2.55, KZ - 0.12), new THREE.Vector3(1.72, 1.68, -1.25), 0.1, 10, 0.15);
    // Bowls of powder set out in a row at the front, ready for mixing.
    for (let k = 0; k < 5; k++) {
      const x = 0.25 + k * 0.18;
      b.add(P.cyl(0.08, 0.06, 0.1, 10), { color: c(0x9c4a2c) }, M.t(x, 0.17, 1.26));
      b.add(P.sphere(0.078, 1), { color: BRIGHT[(k * 2 + 1) % BRIGHT.length] }, M.t(x, 0.22, 1.26, 0, k, 0, 1, 0.5, 1));
    }
  },
];

// ---------------- Market Square ----------------

const MH = 0.14;
/** A small stall (posts, striped sloping canopy, a counter of goods), facing +z of `m`. */
function smallStall(b: GeoBuilder, m: THREE.Matrix4, cloth: THREE.Color, stripe: THREE.Color, goods: THREE.Color[], seed: number): void {
  const rng = new RNG(seed);
  const W = 0.6, D = 0.42, hf = 0.78, hb = 0.9;
  for (const [x, z, h] of [[-W / 2, D / 2, hf], [W / 2, D / 2, hf], [-W / 2, -D / 2, hb], [W / 2, -D / 2, hb]] as const) b.add(P.cyl(0.024, 0.028, h, 6), { color: K.timberDark }, at(m, x, h / 2, z));
  const tilt = Math.atan2(hb - hf, D), len = Math.hypot(D, hb - hf) + 0.14;
  const roof = at(m, 0, (hf + hb) / 2 + 0.015, 0, tilt, 0, 0);
  for (let k = 0; k < 3; k++) b.add(P.box(W + 0.12, 0.022, len / 3 + 0.001), { color: k === 1 ? stripe : cloth, leaf: 0.15 }, at(roof, 0, 0, -len / 2 + (k + 0.5) * (len / 3)));
  b.add(P.box(W + 0.12, 0.07, 0.016), { color: stripe }, at(m, 0, hf - 0.05, D / 2 + 0.07));
  b.add(P.box(W - 0.06, 0.04, 0.26), { color: K.timber }, at(m, 0, 0.3, 0.02));
  for (const x of [-W / 2 + 0.07, W / 2 - 0.07]) b.add(P.box(0.04, 0.28, 0.22), { color: K.timberDark }, at(m, x, 0.14, 0.02));
  for (let k = 0; k < 7; k++) b.add(P.sphere(0.035, 0), { color: goods[k % goods.length] }, at(m, -0.2 + (k % 4) * 0.13 + rng.range(-0.02, 0.02), 0.345 + (k > 3 ? 0.03 : 0), 0.02 + (k > 3 ? 0.04 : -0.04)));
  b.add(P.cyl(0.07, 0.06, 0.1, 8), { color: K.rope }, at(m, W / 2 - 0.05, 0.05, D / 2 + 0.06));
}

const market: Look[] = [
  // More stalls: two small stalls flanking the way in, a third by the back stalls.
  (b) => {
    smallStall(b, M.t(0.95, MH, 1.62, 0, -Math.PI / 2, 0), c(0xe9d8b4), c(0x237a74), [c(0x8a4a2c), c(0x6e3a22), c(0xd8322a)], 61);
    smallStall(b, M.t(-0.95, MH, 1.62, 0, Math.PI / 2, 0), c(0xd7a53e), c(0xb2412f), [c(0xd8322a), c(0x3fae4a), c(0xef7a22)], 62);
    smallStall(b, M.t(0.85, MH, -0.8), c(0x3f6f9a), c(0xe9d8b4), [c(0xf2c53a), c(0xe8a526), c(0x9fc94a)], 63);
  },
  // Canoe landing: a trader's dugout up on trestles with its cargo, paddles leaning on its side.
  (b) => {
    const m = M.t(-0.98, MH, 0.35, 0, Math.PI / 2, 0), len = 1.2, y = 0.28;
    for (const s of [-1, 1]) {
      b.add(P.box(0.06, 0.05, 0.42), { color: K.timberDark }, at(m, s * len * 0.28, y - 0.03, 0));
      for (const t of [-1, 1]) b.add(P.box(0.04, y, 0.04), { color: K.timberDark }, at(m, s * len * 0.28, y / 2, t * 0.17, t * 0.25, 0, 0));
    }
    const hull = new THREE.CylinderGeometry(0.16, 0.16, len, 10, 1, true, Math.PI, Math.PI);
    b.add(hull, { color: (p) => (p.y < MH + y + 0.05 ? c(0x5e3b22) : c(0x8a5e3a)) }, at(m, 0, y + 0.15, 0, 0, 0, Math.PI / 2, 1, 1, 0.9));
    b.add(hull, { color: c(0x6b4a2c) }, at(m, 0, y + 0.15, 0, 0, 0, Math.PI / 2, 0.9, -1, 0.8));
    for (const s of [-0.3, 0.3]) b.add(P.box(0.04, 0.025, 0.27), { color: K.timber }, at(m, s, y + 0.12, 0));
    for (const s of [-1, 1]) b.add(P.box(len * 0.98, 0.03, 0.04), { color: K.red }, at(m, 0, y + 0.15, s * 0.145));
    for (const s of [-1, 1]) b.add(P.cone(0.13, 0.2, 6), { color: c(0x7a5233) }, at(m, s * (len / 2 + 0.08), y + 0.1, 0, 0, 0, -s * Math.PI / 2, 1, 1, 0.9));
    // Cargo: a bale of cloth, a jar and a sack of cacao.
    b.add(P.box(0.22, 0.12, 0.18), { color: c(0xe9d8b4) }, at(m, -0.25, y + 0.1, 0, 0, 0.2, 0));
    b.add(P.box(0.23, 0.03, 0.19), { color: K.red }, at(m, -0.25, y + 0.1, 0, 0, 0.2, 0));
    b.add(lumpy(P.sphere(0.1, 1), 0.2, 71, 0.8), { color: c(0x8a5a3a) }, at(m, 0.22, y + 0.1, 0));
    // Paddles leaning against the hull.
    for (const s of [-0.3, 0.1]) {
      b.add(P.cyl(0.012, 0.012, 0.62, 4), { color: K.timber }, at(m, s, 0.31, 0.27, -0.35, 0, 0));
      b.add(P.box(0.09, 0.2, 0.015), { color: K.timberDark }, at(m, s, 0.08, 0.36, -0.35, 0, 0));
    }
  },
  // Haggling: a striped rug laid out with a trader's table on it, a tall balance scale weighing cacao
  // against jade, sacks of beans, bolts of cotton and mats for buyer and seller.
  (b) => {
    const m = M.t(0.97, MH, 0.35, 0, Math.PI / 2, 0);
    const rug = [c(0xb2412f), c(0xd7a53e), c(0x3f6f9a), c(0xe9d8b4)];
    for (let k = 0; k < 6; k++) b.add(P.box(0.18, 0.012, 0.44), { color: rug[k % 4] }, at(m, -0.45 + k * 0.18, 0.03, 0.04));
    const top = table(b, m, 0.52, 0.3, 0.24);
    b.add(P.box(0.08, 0.04, 0.08), { color: K.timberDark }, at(top, 0, 0.02, 0));
    b.add(P.cyl(0.014, 0.018, 0.52, 5), { color: K.timberDark }, at(top, 0, 0.26, 0));
    b.add(P.box(0.52, 0.025, 0.025), { color: K.gold }, at(top, 0, 0.52, 0));
    b.add(P.cone(0.025, 0.06, 4), { color: K.gold }, at(top, 0, 0.56, 0));
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        b.add(P.cyl(0.003, 0.003, 0.22, 3), { color: K.rope }, at(top, s * 0.24 + Math.cos(a) * 0.045, 0.41, Math.sin(a) * 0.045));
      }
      b.add(P.cyl(0.09, 0.055, 0.03, 10), { color: K.gold }, at(top, s * 0.24, 0.3, 0));
      for (let k = 0; k < 6; k++) b.add(P.sphere(0.024, 0), { color: s < 0 ? c(0x5a3420) : K.jade }, at(top, s * 0.24 + ((k % 3) - 1) * 0.03, 0.33 + (k > 2 ? 0.02 : 0), (k % 2 ? 1 : -1) * 0.02, k, k * 2, 0));
    }
    for (const s of [-1, 1]) b.add(P.box(0.24, 0.02, 0.2), { color: s < 0 ? K.red : c(0x237a74) }, at(m, s * 0.42, 0.05, 0));
    for (const [x, z, col] of [[0.18, 0.2, c(0x8a5a3a)], [0.0, 0.24, c(0x9c6a42)]] as const) b.add(lumpy(P.sphere(0.08, 1), 0.2, Math.round(x * 100 + 5), 0.8), { color: col }, at(m, x, 0.08, z));
    for (let k = 0; k < 3; k++) b.add(P.cyl(0.04, 0.04, 0.26, 8), { color: [c(0xf3e3c6), c(0x3f6f9a), c(0xb2412f)][k] }, at(m, -0.18, 0.08 + k * 0.075, 0.22, 0, 0, Math.PI / 2));
  },
];

// ---------------- Trade Dock (land at y = 0; the pier runs out along +z) ----------------

const tradedock: Look[] = [
  // Second berth: a timber wharf on piles beside the pier, at land level, with bollards, rope coils
  // and a ladder down to the water.
  (b) => {
    const x = -0.62, w = 0.6, z0 = 0.96, n = 13, z1 = z0 + n * 0.26;
    for (let k = 0; k < n; k++) b.add(P.box(w, 0.05, 0.22), { color: k % 2 ? c(0xa8784a) : c(0x94663c) }, M.t(x, 0.04, z0 + k * 0.26 + 0.12));
    for (const sx of [-1, 1]) b.add(P.box(0.06, 0.06, z1 - z0), { color: K.timberDark }, M.t(x + sx * (w / 2 - 0.03), -0.02, (z0 + z1) / 2));
    for (let z = z0 + 0.25; z <= z1; z += 1.05) for (const sx of [-1, 1]) b.add(P.cyl(0.05, 0.05, 3.0, 6), { color: K.timberDark }, M.t(x + sx * (w / 2 - 0.02), -1.45, Math.min(z, z1 - 0.06)));
    for (const sx of [-1, 1]) {
      b.add(P.cyl(0.055, 0.065, 0.3, 7), { color: K.timberDark }, M.t(x + sx * 0.2, 0.065 + 0.15, z1 - 0.18));
      b.add(P.torus(0.07, 0.02, 4, 10), { color: K.rope }, M.t(x + sx * 0.2, 0.3, z1 - 0.18, Math.PI / 2));
      b.add(P.cyl(0.065, 0.065, 0.02, 8), { color: K.red }, M.t(x + sx * 0.2, 0.375, z1 - 0.18));
    }
    b.add(P.torus(0.1, 0.03, 5, 12), { color: K.rope }, M.t(x - 0.12, 0.08, z1 - 0.9, Math.PI / 2));
    for (const sx of [-1, 1]) b.add(P.box(0.03, 1.0, 0.03), { color: K.timber }, M.t(x + sx * 0.1, -0.45, z1 + 0.02));
    for (let k = 0; k < 6; k++) b.add(P.box(0.17, 0.02, 0.018), { color: K.timberDark }, M.t(x, -0.85 + k * 0.16, z1 + 0.02));
  },
  // Warehouse: a thatched adobe storehouse behind the awning, with a wide timber-framed doorway.
  (b) => {
    const x = 0.62, z = -0.47, w = 0.58, d = 0.86, h = 0.72;
    b.add(P.box(w + 0.03, 0.12, d + 0.03), { color: c(0x9d7860) }, M.t(x, 0.06, z));
    b.add(P.box(w, h, d), { color: (p) => SAND.adobe.clone().lerp(SAND.adobeLight, Math.min(1, Math.max(0, p.y / h)) * 0.55) }, M.t(x, h / 2, z));
    b.add(P.box(w + 0.024, 0.05, d + 0.024), { color: c(0xa74a39) }, M.t(x, h - 0.12, z));
    // Gable ends under a thatched roof along z.
    const gable = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, 0.34)]);
    b.add(new THREE.ExtrudeGeometry(gable, { depth: d, bevelEnabled: false }), { color: SAND.adobeLight }, M.t(x, h, z - d / 2));
    const slope = Math.atan2(0.34, w / 2), rl = Math.hypot(0.34, w / 2) + 0.08;
    for (const s of [-1, 1]) {
      b.add(P.box(rl, 0.06, d + 0.11 + s * 0.01), { color: (p) => ((p.y * 9) % 1 < 0.35 ? K.thatchDark : K.thatch).clone() }, M.t(x + s * (w / 4 + 0.02), h + 0.2, z, 0, 0, -s * slope));
    }
    b.add(P.cyl(0.04, 0.04, d + 0.14, 6), { color: K.thatchDark }, M.t(x, h + 0.39, z, Math.PI / 2));
    // The wide doorway on the front, under the awning.
    const fz = z + d / 2;
    b.add(P.box(0.3, 0.42, 0.03), { color: K.door }, M.t(x, 0.33, fz + 0.005));
    b.add(P.box(0.42, 0.06, 0.08), { color: K.timberDark }, M.t(x, 0.57, fz + 0.02));
    for (const s of [-1, 1]) b.add(P.box(0.05, 0.46, 0.05), { color: K.timber }, M.t(x + s * 0.175, 0.35, fz + 0.02));
  },
  // Beacon fire: a tall stone beacon at the land end of the berth with a fire basket at its top.
  (b, _w, _d, torches) => {
    const x = -0.8, z = 0.66, hh = 1.6;
    b.add(P.box(0.4, 0.1, 0.4), { color: CUT.stoneDark }, M.t(x, 0.05, z));
    const shaft = new THREE.CylinderGeometry(0.12 * Math.SQRT2, 0.16 * Math.SQRT2, hh, 4, 8).rotateY(Math.PI / 4);
    b.add(shaft, { color: (p) => (Math.floor((p.y - 0.1) / 0.2) % 2 ? CUT.stone : CUT.stoneLight).clone(), facet: true }, M.t(x, 0.1 + hh / 2, z));
    b.add(P.box(0.29, 0.08, 0.29), { color: K.red }, M.t(x, 0.1 + hh - 0.25, z));
    b.add(P.box(0.32, 0.06, 0.32), { color: CUT.stoneLight }, M.t(x, 0.1 + hh + 0.03, z));
    b.add(P.cyl(0.2, 0.12, 0.16, 10, true), { color: c(0x7d746c) }, M.t(x, 0.1 + hh + 0.14, z));
    b.add(new THREE.CircleGeometry(0.19, 10).rotateX(-Math.PI / 2), { color: c(0xa16c3e) }, M.t(x, 0.1 + hh + 0.2, z));
    for (let k = 0; k < 4; k++) b.add(P.cyl(0.02, 0.025, 0.24, 5), { color: K.timberDark }, M.t(x + Math.cos(k * 1.6) * 0.06, 0.1 + hh + 0.26, z + Math.sin(k * 1.6) * 0.06, Math.sin(k * 1.6) * 0.6, 0, -Math.cos(k * 1.6) * 0.6));
    torches.push(new THREE.Vector3(x, 0.1 + hh + 0.27, z));
    // Firewood stacked at its foot.
    for (let k = 0; k < 3; k++) b.add(P.cyl(0.035, 0.035, 0.32, 6), { color: K.bark }, M.t(x + 0.27, 0.035 + (k === 2 ? 0.06 : 0), z - 0.06 + (k === 2 ? 0.035 : k * 0.07), Math.PI / 2, 0, 0));
  },
];

// ---------------- Observatory ----------------

const OH = OBS.h, DRUM = 0.6, CROWN = OH + 1.0;
const observatory: Look[] = [
  // Star charts: two painted cloths hung on the tower either side of the door, indigo with gold
  // stars, the constellations drawn between them, a crescent moon and a red border.
  (b) => {
    const rng = new RNG(4300);
    for (const s of [-1, 1]) {
      const a = Math.PI / 2 - s * 0.82;
      const m = onRing(a, 0.655, OH + 0.47);
      const W = 0.3, Hc = 0.44;
      b.add(P.box(W, Hc, 0.012), { color: c(0x1f2a4a) }, m);
      b.add(P.cyl(0.014, 0.014, W + 0.08, 5), { color: K.timberDark }, at(m, 0, Hc / 2 + 0.01, 0.01, 0, 0, Math.PI / 2));
      const d = (x: number, y: number, w: number, h: number, col: THREE.Color, rz = 0) => b.add(P.box(w, h, 0.006), { color: col }, at(m, x, y, 0.02, 0, 0, rz));
      for (const y of [-Hc / 2 + 0.02, Hc / 2 - 0.02]) d(0, y, W - 0.02, 0.016, K.red);
      for (const x of [-W / 2 + 0.02, W / 2 - 0.02]) d(x, 0, 0.016, Hc - 0.06, K.red);
      const stars: [number, number][] = [];
      for (let k = 0; k < 7; k++) stars.push([rng.range(-0.1, 0.1), rng.range(-0.16, 0.12)]);
      for (let k = 0; k < stars.length - 1; k++) {
        const [x0, y0] = stars[k], [x1, y1] = stars[k + 1];
        d((x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0), 0.005, c(0xc9d4e8), Math.atan2(y1 - y0, x1 - x0));
      }
      for (const [x, y] of stars) b.add(P.box(0.024, 0.024, 0.006), { color: K.gold }, at(m, x, y, 0.024, 0, 0, Math.PI / 4));
      b.add(P.cyl(0.04, 0.04, 0.006, 12), { color: K.cream }, at(m, s * 0.07, 0.15, 0.024, Math.PI / 2));
      b.add(P.cyl(0.036, 0.036, 0.006, 12), { color: c(0x1f2a4a) }, at(m, s * 0.07 + 0.02, 0.16, 0.03, Math.PI / 2));
    }
  },
  // Taller platform: a timber sighting deck raised on posts above the crown, railed, with a ladder,
  // a sighting staff and a pennant.
  (b) => {
    const y0 = CROWN + 0.245, deck = CROWN + 1.1;
    const q = 0.57 / Math.SQRT2;
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      b.add(P.box(0.09, deck - y0, 0.09), { color: K.timberDark }, M.t(Math.cos(a) * 0.57, (y0 + deck) / 2, Math.sin(a) * 0.57));
      // A diagonal brace across each side, and a red valance under the deck's edge.
      const ry = (k * Math.PI) / 2, from = new THREE.Vector3(-q + 0.05, y0 + 0.12, q).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry), to = new THREE.Vector3(q - 0.05, deck - 0.12, q).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
      const dir = to.clone().sub(from), mid = from.clone().add(to).multiplyScalar(0.5);
      b.add(P.box(0.035, dir.length(), 0.035), { color: K.timber }, M.t(mid.x, mid.y, mid.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()))));
      b.add(P.box(1.2, 0.1, 0.012), { color: K.red }, M.t(0, deck - 0.05, 0, 0, ry, 0).multiply(M.t(0, 0, 0.607)));
    }
    for (const s of [-1, 1]) {
      b.add(P.box(1.2, 0.06, 0.34), { color: c(0xa8784a) }, M.t(0, deck + 0.03, s * 0.43));
      b.add(P.box(0.34, 0.06, 0.52), { color: c(0x94663c) }, M.t(s * 0.43, deck + 0.03, 0));
      b.add(P.box(1.2, 0.05, 0.05), { color: K.timber }, M.t(0, deck + 0.3, s * 0.575));
      b.add(P.box(0.05, 0.05, 1.2), { color: K.timber }, M.t(s * 0.575, deck + 0.3, 0));
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(P.box(0.07, 0.34, 0.07), { color: K.timberDark }, M.t(sx * 0.58, deck + 0.2, sz * 0.58));
    b.add(P.box(1.1, 0.04, 0.04), { color: K.red }, M.t(0, deck + 0.065, 0.62));
    // A ladder up the back from the crown.
    const lz = -0.64;
    for (const s of [-1, 1]) b.add(P.box(0.03, deck - y0 + 0.3, 0.03), { color: K.timber }, M.t(s * 0.1, (y0 + deck + 0.3) / 2, lz));
    for (let k = 1; k < 7; k++) b.add(P.box(0.17, 0.02, 0.018), { color: K.timberDark }, M.t(0, y0 + k * ((deck - y0) / 6), lz));
    // Sighting staff with its crossed sticks, and a pennant.
    b.add(P.cyl(0.018, 0.022, 0.6, 5), { color: K.timberDark }, M.t(0.42, deck + 0.36, 0.42));
    for (const s of [-1, 1]) b.add(P.cyl(0.01, 0.01, 0.26, 4), { color: K.timber }, M.t(0.42, deck + 0.64, 0.42, 0, 0, s * 0.7));
    b.add(P.cyl(0.02, 0.025, 0.9, 5), { color: K.timberDark }, M.t(-0.5, deck + 0.45, -0.5));
    b.add(P.box(0.3, 0.16, 0.012), { color: K.red }, M.t(-0.34, deck + 0.8, -0.5));
    b.add(P.box(0.3, 0.04, 0.014), { color: K.gold }, M.t(-0.34, deck + 0.73, -0.5));
  },
  // Third priest: a second watcher's post on the terrace opposite the first, a carved pillar with
  // crossed sighting sticks and a gold disc, a stone seat on a mat and an almanac on a stand.
  (b) => {
    const px = -0.84, pz = 0.12;
    b.add(P.box(0.13, 0.42, 0.13), { color: CUT.stone }, M.t(px, OH + 0.21, pz));
    b.add(P.box(0.15, 0.04, 0.15), { color: K.red }, M.t(px, OH + 0.33, pz));
    b.add(P.box(0.16, 0.03, 0.16), { color: CUT.stoneLight }, M.t(px, OH + 0.435, pz));
    b.add(P.cyl(0.015, 0.018, 0.32, 5), { color: K.timberDark }, M.t(px, OH + 0.6, pz));
    for (const s of [-1, 1]) b.add(P.cyl(0.01, 0.01, 0.24, 4), { color: K.timber }, M.t(px, OH + 0.74, pz, 0, 0, s * 0.7));
    b.add(P.cyl(0.05, 0.05, 0.012, 12), { color: K.gold }, M.t(px, OH + 0.22, pz + 0.072, Math.PI / 2));
    const sx = -0.64, sz = 0.5;
    b.add(P.box(0.24, 0.012, 0.2), { color: c(0xb2412f) }, M.t(sx, OH + 0.016, sz, 0, 0.6, 0));
    b.add(P.box(0.14, 0.12, 0.14), { color: CUT.stoneLight }, M.t(sx, OH + 0.082, sz, 0, 0.6, 0));
    b.add(P.box(0.03, 0.2, 0.03), { color: K.timberDark }, M.t(-0.78, OH + 0.1, 0.38));
    b.add(P.box(0.14, 0.012, 0.1), { color: c(0xf2e6c4) }, M.t(-0.78, OH + 0.205, 0.38, -0.5, 0.6, 0));
  },
];

export const VILLAGE_LOOKS: Looks = { campfire, bonfire, firepit, well, greathall, palace, firemaker, market, tradedock, observatory };
