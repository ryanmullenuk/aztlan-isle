import * as THREE from 'three';
import { GeoBuilder, M, P } from '../render/GeoBuilder';
import { HabitatInstances, habitatFit, habitatMaterial, habitatPreset } from './Habitat';
import { PresetName } from '../config';
import { Simplex2 } from '../world/noise';
import { RNG, hash2 } from '../world/rng';
import { World } from '../world/World';
import { BASE_PALETTE, branchingCoral, coralBaseGeometry, tableCoral } from './coralModels';
import { bakeCreature, CreatureName, loadCreature, simplifyGeometry } from './creatureAssets';

/**
 * The richer sea floor: large reef fields (elkhorn, pillar, plate, mushroom, finger and boulder
 * corals, sea fans, soft corals, barrel/vase/ball sponges, rubble, starfish, urchins and giant
 * clams), kelp forests and seagrass meadows across the shallow shelf round every island.
 *
 * Render-only and never saved. Everything is derived from the seed alone (seeded noise picks the
 * fields; a hash of each grid point picks what grows there), so editing the terrain in one place
 * never reshuffles anything else: the terrain only decides which of those fixed candidates show
 * (habitatFit: open sea, shelf depth, not blocked, gentle slope, tops under the surface).
 */

const ss = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

/**
 * How strongly a big reef field grows here (0..1), from the island's seeded noise (the terrain's
 * own Simplex2, seed * 7 + 3, which also tints the reef rock under the fields). Patchy outlines
 * several to ~15 units across; 1 in the dense middle of a field.
 */
export function reefField(n: Simplex2, x: number, z: number): number {
  return ss(0.08, 0.42, n.noise(x * 0.045 + 71, z * 0.045 - 23) * 0.72 + n.noise(x * 0.14 - 11, z * 0.14 + 57) * 0.28);
}
/** Kelp forests (0..1): smaller stands, mostly out on the deeper shelf. */
function kelpField(n: Simplex2, x: number, z: number): number {
  return ss(0.42, 0.62, n.noise(x * 0.07 - 131, z * 0.07 + 89) * 0.75 + n.noise(x * 0.23 + 5, z * 0.23 + 201) * 0.25);
}
/** Seagrass meadows (0..1): where the terrain paints its green seagrass on the sandy shelf. */
function meadowField(n: Simplex2, x: number, z: number): number {
  return ss(0.3, 0.5, n.noise(x * 0.11 + 17, z * 0.11 - 9) * 0.7 + n.noise(x * 0.37, z * 0.37) * 0.3);
}

// ---------------- Models (white/grey: the instance colour gives the hue) ----------------

const WHITE = 0xf4f0ea;
const lerpHex = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), THREE.MathUtils.clamp(t, 0, 1));

/** Branching coral: rounded limbs leaning out and curving up, forking once; nods a little in the current. */
function elkhorn(): THREE.BufferGeometry {
  return branchingCoral(23, { height: 0.46, primaries: 3, depth: 1, smooth: true, sway: (p) => Math.max(0, p.y) * 0.3 });
}

/** Pillar coral: a stand of upright, fuzzy-topped columns. */
function pillar(): THREE.BufferGeometry {
  const b = new GeoBuilder(), rng = new RNG(31);
  for (let k = 0; k < 5; k++) {
    const a = rng.range(0, Math.PI * 2), d = k === 0 ? 0 : rng.range(0.07, 0.14);
    const x = Math.cos(a) * d, z = Math.sin(a) * d, r = rng.range(0.042, 0.058), h = (k === 0 ? 0.62 : rng.range(0.3, 0.52));
    const m = M.t(x, 0, z, rng.range(-0.08, 0.08), 0, rng.range(-0.08, 0.08));
    b.add(P.cyl(r * 0.95, r, h, 6, true), { color: (p) => lerpHex(0xb8b0a0, 0xe8e2d6, p.y / 0.6) }, m.clone().multiply(M.t(0, h / 2, 0)));
    b.add(P.cyl(r * 0.55, r * 0.95, 0.045, 6), { color: WHITE }, m.clone().multiply(M.t(0, h + 0.022, 0)));
  }
  return b.build();
}

/** Table coral: rigid, dished tables with uneven edges, flaring up from a stout stalk. */
function plates(): THREE.BufferGeometry {
  return tableCoral(41, true);
}

/** Boulder / brain mound: a big lumpy dome with meandering grooves. */
function mound(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const dome = (r: number, seed: number) => {
    const g = new THREE.SphereGeometry(r, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), a = Math.atan2(z, x);
      const k = 1 + 0.08 * Math.sin(a * 3 + seed) * Math.sin((y / r) * 3 + seed);
      pos.setXYZ(i, x * k, y * 0.72 - 0.02, z * k);
    }
    g.computeVertexNormals();
    return g;
  };
  const groove = (p: THREE.Vector3) => new THREE.Color(Math.sin(p.x * 55 + Math.sin(p.z * 38) * 2.2) > 0.1 ? WHITE : 0xc4bcae);
  b.add(dome(0.3, 1), { color: groove });
  b.add(dome(0.16, 4), { color: groove }, M.t(0.27, 0, 0.1));
  return b.build();
}

/** Mushroom coral: a flat oval disc with radial ridges, lying loose on the bed. */
function mushroom(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.15, 0.16, 0.035, 14, 1);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  // Dome the top a little: the cap's centre vertices rise.
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0 && Math.hypot(pos.getX(i), pos.getZ(i)) < 0.01) pos.setY(i, 0.05);
  g.computeVertexNormals();
  const b = new GeoBuilder();
  b.add(g, { color: (p) => new THREE.Color(Math.hypot(p.x, p.z) < 0.02 ? 0xc8beb0 : Math.sin(Math.atan2(p.z, p.x) * 7) > 0 ? WHITE : 0xd6ccbe) }, M.t(0, 0.035, 0));
  return b.build();
}

/** Finger coral: a bright knobbly cluster of short upright fingers. */
function finger(): THREE.BufferGeometry {
  const b = new GeoBuilder(), rng = new RNG(37);
  for (let k = 0; k < 7; k++) {
    const a = rng.range(0, Math.PI * 2), d = k === 0 ? 0 : rng.range(0.05, 0.13), r = rng.range(0.026, 0.036), h = rng.range(0.12, 0.26);
    const lean = d * 2.4;
    b.add(P.cyl(r * 0.8, r, h, 5), { color: (p) => lerpHex(0xbcb4a6, WHITE, p.y / 0.24) }, M.t(Math.cos(a) * d, 0, Math.sin(a) * d, Math.sin(a) * lean, 0, -Math.cos(a) * lean).multiply(M.t(0, h / 2, 0)));
  }
  return b.build();
}

/** Lathe wall with ridges round it (sponges). */
function ridgedLathe(pts: [number, number][], segs: number, ridges: number, depth: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), k = 1 + depth * Math.cos(Math.atan2(z, x) * ridges);
    pos.setXYZ(i, x * k, pos.getY(i), z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Barrel sponge: a big ridged barrel, open at the top; the hollow is its own colour, a little shaded (never a black hole). */
function barrel(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(ridgedLathe([[0.13, -0.02], [0.17, 0.12], [0.18, 0.26], [0.155, 0.36], [0.14, 0.38]], 10, 8, 0.07), { color: (p) => lerpHex(0xb4ab9c, WHITE, p.y / 0.38) });
  // Inner wall (points top-down so it faces inwards) and the floor of the hollow: pale at the lip,
  // shading gently towards the bottom, and shallow, so it reads as a soft cup.
  b.add(ridgedLathe([[0.125, 0.375], [0.125, 0.3], [0.1, 0.22]], 10, 8, 0.05), { color: (p) => lerpHex(0xb8aea0, 0xe6dfd2, (p.y - 0.22) / 0.15) });
  b.add(new THREE.CircleGeometry(0.105, 8), { color: 0xb0a698 }, M.t(0, 0.22, 0, -Math.PI / 2, 0, 0));
  return b.build();
}

/** Vase sponges: two flared, open vases, pale inside. */
function vase(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const one = (m: THREE.Matrix4) => {
    b.add(ridgedLathe([[0.04, -0.02], [0.06, 0.1], [0.1, 0.3], [0.15, 0.48], [0.17, 0.52]], 8, 5, 0.06), { color: (p) => lerpHex(0xc0b8aa, WHITE, p.y / 0.5) }, m);
    // The inside: pale at the lip, a little shaded lower down, closed by a floor part-way in.
    b.add(ridgedLathe([[0.158, 0.515], [0.125, 0.42], [0.085, 0.33]], 8, 5, 0.05), { color: (p) => lerpHex(0xb8aea0, 0xe6dfd2, (p.y - 0.3) / 0.2) }, m);
    b.add(new THREE.CircleGeometry(0.09, 6), { color: 0xb0a698 }, m.clone().multiply(M.t(0, 0.33, 0, -Math.PI / 2, 0, 0)));
  };
  one(M.t(0, 0, 0, 0.06, 0, -0.05));
  one(M.t(0.15, 0, 0.06, 0.12, 0.6, 0.25, 0.7));
  return b.build();
}

/** Ball / encrusting sponges: a few lumpy blobs huddled on the bed. */
function ballSponge(): THREE.BufferGeometry {
  const b = new GeoBuilder(), rng = new RNG(41);
  for (let k = 0; k < 4; k++) {
    const r = k === 0 ? 0.11 : rng.range(0.05, 0.085), a = rng.range(0, Math.PI * 2), d = k === 0 ? 0 : rng.range(0.1, 0.16);
    const g = new THREE.SphereGeometry(r, 7, 5);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), j = 1 + 0.12 * Math.sin(x * 70 + k) * Math.cos(z * 60 - k);
      pos.setXYZ(i, x * j, (y < 0 ? y * 0.35 : y * 0.85) * j, z * j);
    }
    g.computeVertexNormals();
    b.add(g, { color: (p) => lerpHex(0xd8d0c2, WHITE, (p.y + 0.02) / 0.12) }, M.t(Math.cos(a) * d, r * 0.3, Math.sin(a) * d));
  }
  return b.build();
}

/** A tapered, wavy strand (kelp, seagrass) from the base up, bending as it rises. */
function strand(width: number, height: number, segs: number, wave: number, bend: number, phase: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, height, 1, segs), pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let j = 0; j < pos.count; j++) {
    const t = (pos.getY(j) + height / 2) / height;
    const w = Math.sin(Math.min(1, t * 1.6 + 0.15) * Math.PI * 0.5) * (1 - 0.75 * t * t);
    pos.setXYZ(j, pos.getX(j) * w + Math.sin(t * 5 + phase) * wave * t, pos.getY(j) + height / 2, bend * t * t);
  }
  g.computeVertexNormals();
  return g;
}

/** Kelp: a clump of tall swaying strands with leafy blades, darker at the holdfast. */
function kelp(): THREE.BufferGeometry {
  const b = new GeoBuilder(), rng = new RNG(43);
  for (let k = 0; k < 5; k++) {
    const h = rng.range(0.8, 1.2), a = rng.range(0, Math.PI * 2), d = rng.range(0.02, 0.1);
    const m = M.t(Math.cos(a) * d, 0, Math.sin(a) * d, 0, rng.range(0, Math.PI * 2), 0);
    const col = (p: THREE.Vector3) => lerpHex(0x8a826a, 0xece4c0, p.y / 1.1);
    b.add(strand(0.07, h, 6, 0.06, rng.range(-0.12, 0.12), k * 1.7), { color: col, sway: (p) => Math.max(0, p.y) * 4 }, m);
    for (let j = 0; j < 3; j++) {
      const y = h * (0.3 + j * 0.22), side = j % 2 ? 1 : -1;
      b.add(P.plane(0.045, 0.14), { color: col, sway: (p) => Math.max(0, p.y) * 4 }, m.clone().multiply(M.t(side * 0.04, y + 0.07, 0, 0.2, 0, -side * 0.7)));
    }
  }
  return b.build();
}

/** A tuft of seagrass for the meadows: a dozen ribbon blades spread over a small patch. */
function meadow(): THREE.BufferGeometry {
  const b = new GeoBuilder(), rng = new RNG(47);
  for (let k = 0; k < 12; k++) {
    const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * 0.3, h = rng.range(0.16, 0.36);
    b.add(strand(0.04, h, 2, 0.02, rng.range(-0.08, 0.08), k), { color: k % 3 ? 0xd8e0b0 : 0xb8c890, sway: (p) => Math.max(0, p.y) * 2.5 }, M.t(Math.cos(a) * d, 0, Math.sin(a) * d, 0, rng.range(0, Math.PI * 2), 0));
  }
  return b.build();
}

/** Sea fan: a flat, swaying lattice of thin ribs (double-sided). */
function fan(): THREE.BufferGeometry {
  const b = new GeoBuilder(), rng = new RNG(53);
  b.add(P.cyl(0.012, 0.02, 0.1, 4, true), { color: 0xd8d0c4 }, M.t(0, 0.05, 0));
  const sway = (p: THREE.Vector3) => Math.min(0.6, Math.max(0, p.y) * 1.8);
  for (let k = 0; k < 11; k++) {
    const a = -1.05 + (k / 10) * 2.1, len = 0.3 + rng.next() * 0.12;
    b.add(new THREE.PlaneGeometry(0.014, len, 1, 2), { color: WHITE, sway }, M.t(Math.sin(a) * len * 0.5, 0.09 + Math.cos(a) * len * 0.5, 0, 0, 0, -a));
  }
  for (let k = 0; k < 3; k++) b.add(P.plane(0.32 - k * 0.06, 0.012), { color: WHITE, sway }, M.t(0, 0.2 + k * 0.08, 0.001));
  return b.build();
}

/**
 * A creature model made ready for the habitat shader, fitted over a procedural stand-in: baked
 * (bind pose), scaled so its footprint matches the stand-in's widest span (and, with `fitHeight`,
 * its height too, so anything sized off the stand-in's top still lines up), its colours turned to
 * light and shade only (each instance carries its own colour, as the stand-ins do), with `aVeg`
 * (x = `sway` at each point) and `aMat` (zeros). `maxVerts`: simplified until it has fewer
 * vertices than this (it is drawn by the thousand). Never resolves in Node (no models there).
 */
export function habitatCreature(name: CreatureName, proto: THREE.BufferGeometry, opts: { fitHeight?: boolean; sway?: (p: THREE.Vector3) => number; maxVerts?: number } = {}): Promise<THREE.BufferGeometry> {
  if (typeof document === 'undefined') return new Promise(() => undefined);
  return loadCreature(name).then(async (asset) => {
    let geo = bakeCreature(asset);
    proto.computeBoundingBox();
    const pb = proto.boundingBox!, gb = geo.boundingBox!;
    const span = (b: THREE.Box3) => Math.max(1e-4, b.max.x - b.min.x, b.max.z - b.min.z);
    const k = span(pb) / span(gb), ky = opts.fitHeight ? (pb.max.y - pb.min.y) / Math.max(1e-4, gb.max.y - gb.min.y) : k;
    geo.scale(k, ky, k);
    if (opts.maxVerts) {
      for (let ratio = 0.5; geo.getAttribute('position').count >= opts.maxVerts && ratio > 0.005; ratio *= 0.6) {
        geo = compact(await simplifyGeometry(geo, ratio));
      }
    }
    // Light and shade only: luminance, lifted so the instance colour stays bright.
    const C = geo.getAttribute('color'), P = geo.getAttribute('position'), n = P.count;
    let top = 1e-4;
    const lum = new Float32Array(n);
    for (let i = 0; i < n; i++) top = Math.max(top, (lum[i] = 0.3 * C.getX(i) + 0.59 * C.getY(i) + 0.11 * C.getZ(i)));
    const v = new THREE.Vector3(), veg = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const l = 0.55 + 0.45 * (lum[i] / top);
      C.setXYZ(i, l, l, l);
      veg[i * 2] = opts.sway ? opts.sway(v.fromBufferAttribute(P, i)) : 0;
    }
    geo.setAttribute('aVeg', new THREE.BufferAttribute(veg, 2));
    geo.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(n), 1));
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  });
}

/** Drop the vertices an index no longer uses (the simplifier only rewrites the index). */
function compact(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const I = geo.index!, remap = new Map<number, number>(), order: number[] = [];
  const idx = new Uint32Array(I.count);
  for (let i = 0; i < I.count; i++) {
    const o = I.getX(i);
    let m = remap.get(o);
    if (m === undefined) { remap.set(o, (m = order.length)); order.push(o); }
    idx[i] = m;
  }
  const out = new THREE.BufferGeometry();
  for (const [key, a] of Object.entries(geo.attributes)) {
    const src = a as THREE.BufferAttribute, sz = src.itemSize, arr = new Float32Array(order.length * sz);
    order.forEach((o, j) => { for (let c = 0; c < sz; c++) arr[j * sz + c] = src.array[o * sz + c]; });
    out.setAttribute(key, new THREE.BufferAttribute(arr, sz));
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** Soft coral / anemone: a tuft of waving tentacles on a squat base. */
function soft(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.05, 0.065, 0.06, 6), { color: 0xd8cec4 }, M.t(0, 0.03, 0));
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2, r = k % 2 ? 0.03 : 0.045;
    b.add(P.cone(0.016, 0.15, 3), { color: WHITE, sway: (p) => Math.max(0, p.y - 0.05) * 5 }, M.t(Math.cos(a) * r, 0.13, Math.sin(a) * r, Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45));
  }
  return b.build();
}

/** Starfish: a low, faceted five-armed star. */
function star(): THREE.BufferGeometry {
  const pos: number[] = [0, 0.045, 0];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2, r = k % 2 ? 0.045 : 0.13;
    pos.push(Math.cos(a) * r, k % 2 ? 0.035 : 0.022, Math.sin(a) * r);
  }
  const idx: number[] = [];
  for (let k = 0; k < 10; k++) idx.push(0, 1 + ((k + 1) % 10), 1 + k);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return new GeoBuilder().add(g, { color: (p) => lerpHex(0xd0c8bc, WHITE, (p.y - 0.02) / 0.025), facet: true }).build();
}

/** Sea urchin: a dark ball bristling with spines. */
function urchin(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(new THREE.SphereGeometry(0.06, 6, 4), { color: WHITE }, M.t(0, 0.045, 0, 0, 0, 0, 1, 0.8, 1));
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), q = new THREE.Quaternion();
  for (let k = 0; k < 12; k++) {
    // Spread over the upper part of a sphere (golden angle).
    const y = 1 - (k + 0.5) / 12 * 1.1, r = Math.sqrt(Math.max(0, 1 - y * y)), a = k * 2.39996;
    dir.set(Math.cos(a) * r, y, Math.sin(a) * r).normalize();
    const m = new THREE.Matrix4().compose(dir.clone().multiplyScalar(0.1).add(new THREE.Vector3(0, 0.045, 0)), q.setFromUnitVectors(up, dir), new THREE.Vector3(1, 1, 1));
    b.add(P.cone(0.01, 0.1, 3), { color: 0xe8e0d8 }, m);
  }
  return b.build();
}

/** Giant clam: a scalloped shell bowl with its bright mantle showing between the lips. */
function clam(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const bowl = new THREE.SphereGeometry(0.15, 9, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const pos = bowl.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > -0.01) pos.setY(i, pos.getY(i) + 0.025 * Math.sin(Math.atan2(pos.getZ(i), pos.getX(i)) * 6));
  bowl.computeVertexNormals();
  b.add(bowl, { color: 0x8f887a }, M.t(0, 0.085, 0, 0, 0, 0, 1, 0.55, 0.7));
  b.add(new THREE.SphereGeometry(0.13, 9, 3), { color: (p) => lerpHex(0xb8b4c0, WHITE, Math.abs(p.z) / 0.08) }, M.t(0, 0.08, 0, 0, 0, 0, 1.12, 0.25, 0.78));
  return b.build();
}

/** Coral rubble: pale broken chips and a couple of shells. */
function rubble(): THREE.BufferGeometry {
  const b = new GeoBuilder(), rng = new RNG(59);
  for (let k = 0; k < 5; k++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(0.03, 0.2), w = rng.range(0.04, 0.09);
    b.add(P.box(w, w * rng.range(0.35, 0.6), w * rng.range(0.5, 0.9)), { color: lerpHex(0xc8beac, WHITE, rng.next()) }, M.t(Math.cos(a) * d, 0.01, Math.sin(a) * d, rng.range(-0.4, 0.4), rng.range(0, 3), rng.range(-0.4, 0.4)));
  }
  for (let k = 0; k < 2; k++) {
    b.add(P.cone(0.04, 0.03, 6), { color: k ? 0xf6dcd2 : WHITE }, M.t(k ? 0.12 : -0.1, 0.012, k ? -0.08 : 0.09, 0, k * 1.3, 0, 1, 1, 0.8));
  }
  return b.build();
}

// ---------------- Kinds ----------------

type Kind = 'base' | 'elkhorn' | 'pillar' | 'plates' | 'mound' | 'mushroom' | 'finger' | 'fan' | 'soft' | 'barrel' | 'vase' | 'ball' | 'kelp' | 'meadow' | 'star' | 'urchin' | 'clam' | 'rubble';

interface KindDef {
  geo: () => THREE.BufferGeometry;
  pal: number[];
  /** Scale at full size. */
  size: number;
  /** How much of the colour's saturation to keep (the water tints them too). */
  sat?: number;
  /** Thin blades: drawn from both sides. */
  double?: boolean;
  /** Left out rather than shrunk below this fraction of its size in shallow water. */
  minFit?: number;
  /** Footprint radius for the slope test. */
  radius?: number;
  /** Small touches: the first to go on lower presets. */
  minor?: boolean;
  tilt?: number;
}

const KINDS: Record<Kind, KindDef> = {
  base: { geo: () => coralBaseGeometry(), pal: BASE_PALETTE, size: 1, sat: 1, radius: 0.3 },
  elkhorn: { geo: elkhorn, pal: [0xe0a868, 0xd9925a, 0xeab87a, 0xf08c7a, 0xc9a070], size: 1.5, minFit: 0.45, radius: 0.35 },
  pillar: { geo: pillar, pal: [0xe6cfa0, 0xf2b98a, 0xd9a6c8, 0xb9d98f, 0xa8d8d0], size: 1.15, minFit: 0.45, radius: 0.2 },
  plates: { geo: plates, pal: [0x7fc8b8, 0x9fd48a, 0xc8a2e8, 0x7fa8e0, 0xf0a868, 0xe890a8], size: 1.45, minFit: 0.4, radius: 0.35 },
  mound: { geo: mound, pal: [0xd8c06a, 0xa8c46e, 0xe09a6a, 0x8fc0a8, 0xe8c88a, 0xc890c0], size: 1.35, minFit: 0.35, radius: 0.35 },
  mushroom: { geo: mushroom, pal: [0xf09ac0, 0xa0e0d0, 0xf0d070, 0xc8a0f0, 0xf0b090], size: 1, radius: 0.18, tilt: 0.1 },
  finger: { geo: finger, pal: [0xff7a5c, 0xff5c8a, 0xb07aff, 0x5cc8ff, 0xffc04a, 0x7ae08a], size: 1.15, radius: 0.15 },
  fan: { geo: fan, pal: [0xb04ad0, 0xe0457a, 0xff7a4a, 0x8a5ae0, 0xf0c040], size: 1.4, double: true, minFit: 0.4, radius: 0.15, tilt: 0.12 },
  soft: { geo: soft, pal: [0xff9ec8, 0xffc2e0, 0xfff09a, 0x9af0e8, 0xc8a0ff], size: 1.15, radius: 0.12 },
  barrel: { geo: barrel, pal: [0xc0603c, 0xd07a40, 0x9a4a6a, 0xb07a4a, 0x8a5aa0], size: 1.3, minFit: 0.45, radius: 0.25 },
  vase: { geo: vase, pal: [0xb070e0, 0xe070b0, 0x6fa0f0, 0xf0a040, 0x60c8c0], size: 1.15, minFit: 0.45, radius: 0.22 },
  ball: { geo: ballSponge, pal: [0xffd23f, 0xff9a3c, 0xa45ad6, 0xff6f61, 0xe8e050, 0xe86ab0], size: 1, radius: 0.2 },
  kelp: { geo: kelp, pal: [0x6b7a2e, 0x7a6a2a, 0x4f7a3a, 0x8a7a3a, 0x5a6a2a, 0x6a5a28], size: 1, sat: 1, double: true, minFit: 0.55, radius: 0.12, tilt: 0.05 },
  meadow: { geo: meadow, pal: [0x5f8f3e, 0x7a9a4a, 0x4f7f3f, 0x8aa050, 0x6a8a36], size: 1, sat: 1, double: true, radius: 0.3, tilt: 0.04 },
  star: { geo: star, pal: [0xff7a3a, 0xe8453c, 0x8a5ae0, 0x3a7ae0, 0xffb03a, 0xf06aa0], size: 1, minor: true, radius: 0.12, tilt: 0.05 },
  urchin: { geo: urchin, pal: [0x3a2a4a, 0x5a2a3a, 0x2a2a3a, 0x6a3a6a], size: 1, sat: 1, minor: true, radius: 0.1 },
  clam: { geo: clam, pal: [0x3ab0e0, 0x7a5ae0, 0x3ad0a0, 0x2a8ad0, 0x9a6ae8], size: 1, sat: 0.9, minor: true, radius: 0.15, tilt: 0.1 },
  rubble: { geo: rubble, pal: [0xf0e8da, 0xe8dccc, 0xf0dcd4, 0xdcd8cc], size: 1.2, sat: 1, minor: true, radius: 0.2, tilt: 0.06 },
};

/** The kinds that stand on a rocky base (not the loose or lying ones: mushrooms, stars, clams, rubble, weed). */
const BASED = new Set<Kind>(['elkhorn', 'pillar', 'plates', 'mound', 'finger', 'fan', 'soft', 'barrel', 'vase', 'ball']);
const CORE: [Kind, number][] = [['elkhorn', 3], ['pillar', 2], ['plates', 3], ['mound', 3], ['barrel', 2], ['fan', 2], ['finger', 2], ['vase', 1.2], ['soft', 1]];
const MID: [Kind, number][] = [['finger', 3], ['mushroom', 2], ['fan', 1.5], ['soft', 2], ['vase', 1.5], ['ball', 2.5], ['plates', 1], ['mound', 1.5], ['barrel', 0.8], ['elkhorn', 0.5], ['star', 0.5], ['clam', 0.8], ['urchin', 0.5]];
const EDGE: [Kind, number][] = [['rubble', 4], ['ball', 2], ['mushroom', 1.5], ['urchin', 1.2], ['star', 1], ['clam', 0.4], ['finger', 1], ['soft', 0.5]];
const SCATTER: [Kind, number][] = [['ball', 3], ['urchin', 2], ['star', 2], ['vase', 1], ['soft', 1], ['kelp', 1.5], ['clam', 0.7], ['mushroom', 1], ['rubble', 1.5], ['finger', 0.8]];

function pick(rng: RNG, table: [Kind, number][]): Kind {
  let r = rng.next() * table.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of table) if ((r -= w) <= 0) return k;
  return table[0][0];
}

/** Detail per preset: the fraction of candidates drawn (ranked, so the same ones go first). */
export const SEABED_DENSITY: Record<PresetName, number> = { low: 0.5, medium: 0.7, high: 0.9, ultra: 1 };
/**
 * How far out the seabed is drawn (and where it fades): further than the small coral patches, so
 * the reefs still show at an ordinary viewing distance, not only right under the camera.
 */
const RANGE: Record<PresetName, number> = { low: 40, medium: 54, high: 70, ultra: 85 };
/** Chunk size (world units): meshes per chunk and kind, so chunks off screen are culled. */
const CH = 32;

interface Cand { kind: Kind; x: number; z: number; s: number; sx: number; sz: number; ry: number; tx: number; tz: number; c: THREE.Color; rank: number; core: boolean }

/** Kinds drawn with one of the artist's creature models once it loads (see habitatCreature). */
const MODELS: Partial<Record<Kind, { name: CreatureName; opts: Parameters<typeof habitatCreature>[2] }>> = {
  star: { name: 'starfish', opts: { maxVerts: 300 } },
  soft: { name: 'sea-anemone', opts: { fitHeight: true, maxVerts: 300, sway: (p) => Math.max(0, p.y - 0.05) * 5 } },
};

export class Seabed {
  readonly group = new THREE.Group();
  private instances: HabitatInstances;
  private noise: Simplex2;
  private geos = new Map<Kind, THREE.BufferGeometry>();
  private mat = habitatMaterial(true);
  private dblMat = habitatMaterial();
  private range = 36;
  /** Chunks built so far, and the middles of the reef fields in each (for the reef fish). */
  private built = new Map<number, { x: number; z: number }[]>();
  private chunksX: number;

  /** `clear`: spots to leave open (the big anemones the clownfish live in, placed by Coral.ts from the seed alone). */
  constructor(private world: World, private clear: { x: number; z: number; r: number }[] = []) {
    this.instances = new HabitatInstances(world);
    this.noise = new Simplex2(new RNG(world.seed * 7 + 3));
    this.dblMat.side = THREE.DoubleSide;
    this.dblMat.forceSinglePass = true;
    this.chunksX = Math.ceil(world.N / CH);
    for (let cj = 0; cj < this.chunksX; cj++) for (let ci = 0; ci < this.chunksX; ci++) this.build(ci, cj);
    // Clearer water over the reef fields so their colours show through.
    const w = world;
    for (let cz = 0; cz < w.N; cz++) for (let cx = 0; cx < w.N; cx++) {
      const x = w.centerX(cx), z = w.centerZ(cz), f = reefField(this.noise, x, z);
      if (f < 0.2) continue;
      const i = w.idx(cx, cz), bed = w.heightAt(x, z);
      if (bed > -0.3 || bed < -3.2 || !w.isSea(i)) continue;
      w.clearWater[i] = Math.max(w.clearWater[i], Math.min(0.6, f * 0.7));
    }
  }

  /** Every candidate in a chunk, from the seed alone (never the terrain). */
  private candidates(ci: number, cj: number): Cand[] {
    const w = this.world, n = this.noise, out: Cand[] = [];
    const x0 = ci * CH - w.half, z0 = cj * CH - w.half;
    const grid = (S: number, layer: number, fn: (x: number, z: number, rng: RNG) => void) => {
      for (let gz = Math.ceil(z0 / S - 1e-6); gz < (z0 + CH) / S - 1e-6; gz++) for (let gx = Math.ceil(x0 / S - 1e-6); gx < (x0 + CH) / S - 1e-6; gx++) {
        const rng = new RNG(Math.floor(hash2(gx, gz, w.seed * 13 + layer * 7919) * 4294967296));
        fn((gx + rng.range(-0.45, 0.45)) * S, (gz + rng.range(-0.45, 0.45)) * S, rng);
      }
    };
    const near = this.clear.filter((c) => c.x > x0 - 2 && c.x < x0 + CH + 2 && c.z > z0 - 2 && c.z < z0 + CH + 2);
    const add = (kind: Kind, x: number, z: number, size: number, rng: RNG, core = false, based = false) => {
      const def = KINDS[kind], tilt = def.tilt ?? 0.08;
      if (near.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + (def.radius ?? 0.25) * def.size * size)) return;
      const c = new THREE.Color(def.pal[Math.floor(rng.next() * def.pal.length)]), hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      c.setHSL(hsl.h + rng.range(-0.015, 0.015), hsl.s * (def.sat ?? 0.9), hsl.l * rng.range(0.86, 1));
      const cand: Cand = { kind, x, z, s: def.size * size, sx: rng.range(0.85, 1.15), sz: rng.range(0.85, 1.15), ry: rng.range(0, Math.PI * 2), tx: rng.range(-tilt, tilt), tz: rng.range(-tilt, tilt), c, rank: def.minor ? 0.5 + 0.5 * rng.next() : rng.next(), core };
      out.push(cand);
      // A lone coral or sponge out on the sand grows from its own low mound of old reef rock
      // (thinned out with it on lower presets). In the reef fields they share broad slabs instead.
      if (!based || !BASED.has(kind)) return;
      const R = (def.radius ?? 0.25) * cand.s * 0.8 * rng.range(1.5, 1.9), h = R * rng.range(0.28, 0.4), wide = rng.range(0.85, 1.15);
      const bc = new THREE.Color(BASE_PALETTE[rng.int(0, BASE_PALETTE.length - 1)]).multiplyScalar(rng.range(0.9, 1.05));
      out.push({ kind: 'base', x, z, s: h, sx: (R * wide) / h, sz: R / wide / h, ry: rng.range(0, Math.PI * 2), tx: 0, tz: 0, c: bc, rank: cand.rank, core: false });
    };
    // Reef fields: big corals in the middle, mixed growth further out, rubble at the edges.
    grid(0.7, 1, (x, z, rng) => {
      const f = reefField(n, x, z);
      if (f <= 0 || !rng.chance(0.5 + 0.5 * f)) return;
      const kind = pick(rng, f > 0.6 ? CORE : f > 0.25 ? MID : EDGE);
      add(kind, x, z, (0.7 + 0.5 * f) * rng.range(0.8, 1.2), rng, f > 0.5);
    });
    // Kelp forests, never in a reef's dense middle.
    grid(1.2, 2, (x, z, rng) => {
      const k = kelpField(n, x, z);
      if (k <= 0 || reefField(n, x, z) > 0.5 || !rng.chance(0.2 + 0.7 * k)) return;
      add('kelp', x, z, rng.range(0.75, 1.2), rng);
    });
    // Seagrass meadows on the open sandy flats.
    grid(1, 3, (x, z, rng) => {
      const m = meadowField(n, x, z);
      if (m <= 0 || reefField(n, x, z) > 0.05 || !rng.chance(0.35 + 0.6 * m)) return;
      add('meadow', x, z, rng.range(0.75, 1.25) * (0.8 + 0.3 * m), rng);
    });
    // A light scatter of sponges, urchins, starfish, clams and weed across the rest of the shelf.
    grid(2.6, 4, (x, z, rng) => {
      if (!rng.chance(0.4) || reefField(n, x, z) > 0.25) return;
      add(pick(rng, SCATTER), x, z, rng.range(0.7, 1.1), rng, false, true);
    });
    // The reef fields grow on old reef rock: broad, low slabs under the corals, so nothing stands
    // straight out of bare sand. Thickest in the middle of a field, patchier towards its edges.
    grid(1.8, 5, (x, z, rng) => {
      const f = reefField(n, x, z);
      if (f < 0.15 || !rng.chance(0.45 + 0.55 * f)) return;
      if (near.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.3)) return;
      const R = rng.range(0.75, 1.15) * (0.75 + 0.35 * f), h = R * rng.range(0.22, 0.32), wide = rng.range(0.8, 1.2);
      const c = new THREE.Color(BASE_PALETTE[rng.int(0, BASE_PALETTE.length - 1)]).multiplyScalar(rng.range(0.9, 1.05));
      out.push({ kind: 'base', x, z, s: h, sx: (R * wide) / h, sz: R / wide / h, ry: rng.range(0, Math.PI * 2), tx: 0, tz: 0, c, rank: rng.next(), core: false });
    });
    return out;
  }

  private geo(kind: Kind): THREE.BufferGeometry {
    let g = this.geos.get(kind);
    if (!g) {
      g = KINDS[kind].geo();
      g.computeBoundingBox();
      this.geos.set(kind, g);
      const model = MODELS[kind];
      // The artist's model replaces the stand-in when it loads: chunks built later read it from
      // the cache, chunks built already swap over now. Same footprint and height, so the habitat
      // fitting (sized off the stand-in's top) is unchanged.
      if (model) habitatCreature(model.name, g, model.opts).then((m) => {
        this.geos.set(kind, m);
        for (const o of this.group.children) if (o.name === `seabed-${kind}`) (o as THREE.InstancedMesh).geometry = m;
      }).catch(() => undefined);
    }
    return g;
  }

  /** Build a chunk's meshes if any of its candidates lie on the open shelf. */
  private build(ci: number, cj: number): void {
    const key = cj * this.chunksX + ci;
    if (this.built.has(key)) return;
    const w = this.world, cands = this.candidates(ci, cj);
    const onShelf = (c: Cand) => {
      const bed = w.heightAt(c.x, c.z);
      return bed <= -0.35 && bed >= -3.2 && w.isSeaAt(c.x, c.z);
    };
    if (!cands.some(onShelf)) return;
    this.built.set(key, cands.filter((c) => c.core).map((c) => ({ x: c.x, z: c.z })));
    const byKind = new Map<Kind, Cand[]>();
    for (const c of cands) {
      let list = byKind.get(c.kind);
      if (!list) byKind.set(c.kind, (list = []));
      list.push(c);
    }
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3();
    for (const [kind, list] of byKind) {
      const def = KINDS[kind], geo = this.geo(kind);
      const mesh = new THREE.InstancedMesh(geo, def.double ? this.dblMat : this.mat, list.length);
      const homes = list.map((c, i) => {
        const m = new THREE.Matrix4().compose(p.set(c.x, w.heightAt(c.x, c.z) - 0.02, c.z), q.setFromEuler(e.set(c.tx, c.ry, c.tz)), s.set(c.s * c.sx, c.s, c.s * c.sz));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c.c);
        return m;
      });
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.renderOrder = 8;
      mesh.name = `seabed-${kind}`;
      this.group.add(mesh);
      this.instances.add(mesh, homes, Math.max(0.05, geo.boundingBox!.max.y), def.radius ?? 0.25, { ranks: list.map((c) => c.rank), minFit: def.minFit });
    }
  }

  /** After terrain edits (cell range): show/hide what grows there, building chunks that now reach the shelf. */
  refresh(x0: number, z0: number, x1: number, z1: number): void {
    this.instances.refresh(x0, z0, x1, z1);
    const lo = (v: number) => Math.max(0, Math.floor((v - 2) / CH)), hi = (v: number) => Math.min(this.chunksX - 1, Math.floor((v + 2) / CH));
    for (let cj = lo(z0); cj <= hi(z1); cj++) for (let ci = lo(x0); ci <= hi(x1); ci++) this.build(ci, cj);
  }

  setPreset(preset: PresetName): void {
    habitatPreset(this.group, preset);
    this.range = RANGE[preset];
    for (const m of [this.mat, this.dblMat]) m.userData.habitatRange.value = this.range;
    this.instances.setDensity(SEABED_DENSITY[preset]);
  }

  /** Hide chunks beyond the fade-out distance from the camera. */
  cull(cam: THREE.Vector3): void {
    this.instances.cull(cam, this.range);
  }

  /**
   * The middles of the big reef fields (where reef fish gather), the biggest first: 8-unit bins
   * holding enough living reef core.
   */
  hotspots(): { x: number; z: number; r: number }[] {
    const bins = new Map<number, { x: number; z: number; n: number }>();
    for (const pts of this.built.values()) for (const p of pts) {
      if (habitatFit(this.world, p.x, p.z, 0.2) <= 0) continue;
      const key = Math.floor((p.x + this.world.half) / 8) * 1000 + Math.floor((p.z + this.world.half) / 8);
      const b = bins.get(key);
      if (b) { b.x += p.x; b.z += p.z; b.n++; } else bins.set(key, { x: p.x, z: p.z, n: 1 });
    }
    return [...bins.values()].filter((b) => b.n >= 6).sort((a, b) => b.n - a.n).map((b) => ({ x: b.x / b.n, z: b.z / b.n, r: 3 }));
  }

  /** Instances drawn now (after terrain and preset), for tests and stats. */
  shown(): number {
    return this.group.children.reduce((t, o) => t + (o as THREE.InstancedMesh).count, 0);
  }
}
