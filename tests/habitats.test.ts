import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Coral } from '../src/entities/Coral';
import { TubeCoral } from '../src/entities/TubeCoral';
import { ReefFish } from '../src/entities/ReefFish';
import { World } from '../src/world/World';
import { habitatFit, habitatMaterial } from '../src/entities/Habitat';
import { View } from '../src/render/View';

function world(seed=7){const w=new World();w.seed=seed;w.layer.fill(-2);w.computeSmooth();return w;}
const snapshot=(c:Coral)=>c.group.children.map(o=>{const m=o as THREE.InstancedMesh;return {name:m.name,count:m.count,matrices:Array.from(m.instanceMatrix.array.slice(0,m.count*16))};});

test('seeded seagrass drifts and small coral groups retain their identities across restoration',()=>{
 const w=world(),a=new Coral(w,[{x:3,z:4}]),b=new Coral(world(),[{x:3,z:4}]);
 assert.deepEqual(a.patches,b.patches);assert.deepEqual(a.grassPatches,b.grassPatches);assert.deepEqual(snapshot(a),snapshot(b));
 assert.ok(a.grassPatches.length>10);assert.ok(a.group.children.some(o=>o.name==='habitat-weed'&&(o as THREE.InstancedMesh).count>0));
 const scales=new Set<number>();for(const o of a.group.children){const m=o as THREE.InstancedMesh,mat=new THREE.Matrix4(),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();
  for(let k=0;k<m.count;k++){m.getMatrixAt(k,mat);mat.decompose(p,q,s);scales.add(+s.y.toFixed(2));assert.ok(p.y<-.35);}}
 assert.ok(scales.size>10,'patches need varied heights');
});

test('habitats reject steep, dry, deep and obstructed beds, and keep their tops submerged',()=>{
 const w=world();assert.ok(habitatFit(w,0,0,.4)>0);
 w.heightAt=()=>.1;assert.equal(habitatFit(w,0,0,.4),0);
 w.heightAt=()=>-4;assert.equal(habitatFit(w,0,0,.4),0);
 w.heightAt=(x)=>x>0?-2:-.4;assert.equal(habitatFit(w,0,0,.4),0);
 w.heightAt=()=>-.4;const fit=habitatFit(w,0,0,1);assert.ok(-.4+fit<=.07-.12);
 w.blockFixed[w.cellIndexAt(0,0)]=1;assert.equal(habitatFit(w,0,0,.4),0);
});

test('local seabed changes hide and restore candidates, matching a reloaded edited island',()=>{
 const w=world(),c=new Coral(w);const initial=snapshot(c),point=c.grassPatches[0],cell=w.cellOf(point.x,point.z);
 for(let z=cell[1]-4;z<=cell[1]+4;z++)for(let x=cell[0]-4;x<=cell[0]+4;x++)if(w.inBounds(x,z))w.layer[w.idx(x,z)]=2;
 w.computeSmooth();c.refresh(cell[0]-6,cell[1]-6,cell[0]+6,cell[1]+6);
 assert.notDeepEqual(snapshot(c),initial);assert.deepEqual(snapshot(c),snapshot(new Coral(w)));
 w.layer.fill(-2);w.computeSmooth();c.refresh(cell[0]-6,cell[1]-6,cell[0]+6,cell[1]+6);assert.deepEqual(snapshot(c),initial);
});

test('underwater shader uses gentle root-weighted currents and soft depth/distance fading with presets',()=>{
 const c=new Coral(world());c.setPreset('low');
 const mat=(c.group.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
 assert.equal(mat.userData.habitatRange.value,24);c.setPreset('ultra');assert.equal(mat.userData.habitatRange.value,60);
 const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
 habitatMaterial().onBeforeCompile(shader as any,{} as any);
 assert.ok(shader.vertexShader.includes('uHabitatTime*.42'));assert.ok(shader.vertexShader.includes('aVeg.x'));
 assert.ok(shader.fragmentShader.includes('smoothstep(2.0,3.8'));assert.ok(shader.fragmentShader.includes('uHabitatRange*.7'));
});

test('decorative fish circle habitats, avoid rocks and recover after seabed edits without changing catch timers',()=>{
 const w=world(),reef=new ReefFish(w,[{x:0,z:0},{x:8,z:0}]),system=reef as any;
 const s=reef.schools[0],f=reef.fish[0];assert.ok(s&&f);
 assert.equal(system.clearSwim(-1,.5,1,.5,.04),true);
 w.blockFixed[w.cellIndexAt(0,.5)]=1;assert.equal(system.clearSwim(-1,.5,1,.5,.04),false);
 w.blockFixed.fill(0);const count=reef.fish.length;f.gone=100;
 reef.setHabitats([{x:8,z:0}]);assert.equal(reef.fish.length,count);assert.equal(f.gone,100);
 Object.assign(s,{x:0,z:0,tx:0,tz:0});Object.assign(f,{x:0,z:0});
 const base=w.heightAt.bind(w);w.heightAt=(x,z)=>Math.abs(x)<2&&Math.abs(z)<2?1:base(x,z);
 reef.refreshTerrain(96,96,104,104);assert.ok(w.heightAt(f.x,f.z)<-.24);assert.equal(f.gone,100);assert.ok(w.heightAt(s.x,s.z)<-.24);
 View.ready=false;w.heightAt=base;
 for(let k=0;k<100;k++)reef.update(.05,null,[]);
 assert.ok(reef.schools.some(s=>s.orbit!==undefined));assert.equal(reef.fish.length,count);
});

test('existing tube coral receives local terrain refresh as well',()=>{
 const w=world();w.layer.fill(-1);w.computeSmooth();const coral=new TubeCoral(w,[{x:0,z:0,r:.8}]);
 const before=coral.group.children.reduce((n,o)=>n+(o as THREE.InstancedMesh).count,0);
 assert.ok(before>0);w.layer.fill(2);w.computeSmooth();coral.refresh(0,0,w.N-1,w.N-1);
 assert.equal(coral.group.children.reduce((n,o)=>n+(o as THREE.InstancedMesh).count,0),0);
});
