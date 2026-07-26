import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

export default defineConfig({
  // Only the GitHub Pages static-demo deploy (release.yml) sets VITE_BASE_PATH — a project
  // repo's Pages site is served from /<repo-name>/, not the domain root. The Tauri build and
  // local dev leave this unset and get '/', since the app is served from its own window there.
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [vue(), vuetify({ autoImport: true })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    watch: {
      // Rust build output — concurrent writes here (e.g. under `tauri dev`) can hit
      // Windows file locks (EBUSY) if Vite's watcher is also touching these files.
      ignored: ['**/src-tauri/target/**'],
    },
  },
})
