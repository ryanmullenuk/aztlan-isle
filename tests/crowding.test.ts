import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { WORLD } from '../src/config';
import { Crowding } from '../src/entities/Crowding';

test('crowding: no body walks into a rock or a building, overlapping bodies ease apart, and penned animals are left alone', () => {
  const w = new World();
  generateIsland(w, WORLD.islandSeed);
  const m = w.meadow, [cx, cz] = w.cellOf(m.x, m.z);
  // A "building" two cells east of the meadow's middle, and a rock two cells west.
  const bi = w.idx(cx + 2, cz), ri = w.idx(cx - 2, cz);
  w.occ[bi] = 8;
  w.blockFixed[ri] = 1;
  const a = { x: m.x, z: m.z, heading: 0 }, b = { x: m.x + 0.05, z: m.z, heading: 0 };
  const pig = { x: w.centerX(cx + 2), z: w.centerZ(cz) };
  const crowd = new Crowding(w);
  crowd.add({ list: () => [a, b, pig], radius: () => 0.2 });
  crowd.update();
  for (let k = 0; k < 40; k++) crowd.update();
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 0.39, 'overlapping bodies were not eased apart');
  // Walk one into the building and the other into the rock: both are stopped at the edge.
  for (let k = 0; k < 200; k++) {
    a.x += 0.03; b.x -= 0.03;
    crowd.update();
    assert.ok(!crowd.solid(a.x, a.z, 0.2, false) && !crowd.solid(b.x, b.z, 0.2, false), 'a body stood in something solid');
  }
  assert.ok(a.x < w.centerX(cx + 2) - 0.5 && b.x > w.centerX(cx - 2) + 0.5);
  // The pig that began inside the building (a pen) is free to move about in it.
  pig.x += 0.1;
  crowd.update();
  assert.ok(Math.abs(pig.x - (w.centerX(cx + 2) + 0.1)) < 1e-6);
});
