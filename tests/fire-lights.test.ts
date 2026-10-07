import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FireLights, FIRE_LIGHTS, FireSpot } from '../src/buildings/FireLights';
import { View } from '../src/render/View';

function look(x: number, z: number): THREE.Vector3 {
  const cam = new THREE.PerspectiveCamera(50, 1.5, 0.5, 400);
  cam.position.set(x + 15, 25, z + 15);
  cam.lookAt(x, 0, z);
  cam.updateMatrixWorld();
  View.update(cam);
  return new THREE.Vector3(x, 0, z);
}

test('firelight: every fire glows, real lights stay with their fires and fade rather than pop', () => {
  const fires: FireSpot[] = [];
  for (let i = 0; i < 30; i++) fires.push({ key: `f${i}`, pos: new THREE.Vector3((i % 6) * 4, 0.3, Math.floor(i / 6) * 4), ground: 0, big: i % 7 === 0 });
  const F = new FireLights() as any;
  let target = look(8, 8);
  for (let i = 0; i < 60; i++) F.update(1 / 30, i / 30, 1, fires, target);
  assert.equal(F.glow.count, fires.length, 'a fire without its glow');
  assert.equal(F.lights.filter((l: any) => l.level === 1).length, FIRE_LIGHTS);
  const before = F.lights.map((l: any) => l.key);
  // A small nudge of the camera does not reshuffle the lights.
  target = look(8.5, 8.3);
  for (let i = 0; i < 30; i++) F.update(1 / 30, 2 + i / 30, 1, fires, target);
  assert.deepEqual(F.lights.map((l: any) => l.key), before);
  // Panning far away: lights move on, but never jump in brightness from one frame to the next.
  let prev = F.lights.map((l: any) => l.light.intensity);
  target = look(20, 16);
  for (let i = 0; i < 90; i++) {
    F.update(1 / 30, 3 + i / 30, 1, fires, target);
    F.lights.forEach((l: any, j: number) => assert.ok(Math.abs(l.light.intensity - prev[j]) < 0.5, 'a light popped'));
    prev = F.lights.map((l: any) => l.light.intensity);
  }
  assert.notDeepEqual(F.lights.map((l: any) => l.key), before, 'lights never followed the view');
  // By day everything is dark.
  for (let i = 0; i < 30; i++) F.update(1 / 30, 6 + i / 30, 0, fires, target);
  assert.equal(F.glowMat.uniforms.uNight.value, 0);
  assert.ok(F.lights.every((l: any) => l.light.intensity === 0));
  // Dimmed, never hidden: a change in the number of visible lights recompiles every lit shader.
  assert.ok(F.lights.every((l: any) => l.light.visible), 'a light was hidden');
});
