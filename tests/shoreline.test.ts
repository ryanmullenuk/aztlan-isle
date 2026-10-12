import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildShoreField, SHORE_SURF_GLSL } from '../src/water/Shoreline';
import { Water } from '../src/water/Water';
import { World } from '../src/world/World';

function field(bay = false, steep = false) {
  const size = 100, height = new Float32Array(size * size), distance = new Float32Array(size * size);
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const land = x < 20 || (bay && (z < 43 || z > 57));
    height[z * size + x] = land ? .3 : steep ? -3 : -.1 - (x - 20) * .04;
    distance[z * size + x] = land ? 0 : Math.min(x - 19, bay ? Math.min(z - 42, 58 - z) : 100);
  }
  const out = new Uint8Array(size * size * 4); buildShoreField(height, distance, size, out);
  const at = (x: number, z: number) => Array.from(out.slice((z * size + x) * 4, (z * size + x) * 4 + 4));
  return { size, height, distance, out, at };
}

test('shore directions follow coastline and sheltered bays have less exposure', () => {
  const open = field(), bay = field(true);
  assert.ok(open.at(25,50)[0] > 250); assert.ok(Math.abs(open.at(25,50)[1] - 128) < 2);
  assert.ok(open.at(25,50)[2] > bay.at(25,50)[2] * 2);
  const height = new Float32Array(open.height.length), distance = new Float32Array(height.length);
  for(let z=0;z<open.size;z++)for(let x=0;x<open.size;x++){
    height[z*open.size+x]=open.height[x*open.size+z];distance[z*open.size+x]=open.distance[x*open.size+z];
  }
  const out = new Uint8Array(height.length*4);buildShoreField(height,distance,open.size,out);
  assert.ok(out[(25*open.size+50)*4+1]>250, 'rotated coast did not rotate wave direction');
});

test('cliffs, channel centres, dry land and map edges have bounded, stable surf data', () => {
  const gentle = field(), cliff = field(false,true);
  assert.ok(cliff.at(20,50)[3] > gentle.at(20,50)[3]);
  assert.deepEqual(cliff.at(0,0),[128,128,0,255]);
  for(const value of cliff.out) assert.ok(Number.isFinite(value));
  const size=12, h=new Float32Array(size*size).fill(-2), d=new Float32Array(size*size).fill(40), out=new Uint8Array(size*size*4);
  buildShoreField(h,d,size,out);assert.ok(Array.from(out).every(Number.isFinite));
  assert.equal(out[2],0,'far water must not invent coastal exposure');
});

test('local shoreline refresh matches a full refresh around changed coast and shelters', () => {
  const f = field(), before = f.out.slice();
  // A new coastal rock/peninsula blocks the open water directly ahead.
  for(let z=44;z<57;z++)for(let x=32;x<35;x++)f.height[z*f.size+x]=.5;
  buildShoreField(f.height,f.distance,f.size,f.out,[0,0,90,99]);
  const full=new Uint8Array(f.out.length);buildShoreField(f.height,f.distance,f.size,full);
  assert.deepEqual(f.out,full);assert.notEqual(f.at(25,50)[2],before[(50*f.size+25)*4+2]);
});

test('water terrain edits refresh shared surf data without adding draw objects or frame work', () => {
  const w=new World();w.layer.fill(-3);
  for(let z=0;z<w.N;z++)for(let x=0;x<w.N/2;x++)w.layer[w.idx(x,z)]=1;
  w.computeSmooth(); const water=new Water(w), system=water as any;
  const meshes=water.group.children.length, texture=water.shoreTex, old=system.shoreData.slice();
  for(let z=98;z<=102;z++)for(let x=100;x<=106;x++)w.layer[w.idx(x,z)]=2;
  w.computeSmooth();water.updateHeight(98,96,109,105);
  assert.notDeepEqual(system.shoreData,old);
  const complete = new Uint8Array(system.shoreData.length);
  buildShoreField(system.heightF,system.shoreD,system.res,complete);
  assert.deepEqual(system.shoreData,complete,'sculpt refresh left stale shoreline data');
  assert.equal(water.shoreTex,texture);assert.equal(water.oceanMat.uniforms.uShore.value,texture);
  const version=texture.version;water.update(0,10);water.update(1/60,10);water.shared.uStorm.value=1;water.update(1/60,10.1);
  assert.equal(texture.version,version,'regular frames must not recompute the shoreline');
  assert.equal(water.group.children.length,meshes);
  assert.equal(texture.image.data.length,400*400*4);
  assert.ok(SHORE_SURF_GLSL.includes('smoothstep'));
  assert.ok(water.oceanMat.fragmentShader.includes('foam *= step(bed, level)'));
  assert.ok(water.oceanMat.fragmentShader.includes('uStorm * exposure * 0.5'));
  assert.ok(water.oceanMat.fragmentShader.includes('fw * spacing'));
  for(const mat of [water.oceanMat,water.riverMat,water.canalMat]){
    assert.ok(mat.fragmentShader.includes('shorePulse'));assert.ok(mat.fragmentShader.includes('wet ='));
  }
});
