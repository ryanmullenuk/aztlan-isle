import * as THREE from 'three';
import { animalForm } from './animalForm';
import { ColorFn, GeoBuilder, M } from '../render/GeoBuilder';

/**
 * Shapes shared by the birds: the folded wings a bird wears at rest (a smooth sculpted wing lying
 * along each flank, the long flight feathers crossing over the tail), which stand in for the jointed
 * flight wings once they are tucked away.
 */
export interface FoldSpec {
  /** Shoulder (front) and tip (back) of the folded wing along z, in the body's frame. */
  z0: number;
  z1: number;
  /** Out from the centre line, and height of its top edge at the shoulder. */
  x: number;
  y: number;
  /** Half-height of the wing at its deepest, and its thickness. */
  depth: number;
  thick: number;
  /** Turn of the tips in over the back, and the droop of the tips. */
  inward: number;
  droop: number;
  /** Coverts (front), flight feathers (back), the tips, and a pale feather edge. */
  covert: number;
  flight: number;
  tip: number;
  edge?: number;
}

/** The bird is "at rest" past this fold: the sculpted wings show and the jointed wings hide. */
export const TUCKED = 0.92;

/** Both folded wings in the body's frame (one geometry, drawn with the body matrix). */
export function foldedWings(s: FoldSpec): THREE.BufferGeometry {
  const len = s.z0 - s.z1;
  // Rounded at the shoulder, deepest a quarter of the way back, tapering to the primaries' tips.
  const prof = [[0, 0.35], [0.08, 0.8], [0.22, 1], [0.4, 0.92], [0.58, 0.72], [0.74, 0.5], [0.88, 0.3], [1, 0.08]];
  // Tip first: the loft runs along +z, and its winding follows the order of the sections.
  const sections = prof.map(([u, k]) => [-u * len, -k * s.depth * 0.25 - u * s.droop, s.thick * (0.55 + 0.45 * k), s.depth * k * 0.85, s.depth * k] as const).reverse();
  const geo = animalForm(sections, 14, true);
  const covert = new THREE.Color(s.covert), flight = new THREE.Color(s.flight), tip = new THREE.Color(s.tip), edge = new THREE.Color(s.edge ?? s.covert);
  const color: ColorFn = (p) => {
    const u = THREE.MathUtils.clamp((s.z0 - p.z) / len, 0, 1);
    // Rows of coverts give way to the long flight feathers, darkening to the tips; a pale edge
    // marks each row of feathers.
    let c = u < 0.42 ? covert.clone() : u < 0.8 ? flight.clone() : flight.clone().lerp(tip, (u - 0.8) / 0.2);
    if (u < 0.42 && Math.sin(u * 46) > 0.75) c = c.lerp(edge, 0.45);
    if (u > 0.42 && Math.sin(p.y * 260 + u * 8) > 0.82) c = c.lerp(edge, 0.25);
    return c;
  };
  const b = new GeoBuilder();
  for (const side of [1, -1]) {
    const m = M.t(side * s.x, s.y, s.z0, 0, side * s.inward, side * 0.06);
    if (side < 0) m.multiply(M.t(0, 0, 0, 0, 0, 0, -1, 1, 1));
    b.add(side < 0 ? rewound(geo) : geo, { color }, m);
  }
  geo.dispose();
  return b.build();
}

/** A copy with every triangle wound the other way (for drawing through a mirroring matrix). */
function rewound(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const f = g.clone();
  const p = f.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 3) {
    // Swap two corners of each triangle so it still faces out once the mirror is applied.
    for (let k = 0; k < 3; k++) {
      const a = p.getComponent(i + 1, k);
      p.setComponent(i + 1, k, p.getComponent(i + 2, k));
      p.setComponent(i + 2, k, a);
    }
  }
  const n = f.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (n) for (let i = 0; i < n.count; i += 3) for (let k = 0; k < 3; k++) {
    const a = n.getComponent(i + 1, k);
    n.setComponent(i + 1, k, n.getComponent(i + 2, k));
    n.setComponent(i + 2, k, a);
  }
  return f;
}
