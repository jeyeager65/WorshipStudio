import { beforeEach, describe, expect, it } from 'vitest'
import { createMockAdapter } from '@/adapters/mock'
import { stockBackgrounds, stockThemes } from '@/data/stockContent'
import { getLastUsedDate, getUsesInPastYear } from '@/utils/songUsage'

beforeEach(() => {
  localStorage.clear()
})

describe('mock adapter', () => {
  it('lists seeded songs', async () => {
    const adapter = createMockAdapter()
    const songs = await adapter.songs.list()
    expect(songs.length).toBeGreaterThan(0)
    expect(songs[0].title).toBe('Amazing Grace')
  })

  it('importStockBackgrounds adds every stock image and theme with a real resolvable preview', async () => {
    const adapter = createMockAdapter()
    const summary = await adapter.media.importStockBackgrounds()
    expect(summary).toEqual({
      mediaAdded: stockBackgrounds.length,
      themesAdded: stockThemes.length,
    })

    const media = await adapter.media.list()
    for (const background of stockBackgrounds) {
      const item = media.find((candidate) => candidate.id === background.id)
      expect(item, background.id).toBeDefined()
      expect(item?.tags).toEqual(['Background', 'Stock'])
      expect(item?.location).toBe('synced')
      await expect(adapter.media.getPreviewUrl(background.id)).resolves.toBe(
        `${import.meta.env.BASE_URL}stock-backgrounds/${background.filename}`,
      )
    }

    const themes = await adapter.themes.list()
    for (const stockTheme of stockThemes) {
      const theme = themes.find((candidate) => candidate.id === stockTheme.id)
      expect(theme, stockTheme.id).toBeDefined()
      expect(theme?.backgroundId).toBe(stockTheme.backgroundMediaId)
      expect(theme?.useAsDefaultFor).toEqual(stockTheme.intendedDefaults)
    }
  })

  it('importStockBackgrounds previews survive a fresh adapter instance (simulating a page reload)', async () => {
    const first = createMockAdapter()
    await first.media.importStockBackgrounds()

    // A real reload discards all in-memory state (blob: URLs included) and re-runs
    // createMockAdapter() from scratch — MockCollection's localStorage-backed persistence is
    // the only thing that survives, so this is the fresh-instance equivalent of a reload.
    const reloaded = createMockAdapter()
    for (const background of stockBackgrounds) {
      await expect(reloaded.media.getPreviewUrl(background.id)).resolves.toBe(
        `${import.meta.env.BASE_URL}stock-backgrounds/${background.filename}`,
      )
    }
  })

  it('getPreviewUrl stops resolving a stock background once it has been deleted', async () => {
    const adapter = createMockAdapter()
    await adapter.media.importStockBackgrounds()
    const [first] = stockBackgrounds
    await adapter.media.delete(first!.id)
    await expect(adapter.media.getPreviewUrl(first!.id)).resolves.toBeUndefined()
  })

  it('importStockBackgrounds is idempotent — a second call adds nothing more', async () => {
    const adapter = createMockAdapter()
    await adapter.media.importStockBackgrounds()
    const mediaCountAfterFirst = (await adapter.media.list()).length
    const themeCountAfterFirst = (await adapter.themes.list()).length

    const second = await adapter.media.importStockBackgrounds()

    expect(second).toEqual({ mediaAdded: 0, themesAdded: 0 })
    expect((await adapter.media.list()).length).toBe(mediaCountAfterFirst)
    expect((await adapter.themes.list()).length).toBe(themeCountAfterFirst)
  })

  it('importStockBackgrounds never claims a content type an existing theme already defaults for', async () => {
    const adapter = createMockAdapter()
    await adapter.themes.save({
      id: 'theme-church-own',
      name: 'Church Theme',
      font: 'Inter',
      textColor: '#FFFFFF',
      outline: false,
      appliesTo: [],
      useAsDefaultFor: ['songs'],
      updatedAt: '',
      updatedByDevice: '',
    })

    await adapter.media.importStockBackgrounds()

    const goldenCross = (await adapter.themes.list()).find(
      (theme) => theme.id === 'theme-stock-golden-cross',
    )
    expect(goldenCross?.useAsDefaultFor).toEqual(['scripture', 'sermon'])
  })

  it('saves and retrieves a new song', async () => {
    const adapter = createMockAdapter()
    await adapter.songs.save({
      id: 'song-test',
      title: 'Test Song',
      collections: [],
      tags: [],
      blocks: [],
      defaultArrangement: { sequence: [] },
      usageDates: [],
      updatedAt: '',
      updatedByDevice: '',
    })
    const found = await adapter.songs.get('song-test')
    expect(found?.title).toBe('Test Song')
  })

  it('resolves a scripture reference without a network call', async () => {
    const adapter = createMockAdapter()
    const passage = await adapter.scripture.resolve('John 3:16', 'ESV')
    expect(passage.reference).toBe('John 3:16')
    expect(passage.verses.length).toBeGreaterThan(0)
  })

  it('resolves a multi-verse range with verses in order', async () => {
    const adapter = createMockAdapter()
    const passage = await adapter.scripture.resolve('John 3:16-17', 'KJV')
    expect(passage.verses.map((v) => v.number)).toEqual([16, 17])
  })

  it('rejects a structurally invalid reference', async () => {
    const adapter = createMockAdapter()
    await expect(adapter.scripture.resolve('Not A Book 1:1', 'KJV')).rejects.toThrow()
  })

  it('resolves any valid reference across the whole Bible, not just a handful of samples', async () => {
    const adapter = createMockAdapter()
    await expect(adapter.scripture.resolve('Genesis 1:1', 'KJV')).resolves.not.toThrow()
    await expect(adapter.scripture.resolve('Revelation 22:21', 'KJV')).resolves.not.toThrow()
  })

  it("saving a service updates its songs' usage to the service's own date, not save time", async () => {
    const adapter = createMockAdapter()
    await adapter.songs.save({
      id: 'song-usage-test',
      title: 'Usage Test Song',
      collections: [],
      tags: [],
      blocks: [],
      defaultArrangement: { sequence: [] },
      usageDates: [],
      updatedAt: '',
      updatedByDevice: '',
    })
    await adapter.services.save({
      id: 'service-usage-test',
      date: '2026-01-15',
      serviceTypeId: 'type-sunday-morning-worship',
      items: [
        { id: 'item-1', type: 'song', songId: 'song-usage-test', arrangement: { sequence: [] } },
      ],
      updatedAt: '',
      updatedByDevice: '',
    })

    const song = await adapter.songs.get('song-usage-test')
    expect(song?.usageDates).toEqual([
      { serviceId: 'service-usage-test', date: '2026-01-15' },
    ])
  })

  it('incrementally updates usage instead of recomputing, so deleting the referencing service clears it again', async () => {
    const adapter = createMockAdapter()
    await adapter.songs.save({
      id: 'song-usage-test-2',
      title: 'Usage Test Song 2',
      collections: [],
      tags: [],
      blocks: [],
      defaultArrangement: { sequence: [] },
      usageDates: [],
      updatedAt: '',
      updatedByDevice: '',
    })
    await adapter.services.save({
      id: 'service-usage-test-2',
      date: '2026-01-15',
      serviceTypeId: 'type-sunday-morning-worship',
      items: [
        { id: 'item-1', type: 'song', songId: 'song-usage-test-2', arrangement: { sequence: [] } },
      ],
      updatedAt: '',
      updatedByDevice: '',
    })
    await adapter.services.delete('service-usage-test-2')

    const song = await adapter.songs.get('song-usage-test-2')
    expect(song?.usageDates).toEqual([])
  })

  it('stores a future-dated service entry without filtering it — the write side is date-agnostic', async () => {
    const adapter = createMockAdapter()
    await adapter.songs.save({
      id: 'song-usage-future',
      title: 'Usage Test Song Future',
      collections: [],
      tags: [],
      blocks: [],
      defaultArrangement: { sequence: [] },
      usageDates: [],
      updatedAt: '',
      updatedByDevice: '',
    })
    const farFuture = new Date()
    farFuture.setFullYear(farFuture.getFullYear() + 1)
    await adapter.services.save({
      id: 'service-usage-future',
      date: farFuture.toISOString().slice(0, 10),
      serviceTypeId: 'type-sunday-morning-worship',
      items: [
        { id: 'item-1', type: 'song', songId: 'song-usage-future', arrangement: { sequence: [] } },
      ],
      updatedAt: '',
      updatedByDevice: '',
    })

    const futureDateStr = farFuture.toISOString().slice(0, 10)
    const song = await adapter.songs.get('song-usage-future')
    // The write side stores the entry regardless of date -- it's up to a reader (see
    // utils/songUsage.ts) to exclude future-dated entries from "last used"/"uses this year".
    expect(song?.usageDates).toEqual([
      { serviceId: 'service-usage-future', date: futureDateStr },
    ])
    const today = new Date().toISOString().slice(0, 10)
    expect(getLastUsedDate(song?.usageDates ?? [], today)).toBeUndefined()
    expect(getUsesInPastYear(song?.usageDates ?? [], today)).toBe(0)
  })

  it('counts the same song used twice in one service only once', async () => {
    const adapter = createMockAdapter()
    await adapter.songs.save({
      id: 'song-usage-twice',
      title: 'Usage Test Song Twice',
      collections: [],
      tags: [],
      blocks: [],
      defaultArrangement: { sequence: [] },
      usageDates: [],
      updatedAt: '',
      updatedByDevice: '',
    })
    await adapter.services.save({
      id: 'service-usage-twice',
      date: '2026-01-15',
      serviceTypeId: 'type-sunday-morning-worship',
      items: [
        { id: 'item-1', type: 'song', songId: 'song-usage-twice', arrangement: { sequence: [] } },
        { id: 'item-2', type: 'song', songId: 'song-usage-twice', arrangement: { sequence: [] } },
      ],
      updatedAt: '',
      updatedByDevice: '',
    })

    const song = await adapter.songs.get('song-usage-twice')
    expect(song?.usageDates).toEqual([
      { serviceId: 'service-usage-twice', date: '2026-01-15' },
    ])
  })
})
