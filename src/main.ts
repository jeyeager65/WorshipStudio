import { createApp } from 'vue'
import { createPinia } from 'pinia'

import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/montserrat/wght.css'
import '@fontsource-variable/oswald/wght.css'
import '@fontsource-variable/roboto-slab/wght.css'
import '@fontsource-variable/source-sans-3/wght.css'
import '@fontsource-variable/source-serif-4/wght.css'

import './assets/base.css'
import BootGate from './BootGate.vue'
import WebAudienceView from './views/WebAudienceView.vue'
import router from './router'
import vuetify from './plugins/vuetify'

// The web build's audience window (see src/adapters/web/live.ts) opens this same page with
// ?presentation=1 and expects only the current slide, full-bleed — same reasoning as the Tauri
// desktop build's separate "presentation" WebviewWindow (App.vue), just detected via a query
// param instead of a native window label since a browser window has no such concept. Mounted
// directly here rather than through BootGate: this window never needs its own adapter, only the
// BroadcastChannel content stream WebAudienceView.vue listens on, so it skips BootGate's
// Tauri/demo/folder-picker resolution entirely — and skips Pinia/Vuetify too, matching
// PresentationView.vue's identical "no app-bar, no store, just the slide" footprint.
const isAudienceWindow =
  typeof window !== 'undefined' &&
  !window.__TAURI_INTERNALS__ &&
  new URLSearchParams(window.location.search).has('presentation')

if (isAudienceWindow) {
  createApp(WebAudienceView).mount('#app')
} else {
  const app = createApp(BootGate)
  app.use(createPinia())
  app.use(router)
  app.use(vuetify)
  app.mount('#app')
}
