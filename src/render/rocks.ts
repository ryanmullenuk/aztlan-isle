import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { RNG } from '../world/rng';
import { ColorFn } from './GeoBuilder';

/**
 * Chunky faceted rocks in the style of the island's cliffs: angular prisms with a chamfered,
 * tilted top, flat-shaded, warm grey with lighter sunlit tops, moss on the flatter crowns and a
 * darker wet band where water washes them. Used for the waterfall's rock columns and the coastal
 * rocks the waves break on.
 */

const c = (h: number) => new THREE.Color(h);
export const ROCK_PAL = {
  dark: c(0x857d76),
  side: c(0x9a928b),
  light: c(0xb3aba2),
  top: c(0xc6beb2),
  moss: c(0x5d7a36),
  mossLight: c(0x7b9443),
  wet: c(0x4a4a4e),
};

const hash = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * One rock: a 5-7 sided prism, base ring slightly below y = 0 (so it sits embedded), a waist
 * ring, and a smaller, tilted top ring with a low peak. Unit size: about 2 across and 1 tall
 * (scale it with a matrix). Non-indexed with flat normals.
 */
export function angularRockGeometry(seed: number, opts: { sides?: number; taper?: number; tilt?: number } = {}): THREE.BufferGeometry {
  const r = new RNG(seed);
  const n = opts.sides ?? r.int(5, 7);
  const taper = opts.taper ?? r.range(0.55, 0.78);
  const tilt = opts.tilt ?? 0.14;
  const a0 = r.range(0, Math.PI * 2);
  const ring = (y: number, rad: number, jy: number) => {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * Math.PI * 2 + r.range(-0.25, 0.25);
      const rr = rad * r.range(0.82, 1.12);
      pts.push(new THREE.Vector3(Math.cos(a) * rr, y + r.range(-jy, jy), Math.sin(a) * rr));
    }
    return pts;
  };
  const base = ring(-0.25, 1.0, 0.02);
  const waist = ring(r.range(0.5, 0.72), r.range(0.92, 1.02), 0.06);
  // Tilted top: one side higher than the other, like a broken column.
  const tx = r.range(-1, 1), tz = r.range(-1, 1);
  const top = ring(1, taper, 0.05).map((p) => p.setY(p.y + (p.x * tx + p.z * tz) * tilt));
  const peak = new THREE.Vector3(r.range(-0.12, 0.12), 1.04 + r.range(0, 0.06), r.range(-0.12, 0.12));
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c2: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c2.x, c2.y, c2.z);
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    // Sides (two bands), wound so faces point outward.
    tri(base[k], waist[k2], base[k2]);
    tri(base[k], waist[k], waist[k2]);
    tri(waist[k], top[k2], waist[k2]);
    tri(waist[k], top[k], top[k2]);
    // Top facets up to the low peak.
    tri(top[k], peak, top[k2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export interface BoulderOptions {
  /** How many points the hull is wrapped round (more: rounder, smaller facets). */
  points?: number;
  /** Height above the ground (the footprint is about 2 across). */
  height?: number;
  /** 0..1: how much of the top is sheared off flat. */
  flat?: number;
  /** How far it is bedded into the ground below y = 0. */
  sink?: number;
  /** Lean: how far the top is pushed over, in x and z. */
  lean?: [number, number];
  /** Keep only one side of the stone (a boulder split in two): -1 the -x half, 1 the +x half. */
  half?: -1 | 1;
  /** Half the width of the crack between the halves. */
  gap?: number;
  /** How many planes it has broken along (big flat faces); random 1-3 by default. */
  fractures?: number;
}

/**
 * A weathered boulder: the convex hull of points scattered over a lopsided, squashed ellipsoid,
 * so it has big irregular facets like real stone, sheared flat underneath where it beds into the
 * ground. Unit footprint (radius about 1 in x and z), `height` tall.
 */
export function boulderGeometry(seed: number, o: BoulderOptions = {}): THREE.BufferGeometry {
  const r = new RNG(seed);
  const n = o.points ?? r.int(18, 26);
  const H = o.height ?? 0.8;
  const sink = o.sink ?? 0.18;
  const flatTop = H * (1 - (o.flat ?? r.range(0, 0.25)) * 0.35);
  const [lx, lz] = o.lean ?? [r.range(-0.15, 0.15), r.range(-0.15, 0.15)];
  const gap = o.gap ?? 0.05;
  const pts: THREE.Vector3[] = [];
  const cy = H * 0.42;
  for (let k = 0; k < n; k++) {
    // Spread evenly over the sphere (golden-angle spiral), then jostled.
    const yk = 1 - ((k + 0.5) / n) * 2, ring = Math.sqrt(1 - yk * yk);
    const a = k * 2.39996 + r.range(-0.45, 0.45);
    const j = r.range(0.8, 1.12);
    const y = THREE.MathUtils.clamp(cy + yk * H * 0.62 * j, -sink, flatTop);
    const t = (y + sink) / (H + sink);
    let x = Math.cos(a) * ring * j + lx * t, z = Math.sin(a) * ring * j * r.range(0.82, 0.98) + lz * t;
    if (o.half) x = o.half < 0 ? Math.min(x, -gap) : Math.max(x, gap);
    pts.push(new THREE.Vector3(x, y, z));
  }
  // A flat bed underneath, so it never shows daylight below.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + r.range(-0.2, 0.2);
    let x = Math.cos(a) * 0.82, z = Math.sin(a) * 0.74;
    if (o.half) x = o.half < 0 ? Math.min(x, -gap) : Math.max(x, gap);
    pts.push(new THREE.Vector3(x, -sink, z));
  }
  // Fractures: a few planes the stone has broken along, leaving big flat faces.
  const nf = o.fractures ?? r.int(1, 3);
  for (let f = 0; f < nf; f++) {
    const a = r.range(0, Math.PI * 2), up = r.range(-0.1, 0.75);
    const nrm = new THREE.Vector3(Math.cos(a) * Math.sqrt(1 - up * up), up, Math.sin(a) * Math.sqrt(1 - up * up));
    const d = r.range(0.55, 0.8) * (Math.abs(nrm.y) * H * 0.62 + (1 - Math.abs(nrm.y)) * 0.9);
    const c = new THREE.Vector3(0, cy, 0);
    for (const p of pts) {
      if (p.y <= -sink + 1e-3) continue;
      const over = p.clone().sub(c).dot(nrm) - d;
      if (over > 0) p.addScaledVector(nrm, -over);
    }
  }
  const g = new ConvexGeometry(pts);
  g.deleteAttribute('uv');
  return g;
}

/**
 * Split every triangle of a flat-faceted (non-indexed) rock into 4^levels smaller ones in the same
 * plane: the shape is unchanged, but there are vertices enough for weed and moss to be painted in
 * patches across big faces.
 */
export function subdivideFacets(g: THREE.BufferGeometry, levels = 1): THREE.BufferGeometry {
  let pos = Array.from(g.getAttribute('position').array as Float32Array);
  for (let l = 0; l < levels; l++) {
    const out: number[] = [];
    for (let i = 0; i < pos.length; i += 9) {
      const a = pos.slice(i, i + 3), b = pos.slice(i + 3, i + 6), c2 = pos.slice(i + 6, i + 9);
      const m = (u: number[], v: number[]) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2, (u[2] + v[2]) / 2];
      const ab = m(a, b), bc = m(b, c2), ca = m(c2, a);
      out.push(...a, ...ab, ...ca, ...ab, ...b, ...bc, ...ca, ...bc, ...c2, ...ab, ...bc, ...ca);
    }
    pos = out;
  }
  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  r.computeVertexNormals();
  return r;
}

/** Sea moss: weed and algae growing on a rock round the waterline (y0 to y1), on this share of it. */
export interface SeaMoss {
  y0: number;
  y1: number;
  amount: number;
}
const SEA_MOSS = { dark: c(0x2f4a22), mid: c(0x4c6e2b), light: c(0x6f8f3a) };
const LICHEN = { pale: c(0xc9c4a0), grey: c(0xd6d2c4) };

/**
 * Colour for faceted rocks (world-space position and normal; best used with GeoBuilder's
 * `facet` option so each facet is one crisp colour): warm grey sides darkening underneath,
 * lighter sunlit tops, each face its own shade, flecks of pale and golden lichen, moss on the
 * flatter crowns (amount 0..1), darker below `wetY`, and optional weed round the waterline.
 */
export function rockColor(moss = 0.5, wetY = -Infinity, seaMoss?: SeaMoss): ColorFn {
  return (p, n) => {
    const up = n.y * 0.5 + 0.5;
    // One shade per face: keyed on which way it faces (and coarsely where), so the small facets a
    // big face is split into all match, while neighbouring faces differ.
    const face = hash(Math.round(n.x * 6) + Math.floor(p.x * 0.7) * 13, Math.round(n.y * 6) + Math.floor(p.y * 0.7) * 7, Math.round(n.z * 6) + Math.floor(p.z * 0.7) * 5);
    const v = hash(Math.floor(p.x * 3), Math.floor(p.y * 3), Math.floor(p.z * 3));
    let col = ROCK_PAL.dark.clone().lerp(ROCK_PAL.side, Math.min(1, up * 1.3)).lerp(ROCK_PAL.light, Math.max(0, up - 0.6) * 1.6);
    if (n.y > 0.8) col.lerp(ROCK_PAL.top, 0.5);
    col.multiplyScalar(0.9 + face * 0.14 + v * 0.03);
    // Lichen flecks on faces that see the sky.
    const lk = hash(Math.round(p.x * 2.6), Math.round(p.y * 2.6) + 11, Math.round(p.z * 2.6));
    if (n.y > -0.05 && p.y > wetY + 0.15) {
      if (lk < 0.07) col.lerp(LICHEN.pale, 0.6);
      else if (lk < 0.1) col.lerp(LICHEN.grey, 0.55);
    }
    if (moss > 0 && n.y > 0.62 && hash(Math.round(p.x * 1.7), 0, Math.round(p.z * 1.7)) < moss) col.lerp(ROCK_PAL.moss.clone().lerp(ROCK_PAL.mossLight, v), 0.55 + 0.3 * face);
    if (p.y < wetY) col.lerp(ROCK_PAL.wet, 0.55);
    // Patchy green weed in a ragged band round the waterline, thickest low down.
    if (seaMoss && p.y > seaMoss.y0 && p.y < seaMoss.y1) {
      const ragged = seaMoss.y1 - (seaMoss.y1 - seaMoss.y0) * 0.45 * hash(Math.round(p.x * 2.3), 7, Math.round(p.z * 2.3));
      if (p.y < ragged && hash(Math.round(p.x * 1.6), 3, Math.round(p.z * 1.6)) < seaMoss.amount) {
        const low = 1 - (p.y - seaMoss.y0) / (seaMoss.y1 - seaMoss.y0);
        col = SEA_MOSS.mid.clone().lerp(low > 0.6 ? SEA_MOSS.dark : SEA_MOSS.light, Math.abs(low - 0.5) + v * 0.3);
      }
    }
    return col;
  };
}
