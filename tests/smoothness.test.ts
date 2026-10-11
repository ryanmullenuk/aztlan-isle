import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Colony } from '../src/ai/Colony';
import { makeIslander } from '../src/entities/Islander';
import { SpatialHash } from '../src/world/SpatialHash';
import { Game } from '../src/Game';
import { IslanderRig } from '../src/entities/IslanderRig';
import { InstancedBufferAttribute } from 'three';

test('grid clears current buckets and safely reuses previously visited cells', () => {
  const grid = new SpatialHash<{x:number;z:number}>(2);
  const a = {x:0,z:0}, b = {x:3,z:0};
  for(let i=0;i<10000;i++)grid.insert({x:i*2,z:50});
  grid.clear(); grid.insert(a); grid.insert(b); grid.insert(a);
  let hits = 0; grid.query(0,0,10,()=>hits++); assert.equal(hits,3);
  grid.clear(); grid.insert(b);
  const found: any[] = []; grid.query(0,0,100,person=>found.push(person));
  assert.deepEqual(found,[b]);
  assert.equal((grid as any).active.length,1);
});

test('path queue spreads expensive routes across frames and rejects cancelled or superseded destinations', t => {
  let clock=0,calls=0;
  t.mock.method(performance,'now',()=>clock);
  const c=new Colony({} as any,{} as any,{} as any,{} as any,
    {find:()=>{calls++;clock+=4;return [{x:1,z:2}];}} as any,{} as any,()=>.5) as any;
  const people=Array.from({length:5},(_,id)=>makeIslander(id,'A','m',0,0,()=>.5));
  for(const p of people){p.task={kind:'goto',target:-1,stage:0,timer:0,x:1,z:2};c.requestPath(p,1,2);}
  c.cancelTask(people[0]); c.setTask(people[1],'wander',-1,3,4);
  c.processPaths(); assert.equal(calls,1); assert.equal(c.queue.length,2);
  assert.equal(people[0].path,null);assert.equal(people[1].path,null);
  assert.deepEqual(people[2].path,[{x:1,z:2}]);assert.equal(people[2].pathPending,false);
  c.processPaths(); c.processPaths();assert.equal(calls,3);assert.equal(c.queue.length,0);
});

test('frame-rate reporting measures real slow frames while simulation catch-up stays bounded', () => {
  (globalThis as any).document={hidden:false};
  const g=Object.create(Game.prototype) as any;let advanced=0,drawn=0;
  Object.assign(g,{playing:true,canvas:{clientWidth:390,clientHeight:844},clock:{update(){},getDelta:()=>.2},
    time:{advance:(dt:number)=>{advanced+=dt;return dt;}},cpuTime:0,fps:{frames:0,acc:0,value:60},
    update(){},render(){drawn++;},trackWorstFrame(){},autoQuality(){}});
  for(let i=0;i<6;i++)g.frame();
  assert.ok(Math.abs(g.fps.value-5)<.01);assert.ok(Math.abs(advanced-.6)<.01);
  (globalThis as any).document.hidden=true;g.frame();assert.equal(drawn,6);
});

test('islander GPU uploads cover only visible instances and shrink after a crowd leaves', () => {
  const rig=Object.create(IslanderRig.prototype) as any;
  const matrix=new InstancedBufferAttribute(new Float32Array(200*16),16);
  const colour=new InstancedBufferAttribute(new Float32Array(200*3),3);
  rig.upload(matrix,100);rig.upload(colour,100);
  rig.upload(matrix,2);rig.upload(colour,2);
  assert.deepEqual(matrix.updateRanges,[{start:0,count:32}]);
  assert.deepEqual(colour.updateRanges,[{start:0,count:6}]);
  assert.ok(matrix.version>0&&colour.version>0);
});
