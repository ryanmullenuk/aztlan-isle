/** Deterministic CPU route workloads, not browser/GPU frame rates. */
import { performance } from 'node:perf_hooks';
import { Colony } from '../src/ai/Colony';
import { Pathfinder } from '../src/ai/Pathfinder';
import { World } from '../src/world/World';
import { makeIslander } from '../src/entities/Islander';

function measure(name: string, run: () => { searches: number; astarSearches: number; directTrips: number; frames: number[] }) {
  for (let i = 0; i < 3; i++) run();
  const samples = Array.from({ length: 12 }, run);
  const times = samples.flatMap(s => s.frames).sort((a,b) => a-b);
  const median = (pick: (s: typeof samples[number]) => number) => samples.map(pick).sort((a,b)=>a-b)[6];
  console.log(JSON.stringify({ name, routeCalculations: median(s=>s.searches),
    calculationRange: [Math.min(...samples.map(s=>s.searches)), Math.max(...samples.map(s=>s.searches))],
    astarSearches: median(s=>s.astarSearches), directTrips: median(s=>s.directTrips),
    medianFrameMs: +times[times.length >> 1].toFixed(3), p95FrameMs: +times[Math.floor(times.length * .95)].toFixed(3),
    medianTotalMs: +samples.map(s=>s.frames.reduce((a,b)=>a+b,0)).sort((a,b)=>a-b)[6].toFixed(3) }));
}
function fixture() {
  const w = new World(); w.layer.fill(1); w.computeSmooth();
  const pf = new Pathfinder(w); let searches = 0;
  const find = pf.find.bind(pf); pf.find = (...args) => { searches++; return find(...args); };
  const c = new Colony(w, { plants: [] } as any, {} as any, { byId: () => null } as any, pf, {} as any, () => .5) as any;
  return { w, pf, c, counts: () => ({ searches, astarSearches: pf.stats?.searches ?? searches, directTrips: pf.stats?.direct ?? 0 }) };
}
measure('20 moving-animal pursuits, 10 seconds / 100 frames', () => {
  const { c, counts } = fixture(); const frames: number[] = [];
  const people = Array.from({length:20}, (_,id) => makeIslander(id+1,'A','m',-30,(id-10)*4,()=>.5));
  c.list = people;
  people.forEach(p=>c.setTask(p,'capture',p.id,30,p.z));
  c.hooks = { animalPos: (id:number) => ({x:30+Math.sin(c.clock*8)*2,z:(id-11)*4,free:true}), catchable: () => false };
  for (let frame=0;frame<100;frame++) {
    const start=performance.now(); c.clock+=.1; c.processPaths();
    people.forEach(p=>c.runTask(p,.1)); frames.push(performance.now()-start);
  }
  return {...counts(),frames};
});
measure('100 repeated requests for one unchanged walking destination', () => {
  const {c,counts}=fixture(), frames:number[]=[];
  const p=makeIslander(1,'A','m',-20.5,.5,()=>.5);c.setTask(p,'goto',-1,20.5,.5);
  for(let frame=0;frame<100;frame++) {
    const start=performance.now();c.requestPath(p,20.5,.5);c.processPaths();frames.push(performance.now()-start);
  }
  return {...counts(),frames};
});
measure('100 short unobstructed village trips', () => {
  const {pf,counts}=fixture(),frames:number[]=[];
  for(let frame=0;frame<100;frame++) {
    const start=performance.now();pf.find(.5,.5,8.5,.5);frames.push(performance.now()-start);
  }
  return {...counts(),frames};
});
