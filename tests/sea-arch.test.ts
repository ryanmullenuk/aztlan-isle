import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { WORLD } from '../src/config';
import { archCells, archField, placeSeaArch, SeaArch } from '../src/water/SeaArch';
import { openSea } from '../src/water/SeaStacks';

const ctx = new Proxy({}, { get: (_, k) => k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} });
(globalThis as any).document = { createElement: () => ({ getContext: () => ctx }) };

function island(): World {
  const w = new World();
  generateIsland(w, WORLD.islandSeed);
  growIslets(w);
  return w;
}

type Site = NonNullable<ReturnType<typeof placeSeaArch>>;
const P = (s: Site, t: number, u: number) => [s.x + s.sx * t - s.sz * u, s.z + s.sz * t + s.sx * u];

/** Can a boat get from a to b over open sea, keeping within a band of the arch's run (t0..t1)? */
function crossable(w: World, blocked: Set<number>, s: Site, t0: number, t1: number, a: number[], b: number[]): boolean {
  const sea = openSea(w);
  const tOf = (i: number) => (w.centerX(i % w.N) - s.x) * s.sx + (w.centerZ((i / w.N) | 0) - s.z) * s.sz;
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

test('sea arch: one, from the seed, off the main island clear of the village plain, with a stack beyond', () => {
  const w = island();
  const s = placeSeaArch(w, WORLD.islandSeed);
  assert.ok(s, 'no arch site');
  assert.deepEqual(placeSeaArch(w, WORLD.islandSeed), s);
  assert.ok(Math.hypot(s.x - w.meadow.x, s.z - w.meadow.z) > w.meadow.r + 10);
  assert.ok(s.gap1 - s.gap0 >= 3, 'opening too narrow for boats');
  assert.ok(s.stacks.length >= 1 && s.stacks[0].t > s.tip);
  // The ridge's root is on dry land.
  const [lx, lz] = P(s, -3, 0);
  assert.ok(w.layer[w.cellIndexAt(lx, lz)] >= 1);
});

test('sea arch: solid rock over the opening, with headroom for a masthead under it', () => {
  const w = island();
  const s = placeSeaArch(w, WORLD.islandSeed)!;
  const tc = (s.gap0 + s.gap1) / 2;
  for (let h = -0.3; h <= 2.4; h += 0.3) for (let u = -1.5; u <= 1.5; u += 0.5) assert.ok(archField(s, tc, h, u) > 0, `rock in the opening at h ${h.toFixed(1)}`);
  assert.ok(archField(s, tc, 3.9, 0) < 0, 'no rock over the opening');
  assert.ok(archField(s, 2, 2, 0) < 0 && archField(s, s.tip - 1, 1, 0) < 0, 'ridge or outer leg missing');
});

test('sea arch: boats can sail through under the arch but not through the rock', () => {
  const w = island();
  const s = placeSeaArch(w, WORLD.islandSeed)!;
  const blocked = new Set(archCells(w, s));
  const tc = (s.gap0 + s.gap1) / 2;
  const cell = (t: number, u: number) => w.cellIndexAt(P(s, t, u)[0], P(s, t, u)[1]);
  assert.ok(blocked.has(cell(2, 0)) && blocked.has(cell(s.tip - 1, 0)));
  for (let u = -6; u <= 6; u += 0.5) assert.ok(!blocked.has(cell(tc, u)), `channel blocked at ${u}`);
  assert.ok(crossable(w, blocked, s, s.gap0, s.gap1, P(s, tc, -8), P(s, tc, 8)));
  assert.ok(!crossable(w, blocked, s, 0.5, s.gap0 - 0.8, P(s, 2, -8), P(s, 2, 8)));
});

test('sea arch: a closed, outward-facing rock mesh; a permanent landmark nothing is built or sculpted on', () => {
  const w = island();
  const arch = new SeaArch(w, WORLD.islandSeed);
  const s = arch.site!;
  const mesh = arch.group.children[0] as any;
  const pos = mesh.geometry.getAttribute('position').array as Float32Array;
  const nor = mesh.geometry.getAttribute('normal').array as Float32Array;
  assert.ok(pos.length / 9 > 4000);
  // Every edge above the seabed is shared by two facets (no holes to see through).
  const key = (i: number) => `${pos[i * 3]},${pos[i * 3 + 1]},${pos[i * 3 + 2]}`;
  const edges = new Map<string, { n: number; y: number }>();
  for (let f = 0; f < pos.length / 9; f++) for (let e = 0; e < 3; e++) {
    const a = key(f * 3 + e), b = key(f * 3 + ((e + 1) % 3)), id = a < b ? a + '|' + b : b + '|' + a;
    const o = edges.get(id);
    if (o) o.n++;
    else edges.set(id, { n: 1, y: pos[(f * 3 + e) * 3 + 1] });
  }
  for (const e of edges.values()) if (e.y > -1.5) assert.notEqual(e.n, 1, 'hole in the rock');
  // Facets face out of the rock.
  let wrong = 0;
  for (let f = 0; f < pos.length / 9; f++) {
    const cx = (pos[f * 9] + pos[f * 9 + 3] + pos[f * 9 + 6]) / 3, cy = (pos[f * 9 + 1] + pos[f * 9 + 4] + pos[f * 9 + 7]) / 3, cz = (pos[f * 9 + 2] + pos[f * 9 + 5] + pos[f * 9 + 8]) / 3;
    const L = (x: number, y: number, z: number) => {
      const dx = x - s.x, dz = z - s.z;
      return archField(s, dx * s.sx + dz * s.sz, y - 0.07, -dx * s.sz + dz * s.sx);
    };
    const n = [nor[f * 9], nor[f * 9 + 1], nor[f * 9 + 2]];
    if (L(cx + n[0] * 0.12, cy + n[1] * 0.12, cz + n[2] * 0.12) < L(cx - n[0] * 0.12, cy - n[1] * 0.12, cz - n[2] * 0.12)) wrong++;
  }
  assert.ok(wrong < pos.length / 9 / 200, `${wrong} facets face inward`);
  // The land under the ridge's root is taken, and protected from sculpting.
  const land = arch.landCells();
  assert.ok(land.length > 4);
  for (const i of land) assert.equal(w.blockFixed[i], 1);
  const [lx, lz] = P(s, -2, 0);
  assert.ok(arch.covers(lx, lz));
  assert.ok(!arch.covers(w.meadow.x, w.meadow.z));
  assert.ok(arch.surfSites().length >= 3);
});
