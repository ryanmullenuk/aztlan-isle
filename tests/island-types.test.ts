import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World';
import { generateIsland, ISLAND_TYPES, isIslandType, type IslandType } from '../src/world/generator';
import { WORLD } from '../src/config';

function stats(type: IslandType) {
  const w = new World();
  generateIsland(w, WORLD.islandSeed, type);
  let land = 0, wild = 0, forest = 0, rocky = 0;
  for (let i = 0; i < w.N * w.N; i++) if (w.layer[i] >= 1) { land++; forest += w.forest[i]; if (w.rocky[i] > 0.5) rocky++; if (w.isle[i] === 2) wild++; }
  return { w, land, wild, forest: forest / land, rocky: rocky / land };
}

test('every island type has the village plain on dry land, a wild island, and its own character', () => {
  const s = Object.fromEntries((Object.keys(ISLAND_TYPES) as IslandType[]).map((t) => [t, stats(t)])) as Record<IslandType, ReturnType<typeof stats>>;
  for (const [t, x] of Object.entries(s)) {
    const m = x.w.meadow;
    assert.equal(x.w.layer[x.w.cellIndexAt(m.x, m.z)], 3, `${t}: the village plain`);
    assert.ok(x.wild > 1000, `${t}: a wild island across the strait`);
    assert.equal(x.w.islandType, t);
  }
  assert.ok(s.volcanic.rocky > s.classic.rocky * 1.8 && s.volcanic.forest < s.classic.forest * 0.7, 'volcanic: rocky, thin woods');
  assert.ok(s.jungle.forest > s.classic.forest * 1.2, 'jungle: thick forest');
  assert.ok(s.twin.wild > s.classic.wild * 1.4, 'twin: a big second island');
  assert.ok(s.archipelago.land < s.classic.land * 0.75 && s.archipelago.w.islets.length > s.classic.w.islets.length, 'archipelago: small home island, more islets');
});

test('the original island is unchanged by island types (its saves still line up)', () => {
  const a = new World(), b = new World();
  generateIsland(a, WORLD.islandSeed);
  generateIsland(b, WORLD.islandSeed, 'classic');
  assert.deepEqual(a.layer, b.layer);
  assert.deepEqual(a.forest, b.forest);
  assert.ok(isIslandType('twin') && !isIslandType('moon'));
});
