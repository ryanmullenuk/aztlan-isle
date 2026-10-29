/**
 * Small taps of physical feedback on devices that have them. The iPhone and iPad apps pass these
 * to UIKit's feedback generators and the Mac app to its trackpad (both through a `haptic` message
 * handler); browsers that support it (Android) get a short vibration. Safari on the iPhone has no
 * vibration API, so a plain web page simply does nothing: placement and milestones still have
 * their sound and animation.
 */
export type HapticKind = 'light' | 'medium' | 'success';

interface HapticBridge { postMessage(kind: HapticKind): void }

const bridge = (): HapticBridge | undefined =>
  (globalThis as unknown as { webkit?: { messageHandlers?: { haptic?: HapticBridge } } }).webkit?.messageHandlers?.haptic;

/** Shortest gap between two taps, so a burst of events never buzzes continuously. */
const MIN_GAP_MS = 120;
let last = -Infinity;
let enabled = true;

export function setHaptics(on: boolean): void {
  enabled = on;
}

export function haptic(kind: HapticKind): void {
  if (!enabled) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - last < MIN_GAP_MS) return;
  last = now;
  try {
    const native = bridge();
    if (native) {
      native.postMessage(kind);
      return;
    }
    const nav = globalThis.navigator as (Navigator & { vibrate?: (p: number | number[]) => boolean }) | undefined;
    if (typeof nav?.vibrate === 'function') nav.vibrate(kind === 'light' ? 8 : kind === 'medium' ? 16 : [10, 40, 18]);
  } catch {
    /* no haptics here */
  }
}
