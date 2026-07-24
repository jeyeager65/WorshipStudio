import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

export default defineConfig({
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
