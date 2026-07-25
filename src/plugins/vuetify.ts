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
        },
      },
    },
  },
})
