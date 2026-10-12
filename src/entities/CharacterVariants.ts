import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BI, type GlbModel } from './glbPeople';
import { ISLANDER } from '../config';

export type CharacterStyle = 'classic' | 'flower' | 'loosehair';
export type CharacterModelKey = 'm' | 'f' | 'm_loosehair' | 'f_flower' | 'boy' | 'girl' | 'oldm' | 'oldf' | 'fatm' | 'fatf';

/** A stable share of adults (not the elders) are drawn with the heavier build. */
const HEAVY_SHARE = 0.18;
const unit = (n: number) => { const h = Math.sin(n) * 43758.5453; return h - Math.floor(h); };

/** Elders: a stable share of the adults, chosen by id. */
export function isElder(isl: { id: number; child: boolean }): boolean {
  if (isl.child) return false;
  return unit(isl.id * 127.1 + 311.7) < ISLANDER.elderShare;
}

/**
 * Which model draws an islander: children their own boy and girl models, elders the older man and
 * woman, a share of the other adults the heavier-built pair, and the rest the founding islanders
 * and their hairstyle variants. Stable by id, so older saves get the same mix without consuming RNG.
 */
export function characterModelKey(person: {id:number;gender:'m'|'f';appearance?:CharacterStyle;npc?:string;child?:boolean}): CharacterModelKey {
  if (person.npc) return person.gender;
  if (person.child) return person.gender === 'm' ? 'boy' : 'girl';
  // The founding pair (ids 1 and 2) always keep their original models.
  if (person.id > 2) {
    if (isElder({ id: person.id, child: false })) return person.gender === 'm' ? 'oldm' : 'oldf';
    if (unit(person.id * 71.3 + 19.1) < HEAVY_SHARE) return person.gender === 'm' ? 'fatm' : 'fatf';
  }
  const style=person.appearance ?? (person.id > 2 && Math.floor((person.id-3)/2)%2===0 ? (person.gender==='f'?'flower':'loosehair') : 'classic');
  return person.gender==='f' && style==='flower' ? 'f_flower' : person.gender==='m' && style==='loosehair' ? 'm_loosehair' : person.gender;
}

/**
 * Both variants reuse the original body, UVs, normals, 19 joints, skin weights and inverse bind
 * frames: the clothes, legs and boots are exactly the original's. Only the hair is replaced, with
 * a faceted hairstyle skinned to the head.
 */
export function characterVariant(base: GlbModel, gender:'m'|'f', whiteUv:THREE.Vector2): GlbModel {
  const geo=base.geometry.index ? base.geometry.toNonIndexed() : base.geometry.clone();
  const p=geo.getAttribute('position'), hair=geo.getAttribute('aHairB'), J=base.joint;
  const kept:number[]=[];
  for(let k=0;k<p.count;k+=3) {
    const ids=[k,k+1,k+2], y=ids.reduce((n,i)=>n+p.getY(i),0)/3;
    // Keep the original face and beard as well as the body; only the hairstyle changes.
    const oldHair=ids.filter(i=>hair.getX(i)>.5 && hair.getX(i)<1.5).length;
    if(y>J.chest.y-.18 && oldHair>=1) continue;
    kept.push(...ids);
  }
  geo.setIndex(kept);
  // Hair takes its colour from the model's own hair texel (white vertex colour, slightly shaded per
  // piece), so elders' grey and white hair is drawn on the new hairstyles as on the original's.
  let hairUv=whiteUv;
  const uvAttr=geo.getAttribute('uv');
  for(let i=0;i<hair.count;i++) if(hair.getX(i)>.5&&hair.getX(i)<1.5){hairUv=new THREE.Vector2(uvAttr.getX(i),uvAttr.getY(i));break;}
  const pieces:THREE.BufferGeometry[]=[geo.toNonIndexed()];geo.dispose();
  const brown=-1, darkBrown=-2, lightBrown=-3;
  const shade:Record<number,number>={[-1]:1,[-2]:0.82,[-3]:1.18};
  const add=(shape:THREE.BufferGeometry,at:THREE.Vector3,scale:THREE.Vector3,color:number|null,bone=BI.head,tag=0,rz=0)=>{
    shape.scale(scale.x,scale.y,scale.z).rotateZ(rz).translate(at.x,at.y,at.z);
    const g=shape.index?shape.toNonIndexed():shape;if(g!==shape)shape.dispose();
    // Flat normals: faceted like the rest of the low-poly character.
    g.computeVertexNormals();const n=g.getAttribute('position').count;
    const isHair=color!==null&&color<0;
    const C=isHair?new THREE.Color(1,1,1).multiplyScalar(shade[color!]):new THREE.Color(color??0xffffff),rgb=new Float32Array(n*3),U=new Float32Array(n*2),si=new Float32Array(n*4),sw=new Float32Array(n*4);
    const tex=color===null?base.skinUv:isHair?hairUv:whiteUv;
    for(let i=0;i<n;i++){rgb.set([C.r,C.g,C.b],i*3);U.set([tex.x,tex.y],i*2);si[i*4]=bone;sw[i*4]=1;}
    g.setAttribute('color',new THREE.Float32BufferAttribute(rgb,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(U,2));
    g.setAttribute('aSkinI',new THREE.Float32BufferAttribute(si,4));g.setAttribute('aSkinW',new THREE.Float32BufferAttribute(sw,4));
    g.setAttribute('aHairB',new THREE.Float32BufferAttribute(new Float32Array(n).fill(tag),1));
    g.setAttribute('aVeg',new THREE.Float32BufferAttribute(new Float32Array(n*2),2));g.setAttribute('aMat',new THREE.Float32BufferAttribute(new Float32Array(n),1));
    pieces.push(g);
  };
  const ellipsoid=(x:number,y:number,z:number,sx:number,sy:number,sz:number,color:number|null,tag=0,bone=BI.head)=>add(new THREE.IcosahedronGeometry(1,1),new THREE.Vector3(x,y,z),new THREE.Vector3(sx,sy,sz),color,bone,tag);
  /**
   * A shell of hair round the head: a slice of a sphere from `t0` to `t1` (0 = crown, 1 = under
   * the chin), open over the face by `gap` radians, flaring out below the ears by `flare` and
   * waving in `waves` locks round the head.
   */
  const shell=(t0:number,t1:number,gap:number,r:THREE.Vector3,at:THREE.Vector3,color:number,flare=0,waves=0,stretch=1)=>{
    const g=new THREE.SphereGeometry(1,16,7,Math.PI/2+gap/2,Math.PI*2-gap,t0*Math.PI,(t1-t0)*Math.PI);
    const q=g.getAttribute('position');
    for(let i=0;i<q.count;i++){
      const x=q.getX(i),y=q.getY(i),z=q.getZ(i);
      const below=Math.max(0,-y), a=Math.atan2(z,x);
      const k=(1+flare*below*below)*(1+(waves?0.07*Math.sin(a*waves)*below:0));
      q.setXYZ(i,x*k,y<0?y*stretch:y,z*k);
    }
    add(g,at,r,color,BI.head,1);
  };
  const cy=J.head.y+.105, cz=J.head.z;
  // Skin under the former hair closes the back of the head, kept well inside the new hair.
  ellipsoid(0,cy-.005,cz-.045,.1,.15,.07,null);
  const R=new THREE.Vector3(.142,.15,.13), C=new THREE.Vector3(0,cy+.03,cz-.03);
  if(gender==='f') {
    // Her face is a plate further forward than his (the original's long hair made the back of her
    // head): the new hair is centred further forward and deeper, round it.
    C.z=cz+.03;R.set(.15,.152,.165);
    // A smooth crown down to the ears, a little lower at the nape, the face left open; the crown
    // reaches a little further forward, over the top of the face.
    shell(0,.36,0,new THREE.Vector3(R.x,R.y,.185),C,brown);
    shell(.3,.7,1.25,R.clone().multiplyScalar(.99),C,darkBrown,.35,0,1.05);
    // Locks falling past each cheek frame the face (as the original's long hair does).
    for(const side of [-1,1]) ellipsoid(side*.125,cy-.035,cz+.1,.034,.105,.055,darkBrown,1);
    // A soft fringe swept across the top of the face to the parting.
    ellipsoid(.015,cy+.135,cz+.12,.105,.05,.075,brown,1);
    // Gathered high bun with a pink tie and five faceted hibiscus petals.
    ellipsoid(0,cy+.185,cz-.055,.088,.08,.075,brown,1);
    add(new THREE.TorusGeometry(.055,.012,4,9),new THREE.Vector3(0,cy+.145,cz-.045),new THREE.Vector3(1,1,.6),0xd56488);
    // A swept side lock frames the temple rather than a straight fringe.
    ellipsoid(-.12,cy+.06,cz+.08,.04,.07,.06,lightBrown,1);
    const flower=new THREE.Vector3(-.152,cy+.11,cz+.07);
    for(let k=0;k<5;k++) {
      const a=k*Math.PI*2/5;
      add(new THREE.IcosahedronGeometry(1,0),new THREE.Vector3(flower.x-.004,flower.y+Math.cos(a)*.03,flower.z+Math.sin(a)*.03),new THREE.Vector3(.012,.036,.024),k%2?0xe66b81:0xf18696,BI.head,0,0);
    }
    ellipsoid(flower.x-.01,flower.y,flower.z,.012,.014,.013,0xe9b831);
  } else {
    // Shoulder-length loose hair: a crown, then wavy locks falling round the back and sides to
    // the neck, parted over the brow with the face open.
    shell(0,.36,0,R,C,brown);
    shell(.3,.78,1.7,R.clone().multiplyScalar(1.02),C,darkBrown,.9,7,1.35);
  }
  const geometry=mergeGeometries(pieces)!;for(const g of pieces)g.dispose();
  geometry.computeBoundingSphere();
  return {...base,geometry};
}
