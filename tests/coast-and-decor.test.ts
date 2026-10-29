import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World';
import { Economy } from '../src/economy/Economy';
import { BuildingSystem, DROP_SECONDS } from '../src/buildings/Buildings';
import { Colony } from '../src/ai/Colony';
import { Pathfinder } from '../src/ai/Pathfinder';
import { GameTime } from '../src/world/Time';
import { BUILDINGS, DECOR_KEYS, WORLD } from '../src/config';
import { decorModel, fishHutModel } from '../src/buildings/models';
import { haptic, setHaptics } from '../src/ui/Haptics';
import { islanderLine } from '../src/ui/islanderLines';
import { makeIslander } from '../src/entities/Islander';

/** Flat land for rows below `shore`, shallow sea from there on. */
function setup(shore = 130) {
  const world = new World(); world.seed = WORLD.islandSeed;
  for (let z = 0; z < world.N; z++) for (let x = 0; x < world.N; x++) world.layer[world.idx(x, z)] = z < shore ? 1 : 0;
  world.computeSmooth();
  const eco = new Economy(); eco.woodCap = eco.foodCap = 1000;
  Object.assign(eco.res, { wood: 500, stone: 500, belief: 100, grain: 100 });
  const veg: any = { plants: [], findNearest: () => null, isChoppable: () => false, clearArea: () => 0 };
  const bld = new BuildingSystem(world, veg, eco, { updateWear() {} } as any, new THREE.Scene());
  bld.place('campfire', 100, 110, 0, true);
  return { world, eco, bld };
}

test('a Fisherman’s Hut goes in the shallows with its front to the beach, never on land or facing the sea', () => {
  const { world, bld } = setup();
  // Rot 2 faces -z: the step in front (row 129) is beach.
  assert.equal(bld.canPlace('fishhut', 120, 130, 2).ok, true, bld.canPlace('fishhut', 120, 130, 2).reason);
  assert.equal(bld.canPlace('fishhut', 120, 131, 0).ok, false, 'its door would open onto water');
  assert.match(bld.canPlace('fishhut', 120, 120, 2).reason, /shallow sea water/);
  assert.equal(bld.canPlace('hut', 120, 131, 0).ok, false, 'ordinary houses stay on dry land');
  // Too deep: the stilts can't reach the bottom.
  for (let z = 140; z < 150; z++) for (let x = 118; x < 124; x++) world.layer[world.idx(x, z)] = -2;
  world.computeSmooth();
  assert.match(bld.canPlace('fishhut', 120, 144, 2).reason, /too deep/);
  // Its model: stilts down into the water, the deck above it.
  const m = fishHutModel(world.layerY(0));
  m.finished.computeBoundingBox();
  assert.ok(m.finished.boundingBox!.min.y + world.layerY(0) < -1.3, 'the stilts reach the deepest allowed sea bed');
});

test('fishers move into the Fisherman’s Hut first; everyone else prefers other homes', () => {
  const { world, eco, bld } = setup();
  const hut = bld.place('hut', 110, 120, 0, true);
  const fh = bld.place('fishhut', 120, 130, 2, true);
  const time = new GameTime(); time.t = 0.4;
  const colony = new Colony(world, { plants: [] } as any, eco, bld, new Pathfinder(world), time, () => 0.5);
  const a = colony.spawn('m', hut.door.x, hut.door.z), fisher = colony.spawn('f', hut.door.x, hut.door.z);
  fisher.role = 'fisher';
  // The fisher starts out in the ordinary hut.
  fisher.home = hut.id; hut.residents.push(fisher.id);
  (colony as any).assignHousing();
  assert.equal(fisher.home, fh.id, 'the fisher moved to the water');
  assert.equal(a.home, hut.id, 'the non-fisher took the hut');
  assert.ok(!hut.residents.includes(fisher.id));
});

test('banners and flags are decorations: cheap, passable, swaying cloth, and they save by key', () => {
  const { world, bld } = setup();
  for (const key of DECOR_KEYS) {
    const def = BUILDINGS[key];
    assert.equal(def.workers, 0);
    const m = decorModel(key);
    const sway = m.finished.getAttribute('aVeg');
    let moving = 0;
    for (let i = 0; i < sway.count; i++) if (sway.getX(i) > 0) moving++;
    assert.ok(moving > 8, `${key} has cloth that moves in the wind`);
  }
  const b = bld.place('bannersun', 105, 112, 0, true);
  assert.ok(world.passable(b.id), 'islanders walk past a banner');
  assert.equal(world.doorways.has(b.id), false);
});

test('nothing can be built across another building’s doorstep', () => {
  const { bld } = setup();
  bld.place('home', 110, 115, 0, true); // 3x3, door faces +z: the step is (111, 118)
  assert.match(bld.canPlace('torch', 111, 118, 0).reason, /block the doorway of Home/);
  assert.equal(bld.canPlace('torch', 109, 118, 0).ok, true, 'beside the doorstep is fine');
});

test('a placed foundation drops into place and lands once, back exactly at its height', () => {
  const { bld } = setup();
  let landed = 0;
  bld.onLanded = () => landed++;
  const b = bld.place('hut', 110, 115, 0);
  assert.ok(b.drop > 0);
  for (let t = 0; t < DROP_SECONDS + 0.2; t += 1 / 60) bld.updateDrops(1 / 60);
  assert.equal(landed, 1);
  assert.equal(b.group.position.y, b.y);
  const instant = bld.place('hut', 116, 115, 0, true);
  assert.equal(instant.drop, 0, 'restored and instant buildings just appear');
});

test('haptics: a tap goes to the app bridge when there is one, never when switched off, and never throws', () => {
  const sent: string[] = [];
  (globalThis as any).webkit = { messageHandlers: { haptic: { postMessage: (k: string) => sent.push(k) } } };
  setHaptics(true);
  haptic('light');
  haptic('medium'); // too soon after the last: dropped
  setHaptics(false);
  haptic('success');
  delete (globalThis as any).webkit;
  setHaptics(true);
  assert.deepEqual(sent, ['light']);
  assert.doesNotThrow(() => haptic('medium'));
});

test('islander lines suit what they are doing and never repeat back to back', () => {
  const isl = makeIslander(3, 'Tochtli', 'm', 0, 0, () => 0.5);
  isl.role = 'fisher';
  assert.match(islanderLine(isl, 'Chopping wood', 0), /.+/);
  let last = '';
  // Sampled once a beat: each new line differs from the one before.
  for (let t = 0; t < 400; t += 9) {
    const line = islanderLine(isl, 'Thinking', t);
    if (last) assert.notEqual(line, last);
    last = line;
  }
  // Within one beat the line holds (the card can redraw without it changing).
  assert.equal(islanderLine(isl, 'Thinking', 100), islanderLine(isl, 'Thinking', 100.5));
});
