import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD } from '../src/config';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { generateIsland } from '../src/world/generator';
import { generateSwamps } from '../src/world/swamp';
import { World } from '../src/world/World';
import { riverSurface } from '../src/water/Water';

const island = (gen: number) => { const w = new World(); generateIsland(w, WORLD.islandSeed, 'classic', gen); return w; };
const mainLand = (w: World) => { let n = 0; for (let i = 0; i < w.layer.length; i++) if (w.layer[i] >= 1 && w.isle[i] === 1) n++; return n; };

test('new islands (layout 2) have a larger main island; the original layout is unchanged for its saves', () => {
  const a = island(1), b = island(2);
  assert.equal(a.gen, 1);
  assert.equal(a.glade, null);
  assert.ok(mainLand(b) > mainLand(a) * 1.2, `main island ${mainLand(a)} → ${mainLand(b)} cells`);
  // Layout 1 is the same island it always was.
  const again = island(1);
  assert.deepEqual(Array.from(again.layer), Array.from(a.layer));
});

for (const gen of [2, 3]) test(`the willow glade (layout ${gen}): an open meadow round a freshwater lake deep enough to fish from`, () => {
  const w = island(gen), g = w.glade;
  assert.ok(g, 'a glade');
  let water = 0, open = 0;
  for (let dz = -16; dz <= 16; dz++) for (let dx = -16; dx <= 16; dx++) {
    const i = w.cellIndexAt(g!.x + dx, g!.z + dz);
    if (i < 0) continue;
    const d = Math.hypot(dx, dz);
    if (d <= g!.r && w.layer[i] < 0) water++;
    if (d > g!.r + 3 && d < 13 && w.layer[i] >= 1 && w.forest[i] === 0) open++;
  }
  assert.ok(water > 80, `lake cells ${water}`);
  assert.ok(open > 150, `open glade cells ${open}`);
  assert.ok(Math.hypot(g!.x - w.meadow.x, g!.z - w.meadow.z) > w.meadow.r + 10, 'clear of the village plain');
  // Fishing spots as the islanders find them: shore cells beside water deeper than -0.25.
  let spots = 0;
  const N = w.N;
  for (let cz = 2; cz < N - 2; cz++) for (let cx = 2; cx < N - 2; cx++) {
    const i = cz * N + cx;
    if (Math.hypot(w.centerX(cx) - g!.x, w.centerZ(cz) - g!.z) > g!.r + 6) continue;
    if (!w.isLandCell(i) || w.distWater[i] !== 1 || w.layer[i] > 2) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = i + dx + dz * N;
      if (w.layer[j] > 0 || w.heightAt(w.centerX(cx + dx), w.centerZ(cz + dz)) > -0.25) continue;
      spots++;
      break;
    }
  }
  assert.ok(spots > 20, `fishing spots round the lake: ${spots}`);
});

for (const [gen, sx] of [[2, 0.215], [3, 0.42]]) test(`the strait between the islands stays open on layout ${gen}`, () => {
  const w = island(gen), N = w.N;
  // Somewhere along the strait's line every row crossing it has water.
  const cx = Math.round(((sx + 1) / 2) * N);
  let rows = 0, wet = 0;
  for (let cz = Math.round(N * 0.35); cz < Math.round(N * 0.65); cz++) {
    rows++;
    for (let dx = -4; dx <= 4; dx++) if (w.layer[cz * N + cx + dx] < 1) { wet++; break; }
  }
  assert.ok(wet / rows > 0.9, `${wet}/${rows} rows open`);
});

// Fingerprints of layouts 1 and 2 as they were made before layout 3: islands saved on them must
// regenerate cell for cell (their saves store changes by cell and plant index).
const fingerprint = (gen: number, seed: number) => {
  const w = new World();
  generateIsland(w, seed, 'classic', gen);
  generateSwamps(w, seed);
  const h = createHash('sha1');
  for (const a of [w.layer, w.forest, w.sandy, w.rocky, w.riverY, w.swampCarve, w.isle]) h.update(Buffer.from(a.buffer));
  h.update(JSON.stringify(w.rivers));
  return h.digest('hex').slice(0, 16);
};

test('layouts 1 and 2 generate exactly as they always have', () => {
  assert.equal(fingerprint(1, 0), 'b494dbe6c4c33b5e');
  assert.equal(fingerprint(1, 777), 'ae2a0b674f782825');
  assert.equal(fingerprint(2, 0), 'f222fd5824e15439');
  assert.equal(fingerprint(2, 777), 'acceef8e0c22214f');
});

test('layout 3: half as much main island again, the glade further out, rivers running to the sea', () => {
  for (const seed of [0, 777, 4242]) {
    const two = new World(), three = new World();
    generateIsland(two, seed, 'classic', 2);
    generateIsland(three, seed, 'classic', 3);
    assert.ok(mainLand(three) >= mainLand(two) * 1.5, `seed ${seed}: ${mainLand(two)} → ${mainLand(three)} cells`);
    const g = three.glade!, m = three.meadow;
    assert.ok(Math.hypot(g.x - m.x, g.z - m.z) > m.r + 20, 'the glade well away from the village plain');
    for (const r of three.rivers) {
      const e = r.points[r.points.length - 1];
      assert.ok(three.isSeaAt(e.x, e.z), `seed ${seed}: a river ends at the sea`);
    }
    // No stranded pockets of sea inland: the only water away from the sea is the glade's lake.
    for (let i = 0; i < three.N * three.N; i++) {
      if (three.layer[i] > 0 || three.isSea(i)) continue;
      const x = three.centerX(i % three.N), z = three.centerZ((i / three.N) | 0);
      assert.ok(Math.hypot(x - g.x, z - g.z) < g.r * 2.2, `seed ${seed}: inland water at ${x}, ${z}`);
    }
  }
});

test('layout 3 has a marsh behind the west coast beach, the sand left between it and the sea', () => {
  const w = new World();
  generateIsland(w, 777, 'classic', 3);
  generateSwamps(w, 777);
  const m = w.marsh!;
  assert.ok(m && m.x < -50, 'on the west coast');
  assert.deepEqual(w.swamps[0], m, 'the first swamp');
  let wet = 0;
  for (let i = 0; i < w.N * w.N; i++) {
    if (w.swamp[i] <= 0) continue;
    const x = w.centerX(i % w.N), z = w.centerZ((i / w.N) | 0);
    if (Math.hypot(x - m.x, z - m.z) > m.r + 5) continue;
    assert.ok(w.distWater[i] > 2, 'not on the beach');
    if (w.swampCarve[i] > 0.1) wet++;
  }
  assert.ok(wet > 60, `marsh pools ${wet} cells`);
});

test("a river's water never folds over itself where its course doubles back", () => {
  // Ten cells east, a step south, and ten cells back west alongside: a lowland meander.
  const pts: { x: number; y: number; z: number }[] = [];
  for (let k = 0; k <= 10; k++) pts.push({ x: k, y: 1 - k * 0.01, z: 0 });
  for (let k = 10; k >= 0; k--) pts.push({ x: k, y: 0.8, z: 1.6 });
  const P = riverSurface(pts)!.getAttribute('position');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < P.count; t += 3) {
    a.fromBufferAttribute(P, t); b.fromBufferAttribute(P, t + 1); c.fromBufferAttribute(P, t + 2);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    assert.ok(n.y > 0, 'every triangle faces up');
  }
  // Never rising downstream: nothing above the spring.
  for (let i = 0; i < P.count; i++) assert.ok(P.getY(i) <= 1 + 1e-6);
});

test("a river's water stops in a straight edge at a waterfall's lip and stays out of its plunge pool", () => {
  // Along +x, as the generator lays it out: level to a cell past the lip (x = 6.6), then the drop
  // to the pool, whose middle is poolR + 1.2 beyond the lip.
  const pts: { x: number; y: number; z: number }[] = [];
  for (let k = 0; k <= 7; k++) pts.push({ x: k, y: 5.6, z: 0 });
  for (let k = 8; k <= 22; k++) pts.push({ x: k, y: 2.9, z: 0 });
  const fall = { x: 6.6, z: 0, dx: 1, dz: 0, poolR: 3.3 };
  const P = riverSurface(pts, fall)!.getAttribute('position');
  let above = 0, below = 0, lipX = -Infinity;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    assert.ok(y >= 5.58 || y <= 2.92, 'no water sheet down the cliff');
    if (y > 5) { above++; lipX = Math.max(lipX, x); }
    else { below++; assert.ok(Math.hypot(Math.max(0, x - (6.6 + 4.5)), z) >= 3.9 - 0.03, 'clear of the pool'); }
  }
  assert.ok(above > 0 && below > 0, 'water above and below the fall');
  assert.ok(Math.abs(lipX - (6.6 - 0.22)) < 1e-3, `the edge just behind the lip runs straight across (${lipX})`);
});
