/** CPU-only fire workload, with and without two continuously burning buildings. */
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { World } from '../src/world/World';
import { Economy } from '../src/economy/Economy';
import { Building, BuildingSystem } from '../src/buildings/Buildings';
import { StormFire } from '../src/buildings/StormFire';
import { Colony } from '../src/ai/Colony';
import { Pathfinder } from '../src/ai/Pathfinder';
import { GameTime } from '../src/world/Time';
import { BUILDINGS } from '../src/config';

function run(population: number, burning: boolean) {
  const world = new World(); world.layer.fill(1); world.computeSmooth();
  const eco = new Economy(); Object.assign(eco.res, { grain: 200, belief: 100 });
  const veg: any = { plants: [], findNearest: () => null, isChoppable: () => false };
  const buildings = new BuildingSystem(world, veg, eco, {} as any, new THREE.Scene());
  const add = (key: Building['key'], x: number, z: number) => {
    const size = BUILDINGS[key].size;
    const b = new Building(buildings.list.length + 1, key, Math.floor(x + world.half - size[0]/2), Math.floor(z + world.half - size[1]/2), 0, 1, world);
    b.complete = true; b.progress = 1; buildings.list.push(b);
    for (let z=b.cz;z<b.cz+b.d;z++) for(let x=b.cx;x<b.cx+b.w;x++) world.occ[world.idx(x,z)]=b.id+1;
    return b;
  };
  add('well', -6, 2); add('well', -6, 8);
  const houses = [add('hut', 8, 2), add('hut', 14, 8)];
  for (let n=0;n<26;n++) add('hut', 30+(n%8)*5, -20+Math.floor(n/8)*5);
  const time = new GameTime(); time.t = .4;
  const colony = new Colony(world, veg, eco, buildings, new Pathfinder(world), time, () => .5);
  const fire = new StormFire(world, veg, eco, buildings, colony, () => .5); fire.unlocked = true;
  colony.hooks.fireJob = i => fire.job(i); colony.hooks.pourWater = b => fire.pour(b);
  colony.hooks.fireRouteFailed = (i,w,f) => fire.routeFailed(i,w,f);
  Object.assign(colony, { jobTimer: 10000, houseTimer: 10000, healthTimer: 10000, lastDay: time.day });
  for(let n=0;n<population;n++) { const i=colony.spawn('m', n<4?-10:-30+(n%20)*1.1, n<4?2+n*2:-20+Math.floor(n/20)*1.1); i.think=10000; i.hunger=i.rest=1; }
  if(burning) houses.forEach(b=>fire.ignite(b));
  const camera=new THREE.PerspectiveCamera(), frames:number[]=[]; let maxRoutes=0;
  for(let n=0;n<1860;n++) {
    // Sustained worst-case effects and dispatch, rather than stopping the benchmark after extinction.
    if(burning) houses.forEach(b=>{b.fire=.7;b.integrity=.9;});
    const completed=colony.pathStats.completed, start=performance.now();
    fire.update(1/60,'storm'); colony.update(1/60); fire.render(n/60,camera);
    if(n>=60)frames.push(performance.now()-start);
    maxRoutes=Math.max(maxRoutes,colony.pathStats.completed-completed);
  }
  return { frames, routes:colony.pathStats.completed, maxRoutes };
}
for(const population of [100,300]) for(const burning of [false,true]) {
  run(population,burning);
  const samples=Array.from({length:8},()=>run(population,burning));
  const frames=samples.flatMap(s=>s.frames).sort((a,b)=>a-b);
  console.log(JSON.stringify({population,burning,samples:frames.length,
    medianMs:+frames[frames.length>>1].toFixed(3),p95Ms:+frames[Math.floor(frames.length*.95)].toFixed(3),
    p99Ms:+frames[Math.floor(frames.length*.99)].toFixed(3),
    routeCalculations:samples.map(s=>s.routes),maxRoutesPerFrame:Math.max(...samples.map(s=>s.maxRoutes)),
    note:'CPU simulation and effect buffer preparation; excludes GPU rendering.'}));
}
