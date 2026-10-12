import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WildlifeEncounters,type EncounterKind,type WildlifeEncounter} from '../src/entities/WildlifeEncounters';
import {Marine} from '../src/entities/Marine';
import {SeaTurtles} from '../src/entities/SeaTurtles';
import {World} from '../src/world/World';
import {Game} from '../src/Game';
import {UI} from '../src/ui/UI';
import {SEA_SURFACE} from '../src/water/Water';
const ctx=new Proxy({}, {get:(_,k)=> k==='createRadialGradient'||k==='createLinearGradient'?()=>({addColorStop(){}}):()=>{}});
(globalThis as any).document={createElement:()=>({getContext:()=>ctx})};
const advance=(s:WildlifeEncounters,n:number,notifications=true)=>{for(let k=0;k<n;k++)s.update(1,notifications);};
function scheduler(){
 let available=true,valid=true,notified=0,finished=0,dismissed=0;
 const starts:{kind:EncounterKind;avoid?:string}[]=[];
 const s=new WildlifeEncounters({start:(kind,avoid)=>{starts.push({kind,avoid});return available?{kind,subject:`${kind}-0`,text:'Visit',duration:40,boat:kind==='dolphin'?'canoe-1':undefined,valid:()=>valid,finish:()=>finished++}:null;},notify:()=>notified++,dismiss:()=>dismissed++},undefined,()=>0);
 return {s,starts,counts:()=>({notified,finished,dismissed}),unavailable:()=>available=false,unsafe:()=>valid=false};
}
test('one shared cooldown, species/boat spacing, pause and long resume frames prevent bursts',()=>{
 const h=scheduler();advance(h.s,179);assert.equal(h.starts.length,0);
 h.s.update(0,true);assert.equal(h.starts.length,0);
 h.s.update(10000,true);assert.equal(h.s.active?.kind,'dolphin');assert.equal(h.starts.length,1);
 for(let k=0;k<100;k++)h.s.update(0,true);assert.equal(h.s.active?.kind,'dolphin');
 advance(h.s,40);assert.equal(h.s.active,null);assert.equal(h.counts().finished,1);
 advance(h.s,180);assert.equal(h.s.active?.kind,'whale');assert.equal(h.starts[1].avoid,'canoe-1');
 assert.equal(h.counts().notified,2);
});
test('disabled alerts leave encounters running; unsafe visits finish once and expire their alert',()=>{
 const h=scheduler();advance(h.s,180,false);assert.equal(h.s.active?.kind,'dolphin');assert.equal(h.counts().notified,0);
 const dismissed=h.counts().dismissed;advance(h.s,10,false);assert.equal(h.counts().dismissed,dismissed);
 h.unsafe();h.s.update(.1,false);assert.equal(h.s.active,null);assert.equal(h.counts().finished,1);
 advance(h.s,10,false);assert.equal(h.counts().finished,1);
});
test('unsuitable conditions retry only every 45 seconds and a save provides loading grace',()=>{
 const h=scheduler();h.unavailable();advance(h.s,180);assert.equal(h.starts.length,3);
 advance(h.s,44);assert.equal(h.starts.length,3);advance(h.s,1);assert.equal(h.starts.length,6);
 const saved=h.s.save();assert.equal(saved.remaining,60);
 let started=0;const restored=new WildlifeEncounters({start:()=>{started++;return null;},notify(){},dismiss(){}},JSON.parse(JSON.stringify(saved)),()=>0);
 advance(restored,59);assert.equal(started,0);advance(restored,1);assert.equal(started,3);
 const active=scheduler();advance(active.s,180);const snapshot=active.s.save();assert.equal(snapshot.lastBoat,'canoe-1');assert.equal(snapshot.speciesRemaining,600);assert.ok(snapshot.remaining>=180);
 const old=new WildlifeEncounters({start:()=>null,notify(){},dismiss(){}},undefined,()=>0);assert.equal(old.save().remaining,180);
});
function marine(){const w=new World();w.seed=7;w.layer.fill(-8);w.computeSmooth();const water={shared:{uDay:{value:1}},disturb(){}} as any;return {w,m:new Marine(w,water) as any};}
test('dolphins swim as existing pods, jump occasionally, escort safely and return without teleporting',()=>{
 const {m,w}=marine();const count=m.dolphins.length,pod=m.pods[0];
 let splashes=0;m.dolphinSplash=()=>splashes++;
 for(let k=0;k<300;k++)m.updateDolphins(1/30);assert.equal(splashes,0);assert.ok(m.dolphins.every((d:any)=>d.y<0));
 // Only the first pod is nearby; all boat state is read-only.
 const boat={x:pod.x+6,z:pod.z,heading:0,speed:1};const snapshot={...boat};
 const visit=m.escortCanoe(()=>boat,()=>true);assert.ok(visit);assert.equal(m.dolphins.length,count);
 const before={x:pod.x,z:pod.z};m.updateDolphins(.1);assert.ok(Math.hypot(pod.x-before.x,pod.z-before.z)<.6);assert.deepEqual(boat,snapshot);
 visit.finish();const end={x:pod.x,z:pod.z};m.updateDolphins(.01);assert.ok(Math.hypot(pod.x-end.x,pod.z-end.z)<.1);assert.equal(visit.valid(),false);
 for(const p of m.pods)p.leapIn=.01;
 for(let k=0;k<300;k++)m.updateDolphins(1/30);assert.ok(splashes>=count*2);
 assert.equal(m.escortCanoe(()=>({...boat,speed:0}),()=>true),null);
 assert.equal(m.escortCanoe(()=>boat,()=>false),null);
 w.heightAt=()=>1;assert.equal(m.escortCanoe(()=>boat,()=>true),null);
});
test('whale encounter requires full-body offshore depth, fixed-rock clearance and a nearby calf',()=>{
 const {m,w}=marine();const whale=m.whales[0];
 for(const other of m.whales)other.state='surface';whale.state='swim';whale.seek=null;whale.x=0;whale.z=0;whale.pose.yaw=0;whale.heading=0;
 w.heightAt=()=>-1;assert.equal(m.offshoreRise(),null);
 w.heightAt=()=>-8;w.blockFixed[w.cellIndexAt(0,0)]=1;assert.equal(m.offshoreRise(),null);
 w.blockFixed.fill(0);assert.equal(m.offshoreRise(()=>false),null);const visit=m.offshoreRise();assert.equal(visit?.subject,'whale-0');assert.equal(visit?.valid(),true);
 whale.state='swim';assert.equal(visit?.valid(),false);
 whale.state='surface';const mother=m.whales[1],calf=m.whales[2];mother.state='swim';mother.x=0;mother.z=0;mother.seek=null;calf.x=30;calf.z=0;
 assert.equal(m.offshoreRise(),null);
});
test('bay visits reuse a mother and babies, preserve cohesion and end when destination becomes land',()=>{
 const w=new World();w.seed=7;w.layer.fill(-3);w.computeSmooth();const turtles=new SeaTurtles(w,SEA_SURFACE),system=turtles as any;
 const mother=turtles.list.find(t=>t.family>=0&&t.mother<0)!;const family=turtles.list.filter(t=>t===mother||t.mother===turtles.list.indexOf(mother));const x=mother.x,z=mother.z,count=turtles.list.length;
 system.beaches=[{x:x+4,z}];w.heightAt=(px,pz)=>px>x+12||pz>z+8||pz<z-8?1:-1;
 const visit=turtles.visitBay();assert.ok(visit);assert.equal(visit.subject,`turtle-${turtles.list.indexOf(mother)}`);assert.equal(turtles.list.length,count);
 for(let k=0;k<600;k++)for(const t of family){system.think(t,.1);assert.ok(t.state==='swim'||t.state==='breathe');assert.ok(Math.hypot(t.x-mother.x,t.z-mother.z)<4);assert.ok(t.y<=SEA_SURFACE);}
 w.heightAt=()=>1;assert.equal(visit.valid(),false);visit.finish();assert.equal(mother.bayVisit,undefined);
 assert.equal(turtles.visitBay(),null);
});
test('occupied docks and nearby hulls reject approach points; boat orders and catches stay untouched',()=>{
 const boat={id:1,sail:false,speed:1,x:0,z:0,heading:0,state:'out',catch:4,idx:2,path:[1,2]};const before=JSON.stringify(boat);
 let allowed=true;const g={boats:{list:[boat],traffic:()=>[{x:0,z:0,half:1},{x:5,z:0,half:1}]},marine:{escortCanoe:(current:any,clear:any)=>{assert.equal(current(),boat);allowed=clear(5,0);return null;}}} as any;
 (Game.prototype as any).startEncounter.call(g,'dolphin');assert.equal(allowed,false);assert.equal(JSON.stringify(boat),before);
});
test('encounter alerts are optional, dismissible and expire through the existing inbox',()=>{
 const ui=Object.create(UI.prototype) as any;Object.assign(ui,{alerts:[],zen:true,renderAlerts(){}});
 let alive=true;ui.toast('A pod is visiting','info',()=>alive?{x:1,z:2}:null,{key:'wildlife-encounter',label:'Watch',noFocus:true,onView(){}});
 assert.equal(ui.alerts.length,1);assert.equal(ui.alerts[0].label,'Watch');assert.equal(ui.alerts[0].noFocus,true);
 alive=false;ui.pruneAlerts();assert.equal(ui.alerts.length,0);
 ui.toast('Another pod','info',()=>({x:1,z:2}),{key:'wildlife-encounter',label:'Watch',onView(){}});ui.dismissAlert('wildlife-encounter');assert.equal(ui.alerts.length,0);
});
