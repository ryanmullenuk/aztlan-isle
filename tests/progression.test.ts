import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Progression, type ProgressState} from '../src/economy/Progression';
import {BuildingSystem} from '../src/buildings/Buildings';
import {BUILDINGS} from '../src/config';
import {Economy} from '../src/economy/Economy';
function setup(){
 const state:ProgressState={buildings:[],population:2,food:36,carved:0,sandbox:false,milestones:new Set()};
 const p=new Progression(()=>state);
 const build=(key:string,tier=1)=>{const b={key,tier,complete:true} as any;state.buildings.push(b);return b;};
 return {state,p,build};
}
test('normal progression can reach all seven stages through available buildings and activity',()=>{
 const {state:s,p,build}=setup();
 assert.equal(p.requirement('hut'),'');assert.equal(p.requirement('farm'),'');assert.equal(p.requirement('jetty'),'');
 assert.match(p.requirement('stonemason'),/Skilled village/);
 build('hut');p.refresh();assert.equal(p.stage,1);
 p.record('harvest');p.refresh();assert.equal(p.stage,2);
 assert.equal(p.requirement('woodstore'),'');assert.equal(p.requirement('grainstore'),'');
 build('woodstore');build('grainstore');s.population=6;p.refresh();assert.equal(p.stage,3);
 const mason=build('stonemason');p.refresh();assert.equal(p.workshopTier,1);
 assert.match(p.upgradeRequirement(mason),/Worship/);
 s.carved=2;s.population=12;p.refresh();assert.equal(p.stage,4);
 build('market');build('greathall');s.population=20;s.food=79;p.refresh();assert.equal(p.stage,4);
 s.food=80;p.refresh();assert.equal(p.stage,5);assert.equal(p.upgradeRequirement(mason),'');
 mason.tier=2;const temple=build('temple');s.population=35;p.refresh();assert.equal(p.stage,5);
 p.record('trade');p.pray(299);p.refresh();assert.equal(p.stage,5);
 p.pray(1);p.refresh();assert.equal(p.stage,6);assert.equal(p.upgradeRequirement(temple),'');
 mason.tier=3;temple.tier=3;s.population=60;p.refresh();assert.equal(p.stage,7);
 assert.equal(p.upgradeRequirement(mason),'');mason.tier=4;p.refresh();assert.equal(p.workshopTier,4);
 assert.equal(p.requirement('greattemple'),'');
 s.buildings=[];s.population=1;s.food=0;s.carved=0;p.refresh();assert.equal(p.stage,7);
 const system={eco:new Economy(),list:[],earnedWorkshopTier:()=>p.workshopTier,progressionRequirement:(k:any)=>p.requirement(k)} as any;
 assert.equal(BuildingSystem.prototype.constructionRequirement.call(system,'greattemple'),'');
});
test('unfinished buildings, Sandbox activity and renaming cannot earn normal milestones',()=>{
 const {state:s,p,build}=setup();const hut=build('hut');hut.complete=false;p.record('harvest');p.refresh();assert.equal(p.stage,1);
 s.sandbox=true;hut.complete=true;p.record('trade');p.pray(300);p.refresh();assert.equal(p.stage,1);assert.equal(p.prayer,0);
 assert.equal(p.requirement('greattemple'),'');s.sandbox=false;p.refresh();assert.equal(p.stage,2);
 assert.ok(p.missing(6).some(x=>x.includes('trade')));
});
test('developed legacy saves keep their stage and completed workshop knowledge',()=>{
 const {p,build}=setup();build('stonemason',4);build('greattemple');p.migrate();assert.equal(p.stage,7);assert.equal(p.workshopTier,4);
 const copy=setup();copy.state.milestones=new Set((p as any).state().milestones);copy.p.prayer=p.prayer;
 assert.equal(copy.p.stage,7);assert.equal(copy.p.workshopTier,4);
});
test('Great Temple charges each new phase exactly once, pauses without resources and resumes',()=>{
 const eco=new Economy();Object.assign(eco.res,{wood:0,stone:0,belief:0});eco.goods.carvedstone=0;
 const b={key:'greattemple',def:BUILDINGS.greattemple,progress:0,monumentPaid:1,complete:false} as any;
 const sys={eco,updateStageVisuals:()=>{},finish:(b:any)=>{b.complete=true;}} as any;
 const work=(dt:number)=>BuildingSystem.prototype.addProgress.call(sys,b,dt);
 work(300);assert.equal(b.progress,.25);assert.equal(b.monumentPaid,1);
 assert.equal(BuildingSystem.prototype.waitingForMaterials.call(sys,b),true);
 Object.assign(eco.res,{wood:120,stone:360,belief:150});eco.goods.carvedstone=90;
 work(721);assert.equal(b.complete,true);assert.equal(b.monumentPaid,4);
 assert.equal(eco.res.wood,0);assert.equal(eco.res.stone,0);assert.equal(eco.res.belief,0);assert.equal(eco.goods.carvedstone,0);
 const legacy={...b,complete:false,progress:0,monumentPaid:undefined};BuildingSystem.prototype.addProgress.call(sys,legacy,960);assert.equal(legacy.complete,true);
});
