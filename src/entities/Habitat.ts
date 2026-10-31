import * as THREE from 'three';
import { World } from '../world/World';
import { FX } from '../render/materials';
import { PresetName } from '../config';
import { SEA_SURFACE } from '../water/Water';

/** Scale to fit a low, gently sloping seabed without breaking the water surface. */
export function habitatFit(w: World, x: number, z: number, height: number, radius = .3): number {
  const bed=w.heightAt(x,z),cell=w.cellIndexAt(x,z);
  if(bed>-.35||bed<-3.2||cell<0||w.blocked(cell))return 0;
  let low=bed,high=bed;
  for(const [dx,dz] of [[radius,0],[-radius,0],[0,radius],[0,-radius]]){
    const h=w.heightAt(x+dx,z+dz);low=Math.min(low,h);high=Math.max(high,h);
  }
  if(high-low>.32)return 0;
  return Math.min(1,(SEA_SURFACE-.12-high)/Math.max(.01,height));
}

export function habitatMaterial(): THREE.MeshStandardMaterial {
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.82,transparent:true,depthWrite:false});
  const range={value:36};mat.userData.habitatRange=range;
  mat.customProgramCacheKey=()=> 'underwater-habitat-v1';
  mat.onBeforeCompile=shader=>{
    shader.uniforms.uHabitatTime=FX.uTime;shader.uniforms.uHabitatWind=FX.uWind;shader.uniforms.uHabitatRange=range;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      attribute vec2 aVeg; uniform float uHabitatTime; uniform float uHabitatWind;
      varying float vHabitatDepth; varying float vHabitatDistance;`)
    .replace('#include <begin_vertex>',`#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 habitatOrigin=(modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0)).xyz;
      #else
        vec3 habitatOrigin=modelMatrix[3].xyz;
      #endif
      float phase=habitatOrigin.x*.23+habitatOrigin.z*.19;
      float sway=aVeg.x*step(.001,uHabitatWind);
      transformed.x+=sin(uHabitatTime*.42+phase)*.032*sway;
      transformed.z+=cos(uHabitatTime*.31+phase*1.3)*.025*sway;
      vHabitatDepth=max(0.0,${SEA_SURFACE}-habitatOrigin.y);
      vHabitatDistance=distance(cameraPosition,habitatOrigin);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      uniform float uHabitatRange;varying float vHabitatDepth;varying float vHabitatDistance;`)
    .replace('#include <color_fragment>',`#include <color_fragment>
      diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.55,.78,.8),smoothstep(.7,2.8,vHabitatDepth));
      diffuseColor.a*=(1.0-smoothstep(2.0,3.8,vHabitatDepth))*(1.0-smoothstep(uHabitatRange*.7,uHabitatRange,vHabitatDistance));`);
  };return mat;
}

export function habitatPreset(group: THREE.Group, preset: PresetName): void {
  group.traverse(o=>{const m=(o as THREE.Mesh).material as THREE.Material|undefined;
    if(m?.userData.habitatRange)m.userData.habitatRange.value={low:24,medium:36,high:48,ultra:60}[preset];});
}

/** Retain deterministic candidate transforms; locally hide, resize or restore them after sculpting. */
export class HabitatInstances {
  /**
   * Skip whole patches that are past the distance where the shader has already faded them out
   * (they would cost a full, see-through draw for nothing). `cam` is the camera's position.
   */
  cull(cam:THREE.Vector3,range:number):void{
    for(const r of this.records){
      const sphere=r.mesh.boundingSphere;
      r.mesh.visible=!!r.mesh.userData.habitatAny&&(!sphere||cam.distanceTo(sphere.center)-sphere.radius<range);
    }
  }
  readonly records:{mesh:THREE.InstancedMesh;homes:THREE.Matrix4[];top:number;radius:number}[]=[];
  constructor(private world: World){}
  add(mesh:THREE.InstancedMesh,homes:THREE.Matrix4[],top:number,radius=.3):void{mesh.userData.habitatColors=Array.from(mesh.instanceColor?.array??new Float32Array(homes.length*3).fill(1));
    const record={mesh,homes,top,radius};this.records.push(record);this.refresh(0,0,this.world.N-1,this.world.N-1,record);}
  refresh(x0=0,z0=0,x1=this.world.N-1,z1=this.world.N-1,only?:HabitatInstances['records'][number]):void{
    const color=new THREE.Color(),matrix=new THREE.Matrix4(),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();
    const minX=x0-this.world.half-2,maxX=x1-this.world.half+3,minZ=z0-this.world.half-2,maxZ=z1-this.world.half+3;
    for(const r of only?[only]:this.records){
      if(!only&&!r.homes.some(m=>m.elements[12]>=minX&&m.elements[12]<=maxX&&m.elements[14]>=minZ&&m.elements[14]<=maxZ))continue;
      let count=0;
      for(let k=0;k<r.homes.length;k++){
        r.homes[k].decompose(p,q,s);
        const fit=habitatFit(this.world,p.x,p.z,r.top*s.y,r.radius*Math.max(s.x,s.z));
        if(fit<=0)continue;
        p.y=this.world.heightAt(p.x,p.z)-.02;s.multiplyScalar(fit);
        matrix.compose(p,q,s);r.mesh.setMatrixAt(count,matrix);r.mesh.setColorAt(count,color.fromArray(r.mesh.userData.habitatColors,k*3));count++;
      }
      r.mesh.count=count;r.mesh.userData.habitatAny=count>0;r.mesh.visible=count>0;r.mesh.instanceMatrix.needsUpdate=true;
      if(r.mesh.instanceColor)r.mesh.instanceColor.needsUpdate=true;
      if(count)r.mesh.computeBoundingSphere();
    }
  }
}
