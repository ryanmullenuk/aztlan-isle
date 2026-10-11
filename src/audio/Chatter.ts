import type { Islander } from '../entities/Islander';

export interface ChatterCamera { x: number; y: number; z: number; rightX: number; rightZ: number }
const sociable = new Set(['idle', 'walk', 'carry', 'wave', 'sit', 'dance', 'eat']);
export function canChatter(i: Islander): boolean {
  return !i.hidden && !i.sleeping && i.condition === 'well' && sociable.has(i.anim) &&
    !['flee', 'capture', 'heal', 'patrol', 'train'].includes(i.task?.kind ?? '');
}
/** Actual camera distance also works in eye-level free roam, unlike the overhead zoom setting. */
export function chatterGain(i: Islander, camera: ChatterCamera): number {
  if (!canChatter(i)) return 0;
  const d = Math.hypot(i.x - camera.x, i.y + 0.7 - camera.y, i.z - camera.z);
  const fade = Math.max(0, Math.min(1, (28 - d) / 22));
  return fade * fade * 0.24;
}
export function chatterPan(i: Islander, camera: ChatterCamera): number {
  const dx = i.x - camera.x, dz = i.z - camera.z;
  return Math.max(-0.8, Math.min(0.8, (dx * camera.rightX + dz * camera.rightZ) / Math.max(3, Math.hypot(dx, dz))));
}
/** Original nonsense syllables: glottal pitch, changing vowel formants and short breath consonants. */
export function chatterPhrase(i: Islander, random = Math.random) {
  const vowels = [[700, 1100, 2500], [300, 2200, 3000], [450, 800, 2400], [550, 1800, 2700], [350, 650, 2300]];
  const base = (i.child ? 250 : i.gender === 'f' ? 185 : 115) + (i.id * 17 % 45);
  const count = 4 + Math.floor(random() * 4), question = random() < 0.35;
  let time = 0;
  return Array.from({ length: count }, (_, k) => {
    const duration = 0.1 + random() * 0.12;
    const pitch = base * (0.85 + random() * 0.3);
    const vowel = vowels[Math.floor(random() * vowels.length)];
    const syllable = { time, duration, pitch, endPitch: pitch * (k === count - 1 ? question ? 1.25 : 0.75 : 0.92 + random() * 0.16), vowel, breath: random() < 0.5 };
    time += duration + 0.025 + random() * 0.045 + (k === 2 ? 0.12 : 0);
    return syllable;
  });
}
