import { describe, expect, it } from 'vitest'
import { parseOpenSongXml } from '@/adapters/mock/opensongParser'

describe('parseOpenSongXml', () => {
  it('parses real OpenSong content (Amazing Grace)', () => {
    // Mirrors the fixture in src-tauri/src/domain/opensong.rs's Rust test — verbatim content
    // from OpenSong/Songs/Amazing Grace (public-domain hymn text).
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<song>
  <title>Amazing Grace</title>
  <author></author>
  <lyrics>[V1]
 Amazing Grace, how sweet the sound,
 That saved a wretch like me.

[V2]
 T'was Grace that taught my heart to fear.

[O]
 I once was lost but now am found,
 Was blind, but now I see.
 </lyrics>
</song>`
    const parsed = parseOpenSongXml(xml)
    expect(parsed.title).toBe('Amazing Grace')
    expect(parsed.author).toBeUndefined()
    expect(parsed.blocks).toHaveLength(3)
    expect(parsed.blocks[0]).toMatchObject({ id: 'v1', label: 'Verse 1' })
    expect(parsed.blocks[0].text).toContain('Amazing Grace, how sweet the sound')
    expect(parsed.blocks[2].label).toBe('Other')
    expect(parsed.arrangement.sequence).toEqual(['v1', 'v2', 'o'])
  })

  it('prefers <presentation> over lyrics order, and can skip a defined block', () => {
    const xml =
      '<song><title>Ah, Holy Jesus</title><presentation>V1 V2 V4</presentation>' +
      '<lyrics>[V1]\nA\n\n[V2]\nB\n\n[V3]\nC\n\n[V4]\nD</lyrics></song>'
    const parsed = parseOpenSongXml(xml)
    expect(parsed.blocks).toHaveLength(4)
    expect(parsed.arrangement.sequence).toEqual(['v1', 'v2', 'v4'])
  })

  it('treats an empty tag marker as a repeat of the earlier block', () => {
    const xml =
      '<song><title>Test</title><lyrics>[C]\nChorus\n\n[V1]\nVerse\n\n[C]\n</lyrics></song>'
    const parsed = parseOpenSongXml(xml)
    expect(parsed.blocks).toHaveLength(2)
    expect(parsed.arrangement.sequence).toEqual(['c', 'v1', 'c'])
  })

  it('decodes common XML entities', () => {
    const xml =
      '<song><title>Test</title><lyrics>[V1]\nRock &amp; Redeemer&apos;s &quot;Grace&quot;\n</lyrics></song>'
    const parsed = parseOpenSongXml(xml)
    expect(parsed.blocks[0].text).toBe('Rock & Redeemer\'s "Grace"')
  })

  it('falls back to a placeholder title when missing', () => {
    expect(parseOpenSongXml('<song><lyrics></lyrics></song>').title).toBe('Imported Song')
  })

  it('trims the leading space OpenSong prefixes every lyric line with', () => {
    const xml = '<song><title>Test</title><lyrics>[V1]\n Line one\n Line two\n</lyrics></song>'
    const parsed = parseOpenSongXml(xml)
    expect(parsed.blocks[0].text).toBe('Line one\nLine two')
  })

  it('repairs Windows-1252 mojibake control characters', () => {
    // A curly apostrophe (cp1252 0x92) mis-decoded as the Unicode C1 control character
    // U+0092 along the way — renders as an invisible/tofu box instead of an apostrophe.
    const mangled = 'Its finished'
    const xml = `<song><title>Test</title><lyrics>[V1]\n${mangled}\n</lyrics></song>`
    const parsed = parseOpenSongXml(xml)
    expect(parsed.blocks[0].text).toBe('It’s finished')
  })
})
