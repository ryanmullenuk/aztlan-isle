import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Progression } from '../src/economy/Progression';
import { Economy, AWAY_CAP_SECONDS, AWAY_PACE } from '../src/economy/Economy';
import { RequestBoard, REQUESTS, type RequestWorld } from '../src/economy/Requests';
import { makeIslander, type Islander } from '../src/entities/Islander';

test('the goal checklist lists every requirement, met or not, and missing() is just the unmet ones', () => {
  const milestones = new Set<string>(['progress:built:woodstore']);
  const p = new Progression(() => ({ buildings: [], population: 4, food: 0, carved: 0, sandbox: false, milestones }));
  milestones.add('progress:stage:2');
  const items = p.checklist(3);
  assert.deepEqual(items.map((i) => i.done), [true, false, true, false]);
  assert.equal(items.find((i) => i.text.includes('Food Store'))?.build, 'grainstore');
  assert.deepEqual(p.missing(3), items.filter((i) => !i.done).map((i) => i.text));
});

test('away earnings: a share of the usual income, at most four hours of it, never past the stores', () => {
  const e = new Economy();
  e.woodCap = 10000;
  e.res.wood = 0;
  e.steady = { wood: 60 };
  const got = e.awayGains(3600);
  assert.equal(got.wood, Math.floor(60 * 60 * AWAY_PACE));
  const e2 = new Economy(); e2.woodCap = 1e7; e2.res.wood = 0; e2.steady = { wood: 60 };
  assert.equal(e2.awayGains(AWAY_CAP_SECONDS * 5).wood, Math.floor(60 * (AWAY_CAP_SECONDS / 60) * AWAY_PACE));
  const e3 = new Economy(); e3.woodCap = 50; e3.res.wood = 40; e3.steady = { wood: 600 };
  assert.equal(e3.awayGains(3600).wood, 10, 'only what the store can hold');
});

test('requests: an islander asks for something the village lacks; building it grants the wish once', () => {
  let clock = 0;
  const homeB: any = { id: 1, key: 'hut', x: 0, z: 0, complete: true };
  const buildings: any[] = [homeB];
  const isl: Islander = makeIslander(7, 'Itzel', 'f', 1, 1, () => 0.5);
  isl.home = 1;
  const w: RequestWorld = {
    people: () => [isl], buildings: () => buildings, byId: (id) => buildings.find((b) => b.id === id),
    canBuild: (k) => (k === 'well' ? '' : 'locked'), freeBeds: () => 2, sandbox: () => false,
  };
  const board = new RequestBoard(w, () => 0, () => clock);
  const granted: string[] = [];
  board.onGranted = (r) => granted.push(r.key);
  for (let k = 0; k < 200 && !board.list.length; k++) { clock += 2; board.update(2); }
  assert.equal(board.list.length, 1);
  assert.equal(board.list[0].key, 'well');
  assert.match(board.list[0].text, /Itzel/);
  // A well far from her home doesn't count; one nearby does.
  buildings.push({ id: 2, key: 'well', x: 40, z: 40, complete: true });
  clock += 2; board.update(2);
  assert.equal(granted.length, 0);
  buildings.push({ id: 3, key: 'well', x: 5, z: 3, complete: true });
  clock += 2; board.update(2);
  assert.deepEqual(granted, ['well']);
  assert.equal(board.list.length, 0);
  // Saved and restored with new building ids.
  const b2 = new RequestBoard(w, () => 0, () => clock);
  b2.restore([{ id: 1, who: 7, key: 'well', text: 't', thanks: 'x', before: [3], until: clock + REQUESTS.lasts, belief: 15 }], new Map([[3, 30]]));
  assert.deepEqual(b2.list[0].before, [30]);
});
