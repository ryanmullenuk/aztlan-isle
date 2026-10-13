import { BOAT_WORKSHOP, BUILDINGS, ECONOMY, HOMES, STONEMASON, TEMPLE, type BuildingKey } from '../config';

/** What a completion banner says: its heading, the building line and the benefit gained (if any). */
export interface BuildingNoticeText {
  title: string;
  line: string;
  benefit: string | null;
}

/** What the announcement needs to know about the finished building. */
export interface FinishedBuilding {
  key: BuildingKey;
  tier: number;
  label: string;
  lastWork: { upgrade: boolean; fromTier: number };
  fromHut?: boolean;
}

/** Short statements of what a building does once built, for those with no number to report. */
const ROLE: Partial<Record<BuildingKey, string>> = {
  greathall: 'Shelters up to 100 islanders',
  palace: 'Royal decrees can now be issued',
  kennel: 'Room for 3 village dogs',
  watchtower: 'Guards against jaguars and alligators',
  well: 'Fresh water for fighting fires',
  pigpen: 'Holds captured pigs and goats',
  chickenpen: 'Holds captured chickens',
  bonfire: 'Evening gatherings raise Belief',
  firepit: 'Roasted meat makes meals more filling',
  tradedock: 'Trade boats can now be built',
  herbalist: 'Turns herbs into medicine',
  healer: 'Cares for the sick and injured',
  smokehouse: 'Preserves raw fish and meat',
  warroom: 'Trains Jaguar and Eagle warriors',
  boatworkshop: 'Canoes can now be built at Fishing Jetties',
  stonemason: 'Masonry unlocked',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The banner text for a building that has just been finished. New buildings report what they add
 * (housing, storage, Belief capacity, jobs) or what they do; upgrades report only the improvement.
 * Only real game effects are reported, never invented rewards.
 */
export function buildingNotice(b: FinishedBuilding): BuildingNoticeText {
  const def = BUILDINGS[b.key];
  const upgrade = b.lastWork.upgrade;
  if (upgrade) {
    const to = b.tier, from = b.lastWork.fromTier;
    let benefit: string | null = null;
    if (b.key === 'home') benefit = `+${HOMES.housing[to - 1] - HOMES.housing[from - 1]} Islander Capacity`;
    else if (b.key === 'temple') benefit = `+${ECONOMY.beliefCapPerTempleTier} Belief Capacity`;
    else if (b.key === 'stonemason') benefit = `${STONEMASON.upgrades[to - 2]?.unlock ?? 'New work'} unlocked`;
    else if (b.key === 'boatworkshop') benefit = `${BOAT_WORKSHOP.upgrades[to - 2]?.unlock ?? 'New boats'} unlocked`;
    const line = b.key === 'temple' && to >= (def.maxTier ?? 1) ? 'The Great Pyramid stands complete' : `${b.label} upgraded`;
    return { title: 'Upgrade Complete', line, benefit };
  }
  const name = b.key === 'hut' ? 'Hut' : b.key === 'home' ? 'Family House' : def.name;
  let benefit: string | null = null;
  if (b.key === 'home' && b.fromHut) benefit = `+${(def.housing ?? 0) - (BUILDINGS.hut.housing ?? 0)} Islander Capacity`;
  else if (def.housing) benefit = `+${def.housing} Islander Capacity`;
  else if (def.woodCap) benefit = `+${def.woodCap} Wood & Stone Storage`;
  else if (def.foodCap) benefit = `+${def.foodCap} Food Storage`;
  else if (b.key === 'temple') benefit = `+${ECONOMY.beliefCapPerTempleTier} Belief Capacity`;
  else if (b.key === 'greattemple') benefit = `+${TEMPLE.greatBeliefCapTiers * ECONOMY.beliefCapPerTempleTier} Belief Capacity`;
  else if (ROLE[b.key]) benefit = ROLE[b.key]!;
  else if (def.workers > 0) benefit = `+${plural(def.workers, 'Job')}`;
  // Longer names keep the line short enough to read at a glance.
  return { title: 'Building Complete', line: name.length <= 14 ? `${name} constructed successfully` : `${name} built`, benefit };
}

/** Buildings too small and quick to announce one by one (torches go up by the dozen). */
export const QUIET_BUILDINGS = new Set<BuildingKey>(['campfire', 'torch']);
