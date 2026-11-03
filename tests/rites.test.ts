import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Building, BuildingSystem } from '../src/buildings/Buildings';
import { CEREMONY, GRAVEYARD } from '../src/buildings/models';
import { BUILDINGS } from '../src/config';

const stub = { half: 50, layerY: () => 0 } as any;
const built = (key: 'graveyard' | 'ceremony' | 'temple' | 'campfire', cx = 50, cz = 50, rot = 0) => {
  const b = new Building(cx * 100 + cz, key, cx, cz, rot, 1, stub);
  b.complete = true;
  return b;
};

test('the graveyard lays out sixteen plots in neat rows either side of its path', () => {
  const P = GRAVEYARD.plots, [w, d] = BUILDINGS.graveyard.size;
  assert.equal(P.length, 16);
  assert.equal(new Set(P.map((p) => p[0])).size, 4, 'four columns');
  assert.equal(new Set(P.map((p) => p[1])).size, 4, 'four rows');
  for (const [x, z] of P) {
    assert.ok(Math.abs(x) > 1.0, 'clear of the path down the middle');
    assert.ok(Math.abs(x) + 0.45 < w / 2 && Math.abs(z) + 0.55 < d / 2, 'inside the walls');
  }
});

test('graves fill a graveyard from the shrine end, each plot once, headstones facing the gate', async () => {
  const { Passings } = await import('../src/economy/Passings');
  const yard = built('graveyard');
  const game = { buildings: { list: [yard] }, world: { blockCircle() {} } } as any;
  const p = new Passings(game) as any;
  const first = p.graveyardPlot();
  const [, lz] = yard.toLocal(first.x, first.z);
  assert.ok(Math.abs(lz - Math.min(...GRAVEYARD.plots.map((q) => q[1]))) < 1e-6, 'the back row first');
  assert.ok(Math.abs(first.yaw - (yard.angle + Math.PI)) < 1e-9);
  const seen = new Set<string>();
  for (let k = 0; k < 16; k++) {
    const plot = p.graveyardPlot();
    assert.ok(plot, `plot ${k}`);
    const key = `${plot.x.toFixed(2)},${plot.z.toFixed(2)}`;
    assert.ok(!seen.has(key));
    seen.add(key);
    p.graves.add({ name: `n${k}`, x: plot.x, z: plot.z, y: 0, yaw: plot.yaw, day: 1 });
  }
  assert.equal(p.graveyardPlot(), null, 'a full graveyard has no room');
});

test('weddings are held on the Ceremonial Platform when there is one, the guests up on its deck', async () => {
  const { WeddingSystem } = await import('../src/economy/Weddings');
  const fire = built('campfire', 40, 40), temple = built('temple', 44, 44), deck = built('ceremony', 60, 60);
  const venue = (list: Building[]) => (new WeddingSystem({ buildings: { list } } as any) as any).venue();
  assert.equal(venue([fire, temple]), temple);
  assert.equal(venue([fire, temple, deck]), deck);
  const [w, d] = BUILDINGS.ceremony.size;
  for (const [x, z] of [...CEREMONY.couple, CEREMONY.priest, ...CEREMONY.guests]) assert.ok(Math.abs(x) < w / 2 && Math.abs(z) < d / 2, 'everyone stands on the deck');
  assert.ok(CEREMONY.guests.length >= 14);
});

test('the platform must stand with its back to the sea', () => {
  // Land at z < 60, sea beyond; the door faces +z at rot 0, so its back is toward -z.
  const N = 100, layer = new Int8Array(N * N);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) layer[z * N + x] = z >= 60 ? 1 : 0;
  const sys = Object.assign(Object.create(BuildingSystem.prototype), { world: { inBounds: (x: number, z: number) => x >= 0 && z >= 0 && x < N && z < N, idx: (x: number, z: number) => z * N + x, layer } });
  assert.ok(sys.seaBehind(40, 61, 6, 6, 0), 'arch toward the water');
  assert.ok(!sys.seaBehind(40, 61, 6, 6, 2), 'arch toward the land');
  assert.ok(!sys.seaBehind(40, 75, 6, 6, 0), 'too far inland');
});
