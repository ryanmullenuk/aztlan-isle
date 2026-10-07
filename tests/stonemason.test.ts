import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BUILDINGS, masonryCost } from '../src/config';
import { Building, BuildingSystem } from '../src/buildings/Buildings';
import { stonemasonModel } from '../src/buildings/models';
import { Economy } from '../src/economy/Economy';
import { Colony } from '../src/ai/Colony';
import { makeIslander } from '../src/entities/Islander';
import { BUILD_MENU } from '../src/ui/tools';

const world={half:100,layerY:()=>0,groundY:()=>0} as any;
function setup() {
  const eco=new Economy();
  const workshop=new Building(1,'stonemason',100,100,0,0,world);
  const system={list:[workshop],eco,constructionRequirement:BuildingSystem.prototype.constructionRequirement} as any;
  return{eco,workshop,system};
}

test('only huts and the workshop are unlocked before a completed workshop; god mode and relocation remain available',()=>{
  const {eco,workshop,system}=setup();
  assert.equal(system.constructionRequirement('hut'),'');
  assert.equal(system.constructionRequirement('stonemason'),'');
  for(const key of BUILD_MENU.filter(k=>!['hut','stonemason'].includes(k))) assert.match(system.constructionRequirement(key),/Stonemason/);
  assert.match(BuildingSystem.prototype.canPlace.call(system,'home',0,0,0).reason,/Stonemason/);
  workshop.complete=true; assert.equal(system.constructionRequirement('home'),'');
  workshop.complete=false; eco.godMode=true; assert.equal(system.constructionRequirement('greattemple'),'');
});

test('stone buildings and upgrades cost carved stone which is paid and refunded correctly',()=>{
  const eco=new Economy(); eco.res.wood=100; eco.res.stone=100; eco.res.belief=100;
  assert.ok(BUILDINGS.home.cost.carvedStone!>0);
  assert.equal(BUILDINGS.stonemason.cost.carvedStone,undefined);
  assert.equal(eco.canAfford(BUILDINGS.home.cost),false);
  eco.goods.carvedstone=10; const before=eco.goods.carvedstone;
  assert.equal(eco.spend(BUILDINGS.home.cost),true);
  assert.equal(eco.goods.carvedstone,before-BUILDINGS.home.cost.carvedStone!);
  eco.refund(BUILDINGS.home.cost); assert.equal(eco.goods.carvedstone,before);
  assert.equal(masonryCost({wood:10,stone:16,belief:0}).carvedStone,4);
});

test('house and temple upgrades require a complete workshop',()=>{
  const {workshop,system}=setup();
  const home=new Building(2,'home',110,110,0,0,world);home.complete=true;
  assert.match(BuildingSystem.prototype.canUpgrade.call(system,home).reason,/Stonemason/);
  workshop.complete=true; system.eco.res.wood=1000;system.eco.res.stone=1000;system.eco.goods.carvedstone=1000;
  const up=BuildingSystem.prototype.canUpgrade.call(system,home);assert.equal(up.ok,true);assert.ok(up.cost.carvedStone!>0);
});

test('stonemasons only produce after working a full minute; raw stone is consumed exactly once',()=>{
  const {eco,workshop}=setup(); workshop.complete=true;
  const buildings={list:[workshop],byId:()=>workshop} as any;
  const colony=new Colony(world,{} as any,eco,buildings,{} as any,{} as any,()=>0.5);
  const i=makeIslander(1,'Tenoch','m',0,0,()=>0.5);colony.list=[i];
  i.workplace=1;i.role='mason';
  assert.equal((colony as any).work(i),true);assert.equal(i.task?.kind,'mason');
  (colony as any).travel=()=> 'walking';(colony as any).runTask(i,60);assert.equal(eco.goods.carvedstone,0);
  (colony as any).travel=()=> 'arrived';const raw=eco.res.stone;
  (colony as any).runTask(i,30);assert.equal(eco.goods.carvedstone,0);
  (colony as any).runTask(i,30);assert.equal(eco.goods.carvedstone,2);assert.equal(eco.res.stone,raw-4);
  eco.res.stone=3;assert.equal((colony as any).work(i),false);
  eco.res.stone=20;eco.goods.carvedstone=200;assert.equal((colony as any).work(i),false);
});

test('workshop model fits its footprint and retains low-poly geometry',()=>{
  assert.ok(BUILD_MENU.includes('stonemason'));
  const m=stonemasonModel();m.finished.computeBoundingBox();
  const size=m.finished.boundingBox!.getSize(new THREE.Vector3());assert.ok(size.x<=4 && size.z<=3 && size.y<2);
  assert.ok(m.finished.getAttribute('position').count<25000);
  for(const v of m.finished.getAttribute('position').array)assert.ok(Number.isFinite(v));m.finished.dispose();
});
