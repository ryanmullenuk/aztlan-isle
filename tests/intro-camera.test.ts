import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/Game';

test('new-game camera holds overview, flies to moving canoe and hands control back', () => {
  const g = Object.create(Game.prototype) as any;
  g.playing = false; g.introFollow = true;
  g.clock = { reset() {} };
  g.rig = { maxDist: 300, camera: { aspect: 0.5 }, goal: {}, jumpTo(x: number,z: number,dist: number,yaw: number) { this.goal = {x,z,dist,yaw}; } };
  g.boats = { arrivalPos: { x: 80, z: 60 } }; g.input = { navigating: false };
  g.play(); assert.equal(g.rig.goal.dist, 312);
  g.updateIntroCamera(1); assert.equal(g.rig.goal.x, 0);
  g.updateIntroCamera(3.2); assert.ok(g.rig.goal.dist > 30 && g.rig.goal.dist < 312);
  g.boats.arrivalPos = { x: 65, z: 45 };
  g.updateIntroCamera(3); assert.equal(g.rig.goal.x, 65); assert.equal(g.rig.goal.dist, 30);
  g.input.navigating = true; g.updateIntroCamera(0.1); assert.equal(g.introFollow, false);
});
