import * as THREE from 'three';
import { World } from '../world/World';
import { FX } from '../render/materials';
import { PresetName } from '../config';
import { SEA_SURFACE } from '../water/Water';

/** Scale to fit a low, gently sloping seabed without breaking the water surface (open sea only, never an inland lake). */
export function habitatFit(w: World, x: number, z: number, height: number, radius = .3): number {
  const bed=w.heightAt(x,z),cell=w.cellIndexAt(x,z);
  if(bed>-.35||bed<-3.2||cell<0||w.blocked(cell)||!w.isSea(cell))return 0;
  let low=bed,high=bed;
  for(const [dx,dz] of [[radius,0],[-radius,0],[0,radius],[0,-radius]]){
    const h=w.heightAt(x+dx,z+dz);low=Math.min(low,h);high=Math.max(high,h);
  }
  if(high-low>.32)return 0;
  return Math.min(1,(SEA_SURFACE-.12-high)/Math.max(.01,height));
}

/**
 * The shared underwater material. Everything on the sea floor lives in the same water:
 *  - one current surges back and forth across the reef as a travelling wave (in world space, so
 *    neighbours lean the same way one after another), on top of each piece's own slow wobble;
 *    taller parts lag behind their roots, so kelp whips and coral only nods;
 *  - sunlight dances over it: the same caustic net the sea draws on the sand, here on the coral.
 */
export function habitatMaterial(solid=false): THREE.MeshStandardMaterial {
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.82,transparent:true,depthWrite:false});
  // Solid pieces hide what is behind them (no coral showing through a boulder or a plate);
  // pixels that have faded right out are dropped, so they never hide a fish.
  if(solid){mat.depthWrite=true;mat.alphaTest=.04;}
  const range={value:36};mat.userData.habitatRange=range;
  mat.customProgramCacheKey=()=> 'underwater-habitat-v4';
  mat.onBeforeCompile=shader=>{
    shader.uniforms.uHabitatTime=FX.uTime;shader.uniforms.uHabitatWind=FX.uWind;shader.uniforms.uHabitatRange=range;shader.uniforms.uHabitatNight=FX.uNight;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      attribute vec2 aVeg; uniform float uHabitatTime; uniform float uHabitatWind;
      varying float vHabitatDepth; varying float vHabitatDistance; varying vec3 vHabitatWorld;`)
    .replace('#include <begin_vertex>',`#include <begin_vertex>
      #ifdef USE_INSTANCING
        mat4 habitatModel=modelMatrix*instanceMatrix;
      #else
        mat4 habitatModel=modelMatrix;
      #endif
      vec3 habitatOrigin=habitatModel[3].xyz;
      float phase=habitatOrigin.x*.23+habitatOrigin.z*.19;
      float sway=aVeg.x*step(.001,uHabitatWind);
      transformed.x+=sin(uHabitatTime*.42+phase)*.032*sway;
      transformed.z+=cos(uHabitatTime*.31+phase*1.3)*.025*sway;
      vHabitatDepth=max(0.0,${SEA_SURFACE}-habitatOrigin.y);
      vHabitatDistance=distance(cameraPosition,habitatOrigin);`)
    .replace('#include <project_vertex>',`#include <project_vertex>
      {
        vec3 hw=(habitatModel*vec4(transformed,1.0)).xyz;
        // The surge: a wave of current crossing the reef, a slower one under it; height lags it.
        float lag=(hw.y-habitatOrigin.y)*2.2;
        float s1=sin(uHabitatTime*1.05-(habitatOrigin.x*.31+habitatOrigin.z*.22)-lag);
        float s2=sin(uHabitatTime*.47+(habitatOrigin.x*.11-habitatOrigin.z*.17)-lag*.6);
        vec3 push=vec3(.8,0.,.6)*(s1*.07+s2*.05)*sway;
        push.y=-abs(s1)*.012*sway;
        hw+=push;
        mvPosition.xyz+=(viewMatrix*vec4(push,0.0)).xyz;
        gl_Position=projectionMatrix*mvPosition;
        vHabitatWorld=hw;
      }`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      uniform float uHabitatRange;uniform float uHabitatTime;uniform float uHabitatNight;
      varying float vHabitatDepth;varying float vHabitatDistance;varying vec3 vHabitatWorld;
      float hHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float hNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);
        return mix(mix(hHash(i),hHash(i+vec2(1.,0.)),u.x),mix(hHash(i+vec2(0.,1.)),hHash(i+vec2(1.,1.)),u.x),u.y);}
      /** The sea's own caustic net (same pattern as Water.ts draws on the sand). */
      float hCaustic(vec2 p,float t){
        vec2 q=p*.9+vec2(hNoise(p*.35+vec2(t*.18,0.)),hNoise(p*.35+vec2(2.7,t*.15)))*1.6;
        return pow(clamp(1.0-abs(hNoise(q)*2.0-1.0),0.,1.),7.0)*.6+pow(clamp(1.0-abs(hNoise(q*1.7+3.1)*2.0-1.0),0.,1.),7.0)*.4;
      }`)
    // Lit from above through the water: its own colour glows a little, so shaded sides stay bright.
    .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
      totalEmissiveRadiance+=diffuseColor.rgb*.22*(1.0-uHabitatNight*.85);`)
    .replace('#include <color_fragment>',`#include <color_fragment>
      // Richer than the dry colour (water flattens it), and only gently cooled with depth.
      diffuseColor.rgb=clamp(mix(vec3(dot(diffuseColor.rgb,vec3(.3,.59,.11))),diffuseColor.rgb,1.3),0.,1.);
      diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.62,.82,.84),smoothstep(.9,3.0,vHabitatDepth));
      float hDeep=max(0.0,${SEA_SURFACE}-vHabitatWorld.y);
      float hLight=hCaustic(vHabitatWorld.xz,uHabitatTime)*(1.0-smoothstep(1.2,3.0,hDeep))*(1.0-uHabitatNight)*(1.0-smoothstep(uHabitatRange*.35,uHabitatRange*.7,vHabitatDistance));
      diffuseColor.rgb*=1.0+hLight*.75;
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
  readonly records:{mesh:THREE.InstancedMesh;homes:THREE.Matrix4[];top:number;radius:number;ranks?:ArrayLike<number>;minFit?:number;lifts?:ArrayLike<number>}[]=[];
  /** Detail level (0..1): instances given a rank at or above it are left out (lower presets draw fewer). */
  density=1;
  constructor(private world: World){}
  /**
   * `ranks` (0..1 per home) thin the instances out with `density`; `minFit` leaves an instance out
   * rather than shrinking it below that fraction of its size to stay under the surface; `lifts`
   * (per home) stand an instance that far above the sea floor (a coral perched on a boulder).
   */
  add(mesh:THREE.InstancedMesh,homes:THREE.Matrix4[],top:number,radius=.3,opts:{ranks?:ArrayLike<number>;minFit?:number;lifts?:ArrayLike<number>}={}):void{mesh.userData.habitatColors=Array.from(mesh.instanceColor?.array??new Float32Array(homes.length*3).fill(1));
    const record={mesh,homes,top,radius,...opts};this.records.push(record);this.refresh(0,0,this.world.N-1,this.world.N-1,record);}
  /** Change the detail level, redoing every instance list when it changes. */
  setDensity(d:number):void{if(d===this.density)return;this.density=d;for(const r of this.records)this.refresh(0,0,this.world.N-1,this.world.N-1,r);}
  refresh(x0=0,z0=0,x1=this.world.N-1,z1=this.world.N-1,only?:HabitatInstances['records'][number]):void{
    const color=new THREE.Color(),matrix=new THREE.Matrix4(),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();
    const minX=x0-this.world.half-2,maxX=x1-this.world.half+3,minZ=z0-this.world.half-2,maxZ=z1-this.world.half+3;
    for(const r of only?[only]:this.records){
      if(!only&&!r.homes.some(m=>m.elements[12]>=minX&&m.elements[12]<=maxX&&m.elements[14]>=minZ&&m.elements[14]<=maxZ))continue;
      let count=0;
      for(let k=0;k<r.homes.length;k++){
        if(r.ranks&&r.ranks[k]>=this.density)continue;
        r.homes[k].decompose(p,q,s);
        const lift=r.lifts?r.lifts[k]:0;
        const fit=habitatFit(this.world,p.x,p.z,r.top*s.y+lift,r.radius*Math.max(s.x,s.z));
        if(fit<=0||fit<(r.minFit??0))continue;
        p.y=this.world.heightAt(p.x,p.z)-.02+lift*fit;s.multiplyScalar(fit);
        matrix.compose(p,q,s);r.mesh.setMatrixAt(count,matrix);r.mesh.setColorAt(count,color.fromArray(r.mesh.userData.habitatColors,k*3));count++;
      }
      r.mesh.count=count;r.mesh.userData.habitatAny=count>0;r.mesh.visible=count>0;r.mesh.instanceMatrix.needsUpdate=true;
      if(r.mesh.instanceColor)r.mesh.instanceColor.needsUpdate=true;
      if(count)r.mesh.computeBoundingSphere();
    }
  }
}
