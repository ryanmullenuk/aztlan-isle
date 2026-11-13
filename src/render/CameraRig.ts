import * as THREE from 'three';
import { CAMERA, RENDER } from '../config';
import { clamp, lerp, smoothstep } from '../world/noise';
import { World } from '../world/World';

/**
 * Miniature-diorama camera: narrow FOV, looking down ~53°, tilting lower when close.
 * All inputs set goals; the actual camera eases toward them.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3();
  goal = { x: 0, z: 0, dist: CAMERA.startDistance, yaw: CAMERA.startYaw, tilt: 0 };
  cur = { x: 0, z: 0, dist: CAMERA.startDistance, yaw: CAMERA.startYaw, tilt: 0 };
  /** Wildlife focus: navigation orbits this point without moving the animal. */
  cinematicTarget: THREE.Vector3 | null = null;
  /**
   * Photo Mode's lens: field of view and roll in degrees, and a free pitch (degrees from
   * horizontal; null keeps the usual zoom-based pitch). Null outside Photo Mode. Eased, so
   * opening and closing Photo Mode never pops the picture.
   */
  lens: { fov: number; roll: number; pitch: number | null } | null = null;
  private lensCur = { fov: RENDER.fov, roll: 0, pitch: CAMERA.pitch, mix: 0 };
  /** A scripted camera move (see Cinematics) is driving the view: keep the camera above the ground. */
  scripted = false;
  private groundY = 0;
  boundRadius = 80;

  constructor(aspect: number, private world: World) {
    this.camera = new THREE.PerspectiveCamera(RENDER.fov, aspect, RENDER.near, RENDER.far);
  }

  jumpTo(x: number, z: number, dist = this.goal.dist, yaw = this.goal.yaw): void {
    this.goal = { x, z, dist, yaw, tilt: this.goal.tilt };
    this.cur = { ...this.goal };
    this.groundY = Math.max(0, this.world.heightAt(x, z));
    this.apply();
  }

  get pitch(): number {
    const auto = this.autoPitch;
    // The lens's free pitch takes over (and hands back) gradually.
    const m = this.lensCur.mix;
    return m > 0.001 ? lerp(auto, (this.lensCur.pitch * Math.PI) / 180, m) : auto;
  }

  /** The pitch in degrees (for Photo Mode's tilt slider). */
  get pitchDegrees(): number {
    return (this.pitch * 180) / Math.PI;
  }

  private get autoPitch(): number {
    if (this.cinematicTarget) return clamp(25 + this.cur.tilt, 10, 80) * Math.PI / 180;
    const t = smoothstep(CAMERA.minDistance, 70, this.cur.dist);
    // Zoomed right out the view turns to look almost straight down on the whole map.
    const top = smoothstep(CAMERA.maxDistance * 0.8, this.maxDist, this.cur.dist);
    // Player tilt offsets the automatic zoom-based pitch (kept between a low view and straight down).
    const base = lerp(CAMERA.pitchClose, CAMERA.pitch, t);
    return (clamp(lerp(base + this.cur.tilt, CAMERA.overviewPitch, top), 16, 86) * Math.PI) / 180;
  }

  /** Furthest zoom: far enough to fit the whole map (and a margin of sea) on screen. */
  get maxDist(): number {
    const span = this.world.N * 1.12;
    const vh = 2 * Math.tan((RENDER.fov * Math.PI) / 360);
    return Math.max(CAMERA.maxDistance, span / (vh * Math.min(1, this.camera.aspect)));
  }

  /** Fly out to see the whole map from above (or back to where you were). */
  toggleOverview(): void {
    if (this.saved) {
      this.goal = { ...this.saved };
      this.saved = null;
      return;
    }
    this.saved = { ...this.goal };
    // Islands side by side on a wide screen, one above the other on a tall (phone) screen.
    // (Centred a little toward the bottom of the screen, which the toolbar covers.)
    const wide = this.camera.aspect >= 1;
    this.goal = { x: wide ? 0 : 7, z: wide ? 7 : 0, dist: this.maxDist * 1.04, yaw: wide ? 0 : Math.PI / 2, tilt: 0 };
  }
  private saved: { x: number; z: number; dist: number; yaw: number; tilt: number } | null = null;
  /** The photo lens is (or has just stopped) changing the camera's field of view. */
  private lensLive = false;
  private lensWasLive = false;

  /** Tilt the view up or down (degrees). */
  tilt(deg: number): void {
    this.goal.tilt = clamp(this.goal.tilt + deg, -30, 32);
  }

  /** World units per screen pixel at the focus point. */
  unitsPerPixel(screenH: number): number {
    return (2 * this.cur.dist * Math.tan(((this.lens ? this.lensCur.fov : RENDER.fov) * Math.PI) / 360)) / screenH;
  }

  /** Pan by a screen-space pixel delta (drag). */
  panPixels(dx: number, dy: number, screenH: number): void {
    if (this.cinematicTarget) {
      this.rotate(-dx * CAMERA.dragRotateSpeed);
      this.tilt(-dy * CAMERA.tiltSpeed);
      return;
    }
    const u = this.unitsPerPixel(screenH) * CAMERA.panSpeed;
    const yaw = this.cur.yaw;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const k = 1 / Math.max(0.5, Math.sin(this.pitch));
    this.goal.x += -rx * dx * u + fx * dy * u * k;
    this.goal.z += -rz * dx * u + fz * dy * u * k;
    // Keep immediate response for drags.
    this.cur.x = lerp(this.cur.x, this.goal.x, 0.6);
    this.cur.z = lerp(this.cur.z, this.goal.z, 0.6);
    this.clampGoal();
  }

  /** Pan with keyboard: forward/right in [-1,1], scaled per second. */
  panKeys(fwd: number, right: number, dt: number): void {
    if (this.cinematicTarget) {
      this.rotate(-right * CAMERA.rotateSpeed * dt);
      this.tilt(fwd * 40 * dt);
      return;
    }
    const yaw = this.goal.yaw;
    const speed = this.goal.dist * CAMERA.keyPanSpeed * dt;
    this.goal.x += (Math.cos(yaw) * right - Math.sin(yaw) * fwd) * speed;
    this.goal.z += (-Math.sin(yaw) * right - Math.cos(yaw) * fwd) * speed;
    this.clampGoal();
  }

  /** Zoom by a factor, optionally toward a world point. */
  zoom(factor: number, toward?: { x: number; z: number }): void {
    const old = this.goal.dist;
    // The photo lens may come in closer than play allows.
    this.goal.dist = clamp(old * factor, this.lens ? Math.min(3, CAMERA.minDistance) : CAMERA.minDistance, this.maxDist);
    this.saved = null;
    if (toward && !this.cinematicTarget) {
      const k = 1 - this.goal.dist / old;
      this.goal.x += (toward.x - this.goal.x) * k;
      this.goal.z += (toward.z - this.goal.z) * k;
    }
    if (!this.cinematicTarget) this.clampGoal();
  }

  rotate(d: number): void {
    this.goal.yaw += d;
  }

  private clampGoal(): void {
    const r = Math.hypot(this.goal.x, this.goal.z);
    if (r > this.boundRadius) {
      this.goal.x *= this.boundRadius / r;
      this.goal.z *= this.boundRadius / r;
    }
  }

  update(dt: number): void {
    if (this.cinematicTarget) {
      this.goal.x = this.cinematicTarget.x;
      this.goal.z = this.cinematicTarget.z;
    }
    const k = 1 - Math.exp(-CAMERA.damping * dt);
    this.cur.x = lerp(this.cur.x, this.goal.x, k);
    this.cur.z = lerp(this.cur.z, this.goal.z, k);
    this.cur.dist = lerp(this.cur.dist, this.goal.dist, k);
    this.cur.yaw = lerp(this.cur.yaw, this.goal.yaw, k);
    this.cur.tilt = lerp(this.cur.tilt, this.goal.tilt, k);
    this.easeLens(k);
    const gy = this.cinematicTarget ? this.cinematicTarget.y : Math.max(0, this.world.heightAt(this.cur.x, this.cur.z));
    this.groundY = lerp(this.groundY, gy, 1 - Math.exp(-3 * dt));
    this.apply();
  }

  /** Ease the photo lens toward its settings (or back to the game's own view when there is none). */
  private easeLens(k: number): void {
    const l = this.lens, c = this.lensCur;
    c.fov = lerp(c.fov, clamp(l?.fov ?? RENDER.fov, 8, 90), k);
    c.roll = lerp(c.roll, l?.roll ?? 0, k);
    const free = l?.pitch ?? null;
    if (free !== null) {
      // Taking over: start from the pitch already on screen, so the first touch of the slider doesn't jump.
      c.pitch = c.mix < 0.001 ? free : lerp(c.pitch, clamp(free, 2, 89), k);
      c.mix = lerp(c.mix, 1, k);
      if (c.mix > 0.999) c.mix = 1;
    } else {
      c.mix = lerp(c.mix, 0, k);
      if (c.mix < 0.001) c.mix = 0;
    }
    if (!l) {
      if (Math.abs(c.fov - RENDER.fov) < 0.01) c.fov = RENDER.fov;
      if (Math.abs(c.roll) < 0.01) c.roll = 0;
    }
  }

  private apply(): void {
    const p = this.pitch;
    const d = this.cur.dist;
    this.target.set(this.cur.x, this.groundY, this.cur.z);
    this.camera.position.set(
      this.cur.x + Math.sin(this.cur.yaw) * Math.cos(p) * d,
      this.groundY + Math.sin(p) * d,
      this.cur.z + Math.cos(this.cur.yaw) * Math.cos(p) * d
    );
    if (this.cinematicTarget || this.lens || this.scripted) {
      const floor = Math.max(0, this.world.heightAt(this.camera.position.x, this.camera.position.z)) + 0.8;
      this.camera.position.y = Math.max(floor, this.camera.position.y);
    }
    this.camera.lookAt(this.target);
    // The photo lens: roll about the view axis, and its own field of view.
    const c = this.lensCur;
    if (c.roll !== 0) this.camera.rotateZ((c.roll * Math.PI) / 180);
    if (!this.lens && c.fov === RENDER.fov && c.roll === 0) this.lensLive = false;
    else this.lensLive = true;
    if (this.lensLive || this.lensWasLive) {
      // (Free roam sets its own wide view directly: never fight it.)
      if (Math.abs(this.camera.fov - c.fov) > 1e-4) { this.camera.fov = c.fov; this.camera.updateProjectionMatrix(); }
      this.lensWasLive = this.lensLive;
    }
    this.camera.updateMatrixWorld();
  }

  /** Radius of ground visible around the target (for shadow fitting and LOD). */
  get viewRadius(): number {
    return this.cur.dist * Math.tan((RENDER.fov * Math.PI) / 360) * 1.9 * Math.max(1, this.camera.aspect * 0.8);
  }
}
