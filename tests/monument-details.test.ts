import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {BANNER,greatHallModel,greatTempleModel,HALL} from '../src/buildings/models';
import {Building,modelLo} from '../src/buildings/Buildings';
import {withBuildingGround} from '../src/buildings/BuildingGround';
import {World} from '../src/world/World';

const material=new THREE.MeshBasicMaterial();
function hit(g:THREE.BufferGeometry,x:number,y:number,z:number,direction=new THREE.Vector3(0,-1,0)) {
 const mesh=new THREE.Mesh(g,material);mesh.updateMatrixWorld();
 return new THREE.Raycaster(new THREE.Vector3(x,y,z),direction).intersectObject(mesh)[0];
}
function colour(g:THREE.BufferGeometry,h:THREE.Intersection){
 const c=g.getAttribute('color'),i=h.face!.a;return new THREE.Color(c.getX(i),c.getY(i),c.getZ(i));
}
test('Hall carpet remains exposed above the slabs in near/far models and continues down the stairs',()=>{
 const g=greatHallModel().finished;
 for(const geometry of [g,modelLo(g)])for(const z of [0.1,1.1,2.1,2.8,3.0,3.3]){
  const h=hit(geometry,.1,1,z)!;assert.ok(h);
  const c=colour(geometry,h);assert.ok(c.r>c.g*3&&c.r>c.b*3,`red carpet visible at ${z}`);
  if(z<HALL.edge)assert.ok(h.point.y>HALL.h+.04,'carpet clears the paving');
 }
 g.dispose();
});
test('every Temple brazier flame starts above the masonry, including the front pair',()=>{
 const model=greatTempleModel();
 for(const p of model.torches){
  const h=hit(model.finished,p.x,p.y+1,p.z)!;
  assert.ok(h.point.y<p.y-.015,`flame at ${p.toArray()} must clear its coal bed and terraces`);
 }
 model.finished.dispose();
});
test('Temple sun emblems are visible in front of terrace masonry on both sides',()=>{
 const g=greatTempleModel().finished;
 for(const side of [-1,1])for(const [x,y,z,w,h] of [[side*2,.99,3.68,.66,1.22],[side*1.55,2.85,2.75,.6,1.25]]){
  const angle=-Math.atan2(w===.66?.6:.55,1.72);
  // The sun's eye: on the cloth (82% of the banner, below the rod) 42% of the way down.
  const centre=new THREE.Vector3(x,y,z).add(new THREE.Vector3(0,h*(.5-.82*.42),0).applyAxisAngle(new THREE.Vector3(1,0,0),angle));
  const normal=new THREE.Vector3(0,0,1).applyAxisAngle(new THREE.Vector3(1,0,0),angle);
  const ray=new THREE.Raycaster(centre.clone().addScaledVector(normal,1),normal.clone().negate());
  const mesh=new THREE.Mesh(g,material);mesh.updateMatrixWorld();const first=ray.intersectObject(mesh)[0];
  const c=colour(g,first),cream=BANNER.cream;
  assert.ok(Math.abs(c.r-cream.r)<.03&&Math.abs(c.g-cream.g)<.03&&Math.abs(c.b-cream.b)<.03,'cream sun faces outward rather than being covered by stone');
 }
 g.dispose();
});
test('merged ground preserves all Temple build phases and includes decoration in the final phase',()=>{
 const w=new World();w.layer.fill(1);w.computeSmooth();const b=new Building(1,'greattemple',95,95,0,1,w);
 const original=greatTempleModel().finished,phases=[...original.userData.constructionPhases];
 const merged=withBuildingGround(original,b,w),actual=merged.userData.constructionPhases;
 assert.deepEqual(actual.slice(0,-1),phases.slice(0,-1));assert.equal(actual.at(-1),merged.index!.count);
 assert.ok(actual.at(-1)>phases.at(-1)!);merged.dispose();
});
