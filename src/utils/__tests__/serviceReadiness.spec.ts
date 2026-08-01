import { describe, expect, it } from 'vitest'
import { evaluateServiceReadiness, type ServiceReadinessContext } from '@/utils/serviceReadiness'
import type { Service } from '@/models/service'
import type { Song } from '@/models/song'

const song: Song = {
  id: 'song-1',
  title: 'Amazing Grace',
  collections: [],
  tags: [],
  blocks: [{ id: 'v1', label: 'Verse 1', text: 'Amazing grace' }],
  defaultArrangement: { sequence: ['v1'] },
  usage: { usesPastYear: 0 },
  updatedAt: '',
  updatedByDevice: '',
}

function service(overrides: Partial<Service> = {}): Service {
  return {
    id: 'service-1',
    date: '2026-08-02',
    type: 'Sunday Worship',
    items: [{ id: 'item-1', type: 'song', songId: song.id, arrangement: { sequence: ['v1'] } }],
    assignments: [],
    updatedAt: '',
    updatedByDevice: '',
    ...overrides,
  }
}

function context(overrides: Partial<ServiceReadinessContext> = {}): ServiceReadinessContext {
  return {
    songs: new Map([[song.id, song]]),
    slides: new Map(),
    media: new Map(),
    themes: [],
    people: new Map(),
    externalApps: new Map(),
    resolvedScriptureKeys: new Set(),
    scriptureErrorKeys: new Set(),
    resolvedMediaIds: new Set(),
    mediaErrorIds: new Set(),
    mediaAvailabilityChecked: true,
    verifiedExternalAppItemIds: new Set(),
    externalAppErrors: new Map(),
    externalAppVerificationAvailable: false,
    libraryConflictLabels: new Map(),
    audienceDisplayAvailable: true,
    now: new Date('2026-08-01T12:00:00'),
    ...overrides,
  }
}

describe('evaluateServiceReadiness', () => {
  it('reports a complete service as ready', () => {
    const result = evaluateServiceReadiness(service(), context())
    expect(result.ready).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('finds presentation-blocking placeholders, unresolved content, and display setup', () => {
    const result = evaluateServiceReadiness(
      service({
        items: [
          { id: 'placeholder', type: 'placeholder', label: 'Opening Song' },
          {
            id: 'scripture',
            type: 'scripture',
            reference: 'John 3:16',
            translation: 'ESV',
            displayMode: 'full',
          },
          { id: 'countdown', type: 'countdown', targetTime: 'not-a-date' },
        ],
      }),
      context({
        audienceDisplayAvailable: false,
        scriptureErrorKeys: new Set(['scripture']),
      }),
    )

    expect(result.blockers.map((issue) => issue.title)).toEqual(
      expect.arrayContaining([
        'No audience display is ready',
        'Opening Song still needs content',
        'John 3:16 could not be resolved',
        'Countdown has an invalid target',
      ]),
    )
    expect(result.ready).toBe(false)
  })

  it('distinguishes roster warnings from a missing person blocker', () => {
    const result = evaluateServiceReadiness(
      service({
        assignments: [
          { role: 'Piano', tentative: false },
          { role: 'Vocals', personId: 'person-1', tentative: false },
          { role: 'Nursery', personId: 'person-1', tentative: false },
          { role: 'Reader', personId: 'missing', tentative: false },
        ],
      }),
      context({
        people: new Map([
          [
            'person-1',
            {
              id: 'person-1',
              firstName: 'Jordan',
              lastName: 'Lee',
              preferredRoles: [],
              unavailableDateRanges: [{ start: '2026-08-02', end: '2026-08-02' }],
              updatedAt: '',
              updatedByDevice: '',
            },
          ],
        ]),
      }),
    )

    expect(result.blockers.some((issue) => issue.title.includes('missing person'))).toBe(true)
    expect(result.warnings.map((issue) => issue.title)).toEqual(
      expect.arrayContaining([
        'Piano is unassigned',
        'Jordan Lee is marked unavailable',
        'Jordan Lee has multiple roles',
      ]),
    )
  })

  it('checks referenced song blocks and local media availability', () => {
    const result = evaluateServiceReadiness(
      service({
        items: [
          {
            id: 'song-item',
            type: 'song',
            songId: song.id,
            arrangement: { sequence: ['deleted-block'] },
          },
          { id: 'media-item', type: 'media', mediaId: 'media-1', fit: 'cover' },
        ],
      }),
      context({
        media: new Map([
          [
            'media-1',
            {
              id: 'media-1',
              filename: 'background.jpg',
              title: 'Background',
              kind: 'image',
              tags: [],
              location: 'local',
              contentHash: 'hash',
              usage: { usesPastYear: 0 },
              updatedAt: '',
              updatedByDevice: '',
            },
          ],
        ]),
        mediaErrorIds: new Set(['media-1']),
      }),
    )

    expect(result.blockers.map((issue) => issue.title)).toEqual(
      expect.arrayContaining([
        'Amazing Grace has missing song sections',
        'Background is unavailable',
      ]),
    )
  })

  it('waits for passive external-application verification when the backend supports it', () => {
    const externalService = service({
      items: [
        {
          id: 'external-item',
          type: 'external-app',
          profileId: 'powerpoint',
          file: 'C:\\Services\\Sunday.pptx',
        },
      ],
    })
    const externalApps = new Map([
      [
        'powerpoint',
        {
          id: 'powerpoint',
          name: 'PowerPoint',
          launchMode: 'launch-automatically' as const,
          executablePath: 'C:\\Program Files\\PowerPoint.exe',
          parameterFormat: '{file}',
          remoteControlsEnabled: false,
          updatedAt: '',
          updatedByDevice: '',
        },
      ],
    ])

    const pending = evaluateServiceReadiness(
      externalService,
      context({ externalApps, externalAppVerificationAvailable: true }),
    )
    expect(pending.blockers[0]?.title).toBe('PowerPoint is still being checked')

    const verified = evaluateServiceReadiness(
      externalService,
      context({
        externalApps,
        externalAppVerificationAvailable: true,
        verifiedExternalAppItemIds: new Set(['external-item']),
      }),
    )
    expect(verified.ready).toBe(true)
  })

  it('reports only synced conflicts that affect the current service', () => {
    const result = evaluateServiceReadiness(
      service(),
      context({
        libraryConflictLabels: new Map([
          ['song:song-1', 'Amazing Grace'],
          ['song:unrelated', 'Another Song'],
        ]),
      }),
    )

    expect(result.ready).toBe(true)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatchObject({
      title: 'Amazing Grace has another synced version',
      action: 'library-health',
    })
  })
})
