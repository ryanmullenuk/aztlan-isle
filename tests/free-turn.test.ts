import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Building, turnsFreely } from '../src/buildings/Buildings';

const stub = { half: 100, layerY: () => 0 } as any;

test('round pieces turn freely; their footprint keeps to the quarter turn', () => {
  for (const k of ['well', 'bonfire', 'firepit', 'torch', 'olmechead'] as const) assert.ok(turnsFreely(k), k);
  for (const k of ['hut', 'home', 'smokehouse', 'palace', 'jetty'] as const) assert.ok(!turnsFreely(k), k);
  const b = new Building(1, 'bonfire', 10, 10, 1, 1, stub);
  b.yaw = 0.4;
  assert.ok(Math.abs(b.angle - (Math.PI / 2 + 0.4)) < 1e-9);
  // Model-local points follow the free turn, so ground dressing sits under the turned model.
  const [x, z] = b.local(1, 0), [lx, lz] = b.toLocal(x, z);
  assert.ok(Math.abs(lx - 1) < 1e-9 && Math.abs(lz) < 1e-9);
  assert.equal(b.w, 3);
  assert.equal(b.d, 3);
});
