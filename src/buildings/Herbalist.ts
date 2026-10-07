import { HERBALIST } from '../config';
import type { Building } from './Buildings';
import type { Economy } from '../economy/Economy';

/** Growth is stored on the building, so unfinished batches survive saving and moving. */
export function growMedicinalHerbs(b: Building, eco: Economy, dt: number): void {
  if (!b.complete || b.upgrading || eco.goods.herbs >= HERBALIST.herbCap) return;
  b.growth += Math.max(0, dt) / HERBALIST.growSeconds;
  const bundles = Math.min(Math.floor(b.growth), Math.max(0, Math.floor(HERBALIST.herbCap - eco.goods.herbs)));
  eco.goods.herbs += bundles;
  b.growth -= bundles;
  b.growth = Math.min(1, b.growth);
}
