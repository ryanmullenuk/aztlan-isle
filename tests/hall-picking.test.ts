import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {HALL,hallBellGeometry,greatHallModel} from '../src/buildings/models';
import {Colony} from '../src/ai/Colony';
import {pickBuilding} from '../src/buildings/Picking';
function building(id=1,x=0,z=0,w=4,d=4){
 const group=new THREE.Group(),finished=new THREE.Mesh(new THREE.BoxGeometry(1,3,1),new THREE.MeshBasicMaterial());finished.position.y=1.5;group.position.set(x,0,z);group.add(finished);
 return {id,x,z,y:0,w,d,group,finished} as any;
}
test('hall reserves 100 distinct seats and does not double-book a full hall',()=>{
 assert.equal(HALL.seats.length,100);assert.equal(new Set(HALL.seats.map(p=>`${p.x},${p.z}`)).size,100);
 const c={list:[],rnd:()=>.3} as any,b={id:1};
 for(let n=0;n<100;n++){const k=(Colony.prototype as any).freeSlot.call(c,b,false);assert.ok(k>=0&&k<100);c.list.push({task:{kind:'hall',target:1,slot:k}});}
 assert.equal((Colony.prototype as any).freeSlot.call(c,b,false),-1);
 for(const p of HALL.seats){assert.ok(Math.abs(p.x)<HALL.edge);assert.ok(Math.abs(p.z)<HALL.edge);}
 const m=greatHallModel(),bell=hallBellGeometry();
 for(const g of [m.finished,m.canopy!,bell]){for(const n of g.getAttribute('position').array)assert.ok(Number.isFinite(n));g.dispose();}
});
test('empty footprint corners and building roofs select without a preceding tap',()=>{
 const b=building();
 for(const [x,z] of [[-1.99,-1.99],[1.99,1.99],[0,0],[1.4,-1.4]]){
  const ray=new THREE.Raycaster(new THREE.Vector3(x,10,z),new THREE.Vector3(0,-1,0));
  assert.equal(pickBuilding(ray,[b],new THREE.Vector3(x,0,z)),b);
 }
 const ray=new THREE.Raycaster(new THREE.Vector3(0,4,5),new THREE.Vector3(0,-.2,-1).normalize());
 assert.equal(pickBuilding(ray,[b],new THREE.Vector3(0,0,-15)),b);
});
test('footprint selection respects rotated dimensions, neighbouring buildings and terrain occlusion',()=>{
 const b=building(1,0,0,2,5),other=building(2,4,0,2,2);
 const ray=new THREE.Raycaster(new THREE.Vector3(4,10,0),new THREE.Vector3(0,-1,0));
 assert.equal(pickBuilding(ray,[b,other],new THREE.Vector3(4,0,0)),other);
 ray.ray.origin.set(.9,10,2.4);assert.equal(pickBuilding(ray,[b],new THREE.Vector3(.9,0,2.4)),b);
 ray.ray.origin.set(1.2,10,2.4);assert.equal(pickBuilding(ray,[b],new THREE.Vector3(1.2,0,2.4)),undefined);
 ray.ray.origin.set(0,10,0);assert.equal(pickBuilding(ray,[b],new THREE.Vector3(0,6,0)),undefined);
});

test('first tap on a footprint selects the building before nearby people or animals',async()=>{
 const {Game}=await import('../src/Game');
 const b=building(),camera=new THREE.PerspectiveCamera(50,1,.1,100);camera.position.set(0,10,0);camera.up.set(0,0,-1);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 let selected:any;
 const g={canvas:{getBoundingClientRect:()=>({left:0,top:0,width:400,height:400})},rig:{camera},ndc:new THREE.Vector2(),ray:new THREE.Raycaster(),
   world:{cellIndexAt:()=>0},buildings:{list:[b],at:()=>b},groupTap:{clear(){}},selectedIslanders:new Set(),selectedIslander:-1,
   select:(s:any)=>selected=s,audio:{sfx(){}},pearls:{tap:()=>{throw new Error('building tap intercepted');}}} as any;
 (Game.prototype as any).selectAt.call(g,200,200,new THREE.Vector3());
 assert.deepEqual(selected,{building:1});
});
