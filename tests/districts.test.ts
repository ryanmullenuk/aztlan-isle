import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as models from '../src/buildings/models';
import { TITLES, STAGES } from '../src/economy/Progression';

const tris = (g: { index: { count: number } | null; getAttribute: (k: string) => { count: number } }) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

test('each district style dresses houses differently, at every level, inside the plot, with night windows', () => {
  for (const tier of [1, 2, 3, 4]) {
    const base = models.collectGlows(() => models.styledHomeModel(tier));
    assert.ok(base.windows!.length > 0, 'houses have windows to light');
    for (const style of ['lakeside', 'noble', 'farmstead'] as const) {
      const m = models.collectGlows(() => models.styledHomeModel(tier, style));
      assert.ok(tris(m.finished as never) > tris(base.finished as never), `${style} level ${tier} adds its details`);
      // Within the 3×3 plot, or no further out than the plain house already reaches (the top level's awning).
      base.finished.computeBoundingBox();
      m.finished.computeBoundingBox();
      const bb = m.finished.boundingBox!, lim = base.finished.boundingBox!;
      const ok = (v: number, edge: number) => Math.abs(v) <= Math.max(1.5, Math.abs(edge)) + 1e-6;
      assert.ok(ok(bb.min.x, lim.min.x) && ok(bb.max.x, lim.max.x) && ok(bb.min.z, lim.min.z) && ok(bb.max.z, lim.max.z), `${style} level ${tier} fits its 3×3 plot`);
    }
  }
  for (const style of ['village', 'lakeside', 'noble', 'farmstead'] as const) {
    const hut = models.collectGlows(() => models.styledHutModel(style));
    hut.finished.computeBoundingBox();
    const bb = hut.finished.boundingBox!;
    assert.ok(Math.abs(bb.min.x) <= 1 && bb.max.x <= 1 && Math.abs(bb.min.z) <= 1 && bb.max.z <= 1, `${style} hut fits its 2×2 plot`);
    assert.ok(hut.windows!.length > 0, 'the hut doorway lights up');
  }
  assert.equal(models.isHouseStyle('noble'), true);
  assert.equal(models.isHouseStyle('castle'), false);
});

test('every settlement stage has a title', () => {
  assert.equal(TITLES.length, STAGES.length);
  assert.equal(TITLES[0], 'Camp');
  assert.equal(TITLES[TITLES.length - 1], 'Capital of the Isle');
});
