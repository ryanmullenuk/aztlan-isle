import { BUILDINGS, masonryCost, needsStonemason, type BuildingKey } from '../config';
import type { Cost } from '../economy/Economy';

/**
 * Building upgrades: most buildings can be improved up to three times (the torch once). Each step
 * has a name, what it does, a price and the work it takes; plain numbers (jobs, storage, beds in a
 * house) are added here, and each building's own system reads `upgrades(b)` for the rest (see FX).
 * Houses, temples, the Stonemason's and the Boat Workshop keep their own upgrade paths.
 */
export interface UpgradeStep {
  name: string;
  text: string;
  cost: Cost;
  /** Seconds of work for one builder alone (like a building's buildTime). */
  time: number;
  /** Added by this step: workers, food or wood and stone storage, beds. */
  workers?: number;
  foodCap?: number;
  woodCap?: number;
  housing?: number;
}

type Step = Pick<UpgradeStep, 'name' | 'text' | 'workers' | 'foodCap' | 'woodCap' | 'housing'>;

/** Settlement stage each upgrade needs (first, second, third). */
export const UPGRADE_STAGE = [1, 4, 5];

/** The price and work of each step, from the building's own: dearer each time, with stone and Belief later on. */
function priced(key: BuildingKey, steps: Step[]): UpgradeStep[] {
  const def = BUILDINGS[key], base = def.cost;
  const mult = [0.75, 1.25, 2];
  return steps.map((s, k) => {
    const m = mult[k];
    let cost: Cost = {
      wood: Math.round((base.wood || 8) * m + 4 * k),
      stone: Math.round(Math.max(base.stone * m, k * 8)),
      belief: Math.round(base.belief * m * 0.5 + (k === 2 ? 15 : 0)),
    };
    // Carved stone for anything built of masonry, and for every last upgrade.
    if (needsStonemason(key) || k === 2) cost = masonryCost(cost);
    return { ...s, cost, time: Math.round(Math.max(30, def.buildTime * (0.5 + k * 0.25))) };
  });
}

/** What each upgrade does, in numbers the building systems read. */
export const FX = {
  campfire: { evening: 1.5, beliefPerMinute: 1, lightRange: 1.5 },
  farm: { growth: 1.25, yield: 1.25 },
  maizefarm: { yield: 1.25 },
  chinampa: { fish: 3, moodRange: 8, mood: 0.03 },
  smokehouse: { speed: 2, wood: 0.5 },
  butcher: { meat: 1.5, speed: 1.5 },
  pigpen: { capacity: 1.5, breedSeconds: 600, meat: 1.5 },
  chickenpen: { capacity: 1.5, eggSeconds: 120, breedSeconds: 600 },
  firepit: { meal: 1.25, mood: 1.5, range: 1.5 },
  jetty: { boats: 1, catch: 1.25 },
  fishhut: { catch: 1.25 },
  woodstore: { fire: 0.5 },
  grainstore: { fire: 0.5 },
  herbalgarden: { dry: 1, double: 1 / 3 },
  herbalist: { seconds: 120, illness: 1.25, spread: 0.5 },
  firemaker: { perJar: 4, salvo: 1.5, mood: 1.5 },
  market: { often: 1.25, rate: 0.1 },
  tradedock: { boats: 1, cargo: 1.5, speed: 1.25 },
  observatory: { research: 1.2, warning: 1.3 },
  bonfire: { range: 1.4, belief: 1.5, mood: 1.5 },
  well: { refill: 1.5, range: 1.5, moodRange: 8, mood: 0.03 },
  healer: { beds: [4, 6, 6, 8], heal: 1.5 },
  kennel: { dogs: [3, 4, 4, 5] },
  greathall: { seats: [100, 150, 150, 150], mood: 0.03 },
  palace: { mood: 0.04, pearlsPerDay: 1 },
  warroom: { train: 2, tough: 1.5, sight: 1.4 },
  watchtower: { range: [13, 16, 16, 16], reload: [2.4, 2.4, 1.8, 1.8], accuracy: [0.8, 0.8, 0.8, 0.9] },
  torch: { light: 1.6 },
};

export const UPGRADES: Partial<Record<BuildingKey, UpgradeStep[]>> = {
  campfire: priced('campfire', [
    { name: 'Stone hearth ring', text: 'Stores more of everything', woodCap: 40, foodCap: 40 },
    { name: 'Storytelling circle', text: 'Evenings round the fire lift the mood and bring Belief half as much again' },
    { name: 'Eternal flame', text: 'A steady trickle of Belief and a wider light' },
  ]),
  farm: priced('farm', [
    { name: 'Irrigation ditches', text: 'Crops grow 25% faster' },
    { name: 'Fence and scarecrow', text: '+1 farmer', workers: 1 },
    { name: 'Terraced beds', text: 'Harvests 25% bigger, and its farmers catch wild chickens nearby for the farm’s run' },
  ]),
  maizefarm: priced('maizefarm', [
    { name: 'Granary crib', text: '+20 food storage', foodCap: 20 },
    { name: 'Three Sisters', text: 'Beans and squash between the maize: harvests 25% bigger' },
    { name: 'Second field', text: '+1 farmer', workers: 1 },
  ]),
  chinampa: priced('chinampa', [
    { name: 'Extra canal beds', text: '+1 farmer', workers: 1 },
    { name: 'Fish in the channels', text: 'Each harvest also brings in fish' },
    { name: 'Flower beds', text: 'Islanders nearby are happier' },
  ]),
  smokehouse: priced('smokehouse', [
    { name: 'Second rack', text: 'Smokes twice as fast' },
    { name: 'Clay chimney', text: 'Burns half the wood' },
    { name: 'Cool cellar', text: '+40 food storage', foodCap: 40 },
  ]),
  butcher: priced('butcher', [
    { name: 'Second butcher', text: '+1 butcher', workers: 1 },
    { name: 'Salting table', text: 'Half as much meat again from each animal' },
    { name: 'Butcher’s block', text: 'Meat is prepared half as fast again' },
  ]),
  pigpen: priced('pigpen', [
    { name: 'Bigger yard', text: 'Room for 15 animals instead of 10' },
    { name: 'Breeding sty', text: 'A piglet or kid is born now and then while two or more of a kind are penned' },
    { name: 'Troughs and wallow', text: 'Half as much meat again from each pig and goat' },
  ]),
  chickenpen: priced('chickenpen', [
    { name: 'Bigger coop', text: 'Room for 24 chickens instead of 16' },
    { name: 'Nest boxes', text: 'Penned hens lay eggs: a little food every two minutes' },
    { name: 'Brooding hens', text: 'A chick hatches now and then while two or more are penned' },
  ]),
  firepit: priced('firepit', [
    { name: 'Clay oven', text: 'Roasted meat meals 25% more filling' },
    { name: 'Dance ring', text: 'A bigger mood boost from the dancing at night' },
    { name: 'Long table', text: 'Draws villagers from half as far again' },
  ]),
  jetty: priced('jetty', [
    { name: 'Longer pier', text: '+1 boat and +1 fisher', workers: 1 },
    { name: 'Net racks', text: 'Catches 25% bigger' },
    { name: 'Lantern', text: 'Fishers keep fishing after dark' },
  ]),
  fishhut: priced('fishhut', [
    { name: 'Bigger stilt house', text: 'Room for 3', housing: 1 },
    { name: 'Net loft', text: 'Fishers living here catch 25% more' },
    { name: 'Larger hut', text: 'Room for 4', housing: 1 },
  ]),
  woodstore: priced('woodstore', [
    { name: 'Bigger stacks', text: '+80 wood and stone storage', woodCap: 80 },
    { name: 'Roofed shed', text: 'Catches fire half as often in storms' },
    { name: 'Timber yard', text: '+100 wood and stone storage', woodCap: 100 },
  ]),
  grainstore: priced('grainstore', [
    { name: 'Bigger stores', text: '+80 food storage', foodCap: 80 },
    { name: 'Raised on stilts', text: 'Catches fire half as often in storms' },
    { name: 'Clay jars', text: '+100 food storage', foodCap: 100 },
  ]),
  herbalgarden: priced('herbalgarden', [
    { name: 'More beds', text: '+1 gardener', workers: 1 },
    { name: 'Shade awning', text: 'Herbs grow at full speed in every season' },
    { name: 'Rare herbs', text: 'One bundle in three counts double' },
  ]),
  herbalist: priced('herbalist', [
    { name: 'Drying racks', text: 'A medicine every 2 minutes instead of 3' },
    { name: 'Remedy shelf', text: 'The sick and injured last a quarter longer before it’s too late' },
    { name: 'Healer’s lore', text: 'Sickness spreads half as often' },
  ]),
  firemaker: priced('firemaker', [
    { name: 'Bigger kiln', text: '4 fireworks from each jar of gunpowder' },
    { name: 'Rocket rack', text: 'Shows launch half as many rockets again' },
    { name: 'Coloured powders', text: 'Shows lift the village’s mood half as much again' },
  ]),
  market: priced('market', [
    { name: 'More stalls', text: '+1 market keeper', workers: 1 },
    { name: 'Canoe landing', text: 'Traders visit a quarter more often' },
    { name: 'Haggling', text: 'Better rates from every trader' },
  ]),
  tradedock: priced('tradedock', [
    { name: 'Second berth', text: '+1 trade boat' },
    { name: 'Warehouse', text: 'Trade boats carry half as much again' },
    { name: 'Beacon fire', text: 'Voyages 25% faster' },
  ]),
  observatory: priced('observatory', [
    { name: 'Star charts', text: 'Research 20% faster' },
    { name: 'Taller platform', text: 'Storm and eruption warnings come earlier' },
    { name: 'Third priest', text: '+1 sky-watcher, so research goes faster still', workers: 1 },
  ]),
  bonfire: priced('bonfire', [
    { name: 'Wider ring', text: 'Draws villagers from further away' },
    { name: 'Drums and dancers', text: 'Evenings bring half as much Belief again' },
    { name: 'Feast nights', text: 'Evenings lift the mood half as much again' },
  ]),
  well: priced('well', [
    { name: 'Stone lining', text: 'Firefighters refill half as fast again' },
    { name: 'Bucket chain', text: 'Protects buildings half as far away again' },
    { name: 'Fountain', text: 'Islanders nearby are happier' },
  ]),
  healer: priced('healer', [
    { name: 'Two more beds', text: 'Cares for 6 at once' },
    { name: 'Steam bath', text: 'The sick and injured last half as long again while waiting here' },
    { name: 'Two more beds', text: 'Cares for 8 at once' },
  ]),
  kennel: priced('kennel', [
    { name: 'Bigger run', text: 'Room for 4 dogs' },
    { name: 'Training yard', text: 'Its dogs always drive off jaguars that come near' },
    { name: 'Second dog house', text: 'Room for 5 dogs' },
  ]),
  greathall: priced('greathall', [
    { name: 'More benches', text: 'Shelters up to 150' },
    { name: 'Bell tower', text: 'The alarm is heard across the whole island' },
    { name: 'Feast hall', text: 'Every islander is a little happier' },
  ]),
  palace: priced('palace', [
    { name: 'Royal garden', text: 'Every islander is a little happier' },
    { name: 'Treasury', text: 'A pearl every day' },
    { name: 'Second throne', text: 'Two decrees in force at once' },
  ]),
  warroom: priced('warroom', [
    { name: 'Barracks', text: 'Warriors train in half the time' },
    { name: 'Training ground', text: 'Warriors are half as tough again: jaguars back down sooner and seldom kill one' },
    { name: 'Eagle perch', text: 'Warriors spot jaguars from further away' },
  ]),
  watchtower: priced('watchtower', [
    { name: 'Taller tower', text: 'Range 13 → 16 paces' },
    { name: 'Fire arrows', text: 'Shoots every 1.8 seconds instead of 2.4' },
    { name: 'Twin archers', text: 'Arrows hit 9 times in 10' },
  ]),
  torch: priced('torch', [
    { name: 'Brazier', text: 'Brighter, with a wider light' },
  ]),
};

/** Whether this building takes the upgrades here (not a house, temple or workshop with its own path). */
export const hasUpgradePath = (key: BuildingKey): boolean => !!UPGRADES[key];

/** How many upgrades a building has had (0 to 3). */
export const upgrades = (b: { key: BuildingKey; tier: number }): number => (UPGRADES[b.key] ? b.tier - 1 : 0);

/** The next upgrade, if any. */
export const nextUpgrade = (b: { key: BuildingKey; tier: number }): UpgradeStep | undefined => UPGRADES[b.key]?.[b.tier - 1];

/** The sum of a number the finished upgrades add (jobs, storage, beds). */
export function upgradeSum(b: { key: BuildingKey; tier: number }, field: 'workers' | 'foodCap' | 'woodCap' | 'housing'): number {
  const steps = UPGRADES[b.key];
  if (!steps) return 0;
  let n = 0;
  for (let k = 0; k < b.tier - 1 && k < steps.length; k++) n += steps[k][field] ?? 0;
  return n;
}

/** Jobs at a building once complete, upgrades included. */
export const jobsAt = (b: { key: BuildingKey; tier: number; def: { workers: number } }): number => b.def.workers + upgradeSum(b, 'workers');
