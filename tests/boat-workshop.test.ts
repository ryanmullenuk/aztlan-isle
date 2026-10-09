import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BuildingSystem} from '../src/buildings/Buildings';
import {boatWorkshopModel} from '../src/buildings/models';
import {Boats} from '../src/entities/Boats';
import {TradeFleet as Trade} from '../src/entities/Trade';
import {Economy} from '../src/economy/Economy';
import {BUILDINGS,BOAT_WORKSHOP,JETTY} from '../src/config';
import {Progression} from '../src/economy/Progression';
import {BUILD_MENU} from '../src/ui/tools';
function setup(){
 const eco=new Economy();Object.assign(eco.res,{wood:1000,stone:1000,grain:1000,belief:1000});
 const workshop={key:'boatworkshop',complete:false,tier:1,upgrading:false,progress:0} as any;
 const bld={eco,list:[workshop],boatRequirement:BuildingSystem.prototype.boatRequirement} as any;
 return{eco,workshop,bld};
}
test('boat orders enforce completed research levels before spending, with no free larger boats',()=>{
 const {eco,workshop,bld}=setup();
 const boats={eco,bld} as any,j={key:'jetty',complete:true,boatBuild:0,boats:[]} as any;
 const before=eco.res.wood;
 assert.equal(Boats.prototype.order.call(boats,j),false);assert.equal(eco.res.wood,before);
 workshop.complete=true;assert.equal(Boats.prototype.order.call(boats,j),true);assert.equal(j.boatSail,false);
 assert.equal(eco.res.wood,before-JETTY.boatCost.wood);
 j.boatBuild=0;assert.equal(Boats.prototype.order.call(boats,j,true),false);
 workshop.upgrading=true;assert.equal(Boats.prototype.order.call(boats,j,true),false);
 workshop.tier=2;workshop.upgrading=false;assert.equal(Boats.prototype.order.call(boats,j,true),true);assert.equal(j.boatSail,true);
 assert.equal(eco.res.wood,before-JETTY.boatCost.wood-BOAT_WORKSHOP.largeCost.wood);
 const trade={eco,bld,of:()=>[]} as any,dock={key:'tradedock',complete:true,boatBuild:0};
 assert.match(Trade.prototype.orderBoat.call(trade,dock),/level 3/);assert.equal(dock.boatBuild,0);
 workshop.tier=3;assert.match(Trade.prototype.orderBoat.call(trade,dock),/start work/);
});
test('research consumes resources and builder work before unlocking the next boat type',()=>{
 const {eco,workshop,bld}=setup();workshop.complete=true;
 Object.assign(bld,{canUpgrade:BuildingSystem.prototype.canUpgrade,instantBuild:()=>false,updateStageVisuals:()=>{},finish:(b:any)=>{b.upgrading=false;b.tier++;}});
 workshop.scaffold={visible:false};
 assert.equal(BuildingSystem.prototype.upgrade.call(bld,workshop),workshop);
 assert.equal(workshop.tier,1);assert.equal(eco.res.wood,960);
 BuildingSystem.prototype.addProgress.call(bld,workshop,89);assert.equal(workshop.tier,1);
 BuildingSystem.prototype.addProgress.call(bld,workshop,1);assert.equal(workshop.tier,2);
});
test('workshop is available early, research follows settlement progression, and placement needs nearby sea',()=>{
 assert.ok(BUILD_MENU.includes('boatworkshop'));assert.deepEqual(BUILDINGS.boatworkshop.size,BUILDINGS.farm.size);
 const state={buildings:[],population:2,food:20,carved:0,sandbox:false,milestones:new Set<string>()};
 const p=new Progression(()=>state);assert.equal(p.requirement('boatworkshop'),'');
 assert.match(p.upgradeRequirement({key:'boatworkshop',tier:1} as any),/Skilled village/);
 state.milestones.add('progress:stage:3');assert.equal(p.upgradeRequirement({key:'boatworkshop',tier:1} as any),'');
 assert.match(p.upgradeRequirement({key:'boatworkshop',tier:2} as any),/Prosperity/);
 const world={inBounds:(x:number,z:number)=>x>=0&&z>=0&&x<40&&z<40,idx:(x:number,z:number)=>z*40+x,layer:new Int8Array(1600).fill(2)};
 const b={world} as any;assert.equal(BuildingSystem.prototype.nearSea.call(b,10,10,4,4),false);
 world.layer[10*40+4]=0;assert.equal(BuildingSystem.prototype.nearSea.call(b,10,10,4,4),true);
});
test('all workshop tiers have finite geometry inside a farm footprint and visible research additions',()=>{
 let previous=0;
 for(let tier=1;tier<=3;tier++){
  const m=boatWorkshopModel(tier),g=m.finished;g.computeBoundingBox();
  const box=g.boundingBox!;assert.ok(box.max.x-box.min.x<=4.05);assert.ok(box.max.z-box.min.z<=4.05);
  assert.ok(g.getAttribute('position').count>previous);previous=g.getAttribute('position').count;
  for(const n of g.getAttribute('position').array)assert.ok(Number.isFinite(n));g.dispose();
 }
});
