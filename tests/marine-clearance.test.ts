import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World';
import { marinePathClear } from '../src/entities/MarineClearance';
import { Marine } from '../src/entities/Marine';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { WORLD } from '../src/config';
import { placeSeaStacks, stackCells } from '../src/water/SeaStacks';

const ctx = new Proxy({}, { get: (_, k) => k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} });
(globalThis as any).document = { createElement: () => ({ getContext: () => ctx }) };

test('dolphin sweep rejects rocks between endpoints and beside the body', () => {
  const w = new World(); w.layer.fill(-8); w.smooth.fill(-8);
  w.blockFixed[w.cellIndexAt(0, 0)] = 1;
  assert.equal(marinePathClear(w, -5, 0, 5, 0), false);
  assert.equal(marinePathClear(w, -5, 1, 5, 1), false);
  assert.equal(marinePathClear(w, -5, 4, 5, 4), true);
});

test('marine population has opposite adults and a calf; dolphin routes clear coastal rocks and splash twice per leap', () => {
  const w = new World(); generateIsland(w, WORLD.islandSeed); growIslets(w);
  for (const i of stackCells(w, placeSeaStacks(w, w.seed))) w.blockFixed[i] = 1;
  const disturbances: number[] = [];
  const m = new Marine(w, { shared: { uDay: { value: 1 } }, disturb(_x: number, _z: number, strength: number) { disturbances.push(strength); } } as any) as any;
  assert.equal(m.whales.length, 3);
  const [first, mother, calf] = m.whales;
  assert.ok(first.x * mother.x + first.z * mother.z < 0);
  assert.equal(calf.mother, mother);
  assert.ok(first.length >= 7.8 * 0.9 && first.length <= 7.8 * 1.1);
  assert.ok(mother.length >= 7.8 * 0.9 && mother.length <= 7.8 * 1.1);
  assert.ok(Math.abs(calf.length - 7.8 * 0.48) < 1e-8);
  assert.ok(calf.length < mother.length * 0.6);
  assert.ok(m.dolphins.length > 0);
  let splashes = 0;
  m.dolphinSplash = () => { splashes++; };
  for (let t = 0; t < 600; t++) {
    m.updateDolphins(1 / 30);
    for (const d of m.dolphins) assert.ok(marinePathClear(w, d.x, d.z, d.x, d.z), 'dolphin intersects a rock');
  }
  assert.ok(splashes >= m.dolphins.length * 4);
  assert.ok(disturbances.includes(0.38), 'take-off displaces the water');
  assert.ok(disturbances.includes(0.65), 'landing displaces the water');
  assert.ok(m.rings.some((r: any) => r.life >= 3), 'landing ripples linger');
  m.dolphinChurn(0, 0, 1, 0, true);
  m.churn.update(1);
  const foam = m.churn.points.geometry;
  const position = foam.getAttribute('position'), alpha = foam.getAttribute('aAlpha');
  assert.ok(Array.from(alpha.array as Float32Array).some((a, i) => a > 0.05 && position.getY(i) > 0), 'foam remains on the surface after one second');
  let furthest = 0;
  for (let t = 0; t < 1200; t++) {
    m.update(0.1, new THREE.Vector3());
    furthest = Math.max(furthest, Math.hypot(calf.x - mother.x, calf.z - mother.z));
    for (const whale of m.whales) assert.ok(Number.isFinite(whale.x + whale.z + whale.pose.y));
  }
  assert.ok(furthest < 25, `calf left its mother: ${furthest}`);
});
