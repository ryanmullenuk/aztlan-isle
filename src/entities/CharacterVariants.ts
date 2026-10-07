import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BI, type GlbModel } from './glbPeople';

export type CharacterStyle = 'classic' | 'flower' | 'loosehair';
export type CharacterModelKey = 'm' | 'f' | 'm_loosehair' | 'f_flower';

/** Older saves also get a stable mix, without changing the original founding pair or consuming RNG. */
export function characterModelKey(person: {id:number;gender:'m'|'f';appearance?:CharacterStyle;npc?:string}): CharacterModelKey {
  if (person.npc) return person.gender;
  const style=person.appearance ?? (person.id > 2 && Math.floor((person.id-3)/2)%2===0 ? (person.gender==='f'?'flower':'loosehair') : 'classic');
  return person.gender==='f' && style==='flower' ? 'f_flower' : person.gender==='m' && style==='loosehair' ? 'm_loosehair' : person.gender;
}

/** Both variants reuse the original body, UVs, 19 joints, skin weights and inverse bind frames. */
export function characterVariant(base: GlbModel, gender:'m'|'f', whiteUv:THREE.Vector2): GlbModel {
  const geo=base.geometry.index ? base.geometry.toNonIndexed() : base.geometry.clone();
  const p=geo.getAttribute('position'), uv=geo.getAttribute('uv'), hair=geo.getAttribute('aHairB'), J=base.joint;
  const kept:number[]=[];
  for(let k=0;k<p.count;k+=3) {
    const ids=[k,k+1,k+2], y=ids.reduce((n,i)=>n+p.getY(i),0)/3;
    // Keep the original face and beard as well as the body; only the hairstyle changes.
    const oldHair=ids.filter(i=>hair.getX(i)>.5 && hair.getX(i)<1.5).length;
    if(y>J.chest.y-.18 && oldHair>=1) continue;
    // Boots end at the ankles. The replacement feet bind to those same foot bones.
    if(y<.115)continue;
    kept.push(...ids);
    // Per-face UVs avoid sampling across the texture atlas at the boot/skin boundary.
    if(y<.55)for(const i of ids){uv.setXY(i,base.skinUv.x,base.skinUv.y);hair.setX(i,0);}
  }
  geo.setIndex(kept);
  for(let i=0;i<p.count;i++) if(p.getY(i)<.43) {
    const side=p.getX(i)>=0?'L':'R', ankle=J[`foot${side}`], knee=J[`shin${side}`];
    const t=THREE.MathUtils.clamp((p.getY(i)-ankle.y)/(knee.y-ankle.y),0,1);
    const x=THREE.MathUtils.lerp(ankle.x,knee.x,t), z=THREE.MathUtils.lerp(ankle.z,knee.z,t);
    p.setX(i,x+(p.getX(i)-x)*.83);p.setZ(i,z+(p.getZ(i)-z)*.8);
  }
  geo.computeVertexNormals();
  // Merge accessories into the body draw, with their weights fixed to the existing head/foot bones.
  const pieces:THREE.BufferGeometry[]=[geo.toNonIndexed()];geo.dispose();
  const brown=0x30221b, lightBrown=0x3d2b20;
  const add=(shape:THREE.BufferGeometry,at:THREE.Vector3,scale:THREE.Vector3,color:number|null,bone=BI.head,tag=0,rz=0)=>{
    shape.scale(scale.x,scale.y,scale.z).rotateZ(rz).translate(at.x,at.y,at.z);
    const g=shape.index?shape.toNonIndexed():shape;if(g!==shape)shape.dispose();
    g.computeVertexNormals();const n=g.getAttribute('position').count;
    const C=new THREE.Color(color??0xffffff),rgb=new Float32Array(n*3),U=new Float32Array(n*2),si=new Float32Array(n*4),sw=new Float32Array(n*4);
    const tex=color===null?base.skinUv:whiteUv;
    for(let i=0;i<n;i++){rgb.set([C.r,C.g,C.b],i*3);U.set([tex.x,tex.y],i*2);si[i*4]=bone;sw[i*4]=1;}
    g.setAttribute('color',new THREE.Float32BufferAttribute(rgb,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(U,2));
    g.setAttribute('aSkinI',new THREE.Float32BufferAttribute(si,4));g.setAttribute('aSkinW',new THREE.Float32BufferAttribute(sw,4));
    g.setAttribute('aHairB',new THREE.Float32BufferAttribute(new Float32Array(n).fill(tag),1));
    g.setAttribute('aVeg',new THREE.Float32BufferAttribute(new Float32Array(n*2),2));g.setAttribute('aMat',new THREE.Float32BufferAttribute(new Float32Array(n),1));
    pieces.push(g);
  };
  const ellipsoid=(x:number,y:number,z:number,sx:number,sy:number,sz:number,color:number|null,tag=0,bone=BI.head)=>add(new THREE.IcosahedronGeometry(1,1),new THREE.Vector3(x,y,z),new THREE.Vector3(sx,sy,sz),color,bone,tag);
  const cy=J.head.y+.105, cz=J.head.z;
  // Skin under the former hair cap closes the back of the head, behind the retained face.
  ellipsoid(0,cy,cz-.03,.115,.161,.081,null);
  // Scalp across the crown and down the back; the front remains a featureless face.
  add(new THREE.SphereGeometry(1,10,5,0,Math.PI*2,0,Math.PI*.52),new THREE.Vector3(0,cy+.09,cz-.025),new THREE.Vector3(.143,.116,.124),brown,BI.head,1);
  ellipsoid(0,cy+.007,cz-.076,.132,.154,.075,brown,1);
  if(gender==='f') {
    // Gathered high bun with a pink tie and five faceted hibiscus petals.
    ellipsoid(0,cy+.244,cz-.06,.098,.086,.077,brown,1);
    add(new THREE.TorusGeometry(.058,.012,4,9),new THREE.Vector3(0,cy+.196,cz-.021),new THREE.Vector3(1,1,.65),0xd56488);
    // A swept side lock frames the temple rather than a straight fringe.
    ellipsoid(-.105,cy+.087,cz+.017,.045,.078,.073,lightBrown,1);
    const flower=new THREE.Vector3(-.122,cy+.129,cz+.08);
    for(let k=0;k<5;k++) {
      const a=k*Math.PI*2/5;
      add(new THREE.IcosahedronGeometry(1,0),new THREE.Vector3(flower.x+Math.sin(a)*.033,flower.y+Math.cos(a)*.033,flower.z),new THREE.Vector3(.025,.039,.012),k%2?0xe66b81:0xf18696,BI.head,0,-a);
    }
    ellipsoid(flower.x,flower.y,flower.z+.014,.014,.015,.012,0xe9b831);
  } else {
    // Loose hair to the neck, with overlapping faceted waves rather than a tied topknot.
    for(const side of [-1,1])for(let k=0;k<3;k++)ellipsoid(side*(.126+k*.004),cy+.07-k*.072,cz-.056,.043,.061,.073,k%2?lightBrown:brown,1);

  }
  // Toe shapes keep the feet visibly barefoot while following the unchanged ankle rig.
  for(const side of ['L','R'] as const) {
    const foot=J[`foot${side}`],sign=side==='L'?1:-1;
    ellipsoid(foot.x,.126,foot.z,.045,.068,.047,null,0,BI[`foot${side}`]);
    ellipsoid(foot.x,.059,foot.z+.034,.058,.051,.104,null,0,BI[`foot${side}`]);
    for(let k=0;k<5;k++)ellipsoid(foot.x+sign*(k-2)*.018,.032,foot.z+.123-k*.005,.014,.023,.033-k*.003,null,0,BI[`foot${side}`]);
  }
  const geometry=mergeGeometries(pieces)!;for(const g of pieces)g.dispose();
  geometry.computeBoundingSphere();
  return {...base,geometry};
}
