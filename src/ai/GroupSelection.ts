import type { Islander } from '../entities/Islander';
import { ISLANDER } from '../config';

/** Available adults, including workers temporarily idle because their job has no work. */
export function idleForGroup(i: Islander): boolean {
  return !i.child && !i.hidden && !i.sleeping && !i.warrior && i.condition === 'well' && !i.carry &&
    (!i.task || i.task.kind === 'wander');
}

/** Routine automatic work gives way to meals and rest, without dropping a carried load. */
export function needsSelfCare(i: Islander, night: boolean, food: number): boolean {
  return !i.manualRole && !i.child && !i.warrior && !i.carry && i.condition === 'well' &&
    !!i.task && i.task.stage <= 1 && ['chop', 'mine', 'gather', 'farm', 'smoke', 'wander', 'pray', 'spearfish'].includes(i.task.kind) &&
    ((food >= 1 && i.hunger < ISLANDER.eatThreshold) || i.rest < ISLANDER.sleepThreshold || night);
}
