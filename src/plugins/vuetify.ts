import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import { createVuetify } from 'vuetify'

// A restrained, professional palette rather than Vuetify's stock defaults — muted indigo
// primary, a subdued brass/gold secondary, and a dark-neutral surface (not pure black) for
// a dim-booth environment (spec section 16). This is a real, permanent preset theme, not a
// placeholder waiting for church-branding colors — the plan going forward is a small set of
// well-designed built-in theme options (light + dark) rather than deriving the operator UI's
// palette from church branding; logo-based branding may still happen separately, lower
// priority. A few extra named colors (teal/violet/rose/amber/slate/terracotta) round out the
// palette so content can be color-coded by category (song block type, service item type)
// without introducing anything loud — see src/utils/contentColors.ts.
// Same accent hues in both themes (they're used as solid button fills with
// auto-computed contrast text, so they read fine on either background) — only
// background/surface actually flip between dark and light.
const accentColors = {
  primary: '#5B7CDB',
  secondary: '#B08D3F',
  error: '#C1554A',
  success: '#4E9E75',
  warning: '#C79A3D',
  info: '#5B7CDB',
  teal: '#4FAFA0',
  violet: '#8B6FC9',
  rose: '#D0708A',
  amber: '#D0A23A',
  slate: '#7A8699',
  terracotta: '#D08B5B',
}

export default createVuetify({
  theme: {
    defaultTheme: 'worshipDark',
    themes: {
      worshipDark: {
        dark: true,
        colors: {
          background: '#15171c',
          surface: '#1b1e24',
          'surface-variant': '#262a32',
          ...accentColors,
        },
      },
      // Settings → General's dark-mode toggle (spec section 17/M7) switches to this.
      // Newer than the dark theme and tuned less exhaustively — most screens use the
      // theme's own color tokens so they adapt automatically, but a handful of custom
      // rgba(var(--v-theme-...), alpha) tints (e.g. song/slide block "editable field"
      // styling) were visually tuned against the dark background and may want a second
      // look here later.
      worshipLight: {
        dark: false,
        colors: {
          background: '#f4f5f7',
          surface: '#ffffff',
          'surface-variant': '#e7e9ed',
          ...accentColors,
        },
      },
    },
  },
})
