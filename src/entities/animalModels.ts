import * as THREE from 'three';
import { animalForm, type AnimalSection } from './animalForm';
import { ColorFn, GeoBuilder, M, P, facet, tube, outward } from '../render/GeoBuilder';

/**
 * Animal parts, in world units (islanders stand ~0.62 tall). Chickens use rounded
 * surfaces and smooth normals; the other species retain their faceted forms.
 * Vertices tagged mat 2 are the "coat" and take a per-animal colour (so one mesh serves
 * white, brown and black chickens, pink and dark pigs, and so on). Parts face +z.
 */

const COAT = { color: 0xffffff, mat: 2 };
const coat = (shade: number) => ({ color: new THREE.Color(shade, shade, shade), mat: 2 });
const C = (c: number) => ({ color: c });

type V3 = [number, number, number];
const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3(0, 0, 1);

/** Place a +y-axis primitive of height |b − a| so it runs from a to b (sx, sz scale its cross-section). */
function span(a: V3, b: V3, sx = 1, sz = sx): THREE.Matrix4 {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const q = new THREE.Quaternion().setFromUnitVectors(_up, d.normalize());
  return new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(sx, 1, sz));
}
const dist = (a: V3, b: V3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

/** A tapered cylinder from a to b (radius ra at a, rb at b). */
function limb(b: GeoBuilder, a: V3, c: V3, ra: number, rb: number, col: { color: number | THREE.Color; mat?: number }, seg = 6): void {
  b.add(P.cyl(rb, ra, dist(a, c), seg), col, span(a, c));
}

/** Rotation (Euler XYZ, as M.t) applied to a +y rod of length len whose base sits at `from`. */
function rod(len: number, from: V3, rx: number, ry: number, rz: number, sx = 1, sz = sx): THREE.Matrix4 {
  const c = new THREE.Vector3(0, len / 2, 0).applyEuler(new THREE.Euler(rx, ry, rz));
  return M.t(from[0] + c.x, from[1] + c.y, from[2] + c.z, rx, ry, rz, sx, 1, sz);
}

/** A flattened blob lying on a surface with the given outward normal. */
function onSurface(p: V3, n: V3, sx: number, sy: number, sz: number): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromUnitVectors(_fwd, new THREE.Vector3(n[0], n[1], n[2]).normalize());
  return new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[1], p[2]), q, new THREE.Vector3(sx, sy, sz));
}

// ---------------- Chickens ----------------

/**
 * Chicken skeleton (body frame: origin on the ground under the hips, facing +z). The neck,
 * head, both three-piece legs and the jointed wings (birdWings) hang off these joints.
 */
export const CHICKEN = {
  /** Hip joints. */
  hipY: 0.066, hipX: 0.026,
  /** Neck base on the body, neck length (the head sits on its top). */
  neckY: 0.122, neckZ: 0.052, neck: 0.058,
  /** Drumstick (hip → hock) and scaly shank (hock → ankle) lengths; ankle height standing on the toes. */
  thigh: 0.034, shank: 0.042, ankle: 0.0065,
};

/** Rounded chicken primitives keep interpolated normals through the shared instance batches. */
const chickenSphere = (r: number, detail = 0) => P.uvSphere(r, detail ? 20 : 12, detail ? 14 : 8);
function chickenForm(sections: AnimalSection[]): THREE.BufferGeometry {
  const ends: AnimalSection[] = [
    [sections[0][0] - .012, sections[0][1], .001, .001, .001],
    ...sections,
    [sections.at(-1)![0] + .012, sections.at(-1)![1], .001, .001, .001],
  ];
  const shape = new THREE.CatmullRomCurve3(ends.map(s => new THREE.Vector3(s[0], s[1], s[2])));
  const radii = new THREE.CatmullRomCurve3(ends.map(s => new THREE.Vector3(s[0], s[3], s[4])));
  const rings: AnimalSection[] = [];
  for (let k = 0; k <= 36; k++) {
    const p = shape.getPoint(k / 36), r = radii.getPoint(k / 36);
    rings.push([p.x, p.y, Math.max(.001, p.z), Math.max(.001, r.y), Math.max(.001, r.z)]);
  }
  return animalForm(rings, 28, true);
}

/**
 * A smooth feather blade from its root (origin) along +y to the tip at len: broadest about a
 * third of the way out and tapering to a point, thin across x and broad along z, the tip
 * curling by `curl` toward +z (and by `bend` toward +x, along and across the blade).
 */
function feather(len: number, w: number, thick: number, curl = 0, bend = 0): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(.5, 8, 12);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getY(i) + .5, ring = Math.hypot(p.getX(i), p.getZ(i));
    const cx = ring > 1e-6 ? p.getX(i) / ring : 0, cz = ring > 1e-6 ? p.getZ(i) / ring : 0;
    const prof = Math.sin(Math.PI * Math.pow(u, 0.7));
    // Bent across the blade too (bend, along x), so it can wrap round a rounded body.
    const zz = cz * w * .5 * prof;
    p.setXYZ(i, cx * thick * .5 * (.35 + .65 * prof) + bend * (u * u + 4 * (zz / w) * (zz / w)), u * len, zz + curl * u * u);
  }
  g.computeVertexNormals();
  return g;
}

/** Smoothstep from e0 to e1 (either way round). */
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Colour tint relative to the coat colour a red cockerel is given (so its palette survives the tint). */
const RED_COAT = new THREE.Color(0x984c28);
const tint = (hex: number) => {
  const c = new THREE.Color(hex);
  return new THREE.Color(c.r / RED_COAT.r, c.g / RED_COAT.g, c.b / RED_COAT.b);
};
const COCK_BREAST = tint(0x231a15), COCK_SADDLE = tint(0xe0a040), COCK_FLANK = tint(0x9a4222);

export function chickenBody(kind: 'hen' | 'speckled' | 'rooster'): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rooster = kind === 'rooster';
  // Profile: a full breast carried forward and a little high, the back sloping up into the raised
  // tail, and a deep fluffy belly that hides the tops of the legs (sections: z, centre, half-width,
  // top, bottom).
  const form = chickenForm([
    [-0.088, 0.135, 0.018, 0.016, 0.018],
    [-0.068, 0.122, 0.040, 0.031, 0.037],
    [-0.038, 0.109, 0.057, 0.042, 0.052],
    [-0.004, 0.102, 0.063, 0.046, 0.056],
    [0.030, 0.102, 0.058, 0.045, 0.054],
    [0.057, 0.109, 0.041, 0.036, 0.044],
    [0.075, 0.118, 0.018, 0.021, 0.025],
  ]);
  const _c = new THREE.Color();
  const shade: (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color = rooster
    // Black breast and underparts, a deep red-brown body and a golden saddle over the back.
    ? (p, n) => {
        const breast = Math.max(smoothstep(0.1, 0.55, n.z) * smoothstep(0.125, 0.095, p.y), smoothstep(-0.25, -0.6, n.y));
        const saddle = smoothstep(0.35, 0.75, n.y) * smoothstep(0.02, -0.03, p.z);
        _c.copy(COCK_FLANK).lerp(COCK_SADDLE, saddle).lerp(COCK_BREAST, breast);
        return _c.clone();
      }
    // Hens: slightly paler breast, a touch darker over the back and toward the tail.
    : (p, n) => {
        const back = smoothstep(0.3, 0.8, n.y) * 0.06 + smoothstep(-0.03, -0.08, p.z) * 0.05;
        const v = 1.02 - back + smoothstep(0.3, 0.8, n.z) * 0.03;
        return _c.setRGB(v, v, v).clone();
      };
  b.add(form, { color: shade, mat: 2 });

  if (rooster) {
    // Saddle hackles: long golden feathers draping from the back down over the tail base.
    for (const side of [-1, 1]) for (let k = 0; k < 5; k++) {
      const z = -0.035 - k * 0.011;
      b.add(feather(0.042 - k * 0.003, 0.016, 0.004, -0.004), { color: COCK_SADDLE, mat: 2 },
        M.t(side * (0.026 + k * 0.002), 0.142 - k * 0.004, z, -2.5 + k * 0.06, 0, -side * (0.5 + k * 0.05)));
    }
    // Main tail: stiff dark feathers fanned upright, then long arching iridescent sickles over them.
    for (let k = 0; k < 6; k++) {
      const x = (k - 2.5) * 0.004;
      b.add(feather(0.085 - Math.abs(k - 2.5) * 0.006, 0.028, 0.004, -0.01), C(0x172825),
        M.t(x, 0.13, -0.078, -0.55 - Math.abs(k - 2.5) * 0.05, 0, -x * 6));
    }
    for (let k = 0; k < 6; k++) {
      const f = 1 - Math.abs(k - 2.5) * 0.1, x = (k - 2.5) * 0.006;
      const pts = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0.07 * f, -0.03 * f),
        new THREE.Vector3(0, 0.11 * f, -0.095 * f),
        new THREE.Vector3(0, 0.085 * f, -0.165 * f),
        new THREE.Vector3(0, 0.03 * f, -0.2 * f),
      ];
      // Flattened into broad ribbons, each splayed a little out to its side.
      b.add(outward(tube(pts, (t) => 0.009 * (1 - t * 0.8), 10, 18)), C(k % 2 ? 0x24584a : 0x12302f),
        M.t(x, 0.128, -0.074, 0, x * 5, 0, 0.42, 1, 1));
    }
  } else {
    // Hen's tail: two fans of broad feathers forming a tent, rising from the rump.
    for (const side of [-1, 1]) for (let j = 0; j < 4; j++) {
      const len = 0.062 - j * 0.005;
      b.add(feather(len, 0.03 - j * 0.002, 0.004, -0.006), coat(0.95 - j * 0.04),
        M.t(side * (0.004 + j * 0.003), 0.128, -0.074 + j * 0.003, -0.6 - j * 0.22, 0, -side * (0.12 + j * 0.1)));
    }
  }
  if (kind === 'speckled') {
    // Dark flecks lying on the plumage.
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 26; k++) {
      const a = rnd() * Math.PI * 2, e = (rnd() - 0.35) * 1.1;
      const n: V3 = [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
      const p: V3 = [n[0] * 0.061, 0.103 + n[1] * 0.048, -0.004 + n[2] * 0.075];
      b.add(chickenSphere(0.008, 0), C(0x3a3028), onSurface(p, n, 1.2, 0.8, 0.3));
    }
  }
  return b.build();
}

/**
 * The wings as they usually are, folded flat along the flanks: a smooth teardrop of coverts from the
 * shoulder tapering back to the crossed flight feathers above the tail. Drawn in place of the
 * jointed wings (birdWings) whenever those are tucked away.
 */
export function chickenFoldedWings(rooster: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const z0 = 0.046, len = 0.1;
  for (const side of [-1, 1]) {
    const dir = new THREE.Vector3(-side * 0.04, -0.2, -1).normalize();
    const up = new THREE.Vector3(side * 0.18, 1, 0);
    const x = new THREE.Vector3().crossVectors(dir, up).normalize();
    const zz = new THREE.Vector3().crossVectors(x, dir).normalize();
    const m = new THREE.Matrix4().makeBasis(x, dir, zz).setPosition(side * 0.053, 0.121, z0);
    // Coverts in the coat colour, the flight feathers darkening toward the tip.
    const shade: ColorFn = (p) => {
      const u = THREE.MathUtils.clamp((z0 - p.z) / len, 0, 1);
      const v = THREE.MathUtils.lerp(0.97, 0.66, smoothstep(0.45, 0.95, u));
      return rooster ? COCK_FLANK.clone().multiplyScalar(v) : new THREE.Color(v, v, v);
    };
    b.add(feather(len, 0.056, 0.009, 0.004, -side * 0.012), { color: shade, mat: 2 }, m);
  }
  return b.build();
}

/** Neck from its base on the shoulders (pivot) up to the head joint at y = CHICKEN.neck, with a cape of hackles. */
export function chickenNeck(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const L = CHICKEN.neck;
  // A smooth column, thick where it leaves the body and slimmer under the head.
  const prof = [[0.001, -0.016], [0.026, -0.012], [0.029, 0], [0.025, L * 0.35], [0.019, L * 0.75], [0.017, L], [0.001, L + 0.012]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  b.add(new THREE.LatheGeometry(new THREE.SplineCurve(prof).getPoints(16), 20), COAT, M.t(0, 0, 0, 0, 0, 0, 1, 1, 1.08));
  // Hackles: long pointed feathers from high on the neck lying down over the shoulders, longest behind.
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2, back = 0.5 - 0.5 * Math.cos(a);
    const len = 0.022 + back * 0.034;
    b.add(feather(len, 0.016, 0.004, 0), coat(k % 2 ? 0.92 : 1),
      M.t(Math.sin(a) * 0.017, L * 0.78, Math.cos(a) * 0.017, Math.PI - 0.3 * Math.cos(a), 0, -0.3 * Math.sin(a), 1, 1, 1));
  }
  return b.build();
}

export function chickenHead(rooster: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const s = rooster ? 1.12 : 1;
  const RED = 0xd1291d;
  // Neat, slightly long skull with full cheeks.
  b.add(chickenSphere(0.022 * s, 1), COAT, M.t(0, 0.012 * s, 0.006 * s, -0.15, 0, 0, 0.86, 0.94, 1.2));
  // Hooked beak: upper mandible over a shorter lower one, with a cere at the base.
  b.add(P.cone(0.0085 * s, 0.024 * s, 14), C(0xe8b030), M.t(0, 0.009 * s, 0.037 * s, Math.PI / 2 + 0.3, 0, 0, 1, 1, 0.7));
  b.add(P.cone(0.0062 * s, 0.016 * s, 12), C(0xcf9424), M.t(0, 0.002 * s, 0.033 * s, Math.PI / 2 + 0.05, 0, 0, 1, 1, 0.6));
  b.add(chickenSphere(0.006 * s, 0), C(0xd9a02c), M.t(0, 0.013 * s, 0.026 * s, 0, 0, 0, 1.1, 0.7, 0.8));
  // Single comb: a fleshy blade along the crown with rounded points, tallest just behind the beak.
  const n = rooster ? 5 : 4, combH = rooster ? 0.03 : 0.011, combL = (rooster ? 0.05 : 0.03) * s;
  b.add(chickenSphere(0.5, 1), C(RED), M.t(0, 0.031 * s + (rooster ? 0.006 : 0.002), 0.008 * s, 0.1, 0, 0, 0.0068 * s, (rooster ? 0.026 : 0.012) * s, combL));
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const h = combH * (1 - Math.abs(t - 0.35) * 0.75) * s;
    const z = 0.01 * s + combL * (0.42 - t * 0.9);
    b.add(chickenSphere(0.5, 0), C(RED), M.t(0, 0.034 * s + (rooster ? 0.007 : 0.002) + h * 0.5, z, -0.35 * (t - 0.3), 0, 0, 0.0058 * s, h, 0.0112 * s));
  }
  for (const x of [-1, 1]) {
    // Wattles hanging under the beak (long on the cockerel), and small earlobes behind the eyes.
    const w = rooster ? 1.7 : 1;
    b.add(chickenSphere(0.0075 * s, 0), C(RED), M.t(x * 0.0045 * s, -0.006 * s - 0.006 * w, 0.025 * s, 0.25, 0, 0, 0.55, 1.2 * w, 0.85));
    b.add(chickenSphere(0.0055 * s, 0), C(0xc9372a), M.t(x * 0.0175 * s, 0.001 * s, -0.004 * s, 0, 0, 0, 0.4, 1.2, 0.9));
    // Bare red face round the eye, the amber iris, a black pupil and a glint.
    b.add(chickenSphere(0.0105 * s, 0), C(RED), M.t(x * 0.0165 * s, 0.012 * s, 0.017 * s, 0, 0, 0, 0.32, 0.85, 1.25));
    b.add(chickenSphere(0.0052 * s, 1), C(0xe39a2a), M.t(x * 0.0192 * s, 0.016 * s, 0.015 * s, 0, 0, 0, 0.45, 1, 1));
    b.add(chickenSphere(0.0029 * s, 0), C(0x111114), M.t(x * 0.0213 * s, 0.016 * s, 0.0155 * s, 0, 0, 0, 0.4, 1, 1));
    b.add(chickenSphere(0.0011 * s, 0), C(0xfff2d5), M.t(x * 0.0222 * s, 0.0172 * s, 0.0168 * s));
    // Nostril.
    b.add(chickenSphere(0.0016 * s, 0), C(0x6a4a20), M.t(x * 0.0035 * s, 0.0135 * s, 0.031 * s, 0, 0, 0, 0.5, 0.6, 1));
  }
  return b.build();
}

/** Chicken leg pieces: [feathered drumstick from the hip, scaly shank from the hock, toes from the ankle]. */
export function chickenLegParts(): [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry] {
  const Y = 0xe8b030, Yd = 0xc98e1e, CLAW = 0x5a4632;
  const L = CHICKEN;
  // Drumstick: a plump feathered thigh narrowing to fluffy "trousers" at the hock.
  const thigh = new GeoBuilder();
  thigh.add(chickenSphere(0.017, 1), COAT, M.t(0, -0.008, 0.002, 0, 0, 0, 0.95, 1.2, 1.1));
  thigh.add(P.cyl(0.0095, 0.0145, L.thigh * 0.75, 14), coat(0.96), M.t(0, -L.thigh * 0.62, 0));
  thigh.add(chickenSphere(0.0098, 0), coat(0.94), M.t(0, -L.thigh + 0.004, 0, 0, 0, 0, 1, 0.9, 1));
  // Shank: the hock joint, scaled shin and (for all birds) a little nub of a spur.
  const shank = new GeoBuilder();
  shank.add(chickenSphere(0.0068, 1), C(Y), M.t(0, 0, 0));
  shank.add(P.cyl(0.0052, 0.0058, L.shank, 14), C(Y), M.t(0, -L.shank / 2, 0));
  for (let k = 0; k < 4; k++) shank.add(P.cyl(0.0062, 0.0062, 0.002, 14), C(Yd), M.t(0, -0.008 - k * 0.009, 0.0008));
  shank.add(P.cone(0.0022, 0.006, 8), C(Yd), M.t(0, -L.shank * 0.72, -0.0055, -Math.PI / 2 - 0.3, 0, 0));
  // Foot: three jointed forward toes spread in a fan and a short hind toe, each ending in a claw.
  const foot = new GeoBuilder();
  foot.add(chickenSphere(0.0062, 1), C(Y), M.t(0, -0.001, 0));
  const ground = -L.ankle + 0.0026;
  for (const a of [-0.55, 0, 0.55]) {
    const len = a === 0 ? 0.032 : 0.027, sa = Math.sin(a), ca = Math.cos(a);
    for (let j = 0; j < 3; j++) {
      const u0 = j / 3, u1 = (j + 1) / 3, r = 0.0032 - j * 0.0004;
      const p0: V3 = [sa * len * u0, ground + 0.0012 * (1 - u0), ca * len * u0];
      const p1: V3 = [sa * len * u1, ground, ca * len * u1];
      limb(foot, p0, p1, r, r * 0.9, C(Y), 10);
      foot.add(chickenSphere(r * 1.12, 0), C(Yd), M.t(...p1));
    }
    foot.add(P.cone(0.0024, 0.007, 8), C(CLAW), M.t(sa * (len + 0.003), ground - 0.0006, ca * (len + 0.003), Math.PI / 2 + 0.25, a, 0));
  }
  limb(foot, [0, ground + 0.002, 0], [0, ground, -0.012], 0.003, 0.0026, C(Y), 10);
  foot.add(P.cone(0.0022, 0.006, 8), C(CLAW), M.t(0, ground - 0.0005, -0.0145, -Math.PI / 2 - 0.25, 0, 0));
  return [thigh.build(), shank.build(), foot.build()];
}

// ---------------- Smooth quadruped parts ----------------

/** Round primitives and shared normals: the farm animals and monkeys are soft-shaded like the chickens. */
const ball = (r: number) => P.uvSphere(r, 18, 12);
const soft = (b: GeoBuilder) => b.build();

/** A body form through the given sections, smoothed into many rings (z, centre, half-width, top, bottom). */
function smoothForm(sections: AnimalSection[], rings = 48, sides = 36): THREE.BufferGeometry {
  const shape = new THREE.CatmullRomCurve3(sections.map(s => new THREE.Vector3(s[0], s[1], s[2])));
  const radii = new THREE.CatmullRomCurve3(sections.map(s => new THREE.Vector3(s[0], s[3], s[4])));
  const out: AnimalSection[] = [];
  for (let k = 0; k <= rings; k++) {
    const p = shape.getPoint(k / rings), r = radii.getPoint(k / rings);
    out.push([p.x, p.y, Math.max(.001, p.z), Math.max(.001, r.y), Math.max(.001, r.z)]);
  }
  return animalForm(out, sides, true);
}

/** A pair of eyes on the head's sides at (±x, y, z): iris, pupil and a glint. */
function eyes(b: GeoBuilder, x: number, y: number, z: number, r: number, iris: number): void {
  for (const sx of [-1, 1]) {
    b.add(ball(r), C(iris), M.t(sx * x, y, z, 0, 0, 0, 0.6, 1, 1));
    b.add(ball(r * 0.62), C(0x0e0c0b), M.t(sx * (x + r * 0.32), y, z + r * 0.12, 0, 0, 0, 0.5, 1, 1));
    b.add(ball(r * 0.22), C(0xfff6e6), M.t(sx * (x + r * 0.5), y + r * 0.3, z + r * 0.3));
  }
}

// ---------------- Pigs ----------------

/** Pig head (pivot at the neck): broad skull, sagging jowls, tapering snout with a nostril disc. */
export function pigHead(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(ball(0.075), COAT, M.t(0, 0.008, 0.04, 0, 0, 0, 1.08, 0.95, 1.05));
  for (const x of [-1, 1]) b.add(ball(0.04), coat(0.95), M.t(x * 0.042, -0.034, 0.045, 0, 0, 0, 1, 0.85, 1.15));
  b.add(ball(0.045), coat(0.93), M.t(0, -0.046, 0.02, 0, 0, 0, 1.1, 0.7, 1.2));
  b.add(P.cyl(0.033, 0.048, 0.075, 14), coat(0.9), M.t(0, -0.012, 0.11, Math.PI / 2, 0, 0, 1, 1, 0.9));
  b.add(P.cyl(0.036, 0.034, 0.014, 14), coat(0.74), M.t(0, -0.013, 0.152, Math.PI / 2, 0, 0, 1.05, 1, 0.88));
  eyes(b, 0.043, 0.038, 0.093, 0.008, 0x3a2418);
  return soft(b);
}

/** Floppy ear (pivot at its root, pointing +y, inner face toward +z). */
export function pigEar(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(ball(0.036), coat(0.84), M.t(0, 0.03, 0, 0.25, 0, 0, 0.84, 1.2, 0.24));
  b.add(ball(0.026), coat(0.98), M.t(0, 0.033, 0.006, 0.25, 0, 0, 0.83, 1.25, 0.15));
  return soft(b);
}

/** Corkscrew tail (pivot at the root, coiling back along −z). */
export function pigTail(): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10, a = t * Math.PI * 3.2, r = 0.011 * (1 - t * 0.35);
    pts.push(new THREE.Vector3(Math.sin(a) * r, 0.004 + t * 0.01 + (1 - Math.cos(a)) * r * 0.9, -0.003 - t * 0.03));
  }
  const b = new GeoBuilder();
  b.add(tube(pts, (t) => 0.0056 * (1 - t * 0.45), 10, 16), coat(0.9));
  return soft(b);
}

// ---------------- Goats ----------------

/** Goat neck (pivot at the shoulders, running along +z to the head joint at z = 0.15). */
export function goatNeck(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.03, 0.047, 0.17, 14), COAT, M.t(0, 0, 0.07, Math.PI / 2, 0, 0, 0.88, 1, 1.15));
  b.add(P.rbox(0.012, 0.016, 0.15, 0.005, 3), coat(0.82), M.t(0, 0.036, 0.07, 0.08, 0, 0));
  b.add(ball(0.03), coat(0.95), M.t(0, -0.03, 0.1, 0, 0, 0, 0.85, 1, 1.25));
  return soft(b);
}

/** Goat head (pivot at the poll, where the neck ends): long plain face, beard and horns. */
export function goatHead(curly: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const HORN = 0x6e5a40;
  b.add(ball(0.042), COAT, M.t(0, 0, 0.03, 0, 0, 0, 0.85, 0.95, 1.15));
  b.add(P.cyl(0.02, 0.03, 0.075, 14), COAT, M.t(0, -0.014, 0.085, Math.PI / 2, 0, 0));
  b.add(ball(0.021), coat(0.72), M.t(0, -0.016, 0.12, 0, 0, 0, 1, 0.9, 0.9));
  // Beard hanging from the chin.
  b.add(P.cone(0.013, 0.055, 10), coat(0.7), span([0, -0.034, 0.088], [0, -0.088, 0.096], 1, 0.6));
  for (const x of [-1, 1]) {
    const s = x;
    let pts: THREE.Vector3[];
    if (curly) {
      // Ram-like curl: up and back, then down and forward beside the ear.
      pts = [];
      for (let k = 0; k <= 7; k++) {
        const t = k / 7, th = 1.2 - t * 4.2, r = 0.036 + t * 0.012;
        pts.push(new THREE.Vector3(s * (0.016 + t * 0.03), 0.034 + r * Math.cos(th) - 0.036 * Math.cos(1.2), 0.02 + r * Math.sin(th) - 0.036 * Math.sin(1.2)));
      }
    } else {
      // Scimitar horns sweeping up and back.
      pts = [
        new THREE.Vector3(s * 0.016, 0.034, 0.02),
        new THREE.Vector3(s * 0.022, 0.064, -0.015),
        new THREE.Vector3(s * 0.03, 0.079, -0.065),
        new THREE.Vector3(s * 0.036, 0.074, -0.1),
      ];
    }
    b.add(tube(pts, (t) => 0.011 * (1 - t * 0.72), 5, curly ? 12 : 9), C(HORN));
  }
  eyes(b, 0.02, 0.014, 0.064, 0.0068, 0xc89a2c);
  return soft(b);
}

/** Goat ear: a leaf held out sideways (pivot at the root, pointing +y, inner face +z). */
export function goatEar(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(ball(0.02), coat(0.88), M.t(0, 0.032, 0, 0, 0, 0, 0.85, 1.85, 0.3));
  b.add(ball(0.014), coat(1), M.t(0, 0.033, 0.004, 0, 0, 0, 0.8, 1.85, 0.2));
  return soft(b);
}

/** Short flat up-flicked tail (pivot at the root). */
export function goatTail(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cone(0.02, 0.06, 10), COAT, rod(0.06, [0, 0, 0], -0.55, 0, 0, 1.25, 0.5));
  b.add(P.cone(0.013, 0.04, 10), coat(0.75), rod(0.04, [0, -0.004, -0.006], -0.7, 0, 0, 1.1, 0.5));
  return soft(b);
}

// ---------------- Tapirs ----------------

/** Tapir head (pivot at the neck): long skull with a crest, pale cheeks and jaw (Baird's tapir). */
export function tapirHead(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const PALE = 0xcdbfa6;
  b.add(ball(0.1), COAT, M.t(0, 0.02, 0.06, 0, 0, 0, 0.78, 0.92, 1.25));
  b.add(ball(0.05), COAT, M.t(0, 0.085, 0.02, 0, 0, 0, 0.55, 0.7, 1.5));
  b.add(ball(0.075), C(PALE), M.t(0, -0.045, 0.07, 0, 0, 0, 0.95, 0.6, 1.15));
  b.add(P.cyl(0.045, 0.07, 0.12, 14), coat(0.92), M.t(0, -0.02, 0.18, Math.PI / 2, 0, 0, 0.95, 1, 0.95));
  b.add(ball(0.04), C(PALE), M.t(0, -0.056, 0.2, 0, 0, 0, 0.9, 0.5, 1.3));
  eyes(b, 0.047, 0.055, 0.142, 0.009, 0x2a1c14);
  return soft(b);
}

/** Short trunk-like proboscis (pivot at its root on the muzzle, drooping forward). */
export function tapirTrunk(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const pts = [new THREE.Vector3(0, 0, -0.012), new THREE.Vector3(0, -0.004, 0.035), new THREE.Vector3(0, -0.022, 0.07), new THREE.Vector3(0, -0.05, 0.09)];
  b.add(tube(pts, (t) => 0.042 - t * 0.018, 10, 8), coat(0.84));
  b.add(ball(0.026), coat(0.72), M.t(0, -0.056, 0.093, 0, 0, 0, 1, 0.8, 1));
  return soft(b);
}

/** Small rounded ear with a pale rim (pivot at the root, pointing +y, opening toward +z). */
export function tapirEar(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(ball(0.036), coat(0.9), M.t(0, 0.034, -0.004, 0, 0, 0, 0.8, 1.1, 0.26));
  b.add(ball(0.039), C(0xe2d6c2), M.t(0, 0.035, 0, 0, 0, 0, 0.82, 1.12, 0.2));
  b.add(ball(0.03), C(0x2a221e), M.t(0, 0.033, 0.004, 0, 0, 0, 0.72, 1.0, 0.2));
  return soft(b);
}

/** Leg hanging from the hip / shoulder joint (hoof or foot at the bottom). */
export function legGeometry(len: number, r: number, hoof: number, mat: 'coat' | number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(r * 0.8, r, len, 14), mat === 'coat' ? COAT : C(mat), M.t(0, -len / 2, 0));
  b.add(P.box(r * 2.1, len * 0.12, r * 2.3), C(hoof), M.t(0, -len + len * 0.06, r * 0.3));
  return soft(b);
}

// ---------------- Birds ----------------

export function toucanBody(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.sphere(0.05, 1), C(0x121214), M.t(0, 0, 0, 0, 0, 0, 0.85, 0.9, 1.3));
  b.add(P.sphere(0.034, 0), C(0xf4e6b0), M.t(0, 0.015, 0.042, 0, 0, 0, 1, 1, 0.6));
  b.add(P.sphere(0.036, 1), C(0x121214), M.t(0, 0.04, 0.05));
  // The big banana beak: orange/yellow with a black tip.
  b.add(P.cone(0.024, 0.1, 5), { color: (p) => new THREE.Color(p.z > 0.155 ? 0x151515 : p.y > 0.035 ? 0xf2c230 : 0xf07a1e) }, M.t(0, 0.035, 0.12, Math.PI / 2 + 0.25, 0, 0, 1, 1, 0.8));
  b.add(P.box(0.03, 0.01, 0.1), C(0x121214), M.t(0, -0.01, -0.1, 0.3, 0, 0));
  b.add(P.box(0.03, 0.012, 0.02), C(0xc0281e), M.t(0, -0.03, -0.045));
  for (const x of [-1, 1]) b.add(P.sphere(0.009, 0), C(0x3a8ad8), M.t(x * 0.03, 0.05, 0.065));
  return facet(b.build());
}

export function gullBody(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  // Streamlined body: full chest tapering to the tail, pale grey back, white below.
  const bodyCol: ColorFn = (p, n) => new THREE.Color(n.y > 0.55 && p.z < 0.05 ? 0xb4bcc4 : 0xfafaf6);
  b.add(P.sphere(0.06, 1), { color: bodyCol }, M.t(0, 0, 0.01, 0, 0, 0, 0.72, 0.7, 1.35));
  b.add(P.cone(0.042, 0.1, 6), { color: bodyCol }, M.t(0, 0.004, -0.085, -Math.PI / 2, 0, 0, 1, 1, 0.75));
  // Head on a short neck.
  b.add(P.sphere(0.036, 1), C(0xfafaf6), M.t(0, 0.035, 0.085, 0, 0, 0, 0.92, 0.95, 1.1));
  // Yellow hooked bill with the red spot.
  b.add(P.cone(0.011, 0.055, 4), C(0xf2c030), M.t(0, 0.03, 0.14, Math.PI / 2, 0, 0, 1, 1, 0.8));
  b.add(P.sphere(0.005, 0), C(0xd8342a), M.t(0, 0.022, 0.138));
  // Wedge tail, white with a black band at the tip.
  b.add(P.box(0.055, 0.008, 0.05), C(0xf4f5f2), M.t(0, 0.008, -0.14, 0.08, 0, 0));
  b.add(P.box(0.056, 0.009, 0.014), C(0x1c1c1e), M.t(0, 0.006, -0.168, 0.08, 0, 0));
  for (const x of [-1, 1]) b.add(P.sphere(0.0055, 0), C(0x151010), M.t(x * 0.024, 0.045, 0.1));
  return facet(b.build());
}

export function birdLegs(color: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (const x of [-1, 1]) b.add(P.cyl(0.004, 0.004, 0.05, 3), C(color), M.t(x * 0.015, -0.045, 0));
  return facet(b.build());
}

// ---------------- Jointed quadrupeds (pig, goat, tapir) ----------------

/**
 * Split a faceted body into front and rear halves around the mid-body joint at z = 0 (the
 * halves overlap a little so no gap opens when the spine bends). Geometry must be non-indexed.
 */
export function splitBody(g: THREE.BufferGeometry, spineY: number, ov = 0.035): [THREE.BufferGeometry, THREE.BufferGeometry] {
  g.translate(0, -spineY, 0);
  const pos = g.getAttribute('position');
  const pick = (keep: (cz: number) => boolean) => {
    const out = new THREE.BufferGeometry();
    for (const name of Object.keys(g.attributes)) {
      const a = g.getAttribute(name) as THREE.BufferAttribute;
      const arr: number[] = [];
      for (let i = 0; i < pos.count; i += 3) {
        const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
        if (!keep(cz)) continue;
        for (let k = 0; k < 3; k++) for (let c = 0; c < a.itemSize; c++) arr.push(a.getComponent(i + k, c));
      }
      out.setAttribute(name, new THREE.Float32BufferAttribute(arr, a.itemSize));
    }
    out.computeBoundingSphere();
    return out;
  };
  return [pick((cz) => cz > -ov), pick((cz) => cz < ov)];
}

/**
 * Coat markings painted onto the skin, never floating blobs above it: each vertex inside the
 * marking takes its colour, so the edges blend softly across the smooth body.
 */
function coatPatch(g: THREE.BufferGeometry, color: number, test: (x: number, y: number, z: number) => boolean): THREE.BufferGeometry {
  const p = g.getAttribute('position'), c = g.getAttribute('color'), m = g.getAttribute('aMat');
  const tint = new THREE.Color(color);
  for (let i = 0; i < p.count; i++) {
    if (test(p.getX(i), p.getY(i), p.getZ(i))) { c.setXYZ(i, tint.r, tint.g, tint.b); m.setX(i, 0); }
  }
  return g;
}

/** Pig body: round barrel with an arched back, heavy shoulders and hams, sagging belly; split at the spine joint. */
export function pigBodyHalves(spotted: boolean, spineY: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const b = new GeoBuilder();
  b.add(smoothForm([
    [-0.218,0.178,0.047,0.060,0.052], [-0.16,0.181,0.112,0.106,0.095],
    [-0.075,0.174,0.125,0.121,0.101], [0,0.17,0.12,0.12,0.097],
    [0.08,0.174,0.115,0.108,0.092], [0.16,0.172,0.092,0.087,0.079],
    [0.235,0.165,0.055,0.055,0.05],
  ]), COAT);
  const g=b.build().toNonIndexed();
  if (spotted) {
    // Two dark patches, darkening the coat with soft edges (a little ragged, like real markings).
    const p = g.getAttribute('position'), c = g.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const wob = 1 + 0.12 * Math.sin(z * 90 + y * 60);
      const f = Math.min(
        x > 0.02 ? Math.hypot((z - 0.065) / 0.06, (y - 0.205) / 0.065) * wob : 9,
        x < 0.04 ? Math.hypot((z + 0.11) / 0.065, (y - 0.235) / 0.075) * wob : 9);
      const k = 1 - 0.8 * smoothstep(1.08, 0.86, f);
      c.setXYZ(i, c.getX(i) * k, c.getY(i) * k * 0.95, c.getZ(i) * k * 0.92);
    }
  }
  return splitBody(g,spineY);
}

/** Goat body: narrow deep chest, lean belly, angular hips and a shaggy fringe; split at the spine joint. */
export function goatBodyHalves(patched: boolean, spineY: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const b = new GeoBuilder();
  b.add(smoothForm([
    [-0.205,0.27,0.026,0.044,0.042], [-0.15,0.27,0.063,0.071,0.065],
    [-0.075,0.263,0.061,0.077,0.065], [0,0.256,0.065,0.080,0.068],
    [0.08,0.255,0.075,0.084,0.087], [0.14,0.265,0.063,0.085,0.078],
    [0.205,0.282,0.035,0.048,0.05],
  ]), COAT);
  const g=b.build().toNonIndexed();
  if(patched) coatPatch(g,0xf0ebe0,(_x,y,z) => z>0.065 && z<0.14 || y<0.24 && z< -0.025 && z> -0.11);
  return splitBody(g,spineY);
}

/** Tapir body: low wedge front, heavy high rounded rump, pale throat, stubby tail; split at the spine joint. */
export function tapirBodyHalves(spineY: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const b = new GeoBuilder();
  b.add(smoothForm([
    [-0.405,0.385,0.065,0.09,0.08], [-0.31,0.38,0.173,0.19,0.16],
    [-0.20,0.38,0.204,0.213,0.183], [-0.075,0.36,0.195,0.2,0.19],
    [0.06,0.345,0.181,0.174,0.168], [0.20,0.35,0.16,0.16,0.143],
    [0.32,0.353,0.12,0.119,0.1], [0.44,0.335,0.086,0.08,0.076],
  ]), COAT);
  b.add(P.sphere(0.08,1), C(0xcdbfa6), M.t(0,0.27,0.4,0,0,0,0.9,0.8,1.1));
  // Short bristly mane along the top of the neck.
  b.add(P.rbox(0.022, 0.03, 0.2, 0.009, 3), coat(0.7), M.t(0, 0.47, 0.33, 0.28, 0, 0));
  b.add(P.cone(0.03, 0.06, 10), COAT, M.t(0, 0.43, -0.415, -2.3, 0, 0));
  return splitBody(b.build().toNonIndexed(), spineY);
}

/** Upper or lower leg segment hanging from its joint (rounded joint at the top). */
export function legSegment(len: number, r0: number, r1: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(ball(r0 * 1.0), COAT, M.t(0, 0, 0));
  b.add(P.cyl(r1, r0, len, 14), COAT, M.t(0, -len / 2, 0));
  return soft(b);
}


/** Upper leg (upper arm / thigh) from the shoulder or hip: rounded joint and a muscle bulge. */
export function limbUpper(len: number, r0: number, r1: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(ball(r0 * 1.04), COAT, M.t(0, 0, 0));
  b.add(P.cyl(r1, r0 * 1.02, len, 14), COAT, M.t(0, -len / 2, 0));
  b.add(ball(r0 * 1.02), COAT, M.t(0, -len * 0.38, -r0 * 0.12, 0, 0, 0, 1, 2.2, 1.12));
  return soft(b);
}

/**
 * Foot below the wrist / hock: a knobbly knee or hock joint, cannon, fetlock and a sloping pastern
 * ending in a split hoof with dew claws (pigs, goats) or a padded foot with three hoofed toes (tapirs).
 * The sole sits exactly `len` below the joint.
 */
export function footSegment(len: number, r: number, hoof: number, kind: 'split' | 'toes'): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(ball(r * 1.06), COAT, M.t(0, 0, 0, 0, 0, 0, 1, 1.1, 1.05));
  if (kind === 'split') {
    const hh = len * 0.22;
    const fl = -len + hh + len * 0.14;
    b.add(P.cyl(r * 0.78, r * 0.92, -fl, 14), COAT, M.t(0, fl / 2, 0));
    b.add(ball(r * 0.92), COAT, M.t(0, fl, -r * 0.08));
    b.add(P.cyl(r * 0.72, r * 0.8, len * 0.17, 14), coat(0.9), M.t(0, fl - len * 0.07, r * 0.18, -0.4, 0, 0));
    for (const x of [-1, 1]) {
      b.add(P.cyl(r * 0.4, r * 0.6, hh, 14), C(hoof), M.t(x * r * 0.4, -len + hh / 2, r * 0.38, -0.15, 0, x * 0.06));
      b.add(ball(r * 0.26), C(hoof), M.t(x * r * 0.45, fl - r * 0.1, -r * 0.8));
    }
  } else {
    const fl = -len * 0.7;
    b.add(P.cyl(r * 0.9, r, -fl, 14), COAT, M.t(0, fl / 2, 0));
    b.add(P.cyl(r * 1.12, r * 0.95, len * 0.32, 14), coat(0.85), M.t(0, -len + len * 0.16, r * 0.1));
    b.add(P.cyl(r * 1.08, r * 1.14, len * 0.06, 14), C(0x2a2420), M.t(0, -len + len * 0.03, r * 0.1));
    for (const x of [-0.62, 0, 0.62]) b.add(ball(r * 0.4), C(hoof), M.t(x * r, -len + r * 0.3, r * 0.95, 0, 0, 0, 1, 0.75, 1.2));
  }
  return soft(b);
}

// ---------------- Jointed monkey parts ----------------

/** Geoffroy's spider monkey: golden body, black head cap, forearms, shins, hands and feet. */
export const MONKEY = { gold: 0x96592c, black: 0x1d1714, palm: 0x2c2420 };

/** One limb segment (upper arm, forearm, thigh or shin) hanging from its joint: a smooth taper. */
export function monkeySeg(len: number, r0: number, r1: number, color: number = MONKEY.gold): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(ball(r0 * 1.05), C(color), M.t(0, 0, 0));
  b.add(P.cyl(r1, r0, len, 14), C(color), M.t(0, -len / 2, 0));
  b.add(ball(r1), C(color), M.t(0, -len, 0));
  return soft(b);
}

/**
 * Long, narrow hand or foot from the wrist / ankle (along −y, palm toward +z). Spider monkeys
 * have no thumbs: four long fingers end in a hook for hanging from branches. Feet add a gripping
 * big toe set out to the side.
 */
export function monkeyHand(len: number, foot = false): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(ball(0.0105), C(MONKEY.black), M.t(0, 0, 0));
  b.add(ball(0.5), C(MONKEY.black), M.t(0, -len * 0.42, 0.002, 0, 0, 0, 0.021, len * 0.95, 0.011));
  b.add(ball(0.5), C(MONKEY.palm), M.t(0, -len * 0.45, 0.006, 0, 0, 0, 0.016, len * 0.75, 0.006));
  for (let k = 0; k < 4; k++) {
    const x = (k - 1.5) * 0.0052, l = len * (k === 1 || k === 2 ? 1 : 0.88);
    const pts = [
      new THREE.Vector3(x, -l * 0.8, 0.003),
      new THREE.Vector3(x * 1.1, -l * 1.15, 0.006),
      new THREE.Vector3(x * 1.15, -l * 1.38, 0.013),
      new THREE.Vector3(x * 1.15, -l * 1.46, 0.022),
    ];
    b.add(outward(tube(pts, (t) => 0.0029 * (1 - t * 0.3), 8, 8)), C(MONKEY.black));
  }
  if (foot) {
    const pts = [new THREE.Vector3(0.008, -len * 0.25, 0.004), new THREE.Vector3(0.015, -len * 0.45, 0.01), new THREE.Vector3(0.016, -len * 0.62, 0.018)];
    b.add(outward(tube(pts, (t) => 0.0034 * (1 - t * 0.3), 8, 6)), C(MONKEY.black));
  }
  return soft(b);
}

// ---------------- Decorative reef fish ----------------

export { fishGeometry } from "./fishModels";
export type { FishType } from "./fishModels";

/** Chicken tucked under an arm, for islanders carrying a captured hen. */
export function carriedChicken(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(chickenSphere(0.13, 1), C(0xf6f0e4), M.t(0, 0, 0, 0, 0, 0, 1, 0.9, 1.3));
  b.add(chickenSphere(0.07, 0), C(0xf6f0e4), M.t(0, 0.1, 0.13));
  b.add(P.rbox(0.02, 0.05, 0.06, .009, 2), C(0xd62f22), M.t(0, 0.17, 0.13));
  b.add(P.cone(0.02, 0.05, 12), C(0xe8b030), M.t(0, 0.1, 0.21, Math.PI / 2, 0, 0));
  // Wattle, folded wings and a tail fan (same size and pivot as before).
  b.add(chickenSphere(0.014, 0), C(0xd62f22), M.t(0, 0.06, 0.18, 0, 0, 0, 0.7, 1.4, 0.9));
  for (const x of [-1, 1]) {
    b.add(chickenSphere(0.09, 0), C(0xe6ddcc), M.t(x * 0.1, 0.01, -0.02, 0.15, 0, 0, 0.35, 0.75, 1.25));
  }
  for (let k = -1; k <= 1; k++) b.add(P.uvSphere(.5, 12, 8), C(0xece4d4), rod(0.13, [k * 0.02, 0.04, -0.14], -0.7, 0, -k * 0.3, .012, .07).multiply(M.t(0,0,0,0,0,0,1,.13,1)));
  return b.build();
}
