import { needsStonemason, type BuildingKey } from '../config';
import type { Building } from '../buildings/Buildings';
import { hasUpgradePath, UPGRADE_STAGE } from '../buildings/Upgrades';

export const STAGES=['First landing','Small settlement','Skilled village','Healthy village','Community','Worship','Prosperity','Monumental settlement'] as const;
/** What the settlement is called at each stage, shown beside the island's name as it grows. */
export const TITLES=['Camp','Hamlet','Village','Large Village','Town','Temple Town','City','Capital of the Isle'] as const;
/** The last stage. */
export const TOP_STAGE=STAGES.length;
/**
 * The stage each building opens at. Food first, then health and learning, then the town's halls,
 * and only then worship: the temple (the big step up in Belief) comes once the village is established.
 */
export const BUILD_STAGE:Partial<Record<BuildingKey,number>>={boatworkshop:1,jetty:1,woodstore:2,grainstore:2,fishhut:2,pigpen:2,chickenpen:2,firepit:2,stonemason:3,home:3,maizefarm:3,chinampa:3,smokehouse:3,butcher:3,bonfire:3,featherbanner:3,well:4,herbalgarden:4,herbalist:4,healer:4,observatory:3,market:5,greathall:5,kennel:5,watchtower:5,warroom:6,temple:6,tradedock:7,palace:7,greattemple:8,olmechead:8,sunstone:8,skytower:8};
/** Game days a settlement must spend at a stage before it can move on to the next (indexed by the next stage). */
export const SETTLE_DAYS=[0,0,0,1,1,1,2,2,3];
/** One line of a stage's goals. */
export interface GoalItem {text:string;done:boolean;build?:BuildingKey}
export interface ProgressState {buildings:Building[];population:number;food:number;carved:number;sandbox:boolean;milestones:Set<string>;/** The game day now. */day?:number}
/** Permanent achievements are stored with the island's milestones. Costs still apply each time. */
export class Progression {
 prayer=0;
 /** The game day each stage was reached (saved; missing for stages reached before this was kept). */
 reached:Record<number,number>={};
 constructor(private state:()=>ProgressState){}
 private get flags(){return this.state().milestones;}
 record(event:string){if(!this.state().sandbox)this.flags.add('progress:'+event);}
 pray(seconds:number){if(!this.state().sandbox)this.prayer=Math.min(300,this.prayer+Math.max(0,seconds));}
 private has(event:string){return this.flags.has('progress:'+event);}
 refresh(){
  const s=this.state();if(s.sandbox)return;
  this.renumber();
  for(const b of s.buildings)if(b.complete){this.record('built:'+b.key);if(b.key==='stonemason')for(let t=1;t<=b.tier;t++)this.record('mason:'+t);if(b.key==='temple'&&b.tier>=3)this.record('pyramid');}
  if(s.carved>0)this.record('carved');
  for(let stage=2;stage<=TOP_STAGE;stage++)if(!this.has('stage:'+stage)&&this.missing(stage).length===0){this.record('stage:'+stage);this.reached[stage]=s.day??0;}
 }
 get workshopTier(){for(let t=4;t>=1;t--)if(this.has('mason:'+t))return t;return 0;}
 get stage(){for(let s=TOP_STAGE;s>=2;s--)if(this.has('stage:'+s))return s;return 1;}
 /** Whole game days spent at the stage before `stage` (unlimited when its start wasn't kept). */
 daysAt(stage:number){const at=this.reached[stage-1];return at===undefined?Infinity:Math.max(0,(this.state().day??0)-at);}
 /** Everything a stage asks for, met or not; `build` names the building to make for that line. */
 checklist(stage:number):GoalItem[]{
  const s=this.state(),out:GoalItem[]=[];
  const need=(ok:boolean,text:string,build?:BuildingKey)=>{out.push({text,done:ok,build});};
  const pop=(n:number)=>need(s.population>=n,`${Math.min(s.population,n)}/${n} islanders`);
  const built=(k:BuildingKey,label:string)=>need(this.has('built:'+k),`Complete ${label}`,k);
  if(stage>2)need(this.has('stage:'+(stage-1)),`Reach ${STAGES[stage-2]}`);
  const settle=SETTLE_DAYS[stage]??0;
  if(settle>0&&this.has('stage:'+(stage-1))){const d=Math.min(settle,this.daysAt(stage));need(d>=settle,`Settle in as a ${TITLES[stage-2]}: ${d}/${settle} day${settle>1?'s':''}`);}
  if(stage===2){need(this.has('built:hut')||this.has('built:home'),'Complete a Hut','hut');need(this.has('harvest'),'Bring in a farm harvest or fishing catch','farm');}
  if(stage===3){pop(6);built('woodstore','Wood & Stone Store');built('grainstore','Food Store');}
  if(stage===4){pop(10);need(this.has('built:maizefarm')||this.has('built:chinampa'),'Complete a Maize Farm or Chinampa','maizefarm');built('home','Home');}
  if(stage===5){pop(14);built('stonemason','Stonemason’s Workshop');need(this.has('carved'),'Produce carved stone');built('healer','Healing Centre');}
  if(stage===6){pop(22);built('market','Market Square');built('greathall','Great Hall');need(s.food>=s.population*4,`Food reserve: ${Math.floor(s.food)}/${s.population*4}`);}
  if(stage===7){pop(35);built('temple','Temple');need(this.has('trade'),'Complete a trade at the Market Square');need(this.prayer>=300,`Temple prayer: ${Math.floor(this.prayer)}/300 worshipper-seconds`);}
  if(stage===8){pop(60);need(this.has('pyramid'),'Complete a Great Pyramid');}
  return out;
 }
 missing(stage:number):string[]{return this.checklist(stage).filter(i=>!i.done).map(i=>i.text);}
 requirement(key:BuildingKey){if(this.state().sandbox)return '';const stage=BUILD_STAGE[key]??1;if(stage<=this.stage)return '';return `${STAGES[stage-1]}: ${this.missing(stage).join(' · ')}`;}
 upgradeRequirement(b:Building){
  if(this.state().sandbox || (b.key==='stonemason'&&b.tier>=4) || (b.key==='temple'&&b.tier>=3) || (b.key==='home'&&b.tier>=4))return '';
  const stage=hasUpgradePath(b.key)?UPGRADE_STAGE[b.tier-1]??1:b.key==='boatworkshop'?(b.tier===1?3:b.tier===2?7:1):b.key==='stonemason'?b.tier+5:b.key==='temple'?7:b.key==='home'?Math.min(7,b.tier+4):b.key==='hut'?3:1;
  return stage<=this.stage?'':`${STAGES[stage-1]}: ${this.missing(stage).join(' · ')}`;
 }
 get summary(){if(this.state().sandbox)return 'Sandbox · All buildings unlocked';const s=this.stage;return `${STAGES[s-1]}${s<TOP_STAGE?' → '+(STAGES as readonly string[])[s]+': '+this.missing(s+1).join(' · '):' · All settlement stages earned'}`;}
 /**
  * Saves from before the Healthy village stage (seven stages): every stage from the fourth moves up
  * one, and the new fourth is granted to any settlement already past it. Run once per island.
  */
 renumber(){
  const f=this.flags;if(f.has('progress:stages8'))return;f.add('progress:stages8');
  let old=1;for(let k=7;k>=2;k--)if(f.has('progress:stage:'+k)){old=k;break;}
  if(old>=4)for(let k=2;k<=old+1;k++)f.add('progress:stage:'+k);
 }
 /** Existing developed saves keep the stages represented by their finished buildings. */
 migrate(){
  if(this.state().sandbox)return;
  let stage=1;for(const b of this.state().buildings)if(b.complete){stage=Math.max(stage,BUILD_STAGE[b.key]??1);if(b.key==='stonemason'&&b.tier>1)stage=Math.max(stage,b.tier+4);if(b.key==='temple'&&b.tier>1)stage=Math.max(stage,7);}
  for(const b of this.state().buildings)if(b.complete && needsStonemason(b.key)){
   const tier=b.key==='greattemple'?4:b.key==='temple'?(b.tier>1?3:2):1;
   for(let t=1;t<=tier;t++)this.record('mason:'+t);
  }
  for(let s=2;s<=stage;s++)this.flags.add('progress:stage:'+s);
  this.refresh();
 }
}
