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
  assert.match(system.constructionRequirement('temple'),/upgrade 1/);
  assert.match(system.constructionRequirement('greattemple'),/upgrade 3/);
  workshop.tier=2; assert.equal(system.constructionRequirement('temple'),'');
  workshop.upgrading=true; assert.equal(system.constructionRequirement('home'),'');
  workshop.tier=4; assert.equal(system.constructionRequirement('greattemple'),'');
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


test('workshop upgrades charge wood, stone and mixed food once, and unlock only after builders finish',()=>{
  const {eco,workshop,system}=setup(); workshop.complete=true;
  eco.res.wood=1000;eco.res.stone=1000;eco.res.grain=20;eco.res.fruit=100;eco.res.meat=100;eco.res.fish=100;
  workshop.finished=new THREE.Mesh(new THREE.BoxGeometry());
  workshop.scaffold=new THREE.Mesh(new THREE.BoxGeometry());
  Object.assign(system,{
    canUpgrade:BuildingSystem.prototype.canUpgrade,
    instantBuild:()=>false,
    finish:(b:Building)=>(BuildingSystem.prototype as any).finish.call(system,b),
    modelFor:(b:Building)=>stonemasonModel(b.tier),
    setTorches:()=>{},updateStageVisuals:()=>{},recomputeCaps:()=>{},onComplete:()=>{},
  });
  for(let level=1;level<=3;level++) {
    const next=system.canUpgrade(workshop);assert.equal(next.ok,true);assert.ok(next.cost.food>0);
    const before={wood:eco.res.wood,stone:eco.res.stone,food:eco.food};
    assert.equal(BuildingSystem.prototype.upgrade.call(system,workshop),workshop);
    assert.equal(workshop.tier,level);assert.equal(workshop.upgrading,true);
    assert.equal(eco.res.wood,before.wood-next.cost.wood);assert.equal(eco.res.stone,before.stone-next.cost.stone);assert.equal(eco.food,before.food-next.cost.food);
    assert.equal(system.canUpgrade(workshop).ok,false);
    const duration=[60,90,120][level-1];
    BuildingSystem.prototype.addProgress.call(system,workshop,duration-1);assert.equal(workshop.tier,level);
    BuildingSystem.prototype.addProgress.call(system,workshop,1);assert.equal(workshop.tier,level+1);assert.equal(workshop.upgrading,false);
  }
  assert.equal(system.canUpgrade(workshop).ok,false);assert.equal(system.constructionRequirement('greattemple'),'');
  workshop.finished.geometry.dispose();workshop.scaffold.geometry.dispose();
});

test('great pyramid upgrades need workshop upgrade 2, and insufficient food prevents payment',()=>{
  const {eco,workshop,system}=setup();workshop.complete=true;workshop.tier=2;
  eco.res.wood=1000;eco.res.stone=1000;eco.res.belief=1000;eco.goods.carvedstone=1000;
  const temple=new Building(2,'temple',110,110,0,0,world);temple.complete=true;
  assert.match(BuildingSystem.prototype.canUpgrade.call(system,temple).reason,/upgrade 2/);
  workshop.tier=3;assert.equal(BuildingSystem.prototype.canUpgrade.call(system,temple).ok,true);
  eco.res.grain=0;eco.res.fruit=0;eco.res.meat=0;eco.res.fish=0;
  const before=eco.res.wood;const next=BuildingSystem.prototype.canUpgrade.call(system,workshop);
  assert.equal(next.ok,false);assert.equal(eco.spend(next.cost),false);assert.equal(eco.res.wood,before);
});


test('assigned stonemasons become builders during workshop upgrades and return to carving afterwards',()=>{
  const {eco,workshop}=setup();workshop.complete=true;workshop.upgrading=true;
  const buildings={list:[workshop],byId:()=>workshop} as any;
  const colony=new Colony(world,{} as any,eco,buildings,{} as any,{} as any,()=>0.5);
  const i=makeIslander(1,'Tenoch','m',0,0,()=>0.5); i.role='mason'; i.workplace=1;i.manualRole=true;colony.list=[i];
  (colony as any).assignJobs();assert.equal(i.role,'builder');assert.equal(i.workplace,1);
  workshop.upgrading=false; (colony as any).assignJobs();assert.equal(i.role,'mason');assert.equal(i.workplace,1);
});
