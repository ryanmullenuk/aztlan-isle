import { needsStonemason, type BuildingKey } from '../config';
import type { Building } from '../buildings/Buildings';

export const STAGES=['First landing','Small settlement','Skilled village','Community','Worship','Prosperity','Monumental settlement'] as const;
export const BUILD_STAGE:Partial<Record<BuildingKey,number>>={woodstore:2,grainstore:2,jetty:1,pigpen:2,chickenpen:2,stonemason:3,home:3,maizefarm:3,chinampa:3,well:3,smokehouse:3,butcher:3,herbalgarden:3,herbalist:3,healer:3,bonfire:3,firepit:2,market:4,greathall:4,kennel:4,watchtower:4,warroom:5,temple:5,tradedock:6,greattemple:7};
export interface ProgressState {buildings:Building[];population:number;food:number;carved:number;sandbox:boolean;milestones:Set<string>}
/** Permanent achievements are stored with the island's milestones. Costs still apply each time. */
export class Progression {
 prayer=0;
 constructor(private state:()=>ProgressState){}
 private get flags(){return this.state().milestones;}
 record(event:string){if(!this.state().sandbox)this.flags.add('progress:'+event);}
 pray(seconds:number){if(!this.state().sandbox)this.prayer=Math.min(300,this.prayer+Math.max(0,seconds));}
 private has(event:string){return this.flags.has('progress:'+event);}
 refresh(){
  const s=this.state();if(s.sandbox)return;
  for(const b of s.buildings)if(b.complete){this.record('built:'+b.key);if(b.key==='stonemason')for(let t=1;t<=b.tier;t++)this.record('mason:'+t);if(b.key==='temple'&&b.tier>=3)this.record('pyramid');}
  if(s.carved>0)this.record('carved');
  for(let stage=2;stage<=7;stage++)if(!this.has('stage:'+stage)&&this.missing(stage).length===0)this.record('stage:'+stage);
 }
 get workshopTier(){for(let t=4;t>=1;t--)if(this.has('mason:'+t))return t;return 0;}
 get stage(){for(let s=7;s>=2;s--)if(this.has('stage:'+s))return s;return 1;}
 missing(stage:number):string[]{
  const s=this.state(),out:string[]=[];
  const need=(ok:boolean,text:string)=>{if(!ok)out.push(text);};
  const pop=(n:number)=>need(s.population>=n,`${Math.min(s.population,n)}/${n} islanders`);
  const built=(k:BuildingKey,label:string)=>need(this.has('built:'+k),`Complete ${label}`);
  if(stage>2)need(this.has('stage:'+(stage-1)),`Reach ${STAGES[stage-2]}`);
  if(stage===2){need(this.has('built:hut')||this.has('built:home'),'Complete a Hut');need(this.has('harvest'),'Bring in a farm harvest or fishing catch');}
  if(stage===3){pop(6);built('woodstore','Wood & Stone Store');built('grainstore','Food Store');}
  if(stage===4){pop(12);built('stonemason','Stonemason’s Workshop');need(this.has('carved'),'Produce carved stone');}
  if(stage===5){pop(20);built('market','Market Square');built('greathall','Great Hall');need(s.food>=s.population*4,`Food reserve: ${Math.floor(s.food)}/${s.population*4}`);}
  if(stage===6){pop(35);built('temple','Temple');need(this.has('trade'),'Complete a trade at the Market Square');need(this.prayer>=300,`Temple prayer: ${Math.floor(this.prayer)}/300 worshipper-seconds`);}
  if(stage===7){pop(60);need(this.has('pyramid'),'Complete a Great Pyramid');}
  return out;
 }
 requirement(key:BuildingKey){if(this.state().sandbox)return '';const stage=BUILD_STAGE[key]??1;if(stage<=this.stage)return '';return `${STAGES[stage-1]}: ${this.missing(stage).join(' · ')}`;}
 upgradeRequirement(b:Building){
  if(this.state().sandbox || (b.key==='stonemason'&&b.tier>=4) || (b.key==='temple'&&b.tier>=3) || (b.key==='home'&&b.tier>=4))return '';
  const stage=b.key==='stonemason'?b.tier+4:b.key==='temple'?6:b.key==='home'?Math.min(6,b.tier+3):b.key==='hut'?3:1;
  return stage<=this.stage?'':`${STAGES[stage-1]}: ${this.missing(stage).join(' · ')}`;
 }
 get summary(){if(this.state().sandbox)return 'Sandbox · All buildings unlocked';const s=this.stage;return `${STAGES[s-1]}${s<7?' → '+STAGES[s]+': '+this.missing(s+1).join(' · '):' · All settlement stages earned'}`;}
 /** Existing developed saves keep the stages represented by their finished buildings. */
 migrate(){
  if(this.state().sandbox)return;
  let stage=1;for(const b of this.state().buildings)if(b.complete){stage=Math.max(stage,BUILD_STAGE[b.key]??1);if(b.key==='stonemason'&&b.tier>1)stage=Math.max(stage,b.tier+3);if(b.key==='temple'&&b.tier>1)stage=Math.max(stage,6);}
  for(const b of this.state().buildings)if(b.complete && needsStonemason(b.key)){
   const tier=b.key==='greattemple'?4:b.key==='temple'?(b.tier>1?3:2):1;
   for(let t=1;t<=tier;t++)this.record('mason:'+t);
  }
  for(let s=2;s<=stage;s++)this.flags.add('progress:stage:'+s);
  this.refresh();
 }
}
