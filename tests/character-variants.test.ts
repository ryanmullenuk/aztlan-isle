import {test} from 'node:test';
import assert from 'node:assert/strict';
import {characterModelKey,isElder} from '../src/entities/CharacterVariants';

test('islanders get a stable mix of models: founding pair, hairstyles, children, elders and heavier builds', ()=>{
 assert.equal(characterModelKey({id:1,gender:'m'}),'m');assert.equal(characterModelKey({id:2,gender:'f'}),'f');
 const adults=new Set(Array.from({length:80},(_,i)=>characterModelKey({id:i+1,gender:i%2?'f':'m'})));
 assert.deepEqual([...adults].sort(),['f','f_flower','fatf','fatm','m','m_loosehair','oldf','oldm']);
 const kids=new Set(Array.from({length:20},(_,i)=>characterModelKey({id:i+1,gender:i%2?'f':'m',child:true})));
 assert.deepEqual([...kids].sort(),['boy','girl']);
 // Elders always draw as the older man and woman; the same person keeps the same model.
 for(let id=3;id<80;id++) if(isElder({id,child:false})) assert.equal(characterModelKey({id,gender:'m'}),'oldm');
 assert.equal(characterModelKey({id:17,gender:'f'}),characterModelKey({id:17,gender:'f'}));
 // Hairstyles still apply to ordinary adults (not elders or the heavier build).
 const plain=Array.from({length:80},(_,i)=>i+3).find(id=>['m','f','m_loosehair','f_flower'].includes(characterModelKey({id,gender:'f'})))!;
 assert.equal(characterModelKey({id:plain,gender:'f',appearance:'flower'}),'f_flower');
 assert.equal(characterModelKey({id:plain,gender:'m',appearance:'loosehair'}),'m_loosehair');
 assert.equal(characterModelKey({id:plain,gender:'f',appearance:'classic'}),'f');
 assert.equal(characterModelKey({id:plain,gender:'m',appearance:'flower'}),'m');
 // Specialist NPCs keep the founding models.
 assert.equal(characterModelKey({id:3,gender:'f',npc:'healer'}),'f');
});

