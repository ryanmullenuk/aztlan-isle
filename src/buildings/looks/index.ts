import * as THREE from 'three';
import type { BuildingKey } from '../../config';
import { GeoBuilder } from '../../render/GeoBuilder';
import type { Looks } from './types';
import { FOOD_LOOKS } from './food';
import { VILLAGE_LOOKS } from './village';
import { SAFETY_LOOKS } from './safety';

/**
 * How upgrades show on a building: each finished upgrade adds what it says (irrigation ditches, a
 * second rack, a taller tower). See types.ts for how a look is drawn.
 */
export const LOOKS: Looks = { ...FOOD_LOOKS, ...VILLAGE_LOOKS, ...SAFETY_LOOKS };

/** The looks of a building's first `n` upgrades, or null when it has none of its own. */
export function upgradeLooks(key: BuildingKey, n: number, w: number, d: number): { geo: THREE.BufferGeometry; torches: THREE.Vector3[] } | null {
  const looks = LOOKS[key];
  if (!looks?.length || n <= 0) return null;
  const b = new GeoBuilder(), torches: THREE.Vector3[] = [];
  for (let k = 0; k < Math.min(n, looks.length); k++) looks[k](b, w, d, torches);
  if (!b.vertexCount) return null;
  return { geo: b.build(), torches };
}
