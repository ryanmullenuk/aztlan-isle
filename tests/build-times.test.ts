import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BUILDINGS } from '../src/config';
import { hutModel } from '../src/buildings/models';

test('the hut takes one islander a minute; bigger and later buildings take longer, split between builders', () => {
  assert.equal(BUILDINGS.hut.buildTime, 60);
  for (const key of ['home', 'temple', 'greathall', 'greattemple'] as const) assert.ok(BUILDINGS[key].buildTime > BUILDINGS.hut.buildTime, key);
  assert.ok(BUILDINGS.greattemple.buildTime > BUILDINGS.greathall.buildTime && BUILDINGS.greathall.buildTime > BUILDINGS.temple.buildTime);
  // Each builder adds a share of the work every second, so two finish a hut in half the time.
  const solo = BUILDINGS.hut.buildTime, crew = BUILDINGS.hut.builders;
  assert.ok(crew >= 2);
  let progress = 0;
  for (let t = 0; t < solo / crew; t += 0.5) progress += (0.5 / solo) * crew;
  assert.ok(Math.abs(progress - 1) < 1e-9);
});

test('the hut is wood and thatch only: no stone and no torch', () => {
  const model = hutModel();
  assert.equal(model.torches.length, 0);
  const col = model.finished.getAttribute('color') as THREE.BufferAttribute;
  const c = new THREE.Color(), hsl = { h: 0, s: 0, l: 0 };
  for (let i = 0; i < col.count; i++) {
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).getHSL(hsl);
    // Warm browns, golds and rope; never the grey of stone.
    assert.ok(hsl.s > 0.15 || hsl.l < 0.12, `vertex ${i} looks like stone`);
  }
});
