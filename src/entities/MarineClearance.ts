import type { World } from '../world/World';

/** Sweep a body-width corridor, not just its centre, through terrain and fixed rocks. */
export function marinePathClear(world: World, ax: number, az: number, bx: number, bz: number, radius = 1.3): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.4));
  const reach = Math.ceil(radius + 0.71);
  for (let step = 0; step <= steps; step++) {
    const f = step / steps, x = ax + (bx - ax) * f, z = az + (bz - az) * f;
    const [cx, cz] = world.cellOf(x, z);
    for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
      const xx = cx + dx, zz = cz + dz;
      if (!world.inBounds(xx, zz)) continue;
      if (Math.hypot(world.centerX(xx) - x, world.centerZ(zz) - z) > radius + 0.71) continue;
      const i = world.idx(xx, zz);
      if (world.blockFixed[i] || world.heightAt(world.centerX(xx), world.centerZ(zz)) > -2.2) return false;
    }
  }
  return true;
}
