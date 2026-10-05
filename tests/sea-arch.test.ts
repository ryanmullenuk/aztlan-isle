import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { WORLD } from '../src/config';
import { archCells, placeSeaArch } from '../src/water/SeaArch';
import { openSea } from '../src/water/SeaStacks';

const ctx = new Proxy({}, { get: (_, k) => k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} });
(globalThis as any).document = { createElement: () => ({ getContext: () => ctx }) };

function island(): World {
  const w = new World();
  generateIsland(w, WORLD.islandSeed);
  growIslets(w);
  return w;
}

/** Can a boat get from a to b over open sea, keeping within a band of the arch's run (t0..t1)? */
function crossable(w: World, blocked: Set<number>, site: NonNullable<ReturnType<typeof placeSeaArch>>, t0: number, t1: number, a: number[], b: number[]): boolean {
  const sea = openSea(w);
  const tOf = (i: number) => (w.centerX(i % w.N) - site.x) * site.sx + (w.centerZ((i / w.N) | 0) - site.z) * site.sz;
  const start = w.cellIndexAt(a[0], a[1]), goal = w.cellIndexAt(b[0], b[1]);
  const seen = new Set([start]), q = [start];
  while (q.length) {
    const i = q.pop()!;
    if (i === goal) return true;
    for (const j of [i - 1, i + 1, i - w.N, i + w.N]) {
      if (seen.has(j) || !sea[j] || blocked.has(j)) continue;
      const t = tOf(j);
      if (t < t0 || t > t1) continue;
      seen.add(j);
      q.push(j);
    }
  }
  return false;
}

test('sea arch: one, from the seed, off the main island clear of the village plain', () => {
  const w = island();
  const s = placeSeaArch(w, WORLD.islandSeed);
  assert.ok(s, 'no arch site');
  assert.deepEqual(placeSeaArch(w, WORLD.islandSeed), s);
  assert.ok(Math.hypot(s.x - w.meadow.x, s.z - w.meadow.z) > w.meadow.r + 10);
  assert.ok(s.gap1 - s.gap0 >= 3, 'gap too narrow for boats');
  assert.ok(s.pillar > s.gap1);
});

test('sea arch: boats can sail through under the arch but not through the rock', () => {
  const w = island();
  const s = placeSeaArch(w, WORLD.islandSeed)!;
  const blocked = new Set(archCells(w, s));
  const qx = -s.sz, qz = s.sx;
  const P = (t: number, u: number) => [s.x + s.sx * t + qx * u, s.z + s.sz * t + qz * u];
  const tg = (s.gap0 + s.gap1) / 2;
  // The pillar and the ridge are solid...
  assert.ok(blocked.has(w.cellIndexAt(P(s.pillar, 0)[0], P(s.pillar, 0)[1])));
  assert.ok(blocked.has(w.cellIndexAt(P(s.spineEnd / 2, 0)[0], P(s.spineEnd / 2, 0)[1])));
  // ...the channel under the arch is open water, straight across...
  for (let u = -6; u <= 6; u += 0.5) assert.ok(!blocked.has(w.cellIndexAt(P(tg, u)[0], P(tg, u)[1])), `channel blocked at ${u}`);
  assert.ok(crossable(w, blocked, s, s.gap0, s.gap1, P(tg, -8), P(tg, 8)));
  // ...but there is no way through the ridge itself.
  assert.ok(!crossable(w, blocked, s, 0.5, s.spineEnd - 0.5, P(s.spineEnd / 2, -8), P(s.spineEnd / 2, 8)));
});
