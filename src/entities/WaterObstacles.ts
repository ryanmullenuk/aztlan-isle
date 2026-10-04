import type { World } from '../world/World';

/** Swept clearance against rock cells, including the animal's body radius. */
export function clearWaterMove(w: World, x: number, z: number, nx: number, nz: number, radius: number): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(nx - x, nz - z) / 0.2));
  for (let step = 0; step <= steps; step++) {
    const px = x + (nx - x) * step / steps, pz = z + (nz - z) * step / steps;
    for (let k = 0; k < 9; k++) {
      const a = k * Math.PI / 4, r = k === 8 ? 0 : radius;
      const [cx, cz] = w.cellOf(px + Math.cos(a) * r, pz + Math.sin(a) * r);
      if (w.inBounds(cx, cz) && w.blocked(w.idx(cx, cz))) return false;
    }
  }
  return true;
}
