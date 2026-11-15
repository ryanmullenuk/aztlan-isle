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
  const sys = Object.assign(Object.create(BuildingSystem.prototype), { world: { inBounds: (x: number, z: number) => x >= 0 && z >= 0 && x < N && z < N, idx: (x: number, z: number) => z * N + x, layer, isSea: (i: number) => layer[i] <= 0 } });
  assert.ok(sys.seaBehind(40, 61, 6, 6, 0), 'arch toward the water');
  assert.ok(!sys.seaBehind(40, 61, 6, 6, 2), 'arch toward the land');
  assert.ok(!sys.seaBehind(40, 75, 6, 6, 0), 'too far inland');
});

test('the pyre: ashes are kept in an urn in the next graveyard plot, or given to the wind without one; the fire blackens, greys and takes the body', async () => {
  const { Passings } = await import('../src/economy/Passings');
  const yard = built('graveyard');
  const world = { blockCircle() {} };
  const withYard = new Passings({ buildings: { list: [yard] }, world, time: { day: 7 } } as any) as any;
  const plot = withYard.graveyardPlot();
  assert.equal(withYard.keepAshes('Tochtli'), true);
  const urn = withYard.graves.list[0];
  assert.ok(urn.urn && urn.name === 'Tochtli' && urn.day === 7);
  assert.ok(Math.hypot(urn.x - plot.x, urn.z - plot.z) < 1e-6, 'the urn is not in the first free plot');
  // The next urn takes the next plot; old graves (no urn flag) and urns share the plots.
  withYard.keepAshes('Xolo');
  assert.ok(Math.hypot(withYard.graves.list[1].x - urn.x, withYard.graves.list[1].z - urn.z) > 0.5);
  const none = new Passings({ buildings: { list: [] }, world, time: { day: 7 } } as any) as any;
  assert.equal(none.keepAshes('Itzel'), false);
  assert.equal(none.graves.list.length, 0, 'no marker is left without a graveyard');
  // The burning: white shroud, black by a third of the way, ash grey later, gone before the fire is out.
  const G = withYard.graves;
  G.showPyre({ x: 0, y: 0, z: 0 });
  G.showBier({ x: 0, y: 0.5, z: 0, yaw: 0 });
  G.burn(0);
  const white = G.bierMat.color.r;
  G.burn(0.4);
  const black = G.bierMat.color.r;
  G.burn(0.66);
  const grey = G.bierMat.color.r;
  assert.ok(white > 0.9 && black < 0.15 && grey > black + 0.2 && grey < 0.7, `shroud ${white}, burnt ${black}, ash ${grey}`);
  G.burn(0.95);
  assert.equal(G.bier.visible, false, 'the body is still there as the fire dies');
  G.endPyre();
  assert.equal(G.pyreAt, null);
  assert.equal(G.pyre.visible, false);
});

/** A pyre village at night: `n` grown islanders standing about, walking anywhere at once. */
async function pyreVillage(n: number, hour = 23) {
  const { Passings, PASSING } = await import('../src/economy/Passings');
  const pyre = new Building(9001, 'pyre', 60, 60, 0, 1, stub);
  pyre.complete = true;
  const people: any[] = Array.from({ length: n }, (_, k) => ({ id: k + 1, name: `P${k}`, x: 30 + k, z: 30, y: 0, heading: 0, happy: 0.5, hunger: 1, rest: 1, condition: 'well', think: 0, anim: 'idle', home: -1 }));
  const toasts: string[] = [];
  const colony = {
    list: people, moodBoost: 0,
    byId: (id: number) => people.find((p) => p.id === id),
    walkTo(i: any, x: number, z: number) { i.x = x; i.z = z; i.task = undefined; },
    remove(i: any) { people.splice(people.indexOf(i), 1); },
  };
  const game = {
    buildings: { list: [pyre] }, colony, time: { hour, day: 3 }, eco: { godMode: false, add() {} },
    world: { groundY: () => 0, blockCircle() {} }, ui: { dialog: { push() {} }, toast: (t: string) => toasts.push(t) },
  } as any;
  return { passings: new Passings(game) as any, people, PASSING, toasts };
}

test('the struck-down are carried to the pyre at once, by night too, and it is lit only when five have come to mourn', async () => {
  const v = await pyreVillage(8);
  v.passings.take(v.people[0], { kicker: 'Struck down', line: 'P0 was struck down.' });
  const f = () => v.passings.funeral;
  assert.equal(f().prompt, true);
  // A breath while the others flee, then two bearers come, well inside a minute.
  v.passings.update(v.PASSING.bearersAfter - 1);
  assert.equal(f().phase, 'wait');
  v.passings.update(2);
  assert.equal(f().phase, 'fetch', 'nobody came for the body at night');
  // Four of the seven left are asleep.
  for (const p of v.people.slice(3)) p.sleeping = true;
  for (let t = 0; t < 10 && f().phase !== 'gather'; t++) v.passings.update(1);
  assert.equal(f().phase, 'gather', 'the body never reached the pyre');
  // Three stand at the pyre, and it waits for more.
  for (let t = 0; t < 60; t++) v.passings.update(1);
  assert.equal(f().phase, 'gather', 'lit with fewer than five mourners');
  // They wake and come: five or more now stand round it, and the fire is lit.
  for (const p of v.people) p.sleeping = false;
  for (let t = 0; t < 12 && f().phase === 'gather'; t++) v.passings.update(1);
  assert.equal(f().phase, 'pray');
  assert.ok(f().crowd.present >= 5, `${f().crowd.present} mourners`);
});

test('a small village lights the pyre with everyone it has', async () => {
  const v = await pyreVillage(4, 12);
  v.passings.take(v.people[0], { kicker: 'Struck down', line: 'P0 was struck down.' });
  for (let t = 0; t < 40 && v.passings.funeral?.phase !== 'pray'; t++) v.passings.update(1);
  assert.equal(v.passings.funeral?.phase, 'pray', 'three mourners can never make five');
});

test('a smiting sends everyone near running away from it', async () => {
  const { Colony } = await import('../src/ai/Colony');
  const set: [number, number, number][] = [];
  const near = { id: 1, x: 3, z: 0 }, far = { id: 2, x: 30, z: 0 }, asleep = { id: 3, x: 1, z: 1, sleeping: true }, victim = { id: 4, x: 0, z: 0 };
  const self = { list: [near, far, asleep, victim], rnd: () => 0.5, cancelTask() {}, setTask: (i: any, kind: string, _t: number, x: number, z: number) => { assert.equal(kind, 'flee'); set.push([i.id, x, z]); } };
  const ran = (Colony.prototype as any).scatter.call(self, 0, 0, 8, (i: any) => i === victim);
  assert.equal(ran, 1);
  assert.equal(set[0][0], 1);
  assert.ok(set[0][1] > 3 + 6, 'ran toward the bolt, or not far enough');
});

test('the dead not yet burned are kept in the save: on the pyre, on the way, or waiting their turn', async () => {
  const v = await pyreVillage(9);
  v.passings.take(v.people[0], { kicker: 'Struck down', line: 'P0 was struck down.' });
  v.passings.take(v.people[0], { kicker: 'Struck down', line: 'P1 was struck down.' });
  // P0 is fetched and laid on the pyre; P1 lies waiting.
  for (let t = 0; t < 30 && v.passings.funeral.phase !== 'gather'; t++) v.passings.update(1);
  assert.equal(v.passings.funeral.phase, 'gather');
  const saved = JSON.parse(JSON.stringify(v.passings.save()));
  assert.deepEqual(saved.dead.map((d: any) => [d.name, !!d.atPyre]), [['P0', true], ['P1', false]]);
  // Loaded into a fresh village: P0 goes straight back on the pyre and the mourners are called, then P1's turn.
  const w = await pyreVillage(7);
  w.passings.restore(saved);
  w.passings.update(1);
  assert.equal(w.passings.funeral.name, 'P0');
  assert.equal(w.passings.funeral.phase, 'gather');
  for (let t = 0; t < 120 && w.passings.funeral?.name === 'P0'; t++) w.passings.update(1);
  w.passings.update(1);
  assert.equal(w.passings.funeral?.name, 'P1', 'the second body was lost');
  // Old saves (graves only) still load.
  const x = await pyreVillage(3);
  x.passings.restore({ graves: [] });
  assert.equal(x.passings.save().dead.length, 0);
});
