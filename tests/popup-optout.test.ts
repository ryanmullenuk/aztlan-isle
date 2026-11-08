import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { GameDialog } from '../src/ui/GameDialog';
import { UI } from '../src/ui/UI';

const dom = () => {
  const d = new JSDOM('<body><div id="root"></div></body>', { url: 'https://aztlan.test' });
  Object.assign(globalThis, { document: d.window.document, window: d.window, localStorage: d.window.localStorage });
  return d.window.document.querySelector('#root') as HTMLElement;
};

test('the first pop-up of a kind offers to turn that kind off, once, pointing to Settings', () => {
  const root = dom(), dialog = new GameDialog(root), seen = new Set<string>();
  dialog.wasOffered = (k) => seen.has(k);
  dialog.offered = (k) => seen.add(k);
  let off = 0, watched = 0;
  const whale = (n: number) => ({ icon: 'ask' as const, title: `A whale ${n}`, optOut: { key: 'wildlife', label: 'Turn off wildlife pop-ups', run: () => off++ }, actions: [{ label: 'Later' }, { label: 'Watch', primary: true, run: () => watched++ }] });
  dialog.push(whale(1));
  const buttons = () => [...root.querySelectorAll<HTMLButtonElement>('.gd-btn')].map((b) => b.textContent);
  assert.deepEqual(buttons(), ['Turn off wildlife pop-ups', 'Later', 'Watch']);
  assert.match(root.querySelector('.gd-optout')!.textContent!, /Settings/);
  root.querySelector<HTMLButtonElement>('.gd-btn')!.click();
  assert.equal(off, 1);
  // The next one just asks as before.
  dialog.push(whale(2));
  assert.deepEqual(buttons(), ['Later', 'Watch']);
  assert.equal(root.querySelector('.gd-optout'), null);
  root.querySelectorAll<HTMLButtonElement>('.gd-btn')[1].click();
  assert.equal(watched, 1);
});

test('the tutorial tours every button, lighting each one up, and moves on with Next', () => {
  const root = dom();
  // Every button the player asked to be shown has a step of its own.
  const keys = ['select', 'rotate', 'area', 'build', 'terrain', 'flora', 'blessings', 'speed', 'settings', 'camera', 'views', 'alerts'];
  const src = readFileSync(new URL('../src/ui/UI.ts', import.meta.url), 'utf8');
  const toolbar = ['select', 'area', 'build', 'terrain', 'flora', 'blessings'];
  for (const k of keys) {
    assert.ok(src.includes(`tut: '${k}'`), `a tour step for ${k}`);
    assert.ok(toolbar.includes(k) ? src.includes('b.dataset.tut = id') : src.includes(`dataset.tut = '${k}'`), `the ${k} button is marked for it`);
  }
  // A tour step lights its button and waits for Next; the next step moves the light on.
  const speed = document.createElement('button'), gear = document.createElement('button');
  speed.dataset.tut = 'speed';
  gear.dataset.tut = 'settings';
  const tutorial = document.createElement('div');
  root.append(speed, gear, tutorial);
  const ui = Object.create(UI.prototype) as any;
  Object.assign(ui, { root, tutorial, tutStep: 0, tutNext: false });
  ui.tutSteps = [
    { tut: 'speed', next: true, title: 'Time', text: '', done: () => ui.tutNext },
    { tut: 'settings', next: true, title: 'Settings', text: '', done: () => ui.tutNext },
  ];
  ui.renderTutorial();
  assert.ok(speed.classList.contains('tut-glow'));
  assert.equal(ui.tutSteps[0].done(), false);
  tutorial.querySelector<HTMLButtonElement>('[data-a="next"]')!.click();
  assert.equal(ui.tutSteps[0].done(), true);
  ui.tutStep = 1;
  ui.renderTutorial();
  assert.ok(!speed.classList.contains('tut-glow') && gear.classList.contains('tut-glow'));
  assert.equal(ui.tutNext, false, 'Next starts afresh on each step');
});
