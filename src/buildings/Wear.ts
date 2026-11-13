import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder } from '../render/GeoBuilder';
import { RNG } from '../world/rng';
import type { BuildingCondition } from './BuildingCondition';

/**
 * How worn a building looks: 0 sound (new, or freshly repaired), 1 damaged, 2 badly damaged.
 * Presentation only: it reads the building's condition and changes nothing.
 */
export function wearLevel(b: BuildingCondition): 0 | 1 | 2 {
  if (!b.complete) return 0;
  const i = b.integrity ?? 1;
  if (b.ruined || i < 0.55) return 2;
  return i < 1 ? 1 : 0;
}

/** How far a worn building leans, sideways per metre of height (x, z), from its seed. */
export function wearLean(level: number, seed: number): [number, number] {
  if (level <= 0) return [0, 0];
  const rng = new RNG(seed ^ 0x5eed1e);
  const a = rng.range(0, Math.PI * 2), k = (level >= 2 ? 0.045 : 0.018) * rng.range(0.75, 1.15);
  return [Math.cos(a) * k, Math.sin(a) * k];
}

const CRACK = new THREE.Color(0x2a1d14), BRICK = new THREE.Color(0x96684a), COURSE = new THREE.Color(0x6b4732), HOLE = new THREE.Color(0x2b2018), RAFTER = new THREE.Color(0x4a3220);

/** A flat piece from loose triangles (corners in order), for a decal. */
function flat(points: THREE.Vector3[], tris: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap((p) => [p.x, p.y, p.z]), 3));
  g.setIndex(tris);
  g.computeVertexNormals();
  return g;
}

/**
 * The marks of damage, laid on a model's own walls and roofs: jagged cracks running down walls,
 * patches where the plaster has come away from the mud brick beneath, and holes in the roof where
 * thatch or plaster has gone (a rafter showing). Each mark sits on one of the model's larger
 * faces, sized to stay inside it, so nothing hangs in the air. Deterministic for a seed.
 * Returns null when the model has no face big enough to mark.
 */
export function wearMarks(model: THREE.BufferGeometry, level: number, seed: number): THREE.BufferGeometry | null {
  const P = model.getAttribute('position'), I = model.index, V = model.getAttribute('aVeg');
  if (level <= 0 || !P || !I) return null;
  const rng = new RNG(seed ^ 0x77ea12);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  interface Face { p: THREE.Vector3; n: THREE.Vector3; r: number; thatch: boolean }
  const walls: Face[] = [], roofs: Face[] = [];
  for (let t = 0; t < I.count; t += 3) {
    const i0 = I.getX(t), i1 = I.getX(t + 1), i2 = I.getX(t + 2);
    // Plants and cloth are left alone; thatch (a touch of leaf) is marked as thatch.
    if (V && (V.getX(i0) !== 0 || V.getY(i0) >= 0.5)) continue;
    a.fromBufferAttribute(P, i0); b.fromBufferAttribute(P, i1); c.fromBufferAttribute(P, i2);
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    const area = n.length() * 0.5;
    if (area < 0.02) continue;
    n.normalize();
    const la = b.distanceTo(c), lb = a.distanceTo(c), lc = a.distanceTo(b), per = la + lb + lc;
    // The middle of the face's inscribed circle, and its radius: a mark this size stays on the face.
    const r = (2 * area) / per;
    if (r < 0.035) continue;
    const p = new THREE.Vector3().addScaledVector(a, la / per).addScaledVector(b, lb / per).addScaledVector(c, lc / per);
    if (p.y < 0.14) continue;
    const thatch = !!V && V.getY(i0) > 0.05;
    if (Math.abs(n.y) < 0.35) walls.push({ p, n: n.clone(), r, thatch });
    else if (n.y > 0.5 && r > 0.07 && p.y > 0.4) roofs.push({ p, n: n.clone(), r, thatch });
  }
  if (!walls.length && !roofs.length) return null;
  const gb = new GeoBuilder();
  const take = (from: Face[]): Face | null => {
    if (!from.length) return null;
    // Bigger faces are picked more often (the best of three tries), and none is marked twice.
    let best = rng.int(0, from.length - 1);
    for (let k = 0; k < 2; k++) { const j = rng.int(0, from.length - 1); if (from[j].r > from[best].r) best = j; }
    return from.splice(best, 1)[0];
  };
  const frame = (f: Face) => {
    const u = new THREE.Vector3().crossVectors(f.n, new THREE.Vector3(0, 1, 0));
    if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
    u.normalize();
    const v = new THREE.Vector3().crossVectors(u, f.n).normalize();
    // Clear of the face (the shader bows walls a little between their corners); thatch stands proud.
    const o = f.p.clone().addScaledVector(f.n, f.thatch ? 0.075 : 0.014);
    return { u, v, o };
  };
  const cracks = level >= 2 ? 9 : 4, patches = level >= 2 ? 5 : 2, holes = level >= 2 ? 3 : 1;
  for (let k = 0; k < cracks; k++) {
    const f = take(walls);
    if (!f) break;
    const { u, v, o } = frame(f);
    // A crack: a thin jagged strip, widest in the middle, running mostly down the wall.
    const len = Math.min(0.55, f.r * 1.7), steps = 5, w = Math.min(0.022, 0.008 + f.r * 0.05) * (level >= 2 ? 1.3 : 1);
    const pts: THREE.Vector3[] = [], tris: number[] = [];
    let side = 0;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, half = w * Math.sin(Math.PI * t) + 0.0015;
      if (s > 0 && s < steps) side += rng.range(-1, 1) * len * 0.09;
      const mid = o.clone().addScaledVector(v, (0.5 - t) * len).addScaledVector(u, side);
      pts.push(mid.clone().addScaledVector(u, -half), mid.clone().addScaledVector(u, half));
      if (s > 0) { const q = (s - 1) * 2; tris.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    }
    const g = flat(pts, tris);
    gb.add(g, { color: CRACK });
    g.dispose();
  }
  const blob = (o: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, r: number, squash: number): THREE.BufferGeometry => {
    const m = 7, pts = [o.clone()], tris: number[] = [];
    for (let s = 0; s < m; s++) {
      const ang = (s / m) * Math.PI * 2, rr = r * rng.range(0.6, 1);
      pts.push(o.clone().addScaledVector(u, Math.cos(ang) * rr).addScaledVector(v, Math.sin(ang) * rr * squash));
      // Wound so the piece faces out along the face's normal (u × v points back along it).
      tris.push(0, 1 + ((s + 1) % m), 1 + s);
    }
    return flat(pts, tris);
  };
  for (let k = 0; k < patches; k++) {
    const f = take(walls);
    if (!f || f.thatch) continue;
    const { u, v, o } = frame(f);
    // Plaster fallen away: the mud brick beneath, with a course line or two across it.
    const r = Math.min(0.2, f.r * 0.8);
    const g = blob(o, u, v, r, 0.8);
    gb.add(g, { color: BRICK.clone().multiplyScalar(rng.range(0.88, 1.08)) });
    g.dispose();
    for (const dy of [-0.3, 0.25]) {
      const m = o.clone().addScaledVector(v, dy * r).addScaledVector(f.n, 0.003), hw = r * 0.5, hh = 0.006;
      const line = flat([m.clone().addScaledVector(u, -hw).addScaledVector(v, -hh), m.clone().addScaledVector(u, hw).addScaledVector(v, -hh), m.clone().addScaledVector(u, hw).addScaledVector(v, hh), m.clone().addScaledVector(u, -hw).addScaledVector(v, hh)], [0, 2, 1, 0, 3, 2]);
      gb.add(line, { color: COURSE });
      line.dispose();
    }
  }
  for (let k = 0; k < holes; k++) {
    const f = take(roofs);
    if (!f) break;
    const { u, v, o } = frame(f);
    // A gap in the roof: dark inside, one rafter showing across it.
    const r = Math.min(0.24, f.r * 0.85);
    const g = blob(o, u, v, r, 0.75);
    gb.add(g, { color: HOLE });
    g.dispose();
    const m = o.clone().addScaledVector(f.n, 0.004), hw = r * 0.55, hh = 0.012;
    const raft = flat([m.clone().addScaledVector(u, -hw).addScaledVector(v, -hh), m.clone().addScaledVector(u, hw).addScaledVector(v, -hh), m.clone().addScaledVector(u, hw).addScaledVector(v, hh), m.clone().addScaledVector(u, -hw).addScaledVector(v, hh)], [0, 2, 1, 0, 3, 2]);
    gb.add(raft, { color: RAFTER });
    raft.dispose();
  }
  return gb.vertexCount ? gb.build() : null;
}

/**
 * Lean a model over and dirty it, in place: every point is pushed sideways in proportion to its
 * height (so the footings stay put and the whole building tilts together), and its colours are
 * mottled darker with soot and damp, worst high up. Used on the full model and on the copy its
 * far-away model is cut from, so the two agree.
 */
export function wearInPlace(geo: THREE.BufferGeometry, level: number, seed: number): void {
  if (level <= 0) return;
  const [lx, lz] = wearLean(level, seed);
  const P = geo.getAttribute('position') as THREE.BufferAttribute, C = geo.getAttribute('color') as THREE.BufferAttribute | undefined, V = geo.getAttribute('aVeg');
  const s = level >= 2 ? 0.34 : 0.16, ph = (seed % 97) * 0.13;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = Math.max(0, P.getY(i)), z = P.getZ(i);
    if (C && !(V && (V.getX(i) !== 0 || V.getY(i) >= 0.5))) {
      const blotch = 0.5 + 0.5 * Math.sin(x * 4.1 + ph) * Math.sin(y * 3.3 + 1.7 + ph) * Math.sin(z * 4.7 - ph * 2);
      const f = 1 - s * (0.2 + 0.8 * blotch) * (0.55 + 0.45 * Math.min(1, y / 1.2));
      C.setXYZ(i, C.getX(i) * f, C.getY(i) * f * 0.985, C.getZ(i) * f * 0.96);
    }
    P.setXYZ(i, x + lx * y, P.getY(i), z + lz * y);
  }
  P.needsUpdate = true;
  if (C) C.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

/** A worn model: the damage marks merged into it (the caller leans and dirties it once its faces are split). */
export function withWearMarks(model: THREE.BufferGeometry, level: number, seed: number): THREE.BufferGeometry {
  const marks = wearMarks(model, level, seed);
  if (!marks) return model;
  const merged = mergeGeometries([model, marks]);
  marks.dispose();
  if (!merged) return model;
  merged.userData = model.userData;
  model.dispose();
  return merged;
}
