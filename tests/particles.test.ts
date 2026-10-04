import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Particles } from '../src/render/Particles';

test('empty effects do not draw or upload buffers', () => {
  const p = new Particles(2000, 0xffffff);
  const a = p.points.geometry.getAttribute('position');
  p.update(1);
  assert.equal(p.points.geometry.drawRange.count, 0);
  assert.equal(a.version, 0);
});
test('expired particles compact without losing or double-advancing survivors', () => {
  const p = new Particles(10, 0xffffff);
  p.spawn(1, 0, 0, 1, 0, 0, 0.1, 1);
  p.spawn(10, 0, 0, 2, 0, 0, 4, 2, 1);
  p.update(0.5);
  const g = p.points.geometry;
  assert.equal(g.drawRange.count, 1);
  assert.equal(g.getAttribute('position').getX(0), 11);
  assert.equal(g.getAttribute('aSize').getX(0), 2.5);
  assert.ok(Math.abs(g.getAttribute('aAlpha').getX(0) - 0.6125) < 0.0001);
  assert.deepEqual(g.getAttribute('position').updateRanges, [{ start: 0, count: 3 }]);
  p.update(5);
  assert.equal(g.drawRange.count, 0);
  const version = g.getAttribute('position').version;
  p.update(1);
  assert.equal(g.getAttribute('position').version, version);
  p.spawn(20, 0, 0, 0, 0, 0, 1, 1);
  p.update(0);
  assert.equal(g.drawRange.count, 1);
  assert.equal(g.getAttribute('position').getX(0), 20);
});
test('bursts stay bounded and reuse capacity', () => {
  const p = new Particles(3, 0xffffff);
  for (let i = 0; i < 10; i++) p.spawn(i, 0, 0, 0, 0, 0, 2, 1);
  p.update(0);
  assert.equal(p.points.geometry.drawRange.count, 3);
  const x = [0, 1, 2].map(i => p.points.geometry.getAttribute('position').getX(i)).sort();
  assert.deepEqual(x, [7, 8, 9]);
});
