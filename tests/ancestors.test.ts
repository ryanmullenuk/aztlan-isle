import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Building } from '../src/buildings/Buildings';
import { ancestorAltarModel, decorModel } from '../src/buildings/models';
import { BUILDINGS, isDecor } from '../src/config';
import { ANCESTORS, AncestorNight, mayAsk, spiritHours } from '../src/economy/AncestorNight';

const stub = { half: 50, layerY: () => 0 } as any;

/** A small village: `people` adults, an altar or none, at `hour`. */
function village(withAltar: boolean, hour = 12) {
  const altar = new Building(1, 'ancestoraltar', 50, 50, 0, 1, stub);
  altar.complete = true;
  const people = Array.from({ length: 6 }, (_, k) => ({ id: k + 1, name: `P${k}`, x: 3 + k, z: 6, happy: 0.5, hunger: 1, rest: 1, condition: 'well', think: 0, heading: 0, anim: 'idle' }));
  const dialogs: any[] = [], toasts: string[] = [];
  const game = {
    time: { hour, elapsed: 0 },
    eco: { godMode: false, belief: 0, add(_k: string, n: number) { this.belief += n; } },
    buildings: { list: withAltar ? [altar] : [] },
    passings: { graves: { list: [] } },
    world: { groundY: () => 0 },
    colony: { list: people, moodBoost: 0, byId: (id: number) => people.find((p) => p.id === id), walkTo(i: any, x: number, z: number) { i.x = x; i.z = z; } },
    ui: { dialog: { push: (d: any) => dialogs.push(d), forget() {} }, toast: (t: string) => toasts.push(t) },
    focusAt() {},
  } as any;
  return { game, altar, dialogs, toasts, night: new AncestorNight(game, () => 0.5) };
}

test('the Ancestor Altar and the Paper Flags are buildable, and their models build', () => {
  assert.equal(BUILDINGS.ancestoraltar.name, 'Ancestor Altar');
  assert.ok(isDecor('paperflags'));
  const altar = ancestorAltarModel();
  assert.ok(altar.finished.getAttribute('position').count > 500);
  assert.equal(altar.torches.length, 2, 'a brazier either side of the stair');
  assert.ok(decorModel('paperflags').finished.getAttribute('position').count > 200);
});

test('the spirits keep to the night', () => {
  assert.ok(spiritHours(22) && spiritHours(2));
  assert.ok(!spiritHours(12) && !spiritHours(6) && !spiritHours(19));
});

test('nobody asks without an altar, or before anyone has died', () => {
  assert.ok(!mayAsk(false, 3, 'quiet') && !mayAsk(true, 0, 'quiet') && !mayAsk(true, 2, 'granted'));
  const none = village(false);
  none.night.remember('Itzel', true);
  none.night.update(10000);
  assert.equal(none.dialogs.length, 0);
  const noDead = village(true);
  noDead.night.update(10000);
  assert.equal(noDead.dialogs.length, 0);
});

test('an islander asks now and again; refused or ignored, nothing comes of it', () => {
  const v = village(true);
  v.night.remember('Itzel', true);
  v.night.update(ANCESTORS.first[0] + 1);
  assert.equal(v.dialogs.length, 1);
  assert.equal(v.night.state, 'asked');
  v.dialogs[0].actions[1].run();
  assert.equal(v.night.state, 'quiet');
  // Not again for a good while.
  v.night.update(ANCESTORS.gap[0] - 10);
  assert.equal(v.dialogs.length, 1);
  v.night.update(ANCESTORS.gap[1]);
  assert.equal(v.dialogs.length, 2);
  // Left unanswered, the wish lapses.
  v.game.time.elapsed = ANCESTORS.lasts + 1;
  v.night.update(1);
  assert.equal(v.night.state, 'quiet');
  assert.equal(v.night.ghosts.count, 0);
});

test('granted, the spirits come out at nightfall, greet the living, and are gone by morning', () => {
  const v = village(true, 14);
  v.night.remember('Itzel', true);
  v.night.remember('Cuauh', false);
  v.night.update(ANCESTORS.first[0] + 1);
  v.dialogs[0].actions[0].run();
  assert.equal(v.night.state, 'granted');
  v.night.update(5);
  assert.equal(v.night.ghosts.count, 0, 'not by day');
  v.game.time.hour = 21;
  v.night.update(1);
  assert.equal(v.night.state, 'night');
  assert.equal(v.night.ghosts.count, 2);
  // A night under way is saved as granted, so the spirits return on loading.
  assert.equal(v.night.save().state, 'granted');
  v.night.update(1);
  v.night.update(ANCESTORS.visitSecs + 1);
  assert.equal(v.game.eco.belief, ANCESTORS.belief);
  assert.equal(v.night.state, 'night', 'the spirits linger after the living go home');
  v.game.time.hour = 6;
  v.night.update(1);
  assert.equal(v.night.state, 'quiet');
  assert.equal(v.night.ghosts.count, 0);
  assert.equal(v.night.held, 1);
});

test('the dead are remembered across saves', () => {
  const a = village(true), b = village(true);
  a.night.remember('Itzel', true);
  b.night.restore(JSON.parse(JSON.stringify(a.night.save())));
  assert.deepEqual(b.night.dead, [{ name: 'Itzel', f: true }]);
});
