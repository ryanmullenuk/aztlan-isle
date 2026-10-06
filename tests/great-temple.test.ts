import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Building, BuildingSystem } from '../src/buildings/Buildings';
import { greatTempleModel, templeModel } from '../src/buildings/models';
import { BUILDINGS, TEMPLE } from '../src/config';
import { BUILD_MENU } from '../src/ui/tools';
import { Colony } from '../src/ai/Colony';
import { Economy } from '../src/economy/Economy';
import { makeIslander } from '../src/entities/Islander';

function setup() {
  const world={half:100,layerY:()=>0,groundY:()=>0} as any;
  const temple=new Building(5,'greattemple',100,100,0,0,world); temple.complete=true;
  const eco=new Economy(); eco.res.belief=0;
  const buildings={list:[temple],byId:(id:number)=>id===5?temple:undefined} as any;
  const colony=new Colony(world,{} as any,eco,buildings,{} as any,{} as any,()=>0.5);
  colony.list=[makeIslander(1,'Itzel','f',temple.door.x,temple.door.z,()=>0.5),makeIslander(2,'Tenoch','m',temple.door.x,temple.door.z,()=>0.5)];
  const pray=(index:number,seconds:number)=>{
    const i=colony.list[index];
    i.task={kind:'pray',target:5,stage:2,timer:seconds+1,x:i.x,z:i.z};
    (colony as any).runTask(i,seconds);
  };
  return {temple,eco,colony,pray,buildings};
}

test('Great Temple has four times the footprint, a separate build entry and matching monumental geometry',()=>{
  assert.ok(BUILD_MENU.includes('greattemple'));
  assert.equal(BUILDINGS.greattemple.size[0]*BUILDINGS.greattemple.size[1],4*BUILDINGS.temple.size[0]*BUILDINGS.temple.size[1]);
  const m=greatTempleModel(),p=templeModel(3);
  m.finished.computeBoundingBox(); p.finished.computeBoundingBox();
  const size=m.finished.boundingBox!.getSize(new THREE.Vector3());
  assert.ok(size.x>7.8 && size.z>7.8 && size.x<8.2 && size.z<8.2,'model fits placement footprint');
  assert.ok(size.y>p.height && Math.abs(size.y-m.height)<0.1);
  assert.equal(m.torches.length,8);
  assert.ok(m.finished.getAttribute('position').count<100000,'bounded mobile geometry');
  for(const v of m.finished.getAttribute('position').array) assert.ok(Number.isFinite(v));
  m.finished.dispose(); p.finished.dispose();
});

test('Great Temple prayer pays whole belief per person only after five minutes and keeps interrupted progress',()=>{
  const {colony,eco,pray,temple}=setup();
  pray(0,180); pray(1,299); assert.equal(eco.res.belief,0);
  (colony as any).releaseTask(colony.list[0]);
  assert.equal(colony.list[0].greatTemplePrayer,180);
  pray(0,120); assert.equal(eco.res.belief,1);
  pray(1,1); assert.equal(eco.res.belief,2);
  pray(0,601); assert.equal(eco.res.belief,4); assert.equal(colony.list[0].greatTemplePrayer,1);
  temple.complete=false; pray(0,300); assert.equal(eco.res.belief,4);
  assert.equal(colony.list[0].task,null);
});

test('group assignments use the Great Temple, with separate prayer positions outside its footprint',()=>{
  const {colony,temple}=setup();
  assert.equal(colony.assignGroup(colony.list,temple,null),2);
  const spots=new Set(colony.list.map(i=>`${i.task?.x},${i.task?.z}`));
  assert.equal(spots.size,2);
  for(const i of colony.list){
    assert.equal(i.role,'priest');assert.equal(i.workplace,temple.id);assert.equal(i.task?.kind,'pray');
    const [,z]=temple.toLocal(i.task!.x,i.task!.z);assert.ok(z>temple.d/2);
  }
});

test('walking to the Great Temple earns no prayer progress and restoring keeps prior progress',()=>{
  const {colony,eco}=setup();
  const i=colony.list[0]; i.greatTemplePrayer=123.5;
  i.task={kind:'pray',target:5,stage:1,timer:0,x:40,z:40};
  (colony as any).travel=()=> 'walking';
  (colony as any).runTask(i,100);
  assert.equal(i.greatTemplePrayer,123.5); assert.equal(eco.res.belief,0);
  const restored=colony.restore({...i,id:3}); assert.equal(restored.greatTemplePrayer,123.5);
});

test('Great Temple increases belief storage only once construction is complete',()=>{
  const {temple,eco}=setup();
  const system={list:[temple],eco};
  BuildingSystem.prototype.recomputeCaps.call(system as any);
  const completeCap=eco.beliefCap;
  temple.complete=false; BuildingSystem.prototype.recomputeCaps.call(system as any);
  assert.ok(completeCap>eco.beliefCap);
});
