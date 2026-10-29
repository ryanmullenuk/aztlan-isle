import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS } from '../config';
import { GeoBuilder, M, P, doubleSide, lumpy, outward, ribbon, tube } from '../render/GeoBuilder';
import { RNG } from '../world/rng';

const c = (h: number) => new THREE.Color(h);
const K = {
  thatch: c(0xbca06b),
  thatchDark: c(0x94794d),
  timber: c(0x866443),
  timberDark: c(0x5e3b22),
  terracotta: c(0xa8583e),
  stone: c(0xd5bea0),
  stoneDark: c(0xa69276),
  gold: c(0xc8a451),
  jade: c(0x427c73),
  adobe: c(0xe2c79c),
  plaster: c(0xefe2c6),
  door: c(0x3a2a20),
  red: c(0xa64032),
  blue: c(0x327879),
  white: c(0xf4eee0),
  mud: c(0x6e5034),
  rope: c(0xc9a86a),
};

/** A finished model plus the points where torches stand (local space, door faces +z). */
export interface BuildingModel {
  finished: THREE.BufferGeometry;
  torches: THREE.Vector3[];
  /** Approximate height for scaffolding. */
  height: number;
  /** A roof drawn with the see-through canopy material (so people under it show when zoomed in). */
  canopy?: THREE.BufferGeometry;
  /** Window and doorway openings (boxes: centre and size, local), lit from within at night. */
  windows?: Glow[];
}

/** A window or doorway that glows at night: its centre and size (local, door faces +z). */
export interface Glow { x: number; y: number; z: number; w: number; h: number; d: number }
/** Collects the openings of the model being built (see collectGlows). */
let glowSink: Glow[] | null = null;
/** Build a model, recording its window and doorway openings for the night glow. */
export function collectGlows(make: () => BuildingModel): BuildingModel {
  glowSink = [];
  try {
    const m = make();
    m.windows = glowSink;
    return m;
  } finally {
    glowSink = null;
  }
}

/** Bands of darker thatch along height for texture. */
const thatchColor = (p: THREE.Vector3) => ((p.y * 7) % 1 < 0.3 ? K.thatchDark : K.thatch).clone().lerp(K.thatch, 0.3);

function torchPole(b: GeoBuilder, x: number, z: number, h = 0.75, y0 = 0): THREE.Vector3 {
  b.add(P.cyl(0.025, 0.035, h, 5), { color: K.timberDark }, M.t(x, y0 + h / 2, z));
  b.add(P.cyl(0.07, 0.04, 0.08, 7), { color: K.stoneDark }, M.t(x, y0 + h + 0.03, z));
  return new THREE.Vector3(x, y0 + h + 0.12, z);
}

/** The founding fire uses the village hearth at a scale that fits its original footprint. */
export function campfireModel(): BuildingModel {
  const model = bonfireModel();
  model.finished.scale(0.72, 0.85, 0.72);
  model.height *= 0.85;
  return model;
}

// ---------------- Village comforts ----------------

/** Torch: a tall post with a woven basket of burning pitch pine at the top. */
export function torchModel(): BuildingModel {
  const b = new GeoBuilder();
  b.add(lumpy(P.sphere(0.12, 0), 0.2, 71, 0.5), { color: K.stoneDark }, M.t(0, 0.03, 0));
  b.add(P.cyl(0.03, 0.045, 1.25, 6), { color: K.timber }, M.t(0, 0.62, 0));
  b.add(P.cyl(0.035, 0.035, 0.06, 6), { color: K.rope }, M.t(0, 0.9, 0));
  b.add(P.cyl(0.085, 0.05, 0.14, 7), { color: (p) => ((p.y * 40) % 1 < 0.5 ? K.timberDark : K.rope).clone() }, M.t(0, 1.28, 0));
  b.add(P.sphere(0.06, 0), { color: c(0x2a1c14) }, M.t(0, 1.35, 0, 0, 0, 0, 1, 0.5, 1));
  return { finished: b.build(), torches: [new THREE.Vector3(0, 1.42, 0)], height: 1.5 };
}

/**
 * Trampled ground round a fire: a ragged patch of packed earth (no tidy edge) fading out into the
 * grass, darkened with ash towards the hearth and mottled where feet have scuffed it.
 */
function dirtPatch(radius: number, seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed), SEG = 64, RINGS = 5;
  // A wandering outline: slow lobes plus fine ragged bites.
  const p1 = rng.range(0, 6.3), p2 = rng.range(0, 6.3);
  const edge = Array.from({ length: SEG }, (_, k) => {
    const a = k / SEG * Math.PI * 2;
    return 1 + 0.1 * Math.sin(a * 3 + p1) + 0.06 * Math.sin(a * 7 + p2) + rng.range(-0.07, 0.05);
  });
  const pos: number[] = [];
  const at = (k: number, j: number): [number, number, number] => {
    const a = (k % SEG) / SEG * Math.PI * 2, f = j / RINGS;
    // The outline wanders; the patch thins to nothing at its edge so it melts into the ground.
    const r = radius * f * (j === RINGS ? edge[k % SEG] : 1 + (edge[k % SEG] - 1) * f * 0.6);
    return [Math.cos(a) * r, 0.022 * (1 - f * f), Math.sin(a) * r];
  };
  for (let j = 0; j < RINGS; j++) for (let k = 0; k < SEG; k++) {
    const a = at(k, j), b = at(k + 1, j), c2 = at(k + 1, j + 1), d = at(k, j + 1);
    pos.push(...a, ...b, ...c2, ...a, ...c2, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** Communal hearth: irregular stones, leaning split logs and painted posts, on trampled earth and gravel. */
export function bonfireModel(): BuildingModel {
  const b = new GeoBuilder(), rng = new RNG(905);
  const ash = new THREE.Color(0x3a312a), earth = new THREE.Color(0x6e5338), dust = new THREE.Color(0x8a7152);
  const dirt = (p: THREE.Vector3) => {
    const r = Math.hypot(p.x, p.z);
    const scuff = Math.sin(p.x * 13.1 + Math.sin(p.z * 7.3) * 2) * Math.sin(p.z * 11.7 + p.x * 3.1);
    const mottle = 0.78 + 0.36 * (scuff * 0.5 + 0.5) + 0.12 * Math.sin(p.x * 31 + p.z * 23);
    const col = r < 0.9 ? ash.clone().lerp(earth, Math.min(1, Math.max(0, (r - 0.55) / 0.35))) : earth.clone().lerp(dust, Math.min(1, (r - 0.9) / 0.6));
    return col.multiplyScalar(mottle);
  };
  b.add(dirtPatch(1.45, 77), { color: dirt }, M.t(0, 0.004, 0));
  // Scuffed blotches of loose dirt round the rim break up its outline.
  for (let k = 0; k < 14; k++) {
    const a = k / 14 * Math.PI * 2 + rng.range(-0.2, 0.2), r = rng.range(1.25, 1.62);
    b.add(dirtPatch(rng.range(0.16, 0.34), 400 + k), { color: dirt }, M.t(Math.cos(a) * r, 0.003, Math.sin(a) * r, 0, rng.range(0, 6.3), 0, 1, 1, rng.range(0.6, 1)));
  }
  b.add(P.cyl(0.66, 0.7, 0.035, 16), { color: c(0x34261e) }, M.t(0, 0.04, 0));
  for (let k = 0; k < 14; k++) {
    const a = k / 14 * Math.PI * 2, r = rng.range(0.66, 0.73);
    b.add(lumpy(P.sphere(rng.range(0.17, 0.22), 1), 0.22, 90 + k, 0.75),
      { color: c(k % 3 ? 0x827b70 : 0xa39883) }, M.t(Math.cos(a) * r, 0.15, Math.sin(a) * r, 0, a, 0, 1.05, rng.range(0.8, 1.2), 0.85));
  }
  for (let k = 0; k < 9; k++) {
    const a = k / 9 * Math.PI * 2, h = rng.range(0.85, 1.25);
    // Tops lean inward, with uneven lengths and split angular faces.
    b.add(P.cyl(0.055, 0.085, h, 5), { color: c(k % 3 ? 0x64391e : 0x39281d) },
      M.t(Math.cos(a) * 0.23, h * 0.46 + 0.05, Math.sin(a) * 0.23, -Math.sin(a) * 0.4, 0, Math.cos(a) * 0.4));
  }
  for (let k = 0; k < 36; k++) {
    const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * 0.52;
    b.add(P.sphere(rng.range(0.025, 0.06), 0), { color: c(k % 3 ? 0x502619 : 0xf99026) }, M.t(Math.cos(a) * r, 0.075, Math.sin(a) * r, 0, a, 0, 1, 0.5, 1));
  }
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2, x = Math.cos(a) * 1.24, z = Math.sin(a) * 1.24;
    b.add(P.cyl(0.115, 0.14, 0.64, 7), { color: K.timberDark }, M.t(x, 0.32, z));
    b.add(P.cyl(0.128, 0.132, 0.17, 7), { color: K.red }, M.t(x, 0.43, z));
    for (let j = 0; j < 7; j++) {
      const t = j / 7 * Math.PI * 2;
      b.add(P.cone(0.035, 0.09, 3), { color: K.gold }, M.t(x + Math.cos(t) * 0.127, 0.43, z + Math.sin(t) * 0.127, 0, -t, 0));
    }
  }
  // Gravel scuffed across the trampled ground: grey and buff stones, thickest near the hearth.
  const gravel = [K.stoneDark, c(0x8d877c), c(0x9c9184), c(0x6f6a62), c(0xb3a58e)];
  for (let k = 0; k < 90; k++) {
    const a = rng.range(0, Math.PI * 2), r = 0.78 + Math.pow(rng.next(), 1.6) * 0.78, s = rng.range(0.015, 0.05);
    b.add(P.sphere(s, 0), { color: gravel[k % gravel.length] }, M.t(Math.cos(a) * r, 0.018 + s * 0.3, Math.sin(a) * r, rng.next(), a, rng.next(), 1.2, 0.55, 1));
  }
  // A few kicked-up clods of earth.
  for (let k = 0; k < 10; k++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(0.95, 1.5);
    b.add(lumpy(P.sphere(rng.range(0.04, 0.07), 1), 0.3, 300 + k, 0.6), { color: c(0x5c442e) }, M.t(Math.cos(a) * r, 0.02, Math.sin(a) * r, 0, a, 0, 1.3, 0.45, 1));
  }
  return { finished: b.build(), torches: [new THREE.Vector3(0, 0.12, 0)], height: 1.8 };
}

/** Firepit: a stone-lined pit with a whole pig roasting on a spit between forked posts. */
export function firepitModel(): BuildingModel {
  const b = new GeoBuilder();
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    b.add(lumpy(P.sphere(0.15, 1), 0.2, 120 + k, 0.65), { color: K.stoneDark }, M.t(Math.cos(a) * 0.68, 0.09, Math.sin(a) * 0.52));
  }
  b.add(P.cyl(0.64, 0.68, 0.05, 16), { color: c(0x3a2a22) }, M.t(0, 0.015, 0, 0, 0, 0, 1, 1, 0.72));
  for (let k = 0; k < 4; k++) b.add(P.cyl(0.035, 0.035, 0.5, 5), { color: c(0x2e2018) }, M.t(0, 0.06, 0, Math.PI / 2, (k / 4) * Math.PI, 0));
  b.add(P.sphere(0.14, 0), { color: c(0xe8702a) }, M.t(0, 0.08, 0, 0, 0, 0, 1.6, 0.4, 1.1));
  // Small glowing coals and charred split logs give the enlarged hearth depth.
  const coals = new RNG(772);
  for (let k = 0; k < 36; k++) {
    const a = coals.range(0, Math.PI * 2), r = Math.sqrt(coals.next()) * 0.48;
    b.add(P.sphere(coals.range(0.025, 0.055), 0), { color: c(k % 3 ? 0x72351c : 0xfda13b) }, M.t(Math.cos(a) * r, 0.07, Math.sin(a) * r * 0.72, 0, a, 0, 1, 0.55, 1));
  }
  for (let k = 0; k < 5; k++) {
    b.add(P.cyl(0.055, 0.07, 0.78, 6), { color: K.timberDark }, M.t(0, 0.11 + k * 0.018, 0, Math.PI / 2, k * 1.7, 0.1));
  }
  // Forked posts and the spit (low, so the pig hangs just above the embers).
  const spitY = 0.42;
  for (const x of [-0.66, 0.66]) {
    b.add(P.cyl(0.024, 0.03, spitY + 0.02, 5), { color: K.timber }, M.t(x, (spitY + 0.02) / 2, 0));
    b.add(P.cyl(0.016, 0.016, 0.11, 4), { color: K.timber }, M.t(x - 0.028, spitY + 0.05, 0, 0, 0, 0.5));
    b.add(P.cyl(0.016, 0.016, 0.11, 4), { color: K.timber }, M.t(x + 0.028, spitY + 0.05, 0, 0, 0, -0.5));
  }
  b.add(P.cyl(0.012, 0.012, 1.46, 5), { color: K.timberDark }, M.t(0, spitY, 0, 0, 0, Math.PI / 2));
  b.add(P.box(0.024, 0.13, 0.024), { color: K.timberDark }, M.t(0.74, spitY - 0.06, 0));
  // Roast pig (a suckling pig, about two thirds of an islander long): golden-brown body, head,
  // snout, ears and trotters. Laid out at full size about the spit, shrunk by S and centred on the pit.
  const S = 0.5, ox = -0.09;
  const pm = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
    M.t(S * (x + ox), spitY + S * y, S * z, rx, ry, rz, S * sx, S * sy, S * sz);
  const pig = (p: THREE.Vector3, n: THREE.Vector3) => c(0xb86a32).lerp(c(0xe0a060), Math.max(0, n.y) * 0.6).lerp(c(0x6e3418), Math.max(0, -n.y) * 0.4 + (Math.sin(p.x * 60) > 0.8 ? 0.2 : 0));
  b.add(P.sphere(0.2, 1), { color: pig }, pm(0, 0, 0, 0, 0, 0, 1.6, 0.85, 0.9));
  b.add(P.sphere(0.12, 1), { color: pig }, pm(0.34, 0.02, 0, 0, 0, 0, 1.1, 0.95, 0.95));
  b.add(P.cyl(0.05, 0.06, 0.07, 6), { color: c(0x9a5028) }, pm(0.47, 0.01, 0, 0, 0, Math.PI / 2));
  for (const z of [-1, 1]) b.add(P.cone(0.04, 0.07, 4), { color: c(0x8a4a24) }, pm(0.32, 0.13, z * 0.06, 0, 0, -0.4));
  for (const [x, z] of [[0.18, 1], [0.18, -1], [-0.2, 1], [-0.2, -1]]) b.add(P.cyl(0.025, 0.02, 0.14, 5), { color: c(0x7a3e1e) }, pm(x, -0.12, z * 0.09, z * 0.5, 0, 0));
  // A basket and a pot beside it.
  b.add(P.cyl(0.14, 0.11, 0.14, 8), { color: K.rope }, M.t(-0.75, 0.07, 0.6));
  b.add(P.uvSphere(0.11, 8, 6), { color: K.terracotta }, M.t(0.8, 0.1, 0.6, 0, 0, 0, 1, 0.9, 1));
  return { finished: b.build(), torches: [new THREE.Vector3(0, 0.20, 0), new THREE.Vector3(-0.22, 0.16, 0.04), new THREE.Vector3(0.20, 0.15, -0.08)], height: 1.3 };
}

/** Well: a round stone well with a timber frame, rope and bucket under a little tiled roof. */
export function wellModel(): BuildingModel {
  const b = new GeoBuilder();
  b.add(P.box(1.9, 0.04, 1.9), { color: CUT.stoneDark }, M.t(0, 0.02, 0));
  flagstones(b, -0.9, -0.9, 6, 6, 0.3, 0.02, (i, j) => ((i * 3 + j * 5) % 4 === 0 ? c(0xc9b494) : (i + j) % 2 ? c(0xdcc8a4) : c(0xd0bb95)));
  b.add(P.cyl(0.46, 0.5, 0.5, 12), { color: (p) => ((Math.floor(p.y * 8) + Math.floor(Math.atan2(p.z, p.x) * 3)) % 2 ? CUT.stone : CUT.stoneDark).clone() }, M.t(0, 0.25, 0));
  b.add(P.cyl(0.5, 0.5, 0.06, 12), { color: K.red }, M.t(0, 0.36, 0));
  b.add(P.cyl(0.52, 0.52, 0.06, 12), { color: CUT.stoneLight }, M.t(0, 0.52, 0));
  b.add(P.cyl(0.08, 0.065, 0.1, 8), { color: K.timber }, M.t(0.42, 0.6, 0.18));
  frettedPot(b, -0.72, 0.04, -0.6, 0.7);
  b.add(P.cyl(0.36, 0.36, 0.02, 12), { color: c(0x1f5a78) }, M.t(0, 0.4, 0));
  for (const x of [-0.52, 0.52]) b.add(P.cyl(0.035, 0.04, 1.05, 6), { color: K.timber }, M.t(x, 0.8, 0));
  b.add(P.cyl(0.04, 0.04, 1.14, 6), { color: K.timberDark }, M.t(0, 1.12, 0, 0, 0, Math.PI / 2));
  b.add(P.cyl(0.07, 0.07, 0.22, 8), { color: K.rope }, M.t(0, 1.12, 0, 0, 0, Math.PI / 2));
  b.add(P.cyl(0.008, 0.008, 0.36, 3), { color: K.rope }, M.t(0, 0.92, 0));
  b.add(P.cyl(0.08, 0.065, 0.12, 8), { color: K.timber }, M.t(0, 0.7, 0));
  b.add(P.box(0.04, 0.04, 0.2), { color: K.timberDark }, M.t(0.62, 1.12, 0.1));
  // Little roof.
  for (const s of [-1, 1]) b.add(P.box(1.3, 0.05, 0.62), { color: (p) => ((p.x * 8) % 1 < 0.5 ? K.terracotta : c(0x9a3a26)).clone() }, M.t(0, 1.42, s * 0.24, s * 0.62, 0, 0));
  b.add(P.box(1.34, 0.06, 0.06), { color: K.timberDark }, M.t(0, 1.58, 0));
  // A flower pot and a trough.
  b.add(P.uvSphere(0.1, 8, 6), { color: K.terracotta }, M.t(0.7, 0.08, 0.55));
  b.add(P.sphere(0.1, 0), { color: c(0x4f8038), leaf: 1 }, M.t(0.7, 0.2, 0.55));
  b.add(P.box(0.5, 0.14, 0.2), { color: CUT.stone }, M.t(-0.55, 0.07, 0.62));
  b.add(P.box(0.44, 0.02, 0.14), { color: c(0x2f7fa0) }, M.t(-0.55, 0.13, 0.62));
  return { finished: b.build(), torches: [], height: 1.7 };
}

/** A little gabled dog house (door toward +z of its frame), optionally with a paw sign. */
function dogHouse(b: GeoBuilder, x: number, z: number, ry: number, s: number, paw: boolean): void {
  const m = M.t(x, 0, z, 0, ry, 0);
  const at = (px: number, py: number, pz: number, rx = 0, rz = 0) => m.clone().multiply(M.t(px * s, py * s, pz * s, rx, 0, rz));
  b.add(P.box(0.3 * s, 0.2 * s, 0.34 * s), { color: K.timber }, at(0, 0.12, 0));
  b.add(P.box(0.13 * s, 0.13 * s, 0.01), { color: c(0x2a1c14) }, at(0, 0.09, 0.172));
  for (const side of [-1, 1]) b.add(P.box(0.2 * s, 0.025 * s, 0.4 * s), { color: K.timberDark }, at(side * 0.085, 0.27, 0, 0, -side * 0.62));
  b.add(P.box(0.03 * s, 0.03 * s, 0.42 * s), { color: K.timberDark }, at(0, 0.335, 0));
  b.add(lumpy(P.sphere(0.07 * s, 0), 0.3, 4, 0.4), { color: PEN.straw }, at(0, 0.03, 0.12));
  if (paw) {
    b.add(P.box(0.1 * s, 0.1 * s, 0.01), { color: c(0x3f6f9a) }, at(0, 0.275, 0.2));
    pawPrint(b, at(0, 0.275, 0.205), 0.04 * s, AD.cream);
  }
}

/**
 * Dog Kennel: a stone kennel house with a blue stepped-fret band, a chimney, and a blue curtain
 * marked with a paw over its door; a slatted shade on blue-banded posts over two little dog houses;
 * water and food bowls, a basket of scraps, a big jar and a leash rack, all in a paved run behind a
 * rope-lashed rail fence with a gate. Door faces +z.
 */
export function kennelModel(): BuildingModel {
  const b = new GeoBuilder(), rng = new RNG(616);
  const blue = c(0x3f6f9a);
  b.add(qbox(1.9, 0.05, 1.9, 0.02, 1), { color: PEN.dust }, M.t(0, 0.025, 0));
  flagstones(b, -0.82, -0.82, 6, 6, 1.64 / 6, 0.05, (i, j) => ((i * 5 + j * 3) % 4 === 0 ? c(0xc2ad8a) : (i + j) % 2 ? c(0xd6c3a0) : c(0xcbb692)));
  // Kennel house at the back right.
  const hx = 0.42, hz = -0.5, hw = 0.8, hd = 0.66, hh = 0.56;
  stoneBlock(b, hw, hh, hd, hx, 0.05, hz);
  fretBand(b, M.t(hx, 0.05 + hh - 0.1, hz + hd / 2 + 0.004), hw - 0.04, 0.09, blue, AD.cream);
  fretBand(b, M.t(hx - hw / 2 - 0.004, 0.05 + hh - 0.1, hz, 0, -Math.PI / 2, 0), hd - 0.04, 0.09, blue, AD.cream);
  b.add(qbox(0.12, 0.2, 0.12, 0.015, 1), { color: CUT.stone }, M.t(hx - 0.22, 0.05 + hh + 0.1, hz - 0.18));
  b.add(P.box(0.08, 0.02, 0.08), { color: c(0x3a2a20) }, M.t(hx - 0.22, 0.05 + hh + 0.2, hz - 0.18));
  const dz = hz + hd / 2;
  b.add(P.box(0.26, 0.36, 0.02), { color: c(0x2a1c14) }, M.t(hx + 0.08, 0.05 + 0.18, dz + 0.004));
  b.add(P.box(0.34, 0.05, 0.08), { color: K.timber }, M.t(hx + 0.08, 0.05 + 0.38, dz + 0.03));
  b.add(P.box(0.22, 0.26, 0.012), { color: blue, sway: 0.15 }, M.t(hx + 0.08, 0.05 + 0.22, dz + 0.02));
  pawPrint(b, M.t(hx + 0.08, 0.05 + 0.22, dz + 0.026), 0.07, AD.cream);
  // Shade over the dog houses: blue-banded posts and a slatted roof.
  for (const [x, z] of [[-0.85, -0.82], [-0.06, -0.82], [-0.85, 0.08], [-0.06, 0.08]] as const) {
    b.add(P.cyl(0.03, 0.035, 0.64, 5), { color: K.timberDark }, M.t(x, 0.32, z));
    for (const y of [0.42, 0.5]) b.add(P.cyl(0.036, 0.036, 0.03, 6), { color: blue }, M.t(x, y, z));
  }
  slatRoof(b, -0.45, 0.66, -0.37, 0.98, 1.06, 0.06, rng);
  dogHouse(b, -0.64, -0.5, 0.25, 1, false);
  dogHouse(b, -0.22, -0.56, -0.2, 0.92, true);
  // Bowls, a scraps basket, a jar and the leash rack.
  b.add(P.cyl(0.08, 0.065, 0.045, 10), { color: blue }, M.t(0.05, 0.075, 0.25));
  b.add(P.cyl(0.066, 0.066, 0.01, 10), { color: c(0x2f7fa0) }, M.t(0.05, 0.095, 0.25));
  b.add(P.cyl(0.08, 0.065, 0.045, 10), { color: K.terracotta }, M.t(0.3, 0.075, 0.5));
  for (let k = 0; k < 5; k++) b.add(P.sphere(0.022, 0), { color: c(0x8a3a2a) }, M.t(0.3 + rng.range(-0.04, 0.04), 0.1, 0.5 + rng.range(-0.04, 0.04)));
  heapBasket(b, 0.68, 0.05, 0.05, 0.09, 0.1, [0xb07a4a, 0xe8dcc0], rng);
  frettedPot(b, 0.78, 0.05, -0.12, 0.85);
  b.add(P.box(0.03, 0.42, 0.03), { color: K.timberDark }, M.t(0.86, 0.26, 0.32));
  b.add(P.box(0.03, 0.42, 0.03), { color: K.timberDark }, M.t(0.86, 0.26, 0.58));
  b.add(P.box(0.03, 0.03, 0.3), { color: K.timber }, M.t(0.86, 0.45, 0.45));
  for (const z of [0.38, 0.47, 0.54]) b.add(P.cyl(0.008, 0.008, 0.26, 4), { color: K.rope }, M.t(0.85, 0.33, z, 0.1, 0, 0));
  b.add(P.cyl(0.015, 0.015, 0.12, 4), { color: c(0xefe6d4) }, M.t(-0.3, 0.07, 0.35, 0, 0.6, Math.PI / 2));
  // Rope-lashed rail fence, with a gate at the front left swung inward.
  const E = 0.9, FH = 0.36;
  const runs: [number, number, number, number][] = [[-E, -E, E, -E], [E, -E, E, E], [-E, -E, -E, E], [-E, E, -0.6, E], [-0.15, E, E, E]];
  for (const [x0, z0, x1, z1] of runs) {
    const len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 0.36));
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n, z = z0 + ((z1 - z0) * k) / n;
      b.add(P.box(0.06, FH + 0.06, 0.06), { color: K.timberDark }, M.t(x, (FH + 0.06) / 2, z));
      b.add(P.cyl(0.04, 0.04, 0.03, 6), { color: K.rope }, M.t(x, FH * 0.6, z));
    }
    for (const y of [FH * 0.4, FH * 0.85]) b.add(P.box(0.035, 0.045, len), { color: K.timber }, M.t((x0 + x1) / 2, y, (z0 + z1) / 2, 0, a, 0));
  }
  const gate = M.t(-0.6, 0, E, 0, 0.9, 0);
  for (const y of [0.13, 0.3]) b.add(P.box(0.43, 0.04, 0.03), { color: K.timber }, gate.clone().multiply(M.t(0.22, y, 0)));
  b.add(P.box(0.03, 0.34, 0.03), { color: K.timber }, gate.clone().multiply(M.t(0.42, 0.2, 0)));
  b.add(P.box(0.5, 0.035, 0.03), { color: K.timberDark }, gate.clone().multiply(M.t(0.22, 0.21, 0, 0, 0, 0.6)));
  for (const [x, z] of [[-0.94, 0.5], [0.94, -0.6], [0.2, -0.94]] as const) blooms(b, x, 0.03, z, 3, 0.02, 0.08, Math.round(x * 40 + z * 13));
  const torch = torchPole(b, 0.78, 0.78, 0.62, 0.05);
  return { finished: b.build(), torches: [torch], height: 0.95 };
}

// ---------------- Adobe houses (levels 1–5) ----------------

const AD = {
  wall: c(0xcdb18a),
  wallLight: c(0xe3ccb0),
  roof: c(0xb99b76),
  band: c(0x9d7860),
  door: c(0x366c66),
  win: c(0x3a2721),
  red: c(0xa74a39),
  cream: c(0xf3e3c6),
  post: c(0x7a4a2a),
  pot: c(0xc4643a),
  leaf: c(0x4f9a3a),
  leafLight: c(0x7cc04a),
};

/** A plastered adobe block, lighter toward the top, with a low parapet around a flat roof. */
function adobeBlock(b: GeoBuilder, w: number, h: number, d: number, x: number, y: number, z: number, parapet = true): void {
  b.add(P.rbox(w, h, d, 0.035), { color: (p) => AD.wall.clone().lerp(AD.wallLight, Math.min(1, Math.max(0, (p.y - y) / h)) * 0.55) }, M.t(x, y + h / 2, z));
  // A painted red band under the coping on taller blocks (the village's shared trim).
  if (h >= 0.6) b.add(P.box(w + 0.012, 0.055, d + 0.012), { color: AD.red }, M.t(x, y + h - 0.13, z));
  if (!parapet) return;
  // Low, substantial coping gives the roof a finished silhouette.
  b.add(P.rbox(w + 0.025, 0.045, d + 0.025, 0.012, 1), { color: AD.wallLight }, M.t(x, y + h - 0.025, z));
  const t = 0.085, ph = 0.10;
  b.add(P.box(w, ph, t), { color: AD.wallLight }, M.t(x, y + h + ph / 2, z + d / 2 - t / 2));
  b.add(P.box(w, ph, t), { color: AD.wallLight }, M.t(x, y + h + ph / 2, z - d / 2 + t / 2));
  b.add(P.box(t, ph, d), { color: AD.wallLight }, M.t(x + w / 2 - t / 2, y + h + ph / 2, z));
  b.add(P.box(t, ph, d), { color: AD.wallLight }, M.t(x - w / 2 + t / 2, y + h + ph / 2, z));
  b.add(P.box(w - t * 2, 0.02, d - t * 2), { color: AD.roof }, M.t(x, y + h + 0.01, z));
}
/** Terracotta band around the foot of a wall. */
function baseBand(b: GeoBuilder, w: number, d: number, x: number, z: number, h = 0.16): void {
  b.add(P.rbox(w + 0.02, h, d + 0.02, 0.025, 1), { color: AD.band }, M.t(x, h / 2, z));
}
function tealDoor(b: GeoBuilder, x: number, y: number, z: number, w = 0.26, h = 0.46): void {
  // A sliver of light round the door at night (the door itself stays shut).
  glowSink?.push({ x, y: y + h / 2, z: z + 0.004, w: w + 0.07, h: h + 0.035, d: 0.03 });
  // Dark recess, timber door and projecting stone jambs/lintel.
  b.add(P.box(w + 0.065, h + 0.03, 0.035), { color: K.door }, M.t(x, y + h / 2, z));
  b.add(P.box(w * 0.86, h * 0.96, 0.018), { color: AD.door }, M.t(x, y + h * 0.48, z + 0.022));
  for (const side of [-1, 1]) b.add(P.box(0.045, h + 0.05, 0.07), { color: AD.wallLight }, M.t(x + side * (w / 2 + 0.035), y + h / 2, z + 0.015));
  b.add(P.rbox(w + 0.16, 0.065, 0.10, 0.012, 1), { color: K.stone }, M.t(x, y + h + 0.025, z + 0.025));
  b.add(P.box(w + 0.12, 0.035, 0.13), { color: K.stoneDark }, M.t(x, y + 0.012, z + 0.04));
}
function adobeWindow(b: GeoBuilder, x: number, y: number, z: number, side = false, w = 0.12, h = 0.18): void {
  glowSink?.push({ x, y, z, w: side ? 0.05 : w * 0.92, h: h * 0.92, d: side ? w * 0.92 : 0.05 });
  b.add(P.box(side ? 0.04 : w, h, side ? w : 0.04), { color: AD.win }, M.t(x, y, z));
  b.add(P.box(side ? 0.075 : w + 0.065, 0.035, side ? w + 0.065 : 0.075), { color: AD.wallLight }, M.t(x, y - h / 2 - 0.012, z));
}
/** Sloping cloth awning on two posts; striped red and cream, or plain red. */
function awning(b: GeoBuilder, x: number, y: number, z: number, w: number, d: number, striped: boolean): void {
  const n = striped ? 6 : 1;
  for (let k = 0; k < n; k++) {
    const sw = w / n;
    const col = striped ? (k % 2 ? AD.cream : AD.red) : AD.red;
    b.add(P.box(sw, 0.025, d), { color: col }, M.t(x - w / 2 + sw * (k + 0.5), y, z + d / 2, 0.22, 0, 0));
  }
  // Valance along the front edge.
  b.add(P.box(w, 0.07, 0.02), { color: AD.red }, M.t(x, y - 0.1, z + d * 0.97));
  for (const sx of [-1, 1]) b.add(P.cyl(0.025, 0.03, y, 5), { color: AD.post }, M.t(x + sx * (w / 2 - 0.03), y / 2, z + d * 0.95));
  b.add(P.box(w, 0.04, 0.04), { color: AD.post }, M.t(x, y - 0.03, z + d * 0.95));
}
function pottedPlant(b: GeoBuilder, x: number, y: number, z: number, s = 1): void {
  b.add(P.cyl(0.07 * s, 0.05 * s, 0.1 * s, 7), { color: AD.pot }, M.t(x, y + 0.05 * s, z));
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    b.add(P.cone(0.035 * s, 0.2 * s, 4), { color: k % 2 ? AD.leaf : AD.leafLight, sway: 0.4, leaf: 1 }, M.t(x + Math.cos(a) * 0.03 * s, y + 0.18 * s, z + Math.sin(a) * 0.03 * s, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5));
  }
}
function stairs(b: GeoBuilder, x: number, z: number, n: number, stepH: number, stepD: number, width: number, dirX: number): void {
  for (let k = 0; k < n; k++) {
    const h = stepH * (k + 1);
    b.add(P.box(stepD, h, width), { color: AD.wallLight }, M.t(x + dirX * k * stepD, h / 2, z));
  }
}

/**
 * Hut (level 1): the first homes, before the islanders have masonry. Entirely wood and thatch: a
 * plank floor, vertical plank walls between log corner posts and rails lashed with rope, plank
 * gable ends, an open doorway in a log frame, and a deep thatch of overlapping stick shingles
 * under a ridge log whose crossed ends stand above each gable. Door faces +z.
 */
export function hutModel(): BuildingModel {
  const b = new GeoBuilder();
  const rng = new RNG(911);
  const W = 1.1, D = 1.0, H = 0.6, hw = W / 2, hd = D / 2, rise = 0.42, eave = 0.2, side = 0.14;
  const LOG = c(0x8a5530), LOG_D = c(0x6e4124), ROPE = c(0xd6b06a), FLOOR = c(0x9a6a3a);
  const plank = () => c(0xb07a42).multiplyScalar(0.88 + rng.next() * 0.2);
  const straw = () => c(0xe49a3c).multiplyScalar(0.86 + rng.next() * 0.22);
  const lash = (x: number, y: number, z: number, r = 0.05) => b.add(P.torus(r, 0.008, 4, 10), { color: ROPE }, M.t(x, y, z, Math.PI / 2, 0, 0));
  // Plank floor on low sleepers, running out over the threshold.
  b.add(P.box(W + 0.08, 0.06, D + 0.08), { color: FLOOR }, M.t(0, 0.03, 0));
  for (let k = 0; k < 6; k++) b.add(P.box(0.012, 0.004, D + 0.06), { color: LOG_D }, M.t(-hw + (k + 0.5) * (W / 6), 0.062, 0));
  b.add(P.box(0.5, 0.05, 0.14), { color: FLOOR }, M.t(0, 0.035, hd + 0.08));
  // Walls of vertical planks (front: either side of the doorway; sides: rising into the gables).
  const door = 0.21, wallY = 0.06;
  const planks = (axis: 'x' | 'z', fixed: number, from: number, to: number, top: (u: number) => number) => {
    const n = Math.max(2, Math.round((to - from) / 0.1));
    for (let k = 0; k < n; k++) {
      const u = from + ((k + 0.5) * (to - from)) / n, h = top(u) - wallY, w = (to - from) / n - 0.008;
      const t = M.t(axis === 'x' ? u : fixed, wallY + h / 2, axis === 'x' ? fixed : u, 0, 0, 0, 1, 1, 1);
      b.add(P.box(axis === 'x' ? w : 0.035, h, axis === 'x' ? 0.035 : w), { color: plank() }, t);
    }
  };
  const flat = () => H;
  const gable = (z: number) => H + rise * (1 - Math.abs(z) / hd);
  planks('x', hd, -hw, -door, flat);
  planks('x', hd, door, hw, flat);
  planks('x', -hd, -hw, hw, flat);
  planks('z', -hw, -hd, hd, gable);
  planks('z', hw, -hd, hd, gable);
  // Above the doorway, and the dark room inside (firelight shows through the doorway at night).
  glowSink?.push({ x: 0, y: 0.3, z: hd - 0.02, w: door * 1.8, h: 0.44, d: 0.02 });
  b.add(P.box(door * 2, H - 0.5, 0.035), { color: plank() }, M.t(0, 0.5 + (H - 0.5) / 2, hd));
  b.add(P.box(W - 0.1, H - 0.08, 0.01), { color: c(0x3a2414) }, M.t(0, wallY + (H - 0.08) / 2, -hd + 0.03));
  b.add(P.box(W - 0.1, 0.01, D - 0.1), { color: c(0x5a3a20) }, M.t(0, 0.065, 0));
  // Doorway frame: two posts and a lintel, lashed.
  for (const x of [-door, door]) b.add(P.cyl(0.028, 0.03, 0.52, 7), { color: LOG }, M.t(x, 0.32, hd + 0.03));
  b.add(P.cyl(0.026, 0.026, door * 2 + 0.16, 7), { color: LOG }, M.t(0, 0.56, hd + 0.04, 0, 0, Math.PI / 2));
  for (const x of [-door, door]) lash(x, 0.56, hd + 0.04, 0.034);
  // Log corner posts with lashings top and bottom, and log rails along the wall tops.
  for (const [x, z] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]] as const) {
    b.add(P.cyl(0.042, 0.048, H + 0.08, 8), { color: LOG }, M.t(x, (H + 0.08) / 2, z));
    lash(x, H - 0.04, z); lash(x, 0.16, z);
  }
  for (const z of [-hd, hd]) b.add(P.cyl(0.032, 0.032, W + 0.16, 7), { color: LOG }, M.t(0, H, z + Math.sign(z) * 0.015, 0, 0, Math.PI / 2));
  for (const x of [-hw, hw]) b.add(P.cyl(0.03, 0.03, D + 0.12, 7), { color: LOG_D }, M.t(x + Math.sign(x) * 0.015, H - 0.02, 0, Math.PI / 2, 0, 0));
  // A collar beam and king post in each gable, lashed where they cross.
  for (const x of [-hw, hw]) {
    const sx = x + Math.sign(x) * 0.03;
    b.add(P.cyl(0.022, 0.022, D * 0.62, 6), { color: LOG_D }, M.t(sx, H + rise * 0.42, 0, Math.PI / 2, 0, 0));
    b.add(P.cyl(0.022, 0.022, rise * 0.95, 6), { color: LOG_D }, M.t(sx, H + rise * 0.5, 0));
    lash(sx, H + rise * 0.42, 0, 0.03);
  }
  // Thatch: two slopes of overlapping stick shingles. Each course lies over the top of the one
  // below it, so the slope steps down in three ragged rows to the eaves.
  const slopeLen = Math.hypot(hd + eave, rise), ang = Math.atan2(rise, hd + eave);
  const stick = (l: number) => P.rbox(0.06, 0.04, l, 0.014, 2);
  for (const s of [1, -1]) {
    const nrm = new THREE.Vector3(0, Math.cos(ang), s * Math.sin(ang));
    for (let row = 0; row < 3; row++) {
      const n = Math.round((W + side * 2) / 0.066);
      for (let k = 0; k < n; k++) {
        const x = -hw - side + (k + 0.5) * ((W + side * 2) / n) + (rng.next() - 0.5) * 0.012;
        const l = 0.36 + (rng.next() - 0.5) * 0.07;
        // Lower end of this course (distance down the slope from the ridge), ragged.
        const low = slopeLen * (1 - row * 0.3) + (rng.next() - 0.5) * 0.03;
        const mid = low - l / 2;
        const lift = 0.025 + row * 0.022;
        const px = x, py = H + rise + 0.05 - mid * Math.sin(ang) + nrm.y * lift, pz = s * mid * Math.cos(ang) + nrm.z * lift;
        b.add(stick(l), { color: straw(), leaf: 0.2 }, M.t(px, py, pz, s * ang + (rng.next() - 0.5) * 0.04, (rng.next() - 0.5) * 0.05, (rng.next() - 0.5) * 0.04));
      }
    }
    // The underlayer, so no light shows between the sticks.
    b.add(P.box(W + side * 2, 0.025, slopeLen), { color: c(0xa8742c), leaf: 0.2 },
      M.t(0, H + rise / 2 + 0.03, s * (hd + eave) / 2, s * ang, 0, 0));
  }
  // A bundled ridge cap along the top.
  b.add(P.cyl(0.06, 0.06, W + side * 2, 8), { color: c(0xc98e3c), leaf: 0.2 }, M.t(0, H + rise + 0.075, 0, 0, 0, Math.PI / 2, 1, 0.8, 1));
  // Ridge log, and log bargeboards down each gable edge, crossing just above the ridge and tied.
  const ridgeY = H + rise + 0.13;
  b.add(P.cyl(0.04, 0.04, W + side * 2 + 0.1, 8), { color: LOG }, M.t(0, ridgeY, 0, 0, 0, Math.PI / 2));
  for (const x of [-hw - side - 0.02, hw + side + 0.02]) {
    for (const s of [1, -1]) {
      // From the eave corner, up past the ridge.
      const ex = s * (hd + eave + 0.03), ey = H + 0.02;
      const ux = -s * (hd + eave), uy = rise + 0.11, ul = Math.hypot(ux, uy);
      const L = ul + 0.16, cx = ex + (ux / ul) * L / 2, cy = ey + (uy / ul) * L / 2;
      b.add(P.cyl(0.032, 0.034, L, 7), { color: LOG }, M.t(x, cy, cx, Math.atan2(ux, uy), 0, 0));
    }
    lash(x, ridgeY, 0, 0.05);
    b.add(P.box(0.012, 0.075, 0.075), { color: ROPE }, M.t(x, ridgeY, 0, Math.PI / 4, 0, 0));
  }
  return { finished: b.build(), torches: [], height: 1.25 };
}

/**
 * Home, levels 2–5 (tier 1–4): the adobe house grows with each upgrade.
 *  2: family home, two stacked blocks and a red awning (4 people)
 *  3: larger home, two wings and an upper room (7)
 *  4: village home, three storeys, outside stairs, courtyard wall (12)
 *  5: large house compound with a rooftop pergola (16)
 */
export function homeModel(tier = 1): BuildingModel {
  const b = new GeoBuilder();
  let height = 2;
  const torches: THREE.Vector3[] = [];
  if (tier <= 1) {
    baseBand(b, 1.9, 1.6, 0, -0.1);
    adobeBlock(b, 1.9, 1.0, 1.6, 0, 0, -0.1);
    adobeBlock(b, 1.0, 0.8, 0.95, -0.25, 1.0, -0.35);
    tealDoor(b, -0.35, 0.02, 0.71, 0.3, 0.55);
    fretBand(b, M.t(0, 0.87 - 0.2, 0.708), 1.86, 0.1, AD.red, AD.cream);
    adobeWindow(b, -0.45, 1.45, 0.14);
    adobeWindow(b, -0.05, 1.45, 0.14);
    adobeWindow(b, 0.96, 0.6, -0.2, true);
    awning(b, 0.45, 0.78, 0.7, 0.8, 0.5, false);
    pottedPlant(b, 0.2, 0, 0.95);
    pottedPlant(b, 0.8, 0, 1.0, 0.8);
    torches.push(torchPole(b, -1.05, 1.05));
    height = 2.2;
  } else if (tier === 2) {
    baseBand(b, 2.4, 1.7, 0, -0.1);
    adobeBlock(b, 1.4, 1.05, 1.7, -0.5, 0, -0.1);
    adobeBlock(b, 1.1, 1.3, 1.4, 0.65, 0, -0.25);
    adobeBlock(b, 0.9, 0.8, 0.9, -0.6, 1.05, -0.4);
    tealDoor(b, -0.45, 0.02, 0.76, 0.3, 0.55);
    fretBand(b, M.t(-0.5, 0.92 - 0.2, 0.758), 1.36, 0.1, AD.red, AD.cream);
    fretBand(b, M.t(0.65, 1.17 - 0.2, 0.458), 1.06, 0.1, AD.red, AD.cream);
    for (const x of [-0.8, -0.4]) adobeWindow(b, x, 1.5, 0.06);
    adobeWindow(b, 0.9, 0.95, 0.46);
    adobeWindow(b, 0.4, 0.95, 0.46);
    awning(b, -0.45, 0.8, 0.76, 0.9, 0.5, false);
    pottedPlant(b, 0.3, 0, 0.8);
    pottedPlant(b, 1.1, 0, 0.75, 1.2);
    pottedPlant(b, -1.1, 0, 0.9, 0.9);
    torches.push(torchPole(b, -1.2, 1.1), torchPole(b, 1.2, 1.0));
    height = 2.3;
  } else if (tier === 3) {
    baseBand(b, 2.6, 2.0, 0, -0.15);
    adobeBlock(b, 1.5, 1.1, 1.8, -0.55, 0, -0.25);
    adobeBlock(b, 1.1, 1.1, 1.2, 0.75, 0, -0.45);
    adobeBlock(b, 1.0, 0.9, 1.0, -0.65, 1.1, -0.5);
    adobeBlock(b, 0.75, 0.8, 0.75, -0.65, 2.0, -0.55);
    // Outside stairs up to the first roof.
    stairs(b, 0.3, 0.4, 6, 0.18, 0.13, 0.36, 1);
    tealDoor(b, -0.7, 0.02, 0.66, 0.3, 0.55);
    fretBand(b, M.t(-0.55, 0.97 - 0.2, 0.658), 1.46, 0.1, AD.red, AD.cream);
    for (const x of [-0.95, -0.4]) adobeWindow(b, x, 1.55, 0.01);
    adobeWindow(b, -0.65, 2.45, -0.17);
    adobeWindow(b, 0.8, 0.7, 0.16);
    awning(b, 0.55, 1.12, 0.15, 1.0, 0.6, true);
    // Courtyard wall.
    b.add(P.box(1.25, 0.35, 0.1), { color: AD.wallLight }, M.t(0.6, 0.18, 1.25));
    b.add(P.box(0.1, 0.35, 0.65), { color: AD.wallLight }, M.t(1.2, 0.18, 0.95));
    pottedPlant(b, 0.45, 0, 1.0);
    pottedPlant(b, 0.95, 0, 0.95, 1.2);
    pottedPlant(b, -0.95, 1.1, 0.25, 0.9);
    torches.push(torchPole(b, -1.25, 1.2), torchPole(b, 1.25, 1.3));
    height = 3.0;
  } else {
    baseBand(b, 2.8, 2.4, 0, -0.1);
    adobeBlock(b, 2.8, 1.0, 2.4, 0, 0, -0.1);
    adobeBlock(b, 1.9, 1.0, 1.6, -0.35, 1.0, -0.45);
    adobeBlock(b, 1.0, 0.9, 1.0, -0.6, 2.0, -0.6);
    adobeBlock(b, 0.8, 0.5, 0.8, 0.9, 1.0, 0.5);
    // Rooftop pergola with a striped canopy.
    for (const [px, pz] of [[-1.0, -0.2], [-0.2, -0.2], [-1.0, -1.0], [-0.2, -1.0]]) b.add(P.cyl(0.025, 0.03, 0.55, 5), { color: AD.post }, M.t(px, 2.9 + 0.27, pz));
    for (let k = 0; k < 6; k++) b.add(P.box(0.14, 0.025, 0.9), { color: k % 2 ? AD.cream : AD.red }, M.t(-1.0 + 0.07 + k * 0.134, 3.46, -0.6, 0, 0, 0.08));
    // Front door under a striped awning, stairs to the roof terrace.
    tealDoor(b, -0.4, 0.02, 1.11, 0.32, 0.6);
    fretBand(b, M.t(0, 0.87 - 0.2, 1.108), 2.76, 0.1, AD.red, AD.cream);
    sunBanner(b, M.t(0.55, 0.52, 1.118), 0.2, 0.36);
    awning(b, -0.4, 0.85, 1.11, 1.0, 0.45, true);
    stairs(b, 1.05, 1.2, 5, 0.2, 0.12, 0.34, -1);
    for (const x of [-1.05, 0.3]) adobeWindow(b, x, 0.6, 1.11);
    for (const x of [-0.9, 0.1]) adobeWindow(b, x, 1.55, 0.36);
    adobeWindow(b, -0.6, 2.45, -0.09);
    tealDoor(b, 0.9, 1.0, 0.91, 0.24, 0.36);
    // Front courtyard walls.
    b.add(P.box(1.0, 0.3, 0.1), { color: AD.wallLight }, M.t(-0.9, 0.15, 1.42));
    pottedPlant(b, 0.2, 0, 1.3);
    pottedPlant(b, -1.2, 0, 1.3, 1.2);
    pottedPlant(b, 0.4, 1.0, 0.9, 0.9);
    pottedPlant(b, -1.1, 2.0, 0.1, 0.8);
    torches.push(torchPole(b, -1.35, 1.35), torchPole(b, 1.35, 1.35, 0.6));
    height = 3.6;
  }
  return { finished: b.build(), torches, height };
}

/** Temple sandstone: warm, like the Great Hall and the palace. */
const TPL = { stone: c(0xdcb27a), dark: c(0xbf9864) };

/** Aztec stepped pyramid. Tier 1-3 (3 is the Great Pyramid with twin shrines). */
export function templeModel(tier: number): BuildingModel {
  const b = new GeoBuilder();
  const steps = tier === 1 ? 3 : tier === 2 ? 5 : 7;
  const base = tier === 3 ? 4.2 : 3.9;
  const top = tier === 3 ? 1.8 : 1.5;
  const sh = tier === 3 ? 0.52 : 0.46;
  for (let s = 0; s < steps; s++) {
    const t = s / Math.max(1, steps - 1);
    const size = base + (top - base) * t;
    const y = s * sh;
    b.add(P.rbox(size, sh, size, 0.05), { color: (p) => (p.y - y > sh * 0.35 ? TPL.stone : TPL.dark) }, M.t(0, y + sh / 2, 0));
    // Pale coping and a restrained mineral-painted frieze.
    b.add(P.rbox(size + 0.035, 0.065, size + 0.035, 0.015, 1), { color: TPL.stone }, M.t(0, y + sh - 0.025, 0));
    // A red band round every terrace, and a stepped fret either side of the stairs on the lowest.
    b.add(P.box(size + 0.012, 0.05, size + 0.012), { color: K.red }, M.t(0, y + sh * 0.7, 0));
    if (s === 0) {
      const run = size / 2 - 0.56;
      for (const sx of [-1, 1]) fretBand(b, M.t(sx * (0.56 + run / 2), y + sh * 0.38, size / 2 + 0.006), run - 0.06, 0.14, K.red, AD.cream);
    }
  }
  const H = steps * sh;
  // Staircase up the front face: solid stepped columns so the profile reads cleanly.
  const stairN = steps * 3;
  const run = (base - top) / 2;
  const zf = (k: number) => base / 2 + 0.06 - (k / stairN) * (run + 0.06);
  for (let k = 0; k < stairN; k++) {
    const yTop = ((k + 1) / stairN) * H;
    const z0 = zf(k), z1 = zf(k + 1);
    // Treads stand a hair proud of the terraces they cut into, so the treads and the terrace tops never
    // share a plane (that flickered as the camera moved).
    const yT = yTop + 0.008;
    b.add(P.box(0.82, yT, z0 - z1 + 0.02), { color: (p) => (p.y > yT - 0.04 ? TPL.stone : TPL.dark) }, M.t(0, yT / 2, (z0 + z1) / 2));
  }
  // Sloped balustrades either side of the stairs.
  const slope = Math.atan2(H, run + 0.06);
  const len = Math.hypot(H, run + 0.06);
  for (const x of [-0.47, 0.47]) {
    b.add(P.box(0.13, 0.16, len), { color: TPL.dark }, M.t(x, H / 2 + 0.06, (zf(0) + zf(stairN)) / 2, slope, 0, 0));
  }
  const torches: THREE.Vector3[] = [];
  const shrine = (x: number, col: THREE.Color, w: number) => {
    b.add(P.rbox(w, 0.7, w * 0.8, 0.04), { color: TPL.stone }, M.t(x, H + 0.35, -0.1));
    b.add(P.box(w * 0.4, 0.45, 0.06), { color: K.door }, M.t(x, H + 0.26, -0.1 + w * 0.4));
    b.add(P.rbox(w + 0.14, 0.14, w * 0.8 + 0.14, 0.03), { color: col }, M.t(x, H + 0.76, -0.1));
    b.add(P.rbox(w * 0.8, 0.3, w * 0.64, 0.05), { color: col.clone().multiplyScalar(0.85) }, M.t(x, H + 0.98, -0.1));
    b.add(P.box(w * 0.55, 0.07, w * 0.55), { color: col }, M.t(x, H + 1.16, -0.1));
    b.add(P.box(0.16, 0.16, 0.025), { color: K.gold }, M.t(x, H + 0.98, -0.085 + w * 0.32));
    b.add(P.box(0.075, 0.075, 0.028), { color: col }, M.t(x, H + 0.98, -0.08 + w * 0.32));
    for (const side of [-1, 1]) b.add(P.box(0.07, 0.48, 0.09), { color: K.plaster }, M.t(x + side * w * 0.25, H + 0.26, -0.07 + w * 0.4));
    b.add(P.box(w * 0.66, 0.08, 0.10), { color: K.plaster }, M.t(x, H + 0.52, -0.07 + w * 0.4));
  };
  if (tier < 3) shrine(0, tier === 1 ? K.plaster : K.terracotta, tier === 1 ? 0.9 : 1.1);
  else {
    shrine(-0.45, K.red, 0.78);
    shrine(0.45, K.blue, 0.78);
  }
  const tt = top / 2 - 0.12;
  torches.push(torchPole(b, -tt, tt, 0.5, H), torchPole(b, tt, tt, 0.5, H));
  // Braziers at the foot of the stairs.
  const bz = base / 2 + 0.35;
  for (const x of [-0.75, 0.75]) {
    b.add(P.cyl(0.12, 0.08, 0.4, 8), { color: TPL.dark }, M.t(x, 0.2, bz));
    b.add(P.cyl(0.16, 0.1, 0.1, 8), { color: K.gold }, M.t(x, 0.44, bz));
    torches.push(new THREE.Vector3(x, 0.55, bz));
  }
  return { finished: b.build(), torches, height: H + 1.3 };
}

/** Monumental twin sanctuary: broad sandstone terraces, red/turquoise crowns and sun banners. */
export function greatTempleModel(): BuildingModel {
  const b = new GeoBuilder(), torches: THREE.Vector3[] = [];
  const stone = c(0xd9bd8b), shade = c(0xb69b74), turquoise = c(0x227f80);
  const masonry = (p: THREE.Vector3, n: THREE.Vector3) =>
    (n.y > 0.5 ? stone : shade).clone().multiplyScalar(0.97 + 0.035 * Math.sin(Math.floor(p.x * 3) * 21 + Math.floor(p.z * 3) * 13 + Math.floor(p.y * 4) * 7));
  const terrace = (base: number, top: number, y: number, h: number) => {
    b.add(P.cyl(top / Math.SQRT2, base / Math.SQRT2, h, 4), { color: masonry }, M.t(0,y+h/2,0,0,Math.PI/4,0));
    b.add(P.box(top+0.16,0.12,top+0.16), { color: stone }, M.t(0,y+h+0.06,0));
    // Recessed courses and staggered blocks on the sloping faces, kept clear of the main stair.
    for (let face=0;face<4;face++) for (let row=0;row<5;row++) {
      const f=(row+0.5)/5, size=base+(top-base)*f;
      const m=M.t(0,y+f*h,0,0,face*Math.PI/2,0);
      for(let x=-size/2+0.25+(row%2)*0.2;x<size/2-0.2;x+=0.5) {
        if(face===0 && Math.abs(x)<1.05) continue;
        b.add(P.box(0.47,0.022,0.026),{color:shade.clone().multiplyScalar(0.85)},m.clone().multiply(M.t(x,0,size/2+0.009)));
      }
    }
  };
  b.add(P.box(7.95,0.12,7.95),{color:shade},M.t(0,0.06,0));
  const phases=[b.indexCount];
  terrace(7.8,6.6,0.12,1.72);
  terrace(5.9,4.8,1.96,1.72);
  phases.push(b.indexCount);
  const H=3.8;
  // Separate flights follow each sloping face, with a level landing on the terrace.
  // Keeping every tread outside the masonry avoids the terraces cutting through the stairs.
  const stair = (yaw:number,width:number) => {
    const m=M.t(0,0,0,0,yaw,0);
    for(const [y0,y1,z0,z1] of [[0.12,1.96,3.99,3.32],[1.96,H,2.99,2.43]]) {
      const count=14, run=(z0-z1)/count;
      for(let k=0;k<count;k++) {
        const h=y0+(y1-y0)*(k+1)/count+0.016;
        b.add(P.box(width,h,run+0.016),{color:masonry},m.clone().multiply(M.t(0,h/2,z0-(k+0.5)*run)));
      }
      const angle=Math.atan2(y1-y0,z0-z1), length=Math.hypot(y1-y0,z0-z1);
      for(const side of [-1,1]) {
        const rail=m.clone().multiply(M.t(side*(width/2+0.12),(y0+y1)/2+0.09,(z0+z1)/2,angle,0,0));
        b.add(P.box(0.17,0.16,length),{color:stone},rail);
        b.add(P.box(0.07,0.024,length),{color:side<0?K.red:turquoise},rail.clone().multiply(M.t(0,0.091,0)));
      }
    }
    b.add(P.box(width,0.035,0.36),{color:stone},m.clone().multiply(M.t(0,1.974,3.145)));
  };
  stair(0,1.45); stair(Math.PI/2,0.7); stair(-Math.PI/2,0.7);
  phases.push(b.indexCount);
  const shrine = (x:number,col:THREE.Color) => {
    const z=-0.55, w=1.58;
    b.add(P.cyl(1.25/Math.SQRT2,w/Math.SQRT2,1.55,4),{color:masonry},M.t(x,H+0.775,z,0,Math.PI/4,0));
    // Deep dark doorway framed by sandstone lintels; crown echoes the reference's stepped glyph.
    b.add(P.box(0.51,1.04,0.04),{color:K.door},M.t(x,H+0.52,z+0.8));
    for(const side of [-1,1]) b.add(P.box(0.14,1.15,0.16),{color:stone},M.t(x+side*0.33,H+0.57,z+0.83));
    b.add(P.box(0.87,0.15,0.17),{color:col},M.t(x,H+1.2,z+0.83));
    b.add(P.box(1.42,0.17,1.42),{color:col},M.t(x,H+1.54,z));
    b.add(P.box(1.14,0.65,1.12),{color:col},M.t(x,H+1.92,z));
    b.add(P.box(0.6,0.24,0.75),{color:col.clone().multiplyScalar(0.92)},M.t(x,H+2.34,z));
    for(const side of [-1,1]) {
      b.add(P.box(0.19,0.2,0.03),{color:K.gold},M.t(x+side*0.35,H+1.98,z+0.576));
      b.add(P.box(0.075,0.085,0.037),{color:col},M.t(x+side*0.35,H+1.98,z+0.59));
    }
    for(let k=0;k<7;k++) b.add(P.box(0.08,0.075,0.035),{color:K.gold},M.t(x-0.6+k*0.2,H+1.56,z+0.722));
    b.add(P.box(0.4,0.25,0.09),{color:K.gold},M.t(x,H+1.67,z+0.76));
    b.add(P.box(0.18,0.11,0.025),{color:col},M.t(x,H+1.69,z+0.815));
  };
  shrine(-1.1,K.red); shrine(1.1,turquoise);
  const brazier = (x:number,y:number,z:number, foot=0.48, plinth=0.14) => {
    b.add(P.box(foot,plinth,foot),{color:shade},M.t(x,y+plinth/2,z));
    y += plinth - 0.14;
    b.add(P.box(0.32,0.34,0.32),{color:stone},M.t(x,y+0.29,z));
    b.add(P.box(0.52,0.09,0.52),{color:K.gold},M.t(x,y+0.5,z));
    b.add(P.box(0.36,0.035,0.36),{color:c(0x46352b)},M.t(x,y+0.56,z));
    torches.push(new THREE.Vector3(x,y+0.6,z));
  };
  for(const side of [-1,1]) {
    // Tall front plinths clear the sloping foundation; terrace fires stay outside the next tier.
    brazier(side*1.18,0.12,3.94,0.36,0.48);
    brazier(side*2.68,1.96,3.18);
    brazier(side*1.98,H,1.97);
    brazier(side*1.98,H,-1.95);
    sunBanner(b,M.t(side*2.0,0.99,3.68,-Math.atan2(0.6,1.72),0,0),0.66,1.22);
    sunBanner(b,M.t(side*1.55,2.85,2.75,-Math.atan2(0.55,1.72),0,0),0.6,1.25);
    sunBanner(b,M.t(side*3.70,1.0,side*1.9,0,side*Math.PI/2,0).multiply(M.t(0,0,0,-Math.atan2(0.6,1.72),0,0)),0.65,1.2);
    for(const [x,y,z] of [[3.3,0.12,2.65],[2.8,1.96,0.8],[1.8,H,-1.75]]) {
      broadLeaf(b,side*x,y,z,1.8,Math.round(x*31+side));
      fern(b,side*(x-0.25),y,z+0.15,1.1,Math.round(x*50+side));
    }
  }
  const r=new RNG(731);
  for(let i=0;i<26;i++) {
    const side=i%2?1:-1,x=side*r.range(3.55,3.83),z=r.range(-3.65,3.55);
    b.add(lumpy(P.sphere(0.14,0),0.18,i),{color:shade},M.t(x,0.14,z,0,r.next()*6,0,1.3,0.8,1));
  }
  phases.push(b.indexCount);
  const finished=b.build();finished.userData.constructionPhases=phases;
  return {finished,torches,height:H+2.48};
}

/** Farm: fence with a gate, a small shelter and a scarecrow. Crops are a separate mesh. */
export function farmModel(w: number, d: number, kind: 'veg' | 'maize' = 'veg'): BuildingModel {
  const b = new GeoBuilder();
  const hw = w / 2 - 0.1, hd = d / 2 - 0.1;
  const post = (x: number, z: number) => b.add(P.cyl(0.035, 0.04, 0.42, 5), { color: K.timber }, M.t(x, 0.21, z));
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const a = Math.atan2(x1 - x0, z1 - z0);
    for (const y of [0.18, 0.34]) b.add(P.box(0.03, 0.03, len), { color: K.timberDark }, M.t((x0 + x1) / 2, y, (z0 + z1) / 2, 0, a, 0));
  };
  const pts: [number, number][] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  for (let k = 0; k < 4; k++) {
    const [x0, z0] = pts[k], [x1, z1] = pts[(k + 1) % 4];
    const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.9);
    for (let s = 0; s <= n; s++) post(x0 + ((x1 - x0) * s) / n, z0 + ((z1 - z0) * s) / n);
    if (k === 2) {
      // Front side (z = +hd) with a gate gap in the middle.
      rail(x0, z0, 0.5, z1);
      rail(-0.5, z0, x1, z1);
    } else rail(x0, z0, x1, z1);
  }
  // Earthed-up planting ridges under each crop row (the crops mesh stands on them).
  const rows = kind === 'maize' ? maizeLayout(w, d) : vegLayout(w, d);
  // Hoed by hand: each ridge a run of overlapping mounds, wandering a little side to side and
  // swelling and slumping along its length, with clods turned up beside it.
  const soilTop = c(0x6e4a2c), soilSide = c(0x563823), clod = c(0x5e3e24);
  const srng = new RNG(Math.round(w * 31 + d * 7) + (kind === 'maize' ? 1 : 0));
  for (const r of rows) {
    if (!r.zs.length) continue;
    const z0 = Math.min(...r.zs) - 0.2, z1 = Math.max(...r.zs) + 0.2;
    const rw = kind === 'maize' ? 0.13 : 0.17;
    // One mound along the row: its line wanders, it swells and slumps, flattened into a ridge.
    const ph = srng.range(0, 6), ph2 = srng.range(0, 6);
    const pts: THREE.Vector3[] = [];
    const n = Math.max(3, Math.round((z1 - z0) / 0.3));
    for (let k = 0; k <= n; k++) pts.push(new THREE.Vector3(r.x + Math.sin(k * 1.3 + ph) * 0.02 + srng.range(-0.01, 0.01), 0, z0 + ((z1 - z0) * k) / n));
    const ridge = outward(tube(pts, (t) => rw * (1 + Math.sin(t * 9 + ph2) * 0.07 + Math.sin(t * 23 + ph) * 0.04) * Math.min(1, Math.sin(Math.PI * t) * 6 + 0.35), 5, n * 2));
    b.add(ridge, { color: (_p, nn) => soilSide.clone().lerp(soilTop, THREE.MathUtils.smoothstep(nn.y, 0.2, 0.8)) }, new THREE.Matrix4().makeScale(1, 0.32, 1));
    for (let k = 0; k < Math.round((z1 - z0) * 3); k++) {
      const side = srng.next() < 0.5 ? -1 : 1;
      b.add(P.sphere(srng.range(0.018, 0.035), 0), { color: clod.clone().multiplyScalar(srng.range(0.85, 1.1)) },
        M.t(r.x + side * (rw + srng.range(0.0, 0.05)), 0.005, srng.range(z0, z1), srng.range(0, 3), srng.range(0, 3), 0, 1, 0.6, 1));
    }
  }
  if (kind === 'maize') {
    // Cuexcomatl: a raised maize crib of woven cane on a stone base, with a thatched cap.
    const gx = -hw + 0.6, gz = -hd + 0.6;
    b.add(P.cyl(0.36, 0.4, 0.2, 8), { color: K.stone }, M.t(gx, 0.1, gz));
    b.add(P.cyl(0.33, 0.36, 0.62, 10), { color: (p) => ((p.y * 12) % 1 < 0.5 ? K.thatchDark : K.adobe).clone() }, M.t(gx, 0.51, gz));
    b.add(P.cone(0.46, 0.38, 10), { color: thatchColor, leaf: 0.2 }, M.t(gx, 1.0, gz));
    for (let k = 0; k < 5; k++) b.add(P.cyl(0.035, 0.03, 0.12, 5), { color: k % 2 ? K.gold : c(0xd88a2a) }, M.t(gx + 0.36 + (k % 3) * 0.07, 0.07, gz + 0.1 + Math.floor(k / 3) * 0.08, Math.PI / 2, k, 0));
  }
  if (kind === 'veg') {
    // Chicken run: straw on the ground, a low inner fence, and a little thatched coop on stilts.
    const S = FARM_PEN.size, [px, pz] = FARM_PEN.centre(w, d);
    const x0 = px - S / 2, z0 = pz - S / 2;
    b.add(P.box(S - 0.06, 0.02, S - 0.06), { color: c(0xc9a45c) }, M.t(px, 0.01, pz));
    for (const [ax, az, bx, bz] of [[x0, z0, x0 + S, z0], [x0, z0, x0, z0 + S]] as const) {
      const len = Math.hypot(bx - ax, bz - az), a = Math.atan2(bx - ax, bz - az);
      for (const y of [0.1, 0.2]) b.add(P.box(0.022, 0.022, len), { color: K.timberDark }, M.t((ax + bx) / 2, y, (az + bz) / 2, 0, a, 0));
      for (let k = 0; k <= 3; k++) b.add(P.cyl(0.02, 0.024, 0.26, 4), { color: K.timber }, M.t(ax + ((bx - ax) * k) / 3, 0.13, az + ((bz - az) * k) / 3));
    }
    const hx = px + S / 2 - 0.26, hz = pz - S / 2 + 0.24;
    for (const [ox, oz] of [[-0.14, -0.12], [0.14, -0.12], [-0.14, 0.12], [0.14, 0.12]]) b.add(P.cyl(0.018, 0.018, 0.14, 4), { color: K.timberDark }, M.t(hx + ox, 0.07, hz + oz));
    b.add(P.box(0.34, 0.2, 0.3), { color: K.adobe }, M.t(hx, 0.24, hz));
    b.add(P.box(0.1, 0.1, 0.02), { color: K.door }, M.t(hx - 0.05, 0.21, hz + 0.155));
    b.add(P.cone(0.3, 0.2, 4), { color: thatchColor, leaf: 0.2 }, M.t(hx, 0.44, hz, 0, Math.PI / 4, 0));
    b.add(P.box(0.05, 0.015, 0.18), { color: K.timber }, M.t(hx - 0.05, 0.1, hz + 0.24, -0.5, 0, 0));
    b.add(P.cyl(0.07, 0.06, 0.04, 8), { color: K.terracotta }, M.t(px - 0.2, 0.03, pz + 0.25));
  }
  // Shelter in a corner.
  const sx = kind === 'maize' ? hw - 0.45 : -hw + 0.45, sz = -hd + 0.45;
  for (const [ox, oz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) b.add(P.cyl(0.03, 0.03, 0.75, 5), { color: K.timber }, M.t(sx + ox, 0.37, sz + oz));
  b.add(P.cone(0.6, 0.4, 4), { color: thatchColor, leaf: 0.2 }, M.t(sx, 0.95, sz, 0, Math.PI / 4, 0));
  b.add(P.uvSphere(0.1, 8, 6), { color: K.terracotta }, M.t(sx + 0.1, 0.1, sz));
  // Scarecrow.
  const cx = kind === 'maize' ? 0 : hw - 0.5, cz = -hd + 0.6;
  b.add(P.cyl(0.02, 0.02, 0.8, 4), { color: K.timber }, M.t(cx, 0.4, cz));
  b.add(P.cyl(0.015, 0.015, 0.5, 4), { color: K.timber }, M.t(cx, 0.6, cz, 0, 0, Math.PI / 2));
  b.add(P.sphere(0.07, 1), { color: K.thatch }, M.t(cx, 0.85, cz));
  b.add(P.cone(0.12, 0.1, 8), { color: K.terracotta }, M.t(cx, 0.94, cz));
  return { finished: b.build(), torches: [], height: 1.1 };
}

/** Crops for each farm type (scaled vertically by growth); `ripe` colours the harvest. */
export function cropModel(w: number, d: number, ripe: boolean, crop: 'veg' | 'maize' | 'chinampa' | 'herbs' = 'maize'): THREE.BufferGeometry {
  if (crop === 'herbs') return medicinalCrops(ripe);
  if (crop === 'veg') return vegCrops(w, d, ripe);
  if (crop === 'chinampa') return chinampaCrops(w, d, ripe);
  return maizeCrops(w, d, ripe);
}

type VegKind = 'bean' | 'squash' | 'chilli' | 'tomato' | 'amaranth';
/** One planted row running along z at `x`, with the z of each plant. */
interface CropRow {
  x: number;
  zs: number[];
  kind: VegKind | 'maize';
}

const VEG_ORDER: VegKind[] = ['bean', 'squash', 'chilli', 'bean', 'tomato', 'amaranth'];
const VEG_SPACING: Record<VegKind, number> = { bean: 0.46, squash: 0.56, chilli: 0.34, tomato: 0.4, amaranth: 0.3 };

/** The vegetable farm's chicken run: a square this size in the front right corner (local), and its centre. */
export const FARM_PEN = {
  size: 1.05,
  centre(w: number, d: number): [number, number] {
    return [w / 2 - 0.1 - FARM_PEN.size / 2, d / 2 - 0.1 - FARM_PEN.size / 2];
  },
};

/** Vegetable rows, shared by the farm's soil ridges and its crops. Keeps the shelter and scarecrow corners clear. */
function vegLayout(w: number, d: number): CropRow[] {
  const rows = Math.max(3, Math.floor(w * 1.5));
  const out: CropRow[] = [];
  for (let r = 0; r < rows; r++) {
    const x = -w / 2 + 0.6 + (r / Math.max(1, rows - 1)) * (w - 1.2);
    const kind = VEG_ORDER[r % VEG_ORDER.length];
    const sp = VEG_SPACING[kind];
    const n = Math.floor((d - 1.2) / sp);
    const zs: number[] = [];
    for (let k = 0; k <= n; k++) {
      const z = -(n * sp) / 2 + k * sp;
      if (z < -d / 2 + 1.1 && (x < -w / 2 + 1.1 || x > w / 2 - 0.9)) continue;
      // The chicken run in the front right corner.
      if (z > d / 2 - FARM_PEN.size - 0.15 && x > w / 2 - FARM_PEN.size - 0.15) continue;
      zs.push(z);
    }
    out.push({ x, zs, kind });
  }
  return out;
}

/** Maize hills in staggered rows; clears the crib, shelter and scarecrow at the back. */
function maizeLayout(w: number, d: number): CropRow[] {
  const rows = Math.max(2, Math.floor(w * 1.4));
  const cols = Math.max(2, Math.floor(d * 1.9));
  const dz = (d - 1.3) / (cols - 1);
  const out: CropRow[] = [];
  for (let r = 0; r < rows; r++) {
    const x = -w / 2 + 0.55 + (r / (rows - 1)) * (w - 1.1);
    const zs: number[] = [];
    for (let k = 0; k < cols; k++) {
      const z = -d / 2 + 0.55 + k * dz + (r % 2 ? dz * 0.5 : 0);
      if (z > d / 2 - 0.5) continue;
      if (z < -d / 2 + 1.15 && (x < -w / 2 + 1.25 || x > w / 2 - 1.05)) continue;
      if (Math.abs(x) < 0.3 && z < -d / 2 + 0.95) continue;
      zs.push(z);
    }
    out.push({ x, zs, kind: 'maize' });
  }
  return out;
}

const _up = new THREE.Vector3(0, 1, 0);
/** Place a y-axis primitive of height `len` so it starts at (x, y, z) and runs along the unit vector `dir`. */
function along(x: number, y: number, z: number, dir: THREE.Vector3, len: number): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromUnitVectors(_up, dir);
  return new THREE.Matrix4().compose(new THREE.Vector3(x + (dir.x * len) / 2, y + (dir.y * len) / 2, z + (dir.z * len) / 2), q, new THREE.Vector3(1, 1, 1));
}
const tilted = (a: number, tilt: number) => new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));

/** A long strap leaf arching out from (x, y, z) towards angle `a` and drooping at the tip (double sided). */
function archLeaf(
  b: GeoBuilder, x: number, y: number, z: number, a: number, L: number, W: number,
  color: THREE.Color, sway: (p: THREE.Vector3) => number, segs = 3, lift = 0.55, droop = 0.75
): void {
  const dx = Math.cos(a), dz = Math.sin(a);
  const g = ribbon(
    (t) => new THREE.Vector3(x + dx * L * t, y + L * (lift * t - droop * t * t), z + dz * L * t),
    (t) => (W * Math.sin(Math.PI * Math.min(1, 0.25 + 0.75 * t))),
    segs,
    new THREE.Vector3(-dz, 0, dx),
    0.3
  );
  b.add(doubleSide(g), { color, leaf: 1, sway });
}

/**
 * A leaf blade: pointed at both ends and widest a little before the middle, folded along its
 * midrib, arching out from (x, y, z) towards angle `a` (lifted by `lift`, curling down by
 * `droop`), shaded darker at the stalk and lighter at the tip. Double sided.
 */
function leafBlade(
  b: GeoBuilder, x: number, y: number, z: number, a: number, L: number, W: number,
  dark: THREE.Color, light: THREE.Color, sway: number | ((p: THREE.Vector3) => number),
  lift = 0.35, droop = 0.55, fold = 0.28
): void {
  const dx = Math.cos(a), dz = Math.sin(a);
  const g = ribbon(
    (t) => new THREE.Vector3(x + dx * L * t, y + L * (lift * t - droop * t * t), z + dz * L * t),
    (t) => Math.max(0.0015, W * Math.sin(Math.PI * Math.pow(t, 0.72))),
    L < 0.09 ? 2 : 3,
    new THREE.Vector3(-dz, 0, dx),
    fold
  );
  const base = new THREE.Vector3(x, y, z);
  b.add(doubleSide(g), { color: (p) => dark.clone().lerp(light, Math.min(1, p.distanceTo(base) / L)), leaf: 1, sway });
}

/** A round fruit with shallow lobes down its sides (pumpkins, squash, tomatoes). */
function ribbedFruit(r: number, ribs: number, depth = 0.1, ws = 12, hs = 6): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, ws, hs);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 - depth * (0.5 - 0.5 * Math.cos(Math.atan2(z, x) * ribs)) * (1 - (y / r) ** 2);
    p.setXYZ(i, x * k, y * (1 - Math.abs(y / r) * 0.08), z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Shade a colour a random amount either way (no two plants quite alike). */
const vary = (rng: RNG, col: THREE.Color, amt = 0.1) => col.clone().multiplyScalar(1 + rng.range(-amt, amt));

const VG = {
  leaf: c(0x5fa83a), leafDark: c(0x3a7f2a), leafLight: c(0x8ccc58), leafDeep: c(0x2f6e26),
  pole: c(0x8a6a44), poleDark: c(0x6a5034), vine: c(0x4a8a2c), stem: c(0x6a7a30), twine: c(0xc8b07a),
  pod: c(0x8fc24a), podPurple: c(0x6a3a72), beanFlower: c(0xe0452c),
  squashLeaf: c(0x2f6e24), squashLeafLight: c(0x5a9a38), squashVein: c(0x7cb050),
  pumpkin: c(0xe8862a), pumpkinDeep: c(0xd0621a), squashYellow: c(0xf0c43a), squashGreen: c(0x6f9e3e), squashFlower: c(0xf5b82a),
  chilliLeaf: c(0x3f8a2c), chilliLeafLight: c(0x6cae3e), chilliRed: c(0xd62f28), chilliOrange: c(0xe8742a), chilliGreen: c(0x5f9e32), white: c(0xf4f0e0),
  tomLeaf: c(0x4a8c30), tomLeafLight: c(0x78b048), tomRed: c(0xe23a24), tomOrange: c(0xf07a2a), tomGreen: c(0x9ac850), tomFlower: c(0xf2d230),
  amaStem: c(0x7a7a3a), amaStemRipe: c(0x9a4a3a), amaLeaf: c(0x4f8a34), amaLeafRed: c(0x8a3a44), amaRed: c(0xb42a54), amaRedDeep: c(0x7e1a3e), amaGold: c(0xd8742e), amaGreen: c(0x86a844),
};

/**
 * Milpa garden rows: runner beans climbing A-frames of poles, sprawling squash with big leaves
 * and orange/yellow fruit, chilli bushes, staked tomatoes and crimson amaranth plumes. Planted by
 * hand: no two plants the same size, none quite in line, here and there a gap or a straggler.
 * Unripe plants flower and carry small green fruit.
 */
function vegCrops(w: number, d: number, ripe: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new RNG(ripe ? 17 : 18);
  for (const row of vegLayout(w, d)) {
    if (!row.zs.length) continue;
    const x = row.x;
    if (row.kind === 'bean') {
      // Ridge pole tying the A-frames together along the row, a little crooked.
      const z0 = Math.min(...row.zs), z1 = Math.max(...row.zs);
      b.add(P.cyl(0.008, 0.009, z1 - z0 + 0.12, 4, true), { color: VG.pole, sway: (p) => p.y * 0.12 }, M.t(x, 0.71, (z0 + z1) / 2, Math.PI / 2 + rng.range(-0.03, 0.03), 0, rng.range(-0.02, 0.02)));
    }
    for (const z of row.zs) {
      // A runt now and then, or a gap where a seed never came up.
      const s = rng.next() < 0.12 ? rng.range(0.55, 0.75) : rng.range(0.85, 1.12);
      if (row.kind !== 'bean' && rng.next() < 0.06) continue;
      const jx = x + rng.range(-0.04, 0.04), jz = z + rng.range(-0.04, 0.04);
      if (row.kind === 'bean') beanFrame(b, rng, x, z, ripe, s);
      else if (row.kind === 'squash') squashPlant(b, rng, jx, jz, ripe, s);
      else if (row.kind === 'chilli') chilliPlant(b, rng, jx, jz, ripe, s);
      else if (row.kind === 'tomato') tomatoPlant(b, rng, jx, z, ripe, s);
      else amaranthPlant(b, rng, jx, jz, ripe, s);
    }
  }
  return b.build();
}

/** Two crooked poles leaning into an A, each twined by a bean vine with three-leaflet leaves and hanging pods (or red flowers). */
function beanFrame(b: GeoBuilder, rng: RNG, x: number, z: number, ripe: boolean, s: number): void {
  const top = 0.7, spread = 0.13;
  // Lashed at the top with a twist of twine.
  b.add(P.cyl(0.014, 0.014, 0.03, 5), { color: VG.twine, sway: (p) => p.y * 0.12 }, M.t(x, top - 0.02, z, 0, 0, Math.PI / 2));
  for (const side of [-1, 1]) {
    const bx = x + side * spread + rng.range(-0.02, 0.02), bz = z + rng.range(-0.02, 0.02);
    const dir = new THREE.Vector3(x - bx, top, z - bz).normalize();
    const len = Math.hypot(x - bx, top, z - bz) + 0.04;
    b.add(P.cyl(0.008, 0.013, len, 4, true), { color: rng.next() < 0.5 ? VG.pole : VG.poleDark, sway: (p) => p.y * 0.12 }, along(bx, 0, bz, dir, len));
    // The vine twines up most of the pole (shorter on a runt).
    const reach = 0.92 * Math.min(1, s);
    const pts: THREE.Vector3[] = [];
    const ph = rng.range(0, Math.PI * 2);
    for (let i = 0; i <= 8; i++) {
      const t = (i / 8) * reach, a = ph + t * 2.4 * Math.PI * 2;
      pts.push(new THREE.Vector3(bx + dir.x * len * t + Math.cos(a) * 0.018, dir.y * len * t + 0.01, bz + dir.z * len * t + Math.sin(a) * 0.018));
    }
    b.add(tube(pts, () => 0.005, 3, 12), { color: VG.vine, sway: (p) => p.y * 0.25 });
    const on = (t: number, off: number, a: number) =>
      new THREE.Vector3(bx + dir.x * len * t + Math.cos(a) * off, dir.y * len * t, bz + dir.z * len * t + Math.sin(a) * off);
    const sw = (q: THREE.Vector3) => q.y * 0.35;
    const nodes = Math.round(4 * reach);
    for (let l = 0; l < nodes; l++) {
      // Each leaf three heart-shaped leaflets fanned from a short stalk, bigger low down.
      const t = 0.12 + (l / Math.max(1, nodes - 1)) * (reach - 0.17);
      const a = ph + l * 2.3 + rng.range(-0.4, 0.4), p = on(t, 0.02, a);
      const L = (0.075 - t * 0.025) * rng.range(0.85, 1.15);
      const dk = vary(rng, VG.leafDark), lt = vary(rng, l % 2 ? VG.leaf : VG.leafLight);
      for (const da of [-0.75, 0, 0.75]) leafBlade(b, p.x, p.y, p.z, a + da, L * (da ? 0.85 : 1), L * 0.42, dk, lt, sw, da ? 0.1 : 0.3, 0.7);
    }
    if (ripe) {
      for (let l = 0; l < 4; l++) {
        const p = on(0.25 + l * 0.17 * reach, 0.035, rng.range(0, Math.PI * 2));
        const pl = rng.range(0.08, 0.12);
        b.add(P.cyl(0.006, 0.004, pl, 3, true), { color: rng.next() < 0.25 ? VG.podPurple : VG.pod, sway: (q) => q.y * 0.4 }, M.t(p.x, p.y - pl / 2, p.z, rng.range(-0.25, 0.25), 0, rng.range(-0.25, 0.25), 1.4, 1, 0.7));
      }
    } else {
      for (const t of [0.4, 0.62, 0.8]) {
        const p = on(t * reach, 0.03, rng.range(0, Math.PI * 2));
        b.add(new THREE.TetrahedronGeometry(0.016), { color: VG.beanFlower, sway: (q) => q.y * 0.4 }, M.t(p.x, p.y, p.z, rng.range(0, 3), rng.range(0, 3), 0));
      }
    }
  }
}

/** A squash vine sprawling along the row under broad, upturned leaves on long stalks, with ribbed pumpkins and yellow squash (or flowers). */
function squashPlant(b: GeoBuilder, rng: RNG, x: number, z: number, ripe: boolean, s: number): void {
  const ph = rng.range(0, 6);
  const pts: THREE.Vector3[] = [];
  const reach = 0.26 * s;
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    pts.push(new THREE.Vector3(x + Math.sin(t * 5 + ph) * 0.07, 0.025, z - reach + t * reach * 2));
  }
  b.add(tube(pts, () => 0.008, 3, 10), { color: VG.vine, sway: 0.04 });
  const nl = Math.round(rng.range(7, 9) * Math.min(1, s));
  for (let l = 0; l < nl; l++) {
    const p = pts[Math.min(5, Math.floor((l / nl) * 6))];
    const a = rng.range(0, Math.PI * 2);
    // A stalk rising out of the vine, holding up a big round leaf that cups and droops at the rim.
    // A short stalk out of the vine, holding a big round leaf low over the ground like an umbrella
    // (the leaves overlap into a mound), its rim curling down.
    const h = rng.range(0.035, 0.1) * s;
    const off = rng.range(0.03, 0.11);
    const tip = new THREE.Vector3(p.x + Math.cos(a) * off, h, p.z + Math.sin(a) * off);
    const st = tip.clone().sub(new THREE.Vector3(p.x, 0.02, p.z));
    b.add(P.cyl(0.004, 0.006, st.length(), 3, true), { color: VG.vine, sway: 0.08 }, along(p.x, 0.02, p.z, st.normalize(), st.length()));
    const L = rng.range(0.15, 0.2) * Math.sqrt(s);
    leafBlade(b, tip.x - Math.cos(a) * L * 0.4, tip.y + 0.02, tip.z - Math.sin(a) * L * 0.4, a, L, L * 0.66, vary(rng, VG.squashLeaf), vary(rng, l % 3 ? VG.squashLeafLight : VG.squashVein, 0.08), 0.12, rng.range(-0.1, 0.6), rng.range(0.4, 0.9), 0.38);
  }
  const fx = x + (rng.next() < 0.5 ? -1 : 1) * rng.range(0.07, 0.12), fz = z + rng.range(-0.14, 0.14);
  if (ripe) {
    const r = rng.range(0.06, 0.085) * Math.sqrt(s);
    b.add(ribbedFruit(r, 8, 0.12), { color: vary(rng, rng.next() < 0.5 ? VG.pumpkin : VG.pumpkinDeep, 0.06) }, M.t(fx, r * 0.78, fz, rng.range(-0.1, 0.1), rng.range(0, 3), 0, 1.15, 0.82, 1.15));
    b.add(P.cyl(0.007, 0.011, 0.035, 4, true), { color: VG.stem }, M.t(fx, r * 1.55, fz, 0, 0, 0.35));
    if (rng.next() < 0.6) {
      const ax = x - (fx - x) * 0.8, az = z - (fz - z);
      b.add(P.uvSphere(0.04, 7, 5), { color: vary(rng, VG.squashYellow, 0.06) }, M.t(ax, 0.04, az, 0.15, rng.range(0, 3), 0, 1, 0.9, 2.2));
    }
  } else {
    b.add(ribbedFruit(0.035, 8, 0.1, 8, 5), { color: VG.squashGreen }, M.t(fx, 0.035, fz, 0, rng.range(0, 3), 0, 1, 0.9, 1.4));
    for (let l = 0; l < 2; l++) {
      const p = pts[1 + l * 2];
      b.add(P.cone(0.032, 0.055, 6), { color: VG.squashFlower, sway: 0.15 }, M.t(p.x + rng.range(-0.05, 0.05), 0.12, p.z, Math.PI + rng.range(-0.4, 0.4), 0, rng.range(-0.4, 0.4)));
    }
  }
}

/** A small branching chilli bush of glossy pointed leaves, hung with curved red, orange and green pods (white flowers while unripe). */
function chilliPlant(b: GeoBuilder, rng: RNG, x: number, z: number, ripe: boolean, s: number): void {
  const sway = (p: THREE.Vector3) => p.y * 0.4;
  const H = 0.13 * s;
  b.add(P.cyl(0.006, 0.01, H, 3, true), { color: VG.stem, sway }, M.t(x, H / 2, z));
  const ph = rng.range(0, 6);
  // Three or four branches forking out of the stem, each tufted with leaves.
  const nb = rng.int(3, 4);
  const tips: THREE.Vector3[] = [];
  for (let k = 0; k < nb; k++) {
    const a = ph + (k / nb) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const dir = tilted(a, rng.range(0.5, 0.9));
    const len = rng.range(0.07, 0.1) * s;
    const y0 = H * rng.range(0.6, 0.95);
    b.add(P.cyl(0.004, 0.006, len, 3, true), { color: VG.stem, sway }, along(x, y0, z, dir, len));
    tips.push(new THREE.Vector3(x + dir.x * len, y0 + dir.y * len, z + dir.z * len));
  }
  for (const t of tips) {
    for (let l = 0; l < 3; l++) {
      const a = rng.range(0, Math.PI * 2);
      leafBlade(b, t.x, t.y - l * 0.02, t.z, a, rng.range(0.05, 0.07) * s, 0.017 * s, vary(rng, VG.chilliLeaf), vary(rng, VG.chilliLeafLight), sway, 0.35, 0.6);
    }
  }
  for (let l = 0; l < 8; l++) {
    const t = tips[l % tips.length];
    const a = rng.range(0, Math.PI * 2);
    const px = (x + t.x) / 2 + Math.cos(a) * 0.03, pz = (z + t.z) / 2 + Math.sin(a) * 0.03, y = t.y - rng.range(0.03, 0.06);
    if (!ripe && l < 3) {
      b.add(new THREE.TetrahedronGeometry(0.012), { color: VG.white, sway }, M.t(px, y + 0.04, pz, rng.range(0, 3), rng.range(0, 3), 0));
      continue;
    }
    const r = rng.next();
    const col = ripe ? (r < 0.62 ? VG.chilliRed : r < 0.8 ? VG.chilliOrange : VG.chilliGreen) : VG.chilliGreen;
    // Pods hang from a short green cap, tapering and curving.
    const pl = rng.range(0.045, 0.07);
    const pts = [0, 1, 2, 3].map((i) => new THREE.Vector3(px + Math.cos(a) * 0.012 * i * i * 0.3, y - (pl * i) / 3, pz + Math.sin(a) * 0.012 * i * i * 0.3));
    b.add(outward(tube(pts, (u) => 0.009 * (1 - u * 0.85), 4, 4)), { color: vary(rng, col, 0.06), sway });
    b.add(P.cyl(0.006, 0.01, 0.012, 4), { color: VG.stem, sway }, M.t(px, y + 0.005, pz));
  }
}

/** A tomato plant tied to a stake: a zig-zag stem, ragged compound leaves, trusses of round fruit (green fruit and yellow flowers while unripe). */
function tomatoPlant(b: GeoBuilder, rng: RNG, x: number, z: number, ripe: boolean, s: number): void {
  const sway = (p: THREE.Vector3) => p.y * 0.35;
  const H = 0.44 * s;
  b.add(P.cyl(0.006, 0.009, 0.5, 4, true), { color: VG.pole, sway: (p) => p.y * 0.1 }, M.t(x + 0.035, 0.25, z, 0, 0, rng.range(-0.06, 0.06)));
  // Ties of twine.
  for (const y of [0.16, 0.32]) if (y < H) b.add(P.cyl(0.013, 0.013, 0.008, 5), { color: VG.twine, sway }, M.t(x + 0.03, y * s, z));
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 5; i++) pts.push(new THREE.Vector3(x + (i % 2 ? 0.012 : -0.008) + 0.01, (H * i) / 5, z + (i % 2 ? -0.008 : 0.008)));
  b.add(outward(tube(pts, (u) => 0.008 * (1 - u * 0.5), 3, 8)), { color: VG.stem, sway });
  const ph = rng.range(0, 6);
  for (let k = 0; k < 5; k++) {
    const a = ph + k * 2.4, y = H * (0.18 + k * 0.17);
    // A compound leaf: a few leaflets along a stalk, the tip one biggest.
    const L = (0.1 - k * 0.008) * s;
    const dk = vary(rng, VG.tomLeaf), lt = vary(rng, VG.tomLeafLight);
    leafBlade(b, x + 0.01, y, z, a, L, L * 0.3, dk, lt, sway, 0.25, 0.8);
    for (const side of [-1, 1]) leafBlade(b, x + 0.01 + Math.cos(a) * L * 0.4, y + L * 0.05, z + Math.sin(a) * L * 0.4, a + side * 1.0, L * 0.5, L * 0.18, dk, lt, sway, 0.2, 0.7);
  }
  // Trusses: little clusters of fruit hanging off the stem.
  const nt = ripe ? 3 : 2;
  for (let tI = 0; tI < nt; tI++) {
    const a = ph + 1.2 + tI * 2.1, y = H * (0.25 + tI * 0.22);
    const cx = x + 0.01 + Math.cos(a) * 0.05, cz = z + Math.sin(a) * 0.05;
    const n = rng.int(2, 4);
    for (let l = 0; l < n; l++) {
      const px = cx + rng.range(-0.025, 0.025), py = y - l * 0.02 - rng.range(0, 0.02), pz = cz + rng.range(-0.025, 0.025);
      if (!ripe && l === 0) {
        b.add(new THREE.TetrahedronGeometry(0.013), { color: VG.tomFlower, sway }, M.t(px, py + 0.03, pz, rng.range(0, 3), 0, 0));
        continue;
      }
      const r = rng.next();
      const col = ripe ? (r < 0.65 ? VG.tomRed : r < 0.88 ? VG.tomOrange : VG.tomGreen) : VG.tomGreen;
      const fr = (ripe ? 0.026 : 0.019) * rng.range(0.85, 1.15);
      b.add(ribbedFruit(fr, 5, 0.08, 7, 4), { color: vary(rng, col, 0.06), sway }, M.t(px, py, pz, 0, rng.range(0, 3), 0, 1, 0.85, 1));
    }
  }
}

/** Amaranth (huauhtli): a tall, slightly leaning stalk with broad, red-flushed leaves and heavy, drooping crimson or gold seed plumes. */
function amaranthPlant(b: GeoBuilder, rng: RNG, x: number, z: number, ripe: boolean, s: number): void {
  const H = rng.range(0.46, 0.62) * (ripe ? 1 : 0.85) * s;
  const sway = (p: THREE.Vector3) => p.y * 0.45;
  const la = rng.range(0, Math.PI * 2), lean = rng.range(0, 0.06);
  const top = new THREE.Vector3(x + Math.cos(la) * lean, H, z + Math.sin(la) * lean);
  b.add(outward(tube([new THREE.Vector3(x, 0, z), new THREE.Vector3(x + Math.cos(la) * lean * 0.3, H * 0.5, z + Math.sin(la) * lean * 0.3), top], (u) => 0.012 * (1 - u * 0.5), 4, 4)), { color: ripe ? VG.amaStemRipe : VG.amaStem, sway });
  const leafTip = ripe ? VG.amaLeafRed : VG.amaLeaf;
  for (let k = 0; k < 4; k++) {
    const a = rng.range(0, Math.PI * 2), t = 0.18 + k * 0.17;
    const L = (0.11 - k * 0.012) * s;
    leafBlade(b, x + (top.x - x) * t, H * t, z + (top.z - z) * t, a, L, L * 0.38, vary(rng, VG.amaLeaf), vary(rng, k > 1 ? leafTip : VG.amaLeaf), sway, 0.3, 0.75);
  }
  const plume = ripe ? (rng.next() < 0.78 ? VG.amaRed : VG.amaGold) : VG.amaGreen;
  const deep = ripe ? plume.clone().lerp(VG.amaRedDeep, 0.5) : VG.amaGreen.clone().multiplyScalar(0.8);
  const ps = ripe ? 1 : 0.6;
  // The head: a thick central plume nodding over, and side plumes drooping off it.
  const nodA = la + rng.range(-0.5, 0.5);
  const plumeTube = (o: THREE.Vector3, a: number, len: number, r: number, bend: number) => {
    const pts = [0, 1, 2, 3, 4].map((i) => {
      const t = i / 4;
      return new THREE.Vector3(o.x + Math.cos(a) * len * t * 0.6, o.y + len * (t * 0.7 - bend * t * t), o.z + Math.sin(a) * len * t * 0.6);
    });
    b.add(outward(tube(pts, (u) => Math.max(0.003, r * Math.sin(Math.PI * (0.15 + u * 0.85))), 4, 5)), { color: (p) => deep.clone().lerp(plume, Math.min(1, Math.max(0, (p.y - o.y + len * 0.3) / (len * 0.8)))), sway });
  };
  plumeTube(top, nodA, 0.22 * ps, 0.026 * ps, ripe ? 1.4 : 0.6);
  for (let k = 0; k < (ripe ? 4 : 2); k++) {
    const a = nodA + rng.range(-1.6, 1.6), t = 0.78 + k * 0.05;
    plumeTube(new THREE.Vector3(x + (top.x - x) * t, H * t, z + (top.z - z) * t), a, rng.range(0.1, 0.14) * ps, 0.014 * ps, 1.6);
  }
}

/** Water garden layout (model-local, door faces +z): three raised beds between water channels. */
const CHB = { bedW: 1.0, z0: -1.5, z1: 1.2, walkZ: 1.62 };
export const CHINAMPA_BED_Y = 0.17;
/** Centre x of each raised bed (three beds with two channels between them). */
export function chinampaBeds(w: number): number[] {
  const g = (w - 3 * CHB.bedW) / 4;
  return [-(CHB.bedW + g), 0, CHB.bedW + g];
}

/** A round, crinkled cabbage: outer leaves cupping a pale heart. */
function cabbagePlant(b: GeoBuilder, rng: RNG, x: number, z: number, ripe: boolean, s: number): void {
  const dk = vary(rng, c(0x3f7f3a)), lt = vary(rng, c(0x9ccf7a));
  for (let k = 0; k < 7; k++) leafBlade(b, x, 0.01, z, (k / 7) * 6.28 + rng.range(-0.3, 0.3), 0.1 * s, 0.06 * s, dk, lt, 0.12, rng.range(0.3, 0.6), 0.5, 0.4);
  if (ripe || rng.next() < 0.5) b.add(lumpy(P.sphere(0.05 * s, 1), 0.12, rng.int(1, 999), 0.85), { color: (p) => c(0xb8dd94).lerp(c(0x6fae5a), Math.max(0, 0.06 * s - p.y) * 8), facet: true, sway: 0.05 }, M.t(x, 0.045 * s, z));
}

/** A carrot: a feathery green top over the orange shoulder showing through the soil. */
function carrotPlant(b: GeoBuilder, rng: RNG, x: number, z: number, ripe: boolean): void {
  if (ripe) b.add(P.cone(0.022, 0.05, 6), { color: c(0xe8782a), facet: true }, M.t(x, 0.012, z, Math.PI, 0, 0));
  for (let k = 0; k < 6; k++) leafBlade(b, x, 0.02, z, (k / 6) * 6.28 + rng.range(-0.2, 0.2), rng.range(0.07, 0.11), 0.016, c(0x3f8a2e), c(0x7fbf4a), (p) => p.y * 0.5, 1.1, 0.4, 0.1);
}

/**
 * Water garden crops, a different crop to each bed as on a real chinampa: maize, sprawling
 * squash, and staked tomatoes in front of cabbages and carrots. Built at ground level and lifted
 * onto the beds' soil.
 */
function chinampaCrops(w: number, d: number, ripe: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new RNG(ripe ? 27 : 28);
  const [b0, b1, b2] = chinampaBeds(w);
  const along = (step: number, fn: (z: number, k: number) => void) => {
    let k = 0;
    for (let z = CHB.z0 + 0.18; z < CHB.z1 - 0.1; z += step * rng.range(0.9, 1.1)) fn(z + rng.range(-0.03, 0.03), k++);
  };
  // Maize in two rows.
  for (const ox of [-0.24, 0.24]) along(0.3, (z) => maizePlant(b, rng, b0 + ox + rng.range(-0.03, 0.03), z, rng.range(0.5, 0.68), ripe));
  // Squash vines under their broad leaves.
  for (const ox of [-0.2, 0.22]) along(0.48, (z) => squashPlant(b, rng, b1 + ox, z, ripe, rng.range(0.8, 1)));
  // Tomatoes on stakes at the back, cabbages and carrots at the front.
  const mid = (CHB.z0 + CHB.z1) / 2;
  for (const ox of [-0.24, 0.24]) along(0.27, (z) => {
    if (z < mid) tomatoPlant(b, rng, b2 + ox, z, ripe, rng.range(0.75, 0.9));
    else if (ox < 0) cabbagePlant(b, rng, b2 + ox, z, ripe, rng.range(0.9, 1.15));
    else { carrotPlant(b, rng, b2 + ox - 0.05, z, ripe); carrotPlant(b, rng, b2 + ox + 0.08, z + 0.1, ripe); }
  });
  const g = b.build();
  g.translate(0, CHINAMPA_BED_Y, 0);
  return g;
}

/** An ahuejote willow: a slim leaning trunk and a tall, ragged column of drooping leaf clumps. */
function ahuejote(b: GeoBuilder, rng: RNG, x: number, z: number, h: number): void {
  const la = rng.range(0, 6.28), lean = rng.range(0.04, 0.12);
  const at = (t: number) => new THREE.Vector3(x + Math.cos(la) * lean * t * t * h, h * t, z + Math.sin(la) * lean * t * t * h);
  b.add(outward(tube([0, 0.35, 0.7, 1].map(at), (u) => 0.045 - u * 0.028, 5, 8)), { color: (p) => K.timberDark.clone().lerp(c(0x8a7458), Math.sin(p.y * 31) * 0.25 + 0.25), sway: (p) => p.y * 0.04 });
  // A few side branches.
  for (let k = 0; k < 3; k++) {
    const t = rng.range(0.45, 0.8), o = at(t), a = rng.range(0, 6.28), L = rng.range(0.15, 0.28);
    b.add(P.cyl(0.008, 0.016, L, 4), { color: K.timberDark, sway: (p) => p.y * 0.05 }, M.t(o.x + Math.cos(a) * L * 0.4, o.y + L * 0.3, o.z + Math.sin(a) * L * 0.4, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9));
  }
  // Foliage: clumps of different sizes and greens, crowded toward the top, none in line.
  const n = Math.round(rng.range(18, 24));
  for (let k = 0; k < n; k++) {
    const t = 0.3 + Math.pow(rng.next(), 0.7) * 0.74, o = at(Math.min(1.04, t));
    const r = rng.range(0.09, 0.19) * (1.2 - t * 0.4), a = rng.range(0, 6.28), off = rng.range(0.03, 0.17) * (1.25 - t * 0.55);
    const col = c(0x3f7a2e).lerp(c(0x9cc456), rng.range(0, 0.75));
    b.add(lumpy(P.sphere(r, 1), 0.3, rng.int(1, 9999), rng.range(1.15, 1.7)), { color: (p) => col.clone().multiplyScalar(0.85 + Math.min(0.3, (p.y - o.y + r) / (r * 6))), leaf: 1, sway: (p) => 0.08 + p.y * 0.07 }, M.t(o.x + Math.cos(a) * off, o.y, o.z + Math.sin(a) * off, rng.range(-0.3, 0.3), a, rng.range(-0.3, 0.3)));
  }
}

/**
 * Chinampa (water garden): three raised beds of dark lake mud walled with woven reed bundles
 * between thick lashed posts, standing in a reed-fringed pool with lily pads; plank bridges cross
 * the channels and a boardwalk with a rope rail runs along the front. Two irregular ahuejote
 * willows (their roots bind the beds) stand at the back.
 */
export function chinampaModel(w: number, d: number): BuildingModel {
  const b = new GeoBuilder();
  const rng = new RNG(311);
  const hw = w / 2, hd = d / 2, by = CHINAMPA_BED_Y, wy = 0.06;
  // A low earth bank round the pool.
  const bank = (p: THREE.Vector3) => c(0x6b5236).lerp(c(0x8a7050), Math.sin(p.x * 13 + p.z * 7) * 0.3 + 0.3);
  for (const s of [-1, 1]) {
    b.add(P.box(w - 0.02, 0.09, 0.14), { color: bank }, M.t(0, 0.045, s * (hd - 0.07)));
    b.add(P.box(0.14, 0.09, d - 0.3), { color: bank }, M.t(s * (hw - 0.07), 0.045, 0));
  }
  // Water: deep teal in the middle, greener and shallower toward the banks, with ripples.
  const water = new THREE.PlaneGeometry(w - 0.2, d - 0.2, 20, 20).rotateX(-Math.PI / 2);
  b.add(water, { color: (p) => {
    const edge = Math.min(hw - 0.1 - Math.abs(p.x), hd - 0.1 - Math.abs(p.z));
    return c(0x226f78).lerp(c(0x5d9a82), Math.max(0, 1 - edge / 0.4) * 0.75).multiplyScalar(0.94 + 0.06 * Math.sin(p.x * 9 + p.z * 6));
  } }, M.t(0, wy, 0));
  for (let k = 0; k < 9; k++) {
    const [x, z] = [rng.range(-hw + 0.3, hw - 0.3), rng.next() < 0.5 ? rng.range(CHB.z1 + 0.05, CHB.walkZ - 0.2) : rng.range(-hd + 0.25, CHB.z0 - 0.05)];
    b.add(P.torus(rng.range(0.05, 0.12), 0.004, 3, 16), { color: c(0x8fc3b4) }, M.t(x, wy + 0.004, z, Math.PI / 2, 0, 0));
  }
  // Lily pads (a notch cut from each) and a few pink flowers, in the open water.
  for (let k = 0; k < 16; k++) {
    const x = rng.next() < 0.5 ? rng.range(-hw + 0.2, hw - 0.2) : chinampaBeds(w)[rng.int(0, 1)] + (CHB.bedW / 2 + 0.08);
    const z = k < 8 ? rng.range(-hd + 0.2, CHB.z0 - 0.06) : rng.range(CHB.z0, CHB.z1);
    const r = rng.range(0.04, 0.075);
    b.add(new THREE.CircleGeometry(r, 9, 0.35, 5.9).rotateX(-Math.PI / 2), { color: vary(rng, c(0x4f8f3e), 0.12), leaf: 1 }, M.t(x, wy + 0.006, z, 0, rng.range(0, 6.28), 0));
    if (k % 4 === 0) b.add(FLOWER, { color: c(0xf0a4c0), leaf: 1 }, M.t(x + 0.02, wy + 0.025, z, 0, k, 0, 0.7, 0.5, 0.7));
  }
  // Reeds along the banks.
  for (let k = 0; k < 14; k++) {
    const side = k % 4, u = rng.range(-0.9, 0.9);
    const x = side < 2 ? (side ? 1 : -1) * (hw - 0.17) : u * hw, z = side < 2 ? u * (hd - 0.4) - 0.2 : -(hd - 0.17);
    for (let r = 0; r < 5; r++) b.add(P.cone(0.012, rng.range(0.22, 0.38), 3), { color: c(0x6f8f3a).lerp(c(0xb8a85a), rng.next() * 0.5), leaf: 1, sway: (p) => p.y * 0.25 }, M.t(x + rng.range(-0.05, 0.05), wy + 0.13, z + rng.range(-0.05, 0.05), rng.range(-0.15, 0.15), 0, rng.range(-0.15, 0.15)));
  }
  // The beds.
  const reedA = c(0xc9a35a), reedB = c(0xa9853f), soil = c(0x3b2a1c), soilLight = c(0x56402a);
  const post = (x: number, z: number, h: number, r = 0.035) => {
    b.add(P.cyl(r * 0.9, r, h, 6), { color: (p) => K.timber.clone().lerp(K.timberDark, Math.max(0, 0.2 - p.y) * 3) }, M.t(x, h / 2, z));
    b.add(P.cyl(r * 0.85, r * 0.85, 0.012, 6), { color: K.timberDark }, M.t(x, h + 0.006, z));
    for (const y of [h - 0.05, h - 0.09]) b.add(P.cyl(r + 0.006, r + 0.006, 0.014, 6), { color: K.rope }, M.t(x, y, z));
  };
  for (const bx of chinampaBeds(w)) {
    const bw = CHB.bedW, L = CHB.z1 - CHB.z0, cz = (CHB.z0 + CHB.z1) / 2;
    b.add(P.box(bw - 0.04, by, L - 0.04), { color: soil }, M.t(bx, by / 2, cz));
    // Furrowed soil on top.
    for (let r = 0; r < 5; r++) b.add(P.box(0.1, 0.02, L - 0.12), { color: (p) => soil.clone().lerp(soilLight, Math.sin(p.z * 17 + r) * 0.3 + 0.35) }, M.t(bx - bw / 2 + 0.12 + r * ((bw - 0.24) / 4), by + 0.004, cz));
    // Woven reed walls: upright bundles, bound with two cords, round all four sides.
    const wall = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(len / 0.05), ry = Math.atan2(x1 - x0, z1 - z0);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, h = by + 0.03 + rng.range(-0.012, 0.012);
        b.add(P.box(0.032, h, 0.05), { color: (k % 2 ? reedA : reedB).clone().multiplyScalar(0.92 + rng.next() * 0.14) }, M.t(x0 + (x1 - x0) * t, h / 2, z0 + (z1 - z0) * t, 0, ry, 0));
      }
      for (const y of [by * 0.45, by - 0.02]) b.add(P.box(0.04, 0.014, len), { color: K.rope }, M.t((x0 + x1) / 2, y, (z0 + z1) / 2, 0, ry, 0));
    };
    const x0 = bx - bw / 2, x1 = bx + bw / 2;
    wall(x0, CHB.z0, x0, CHB.z1); wall(x1, CHB.z0, x1, CHB.z1); wall(x0, CHB.z0, x1, CHB.z0); wall(x0, CHB.z1, x1, CHB.z1);
    for (const x of [x0, x1]) for (const z of [CHB.z0, cz - L / 4, cz + L / 4, CHB.z1]) post(x, z, by + rng.range(0.12, 0.17), z === CHB.z0 || z === CHB.z1 ? 0.042 : 0.032);
  }
  // Plank bridges across the channels, at the middle of the beds.
  const beds = chinampaBeds(w);
  for (let k = 0; k < 2; k++) {
    const xa = beds[k] + CHB.bedW / 2, xb = beds[k + 1] - CHB.bedW / 2, cx = (xa + xb) / 2;
    for (let p = 0; p < 4; p++) b.add(P.box(xb - xa + 0.1, 0.022, 0.08), { color: (p % 2 ? K.timber : c(0x9a7550)).clone().multiplyScalar(0.95 + rng.next() * 0.1) }, M.t(cx, by + 0.012, -0.15 + p * 0.09, 0, rng.range(-0.03, 0.03), 0));
  }
  // Front boardwalk on posts, with a rope rail.
  const walkY = by + 0.01, wz = CHB.walkZ;
  for (let k = 0; k < 2; k++) b.add(P.box(w - 0.3, 0.03, 0.04), { color: K.timberDark }, M.t(0, walkY - 0.025, wz + (k ? 0.13 : -0.13)));
  const planks = Math.floor((w - 0.3) / 0.09);
  for (let k = 0; k < planks; k++) b.add(P.box(0.085, 0.022, 0.36 + rng.range(-0.02, 0.02)), { color: (k % 3 ? K.timber : c(0x9a7550)).clone().multiplyScalar(0.92 + rng.next() * 0.14) }, M.t(-hw + 0.19 + k * 0.09, walkY, wz, 0, rng.range(-0.03, 0.03), 0));
  const railX = [-hw + 0.2, -hw / 3, hw / 3, hw - 0.2];
  for (const x of railX) post(x, wz + 0.17, walkY + 0.22, 0.03);
  for (let k = 0; k < railX.length - 1; k++) b.add(P.cyl(0.008, 0.008, railX[k + 1] - railX[k], 4), { color: K.rope }, M.t((railX[k] + railX[k + 1]) / 2, walkY + 0.16, wz + 0.17, 0, 0, Math.PI / 2));
  // A basket of the harvest on the boardwalk.
  b.add(P.cyl(0.09, 0.07, 0.07, 9), { color: K.rope }, M.t(hw - 0.55, walkY + 0.045, wz - 0.05));
  for (let k = 0; k < 5; k++) b.add(P.sphere(0.03, 1), { color: [c(0xe8862a), c(0xe23a24), c(0x8ccf5a)][k % 3] }, M.t(hw - 0.55 + rng.range(-0.04, 0.04), walkY + 0.09, wz - 0.05 + rng.range(-0.04, 0.04)));
  // Two ahuejote willows of different heights at the back.
  ahuejote(b, rng, -hw + 0.24, -hd + 0.22, 1.75);
  ahuejote(b, rng, hw - 0.32, -hd + 0.28, 1.25);
  return { finished: b.build(), torches: [], height: 0.6 };
}

/**
 * Smokehouse: a flat-roofed adobe house with a smoke hole on the roof, two drying racks hung
 * with fish and strips of meat over a smouldering fire, and a stack of firewood.
 */
export function smokehouseModel(w: number, d: number): BuildingModel {
  const b = new GeoBuilder();
  const hx = -w / 2 + 0.95, hz = -0.15;
  stoneBlock(b, 1.5, 0.85, 1.5, hx, 0, hz);
  fretBand(b, M.t(hx, 0.72, hz + 0.754), 1.46, 0.1, K.red, AD.cream);
  fretBand(b, M.t(hx + 0.754, 0.72, hz, 0, Math.PI / 2, 0), 1.46, 0.1, K.red, AD.cream);
  // Soot-darkened stone chimney on the flat roof.
  b.add(P.box(0.34, 0.38, 0.34), { color: (p) => CUT.stone.clone().lerp(c(0x4a3a30), Math.max(0, p.y - 1.0) * 2.4) }, M.t(hx + 0.35, 1.1, hz - 0.3));
  b.add(P.box(0.2, 0.02, 0.2), { color: c(0x2a2220) }, M.t(hx + 0.35, 1.3, hz - 0.3));
  tealDoor(b, hx, 0.02, hz + 0.76, 0.28, 0.48);
  adobeWindow(b, hx - 0.5, 0.52, hz + 0.76);
  adobeWindow(b, hx + 0.76, 0.52, hz - 0.2, true);
  awning(b, hx, 0.66, hz + 0.72, 0.9, 0.34, true);
  barrel(b, hx - 0.62, 0, hz + 0.95, 1.1);
  heapBasket(b, hx + 0.45, 0, hz + 1.05, 0.1, 0.1, [0x7f97a8, 0x6a8496], new RNG(55));
  // Drying racks: A-frame ends with two cross poles hung with fish and strips of meat.
  const rx = w / 2 - 0.7;
  for (const rz of [-0.55, 0.5]) {
    for (const ox of [-0.5, 0.5]) {
      for (const lean of [-0.28, 0.28]) b.add(P.cyl(0.022, 0.028, 1.05, 5), { color: K.timber }, M.t(rx + ox, 0.5, rz + lean * 0.5, lean, 0, 0));
    }
    for (const y of [0.72, 0.92]) {
      b.add(P.cyl(0.018, 0.018, 1.1, 4), { color: K.timberDark }, M.t(rx, y, rz, 0, 0, Math.PI / 2));
      for (let k = 0; k < 7; k++) {
        const x = rx - 0.42 + k * 0.14;
        if ((k + (y > 0.8 ? 1 : 0)) % 2 === 0) {
          b.add(P.sphere(0.06, 0), { color: c(0xc8a46a).lerp(c(0x8a5a30), (k % 3) * 0.2), sway: 0.1 }, M.t(x, y - 0.13, rz, 0, 0, 0, 0.42, 1.55, 0.75));
          b.add(P.cone(0.04, 0.05, 3), { color: c(0x7a4a28), sway: 0.1 }, M.t(x, y - 0.03, rz, Math.PI, 0, 0, 1, 1, 0.4));
        } else b.add(P.box(0.05, 0.17, 0.018), { color: c(0x9a3a22).lerp(c(0x5a2a1a), (k % 2) * 0.4), sway: 0.1 }, M.t(x, y - 0.1, rz, 0, 0, (k % 3 - 1) * 0.08));
      }
    }
  }
  // Smouldering fire pit under the racks.
  b.add(P.cyl(0.26, 0.3, 0.06, 8), { color: K.stoneDark }, M.t(rx, 0.03, 0));
  for (let k = 0; k < 3; k++) b.add(P.cyl(0.03, 0.03, 0.4, 5), { color: c(0x3a2820) }, M.t(rx, 0.08, 0, 0, (k / 3) * Math.PI, Math.PI / 2));
  b.add(P.sphere(0.09, 0), { color: c(0xe8702a) }, M.t(rx, 0.1, 0, 0, 0, 0, 1.3, 0.5, 1.3));
  // Firewood stacked against the house.
  for (let k = 0; k < 6; k++) b.add(P.cyl(0.045, 0.045, 0.55, 6), { color: K.timber }, M.t(hx - 0.3 + (k % 3) * 0.1, 0.05 + Math.floor(k / 3) * 0.09, d / 2 - 0.3, 0, 0, Math.PI / 2));
  pottedPlant(b, hx + 0.62, 0, hz + 0.95, 0.8);
  return { finished: b.build(), torches: [new THREE.Vector3(hx + 0.55, 0, hz + 0.9)], height: 1.35 };
}

const MZ = {
  stalk: c(0x5f9e36), stalkRipe: c(0xb3a653),
  leaf: c(0x5aa638), leafDark: c(0x4b9430), leafRipe: c(0x9fa447), leafDry: c(0xcdb370),
  husk: c(0xe0cc92), huskGreen: c(0x78b443),
  kernel: c(0xf4c430), kernelDeep: c(0xe8a526),
  silk: c(0xe8dca0), tassel: c(0xdcb45c), tasselGreen: c(0xb4c860),
};

/**
 * Tall maize in staggered hills (scaled vertically by growth): a stalk with long leaves arching
 * off alternate sides, cobs in husks with silk and a branching tassel on top. Ripe plants turn
 * straw-coloured with golden tassels and husks peeled back from yellow cobs.
 */
function maizeCrops(w: number, d: number, ripe: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new RNG(ripe ? 7 : 8);
  for (const row of maizeLayout(w, d)) {
    for (const z0 of row.zs) {
      // Hand-sown hills: a gap here and there, and the odd stunted or towering plant.
      if (rng.next() < 0.05) continue;
      const x = row.x + rng.range(-0.07, 0.07), z = z0 + rng.range(-0.06, 0.06);
      const h = (rng.next() < 0.1 ? rng.range(0.6, 0.8) : rng.range(0.85, 1.12)) * (ripe ? 1 : 0.9);
      maizePlant(b, rng, x, z, h, ripe);
    }
  }
  return b.build();
}

function maizePlant(b: GeoBuilder, rng: RNG, x: number, z: number, h: number, ripe: boolean): void {
  const sway = (p: THREE.Vector3) => p.y * 0.3 + Math.hypot(p.x - x, p.z - z) * 0.6;
  // A jointed stalk, leaning a little and bowing back up, thickest at the prop roots.
  const la = rng.range(0, Math.PI * 2), lean = rng.range(0, 0.07) * h;
  const stalkAt = (t: number) => new THREE.Vector3(x + Math.cos(la) * lean * t * t, h * t, z + Math.sin(la) * lean * t * t);
  b.add(outward(tube([0, 0.33, 0.66, 1].map(stalkAt), (u) => 0.022 - u * 0.011, 5, 6)), { color: ripe ? vary(rng, MZ.stalkRipe, 0.06) : vary(rng, MZ.stalk, 0.06), sway });
  for (let k = 0; k < 3; k++) {
    const a = la + k * 2.1;
    // Prop roots bracing the foot of the stalk.
    const rd = new THREE.Vector3(-Math.cos(a) * 0.024, 0.055, -Math.sin(a) * 0.024);
    b.add(P.cyl(0.003, 0.004, rd.length(), 3, true), { color: MZ.stalk, sway: 0.01 }, along(x + Math.cos(a) * 0.034, 0, z + Math.sin(a) * 0.034, rd.clone().normalize(), rd.length()));
  }
  // Leaves on alternate sides, slowly spiralling, long and drooping at the tips; dry and
  // browning from the bottom up when ripe.
  const a0 = rng.range(0, Math.PI * 2);
  const nLeaves = rng.int(5, 6);
  for (let k = 0; k < nLeaves; k++) {
    const a = a0 + k * (Math.PI + 0.3) + rng.range(-0.35, 0.35);
    const t = 0.14 + k * (0.66 / nLeaves);
    const col = ripe ? (k < 2 ? MZ.leafDry : k < 4 ? MZ.leafRipe : MZ.leaf) : k % 2 ? MZ.leaf : MZ.leafDark;
    const p = stalkAt(t);
    archLeaf(b, p.x, p.y, p.z, a, h * (0.46 - k * 0.03) * rng.range(0.85, 1.1), 0.032, vary(rng, col, 0.08), sway, 4, rng.range(0.45, 0.65), rng.range(0.65, 0.95));
  }
  // Cobs between the leaf sides.
  const cobs = ripe && rng.next() < 0.55 ? 2 : 1;
  for (let ci = 0; ci < cobs; ci++) {
    const ac = a0 + Math.PI / 2 + ci * Math.PI + rng.range(-0.3, 0.3);
    const yc = h * (0.42 + ci * 0.14);
    const dir = tilted(ac, ripe ? 0.6 : 0.35);
    const sp = stalkAt(yc / h);
    const bx = sp.x + Math.cos(ac) * 0.018, bz = sp.z + Math.sin(ac) * 0.018;
    if (ripe) {
      // Husk sheath round the base, one husk leaf peeled down, yellow kernels showing.
      b.add(P.cyl(0.03, 0.022, 0.06, 5, true), { color: MZ.husk, sway }, along(bx, yc, bz, dir, 0.06));
      b.add(P.cyl(0.015, 0.027, 0.14, 5), { color: rng.next() < 0.3 ? MZ.kernelDeep : MZ.kernel, sway }, along(bx + dir.x * 0.03, yc + dir.y * 0.03, bz + dir.z * 0.03, dir, 0.14));
      archLeaf(b, bx + dir.x * 0.05, yc + dir.y * 0.05, bz + dir.z * 0.05, ac + rng.range(-0.8, 0.8), 0.12, 0.02, MZ.husk, sway, 2, 0.3, 1.0);
    } else {
      b.add(P.cyl(0.013, 0.022, 0.11, 5), { color: MZ.huskGreen, sway }, along(bx, yc, bz, dir, 0.11));
      b.add(P.cone(0.014, 0.05, 3), { color: MZ.silk, sway }, along(bx + dir.x * 0.1, yc + dir.y * 0.1, bz + dir.z * 0.1, dir, 0.05));
    }
  }
  // Tassel: a central spike with branches (spread wide and golden when ripe, tight and green before).
  const tc = ripe ? MZ.tassel : MZ.tasselGreen;
  const spike = ripe ? 0.17 : 0.12;
  const tp = stalkAt(1);
  b.add(P.cone(0.011, spike, 3), { color: tc, sway }, M.t(tp.x, h - 0.01 + spike / 2, tp.z));
  const nb = ripe ? 3 : 2;
  for (let k = 0; k < nb; k++) {
    const a = a0 + (k / nb) * Math.PI * 2 + 0.4;
    const len = ripe ? 0.12 : 0.08;
    b.add(P.cone(0.007, len, 3), { color: tc, sway }, along(tp.x, h + 0.02, tp.z, tilted(a, ripe ? 1.1 : 0.5), len));
  }
}

/** A hanging carcass on a hook (local y down from the rail at y). */
function carcass(b: GeoBuilder, x: number, y: number, z: number, s: number, ry: number): void {
  b.add(P.cyl(0.006, 0.006, 0.08, 3), { color: c(0x55504a) }, M.t(x, y - 0.04, z));
  b.add(P.uvSphere(0.075 * s, 8, 6), { color: (p) => (Math.sin(p.y * 70 + p.x * 20) > 0.55 ? c(0xf0e0d0) : c(0xb4483e)) }, M.t(x, y - 0.08 - 0.12 * s, z, 0, ry, 0, 0.75, 1.9, 0.55));
}

/**
 * Slaughterhouse: a two-tiered cut-stone house with a red stepped-fret band, a timber roof hatch and a
 * curtained door up a step, a stone water trough beside it, and a red and cream striped awning over
 * the butcher's counter (cuts of meat, cleaver, a brazier). Beside it, on its +x half, the animal
 * yard: paved, fenced, with a gate, a drain grate and stains on the flags, carcasses hanging from a
 * slatted rack along the back, a meat trough and a log store. Torch post at the front corner.
 */
export function butcherModel(w: number, d: number): BuildingModel {
  const b = new GeoBuilder(), rng = new RNG(808);
  const hx = -w / 4 - 0.1, hd = d - 0.3;
  b.add(qbox(w - 0.1, 0.05, d - 0.1, 0.02, 1), { color: PEN.dust }, M.t(0, 0.025, 0));
  // The house.
  const bw = 1.45, bd = 1.15, bh = 0.84, bz = -hd / 2 + bd / 2 + 0.05;
  stoneBlock(b, bw, bh, bd, hx, 0.05, bz);
  fretBand(b, M.t(hx, 0.05 + bh - 0.12, bz + bd / 2 + 0.004), bw - 0.04, 0.1, K.red, AD.cream);
  b.add(P.box(bw + 0.01, 0.05, bd + 0.01), { color: K.red }, M.t(hx, 0.05 + 0.08, bz));
  stoneBlock(b, 0.72, 0.36, 0.62, hx + 0.12, 0.05 + bh, bz - 0.12);
  fretBand(b, M.t(hx + 0.12, 0.05 + bh + 0.2, bz - 0.12 + 0.314), 0.68, 0.1, K.red, AD.cream);
  for (const s of [-1, 0, 1]) b.add(P.box(0.08, 0.08, 0.02), { color: c(0x3b2a20) }, M.t(hx + 0.12 + s * 0.2, 0.05 + bh + 0.1, bz - 0.12 + 0.315));
  const ry = 0.05 + bh + 0.36 + 0.02;
  b.add(P.box(0.3, 0.03, 0.26), { color: K.timber }, M.t(hx + 0.12, ry + 0.02, bz - 0.12));
  for (const s of [-1, 1]) b.add(P.box(0.34, 0.04, 0.045), { color: K.timberDark }, M.t(hx + 0.12, ry + 0.05, bz - 0.12 + s * 0.08));
  // Door with a fret curtain, up a step, and the water trough beside it.
  const dz = bz + bd / 2, dx = hx + 0.35;
  b.add(P.box(0.32, 0.5, 0.03), { color: c(0x3b2a20) }, M.t(dx, 0.05 + 0.25, dz + 0.004));
  for (const s of [-1, 1]) b.add(P.box(0.05, 0.54, 0.05), { color: K.red }, M.t(dx + s * 0.18, 0.05 + 0.27, dz + 0.02));
  b.add(P.box(0.26, 0.38, 0.012), { color: AD.cream, sway: 0.15 }, M.t(dx, 0.05 + 0.31, dz + 0.025));
  fretBand(b, M.t(dx, 0.05 + 0.16, dz + 0.032), 0.24, 0.07, AD.cream, K.red);
  b.add(P.box(0.5, 0.06, 0.16), { color: CUT.stone }, M.t(dx, 0.08, dz + 0.1));
  trough(b, dx + 0.42, dz + 0.16, 0.34, 0.22, 0.14, PEN.water, true);
  // Awning over the butcher's counter, a brazier beside it.
  awning(b, hx - 0.32, 0.72, dz, 0.85, 0.42, true);
  b.add(P.box(0.7, 0.05, 0.28), { color: K.timber }, M.t(hx - 0.32, 0.36, dz + 0.22));
  for (const s of [-1, 1]) for (const t of [-1, 1]) b.add(P.box(0.04, 0.33, 0.04), { color: K.timberDark }, M.t(hx - 0.32 + s * 0.3, 0.2, dz + 0.22 + t * 0.1));
  for (let k = 0; k < 3; k++) {
    b.add(P.cyl(0.07, 0.07, 0.015, 9), { color: c(0x8a5a3a) }, M.t(hx - 0.55 + k * 0.23, 0.395, dz + 0.22));
    b.add(P.box(0.12, 0.03, 0.08), { color: k % 2 ? c(0xb4483e) : c(0x9a3a2a) }, M.t(hx - 0.55 + k * 0.23, 0.415, dz + 0.22, 0, k, 0));
  }
  b.add(P.box(0.1, 0.012, 0.05), { color: c(0x9a9a98) }, M.t(hx - 0.1, 0.4, dz + 0.3, 0, 0.4, 0));
  for (let k = 0; k < 3; k++) carcass(b, hx - 0.58 + k * 0.26, 0.66, dz + 0.36, 0.55, k);
  b.add(P.cyl(0.02, 0.025, 0.28, 5), { color: K.timberDark }, M.t(hx + 0.12, 0.14, dz + 0.45));
  const brazier = fireBowl(b, hx + 0.12, 0.28, dz + 0.45, 0.7);
  frettedPot(b, hx - 0.78, 0.05, dz + 0.42, 0.55);
  // The animal yard on the +x half: paving, a drain, stains, a fence and a gate.
  const px0 = 0.2, px1 = w / 2 - 0.1, pz0 = -d / 2 + 0.1, pz1 = d / 2 - 0.1, pcx = (px0 + px1) / 2;
  flagstones(b, px0 + 0.03, pz0 + 0.03, 6, 9, (px1 - px0 - 0.06) / 6, 0.05, (i, j) => ((i * 5 + j * 3) % 4 === 0 ? c(0xbca686) : (i + j) % 2 ? c(0xd2bd98) : c(0xc6b08c)));
  b.add(P.box(0.32, 0.012, 0.32), { color: c(0x3a3632) }, M.t(pcx, 0.075, 0.15));
  for (let k = 0; k < 5; k++) b.add(P.box(0.3, 0.014, 0.025), { color: c(0x6a6560) }, M.t(pcx, 0.078, 0.03 + k * 0.06));
  for (let k = 0; k < 6; k++) b.add(P.cyl(rng.range(0.05, 0.12), rng.range(0.05, 0.12), 0.006, 8), { color: c(0x7a2a24) }, M.t(pcx + rng.range(-0.6, 0.6), 0.072, rng.range(-0.8, 0.9), 0, rng.range(0, 3), 0, 1, 1, rng.range(0.5, 1)));
  const FH = 0.4, gate0 = pcx - 0.25, gate1 = pcx + 0.25;
  const runs: [number, number, number, number][] = [[px0, pz0, px1, pz0], [px1, pz0, px1, pz1], [px0, pz1, gate0, pz1], [gate1, pz1, px1, pz1], [px0, pz0 + 1.3, px0, pz1]];
  for (const [x0, z0, x1, z1] of runs) {
    const len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 0.42));
    for (let k = 0; k <= n; k++) b.add(P.box(0.07, FH + 0.08, 0.07), { color: K.timberDark }, M.t(x0 + ((x1 - x0) * k) / n, (FH + 0.08) / 2, z0 + ((z1 - z0) * k) / n));
    for (const y of [FH * 0.35, FH * 0.75]) b.add(P.box(0.04, 0.07, len), { color: K.timber }, M.t((x0 + x1) / 2, y, (z0 + z1) / 2, 0, a, 0));
  }
  const gm = M.t(gate0, 0, pz1, 0, 1.1, 0);
  for (const y of [0.14, 0.32]) b.add(P.box(0.5, 0.06, 0.035), { color: K.timber }, gm.clone().multiply(M.t(0.25, y, 0)));
  b.add(P.box(0.56, 0.04, 0.03), { color: K.timberDark }, gm.clone().multiply(M.t(0.25, 0.23, 0.005, 0, 0, 0.45)));
  // Hanging rack along the back of the yard: posts, a slatted roof and carcasses on hooks.
  for (const x of [px0 + 0.1, pcx, px1 - 0.1]) b.add(P.cyl(0.035, 0.04, 0.95, 6), { color: K.timberDark }, M.t(x, 0.475, pz0 + 0.35));
  b.add(P.box(px1 - px0, 0.05, 0.05), { color: K.timberDark }, M.t(pcx, 0.78, pz0 + 0.35));
  slatRoof(b, pcx, 0.97, pz0 + 0.3, px1 - px0 + 0.1, 0.6, -0.12, rng);
  for (let k = 0; k < 5; k++) carcass(b, px0 + 0.3 + k * ((px1 - px0 - 0.6) / 4), 0.78, pz0 + 0.35, 1, k * 0.7);
  // Meat trough and the log store.
  trough(b, px1 - 0.3, pz1 - 0.4, 0.5, 0.3, 0.16, c(0x8a2f28));
  for (let k = 0; k < 5; k++) b.add(P.cyl(0.055, 0.055, 0.6, 7), { color: k % 2 ? K.timber : c(0x7a5233) }, M.t(px1 - 0.12 - (k % 2) * 0.1, 0.07 + Math.floor(k / 2) * 0.1, 0.05, Math.PI / 2, 0, 0));
  barrel(b, px0 + 0.25, 0.05, pz1 - 0.3, 0.9);
  for (const [x, z] of [[-w / 2 + 0.15, d / 2 - 0.12], [0.05, d / 2 - 0.1]] as const) blooms(b, x, 0.03, z, 3, 0.06, 0.03, Math.round(x * 70));
  const t = torchPole(b, -w / 2 + 0.2, d / 2 - 0.25, 0.8, 0.05);
  return { finished: b.build(), torches: [t, brazier], height: 1.4 };
}

// ---------------- Livestock pens ----------------

const PEN = {
  withy: c(0x8a6440),
  withyDark: c(0x6b4a2c),
  straw: c(0xd9b866),
  strawDark: c(0xb8913f),
  // Ground tones chosen to read as bare earth: the building skin would turn browns that are more
  // saturated into timber planks, and paler sandy ones into flagstones.
  earth: c(0x86735c),
  dust: c(0xa08c6f),
  grass: c(0x6f8c45),
  mud: c(0x5c412a),
  mudDark: c(0x3b2a1b),
  puddle: c(0x6d7c80),
  sheen: c(0xa9bcc0),
  water: c(0x2f7fa0),
  grain: c(0xe0b33a),
  egg: c(0xf3e9d6),
};

/** The pig pen's yard (local): where penned animals roam, clear of the sty and troughs. */
export const PIG_PEN = {
  centre(_w: number, _d: number): [number, number] {
    return [0.1, 0.25];
  },
};
/** The chicken pen's yard (local), in front of the coop and perches. */
export const CHICKEN_PEN = {
  centre(_w: number, _d: number): [number, number] {
    return [0, 0.4];
  },
};

/**
 * The ground penned animals may use, in a pen's model-local coordinates: the open yard (a square of
 * this half-size) less everything standing in it (x0, z0, x1, z1 rectangles), so animals walk round
 * the sty, coop, troughs and feeders instead of through them.
 */
export interface PenLayout { half: number; blocks: [number, number, number, number][] }
const PEN_LAYOUTS: Record<string, PenLayout> = {
  pigpen: {
    half: 2.15,
    blocks: [
      [-2.4, -2.4, -0.2, -1.1], // the shed
      [1.05, -2.4, 1.75, -1.8], // straw barrel
      [1.82, -2.1, 2.4, -1.0], // feed trough
      [1.85, -0.8, 2.4, 0.1], // second feed trough
      [-2.4, 0.1, -1.65, 1.2], // stone water trough
      [-2.4, 1.3, -1.45, 2.4], // pot and basket by the gate
    ],
  },
  chickenpen: {
    half: 2.15,
    blocks: [
      [0.3, -2.4, 2.4, -1.1], // coop and nest boxes
      [0.62, -1.25, 0.94, -0.45], // ramp
      [-1.95, -2.1, -0.75, -1.2], // roosting frame
      [-2.4, -0.72, -1.6, -0.2], // hanging feeder
      [1.85, 0.45, 2.4, 1.35], // grain trough
      [-2.2, 1.3, -1.7, 1.8], // water dish
    ],
  },
};
export const penLayout = (key: string): PenLayout | null => PEN_LAYOUTS[key] ?? null;

/** Woven wattle between (x0, z0) and (x1, z1): rows of withies, alternately in front of and behind the stakes. */
function wattleRun(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y0: number, h: number, rows: number, t = 0.035): void {
  const len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(x1 - x0, z1 - z0);
  const px = Math.cos(a), pz = -Math.sin(a);
  const rh = h / rows;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2 ? 1 : -1) * 0.012;
    b.add(P.box(t, rh * 0.86, len), { color: r % 2 ? PEN.withy : PEN.withyDark }, M.t((x0 + x1) / 2 + px * off, y0 + (r + 0.5) * rh, (z0 + z1) / 2 + pz * off, 0, a, 0));
  }
}

/** Posts along a straight run, `spacing` apart (both ends included). */
function fencePosts(b: GeoBuilder, rng: RNG, x0: number, z0: number, x1: number, z1: number, spacing: number, h: number, r = 0.032): void {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / spacing));
  for (let s = 0; s <= n; s++) {
    const ph = h + rng.range(-0.03, 0.04);
    b.add(P.cyl(r * 0.85, r, ph, 5), { color: K.timberDark }, M.t(x0 + ((x1 - x0) * s) / n, ph / 2, z0 + ((z1 - z0) * s) / n, 0, rng.range(0, 1), 0));
  }
}

/** A low gable of thatch with its ridge along x: layered courses, a ridge roll and a ragged fringe at the eaves. */
function gableThatch(b: GeoBuilder, x: number, eave: number, z: number, len: number, depth: number, rise: number, fringe = 6): void {
  const half = depth / 2, L = Math.hypot(half, rise), a = Math.atan2(rise, half);
  for (const s of [1, -1]) {
    b.add(P.box(len, 0.06, L + 0.04), { color: K.thatch, leaf: 0.2 }, M.t(x, eave + rise / 2 + 0.02, z + (s * half) / 2, s * a, 0, 0));
    // Two darker courses laid over the main thatch.
    for (const f of [0.28, 0.66]) {
      const zz = z + s * half * (1 - f), yy = eave + rise * f + 0.065;
      b.add(P.box(len + 0.02, 0.03, 0.09), { color: K.thatchDark, leaf: 0.2 }, M.t(x, yy, zz, s * a, 0, 0));
    }
    for (let k = 0; k < fringe; k++) {
      const fx = x - len / 2 + ((k + 0.5) / fringe) * len;
      b.add(P.cone(0.05, 0.1, 4), { color: K.thatchDark, leaf: 0.2 }, M.t(fx, eave - 0.02, z + s * (half + 0.02), s * (Math.PI - 0.5), 0, 0));
    }
  }
  b.add(P.cyl(0.05, 0.05, len + 0.06, 6), { color: K.thatchDark, leaf: 0.2 }, M.t(x, eave + rise + 0.03, z, 0, 0, Math.PI / 2));
}

/** Scattered straw: a couple of low, loose heaps with stalks strewn round them. */
function strawPatch(b: GeoBuilder, rng: RNG, x: number, z: number, r: number, stalks = 5, y = 0.02): void {
  for (let k = 0; k < 2; k++) {
    const a = rng.range(0, Math.PI * 2), d = k * r * 0.45;
    b.add(lumpy(P.sphere(r * (0.38 - k * 0.1), 1), 0.3, rng.int(1, 999), 0.3), { color: k ? PEN.strawDark : PEN.straw, leaf: 0.2 },
      M.t(x + Math.cos(a) * d, y, z + Math.sin(a) * d));
  }
  for (let k = 0; k < stalks * 3; k++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(r * 0.3, r * 1.3);
    b.add(P.box(0.01, 0.006, rng.range(0.07, 0.13)), { color: k % 2 ? PEN.strawDark : PEN.straw, leaf: 0.2 }, M.t(x + Math.cos(a) * d, y + 0.004, z + Math.sin(a) * d, 0, rng.range(0, 3.14), 0));
  }
}

/**
 * Yard ground inside a pen: gently uneven bare earth, blotched lighter and darker, worn bare in the
 * middle and greening into grass toward the fence, with a few tufts left along it.
 */
function yardGround(b: GeoBuilder, rng: RNG, hw: number, hd: number, base: THREE.Color): void {
  const g = new THREE.PlaneGeometry(hw * 2 - 0.04, hd * 2 - 0.04, 18, 18);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, 0.012 + Math.sin(p.getX(i) * 3.1) * Math.cos(p.getZ(i) * 2.7) * 0.008);
  g.computeVertexNormals();
  const col = new THREE.Color();
  b.add(g, {
    color: (q) => {
      const edge = Math.min(hw - Math.abs(q.x), hd - Math.abs(q.z));
      const blot = Math.sin(q.x * 4.3 + 1.7) * Math.sin(q.z * 3.7 - 0.4) * 0.5 + Math.sin(q.x * 9.1 - q.z * 7.3) * 0.25;
      col.copy(base).multiplyScalar(1 + blot * 0.12);
      return col.lerp(PEN.grass, THREE.MathUtils.smoothstep(0.45, 0.05, edge) * 0.85).clone();
    },
  });
  for (let k = 0; k < 26; k++) {
    const side = rng.int(0, 3), t = rng.range(-1, 1), inset = rng.range(0.05, 0.22);
    const x = side < 2 ? t * (hw - 0.1) : (side === 2 ? -1 : 1) * (hw - inset);
    const z = side < 2 ? (side === 0 ? -1 : 1) * (hd - inset) : t * (hd - 0.1);
    for (let j = 0; j < 3; j++) {
      b.add(P.cone(0.035, rng.range(0.12, 0.2), 4), { color: j % 2 ? PEN.grass : c(0x5d7a3a), leaf: 1, sway: 0.3 },
        M.t(x + rng.range(-0.04, 0.04), 0.05, z + rng.range(-0.04, 0.04), rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3)));
    }
  }
}

/** A four-board trough (length along z), optionally filled with water or feed. */
function trough(b: GeoBuilder, x: number, z: number, len: number, wid: number, h: number, fill: THREE.Color, stone = false): void {
  const col = stone ? K.stone : K.timber, t = stone ? 0.05 : 0.03;
  b.add(P.box(wid, 0.04, len), { color: stone ? K.stoneDark : K.timberDark }, M.t(x, 0.02, z));
  for (const s of [1, -1]) {
    b.add(P.box(t, h, len), { color: col }, M.t(x + s * (wid / 2 - t / 2), h / 2, z));
    b.add(P.box(wid, h, t), { color: col }, M.t(x, h / 2, z + s * (len / 2 - t / 2)));
  }
  b.add(P.box(wid - t * 2, 0.012, len - t * 2), { color: fill }, M.t(x, h * 0.72, z));
}

/**
 * Pig pen: a plank-fenced yard with a cross-braced gate. At the back left an open-sided shed with a
 * shingled gable roof over straw bedding, hay bales and barrels; in the middle a muddy wallow ringed
 * with stones; a stone water trough on the left, two feed troughs along the right-hand fence, a
 * straw barrel in the back corner and a big clay pot and basket by the gate. Grass and ferns grow up
 * along the fence.
 */
export function pigpenModel(w: number, d: number): BuildingModel {
  const b = new GeoBuilder();
  const rng = new RNG(31);
  const hw = w / 2 - 0.1, hd = d / 2 - 0.1, g0 = -0.1, g1 = 0.75, FH = 0.42;
  yardGround(b, rng, hw, hd, PEN.earth);
  // Plank fence: square posts with three broad boards, a gap at the front for the gate.
  const runs: [number, number, number, number][] = [[-hw, -hd, hw, -hd], [hw, -hd, hw, hd], [-hw, -hd, -hw, hd], [-hw, hd, g0, hd], [g1, hd, hw, hd]];
  for (const [x0, z0, x1, z1] of runs) {
    const len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 0.55));
    for (let k = 0; k <= n; k++) b.add(P.box(0.08, FH + 0.1, 0.08), { color: K.timberDark }, M.t(x0 + ((x1 - x0) * k) / n, (FH + 0.1) / 2, z0 + ((z1 - z0) * k) / n));
    for (const [y, col] of [[FH * 0.25, K.timber], [FH * 0.55, c(0x9a7550)], [FH * 0.85, K.timber]] as const) b.add(P.box(0.035, 0.1, len), { color: col }, M.t((x0 + x1) / 2, y, (z0 + z1) / 2, 0, a, 0));
  }
  // The gate, shut, with a cross-brace and iron hinges.
  for (const x of [g0, g1]) b.add(P.box(0.1, FH + 0.18, 0.1), { color: K.timberDark }, M.t(x, (FH + 0.18) / 2, hd));
  for (const y of [FH * 0.3, FH * 0.8]) b.add(P.box(g1 - g0 - 0.12, 0.08, 0.035), { color: K.timber }, M.t((g0 + g1) / 2, y, hd + 0.02));
  b.add(P.box(Math.hypot(g1 - g0 - 0.12, FH * 0.5), 0.06, 0.03), { color: K.timberDark }, M.t((g0 + g1) / 2, FH * 0.55, hd + 0.04, 0, 0, Math.atan2(FH * 0.5, g1 - g0 - 0.12)));
  for (const y of [FH * 0.3, FH * 0.8]) b.add(P.box(0.08, 0.03, 0.04), { color: c(0x4a4642) }, M.t(g0 + 0.08, y, hd + 0.045));

  // Shed at the back left: posts, a shingled gable roof, straw, bales and barrels.
  const sx = -1.3, sz = -1.7, sw = 1.95, sd = 1.1;
  b.add(P.box(sw - 0.06, 0.03, sd - 0.06), { color: PEN.straw }, M.t(sx, 0.025, sz));
  strawPatch(b, rng, sx + 0.55, sz + 0.62, 0.22, 4, 0.02);
  for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1]] as const) b.add(P.box(0.08, 0.62, 0.08), { color: K.timberDark }, M.t(sx + (ox * (sw - 0.08)) / 2, 0.31, sz + (oz * (sd - 0.08)) / 2));
  b.add(P.box(sw, 0.06, 0.06), { color: K.timberDark }, M.t(sx, 0.62, sz + sd / 2 - 0.04));
  b.add(P.box(sw, 0.06, 0.06), { color: K.timberDark }, M.t(sx, 0.62, sz - sd / 2 + 0.04));
  // Shingles: courses of short boards on each slope, under a ridge board.
  const rise = 0.34, half = sd / 2 + 0.12, slope = Math.atan2(rise, half), L = Math.hypot(half, rise);
  for (const s of [1, -1]) {
    for (let r = 0; r < 4; r++) {
      const f = (r + 0.5) / 4, y = 0.64 + rise * (1 - f), z = sz + s * half * f;
      for (let k = 0; k < 9; k++) b.add(P.box(sw / 9 + 0.01, 0.03, L / 4 + 0.04), { color: (k + r) % 3 === 0 ? c(0x8f6a45) : (k + r) % 2 ? c(0xa98259) : c(0xb89268) }, M.t(sx - sw / 2 - 0.05 + (k + 0.5) * ((sw + 0.1) / 9), y + 0.02, z, s * slope, 0, 0));
    }
  }
  b.add(P.box(sw + 0.14, 0.06, 0.1), { color: K.timberDark }, M.t(sx, 0.64 + rise + 0.03, sz));
  for (const s of [-1, 1]) b.add(P.box(0.03, rise, 0.03), { color: K.timberDark }, M.t(sx + s * (sw / 2), 0.64 + rise / 2, sz));
  for (const [x, z] of [[sx - 0.5, sz - 0.15], [sx - 0.22, sz - 0.1]] as const) b.add(P.box(0.28, 0.16, 0.18), { color: c(0xd9c26a) }, M.t(x, 0.11, z, 0, 0.15, 0));
  b.add(P.box(0.26, 0.15, 0.17), { color: c(0xcbb35a) }, M.t(sx - 0.36, 0.27, sz - 0.12, 0, -0.1, 0));
  for (const [x, z] of [[sx - 0.82, sz + 0.22], [sx + 0.22, sz - 0.25]] as const) barrel(b, x, 0.03, z, 1.1);
  b.add(lumpy(P.sphere(0.09, 0), 0.25, 5, 0.6), { color: PEN.straw }, M.t(sx + 0.22, 0.29, sz - 0.25));

  // The wallow: dark mud and puddles in a ring of stones.
  const wx = 0.3, wz = 0.15;
  b.add(P.cyl(0.88, 0.92, 0.014, 16), { color: PEN.mud }, M.t(wx, 0.022, wz, 0, 0.3, 0, 1, 1, 0.85));
  b.add(P.cyl(0.66, 0.7, 0.014, 14), { color: PEN.mudDark }, M.t(wx + 0.04, 0.03, wz - 0.02, 0, 1.1, 0, 1, 1, 0.82));
  for (const [ox, oz, r] of [[-0.2, 0.1, 0.22], [0.25, -0.18, 0.15], [0.12, 0.28, 0.1]] as const) {
    b.add(P.cyl(r, r, 0.01, 10), { color: PEN.puddle }, M.t(wx + ox, 0.04, wz + oz, 0, ox * 5, 0, 1, 1, 0.7));
    b.add(P.cyl(r * 0.35, r * 0.35, 0.006, 6), { color: PEN.sheen }, M.t(wx + ox - r * 0.3, 0.046, wz + oz - r * 0.15, 0, 0, 0, 1.6, 1, 0.6));
  }
  for (let k = 0; k < 11; k++) {
    const a = (k / 11) * Math.PI * 2 + rng.range(-0.15, 0.15), r = 0.95;
    b.add(lumpy(P.sphere(rng.range(0.06, 0.09), 0), 0.25, 21 + k, 0.55), { color: k % 3 ? c(0x8c8a84) : c(0x6f6d68) }, M.t(wx + Math.cos(a) * r, 0.035, wz + Math.sin(a) * r * 0.85));
  }

  // Stone water trough on the left; two feed troughs along the right fence; a straw barrel in the corner.
  trough(b, -hw + 0.38, 0.65, 0.95, 0.32, 0.18, PEN.water, true);
  trough(b, hw - 0.32, -1.55, 0.95, 0.28, 0.15, PEN.grain);
  trough(b, hw - 0.3, -0.35, 0.8, 0.26, 0.15, c(0x9fb24a));
  for (let k = 0; k < 4; k++) b.add(P.box(0.04, 0.02, 0.05), { color: c(0x8fb24a) }, M.t(hw - 0.3 + rng.range(-0.06, 0.06), 0.12, -0.62 + k * 0.18));
  barrel(b, 1.4, 0.02, -hd + 0.32, 1.25);
  b.add(lumpy(P.sphere(0.1, 0), 0.3, 77, 0.6), { color: PEN.straw }, M.t(1.4, 0.31, -hd + 0.32));
  // Pot and basket by the gate; loose straw.
  frettedPot(b, -hw + 0.4, 0.02, hd - 0.55, 1.25, 0xa8583e);
  heapBasket(b, -hw + 0.75, 0.02, hd - 0.35, 0.12, 0.13, [0xc9b46a, 0x8fb24a], rng);
  for (const [x, z, r] of [[-0.6, -0.55, 0.18], [1.3, 1.5, 0.14], [-1.2, 1.35, 0.16], [0.9, -1.2, 0.15]] as const) strawPatch(b, rng, x, z, r, 3);
  // Ferns along the outside of the fence.
  for (const [x, z] of [[-hw, -0.6], [hw, 1.2], [-1.4, hd], [1.6, hd]] as const) blooms(b, x, 0.02, z, 4, 0.03, 0.03, Math.round(x * 33 + z * 7));
  return { finished: b.build(), torches: [], height: 1.1 };
}

/**
 * Chicken pen: a cane-fenced yard of dust and straw, with a thatched coop raised on stilts at the back
 * right (cleated ramp, nest boxes with eggs on its side), a roosting frame, grain feeders and a water dish.
 */
export function chickenpenModel(w: number, d: number): BuildingModel {
  const b = new GeoBuilder();
  const rng = new RNG(47);
  const hw = w / 2 - 0.1, hd = d / 2 - 0.1, gate = 0.42, FH = 0.4;
  // Dusty yard, a scratched-out dust bath and straw strewn about.
  yardGround(b, rng, hw, hd, PEN.dust);
  // A dust bath scratched into the earth: a dark hollow with a scuffed rim of loose soil.
  b.add(P.cyl(0.34, 0.36, 0.008, 14), { color: c(0x6e5c48) }, M.t(-0.7, 0.022, 0.9, 0, 0, 0, 1, 1, 0.75));
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    b.add(lumpy(P.sphere(0.05, 0), 0.35, 60 + k, 0.35), { color: c(0x8a7660) }, M.t(-0.7 + Math.cos(a) * 0.38, 0.022, 0.9 + Math.sin(a) * 0.29));
  }
  for (const [x, z, r] of [[0.5, 0.2, 0.34], [-0.3, -0.4, 0.26], [1.2, 1.1, 0.24], [0.1, 1.6, 0.2], [-1.4, 0.2, 0.22], [0.8, -0.85, 0.3]] as const) strawPatch(b, rng, x, z, r, 4);
  // Cane fence: close-set canes wired to two rails between stout posts, a gateway at the front.
  const runs: [number, number, number, number][] = [[-hw, -hd, hw, -hd], [hw, -hd, hw, hd], [-hw, -hd, -hw, hd], [-hw, hd, -gate, hd], [gate, hd, hw, hd]];
  for (const [x0, z0, x1, z1] of runs) {
    fencePosts(b, rng, x0, z0, x1, z1, 0.95, FH + 0.06, 0.034);
    const len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(x1 - x0, z1 - z0);
    for (const y of [0.12, 0.32]) b.add(P.box(0.026, 0.026, len), { color: K.timber }, M.t((x0 + x1) / 2, y, (z0 + z1) / 2, 0, a, 0));
    const n = Math.round(len / 0.2);
    for (let s = 1; s < n; s++) {
      const ch = FH + rng.range(-0.04, 0.03), f = s / n;
      b.add(P.box(0.018, ch, 0.018), { color: s % 3 ? c(0xc9b27a) : c(0xa89260) }, M.t(x0 + (x1 - x0) * f, ch / 2, z0 + (z1 - z0) * f, 0, a, 0));
    }
  }
  for (const s of [-1, 1]) b.add(P.cyl(0.038, 0.044, 0.56, 6), { color: K.timberDark }, M.t(s * gate, 0.28, hd));
  // Little woven gate standing open against the front fence, inside.
  wattleRun(b, -gate - 0.04, hd - 0.07, -gate - 0.8, hd - 0.07, 0.04, 0.3, 4, 0.03);

  // Coop on stilts at the back right.
  const cx = 1.05, cz = -1.62, cw = 1.2, cd = 0.78, fy = 0.38, ch = 0.46;
  for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    b.add(P.cyl(0.035, 0.04, fy + ch, 5), { color: K.timberDark }, M.t(cx + ox * (cw / 2 - 0.02), (fy + ch) / 2, cz + oz * (cd / 2 - 0.02)));
  }
  b.add(P.box(cw + 0.06, 0.04, cd + 0.06), { color: K.timber }, M.t(cx, fy, cz));
  // Walls: daubed wattle below a woven band, so the coop reads light and airy.
  b.add(P.box(cw - 0.04, ch * 0.6, cd - 0.04), { color: K.adobe }, M.t(cx, fy + 0.02 + ch * 0.3, cz));
  b.add(P.box(cw - 0.04, 0.04, cd - 0.04), { color: c(0xc9a474) }, M.t(cx, fy + 0.04, cz));
  wattleRun(b, cx - cw / 2 + 0.02, cz + cd / 2 - 0.02, cx + cw / 2 - 0.02, cz + cd / 2 - 0.02, fy + ch * 0.62, ch * 0.38, 3, 0.03);
  wattleRun(b, cx - cw / 2 + 0.02, cz - cd / 2 + 0.02, cx + cw / 2 - 0.02, cz - cd / 2 + 0.02, fy + ch * 0.62, ch * 0.38, 3, 0.03);
  wattleRun(b, cx - cw / 2 + 0.02, cz - cd / 2 + 0.02, cx - cw / 2 + 0.02, cz + cd / 2 - 0.02, fy + ch * 0.62, ch * 0.38, 3, 0.03);
  wattleRun(b, cx + cw / 2 - 0.02, cz - cd / 2 + 0.02, cx + cw / 2 - 0.02, cz + cd / 2 - 0.02, fy + ch * 0.62, ch * 0.38, 3, 0.03);
  // Pop hole on the front, and a painted band.
  const dx = cx - 0.28;
  b.add(P.box(0.16, 0.2, 0.03), { color: K.door }, M.t(dx, fy + 0.12, cz + cd / 2 - 0.005));
  b.add(P.box(0.22, 0.03, 0.035), { color: K.timberDark }, M.t(dx, fy + 0.235, cz + cd / 2));
  b.add(P.box(cw - 0.02, 0.03, 0.02), { color: AD.red }, M.t(cx + 0.02, fy + ch * 0.6, cz + cd / 2 - 0.01));
  gableThatch(b, cx, fy + ch, cz, cw + 0.28, cd + 0.3, 0.3, 6);
  // Cleated ramp from the pop hole down into the yard.
  const rl = 0.8, ra = Math.asin(fy / rl);
  const r0z = cz + cd / 2 + 0.02, rmz = r0z + (Math.cos(ra) * rl) / 2;
  b.add(P.box(0.18, 0.025, rl), { color: K.timber }, M.t(dx, fy / 2 + 0.01, rmz, ra, 0, 0));
  for (let k = 1; k < 5; k++) {
    const f = k / 5;
    b.add(P.box(0.18, 0.018, 0.02), { color: K.timberDark }, M.t(dx, fy * (1 - f) + 0.03, r0z + Math.cos(ra) * rl * f, ra, 0, 0));
  }
  // Nest boxes along the coop's right side: three straw-lined cubbies, eggs in two.
  const nx = cx + cw / 2 + 0.13, ny = fy + 0.03;
  b.add(P.box(0.26, 0.03, cd - 0.06), { color: K.timber }, M.t(nx, ny, cz));
  // Open to the outside behind a low lip, under a sloping lid.
  b.add(P.box(0.03, 0.07, cd - 0.06), { color: K.timber }, M.t(nx + 0.12, ny + 0.035, cz));
  for (let k = 0; k < 4; k++) b.add(P.box(0.26, 0.18, 0.025), { color: K.timberDark }, M.t(nx, ny + 0.105, cz - (cd - 0.08) / 2 + (k * (cd - 0.08)) / 3));
  b.add(P.box(0.34, 0.03, cd + 0.02), { color: K.thatchDark, leaf: 0.2 }, M.t(nx + 0.02, ny + 0.25, cz, 0, 0, -0.3));
  const cub = (cd - 0.08) / 3;
  for (let k = 0; k < 3; k++) {
    const zz = cz - (cd - 0.08) / 2 + cub * (k + 0.5);
    b.add(P.cyl(0.08, 0.09, 0.04, 7), { color: PEN.straw }, M.t(nx, ny + 0.035, zz));
    if (k !== 1) b.add(P.uvSphere(0.028, 6, 5), { color: PEN.egg }, M.t(nx + 0.02, ny + 0.07, zz + 0.02, 0, 0, 0, 1, 1.3, 1));
  }
  b.add(P.uvSphere(0.026, 6, 5), { color: PEN.egg }, M.t(nx - 0.03, ny + 0.07, cz - (cd - 0.08) / 2 + cub * 0.5 - 0.03, 0, 0, 0, 1, 1.3, 1));

  // Roosting frame at the back left: two A-frame ends carrying perches at three heights.
  const px = -1.35, pz = -1.65;
  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) b.add(P.cyl(0.018, 0.022, 0.66, 5), { color: K.timberDark }, M.t(px + s * 0.5, 0.3, pz + t * 0.14, -t * 0.42, 0, 0));
  }
  for (const [y, oz] of [[0.18, 0.2], [0.34, 0.12], [0.5, 0.04]] as const) {
    b.add(P.cyl(0.018, 0.018, 1.1, 5), { color: K.timber }, M.t(px, y, pz + oz, 0, 0, Math.PI / 2));
    b.add(P.cyl(0.018, 0.018, 1.1, 5), { color: K.timber }, M.t(px, y, pz - oz, 0, 0, Math.PI / 2));
  }
  strawPatch(b, rng, px, pz, 0.34, 3);

  // Feeders: a covered hanging gourd on a post, a long grain trough on legs, and a water dish.
  const fx = -hw + 0.4, fz = -0.45;
  b.add(P.cyl(0.025, 0.03, 0.62, 5), { color: K.timberDark }, M.t(fx, 0.31, fz));
  b.add(P.box(0.3, 0.025, 0.025), { color: K.timberDark }, M.t(fx + 0.14, 0.6, fz));
  b.add(P.cyl(0.006, 0.006, 0.22, 3), { color: K.rope }, M.t(fx + 0.26, 0.49, fz));
  b.add(P.uvSphere(0.06, 8, 6), { color: c(0xb88a3a) }, M.t(fx + 0.26, 0.34, fz, 0, 0, 0, 1, 1.2, 1));
  b.add(P.cyl(0.012, 0.02, 0.04, 6), { color: c(0x8a6a2a) }, M.t(fx + 0.26, 0.27, fz));
  b.add(P.cyl(0.13, 0.1, 0.04, 10), { color: K.terracotta }, M.t(fx + 0.26, 0.17, fz));
  b.add(P.cyl(0.11, 0.11, 0.01, 10), { color: PEN.grain }, M.t(fx + 0.26, 0.19, fz));
  const tx = hw - 0.35, tz = 0.9;
  for (const s of [-1, 1]) b.add(P.box(0.2, 0.08, 0.03), { color: K.timberDark }, M.t(tx, 0.04, tz + s * 0.36));
  b.add(P.box(0.14, 0.03, 0.8), { color: K.timber }, M.t(tx, 0.09, tz));
  for (const s of [-1, 1]) b.add(P.box(0.02, 0.06, 0.8), { color: K.timber }, M.t(tx + s * 0.07, 0.12, tz));
  b.add(P.box(0.11, 0.012, 0.76), { color: PEN.grain }, M.t(tx, 0.115, tz));
  b.add(P.cyl(0.16, 0.12, 0.06, 10), { color: K.terracotta }, M.t(-hw + 0.45, 0.03, 1.55));
  b.add(P.cyl(0.14, 0.14, 0.01, 10), { color: PEN.water }, M.t(-hw + 0.45, 0.058, 1.55));
  // Scattered grain round the feeders.
  for (let k = 0; k < 10; k++) b.add(P.box(0.02, 0.01, 0.02), { color: PEN.grain }, M.t(rng.range(-0.6, 1.4), 0.025, rng.range(0, 1.3), 0, rng.range(0, 3), 0));
  return { finished: b.build(), torches: [], height: 1.2 };
}

/** Wood store: an open-fronted adobe shed with a flat roof on timber beams. Log/stone piles are separate fill meshes. */
export function woodstoreModel(w: number, d: number): BuildingModel {
  const b = new GeoBuilder();
  const hw = w / 2 - 0.12, hd = d / 2 - 0.12;
  const H = 0.95;
  b.add(P.box(w - 0.2, 0.06, d - 0.2), { color: CUT.stoneDark }, M.t(0, 0.03, 0));
  // Back and side walls (open at the front), cut stone with a red fret frieze inside the back wall.
  stoneBlock(b, w - 0.24, H, 0.2, 0, 0, -hd + 0.1, false);
  fretBand(b, M.t(0, H - 0.16, -hd + 0.205), w - 0.3, 0.1, K.red, AD.cream);
  for (const sx of [-1, 1]) stoneBlock(b, 0.2, H * 0.85, d - 0.35, sx * (hw - 0.1), 0, 0.05, false);
  // A slatted timber roof on rope-bound posts, sloping to the front.
  for (const sx of [-1, 1]) {
    b.add(P.cyl(0.05, 0.06, H, 6), { color: K.timberDark }, M.t(sx * (hw - 0.1), H / 2, hd - 0.02));
    b.add(P.cyl(0.056, 0.056, 0.04, 6), { color: K.rope }, M.t(sx * (hw - 0.1), H - 0.2, hd - 0.02));
  }
  b.add(P.box(w - 0.3, 0.08, 0.08), { color: K.timberDark }, M.t(0, H - 0.05, hd - 0.02));
  slatRoof(b, 0, H + 0.08, 0.02, w - 0.05, d - 0.05, 0.08, new RNG(77));
  // Chopping block with an axe, and a potted plant.
  b.add(P.cyl(0.14, 0.16, 0.22, 8), { color: K.timber }, M.t(hw + 0.05, 0.11, hd + 0.3));
  b.add(P.box(0.03, 0.26, 0.03), { color: K.timberDark }, M.t(hw + 0.05, 0.32, hd + 0.3, 0, 0, 0.5));
  b.add(P.box(0.1, 0.06, 0.02), { color: K.stoneDark }, M.t(hw - 0.02, 0.44, hd + 0.3, 0, 0, 0.5));
  pottedPlant(b, -hw - 0.05, 0, hd + 0.25, 0.8);
  return { finished: b.build(), torches: [new THREE.Vector3(-hw - 0.1, 0.9, hd + 0.2)], height: 1.2 };
}

export function logPileGeometry(seed: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new RNG(seed);
  const rows = [3, 2, 1];
  rows.forEach((n, r) => {
    for (let k = 0; k < n; k++) {
      const x = (k - (n - 1) / 2) * 0.17;
      b.add(P.cyl(0.08, 0.08, 0.6, 7), { color: (p) => (Math.abs(p.z) > 0.28 ? c(0xd9b88a) : K.timber) }, M.t(x, 0.08 + r * 0.14, rng.range(-0.03, 0.03), Math.PI / 2, 0, 0));
    }
  });
  return b.build();
}

export function stonePileGeometry(seed: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new RNG(seed);
  for (let k = 0; k < 5; k++) b.add(lumpy(P.sphere(rng.range(0.09, 0.14), 1), 0.2, seed + k, 0.75), { color: k % 2 ? K.stone : K.stoneDark }, M.t(rng.range(-0.18, 0.18), 0.08 + (k > 2 ? 0.1 : 0), rng.range(-0.15, 0.15)));
  return b.build();
}

/** Where the Food Store's baskets appear as its stocks fill (local x, z), clear of the model's own props. */
export const GRAIN_SLOTS: [number, number][] = [[-0.62, -0.62], [-0.62, -0.3], [0.62, -0.55], [0.82, -0.25], [-0.62, 0.66], [0.3, 0.74], [0.6, 0.74], [-0.82, 0.38]];

/**
 * Food Store: a two-tiered cut-stone granary banded in yellow with round peg studs, a timber hatch
 * on its roof and a doorway hung with a yellow curtain with a stepped fret. A slatted lean-to on its
 * left shelters baskets of maize and grain; a little pergola on its right shades crates of
 * tomatoes and squash; painted pots and a grain sack stand by the door on a paved, kerbed base.
 */
export function grainstoreModel(): BuildingModel {
  const b = new GeoBuilder(), rng = new RNG(233);
  const yellow = c(0xe2b23a);
  // Paved base with a stone kerb.
  b.add(qbox(1.9, 0.06, 1.9, 0.02, 1), { color: CUT.stoneDark }, M.t(0, 0.03, 0));
  flagstones(b, -0.9, -0.9, 6, 6, 0.3, 0.06, (i, j) => ((i * 3 + j * 5) % 4 === 0 ? c(0xc9b494) : (i + j) % 2 ? c(0xdcc8a4) : c(0xd0bb95)));
  for (const [x, z, w, d] of [[0, 0.92, 1.9, 0.06], [-0.92, 0, 0.06, 1.9]] as const) b.add(P.box(w, 0.1, d), { color: CUT.stone }, M.t(x, 0.05, z));
  // The granary: two tiers of cut stone, each banded in yellow with round pegs.
  const gx = 0.02, gz = -0.12, w = 0.98, d = 0.86, h = 0.78;
  stoneBlock(b, w, h, d, gx, 0.06, gz, false);
  b.add(P.box(w + 0.012, 0.08, d + 0.012), { color: yellow }, M.t(gx, 0.06 + h * 0.8, gz));
  for (let k = 0; k < 5; k++) {
    const x = gx - w / 2 + 0.12 + k * ((w - 0.24) / 4);
    b.add(P.cyl(0.028, 0.028, 0.05, 7), { color: yellow }, M.t(x, 0.06 + h * 0.8 - 0.08, gz + d / 2 + 0.02, Math.PI / 2, 0, 0));
  }
  for (let k = 0; k < 4; k++) b.add(P.cyl(0.028, 0.028, 0.05, 7), { color: yellow }, M.t(gx + w / 2 + 0.02, 0.06 + h * 0.8 - 0.08, gz - d / 2 + 0.14 + k * ((d - 0.28) / 3), 0, 0, Math.PI / 2));
  const y2 = 0.06 + h, w2 = 0.62, d2 = 0.54, h2 = 0.32;
  b.add(P.box(w + 0.03, 0.04, d + 0.03), { color: CUT.stoneLight }, M.t(gx, y2, gz));
  stoneBlock(b, w2, h2, d2, gx, y2, gz, false);
  b.add(P.box(w2 + 0.012, 0.06, d2 + 0.012), { color: yellow }, M.t(gx, y2 + h2 * 0.62, gz));
  b.add(P.box(0.1, 0.13, 0.02), { color: c(0x4a3020) }, M.t(gx - 0.12, y2 + h2 * 0.35, gz + d2 / 2 + 0.006));
  b.add(P.box(0.1, 0.13, 0.02), { color: c(0x4a3020) }, M.t(gx + w2 / 2 + 0.006, y2 + h2 * 0.35, gz + 0.05, 0, Math.PI / 2, 0));
  // Timber hatch on the roof.
  const ry = y2 + h2 + 0.02;
  b.add(P.box(0.36, 0.03, 0.3), { color: K.timber }, M.t(gx, ry, gz));
  for (const s of [-1, 1]) b.add(P.box(0.4, 0.04, 0.05), { color: K.timberDark }, M.t(gx, ry + 0.03, gz + s * 0.1));
  for (const s of [-1, 1]) b.add(P.box(0.05, 0.04, 0.34), { color: K.timberDark }, M.t(gx + s * 0.14, ry + 0.05, gz));
  // Doorway with a yellow curtain, a stepped fret across its foot.
  const dz = gz + d / 2;
  b.add(P.box(0.36, 0.5, 0.03), { color: c(0x3b2a20) }, M.t(gx, 0.06 + 0.25, dz + 0.004));
  for (const s of [-1, 1]) b.add(P.box(0.06, 0.54, 0.06), { color: CUT.stoneLight }, M.t(gx + s * 0.2, 0.06 + 0.27, dz + 0.02));
  b.add(P.box(0.48, 0.06, 0.07), { color: CUT.stoneLight }, M.t(gx, 0.06 + 0.55, dz + 0.02));
  b.add(P.box(0.3, 0.36, 0.014), { color: yellow, sway: 0.15 }, M.t(gx, 0.06 + 0.33, dz + 0.03));
  fretBand(b, M.t(gx, 0.06 + 0.2, dz + 0.034), 0.28, 0.08, yellow, c(0x8a5a20));
  b.add(P.box(0.44, 0.05, 0.12), { color: CUT.stone }, M.t(gx, 0.085, dz + 0.08));
  // Slatted lean-to on the left over baskets of maize and grain.
  for (const [x, z, h] of [[-0.9, -0.42, 0.58], [-0.9, 0.42, 0.58], [-0.5, -0.42, 0.7], [-0.5, 0.42, 0.7]] as const) b.add(P.cyl(0.025, 0.03, h, 5), { color: K.timberDark }, M.t(x, h / 2, z));
  slatRoof(b, -0.68, 0.66, 0, 0.5, 0.96, 0, rng);
  heapBasket(b, -0.72, 0.06, 0.05, 0.12, 0.13, [0xf2c53a], rng, true);
  heapBasket(b, -0.7, 0.06, 0.32, 0.11, 0.12, [0xe8d6a8], rng);
  // Pergola on the right over crates of tomatoes and squash.
  for (const [x, z] of [[0.6, 0.12], [0.92, 0.12], [0.6, 0.55], [0.92, 0.55]] as const) b.add(P.cyl(0.022, 0.026, 0.58, 5), { color: K.timberDark }, M.t(x, 0.29, z));
  slatRoof(b, 0.76, 0.6, 0.34, 0.42, 0.56, 0, rng);
  crate(b, 0.76, 0.06, 0.24, 0.24, 0.13, 0.17, [0xd8352a, 0xc0392b], 0, rng);
  crate(b, 0.76, 0.06, 0.46, 0.22, 0.12, 0.17, [0x6aa83a, 0x8fb24a], 0.15, rng);
  heapBasket(b, 0.62, 0.19, 0.26, 0.07, 0.07, [0xf2a93a, 0xd8572a], rng);
  // Painted pots and a grain sack by the door.
  frettedPot(b, -0.35, 0.06, 0.48, 0.75);
  frettedPot(b, -0.18, 0.06, 0.6, 0.65, 0xb0763a);
  b.add(P.uvSphere(0.11, 8, 6), { color: c(0xe6dcc0) }, M.t(0.36, 0.17, 0.42, 0, 0, 0, 1, 1.15, 1));
  b.add(P.box(0.2, 0.03, 0.2), { color: K.red }, M.t(0.36, 0.17, 0.42, 0, 0.3, 0, 1.08, 1, 1.08));
  b.add(P.cyl(0.05, 0.08, 0.05, 7), { color: c(0xd7c8a6) }, M.t(0.36, 0.3, 0.42));
  for (const [x, z] of [[-0.9, 0.85], [0.9, 0.85]] as const) blooms(b, x, 0.06, z, 3, 0.05, 0.04, Math.round(x * 90));
  return { finished: b.build(), torches: [new THREE.Vector3(-0.38, 0.62, dz + 0.04)], height: 1.35 };
}

export function basketGeometry(seed: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new RNG(seed);
  const kind = seed % 3;
  if (kind === 0) {
    b.add(P.cyl(0.13, 0.1, 0.16, 9), { color: K.rope }, M.t(0, 0.08, 0));
    for (let k = 0; k < 5; k++) b.add(P.sphere(0.05, 0), { color: [0xd8352a, 0xf2d33a, 0xe8a23a][k % 3] }, M.t(rng.range(-0.06, 0.06), 0.17, rng.range(-0.06, 0.06)));
  } else if (kind === 1) {
    b.add(P.uvSphere(0.14, 8, 6), { color: 0xd8c08a }, M.t(0, 0.12, 0, 0, 0, 0, 1, 1.1, 1));
    b.add(P.cyl(0.05, 0.08, 0.06, 6), { color: 0xc4a870 }, M.t(0, 0.27, 0));
  } else {
    b.add(P.cyl(0.12, 0.09, 0.2, 9), { color: K.terracotta }, M.t(0, 0.1, 0));
    b.add(P.cyl(0.09, 0.12, 0.04, 9), { color: K.terracotta }, M.t(0, 0.22, 0));
  }
  return b.build();
}

/** A round warrior's shield: red with a cream ring and a red boss (face toward +z of `m`). */
function shield(b: GeoBuilder, m: THREE.Matrix4, r: number): void {
  const at = (z: number) => m.clone().multiply(M.t(0, 0, z, Math.PI / 2, 0, 0));
  b.add(P.cyl(r, r, 0.02, 12), { color: K.red }, at(0));
  b.add(P.cyl(r * 0.72, r * 0.72, 0.022, 12), { color: AD.cream }, at(0.002));
  b.add(P.cyl(r * 0.5, r * 0.5, 0.024, 12), { color: K.red }, at(0.004));
  b.add(P.cyl(r * 0.16, r * 0.16, 0.03, 8), { color: K.gold }, at(0.008));
  for (let k = 0; k < 4; k++) b.add(P.box(r * 1.0, r * 0.08, 0.026), { color: K.red }, m.clone().multiply(M.t(0, 0, 0.006, 0, 0, (k * Math.PI) / 4)));
}

/** A spear rack (along x) with spears standing in it and a shield propped against it. */
function spearRack(b: GeoBuilder, x: number, z: number, w: number, ry: number): void {
  const m = M.t(x, 0, z, 0, ry, 0);
  for (const s of [-1, 1]) b.add(P.box(0.04, 0.42, 0.04), { color: K.timberDark }, m.clone().multiply(M.t(s * w / 2, 0.21, 0)));
  for (const y of [0.12, 0.36]) b.add(P.box(w + 0.06, 0.035, 0.05), { color: K.timber }, m.clone().multiply(M.t(0, y, 0)));
  const n = Math.round(w / 0.07);
  for (let k = 0; k < n; k++) {
    const sx = -w / 2 + 0.05 + k * ((w - 0.1) / (n - 1));
    b.add(P.cyl(0.008, 0.01, 0.62, 4), { color: K.timber }, m.clone().multiply(M.t(sx, 0.33, -0.02, -0.12, 0, 0)));
    b.add(P.cone(0.018, 0.07, 4), { color: c(0x2b2b30) }, m.clone().multiply(M.t(sx, 0.67, -0.06, -0.12, 0, 0)));
  }
  shield(b, m.clone().multiply(M.t(w / 2 - 0.05, 0.16, 0.06, -0.25, 0, 0)), 0.12);
}

/** A practice dummy: a post, a cross-arm and a padded body with a head. */
function trainingDummy(b: GeoBuilder, x: number, z: number, ry: number): void {
  const m = M.t(x, 0, z, 0, ry, 0);
  b.add(P.cyl(0.03, 0.035, 0.5, 5), { color: K.timberDark }, m.clone().multiply(M.t(0, 0.25, 0)));
  b.add(qbox(0.13, 0.2, 0.09, 0.03, 1), { color: c(0xc9a86a) }, m.clone().multiply(M.t(0, 0.36, 0)));
  b.add(P.box(0.3, 0.035, 0.035), { color: K.timber }, m.clone().multiply(M.t(0, 0.42, 0)));
  b.add(P.sphere(0.055, 1), { color: c(0xc9a86a) }, m.clone().multiply(M.t(0, 0.53, 0)));
  b.add(P.box(0.14, 0.03, 0.095), { color: K.red }, m.clone().multiply(M.t(0, 0.3, 0)));
  b.add(P.box(0.2, 0.025, 0.2), { color: K.timberDark }, m.clone().multiply(M.t(0, 0.0125, 0)));
}

/**
 * Warrior Lodge: a walled training compound. Sandstone walls with a red band and a turquoise
 * stepped fret, corner towers, and a gateway flanked by red sun banners and fire bowls. Inside, a
 * beaten-earth yard of practice dummies, spear racks and round red shields; thatch-shaded armoury
 * sheds along the side walls; and at the back a raised two-stepped hall with a carved panel, a stair
 * up from the yard and a red awning on its roof terrace. Door faces +z.
 */
export function warroomModel(): BuildingModel {
  const b = new GeoBuilder(), rng = new RNG(911);
  const E = 1.3, WH = 0.5, WT = 0.15, teal = c(0x2c8a83);
  b.add(qbox(2.92, 0.06, 2.92, 0.02, 1), { color: PEN.dust }, M.t(0, 0.03, 0));
  // The beaten-earth yard, darker where feet have worn it.
  b.add(P.cyl(0.7, 0.75, 0.01, 14), { color: PEN.earth }, M.t(0, 0.065, 0.25, 0, 0, 0, 1.2, 1, 0.9));
  // Walls, with the red band and a turquoise fret on the outer faces.
  const wallRun = (x: number, z: number, len: number, ry: number) => {
    b.add(qbox(len, WH, WT, 0.02, 1), { color: CUT.stone }, M.t(x, 0.06 + WH / 2, z, 0, ry, 0));
    b.add(P.box(len + 0.01, 0.04, WT + 0.03), { color: CUT.stoneLight }, M.t(x, 0.06 + WH, z, 0, ry, 0));
    const out = M.t(x, 0, z, 0, ry, 0);
    b.add(P.box(len + 0.004, 0.07, WT + 0.006), { color: K.red }, out.clone().multiply(M.t(0, 0.06 + WH * 0.62, 0)));
    fretBand(b, out.clone().multiply(M.t(0, 0.06 + WH * 0.36, WT / 2 + 0.002)), len - 0.04, 0.09, teal, AD.cream);
    // Merlons along the top.
    const n = Math.floor(len / 0.22);
    for (let k = 0; k < n; k++) b.add(P.box(0.11, 0.08, WT), { color: CUT.stoneLight }, out.clone().multiply(M.t(-len / 2 + 0.11 + k * (len - 0.22) / Math.max(1, n - 1), 0.06 + WH + 0.06, 0)));
  };
  wallRun(0, -E, 2 * E, 0);
  wallRun(-E, 0, 2 * E, -Math.PI / 2);
  wallRun(E, 0, 2 * E, Math.PI / 2);
  wallRun(-0.85, E, 1.0, Math.PI);
  wallRun(0.85, E, 1.0, Math.PI);
  // Corner towers.
  for (const [x, z, h] of [[-E + 0.08, -E + 0.08, 0.78], [E - 0.08, -E + 0.08, 0.78], [-E + 0.08, E - 0.08, 0.66], [E - 0.08, E - 0.08, 0.66]] as const) {
    stoneBlock(b, 0.38, h, 0.38, x, 0.06, z);
    b.add(P.box(0.394, 0.07, 0.394), { color: K.red }, M.t(x, 0.06 + h * 0.62, z));
  }
  for (const x of [-E + 0.08, E - 0.08]) for (const dx of [-0.07, 0.07]) frettedPot(b, x + dx, 0.06 + 0.78 + 0.02, -E + 0.08, 0.4);
  // The gateway: taller jambs, a lintel with a carved panel, a dark door.
  for (const s of [-1, 1]) b.add(qbox(0.16, 0.74, 0.24, 0.02, 1), { color: CUT.stone }, M.t(s * 0.3, 0.06 + 0.37, E));
  b.add(qbox(0.78, 0.16, 0.26, 0.02, 1), { color: CUT.stoneLight }, M.t(0, 0.06 + 0.8, E));
  fretBand(b, M.t(0, 0.06 + 0.8, E + 0.132), 0.6, 0.1, K.red, AD.cream);
  b.add(P.box(0.42, 0.62, 0.04), { color: c(0x4a3020) }, M.t(0, 0.06 + 0.31, E - 0.04));
  for (const s of [-1, 1]) sunBanner(b, M.t(s * 0.62, 0.06 + 0.3, E + WT / 2 + 0.012), 0.2, 0.36);
  const torches = [fireBowl(b, -0.42, 0.06 + 0.22, E + 0.07, 0.8), fireBowl(b, 0.42, 0.06 + 0.22, E + 0.07, 0.8)];
  for (const s of [-1, 1]) {
    b.add(P.cyl(0.02, 0.025, 0.22, 5), { color: K.timberDark }, M.t(s * 0.42, 0.06 + 0.11, E + 0.07));
    frettedPot(b, s * 0.62, 0.06, E + 0.1, 0.42);
  }
  // The raised hall at the back: a stepped platform, a room with a carved panel, a red awning.
  stoneBlock(b, 1.2, 0.34, 0.72, 0, 0.06, -E + 0.42, false);
  b.add(P.box(1.21, 0.06, 0.73), { color: K.red }, M.t(0, 0.06 + 0.24, -E + 0.42));
  stoneBlock(b, 0.72, 0.42, 0.46, -0.12, 0.4, -E + 0.32);
  b.add(P.box(0.73, 0.07, 0.47), { color: K.red }, M.t(-0.12, 0.4 + 0.3, -E + 0.32));
  b.add(P.box(0.34, 0.24, 0.02), { color: CUT.stoneDark }, M.t(-0.12, 0.4 + 0.15, -E + 0.32 + 0.24));
  fretBand(b, M.t(-0.12, 0.4 + 0.15, -E + 0.32 + 0.252), 0.28, 0.16, CUT.stoneDark, CUT.stoneLight);
  awning(b, 0.42, 0.66, -E + 0.2, 0.36, 0.3, false);
  for (let k = 0; k < 4; k++) {
    const h = 0.34 * (4 - k) / 4;
    b.add(P.box(0.4, h, 0.1), { color: k % 2 ? CUT.stone : CUT.stoneLight }, M.t(-0.12, 0.06 + h / 2, -E + 0.83 + k * 0.1));
  }
  // Armoury sheds along both side walls: posts and a sloping thatch over crates and shields.
  for (const s of [-1, 1]) {
    const x = s * (E - 0.32);
    for (const z of [-0.45, 0.65]) b.add(P.cyl(0.03, 0.035, 0.62, 5), { color: K.timberDark }, M.t(x - s * 0.18, 0.37, z));
    for (let k = 0; k < 8; k++) b.add(P.box(0.55, 0.035, 1.3 / 8 + 0.01), { color: k % 2 ? K.thatch : K.thatchDark, leaf: 0.2 }, M.t(x + s * 0.02, 0.7, -0.45 + 0.55 + (k - 3.5) * (1.3 / 8), 0, 0, s * 0.28));
    crate(b, x + s * 0.06, 0.06, 0.35, 0.22, 0.16, 0.2);
    crate(b, x + s * 0.06, 0.22, 0.35, 0.18, 0.12, 0.16);
    shield(b, M.t(x + s * 0.1, 0.25, -0.15, 0, -s * Math.PI / 2, 0).multiply(M.t(0, 0, 0, -0.2, 0, 0)), 0.12);
  }
  // The yard: dummies and spear racks.
  for (const [x, z, ry] of [[-0.35, 0.1, 0.4], [0.05, -0.05, -0.2], [0.42, 0.25, -0.6], [-0.15, 0.6, 0.2]] as const) trainingDummy(b, x, z, ry);
  spearRack(b, -0.75, -E + 0.3, 0.42, 0);
  spearRack(b, 0.82, -E + 0.82, 0.38, 0);
  // Planting round the outside.
  for (const [x, z] of [[-1.0, 1.42], [1.0, 1.42]] as const) blooms(b, x, 0.02, z, 4, 0.15, 0.02, Math.round(x * 50));
  return { finished: b.build(), torches, height: 1.35 };
}

/**
 * Jetty: small boat shed on land, deck on posts reaching into the shallows along +z.
 * @param landY height of the land the building sits on (deck is kept just above the sea).
 * @param length deck length in cells beyond the footprint.
 */
export function jettyModel(landY: number, length: number): BuildingModel {
  const b = new GeoBuilder();
  const deckY = 0.32 - landY;
  // Shed on land.
  for (const [x, z] of [[-0.7, -0.7], [0.1, -0.7], [-0.7, 0.1], [0.1, 0.1]]) b.add(P.cyl(0.04, 0.05, 0.9, 6), { color: K.timber }, M.t(x, 0.45, z));
  b.add(P.box(1.1, 0.07, 1.1), { color: thatchColor, leaf: 0.2 }, M.t(-0.3, 0.92, -0.3, 0.12, 0, 0));
  for (let k = 0; k < 3; k++) b.add(P.rbox(0.28, 0.24, 0.28, 0.03), { color: k % 2 ? K.timber : c(0xa87a4a) }, M.t(-0.55 + k * 0.3, 0.12, -0.55));
  // Ramp from land level down to the deck.
  const rampLen = 1.0;
  const rampDrop = Math.min(0, deckY);
  b.add(P.box(0.9, 0.06, rampLen), { color: c(0xa8784a) }, M.t(0.5, rampDrop / 2 + 0.03, 0.75, Math.atan2(-rampDrop, rampLen), 0, 0));
  // Deck.
  const z0 = 1.2, z1 = 1.2 + length;
  for (let z = z0; z < z1; z += 0.26) {
    b.add(P.box(0.95, 0.05, 0.22), { color: (Math.round(z * 4) % 2 ? c(0xa8784a) : c(0x94663c)) }, M.t(0.5, deckY, z + 0.11));
  }
  for (let z = z0; z <= z1; z += 1.2) {
    for (const x of [0.05, 0.95]) b.add(P.cyl(0.05, 0.05, 2.6, 6), { color: K.timberDark }, M.t(x, deckY - 1.2, z));
  }
  // T-end platform.
  b.add(P.box(2.2, 0.05, 0.9), { color: c(0xa8784a) }, M.t(0.5, deckY, z1 + 0.3));
  for (const x of [-0.5, 1.5]) b.add(P.cyl(0.05, 0.05, 2.6, 6), { color: K.timberDark }, M.t(x, deckY - 1.2, z1 + 0.3));
  // Crates and barrels.
  b.add(P.rbox(0.3, 0.28, 0.3, 0.03), { color: 0xa87a4a }, M.t(0.2, deckY + 0.16, z0 + 1.0));
  b.add(P.rbox(0.24, 0.22, 0.24, 0.03), { color: 0x94663c }, M.t(0.25, deckY + 0.41, z0 + 1.02, 0, 0.4, 0));
  b.add(P.cyl(0.13, 0.13, 0.32, 10), { color: (p) => (Math.abs(p.y - (deckY + 0.18)) > 0.1 ? K.timberDark : K.timber) }, M.t(0.8, deckY + 0.18, z0 + 2.2));
  b.add(P.cyl(0.13, 0.13, 0.32, 10), { color: K.timber }, M.t(-0.2, deckY + 0.18, z1 + 0.35));
  // Rope coil.
  b.add(P.torus(0.12, 0.035, 5, 12), { color: K.rope }, M.t(1.2, deckY + 0.04, z1 + 0.3, Math.PI / 2, 0, 0));
  const torches = [new THREE.Vector3(-0.5, deckY + 0.8, z1 + 0.6), new THREE.Vector3(1.5, deckY + 0.8, z1 + 0.6)];
  for (const t of torches) {
    b.add(P.cyl(0.025, 0.035, 0.75, 5), { color: K.timberDark }, M.t(t.x, t.y - 0.45, t.z));
    b.add(P.cyl(0.07, 0.04, 0.08, 7), { color: K.stoneDark }, M.t(t.x, t.y - 0.08, t.z));
  }
  return { finished: b.build(), torches, height: 1.2 };
}

/**
 * Trade Dock: an adobe trading house with a striped awning over crates of goods, and a wide pier
 * on posts with a big T-end where the trade boats moor. Deck along +z like the jetty.
 */
export function tradeDockModel(landY: number, length: number): BuildingModel {
  const b = new GeoBuilder();
  const deckY = 0.32 - landY;
  // Trading house on land (flat roof, parapet, teal door, awning over the goods).
  baseBand(b, 1.2, 1.0, -0.35, -0.4, 0.12);
  adobeBlock(b, 1.2, 0.8, 1.0, -0.35, 0, -0.4);
  adobeBlock(b, 0.55, 0.3, 0.5, -0.55, 0.8, -0.55);
  tealDoor(b, -0.2, 0.02, 0.11, 0.26, 0.46);
  adobeWindow(b, -0.7, 0.55, 0.11);
  awning(b, 0.35, 0.62, 0.05, 0.7, 0.34, true);
  for (let k = 0; k < 3; k++) b.add(P.rbox(0.22, 0.2, 0.22, 0.03), { color: k % 2 ? K.timber : c(0xa87a4a) }, M.t(0.15 + k * 0.24, 0.1, 0.25, 0, k * 0.3, 0));
  b.add(P.uvSphere(0.1, 7, 5), { color: c(0xd8c08a) }, M.t(0.55, 0.3, 0.2, 0, 0, 0, 1.1, 0.8, 1));
  b.add(P.cyl(0.09, 0.08, 0.2, 8), { color: K.terracotta }, M.t(0.72, 0.1, 0.42));
  // Ramp from land level down to the deck.
  const rampLen = 1.0;
  const rampDrop = Math.min(0, deckY);
  b.add(P.box(1.1, 0.06, rampLen), { color: c(0xa8784a) }, M.t(0.5, rampDrop / 2 + 0.03, 0.75, Math.atan2(-rampDrop, rampLen), 0, 0));
  // Wide pier.
  const z0 = 1.2, z1 = 1.2 + length;
  for (let z = z0; z < z1; z += 0.26) b.add(P.box(1.15, 0.05, 0.22), { color: Math.round(z * 4) % 2 ? c(0xa8784a) : c(0x94663c) }, M.t(0.5, deckY, z + 0.11));
  for (let z = z0; z <= z1; z += 1.2) for (const x of [-0.05, 1.05]) b.add(P.cyl(0.055, 0.055, 2.6, 6), { color: K.timberDark }, M.t(x, deckY - 1.2, z));
  // Big T-end with mooring posts, bales and a flag.
  b.add(P.box(3.4, 0.05, 1.1), { color: c(0xa8784a) }, M.t(0.5, deckY, z1 + 0.4));
  for (const x of [-1.1, 0.5, 2.1]) b.add(P.cyl(0.055, 0.055, 2.6, 6), { color: K.timberDark }, M.t(x, deckY - 1.2, z1 + 0.4));
  for (const x of [-1.05, 2.05]) {
    b.add(P.cyl(0.05, 0.06, 0.35, 6), { color: K.timberDark }, M.t(x, deckY + 0.17, z1 + 0.85));
    b.add(P.torus(0.07, 0.02, 4, 10), { color: K.rope }, M.t(x, deckY + 0.3, z1 + 0.85, Math.PI / 2, 0, 0));
  }
  b.add(P.rbox(0.32, 0.28, 0.32, 0.03), { color: 0xa87a4a }, M.t(0.0, deckY + 0.16, z1 + 0.25));
  b.add(P.rbox(0.26, 0.22, 0.26, 0.03), { color: 0x94663c }, M.t(0.05, deckY + 0.41, z1 + 0.27, 0, 0.4, 0));
  b.add(P.uvSphere(0.14, 7, 5), { color: c(0xd8c08a) }, M.t(1.1, deckY + 0.12, z1 + 0.3, 0, 0, 0, 1.2, 0.8, 1));
  b.add(P.cyl(0.03, 0.035, 1.9, 5), { color: K.timberDark }, M.t(1.7, deckY + 0.95, z1 + 0.2));
  b.add(P.box(0.02, 0.36, 0.55), { color: (p) => ((p.y * 10) % 1 < 0.33 ? AD.red : (p.y * 10) % 1 < 0.66 ? K.gold : K.jade).clone(), sway: 0.5 }, M.t(1.7, deckY + 1.66, z1 - 0.08));
  const torches = [new THREE.Vector3(-1.1, deckY + 0.8, z1 + 0.85), new THREE.Vector3(2.1, deckY + 0.8, z1 + 0.85)];
  for (const t of torches) {
    b.add(P.cyl(0.025, 0.035, 0.75, 5), { color: K.timberDark }, M.t(t.x, t.y - 0.45, t.z));
    b.add(P.cyl(0.07, 0.04, 0.08, 7), { color: K.stoneDark }, M.t(t.x, t.y - 0.08, t.z));
  }
  return { finished: b.build(), torches, height: 1.3 };
}

/** Generic construction scaffolding sized to a footprint. */
export function scaffoldGeometry(w: number, d: number, h: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const hw = w / 2 - 0.1, hd = d / 2 - 0.1;
  const corners: [number, number][] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  for (const [x, z] of corners) b.add(P.cyl(0.03, 0.035, h, 5), { color: 0xa87a4a }, M.t(x, h / 2, z));
  for (let lvl = 1; lvl <= Math.max(1, Math.floor(h / 0.6)); lvl++) {
    const y = lvl * 0.6;
    for (let k = 0; k < 4; k++) {
      const [x0, z0] = corners[k], [x1, z1] = corners[(k + 1) % 4];
      const len = Math.hypot(x1 - x0, z1 - z0);
      b.add(P.box(0.03, 0.03, len), { color: 0x8b5a34 }, M.t((x0 + x1) / 2, y, (z0 + z1) / 2, 0, Math.atan2(x1 - x0, z1 - z0), 0));
    }
  }
  // Diagonal braces and rope lashings.
  b.add(P.box(0.025, 0.025, Math.hypot(w, h) * 0.9), { color: 0x8b5a34 }, M.t(0, h / 2, hd, Math.atan2(w, h) - Math.PI / 2, Math.PI / 2, 0));
  return b.build();
}

/** Foundation: levelled stone slab with timber outline and stakes. */
export function foundationGeometry(w: number, d: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.rbox(w - 0.25, 0.1, d - 0.25, 0.03), { color: K.stoneDark }, M.t(0, 0.05, 0));
  const hw = w / 2 - 0.1, hd = d / 2 - 0.1;
  for (const [x, z] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) b.add(P.cyl(0.025, 0.03, 0.35, 5), { color: K.timber }, M.t(x, 0.17, z));
  b.add(P.box(w - 0.1, 0.04, 0.04), { color: K.rope }, M.t(0, 0.28, hd));
  b.add(P.box(w - 0.1, 0.04, 0.04), { color: K.rope }, M.t(0, 0.28, -hd));
  // A pile of materials waiting.
  for (let k = 0; k < 3; k++) b.add(P.cyl(0.05, 0.05, 0.6, 6), { color: K.timber }, M.t(hw - 0.3, 0.16 + k * 0.08, hd + 0.25, 0, 0, Math.PI / 2));
  return b.build();
}

/**
 * Torch flame: a rounded teardrop (a full bulb low down tapering to a soft tip), with each
 * vertex's height up the flame (aH, 0 at the base to 1 at the tip) for the fire shader.
 */
export function flameGeometry(radius = 0.06, height = 0.18): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const h = i / n;
    pts.push(new THREE.Vector2(radius * 1.05 * Math.pow(Math.sin(Math.PI * Math.pow(h, 0.55)), 0.9), h * height));
  }
  const g = new THREE.LatheGeometry(pts, 10);
  const pos = g.getAttribute('position');
  const aH = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) aH[i] = pos.getY(i) / height;
  g.setAttribute('aH', new THREE.BufferAttribute(aH, 1));
  return g;
}

// ---------------- Great Hall ----------------

/**
 * Layout of the Great Hall (model-local, door faces +z): a raised stone platform reached by a
 * wide front stair, benches in rows under a striped canopy facing a sun-disc dais at the back,
 * and standing room round the edges. Shared by the model and the villagers who use it.
 */
export const HALL = {
  /** Platform height and half-extent; the front stair's half-width and the foot of the stair. */
  h: 0.5,
  edge: 2.75,
  stairHalf: 0.7,
  stairFoot: 3.5,
  /** Seats (hip position; seated villagers face -z, toward the dais). */
  seats: Array.from({length:10},(_,row)=>-1.65+row*0.39).flatMap(z=>[-2.05,-1.65,-1.25,-0.85,-0.45,0.45,0.85,1.25,1.65,2.05].map(x=>({x,z}))),
  /** Standing room along the front terrace and the sides (facing the middle). */
  stands: [
    ...[-1.6, -0.95, 0.95, 1.6].map((x) => ({ x, z: 2.2 })),
    ...[-1.6, -0.55, 0.55, 1.6].flatMap((z) => [{ x: -2.25, z }, { x: 2.25, z }]),
  ],
  /** Where the bell hangs from the front canopy beam (its pivot). */
  bell: new THREE.Vector3(0, 2.55, 2.48),
  /** Floor height at a local point: the platform top, the stair, else the ground. */
  floorY(lx: number, lz: number): number {
    const H = HALL.h, E = HALL.edge;
    if (Math.abs(lx) <= E && Math.abs(lz) <= E) return H;
    if (Math.abs(lx) <= HALL.stairHalf && lz > E && lz < HALL.stairFoot) return (H * (HALL.stairFoot - lz)) / (HALL.stairFoot - E);
    return 0;
  },
};

/** A fern: a fan of long drooping fronds. */
function fern(b: GeoBuilder, x: number, y: number, z: number, s: number, seed: number): void {
  const r = new RNG(seed);
  const n = 9;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r.range(-0.3, 0.3);
    const col = c(0x3f8a34).lerp(c(0x7cbc4c), r.next());
    // Each frond: two segments, rising from the crown then arching over and down.
    const lift = r.range(0.5, 0.9);
    const L = 0.26 * s * r.range(0.85, 1.15);
    const base = M.t(x, y, z).multiply(M.t(0, 0, 0, 0, a, 0));
    b.add(P.box(0.09 * s, 0.014, L), { color: col, leaf: 1, sway: 0.4 }, base.clone().multiply(M.t(0, 0, 0, -lift, 0, 0)).multiply(M.t(0, 0, L / 2)));
    const tip = base.clone().multiply(M.t(0, 0, 0, -lift, 0, 0)).multiply(M.t(0, 0, L)).multiply(M.t(0, 0, 0, lift + 0.45, 0, 0));
    b.add(P.box(0.075 * s, 0.012, L * 0.9), { color: col.clone().multiplyScalar(1.08), leaf: 1, sway: 0.7 }, tip.multiply(M.t(0, 0, L * 0.45)));
  }
}

/** A broad-leaved tropical plant (like a young banana or elephant ear). */
function broadLeaf(b: GeoBuilder, x: number, y: number, z: number, s: number, seed: number): void {
  const r = new RNG(seed);
  const n = 5;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r.range(-0.4, 0.4);
    const col = c(0x2f7a2e).lerp(c(0x5ea43c), r.next());
    const lift = r.range(0.35, 0.7);
    const m = M.t(x, y, z).multiply(M.t(0, 0, 0, 0, a, 0)).multiply(M.t(0, 0, 0, -lift - 0.4, 0, 0));
    b.add(P.cyl(0.01, 0.014, 0.22 * s, 3), { color: c(0x4c8a34) }, m.clone().multiply(M.t(0, 0.11 * s, 0)));
    const leaf = m.clone().multiply(M.t(0, 0.22 * s, 0)).multiply(M.t(0, 0, 0, 0.9, 0, 0));
    b.add(new THREE.OctahedronGeometry(0.1 * s, 0), { color: col, leaf: 1, sway: 0.6 }, leaf.multiply(M.t(0, 0, 0.1 * s, 0, 0, 0, 0.75, 0.12, 1.4)));
  }
}

/** A grid of slabs (w × d cells of size `cell`), each coloured on its own. */
function slabs(b: GeoBuilder, x0: number, z0: number, w: number, d: number, cell: number, y: number, h: number, color: (i: number, j: number) => THREE.Color, skip?: (x: number, z: number) => boolean): void {
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < d; j++) {
      const x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell;
      if (skip?.(x, z)) continue;
      b.add(P.box(cell - 0.012, h, cell - 0.012), { color: color(i, j) }, M.t(x, y + h / 2, z));
    }
  }
}

/** A cheap flower head (8 faces). */
const FLOWER = new THREE.OctahedronGeometry(0.045, 0);

/** A clump of red (and a few orange) tropical flowers on short stems. */
function blooms(b: GeoBuilder, x: number, y: number, z: number, n: number, sx: number, sz: number, seed: number, redShare = 0.75): void {
  const r = new RNG(seed);
  for (let k = 0; k < n; k++) {
    const px = x + r.range(-sx, sx), pz = z + r.range(-sz, sz);
    const h = r.range(0.1, 0.2);
    b.add(P.cyl(0.008, 0.01, h, 3), { color: c(0x3c7a2e) }, M.t(px, y + h / 2, pz));
    const petal = r.next() < redShare ? c(0xd8322a) : c(0xef7a22);
    b.add(FLOWER, { color: (q) => (q.y > y + h + 0.035 ? c(0xf2d04a) : petal.clone()), leaf: 1 }, M.t(px, y + h + 0.02, pz, 0, r.next() * 3, 0, 1, 0.6, 1));
  }
}

/**
 * Leaf flag for cloth: keeps the plaster and stone skin off it (see patchBuilding) and lets the sun
 * glow through it from behind.
 */
const CLOTH = 0.95;
/** Banner cloth colours: Aztec red with cream motifs, a turquoise variant, and tassel accents. */
export const BANNER = { red: c(0xb23a2c), redDeep: c(0x7e2219), cream: c(0xefdfb8), teal: c(0x2f8f86), gold: c(0xd2a646), timber: c(0x5a3d26) };

/**
 * A two-faced cloth panel, `w` wide and `h` tall, hanging from its top edge (local y = 0 at the
 * top, down to -h). Its side edges curl back a little like cloth hung from a rod; `z(x)` gives that
 * curl so details can sit on the surface.
 */
export function clothPanel(w: number, h: number, curl: number, cols = 3, rows = 1): { geo: THREE.BufferGeometry; z: (x: number) => number } {
  const z = (x: number) => -curl * ((2 * x) / w) ** 2;
  const front = new THREE.PlaneGeometry(w, h, cols, rows).translate(0, -h / 2, 0);
  const P = front.getAttribute('position');
  for (let i = 0; i < P.count; i++) P.setZ(i, z(P.getX(i)));
  front.computeVertexNormals();
  const back = front.clone();
  // The back face: same surface, the other winding.
  const I = back.index!;
  for (let i = 0; i < I.count; i += 3) { const t = I.getX(i + 1); I.setX(i + 1, I.getX(i + 2)); I.setX(i + 2, t); }
  back.computeVertexNormals();
  const geo = mergeGeometries([front, back])!;
  front.dispose(); back.dispose();
  return { geo, z };
}

/**
 * A hanging cloth banner with Aztec motifs on both faces (facing +z before `m`, which places the
 * banner's middle). Red with a cream sun and a stepped cream border; the hem is cut into three tabs of slightly
 * different lengths, each with a tassel. `free` banners (on poles) swing more in the wind than
 * those hung against a wall.
 */
function sunBanner(b: GeoBuilder, m: THREE.Matrix4, w: number, h: number, free = false, cloth = BANNER.red, ink = BANNER.cream): void {
  const top = m.clone().multiply(M.t(0, h / 2, 0));
  const inv = top.clone().invert();
  const lp = new THREE.Vector3();
  // Still at the rod, swinging more toward the hem.
  const sway = (p: THREE.Vector3) => (Math.min(1, Math.max(0, -lp.copy(p).applyMatrix4(inv).y / h)) * (free ? 0.45 : 0.1));
  const body = h * 0.82, curl = w * 0.07;
  // Big panels in few cells, so far-away detail trimming (small triangles) never eats the cloth.
  const { geo, z } = clothPanel(w, body, curl, 3, Math.max(1, Math.round(body / 0.35)));
  const deep = cloth.clone().lerp(BANNER.redDeep, 0.45);
  // Folds: the curled edges a shade darker, the hem darker than the top.
  const shade = (p: THREE.Vector3) => {
    lp.copy(p).applyMatrix4(inv);
    return cloth.clone().lerp(deep, Math.min(1, Math.abs((2 * lp.x) / w) ** 2 * 0.6 + (-lp.y / h) * 0.35));
  };
  b.add(geo, { color: shade, sway, leaf: CLOTH }, top);
  geo.dispose();
  // Three hem tabs, hand-cut to slightly different lengths, each with a tassel.
  const tw = w / 3 - 0.008;
  [0.15, 0.19, 0.14].forEach((len, k) => {
    const x = (k - 1) * (w / 3);
    const tab = clothPanel(tw, h * len, curl * 0.15, 1, 1);
    b.add(tab.geo, { color: shade, sway, leaf: CLOTH }, top.clone().multiply(M.t(x, -body + 0.002, z(x))));
    tab.geo.dispose();
    const ty = -body - h * len;
    b.add(P.cyl(0.004, 0.012, 0.05, 5), { color: k === 1 ? BANNER.teal : BANNER.gold, sway, leaf: CLOTH }, top.clone().multiply(M.t(x, ty - 0.022, z(x))));
  });
  // Motifs, on both faces: a stepped band above the hem, and a sun (ring, eye and eight rays).
  for (const face of [1, -1]) {
    const at = (x: number, y: number) => top.clone().multiply(M.t(x, y, z(x) + face * 0.007)).multiply(M.t(0, 0, 0, 0, face > 0 ? 0 : Math.PI, 0));
    const by = -body + h * 0.07;
    b.add(P.box(w * 0.86, h * 0.022, 0.004), { color: ink, sway, leaf: CLOTH }, at(0, by));
    const n = 5, step = (w * 0.86) / n;
    for (let k = 0; k < n; k++) {
      const x = -w * 0.43 + step * (k + 0.5);
      b.add(P.box(step * 0.55, h * 0.035, 0.004), { color: ink, sway, leaf: CLOTH }, at(x, by + h * 0.028));
      b.add(P.box(step * 0.25, h * 0.03, 0.004), { color: ink, sway, leaf: CLOTH }, at(x, by + h * 0.06));
    }
    const sy = -body * 0.42, r = w * 0.19;
    b.add(P.torus(r, w * 0.035, 4, 14), { color: ink, sway, leaf: CLOTH }, at(0, sy).multiply(M.t(0, 0, 0, 0, 0, 0, 1, 1, 0.3)));
    b.add(P.cyl(w * 0.07, w * 0.07, 0.004, 8), { color: ink, sway, leaf: CLOTH }, at(0, sy).multiply(M.t(0, 0, 0, Math.PI / 2, 0, 0)));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const x = Math.cos(a) * r * 1.55;
      b.add(P.box(w * 0.05, w * 0.12, 0.004), { color: ink, sway, leaf: CLOTH }, at(x, sy + Math.sin(a) * r * 1.55).multiply(M.t(0, 0, 0, 0, 0, a - Math.PI / 2)));
    }
  }
  // The rod it hangs from, with gilded ends.
  b.add(P.cyl(0.014, 0.014, w * 1.16, 6), { color: BANNER.timber }, top.clone().multiply(M.t(0, 0.008, z(w / 2) * 0.5, 0, 0, Math.PI / 2)));
  for (const s of [-1, 1]) b.add(P.sphere(0.022, 0), { color: BANNER.gold }, top.clone().multiply(M.t(s * w * 0.6, 0.008, z(w / 2) * 0.5)));
}

// ---------------- Shared details for the refitted buildings ----------------

/** Cut sandstone: lighter toward the top, flat-faceted so the blocks read in the stone skin. */
const CUT = { stone: c(0xdcb27a), stoneLight: c(0xe9c993), stoneDark: c(0xbf9864), mortar: c(0x9a7448) };

/** A plain box in place of a rounded one (at this size the rounding is invisible, and costs 9× the triangles). */
const qbox = (w: number, h: number, d: number, _r?: number, _seg?: number) => P.box(w, h, d);

/** A cut-stone block (centred on x, z; standing on y) with a flat roof, optional coping and parapet. */
function stoneBlock(b: GeoBuilder, w: number, h: number, d: number, x: number, y: number, z: number, parapet = true): void {
  b.add(qbox(w, h, d, 0.03, 1), { color: (p) => CUT.stone.clone().lerp(CUT.stoneLight, Math.min(1, Math.max(0, (p.y - y) / h)) * 0.5) }, M.t(x, y + h / 2, z));
  // A few deeper mortar courses so the walls read as laid blocks.
  for (const f of [0.3, 0.62]) b.add(P.box(w + 0.006, 0.012, d + 0.006), { color: CUT.mortar }, M.t(x, y + h * f, z));
  b.add(qbox(w + 0.04, 0.05, d + 0.04, 0.012, 1), { color: CUT.stoneLight }, M.t(x, y + h - 0.02, z));
  if (!parapet) return;
  const t = 0.08, ph = 0.09;
  b.add(P.box(w + 0.02, ph, t), { color: CUT.stoneLight }, M.t(x, y + h + ph / 2, z + d / 2 - t / 2 + 0.01));
  b.add(P.box(w + 0.02, ph, t), { color: CUT.stoneLight }, M.t(x, y + h + ph / 2, z - d / 2 + t / 2 - 0.01));
  b.add(P.box(t, ph, d), { color: CUT.stoneLight }, M.t(x + w / 2 - t / 2 + 0.01, y + h + ph / 2, z));
  b.add(P.box(t, ph, d), { color: CUT.stoneLight }, M.t(x - w / 2 + t / 2 - 0.01, y + h + ph / 2, z));
  b.add(P.box(w - t * 2, 0.02, d - t * 2), { color: CUT.stoneDark }, M.t(x, y + h + 0.01, z));
}

/**
 * A painted band with a running stepped fret (the key pattern), laid on a face. `m` places the
 * band's centre; in its frame x runs along the band, y up and +z out of the wall.
 */
function fretBand(b: GeoBuilder, m: THREE.Matrix4, len: number, h: number, base: THREE.Color, ink: THREE.Color): void {
  // Painted on: the band is a thin slab, the hooks flat quads just proud of it (two triangles each).
  const at = (x: number, y: number) => m.clone().multiply(M.t(x, y, 0.0075));
  b.add(P.box(len, h, 0.012), { color: base }, m);
  const u = h * 1.7, n = Math.max(1, Math.floor(len / u)), s = h * 0.15, x0 = -(n * u) / 2;
  for (let k = 0; k < n; k++) {
    const x = x0 + k * u;
    // Hook: up the left, along the top, down a little, and back in.
    b.add(P.plane(s, h * 0.66), { color: ink }, at(x + s / 2 + u * 0.08, 0));
    b.add(P.plane(u * 0.6, s), { color: ink }, at(x + u * 0.08 + u * 0.3, h * 0.33 - s / 2));
    b.add(P.plane(s, h * 0.36), { color: ink }, at(x + u * 0.68 - s / 2, h * 0.15));
    b.add(P.plane(u * 0.3, s), { color: ink }, at(x + u * 0.53, -0.02 * h));
    b.add(P.plane(u * 0.82, s), { color: ink }, at(x + u * 0.08 + u * 0.41, -h * 0.33 + s / 2));
  }
}

/**
 * Flagstones as flat quads on a slab (top faces only: two triangles a stone), with joints showing
 * between. The quads sit well clear of the mortar beneath (a hair's gap flickered at a distance).
 */
function flagstones(b: GeoBuilder, x0: number, z0: number, nx: number, nz: number, cell: number, y: number, color: (i: number, j: number) => THREE.Color): void {
  b.add(P.box(nx * cell, 0.012, nz * cell), { color: CUT.mortar }, M.t(x0 + (nx * cell) / 2, y + 0.006, z0 + (nz * cell) / 2));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    b.add(P.plane(cell - 0.014, cell - 0.014), { color: color(i, j) }, M.t(x0 + (i + 0.5) * cell, y + 0.018 + ((i * 7 + j * 3) % 3) * 0.002, z0 + (j + 0.5) * cell, -Math.PI / 2, 0, 0));
  }
}

/** A paw print (pad and four toes) laid on a face; frame as fretBand's. */
function pawPrint(b: GeoBuilder, m: THREE.Matrix4, s: number, col: THREE.Color): void {
  const at = (x: number, y: number) => m.clone().multiply(M.t(x * s, y * s, 0.006));
  b.add(P.cyl(0.42 * s, 0.42 * s, 0.01, 10), { color: col }, at(0, -0.25).multiply(M.t(0, 0, 0, Math.PI / 2, 0, 0, 1.15, 1, 0.9)));
  for (const [x, y] of [[-0.5, 0.28], [-0.18, 0.52], [0.18, 0.52], [0.5, 0.28]]) b.add(P.cyl(0.17 * s, 0.17 * s, 0.01, 8), { color: col }, at(x, y).multiply(M.t(0, 0, 0, Math.PI / 2, 0, 0)));
}

/** A slatted timber roof (planks across x, lashed with two ropes), centred on x, y, z and tipped by `tilt` about x. */
function slatRoof(b: GeoBuilder, x: number, y: number, z: number, w: number, d: number, tilt: number, rng: RNG): void {
  const n = Math.max(3, Math.round(d / 0.11));
  const m = M.t(x, y, z, tilt, 0, 0);
  for (let k = 0; k < n; k++) {
    const zz = -d / 2 + (k + 0.5) * (d / n);
    b.add(P.box(w + rng.range(-0.04, 0.04), 0.035, d / n - 0.012), { color: k % 3 === 0 ? c(0x8f6a45) : k % 2 ? c(0xa98259) : c(0xb89268) }, m.clone().multiply(M.t(rng.range(-0.02, 0.02), 0, zz)));
  }
  for (const f of [-0.3, 0.3]) b.add(P.box(0.022, 0.045, d + 0.03), { color: K.rope }, m.clone().multiply(M.t(f * w, 0.02, 0)));
}

/** A coopered barrel with two dark hoops. */
function barrel(b: GeoBuilder, x: number, y: number, z: number, s = 1): void {
  b.add(P.cyl(0.085 * s, 0.075 * s, 0.22 * s, 9), { color: c(0x8a5e3a) }, M.t(x, y + 0.11 * s, z));
  for (const f of [0.25, 0.75]) b.add(P.cyl(0.088 * s, 0.088 * s, 0.018 * s, 9), { color: c(0x4a3020) }, M.t(x, y + 0.22 * s * f, z));
  b.add(P.cyl(0.075 * s, 0.075 * s, 0.01, 9), { color: c(0x6b4a2c) }, M.t(x, y + 0.222 * s, z));
}

/** A slatted crate, optionally heaped with produce. */
function crate(b: GeoBuilder, x: number, y: number, z: number, w: number, h: number, d: number, fill?: number[], ry = 0, rng?: RNG): void {
  const m = M.t(x, y, z, 0, ry, 0);
  b.add(P.box(w, h, d), { color: K.timber }, m.clone().multiply(M.t(0, h / 2, 0)));
  for (const f of [0.2, 0.8]) b.add(P.box(w + 0.008, 0.018, d + 0.008), { color: K.timberDark }, m.clone().multiply(M.t(0, h * f, 0)));
  if (!fill || !rng) return;
  for (let k = 0; k < 6; k++) {
    b.add(P.sphere(Math.min(w, d) * 0.17, 0), { color: fill[k % fill.length] }, m.clone().multiply(M.t(rng.range(-w * 0.3, w * 0.3), h + 0.015, rng.range(-d * 0.3, d * 0.3))));
  }
}

/** A woven basket, optionally heaped (maize cobs, grain or fruit). */
function heapBasket(b: GeoBuilder, x: number, y: number, z: number, r: number, h: number, fill: number[], rng: RNG, cobs = false): void {
  b.add(P.cyl(r, r * 0.82, h, 10), { color: (p) => ((p.y * 60) % 1 < 0.5 ? K.rope : c(0xae8a50)) }, M.t(x, y + h / 2, z));
  b.add(P.cyl(r * 1.04, r * 1.04, 0.025, 10), { color: c(0x9c7a44) }, M.t(x, y + h, z));
  if (cobs) {
    for (let k = 0; k < 7; k++) {
      const a = rng.range(0, Math.PI * 2), d = rng.range(0, r * 0.6);
      b.add(P.cyl(r * 0.16, r * 0.2, r * 0.75, 6), { color: k % 3 ? c(0xf2c53a) : c(0xe8a526) }, M.t(x + Math.cos(a) * d, y + h + 0.03, z + Math.sin(a) * d, Math.PI / 2, a, 0.3));
    }
  } else {
    b.add(P.sphere(r * 0.92, 0), { color: fill[0] }, M.t(x, y + h - r * 0.25, z, 0, 0, 0, 1, 0.45, 1));
    for (let k = 0; k < 5 && fill.length > 1; k++) {
      const a = rng.range(0, Math.PI * 2), d = rng.range(0, r * 0.55);
      b.add(P.sphere(r * 0.24, 0), { color: fill[1 + (k % (fill.length - 1))] }, M.t(x + Math.cos(a) * d, y + h + r * 0.12, z + Math.sin(a) * d));
    }
  }
}

/** A painted clay pot: terracotta with a cream band of stepped fret. */
function frettedPot(b: GeoBuilder, x: number, y: number, z: number, s: number, body = 0xc4643a): void {
  b.add(P.uvSphere(0.1 * s, 7, 5), { color: (p) => (Math.abs(p.y - (y + 0.12 * s)) < 0.028 * s ? (Math.sin(Math.atan2(p.z - z, p.x - x) * 8) > 0 ? c(0xf0dfc0) : c(0x7a3420)) : c(body)) }, M.t(x, y + 0.12 * s, z, 0, 0, 0, 1, 1.25, 1));
  b.add(P.cyl(0.05 * s, 0.065 * s, 0.07 * s, 8), { color: c(body).multiplyScalar(0.85) }, M.t(x, y + 0.25 * s, z));
  b.add(P.cyl(0.065 * s, 0.065 * s, 0.015 * s, 8), { color: c(body).multiplyScalar(0.75) }, M.t(x, y + 0.29 * s, z));
}

/** A banner pole with a hanging red sun banner (facing +z before rotation `ry`). */
function bannerPole(b: GeoBuilder, x: number, z: number, h: number, ry = 0): void {
  b.add(P.cyl(0.025, 0.03, h, 5), { color: K.timberDark }, M.t(x, h / 2, z));
  b.add(P.box(0.3, 0.025, 0.025), { color: K.timberDark }, M.t(x, h - 0.04, z, 0, ry, 0));
  sunBanner(b, M.t(x, h - 0.27, z, 0, ry, 0).multiply(M.t(0, 0, 0.03)), 0.24, 0.42, true);
}

/** A ladder leaning from (x, 0, z) toward ry, `h` high. */
function ladder(b: GeoBuilder, x: number, z: number, h: number, ry: number, lean = 0.3): void {
  const m = M.t(x, 0, z, 0, ry, 0).multiply(M.t(0, 0, 0, -lean, 0, 0));
  for (const s of [-1, 1]) b.add(P.box(0.025, h, 0.025), { color: K.timber }, m.clone().multiply(M.t(s * 0.09, h / 2, 0)));
  for (let k = 1; k < Math.floor(h / 0.12); k++) b.add(P.box(0.18, 0.018, 0.02), { color: K.timberDark }, m.clone().multiply(M.t(0, k * 0.12, 0)));
}

/** A fire bowl on a short stand; returns where its flame burns. */
function fireBowl(b: GeoBuilder, x: number, y: number, z: number, s = 1): THREE.Vector3 {
  b.add(P.cyl(0.13 * s, 0.07 * s, 0.09 * s, 9), { color: c(0x8a7a68) }, M.t(x, y + 0.045 * s, z));
  b.add(P.cyl(0.115 * s, 0.115 * s, 0.01, 9), { color: c(0x3a2a20) }, M.t(x, y + 0.09 * s, z));
  return new THREE.Vector3(x, y + 0.13 * s, z);
}

/** The Great Hall's bronze bell with its clapper (pivot at the top, hanging down -y). */
export function hallBellGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const pts=[[0.055,-.08],[.12,-.1],[.15,-.2],[.18,-.38],[.27,-.52],[.29,-.55],[.29,-.59],[.245,-.59],[.225,-.53],[.14,-.36],[.11,-.19],[.055,-.15]].map(([x,y])=>new THREE.Vector2(x,y));
  b.add(new THREE.LatheGeometry(pts,20),{color:c(0xb58a42)},M.t(0,0,0));
  for(const y of [-.22,-.5])b.add(new THREE.TorusGeometry(y===-.22?.16:.255,.018,5,20),{color:K.gold},M.t(0,y,0,Math.PI/2));
  b.add(P.box(.42,.09,.12),{color:K.timberDark},M.t(0,-.04,0));
  b.add(P.cyl(.018,.018,.48,6),{color:c(0x514535)},M.t(0,-.34,0));
  b.add(P.sphere(.052,1),{color:c(0x65503a)},M.t(0,-.6,0));
  b.add(P.cyl(.012,.012,.75,5),{color:K.rope},M.t(.18,-.85,0));
  return b.build();
}

/**
 * Great Hall: a two-stepped sandstone platform with red key-pattern panels, a wide front stair
 * with a red runner between stone cheeks, four corner pillars hung with sun banners and topped
 * with fire braziers, and a red-and-white striped canopy on timber posts sheltering rows of
 * benches that face a sun-disc dais. Ferns and red flowers fill planters beside the stair and
 * along the sides. The bell under the front beam is a separate mesh (it swings when rung).
 */
export function greatHallModel(): BuildingModel {
  const b = new GeoBuilder();
  const rng = new RNG(707);
  const H = HALL.h, E = HALL.edge;
  const sand = c(0xdcb57c), sandDark = c(0xc39a62), cream = c(0xf1e2c0);
  const pave = (i: number, j: number) => c(0xcfc5b3).lerp(c(0xa39683), ((i * 7 + j * 13) % 5) / 6 + rng.range(0, 0.15));
  // Paved court round the platform.
  b.add(P.box(6.95, 0.012, 6.95), { color: c(0x9c917f) }, M.t(0, 0.056, 0));
  slabs(b, -3.45, -3.45, 14, 14, 6.9 / 14, 0.064, 0.028, pave, (x, z) => Math.abs(x) < E + 0.15 && Math.abs(z) < E + 0.15);
  // Lower step: a course of blocks; then the platform proper under a sand-coloured coping.
  b.add(P.box(2 * E + 0.4, 0.2, 2 * E + 0.4), { color: K.stoneDark }, M.t(0, 0.1, 0));
  for (let side = 0; side < 4; side++) {
    const ry = (side * Math.PI) / 2;
    for (let k = 0; k < 10; k++) {
      const u = -E - 0.2 + ((2 * E + 0.4) / 10) * (k + 0.5);
      b.add(P.box((2 * E + 0.4) / 10 - 0.02, 0.17, 0.03), { color: k % 2 ? K.stone : c(0xb4a894) }, M.t(Math.sin(ry) * (E + 0.2) + Math.cos(ry) * u, 0.1, Math.cos(ry) * (E + 0.2) - Math.sin(ry) * u, 0, ry, 0));
    }
  }
  b.add(P.box(2 * E, H - 0.25, 2 * E), { color: sand }, M.t(0, 0.2 + (H - 0.25) / 2, 0));
  b.add(P.box(2 * E + 0.06, 0.05, 2 * E + 0.06), { color: sandDark }, M.t(0, H - 0.025, 0));
  // Red key-pattern panels round the sides (not across the stair).
  const panel = (m: THREE.Matrix4) => {
    b.add(P.box(0.46, 0.17, 0.02), { color: K.red }, m);
    b.add(P.box(0.3, 0.09, 0.024), { color: cream }, m.clone().multiply(M.t(0, 0, 0.002)));
    b.add(P.box(0.18, 0.035, 0.028), { color: K.red }, m.clone().multiply(M.t(-0.02, 0.012, 0.002)));
    b.add(P.box(0.035, 0.07, 0.028), { color: K.red }, m.clone().multiply(M.t(0.08, 0, 0.002)));
  };
  for (let side = 0; side < 4; side++) {
    const ry = (side * Math.PI) / 2;
    for (let k = -2; k <= 2; k++) {
      if (side === 0 && Math.abs(k) < 1) continue;
      const u = k * 1.0;
      const m = M.t(Math.sin(ry) * (E + 0.011) + Math.cos(ry) * u, 0.33, Math.cos(ry) * (E + 0.011) - Math.sin(ry) * u, 0, ry, 0);
      panel(m);
    }
  }
  // Floor: pale stone slabs, a red border inlay and a red runner up the aisle to the dais.
  slabs(b, -E + 0.05, -E + 0.05, 9, 9, (2 * E - 0.1) / 9, H, 0.02, (i, j) => ((i + j) % 2 ? cream.clone() : c(0xe4d0a8)));
  for (const s of [-1, 1]) {
    b.add(P.box(2 * E - 0.5, 0.012, 0.08), { color: K.red }, M.t(0, H + 0.022, s * (E - 0.3)));
    b.add(P.box(0.08, 0.012, 2 * E - 0.5), { color: K.red }, M.t(s * (E - 0.3), H + 0.022, 0));
  }
  b.add(P.box(0.5, 0.024, 4.6), { color: c(0xa92c22) }, M.t(0, H + 0.042, 0.3));
  // Front stair: red risers, cream treads, stone cheeks either side.
  const steps = 5, run = (HALL.stairFoot - E) / steps, rise = H / steps;
  for (let k = 0; k < steps; k++) {
    const top = H - k * rise, z = E + run * (k + 0.5);
    b.add(P.box(HALL.stairHalf * 2, top - 0.025, run), { color: K.red }, M.t(0, (top - 0.025) / 2, z));
    b.add(P.box(HALL.stairHalf * 2 + 0.02, 0.025, run + 0.02), { color: cream }, M.t(0, top - 0.0125, z));
    // Continue the carpet down every tread, clearly above the paving and coping.
    b.add(P.box(0.5, 0.018, run + 0.012), { color: c(0xa92c22) }, M.t(0, top + 0.021, z));
    b.add(P.box(0.5, rise - 0.018, 0.016), { color: c(0xa92c22) }, M.t(0, top - rise / 2, z + run / 2 + 0.009));
  }
  // Sloped stone cheeks either side of the stair.
  const cheekShape = new THREE.Shape([
    new THREE.Vector2(E - 0.05, 0), new THREE.Vector2(HALL.stairFoot + 0.06, 0), new THREE.Vector2(HALL.stairFoot + 0.06, 0.1), new THREE.Vector2(E - 0.05, H + 0.08),
  ]);
  const cheekGeo = new THREE.ExtrudeGeometry(cheekShape, { depth: 0.2, bevelEnabled: false });
  for (const sx of [-1, 1]) {
    b.add(cheekGeo, { color: K.stone }, M.t(sx * (HALL.stairHalf + 0.1) + 0.1, 0, 0, 0, -Math.PI / 2, 0));
  }
  // Corner pillars: plinth, banded shaft, sun banners on the outer faces, a brazier on top.
  const torches: THREE.Vector3[] = [];
  const PC = 2.3, PH = 1.45;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * PC, z = sz * PC;
      b.add(P.box(0.7, 0.14, 0.7), { color: sandDark }, M.t(x, H + 0.07, z));
      b.add(P.box(0.55, PH, 0.55), { color: sand }, M.t(x, H + 0.14 + PH / 2, z));
      b.add(P.box(0.57, 0.09, 0.57), { color: K.red }, M.t(x, H + 0.14 + PH * 0.86, z));
      b.add(P.box(0.575, 0.03, 0.575), { color: K.gold }, M.t(x, H + 0.14 + PH * 0.86 + 0.06, z));
      b.add(P.box(0.575, 0.03, 0.575), { color: K.gold }, M.t(x, H + 0.14 + PH * 0.86 - 0.06, z));
      b.add(P.box(0.64, 0.08, 0.64), { color: cream }, M.t(x, H + 0.14 + PH + 0.04, z));
      b.add(P.box(0.08, 0.08, 0.08), { color: K.gold }, M.t(x + sx * 0.28, H + 0.14 + PH + 0.12, z + sz * 0.28));
      // Banners on the two outward faces.
      sunBanner(b, M.t(x, H + 0.14 + PH * 0.42, z + sz * 0.286, 0, sz > 0 ? 0 : Math.PI, 0), 0.34, 0.62);
      sunBanner(b, M.t(x + sx * 0.286, H + 0.14 + PH * 0.42, z, 0, sx > 0 ? Math.PI / 2 : -Math.PI / 2, 0), 0.34, 0.62);
      // Brazier: a stone bowl on a short stem.
      const top = H + 0.14 + PH + 0.08;
      b.add(P.cyl(0.07, 0.1, 0.1, 8), { color: K.stoneDark }, M.t(x, top + 0.05, z));
      b.add(P.cyl(0.24, 0.12, 0.14, 10), { color: c(0x7d746c) }, M.t(x, top + 0.17, z));
      b.add(P.cyl(0.2, 0.2, 0.02, 10), { color: c(0xa16c3e) }, M.t(x, top + 0.23, z));
      torches.push(new THREE.Vector3(x, top + 0.245, z));
    }
  }
  // Canopy: six timber posts, beams, and a low striped gable roof with a red fascia and gold studs.
  const PX = 2.45, PZ = [-1.9, 0, 1.9], CH = H + 1.3;
  for (const sx of [-1, 1]) {
    for (const z of PZ) {
      b.add(P.box(0.13, 1.3, 0.13), { color: K.timberDark }, M.t(sx * PX, H + 0.65, z));
      b.add(P.box(0.18, 0.08, 0.18), { color: K.timber }, M.t(sx * PX, H + 0.04, z));
    }
    b.add(P.box(0.14, 0.12, 4.2), { color: K.timber }, M.t(sx * PX, CH, 0));
  }
  for (const z of PZ) b.add(P.box(5.05, 0.1, 0.12), { color: K.timber }, M.t(0, CH - 0.02, z));
  const roof = new GeoBuilder();
  const RW = 2.6, RL = 4.8, rise2 = 0.32, slope = Math.atan2(rise2, RW);
  const bands = 12;
  for (const sx of [-1, 1]) {
    for (let k = 0; k < bands; k++) {
      const z = -RL / 2 + (RL / bands) * (k + 0.5);
      const m = M.t(sx * RW / 2, CH + 0.1 + rise2 / 2, z, 0, 0, -sx * slope);
      roof.add(P.box(Math.hypot(RW, rise2) + 0.02, 0.05, RL / bands + 0.002), { color: k % 2 ? K.white : K.red }, m);
    }
    // Fascia board along the eave, studded with gold blocks.
    roof.add(P.box(0.06, 0.12, RL + 0.04), { color: c(0x9e2c22) }, M.t(sx * (RW + 0.01), CH + 0.08, 0));
    for (let k = 0; k <= 4; k++) roof.add(P.box(0.1, 0.1, 0.1), { color: K.gold }, M.t(sx * (RW + 0.05), CH + 0.08, -RL / 2 + (RL / 4) * k));
  }
  roof.add(P.box(0.12, 0.1, RL + 0.1), { color: K.gold }, M.t(0, CH + 0.1 + rise2 + 0.03, 0));
  for (const sz of [-1, 1]) roof.add(P.box(2 * RW + 0.1, 0.1, 0.06), { color: c(0x9e2c22) }, M.t(0, CH + 0.06, sz * (RL / 2 + 0.01)));
  // Benches in rows (facing the dais), each a plank on two legs.
  for (const z of [...new Set(HALL.seats.map(p=>p.z))]) {
    for (const sx of [-1, 1]) {
      b.add(P.box(1.95, 0.04, 0.17), { color: K.timber }, M.t(sx * 1.25, H + 0.12, z - 0.03));
      for (const lx of [0.4, 2.1]) b.add(P.box(0.05, 0.11, 0.13), { color: K.timberDark }, M.t(sx * lx, H + 0.055, z - 0.03));
    }
  }
  // Dais at the back: a low step, a carved stela with a great golden sun, and two pots of ferns.
  b.add(P.box(2.4, 0.09, 0.8), { color: sandDark }, M.t(0, H + 0.045, -2.15));
  b.add(P.box(1.0, 0.95, 0.18), { color: sand }, M.t(0, H + 0.09 + 0.475, -2.4));
  b.add(P.box(1.06, 0.07, 0.22), { color: K.red }, M.t(0, H + 0.09 + 0.98, -2.4));
  b.add(P.cyl(0.34, 0.34, 0.04, 16), { color: K.gold }, M.t(0, H + 0.62, -2.3, Math.PI / 2, 0, 0));
  b.add(P.cyl(0.2, 0.2, 0.05, 12), { color: K.red }, M.t(0, H + 0.62, -2.29, Math.PI / 2, 0, 0));
  b.add(P.cyl(0.1, 0.1, 0.06, 10), { color: K.gold }, M.t(0, H + 0.62, -2.28, Math.PI / 2, 0, 0));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    b.add(P.cone(0.05, 0.12, 4), { color: K.gold }, M.t(Math.cos(a) * 0.42, H + 0.62 + Math.sin(a) * 0.42, -2.3, 0, 0, a - Math.PI / 2));
  }
  for (const sx of [-1, 1]) {
    b.add(P.cyl(0.13, 0.1, 0.2, 8), { color: K.terracotta }, M.t(sx * 0.85, H + 0.19, -2.25));
    fern(b, sx * 0.85, H + 0.22, -2.25, 0.8, 30 + sx);
  }
  // Planters: beside the stair and along the sides, full of ferns and red flowers.
  const planter = (x: number, z: number, w: number, d: number, seed: number) => {
    b.add(P.box(w, 0.22, d), { color: sand }, M.t(x, 0.11, z));
    b.add(P.box(w + 0.03, 0.05, d + 0.03), { color: K.red }, M.t(x, 0.245, z));
    // Soil just above the red rim's top (level with it, the two flickered).
    b.add(P.box(w - 0.08, 0.02, d - 0.08), { color: c(0x4a3624) }, M.t(x, 0.266, z));
    const long = Math.max(w, d), along = w >= d;
    const n = Math.max(1, Math.round(long / 0.4));
    for (let k = 0; k < n; k++) {
      const u = -long / 2 + (long / n) * (k + 0.5);
      const px = along ? x + u : x + rng.range(-0.04, 0.04), pz = along ? z + rng.range(-0.06, 0.06) : z + u;
      if (k % 2) broadLeaf(b, px, 0.27, pz, 1.3 + rng.range(-0.2, 0.25), seed + k);
      else fern(b, px, 0.27, pz, 1.25 + rng.range(-0.15, 0.25), seed + k);
    }
    blooms(b, x, 0.26, z, Math.round(long * 9), w / 2 - 0.08, d / 2 - 0.08, seed + 50);
  };
  for (const s of [-1, 1]) {
    planter(s * 1.75, 3.15, 1.6, 0.55, 400 + s);
    planter(s * 3.2, 0, 0.45, 2.4, 500 + s);
  }
  // Banner poles at the front corners of the court.
  for (const s of [-1, 1]) {
    const x = s * 3.1, z = 3.1;
    b.add(P.cyl(0.035, 0.045, 1.6, 6), { color: K.timberDark }, M.t(x, 0.8, z));
    b.add(P.box(0.4, 0.035, 0.035), { color: K.timberDark }, M.t(x, 1.52, z + 0.0));
    sunBanner(b, M.t(x, 1.2, z + 0.03), 0.3, 0.6, true);
  }
  // Bell frame under the front beam (the bell itself swings separately).
  for(const x of [-.55,.55])b.add(P.box(.12,2.15,.14),{color:K.timberDark},M.t(x,H+1.075,HALL.bell.z));
  b.add(P.box(1.32,.16,.2),{color:K.timber},M.t(0,HALL.bell.y+.1,HALL.bell.z));
  for(const x of [-.55,.55])b.add(P.box(.15,.08,.17),{color:K.gold},M.t(x,HALL.bell.y-.05,HALL.bell.z));
  return { finished: b.build(), torches, height: 2.75, canopy: roof.build() };
}

// ---------------- Healing Centre ----------------

/**
 * Layout of the Healing Centre (model-local, door faces +z): a sandstone courtyard raised on a low
 * paved base and reached by wide front steps, the main hall along the back, a small room at each
 * front corner and four beds in the open court. Shared by the model and the patients who use it.
 */
export const HEAL = {
  /** Courtyard floor height; half-width of the base and its back and front edges; the front steps. */
  h: 0.24,
  half: 2.3,
  back: -2.3,
  front: 1.8,
  stairHalf: 0.7,
  stairFoot: 2.25,
  /** The main hall's front wall (its doorway is at x = 0). */
  hallFront: -1.1,
  /** Beds (lengthwise, head end at the back, z0) and the mattress top above the floor. */
  beds: [-1.05, -0.45, 0.45, 1.05].map((x) => ({ x, z0: -0.3 })),
  bedLen: 0.66,
  bedW: 0.3,
  bedTop: 0.17,
  /** Where a patient stands beside bed k before lying down (local x): the aisle, or the gap between beds. */
  bedSide(k: number): number {
    const x = HEAL.beds[k].x;
    return Math.sign(x) * (Math.abs(x) < 0.7 ? 0.12 : 0.75);
  },
  /** Floor height at a local point: the courtyard, the front steps, else the ground. */
  floorY(lx: number, lz: number): number {
    if (Math.abs(lx) <= HEAL.half && lz >= HEAL.back && lz <= HEAL.front) return HEAL.h;
    if (Math.abs(lx) <= HEAL.stairHalf && lz > HEAL.front && lz < HEAL.stairFoot) return (HEAL.h * (HEAL.stairFoot - lz)) / (HEAL.stairFoot - HEAL.front);
    return 0;
  },
};

const HC = {
  wall: c(0xe2b77e),
  wallLight: c(0xf0d3a2),
  dark: c(0xc39a62),
  roof: c(0xd7a86c),
  band: c(0x8e2a22),
  red: c(0xb8322a),
  cream: c(0xf3e3c6),
  post: c(0x5e3b22),
  clay: c(0xc4643a),
  clayDark: c(0x9c4a2c),
  leaf: c(0x3f8a34),
  leafLight: c(0x7cc04a),
};

/** A sandstone block with a dark red band round its foot and a raised parapet round its flat roof. */
function sandBlock(b: GeoBuilder, w: number, h: number, d: number, x: number, y: number, z: number): void {
  b.add(P.rbox(w, h, d, 0.03), { color: (p) => HC.wall.clone().lerp(HC.wallLight, Math.min(1, Math.max(0, (p.y - y) / h)) * 0.5) }, M.t(x, y + h / 2, z));
  b.add(P.box(w + 0.02, 0.12, d + 0.02), { color: HC.band }, M.t(x, y + 0.06, z));
  b.add(P.box(w + 0.03, 0.03, d + 0.03), { color: HC.dark }, M.t(x, y + h - 0.015, z));
  const t = 0.08, ph = 0.13;
  b.add(P.box(w, ph, t), { color: HC.wallLight }, M.t(x, y + h + ph / 2, z + d / 2 - t / 2));
  b.add(P.box(w, ph, t), { color: HC.wallLight }, M.t(x, y + h + ph / 2, z - d / 2 + t / 2));
  b.add(P.box(t, ph, d - t * 2), { color: HC.wallLight }, M.t(x + w / 2 - t / 2, y + h + ph / 2, z));
  b.add(P.box(t, ph, d - t * 2), { color: HC.wallLight }, M.t(x - w / 2 + t / 2, y + h + ph / 2, z));
  b.add(P.box(w - t * 2, 0.02, d - t * 2), { color: HC.roof }, M.t(x, y + h + 0.01, z));
}

/** A round clay storage jar. */
function clayJar(b: GeoBuilder, x: number, y: number, z: number, s = 1): void {
  b.add(P.sphere(0.08 * s, 1), { color: (p) => (p.y < y + 0.06 * s ? HC.clayDark : HC.clay) }, M.t(x, y + 0.09 * s, z, 0, 0, 0, 1, 1.15, 1));
  b.add(P.cyl(0.035 * s, 0.045 * s, 0.05 * s, 7), { color: HC.clay }, M.t(x, y + 0.19 * s, z));
  b.add(P.cyl(0.045 * s, 0.045 * s, 0.015 * s, 7), { color: HC.clayDark }, M.t(x, y + 0.215 * s, z));
}

/**
 * Healing Centre: a stone-paved plot carrying a raised sandstone courtyard. Along the back, the long
 * main hall with a flat roof, a raised parapet and a green leaf over its doorway, shaded by a long red
 * and white striped awning on dark posts over a table of bowls, herbs and clay jars. A small room at
 * each front corner with a window and a little striped awning over its red door, and four low beds
 * with cream mattresses and red pillows and blankets in the open court. Wide front steps with red
 * risers between planters of leafy plants and orange flowers, torches on the front corner posts and
 * a flagstone path out front.
 */
export function healingCentreModel(): BuildingModel {
  const b = new GeoBuilder();
  const rng = new RNG(1313);
  const H = HEAL.h, W = HEAL.half, BK = HEAL.back, F = HEAL.front, HF = HEAL.hallFront;
  // Paved ground over the whole plot and a flagstone path out from the steps.
  b.add(P.box(4.95, 0.012, 4.95), { color: c(0x8f887d) }, M.t(0, 0.006, 0));
  for (let x = -0.95; x < 0.9; ) {
    const w = rng.range(0.24, 0.36);
    for (const z of [2.3, 2.45]) {
      if (z > 2.4 && Math.abs(x + w / 2) > 0.7) continue;
      b.add(P.box(w - 0.025, 0.02, 0.13), { color: c(0xaaa49a).lerp(c(0x7d7870), rng.next() * 0.7) }, M.t(x + w / 2 + rng.range(-0.01, 0.01), 0.01, z + rng.range(-0.01, 0.01), 0, rng.range(-0.05, 0.05), 0));
    }
    x += w;
  }
  // The courtyard base: a stone course under a sandstone coping with a thin red fascia.
  const cz = (F + BK) / 2, cd = F - BK;
  b.add(P.box(2 * W, H - 0.04, cd), { color: K.stoneDark }, M.t(0, (H - 0.04) / 2, cz));
  b.add(P.box(2 * W + 0.04, 0.04, cd + 0.04), { color: HC.dark }, M.t(0, H - 0.02, cz));
  b.add(P.box(2 * W + 0.02, 0.035, cd + 0.02), { color: HC.band }, M.t(0, H - 0.075, cz));
  // Sandstone floor tiles over the court (not under the rooms).
  const cell = (2 * W) / 16;
  slabs(b, -W, HF, 16, 10, cell, H, 0.012, (i, j) => HC.wallLight.clone().lerp(HC.dark, ((i * 5 + j * 11) % 4) / 8 + rng.range(0, 0.12)), (x, z) => Math.abs(x) > 1.3 && z > 0.45);
  // Front steps: red risers under sandstone treads.
  const steps = 3, run = (HEAL.stairFoot - F) / steps, rise = H / steps;
  for (let k = 0; k < steps; k++) {
    const top = H - k * rise, z = F + run * (k + 0.5);
    b.add(P.box(HEAL.stairHalf * 2, top - 0.02, run), { color: K.red }, M.t(0, (top - 0.02) / 2, z));
    b.add(P.box(HEAL.stairHalf * 2 + 0.02, 0.02, run + 0.02), { color: HC.wallLight }, M.t(0, top - 0.01, z));
  }
  // Main hall along the back, its doorway facing the court under a green leaf emblem.
  const hallH = 1.15, hallD = HF - BK;
  sandBlock(b, 2 * W, hallH, hallD, 0, H, (HF + BK) / 2);
  b.add(P.box(0.46, 0.64, 0.03), { color: HC.wallLight }, M.t(0, H + 0.32, HF + 0.005));
  b.add(P.box(0.36, 0.56, 0.04), { color: c(0x3a2721) }, M.t(0, H + 0.28, HF + 0.012));
  b.add(P.box(0.5, 0.05, 0.05), { color: HC.band }, M.t(0, H + 0.66, HF + 0.02));
  b.add(P.cyl(0.1, 0.1, 0.025, 12), { color: HC.cream }, M.t(0, H + 0.98, HF + 0.012, Math.PI / 2, 0, 0));
  for (const [a, s] of [[0.5, 0.85], [-0.5, 0.85], [0, 1.1]]) {
    b.add(P.sphere(0.05, 0), { color: s > 1 ? HC.leafLight : HC.leaf }, M.t(Math.sin(a) * 0.04, H + 0.98 + Math.cos(a) * 0.015, HF + 0.03, 0, 0, -a, 0.45 * s, 1.2 * s, 0.25));
  }
  b.add(P.box(0.012, 0.08, 0.01), { color: c(0x2f6a28) }, M.t(0, H + 0.93, HF + 0.035));
  for (const x of [-1.55, 1.55]) adobeWindow(b, x, H + 0.55, HF + 0.01, false, 0.16, 0.2);
  // The long striped awning in front of the hall (drawn with the canopy), on four dark posts.
  const roof = new GeoBuilder();
  const aw = 3.7, az1 = -0.45, yTop = H + 0.84, yLow = H + 0.68;
  const alen = Math.hypot(az1 - HF, yTop - yLow), slope = Math.atan2(yTop - yLow, az1 - HF);
  const stripes = 12;
  for (let k = 0; k < stripes; k++) {
    roof.add(P.box(aw / stripes + 0.002, 0.025, alen), { color: k % 2 ? K.white : K.red }, M.t(-aw / 2 + (aw / stripes) * (k + 0.5), (yTop + yLow) / 2, (HF + az1) / 2, slope, 0, 0));
  }
  roof.add(P.box(aw + 0.02, 0.08, 0.02), { color: K.red }, M.t(0, yLow - 0.05, az1 + 0.01));
  for (const x of [-1.8, -0.6, 0.6, 1.8]) b.add(P.box(0.07, yLow - H, 0.07), { color: HC.post }, M.t(x, H + (yLow - H) / 2, az1 - 0.04));
  b.add(P.box(aw, 0.05, 0.05), { color: HC.post }, M.t(0, yLow - 0.02, az1 - 0.04));
  // Under the awning: a long table of bowls and herbs, clay jars and potted plants.
  const tx = -1.15, tz = -0.8, tw = 0.9, td = 0.28, th = 0.28;
  b.add(P.box(tw, 0.04, td), { color: K.timber }, M.t(tx, H + th, tz));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(P.box(0.04, th - 0.02, 0.04), { color: HC.post }, M.t(tx + sx * (tw / 2 - 0.05), H + (th - 0.02) / 2, tz + sz * (td / 2 - 0.04)));
  for (const [dx, col] of [[-0.3, HC.clay], [-0.12, K.stoneDark], [0.05, HC.clay]] as [number, THREE.Color][]) {
    b.add(P.cyl(0.055, 0.035, 0.04, 8), { color: col }, M.t(tx + dx, H + th + 0.04, tz));
    b.add(P.cyl(0.045, 0.045, 0.01, 8), { color: dx < 0 ? c(0x6e9a3a) : c(0xd9a54a) }, M.t(tx + dx, H + th + 0.055, tz));
  }
  pottedPlant(b, tx + 0.3, H + th + 0.02, tz, 0.7);
  clayJar(b, -1.78, H, -0.8, 1.1);
  clayJar(b, -1.72, H, -0.6, 0.8);
  clayJar(b, 1.05, H, -0.85, 1.2);
  clayJar(b, 1.28, H, -0.8, 0.9);
  pottedPlant(b, 1.55, H, -0.8, 1.1);
  pottedPlant(b, 1.8, H, -0.72, 0.85);
  pottedPlant(b, -0.35, H, -0.85, 0.9);
  // The two small front rooms, doors facing the court under little striped awnings.
  for (const sx of [-1, 1]) {
    const rx = sx * 1.825, rz = 1.05, rw = 0.95, rd = 1.1, rh = 0.8;
    sandBlock(b, rw, rh, rd, rx, H, rz);
    adobeWindow(b, rx, H + 0.5, rz + rd / 2 + 0.005, false, 0.14, 0.16);
    adobeWindow(b, sx * (W + 0.005), H + 0.5, rz, true, 0.14, 0.16);
    // Local frame on the inner wall: x along it, y up from the floor, +z out into the court.
    const m0 = M.t(sx * (1.825 - rw / 2), H, rz, 0, (-sx * Math.PI) / 2, 0);
    const at = (x: number, y: number, z: number, tilt = 0) => m0.clone().multiply(M.t(x, y, z, tilt, 0, 0));
    b.add(P.box(0.32, 0.5, 0.03), { color: HC.wallLight }, at(0, 0.25, 0.005));
    b.add(P.box(0.26, 0.44, 0.04), { color: HC.red }, at(0, 0.22, 0.012));
    b.add(P.box(0.02, 0.02, 0.02), { color: K.gold }, at(0.08, 0.22, 0.035));
    const sw = 0.5, sd = 0.26, n = 5;
    for (let k = 0; k < n; k++) b.add(P.box(sw / n + 0.002, 0.02, sd), { color: k % 2 ? K.white : K.red }, at(-sw / 2 + (sw / n) * (k + 0.5), 0.6, sd / 2, 0.3));
    b.add(P.box(sw + 0.01, 0.05, 0.015), { color: K.red }, at(0, 0.54, sd * 0.96));
    for (const x of [-0.2, 0.2]) b.add(P.box(0.025, 0.025, 0.22), { color: HC.post }, at(x, 0.5, 0.1, -0.5));
  }
  // Four low beds: wooden frames, cream mattresses, red pillows and folded red blankets.
  for (const bed of HEAL.beds) {
    const L = HEAL.bedLen, BW = HEAL.bedW, zc = bed.z0 + L / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(P.box(0.04, 0.09, 0.04), { color: HC.post }, M.t(bed.x + sx * (BW / 2 - 0.03), H + 0.045, zc + sz * (L / 2 - 0.03)));
    b.add(P.box(BW, 0.04, L), { color: K.timber }, M.t(bed.x, H + 0.1, zc));
    b.add(P.box(BW, 0.12, 0.03), { color: HC.post }, M.t(bed.x, H + 0.14, bed.z0 + 0.015));
    b.add(P.box(BW - 0.03, 0.05, L - 0.05), { color: HC.cream }, M.t(bed.x, H + 0.145, zc + 0.01));
    b.add(P.box(BW - 0.09, 0.04, 0.1), { color: HC.red }, M.t(bed.x, H + 0.185, bed.z0 + 0.1));
    b.add(P.box(BW - 0.01, 0.018, 0.2), { color: HC.red }, M.t(bed.x, H + 0.178, bed.z0 + L - 0.13));
    b.add(P.box(BW, 0.02, 0.03), { color: HC.cream }, M.t(bed.x, H + 0.18, bed.z0 + L - 0.1));
  }
  // Raised planters either side of the steps, full of leafy plants and orange flowers.
  for (const sx of [-1, 1]) {
    const px = sx * 1.4, pz = 2.04, pw = 0.95, pd = 0.36;
    b.add(P.box(pw, 0.26, pd), { color: HC.wall }, M.t(px, 0.13, pz));
    b.add(P.box(pw + 0.03, 0.05, pd + 0.03), { color: HC.red }, M.t(px, 0.28, pz));
    b.add(P.box(pw - 0.08, 0.02, pd - 0.08), { color: c(0x4a3624) }, M.t(px, 0.3, pz));
    for (let k = 0; k < 3; k++) {
      const x = px + (k - 1) * 0.3 + rng.range(-0.03, 0.03), z = pz + rng.range(-0.04, 0.04);
      if (k === 1) broadLeaf(b, x, 0.3, z, 1.35, 70 + sx * 3 + k);
      else fern(b, x, 0.3, z, 1.1, 80 + sx * 3 + k);
    }
    blooms(b, px, 0.3, pz, 10, pw / 2 - 0.1, pd / 2 - 0.08, 90 + sx, 0.3);
  }
  // Short posts at the corners: torches at the front, stone posts at the back.
  const torches = [torchPole(b, -2.4, 2.4, 0.6), torchPole(b, 2.4, 2.4, 0.6)];
  for (const sx of [-1, 1]) {
    b.add(P.box(0.12, 0.34, 0.12), { color: K.stone }, M.t(sx * 2.4, 0.17, -2.4));
    b.add(P.box(0.16, 0.05, 0.16), { color: HC.dark }, M.t(sx * 2.4, 0.36, -2.4));
  }
  return { finished: b.build(), torches, height: 1.6, canopy: roof.build() };
}

// ---------------- Watchtower ----------------

/** Watchtower layout (local): the platform's floor height, and where the archer stands on it. */
/**
 * Watchtower layout (local, door side +z): the watch room's floor height, the half-width of its
 * walls, and the height of its window openings above the floor (arrows fly out of these).
 */
export const TOWER = { platform: 2.42, half: 0.67, windowY: 0.42 };

/**
 * Watchtower: four leaning timber legs on a stone footing, cross-braced and lashed, carrying a
 * closed plank watch room with a shuttered window on every side (arrows fly out of them), a
 * steep thatched roof with a torch basket burning on its peak at night, a red-and-gold banner,
 * and a ladder up to a trapdoor.
 */
export function watchtowerModel(): BuildingModel {
  const b = new GeoBuilder();
  const rng = new RNG(1789);
  const P0 = TOWER.platform;
  // Stone footing and rubble.
  b.add(P.rbox(1.55, 0.34, 1.55, 0.08), { color: K.stoneDark }, M.t(0, 0.17, 0));
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + rng.next() * 0.3;
    b.add(lumpy(P.sphere(0.1 + rng.next() * 0.05, 1), 0.25, 300 + k, 0.7), { color: k % 2 ? K.stone : K.stoneDark }, M.t(Math.cos(a) * 0.86, 0.05, Math.sin(a) * 0.86));
  }
  // Legs lean in toward the top.
  const foot = 0.62, top = 0.52;
  const legs: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (const [sx, sz] of legs) {
    const x0 = sx * foot, z0 = sz * foot, x1 = sx * top, z1 = sz * top;
    const h = P0 - 0.3;
    const len = Math.hypot(h, x1 - x0, z1 - z0);
    b.add(P.cyl(0.055, 0.075, len, 6), { color: K.timber }, M.t((x0 + x1) / 2, 0.3 + h / 2, (z0 + z1) / 2, (z1 - z0) / len, 0, -(x1 - x0) / len));
    // Rope lashings.
    for (const y of [0.9, 1.7]) b.add(P.cyl(0.07, 0.07, 0.05, 6), { color: K.rope }, M.t(x0 + (x1 - x0) * ((y - 0.3) / h), y, z0 + (z1 - z0) * ((y - 0.3) / h)));
  }
  // Cross braces on the back and sides (the front has the ladder).
  const brace = (ax: number, az: number, bx: number, bz: number, y0: number, y1: number) => {
    const dx = bx - ax, dz = bz - az, dy = y1 - y0, len = Math.hypot(dx, dy, dz);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2), q, new THREE.Vector3(1, 1, 1));
    b.add(P.cyl(0.03, 0.03, len, 5), { color: K.timberDark }, m);
  };
  const at = (s: number, y: number) => foot + (top - foot) * ((y - 0.3) / (P0 - 0.3)) * s;
  for (const [y0, y1] of [[0.5, 1.45], [1.45, 2.3]]) {
    brace(-at(1, y0), -at(1, y0), at(1, y1), -at(1, y1), y0, y1);
    brace(at(1, y0), -at(1, y0), -at(1, y1), -at(1, y1), y0, y1);
    for (const s of [-1, 1]) {
      brace(s * at(1, y0), -at(1, y0), s * at(1, y1), at(1, y1), y0, y1);
      brace(s * at(1, y0), at(1, y0), s * at(1, y1), -at(1, y1), y0, y1);
    }
  }
  // Plank floor on a beam frame, overhanging the legs a little.
  const H = TOWER.half, room = 0.78;
  b.add(P.box(H * 2 + 0.1, 0.12, H * 2 + 0.1), { color: K.timberDark }, M.t(0, P0 - 0.06, 0));
  // Walls of upright planks, each with a window: built round the opening (sill, lintel, jambs).
  const plank = (p: THREE.Vector3) => (((p.x + p.z) * 9) % 1 < 0.12 ? K.timberDark : (((p.x + p.z) * 4.5) % 1 < 0.5 ? K.timber : c(0x8a6038))).clone();
  const WW = 0.34, WH = 0.28, wy = TOWER.windowY;
  const sideWall = (rotY: number) => {
    const rot = (x: number, z: number): [number, number] => [x * Math.cos(rotY) + z * Math.sin(rotY), -x * Math.sin(rotY) + z * Math.cos(rotY)];
    const part = (x: number, y: number, w: number, h: number) => {
      const [px, pz] = rot(x, H);
      b.add(P.box(w, h, 0.07), { color: plank }, M.t(px, P0 + y, pz, 0, rotY, 0));
    };
    const side = (H * 2 - WW) / 2;
    part(-(WW / 2 + side / 2), room / 2, side, room);
    part(WW / 2 + side / 2, room / 2, side, room);
    part(0, (wy - WH / 2) / 2, WW, wy - WH / 2);
    part(0, (wy + WH / 2 + room) / 2, WW, room - (wy + WH / 2));
    // Window frame and a shutter propped open above it.
    const [fx, fz] = rot(0, H + 0.045);
    b.add(P.box(WW + 0.08, 0.04, 0.04), { color: K.timberDark }, M.t(fx, P0 + wy - WH / 2 - 0.02, fz, 0, rotY, 0));
    b.add(P.box(WW + 0.08, 0.04, 0.04), { color: K.timberDark }, M.t(fx, P0 + wy + WH / 2 + 0.02, fz, 0, rotY, 0));
    const [sx, sz] = rot(0, H + 0.13);
    b.add(P.box(WW + 0.04, WH * 0.9, 0.03), { color: c(0x8a6038) }, M.t(sx, P0 + wy + WH / 2 + 0.11, sz, 0, rotY, 0, 1, 1, 1).multiply(M.t(0, 0, 0, -0.9, 0, 0)));
  };
  for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) sideWall(r);
  // Corner posts, and the dark inside seen through the windows.
  for (const [sx, sz] of legs) b.add(P.box(0.1, room + 0.06, 0.1), { color: K.timberDark }, M.t(sx * H, P0 + room / 2, sz * H));
  b.add(P.box(H * 2 - 0.1, room - 0.02, H * 2 - 0.1), { color: c(0x1c140e) }, M.t(0, P0 + room / 2, 0));
  // A steep four-sided thatched roof with a wide overhang, and a ridge cap.
  const RH = 0.85;
  // (Several rings up the slope so the thatch bands show.)
  b.add(new THREE.ConeGeometry(H * 1.62, RH, 4, 10), { color: (p) => (((P0 + room + RH - p.y) * 9) % 1 < 0.35 ? K.thatchDark : K.thatch).clone().lerp(K.thatch, 0.25), leaf: 0.2 }, M.t(0, P0 + room + RH / 2 - 0.04, 0, 0, Math.PI / 4, 0));
  // A ragged fringe of thatch hanging off the eaves.
  for (let k = 0; k < 40; k++) {
    const side = k % 4, u = ((k >> 2) + 0.5) / 10 - 0.5;
    const e = H * 1.62 * Math.SQRT1_2 * 1.02;
    const [fx, fz] = side === 0 ? [u * 2 * e, e] : side === 1 ? [e, -u * 2 * e] : side === 2 ? [-u * 2 * e, -e] : [-e, u * 2 * e];
    b.add(P.cone(0.07, 0.12 + rng.next() * 0.06, 4), { color: K.thatchDark, leaf: 0.2 }, M.t(fx, P0 + room - 0.1, fz, Math.PI, Math.PI / 4, 0));
  }
  b.add(P.cone(H * 1.66, 0.08, 4), { color: K.thatchDark, leaf: 0.2 }, M.t(0, P0 + room - 0.02, 0, 0, Math.PI / 4, 0));
  // A red-and-gold banner under the front window.
  b.add(P.box(0.3, 0.2, 0.02), { color: K.red }, M.t(0, P0 + 0.12, H + 0.05));
  b.add(P.box(0.3, 0.04, 0.022), { color: K.gold }, M.t(0, P0 + 0.01, H + 0.05));
  // Ladder up the front to a trapdoor in the floor.
  for (const sx of [-0.14, 0.14]) b.add(P.cyl(0.025, 0.025, P0 + 0.05, 5), { color: K.timber }, M.t(sx + 0.36, (P0 + 0.05) / 2, 0.82, -0.12, 0, 0));
  for (let k = 0; k < 8; k++) {
    const y = 0.25 + k * 0.27;
    b.add(P.cyl(0.018, 0.018, 0.3, 5), { color: K.timberDark }, M.t(0.36, y, 0.82 - Math.tan(0.12) * (y - (P0 + 0.05) / 2), 0, 0, Math.PI / 2));
  }
  // The torch: a short post through the roof peak with a basket of burning pitch pine.
  const peak = P0 + room + RH - 0.06;
  b.add(P.cyl(0.035, 0.045, 0.34, 6), { color: K.timberDark }, M.t(0, peak + 0.12, 0));
  b.add(P.cyl(0.1, 0.06, 0.14, 7), { color: (p) => ((p.y * 40) % 1 < 0.5 ? K.timberDark : K.rope).clone() }, M.t(0, peak + 0.32, 0));
  return { finished: b.build(), torches: [new THREE.Vector3(0, peak + 0.44, 0)], height: peak + 0.3 };
}

/**
 * Window centres of a watchtower (local), with their outward directions: arrows are loosed from
 * whichever faces the target.
 */
export function towerWindows(): { at: THREE.Vector3; out: THREE.Vector3 }[] {
  const H = TOWER.half + 0.06, y = TOWER.platform + TOWER.windowY;
  return [[0, 1], [1, 0], [0, -1], [-1, 0]].map(([x, z]) => ({ at: new THREE.Vector3(x * H, y, z * H), out: new THREE.Vector3(x, 0, z) }));
}

/** An arrow (shaft along +z, head forward, fletching at the back). */
export function arrowGeometry(): THREE.BufferGeometry {
  const a = new GeoBuilder();
  a.add(P.cyl(0.006, 0.006, 0.5, 3), { color: K.timber }, M.t(0, 0, 0, Math.PI / 2, 0, 0));
  a.add(P.cone(0.016, 0.05, 4), { color: K.stoneDark }, M.t(0, 0, 0.27, Math.PI / 2, 0, 0));
  a.add(P.box(0.03, 0.002, 0.07), { color: K.white }, M.t(0, 0, -0.22));
  a.add(P.box(0.002, 0.03, 0.07), { color: K.white }, M.t(0, 0, -0.22));
  return a.build();
}

/** Medicinal courtyard: raised stone beds, potted plants and an adobe drying shelter. */
export function herbalistModel(): BuildingModel {
  const b = new GeoBuilder();
  const rng = new RNG(814);
  b.add(P.rbox(3.7, 0.08, 3.7, 0.025, 1), { color: c(0xbca47f) }, M.t(0, 0.04, 0));
  baseBand(b, 1.45, 1.12, -0.75, -1.04, 0.18);
  adobeBlock(b, 1.45, 1.12, 1.12, -0.75, 0.08, -1.04);
  tealDoor(b, -0.8, 0.09, -0.47, 0.35, 0.68);
  adobeWindow(b, -0.03, 0.8, -1.0, true, 0.17, 0.23);
  awning(b, -0.72, 1.03, -0.44, 1.35, 0.52, true);

  for (const x of [-1.0, 0.65]) for (const z of [0.3, 1.15]) {
    b.add(P.rbox(1.05, 0.23, 0.65, 0.025, 1), { color: K.stoneDark }, M.t(x, 0.16, z));
    b.add(P.box(0.90, 0.024, 0.50), { color: c(0x68513d) }, M.t(x, 0.282, z));
    for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) medicinalPlant(b, x - 0.34 + col * 0.22, 0.30, z - 0.13 + row * 0.26, rng.range(0.21, 0.34), row === 1);
  }
  // Open drying frame beside the shelter, with individual tied herb bundles.
  for (const x of [0.25, 1.55]) b.add(P.cyl(0.035, 0.045, 1.25, 6), { color: K.timber }, M.t(x, 0.7, -1.15));
  b.add(P.box(1.4, 0.065, 0.06), { color: K.timberDark }, M.t(0.9, 1.28, -1.15));
  for (let k = 0; k < 5; k++) {
    const x = 0.4 + k * 0.25;
    b.add(P.cyl(0.008, 0.008, 0.18, 4), { color: K.rope }, M.t(x, 1.16, -1.15));
    for (let j = 0; j < 3; j++) b.add(P.cone(0.045, 0.24, 5), { color: c(j % 2 ? 0x78815b : 0x596b47), sway: 0.1, leaf: 1 }, M.t(x + (j - 1) * 0.036, 0.98, -1.15, Math.PI, 0, (j - 1) * 0.12));
  }
  for (const [x, z] of [[1.5, -0.45], [1.55, 0.05], [-1.6, -0.28]]) {
    b.add(P.cyl(0.15, 0.10, 0.23, 9), { color: AD.pot }, M.t(x, 0.20, z));
    b.add(P.cyl(0.16, 0.16, 0.045, 9), { color: K.terracotta }, M.t(x, 0.30, z));
    b.add(P.cyl(0.12, 0.12, 0.015, 9), { color: K.mud }, M.t(x, 0.33, z));
    medicinalPlant(b, x, 0.34, z, 0.33, false);
  }
  return { finished: b.build(), torches: [torchPole(b, -1.65, 1.62, 0.7, 0.08)], height: 1.38 };
}

function medicinalPlant(b: GeoBuilder, x: number, y: number, z: number, size: number, flowers: boolean, bloom = 0xb79bb7): void {
    b.add(P.cyl(0.009, 0.012, size, 4), { color: c(0x597746) }, M.t(x, y + size / 2, z));
    for (let k = 0; k < 5; k++) {
      const a = k * 2.4;
      b.add(P.uvSphere(size * 0.24, 5, 3), { color: k % 2 ? c(0x738e56) : c(0x426950), leaf: 1, sway: 0.2 }, M.t(x + Math.cos(a) * size * 0.16, y + size * (0.25 + k * 0.12), z + Math.sin(a) * size * 0.16, 0, a, 0.5, 1.5, 0.35, 0.7));
    }
    if (flowers) b.add(P.sphere(0.035, 0), { color: c(bloom), leaf: 1, sway: 0.25 }, M.t(x, y + size, z));
  }

/** Smaller, open farming plot; the same medicinal foliage as the drying courtyard. */
export function herbalGardenModel(): BuildingModel {
  const b = new GeoBuilder();
  b.add(P.rbox(2.8, 0.07, 2.8, 0.02, 1), { color: c(0xbca47f) }, M.t(0, 0.035, 0));
  for (const x of [-0.66, 0.66]) for (const z of [-0.66, 0.66]) {
    b.add(P.rbox(1.08, 0.20, 0.95, 0.025, 1), { color: K.stoneDark }, M.t(x, 0.14, z));
    b.add(P.box(0.94, 0.018, 0.81), { color: c(0x68513d) }, M.t(x, 0.248, z));
  }
  b.add(P.cyl(0.11, 0.08, 0.18, 8), { color: AD.pot }, M.t(0, 0.13, 1.23));
  b.add(P.box(0.28, 0.02, 0.17), { color: K.timber }, M.t(0, 0.09, -1.22));
  return { finished: b.build(), torches: [], height: 0.65 };
}

function medicinalCrops(ripe: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const colours = [0xb29ac5, 0xc594a0, 0xd4ba71, 0xe0d9bd];
  let bed = 0;
  for (const x of [-0.66, 0.66]) for (const z of [-0.66, 0.66]) {
    for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
      medicinalPlant(b, x - 0.33 + col * 0.22, 0.26, z - 0.27 + row * 0.27, 0.26 + (col % 2) * 0.065, ripe, colours[bed]);
    }
    bed++;
  }
  return b.build();
}

/** Shaded carving yard: substantial stone workpieces, chips and an unfinished glyph pillar. */
export function stonemasonModel(tier = 1): BuildingModel {
  const b = new GeoBuilder(), rng = new RNG(912);
  b.add(P.box(3.7, 0.10, 2.8), { color: c(0xbba587) }, M.t(0, 0.05, 0));
  // A low cut-stone back wall with a red fret frieze and a sun banner.
  b.add(P.box(3.4, 0.62, 0.16), { color: CUT.stone }, M.t(0, 0.41, -1.3));
  b.add(P.box(3.42, 0.04, 0.2), { color: CUT.stoneLight }, M.t(0, 0.73, -1.3));
  fretBand(b, M.t(0, 0.52, -1.218), 3.3, 0.1, K.red, AD.cream);
  bannerPole(b, 1.3, -1.12, 1.4, 0);
  for (const x of [-1.6,1.6]) for (const z of [-1.1,0.65]) b.add(P.cyl(0.065,0.075,1.7,6), { color: K.timber }, M.t(x,0.95,z));
  b.add(P.box(3.45,0.09,0.10), { color: K.timberDark }, M.t(0,1.73,0.65));
  b.add(P.box(3.45,0.09,0.10), { color: K.timberDark }, M.t(0,1.83,-1.1));
  for(let k=0;k<8;k++) b.add(P.box(3.65/8,0.055,2.05), { color: k%2?c(0xb9a47d):c(0xd2bf96), leaf:0.2 }, M.t(-1.825+(k+.5)*3.65/8,1.79,-0.24,0.06));
  for(const x of [-0.7,0.7]) {
    b.add(P.rbox(0.95,0.55,0.55,0.035,1), { color: CUT.stoneDark }, M.t(x,0.38,0.9));
    b.add(P.rbox(0.62,0.28,0.42,0.025,1), { color: CUT.stone }, M.t(x,0.80,0.9));
    b.add(P.box(0.075,0.035,0.28), { color: K.timberDark }, M.t(x+0.32,0.69,0.9,0,0.3));
    b.add(P.box(0.16,0.06,0.075), { color: c(0x6b6b60) }, M.t(x+0.29,0.72,0.79));
    b.add(P.cyl(0.009,0.015,0.20,4), { color: c(0x777468) }, M.t(x-0.35,0.70,0.9,Math.PI/2,0.3));
  }
  // Glyph partly cut into a sandstone pillar; one side remains rough.
  b.add(P.rbox(0.5,1.0,0.48,0.035,1), { color: CUT.stone }, M.t(-0.9,0.65,-0.7));
  for(const [x,y,w,h] of [[-0.98,0.72,0.20,0.035],[-0.9,0.82,0.035,0.22],[-0.81,0.91,0.20,0.035]]) b.add(P.box(w,h,0.018), { color: CUT.stoneDark }, M.t(x,y,-0.45));
  for(let k=0;k<6;k++) b.add(P.rbox(0.42,0.26,0.4,0.025,1), { color: k%2?CUT.stone:CUT.stoneDark }, M.t(0.6+(k%3)*0.42,0.23+Math.floor(k/3)*0.26,-0.8));
  for(let k=0;k<24;k++) b.add(P.sphere(rng.range(0.025,0.065),0), { color: k%2?CUT.stone:CUT.stoneDark }, M.t(rng.range(-1.5,1.5),0.12,rng.range(0.25,1.3),0,rng.range(0,6),0,1,0.45,0.8));
  if (tier >= 2) {
    // Temple craft: stone footings and better dressed work surfaces.
    for (const x of [-1.6, 1.6]) for (const z of [-1.1, 0.65]) {
      b.add(P.rbox(0.24, 0.32, 0.24, 0.025, 1), { color: CUT.stone }, M.t(x, 0.25, z));
      b.add(P.box(0.27, 0.045, 0.27), { color: CUT.stoneDark }, M.t(x, 0.43, z));
    }
    for (const x of [-0.7, 0.7]) {
      b.add(P.rbox(1.02, 0.055, 0.62, 0.015, 1), { color: CUT.stone }, M.t(x, 0.67, 0.9));
      for (const sx of [-1, 1]) b.add(P.box(0.035, 0.16, 0.018), { color: K.terracotta }, M.t(x + sx * 0.33, 0.41, 1.183));
    }
  }
  if (tier >= 3) {
    // Pyramid craft: a restrained painted roof edge, braced frame and a chisel rack.
    b.add(P.box(3.48, 0.11, 0.055), { color: K.terracotta }, M.t(0, 1.72, 0.80));
    b.add(P.box(3.48, 0.025, 0.060), { color: K.plaster }, M.t(0, 1.77, 0.804));
    for (const x of [-1.6, 1.6]) {
      b.add(P.box(0.07, 0.45, 0.07), { color: K.timberDark }, M.t(x - Math.sign(x) * 0.13, 1.53, 0.65, 0, 0, Math.sign(x) * 0.65));
      b.add(P.cyl(0.079, 0.079, 0.07, 6), { color: K.jade }, M.t(x, 0.72, 0.65));
    }
    b.add(P.box(0.48, 0.06, 0.10), { color: K.timberDark }, M.t(-1.6, 1.10, -0.4));
    for (let k = 0; k < 4; k++) b.add(P.cyl(0.012, 0.018, 0.22, 5), { color: c(0x79776c) }, M.t(-1.78 + k * 0.12, 1.23, -0.4));
  }
  if (tier >= 4) {
    // Great Temple craft: fine stepped carvings and modest mineral/gold inlays.
    for (const x of [-1.6, 1.6]) b.add(P.rbox(0.21, 0.085, 0.21, 0.015, 1), { color: CUT.stone }, M.t(x, 1.81, 0.65));
    for (const x of [-1.15, 0, 1.15]) {
      b.add(P.box(0.36, 0.13, 0.025), { color: CUT.stone }, M.t(x, 1.72, 0.835));
      b.add(P.box(0.22, 0.028, 0.030), { color: K.gold }, M.t(x, 1.69, 0.851));
      b.add(P.box(0.12, 0.028, 0.030), { color: K.jade }, M.t(x, 1.73, 0.851));
    }
    b.add(P.rbox(0.48, 0.10, 0.46, 0.012, 1), { color: CUT.stone }, M.t(0.1, 0.17, -0.58));
    b.add(P.rbox(0.33, 0.10, 0.31, 0.012, 1), { color: CUT.stone }, M.t(0.1, 0.27, -0.58));
    b.add(P.rbox(0.17, 0.13, 0.16, 0.012, 1), { color: K.terracotta }, M.t(0.1, 0.385, -0.58));
  }
  // Completed training stages are shown as carved sandstone tablets at the rear of the yard.
  for (let k = 0; k < Math.min(3, tier - 1); k++) {
    const x = -0.45 + k * 0.48;
    b.add(P.rbox(0.40, 0.65, 0.10, 0.02, 1), { color: CUT.stone }, M.t(x, 1.22, -1.1));
    for (let step = 0; step < k + 2; step++) b.add(P.box(0.30 - step * 0.055, 0.045, 0.018), { color: CUT.stoneDark }, M.t(x, 1.05 + step * 0.09, -1.04));
    b.add(P.box(0.08, 0.18, 0.02), { color: K.terracotta }, M.t(x, 1.12, -1.03));
  }
  return { finished:b.build(), torches:[], height:1.9 };
}

/** Canopy colours for the market stalls: [cloth, stripe] (stripe undefined for plain cloth). */
const STALL = {
  cream: c(0xe9d8b4), red: c(0xb2412f), blue: c(0x3f6f9a), teal: c(0x237a74), gold: c(0xd7a53e),
};

/**
 * One market stall in its own frame (front toward +z): four posts, a sloping cloth canopy with a
 * stripe, a counter of goods and things hung from the front beam.
 */
function marketStall(b: GeoBuilder, rng: RNG, m: THREE.Matrix4, cloth: THREE.Color, stripe: THREE.Color | undefined, goods: 'fruit' | 'pots' | 'fish' | 'cloth' | 'maize'): void {
  const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => m.clone().multiply(M.t(x, y, z, rx, ry, rz, sx, sy, sz));
  const W = 1.05, D = 0.62, hf = 0.95, hb = 1.12;
  for (const [x, z, h] of [[-W / 2, D / 2, hf], [W / 2, D / 2, hf], [-W / 2, -D / 2, hb], [W / 2, -D / 2, hb]] as const) {
    b.add(P.cyl(0.03, 0.035, h, 6), { color: K.timberDark }, at(x, h / 2, z));
    b.add(P.cyl(0.036, 0.036, 0.04, 6), { color: K.rope }, at(x, h - 0.12, z));
  }
  b.add(P.box(W + 0.08, 0.045, 0.045), { color: K.timberDark }, at(0, hf - 0.03, D / 2));
  // Canopy: cloth sloping from the back beam over the front, with a coloured stripe and valance.
  const tilt = Math.atan2(hb - hf, D), len = Math.hypot(D, hb - hf) + 0.2;
  // In five strips down the slope: cloth, stripe, cloth, stripe, cloth (no overlapping faces).
  const roof = at(0, (hf + hb) / 2 + 0.02, 0, tilt, 0, 0);
  for (let k = 0; k < 5; k++) {
    const col = stripe && k % 2 ? stripe : cloth;
    b.add(P.box(W + 0.18, 0.025, len / 5 + 0.001), { color: col, leaf: 0.15 }, roof.clone().multiply(M.t(0, 0, -len / 2 + (k + 0.5) * (len / 5))));
  }
  b.add(P.box(W + 0.18, 0.09, 0.02), { color: stripe ?? cloth.clone().multiplyScalar(0.8) }, at(0, hf - 0.06, D / 2 + 0.1));
  // Counter with goods, a rug in front for a seated trader.
  b.add(P.box(W - 0.08, 0.05, 0.36), { color: K.timber }, at(0, 0.36, 0.02));
  for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) b.add(P.box(0.05, 0.34, 0.3), { color: K.timberDark }, at(x, 0.17, 0.02));
  if (goods === 'fruit') {
    for (const [x, col] of [[-0.3, [0xd8572a, 0xf2a93a]], [0.02, [0x6aa83a, 0x9fc94a]], [0.32, [0xe8c23a, 0xd8352a]]] as const) {
      b.add(P.box(0.24, 0.08, 0.2), { color: K.timber }, at(x, 0.43, 0.02));
      for (let k = 0; k < 5; k++) b.add(P.sphere(0.04, 0), { color: col[k % 2] }, at(x + rng.range(-0.08, 0.08), 0.49, 0.02 + rng.range(-0.06, 0.06)));
    }
  } else if (goods === 'pots') {
    for (const x of [-0.32, -0.08, 0.18, 0.38]) b.add(P.uvSphere(0.075, 8, 6), { color: x > 0 ? AD.pot : c(0x9c4a2c) }, at(x, 0.47, 0.02, 0, 0, 0, 1, 1.2, 1));
  } else if (goods === 'fish') {
    for (let k = 0; k < 5; k++) b.add(P.uvSphere(0.05, 7, 5), { color: k % 2 ? c(0x7f97a8) : c(0x6a8496) }, at(-0.35 + k * 0.17, 0.41, 0.02, 0, 0.2, 0, 2.2, 0.55, 1));
    b.add(P.box(0.32, 0.12, 0.2), { color: K.rope }, at(0.3, 0.06, 0.4));
  } else if (goods === 'cloth') {
    for (let k = 0; k < 4; k++) b.add(P.box(0.2, 0.06, 0.26), { color: [0xb2412f, 0x3f6f9a, 0xd7a53e, 0x237a74][k] }, at(-0.33 + k * 0.22, 0.42, 0.02));
  } else {
    for (let k = 0; k < 6; k++) b.add(P.cyl(0.025, 0.03, 0.15, 6), { color: k % 2 ? c(0xf2c53a) : c(0xe8a526) }, at(-0.36 + k * 0.14, 0.42, 0.02, Math.PI / 2, 0.3 * k, 0));
  }
  // Hung from the front beam: maize bundles, or woven cloth.
  for (const x of [-0.38, 0.4]) {
    if (goods === 'cloth' || goods === 'pots') b.add(P.box(0.16, 0.3, 0.012), { color: [0xb2412f, 0x3f6f9a, 0x237a74][Math.round(rng.range(0, 2))], sway: 0.3 }, at(x, hf - 0.22, D / 2 + 0.02));
    else for (let k = 0; k < 3; k++) b.add(P.cyl(0.022, 0.016, 0.14, 5), { color: c(0xf2c53a), sway: 0.3 }, at(x + (k - 1) * 0.035, hf - 0.16, D / 2 + 0.02));
  }
  // Jars and a basket beside the counter.
  b.add(P.uvSphere(0.08, 8, 6), { color: AD.pot }, at(W / 2 + 0.05, 0.09, 0.35, 0, 0, 0, 1, 1.2, 1));
  b.add(P.cyl(0.09, 0.07, 0.1, 8), { color: K.rope }, at(-W / 2 - 0.02, 0.05, 0.38));
}

/**
 * Market Square: a raised square paved in sandstone behind a low wall, climbed by front steps between
 * carved pillars carrying fire bowls (and fire bowls on the back corners too), a red stepped
 * diamond set into the middle of the paving, and seven stalls round the sides under cream, red,
 * blue, teal and gold canopies (fruit, pots, fish, cloth and maize), with a woven rug laid out and
 * planting round the walls. The middle stays open: islanders walk straight through.
 */
export function marketSquareModel(): BuildingModel {
  const b = new GeoBuilder(), rng = new RNG(305);
  const H = 0.14, E = 2.25;
  b.add(qbox(4.84, H, 4.84, 0.03, 1), { color: CUT.stoneDark }, M.t(0, H / 2, 0));
  flagstones(b, -E, -E, 11, 11, (2 * E) / 11, H, (i, j) => ((i * 5 + j * 7) % 6 === 0 ? c(0xc9b494) : (i + j) % 2 ? c(0xe2d0ad) : c(0xd6c29f)));
  // The red stepped diamond in the middle.
  for (const [s, col] of [[1.25, c(0xc9634a)], [0.95, c(0xe9d8b4)], [0.7, c(0xb2412f)], [0.38, c(0xe9d8b4)], [0.18, c(0xb2412f)]] as const) {
    b.add(P.box(s, 0.01, s), { color: col }, M.t(0, H + 0.03 + (1.25 - s) * 0.02, 0.1, 0, Math.PI / 4, 0));
  }
  // Low wall round the edge, open at the front for the steps.
  const wallH = 0.22, t = 0.16;
  const wall = (x: number, z: number, w: number, d: number) => {
    b.add(qbox(w, wallH, d, 0.02, 1), { color: CUT.stone }, M.t(x, H + wallH / 2, z));
    b.add(P.box(w + 0.02, 0.035, d + 0.02), { color: CUT.stoneLight }, M.t(x, H + wallH, z));
  };
  wall(0, -E - 0.08, 2 * E + 0.3, t);
  wall(-E - 0.08, 0, t, 2 * E + 0.3);
  wall(E + 0.08, 0, t, 2 * E + 0.3);
  wall(-1.65, E + 0.08, 1.5, t);
  wall(1.65, E + 0.08, 1.5, t);
  // Front steps down from the square.
  for (let k = 0; k < 2; k++) b.add(P.box(1.62, H * (1 - k * 0.5), 0.12), { color: k ? CUT.stoneDark : CUT.stone }, M.t(0, (H * (1 - k * 0.5)) / 2, E + 0.06 + k * 0.12));
  // Carved pillars with fire bowls: either side of the steps and on the back corners.
  const torches: THREE.Vector3[] = [];
  for (const [x, z] of [[-0.95, E + 0.06], [0.95, E + 0.06], [-E - 0.05, -E - 0.05], [E + 0.05, -E - 0.05]] as const) {
    b.add(qbox(0.32, 0.6, 0.32, 0.02, 1), { color: CUT.stone }, M.t(x, H + 0.3, z));
    b.add(P.box(0.34, 0.06, 0.34), { color: K.red }, M.t(x, H + 0.47, z));
    b.add(P.box(0.36, 0.05, 0.36), { color: CUT.stoneLight }, M.t(x, H + 0.62, z));
    for (const [fx, fz, ry] of [[0, 0.161, 0], [0.161, 0, Math.PI / 2], [-0.161, 0, -Math.PI / 2]] as const) fretBand(b, M.t(x + fx, H + 0.25, z + fz, 0, ry, 0), 0.24, 0.16, CUT.stoneDark, K.red);
    // Fire bowls at the steps (the square's two lights); planters on the back corners.
    if (z > 0) torches.push(fireBowl(b, x, H + 0.645, z, 1.1));
    else pottedPlant(b, x, H + 0.645, z, 1.3);
  }
  // Seven stalls round the sides.
  marketStall(b, rng, M.t(-1.5, H, -1.72), STALL.cream, STALL.red, 'pots');
  marketStall(b, rng, M.t(0, H, -1.72), STALL.red, undefined, 'fruit');
  marketStall(b, rng, M.t(1.5, H, -1.72), STALL.cream, STALL.blue, 'maize');
  marketStall(b, rng, M.t(-1.72, H, -0.2, 0, Math.PI / 2, 0), STALL.cream, STALL.red, 'cloth');
  marketStall(b, rng, M.t(-1.72, H, 1.2, 0, Math.PI / 2, 0), STALL.blue, STALL.cream, 'fruit');
  marketStall(b, rng, M.t(1.72, H, -0.2, 0, -Math.PI / 2, 0), STALL.gold, undefined, 'fish');
  marketStall(b, rng, M.t(1.72, H, 1.2, 0, -Math.PI / 2, 0), STALL.teal, STALL.cream, 'fruit');
  // A woven rug laid out before the back stalls.
  for (let k = 0; k < 5; k++) b.add(P.box(0.8, 0.008, 0.11), { color: [0xb2412f, 0xd7a53e, 0x3f6f9a, 0xd7a53e, 0xb2412f][k] }, M.t(-0.75, H + 0.025, -0.95 + k * 0.11, 0, 0.05, 0));
  // Planting along the outside of the walls.
  for (const [x, z] of [[-2.43, -1.2], [-2.43, 0.9], [2.43, -0.6], [2.43, 1.5]] as const) blooms(b, x, 0.02, z, 4, 0.02, 0.3, Math.round(x * 31 + z * 17));
  blooms(b, -1.4, 0.02, 2.43, 5, 0.3, 0.02, 77);
  blooms(b, 1.4, 0.02, 2.43, 5, 0.3, 0.02, 78);
  return { finished: b.build(), torches, height: 1.35 };
}

/**
 * A hull on the stocks: keel, curved stem and stern posts, U-shaped ribs, stringers and the lower
 * strakes planked (the upper half left open), on timber cradles. Lies along x, centred on x0, z0.
 */
function hullOnStocks(b: GeoBuilder, x0: number, z0: number, len: number, beam: number, keelY: number, sideH: number, planked: number, rng: RNG): void {
  const half = len / 2;
  const bw = (t: number) => (beam / 2) * Math.sqrt(Math.max(0, 1 - t * t));
  // Cradles: a pair of shores each side and a sleeper under the keel.
  for (const t of [-0.55, 0, 0.55]) {
    const x = x0 + t * half;
    b.add(P.box(0.08, 0.06, beam + 0.3), { color: K.timberDark }, M.t(x, 0.11, z0));
    b.add(P.box(0.09, keelY - 0.1, 0.12), { color: K.timber }, M.t(x, (keelY + 0.1) / 2, z0));
    for (const s of [-1, 1]) b.add(P.box(0.05, keelY + 0.12, 0.05), { color: K.timberDark }, M.t(x, keelY * 0.6 + 0.08, z0 + s * (bw(t) + 0.09), s * 0.32, 0, 0));
  }
  // Keel and the stem and stern posts sweeping up.
  b.add(P.box(len * 0.9, 0.06, 0.07), { color: K.timberDark }, M.t(x0, keelY, z0));
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const a = (k / 3) * 1.2;
      b.add(P.box(0.08, 0.1, 0.06), { color: K.timberDark }, M.t(x0 + s * (half * 0.9 + Math.sin(a) * 0.12), keelY + 0.04 + (1 - Math.cos(a)) * 0.2 + k * 0.06, z0, 0, 0, -s * a));
    }
  }
  // Ribs: a floor across the keel and a curved futtock up each side.
  const n = Math.max(6, Math.round(len / 0.2));
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * 1.7 - 0.85, x = x0 + t * half, w = bw(t);
    b.add(P.box(0.045, 0.04, w * 1.5), { color: K.timber }, M.t(x, keelY + 0.04, z0));
    for (const s of [-1, 1]) {
      b.add(P.box(0.045, sideH * 0.55, 0.045), { color: K.timber }, M.t(x, keelY + sideH * 0.22, z0 + s * w * 0.8, -s * 0.75, 0, 0));
      b.add(P.box(0.045, sideH * 0.62, 0.045), { color: i % 2 ? K.timber : c(0x9a7550) }, M.t(x, keelY + sideH * 0.68, z0 + s * w, -s * 0.12, 0, 0));
    }
  }
  // Gunwale stringers and the planked lower strakes (as far as the shipwrights have got).
  for (const s of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      const t0 = -0.88 + k * 0.3, t1 = t0 + 0.3, tm = (t0 + t1) / 2;
      const ax = x0 + tm * half, w = bw(tm);
      const ang = Math.atan2(s * (bw(t1) - bw(t0)), (t1 - t0) * half);
      b.add(P.box((t1 - t0) * half + 0.02, 0.04, 0.035), { color: K.timberDark }, M.t(ax, keelY + sideH, z0 + s * w, 0, -ang, 0));
      if (tm < -0.88 + planked * 1.76) {
        for (const [f, sh] of [[0.32, 0.62], [0.55, 0.85]] as const) {
          b.add(P.box((t1 - t0) * half + 0.015, sideH * 0.24, 0.03), { color: (k + f * 10) % 2 > 1 ? K.timber : c(0x9a7550) }, M.t(ax, keelY + sideH * f, z0 + s * w * sh, -s * (0.5 - f * 0.6), -ang, 0));
        }
      }
    }
  }
  // Shavings under the hull.
  for (let k = 0; k < 10; k++) b.add(P.box(0.08, 0.01, 0.02), { color: c(0xd9b47c) }, M.t(x0 + rng.range(-half, half), 0.1, z0 + rng.range(-beam * 0.7, beam * 0.7), 0, rng.range(0, 6), 0));
}

/** A finished canoe resting on two trestles (along x). */
function canoeOnTrestles(b: GeoBuilder, x0: number, z0: number, len: number, y: number): void {
  for (const s of [-1, 1]) {
    const x = x0 + s * len * 0.28;
    b.add(P.box(0.06, 0.05, 0.42), { color: K.timberDark }, M.t(x, y - 0.03, z0));
    for (const t of [-1, 1]) b.add(P.box(0.04, y, 0.04), { color: K.timberDark }, M.t(x, y / 2, z0 + t * 0.17, t * 0.25, 0, 0));
  }
  const body = new THREE.CylinderGeometry(0.16, 0.16, len, 10, 1, false, Math.PI / 2, Math.PI);
  b.add(body, { color: (p) => (p.y < -0.1 ? c(0x5e3b22) : c(0x8a5e3a)) }, M.t(x0, y + 0.15, z0, 0, 0, Math.PI / 2, 1, 1, 0.9));
  b.add(P.box(len * 0.98, 0.03, 0.04), { color: K.red }, M.t(x0, y + 0.15, z0 + 0.145));
  b.add(P.box(len * 0.98, 0.03, 0.04), { color: K.red }, M.t(x0, y + 0.15, z0 - 0.145));
  for (const s of [-1, 1]) b.add(P.cone(0.13, 0.22, 6), { color: c(0x7a5233) }, M.t(x0 + s * (len / 2 + 0.09), y + 0.1, z0, 0, 0, -s * Math.PI / 2, 1, 1, 0.9));
}

/**
 * Coastal boatyard: a cut-stone workshop with a red stepped-fret frieze, its open front shaded by a
 * red and cream striped awning over the workbenches. A big hull stands on the stocks in the paved
 * court with a ladder up its side; a timber lean-to of barrels and crates on the left, and from the
 * second research level an open shed with a lifting crane over a finished canoe on the right. Rope
 * rails and a slipway run along the front; red sun banners and a stack of seasoned logs come with
 * the third level. Door faces +z.
 */
export function boatWorkshopModel(tier = 1): BuildingModel {
  const b = new GeoBuilder(), rng = new RNG(417);
  const sand = c(0xc9ad84);
  b.add(qbox(3.9, 0.08, 3.9, 0.03, 1), { color: sand }, M.t(0, 0.04, 0));
  // Paved court with the odd darker flag.
  flagstones(b, -1.75, -1.0, 10, 7, 0.35, 0.08, (i, j) => ((i * 7 + j * 3) % 5 === 0 ? CUT.stoneDark : (i + j) % 2 ? c(0xcfb898) : c(0xc3ab8a)));
  // The workshop at the back: cut stone, red fret frieze, an open front onto the court.
  const wx = -0.2, wz = -1.45, ww = 2.7, wd = 0.9, wh = 1.15;
  stoneBlock(b, ww, wh, wd, wx, 0.08, wz);
  fretBand(b, M.t(wx, 0.08 + wh - 0.16, wz + wd / 2 + 0.004), ww - 0.06, 0.13, K.red, AD.cream);
  fretBand(b, M.t(wx - ww / 2 - 0.004, 0.08 + wh - 0.16, wz, 0, -Math.PI / 2, 0), wd - 0.06, 0.13, K.red, AD.cream);
  b.add(P.box(2.0, 0.7, 0.03), { color: c(0x3b2a20) }, M.t(wx + 0.05, 0.08 + 0.38, wz + wd / 2 + 0.008));
  for (const x of [wx - 1.0, wx + 1.1]) b.add(P.box(0.14, 0.78, 0.1), { color: CUT.stoneLight }, M.t(x, 0.08 + 0.39, wz + wd / 2 + 0.03));
  // Striped awning over the workbenches, which carry tools, timber offcuts and a pot of pitch.
  awning(b, wx + 0.05, 1.0, wz + wd / 2, 2.3, 0.62, true);
  for (const x of [-1.0, -0.2, 0.6]) {
    b.add(P.box(0.62, 0.05, 0.3), { color: K.timber }, M.t(x, 0.42, -0.75));
    for (const s of [-1, 1]) for (const t of [-1, 1]) b.add(P.box(0.04, 0.34, 0.04), { color: K.timberDark }, M.t(x + s * 0.26, 0.25, -0.75 + t * 0.11));
    b.add(P.box(0.24, 0.04, 0.08), { color: c(0x9a7550) }, M.t(x - 0.1, 0.47, -0.78, 0, 0.3, 0));
    b.add(P.box(0.03, 0.03, 0.18), { color: K.timberDark }, M.t(x + 0.15, 0.46, -0.72, 0, -0.6, 0));
  }
  b.add(P.cyl(0.06, 0.05, 0.1, 8), { color: c(0x2a2420) }, M.t(0.95, 0.47, -0.78));
  // Sacks and a crate up on the roof.
  for (const [x, z] of [[-0.9, -1.55], [-0.62, -1.4]]) b.add(P.uvSphere(0.1, 7, 5), { color: c(0xd8c08a) }, M.t(x, 1.33, z, 0, 0, 0, 1.2, 0.75, 1));
  crate(b, 0.55, 1.25, -1.5, 0.28, 0.16, 0.22);
  // Timber lean-to on the left: barrels, crates and planks.
  for (const [x, z, h] of [[-1.85, -0.95, 1.05], [-1.85, 0.15, 0.85], [-1.2, -0.95, 1.05], [-1.2, 0.15, 0.85]] as const) b.add(P.cyl(0.035, 0.04, h, 6), { color: K.timberDark }, M.t(x, h / 2, z));
  slatRoof(b, -1.52, 0.98, -0.4, 0.82, 1.3, 0.16, rng);
  barrel(b, -1.72, 0.08, -0.6);
  barrel(b, -1.55, 0.08, -0.72, 0.9);
  crate(b, -1.4, 0.08, -0.15, 0.3, 0.22, 0.26, undefined, 0.2);
  for (let k = 0; k < 4; k++) b.add(P.box(0.1, 0.045, 0.95), { color: k % 2 ? K.timber : c(0x9a7550) }, M.t(-1.85 + k * 0.11, 0.11 + (k % 2) * 0.03, -0.35));
  // The big hull on the stocks, with a ladder up its near side.
  hullOnStocks(b, -0.35, 0.35, 2.05, 0.72, 0.36, 0.46, 0.8, rng);
  ladder(b, 0.15, 0.95, 0.82, Math.PI, 0.35);
  // Rope rails along the front on short posts, a gap for the slipway.
  for (const [x0, x1] of [[-1.85, -0.45], [0.45, 1.85]] as const) {
    const n = Math.round((x1 - x0) / 0.36);
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n;
      b.add(P.cyl(0.04, 0.045, 0.3, 6), { color: K.timberDark }, M.t(x, 0.15, 1.6));
      b.add(P.cyl(0.046, 0.046, 0.03, 6), { color: K.rope }, M.t(x, 0.24, 1.6));
    }
    b.add(P.cyl(0.012, 0.012, x1 - x0, 4), { color: K.rope }, M.t((x0 + x1) / 2, 0.22, 1.6, 0, 0, Math.PI / 2));
  }
  // Slipway: two greased runners and cross-sleepers running down to the shore.
  for (let k = 0; k < 6; k++) b.add(P.box(0.62, 0.04, 0.07), { color: K.timberDark }, M.t(0, 0.1 - k * 0.012, 1.25 + k * 0.13));
  for (const s of [-1, 1]) b.add(P.box(0.08, 0.06, 0.82), { color: K.timber }, M.t(s * 0.22, 0.11 - 0.035, 1.58, 0.06, 0, 0));
  if (tier >= 2) {
    // Open shed with a lifting crane over a finished canoe.
    for (const [x, z, h] of [[0.95, -0.95, 1.1], [1.8, -0.95, 1.1], [0.95, 0.75, 0.9], [1.8, 0.75, 0.9]] as const) b.add(P.cyl(0.04, 0.045, h, 6), { color: K.timberDark }, M.t(x, h / 2, z));
    slatRoof(b, 1.38, 1.03, -0.1, 0.98, 1.85, 0.12, rng);
    canoeOnTrestles(b, 1.33, 0.0, 0.76, 0.32);
    b.add(P.cyl(0.05, 0.055, 1.75, 6), { color: K.timberDark }, M.t(1.8, 0.875, 0.95));
    b.add(P.box(1.0, 0.06, 0.06), { color: K.timberDark }, M.t(1.42, 1.7, 0.95, 0, 0, -0.08));
    b.add(P.box(0.05, 0.6, 0.05), { color: K.timber }, M.t(1.72, 1.42, 0.95, 0, 0, 0.75));
    b.add(P.cyl(0.006, 0.006, 1.1, 3), { color: K.rope }, M.t(1.0, 1.15, 0.95));
    b.add(P.cyl(0.04, 0.04, 0.04, 8), { color: K.timberDark }, M.t(1.0, 1.66, 0.95, Math.PI / 2, 0, 0));
    barrel(b, 1.75, 0.08, -0.7);
  }
  if (tier >= 3) {
    // Seasoned logs stacked by the slipway, and red sun banners on the corners.
    for (let k = 0; k < 5; k++) b.add(P.cyl(0.07, 0.07, 0.95, 7), { color: k % 2 ? K.timber : c(0x7a5233) }, M.t(1.2 + (k % 3) * 0.15 + (k >= 3 ? 0.075 : 0), 0.15 + (k >= 3 ? 0.12 : 0), 1.25, Math.PI / 2, 0, Math.PI / 2));
    bannerPole(b, -1.8, 0.6, 1.35, Math.PI / 2);
    bannerPole(b, 1.8, 1.35, 1.35, -Math.PI / 2);
  }
  return { finished: b.build(), torches: [], height: 2.0 };
}

// ---------------- Tlatoani's Palace ----------------

/** A box whose top is a smaller rectangle than its base (the sloping talud of a platform), centred on its mid-height. */
function frustumBox(w0: number, d0: number, w1: number, d1: number, h: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, h, 1);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    p.setXYZ(i, p.getX(i) * (top ? w1 : w0), p.getY(i), p.getZ(i) * (top ? d1 : d0));
  }
  g.computeVertexNormals();
  return g;
}

/** Palace colours: the Great Hall's sandstone and cream plaster, red and turquoise paint and gold. */
const PAL = {
  sand: c(0xdcb57c),
  sandDark: c(0xc39a62),
  // Warm lime plaster (reads as plastered adobe, not grey stone, in shade).
  plaster: c(0xf0d6a6),
  plasterShade: c(0xe3c491),
  red: c(0xa64032),
  redDeep: c(0x8e2a22),
  turquoise: c(0x227f80),
  gold: c(0xc8a451),
  water: c(0x2f8a92),
  plume: c(0x1f8a5a),
  plumeLight: c(0x3fb36e),
};

/**
 * Tlatoani's Palace: the ruler's house, a raised palace round an open courtyard, twice the Great
 * Hall's size (14 × 14). A two-tiered sandstone platform (sloping talud under upright tablero
 * panels picked out in red) carries it, climbed by a grand central stair between balustrades
 * that end in feathered-serpent heads. Across the front runs a portico of red-and-cream columns
 * under a frieze of golden stepped frets, with a taller entrance pavilion bearing a sun disc; side
 * ranges of rooms enclose a garden courtyard with a pool and fountain; the throne hall at the back
 * rises a second storey to a crest with a great golden sun and quetzal-feather fans. Stepped
 * merlons line every roof. In the plaza before it lie two lily pools, braziers and banners.
 * Built in four phases (platform, stair and plaza, halls, roofs and gardens), like the Great Temple.
 */
export function palaceModel(): BuildingModel {
  const b = new GeoBuilder();
  const rng = new RNG(1414);
  const torches: THREE.Vector3[] = [];
  const S = PAL;
  const masonry = (p: THREE.Vector3, n: THREE.Vector3) =>
    (n.y > 0.5 ? S.sand : S.sandDark).clone().multiplyScalar(0.97 + 0.035 * Math.sin(Math.floor(p.x * 3) * 21 + Math.floor(p.z * 3) * 13 + Math.floor(p.y * 4) * 7));
  const H = PALACE.h, CZ = PALACE.cz, TW = PALACE.topW, TD = PALACE.topD;
  const top = { x0: -TW / 2, x1: TW / 2, z0: CZ - TD / 2, z1: CZ + TD / 2 };

  // ---- Phase 1: the paved plaza and the two-tiered platform ----
  b.add(P.box(13.9, 0.012, 13.9), { color: c(0x9c917f) }, M.t(0, 0.056, 0));
  const pave = (i: number, j: number) => c(0xcfc5b3).lerp(c(0xa39683), ((i * 7 + j * 13) % 5) / 6 + rng.range(0, 0.15));
  const pools = PALACE.pools;
  slabs(b, -6.95, -6.95, 20, 20, 13.9 / 20, 0.064, 0.028, pave, (x, z) =>
    (Math.abs(x) < 6.0 && z > CZ - 5.35 && z < CZ + 5.35) || (Math.abs(x) < 2.0 && z < PALACE.stairFoot + 0.2) ||
    pools.some((p) => Math.abs(x - p.x) < p.w / 2 + 0.25 && Math.abs(z - p.z) < p.d / 2 + 0.25));
  // Lower tier: talud and tablero; upper tier set back on it.
  const tier = (w: number, d: number, y: number, tal: number, tab: number, inset: number) => {
    b.add(frustumBox(w, d, w - inset * 2, d - inset * 2, tal), { color: masonry }, M.t(0, y + tal / 2, CZ));
    const tw = w - inset * 2, td = d - inset * 2, ty = y + tal;
    b.add(P.box(tw, tab, td), { color: S.sand }, M.t(0, ty + tab / 2, CZ));
    b.add(P.box(tw + 0.08, 0.05, td + 0.08), { color: S.sandDark }, M.t(0, ty + tab + 0.025, CZ));
    // Recessed red panels framed in cream along each tablero (kept clear of the stair).
    for (let side = 0; side < 4; side++) {
      const ry = (side * Math.PI) / 2, along = side % 2 ? td : tw, out = side % 2 ? tw / 2 : td / 2;
      const n = Math.max(2, Math.round(along / 1.25));
      for (let k = 0; k < n; k++) {
        const u = -along / 2 + (along / n) * (k + 0.5);
        if (side === 0 && Math.abs(u) < 2.0) continue;
        const m = M.t(Math.sin(ry) * (out + 0.01), ty + tab / 2, CZ + Math.cos(ry) * (out + 0.01), 0, ry, 0).multiply(M.t(u, 0, 0));
        b.add(P.box(along / n - 0.2, tab * 0.62, 0.02), { color: S.plaster }, m);
        b.add(P.box(along / n - 0.34, tab * 0.38, 0.026), { color: S.red }, m.clone().multiply(M.t(0, 0, 0.002)));
      }
    }
    return ty + tab + 0.05;
  };
  const y1 = tier(11.7, 10.4, 0.07, 0.28, 0.3, 0.16);
  tier(11.0, 9.7, y1, 0.18, 0.26, 0.1);
  // The floor of the palace: cream plaster over the whole top.
  b.add(P.box(TW, 0.03, TD), { color: S.plaster }, M.t(0, H - 0.015, CZ));
  const phases = [b.indexCount];

  // ---- Phase 2: the grand stair, its serpent balustrades and the plaza ----
  const front = top.z1, foot = PALACE.stairFoot, half = PALACE.stairHalf;
  const steps = 12, run = (foot - front) / steps, rise = H / steps;
  for (let k = 0; k < steps; k++) {
    const h = H - k * rise, z = front + run * (k + 0.5);
    b.add(P.box(half * 2, h - 0.025, run + 0.01), { color: S.red }, M.t(0, (h - 0.025) / 2, z));
    b.add(P.box(half * 2 + 0.02, 0.025, run + 0.02), { color: S.plaster }, M.t(0, h - 0.0125, z));
  }
  // Balustrades (alfardas): sloping stone cheeks with a turquoise stripe, a serpent head at the foot.
  const cheek = new THREE.ExtrudeGeometry(new THREE.Shape([
    new THREE.Vector2(front - 0.3, 0), new THREE.Vector2(foot + 0.05, 0), new THREE.Vector2(foot + 0.05, 0.2), new THREE.Vector2(front - 0.3, H + 0.22),
  ]), { depth: 0.36, bevelEnabled: false });
  const slope = Math.atan2(H + 0.02, foot - front + 0.35), slopeLen = Math.hypot(H + 0.02, foot - front + 0.35);
  for (const sx of [-1, 1]) {
    const x = sx * (half + 0.18);
    b.add(cheek, { color: S.sandDark }, M.t(x + 0.18, 0, 0, 0, -Math.PI / 2, 0));
    b.add(P.box(0.12, 0.02, slopeLen), { color: S.turquoise }, M.t(x, (H + 0.42) / 2 + 0.01, (front - 0.3 + foot + 0.05) / 2, slope, 0, 0));
    // Feathered-serpent head: snout forward, jaws open on a red tongue, gold eyes, a turquoise crest.
    const hz = foot + 0.2, hy = 0.2;
    b.add(P.rbox(0.42, 0.3, 0.5, 0.06), { color: S.sand }, M.t(x, hy + 0.15, hz));
    b.add(P.rbox(0.36, 0.1, 0.3, 0.03), { color: S.sandDark }, M.t(x, hy + 0.02, hz + 0.2));
    b.add(P.box(0.08, 0.025, 0.18), { color: S.red }, M.t(x, hy + 0.08, hz + 0.32));
    for (const ex of [-1, 1]) {
      b.add(P.box(0.08, 0.07, 0.03), { color: S.gold }, M.t(x + ex * 0.13, hy + 0.24, hz + 0.25));
      b.add(P.box(0.04, 0.12, 0.04), { color: S.plaster }, M.t(x + ex * 0.1, hy + 0.06, hz + 0.33));
    }
    for (let k = 0; k < 5; k++) b.add(P.box(0.06, 0.16, 0.06), { color: k % 2 ? S.turquoise : S.plume }, M.t(x - 0.16 + k * 0.08, hy + 0.36, hz - 0.12, -0.5, 0, 0));
  }
  // Braziers: at the stair head and on stone pedestals at its foot.
  const brazier = (x: number, y: number, z: number, s = 1) => {
    b.add(P.box(0.46 * s, 0.14 * s, 0.46 * s), { color: S.sandDark }, M.t(x, y + 0.07 * s, z));
    b.add(P.box(0.3 * s, 0.32 * s, 0.3 * s), { color: S.sand }, M.t(x, y + 0.3 * s, z));
    b.add(P.box(0.5 * s, 0.08 * s, 0.5 * s), { color: S.gold }, M.t(x, y + 0.5 * s, z));
    b.add(P.cyl(0.22 * s, 0.13 * s, 0.13 * s, 10), { color: c(0x7d746c) }, M.t(x, y + 0.6 * s, z));
    b.add(P.cyl(0.19 * s, 0.19 * s, 0.02, 10), { color: c(0xa16c3e) }, M.t(x, y + 0.665 * s, z));
    torches.push(new THREE.Vector3(x, y + 0.68 * s, z));
  };
  for (const sx of [-1, 1]) {
    brazier(sx * (half + 0.18), H, front - 0.15, 0.85);
    brazier(sx * 2.45, 0.07, foot + 0.15);
  }
  /** A stone kerb round a pool (w × d inside), capped in a second colour. */
  const rim = (x: number, y: number, z: number, w: number, d: number, h: number, col: THREE.Color, cap: THREE.Color) => {
    const t = 0.14;
    for (const s of [-1, 1]) {
      b.add(P.box(w + 2 * t, h, t), { color: col }, M.t(x, y + h / 2, z + s * (d / 2 + t / 2)));
      b.add(P.box(t, h, d), { color: col }, M.t(x + s * (w / 2 + t / 2), y + h / 2, z));
      b.add(P.box(w + 2 * t + 0.04, 0.035, t + 0.04), { color: cap }, M.t(x, y + h + 0.017, z + s * (d / 2 + t / 2)));
      b.add(P.box(t + 0.04, 0.035, d), { color: cap }, M.t(x + s * (w / 2 + t / 2), y + h + 0.017, z));
    }
  };
  // Lily pools either side of the approach: stone rims, still water, pads and pink blooms.
  for (const p of pools) {
    b.add(P.box(p.w, 0.11, p.d), { color: S.sandDark }, M.t(p.x, 0.055, p.z));
    b.add(P.box(p.w, 0.02, p.d), { color: S.water }, M.t(p.x, 0.12, p.z));
    rim(p.x, 0, p.z, p.w, p.d, 0.18, S.sandDark, S.plaster);
    for (let k = 0; k < 9; k++) {
      const px = p.x + rng.range(-p.w / 2 + 0.15, p.w / 2 - 0.15), pz = p.z + rng.range(-p.d / 2 + 0.15, p.d / 2 - 0.15);
      b.add(P.cyl(0.11, 0.11, 0.008, 8), { color: c(0x3f8a34), leaf: 1 }, M.t(px, 0.135, pz));
      if (k % 3 === 0) b.add(FLOWER, { color: c(0xef9ab0), leaf: 1 }, M.t(px + 0.04, 0.16, pz, 0, k, 0, 0.9, 0.6, 0.9));
    }
  }
  // Banner poles at the plaza's front corners.
  for (const sx of [-1, 1]) {
    const x = sx * 6.35, z = 6.35;
    b.add(P.box(0.3, 0.2, 0.3), { color: S.sandDark }, M.t(x, 0.1, z));
    b.add(P.cyl(0.04, 0.05, 2.3, 6), { color: K.timberDark }, M.t(x, 1.25, z));
    b.add(P.box(0.46, 0.04, 0.04), { color: K.timberDark }, M.t(x, 2.2, z));
    sunBanner(b, M.t(x, 1.72, z + 0.04), 0.38, 0.86, true);
    plumes(b, x, 2.4, z, 0.7);
  }
  phases.push(b.indexCount);

  // ---- Phase 3: the halls round the courtyard ----
  const WH = PALACE.wallH, T = 0.16, F = H;
  const plasterWall = (p: THREE.Vector3) => S.plaster.clone().lerp(S.plasterShade, Math.min(1, Math.max(0, (F + WH - p.y) / WH)) * 0.6);
  /** A wall along x (at z) or along z (at x), with doorway gaps given by their centres. */
  const wall = (axis: 'x' | 'z', at: number, from: number, to: number, h: number, doors: (number | [number, number, number])[], dw0: number, dh0: number, y = F) => {
    const cuts = doors.map((d) => (typeof d === 'number' ? [d - dw0 / 2, d + dw0 / 2, dh0] : [d[0] - d[1] / 2, d[0] + d[1] / 2, d[2]])).sort((a, b) => a[0] - b[0]);
    let u = from;
    const piece = (u0: number, u1: number, y0: number, hh: number) => {
      if (u1 - u0 < 0.01 || hh <= 0) return;
      const mid = (u0 + u1) / 2, len = u1 - u0;
      b.add(P.box(axis === 'x' ? len : T, hh, axis === 'x' ? T : len), { color: plasterWall }, axis === 'x' ? M.t(mid, y0 + hh / 2, at) : M.t(at, y0 + hh / 2, mid));
    };
    for (const [c0, c1, dh] of cuts) {
      const dw = c1 - c0;
      piece(u, c0, y, h);
      piece(c0, c1, y + dh, h - dh);
      // Dark doorway with a stone lintel.
      const mid = (c0 + c1) / 2;
      b.add(P.box(axis === 'x' ? dw : T * 0.4, dh, axis === 'x' ? T * 0.4 : dw), { color: K.door }, axis === 'x' ? M.t(mid, y + dh / 2, at) : M.t(at, y + dh / 2, mid));
      b.add(P.box(axis === 'x' ? dw + 0.16 : T + 0.06, 0.07, axis === 'x' ? T + 0.06 : dw + 0.16), { color: S.sand }, axis === 'x' ? M.t(mid, y + dh + 0.035, at) : M.t(at, y + dh + 0.035, mid));
      u = c1;
    }
    piece(u, to, y, h);
    // Red dado round the foot.
    b.add(P.box(axis === 'x' ? to - from : T + 0.02, 0.16, axis === 'x' ? T + 0.02 : to - from), { color: S.redDeep }, axis === 'x' ? M.t((from + to) / 2, y + 0.08, at) : M.t(at, y + 0.08, (from + to) / 2));
  };
  const column = (x: number, z: number, h: number, y = F) => {
    b.add(P.box(0.4, 0.12, 0.4), { color: S.sandDark }, M.t(x, y + 0.06, z));
    b.add(P.box(0.3, h * 0.42, 0.3), { color: S.red }, M.t(x, y + 0.12 + h * 0.21, z));
    b.add(P.box(0.29, h * 0.5, 0.29), { color: S.plaster }, M.t(x, y + 0.12 + h * 0.42 + h * 0.25, z));
    b.add(P.box(0.32, 0.04, 0.32), { color: S.gold }, M.t(x, y + 0.12 + h * 0.42, z));
    b.add(P.box(0.42, 0.1, 0.42), { color: S.sand }, M.t(x, y + 0.12 + h * 0.92 + 0.05, z));
  };
  const C = PALACE.court;
  // Front range: a portico of ten columns before a wall with three doorways into the courtyard.
  const porticoZ = top.z1 - 0.3, colH = WH - 0.12;
  wall('x', C.z1, top.x0 + 0.1, top.x1 - 0.1, WH, [-2.9, [0, 1.2, 1.12], 2.9], 0.6, 0.9);
  for (let k = 0; k < 10; k++) {
    const x = -4.6 + k * (9.2 / 9);
    if (Math.abs(x) < 0.6) continue;
    column(x, porticoZ, colH);
  }
  for (const x of [-0.75, 0.75]) column(x, porticoZ, colH);
  // Gold-and-red sun banners hung between the front columns.
  for (const x of [-3.06, -1.53, 1.53, 3.06]) sunBanner(b, M.t(x, F + 0.9, C.z1 + 0.1), 0.34, 0.66);
  // Side ranges of rooms: outer and courtyard walls, doorways onto the court and windows out.
  for (const sx of [-1, 1]) {
    wall('z', sx * (top.x1 - 0.12), C.z0 - 0.05, C.z1, WH, [], 0, 0);
    wall('z', sx * C.x1, C.z0, C.z1, WH, [C.z0 + 1.2, C.z1 - 1.4], 0.55, 0.85);
    for (const z of [C.z0 + 0.4, C.z1 - 2.2]) {
      b.add(P.box(0.03, 0.22, 0.4), { color: K.door }, M.t(sx * (top.x1 - 0.12 + 0.08 * 1), F + 0.95, z));
      b.add(P.box(0.06, 0.04, 0.5), { color: S.sand }, M.t(sx * (top.x1 - 0.12 + 0.09), F + 0.82, z));
    }
    wall('x', C.z0 - 0.05, sx > 0 ? C.x1 : top.x0 + 0.1, sx > 0 ? top.x1 - 0.1 : -C.x1, WH, [], 0, 0);
  }
  // Throne hall across the back: tall walls, a loggia of six columns onto the court, the throne.
  const HB = PALACE.hall;
  wall('x', top.z0 + 0.12, top.x0 + 0.1, top.x1 - 0.1, HB.h, [], 0, 0);
  for (const sx of [-1, 1]) wall('z', sx * (top.x1 - 0.12), top.z0 + 0.12, C.z0 - 0.05, HB.h, [], 0, 0);
  for (const x of [-4.4, -2.65, -0.9, 0.9, 2.65, 4.4]) column(x, C.z0 - 0.2, HB.h - 0.12);
  // Dais and throne: stepped platform, a woven seat under a jaguar-skin throw, a tall gold back.
  const tz = top.z0 + 0.75;
  b.add(P.box(2.4, 0.12, 1.2), { color: S.sandDark }, M.t(0, F + 0.06, tz + 0.2));
  b.add(P.box(1.6, 0.12, 0.9), { color: S.sand }, M.t(0, F + 0.18, tz + 0.1));
  b.add(P.box(0.7, 0.28, 0.5), { color: K.timber }, M.t(0, F + 0.38, tz + 0.1));
  b.add(P.box(0.72, 0.03, 0.52), { color: c(0xd9a441) }, M.t(0, F + 0.535, tz + 0.1));
  for (let k = 0; k < 6; k++) b.add(P.box(0.06, 0.005, 0.05), { color: c(0x3a2a20) }, M.t(-0.25 + (k % 3) * 0.25, F + 0.552, tz + (k < 3 ? 0 : 0.2)));
  b.add(P.box(0.86, 1.05, 0.08), { color: S.gold }, M.t(0, F + 0.8, tz - 0.17));
  b.add(P.box(0.62, 0.8, 0.09), { color: S.red }, M.t(0, F + 0.82, tz - 0.17));
  b.add(P.cyl(0.18, 0.18, 0.02, 14), { color: S.gold }, M.t(0, F + 0.95, tz - 0.11, Math.PI / 2, 0, 0));
  // Wall hangings behind the throne.
  for (const x of [-1.6, 1.6]) sunBanner(b, M.t(x, F + 1.1, top.z0 + 0.21), 0.42, 0.9);
  // Courtyard: chequered floor, a pool with a fountain, planted corners.
  slabs(b, C.x0, C.z0 + 0.12, 10, 7, 0.7, F, 0.02, (i, j) => ((i + j) % 2 ? S.plasterShade.clone() : c(0xe2bd86)), (x, z) => Math.abs(x) < 1.35 && Math.abs(z - PALACE.pool.z) < 0.95);
  const PO = PALACE.pool;
  b.add(P.box(PO.w, 0.02, PO.d), { color: S.water }, M.t(0, F + 0.07, PO.z));
  rim(0, F, PO.z, PO.w, PO.d, 0.15, S.sand, S.turquoise);
  b.add(P.cyl(0.18, 0.24, 0.3, 8), { color: S.sand }, M.t(0, F + 0.25, PO.z));
  b.add(P.cyl(0.3, 0.14, 0.1, 10), { color: S.gold }, M.t(0, F + 0.44, PO.z));
  b.add(P.cyl(0.26, 0.26, 0.012, 10), { color: S.water }, M.t(0, F + 0.49, PO.z));
  phases.push(b.indexCount);

  // ---- Phase 4: roofs, frieze, merlons, crest, plumes and gardens ----
  const roofY = F + WH, roofT = 0.16;
  const slab = (x0: number, x1: number, z0: number, z1: number, y: number, t = roofT) => {
    b.add(P.box(x1 - x0, t, z1 - z0), { color: S.sand }, M.t((x0 + x1) / 2, y + t / 2, (z0 + z1) / 2));
    b.add(P.box(x1 - x0 + 0.06, 0.04, z1 - z0 + 0.06), { color: S.sandDark }, M.t((x0 + x1) / 2, y + 0.02, (z0 + z1) / 2));
  };
  slab(top.x0, top.x1, C.z1 - 0.1, top.z1 - 0.05, roofY);
  for (const sx of [-1, 1]) slab(sx > 0 ? C.x1 - 0.1 : top.x0, sx > 0 ? top.x1 : -C.x1 + 0.1, C.z0 - 0.15, C.z1 - 0.1, roofY);
  const hallY = F + HB.h;
  slab(top.x0, top.x1, top.z0, C.z0 - 0.05, hallY);
  /** A frieze of golden stepped frets (xicalcoliuhqui) on a red band, along x at z facing +z (or -z). */
  const frieze = (x0: number, x1: number, y: number, z: number, face: 1 | -1, h = 0.26) => {
    const len = x1 - x0, m = (x: number, yy: number, w: number, hh: number, col: THREE.Color, dz = 0.012) =>
      b.add(P.box(w, hh, 0.02), { color: col }, M.t(x, yy, z + face * dz));
    b.add(P.box(len, h, 0.03), { color: S.red }, M.t((x0 + x1) / 2, y, z));
    b.add(P.box(len + 0.04, 0.035, 0.05), { color: S.gold }, M.t((x0 + x1) / 2, y + h / 2 + 0.01, z));
    b.add(P.box(len + 0.04, 0.035, 0.05), { color: S.gold }, M.t((x0 + x1) / 2, y - h / 2 - 0.01, z));
    const u = 0.44, n = Math.floor(len / u);
    for (let k = 0; k < n; k++) {
      const cx = x0 + (len - n * u) / 2 + u * (k + 0.5), base = y - h / 2 + 0.05;
      for (let s = 0; s < 3; s++) m(cx - 0.15 + s * 0.06, base + 0.025 * (s + 1), 0.06, 0.05 * (s + 1), S.gold);
      m(cx + 0.06, base + 0.08, 0.035, 0.16, S.gold);
      m(cx + 0.11, base + 0.145, 0.1, 0.035, S.gold);
      m(cx + 0.145, base + 0.11, 0.035, 0.05, S.gold);
    }
  };
  // Lintel beams over the portico and the throne loggia, faced with the frieze.
  b.add(P.box(TW, 0.3, 0.42), { color: S.sand }, M.t(0, roofY - 0.15, top.z1 - 0.23));
  b.add(P.box(TW - 0.2, 0.3, 0.36), { color: S.sand }, M.t(0, hallY - 0.15, C.z0 - 0.2));
  frieze(top.x0 + 0.05, top.x1 - 0.05, roofY - 0.16, top.z1 - 0.005, 1);
  frieze(top.x0 + 0.1, top.x1 - 0.1, hallY - 0.16, C.z0 - 0.005, 1);
  // The back and the flanks: the fret frieze across the back, a red-and-gold band along the sides,
  // windows and sun banners on the throne hall's back wall.
  frieze(top.x0 + 0.05, top.x1 - 0.05, hallY - 0.16, top.z0 + 0.025, -1);
  for (const sx of [-1, 1]) {
    for (const [y, z0, z1] of [[roofY, C.z0, top.z1 - 0.05], [hallY, top.z0 + 0.05, C.z0]] as const) {
      const x = sx * (top.x1 - 0.025), mid = (z0 + z1) / 2, len = z1 - z0;
      b.add(P.box(0.03, 0.24, len), { color: S.red }, M.t(x, y - 0.16, mid));
      for (const dy of [-0.13, 0.13]) b.add(P.box(0.05, 0.035, len + 0.04), { color: S.gold }, M.t(x, y - 0.16 + dy, mid));
      for (let k = 0; k < Math.floor(len / 0.5); k++) b.add(P.box(0.04, 0.1, 0.1), { color: S.gold }, M.t(x + sx * 0.005, y - 0.16, z0 + 0.25 + k * 0.5, 0, 0, Math.PI / 4));
    }
    sunBanner(b, M.t(sx * 2.6, F + 1.05, top.z0 + 0.03, 0, Math.PI, 0), 0.42, 0.95);
    for (const x of [sx * 0.9, sx * 4.2]) {
      b.add(P.box(0.36, 0.26, 0.03), { color: K.door }, M.t(x, F + 1.45, top.z0 + 0.03));
      b.add(P.box(0.46, 0.05, 0.06), { color: S.sand }, M.t(x, F + 1.3, top.z0 + 0.02));
    }
  }
  /** Stepped merlons (almenas) along a roof edge, from (x0, z0) to (x1, z1). */
  const merlons = (x0: number, z0: number, x1: number, z1: number, y: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(len / 0.48)), ry = Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2;
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n, z = z0 + ((z1 - z0) * k) / n;
      b.add(P.box(0.24, 0.12, 0.1), { color: S.plaster }, M.t(x, y + 0.06, z, 0, ry, 0));
      b.add(P.box(0.15, 0.11, 0.1), { color: S.plaster }, M.t(x, y + 0.175, z, 0, ry, 0));
      b.add(P.box(0.07, 0.07, 0.11), { color: S.red }, M.t(x, y + 0.265, z, 0, ry, 0));
    }
  };
  const ry0 = roofY + roofT;
  merlons(top.x0 + 0.1, top.z1 - 0.1, top.x1 - 0.1, top.z1 - 0.1, ry0);
  for (const sx of [-1, 1]) {
    merlons(sx * (top.x1 - 0.1), top.z1 - 0.1, sx * (top.x1 - 0.1), C.z0 - 0.1, ry0);
    merlons(sx * C.x1, C.z1 - 0.15, sx * C.x1, C.z0 - 0.1, ry0);
  }
  const hy0 = hallY + roofT;
  merlons(top.x0 + 0.1, C.z0 - 0.1, top.x1 - 0.1, C.z0 - 0.1, hy0);
  merlons(top.x0 + 0.1, top.z0 + 0.1, top.x1 - 0.1, top.z0 + 0.1, hy0);
  // Entrance pavilion over the portico's centre: a raised block with a sun disc and its own merlons.
  const pv = { x: 1.45, z0: C.z1 - 0.1, z1: top.z1 - 0.05, y: ry0 };
  b.add(P.box(pv.x * 2, 0.6, pv.z1 - pv.z0), { color: plasterWall }, M.t(0, pv.y + 0.3, (pv.z0 + pv.z1) / 2));
  frieze(-pv.x, pv.x, pv.y + 0.3, pv.z1 + 0.005, 1, 0.3);
  slab(-pv.x - 0.08, pv.x + 0.08, pv.z0 - 0.05, pv.z1 + 0.05, pv.y + 0.6, 0.12);
  merlons(-pv.x, pv.z1, pv.x, pv.z1, pv.y + 0.72);
  const sun = (x: number, y: number, z: number, r: number) => {
    b.add(P.cyl(r, r, 0.04, 18), { color: S.gold }, M.t(x, y, z, Math.PI / 2, 0, 0));
    b.add(P.cyl(r * 0.62, r * 0.62, 0.05, 16), { color: S.turquoise }, M.t(x, y, z + 0.01, Math.PI / 2, 0, 0));
    b.add(P.cyl(r * 0.36, r * 0.36, 0.06, 12), { color: S.gold }, M.t(x, y, z + 0.02, Math.PI / 2, 0, 0));
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      b.add(P.cone(r * 0.16, r * 0.42, 4), { color: S.gold }, M.t(x + Math.cos(a) * r * 1.18, y + Math.sin(a) * r * 1.18, z, 0, 0, a - Math.PI / 2));
    }
  };
  // Throne hall's upper storey and roof crest with the great sun and feather fans.
  const up = PALACE.upper;
  b.add(P.box(up.w, up.h, up.d), { color: plasterWall }, M.t(0, hy0 + up.h / 2, up.z));
  frieze(-up.w / 2, up.w / 2, hy0 + up.h - 0.18, up.z + up.d / 2 + 0.005, 1, 0.24);
  for (const x of [-1.5, -0.5, 0.5, 1.5]) {
    b.add(P.box(0.32, 0.4, 0.03), { color: K.door }, M.t(x, hy0 + 0.42, up.z + up.d / 2 + 0.005));
    b.add(P.box(0.42, 0.05, 0.06), { color: S.sand }, M.t(x, hy0 + 0.64, up.z + up.d / 2 + 0.02));
  }
  slab(-up.w / 2 - 0.1, up.w / 2 + 0.1, up.z - up.d / 2 - 0.1, up.z + up.d / 2 + 0.1, hy0 + up.h, 0.14);
  const crestY = hy0 + up.h + 0.14;
  merlons(-up.w / 2, up.z + up.d / 2, up.w / 2, up.z + up.d / 2, crestY);
  b.add(P.box(2.0, 0.9, 0.14), { color: S.red }, M.t(0, crestY + 0.45, up.z - 0.2));
  b.add(P.box(2.1, 0.06, 0.18), { color: S.gold }, M.t(0, crestY + 0.93, up.z - 0.2));
  sun(0, crestY + 0.52, up.z - 0.11, 0.3);
  b.add(P.cyl(0.3, 0.3, 0.04, 18), { color: S.gold }, M.t(0, crestY + 0.52, up.z - 0.29, Math.PI / 2, 0, 0));
  b.add(P.cyl(0.18, 0.18, 0.05, 14), { color: S.turquoise }, M.t(0, crestY + 0.52, up.z - 0.3, Math.PI / 2, 0, 0));
  for (const sx of [-1, 1]) plumes(b, sx * 1.05, crestY + 0.96, up.z - 0.2, 1.0);
  // Quetzal-feather standards at the four corners of the roof.
  for (const sx of [-1, 1]) for (const [z, y] of [[top.z1 - 0.3, ry0], [top.z0 + 0.3, hy0]] as const) {
    const x = sx * (top.x1 - 0.3);
    b.add(P.cyl(0.035, 0.04, 0.9, 6), { color: K.timberDark }, M.t(x, y + 0.45, z));
    b.add(P.box(0.32, 0.5, 0.02), { color: S.red }, M.t(x - sx * 0.17, y + 0.62, z));
    b.add(P.box(0.32, 0.04, 0.03), { color: S.gold }, M.t(x - sx * 0.17, y + 0.88, z));
    plumes(b, x, y + 0.9, z, 0.6);
  }
  // Rooftop braziers flanking the pavilion and on the throne hall.
  for (const sx of [-1, 1]) {
    brazier(sx * 2.3, ry0, top.z1 - 0.55, 0.7);
    brazier(sx * 3.6, hy0, C.z0 - 0.5, 0.7);
  }
  // Courtyard garden: planters in the corners and potted palms along the walls.
  const planter = (x: number, z: number, w: number, d: number, y: number, seed: number) => {
    b.add(P.box(w, 0.22, d), { color: S.sand }, M.t(x, y + 0.11, z));
    b.add(P.box(w + 0.03, 0.05, d + 0.03), { color: S.red }, M.t(x, y + 0.245, z));
    b.add(P.box(w - 0.08, 0.02, d - 0.08), { color: c(0x4a3624) }, M.t(x, y + 0.266, z));
    const long = Math.max(w, d), along = w >= d, n = Math.max(1, Math.round(long / 0.42));
    for (let k = 0; k < n; k++) {
      const u = -long / 2 + (long / n) * (k + 0.5);
      const px = along ? x + u : x + rng.range(-0.04, 0.04), pz = along ? z + rng.range(-0.06, 0.06) : z + u;
      if (k % 2) broadLeaf(b, px, y + 0.27, pz, 1.35 + rng.range(-0.2, 0.25), seed + k);
      else fern(b, px, y + 0.27, pz, 1.25 + rng.range(-0.15, 0.25), seed + k);
    }
    blooms(b, x, y + 0.26, z, Math.round(long * 9), w / 2 - 0.08, d / 2 - 0.08, seed + 50);
  };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) planter(sx * (C.x1 - 0.55), sz > 0 ? C.z1 - 0.45 : C.z0 + 0.45, 0.8, 0.6, F, 600 + sx * 3 + sz);
  for (const sx of [-1, 1]) {
    planter(sx * 1.9, PO.z, 0.5, 1.2, F, 640 + sx);
    // Long planters along the platform's flanks and beside the stair foot.
    planter(sx * 6.28, CZ - 1.5, 0.5, 3.6, 0.07, 660 + sx);
    planter(sx * 6.28, CZ + 2.8, 0.5, 1.6, 0.07, 670 + sx);
  }
  phases.push(b.indexCount);
  const finished = b.build();
  finished.userData.constructionPhases = phases;
  return { finished, torches, height: crestY + 1.1 };
}

/** A fan of quetzal feathers rising from a gold mount (centre at its base). */
function plumes(b: GeoBuilder, x: number, y: number, z: number, s: number): void {
  b.add(P.cyl(0.05 * s, 0.07 * s, 0.08 * s, 8), { color: PAL.gold }, M.t(x, y + 0.04 * s, z));
  for (let k = 0; k < 7; k++) {
    const a = (k - 3) * 0.28;
    b.add(P.box(0.06 * s, 0.5 * s, 0.015), { color: k % 2 ? PAL.plumeLight : PAL.plume, leaf: 1, sway: 0.5 }, M.t(x, y + 0.08 * s, z, 0, 0, a).multiply(M.t(0, 0.25 * s, 0)));
  }
}

/**
 * Layout of the palace (model-local, door faces +z): platform height and the extent of its top,
 * the courtyard, the throne hall, the pools before it and the grand stair.
 */
export const PALACE = {
  h: 1.19,
  /** Centre z of the platform, and the width and depth of its top. */
  cz: -1.3,
  topW: 10.8,
  topD: 9.5,
  wallH: 1.45,
  court: { x0: -3.5, x1: 3.5, z0: -3.6, z1: 1.55 },
  pool: { w: 2.2, d: 1.4, z: -1.0 },
  hall: { h: 2.15 },
  upper: { w: 4.6, h: 0.95, d: 1.3, z: -5.0 },
  pools: [-4.3, 4.3].map((x) => ({ x, z: 5.25, w: 2.3, d: 1.5 })),
  stairHalf: 1.45,
  stairFoot: 6.15,
};

// ---------------- Observatory ----------------

/**
 * Layout of the Observatory (model-local, door faces +z): the deck where the night-watch priest
 * stands at the sighting post, and the stela where the day priest keeps the count.
 */
export const OBS = {
  /** Height of the base's top terrace (where the night priest stands). */
  h: 0.36,
  /** The terrace round the tower, and where the night priest watches from. */
  deck: { x0: 0.45, x1: 0.95, z0: 0.1, z1: 0.75 },
  night: { x: 0.7, z: 0.5 },
  /** The sighting staff the night priest watches past. */
  post: { x: 0.88, z: 0.1 },
  /** The day priest's place, at the calendar stone. */
  day: { x: -0.72, z: 1.2 },
  stela: { x: -0.98, z: 0.86 },
};

/**
 * Observatory: a round stone tower on a stepped circular base. Carved stepped-fret panels and a
 * ring of window slots run round the drum between a red band and an orange one; its open crown
 * holds a slanted stone gnomon carved with the sun. A doorway under a golden sun disc, red-striped
 * stairs up the base between carved pillars bearing fire bowls, a sundial calendar stone with
 * stone seats, a canopy over a writing desk with codices, and painted pots and corner markers on a
 * packed-earth platform. Door faces +z.
 */
export function observatoryModel(): BuildingModel {
  const b = new GeoBuilder();
  const rng = new RNG(4242);
  const H = OBS.h, orange = c(0xd8843a);
  const stoneCol = (p: THREE.Vector3, n: THREE.Vector3) => (n.y > 0.5 ? CUT.stoneLight : CUT.stone).clone().multiplyScalar(0.94 + 0.08 * Math.sin(Math.floor(p.x * 6) * 17 + Math.floor(p.z * 6) * 11 + Math.floor(p.y * 8) * 5));
  // Packed-earth platform.
  b.add(qbox(2.88, 0.05, 2.88, 0.02, 1), { color: PEN.dust }, M.t(0, 0.025, 0));
  // Stepped circular base: three courses.
  for (const [r, y] of [[1.22, 0.05], [1.06, 0.05 + 0.105], [0.92, 0.05 + 0.21]] as const) {
    b.add(P.cyl(r, r + 0.02, 0.105, 24), { color: stoneCol, facet: true }, M.t(0, y + 0.0525, 0));
  }
  b.add(P.cyl(1.065, 1.065, 0.03, 24), { color: K.red }, M.t(0, 0.05 + 0.105 + 0.06, 0));
  // The drum.
  const R = 0.6, ty = H, TH = 1.0;
  b.add(P.cyl(R, R * 1.02, TH, 18), { color: stoneCol, facet: true }, M.t(0, ty + TH / 2, 0));
  b.add(P.cyl(R * 1.025, R * 1.035, 0.12, 24), { color: K.red }, M.t(0, ty + 0.1, 0));
  b.add(P.cyl(R * 1.02, R * 1.02, 0.05, 24), { color: orange }, M.t(0, ty + TH - 0.24, 0));
  // Carved fret panels round the drum (not over the door).
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.5) continue;
    const m = M.t(Math.cos(a) * R * 1.01, ty + 0.42, Math.sin(a) * R * 1.01, 0, -a + Math.PI / 2, 0);
    b.add(P.box(0.2, 0.2, 0.02), { color: CUT.stoneDark }, m);
    fretBand(b, m.clone().multiply(M.t(0, 0, 0.012)), 0.16, 0.13, CUT.stoneDark, CUT.stoneLight);
    if (k % 3 === 1) b.add(P.box(0.06, 0.12, 0.02), { color: K.red }, M.t(Math.cos(a + 0.26) * R * 1.015, ty + 0.42, Math.sin(a + 0.26) * R * 1.015, 0, -a - 0.26 + Math.PI / 2, 0));
  }
  // Open crown: a ring of merlons with window slots between, round a floor carrying the gnomon.
  const cy = ty + TH;
  b.add(P.cyl(R * 1.06, R * 1.06, 0.05, 24), { color: CUT.stoneLight }, M.t(0, cy, 0));
  b.add(P.cyl(R * 0.86, R * 0.86, 0.02, 20), { color: CUT.stoneDark }, M.t(0, cy + 0.01, 0));
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    b.add(P.box(0.2, 0.22, 0.1), { color: stoneCol, facet: true }, M.t(Math.cos(a) * R * 0.97, cy + 0.13, Math.sin(a) * R * 0.97, 0, -a + Math.PI / 2, 0));
    const a2 = a + Math.PI / 16;
    b.add(P.box(0.05, 0.08, 0.02), { color: c(0x3a2a20) }, M.t(Math.cos(a2) * R * 1.0, ty + TH - 0.12, Math.sin(a2) * R * 1.0, 0, -a2 + Math.PI / 2, 0));
  }
  // Coping round the top of the merlons: a ring, so the crown stays open to the sky.
  b.add(new THREE.RingGeometry(R * 0.86, R * 1.05, 24, 1), { color: CUT.stoneLight }, M.t(0, cy + 0.245, 0, -Math.PI / 2, 0, 0));
  // The gnomon: a slanted slab with a sun carved on its face, leaning toward the back.
  const gm = M.t(-0.05, cy, -0.08, -0.5, 0.3, 0);
  b.add(qbox(0.22, 0.85, 0.12, 0.02, 1), { color: CUT.stone }, gm.clone().multiply(M.t(0, 0.42, 0)));
  b.add(P.box(0.18, 0.05, 0.13), { color: K.red }, gm.clone().multiply(M.t(0, 0.62, 0)));
  b.add(P.cyl(0.06, 0.06, 0.02, 12), { color: K.gold }, gm.clone().multiply(M.t(0, 0.74, 0.062, Math.PI / 2, 0, 0)));
  for (let k = 0; k < 8; k++) b.add(P.box(0.012, 0.03, 0.01), { color: K.gold }, gm.clone().multiply(M.t(Math.cos((k / 8) * 6.283) * 0.085, 0.74 + Math.sin((k / 8) * 6.283) * 0.085, 0.066, 0, 0, (k / 8) * 6.283 - Math.PI / 2)));
  // Doorway on +z under a golden sun disc, with red-striped jambs.
  const dz = R * 0.99;
  b.add(P.box(0.3, 0.5, 0.06), { color: K.door }, M.t(0, ty + 0.25, dz));
  for (const sx of [-1, 1]) {
    b.add(P.box(0.09, 0.58, 0.12), { color: CUT.stoneLight }, M.t(sx * 0.2, ty + 0.29, dz + 0.02));
    b.add(P.box(0.03, 0.5, 0.125), { color: K.red }, M.t(sx * 0.2, ty + 0.27, dz + 0.022));
  }
  b.add(P.box(0.5, 0.08, 0.14), { color: CUT.stoneLight }, M.t(0, ty + 0.6, dz + 0.02));
  b.add(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 14, 1, false, -Math.PI / 2, Math.PI), { color: CUT.stoneLight }, M.t(0, ty + 0.64, dz + 0.03, Math.PI / 2, 0, 0));
  b.add(P.cyl(0.11, 0.11, 0.02, 14), { color: K.gold }, M.t(0, ty + 0.72, dz + 0.085, Math.PI / 2, 0, 0));
  b.add(P.cyl(0.05, 0.05, 0.025, 10), { color: K.red }, M.t(0, ty + 0.72, dz + 0.09, Math.PI / 2, 0, 0));
  for (let k = 0; k < 7; k++) {
    const a = (k / 6) * Math.PI;
    b.add(P.box(0.02, 0.05, 0.012), { color: K.gold }, M.t(Math.cos(a) * 0.145, ty + 0.72 + Math.sin(a) * 0.145, dz + 0.09, 0, 0, a - Math.PI / 2));
  }
  // Stairs up the base, with red-striped side walls and fire bowls on carved pillars.
  for (let k = 0; k < 4; k++) {
    const h = (H - 0.05) * (4 - k) / 4, z = 0.86 + k * 0.13;
    b.add(P.box(0.5, h, 0.14), { color: k % 2 ? CUT.stone : CUT.stoneLight }, M.t(0, 0.05 + h / 2, z));
  }
  for (const sx of [-1, 1]) {
    b.add(P.box(0.1, H * 0.9, 0.62), { color: CUT.stone }, M.t(sx * 0.3, H * 0.45, 1.06, -0.32, 0, 0));
    b.add(P.box(0.105, 0.035, 0.62), { color: K.red }, M.t(sx * 0.3, H * 0.75, 1.0, -0.32, 0, 0));
  }
  const torches: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) {
    b.add(qbox(0.22, 0.42, 0.22, 0.02, 1), { color: CUT.stone }, M.t(sx * 0.52, 0.05 + 0.21, 1.3));
    fretBand(b, M.t(sx * 0.52, 0.05 + 0.2, 1.411), 0.16, 0.12, CUT.stoneDark, CUT.stoneLight);
    torches.push(fireBowl(b, sx * 0.52, 0.05 + 0.42, 1.3, 0.9));
  }
  // Sundial calendar stone with stone seats.
  const st = OBS.stela;
  b.add(P.box(0.4, 0.22, 0.36), { color: CUT.stoneDark }, M.t(st.x, 0.05 + 0.11, st.z));
  b.add(P.box(0.44, 0.04, 0.4), { color: CUT.stoneLight }, M.t(st.x, 0.05 + 0.24, st.z));
  b.add(P.cyl(0.15, 0.15, 0.012, 16), { color: CUT.stoneDark }, M.t(st.x, 0.05 + 0.265, st.z));
  for (let k = 0; k < 12; k++) b.add(P.box(0.008, 0.006, 0.05), { color: c(0x5a4630) }, M.t(st.x + Math.sin((k / 12) * 6.283) * 0.12, 0.05 + 0.272, st.z + Math.cos((k / 12) * 6.283) * 0.12, 0, (k / 12) * 6.283, 0));
  b.add(P.box(0.05, 0.06, 0.05), { color: c(0x4a4a48) }, M.t(st.x + 0.03, 0.05 + 0.3, st.z - 0.02));
  for (const [x, z] of [[st.x - 0.32, st.z + 0.12], [st.x + 0.05, st.z + 0.35], [st.x - 0.22, st.z + 0.38]] as const) b.add(qbox(0.13, 0.12, 0.13, 0.02, 1), { color: CUT.stone }, M.t(x, 0.05 + 0.06, z));
  // Canopy over a writing desk with codices, on the right.
  const cx0 = 1.0, cz0 = 0.55;
  for (const [x, z] of [[cx0 - 0.25, cz0 - 0.3], [cx0 + 0.32, cz0 - 0.3], [cx0 - 0.25, cz0 + 0.3], [cx0 + 0.32, cz0 + 0.3]] as const) b.add(P.cyl(0.022, 0.026, 0.62, 5), { color: K.timberDark }, M.t(x, 0.05 + 0.31, z));
  b.add(P.box(0.7, 0.02, 0.72), { color: c(0xe8d6b0), leaf: 0.15 }, M.t(cx0 + 0.035, 0.05 + 0.64, cz0, 0, 0, -0.14));
  b.add(P.box(0.72, 0.06, 0.012), { color: K.red }, M.t(cx0 + 0.035, 0.05 + 0.6, cz0 + 0.36));
  b.add(P.box(0.4, 0.04, 0.26), { color: K.timber }, M.t(cx0 + 0.05, 0.05 + 0.3, cz0));
  for (const sx of [-1, 1]) b.add(P.box(0.04, 0.3, 0.22), { color: K.timberDark }, M.t(cx0 + 0.05 + sx * 0.16, 0.05 + 0.15, cz0));
  b.add(P.box(0.2, 0.012, 0.14), { color: c(0xf2e6c4) }, M.t(cx0 + 0.02, 0.05 + 0.33, cz0));
  for (let k = 0; k < 4; k++) b.add(P.box(0.03, 0.004, 0.03), { color: k % 2 ? K.red : c(0x227f80) }, M.t(cx0 - 0.05 + k * 0.05, 0.05 + 0.338, cz0));
  b.add(P.cyl(0.025, 0.025, 0.16, 6), { color: c(0xf2e6c4) }, M.t(cx0 + 0.16, 0.05 + 0.34, cz0 + 0.06, 0, 0.4, Math.PI / 2));
  frettedPot(b, cx0 + 0.36, 0.05, cz0 + 0.42, 0.5);
  // The night sighting staff on the terrace.
  const post = OBS.post;
  b.add(P.cyl(0.018, 0.022, 0.6, 5), { color: K.timberDark }, M.t(post.x, H + 0.3, post.z));
  for (const s of [-1, 1]) b.add(P.cyl(0.01, 0.01, 0.26, 4), { color: K.timber }, M.t(post.x, H + 0.58, post.z, 0, 0, s * 0.7));
  // Corner markers and pots; planting.
  for (const [x, z] of [[-1.22, -1.22], [1.22, 1.22]] as const) {
    b.add(qbox(0.28, 0.52, 0.28, 0.02, 1), { color: CUT.stone }, M.t(x, 0.05 + 0.26, z));
    b.add(P.box(0.3, 0.06, 0.3), { color: K.red }, M.t(x, 0.05 + 0.44, z));
    fretBand(b, M.t(x, 0.05 + 0.24, z + 0.141), 0.2, 0.14, CUT.stoneDark, CUT.stoneLight);
  }
  for (const [x, z, s] of [[-0.62, 1.05, 0.6], [0.95, 1.25, 0.65], [-1.25, 0.3, 0.55]] as const) frettedPot(b, x, 0.05, z, s);
  for (const [x, z, s] of [[-1.15, -0.45, 0.65], [1.08, -0.75, 0.6], [-0.35, -1.18, 0.6]] as const) fern(b, x, 0.05, z, s, Math.round(x * 50 + z * 9));
  blooms(b, -1.25, 0.05, 1.2, 4, 0.12, 0.12, 4243);
  for (let k = 0; k < 4; k++) b.add(lumpy(P.sphere(0.08, 0), 0.2, k), { color: c(0x8c8a84) }, M.t(rng.range(-1.3, 1.3), 0.06, k % 2 ? -1.32 : 1.0 + rng.range(-0.1, 0.1), 0, k, 0, 1.3, 0.7, 1));
  return { finished: b.build(), torches, height: cy + 0.3 };
}

// ---------------- District styles for houses ----------------

/** The looks a district gives the houses built in it. */
export type HouseStyle = 'village' | 'lakeside' | 'noble' | 'farmstead';
export const HOUSE_STYLES: Record<HouseStyle, { name: string; quarter: string; tint: number; about: string }> = {
  village: { name: 'Village', quarter: 'Village Quarter', tint: 0xd9a35a, about: 'adobe homes with red trim' },
  lakeside: { name: 'Lakeside', quarter: 'Lakeside Quarter', tint: 0x3f8fb0, about: 'timber homes with reed eaves, nets and fish drying by the door' },
  noble: { name: 'Noble', quarter: 'Noble Quarter', tint: 0xd7a53e, about: 'whitewashed homes banded in red and gold, with banners and roof gardens' },
  farmstead: { name: 'Farmstead', quarter: 'Farmstead Quarter', tint: 0x7da34a, about: 'ochre homes under thatch, maize drying on the walls, hay and a wattle fence' },
};
export const isHouseStyle = (s: unknown): s is HouseStyle => typeof s === 'string' && Object.hasOwn(HOUSE_STYLES, s);

/** Wall, coping, roof, foot-band and door colours of the adobe houses, per style (village = the originals). */
const STYLE_PAL: Record<Exclude<HouseStyle, 'village'>, Partial<Record<'wall' | 'wallLight' | 'roof' | 'band' | 'door' | 'red', THREE.Color>>> = {
  lakeside: { wall: c(0x9c7550), wallLight: c(0xb48e66), roof: c(0xa98a5c), band: c(0x5e3b22), door: c(0x2f6f8f) },
  noble: { wall: c(0xeee4d2), wallLight: c(0xfbf6ec), roof: c(0xe2d4bc), band: c(0x9a2e24), door: c(0x8e2a22), red: c(0xb3352a) },
  farmstead: { wall: c(0xcf9f62), wallLight: c(0xe0b67c), roof: c(0xc29a5c), band: c(0x8a5a30), door: c(0x6b8a3a) },
};

/** Build a house in a style: the adobe palette swapped while it is made, then the style's own details added. */
function styledHouse(style: HouseStyle | undefined, make: () => BuildingModel, extras: (b: GeoBuilder) => void): BuildingModel {
  if (!style || style === 'village') return make();
  const pal = STYLE_PAL[style], saved: Partial<Record<string, THREE.Color>> = {};
  for (const [k, v] of Object.entries(pal)) { saved[k] = (AD as Record<string, THREE.Color>)[k]; (AD as Record<string, THREE.Color>)[k] = v!; }
  try {
    const m = make();
    const b = new GeoBuilder();
    extras(b);
    const extra = b.build();
    const merged = mergeGeometries([m.finished, extra]);
    if (merged) { m.finished.dispose(); extra.dispose(); m.finished = merged; }
    return m;
  } finally {
    for (const [k, v] of Object.entries(saved)) (AD as Record<string, THREE.Color>)[k] = v!;
  }
}

/** A style's details for a house front at z = fz, its main block from x0 to x1, its roof at roofY. */
function houseDetails(b: GeoBuilder, style: HouseStyle, x0: number, x1: number, fz: number, roofY: number, seed: number, top?: [number, number, number, number]): void {
  const rng = new RNG(seed), w = x1 - x0, cx = (x0 + x1) / 2;
  // Props beside the house stay inside the 3×3 plot even beside the widest house.
  const right = Math.min(x1 + 0.1, 1.28), left = Math.max(x0 - 0.05, -1.2);
  if (style === 'noble') {
    // Red and gold bands with a stepped fret across the front, a sun banner, planters on the roof.
    fretBand(b, M.t(cx, roofY - 0.2, fz + 0.012), w - 0.06, 0.1, c(0xb3352a), K.gold);
    b.add(P.box(w, 0.03, 0.02), { color: K.gold }, M.t(cx, roofY - 0.12, fz + 0.012));
    sunBanner(b, M.t(x1 - 0.22, roofY - 0.48, fz + 0.03), 0.18, 0.32);
    for (const x of [x0 + 0.2, x1 - 0.25]) pottedPlant(b, x, roofY + 0.02, fz - 0.2, 1.1);
  } else if (style === 'lakeside') {
    // Reed fringe along the eaves, a blue fret, a drying rack of fish and a net and paddle by the door.
    for (let k = 0; k < Math.round(w / 0.1); k++) b.add(P.cone(0.05, 0.14, 4), { color: k % 2 ? K.thatch : K.thatchDark, leaf: 0.2, sway: 0.2 }, M.t(x0 + 0.05 + k * 0.1, roofY - 0.04, fz + 0.03, Math.PI - 0.4, 0, 0));
    fretBand(b, M.t(cx, roofY - 0.22, fz + 0.012), w - 0.06, 0.08, c(0x2f6f8f), AD.cream);
    const rx = right, rz = Math.min(fz + 0.18, 1.2);
    for (const s of [-1, 1]) b.add(P.cyl(0.015, 0.018, 0.5, 4), { color: K.timberDark }, M.t(rx, 0.25, rz + s * 0.2));
    b.add(P.cyl(0.01, 0.01, 0.44, 4), { color: K.timber }, M.t(rx, 0.46, rz, Math.PI / 2, 0, 0));
    for (let k = 0; k < 3; k++) b.add(P.uvSphere(0.035, 6, 4), { color: k % 2 ? c(0x7f97a8) : c(0x9aa8b0), sway: 0.2 }, M.t(rx, 0.36, rz - 0.12 + k * 0.12, 0, 0, 0, 0.5, 1.6, 0.8));
    b.add(lumpy(P.sphere(0.12, 1), 0.3, seed, 0.5), { color: c(0xd9c9a0) }, M.t(left, 0.08, Math.min(fz + 0.18, 1.2), 0, 0, 0, 1.2, 0.6, 1));
    b.add(P.cyl(0.012, 0.012, 0.6, 4), { color: K.timber }, M.t(x0 + 0.08, 0.3, fz + 0.06, 0.2, 0, 0.1));
    b.add(P.box(0.08, 0.16, 0.02), { color: K.timber }, M.t(x0 + 0.08, 0.06, fz + 0.12, 0.2, 0, 0.1));
  } else if (style === 'farmstead') {
    // A thatch cap on the roof, maize bundles hung on the wall, a hay heap and a run of wattle fence.
    // (On the upper storey's roof where there is one, else the main roof.)
    const [tx, ty, tz, tr] = top ?? [cx, roofY, fz - 0.4, Math.max(0.35, w * 0.4)];
    b.add(P.cone(tr, 0.34, 8), { color: thatchColor, leaf: 0.2 }, M.t(tx, ty + 0.2, tz, 0, Math.PI / 8, 0, 1, 1, 0.9));
    for (const x of [x0 + 0.18, x0 + 0.34]) for (let k = 0; k < 3; k++) b.add(P.cyl(0.022, 0.016, 0.13, 5), { color: k % 2 ? c(0xf2c53a) : c(0xe8a526), sway: 0.2 }, M.t(x + (k - 1) * 0.03, roofY - 0.3, fz + 0.03));
    b.add(lumpy(P.sphere(0.16, 0), 0.25, seed + 3, 0.55), { color: c(0xd9b866), leaf: 0.2 }, M.t(Math.min(right, 1.22), 0.08, Math.min(fz + 0.12, 1.2)));
    const fx = Math.max(x0 - 0.12, -1.3), fzz = Math.min(fz + 0.35, 1.3);
    for (let k = 0; k < 4; k++) b.add(P.cyl(0.015, 0.018, 0.28, 4), { color: K.timberDark }, M.t(fx + k * 0.18, 0.14, fzz));
    for (const y of [0.08, 0.16, 0.24]) b.add(P.box(0.56, 0.05, 0.025), { color: rng.next() < 0.5 ? c(0x8a6440) : c(0x6b4a2c) }, M.t(fx + 0.27, y, fzz));
  }
}

/** The hut in a style (it is all timber already: the style shows in its trimmings). */
export function styledHutModel(style?: HouseStyle): BuildingModel {
  if (!style || style === 'village') return hutModel();
  const m = hutModel();
  const b = new GeoBuilder();
  houseDetails(b, style, -0.5, 0.5, 0.52, 0.66, 31);
  const extra = b.build();
  const merged = mergeGeometries([m.finished, extra]);
  if (merged) { m.finished.dispose(); extra.dispose(); m.finished = merged; }
  return m;
}

/** The family house (levels 2–5) in a style. */
export function styledHomeModel(tier: number, style?: HouseStyle): BuildingModel {
  // Front face, main block span and its roof height, per level (see homeModel).
  const F: Record<number, [number, number, number, number]> = { 1: [-0.95, 0.95, 0.7, 1.0], 2: [-1.2, 0.2, 0.75, 1.05], 3: [-1.3, 0.2, 0.65, 1.1], 4: [-1.4, 1.4, 1.1, 1.0] };
  // The top storey's roof (centre, height, radius for a thatch cap).
  const T: Record<number, [number, number, number, number]> = { 1: [-0.25, 1.9, -0.35, 0.72], 2: [-0.6, 1.95, -0.4, 0.66], 3: [-0.65, 2.9, -0.55, 0.55], 4: [-0.6, 3.0, -0.6, 0.66] };
  const lvl = Math.min(4, Math.max(1, tier));
  const [x0, x1, fz, ry] = F[lvl];
  return styledHouse(style, () => homeModel(tier), (b) => houseDetails(b, style!, x0, x1, fz, ry, tier * 7, T[lvl]));
}

// ---------------- Fisherman's Hut ----------------

/**
 * Fisherman's Hut: a small home on timber stilts over the shallows (door faces +z, toward the
 * shore). Plastered walls with corner posts and a turquoise fret band under a ragged thatch, a deck
 * all round with steps down to the beach, a net-drying awning on one side hung with floats, baskets,
 * pots and a fish trap, fish drying by the door, and a canoe tied alongside. `landY` is the height
 * of the building's base (the sea bed layer); the deck stands just above the water.
 */
export function fishHutModel(landY: number): BuildingModel {
  const b = new GeoBuilder(), rng = new RNG(911);
  const deck = 0.4 - landY, shore = 0.3 - landY, bed = -1.45 - landY;
  const plank = () => (rng.next() < 0.5 ? c(0x9a6c42) : c(0x865a36));
  const lash = (x: number, y: number, z: number, r = 0.06) => b.add(P.torus(r, 0.014, 4, 8), { color: K.rope }, M.t(x, y, z, Math.PI / 2, 0, 0));
  // Stilts, lashed at the deck and above the water line.
  for (const x of [-0.9, 0, 0.9]) for (const z of [-0.9, 0, 0.75]) {
    const h = deck - bed + 0.05;
    b.add(P.cyl(0.055, 0.065, h, 6), { color: (p) => (p.y < -landY + 0.02 ? c(0x3e3324) : K.timber).clone() }, M.t(x, bed + h / 2, z));
    lash(x, deck - 0.06, z, 0.065);
    lash(x, -landY + 0.12, z, 0.07);
  }
  // Bearers and the plank deck (planks run across, a few a shade apart).
  for (const z of [-0.9, 0, 0.75]) b.add(P.box(1.95, 0.06, 0.08), { color: K.timberDark }, M.t(0, deck - 0.06, z));
  for (let z = -0.98; z < 0.95; z += 0.17) b.add(P.box(1.98, 0.035, 0.155), { color: plank() }, M.t(rng.range(-0.01, 0.01), deck, z + 0.08));
  // Steps down from the landing to the beach.
  const drop = deck - shore;
  for (let k = 1; k <= 3; k++) {
    const y = deck - (drop * k) / 3.5;
    b.add(P.box(0.5, 0.035, 0.16), { color: plank() }, M.t(0, y, 0.98 + k * 0.13));
  }
  for (const s of [-1, 1]) b.add(P.box(0.04, 0.04, 0.5), { color: K.timberDark }, M.t(s * 0.27, deck - drop * 0.45, 1.2, Math.atan2(drop, 0.5), 0, 0));
  // Rails along the seaward edge.
  for (const x of [-0.9, 0, 0.9]) b.add(P.cyl(0.025, 0.025, 0.36, 5), { color: K.timber }, M.t(x, deck + 0.18, -0.95));
  b.add(P.box(1.85, 0.03, 0.03), { color: K.timberDark }, M.t(0, deck + 0.34, -0.95));
  // The hut: plastered walls, timber corner posts, a turquoise fret band.
  const W = 1.1, D = 0.95, H = 0.62, zc = -0.32, y0 = deck + 0.02;
  b.add(P.box(W, H, D), { color: (p) => K.plaster.clone().lerp(c(0xd8c6a2), Math.max(0, 1 - (p.y - y0) / H) * 0.5) }, M.t(0, y0 + H / 2, zc));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(P.box(0.07, H + 0.04, 0.07), { color: K.timber }, M.t(sx * (W / 2), y0 + H / 2, zc + sz * (D / 2)));
  fretBand(b, M.t(0, y0 + H - 0.09, zc + D / 2 + 0.007), W - 0.1, 0.07, BANNER.teal, BANNER.cream);
  for (const s of [-1, 1]) fretBand(b, M.t(s * (W / 2 + 0.007), y0 + H - 0.09, zc, 0, s * Math.PI / 2, 0), D - 0.1, 0.07, BANNER.teal, BANNER.cream);
  b.add(P.box(W + 0.02, 0.05, D + 0.02), { color: K.red }, M.t(0, y0 + 0.025, zc));
  // Doorway with a timber door left ajar, firelight inside at night.
  const dz = zc + D / 2;
  glowSink?.push({ x: -0.02, y: y0 + 0.22, z: dz - 0.006, w: 0.26, h: 0.42, d: 0.02 });
  b.add(P.box(0.3, 0.46, 0.02), { color: K.door }, M.t(0, y0 + 0.23, dz + 0.002));
  b.add(P.box(0.13, 0.42, 0.025), { color: c(0x7a5233) }, M.t(0.12, y0 + 0.22, dz + 0.06, 0, -0.9, 0));
  for (const s of [-1, 1]) b.add(P.box(0.05, 0.5, 0.05), { color: K.timberDark }, M.t(s * 0.17, y0 + 0.25, dz + 0.015));
  b.add(P.box(0.42, 0.05, 0.06), { color: K.timberDark }, M.t(0, y0 + 0.49, dz + 0.015));
  // A small shuttered window on each side.
  for (const s of [-1, 1]) {
    glowSink?.push({ x: s * (W / 2 + 0.004), y: y0 + 0.36, z: zc, w: 0.03, h: 0.14, d: 0.16 });
    b.add(P.box(0.02, 0.16, 0.18), { color: K.door }, M.t(s * (W / 2 + 0.002), y0 + 0.36, zc));
    b.add(P.box(0.03, 0.04, 0.26), { color: K.timberDark }, M.t(s * (W / 2 + 0.012), y0 + 0.27, zc));
  }
  // Thatch: a steep gable along x, ragged at the eaves, with a lashed ridge.
  const rise = 0.42, half = D / 2 + 0.2, slope = Math.hypot(rise, half), ang = Math.atan2(rise, half), ry = y0 + H;
  for (const s of [-1, 1]) {
    b.add(P.box(W + 0.36, 0.09, slope), { color: thatchColor, leaf: 0.2 }, M.t(0, ry + rise / 2, zc + s * half / 2, s * ang, 0, 0));
    // A ragged eave: bundles of straw of uneven length hanging past the roof's edge.
    for (let k = 0; k < 8; k++) {
      const x = -W / 2 - 0.12 + (k + 0.5) * ((W + 0.24) / 8), len = 0.12 + rng.next() * 0.1;
      b.add(P.box((W + 0.24) / 8 + 0.01, 0.05, len), { color: K.thatchDark, leaf: 0.2 }, M.t(x, ry + 0.01 - (len / 2) * Math.sin(ang), zc + s * (half - 0.02 + (len / 2) * Math.cos(ang)), s * ang, 0, 0));
    }
  }
  // Gable ends: plaster triangles under the thatch.
  for (const s of [-1, 1]) {
    const tri = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -D / 2, 0, 0, D / 2, 0, rise, 0], 3));
    tri.setIndex(s > 0 ? [0, 2, 1] : [0, 1, 2]);
    b.add(tri, { color: K.plaster }, M.t(s * (W / 2 - 0.005), ry, zc));
  }
  b.add(P.cyl(0.035, 0.035, W + 0.5, 6), { color: K.timberDark }, M.t(0, ry + rise + 0.04, zc, 0, 0, Math.PI / 2));
  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) b.add(P.box(0.03, 0.22, 0.03), { color: K.timberDark }, M.t(s * (W / 2 + 0.2), ry + rise + 0.08, zc + t * 0.05, t * 0.5, 0, 0));
    lash(s * (W / 2 + 0.05), ry + rise + 0.04, zc, 0.045);
  }
  // Net-drying awning on the +x side: two posts, a woven mat, a net with floats hung below.
  const ax = 0.78;
  for (const z of [-0.85, 0.55]) b.add(P.cyl(0.03, 0.035, 0.9, 5), { color: K.timber }, M.t(ax + 0.12, deck + 0.45, z));
  b.add(P.box(0.5, 0.03, 1.55), { color: (p) => ((p.z * 9) % 1 < 0.5 ? c(0xd9c08a) : c(0xc4a670)).clone(), leaf: 0.2 }, M.t(ax - 0.05, deck + 0.86, -0.15, 0, 0, -0.25));
  const net = clothPanel(1.25, 0.38, 0.03, 4, 1);
  b.add(net.geo, { color: c(0xc8b48a), sway: 0.25 }, M.t(ax + 0.13, deck + 0.82, -0.15, 0, Math.PI / 2, 0));
  net.geo.dispose();
  for (let k = 0; k < 5; k++) b.add(P.sphere(0.035, 0), { color: k % 2 ? c(0xb06a3a) : c(0x8e5a2e), sway: 0.25 }, M.t(ax + 0.14, deck + 0.42, -0.72 + k * 0.29));
  // Things on the deck: baskets of fish, painted pots, a fish trap, coiled rope.
  const basket = (x: number, z: number, s = 1, fish = true) => {
    b.add(P.cyl(0.11 * s, 0.085 * s, 0.13 * s, 8), { color: (p) => ((p.y * 60) % 1 < 0.5 ? c(0xb08a52) : c(0x9a7444)).clone() }, M.t(x, deck + 0.08 * s, z));
    if (fish) for (let k = 0; k < 3; k++) b.add(P.sphere(0.035 * s, 0), { color: c(0x7d97a0) }, M.t(x + (k - 1) * 0.04 * s, deck + 0.15 * s, z + (k % 2) * 0.03, 0, k, 0, 1, 0.6, 2));
  };
  basket(-0.32, 0.32);
  basket(0.62, 0.42, 0.85);
  basket(-0.8, -0.2, 0.9, false);
  const pot = (x: number, z: number, body: THREE.Color) => {
    b.add(P.sphere(0.1, 1), { color: body }, M.t(x, deck + 0.1, z, 0, 0, 0, 1, 1.1, 1));
    b.add(P.cyl(0.05, 0.06, 0.06, 8), { color: body }, M.t(x, deck + 0.21, z));
    b.add(P.cyl(0.101, 0.101, 0.03, 10), { color: BANNER.cream }, M.t(x, deck + 0.12, z));
  };
  pot(0.34, 0.34, c(0xb8562e));
  pot(-0.75, 0.42, BANNER.teal);
  const trap = new THREE.CylinderGeometry(0.1, 0.07, 0.36, 8, 1, true);
  b.add(trap, { color: (p) => ((Math.atan2(p.x, p.z) * 4) % 1 < 0.5 ? c(0xb8935a) : c(0x8e6e40)).clone() }, M.t(0.55, deck + 0.1, -0.7, 0, 0.4, Math.PI / 2));
  b.add(P.torus(0.08, 0.025, 4, 10), { color: K.rope }, M.t(-0.55, deck + 0.03, -0.75, Math.PI / 2, 0, 0));
  // Fish drying on a line by the door.
  b.add(P.cyl(0.012, 0.012, 0.7, 4), { color: K.timberDark }, M.t(-0.45, y0 + 0.55, dz + 0.12, 0, 0, Math.PI / 2));
  for (let k = 0; k < 3; k++) b.add(P.cone(0.035, 0.17, 4), { color: c(0x6f8f9a), sway: 0.2 }, M.t(-0.7 + k * 0.13, y0 + 0.44, dz + 0.12, Math.PI, 0, 0, 1, 1, 0.5));
  // A bench by the door.
  b.add(P.box(0.4, 0.04, 0.14), { color: c(0x8a5e3a) }, M.t(-0.55, deck + 0.17, 0.48));
  for (const s of [-1, 1]) b.add(P.box(0.04, 0.15, 0.12), { color: K.timberDark }, M.t(-0.55 + s * 0.16, deck + 0.08, 0.48));
  // A canoe tied alongside, painted in teal and red, with a paddle and a net in it.
  // Open side up: the half of the cylinder that turns to face down once laid along z.
  const hull = doubleSide(new THREE.CylinderGeometry(0.15, 0.15, 1.3, 10, 1, false, -Math.PI / 2, Math.PI));
  const cx = -1.32, cy = -landY + 0.08;
  b.add(hull, { color: (p, n) => (n.y > 0.3 ? c(0x6a4428) : p.y > cy - 0.06 ? BANNER.teal : c(0x7a5233)).clone() }, M.t(cx, cy, 0.05, Math.PI / 2, 0, 0, 1, 1, 0.75));
  for (const s of [-1, 1]) {
    b.add(P.box(0.03, 0.03, 1.25), { color: K.red }, M.t(cx + s * 0.14, cy + 0.005, 0.05));
    b.add(P.cone(0.11, 0.2, 6), { color: c(0x7a5233) }, M.t(cx, cy - 0.02, 0.05 + s * 0.74, s * Math.PI / 2, 0, 0, 1, 1, 0.7));
  }
  b.add(P.box(0.03, 0.02, 0.85), { color: c(0xa87a4a) }, M.t(cx + 0.04, cy + 0.03, 0.15, 0, 0.15, 0));
  b.add(P.box(0.08, 0.015, 0.2), { color: c(0xa87a4a) }, M.t(cx + 0.1, cy + 0.03, 0.6, 0, 0.15, 0));
  basket(cx, -0.25 - (deck - cy) * 0, 0.7, true);
  b.add(P.cyl(0.008, 0.008, 0.4, 3), { color: K.rope }, M.t(-1.1, (deck + cy) / 2, -0.3, 0, 0, 1.1));
  return { finished: b.build(), torches: [], height: deck + H + rise + 0.2 };
}

// ---------------- Banners and flags (decorations) ----------------

/** A stepped stone footing for a pole, 0.1 high. */
function poleFooting(b: GeoBuilder, x = 0, z = 0): void {
  b.add(P.box(0.32, 0.06, 0.32), { color: K.stoneDark }, M.t(x, 0.03, z));
  b.add(P.box(0.22, 0.06, 0.22), { color: K.stone }, M.t(x, 0.09, z));
  b.add(P.box(0.23, 0.02, 0.23), { color: BANNER.teal }, M.t(x, 0.07, z));
}

/** A tall pole with a crossbar and finial. Returns the crossbar height. */
function bannerMast(b: GeoBuilder, h: number, bar: number): number {
  poleFooting(b);
  b.add(P.cyl(0.03, 0.04, h, 6), { color: K.timberDark }, M.t(0, 0.12 + h / 2, 0));
  const y = 0.12 + h - 0.12;
  b.add(P.box(bar, 0.035, 0.035), { color: K.timberDark }, M.t(0, y, 0));
  for (const s of [-1, 1]) b.add(P.torus(0.03, 0.01, 3, 6), { color: K.rope }, M.t(s * bar * 0.4, y, 0, Math.PI / 2, 0, 0));
  b.add(P.cyl(0.045, 0.045, 0.03, 6), { color: BANNER.gold }, M.t(0, 0.12 + h + 0.01, 0));
  return y;
}

/** A crest of feathers fanned out above a point (facing +z). */
function featherCrest(b: GeoBuilder, x: number, y: number, z: number, s = 1): void {
  const cols = [K.red, BANNER.teal, BANNER.gold, c(0xd96a2a), BANNER.teal, K.red, BANNER.gold];
  cols.forEach((col, k) => {
    const a = (k - 3) * 0.28;
    b.add(P.cone(0.04 * s, 0.32 * s, 4), { color: col, sway: 0.15 }, M.t(x + Math.sin(a) * 0.05 * s, y + Math.cos(a) * 0.14 * s, z, 0, 0, -a, 1, 1, 0.35));
  });
  b.add(P.sphere(0.045 * s, 0), { color: BANNER.gold }, M.t(x, y, z + 0.01));
}

/** The decorations' models (door faces +z). */
export function decorModel(key: string): BuildingModel {
  const b = new GeoBuilder();
  switch (key) {
    case 'bannersun': {
      const y = bannerMast(b, 1.9, 0.5);
      sunBanner(b, M.t(0, y - 0.48, 0.05), 0.42, 0.9, true);
      return { finished: b.build(), torches: [], height: 2.1 };
    }
    case 'bannerteal': {
      const y = bannerMast(b, 1.8, 0.46);
      tealBanner(b, M.t(0, y - 0.44, 0.05), 0.38, 0.84);
      return { finished: b.build(), torches: [], height: 2 };
    }
    case 'featherbanner': {
      const y = bannerMast(b, 1.9, 0.5);
      sunBanner(b, M.t(0, y - 0.48, 0.05), 0.42, 0.9, true);
      featherCrest(b, 0, 0.12 + 1.9 + 0.02, 0, 1.2);
      return { finished: b.build(), torches: [], height: 2.5 };
    }
    case 'bannereagle': {
      // Hung between two poles on a crossbar.
      for (const s of [-1, 1]) {
        poleFooting(b, s * 0.3, 0);
        b.add(P.cyl(0.03, 0.035, 1.8, 6), { color: K.timberDark }, M.t(s * 0.3, 1.0, 0));
        b.add(P.cone(0.04, 0.08, 6), { color: BANNER.gold }, M.t(s * 0.3, 1.94, 0));
      }
      b.add(P.box(0.7, 0.035, 0.035), { color: K.timberDark }, M.t(0, 1.72, 0));
      eagleBanner(b, M.t(0, 1.25, 0.03), 0.46, 0.9);
      return { finished: b.build(), torches: [], height: 2 };
    }
    case 'pennants': {
      poleFooting(b);
      const h = 2.1;
      b.add(P.cyl(0.03, 0.04, h, 6), { color: K.timberDark }, M.t(0, 0.12 + h / 2, 0));
      for (const y of [0.7, 1.25, 1.8]) b.add(P.torus(0.038, 0.012, 3, 6), { color: K.rope }, M.t(0, y, 0, Math.PI / 2, 0, 0));
      [[K.red, 2.0], [BANNER.teal, 1.62], [BANNER.gold, 1.24]].forEach(([col, y], k) => pennant(b, 0.04, y as number, 0.52 - k * 0.04, 0.26, col as THREE.Color));
      b.add(P.sphere(0.05, 0), { color: BANNER.gold }, M.t(0, 0.12 + h + 0.03, 0));
      return { finished: b.build(), torches: [], height: 2.3 };
    }
    case 'flagstring': {
      // Size 3x1: posts at either end, a sagging rope of small flags between.
      const span = 2.6, top = 1.35, sag = 0.22;
      for (const s of [-1, 1]) {
        poleFooting(b, s * span / 2, 0);
        b.add(P.cyl(0.03, 0.035, top, 6), { color: K.timberDark }, M.t(s * span / 2, 0.12 + top / 2 - 0.06, 0));
        b.add(P.sphere(0.04, 0), { color: BANNER.gold }, M.t(s * span / 2, top + 0.08, 0));
      }
      const ropeY = (x: number) => top - sag * (1 - (2 * x / span) ** 2);
      const n = 12;
      for (let k = 0; k < n; k++) {
        const x0 = -span / 2 + (span * k) / n, x1 = x0 + span / n;
        const xm = (x0 + x1) / 2, y0 = ropeY(x0), y1 = ropeY(x1);
        b.add(P.cyl(0.007, 0.007, Math.hypot(x1 - x0, y1 - y0), 3), { color: K.rope }, M.t(xm, (y0 + y1) / 2, 0, 0, 0, Math.PI / 2 + Math.atan2(y1 - y0, x1 - x0)));
      }
      const cols = [K.red, BANNER.teal, BANNER.cream, BANNER.gold, K.red, BANNER.teal, BANNER.gold, BANNER.cream, K.red];
      cols.forEach((col, k) => {
        const x = -span / 2 + (span * (k + 1)) / (cols.length + 1);
        const f = clothPanel(0.18, 0.24, 0.01, 2, 1);
        // A swallowtail: the middle of the foot drawn up into a notch.
        const fp = f.geo.getAttribute('position');
        for (let i = 0; i < fp.count; i++) if (Math.abs(fp.getX(i)) < 1e-3 && fp.getY(i) < -0.2) fp.setY(i, -0.17);
        f.geo.computeVertexNormals();
        const sway = (p: THREE.Vector3) => (Math.min(1, Math.max(0, (ropeY(x) - p.y) / 0.24)) * 0.4);
        b.add(f.geo, { color: col, sway, leaf: CLOTH }, M.t(x, ropeY(x) - 0.005, 0));
        f.geo.dispose();
        // A notch cut from the foot, and a stepped mark in a contrasting colour.
        const ink = col === BANNER.cream ? K.red : BANNER.cream;
        for (const face of [1, -1]) {
          b.add(P.box(0.07, 0.025, 0.004), { color: ink, sway, leaf: CLOTH }, M.t(x, ropeY(x) - 0.09, face * 0.004));
          b.add(P.box(0.03, 0.05, 0.004), { color: ink, sway, leaf: CLOTH }, M.t(x, ropeY(x) - 0.065, face * 0.004));
        }
      });
      return { finished: b.build(), torches: [], height: 1.6 };
    }
  }
  throw new Error(`No decoration ${key}`);
}

/** A triangular pennant on a pole (pointing +x), two-faced, with a cream mark. */
function pennant(b: GeoBuilder, x: number, y: number, len: number, h: number, col: THREE.Color): void {
  // Front and back as separate faces (shared corners would average their normals to nothing).
  const front = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, h / 2, 0, 0, -h / 2, 0, len * 0.5, h * 0.12, 0.03, len, 0, 0], 3));
  front.setIndex([0, 1, 2, 2, 1, 3]);
  front.computeVertexNormals();
  const back = front.clone();
  back.setIndex([0, 2, 1, 2, 3, 1]);
  back.computeVertexNormals();
  const geo = mergeGeometries([front, back])!;
  front.dispose(); back.dispose();
  const sway = (p: THREE.Vector3) => (Math.min(1, Math.max(0, (p.x - x) / len)) * 0.5);
  b.add(geo, { color: col, sway, leaf: CLOTH }, M.t(x, y, 0));
  geo.dispose();
  for (const face of [1, -1]) {
    b.add(P.box(0.06, 0.06, 0.004), { color: BANNER.cream, sway, leaf: CLOTH }, M.t(x + len * 0.28, y + 0.005, 0.012 * face + 0.01, 0, 0, Math.PI / 4));
    b.add(P.box(0.025, 0.025, 0.004), { color: col, sway, leaf: CLOTH }, M.t(x + len * 0.28, y + 0.005, 0.015 * face + 0.01, 0, 0, Math.PI / 4));
  }
}

/** A turquoise banner with a cream sun-wheel and stepped border (facing +z; `m` is its middle). */
function tealBanner(b: GeoBuilder, m: THREE.Matrix4, w: number, h: number): void {
  sunBanner(b, m, w, h, true, BANNER.teal.clone(), BANNER.cream);
}

/**
 * A cream banner with red stepped-fret borders top and bottom and a turquoise eagle: wings spread
 * in stepped feathers, a hooked head (facing +z; `m` is its middle).
 */
function eagleBanner(b: GeoBuilder, m: THREE.Matrix4, w: number, h: number): void {
  const top = m.clone().multiply(M.t(0, h / 2, 0));
  const inv = top.clone().invert(), lp = new THREE.Vector3();
  const sway = (p: THREE.Vector3) => (Math.min(1, Math.max(0, -lp.copy(p).applyMatrix4(inv).y / h)) * 0.35);
  const { geo, z } = clothPanel(w, h, w * 0.05, 3, 2);
  b.add(geo, { color: (p) => BANNER.cream.clone().lerp(c(0xcdb98e), Math.min(1, -lp.copy(p).applyMatrix4(inv).y / h) * 0.4), sway, leaf: CLOTH }, top);
  geo.dispose();
  for (const face of [1, -1]) {
    const at = (x: number, y: number) => top.clone().multiply(M.t(x, y, z(x) + face * 0.007)).multiply(M.t(0, 0, 0, 0, face > 0 ? 0 : Math.PI, 0));
    for (const y of [-h * 0.08, -h * 0.9]) {
      b.add(P.box(w * 0.9, h * 0.035, 0.004), { color: K.red, sway, leaf: CLOTH }, at(0, y));
      for (let k = 0; k < 5; k++) b.add(P.box(w * 0.08, h * 0.05, 0.004), { color: K.red, sway, leaf: CLOTH }, at(-w * 0.36 + k * w * 0.18, y + (y > -h / 2 ? -1 : 1) * h * 0.035));
    }
    // The eagle: body, stepped wings, tail, and head turned to one side.
    const ey = -h * 0.48;
    b.add(P.box(w * 0.14, h * 0.24, 0.004), { color: BANNER.teal, sway, leaf: CLOTH }, at(0, ey));
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
      b.add(P.box(w * 0.12, h * (0.16 - k * 0.04), 0.004), { color: BANNER.teal, sway, leaf: CLOTH }, at(s * w * (0.13 + k * 0.1), ey + h * (0.04 + k * 0.03)));
    }
    b.add(P.box(w * 0.2, h * 0.06, 0.004), { color: BANNER.teal, sway, leaf: CLOTH }, at(0, ey - h * 0.15));
    b.add(P.box(w * 0.12, h * 0.1, 0.004), { color: BANNER.teal, sway, leaf: CLOTH }, at(w * 0.03, ey + h * 0.17));
    b.add(P.box(w * 0.06, h * 0.035, 0.004), { color: BANNER.gold, sway, leaf: CLOTH }, at(w * 0.11, ey + h * 0.16));
    b.add(P.box(w * 0.025, h * 0.02, 0.004), { color: K.door, sway, leaf: CLOTH }, at(w * 0.04, ey + h * 0.19).multiply(M.t(0, 0, face * 0.001)));
  }
  // Tassels along the hem, and the rod.
  for (let k = 0; k < 4; k++) b.add(P.cyl(0.004, 0.013, 0.07, 5), { color: k % 2 ? K.red : BANNER.gold, sway, leaf: CLOTH }, top.clone().multiply(M.t(-w * 0.375 + k * w * 0.25, -h - 0.03, z(-w * 0.375 + k * w * 0.25))));
  b.add(P.cyl(0.014, 0.014, w * 1.1, 6), { color: BANNER.timber }, top.clone().multiply(M.t(0, 0.008, 0, 0, 0, Math.PI / 2)));
}
