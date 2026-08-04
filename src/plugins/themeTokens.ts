// Color tokens shared between the real Vuetify theme (vuetify.ts) and the standalone Remote
// Control bundle (src-remote/theme.ts) — extracted so the remote page's colors are the literal
// same source of truth as the main app's, not a hand-matched copy of hex values that can drift.
//
// A restrained, professional palette rather than Vuetify's stock defaults — a blue primary, a
// subdued brass/gold secondary, and a dark-neutral surface (not pure black) for a dim-booth
// environment (spec section 16). Same accent hues in both themes (they're used as solid button
// fills with auto-computed contrast text, so they read fine on either background) — only
// background/surface actually flip between dark and light.
export const accentColors = {
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

export const worshipDarkColors = {
  background: '#0F141B',
  surface: '#151B23',
  'surface-variant': '#202833',
  ...accentColors,
}

export const worshipDarkVariables = {
  'border-color': '#9BA8BA',
  'border-opacity': 0.12,
  'high-emphasis-opacity': 0.92,
  'medium-emphasis-opacity': 0.65,
}

export const worshipLightColors = {
  background: '#f4f5f7',
  surface: '#ffffff',
  'surface-variant': '#e7e9ed',
  ...accentColors,
}
