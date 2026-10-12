/** CPU costs only. A WebGL device is required for rendered frame times. */
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { World } from '../src/world/World';
import { View } from '../src/render/View';
const baseline=process.argv.includes('--baseline');
const {Coral}=await import(baseline?'../src/entities/CoralBaseline':'../src/entities/Coral');
const {ReefFish}=await import(baseline?'../src/entities/ReefFishBaseline':'../src/entities/ReefFish');
const world=new World();world.seed=71;world.layer.fill(-2);world.computeSmooth();
const start=performance.now(),coral=new Coral(world),placementMs=performance.now()-start;
const reefPoints=Array.from({length:36},(_,k)=>({x:(k%6)*16-40,z:Math.floor(k/6)*16-40}));
const fish=new ReefFish(world,reefPoints);
const bench=(name:string,fn:()=>void,n=300)=>{for(let k=0;k<30;k++)fn();const a=[];for(let k=0;k<n;k++){const t=performance.now();fn();a.push(performance.now()-t);}a.sort((a,b)=>a-b);return{name,medianMs:a[n>>1],p95Ms:a[Math.floor(n*.95)]};};
const center=fish.schools[0]??{x:0,z:0};
const measurements=[];
for(const [name,height] of [['mobile-low-distance',28],['close-detail',8]] as const){
 const camera=new THREE.PerspectiveCamera(50,390/844,.1,300);camera.position.set(center.x,height,center.z+height);camera.lookAt(center.x,0,center.z);View.update(camera);
 measurements.push(bench(name,()=>fish.update(1/60,null,[])));
}
if(typeof coral.refresh==='function')measurements.push(bench('8x8 local habitat refresh',()=>coral.refresh(96,96,103,103),40));
console.log(JSON.stringify({baseline,placementMs,habitatMeshes:coral.group.children.length,fish:fish.fish.length,measurements,note:'CPU simulation/instance updates only; no GPU or whole-game frame measurement.'},null,2));
