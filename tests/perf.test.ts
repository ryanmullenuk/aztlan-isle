import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { WORLD } from '../src/config';
import { Vegetation } from '../src/vegetation/Vegetation';
import { GrassTufts } from '../src/vegetation/GrassTufts';
import { Jellyfish } from '../src/entities/Jellyfish';
import { SHADOW_LAYER, frameShadows, setupShadows } from '../src/render/ShadowLayer';
import { View } from '../src/render/View';
import { Terrain } from '../src/terrain/Terrain';

const ctx2d = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: '' };
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

function island(): World {
  const w = new World();
  generateIsland(w, WORLD.islandSeed);
  growIslets(w);
  return w;
}

test('trees and bushes cast shadows from low-detail stand-ins that share their instances; the detailed meshes cast none', () => {
  const veg = new Vegetation(island(), 'low') as any;
  veg.build();
  let proxies = 0;
  for (const [key, cm] of veg.chunks as Map<string, any>) {
    if (!cm.def.lo || !cm.def.shadow) continue;
    assert.equal(cm.mesh.castShadow, false, `${key} still casts its own detailed shadow`);
    assert.ok(cm.shadow, `${key} has no shadow stand-in`);
    assert.equal(cm.shadow.instanceMatrix, cm.mesh.instanceMatrix);
    assert.equal(cm.shadow.count, cm.mesh.count);
    assert.equal(cm.shadow.geometry, cm.def.lo);
    assert.ok(cm.shadow.layers.isEnabled(SHADOW_LAYER) && !cm.shadow.layers.isEnabled(0), 'stand-in visible in the main view');
    proxies++;
  }
  assert.ok(proxies > 20);
});

test('the shadow map is drawn once a frame, seeing the shadow-only layer just while it is drawn', () => {
  const seen: boolean[] = [];
  const shadowMap = { autoUpdate: true, needsUpdate: false, render(_l: unknown, _s: unknown, cam: THREE.Camera) { seen.push(cam.layers.isEnabled(SHADOW_LAYER)); } };
  const renderer = { shadowMap } as unknown as THREE.WebGLRenderer;
  setupShadows(renderer);
  assert.equal(shadowMap.autoUpdate, false);
  frameShadows(renderer);
  assert.equal(shadowMap.needsUpdate, true);
  const cam = new THREE.PerspectiveCamera();
  (shadowMap.render as any)([], new THREE.Scene(), cam);
  assert.deepEqual(seen, [true]);
  assert.equal(cam.layers.isEnabled(SHADOW_LAYER), false, 'main view left seeing the stand-ins');
});

test('jellyfish out of sight are not drawn, and keep drifting in coarse steps', () => {
  const w = island();
  const water = { shared: { uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uDay: { value: 1 } } } as any;
  const J = new Jellyfish(w, water) as any;
  const cam = new THREE.PerspectiveCamera(50, 1.5, 0.5, 400);
  // Looking straight up into the sky: nothing in view.
  cam.position.set(0, 50, 0);
  cam.lookAt(0, 100, 0);
  cam.updateMatrixWorld();
  View.update(cam);
  const before = J.jellies.map((j: any) => j.x + j.z);
  for (let i = 0; i < 120; i++) J.update(1 / 60, null);
  assert.equal(J.mesh.count, 0);
  const after = J.jellies.map((j: any) => j.x + j.z);
  assert.ok(after.some((v: number, i: number) => v !== before[i]), 'off-screen jellies froze');
  // Looking down at a swarm: its jellies are drawn.
  const s = J.swarms[0];
  cam.position.set(s.x + 10, 25, s.z + 10);
  cam.lookAt(s.x, 0, s.z);
  cam.updateMatrixWorld();
  View.update(cam);
  J.update(1 / 60, null);
  assert.ok(J.mesh.count > 0 && J.mesh.count <= J.jellies.length);
});

test('grass is only re-laid when something on the ground has changed', () => {
  const w = island();
  const grass = new GrassTufts(w, 0.3) as any;
  let laid = 0;
  const refresh = grass.refresh.bind(grass);
  grass.refresh = () => { laid++; refresh(); };
  for (let i = 0; i < 10; i++) grass.update(3);
  assert.equal(laid, 0);
  const i = w.idx(w.N >> 1, w.N >> 1);
  w.occ[i] = 3;
  grass.update(3);
  assert.equal(laid, 1);
  w.version++;
  grass.update(3);
  assert.equal(laid, 2);
});

test('the ground casts its shadow from a coarse copy just under it, which follows sculpting', () => {
  const w = island();
  const t = new Terrain(w, 2);
  const parts: any[] = [];
  t.mesh.traverse((o: any) => o.isMesh && parts.push(o));
  const ground = parts.filter((m) => m.name === 'terrain'), shadow = parts.filter((m) => m.name === 'terrain shadow');
  assert.ok(ground.length > 0 && shadow.length === ground.length);
  for (const m of ground) assert.equal(m.castShadow, false);
  for (const m of shadow) {
    assert.ok(m.castShadow && m.layers.isEnabled(SHADOW_LAYER) && !m.layers.isEnabled(0));
  }
  // A fraction of the ground's triangles.
  const tris = (ms: any[]) => ms.reduce((n, m) => n + m.geometry.index.count / 3, 0);
  assert.ok(tris(shadow) * 3 < tris(ground));
  // Just below the surface everywhere, and it follows a reshaped hill.
  const pos = shadow[0].geometry.getAttribute('position');
  const at = (x: number, z: number) => { const v = Math.round(z + w.half) * (w.N + 1) + Math.round(x + w.half); return pos.getY(v); };
  for (const [x, z] of [[0, 0], [-40, -15], [20, 30]]) {
    const d = w.heightAt(x, z) - at(x, z);
    assert.ok(d > 0.05 && d < 0.2, `shadow copy ${d.toFixed(2)} below the ground at ${x},${z}`);
  }
  const [cx, cz] = w.cellOf(0, 0);
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) w.layer[w.idx(cx + dx, cz + dz)] += 3;
  w.computeSmooth(cx - 4, cz - 4, cx + 4, cz + 4);
  t.rebuild(cx - 2, cz - 2, cx + 2, cz + 2);
  const d = w.heightAt(0, 0) - at(0, 0);
  assert.ok(d > 0.05 && d < 0.2, 'shadow copy left behind by sculpting');
});

test('grass far from the camera is not drawn', () => {
  const w = island();
  const grass = new GrassTufts(w, 0.3) as any;
  const cam = new THREE.Vector3(w.meadow.x, 25, w.meadow.z);
  grass.update(0.3, cam, 40);
  const shown = grass.meshes.filter((m: any) => m.visible), hidden = grass.meshes.filter((m: any) => !m.visible);
  assert.ok(shown.length > 0 && hidden.length > 0);
  for (const m of shown) assert.ok(m.boundingSphere.center.distanceTo(cam) - m.boundingSphere.radius < 40);
  grass.update(0.3, cam, Infinity);
  assert.ok(grass.meshes.every((m: any) => m.visible));
});
