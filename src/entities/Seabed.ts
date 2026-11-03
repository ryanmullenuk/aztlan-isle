import * as THREE from 'three';
import { GeoBuilder, M, P } from '../render/GeoBuilder';
import { HabitatInstances, habitatFit, habitatMaterial, habitatPreset } from './Habitat';
import { PresetName } from '../config';
import { Simplex2 } from '../world/noise';
import { RNG, hash2 } from '../world/rng';
import { World } from '../world/World';

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

/** Elkhorn: broad, flattened antler limbs spreading out and forking. */
function elkhorn(): THREE.BufferGeometry {
  const b = new GeoBuilder(), rng = new RNG(23);
  const col = (p: THREE.Vector3) => lerpHex(0xc8bfae, WHITE, p.y / 0.4);
  b.add(P.cyl(0.05, 0.07, 0.12, 5, true), { color: 0xc0b8a8 }, M.t(0, 0.06, 0));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + rng.range(-0.3, 0.3), lean = rng.range(0.6, 0.95), len = rng.range(0.24, 0.32);
    const limb = M.t(0, 0.1, 0, 0, a, 0).multiply(M.t(0, 0, 0, lean, 0, 0));
    b.add(P.cyl(0.035, 0.045, len, 5, true), { color: col }, limb.clone().multiply(M.t(0, len / 2, 0, 0, 0, 0, 1.7, 1, 0.45)));
    for (const side of [-1, 1]) {
      const l2 = len * rng.range(0.6, 0.8);
      const tip = limb.clone().multiply(M.t(0, len, 0, rng.range(0.1, 0.3), 0, side * rng.range(0.35, 0.6)));
      b.add(P.cone(0.04, l2, 5), { color: col }, tip.multiply(M.t(0, l2 / 2, 0, 0, 0, 0, 1.5, 1, 0.4)));
    }
  }
  return b.build();
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

/** Plate coral: tiers of broad, thin plates off a short stalk. */
function plates(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.035, 0.05, 0.22, 5, true), { color: 0xc8c0b2 }, M.t(0, 0.11, 0));
  const tiers: [number, number, number, number, number, number][] = [[0, 0.2, 0, 0.34, 0.06, 0.04], [0.09, 0.27, -0.05, 0.23, -0.1, 0.08], [-0.07, 0.32, 0.05, 0.16, 0.08, -0.1]];
  for (const [x, y, z, r, rx, rz] of tiers) {
    b.add(P.cyl(r, r * 0.86, 0.035, 9), { color: (p) => lerpHex(0xcfc6b6, WHITE, Math.hypot(p.x - x, p.z - z) / r) }, M.t(x, y, z, rx, 0, rz));
  }
  return b.build();
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

/** Barrel sponge: a big ridged barrel, open at the top with a dark hollow. */
function barrel(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(ridgedLathe([[0.13, -0.02], [0.17, 0.12], [0.18, 0.26], [0.155, 0.36], [0.14, 0.38]], 10, 8, 0.07), { color: (p) => lerpHex(0xb4ab9c, WHITE, p.y / 0.38) });
  // Inner wall (points top-down so it faces inwards) and the dark floor of the hollow.
  b.add(ridgedLathe([[0.125, 0.375], [0.13, 0.22], [0.1, 0.08]], 10, 8, 0.05), { color: 0x5a4a44 });
  b.add(new THREE.CircleGeometry(0.105, 8), { color: 0x3a2e2a }, M.t(0, 0.08, 0, -Math.PI / 2, 0, 0));
  return b.build();
}

/** Vase sponges: two flared, open vases. */
function vase(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const one = (m: THREE.Matrix4) => {
    b.add(ridgedLathe([[0.04, -0.02], [0.06, 0.1], [0.1, 0.3], [0.15, 0.48], [0.17, 0.52]], 8, 5, 0.06), { color: (p) => lerpHex(0xc0b8aa, WHITE, p.y / 0.5) }, m);
    b.add(ridgedLathe([[0.158, 0.515], [0.12, 0.35], [0.06, 0.15]], 8, 5, 0.05), { color: 0x4a3a44 }, m);
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

type Kind = 'elkhorn' | 'pillar' | 'plates' | 'mound' | 'mushroom' | 'finger' | 'fan' | 'soft' | 'barrel' | 'vase' | 'ball' | 'kelp' | 'meadow' | 'star' | 'urchin' | 'clam' | 'rubble';

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

export class Seabed {
  readonly group = new THREE.Group();
  private instances: HabitatInstances;
  private noise: Simplex2;
  private geos = new Map<Kind, THREE.BufferGeometry>();
  private mat = habitatMaterial();
  private dblMat = habitatMaterial();
  private range = 36;
  /** Chunks built so far, and the middles of the reef fields in each (for the reef fish). */
  private built = new Map<number, { x: number; z: number }[]>();
  private chunksX: number;

  constructor(private world: World) {
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
    const add = (kind: Kind, x: number, z: number, size: number, rng: RNG, core = false) => {
      const def = KINDS[kind], tilt = def.tilt ?? 0.08;
      const c = new THREE.Color(def.pal[Math.floor(rng.next() * def.pal.length)]), hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      c.setHSL(hsl.h + rng.range(-0.015, 0.015), hsl.s * (def.sat ?? 0.9), hsl.l * rng.range(0.86, 1));
      out.push({ kind, x, z, s: def.size * size, sx: rng.range(0.85, 1.15), sz: rng.range(0.85, 1.15), ry: rng.range(0, Math.PI * 2), tx: rng.range(-tilt, tilt), tz: rng.range(-tilt, tilt), c, rank: def.minor ? 0.5 + 0.5 * rng.next() : rng.next(), core });
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
      add(pick(rng, SCATTER), x, z, rng.range(0.7, 1.1), rng);
    });
    return out;
  }

  private geo(kind: Kind): THREE.BufferGeometry {
    let g = this.geos.get(kind);
    if (!g) {
      g = KINDS[kind].geo();
      g.computeBoundingBox();
      this.geos.set(kind, g);
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
