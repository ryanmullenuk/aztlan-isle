import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Input } from '../src/ui/Input';
import { Game } from '../src/Game';
import { Water, SEA_SURFACE } from '../src/water/Water';
import { AudioEngine } from '../src/audio/Audio';
import { WORLD } from '../src/config';

test('ocean feedback fires once on contact while tap, pan and pinch controls retain their behaviour', () => {
  globalThis.window = { addEventListener() {} } as any;
  const calls = { press: [] as number[][], tap: 0, pan: 0, zoom: 0, cancel: 0 };
  const input = new Input({ addEventListener() {}, setPointerCapture() {}, clientHeight: 800 } as any,
    { panPixels() { calls.pan++; }, zoom() { calls.zoom++; }, rotate() {}, tilt() {} } as any,
    { onInteract() {}, onPress: (x, y) => calls.press.push([x, y]), onTap() { calls.tap++; },
      onCancel() { calls.cancel++; }, wantsToolDrag: () => false, onHover() {} } as any) as any;
  const event = (id: number, x: number, type = 'touch', button = 0) => ({ pointerId: id, clientX: x, clientY: 200, pointerType: type, button, type: 'pointerup' });
  input.down(event(1, 100)); input.up(event(1, 100));
  assert.equal(calls.tap, 1); assert.deepEqual(calls.press, [[100, 200]]);
  input.down(event(1, 110)); input.move(event(1, 150)); input.up(event(1, 150));
  assert.equal(calls.tap, 1); assert.equal(calls.pan, 1); assert.equal(calls.press.length, 2);
  input.down(event(1, 120)); input.down(event(2, 240)); input.move(event(2, 270));
  input.up(event(2, 270)); input.up(event(1, 120));
  assert.equal(calls.zoom, 1); assert.equal(calls.press.length, 3); assert.equal(calls.tap, 1);
  input.down(event(1, 130, 'mouse', 2)); input.move(event(1, 150, 'mouse', 2)); input.up(event(1, 150, 'mouse', 2));
  assert.equal(calls.press.length, 4); assert.equal(calls.cancel, 0);
  input.enabled = false; input.down(event(1, 100)); assert.equal(calls.press.length, 4);
});

test('ocean hit uses the rendered sea surface and excludes land, beach, sky and outside the sea', () => {
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 2000);
  const point = (x: number, z: number, upward = false) => {
    camera.position.set(x, 10, z + 10); camera.lookAt(x, upward ? 20 : 0, z); camera.updateMatrixWorld();
  };
  point(0, 0);
  const ripples: number[][] = [], sounds: string[] = [];
  let height = -3;
  const game = Object.assign(Object.create(Game.prototype), {
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }) },
    rig: { camera, cur: { dist: 20 } }, ray: new THREE.Raycaster(), ndc: new THREE.Vector2(),
    world: { heightAt: () => height }, water: { tapRipple: (x: number, z: number) => ripples.push([x, z]) },
    audio: { sfx: (name: string) => sounds.push(name) },
  }) as any;
  game.oceanPress(400, 400);
  assert.equal(ripples.length, 1); assert.ok(Math.abs(ripples[0][0]) < 1e-6);
  assert.ok(Math.abs(ripples[0][1] - SEA_SURFACE) < 1e-5);
  assert.deepEqual(sounds, ['waterdrop']);
  height = 2; game.oceanPress(400, 400);
  height = 0; game.oceanPress(400, 400);
  height = -3; point(WORLD.oceanSize, 0); game.oceanPress(400, 400);
  point(0, 0, true); game.oceanPress(400, 400);
  assert.equal(ripples.length, 1); assert.equal(sounds.length, 1);
});

test('repeated taps share the bounded disturbance pool with marine splashes', () => {
  const slots = Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -100, 0));
  const water = Object.assign(Object.create(Water.prototype), { ripSlot: 0, shared: { uRip: { value: slots }, uTime: { value: 8 } } }) as Water;
  for (let n = 0; n < 100; n++) water.tapRipple(n, n + 1);
  assert.equal(slots.length, 6); assert.ok(slots.every(s => s.w === -.85 && s.z === 8));
  assert.ok(slots.some(s => s.x === 99 && s.y === 100));
  water.disturb(5, 6, 1.1); assert.ok(slots.some(s => s.x === 5 && s.y === 6 && s.w === 1.1));
});

test('waterdrop schedules a short droplet through the effects bus and limits rapid sound repeats', () => {
  const engine = new AudioEngine() as any, nodes: any[] = [], bus = {};
  const param = () => ({ value: 0, values: [] as number[], setValueAtTime(v: number) { this.values.push(v); }, exponentialRampToValueAtTime(v: number) { this.values.push(v); } });
  const node = () => {
    const n = { gain: param(), frequency: param(), Q: param(), connect(dest: any) { this.destination = dest; return dest; },
      destination: null as any, start() {}, stops: [] as number[], stop(t: number) { this.stops.push(t); } };
    nodes.push(n); return n;
  };
  engine.sfx('waterdrop'); assert.equal(nodes.length, 0);
  engine.ctx = { state: 'running', currentTime: 0, createOscillator: node, createGain: node, createBufferSource: node, createBiquadFilter: node };
  engine.sfxBus = bus; engine.noise = {};
  engine.sfx('waterdrop');
  assert.equal(nodes.length, 5); assert.deepEqual(nodes[0].frequency.values, [480, 1700]);
  assert.equal(nodes.filter(n => n.destination === bus).length, 2);
  assert.ok(nodes.flatMap(n => n.stops).every(t => t < .2));
  engine.sfx('waterdrop'); assert.equal(nodes.length, 5);
  engine.ctx.currentTime += .1; engine.sfx('waterdrop'); assert.equal(nodes.length, 10);
});
