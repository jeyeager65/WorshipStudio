import DefaultTheme from 'vitepress/theme'
import { nextTick, onMounted, watch } from 'vue'
import { useRoute } from 'vitepress'
import mediumZoom from 'medium-zoom'
import './custom.css'

// Default theme, plus click-to-zoom on every screenshot in the actual page content (`.main img`
// — deliberately excludes the hero logo, which lives outside `.main`). Re-initialized on every
// client-side route change (VitePress navigates as an SPA, so `onMounted` alone would only ever
// see the very first page's images) — `nextTick` so the new page's <img> elements actually exist
// in the DOM before medium-zoom scans for them.
export default {
  ...DefaultTheme,
  setup() {
    const route = useRoute()
    const zoom = () => mediumZoom('.main img', { background: 'var(--vp-c-bg)' })
    onMounted(zoom)
    watch(
      () => route.path,
      () => nextTick(zoom),
    )
  },
}
