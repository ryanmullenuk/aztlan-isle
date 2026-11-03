import * as THREE from 'three';
import { GeoBuilder, M, P, doubleSide, lumpy } from '../../render/GeoBuilder';
import { TOWER } from '../models';
import type { Look, Looks } from './types';

// Upgrade looks for the safety and healing buildings: the watchtower, the dog kennel, the warrior
// lodge, the healing centre, the herbalist's garden and the herbal garden. Each look adds what its
// upgrade says, placed round the building's own model (see models.ts) so nothing sits in a wall, on
// a doorway or where islanders stand. Layered faces keep at least 0.01 apart (no flicker).

const c = (h: number) => new THREE.Color(h);
/** The shared palettes of models.ts (the few colours used here). */
const K = {
  thatch: c(0xbca06b), thatchDark: c(0x94794d), timber: c(0x866443), timberDark: c(0x5e3b22),
  terracotta: c(0xa8583e), stone: c(0xd5bea0), stoneDark: c(0xa69276), gold: c(0xc8a451),
  red: c(0xa64032), white: c(0xf4eee0), mud: c(0x6e5034), rope: c(0xc9a86a),
};
const AD = { cream: c(0xf3e3c6), red: c(0xa74a39), pot: c(0xc4643a), leaf: c(0x4f9a3a), leafLight: c(0x7cc04a) };
const CUT = { stone: c(0xdcb27a), stoneLight: c(0xe9c993), stoneDark: c(0xbf9864) };
const HC = { wall: c(0xe2b77e), wallLight: c(0xf0d3a2), band: c(0x8e2a22), cream: c(0xf3e3c6), post: c(0x5e3b22), clay: c(0xc4643a), clayDark: c(0x9c4a2c) };
const PEN = { withy: c(0x8a6440), withyDark: c(0x6b4a2c), straw: c(0xd9b866) };
const BLUE = c(0x3f6f9a), TEAL = c(0x2c8a83), INK = c(0x2a2420), COAL = c(0x3a2a20);
/** Leaf flag for cloth (keeps the plaster and stone skin off it; see models.ts). */
const CLOTH = 0.95;
const UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A round post or strut from point a to point e. */
function beam(b: GeoBuilder, a: THREE.Vector3, e: THREE.Vector3, r: number, color: THREE.Color, seg = 5): void {
  const d = e.clone().sub(a), len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
  b.add(P.cyl(r, r, len, seg), { color }, new THREE.Matrix4().compose(a.clone().add(e).multiplyScalar(0.5), q, ONE));
}

/** A square timber from point a to point e. */
function plank(b: GeoBuilder, a: THREE.Vector3, e: THREE.Vector3, w: number, color: THREE.Color): void {
  const d = e.clone().sub(a), len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
  b.add(P.box(w, len, w), { color }, new THREE.Matrix4().compose(a.clone().add(e).multiplyScalar(0.5), q, ONE));
}

/** A clay fire pot (open bowl with a bed of coals); returns where its flame burns. */
function firePot(b: GeoBuilder, x: number, y: number, z: number, s = 1): THREE.Vector3 {
  b.add(P.cyl(0.12 * s, 0.075 * s, 0.12 * s, 9), { color: c(0x7a5a44) }, M.t(x, y + 0.06 * s, z));
  b.add(P.torus(0.12 * s, 0.018 * s, 5, 12), { color: K.terracotta }, M.t(x, y + 0.12 * s, z, Math.PI / 2, 0, 0));
  b.add(P.cyl(0.1 * s, 0.1 * s, 0.01, 9), { color: COAL }, M.t(x, y + 0.12 * s + 0.008, z));
  return v(x, y + 0.2 * s, z);
}

/** A round shield facing +z of `m`: red with a cream ring, a red centre and a gold boss. */
function shield(b: GeoBuilder, m: THREE.Matrix4, r: number): void {
  const at = (z: number) => m.clone().multiply(M.t(0, 0, z, Math.PI / 2, 0, 0));
  b.add(P.cyl(r, r, 0.02, 12), { color: K.red }, at(0));
  b.add(P.cyl(r * 0.72, r * 0.72, 0.02, 12), { color: AD.cream }, at(0.012));
  b.add(P.cyl(r * 0.45, r * 0.45, 0.02, 12), { color: K.red }, at(0.024));
  b.add(P.cyl(r * 0.15, r * 0.15, 0.02, 8), { color: K.gold }, at(0.036));
}

/** A round clay storage jar. */
function clayJar(b: GeoBuilder, x: number, y: number, z: number, s = 1, body = HC.clay): void {
  b.add(P.sphere(0.08 * s, 1), { color: (p) => (p.y < y + 0.06 * s ? body.clone().multiplyScalar(0.8) : body.clone()) }, M.t(x, y + 0.09 * s, z, 0, 0, 0, 1, 1.15, 1));
  b.add(P.cyl(0.035 * s, 0.045 * s, 0.05 * s, 7, true), { color: body }, M.t(x, y + 0.19 * s, z));
  b.add(P.cyl(0.045 * s, 0.045 * s, 0.015 * s, 7), { color: body.clone().multiplyScalar(0.8) }, M.t(x, y + 0.215 * s, z));
}

/** A bunch of herbs tied and hung upside down from a bar at height y. */
function herbBundle(b: GeoBuilder, x: number, y: number, z: number, col: THREE.Color, ry = 0): void {
  b.add(P.cyl(0.008, 0.008, 0.12, 4), { color: K.rope }, M.t(x, y - 0.06, z));
  for (let j = 0; j < 3; j++) b.add(P.cone(0.045, 0.22, 5), { color: col.clone().multiplyScalar(1 - j * 0.08), leaf: 1, sway: 0.08 }, M.t(x + (j - 1) * 0.03, y - 0.22, z, Math.PI, ry, (j - 1) * 0.14));
}

/** A medicinal herb: a stem with soft rounded leaves and an optional flower head (as models.ts). */
function herb(b: GeoBuilder, x: number, y: number, z: number, size: number, bloom?: number): void {
  b.add(P.cyl(0.009, 0.012, size, 4), { color: c(0x597746) }, M.t(x, y + size / 2, z));
  for (let k = 0; k < 5; k++) {
    const a = k * 2.4;
    b.add(P.uvSphere(size * 0.24, 5, 3), { color: k % 2 ? c(0x738e56) : c(0x426950), leaf: 1, sway: 0.2 }, M.t(x + Math.cos(a) * size * 0.16, y + size * (0.25 + k * 0.12), z + Math.sin(a) * size * 0.16, 0, a, 0.5, 1.5, 0.35, 0.7));
  }
  if (bloom !== undefined) b.add(P.sphere(0.035, 0), { color: c(bloom), leaf: 1, sway: 0.25 }, M.t(x, y + size, z));
}

/** A practice dummy: a post, a cross-arm and a padded body with a head (as models.ts). */
function trainingDummy(b: GeoBuilder, x: number, z: number, ry: number, y0 = 0): void {
  const m = M.t(x, y0, z, 0, ry, 0);
  b.add(P.cyl(0.03, 0.035, 0.5, 5), { color: K.timberDark }, m.clone().multiply(M.t(0, 0.25, 0)));
  b.add(P.box(0.13, 0.2, 0.09), { color: c(0xc9a86a) }, m.clone().multiply(M.t(0, 0.36, 0)));
  b.add(P.box(0.3, 0.035, 0.035), { color: K.timber }, m.clone().multiply(M.t(0, 0.42, 0)));
  b.add(P.sphere(0.055, 1), { color: c(0xc9a86a) }, m.clone().multiply(M.t(0, 0.53, 0)));
  b.add(P.box(0.15, 0.03, 0.11), { color: K.red }, m.clone().multiply(M.t(0, 0.3, 0)));
  b.add(P.box(0.2, 0.025, 0.2), { color: K.timberDark }, m.clone().multiply(M.t(0, 0.0125, 0)));
}

// ---------------- Watchtower (2 × 2) ----------------

const TW = { P0: TOWER.platform, H: TOWER.half, room: 0.78, RH: 0.85 };
/** Height of the watch room's pyramid roof at (x, z): it rises from its eaves to the peak. */
const towerRoofY = (x: number, z: number) => TW.P0 + TW.room - 0.04 + TW.RH * (1 - Math.max(Math.abs(x), Math.abs(z)) / (TW.H * 1.62 * Math.SQRT1_2));

/**
 * Taller tower: a railed lookout raised on four posts above the back of the roof (clear of the
 * beacon on the peak), under its own little thatched cap with a pennant, and a short ladder up to
 * it from the roof. The arrow windows below are unchanged.
 */
const tallerTower: Look = (b) => {
  const FLOOR = 4.62, X = 0.4, Z0 = -0.72, Z1 = -0.36, zc = (Z0 + Z1) / 2;
  for (const x of [-X, X]) for (const z of [Z0, Z1]) b.add(P.cyl(0.035, 0.04, FLOOR + 0.58 - 3.1, 6), { color: K.timberDark }, M.t(x, (3.1 + FLOOR + 0.58) / 2, z));
  // Cross braces on the sides and the back, between the roof and the floor.
  for (const x of [-X, X]) beam(b, v(x, towerRoofY(x, Z1) + 0.02, Z1), v(x, FLOOR - 0.1, Z0), 0.022, K.timber);
  beam(b, v(-X, towerRoofY(X, Z0) + 0.05, Z0), v(X, FLOOR - 0.1, Z0), 0.022, K.timber);
  // The floor: planks on two bearers.
  for (const z of [Z0, Z1]) b.add(P.box(1.0, 0.06, 0.07), { color: K.timberDark }, M.t(0, FLOOR - 0.1, z));
  for (let k = 0; k < 5; k++) {
    const z = -0.8 + 0.1 * k + 0.05;
    b.add(P.box(1.0 + (k % 2) * 0.04, 0.05, 0.09), { color: k % 2 ? K.timber : c(0x8a6038) }, M.t(0, FLOOR - 0.045, z));
  }
  // A rail round the lookout.
  for (const y of [FLOOR + 0.14, FLOOR + 0.3]) {
    for (const z of [Z0, Z1]) beam(b, v(-X, y, z), v(X, y, z), 0.018, K.timber);
    for (const x of [-X, X]) beam(b, v(x, y, Z0), v(x, y, Z1), 0.018, K.timber);
  }
  // A red cloth along the back rail.
  b.add(P.box(2 * X - 0.08, 0.12, 0.015), { color: K.red, leaf: CLOTH }, M.t(0, FLOOR + 0.22, Z0 - 0.03));
  // The cap: a little four-sided thatch roof with a pennant on top.
  const capY = FLOOR + 0.58;
  b.add(new THREE.ConeGeometry(0.64, 0.36, 4, 3), { color: (p) => (((capY + 0.4 - p.y) * 9) % 1 < 0.35 ? K.thatchDark : K.thatch).clone().lerp(K.thatch, 0.25), leaf: 0.2 }, M.t(0, capY + 0.17, zc, 0, Math.PI / 4, 0));
  b.add(P.cyl(0.018, 0.018, 0.42, 5), { color: K.timberDark }, M.t(0, capY + 0.5, zc));
  b.add(P.box(0.02, 0.12, 0.22), { color: K.red, leaf: CLOTH }, M.t(0, capY + 0.63, zc + 0.12));
  // A short ladder from the roof up to the lookout.
  for (const x of [-0.33, -0.17]) beam(b, v(x, towerRoofY(-0.25, -0.24) - 0.02, -0.22), v(x, FLOOR + 0.05, Z1 + 0.04), 0.016, K.timber);
  for (let k = 0; k < 3; k++) {
    const t = (k + 1) / 4, y = towerRoofY(-0.25, -0.24) + (FLOOR - towerRoofY(-0.25, -0.24)) * t;
    b.add(P.box(0.2, 0.025, 0.025), { color: K.timberDark }, M.t(-0.25, y, -0.22 + (Z1 + 0.04 + 0.22) * t));
  }
};

/**
 * Fire arrows: a clay fire pot on a timber bracket at every corner of the watch room (lit at night,
 * for lighting arrows), and a basket of pitch-tipped arrows on the footing.
 */
const fireArrows: Look = (b, _w, _d, torches) => {
  const P0 = TW.P0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * 0.83, z = sz * 0.83, y = P0 + 0.08;
    plank(b, v(sx * 0.66, P0 - 0.05, sz * 0.66), v(x, y + 0.01, z), 0.045, K.timberDark);
    beam(b, v(sx * 0.56, 1.95, sz * 0.56), v(x - sx * 0.03, y - 0.01, z - sz * 0.03), 0.02, K.timberDark);
    torches.push(firePot(b, x, y, z, 0.9));
  }
  // A basket of arrows with dark pitch-wrapped heads, on the footing beside the front left leg.
  const bx = -0.32, by = 0.34, bz = 0.6;
  b.add(P.cyl(0.075, 0.06, 0.18, 9), { color: (p) => ((p.y * 50) % 1 < 0.5 ? K.rope : c(0xae8a50)) }, M.t(bx, by + 0.09, bz));
  for (let k = 0; k < 6; k++) {
    const a = k * 1.05, tilt = 0.12;
    const m = M.t(bx + Math.cos(a) * 0.03, by + 0.24, bz + Math.sin(a) * 0.03, Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
    b.add(P.cyl(0.008, 0.008, 0.36, 4), { color: K.timber }, m);
    b.add(P.sphere(0.024, 0), { color: c(0x231a14) }, m.clone().multiply(M.t(0, 0.19, 0, 0, 0, 0, 1, 1.4, 1)));
  }
};

/**
 * Twin archers: a second archer's post, a railed gallery out from the side window on two struts,
 * fronted by a wall of three round shields, with a bow and a quiver of arrows on it.
 */
const twinArchers: Look = (b) => {
  const P0 = TW.P0, X0 = -0.7, X1 = -0.97, xc = (X0 + X1) / 2, Z = 0.44;
  b.add(P.box(X0 - X1, 0.06, 2 * Z), { color: K.timber }, M.t(xc, P0 - 0.01, 0));
  b.add(P.box(0.06, 0.08, 2 * Z + 0.04), { color: K.timberDark }, M.t(X1 + 0.04, P0 - 0.08, 0));
  for (const s of [-1, 1]) beam(b, v(-0.545, 1.95, s * 0.52), v(X1 + 0.05, P0 - 0.09, s * (Z - 0.06)), 0.028, K.timberDark);
  // Posts and a rail along the outer edge, the shields hung on its outside.
  for (const z of [-Z + 0.03, 0, Z - 0.03]) b.add(P.cyl(0.02, 0.022, 0.34, 6), { color: K.timberDark }, M.t(X1 + 0.08, P0 + 0.16, z));
  beam(b, v(X1 + 0.08, P0 + 0.3, -Z), v(X1 + 0.08, P0 + 0.3, Z), 0.018, K.timber);
  for (const z of [-0.28, 0, 0.28]) shield(b, M.t(X1 + 0.02, P0 + 0.15, z, 0, -Math.PI / 2, 0), 0.13);
  // A bow propped against the wall and a quiver of arrows.
  const bow = new THREE.TorusGeometry(0.24, 0.012, 4, 12, Math.PI * 0.7);
  const bm = M.t(-0.76, P0 + 0.28, 0.3, 0, Math.PI / 2, Math.PI / 2 - Math.PI * 0.35).multiply(M.t(-0.2, 0, 0));
  b.add(bow, { color: K.timberDark }, bm);
  b.add(P.cyl(0.004, 0.004, 0.43, 3), { color: K.white }, M.t(-0.76, P0 + 0.28, 0.3).multiply(M.t(0, 0, 0.03)));
  b.add(P.cyl(0.045, 0.04, 0.26, 8), { color: c(0x8a5a36) }, M.t(-0.78, P0 + 0.15, -0.3, 0, 0, 0.12));
  for (let k = 0; k < 4; k++) b.add(P.cyl(0.006, 0.006, 0.12, 3), { color: K.white }, M.t(-0.79 + (k % 2) * 0.02 - 0.01, P0 + 0.3, -0.31 + (k >> 1) * 0.02, 0, 0, 0.12));
};

// ---------------- Dog Kennel (2 × 2) ----------------

/**
 * Bigger run: a taller woven fence of stakes and wattle round the whole plot, outside the old rail
 * fence and open at the gate, so the dogs have the run of the yard right to the edge.
 */
const biggerRun: Look = (b) => {
  const O = 0.965, OH = 0.52;
  const runs: [number, number, number, number][] = [[-O, -O, O, -O], [O, -O, O, O], [-O, -O, -O, O], [-O, O, -0.64, O], [-0.11, O, O, O]];
  const stakes = new Set<string>();
  for (const [x0, z0, x1, z1] of runs) {
    const len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 0.24));
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n, z = z0 + ((z1 - z0) * k) / n, key = `${x.toFixed(3)},${z.toFixed(3)}`;
      if (stakes.has(key)) continue;
      stakes.add(key);
      const corner = (k === 0 || k === n);
      b.add(P.box(0.05, OH, 0.05), { color: K.timberDark }, M.t(x, OH / 2, z));
      b.add(P.cone(0.036, 0.08, 4), { color: K.timberDark }, M.t(x, OH + 0.04, z, 0, Math.PI / 4, 0));
      if (corner) b.add(P.cyl(0.034, 0.034, 0.05, 8), { color: BLUE }, M.t(x, OH - 0.04, z));
    }
    // Woven withy bands between the stakes.
    for (let r = 0; r < 3; r++) b.add(P.box(0.025, 0.07, len), { color: r % 2 ? PEN.withyDark : PEN.withy }, M.t((x0 + x1) / 2, 0.15 + r * 0.13, (z0 + z1) / 2, 0, a, 0));
  }
};

/** Training yard: a striped hurdle, a row of weave poles and a woven tunnel for the dogs. */
const trainingYard: Look = (b) => {
  // Hurdle (front right).
  for (const x of [0.12, 0.46]) {
    b.add(P.box(0.045, 0.34, 0.045), { color: K.timberDark }, M.t(x, 0.05 + 0.17, 0.66));
    b.add(P.box(0.1, 0.03, 0.1), { color: K.timberDark }, M.t(x, 0.065, 0.66));
  }
  for (let k = 0; k < 4; k++) b.add(P.cyl(0.02, 0.02, 0.085, 6), { color: k % 2 ? AD.cream : BLUE }, M.t(0.165 + k * 0.085, 0.27, 0.66, 0, 0, Math.PI / 2));
  // Weave poles (right).
  for (let k = 0; k < 4; k++) {
    const z = 0.2 + k * 0.12;
    b.add(P.cyl(0.017, 0.02, 0.34, 6), { color: AD.cream }, M.t(0.62, 0.05 + 0.17, z));
    b.add(P.cyl(0.032, 0.032, 0.05, 6), { color: BLUE }, M.t(0.62, 0.05 + 0.29, z));
  }
  // A woven tunnel (front middle, left of the bowls), with blue hoops at its ends.
  const tx = -0.17, z0 = 0.44, z1 = 0.78, r = 0.11, len = z1 - z0;
  const arch = doubleSide(new THREE.CylinderGeometry(r, r, len, 10, 6, true, Math.PI / 2, Math.PI));
  b.add(arch, { color: (p) => ((Math.floor(p.z * 30) + Math.floor(Math.atan2(p.y, p.x - tx) * 4)) % 2 ? PEN.withy : PEN.withyDark).clone(), facet: true }, M.t(tx, 0.06, (z0 + z1) / 2, Math.PI / 2, 0, 0));
  for (const z of [z0, z1]) b.add(new THREE.TorusGeometry(r + 0.012, 0.016, 5, 12, Math.PI), { color: BLUE }, M.t(tx, 0.06, z));
};

/** Second dog house: a bigger timber dog house in the run, door to the yard, with straw and a blue blanket. */
const secondDogHouse: Look = (b) => {
  const s = 1.2, m = M.t(-0.6, 0, 0.35, 0, Math.PI / 2, 0);
  const at = (px: number, py: number, pz: number, rx = 0, rz = 0) => m.clone().multiply(M.t(px * s, py * s, pz * s, rx, 0, rz));
  b.add(P.box(0.3 * s, 0.22 * s, 0.34 * s), { color: K.timber }, at(0, 0.11, 0));
  b.add(P.box(0.13 * s, 0.13 * s, 0.012), { color: c(0x2a1c14) }, at(0, 0.09, 0.17).multiply(M.t(0, 0, 0.004)));
  for (const side of [-1, 1]) b.add(P.box(0.2 * s, 0.025 * s, 0.4 * s), { color: BLUE }, at(side * 0.085, 0.27, 0, 0, -side * 0.62));
  b.add(P.box(0.03 * s, 0.03 * s, 0.42 * s), { color: K.timberDark }, at(0, 0.335, 0));
  b.add(lumpy(P.sphere(0.07 * s, 0), 0.3, 9, 0.4), { color: PEN.straw }, at(0, 0.03, 0.14));
  b.add(P.box(0.14 * s, 0.012, 0.1 * s), { color: BLUE }, at(-0.02, 0.07, 0.25));
};

// ---------------- Warrior Lodge (3 × 3) ----------------

const WR = { E: 1.3 };

/**
 * Barracks: three striped sleeping mats with rolled headrests laid out in the back right corner of
 * the yard, their heads under a thatched lean-to with a red valance, and warriors' cloaks hung on a
 * rail along its back.
 */
const barracks: Look = (b) => {
  const x0 = 0.66, x1 = 1.16, zb = -0.98, zf = -0.8, yb = 0.72, yf = 0.62, xc = (x0 + x1) / 2;
  for (const [x, z, y] of [[x0, zb, yb], [x1, zb, yb], [x0, zf, yf], [x1, zf, yf]] as const) b.add(P.cyl(0.026, 0.03, y, 6), { color: K.timberDark }, M.t(x, y / 2 + 0.03, z));
  // Thatch strips across the slope (alternate strips a little proud, so none lie flush).
  const slope = Math.atan2(yb - yf, zf - zb), run = Math.hypot(yb - yf, zf - zb) + 0.1, n = 4;
  const nY = Math.cos(slope), nZ = Math.sin(slope), lift = (z: number) => yb + 0.03 - Math.tan(slope) * (z - zb) + 0.018 / nY;
  for (let k = 0; k < n; k++) {
    const u = -0.05 + run * ((k + 0.5) / n), up = (k % 2) * 0.016, z = zb + u * nY + up * nZ, y = lift(zb + u * nY) + up * nY;
    b.add(P.box(x1 - x0 + 0.06 + (k % 2) * 0.03, 0.035, run / n + 0.02), { color: k % 2 ? K.thatch : K.thatchDark, leaf: 0.2 }, M.t(xc + 0.015, y, z, slope, 0, 0));
  }
  b.add(P.box(x1 - x0 + 0.04, 0.07, 0.015), { color: K.red, leaf: CLOTH }, M.t(xc + 0.015, yf - 0.02, zf + 0.06));
  // Sleeping mats: woven petates striped cream and red, each with a rolled headrest.
  for (const x of [0.73, 0.91, 1.09]) {
    const segs = 5, len = 0.4;
    for (let k = 0; k < segs; k++) b.add(P.box(0.15, 0.015, len / segs), { color: k % 2 ? AD.red : AD.cream }, M.t(x, 0.072, zb + 0.03 + (len / segs) * (k + 0.5)));
    b.add(P.cyl(0.03, 0.03, 0.14, 7), { color: c(0xd8c49a) }, M.t(x, 0.11, zb + 0.07, 0, 0, Math.PI / 2));
  }
  // Cloaks on a rail along the back.
  b.add(P.box(x1 - x0, 0.03, 0.03), { color: K.timber }, M.t(xc, 0.52, zb - 0.01));
  for (const [x, col] of [[0.78, K.red], [0.94, TEAL], [1.08, AD.cream]] as [number, THREE.Color][]) b.add(P.box(0.13, 0.26, 0.015), { color: col, leaf: CLOTH }, M.t(x, 0.38, zb + 0.01));
};

/** An archery target: a straw boss painted with rings on both faces, leaning back on an easel, two arrows in it. */
function archeryTarget(b: GeoBuilder, x: number, z: number, ry: number): void {
  const m = M.t(x, 0.06, z, 0, ry, 0);
  const boss = m.clone().multiply(M.t(0, 0.36, 0, -0.3, 0, 0));
  const disc = (r: number, zz: number, col: THREE.Color, h = 0.02) => b.add(P.cyl(r, r, h, 14), { color: col }, boss.clone().multiply(M.t(0, 0, zz, Math.PI / 2, 0, 0)));
  disc(0.2, 0, PEN.straw, 0.07);
  for (const f of [-1, 1]) {
    disc(0.16, f * 0.035, AD.cream);
    disc(0.11, f * 0.045, K.red);
    disc(0.055, f * 0.055, TEAL);
  }
  for (const [px, py] of [[0.04, 0.03], [-0.07, -0.02]]) b.add(P.cyl(0.006, 0.006, 0.24, 3), { color: K.timber }, boss.clone().multiply(M.t(px, py, 0.12, Math.PI / 2, 0, 0)));
  // Easel: two legs under the boss's sides and a prop behind.
  for (const s of [-1, 1]) beam(b, v(s * 0.15, 0, 0.08).applyMatrix4(m), v(s * 0.11, 0.54, -0.08).applyMatrix4(m), 0.018, K.timberDark);
  beam(b, v(0, 0, -0.24).applyMatrix4(m), v(0, 0.44, -0.07).applyMatrix4(m), 0.018, K.timberDark);
}

/** A pell: a stout post wrapped in rope for striking practice. */
function pell(b: GeoBuilder, x: number, z: number): void {
  b.add(P.cyl(0.05, 0.055, 0.5, 7), { color: K.timberDark }, M.t(x, 0.06 + 0.25, z));
  for (const y of [0.22, 0.32, 0.42]) b.add(P.cyl(0.068, 0.068, 0.05, 7), { color: K.rope }, M.t(x, 0.06 + y, z));
}

/** Training ground: an archery target in each front corner of the yard, two striking posts and a fifth dummy. */
const trainingGround: Look = (b) => {
  for (const s of [-1, 1]) {
    const x = s * 0.62, z = 0.92;
    archeryTarget(b, x, z, Math.atan2(-x, 0.2 - z));
    pell(b, s * 0.36, 0.72);
  }
  trainingDummy(b, 0.5, -0.28, 0.3, 0.06);
};

/**
 * Eagle perch: a tall banded pole on the front left corner tower with a cross perch at the top,
 * where a golden eagle sits with its wings half open, looking out over the gate.
 */
const eaglePerch: Look = (b) => {
  const x = -WR.E + 0.14, z = WR.E - 0.08, y0 = 0.73, top = 1.9;
  b.add(P.cyl(0.04, 0.05, top - y0 + 0.03, 7), { color: K.timberDark }, M.t(x, (y0 - 0.03 + top) / 2, z));
  b.add(P.cyl(0.075, 0.08, 0.06, 8), { color: CUT.stoneDark }, M.t(x, y0 + 0.03, z));
  for (const [y, col] of [[1.1, K.red], [1.3, TEAL], [1.5, K.red]] as const) b.add(P.cyl(0.07, 0.07, 0.05, 7), { color: col }, M.t(x, y, z));
  // The eagle, facing out over the front of the lodge.
  const e = M.t(x, top, z, 0, Math.PI / 4, 0);
  const at = (px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => e.clone().multiply(M.t(px, py, pz, rx, ry, rz, sx, sy, sz));
  b.add(P.box(0.32, 0.04, 0.05), { color: K.timber }, at(0, 0, 0));
  b.add(P.sphere(0.1, 1), { color: c(0x4a3222) }, at(0, 0.13, -0.01, 0.25, 0, 0, 0.85, 1.25, 0.8));
  b.add(P.sphere(0.07, 1), { color: c(0x7a5634) }, at(0, 0.11, 0.05, 0.25, 0, 0, 0.8, 1.2, 0.6));
  b.add(P.sphere(0.062, 1), { color: c(0xa07838) }, at(0, 0.27, 0.05, 0, 0, 0, 1, 1, 1.15));
  b.add(P.cone(0.03, 0.09, 6), { color: c(0xe2b23a) }, at(0, 0.255, 0.13, Math.PI / 2 + 0.45, 0, 0));
  const brown = c(0x5a3c26), dark = c(0x2e1f15);
  for (const s of [-1, 1]) {
    // Raised wings: a broad inner wing, a darker outer wing and three spread primaries.
    const wing = at(s * 0.07, 0.17, -0.01, 0, s * 0.25, s * 0.8);
    b.add(P.box(0.16, 0.025, 0.2), { color: brown }, wing.clone().multiply(M.t(s * 0.08, 0, 0)));
    b.add(P.box(0.1, 0.025, 0.16), { color: dark }, wing.clone().multiply(M.t(s * 0.21, 0, -0.01)));
    for (let f = -1; f <= 1; f++) b.add(P.box(0.1, 0.02, 0.035), { color: dark }, wing.clone().multiply(M.t(s * 0.25, 0, -0.01 + f * 0.055, 0, -s * f * 0.3, 0)).multiply(M.t(s * 0.05, 0, 0)));
    b.add(P.box(0.025, 0.03, 0.03), { color: c(0xe2b23a) }, at(s * 0.035, 0.03, 0.03));
  }
  b.add(P.box(0.13, 0.02, 0.17), { color: c(0x3e2a1a) }, at(0, 0.05, -0.13, -0.6, 0, 0));
};

// ---------------- Healing Centre (5 × 5) ----------------

/** Courtyard floor height and the top of its tiles (see HEAL in models.ts). */
const HL = { H: 0.24, floor: 0.252 };

/**
 * More beds (first): a low shelf of herbs and clay jars at the foot of each new bed, clear of the
 * aisle and the bedsides where patients stand.
 */
const bedShelves: Look = (b) => {
  const F = HL.floor + 0.001;
  for (const sx of [-1, 1]) {
    const x = sx * 0.45, z = 1.6;
    for (const px of [-1, 1]) for (const pz of [-1, 1]) b.add(P.box(0.03, 0.38, 0.03), { color: HC.post }, M.t(x + px * 0.165, F + 0.19, z + pz * 0.08));
    for (const y of [0.04, 0.2, 0.36]) b.add(P.box(0.3, 0.025, 0.13), { color: K.timber }, M.t(x, F + y, z));
    clayJar(b, x - 0.08, F + 0.2125, z, 0.52);
    clayJar(b, x + 0.06, F + 0.2125, z, 0.45, c(0x7a6a58));
    clayJar(b, x - 0.05, F + 0.0525, z, 0.55, HC.clayDark);
    for (const [dx, col] of [[0.06, c(0x5d8a3c)], [-0.07, c(0x8a8a46)], [0.09, c(0x6e9a3a)]] as [number, THREE.Color][]) {
      b.add(P.sphere(0.045, 0), { color: col, leaf: 1 }, M.t(x + dx, F + (dx > 0.08 ? 0.1 : 0.42), z, 0, dx * 10, 0, 1.2, 0.8, 1));
    }
  }
};

/**
 * Steam bath: a temazcal on the right of the court, an adobe dome on a stone course with a red
 * band, a low porch whose dark door faces the beds, a firebox at the back with its fire showing, a
 * vent with steam rising, a water jar and a stack of firewood.
 */
const steamBath: Look = (b, _w, _d, torches) => {
  const F = HL.floor, X = 1.84, Z = 0, R = 0.38, dy = 1;
  b.add(P.cyl(R + 0.03, R + 0.04, 0.06, 16), { color: K.stoneDark }, M.t(X, F + 0.03, Z));
  const dome = new THREE.SphereGeometry(R, 16, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  b.add(dome, { color: (p) => HC.wall.clone().lerp(HC.wallLight, Math.min(1, Math.max(0, (p.y - F) / (R * dy)))) }, M.t(X, F + 0.05, Z, 0, 0, 0, 1, dy, 1));
  b.add(P.cyl(R + 0.014, R + 0.014, 0.05, 16, true), { color: HC.band }, M.t(X, F + 0.09, Z));
  // The porch and its dark doorway (toward the beds, -x).
  const px = X - R + 0.04;
  b.add(P.box(0.22, 0.2, 0.26), { color: HC.wall }, M.t(px, F + 0.1, Z));
  b.add(P.box(0.26, 0.04, 0.3), { color: HC.wallLight }, M.t(px, F + 0.22, Z));
  b.add(P.box(0.02, 0.14, 0.13), { color: c(0x2a1a12) }, M.t(px - 0.11 - 0.005, F + 0.08, Z));
  // The vent and its steam.
  const topY = F + 0.05 + R * dy;
  b.add(P.cyl(0.05, 0.06, 0.08, 8), { color: HC.wallLight }, M.t(X, topY + 0.02, Z));
  b.add(P.cyl(0.035, 0.035, 0.01, 8), { color: COAL }, M.t(X, topY + 0.066, Z));
  for (const [dx, y, r, seed] of [[0, 0.12, 0.06, 1], [0.03, 0.24, 0.08, 2], [0.07, 0.38, 0.1, 3], [0.1, 0.53, 0.08, 4]]) {
    b.add(lumpy(P.sphere(r, 1), 0.2, 500 + seed, 0.85), { color: c(0xeef0ec), leaf: CLOTH }, M.t(X + dx, topY + y, Z - dx * 0.4));
  }
  // The firebox behind the dome, its mouth to the front, and the fire in it.
  const fx = X + R + 0.0;
  b.add(P.box(0.14, 0.24, 0.26), { color: K.stoneDark }, M.t(fx, F + 0.12, Z));
  b.add(P.box(0.09, 0.1, 0.02), { color: COAL }, M.t(fx, F + 0.07, Z + 0.13 + 0.005));
  torches.push(v(fx, F + 0.28, Z));
  // Firewood and a water jar.
  for (const [i, y, zz] of [[0, 0.04, -0.46], [1, 0.04, -0.54], [2, 0.11, -0.5]] as const) b.add(P.cyl(0.035, 0.035, 0.3, 6), { color: i === 2 ? K.timber : c(0x7a5634) }, M.t(2.08, F + y, zz, 0, 0, Math.PI / 2));
  clayJar(b, 1.46, F, 0.36, 0.9, c(0x8a7a68));
};

/**
 * More beds (second): low woven reed screens at the foot of the outer new beds, and a clay lamp
 * burning on a post beside each.
 */
const bedScreens: Look = (b, _w, _d, torches) => {
  const F = HL.floor + 0.001, z = 1.52;
  for (const sx of [-1, 1]) {
    const x0 = sx * 0.9, x1 = sx * 1.23, n = 7, sw = Math.abs(x1 - x0) / n;
    for (let k = 0; k < n; k++) b.add(P.box(sw, 0.34, 0.025), { color: k % 2 ? K.thatch : K.thatchDark }, M.t(x0 + sx * sw * (k + 0.5), F + 0.19, z));
    b.add(P.box(Math.abs(x1 - x0) + 0.04, 0.03, 0.04), { color: HC.post }, M.t((x0 + x1) / 2, F + 0.375, z));
    b.add(P.cyl(0.022, 0.022, 0.4, 8), { color: HC.post }, M.t(x0, F + 0.2, z));
    // The lamp post at the screen's outer end.
    const lx = sx * 1.28;
    b.add(P.box(0.05, 0.74, 0.05), { color: HC.post }, M.t(lx, F + 0.37, z));
    torches.push(firePot(b, lx, F + 0.74, z, 0.55));
  }
};

// ---------------- Herbalist's Garden (4 × 4) ----------------

/**
 * Drying racks: a tall three-barred rack hung with herb bundles along the right of the yard, and
 * woven trays of herbs laid out to dry on the shelter's flat roof.
 */
const dryingRacks: Look = (b) => {
  const x = 1.7, z0 = 0.42, z1 = 1.48, base = 0.08;
  for (const z of [z0, z1]) b.add(P.cyl(0.035, 0.045, 1.22, 6), { color: K.timber }, M.t(x, base + 0.61, z));
  const greens = [c(0x5f7a48), c(0x78815b), c(0x8a7a3e), c(0x596b47)];
  [0.62, 0.92, 1.22].forEach((y, i) => {
    b.add(P.box(0.05, 0.05, z1 - z0 + 0.1), { color: K.timberDark }, M.t(x, base + y, (z0 + z1) / 2));
    for (let k = 0; k < 4; k++) herbBundle(b, x, base + y - 0.02, z0 + 0.17 + k * 0.24 + (i % 2) * 0.06, greens[(k + i) % 4], k);
  });
  // Trays on the roof (its surface at y 1.21).
  for (const [tx, tz, seed] of [[-1.12, -1.25, 1], [-0.72, -0.82, 2], [-0.36, -1.25, 3]]) {
    b.add(P.cyl(0.16, 0.15, 0.03, 12), { color: K.rope }, M.t(tx, 1.232, tz));
    b.add(P.torus(0.16, 0.014, 4, 14), { color: c(0xae8a50) }, M.t(tx, 1.25, tz, Math.PI / 2, 0, 0));
    for (let k = 0; k < 6; k++) {
      const a = k * 1.05 + seed, r = 0.03 + (k % 3) * 0.035;
      b.add(P.sphere(0.04, 0), { color: greens[(k + seed) % 4], leaf: 1 }, M.t(tx + Math.cos(a) * r, 1.26, tz + Math.sin(a) * r, 0, a, 0, 1.2, 0.35, 0.8));
    }
  }
};

/** Remedy shelf: a tall shelf against the shelter's front wall, right of the door, lined with jars, gourds and bottles. */
const remedyShelf: Look = (b) => {
  const x = -0.3, z = -0.38, w = 0.44, d = 0.15, base = 0.08;
  for (const px of [-1, 1]) for (const pz of [-1, 1]) b.add(P.box(0.03, 0.84, 0.03), { color: K.timberDark }, M.t(x + px * (w / 2 + 0.015), base + 0.42, z + pz * (d / 2 - 0.015)));
  const shelves = [0.06, 0.32, 0.58];
  for (const y of [...shelves, 0.83]) b.add(P.box(w, 0.025, d), { color: K.timber }, M.t(x, base + y, z));
  const top = (y: number) => base + y + 0.0125;
  // Bottom: two big jars.
  clayJar(b, x - 0.1, top(0.06), z, 0.9);
  clayJar(b, x + 0.1, top(0.06), z, 0.85, c(0x2f8f86));
  // Middle: a gourd, a black jar and a cream jar with a red band.
  b.add(P.sphere(0.055, 1), { color: c(0xc9a640) }, M.t(x - 0.14, top(0.32) + 0.05, z));
  b.add(P.sphere(0.035, 1), { color: c(0xc9a640) }, M.t(x - 0.14, top(0.32) + 0.125, z));
  clayJar(b, x, top(0.32), z, 0.7, INK);
  clayJar(b, x + 0.14, top(0.32), z, 0.65, AD.cream);
  // Top: little bottles and a bowl of dried leaves.
  for (const [dx, col] of [[-0.16, c(0x3c7a8a)], [-0.08, c(0xa74a39)], [0.0, c(0x3c7a8a)]] as [number, THREE.Color][]) {
    b.add(P.cyl(0.025, 0.03, 0.1, 7), { color: col }, M.t(x + dx, top(0.58) + 0.05, z));
    b.add(P.cyl(0.012, 0.012, 0.03, 5), { color: K.timber }, M.t(x + dx, top(0.58) + 0.115, z));
  }
  b.add(P.cyl(0.07, 0.045, 0.05, 9), { color: K.terracotta }, M.t(x + 0.12, top(0.58) + 0.025, z));
  b.add(P.sphere(0.05, 0), { color: c(0x7a8a46), leaf: 1 }, M.t(x + 0.12, top(0.58) + 0.06, z, 0, 0, 0, 1.1, 0.45, 1.1));
  // A row of bundles hung from the top board.
  for (let k = 0; k < 3; k++) herbBundle(b, x - 0.13 + k * 0.13, base + 0.82, z + d / 2 + 0.02, [c(0x5f7a48), c(0x8a7a3e), c(0x596b47)][k], k);
};

/**
 * Healer's lore: a stone altar at the front right with a painted screen-fold codex standing open
 * on it, a copal burner alight beside it, and a painted glyph panel on the shelter wall.
 */
const healersLore: Look = (b, _w, _d, torches) => {
  const base = 0.08, ax = 0.72, az = 1.66, aw = 0.62, ad = 0.26, ah = 0.26;
  b.add(P.box(aw, ah, ad), { color: K.stone }, M.t(ax, base + ah / 2, az));
  b.add(P.box(aw + 0.04, 0.04, ad + 0.04), { color: K.stoneDark }, M.t(ax, base + ah + 0.02, az));
  // Painted front: a teal panel with cream and red glyph blocks.
  const front = az + ad / 2;
  b.add(P.box(aw - 0.1, 0.12, 0.012), { color: TEAL }, M.t(ax, base + 0.12, front + 0.006));
  for (let k = 0; k < 4; k++) b.add(P.box(0.06, 0.06, 0.012), { color: k % 2 ? K.red : AD.cream }, M.t(ax - 0.18 + k * 0.12, base + 0.12, front + 0.018));
  // The codex: five painted panels folded zig-zag, standing on the altar top.
  const pw = 0.13, ph = 0.2, fold = 0.55, y = base + ah + 0.04 + ph / 2 + 0.002;
  const inks = [K.red, TEAL, c(0xe0b030), INK];
  const fx = pw * Math.cos(fold), fz = pw * Math.sin(fold);
  for (let k = 0; k < 5; k++) {
    // Panel k runs between fold lines k and k + 1, which alternate front and back.
    const dz = k % 2 ? -fz : fz, x0 = ax + (k - 2.5) * fx, z0 = az - fz / 2 + (k % 2 ? fz : 0);
    const m = M.t(x0 + fx / 2, y, z0 + dz / 2, 0, -Math.atan2(dz, fx), 0);
    b.add(P.box(pw, ph, 0.01), { color: AD.cream }, m);
    for (let j = 0; j < 3; j++) b.add(P.box(0.06, 0.04, 0.01), { color: inks[(k + j) % 4] }, m.clone().multiply(M.t(j === 1 ? 0.02 : -0.02, 0.06 - j * 0.06, 0.012)));
  }
  // The copal burner.
  b.add(P.cyl(0.05, 0.07, 0.2, 8), { color: K.stoneDark }, M.t(1.2, base + 0.1, az));
  torches.push(firePot(b, 1.2, base + 0.2, az, 0.7));
  // A painted glyph panel on the shelter wall, left of the door.
  const wz = -0.48;
  b.add(P.box(0.36, 0.32, 0.012), { color: AD.cream }, M.t(-1.2, 0.56, wz + 0.008));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    b.add(P.box(0.08, 0.1, 0.012), { color: inks[(i + j * 2) % 4] }, M.t(-1.31 + i * 0.11, 0.63 - j * 0.14, wz + 0.02));
  }
};

// ---------------- Herbal Garden (3 × 3) ----------------

/** More beds: a long narrow raised bed down each side of the garden, planted with flowering herbs. */
const moreBeds: Look = (b) => {
  for (const sx of [-1, 1]) {
    const x = sx * 1.31;
    b.add(P.box(0.2, 0.16, 2.1), { color: K.stoneDark }, M.t(x, 0.15, 0));
    b.add(P.box(0.15, 0.024, 2.02), { color: c(0x68513d) }, M.t(x, 0.236, 0));
    for (let k = 0; k < 6; k++) herb(b, x, 0.248, -0.85 + k * 0.34, 0.22 + (k % 2) * 0.06, k % 2 ? 0xe6d36a : 0xf0ece0);
  }
};

/**
 * Shade awning: a striped cream and red cloth awning over the back beds, sloping down to the front
 * on four posts (the front pair in the cross path), with a red valance; the front beds stay open.
 */
const shadeAwning: Look = (b) => {
  const X = 1.14, zb = -1.34, zf = 0.02, yb = 1.22, yf = 1.0, base = 0.06;
  for (const sx of [-1, 1]) for (const [z, y] of [[zb, yb], [zf, yf]] as const) b.add(P.cyl(0.032, 0.036, y - 0.08 - base, 8), { color: K.timberDark }, M.t(sx * X, (base + y - 0.08) / 2, z));
  const slope = Math.atan2(yb - yf, zf - zb), len = Math.hypot(yb - yf, zf - zb) + 0.1, zc = (zb + zf) / 2, yc = (yb + yf) / 2;
  for (const sx of [-1, 1]) b.add(P.box(0.045, 0.05, len), { color: K.timber }, M.t(sx * X, yc - 0.06, zc, slope, 0, 0));
  for (const z of [zb, zf]) b.add(P.box(2 * X + 0.04, 0.045, 0.045), { color: K.timber }, M.t(0, (z === zb ? yb : yf) - 0.07, z));
  // The cloth: stripes running down the slope, side by side.
  const n = 9, w = (2 * X + 0.1) / n;
  for (let k = 0; k < n; k++) b.add(P.box(w, 0.02, len), { color: k % 2 ? AD.cream : AD.red, leaf: CLOTH }, M.t(-X - 0.05 + w * (k + 0.5), yc - 0.02, zc, slope, 0, 0));
  const fz = zc + (len / 2) * Math.cos(slope), fy = yc - 0.02 - (len / 2) * Math.sin(slope);
  b.add(P.box(2 * X + 0.08, 0.08, 0.015), { color: AD.red, leaf: CLOTH }, M.t(0, fy - 0.05, fz + 0.01));
};

/**
 * Rare herbs: four painted clay planters along the front of the garden, either side of the pot,
 * each with a striking plant: a blue agave, a magenta flowering bush, golden marigolds and a dark
 * purple herb with white spikes.
 */
const rareHerbs: Look = (b) => {
  const planter = (x: number, z: number) => {
    b.add(P.cyl(0.14, 0.11, 0.18, 12), { color: AD.pot }, M.t(x, 0.07 + 0.09, z));
    b.add(P.cyl(0.146, 0.146, 0.04, 12), { color: TEAL }, M.t(x, 0.07 + 0.13, z));
    b.add(P.cyl(0.12, 0.12, 0.012, 12), { color: K.mud }, M.t(x, 0.07 + 0.186, z));
    return 0.07 + 0.19;
  };
  // Blue agave (far left).
  let y = planter(-1.05, 1.3);
  for (let k = 0; k < 9; k++) {
    const a = k * 0.7, tilt = k < 3 ? 0.15 : 0.6;
    b.add(P.cone(0.035, 0.32 - (k < 3 ? 0 : 0.06), 4), { color: k % 2 ? c(0x6fa3ae) : c(0x5a8c98), leaf: 1 }, M.t(-1.05, y, 1.3, Math.sin(a) * tilt, 0, -Math.cos(a) * tilt).multiply(M.t(0, 0.14, 0)));
  }
  // Magenta flowering bush.
  y = planter(-0.45, 1.3);
  b.add(lumpy(P.sphere(0.12, 1), 0.2, 41, 0.8), { color: c(0x2f5e2c), leaf: 1, sway: 0.15 }, M.t(-0.45, y + 0.1, 1.3));
  for (let k = 0; k < 9; k++) {
    const a = k * 2.4, r = 0.05 + (k % 3) * 0.03;
    b.add(P.sphere(0.04, 0), { color: k % 2 ? c(0xd8378f) : c(0xb0247a), leaf: 1, sway: 0.2 }, M.t(-0.45 + Math.cos(a) * r, y + 0.19 + (k % 3) * 0.025, 1.3 + Math.sin(a) * r));
  }
  // Golden marigolds.
  y = planter(0.45, 1.3);
  b.add(lumpy(P.sphere(0.11, 1), 0.2, 43, 0.7), { color: c(0x4c8a34), leaf: 1, sway: 0.15 }, M.t(0.45, y + 0.08, 1.3));
  for (let k = 0; k < 6; k++) {
    const a = k * 1.05, r = k ? 0.075 : 0;
    b.add(P.sphere(0.045, 1), { color: k % 2 ? c(0xf2a51e) : c(0xf5c030), leaf: 1, sway: 0.2 }, M.t(0.45 + Math.cos(a) * r, y + 0.17 + (k ? 0 : 0.04), 1.3 + Math.sin(a) * r));
  }
  // Dark purple herb with white flower spikes (far right).
  y = planter(1.05, 1.3);
  for (let k = 0; k < 6; k++) {
    const a = k * 1.05;
    b.add(P.sphere(0.06, 0), { color: k % 2 ? c(0x5b2d6b) : c(0x45204f), leaf: 1, sway: 0.15 }, M.t(1.05 + Math.cos(a) * 0.06, y + 0.06, 1.3 + Math.sin(a) * 0.06, 0, a, 0.5, 1.4, 0.4, 0.8));
  }
  for (const [dx, dz] of [[0, 0], [0.05, 0.03], [-0.05, -0.02]]) {
    b.add(P.cyl(0.008, 0.008, 0.2, 4), { color: c(0x4a3a50) }, M.t(1.05 + dx, y + 0.1, 1.3 + dz));
    b.add(P.cone(0.03, 0.12, 6), { color: c(0xf4f0f4), leaf: 1, sway: 0.2 }, M.t(1.05 + dx, y + 0.24, 1.3 + dz));
  }
};

export const SAFETY_LOOKS: Looks = {
  watchtower: [tallerTower, fireArrows, twinArchers],
  kennel: [biggerRun, trainingYard, secondDogHouse],
  warroom: [barracks, trainingGround, eaglePerch],
  healer: [bedShelves, steamBath, bedScreens],
  herbalist: [dryingRacks, remedyShelf, healersLore],
  herbalgarden: [moreBeds, shadeAwning, rareHerbs],
};
