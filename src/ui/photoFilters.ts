/**
 * Photo Mode's colour filters. Each is a short list of standard CSS filter steps (so the live
 * preview is just a CSS `filter` on the game canvas, drawn by the GPU) plus an optional soft-light
 * tint laid over the picture. The same steps are worked out here as one colour matrix for the
 * saved image, so the photo matches what was on screen. No DOM in this file.
 */

export type FilterStep = ['sepia' | 'saturate' | 'contrast' | 'brightness', number];

export interface PhotoFilter {
  id: string;
  label: string;
  steps: FilterStep[];
  /** A colour laid over the picture with the soft-light blend, at this opacity. */
  tint?: { color: string; alpha: number };
}

export const PHOTO_FILTERS: PhotoFilter[] = [
  { id: 'none', label: 'None', steps: [] },
  { id: 'warm', label: 'Warm film', steps: [['sepia', 0.22], ['saturate', 1.2], ['contrast', 1.05]], tint: { color: '#ffb265', alpha: 0.22 } },
  { id: 'cool', label: 'Cool dawn', steps: [['saturate', 0.92], ['contrast', 1.04], ['brightness', 1.03]], tint: { color: '#6fa8ff', alpha: 0.3 } },
  { id: 'vivid', label: 'Vivid', steps: [['saturate', 1.45], ['contrast', 1.12]] },
  { id: 'sepia', label: 'Sepia', steps: [['sepia', 0.85], ['contrast', 1.05], ['brightness', 1.02]] },
  { id: 'noir', label: 'Noir', steps: [['saturate', 0], ['contrast', 1.3], ['brightness', 0.96]] },
];

/** The value at which a step does nothing. */
const NEUTRAL = { sepia: 0, saturate: 1, contrast: 1, brightness: 1 } as const;

/** A step's amount at this strength (0 = no effect, 1 = the filter as designed). */
const amount = ([kind, v]: FilterStep, strength: number): number => NEUTRAL[kind] + (v - NEUTRAL[kind]) * Math.min(1, Math.max(0, strength));

/** The CSS `filter` value for the live preview ('' for no filter). */
export function filterCss(f: PhotoFilter, strength: number): string {
  if (!f.steps.length || strength <= 0) return '';
  return f.steps.map((s) => `${s[0]}(${+amount(s, strength).toFixed(3)})`).join(' ');
}

/** The tint overlay's opacity at this strength (0 with no tint). */
export function tintAlpha(f: PhotoFilter, strength: number): number {
  return f.tint ? f.tint.alpha * Math.min(1, Math.max(0, strength)) : 0;
}

/** A colour matrix: three rows of [r, g, b, offset], colours in 0..1. */
export type ColorMatrix = number[];
const IDENTITY: ColorMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** One CSS filter step as a matrix (the formulas in the CSS Filter Effects specification). */
function stepMatrix(kind: FilterStep[0], a: number): ColorMatrix {
  if (kind === 'sepia') {
    const k = 1 - Math.min(1, Math.max(0, a));
    return [
      0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k, 0,
      0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k, 0,
      0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k, 0,
    ];
  }
  if (kind === 'saturate') {
    return [
      0.213 + 0.787 * a, 0.715 - 0.715 * a, 0.072 - 0.072 * a, 0,
      0.213 - 0.213 * a, 0.715 + 0.285 * a, 0.072 - 0.072 * a, 0,
      0.213 - 0.213 * a, 0.715 - 0.715 * a, 0.072 + 0.928 * a, 0,
    ];
  }
  if (kind === 'contrast') return [a, 0, 0, 0.5 - 0.5 * a, 0, a, 0, 0.5 - 0.5 * a, 0, 0, a, 0.5 - 0.5 * a];
  return [a, 0, 0, 0, 0, a, 0, 0, 0, 0, a, 0];
}

/** b applied after a. */
function compose(a: ColorMatrix, b: ColorMatrix): ColorMatrix {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) {
    const b0 = b[r * 4], b1 = b[r * 4 + 1], b2 = b[r * 4 + 2];
    for (let c = 0; c < 4; c++) out.push(b0 * a[c] + b1 * a[4 + c] + b2 * a[8 + c] + (c === 3 ? b[r * 4 + 3] : 0));
  }
  return out;
}

/** The whole filter at this strength as one matrix (null when it changes nothing). */
export function filterMatrix(f: PhotoFilter, strength: number): ColorMatrix | null {
  if (!f.steps.length || strength <= 0) return null;
  return f.steps.reduce((m, s) => compose(m, stepMatrix(s[0], amount(s, strength))), IDENTITY);
}

/** Apply a colour matrix to RGBA pixels in place (alpha untouched). */
export function applyMatrix(px: Uint8ClampedArray, m: ColorMatrix): void {
  const o0 = m[3] * 255, o1 = m[7] * 255, o2 = m[11] * 255;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    // (A clamped array rounds and clamps each value to 0..255 itself.)
    px[i] = m[0] * r + m[1] * g + m[2] * b + o0;
    px[i + 1] = m[4] * r + m[5] * g + m[6] * b + o1;
    px[i + 2] = m[8] * r + m[9] * g + m[10] * b + o2;
  }
}

/** How dark the vignette's corners are at full strength, and where the darkening begins (0..1 from the centre to a corner). */
export const VIGNETTE = { alpha: 0.85, start: 0.38 };
