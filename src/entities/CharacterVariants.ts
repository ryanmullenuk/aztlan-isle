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
