import { describe, expect, it } from 'vitest'
import { GENERIC_DOCUMENT_ICON, mediaFileIcon } from '@/utils/mediaFileIcon'
import type { ExternalAppProfile } from '@/adapters/types'

function profile(overrides: Partial<ExternalAppProfile> = {}): ExternalAppProfile {
  return {
    id: 'profile-1',
    name: 'PowerPoint',
    kind: 'presentation',
    launchMode: 'launch-automatically',
    remoteControlsEnabled: false,
    keyCommands: [],
    updatedAt: '',
    updatedByDevice: '',
    ...overrides,
  }
}

describe('mediaFileIcon', () => {
  it('keeps the category glyph for images and videos, whatever the filename', () => {
    expect(mediaFileIcon('slide.pptx', 'image')).toBe('mdi-image-outline')
    expect(mediaFileIcon('clip.pdf', 'video')).toBe('mdi-movie-open-outline')
  })

  it('derives a document icon from its extension', () => {
    expect(mediaFileIcon('Morning Announcements.pptx', 'document')).toBe(
      'mdi-file-powerpoint-outline',
    )
    expect(mediaFileIcon('bulletin.pdf', 'document')).toBe('mdi-file-pdf-box')
    expect(mediaFileIcon('notes.docx', 'document')).toBe('mdi-file-word-outline')
    expect(mediaFileIcon('budget.xlsx', 'document')).toBe('mdi-file-excel-outline')
    expect(mediaFileIcon('intro.mp3', 'document')).toBe('mdi-file-music-outline')
  })

  it('is case-insensitive and handles a name with several dots', () => {
    expect(mediaFileIcon('DECK.PPTX', 'document')).toBe('mdi-file-powerpoint-outline')
    expect(mediaFileIcon('2026.08.25 service.pdf', 'document')).toBe('mdi-file-pdf-box')
  })

  it('falls back for an unknown or absent extension', () => {
    expect(mediaFileIcon('mystery.qqq', 'document')).toBe(GENERIC_DOCUMENT_ICON)
    expect(mediaFileIcon('no-extension', 'document')).toBe(GENERIC_DOCUMENT_ICON)
    expect(mediaFileIcon('trailing.', 'document')).toBe(GENERIC_DOCUMENT_ICON)
    expect(mediaFileIcon(undefined, 'document')).toBe(GENERIC_DOCUMENT_ICON)
    // A dotfile is a name, not an extension.
    expect(mediaFileIcon('.gitignore', 'document')).toBe(GENERIC_DOCUMENT_ICON)
  })

  it('uses a configured External App for an extension it does not otherwise know', () => {
    const profiles = [profile({ allowedExtensions: ['qqq'] })]
    expect(mediaFileIcon('mystery.qqq', 'document', profiles)).toBe('mdi-presentation')
    expect(
      mediaFileIcon('clip.zzz', 'document', [
        profile({ kind: 'video', allowedExtensions: ['zzz'] }),
      ]),
    ).toBe('mdi-movie-open-outline')
    expect(
      mediaFileIcon('thing.yyy', 'document', [
        profile({ kind: 'custom', allowedExtensions: ['yyy'] }),
      ]),
    ).toBe('mdi-application-outline')
  })

  it('tolerates a profile listing its extensions with a leading dot', () => {
    const profiles = [profile({ allowedExtensions: ['.qqq'] })]
    expect(mediaFileIcon('mystery.qqq', 'document', profiles)).toBe('mdi-presentation')
  })

  it('prefers the extension over a profile — profile kind is the coarser signal', () => {
    // A PDF handed off to a "presentation" app is still a PDF, and saying so is more useful.
    const profiles = [profile({ allowedExtensions: ['pdf'] })]
    expect(mediaFileIcon('bulletin.pdf', 'document', profiles)).toBe('mdi-file-pdf-box')
  })

  it('ignores a profile that claims no extensions', () => {
    expect(mediaFileIcon('mystery.qqq', 'document', [profile()])).toBe(GENERIC_DOCUMENT_ICON)
  })
})
