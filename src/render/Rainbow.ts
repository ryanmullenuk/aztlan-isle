import * as THREE from 'three';
import type { LightState } from './Lighting';

/** Radius and band width of the arch as built (it is scaled to the view each frame). */
const R = 1, W = 0.12;
const _f = new THREE.Vector3(), _u = new THREE.Vector3();

const VS = /* glsl */ `
  attribute vec2 aBand;
  varying vec2 vBand;
  void main() {
    vBand = aBand;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FS = /* glsl */ `
  uniform float uAmt;
  varying vec2 vBand;
  void main() {
    // Violet on the inside to red on the outside, soft at both edges of the band.
    float t = vBand.x;
    vec3 c = clamp(vec3(
      smoothstep(0.45, 0.9, t) + smoothstep(0.2, 0.0, t) * 0.5,
      1.0 - abs(t - 0.5) * 2.4,
      smoothstep(0.55, 0.15, t)
    ), 0.0, 1.0);
    float a = sin(3.14159 * t);
    a *= a;
    // Faint at the feet, strongest across the top.
    a *= smoothstep(0.0, 0.25, vBand.y) * smoothstep(1.0, 0.75, vBand.y) * 0.7 + 0.3 * sin(3.14159 * vBand.y);
    gl_FragColor = vec4(c, a * uAmt * 0.38);
  }`;

/**
 * A rainbow after the rain. Like a real one it keeps its place in the view as the camera moves: an
 * arch across the upper part of the screen, over the island and the sea, brightest when looking
 * away from the sun. It fades in once a shower clears in daylight and away a minute or so later.
 * A soft wash of colour over whatever is behind it, light or dark.
 */
export class Rainbow {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  /** 0..1 how much of the rainbow is showing. */
  private amt = 0;
  /** Seconds left before it starts to fade. */
  private left = 0;

  constructor() {
    const seg = 96;
    const pos: number[] = [], band: number[] = [], idx: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI;
      for (const t of [0, 0.5, 1]) {
        const r = R - W + t * W;
        pos.push(Math.cos(a) * r, Math.sin(a) * r, 0);
        band.push(t, i / seg);
      }
      if (i < seg) {
        const b = i * 3;
        idx.push(b, b + 3, b + 1, b + 1, b + 3, b + 4, b + 1, b + 4, b + 2, b + 2, b + 4, b + 5);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aBand', new THREE.Float32BufferAttribute(band, 2));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uAmt: { value: 0 } },
      vertexShader: VS, fragmentShader: FS,
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.name = 'rainbow';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }

  /** The rain has just cleared: show a rainbow if the sun is out to make one. */
  show(seconds = 70): void {
    this.left = seconds;
  }

  update(dt: number, camera: THREE.PerspectiveCamera, target: THREE.Vector3, ls: LightState, overcast: number): void {
    const sunUp = THREE.MathUtils.smoothstep(ls.sunSky.y, 0.03, 0.15) * (1 - ls.night);
    this.left = Math.max(0, this.left - dt);
    const want = this.left > 0 ? sunUp * (1 - Math.min(1, overcast * 1.4)) : 0;
    this.amt += (want - this.amt) * (1 - Math.exp(-dt / (want > this.amt ? 3 : 8)));
    this.mesh.visible = this.amt > 0.004;
    if (!this.mesh.visible) return;
    camera.getWorldDirection(_f);
    // Faint when facing the sun, full when facing away from it.
    const fl = Math.hypot(_f.x, _f.z) || 1, sl = Math.hypot(ls.sunSky.x, ls.sunSky.z) || 1;
    const away = -(_f.x * ls.sunSky.x + _f.z * ls.sunSky.z) / (fl * sl);
    this.mat.uniforms.uAmt.value = this.amt * (0.35 + 0.65 * THREE.MathUtils.smoothstep(away, -0.3, 0.5));
    // Centred below the bottom of the screen at the target's depth, wide enough to span it.
    const depth = camera.position.distanceTo(target);
    const h = depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    _u.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this.mesh.position.copy(camera.position).addScaledVector(_f, depth).addScaledVector(_u, -h * 1.25);
    this.mesh.quaternion.copy(camera.quaternion);
    this.mesh.scale.setScalar(h * 2.05);
  }
}
