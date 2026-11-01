import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UI } from '../src/ui/UI';
import { Game } from '../src/Game';

test('warnings are retained and deduplicated even while the interface is hidden', () => {
  const ui = Object.create(UI.prototype) as any;
  Object.assign(ui, { alerts: [], zen: true, renderAlerts() {} });
  ui.toast('Monkeys are raiding', 'warn', () => ({ x: 1, z: 2 }));
  ui.toast('Monkeys are raiding', 'warn', () => ({ x: 3, z: 4 }));
  ui.toast('Saved', 'info');
  assert.equal(ui.alerts.length, 1);
  assert.deepEqual(ui.alerts[0].at(), { x: 3, z: 4 });
});

test('resolved moving threats clear while active and manually cleared warnings remain', () => {
  const ui = Object.create(UI.prototype) as any;
  let removed = false, refreshed = false;
  Object.assign(ui, { alerts: [
    { text: 'Monkeys', at: () => null, toast: { remove() { removed = true; } } },
    { text: 'Active threat', at: () => ({ x: 2, z: 3 }) },
    { text: 'Insufficient belief' },
  ], renderAlerts() { refreshed = true; } });
  ui.pruneAlerts();
  assert.deepEqual(ui.alerts.map((a: any) => a.text), ['Active threat', 'Insufficient belief']);
  assert.ok(removed && refreshed);
});

test('MAP is hidden by default and the saved preference survives loading settings', () => {
  const g = Object.create(Game.prototype) as any;
  const previous = globalThis.localStorage;
  try {
    globalThis.localStorage = { getItem: () => JSON.stringify({ preset: 'low' }) } as any;
    assert.equal(g.loadSettings('low').showMap, false);
    globalThis.localStorage = { getItem: () => JSON.stringify({ showMap: true }) } as any;
    assert.equal(g.loadSettings('low').showMap, true);
  } finally { globalThis.localStorage = previous; }
});

test('an encounter is a pop-up: Watch shows it (never focusing the map), Later keeps it in the alerts, an expired Watch is harmless', async () => {
  const { JSDOM }=await import('jsdom');const dom=new JSDOM('<body></body>');
  const previous={document:globalThis.document,raf:globalThis.requestAnimationFrame,timeout:globalThis.setTimeout,perf:globalThis.performance};
  try {
    (globalThis as any).document=dom.window.document;(globalThis as any).requestAnimationFrame=(fn:any)=>{fn();return 0;};(globalThis as any).setTimeout=()=>0;
    const { GameDialog }=await import('../src/ui/GameDialog');
    const ui=Object.create(UI.prototype) as any;let watched=0,alive=true;
    const root=document.createElement('div');const dialog=new GameDialog(root);
    Object.assign(ui,{alerts:[],zen:false,dialog,toasts:document.createElement('div'),alertPanel:document.createElement('div'),alertButton:document.createElement('button'),game:{focusAt(){assert.fail('Watch must not focus the map');}}});
    const announce=()=>ui.toast('A dolphin pod is visiting','info',()=>alive?{x:1,z:2}:null,{key:'wildlife-encounter',label:'Watch',noFocus:true,onView:()=>watched++});
    const button=(label:string)=>[...root.querySelectorAll('button')].find(b=>b.textContent===label)!;
    announce();assert.ok(dialog.showing);assert.equal(ui.alertPanel.querySelector('button.obtn')!.textContent,'Watch');
    button('Watch').click();assert.equal(watched,1);assert.equal(ui.alerts.length,0);assert.ok(!dialog.showing);
    announce();alive=false;button('Watch').click();assert.equal(watched,1);assert.equal(ui.alerts.length,0);
    alive=true;announce();button('Later').click();assert.equal(ui.alerts.length,1,'Later keeps it in the alerts');assert.equal(watched,1);
    ui.alertPanel.querySelector('button.obtn')!.click();assert.equal(watched,2);
  }finally{globalThis.document=previous.document;globalThis.requestAnimationFrame=previous.raf;globalThis.setTimeout=previous.timeout;dom.window.close();}
});
