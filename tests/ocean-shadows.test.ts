import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { oceanShadowStrength, patchOceanShadows, fadeOceanShadows } from '../src/render/OceanShadows';
import { SEA_SURFACE } from '../src/water/Water';

test('shadows retain land contrast, lighten smoothly in shallows and vanish at depth', () => {
  assert.equal(oceanShadowStrength(2), 1);
  assert.equal(oceanShadowStrength(SEA_SURFACE), 1);
  assert.ok(oceanShadowStrength(SEA_SURFACE - .3) < .46);
  assert.equal(oceanShadowStrength(SEA_SURFACE - 1.5), 0);
  assert.equal(oceanShadowStrength(-6), 0);
  let previous = 1;
  for (let depth = 0; depth < 3; depth += .01) {
    const strength = oceanShadowStrength(SEA_SURFACE - depth);
    assert.ok(strength <= previous && strength >= 0);
    assert.ok(previous - strength < .04); previous = strength;
  }
});

test('shadow shader retains prior patches, all light types and distinct material cache keys', () => {
  const mat = new THREE.MeshStandardMaterial();
  mat.onBeforeCompile = shader => { shader.fragmentShader += '\n// prior terrain patch'; };
  mat.customProgramCacheKey = () => 'terrain-original';
  patchOceanShadows(mat); const key = mat.customProgramCacheKey(); patchOceanShadows(mat);
  assert.equal(key, mat.customProgramCacheKey()); assert.ok(key.startsWith('terrain-original'));
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  mat.onBeforeCompile(shader as any, {} as any);
  assert.ok(shader.vertexShader.includes('instanceMatrix * oceanShadowWorld'));
  assert.ok(shader.fragmentShader.includes('// prior terrain patch'));
  assert.equal((shader.fragmentShader.match(/directLight.color \*= mix\(1.0/g) ?? []).length, 4);
  assert.ok(shader.fragmentShader.includes('getPointShadow')); assert.ok(shader.fragmentShader.includes('getSunShadow'));
  const other = new THREE.MeshStandardMaterial(); other.customProgramCacheKey = () => 'rocks-original'; patchOceanShadows(other);
  assert.notEqual(other.customProgramCacheKey(), key);
});

test('only shadow receivers are patched; sea floor and terrain use depth fading without altering unlit water', () => {
  const scene = new THREE.Group(), landMat = new THREE.MeshStandardMaterial(), unlit = new THREE.ShaderMaterial();
  const terrain = new THREE.Mesh(new THREE.PlaneGeometry(), landMat); terrain.receiveShadow = true;
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(), unlit); ocean.receiveShadow = true;
  scene.add(terrain, ocean); const original = unlit.onBeforeCompile;
  fadeOceanShadows(scene);
  assert.ok(landMat.customProgramCacheKey().endsWith('ocean-shadow-fade-v1'));
  assert.equal(unlit.onBeforeCompile, original);
});
