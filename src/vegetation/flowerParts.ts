import * as THREE from 'three';
import { GeoBuilder, M, tube } from '../render/GeoBuilder';
import { RNG } from '../world/rng';
import { leafGeometry } from './detail';

/**
 * The island's flowers, piece by piece: the same petalled heads, stems and leaves as the wildflowers
 * and the garden plants, for the flowers that grow on and around buildings and graves (window boxes,
 * pots, beds, offerings, marigold garlands). Shared so that every flower in the game reads as one kind.
 */

export const LEAF = new THREE.Color(0x3f7a31), LEAF_LIGHT = new THREE.Color(0x6aa33f), STEM = new THREE.Color(0x4a7a2c);

/** Petal colours, dark to light, as the wildflowers'. */
export const PETALS = {
  red: [0xc9272b, 0xe8483e], orange: [0xe8701a, 0xffa13d], yellow: [0xf2c21c, 0xffe05a], purple: [0x8e44c9, 0xb877e6],
  pink: [0xe0629e, 0xf59ac4], white: [0xeee9df, 0xffffff], blue: [0x3f6fd6, 0x7fa4f0], magenta: [0xb0247a, 0xd8378f],
  marigold: [0xf2780e, 0xffa82e], gold: [0xf8b414, 0xffd848],
} satisfies Record<string, [number, number]>;
export type PetalColour = keyof typeof PETALS;

const col = (h: number) => new THREE.Color(h);

/** A flower head: petals radiating round a small yellow centre, facing up and a little outward. */
export function flowerHead(b: GeoBuilder, at: THREE.Vector3, size: number, c0: THREE.Color, c1: THREE.Color, rng: RNG, petals = 5, cup = 0.5, sway = 0.6): void {
  const q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), ax = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1);
  const tilt = rng.range(0, Math.PI * 2);
  for (let k = 0; k < petals; k++) {
    const a = tilt + (k / petals) * Math.PI * 2;
    ax.set(Math.cos(a), cup, Math.sin(a)).normalize();
    q.setFromUnitVectors(z, ax);
    q2.setFromAxisAngle(ax, rng.range(-0.3, 0.3));
    b.add(leafGeometry(size, size * 0.5, 0.2), { color: c0.clone().lerp(c1, rng.next()), leaf: 1, sway }, new THREE.Matrix4().compose(at, q2.multiply(q), new THREE.Vector3(1, 1, 1)));
  }
  b.add(new THREE.OctahedronGeometry(size * 0.28, 0), { color: 0xf6d34a, leaf: 1, sway }, M.t(at.x, at.y + size * 0.1, at.z));
}

/** A flower of one of the named colours at `at`. */
export function bloomAt(b: GeoBuilder, at: THREE.Vector3, size: number, colour: PetalColour, rng: RNG, petals = 5, cup = 0.5, sway = 0.6): void {
  const [h0, h1] = PETALS[colour];
  flowerHead(b, at, size, col(h0), col(h1), rng, petals, cup, sway);
}

/**
 * A marigold: a round ruffled head of short orange (or gold) petals, an outer ring spread wide and
 * an inner ring cupped up, as the marigolds laid on altars and graves and strung into garlands.
 */
export function marigoldHead(b: GeoBuilder, at: THREE.Vector3, size: number, rng: RNG, gold = rng.chance(0.4), sway = 0.3): void {
  const [h0, h1] = PETALS[gold ? 'gold' : 'marigold'];
  const c0 = col(h0), c1 = col(h1), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), ax = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1);
  // Each ring one shade (darker outside, lighter in the middle), so overlapping petals never flicker.
  const ring = (n: number, len: number, cup: number, lift: number) => {
    const tilt = rng.range(0, Math.PI * 2), shade = c0.clone().lerp(c1, Math.min(1, lift / (size * 0.34)));
    for (let k = 0; k < n; k++) {
      const a = tilt + (k / n) * Math.PI * 2;
      ax.set(Math.cos(a), cup, Math.sin(a)).normalize();
      q.setFromUnitVectors(z, ax);
      q2.setFromAxisAngle(ax, rng.range(-0.4, 0.4));
      b.add(leafGeometry(len, len * 0.7, 0.55), { color: shade, leaf: 1, sway }, new THREE.Matrix4().compose(new THREE.Vector3(at.x, at.y + lift, at.z), q2.multiply(q), new THREE.Vector3(1, 1, 1)));
    }
  };
  // A round ruffle: a cupped outer ring, a taller middle ring, and a tuft standing up in the middle.
  b.add(new THREE.IcosahedronGeometry(size * 0.42, 0), { color: c0.clone().multiplyScalar(0.9), leaf: 1, sway }, M.t(at.x, at.y + size * 0.28, at.z));
  ring(8, size * 0.9, 0.75, 0);
  ring(6, size * 0.75, 2.2, size * 0.18);
  ring(4, size * 0.55, 6, size * 0.34);
}

/** Two small leaves at a stem's foot. */
function footLeaves(b: GeoBuilder, x: number, y: number, z: number, len: number, rng: RNG): void {
  const q = new THREE.Quaternion(), ax = new THREE.Vector3(), zz = new THREE.Vector3(0, 0, 1);
  const a0 = rng.range(0, Math.PI * 2);
  for (let k = 0; k < 2; k++) {
    const a = a0 + k * Math.PI + rng.range(-0.4, 0.4);
    ax.set(Math.cos(a), 0.45, Math.sin(a)).normalize();
    q.setFromUnitVectors(zz, ax);
    b.add(leafGeometry(len, len * 0.34, 0.35), { color: LEAF.clone().lerp(LEAF_LIGHT, rng.next() * 0.7), leaf: 1, sway: 0.3 }, new THREE.Matrix4().compose(new THREE.Vector3(x, y + 0.005, z), q, new THREE.Vector3(1, 1, 1)));
  }
}

/** A flower on its stem with two leaves at its foot, standing at (x, y, z), `h` tall. */
export function flowerOnStem(b: GeoBuilder, x: number, y: number, z: number, h: number, size: number, colour: PetalColour, rng: RNG, petals = 5): void {
  const lean = rng.range(0, Math.PI * 2), off = h * 0.08;
  const top = new THREE.Vector3(x + Math.cos(lean) * off, y + h, z + Math.sin(lean) * off);
  b.add(tube([new THREE.Vector3(x, y, z), new THREE.Vector3(x + Math.cos(lean) * off * 0.4, y + h * 0.55, z + Math.sin(lean) * off * 0.4), top], () => 0.005, 3, 2), { color: STEM, leaf: 1, sway: (p) => Math.max(0, p.y - y) * 2.5 });
  footLeaves(b, x, y, z, Math.min(0.055, Math.max(0.04, h * 0.45)), rng);
  if (colour === 'marigold' || colour === 'gold') marigoldHead(b, top, size, rng, colour === 'gold', 0.6);
  else bloomAt(b, top, size, colour, rng, petals);
}
