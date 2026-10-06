import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { animalForm } from '../src/entities/animalForm';
import { pigBodyHalves, goatBodyHalves, tapirBodyHalves, chickenBody, pigHead, goatHead, tapirHead } from '../src/entities/animalModels';
import { dogBodyParts, jaguarBodyHalves, dogHead, jaguarHead } from '../src/entities/quadRig';
import { pelicanBody, pelicanHead, pelicanJaw } from '../src/entities/waterBirdModels';
import { WaterBirds, WaterBirdHooks } from '../src/entities/WaterBirds';
import { World } from '../src/world/World';
import { SpatialHash } from '../src/world/SpatialHash';
import { SEA_SURFACE } from '../src/water/Water';

test('continuous animal forms have outward faces, closed ends and flat normals', () => {
  const g=animalForm([[-1,0,0.6,0.8,0.5],[0,0,1,1,1],[1,0,0.5,0.6,0.4]]);
  const p=g.getAttribute('position'),n=g.getAttribute('normal');
  let volume=0;
  for(let i=0;i<p.count;i+=3) {
    const a=new THREE.Vector3().fromBufferAttribute(p,i), b=new THREE.Vector3().fromBufferAttribute(p,i+1), c=new THREE.Vector3().fromBufferAttribute(p,i+2);
    volume+=a.dot(b.clone().cross(c))/6;
    const normal=new THREE.Vector3().fromBufferAttribute(n,i);
    assert.ok(normal.dot(a.clone().add(b).add(c))>0,'inward face');
    for(let k=1;k<3;k++) assert.ok(normal.distanceTo(new THREE.Vector3().fromBufferAttribute(n,i+k))<1e-6);
  }
  assert.ok(volume>1);
  g.dispose();
});

test('redesigned rig parts retain finite geometry, coat attributes and practical polygon budgets', () => {
  const parts=[...pigBodyHalves(false,.17),...pigBodyHalves(true,.17),...goatBodyHalves(true,.26),...tapirBodyHalves(.36),
    ...Object.values(dogBodyParts()),...jaguarBodyHalves(),chickenBody('hen'),chickenBody('rooster'),
    pigHead(),goatHead(false),tapirHead(),dogHead(),jaguarHead(),pelicanBody(),pelicanHead(),pelicanJaw()];
  for(const g of parts) {
    g.computeBoundingBox();
    assert.ok(!g.boundingBox!.isEmpty());
    const count=g.getAttribute('position').count;
    assert.ok(count>0 && count<40000,`unexpected geometry size ${count}`);
    for(const name of ['position','normal','color','aMat']) {
      const a=g.getAttribute(name); assert.equal(a.count,count);
      for(const v of a.array) assert.ok(Number.isFinite(v),`${name} has invalid data`);
    }
    g.dispose();
  }
});

function birds() {
  const w=new World(); w.layer.fill(-3); w.smooth.fill(-3);
  const birds=new WaterBirds(w,[{x:0,z:0}]);
  let flaps=0;
  birds.hooks={people:new SpatialHash(4),dogs:()=>[],schools:()=>[],fishNear:()=>null,takeFish:()=>false,
    scatterDeep(){},reefNear:()=>null,reefSchools:()=>[],reefFish:()=>[],takeReef(){},scatterReef(){},canoes:()=>[],
    buildings:()=>[],splash(){},sfx(){flaps++;},seaLevel:SEA_SURFACE} as WaterBirdHooks;
  const b=birds.list.find(b=>b.kind==='pelican')!;
  assert.ok(b);
  birds.list=[b]; Object.assign(b,{x:0,z:0,y:0,state:'rest',timer:20,react:0,hunger:1});
  return {birds,b,flaps:()=>flaps};
}

test('pointer makes a resting pelican take off away and does not restart its flight', () => {
  const {birds:group,b,flaps}=birds();
  group.update(1/30,12,null); assert.equal(b.state,'rest');
  b.react=0;
  const pointer={x:1,z:0};
  group.update(1/30,12,pointer);
  assert.equal(b.state,'takeoff'); assert.ok(b.tx<0,'destination is away from pointer');
  for(let i=0;i<60;i++) group.update(1/30,12,pointer);
  assert.equal(flaps(),1,'takeoff is not continually restarted');
  assert.equal(b.state,'fly'); assert.ok(b.y>1);
});

test('pelican escapes even when no quiet landing spot is available', () => {
  const {birds:group,b}=birds();
  (group as any).restSpots=[]; (group as any).seaSpots=[];
  group.update(1/30,12,{x:1,z:0});
  assert.equal(b.state,'takeoff'); assert.ok(b.tx< -10);
});
