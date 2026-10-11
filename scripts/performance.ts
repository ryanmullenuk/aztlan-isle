/** CPU benchmarks: run with node --import tsx scripts/performance.ts. No GPU/FPS claims. */
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { SpatialHash } from '../src/world/SpatialHash';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { WORLD, RENDER } from '../src/config';
import { Colony } from '../src/ai/Colony';
import { Pathfinder } from '../src/ai/Pathfinder';
import { avoidCrowd } from '../src/ai/CrowdAvoidance';
import { makeIslander } from '../src/entities/Islander';
import { Vegetation } from '../src/vegetation/Vegetation';
(globalThis as any).document = { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) };
function bench(name: string, fn: () => void, n = 600) {
  for (let i = 0; i < 60; i++) fn();
  const times: number[] = [];
  for (let i = 0; i < n; i++) { const t = performance.now(); fn(); times.push(performance.now() - t); }
  times.sort((a,b) => a-b);
  console.log(JSON.stringify({ name, samples: n, medianMs: +times[n >> 1].toFixed(3), p95Ms: +times[Math.floor(n * .95)].toFixed(3) }));
}
const grid = new SpatialHash<{ x: number; z: number }>(2);
for (let i = 0; i < 30000; i++) grid.insert({ x: i * 2, z: 0 });
grid.clear();
bench('grid rebuild after 30,000 historical cells (100 active)', () => { grid.clear(); for (let i=0;i<100;i++) grid.insert({x:i*.5,z:0}); });
for (const population of [100, 300]) {
  const people = Array.from({length:population}, (_,i) => { const p=makeIslander(i,'A','m',(i%20)*.7,Math.floor(i/20)*.7,()=>.5); p.anim='walk';p.speed=1;p.heading=i%2?Math.PI/2:-Math.PI/2;return p; });
  const hash=new SpatialHash<(typeof people)[0]>(2);people.forEach(p=>hash.insert(p));
  bench(`crowd avoidance ${population} walkers`,()=>{for(const p of people)avoidCrowd(p,1,0,1,hash,()=>true);});
}
const w = new World(); generateIsland(w,WORLD.islandSeed); growIslets(w);
const pf = new Pathfinder(w);
bench('five long path searches (storm queue)',()=>{for(let k=0;k<5;k++)pf.find(w.meadow.x,w.meadow.z,w.meadow.x+70,w.meadow.z+70);},120);
for (const preset of ['low','high'] as const) {
  const veg=new Vegetation(w,preset);veg.build();let frame=0;
  const cam=new THREE.Vector3(w.meadow.x,25,w.meadow.z), target=new THREE.Vector3(w.meadow.x,0,w.meadow.z);
  bench(`vegetation ${preset}, moving camera`,()=>{frame++;cam.x=w.meadow.x+Math.sin(frame/100)*15;veg.update(1/60,cam,target,RENDER.presets[preset].lodDist,1,frame/60,RENDER.presets[preset].vegLod);});
}

const colony = new Colony(w, {} as any, {} as any, {} as any, pf, {} as any, () => .5) as any;
const runners = Array.from({length:5},(_,id)=>makeIslander(id,'A','m',w.meadow.x,w.meadow.z,()=>.5));
let completed = 0;
bench('budgeted long-path work per frame',()=>{
  colony.queue = runners.map(isl=>{isl.pathPending=true;return {isl,task:isl.task,x:w.meadow.x+70,z:w.meadow.z+70,opts:{}};});
  colony.processPaths();completed += 5 - colony.queue.length;
},120);
console.log(JSON.stringify({name:'budgeted queue',meanRequestsPerFrame:completed/180, note:'One individual search is synchronous; remaining routes continue on later frames.'}));
