/** Paired CPU simulation/instance costs only; no WebGL renderer or mobile device. */
import {performance} from 'node:perf_hooks';
import * as THREE from 'three';
import {World} from '../src/world/World';
import {generateIsland} from '../src/world/generator';
import {growIslets} from '../src/world/islets';
import {WildlifeEncounters} from '../src/entities/WildlifeEncounters';
import {WORLD} from '../src/config';
import {SEA_SURFACE} from '../src/water/Water';
const baseline=process.argv.includes('--baseline');
const ctx=new Proxy({}, {get:(_,k)=>k==='createRadialGradient'||k==='createLinearGradient'?()=>({addColorStop(){}}):()=>{}});
(globalThis as any).document={createElement:()=>({getContext:()=>ctx})};
const {Marine}=await import(baseline?'../src/entities/MarineBaseline':'../src/entities/Marine');
const {SeaTurtles}=await import(baseline?'../src/entities/SeaTurtlesBaseline':'../src/entities/SeaTurtles');
const w=new World();generateIsland(w,WORLD.islandSeed);growIslets(w);
const m=new Marine(w,{shared:{uDay:{value:1}},disturb(){}} as any) as any,t=new SeaTurtles(w,SEA_SURFACE) as any;
const camera=new THREE.Vector3(),scheduler=new WildlifeEncounters({start:()=>null,notify(){},dismiss(){}},undefined,()=>.5);
const bench=(name:string,fn:()=>void,n=2000)=>{for(let i=0;i<180;i++)fn();const values=[];for(let i=0;i<n;i++){const start=performance.now();fn();values.push(performance.now()-start);}values.sort((a,b)=>a-b);return {name,medianMs:values[n>>1],p95Ms:values[Math.floor(n*.95)]};};
const measurements=[bench('marine and turtles, normal routines',()=>{m.update(1/60,camera);t.update(1/60);if(!baseline)scheduler.update(1/60,true);})];
if(!baseline){
 const p=m.pods[0],boat={x:p.x+6,z:p.z,heading:0,speed:1};
 const escort=m.escortCanoe(()=>boat,()=>true);
 if(!escort)throw new Error('Benchmark canoe approach was unsuitable; no active escort was measured.');
 measurements.push(bench('active dolphin escort',()=>{m.update(1/60,camera);t.update(1/60);},600));escort?.finish();
 measurements.push(bench('whale and bay eligibility probe',()=>{const visit=m.offshoreRise();visit?.finish();t.visitBay()?.finish();},100));
}
console.log(JSON.stringify({baseline,seed:WORLD.islandSeed,dolphins:m.dolphins.length,whales:m.whales.length,turtles:t.list.length,measurements,note:'Headless CPU only; normal-routine baseline must be provided from the parent commit as temporary *Baseline.ts files. No GPU, rendered frame or mobile FPS results.'},null,2));
