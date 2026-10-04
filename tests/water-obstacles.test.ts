import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearWaterMove } from '../src/entities/WaterObstacles';
import type { World } from '../src/world/World';
const world = {
  cellOf: (x: number, z: number) => [Math.floor(x), Math.floor(z)],
  inBounds: (x: number, z: number) => x >= 0 && z >= 0 && x < 10 && z < 10,
  idx: (x: number, z: number) => z * 10 + x,
  blocked: (i: number) => i === 44,
} as World;
test('jellyfish cannot cross rock cells even in a long movement step', () => {
  assert.equal(clearWaterMove(world, 2, 4.5, 7, 4.5, 0.15), false);
  assert.equal(clearWaterMove(world, 2, 3, 7, 3, 0.15), true);
});
test('body clearance prevents clipping a rock and spawning inside one', () => {
  assert.equal(clearWaterMove(world, 3.9, 4.5, 3.9, 4.5, 0.2), false);
  assert.equal(clearWaterMove(world, 4.5, 4.5, 4.5, 4.5, 0.2), false);
  assert.equal(clearWaterMove(world, 3.5, 4.5, 3.5, 5.5, 0.2), true);
});
