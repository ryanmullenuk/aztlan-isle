import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { WORLD } from '../src/config';
import { PlantState, TREE_FALL, Vegetation, fallAngle } from '../src/vegetation/Vegetation';

// Vegetation draws one small canvas texture (contact shadows): a stand-in canvas for node.
const ctx2d = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: '' };
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

function forest(): Vegetation {
  const w = new World();
  generateIsland(w, WORLD.islandSeed);
  growIslets(w);
  const veg = new Vegetation(w, 'low');
  veg.build();
  return veg;
}

/** The world-space direction a felled tree's trunk points (its local up, as drawn). */
function trunkUp(veg: Vegetation, p: ReturnType<Vegetation['plants']['at']> & object): THREE.Vector3 {
  const m = (veg as any).plantMatrix(p, 'trunk', new THREE.Matrix4()) as THREE.Matrix4;
  return new THREE.Vector3(0, 1, 0).transformDirection(m);
}

test('a felled tree topples away from the axe, speeding up, and lands nearly flat with a bounce', () => {
  assert.equal(fallAngle(0), 0);
  // Slow to start, fast at the end: more of the fall happens in its second half.
  assert.ok(fallAngle(TREE_FALL.dur / 2) < TREE_FALL.angle / 3);
  assert.ok(Math.abs(fallAngle(TREE_FALL.dur) - TREE_FALL.angle) < 1e-9);
  assert.ok(fallAngle(TREE_FALL.dur + 0.15) < TREE_FALL.angle, 'bounces up off the ground');
  assert.ok(Math.abs(fallAngle(TREE_FALL.dur + 3) - TREE_FALL.angle) < 0.01, 'settles');
  assert.ok(TREE_FALL.angle > 1.3 && TREE_FALL.angle < Math.PI / 2);

  const veg = forest();
  const p = veg.plants.find(q => q.kind === 'broadleaf' && q.state === PlantState.Alive)!;
  const wood = veg.fell(p, p.x - 1, p.z);
  assert.ok(wood >= 1);
  assert.equal(p.state, PlantState.Stump);
  assert.equal(p.amount, wood);
  assert.equal(veg.isLog(p), false, 'not workable mid-fall');
  veg.updatePops(TREE_FALL.dur + 0.5);
  const up = trunkUp(veg, p);
  assert.ok(up.x > 0.9 && up.y < 0.2, `lies along +x, away from the woodcutter (${up.toArray().map(v => v.toFixed(2))})`);
  assert.equal(veg.isLog(p), true);
  assert.equal(veg.takeLanded().length, 1, 'one landing puff');
});

test('woodcutters carry a fallen tree away load by load; then it sinks into the ground and the stump regrows', () => {
  const veg = forest();
  const p = veg.plants.find(q => q.kind === 'broadleaf' && q.state === PlantState.Alive && q.scale > 1)!;
  const wood = veg.fell(p, p.x, p.z + 1);
  veg.updatePops(TREE_FALL.dur + 1);
  const spot = veg.logSpot(p);
  assert.ok(Math.hypot(spot.x - p.x, spot.z - p.z) > 0.5, 'work beside the trunk, out from the stump');
  // While the trunk lies there the stump doesn't sprout.
  veg.update(1000, new THREE.Vector3(), new THREE.Vector3(), 100, 1);
  assert.equal(p.state, PlantState.Stump);
  let carried = 0, trips = 0;
  while (veg.hasLog(p)) { carried += veg.takeWood(p, 4); trips++; }
  assert.equal(carried, wood);
  assert.ok(trips >= 2, `a big tree takes more than one trip (${trips})`);
  assert.ok(veg.felledInfo(p)!.sink >= 0, 'sinking once the last load is gone');
  veg.updatePops(TREE_FALL.sink / 2);
  const half = (veg as any).plantMatrix(p, 'trunk', new THREE.Matrix4()) as THREE.Matrix4;
  assert.ok(new THREE.Vector3().setFromMatrixPosition(half).y < p.y, 'lowered into the ground');
  veg.updatePops(TREE_FALL.sink);
  assert.equal(veg.felledInfo(p), undefined, 'gone');
  assert.equal((veg as any).plantMatrix(p, 'trunk', new THREE.Matrix4()).elements[0], 0, 'no longer drawn');
  for (let k = 0; k < 20; k++) veg.update(30, new THREE.Vector3(), new THREE.Vector3(), 100, 1);
  assert.notEqual(p.state, PlantState.Stump, 'a sapling comes up in time');
});

test('fallen trees still holding wood are saved and lie where they were after loading', () => {
  const veg = forest();
  const p = veg.plants.find(q => q.kind === 'palm' && q.state === PlantState.Alive)!;
  veg.fell(p, p.x + 1, p.z);
  veg.updatePops(TREE_FALL.dur + 1);
  const data = veg.serializeLogs();
  assert.deepEqual(data.slice(0, 1), [p.id]);
  const again = forest();
  const q = again.plants[p.id];
  q.state = PlantState.Stump; q.amount = p.amount;
  again.restoreLogs(data);
  assert.equal(again.hasLog(q), true);
  assert.ok(trunkUp(again, q).x < -0.9, 'still pointing the way it fell');
});
