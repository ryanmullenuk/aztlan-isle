/** Use the drawable viewport, never the physical display (which can include iOS chrome). */
export function viewportSize(width: number, height: number, visualWidth = width, visualHeight = height): [number, number] {
  return [Math.min(width, visualWidth), Math.min(height, visualHeight)];
}

/**
 * iOS 26 home-screen apps leave a strip one status bar tall (at the top, or sometimes the bottom)
 * outside the page: the app's window fills the screen, but the page is laid out that much short.
 * The game canvas reaches past the page by the strip's height both ways, so the island fills it
 * whichever edge it is at. Zero anywhere else (a browser tab, Android, desktop) or when there's
 * no such strip.
 */
export function stripOverscan(ios: boolean, standalone: boolean, width: number, height: number, screenW: number, screenH: number): number {
  if (!ios || !standalone) return 0;
  // iOS reports the screen in portrait whichever way the phone is held.
  const full = height >= width ? Math.max(screenW, screenH) : Math.min(screenW, screenH);
  const gap = Math.round(full - height);
  return gap > 16 && gap < 100 ? gap : 0;
}
