/** CPU-side water costs only; rendered GPU frame times require a WebGL device. */
import { performance } from 'node:perf_hooks';
import { World } from '../src/world/World';
import { Water } from '../src/water/Water';
const WaterClass = process.argv[2] ? (await import(new URL(process.argv[2], import.meta.url).href)).Water as typeof Water : Water;
const world = new World();
for (let z = 0; z < world.N; z++) for (let x = 0; x < world.N; x++) {
  const coast = world.half + Math.sin(z / 18) * 8;
  world.layer[world.idx(x,z)] = x < coast ? 1 : Math.max(-6, -Math.floor((x - coast) / 3) - 1);
}
world.computeSmooth();
const water = new WaterClass(world);
function measure(name: string, fn: () => void, samples: number) {
  for(let n=0;n<5;n++)fn();
  const times=[]; for(let n=0;n<samples;n++){const t=performance.now();fn();times.push(performance.now()-t);}
  times.sort((a,b)=>a-b);return {name,samples,medianMs:+times[Math.floor(samples/2)].toFixed(5),p95Ms:+times[Math.floor(samples*.95)].toFixed(5)};
}
let time=0;
const result={implementation:process.argv[2]??'current',worldSize:world.N,textureSize:world.N*2,
  measurements:[measure('water CPU frame update, calm',()=>{time+=1/60;water.update(1/60,time);},1000),
  measure('water CPU frame update, storm',()=>{water.shared.uStorm.value=1;time+=1/60;water.update(1/60,time);},1000),
  measure('shore texture refresh, 8x8 edit rectangle',()=>water.updateHeight(96,96,103,103),80)],
  note:'No WebGL renderer: these are CPU water update times, not whole-game frame times or GPU timings.'};
console.log(JSON.stringify(result,null,2));
