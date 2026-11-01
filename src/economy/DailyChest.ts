/** Pearls in the chest on each day of a streak; after the last day it stays at the top. */
export const DAILY_PEARLS = [1, 1, 2, 2, 3, 3, 5];

/** Where the last claim and the streak are kept on this device (the chest is the player's, not an island's). */
const KEY = 'aztlan-daily-chest';

export interface ChestState {
  /** Local calendar day of the last claim (YYYY-MM-DD). */
  last: string;
  /** Days in a row claimed, ending on `last`. */
  streak: number;
}

/** A local calendar day as YYYY-MM-DD. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Today's chest given the last claim: null if it was already opened today, otherwise which day of
 * the streak it is (1 if a day was missed) and the pearls inside.
 */
export function chestFor(state: ChestState | null, now: Date): { day: number; pearls: number } | null {
  const today = dayKey(now);
  if (state?.last === today) return null;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const day = state && state.last === dayKey(y) ? state.streak + 1 : 1;
  return { day, pearls: DAILY_PEARLS[Math.min(day, DAILY_PEARLS.length) - 1] };
}

export function loadChest(): ChestState | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return s && typeof s.last === 'string' && typeof s.streak === 'number' ? s : null;
  } catch {
    return null;
  }
}

export function saveChest(s: ChestState): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

/** Pearls to finish a build straight away: one for every minute of work left (at least one). */
export function rushPearls(secondsLeft: number): number {
  return Math.max(1, Math.ceil(secondsLeft / 60));
}
