import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Building} from '../src/buildings/Buildings';
import {marketSquareModel} from '../src/buildings/models';
import {Economy} from '../src/economy/Economy';
import {marketBatch} from '../src/economy/Market';
import {TradeFleet} from '../src/entities/Trade';
import {Colony} from '../src/ai/Colony';
import {makeIslander} from '../src/entities/Islander';
import {BUILD_MENU} from '../src/ui/tools';
const world={half:100,layerY:()=>0,groundY:()=>0} as any;
const market=()=>{const b=new Building(1,'market',100,100,0,0,world);b.complete=true;return b;};
test('market is buildable, courtyard geometry remains in its footprint with finite attributes',()=>{
 assert.ok(BUILD_MENU.includes('market'));
 const m=marketSquareModel();m.finished.computeBoundingBox();const box=m.finished.boundingBox!;
 assert.ok(box.min.x>=-2.5&&box.max.x<=2.5&&box.min.z>=-2.5&&box.max.z<=2.5);
 assert.equal(m.torches.length,2);
 for(const v of m.finished.getAttribute('position').array)assert.ok(Number.isFinite(v));
});
test('surplus deliveries respect material reserves, shared food reserves and loads already underway',()=>{
 const e=new Economy(),b=market();Object.keys(e.res).forEach(k=>e.res[k as keyof typeof e.res]=0);
 e.res.wood=40;e.res.stone=30;assert.equal(marketBatch(e,20,b,[b],[]),null);
 e.res.wood=50;assert.deepEqual(marketBatch(e,20,b,[b],[]),{res:'wood',n:8});
 b.marketStock.wood=8;assert.deepEqual(marketBatch(e,20,b,[b],[]),{res:'wood',n:2});
 e.res.wood=40;b.marketStock.wood=0;e.res.grain=50;e.res.fruit=50;b.marketStock.grain=16;
 assert.deepEqual(marketBatch(e,20,b,[b],[], 'fruit'),{res:'fruit',n:4});
 const i=makeIslander(1,'A','m',0,0,()=>.5);i.carry={kind:'fruit',res:'fruit',n:4,market:1};
 assert.equal(marketBatch(e,20,b,[b],[i],'fruit'),null);
});
test('goods are displayed only on arrival and never counted twice in village inventory',()=>{
 const e=new Economy(),b=market(),buildings={list:[b],byId:()=>b} as any;
 const c=new Colony(world,{} as any,e,buildings,{} as any,{} as any,()=>.5),i=makeIslander(1,'A','m',0,0,()=>.5);
 i.carry={kind:'log',res:'wood',n:8,market:1};i.task={kind:'deliver',target:1,x:0,z:0,stage:0,timer:0} as any;
 const before=e.res.wood;(c as any).travel=()=> 'walking';(c as any).runTask(i,1);assert.equal(b.marketStock.wood,undefined);
 (c as any).travel=()=> 'arrived';(c as any).runTask(i,1);assert.equal(b.marketStock.wood,8);assert.equal(e.res.wood,before);assert.equal(i.carry,null);
});
test('canoe exchanges require delivered surplus, retain reserves and spend each offer exactly once',()=>{
 const e=new Economy(),b=market();e.res.wood=70;e.res.stone=40;e.woodCap=200;b.marketStock.wood=20;
 const deal={give:{wood:12},get:{stone:8},taken:false};const visitor={dock:1,state:'moored',deals:[deal],timer:100};
 const f=Object.create(TradeFleet.prototype);f.eco=e;f.population=()=>10;f.visitors=[visitor];
 assert.equal(f.whyNot(deal,b),null);f.accept(b,0);assert.equal(e.res.wood,58);assert.equal(e.res.stone,48);assert.equal(b.marketStock.wood,8);
 f.accept(b,0);assert.equal(e.res.wood,58);
 deal.taken=false;b.marketStock.wood=0;assert.match(f.whyNot(deal,b),/deliveries/);
 b.marketStock.wood=20;e.res.wood=45;assert.match(f.whyNot(deal,b),/reserve/);
});
test('inland markets find a clear shore on their own island and cache the berth for the visit',()=>{
 const N=20,w={N,layer:new Int8Array(N*N),isle:new Int8Array(N*N),sandy:new Uint8Array(N*N),occ:new Int32Array(N*N),idx:(x:number,z:number)=>z*N+x,centerX:(x:number)=>x+.5,centerZ:(z:number)=>z+.5,cellIndexAt:(x:number,z:number)=>Math.floor(z)*N+Math.floor(x),isLandCell(i:number){return this.layer[i]>0;},blocked:()=>false};
 for(let z=7;z<=12;z++)for(let x=7;x<=12;x++){const i=w.idx(x,z);w.layer[i]=1;w.isle[i]=1;w.sandy[i]=1;}
 const f=Object.create(TradeFleet.prototype);f.world=w;f.boats={open:(x:number,z:number)=>x>=0&&z>=0&&x<N&&z<N&&w.layer[w.cellIndexAt(x,z)]===0};
 const b=market();b.x=10;b.z=10;const landing=f.marketLanding(b);assert.ok(landing);assert.ok(f.boats.open(landing.x,landing.z));assert.ok(f.boats.open(landing.approach.x,landing.approach.z));
 f.marketLanding=()=>{throw Error('must not rescan')};assert.equal(f.visitorBerth({landing},b),landing);
});
