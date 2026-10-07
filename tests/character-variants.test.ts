import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {characterModelKey,characterVariant} from '../src/entities/CharacterVariants';
import {BONES,BI,BONE_COUNT,bakePose,type GlbModel} from '../src/entities/glbPeople';

function baseModel():GlbModel {
 const geometry=new THREE.BoxGeometry(.3,.3,.2).translate(0,1.15,0),n=geometry.getAttribute('position').count;
 const si=new Float32Array(n*4),sw=new Float32Array(n*4);for(let i=0;i<n;i++){si[i*4]=BI.chest;sw[i*4]=1;}
 geometry.setAttribute('aSkinI',new THREE.Float32BufferAttribute(si,4));geometry.setAttribute('aSkinW',new THREE.Float32BufferAttribute(sw,4));
 geometry.setAttribute('aHairB',new THREE.Float32BufferAttribute(new Float32Array(n),1));geometry.setAttribute('aVeg',new THREE.Float32BufferAttribute(new Float32Array(n*2),2));
 geometry.setAttribute('aMat',new THREE.Float32BufferAttribute(new Float32Array(n),1));geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(n*3).fill(1),3));
 const joint=Object.fromEntries(BONES.map(b=>[b,new THREE.Vector3(0,1,0)])) as GlbModel['joint'];
 joint.head.set(0,1.53,0);joint.chest.set(0,1.26,0);joint.footL.set(.21,.1,0);joint.footR.set(-.21,.1,0);joint.shinL.set(.17,.48,0);joint.shinR.set(-.17,.48,0);
 return {geometry,joint,bindInv:BONES.map(()=>new THREE.Matrix4()),map:new THREE.Texture(),skinUv:new THREE.Vector2(.2,.3),hat:{y:.03,z:0,s:1.25},len:{upper:.3,fore:.2,thigh:.45,shin:.4,hand:.1}};
}

test('both new characters join a stable mix alongside the founding pair and specialist NPCs',()=>{
 assert.equal(characterModelKey({id:1,gender:'m'}),'m');assert.equal(characterModelKey({id:2,gender:'f'}),'f');
 const models=new Set(Array.from({length:40},(_,i)=>characterModelKey({id:i+1,gender:i%2?'f':'m'})));
 assert.deepEqual([...models].sort(),['f','f_flower','m','m_loosehair']);
 assert.equal(characterModelKey({id:7,gender:'f',appearance:'flower'}),'f_flower');
 assert.equal(characterModelKey({id:7,gender:'m',appearance:'loosehair'}),'m_loosehair');
 assert.equal(characterModelKey({id:3,gender:'f',appearance:'classic'}),'f');
 assert.equal(characterModelKey({id:3,gender:'f',npc:'healer'}),'f');
 assert.equal(characterModelKey({id:3,gender:'m',appearance:'flower'}),'m');
});

test('variant geometry preserves the original body, rig and texture without changing the source model',()=>{
 for(const gender of ['m','f'] as const) {
  const base=baseModel(),before=base.geometry.clone(),variant=characterVariant(base,gender,new THREE.Vector2(.8,.8));
  assert.equal(variant.joint,base.joint);assert.equal(variant.bindInv,base.bindInv);assert.equal(variant.map,base.map);assert.equal(variant.len,base.len);
  for(const key of Object.keys(before.attributes))assert.deepEqual(base.geometry.getAttribute(key).array,before.getAttribute(key).array);
  const expanded=before.toNonIndexed(),p=variant.geometry.getAttribute('position');
  assert.deepEqual(Array.from(p.array).slice(0,expanded.getAttribute('position').array.length),Array.from(expanded.getAttribute('position').array));
  const weights=variant.geometry.getAttribute('aSkinW'),indices=variant.geometry.getAttribute('aSkinI');
  for(let i=0;i<p.count;i++){
   let sum=0;for(let k=0;k<4;k++){sum+=weights.getComponent(i,k);assert.ok(indices.getComponent(i,k)>=0&&indices.getComponent(i,k)<BONE_COUNT);}
   assert.ok(Math.abs(sum-1)<1e-6);
  }
  for(const pose of [{},{thighL:[-.5,0,0],shinL:[1,0,0]},{thighL:[-Math.PI/2,0,0],shinL:[Math.PI/2,0,0]}]){
   const posed=bakePose(variant,pose as any);for(const n of posed.getAttribute('position').array)assert.ok(Number.isFinite(n));posed.dispose();
  }
  variant.geometry.dispose();base.geometry.dispose();before.dispose();expanded.dispose();
 }
});
