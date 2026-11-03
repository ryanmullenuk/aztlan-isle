import * as THREE from 'three';
import { GeoBuilder, M, P } from './GeoBuilder';
import { stylisedMaterial } from './materials';
import { SEA_SURFACE } from '../water/Water';
import { RNG } from '../world/rng';
import type { World } from '../world/World';

/**
 * The willow glade's lake dressing (layout 2): lily pads floating on the still water, some in
 * flower with pink lotuses, and clumps of cattails standing in the shallows at its edge. One mesh.
 */
export function lakeDressing(w: World): THREE.Mesh | null {
  const g = w.glade;
  if (!g) return null;
  const b = new GeoBuilder(), rng = new RNG(w.seed * 7 + 71);
  const y = SEA_SURFACE + 0.025;
  const water = (x: number, z: number) => { const i = w.cellIndexAt(x, z); return i >= 0 && w.layer[i] < 1; };
  const shoreDist = (x: number, z: number) => {
    let d = 0;
    for (const r of [0.6, 1.0, 1.4]) for (let k = 0; k < 8; k++) if (!water(x + Math.cos(k * 0.785) * r, z + Math.sin(k * 0.785) * r)) return d;
    return (d = 1.5);
  };
  const pad = (x: number, z: number, s: number, flower: boolean) => {
    // A round leaf with its notch, a darker vein ring, and now and then a lotus on it.
    const rot = rng.range(0, Math.PI * 2);
    b.add(new THREE.CircleGeometry(0.28, 14, 0.35, Math.PI * 2 - 0.35).rotateX(-Math.PI / 2), { color: (p) => new THREE.Color(0x5f9a2e).lerp(new THREE.Color(0x86bd3c), Math.min(1, Math.hypot(p.x - x, p.z - z) / (0.28 * s))) }, M.t(x, y, z, 0, rot, 0, s, 1, s));
    b.add(new THREE.RingGeometry(0.08, 0.1, 12).rotateX(-Math.PI / 2), { color: 0x4a7f24 }, M.t(x, y + 0.004, z, 0, rot, 0, s, 1, s));
    if (!flower) return;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, tilt = k % 2 ? 0.75 : 0.45;
      b.add(P.cone(0.05, 0.16, 4), { color: k % 2 ? 0xf2a6c8 : 0xfbd2e2 }, M.t(x + Math.cos(a) * 0.05 * s, y + 0.07 * s, z + Math.sin(a) * 0.05 * s, 0, -a, tilt, s, s, s * 0.5).multiply(M.t(0, 0, 0, 0, 0, 0)));
    }
    b.add(P.sphere(0.035, 1), { color: 0xf2c230 }, M.t(x, y + 0.06 * s, z));
  };
  // Pads in drifts across the open water, kept off the very edge.
  let placed = 0;
  for (let k = 0; k < 400 && placed < 34; k++) {
    const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * (g.r + 4);
    const x = g.x + Math.cos(a) * d, z = g.z + Math.sin(a) * d;
    if (!water(x, z) || shoreDist(x, z) < 0.6) continue;
    const s = rng.range(0.7, 1.25);
    pad(x, z, s, rng.chance(0.22));
    // A few smaller pads beside it.
    for (let j = 0; j < 2; j++) {
      const px = x + rng.range(-0.55, 0.55), pz = z + rng.range(-0.55, 0.55);
      if (water(px, pz)) pad(px, pz, s * rng.range(0.45, 0.7), false);
    }
    placed++;
  }
  // Cattails in the shallows round the edge.
  for (let k = 0; k < 120; k++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(g.r * 0.6, g.r + 6);
    const x = g.x + Math.cos(a) * d, z = g.z + Math.sin(a) * d;
    if (!water(x, z) || shoreDist(x, z) > 0.6) continue;
    for (let j = 0; j < 5; j++) {
      const px = x + rng.range(-0.2, 0.2), pz = z + rng.range(-0.2, 0.2), h = rng.range(0.55, 0.95);
      b.add(P.cyl(0.012, 0.016, h, 4), { color: 0x6f9a3a }, M.t(px, y - 0.15 + h / 2, pz, rng.range(-0.12, 0.12), 0, rng.range(-0.12, 0.12)));
      if (j % 2 === 0) b.add(P.cyl(0.03, 0.03, 0.14, 6), { color: 0x7a4a26 }, M.t(px, y - 0.15 + h * 0.85, pz));
    }
  }
  const mesh = new THREE.Mesh(b.build(), stylisedMaterial());
  mesh.receiveShadow = true;
  mesh.name = 'lake dressing';
  return mesh;
}
