import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {characterModelKey,characterVariant,isElder} from '../src/entities/CharacterVariants';
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

test('islanders get a stable mix of models: founding pair, hairstyles, children, elders and heavier builds', ()=>{
 assert.equal(characterModelKey({id:1,gender:'m'}),'m');assert.equal(characterModelKey({id:2,gender:'f'}),'f');
 const adults=new Set(Array.from({length:80},(_,i)=>characterModelKey({id:i+1,gender:i%2?'f':'m'})));
 assert.deepEqual([...adults].sort(),['f','f_flower','fatf','fatm','m','m_loosehair','oldf','oldm']);
 const kids=new Set(Array.from({length:20},(_,i)=>characterModelKey({id:i+1,gender:i%2?'f':'m',child:true})));
 assert.deepEqual([...kids].sort(),['boy','girl']);
 // Elders always draw as the older man and woman; the same person keeps the same model.
 for(let id=3;id<80;id++) if(isElder({id,child:false})) assert.equal(characterModelKey({id,gender:'m'}),'oldm');
 assert.equal(characterModelKey({id:17,gender:'f'}),characterModelKey({id:17,gender:'f'}));
 // Hairstyles still apply to ordinary adults (not elders or the heavier build).
 const plain=Array.from({length:80},(_,i)=>i+3).find(id=>['m','f','m_loosehair','f_flower'].includes(characterModelKey({id,gender:'f'})))!;
 assert.equal(characterModelKey({id:plain,gender:'f',appearance:'flower'}),'f_flower');
 assert.equal(characterModelKey({id:plain,gender:'m',appearance:'loosehair'}),'m_loosehair');
 assert.equal(characterModelKey({id:plain,gender:'f',appearance:'classic'}),'f');
 assert.equal(characterModelKey({id:plain,gender:'m',appearance:'flower'}),'m');
 // Specialist NPCs keep the founding models.
 assert.equal(characterModelKey({id:3,gender:'f',npc:'healer'}),'f');
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

test('variants keep the original legs, boots and clothes untouched, and colour the new hair from the hair texel', () => {
 for (const gender of ['m','f'] as const) {
  const base=baseModel();
  // A leg below the knee and a hair cap, beside the chest block.
  const leg=new THREE.BoxGeometry(.1,.4,.1).translate(.15,.25,0).toNonIndexed(), cap=new THREE.BoxGeometry(.25,.1,.25).translate(0,1.7,0).toNonIndexed();
  const body=base.geometry.toNonIndexed();
  const merged=new THREE.BufferGeometry();
  const all=[body,leg,cap], hairUv=new THREE.Vector2(.61,.07);
  for (const name of Object.keys(body.attributes)) {
   const arrays=all.map((g,gi)=>{
    const a=g.getAttribute(name);
    if(a&&!(name==='uv'&&gi===2)) return Array.from(a.array);
    const n=g.getAttribute('position').count, size=body.getAttribute(name).itemSize, out=new Array(n*size).fill(0);
    if(name==='aHairB'&&gi===2) out.fill(1);
    if(name==='uv'&&gi===2) for(let i=0;i<n;i++){out[i*2]=hairUv.x;out[i*2+1]=hairUv.y;}
    if(name==='aSkinW') for(let i=0;i<n;i++) out[i*4]=1;
    if(name==='color') out.fill(1);
    return out;
   });
   merged.setAttribute(name,new THREE.Float32BufferAttribute(arrays.flat(),body.getAttribute(name).itemSize));
  }
  base.geometry=merged;
  const variant=characterVariant(base,gender,new THREE.Vector2(.9,.9));
  const P=variant.geometry.getAttribute('position'), U=variant.geometry.getAttribute('uv'), H=variant.geometry.getAttribute('aHairB');
  // Every leg vertex is still there, unmoved.
  const lp=leg.getAttribute('position');
  for (let i=0;i<lp.count;i++) {
   let found=false;
   for (let j=0;j<P.count&&!found;j++) if(Math.abs(P.getX(j)-lp.getX(i))<1e-6&&Math.abs(P.getY(j)-lp.getY(i))<1e-6&&Math.abs(P.getZ(j)-lp.getZ(i))<1e-6) found=true;
   assert.ok(found,'a leg vertex moved or went missing');
  }
  // The old hair cap is gone; the new hair samples the hair texel.
  let hairVerts=0;
  for (let i=0;i<P.count;i++) if (H.getX(i)===1) { hairVerts++; assert.ok(Math.abs(U.getX(i)-hairUv.x)<1e-6 && Math.abs(U.getY(i)-hairUv.y)<1e-6, `uv ${U.getX(i)},${U.getY(i)} at ${P.getY(i)}`); }
  assert.ok(hairVerts>100);
  variant.geometry.dispose();
 }
});
