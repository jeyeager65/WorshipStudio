import { createApp } from 'vue'
import App from './App.vue'
import { applyTheme } from './theme'
import './style.css'

// Deliberately minimal — no Vuetify (this bundle has its own small set of bespoke controls, not
// Vuetify's component library), no Pinia (SlideContentRenderer/SlideSceneRenderer are pure
// prop-driven components with no store dependency), no router (a single page, no navigation).
applyTheme()
createApp(App).mount('#app')

// Exists purely for Android's installability requirement (see sw.js's own doc comment) — a
// registration failure shouldn't be user-facing, this control surface works fine without it.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}
