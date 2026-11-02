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
test('normal progression can reach all eight stages through available buildings, activity and time',()=>{
 const {state:s,p,build}=setup();s.day=0;
 /** Let game days pass (each stage after the third needs some time at the one before). */
 const pass=(d:number)=>{s.day!+=d;p.refresh();};
 assert.equal(p.requirement('hut'),'');assert.equal(p.requirement('farm'),'');assert.equal(p.requirement('jetty'),'');
 assert.match(p.requirement('stonemason'),/Skilled village/);
 build('hut');p.refresh();assert.equal(p.stage,1);
 p.record('harvest');p.refresh();assert.equal(p.stage,2);
 assert.equal(p.requirement('woodstore'),'');assert.equal(p.requirement('grainstore'),'');
 build('woodstore');build('grainstore');s.population=6;p.refresh();assert.equal(p.stage,2,'a day as a Hamlet first');
 assert.ok(p.missing(3).some(x=>/Settle in as a Hamlet: 0\/1 day/.test(x)));
 pass(1);assert.equal(p.stage,3);
 assert.match(p.requirement('healer'),/Healthy village/);assert.match(p.requirement('temple'),/Worship/);
 build('maizefarm');build('home');s.population=10;pass(1);assert.equal(p.stage,4);
 assert.equal(p.requirement('healer'),'');
 const mason=build('stonemason');p.refresh();assert.equal(p.workshopTier,1);
 assert.match(p.upgradeRequirement(mason),/Worship/);
 build('healer');s.carved=2;s.population=14;p.refresh();assert.equal(p.stage,4);pass(1);assert.equal(p.stage,5);
 build('market');build('greathall');s.population=22;s.food=87;pass(2);assert.equal(p.stage,5);
 s.food=88;p.refresh();assert.equal(p.stage,6);assert.equal(p.upgradeRequirement(mason),'');
 assert.equal(p.requirement('temple'),'');
 mason.tier=2;const temple=build('temple');s.population=35;pass(2);assert.equal(p.stage,6);
 p.record('trade');p.pray(299);p.refresh();assert.equal(p.stage,6);
 p.pray(1);p.refresh();assert.equal(p.stage,7);assert.equal(p.upgradeRequirement(temple),'');
 mason.tier=3;temple.tier=3;s.population=60;p.refresh();assert.equal(p.stage,7,'three days as a City first');
 pass(3);assert.equal(p.stage,8);
 assert.equal(p.upgradeRequirement(mason),'');mason.tier=4;p.refresh();assert.equal(p.workshopTier,4);
 assert.equal(p.requirement('greattemple'),'');
 s.buildings=[];s.population=1;s.food=0;s.carved=0;p.refresh();assert.equal(p.stage,8);
 const system={eco:new Economy(),list:[],earnedWorkshopTier:()=>p.workshopTier,progressionRequirement:(k:any)=>p.requirement(k)} as any;
 assert.equal(BuildingSystem.prototype.constructionRequirement.call(system,'greattemple'),'');
});
test('seven-stage saves move up to the eight stages once',()=>{
 const {p,state}=setup();for(let k=2;k<=6;k++)state.milestones.add('progress:stage:'+k);
 p.renumber();assert.equal(p.stage,7);p.renumber();assert.equal(p.stage,7);
 const early=setup();for(let k=2;k<=3;k++)early.state.milestones.add('progress:stage:'+k);
 early.p.renumber();assert.equal(early.p.stage,3);
});
test('unfinished buildings, Sandbox activity and renaming cannot earn normal milestones',()=>{
 const {state:s,p,build}=setup();const hut=build('hut');hut.complete=false;p.record('harvest');p.refresh();assert.equal(p.stage,1);
 s.sandbox=true;hut.complete=true;p.record('trade');p.pray(300);p.refresh();assert.equal(p.stage,1);assert.equal(p.prayer,0);
 assert.equal(p.requirement('greattemple'),'');s.sandbox=false;p.refresh();assert.equal(p.stage,2);
 assert.ok(p.missing(7).some(x=>x.includes('trade')));
});
test('developed legacy saves keep their stage and completed workshop knowledge',()=>{
 const {p,build}=setup();build('stonemason',4);build('greattemple');p.migrate();assert.equal(p.stage,8);assert.equal(p.workshopTier,4);
 const copy=setup();copy.state.milestones=new Set((p as any).state().milestones);copy.p.prayer=p.prayer;
 assert.equal(copy.p.stage,8);assert.equal(copy.p.workshopTier,4);
});
test('Great Temple charges each new phase exactly once, pauses without resources and resumes',()=>{
 const eco=new Economy();Object.assign(eco.res,{wood:0,stone:0,belief:0});eco.goods.carvedstone=0;
 const b={key:'greattemple',def:BUILDINGS.greattemple,progress:0,monumentPaid:1,complete:false} as any;
 const sys={eco,updateStageVisuals:()=>{},finish:(b:any)=>{b.complete=true;}} as any;
 const work=(dt:number)=>BuildingSystem.prototype.addProgress.call(sys,b,dt);
 const phase=BUILDINGS.greattemple.buildTime/4;
 work(phase+60);assert.equal(b.progress,.25);assert.equal(b.monumentPaid,1);
 assert.equal(BuildingSystem.prototype.waitingForMaterials.call(sys,b),true);
 Object.assign(eco.res,{wood:120,stone:360,belief:150});eco.goods.carvedstone=90;
 work(phase*3+1);assert.equal(b.complete,true);assert.equal(b.monumentPaid,4);
 assert.equal(eco.res.wood,0);assert.equal(eco.res.stone,0);assert.equal(eco.res.belief,0);assert.equal(eco.goods.carvedstone,0);
 const legacy={...b,complete:false,progress:0,monumentPaid:undefined};BuildingSystem.prototype.addProgress.call(sys,legacy,BUILDINGS.greattemple.buildTime);assert.equal(legacy.complete,true);
});
