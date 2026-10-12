import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/ui/style.css',import.meta.url),'utf8');
const doc=new JSDOM(`<style>${css}</style>${html}`).window.document;
function matches(query:string,width:number,height:number):boolean{
  return query.split(' and ').every(part=>{
    const match=part.match(/\((min|max)-(width|aspect-ratio):\s*([\d.]+)(?:\s*\/\s*([\d.]+)|px)?\)/);
    if(!match)throw new Error(`Unsupported query: ${part}`);
    const actual=match[2]==='width'?width:width/height,value=Number(match[3])/(Number(match[4])||1);
    return match[1]==='min'?actual>=value:actual<=value;
  });
}
test('responsive source and CSS agree, retaining portrait fallback and one accessible Play control',()=>{
 const picture=doc.querySelector('picture.splash-picture')!,source=picture.querySelector('source')!,img=picture.querySelector('img')!;
 assert.equal(img.getAttribute('src'),'./splash.webp?v=5');assert.equal(img.getAttribute('alt'),'Aztlan Isle');
 assert.equal(source.getAttribute('srcset'),'./splash-desktop.webp?v=1');
 assert.ok(css.includes(`@media ${source.getAttribute('media')}`));
 assert.equal(doc.querySelectorAll('#play-btn').length,1);assert.equal(doc.querySelector('#play-btn')!.tagName,'BUTTON');
 assert.ok(!doc.querySelector('link[rel="preload"][href*="splash"]'),'do not force both splash assets to download');
});
test('portrait, landscape, tablet and ultrawide layouts retain title and character safe areas',()=>{
 const query=doc.querySelector('picture source')!.getAttribute('media')!;
 const cases=[[390,844,false],[430,932,false],[667,375,false],[852,393,false],[768,1024,false],[1024,768,true],[1366,768,true],[1920,1080,true],[3440,1440,true],[5120,1440,true]] as const;
 // Measured composition bounds in the attached 1672x941 image: title and both islanders.
 const areas=[{x:580,y:145,w:510,h:180},{x:280,y:500,w:290,h:320}];
 const rules=[...doc.styleSheets[0].cssRules].filter((r:any)=>r.conditionText) as any[];
 for(const [width,height,desktop] of cases){
  assert.equal(matches(query,width,height),desktop,`${width}x${height} source`);
  if(!desktop)continue;
  let fit='';
  for(const rule of rules){
   // Only art rules carry object-fit; skip unrelated media types/features.
   if(![...rule.cssRules].some((r:any)=>r.selectorText==='.splash-art'))continue;
   if(!matches(rule.conditionText,width,height))continue;
   for(const r of rule.cssRules)if(r.selectorText==='.splash-art'&&r.style.getPropertyValue('object-fit'))fit=r.style.getPropertyValue('object-fit');
  }
  assert.ok(fit==='cover'||fit==='contain');
  const scale=(fit==='cover'?Math.max:Math.min)(width/1672,height/941),left=(width-1672*scale)/2,top=(height-941*scale)/2;
  for(const a of areas){const x=left+a.x*scale,y=top+a.y*scale;assert.ok(x>=0&&y>=0&&x+a.w*scale<=width&&y+a.h*scale<=height,`${width}x${height} clipped composition`);}
  const desktopRule=rules.find(r=>r.conditionText===query);
  const uiRule=[...desktopRule.cssRules].find((r:any)=>r.selectorText==='.splash-ui') as any;
  const bottomPercent=Number(uiRule.style.getPropertyValue('bottom').match(/([\d.]+)%/)[1]);
  const titleBottom=top+(areas[0].y+areas[0].h)*scale;
  assert.ok(height*(1-bottomPercent/100)-160>titleBottom,'lowered Play block stays below the title');
  const peopleRight=left+(areas[1].x+areas[1].w)*scale;assert.ok(width*.5-100>peopleRight,'centred Play stays clear of the islanders');
 }
});
