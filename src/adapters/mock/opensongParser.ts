import type { Arrangement, SongBlock } from '@/models/song'

/**
 * Mirrors src-tauri/src/domain/opensong.rs — the mock adapter needs its own implementation
 * (no code-sharing between the Rust and JS runtimes), but the static demo build is a
 * first-class deliverable (spec section 7) and should parse real OpenSong files the same
 * way the desktop build does, not fall back to a lesser title-only stand-in.
 */
export interface ParsedOpenSongSong {
  title: string
  author?: string
  copyright?: string
  ccli?: string
  key?: string
  blocks: SongBlock[]
  arrangement: Arrangement
}

// A curly apostrophe (Windows-1252 0x92) that got mis-decoded somewhere along the way as
// the Unicode C1 control character U+0092 instead of the intended U+2019 — invisible/tofu
// in most fonts. A real bug found in an imported song; only the well-known printable cp1252
// mappings are repaired, since the handful of codepoints undefined in cp1252 can't be
// resolved to any specific intended character.
const CP1252_CONTROL_REPLACEMENTS: Record<number, string> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ',
}

function fixCp1252Mojibake(input: string): string {
  return Array.from(input)
    .map((char) => {
      const code = char.codePointAt(0) ?? 0
      return code >= 0x80 && code <= 0x9f ? (CP1252_CONTROL_REPLACEMENTS[code] ?? char) : char
    })
    .join('')
}

function decodeXmlEntities(input: string): string {
  const decoded = input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    switch (entity) {
      case 'amp':
        return '&'
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'quot':
        return '"'
      case 'apos':
        return "'"
      default:
        if (/^#x[0-9a-f]+$/i.test(entity)) {
          return String.fromCodePoint(parseInt(entity.slice(2), 16))
        }
        if (/^#\d+$/.test(entity)) {
          return String.fromCodePoint(parseInt(entity.slice(1), 10))
        }
        return match
    }
  })
  return fixCp1252Mojibake(decoded)
}

function extractTag(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)
  if (!match) return undefined
  const value = decodeXmlEntities(match[1].trim())
  return value.length > 0 ? value : undefined
}

function splitTag(tag: string): [string, string | undefined] {
  const match = /^([A-Za-z]+)(\d+)$/.exec(tag)
  if (!match) return [tag, undefined]
  return [match[1].toUpperCase(), match[2]]
}

function labelForTag(tag: string): string {
  const [letters, number] = splitTag(tag)
  const words: Record<string, string> = {
    V: 'Verse',
    C: 'Chorus',
    B: 'Bridge',
    P: 'Pre-Chorus',
    I: 'Intro',
    O: 'Other',
    T: 'Tag',
    E: 'Ending',
  }
  const word = words[letters]
  if (!word) return tag
  return number ? `${word} ${number}` : word
}

function parseLyrics(lyrics: string): { blocks: SongBlock[]; sequence: string[] } {
  const blocks: SongBlock[] = []
  const blockIndex = new Map<string, number>()
  const sequence: string[] = []

  let currentTag: string | undefined
  let currentLines: string[] = []

  const flush = () => {
    if (!currentTag) return
    const id = currentTag.toLowerCase()
    // OpenSong prefixes every lyric line with a single leading space as a formatting
    // convention, not meaningful indentation — trim both ends of each line, not just the
    // trailing end of the whole block, or every line after the first keeps a stray space.
    const text = decodeXmlEntities(
      currentLines
        .map((line) => line.trim())
        .join('\n')
        .trim(),
    )
    if (text.length > 0) {
      const existingIndex = blockIndex.get(id)
      if (existingIndex !== undefined) {
        blocks[existingIndex].text = text
      } else {
        blockIndex.set(id, blocks.length)
        blocks.push({ id, label: labelForTag(currentTag), text })
      }
      sequence.push(id)
    } else if (blockIndex.has(id)) {
      sequence.push(id)
    }
  }

  for (const line of lyrics.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length > 2 && trimmed.startsWith('[') && trimmed.endsWith(']')) {
      flush()
      currentTag = trimmed.slice(1, -1)
      currentLines = []
    } else {
      currentLines.push(line)
    }
  }
  flush()

  return { blocks, sequence }
}

export function parseOpenSongXml(xml: string): ParsedOpenSongSong {
  const title = extractTag(xml, 'title') ?? 'Imported Song'
  const author = extractTag(xml, 'author')
  const copyright = extractTag(xml, 'copyright')
  const ccli = extractTag(xml, 'ccli')
  const key = extractTag(xml, 'key')
  const presentation = extractTag(xml, 'presentation')
  const lyrics = extractTag(xml, 'lyrics')
  const { blocks, sequence: lyricsSequence } = lyrics ? parseLyrics(lyrics) : { blocks: [], sequence: [] }

  let sequence = lyricsSequence
  if (presentation) {
    const ids = presentation
      .split(/\s+/)
      .filter(Boolean)
      .map((tag) => tag.toLowerCase())
      .filter((id) => blocks.some((block) => block.id === id))
    if (ids.length > 0) sequence = ids
  }

  return { title, author, copyright, ccli, key, blocks, arrangement: { sequence } }
}
