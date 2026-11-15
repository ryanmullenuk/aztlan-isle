import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { GameDialog, newsOnly } from '../src/ui/GameDialog';
import { combineNotices, type Notice } from '../src/ui/NoticeBanner';

const setup = () => {
  const d = new JSDOM('<body><div id="root"></div></body>', { url: 'https://aztlan.test' });
  Object.assign(globalThis, { document: d.window.document, window: d.window, localStorage: d.window.localStorage });
  const root = d.window.document.querySelector('#root') as HTMLElement;
  const dialog = new GameDialog(root);
  const shown: Notice[] = [];
  let pending = 0;
  dialog.banner = { push: (n) => shown.push(n), get pending() { return pending; } };
  return { root, dialog, shown, busy: (n: number) => { pending = n; } };
};

const built = (name: string) => ({ icon: 'tick' as const, kicker: 'Complete', title: 'Building Complete', body: `${name} constructed successfully`, news: true });

test('news with nothing to decide is a banner; choices, dangers and rewards stay cards', () => {
  assert.ok(newsOnly(built('Hut')));
  assert.ok(newsOnly({ icon: 'star', title: 'A comet!', news: true, actions: [{ label: 'OK', primary: true }] }));
  assert.ok(newsOnly({ icon: 'star', kicker: 'Milestone', title: 'First harvest', important: true }));
  assert.ok(newsOnly({ icon: 'info', title: 'A pearl!', news: true, actions: [{ label: 'Show me', run: () => {} }, { label: 'OK' }] }));
  assert.ok(!newsOnly({ icon: 'ask', title: 'A hut, please', actions: [{ label: 'Show me', run: () => {} }, { label: 'Build it', run: () => {} }] }));
  assert.ok(!newsOnly({ icon: 'warn', title: 'Fire!', important: true, actions: [{ label: 'Show me', run: () => {} }, { label: 'OK' }] }));
  assert.ok(!newsOnly({ icon: 'star', title: 'Daily chest', always: true, actions: [{ label: 'Open', run: () => {} }] }));
  assert.ok(!newsOnly({ icon: 'home', title: 'Welcome back', html: true, important: true }));
});

test('news arriving together shares one banner, and never opens a card', () => {
  const { root, dialog, shown, busy } = setup();
  for (const n of ['Hut', 'Well', 'Torch']) dialog.push(built(n));
  assert.ok(!dialog.showing);
  assert.equal(root.querySelector('.gd-card'), null);
  dialog.tick();
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, '3 Buildings Complete');
  assert.equal(shown[0].line, 'Hut, Well, Torch');
  // While a banner shows, news waits and then goes up together.
  busy(1);
  dialog.push(built('Farm'));
  dialog.push({ icon: 'star', kicker: 'A new title', title: 'Now a Village', body: 'Well done', important: true });
  dialog.tick();
  assert.equal(shown.length, 1);
  busy(0);
  dialog.tick();
  assert.deepEqual(shown.slice(1).map((n) => n.title), ['Building Complete', 'Now a Village']);
});

test('a news banner about a place can be tapped to go there', () => {
  const { dialog, shown } = setup();
  let went = 0;
  dialog.push({ icon: 'info', kicker: 'News', title: 'Ana found a pearl in an oyster on the beach', news: true, actions: [{ label: 'Show me', run: () => went++ }, { label: 'OK', primary: true }] });
  dialog.tick();
  assert.equal(shown[0].title, 'News');
  assert.match(shown[0].line, /Ana found a pearl/);
  shown[0].onClick!();
  assert.equal(went, 1);
});

test('mixed news combines under one heading; big moments keep their own banner', () => {
  const out = combineNotices([
    { title: 'Building Complete', line: 'Hut constructed successfully', short: 'Hut' },
    { title: 'Wish granted', line: 'Thanks', important: true },
    { title: 'A comet!', line: 'A star with a tail', short: 'A comet!' },
  ]);
  assert.deepEqual(out.map((n) => n.title), ['Village News', 'Wish granted']);
  assert.equal(out[0].line, 'Hut · A comet!');
});

test('only one card at a time, and the daily chest waits for play and a quiet moment', () => {
  const { root, dialog } = setup();
  const realNow = performance.now.bind(performance);
  let t = 1000;
  (performance as any).now = () => t;
  try {
    dialog.push({ icon: 'star', title: 'Daily chest', always: true, minPlay: 20, actions: [{ label: 'Open', primary: true, run: () => {} }] });
    dialog.push({ icon: 'ask', title: 'A hut, please', actions: [{ label: 'Later' }, { label: 'Build it', primary: true, run: () => {} }] });
    dialog.push({ icon: 'ask', title: 'A well, please', actions: [{ label: 'Later' }, { label: 'Build it', primary: true, run: () => {} }] });
    assert.equal(root.querySelectorAll('.gd-card').length, 1);
    assert.match(root.querySelector('.gd-title')!.textContent!, /hut/);
    for (let i = 0; i < 150; i++) { t += 100; dialog.tick(); }
    assert.match(root.querySelector('.gd-title')!.textContent!, /hut/, 'the open card stays until answered');
    // Answer both requests; the chest has had its 20 s of play but waits a moment after the last card.
    (root.querySelector('.gd-btn') as HTMLButtonElement).click();
    (dialog as any).next(); // the close animation's timer would do this
    assert.match(root.querySelector('.gd-title')!.textContent!, /well/);
    (root.querySelector('.gd-btn') as HTMLButtonElement).click();
    (dialog as any).next();
    assert.ok(!dialog.showing, 'not straight after another pop-up');
    for (let i = 0; i < 60; i++) { t += 100; dialog.tick(); }
    assert.ok(dialog.showing);
    assert.equal(root.querySelector('.gd-title')!.textContent, 'Daily chest');
  } finally {
    (performance as any).now = realNow;
  }
});
