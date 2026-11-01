/**
 * Rare events, days apart: an eclipse of the sun, a comet in the night sky, a whale stranded on
 * the beach. Each is planned ahead for a day and an hour, so the Observatory can foresee it.
 */
export type RareKind = 'eclipse' | 'comet' | 'whale';

export interface RareSave {
  /** The game day the next event happens. */
  next: number;
  kind: RareKind;
  /** The one before it (the same never comes twice running). */
  last?: RareKind;
  /** The Observatory has already foretold it. */
  told?: boolean;
}

export const RARE = {
  /** No rare event in the first days of an island. */
  firstDay: 3,
  /** Days between one and the next: at least this, plus up to `gapSpread` more. */
  gapMin: 5,
  gapSpread: 5,
  /** The clock hour each one begins. */
  hour: { eclipse: 11, comet: 20.8, whale: 8.5 } as Record<RareKind, number>,
  /** Game seconds the eclipse lasts, end to end (totality is the middle sixth). */
  eclipseLength: 150,
  /** Nights the comet is seen. */
  cometNights: 2,
};

const KINDS: RareKind[] = ['eclipse', 'comet', 'whale'];

/** Choose the next event after `day`: a few days on, never the same kind as the last. */
export function planRare(day: number, rnd: () => number, last?: RareKind): RareSave {
  const options = KINDS.filter((k) => k !== last);
  const kind = options[Math.floor(rnd() * options.length) % options.length];
  const next = Math.max(RARE.firstDay, day + RARE.gapMin + Math.floor(rnd() * (RARE.gapSpread + 1)));
  return { next, kind, ...(last ? { last } : {}) };
}

/** Whether the planned event starts now: its day has come and so has its hour. */
export function rareDue(s: RareSave, day: number, hour: number): boolean {
  return day > s.next || (day === s.next && hour >= RARE.hour[s.kind]);
}

/** How much of the sun the moon covers, 0..1, at `t` game seconds into an eclipse lasting `len`. */
export function eclipseCover(t: number, len = RARE.eclipseLength): number {
  const u = t / len;
  if (u <= 0 || u >= 1) return 0;
  const edge = 5 / 12;
  const s = (x: number) => x * x * (3 - 2 * x);
  if (u < edge) return s(u / edge);
  if (u > 1 - edge) return s((1 - u) / edge);
  return 1;
}

/** How dark the day goes: little until the sun is nearly covered, then deep dusk at totality. */
export function eclipseDark(cover: number): number {
  const x = Math.min(1, Math.max(0, (cover - 0.6) / 0.4));
  return x * x * (3 - 2 * x);
}

export function restoreRare(d: unknown): RareSave | null {
  if (!d || typeof d !== 'object') return null;
  const r = d as Partial<RareSave>;
  if (!Number.isFinite(r.next) || !KINDS.includes(r.kind as RareKind)) return null;
  return { next: r.next!, kind: r.kind as RareKind, ...(KINDS.includes(r.last as RareKind) ? { last: r.last } : {}), ...(r.told === true ? { told: true } : {}) };
}
