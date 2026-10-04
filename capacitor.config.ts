import type { CapacitorConfig } from '@capacitor/cli';

/** The iOS app: the built game (dist/) bundled inside a native shell, played full screen. */
const config: CapacitorConfig = {
  appId: 'games.redhead.aztlanisle',
  appName: 'Aztlan Isle',
  webDir: 'dist',
  ios: {
    // Edge to edge: the game draws under the notch and home indicator itself (it reads the safe areas).
    contentInset: 'never',
    backgroundColor: '#000000',
    scrollEnabled: false,
    allowsLinkPreview: false,
  },
  plugins: {
    // No status bar or home indicator over the game.
    SystemBars: { hidden: true, animation: 'NONE' },
  },
};

export default config;
