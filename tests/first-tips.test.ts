import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FirstTips, TIPS, TIPS_KEY, TIP_GAP, type TipState, type TipGate, type TipKey } from '../src/ui/FirstTips';

const quiet: TipState = { islander: -1, group: 0, devotion: 'Respectful', dead: 0, graves: 0, pyre: false, altar: false, ancestorNight: false, swimming: false };
const free: TipGate = { tutorial: false, busy: false, popups: 'all' };

function memStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
}

function make(store = memStore()) {
  const shown: TipKey[] = [];
  const tips = new FirstTips(store, (k) => shown.push(k));
  return { tips, shown, store };
}

test('every tip is one or two short sentences', () => {
  for (const t of Object.values(TIPS)) {
    const sentences = t.text.split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length;
    assert.ok(sentences <= 2 && t.text.length <= 190, t.title);
  }
});

test('a tip shows once, and only once, when its feature first matters', () => {
  const { tips, shown } = make();
  assert.equal(tips.poll(quiet, free, 0), null);
  assert.equal(tips.poll({ ...quiet, swimming: true }, free, 1), 'swim');
  tips.closed(2);
  for (let t = 100; t < 500; t += 50) tips.poll({ ...quiet, swimming: true }, free, t);
  assert.deepEqual(shown, ['swim']);
});

test('tips are remembered across sessions, and storage failing does not break them', () => {
  const store = memStore();
  const a = make(store);
  a.tips.poll({ ...quiet, pyre: true }, free, 0);
  assert.equal(store.m.get(TIPS_KEY), 'pyre');
  const b = make(store);
  assert.equal(b.tips.poll({ ...quiet, pyre: true }, free, 0), null);
  assert.deepEqual(b.shown, []);
  const broken = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };
  const c = make(broken as never);
  assert.equal(c.tips.poll({ ...quiet, pyre: true }, free, 0), 'pyre');
});

test('no tips during the tutorial, while busy or with pop-ups off; they wait', () => {
  const { tips, shown } = make();
  const s = { ...quiet, altar: true };
  assert.equal(tips.poll(s, { ...free, tutorial: true }, 0), null);
  assert.equal(tips.poll(s, { ...free, busy: true }, 1), null);
  assert.equal(tips.poll(s, { ...free, popups: 'off' }, 2), null);
  assert.deepEqual(shown, []);
  assert.equal(tips.poll(quiet, free, 3), 'altar');
});

test('one tip at a time, with a gap between them', () => {
  const { tips, shown } = make();
  const s = { ...quiet, pyre: true, altar: true, swimming: true };
  assert.equal(tips.poll(s, free, 0), 'pyre');
  assert.equal(tips.poll(s, free, 100), null, 'not while one is open');
  tips.closed(100);
  assert.equal(tips.poll(s, free, 101), null, 'not straight after');
  assert.equal(tips.poll(s, free, 100 + TIP_GAP), 'altar');
  assert.deepEqual(shown, ['pyre', 'altar']);
});

test('the first selection teaches the hand, the next teaches smiting', () => {
  const { tips, shown } = make();
  tips.poll({ ...quiet, islander: 3 }, free, 0);
  tips.closed(0);
  tips.poll({ ...quiet, islander: 3 }, free, 100);
  tips.poll({ ...quiet, islander: 7 }, free, 200);
  assert.deepEqual(shown, ['hand', 'smite']);
});

test('a death tip only for a death seen in play, and not once a pyre or altar stands', () => {
  const a = make();
  a.tips.poll({ ...quiet, dead: 2 }, free, 0);
  assert.deepEqual(a.shown, []);
  a.tips.poll({ ...quiet, dead: 3 }, free, 1);
  assert.deepEqual(a.shown, ['death']);
  const b = make();
  b.tips.poll(quiet, { ...free, tutorial: true }, 0);
  b.tips.poll({ ...quiet, dead: 1 }, { ...free, tutorial: true }, 1);
  b.tips.poll({ ...quiet, dead: 1, altar: true }, free, 2);
  assert.deepEqual(b.shown, ['altar']);
});

test('fear or love: a tip once the village leaves plain respect', () => {
  const { tips, shown } = make();
  tips.poll({ ...quiet, devotion: 'Fearful' }, free, 0);
  assert.deepEqual(shown, ['devotion']);
});
