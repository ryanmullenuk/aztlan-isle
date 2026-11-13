/**
 * The Aztec kit: the carved pieces every framed plate shares (pop-ups now, menus and cards later).
 * A plate (`az-plate`) wears a laid-sandstone frame with a gold bevel (CSS, src/ui/art/frame-stone.svg);
 * these are the parts that stand proud of it: a fret block on each top corner and a stepped foot
 * hanging from the middle of the bottom edge, plus the palm leaves that wreathe a crest.
 */

const STONE = '#c99b5b', EDGE = '#4a3014', CARVE = '#6b4519', LIGHT = '#f3dcaa';

/** A carved block for a top corner (the right one is the same, mirrored by CSS). */
const CORNER = `<svg viewBox="0 0 60 36" aria-hidden="true">
  <path d="M2 35V9H8V3H52V9H58V35Z" fill="${STONE}" stroke="${EDGE}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M4 33V11H10V5H50" fill="none" stroke="${LIGHT}" stroke-width="1.4"/>
  <path d="M20 29V11H40V26H25V16H35V21H30" fill="none" stroke="${LIGHT}" stroke-width="1.2" transform="translate(1 1)"/>
  <path d="M20 29V11H40V26H25V16H35V21H30" fill="none" stroke="${CARVE}" stroke-width="3"/>
</svg>`;

/** The stepped foot under the bottom edge, with a small fret of its own. */
const FOOT = `<svg viewBox="0 0 120 26" aria-hidden="true">
  <path d="M1 1H119L111 10H99L91 24H29L21 10H9Z" fill="${STONE}" stroke="${EDGE}" stroke-width="2" stroke-linejoin="round"/>
  <path d="M24 9H96" stroke="${CARVE}" stroke-width="1.6"/>
  <rect x="47" y="11" width="26" height="10" rx="1" fill="none" stroke="${CARVE}" stroke-width="2.2"/>
  <path d="M52 18V14H68V18H57" fill="none" stroke="${CARVE}" stroke-width="2"/>
</svg>`;

/** The carved parts of a plate, placed by CSS round its frame. */
export const AZ_CORNERS = `<i class="az-corner l" aria-hidden="true">${CORNER}</i><i class="az-corner r" aria-hidden="true">${CORNER}</i><i class="az-foot" aria-hidden="true">${FOOT}</i>`;

/** One palm leaf pointing along +x from the origin, with its midrib. */
const leaf = (rot: number, len: number) => `<g transform="rotate(${rot}) scale(${len} ${0.9 + len * 0.1})">
  <path d="M0 0C12-9 34-10 48 0C34 10 12 9 0 0Z" fill="url(#az-leaf)" stroke="#1f4a14" stroke-width="1.2"/>
  <path d="M3 0H44" stroke="#2f6a1b" stroke-width="1.1"/>
  <path d="M14-1L20-6M24-1L31-6M14 1L20 6M24 1L31 6" stroke="#2f6a1b" stroke-width="0.8"/>
</g>`;
const FAN = [leaf(146, 0.78), leaf(166, 1), leaf(186, 1.06), leaf(206, 0.9), leaf(226, 0.7)].join('');

/** Palm leaves fanning out to both sides behind a crest. */
export const AZ_LEAVES = `<svg class="az-leaves" viewBox="0 0 170 72" aria-hidden="true">
  <defs><linearGradient id="az-leaf" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2c6a1a"/><stop offset="0.6" stop-color="#5fa532"/><stop offset="1" stop-color="#8fca4c"/></linearGradient></defs>
  <g transform="translate(74 40)">${FAN}</g>
  <g transform="translate(96 40) scale(-1 1)">${FAN}</g>
</svg>`;
