import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector2 } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { PostFX } from '../src/render/PostFX';

test('lowering quality reduces real post-processing target sizes and repeated resize is a no-op', () => {
  let ratio = 2;
  const renderer = { getPixelRatio: () => ratio, getSize: (v: Vector2) => v.set(390, 844) } as any;
  const composer = new EffectComposer(renderer);
  const post = Object.create(PostFX.prototype) as any;
  const resolution = new Vector2();
  Object.assign(post, { renderer, composer, width: 0, height: 0, pixelRatio: 0,
    fxaa: { material: { uniforms: { resolution: { value: resolution } } } } });
  let resizes = 0;
  composer.addPass({ setSize() { resizes++; } } as any);
  try {
    post.setSize(390, 844);
    assert.equal(composer.renderTarget1.width, 780);
    assert.equal(composer.renderTarget1.height, 1688);
    ratio = 1;
    post.setSize(390, 844);
    assert.equal(composer.renderTarget1.width, 390);
    assert.equal(composer.renderTarget2.height, 844);
    assert.deepEqual(resolution.toArray(), [1 / 390, 1 / 844]);
    const before = resizes;
    post.setSize(390, 844); post.setSize(390, 844);
    assert.equal(resizes, before, 'duplicate viewport notifications should not resize passes');
    post.setSize(844, 390);
    assert.equal(composer.renderTarget1.width, 844);
    assert.equal(composer.renderTarget1.height, 390);
  } finally { composer.dispose(); }
});
