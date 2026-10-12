import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Animals } from '../src/entities/Animals';
import { penLayout } from '../src/buildings/models';
import { World } from '../src/world/World';
import { WORLD } from '../src/config';
import { SpatialHash } from '../src/world/SpatialHash';
import { makeIslander } from '../src/entities/Islander';

/** A pig pen at (0, 0), unrotated: model-local coordinates are world coordinates. */
function penFixture() {
  const world = new World(); world.seed = WORLD.islandSeed; world.layer.fill(1); world.computeSmooth();
  const animals = new Animals(world);
  const pen = { id: 70, key: 'pigpen', x: 0, z: 0, rot: 0, penX: 0.1, penZ: 0.25,
    local: (x: number, z: number) => [x, z], toLocal: (x: number, z: number) => [x, z] } as any;
  animals.registerPen(pen);
  const stock = animals.list.filter(a => a.sp === 'pig' || a.sp === 'goat').slice(0, 7);
  for (const a of stock) { a.heldBy = null; a.chasedBy = null; animals.putInPen(a.id, pen); }
  return { animals, stock, people: new SpatialHash<ReturnType<typeof makeIslander>>(2) };
}

test('penned pigs and goats keep to the open yard, never inside the sty, troughs or each other', () => {
  const { animals, stock, people } = penFixture();
  const layout = penLayout('pigpen')!;
  for (let n = 0; n < 900; n++) {
    animals.update(1 / 30, new THREE.Vector3(), null, people);
    if (n % 30) continue;
    for (const a of stock) {
      assert.ok(Math.abs(a.x) < layout.half && Math.abs(a.z) < layout.half, 'inside the yard');
      for (const [x0, z0, x1, z1] of layout.blocks) assert.ok(!(a.x > x0 && a.x < x1 && a.z > z0 && a.z < z1), 'not standing in the sty or a trough');
    }
    for (let i = 0; i < stock.length; i++) for (let j = i + 1; j < stock.length; j++) {
      const a = stock[i], b = stock[j];
      const min = (a.sp === 'pig' ? 0.2 : 0.16) * a.scale + (b.sp === 'pig' ? 0.2 : 0.16) * b.scale;
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > min * 0.8, 'animals do not stand inside one another');
    }
  }
  // They do move about rather than standing frozen.
  assert.ok(stock.some(a => Math.hypot(a.x - 0.1, a.z - 0.25) > 0.6));
});
