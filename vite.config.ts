import { defineConfig } from 'vite';

// Relative base so the build works both at the domain root and under a
// sub-path such as GitHub Pages (https://<user>.github.io/<repo>/).
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 800 },
});
