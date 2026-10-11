import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../src/audio/Audio';
import { canChatter, chatterGain, chatterPan, chatterPhrase } from '../src/audio/Chatter';
import { makeIslander } from '../src/entities/Islander';
const camera={x:0,y:.7,z:0,rightX:1,rightZ:0};

test('chatter fades by actual camera distance, pans with camera orientation and excludes unavailable people',()=>{
  const i=makeIslander(1,'A','m',0,0,()=>.5);
  assert.equal(chatterGain(i,camera),.24);
  i.x=15;assert.ok(chatterGain(i,camera)>0&&chatterGain(i,camera)<.24);
  assert.equal(chatterPan(i,camera),.8);
  assert.equal(chatterPan(i,{...camera,rightX:-1}),-.8);
  i.x=28;assert.equal(chatterGain(i,camera),0);
  i.x=0;i.hidden=true;assert.equal(chatterGain(i,camera),0);
  i.hidden=false;i.sleeping=true;assert.equal(canChatter(i),false);
  i.sleeping=false;i.task={kind:'flee',target:1,x:0,z:0,stage:0,timer:0};assert.equal(canChatter(i),false);
});

test('original syllables have varied voices, bounded pitch and short coherent phrase timing',()=>{
  const a=makeIslander(1,'A','m',0,0,()=>.5),b=makeIslander(2,'B','f',0,0,()=>.5);
  const phrase=chatterPhrase(a,()=>.5),other=chatterPhrase(b,()=>.5);
  assert.notEqual(phrase[0].pitch,other[0].pitch);
  for(let n=0;n<100;n++){
    const p=chatterPhrase(a);assert.ok(p.length>=4&&p.length<=7);
    p.forEach((s,k)=>{assert.ok(s.pitch>80&&s.pitch<400);assert.ok(s.duration>=.1&&s.duration<=.22);assert.equal(s.vowel.length,3);if(k)assert.ok(s.time>p[k-1].time+p[k-1].duration);});
    assert.ok(p.at(-1)!.time+p.at(-1)!.duration<3);
  }
});

function audio() {
  const nodes:any[]=[];
  const param=()=>({value:0,targets:[] as number[],setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(v:number){this.targets.push(v);}});
  const node=()=>{const n={gain:param(),frequency:param(),pan:param(),Q:param(),connect:(dest:any)=>dest,disconnect(){this.disconnected=true;},disconnected:false,start(){},stop(){},onended:null as any};nodes.push(n);return n;};
  const engine=new AudioEngine() as any;
  engine.ctx={state:'running',currentTime:0,createOscillator:node,createGain:node,createStereoPanner:node,createBiquadFilter:node,createBufferSource:node};
  engine.ambBus={};engine.noise={};
  return {engine,nodes};
}

test('nearby islanders exchange phrases with at most two voices and release all speech nodes',t=>{
  t.mock.method(Math,'random',()=>.1);
  const {engine,nodes}=audio();const a=makeIslander(1,'A','m',0,0,()=>.5),b=makeIslander(2,'B','f',1,0,()=>.5);
  engine.updateChatter(1.1,[a,b],camera);
  assert.equal(engine.voices.length,1);assert.equal(engine.chatterReply,b);
  engine.updateChatter(3,[a,b],camera);assert.equal(engine.voices.length,2);
  const allocated=nodes.length;engine.updateChatter(3,[a,b],camera);assert.equal(nodes.length,allocated);
  assert.ok(allocated<=22,'speech graph must be per phrase, not per syllable');
  engine.updateChatter(.2,[a,b],{...camera,x:100});
  for(const v of engine.voices)assert.equal(v.gain.gain.targets.at(-1),0);
  // Each oscillator's end callback disconnects its phrase and releases its voice slot.
  for(const n of nodes)if(n.onended)n.onended();
  assert.equal(engine.voices.length,0);assert.ok(nodes.every(n=>n.disconnected));
});

test('pause, mute, wildlife watching and suspended audio suppress chatter scheduling',()=>{
  const {engine,nodes}=audio(),a=makeIslander(1,'A','m',0,0,()=>.5);
  engine.updateChatter(0,[a],camera);engine.updateChatter(3,[a],camera,true);
  engine.muted=true;engine.updateChatter(3,[a],camera);
  engine.muted=false;engine.ctx.state='suspended';engine.updateChatter(3,[a],camera);
  assert.equal(nodes.length,0);
});
