import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { UI } from '../src/ui/UI';
import { Game } from '../src/Game';
import { SAVE } from '../src/config';

function setup() {
  const dom = new JSDOM('<body><button id="gear">Settings</button><div id="hud"></div></body>', {url:'https://aztlan.test'});
  Object.assign(globalThis, {document:dom.window.document, window:dom.window, localStorage:dom.window.localStorage});
  const game:any = { settings:(Game.prototype as any).loadSettings('medium'), islandName:'Aztlan',
    eco:{godMode:false}, setIslandName(name:string){this.islandName=name;return {};},
    applySettings(){localStorage.setItem(SAVE.settingsKey,JSON.stringify(this.settings));},
    save(){this.saved=true;}, newIsland(sandbox=false){this.newMode=sandbox?'sandbox':'normal';} };
  const ui:any=Object.create(UI.prototype);
  Object.assign(ui,{game,root:document.querySelector('#hud'),isleNameEl:document.createElement('span'),
    mapWrap:document.createElement('div'),minimap:document.createElement('div'),
    help:document.createElement('div'),toast(){},startTutorial(){this.tutorialStarted=true;}});
  ui.mapWrap.appendChild(document.createElement('button'));
  ui.buildSettings();
  const q=(selector:string)=>ui.settings.querySelector(selector) as any;
  return {dom,game,ui,q};
}

test('settings tabs show one category at a time and retain controls when navigating',()=>{
  const {q}=setup();
  assert.equal(q('#settings-game').hidden,false);
  assert.equal(q('#settings-graphics').hidden,true);
  q('#settings-tab-sound').click();
  assert.equal(q('#settings-game').hidden,true);
  assert.equal(q('#settings-sound').hidden,false);
  const input=q('[data-k="volume"]');input.value='.4';input.dispatchEvent(new window.Event('input'));
  q('#settings-tab-game').click();q('#settings-tab-sound').click();
  assert.equal(q('[data-k="volume"]'),input);assert.equal(input.value,'0.4');
  assert.equal(q('[data-value="volume"]').value,'40%');
  assert.equal(q('#settings-graphics details').open,false);
  assert.equal(q('.settings-new').open,false);
});

test('Sound switch inverts mute correctly and chatter preference persists across reload',()=>{
  const {game,q}=setup(),sound=q('[data-k="muted"]'),chatter=q('[data-k="chatter"]');
  assert.equal(sound.checked,true);sound.checked=false;sound.dispatchEvent(new window.Event('input'));
  assert.equal(game.settings.muted,true);
  chatter.checked=false;chatter.dispatchEvent(new window.Event('input'));
  assert.equal((Game.prototype as any).loadSettings('medium').chatter,false);
  localStorage.setItem(SAVE.settingsKey,JSON.stringify({preset:'low',volume:.25}));
  assert.equal((Game.prototype as any).loadSettings('medium').chatter,true);
});

test('all existing settings remain available, auto-quality updates sync on reopen and blur depends on depth of field',()=>{
  const {ui,game,q}=setup();
  for(const key of ['shadows','dayNight','weather','motion','motionRes','pixel','dof','dofStrength','muted','volume','music','showMap','fps','instantBuild','autoQuality'])assert.ok(q(`[data-k="${key}"]`));
  const dof=q('[data-k="dof"]');dof.checked=false;dof.dispatchEvent(new window.Event('input'));
  assert.equal(q('[data-k="dofStrength"]').disabled,true);
  game.settings.preset='low';game.settings.muted=true;ui.toggle(ui.settings,true);
  assert.equal(q('[data-k="preset"]').value,'low');assert.equal(q('[data-k="muted"]').checked,false);
  const preset=q('[data-k="preset"]');preset.value='high';preset.dispatchEvent(new window.Event('change'));
  assert.equal(game.settings.autoQuality,false);assert.equal(game.settings.renderScale,1);
  assert.equal(q('[data-k="autoQuality"]').checked,false);
});

test('save/help/new-game handlers survive layout change and new games retain confirmation',()=>{
  const {ui,game,q}=setup();
  q('[data-a="save"]').click();assert.equal(game.saved,true);
  for(const name of ['copy','load','rename'])assert.equal(typeof q(`[data-a="${name}"]`).onclick,'function');
  (globalThis as any).confirm=()=>false;q('[data-a="new"]').click();assert.equal(game.newMode,undefined);
  (globalThis as any).confirm=()=>true;q('[data-a="sandbox"]').click();assert.equal(game.newMode,'sandbox');
  q('[data-a="tutorial"]').click();assert.equal(ui.tutorialStarted,true);
});

test('keyboard tabs, modal focus and Escape work without firing gameplay shortcuts',()=>{
  const {ui,q,dom}=setup(),gear=document.querySelector<HTMLButtonElement>('#gear')!;
  gear.focus();ui.toggle(ui.settings,true);
  const game=q('#settings-tab-game');assert.equal(document.activeElement,game);
  let leaked=0;window.addEventListener('keydown',()=>leaked++);
  game.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  assert.equal(document.activeElement,q('#settings-tab-graphics'));assert.equal(q('#settings-graphics').hidden,false);
  q('[data-a="return"]').focus();q('[data-a="return"]').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true}));
  assert.equal(document.activeElement,q('[data-a="close"]'));
  q('[data-a="close"]').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(ui.settings.classList.contains('hidden'),true);assert.equal(document.activeElement,gear);assert.equal(leaked,0);
});
