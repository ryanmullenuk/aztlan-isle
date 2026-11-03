import { HERBALIST } from '../config';
import type { Building } from './Buildings';
import type { Economy } from '../economy/Economy';
import { medicineSeconds } from './SafetyUpgrades';

/** Stock holds the reserved herb batch; growth holds its processing progress. Both are saved. */
export function processMedicine(b: Building, eco: Economy, dt: number): void {
  if (!b.complete || b.upgrading) return;
  let remaining = Math.max(0, dt);
  const secs = medicineSeconds(b);
  while (remaining > 0 && eco.goods.medicine < HERBALIST.medicineCap) {
    if (b.stock < 1) {
      if (eco.goods.herbs < 1) return;
      eco.goods.herbs -= 1;
      b.stock = 1;
      b.growth = 0;
    }
    const step = Math.min(remaining, Math.max(0, (1 - b.growth) * secs));
    b.growth += step / secs;
    remaining -= step;
    if (b.growth >= 1 - 1e-9) {
      eco.goods.medicine += 1;
      b.stock = 0;
      b.growth = 0;
    } else return;
  }
}
