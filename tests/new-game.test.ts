import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/Game';
import { GameTime } from '../src/world/Time';

function harness() {
  const g = Object.create(Game.prototype) as any;
  let loop: (() => void) | null = null;
  let lost: (event: any) => void;
  let released = 0;
  let resets = 0;
  Object.assign(g, {
    playing: false, stopped: false, noSave: false,
    canvas: { clientWidth: 390, clientHeight: 844,
      addEventListener: (_: string, callback: any) => { lost = callback; } },
    clock: { connect() {}, update() {}, getDelta: () => 0.1,
      reset: () => { resets++; }, dispose() {} },
    renderer: { setAnimationLoop: (callback: any) => { loop = callback; },
      dispose: () => { released++; }, forceContextLoss: () => lost({ preventDefault() {} }) },
    time: new GameTime(), fps: { frames: 0, acc: 0, value: 60 },
    update() {}, render() {},
  });
  return { g, tick: () => loop?.(), lost: () => lost({ preventDefault() {} }),
    released: () => released, resets: () => resets };
}

test('startup renders before ready and does not advance the arrival until PLAY', () => {
  const h = harness();
  let rendered = false, ready = 0;
  h.g.render = () => { rendered = true; };
  globalThis.document = {} as any;
  h.g.start(() => { assert.ok(rendered); ready++; }, () => assert.fail('unexpected startup failure'));
  h.tick(); h.tick();
  assert.equal(ready, 1);
  assert.equal(h.g.time.elapsed, 0);
  h.g.play(); h.tick();
  assert.equal(h.resets(), 1);
  assert.equal(h.g.time.elapsed, 0.1);
});

test('first render failure stops the game and reaches the loading error handler', () => {
  const h = harness(); const error = new Error('render failed'); let failure: unknown;
  h.g.render = () => { throw error; };
  h.g.start(() => assert.fail('failed render must not announce ready'), (e: unknown) => { failure = e; });
  h.tick();
  assert.equal(failure, error);
  assert.equal(h.g.stopped, true);
  assert.equal(h.g.noSave, true);
});

test('lost graphics context stops autosaves; deliberate release does not report a crash', () => {
  const h = harness(); let failures = 0;
  h.g.start(() => {}, () => { failures++; });
  h.lost();
  assert.equal(failures, 1);
  assert.equal(h.g.noSave, true);
  const reset = harness();
  reset.g.start(() => {}, () => assert.fail('reset context loss is intentional'));
  reset.g.releaseForReload();
  assert.equal(reset.released(), 1);
  assert.equal(reset.g.noSave, true);
});

test('New game clears the save before releasing graphics and loads a fresh entry page', () => {
  const h = harness(); const order: string[] = [];
  const oldStorage = globalThis.localStorage, oldLocation = globalThis.location;
  globalThis.localStorage = { removeItem: () => { order.push('clear'); } } as any;
  globalThis.location = { pathname: '/aztlan-isle/', replace: (url: string) => {
    assert.equal(h.released(), 1);
    assert.match(url, /^\/aztlan-isle\/\?r=[a-z0-9]+$/); order.push('navigate');
  } } as any;
  h.g.start(() => {}, () => assert.fail('intentional reload'));
  try {
    h.g.newIsland();
    assert.deepEqual(order, ['clear', 'navigate']);
    assert.equal(h.g.noSave, true);
  } finally { globalThis.localStorage = oldStorage; globalThis.location = oldLocation; }
});

test('a failed save removal leaves the current game running instead of freezing it', () => {
  const h = harness(); let notified = false;
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { removeItem: () => { throw new Error('storage denied'); } } as any;
  h.g.ui = { toast: () => { notified = true; } };
  try {
    h.g.newIsland();
    assert.equal(h.g.stopped, false);
    assert.equal(h.released(), 0);
    assert.ok(notified);
  } finally { globalThis.localStorage = oldStorage; }
});
