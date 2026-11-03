import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD } from '../src/config';
import { generateIsland } from '../src/world/generator';
import { World } from '../src/world/World';
import { habitatFit } from '../src/entities/Habitat';
import { marinePathClear } from '../src/entities/MarineClearance';
import { Sharks } from '../src/entities/Sharks';
import { ReefFish } from '../src/entities/ReefFish';

/** Water cells of the willow glade's lake (world positions). */
function lake(): { w: World; pts: { x: number; z: number }[] } {
  const w = new World(); generateIsland(w, WORLD.islandSeed, 'classic', 2);
  const g = w.glade!, pts: { x: number; z: number }[] = [];
  for (let dz = -g.r; dz <= g.r; dz++) for (let dx = -g.r; dx <= g.r; dx++) {
    const x = g.x + dx, z = g.z + dz, i = w.cellIndexAt(x, z);
    if (i >= 0 && w.layer[i] <= 0) pts.push({ x, z });
  }
  return { w, pts };
}

test('the inland lake is not sea: no reefs, sharks or reef fish there', () => {
  const { w, pts } = lake(), g = w.glade!;
  assert.ok(pts.length > 40, `lake cells ${pts.length}`);
  for (const p of pts) {
    assert.equal(w.isSeaAt(p.x, p.z), false);
    assert.equal(habitatFit(w, p.x, p.z, 0.1), 0);
  }
  assert.equal(marinePathClear(w, g.x - 1, g.z, g.x + 1, g.z, 0.3), false);
  const sharks = new Sharks(w, [{ x: g.x, z: g.z, r: 3 }], { schools: [], scatter() {} }) as any;
  assert.equal(sharks.pods.length, 0);
  for (const p of pts) assert.equal(sharks.deep(p.x, p.z, -0.2), false);
  const reef = new ReefFish(w, pts) as any;
  for (const p of pts) assert.equal(reef.roam(p.x, p.z), false);
  for (const f of reef.fish) assert.ok(w.isSeaAt(f.x, f.z), 'reef fish out at sea');
});
