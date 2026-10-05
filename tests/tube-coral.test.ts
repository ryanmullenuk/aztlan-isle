import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { WORLD } from '../src/config';
import { TubeCoral } from '../src/entities/TubeCoral';
import { SEA_SURFACE } from '../src/water/Water';

function island(): World {
  const w = new World();
  generateIsland(w, WORLD.islandSeed);
  growIslets(w);
  return w;
}

test('tube coral: clusters in the shallows and round sea rocks, always under the surface, with clear water over them', () => {
  const w = island();
  const rocks = [{ x: 0, z: 0, r: 1 }];
  // A real rock in shallow water to grow round.
  for (let i = 0; i < w.N * w.N; i++) {
    const x = w.centerX(i % w.N), z = w.centerZ((i / w.N) | 0), h = w.heightAt(x, z);
    if (w.layer[i] <= 0 && h < -0.5 && h > -0.9) { rocks[0] = { x, z, r: 0.5 }; break; }
  }
  const coral = new TubeCoral(w, rocks);
  assert.ok(coral.spots.length > 100, `${coral.spots.length} clusters`);
  assert.ok(coral.spots.some((s) => Math.hypot(s.x - rocks[0].x, s.z - rocks[0].z) < 2.5), 'none round the rock');
  for (const s of coral.spots) {
    const bed = w.heightAt(s.x, s.z);
    assert.ok(bed < -0.25, 'coral on dry ground');
    assert.ok(bed + 0.62 * s.s <= SEA_SURFACE - 0.09, 'coral breaking the surface');
    assert.ok(w.clearWater[w.cellIndexAt(s.x, s.z)] > 0.3, 'murky water over coral');
  }
  assert.equal(coral.group.children.length > 0, true);
});
