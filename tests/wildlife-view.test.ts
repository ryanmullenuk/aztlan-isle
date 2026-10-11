import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraRig } from '../src/render/CameraRig';
import { WildlifeView, type WildlifeSubject } from '../src/render/WildlifeView';
import { Input } from '../src/ui/Input';
import { Game } from '../src/Game';
import { MARINE } from '../src/config';

function setup() {
  const classes = new Set<string>();
  const classList = { add: (s: string) => classes.add(s), remove: (s: string) => classes.delete(s) };
  const nodes: Record<string, any> = {};
  (globalThis as any).document = { body: { classList, appendChild() {} }, createElement: () => ({
    classList, querySelector: (s: string) => nodes[s] ??= { setAttribute(k: string, v: string) { this[k] = v; } },
  }) };
  const rig = new CameraRig(1, { N: 100, heightAt: () => 0 } as any);
  rig.jumpTo(20, 30, 60);
  let alive = true;
  const p = new THREE.Vector3(2, 3, 4);
  let subjects: WildlifeSubject[] = [{ id: 'pig', name: 'Pig', distance: 10, position: () => alive ? p.clone() : null }];
  let exits = 0;
  const view = new WildlifeView(rig, () => subjects, () => { exits++; view.exit(); });
  return { rig, view, p, classes, nodes, die: () => alive = false, setSubjects: (s: WildlifeSubject[]) => subjects = s, exits: () => exits };
}

test('cinematic follow tracks a moving creature in three dimensions and restores the previous view', () => {
  const h = setup(), goal = { ...h.rig.goal }, cur = { ...h.rig.cur };
  assert.equal(h.view.enter(), true);
  assert.ok(h.classes.has('watching-wildlife'));
  assert.equal(h.nodes['.wildlife-name'].textContent, 'Pig');
  h.p.set(8, 12, 16); h.view.update(); h.rig.update(1);
  assert.equal(h.rig.goal.x, 8); assert.equal(h.rig.goal.z, 16);
  assert.ok(Math.abs(h.rig.target.y - 12) < 0.7);
  h.view.exit();
  assert.equal(h.rig.cinematicTarget, null);
  assert.deepEqual(h.rig.goal, goal); assert.deepEqual(h.rig.cur, cur);
  assert.ok(!h.classes.has('watching-wildlife'));
});

test('drag, keys and cursor zoom orbit and zoom without panning off the subject', () => {
  const { rig, view } = setup(); view.enter(); rig.update(1);
  const x = rig.goal.x, z = rig.goal.z, yaw = rig.goal.yaw, dist = rig.goal.dist;
  rig.panPixels(100, 30, 800); rig.panKeys(1, 1, 0.1); rig.zoom(0.8, { x: 90, z: 90 });
  assert.equal(rig.goal.x, x); assert.equal(rig.goal.z, z);
  assert.notEqual(rig.goal.yaw, yaw); assert.notEqual(rig.goal.tilt, 0);
  assert.equal(rig.goal.dist, dist * 0.8);
});

test('next chooses another available individual and automatically exits if all creatures disappear', () => {
  const h = setup(); h.view.enter();
  h.setSubjects([{ id: 'pig', name: 'Pig', distance: 10, position: () => h.p },
    { id: 'monkey', name: 'Monkey', distance: 12, position: () => new THREE.Vector3(9, 20, 9) }]);
  h.view.next(); assert.equal(h.nodes['.wildlife-name'].textContent, 'Monkey');
  h.setSubjects([]); h.view.next(); assert.equal(h.exits(), 1); assert.equal(h.view.active, false);
  h.setSubjects([]); assert.equal(h.view.enter(), false); assert.equal(h.rig.cinematicTarget, null);
  const dead = setup(); dead.view.enter(); dead.die(); dead.view.update();
  assert.equal(dead.exits(), 1); assert.equal(dead.view.active, false);
});

test('viewing disables world taps, pointer reactions and gameplay shortcuts', () => {
  const game = { wildlifeView: { active: true }, cursorActive: true, toggleWildlife() { this.wildlifeView.active = false; } } as any;
  // A missing pickGround would throw if any world action were reached.
  (Game.prototype as any).onTap.call(game, 0, 0);
  (Game.prototype as any).onHover.call(game, 0, 0); assert.equal(game.cursorActive, false);
  for (const key of ['1', '6', 'r', ' ', 'o', 'v']) (Game.prototype as any).onKey.call(game, { key });
  (Game.prototype as any).onKey.call(game, { key: 'Escape' }); assert.equal(game.wildlifeView.active, false);
});

test('single-finger cinematic dragging uses orbit even if a placement tool is pending', () => {
  (globalThis as any).window = { addEventListener() {} };
  const { rig, view } = setup(); view.enter();
  let placed = 0, sculpted = 0;
  const input = new Input({ addEventListener() {}, setPointerCapture() {}, clientHeight: 800 } as any, rig, {
    onInteract() {}, wantsPlacementDrag: () => true, wantsToolDrag: () => true,
    onPlacementDrag: () => placed++, onToolDragStart: () => sculpted++, onHover() {},
  } as any) as any;
  const e = { pointerId: 1, clientX: 20, clientY: 20, pointerType: 'touch', button: 0 };
  input.down(e); input.move({ ...e, clientX: 50, clientY: 50 });
  assert.equal(placed, 0); assert.equal(sculpted, 0); assert.equal(input.dragging, 'orbit');
  assert.notEqual(rig.goal.tilt, 0);
});

test('all humpbacks use a base length 50 percent larger, including the calf', () => {
  assert.ok(Math.abs(MARINE.whaleLength / 7.8 - 1.5) < 1e-12);
});


test('tour switches species after 20 real seconds, supports manual next and resets on exit', () => {
  const h = setup(); h.view.enter();
  h.setSubjects([{ id: 'pig', name: 'Pig', distance: 10, position: () => h.p },
    { id: 'bird', name: 'Toucan', distance: 9, position: () => h.p }]);
  h.view.toggleTour(); h.view.update(19);
  assert.equal(h.nodes['.wildlife-name'].textContent, 'Pig');
  h.view.update(1); assert.equal(h.nodes['.wildlife-name'].textContent, 'Toucan');
  h.view.update(19); h.view.next(); h.view.update(1);
  assert.equal(h.nodes['.wildlife-name'].textContent, 'Pig');
  h.view.toggleTour(); h.view.update(40);
  assert.equal(h.nodes['.wildlife-name'].textContent, 'Pig');
  h.view.toggleTour(); h.view.exit();
  assert.equal(h.view.tourRunning, false);
  assert.equal(h.nodes['[data-action="tour"]']['aria-pressed'], 'false');
});

test('new wildlife candidates expose live behaviour and unavailable jaguars are excluded', () => {
  const bird = { x: 1, y: 5, z: 2, state: 'fly', act: 0 };
  const jaguar = { id: 1, x: 1, y: 0, z: 2, scale: 1, state: 'prowl' };
  const game = { wildlife: { animals: { list: [] }, monkeys: { list: [] },
    birds: { gulls: [bird], toucans: [bird] }, sharks: { sharks: [{ x: 1, y: -2, z: 2, pod: 0 }], pods: [{ state: 'chase' }] } },
    waterBirds: { list: [{ ...bird, id: 1, kind: 'heron', state: 'strike' }] },
    turtles: { list: [{ ...bird, state: 'crawl' }] }, jaguars: { list: [jaguar] },
    marine: { whales: [], dolphinSubjects: [] } };
  const subjects = (Game.prototype as any).wildlifeSubjects.call(game) as WildlifeSubject[];
  assert.deepEqual(subjects.map(s => s.name), ['Seagull', 'Toucan', 'Heron', 'Sea turtle', 'Scalloped hammerhead', 'Jaguar']);
  assert.equal(subjects[4].behaviour!(), 'Chasing fish');
  const h = setup(); h.setSubjects([subjects[0]]); h.view.enter();
  assert.equal(h.nodes['.wildlife-behaviour'].textContent, 'Flying');
  bird.state = 'ground'; bird.act = 3; h.view.update();
  assert.equal(h.nodes['.wildlife-behaviour'].textContent, 'Preening');
  jaguar.state = 'dead'; assert.equal(subjects[5].position(), null);
});
