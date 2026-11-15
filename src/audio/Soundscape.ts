import type { Flung } from '../entities/GodHand';

/** A place a sound comes from (world x, z). */
export interface SoundSpot { x: number; z: number }

/**
 * What the soundscape listens to: the parts of the game it reads each frame (structural, so the
 * game passes itself and tests pass a stub; anything missing is simply silent).
 */
export interface SoundWorld {
  colony?: { list: readonly { x: number; z: number; flung?: Flung }[] };
  buildings?: { fountains(out?: (SoundSpot & { n: number })[]): (SoundSpot & { n: number })[] };
  passings?: { graves: { pyreAt: SoundSpot | null; flame: number } };
  ancestors?: { ghosts: { shown: number; spots(): SoundSpot[] } };
  blood?: { spawned: number; lastAt: SoundSpot };
}

interface Swimmer { mode: Flung['mode']; stroke: boolean; wade: boolean; next: number; seen: number }

/**
 * Listens to the island for the sounds of its newer happenings and turns them into effects (one-shots
 * through `sfx`) and levels for the engine's few shared loops (fountains, the pyre, the spirits'
 * pad), so nothing busy in the game has to call the audio itself. Cheap: a pass over the flung
 * islanders (field reads only), a fountain scan four times a second, and a few numbers.
 */
export class Soundscape {
  /** Fountains playing (refreshed four times a second). */
  fountains: (SoundSpot & { n: number })[] = [];
  /** The burning pyre, and how big its fire is (null: none). */
  pyre: (SoundSpot & { flame: number }) | null = null;
  /** Where the spirits stand, and how solid they are (null: none out). */
  ghosts: (SoundSpot & { shown: number }) | null = null;
  private swimmers = new Map<object, Swimmer>();
  private frame = 0;
  private fountainScan = 0;
  private ghostScan = 0;
  private ghostAt: SoundSpot | null = null;
  private shown = 0;
  private flame = 0;
  private blood = -1;

  constructor(private w: SoundWorld, private sfx: (name: string, x?: number, z?: number) => void, private rnd: () => number = Math.random) {}

  update(dt: number): void {
    this.frame++;
    this.people(dt);
    // Fountains near the view.
    this.fountainScan -= dt;
    if (this.fountainScan <= 0) {
      this.fountainScan = 0.25;
      if (this.w.buildings) this.w.buildings.fountains(this.fountains);
    }
    // A shark has taken someone.
    const b = this.w.blood;
    if (b) {
      if (this.blood < 0) this.blood = b.spawned;
      if (b.spawned > this.blood) this.sfx('sharktake', b.lastAt.x, b.lastAt.z);
      this.blood = b.spawned;
    }
    // The pyre: the fire catches with a rush, then burns on (the engine's fire bed and crackle).
    const g = this.w.passings?.graves, at = g?.pyreAt, flame = at ? g!.flame : 0;
    if (at && flame > 0 && this.flame <= 0) this.sfx('pyrelight', at.x, at.z);
    this.flame = flame;
    this.pyre = at && flame > 0 ? { x: at.x, z: at.z, flame } : null;
    // The spirits: a shimmer as they come and as they go, and a soft pad while they are out.
    const gh = this.w.ancestors?.ghosts, shown = gh ? gh.shown : 0;
    this.ghostScan -= dt;
    if (gh && shown > 0.002 && (this.ghostScan <= 0 || !this.ghostAt)) {
      this.ghostScan = 1;
      const s = gh.spots();
      if (s.length) this.ghostAt = { x: s.reduce((a, p) => a + p.x, 0) / s.length, z: s.reduce((a, p) => a + p.z, 0) / s.length };
    }
    const ga = this.ghostAt;
    if (ga && this.shown < 0.15 && shown >= 0.15) this.sfx('ghostin', ga.x, ga.z);
    if (ga && this.shown > 0.85 && shown <= 0.85) this.sfx('ghostout', ga.x, ga.z);
    this.shown = shown;
    this.ghosts = ga && shown > 0.002 ? { x: ga.x, z: ga.z, shown } : null;
    if (shown <= 0.002) this.ghostAt = null;
  }

  /** Islanders in the god's hand or in the water: the whoosh of a throw, splashes and strokes. */
  private people(dt: number): void {
    const list = this.w.colony?.list;
    if (!list) return;
    const r = this.rnd;
    for (const isl of list) {
      const f = isl.flung;
      if (!f) continue;
      let s = this.swimmers.get(isl);
      if (!s) {
        s = { mode: f.mode, stroke: false, wade: false, next: 0.3 + r() * 0.5, seen: 0 };
        this.swimmers.set(isl, s);
        if (f.mode === 'air' && f.t < 0.3) this.sfx('whoosh', isl.x, isl.z);
      } else if (s.mode === 'held' && f.mode === 'air') this.sfx('whoosh', isl.x, isl.z);
      s.seen = this.frame;
      const stroke = f.mode === 'bathe' && !!f.stroke, wade = f.mode === 'bathe' && !!f.wade;
      if (f.mode === 'bathe') {
        // Off the bank into the shallows, and from wading into swimming depth.
        if (wade && !s.wade && !s.stroke) this.sfx('paddle', isl.x, isl.z);
        if (stroke && s.wade) { this.sfx('wadein', isl.x, isl.z); s.next = 0.6 + r() * 0.4; }
      }
      s.mode = f.mode; s.stroke = stroke; s.wade = wade;
      if (f.mode !== 'bathe' && f.mode !== 'swim') continue;
      s.next -= dt;
      if (s.next > 0) continue;
      if (f.mode === 'swim') { this.sfx('stroke', isl.x, isl.z); s.next = 0.7 + r() * 0.4; } // Swimming hard for the shore.
      else if (stroke) { this.sfx('stroke', isl.x, isl.z); s.next = 1.1 + r() * 0.7; }
      else if (wade) { this.sfx('paddle', isl.x, isl.z); s.next = 1.4 + r() * 1.2; }
      else { this.sfx('paddle', isl.x, isl.z); s.next = 2.5 + r() * 3; } // Treading water.
    }
    for (const [isl, s] of this.swimmers) if (s.seen !== this.frame) this.swimmers.delete(isl);
  }
}
