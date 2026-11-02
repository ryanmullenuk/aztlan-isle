import type { Anim, Islander } from '../entities/Islander';

/** What a gathering needs from the colony. */
export interface GatherColony {
  list: Islander[];
  byId(id: number): Islander | undefined;
  walkTo(isl: Islander, x: number, z: number): void;
}

interface Member {
  id: number;
  x: number;
  z: number;
  /** Arrived and taking part. */
  here: boolean;
}

/**
 * A few islanders called away from their work to one spot (a stranded whale, the temple steps),
 * each to a place of their own. Once there they stay put, facing the middle and doing `anim`
 * (pushing, praying), until the gathering is released. Anyone who goes off to eat or sleep, falls
 * sick or can't get there drops out.
 */
export class Gathering {
  private members: Member[] = [];

  /** What those taking part do (it can change: watching, then dancing). */
  anim: Anim;

  constructor(private colony: GatherColony, anim: Anim, private cx: number, private cz: number) {
    this.anim = anim;
  }

  /** The islanders taking part (arrived or on their way). */
  get ids(): number[] {
    return this.members.map((m) => m.id);
  }

  /** Call one particular islander to a place of their own (the bride and groom, say). */
  join(i: Islander, x: number, z: number): void {
    if (this.members.some((m) => m.id === i.id)) return;
    this.colony.walkTo(i, x, z);
    this.members.push({ id: i.id, x, z, here: false });
  }

  /** Islanders on their way or taking part. */
  get size(): number {
    return this.members.length;
  }

  /** How many have arrived and are taking part. */
  get present(): number {
    return this.members.reduce((n, m) => n + (m.here ? 1 : 0), 0);
  }

  /**
   * Call up to `n` more of the nearest able adults to the free `slots`. Returns how many were sent.
   * `busy` rules out anyone who must not be pulled away.
   */
  call(n: number, slots: { x: number; z: number }[], busy: (isl: Islander) => boolean = () => false): number {
    const taken = new Set(this.members.map((m) => m.id));
    const free = slots.filter((s) => !this.members.some((m) => m.x === s.x && m.z === s.z));
    const cand = this.colony.list
      .filter((i) => !taken.has(i.id) && !i.child && !i.npc && !i.hidden && !i.sleeping && i.condition === 'well' && i.hunger > 0.3 && i.rest > 0.25 && !busy(i))
      .map((i) => ({ i, d: (i.x - this.cx) ** 2 + (i.z - this.cz) ** 2 }))
      .sort((a, b) => a.d - b.d);
    let sent = 0;
    for (const { i } of cand) {
      if (sent >= n || !free.length) break;
      // The free place nearest to them.
      let best = 0;
      for (let k = 1; k < free.length; k++) if ((free[k].x - i.x) ** 2 + (free[k].z - i.z) ** 2 < (free[best].x - i.x) ** 2 + (free[best].z - i.z) ** 2) best = k;
      const s = free.splice(best, 1)[0];
      this.colony.walkTo(i, s.x, s.z);
      this.members.push({ id: i.id, x: s.x, z: s.z, here: false });
      sent++;
    }
    return sent;
  }

  /** Each frame, after the colony has moved everyone: hold those who have arrived in place. */
  update(): void {
    for (let k = this.members.length - 1; k >= 0; k--) {
      const m = this.members[k], i = this.colony.byId(m.id);
      const d = i ? Math.hypot(i.x - m.x, i.z - m.z) : Infinity;
      const walking = i?.task?.kind === 'goto';
      // Gone, ill, or off doing something else (eating, sleeping, running from danger).
      if (!i || i.condition !== 'well' || i.hidden || i.hunger < 0.15 || i.rest < 0.1 || (i.task && !walking) || (!i.task && d > 2.5)) {
        if (i && m.here) i.think = 0;
        this.members.splice(k, 1);
        continue;
      }
      if (walking) continue;
      m.here = true;
      // Stay: no new thoughts while taking part, facing the middle, at work.
      i.think = 0.5;
      i.anim = this.anim;
      i.heading = Math.atan2(this.cx - i.x, this.cz - i.z);
    }
  }

  /** Everyone back to their own lives. */
  release(): void {
    for (const m of this.members) {
      const i = this.colony.byId(m.id);
      if (i && !i.task) i.think = 0;
    }
    this.members = [];
  }
}
