import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { VitePWA } from 'vite-plugin-pwa'
import { version } from './package.json'

export default defineConfig({
  // Only the GitHub Pages static-demo deploy (release.yml) sets VITE_BASE_PATH — the demo is
  // nested at /WorshipStudio/app/ underneath the VitePress help site, which owns the Pages
  // root as the project's landing page (see docs/index.md, docs/.vitepress/config.ts). The
  // Tauri build and local dev leave this unset and get '/', since the app is served from its
  // own window there.
  base: process.env.VITE_BASE_PATH ?? '/',
  // Tauri's own `getVersion()` API (AboutSection.vue/SplashScreen.vue) only resolves inside a
  // real Tauri webview — it rejects in the web/mock builds, which otherwise have no version to
  // show at all. package.json's version (kept in sync with tauri.conf.json/Cargo.toml as part
  // of the release process, see notes/release-process.md) is baked in at build time as a real
  // fallback for those builds instead.
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
    // Tablet (PWA) build only — installs a service worker scoped strictly to the app shell
    // (JS/CSS/HTML/fonts/icons). Deliberately no `runtimeCaching` entries for
    // api.dropboxapi.com/content.dropboxapi.com/graph.microsoft.com/login.microsoftonline.com:
    // the sync engine's own cursor/rev state (adapters/tablet/cloudSync.ts) is the real source
    // of truth for what's synced, not an HTTP cache, and a service worker silently serving a
    // stale cached API response would be actively wrong here, not just unhelpful. `manifest:
    // false` because index.html already links public/manifest.webmanifest directly — this
    // plugin only handles the service worker, not manifest generation.
    //
    // registerType 'prompt', not 'autoUpdate': a new service worker still installs and waits in
    // the background, but never activates/reloads on its own — App.vue's usePwaUpdate composable
    // surfaces a banner instead and only applies it (and reloads) once the operator taps it.
    // 'autoUpdate' would reload the page the instant an update is detected, with no way to know
    // whether that's mid-edit on a service or, worse, mid-presentation on a Sunday.
    VitePWA({
      registerType: 'prompt',
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // The bundled KJV text dataset (~4.4MB) is lazily loaded only once scripture lookup is
        // actually used, same as before this plugin existed — precaching it during SW install
        // would slow down the initial "install this app" experience for no benefit, since it's
        // fetched at runtime (uncached by the SW, same as any other non-precached request) the
        // first time it's genuinely needed either way.
        globIgnores: ['**/kjvFull-*.js'],
      },
    }),
  ],
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
