import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Animals, animalName, type Animal } from '../src/entities/Animals';
import { chickenBody, chickenHead, chickenNeck, chickenLegParts, carriedChicken } from '../src/entities/animalModels';
import { World } from '../src/world/World';
import { WORLD, SPECIES } from '../src/config';
import { wingParts, CHICKEN_WING, TOUCAN_WING } from '../src/entities/birdWings';
import { SpatialHash } from '../src/world/SpatialHash';
import { makeIslander } from '../src/entities/Islander';

function fixture(seed = WORLD.islandSeed) {
  const world = new World(); world.seed = seed; world.layer.fill(1); world.computeSmooth();
  const animals = new Animals(world), system = animals as any;
  const cockerel = animals.list.find(a => a.bodyKey === 'chicken_rooster')!;
  const hen = animals.list.find(a => a.sp === 'chicken' && a.bodyKey !== 'chicken_rooster')!;
  const people = new SpatialHash<ReturnType<typeof makeIslander>>(2);
  const walking = (a: Animal) => Object.assign(a, { x: 0, z: 0, y: world.groundY(0,0), heading: 0, prevHeading: 0,
    tx: 0, tz: 20, timer: 1000, speed: 0, state: 'walk', tempo: 1, flap: 0, tick: 0, pen: -1 });
  return { world, animals, system, cockerel, hen, people, walking };
}

test('generated flocks include large cockerels amongst hens without adding animals', () => {
  for (const seed of [WORLD.islandSeed, 1, 99]) {
    const h = fixture(seed), birds = h.animals.list.filter(a => a.sp === 'chicken');
    assert.ok(birds.length >= SPECIES.chicken.count[0] && birds.length <= SPECIES.chicken.count[1]);
    const cockerels = birds.filter(a => a.bodyKey === 'chicken_rooster');
    assert.ok(cockerels.length >= 2); assert.ok(birds.some(a => a.bodyKey !== 'chicken_rooster'));
    assert.ok(cockerels.every(a => a.scale >= 1.34 && a.scale <= 1.52));
    assert.ok(cockerels.every(a => a.scale > h.hen.scale * 1.25));
    assert.equal(animalName(h.cockerel), 'Cockerel'); assert.equal(animalName(h.hen), 'Chicken');
  }
});

test('cockerels strut slowly rather than taking the hens occasional running burst', () => {
  const h = fixture(); h.walking(h.cockerel); h.walking(h.hen);
  h.cockerel.flap = h.hen.flap = .5;
  for (let n=0;n<20;n++) {
    h.system.step(h.cockerel,.01,null,h.people); h.system.step(h.hen,.01,null,h.people);
  }
  assert.ok(h.cockerel.z > 0); assert.ok(h.hen.z > h.cockerel.z * 3);
  assert.ok(h.cockerel.speed <= SPECIES.chicken.wanderSpeed * .7);
  assert.equal(h.animals.describe(h.cockerel),'Strutting');
  for(const group of h.system.groups) Object.assign(group,{x:0,z:0,homeX:0,homeZ:0});
  h.system.rng = { next: () => .49, chance: () => false };
  h.system.pickSpot = () => [0, 5]; h.system.chooseActivity(h.cockerel); h.system.chooseActivity(h.hen);
  assert.equal(h.cockerel.flap,0); assert.equal(h.cockerel.state,'walk'); assert.equal(h.hen.flap,.5);
});

test('cockerels still flee real threats and can be captured, penned and consumed normally', () => {
  const h = fixture(), a = h.cockerel, p = makeIslander(1,'A','m',0,-.3,()=>.5);
  h.walking(a); h.animals.beginChase(a.id,p);
  for(let n=0;n<5;n++) h.system.step(a,.1,null,h.people);
  assert.equal(a.state,'flee'); assert.ok(a.speed > SPECIES.chicken.wanderSpeed);
  a.x=p.x; a.z=p.z; a.caught=SPECIES.chicken.captureTime;
  assert.equal(h.animals.catchable(a.id,p),true); assert.equal(h.animals.grab(a.id,p),'carry');
  const pen={id:44,key:'chickenpen',penX:1,penZ:2} as any;
  h.animals.registerPen(pen); h.animals.putInPen(a.id,pen);
  assert.equal(a.pen,44); assert.equal(a.heldBy,null); assert.equal(a.heldMode,null);
  a.state='walk'; a.tx=a.x; a.tz=a.z+1; a.timer=100;
  // Penned animals ease up to their strutting pace rather than jumping to it, and keep heading for the spot.
  const z=a.z; for(let n=0;n<10;n++) h.system.step(a,.1,null,h.people);
  assert.ok(a.z-z > .12 && a.z-z <= .35+1e-6, `walked ${a.z-z}`);
  assert.equal(h.animals.describe(a),'Strutting in the pen');
  h.animals.consume(a.id); assert.equal(a.alive,false); assert.equal(a.respawn,SPECIES.chicken.regrow);
});

test('new chicken details have finite attributes and stay within the existing part batches', () => {
  const h = fixture(); h.walking(h.cockerel); h.walking(h.hen); h.animals.list=[h.cockerel,h.hen];
  const batches=h.system.meshes.size;
  for(let n=0;n<30;n++) {
    h.animals.update(1/60,new THREE.Vector3(),null,h.people);
    for(const [key,entry] of h.system.meshes) {
      assert.ok(entry.mesh.count <= entry.mesh.instanceMatrix.count,key);
      for(let i=0;i<entry.mesh.count*16;i++) assert.ok(Number.isFinite(entry.mesh.instanceMatrix.array[i]),key);
    }
  }
  assert.equal(h.system.meshes.size,batches); assert.equal(h.system.meshes.get('chicken_rooster').mesh.count,1);
  assert.equal(h.system.meshes.get('head_rooster').mesh.count,1);
  for(const geometry of [chickenBody('hen'),chickenBody('rooster'),chickenHead(false),chickenHead(true)]) {
    const count=geometry.getAttribute('position').count; assert.ok(count<12000);
    for(const key of ['position','normal','color','aMat']) {
      const attribute=geometry.getAttribute(key); assert.equal(attribute.count,count);
      for(const value of attribute.array) assert.ok(Number.isFinite(value));
    }
    geometry.dispose();
  }
});

test('older five-field animal saves retain identities, pens and cockerel appearance on reload', () => {
  const h=fixture(), a=h.cockerel; a.x=12; a.z=8; a.pen=4;
  const data=h.animals.serialize(); assert.ok(data.every(row=>row.length===5));
  const restored=fixture(); restored.animals.registerPen({id:9,key:'chickenpen',penX:12,penZ:8} as any);
  restored.animals.restore(data,new Map([[4,9]])); const bird=restored.animals.get(a.id)!;
  assert.equal(bird.sp,'chicken'); assert.equal(bird.bodyKey,a.bodyKey); assert.equal(bird.scale,a.scale);
  assert.equal(bird.pen,9); assert.equal(bird.x,12); assert.equal(bird.z,8);
  assert.deepEqual(restored.animals.list.map(a=>a.sp),h.animals.list.map(a=>a.sp));
});


test('chicken surfaces retain smooth normals and mirrored wings shade outwards', () => {
  const wings = wingParts(CHICKEN_WING, 2);
  const parts = [chickenBody('hen'), chickenBody('rooster'), chickenHead(false), chickenHead(true),
    chickenNeck(), ...chickenLegParts(), carriedChicken(), ...wings];
  for (const g of parts) {
    const n = g.getAttribute('normal'), index = g.getIndex();
    const count = index ? index.count : n.count;
    let curved = 0;
    for (let i = 0; i < count; i += 3) {
      const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1;
      if (new THREE.Vector3().fromBufferAttribute(n, a).distanceTo(new THREE.Vector3().fromBufferAttribute(n, b)) > .001) curved++;
    }
    assert.ok(curved > count / 30, 'surface lost its smooth normals');
    assert.ok(g.getAttribute('position').count < 12000, 'chicken part exceeds mobile geometry budget');
  }
  for (let k = 0; k < 3; k++) {
    const right = wings[k], left = wings[k + 3];
    for (const name of ['position', 'normal']) {
      const r = right.getAttribute(name), l = left.getAttribute(name);
      for (let i = 0; i < r.count; i += 3) for (let corner = 0; corner < 3; corner++) {
        const j = i + (corner === 0 ? 0 : 3 - corner);
        assert.ok(Math.abs(r.getX(i + corner) + l.getX(j)) < 1e-6);
        assert.ok(Math.abs(r.getY(i + corner) - l.getY(j)) < 1e-6);
        assert.ok(Math.abs(r.getZ(i + corner) - l.getZ(j)) < 1e-6);
      }
    }
  }
  // Shared bird wing construction keeps the existing faceted style for other species.
  for (const g of wingParts(TOUCAN_WING)) {
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i += 3) assert.ok(new THREE.Vector3().fromBufferAttribute(n, i).distanceTo(new THREE.Vector3().fromBufferAttribute(n, i + 1)) < 1e-6);
    g.dispose();
  }
  for (const g of parts) g.dispose();
});
