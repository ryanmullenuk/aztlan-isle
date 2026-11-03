import type { BuildingKey } from '../config';
import { buildingOperational, type BuildingCondition } from './BuildingCondition';
import { FX, upgrades } from './Upgrades';

/** What the village systems need to know of a building to read its upgrades. */
export interface Upgradable extends BuildingCondition {
  key: BuildingKey;
  tier: number;
  x: number;
  z: number;
}

/** Whether a working building has had this upgrade (1 to 3). */
export const upgraded = (b: Upgradable, step: number): boolean => upgrades(b) >= step && buildingOperational(b);

/** Whether any working building of this kind has had this upgrade. */
export const anyUpgraded = (list: readonly Upgradable[], key: BuildingKey, step: number): boolean =>
  list.some((b) => b.key === key && upgraded(b, step));

/**
 * Happiness the village's upgrades add for someone living (or standing) at x, z: the palace's
 * garden and the hall's feasts for everyone, flower beds and a fountain close by. Each counts once.
 */
export function upgradeMood(list: readonly Upgradable[], x: number, z: number): number {
  let palace = 0, hall = 0, garden = 0, fountain = 0;
  for (const b of list) {
    if (b.key === 'palace' && upgraded(b, 1)) palace = FX.palace.mood;
    else if (b.key === 'greathall' && upgraded(b, 3)) hall = FX.greathall.mood;
    else if ((b.key === 'chinampa' || b.key === 'well') && upgraded(b, 3)) {
      const fx = FX[b.key];
      if ((b.x - x) ** 2 + (b.z - z) ** 2 > fx.moodRange ** 2) continue;
      if (b.key === 'chinampa') garden = fx.mood;
      else fountain = fx.mood;
    }
  }
  return palace + hall + garden + fountain;
}

/** An evening fire's pull (times the usual distance) and how much its evenings lift the mood and bring Belief. */
export function eveningFire(b: Upgradable): { range: number; mood: number; belief: number } {
  const f = { range: 1, mood: 1, belief: 1 };
  if (b.key === 'bonfire') {
    if (upgraded(b, 1)) f.range = FX.bonfire.range;
    if (upgraded(b, 2)) f.belief = FX.bonfire.belief;
    if (upgraded(b, 3)) f.mood = FX.bonfire.mood;
  } else if (b.key === 'firepit') {
    if (upgraded(b, 2)) f.mood = FX.firepit.mood;
    if (upgraded(b, 3)) f.range = FX.firepit.range;
  } else if (b.key === 'campfire' && upgraded(b, 2)) f.mood = f.belief = FX.campfire.evening;
  return f;
}

/** Fireworks packed from one jar of gunpowder at this workshop. */
export const fireworksPerJar = (b: Upgradable | undefined, base: number): number =>
  b && b.key === 'firemaker' && upgraded(b, 1) ? FX.firemaker.perJar : base;

/** Light round a fire: wider (and a little brighter) for the Eternal flame and the Brazier. */
export function lightRange(b: Upgradable): number {
  if (b.key === 'torch' && upgraded(b, 1)) return FX.torch.light;
  if (b.key === 'campfire' && upgraded(b, 3)) return FX.campfire.lightRange;
  return 1;
}
