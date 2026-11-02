import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickCouple, restoreWedding, WEDDING } from '../src/economy/Weddings';
import { lanternDue, LANTERN } from '../src/economy/LanternNight';
import { isPhased, isWonder, BUILDINGS, WONDER_KEYS } from '../src/config';
import { BUILD_STAGE } from '../src/economy/Progression';

const person = (id: number, gender: 'm' | 'f', o: Record<string, unknown> = {}): any => ({ id, name: `P${id}`, gender, child: false, condition: 'well', happy: 0.7, warrior: null, ...o });

test('the happiest unmarried man and woman are the ones to ask', () => {
  const list = [person(1, 'm', { happy: 0.5 }), person(2, 'm', { happy: 0.95 }), person(3, 'f', { happy: 0.9 }), person(4, 'f', { happy: 0.45 })];
  const [m, f] = pickCouple(list, () => 0)!;
  assert.equal(m.id, 2);
  assert.equal(f.id, 3);
});

test('children, the married, the unwell, warriors and the miserable do not marry', () => {
  assert.equal(pickCouple([person(1, 'm', { child: true }), person(2, 'f')], () => 0), null);
  assert.equal(pickCouple([person(1, 'm', { spouse: 9 }), person(2, 'f')], () => 0), null);
  assert.equal(pickCouple([person(1, 'm', { condition: 'sick' }), person(2, 'f')], () => 0), null);
  assert.equal(pickCouple([person(1, 'm', { warrior: 'jaguar' }), person(2, 'f')], () => 0), null);
  assert.equal(pickCouple([person(1, 'm', { happy: 0.2 }), person(2, 'f')], () => 0), null);
  assert.equal(pickCouple([person(1, 'm'), person(2, 'm')], () => 0), null);
});

test('a saved wedding plan is read back; nonsense is ignored', () => {
  assert.deepEqual(restoreWedding({ next: 7 }), { next: 7 });
  assert.deepEqual(restoreWedding({ next: 7, wish: { a: 3, b: 4, until: 900 } }), { next: 7, wish: { a: 3, b: 4, until: 900 } });
  assert.deepEqual(restoreWedding({ next: 7, wish: { a: 'x' } }), { next: 7 });
  assert.equal(restoreWedding({ next: 'x' }), null);
  assert.equal(restoreWedding(null), null);
});

test('Lantern Night falls on autumn’s last evening, once a year', () => {
  const S = LANTERN.season;
  assert.equal(lanternDue(S, 3, 3, 19.5, 1, 0), true);
  assert.equal(lanternDue(S, 3, 3, 19.5, 1, 1), false, 'already held this year');
  assert.equal(lanternDue(S, 3, 3, 19.5, 2, 1), true, 'and again next year');
  assert.equal(lanternDue(S, 2, 3, 19.5, 1, 0), false, 'not before the last day');
  assert.equal(lanternDue(S, 3, 3, 15, 1, 0), false, 'not before dusk');
  assert.equal(lanternDue(0, 3, 3, 19.5, 1, 0), false, 'not in spring');
});

test('the wonders are late, phased monuments', () => {
  for (const k of WONDER_KEYS) {
    assert.ok(isWonder(k) && isPhased(k));
    assert.equal(BUILD_STAGE[k], 7);
    assert.ok(BUILDINGS[k].cost.carvedStone! > 0, 'they need carved stone');
  }
  assert.ok(isPhased('greattemple') && !isWonder('greattemple'));
  assert.ok(!isPhased('temple'));
});

test('at most one wedding every five days; an ungranted wish costs Belief', () => {
  assert.ok(WEDDING.gapMin >= 5);
  assert.ok(WEDDING.refusedBelief > 0 && WEDDING.wishSecs > 0);
});
