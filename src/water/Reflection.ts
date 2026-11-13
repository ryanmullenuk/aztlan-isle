import * as THREE from 'three';

/** How the sea mirrors the island: a real mirrored render, a cheap guess from the height map, or nothing. */
export type ReflectionMode = 'planar' | 'cheap' | 'off';

/** Which mirror each graphics preset gets (phones on low get none; medium a few texture reads near shore). */
export function reflectionModeFor(preset: string): ReflectionMode {
  return preset === 'ultra' || preset === 'high' ? 'planar' : preset === 'medium' ? 'cheap' : 'off';
}

/** The sea's uniforms this pass drives (owned by the ocean material alone: rivers never see the texture). */
export interface ReflectionUniforms {
  uReflect: { value: THREE.Texture | null };
  uReflectMat: { value: THREE.Matrix4 };
  uReflectK: { value: number };
}

const _eye = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _look = new THREE.Vector3();
const _up = new THREE.Vector3();
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();
const _size = new THREE.Vector2();
const _clear = new THREE.Color();
const _bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

/**
 * The island mirrored in the sea: the scene drawn once more from a camera reflected in the water
 * plane (everything under the surface clipped away), into a small texture the sea's shader reads
 * back through `uReflectMat`. The texture's alpha says where something stood to be mirrored; the
 * sky and clouds elsewhere stay the shader's own.
 *
 * It runs from the ocean mesh's `onBeforeRender` (as three's own Reflector does), so it needs no
 * place in the frame loop. Because the shader looks the texture up through the matrix it was drawn
 * with, an older texture still lands in the right place on the water: `every` > 1 redraws it only
 * every few frames.
 */
export class IslandReflection {
  /** Redraw every this many frames (1 = every frame). */
  every = 1;
  /** Share of the frame's resolution, and the most pixels along the longer side. */
  scale = 0.5;
  maxSize = 1024;
  private target: THREE.WebGLRenderTarget | null = null;
  private cam = new THREE.PerspectiveCamera();
  private busy = false;
  private lastStamp = -1;
  private lastDrawn = -1e9;
  private lastCam: THREE.Camera | null = null;

  /**
   * @param level height of the water plane
   * @param hide objects left out of the mirrored view (the sea itself, and the floor under it)
   */
  constructor(private uniforms: ReflectionUniforms, private level: number, private hide: THREE.Object3D[]) {}

  /** Leave something else out of the mirrored view (falling rain: streaks do not belong in the sea). */
  exclude(o: THREE.Object3D): void {
    if (!this.hide.includes(o)) this.hide.push(o);
  }

  /** Strength for this view (0 = not worth drawing): fades looking straight down and from very high up. */
  static strength(forwardY: number, eyeHeight: number): number {
    const s = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);
    return (1 - s(0.93, 0.975, -forwardY)) * (1 - s(110, 150, eyeHeight));
  }

  /** Stop mirroring (the texture is kept for when it's wanted again). */
  off(): void {
    this.uniforms.uReflectK.value = 0;
  }

  /** Free the texture (when the preset no longer wants a mirror). */
  dispose(): void {
    this.off();
    this.target?.dispose();
    this.target = null;
    this.uniforms.uReflect.value = null;
  }

  /**
   * Draw the mirrored view for this camera, at most once a frame. Safe to call from inside a render.
   * @param stamp the game frame's number (the scene may be drawn several times in one frame)
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, stamp: number): void {
    if (this.busy) return;
    const main = camera as THREE.PerspectiveCamera;
    if (!main.isPerspectiveCamera) return;
    if (stamp === this.lastStamp && camera === this.lastCam) return;
    const sameView = camera === this.lastCam;
    this.lastStamp = stamp;
    this.lastCam = camera;

    _eye.setFromMatrixPosition(main.matrixWorld);
    main.getWorldDirection(_fwd);
    const k = _eye.y > this.level + 0.05 ? IslandReflection.strength(_fwd.y, _eye.y) : 0;
    // (Never on before there is a picture to read: an empty texture would mirror as black.)
    this.uniforms.uReflectK.value = this.uniforms.uReflect.value ? k : 0;
    if (k <= 0) return;
    // The same view a frame or two later: the last texture still maps correctly through its own matrix.
    if (sameView && this.uniforms.uReflect.value && stamp - this.lastDrawn < this.every) return;
    this.lastDrawn = stamp;

    renderer.getDrawingBufferSize(_size);
    const fit = Math.min(this.scale, this.maxSize / Math.max(_size.x, _size.y, 1));
    const w = Math.max(8, Math.round(_size.x * fit)), h = Math.max(8, Math.round(_size.y * fit));
    if (!this.target) {
      // Half-float and linear like the frame itself, so lava and torches stay bright in the mirror.
      this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, stencilBuffer: false });
      this.target.texture.name = 'sea reflection';
      this.target.texture.generateMipmaps = false;
    } else if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);

    // The camera mirrored in the water plane (position, aim and up all reflected).
    const L = this.level, v = this.cam;
    _look.copy(_eye).add(_fwd);
    _up.set(0, 1, 0).transformDirection(main.matrixWorld);
    v.position.set(_eye.x, 2 * L - _eye.y, _eye.z);
    v.up.set(_up.x, -_up.y, _up.z);
    v.lookAt(_look.x, 2 * L - _look.y, _look.z);
    v.near = main.near;
    v.far = main.far;
    v.layers.mask = main.layers.mask;
    v.updateMatrixWorld();
    v.matrixWorldInverse.copy(v.matrixWorld).invert();
    v.projectionMatrix.copy(main.projectionMatrix);
    v.projectionMatrixInverse.copy(main.projectionMatrixInverse);
    this.uniforms.uReflectMat.value.copy(_bias).multiply(v.projectionMatrix).multiply(v.matrixWorldInverse);

    // Tilt the near plane onto the water (a hair below it, so the waterline never shows a gap):
    // nothing under the surface is drawn. (Lengyel's oblique near-plane clipping.)
    _plane.set(_up.set(0, 1, 0), -(L - 0.03)).applyMatrix4(v.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const e = v.projectionMatrix.elements;
    _q.set((Math.sign(_clip.x) + e[8]) / e[0], (Math.sign(_clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    const d = _clip.dot(_q);
    if (Math.abs(d) < 1e-9) return this.off();
    _clip.multiplyScalar(2 / d);
    e[2] = _clip.x;
    e[6] = _clip.y;
    e[10] = _clip.z + 1;
    e[14] = _clip.w;
    v.projectionMatrixInverse.copy(v.projectionMatrix).invert();

    // Draw it: no sea, no backdrop (transparent where nothing stands), shadows as the frame left them.
    const shown = this.hide.map((o) => o.visible);
    for (const o of this.hide) o.visible = false;
    const prevTarget = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    const prevAuto = renderer.shadowMap.autoUpdate, prevNeeds = renderer.shadowMap.needsUpdate;
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(_clear);
    const prevBackground = scene.background;
    this.busy = true;
    try {
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      scene.background = null;
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(this.target);
      renderer.clear(true, true, false);
      renderer.render(scene, v);
    } finally {
      this.busy = false;
      scene.background = prevBackground;
      renderer.setClearColor(_clear, prevAlpha);
      renderer.shadowMap.autoUpdate = prevAuto;
      renderer.shadowMap.needsUpdate = prevNeeds;
      renderer.xr.enabled = prevXr;
      renderer.setRenderTarget(prevTarget);
      this.hide.forEach((o, i) => (o.visible = shown[i]));
    }
    this.uniforms.uReflect.value = this.target.texture;
    this.uniforms.uReflectK.value = k;
  }
}
