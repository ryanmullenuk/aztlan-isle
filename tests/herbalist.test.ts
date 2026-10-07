import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { processMedicine } from '../src/buildings/Herbalist';
import { herbalistModel, herbalGardenModel, cropModel } from '../src/buildings/models';
import { Economy } from '../src/economy/Economy';
import { Building } from '../src/buildings/Buildings';
import { Colony } from '../src/ai/Colony';
import { makeIslander } from '../src/entities/Islander';
import { BUILD_MENU } from '../src/ui/tools';

test('processing requires herbs, reserves a batch, takes three minutes and pauses at the medicine limit', () => {
  const b={complete:false,upgrading:false,growth:0,stock:0} as Building, eco=new Economy();
  eco.goods.herbs=3;
  processMedicine(b,eco,180); assert.equal(eco.goods.herbs,3); assert.equal(eco.goods.medicine,0);
  b.complete=true; processMedicine(b,eco,90); assert.equal(b.growth,0.5); assert.equal(b.stock,1); assert.equal(eco.goods.herbs,2);
  b.upgrading=true; processMedicine(b,eco,180); assert.equal(b.growth,0.5);
  b.upgrading=false;
  const restored={...b} as Building; processMedicine(restored,eco,90);
  assert.equal(eco.goods.medicine,1); assert.equal(restored.stock,0); assert.equal(restored.growth,0); assert.equal(eco.goods.herbs,2);
  eco.goods.medicine=39; processMedicine(restored,eco,500); assert.equal(eco.goods.medicine,40); assert.equal(eco.goods.herbs,1);
  processMedicine(restored,eco,500); assert.equal(eco.goods.herbs,1);
  eco.goods.medicine=0; eco.goods.herbs=0; processMedicine(restored,eco,500); assert.equal(eco.goods.medicine,0);
});

test('herbal treatment requires medicine and actual care, and consumes one dose', () => {
  const world={half:100,layerY:()=>0,groundY:()=>0} as any;
  const centre=new Building(1,'healer',100,100,0,0,world); centre.complete=true;
  const garden=new Building(2,'herbalist',110,110,0,0,world); garden.complete=false;
  const eco=new Economy(); eco.goods.medicine=1;
  const buildings={list:[centre,garden],byId:(id:number)=>id===1?centre:garden} as any;
  const colony=new Colony(world,{} as any,eco,buildings,{} as any,{} as any,()=>0.5);
  const i=makeIslander(1,'Itzel','f',0,0,()=>0.5); colony.list=[i];
  i.condition='sick'; i.conditionT=1000;
  i.task={kind:'heal',target:1,phase:1,stage:3,timer:5,x:0,z:0,slot:0};
  const care=(dt:number)=>(colony as any).runHeal(i,i.task,dt);
  eco.goods.medicine=0; eco.goods.herbs=4; care(60); assert.equal(i.condition,'sick'); assert.equal(i.task.care,undefined); eco.goods.medicine=1;
  garden.complete=true; care(30); assert.equal(i.task.care,30); assert.equal(i.anim,'sleep');
  eco.goods.medicine=0; care(60); assert.equal(i.task.care,30); assert.equal(i.condition,'sick');
  eco.goods.medicine=1; care(30); assert.equal(i.condition,'well'); assert.equal(eco.goods.medicine,0); assert.equal(i.task.stage,4);
  i.condition='mauled'; i.task={kind:'heal',target:1,phase:1,stage:3,timer:5,x:0,z:0,slot:0};
  eco.goods.medicine=1; care(60); assert.equal(i.condition,'mauled'); care(30); assert.equal(i.condition,'well'); assert.equal(eco.goods.medicine,0);
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


test('farmers harvest herbs and only credit delivered bundles at the Herbalist', () => {
  const world={half:100,layerY:()=>0,groundY:()=>0} as any;
  const farm=new Building(1,'herbalgarden',100,100,0,0,world); farm.complete=true; farm.growth=1;
  const processor=new Building(2,'herbalist',110,110,0,0,world); processor.complete=false;
  const buildings={list:[farm,processor],byId:(id:number)=>id===1?farm:processor} as any;
  const eco=new Economy(); const grain=eco.res.grain;
  const colony=new Colony(world,{} as any,eco,buildings,{} as any,{} as any,()=>0.5);
  const i=makeIslander(1,'Itzel','f',0,0,()=>0.5); colony.list=[i];
  const harvest=()=>{i.task={kind:'farm',target:1,stage:2,timer:0,x:0,z:0};(colony as any).runTask(i,1);};
  harvest(); assert.equal(farm.growth,1); assert.equal(i.carry,null);
  processor.complete=true; harvest();
  assert.equal(i.carry?.res,'herbs'); assert.equal(i.carry?.n,4); assert.equal(i.task?.kind,'deliver'); assert.equal(i.task?.target,2);
  assert.equal(eco.goods.herbs,0); assert.equal(farm.growth,0);
  (colony as any).travel=()=> 'walking'; (colony as any).runTask(i,1); assert.equal(eco.goods.herbs,0);
  (colony as any).travel=()=> 'arrived'; (colony as any).runTask(i,1); assert.equal(eco.goods.herbs,4); assert.equal(i.carry,null); assert.equal(eco.res.grain,grain);
  processMedicine(processor,eco,180); assert.equal(eco.goods.medicine,1); assert.equal(eco.goods.herbs,3);
});

test('Herbal Garden is smaller than the farm, with bounded multicoloured medicinal crops',()=>{
  assert.ok(BUILD_MENU.includes('herbalgarden'));
  const model=herbalGardenModel(), crops=cropModel(3,3,true,'herbs');
  for(const geo of [model.finished,crops]) {
    geo.computeBoundingBox(); const size=geo.boundingBox!.getSize(new THREE.Vector3());
    assert.ok(size.x<3 && size.z<3); assert.ok(geo.getAttribute('position').count<25000);
    for(const v of geo.getAttribute('position').array) assert.ok(Number.isFinite(v));
  }
  const colour=crops.getAttribute('color'); const unique=new Set();
  for(let i=0;i<colour.count;i++)unique.add([colour.getX(i),colour.getY(i),colour.getZ(i)].join(','));
  assert.ok(unique.size>=6); model.finished.dispose(); crops.dispose();
});
