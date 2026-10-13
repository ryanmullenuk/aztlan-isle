import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {COLORS} from '../config';
import {GeoBuilder,M,P} from '../render/GeoBuilder';
import {RNG} from '../world/rng';
import type {World} from '../world/World';
import type {Building} from './Buildings';

/** Pure scenery: adds no occupancy, soil, navigation, harvestable plants or draw calls. */
export function withBuildingGround(model:THREE.BufferGeometry,b:Building,w:World):THREE.BufferGeometry {
  if(!w||typeof b.local!=='function')return model;
  if(['jetty','tradedock','chinampa','torch','campfire','bonfire','firepit'].includes(b.key))return model;
  const [sw,sd]=b.def.size,hw=sw/2,hd=sd/2;
  const rng=new RNG(w.seed+b.cx*7919+b.cz*104729+sw*97+sd*31),phase=rng.range(0,6.28);
  const valid=(x:number,z:number)=>{
    // Test the whole small clump, not just its anchor, so leaves never spill onto a path.
    for(const dx of [-.18,0,.18])for(const dz of [-.18,0,.18]){
      const [wx,wz]=b.local(x+dx,z+dz),i=w.cellIndexAt(wx,wz);
      if(i<0||!w.isLandCell(i)||w.path[i]||w.blockFixed[i]||(w.occ[i]&&w.occ[i]!==b.id+1)||Math.abs(w.groundY(wx,wz)-b.y)>=.45)return false;
    }return true;
  };
  const height=(x:number,z:number)=>{const [wx,wz]=b.local(x,z);return w.groundY(wx,wz)-b.y+.018;};
  const geometry=new GeoBuilder(),segments=40,soil=new THREE.Color(0x9d815b),grass=new THREE.Color(COLORS.grassOlive);
  const ring=(k:number,outer:boolean)=>{
    const a=k/segments*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a);
    // Rounded superellipse with unequal, wandering margins; no aligned rectangular perimeter.
    const margin=outer?.28+.13*Math.sin(a*3+phase)+.08*Math.sin(a*7-phase):-.22;
    const x=Math.sign(ca)*Math.pow(Math.abs(ca),.22)*(hw+margin),z=Math.sign(sa)*Math.pow(Math.abs(sa),.22)*(hd+margin);
    return new THREE.Vector3(x,height(x,z),z);
  };
  for(let k=0;k<segments;k++){
    const points=[ring(k,false),ring(k,true),ring(k+1,false),ring(k+1,true)];
    if(!points.every(p=>valid(p.x,p.z)))continue;
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points.flatMap(p=>[p.x,p.y,p.z]),3));g.setIndex([0,2,1,1,2,3]);g.computeVertexNormals();
    geometry.add(g,{color:p=>soil.clone().lerp(grass,Math.min(.85,Math.max(0,(Math.max(Math.abs(p.x)/hw,Math.abs(p.z)/hd)-.86)*3))).multiplyScalar(.94+.08*Math.sin(p.x*5+p.z*3))});g.dispose();
  }
  // Sparse edge clumps, leaving the front approach and adjacent paths open.
  for(let k=0;k<7;k++){
    const a=rng.range(.55,Math.PI*2-.55),ca=Math.cos(a),sa=Math.sin(a);
    const x=Math.sign(ca)*Math.pow(Math.abs(ca),.22)*(hw+rng.range(.08,.3)),z=Math.sign(sa)*Math.pow(Math.abs(sa),.22)*(hd+rng.range(.08,.3));
    if(!valid(x,z)||(z>hd-.4&&Math.abs(x)<.7))continue;
    const y=height(x,z);
    for(let j=0;j<3;j++)geometry.add(P.cone(.025,rng.range(.09,.17),3),{color:grass,leaf:1,sway:.15},M.t(x+(j-1)*.035,y+.05,z,0,j*2,0));
    if(k===2||k===5){
      geometry.add(P.sphere(.10,0),{color:0x627b3c,leaf:1,sway:.08},M.t(x,y+.08,z,0,a,0,1.2,.8,1));
      if(rng.chance(.5))geometry.add(P.sphere(.024,0),{color:rng.chance(.5)?0xd9b259:0xc78474},M.t(x+.045,y+.17,z));
    }
  }
  const apron=geometry.build();
  const merged=mergeGeometries([model,apron]);apron.dispose();
  if(!merged)return model;
  model.dispose();return merged;
}
