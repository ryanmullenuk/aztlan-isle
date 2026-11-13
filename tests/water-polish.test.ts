import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { IslandReflection, reflectionModeFor } from '../src/water/Reflection';
import { Water, SEA_SURFACE } from '../src/water/Water';
import { WakeTrails } from '../src/entities/Wake';
import { World } from '../src/world/World';

/** A renderer that draws nothing but records what it was asked for (tests run without WebGL). */
function fakeRenderer() {
  const r = {
    target: null as THREE.WebGLRenderTarget | null,
    clearAlpha: 1,
    clearColor: new THREE.Color(0x123456),
    xr: { enabled: false },
    shadowMap: { autoUpdate: true, needsUpdate: true },
    drawn: [] as { cam: THREE.PerspectiveCamera; proj: THREE.Matrix4; view: THREE.Matrix4; target: unknown; background: unknown; hidden: boolean[]; shadows: boolean }[],
    watch: [] as THREE.Object3D[],
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(1600, 900),
    getRenderTarget: () => r.target,
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { r.target = t; },
    getClearAlpha: () => r.clearAlpha,
    getClearColor: (c: THREE.Color) => c.copy(r.clearColor),
    setClearColor: (c: THREE.ColorRepresentation, a = 1) => { r.clearColor.set(c); r.clearAlpha = a; },
    clear: () => {},
    render: (scene: THREE.Scene, cam: THREE.PerspectiveCamera) => {
      r.drawn.push({ cam, proj: cam.projectionMatrix.clone(), view: cam.matrixWorldInverse.clone(), target: r.target, background: scene.background, hidden: r.watch.map((o) => !o.visible), shadows: r.shadowMap.autoUpdate || r.shadowMap.needsUpdate });
    },
  };
  return r;
}

function view(pitchDeg = 50, dist = 60) {
  const cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.5, 900);
  const a = (pitchDeg * Math.PI) / 180;
  cam.position.set(4, Math.sin(a) * dist, Math.cos(a) * dist);
  cam.lookAt(4, 0, 0);
  cam.updateMatrixWorld();
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  return cam;
}

test('graphics presets: a mirrored render on high and ultra, a cheap stand-in on medium, nothing on low', () => {
  assert.equal(reflectionModeFor('ultra'), 'planar');
  assert.equal(reflectionModeFor('high'), 'planar');
  assert.equal(reflectionModeFor('medium'), 'cheap');
  assert.equal(reflectionModeFor('low'), 'off');
  const water = new Water(new World());
  const u = water.oceanMat.uniforms;
  // Until told the preset, only ultra mirrors (phones are never given the extra pass by default).
  assert.equal(water.reflectionMode(), 'off');
  water.shared.uUltra.value = 1;
  assert.equal(water.reflectionMode(), 'planar');
  water.setReflections('medium');
  assert.equal(water.reflectionMode(), 'cheap');
  assert.equal(u.uMirror.value, 1);
  water.setReflections('low');
  assert.equal(u.uMirror.value, 0);
  assert.equal(u.uReflectK.value, 0);
  water.setReflections('high');
  assert.equal(water.reflectionMode(), 'planar');
  assert.equal(water.reflection.every, 2);
  water.setReflections('ultra');
  assert.equal(water.reflection.every, 1);
  // Rivers and canals never hold the mirrored picture (it would be bound while being drawn to).
  for (const m of [water.riverMat, water.canalMat]) {
    assert.notEqual(m.uniforms.uReflect, u.uReflect);
    assert.notEqual(m.uniforms.uReflectK, u.uReflectK);
    assert.equal(m.uniforms.uReflectK.value, 0);
    assert.equal(m.uniforms.uMirror.value, 0);
  }
  assert.equal(typeof water.ocean.onBeforeRender, 'function');
});

test('the mirrored view shows what a ray bounced off the water would hit, and nothing under the surface', () => {
  const uniforms = { uReflect: { value: null as THREE.Texture | null }, uReflectMat: { value: new THREE.Matrix4() }, uReflectK: { value: 0 } };
  const sea = new THREE.Object3D(), scene = new THREE.Scene();
  scene.background = new THREE.Color(0x88aacc);
  const refl = new IslandReflection(uniforms, SEA_SURFACE, [sea]);
  const r = fakeRenderer();
  r.watch = [sea];
  const cam = view();
  const mainTarget = new THREE.WebGLRenderTarget(4, 4);
  r.target = mainTarget;
  refl.render(r as unknown as THREE.WebGLRenderer, scene, cam, 1);
  assert.equal(r.drawn.length, 1);
  assert.ok(uniforms.uReflectK.value > 0.9, 'full strength at an ordinary view');
  assert.ok(uniforms.uReflect.value, 'the picture is handed to the sea');
  const pass = r.drawn[0];
  // Drawn small, with the sea hidden, no backdrop and no second shadow pass; everything put back after.
  assert.deepEqual(pass.hidden, [true]);
  assert.equal(pass.background, null);
  assert.equal(pass.shadows, false);
  assert.notEqual(pass.target, mainTarget);
  assert.ok((pass.target as THREE.WebGLRenderTarget).width <= 1024 && (pass.target as THREE.WebGLRenderTarget).width >= 400);
  assert.equal(r.target, mainTarget);
  assert.equal(sea.visible, true);
  assert.ok(scene.background instanceof THREE.Color);
  assert.equal(r.clearAlpha, 1);
  assert.equal(r.clearColor.getHex(), 0x123456);
  assert.deepEqual([r.shadowMap.autoUpdate, r.shadowMap.needsUpdate], [true, true]);

  // A point on the water, and a point up the ray reflected there, land on the same texel.
  const eye = cam.position.clone();
  const lookup = (p: THREE.Vector3) => {
    const v = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(uniforms.uReflectMat.value);
    return [v.x / v.w, v.y / v.w, v.w];
  };
  for (const [x, z] of [[4, 0], [-10, 8], [20, -15]]) {
    const P = new THREE.Vector3(x, SEA_SURFACE, z);
    const out = P.clone().sub(eye).normalize().reflect(new THREE.Vector3(0, 1, 0));
    const Q = P.clone().addScaledVector(out, 7);
    const a = lookup(P), b = lookup(Q);
    assert.ok(a[2] > 0 && b[2] > 0);
    assert.ok(Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4, `mirror ray (${a}) vs (${b})`);
  }
  // The middle of the view looks itself up near the middle of the picture.
  const mid = lookup(new THREE.Vector3(4, SEA_SURFACE, 0));
  assert.ok(Math.abs(mid[0] - 0.5) < 0.02 && Math.abs(mid[1] - 0.5) < 0.02);
  // The tilted near plane: a palm top is drawn, the sea floor is clipped away.
  const depth = (p: THREE.Vector3) => {
    const v = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(pass.view).applyMatrix4(pass.proj);
    return v.z / v.w;
  };
  assert.ok(Math.abs(depth(new THREE.Vector3(4, 3, -5))) < 1, 'above the water is inside the view');
  assert.ok(depth(new THREE.Vector3(4, -1.5, -5)) < -1, 'below the water is clipped');
  assert.ok(depth(new THREE.Vector3(-12, -0.3, 6)) < -1, 'below the water is clipped');
  for (const e of [...uniforms.uReflectMat.value.elements, ...pass.proj.elements]) assert.ok(Number.isFinite(e));
});

test('the mirror is drawn once a frame at most, less often when asked, and not at all looking straight down', () => {
  const uniforms = { uReflect: { value: null as THREE.Texture | null }, uReflectMat: { value: new THREE.Matrix4() }, uReflectK: { value: 0 } };
  const scene = new THREE.Scene();
  const refl = new IslandReflection(uniforms, SEA_SURFACE, []);
  const r = fakeRenderer(), R = r as unknown as THREE.WebGLRenderer;
  const cam = view();
  refl.render(R, scene, cam, 1);
  refl.render(R, scene, cam, 1);
  assert.equal(r.drawn.length, 1, 'a second draw of the scene in one frame reuses the picture');
  refl.every = 2;
  refl.render(R, scene, cam, 2);
  assert.equal(r.drawn.length, 1, 'every other frame');
  assert.ok(uniforms.uReflectK.value > 0.9, 'the older picture still shows');
  refl.render(R, scene, cam, 3);
  assert.equal(r.drawn.length, 2);
  // Another camera (a time-lapse shot) gets a picture of its own at once.
  const other = view(35, 30);
  refl.render(R, scene, other, 3);
  assert.equal(r.drawn.length, 3);
  // Looking straight down, or from far above, there is nothing worth mirroring.
  const top = view(88, 60);
  refl.render(R, scene, top, 4);
  assert.equal(r.drawn.length, 3);
  assert.equal(uniforms.uReflectK.value, 0);
  assert.equal(IslandReflection.strength(-0.8, 50), 1);
  assert.equal(IslandReflection.strength(-0.8, 200), 0);
  assert.equal(IslandReflection.strength(-0.99, 50), 0);
  // Under the surface (free-roam dipping below) the mirror is off.
  const under = view(50, 60);
  under.position.y = -1;
  under.updateMatrixWorld();
  refl.render(R, scene, under, 5);
  assert.equal(uniforms.uReflectK.value, 0);
  refl.dispose();
  assert.equal(uniforms.uReflect.value, null);
});

test('the sea shader keeps its surf timing and bounds what it adds', () => {
  const water = new Water(new World());
  const f = water.oceanMat.fragmentShader, code = f.replace(/\/\/.*$/gm, '');
  // The swash timing the beach's own shader mirrors is untouched.
  assert.ok(f.includes('float surfP = t * 1.03 + along * 3.14159 + sin(t * 0.17 + along * 2.1) * 0.35;'));
  assert.ok(f.includes('float level = mix(vW.y, -0.03 + (reach + 0.03) * runup, uSwash * inside);'));
  // Breakers, wet sand and both mirrors are there, the costly parts behind their switches.
  for (const part of ['---- Breakers ----', 'if (wK > 0.004)', 'if (uReflectK > 0.001)', 'if (uMirror > 0.5 && uSwash > 0.5 && inside > 0.5 && sd < 4.5)', 'alpha = 0.62 * wet;']) assert.ok(f.includes(part), part);
  // Every pow() has a clamped (or plainly non-negative) base, and the mirrored picture is bounded.
  for (const m of code.matchAll(/pow\(([^;]*)/g)) assert.ok(/^(clamp\(|0\.5 \+ 0\.5 \* sin)/.test(m[1]), `pow base: ${m[0].slice(0, 60)}`);
  assert.ok(f.includes('rf = min(max(rf, vec4(0.0)), vec4(6.0, 6.0, 6.0, 1.0));'));
  // Loops have constant bounds (iOS WebGL2).
  for (const m of f.matchAll(/for \(int \w+ = 0; \w+ < ([^;]+);/g)) assert.ok(/^\d+$/.test(m[1]), m[0]);
  // Boats still ride the same swells.
  assert.ok(Math.abs(water.waveHeight(3, -7, 12.5)) < 0.5);
});

test('a wake has a second, slower pair of arms inside the first, and swimmers leave one too', () => {
  const w = new WakeTrails();
  const boat = { x: 0, z: 0, heading: 0, speed: 2.2 };
  for (let t = 0; t < 2.5; t += 1 / 30) {
    boat.z += boat.speed / 30;
    w.record(boat, 0.75, 0.24, 1, 1);
    w.update(1 / 30);
  }
  const g = w.mesh.geometry;
  const pos = g.getAttribute('position').array as Float32Array, info = g.getAttribute('aWake').array as Float32Array;
  const used = (g.index!.array as Uint32Array).slice(0, g.drawRange.count).reduce((m, v) => Math.max(m, v), 0) + 1;
  let outer = 0, inner = 0, centre = 0, kinds = new Set<number>();
  for (let i = 0; i < used; i++) {
    const kind = info[i * 4 + 3], age = info[i * 4 + 1], out = Math.abs(pos[i * 3]);
    kinds.add(kind);
    assert.ok(age >= 0 && age <= 1 && Math.abs(info[i * 4]) === 1);
    if (age < 0.3 || age > 0.45) continue;
    if (kind === 0) outer = Math.max(outer, out);
    else if (kind === 0.5) inner = Math.max(inner, out);
    else centre = Math.max(centre, out);
  }
  assert.deepEqual([...kinds].sort(), [0, 0.5, 1]);
  assert.ok(outer > inner * 1.5 && inner > centre, `outer ${outer.toFixed(2)} > inner ${inner.toFixed(2)} > centre ${centre.toFixed(2)}`);
  // A swimming animal: its own trail, keyed by the animal.
  const dog = {};
  for (let t = 0, x = 5; t < 1; t += 1 / 30, x += 0.6 / 30) {
    w.swimmer(dog, x, 3, Math.PI / 2, 0.6, 0.5);
    w.update(1 / 30);
  }
  assert.equal(w.count, 2);
  assert.ok(g.drawRange.count > 0);
  assert.ok(Array.from(pos.slice(0, used * 3)).every(Number.isFinite));
});
