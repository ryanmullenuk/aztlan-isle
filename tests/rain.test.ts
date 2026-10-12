import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RainField } from '../src/render/RainField';
import { WORLD } from '../src/config';

test('rain covers every map quadrant with short fine streaks', () => {
  const rain = new RainField();
  const geometry = rain.lines.geometry;
  const positions = geometry.getAttribute('position');
  const quadrants = [0, 0, 0, 0];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.count; i += 2) {
    const x = positions.getX(i), z = positions.getZ(i);
    quadrants[(x > 0 ? 1 : 0) + (z > 0 ? 2 : 0)]++;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  assert.ok(quadrants.every(n => n > 2000));
  assert.ok(minX < -WORLD.size / 2 && maxX > WORLD.size / 2);
  assert.ok(minZ < -WORLD.size / 2 && maxZ > WORLD.size / 2);
  assert.ok(Array.from(geometry.getAttribute('aLength').array).every(n => n >= 0.19 && n <= 0.43));
});
test('rain fades out when clear and keeps static geometry while falling', () => {
  const rain = new RainField();
  const positions = rain.lines.geometry.getAttribute('position');
  const before = Array.from(positions.array);
  rain.update(1, 0.6, 0);
  assert.equal(rain.lines.visible, true);
  assert.ok((rain.lines.material as THREE.LineBasicMaterial).opacity < 0.3);
  assert.deepEqual(Array.from(positions.array), before);
  rain.update(1, 0, 0); assert.equal(rain.lines.visible, false);
});
test('ordinary rain is light and fine; a storm pours down dense, long and slanting', () => {
  for (const r of [new RainField()] as any[]) {
    r.update(1, 0.6, 0);
    const light = { op: r.lines.material.opacity, d: r.density.value, s: r.stretch.value, sl: r.slant.value };
    r.update(1, 1, 1);
    const storm = { op: r.lines.material.opacity, d: r.density.value, s: r.stretch.value, sl: r.slant.value };
    assert.ok(storm.d >= light.d * 1.8, `denser in a storm (${light.d} → ${storm.d})`);
    assert.ok(storm.s >= light.s * 1.5, 'longer streaks');
    assert.ok(storm.sl > light.sl * 2, 'slanting in the wind');
    assert.ok(storm.op > light.op, 'heavier');
    assert.ok(light.op < 0.3, 'light rain stays faint');
  }

});

test('active rain density stays even over the map while the camera and wind move', () => {
  const rain = new RainField() as any;
  for (const [intensity, storm] of [[.6,0],[1,1]]) {
    const counts = new Array(36).fill(0), span=rain.opts.span;
    rain.update(5,intensity,storm,new THREE.Vector3(65,8,-45));
    assert.deepEqual(rain.center.value.toArray(),[0,0,0], 'map rain must not follow the village/camera');
    const g=rain.lines.geometry,p=g.getAttribute('position'),seeds=g.getAttribute('aSeed');
    for(let i=0;i<p.count;i+=2){
      if(seeds.getX(i)>rain.density.value)continue;
      const x=((p.getX(i)+rain.motion.value.x+span/2)%span+span)%span-span/2,z=p.getZ(i);
      if(Math.abs(x)>=WORLD.size/2||Math.abs(z)>=WORLD.size/2)continue;
      counts[Math.floor((x+WORLD.size/2)/WORLD.size*6)+6*Math.floor((z+WORLD.size/2)/WORLD.size*6)]++;
    }
    const average=counts.reduce((a,b)=>a+b)/counts.length;
    assert.ok(counts.every(n=>n>average*.65&&n<average*1.4),`uneven coverage: ${counts}`);
  }
});

test('weather creates only one rain batch and fades its edges beyond the island', async () => {
  const {Powers}=await import('../src/economy/Powers');
  const previous=globalThis.document;
  try{
    (globalThis as any).document={createElement:()=>({getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){}})})};
    const powers=new Powers({} as any,{} as any,{} as any,{} as any,{} as any,()=>.5) as any;
    const lines=powers.group.children.filter((o:any)=>o.isLineSegments&&o.geometry.hasAttribute('aTail'));
    assert.equal(lines.length,1);assert.equal(powers.rainNear,undefined);
    assert.equal(lines[0].geometry.getAttribute('position').count,48000);
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.basic.vertexShader,fragmentShader:THREE.ShaderLib.basic.fragmentShader} as any;
    lines[0].material.onBeforeCompile(shader,{});
    assert.ok(shader.vertexShader.includes('smoothstep(116.0, 148.0, edge)'));
    assert.ok(shader.fragmentShader.includes('diffuseColor.a *= vRainEdge'));
    assert.ok(116>WORLD.size/2,'edge fade must not reduce rain anywhere on the map');
  }finally{globalThis.document=previous;}
});
