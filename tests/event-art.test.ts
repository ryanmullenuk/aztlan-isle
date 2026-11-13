import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { ART_KEYS, artFor, artSrc } from '../src/ui/eventArt';

test('pop-ups pick a drawing that suits their words, or none', () => {
  assert.equal(artFor('The volcano is erupting! 75 Belief lost.'), 'volcano');
  assert.equal(artFor('A young whale has washed up on the beach'), 'whale');
  assert.equal(artFor('A jaguar! Villagers are running for shelter.'), 'jaguar');
  assert.equal(artFor('A storm rolls in from the sea.'), 'storm');
  assert.equal(artFor('Tochtli was born to Ana!'), 'baby');
  assert.equal(artFor('The area is cleared: ready to build on.'), null);
  assert.equal(artFor('A jaguar warrior begins training.'), 'jaguar');
  assert.equal(artFor('An eagle warrior begins training.'), 'warrior');
  assert.equal(artFor('The Kiln is on fire. Calm prevents further lightning.'), 'fire');
  assert.equal(artFor('It is already raining.'), 'rain');
  for (const k of ART_KEYS) assert.ok(existsSync(new URL(`../public/${artSrc(k).slice(2)}`, import.meta.url)), `a picture for ${k}`);
});
