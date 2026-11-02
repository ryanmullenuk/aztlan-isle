import { FIREWORKS, GOODS, type GoodKey, type RareOffer } from '../config';
import type { Economy } from './Economy';

/** What has been bought from the rare goods traders today (saved with the island). */
export interface RareSales { day: number; bought: Partial<Record<GoodKey, number>> }

/** The milestone that marks a rare good as discovered. */
export const foundFlag = (k: GoodKey): string => `found:${k}`;

/**
 * Gunpowder in a returning voyage's hold: rare until discovered (a few jars the first time), and
 * now and then a jar or two afterwards. `r` is a random number source in [0, 1).
 */
export function voyageGunpowder(found: boolean, r: () => number): number {
  if (r() >= (found ? FIREWORKS.findAgain : FIREWORKS.findFirst)) return 0;
  if (!found) return FIREWORKS.firstJars;
  const [lo, hi] = FIREWORKS.againJars;
  return lo + Math.floor(r() * (hi - lo + 1));
}

/** How many more of a rare good the traders will sell today. */
export function rareLeft(s: RareSales, day: number, o: RareOffer): number {
  return Math.max(0, o.perDay - (s.day === day ? s.bought[o.key] ?? 0 : 0));
}

/** Why `n` can't be bought now ('' if it can). */
export function rareBlock(eco: Economy, s: RareSales, day: number, o: RareOffer, found: boolean, n = 1): string {
  if (!found) return `Undiscovered: voyagers have yet to find ${GOODS[o.key].name.toLowerCase()}`;
  const left = rareLeft(s, day, o);
  if (left <= 0) return 'Sold out today: the traders will have more tomorrow';
  if (n > left) return `Only ${left} left today`;
  if (eco.goods.pearls < o.pearls * n) return `Needs ${o.pearls * n} pearls`;
  return '';
}

/** Pay pearls for `n` of a rare good; returns why not, or '' once bought. */
export function buyRare(eco: Economy, s: RareSales, day: number, o: RareOffer, found: boolean, n = 1): string {
  const why = rareBlock(eco, s, day, o, found, n);
  if (why) return why;
  if (s.day !== day) { s.day = day; s.bought = {}; }
  s.bought[o.key] = (s.bought[o.key] ?? 0) + n;
  eco.goods.pearls -= o.pearls * n;
  eco.goods[o.key] += n;
  return '';
}

/** Read saved sales back (anything malformed starts afresh). */
export function restoreSales(d: unknown): RareSales {
  const o = d as Partial<RareSales> | null;
  if (!o || typeof o !== 'object' || !Number.isFinite(o.day)) return { day: -1, bought: {} };
  const bought: RareSales['bought'] = {};
  for (const [k, n] of Object.entries(o.bought ?? {})) if (k in GOODS && Number(n) > 0) bought[k as GoodKey] = Math.floor(Number(n));
  return { day: Number(o.day), bought };
}

/** One stretch of a firemaker's work: a jar of gunpowder into fireworks, if there's a jar and room. */
export function packFireworks(eco: Economy): boolean {
  if (eco.goods.gunpowder < 1 || eco.goods.fireworks > FIREWORKS.cap - FIREWORKS.perJar) return false;
  eco.goods.gunpowder -= 1;
  eco.goods.fireworks += FIREWORKS.perJar;
  return true;
}
