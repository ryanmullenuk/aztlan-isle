import { JETTY, type BuildingKey } from '../config';
import { buildingOperational, type BuildingCondition } from './BuildingCondition';
import { FX, upgrades } from './Upgrades';

/**
 * What the food buildings' upgrades do, for the systems that farm, fish, smoke, butcher and keep
 * animals. Each takes the building (or nothing) and gives 1 (or the plain number) until its step is done.
 */
type Live = BuildingCondition & { key: BuildingKey; tier: number };

/** Upgrade step n is done and the building is working. */
const has = (b: Live | null | undefined, key: BuildingKey, n: number): b is Live =>
  !!b && b.key === key && upgrades(b) >= n && buildingOperational(b);

/** Most animals each pen holds before upgrades. */
export const PEN_ROOM: Partial<Record<BuildingKey, number>> = { pigpen: 10, chickenpen: 16 };
/** Chickens a farm's own run takes from its farmers' catching. */
export const FARM_RUN = 3;

/** Room in a pen (Infinity for the farm's and slaughterhouse's runs). */
export function penRoom(b: Live): number {
  const base = PEN_ROOM[b.key];
  if (!base) return Infinity;
  const big = has(b, 'pigpen', 1) ? FX.pigpen.capacity : has(b, 'chickenpen', 1) ? FX.chickenpen.capacity : 1;
  return Math.floor(base * big);
}

/** Crops grow this much faster. */
export const growthFactor = (b: Live): number => has(b, 'farm', 1) ? FX.farm.growth : 1;

/** Each harvest is this much bigger. */
export const harvestFactor = (b: Live): number => has(b, 'farm', 3) ? FX.farm.yield : has(b, 'maizefarm', 2) ? FX.maizefarm.yield : 1;

/** Fish brought in with each harvest. */
export const harvestFish = (b: Live): number => has(b, 'chinampa', 2) ? FX.chinampa.fish : 0;

/** This farm's farmers catch wild chickens for its run. */
export const catchesChickens = (b: Live): boolean => has(b, 'farm', 3);

/** Seconds one batch takes to smoke. */
export const smokeSeconds = (b: Live, base: number): number => base / (has(b, 'smokehouse', 1) ? FX.smokehouse.speed : 1);

/** Wood one batch burns. */
export const smokeWood = (b: Live | null | undefined, base: number): number => base * (has(b, 'smokehouse', 2) ? FX.smokehouse.wood : 1);

/** Meat from an animal: the slaughterhouse's salting table, and the pig pen's troughs for its pigs and goats. */
export const meatFactor = (butcher: Live, pen: Live | null | undefined): number =>
  (has(butcher, 'butcher', 2) ? FX.butcher.meat : 1) * (has(pen, 'pigpen', 3) ? FX.pigpen.meat : 1);

/** Seconds preparing the meat at the slaughterhouse. */
export const butcherSeconds = (b: Live, base: number): number => base / (has(b, 'butcher', 3) ? FX.butcher.speed : 1);

/** Boats a jetty can moor. */
export const jettyBoats = (j: Live): number => JETTY.maxBoats + (has(j, 'jetty', 1) ? FX.jetty.boats : 0);

/** A boat's catch: the jetty's net racks, and the net loft of the fisher's hut. */
export const catchFactor = (j: Live, home: Live | null | undefined): number =>
  (has(j, 'jetty', 2) ? FX.jetty.catch : 1) * (has(home, 'fishhut', 2) ? FX.fishhut.catch : 1);

/** Fishers from this jetty keep fishing after dark. */
export const nightFishing = (j: Live | null | undefined): boolean => has(j, 'jetty', 3);

/** A pen breeds (a piglet, a chick) every this many seconds while two or more are penned; 0 never. */
export const breedSeconds = (b: Live): number => has(b, 'pigpen', 2) ? FX.pigpen.breedSeconds : has(b, 'chickenpen', 3) ? FX.chickenpen.breedSeconds : 0;

/** Penned hens lay an egg each every this many seconds; 0 never. */
export const eggSeconds = (b: Live): number => has(b, 'chickenpen', 2) ? FX.chickenpen.eggSeconds : 0;
