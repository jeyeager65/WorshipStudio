import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import { createVuetify } from 'vuetify'

// A restrained, professional palette rather than Vuetify's stock defaults — muted
// indigo primary, a subdued brass/gold secondary used sparingly for accents (badges,
// highlights), and a dark-neutral surface (not pure black) for a dim-booth environment
// (spec section 16). Real church branding colors get layered in once Settings → Branding
// (section 19) exists; this is the "template theme" in the meantime (section 5).
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
        },
      },
    },
  },
})
