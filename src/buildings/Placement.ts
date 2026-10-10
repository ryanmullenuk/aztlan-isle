import type { World } from '../world/World';

export interface PlacementSite { cx: number; cz: number; rot: number }

/** Magnetic snap is deliberately local: never pull a preview away from the player's chosen area. */
export function snapPlacement(site: PlacementSite, valid: (site: PlacementSite) => boolean): PlacementSite {
  if (valid(site)) return site;
  const nearby: PlacementSite[] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (dx || dz) nearby.push({ cx: site.cx + dx, cz: site.cz + dz, rot: site.rot });
  }
  nearby.sort((a, b) => Math.hypot(a.cx - site.cx, a.cz - site.cz) - Math.hypot(b.cx - site.cx, b.cz - site.cz));
  return nearby.find(valid) ?? site;
}

/** Reflect the same level, dry-ground rule used to accept a building site. */
export function placementSlope(world: World, cx: number, cz: number, w: number, d: number): string {
  let min = Infinity, max = -Infinity, wet = false;
  for (let z = cz; z < cz + d; z++) for (let x = cx; x < cx + w; x++) {
    if (!world.inBounds(x, z)) return 'Slope: outside the island';
    const i = world.idx(x, z), layer = world.layer[i];
    min = Math.min(min, layer); max = Math.max(max, layer);
    if (layer < 1 || !Number.isNaN(world.riverY[i])) wet = true;
  }
  if (wet) return 'Ground: water within footprint';
  return min === max ? 'Slope: level' : 'Slope: uneven · level the highlighted ground';
}
