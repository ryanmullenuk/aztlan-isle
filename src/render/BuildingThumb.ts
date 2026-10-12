import * as THREE from 'three';

/**
 * Small pictures of buildings for notices: the building's own finished model drawn by the game's
 * renderer into an offscreen target (three-quarter view from above, soft light, transparent
 * background) and kept as an image, once per building and tier. Uses a plain lit vertex-colour
 * material so drawing one never compiles the game's own building shaders afresh mid-play.
 */
const SIZE = 160;

export class BuildingThumbs {
  private cache = new Map<string, string>();
  private target: THREE.WebGLRenderTarget | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
  private material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
  private pixels = new Uint8Array(SIZE * SIZE * 4);

  constructor(private renderer: THREE.WebGLRenderer) {
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x5a4a3a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(3, 6, 4);
    this.scene.add(sun, this.mesh);
  }

  /** A data URL picture of this geometry (cached by key), or null if it can't be drawn. */
  get(key: string, geometry: THREE.BufferGeometry): string | null {
    const hit = this.cache.get(key);
    if (hit) return hit;
    try {
      const url = this.draw(geometry);
      if (url) this.cache.set(key, url);
      return url;
    } catch {
      return null;
    }
  }

  private draw(geometry: THREE.BufferGeometry): string | null {
    if (typeof document === 'undefined') return null;
    this.target ??= new THREE.WebGLRenderTarget(SIZE, SIZE, { samples: 4 });
    this.mesh.geometry = geometry;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!, centre = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z) * 0.62;
    // Front three-quarter view, a little from above, framing the whole building.
    const dir = new THREE.Vector3(0.75, 0.62, 1).normalize();
    this.camera.position.copy(centre).addScaledVector(dir, r / Math.sin(THREE.MathUtils.degToRad(15)));
    this.camera.lookAt(centre);
    const R = this.renderer, prevTarget = R.getRenderTarget(), prevClear = R.getClearColor(new THREE.Color()), prevAlpha = R.getClearAlpha();
    R.setRenderTarget(this.target);
    R.setClearColor(0x000000, 0);
    R.clear();
    R.render(this.scene, this.camera);
    R.readRenderTargetPixels(this.target, 0, 0, SIZE, SIZE, this.pixels);
    R.setRenderTarget(prevTarget);
    R.setClearColor(prevClear, prevAlpha);
    // Flip (GL rows run bottom-up) and convert the linear result to sRGB for the page.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(SIZE, SIZE), P = this.pixels;
    const srgb = (v: number) => Math.round(255 * (v <= 0.0031308 * 255 ? (v / 255) * 12.92 : 1.055 * Math.pow(v / 255, 1 / 2.4) - 0.055));
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const s = ((SIZE - 1 - y) * SIZE + x) * 4, d = (y * SIZE + x) * 4, a = P[s + 3];
      // Undo premultiplication against the transparent clear before converting.
      const k = a ? 255 / a : 0;
      img.data[d] = srgb(Math.min(255, P[s] * k));
      img.data[d + 1] = srgb(Math.min(255, P[s + 1] * k));
      img.data[d + 2] = srgb(Math.min(255, P[s + 2] * k));
      img.data[d + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  dispose(): void {
    this.target?.dispose();
    this.material.dispose();
  }
}
