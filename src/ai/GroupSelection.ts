import type { Islander } from '../entities/Islander';
import { ISLANDER } from '../config';

/** Available adults, including workers temporarily idle because their job has no work. */
export function idleForGroup(i: Islander): boolean {
  return !i.child && !i.hidden && !i.sleeping && !i.warrior && i.condition === 'well' && !i.carry &&
    (!i.task || ['wander', 'hall', 'bonfire'].includes(i.task.kind));
}

/** Routine automatic work gives way to meals and rest, without dropping a carried load. */
export function needsSelfCare(i: Islander, night: boolean, food: number, hasFoodStore = true): boolean {
  return !i.manualRole && !i.child && !i.warrior && !i.carry && i.condition === 'well' &&
    !!i.task && i.task.stage <= 1 && ['chop', 'mine', 'gather', 'farm', 'smoke', 'wander', 'pray', 'spearfish'].includes(i.task.kind) &&
    ((hasFoodStore && food >= 1 && i.hunger < ISLANDER.eatThreshold) || i.rest < ISLANDER.sleepThreshold || night);
}

/** Remember the first tap's available people before the AI can give them another job. */
export class IdleGroupTap {
  private last: {id: number; time: number; x: number; y: number; ids: number[]} | null = null;
  tap(id: number, time: number, x: number, y: number, ids: number[]): number[] | null {
    const previous = this.last;
    if (previous && previous.id === id && time - previous.time <= 550 && Math.hypot(x - previous.x, y - previous.y) <= 28 && previous.ids.includes(id)) {
      this.last = null;
      return previous.ids;
    }
    this.last = {id, time, x, y, ids};
    return null;
  }
  clear(): void { this.last = null; }
}
