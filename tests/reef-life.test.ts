import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { WORLD } from '../src/config';
import { Coral } from '../src/entities/Coral';
import { SEA_SURFACE } from '../src/water/Water';

test('reef life: bubbles rise from vents on the sea floor inside the reefs, and the water over each reef is clear', () => {
  const w = new World();
  generateIsland(w, WORLD.islandSeed);
  growIslets(w);
  const coral = new Coral(w);
  const vents = coral.bubbles.vents;
  assert.ok(vents.length >= coral.patches.length, `${vents.length} vents for ${coral.patches.length} reefs`);
  for (const v of vents) {
    assert.ok(v.y < SEA_SURFACE - 0.2, `vent at ${v.y} is not under the surface`);
    assert.ok(w.isSea(w.cellIndexAt(v.x, v.z)), 'vent on land');
    assert.ok(coral.patches.some((p) => Math.hypot(p.x - v.x, p.z - v.z) <= p.r + 0.01), 'vent outside every reef');
  }
  for (const p of coral.patches) assert.ok(w.sampleField(w.clearWater, p.x, p.z) > 0.8, 'murky water over a reef');
  // The same island always grows the same reefs and vents.
  const again = new Coral(w);
  assert.deepEqual(again.bubbles.vents, vents);
});

test('clownfish: two to each big anemone, weaving among its tentacles and never leaving it', () => {
  const w = new World();
  generateIsland(w, WORLD.islandSeed);
  growIslets(w);
  const coral = new Coral(w), cf = coral.clownfish;
  assert.ok(cf.hosts.length >= 10, `${cf.hosts.length} host anemones`);
  assert.equal(cf.mesh.instanceMatrix.count, cf.hosts.length * 2, 'two fish to a host');
  let seen = 0;
  cf.hosts.forEach((h, i) => {
    if (cf.fits[i] <= 0) return;
    seen++;
    assert.ok(w.isSea(w.cellIndexAt(h.x, h.z)), 'anemone on land');
    const bed = w.heightAt(h.x, h.z), reach = 0.2 * h.s * cf.fits[i];
    for (let j = 0; j < 2; j++) for (let t = 0; t < 120; t += 1.7) {
      const p = cf.place(i, j, t);
      assert.ok(Math.hypot(p.x - h.x, p.z - h.z) <= reach * 0.7 + 1e-6, 'fish left its anemone');
      assert.ok(p.y > bed && p.y < SEA_SURFACE - 0.05, `fish at ${p.y} (bed ${bed})`);
    }
    // The pair is never in the same place.
    assert.ok(cf.place(i, 0, 3).distanceTo(cf.place(i, 1, 3)) > 1e-3);
  });
  assert.ok(seen >= coral.patches.length * 0.6, `${seen} anemones with room for their fish, of ${coral.patches.length} reefs`);
});
