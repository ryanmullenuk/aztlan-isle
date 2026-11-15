import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ancestorAltarModel, collectGlows, graveyardModel } from '../src/buildings/models';

test('the ancestor altar reports its candle flames for the night glow', () => {
  const m = collectGlows(() => ancestorAltarModel());
  const n = m.candles?.length ?? 0;
  assert.ok(n >= 20 && n <= 120, `candles: ${n}`);
  m.finished.computeBoundingBox();
  const box = m.finished.boundingBox!;
  for (const p of m.candles!) {
    assert.ok(Number.isFinite(p.x + p.y + p.z));
    assert.ok(p.y > 0 && p.y <= box.max.y + 0.01, 'flame above the ground, within the model');
  }
});

test('the graveyard shrine has candles too; a model built on its own records none', () => {
  assert.equal(collectGlows(() => graveyardModel(6, 6)).candles?.length, 6);
  assert.equal(ancestorAltarModel().candles, undefined);
});
