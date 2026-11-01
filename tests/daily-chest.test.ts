import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chestFor, DAILY_PEARLS, rushPearls } from '../src/economy/DailyChest';

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 10);

test('the first chest is day one', () => {
  assert.deepEqual(chestFor(null, at(2026, 11, 1)), { day: 1, pearls: DAILY_PEARLS[0] });
});

test('a chest opens once a day', () => {
  assert.equal(chestFor({ last: '2026-11-01', streak: 1 }, at(2026, 11, 1)), null);
});

test('coming back the next day carries the streak on, across a month end', () => {
  assert.deepEqual(chestFor({ last: '2026-10-31', streak: 3 }, at(2026, 11, 1)), { day: 4, pearls: DAILY_PEARLS[3] });
});

test('missing a day starts the streak again', () => {
  assert.equal(chestFor({ last: '2026-10-29', streak: 5 }, at(2026, 11, 1))!.day, 1);
});

test('a long streak keeps the biggest chest', () => {
  assert.equal(chestFor({ last: '2026-10-31', streak: 20 }, at(2026, 11, 1))!.pearls, DAILY_PEARLS[DAILY_PEARLS.length - 1]);
});

test('finishing a build costs a pearl a minute, at least one', () => {
  assert.equal(rushPearls(5), 1);
  assert.equal(rushPearls(60), 1);
  assert.equal(rushPearls(61), 2);
  assert.equal(rushPearls(300), 5);
});
