import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { WORLD } from '../src/config';
import { View } from '../src/render/View';
import { Bumblebees } from '../src/entities/Bumblebees';

function island(): World {
  const w = new World();
  generateIsland(w, WORLD.islandSeed);
  return w;
}

/** Some flowers in a patch on land (every few cells round the first land cell found near the middle). */
function flowers(w: World): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const N = w.N;
  for (let cz = N / 2 - 12; cz < N / 2 + 12; cz += 3) for (let cx = N / 2 - 12; cx < N / 2 + 12; cx += 3) {
    const i = w.idx(cx, cz);
    if (w.isLandCell(i)) out.push({ x: w.centerX(cx), z: w.centerZ(cz) });
  }
  return out;
}

test('bumblebees: deterministic, stay among the flowers by day, gone at night and in the rain', () => {
  const w = island();
  const fl = flowers(w);
  assert.ok(fl.length > 10, `${fl.length} flowers`);
  View.cam.set(fl[0].x, 5, fl[0].z);
  const a = new Bumblebees(w, fl), b = new Bumblebees(w, fl);
  assert.ok(a.count >= 4 && a.count <= 16, `${a.count} bees`);
  assert.equal(a.count, b.count);
  for (let k = 0; k < 600; k++) a.update(1 / 30, 1 / 30, 1, false, null);
  const [A, B] = a.group.children as THREE.InstancedMesh[];
  assert.ok(A.count + B.count > 0, 'no bees drawn by day');
  // Every drawn bee is near a flower and a little above the ground.
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  for (let i = 0; i < A.count; i++) {
    A.getMatrixAt(i, m);
    p.setFromMatrixPosition(m);
    const d = Math.min(...fl.map((f) => Math.hypot(f.x - p.x, f.z - p.z)));
    assert.ok(d < 2.5, `bee ${d.toFixed(2)} from the nearest flower`);
    assert.ok(p.y > w.heightAt(p.x, p.z), 'bee underground');
  }
  for (let k = 0; k < 600; k++) a.update(1 / 30, 1 / 30, 0, false, null);
  assert.equal(A.count + B.count, 0, 'bees out at night');
  const c = new Bumblebees(w, fl);
  for (let k = 0; k < 600; k++) c.update(1 / 30, 1 / 30, 1, true, null);
  assert.equal(c.group.visible, false, 'bees out in the rain');
  assert.equal(new Bumblebees(w, []).count, 0);
});
