import * as THREE from 'three';
import { BUILDING_FIRE as F, POWERS } from '../config';
import type { Colony } from '../ai/Colony';
import type { Islander } from '../entities/Islander';
import type { Economy } from '../economy/Economy';
import type { WeatherState } from '../economy/Powers';
import type { World } from '../world/World';
import type { Vegetation } from '../vegetation/Vegetation';
import { Building, BuildingSystem } from './Buildings';
import { buildingOperational } from './BuildingCondition';
import { flameGeometry } from './models';
import { fireMaterial } from '../render/materials';
import { Particles } from '../render/Particles';

export interface StormFireSave { unlocked: boolean; strikeIn: number }
export interface FireJob { fire: Building; well: Building }

/** Local fires: no spreading, one pooled smoke system and one instanced flame draw. */
export class StormFire {
  readonly group = new THREE.Group();
  unlocked = false;
  strikeIn = 28;
  onStrike: (x: number, y: number, z: number) => void = () => {};
  onAlert: (b: Building, text: string) => void = () => {};
  private clock = 0;
  private active = false;
  private wells: Building[] = [];
  private dispatchIn = 0;
  private wet = false;
  private failed = new Map<string, { until: number; version: number }>();
  private smoke = new Particles(96, 0x696469, .65);
  private smokeIn = 0;
  private flames: THREE.InstancedMesh;
  private bars: THREE.InstancedMesh;
  private backs: THREE.InstancedMesh;
  private object = new THREE.Object3D();
  private colour = new THREE.Color();
  private position = new THREE.Vector3();

  constructor(private world: World, private veg: Vegetation, private eco: Economy,
    private buildings: BuildingSystem, private colony: Colony, private rnd: () => number) {
    const material = fireMaterial().clone();
    material.vertexShader = material.vertexShader.replaceAll('modelMatrix', 'fireTransform').replace(
      'vec3 transformed = position;', `mat4 fireTransform = modelMatrix;
      #ifdef USE_INSTANCING
        fireTransform *= instanceMatrix;
      #endif
      vec3 transformed = position;`);
    this.flames = new THREE.InstancedMesh(flameGeometry(), material, F.maxFires * 3);
    const plane = new THREE.PlaneGeometry(1, 1);
    this.bars = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false }), 512);
    this.backs = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ color: 0x251f25, depthWrite: false }), 512);
    for (const mesh of [this.flames, this.bars, this.backs]) { mesh.count = 0; mesh.frustumCulled = false; }
    this.flames.renderOrder = 13; this.backs.renderOrder = 17; this.bars.renderOrder = 18;
    this.group.add(this.flames, this.smoke.points, this.backs, this.bars);
  }

  announceRestored(): void {
    for (const b of this.buildings.list) if (b.fire > 0) this.onAlert(b, `${b.label} is still on fire. Islanders need an accessible well. Tap to inspect.`);
  }

  save(): StormFireSave { return { unlocked: this.unlocked, strikeIn: this.strikeIn }; }
  restore(data?: StormFireSave): void {
    this.unlocked = data?.unlocked ?? false;
    this.active = this.buildings.list.some(b => b.fire > 0);
    this.wells = this.buildings.of('well');
    this.strikeIn = Math.max(1, Math.min(F.strikeSeconds[1], data?.strikeIn ?? 28));
  }

  ignite(b: Building): boolean {
    if (!this.unlocked || !this.buildings.list.includes(b) || !b.complete || b.ruined || b.fire > 0 || b.key === 'campfire' ||
      this.buildings.list.filter(x => x.fire > 0).length >= F.maxFires) return false;
    b.fire = F.initialStrength; b.integrity = Math.min(b.integrity, .94);
    this.active = true; this.wells = this.buildings.of('well'); b.builders.clear();
    this.colony.evacuateBuilding(b);
    if (!b.fireAlerted) {
      b.fireAlerted = true;
      this.onAlert(b, `${b.label} is on fire. Islanders need an accessible well; Calm prevents further lightning. Tap to inspect.`);
    }
    return true;
  }

  private roofY(b: Building): number {
    const geometry = b.finishedHi ?? b.finished?.geometry;
    if (geometry && !geometry.boundingBox) geometry.computeBoundingBox();
    return b.y + Math.max(.75, (geometry?.boundingBox?.max.y ?? 2) * (b.finished?.scale.y ?? 1));
  }

  /** Predominantly harmless terrain/tree strikes, independent of where the camera looks. */
  private strike(): void {
    const candidates = this.buildings.list.filter(b => b.complete && !b.ruined && b.fire <= 0 && b.key !== 'campfire');
    if (this.unlocked && candidates.length && this.rnd() < F.buildingChance) {
      const b = candidates[Math.min(candidates.length - 1, Math.floor(this.rnd() * candidates.length))];
      this.onStrike(b.x, this.roofY(b), b.z); this.ignite(b); return;
    }
    // Random land point; bounded attempts avoid scanning vegetation or terrain each frame.
    for (let n = 0; n < 12; n++) {
      const x = (this.rnd() - .5) * this.world.N, z = (this.rnd() - .5) * this.world.N;
      const cell = this.world.cellIndexAt(x, z);
      if (cell < 0 || !this.world.isLandCell(cell) || this.world.occ[cell]) continue;
      const tree = this.veg.findNearest(x, z, 3, p => this.veg.isChoppable(p));
      this.onStrike(tree?.x ?? x, tree ? this.world.groundY(tree.x, tree.z) + 2 : this.world.groundY(x, z), tree?.z ?? z);
      return;
    }
  }

  update(dt: number, weather: WeatherState): void {
    if (dt <= 0) return;
    this.clock += dt; this.wet = weather !== 'clear';
    this.wells = this.buildings.of('well');
    if (!this.unlocked && this.wells.length && this.eco.res.belief >= POWERS.calm.cost) this.unlocked = true;
    if (weather === 'storm') {
      this.strikeIn -= dt;
      if (this.strikeIn <= 0) {
        this.strikeIn = F.strikeSeconds[0] + this.rnd() * (F.strikeSeconds[1] - F.strikeSeconds[0]);
        this.strike(); // At most one strike per update, even after a long frame.
      }
    }
    this.active = false;
    for (const b of this.buildings.list) {
      if (b.fire <= 0 || b.ruined) continue;
      this.active = true;
      const growth = this.wet ? F.wetGrowth : F.dryGrowth;
      // Integrate the ramp and the capped full fire exactly, so frame size/speed cannot change damage.
      const rampTime = Math.min(dt, (1 - b.fire) / growth);
      const exposure = b.fire * rampTime + .5 * growth * rampTime * rampTime + (dt - rampTime);
      b.integrity = Math.max(0, b.integrity - exposure * F.damagePerSecond * (this.wet ? F.wetDamageMultiplier : 1));
      b.fire = Math.min(1, b.fire + dt * growth);
      if (b.integrity <= 0) { this.colony.evacuateBuilding(b); this.buildings.ruin(b); }
    }
    this.dispatchIn = Math.max(0, this.dispatchIn - dt);
    for (const [key, value] of this.failed) if (value.until <= this.clock || value.version !== this.world.navigationVersion) this.failed.delete(key);
    this.smokeIn -= dt;
    if (this.smokeIn <= 0) {
      this.smokeIn = .2;
      for (const b of this.buildings.list) if (b.fire > 0) {
        this.smoke.spawn(b.x, this.roofY(b) + .5, b.z, .08, .7, -.04, 3, .35 + b.fire * .6, .35);
      }
    }
    this.smoke.update(dt, -.02);
  }

  /** No synchronous A*: the normal travel queue verifies both legs and reports failures. */
  job(isl: Islander): FireJob | null {
    if (!this.active || !this.wells.length || this.dispatchIn > 0) return null;
    const fires = this.buildings.list.filter(b => b.fire > 0 && !b.ruined &&
      this.colony.list.filter(p => p.task?.kind === 'firefight' && p.task.target === b.id).length < F.firefighters)
      .sort((a, b) => Math.hypot(a.x - isl.x, a.z - isl.z) - Math.hypot(b.x - isl.x, b.z - isl.z));
    if (!fires.length) { this.dispatchIn = .25; return null; }
    for (const fire of fires) {
      const wells = this.wells.filter(well => buildingOperational(well) && !this.failed.has(`${isl.id}:${well.id}:${fire.id}`))
        .sort((a, b) => Math.hypot(a.door.x - isl.x, a.door.z - isl.z) + Math.hypot(a.door.x - fire.door.x, a.door.z - fire.door.z) -
          Math.hypot(b.door.x - isl.x, b.door.z - isl.z) - Math.hypot(b.door.x - fire.door.x, b.door.z - fire.door.z));
      if (wells[0]) { this.dispatchIn = 1; return { fire, well: wells[0] }; }
    }
    return null;
  }
  routeFailed(isl: Islander, well: number, fire: number): void {
    this.failed.set(`${isl.id}:${well}:${fire}`, { until: this.clock + F.retrySeconds, version: this.world.navigationVersion });
  }
  pour(b: Building): void {
    if (!this.buildings.list.includes(b) || b.ruined || b.fire <= 0) return;
    b.fire = Math.max(0, b.fire - F.waterReduction);
    if (b.fire <= 0) { b.fireAlerted = false; this.active = this.buildings.list.some(x => x.fire > 0); }
  }
  status(b: Building): string {
    if (b.ruined) return b.repairing ? 'Builders are rebuilding these ruins.' : 'Destroyed by fire. Rebuild to restore this building.';
    if (b.fire > 0) {
      const count = this.colony.list.filter(p => p.task?.kind === 'firefight' && p.task.target === b.id).length;
      return count ? `${count} islander${count === 1 ? '' : 's'} fetching water and fighting the fire.` :
        this.buildings.of('well').length ? 'Waiting for an available worker and a reachable water route.' : 'No working well: build or repair a well to supply water.';
    }
    return b.repairing ? `Repairing ${Math.round(b.repairProgress * 100)}%.` : 'Damaged: activity is suspended until repaired.';
  }

  render(time: number, camera: THREE.Camera): void {
    (this.flames.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    let flames = 0, bars = 0;
    const o = this.object;
    for (const b of this.buildings.list) {
      if (b.fire > 0) for (let n = 0; n < 3 && flames < this.flames.instanceMatrix.count; n++) {
        const growth = THREE.MathUtils.smoothstep(b.fire, F.initialStrength, 1);
        const spread = .12 + growth * .23;
        o.position.set(b.x + (n - 1) * spread, this.roofY(b) - .15, b.z + (n % 2) * spread * .65);
        o.quaternion.identity(); const pulse = 1 + Math.sin(time * 5 + b.id + n) * .08;
        // VillageFire's bonfire uses the same torch geometry at width 6.5 / height 13.
        const width = 1.8 + growth * 4.7, height = (2.5 + growth * 10.5) * (n === 1 ? 1 : .8);
        o.scale.set(width * pulse, height * pulse, width * pulse); o.updateMatrix(); this.flames.setMatrixAt(flames++, o.matrix);
      }
      if ((b.integrity >= 1 && !b.ruined) || bars >= this.bars.instanceMatrix.count) continue;
      this.position.set(b.x, this.roofY(b) + 2, b.z);
      o.position.copy(this.position); o.quaternion.copy(camera.quaternion); o.scale.set(1.6, .14, 1); o.updateMatrix(); this.backs.setMatrixAt(bars, o.matrix);
      const fraction = b.repairing ? b.repairProgress : b.integrity;
      o.translateX(-.8 * (1 - fraction)); o.translateZ(.01); o.scale.x = 1.6 * Math.max(.005, fraction); o.updateMatrix();
      this.bars.setMatrixAt(bars, o.matrix); this.colour.set(b.repairing ? 0x8fd16a : b.fire > 0 ? 0xf25e35 : 0xe8b84a); this.bars.setColorAt(bars++, this.colour);
    }
    this.flames.count = flames; this.bars.count = this.backs.count = bars;
    this.flames.visible = flames > 0; this.bars.visible = this.backs.visible = bars > 0;
    if (flames) {
      this.flames.instanceMatrix.clearUpdateRanges(); this.flames.instanceMatrix.addUpdateRange(0, flames * 16);
      this.flames.instanceMatrix.needsUpdate = true;
    }
    if (bars) {
      for (const attribute of [this.bars.instanceMatrix, this.backs.instanceMatrix, this.bars.instanceColor!]) {
        attribute.clearUpdateRanges(); attribute.addUpdateRange(0, bars * attribute.itemSize); attribute.needsUpdate = true;
      }
    }
  }
}
