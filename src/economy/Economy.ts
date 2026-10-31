import { ECONOMY, FOOD_KEYS, GoodKey, ResourceKey, TEMPLE } from '../config';

export type Cost = { wood: number; stone: number; belief: number; carvedStone?: number; food?: number };

/** Global stockpile. Physical delivery is simulated by carriers; this tracks the totals and capacities. */
/** Longest absence that still counts, and the share of normal gathering done while away. */
export const AWAY_CAP_SECONDS = 4 * 3600;
export const AWAY_PACE = 0.35;

export class Economy {
  res: Record<ResourceKey, number> = { ...ECONOMY.start };
  /** Precious goods (no store limit): pearls for trading, herbs and spices for healing. */
  goods: Record<GoodKey, number> = { pearls: 0, herbs: 0, spices: 0, medicine: 0, carvedstone: 0 };
  woodCap = ECONOMY.baseWoodCap;
  foodCap = ECONOMY.baseFoodCap;
  beliefCap = ECONOMY.beliefBaseCap;
  /** Rolling income rates for the UI (per minute). */
  rates: Partial<Record<ResourceKey, number>> = {};
  /** The same, smoothed over several minutes of play (saved): what the village gathers while you're away. */
  steady: Partial<Record<ResourceKey, number>> = {};
  private acc: Partial<Record<ResourceKey, number>> = {};
  private rateTimer = 0;
  /** Test mode: everything is free and stores never run out. */
  godMode = false;
  static readonly GOD_AMOUNT = 9999;

  get food(): number {
    return FOOD_KEYS.reduce((s, k) => s + this.res[k], 0);
  }

  /** Remaining space for a resource. */
  space(k: ResourceKey): number {
    if (this.godMode) return Economy.GOD_AMOUNT;
    if (k === 'belief') return this.beliefCap - this.res.belief;
    if (k === 'wood' || k === 'stone') return this.woodCap - this.res[k];
    return this.foodCap - this.food;
  }

  /** Adds up to n; returns the amount actually stored. */
  add(k: ResourceKey, n: number): number {
    const a = Math.max(0, Math.min(n, this.space(k)));
    this.res[k] += a;
    this.acc[k] = (this.acc[k] ?? 0) + a;
    return a;
  }

  canAfford(c: Cost): boolean {
    if (this.godMode) return true;
    return this.res.wood >= c.wood && this.res.stone >= c.stone && this.res.belief >= c.belief && this.goods.carvedstone >= (c.carvedStone ?? 0) && this.food >= (c.food ?? 0);
  }

  spend(c: Cost): boolean {
    if (this.godMode) return true;
    if (!this.canAfford(c)) return false;
    this.res.wood -= c.wood;
    this.res.stone -= c.stone;
    this.res.belief -= c.belief;
    this.goods.carvedstone -= c.carvedStone ?? 0;
    let food = c.food ?? 0;
    for (const key of [...FOOD_KEYS].sort((a,b) => this.res[b] - this.res[a])) {
      const take = Math.min(food, this.res[key]);
      this.res[key] -= take;
      food -= take;
      if (food <= 0) break;
    }
    return true;
  }

  refund(c: Cost, frac = 1): void {
    this.add('wood', Math.floor(c.wood * frac));
    this.add('stone', Math.floor(c.stone * frac));
    this.add('belief', Math.floor(c.belief * frac));
    this.goods.carvedstone += Math.floor((c.carvedStone ?? 0) * frac);
    this.add('grain', Math.floor((c.food ?? 0) * frac));
  }

  /** Take one meal. Returns the food type eaten (variety-weighted), or null. */
  takeMeal(lastEaten?: ResourceKey): ResourceKey | null {
    const avail = FOOD_KEYS.filter((k) => this.res[k] >= 1);
    if (!avail.length) return null;
    // Prefer something different from last time for variety.
    const pick = avail.filter((k) => k !== lastEaten);
    const list = pick.length ? pick : avail;
    let best = list[0];
    for (const k of list) if (this.res[k] > this.res[best]) best = k;
    this.res[best] -= ECONOMY.foodPerMeal;
    return best;
  }

  recomputeCaps(woodCap: number, foodCap: number, templeTiers: number): void {
    if (this.godMode) return;
    this.woodCap = woodCap;
    this.foodCap = foodCap;
    this.beliefCap = ECONOMY.beliefBaseCap + templeTiers * ECONOMY.beliefCapPerTempleTier;
    this.res.belief = Math.min(this.res.belief, this.beliefCap);
  }

  update(dt: number): void {
    if (this.godMode) {
      // Keep every store brimming.
      for (const k of Object.keys(this.res) as ResourceKey[]) this.res[k] = Economy.GOD_AMOUNT;
      this.woodCap = this.foodCap = this.beliefCap = Economy.GOD_AMOUNT * 10;
    }
    this.rateTimer += dt;
    if (this.rateTimer >= 30) {
      for (const k of Object.keys(this.acc) as ResourceKey[]) this.rates[k] = ((this.acc[k] ?? 0) / this.rateTimer) * 60;
      for (const k of Object.keys(this.res) as ResourceKey[]) this.steady[k] = (this.steady[k] ?? 0) * 0.85 + ((this.acc[k] ?? 0) / this.rateTimer) * 60 * 0.15;
      this.acc = {};
      this.rateTimer = 0;
    }
  }

  /**
   * Away for `seconds` (capped at four hours): the islanders kept gathering at about a third of
   * their usual pace (they rest at night, and nobody is directing them), up to what the stores hold.
   * Returns what was actually added.
   */
  awayGains(seconds: number): Partial<Record<ResourceKey, number>> {
    const t = Math.min(Math.max(0, seconds), AWAY_CAP_SECONDS), out: Partial<Record<ResourceKey, number>> = {};
    if (this.godMode) return out;
    for (const k of Object.keys(this.steady) as ResourceKey[]) {
      const rate = this.steady[k] ?? 0;
      if (!(rate > 0)) continue;
      const got = Math.floor(this.add(k, (rate / 60) * t * AWAY_PACE));
      if (got > 0) out[k] = got;
    }
    return out;
  }

  templeUpgradeCost(tier: number): Cost {
    return TEMPLE.upgradeCost[tier] ?? TEMPLE.upgradeCost[TEMPLE.upgradeCost.length - 1];
  }
}
