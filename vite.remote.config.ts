import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Builds the standalone Remote Control bundle served by the Rust HTTP server
// (src-tauri/src/remote_server.rs) to paired phones/tablets — a separate, small Vite entry from
// the main app (see src-remote/'s own README-equivalent comment in main.ts) because it doesn't
// need Vuetify's component library/MDI font/the main app's full vue-tsc type-check graph, only a
// handful of specific reused components/utils plus its own bespoke controls.
export default defineConfig({
  root: 'src-remote',
  build: {
    outDir: '../dist-remote',
    emptyOutDir: true,
  },
  plugins: [vue()],
  resolve: {
    alias: [
      // Order matters: the exact '@/adapters' match must come before the general '@' prefix
      // below, so imports of the real adapter barrel (which SlideSceneRenderer.vue/
      // SlideContentRenderer.vue use unmodified) resolve to this bundle's own minimal shim
      // instead — see src-remote/adapters/remoteAdapter.ts for what it actually needs to cover.
      {
        find: '@/adapters',
        replacement: fileURLToPath(new URL('./src-remote/adapters/remoteAdapter.ts', import.meta.url)),
      },
      {
        find: '@',
        replacement: fileURLToPath(new URL('./src', import.meta.url)),
      },
    ],
  },
})
