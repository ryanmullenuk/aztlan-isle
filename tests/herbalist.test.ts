import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { growMedicinalHerbs } from '../src/buildings/Herbalist';
import { herbalistModel } from '../src/buildings/models';
import { Economy } from '../src/economy/Economy';
import { Building } from '../src/buildings/Buildings';
import { Colony } from '../src/ai/Colony';
import { makeIslander } from '../src/entities/Islander';
import { BUILD_MENU } from '../src/ui/tools';

test('medicinal garden batches preserve growth, stop during construction and cap herb production', () => {
  const b={complete:false,upgrading:false,growth:0} as Building, eco=new Economy();
  growMedicinalHerbs(b,eco,120); assert.equal(eco.goods.herbs,0);
  b.complete=true; growMedicinalHerbs(b,eco,90); assert.equal(b.growth,0.75);
  growMedicinalHerbs(b,eco,30); assert.equal(eco.goods.herbs,1); assert.equal(b.growth,0);
  b.upgrading=true; growMedicinalHerbs(b,eco,120); assert.equal(eco.goods.herbs,1);
  b.upgrading=false; eco.goods.herbs=39; growMedicinalHerbs(b,eco,500); assert.equal(eco.goods.herbs,40);
  growMedicinalHerbs(b,eco,500); assert.equal(eco.goods.herbs,40);
});

test('herbal treatment requires a completed garden, supplies and actual care, and consumes one bundle', () => {
  const world={half:100,layerY:()=>0,groundY:()=>0} as any;
  const centre=new Building(1,'healer',100,100,0,0,world); centre.complete=true;
  const garden=new Building(2,'herbalist',110,110,0,0,world); garden.complete=false;
  const eco=new Economy(); eco.goods.herbs=1;
  const buildings={list:[centre,garden],byId:(id:number)=>id===1?centre:garden} as any;
  const colony=new Colony(world,{} as any,eco,buildings,{} as any,{} as any,()=>0.5);
  const i=makeIslander(1,'Itzel','f',0,0,()=>0.5); colony.list=[i];
  i.condition='sick'; i.conditionT=1000;
  i.task={kind:'heal',target:1,phase:1,stage:3,timer:5,x:0,z:0,slot:0};
  const care=(dt:number)=>(colony as any).runHeal(i,i.task,dt);
  care(60); assert.equal(i.condition,'sick'); assert.equal(i.task.care,undefined);
  garden.complete=true; care(30); assert.equal(i.task.care,30); assert.equal(i.anim,'sleep');
  eco.goods.herbs=0; care(60); assert.equal(i.task.care,30); assert.equal(i.condition,'sick');
  eco.goods.herbs=1; care(30); assert.equal(i.condition,'well'); assert.equal(eco.goods.herbs,0); assert.equal(i.task.stage,4);
  i.condition='mauled'; i.task={kind:'heal',target:1,phase:1,stage:3,timer:5,x:0,z:0,slot:0};
  eco.goods.herbs=1; care(60); assert.equal(i.condition,'mauled'); care(30); assert.equal(i.condition,'well'); assert.equal(eco.goods.herbs,0);
});

test('garden has a build entry, a bounded courtyard model and valid mobile geometry', () => {
  assert.ok(BUILD_MENU.includes('herbalist'));
  const m=herbalistModel(); m.finished.computeBoundingBox();
  const size=m.finished.boundingBox!.getSize(new THREE.Vector3());
  assert.ok(size.x<=4 && size.z<=4); assert.ok(size.y>1.2 && size.y<1.5);
  assert.ok(m.finished.getAttribute('position').count<25000);
  for(const a of ['position','normal','color','aVeg']) for(const v of m.finished.getAttribute(a).array) assert.ok(Number.isFinite(v));
  m.finished.dispose();
});
