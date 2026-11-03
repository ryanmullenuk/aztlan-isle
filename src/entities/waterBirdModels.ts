import * as THREE from 'three';
import { animalForm } from './animalForm';
import { ColorFn, GeoBuilder, M, P, facet } from '../render/GeoBuilder';
import { WingSpec } from './birdWings';
import { foldedWings } from './birdForms';

/**
 * Pelicans and herons, in parts for jointed animation. Every part faces +z with its pivot at
 * the origin: body (centre), neck segments (base, running up +y), head (bill along +z), the
 * pelican's lower jaw and throat pouch (hinged at the gape), legs (hip, running down −y), feet
 * (toe joint) and the shared jointed wings.
 */

const C = (c: number) => ({ color: c });
const col = (c: number): ColorFn => () => new THREE.Color(c);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface BillSpec {
  z0: number;
  y0: number;
  len: number;
  h0: number;
  h1: number;
  w0: number;
  w1: number;
  curve: number;
  hook: number;
  segs: number;
  /** Flatten the top (pelican) instead of a ridged culmen (heron dagger). */
  flat?: boolean;
}

/** A tapered bill (or mandible) running forward along +z, with an optional hooked tip. */
function billGeo(o: BillSpec): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 2, o.segs);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getZ(i) + 0.5;
    const v = p.getY(i) + 0.5;
    const h = lerp(o.h0, o.h1, u), w = lerp(o.w0, o.w1, u);
    let y = o.y0 + (v - 0.5) * h - o.curve * u * u;
    if (u > 0.8) y -= o.hook * ((u - 0.8) / 0.2) ** 2 * (0.3 + 0.7 * v);
    const x = p.getX(i) * w * (!o.flat && v > 0.75 ? 0.55 : 1);
    p.setXYZ(i, x, y, o.z0 + u * o.len);
  }
  return g;
}

/** Leg segment hanging from its joint, with a rounded joint at the top. */
function legSeg(len: number, r0: number, r1: number, color: number | ColorFn): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(r0 * 1.15, 0), { color });
  b.add(P.cyl(r1, r0, len, 5), { color }, M.t(0, -len / 2, 0));
  return facet(b.build());
}

// ---------------- Pelican ----------------

export const PEL = {
  body: 0.07,
  /** Neck segment lengths, leg length and wing root in the body frame. */
  neck: [0.075, 0.06] as [number, number],
  neckBase: [0, 0.035, 0.085] as [number, number, number],
  hip: [0, -0.045, -0.005] as [number, number, number],
  leg: 0.075,
  wingRoot: [0.045, 0.028, 0.035] as [number, number, number],
  /** Hinge of the lower jaw in the head frame. */
  gape: [0, -0.004, 0.016] as [number, number, number],
};

/** A brown pelican: silver-streaked grey back, dark grey-brown belly. */
const PEL_C = { back: 0xaaa497, streak: 0xd8d2c4, belly: 0x76675a, tail: 0x5e564c };

export function pelicanBody(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const back = new THREE.Color(PEL_C.back), streak = new THREE.Color(PEL_C.streak), belly = new THREE.Color(PEL_C.belly);
  // Heavy, deep-chested body: smooth, with silvery streaks along the back and a dark belly.
  b.add(animalForm([
    [-0.14, 0.009, 0.02, 0.013, 0.012], [-0.11, 0.004, 0.042, 0.03, 0.032], [-0.07, 0, 0.064, 0.05, 0.052],
    [-0.02, -0.004, 0.077, 0.062, 0.062], [0.03, -0.006, 0.079, 0.064, 0.063], [0.07, 0.003, 0.06, 0.054, 0.052],
    [0.095, 0.016, 0.038, 0.038, 0.036], [0.112, 0.026, 0.022, 0.024, 0.024],
  ], 16, true), { color: (p, n) => {
    if (n.y < -0.25) return belly.clone().lerp(back, THREE.MathUtils.smoothstep(n.y, -0.5, -0.25) * 0.4);
    const c = back.clone();
    return Math.sin(p.x * 220) > 0.55 && n.y > 0.3 ? c.lerp(streak, 0.5) : c;
  } });
  // Short, rounded dark tail fan.
  for (let i = -2; i <= 2; i++) b.add(P.sphere(0.02, 1), C(PEL_C.tail), M.t(i * 0.009, 0.01, -0.14, 0, i * 0.13, 0, 0.42, 0.16, 1.7 - Math.abs(i) * 0.15));
  return b.build();
}

/** The folded wings a pelican wears at rest: silvery coverts, dark flight feathers over the tail. */
export function pelicanFold(): THREE.BufferGeometry {
  return foldedWings({ z0: 0.08, z1: -0.18, x: 0.052, y: 0.026, depth: 0.036, thick: 0.014, inward: 0.11, droop: 0.012,
    covert: 0xbab3a5, flight: 0x857c70, tip: 0x3c3630, edge: 0xe2dccf });
}

export function pelicanNeck(k: 0 | 1): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const L = PEL.neck[k];
  // Thick neck: a chestnut stripe down the back, white in front.
  const neckCol: ColorFn = (p) => new THREE.Color(p.z < -0.007 ? 0x6b4127 : 0xf1ece0);
  b.add(P.uvSphere(k ? 0.02 : 0.026, 12, 8), { color: neckCol });
  b.add(P.cyl(k ? 0.018 : 0.021, k ? 0.022 : 0.028, L, 12), { color: neckCol }, M.t(0, L / 2, 0));
  return b.build();
}

/**
 * Head with the upper mandible: a long white head washed yellow on the crown, a pale eye in bare
 * pink skin, and the long flat bill, grey-pink at the base warming to orange, with a red hooked nail.
 */
export function pelicanHead(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.028, 2), { color: (p) => new THREE.Color(p.y > 0.022 ? 0xf0dc8a : 0xf6f2e6) }, M.t(0, 0.008, 0.002, 0, 0, 0, 0.92, 0.95, 1.18));
  for (const x of [-1, 1]) {
    b.add(P.sphere(0.009, 1), C(0xd6a49a), M.t(x * 0.0205, 0.011, 0.016, 0, 0, 0, 0.5, 0.8, 1.25));
    b.add(P.sphere(0.0048, 1), C(0xf2eed2), M.t(x * 0.0235, 0.0125, 0.017));
    b.add(P.sphere(0.0024, 1), C(0x121212), M.t(x * 0.026, 0.013, 0.0175));
  }
  const up: BillSpec = { z0: 0.014, y0: 0.004, len: 0.2, h0: 0.011, h1: 0.005, w0: 0.03, w1: 0.012, curve: 0.003, hook: 0.011, segs: 8, flat: true };
  b.add(billGeo(up), { color: (p) => new THREE.Color(p.z > 0.2 ? 0xb4321e : p.z > 0.13 ? 0xd9893e : p.z > 0.07 ? 0xc89c74 : 0xb79c90) });
  // A darker ridge down the middle of the bill.
  b.add(P.box(0.005, 0.003, 0.17), C(0x9a7458), M.t(0, 0.0095, 0.11, -0.018, 0, 0));
  return b.build();
}

/**
 * Lower jaw with the throat pouch slung between its two thin mandibles, from the gape hinge.
 * The pouch is its own rounded bag underneath so it can be distended (scaled in y) when full.
 */
export function pelicanJaw(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (const x of [-1, 1]) b.add(P.box(0.005, 0.005, 0.19), C(0xc49a74), M.t(x * 0.012, -0.004, 0.095, 0, x * -0.02, 0));
  b.add(P.box(0.02, 0.004, 0.012), C(0xb4321e), M.t(0, -0.002, 0.188));
  // Pouch: bare olive-grey skin, deepest near the throat, tapering toward the tip.
  b.add(P.sphere(0.04, 2), { color: (p) => new THREE.Color(p.z < 0.06 ? 0x4f4a3e : 0x6a6450) }, M.t(0, -0.017, 0.088, 0.06, 0, 0, 0.5, 0.55, 2.25));
  return b.build();
}

/** Short, stout dark leg (tarsus) from the hip. */
export function pelicanLeg(): THREE.BufferGeometry {
  return legSeg(PEL.leg, 0.011, 0.008, 0x3e3a36);
}

/** Big totipalmate foot: all four toes joined by the web; pivot at the toe joint. */
export function pelicanFoot(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.009, 0), C(0x3a3632));
  for (const a of [-0.55, -0.18, 0.18, 0.55]) b.add(P.box(0.006, 0.006, 0.05), C(0x34302c), M.t(Math.sin(a) * 0.025, -0.003, Math.cos(a) * 0.025, 0, a, 0));
  b.add(P.cone(0.03, 0.05, 3), C(0x403a34), M.t(0, -0.004, 0.024, Math.PI / 2, 0, 0, 1, 1, 0.1));
  return facet(b.build());
}

const pelUpper: ColorFn = (p, n) => new THREE.Color(n.y > 0.1 ? (p.z < -0.06 ? 0x5e574e : 0x958e82) : 0xb8b0a4);
const pelTip: ColorFn = (p, n) => new THREE.Color(p.x > 0.05 ? 0x26221e : n.y > 0.1 ? 0x6e675e : 0x9a9286);
export const PELICAN_WING: WingSpec = {
  thick: 0.016,
  fingers: 5,
  segs: [
    { len: 0.11, c0: 0.114, c1: 0.105, sweep: 0.0, color: pelUpper },
    { len: 0.1, c0: 0.105, c1: 0.09, sweep: 0.012, color: pelUpper },
    { len: 0.13, c0: 0.09, c1: 0.05, sweep: 0.03, color: pelTip },
  ],
};

// ---------------- Heron ----------------

export const HER = {
  /** Three neck segments, so the neck can coil into an S and shoot straight out. */
  neck: [0.058, 0.06, 0.054] as [number, number, number],
  neckBase: [0, 0.02, 0.07] as [number, number, number],
  hip: [0.018, -0.02, -0.005] as [number, number, number],
  /** Upper (feathered tibia) and lower (bare, long tarsus) leg lengths. */
  legU: 0.075,
  legL: 0.16,
  wingRoot: [0.03, 0.025, 0.035] as [number, number, number],
};

/** A great blue heron: blue-grey back, paler grey underparts, white face and a black crown stripe. */
const HER_C = { back: 0x6c7d8a, belly: 0xa4aeb5, plume: 0xc6ccce, dark: 0x1e2328 };

export function heronBody(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const back = new THREE.Color(HER_C.back), belly = new THREE.Color(HER_C.belly);
  // A slim, smooth body, deepest at the shoulders.
  b.add(animalForm([
    [-0.105, 0.012, 0.01, 0.007, 0.007], [-0.08, 0.008, 0.026, 0.022, 0.022], [-0.04, 0.002, 0.04, 0.036, 0.038],
    [0.01, 0, 0.044, 0.04, 0.042], [0.05, 0.006, 0.038, 0.036, 0.04], [0.078, 0.016, 0.024, 0.026, 0.028], [0.092, 0.022, 0.014, 0.016, 0.016],
  ], 16, true), { color: (_p, n) => back.clone().lerp(belly, THREE.MathUtils.smoothstep(-n.y, -0.1, 0.5)) });
  // Black patches at the bend of each folded wing.
  for (const x of [-1, 1]) b.add(P.sphere(0.011, 1), C(HER_C.dark), M.t(x * 0.04, 0.006, 0.058, 0, 0, 0, 0.45, 0.9, 1.3));
  // Soft breast plumes hanging from the base of the neck, and long back plumes over the tail.
  for (let k = 0; k < 3; k++) b.add(P.sphere(0.012, 1), C(k === 1 ? HER_C.plume : 0xb6bec2), M.t((k - 1) * 0.011, -0.026, 0.074, 0.35, 0, (k - 1) * 0.15, 0.6, 2.0, 0.45));
  for (let k = 0; k < 3; k++) b.add(P.sphere(0.012, 1), C(k === 1 ? 0x9aa6ae : 0x86929b), M.t((k - 1) * 0.012, 0.024, -0.09, -0.12, (k - 1) * 0.12, 0, 0.6, 0.3, 4));
  return b.build();
}

/** The folded wings a heron wears at rest: blue-grey coverts, slate flight feathers. */
export function heronFold(): THREE.BufferGeometry {
  return foldedWings({ z0: 0.07, z1: -0.125, x: 0.036, y: 0.02, depth: 0.03, thick: 0.01, inward: 0.08, droop: 0.008,
    covert: 0x748591, flight: 0x4c5864, tip: 0x20262c, edge: 0x9eacb4 });
}

export function heronNeck(k: 0 | 1 | 2): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const L = HER.neck[k];
  const r0 = [0.016, 0.0125, 0.0105][k], r1 = [0.0125, 0.0105, 0.0095][k];
  const col = new THREE.Color(k === 2 ? 0xe6e8e4 : k === 1 ? 0xd2d6d4 : 0xbcc2c4);
  b.add(P.uvSphere(r0 * 0.98, 10, 8), { color: col });
  b.add(P.cyl(r1, r0, L, 10), { color: col }, M.t(0, L / 2, 0));
  // A fine dark streak down the front of the neck.
  b.add(P.box(0.0022, L * 0.9, 0.002), C(0x50565e), M.t(0, L / 2, (r0 + r1) / 2 - 0.0002));
  return b.build();
}

/**
 * Head: a smooth white face with a black stripe from the eye back into two slender plumes, a
 * golden eye, and the long yellow dagger bill, darker along its ridge.
 */
export function heronHead(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.018, 2), C(0xf2f2ee), M.t(0, 0, 0.002, 0, 0, 0, 0.95, 0.9, 1.3));
  for (const x of [-1, 1]) {
    b.add(P.sphere(0.008, 1), C(HER_C.dark), M.t(x * 0.012, 0.009, -0.006, 0, 0, 0, 0.4, 0.5, 2.6));
    b.add(P.cone(0.0028, 0.075, 6), C(HER_C.dark), M.t(x * 0.004, 0.01, -0.052, -1.82 - x * 0.06, 0, 0));
    b.add(P.sphere(0.0042, 1), C(0xf0c22c), M.t(x * 0.0146, 0.0045, 0.012));
    b.add(P.sphere(0.0021, 1), C(0x0e0e0e), M.t(x * 0.0172, 0.005, 0.0132));
  }
  const bill: BillSpec = { z0: 0.016, y0: -0.002, len: 0.115, h0: 0.011, h1: 0.0018, w0: 0.0095, w1: 0.0018, curve: 0, hook: 0, segs: 6 };
  b.add(billGeo(bill), { color: (p) => new THREE.Color(p.y > 0.001 && p.z < 0.09 ? 0x7d6e34 : 0xe6b83c) });
  return b.build();
}

export function heronLegUpper(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.0105, 1), C(0x8e989c));
  b.add(P.cyl(0.006, 0.01, HER.legU, 7), { color: (p) => new THREE.Color(p.y > -HER.legU * 0.55 ? 0x8e989c : 0x9a925c) }, M.t(0, -HER.legU / 2, 0));
  return b.build();
}

/** Long bare lower leg (tarsus) down to the toe joint; the toes are a separate foot part. */
export function heronLegLower(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const L = HER.legL;
  b.add(P.sphere(0.0062, 1), C(0x958d58));
  b.add(P.cyl(0.0038, 0.0048, L, 6), C(0x9a925c), M.t(0, -L / 2, 0));
  return b.build();
}

/** Three long spread forward toes and a hind toe, from the toe joint. */
export function heronFoot(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.005, 0), C(0x847c4c));
  for (const a of [-0.45, 0, 0.45]) b.add(P.box(0.003, 0.003, 0.048), C(0x847c4c), M.t(Math.sin(a) * 0.022, -0.002, Math.cos(a) * 0.022, 0, a, 0));
  b.add(P.box(0.003, 0.003, 0.026), C(0x847c4c), M.t(0, -0.002, -0.012));
  return facet(b.build());
}

const herUpper: ColorFn = (_p, n) => new THREE.Color(n.y > 0.1 ? 0x748591 : 0x9aa4aa);
const herTip: ColorFn = (p) => new THREE.Color(p.x > 0.04 ? 0x20262c : 0x56626c);
export const HERON_WING: WingSpec = {
  thick: 0.012,
  fingers: 4,
  segs: [
    { len: 0.095, c0: 0.085, c1: 0.082, sweep: 0.0, color: herUpper },
    { len: 0.09, c0: 0.082, c1: 0.075, sweep: 0.01, color: herUpper },
    { len: 0.11, c0: 0.075, c1: 0.042, sweep: 0.028, color: herTip },
  ],
};

/** A small silver fish held crosswise in a bill while swallowing. */
export function heldFish(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.02, 1), { color: (p) => new THREE.Color(p.y > 0 ? 0x5a8a94 : 0xdce6e4) }, M.t(0, 0, 0, 0, 0, 0, 2.3, 0.7, 0.45));
  b.add(P.cone(0.014, 0.022, 3), { color: col(0x7aa0a8) }, M.t(-0.055, 0, 0, 0, 0, Math.PI / 2, 1, 1, 0.3));
  return facet(b.build());
}
