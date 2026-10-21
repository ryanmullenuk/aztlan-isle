import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { WORLD } from '../src/config';
import { PlantState, Vegetation } from '../src/vegetation/Vegetation';
import { Economy } from '../src/economy/Economy';
import { BuildingSystem } from '../src/buildings/Buildings';
import { Colony } from '../src/ai/Colony';
import { Pathfinder } from '../src/ai/Pathfinder';
import { GameTime } from '../src/world/Time';
import { TOOLBAR, TOOLS } from '../src/ui/tools';

const ctx2d = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: '' };
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

function island() {
  const w = new World();
  generateIsland(w, WORLD.islandSeed);
  growIslets(w);
  const veg = new Vegetation(w, 'low');
  veg.build();
  return { w, veg };
}

test('the toolbar: Move looks around and picks; Select selects an area to clear', () => {
  assert.equal(TOOLS.find((t) => t.id === 'select')!.name, 'Move');
  assert.equal(TOOLS.find((t) => t.id === 'area')!.name, 'Select');
  assert.deepEqual(TOOLBAR.slice(0, 3).map((t) => t.id), ['select', 'area', 'build']);
});

test('an area holds its trees, fallen logs and rocks; ordering it cleared marks each once', () => {
  const { veg } = island();
  const tree = veg.plants.find((p) => p.kind === 'broadleaf' && p.state === PlantState.Alive)!;
  const rock = veg.plants.find((p) => p.kind === 'rock' && p.state === PlantState.Alive && p.amount > 0)!;
  const a = veg.inRect(tree.x - 2, tree.z - 2, tree.x + 2, tree.z + 2);
  assert.ok(a.trees.includes(tree));
  assert.ok([...a.trees, ...a.rocks].every((p) => Math.abs(p.x - tree.x) <= 2 && Math.abs(p.z - tree.z) <= 2), 'only what lies inside');
  // Corners in either order give the same area.
  assert.deepEqual(veg.inRect(tree.x + 2, tree.z + 2, tree.x - 2, tree.z - 2).trees.map((p) => p.id), a.trees.map((p) => p.id));
  const r = veg.inRect(rock.x - 0.5, rock.z - 0.5, rock.x + 0.5, rock.z + 0.5);
  assert.ok(r.rocks.includes(rock));
  assert.equal(veg.orderClearing([tree, rock]), 2);
  assert.equal(veg.orderClearing([tree]), 0, 'already ordered');
  assert.ok(tree.clearing && tree.marked && rock.clearing);
  assert.ok(!veg.cleared(tree) && !veg.cleared(rock));
  // A felled tree is not cleared until its log has been carried off.
  veg.fell(tree, tree.x - 1, tree.z);
  assert.ok(!veg.cleared(tree));
  while (tree.amount > 0) veg.takeWood(tree, 3);
  assert.ok(veg.cleared(tree));
  while (rock.amount > 0 && rock.state === PlantState.Alive) veg.mine(rock, 3);
  assert.ok(veg.cleared(rock));
  // Saved as a flag; the list is rebuilt from the flags on loading.
  veg.clearingIds = [];
  veg.syncClearing();
  assert.deepEqual(veg.clearingIds.sort(), [tree.id, rock.id].sort());
  veg.cancelClearing();
  assert.ok(!tree.clearing && !rock.clearing && !veg.clearingIds.length);
});

test('islanders put a clearing first: a crew fells and quarries it; player orders are left alone', () => {
  const { w, veg } = island();
  const eco = new Economy(); eco.woodCap = eco.foodCap = 1000;
  const bld = new BuildingSystem(w, veg, eco, { updateWear() {} } as any, new THREE.Scene());
  const time = new GameTime();
  const colony = new Colony(w, veg, eco, bld, new Pathfinder(w), time, () => 0.5) as any;
  const tree = veg.plants.find((p) => p.kind === 'broadleaf' && p.state === PlantState.Alive)!;
  const rock = veg.plants.find((p) => p.kind === 'rock' && p.state === PlantState.Alive && p.amount > 0)!;
  const people = [0, 1, 2, 3].map((k) => { const i = colony.spawn(k % 2 ? 'f' : 'm', tree.x + 1 + k * 0.3, tree.z + 1); i.rest = i.hunger = 1; return i; });
  assert.equal(colony.clearWork(people[0]), false, 'nothing to clear yet');
  veg.orderClearing([tree, rock]);
  people[0].role = 'woodcutter';
  assert.equal(colony.clearWork(people[0]), true);
  assert.equal(people[0].task.kind, 'chop'); assert.equal(people[0].task.target, tree.id);
  // The next takes the rock (the tree is already claimed).
  people[1].role = 'farmer';
  assert.equal(colony.clearWork(people[1]), true);
  assert.equal(people[1].task.kind, 'mine'); assert.equal(people[1].task.target, rock.id);
  // A player's own order keeps its islander.
  people[2].manualRole = true;
  assert.equal(colony.clearWork(people[2]), false);
  // Once everything is cleared, the village is told, and ordinary work resumes.
  let told = '';
  colony.hooks.notify = (t: string) => { told = t; };
  colony.releaseTask(people[0]); colony.releaseTask(people[1]);
  veg.fell(tree, tree.x - 1, tree.z); while (tree.amount > 0) veg.takeWood(tree, 3);
  while (rock.amount > 0 && rock.state === PlantState.Alive) veg.mine(rock, 3);
  assert.equal(colony.clearWork(people[3]), false);
  assert.match(told, /cleared/);
  assert.equal(veg.clearingIds.length, 0);
});
