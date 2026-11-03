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
import {BUILDINGS,FARM_TYPES,JETTY,SMOKE,SPECIES} from '../src/config';
import {FX,UPGRADES} from '../src/buildings/Upgrades';
import * as U from '../src/buildings/foodUpgrades';

const mk=(key:any,tier:number,o:any={})=>({key,tier,complete:true,integrity:1,...o});
function fixture(){
 const w=new World();w.seed=7;w.layer.fill(1);w.computeSmooth();
 const eco=new Economy();eco.foodCap=1000;eco.woodCap=1000;eco.res.grain=100;
 const veg={plants:[],findNearest:()=>null} as any;
 const bld=new BuildingSystem(w,veg,eco,{updateWear(){}} as any,new THREE.Scene());
 const time=new GameTime();time.t=.4;const colony=new Colony(w,veg,eco,bld,new Pathfinder(w),time,()=>.5),c=colony as any;
 Object.assign(c,{jobTimer:10000,houseTimer:10000,healthTimer:10000,lastDay:time.day});
 const animals=new Animals(w);
 const add=(key:Building['key'],x:number,z=0,tier=1)=>{
  const [sw,sd]=BUILDINGS[key].size;
  const b=new Building(bld.list.length+1,key,Math.round(w.half+x-sw/2),Math.round(w.half+z-sd/2),0,1,w);
  b.tier=tier;b.complete=true;b.progress=1;bld.list.push(b);(bld as any).setPen(b);
  for(let cz=b.cz;cz<b.cz+b.d;cz++)for(let cx=b.cx;cx<b.cx+b.w;cx++)w.occ[w.idx(cx,cz)]=b.id+1;
  if(['pigpen','chickenpen','butcher','farm'].includes(key))animals.registerPen(b);
  return b;
 };
 add('campfire',0,8);
 Object.assign(colony.hooks,{
  penCount:(b:any)=>animals.penCount(b),
  reserveSlaughter:(b:any,i:any,blocked:any)=>animals.reserveSlaughter(b,i,blocked),collectSlaughter:(id:number,i:any)=>animals.collectSlaughter(id,i),
  finishSlaughter:(id:number,i:any)=>animals.finishSlaughter(id,i),cancelSlaughter:(id:number,i:any)=>animals.cancelSlaughter(id,i),
  animalPos:(id:number)=>{const a=animals.get(id);return a?.alive?{x:a.x,z:a.z,free:a.pen<0&&!a.heldBy}:null;},
  animalInfo:(id:number)=>{const a=animals.get(id);return a?.alive?{name:SPECIES[a.sp].name,food:true,needsPen:SPECIES[a.sp].needsPen,mode:SPECIES[a.sp].capture,meat:SPECIES[a.sp].meat}:null;},
  canCapture:(id:number)=>{const a=animals.get(id);return !!a&&animals.capturable(a);},
  beginChase:(id:number,i:any)=>animals.beginChase(id,i),
  wildChicken:(x:number,z:number,r:number)=>animals.nearestWild('chicken',x,z,r),
 });
 const worker=(role:any,workplace:Building)=>{const i=colony.spawn('m',0,0);i.role=role;i.workplace=workplace.id;i.rest=i.hunger=1;i.think=10000;return i;};
 const tick=(dt=.1)=>{colony.update(dt);animals.update(dt,new THREE.Vector3(),null,colony.grid);};
 return {w,eco,bld,animals,colony,c,time,add,worker,tick};
}
const pen=(h:ReturnType<typeof fixture>,b:Building,sp:'chicken'|'pig'|'goat'|'any',n:number)=>{
 const free=h.animals.list.filter(a=>(sp==='any'?a.sp!=='tapir':a.sp===sp)&&a.alive&&a.pen<0).slice(0,n);assert.equal(free.length,n);
 for(const a of free)h.animals.putInPen(a.id,b);return free;
};

test('each food upgrade step does what it says once finished, and only while the building works',()=>{
 assert.equal(U.growthFactor(mk('farm',1)),1);assert.equal(U.growthFactor(mk('farm',2)),FX.farm.growth);
 assert.equal(U.harvestFactor(mk('farm',3)),1);assert.equal(U.harvestFactor(mk('farm',4)),FX.farm.yield);
 assert.equal(U.catchesChickens(mk('farm',3)),false);assert.equal(U.catchesChickens(mk('farm',4)),true);
 assert.equal(U.harvestFactor(mk('maizefarm',2)),1);assert.equal(U.harvestFactor(mk('maizefarm',3)),FX.maizefarm.yield);
 assert.equal(U.harvestFish(mk('chinampa',2)),0);assert.equal(U.harvestFish(mk('chinampa',3)),FX.chinampa.fish);
 assert.equal(U.smokeSeconds(mk('smokehouse',2),SMOKE.batchSeconds),SMOKE.batchSeconds/FX.smokehouse.speed);
 assert.equal(U.smokeWood(mk('smokehouse',2),1),1);assert.equal(U.smokeWood(mk('smokehouse',3),1),FX.smokehouse.wood);
 assert.equal(U.meatFactor(mk('butcher',2),null),1);assert.equal(U.meatFactor(mk('butcher',3),null),FX.butcher.meat);
 assert.equal(U.meatFactor(mk('butcher',1),mk('pigpen',4)),FX.pigpen.meat);assert.equal(U.meatFactor(mk('butcher',1),mk('chickenpen',4)),1);
 assert.equal(U.butcherSeconds(mk('butcher',3),8),8);assert.equal(U.butcherSeconds(mk('butcher',4),8),8/FX.butcher.speed);
 assert.equal(U.penRoom(mk('pigpen',1)),10);assert.equal(U.penRoom(mk('pigpen',2)),15);
 assert.equal(U.penRoom(mk('chickenpen',1)),16);assert.equal(U.penRoom(mk('chickenpen',2)),24);assert.equal(U.penRoom(mk('farm',4)),Infinity);
 assert.equal(U.breedSeconds(mk('pigpen',2)),0);assert.equal(U.breedSeconds(mk('pigpen',3)),FX.pigpen.breedSeconds);
 assert.equal(U.breedSeconds(mk('chickenpen',3)),0);assert.equal(U.breedSeconds(mk('chickenpen',4)),FX.chickenpen.breedSeconds);
 assert.equal(U.eggSeconds(mk('chickenpen',2)),0);assert.equal(U.eggSeconds(mk('chickenpen',3)),FX.chickenpen.eggSeconds);
 assert.equal(U.jettyBoats(mk('jetty',1)),JETTY.maxBoats);assert.equal(U.jettyBoats(mk('jetty',2)),JETTY.maxBoats+1);
 assert.equal(U.catchFactor(mk('jetty',2),mk('fishhut',2)),1);
 assert.equal(U.catchFactor(mk('jetty',3),mk('fishhut',3)),FX.jetty.catch*FX.fishhut.catch);
 assert.equal(U.nightFishing(mk('jetty',3)),false);assert.equal(U.nightFishing(mk('jetty',4)),true);
 // Damaged, burning or ruined: as if never upgraded.
 for(const o of [{integrity:.5},{fire:1},{ruined:true},{complete:false}]){
  assert.equal(U.growthFactor(mk('farm',4,o)),1);assert.equal(U.jettyBoats(mk('jetty',4,o)),JETTY.maxBoats);
  assert.equal(U.penRoom(mk('pigpen',4,o)),10);assert.equal(U.catchFactor(mk('jetty',4,o),mk('fishhut',4,o)),1);
 }
 // The cards state the pens' real numbers.
 assert.match(UPGRADES.pigpen![0].text,new RegExp(`${U.penRoom(mk('pigpen',2))} animals instead of ${U.PEN_ROOM.pigpen}`));
 assert.match(UPGRADES.chickenpen![0].text,new RegExp(`${U.penRoom(mk('chickenpen',2))} chickens instead of ${U.PEN_ROOM.chickenpen}`));
});

test('irrigated farms grow faster than plain ones',()=>{
 const h=fixture(),plain=h.add('farm',-10,-10),wet=h.add('farm',10,-10,2);(h.bld as any).batching=false;
 for(const f of [plain,wet])f.tendTimer=100;
 h.bld.update(20,0,0,1,false,new THREE.Vector3());
 assert.ok(plain.growth>0);assert.ok(Math.abs(wet.growth/plain.growth-FX.farm.growth)<1e-6,`${wet.growth/plain.growth}`);
});

test('terraced and Three Sisters harvests are bigger, and channel beds bring in fish',()=>{
 const harvest=(key:'farm'|'maizefarm'|'chinampa',tier:number)=>{
  const h=fixture(),f=h.add(key,-6,-6,tier),i=h.worker('farmer',f);f.growth=1;
  h.c.setTask(i,'farm',f.id,i.x,i.z);i.task.stage=2;i.task.timer=.01;
  const fish=h.eco.res.fish;h.tick();
  return {grain:f.stock+(i.carry?.n??0),fish:h.eco.res.fish-fish};
 };
 assert.deepEqual(harvest('farm',3),{grain:FARM_TYPES.farm!.yield,fish:0});
 assert.deepEqual(harvest('farm',4),{grain:Math.round(FARM_TYPES.farm!.yield*FX.farm.yield),fish:0});
 assert.deepEqual(harvest('maizefarm',2),{grain:FARM_TYPES.maizefarm!.yield,fish:0});
 assert.deepEqual(harvest('maizefarm',3),{grain:Math.round(FARM_TYPES.maizefarm!.yield*FX.maizefarm.yield),fish:0});
 assert.deepEqual(harvest('chinampa',2),{grain:FARM_TYPES.chinampa!.yield,fish:0});
 assert.deepEqual(harvest('chinampa',3),{grain:FARM_TYPES.chinampa!.yield,fish:FX.chinampa.fish});
});

test('farmers of a terraced farm catch a wild chicken nearby for its run, until the run is full',()=>{
 const h=fixture(),f=h.add('farm',-6,-6,4),i=h.worker('farmer',f);
 const hen=h.animals.list.find(a=>a.sp==='chicken'&&a.alive)!;Object.assign(hen,{x:f.x+3,z:f.z+3});
 h.c.rnd=()=>.1;h.c.farmChicken(i,f);assert.equal(h.animals.get(i.task.target)!.sp,'chicken');assert.equal(i.task?.kind,'capture');assert.equal(i.task.building,f.id);
 h.c.releaseTask(i);
 pen(h,f,'chicken',U.FARM_RUN);h.c.farmChicken(i,f);assert.notEqual(i.task?.kind,'capture');
 const plain=h.add('farm',10,-6,3);h.c.farmChicken(i,plain);assert.notEqual(i.task?.kind,'capture');
});

test('a second rack smokes twice as fast and a clay chimney burns half the wood',()=>{
 const h=fixture(),s=h.add('smokehouse',-6,-6,3),i=h.worker('smoker',s);
 h.eco.res.fish=10;h.eco.res.wood=10;
 assert.ok(h.c.work(i));assert.equal(i.task.kind,'smoke');
 let n=0;for(;n<3000&&i.task?.stage!==2;n++)h.tick();
 assert.equal(i.task.stage,2);assert.ok(i.task.timer<=SMOKE.batchSeconds/FX.smokehouse.speed+1e-6);
 for(n=0;n<3000&&i.task?.kind==='smoke';n++)h.tick();
 assert.equal(h.eco.res.wood,10-SMOKE.wood*FX.smokehouse.wood);assert.equal(h.eco.res.fish,10-SMOKE.input+SMOKE.output);
 // Half a log is still enough to start a batch.
 h.eco.res.wood=.5;assert.ok(h.c.work(i));
});

test('salting tables and troughs give more meat, and a butcher’s block prepares it faster',()=>{
 const h=fixture(),p=h.add('pigpen',-8,0,4),b=h.add('butcher',8,0,4),i=h.worker('butcher',b);
 const [pig]=pen(h,p,'pig',1);
 assert.ok(h.c.work(i));assert.equal(i.task.meatYield,Math.round(SPECIES.pig.meat*FX.butcher.meat*FX.pigpen.meat));
 let quick=Infinity;
 for(let n=0;n<3000&&h.eco.res.meat===0;n++){h.tick();if(i.task?.kind==='butcher'&&i.task.phase===3)quick=Math.min(quick,i.task.timer);}
 assert.equal(pig.alive,false);assert.ok(quick<=8/FX.butcher.speed+1e-6,`${quick}`);
 assert.equal(h.eco.res.meat,Math.round(SPECIES.pig.meat*FX.butcher.meat*FX.pigpen.meat));
});

test('pens hold so many, more once enlarged, and full pens are passed over',()=>{
 const h=fixture(),p=h.add('pigpen',-8,0),b=h.add('butcher',8,0);
 const stock=[...pen(h,p,'pig',6),...pen(h,p,'goat',4)];
 assert.equal(h.animals.penCount(p),10);assert.equal(h.c.penFull(p),true);
 assert.equal(h.c.penFor('lead',p.x,p.z),b,'a full pen sends animals to the slaughterhouse yard');
 const wild=h.animals.list.filter(a=>a.sp==='pig'&&h.animals.capturable(a));
 assert.equal(h.colony.roundUp(p,wild),0);
 p.tier=2;assert.equal(h.c.penFull(p),false);assert.equal(h.c.penFor('lead',p.x,p.z),p);
 assert.ok(stock.every(a=>a.pen===p.id));
});

test('breeding pens add a young one now and then, and penned hens lay eggs',()=>{
 const h=fixture(),p=h.add('pigpen',-8,0,3),c=h.add('chickenpen',8,0,4),island=h.animals.list.length;
 pen(h,p,'pig',2);
 const hens=pen(h,c,'chicken',4).filter(a=>a.bodyKey!=='chicken_rooster').length;
 const eggs:number[]=[];h.animals.onEggs=n=>eggs.push(n);
 const pigs=()=>h.animals.list.filter(a=>a.alive&&a.pen===p.id&&a.sp==='pig').length;
 const chicks=()=>h.animals.list.filter(a=>a.alive&&a.pen===c.id).length;
 const life=(dt:number)=>(h.animals as any).penLife(dt);
 life(FX.chickenpen.eggSeconds-1);assert.deepEqual(eggs,[]);
 life(1);assert.deepEqual(eggs,[hens]);
 life(FX.pigpen.breedSeconds-FX.chickenpen.eggSeconds);assert.equal(pigs(),3);assert.equal(chicks(),5);
 // Saved and loaded, a pig born when none was waiting to come back is still a pig.
 const born=h.animals.list.filter(a=>a.sp==='pig').pop()!;assert.ok(born.id>=island);
 const saved=h.animals.serialize(),again=new Animals(h.w);
 again.restore(saved,new Map([[p.id,p.id],[c.id,c.id]]));assert.equal(again.list.length,h.animals.list.length);
 assert.equal(again.list[born.id].sp,born.sp);
 // Not without the upgrade, and not once the pen is full.
 const q=h.add('pigpen',-8,12,2);pen(h,q,'goat',2);life(FX.pigpen.breedSeconds);
 assert.equal(h.animals.penCount(q),2);
 pen(h,p,'any',U.penRoom(p)-h.animals.penCount(p));
 const full=h.animals.penCount(p);life(FX.pigpen.breedSeconds);assert.equal(h.animals.penCount(p),full);
});

test('lantern jetties keep their fishers at work after dark',()=>{
 const h=fixture(),j=h.add('jetty',-8,0,3),i=h.worker('fisher',j);j.boats=[1];
 for(let t=0;t<1;t+=.005){h.time.t=t;if(h.time.isNight&&h.time.hour<4)break;}
 assert.ok(h.time.isNight);
 h.c.think(i);assert.equal(i.task?.kind,'sleep');
 h.c.releaseTask(i);j.tier=4;h.c.think(i);assert.equal(i.task?.kind,'fish');
});
