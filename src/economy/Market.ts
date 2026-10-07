import { FOOD_KEYS, MARKET, ResourceKey } from '../config';
import type { Building } from '../buildings/Buildings';
import type { Islander } from '../entities/Islander';
import type { Economy } from './Economy';

export function marketReserve(eco: Economy, population: number, key: ResourceKey): number {
  if (key === 'wood') return MARKET.woodReserve;
  if (key === 'stone') return MARKET.stoneReserve;
  if (key === 'belief') return Infinity;
  const reserve = Math.max(MARKET.foodReserve, population * MARKET.foodPerIslander);
  return Math.max(0, eco.res[key] - Math.max(0, eco.food - reserve));
}

/** Displayed goods are part of global inventory. Moving them never creates or removes resources. */
export function marketBatch(eco: Economy, population: number, market: Building, buildings: Building[], people: Islander[], wanted?: ResourceKey): {res: Exclude<ResourceKey,'belief'>; n:number} | null {
  let best: {res: Exclude<ResourceKey,'belief'>; n:number} | null = null;
  for (const res of ['wood','stone',...FOOD_KEYS] as Exclude<ResourceKey,'belief'>[]) {
    if (wanted && res !== wanted) continue;
    const staged = buildings.filter(b=>b.key==='market' && b.complete).reduce((sum,b)=>sum+(b.marketStock[res]??0),0);
    const carried = people.filter(i=>i.carry?.market!==undefined && i.carry.res===res).reduce((sum,i)=>sum+(i.carry?.n??0),0);
    const room = MARKET.stallCap-(market.marketStock[res]??0)-people.filter(i=>i.carry?.market===market.id && i.carry.res===res).reduce((sum,i)=>sum+(i.carry?.n??0),0);
    const foodRoom = FOOD_KEYS.includes(res) ? Math.max(0,eco.food-Math.max(MARKET.foodReserve,population*MARKET.foodPerIslander)-buildings.filter(b=>b.key==='market'&&b.complete).reduce((n,b)=>n+FOOD_KEYS.reduce((s,k)=>s+(b.marketStock[k]??0),0),0)-people.filter(i=>i.carry?.market!==undefined&&FOOD_KEYS.includes(i.carry.res as ResourceKey)).reduce((n,i)=>n+(i.carry?.n??0),0)) : Infinity;
    const n=Math.floor(Math.min(MARKET.batch,room,foodRoom,eco.res[res]-marketReserve(eco,population,res)-staged-carried));
    if(n>0 && (!best || n>best.n)) best={res,n};
  }
  return best;
}
