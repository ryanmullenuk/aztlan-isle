import { test } from 'node:test';
import assert from 'node:assert/strict';
import { islandMood, moodOf, moodTips, type MoodPerson, type MoodWorld } from '../src/economy/Mood';
import { eclipseCover, eclipseDark, planRare, RARE, rareDue, restoreRare } from '../src/economy/RareEvents';

const calm: MoodWorld = { storm: false, night: false, winter: false, afraid: false };
const person = (o: Partial<MoodPerson> = {}): MoodPerson => ({ hunger: 0.8, rest: 0.8, happy: 0.6, condition: 'well', child: false, home: 1, hidden: false, sleeping: false, ...o });

test('a contented islander shows nothing, a very happy one a heart', () => {
  assert.equal(moodOf(person(), calm), null);
  assert.equal(moodOf(person({ happy: 0.9 }), calm), 'happy');
});

test('sickness outranks hunger, and hunger outranks everything else', () => {
  assert.equal(moodOf(person({ condition: 'sick', hunger: 0 }), calm), 'sick');
  assert.equal(moodOf(person({ hunger: 0.1, home: -1, happy: 0.1 }), { ...calm, afraid: true }), 'hungry');
});

test('fear, wet and cold only touch those out of doors', () => {
  const w = { storm: true, night: true, winter: true, afraid: true };
  assert.equal(moodOf(person(), w), 'afraid');
  assert.equal(moodOf(person(), { ...w, afraid: false }), 'wet');
  assert.equal(moodOf(person(), { ...w, afraid: false, storm: false }), 'cold');
  assert.equal(moodOf(person({ hidden: true }), w), null);
});

test('children are never homeless', () => {
  assert.equal(moodOf(person({ home: -1 }), calm), 'homeless');
  assert.equal(moodOf(person({ home: -1, child: true }), calm), null);
});

test('the island mood averages happiness and counts each worry', () => {
  const m = islandMood([person({ happy: 0.9 }), person({ happy: 0.5, hunger: 0.1 }), person({ happy: 0.4, home: -1 })], calm);
  assert.equal(m.score, 60);
  assert.equal(m.label, 'Content');
  assert.deepEqual(m.counts, { happy: 1, hungry: 1, homeless: 1 });
  assert.equal(islandMood([], calm).score, 0);
});

test('tips put hunger first and stop at three', () => {
  const tips = moodTips({ homeless: 2, hungry: 3, sick: 1, hasTemple: false, hasGreatTemple: false, foodKinds: 1, dryHomes: 2, huts: 1, hasHealer: false });
  assert.equal(tips.length, 3);
  assert.match(tips[0], /3 islanders are going hungry/);
  assert.match(tips[1], /Healing Centre/);
});

test('rare events come days apart and never the same twice running', () => {
  let r = Math.random;
  for (let k = 0; k < 200; k++) {
    const s = planRare(10, r, 'comet');
    assert.notEqual(s.kind, 'comet');
    assert.ok(s.next >= 10 + RARE.gapMin && s.next <= 10 + RARE.gapMin + RARE.gapSpread);
  }
  r = () => 0;
  assert.equal(planRare(0, r).next, RARE.gapMin);
});

test('an event is due from its hour on its day, and late if its day was missed', () => {
  const s = { next: 7, kind: 'eclipse' as const };
  assert.equal(rareDue(s, 6, 23), false);
  assert.equal(rareDue(s, 7, RARE.hour.eclipse - 0.1), false);
  assert.equal(rareDue(s, 7, RARE.hour.eclipse), true);
  assert.equal(rareDue(s, 8, 1), true);
});

test('the eclipse covers the sun fully in the middle and darkens only near totality', () => {
  const L = RARE.eclipseLength;
  assert.equal(eclipseCover(0, L), 0);
  assert.equal(eclipseCover(L / 2, L), 1);
  assert.equal(eclipseCover(L, L), 0);
  assert.ok(eclipseCover(L * 0.2, L) > 0.2 && eclipseCover(L * 0.2, L) < 0.8);
  assert.equal(eclipseDark(0.5), 0);
  assert.equal(eclipseDark(1), 1);
});

test('a saved plan is read back, and nonsense is ignored', () => {
  assert.deepEqual(restoreRare({ next: 12, kind: 'whale', last: 'comet' }), { next: 12, kind: 'whale', last: 'comet' });
  assert.equal(restoreRare({ next: 'x', kind: 'whale' }), null);
  assert.equal(restoreRare({ next: 3, kind: 'dragon' }), null);
});

test('time-lapse pictures thin out the older half once there are too many', async () => {
  const { thinDays } = await import('../src/world/LapseStore');
  assert.deepEqual(thinDays([0, 1, 2], 5), []);
  const days = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(thinDays(days, 8), [1, 3]);
});
