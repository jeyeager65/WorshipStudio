import type { TextEffect, Theme } from '@/models/library'

export const DEFAULT_PRESENTATION_TEXT_EFFECT: TextEffect = {
  type: 'outline',
  color: '#000000',
  size: 4,
  offsetX: 6,
  offsetY: 6,
}

/** Converts the legacy outline switch into the richer effect model without changing its look. */
export function presentationTextEffect(theme: Pick<Theme, 'outline' | 'textEffect'>): TextEffect {
  return theme.textEffect
    ? { ...DEFAULT_PRESENTATION_TEXT_EFFECT, ...theme.textEffect }
    : {
        ...DEFAULT_PRESENTATION_TEXT_EFFECT,
        type: theme.outline ? 'outline' : 'none',
      }
}

export function presentationTextShadow(effect: TextEffect | undefined): string {
  if (!effect || effect.type === 'none') return 'none'
  const size = `${effect.size}px`
  if (effect.type === 'outline') {
    return `0 0 ${size} ${effect.color}, 0 1px ${effect.size + 1}px ${effect.color}`
  }
  if (effect.type === 'glow') {
    return `0 0 ${effect.size * 2}px ${effect.color}, 0 0 ${effect.size * 3}px ${effect.color}`
  }
  return `${effect.offsetX ?? 6}px ${effect.offsetY ?? 6}px ${size} ${effect.color}`
}
