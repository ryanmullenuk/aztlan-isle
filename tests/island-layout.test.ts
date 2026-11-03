import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD } from '../src/config';
import { generateIsland } from '../src/world/generator';
import { World } from '../src/world/World';

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

test('the willow glade: an open meadow round a freshwater lake deep enough to fish from', () => {
  const w = island(2), g = w.glade;
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

test('the strait between the islands stays open on the larger layout', () => {
  const w = island(2), N = w.N;
  // Somewhere along the strait's line (x ≈ 0.215 of the map) every row crossing it has water.
  const cx = Math.round(((0.215 + 1) / 2) * N);
  let rows = 0, wet = 0;
  for (let cz = Math.round(N * 0.35); cz < Math.round(N * 0.65); cz++) {
    rows++;
    for (let dx = -4; dx <= 4; dx++) if (w.layer[cz * N + cx + dx] < 1) { wet++; break; }
  }
  assert.ok(wet / rows > 0.9, `${wet}/${rows} rows open`);
});
