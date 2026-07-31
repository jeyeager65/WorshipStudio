import type { LibrarySettings } from '@/models/settings'
import type { ReportBranding } from './types'

const DEFAULT_PRIMARY = '#4C7FE8'
const DEFAULT_SECONDARY = '#B08D3F'

export function reportBranding(settings?: LibrarySettings): ReportBranding {
  return {
    churchName: settings?.branding.churchName.trim() || 'Worship Studio',
    primaryColor: normalizeColor(settings?.branding.primaryColor, DEFAULT_PRIMARY),
    secondaryColor: normalizeColor(settings?.branding.secondaryColor, DEFAULT_SECONDARY),
  }
}

export function normalizeColor(value: string | undefined, fallback: string): string {
  const candidate = value?.trim()
  if (!candidate) return fallback
  if (/^#[0-9a-f]{6}$/i.test(candidate)) return candidate.toUpperCase()
  if (/^[0-9a-f]{6}$/i.test(candidate)) return `#${candidate.toUpperCase()}`
  return fallback
}

export function withoutHash(color: string): string {
  return color.replace(/^#/, '')
}
