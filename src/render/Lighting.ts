import * as THREE from 'three';
import { COLORS, DAY_KEYS, RENDER } from '../config';
import { clamp } from '../world/noise';

export interface LightState {
  /** Where the light comes from: the sun, handing over to the moon at night (kept a little above the horizon). */
  sunDir: THREE.Vector3;
  /** Where the sun and the moon really are in the sky (the sun sets below the horizon). */
  sunSky: THREE.Vector3;
  moonSky: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  night: number;
  /** 0 at night, 1 in full daylight. */
  day: number;
  exposure: number;
  fog: THREE.Color;
  /** Golden hour: 1 while the sun is low and warm, just after sunrise and before sunset (0 at midday and at night). */
  golden: number;
  /** The blue hour: 1 in the deep blue twilight either side of the night. */
  dusk: number;
  /** How much of the light is the moon's (0 by day, 1 on a clear night). */
  moon: number;
  /** Morning mist: gathers before dawn, lies thickest at sunrise and burns off through the morning. */
  mist: number;
  /** How strongly shafts of low sunlight show in the air (0 at midday, at night and under cloud). */
  shafts: number;
}

/** The atmosphere's slow quantities for a time of day (pure: no light or scene needed). */
export function atmosphereAt(dayT: number, elevDeg: number, overcast = 0): { golden: number; dusk: number; mist: number; shafts: number } {
  const ss = THREE.MathUtils.smoothstep;
  const clear = 1 - clamp(overcast, 0, 1);
  // Low, warm sun: from just clearing the horizon up to a third of the way up the sky.
  const golden = (1 - ss(elevDeg, 8, 30)) * ss(elevDeg, -4, 3);
  // Blue hour: the sun a little below the horizon, the sky still holding its light.
  const dusk = ss(elevDeg, -16, -5) * (1 - ss(elevDeg, -3, 6));
  // A thin veil gathers through the small hours, thickens at first light, and is gone by mid-morning.
  const gather = dayT < 0.13 ? 0.3 * ss(dayT, 0.02, 0.13) : 0.3 + 0.7 * ss(dayT, 0.13, 0.2);
  const mist = gather * (1 - ss(dayT, 0.26, 0.37)) * (1 - 0.8 * clamp(overcast, 0, 1));
  // Shafts want a low sun and clear air; mist in the air makes them stand out.
  const shafts = (1 - ss(elevDeg, 14, 36)) * ss(elevDeg, -2, 4) * clear * (0.6 + 0.4 * mist);
  return { golden, dusk, mist, shafts };
}

const cA = new THREE.Color();
const _sun = new THREE.Vector3();
const _moon = new THREE.Vector3();
const cB = new THREE.Color();
const cC = new THREE.Color();
/** Storm cloud tints: grey by day, deep slate at night (so night storms stay dark). */
const STORM_HEMI_DAY = new THREE.Color(0x8a97a8);
const STORM_HEMI_NIGHT = new THREE.Color(0x1f2836);
const STORM_FOG_DAY = new THREE.Color(0x7f8a96);
const STORM_FOG_NIGHT = new THREE.Color(0x0f141c);
/** Eclipse: the last sunlight thin and coppery, the sky a deep dusky blue. */
const ECLIPSE_SUN = new THREE.Color(0xffb27a);
const ECLIPSE_SKY = new THREE.Color(0x3a4a70);
/** Lightning: a cold blue-white flash on the land and in the sky. */
const FLASH_LIGHT = new THREE.Color(0xd4e0ff);
const FLASH_SKY = new THREE.Color(0x7d8cb0);
/** Golden hour: deep amber sun, a peach sky bounce, warm earth bounce and honeyed haze. */
const GOLD_SUN = new THREE.Color(0xffa24e);
const GOLD_SKY = new THREE.Color(0xf0bfa6);
const GOLD_GROUND = new THREE.Color(0xd8965a);
const GOLD_FOG = new THREE.Color(0xffc48c);
/** Blue hour: a saturated blue sky bounce and deep blue distance, before the moon takes over. */
const DUSK_SKY = new THREE.Color(0x5b74d6);
const DUSK_FOG = new THREE.Color(0x3d5190);
const DUSK_LIGHT = new THREE.Color(0xa6b8ff);
/** Moonlight: cool and silvery, with enough shape in it to read the land by. */
const MOON_LIGHT = new THREE.Color(0xa9c4ff);
/** The fill light's own tint: cool by day, warm at golden hour, blue at dusk and by night. */
const AMB_DAY = new THREE.Color(0xbfd8ff);
const AMB_GOLD = new THREE.Color(0xffd6ac);
const AMB_BLUE = new THREE.Color(0x8ea6ff);

/** Scratch vectors for fitting the shadow camera. */
const UP = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(), _snap = new THREE.Vector3();

/**
 * Golden-hour sun, cool sky bounce, low ambient, and the day/night keyframes.
 * The sun's shadow camera is re-fitted every frame around what the camera sees.
 */
export class Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  readonly state: LightState = {
    sunDir: new THREE.Vector3(),
    sunSky: new THREE.Vector3(0, 1, 0),
    moonSky: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(),
    sunIntensity: 3,
    night: 0,
    day: 1,
    exposure: RENDER.exposure,
    fog: new THREE.Color(RENDER.fogColor),
    golden: 0,
    dusk: 0,
    moon: 0,
    mist: 0,
    shafts: 0,
  };
  /** The light of the scene being drawn, for systems with no handle on this object (the post chain). */
  static current: LightState | null = null;
  /** World azimuth (radians) the evening sun sits at: upper-right of the default view. */
  eveningAzimuth = 0;
  /** Darkening from storms / rain (0..1). */
  overcast = 0;
  /** Lightning flash on the scene (0..~1.4), set each frame by the weather. */
  flash = 0;
  /** How dark an eclipse has made the day (0..1). */
  eclipse = 0;
  ultra = false;

  constructor(scene: THREE.Scene, shadowSize: number) {
    this.sun = new THREE.DirectionalLight(COLORS.sunWarm, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.sun.shadow.bias = -0.0006;
    // Larger normal offset: no shadow acne patterns on smooth hillsides.
    this.sun.shadow.normalBias = 0.07;
    // A gentle PCF penumbra keeps the faceted trees' ground shadows soft.
    this.sun.shadow.radius = 1.6;
    const sc = this.sun.shadow.camera;
    sc.near = 1;
    sc.far = 400;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(COLORS.sky, COLORS.hemiGround, 1.0);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xbfd8ff, 0.18);
    scene.add(this.ambient);
    Lighting.current = this.state;
  }

  setShadowSize(size: number): void {
    if (this.sun.shadow.mapSize.x === size) return;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  /**
   * @param dayT real day fraction 0..1
   * @param target camera look-at point
   * @param viewRadius approximate radius of the visible area
   */
  update(dayT: number, target: THREE.Vector3, viewRadius: number): void {
    // Interpolate keyframes.
    let a = DAY_KEYS[0], b = DAY_KEYS[DAY_KEYS.length - 1];
    for (let i = 0; i < DAY_KEYS.length - 1; i++) {
      if (dayT >= DAY_KEYS[i].t && dayT <= DAY_KEYS[i + 1].t) {
        a = DAY_KEYS[i];
        b = DAY_KEYS[i + 1];
        break;
      }
    }
    const f = b.t > a.t ? (dayT - a.t) / (b.t - a.t) : 0;
    const L = (x: number, y: number) => x + (y - x) * f;
    const elev = L(a.elev, b.elev);
    const night = L(a.night, b.night);
    const s = this.state;
    s.night = night;
    s.day = 1 - night;

    // Sun sweeps across the sky; in the evening it is upper-right of the default view.
    const az = this.eveningAzimuth + (0.66 - dayT) * 3.4;
    let el = (elev * Math.PI) / 180;
    s.sunSky.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    el = Math.max(el, (6 * Math.PI) / 180);
    _sun.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    // At night the light hands over smoothly to a high, silvery moon that drifts slowly across the sky
    // (its glitter path on the sea points back toward the default view).
    const mAz = this.eveningAzimuth + 0.35 + (dayT < 0.5 ? dayT + 1 : dayT) * 0.5 - 0.5;
    const mEl = (40 * Math.PI) / 180;
    _moon.set(Math.cos(mAz) * Math.cos(mEl), Math.sin(mEl), Math.sin(mAz) * Math.cos(mEl));
    s.moonSky.copy(_moon);
    const m = clamp((night - 0.3) / 0.5, 0, 1);
    s.sunDir.copy(_sun).lerp(_moon, m * m * (3 - 2 * m)).normalize();

    cA.setHex(a.sun);
    cB.setHex(b.sun);
    s.sunColor.copy(cA).lerp(cB, f);
    const oc = this.overcast;
    s.sunIntensity = L(a.sunI, b.sunI) * (1 - oc * 0.85);
    this.sun.color.copy(s.sunColor);
    this.sun.intensity = s.sunIntensity;

    cA.setHex(a.hemiSky);
    cB.setHex(b.hemiSky);
    this.hemi.color.copy(cA).lerp(cB, f).lerp(cC.copy(STORM_HEMI_DAY).lerp(STORM_HEMI_NIGHT, night), oc * 0.7);
    cA.setHex(a.hemiGround);
    cB.setHex(b.hemiGround);
    this.hemi.groundColor.copy(cA).lerp(cB, f);
    this.hemi.intensity = L(a.hemiI, b.hemiI) * (1 - oc * (0.35 + 0.15 * night));
    this.ambient.intensity = L(a.amb, b.amb) * (1 - oc * 0.35 * night);

    cA.setHex(a.fog);
    cB.setHex(b.fog);
    s.fog.copy(cA).lerp(cB, f).lerp(cC.copy(STORM_FOG_DAY).lerp(STORM_FOG_NIGHT, night), oc * 0.6);
    s.exposure = L(a.exposure, b.exposure) * (1 - oc * (0.12 + 0.08 * night));

    // The hours between the keyframes: golden light either side of the day, the blue hour either
    // side of the night, moonlight with some shape to it. Cloud mutes all of them.
    const at = atmosphereAt(dayT, elev, oc);
    const clear = 1 - oc * 0.7;
    const g = at.golden * clear, bl = at.dusk * clear, mo = m * m * (3 - 2 * m);
    s.golden = g;
    s.dusk = bl;
    s.moon = mo * (1 - oc);
    s.mist = at.mist;
    s.shafts = at.shafts;
    if (g > 0.001) {
      s.sunColor.lerp(GOLD_SUN, 0.45 * g);
      this.sun.color.copy(s.sunColor);
      this.hemi.color.lerp(GOLD_SKY, 0.3 * g);
      this.hemi.groundColor.lerp(GOLD_GROUND, 0.4 * g);
      s.fog.lerp(GOLD_FOG, 0.3 * g);
      s.exposure *= 1 + 0.04 * g;
    }
    if (bl > 0.001) {
      s.sunColor.lerp(DUSK_LIGHT, 0.3 * bl);
      this.sun.color.copy(s.sunColor);
      this.hemi.color.lerp(DUSK_SKY, 0.5 * bl);
      this.hemi.intensity *= 1 + 0.12 * bl;
      s.fog.lerp(DUSK_FOG, 0.45 * bl);
    }
    if (mo > 0.001) {
      // A touch more of the night's light from the moon itself and less from the sky all round,
      // so slopes, roofs and shadows keep their shape in the dark.
      s.sunColor.lerp(MOON_LIGHT, 0.35 * mo);
      this.sun.color.copy(s.sunColor);
      s.sunIntensity *= 1 + 0.12 * mo;
      this.sun.intensity = s.sunIntensity;
      this.hemi.intensity *= 1 - 0.06 * mo;
    }
    this.ambient.color.copy(AMB_DAY).lerp(AMB_GOLD, 0.6 * g).lerp(AMB_BLUE, Math.max(0.5 * bl, 0.35 * mo));
    // Long, low shadows fall softer-edged than the short ones of midday.
    this.sun.shadow.radius = 1.6 + 1.1 * g;

    if (this.ultra) {
      // Deeper blue-black sky, retaining moonlight and emissive lamps for navigation.
      s.fog.multiplyScalar(1 - night * 0.6);
      this.hemi.color.multiplyScalar(1 - night * 0.25);
      this.hemi.intensity *= 1 - night * 0.15;
      this.ambient.intensity *= 1 - night * 0.2;
    }

    // An eclipse: the sunlight fails, the sky goes a deep coppery dusk and the stars come out.
    const ec = this.eclipse * s.day;
    if (ec > 0.001) {
      s.sunIntensity *= 1 - 0.88 * ec;
      this.sun.intensity = s.sunIntensity;
      this.sun.color.lerp(ECLIPSE_SUN, ec);
      this.hemi.intensity *= 1 - 0.5 * ec;
      this.hemi.color.lerp(ECLIPSE_SKY, ec * 0.7);
      this.ambient.intensity *= 1 - 0.2 * ec;
      s.fog.lerp(ECLIPSE_SKY, ec * 0.75);
      s.exposure *= 1 - 0.1 * ec;
      s.night = Math.max(s.night, ec * 0.75);
      s.day = 1 - s.night;
      s.shafts *= 1 - ec;
      s.golden *= 1 - ec;
    }

    // Lightning: everything lights up cold and blue-white for an instant (most of all in the dark).
    const fl = this.flash * (0.55 + 0.45 * night);
    if (fl > 0.001) {
      const fc = Math.min(1, fl);
      this.ambient.intensity += fl * 1.0;
      this.hemi.color.lerp(FLASH_LIGHT, fc * 0.65);
      this.hemi.intensity += fl * 1.2;
      s.fog.lerp(FLASH_SKY, fc * 0.5);
      s.exposure *= 1 + fl * 0.18;
    }

    // Fit the shadow camera round the view. Its size moves in steps (not with every bit of zoom),
    // and its centre is snapped to whole shadow-map texels in the sun's own view (not along the
    // ground, which the slanting sun doesn't line up with), so shadow edges stay still instead of
    // crawling and flickering as the camera pans and zooms.
    const want = clamp(viewRadius, 12, 150);
    const r = 12 * Math.pow(1.25, Math.ceil(Math.log(want / 12) / Math.log(1.25) - 1e-6));
    const sc = this.sun.shadow.camera;
    if (sc.right !== r) {
      sc.left = -r;
      sc.right = r;
      sc.top = r;
      sc.bottom = -r;
      sc.updateProjectionMatrix();
    }
    const texel = (2 * r) / this.sun.shadow.mapSize.x;
    const dir = _dir.copy(s.sunDir).normalize();
    const right = _right.crossVectors(UP, dir);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = _up.crossVectors(dir, right).normalize();
    const u = Math.round(target.dot(right) / texel) * texel, v = Math.round(target.dot(up) / texel) * texel, w = target.dot(dir);
    const snapped = _snap.copy(right).multiplyScalar(u).addScaledVector(up, v).addScaledVector(dir, w);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(dir, 160);
    this.sun.target.updateMatrixWorld();
  }
}
