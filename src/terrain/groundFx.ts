import * as THREE from 'three';
import { TIME } from '../config';

/**
 * What the ground, the grass and the wildflowers share each frame: the season's look and the feet
 * that push the grass aside. Looks only: nothing here is saved or read by the simulation.
 *
 * The game sets both once a frame (setGroundSeason, setTramplers); the terrain, grass and flower
 * materials read the uniforms below. Left unset, the ground looks as it always did (NEUTRAL).
 */

/** Most walkers that bend the grass at once (the nearest to where the camera is looking). */
export const TRAMPLERS = 8;

/** How the ground looks in one season. */
export interface SeasonLook {
  /** Multiplied into grass and meadow colour (linear RGB). */
  tint: [number, number, number];
  /** 0..1: how far the grass has dried towards pale straw. */
  dry: number;
  /** 0..1: fallen leaves under the trees. */
  leaf: number;
  /** Tiny painted flower specks in the meadow: the share of speck sites in bloom (0..0.2). */
  specks: number;
  /** Height of the grass clumps (1 = as modelled). */
  grassHeight: number;
  /** Wildflowers showing: 1 = the island's usual scatter, more adds spring's extra blooms. */
  flowers: number;
}

/** The look before the game has said what season it is: exactly the ground as it was drawn before seasons. */
export const NEUTRAL: SeasonLook = { tint: [1, 1, 1], dry: 0, leaf: 0, specks: 0.07, grassHeight: 1, flowers: 1 };

/** Spring, summer, autumn, winter (time.seasonIndex 0..3). */
export const SEASON_LOOKS: SeasonLook[] = [
  // Spring: fresh, slightly yellow-green new growth, the meadow thick with flowers.
  { tint: [0.95, 1.07, 0.86], dry: 0, leaf: 0, specks: 0.15, grassHeight: 1.12, flowers: 1.5 },
  // Summer: deep, full green.
  { tint: [0.96, 0.99, 0.92], dry: 0.04, leaf: 0, specks: 0.07, grassHeight: 1, flowers: 1 },
  // Autumn: golden-brown, leaves down under the trees.
  { tint: [1.24, 1.0, 0.74], dry: 0.3, leaf: 1, specks: 0.025, grassHeight: 0.94, flowers: 0.5 },
  // Winter: paler and dry (a tropical winter: no snow), the last leaves, hardly a flower.
  { tint: [1.1, 1.01, 0.88], dry: 0.55, leaf: 0.35, specks: 0.006, grassHeight: 0.8, flowers: 0.18 },
];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Where in the year the clock stands: 0 spring … 4 (= spring again), fractional through each season. */
export function seasonPhase(day: number, dayFraction = 0): number {
  const span = TIME.daysPerSeason;
  const d = ((day % (span * 4)) + span * 4) % (span * 4);
  return (d + Math.min(1, Math.max(0, dayFraction))) / span;
}

/**
 * The look at a point in the year. Each season holds its own look through its middle and eases
 * into the next across the turn of the season (the last and first quarter), so nothing snaps.
 */
export function seasonLook(phase: number): SeasonLook {
  const p = (((phase - 0.5) % 4) + 4) % 4;
  const i = Math.floor(p), f = smooth(0.25, 0.75, p - i);
  const a = SEASON_LOOKS[i % 4], b = SEASON_LOOKS[(i + 1) % 4];
  const mix = (x: number, y: number) => x + (y - x) * f;
  return {
    tint: [mix(a.tint[0], b.tint[0]), mix(a.tint[1], b.tint[1]), mix(a.tint[2], b.tint[2])],
    dry: mix(a.dry, b.dry), leaf: mix(a.leaf, b.leaf), specks: mix(a.specks, b.specks),
    grassHeight: mix(a.grassHeight, b.grassHeight), flowers: mix(a.flowers, b.flowers),
  };
}

/** Uniforms shared by the terrain and grass materials (one object each, so setting it here reaches both). */
export const GROUND_FX = {
  /** Season tint of grass and meadow. */
  uSeasonTint: { value: new THREE.Vector3(1, 1, 1) },
  /** x dryness, y fallen leaves, z flower specks in bloom, w grass height. */
  uSeasonK: { value: new THREE.Vector4(NEUTRAL.dry, NEUTRAL.leaf, NEUTRAL.specks, NEUTRAL.grassHeight) },
  /** Feet in the grass: xyz where, w reach (0 = unused). */
  uTramplers: { value: Array.from({ length: TRAMPLERS }, () => new THREE.Vector4(0, -1000, 0, 0)) },
  /** The terrain's wear texture (R: trodden ground), so the grass thins towards paths. */
  uGroundWear: { value: null as THREE.Texture | null },
  /** World size, for looking the wear texture up. */
  uGroundSize: { value: 1 },
};

/** The season look in force (wildflowers read their density from it). */
export const groundSeason = { look: NEUTRAL, phase: -1 };

/**
 * Tell the ground what time of year it is. Call once a frame (cheap) with the game clock's day
 * count and day fraction: `setGroundSeason(time.day, time.t)`.
 */
export function setGroundSeason(day: number, dayFraction = 0): void {
  const phase = seasonPhase(day, dayFraction);
  if (Math.abs(phase - groundSeason.phase) < 1e-4) return;
  const look = seasonLook(phase);
  groundSeason.phase = phase;
  groundSeason.look = look;
  GROUND_FX.uSeasonTint.value.set(look.tint[0], look.tint[1], look.tint[2]);
  GROUND_FX.uSeasonK.value.set(look.dry, look.leaf, look.specks, look.grassHeight);
}

/** Back to the look before seasons (tests, and a game with seasons switched off). */
export function clearGroundSeason(): void {
  groundSeason.phase = -1;
  groundSeason.look = NEUTRAL;
  GROUND_FX.uSeasonTint.value.set(1, 1, 1);
  GROUND_FX.uSeasonK.value.set(NEUTRAL.dry, NEUTRAL.leaf, NEUTRAL.specks, NEUTRAL.grassHeight);
}

/** Anything that walks: where it is, and (optionally) how wide a swathe it pushes through the grass. */
export interface Walker {
  x: number;
  z: number;
  y?: number;
  hidden?: boolean;
  /** Reach of the push in world units (default 0.42: a villager; an ox wants about 0.7). */
  reach?: number;
}

const nearest: { w: Walker; d: number }[] = Array.from({ length: TRAMPLERS }, () => ({ w: { x: 0, z: 0 }, d: Infinity }));

/**
 * The feet that bend the grass this frame: the TRAMPLERS walkers nearest `focus` (where the camera
 * looks), from any number of lists (villagers, animals). Call once a frame; with no lists the grass
 * stands straight. Walkers further than `range` from the focus are ignored (too small to see).
 */
export function setTramplers(focus: { x: number; z: number }, groups: Iterable<Walker>[], range = 45): void {
  let n = 0;
  const r2 = range * range;
  for (const g of groups) {
    for (const w of g) {
      if (w.hidden) continue;
      const dx = w.x - focus.x, dz = w.z - focus.z, d = dx * dx + dz * dz;
      if (!(d < r2)) continue;
      if (n === TRAMPLERS && d >= nearest[n - 1].d) continue;
      // Insertion into the short sorted list of the nearest so far.
      let k = n < TRAMPLERS ? n++ : n - 1;
      while (k > 0 && nearest[k - 1].d > d) { nearest[k].w = nearest[k - 1].w; nearest[k].d = nearest[k - 1].d; k--; }
      nearest[k].w = w;
      nearest[k].d = d;
    }
  }
  const out = GROUND_FX.uTramplers.value;
  for (let k = 0; k < TRAMPLERS; k++) {
    if (k < n) {
      const w = nearest[k].w;
      out[k].set(w.x, w.y ?? 0, w.z, w.reach ?? 0.42);
    } else out[k].set(0, -1000, 0, 0);
    nearest[k].d = Infinity;
  }
}
