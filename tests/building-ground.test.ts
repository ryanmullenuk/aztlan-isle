import {test} from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../src/world/World';
import {Building} from '../src/buildings/Buildings';
import {withBuildingGround} from '../src/buildings/BuildingGround';
import {hutModel} from '../src/buildings/models';
function fixture(){const w=new World();w.seed=7;w.layer.fill(1);w.computeSmooth();const b=new Building(1,'hut',99,99,0,1,w);return {w,b};}
test('irregular building margins are deterministic visual geometry and leave gameplay maps untouched',()=>{
 const {w,b}=fixture(),before={occ:[...w.occ],soil:[...w.soil],path:[...w.path],layer:[...w.layer]};
 const original=hutModel().finished,baseVertices=original.getAttribute('position').count;
 const a=withBuildingGround(original,b,w),second=withBuildingGround(hutModel().finished,b,w);
 assert.ok(a.getAttribute('position').count>baseVertices);assert.deepEqual(a.getAttribute('position').array,second.getAttribute('position').array);
 for(const key of ['position','normal','color','aVeg','aMat'])assert.ok([...a.getAttribute(key).array].every(Number.isFinite));
 const p=a.getAttribute('position'),xs=new Set<number>(),zs=new Set<number>();
 for(let i=baseVertices;i<p.count;i++){xs.add(Math.round(p.getX(i)*100));zs.add(Math.round(p.getZ(i)*100));}
 assert.ok(xs.size>20&&zs.size>20,'wandering perimeter rather than four straight plot edges');
 assert.deepEqual({occ:[...w.occ],soil:[...w.soil],path:[...w.path],layer:[...w.layer]},before);a.dispose();second.dispose();
});
test('building margin scenery stays off paths, adjacent occupied cells and water',()=>{
 const {w,b}=fixture();
 // A path along one edge, another building on the opposite edge, water at the back.
 for(let z=96;z<103;z++)w.path[w.idx(101,z)]=1;
 for(let z=96;z<103;z++)w.occ[w.idx(98,z)]=42;
 for(let x=96;x<104;x++)w.layer[w.idx(x,98)]=-2;w.computeSmooth();
 const original=hutModel().finished,base=original.getAttribute('position').count,g=withBuildingGround(original,b,w),p=g.getAttribute('position');
 for(let i=base;i<p.count;i++){
  const [x,z]=b.local(p.getX(i),p.getZ(i)),cell=w.cellIndexAt(x,z);
  assert.equal(w.path[cell],0);assert.notEqual(w.occ[cell],42);assert.equal(w.isLandCell(cell),true);
 }
 g.dispose();
});
