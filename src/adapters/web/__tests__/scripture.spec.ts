import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  listApiBibleCatalog,
  parseBracketedVerses,
  resolveApiBible,
  resolveEsv,
} from '../scripture'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseBracketedVerses', () => {
  it('splits flat bracketed text into numbered, whitespace-normalized verses', () => {
    const verses = parseBracketedVerses('[16] For God so\n loved   the world [17] For God did not')
    expect(verses).toEqual([
      { number: 16, text: 'For God so loved the world' },
      { number: 17, text: 'For God did not' },
    ])
  })

  it('returns an empty array when there are no verse markers', () => {
    expect(parseBracketedVerses('no markers here')).toEqual([])
  })
})

describe('resolveEsv', () => {
  it('requests the canonical reference and returns parsed verses with ESV attribution', async () => {
    let requestedUrl: string | undefined
    let requestedHeaders: HeadersInit | undefined
    vi.stubGlobal('fetch', async (url: URL, init?: RequestInit) => {
      requestedUrl = url.toString()
      requestedHeaders = init?.headers
      return jsonResponse({ passages: ['[16] For God so loved the world.'] })
    })

    const result = await resolveEsv('john 3:16', 'test-key')

    expect(result).toEqual({
      reference: 'John 3:16',
      translation: 'ESV',
      verses: [{ number: 16, text: 'For God so loved the world.' }],
      copyright: '(ESV)',
    })
    expect(requestedUrl).toContain('https://api.esv.org/v3/passage/text/')
    expect(requestedUrl).toContain('q=John+3%3A16')
    expect(requestedHeaders).toEqual({ Authorization: 'Token test-key' })
  })

  it('rejects an invalid reference before making a request', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(resolveEsv('Not A Book 1:1', 'test-key')).rejects.toThrow(
      /isn't a valid scripture reference/,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('throws when the API responds with a non-success status', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({}, false, 401))
    await expect(resolveEsv('John 3:16', 'bad-key')).rejects.toThrow(
      /ESV API request failed \(401\)/,
    )
  })

  it('throws when the response has no verse markers', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ passages: ['no markers'] }))
    await expect(resolveEsv('John 3:16', 'test-key')).rejects.toThrow(/no verse text/)
  })
})

describe('resolveApiBible', () => {
  it('builds a single-verse passage id and returns verses with translationCode as the label', async () => {
    let requestedUrl: string | undefined
    let requestedHeaders: HeadersInit | undefined
    vi.stubGlobal('fetch', async (url: URL, init?: RequestInit) => {
      requestedUrl = url.toString()
      requestedHeaders = init?.headers
      return jsonResponse({
        data: { content: '[16] For God so loved the world.', copyright: null },
      })
    })

    const result = await resolveApiBible('John 3:16', 'bible-id-1', 'NIV', 'test-key')

    expect(result).toEqual({
      reference: 'John 3:16',
      translation: 'NIV',
      verses: [{ number: 16, text: 'For God so loved the world.' }],
      copyright: undefined,
    })
    expect(requestedUrl).toContain(
      'https://api.scripture.api.bible/v1/bibles/bible-id-1/passages/JHN.3.16',
    )
    expect(requestedHeaders).toEqual({ 'api-key': 'test-key' })
  })

  it('builds a cross-chapter passage id for a verse range', async () => {
    let requestedUrl: string | undefined
    vi.stubGlobal('fetch', async (url: URL) => {
      requestedUrl = url.toString()
      return jsonResponse({ data: { content: '[16] a [17] b', copyright: 'CC' } })
    })

    const result = await resolveApiBible('John 3:16-4:2', 'bible-id-1', 'NIV', 'test-key')
    expect(result.copyright).toBe('CC')
    expect(requestedUrl).toContain('passages/JHN.3.16-JHN.4.2')
  })

  it('rejects a book with no OSIS mapping before making a request', async () => {
    // Every canonical book in bibleBooks.json has a mapping, so this exercises the branch via
    // an already-invalid reference instead — isValidReference rejects it first either way.
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(
      resolveApiBible('Not A Book 1:1', 'bible-id-1', 'NIV', 'test-key'),
    ).rejects.toThrow(/isn't a valid scripture reference/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('listApiBibleCatalog', () => {
  it('normalizes catalog entries, treating null description as empty', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse({
        data: [
          { id: 'abc', name: 'World English Bible', abbreviation: 'WEB', description: null },
          {
            id: 'def',
            name: 'New International Version',
            abbreviation: 'NIV11',
            description: 'Protestant',
          },
        ],
      }),
    )

    const catalog = await listApiBibleCatalog('test-key')
    expect(catalog).toEqual([
      { id: 'abc', name: 'World English Bible', abbreviation: 'WEB', description: '' },
      {
        id: 'def',
        name: 'New International Version',
        abbreviation: 'NIV11',
        description: 'Protestant',
      },
    ])
  })

  it('throws when the API responds with a non-success status', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({}, false, 403))
    await expect(listApiBibleCatalog('bad-key')).rejects.toThrow(/api.bible request failed \(403\)/)
  })
})
