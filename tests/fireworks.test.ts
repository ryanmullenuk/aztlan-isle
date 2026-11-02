import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIREWORKS, RARE_GOODS } from '../src/config';
import { Economy } from '../src/economy/Economy';
import { buyRare, packFireworks, rareBlock, rareLeft, restoreSales, voyageGunpowder, type RareSales } from '../src/economy/RareGoods';

const powder = RARE_GOODS.find((o) => o.key === 'gunpowder')!;
const fresh = (): RareSales => ({ day: -1, bought: {} });

test('voyagers find gunpowder only on a lucky voyage: a few jars at first, a jar or two later', () => {
  assert.equal(voyageGunpowder(false, () => 0.99), 0);
  assert.equal(voyageGunpowder(false, () => 0), FIREWORKS.firstJars);
  assert.equal(voyageGunpowder(true, () => FIREWORKS.findAgain + 0.01), 0);
  for (let k = 0; k < 50; k++) {
    const n = voyageGunpowder(true, () => Math.random() * FIREWORKS.findAgain * 0.99);
    assert.ok(n >= FIREWORKS.againJars[0] && n <= FIREWORKS.againJars[1]);
  }
});

test('gunpowder cannot be bought before it is discovered', () => {
  const eco = new Economy();
  eco.goods.pearls = 100;
  assert.match(buyRare(eco, fresh(), 3, powder, false), /Undiscovered/);
  assert.equal(eco.goods.gunpowder, 0);
  assert.equal(eco.goods.pearls, 100);
});

test('gunpowder costs pearls, and only a few jars are sold each day', () => {
  const eco = new Economy(), s = fresh();
  eco.goods.pearls = 100;
  assert.equal(buyRare(eco, s, 3, powder, true, 2), '');
  assert.equal(eco.goods.gunpowder, 2);
  assert.equal(eco.goods.pearls, 100 - powder.pearls * 2);
  assert.equal(rareLeft(s, 3, powder), powder.perDay - 2);
  assert.match(buyRare(eco, s, 3, powder, true, powder.perDay), /Only/);
  assert.equal(buyRare(eco, s, 3, powder, true, powder.perDay - 2), '');
  assert.match(rareBlock(eco, s, 3, powder, true), /Sold out/);
  // A new day, a new supply.
  assert.equal(rareLeft(s, 4, powder), powder.perDay);
  eco.goods.pearls = powder.pearls - 1;
  assert.match(buyRare(eco, s, 4, powder, true), /pearls/);
});

test('a firemaker packs one jar into fireworks, up to the store limit', () => {
  const eco = new Economy();
  assert.equal(packFireworks(eco), false);
  eco.goods.gunpowder = 2;
  assert.equal(packFireworks(eco), true);
  assert.equal(eco.goods.gunpowder, 1);
  assert.equal(eco.goods.fireworks, FIREWORKS.perJar);
  eco.goods.fireworks = FIREWORKS.cap;
  assert.equal(packFireworks(eco), false);
  assert.equal(eco.goods.gunpowder, 1);
});

test('saved sales are read back, and nonsense is ignored', () => {
  assert.deepEqual(restoreSales({ day: 5, bought: { gunpowder: 2, dragons: 4 } }), { day: 5, bought: { gunpowder: 2 } });
  assert.deepEqual(restoreSales(null), { day: -1, bought: {} });
  assert.deepEqual(restoreSales({ day: 'x' }), { day: -1, bought: {} });
});
