import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS } from '../config';
import { M } from '../render/GeoBuilder';
import { stylisedMaterial } from '../render/materials';
import { bushGeometry, fernGeometry } from '../vegetation/models';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import { canoeLanding, landDistance, openSea, StackSite } from './SeaStacks';
import { SEA_SURFACE, Water } from './Water';

/**
 * The shape of the arch, in its own frame: t runs out to sea from the shore point (world units),
 * u across it, h is height above the sea. Boats' masts reach about 1.8 above the water.
 */
const A = {
  /** The ridge: highest just off the shore, sloping down into the headland behind. */
  ridgeTop: 5.4,
  plateau: [0.4, 2.8],
  landSlope: 0.85,
  landEnd: -6.4,
  /** The opening under the arch: straight sides up to the spring line, a round crown above. */
  gap0: 4.5,
  gap1: 8.5,
  spring: 1.0,
  crown: 3.3,
  archTop: 4.5,
  /** The outer leg, its top falling away to a blunt nose. */
  tip: 12.4,
  tipTop: 3.2,
  /** Half thickness of the wall: the ridge, over the arch and the outer leg; how it widens lower down. */
  halfRidge: 1.6,
  halfArch: 1.05,
  halfLeg: 1.2,
  batter: 0.13,
};
/** Grid the rock surface is built on (world units). */
const CELL = 0.32;
/** Thickness of the rock beds, and how steeply they dip toward the land. */
const BED = 0.66;
const BED_DIP = 0.22;
/** The sampled box (t, h, u). */
const BOX = { t0: A.landEnd - 0.8, t1: A.tip + 5.2, h0: -2.6, h1: A.ridgeTop + 0.9, u: 5.6 };

export interface ArchRock {
  /** Position in the arch's frame, radius, and top above the sea (stacks) or centre height (boulders). */
  t: number;
  u: number;
  r: number;
  h: number;
}

/** Where the arch stands: the shore point it runs out from, its seaward direction, and its parts. */
export interface ArchSite {
  x: number;
  z: number;
  sx: number;
  sz: number;
  /** The open water under the arch (along t), and where the outer leg ends. */
  gap0: number;
  gap1: number;
  tip: number;
  /** A small sea stack or two off the end, and boulders round the feet. */
  stacks: ArchRock[];
  boulders: ArchRock[];
}

// ---------- the rock as a distance field ----------

const hash3 = (x: number, y: number, z: number) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let fx = x - xi, fy = y - yi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy),
    l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz,
  ) * 2 - 1;
}
const smax = (a: number, b: number, k: number) => {
  const h = THREE.MathUtils.clamp(0.5 - (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h + k * h * (1 - h);
};
const smooth = (e0: number, e1: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Height of the crest above the sea along the formation: highest off the headland, falling seaward. */
function crest(t: number): number {
  if (t < A.plateau[0]) return A.ridgeTop - A.landSlope * (A.plateau[0] - t);
  if (t < A.plateau[1]) return A.ridgeTop - 0.25 * smooth(A.plateau[0], A.plateau[1], t);
  if (t < A.gap1) return A.ridgeTop - 0.25 + (A.archTop - A.ridgeTop + 0.25) * smooth(A.plateau[1], A.gap1, t);
  return A.archTop + (A.tipTop - A.archTop) * smooth(A.gap1, A.tip, t);
}

/** Sideways wander of the ridge's line (zero across the opening, so the channel stays straight). */
function bend(t: number): number {
  return 0.75 * Math.sin(t * 0.33 + 0.6) * (1 - 0.6 * Math.exp(-(((t - (A.gap0 + A.gap1) / 2) / 2.5) ** 2)));
}

/** Half thickness of the wall at t (at its crest). */
function halfWidth(t: number): number {
  if (t < A.gap0 - 1.2) return A.halfRidge;
  if (t < A.gap1 + 0.6) return A.halfRidge + (A.halfArch - A.halfRidge) * smooth(A.gap0 - 1.2, (A.gap0 + A.gap1) / 2, t);
  return A.halfArch + (A.halfLeg - A.halfArch) * smooth(A.gap1 + 0.6, A.gap1 + 2.2, t);
}

/**
 * Signed distance (roughly) to the rock: negative inside. A long wall of bedded rock with a rounded,
 * grassy crest, battered sides that spread at the foot into a wave-cut ledge with a notch eaten in at
 * the waterline, an arch-shaped opening right through it, and the small stacks and boulders.
 */
/** What the field needs at a given t, worked out once per column. */
interface Column { t: number; top: number; hw: number; bend: number; nose: number; jointA: number; jointB: number }
const col: Column = { t: NaN, top: 0, hw: 0, bend: 0, nose: 0, jointA: 0, jointB: 0 };
function column(t: number): Column {
  if (col.t === t) return col;
  col.t = t;
  // The crest rolls along; knobs of bare rock break through the turf (added per point below).
  col.top = crest(t) + 0.35 * vnoise(t * 0.32, 5.5, 0.5);
  col.hw = halfWidth(t);
  col.bend = bend(t);
  // Vertical joints and buttresses, different on each face.
  col.jointA = 0.24 * vnoise(t * 0.75, 0.5, 1.5);
  col.jointB = 0.24 * vnoise(t * 0.75, 0.5, 8.5);
  return col;
}

export function archField(s: ArchSite, t: number, h: number, u0: number): number {
  const C = column(t);
  // The ridge wanders a little, not ruler-straight.
  const u = u0 - C.bend;
  const top = C.top + 0.7 * Math.max(0, vnoise(t * 0.7, 9.5, u * 0.7) - 0.35);
  // Beds of rock, each standing out or set back a little from the next: ledges and overhangs that
  // run along the cliff, stepping crisply at the top of each bed. They dip gently toward the land.
  const bed = (h + BED_DIP * t) / BED, bi = Math.floor(bed), bf = bed - bi;
  const jut = (k: number) => (hash3(k, 3, 9) - 0.5) * 0.42;
  const step = jut(bi) + (jut(bi + 1) - jut(bi)) * smooth(0.8, 1, bf);
  const hw = C.hw + Math.max(0, top - h) * A.batter + step + (u > 0 ? C.jointA : C.jointB)
    + 0.55 * smooth(0.55, -0.35, h) // the ledge round the foot
    - 0.22 * Math.exp(-(((h - 0.2) / 0.3) ** 2)); // the notch the waves have cut
  const dSide = Math.abs(u) - hw;
  // A crisp edge to the turf, the crest only gently domed.
  const dTop = h - (top - 0.4 * Math.min(1, Math.abs(u) / (C.hw + 0.3)) ** 2);
  const nose = A.tip + Math.max(0, A.tipTop - h) * 0.32 + 0.4 * smooth(0.55, -0.35, h) + step;
  let d = smax(dSide, dTop, 0.32);
  d = smax(d, t - nose, 0.6);
  d = Math.max(d, A.landEnd - t, BOX.h0 + 0.6 - h);
  // The opening, a little wider where the sea has worked at it.
  const tc = (s.gap0 + s.gap1) / 2;
  const a = (s.gap1 - s.gap0) / 2 + 0.3 * Math.exp(-(((h - 0.1) / 0.6) ** 2)) - step * 0.6;
  const dh = h < A.spring ? Math.abs(t - tc) - a : (Math.hypot((t - tc) / a, (h - A.spring) / (A.crown - A.spring)) - 1) * Math.min(a, A.crown - A.spring);
  d = smax(d, -dh, 0.3);
  // Rough rock over all of it (only worth working out near the surface).
  if (d < 1.2) d += vnoise(t * 0.6, h * 0.6, u * 0.6) * 0.2 + vnoise(t * 1.5, h * 1.5, u * 1.5) * 0.08;
  // Stacks and boulders (skipped when plainly further away than the rock already found).
  for (const k of s.stacks) {
    const flat = Math.hypot(t - k.t, u0 - k.u);
    if (flat - k.r - 1.5 > d) continue;
    const r = k.r + Math.max(0, k.h - h) * 0.14 + 0.3 * smooth(0.5, -0.3, h) + step * 0.8;
    let ds = smax(flat - r, h - k.h, 0.3);
    ds = Math.max(ds, BOX.h0 + 0.6 - h) + vnoise(t * 0.9 + 7, h * 0.9, u0 * 0.9) * 0.16;
    d = Math.min(d, ds);
  }
  for (const k of s.boulders) {
    const flat = Math.hypot(t - k.t, u0 - k.u);
    if (flat - k.r - 0.15 > d) continue;
    const db = Math.hypot(flat, (h - k.h) * 1.25) - k.r + vnoise(t * 2.1, h * 2.1, u0 * 2.1 + 3) * 0.12;
    d = Math.min(d, db);
  }
  return d;
}

// ---------- placement ----------

/**
 * Find a place for the sea arch (deterministic from the seed): on the main island's coast within
 * sight of the village plain but clear of it, the settlers' canoe route, the lagoon, rivers, the
 * reefs and the sea stacks (`avoid`), where a ridge can run straight out from dry land into open
 * sea with deep, open water both sides of the opening for boats to sail through.
 */
export function placeSeaArch(w: World, seed: number, avoid: { x: number; z: number; r: number }[] = []): ArchSite | null {
  const rng = new RNG(seed * 61 + 17);
  const N = w.N;
  const sea = openSea(w);
  const dLand = landDistance(w);
  const landing = canoeLanding(w);
  const lag = w.lagoon;
  const isSea = (x: number, z: number) => {
    const i = w.cellIndexAt(x, z);
    return i >= 0 && sea[i] === 1 && w.blockFixed[i] === 0;
  };
  const isLand = (x: number, z: number) => {
    const i = w.cellIndexAt(x, z);
    return i >= 0 && w.layer[i] >= 1 && w.isle[i] === 1 && Number.isNaN(w.riverY[i]) && !w.canal[i] && !w.blockFixed[i] && w.heightAt(x, z) < SEA_SURFACE + 3;
  };
  const clearOf = (x: number, z: number, r: number) => avoid.every((a) => Math.hypot(a.x - x, a.z - z) > a.r + r);
  const tc = (A.gap0 + A.gap1) / 2;
  let best: ArchSite | null = null, bestScore = -Infinity;
  for (let cz = 8; cz < N - 8; cz++) for (let cx = 8; cx < N - 8; cx++) {
    const i = cz * N + cx;
    if (!sea[i] || dLand[i] !== 1) continue;
    const x = w.centerX(cx), z = w.centerZ(cz);
    const dm = Math.hypot(x - w.meadow.x, z - w.meadow.z);
    if (dm < w.meadow.r + 12 || dm > w.meadow.r + 70) continue;
    if (lag && Math.hypot(x - lag.x, z - lag.z) < lag.r + 10) continue;
    if (landing) {
      const ox = x - landing.x, oz = z - landing.z;
      const along = THREE.MathUtils.clamp(ox * landing.dx + oz * landing.dz, 0, 50);
      if (Math.hypot(ox - landing.dx * along, oz - landing.dz * along) < 12) continue;
    }
    // Seaward: away from the land nearby, which must all be the main island.
    let sx = 0, sz = 0, rock = 0, other = false;
    for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) {
      const j = w.idx(cx + dx, cz + dz);
      if (w.layer[j] < 1) continue;
      sx -= dx;
      sz -= dz;
      rock += w.rocky[j];
      if (w.isle[j] !== 1) other = true;
    }
    const sl = Math.hypot(sx, sz);
    if (other || sl < 1e-3) continue;
    sx /= sl;
    sz /= sl;
    const qx = -sz, qz = sx;
    const at = (t: number, u: number) => [x + sx * t + qx * u, z + sz * t + qz * u] as const;
    let ok = true;
    // The ridge's root runs back into dry land...
    for (let t = A.landEnd + 0.5; t <= -1 && ok; t += 0.5) for (let u = -2.5; u <= 2.5 && ok; u += 0.5) if (!isLand(...at(t, u))) ok = false;
    // ...the rest stands in open sea, clear of everything else...
    for (let t = 0.6; t <= A.tip + 1.2 && ok; t += 0.5) for (let u = -3.2; u <= 3.2 && ok; u += 0.5) {
      const [px, pz] = at(t, u);
      if (!isSea(px, pz) || !clearOf(px, pz, 0.5)) ok = false;
    }
    // ...and boats can come at the opening from either side and pass straight through.
    for (let u = -10; u <= 10 && ok; u += 0.5) for (const dt of [-1.2, 0, 1.2]) {
      const [px, pz] = at(tc + dt, u);
      if (!isSea(px, pz) || (Math.abs(u) < 4 && w.heightAt(px, pz) > SEA_SURFACE - 0.4)) ok = false;
    }
    if (!ok) continue;
    const score = -dm * 0.02 + Math.min(1, rock / 30) + rng.next() * 0.6;
    if (score <= bestScore) continue;
    bestScore = score;
    best = { x, z, sx, sz, gap0: A.gap0, gap1: A.gap1, tip: A.tip, stacks: [], boulders: [] };
  }
  if (!best) return null;
  const s = best;
  const inChannel = (t: number, u: number, r: number) => Math.abs(t - tc) < (A.gap1 - A.gap0) / 2 + 1.4 + r && Math.abs(u) < 10;
  const fits = (t: number, u: number, r: number) => {
    if (t < BOX.t0 + r || t > BOX.t1 - r || Math.abs(u) > BOX.u - r - 0.3 || inChannel(t, u, r)) return false;
    const [px, pz] = toWorld(s, t, u);
    return isSea(px, pz) && clearOf(px, pz, r);
  };
  // A sea stack broken off the end, and sometimes the stump of another.
  const side = rng.chance(0.5) ? 1 : -1;
  const st = { t: s.tip + rng.range(2.4, 3.0), u: side * rng.range(1.6, 2.6), r: rng.range(0.75, 0.95), h: rng.range(2.2, 2.9) };
  if (fits(st.t, st.u, st.r + 0.6)) s.stacks.push(st);
  const st2 = { t: s.tip + rng.range(1.0, 1.8), u: -side * rng.range(1.9, 2.6), r: rng.range(0.45, 0.6), h: rng.range(0.7, 1.2) };
  if (fits(st2.t, st2.u, st2.r + 0.5)) s.stacks.push(st2);
  // Boulders fallen round the feet (never in the channel under the arch).
  for (let k = 0; k < 90 && s.boulders.length < 9; k++) {
    const t = rng.range(0.4, s.tip + 1.5), u = (rng.chance(0.5) ? 1 : -1) * rng.range(2.3, 4.4);
    const r = rng.chance(0.4) ? rng.range(0.25, 0.4) : rng.range(0.45, 0.75);
    if (!fits(t, u, r)) continue;
    if (s.boulders.some((o) => Math.hypot(o.t - t, o.u - u) < o.r + r + 0.25) || s.stacks.some((o) => Math.hypot(o.t - t, o.u - u) < o.r + r + 0.8)) continue;
    s.boulders.push({ t, u, r, h: rng.range(-0.25, 0.1) + r * 0.3 });
  }
  return best;
}

/** World position of a point in the arch's frame, and back. */
function toWorld(s: ArchSite, t: number, u: number): [number, number] {
  return [s.x + s.sx * t - s.sz * u, s.z + s.sz * t + s.sx * u];
}
function toLocal(s: ArchSite, x: number, z: number): [number, number] {
  const dx = x - s.x, dz = z - s.z;
  return [dx * s.sx + dz * s.sz, -dx * s.sz + dz * s.sx];
}

/**
 * Grid cells the rock stands in, from the ground (or the sea) up past a ship's masthead: boats
 * steer round them and nothing can be built there. The water under the arch is left open.
 */
export function archCells(w: World, s: ArchSite): number[] {
  const out: number[] = [];
  const [cx, cz] = w.cellOf(s.x, s.z);
  const R = Math.ceil(Math.hypot(BOX.t1, BOX.u)) + 1;
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    if (!w.inBounds(cx + dx, cz + dz)) continue;
    const x = w.centerX(cx + dx), z = w.centerZ(cz + dz);
    const [t, u] = toLocal(s, x, z);
    if (t < BOX.t0 || t > BOX.t1 || Math.abs(u) > BOX.u) continue;
    const g = Math.max(-0.15, w.heightAt(x, z) - SEA_SURFACE + 0.1);
    for (let h = g; h <= g + 2.4; h += 0.4) {
      if (archField(s, t, h, u) < 0.15) {
        out.push(w.idx(cx + dx, cz + dz));
        break;
      }
    }
  }
  return out;
}

// ---------- the mesh ----------

/**
 * Polygonise the rock with surface nets over the sampled field, as flat facets (low-poly, like the
 * rest of the island's rock), each facet coloured from where it sits and which way it faces.
 * Also returns the flat, upward-facing facets high on the crest (where scrub can grow).
 */
function buildRock(s: ArchSite, colour: (t: number, h: number, u: number, n: THREE.Vector3) => THREE.Color): { geo: THREE.BufferGeometry; tops: { t: number; h: number; u: number }[] } {
  const nt = Math.ceil((BOX.t1 - BOX.t0) / CELL) + 1, nh = Math.ceil((BOX.h1 - BOX.h0) / CELL) + 1, nu = Math.ceil((2 * BOX.u) / CELL) + 1;
  const F = new Float32Array(nt * nh * nu);
  const id = (i: number, j: number, k: number) => i + nt * (j + nh * k);
  for (let i = 0; i < nt; i++) for (let j = 0; j < nh; j++) for (let k = 0; k < nu; k++) {
    F[id(i, j, k)] = archField(s, BOX.t0 + i * CELL, BOX.h0 + j * CELL, -BOX.u + k * CELL);
  }
  // One vertex per cube the surface passes through, at the mean of its edge crossings.
  const vIndex = new Int32Array((nt - 1) * (nh - 1) * (nu - 1)).fill(-1);
  const cid = (i: number, j: number, k: number) => i + (nt - 1) * (j + (nh - 1) * k);
  const V: number[] = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const val = new Float32Array(8);
  for (let k = 0; k < nu - 1; k++) for (let j = 0; j < nh - 1; j++) for (let i = 0; i < nt - 1; i++) {
    let inside = 0;
    for (let q = 0; q < 8; q++) {
      val[q] = F[id(i + corners[q][0], j + corners[q][1], k + corners[q][2])];
      if (val[q] < 0) inside++;
    }
    if (inside === 0 || inside === 8) continue;
    let ax = 0, ay = 0, az = 0, n = 0;
    for (const [a, b] of edges) {
      if ((val[a] < 0) === (val[b] < 0)) continue;
      const f = val[a] / (val[a] - val[b]);
      ax += corners[a][0] + (corners[b][0] - corners[a][0]) * f;
      ay += corners[a][1] + (corners[b][1] - corners[a][1]) * f;
      az += corners[a][2] + (corners[b][2] - corners[a][2]) * f;
      n++;
    }
    vIndex[cid(i, j, k)] = V.length / 3;
    V.push(BOX.t0 + (i + ax / n) * CELL, BOX.h0 + (j + ay / n) * CELL, -BOX.u + (k + az / n) * CELL);
  }
  const W = new Float32Array(V.length);
  for (let v = 0; v < V.length; v += 3) {
    const [x, z] = toWorld(s, V[v], V[v + 2]);
    W[v] = x; W[v + 1] = SEA_SURFACE + V[v + 1]; W[v + 2] = z;
  }
  // A quad across every grid edge the surface crosses, facing out of the rock.
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  const tops: { t: number; h: number; u: number }[] = [];
  const axisDir = [new THREE.Vector3(s.sx, 0, s.sz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-s.sz, 0, s.sx)];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c2 = new THREE.Vector3(), nrm = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const tri = (p: number, q: number, r: number) => {
    a.fromArray(W, p * 3); b.fromArray(W, q * 3); c2.fromArray(W, r * 3);
    nrm.crossVectors(e1.subVectors(b, a), e2.subVectors(c2, a));
    if (nrm.lengthSq() < 1e-10) return;
    nrm.normalize();
    const lt = (V[p * 3] + V[q * 3] + V[r * 3]) / 3, lh = (V[p * 3 + 1] + V[q * 3 + 1] + V[r * 3 + 1]) / 3, lu = (V[p * 3 + 2] + V[q * 3 + 2] + V[r * 3 + 2]) / 3;
    const cc = colour(lt, lh, lu, nrm);
    for (const v of [a, b, c2]) {
      pos.push(v.x, v.y, v.z);
      nor.push(nrm.x, nrm.y, nrm.z);
      col.push(cc.r, cc.g, cc.b);
    }
    if (nrm.y > 0.8 && lh > 2.4) tops.push({ t: lt, h: lh, u: lu });
  };
  const out = new THREE.Vector3();
  const quad = (q: number[]) => {
    // Which way the quad faces, from its diagonals (sound even when it is folded).
    a.fromArray(W, q[0] * 3); c2.fromArray(W, q[2] * 3); e1.subVectors(c2, a);
    a.fromArray(W, q[1] * 3); c2.fromArray(W, q[3] * 3); e2.subVectors(c2, a);
    nrm.crossVectors(e1, e2);
    if (nrm.dot(out) < 0) q.reverse();
    // Split along the shorter diagonal.
    const d02 = a.fromArray(W, q[0] * 3).distanceToSquared(b.fromArray(W, q[2] * 3));
    const d13 = a.fromArray(W, q[1] * 3).distanceToSquared(b.fromArray(W, q[3] * 3));
    if (d02 <= d13) { tri(q[0], q[1], q[2]); tri(q[0], q[2], q[3]); }
    else { tri(q[1], q[2], q[3]); tri(q[1], q[3], q[0]); }
  };
  for (let k = 0; k < nu; k++) for (let j = 0; j < nh; j++) for (let i = 0; i < nt; i++) {
    const f0 = F[id(i, j, k)];
    for (let ax = 0; ax < 3; ax++) {
      // The edge must lie inside the grid with a cube on every side of it.
      if (ax === 0 ? i >= nt - 1 || j < 1 || k < 1 || j >= nh - 1 || k >= nu - 1
        : ax === 1 ? j >= nh - 1 || i < 1 || k < 1 || i >= nt - 1 || k >= nu - 1
        : k >= nu - 1 || i < 1 || j < 1 || i >= nt - 1 || j >= nh - 1) continue;
      const f1 = F[ax === 0 ? id(i + 1, j, k) : ax === 1 ? id(i, j + 1, k) : id(i, j, k + 1)];
      if ((f0 < 0) === (f1 < 0)) continue;
      // The four cubes round the edge, in order round it.
      const cubes = ax === 0 ? [cid(i, j - 1, k - 1), cid(i, j, k - 1), cid(i, j, k), cid(i, j - 1, k)]
        : ax === 1 ? [cid(i - 1, j, k - 1), cid(i - 1, j, k), cid(i, j, k), cid(i, j, k - 1)]
        : [cid(i - 1, j - 1, k), cid(i, j - 1, k), cid(i, j, k), cid(i - 1, j, k)];
      const q = cubes.map((cI) => vIndex[cI]);
      if (q.some((v) => v < 0)) continue;
      out.copy(axisDir[ax]).multiplyScalar(f0 < 0 ? 1 : -1);
      quad(q);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aVeg', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setAttribute('aMat', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
  g.computeBoundingSphere();
  return { geo: g, tops };
}

const c = (hex: number) => new THREE.Color(hex);
const PAL = {
  bed: [c(0xbcb3a5), c(0x9e958a), c(0xc9bfae), c(0x928a80), c(0xb0a596), c(0xa89c8a)],
  under: c(0x6f6964),
  wet: c(0x4c4b4d),
  weed: [c(0x2f4a22), c(0x4c6e2b), c(0x6f8f3a)],
  grass: [c(COLORS.grassOlive), c(0x6a8a3b), c(COLORS.grass), c(COLORS.grassBright)],
  lip: c(0x4a5f2a),
};

/**
 * A great sea arch, like Durdle Door: a long wall of bedded, pale rock running out from a headland,
 * its rounded crest grassed over, that arches over a channel of open water to an outer leg, with a
 * broken-off stack beyond it, boulders round its feet and foam where the sea breaks on it. Boats sail
 * through under the arch; the rock itself is solid. It is a permanent landmark: the ground under it
 * cannot be sculpted or built on.
 */
export class SeaArch {
  readonly group = new THREE.Group();
  readonly site: ArchSite | null;
  private blocked: number[] = [];

  constructor(private world: World, seed: number, avoid: { x: number; z: number; r: number }[] = []) {
    const w = world;
    this.site = placeSeaArch(w, seed, avoid);
    const s = this.site;
    if (!s) return;
    const rng = new RNG(seed * 97 + 5);
    const tmp = new THREE.Color();
    const { geo, tops } = buildRock(s, (t, h, u, n) => {
      const v = hash3(Math.round(t * 2.2), Math.round(h * 2.2), Math.round(u * 2.2));
      const lo = vnoise(t * 0.3, h * 0.3, u * 0.3);
      // Each bed its own shade of stone, varying slowly along it.
      const bi = Math.floor((h + BED_DIP * t) / BED);
      tmp.copy(PAL.bed[Math.floor(hash3(bi, 11, 5) * PAL.bed.length)]).multiplyScalar(0.95 + lo * 0.06 + v * 0.04);
      // Rain-stained streaks down the faces; overhangs and the underside of the arch in shadow.
      if (Math.abs(n.y) < 0.35 && vnoise(t * 1.6, 0.5, u * 1.6) > 0.35) tmp.multiplyScalar(0.9);
      if (n.y < -0.25) tmp.lerp(PAL.under, Math.min(1, (-n.y - 0.25) * 1.6));
      else if (n.y > 0.55) tmp.multiplyScalar(1.05);
      // Wet and dark where the sea washes it, and green with weed in a ragged band round the waterline.
      if (h < 0.45) tmp.lerp(PAL.wet, THREE.MathUtils.clamp((0.45 - h) * 1.4, 0, 0.7));
      const ragged = 0.55 - 0.4 * hash3(Math.round(t * 2.4), 7, Math.round(u * 2.4));
      if (h > -0.5 && h < ragged && hash3(Math.round(t * 1.7), 3, Math.round(u * 1.7 + h)) < 0.72) {
        tmp.copy(PAL.weed[h < 0 ? 0 : v < 0.5 ? 1 : 2]).multiplyScalar(0.9 + v * 0.2);
      }
      // Turf over the crest with a dark lip where it rolls over the edge; tufts on the wider ledges.
      const crestH = crest(t) - 1.1;
      if (h > 1.6 && h > crestH && n.y > 0.5) tmp.copy(PAL.grass[Math.floor((lo * 0.5 + 0.5) * 3.99)]).multiplyScalar(0.94 + v * 0.1);
      else if (h > 1.6 && h > crestH && n.y > 0.2) tmp.copy(PAL.lip).multiplyScalar(0.92 + v * 0.12);
      else if (h > 1.2 && n.y > 0.72 && vnoise(t * 0.7, h * 0.7, u * 0.7) > 0.1) tmp.copy(PAL.grass[2]).multiplyScalar(0.9 + v * 0.1);
      return tmp;
    });
    const mesh = new THREE.Mesh(geo, stylisedMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'seaArch';
    this.group.add(mesh);
    // Bushes and ferns on the grassy crest.
    const plants: THREE.BufferGeometry[] = [];
    const picked: { t: number; u: number }[] = [];
    for (let k = 0; k < 500 && picked.length < 18 && tops.length; k++) {
      const p = tops[Math.floor(rng.next() * tops.length)];
      if (picked.some((o) => Math.hypot(o.t - p.t, o.u - p.u) < 1.1)) continue;
      picked.push(p);
      const [x, z] = toWorld(s, p.t, p.u);
      const fern = rng.chance(0.55);
      const g = fern ? fernGeometry(false, 800 + k) : bushGeometry(rng.chance(0.2), true, 800 + k);
      const sc = fern ? rng.range(0.6, 0.9) : rng.range(0.7, 1.05);
      plants.push(g.applyMatrix4(M.t(x, SEA_SURFACE + p.h - 0.05, z, 0, rng.next() * 6.28, 0, sc)));
    }
    const merged = plants.length ? mergeGeometries(plants.map((g) => (g.index ? g.toNonIndexed() : g))) : null;
    if (merged) {
      const scrub = new THREE.Mesh(merged, stylisedMaterial());
      scrub.castShadow = true;
      scrub.name = 'seaArchPlants';
      this.group.add(scrub);
    }
    // A permanent landmark: solid to boats and walkers, never built on.
    this.blocked = archCells(w, s);
    for (const i of this.blocked) w.blockFixed[i] = 1;
    this.stampFoam();
  }

  /** Grid cells the rock stands in (boats steer round them; the channel under the arch is left open). */
  cells(): number[] {
    return this.blocked;
  }

  /** Is this point on or under the formation (so the ground there must not be sculpted)? */
  covers(x: number, z: number): boolean {
    const s = this.site;
    if (!s) return false;
    const [t, u] = toLocal(s, x, z);
    if (t < BOX.t0 - 0.8 || t > BOX.t1 || Math.abs(u) > BOX.u + 0.8) return false;
    for (let h = -0.5; h <= A.ridgeTop; h += 0.5) if (archField(s, t, h, u) < 0.8) return true;
    return false;
  }

  /**
   * The faces the sea breaks on, as stack sites for the surf: the blunt nose of the outer leg
   * (with the boulders off it), both flanks of the ridge, and the stacks beyond.
   */
  surfSites(): StackSite[] {
    const s = this.site;
    if (!s) return [];
    const rock = (t: number, u: number, r: number, top: number) => {
      const [x, z] = toWorld(s, t, u + bend(t));
      return { x, z, r, top };
    };
    const out: StackSite[] = [];
    const nose = rock(s.tip - 0.9, 0, 1.5, A.tipTop - 0.4);
    const near = s.boulders.filter((b) => b.t > s.gap1).map((b) => { const [x, z] = toWorld(s, b.t, b.u); return { x, z, r: b.r, top: b.h + b.r * 0.6 }; });
    out.push({ x: nose.x, z: nose.z, sx: s.sx, sz: s.sz, main: nose, rocks: near });
    for (const side of [-1, 1]) {
      const f = rock(1.8, side * 1.6, 1.0, A.ridgeTop - 1);
      out.push({ x: f.x, z: f.z, sx: -s.sz * side, sz: s.sx * side, main: f, rocks: [] });
    }
    for (const k of s.stacks) {
      const [x, z] = toWorld(s, k.t, k.u);
      out.push({ x, z, sx: s.sx, sz: s.sz, main: { x, z, r: k.r + 0.25, top: k.h }, rocks: [] });
    }
    return out;
  }

  /** Land cells under the rock (the plants there are cleared away). */
  landCells(): number[] {
    return this.blocked.filter((i) => this.world.layer[i] >= 1);
  }

  private stampFoam(): void {
    const w = this.world, s = this.site!;
    const [cx, cz] = w.cellOf(s.x, s.z);
    const R = Math.ceil(Math.hypot(BOX.t1, BOX.u)) + 2;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      if (!w.inBounds(cx + dx, cz + dz)) continue;
      const i = w.idx(cx + dx, cz + dz);
      if (w.layer[i] > 0) continue;
      const [t, u] = toLocal(s, w.centerX(cx + dx), w.centerZ(cz + dz));
      if (t < BOX.t0 || t > BOX.t1 + 1.5 || Math.abs(u) > BOX.u + 1.5) continue;
      const d = archField(s, t, 0.05, u);
      if (d < 1.3) w.foam[i] = Math.max(w.foam[i], THREE.MathUtils.clamp(1 - Math.max(0, d) / 1.3, 0, 0.85));
    }
  }

  /** Push the stamped foam into the sea's texture. */
  refreshWater(water: Water): void {
    const s = this.site;
    if (!s) return;
    const [cx, cz] = this.world.cellOf(s.x, s.z);
    const R = Math.ceil(Math.hypot(BOX.t1, BOX.u)) + 3, N = this.world.N;
    water.updateHeight(Math.max(0, cx - R), Math.max(0, cz - R), Math.min(N - 1, cx + R), Math.min(N - 1, cz + R));
  }
}
