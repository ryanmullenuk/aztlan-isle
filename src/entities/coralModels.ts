import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, P, M } from '../render/GeoBuilder';
import { RNG } from '../world/rng';

/*
 * Coral shapes shared by the reefs (Coral.ts) and the sea-floor fields (Seabed.ts). Low-poly and
 * flat shaded; the geometry carries only light and shade (near white) and each instance its colour.
 */

/** The lit and shaded ends of a piece's own shading (the instance colour multiplies them). */
export const LIT = new THREE.Color(0xffffff), SHADE = new THREE.Color(0xb9b2a8);

type V = THREE.Vector3;
type Sway = number | ((p: V) => number);
const UP = new THREE.Vector3(0, 1, 0);
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Add a triangle wound so it faces away from `inside`. */
function face(out: V[], a: V, b: V, c: V, inside: V): void {
  const n = v3().crossVectors(b.clone().sub(a), c.clone().sub(a));
  const cen = a.clone().add(b).add(c).multiplyScalar(1 / 3).sub(inside);
  if (n.dot(cen) < 0) out.push(a, c, b);
  else out.push(a, b, c);
}

export function soup(tris: V[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flatMap((p) => [p.x, p.y, p.z]), 3));
  return g;
}

/**
 * One limb: rings round a bent centre line (p0 → p1 → p2), thinning along it and closed by a low
 * dome, so the end is blunt and rounded rather than a spike.
 */
export function limb(out: V[], p0: V, p1: V, p2: V, r0: number, r1: number, r2: number, radial = 5): void {
  const pts = [p0, p1, p2], rad = [r0, r1, r2], rings: V[][] = [];
  let N: V | null = null, T = v3();
  for (let i = 0; i < 3; i++) {
    T = (i === 0 ? p1.clone().sub(p0) : i === 2 ? p2.clone().sub(p1) : p2.clone().sub(p0)).normalize();
    // Carry the ring's frame along the limb so it never twists.
    if (!N) N = v3().crossVectors(T, Math.abs(T.y) > 0.9 ? v3(1, 0, 0) : UP).normalize();
    else N = N.clone().addScaledVector(T, -N.dot(T)).normalize();
    const B = v3().crossVectors(T, N);
    const ring: V[] = [];
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      ring.push(pts[i].clone().addScaledVector(N, Math.cos(a) * rad[i]).addScaledVector(B, Math.sin(a) * rad[i]));
    }
    rings.push(ring);
  }
  for (let i = 0; i < 2; i++) {
    const inside = pts[i].clone().lerp(pts[i + 1], 0.5);
    for (let j = 0; j < radial; j++) {
      const k = (j + 1) % radial;
      face(out, rings[i][j], rings[i][k], rings[i + 1][j], inside);
      face(out, rings[i][k], rings[i + 1][k], rings[i + 1][j], inside);
    }
  }
  const tip = p2.clone().addScaledVector(T, r2 * 0.65);
  for (let j = 0; j < radial; j++) face(out, rings[2][j], rings[2][(j + 1) % radial], tip, p1);
}

/**
 * Branching coral (staghorn): a stout foot, a few limbs leaning out and curving up towards the
 * light, each forking once or twice into shorter ones; round blunt ends, paler towards the tips
 * where it is growing. `depth` 1 forks once, 2 forks twice. `smooth` shares corners between
 * faces (a third of the vertices, and soft shading): for the big sea-floor fields, which draw
 * thousands of them.
 */
export function branchingCoral(seed: number, o: { height?: number; primaries?: number; depth?: number; sway?: Sway; smooth?: boolean } = {}): THREE.BufferGeometry {
  const H = o.height ?? 0.5, rng = new RNG(seed), tris: V[] = [];
  const grow = (from: V, dir: V, len: number, r: number, d: number) => {
    const p1 = from.clone().addScaledVector(dir, len * 0.55);
    const endDir = dir.clone().lerp(UP, 0.5).normalize();
    const p2 = p1.clone().addScaledVector(endDir, len * 0.5);
    limb(tris, from, p1, p2, r, r * 0.86, r * 0.66);
    if (d <= 0) return;
    const perp = v3().crossVectors(endDir, UP);
    if (perp.lengthSq() < 1e-4) perp.set(1, 0, 0);
    perp.normalize();
    const side = rng.chance(0.5) ? 1 : -1;
    // One fork from the bend and one from nearer the end, to either side.
    const forks: [V, number][] = [[p1, side], [p1.clone().lerp(p2, 0.7), -side]];
    for (const [at, s] of forks) {
      const nd = endDir.clone().addScaledVector(perp, s * rng.range(0.6, 0.95)).addScaledVector(UP, rng.range(0, 0.3)).normalize();
      nd.applyAxisAngle(endDir, rng.range(-0.6, 0.6));
      grow(at, nd, len * rng.range(0.62, 0.8), r * 0.78, d - 1);
    }
  };
  limb(tris, v3(0, -0.02, 0), v3(0, 0.04, 0), v3(0, 0.09, 0), 0.078, 0.068, 0.058);
  const n = o.primaries ?? 3;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rng.range(-0.35, 0.35), lean = rng.range(0.55, 0.9);
    grow(v3(Math.cos(a) * 0.02, 0.06, Math.sin(a) * 0.02), v3(Math.sin(lean) * Math.cos(a), Math.cos(lean), Math.sin(lean) * Math.sin(a)), H * rng.range(0.5, 0.62), 0.05, o.depth ?? 1);
  }
  const top = tris.reduce((m, p) => Math.max(m, p.y), 0.01);
  const b = new GeoBuilder();
  let g = soup(tris);
  if (o.smooth) {
    g = mergeVertices(g, 1e-4);
    g.computeVertexNormals();
  }
  b.add(g, { color: (p) => SHADE.clone().lerp(LIT, THREE.MathUtils.smoothstep(p.y / top, 0.15, 1)), facet: !o.smooth, sway: o.sway });
  return b.build();
}

/**
 * Table coral: flat, slightly dished tables with an uneven lobed edge, each flaring up from its
 * root like a funnel (not a disc on a stick): a broad one on a short stout stalk, a smaller one
 * grown off its side and a low shelf near the foot. Rigid: it never sways. `thin` leaves out the
 * edge's thickness (the underside meets the top at a sharp edge): under half the faces, for the
 * big sea-floor fields.
 */
export function tableCoral(seed: number, thin = false): THREE.BufferGeometry {
  const rng = new RNG(seed), tris: V[] = [];
  const table = (c: V, R: number, tilt: THREE.Euler, root: V) => {
    const n = thin ? 9 : 10, ph = rng.range(0, Math.PI * 2), up: V[] = [], lo: V[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.range(-0.12, 0.12), rr = R * (1 + 0.1 * Math.sin(a * 3 + ph)) * rng.range(0.88, 1.06);
      // Dished: the growing edge stands a little higher than the middle.
      const y = rr * 0.07 + rng.range(-0.006, 0.006);
      up.push(v3(Math.cos(a) * rr, y, Math.sin(a) * rr).applyEuler(tilt).add(c));
      lo.push(v3(Math.cos(a) * rr * 0.93, y - 0.035, Math.sin(a) * rr * 0.93).applyEuler(tilt).add(c));
    }
    const below = c.clone().add(v3(0, -0.05, 0)), above = c.clone().add(v3(0, 0.05, 0));
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      face(tris, c, up[i], up[j], below);
      if (thin) {
        face(tris, up[i], up[j], root, above);
        continue;
      }
      face(tris, up[i], up[j], lo[i], c);
      face(tris, up[j], lo[j], lo[i], c);
      face(tris, lo[i], lo[j], root, above);
    }
  };
  const a2 = rng.range(0, Math.PI * 2), cx = Math.cos(a2), cz = Math.sin(a2);
  table(v3(0, 0.2, 0), 0.3, new THREE.Euler(rng.range(-0.06, 0.06), 0, rng.range(-0.06, 0.06)), v3(0, 0.1, 0));
  table(v3(cx * 0.17, 0.285, cz * 0.17), 0.19, new THREE.Euler(cz * 0.12, 0, -cx * 0.12), v3(cx * 0.06, 0.2, cz * 0.06));
  table(v3(-cx * 0.2, 0.115, -cz * 0.2), 0.14, new THREE.Euler(-cz * 0.15, 0, cx * 0.15), v3(-cx * 0.03, 0.05, -cz * 0.03));
  const b = new GeoBuilder();
  b.add(P.cyl(0.05, 0.075, 0.2, thin ? 5 : 6, true), { color: SHADE, facet: true }, M.t(0, 0.08, 0));
  // Pale on top and along the growing edge, shaded underneath.
  b.add(soup(tris), { color: (_p, nn) => (nn.y > -0.25 ? LIT.clone().lerp(SHADE, nn.y > 0.5 ? 0 : 0.15) : SHADE.clone().multiplyScalar(0.82)), facet: true });
  return b.build();
}

/**
 * The rocky foot a coral grows from: a low, faceted mound of old reef rock, its rim sunk into the
 * sand, with a few loose stones round it. Radius 1 and about 0.45 high at scale 1; placed squashed
 * (see `coralBase`). Facets vary a little in shade, as if crusted with algae in places.
 */
export function coralBaseGeometry(seed = 61): THREE.BufferGeometry {
  const rng = new RNG(seed), tris: V[] = [], n = 9;
  const rim: V[] = [], mid: V[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.15, 0.15);
    rim.push(v3(Math.cos(a) * rng.range(0.9, 1.08), -0.08, Math.sin(a) * rng.range(0.9, 1.08)));
    const b = a + Math.PI / n;
    mid.push(v3(Math.cos(b) * rng.range(0.5, 0.66), rng.range(0.26, 0.38), Math.sin(b) * rng.range(0.5, 0.66)));
  }
  const top = v3(rng.range(-0.08, 0.08), 0.45, rng.range(-0.08, 0.08)), inside = v3(0, -0.5, 0);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    face(tris, rim[i], rim[j], mid[i], inside);
    face(tris, mid[i], rim[j], mid[j], inside);
    face(tris, mid[i], mid[j], top, inside);
  }
  // Loose stones round the foot, half buried.
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + rng.range(-0.4, 0.4), d = rng.range(0.95, 1.25), r = rng.range(0.1, 0.17);
    const c = v3(Math.cos(a) * d, 0, Math.sin(a) * d);
    const pts = [v3(r, 0, 0), v3(-r, 0, 0), v3(0, r * 1.1, 0), v3(0, -r, 0), v3(0, 0, r), v3(0, 0, -r)].map((p) => p.applyAxisAngle(UP, rng.range(0, 3)).add(c));
    const [px, nx, py, ny, pz, nz] = pts;
    for (const [s1, s2] of [[px, pz], [pz, nx], [nx, nz], [nz, px]] as [V, V][]) {
      face(tris, s1, s2, py, c);
      face(tris, s1, s2, ny, c);
    }
  }
  const b = new GeoBuilder();
  const hash = (p: V) => Math.abs(Math.sin(p.x * 91.7 + p.y * 47.3 + p.z * 63.1)) % 1;
  b.add(soup(tris), {
    color: (p, nn) => SHADE.clone().lerp(LIT, 0.3 + 0.5 * Math.max(0, nn.y)).multiplyScalar(0.7 + 0.38 * hash(p)),
    facet: true,
  });
  return b.build();
}

/** Old reef rock: sandstone, grey rubble, and some crusted green or pink with algae. */
export const BASE_PALETTE = [0x9a8c72, 0x878070, 0xa6967a, 0x758666, 0x928470, 0x9e8476];

/**
 * A base under a coral standing at (x, y, z) whose foot reaches `foot` from its middle: wider than
 * the foot, low, turned and coloured from the spot alone (the same every time).
 */
export function coralBase(x: number, y: number, z: number, foot: number): { m: THREE.Matrix4; c: THREE.Color } {
  const rng = new RNG(Math.floor(Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) * 1e6));
  const R = foot * rng.range(1.5, 1.9), wide = rng.range(0.85, 1.15);
  const m = new THREE.Matrix4().compose(v3(x, y - 0.01, z), new THREE.Quaternion().setFromAxisAngle(UP, rng.range(0, Math.PI * 2)), v3(R * wide, R * rng.range(0.28, 0.4), R / wide));
  const c = new THREE.Color(BASE_PALETTE[rng.int(0, BASE_PALETTE.length - 1)]).multiplyScalar(rng.range(0.9, 1.05));
  return { m, c };
}
