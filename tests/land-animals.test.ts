import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Animals, MODEL_SIZE } from '../src/entities/Animals';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { AMBIENT_FAUNA, SPECIES, WORLD } from '../src/config';
import { SpatialHash } from '../src/world/SpatialHash';
import { makeIslander } from '../src/entities/Islander';
import * as THREE from 'three';

function island(seed = WORLD.islandSeed) {
  const w = new World();
  generateIsland(w, seed);
  return w;
}

test('oxen and ducks are scenery: placed from the seed, never in the livestock list or saves', () => {
  const w = island(), a = new Animals(w), b = new Animals(island());
  const oxen = a.ambient.filter((x) => x.sp === 'ox'), ducks = a.ambient.filter((x) => x.sp === 'duck');
  assert.ok(oxen.length >= AMBIENT_FAUNA.ox.count[0] && oxen.length <= AMBIENT_FAUNA.ox.count[1]);
  assert.ok(ducks.length >= 2, 'ducks find a fresh-water shore');
  assert.deepEqual(a.ambient.map((x) => [x.sp, x.x, x.z]), b.ambient.map((x) => [x.sp, x.x, x.z]));
  // The livestock are exactly as before (their own random stream), and the save holds only them.
  assert.deepEqual(a.list.map((x) => [x.sp, x.x, x.z]), b.list.map((x) => [x.sp, x.x, x.z]));
  assert.ok(a.list.every((x) => x.sp in SPECIES));
  assert.equal(a.serialize().length, a.list.length);
  // Ducks keep to land beside fresh water; oxen to land near the village.
  for (const d of ducks) assert.ok(w.isLandCell(w.cellIndexAt(d.x, d.z)));
  for (const o of oxen) assert.ok(Math.hypot(o.x - w.meadow.x, o.z - w.meadow.z) < w.meadow.r + 18);
});

test('ducks scatter from people and oxen amble on land', () => {
  const w = island(), a = new Animals(w), people = new SpatialHash<ReturnType<typeof makeIslander>>(2);
  const duck = a.ambient.find((x) => x.sp === 'duck')!;
  const p = makeIslander(1, 'Test', 'f' as any, duck.x + 0.3, duck.z, () => 0.5);
  people.insert(p);
  const cam = new THREE.Vector3(duck.x, 0, duck.z);
  a.update(0.1, cam, null, people);
  assert.equal(duck.state, 'flee');
  for (let i = 0; i < 300; i++) a.update(0.1, cam, null, new SpatialHash(2));
  for (const x of a.ambient) assert.ok(w.isLandCell(w.cellIndexAt(x.x, x.z)));
});

test('rigged livestock keep the procedural sizes', () => {
  assert.ok(MODEL_SIZE.chicken! < MODEL_SIZE.goat! && MODEL_SIZE.goat! <= MODEL_SIZE.pig!);
  assert.ok(AMBIENT_FAUNA.ox.size[0] > MODEL_SIZE.pig! && AMBIENT_FAUNA.duck.size[1] < MODEL_SIZE.goat!);
});
