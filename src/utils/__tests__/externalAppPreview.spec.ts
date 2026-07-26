import { describe, expect, it } from 'vitest'
import { previewExternalAppCommand } from '@/utils/externalAppPreview'

describe('previewExternalAppCommand', () => {
  it('substitutes the example file into the parameter format', () => {
    expect(previewExternalAppCommand(String.raw`C:\Program Files\POWERPNT.EXE`, String.raw`/S "{file}"`)).toBe(
      String.raw`POWERPNT.EXE /S "C:\Services\Example.pptx"`,
    )
  })

  it('uses just the executable name with no parameter format', () => {
    expect(previewExternalAppCommand(String.raw`C:\Program Files\POWERPNT.EXE`, undefined)).toBe('POWERPNT.EXE')
  })

  it('returns an empty string with no executable configured', () => {
    expect(previewExternalAppCommand(undefined, String.raw`/S "{file}"`)).toBe('')
  })

  it('accepts a custom file for callers that have a real chosen file', () => {
    expect(previewExternalAppCommand('VLC.EXE', '{file}', String.raw`D:\Media\clip.mp4`)).toBe(String.raw`VLC.EXE D:\Media\clip.mp4`)
  })
})
