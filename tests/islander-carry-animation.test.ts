import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Healers } from '../src/ai/Healers';
import { ISLANDER } from '../src/config';
import { CarryPose } from '../src/entities/CarryPose';
import { makeIslander } from '../src/entities/Islander';
import { IslanderRig, poseFor } from '../src/entities/IslanderRig';
import { buildPeopleParts } from '../src/entities/PeopleModels';
import { BI, BONES, BONE_COUNT, type GlbModel } from '../src/entities/glbPeople';

function healer() {
  const centre={id:1,key:'healer',complete:true,rot:0,y:.5,local:(x:number,z:number)=>[x,z],toLocal:(x:number,z:number)=>[x,z]};
  const bld={list:[centre],byId:()=>centre};
  const healers=new Healers(bld as any);healers.update(.01);
  return {healers,state:(healers as any).healers[0],bld};
}

test('the healer advances its walking cycle while moving, at its slower courtyard pace', () => {
  const h=healer(),p=h.healers.list[0],startX=p.x,startT=p.animT;
  h.state.route=[{x:p.x+4,z:p.z}];
  const strides:number[]=[];
  for(let i=0;i<25;i++){h.healers.update(.1);strides.push(poseFor(p,true).thL);}
  assert.equal(p.anim,'walk');assert.ok(Math.abs(p.x-startX-.55*2.5)<1e-8);
  assert.ok(Math.abs(p.animT-startT-2.5)<1e-8);
  assert.ok(Math.max(...strides)-Math.min(...strides)>.5,'legs must change pose rather than glide');
  const ordinary={...p,npc:undefined,animT:p.animT*p.speed/ISLANDER.walkSpeed};
  assert.ok(Math.abs(poseFor(p,true).thL-poseFor(ordinary,true).thL)<1e-8);
});

test('the healer stops its stride at a bedside and does not animate or move while paused', () => {
  const h=healer(),p=h.healers.list[0];
  p.anim='walk';p.speed=.55;h.state.route=[{x:p.x,z:p.z}];h.healers.update(.1);
  assert.equal(p.anim,'idle');assert.equal(p.speed,0);assert.equal(h.state.route.length,0);
  const snapshot=JSON.stringify(p);h.healers.update(0);h.healers.update(-1);
  assert.equal(JSON.stringify(p),snapshot);
  const time=p.animT;h.healers.update(.1);assert.ok(p.animT>time,'idle/tending animation also advances');
  h.bld.list=[];h.healers.update(.1);assert.equal(h.healers.list.length,0);
});

/** Measured male/female limb proportions; the browser check also uses the real loaded GLB meshes. */
function model(g:'m'|'f',top:number):GlbModel {
  const f=g==='f';
  const values:Record<string,[number,number,number]>={
    hips:[0,.98,f?.04:-.02],spine:[0,1.1,f?.04:-.02],chest:[0,f?1.27:1.26,f?.03:-.03],
    neck:[0,f?1.45:1.44,f?.01:-.02],head:[0,f?1.54:1.53,f?.02:-.01],
    shoulderL:[.06,f?1.39:1.38,f?.02:-.04],upper_armL:[f?.19:.2,f?1.39:1.38,f?.01:-.06],
    forearmL:[f?.25:.28,1.15,f?0:-.06],handL:[f?.28:.32,f?.97:.95,f?.06:-.01],
    thighL:[f?.09:.1,.97,f?.05:-.03],shinL:[f?.16:.17,f?.47:.48,f?.05:-.03],footL:[f?.19:.21,.1,f?.07:-.05],
  };
  for(const b of ['shoulder','upper_arm','forearm','hand','thigh','shin','foot']) {
    const v=values[b+'L'];values[b+'R']=[-v[0],v[1],v[2]];
  }
  const joint=Object.fromEntries(BONES.map(b=>[b,new THREE.Vector3(...values[b])])) as GlbModel['joint'];
  return {geometry:new THREE.BoxGeometry(.5,top,.3).translate(0,top/2,0),joint,
    bindInv:BONES.map(()=>new THREE.Matrix4()),map:new THREE.Texture(),skinUv:new THREE.Vector2(),hat:{y:0,z:0,s:1},
    len:{upper:joint.upper_armL.distanceTo(joint.forearmL),fore:joint.forearmL.distanceTo(joint.handL),
      thigh:joint.thighL.distanceTo(joint.shinL),shin:joint.shinL.distanceTo(joint.footL),hand:f?.29883105595:.27748873851}};
}

function harness(parts:ReturnType<typeof buildPeopleParts>,model:GlbModel) {
  const props=new Map<string,THREE.Matrix4>();
  const rig=Object.create(IslanderRig.prototype) as any;
  Object.assign(rig,{e:new THREE.Euler(),q:new THREE.Quaternion(),v:new THREE.Vector3(),s:new THREE.Vector3(),tmp:new THREE.Matrix4(),tmp2:new THREE.Matrix4(),
    W:Array.from({length:BONE_COUNT},()=>new THREE.Matrix4()),m:{base:new THREE.Matrix4(),chest:new THREE.Matrix4(),out:new THREE.Matrix4()},
    skin:new THREE.Color(),accent:new THREE.Color(),carryPose:new CarryPose(parts),put:(key:string,m:THREE.Matrix4)=>props.set(key,m.clone())});
  const set={model,n:0,rows:32,data:new Float32Array(32*BONE_COUNT*16),tex:new THREE.DataTexture(),
    mesh:new THREE.InstancedMesh(model.geometry,new THREE.MeshBasicMaterial(),1),
    accent:new THREE.InstancedBufferAttribute(new Float32Array(3),3),look:new THREE.InstancedBufferAttribute(new Float32Array(3),3)};
  return {rig,set,props};
}

function surfaceDistance(p:THREE.Vector3,geo:THREE.BufferGeometry):number {
  const P=geo.getAttribute('position'),indices=geo.index?.array??Array.from({length:P.count},(_,i)=>i);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),near=new THREE.Vector3(),triangle=new THREE.Triangle(a,b,c);
  let distance=Infinity;
  for(let i=0;i<indices.length;i+=3) {
    a.fromBufferAttribute(P,indices[i]);b.fromBufferAttribute(P,indices[i+1]);c.fromBufferAttribute(P,indices[i+2]);
    triangle.closestPointToPoint(p,near);distance=Math.min(distance,near.distanceTo(p));
  }
  return distance;
}

test('both hands contact each overhead load and log throughout carrying, idle and running poses', () => {
  const parts=buildPeopleParts();
  const loads={log:'log',stone:'stone',fruit:'basket',grain:'sack',herbs:'basket',fish:'fish',meat:'meat'} as const;
  for(const [g,top] of [['m',1.90028143],['f',1.89899218],['m',1.841],['f',1.975]] as const) {
    const m=model(g,top),h=harness(parts,m),p=makeIslander(1,'A',g,0,0,()=>.5);
    for(const [kind,part] of Object.entries(loads))for(const anim of ['carry','idle','run'] as const)for(let phase=0;phase<8;phase++) {
      p.anim=anim;p.animT=phase*.31;p.speed=anim==='idle'?0:1.1;
      p.carry={kind:kind as keyof typeof loads,res:'fruit',n:3};h.set.n=0;
      h.rig.m.base.makeRotationY(phase*.73).scale(new THREE.Vector3(.34,.34,.34));
      h.rig.drawSkinned(p,h.set,poseFor(p,g==='f'),1);
      const prop=h.props.get(part)!;assert.ok(prop,'the posed load must be drawn');
      const inverse=prop.clone().invert();
      for(const side of ['L','R'] as const) {
        const palm=new THREE.Vector3(0,-m.len.hand*.8,0).applyMatrix4(h.rig.W[BI[`hand${side}`]])
          .applyMatrix4(h.rig.m.base).applyMatrix4(inverse);
        assert.ok(surfaceDistance(palm,parts[part])<.005,`${g} ${top} ${kind} ${anim} phase ${phase}: hand must touch the real load surface`);
        const shoulder=new THREE.Vector3().setFromMatrixPosition(h.rig.W[BI[`upper_arm${side}`]]),
          elbow=new THREE.Vector3().setFromMatrixPosition(h.rig.W[BI[`forearm${side}`]]),wrist=new THREE.Vector3().setFromMatrixPosition(h.rig.W[BI[`hand${side}`]]);
        assert.ok(Math.abs(shoulder.distanceTo(elbow)-m.len.upper)<1e-8,'upper arm must not stretch');
        assert.ok(Math.abs(elbow.distanceTo(wrist)-m.len.fore)<1e-8,'forearm must not stretch');
        const uploaded=new THREE.Matrix4().fromArray(h.set.data,BI[`hand${side}`]*16);
        uploaded.elements.forEach((v:number,i:number)=>assert.ok(Math.abs(v-h.rig.W[BI[`hand${side}`]].elements[i])<1e-6,'body and shadow skinning use the corrected hand frame'));
      }
    }
    h.set.mesh.material.dispose();m.geometry.dispose();
  }
  Object.values(parts).forEach(g=>g.dispose());
});

test('under-arm chicken carrying and lying care poses retain their own arm animation', () => {
  const parts=buildPeopleParts(),m=model('m',1.9),h=harness(parts,m),p=makeIslander(1,'A','m',0,0,()=>.5);
  for(const [kind,anim] of [['chicken','carry'],['stone','sleep']] as const) {
    p.anim=anim;p.carry={kind,res:'meat',n:1};const pose=poseFor(p,false);
    h.rig.poseSkeleton(m,pose,1);const hand=h.rig.W[BI.handL].clone();h.set.n=0;
    h.rig.drawSkinned(p,h.set,pose,1);
    assert.deepEqual(h.rig.W[BI.handL].elements,hand.elements);
  }
  h.set.mesh.material.dispose();m.geometry.dispose();Object.values(parts).forEach(g=>g.dispose());
});
