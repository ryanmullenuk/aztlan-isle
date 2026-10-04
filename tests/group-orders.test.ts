import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idleForGroup, needsSelfCare, IdleGroupTap } from '../src/ai/GroupSelection';
import { Colony } from '../src/ai/Colony';
import { makeIslander } from '../src/entities/Islander';
const person = (id = 1) => makeIslander(id, `Person ${id}`, 'm', 0, 0, () => 0.5);

test('group selection includes idle and wandering adults, excludes busy or unavailable people', () => {
  const i = person();
  assert.equal(idleForGroup(i), true);
  i.task = { kind: 'wander' } as any;
  assert.equal(idleForGroup(i), true);
  for (const changes of [{child:true}, {sleeping:true}, {hidden:true}, {condition:'sick'}, {warrior:'eagle'}, {task:{kind:'chop'}}, {carry:{kind:'wood',n:1}}]) {
    assert.equal(idleForGroup({...i,...changes} as any),false);
  }
});
test('automatic workers attend to food and rest, while explicit orders and deliveries retain priority', () => {
  const i = person(); i.task = {kind:'chop', stage:0} as any; i.hunger=0.05;
  assert.equal(needsSelfCare(i,false,10),true);
  assert.equal(needsSelfCare(i,false,0),false);
  i.manualRole=true; assert.equal(needsSelfCare(i,true,10),false);
  i.manualRole=false; i.hunger=1; i.rest=0.01;
  assert.equal(needsSelfCare(i,false,0),true);
  i.carry={kind:'wood',res:'wood',n:2}; assert.equal(needsSelfCare(i,true,10),false);
});
test('group gathering reserves separate resources and starts each order immediately', () => {
  for (const kind of ['broadleaf','rock']) {
    const plants = Array.from({length:3},(_,id)=>({id,kind,x:id*2,z:0,reservedBy:-1,amount:10}));
    const available = (p:any) => p.reservedBy < 0;
    const veg = {plants,isChoppable:(p:any)=>p.kind==='broadleaf'&&available(p),isMineable:(p:any)=>p.kind==='rock'&&available(p),hasFruit:()=>false,isLog:()=>false,
      findNearest:(x:number,z:number,r:number,predicate:(p:any)=>boolean)=>plants.filter(predicate).sort((a,b)=>Math.abs(a.x-x)-Math.abs(b.x-x))[0]??null};
    const colony = new Colony({} as any,veg as any,{space:()=>100} as any,{nearestStore:()=>({id:1})} as any,{} as any,{} as any,()=>0.5);
    const people = [person(1),person(2),person(3)];
    assert.equal(colony.assignGroup(people,null,plants[0] as any),3);
    assert.equal(new Set(people.map(i=>i.task?.target)).size,3);
    assert.ok(people.every(i=>i.manualRole&&i.task?.kind===(kind==='rock'?'mine':'chop')));
    assert.deepEqual(plants.map(p=>p.reservedBy),[1,2,3]);
  }
});

 test('double tap retains idle group when automatic jobs start between taps', () => {
  const tap = new IdleGroupTap();
  assert.equal(tap.tap(1, 1000, 100, 100, [1,2,3]), null);
  assert.deepEqual(tap.tap(1, 1480, 104, 100, []), [1,2,3]);
  assert.equal(tap.tap(1, 1600, 104, 100, []), null);
});
test('unrelated clicks, drags and slow taps do not select a group', () => {
  const tap = new IdleGroupTap();
  tap.tap(1, 1000, 100, 100, [1,2]);
  assert.equal(tap.tap(2, 1100, 100, 100, [1,2]), null);
  assert.equal(tap.tap(2, 1200, 150, 100, [1,2]), null);
  assert.equal(tap.tap(2, 2000, 150, 100, [1,2]), null);
  tap.clear();
  assert.equal(tap.tap(2, 2100, 150, 100, [1,2]), null);
});
