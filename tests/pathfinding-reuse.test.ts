import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Colony } from '../src/ai/Colony';
import { Pathfinder } from '../src/ai/Pathfinder';
import { BuildingSystem } from '../src/buildings/Buildings';
import { Economy } from '../src/economy/Economy';
import { GameTime } from '../src/world/Time';
import { World } from '../src/world/World';
import { PlantState } from '../src/vegetation/Vegetation';
import { ISLANDER } from '../src/config';

function setup() {
  const w = new World(); w.layer.fill(1); w.computeSmooth();
  const pf = new Pathfinder(w), eco = new Economy(), time = new GameTime(); time.t = .4;
  const buildings: any = {list:[], byId(id:number) { return this.list.find((b:any)=>b.id===id); }, of:()=>[], nearestStore:()=>null};
  const veg:any = {plants:[]};
  const colony = new Colony(w,veg,eco,buildings,pf,time,()=>.5);
  Object.assign(colony,{jobTimer:1000,houseTimer:1000,healthTimer:1000,lastDay:time.day});
  return {w,pf,eco,time,buildings,veg,colony,c:colony as any};
}
function route(h:ReturnType<typeof setup>, x=20.5, z=.5, opts={}) {
  const p=h.colony.spawn('m',.5,.5);p.rest=p.hunger=1;p.think=1000;
  h.c.setTask(p,'goto',-1,x,z);h.c.requestPath(p,x,z,opts);p.task!.stage=1;h.c.processPaths();
  return p;
}

test('duplicate pending requests keep one request and its queue position', () => {
  const h=setup(), a=h.colony.spawn('m',.5,.5), b=h.colony.spawn('f',.5,3.5);
  h.c.setTask(a,'goto',-1,20.5,.5);h.c.setTask(b,'goto',-1,20.5,3.5);
  h.c.requestPath(a,20.5,.5);h.c.requestPath(b,20.5,3.5);
  const first=h.c.queue[0];
  for(let i=0;i<100;i++)h.c.requestPath(a,20.5,.5);
  assert.equal(h.c.queue.length,2);assert.equal(h.c.queue[0],first);
  assert.equal(h.colony.pathStats.pendingReused,100);
  while(h.c.queue.length)h.c.processPaths();assert.equal(h.colony.pathStats.completed,2);
});

test('unchanged destinations retain both the path and walking progress', () => {
  const h=setup(),p=route(h),path=p.path;
  for(let i=0;i<15;i++) {h.c.clock+=.1;h.c.travel(p,.1,20.5,.5);p.y=h.w.groundY(p.x,p.z);}
  const x=p.x,idx=p.pathIdx;
  for(let i=0;i<100;i++){h.c.requestPath(p,20.5,.5);h.c.processPaths();}
  assert.equal(p.path,path);assert.equal(p.pathIdx,idx);assert.equal(p.x,x);
  assert.equal(h.colony.pathStats.completed,1);assert.ok(h.colony.pathStats.reused>=100);
});

test('new orders and movement permissions never inherit an old route', () => {
  const h=setup(),p=route(h);
  h.c.requestPath(p,20.6,.5);assert.equal(p.pathPending,true); // Exact goal, even in the same cell.
  h.colony.walkTo(p,-10.5,.5);h.c.travel(p,.1,-10.5,.5);h.c.processPaths();
  assert.deepEqual(p.path!.at(-1),{x:-10.5,z:.5});
  h.c.requestPath(p,-10.5,.5,{allowWater:true});assert.equal(p.pathPending,true);
  h.c.processPaths();h.c.requestPath(p,-10.5,.5,{allowBuilding:3});assert.equal(p.pathPending,true);
});

test('unrelated construction preserves valid routes; construction across the route replans immediately', () => {
  const h=setup(),p=route(h),original=p.path;
  h.w.occ[h.w.cellIndexAt(-10.5,-10.5)]=9;h.w.navigationVersion++;
  h.c.travel(p,.1,20.5,.5);assert.equal(p.path,original);assert.equal(p.pathPending,false);
  for(let z=-1;z<=1;z++)for(let x=8;x<=10;x++)h.w.occ[h.w.cellIndexAt(x+.5,z+.5)]=9;
  h.w.navigationVersion++;h.c.travel(p,.1,20.5,.5);
  assert.equal(p.pathPending,true);assert.equal(p.path,null);
  for(let i=0;i<500;i++) {
    h.c.clock+=.1;h.c.processPaths();h.c.travel(p,.1,20.5,.5);p.y=h.w.groundY(p.x,p.z);
    assert.equal(h.w.occ[h.w.cellIndexAt(p.x,p.z)],0,'never walks through the new footprint');
  }
  assert.ok(Math.hypot(p.x-20.5,p.z-.5)<.4);assert.equal(h.colony.pathStats.completed,2);
});

test('a changed terrain slope invalidates the remaining route', () => {
  const h=setup(),p=route(h);
  for(let x=8;x<=10;x++)h.w.layer[h.w.cellIndexAt(x+.5,.5)]=5;
  h.w.computeSmooth();h.c.travel(p,.1,20.5,.5);
  assert.equal(p.pathPending,true);
  h.c.processPaths();assert.ok(p.path!.some(wp=>Math.abs(wp.z-.5)>.5));
});

test('bridge removal blocks a dry walker but water escorts retain their own permissions', () => {
  const h=setup();
  for(let z=0;z<h.w.N;z++)for(let x=97;x<=103;x++)h.w.layer[h.w.idx(x,z)]=-2;
  for(let x=97;x<=103;x++)h.w.bridge[h.w.idx(x,100)]=1;
  h.w.computeSmooth();
  const p=h.colony.spawn('m',-10.5,.5);p.y=h.w.groundY(p.x,p.z);
  h.c.setTask(p,'goto',-1,10.5,.5);h.c.requestPath(p,10.5,.5);p.task!.stage=1;h.c.processPaths();
  assert.ok(p.path);const old=p.path;
  h.w.bridge.fill(0);h.w.navigationVersion++;
  h.c.travel(p,.1,10.5,.5);assert.equal(p.pathPending,true);assert.notEqual(p.path,old);
  h.c.processPaths();assert.ok(!p.path || p.path.at(-1)!.x<0);
  h.c.requestPath(p,10.5,.5,{allowWater:true});h.c.processPaths();
  assert.deepEqual(p.path!.at(-1),{x:10.5,z:.5});
});

test('rock changes invalidate a route and diagonal shortcuts cannot cut blocked corners', () => {
  const h=setup(),p=route(h);
  h.w.blockCircle(8.5,.5,.7);h.c.travel(p,.1,20.5,.5);
  assert.equal(p.pathPending,true);
  h.w.blockFixed[h.w.cellIndexAt(1.5,.5)]=1;
  assert.equal(h.pf.segmentClear(.5,.5,1.5,1.5),false);
  const diagonal=h.pf.find(.5,.5,3.5,3.5)!;
  let prev=diagonal[0];for(const wp of diagonal.slice(1)) {
    assert.equal(h.pf.segmentClear(prev.x,prev.z,wp.x,wp.z),true);prev=wp;
  }
});

test('unreported obstacle changes are caught by staggered segment checks', () => {
  const h=setup(),p=route(h);p.pathIdx=1;
  h.w.occ[h.w.cellIndexAt(4.5,.5)]=9;
  h.c.clock=1;h.c.travel(p,.1,20.5,.5);
  assert.equal(p.pathPending,true);
});

test('moving pursuits reuse a valid route briefly, then aim at the latest target', () => {
  const h=setup(),p=route(h);h.c.setTask(p,'capture',1,20.5,.5);
  h.c.requestPath(p,20.5,.5,{goalRadius:1});p.task!.stage=1;h.c.processPaths();
  const path=p.path,count=h.colony.pathStats.completed;
  h.c.clock=.2;h.c.requestPath(p,25.5,.5,{goalRadius:1});h.c.processPaths();
  assert.equal(p.path,path);assert.equal(h.colony.pathStats.completed,count);
  h.c.clock=.8;h.c.requestPath(p,25.5,.5,{goalRadius:1});h.c.processPaths();
  assert.equal(h.colony.pathStats.completed,count+1);assert.notEqual(p.path,path);
  assert.ok(p.path!.at(-1)!.x>23);
});

test('a moving follow target updates a pending goal without restarting its wait', () => {
  const h=setup(),p=h.colony.spawn('f',.5,.5);
  h.c.setTask(p,'follow',2,20.5,.5);h.c.requestPath(p,20.5,.5,{goalRadius:1});
  const request=h.c.queue[0],ready=request.readyAt;
  for(let i=0;i<10;i++)h.c.requestPath(p,20.5+i,.5,{goalRadius:1});
  assert.equal(h.c.queue.length,1);assert.equal(h.c.queue[0],request);assert.equal(request.readyAt,ready);
  h.c.clock=1;h.c.processPaths();assert.ok(p.path!.at(-1)!.x>27);
});

test('a pursuit cannot defer a replan through a newly built obstacle', () => {
  const h=setup(),p=route(h);h.c.setTask(p,'capture',1,20.5,.5);
  h.c.requestPath(p,20.5,.5,{goalRadius:1});p.task!.stage=1;h.c.processPaths();
  h.w.occ[h.w.cellIndexAt(4.5,.5)]=9;h.w.navigationVersion++;h.c.clock=.1;
  h.c.requestPath(p,25.5,.5,{goalRadius:1});assert.equal(p.pathPending,true);
});

test('stuck detection forces a new search, and crowd detours survive following frames', () => {
  const h=setup(),p=route(h);p.pathIdx=1;
  p.progIdx=1;p.progD=0;p.noProg=5.1;p.jam=1;
  h.c.travel(p,.1,20.5,.5);assert.equal(p.pathPending,true);
  h.c.processPaths();const path=p.path;
  assert.equal(h.colony.pathStats.completed,2);
  h.c.clock+=.1;h.c.travel(p,.1,20.5,.5);
  assert.equal(p.path,path);assert.equal(p.pathPending,false,'crowd avoidance options must not trigger a reset');
});

test('routine requests spread across frames; player orders and sheltering bypass that delay', t => {
  const h=setup(), people=Array.from({length:ISLANDER.max},()=>h.colony.spawn('m',.5,.5));
  for(const p of people){h.c.setTask(p,'family',1,8.5,.5);h.c.requestPath(p,8.5,.5);}
  assert.equal(new Set(h.c.queue.map((q:any)=>q.readyAt)).size,8);
  const ordered=h.colony.spawn('m',.5,.5);ordered.manualRole=true;
  h.c.setTask(ordered,'mine',-1,8.5,.5);h.c.requestPath(ordered,8.5,.5);
  const shelter=h.colony.spawn('f',.5,.5);h.c.setTask(shelter,'flee',-1,8.5,.5);h.c.requestPath(shelter,8.5,.5);
  let clock=0;t.mock.method(performance,'now',()=>clock);
  const calls:number[]=[];h.pf.find=(_sx,_sz,x,z)=>{clock+=4;calls.push(calls.length);return [{x,z}];};
  h.c.processPaths();assert.equal(shelter.pathPending,false);assert.equal(ordered.pathPending,true);
  h.c.processPaths();assert.equal(ordered.pathPending,false);
  assert.equal(people.filter(p=>!p.pathPending).length,0);
  h.c.clock=.5;
  for(let i=0;i<ISLANDER.max;i++)h.c.processPaths();
  assert.ok(people.every(p=>!p.pathPending));assert.equal(h.c.queue.length,0);
});

test('a large group completes distinct player orders without dropping tasks or crossing buildings', () => {
  const h=setup();
  for(let k=0;k<60;k++) {
    const z=(k-30)*2,p=h.colony.spawn(k%2?'m':'f',-15.5,z+.5);
    h.colony.walkTo(p,15.5,z+.5);p.think=1000;
  }
  for(let i=0;i<700;i++)h.colony.update(.1);
  for(const p of h.colony.list)assert.ok(Math.abs(p.x-15.5)<.4,`order for ${p.id} must finish`);
  assert.equal(h.c.queue.length,0);
});

test('short open trips skip A*, while roads, forest, water and crowd costs retain search rules', () => {
  const h=setup();assert.deepEqual(h.pf.find(.5,.5,8.5,.5)!.at(-1),{x:8.5,z:.5});
  assert.equal(h.pf.stats.direct,1);assert.equal(h.pf.stats.searches,0);
  for(const mutate of [()=>h.w.path[h.w.cellIndexAt(4.5,.5)]=1,
    ()=>h.w.forest[h.w.cellIndexAt(4.5,.5)]=1,
    ()=>h.w.riverY[h.w.cellIndexAt(4.5,.5)]=.2]) {
    mutate();const before=h.pf.stats.searches;h.pf.find(.5,.5,8.5,.5);assert.equal(h.pf.stats.searches,before+1);
  }
  const before=h.pf.stats.searches;h.pf.find(.5,.5,8.5,.5,{allowWater:true});
  h.pf.find(.5,.5,8.5,.5,{avoid:new Set([h.w.cellIndexAt(4.5,.5)])});assert.equal(h.pf.stats.searches,before+2);
});

test('mining reserves the resource, walks to it and delivers the real load to the nearest store', () => {
  const h=setup();const store={id:2,key:'woodstore',complete:true,door:{x:1.5,z:6.5}};
  h.buildings.list=[store];h.buildings.nearestStore=()=>store;
  const rock={id:0,kind:'rock',state:PlantState.Alive,x:8.5,z:.5,amount:30,reservedBy:-1};
  h.veg.plants=[rock];h.veg.isMineable=(p:any)=>p.amount>0&&p.reservedBy<0;
  h.veg.findNearest=(_x:number,_z:number,_r:number,pred:any)=>pred(rock)?rock:null;
  h.veg.mine=()=>{rock.amount-=4;return 4;};
  const p=h.colony.spawn('m',.5,.5);p.role='miner';p.manualRole=true;p.think=1000;
  assert.equal(h.c.work(p),true);assert.equal(rock.reservedBy,p.id);
  const before=h.eco.res.stone;let carried=false;
  for(let i=0;i<500;i++) {
    h.c.clock+=.1;h.c.processPaths();if(p.task)h.c.runTask(p,.1);p.y=h.w.groundY(p.x,p.z);
    if(p.carry)carried=true;
  }
  assert.equal(carried,true);assert.equal(p.carry,null);assert.equal(rock.reservedBy,-1);
  assert.equal(h.eco.res.stone,before+4);assert.equal(p.role,'miner');assert.equal(p.manualRole,true);
});

test('resource selection keeps the player focus and falls back to nearby available resources', () => {
  const h=setup(),p=h.colony.spawn('m',.5,.5);p.role='miner';
  const near={id:0,kind:'rock',x:2.5,z:.5,amount:10,reservedBy:-1};
  const far={...near,id:1,x:30.5};h.veg.plants=[near,far];
  h.veg.isMineable=(p:any)=>p.amount>0&&p.reservedBy<0;
  h.veg.findNearest=(x:number,z:number,_r:number,pred:any)=>h.veg.plants.filter(pred).sort((a:any,b:any)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z))[0]??null;
  h.buildings.nearestStore=()=>({id:2});
  p.focusPlant=1;assert.equal(h.c.work(p),true);assert.equal(p.task!.target,1);
  h.c.cancelTask(p);assert.equal(h.c.work(p),true);assert.equal(p.task!.target,0);
  h.c.cancelTask(p);near.reservedBy=99;assert.equal(h.c.work(p),true);assert.equal(p.task!.target,1);
});

test('a storm sends workers to shelter, preserves their resources, and resumes after danger passes', () => {
  const h=setup();const home={id:1,key:'home',complete:true,door:{x:8.5,z:.5}};
  h.buildings.list=[home];const p=h.colony.spawn('m',.5,.5);p.home=1;
  p.carry={kind:'stone',res:'stone',n:2};p.role='miner';p.manualRole=true;
  h.colony.hooks.threat=()=>true;assert.equal(h.colony.shelterFromStorm(),1);
  for(let i=0;i<300;i++){h.c.clock+=.1;h.c.processPaths();if(p.task)h.c.runTask(p,.1);p.y=h.w.groundY(p.x,p.z);}
  assert.equal(p.hidden,true);assert.equal(p.carry!.n,2);assert.equal(p.role,'miner');
  h.colony.hooks.threat=()=>false;h.c.runTask(p,40);
  assert.equal(p.hidden,false);assert.equal(p.task,null);assert.equal(p.carry!.n,2);
});

test('demolition keeps rubble blocked for ten seconds and clears the correct occupancy ID afterwards', () => {
  const h=setup(),group=new THREE.Group();
  const b:any={id:4,key:'hut',cx:103,cz:100,w:2,d:2,x:4,z:1,y:.3,complete:true,group,def:{cost:{wood:10}}};
  for(let z=b.cz;z<b.cz+2;z++)for(let x=b.cx;x<b.cx+2;x++)h.w.occ[h.w.idx(x,z)]=b.id+1;
  const system=Object.create(BuildingSystem.prototype) as any;
  Object.assign(system,{world:h.w,list:[b],onRemove(){},demolitions:[],group:new THREE.Group(),eco:{refund(){}},recomputeCaps(){}});
  system.remove(b,true);assert.equal(h.pf.walkable(h.w.idx(103,100)),false);
  system.demolitions[0].update(9.9);assert.equal(h.pf.walkable(h.w.idx(103,100)),false);
  // Another building taking a cell must never be cleared by this demolition.
  h.w.occ[h.w.idx(104,101)]=8;
  system.demolitions[0].update(.2);
  assert.equal(h.w.occ[h.w.idx(103,100)],0);assert.equal(h.w.occ[h.w.idx(104,101)],8);
  assert.equal(h.pf.walkable(h.w.idx(103,100)),true);
});
