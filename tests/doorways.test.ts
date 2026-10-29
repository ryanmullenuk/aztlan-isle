import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pathfinder } from '../src/ai/Pathfinder';
import { World } from '../src/world/World';

/** A 3x3 building (id 4) whose door faces +z, in the middle of open flat ground. */
function setup(rot = 0) {
  const w = new World(); w.layer.fill(1); w.computeSmooth();
  const [cx, cz] = w.cellOf(0, 0);
  for (let z = cz; z < cz + 3; z++) for (let x = cx; x < cx + 3; x++) w.occ[w.idx(x, z)] = 5;
  w.doorways.set(4, { cx, cz, w: 3, d: 3, rot });
  return { w, pf: new Pathfinder(w), cx, cz };
}

const inside = (w: World, p: { x: number; z: number }) => w.occ[w.cellIndexAt(p.x, p.z)] === 5;

test('someone going into a building walks round to its door instead of through the back wall', () => {
  const { w, pf, cx, cz } = setup();
  // Start behind the building (-z side), heading for its middle.
  const path = pf.find(w.centerX(cx + 1), w.centerZ(cz - 3), w.centerX(cx + 1), w.centerZ(cz + 1), { allowBuilding: 4 })!;
  assert.ok(path, 'a way in exists');
  // Densely sample the route: the first point inside must be entered from the front row.
  let prev = path[0], entered: { x: number; z: number } | null = null;
  for (let k = 1; k < path.length && !entered; k++) for (let s = 1; s <= 40; s++) {
    const p = { x: prev.x + (path[k].x - prev.x) * s / 40, z: prev.z + (path[k].z - prev.z) * s / 40 };
    if (inside(w, p)) { entered = p; break; }
    if (s === 40) prev = path[k];
  }
  assert.ok(entered && w.cellOf(entered.x, entered.z)[1] === cz + 2, `entered at ${JSON.stringify(entered)}, not the door row`);
});

test('a straight segment through a side wall is not clear, one through the doorway is', () => {
  const { w, pf, cx, cz } = setup();
  assert.equal(pf.segmentClear(w.centerX(cx - 2), w.centerZ(cz + 1), w.centerX(cx + 1), w.centerZ(cz + 1), { allowBuilding: 4 }), false);
  assert.equal(pf.segmentClear(w.centerX(cx + 1), w.centerZ(cz + 5), w.centerX(cx + 1), w.centerZ(cz + 1), { allowBuilding: 4 }), true);
});

test('turned buildings have their doorway on the turned side', () => {
  const { w, pf, cx, cz } = setup(1); // door faces +x
  assert.equal(pf.segmentClear(w.centerX(cx + 5), w.centerZ(cz + 1), w.centerX(cx + 1), w.centerZ(cz + 1), { allowBuilding: 4 }), true);
  assert.equal(pf.segmentClear(w.centerX(cx + 1), w.centerZ(cz + 5), w.centerX(cx + 1), w.centerZ(cz + 1), { allowBuilding: 4 }), false);
});
