import { describe, expect, it } from 'vitest'
import type { Theme } from '@/models/library'
import type { ServiceItem } from '@/models/service'
import {
  isPresentationThemeAvailableFor,
  normalizePresentationThemeTarget,
  presentationThemeTargetForItem,
  resolvePresentationTheme,
} from '@/utils/presentationTheme'

function theme(
  id: string,
  defaults: Theme['useAsDefaultFor'] = [],
  appliesTo: Theme['appliesTo'] = [],
): Theme {
  return {
    id,
    name: id,
    font: 'Inter',
    textColor: '#FFFFFF',
    outline: false,
    appliesTo,
    useAsDefaultFor: defaults,
    updatedAt: '',
    updatedByDevice: '',
  }
}

describe('presentation themes', () => {
  it('maps only generated, themeable service item types', () => {
    expect(
      presentationThemeTargetForItem({
        id: 'song',
        type: 'song',
        songId: 's1',
        arrangement: { sequence: [] },
      }),
    ).toBe('songs')
    expect(
      presentationThemeTargetForItem({ id: 'media', type: 'media', mediaId: 'm1', fit: 'cover' }),
    ).toBeUndefined()
  })

  it('prefers an item override over its content-type default', () => {
    const themes = [theme('default', ['songs']), theme('special')]
    const item: ServiceItem = {
      id: 'song',
      type: 'song',
      songId: 's1',
      arrangement: { sequence: [] },
      themeId: 'special',
    }
    expect(resolvePresentationTheme(item, 'songs', themes)?.id).toBe('special')
  })

  it('falls back to the default when an override was deleted', () => {
    const item: ServiceItem = {
      id: 'song',
      type: 'song',
      songId: 's1',
      arrangement: { sequence: [] },
      themeId: 'missing',
    }
    expect(resolvePresentationTheme(item, 'songs', [theme('default', ['songs'])])?.id).toBe(
      'default',
    )
  })

  it('treats themes without applicability metadata as generic', () => {
    const generic = theme('generic')
    expect(isPresentationThemeAvailableFor(generic, 'songs')).toBe(true)
    expect(isPresentationThemeAvailableFor(generic, 'scripture')).toBe(true)
  })

  it('limits associated themes to their selected content types', () => {
    const songTheme = theme('song-theme', [], ['songs'])
    expect(isPresentationThemeAvailableFor(songTheme, 'songs')).toBe(true)
    expect(isPresentationThemeAvailableFor(songTheme, 'scripture')).toBe(false)

    const item: ServiceItem = {
      id: 'scripture',
      type: 'scripture',
      reference: 'John 3:16',
      translation: 'KJV',
      displayMode: 'full',
      themeId: songTheme.id,
    }
    expect(resolvePresentationTheme(item, 'scripture', [songTheme])).toBeUndefined()

    const staleDefault = theme('stale-default', ['scripture'], ['songs'])
    expect(resolvePresentationTheme(undefined, 'scripture', [staleDefault])).toBeUndefined()
  })

  it('normalizes defaults saved by the old unwired editor', () => {
    expect(normalizePresentationThemeTarget('announcements')).toBe('text-slides')
    expect(normalizePresentationThemeTarget('welcome-closing')).toBe('text-slides')
  })
})
