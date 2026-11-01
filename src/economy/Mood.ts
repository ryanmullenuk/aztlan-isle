/** What an islander's icon says about them: the most pressing thing, or that all is well. */
export type MoodKind = 'sick' | 'hungry' | 'afraid' | 'tired' | 'cold' | 'wet' | 'homeless' | 'unhappy' | 'happy';

/** The kinds that are a worry (everything but happy), most pressing first. */
export const MOOD_WORRIES: MoodKind[] = ['sick', 'hungry', 'afraid', 'tired', 'cold', 'wet', 'homeless', 'unhappy'];

export const MOOD_LABEL: Record<MoodKind, string> = {
  sick: 'Sick or hurt',
  hungry: 'Hungry',
  afraid: 'Frightened',
  tired: 'Worn out',
  cold: 'Cold',
  wet: 'Soaked',
  homeless: 'No home',
  unhappy: 'Unhappy',
  happy: 'Happy',
};

/** The parts of an islander a mood is read from. */
export interface MoodPerson {
  hunger: number;
  rest: number;
  happy: number;
  condition: 'well' | 'sick' | 'mauled';
  child: boolean;
  home: number;
  hidden: boolean;
  sleeping: boolean;
}

/** What is going on round the island. */
export interface MoodWorld {
  /** A storm is raging (anyone still out in it is soaked). */
  storm: boolean;
  night: boolean;
  winter: boolean;
  /** The sun has gone dark and nobody has calmed the village. */
  afraid: boolean;
}

/** The most pressing thing about this islander, or null when there is nothing worth showing. */
export function moodOf(p: MoodPerson, w: MoodWorld): MoodKind | null {
  const out = !p.hidden && !p.sleeping;
  if (p.condition !== 'well') return 'sick';
  if (p.hunger < 0.2) return 'hungry';
  if (w.afraid && out) return 'afraid';
  if (p.rest < 0.15 && !p.sleeping) return 'tired';
  if (w.storm && out) return 'wet';
  if (w.winter && w.night && out) return 'cold';
  if (!p.child && p.home < 0) return 'homeless';
  if (p.happy < 0.35) return 'unhappy';
  if (p.happy > 0.8) return 'happy';
  return null;
}

export interface IslandMood {
  /** 0..100: average happiness. */
  score: number;
  label: string;
  total: number;
  counts: Partial<Record<MoodKind, number>>;
}

export function moodLabel(score: number): string {
  return score >= 80 ? 'Joyful' : score >= 60 ? 'Content' : score >= 40 ? 'Uneasy' : 'Unhappy';
}

/** The whole village at a glance: how happy on average, and how many of each worry. */
export function islandMood(people: MoodPerson[], w: MoodWorld): IslandMood {
  const counts: Partial<Record<MoodKind, number>> = {};
  let sum = 0;
  for (const p of people) {
    sum += p.happy;
    const k = moodOf(p, w);
    if (k) counts[k] = (counts[k] ?? 0) + 1;
  }
  const score = people.length ? Math.round((sum / people.length) * 100) : 0;
  return { score, label: moodLabel(score), total: people.length, counts };
}

/** What lifts the village's spirits that it hasn't got yet (the same things islanders' happiness is made of). */
export interface MoodFacts {
  homeless: number;
  hungry: number;
  sick: number;
  hasTemple: boolean;
  hasGreatTemple: boolean;
  /** Kinds of food in store. */
  foodKinds: number;
  /** Homes without a well nearby. */
  dryHomes: number;
  /** Huts that could be upgraded to proper homes. */
  huts: number;
  hasHealer: boolean;
}

/** Up to three things to do about the mood, the most useful first. */
export function moodTips(f: MoodFacts): string[] {
  const tips: string[] = [];
  if (f.hungry) tips.push(f.hungry === 1 ? 'Someone is going hungry: grow, gather or catch more food.' : `${f.hungry} islanders are going hungry: grow, gather or catch more food.`);
  if (f.sick && !f.hasHealer) tips.push('Build a Healing Centre so the sick and hurt can be cared for.');
  if (f.homeless) tips.push(f.homeless === 1 ? 'One islander has nowhere to live: build a hut or home.' : `${f.homeless} islanders have nowhere to live: build huts or homes.`);
  if (!f.hasTemple) tips.push('A temple lifts everyone’s spirits.');
  if (f.foodKinds < 3) tips.push('Keep three kinds of food in store: a varied table makes people happier.');
  if (f.dryHomes) tips.push('Dig a well near the houses: fresh water close to home cheers people up.');
  if (f.huts) tips.push('Proper homes make people happier than huts.');
  if (!f.hasGreatTemple && f.hasTemple) tips.push('The Great Temple brings the whole island joy.');
  return tips.slice(0, 3);
}
