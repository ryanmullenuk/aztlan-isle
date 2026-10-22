import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World';
import { Marine } from '../src/entities/Marine';
import { sampleRise, RISE_T } from '../src/entities/WhaleMotion';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { WORLD } from '../src/config';

const ctx = new Proxy({}, { get: (_, k) => k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} });
(globalThis as any).document = { createElement: () => ({ getContext: () => ctx }) };

test('the rise keeps a steady pitch rate as the whale tips back under (no switch at level)', () => {
  const dt = 1 / 60;
  let worst = 0;
  for (let t = dt; t < RISE_T.end - dt; t += dt) {
    const a = sampleRise(t - dt).pitch, b = sampleRise(t).pitch, c = sampleRise(t + dt).pitch;
    worst = Math.max(worst, Math.abs(c - 2 * b + a) / (dt * dt));
  }
  // Was ~160 deg/s² from a one-frame change of pitch rate at level.
  assert.ok(worst < 40, `pitch acceleration ${worst.toFixed(1)} deg/s²`);
});

test('surfacing to breathe and diving back under never jolts the body', () => {
  const w = new World(); generateIsland(w, WORLD.islandSeed); growIslets(w);
  const m = new Marine(w, { shared: { uDay: { value: 1 } }, disturb() {} } as any) as any;
  m.sfx = () => {};
  const dt = 1 / 60, cam = new THREE.Vector3(9999, 0, 9999);
  let worst = 0;
  for (let run = 0; run < 4; run++) {
    for (let i = 0; i < 60 * 20; i++) m.update(dt, cam);
    for (const wh of m.whales) if (wh.state === 'swim') m.surface(wh);
    const ys: number[][] = m.whales.map(() => []);
    for (let i = 0; i < 60 * 14; i++) {
      m.update(dt, cam);
      m.whales.forEach((wh: any, k: number) => ys[k].push(wh.root.position.y));
    }
    for (const y of ys) for (let i = 2; i < y.length; i++) worst = Math.max(worst, Math.abs(y[i] - 2 * y[i - 1] + y[i - 2]) / (dt * dt));
  }
  // Was 150-360 units/s² (the seabed guard heaving the body, the cruising clamp snapping it down).
  assert.ok(worst < 30, `vertical acceleration ${worst.toFixed(1)}`);
});
