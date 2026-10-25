import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as models from '../src/buildings/models';
import { fishingBoatGeometry, tradeShipGeometry } from '../src/entities/Boats';
import { BUILDINGS } from '../src/config';

const ctx = new Proxy({}, { get: (_, k) => k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} });
(globalThis as any).document = { createElement: () => ({ getContext: () => ctx }) };

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

const REFIT: [string, () => models.BuildingModel][] = [
  ['boatworkshop', () => models.boatWorkshopModel(3)],
  ['market', () => models.marketSquareModel()],
  ['warroom', () => models.warroomModel()],
  ['grainstore', () => models.grainstoreModel()],
  ['kennel', () => models.kennelModel()],
  ['butcher', () => models.butcherModel(...(BUILDINGS.butcher.size as [number, number]))],
  ['pigpen', () => models.pigpenModel(...(BUILDINGS.pigpen.size as [number, number]))],
  ['observatory', () => models.observatoryModel()],
];

test('refitted buildings stay inside their footprints, finite and within a mobile triangle budget', () => {
  for (const [key, make] of REFIT) {
    const m = make();
    const [w, d] = BUILDINGS[key as keyof typeof BUILDINGS].size;
    m.finished.computeBoundingBox();
    const bb = m.finished.boundingBox!;
    assert.ok(bb.min.x >= -w / 2 && bb.max.x <= w / 2 && bb.min.z >= -d / 2 && bb.max.z <= d / 2, `${key} inside its ${w}×${d} footprint`);
    for (const v of m.finished.getAttribute('position').array) assert.ok(Number.isFinite(v), `${key} finite`);
    assert.ok(tris(m.finished) < 9000, `${key} under 9k triangles (${tris(m.finished)})`);
  }
});

test('every boat-workshop research level fits its footprint', () => {
  for (const tier of [1, 2, 3]) {
    const g = models.boatWorkshopModel(tier).finished;
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    assert.ok(bb.min.x >= -2 && bb.max.x <= 2 && bb.min.z >= -2 && bb.max.z <= 2, `tier ${tier}`);
  }
});

test('food store baskets fill free slots inside the plot', () => {
  assert.equal(models.GRAIN_SLOTS.length, 8);
  for (const [x, z] of models.GRAIN_SLOTS) assert.ok(Math.abs(x) <= 0.9 && Math.abs(z) <= 0.9);
});

test('the trade ship and fishing boat keep a canoe-sized hull so collisions and berths still fit', () => {
  for (const g of [tradeShipGeometry(), fishingBoatGeometry()]) {
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    assert.ok(bb.max.z <= 1.3 && bb.min.z >= -1.3, 'length');
    assert.ok(bb.max.x <= 0.5 && bb.min.x >= -0.5, 'beam (with lanterns)');
    assert.ok(tris(g) < 6000);
  }
});
