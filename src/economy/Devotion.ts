/**
 * Fear or love: how the islanders see their god. Smiting them, and throwing them about, makes them
 * afraid; blessings, rain, calming storms, granted wishes and nights with the ancestors win their
 * love. Feared, they toil harder but are less happy; loved, they are happier and their Belief flows
 * more freely. Left alone, either feeling slowly fades back to plain respect. -1 is terror, 1 adoration.
 */
export const DEVOTION = {
  /** Shifts for each deed (one smiting stroke, plus a little for each extra islander struck in it). */
  smite: -0.1,
  smiteEach: -0.03,
  smiteMost: -0.25,
  thrown: -0.03,
  drowned: -0.06,
  bless: 0.04,
  rain: 0.03,
  calm: 0.06,
  wish: 0.03,
  ancestors: 0.08,
  /** Game seconds for a feeling to fade halfway back to respect (four days). */
  halfLife: 2400,
  /** At full terror: work this much faster, this much less happy. At full adoration: this much happier, this much more Belief. */
  fearPace: 0.2,
  fearMood: 0.12,
  loveMood: 0.1,
  loveBelief: 0.3,
};

export type DevotionLabel = 'Terrified' | 'Fearful' | 'Respectful' | 'Devoted' | 'Adoring';

export function devotionLabel(v: number): DevotionLabel {
  return v <= -0.6 ? 'Terrified' : v <= -0.25 ? 'Fearful' : v < 0.25 ? 'Respectful' : v < 0.6 ? 'Devoted' : 'Adoring';
}

export class Devotion {
  /** -1 (terror) to 1 (adoration). */
  value = 0;
  /** Told when the village's feeling crosses into a new kind (Fearful, Devoted…). */
  onChange: (label: DevotionLabel, was: DevotionLabel) => void = () => {};

  get fear(): number {
    return Math.max(0, -this.value);
  }

  get love(): number {
    return Math.max(0, this.value);
  }

  get label(): DevotionLabel {
    return devotionLabel(this.value);
  }

  /** How much faster the islanders work (fear drives them). */
  get pace(): number {
    return 1 + this.fear * DEVOTION.fearPace;
  }

  /** Added to every islander's happiness. */
  get mood(): number {
    return this.love * DEVOTION.loveMood - this.fear * DEVOTION.fearMood;
  }

  /** Belief from happy islanders is multiplied by this. */
  get belief(): number {
    return 1 + this.love * DEVOTION.loveBelief;
  }

  shift(d: number): void {
    if (!d || !Number.isFinite(d)) return;
    const was = this.label;
    this.value = Math.max(-1, Math.min(1, this.value + d));
    if (this.label !== was) this.onChange(this.label, was);
  }

  /** A smiting of `n` islanders at once. */
  smote(n: number): void {
    if (n > 0) this.shift(Math.max(DEVOTION.smiteMost, DEVOTION.smite + DEVOTION.smiteEach * (n - 1)));
  }

  /** Game time: the feeling fades back toward respect. */
  update(dt: number): void {
    if (dt <= 0 || !this.value) return;
    const was = this.label;
    this.value *= Math.pow(0.5, dt / DEVOTION.halfLife);
    if (Math.abs(this.value) < 1e-4) this.value = 0;
    if (this.label !== was) this.onChange(this.label, was);
  }

  save(): { value: number } {
    return { value: this.value };
  }

  restore(d: unknown): void {
    const v = Number((d as { value?: unknown } | null)?.value);
    if (Number.isFinite(v)) this.value = Math.max(-1, Math.min(1, v));
  }
}
