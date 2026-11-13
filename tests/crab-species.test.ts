import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD } from '../src/config';
import { generateIsland } from '../src/world/generator';
import { World } from '../src/world/World';
import { crabSpecies, CrabSpecies } from '../src/entities/Critters';

test('crab species: decided by the seed and the spot alone; reef crabs only at the waterline; shore crabs the commonest', () => {
  const w = new World();
  generateIsland(w, WORLD.islandSeed, 'classic', 3);
  const mix: Record<CrabSpecies, number> = { shore: 0, hermit: 0, reef: 0 };
  for (let cz = 2; cz < w.N - 2; cz++) for (let cx = 2; cx < w.N - 2; cx++) {
    const i = w.idx(cx, cz);
    if (w.layer[i] < 1 || w.layer[i] > 2 || w.sandy[i] < 0.5 || w.distWater[i] > 3) continue;
    const sp = crabSpecies(w.seed, cx, cz, w.distWater[i]);
    assert.equal(sp, crabSpecies(w.seed, cx, cz, w.distWater[i]));
    if (sp === 'reef') assert.ok(w.distWater[i] <= 1);
    mix[sp]++;
  }
  assert.ok(mix.shore > mix.hermit && mix.shore > mix.reef, JSON.stringify(mix));
  assert.ok(mix.hermit > 0 && mix.reef > 0, JSON.stringify(mix));
});
