import * as THREE from 'three';
import type { LightState } from './Lighting';

const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();

const VS = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FS = /* glsl */ `
  uniform float uAmt, uTime;
  varying vec2 vUv;
  void main() {
    // x: 0 at the head .. 1 at the end of the tail (a little room behind the head for its glow); y: across it.
    float x = vUv.x * 1.25 - 0.25, y = vUv.y - 0.5;
    float tx = max(x, 0.0);
    // The blue gas tail, straight and narrow, and the broader, curving golden dust tail beside it.
    float wg = 0.006 + 0.075 * tx, wd = 0.014 + 0.17 * tx;
    float yd = y + 0.16 * tx * tx;
    float streak = 0.8 + 0.2 * sin(tx * 70.0 - uTime * 0.6 + y * 50.0);
    float gas = exp(-y * y / (wg * wg)) * pow(1.0 - tx, 2.2) * streak * step(0.0, x) * 0.75;
    float dust = exp(-yd * yd / (wd * wd)) * pow(1.0 - tx, 3.0) * step(0.0, x) * 0.4;
    // The bright head: a hard point in a soft round coma.
    float r2 = (x * x + y * y * 0.1024) * 196.0;
    float coma = exp(-r2 * 5.0) * 1.8 + exp(-r2 * 1.2) * 0.3;
    vec3 c = vec3(0.45, 0.72, 1.0) * gas + vec3(1.0, 0.84, 0.55) * dust + vec3(0.9, 0.96, 1.0) * coma;
    gl_FragColor = vec4(c * uAmt, 1.0);
  }`;

/**
 * A comet: a bright head with a long blue tail and a fainter golden one, across the upper part
 * of the night view. Like the rainbow it keeps its place in the view as the camera moves (high in
 * the sky ahead), fades in after dusk and out before dawn, and hides behind cloud.
 */
export class Comet {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private amt = 0;
  /** Seen tonight (set while the event lasts). */
  on = false;

  constructor() {
    // Head at the left end (x = 0); scaled and turned each frame.
    const g = new THREE.PlaneGeometry(1.25, 1).translate(0.375, 0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uAmt: { value: 0 }, uTime: { value: 0 } },
      vertexShader: VS, fragmentShader: FS,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.name = 'comet';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 19;
  }

  update(dt: number, time: number, camera: THREE.PerspectiveCamera, target: THREE.Vector3, ls: LightState, overcast: number): void {
    const want = this.on ? THREE.MathUtils.smoothstep(ls.night, 0.5, 0.85) * (1 - Math.min(1, overcast * 1.3)) : 0;
    this.amt += (want - this.amt) * (1 - Math.exp(-dt / 4));
    this.mesh.visible = this.amt > 0.004;
    if (!this.mesh.visible) return;
    this.mat.uniforms.uAmt.value = this.amt;
    this.mat.uniforms.uTime.value = time;
    camera.getWorldDirection(_f);
    _u.set(0, 1, 0).applyQuaternion(camera.quaternion);
    _r.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const depth = camera.position.distanceTo(target);
    const h = depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), w = h * camera.aspect;
    // Head high on the right of the view, the tail streaming up and away to the left.
    this.mesh.position.copy(camera.position).addScaledVector(_f, depth).addScaledVector(_u, h * 0.5).addScaledVector(_r, w * 0.42);
    this.mesh.quaternion.copy(camera.quaternion);
    this.mesh.rotateZ(Math.PI - 0.32);
    const len = Math.min(h * 1.5, w * 1.1);
    this.mesh.scale.set(len, len * 0.32, 1);
  }
}
