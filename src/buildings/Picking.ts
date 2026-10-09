import * as THREE from 'three';
import type { Building } from './Buildings';

/** Pick visible architecture or any empty part of its ground footprint. */
export function pickBuilding(ray:THREE.Raycaster, buildings:Building[], ground:THREE.Vector3|null):Building|undefined {
  let chosen:Building|undefined, nearest=ground?ray.ray.origin.distanceTo(ground)+0.35:Infinity;
  const plane=new THREE.Plane(),point=new THREE.Vector3();
  for(const b of buildings){
    b.group.updateWorldMatrix(true,true);
    const parts=[b.finished,b.foundation,b.scaffold].filter(x=>x?.visible);
    for(const hit of ray.intersectObjects(parts,true))if(hit.distance<nearest){nearest=hit.distance;chosen=b;}
    plane.set(new THREE.Vector3(0,1,0),-b.y);
    if(!ray.ray.intersectPlane(plane,point))continue;
    // w/d already include the building's quarter-turn rotation.
    if(Math.abs(point.x-b.x)<=b.w/2+0.001 && Math.abs(point.z-b.z)<=b.d/2+0.001){
      const distance=ray.ray.origin.distanceTo(point);
      if(distance<nearest){nearest=distance;chosen=b;}
    }
  }
  return chosen;
}
