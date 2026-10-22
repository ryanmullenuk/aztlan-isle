/**
 * Pressing Play: the screen fills with cloud, which then parts (left and right, drifting past the
 * camera) to reveal the island as the arrival begins. Plain DOM puffs moved by transform and
 * opacity only, so it is cheap on phones; removed entirely when it ends.
 */
const PART_MS = 2800;
const HOLD_MS = 280;

interface Puff { el: HTMLElement; side: number; lift: number; }

export function cloudReveal(): void {
  const root = document.createElement('div');
  root.className = 'cloud-reveal';
  root.setAttribute('aria-hidden', 'true');
  // Solid cloud behind the puffs, so nothing shows until they start to part.
  const veil = document.createElement('div');
  veil.className = 'cloud-veil';
  root.append(veil);
  const puffs: Puff[] = [];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced) {
    // A loose grid of big overlapping puffs, a little jittered, so the cover has no gaps.
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 6; col++) {
        const el = document.createElement('i');
        const x = (col + 0.5) / 6 + (Math.random() - 0.5) * 0.1;
        const y = (row + 0.5) / 5 + (Math.random() - 0.5) * 0.12;
        const size = 48 + Math.random() * 28;
        el.style.left = `${x * 100}%`;
        el.style.top = `${y * 100}%`;
        el.style.width = el.style.height = `${size}vmax`;
        root.append(el);
        // Clouds left of the middle drift left, the rest right; a few rise or sink as they go.
        puffs.push({ el, side: x < 0.5 ? -1 : 1, lift: (y - 0.5) * 0.6 + (Math.random() - 0.5) * 0.3 });
      }
    }
  }
  document.body.append(root);

  const done = () => root.remove();
  if (reduced) {
    veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, delay: HOLD_MS, fill: 'forwards' }).finished.then(done, done);
    return;
  }
  // The veil thins as the first gaps open; the puffs sweep out, growing as they pass the camera.
  veil.animate([{ opacity: 1 }, { opacity: 1, offset: 0.08 }, { opacity: 0, offset: 0.3 }, { opacity: 0 }], { duration: PART_MS, delay: HOLD_MS, fill: 'forwards' });
  let last: Animation | null = null;
  for (const p of puffs) {
    const centre = Math.abs(parseFloat(p.el.style.left) - 50) / 50;
    // The middle opens first, so the island appears from the centre outward.
    const delay = HOLD_MS + centre * 180 * Math.random();
    const dx = p.side * (70 + Math.random() * 35), dy = p.lift * 30;
    // In vmax like the puffs themselves, so on a narrow phone they still travel clear of the screen.
    const at = (f: number, scale: number) => `translate(calc(-50% + ${dx * f}vmax), calc(-50% + ${dy * f}vmax)) scale(${scale})`;
    // A slow start as the cover splits down the middle, then sweeping out past the camera.
    const a = p.el.animate([
      { transform: at(0, 1), opacity: 1 },
      { transform: at(0.14, 1.05), opacity: 1, offset: 0.25 },
      { transform: at(0.75, 1.3), opacity: 1, offset: 0.7 },
      { transform: at(1, 1.45), opacity: 0 },
    ], { duration: PART_MS - 200 + Math.random() * 300, delay, easing: 'ease-in-out', fill: 'forwards' });
    if (!last || (a.effect?.getComputedTiming().endTime ?? 0) > (last.effect?.getComputedTiming().endTime ?? 0)) last = a;
  }
  last?.finished.then(done, done);
  // Never leave it over the game if an animation is cancelled or the tab is hidden.
  window.setTimeout(done, PART_MS + HOLD_MS + 6000);
}
