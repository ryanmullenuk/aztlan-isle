import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Animals} from '../src/entities/Animals';
import {Colony} from '../src/ai/Colony';
import {Pathfinder} from '../src/ai/Pathfinder';
import {Building,BuildingSystem} from '../src/buildings/Buildings';
import {Economy} from '../src/economy/Economy';
import {World} from '../src/world/World';
import {GameTime} from '../src/world/Time';
import {BUILDINGS,SPECIES} from '../src/config';
function fixture(species:'chicken'|'pig'|'goat'='chicken'){
 const w=new World();w.seed=7;w.layer.fill(1);w.computeSmooth();
 const eco=new Economy();eco.foodCap=1000;eco.woodCap=1000;eco.res.grain=100;
 const veg={plants:[],findNearest:()=>null} as any;
 const bld=new BuildingSystem(w,veg,eco,{updateWear(){}} as any,new THREE.Scene());
 const time=new GameTime();time.t=.4;const colony=new Colony(w,veg,eco,bld,new Pathfinder(w),time,()=>.5),c=colony as any;
 Object.assign(c,{jobTimer:10000,houseTimer:10000,healthTimer:10000,lastDay:time.day});
 const animals=new Animals(w);
 const add=(key:Building['key'],x:number,z=0)=>{
  const [sw,sd]=BUILDINGS[key].size;
  const b=new Building(bld.list.length+1,key,Math.round(w.half+x-sw/2),Math.round(w.half+z-sd/2),0,1,w);
  b.complete=true;b.progress=1;bld.list.push(b);(bld as any).setPen(b);
  for(let cz=b.cz;cz<b.cz+b.d;cz++)for(let cx=b.cx;cx<b.cx+b.w;cx++)w.occ[w.idx(cx,cz)]=b.id+1;
  if(['pigpen','chickenpen','butcher','farm'].includes(key))animals.registerPen(b);
  return b;
 };
 const pen=add(species==='chicken'?'chickenpen':'pigpen',-8),butcher=add('butcher',8),store=add('campfire',0,8);
 const animal=animals.list.find(a=>a.sp===species)!;assert.ok(animal);animals.putInPen(animal.id,pen);
 const worker=colony.spawn('m',0,0);worker.role='butcher';worker.workplace=butcher.id;worker.rest=worker.hunger=1;worker.think=10000;
 Object.assign(colony.hooks,{
  reserveSlaughter:(b:any,i:any,blocked:any)=>animals.reserveSlaughter(b,i,blocked),collectSlaughter:(id:number,i:any)=>animals.collectSlaughter(id,i),
  finishSlaughter:(id:number,i:any)=>animals.finishSlaughter(id,i),cancelSlaughter:(id:number,i:any)=>animals.cancelSlaughter(id,i),
  animalPos:(id:number)=>{const a=animals.get(id);return a?.alive?{x:a.x,z:a.z,free:a.pen<0&&!a.heldBy}:null;},
  animalInfo:(id:number)=>{const a=animals.get(id);return a?.alive?{mode:SPECIES[a.sp].capture,meat:SPECIES[a.sp].meat}:null;}
 });
 const tick=(dt=.1)=>{colony.update(dt);animals.update(dt,new THREE.Vector3(),null,colony.grid);};
 return {w,eco,bld,pen,butcher,store,animal,animals,colony,c,worker,add,tick};
}
test('pens retain stock without a completed operational slaughterhouse',()=>{
 const h=fixture();h.butcher.complete=false;
 assert.equal(h.c.work(h.worker),false);assert.equal(h.animals.reserveSlaughter(h.butcher,h.worker),null);
 h.butcher.complete=true;h.butcher.integrity=.5;assert.equal(h.c.work(h.worker),false);
 h.bld.list=h.bld.list.filter(b=>b!==h.butcher);assert.equal(h.c.work(h.worker),false);
 assert.equal(h.animal.alive,true);assert.equal(h.animal.pen,h.pen.id);assert.equal(h.eco.res.meat,0);
 assert.equal(h.animals.takeFromPen(h.pen),false);
});
test('chickens are carried and pigs/goats are led from their actual pen before meat is produced and delivered',()=>{
 for(const species of ['chicken','pig','goat'] as const){
  const h=fixture(species),phases=new Set<number>();assert.equal(h.c.work(h.worker),true);
  for(let n=0;n<2000&&h.eco.res.meat===0;n++){
   const task=h.worker.task;if(task?.kind==='butcher')phases.add(task.phase??0);
   if(task?.kind==='butcher'&&(task.phase??0)<3)assert.equal(h.animal.alive,true,'no remote consumption');
   h.tick();
   if(h.worker.task?.kind==='butcher'&&h.worker.task.phase===2){assert.equal(h.animal.heldBy,h.worker);assert.equal(h.animal.heldMode,species==='chicken'?'carry':'lead');}
  }
  assert.ok(phases.has(0)&&phases.has(1)&&phases.has(2)&&phases.has(3),`missing journey stages: ${species} ${[...phases]}`);
  assert.equal(h.animal.alive,false);assert.equal(h.eco.res.meat,SPECIES[species].meat);assert.ok(h.colony.pathStats.completed>=3);
 }
});
test('reservations prevent duplicate pickups and interrupted trips return live animals to their pen',()=>{
 const h=fixture('pig'),other=h.colony.spawn('f',0,0);
 const reserved=h.animals.reserveSlaughter(h.butcher,h.worker)!;assert.equal(reserved.id,h.animal.id);
 assert.equal(h.animals.reserveSlaughter(h.butcher,other),null);assert.equal(h.animals.collectSlaughter(reserved.id,other),null);
 h.worker.x=h.animal.x;h.worker.z=h.animal.z;h.animals.collectSlaughter(reserved.id,h.worker);h.animals.cancelSlaughter(reserved.id,h.worker);
 assert.equal(h.animal.pen,h.pen.id);assert.equal(h.animal.alive,true);assert.equal(h.animal.heldBy,null);
 assert.ok(h.c.work(h.worker));
 for(let n=0;n<600&&h.worker.task?.phase!==2;n++)h.tick();
 assert.equal(h.worker.task?.phase,2);h.butcher.integrity=.5;h.tick();
 assert.equal(h.worker.task,null);assert.equal(h.animal.pen,h.pen.id);assert.equal(h.eco.res.meat,0);
});
test('transit saves restore animals to their source pen, and a blocked route cannot produce food',()=>{
 const h=fixture('chicken');const reserved=h.animals.reserveSlaughter(h.butcher,h.worker)!;h.worker.x=h.animal.x;h.worker.z=h.animal.z;h.animals.collectSlaughter(reserved.id,h.worker);
 const saved=h.animals.serialize();assert.equal(saved[h.animal.id][3],h.pen.id);
 h.animals.restore(saved,new Map([[h.pen.id,h.pen.id],[h.butcher.id,h.butcher.id]]));assert.equal(h.animal.pen,h.pen.id);assert.equal(h.animal.alive,true);
 h.worker.x=0;h.worker.z=0;
 // Isolate the source pen with a solid wall across the entire map.
 for(let z=0;z<h.w.N;z++)h.w.blockFixed[h.w.idx(h.w.half-4,z)]=1;h.w.navigationVersion++;
 assert.ok(h.c.work(h.worker));for(let n=0;n<600&&h.worker.task;n++)h.tick();
 assert.equal(h.eco.res.meat,0);assert.equal(h.animal.alive,true);assert.equal(h.animal.pen,h.pen.id);
 assert.equal(h.c.work(h.worker),false,'failed pickup is not retried immediately');
});
