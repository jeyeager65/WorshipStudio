import { beforeEach, describe, expect, it } from 'vitest'
import type { SlideLibraryItem } from '@/models/library'
import { createWebSettingsPort } from '../settings'
import { createWebSlidesPort } from '../slides'
import { createFakeRoot } from './fakeFsa'

beforeEach(() => {
  localStorage.clear()
})

function sampleSlide(): SlideLibraryItem {
  return {
    id: 'slide-1',
    label: 'Welcome',
    tags: [],
    documentVersion: 2,
    slides: [],
    usage: { usesPastYear: 0 },
    updatedAt: '',
    updatedByDevice: '',
  }
}

describe('createWebSlidesPort', () => {
  it('saves to slides/<id>.json and round-trips through list/get', async () => {
    const root = createFakeRoot()
    const port = createWebSlidesPort(root, createWebSettingsPort(root))
    await port.save(sampleSlide())

    expect((await port.get('slide-1'))?.label).toBe('Welcome')
    expect((await port.list()).map((s) => s.id)).toEqual(['slide-1'])

    await port.delete('slide-1')
    expect(await port.get('slide-1')).toBeUndefined()
  })

  it('generates a real, distinct QR code data URL per input', async () => {
    const root = createFakeRoot()
    const port = createWebSlidesPort(root, createWebSettingsPort(root))

    const a = await port.generateQrCode('https://example.com/a')
    const b = await port.generateQrCode('https://example.com/b')

    expect(a).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(b).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(a).not.toBe(b)

    const svg = atob(a.replace('data:image/svg+xml;base64,', ''))
    expect(svg).toContain('<svg')
  })
})
