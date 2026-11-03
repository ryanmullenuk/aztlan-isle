import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Building } from '../src/buildings/Buildings';
import { FX } from '../src/buildings/Upgrades';
import { Economy } from '../src/economy/Economy';
import { Research } from '../src/economy/Research';
import { Forecaster, type ForecastInput } from '../src/economy/Forecast';
import { TradeFleet, tradeBoatsAt, workingUpgrades } from '../src/entities/Trade';
import { Voyages } from '../src/entities/Voyage';
import { makeIslander } from '../src/entities/Islander';
import { RNG } from '../src/world/rng';
import { OBSERVATORY, TRADE, VOYAGE } from '../src/config';

// The voyage orbs draw one small canvas texture: a stand-in canvas for node.
const ctx2d = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: '' };
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

const world = { half: 100, layerY: () => 0, groundY: () => 0 } as any;
/** A finished building with this many upgrades done. */
function built(key: Building['key'], ups: number, id = 1): Building {
  const b = new Building(id, key, 100, 100, 0, 0, world);
  b.complete = true;
  b.tier = ups + 1;
  return b;
}

/** A trade fleet with stand-in boats and the given buildings. */
function fleet(list: Building[]) {
  const eco = new Economy();
  Object.assign(eco.res, { wood: 500, stone: 500, grain: 100, fruit: 100 });
  eco.woodCap = eco.foodCap = 1000;
  const f = Object.create(TradeFleet.prototype) as any;
  Object.assign(f, {
    eco, ships: [], visitors: [], fame: () => 0, visitIn: 100,
    bld: { of: (k: string) => list.filter((b) => b.key === k), byId: (id: number) => list.find((b) => b.id === id), boatRequirement: () => '' },
    boats: { berth: () => ({ x: 0, z: 0, out: 0, approach: { x: 0, z: 2 } }), openSea: () => ({ x: 50, z: 0 }), waterPath: () => [] },
  });
  return f;
}

test('upgrades count only while the building is operational', () => {
  const m = built('market', 3);
  assert.equal(workingUpgrades(m), 3);
  m.integrity = 0.5;
  assert.equal(workingUpgrades(m), 0);
  m.integrity = 1; m.fire = 1;
  assert.equal(workingUpgrades(m), 0);
});

test('market: the Canoe landing brings visiting traders a quarter sooner', () => {
  const dock = built('tradedock', 0, 2);
  const visit = (ups: number) => {
    const f = fleet([dock, built('market', ups)]);
    f.sendVisitor = () => true;
    f.updateVisitors(10, 0, []);
    return 100 - f.visitIn;
  };
  assert.equal(visit(1), 10);
  assert.equal(visit(2), 10 * FX.market.often);
  // A damaged market does nothing.
  const f = fleet([dock, Object.assign(built('market', 2), { integrity: 0.5 })]);
  f.updateVisitors(10, 0, []);
  assert.equal(100 - f.visitIn, 10);
});

test('market: Haggling improves every trader’s rates like a point of fame', () => {
  const V = TRADE.visitors;
  assert.equal(fleet([built('market', 2)]).terms(), V);
  const t = fleet([built('market', 3), built('market', 1, 2)]).terms();
  assert.deepEqual(t.rate, [V.rate[0] * (1 + FX.market.rate), V.rate[1] * (1 + FX.market.rate)]);
  assert.deepEqual(t.deals, V.deals);
  // With fame too, the two add.
  const famed = fleet([built('market', 3)]);
  famed.fame = () => 2;
  assert.ok(Math.abs(famed.terms().rate[0] - V.rate[0] * (1 + FX.market.rate + 0.2)) < 1e-9);
});

test('trade dock: the Second berth moors a third trade boat', () => {
  const plain = built('tradedock', 0), berth = built('tradedock', 1);
  assert.equal(tradeBoatsAt(plain), TRADE.maxBoats);
  assert.equal(tradeBoatsAt(berth), TRADE.maxBoats + 1);
  const f = fleet([berth]);
  f.ships = [{ dock: berth.id }, { dock: berth.id }];
  assert.match(f.orderBoat(berth), /start work/);
  berth.boatBuild = 0;
  f.ships.push({ dock: berth.id });
  assert.match(f.orderBoat(berth), /all the boats/);
  const g = fleet([plain]);
  g.ships = [{ dock: plain.id }, { dock: plain.id }];
  assert.match(g.orderBoat(plain), /all the boats/);
});

test('trade dock: the Warehouse brings home half as much again, the Beacon fire shortens the trip', () => {
  const offer = TRADE.offers.find((o) => o.id === 'wood-stone')!;
  assert.deepEqual(fleet([]).haul(built('tradedock', 1), offer, 3), { stone: 36 });
  assert.deepEqual(fleet([]).haul(built('tradedock', 2), offer, 3), { stone: 54 });
  assert.equal(fleet([]).away(built('tradedock', 2)), TRADE.voyageSeconds);
  assert.equal(fleet([]).away(built('tradedock', 3)), TRADE.voyageSeconds / FX.tradedock.speed);
  // Sending a boat loads the bigger haul and gives the shorter time.
  const dock = built('tradedock', 3), f = fleet([dock]);
  f.ships = [{ dock: dock.id, state: 'docked', cargo: {} }];
  const msg = f.send(dock, offer, 1);
  assert.deepEqual(f.ships[0].cargo, { stone: 18 });
  assert.match(msg, new RegExp(`about ${Math.round(TRADE.voyageSeconds / FX.tradedock.speed + 20)} seconds`));
  assert.equal(f.eco.res.wood, 480, 'the same goods go out');
});

test('trade dock: the Beacon fire also brings the voyage ship home sooner', () => {
  const total = (ups: number) => {
    const eco = new Economy();
    Object.assign(eco.res, { wood: 200, stone: 100, grain: 100 });
    eco.woodCap = eco.foodCap = 999;
    const dock = { id: 4, key: 'tradedock', tier: ups + 1, complete: true, x: 0, z: 0, door: { x: 0, z: -1 }, dockX: 0, dockZ: 3, dir: [0, 1] } as any;
    const bld = { byId: (id: number) => (id === 4 ? dock : undefined), list: [dock] } as any;
    const list = [1, 2, 3, 4, 5, 6].map((id) => makeIslander(id, `V${id}`, id % 2 ? 'm' : 'f', 0, 0, () => 0.5));
    const colony = { list, remove(i: any) { this.list = this.list.filter((x: any) => x !== i); } } as any;
    const boats = {
      fleets: [] as any[], traffic: () => [], open: () => true, openSea: (x: number, z: number) => ({ x: x + 40, z }),
      waterPath: () => [], berth: () => ({ x: 0, z: 4, out: 0, approach: { x: 0, z: 6 } }), ride: () => {}, fx: { wake: () => {} },
    } as any;
    const V = new Voyages({ half: 100, heightAt: () => -2 } as any, bld, eco, boats, colony) as any;
    V.hooks = { notify: () => {}, sfx: () => {}, addChicken: () => true, visitorOrbs: () => [] };
    V.buildAt(dock);
    V.update(VOYAGE.buildSeconds + 1, 0);
    V.load('grain', 1); V.load('grain', 1);
    V.rng = new RNG(7);
    V.sail();
    return V.total;
  };
  assert.ok(Math.abs(total(3) - total(2) / FX.tradedock.speed) < 1e-9);
});

test('observatory: Star charts speed research, a third priest on duty speeds it again', () => {
  assert.equal(Research.boost(0, 2), 1);
  assert.equal(Research.boost(1, 2), FX.observatory.research);
  assert.equal(Research.boost(3, 2), FX.observatory.research);
  assert.equal(Research.boost(2, 3), FX.observatory.research, 'three on duty only count with the third priest’s post');
  assert.equal(Research.boost(3, 3), FX.observatory.research * FX.observatory.third);
});

test('observatory: the Taller platform gives storm and eruption warnings earlier', () => {
  const input = (upgrades: number, over: Partial<ForecastInput>): ForecastInput => ({
    staffed: true, storm: null, stormActive: false, volcano: null, volcanoActive: false, speed: 1, tier: 0, upgrades, ...over,
  });
  const storm = { id: 1, inSeconds: OBSERVATORY.stormWindow * 1.2, length: 100 };
  assert.equal(new Forecaster().update(input(1, { storm })).length, 0);
  assert.equal(new Forecaster().update(input(2, { storm }))[0]?.kind, 'announce');
  const volcano = { cycle: 1, inSeconds: OBSERVATORY.volcanoWindow * 1.2 };
  assert.equal(new Forecaster().update(input(1, { volcano })).length, 0);
  assert.equal(new Forecaster().update(input(2, { volcano }))[0]?.hazard, 'volcano');
  assert.equal(Forecaster.volcanoWindow(3, 2), OBSERVATORY.volcanoWindowEarly * FX.observatory.warning);
  assert.equal(Forecaster.stormWindow(), OBSERVATORY.stormWindow);
});
