import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { snapPlacement, placementSlope } from '../src/buildings/Placement';
import { World } from '../src/world/World';
import { BuildingSystem } from '../src/buildings/Buildings';
import { Economy } from '../src/economy/Economy';
import { Game } from '../src/Game';
import { BUILDINGS } from '../src/config';

function setup() {
  const world = new World(); world.layer.fill(2); world.smooth.fill(2);
  const eco = new Economy(); Object.assign(eco.res, { wood: 1000, stone: 1000, belief: 1000 });
  const buildings = new BuildingSystem(world, {} as any, eco, {} as any, new THREE.Scene());
  buildings.list.push({ id: 1, key: 'campfire', label: 'Village campfire', cx: 3, cz: 3, w: 3, d: 3 } as any);
  return { world, eco, buildings };
}

test('snap keeps a valid aim, chooses the nearest valid neighbour and never jumps further than one square', () => {
  const site = { cx: 20, cz: 20, rot: 1 };
  assert.equal(snapPlacement(site, () => true), site);
  assert.deepEqual(snapPlacement(site, s => s.cx === 21 && s.cz === 20), { cx: 21, cz: 20, rot: 1 });
  assert.equal(snapPlacement(site, s => s.cx === 23), site);
});

test('slope indicator distinguishes level land, uneven footprints, rivers and island edges', () => {
  const { world } = setup();
  assert.equal(placementSlope(world, 20, 20, 4, 3), 'Slope: level');
  world.layer[world.idx(23, 22)] = 3;
  assert.match(placementSlope(world, 20, 20, 4, 3), /uneven/);
  world.riverY[world.idx(21, 21)] = 1;
  assert.match(placementSlope(world, 20, 20, 4, 3), /water/);
  assert.match(placementSlope(world, world.N - 1, 20, 4, 3), /outside/);
});

test('blocking feedback identifies buildings, landmarks, slope, water and missing resources', () => {
  const { world, eco, buildings } = setup(), cell = world.idx(20, 20);
  assert.equal(buildings.canPlace('farm', 20, 20, 0).ok, true);
  world.occ[cell] = 8; buildings.list.push({ id: 7, label: 'Pig Pen' } as any);
  assert.match(buildings.canPlace('farm', 20, 20, 0).reason, /overlaps Pig Pen/);
  world.occ[cell] = 0; buildings.list.pop(); world.blockFixed[cell] = 1;
  assert.match(buildings.canPlace('farm', 20, 20, 0).reason, /natural landmark/);
  world.blockFixed[cell] = 0; world.layer[cell] = 3;
  assert.match(buildings.canPlace('farm', 20, 20, 0).reason, /different ground heights/);
  world.layer[cell] = 0;
  assert.match(buildings.canPlace('farm', 20, 20, 0).reason, /Water/);
  world.layer[cell] = 2;
  eco.res.wood = BUILDINGS.farm.cost.wood - 2; eco.res.stone = BUILDINGS.farm.cost.stone - 1;
  assert.match(buildings.canPlace('farm', 20, 20, 0).reason, /2 wood, 1 stone more/);
});

test('footprint preview includes each footprint square and an exact rectangular outline after rotation', () => {
  const { buildings } = setup();
  buildings.showGhost('farm', 20, 20, 0);
  assert.equal((buildings as any).spaceMesh.count, 16);
  buildings.showGhost('stonemason', 20, 20, 1);
  const ghost = (buildings as any).ghost as THREE.Group;
  const outline = ghost.children.find(o => o instanceof THREE.LineLoop) as THREE.LineLoop;
  assert.ok(outline); outline.geometry.computeBoundingBox();
  assert.equal(outline.geometry.boundingBox!.max.x - outline.geometry.boundingBox!.min.x, 4);
  assert.equal(outline.geometry.boundingBox!.max.z - outline.geometry.boundingBox!.min.z, 3);
  assert.equal(ghost.rotation.y, Math.PI / 2);
  assert.ok((buildings as any).spaceMesh.count >= 12);
  buildings.showGhost(null); assert.equal((buildings as any).spaceMesh.visible, false);
});

test('mobile snap can be switched off and rotation changes the footprint dimensions', () => {
  const { world, buildings } = setup();
  const game = { world, buildings, placeRot: 0, touchPlacementActive: true, placementSnap: true, moving: null } as any;
  // Block just the left edge: moving one square to the right makes this site valid.
  world.blockFixed[world.idx(20, 20)] = 1;
  const p = new THREE.Vector3(22 - world.half, 1, 22 - world.half);
  assert.deepEqual((Game.prototype as any).footprintAt.call(game, p, 'farm'), [21, 20, 0]);
  game.placementSnap = false;
  assert.deepEqual((Game.prototype as any).footprintAt.call(game, p, 'farm'), [20, 20, 0]);
  game.placeRot = 1;
  const [cx, cz, rot] = (Game.prototype as any).footprintAt.call(game, p, 'stonemason');
  assert.deepEqual([cx, cz, rot], [21, 20, 1]);
});

test('previewing a move preserves occupancy and permits its original site', () => {
  const { world, buildings } = setup();
  const b = { id: 3, key: 'farm', label: 'Farm', cx: 20, cz: 20, w: 4, d: 4 } as any;
  buildings.list.push(b);
  for (let z = 20; z < 24; z++) for (let x = 20; x < 24; x++) world.occ[world.idx(x, z)] = 4;
  const before = world.occ.slice();
  assert.equal(buildings.canPlace('farm', 20, 20, 0, b).ok, true);
  buildings.showGhost('farm', 20, 20, 0, b);
  assert.deepEqual(world.occ, before);
});
