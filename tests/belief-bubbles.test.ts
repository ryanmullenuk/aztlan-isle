import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Building } from '../src/buildings/Buildings';
import { BeliefBubbles, bubbleCap, homeMult } from '../src/economy/BeliefBubbles';
import { Economy } from '../src/economy/Economy';
import { ISLANDER } from '../src/config';

const stub = { half: 50, layerY: () => 0 } as any;
const built = (key: 'hut' | 'home' | 'temple' | 'woodstore', tier = 1) => {
  const b = new Building(Math.floor(Math.random() * 1e6), key, 50, 50, 0, 1, stub);
  b.complete = true;
  b.tier = tier;
  return b;
};

test('belief gathers in a bubble over a home up to its cap; a full bubble stops filling', () => {
  const eco = new Economy(), B = new BeliefBubbles(eco), hut = built('hut');
  const before = eco.res.belief;
  B.gather(hut, 5);
  assert.equal(hut.belief, 5);
  assert.equal(eco.res.belief, before, 'nothing reaches the store until it is collected');
  B.gather(hut, 1000);
  assert.equal(hut.belief, bubbleCap(hut));
  assert.equal(B.fill(hut), 1);
});

test('bigger homes gather and hold more than small ones', () => {
  const hut = built('hut'), home1 = built('home', 1), home4 = built('home', 4);
  assert.ok(homeMult(home1) > homeMult(hut) && homeMult(home4) > homeMult(home1));
  assert.ok(bubbleCap(home1) > bubbleCap(hut) && bubbleCap(home4) > bubbleCap(home1));
});

test('tapping collects what the Belief store has room for; the rest waits in the bubble', () => {
  const eco = new Economy(), B = new BeliefBubbles(eco), home = built('home', 2);
  B.gather(home, 40);
  eco.res.belief = eco.beliefCap - 15;
  assert.equal(B.collect(home), 15);
  assert.equal(eco.res.belief, eco.beliefCap);
  assert.equal(home.belief, 25);
  assert.equal(B.collect(home), 0, 'a full store takes nothing');
});

test('buildings without a bubble pay belief straight into the store', () => {
  const eco = new Economy(), B = new BeliefBubbles(eco), store = built('woodstore');
  const before = eco.res.belief;
  B.gather(store, 3);
  B.gather(null, 2);
  assert.equal(eco.res.belief, before + 5);
  assert.equal(store.belief, 0);
});

test('time away fills the bubbles of homes with contented people (up to full), not the store', () => {
  const eco = new Economy(), B = new BeliefBubbles(eco), hut = built('hut'), home = built('home', 3);
  hut.residents = [1, 2];
  home.residents = [3, 4, 5];
  const happy = (id: number) => (id === 5 ? 0.1 : 0.9);
  const before = eco.res.belief;
  B.away([hut, home], 600, 0.35, happy);
  assert.equal(eco.res.belief, before);
  assert.ok(Math.abs(hut.belief - 2 * ISLANDER.beliefPerHappyPerSecond * 600 * 0.35) < 1e-6 || hut.belief === bubbleCap(hut));
  assert.ok(home.belief > 0);
  B.away([hut, home], 1e7, 0.35, happy);
  assert.equal(hut.belief, bubbleCap(hut));
  assert.equal(home.belief, bubbleCap(home));
});
