import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages (/aztec/), Netlify, Vercel or any sub-path.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // three.js in its own file: it rarely changes, so browsers keep it cached across game updates.
        manualChunks: (id: string) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
  server: { host: true },
});
