import { worshipDarkColors, worshipDarkVariables } from '@/plugins/themeTokens'

// The remote page is used in a dim booth/sanctuary environment same as the main app (see
// themeTokens.ts's own doc comment) and has no settings surface of its own to host a light/dark
// toggle — dark-only, matching the main app's default rather than adding a preference this
// bundle has nowhere to put.
export function applyTheme(): void {
  const root = document.documentElement.style
  for (const [key, value] of Object.entries(worshipDarkColors)) {
    root.setProperty(`--ws-${key}`, value)
  }
  root.setProperty('--ws-border-color', worshipDarkVariables['border-color'])
  root.setProperty('--ws-border-opacity', String(worshipDarkVariables['border-opacity']))
  root.setProperty(
    '--ws-text',
    `rgba(255, 255, 255, ${worshipDarkVariables['high-emphasis-opacity']})`,
  )
  root.setProperty(
    '--ws-text-secondary',
    `rgba(255, 255, 255, ${worshipDarkVariables['medium-emphasis-opacity']})`,
  )
}
