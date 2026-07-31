import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import { createVuetify } from 'vuetify'

// A restrained, professional palette rather than Vuetify's stock defaults — a blue
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
  primary: '#4C7FE8',
  secondary: '#B08D3F',
  error: '#C1554A',
  success: '#4E9E75',
  warning: '#C79A3D',
  info: '#4C7FE8',
  teal: '#4FAFA0',
  violet: '#8B6FC9',
  rose: '#D0708A',
  amber: '#D0A23A',
  slate: '#7A8699',
  terracotta: '#D08B5B',
}

export default createVuetify({
  // WebView2 (Chromium) keeps its own per-field history of previously typed values and offers
  // them back as a native browser dropdown. Plain `autocomplete="off"` doesn't reliably stop
  // this in Chromium (it's mainly honored for recognized field types) — Vuetify's own
  // 'suppress' value is the real fix: it gives the field a fresh unique `name` on every
  // reload so Chromium's history can never match it to begin with. Set once here for every
  // v-text-field/v-textarea/v-combobox app-wide rather than per field.
  defaults: {
    VBtn: { rounded: 'md' },
    VCard: { rounded: 'lg' },
    VTextField: { autocomplete: 'suppress' },
    VTextarea: { autocomplete: 'suppress' },
    VCombobox: { autocomplete: 'suppress' },
    // Vuetify's own scrim default derives from the theme's "on-surface" color — in a dark
    // theme that's near-white, so the default scrim actually *lightens* the background rather
    // than dimming it (the opposite of the intended effect, and barely visible either way
    // against an already dark, near-black background). Forcing a real black here — the
    // opacity that makes it read as a visible dim, not just a color, comes from the
    // .v-overlay__scrim rule in base.css, since Vuetify hard-codes that opacity in its own
    // compiled CSS regardless of what color this prop sets. VDialog owns its own `scrim` prop
    // (forwarded to its internal overlay), so the default has to target VDialog specifically,
    // not VOverlay — menus/selects use VOverlay directly with their own scrim: false and are
    // unaffected.
    VDialog: { scrim: '#000000' },
  },
  theme: {
    defaultTheme: 'worshipDark',
    themes: {
      worshipDark: {
        dark: true,
        colors: {
          background: '#0F141B',
          surface: '#151B23',
          'surface-variant': '#202833',
          ...accentColors,
        },
        variables: {
          'border-color': '#9BA8BA',
          'border-opacity': 0.12,
          'high-emphasis-opacity': 0.92,
          'medium-emphasis-opacity': 0.65,
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
