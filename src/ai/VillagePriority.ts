import type { Role } from '../entities/Islander';

export const VILLAGE_PRIORITIES = {
  balanced: { label: 'Balanced', effect: 'Share automatic workers between food, materials and building as needed.' },
  food: { label: 'Food', effect: 'Favour fruit gathering, farming, fishing and food preparation.' },
  materials: { label: 'Materials', effect: 'Favour wood, stone and carved stone production.' },
  construction: { label: 'Construction', effect: 'Favour ready building sites and the materials needed to build.' },
} as const;
export type VillagePriority = keyof typeof VILLAGE_PRIORITIES;
export function isVillagePriority(value: unknown): value is VillagePriority {
  return typeof value === 'string' && Object.hasOwn(VILLAGE_PRIORITIES, value);
}
export function villagePriority(value: unknown): VillagePriority {
  return isVillagePriority(value) ? value : 'balanced';
}

/** Preferences adjust demand, never an islander's current task or destination. */
export function gatheringWeights(priority: VillagePriority, food: number, wood: number, stone: number) {
  const foodBias = priority === 'food' ? 3 : 1;
  const materialBias = priority === 'materials' ? 3 : priority === 'construction' ? 1.5 : 1;
  return { gatherer: food * foodBias, woodcutter: wood * materialBias, miner: stone * materialBias };
}
export function jobRank(priority: VillagePriority, role: Role, medicinal = false): number {
  const normal: Partial<Record<Role, number>> = { builder: 0, mason: .5, farmer: 1, fisher: 2, butcher: 3, smoker: 3.5, priest: 4, merchant: 4.5 };
  if (priority === 'food') {
    if (role === 'farmer' && !medicinal) return 0;
    if (['fisher', 'butcher', 'smoker'].includes(role)) return 1;
    if (role === 'builder') return 2;
    return 3 + (normal[role] ?? 5);
  }
  if (priority === 'materials' && role === 'mason') return -1;
  return normal[role] ?? 5;
}

export function specialistShare(priority: VillagePriority, lowFood: boolean): number {
  if (priority === 'food') return .7;
  if (lowFood) return .55;
  return priority === 'materials' ? .5 : priority === 'construction' ? .85 : .75;
}
