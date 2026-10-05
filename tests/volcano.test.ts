import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Volcano, VolcanoCycle, volcanoRockGeometry, volcanoSurface } from '../src/entities/Volcano';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { WORLD } from '../src/config';

test('smoke precedes eruption and cooling leads to a dormant interval', () => {
  const v = new VolcanoCycle(42);
  v.update(150); assert.equal(v.phase, 'smoking');
  v.update(299); assert.equal(v.phase, 'smoking');
  v.update(1); assert.equal(v.phase, 'erupting');
  v.update(65); assert.equal(v.phase, 'cooling');
  v.update(25); assert.equal(v.phase, 'dormant');
  assert.ok(v.remaining >= 240 && v.remaining <= 480);
});
test('Calm charges only active volcanoes and cannot reward repeated clicks', () => {
  const v = new VolcanoCycle(42); let spent = 0;
  assert.equal(v.calm(c => { spent += c; return true; }), false);
  v.update(150);
  assert.equal(v.calm(() => false), false); assert.equal(v.phase, 'smoking');
  assert.equal(v.calm(c => { spent += c; return true; }), true);
  assert.equal(spent, 50); assert.equal(v.phase, 'cooling');
  assert.equal(v.calm(c => { spent += c; return true; }), false);
  assert.equal(spent, 50);
});
test('saved eruption resumes, pause does not advance it', () => {
  const v = new VolcanoCycle(42, { x: 0, z: 0, phase: 'erupting', remaining: 22, cycle: 3 });
  v.update(0); assert.equal(v.remaining, 22);
  v.update(22); assert.equal(v.phase, 'cooling');
});
test('volcano is placed on the second island and reserves its footprint', () => {
  const w = new World(); generateIsland(w, WORLD.islandSeed); growIslets(w);
  const v = new Volcano(w);
  assert.equal(v.group.visible, true);
  const i = w.cellIndexAt(v.x, v.z);
  assert.equal(w.isle[i], 2); assert.equal(w.blockFixed[i], 1);
  const saved = v.save()!;
  const again = new Volcano(w, saved);
  assert.equal(again.x, v.x); assert.equal(again.z, v.z);
});

test('crater geometry has finite positions and normals', () => {
  const geometry = volcanoRockGeometry();
  for (const name of ['position', 'normal']) {
    assert.ok(Array.from(geometry.getAttribute(name).array).every(Number.isFinite));
  }
  geometry.dispose();
});
test('cooling retains the mountain and basalt channels but removes lava and smoke', () => {
  const w = new World(); generateIsland(w, WORLD.islandSeed); growIslets(w);
  const v = new Volcano(w);
  const staticCount = v.group.children.length;
  v.update(455);
  assert.equal(v.state.phase, 'erupting');
  assert.equal(v.group.getObjectByName('Active lava')!.visible, true);
  assert.equal(v.state.calm(() => true), true);
  v.update(25);
  assert.equal(v.state.phase, 'dormant');
  assert.equal(v.group.children.length, staticCount);
  assert.equal(v.group.getObjectByName('Active lava')!.visible, false);
  const beds = v.group.children.filter(o => o.name === 'Cooled lava channel');
  assert.equal(beds.length, 3);
  assert.ok(beds.every(o => o.visible));
  assert.ok(v.group.children.filter(o => o.name === 'Volcanic smoke').every(o => !o.visible));
});

test('smoke countdown persists and old saves receive the longer warning', () => {
  const old = new VolcanoCycle(42, { x: 0, z: 0, phase: 'smoking', remaining: 15, cycle: 0 });
  assert.equal(old.remaining, 280);
  const current = new VolcanoCycle(42, { x: 0, z: 0, phase: 'smoking', remaining: 120, cycle: 0, warningVersion: 2 });
  current.update(0); assert.equal(current.remaining, 120);
  current.update(119); assert.equal(current.phase, 'smoking');
  current.update(1); assert.equal(current.phase, 'erupting');
});

test('joined side peak rises above its saddle and breaks radial symmetry', () => {
  const peak = volcanoSurface(0.73, 2.3);
  const saddle = volcanoSurface(0.46, 2.3);
  const opposite = volcanoSurface(0.73, 2.3 + Math.PI);
  assert.ok(peak.y > saddle.y + 1);
  assert.ok(peak.y > opposite.y + 4);
  assert.ok(volcanoSurface(0, 2.3).y > peak.y);
});

test('an eruption brims the lake, spills rounded lobes and fountains, under a dense plume drawn after the sea', () => {
  const w = new World(); generateIsland(w, WORLD.islandSeed); growIslets(w);
  const v = new Volcano(w);
  v.update(150 + 300 + 0.1);
  assert.equal(v.state.phase, 'erupting');
  const smoke = v.group.children.filter(o => o.name === 'Volcanic smoke') as import('three').Sprite[];
  v.update(12);
  const lava = v.group.getObjectByName('Active lava')!;
  // The lake has risen towards the breached lip.
  const lake = lava.children.find(o => o.type === 'Mesh' && (o as import('three').Mesh).geometry.type === 'CircleGeometry')!;
  assert.ok(lake.position.y > 9.3, `lake at ${lake.position.y}`);
  // Rounded lobes and fountain bombs are live, with positive, finite sizes.
  for (const name of ['Downhill molten lobes', 'Lava fountain']) {
    const mesh = lava.getObjectByName(name) as import('three').InstancedMesh;
    const m = mesh.instanceMatrix.array;
    assert.ok(Array.from(m).every(Number.isFinite), name);
    let live = 0;
    for (let i = 0; i < mesh.count; i++) if (Math.abs(m[i * 16]) > 0.01) live++;
    assert.ok(live > 3, `${name}: ${live} live`);
  }
  // The plume is denser while erupting, and drawn after the sea so the horizon cannot cut it.
  assert.ok(smoke.filter(o => o.visible).length > 30);
  assert.ok(smoke.every(o => o.renderOrder > 10));
});

test('uncalmed eruptions charge once, including a large time step; calming avoids the charge', () => {
  const v = new VolcanoCycle(42);
  let belief = 100, penalties = 0;
  v.onErupt = () => { belief = Math.max(0, belief - 75); penalties++; };
  v.update(451);
  assert.equal(belief, 25); assert.equal(penalties, 1);
  v.update(50);
  assert.equal(penalties, 1);
  const calmed = new VolcanoCycle(42);
  calmed.onErupt = v.onErupt;
  calmed.update(150);
  calmed.calm(() => true);
  calmed.update(30);
  assert.equal(penalties, 1);
  const skipped = new VolcanoCycle(42);
  skipped.onErupt = v.onErupt;
  skipped.update(530);
  assert.equal(penalties, 2); assert.equal(belief, 0);
});
