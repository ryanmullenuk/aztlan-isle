import { BUILDING_FIRE, DEFENCE, DOGS, HERBALIST, WARRIOR, type BuildingKey } from '../config';
import { buildingOperational, type BuildingCondition } from './BuildingCondition';
import { FX, upgrades } from './Upgrades';

/**
 * What the defence, fire and health upgrades do, for the systems that read them: the watchtower,
 * kennel, Warrior Lodge, well, stores, Healing Centre, herbalist and herbal garden. A step counts
 * only while its building is working.
 */
type B = BuildingCondition & { key: BuildingKey; tier: number; upgrading?: boolean };

/** Upgrade n is finished and the building is working. */
export const upgraded = (b: B | null | undefined, n: number): boolean => !!b && buildingOperational(b) && upgrades(b) >= n;

/** Upgrades in force (0 when it isn't working). */
const level = (b: B): number => (buildingOperational(b) ? upgrades(b) || 0 : 0);

export const towerRange = (b: B): number => (level(b) ? FX.watchtower.range[level(b)] : DEFENCE.range);
export const towerReload = (b: B): number => (level(b) ? FX.watchtower.reload[level(b)] : DEFENCE.reload);
export const towerAccuracy = (b: B): number => (level(b) ? FX.watchtower.accuracy[level(b)] : DEFENCE.accuracy);

/** Dogs a kennel has room for. */
export const kennelDogs = (b: B): number => (level(b) ? FX.kennel.dogs[level(b)] : DOGS.perKennel);

/** Beds in a Healing Centre (they are built with the upgrade, so they stay while it is damaged). */
export const healerBeds = (b: B): number => FX.healer.beds[Math.min(3, upgrades(b) || 0)];

/** The best Warrior Lodge's upgrades. */
export function lodgeLevel(list: B[]): number {
  let n = 0;
  for (const b of list) if (b.key === 'warroom') n = Math.max(n, level(b));
  return n;
}

/** Seconds to train a warrior at a Warrior Lodge (Barracks: half). */
export const trainSeconds = (b: B): number => WARRIOR.trainSeconds / (b.key === 'warroom' && upgraded(b, 1) ? FX.warroom.train : 1);

/** A working herbalist (not mid-upgrade) with upgrade n. */
const herbalist = (list: B[], n: number): boolean => list.some((b) => b.key === 'herbalist' && !b.upgrading && upgraded(b, n));

export const medicineSeconds = (b: B): number => (upgraded(b, 1) ? FX.herbalist.seconds : HERBALIST.processSeconds);

/** Share of the usual spread of sickness at home (Healer's lore). */
export const loreSpread = (list: B[]): number => (herbalist(list, 3) ? FX.herbalist.spread : 1);

/**
 * How many times longer the sick and injured hold on: a Remedy shelf anywhere, and a Steam bath
 * at the Healing Centre they are being cared for in.
 */
export const lastLonger = (list: B[], care: B | undefined): number =>
  (herbalist(list, 2) ? FX.herbalist.illness : 1) * (care?.key === 'healer' && upgraded(care, 2) ? FX.healer.heal : 1);

/** Lowest seasonal growth of a farm (a shaded herbal garden grows at full speed all year). */
export const seasonFloor = (b: B, floor: number): number => (b.key === 'herbalgarden' && upgraded(b, 2) ? Math.max(floor, FX.herbalgarden.dry) : floor);

/** Herb bundles harvested, with rare herbs: each counts double one time in three. */
export function rareHerbs(b: B, n: number, rnd: () => number): number {
  if (b.key !== 'herbalgarden' || !upgraded(b, 3)) return n;
  let extra = 0;
  for (let k = 0; k < n; k++) if (rnd() < FX.herbalgarden.double) extra++;
  return n + extra;
}

/** Share of lightning strikes on it that set it alight (a roofed or raised store, half). */
export function strikeShare(b: B): number {
  if (b.key === 'woodstore' && upgraded(b, 2)) return FX.woodstore.fire;
  if (b.key === 'grainstore' && upgraded(b, 2)) return FX.grainstore.fire;
  return 1;
}

/** How fast firefighters fill their buckets here (Stone lining). */
export const wellRefill = (b: B): number => (b.key === 'well' && upgraded(b, 1) ? FX.well.refill : 1);

/** How far from a well firefighters will carry its water (Bucket chain). */
export const wellReach = (b: B): number => BUILDING_FIRE.wellReach * (b.key === 'well' && upgraded(b, 2) ? FX.well.range : 1);
