import type { PresentationThemeTarget, Theme } from '@/models/library'
import type { ServiceItem } from '@/models/service'

const PRESENTATION_THEME_TARGETS = new Set<PresentationThemeTarget>([
  'songs',
  'scripture',
  'sermon',
  'text-slides',
])

export function normalizePresentationThemeTarget(
  target: string,
): PresentationThemeTarget | undefined {
  if (target === 'announcements' || target === 'welcome-closing') return 'text-slides'
  return PRESENTATION_THEME_TARGETS.has(target as PresentationThemeTarget)
    ? (target as PresentationThemeTarget)
    : undefined
}

export function presentationThemeTargetForItem(
  item: ServiceItem | undefined,
): PresentationThemeTarget | undefined {
  if (item?.type === 'song') return 'songs'
  if (item?.type === 'scripture') return 'scripture'
  if (item?.type === 'sermon') return 'sermon'
  if (item?.type === 'text-slide') return 'text-slides'
  return undefined
}

export function presentationThemeDefaults(theme: Theme): PresentationThemeTarget[] {
  return [
    ...new Set(
      (theme.useAsDefaultFor as string[])
        .map(normalizePresentationThemeTarget)
        .filter((target): target is PresentationThemeTarget => !!target),
    ),
  ]
}

/** Empty applicability is intentionally the backwards-compatible "generic" value. */
export function presentationThemeAppliesTo(theme: Theme): PresentationThemeTarget[] {
  return [
    ...new Set(
      ((theme.appliesTo ?? []) as string[])
        .map(normalizePresentationThemeTarget)
        .filter((target): target is PresentationThemeTarget => !!target),
    ),
  ]
}

export function isPresentationThemeAvailableFor(
  theme: Theme,
  target: PresentationThemeTarget,
): boolean {
  const appliesTo = presentationThemeAppliesTo(theme)
  return appliesTo.length === 0 || appliesTo.includes(target)
}

export function isPresentationThemeDefaultFor(
  theme: Theme,
  target: PresentationThemeTarget,
): boolean {
  return presentationThemeDefaults(theme).includes(target)
}

/** A valid per-item override wins. A missing/deleted override falls back to the type default. */
export function resolvePresentationTheme(
  item: ServiceItem | undefined,
  target: PresentationThemeTarget | undefined,
  themes: Theme[],
): Theme | undefined {
  if (!target) return undefined
  const override = item?.themeId
    ? themes.find(
        (theme) => theme.id === item.themeId && isPresentationThemeAvailableFor(theme, target),
      )
    : undefined
  return (
    override ??
    themes.find(
      (theme) =>
        isPresentationThemeAvailableFor(theme, target) &&
        isPresentationThemeDefaultFor(theme, target),
    )
  )
}
