import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Input} from '../src/ui/Input';
import {Game} from '../src/Game';
import * as THREE from 'three';
function harness(){
 globalThis.window={addEventListener(){}} as any;
 const calls={tap:0,preview:[] as number[][],pan:0,zoom:0};let placing=true;
 const input=new Input({addEventListener(){},clientHeight:800,setPointerCapture(){}} as any,{panPixels(){calls.pan++;},zoom(){calls.zoom++;},rotate(){},tilt(){}} as any,
 {onInteract(){},wantsPlacementDrag:()=>placing,onPlacementDrag:(x,y)=>calls.preview.push([x,y]),wantsToolDrag:()=>false,onTap(){calls.tap++;},onHover(){},onToolDragEnd(){},onCancel(){}} as any) as any;
 const event=(id:number,x:number,y:number,type='touch')=>({pointerId:id,clientX:x,clientY:y,pointerType:type,button:0,type:'pointerup'});
 return{input,calls,event,normal:()=>placing=false};
}
test('touch drag and tap position the preview without building on release',()=>{
 const {input,calls,event}=harness();input.down(event(1,100,200));input.move(event(1,170,250));input.up(event(1,170,250));
 assert.deepEqual(calls.preview,[[100,200],[170,250]]);assert.equal(calls.tap,0);assert.equal(calls.pan,0);
 input.down(event(1,110,220));input.up(event(1,110,220));assert.equal(calls.tap,0);
});
test('two-finger navigation does not place or move the preview accidentally',()=>{
 const {input,calls,event}=harness();input.down(event(1,100,200));input.down(event(2,200,200));
 input.move(event(2,230,240));input.up(event(2,230,240));input.up(event(1,100,200));
 assert.equal(calls.tap,0);assert.equal(calls.pan,1);assert.equal(calls.zoom,1);assert.equal(calls.preview.length,1);
});
test('desktop click and normal touch selection remain available; cancelled touches never place',()=>{
 const {input,calls,event,normal}=harness();input.down(event(1,100,200,'mouse'));input.up(event(1,100,200,'mouse'));assert.equal(calls.tap,1);
 normal();input.down(event(1,100,200));input.up(event(1,100,200));assert.equal(calls.tap,2);
 input.down(event(1,100,200));input.up({...event(1,100,200),type:'pointercancel'});assert.equal(calls.tap,2);
});
test('Place confirms the retained world point rather than the button screen location',()=>{
 let point:THREE.Vector3|undefined;
 const game={placing:'hut',hoverPoint:new THREE.Vector3(8,2,12),onTap:(_x:number,_y:number,p:THREE.Vector3)=>point=p} as any;
 Game.prototype.confirmPlacement.call(game);assert.deepEqual(point,game.hoverPoint);assert.notEqual(point,game.hoverPoint);
 game.placing=null;point=undefined;Game.prototype.confirmPlacement.call(game);assert.equal(point,undefined);
});
